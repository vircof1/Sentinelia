import assert from 'node:assert/strict';
import { createHash, randomBytes } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import {
  DespachadorOutboxAuditoriaRuntime
} from '../apps/sentinelia-runtime/src/auditoria/DespachadorOutboxAuditoriaRuntime.js';
import {
  ConflictoIdempotenciaAuditoria,
  RepositorioAuditoria
} from '../paquetes/auditoria/src/RepositorioAuditoria.js';
import {
  ConflictoOutboxAuditoriaRuntime,
  LeaseOutboxAuditoriaPerdido,
  RepositorioOutboxAuditoriaRuntime
} from '../paquetes/auditoria/src/RepositorioOutboxAuditoriaRuntime.js';
import { PERFIL_JCS_AUDITORIA_V1 } from '../paquetes/auditoria/src/PerfilJcsAuditoria.js';
import { VERSION_ENCADENADO_AUDITORIA_V1 } from '../paquetes/auditoria/src/SobreCanonicoAuditoria.js';
import {
  generarUuidV7Auditoria,
  uuidV7AuditoriaABytes
} from '../paquetes/auditoria/src/UuidV7Auditoria.js';
import { ClienteSql } from '../paquetes/persistencia-sql/src/ClienteSql.js';
import { EjecutorMigraciones } from '../paquetes/persistencia-sql/src/EjecutorMigraciones.js';
import { RepositorioMigraciones } from '../paquetes/persistencia-sql/src/RepositorioMigraciones.js';
import {
  obtenerConfiguracionAplicacion,
  obtenerRutaMigraciones
} from '../paquetes/utilidades/src/configuracion/obtenerConfiguracionAplicacion.js';

const baseTenant = BigInt(Date.now()) * 100n;
const tenantA = String(baseTenant + 1n);
const tenantB = String(baseTenant + 2n);
const tenantCaida = String(baseTenant + 3n);
const tenantBloqueo = String(baseTenant + 4n);
const tenantRollback = String(baseTenant + 5n);
const tenantCoordinadoFallo = String(baseTenant + 6n);
const clavesPrueba = [
  tenantA,
  tenantB,
  tenantCaida,
  tenantBloqueo,
  tenantRollback,
  tenantCoordinadoFallo
]
  .map((tenantId) => `alertas:tenant:${tenantId}`);

async function main() {
  const configuracion = obtenerConfiguracionAplicacion();
  assert.equal(configuracion.sql.estaCompleta, true, 'La verificación 5.21.4c requiere SQL local.');
  const clienteSql = new ClienteSql(configuracion.sql);
  const outbox = new RepositorioOutboxAuditoriaRuntime(clienteSql);
  const auditoria = new RepositorioAuditoria(clienteSql, { maxReintentos: 3 });
  let errorPrincipal = null;
  try {
    await asegurarMigraciones(clienteSql);
    await verificarAtomicidadDeAlta(clienteSql, outbox);
    await verificarFifoParalelismoEIdempotencia(clienteSql, outbox, auditoria);
    await verificarCaidaAntesDeConfirmar(clienteSql, outbox, auditoria);
    await verificarBloqueoYRehabilitacion(clienteSql, outbox, auditoria);
    await verificarRetencionTecnica(clienteSql, outbox);
    await verificarProteccionesEstructurales(clienteSql);
  } catch (error) {
    errorPrincipal = error;
  } finally {
    try {
      await limpiarPruebas(clienteSql);
    } catch (errorLimpieza) {
      if (!errorPrincipal) throw errorLimpieza;
      console.error('[auditoria] Error adicional limpiando los datos outbox de prueba');
      console.error(errorLimpieza);
    }
    await clienteSql.cerrar();
  }
  if (errorPrincipal) throw errorPrincipal;
  console.log('[auditoria] OK 5.21.5e: alta=atomica fifo=por_cadena paralelismo=entre_cadenas coordinador=comun reintento=recuperado duplicados=0 cli=sin_edicion');
}

async function asegurarMigraciones(clienteSql) {
  const ejecutor = new EjecutorMigraciones({
    clienteSql,
    repositorioMigraciones: new RepositorioMigraciones(clienteSql),
    rutaMigraciones: obtenerRutaMigraciones()
  });
  await ejecutor.ejecutarPendientes();
  await ejecutor.ejecutarPendientes();
}

async function verificarAtomicidadDeAlta(clienteSql, outbox) {
  const intencion = crearAlerta({ tenantId: tenantRollback, ordinal: 1 });
  const conexion = await clienteSql.obtenerConexion();
  try {
    await conexion.beginTransaction();
    await outbox.encolarEnTransaccion([intencion], { conexion });
    await conexion.rollback();
  } finally {
    await rollbackSeguro(conexion);
    conexion.release();
  }
  assert.equal(await contarObligacion(clienteSql, intencion.eventoId), 0);
}

async function verificarFifoParalelismoEIdempotencia(clienteSql, outbox, auditoria) {
  const a1 = crearAlerta({ tenantId: tenantA, ordinal: 1 });
  const a2 = crearAlerta({ tenantId: tenantA, ordinal: 2 });
  const b1 = crearAlerta({ tenantId: tenantB, ordinal: 1 });
  const altas = await outbox.encolarAtomico([a1, a2, b1]);
  assert.deepEqual(
    altas.filter(({ claveCadena }) => claveCadena === a1.claveCadena)
      .map(({ ordenObligacion }) => ordenObligacion),
    ['1', '2']
  );
  assert.equal(altas.find(({ eventoId }) => eventoId === b1.eventoId).ordenObligacion, '1');

  const repetida = await outbox.encolarAtomico([a1]);
  assert.equal(repetida[0].resultadoAlta, 'existente');
  assert.equal(repetida[0].ordenObligacion, '1');
  await assert.rejects(
    () => outbox.encolarAtomico([{
      ...a1,
      sujeto: { ...a1.sujeto, id: generarUuidV7Auditoria() }
    }]),
    ConflictoOutboxAuditoriaRuntime
  );

  let incorporacionesSimultaneas = 0;
  let maximoIncorporacionesSimultaneas = 0;
  const auditoriaMedida = {
    async incorporarEnTransaccion(...argumentos) {
      incorporacionesSimultaneas += 1;
      maximoIncorporacionesSimultaneas = Math.max(
        maximoIncorporacionesSimultaneas,
        incorporacionesSimultaneas
      );
      try {
        await new Promise((resolver) => setTimeout(resolver, 20));
        return await auditoria.incorporarEnTransaccion(...argumentos);
      } finally {
        incorporacionesSimultaneas -= 1;
      }
    }
  };
  const despachador = new DespachadorOutboxAuditoriaRuntime({
    repositorioOutbox: outbox,
    repositorioAuditoria: auditoriaMedida,
    instanciaId: 'runtime-outbox-1',
    concurrencia: 8,
    leaseTtlSegundos: 30,
    reintentoBaseSegundos: 1,
    reintentoMaximoSegundos: 8
  });
  const primera = await despachador.procesarPendientes({
    origen: 'prueba',
    numeroTick: 1
  });
  assert.equal(primera.totalReclamadas, 2);
  assert.equal(
    primera.totalCompletadas + primera.totalReintentables,
    2,
    'Cada reclamación paralela debe completar o quedar reintentable de forma explícita.'
  );
  assert.equal(
    maximoIncorporacionesSimultaneas,
    2,
    'Las primeras obligaciones de cadenas distintas deben procesarse en paralelo.'
  );
  assert.deepEqual(
    new Set(primera.resultados.map(({ claveCadena }) => claveCadena)),
    new Set([a1.claveCadena, b1.claveCadena])
  );
  assert.equal(
    primera.resultados.some(({ eventoId }) => eventoId === a2.eventoId),
    false,
    'El segundo elemento de una cadena no puede saltar al primero.'
  );
  for (let intento = 2; intento <= 6; intento += 1) {
    await clienteSql.ejecutar(
      `UPDATE outbox_auditoria_runtime
          SET proximo_intento_utc = UTC_TIMESTAMP(3)
        WHERE clave_cadena IN (?, ?) AND estado = 'reintentable'`,
      [a1.claveCadena, b1.claveCadena]
    );
    const lote = await despachador.procesarPendientes({
      origen: 'prueba',
      numeroTick: intento
    });
    if (lote.totalReclamadas === 0) break;
  }
  assert.equal(await contarEventos(clienteSql, a1.eventoId), 1);
  assert.equal(await contarEventos(clienteSql, a2.eventoId), 1);
  assert.equal(await contarEventos(clienteSql, b1.eventoId), 1);

  const temporal = crearAlerta({ tenantId: tenantCoordinadoFallo, ordinal: 1 });
  await outbox.encolarAtomico([temporal]);
  const despachadorFallido = new DespachadorOutboxAuditoriaRuntime({
    repositorioOutbox: outbox,
    repositorioAuditoria: {
      async incorporarEnTransaccion() {
        const error = new Error('Deadlock transitorio password=secreto.');
        error.code = 'ER_LOCK_DEADLOCK';
        throw error;
      }
    },
    instanciaId: 'runtime-coordinado-fallido',
    concurrencia: 1,
    reintentoBaseSegundos: 1,
    reintentoMaximoSegundos: 8
  });
  const fallida = await despachadorFallido.procesarPendientes({
    origen: 'prueba_fallo',
    numeroTick: 3
  });
  assert.equal(fallida.totalReintentables, 1);
  assert.equal(fallida.totalBloqueadas, 0);
  const [diagnostico] = await clienteSql.consultar(
    `SELECT estado, ultimo_mensaje_error
       FROM outbox_auditoria_runtime WHERE evento_id = ?`,
    [uuidV7AuditoriaABytes(temporal.eventoId)]
  );
  assert.equal(diagnostico.estado, 'reintentable');
  assert.doesNotMatch(diagnostico.ultimo_mensaje_error, /secreto|password/i);
  await clienteSql.ejecutar(
    `UPDATE outbox_auditoria_runtime
        SET proximo_intento_utc = UTC_TIMESTAMP(3)
      WHERE evento_id = ?`,
    [uuidV7AuditoriaABytes(temporal.eventoId)]
  );
  const recuperada = await despachador.procesarPendientes({
    origen: 'prueba_recuperacion',
    numeroTick: 4
  });
  assert.equal(recuperada.totalCompletadas, 1);
  assert.equal(recuperada.resultados[0].eventoId, temporal.eventoId);
  assert.equal(await contarEventos(clienteSql, temporal.eventoId), 1);
}

async function verificarLeaseObsoleto(clienteSql, outbox, leaseObsoleto) {
  const conexion = await clienteSql.obtenerConexion();
  try {
    await conexion.beginTransaction();
    await assert.rejects(
      () => outbox.marcarCompletada(leaseObsoleto, { conexion }),
      LeaseOutboxAuditoriaPerdido
    );
    await conexion.rollback();
  } finally {
    await rollbackSeguro(conexion);
    conexion.release();
  }
}

async function verificarCaidaAntesDeConfirmar(clienteSql, outbox, auditoria) {
  const intencion = crearAlerta({ tenantId: tenantCaida, ordinal: 1 });
  await outbox.encolarAtomico([intencion]);
  const reclamada = await reclamarDirectamente(outbox, 'prueba-caida');
  const conexion = await clienteSql.obtenerConexion();
  try {
    await conexion.beginTransaction();
    const vigente = await outbox.bloquearLeaseVigente(reclamada, { conexion });
    await auditoria.incorporarEnTransaccion([vigente.intencion], { conexion });
    await conexion.rollback();
  } finally {
    await rollbackSeguro(conexion);
    conexion.release();
  }
  assert.equal(await contarEventos(clienteSql, intencion.eventoId), 0, 'La caída debe revertir evento y confirmación conjuntamente.');
  await clienteSql.ejecutar(
    'UPDATE outbox_auditoria_runtime SET lease_expira_utc = TIMESTAMPADD(SECOND, -1, UTC_TIMESTAMP(3)) WHERE id = ?',
    [reclamada.id]
  );
  const despachador = crearDespachador(outbox, auditoria, 'prueba-caida-recuperada');
  const recuperada = await despachador.procesarPendientes({ origen: 'reinicio', numeroTick: 1 });
  assert.equal(recuperada.totalCompletadas, 1);
  await verificarLeaseObsoleto(clienteSql, outbox, reclamada);
  const [estadoRecuperado] = await clienteSql.consultar(
    'SELECT fencing_token FROM outbox_auditoria_runtime WHERE id = ?',
    [reclamada.id]
  );
  assert.equal(String(estadoRecuperado.fencing_token), '2');
  assert.equal(await contarEventos(clienteSql, intencion.eventoId), 1);

  const repetida = crearAlerta({ tenantId: tenantCaida, ordinal: 2 });
  await outbox.encolarAtomico([repetida]);
  await auditoria.incorporarAtomico([repetida]);
  const resultado = await crearDespachador(outbox, auditoria, 'prueba-repeticion')
    .procesarPendientes({ origen: 'repeticion', numeroTick: 2 });
  assert.equal(resultado.resultados[0].resultadoEvento, 'existente');
  assert.equal(await contarEventos(clienteSql, repetida.eventoId), 1, 'El reintento idempotente no duplica el evento.');
}

async function verificarBloqueoYRehabilitacion(clienteSql, outbox, auditoria) {
  const d1 = crearAlerta({ tenantId: tenantBloqueo, ordinal: 1 });
  const d2 = crearAlerta({ tenantId: tenantBloqueo, ordinal: 2 });
  await outbox.encolarAtomico([d1, d2], { maxIntentos: 1 });
  const procesadorFallido = new DespachadorOutboxAuditoriaRuntime({
    repositorioOutbox: outbox,
    repositorioAuditoria: {
      async incorporarEnTransaccion() {
        throw new ConflictoIdempotenciaAuditoria('Conflicto permanente simulado sin secret token=abc.');
      }
    },
    instanciaId: 'prueba-bloqueo',
    concurrencia: 1,
    reintentoBaseSegundos: 1
  });
  const bloqueada = await procesadorFallido.procesarPendientes({ origen: 'prueba', numeroTick: 1 });
  assert.equal(bloqueada.totalBloqueadas, 1);
  const obligacionId = bloqueada.resultados[0].id;
  assert.equal(await reclamarDirectamente(outbox, 'prueba-bloqueo-2'), null);
  const visibles = await outbox.listarBloqueadas();
  assert.equal(visibles.some(({ id }) => id === obligacionId), true);

  await outbox.rehabilitarBloqueada(obligacionId);
  const despachador = crearDespachador(outbox, auditoria, 'prueba-bloqueo-3');
  const rehabilitada = await despachador.procesarPendientes({ origen: 'rehabilitacion', numeroTick: 2 });
  assert.equal(rehabilitada.resultados[0].eventoId, d1.eventoId);
  const siguiente = await despachador.procesarPendientes({ origen: 'rehabilitacion', numeroTick: 3 });
  assert.equal(siguiente.resultados[0].eventoId, d2.eventoId);
  const [estadoRehabilitado] = await clienteSql.consultar(
    'SELECT fencing_token FROM outbox_auditoria_runtime WHERE id = ?',
    [obligacionId]
  );
  assert.equal(BigInt(estadoRehabilitado.fencing_token) > 1n, true);
}

function crearDespachador(outbox, auditoria, instanciaId) {
  return new DespachadorOutboxAuditoriaRuntime({
    repositorioOutbox: outbox,
    repositorioAuditoria: auditoria,
    instanciaId,
    concurrencia: 8,
    leaseTtlSegundos: 30,
    reintentoBaseSegundos: 1,
    reintentoMaximoSegundos: 8
  });
}

function reclamarDirectamente(outbox, instanciaId) {
  return outbox.reclamarSiguienteConLease({
    instanciaId,
    leaseToken: randomBytes(32),
    ttlSegundos: 30
  });
}

async function verificarRetencionTecnica(clienteSql, outbox) {
  const [fila] = await clienteSql.consultar(
    `SELECT id, evento_id FROM outbox_auditoria_runtime
     WHERE clave_cadena = ? AND estado = 'completada'
     ORDER BY orden_obligacion LIMIT 1`,
    [`alertas:tenant:${tenantB}`]
  );
  await clienteSql.ejecutar(
    'UPDATE outbox_auditoria_runtime SET completada_en_utc = TIMESTAMPADD(DAY, -3651, UTC_TIMESTAMP(3)) WHERE id = ?',
    [fila.id]
  );
  const limpieza = await outbox.limpiarCompletadas({ diasGracia: 3650, limite: 10 });
  assert.equal(limpieza.eliminadas, 1);
  const eventos = await clienteSql.consultar(
    'SELECT COUNT(*) AS total FROM eventos_auditoria WHERE evento_id = ?',
    [fila.evento_id]
  );
  assert.equal(Number(eventos[0].total), 1, 'Limpiar la outbox no puede retirar evidencia auditable.');
}

async function verificarProteccionesEstructurales(clienteSql) {
  const [pendiente] = await clienteSql.consultar(
    'SELECT id FROM outbox_auditoria_runtime WHERE clave_cadena = ? LIMIT 1',
    [`alertas:tenant:${tenantA}`]
  );
  await assert.rejects(
    () => clienteSql.ejecutar('UPDATE outbox_auditoria_runtime SET sujeto_id = ? WHERE id = ?', ['mutado', pendiente.id]),
    /contenido causal.*inmutable/i
  );
  await assert.rejects(
    () => clienteSql.ejecutar("UPDATE outbox_auditoria_runtime SET estado = 'pendiente', evento_incorporado_id = NULL, completada_en_utc = NULL WHERE id = ?", [pendiente.id]),
    /transición de estado.*no está permitida/i
  );
  await assert.rejects(
    () => clienteSql.ejecutar('UPDATE cabeceras_outbox_auditoria_runtime SET ultimo_orden = ultimo_orden - 1 WHERE clave_cadena = ?', [`alertas:tenant:${tenantA}`]),
    /orden causal.*no puede retroceder/i
  );

  const temporal = crearAlerta({ tenantId: tenantRollback, ordinal: 2 });
  const conexion = await clienteSql.obtenerConexion();
  try {
    await conexion.beginTransaction();
    const [alta] = await new RepositorioOutboxAuditoriaRuntime(clienteSql)
      .encolarEnTransaccion([temporal], { conexion });
    await assert.rejects(
      () => conexion.execute('DELETE FROM outbox_auditoria_runtime WHERE id = ?', [alta.id]),
      /no terminal.*eliminarse/i
    );
    await conexion.rollback();
  } finally {
    await rollbackSeguro(conexion);
    conexion.release();
  }

  const fuente = await readFile(
    new URL('../paquetes/auditoria/src/RepositorioOutboxAuditoriaRuntime.js', import.meta.url),
    'utf8'
  );
  assert.doesNotMatch(fuente, /MAX\s*\(\s*orden_obligacion\s*\)\s*\+\s*1/i);
  assert.match(fuente, /FOR UPDATE SKIP LOCKED/);
  assert.match(fuente, /fencing_token/);
}

function crearAlerta({ tenantId, ordinal }) {
  const eventoId = generarUuidV7Auditoria();
  return {
    eventoId,
    tipo: 'alerta.abierta',
    versionContrato: 1,
    flujo: 'alertas',
    claveCadena: `alertas:tenant:${tenantId}`,
    actorReal: { tipo: 'runtime', id: 'sentinelia-runtime' },
    actorEfectivo: null,
    modoActuacion: 'directo',
    sujeto: { tipo: 'alerta', id: generarUuidV7Auditoria() },
    origen: 'runtime',
    scope: { tenantId, empresaId: null, sitioId: null },
    correlacionId: generarUuidV7Auditoria(),
    causalidad: null,
    productor: 'runtime_alertas',
    claveOperacion: generarUuidV7Auditoria(),
    rolEvento: 'principal',
    efectivoEnUtc: new Date().toISOString(),
    versionCanonicalizador: PERFIL_JCS_AUDITORIA_V1,
    versionEncadenado: VERSION_ENCADENADO_AUDITORIA_V1,
    payload: { resultado: 'abierta', causa: 'monitor_en_fallo' }
  };
}

async function contarObligacion(clienteSql, eventoId) {
  const [fila] = await clienteSql.consultar(
    'SELECT COUNT(*) AS total FROM outbox_auditoria_runtime WHERE evento_id = ?',
    [uuidV7AuditoriaABytes(eventoId)]
  );
  return Number(fila.total);
}

async function contarEventos(clienteSql, eventoId) {
  const [fila] = await clienteSql.consultar(
    'SELECT COUNT(*) AS total FROM eventos_auditoria WHERE evento_id = ?',
    [uuidV7AuditoriaABytes(eventoId)]
  );
  return Number(fila.total);
}

async function limpiarPruebas(clienteSql) {
  const marcadores = clavesPrueba.map(() => '?').join(', ');
  const conexion = await clienteSql.obtenerConexion();
  try {
    await conexion.beginTransaction();
    await conexion.execute(
      `UPDATE outbox_auditoria_runtime
       SET estado = 'reintentable', intentos = 0,
           proximo_intento_utc = UTC_TIMESTAMP(3)
       WHERE clave_cadena IN (${marcadores}) AND estado = 'bloqueo_permanente'`,
      clavesPrueba
    );
    await conexion.execute(
      `UPDATE outbox_auditoria_runtime
       SET estado = 'procesando', instancia_id = 'limpieza-prueba',
           lease_token = ?, lease_expira_utc = TIMESTAMPADD(SECOND, 60, UTC_TIMESTAMP(3)),
           fencing_token = fencing_token + 1, intentos = intentos + 1
       WHERE clave_cadena IN (${marcadores})
         AND estado IN ('pendiente', 'reintentable')`,
      [Buffer.alloc(32, 255), ...clavesPrueba]
    );
    await conexion.execute(
      `UPDATE outbox_auditoria_runtime
       SET estado = 'completada', instancia_id = NULL, lease_token = NULL,
           lease_expira_utc = NULL, evento_incorporado_id = evento_id,
           completada_en_utc = UTC_TIMESTAMP(3)
       WHERE clave_cadena IN (${marcadores}) AND estado <> 'completada'`,
      clavesPrueba
    );
    await conexion.execute(
      `DELETE FROM outbox_auditoria_runtime WHERE clave_cadena IN (${marcadores})`,
      clavesPrueba
    );
    await conexion.execute(
      `DELETE FROM cabeceras_outbox_auditoria_runtime WHERE clave_cadena IN (${marcadores})`,
      clavesPrueba
    );
    const [eventos] = await conexion.execute(
      `SELECT evento_id FROM eventos_auditoria WHERE clave_cadena IN (${marcadores})`,
      clavesPrueba
    );
    if (eventos.length > 0) {
      const ids = eventos.map(({ evento_id }) => evento_id);
      const lugares = ids.map(() => '?').join(', ');
      await conexion.execute(`DELETE FROM identidades_idempotentes_auditoria WHERE evento_id IN (${lugares})`, ids);
      await conexion.execute(`DELETE FROM eventos_auditoria WHERE evento_id IN (${lugares})`, ids);
      for (const eventoId of ids) {
        const huella = createHash('sha256')
          .update(Buffer.from('sentinelia-auditoria-evento-id-v1', 'utf8'))
          .update(Buffer.from([0]))
          .update(eventoId)
          .digest();
        await conexion.execute('DELETE FROM tombstones_identidad_auditoria WHERE huella_evento_id = ?', [huella]);
      }
    }
    await conexion.execute(
      `DELETE FROM cadenas_auditoria WHERE clave_cadena IN (${marcadores})`,
      clavesPrueba
    );
    await conexion.commit();
  } catch (error) {
    await conexion.rollback();
    throw error;
  } finally {
    conexion.release();
  }
}

async function rollbackSeguro(conexion) {
  try {
    await conexion.rollback();
  } catch {
    // La aserción causal conserva prioridad.
  }
}

main().catch((error) => {
  console.error('[auditoria] Error verificando 5.21.4c');
  console.error(error);
  process.exit(1);
});

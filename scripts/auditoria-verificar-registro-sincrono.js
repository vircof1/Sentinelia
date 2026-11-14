import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
  CODIGOS_ERROR_REGISTRO_AUDITORIA,
  ErrorRegistroAuditoria
} from '../paquetes/auditoria/src/ErroresRegistroAuditoria.js';
import {
  PERFIL_JCS_AUDITORIA_V1
} from '../paquetes/auditoria/src/PerfilJcsAuditoria.js';
import { RepositorioAuditoria } from '../paquetes/auditoria/src/RepositorioAuditoria.js';
import { ServicioAuditoriaOperativa } from '../paquetes/auditoria/src/ServicioAuditoriaOperativa.js';
import {
  VERSION_ENCADENADO_AUDITORIA_V1
} from '../paquetes/auditoria/src/SobreCanonicoAuditoria.js';
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

const tenantId = String(BigInt(Date.now()) * 1000n + BigInt(process.pid));
const claveCadena = `monitores:tenant:${tenantId}`;

async function main() {
  await verificarApiNoOpYErroresEstructurados();
  await verificarApiNoOpYErroresEstructurados('ER_CHECKREAD');
  const configuracion = obtenerConfiguracionAplicacion();
  assert.equal(
    configuracion.sql.estaCompleta,
    true,
    'La verificación 5.21.5b requiere SQL local.'
  );
  const clienteSql = new ClienteSql(configuracion.sql);
  let errorPrincipal = null;
  try {
    await asegurarMigraciones(clienteSql);
    const repositorio = new RepositorioAuditoria(clienteSql);
    const servicioAuditoria = new ServicioAuditoriaOperativa({
      repositorioAuditoria: repositorio
    });
    await verificarAltaRepeticionYRelojUnico(clienteSql, servicioAuditoria);
    await verificarRechazoYRollbackDeNegocio(clienteSql, servicioAuditoria);
  } catch (error) {
    errorPrincipal = error;
  } finally {
    try {
      await limpiarPrueba(clienteSql);
    } catch (errorLimpieza) {
      if (!errorPrincipal) throw errorLimpieza;
      console.error('[auditoria] Error adicional limpiando el registro síncrono');
      console.error(errorLimpieza);
    }
    await clienteSql.cerrar();
  }
  if (errorPrincipal) throw errorPrincipal;
  console.log(
    '[auditoria] OK 5.21.5b: alta=atomica repeticion=no_op rechazo=estructurado reloj_sql=unico rollback=conjunto'
  );
}

async function verificarApiNoOpYErroresEstructurados(codigo = 'ER_LOCK_DEADLOCK') {
  const llamadas = [];
  const servicio = new ServicioAuditoriaOperativa({
    repositorioAuditoria: {
      async incorporarEnTransaccion(...argumentos) {
        llamadas.push(argumentos);
        const error = new Error('deadlock simulado');
        error.code = codigo;
        throw error;
      }
    }
  });
  const sinCambios = await servicio.registrarEnTransaccion({
    cambioEfectivo: false,
    intencion: null
  });
  assert.deepEqual(sinCambios, {
    estado: 'sin_cambios',
    evento: null,
    genesis: [],
    registradoEnUtc: null,
    esNoOp: true
  });
  assert.equal(llamadas.length, 0);

  await assert.rejects(
    () => servicio.registrarEnTransaccion({
      cambioEfectivo: false,
      intencion: {}
    }),
    (error) => verificarError(
      error,
      CODIGOS_ERROR_REGISTRO_AUDITORIA.ENTRADA_INVALIDA,
      false
    )
  );
  await assert.rejects(
    () => servicio.registrarEnTransaccion({
      cambioEfectivo: false,
      intencion: null,
      [Symbol('desconocida')]: true
    }),
    (error) => verificarError(
      error,
      CODIGOS_ERROR_REGISTRO_AUDITORIA.ENTRADA_INVALIDA,
      false
    )
  );
  await assert.rejects(
    () => servicio.registrarEnTransaccion({
      cambioEfectivo: true,
      intencion: crearAltaMonitor({ sujetoId: '990001' })
    }),
    (error) => verificarError(
      error,
      CODIGOS_ERROR_REGISTRO_AUDITORIA.FRONTERA_INVALIDA,
      false
    )
  );
  await assert.rejects(
    () => servicio.registrarEnTransaccion(
      {
        cambioEfectivo: true,
        intencion: crearAltaMonitor({ sujetoId: '990002' })
      },
      { conexion: { execute() {} } }
    ),
    (error) => verificarError(
      error,
      CODIGOS_ERROR_REGISTRO_AUDITORIA.PERSISTENCIA_FALLIDA,
      true
    )
  );
}

async function verificarAltaRepeticionYRelojUnico(clienteSql, servicioAuditoria) {
  const intencion = crearAltaMonitor({ sujetoId: '990010' });
  const alta = await ejecutarOperacionFixture({
    clienteSql,
    servicioAuditoria,
    intencion,
    valorNegocio: 'alta'
  });
  assert.equal(alta.resultado.estado, 'incorporado');
  assert.equal(alta.resultado.esNoOp, false);
  assert.equal(alta.filasNegocio, 1);
  assert.equal(alta.lecturasRelojAuditoria, 1);
  assert.equal(alta.resultado.genesis[0].estado, 'incorporado');

  const fechas = await clienteSql.consultar(
    `SELECT
       DATE_FORMAT(e.registrado_en_utc, '%Y-%m-%dT%H:%i:%s.%fZ') AS evento_utc,
       DATE_FORMAT(i.primera_observacion_utc, '%Y-%m-%dT%H:%i:%s.%fZ') AS identidad_utc,
       DATE_FORMAT(c.fecha_creacion_utc, '%Y-%m-%dT%H:%i:%s.%fZ') AS cadena_creada_utc,
       DATE_FORMAT(c.fecha_actualizacion_utc, '%Y-%m-%dT%H:%i:%s.%fZ') AS cadena_actualizada_utc
     FROM eventos_auditoria e
     JOIN cadenas_auditoria c ON c.id = e.cadena_id
     JOIN identidades_idempotentes_auditoria i ON i.evento_id = e.evento_id
     WHERE e.clave_cadena = ?
     ORDER BY e.secuencia`,
    [claveCadena]
  );
  assert.equal(fechas.length, 2);
  const instantes = fechas.flatMap((fila) => Object.values(fila))
    .map(normalizarFechaSqlTexto);
  assert.equal(new Set(instantes).size, 1);
  assert.equal(instantes[0], alta.resultado.registradoEnUtc);

  const antes = await contarEventos(clienteSql);
  const repeticion = await ejecutarOperacionFixture({
    clienteSql,
    servicioAuditoria,
    intencion,
    valorNegocio: 'repeticion'
  });
  assert.equal(repeticion.resultado.estado, 'existente');
  assert.equal(repeticion.resultado.registradoEnUtc, null);
  assert.equal(repeticion.resultado.evento.eventoId, intencion.eventoId);
  assert.equal(repeticion.lecturasRelojAuditoria, 1);
  assert.equal(await contarEventos(clienteSql), antes);
}

async function verificarRechazoYRollbackDeNegocio(clienteSql, servicioAuditoria) {
  const intencionOriginal = crearAltaMonitor({ sujetoId: '990020' });
  await ejecutarOperacionFixture({
    clienteSql,
    servicioAuditoria,
    intencion: intencionOriginal,
    valorNegocio: 'original'
  });
  const conflicto = {
    ...intencionOriginal,
    payload: {
      ...intencionOriginal.payload,
      despues: {
        ...intencionOriginal.payload.despues,
        nombre: 'Intención incompatible'
      }
    }
  };
  const rechazado = await ejecutarOperacionFixture({
    clienteSql,
    servicioAuditoria,
    intencion: conflicto,
    valorNegocio: 'debe_revertirse',
    capturarError: true
  });
  verificarError(
    rechazado.error,
    CODIGOS_ERROR_REGISTRO_AUDITORIA.CONFLICTO_IDEMPOTENCIA,
    false
  );
  assert.equal(rechazado.filasNegocio, 0);
  assert.equal(rechazado.lecturasRelojAuditoria, 1);

  const invalida = {
    ...crearAltaMonitor({ sujetoId: '990021' }),
    payload: {
      resultado: 'creado',
      antes: null,
      despues: { nombre: 'Monitor', tipo: 'ping', activo: true },
      password: 'no debe entrar'
    }
  };
  const validacion = await ejecutarOperacionFixture({
    clienteSql,
    servicioAuditoria,
    intencion: invalida,
    valorNegocio: 'tambien_debe_revertirse',
    capturarError: true
  });
  verificarError(
    validacion.error,
    CODIGOS_ERROR_REGISTRO_AUDITORIA.ENTRADA_INVALIDA,
    false
  );
  assert.equal(validacion.filasNegocio, 0);
  assert.equal(validacion.lecturasRelojAuditoria, 0);
}

async function ejecutarOperacionFixture({
  clienteSql,
  servicioAuditoria,
  intencion,
  valorNegocio,
  capturarError = false
}) {
  const conexion = await clienteSql.obtenerConexion();
  let lecturasRelojAuditoria = 0;
  const conexionAuditoria = {
    async execute(sql, parametros = []) {
      if (/DATE_FORMAT\(UTC_TIMESTAMP\(3\)/.test(sql)) {
        lecturasRelojAuditoria += 1;
      }
      return conexion.execute(sql, parametros);
    }
  };
  try {
    await conexion.execute(
      `CREATE TEMPORARY TABLE IF NOT EXISTS fixture_negocio_auditoria (
         valor VARCHAR(64) NOT NULL
       ) ENGINE=InnoDB`
    );
    await conexion.execute('TRUNCATE TABLE fixture_negocio_auditoria');
    await conexion.beginTransaction();
    try {
      await conexion.execute(
        'INSERT INTO fixture_negocio_auditoria (valor) VALUES (?)',
        [valorNegocio]
      );
      const resultado = await servicioAuditoria.registrarEnTransaccion(
        { cambioEfectivo: true, intencion },
        { conexion: conexionAuditoria }
      );
      await conexion.commit();
      return {
        resultado,
        filasNegocio: await contarFilasNegocio(conexion),
        lecturasRelojAuditoria
      };
    } catch (error) {
      await conexion.rollback();
      if (!capturarError) throw error;
      return {
        error,
        filasNegocio: await contarFilasNegocio(conexion),
        lecturasRelojAuditoria
      };
    }
  } finally {
    conexion.release();
  }
}

async function contarFilasNegocio(conexion) {
  const [filas] = await conexion.execute(
    'SELECT COUNT(*) AS total FROM fixture_negocio_auditoria'
  );
  return Number(filas[0].total);
}

async function contarEventos(clienteSql) {
  const [fila] = await clienteSql.consultar(
    'SELECT COUNT(*) AS total FROM eventos_auditoria WHERE clave_cadena = ?',
    [claveCadena]
  );
  return Number(fila.total);
}

async function asegurarMigraciones(clienteSql) {
  const ejecutor = new EjecutorMigraciones({
    clienteSql,
    repositorioMigraciones: new RepositorioMigraciones(clienteSql),
    rutaMigraciones: obtenerRutaMigraciones()
  });
  await ejecutor.ejecutarPendientes();
}

function crearAltaMonitor({ sujetoId }) {
  return {
    eventoId: generarUuidV7Auditoria(),
    tipo: 'monitor.creado',
    versionContrato: 1,
    flujo: 'monitores',
    claveCadena,
    actorReal: { tipo: 'usuario', id: '1' },
    actorEfectivo: null,
    modoActuacion: 'directo',
    sujeto: { tipo: 'monitor', id: sujetoId },
    origen: 'web',
    scope: { tenantId, empresaId: null, sitioId: null },
    correlacionId: generarUuidV7Auditoria(),
    causalidad: null,
    productor: 'portal_web',
    claveOperacion: generarUuidV7Auditoria(),
    rolEvento: 'principal',
    efectivoEnUtc: new Date().toISOString(),
    versionCanonicalizador: PERFIL_JCS_AUDITORIA_V1,
    versionEncadenado: VERSION_ENCADENADO_AUDITORIA_V1,
    payload: {
      resultado: 'creado',
      antes: null,
      despues: { nombre: `Monitor ${sujetoId}`, tipo: 'ping', activo: true }
    }
  };
}

function verificarError(error, codigo, reintentable) {
  assert.equal(error instanceof ErrorRegistroAuditoria, true);
  assert.equal(error.codigo, codigo);
  assert.equal(error.reintentable, reintentable);
  return true;
}

function normalizarFechaSqlTexto(valor) {
  const coincidencia = String(valor).match(
    /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})\.(\d{3})\d{3}Z$/
  );
  assert.ok(coincidencia, `Fecha SQL no canónica: ${valor}`);
  return `${coincidencia[1]}.${coincidencia[2]}Z`;
}

async function limpiarPrueba(clienteSql) {
  const conexion = await clienteSql.obtenerConexion();
  try {
    await conexion.beginTransaction();
    const [eventos] = await conexion.execute(
      'SELECT evento_id FROM eventos_auditoria WHERE clave_cadena = ?',
      [claveCadena]
    );
    for (const { evento_id: eventoId } of eventos) {
      await conexion.execute(
        'DELETE FROM identidades_idempotentes_auditoria WHERE evento_id = ?',
        [eventoId]
      );
      await conexion.execute(
        'DELETE FROM eventos_auditoria WHERE evento_id = ?',
        [eventoId]
      );
      const huella = createHash('sha256')
        .update(Buffer.from('sentinelia-auditoria-evento-id-v1', 'utf8'))
        .update(Buffer.from([0]))
        .update(eventoId)
        .digest();
      await conexion.execute(
        'DELETE FROM tombstones_identidad_auditoria WHERE huella_evento_id = ?',
        [huella]
      );
    }
    await conexion.execute(
      'DELETE FROM cadenas_auditoria WHERE clave_cadena = ?',
      [claveCadena]
    );
    await conexion.commit();
  } catch (error) {
    await conexion.rollback();
    throw error;
  } finally {
    conexion.release();
  }
}

main().catch((error) => {
  console.error('[auditoria] Falló la verificación del registro síncrono.');
  console.error(error);
  process.exitCode = 1;
});

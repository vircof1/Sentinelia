import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
  CODIGOS_ERROR_REGISTRO_AUDITORIA,
  ErrorRegistroAuditoria
} from '../paquetes/auditoria/src/ErroresRegistroAuditoria.js';
import { PERFIL_JCS_AUDITORIA_V1 } from '../paquetes/auditoria/src/PerfilJcsAuditoria.js';
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

const baseTenant = BigInt(Date.now()) * 10_000n + BigInt(process.pid);
const tenantA = String(baseTenant + 1n);
const tenantB = String(baseTenant + 2n);
const clavesPrueba = new Set();

async function main() {
  await verificarContratoDeServicio();
  const configuracion = obtenerConfiguracionAplicacion();
  assert.equal(
    configuracion.sql.estaCompleta,
    true,
    'La verificación 5.21.5c requiere SQL local.'
  );
  const clienteSql = new ClienteSql(configuracion.sql);
  let errorPrincipal = null;
  try {
    await asegurarMigraciones(clienteSql);
    const servicioAuditoria = new ServicioAuditoriaOperativa({
      repositorioAuditoria: new RepositorioAuditoria(clienteSql)
    });
    await verificarConsecutividadYRepeticion(clienteSql, servicioAuditoria);
    await verificarRollbackSinMedioPar(clienteSql, servicioAuditoria);
    await verificarMulticadenaConcurrenteYScope(clienteSql, servicioAuditoria);
  } catch (error) {
    errorPrincipal = error;
  } finally {
    try {
      await limpiarPruebas(clienteSql);
    } catch (errorLimpieza) {
      if (!errorPrincipal) throw errorLimpieza;
      console.error('[auditoria] Error adicional limpiando movimientos de prueba');
      console.error(errorLimpieza);
    }
    await clienteSql.cerrar();
  }
  if (errorPrincipal) throw errorPrincipal;
  console.log(
    '[auditoria] OK 5.21.5c: par=atomico misma_cadena=consecutivo multicadena=ordenada rollback=sin_medio_par scope=historico'
  );
}

async function verificarContratoDeServicio() {
  const llamadas = [];
  const servicio = new ServicioAuditoriaOperativa({
    repositorioAuditoria: {
      async incorporarEnTransaccion(...argumentos) {
        llamadas.push(argumentos);
        throw new Error('No debe alcanzarse para una entrada inválida.');
      }
    }
  });
  const noOp = await servicio.registrarMovimientoEnTransaccion({
    cambioEfectivo: false,
    salida: null,
    entrada: null
  });
  assert.deepEqual(noOp, {
    estado: 'sin_cambios',
    salida: null,
    entrada: null,
    genesis: [],
    registradoEnUtc: null,
    esNoOp: true
  });
  assert.equal(llamadas.length, 0);

  const [salida, entrada] = crearMovimiento({
    tenantOrigen: tenantA,
    empresaOrigen: '101',
    tenantDestino: tenantA,
    empresaDestino: '102',
    sujetoId: '991000'
  });
  await assert.rejects(
    () => servicio.registrarMovimientoEnTransaccion({
      cambioEfectivo: true,
      salida: {
        ...salida,
        payload: {
          ...salida.payload,
          scopePropio: entrada.scope
        }
      },
      entrada
    }, { conexion: { execute() {} } }),
    (error) => verificarErrorEntrada(error)
  );
  await assert.rejects(
    () => servicio.registrarMovimientoEnTransaccion({
      cambioEfectivo: true,
      salida,
      entrada: {
        ...entrada,
        payload: {
          ...entrada.payload,
          impactoResumen: construirImpacto('1')
        }
      }
    }, { conexion: { execute() {} } }),
    (error) => verificarErrorEntrada(error)
  );
  assert.equal(llamadas.length, 0);
}

async function verificarConsecutividadYRepeticion(clienteSql, servicioAuditoria) {
  const movimiento = crearMovimiento({
    tenantOrigen: tenantA,
    empresaOrigen: '201',
    tenantDestino: tenantA,
    empresaDestino: '202',
    sujetoId: '991010'
  });
  const alta = await ejecutarMovimiento({
    clienteSql,
    servicioAuditoria,
    movimiento,
    valorNegocio: 'misma_cadena'
  });
  assert.equal(alta.resultado.estado, 'incorporado');
  assert.equal(alta.filasNegocio, 1);
  assert.equal(alta.resultado.salida.estado, 'incorporado');
  assert.equal(alta.resultado.entrada.estado, 'incorporado');
  assert.equal(
    BigInt(alta.resultado.entrada.secuencia),
    BigInt(alta.resultado.salida.secuencia) + 1n
  );
  assert.equal(alta.resultado.salida.claveCadena, alta.resultado.entrada.claveCadena);

  const filas = await buscarEventosMovimiento(clienteSql, movimiento);
  assert.deepEqual(filas.map(({ tipo_evento }) => tipo_evento), [
    'scope.entidad_salida',
    'scope.entidad_entrada'
  ]);
  assert.equal(filas[0].registrado_utc, filas[1].registrado_utc);
  assert.equal(
    filas[0].contraparte.toLowerCase(),
    uuidV7AuditoriaABytes(movimiento[1].eventoId).toString('hex')
  );
  assert.equal(
    filas[1].contraparte.toLowerCase(),
    uuidV7AuditoriaABytes(movimiento[0].eventoId).toString('hex')
  );

  const totalAntes = await contarEventosMovimiento(clienteSql, movimiento);
  const repeticion = await ejecutarMovimiento({
    clienteSql,
    servicioAuditoria,
    movimiento,
    valorNegocio: 'repeticion'
  });
  assert.equal(repeticion.resultado.estado, 'existente');
  assert.equal(repeticion.resultado.registradoEnUtc, null);
  assert.equal(await contarEventosMovimiento(clienteSql, movimiento), totalAntes);
}

async function verificarRollbackSinMedioPar(clienteSql, servicioAuditoria) {
  const movimiento = crearMovimiento({
    tenantOrigen: tenantA,
    empresaOrigen: '301',
    tenantDestino: tenantA,
    empresaDestino: '302',
    sujetoId: '991020'
  });
  const fallida = await ejecutarMovimiento({
    clienteSql,
    servicioAuditoria,
    movimiento,
    valorNegocio: 'debe_revertirse',
    fallarAlInsertarEntrada: true,
    capturarError: true
  });
  assert.equal(fallida.error instanceof ErrorRegistroAuditoria, true);
  assert.equal(
    fallida.error.codigo,
    CODIGOS_ERROR_REGISTRO_AUDITORIA.PERSISTENCIA_FALLIDA
  );
  assert.equal(fallida.filasNegocio, 0);
  assert.equal(await contarEventosMovimiento(clienteSql, movimiento), 0);
}

async function verificarMulticadenaConcurrenteYScope(clienteSql, servicioAuditoria) {
  await asegurarCadena(clienteSql, servicioAuditoria, tenantA, '991100');
  await asegurarCadena(clienteSql, servicioAuditoria, tenantB, '991101');
  const ida = crearMovimiento({
    tenantOrigen: tenantA,
    empresaOrigen: '401',
    tenantDestino: tenantB,
    empresaDestino: '402',
    sujetoId: '991030'
  });
  const vuelta = crearMovimiento({
    tenantOrigen: tenantB,
    empresaOrigen: '402',
    tenantDestino: tenantA,
    empresaDestino: '401',
    sujetoId: '991031'
  });
  const [resultadoIda, resultadoVuelta] = await Promise.all([
    ejecutarMovimiento({
      clienteSql,
      servicioAuditoria,
      movimiento: ida,
      valorNegocio: 'ida'
    }),
    ejecutarMovimiento({
      clienteSql,
      servicioAuditoria,
      movimiento: vuelta,
      valorNegocio: 'vuelta'
    })
  ]);
  for (const ejecucion of [resultadoIda, resultadoVuelta]) {
    assert.equal(ejecucion.resultado.estado, 'incorporado');
    assert.deepEqual(
      ejecucion.cabecerasBloqueadas,
      [...ejecucion.cabecerasBloqueadas].sort(compararUtf8)
    );
    assert.deepEqual(
      ejecucion.cabecerasBloqueadas,
      [`monitores:tenant:${tenantA}`, `monitores:tenant:${tenantB}`]
        .sort(compararUtf8)
    );
  }

  const visiblesOrigen = await consultarLadosVisibles(
    clienteSql,
    ida[0].correlacionId,
    tenantA
  );
  const visiblesDestino = await consultarLadosVisibles(
    clienteSql,
    ida[0].correlacionId,
    tenantB
  );
  assert.deepEqual(visiblesOrigen, [{
    tipo: 'scope.entidad_salida',
    direccion: 'salida',
    tenantId: tenantA
  }]);
  assert.deepEqual(visiblesDestino, [{
    tipo: 'scope.entidad_entrada',
    direccion: 'entrada',
    tenantId: tenantB
  }]);
}

async function ejecutarMovimiento(opciones) {
  for (let intento = 0; ; intento += 1) {
    try {
      return await ejecutarMovimientoUnaVez(opciones);
    } catch (error) {
      if (!error.reintentable || intento >= 5) throw error;
    }
  }
}

async function ejecutarMovimientoUnaVez({
  clienteSql,
  servicioAuditoria,
  movimiento,
  valorNegocio,
  fallarAlInsertarEntrada = false,
  capturarError = false
}) {
  movimiento.forEach(({ claveCadena }) => clavesPrueba.add(claveCadena));
  const conexion = await clienteSql.obtenerConexion();
  const cabecerasBloqueadas = [];
  const conexionAuditoria = {
    async execute(sql, parametros = []) {
      const sentencia = String(sql);
      if (
        sentencia.includes('FROM cadenas_auditoria') &&
        sentencia.includes('FOR UPDATE') &&
        !cabecerasBloqueadas.includes(parametros[0])
      ) {
        cabecerasBloqueadas.push(parametros[0]);
      }
      if (
        fallarAlInsertarEntrada &&
        sentencia.includes('INSERT INTO eventos_auditoria') &&
        parametros[2] === 'scope.entidad_entrada'
      ) {
        const error = new Error('fallo simulado al insertar la entrada');
        error.code = 'ER_FIXTURE_ENTRADA';
        throw error;
      }
      return conexion.execute(sql, parametros);
    }
  };
  try {
    await prepararTablaTemporal(conexion);
    await conexion.beginTransaction();
    try {
      await conexion.execute(
        'INSERT INTO fixture_negocio_movimiento (valor) VALUES (?)',
        [valorNegocio]
      );
      const resultado = await servicioAuditoria.registrarMovimientoEnTransaccion(
        {
          cambioEfectivo: true,
          salida: movimiento[0],
          entrada: movimiento[1]
        },
        { conexion: conexionAuditoria }
      );
      await conexion.commit();
      return {
        resultado,
        cabecerasBloqueadas,
        filasNegocio: await contarFilasNegocio(conexion)
      };
    } catch (error) {
      await conexion.rollback();
      if (!capturarError) throw error;
      return {
        error,
        cabecerasBloqueadas,
        filasNegocio: await contarFilasNegocio(conexion)
      };
    }
  } finally {
    conexion.release();
  }
}

async function asegurarCadena(clienteSql, servicioAuditoria, tenantId, sujetoId) {
  const claveCadena = `monitores:tenant:${tenantId}`;
  clavesPrueba.add(claveCadena);
  const conexion = await clienteSql.obtenerConexion();
  try {
    await conexion.beginTransaction();
    await servicioAuditoria.registrarEnTransaccion(
      {
        cambioEfectivo: true,
        intencion: crearAltaMonitor({ tenantId, sujetoId })
      },
      { conexion }
    );
    await conexion.commit();
  } catch (error) {
    await conexion.rollback();
    throw error;
  } finally {
    conexion.release();
  }
}

async function prepararTablaTemporal(conexion) {
  await conexion.execute(
    `CREATE TEMPORARY TABLE IF NOT EXISTS fixture_negocio_movimiento (
       valor VARCHAR(64) NOT NULL
     ) ENGINE=InnoDB`
  );
  await conexion.execute('TRUNCATE TABLE fixture_negocio_movimiento');
}

async function contarFilasNegocio(conexion) {
  const [filas] = await conexion.execute(
    'SELECT COUNT(*) AS total FROM fixture_negocio_movimiento'
  );
  return Number(filas[0].total);
}

async function buscarEventosMovimiento(clienteSql, movimiento) {
  return clienteSql.consultar(
    `SELECT
       tipo_evento,
       HEX(evento_contraparte_id) AS contraparte,
       DATE_FORMAT(registrado_en_utc, '%Y-%m-%dT%H:%i:%s.%fZ') AS registrado_utc
     FROM eventos_auditoria
     WHERE evento_id IN (?, ?)
     ORDER BY secuencia`,
    movimiento.map(({ eventoId }) => uuidV7AuditoriaABytes(eventoId))
  );
}

async function contarEventosMovimiento(clienteSql, movimiento) {
  const [fila] = await clienteSql.consultar(
    'SELECT COUNT(*) AS total FROM eventos_auditoria WHERE evento_id IN (?, ?)',
    movimiento.map(({ eventoId }) => uuidV7AuditoriaABytes(eventoId))
  );
  return Number(fila.total);
}

async function consultarLadosVisibles(clienteSql, correlacionId, tenantId) {
  const filas = await clienteSql.consultar(
    `SELECT tipo_evento, CAST(scope_tenant_id AS CHAR) AS scope_tenant_id,
            JSON_UNQUOTE(JSON_EXTRACT(payload, '$.direccion')) AS direccion
     FROM eventos_auditoria
     WHERE correlacion_id = ? AND scope_tenant_id = ?
     ORDER BY tipo_evento`,
    [uuidV7AuditoriaABytes(correlacionId), tenantId]
  );
  return filas.map((fila) => ({
    tipo: fila.tipo_evento,
    direccion: fila.direccion,
    tenantId: String(fila.scope_tenant_id)
  }));
}

function crearMovimiento({
  tenantOrigen,
  empresaOrigen,
  tenantDestino,
  empresaDestino,
  sujetoId
}) {
  const salidaId = generarUuidV7Auditoria();
  const entradaId = generarUuidV7Auditoria();
  const correlacionId = generarUuidV7Auditoria();
  const claveOperacion = generarUuidV7Auditoria();
  const efectivoEnUtc = new Date().toISOString();
  const comun = {
    versionContrato: 1,
    flujo: 'monitores',
    actorReal: { tipo: 'usuario', id: '1' },
    actorEfectivo: null,
    modoActuacion: 'directo',
    sujeto: { tipo: 'monitor', id: sujetoId },
    origen: 'web',
    correlacionId,
    causalidad: null,
    productor: 'portal_web',
    claveOperacion,
    efectivoEnUtc,
    versionCanonicalizador: PERFIL_JCS_AUDITORIA_V1,
    versionEncadenado: VERSION_ENCADENADO_AUDITORIA_V1
  };
  const scopeSalida = {
    tenantId: tenantOrigen,
    empresaId: empresaOrigen,
    sitioId: null
  };
  const scopeEntrada = {
    tenantId: tenantDestino,
    empresaId: empresaDestino,
    sitioId: null
  };
  return [
    {
      ...comun,
      eventoId: salidaId,
      tipo: 'scope.entidad_salida',
      claveCadena: `monitores:tenant:${tenantOrigen}`,
      scope: scopeSalida,
      rolEvento: 'salida',
      payload: {
        direccion: 'salida',
        scopePropio: scopeSalida,
        eventoContraparteId: entradaId,
        impactoResumen: null
      }
    },
    {
      ...comun,
      eventoId: entradaId,
      tipo: 'scope.entidad_entrada',
      claveCadena: `monitores:tenant:${tenantDestino}`,
      scope: scopeEntrada,
      rolEvento: 'entrada',
      payload: {
        direccion: 'entrada',
        scopePropio: scopeEntrada,
        eventoContraparteId: salidaId,
        impactoResumen: null
      }
    }
  ];
}

function crearAltaMonitor({ tenantId, sujetoId }) {
  return {
    eventoId: generarUuidV7Auditoria(),
    tipo: 'monitor.creado',
    versionContrato: 1,
    flujo: 'monitores',
    claveCadena: `monitores:tenant:${tenantId}`,
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

function construirImpacto(total) {
  return {
    filasVivasActualizadasPorClase: { monitores: total },
    referenciasHistoricasActualizadasPorClase: {},
    descendientesPorClase: {}
  };
}

function verificarErrorEntrada(error) {
  assert.equal(error instanceof ErrorRegistroAuditoria, true);
  assert.equal(
    error.codigo,
    CODIGOS_ERROR_REGISTRO_AUDITORIA.ENTRADA_INVALIDA
  );
  return true;
}

function compararUtf8(a, b) {
  return Buffer.compare(Buffer.from(a, 'utf8'), Buffer.from(b, 'utf8'));
}

async function asegurarMigraciones(clienteSql) {
  const ejecutor = new EjecutorMigraciones({
    clienteSql,
    repositorioMigraciones: new RepositorioMigraciones(clienteSql),
    rutaMigraciones: obtenerRutaMigraciones()
  });
  await ejecutor.ejecutarPendientes();
}

async function limpiarPruebas(clienteSql) {
  if (clavesPrueba.size === 0) return;
  const claves = [...clavesPrueba];
  const conexion = await clienteSql.obtenerConexion();
  try {
    await conexion.beginTransaction();
    const [eventos] = await conexion.execute(
      `SELECT evento_id FROM eventos_auditoria
       WHERE clave_cadena IN (${claves.map(() => '?').join(', ')})`,
      claves
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
      `DELETE FROM cadenas_auditoria
       WHERE clave_cadena IN (${claves.map(() => '?').join(', ')})`,
      claves
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
  console.error('[auditoria] Falló la verificación de movimientos atómicos.');
  console.error(error);
  process.exitCode = 1;
});

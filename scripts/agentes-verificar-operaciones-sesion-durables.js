import assert from 'node:assert/strict';
import { setTimeout as esperar } from 'node:timers/promises';
import { generarUuidV7Auditoria } from '../paquetes/auditoria/src/UuidV7Auditoria.js';
import {
  calcularDigestRequestIdSesionAgenteHex
} from '../paquetes/agentes/src/IdentidadRequestSesionAgente.js';
import {
  ConflictoRequestSesionAgente,
  RepositorioOperacionesSesionAgentes
} from '../paquetes/agentes/src/RepositorioOperacionesSesionAgentes.js';
import { ClienteSql } from '../paquetes/persistencia-sql/src/ClienteSql.js';
import { EjecutorMigraciones } from '../paquetes/persistencia-sql/src/EjecutorMigraciones.js';
import { RepositorioMigraciones } from '../paquetes/persistencia-sql/src/RepositorioMigraciones.js';
import {
  obtenerConfiguracionAplicacion,
  obtenerRutaMigraciones
} from '../paquetes/utilidades/src/configuracion/obtenerConfiguracionAplicacion.js';

const sufijo = `${Date.now()}-${process.pid}`;
const creados = {
  tenantId: null,
  empresaId: null,
  sitioId: null,
  agenteId: null,
  operaciones: new Set(),
  digests: new Set()
};

async function main() {
  const configuracion = obtenerConfiguracionAplicacion();
  assert.equal(configuracion.sql.estaCompleta, true, 'La verificación de sesiones requiere SQL.');
  const clienteSql = new ClienteSql(configuracion.sql);
  const repositorio = new RepositorioOperacionesSesionAgentes(clienteSql);
  let errorPrincipal = null;
  try {
    await asegurarMigraciones(clienteSql);
    await limpiarRestosPruebas(clienteSql);
    await verificarEsquema(clienteSql);
    verificarVectorDigest();
    const agente = await crearAgentePrueba(clienteSql);
    await verificarRequestIdsYFencing(clienteSql, repositorio, agente);
    await verificarLeaseYRecuperacion(repositorio);
    const invalidacion = await verificarInvalidacionIdempotente(clienteSql, repositorio, agente);
    await verificarContadoresConcurrentes(clienteSql, repositorio, agente);
    await verificarTerminalidadCompactacionYBorrado(
      clienteSql,
      repositorio,
      agente,
      invalidacion
    );
  } catch (error) {
    errorPrincipal = error;
  } finally {
    try {
      await limpiarPruebas(clienteSql);
    } catch (errorLimpieza) {
      if (!errorPrincipal) throw errorLimpieza;
      console.error('[agentes] Error adicional limpiando la verificación de sesiones');
      console.error(errorLimpieza);
    }
    await clienteSql.cerrar();
  }
  if (errorPrincipal) throw errorPrincipal;
  console.log('[agentes] OK: operaciones=durables request_ids=globales tombstones=opacos fencing=monotonico invalidacion=idempotente');
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

async function verificarEsquema(clienteSql) {
  const columnas = await clienteSql.consultar(
    `SELECT TABLE_NAME AS tabla, COLUMN_NAME AS columna
     FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE()
       AND TABLE_NAME IN (
         'operaciones_sesion_agentes',
         'identidades_request_id_sesion_agentes',
         'reservas_request_id_sesion_agentes'
       )`
  );
  const nombres = columnas.map(({ columna }) => columna);
  for (const prohibida of ['bearer', 'session_token', 'token_hash', 'secreto', 'password', 'sobre_cifrado']) {
    assert.equal(
      nombres.some((nombre) => nombre.includes(prohibida)),
      false,
      `SQL no debe contener material de validación: ${prohibida}.`
    );
  }
  const foraneas = await clienteSql.consultar(
    `SELECT CONSTRAINT_NAME
     FROM information_schema.REFERENTIAL_CONSTRAINTS
     WHERE CONSTRAINT_SCHEMA = DATABASE()
       AND TABLE_NAME IN (
         'operaciones_sesion_agentes',
         'cabeceras_coordinacion_sesion_agentes',
         'identidades_request_id_sesion_agentes',
         'reservas_request_id_sesion_agentes'
       )`
  );
  assert.equal(foraneas.length, 0, 'Las identidades técnicas no admiten FK destructivas.');
  const reserva = columnas.filter(({ tabla }) => tabla === 'reservas_request_id_sesion_agentes');
  assert.deepEqual(
    reserva.map(({ columna }) => columna),
    ['digest_request_id'],
    'El tombstone permanente solo conserva el digest opaco.'
  );
}

function verificarVectorDigest() {
  assert.equal(
    calcularDigestRequestIdSesionAgenteHex('018f22f2-7e14-7b15-8c35-8f665f98340a'),
    'a85f39332d5e7e3293ca5a961027b032253a2702a7fc8b1cb52da4a7729870f9'
  );
}

async function crearAgentePrueba(clienteSql) {
  const alias = `op-sesion-${sufijo}`.slice(0, 120);
  const [tenant] = await clienteSql.ejecutar(
    'INSERT INTO tenants (nombre, alias) VALUES (?, ?)',
    [`Tenant operación ${sufijo}`, alias]
  );
  creados.tenantId = String(tenant.insertId);
  const [empresa] = await clienteSql.ejecutar(
    'INSERT INTO empresas (tenant_id, nombre, alias) VALUES (?, ?, ?)',
    [creados.tenantId, `Empresa operación ${sufijo}`, alias]
  );
  creados.empresaId = String(empresa.insertId);
  const [sitio] = await clienteSql.ejecutar(
    'INSERT INTO sitios (tenant_id, empresa_id, nombre, alias) VALUES (?, ?, ?, ?)',
    [creados.tenantId, creados.empresaId, `Sitio operación ${sufijo}`, alias]
  );
  creados.sitioId = String(sitio.insertId);
  const [agente] = await clienteSql.ejecutar(
    `INSERT INTO agentes_sentinelia (
       guid, tenant_id, empresa_id, sitio_id, nombre, secreto_hash
     ) VALUES (?, ?, ?, ?, ?, ?)`,
    [
      generarUuidV7Auditoria(),
      creados.tenantId,
      creados.empresaId,
      creados.sitioId,
      `Agente operación ${sufijo}`,
      'hash-no-utilizable'
    ]
  );
  creados.agenteId = String(agente.insertId);
  return {
    id: creados.agenteId,
    scope: {
      tenantId: creados.tenantId,
      empresaId: creados.empresaId,
      sitioId: creados.sitioId
    }
  };
}

async function verificarRequestIdsYFencing(clienteSql, repositorio, agente) {
  const loginRequestId = registrarDigest(generarUuidV7Auditoria());
  const sesionAuditoriaId = generarUuidV7Auditoria();
  const operacionId = registrarOperacion(generarUuidV7Auditoria());
  const entrada = datosBase(agente, {
    tipo: 'login',
    operacionId,
    sesionAuditoriaId,
    loginRequestId,
    huellaIntencion: '11'.repeat(32)
  });
  const alta = await repositorio.reservarRequestAtomica(entrada, { ventanaSegundos: 1 });
  assert.equal(alta.repetida, false);
  assert.equal(alta.tipo, 'login');
  assert.equal(alta.loginRequestId, loginRequestId);
  assert.equal(alta.refreshRequestId, null);
  assert.equal(alta.fencingToken, '1');

  const repetida = await repositorio.reservarRequestAtomica({
    ...entrada,
    operacionId: generarUuidV7Auditoria()
  });
  assert.equal(repetida.repetida, true);
  assert.equal(repetida.operacionId, operacionId);
  assert.equal(repetida.fencingToken, '1', 'Repetir la intención no consume otro fencing.');

  await assert.rejects(
    () => repositorio.reservarRequestAtomica({
      ...entrada,
      operacionId: generarUuidV7Auditoria(),
      huellaIntencion: '22'.repeat(32)
    }),
    ConflictoRequestSesionAgente
  );
  await assert.rejects(
    () => repositorio.reservarRequestAtomica(datosBase(agente, {
      tipo: 'refresh',
      operacionId: generarUuidV7Auditoria(),
      sesionAuditoriaId,
      refreshRequestId: loginRequestId,
      huellaIntencion: '11'.repeat(32)
    })),
    ConflictoRequestSesionAgente,
    'Login y refresh comparten un único namespace de request ids.'
  );

  const [identidad] = await clienteSql.consultar(
    `SELECT
       DATE_FORMAT(primera_observacion_utc, '%Y-%m-%d %H:%i:%s.%f') AS primera,
       DATE_FORMAT(expira_en_utc, '%Y-%m-%d %H:%i:%s.%f') AS expira
     FROM identidades_request_id_sesion_agentes
     WHERE digest_request_id = UNHEX(?)`,
    [calcularDigestRequestIdSesionAgenteHex(loginRequestId)]
  );
  assert.ok(identidad.primera < identidad.expira);
}

async function verificarInvalidacionIdempotente(clienteSql, repositorio, agente) {
  const operacionId = registrarOperacion(generarUuidV7Auditoria());
  const causaOperacionId = generarUuidV7Auditoria();
  const sesionAuditoriaId = generarUuidV7Auditoria();
  const entrada = datosBase(agente, {
    operacionId,
    sesionAuditoriaId,
    causaOperacionId,
    huellaIntencion: '33'.repeat(32),
    actor: { tipo: 'usuario', id: 'usuario-real-prueba' },
    actorEfectivo: { tipo: 'usuario', id: 'usuario-efectivo-prueba' }
  });
  const primera = await enTransaccion(clienteSql, (conexion) =>
    repositorio.crearInvalidacionEnTransaccion(entrada, { conexion })
  );
  assert.equal(primera.repetida, false);
  assert.equal(primera.tipo, 'invalidacion');
  assert.equal(primera.loginRequestId, null);
  assert.equal(primera.refreshRequestId, null);
  assert.equal(primera.modoActuacion, 'impersonado');
  assert.deepEqual(
    primera.actorEfectivo,
    { tipo: 'usuario', id: 'usuario-efectivo-prueba' }
  );

  const repetida = await enTransaccion(clienteSql, (conexion) =>
    repositorio.crearInvalidacionEnTransaccion({
      ...entrada,
      operacionId: generarUuidV7Auditoria()
    }, { conexion })
  );
  assert.equal(repetida.operacionId, operacionId);
  assert.equal(repetida.versionAutorizacionObservada, primera.versionAutorizacionObservada);
  assert.equal(repetida.fencingToken, primera.fencingToken);

  await assert.rejects(
    () => clienteSql.ejecutar(
      `INSERT INTO operaciones_sesion_agentes (
         operacion_id, tipo, agente_id, sesion_auditoria_id,
         huella_intencion, version_scope_observada,
         version_autorizacion_observada, fencing_token,
         actor_tipo, actor_id, origen, estado,
         proximo_intento_utc, creada_en_utc, actualizada_en_utc
       ) VALUES (
         UNHEX(REPLACE(?, '-', '')), 'invalidacion', ?, UNHEX(REPLACE(?, '-', '')),
         UNHEX(?), 1, 1, 1, 'sistema', 'prueba', 'runtime', 'pendiente',
         UTC_TIMESTAMP(3), UTC_TIMESTAMP(3), UTC_TIMESTAMP(3)
       )`,
      [generarUuidV7Auditoria(), agente.id, generarUuidV7Auditoria(), '44'.repeat(32)]
    ),
    /constraint.*failed|chk_operaciones_sesion_identidad_tipo/i
  );
  return entrada;
}

async function verificarLeaseYRecuperacion(repositorio) {
  const primerLease = await repositorio.reclamarSiguienteAtomica({
    instanciaId: 'worker-prueba-a',
    leaseSegundos: 30
  });
  assert.ok(primerLease);
  assert.equal(primerLease.estado, 'pendiente');
  assert.equal(primerLease.tipo, 'login');
  await assert.rejects(
    () => repositorio.avanzarConLeaseAtomica({
      operacionId: primerLease.operacionId,
      instanciaId: 'worker-prueba-a',
      leaseToken: 'ff'.repeat(32),
      estado: 'redis_preparada'
    }),
    /lease ya no autoriza/i
  );
  const preparada = await repositorio.avanzarConLeaseAtomica({
    operacionId: primerLease.operacionId,
    instanciaId: 'worker-prueba-a',
    leaseToken: primerLease.leaseToken,
    estado: 'redis_preparada'
  });
  assert.equal(preparada.estado, 'redis_preparada');

  const segundoLease = await repositorio.reclamarSiguienteAtomica({
    instanciaId: 'worker-prueba-b',
    leaseSegundos: 30
  });
  assert.equal(segundoLease.operacionId, primerLease.operacionId);
  const pendienteRespuesta = await repositorio.avanzarConLeaseAtomica({
    operacionId: segundoLease.operacionId,
    instanciaId: 'worker-prueba-b',
    leaseToken: segundoLease.leaseToken,
    estado: 'respuesta_pendiente',
    replayCifradoDisponible: true,
    keyId: 'clave-prueba-no-secreta'
  });
  assert.equal(pendienteRespuesta.replayCifradoDisponible, true);
  assert.equal(pendienteRespuesta.keyId, 'clave-prueba-no-secreta');

  const tercerLease = await repositorio.reclamarSiguienteAtomica({
    instanciaId: 'worker-prueba-c',
    leaseSegundos: 30
  });
  const consolidada = await repositorio.avanzarConLeaseAtomica({
    operacionId: tercerLease.operacionId,
    instanciaId: 'worker-prueba-c',
    leaseToken: tercerLease.leaseToken,
    estado: 'consolidada'
  });
  assert.equal(consolidada.estado, 'consolidada');
  assert.equal(consolidada.replayCifradoDisponible, false);
  assert.equal(consolidada.keyId, null);
}

async function verificarContadoresConcurrentes(clienteSql, repositorio, agente) {
  const resultados = await Promise.all(
    Array.from({ length: 4 }, () =>
      enTransaccion(clienteSql, (conexion) =>
        repositorio.incrementarScopeYFencingEnTransaccion(agente.id, { conexion })
      )
    )
  );
  const versiones = resultados.map(({ versionScopeAgente }) => BigInt(versionScopeAgente));
  assert.equal(new Set(versiones.map(String)).size, 4);
  for (let indice = 1; indice < versiones.sort(compararBigInt).length; indice += 1) {
    assert.equal(versiones[indice], versiones[indice - 1] + 1n);
  }
  await assert.rejects(
    () => clienteSql.ejecutar(
      'UPDATE cabeceras_coordinacion_sesion_agentes SET fencing_token = 0 WHERE agente_id = ?',
      [agente.id]
    ),
    /fencing.*no puede retroceder/i
  );
  await assert.rejects(
    () => clienteSql.ejecutar(
      'UPDATE agentes_sentinelia SET version_scope_agente = 1 WHERE id = ?',
      [agente.id]
    ),
    /versiones.*no pueden retroceder/i
  );
}

async function verificarTerminalidadCompactacionYBorrado(
  clienteSql,
  repositorio,
  agente,
  invalidacion
) {
  const [identidad] = await clienteSql.consultar(
    `SELECT LOWER(CONCAT(
       SUBSTR(HEX(request_id), 1, 8), '-', SUBSTR(HEX(request_id), 9, 4), '-',
       SUBSTR(HEX(request_id), 13, 4), '-', SUBSTR(HEX(request_id), 17, 4), '-',
       SUBSTR(HEX(request_id), 21)
     )) AS request_id,
     LOWER(CONCAT(
       SUBSTR(HEX(operacion_id), 1, 8), '-', SUBSTR(HEX(operacion_id), 9, 4), '-',
       SUBSTR(HEX(operacion_id), 13, 4), '-', SUBSTR(HEX(operacion_id), 17, 4), '-',
       SUBSTR(HEX(operacion_id), 21)
     )) AS operacion_id
     FROM identidades_request_id_sesion_agentes
     WHERE agente_id = ?
     ORDER BY primera_observacion_utc DESC, digest_request_id DESC
     LIMIT 1`,
    [agente.id]
  );
  await esperar(1100);
  const compactada = await enTransaccion(clienteSql, (conexion) =>
    repositorio.compactarRequestEnTransaccion(identidad.request_id, { conexion })
  );
  assert.equal(compactada.compactada, true);
  creados.operaciones.delete(identidad.operacion_id);
  await assert.rejects(
    () => repositorio.reservarRequestAtomica(datosBase(agente, {
      tipo: 'login',
      operacionId: generarUuidV7Auditoria(),
      sesionAuditoriaId: generarUuidV7Auditoria(),
      loginRequestId: identidad.request_id,
      huellaIntencion: '11'.repeat(32)
    })),
    (error) => error?.codigo === 'RESPUESTA_SESION_NO_RECUPERABLE'
  );

  const operacionesAntes = await clienteSql.consultar(
    'SELECT COUNT(*) AS total FROM operaciones_sesion_agentes WHERE agente_id = ?',
    [agente.id]
  );
  await clienteSql.ejecutar('DELETE FROM agentes_sentinelia WHERE id = ?', [agente.id]);
  creados.agenteId = null;
  const operacionesDespues = await clienteSql.consultar(
    'SELECT COUNT(*) AS total FROM operaciones_sesion_agentes WHERE agente_id = ?',
    [agente.id]
  );
  const cabeceras = await clienteSql.consultar(
    'SELECT COUNT(*) AS total FROM cabeceras_coordinacion_sesion_agentes WHERE agente_id = ?',
    [agente.id]
  );
  assert.equal(Number(operacionesDespues[0].total), Number(operacionesAntes[0].total));
  assert.equal(Number(cabeceras[0].total), 1, 'Eliminar el agente no destruye su coordinación pendiente.');
  const recuperada = await enTransaccion(clienteSql, (conexion) =>
    repositorio.crearInvalidacionEnTransaccion(
      { ...invalidacion, operacionId: generarUuidV7Auditoria() },
      { conexion }
    )
  );
  assert.equal(recuperada.repetida, true);
  assert.equal(recuperada.operacionId, invalidacion.operacionId);
}

function datosBase(agente, datos) {
  return {
    agenteId: agente.id,
    actor: { tipo: 'sistema', id: 'prueba-5.21.4f' },
    origen: 'runtime',
    scope: agente.scope,
    ...datos
  };
}

function registrarOperacion(id) {
  creados.operaciones.add(id);
  return id;
}

function registrarDigest(requestId) {
  creados.digests.add(calcularDigestRequestIdSesionAgenteHex(requestId));
  return requestId;
}

async function enTransaccion(clienteSql, trabajo) {
  const conexion = await clienteSql.obtenerConexion();
  try {
    await conexion.beginTransaction();
    const resultado = await trabajo(conexion);
    await conexion.commit();
    return resultado;
  } catch (error) {
    await rollbackSeguro(conexion);
    throw error;
  } finally {
    conexion.release();
  }
}

async function limpiarPruebas(clienteSql) {
  await limpiarRestosPruebas(clienteSql);
  for (const digest of creados.digests) {
    await clienteSql.ejecutar(
      'DELETE FROM identidades_request_id_sesion_agentes WHERE digest_request_id = UNHEX(?)',
      [digest]
    );
    await clienteSql.ejecutar(
      'DELETE FROM reservas_request_id_sesion_agentes WHERE digest_request_id = UNHEX(?)',
      [digest]
    );
  }
  if (creados.tenantId) {
    await clienteSql.ejecutar('DELETE FROM tenants WHERE id = ?', [creados.tenantId]);
  }
}

async function limpiarRestosPruebas(clienteSql) {
  const operaciones = await clienteSql.consultar(
    `SELECT operacion_id, CAST(agente_id AS CHAR) AS agente_id
     FROM operaciones_sesion_agentes
     WHERE actor_id IN ('prueba-5.21.4f', 'usuario-real-prueba')`
  );
  const idsAgente = [...new Set(operaciones.map(({ agente_id }) => agente_id))];
  await clienteSql.ejecutar(
    `DELETE FROM identidades_request_id_sesion_agentes
     WHERE operacion_id IN (
       SELECT operacion_id FROM operaciones_sesion_agentes
       WHERE actor_id IN ('prueba-5.21.4f', 'usuario-real-prueba')
     )`
  );
  await clienteSql.ejecutar(
    `UPDATE operaciones_sesion_agentes
     SET estado = CASE
           WHEN estado = 'pendiente' THEN 'fallida'
           ELSE 'reemplazada'
         END,
         replay_cifrado_disponible = FALSE,
         key_id = NULL,
         instancia_id = NULL,
         lease_token = NULL,
         lease_expira_utc = NULL,
         terminada_en_utc = UTC_TIMESTAMP(3),
         actualizada_en_utc = UTC_TIMESTAMP(3),
         ultimo_codigo_error = 'limpieza_prueba',
         ultimo_mensaje_error = 'Limpieza de fixture'
     WHERE actor_id IN ('prueba-5.21.4f', 'usuario-real-prueba')
       AND estado IN ('pendiente', 'redis_preparada', 'respuesta_pendiente')`
  );
  await clienteSql.ejecutar(
    `DELETE FROM operaciones_sesion_agentes
     WHERE actor_id IN ('prueba-5.21.4f', 'usuario-real-prueba')`
  );
  for (const id of idsAgente) {
    await clienteSql.ejecutar(
      'DELETE FROM cabeceras_coordinacion_sesion_agentes WHERE agente_id = ?',
      [id]
    );
    await clienteSql.ejecutar('DELETE FROM agentes_sentinelia WHERE id = ?', [id]);
  }
}

function compararBigInt(a, b) {
  return a < b ? -1 : a > b ? 1 : 0;
}

async function rollbackSeguro(conexion) {
  try {
    await conexion.rollback();
  } catch {
    // La excepción original conserva prioridad.
  }
}

main().catch((error) => {
  console.error('[agentes] Falló la verificación de operaciones de sesión durables');
  console.error(error);
  process.exitCode = 1;
});

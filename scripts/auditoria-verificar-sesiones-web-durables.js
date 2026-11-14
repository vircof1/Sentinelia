import assert from 'node:assert/strict';
import { generarUuidV7Auditoria } from '../paquetes/auditoria/src/UuidV7Auditoria.js';
import { ClienteSql } from '../paquetes/persistencia-sql/src/ClienteSql.js';
import { EjecutorMigraciones } from '../paquetes/persistencia-sql/src/EjecutorMigraciones.js';
import { RepositorioMigraciones } from '../paquetes/persistencia-sql/src/RepositorioMigraciones.js';
import {
  RepositorioSesionesWebAuditoria,
  TransicionSesionWebNoPermitida
} from '../paquetes/sesiones/src/RepositorioSesionesWebAuditoria.js';
import {
  obtenerConfiguracionAplicacion,
  obtenerRutaMigraciones
} from '../paquetes/utilidades/src/configuracion/obtenerConfiguracionAplicacion.js';

const sufijo = `${Date.now()}-${process.pid}`;
const nombresUsuario = [
  `sesion-real-${sufijo}`,
  `sesion-efectivo-${sufijo}`
];
const sesionesPrueba = new Set();

async function main() {
  const configuracion = obtenerConfiguracionAplicacion();
  assert.equal(configuracion.sql.estaCompleta, true, 'La verificación 5.21.4e requiere SQL local.');
  const clienteSql = new ClienteSql(configuracion.sql);
  const repositorio = new RepositorioSesionesWebAuditoria(clienteSql);
  let errorPrincipal = null;
  try {
    await asegurarMigraciones(clienteSql);
    await verificarEsquema(clienteSql);
    const usuarios = await crearUsuariosPrueba(clienteSql);
    await verificarSesionDirecta(clienteSql, repositorio, usuarios);
    await verificarImpersonacionYTerminalidad(clienteSql, repositorio, usuarios);
    await verificarExpiracionBorradoYLimpieza(clienteSql, repositorio, usuarios);
  } catch (error) {
    errorPrincipal = error;
  } finally {
    try {
      await limpiarPruebas(clienteSql);
    } catch (errorLimpieza) {
      if (!errorPrincipal) throw errorLimpieza;
      console.error('[auditoria] Error adicional limpiando sesiones web de prueba');
      console.error(errorLimpieza);
    }
    await clienteSql.cerrar();
  }
  if (errorPrincipal) throw errorPrincipal;
  console.log('[auditoria] OK 5.21.4e: autoridad=sql scopes=apertura_inmutable impersonacion=persistente usuarios=sin_fk expiracion=probada limpieza=tecnica');
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
    `SELECT COLUMN_NAME AS nombre
     FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'sesiones_web_auditoria'`
  );
  const nombres = columnas.map(({ nombre }) => nombre);
  assert.equal(nombres.includes('sesion_auditoria_id'), true);
  assert.equal(nombres.includes('usuario_real_id'), true);
  assert.equal(nombres.includes('usuario_efectivo_id'), true);
  assert.equal(nombres.includes('evento_impersonacion_iniciada_id'), true);
  assert.equal(
    nombres.some((nombre) => /(?:store|cookie|token|firma|secret|hash|redis|session_id)/i.test(nombre)),
    false,
    'El registro durable no debe contener credenciales ni ids de la proyección.'
  );
  const foraneas = await clienteSql.consultar(
    `SELECT CONSTRAINT_NAME
     FROM information_schema.REFERENTIAL_CONSTRAINTS
     WHERE CONSTRAINT_SCHEMA = DATABASE() AND TABLE_NAME = 'sesiones_web_auditoria'`
  );
  assert.equal(foraneas.length, 0, 'La fotografía durable no debe depender de usuarios ni eventos mediante FK.');

}

async function crearUsuariosPrueba(clienteSql) {
  const ids = [];
  for (const nombre of nombresUsuario) {
    const [resultado] = await clienteSql.ejecutar(
      'INSERT INTO usuarios (usuario, email, hash_password) VALUES (?, ?, ?)',
      [nombre, `${nombre}@example.invalid`, 'hash-no-utilizable']
    );
    ids.push(String(resultado.insertId));
  }
  return { real: ids[0], efectivo: ids[1] };
}

async function verificarSesionDirecta(clienteSql, repositorio, usuarios) {
  const sesionAuditoriaId = registrarSesion(generarUuidV7Auditoria());
  const datos = {
    sesionAuditoriaId,
    usuarioRealId: usuarios.real,
    usuarioEfectivoId: usuarios.real,
    versionSesionReal: 1,
    versionSesionEfectiva: 1,
    scopeApertura: scopePortal(),
    scopeEfectivoActual: scopePortal()
  };
  const abierta = await repositorio.abrirAtomica(datos, { ttlSegundos: 300 });
  assert.equal(abierta.estado, 'abierta');
  assert.equal(abierta.usuarioRealId, usuarios.real);
  assert.deepEqual(abierta.scopeApertura, scopePortal());
  assert.deepEqual(abierta.scopeEfectivoActual, scopePortal());
  assert.equal(abierta.eventoImpersonacionIniciadaId, null);

  await assert.rejects(
    () => repositorio.abrirAtomica(datos),
    TransicionSesionWebNoPermitida
  );
  await assert.rejects(
    () => repositorio.abrirAtomica({
      ...datos,
      sesionAuditoriaId: registrarSesion(generarUuidV7Auditoria()),
      usuarioEfectivoId: usuarios.efectivo
    }),
    /actuación directa/i
  );
  await assert.rejects(
    () => repositorio.abrirAtomica({
      ...datos,
      sesionAuditoriaId: registrarSesion(generarUuidV7Auditoria()),
      scopeApertura: { tenantId: null, empresaId: '2', sitioId: null },
      scopeEfectivoActual: { tenantId: null, empresaId: '2', sitioId: null }
    }),
    /no respeta la jerarquía/i
  );

  const renovada = await enTransaccion(clienteSql, (conexion) =>
    repositorio.renovarEnTransaccion(sesionAuditoriaId, {
      conexion,
      ttlSegundos: 600
    })
  );
  assert.equal(Date.parse(renovada.expiraEnUtc) > Date.parse(abierta.expiraEnUtc), true);
  assert.equal(renovada.estado, 'abierta');
  assert.equal(renovada.eventoImpersonacionIniciadaId, null);

  await assert.rejects(
    () => clienteSql.ejecutar(
      'UPDATE sesiones_web_auditoria SET apertura_tenant_id = 1 WHERE sesion_auditoria_id = UNHEX(REPLACE(?, \'-\', \'\'))',
      [sesionAuditoriaId]
    ),
    /scope de apertura.*inmutables/i
  );
}

async function verificarImpersonacionYTerminalidad(clienteSql, repositorio, usuarios) {
  const [directa] = await clienteSql.consultar(
    `SELECT LOWER(CONCAT(
       SUBSTR(HEX(sesion_auditoria_id), 1, 8), '-',
       SUBSTR(HEX(sesion_auditoria_id), 9, 4), '-',
       SUBSTR(HEX(sesion_auditoria_id), 13, 4), '-',
       SUBSTR(HEX(sesion_auditoria_id), 17, 4), '-',
       SUBSTR(HEX(sesion_auditoria_id), 21)
     )) AS id
     FROM sesiones_web_auditoria
     WHERE usuario_real_id = ? AND estado = 'abierta'
     ORDER BY creada_en_utc LIMIT 1`,
    [usuarios.real]
  );
  const eventoImpersonacion = generarUuidV7Auditoria();
  await assert.rejects(
    () => clienteSql.ejecutar(
      `UPDATE sesiones_web_auditoria
       SET usuario_efectivo_id = ?
       WHERE sesion_auditoria_id = UNHEX(REPLACE(?, '-', ''))`,
      [usuarios.efectivo, directa.id]
    ),
    /constraint.*failed|chk_sesiones_web_/i
  );
  const impersonada = await enTransaccion(clienteSql, (conexion) =>
    repositorio.iniciarImpersonacionEnTransaccion({
      sesionAuditoriaId: directa.id,
      usuarioEfectivoId: usuarios.efectivo,
      versionSesionReal: 2,
      versionSesionEfectiva: 3,
      scopeEfectivoActual: { tenantId: '9001', empresaId: null, sitioId: null },
      eventoImpersonacionIniciadaId: eventoImpersonacion
    }, { conexion })
  );
  assert.equal(impersonada.usuarioRealId, usuarios.real);
  assert.equal(impersonada.usuarioEfectivoId, usuarios.efectivo);
  assert.deepEqual(impersonada.scopeApertura, scopePortal());
  assert.deepEqual(
    impersonada.scopeEfectivoActual,
    { tenantId: '9001', empresaId: null, sitioId: null }
  );
  assert.equal(impersonada.eventoImpersonacionIniciadaId, eventoImpersonacion);

  const conexion = await clienteSql.obtenerConexion();
  try {
    await conexion.beginTransaction();
    const real = await repositorio.bloquearVigentesPorUsuarios([usuarios.real], { conexion });
    const efectivo = await repositorio.bloquearVigentesPorUsuarios([usuarios.efectivo], { conexion });
    const ambos = await repositorio.bloquearVigentesPorUsuarios(
      [usuarios.real, usuarios.efectivo],
      { conexion }
    );
    assert.equal(real.length, 1);
    assert.equal(efectivo.length, 1);
    assert.equal(ambos.length, 1, 'Una sesión donde coinciden ambos filtros se cuenta una sola vez.');
    await conexion.rollback();
  } finally {
    await rollbackSeguro(conexion);
    conexion.release();
  }

  const finalizada = await enTransaccion(clienteSql, (conexion) =>
    repositorio.finalizarImpersonacionEnTransaccion({
      sesionAuditoriaId: directa.id,
      eventoImpersonacionIniciadaId: eventoImpersonacion,
      versionSesionReal: 4,
      scopeEfectivoActual: scopePortal()
    }, { conexion })
  );
  assert.equal(finalizada.usuarioEfectivoId, usuarios.real);
  assert.equal(finalizada.versionSesionReal, 4);
  assert.equal(finalizada.versionSesionEfectiva, 4);
  assert.equal(finalizada.eventoImpersonacionIniciadaId, null);
  assert.deepEqual(finalizada.scopeApertura, scopePortal());

  const cerrada = await enTransaccion(clienteSql, (conexion) =>
    repositorio.transicionarTerminalEnTransaccion(
      directa.id,
      'cerrada',
      { conexion }
    )
  );
  assert.equal(cerrada.estado, 'cerrada');
  assert.ok(cerrada.cerradaEnUtc);
  await assert.rejects(
    () => enTransaccion(clienteSql, (conexion) =>
      repositorio.renovarEnTransaccion(directa.id, { conexion })
    ),
    TransicionSesionWebNoPermitida
  );
  await assert.rejects(
    () => clienteSql.ejecutar(
      "UPDATE sesiones_web_auditoria SET estado = 'abierta', cerrada_en_utc = NULL WHERE sesion_auditoria_id = UNHEX(REPLACE(?, '-', ''))",
      [directa.id]
    ),
    /transición de estado.*no está permitida/i
  );
  await assert.rejects(
    () => clienteSql.ejecutar(
      'UPDATE sesiones_web_auditoria SET version_sesion_real = version_sesion_real + 1 WHERE sesion_auditoria_id = UNHEX(REPLACE(?, \'-\', \'\'))',
      [directa.id]
    ),
    /terminal.*no puede modificarse/i
  );

  const terminalImpersonadaId = registrarSesion(generarUuidV7Auditoria());
  await repositorio.abrirAtomica({
    sesionAuditoriaId: terminalImpersonadaId,
    usuarioRealId: usuarios.real,
    versionSesionReal: 1,
    scopeApertura: scopePortal()
  });
  const eventoTerminal = generarUuidV7Auditoria();
  await enTransaccion(clienteSql, (conexion) =>
    repositorio.iniciarImpersonacionEnTransaccion({
      sesionAuditoriaId: terminalImpersonadaId,
      usuarioEfectivoId: usuarios.efectivo,
      versionSesionReal: 1,
      versionSesionEfectiva: 1,
      scopeEfectivoActual: { tenantId: '9001', empresaId: '9002', sitioId: null },
      eventoImpersonacionIniciadaId: eventoTerminal
    }, { conexion })
  );
  const invalidada = await enTransaccion(clienteSql, (conexion) =>
    repositorio.transicionarTerminalEnTransaccion(
      terminalImpersonadaId,
      'invalidada',
      { conexion }
    )
  );
  assert.equal(invalidada.usuarioEfectivoId, usuarios.efectivo);
  assert.deepEqual(invalidada.scopeApertura, scopePortal());
  assert.equal(invalidada.eventoImpersonacionIniciadaId, null);
}

async function verificarExpiracionBorradoYLimpieza(clienteSql, repositorio, usuarios) {
  const expirableId = registrarSesion(generarUuidV7Auditoria());
  await repositorio.abrirAtomica({
    sesionAuditoriaId: expirableId,
    usuarioRealId: usuarios.efectivo,
    versionSesionReal: 1,
    scopeApertura: scopePortal()
  }, { ttlSegundos: 1 });
  await assert.rejects(
    () => clienteSql.ejecutar(
      "DELETE FROM sesiones_web_auditoria WHERE sesion_auditoria_id = UNHEX(REPLACE(?, '-', ''))",
      [expirableId]
    ),
    /abierta y vigente.*no puede eliminarse/i
  );

  await clienteSql.ejecutar('DELETE FROM usuarios WHERE id IN (?, ?)', [usuarios.real, usuarios.efectivo]);
  assert.ok(await repositorio.buscarPorId(expirableId), 'Borrar usuarios no debe borrar ni bloquear la fotografía durable.');
  await esperar(1300);
  await assert.rejects(
    () => enTransaccion(clienteSql, (conexion) =>
      repositorio.renovarEnTransaccion(expirableId, { conexion })
    ),
    TransicionSesionWebNoPermitida
  );
  const limpieza = await repositorio.limpiarElegibles({
    graciaTerminalSegundos: 1,
    limite: 20
  });
  assert.ok(
    limpieza.eliminadas >= 3,
    'La limpieza global debe retirar al menos las tres sesiones elegibles de esta prueba.'
  );
  for (const sesionId of sesionesPrueba) {
    assert.equal(
      await repositorio.buscarPorId(sesionId),
      null,
      `La sesión de prueba ${sesionId} debe quedar retirada.`
    );
  }
}

async function enTransaccion(clienteSql, operacion) {
  const conexion = await clienteSql.obtenerConexion();
  try {
    await conexion.beginTransaction();
    const resultado = await operacion(conexion);
    await conexion.commit();
    return resultado;
  } catch (error) {
    await rollbackSeguro(conexion);
    throw error;
  } finally {
    conexion.release();
  }
}

function registrarSesion(id) {
  sesionesPrueba.add(id);
  return id;
}

function scopePortal() {
  return { tenantId: null, empresaId: null, sitioId: null };
}

async function limpiarPruebas(clienteSql) {
  if (sesionesPrueba.size > 0) {
    const ids = [...sesionesPrueba];
    const expresiones = ids.map(() => "UNHEX(REPLACE(?, '-', ''))").join(', ');
    await clienteSql.ejecutar(
      `UPDATE sesiones_web_auditoria
       SET estado = 'invalidada', evento_impersonacion_iniciada_id = NULL,
           cerrada_en_utc = UTC_TIMESTAMP(3)
       WHERE sesion_auditoria_id IN (${expresiones}) AND estado = 'abierta'`,
      ids
    );
    await clienteSql.ejecutar(
      `DELETE FROM sesiones_web_auditoria
       WHERE sesion_auditoria_id IN (${expresiones})`,
      ids
    );
  }
  await clienteSql.ejecutar(
    'DELETE FROM usuarios WHERE usuario IN (?, ?)',
    nombresUsuario
  );
}

function esperar(ms) {
  return new Promise((resolver) => setTimeout(resolver, ms));
}

async function rollbackSeguro(conexion) {
  try {
    await conexion.rollback();
  } catch {
    // La aserción original conserva prioridad.
  }
}

main().catch((error) => {
  console.error('[auditoria] Error verificando 5.21.4e');
  console.error(error);
  process.exit(1);
});

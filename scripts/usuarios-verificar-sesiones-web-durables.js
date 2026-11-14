import assert from 'node:assert/strict';
import { setTimeout as esperar } from 'node:timers/promises';
import { createClient } from 'redis';
import { ClienteSql } from '../paquetes/persistencia-sql/src/ClienteSql.js';
import { RepositorioSesionesWebAuditoria } from '../paquetes/sesiones/src/RepositorioSesionesWebAuditoria.js';
import { RepositorioProyeccionesSesionesWebRedis } from '../paquetes/sesiones/src/RepositorioProyeccionesSesionesWebRedis.js';
import { RepositorioPreautenticacionesWebRedis } from '../paquetes/sesiones/src/RepositorioPreautenticacionesWebRedis.js';
import {
  LimiteSesionesWebVigentes,
  ServicioSesionesWebDurables
} from '../paquetes/sesiones/src/ServicioSesionesWebDurables.js';
import { ServicioSesion } from '../paquetes/sesiones/src/ServicioSesion.js';
import { obtenerConfiguracionAplicacion } from '../paquetes/utilidades/src/configuracion/obtenerConfiguracionAplicacion.js';

const sufijo = `${Date.now()}-${process.pid}`;
const prefijo = `sentinelia:fixture:5218b:${sufijo}:`;
const usuarioLogin = `sesion-web-8b-${sufijo}`;
const usuarioLimite = `sesion-web-8b-limite-${sufijo}`;

async function main() {
  const configuracion = obtenerConfiguracionAplicacion();
  assert.equal(configuracion.sql.estaCompleta, true, 'La verificación 5.21.8b requiere SQL.');
  const clienteSql = new ClienteSql(configuracion.sql);
  const redis = createClient({ url: configuracion.redis.url });
  redis.on('error', () => {});
  await redis.connect();
  let errorPrincipal = null;
  try {
    const usuarios = await crearUsuarios(clienteSql);
    const entorno = crearEntorno({ clienteSql, redis, configuracion });
    await verificarCicloSesion(entorno, usuarios.normal);
    await verificarLimiteSinExpulsion(entorno, usuarios.limite);
    await verificarPreautenticacion(entorno, usuarios.normal);
    await verificarExpiracion({ clienteSql, redis, configuracion }, usuarios.normal);
    await verificarFalloStoreRevierteSql({ clienteSql, redis, configuracion }, usuarios.normal);
  } catch (error) {
    errorPrincipal = error;
  } finally {
    await limpiarRedis(redis);
    await limpiarSql(clienteSql);
    await redis.quit();
    await clienteSql.cerrar();
  }
  if (errorPrincipal) throw errorPrincipal;
  console.log(
    '[usuarios] OK 5.21.8b: sesiones_web=sql_autoritativo rolling=off ' +
    'renovacion=explicita limite=32 preauth=absoluta cierre=sql_primero'
  );
}

function crearEntorno({ clienteSql, redis, configuracion, ttlSegundos = 30 } = {}) {
  const repositorioSesiones = new RepositorioSesionesWebAuditoria(clienteSql);
  const repositorioProyecciones = new RepositorioProyeccionesSesionesWebRedis({
    clienteRedis: redis,
    prefijo: `${prefijo}sesiones:`
  });
  const repositorioPreautenticaciones = new RepositorioPreautenticacionesWebRedis({
    clienteRedis: redis,
    prefijo: `${prefijo}preauth:`,
    ttlMaximoSegundos: 30
  });
  const servicioDurable = new ServicioSesionesWebDurables({
    clienteSql,
    repositorioSesiones,
    repositorioProyecciones,
    ttlSegundos,
    maximoSesionesPorUsuario: 32
  });
  const servicioSesion = new ServicioSesion({
    clienteRedis: redis,
    configuracionSesion: configuracion.sesion,
    configuracionRedis: {
      ...configuracion.redis,
      prefijoSesiones: `${prefijo}legacy:`,
      prefijoVersionUsuario: `${prefijo}version:`
    },
    servicioSesionesWebDurables: servicioDurable,
    repositorioPreautenticaciones
  });
  return {
    repositorioSesiones,
    repositorioProyecciones,
    repositorioPreautenticaciones,
    servicioDurable,
    servicioSesion
  };
}

async function verificarCicloSesion(entorno, usuarioId) {
  const usuario = usuarioFixture(usuarioId, { versionSesion: 1 });
  const requisicion = crearRequisicion();
  await entorno.servicioSesion.crearSesionUsuario(requisicion, usuario);
  const storeId = requisicion.session.sesionWebAuditable.storeId;
  assert.equal(typeof storeId, 'string');
  assert.equal(requisicion.session.usuarioAutenticado.sesionAuditoriaId, undefined);
  assert.equal(await entorno.servicioSesion.validarVersionSesion(requisicion), true);
  const proyeccion = await entorno.repositorioProyecciones.obtenerPorStoreId(storeId);
  const antes = await entorno.repositorioSesiones.buscarPorId(proyeccion.sesionAuditoriaId);
  await entorno.servicioSesion.validarVersionSesion(requisicion);
  const trasValidar = await entorno.repositorioSesiones.buscarPorId(proyeccion.sesionAuditoriaId);
  assert.equal(trasValidar.renovadaEnUtc, antes.renovadaEnUtc, 'La validación no renueva rolling.');
  await esperar(20);
  await entorno.servicioSesion.renovarSesionExplicita(requisicion);
  const renovada = await entorno.repositorioSesiones.buscarPorId(proyeccion.sesionAuditoriaId);
  assert.notEqual(renovada.renovadaEnUtc, antes.renovadaEnUtc);
  await entorno.servicioSesion.destruirSesion(requisicion);
  const cerrada = await entorno.repositorioSesiones.buscarPorId(proyeccion.sesionAuditoriaId);
  assert.equal(cerrada.estado, 'cerrada');
  assert.equal(await entorno.repositorioProyecciones.obtenerPorStoreId(storeId), null);
  assert.equal(requisicion.session, null);
}

async function verificarLimiteSinExpulsion(entorno, usuarioId) {
  const abiertas = [];
  await entorno.servicioSesion.sincronizarVersionUsuario(usuarioId, 1);
  for (let indice = 0; indice < 32; indice += 1) {
    const requisicion = crearRequisicion();
    await entorno.servicioSesion.crearSesionUsuario(
      requisicion,
      usuarioFixture(usuarioId, { versionSesion: 1 })
    );
    abiertas.push({
      requisicion,
      storeId: requisicion.session.sesionWebAuditable.storeId
    });
  }
  await assert.rejects(
    () => entorno.servicioSesion.crearSesionUsuario(
      crearRequisicion(),
      usuarioFixture(usuarioId, { versionSesion: 1 })
    ),
    LimiteSesionesWebVigentes
  );
  for (const abierta of abiertas) {
    assert.ok(await entorno.repositorioProyecciones.obtenerPorStoreId(abierta.storeId));
  }
  await entorno.servicioDurable.invalidarPorUsuarios([usuarioId]);
}

async function verificarPreautenticacion(entorno, usuarioId) {
  await entorno.servicioSesion.sincronizarVersionUsuario(usuarioId, 3);
  const antes = await contarSesiones(entorno.repositorioSesiones.clienteSql, usuarioId);
  const requisicion = crearRequisicion();
  await entorno.servicioSesion.crearSesionCambioPasswordPendiente(
    requisicion,
    usuarioFixture(usuarioId, { versionSesion: 3, usuario: 'pendiente' })
  );
  const preauthId = requisicion.session.usuarioCambioPassword.preautenticacionId;
  const clave = `${prefijo}preauth:${preauthId}`;
  const ttlAntes = await entorno.repositorioPreautenticaciones.clienteRedis.ttl(clave);
  assert.equal(await entorno.servicioSesion.validarVersionSesionCambioPassword(requisicion), true);
  const ttlDespues = await entorno.repositorioPreautenticaciones.clienteRedis.ttl(clave);
  assert.ok(ttlDespues <= ttlAntes, 'La preautenticación no se renueva al leerla.');
  assert.equal(await contarSesiones(entorno.repositorioSesiones.clienteSql, usuarioId), antes);
  await entorno.servicioSesion.consumirSesionCambioPasswordPendiente(
    requisicion,
    usuarioId
  );
  assert.equal(await entorno.servicioSesion.validarVersionSesionCambioPassword(requisicion), false);
}

async function verificarExpiracion({ clienteSql, redis, configuracion }, usuarioId) {
  const entorno = crearEntorno({ clienteSql, redis, configuracion, ttlSegundos: 1 });
  await entorno.servicioSesion.sincronizarVersionUsuario(usuarioId, 4);
  const requisicion = crearRequisicion();
  await entorno.servicioSesion.crearSesionUsuario(
    requisicion,
    usuarioFixture(usuarioId, { versionSesion: 4 })
  );
  const storeId = requisicion.session.sesionWebAuditable.storeId;
  await esperar(1200);
  assert.equal(await entorno.servicioSesion.validarVersionSesion(requisicion), false);
  assert.equal(await entorno.repositorioProyecciones.obtenerPorStoreId(storeId), null);
}

async function verificarFalloStoreRevierteSql({ clienteSql, redis, configuracion }, usuarioId) {
  const entorno = crearEntorno({ clienteSql, redis, configuracion });
  await entorno.servicioSesion.sincronizarVersionUsuario(usuarioId, 5);
  const requisicion = crearRequisicion({ fallarSave: true });
  await assert.rejects(
    () => entorno.servicioSesion.crearSesionUsuario(
      requisicion,
      usuarioFixture(usuarioId, { versionSesion: 5 })
    ),
    /fallo save fixture/
  );
  const filas = await clienteSql.consultar(
    `SELECT estado
       FROM sesiones_web_auditoria
      WHERE usuario_real_id = ?
      ORDER BY creada_en_utc DESC
      LIMIT 1`,
    [usuarioId]
  );
  assert.equal(filas[0].estado, 'cerrada');
}

async function crearUsuarios(clienteSql) {
  const [normal] = await clienteSql.ejecutar(
    'INSERT INTO usuarios (usuario, email, hash_password) VALUES (?, ?, ?)',
    [usuarioLogin, `${usuarioLogin}@example.invalid`, 'hash-no-utilizable']
  );
  const [limite] = await clienteSql.ejecutar(
    'INSERT INTO usuarios (usuario, email, hash_password) VALUES (?, ?, ?)',
    [usuarioLimite, `${usuarioLimite}@example.invalid`, 'hash-no-utilizable']
  );
  return {
    normal: String(normal.insertId),
    limite: String(limite.insertId)
  };
}

function usuarioFixture(id, { versionSesion, usuario = `usuario-${id}` } = {}) {
  return {
    id: Number(id),
    usuario,
    versionSesion,
    tenantId: null,
    empresaId: null,
    sitioId: null,
    obtenerNombreVisible() {
      return usuario;
    }
  };
}

function crearRequisicion({ fallarSave = false } = {}) {
  const requisicion = { session: null };
  requisicion.session = crearSesionExpressFixture(requisicion, { fallarSave });
  return requisicion;
}

function crearSesionExpressFixture(requisicion, { fallarSave = false } = {}) {
  const sesion = {};
  Object.defineProperties(sesion, {
    save: {
      enumerable: false,
      value(callback) {
        callback(fallarSave ? new Error('fallo save fixture') : null);
      }
    },
    regenerate: {
      enumerable: false,
      value(callback) {
        for (const clave of Object.keys(sesion)) delete sesion[clave];
        callback(null);
      }
    },
    destroy: {
      enumerable: false,
      value(callback) {
        requisicion.session = null;
        callback(null);
      }
    }
  });
  return sesion;
}

async function contarSesiones(clienteSql, usuarioId) {
  const [fila] = await clienteSql.consultar(
    'SELECT COUNT(*) AS total FROM sesiones_web_auditoria WHERE usuario_real_id = ?',
    [usuarioId]
  );
  return Number(fila.total);
}

async function limpiarSql(clienteSql) {
  await clienteSql.ejecutar(
    `DELETE s FROM sesiones_web_auditoria s
       JOIN usuarios u
         ON u.id IN (s.usuario_real_id, s.usuario_efectivo_id)
      WHERE u.usuario IN (?, ?)`,
    [usuarioLogin, usuarioLimite]
  );
  await clienteSql.ejecutar(
    'DELETE FROM usuarios WHERE usuario IN (?, ?)',
    [usuarioLogin, usuarioLimite]
  );
}

async function limpiarRedis(redis) {
  const claves = [];
  for await (const clave of redis.scanIterator({ MATCH: `${prefijo}*`, COUNT: 100 })) {
    claves.push(clave);
  }
  if (claves.length) await redis.del(claves);
}

main().catch((error) => {
  console.error('[usuarios] Falló la verificación 5.21.8b');
  console.error(error);
  process.exitCode = 1;
});

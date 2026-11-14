import assert from 'node:assert/strict';
import { setTimeout as esperar } from 'node:timers/promises';
import { createClient } from 'redis';
import { generarUuidV7Auditoria } from '../paquetes/auditoria/src/UuidV7Auditoria.js';
import { ClienteSql } from '../paquetes/persistencia-sql/src/ClienteSql.js';
import { RepositorioSesionesWebAuditoria } from '../paquetes/sesiones/src/RepositorioSesionesWebAuditoria.js';
import { RepositorioProyeccionesSesionesWebRedis } from '../paquetes/sesiones/src/RepositorioProyeccionesSesionesWebRedis.js';
import { RepositorioPreautenticacionesWebRedis } from '../paquetes/sesiones/src/RepositorioPreautenticacionesWebRedis.js';
import { CanalInvalidacionesSesionesWebRedis } from '../paquetes/sesiones/src/CanalInvalidacionesSesionesWebRedis.js';
import { RegistroWebSocketsSesionesWebDurables } from '../paquetes/sesiones/src/RegistroWebSocketsSesionesWebDurables.js';
import {
  LimiteSesionesWebVigentes,
  SesionWebNoVigente,
  ServicioSesionesWebDurables
} from '../paquetes/sesiones/src/ServicioSesionesWebDurables.js';
import { obtenerConfiguracionAplicacion } from '../paquetes/utilidades/src/configuracion/obtenerConfiguracionAplicacion.js';

const sufijo = `${Date.now()}-${process.pid}`;
const prefijo = `sentinelia:fixture:5215f:${sufijo}:`;
const nombresUsuario = ['real', 'efectivo', 'fallo'].map(
  (rol) => `sesion-5f-${rol}-${sufijo}`
);
const idsSesion = new Set();

async function main() {
  const configuracion = obtenerConfiguracionAplicacion();
  assert.equal(configuracion.sql.estaCompleta, true, 'La verificación 5.21.5f requiere SQL.');
  const clienteSql = new ClienteSql(configuracion.sql);
  const redis = createClient({ url: configuracion.redis.url });
  redis.on('error', () => {});
  await redis.connect();
  let errorPrincipal = null;
  try {
    const usuarios = await crearUsuarios(clienteSql);
    const repositorioSesiones = new RepositorioSesionesWebAuditoria(clienteSql);
    const repositorioProyecciones = new RepositorioProyeccionesSesionesWebRedis({
      clienteRedis: redis,
      prefijo: `${prefijo}sesiones:`
    });
    const canal = new CanalInvalidacionesSesionesWebRedis({
      clienteRedis: redis,
      canal: `${prefijo}invalidaciones`
    });
    const auditoria = new AuditoriaTransaccionalFixture();
    const servicio = new ServicioSesionesWebDurables({
      clienteSql,
      repositorioSesiones,
      repositorioProyecciones,
      servicioAuditoria: auditoria,
      canalInvalidaciones: canal,
      ttlSegundos: 30,
      maximoSesionesPorUsuario: 2
    });

    const primera = await abrirYRegistrar(servicio, usuarios.real, { csrf: 'opaco-1' });
    const segunda = await abrirYRegistrar(servicio, usuarios.real, { csrf: 'opaco-2' });
    await verificarLimiteSinExpulsion(servicio, repositorioSesiones, usuarios.real, primera, segunda);
    const renovada = await verificarRenovacionExplicita(servicio, repositorioSesiones, primera);
    await servicio.cerrar(segunda.storeId);
    const directa = await verificarImpersonacion(
      servicio,
      repositorioSesiones,
      repositorioProyecciones,
      auditoria,
      renovada,
      usuarios
    );
    await verificarWebSocketsEInvalidacion({
      servicio,
      repositorioSesiones,
      canal,
      sesion: directa.sesion,
      usuarios
    });
    await verificarCaidaProyeccion({
      clienteSql,
      repositorioSesiones,
      repositorioProyecciones,
      usuarioId: usuarios.fallo
    });
    await verificarExpiracion({
      clienteSql,
      repositorioSesiones,
      repositorioProyecciones,
      usuarioId: usuarios.real
    });
    await verificarPreautenticacion(clienteSql, redis, usuarios.real);
    await canal.cerrar();
  } catch (error) {
    errorPrincipal = error;
  } finally {
    await limpiarRedis(redis);
    await redis.quit();
    await limpiarSql(clienteSql);
    await clienteSql.cerrar();
  }
  if (errorPrincipal) throw errorPrincipal;
  console.log(
    '[auditoria] OK 5.21.5f: autoridad=sql proyeccion=posterior limite=sin_expulsion renovacion=explicita impersonacion=atomica websocket=senal_mas_revalidacion preauth=absoluta'
  );
}

async function verificarLimiteSinExpulsion(servicio, repositorio, usuarioId, primera, segunda) {
  await assert.rejects(
    () => servicio.abrir({ usuarioId, versionSesion: 1, scope: scopePortal() }),
    LimiteSesionesWebVigentes
  );
  assert.ok(await repositorio.buscarVigentePorId(primera.proyeccion.sesionAuditoriaId));
  assert.ok(await repositorio.buscarVigentePorId(segunda.proyeccion.sesionAuditoriaId));
}

async function verificarRenovacionExplicita(servicio, repositorio, primera) {
  const antes = await repositorio.buscarPorId(primera.proyeccion.sesionAuditoriaId);
  await servicio.validar(primera.storeId);
  const trasValidar = await repositorio.buscarPorId(primera.proyeccion.sesionAuditoriaId);
  assert.equal(trasValidar.renovadaEnUtc, antes.renovadaEnUtc, 'Validar no aplica rolling.');
  await esperar(20);
  const renovada = await servicio.renovarExplicita(primera.storeId);
  const despues = await repositorio.buscarPorId(primera.proyeccion.sesionAuditoriaId);
  assert.notEqual(despues.renovadaEnUtc, antes.renovadaEnUtc);
  return Object.freeze({ storeId: primera.storeId, sesion: despues, proyeccion: renovada.proyeccion });
}

async function verificarImpersonacion(servicio, repositorio, proyecciones, auditoria, actual, usuarios) {
  const inicio = intencionImpersonacion({
    tipo: 'usuario.impersonacion_iniciada',
    sesion: actual.sesion,
    efectivoId: usuarios.efectivo,
    causalidad: null
  });
  const iniciada = await servicio.iniciarImpersonacion(actual.storeId, {
    usuarioEfectivoId: usuarios.efectivo,
    versionSesionReal: 2,
    versionSesionEfectiva: 7,
    scopeEfectivoActual: scopeTenant('71'),
    intencionAuditoria: inicio
  });
  assert.equal(iniciada.proyeccion.usuarioEfectivoId, usuarios.efectivo);
  assert.deepEqual(iniciada.proyeccion.scopeApertura, scopePortal());
  assert.deepEqual(iniciada.proyeccion.scopeEfectivoActual, scopeTenant('71'));
  assert.equal((await proyecciones.listarStoreIdsPorUsuario(usuarios.efectivo)).includes(actual.storeId), true);
  const durableInicio = await repositorio.buscarPorId(actual.sesion.sesionAuditoriaId);
  assert.equal(durableInicio.eventoImpersonacionIniciadaId, inicio.eventoId);

  const fin = intencionImpersonacion({
    tipo: 'usuario.impersonacion_finalizada',
    sesion: durableInicio,
    efectivoId: usuarios.efectivo,
    causalidad: { tipo: 'evento_auditoria', id: inicio.eventoId }
  });
  const finalizada = await servicio.finalizarImpersonacion(actual.storeId, {
    versionSesionReal: 3,
    scopeEfectivoActual: scopePortal(),
    intencionAuditoria: fin
  });
  assert.equal(finalizada.proyeccion.usuarioEfectivoId, usuarios.real);
  assert.equal(finalizada.proyeccion.versionSesionReal, 3);
  assert.equal(finalizada.proyeccion.versionSesionEfectiva, 3);
  assert.deepEqual(finalizada.proyeccion.scopeApertura, scopePortal());
  assert.notEqual(inicio.correlacionId, fin.correlacionId);
  const durableDirecta = await repositorio.buscarPorId(actual.sesion.sesionAuditoriaId);
  const segundoInicio = intencionImpersonacion({
    tipo: 'usuario.impersonacion_iniciada',
    sesion: durableDirecta,
    efectivoId: usuarios.efectivo,
    causalidad: null
  });
  await servicio.iniciarImpersonacion(actual.storeId, {
    usuarioEfectivoId: usuarios.efectivo,
    versionSesionReal: 4,
    versionSesionEfectiva: 8,
    scopeEfectivoActual: scopeTenant('72'),
    intencionAuditoria: segundoInicio
  });
  assert.equal(auditoria.registros.length, 3);
  return Object.freeze({
    storeId: actual.storeId,
    sesion: await repositorio.buscarPorId(actual.sesion.sesionAuditoriaId)
  });
}

async function verificarWebSocketsEInvalidacion({ servicio, repositorioSesiones, canal, sesion, usuarios }) {
  const recibioSenal = new RegistroWebSocketsSesionesWebDurables({
    repositorioSesiones,
    instanciaId: 'fixture-a'
  });
  const perdioSenal = new RegistroWebSocketsSesionesWebDurables({
    repositorioSesiones,
    instanciaId: 'fixture-b'
  });
  const socketA = socketFixture();
  const socketB = socketFixture();
  recibioSenal.registrar({ socket: socketA, sesion });
  perdioSenal.registrar({ socket: socketB, sesion });
  await canal.suscribir((ids) => recibioSenal.procesarInvalidacion(ids));
  await esperar(30);
  const invalidadas = await servicio.invalidarPorUsuarios([usuarios.efectivo]);
  assert.equal(invalidadas.length, 1);
  await esperar(50);
  assert.equal(socketA.cierres.length, 1, 'La señal Redis cierra la conexión local.');
  assert.equal(socketB.cierres.length, 0, 'La segunda instancia simula una señal perdida.');
  const resultado = await perdioSenal.revalidar();
  assert.equal(resultado.cerradas, 1, 'La revalidación SQL repara la señal perdida.');
  assert.equal(socketB.cierres.length, 1);
}

async function verificarCaidaProyeccion({ clienteSql, repositorioSesiones, repositorioProyecciones, usuarioId }) {
  const proyectorCaido = {
    ...repositorioProyecciones,
    generarStoreId: () => repositorioProyecciones.generarStoreId(),
    guardar: async (datos) => {
      await repositorioProyecciones.guardar(datos);
      throw new Error('Respuesta Redis perdida después de escribir (fixture)');
    },
    eliminarPorStoreId: (...args) => repositorioProyecciones.eliminarPorStoreId(...args)
  };
  const servicio = new ServicioSesionesWebDurables({
    clienteSql,
    repositorioSesiones,
    repositorioProyecciones: proyectorCaido,
    ttlSegundos: 30
  });
  await assert.rejects(
    () => servicio.abrir({ usuarioId, versionSesion: 1, scope: scopePortal() }),
    /sesión SQL fue invalidada/i
  );
  const filas = await clienteSql.consultar(
    `SELECT estado FROM sesiones_web_auditoria
      WHERE usuario_real_id = ? ORDER BY creada_en_utc DESC LIMIT 1`,
    [usuarioId]
  );
  assert.equal(filas[0].estado, 'invalidada');
  assert.deepEqual(
    await repositorioProyecciones.listarStoreIdsPorUsuario(usuarioId),
    [],
    'Ni una escritura Redis con respuesta perdida sobrevive a la invalidación SQL.'
  );
}

async function verificarExpiracion({ clienteSql, repositorioSesiones, repositorioProyecciones, usuarioId }) {
  const servicio = new ServicioSesionesWebDurables({
    clienteSql,
    repositorioSesiones,
    repositorioProyecciones,
    ttlSegundos: 1
  });
  const abierta = await abrirYRegistrar(servicio, usuarioId, { breve: true });
  await esperar(1200);
  await assert.rejects(() => servicio.validar(abierta.storeId), SesionWebNoVigente);
  assert.equal(await repositorioProyecciones.obtenerPorStoreId(abierta.storeId), null);
  assert.equal(await repositorioSesiones.buscarVigentePorId(abierta.proyeccion.sesionAuditoriaId), null);
}

async function verificarPreautenticacion(clienteSql, redis, usuarioId) {
  const [antes] = await clienteSql.consultar(
    'SELECT COUNT(*) AS total FROM sesiones_web_auditoria WHERE usuario_real_id = ?',
    [usuarioId]
  );
  const repositorio = new RepositorioPreautenticacionesWebRedis({
    clienteRedis: redis,
    prefijo: `${prefijo}preauth:`,
    ttlMaximoSegundos: 30
  });
  const estado = await repositorio.crear({ usuarioId, datos: { paso: 'mfa' }, ttlSegundos: 3 });
  const clave = `${prefijo}preauth:${estado.preautenticacionId}`;
  const ttlAntes = await redis.ttl(clave);
  assert.ok(await repositorio.obtener(estado.preautenticacionId));
  const ttlDespues = await redis.ttl(clave);
  assert.ok(ttlDespues <= ttlAntes, 'Leer preautenticación no renueva su TTL absoluto.');
  assert.ok(await repositorio.consumir(estado.preautenticacionId));
  assert.equal(await repositorio.consumir(estado.preautenticacionId), null);
  const [despues] = await clienteSql.consultar(
    'SELECT COUNT(*) AS total FROM sesiones_web_auditoria WHERE usuario_real_id = ?',
    [usuarioId]
  );
  assert.equal(Number(despues.total), Number(antes.total), 'Preautenticar no abre sesión auditable.');
}

async function abrirYRegistrar(servicio, usuarioId, datosStore) {
  const resultado = await servicio.abrir({
    usuarioId,
    versionSesion: 1,
    scope: scopePortal(),
    datosStore
  });
  idsSesion.add(resultado.proyeccion.sesionAuditoriaId);
  return resultado;
}

function intencionImpersonacion({ tipo, sesion, efectivoId, causalidad }) {
  return {
    eventoId: generarUuidV7Auditoria(),
    tipo,
    sujeto: { tipo: 'sesion_usuario', id: sesion.sesionAuditoriaId },
    actorReal: { tipo: 'usuario', id: sesion.usuarioRealId },
    actorEfectivo: { tipo: 'usuario', id: efectivoId },
    modoActuacion: 'impersonado',
    correlacionId: generarUuidV7Auditoria(),
    causalidad,
    payload: {
      sesionAuditoriaId: sesion.sesionAuditoriaId,
      resultado: tipo.endsWith('_iniciada') ? 'impersonacion_iniciada' : 'impersonacion_finalizada',
      causa: 'operador'
    }
  };
}

class AuditoriaTransaccionalFixture {
  constructor() { this.registros = []; }
  async registrarEnTransaccion(solicitud, { conexion } = {}) {
    assert.equal(typeof conexion?.execute, 'function', 'Auditoría comparte la conexión SQL.');
    this.registros.push(solicitud.intencion);
    return { estado: 'incorporado' };
  }
}

function socketFixture() {
  return { cierres: [], close(codigo, motivo) { this.cierres.push({ codigo, motivo }); } };
}

async function crearUsuarios(clienteSql) {
  const ids = [];
  for (const nombre of nombresUsuario) {
    const [resultado] = await clienteSql.ejecutar(
      'INSERT INTO usuarios (usuario, email, hash_password) VALUES (?, ?, ?)',
      [nombre, `${nombre}@example.invalid`, 'hash-no-utilizable']
    );
    ids.push(String(resultado.insertId));
  }
  return { real: ids[0], efectivo: ids[1], fallo: ids[2] };
}

async function limpiarSql(clienteSql) {
  await clienteSql.ejecutar(
    `DELETE s FROM sesiones_web_auditoria s
       JOIN usuarios u
         ON u.id IN (s.usuario_real_id, s.usuario_efectivo_id)
      WHERE u.usuario IN (${nombresUsuario.map(() => '?').join(', ')})`,
    nombresUsuario
  );
  await clienteSql.ejecutar(
    `DELETE FROM usuarios WHERE usuario IN (${nombresUsuario.map(() => '?').join(', ')})`,
    nombresUsuario
  );
}

async function limpiarRedis(redis) {
  const claves = [];
  for await (const clave of redis.scanIterator({ MATCH: `${prefijo}*`, COUNT: 100 })) claves.push(clave);
  if (claves.length) await redis.del(claves);
}

function scopePortal() {
  return { tenantId: null, empresaId: null, sitioId: null };
}

function scopeTenant(tenantId) {
  return { tenantId, empresaId: null, sitioId: null };
}

main().catch((error) => {
  console.error('[auditoria] Falló la verificación 5.21.5f');
  console.error(error);
  process.exitCode = 1;
});

import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { ServicioConexionRedis } from '../paquetes/sesiones/src/ServicioConexionRedis.js';
import { RepositorioAutorizacionPerfilRedis } from '../paquetes/usuarios/src/RepositorioAutorizacionPerfilRedis.js';
import { RepositorioOperacionesEmailPerfilRedis } from '../paquetes/usuarios/src/RepositorioOperacionesEmailPerfilRedis.js';
import { crearMiddlewareValidarCsrfPortal } from '../apps/sentinelia-web/src/middleware/validarCsrfPortal.js';
import { obtenerConfiguracionAplicacion } from '../paquetes/utilidades/src/configuracion/obtenerConfiguracionAplicacion.js';

const configuracion = obtenerConfiguracionAplicacion();
const conexion = new ServicioConexionRedis(configuracion.redis);
const prefijo = `sentinelia:test:perfil-fronteras:${randomUUID()}:`;
try {
  const redis = await conexion.conectar();
  const autorizaciones = new RepositorioAutorizacionPerfilRedis({
    clienteRedis: redis, prefijoRedis: `${prefijo}autorizacion:`
  });
  const operaciones = new RepositorioOperacionesEmailPerfilRedis({
    clienteRedis: redis, prefijoRedis: `${prefijo}email:`,
    secretoProteccionTokens: configuracion.sesion.secreto
  });
  assert.equal(await autorizaciones.obtenerAutorizacion({
    idUsuarioReal: 10, idSesion: 'sin-estado-previo'
  }), null);
  assert.deepEqual(await operaciones.obtenerOperacionActual(10), {
    estado: 'ausente', operacion: null, huellaToken: null
  });
} finally {
  await conexion.cerrar();
}

const middleware = crearMiddlewareValidarCsrfPortal();
for (const [method, token, permitido] of [
  ['GET', '', true], ['POST', '', false],
  ['POST', 'token-ajeno', false], ['POST', 'csrf-fixture', true]
]) {
  let continuaciones = 0;
  const respuesta = {
    estado: 200, payload: null,
    status(estado) { this.estado = estado; return this; },
    json(payload) { this.payload = payload; return this; }
  };
  middleware({
    method, body: {},
    session: { usuarioAutenticado: { tokenCSRF: 'csrf-fixture' } },
    get(nombre) {
      if (nombre.toLowerCase() === 'accept') return 'application/json';
      return nombre.toLowerCase() === 'x-csrf-token' ? token : '';
    }
  }, respuesta, () => { continuaciones += 1; });
  assert.equal(continuaciones, permitido ? 1 : 0);
  if (!permitido) {
    assert.equal(respuesta.estado, 403);
    assert.equal(respuesta.payload.codigo, 'csrf_invalido');
  }
}

const rutas = await leer('../apps/sentinelia-web/src/rutas/crearRutasPortal.js');
const indiceCsrf = rutas.indexOf('router.use(function aplicarCsrfPortalAutenticado');
assert.ok(indiceCsrf >= 0, 'Debe existir la guarda CSRF autenticada.');
for (const ruta of [
  '/mi-perfil/desbloquear', '/mi-perfil/cerrar-edicion',
  '/mi-perfil/nombre-visible', '/mi-perfil/nombre-completo',
  '/mi-perfil/password', '/mi-perfil/email', '/mi-perfil/email/validar',
  '/mi-perfil/email/reenviar', '/mi-perfil/email/confirmar'
]) {
  assert.ok(rutas.indexOf(`'${ruta}'`, indiceCsrf) > indiceCsrf,
    `${ruta} debe declararse tras la guarda CSRF.`);
}
for (const archivo of ['ServicioAutogestionPerfil', 'ServicioCambioEmailPerfil']) {
  const fuente = await leer(`../paquetes/usuarios/src/${archivo}.js`);
  assert.match(fuente, /servicioAuditoria/u);
  assert.doesNotMatch(fuente, /RepositorioAuditoria/u);
}
console.log('[usuarios:perfil-fronteras] OK: estado inicial denegado, CSRF y auditoría por puerto verificados.');

function leer(ruta) {
  return readFile(new URL(ruta, import.meta.url), 'utf8');
}

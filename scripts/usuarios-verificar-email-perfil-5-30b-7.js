import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, extname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

import express from 'express';

import { ControladorUsuarios }
  from '../apps/sentinelia-web/src/controladores/ControladorUsuarios.js';
import { ServicioCambioEmailPerfil }
  from '../paquetes/usuarios/src/ServicioCambioEmailPerfil.js';
import { ServicioEmailPerfil }
  from '../paquetes/usuarios/src/ServicioEmailPerfil.js';

const raiz = join(dirname(fileURLToPath(import.meta.url)), '..');

verificarGuardaProductiva();
await verificarRutaExpressPublicada();

console.log(
  '[usuarios] OK 5.30b.7: ruta_express=publicada productor=cola_sql ' +
  'smtp_web=prohibido coordinador=requerido cierre=integral'
);

function verificarGuardaProductiva() {
  const fuentes = listarJavaScript(join(raiz, 'apps'))
    .concat(listarJavaScript(join(raiz, 'paquetes')));
  const llamadasDirectas = fuentes.filter((ruta) =>
    /\.enviarCorreoVerificacionEmailPerfil\s*\(/u.test(leer(ruta)));
  assert.deepEqual(llamadasDirectas.map((ruta) => relative(raiz, ruta)), [],
    'Ningún proceso productivo puede enviar directamente la verificación.');

  const cambio = leer(join(raiz,
    'paquetes/usuarios/src/ServicioCambioEmailPerfil.js'));
  assert.match(cambio, /El cambio de correo exige el coordinador de emisión/u);
  assert.doesNotMatch(cambio, /\.enviarCorreoVerificacionEmailPerfil\s*\(/u);

  const web = leer(join(raiz, 'apps/sentinelia-web/src/index.js'));
  assert.match(web, /new ServicioEmisionInicialEmailPerfilCoordinada/u);
  assert.match(web, /new ServicioReenvioEmailPerfilCoordinado/u);
  assert.match(web, /coordinadorEmisionEmailPerfil/u);

  const runtime = leer(join(raiz,
    'apps/sentinelia-runtime/src/BootstrapRuntime.js'));
  assert.match(runtime, /new ServicioInicioDespachoVerificacionEmailPerfil/u);
  assert.match(runtime, /iniciadorVerificacionEmailPerfil/u);

  const rutas = leer(join(raiz,
    'apps/sentinelia-web/src/rutas/crearRutasPortal.js'));
  assert.match(rutas,
    /'\/mi-perfil\/email'[\s\S]*apiCambiarEmailPerfil\.bind/u);
}

async function verificarRutaExpressPublicada() {
  const usuario = {
    id: 91,
    activo: true,
    email: 'origen-91@example.test',
    emailValidado: true,
    hashPassword: 'hash-530b7'
  };
  const llamadas = [];
  const repositorioUsuarios = { buscarPorId: async () => usuario };
  const servicio = new ServicioCambioEmailPerfil({
    repositorioUsuarios,
    repositorioOperacionesEmail: {},
    servicioEmailPerfil: new ServicioEmailPerfil({ repositorioUsuarios }),
    servicioAutorizacionPerfil: { exigirAutorizacion: async () => {} },
    servicioCorreoPortal: { obtenerEstadoConfiguracion: () => ({ operativo: true }) },
    servicioConfiguracionPortal: { obtenerConfiguracionActual: () => ({}) },
    coordinadorEmisionEmailPerfil: {
      async encolarInicial(entrada) {
        llamadas.push(entrada);
        return {
          codigo: 'email_verificacion_encolada',
          mensaje: 'Correo de verificación encolado.'
        };
      },
      async encolarReenvio() { throw new Error('fuera_de_escenario'); }
    }
  });
  const controlador = new ControladorUsuarios({
    servicioUsuarios: {},
    servicioCambioEmailPerfil: servicio
  });
  const app = express();
  app.use(express.json());
  app.post('/mi-perfil/email', (req, _res, next) => {
    req.contextoUsuarioActual = {
      idUsuario: 91, idUsuarioReal: 91, impersonacionActiva: false
    };
    Object.defineProperty(req, 'sessionID', { value: 'sesion-530b7' });
    next();
  }, controlador.apiCambiarEmailPerfil.bind(controlador));
  const servidor = await new Promise((resolve) => {
    const actual = app.listen(0, '127.0.0.1', () => resolve(actual));
  });
  try {
    const direccion = servidor.address();
    const respuesta = await fetch(
      `http://127.0.0.1:${direccion.port}/mi-perfil/email`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email: 'candidato-91@example.test' })
      }
    );
    assert.equal(respuesta.status, 200);
    assert.deepEqual(await respuesta.json(), {
      ok: true,
      codigo: 'email_verificacion_encolada',
      mensaje: 'Correo de verificación encolado.'
    });
    assert.deepEqual(llamadas, [{
      idUsuario: '91', emailCandidato: 'candidato-91@example.test'
    }]);
  } finally {
    await new Promise((resolve, reject) => servidor.close((error) =>
      error ? reject(error) : resolve()));
  }
}

function leer(ruta) {
  return readFileSync(ruta, 'utf8');
}

function listarJavaScript(directorio) {
  return readdirSync(directorio, { withFileTypes: true }).flatMap((entrada) => {
    const ruta = join(directorio, entrada.name);
    if (entrada.isDirectory()) return listarJavaScript(ruta);
    return entrada.isFile() && extname(entrada.name) === '.js' ? [ruta] : [];
  });
}

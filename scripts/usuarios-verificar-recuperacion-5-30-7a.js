import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import ejs from 'ejs';

import { ServicioInicioPublicoRecuperacionPasswordEmail }
  from '../paquetes/usuarios/src/ServicioInicioPublicoRecuperacionPasswordEmail.js';
import { ControladorRecuperacionPassword }
  from '../apps/sentinelia-web/src/controladores/ControladorRecuperacionPassword.js';
import {
  RESULTADOS_PUBLICOS_RECUPERACION_PASSWORD_EMAIL
} from '../paquetes/usuarios/src/ContratoRecuperacionPasswordEmail.js';

await main();

async function main() {
  await verificarUniformidadYJitter();
  await verificarRechazoYFalloCerrado();
  await verificarControladorYComposicion();
  console.log('[usuarios] OK 5.30.7a: inicio=publico respuesta=uniforme csrf+pow=obligatorios jitter=independiente saturacion=429 infraestructura=503 gate=cerrado');
}

async function verificarUniformidadYJitter() {
  const conIdentidades = crearServicio({ preparada: true, aleatorio: 0.5 });
  const sinIdentidades = crearServicio({ preparada: false, aleatorio: 0.5 });
  const entrada = {
    buzon: ' Persona@Example.COM ', origenRed: '203.0.113.15',
    entregaPow: { idDesafio: 'pow-valido' }
  };
  const emitida = await conIdentidades.servicio.iniciar(entrada);
  const vacia = await sinIdentidades.servicio.iniciar(entrada);

  assert.deepEqual(emitida.resultadoPublico, vacia.resultadoPublico);
  assert.equal(emitida.resultadoPublico.estadoHttp, 202);
  assert.equal(JSON.stringify(emitida).includes('token'), false);
  assert.equal(JSON.stringify(emitida).includes('frontera'), false);
  assert.deepEqual(conIdentidades.esperas, [50]);
  assert.deepEqual(sinIdentidades.esperas, [50]);
  assert.equal(conIdentidades.activaciones, 1);
  assert.equal(sinIdentidades.activaciones, 0);
  assert.equal(conIdentidades.buzones[0], 'Persona@example.com');
}

async function verificarRechazoYFalloCerrado() {
  const saturada = crearServicio({ saturada: true });
  const resultado = await saturada.servicio.iniciar({
    buzon: 'persona@example.com', origenRed: '203.0.113.15',
    entregaPow: { idDesafio: 'pow-valido' }
  });
  assert.equal(resultado.resultadoPublico.estadoHttp, 429);
  assert.equal(saturada.preparaciones, 0);
  assert.deepEqual(saturada.esperas, []);

  const pow = crearServicio({ powInvalido: true });
  const rechazoPow = await pow.servicio.iniciar({
    buzon: 'persona@example.com', origenRed: '203.0.113.15',
    entregaPow: { idDesafio: 'pow-invalido' }
  });
  assert.equal(rechazoPow.alcanzoAdmision, false);
  assert.equal(rechazoPow.resultadoPow.codigo, 'pow_invalido');
  assert.equal(pow.preparaciones, 0);

  const averia = crearServicio({ falloPreparacion: true });
  await assert.rejects(() => averia.servicio.iniciar({
    buzon: 'persona@example.com', origenRed: '203.0.113.15',
    entregaPow: { idDesafio: 'pow-valido' }
  }), /sql no disponible/u);
}

async function verificarControladorYComposicion() {
  const llamadas = [];
  const servicioInicio = {
    async emitirDesafio(entrada) { llamadas.push(['desafio', entrada]); return { activo: true }; },
    async iniciar(entrada) {
      llamadas.push(['inicio', entrada]);
      return {
        admitida: true,
        resultadoPublico:
          RESULTADOS_PUBLICOS_RECUPERACION_PASSWORD_EMAIL.SOLICITUD_RECIBIDA
      };
    }
  };
  const controlador = new ControladorRecuperacionPassword({
    servicioInicio,
    servicioContinuacion: crearContinuacionFixture(),
    servicioSesion: crearSesionFixture(),
    superficiePublicaHabilitada: () => true
  });
  const respuesta = crearRespuesta();
  await controlador.procesar({
    ip: '::ffff:198.51.100.24',
    body: { email: 'persona@example.com', pow_desafio_id: 'd', pow_nonce: '4' }
  }, respuesta, assert.fail);
  assert.equal(respuesta.estadoHttp, 202);
  assert.equal(respuesta.cabeceras['Cache-Control'], 'no-store');
  assert.equal(llamadas[0][1].origenRed, '198.51.100.24');
  assert.equal(respuesta.vista, 'recuperacion-password-inicio');

  const cerrado = new ControladorRecuperacionPassword({
    servicioInicio,
    servicioContinuacion: crearContinuacionFixture(),
    servicioSesion: crearSesionFixture()
  });
  const respuestaCerrada = crearRespuesta();
  await cerrado.mostrarFormulario({}, respuestaCerrada, assert.fail);
  assert.equal(respuestaCerrada.estadoHttp, 503);
  assert.equal(respuestaCerrada.datos.disponible, false);

  const [rutas, index, vista, login, javascript] = await Promise.all([
    leer('../apps/sentinelia-web/src/rutas/crearRutasPortal.js'),
    leer('../apps/sentinelia-web/src/index.js'),
    leer('../apps/sentinelia-web/src/views/recuperacion-password-inicio.ejs'),
    leer('../apps/sentinelia-web/src/views/login.ejs'),
    leer('../apps/sentinelia-web/src/public/js/login.js')
  ]);
  assert.match(rutas, /'\/recuperar-password'[\s\S]*validarCsrfPortal/u);
  assert.match(rutas, /'\/recuperar-password\/pow\/desafio'/u);
  assert.match(index,
    /superficiePublicaHabilitada:[\s\S]*servicioDisponibilidadRecuperacionPassword\.evaluar/u);
  assert.match(login,
    /if \(typeof recuperacionPasswordDisponible[\s\S]*href="\/recuperar-password"/u);
  assert.match(vista, /data-formulario-pow/u);
  assert.match(javascript, /dataset\.powEndpoint/u);
  ejs.compile(vista, {
    filename: new URL('../apps/sentinelia-web/src/views/recuperacion-password-inicio.ejs', import.meta.url).pathname
  });
}

function crearContinuacionFixture() {
  return {
    inspeccionar: async () => ({ utilizable: false }),
    resolver: async () => ({ utilizable: false }),
    sustituir: async () => ({ sustituida: false })
  };
}

function crearSesionFixture() {
  return {
    asegurarTokenCsrfPublico: async () => 'csrf-publico',
    guardarContinuacionRecuperacionPassword: async () => true,
    obtenerContinuacionRecuperacionPassword: () => null,
    marcarIdentidadResueltaRecuperacionPassword: async () => true,
    limpiarContinuacionRecuperacionPassword: async () => true
  };
}

function crearServicio({ preparada = true, aleatorio = 0, saturada = false,
  powInvalido = false, falloPreparacion = false } = {}) {
  const estado = {
    esperas: [], buzones: [], activaciones: 0, preparaciones: 0
  };
  const servicio = new ServicioInicioPublicoRecuperacionPasswordEmail({
    servicioAdmision: {
      async emitirDesafio(entrada) { return { activo: true, entrada }; },
      async admitir() {
        if (powInvalido) return {
          admitida: false, alcanzoAdmision: false,
          resultadoPow: { exito: false, codigo: 'pow_invalido', mensaje: 'PoW inválido' }
        };
        if (saturada) return {
          admitida: false, alcanzoAdmision: true,
          resultadoPublico:
            RESULTADOS_PUBLICOS_RECUPERACION_PASSWORD_EMAIL.ADMISION_SATURADA
        };
        return { admitida: true, alcanzoAdmision: true };
      }
    },
    servicioPreparacion: {
      async preparar({ buzon }) {
        estado.preparaciones += 1;
        estado.buzones.push(buzon);
        if (falloPreparacion) throw new Error('sql no disponible');
        return preparada ? { preparada: true, solicitudId: 'fixture' }
          : { preparada: false, resultado: 'sin_identidades' };
      }
    },
    servicioActivacion: {
      async activarYLiberar() { estado.activaciones += 1; }
    },
    servicioConfiguracionPortal: {
      async asegurarActualizada() {},
      obtenerConfiguracionActual: () => ({
        obtenerConfiguracionUsuarios: () => ({
          recuperacionEmailJitterMaximoMs: 100
        })
      })
    },
    esperar: async (ms) => { estado.esperas.push(ms); },
    aleatorio: () => aleatorio
  });
  return Object.assign(estado, { servicio });
}

function crearRespuesta() {
  return {
    locals: {}, cabeceras: {}, estadoHttp: 200,
    status(valor) { this.estadoHttp = valor; return this; },
    set(clave, valor) { this.cabeceras[clave] = valor; return this; },
    render(vista, datos) { this.vista = vista; this.datos = datos; return this; },
    json(datos) { this.datos = datos; return this; }
  };
}

function leer(relativa) {
  return readFile(new URL(relativa, import.meta.url), 'utf8');
}

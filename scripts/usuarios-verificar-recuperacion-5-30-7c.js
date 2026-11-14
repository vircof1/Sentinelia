import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import ejs from 'ejs';

import { generarUuidV7Auditoria }
  from '../paquetes/auditoria/src/UuidV7Auditoria.js';
import { ErrorValidacionPassword }
  from '../paquetes/usuarios/src/ServicioAutenticacion.js';
import {
  ErrorPoliticaPasswordRecuperacion,
  ServicioSustitucionPasswordRecuperacionEmail
} from '../paquetes/usuarios/src/ServicioSustitucionPasswordRecuperacionEmail.js';
import { ServicioContinuacionWebRecuperacionPasswordEmail }
  from '../paquetes/usuarios/src/ServicioContinuacionWebRecuperacionPasswordEmail.js';
import { ControladorRecuperacionPassword }
  from '../apps/sentinelia-web/src/controladores/ControladorRecuperacionPassword.js';

const TOKEN = 'b'.repeat(43);

await main();

async function main() {
  await verificarAdaptacionDeConsumo();
  await verificarPoliticaAntesDeReserva();
  await verificarCambioWebSinSesion();
  await verificarPoliticaYFalloTecnico();
  await verificarComposicion();
  console.log('[usuarios] OK 5.30.7c: password=politica_comun reserva=posterior sql=atomico convergencia=6c sesion=no_creada doble_submit=cerrado csrf=obligatorio');
}

async function verificarAdaptacionDeConsumo() {
  const llamadas = [];
  const servicio = new ServicioContinuacionWebRecuperacionPasswordEmail({
    repositorioSolicitudes: { inspeccionar: async () => ({}) },
    servicioResolucion: { resolver: async () => ({}) },
    servicioConsumo: {
      async sustituirYConverger(entrada) {
        llamadas.push(entrada);
        return { estado: 'sustituida', sustituida: true,
          convergencia: 'pendiente', usuarioId: 'dato-privado' };
      }
    },
    servicioConfiguracionPortal: configuracionFixture()
  });
  assert.deepEqual(await servicio.sustituir({
    token: TOKEN,
    passwordNuevo: 'ClaveSegura530!',
    passwordConfirmacion: 'ClaveSegura530!'
  }), { estado: 'sustituida', sustituida: true, convergencia: 'pendiente' });
  assert.equal(llamadas[0].leaseSegundos, 23);
  assert.equal(JSON.stringify(await servicio.sustituir({ token: 'mal' }))
    .includes('dato-privado'), false);
}

async function verificarPoliticaAntesDeReserva() {
  let reservas = 0;
  const servicio = new ServicioSustitucionPasswordRecuperacionEmail({
    repositorioSolicitudes: {
      async reservarConsumo() { reservas += 1; return { estado: 'ausente' }; },
      async inspeccionar() {}, async restaurarConsumo() {},
      async retirarIdentidad() {}
    },
    repositorioUsuarios: {
      async bloquearIdentidadElegibleRecuperacionEnTransaccion() {},
      async sustituirPasswordPorRecuperacionEnTransaccion() {},
      async buscarPorIdEnTransaccion() {}
    },
    repositorioSesionesWeb: {
      async invalidarVigentesPorUsuariosEnTransaccion() {}
    },
    repositorioAuditoria: {
      async existeTestigoEventoEnTransaccion() {},
      async incorporarEnTransaccion() {}
    },
    repositorioCoordinacionCorreo: {
      async crearNotificacionSeguridadEnTransaccion() {}
    },
    servicioAutenticacion: {
      validarPasswordNueva() {
        throw new ErrorValidacionPassword('La clave no cumple la política.');
      },
      async crearHashPassword() {}
    },
    servicioConfiguracionPortal: configuracionFixture(),
    fronteraTransaccional: { async ejecutar() {} },
    propietario: 'fixture-web-5.30.7c',
    generarId: generarUuidV7Auditoria
  });
  await assert.rejects(() => servicio.sustituir({
    token: TOKEN, passwordNuevo: 'x', passwordConfirmacion: 'x',
    leaseSegundos: 23
  }), ErrorPoliticaPasswordRecuperacion);
  assert.equal(reservas, 0);
}

async function verificarCambioWebSinSesion() {
  const estado = crearEstadoControlador();
  const controlador = crearControlador(estado);
  const respuesta = crearRespuesta();
  await controlador.sustituirPassword({
    body: { password_nuevo: 'ClaveSegura530!',
      password_confirmacion: 'ClaveSegura530!' }
  }, respuesta);
  assert.equal(respuesta.estadoHttp, 200);
  assert.equal(respuesta.datos.completada, true);
  assert.equal(respuesta.datos.disponible, false);
  assert.deepEqual(estado.llamadas.map(([tipo]) => tipo), ['sustituir', 'limpiar']);
  assert.equal(estado.sesionesAutenticadas, 0);
  assert.equal(JSON.stringify(respuesta.datos).includes(TOKEN), false);

  const limpiezaFallida = crearEstadoControlador();
  limpiezaFallida.errorLimpieza = new Error('redis de sesión caído');
  const respuestaLimpieza = crearRespuesta();
  await crearControlador(limpiezaFallida).sustituirPassword({ body: {} },
    respuestaLimpieza);
  assert.equal(respuestaLimpieza.datos.completada, true,
    'una limpieza Redis postcommit no desmiente la credencial nueva');

  estado.continuacion = null;
  const repetida = crearRespuesta();
  await controlador.sustituirPassword({ body: {} }, repetida);
  assert.equal(repetida.estadoHttp, 400);
  assert.match(repetida.datos.mensaje, /No se puede continuar/u);
}

async function verificarPoliticaYFalloTecnico() {
  const estado = crearEstadoControlador();
  estado.error = new ErrorPoliticaPasswordRecuperacion('Mínimo de prueba.');
  const controlador = crearControlador(estado);
  const politica = crearRespuesta();
  await controlador.sustituirPassword({ body: {} }, politica);
  assert.equal(politica.estadoHttp, 400);
  assert.equal(politica.datos.resuelta, true);
  assert.equal(politica.datos.error, 'Mínimo de prueba.');
  assert.equal(estado.llamadas.some(([tipo]) => tipo === 'limpiar'), false);

  estado.error = new Error('sql no disponible');
  const tecnica = crearRespuesta();
  await controlador.sustituirPassword({ body: {} }, tecnica);
  assert.equal(tecnica.estadoHttp, 503);
  assert.equal(tecnica.datos.disponible, false);
}

async function verificarComposicion() {
  const [rutas, index, vista] = await Promise.all([
    leer('../apps/sentinelia-web/src/rutas/crearRutasPortal.js'),
    leer('../apps/sentinelia-web/src/index.js'),
    leer('../apps/sentinelia-web/src/views/recuperacion-password-resolucion.ejs')
  ]);
  assert.match(rutas,
    /router\.post\(\s*'\/recuperacion-password\/password',\s*validarCsrfPortal/u);
  assert.match(index, /ServicioSustitucionPasswordRecuperacionEmail/u);
  assert.match(index, /ServicioConvergenciaConsumoRecuperacionPasswordEmail/u);
  assert.match(vista, /autocomplete="new-password"/u);
  assert.doesNotMatch(vista, /name="token"/u);
  ejs.compile(vista, {
    filename: new URL('../apps/sentinelia-web/src/views/recuperacion-password-resolucion.ejs', import.meta.url).pathname
  });
}

function crearControlador(estado) {
  const servicioSesion = {
    asegurarTokenCsrfPublico: async () => 'csrf-publico',
    guardarContinuacionRecuperacionPassword: async () => true,
    obtenerContinuacionRecuperacionPassword: () => estado.continuacion,
    marcarIdentidadResueltaRecuperacionPassword: async () => true,
    async limpiarContinuacionRecuperacionPassword() {
      estado.llamadas.push(['limpiar']);
      if (estado.errorLimpieza) throw estado.errorLimpieza;
      estado.continuacion = null;
    },
    async crearSesionUsuario() { estado.sesionesAutenticadas += 1; }
  };
  return new ControladorRecuperacionPassword({
    servicioInicio: { emitirDesafio: async () => ({}), iniciar: async () => ({}) },
    servicioContinuacion: {
      inspeccionar: async () => ({ utilizable: true }),
      resolver: async () => ({ resuelta: true }),
      async sustituir(entrada) {
        estado.llamadas.push(['sustituir', entrada]);
        if (estado.error) throw estado.error;
        return { estado: 'sustituida', sustituida: true,
          convergencia: 'completa' };
      }
    },
    servicioSesion,
    superficiePublicaHabilitada: () => false
  });
}

function crearEstadoControlador() {
  return {
    llamadas: [], error: null, errorLimpieza: null, sesionesAutenticadas: 0,
    continuacion: { token: TOKEN, identidadResuelta: true }
  };
}

function crearRespuesta() {
  return {
    locals: {}, cabeceras: {}, estadoHttp: 200,
    status(valor) { this.estadoHttp = valor; return this; },
    set(clave, valor) { this.cabeceras[clave] = valor; return this; },
    render(vista, datos) { this.vista = vista; this.datos = datos; return this; }
  };
}

function configuracionFixture() {
  return {
    async asegurarActualizada() {},
    obtenerConfiguracionActual: () => ({
      obtenerConfiguracionUsuarios: () => ({
        recuperacionEmailLeaseAlegacionSegundos: 17,
        recuperacionEmailLeaseConsumoSegundos: 23
      }),
      obtenerNombreVisiblePortal: () => 'Sentinelia'
    })
  };
}

function leer(relativa) {
  return readFile(new URL(relativa, import.meta.url), 'utf8');
}

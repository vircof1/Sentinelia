import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import ejs from 'ejs';

import {
  RecuperacionPasswordNoHabilitable,
  ServicioDisponibilidadRecuperacionPasswordEmail
} from '../paquetes/usuarios/src/ServicioDisponibilidadRecuperacionPasswordEmail.js';
import { ControladorLogin }
  from '../apps/sentinelia-web/src/controladores/ControladorLogin.js';

await main();

async function main() {
  await verificarDisponibilidadDerivada();
  await verificarIntencionConDependenciasPerdidas();
  await verificarPresentacionLogin();
  await verificarComposicionHumana();
  console.log('[usuarios] OK 5.30.7d: intencion=durable disponibilidad=derivada smtp+https+presencia=obligatorios login=condicional bearers=no_revocados configuracion=explicita');
}

async function verificarDisponibilidadDerivada() {
  const disponible = crearDisponibilidad({
    activa: true, smtp: true, origen: 'https://sentinelia.example.test',
    presencia: true
  });
  const estado = await disponible.evaluar();
  assert.equal(estado.intencionHabilitada, true);
  assert.equal(estado.puedeHabilitar, true);
  assert.equal(estado.disponible, true);
  assert.equal(estado.dependencias.length, 3);
  assert.equal(estado.parametros.recuperacionEmailVigenciaSegundos, 1200);

  for (const variante of [
    { smtp: false }, { origen: 'http://inseguro.test' }, { presencia: false }
  ]) {
    const incompleta = await crearDisponibilidad({
      activa: true, smtp: true, origen: 'https://seguro.test',
      presencia: true, ...variante
    }).evaluar();
    assert.equal(incompleta.disponible, false);
    assert.equal(incompleta.puedeHabilitar, false);
  }
}

async function verificarIntencionConDependenciasPerdidas() {
  const nueva = crearDisponibilidad({ activa: false, smtp: false,
    origen: '', presencia: false });
  await assert.rejects(() => nueva.validarCambioIntencion('true'),
    RecuperacionPasswordNoHabilitable);
  await nueva.validarCambioIntencion('false');

  const yaHabilitada = crearDisponibilidad({ activa: true, smtp: false,
    origen: '', presencia: false });
  const conservada = await yaHabilitada.validarCambioIntencion('true');
  assert.equal(conservada.intencionHabilitada, true);
  assert.equal(conservada.disponible, false,
    'perder requisitos no reescribe la intención durable');
}

async function verificarPresentacionLogin() {
  const visible = await renderizarLogin(true);
  assert.equal(visible.datos.recuperacionPasswordDisponible, true);
  const oculta = await renderizarLogin(false);
  assert.equal(oculta.datos.recuperacionPasswordDisponible, false);
}

async function verificarComposicionHumana() {
  const [vistaConfiguracion, vistaLogin, javascript, controladorPortal,
    controladorRecuperacion, index] = await Promise.all([
    leer('../apps/sentinelia-web/src/views/portal/configuracion.ejs'),
    leer('../apps/sentinelia-web/src/views/login.ejs'),
    leer('../apps/sentinelia-web/src/public/js/configuracion.js'),
    leer('../apps/sentinelia-web/src/controladores/ControladorPortal.js'),
    leer('../apps/sentinelia-web/src/controladores/ControladorRecuperacionPassword.js'),
    leer('../apps/sentinelia-web/src/index.js')
  ]);
  assert.match(vistaConfiguracion, /data-recuperacion-password/u);
  assert.match(vistaConfiguracion, /modal-recuperacion-no-habilitable/u);
  assert.match(vistaConfiguracion, /Los enlaces emitidos anteriormente conservan/u);
  assert.match(javascript, /interceptarHabilitacionRecuperacion/u);
  assert.match(javascript, /campo\.value = 'false'/u);
  assert.match(vistaLogin, /href="\/recuperar-password"/u);
  assert.match(controladorPortal, /validarCambioIntencion/u);
  assert.match(controladorRecuperacion,
    /await this\.superficiePublicaHabilitada\(\)/u);
  assert.match(index, /presenciaPreparada:\s*async \(\) =>/u);
  assert.match(index, /resolverUnanimidadRecuperacionPasswordEmail/u);
  assert.doesNotMatch(vistaConfiguracion, /revocar solicitud/iu);
  ejs.compile(vistaConfiguracion, {
    filename: new URL('../apps/sentinelia-web/src/views/portal/configuracion.ejs', import.meta.url).pathname
  });
  ejs.compile(vistaLogin, {
    filename: new URL('../apps/sentinelia-web/src/views/login.ejs', import.meta.url).pathname
  });
}

function crearDisponibilidad({ activa, smtp, origen, presencia }) {
  return new ServicioDisponibilidadRecuperacionPasswordEmail({
    servicioConfiguracionPortal: {
      async asegurarActualizada() {},
      obtenerConfiguracionActual: () => ({
        obtenerConfiguracionUsuarios: () => ({
          recuperacionEmailActiva: activa,
          recuperacionEmailVigenciaSegundos: 1200
        }),
        obtenerOrigenPublicoPortal: () => origen
      })
    },
    servicioCorreoPortal: {
      async obtenerEstadoConfiguracionAutoritativo() {
        return { operativo: smtp };
      }
    },
    presenciaPreparada: () => presencia
  });
}

async function renderizarLogin(disponible) {
  const controlador = new ControladorLogin({
    servicioAutenticacion: {},
    servicioSesion: {
      asegurarTokenCsrfPublico: async () => 'csrf-publico'
    },
    configuracionSesion: {},
    servicioPow: {},
    servicioDisponibilidadRecuperacionPassword: {
      async evaluar() { return { disponible }; }
    }
  });
  const respuesta = {
    locals: {},
    render(vista, datos) { this.vista = vista; this.datos = datos; }
  };
  await controlador.mostrarFormulario({ session: {} }, respuesta, assert.fail);
  assert.equal(respuesta.vista, 'login');
  return respuesta;
}

function leer(relativa) {
  return readFile(new URL(relativa, import.meta.url), 'utf8');
}

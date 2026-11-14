import assert from 'node:assert/strict';

import {
  CAPACIDADES_RUNTIME_RECUPERACION_PASSWORD_EMAIL,
  CAPACIDADES_WEB_RECUPERACION_PASSWORD_EMAIL,
  crearDeclaracionCapacidadesRuntimeRecuperacionPasswordEmail,
  crearDeclaracionCapacidadesWebRecuperacionPasswordEmail
} from '../paquetes/usuarios/src/CapacidadesDespliegueRecuperacionPasswordEmail.js';
import { ServicioDisponibilidadRecuperacionPasswordEmail }
  from '../paquetes/usuarios/src/ServicioDisponibilidadRecuperacionPasswordEmail.js';

await main();

async function main() {
  verificarDeclaracionesAisladas();
  await verificarDosWebCerradas();
  console.log(
    '[usuarios] OK 5.30.8a: declaraciones=2web+2runtime ' +
    'presencia=no_preparada disponibilidad=cerrada'
  );
}

function verificarDeclaracionesAisladas() {
  const webs = ['web-a', 'web-b'].map((instanciaId) =>
    crearDeclaracionCapacidadesWebRecuperacionPasswordEmail({ instanciaId }));
  const runtimes = ['runtime-a', 'runtime-b'].map((instanciaId) =>
    crearDeclaracionCapacidadesRuntimeRecuperacionPasswordEmail({ instanciaId }));

  assert.deepEqual(webs.map(({ instanciaId }) => instanciaId), ['web-a', 'web-b']);
  assert.deepEqual(runtimes.map(({ instanciaId }) => instanciaId),
    ['runtime-a', 'runtime-b']);
  for (const declaracion of webs) {
    assert.equal(declaracion.familia, 'recuperacion_password_email');
    assert.equal(declaracion.rol, 'web');
    assert.deepEqual(declaracion.capacidades,
      CAPACIDADES_WEB_RECUPERACION_PASSWORD_EMAIL);
    assert.ok(Object.isFrozen(declaracion));
  }
  for (const declaracion of runtimes) {
    assert.equal(declaracion.rol, 'runtime');
    assert.deepEqual(declaracion.capacidades,
      CAPACIDADES_RUNTIME_RECUPERACION_PASSWORD_EMAIL);
    assert.deepEqual(declaracion.capacidadesWebEmpaquetadas,
      CAPACIDADES_WEB_RECUPERACION_PASSWORD_EMAIL);
  }
  assert.throws(
    () => crearDeclaracionCapacidadesWebRecuperacionPasswordEmail(),
    /requiere instanciaId/u
  );
}

async function verificarDosWebCerradas() {
  for (const instanciaId of ['web-a', 'web-b']) {
    const servicio = new ServicioDisponibilidadRecuperacionPasswordEmail({
      servicioConfiguracionPortal: {
        async asegurarActualizada() {},
        obtenerConfiguracionActual() {
          return {
            obtenerConfiguracionUsuarios: () => ({
              recuperacionEmailActiva: true
            }),
            obtenerOrigenPublicoPortal: () => 'https://sentinelia.example'
          };
        }
      },
      servicioCorreoPortal: {
        async obtenerEstadoConfiguracionAutoritativo() {
          return { operativo: true };
        }
      },
      presenciaPreparada: () => false
    });
    const estado = await servicio.evaluar();
    assert.equal(estado.intencionHabilitada, true, instanciaId);
    assert.equal(estado.puedeHabilitar, false, instanciaId);
    assert.equal(estado.disponible, false, instanciaId);
    assert.equal(estado.dependencias.find(({ codigo }) =>
      codigo === 'despliegue').satisfecha, false);
  }
}

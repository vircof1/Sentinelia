import assert from 'node:assert/strict';
import { ControladorTriggers } from '../apps/sentinelia-web/src/controladores/ControladorTriggers.js';
import { ServicioAdministracionTriggersPortal }
  from '../apps/sentinelia-web/src/servicios/ServicioAdministracionTriggersPortal.js';

const estado = { tipo_correo_habilitado: 0 };
const servicio = new ServicioAdministracionTriggersPortal({
  servicioTriggers: {}, servicioMonitores: {},
  servicioConfiguracionPortal: {
    async asegurarActualizada() {},
    obtenerEstadoDespliegueCorreoActual() { return estado; }
  }
});
const contexto = { nivelScope: 'portal', permisos: { editarTriggers: true } };
const mensaje = 'Las acciones de correo todavía no están disponibles en esta instalación. ' +
  'Consulta con el administrador para revisar su activación.';
const destino = '/automatizacion/acciones';
const controlador = new ControladorTriggers({ servicioAdministracionTriggersPortal: servicio });

// GET real: el servicio de formulario detecta la capacidad cerrada.
await comprobarRedireccion(controlador, 'mostrarNuevo', { tipo: 'correo' });

// Otros formularios siguen funcionando sin habilitar correo.
let renderizado;
await controlador.mostrarNuevo(peticion({ tipo: 'api' }), {
  status(codigo) { assert.equal(codigo, 200); return this; },
  render(vista, datos) { renderizado = { vista, datos }; }
}, error => { throw error; });
assert.equal(renderizado.vista, 'portal/trigger-formulario');
assert.equal(renderizado.datos.formulario.tipo, 'api');
assert.ok(!renderizado.datos.opcionesTipo.some(tipo => tipo.valor === 'correo'));

// GET de edición y POST de formularios abiertos antes de cerrarse la capacidad.
for (const accion of ['mostrarEditar', 'crearTrigger', 'actualizarTrigger']) {
  let llamadas = 0;
  const fallaPorCapacidad = async () => {
    llamadas += 1;
    await servicio.exigirSuperficieCorreoHabilitada();
    assert.fail('La capacidad cerrada debe impedir continuar');
  };
  const servicioCerrado = {
    construirVistaFormulario: fallaPorCapacidad,
    crearTrigger: fallaPorCapacidad,
    actualizarTrigger: fallaPorCapacidad
  };
  await comprobarRedireccion(new ControladorTriggers({
    servicioAdministracionTriggersPortal: servicioCerrado
  }), accion, {});
  assert.equal(llamadas, 1, 'No reconstruir un formulario cerrado tras fallar el guardado');
}

// Los errores inesperados siguen llegando al manejador general.
const interno = new Error('fallo inesperado');
let recibido;
await new ControladorTriggers({ servicioAdministracionTriggersPortal: {
  async construirVistaFormulario() { throw interno; }
} }).mostrarNuevo(peticion({ tipo: 'correo' }), {
  redirect() { assert.fail('No ocultar errores distintos de capacidad cerrada'); }
}, error => { recibido = error; });
assert.equal(recibido, interno);

// La capacidad abierta no dispara la redirección: se muestra el formulario normal.
estado.tipo_correo_habilitado = 1;
await servicio.exigirSuperficieCorreoHabilitada();
let mostrado = false;
const disponible = new ControladorTriggers({ servicioAdministracionTriggersPortal: {
  async construirVistaFormulario() {
    await servicio.exigirSuperficieCorreoHabilitada();
    return { formulario: { tipo: 'correo' } };
  }
} });
await disponible.mostrarNuevo(peticion({ tipo: 'correo' }), {
  status(codigo) { assert.equal(codigo, 200); return this; },
  render(_, datos) { assert.equal(datos.formulario.tipo, 'correo'); mostrado = true; },
  redirect() { assert.fail('No redirigir cuando correo está habilitado'); }
}, error => { throw error; });
assert.ok(mostrado);
console.log('COR02_PORTAL_OK: alta y edición; capacidad cerrada al guardar; API permitida; correo habilitado; errores inesperados conservados');

function peticion(query) {
  return {
    query, params: { id: '6' },
    body: { tipo: 'correo', return_to: '/monitores/1' },
    session: {}, contextoUsuarioActual: contexto
  };
}

async function comprobarRedireccion(controladorObjetivo, accion, query) {
  const req = peticion(query);
  let redirecciones = 0;
  await controladorObjetivo[accion](req, {
    redirect(url) { assert.equal(url, destino); redirecciones += 1; },
    status() { assert.fail('No renderizar un formulario ni responder con error interno'); }
  }, error => { throw error; });
  assert.equal(redirecciones, 1);
  assert.deepEqual(req.session.flashTriggers, { tipo: 'error', mensaje });
  assert.equal(req.session.flashMonitores, undefined, 'El aviso corresponde al catálogo destino');
  assert.deepEqual(controladorObjetivo.consumirFlash(req), { tipo: 'error', mensaje });
  assert.equal(controladorObjetivo.consumirFlash(req), null, 'Consumir el aviso una sola vez');
}

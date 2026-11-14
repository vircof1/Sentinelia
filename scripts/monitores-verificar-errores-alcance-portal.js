import assert from 'node:assert/strict';
import { ServicioMonitores } from '../paquetes/monitores/src/ServicioMonitores.js';
import { Monitor } from '../paquetes/monitores/src/Monitor.js';
import { ResolutorScopeUsuario } from '../paquetes/contexto-usuario/src/ResolutorScopeUsuario.js';
import { ControladorMonitores } from '../apps/sentinelia-web/src/controladores/ControladorMonitores.js';

const contexto = { nivelScope: 'sitio', tenantId: 1, empresaId: 1, sitioId: 1 };
const monitor = new Monitor({ id: 5, nombre: 'Nombre ajeno reservado', tipo: 'ping', tenant_id: 1,
  empresa_id: 1, sitio_id: 2, activo: true, intervalo_ejecucion_segundos: 60,
  configuracion: { host: '127.0.0.1' } });
let falloRepositorio = null;
const servicio = new ServicioMonitores({
  repositorioMonitores: { async buscarPorId(id) {
    if (falloRepositorio) throw falloRepositorio;
    return id === 5 ? monitor : null;
  } },
  resolutorScopeUsuario: new ResolutorScopeUsuario()
});
const controlador = new ControladorMonitores({ servicioMonitores: servicio });

await assert.rejects(() => servicio.buscarMonitorVisible(contexto, 5), e =>
  e.codigo === 'monitor_fuera_de_alcance' && e.statusCode === 403);
await assert.rejects(() => servicio.buscarMonitorVisible(contexto, 999), e =>
  e.codigo === 'monitor_no_encontrado' && e.statusCode === 404);
assert.equal(await servicio.buscarMonitorVisible({ ...contexto, sitioId: 2 }, 5), monitor);
assert.equal(await servicio.buscarMonitorVisible({ esOperadorSistema: true }, 5), monitor);

for (const [id, estado, plantilla] of [[5, 403, 'portal/forbidden'], [999, 404, 'portal/no-encontrado']]) {
  const resultado = await ejecutar(controlador, 'mostrarDetalleMonitor', contexto, id);
  assert.equal(resultado.estado, estado);
  assert.equal(resultado.plantilla, plantilla);
  assert.equal(resultado.cache, 'no-store');
  assert.ok(!JSON.stringify(resultado.datos).includes(monitor.nombre));
  assert.ok(!Object.hasOwn(resultado.datos, 'monitor'));
  if (estado === 403) assert.match(resultado.datos.motivoAlcance, /alcance/);
}

// Edición reutiliza las mismas respuestas, sin construir un formulario ajeno.
const editor = new ControladorMonitores({ servicioMonitores: {
  async construirVistaFormulario(ctx, { idMonitor }) {
    await servicio.buscarMonitorVisible(ctx, idMonitor);
    assert.fail('En este caso no se debe preparar un formulario');
  }
} });
for (const [id, estado] of [[5, 403], [999, 404]]) {
  assert.equal((await ejecutar(editor, 'mostrarEditarMonitor', contexto, id)).estado, estado);
}

// Un monitor visible sigue usando su detalle normal.
const visible = await ejecutar(controlador, 'mostrarDetalleMonitor', { ...contexto, sitioId: 2 }, 5);
assert.equal(visible.plantilla, 'portal/monitor-detalle');
assert.equal(visible.datos.monitor.nombre, monitor.nombre);

// Fallos inesperados no se convierten en una denegación de alcance.
falloRepositorio = new Error('fallo SQL simulado');
let recibido;
await controlador.mostrarDetalleMonitor(peticion(contexto, 5), {
  render() { assert.fail('No ocultar un fallo inesperado'); },
  status() { assert.fail('No asignar un estado de alcance a un fallo inesperado'); }
}, error => { recibido = error; });
assert.equal(recibido, falloRepositorio);
console.log('OP02_PORTAL_OK: alcance real 403; inexistente 404; plantillas existentes; detalle y edición; visible permitido; errores internos conservados');

function peticion(ctx, id) {
  return { contextoUsuarioActual: ctx, params: { id: String(id) }, query: {},
    session: { usuarioAutenticado: { usuario: 'operador' } }, originalUrl: `/monitores/${id}` };
}
async function ejecutar(ctrl, accion, ctx, id) {
  const resultado = {};
  await ctrl[accion](peticion(ctx, id), {
    status(estado) { resultado.estado = estado; return this; },
    set(nombre, valor) { assert.equal(nombre, 'Cache-Control'); resultado.cache = valor; return this; },
    render(plantilla, datos) { resultado.plantilla = plantilla; resultado.datos = datos; }
  }, error => { throw error; });
  return resultado;
}

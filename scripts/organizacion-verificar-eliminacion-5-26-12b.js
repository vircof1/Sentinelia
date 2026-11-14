import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import {
  crearMiddlewareInyectarSesionVista
} from '../apps/sentinelia-web/src/middleware/inyectarSesionVista.js';

const leer = (ruta) => readFile(new URL(ruta, import.meta.url), 'utf8');

function verificarCapacidadVista() {
  for (const [agentes, organizaciones, esperado] of [
    [false, false, { agentes: false, organizaciones: false }],
    [true, false, { agentes: true, organizaciones: false }],
    [false, true, { agentes: false, organizaciones: true }]
  ]) {
    const middleware = crearMiddlewareInyectarSesionVista({
      eliminacionAdministrativaAgentesHttpHabilitada: agentes,
      eliminacionAdministrativaOrganizacionesHttpHabilitada: organizaciones
    });
    const respuesta = { locals: {} };
    let continuo = false;
    middleware({ query: {}, path: '/organizacion/tenants' }, respuesta, () => {
      continuo = true;
    });
    assert.equal(continuo, true);
    assert.equal(
      respuesta.locals.capacidadesPortal.eliminacionAdministrativaAgentes,
      esperado.agentes
    );
    assert.equal(
      respuesta.locals.capacidadesPortal.eliminacionAdministrativaOrganizaciones,
      esperado.organizaciones
    );
  }
}

async function verificarListados() {
  const definiciones = [
    {
      tipo: 'tenant',
      plural: 'tenants',
      vista: '../apps/sentinelia-web/src/views/portal/organizacion-tenants.ejs',
      script: '../apps/sentinelia-web/src/public/js/organizacion-tenants.js'
    },
    {
      tipo: 'empresa',
      plural: 'empresas',
      vista: '../apps/sentinelia-web/src/views/portal/organizacion-empresas.ejs',
      script: '../apps/sentinelia-web/src/public/js/organizacion-empresas.js'
    },
    {
      tipo: 'sitio',
      plural: 'sitios',
      vista: '../apps/sentinelia-web/src/views/portal/organizacion-sitios.ejs',
      script: '../apps/sentinelia-web/src/public/js/organizacion-sitios.js'
    }
  ];
  for (const definicion of definiciones) {
    const [vista, script] = await Promise.all([
      leer(definicion.vista),
      leer(definicion.script)
    ]);
    assert.match(
      vista,
      /data-eliminacion-durable="<%= capacidadesPortal\?\.eliminacionAdministrativaOrganizaciones/u,
      definicion.tipo
    );
    assert.match(script, /data-organizacion-durable="true"/u);
    assert.match(
      script,
      new RegExp(`/api/organizacion/${definicion.tipo}/\\$\\{encodeURIComponent\\(item\\.id\\)\\}/eliminacion`, 'u')
    );
    assert.doesNotMatch(
      script,
      new RegExp(`/organizacion/${definicion.plural}/eliminar`, 'u')
    );
    assert.match(script, /eliminacionDurable && item\.puedeEliminar/u);
    assert.match(script, new RegExp(`data-organizacion-tipo="${definicion.tipo}"`, 'u'));
  }
}

async function verificarModalDurable() {
  const [modal, script, cabecera, aplicacion, indice] = await Promise.all([
    leer('../apps/sentinelia-web/src/views/portal/parciales/organizacion-modal-eliminacion.ejs'),
    leer('../apps/sentinelia-web/src/public/js/organizacion-eliminacion.js'),
    leer('../apps/sentinelia-web/src/views/parciales/cabecera.ejs'),
    leer('../apps/sentinelia-web/src/crearAplicacion.js'),
    leer('../apps/sentinelia-web/src/index.js')
  ]);
  for (const marca of [
    'data-organizacion-token-confirmacion',
    'data-organizacion-impacto-durable',
    'data-organizacion-impacto-eliminacion',
    'data-organizacion-impacto-historico',
    'data-organizacion-impacto-conservado',
    'data-organizacion-frase-exacta',
    'data-organizacion-frase-confirmacion',
    'data-organizacion-estado-confirmacion'
  ]) {
    assert.match(modal, new RegExp(marca, 'u'));
  }
  assert.match(
    script,
    /impacto\.resumenImpacto\?\.conteos/u,
    'El modal debe leer los conteos del resumen tipado, no tratar el resumen como un array.'
  );
  assert.doesNotMatch(
    script,
    /Array\.isArray\(impacto\.resumenImpacto\)/u,
    'El resumen de impacto es un objeto de contrato, no una lista.'
  );
  assert.match(script, /impacto\.tokenConfirmacion/u);
  assert.match(script, /inputFrase\.value === fraseExacta/u);
  assert.match(script, /texto: modoDurable \? 'Iniciar eliminación'/u);
  assert.match(script, /filas\.filter\(tieneCantidad\)/u);
  assert.match(script, /item\.categoria === 'correo_aceptado_preservadas'/u);
  assert.match(script, /esCategoriaHistorica\(item\.categoria\)/u);
  assert.match(script, /item\.precision === 'minima'/u);
  assert.match(script, /new Intl\.NumberFormat\('es-ES'\)/u);
  assert.doesNotMatch(script, /Eliminación encolada|Encolar eliminación/u);
  assert.match(script, /const aceptacionDurable = modoDurable/u);
  assert.match(script, /if \(aceptacionDurable\) \{[\s\S]{0,500}mostrarSeguimientoEncolado/u);
  assert.match(script, /La fila permanece visible hasta que una recarga confirme el borrado/u);
  assert.match(script, /datos\.urlSeguimiento/u);
  assert.match(script, /data-organizacion-abrir-buzon/u);
  assert.match(script, /portal:buzon-usuario-actualizado/u);
  const ramaDurable = script.indexOf('if (aceptacionDurable)');
  const eventoCompletada = script.indexOf("new CustomEvent('organizacion:eliminacion-completada'");
  assert.ok(ramaDurable >= 0 && eventoCompletada > ramaDurable);
  assert.match(script.slice(ramaDurable, eventoCompletada), /return;/u);
  assert.match(script, /cargaImpactoSecuencia/u);
  assert.match(script, /secuenciaAceptacion === cargaImpactoSecuencia/u);
  assert.match(script, /if \(modalVigente\) \{[\s\S]{0,180}modal\.hide\(\)/u);
  assert.match(
    cabecera,
    /capacidadesPortal\?\.eliminacionAdministrativaOrganizaciones/u
  );
  assert.match(
    aplicacion,
    /crearMiddlewareInyectarSesionVista\([\s\S]{0,300}eliminacionAdministrativaOrganizacionesHttpHabilitada/u
  );
  assert.match(
    indice,
    /eliminacionAdministrativaOrganizacionesHttpHabilitada:[\s\S]{0,100}activacionEliminacionAdministrativaOrganizaciones\.habilitada/u
  );
}

verificarCapacidadVista();
await verificarListados();
await verificarModalDurable();

console.log(
  '[organizacion] OK 5.26.12b: modal=impacto_durable frase=exacta estimaciones=tipadas aceptacion=202 fila=visible seguimiento=enlazado buzon=actualizado fallback=retirado'
);

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { RepositorioTriggers } from '../paquetes/triggers/src/RepositorioTriggers.js';
import { ServicioAdministracionTriggersPortal }
  from '../apps/sentinelia-web/src/servicios/ServicioAdministracionTriggersPortal.js';

const consultas = [];
const clienteSql = {
  async consultar(sql, parametros = []) {
    consultas.push({ sql, parametros });
    assert.match(sql, /WHERE t\.tenant_id = \?/u);
    assert.equal(parametros[0], 7);

    if (/SELECT COUNT\(\*\) AS total/u.test(sql)) {
      assert.deepEqual(parametros, [7]);
      return [{ total: 1 }];
    }

    if (/COUNT\(\*\) AS total_triggers/u.test(sql)) {
      assert.deepEqual(parametros, [7]);
      return [{
        total_triggers: 1,
        total_activos: 1,
        total_inactivos: 0,
        total_api: 1,
        total_dns: 0,
        total_correo: 0
      }];
    }

    assert.match(sql, /LIMIT \? OFFSET \?/u);
    assert.deepEqual(parametros, [7, 10, 0]);
    return [{
      id: 41,
      tenant_id: 7,
      empresa_id: null,
      sitio_id: null,
      nombre: 'Accion visible del tenant',
      tipo: 'api',
      descripcion: null,
      activo: 1,
      configuracion: JSON.stringify({
        url: 'https://example.test/hook',
        metodo: 'POST'
      }),
      revision_declaracion: 1,
      fecha_creacion: '2026-09-11 00:00:00',
      fecha_actualizacion: '2026-09-11 00:00:00',
      tenant_nombre: 'Tenant visible',
      empresa_nombre: null,
      sitio_nombre: null
    }];
  }
};

const repositorio = new RepositorioTriggers(clienteSql);
const resultado = await repositorio.listarPaginadoVisible({
  nivelScope: 'tenant',
  tenantId: 7,
  empresaId: null,
  sitioId: null
});

assert.equal(resultado.paginacion.totalVisible, 1);
assert.equal(resultado.paginacion.totalFiltrado, 1);
assert.equal(resultado.triggers.length, 1);
assert.equal(resultado.triggers[0].id, 41);
assert.equal(resultado.triggers[0].tenantId, 7);
assert.equal(consultas.length, 3);

const filtroTenantDesdeDirectorio = repositorio.construirConsultaListadoVisible(
  { nivelScope: 'portal' },
  { tenantId: '7', tipo: 'api' }
);
assert.match(filtroTenantDesdeDirectorio.where, /t\.tenant_id = \?/u);
assert.match(filtroTenantDesdeDirectorio.where, /t\.tipo = \?/u);
assert.deepEqual(filtroTenantDesdeDirectorio.parametros, [7, 'api']);

const filtroEmpresaDesdeDirectorio = repositorio.construirConsultaListadoVisible(
  { nivelScope: 'portal' },
  { tenantId: '7', empresaId: '12' }
);
assert.match(filtroEmpresaDesdeDirectorio.where, /t\.tenant_id = \?/u);
assert.match(filtroEmpresaDesdeDirectorio.where, /t\.empresa_id = \?/u);
assert.deepEqual(filtroEmpresaDesdeDirectorio.parametros, [7, 12]);

const servicio = new ServicioAdministracionTriggersPortal({});
assert.deepEqual(
  servicio.construirAlcanceActual({ nivelScope: 'portal' }),
  { nivelScope: 'portal', descripcion: 'Portal completo' }
);
assert.deepEqual(
  servicio.construirAlcanceActual({ nivelScope: 'tenant', tenantId: 7 }),
  { nivelScope: 'tenant', descripcion: 'Tenant #7' }
);
assert.deepEqual(
  servicio.construirAlcanceActual({
    nivelScope: 'empresa',
    tenantId: 7,
    tenantNombre: 'Tenant Norte',
    empresaId: 12,
    empresaNombre: 'Decoración Rachel'
  }),
  { nivelScope: 'empresa', descripcion: 'Empresa: Decoración Rachel' }
);

const vistaTenantNombrada = await new ServicioAdministracionTriggersPortal({
  repositorioTenants: {
    async listarVisibles() {
      return [{ id: 7, nombre: 'Tenant Norte' }];
    }
  },
  repositorioEmpresas: {
    async listarVisibles() {
      return [];
    }
  }
}).construirVistaListadoAjaxShell({
  nivelScope: 'tenant',
  tenantId: 7
});
assert.deepEqual(vistaTenantNombrada.alcanceActual, {
  nivelScope: 'tenant',
  descripcion: 'Tenant: Tenant Norte'
});

const copyCatalogoAcciones = await Promise.all([
  readFile(new URL(
    '../apps/sentinelia-web/src/public/js/triggers.js',
    import.meta.url
  ), 'utf8'),
  readFile(new URL(
    '../apps/sentinelia-web/src/views/portal/triggers.ejs',
    import.meta.url
  ), 'utf8')
]).then((contenidos) => contenidos.join('\n'));
const cssCatalogoAcciones = await readFile(new URL(
  '../apps/sentinelia-web/src/public/css/portal.css',
  import.meta.url
), 'utf8');
assert.match(copyCatalogoAcciones, /const tiposAccionCreables/u);
assert.match(copyCatalogoAcciones, /api: \{ etiqueta: 'Llamada API'/u);
assert.match(copyCatalogoAcciones, /dns: \{ etiqueta: 'Mutación DNS'/u);
assert.match(copyCatalogoAcciones, /data-triggers-empresa/u);
assert.match(copyCatalogoAcciones, /parametros\.set\('empresa_id', estado\.empresaId\)/u);
assert.match(copyCatalogoAcciones, /correo: \{ etiqueta: 'Correo electrónico'/u);
assert.match(
  copyCatalogoAcciones,
  /\/monitores\/triggers\/nuevo\?tipo=<%= tipoAccion\.valor %>/u
);
assert.match(copyCatalogoAcciones, /Explorar catálogo/u);
assert.match(copyCatalogoAcciones, /paginacion\.totalVisible/u);
assert.match(copyCatalogoAcciones, /filtro-orden-listado/u);
assert.match(copyCatalogoAcciones, /data-triggers-tenant/u);
assert.match(copyCatalogoAcciones, /parametros\.set\('tenant_id', estado\.tenantId\)/u);
assert.match(copyCatalogoAcciones, />Acciones</u);
assert.match(copyCatalogoAcciones, />Ver uso operativo…</u);
assert.match(copyCatalogoAcciones, />Crear vínculo</u);
assert.doesNotMatch(copyCatalogoAcciones, /data-triggers-aplicar/u);
assert.match(
  cssCatalogoAcciones,
  /\.modal-uso-trigger \.organizacion-entidad__icono\s*\{[^}]*display:\s*inline-grid;[^}]*font-size:\s*17px;[^}]*place-items:\s*center;/su,
  'Los iconos del uso operativo deben conservar tamaño y centrado propios'
);
assert.match(
  cssCatalogoAcciones,
  /\.modal-uso-trigger__kpi > div > span/u,
  'El estilo textual del KPI no debe alcanzar al contenedor de su icono'
);
for (const copyInternoFiltrado of [
  /Integraciones API/iu,
  /La ID sigue funcionando/iu,
  /No hay triggers/iu,
  /Cargando triggers/iu,
  /Nuevo trigger/iu,
  /Trigger DNS/iu,
  /Uso operativo del trigger/iu,
  /Ver trigger/iu,
  /Trigger oculto/iu,
  /monitor-trigger/iu,
  /Monitor, trigger/iu
]) {
  assert.doesNotMatch(copyCatalogoAcciones, copyInternoFiltrado);
}

console.log('[triggers] OK listado visible: scope y paginacion conservan parametros alineados');

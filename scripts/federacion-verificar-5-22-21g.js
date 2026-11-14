import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import { ServicioCapturaIncrementalFamiliasFederacion }
  from '../paquetes/federacion/aplicacion/ServicioCapturaIncrementalFamiliasFederacion.js';

const FLUJO_A = 'sfid1.flujo.01j7w000000000000000000001';
const FLUJO_B = 'sfid1.flujo.01j7w000000000000000000002';
const FLUJO_C = 'sfid1.flujo.01j7w000000000000000000003';
const GENERACION_A = 'sfid1.generacion.01j7w000000000000000000001';
const GENERACION_B = 'sfid1.generacion.01j7w000000000000000000002';
const GENERACION_C = 'sfid1.generacion.01j7w000000000000000000003';

async function verificarAgrupacionYScope() {
  const conexion = new ConexionCaptura(true, [
    destino(FLUJO_A, GENERACION_A, 'portal'),
    destino(FLUJO_B, GENERACION_B, 'tenant', '1', { permiteRefederacion: true }),
    destino(FLUJO_C, GENERACION_C, 'tenant', '2')
  ]);
  const preparaciones = [];
  const persistencias = [];
  const servicio = crearServicio({ conexion, preparaciones, persistencias });
  const resultado = await servicio.capturarEnTransaccion({
    familia: 'estructuraOrganizativa',
    prepararCapturas: ({ selector }) => {
      preparaciones.push(selector);
      return capturaTenantUno();
    }
  }, { conexion });
  assert.equal(preparaciones.length, 1, 'un selector idéntico se prepara una sola vez');
  assert.equal(persistencias.length, 1, 'una ocurrencia común alimenta varias rutas');
  assert.deepEqual(
    persistencias[0].destinos.map(({ flujoId }) => flujoId),
    [FLUJO_A, FLUJO_B],
    'el scope ajeno no puede recibir la ocurrencia'
  );
  assert.equal(resultado.posiciones.length, 2);
  assert.equal(conexion.inicios, 0);
  assert.equal(conexion.commits, 0);
}

async function verificarDesactivacionNoBloqueante() {
  const conexion = new ConexionCaptura(false, [destino(FLUJO_A, GENERACION_A, 'portal')]);
  const preparaciones = [];
  const persistencias = [];
  const servicio = crearServicio({ conexion, preparaciones, persistencias });
  const resultado = await servicio.capturarEnTransaccion({
    familia: 'estructuraOrganizativa',
    prepararCapturas: () => {
      preparaciones.push(true);
      return capturaTenantUno();
    }
  }, { conexion });
  assert.equal(resultado.estado, 'federacionDesactivada');
  assert.equal(preparaciones.length, 0);
  assert.equal(persistencias.length, 0);
  assert.equal(conexion.consultasDestinos, 0);
}

async function verificarSalidaPorCambioScope() {
  const conexion = new ConexionCaptura(true, [
    destino(FLUJO_A, GENERACION_A, 'tenant', '1')
  ], [{
    flujo_id: FLUJO_A,
    generacion_id: GENERACION_A,
    operacion: 'actualizacion',
    payload_canonico: JSON.stringify({
      operacion: 'actualizacion',
      scopeOrigenDeclarado: {
        nivel: 'tenant', tenantId: '1', empresaId: null, sitioId: null
      }
    })
  }]);
  const persistencias = [];
  const servicio = crearServicio({ conexion, preparaciones: [], persistencias });
  const resultado = await servicio.capturarEnTransaccion({
    familia: 'estructuraOrganizativa',
    prepararCapturas: () => ({
      ...capturaTenantUno(),
      definicion: {
        ...capturaTenantUno().definicion,
        installationOrigenId: 'sfid1.instalacion.01j7w000000000000000000001',
        elementoOrigenId: 'sfid1.elemento_origen.01j7w000000000000000000001',
        ocurrenciaOrigenId: 'sfid1.ocurrencia_origen.01j7w000000000000000000001',
        operacion: 'actualizacion',
        tiempoOrigenUtc: '2026-08-10T12:00:00.000Z',
        scopeOrigenDeclarado: {
          nivel: 'tenant', tenantId: '2', empresaId: null, sitioId: null
        },
        vigenciaRestanteMs: null,
        campos: {},
        evidenciaIntegridad: []
      }
    })
  }, { conexion });
  assert.equal(persistencias.length, 1);
  assert.equal(persistencias[0].definicion.operacion, 'salidaProyeccion');
  assert.equal(persistencias[0].definicion.scopeOrigenDeclarado.tenantId, '1');
  assert.equal(resultado.posiciones.length, 1);
}

async function verificarSalidaScopeNoSeRepite() {
  const scopeAnterior = {
    nivel: 'tenant', tenantId: '1', empresaId: null, sitioId: null
  };
  const conexion = new ConexionCaptura(true, [
    destino(FLUJO_A, GENERACION_A, 'tenant', '1')
  ], [
    {
      flujo_id: FLUJO_A,
      generacion_id: GENERACION_A,
      operacion: 'salidaProyeccion',
      payload_canonico: JSON.stringify({
        operacion: 'salidaProyeccion', scopeOrigenDeclarado: scopeAnterior
      })
    },
    {
      flujo_id: FLUJO_A,
      generacion_id: GENERACION_A,
      operacion: 'actualizacion',
      payload_canonico: JSON.stringify({
        operacion: 'actualizacion', scopeOrigenDeclarado: scopeAnterior
      })
    }
  ]);
  const persistencias = [];
  const servicio = crearServicio({ conexion, preparaciones: [], persistencias });
  const base = capturaTenantUno();
  const resultado = await servicio.capturarEnTransaccion({
    familia: 'estructuraOrganizativa',
    prepararCapturas: () => ({
      ...base,
      definicion: {
        ...base.definicion,
        installationOrigenId: 'sfid1.instalacion.01j7w000000000000000000001',
        elementoOrigenId: 'sfid1.elemento_origen.01j7w000000000000000000001',
        ocurrenciaOrigenId: 'sfid1.ocurrencia_origen.01j7w000000000000000000002',
        operacion: 'actualizacion',
        tiempoOrigenUtc: '2026-08-10T12:01:00.000Z',
        scopeOrigenDeclarado: {
          nivel: 'tenant', tenantId: '2', empresaId: null, sitioId: null
        },
        vigenciaRestanteMs: null,
        campos: {},
        evidenciaIntegridad: []
      }
    })
  }, { conexion });
  assert.equal(persistencias.length, 0,
    'la última salida terminal impide repetirla en actualizaciones posteriores');
  assert.equal(resultado.estado, 'sinDestinos');
}

async function verificarComposicionWeb() {
  const archivos = await Promise.all([
    leer('../apps/sentinelia-web/src/index.js'),
    leer('../paquetes/auditoria/src/ServicioAuditoriaOperativa.js'),
    leer('../paquetes/jerarquia-organizativa/src/ServicioCrudOrganizacionAuditable.js'),
    leer('../paquetes/jerarquia-organizativa/src/ServicioMovimientosOrganizativosAuditable.js'),
    leer('../paquetes/jerarquia-organizativa/src/ServicioEliminacionesOrganizativasAuditable.js'),
    leer('../paquetes/monitores/src/ServicioMonitores.js'),
    leer('../paquetes/triggers/src/ServicioTriggers.js'),
    leer('../paquetes/agentes/src/ServicioProvisionamientoAgentes.js'),
    leer('../paquetes/federacion/adaptadores/RepositorioTriggersInformativosLocalSql.js'),
    leer('../paquetes/federacion/adaptadores/RepositorioEstructuraOrganizativaLocalSql.js')
  ]);
  const [web, auditoria, crud, movimientos, eliminaciones, monitores,
    triggers, agentes, productorTriggers, productorEstructura] = archivos;
  assert.match(web, /new ServicioCapturaIncrementalFamiliasFederacion/u);
  assert.match(web, /repositorioAvisosPlataforma\.capturadorFederacion/u);
  assert.match(auditoria, /familia: 'auditoria'/u);
  assert.match(crud, /familia: 'estructuraOrganizativa'/u);
  assert.match(movimientos, /ESTRUCTURA_MOVIMIENTO/u);
  assert.match(eliminaciones, /ESTRUCTURA_RETIRADA/u);
  assert.match(monitores, /MONITORES_ADMINISTRACION/u);
  assert.match(monitores, /MONITORES_RETIRADA/u);
  assert.doesNotMatch(movimientos, /interfazCaptura\.prepararCapturasMovimiento/u);
  assert.doesNotMatch(eliminaciones, /interfazCaptura\.prepararRetirada/u);
  assert.doesNotMatch(monitores, /interfazCaptura\.prepararCapturasAdministracion/u);
  assert.match(triggers, /familia: 'triggersInformativos'/u);
  assert.match(agentes, /familia: 'contextoOperativoAgentesSesiones'/u);
  assert.match(productorTriggers, /asignacionId=null/u);
  assert.match(productorTriggers, /asegurarIdentidadesScopeOrganizativoFederacion/u);
  assert.match(productorEstructura,
    /export async function asegurarIdentidadesScopeOrganizativoFederacion/u);
  assert.doesNotMatch(web, /capturadorIncrementalFamiliasFederacion\.publicar/u,
    'la composición no debe publicar disponibilidad antes del commit local');
}

function crearServicio({ conexion, preparaciones, persistencias }) {
  return new ServicioCapturaIncrementalFamiliasFederacion({
    registroFamilias: {
      obtenerProductivo: ({ familia, versionFamilia }) => {
        assert.equal(familia, 'estructuraOrganizativa');
        assert.equal(versionFamilia, 1);
        return { interfaces: { captura: {} } };
      }
    },
    adaptadorCaptura: {
      capturarEnTransaccion: async (entrada, opciones) => {
        assert.equal(opciones.conexion, conexion);
        persistencias.push(entrada);
        return {
          ocurrencia: entrada.definicion,
          posiciones: entrada.destinos.map((destino, indice) => ({
            ...destino,
            posicionFlujo: String(indice + 1)
          }))
        };
      }
    }
  });
}

function capturaTenantUno() {
  return {
    prioridad: 'operativaActual',
    definicion: {
      familia: 'estructuraOrganizativa',
      familiaVersion: 1,
      scopeOrigenDeclarado: {
        nivel: 'tenant', tenantId: '1', empresaId: null, sitioId: null
      }
    }
  };
}

function destino(flujo_id, generacion_activa_id, scope_nivel,
  scope_tenant_id = null, { permiteRefederacion = false } = {}) {
  return {
    flujo_id, generacion_activa_id, scope_nivel, scope_tenant_id,
    scope_empresa_id: null, scope_sitio_id: null, version_familia: 1,
    estado_generacion: 'completa', niveles_scope: JSON.stringify(['tenant']),
    campos: JSON.stringify(['nodoOrganizativo']),
    permite_contenido_sensible: 0,
    permite_refederacion: permiteRefederacion ? 1 : 0
  };
}

class ConexionCaptura {
  constructor(activa, destinos, posicionesPrevias = []) {
    this.activa = activa;
    this.destinos = destinos;
    this.posicionesPrevias = posicionesPrevias;
    this.inicios = 0;
    this.commits = 0;
    this.consultasDestinos = 0;
  }
  async beginTransaction() { this.inicios += 1; }
  async commit() { this.commits += 1; }
  async query(sql) {
    return sql.includes('UTC_TIMESTAMP')
      ? [[{ ahora: '2026-08-10T12:00:00.000Z' }]]
      : [[{ activa: 1 }]];
  }
  async execute(sql) {
    if (sql.includes("clave='federacion.activacion'")) {
      return [[{ valor: this.activa ? 'true' : 'false' }]];
    }
    if (sql.includes('FROM flujos_federacion f')) {
      this.consultasDestinos += 1;
      return [this.destinos];
    }
    if (sql.includes('FROM posiciones_ocurrencias_flujos_federacion p')) {
      return [this.posicionesPrevias];
    }
    throw new Error(`SQL inesperado en 21g: ${sql}`);
  }
}

function leer(ruta) {
  return readFile(new URL(ruta, import.meta.url), 'utf8');
}

await verificarAgrupacionYScope();
await verificarDesactivacionNoBloqueante();
await verificarSalidaPorCambioScope();
await verificarSalidaScopeNoSeRepite();
await verificarComposicionWeb();

console.log(
  '[federacion] OK 5.22.21g: web=productores_reales ' +
  'transaccion=local+ocurrencia+outbox destinos=scope+selector ' +
  'familias=organizacion+monitores+triggers+agentes+auditoria+avisos'
);

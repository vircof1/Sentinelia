import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import ejs from 'ejs';
import { ControladorFederacion } from '../apps/sentinelia-web/src/controladores/ControladorFederacion.js';
import { ServicioAutorizacion } from '../paquetes/autorizacion/src/ServicioAutorizacion.js';
import { RepositorioMonitoresRemotosPortalSql } from '../paquetes/federacion/adaptadores/RepositorioMonitoresRemotosPortalSql.js';
import { RepositorioTriggersRemotosPortalSql } from '../paquetes/federacion/adaptadores/RepositorioTriggersRemotosPortalSql.js';
import { ServicioMonitoresRemotosFederacionPortal } from '../paquetes/federacion/aplicacion/ServicioMonitoresRemotosFederacionPortal.js';
import { ServicioTriggersRemotosFederacionPortal } from '../paquetes/federacion/aplicacion/ServicioTriggersRemotosFederacionPortal.js';

const installationOrigenId = 'sfid1.instalacion.GQHc7zWJ9TuCYT0ojATWoQ';
const triggerOrigenId = 'sfid1.elemento_origen.7UB40ag-5Ja5_HpPtFZHfg';
const monitorOrigenId = 'sfid1.elemento_origen.ypZ1OBf59W9TBiZHupQWwQ';
const proyeccionId = 'sfid1.proyeccion.sQRWXMZQvpV7G7-j1snUEw';

await verificarRepositorioAcotado();
await verificarResolucionAcotadaMonitores();
const salida = await verificarServicio();
await verificarEnlaceInversoMonitorTrigger();
await verificarControlador(salida);
await verificarPresentacion(salida);
await verificarComposicion();
console.log('UI de triggers remotos verificada: scope, saneamiento, lectura y plantilla local.');

async function verificarRepositorioAcotado() {
  const llamadas = [];
  const repositorio = new RepositorioTriggersRemotosPortalSql({
    async consultar(sql, parametros) {
      llamadas.push({ sql, parametros });
      return [];
    }
  });
  const scope = { nivel: 'empresa', tenantId: 12, empresaId: 34, sitioId: null };
  await repositorio.listarDefiniciones({ installationOrigenId, scope });
  await repositorio.listarAsignaciones({
    installationOrigenId, triggerOrigenId, scope, limite: 9999
  });
  await repositorio.listarEjecucionesTerminadas({ installationOrigenId, scope });
  await repositorio.listarAsignaciones({
    installationOrigenId, monitorOrigenId, scope
  });
  await repositorio.listarDefiniciones({
    installationOrigenId, triggerOrigenIds: [triggerOrigenId], scope
  });
  assert.equal(llamadas.length, 5);
  for (const llamada of llamadas) {
    assert.match(llamada.sql, /p\.scope_tenant_id=\?/u);
    assert.match(llamada.sql, /p\.scope_empresa_id=\?/u);
    assert.match(llamada.sql, /v\.estado_autorizacion='autorizada'/u);
    assert.ok(llamada.parametros.includes(12));
    assert.ok(llamada.parametros.includes(34));
  }
  assert.match(llamadas[1].sql, /r\.trigger_origen_id=\?/u);
  assert.ok(llamadas[1].parametros.includes(triggerOrigenId));
  assert.equal(llamadas[1].parametros.at(-1), 500);
  assert.match(llamadas[3].sql, /r\.monitor_origen_id=\?/u);
  assert.ok(llamadas[3].parametros.includes(monitorOrigenId));
  assert.match(llamadas[4].sql, /r\.trigger_origen_id IN \(\?\)/u);
  await assert.rejects(
    repositorio.listarDefiniciones({
      installationOrigenId,
      scope: { nivel: 'empresa', tenantId: 12, empresaId: null }
    }),
    (error) => error.statusCode === 403
  );
}

async function verificarEnlaceInversoMonitorTrigger() {
  const registros = registrosEjemplo();
  const llamadas = [];
  const monitor = {
    elementoOrigenId: monitorOrigenId,
    nombre: 'Monitor web federado',
    tipo: 'tcp',
    descripcion: null,
    activo: true,
    estadoActual: null
  };
  const servicio = new ServicioMonitoresRemotosFederacionPortal({
    repositorio: {
      async listar() { return [monitor]; },
      async listarReferenciasTriggers() { return []; }
    },
    repositorioTriggers: {
      async listarAsignaciones(filtros) {
        llamadas.push({ metodo: 'asignaciones', filtros });
        return registros.asignaciones;
      },
      async listarDefiniciones(filtros) {
        llamadas.push({ metodo: 'definiciones', filtros });
        return registros.definiciones;
      }
    },
    servicioAutorizacion: new ServicioAutorizacion()
  });
  const salidaMonitor = await servicio.obtener({
    nivelScope: 'empresa', tenantId: 12, empresaId: 34, sitioId: null,
    permisos: { verMonitores: true, verTriggers: true }
  }, {
    installationOrigenId,
    monitorOrigenId,
    vista: 'triggers'
  });
  assert.equal(salidaMonitor.fuenteReferenciasTriggers, 'asignacionesTriggers');
  assert.equal(salidaMonitor.referenciasTriggers.length, 1);
  assert.equal(
    salidaMonitor.referenciasTriggers[0].triggerFederado.nombre,
    'Notificar API'
  );
  assert.equal(salidaMonitor.referenciasTriggers[0].visibilidad, 'visible');
  assert.equal(llamadas[0].filtros.monitorOrigenId, monitorOrigenId);
  assert.deepEqual(llamadas[1].filtros.triggerOrigenIds, [triggerOrigenId]);
}

async function verificarResolucionAcotadaMonitores() {
  const llamadas = [];
  const repositorio = new RepositorioMonitoresRemotosPortalSql({
    async consultar(sql, parametros) {
      llamadas.push({ sql, parametros });
      return [];
    }
  });
  const scope = { nivel: 'empresa', tenantId: 12, empresaId: 34, sitioId: null };
  await repositorio.listar({
    installationOrigenId,
    scope,
    monitorOrigenIds: [monitorOrigenId],
    limite: 1
  });
  assert.equal(llamadas.length, 1);
  assert.match(llamadas[0].sql, /p\.elemento_origen_id IN \(\?\)/u);
  assert.ok(llamadas[0].parametros.includes(monitorOrigenId));
  assert.deepEqual(await repositorio.listar({
    installationOrigenId, scope, monitorOrigenIds: []
  }), []);
  assert.equal(llamadas.length, 1);
}

async function verificarServicio() {
  const llamadas = [];
  const registros = registrosEjemplo();
  const repositorio = {
    async listarDefiniciones(filtros) {
      llamadas.push({ metodo: 'definiciones', filtros });
      return registros.definiciones;
    },
    async listarAsignaciones(filtros) {
      llamadas.push({ metodo: 'asignaciones', filtros });
      return registros.asignaciones;
    },
    async listarEjecucionesTerminadas(filtros) {
      llamadas.push({ metodo: 'ejecuciones', filtros });
      return registros.ejecuciones;
    }
  };
  const servicio = new ServicioTriggersRemotosFederacionPortal({
    repositorio,
    repositorioMonitores: {
      async listar(filtros) {
        llamadas.push({ metodo: 'monitores', filtros });
        return [{
          elementoOrigenId: monitorOrigenId,
          nombre: 'Monitor web federado',
          tipo: 'tcp',
          activo: true
        }];
      }
    },
    servicioAutorizacion: new ServicioAutorizacion()
  });
  const contexto = {
    nivelScope: 'empresa', tenantId: 12, empresaId: 34, sitioId: null,
    permisos: { verTriggers: true, verMonitores: true, editarTriggers: true }
  };
  const salida = await servicio.obtener(contexto, {
    installationOrigenId,
    triggerOrigenId,
    vista: 'resumen'
  });
  assert.deepEqual(llamadas[0].filtros.scope, {
    nivel: 'empresa', tenantId: 12, empresaId: 34, sitioId: null
  });
  assert.equal(salida.triggerSeleccionado.nombre, 'Notificar API');
  assert.equal(salida.triggerSeleccionado.utilizableComoPlantilla, true);
  assert.equal(salida.triggerSeleccionado.configuracionVisible.token, undefined);
  assert.equal(salida.triggerSeleccionado.configuracionVisible.cabeceras.Authorization, undefined);
  assert.doesNotMatch(salida.triggerSeleccionado.configuracionVisible.url, /secreto/u);
  assert.equal(salida.triggerSeleccionado.contenidoSensible.estado, 'presente');
  assert.equal(salida.triggerSeleccionado.contenidoSensible.contenido, undefined);
  assert.equal(salida.ejecuciones[0].contenido.solicitud.contenido, undefined);
  assert.equal(salida.ejecuciones[0].duracionMs, 1250);
  assert.equal(salida.asignaciones[0].monitorReferencia.visibilidad, 'opaca');
  assert.equal(salida.asignaciones[0].monitorFederado.nombre, 'Monitor web federado');
  assert.equal(salida.puedeAbrirMonitores, true);
  const llamadaMonitores = llamadas.find((llamada) => llamada.metodo === 'monitores');
  assert.deepEqual(llamadaMonitores.filtros.monitorOrigenIds, [monitorOrigenId]);
  await assert.rejects(
    servicio.obtener({ ...contexto, permisos: {} }, { installationOrigenId }),
    (error) => error.statusCode === 403 && error.codigo === 'triggers_remotos_no_autorizados'
  );
  await assert.rejects(
    servicio.obtener(contexto, { installationOrigenId, vista: 'colas' }),
    (error) => error.statusCode === 400 && error.codigo === 'vista_triggers_remotos_invalida'
  );
  return salida;
}

async function verificarPresentacion(triggersRemotos) {
  const plantilla = await readFile(new URL(
    '../apps/sentinelia-web/src/views/portal/parciales/federacion-triggers-remotos.ejs',
    import.meta.url
  ), 'utf8');
  const comunes = {
    triggersRemotos,
    seccionActual: { icono: 'bi-lightning-charge' },
    subsecciones: [
      { id: 'inventario', etiqueta: 'Inventario' },
      { id: 'resumen', etiqueta: 'Resumen' },
      { id: 'asignaciones', etiqueta: 'Asignaciones' },
      { id: 'ejecuciones', etiqueta: 'Ejecuciones' }
    ],
    urlSubvista: (vista, identidad = null) => `/remoto/${vista}/${identidad || ''}`,
    contextoUsuarioActual: { permisos: { editarTriggers: true } },
    tokenCSRFPortal: 'csrf-prueba'
  };
  const resumen = ejs.render(plantilla, {
    ...comunes,
    navegacion: { subvista: 'resumen' }
  });
  assert.match(resumen, /Información operativa, no capacidad operacional/u);
  assert.match(resumen, /Crear trigger local desde plantilla/u);
  assert.match(resumen, /borrador local inactivo/u);
  assert.doesNotMatch(resumen, /secreto/u);
  const asignaciones = ejs.render(plantilla, {
    ...comunes,
    navegacion: { subvista: 'asignaciones' }
  });
  assert.match(asignaciones, /Abrir monitor federado/u);
  const ejecuciones = ejs.render(plantilla, {
    ...comunes,
    navegacion: { subvista: 'ejecuciones' }
  });
  assert.match(ejecuciones, /Solo se reciben ejecuciones terminadas/u);
  assert.doesNotMatch(ejecuciones, /payload secreto/u);
}

async function verificarControlador(triggersRemotos) {
  const llamadas = [];
  const controlador = new ControladorFederacion({
    servicioAdministracionFederacion: { obtenerPanel() {} },
    servicioExploradorDatosRemotos: {
      async obtener() {
        return {
          familias: [], filtros: {}, elementos: [],
          paginacion: { total: 0, pagina: 1, paginas: 1, limite: 100 }
        };
      }
    },
    servicioTriggersRemotos: {
      async obtener(contexto, filtros) {
        llamadas.push({ contexto, filtros });
        return triggersRemotos;
      }
    }
  });
  let renderizado = null;
  await controlador.mostrarDatosRemotos({
    query: {
      procedencia: installationOrigenId,
      vista: 'triggers',
      subvista: 'resumen',
      trigger: triggerOrigenId
    },
    contextoUsuarioActual: {
      nivelScope: 'portal',
      permisos: { verTriggers: true }
    },
    session: {}
  }, {
    set() {},
    render(vista, locales) { renderizado = { vista, locales }; }
  }, (error) => { throw error; });
  assert.equal(llamadas.length, 1);
  assert.deepEqual(llamadas[0].filtros, {
    installationOrigenId,
    triggerOrigenId,
    vista: 'resumen'
  });
  assert.equal(renderizado.vista, 'portal/federacion-datos-remotos');
  assert.equal(renderizado.locales.triggersRemotos, triggersRemotos);
  assert.equal(renderizado.locales.navegacionRemota.triggerOrigenId, triggerOrigenId);
}

async function verificarComposicion() {
  const [controlador, index, vista, parcialMonitores] = await Promise.all([
    leer('../apps/sentinelia-web/src/controladores/ControladorFederacion.js'),
    leer('../apps/sentinelia-web/src/index.js'),
    leer('../apps/sentinelia-web/src/views/portal/federacion-datos-remotos.ejs'),
    leer('../apps/sentinelia-web/src/views/portal/parciales/federacion-monitores-remotos.ejs')
  ]);
  assert.match(controlador, /servicioTriggersRemotos/u);
  assert.match(controlador, /triggerOrigenId: navegacionRemota\.triggerOrigenId/u);
  assert.match(index, /new ServicioTriggersRemotosFederacionPortal/u);
  assert.match(index, /new RepositorioTriggersRemotosPortalSql/u);
  assert.match(vista, /federacion-triggers-remotos/u);
  assert.match(parcialMonitores, /Abrir trigger federado/u);
  assert.doesNotMatch(vista, /\{ id: 'monitores', etiqueta: 'Monitores vinculados' \}/u);
}

function registrosEjemplo() {
  const comunes = {
    installationOrigenId,
    generacionId: 'sfid1.generacion.LULLs4GL7NEWwfMVsRJWBw',
    secuenciaElemento: '1',
    ocurrenciaOrigenId: 'sfid1.ocurrencia.xw2Z_1JOWuVQ7qlVK5O7hA',
    scopeRecepcion: { nivel: 'empresa', tenantId: '12', empresaId: '34', sitioId: null },
    completitud: { interpretable: 'completa', observable: 'completa', reconstruible: 'completa' },
    estadoProyeccion: { vigencia: 'vigente', soporte: 'sostenida', autorizacion: 'autorizada' }
  };
  const sensible = { estado: 'presente', contenido: { secreto: 'payload secreto' } };
  return {
    definiciones: [Object.freeze({
      ...comunes,
      proyeccionId,
      elementoOrigenId: triggerOrigenId,
      triggerOrigenId,
      tipoRegistro: 'definicion',
      payload: {
        nombre: 'Notificar API', tipo: 'api', descripcion: 'Envía una notificación', activo: true,
        configuracionOperativa: {
          url: 'https://usuario:secreto@example.test/hook?token=secreto&vista=1',
          token: 'secreto', cabeceras: { Authorization: 'Bearer secreto', Accept: 'json' }
        },
        contenidoSensible: sensible,
        scopeOrganizativo: {
          tenantElementoOrigenId: null,
          empresaElementoOrigenId: null,
          sitioElementoOrigenId: null
        }
      }
    })],
    asignaciones: [Object.freeze({
      ...comunes,
      proyeccionId: 'sfid1.proyeccion.JrYOjQOqpJJ0EUiGGokbHQ',
      elementoOrigenId: 'sfid1.elemento_origen.C-y94EJg-D7RTPxU9RtXLA',
      triggerOrigenId,
      tipoRegistro: 'asignacionMonitor',
      payload: {
        triggerOrigenId,
        monitorReferencia: { elementoOrigenId: monitorOrigenId, visibilidad: 'opaca' },
        activo: true,
        ordenEjecucion: 10,
        eventosDisparo: ['apertura_alerta'],
        configuracionOverride: { timeoutMs: 1000 },
        contenidoSensible: { estado: 'omitido', causa: 'noSeleccionado' }
      }
    })],
    ejecuciones: [Object.freeze({
      ...comunes,
      proyeccionId: 'sfid1.proyeccion.aoAe2i4HeeFJvqcgDy76DA',
      elementoOrigenId: 'sfid1.elemento_origen.qdMdJ9lFAH7XZiJ9nHWqsg',
      triggerOrigenId,
      tipoRegistro: 'ejecucionTerminada',
      payload: {
        triggerOrigenId,
        asignacionReferencia: null,
        monitorReferencia: { elementoOrigenId: monitorOrigenId, visibilidad: 'visible' },
        versionCatalogo: 'beta-1',
        eventoDisparo: 'apertura_alerta',
        estadoEjecucion: 'ok',
        tipoTrigger: 'api',
        triggerNombre: 'Notificar API',
        codigoResultado: 'http_200',
        mensajeResultado: 'Entregado',
        payloadSolicitud: sensible,
        payloadRespuesta: sensible,
        payloadError: { estado: 'omitido', causa: 'ausenteEnOrigen' },
        iniciadoEnUtc: '2026-08-21T20:00:00.000Z',
        finalizadoEnUtc: '2026-08-21T20:00:01.250Z'
      }
    })]
  };
}

function leer(ruta) {
  return readFile(new URL(ruta, import.meta.url), 'utf8');
}

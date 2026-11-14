import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { RepositorioTriggersInformativosRemotoSql }
  from '../paquetes/federacion/adaptadores/RepositorioTriggersInformativosRemotoSql.js';
import { ServicioBorradoresLocalesFederacion }
  from '../paquetes/federacion/aplicacion/ServicioBorradoresLocalesFederacion.js';
import { ServicioTriggersRemotosFederacionPortal }
  from '../paquetes/federacion/aplicacion/ServicioTriggersRemotosFederacionPortal.js';
import { ServicioBorradoresFederacionPortal }
  from '../apps/sentinelia-web/src/servicios/ServicioBorradoresFederacionPortal.js';
import { ServicioAutorizacion }
  from '../paquetes/autorizacion/src/ServicioAutorizacion.js';
import {
  PERFIL_PAYLOAD_TRIGGERS_INFORMATIVOS_FEDERACION,
  VERSION_PAYLOAD_TRIGGERS_INFORMATIVOS_FEDERACION
} from '../paquetes/federacion/src/PayloadTriggersInformativosFederacion.js';

const ids = Object.freeze({
  instalacion: 'sfid1.instalacion.GQHc7zWJ9TuCYT0ojATWoQ',
  trigger: 'sfid1.elemento_origen.7UB40ag-5Ja5_HpPtFZHfg',
  monitor: 'sfid1.elemento_origen.ypZ1OBf59W9TBiZHupQWwQ',
  proyeccion: 'sfid1.proyeccion.sQRWXMZQvpV7G7-j1snUEw',
  generacion: 'sfid1.generacion.LULLs4GL7NEWwfMVsRJWBw',
  ocurrencia: 'sfid1.ocurrencia_origen.xw2Z_1JOWuVQ7qlVK5O7hA'
});
const definicionMensaje = Object.freeze({
  version: 1,
  asuntoPlantilla: '[Sentinelia] {{transicion}} · {{monitor}}',
  textoIntroduccion: 'Contexto acordado',
  textoCierre: null
});

await verificarRepositorioYBorrador();
await verificarVisorYResultadoAgregado();
await verificarComposicion();
console.log(
  '[correo-trigger] OK 5.27.12b: visor=correo@2 borrador=condicionado ' +
  'audiencia=ausente capacidad=local resultado=agregado'
);

async function verificarRepositorioYBorrador() {
  const publica = crearRepositorio(payloadDefinicion({ sensible: false }));
  const soloVista = await publica.crearBorradorPlantillaLocal({
    proyeccionId: ids.proyeccion
  });
  assert.equal(soloVista.tipo, 'correo');
  assert.equal(soloVista.configuracion, null);
  assert.equal(soloVista.soloPrevisualizacion, true);
  assert.equal(soloVista.definicionReusableDisponible, false);
  assert.deepEqual(soloVista.audiencia, []);
  assert.equal(soloVista.previsualizacionFederada.forma.forma.asuntoPlantilla,
    'configurable');

  const completa = crearRepositorio(payloadDefinicion({ sensible: true }));
  const plantilla = await completa.crearBorradorPlantillaLocal({
    proyeccionId: ids.proyeccion
  });
  assert.deepEqual(plantilla.configuracion, definicionMensaje);
  assert.equal(plantilla.soloPrevisualizacion, false);
  assert.equal(plantilla.definicionReusableDisponible, true);
  assert.equal(plantilla.requiereCredencialLocal, false);
  assert.deepEqual(plantilla.audiencia, []);

  const servicioBase = (capacidad) => new ServicioBorradoresLocalesFederacion({
    repositorioMonitoresRemotos: {
      listarDefiniciones: async () => [],
      listarEstadosActualesSeleccionables: async () => []
    },
    repositorioTriggersInformativosRemotos: completa,
    autorizarLecturaProyeccion: async () => true,
    evaluarCapacidadLocalTrigger: async () => capacidad
  });
  await assert.rejects(
    servicioBase({ disponible: false, codigo: 'smtp_no_verificado' })
      .crearTriggerLocalDesdeTriggerRemoto({
        contextoUsuarioActual: contexto(),
        proyeccionId: ids.proyeccion
      }),
    (error) => error.codigo === 'smtp_no_verificado'
  );
  const borrador = await servicioBase({
    disponible: true,
    codigo: 'capacidad_local_disponible'
  }).crearTriggerLocalDesdeTriggerRemoto({
    contextoUsuarioActual: contexto(),
    proyeccionId: ids.proyeccion
  });
  assert.equal(borrador.activo, false);
  assert.equal(borrador.persistida, false);
  assert.equal(borrador.puedePersistir, true);
  assert.deepEqual(borrador.audiencia, []);

  const formulario = await new ServicioBorradoresFederacionPortal({
    servicioBorradores: {
      crearMonitorLogicoDesdeMonitorRemoto: async () => ({}),
      crearTriggerLocalDesdeTriggerRemoto: async () => borrador
    }
  }).crearFormularioTrigger(contexto(), ids.proyeccion);
  assert.equal(formulario.formulario.tipo, 'correo');
  assert.equal(formulario.formulario.activo, '0');
  assert.equal(formulario.formulario.asuntoPlantilla,
    definicionMensaje.asuntoPlantilla);
  assert.equal(formulario.formulario.textoIntroduccion, 'Contexto acordado');
}

async function verificarVisorYResultadoAgregado() {
  const definicion = registro(payloadDefinicion({ sensible: true }));
  const ejecucion = registro(payloadEjecucion(), {
    proyeccionId: 'sfid1.proyeccion.aoAe2i4HeeFJvqcgDy76DA',
    elementoOrigenId: 'sfid1.elemento_origen.qdMdJ9lFAH7XZiJ9nHWqsg',
    tipoRegistro: 'ejecucionTerminada'
  });
  const crearServicio = (capacidad) => new ServicioTriggersRemotosFederacionPortal({
    repositorio: {
      listarDefiniciones: async () => [definicion],
      listarAsignaciones: async () => [],
      listarEjecucionesTerminadas: async () => [ejecucion]
    },
    repositorioMonitores: { listar: async () => [] },
    servicioAutorizacion: new ServicioAutorizacion(),
    evaluarCapacidadLocalTrigger: async () => capacidad
  });
  const bloqueada = await crearServicio({
    disponible: false,
    codigo: 'trigger_correo_sin_capacidad'
  }).obtener(contexto(), { installationOrigenId: ids.instalacion });
  assert.equal(bloqueada.triggers[0].utilizableComoPlantilla, false);
  assert.equal(bloqueada.triggers[0].capacidadPlantilla.local.codigo,
    'trigger_correo_sin_capacidad');

  const salida = await crearServicio({
    disponible: true,
    codigo: 'capacidad_local_disponible'
  }).obtener(contexto(), { installationOrigenId: ids.instalacion });
  const trigger = salida.triggers[0];
  assert.equal(trigger.utilizableComoPlantilla, true);
  assert.equal(trigger.configuracionCorreo.definicionReusableDisponible, true);
  assert.deepEqual(trigger.configuracionVisible, definicionMensaje);
  assert.equal(JSON.stringify(trigger).includes('audiencia'), false);
  assert.deepEqual(salida.ejecuciones[0].resultadoCorreo, {
    detalleEstado: 'conservado',
    totalResultadosDestinatarios: 3,
    totalSalidas: 3
  });
  assert.equal(salida.ejecuciones[0].contenido.solicitud.estado, 'omitido');
}

async function verificarComposicion() {
  const [index, vista, paquete] = await Promise.all([
    leer('../apps/sentinelia-web/src/index.js'),
    leer('../apps/sentinelia-web/src/views/portal/parciales/federacion-triggers-remotos.ejs'),
    leer('../package.json')
  ]);
  assert.match(index, /evaluarCapacidadLocalTriggerFederado/u);
  assert.match(vista, /Solo previsualización: SMTP, origen público o gate local/u);
  assert.match(vista, /Resultado de correo/u);
  assert.equal(JSON.parse(paquete).scripts['correo:verificar-trigger-5-27-12b'],
    'node scripts/correo-verificar-trigger-5-27-12b.js');
}

function crearRepositorio(payload) {
  return new RepositorioTriggersInformativosRemotoSql({
    obtenerConexion() {},
    async consultar() { return [filaSql(payload)]; }
  });
}

function filaSql(payload) {
  return {
    proyeccion_id: ids.proyeccion,
    installation_origen_id: ids.instalacion,
    elemento_origen_id: ids.trigger,
    generacion_actual_id: ids.generacion,
    secuencia_elemento: '1',
    ocurrencia_origen_id: ids.ocurrencia,
    tipo_registro: 'definicion',
    trigger_origen_id: ids.trigger,
    monitor_origen_id: null,
    referencia_origen_id: null,
    estado_ejecucion: null,
    tiempo_dato_utc: null,
    scope_nivel: 'portal',
    scope_tenant_id: null,
    scope_empresa_id: null,
    scope_sitio_id: null,
    completitud_interpretable: 'completa',
    completitud_observable: 'completa',
    completitud_reconstruible: 'completa',
    estado_vigencia: 'vigente',
    estado_soporte: 'sostenida',
    estado_autorizacion: 'autorizada',
    representacion_canonica: JSON.stringify(payload)
  };
}

function payloadDefinicion({ sensible }) {
  return {
    perfil: PERFIL_PAYLOAD_TRIGGERS_INFORMATIVOS_FEDERACION,
    version: VERSION_PAYLOAD_TRIGGERS_INFORMATIVOS_FEDERACION,
    tipoRegistro: 'definicion',
    nombre: 'Aviso humano',
    tipo: 'correo',
    descripcion: 'Correo informativo remoto',
    activo: true,
    configuracionOperativa: {
      version: 1,
      forma: {
        asuntoPlantilla: 'configurable',
        textoIntroduccion: true,
        textoCierre: false
      }
    },
    contenidoSensible: sensible
      ? { estado: 'presente', contenido: { definicionMensaje } }
      : { estado: 'omitido', causa: 'noSeleccionado' },
    scopeOrganizativo: {
      tenantElementoOrigenId: null,
      empresaElementoOrigenId: null,
      sitioElementoOrigenId: null
    }
  };
}

function payloadEjecucion() {
  const omitido = { estado: 'omitido', causa: 'ausenteEnOrigen' };
  return {
    perfil: PERFIL_PAYLOAD_TRIGGERS_INFORMATIVOS_FEDERACION,
    version: VERSION_PAYLOAD_TRIGGERS_INFORMATIVOS_FEDERACION,
    tipoRegistro: 'ejecucionTerminada',
    triggerOrigenId: ids.trigger,
    asignacionReferencia: null,
    monitorReferencia: null,
    versionCatalogo: 'beta-1',
    eventoDisparo: 'apertura_alerta',
    estadoEjecucion: 'ok',
    tipoTrigger: 'correo',
    triggerNombre: 'Aviso humano',
    codigoResultado: 'correo_aceptado',
    mensajeResultado: 'Aceptado durablemente',
    payloadSolicitud: omitido,
    payloadRespuesta: omitido,
    payloadError: omitido,
    resultadoCorreo: {
      detalleEstado: 'conservado',
      totalResultadosDestinatarios: 3,
      totalSalidas: 3
    },
    iniciadoEnUtc: '2031-01-01T00:00:00.000Z',
    finalizadoEnUtc: '2031-01-01T00:00:01.000Z'
  };
}

function registro(payload, cambios = {}) {
  return Object.freeze({
    proyeccionId: ids.proyeccion,
    installationOrigenId: ids.instalacion,
    elementoOrigenId: ids.trigger,
    triggerOrigenId: ids.trigger,
    generacionId: ids.generacion,
    secuenciaElemento: '1',
    ocurrenciaOrigenId: ids.ocurrencia,
    tipoRegistro: payload.tipoRegistro,
    scopeRecepcion: { nivel: 'portal', tenantId: null, empresaId: null, sitioId: null },
    completitud: { interpretable: 'completa', observable: 'completa', reconstruible: 'completa' },
    estadoProyeccion: { vigencia: 'vigente', soporte: 'sostenida', autorizacion: 'autorizada' },
    payload,
    ...cambios
  });
}

function contexto() {
  return {
    nivelScope: 'portal',
    tenantId: null,
    empresaId: null,
    sitioId: null,
    permisos: { verTriggers: true, verMonitores: true, editarTriggers: true }
  };
}

function leer(ruta) {
  return readFile(new URL(ruta, import.meta.url), 'utf8');
}

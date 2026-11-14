import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import {
  crearFuenteFederadaMonitorTelemetria,
  TIPOS_FUENTE_MONITOR_TELEMETRIA
} from '../paquetes/monitores/src/MonitorTelemetriaAgente.js';
import { EjecutorMonitorTelemetria } from '../apps/sentinelia-runtime/src/ejecucion/EjecutorMonitorTelemetria.js';
import { ServicioBorradoresLocalesFederacion } from '../paquetes/federacion/aplicacion/ServicioBorradoresLocalesFederacion.js';
import { ServicioFuenteTelemetriaFederada } from '../paquetes/federacion/aplicacion/ServicioFuenteTelemetriaFederada.js';

const ids = {
  proyeccion: id('proyeccion'),
  proyeccionEstado: id('proyeccion'),
  instalacion: id('instalacion'),
  elemento: id('elemento_origen'),
  generacion: id('generacion'),
  ocurrencia: id('ocurrencia_origen')
};

await verificarContratoFuente();
await verificarEjecucionTelemetriaRemota();
await verificarSeleccionExplicita();
await verificarBorradores();
await verificarEstructura();
console.log('[federacion] OK 5.22.16i: telemetria=entrada_local_explicita borradores=no_persistidos contexto=editable triggers=inactivos_sin_secretos replay=sin_efectos selector=tipado');

async function verificarContratoFuente() {
  const fuente = crearFuenteFederadaMonitorTelemetria({
    proyeccionId: ids.proyeccion
  });
  assert.equal(fuente.tipo, TIPOS_FUENTE_MONITOR_TELEMETRIA.SENAL_FEDERADA);
  assert.equal(fuente.proyeccionId, ids.proyeccion);
  assert.throws(() => crearFuenteFederadaMonitorTelemetria({
    proyeccionId: 'proyeccion-ambigua'
  }), /proyección/u);
}

async function verificarEjecucionTelemetriaRemota() {
  const registro = registroRemoto('fotografiaSenal', {
    observacionOrigenId: ids.elemento,
    secuenciaSenal: '7',
    senalOrigenId: ids.elemento,
    observacion: {
      fuenteOrigenId: ids.elemento,
      senalOrigenId: ids.elemento,
      tipoDato: 'numero',
      unidad: '%',
      valor: 91,
      calidad: 'buena',
      severidadDeclarada: 'normal',
      observadoEnUtc: '2031-01-01T00:00:00.000Z',
      recibidoEnUtc: '2031-01-01T00:00:01.000Z',
      vigenteHastaUtc: '2031-01-01T00:10:00.000Z'
    }
  });
  const vinculo = {
    tipoFuente: 'senal_federada',
    fuente: crearFuenteFederadaMonitorTelemetria({
      proyeccionId: ids.proyeccion
    }),
    esSenalDirecta: () => false,
    esSenalFederada: () => true
  };
  const ejecutor = new EjecutorMonitorTelemetria({
    repositorioVinculos: { buscarPorMonitorId: async () => vinculo },
    repositorioTelemetriaRemota: {
      listarEstadosSenalSeleccionables: async () => [registro]
    },
    reloj: () => new Date('2031-01-01T00:00:02.000Z')
  });
  const monitor = {
    id: 41,
    nombre: 'CPU remota local',
    tipo: 'telemetria',
    configuracion: {
      version: 1,
      retardoFalloSegundos: 0,
      condicion: {
        tipo: 'rango_numerico',
        tipoDato: 'numero',
        version: 1,
        minimo: null,
        maximo: 80
      }
    }
  };
  const primera = await ejecutor.ejecutar(monitor, {
    ejecutadoEnUtc: '2031-01-01T00:00:02.000Z'
  });
  assert.equal(primera.estadoDetectado, 'indisponible');
  assert.equal(primera.origenOperativo, 'monitor_local_con_telemetria_federada');
  assert.equal(primera.efectosDerivadosHabilitados, true);
  assert.equal(primera.metricaPrincipal.evidencia.procedenciaFederada.proyeccionId,
    ids.proyeccion);
  const repetida = await ejecutor.ejecutar(monitor, {
    ejecutadoEnUtc: '2031-01-01T00:00:02.000Z',
    almacenEstadoActual: {
      buscarPorMonitorId: () => ({
        ejecutadoTodavia: true,
        estado: primera.estadoDetectado,
        resultadoActual: { causalidadFederada: primera.causalidadFederada }
      })
    }
  });
  assert.equal(repetida.efectosDerivadosHabilitados, false);
  assert.equal(repetida.causalidadFederada.transicionMonitorId,
    primera.causalidadFederada.transicionMonitorId);
}

async function verificarBorradores() {
  const definicionMonitor = registroRemoto('definicion', {
    nombre: 'WAN norte',
    descripcion: 'Conectividad del origen',
    contextoHumano: {
      descripcionFallo: 'La WAN no responde',
      posibleSolucion: 'Revisar el enlace'
    }
  });
  const estadoMonitor = {
    ...registroRemoto('estadoActual', {}),
    proyeccionId: ids.proyeccionEstado,
    monitorOrigenId: definicionMonitor.elementoOrigenId,
    utilizableAhora: true
  };
  const consultasDefinicion = [];
  const consultasEstado = [];
  const autorizaciones = [];
  const servicio = new ServicioBorradoresLocalesFederacion({
    repositorioMonitoresRemotos: {
      listarDefiniciones: async (filtros) => {
        consultasDefinicion.push(filtros);
        return [definicionMonitor];
      },
      listarEstadosActualesSeleccionables: async (filtros) => {
        consultasEstado.push(filtros);
        return [estadoMonitor];
      }
    },
    repositorioTriggersInformativosRemotos: {
      crearBorradorPlantillaLocal: async () => ({
        nombre: 'Copia de webhook',
        activo: false,
        persistida: false,
        configuracion: { url: 'https://example.test' }
      })
    },
    autorizarLecturaProyeccion: async (solicitud) => {
      autorizaciones.push(solicitud);
      return true;
    }
  });
  const monitor = await servicio.crearMonitorLogicoDesdeMonitorRemoto({
    contextoUsuarioActual: { usuarioId: 9 },
    proyeccionId: ids.proyeccion
  });
  assert.equal(monitor.persistido, false);
  assert.equal(monitor.configuracion.version, 4);
  assert.equal(monitor.configuracion.dependencias[0].fuente, 'monitor_federado');
  assert.equal(monitor.descripcionFallo, 'La WAN no responde');
  assert.deepEqual(consultasDefinicion, [{ proyeccionId: ids.proyeccion }]);
  assert.deepEqual(consultasEstado, [{
    installationOrigenId: definicionMonitor.installationOrigenId,
    monitorOrigenId: definicionMonitor.elementoOrigenId
  }]);
  assert.deepEqual(autorizaciones.map(({ proyeccionId }) => proyeccionId), [
    ids.proyeccion,
    ids.proyeccionEstado
  ]);
  assert.equal(
    monitor.configuracion.dependencias[0].proyeccionId,
    ids.proyeccionEstado
  );
  const servicioEstadoNoAutorizado = new ServicioBorradoresLocalesFederacion({
    repositorioMonitoresRemotos: {
      listarDefiniciones: async () => [definicionMonitor],
      listarEstadosActualesSeleccionables: async () => [estadoMonitor]
    },
    repositorioTriggersInformativosRemotos: {
      crearBorradorPlantillaLocal: async () => ({})
    },
    autorizarLecturaProyeccion: async ({ proyeccionId }) =>
      proyeccionId !== ids.proyeccionEstado
  });
  await assert.rejects(
    servicioEstadoNoAutorizado.crearMonitorLogicoDesdeMonitorRemoto({
      contextoUsuarioActual: { usuarioId: 9 },
      proyeccionId: ids.proyeccion
    }),
    (error) => error.codigo === 'proyeccion_borrador_no_autorizada'
  );
  monitor.descripcionFallo = 'Contexto local editado';
  monitor.configuracion.dependencias[0].etiqueta = 'WAN reinterpretada';
  assert.equal(monitor.descripcionFallo, 'Contexto local editado');
  assert.equal(
    monitor.configuracion.dependencias[0].etiqueta,
    'WAN reinterpretada'
  );
  const servicioFotografiaVencida = new ServicioBorradoresLocalesFederacion({
    repositorioMonitoresRemotos: {
      listarDefiniciones: async () => [definicionMonitor],
      listarEstadosActualesSeleccionables: async () => [{
        ...registroRemoto('estadoActual', {}),
        fotografiaOperativa: { utilizableAhora: false }
      }]
    },
    repositorioTriggersInformativosRemotos: {
      crearBorradorPlantillaLocal: async () => ({})
    },
    autorizarLecturaProyeccion: async () => true
  });
  await assert.rejects(
    servicioFotografiaVencida.crearMonitorLogicoDesdeMonitorRemoto({
      contextoUsuarioActual: { usuarioId: 9 },
      proyeccionId: ids.proyeccion
    }),
    (error) => error.codigo === 'monitor_remoto_borrador_no_utilizable'
  );
  const servicioGeneracionInestable = new ServicioBorradoresLocalesFederacion({
    repositorioMonitoresRemotos: {
      listarDefiniciones: async () => [definicionMonitor],
      listarEstadosActualesSeleccionables: async () => [{
        ...estadoMonitor,
        generacionId: id('generacion')
      }]
    },
    repositorioTriggersInformativosRemotos: {
      crearBorradorPlantillaLocal: async () => ({})
    },
    autorizarLecturaProyeccion: async () => true
  });
  await assert.rejects(
    servicioGeneracionInestable.crearMonitorLogicoDesdeMonitorRemoto({
      contextoUsuarioActual: { usuarioId: 9 },
      proyeccionId: ids.proyeccion
    }),
    (error) => error.codigo === 'monitor_remoto_borrador_generacion_inestable'
  );
  const trigger = await servicio.crearTriggerLocalDesdeTriggerRemoto({
    contextoUsuarioActual: { usuarioId: 9 },
    proyeccionId: ids.proyeccion
  });
  assert.equal(trigger.activo, false);
  assert.equal(trigger.persistida, false);
}

async function verificarSeleccionExplicita() {
  const fotografia = registroRemoto('fotografiaSenal', {
    observacion: {
      fuenteOrigenId: ids.elemento,
      senalOrigenId: ids.elemento,
      tipoDato: 'booleano',
      unidad: null,
      codigoSenal: 'servicio.vivo'
    }
  });
  let ordenVinculo = null;
  const autorizacionesLocales = [];
  const servicio = new ServicioFuenteTelemetriaFederada({
    repositorioTelemetriaRemota: {
      listarEstadosSenalSeleccionables: async () => [fotografia]
    },
    repositorioVinculosMonitoresTelemetria: {
      vincularSenalFederada: async (orden) => {
        ordenVinculo = orden;
        return { monitorId: orden.monitorId, fuente: orden.proyeccionId };
      }
    },
    autorizarLecturaProyeccion: async () => true,
    autorizarAdministracionMonitorLocal: async (solicitud) => {
      autorizacionesLocales.push(solicitud);
      return true;
    }
  });
  const resultado = await servicio.vincularAMonitorLocal({
    contextoUsuarioActual: { usuarioId: 9 },
    monitorId: 41,
    proyeccionId: ids.proyeccion
  });
  assert.deepEqual(ordenVinculo, {
    monitorId: 41,
    proyeccionId: ids.proyeccion
  });
  assert.deepEqual(autorizacionesLocales, [{
    contextoUsuarioActual: { usuarioId: 9 },
    monitorId: 41
  }]);
  assert.equal(resultado.seleccion.senal.tipoDato, 'booleano');

  const fuenteSinRutaLegitima = new ServicioFuenteTelemetriaFederada({
    repositorioTelemetriaRemota: {
      listarEstadosSenalSeleccionables: async () => [{
        ...fotografia,
        estadoProyeccion: {
          ...fotografia.estadoProyeccion,
          autorizacion: 'noAutorizada'
        },
        fotografiaOperativa: { utilizableAhora: false }
      }]
    },
    repositorioVinculosMonitoresTelemetria: {
      vincularSenalFederada: async () => {
        throw new Error('No debe vincular una fotografía sin ruta legítima.');
      }
    },
    autorizarLecturaProyeccion: async () => true,
    autorizarAdministracionMonitorLocal: async () => true
  });
  await assert.rejects(
    fuenteSinRutaLegitima.describirFuenteSeleccionable({
      contextoUsuarioActual: { usuarioId: 9 },
      proyeccionId: ids.proyeccion
    }),
    /vigente, autorizada, compatible, sostenida y observable/u
  );

  const sinAutoridadLocal = new ServicioFuenteTelemetriaFederada({
    repositorioTelemetriaRemota: {
      listarEstadosSenalSeleccionables: async () => {
        throw new Error('No debe consultar la fuente sin autoridad local.');
      }
    },
    repositorioVinculosMonitoresTelemetria: {
      vincularSenalFederada: async () => {
        throw new Error('No debe persistir el vínculo sin autoridad local.');
      }
    },
    autorizarLecturaProyeccion: async () => true,
    autorizarAdministracionMonitorLocal: async () => false
  });
  await assert.rejects(
    sinAutoridadLocal.vincularAMonitorLocal({
      contextoUsuarioActual: { usuarioId: 10 },
      monitorId: 42,
      proyeccionId: ids.proyeccion
    }),
    /administrar el monitor local/u
  );
}

async function verificarEstructura() {
  const [telemetria, monitores, triggers, explorador] =
    await Promise.all([
      leer('../paquetes/federacion/adaptadores/RepositorioTelemetriaRemotaSql.js'),
      leer('../paquetes/federacion/adaptadores/RepositorioMonitoresRemotoSql.js'),
      leer('../paquetes/federacion/adaptadores/RepositorioTriggersInformativosRemotoSql.js'),
      leer('../apps/sentinelia-web/src/views/portal/federacion-datos-remotos.ejs')
    ]);
  for (const fuente of [telemetria, monitores, triggers]) {
    assert.match(fuente, /r2\.tipo_registro/u);
  }
  assert.match(telemetria, /aportes_ocurrencias_contribuciones_federacion/u);
  assert.match(telemetria, /vigenteHastaEfectivaUtc/u);
  assert.match(telemetria, /estado_compatibilidad/u);
  assert.match(triggers, /sanearConfiguracionPlantilla/u);
  assert.match(
    explorador,
    /elemento\.detalle\?\.tipoRegistro === 'definicion'/u
  );
}

function registroRemoto(tipoRegistro, payload) {
  return {
    proyeccionId: ids.proyeccion,
    installationOrigenId: ids.instalacion,
    elementoOrigenId: ids.elemento,
    generacionId: ids.generacion,
    secuenciaElemento: '8',
    ocurrenciaOrigenId: ids.ocurrencia,
    tipoRegistro,
    completitud: {
      interpretable: 'completa',
      observable: 'completa',
      reconstruible: 'parcial'
    },
    estadoProyeccion: {
      vigencia: 'vigente',
      soporte: 'sostenida',
      autorizacion: 'autorizada',
      compatibilidad: 'compatible'
    },
    fotografiaOperativa: { utilizableAhora: true },
    payload
  };
}

function id(tipo) {
  return `sfid1.${tipo}.${randomBytes(16).toString('base64url')}`;
}

function leer(ruta) {
  return readFile(new URL(ruta, import.meta.url), 'utf8');
}

import {
  crearConfiguracionMonitorLogicoBase
} from '../../monitores/src/ConfiguracionMonitorLogico.js';

export class ErrorBorradorLocalFederacion extends Error {
  constructor(codigo, mensaje) {
    super(mensaje);
    this.name = 'ErrorBorradorLocalFederacion';
    this.codigo = codigo;
  }
}

export class ServicioBorradoresLocalesFederacion {
  constructor({
    repositorioMonitoresRemotos,
    repositorioTriggersInformativosRemotos,
    autorizarLecturaProyeccion,
    evaluarCapacidadLocalTrigger = null
  } = {}) {
    if (typeof repositorioMonitoresRemotos?.listarDefiniciones !== 'function' ||
        typeof repositorioMonitoresRemotos?.listarEstadosActualesSeleccionables !== 'function') {
      throw new Error('El servicio de borradores requiere monitores remotos consultables.');
    }
    if (typeof repositorioTriggersInformativosRemotos?.crearBorradorPlantillaLocal !== 'function') {
      throw new Error('El servicio de borradores requiere triggers remotos consultables.');
    }
    if (typeof autorizarLecturaProyeccion !== 'function') {
      throw new Error('El servicio de borradores exige autorización local explícita.');
    }
    this.repositorioMonitoresRemotos = repositorioMonitoresRemotos;
    this.repositorioTriggersInformativosRemotos =
      repositorioTriggersInformativosRemotos;
    this.autorizarLecturaProyeccion = autorizarLecturaProyeccion;
    this.evaluarCapacidadLocalTrigger = evaluarCapacidadLocalTrigger;
  }

  async crearMonitorLogicoDesdeMonitorRemoto({
    contextoUsuarioActual,
    proyeccionId
  } = {}) {
    await this.#autorizar(contextoUsuarioActual, proyeccionId, 'monitores');
    const [definicion] = await this.repositorioMonitoresRemotos
      .listarDefiniciones({ proyeccionId });
    if (!definicion) {
      fallar('monitor_remoto_borrador_sin_definicion',
        'La proyección seleccionada no es una definición actual de monitor remoto.');
    }
    const [estado] = await this.repositorioMonitoresRemotos
      .listarEstadosActualesSeleccionables({
        installationOrigenId: definicion.installationOrigenId,
        monitorOrigenId: definicion.elementoOrigenId
      });
    if (!estado) {
      fallar('monitor_remoto_borrador_incompleto',
        'El monitor remoto dispone de definición, pero no de un estado observable actual.');
    }
    await this.#autorizar(contextoUsuarioActual, estado.proyeccionId, 'monitores');
    if (definicion.generacionId !== estado.generacionId) {
      fallar('monitor_remoto_borrador_generacion_inestable',
        'La definición y el estado remoto cambiaron de generación durante la lectura.');
    }
    if (!esUtilizableComoEntrada(estado) ||
        definicion.completitud.interpretable !== 'completa') {
      fallar('monitor_remoto_borrador_no_utilizable',
        'El monitor remoto no está vigente, autorizado, observable e interpretable.');
    }
    const contexto = estado.payload?.contextoHumano ||
      definicion.payload.contextoHumano || {};
    return {
      tipoBorrador: 'monitor_logico_local',
      persistido: false,
      activo: false,
      nombre: `Copia lógica de ${definicion.payload.nombre}`,
      descripcion: definicion.payload.descripcion,
      descripcionFallo: contexto.descripcionFallo ?? null,
      posibleSolucion: contexto.posibleSolucion ?? null,
      scopeLocal: null,
      requiereRevisionScope: true,
      configuracion: crearConfiguracionMonitorLogicoBase({
        expresion: 'A',
        variables: ['A'],
        mensajeFallo: contexto.descripcionFallo || 'La fuente remota indica fallo.',
        estadoInicial: 'disponible',
        retardoSenalSegundos: 0,
        politicaEntradasIncompletas: 'conservar_salida',
        dependencias: [{
          variable: 'A',
          fuente: 'monitor_federado',
          proyeccionId: estado.proyeccionId,
          estadoInicial: 'correcto',
          inversion: false,
          retardoCambioSegundos: 0,
          politicaPerdidaEnFallo: 'conservar',
          politicaPerdidaEnCorrecto: 'conservar'
        }]
      }),
      procedenciaFederada: procedencia(estado)
    };
  }

  async crearTriggerLocalDesdeTriggerRemoto({
    contextoUsuarioActual,
    proyeccionId
  } = {}) {
    await this.#autorizar(
      contextoUsuarioActual,
      proyeccionId,
      'triggersInformativos'
    );
    const borrador = await this.repositorioTriggersInformativosRemotos
      .crearBorradorPlantillaLocal({ proyeccionId });
    if (borrador.tipo !== 'correo') return clonar(borrador);
    if (borrador.soloPrevisualizacion || !borrador.definicionReusableDisponible) {
      fallar('trigger_correo_remoto_sin_definicion_reusable',
        'La proyección permite previsualizar la forma del correo, pero no recibió una definición reusable.');
    }
    if (typeof this.evaluarCapacidadLocalTrigger !== 'function') {
      fallar('trigger_correo_remoto_sin_capacidad_local',
        'La capacidad local para crear triggers de correo no está disponible.');
    }
    const capacidad = await this.evaluarCapacidadLocalTrigger({ tipo: 'correo' });
    if (capacidad?.disponible !== true) {
      fallar(capacidad?.codigo || 'trigger_correo_remoto_sin_capacidad_local',
        'El trigger remoto solo puede previsualizarse hasta que SMTP, el origen público y el gate local estén operativos.');
    }
    return clonar({
      ...borrador,
      audiencia: [],
      puedePersistir: true,
      soloPrevisualizacion: false
    });
  }

  async #autorizar(contextoUsuarioActual, proyeccionId, familia) {
    const autorizada = await this.autorizarLecturaProyeccion({
      contextoUsuarioActual,
      proyeccionId,
      familia
    });
    if (autorizada !== true) {
      fallar('proyeccion_borrador_no_autorizada',
        'El usuario actual no puede consultar la proyección solicitada.');
    }
  }
}

function esUtilizableComoEntrada(estado) {
  if (typeof estado.fotografiaOperativa?.utilizableAhora === 'boolean') {
    return estado.fotografiaOperativa.utilizableAhora;
  }
  if (typeof estado.utilizableAhora === 'boolean') return estado.utilizableAhora;
  return estado.completitud?.observable === 'completa' &&
    estado.estadoProyeccion?.vigencia === 'vigente' &&
    estado.estadoProyeccion?.soporte === 'sostenida' &&
    estado.estadoProyeccion?.autorizacion === 'autorizada';
}

function procedencia(registro) {
  return {
    installationOrigenId: registro.installationOrigenId,
    elementoOrigenId: registro.elementoOrigenId,
    proyeccionId: registro.proyeccionId,
    generacionId: registro.generacionId,
    secuenciaElemento: registro.secuenciaElemento,
    ocurrenciaOrigenId: registro.ocurrenciaOrigenId
  };
}

function clonar(valor) {
  return valor == null ? valor : JSON.parse(JSON.stringify(valor));
}

function fallar(codigo, mensaje) {
  throw new ErrorBorradorLocalFederacion(codigo, mensaje);
}

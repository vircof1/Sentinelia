export const VERSION_PROTOCOLO_FEDERACION = 1;
export const VERSION_CATALOGOS_FEDERACION = 1;
export const PERFIL_CATALOGOS_FEDERACION =
  'sentinelia-federacion-catalogos-v1';

export class ErrorCatalogoFederacion extends Error {
  constructor(codigo, mensaje, { catalogo = null, valor = null } = {}) {
    super(mensaje);
    this.name = 'ErrorCatalogoFederacion';
    this.codigo = codigo;
    this.catalogo = catalogo;
    this.valor = valor;
  }
}

class CatalogoFederacion {
  #nombre;
  #version;
  #valores;
  #valoresAdmitidos;

  constructor({ nombre, version, valores }) {
    validarDefinicionCatalogo({ nombre, version, valores });
    this.#nombre = nombre;
    this.#version = version;
    this.#valores = Object.freeze([...valores]);
    this.#valoresAdmitidos = new Set(this.#valores);
    Object.freeze(this);
  }

  get nombre() {
    return this.#nombre;
  }

  get version() {
    return this.#version;
  }

  get valores() {
    return this.#valores;
  }

  contiene(valor) {
    return typeof valor === 'string' && this.#valoresAdmitidos.has(valor);
  }

  exigir(valor, { campo = this.#nombre } = {}) {
    if (!this.contiene(valor)) {
      throw new ErrorCatalogoFederacion(
        'valor_catalogo_desconocido',
        `${campo} no pertenece al catálogo cerrado ${this.#nombre}@${this.#version}.`,
        { catalogo: this.#nombre, valor }
      );
    }
    return valor;
  }

  toJSON() {
    return Object.freeze({
      nombre: this.#nombre,
      version: this.#version,
      valores: this.#valores
    });
  }
}

function crearCatalogo(nombre, valores) {
  return new CatalogoFederacion({
    nombre,
    version: VERSION_CATALOGOS_FEDERACION,
    valores
  });
}

export const DIRECCIONES_FEDERACION = crearCatalogo('direcciones', [
  'emision',
  'recepcion'
]);

export const NIVELES_SCOPE_FEDERACION = crearCatalogo('nivelesScope', [
  'portal',
  'tenant',
  'empresa',
  'sitio'
]);

export const FAMILIAS_FEDERACION = crearCatalogo('familias', [
  'estructuraOrganizativa',
  'monitores',
  'telemetria',
  'triggersInformativos',
  'auditoria',
  'avisosFederados',
  'contextoOperativoAgentesSesiones'
]);

export const OPERACIONES_OCURRENCIA_FEDERACION = crearCatalogo(
  'operacionesOcurrencia',
  ['actualizacion', 'retirada', 'salidaProyeccion']
);

export const ESTADOS_CAMPO_FEDERADO = crearCatalogo('estadosCampo', [
  'presente',
  'omitido',
  'retirado'
]);

export const CAUSAS_OMISION_CAMPO_FEDERADO = crearCatalogo(
  'causasOmisionCampo',
  [
    'omitidoPorSeleccion',
    'protegido',
    'noAutorizado',
    'ausenteEnOrigen'
  ]
);

export const SENSIBILIDADES_CAMPO_FEDERADO = crearCatalogo(
  'sensibilidadesCampo',
  ['ordinario', 'sensible']
);

export const ESTADOS_CICLO_RELACION_FEDERACION = crearCatalogo(
  'estadosCicloRelacion',
  [
    'pendienteVinculacion',
    'pendienteConfirmacionIdentidad',
    'pendienteAutenticacion',
    'vinculada',
    'deshabilitada',
    'eliminada'
  ]
);

export const ESTADOS_AUTORIDAD_RELACION_FEDERACION = crearCatalogo(
  'estadosAutoridadRelacion',
  ['autorizada', 'sinAutoridad']
);

export const ESTADOS_IDENTIDAD_RELACION_FEDERACION = crearCatalogo(
  'estadosIdentidadRelacion',
  ['valida', 'conflictiva']
);

export const ESTADOS_COMPATIBILIDAD_RELACION_FEDERACION = crearCatalogo(
  'estadosCompatibilidadRelacion',
  ['compatible', 'compatibleParcial', 'incompatible']
);

export const ESTADOS_FLUJO_FEDERACION = crearCatalogo('estadosFlujo', [
  'sinSincronizar',
  'sincronizando',
  'operativoParcial',
  'operativoCompleto',
  'resincronizando',
  'degradado',
  'saturado',
  'detenido'
]);

export const ESTADOS_GENERACION_FEDERACION = crearCatalogo(
  'estadosGeneracion',
  [
    'preparada',
    'transfiriendo',
    'fronteraOperativaValidada',
    'completa',
    'degradada',
    'cancelada',
    'sustituida'
  ]
);

export const PRIORIDADES_FLUJO_FEDERACION = crearCatalogo(
  'prioridadesFlujo',
  ['operativaActual', 'reconstruccion']
);

export const ESTADOS_MATERIALIZACION_PROYECCION_FEDERACION = crearCatalogo(
  'estadosMaterializacionProyeccion',
  ['pendiente', 'materializada', 'fallida']
);

export const ESTADOS_COMPLETITUD_PROYECCION_FEDERACION = crearCatalogo(
  'estadosCompletitudProyeccion',
  ['completa', 'parcial', 'degradada']
);

export const ESTADOS_VIGENCIA_PROYECCION_FEDERACION = crearCatalogo(
  'estadosVigenciaProyeccion',
  ['vigente', 'vencida', 'retirada']
);

export const ESTADOS_SOPORTE_PROYECCION_FEDERACION = crearCatalogo(
  'estadosSoporteProyeccion',
  ['sostenida', 'huerfana']
);

export const ESTADOS_AUTORIZACION_PROYECCION_FEDERACION = crearCatalogo(
  'estadosAutorizacionProyeccion',
  ['autorizada', 'noAutorizada']
);

export const CAPACIDADES_COMPLETITUD_FEDERACION = crearCatalogo(
  'capacidadesCompletitud',
  ['interpretable', 'observable', 'reconstruible']
);

export const ESTADOS_REQUISITO_COMPLETITUD_FEDERACION = crearCatalogo(
  'estadosRequisitoCompletitud',
  ['cumplido', 'noAplicable', 'faltante', 'fallido']
);

export const DECISIONES_RETENCION_FEDERACION = crearCatalogo(
  'decisionesRetencion',
  ['conservar', 'conservarMinimoOperativo', 'eliminarContenido', 'compactarEvidencia']
);

export const CAPACIDADES_PROTOCOLO_FEDERACION = crearCatalogo(
  'capacidadesProtocolo',
  [
    'consultaProgreso',
    'resultadosParciales',
    'fragmentacionTipada',
    'prioridadOperativaActual',
    'refederacion',
    'contenidoSensibleSeleccionable'
  ]
);

export const RESULTADOS_OCURRENCIA_FEDERACION = crearCatalogo(
  'resultadosOcurrencia',
  [
    'aceptada',
    'yaConocida',
    'retiradaAceptada',
    'salidaAceptada',
    'descartadaPorRetencion',
    'rechazadaDefinitiva',
    'divergente',
    'aplazadaCapacidad',
    'aplazadaValidacion'
  ]
);

export const ERRORES_TERMINALES_FEDERACION = crearCatalogo(
  'erroresTerminales',
  [
    'identidadNoVinculada',
    'identidadDuplicada',
    'retornoPropioIncompatible',
    'credencialInvalida',
    'credencialVencida',
    'autoridadActualInsuficiente',
    'concesionInexistente',
    'concesionRevocada',
    'scopeIncompatible',
    'versionProtocoloIncompatible',
    'versionFamiliaIncompatible',
    'recorridoCiclicoDestino',
    'ocurrenciaInvalida',
    'divergenciaContenido',
    'descarteRetencionDivergente',
    'loteExcedeLimites',
    'ocurrenciaExcedeLimite'
  ]
);

export const ERRORES_TEMPORALES_FEDERACION = crearCatalogo(
  'erroresTemporales',
  [
    'desfaseTemporalNoTolerable',
    'capacidadTemporalAgotada',
    'dependenciaValidacionTemporal',
    'relacionTemporalmenteDetenida'
  ]
);

export const CAUSAS_DIAGNOSTICO_FEDERACION = crearCatalogo(
  'causasDiagnostico',
  [
    'relacionSilenciosa',
    'desfaseTemporal',
    'conflictoIdentidadInstalacion',
    'divergenciaOcurrencia',
    'dependenciaRetiradaOIncompleta',
    'generacionDegradada',
    'huecoIrrecuperable',
    'saturacionProlongada',
    'perdidaAutoridadResponsable',
    'resincronizacionRequerida'
  ]
);

export const VERSIONES_FAMILIA_FEDERACION = Object.freeze(
  {
    ...Object.fromEntries(FAMILIAS_FEDERACION.valores.map((familia) => [familia, 1])),
    triggersInformativos: 2
  }
);

export const CATALOGOS_FEDERACION = Object.freeze({
  direcciones: DIRECCIONES_FEDERACION,
  nivelesScope: NIVELES_SCOPE_FEDERACION,
  familias: FAMILIAS_FEDERACION,
  operacionesOcurrencia: OPERACIONES_OCURRENCIA_FEDERACION,
  estadosCampo: ESTADOS_CAMPO_FEDERADO,
  causasOmisionCampo: CAUSAS_OMISION_CAMPO_FEDERADO,
  sensibilidadesCampo: SENSIBILIDADES_CAMPO_FEDERADO,
  estadosCicloRelacion: ESTADOS_CICLO_RELACION_FEDERACION,
  estadosAutoridadRelacion: ESTADOS_AUTORIDAD_RELACION_FEDERACION,
  estadosIdentidadRelacion: ESTADOS_IDENTIDAD_RELACION_FEDERACION,
  estadosCompatibilidadRelacion: ESTADOS_COMPATIBILIDAD_RELACION_FEDERACION,
  estadosFlujo: ESTADOS_FLUJO_FEDERACION,
  estadosGeneracion: ESTADOS_GENERACION_FEDERACION,
  prioridadesFlujo: PRIORIDADES_FLUJO_FEDERACION,
  estadosMaterializacionProyeccion:
    ESTADOS_MATERIALIZACION_PROYECCION_FEDERACION,
  estadosCompletitudProyeccion: ESTADOS_COMPLETITUD_PROYECCION_FEDERACION,
  estadosVigenciaProyeccion: ESTADOS_VIGENCIA_PROYECCION_FEDERACION,
  estadosSoporteProyeccion: ESTADOS_SOPORTE_PROYECCION_FEDERACION,
  estadosAutorizacionProyeccion: ESTADOS_AUTORIZACION_PROYECCION_FEDERACION,
  capacidadesCompletitud: CAPACIDADES_COMPLETITUD_FEDERACION,
  estadosRequisitoCompletitud: ESTADOS_REQUISITO_COMPLETITUD_FEDERACION,
  decisionesRetencion: DECISIONES_RETENCION_FEDERACION,
  capacidadesProtocolo: CAPACIDADES_PROTOCOLO_FEDERACION,
  resultadosOcurrencia: RESULTADOS_OCURRENCIA_FEDERACION,
  erroresTerminales: ERRORES_TERMINALES_FEDERACION,
  erroresTemporales: ERRORES_TEMPORALES_FEDERACION,
  causasDiagnostico: CAUSAS_DIAGNOSTICO_FEDERACION
});

export function obtenerCatalogoFederacion(nombre) {
  if (
    typeof nombre !== 'string' ||
    !Object.prototype.hasOwnProperty.call(CATALOGOS_FEDERACION, nombre)
  ) {
    throw new ErrorCatalogoFederacion(
      'catalogo_desconocido',
      'El catálogo solicitado no pertenece al perfil contractual vigente.',
      { catalogo: nombre }
    );
  }
  return CATALOGOS_FEDERACION[nombre];
}

export function exigirValorCatalogoFederacion(
  nombreCatalogo,
  valor,
  opciones = {}
) {
  return obtenerCatalogoFederacion(nombreCatalogo).exigir(valor, opciones);
}

function validarDefinicionCatalogo({ nombre, version, valores }) {
  if (typeof nombre !== 'string' || nombre.length === 0) {
    throw new TypeError('Todo catálogo federado necesita un nombre estable.');
  }
  if (!Number.isInteger(version) || version < 1) {
    throw new TypeError('Todo catálogo federado necesita una versión positiva.');
  }
  if (!Array.isArray(valores) || valores.length === 0) {
    throw new TypeError('Todo catálogo federado debe declarar valores cerrados.');
  }
  if (
    valores.some((valor) => typeof valor !== 'string' || valor.length === 0) ||
    new Set(valores).size !== valores.length
  ) {
    throw new TypeError(
      'Los valores de un catálogo federado deben ser textos únicos no vacíos.'
    );
  }
}

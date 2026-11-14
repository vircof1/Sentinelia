import {
  CAPACIDADES_COMPLETITUD_FEDERACION,
  FAMILIAS_FEDERACION,
  VERSIONES_FAMILIA_FEDERACION
} from './CatalogosFederacion.js';
import { normalizarJsonFederacion } from './CanonicalizadorFederacion.js';

export const VERSION_CONTRATOS_FAMILIAS_FEDERACION = 1;
export const PERFIL_CONTRATOS_FAMILIAS_FEDERACION =
  'sentinelia-federacion-contratos-familias-v1';

const MODOS_REFERENCIA_NO_VISIBLE = new Set(['opaca', 'omitida']);
const CLASES_RETENCION = new Set([
  'definicion', 'estadoOperativoActual', 'historico', 'evidenciaAuditable'
]);
const MODOS_RETIRADA_ORIGEN = new Set(['permitida', 'prohibida']);

export class ErrorContratosFamiliasFederacion extends Error {
  constructor(codigo, mensaje, { familia = null, campo = null } = {}) {
    super(mensaje);
    this.name = 'ErrorContratosFamiliasFederacion';
    this.codigo = codigo;
    this.familia = familia;
    this.campo = campo;
  }
}

const DEFINICIONES = {
  estructuraOrganizativa: contrato({
    campoBase: 'nodoOrganizativo',
    tiposRegistro: ['tenant', 'empresa', 'sitio'],
    sensibles: {},
    referencias: {
      linaje: referencia(['opaca'], [])
    },
    retencion: {
      tenant: 'definicion', empresa: 'definicion', sitio: 'definicion'
    },
    capacidadesBase: ['interpretable', 'reconstruible']
  }),
  contextoOperativoAgentesSesiones: contrato({
    campoBase: 'contextoOperativoAgente',
    tiposRegistro: ['agente'],
    sensibles: {},
    referencias: {
      scopeOrganizativo: referencia(['opaca'], [])
    },
    retencion: { agente: 'estadoOperativoActual' },
    capacidadesBase: ['interpretable', 'observable']
  }),
  telemetria: contrato({
    campoBase: 'telemetria',
    tiposRegistro: [
      'fuente', 'senal', 'observacion', 'fotografiaSenal', 'fotografiaPol',
      'reglaDerivacion', 'eventoDerivado', 'rangoHistorico'
    ],
    sensibles: {},
    referencias: {
      fuente: referencia(['opaca'], []),
      scopeOrganizativo: referencia(['opaca'], []),
      reglaDerivacion: referencia(['opaca'], [])
    },
    retencion: {
      fuente: 'definicion', senal: 'definicion', observacion: 'historico',
      fotografiaSenal: 'estadoOperativoActual', fotografiaPol: 'estadoOperativoActual',
      reglaDerivacion: 'definicion', eventoDerivado: 'historico',
      rangoHistorico: 'evidenciaAuditable'
    },
    capacidadesBase: ['interpretable', 'observable', 'reconstruible']
  }),
  monitores: contrato({
    campoBase: 'monitores',
    tiposRegistro: [
      'definicion', 'estadoActual', 'evento', 'tramoHistorico', 'alerta',
      'referenciaTrigger', 'rangoHistorico'
    ],
    sensibles: {
      credencialPropia: sensible(['definicion'], ['reconstruible'])
    },
    referencias: {
      referenciasOperativas: referencia(['opaca'], []),
      trigger: referencia(['opaca'], []),
      actorAlerta: referencia(['opaca', 'omitida'], [])
    },
    retencion: {
      definicion: 'definicion', estadoActual: 'estadoOperativoActual',
      evento: 'historico', tramoHistorico: 'historico',
      alerta: retencionCondicional('estadoAlerta', {
        activa: 'estadoOperativoActual', cerrada: 'historico'
      }),
      referenciaTrigger: 'definicion', rangoHistorico: 'evidenciaAuditable'
    },
    capacidadesBase: ['interpretable', 'observable', 'reconstruible']
  }),
  triggersInformativos: contrato({
    campoBase: 'triggersInformativos',
    tiposRegistro: ['definicion', 'asignacionMonitor', 'ejecucionTerminada'],
    sensibles: {
      contenidoSensibleDefinicion: sensible(['definicion'], ['reconstruible']),
      contenidoSensibleAsignacion: sensible(['asignacionMonitor'], ['reconstruible']),
      payloadSolicitud: sensible(['ejecucionTerminada'], ['observable']),
      payloadRespuesta: sensible(['ejecucionTerminada'], ['observable']),
      payloadError: sensible(['ejecucionTerminada'], ['observable'])
    },
    referencias: {
      monitor: referencia(['opaca'], []),
      asignacion: referencia(['opaca'], [])
    },
    retencion: {
      definicion: 'definicion', asignacionMonitor: 'definicion',
      ejecucionTerminada: 'historico'
    },
    capacidadesBase: ['interpretable', 'observable', 'reconstruible']
  }),
  auditoria: contrato({
    campoBase: 'auditoria',
    tiposRegistro: ['evento'],
    sensibles: {
      payloadCompleto: sensible(['evento'], ['observable'])
    },
    referencias: {
      actor: referencia(['opaca', 'omitida'], []),
      sujeto: referencia(['opaca'], ['interpretable'])
    },
    retencion: { evento: 'evidenciaAuditable' },
    retiradaOrigen: 'prohibida',
    conservarHistoricoTrasSalida: true,
    capacidadesBase: ['interpretable', 'observable']
  }),
  avisosFederados: contrato({
    campoBase: 'avisosFederados',
    tiposRegistro: ['estadoActual', 'transicion'],
    sensibles: {
      actorVisible: sensible(['estadoActual', 'transicion'], [])
    },
    referencias: {
      actor: referencia(['opaca', 'omitida'], [])
    },
    retencion: {
      estadoActual: 'estadoOperativoActual', transicion: 'historico'
    },
    capacidadesBase: ['interpretable', 'observable']
  })
};

export const CONTRATOS_FAMILIAS_FEDERACION = Object.freeze(
  Object.fromEntries(FAMILIAS_FEDERACION.valores.map((familia) => [
    familia,
    cerrarYValidar(familia, DEFINICIONES[familia])
  ]))
);

export function obtenerContratoFamiliaFederacion(familia) {
  const nombre = exigirFamilia(familia);
  return CONTRATOS_FAMILIAS_FEDERACION[nombre];
}

export function listarContratosFamiliasFederacion() {
  return Object.freeze(FAMILIAS_FEDERACION.valores.map(obtenerContratoFamiliaFederacion));
}

export function validarSelectorFamiliaFederacion({
  familia,
  campos,
  permiteContenidoSensible,
  permiteRefederacion
} = {}) {
  const contratoFamilia = obtenerContratoFamiliaFederacion(familia);
  exigirBooleano(permiteContenidoSensible, 'permiteContenidoSensible', familia);
  exigirBooleano(permiteRefederacion, 'permiteRefederacion', familia);
  if (!Array.isArray(campos) || campos.length === 0 ||
      campos.some((campo) => typeof campo !== 'string' || !campo)) {
    fallar('selector_campos_invalido', 'El selector debe declarar campos canónicos.', familia, 'campos');
  }
  if (new Set(campos).size !== campos.length) {
    fallar('selector_campos_duplicados', 'El selector no puede repetir campos.', familia, 'campos');
  }
  if (!campos.includes(contratoFamilia.selector.campoBase)) {
    fallar(
      'conjunto_funcional_no_seleccionado',
      'La familia debe seleccionarse como conjunto funcional completo.',
      familia,
      'campos'
    );
  }
  const admitidos = new Set([
    contratoFamilia.selector.campoBase,
    ...contratoFamilia.selector.camposSensibles
  ]);
  const desconocido = campos.find((campo) => !admitidos.has(campo));
  if (desconocido) {
    fallar('campo_selector_desconocido', 'El selector contiene un campo ajeno al contrato.', familia, desconocido);
  }
  const sensiblesSeleccionados = campos.filter((campo) =>
    contratoFamilia.selector.camposSensibles.includes(campo));
  if (sensiblesSeleccionados.length > 0 && !permiteContenidoSensible) {
    fallar(
      'contenido_sensible_sin_autorizacion',
      'Seleccionar contenido sensible exige autorización expresa.',
      familia,
      sensiblesSeleccionados[0]
    );
  }
  if (permiteContenidoSensible && contratoFamilia.selector.camposSensibles.length === 0) {
    fallar(
      'familia_sin_contenido_sensible',
      'La versión vigente de la familia no declara contenido sensible.',
      familia,
      'permiteContenidoSensible'
    );
  }
  return normalizarJsonFederacion({
    familia,
    versionFamilia: contratoFamilia.versionFamilia,
    campos: [...campos].sort(),
    camposSensiblesSeleccionados: sensiblesSeleccionados.sort(),
    permiteContenidoSensible,
    permiteRefederacion
  });
}

export function clasificarRegistroFamiliaFederacion({
  familia,
  tipoRegistro,
  payload = null
} = {}) {
  const contratoFamilia = obtenerContratoFamiliaFederacion(familia);
  if (!contratoFamilia.tiposRegistro.includes(tipoRegistro)) {
    fallar('tipo_registro_familia_desconocido', 'El registro no pertenece a la familia.', familia, 'tipoRegistro');
  }
  const regla = contratoFamilia.retencion.porTipoRegistro[tipoRegistro];
  const claseRetencion = typeof regla === 'string'
    ? regla
    : resolverRetencionCondicional(regla, payload, familia, tipoRegistro);
  return Object.freeze({
    familia,
    tipoRegistro,
    claseRetencion,
    minimoOperativoProtegido: claseRetencion === 'estadoOperativoActual'
  });
}

export function evaluarReferenciaNoVisibleFamiliaFederacion({
  familia,
  referencia,
  modo
} = {}) {
  const contratoFamilia = obtenerContratoFamiliaFederacion(familia);
  const politica = contratoFamilia.referenciasNoVisibles[referencia];
  if (!politica) {
    fallar('referencia_familia_desconocida', 'La referencia no pertenece al contrato.', familia, referencia);
  }
  if (!politica.modos.includes(modo)) {
    fallar('modo_referencia_no_visible_invalido', 'La referencia no admite ese modo no visible.', familia, referencia);
  }
  return Object.freeze({
    familia,
    referencia,
    modo,
    conservaIdentidad: modo === 'opaca',
    capacidadesDegradadas: politica.capacidadesDegradadas
  });
}

export function obtenerPoliticaRetiradaFamiliaFederacion(familia) {
  return obtenerContratoFamiliaFederacion(familia).retirada;
}

function contrato({
  campoBase,
  tiposRegistro,
  sensibles,
  referencias,
  retencion,
  capacidadesBase,
  retiradaOrigen = 'permitida',
  conservarHistoricoTrasSalida = false
}) {
  return {
    campoBase,
    tiposRegistro,
    sensibles,
    referencias,
    retencion,
    capacidadesBase,
    retiradaOrigen,
    conservarHistoricoTrasSalida
  };
}

function sensible(aplicaA, capacidadesDegradadas) {
  return { aplicaA, capacidadesDegradadas };
}

function referencia(modos, capacidadesDegradadas) {
  return { modos, capacidadesDegradadas };
}

function retencionCondicional(campo, valores) {
  return { campo, valores };
}

function cerrarYValidar(familia, definicion) {
  if (!definicion) {
    fallar('contrato_familia_ausente', 'Toda familia debe poseer contrato transversal.', familia);
  }
  const tipos = unicos(definicion.tiposRegistro, familia, 'tiposRegistro');
  const retencion = Object.keys(definicion.retencion).sort();
  if (retencion.length !== tipos.length || tipos.some((tipo) => !retencion.includes(tipo))) {
    fallar('retencion_familia_incompleta', 'Cada registro debe declarar su clase de retención.', familia);
  }
  const retencionNormalizada = Object.fromEntries(Object.entries(definicion.retencion).map(
    ([tipo, regla]) => [tipo, normalizarReglaRetencion(regla, familia, tipo)]
  ));
  if (!MODOS_RETIRADA_ORIGEN.has(definicion.retiradaOrigen)) {
    fallar('retirada_origen_familia_invalida', 'La política de retirada no existe.', familia);
  }
  const sensibles = {};
  for (const [campo, politica] of Object.entries(definicion.sensibles)) {
    exigirTiposConocidos(politica.aplicaA, tipos, familia, campo);
    exigirCapacidades(politica.capacidadesDegradadas, familia, campo);
    sensibles[campo] = {
      sensibilidad: 'sensible',
      seleccion: 'explicita',
      retirada: 'retiradaCampoObligatoria',
      aplicaA: [...politica.aplicaA].sort(),
      capacidadesDegradadas: [...politica.capacidadesDegradadas].sort()
    };
  }
  const referencias = {};
  for (const [nombre, politica] of Object.entries(definicion.referencias)) {
    const modos = unicos(politica.modos, familia, `referencias.${nombre}.modos`);
    if (modos.some((modo) => !MODOS_REFERENCIA_NO_VISIBLE.has(modo))) {
      fallar('modo_referencia_familia_invalido', 'El modo de referencia no visible no existe.', familia, nombre);
    }
    exigirCapacidades(politica.capacidadesDegradadas, familia, nombre);
    referencias[nombre] = {
      modos,
      capacidadesDegradadas: [...politica.capacidadesDegradadas].sort(),
      ausenciaNoEsErrorTransporte: true
    };
  }
  const capacidadesBase = unicos(definicion.capacidadesBase, familia, 'capacidadesBase');
  exigirCapacidades(capacidadesBase, familia, 'capacidadesBase');
  const capacidadesNoAplicables = CAPACIDADES_COMPLETITUD_FEDERACION.valores
    .filter((capacidad) => !capacidadesBase.includes(capacidad))
    .sort();
  return congelarProfundo(normalizarJsonFederacion({
    perfil: PERFIL_CONTRATOS_FAMILIAS_FEDERACION,
    version: VERSION_CONTRATOS_FAMILIAS_FEDERACION,
    familia,
    versionFamilia: VERSIONES_FAMILIA_FEDERACION[familia],
    tiposRegistro: tipos,
    selector: {
      campoBase: definicion.campoBase,
      exigeConjuntoFuncionalCompleto: true,
      camposSensibles: Object.keys(sensibles).sort()
    },
    sensibilidad: sensibles,
    referenciasNoVisibles: referencias,
    completitud: {
      capacidadesBase,
      capacidadesNoAplicables,
      ausenciaCampoBaseDegrada: capacidadesBase
    },
    retencion: {
      gobiernaReceptor: true,
      limiteGlobalMasRestrictivo: true,
      porTipoRegistro: retencionNormalizada
    },
    retirada: {
      origen: definicion.retiradaOrigen,
      ausenciaNoImplicaRetirada: true,
      sinPayload: true,
      noResurreccion: true,
      retiradaCampoSensible: 'obligatoria',
      conservarHistoricoTrasSalida: definicion.conservarHistoricoTrasSalida
    }
  }));
}

function normalizarReglaRetencion(regla, familia, tipo) {
  if (typeof regla === 'string') {
    if (!CLASES_RETENCION.has(regla)) {
      fallar('clase_retencion_familia_invalida', 'La clase de retención no existe.', familia, tipo);
    }
    return regla;
  }
  if (!regla || typeof regla !== 'object' || Array.isArray(regla) ||
      typeof regla.campo !== 'string' || !regla.campo ||
      !regla.valores || typeof regla.valores !== 'object' || Array.isArray(regla.valores)) {
    fallar('regla_retencion_familia_invalida', 'La regla condicional de retención no es válida.', familia, tipo);
  }
  const valores = Object.entries(regla.valores);
  if (valores.length === 0 || valores.some(([valor, clase]) =>
    !valor || !CLASES_RETENCION.has(clase))) {
    fallar('regla_retencion_familia_invalida', 'La regla condicional posee valores inválidos.', familia, tipo);
  }
  return { campo: regla.campo, valores: Object.fromEntries(valores) };
}

function resolverRetencionCondicional(regla, payload, familia, tipoRegistro) {
  const discriminante = payload?.[regla.campo];
  const clase = regla.valores[discriminante];
  if (!clase) {
    fallar(
      'discriminante_retencion_ausente',
      'El registro no permite resolver su clase efectiva de retención.',
      familia,
      `${tipoRegistro}.${regla.campo}`
    );
  }
  return clase;
}

function exigirTiposConocidos(valores, tipos, familia, campo) {
  const normalizados = unicos(valores, familia, campo);
  if (normalizados.some((tipo) => !tipos.includes(tipo))) {
    fallar('tipo_registro_sensible_desconocido', 'La sensibilidad refiere un registro inexistente.', familia, campo);
  }
}

function exigirCapacidades(valores, familia, campo) {
  const normalizados = unicos(valores, familia, campo);
  for (const capacidad of normalizados) {
    try {
      CAPACIDADES_COMPLETITUD_FEDERACION.exigir(capacidad);
    } catch {
      fallar('capacidad_familia_desconocida', 'La capacidad de completitud no existe.', familia, campo);
    }
  }
}

function unicos(valores, familia, campo) {
  if (!Array.isArray(valores) || valores.some((valor) => typeof valor !== 'string' || !valor)) {
    fallar('lista_contrato_familia_invalida', 'El contrato necesita una lista de textos.', familia, campo);
  }
  if (new Set(valores).size !== valores.length) {
    fallar('lista_contrato_familia_duplicada', 'El contrato repite un valor.', familia, campo);
  }
  return [...valores].sort();
}

function exigirFamilia(familia) {
  try {
    return FAMILIAS_FEDERACION.exigir(familia, { campo: 'familia' });
  } catch {
    fallar('familia_contrato_desconocida', 'La familia no pertenece al contrato vigente.', familia, 'familia');
  }
}

function exigirBooleano(valor, campo, familia) {
  if (typeof valor !== 'boolean') {
    fallar('booleano_selector_familia_invalido', `${campo} debe ser booleano.`, familia, campo);
  }
}

function congelarProfundo(valor) {
  if (valor === null || typeof valor !== 'object' || Object.isFrozen(valor)) return valor;
  for (const hijo of Object.values(valor)) congelarProfundo(hijo);
  return Object.freeze(valor);
}

function fallar(codigo, mensaje, familia, campo = null) {
  throw new ErrorContratosFamiliasFederacion(codigo, mensaje, { familia, campo });
}

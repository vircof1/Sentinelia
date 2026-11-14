import { normalizarJsonFederacion } from './CanonicalizadorFederacion.js';
import { esFechaUtcCanonicaFederacion } from './FechaUtcFederacion.js';
import { crearIdentidadFederada, TIPOS_IDENTIDAD_FEDERADA } from './IdentidadFederada.js';
import {
  normalizarValorDuracionTelemetria,
  normalizarValorMomentoUtcTelemetria
} from '../../agentes/src/ContratoTelemetriaTemporalAgente.js';
import {
  CondicionMomentoUtcRelativo
} from '../../agentes/src/EvaluadorMomentoUtcRelativoTelemetria.js';

export const VERSION_PAYLOAD_TELEMETRIA_FEDERACION = 1;
export const PERFIL_PAYLOAD_TELEMETRIA_FEDERACION =
  'sentinelia-federacion-telemetria-v1';

export const TIPOS_REGISTRO_TELEMETRIA_FEDERACION = Object.freeze([
  'fuente',
  'senal',
  'observacion',
  'fotografiaSenal',
  'fotografiaPol',
  'reglaDerivacion',
  'eventoDerivado',
  'rangoHistorico'
]);

const TIPOS_DATO = new Set([
  'numero', 'booleano', 'texto', 'estado', 'json', 'duracion', 'momento_utc'
]);
const TIPOS_CONDICION = new Set([
  'numero', 'booleano', 'estado', 'texto', 'calidad',
  'duracion', 'momento_utc', 'texto_regex', 'momento_utc_relativo'
]);
const TIPOS_CONDICION_RESERVADA = new Set([
  'duracion', 'momento_utc', 'texto_regex', 'momento_utc_relativo'
]);
const OPERADORES_ORDENADOS = new Set(['<', '<=', '=', '!=', '>=', '>']);
const OPCIONES_REGEX = new Set(['i', 'm', 's']);
const ESTADOS_POL = new Set(['nuncaObservado', 'abierto', 'cerrado']);
const RESULTADOS_EVALUACION = new Set(['coincide', 'no_coincide', 'no_evaluable']);
const CAUSAS_EVALUACION_RELATIVA = new Set([
  'observacion', 'vencimiento_temporal', 'reconciliacion_administrativa',
  'reconciliacion_reloj'
]);
const LADOS_ATENCION_RELATIVA = new Set(['inferior', 'superior']);
const CAUSAS_RANGO = new Set([
  'retencionOrigen', 'saturacionEmision', 'noConservadoOrigen', 'desconocidaOrigen'
]);

export class ErrorPayloadTelemetriaFederacion extends Error {
  constructor(codigo, mensaje, { campo = null } = {}) {
    super(mensaje);
    this.name = 'ErrorPayloadTelemetriaFederacion';
    this.codigo = codigo;
    this.campo = campo;
  }
}

export function validarPayloadTelemetriaFederacion(
  payload,
  {
    operacion = 'actualizacion',
    permitirMomentoUtcRelativo = false
  } = {}
) {
  if (operacion !== 'actualizacion') {
    fallar('operacion_telemetria_invalida', 'El payload de telemetría solo acompaña actualizaciones.');
  }
  payload = normalizarJsonFederacion(payload);
  if (!objeto(payload)) fallar('payload_telemetria_invalido', 'El payload debe ser un objeto.');
  if (
    payload.perfil !== PERFIL_PAYLOAD_TELEMETRIA_FEDERACION ||
    payload.version !== VERSION_PAYLOAD_TELEMETRIA_FEDERACION
  ) {
    fallar('version_payload_telemetria_incompatible', 'Perfil o versión de telemetría incompatibles.');
  }
  if (!TIPOS_REGISTRO_TELEMETRIA_FEDERACION.includes(payload.tipoRegistro)) {
    fallar('tipo_registro_telemetria_invalido', 'El tipo de registro de telemetría no está soportado.');
  }
  const validadores = {
    fuente: validarFuente,
    senal: validarSenal,
    observacion: validarObservacion,
    fotografiaSenal: validarFotografiaSenal,
    fotografiaPol: validarFotografiaPol,
    reglaDerivacion: validarRegla,
    eventoDerivado: validarEventoDerivado,
    rangoHistorico: validarRangoHistorico
  };
  return normalizarJsonFederacion({
    perfil: PERFIL_PAYLOAD_TELEMETRIA_FEDERACION,
    version: VERSION_PAYLOAD_TELEMETRIA_FEDERACION,
    tipoRegistro: payload.tipoRegistro,
    ...validadores[payload.tipoRegistro](payload, { permitirMomentoUtcRelativo })
  });
}

function validarFuente(payload) {
  exigirClaves(payload, comunes([
    'agenteContextoOrigenId', 'guid', 'nombre', 'scopeOrganizativo'
  ]));
  return {
    agenteContextoOrigenId: idElemento(payload.agenteContextoOrigenId, 'agenteContextoOrigenId'),
    guid: texto(payload.guid, 36, 'guid'),
    nombre: texto(payload.nombre, 160, 'nombre'),
    scopeOrganizativo: validarScopeOrganizativo(payload.scopeOrganizativo)
  };
}

function validarSenal(payload) {
  exigirClaves(payload, comunes([
    'categoria', 'clave', 'codigoSenal', 'consolidadaEnUtc', 'descripcion',
    'fuenteOrigenId', 'metadatosDescriptivos', 'nombreHumano', 'tag',
    'tipoDato', 'ultimaDeclaracionUtc', 'unidad'
  ]));
  const consolidadaEnUtc = fecha(payload.consolidadaEnUtc, 'consolidadaEnUtc');
  const ultimaDeclaracionUtc = fechaOpcional(payload.ultimaDeclaracionUtc, 'ultimaDeclaracionUtc');
  // La declaración fecha el origen; la consolidación, su persistencia local.
  // Una declaración inicial puede precederla y una redeclaración ser posterior.
  const tipo = tipoDato(payload.tipoDato, 'tipoDato');
  return {
    fuenteOrigenId: idElemento(payload.fuenteOrigenId, 'fuenteOrigenId'),
    categoria: texto(payload.categoria, 64, 'categoria'),
    clave: texto(payload.clave, 128, 'clave'),
    tag: textoVacio(payload.tag, 128, 'tag'),
    codigoSenal: texto(payload.codigoSenal, 384, 'codigoSenal'),
    tipoDato: tipo,
    unidad: unidadTipoDato(payload.unidad, tipo, 'unidad'),
    nombreHumano: textoVacio(payload.nombreHumano, 128, 'nombreHumano'),
    descripcion: textoVacio(payload.descripcion, 512, 'descripcion'),
    metadatosDescriptivos: jsonObjetoOpcional(payload.metadatosDescriptivos, 'metadatosDescriptivos'),
    consolidadaEnUtc,
    ultimaDeclaracionUtc
  };
}

function validarObservacion(payload) {
  exigirClaves(payload, comunes(camposObservacion()));
  return validarCuerpoObservacion(payload, '');
}

function validarFotografiaSenal(payload) {
  exigirClaves(payload, comunes([
    'observacion', 'observacionOrigenId', 'secuenciaSenal', 'senalOrigenId'
  ]));
  exigirClaves(payload.observacion, camposObservacion());
  const observacion = validarCuerpoObservacion(payload.observacion, 'observacion.');
  const senalOrigenId = idElementoOpcional(payload.senalOrigenId, 'senalOrigenId');
  if (observacion.senalOrigenId !== senalOrigenId) {
    fallar('fotografia_senal_incoherente', 'La fotografía y su observación deben referir la misma señal.');
  }
  return {
    senalOrigenId,
    observacionOrigenId: idElementoOpcional(payload.observacionOrigenId, 'observacionOrigenId'),
    secuenciaSenal: decimalPositivoOpcional(payload.secuenciaSenal, 'secuenciaSenal'),
    observacion
  };
}

function validarFotografiaPol(payload) {
  exigirClaves(payload, comunes([
    'bootId', 'estado', 'finUtc', 'fuenteOrigenId', 'inicioUtc', 'motivoCierre',
    'periodoPolOrigenId', 'ultimoHeartbeatUtc', 'ultimoSeq'
  ]));
  if (!ESTADOS_POL.has(payload.estado)) {
    fallar('estado_fotografia_pol_invalido', 'La fotografía POL declara un estado desconocido.', 'estado');
  }
  const periodoPolOrigenId = idElementoOpcional(payload.periodoPolOrigenId, 'periodoPolOrigenId');
  if (payload.estado === 'nuncaObservado' && periodoPolOrigenId !== null) {
    fallar('fotografia_pol_incoherente', 'Nunca observado no puede referir un período POL.');
  }
  if (payload.estado !== 'nuncaObservado' && periodoPolOrigenId === null) {
    fallar('fotografia_pol_incoherente', 'Un estado POL observado debe identificar su período.');
  }
  const bootId = textoOpcional(payload.bootId, 120, 'bootId');
  const inicioUtc = fechaOpcional(payload.inicioUtc, 'inicioUtc');
  const finUtc = fechaOpcional(payload.finUtc, 'finUtc');
  const ultimoHeartbeatUtc = fechaOpcional(payload.ultimoHeartbeatUtc, 'ultimoHeartbeatUtc');
  const ultimoSeq = decimalOpcional(payload.ultimoSeq, 'ultimoSeq');
  const motivoCierre = textoOpcional(payload.motivoCierre, 64, 'motivoCierre');
  const datosPeriodo = [bootId, inicioUtc, finUtc, ultimoHeartbeatUtc, ultimoSeq, motivoCierre];
  if (payload.estado === 'nuncaObservado' && datosPeriodo.some((valor) => valor !== null)) {
    fallar('fotografia_pol_incoherente', 'Nunca observado no puede declarar datos de un período POL.');
  }
  if (payload.estado !== 'nuncaObservado' && inicioUtc === null) {
    fallar('fotografia_pol_incoherente', 'Un período POL observado debe incluir su inicio.');
  }
  if (payload.estado === 'abierto' && (finUtc !== null || motivoCierre !== null)) {
    fallar('fotografia_pol_incoherente', 'Un período POL abierto no puede declarar cierre.');
  }
  if (payload.estado === 'cerrado' && (finUtc === null || motivoCierre === null)) {
    fallar('fotografia_pol_incoherente', 'Un período POL cerrado debe declarar fecha y motivo de cierre.');
  }
  if (inicioUtc && ultimoHeartbeatUtc && ultimoHeartbeatUtc < inicioUtc) {
    fallar('fotografia_pol_incoherente', 'El último heartbeat no puede preceder al inicio del período.');
  }
  if (finUtc && inicioUtc && finUtc < inicioUtc) {
    fallar('fotografia_pol_incoherente', 'El cierre no puede preceder al inicio del período.');
  }
  if (finUtc && ultimoHeartbeatUtc && finUtc < ultimoHeartbeatUtc) {
    fallar('fotografia_pol_incoherente', 'El cierre no puede preceder al último heartbeat del período.');
  }
  return {
    fuenteOrigenId: idElemento(payload.fuenteOrigenId, 'fuenteOrigenId'),
    periodoPolOrigenId,
    estado: payload.estado,
    bootId,
    inicioUtc,
    finUtc,
    ultimoHeartbeatUtc,
    ultimoSeq,
    motivoCierre
  };
}

function validarRegla(payload, opciones) {
  const relativa = Array.isArray(payload.revisiones) && payload.revisiones.some(
    ({ condicionTipo } = {}) => condicionTipo === 'momento_utc_relativo'
  );
  exigirClaves(payload, comunes([
    'estado', 'estadoActual', 'fuenteOrigenId', 'revisiones',
    'revisionVigenteOrigenId', 'senalOrigenId',
    ...(relativa ? ['generacionAutoridad'] : [])
  ]));
  if (!['activa', 'deshabilitada'].includes(payload.estado)) {
    fallar('estado_regla_telemetria_invalido', 'La regla debe estar activa o deshabilitada.', 'estado');
  }
  if (!Array.isArray(payload.revisiones) || payload.revisiones.length === 0) {
    fallar('revisiones_regla_invalidas', 'La regla debe incluir al menos una revisión.', 'revisiones');
  }
  const revisiones = payload.revisiones.map((revision, indice) =>
    validarRevisionRegla(revision, indice, opciones)
  );
  for (let indice = 1; indice < revisiones.length; indice += 1) {
    if (BigInt(revisiones[indice - 1].numero) >= BigInt(revisiones[indice].numero)) {
      fallar('orden_revisiones_regla_invalido', 'Las revisiones deben estar ordenadas y ser únicas.');
    }
  }
  const revisionesIds = new Set(revisiones.map(({ revisionOrigenId }) => revisionOrigenId));
  const revisionVigenteOrigenId = idElemento(
    payload.revisionVigenteOrigenId,
    'revisionVigenteOrigenId'
  );
  if (!revisionesIds.has(revisionVigenteOrigenId)) {
    fallar('revision_vigente_ausente', 'La revisión vigente debe estar incluida en el agregado.');
  }
  const estadoActual = payload.estadoActual === null
    ? null
    : validarEstadoEvaluacion(payload.estadoActual, opciones);
  if (estadoActual && !revisionesIds.has(estadoActual.revisionOrigenId)) {
    fallar('revision_estado_actual_ausente', 'El estado actual refiere una revisión no incluida.');
  }
  if (estadoActual) {
    const revisionEstado = revisiones.find(
      ({ revisionOrigenId }) => revisionOrigenId === estadoActual.revisionOrigenId
    );
    const estadoRelativo = estadoActual.causalidadRevision === 'autoridad_actual';
    if (
      (revisionEstado.condicionTipo === 'momento_utc_relativo') !== estadoRelativo ||
      (estadoRelativo && estadoActual.tipoDato !== 'momento_utc')
    ) {
      fallar(
        'causalidad_estado_regla_incoherente',
        'La causalidad del estado debe coincidir con la familia de su revisión.',
        'estadoActual.causalidadRevision'
      );
    }
  }
  return {
    fuenteOrigenId: idElemento(payload.fuenteOrigenId, 'fuenteOrigenId'),
    senalOrigenId: idElemento(payload.senalOrigenId, 'senalOrigenId'),
    estado: payload.estado,
    ...(relativa
      ? { generacionAutoridad: decimalPositivo(
        payload.generacionAutoridad,
        'generacionAutoridad'
      ) }
      : {}),
    revisionVigenteOrigenId,
    revisiones,
    estadoActual
  };
}

function validarEventoDerivado(payload, opciones) {
  const relativo = payload.causalidadRevision === 'autoridad_actual';
  exigirClaves(payload, comunes([
    'calidad', 'codigoMotivo', 'condicion', 'creadoEnUtc', 'evaluadoEnUtc',
    'evento', 'evidenciaContextual', 'explicacion', 'fuenteOrigenId',
    'mensajeOperativo', 'observacionOrigenId', 'observadoEnUtc', 'recibidoEnUtc',
    'reglaOrigenId', 'revisionOrigenId', 'senalOrigenId', 'severidadCalculada',
    'tipoDato', 'unidad', 'valorEvaluado',
    ...(relativo ? camposEvaluacionRelativa() : [])
  ]));
  if (payload.evento !== 'coincide') {
    fallar('resultado_evento_derivado_invalido', 'Un evento derivado durable representa una coincidencia.');
  }
  const tipo = tipoDato(payload.tipoDato, 'tipoDato');
  return {
    reglaOrigenId: idElemento(payload.reglaOrigenId, 'reglaOrigenId'),
    revisionOrigenId: idElemento(payload.revisionOrigenId, 'revisionOrigenId'),
    observacionOrigenId: idElemento(payload.observacionOrigenId, 'observacionOrigenId'),
    fuenteOrigenId: idElemento(payload.fuenteOrigenId, 'fuenteOrigenId'),
    senalOrigenId: idElemento(payload.senalOrigenId, 'senalOrigenId'),
    evento: 'coincide',
    codigoMotivo: texto(payload.codigoMotivo, 80, 'codigoMotivo'),
    explicacion: texto(payload.explicacion, 512, 'explicacion'),
    condicion: validarCondicionEvento(payload.condicion, tipo, 'condicion', opciones),
    valorEvaluado: validarValor(payload.valorEvaluado, tipo, 'valorEvaluado'),
    tipoDato: tipo,
    unidad: unidadTipoDato(payload.unidad, tipo, 'unidad'),
    calidad: texto(payload.calidad, 32, 'calidad'),
    severidadCalculada: texto(payload.severidadCalculada, 32, 'severidadCalculada'),
    mensajeOperativo: texto(payload.mensajeOperativo, 512, 'mensajeOperativo'),
    evidenciaContextual: jsonObjetoOpcional(payload.evidenciaContextual, 'evidenciaContextual'),
    observadoEnUtc: fecha(payload.observadoEnUtc, 'observadoEnUtc'),
    recibidoEnUtc: fecha(payload.recibidoEnUtc, 'recibidoEnUtc'),
    evaluadoEnUtc: fecha(payload.evaluadoEnUtc, 'evaluadoEnUtc'),
    creadoEnUtc: fecha(payload.creadoEnUtc, 'creadoEnUtc'),
    ...(relativo ? validarEvaluacionRelativa(payload, '', opciones) : {})
  };
}

function validarRangoHistorico(payload) {
  exigirClaves(payload, comunes(['causa', 'desdeUtc', 'fuenteOrigenId', 'hastaUtc', 'senalOrigenId']));
  const desdeUtc = fecha(payload.desdeUtc, 'desdeUtc');
  const hastaUtc = fecha(payload.hastaUtc, 'hastaUtc');
  if (hastaUtc <= desdeUtc) fallar('rango_historico_invalido', 'El final debe ser posterior al inicio.');
  if (!CAUSAS_RANGO.has(payload.causa)) {
    fallar('causa_rango_historico_invalida', 'La causa del rango no disponible es desconocida.');
  }
  return {
    fuenteOrigenId: idElemento(payload.fuenteOrigenId, 'fuenteOrigenId'),
    senalOrigenId: idElemento(payload.senalOrigenId, 'senalOrigenId'),
    desdeUtc,
    hastaUtc,
    causa: payload.causa
  };
}

function validarCuerpoObservacion(valor, prefijo) {
  const tipo = tipoDato(valor.tipoDato, `${prefijo}tipoDato`);
  const observadoEnUtc = fecha(valor.observadoEnUtc, `${prefijo}observadoEnUtc`);
  const vigenteHastaUtc = fechaOpcional(valor.vigenteHastaUtc, `${prefijo}vigenteHastaUtc`);
  if (vigenteHastaUtc !== null && vigenteHastaUtc < observadoEnUtc) {
    fallar('vigencia_observacion_invalida', 'La vigencia no puede terminar antes de la observación.', `${prefijo}vigenteHastaUtc`);
  }
  return {
    fuenteOrigenId: idElemento(valor.fuenteOrigenId, `${prefijo}fuenteOrigenId`),
    senalOrigenId: idElementoOpcional(valor.senalOrigenId, `${prefijo}senalOrigenId`),
    periodoPolOrigenId: idElementoOpcional(valor.periodoPolOrigenId, `${prefijo}periodoPolOrigenId`),
    categoria: texto(valor.categoria, 64, `${prefijo}categoria`),
    clave: texto(valor.clave, 128, `${prefijo}clave`),
    tag: textoVacio(valor.tag, 128, `${prefijo}tag`),
    codigoSenal: texto(valor.codigoSenal, 384, `${prefijo}codigoSenal`),
    tipoDato: tipo,
    unidad: unidadTipoDato(valor.unidad, tipo, `${prefijo}unidad`),
    valor: validarValor(valor.valor, tipo, `${prefijo}valor`),
    calidad: texto(valor.calidad, 32, `${prefijo}calidad`),
    severidadDeclarada: texto(valor.severidadDeclarada, 32, `${prefijo}severidadDeclarada`),
    origen: texto(valor.origen, 32, `${prefijo}origen`),
    vigenteHastaUtc,
    detalleHumano: textoOpcional(valor.detalleHumano, 512, `${prefijo}detalleHumano`),
    metadatosContextuales: jsonObjetoOpcional(valor.metadatosContextuales, `${prefijo}metadatosContextuales`),
    emitidoEnUtc: fechaOpcional(valor.emitidoEnUtc, `${prefijo}emitidoEnUtc`),
    observadoEnUtc,
    recibidoEnUtc: fecha(valor.recibidoEnUtc, `${prefijo}recibidoEnUtc`)
  };
}

function validarRevisionRegla(revision, indice, opciones) {
  exigirClaves(revision, [
    'condicion', 'condicionTipo', 'condicionVersion', 'descripcion',
    'metadatosDescriptivos', 'mensajeOperativo', 'nombre', 'numero',
    'revisionOrigenId', 'severidadCalculada', 'vigenteDesdeUtc', 'vigenteHastaUtc'
  ]);
  const prefijo = `revisiones.${indice}`;
  if (!TIPOS_CONDICION.has(revision.condicionTipo)) {
    fallar('tipo_condicion_regla_invalido', 'El tipo de condición no está soportado.', `${prefijo}.condicionTipo`);
  }
  exigirCapacidadRelativa(revision.condicionTipo, opciones, `${prefijo}.condicionTipo`);
  const condicionVersion = decimalPositivo(
    revision.condicionVersion,
    `${prefijo}.condicionVersion`
  );
  const condicion = TIPOS_CONDICION_RESERVADA.has(revision.condicionTipo)
    ? validarCondicionReservada(
      revision.condicion,
      revision.condicionTipo,
      condicionVersion,
      `${prefijo}.condicion`
    )
    : jsonObjeto(revision.condicion, `${prefijo}.condicion`);
  const vigenteDesdeUtc = fecha(revision.vigenteDesdeUtc, `${prefijo}.vigenteDesdeUtc`);
  const vigenteHastaUtc = fechaOpcional(revision.vigenteHastaUtc, `${prefijo}.vigenteHastaUtc`);
  if (vigenteHastaUtc !== null && vigenteHastaUtc <= vigenteDesdeUtc) {
    fallar('vigencia_revision_regla_invalida', 'El final de una revisión debe ser posterior a su inicio.', `${prefijo}.vigenteHastaUtc`);
  }
  return {
    revisionOrigenId: idElemento(revision.revisionOrigenId, `${prefijo}.revisionOrigenId`),
    numero: decimalPositivo(revision.numero, `${prefijo}.numero`),
    condicionTipo: revision.condicionTipo,
    condicionVersion,
    condicion,
    severidadCalculada: texto(revision.severidadCalculada, 32, `${prefijo}.severidadCalculada`),
    mensajeOperativo: texto(revision.mensajeOperativo, 512, `${prefijo}.mensajeOperativo`),
    nombre: texto(revision.nombre, 160, `${prefijo}.nombre`),
    descripcion: textoOpcional(revision.descripcion, 512, `${prefijo}.descripcion`),
    metadatosDescriptivos: jsonObjetoOpcional(revision.metadatosDescriptivos, `${prefijo}.metadatosDescriptivos`),
    vigenteDesdeUtc,
    vigenteHastaUtc
  };
}

function validarEstadoEvaluacion(estado, opciones) {
  const relativo = estado.causalidadRevision === 'autoridad_actual';
  exigirClaves(estado, [
    'calidad', 'codigoMotivo', 'evaluadoEnUtc', 'evidenciaContextual',
    'explicacion', 'mensajeOperativo', 'observacionOrigenId', 'observadoEnUtc',
    'recibidoEnUtc', 'resultado', 'revisionOrigenId', 'severidadCalculada',
    'tipoDato', 'unidad', 'valorEvaluado',
    ...(relativo ? camposEvaluacionRelativa() : [])
  ]);
  if (!RESULTADOS_EVALUACION.has(estado.resultado)) {
    fallar('resultado_evaluacion_invalido', 'El resultado ternario no está soportado.');
  }
  const severidad = estado.severidadCalculada === null
    ? null : texto(estado.severidadCalculada, 32, 'estadoActual.severidadCalculada');
  if ((estado.resultado === 'coincide') !== (severidad !== null)) {
    fallar('severidad_evaluacion_incoherente', 'Solo una coincidencia posee severidad calculada.');
  }
  const tipo = tipoDato(estado.tipoDato, 'estadoActual.tipoDato');
  return {
    revisionOrigenId: idElemento(estado.revisionOrigenId, 'estadoActual.revisionOrigenId'),
    observacionOrigenId: idElemento(estado.observacionOrigenId, 'estadoActual.observacionOrigenId'),
    resultado: estado.resultado,
    codigoMotivo: texto(estado.codigoMotivo, 80, 'estadoActual.codigoMotivo'),
    explicacion: texto(estado.explicacion, 512, 'estadoActual.explicacion'),
    valorEvaluado: validarValor(estado.valorEvaluado, tipo, 'estadoActual.valorEvaluado'),
    tipoDato: tipo,
    unidad: unidadTipoDato(estado.unidad, tipo, 'estadoActual.unidad'),
    calidad: texto(estado.calidad, 32, 'estadoActual.calidad'),
    severidadCalculada: severidad,
    mensajeOperativo: texto(estado.mensajeOperativo, 512, 'estadoActual.mensajeOperativo'),
    evidenciaContextual: jsonObjetoOpcional(estado.evidenciaContextual, 'estadoActual.evidenciaContextual'),
    observadoEnUtc: fecha(estado.observadoEnUtc, 'estadoActual.observadoEnUtc'),
    recibidoEnUtc: fecha(estado.recibidoEnUtc, 'estadoActual.recibidoEnUtc'),
    evaluadoEnUtc: fecha(estado.evaluadoEnUtc, 'estadoActual.evaluadoEnUtc'),
    ...(relativo
      ? validarEvaluacionRelativa(estado, 'estadoActual.', opciones)
      : {})
  };
}

function camposEvaluacionRelativa() {
  return [
    'causa', 'causalidadRevision', 'evaluacionOrigenId', 'evidenciaTemporal',
    'generacionAutoridad', 'ladoAtencion'
  ];
}

function validarEvaluacionRelativa(valor, prefijo, opciones) {
  exigirCapacidadRelativa('momento_utc_relativo', opciones,
    `${prefijo}causalidadRevision`);
  if (valor.causalidadRevision !== 'autoridad_actual') {
    fallar(
      'causalidad_evaluacion_relativa_invalida',
      'Una evaluación temporal relativa exige autoridad actual.',
      `${prefijo}causalidadRevision`
    );
  }
  if (!CAUSAS_EVALUACION_RELATIVA.has(valor.causa)) {
    fallar(
      'causa_evaluacion_relativa_invalida',
      'La causa de evaluación temporal relativa no está soportada.',
      `${prefijo}causa`
    );
  }
  const resultado = valor.resultado ?? valor.evento;
  const ladoAtencion = valor.ladoAtencion === null
    ? null
    : enumValor(
      valor.ladoAtencion,
      LADOS_ATENCION_RELATIVA,
      'lado_evaluacion_relativa_invalido',
      `${prefijo}ladoAtencion`
    );
  if ((resultado === 'coincide') !== (ladoAtencion !== null)) {
    fallar(
      'lado_evaluacion_relativa_incoherente',
      'Solo una coincidencia relativa identifica un lado de atención.',
      `${prefijo}ladoAtencion`
    );
  }
  return {
    evaluacionOrigenId: idElemento(
      valor.evaluacionOrigenId,
      `${prefijo}evaluacionOrigenId`
    ),
    generacionAutoridad: decimalPositivo(
      valor.generacionAutoridad,
      `${prefijo}generacionAutoridad`
    ),
    causalidadRevision: 'autoridad_actual',
    causa: valor.causa,
    ladoAtencion,
    evidenciaTemporal: validarEvidenciaTemporalRelativa(
      valor.evidenciaTemporal,
      resultado,
      valor.causa,
      `${prefijo}evidenciaTemporal`
    )
  };
}

function validarEvidenciaTemporalRelativa(evidencia, resultado, causa, campo) {
  exigirClaves(evidencia, [
    'ahoraUtc', 'correccionReloj', 'desviacionSegundos', 'ladoAnterior',
    'momentoUtc', 'programadoParaUtc', 'proximaReevaluacionUtc',
    'resultadoAnterior'
  ]);
  const momentoUtc = fechaOpcional(evidencia.momentoUtc, `${campo}.momentoUtc`);
  const ahoraUtc = fecha(evidencia.ahoraUtc, `${campo}.ahoraUtc`);
  const desviacionSegundos = decimalFirmadoOpcional(
    evidencia.desviacionSegundos,
    `${campo}.desviacionSegundos`
  );
  if (
    (resultado === 'no_evaluable') !==
    (momentoUtc === null && desviacionSegundos === null)
  ) {
    fallar(
      'evidencia_temporal_relativa_incoherente',
      'Momento y desviación solo faltan en una evaluación no evaluable.',
      campo
    );
  }
  const resultadoAnterior = evidencia.resultadoAnterior === null
    ? null
    : enumValor(
      evidencia.resultadoAnterior,
      RESULTADOS_EVALUACION,
      'resultado_anterior_relativo_invalido',
      `${campo}.resultadoAnterior`
    );
  const ladoAnterior = evidencia.ladoAnterior === null
    ? null
    : enumValor(
      evidencia.ladoAnterior,
      LADOS_ATENCION_RELATIVA,
      'lado_anterior_relativo_invalido',
      `${campo}.ladoAnterior`
    );
  if ((resultadoAnterior === 'coincide') !== (ladoAnterior !== null)) {
    fallar(
      'estado_anterior_relativo_incoherente',
      'El lado anterior solo acompaña una coincidencia anterior.',
      campo
    );
  }
  const programadoParaUtc = fechaOpcional(
    evidencia.programadoParaUtc,
    `${campo}.programadoParaUtc`
  );
  if ((causa === 'vencimiento_temporal') !== (programadoParaUtc !== null)) {
    fallar(
      'programacion_evaluacion_relativa_incoherente',
      'Solo un vencimiento temporal conserva fecha programada.',
      `${campo}.programadoParaUtc`
    );
  }
  const correccionReloj = evidencia.correccionReloj === null
    ? null
    : validarCorreccionReloj(evidencia.correccionReloj, `${campo}.correccionReloj`);
  if ((causa === 'reconciliacion_reloj') !== (correccionReloj !== null)) {
    fallar(
      'correccion_reloj_evaluacion_incoherente',
      'La evidencia de reloj solo acompaña su reconciliación.',
      `${campo}.correccionReloj`
    );
  }
  return {
    momentoUtc,
    ahoraUtc,
    desviacionSegundos,
    resultadoAnterior,
    ladoAnterior,
    programadoParaUtc,
    proximaReevaluacionUtc: fechaOpcional(
      evidencia.proximaReevaluacionUtc,
      `${campo}.proximaReevaluacionUtc`
    ),
    correccionReloj
  };
}

function validarCorreccionReloj(valor, campo) {
  exigirClaves(valor, [
    'generacionCorreccion', 'relojAnteriorUtc', 'relojCorregidoUtc'
  ]);
  return {
    generacionCorreccion: decimalPositivo(
      valor.generacionCorreccion,
      `${campo}.generacionCorreccion`
    ),
    relojAnteriorUtc: fecha(valor.relojAnteriorUtc, `${campo}.relojAnteriorUtc`),
    relojCorregidoUtc: fecha(valor.relojCorregidoUtc, `${campo}.relojCorregidoUtc`)
  };
}

function exigirCapacidadRelativa(tipo, opciones, campo) {
  if (tipo === 'momento_utc_relativo' && !opciones?.permitirMomentoUtcRelativo) {
    fallar(
      'capacidad_momento_utc_relativo_cerrada',
      'La capacidad temporal relativa está preparada pero todavía no habilitada.',
      campo
    );
  }
}

function validarScopeOrganizativo(scope) {
  exigirClaves(scope, ['empresaElementoOrigenId', 'sitioElementoOrigenId', 'tenantElementoOrigenId']);
  return {
    tenantElementoOrigenId: idElemento(scope.tenantElementoOrigenId, 'scopeOrganizativo.tenantElementoOrigenId'),
    empresaElementoOrigenId: idElemento(scope.empresaElementoOrigenId, 'scopeOrganizativo.empresaElementoOrigenId'),
    sitioElementoOrigenId: idElemento(scope.sitioElementoOrigenId, 'scopeOrganizativo.sitioElementoOrigenId')
  };
}

function validarValor(valor, tipo, campo) {
  if (tipo === 'numero') {
    if (typeof valor !== 'number' || !Number.isFinite(valor)) fallar('valor_telemetria_invalido', `${campo} no es número finito.`, campo);
    return valor;
  }
  if (tipo === 'booleano') {
    if (typeof valor !== 'boolean') fallar('valor_telemetria_invalido', `${campo} no es booleano.`, campo);
    return valor;
  }
  if (tipo === 'texto') return textoVacio(valor, 2048, campo);
  if (tipo === 'estado') return texto(valor, 128, campo);
  if (tipo === 'duracion') {
    try {
      return normalizarValorDuracionTelemetria(valor);
    } catch {
      fallar('valor_telemetria_invalido', `${campo} no es una duración canónica.`, campo);
    }
  }
  if (tipo === 'momento_utc') {
    try {
      return normalizarValorMomentoUtcTelemetria(valor);
    } catch {
      fallar('valor_telemetria_invalido', `${campo} no es un momento UTC canónico.`, campo);
    }
  }
  return jsonDefinido(valor, campo);
}

function unidadTipoDato(valor, tipo, campo) {
  const unidad = textoVacio(valor, 32, campo);
  if ((tipo === 'duracion' || tipo === 'momento_utc') && unidad !== '') {
    fallar(
      'unidad_telemetria_invalida',
      `${campo} debe estar vacía para un tipo temporal federado.`,
      campo
    );
  }
  return unidad;
}

function validarCondicionEvento(condicion, tipoDatoEvento, campo, opciones) {
  const objetoCondicion = jsonObjeto(condicion, campo);
  const tipoCondicion = objetoCondicion.tipo;
  if (TIPOS_CONDICION_RESERVADA.has(tipoCondicion)) {
    exigirCapacidadRelativa(tipoCondicion, opciones, `${campo}.tipo`);
    if (
      tipoCondicion !== tipoDatoEvento &&
      !(tipoCondicion === 'momento_utc_relativo' && tipoDatoEvento === 'momento_utc') &&
      !(tipoCondicion === 'texto_regex' && tipoDatoEvento === 'texto')
    ) {
      fallar(
        'tipo_condicion_regla_invalido',
        'La condición reservada no corresponde al valor evaluado.',
        `${campo}.tipo`
      );
    }
    return validarCondicionReservada(
      objetoCondicion,
      tipoCondicion,
      String(objetoCondicion.version),
      campo
    );
  }
  return objetoCondicion;
}

function validarCondicionReservada(condicion, tipoCondicion, version, campo) {
  exigirClaves(condicion, ['configuracion', 'tipo', 'version']);
  if (
    version !== '1' ||
    condicion.tipo !== tipoCondicion ||
    condicion.version !== 1
  ) {
    fallar(
      'version_condicion_regla_invalida',
      'La condición reservada debe usar su forma canónica de versión 1.',
      campo
    );
  }
  const configuracion = jsonObjeto(condicion.configuracion, `${campo}.configuracion`);
  if (tipoCondicion === 'momento_utc_relativo') {
    try {
      return new CondicionMomentoUtcRelativo(condicion).serializar();
    } catch (error) {
      fallar(
        'condicion_momento_utc_relativo_invalida',
        `La condición temporal relativa no es canónica: ${error.message}`,
        campo
      );
    }
  }
  if (tipoCondicion === 'duracion') {
    exigirClaves(configuracion, ['operador', 'umbral']);
    return {
      tipo: 'duracion',
      version: 1,
      configuracion: {
        operador: operadorOrdenado(configuracion.operador, `${campo}.configuracion.operador`),
        umbral: validarValor(configuracion.umbral, 'duracion', `${campo}.configuracion.umbral`)
      }
    };
  }
  if (tipoCondicion === 'momento_utc') {
    exigirClaves(configuracion, ['operador', 'umbralUtc']);
    return {
      tipo: 'momento_utc',
      version: 1,
      configuracion: {
        operador: operadorOrdenado(configuracion.operador, `${campo}.configuracion.operador`),
        umbralUtc: validarValor(
          configuracion.umbralUtc,
          'momento_utc',
          `${campo}.configuracion.umbralUtc`
        )
      }
    };
  }
  exigirClaves(configuracion, ['modo', 'opciones', 'operador', 'patron', 'umbral']);
  const modo = configuracion.modo;
  if (modo !== 'existe' && modo !== 'conteo') {
    fallar('modo_condicion_regex_invalido', 'El modo regex no está soportado.', `${campo}.configuracion.modo`);
  }
  const patron = configuracion.patron;
  if (typeof patron !== 'string' || Array.from(patron).length > 256) {
    fallar('patron_condicion_regex_invalido', 'El patrón regex supera la forma canónica.', `${campo}.configuracion.patron`);
  }
  const opciones = validarOpcionesRegex(configuracion.opciones, `${campo}.configuracion.opciones`);
  let operador = null;
  let umbral = null;
  if (modo === 'existe') {
    if (configuracion.operador !== null || configuracion.umbral !== null) {
      fallar('forma_condicion_regex_invalida', 'El modo existe no admite operador ni umbral.', `${campo}.configuracion`);
    }
  } else {
    operador = operadorOrdenado(configuracion.operador, `${campo}.configuracion.operador`);
    umbral = enteroNoNegativo(configuracion.umbral, `${campo}.configuracion.umbral`);
  }
  return {
    tipo: 'texto_regex',
    version: 1,
    configuracion: { modo, patron, opciones, operador, umbral }
  };
}

function validarOpcionesRegex(valor, campo) {
  if (!Array.isArray(valor)) {
    fallar('opciones_condicion_regex_invalidas', 'Las opciones regex deben ser una lista.', campo);
  }
  const canonicas = [...valor].sort();
  if (
    valor.some((opcion) => typeof opcion !== 'string' || !OPCIONES_REGEX.has(opcion)) ||
    new Set(valor).size !== valor.length ||
    valor.some((opcion, indice) => opcion !== canonicas[indice])
  ) {
    fallar('opciones_condicion_regex_invalidas', 'Las opciones regex no son canónicas.', campo);
  }
  return valor;
}

function operadorOrdenado(valor, campo) {
  if (!OPERADORES_ORDENADOS.has(valor)) {
    fallar('operador_condicion_invalido', 'El operador ordenado no está soportado.', campo);
  }
  return valor;
}

function enteroNoNegativo(valor, campo) {
  if (!Number.isSafeInteger(valor) || valor < 0) {
    fallar('umbral_condicion_invalido', 'El umbral debe ser un entero no negativo.', campo);
  }
  return valor;
}

function camposObservacion() {
  return [
    'calidad', 'categoria', 'clave', 'codigoSenal', 'detalleHumano',
    'emitidoEnUtc', 'fuenteOrigenId', 'metadatosContextuales', 'observadoEnUtc',
    'origen', 'periodoPolOrigenId', 'recibidoEnUtc', 'senalOrigenId',
    'severidadDeclarada', 'tag', 'tipoDato', 'unidad', 'valor', 'vigenteHastaUtc'
  ];
}

function comunes(campos) { return ['perfil', 'tipoRegistro', 'version', ...campos]; }

function exigirClaves(valor, esperadas) {
  if (!objeto(valor)) fallar('forma_payload_telemetria_invalida', 'El payload contiene una estructura inválida.');
  const actuales = Object.keys(valor).sort();
  const ordenadas = [...esperadas].sort();
  if (actuales.length !== ordenadas.length || actuales.some((clave, i) => clave !== ordenadas[i])) {
    fallar('forma_payload_telemetria_invalida', 'El payload contiene campos ausentes o desconocidos.');
  }
}

function idElemento(valor, campo) {
  try { return String(crearIdentidadFederada({ tipo: TIPOS_IDENTIDAD_FEDERADA.ELEMENTO_ORIGEN, valor })); }
  catch { fallar('identidad_telemetria_invalida', `${campo} no es una identidad de origen válida.`, campo); }
}
function idElementoOpcional(valor, campo) { return valor === null ? null : idElemento(valor, campo); }
function tipoDato(valor, campo) {
  if (!TIPOS_DATO.has(valor)) fallar('tipo_dato_telemetria_invalido', `${campo} no es un tipo de dato soportado.`, campo);
  return valor;
}
function texto(valor, maximo, campo) {
  if (typeof valor !== 'string' || !valor || valor !== valor.trim() || valor.length > maximo) {
    fallar('texto_telemetria_invalido', `${campo} no es texto canónico válido.`, campo);
  }
  return valor;
}
function textoVacio(valor, maximo, campo) {
  if (typeof valor !== 'string' || valor !== valor.trim() || valor.length > maximo) {
    fallar('texto_telemetria_invalido', `${campo} no es texto canónico válido.`, campo);
  }
  return valor;
}
function textoOpcional(valor, maximo, campo) { return valor === null ? null : texto(valor, maximo, campo); }
function fecha(valor, campo) {
  if (!esFechaUtcCanonicaFederacion(valor)) {
    fallar('fecha_telemetria_invalida', `${campo} debe ser UTC ISO con milisegundos.`, campo);
  }
  return valor;
}
function fechaOpcional(valor, campo) { return valor === null ? null : fecha(valor, campo); }
function decimalPositivo(valor, campo) {
  const resultado = String(valor);
  if (!/^[1-9]\d*$/u.test(resultado)) fallar('decimal_telemetria_invalido', `${campo} debe ser positivo.`, campo);
  return resultado;
}
function decimalOpcional(valor, campo) {
  if (valor === null) return null;
  const resultado = String(valor);
  if (!/^(0|[1-9]\d*)$/u.test(resultado)) fallar('decimal_telemetria_invalido', `${campo} debe ser no negativo.`, campo);
  return resultado;
}
function decimalPositivoOpcional(valor, campo) {
  return valor === null ? null : decimalPositivo(valor, campo);
}
function decimalFirmadoOpcional(valor, campo) {
  if (valor === null) return null;
  const resultado = String(valor);
  if (!/^(0|-?[1-9]\d*)$/u.test(resultado)) {
    fallar(
      'decimal_firmado_telemetria_invalido',
      `${campo} debe ser una cadena decimal firmada canónica.`,
      campo
    );
  }
  return resultado;
}
function enumValor(valor, permitidos, codigo, campo) {
  if (!permitidos.has(valor)) {
    fallar(codigo, `${campo} contiene un valor no soportado.`, campo);
  }
  return valor;
}
function jsonObjeto(valor, campo) {
  if (!objeto(valor)) fallar('json_telemetria_invalido', `${campo} debe ser un objeto JSON.`, campo);
  return valor;
}
function jsonObjetoOpcional(valor, campo) { return valor === null ? null : jsonObjeto(valor, campo); }
function jsonDefinido(valor, campo) {
  if (valor === undefined) fallar('json_telemetria_invalido', `${campo} debe estar definido.`, campo);
  return valor;
}
function objeto(valor) { return Boolean(valor) && typeof valor === 'object' && !Array.isArray(valor); }
function fallar(codigo, mensaje, campo = null) {
  throw new ErrorPayloadTelemetriaFederacion(codigo, mensaje, { campo });
}

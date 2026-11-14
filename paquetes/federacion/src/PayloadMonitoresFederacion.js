import { normalizarJsonFederacion } from './CanonicalizadorFederacion.js';
import { esFechaUtcCanonicaFederacion } from './FechaUtcFederacion.js';
import { crearIdentidadFederada, TIPOS_IDENTIDAD_FEDERADA } from './IdentidadFederada.js';

export const VERSION_PAYLOAD_MONITORES_FEDERACION = 1;
export const PERFIL_PAYLOAD_MONITORES_FEDERACION =
  'sentinelia-federacion-monitores-v1';

export const TIPOS_REGISTRO_MONITORES_FEDERACION = Object.freeze([
  'definicion',
  'estadoActual',
  'evento',
  'tramoHistorico',
  'alerta',
  'referenciaTrigger',
  'rangoHistorico'
]);

const INTERPRETACIONES_ESTADO = new Set(['normal', 'invertida']);
const VISIBILIDADES_REFERENCIA = new Set(['visible', 'opaca']);
const ESTADOS_ALERTA = new Set(['activa', 'cerrada']);
const CAUSAS_RANGO = new Set([
  'retencionOrigen', 'saturacionEmision', 'noConservadoOrigen', 'desconocidaOrigen'
]);
const CAUSAS_CREDENCIAL_OMITIDA = new Set([
  'noSeleccionada', 'noAutorizada', 'noExiste'
]);
const CLAVES_SENSIBLES = /password|passwd|contrasena|secret|secreto|token|api[_-]?key|credential|credencial/iu;
const CLAVES_IDENTIDAD_LOCAL = /^(monitor|agente|senal|regla|trigger)(Id|_id)$/iu;

export class ErrorPayloadMonitoresFederacion extends Error {
  constructor(codigo, mensaje, { campo = null } = {}) {
    super(mensaje);
    this.name = 'ErrorPayloadMonitoresFederacion';
    this.codigo = codigo;
    this.campo = campo;
  }
}

export function validarPayloadMonitoresFederacion(
  payload,
  { operacion = 'actualizacion' } = {}
) {
  if (operacion !== 'actualizacion') {
    fallar('operacion_monitor_invalida', 'El payload de monitor solo acompaña actualizaciones.');
  }
  payload = normalizarJsonFederacion(payload);
  if (!objeto(payload)) fallar('payload_monitor_invalido', 'El payload debe ser un objeto.');
  if (
    payload.perfil !== PERFIL_PAYLOAD_MONITORES_FEDERACION ||
    payload.version !== VERSION_PAYLOAD_MONITORES_FEDERACION
  ) {
    fallar('version_payload_monitor_incompatible', 'Perfil o versión de monitor incompatibles.');
  }
  if (!TIPOS_REGISTRO_MONITORES_FEDERACION.includes(payload.tipoRegistro)) {
    fallar('tipo_registro_monitor_invalido', 'El tipo de registro de monitor no está soportado.');
  }
  const validadores = {
    definicion: validarDefinicion,
    estadoActual: validarEstadoActual,
    evento: validarEvento,
    tramoHistorico: validarTramoHistorico,
    alerta: validarAlerta,
    referenciaTrigger: validarReferenciaTrigger,
    rangoHistorico: validarRangoHistorico
  };
  return normalizarJsonFederacion({
    perfil: PERFIL_PAYLOAD_MONITORES_FEDERACION,
    version: VERSION_PAYLOAD_MONITORES_FEDERACION,
    tipoRegistro: payload.tipoRegistro,
    ...validadores[payload.tipoRegistro](payload)
  });
}

function validarDefinicion(payload) {
  exigirClaves(payload, comunes([
    'activo', 'configuracionOperativa', 'contextoHumano', 'credencialPropia',
    'descripcion', 'desfaseInicialSegundos', 'intervaloEjecucionSegundos',
    'interpretacionEstado', 'nombre', 'referenciasOperativas',
    'scopeOrganizativo', 'tipo'
  ]));
  if (!INTERPRETACIONES_ESTADO.has(payload.interpretacionEstado)) {
    fallar('interpretacion_estado_monitor_invalida', 'La interpretación del monitor no está soportada.');
  }
  const configuracionOperativa = jsonObjeto(payload.configuracionOperativa, 'configuracionOperativa');
  exigirConfiguracionSinCredenciales(configuracionOperativa);
  if (!Array.isArray(payload.referenciasOperativas)) {
    fallar('referencias_operativas_monitor_invalidas', 'Las referencias operativas deben ser una lista.');
  }
  const referenciasOperativas = payload.referenciasOperativas.map(validarReferenciaOperativa);
  exigirReferenciasOperativasUnicas(referenciasOperativas);
  return {
    nombre: texto(payload.nombre, 160, 'nombre'),
    tipo: textoAscii(payload.tipo, 40, 'tipo'),
    descripcion: textoOpcional(payload.descripcion, 512, 'descripcion'),
    activo: booleano(payload.activo, 'activo'),
    intervaloEjecucionSegundos: entero(payload.intervaloEjecucionSegundos, 1, 65535, 'intervaloEjecucionSegundos'),
    desfaseInicialSegundos: entero(payload.desfaseInicialSegundos, 0, 65535, 'desfaseInicialSegundos'),
    interpretacionEstado: payload.interpretacionEstado,
    configuracionOperativa,
    contextoHumano: validarContextoHumano(payload.contextoHumano),
    scopeOrganizativo: validarScopeOrganizativo(payload.scopeOrganizativo),
    credencialPropia: validarCredencial(payload.credencialPropia),
    referenciasOperativas
  };
}

function validarEstadoActual(payload) {
  exigirClaves(payload, comunes([
    'contextoHumano', 'ejecutadoTodavia', 'estado', 'fechaUltimaEjecucionUtc',
    'fechaUltimoCambioUtc', 'monitorOrigenId', 'motivoInicial',
    'resultadoActual', 'versionCatalogo', 'vigenteHastaOrigenUtc'
  ]));
  const ejecutadoTodavia = booleano(payload.ejecutadoTodavia, 'ejecutadoTodavia');
  const fechaUltimaEjecucionUtc = fechaOpcional(payload.fechaUltimaEjecucionUtc, 'fechaUltimaEjecucionUtc');
  const fechaUltimoCambioUtc = fechaOpcional(payload.fechaUltimoCambioUtc, 'fechaUltimoCambioUtc');
  if (ejecutadoTodavia && fechaUltimaEjecucionUtc === null) {
    fallar('estado_monitor_sin_ejecucion', 'Un estado ejecutado debe indicar su última ejecución.');
  }
  if (!ejecutadoTodavia && (fechaUltimaEjecucionUtc !== null || payload.resultadoActual !== null)) {
    fallar('estado_monitor_no_ejecutado_incoherente', 'Un monitor no ejecutado no posee resultado ni fecha de ejecución.');
  }
  const vigenteHastaOrigenUtc = fecha(payload.vigenteHastaOrigenUtc, 'vigenteHastaOrigenUtc');
  if (fechaUltimaEjecucionUtc !== null && vigenteHastaOrigenUtc < fechaUltimaEjecucionUtc) {
    fallar('vigencia_estado_monitor_invalida', 'La vigencia no puede preceder a la ejecución que sostiene el estado.');
  }
  return {
    monitorOrigenId: idElemento(payload.monitorOrigenId, 'monitorOrigenId'),
    versionCatalogo: textoAscii(payload.versionCatalogo, 40, 'versionCatalogo'),
    estado: textoAscii(payload.estado, 40, 'estado'),
    ejecutadoTodavia,
    fechaUltimaEjecucionUtc,
    fechaUltimoCambioUtc,
    motivoInicial: textoAscii(payload.motivoInicial, 80, 'motivoInicial'),
    resultadoActual: jsonObjetoOpcional(payload.resultadoActual, 'resultadoActual'),
    contextoHumano: validarContextoHumano(payload.contextoHumano),
    vigenteHastaOrigenUtc
  };
}

function validarEvento(payload) {
  exigirClaves(payload, comunes([
    'codigoResultado', 'contextoHumano', 'duracionTotalMs', 'ejecutadoEnUtc',
    'estadoDetectado', 'exito', 'mensajeResultado', 'monitorOrigenId',
    'payloadEvento', 'tipoMonitor', 'versionCatalogo'
  ]));
  return {
    monitorOrigenId: idElemento(payload.monitorOrigenId, 'monitorOrigenId'),
    versionCatalogo: textoAscii(payload.versionCatalogo, 40, 'versionCatalogo'),
    tipoMonitor: textoAscii(payload.tipoMonitor, 40, 'tipoMonitor'),
    estadoDetectado: textoAscii(payload.estadoDetectado, 40, 'estadoDetectado'),
    codigoResultado: textoAscii(payload.codigoResultado, 80, 'codigoResultado'),
    mensajeResultado: texto(payload.mensajeResultado, 500, 'mensajeResultado'),
    exito: booleano(payload.exito, 'exito'),
    duracionTotalMs: entero(payload.duracionTotalMs, 0, 4_294_967_295, 'duracionTotalMs'),
    ejecutadoEnUtc: fecha(payload.ejecutadoEnUtc, 'ejecutadoEnUtc'),
    payloadEvento: jsonObjetoOpcional(payload.payloadEvento, 'payloadEvento'),
    contextoHumano: validarContextoHumano(payload.contextoHumano)
  };
}

function validarTramoHistorico(payload) {
  exigirClaves(payload, comunes([
    'codigoUltimoResultado', 'contextoHumano', 'contadorRepeticiones',
    'estadoTramo', 'mensajeUltimoResultado', 'monitorOrigenId', 'payloadTramo',
    'tipoMonitor', 'ultimoEventoOrigenId', 'validoDesdeUtc', 'validoHastaUtc',
    'versionCatalogo'
  ]));
  const validoDesdeUtc = fecha(payload.validoDesdeUtc, 'validoDesdeUtc');
  const validoHastaUtc = fecha(payload.validoHastaUtc, 'validoHastaUtc');
  if (validoHastaUtc < validoDesdeUtc) {
    fallar('tramo_historico_monitor_invalido', 'El tramo no puede finalizar antes de comenzar.');
  }
  return {
    monitorOrigenId: idElemento(payload.monitorOrigenId, 'monitorOrigenId'),
    versionCatalogo: textoAscii(payload.versionCatalogo, 40, 'versionCatalogo'),
    tipoMonitor: textoAscii(payload.tipoMonitor, 40, 'tipoMonitor'),
    estadoTramo: textoAscii(payload.estadoTramo, 40, 'estadoTramo'),
    codigoUltimoResultado: textoAscii(payload.codigoUltimoResultado, 80, 'codigoUltimoResultado'),
    mensajeUltimoResultado: texto(payload.mensajeUltimoResultado, 500, 'mensajeUltimoResultado'),
    validoDesdeUtc,
    validoHastaUtc,
    contadorRepeticiones: entero(payload.contadorRepeticiones, 1, 4_294_967_295, 'contadorRepeticiones'),
    ultimoEventoOrigenId: idElementoOpcional(payload.ultimoEventoOrigenId, 'ultimoEventoOrigenId'),
    payloadTramo: jsonObjetoOpcional(payload.payloadTramo, 'payloadTramo'),
    contextoHumano: validarContextoHumano(payload.contextoHumano)
  };
}

function validarAlerta(payload) {
  exigirClaves(payload, comunes([
    'alertaAuditoriaId', 'cerradaEnUtc', 'codigoUltimoResultado',
    'contextoHumano', 'contadorRepeticiones', 'descarteOrigen', 'estadoAlerta',
    'estadoDetectado', 'mensajeUltimoResultado', 'monitorOrigenId',
    'payloadAlerta', 'tipoMonitor', 'ultimaConfirmacionUtc',
    'ultimaEjecucionUtc', 'validoDesdeUtc', 'versionCatalogo',
    'vigenteHastaOrigenUtc'
  ]));
  if (!ESTADOS_ALERTA.has(payload.estadoAlerta)) {
    fallar('estado_alerta_monitor_invalido', 'La alerta debe estar activa o cerrada.');
  }
  const validoDesdeUtc = fecha(payload.validoDesdeUtc, 'validoDesdeUtc');
  const ultimaConfirmacionUtc = fecha(payload.ultimaConfirmacionUtc, 'ultimaConfirmacionUtc');
  const ultimaEjecucionUtc = fecha(payload.ultimaEjecucionUtc, 'ultimaEjecucionUtc');
  const cerradaEnUtc = fechaOpcional(payload.cerradaEnUtc, 'cerradaEnUtc');
  const vigenteHastaOrigenUtc = fecha(payload.vigenteHastaOrigenUtc, 'vigenteHastaOrigenUtc');
  if (ultimaConfirmacionUtc < validoDesdeUtc || ultimaEjecucionUtc < validoDesdeUtc) {
    fallar('cronologia_alerta_monitor_invalida', 'La alerta confirma ejecuciones posteriores a su apertura.');
  }
  if (vigenteHastaOrigenUtc < ultimaConfirmacionUtc || vigenteHastaOrigenUtc < ultimaEjecucionUtc) {
    fallar('vigencia_alerta_monitor_invalida', 'La vigencia no puede preceder al último estado de la alerta.');
  }
  if (payload.estadoAlerta === 'activa' && cerradaEnUtc !== null) {
    fallar('alerta_monitor_activa_con_cierre', 'Una alerta activa no puede declarar cierre.');
  }
  if (payload.estadoAlerta === 'cerrada' && (cerradaEnUtc === null || cerradaEnUtc < ultimaConfirmacionUtc)) {
    fallar('cierre_alerta_monitor_invalido', 'Una alerta cerrada necesita un cierre posterior a su última confirmación.');
  }
  return {
    monitorOrigenId: idElemento(payload.monitorOrigenId, 'monitorOrigenId'),
    alertaAuditoriaId: uuidV7(payload.alertaAuditoriaId, 'alertaAuditoriaId'),
    versionCatalogo: textoAscii(payload.versionCatalogo, 40, 'versionCatalogo'),
    tipoMonitor: textoAscii(payload.tipoMonitor, 40, 'tipoMonitor'),
    estadoAlerta: payload.estadoAlerta,
    estadoDetectado: textoAscii(payload.estadoDetectado, 40, 'estadoDetectado'),
    codigoUltimoResultado: textoAscii(payload.codigoUltimoResultado, 80, 'codigoUltimoResultado'),
    mensajeUltimoResultado: texto(payload.mensajeUltimoResultado, 500, 'mensajeUltimoResultado'),
    validoDesdeUtc,
    ultimaConfirmacionUtc,
    ultimaEjecucionUtc,
    cerradaEnUtc,
    vigenteHastaOrigenUtc,
    contadorRepeticiones: entero(payload.contadorRepeticiones, 1, 4_294_967_295, 'contadorRepeticiones'),
    payloadAlerta: jsonObjetoOpcional(payload.payloadAlerta, 'payloadAlerta'),
    descarteOrigen: validarDescarteOrigen(payload.descarteOrigen),
    contextoHumano: validarContextoHumano(payload.contextoHumano)
  };
}

function validarReferenciaTrigger(payload) {
  exigirClaves(payload, comunes([
    'activo', 'configuracionOverride', 'eventosDisparo', 'monitorOrigenId', 'ordenEjecucion',
    'triggerOrigenId', 'visibilidad'
  ]));
  if (!VISIBILIDADES_REFERENCIA.has(payload.visibilidad)) {
    fallar('visibilidad_trigger_monitor_invalida', 'La referencia al trigger debe ser visible u opaca.');
  }
  if (!Array.isArray(payload.eventosDisparo)) {
    fallar('eventos_trigger_monitor_invalidos', 'Los eventos de disparo deben ser una lista.');
  }
  const eventosDisparo = payload.eventosDisparo.map((evento, indice) =>
    textoAscii(evento, 40, `eventosDisparo.${indice}`)
  );
  if (new Set(eventosDisparo).size !== eventosDisparo.length) {
    fallar('eventos_trigger_monitor_duplicados', 'La referencia al trigger repite eventos de disparo.');
  }
  return {
    monitorOrigenId: idElemento(payload.monitorOrigenId, 'monitorOrigenId'),
    triggerOrigenId: idElemento(payload.triggerOrigenId, 'triggerOrigenId'),
    visibilidad: payload.visibilidad,
    activo: booleano(payload.activo, 'activo'),
    ordenEjecucion: entero(payload.ordenEjecucion, 0, 65535, 'ordenEjecucion'),
    eventosDisparo,
    configuracionOverride: jsonObjetoOpcional(
      payload.configuracionOverride,
      'configuracionOverride'
    )
  };
}

function validarRangoHistorico(payload) {
  exigirClaves(payload, comunes(['causa', 'desdeUtc', 'hastaUtc', 'monitorOrigenId']));
  const desdeUtc = fecha(payload.desdeUtc, 'desdeUtc');
  const hastaUtc = fecha(payload.hastaUtc, 'hastaUtc');
  if (hastaUtc <= desdeUtc) {
    fallar('rango_historico_monitor_invalido', 'El final del rango debe ser posterior a su inicio.');
  }
  if (!CAUSAS_RANGO.has(payload.causa)) {
    fallar('causa_rango_monitor_invalida', 'La causa del rango no disponible es desconocida.');
  }
  return {
    monitorOrigenId: idElemento(payload.monitorOrigenId, 'monitorOrigenId'),
    desdeUtc,
    hastaUtc,
    causa: payload.causa
  };
}

function validarContextoHumano(valor) {
  exigirClaves(valor, ['descripcionFallo', 'posibleSolucion']);
  return {
    descripcionFallo: textoVacio(valor.descripcionFallo, 512, 'contextoHumano.descripcionFallo'),
    posibleSolucion: textoVacio(valor.posibleSolucion, 512, 'contextoHumano.posibleSolucion')
  };
}

function validarScopeOrganizativo(valor) {
  exigirClaves(valor, ['empresaElementoOrigenId', 'sitioElementoOrigenId', 'tenantElementoOrigenId']);
  return {
    tenantElementoOrigenId: idElemento(valor.tenantElementoOrigenId, 'scopeOrganizativo.tenantElementoOrigenId'),
    empresaElementoOrigenId: idElemento(valor.empresaElementoOrigenId, 'scopeOrganizativo.empresaElementoOrigenId'),
    sitioElementoOrigenId: idElementoOpcional(valor.sitioElementoOrigenId, 'scopeOrganizativo.sitioElementoOrigenId')
  };
}

function validarCredencial(valor) {
  exigirClavesSegunEstadoCredencial(valor);
  if (valor.estado === 'omitida') {
    if (!CAUSAS_CREDENCIAL_OMITIDA.has(valor.causa)) {
      fallar('causa_credencial_monitor_invalida', 'La omisión de credencial no declara una causa válida.');
    }
    return { estado: 'omitida', causa: valor.causa };
  }
  if (valor.estado !== 'presente') {
    fallar('estado_credencial_monitor_invalido', 'La credencial debe estar presente u omitida.');
  }
  return {
    estado: 'presente',
    formato: textoAscii(valor.formato, 64, 'credencialPropia.formato'),
    contenido: jsonObjeto(valor.contenido, 'credencialPropia.contenido')
  };
}

function exigirClavesSegunEstadoCredencial(valor) {
  if (!objeto(valor)) fallar('credencial_monitor_invalida', 'La credencial debe ser una declaración.');
  if (valor.estado === 'omitida') exigirClaves(valor, ['causa', 'estado']);
  else exigirClaves(valor, ['contenido', 'estado', 'formato']);
}

function validarReferenciaOperativa(valor, indice) {
  exigirClaves(valor, ['elementoOrigenId', 'familia', 'metadatos', 'rol', 'visibilidad']);
  if (!['monitores', 'telemetria'].includes(valor.familia)) {
    fallar('familia_referencia_monitor_invalida', 'La entrada del monitor refiere una familia no soportada.');
  }
  if (!VISIBILIDADES_REFERENCIA.has(valor.visibilidad)) {
    fallar('visibilidad_referencia_monitor_invalida', 'La entrada debe ser visible u opaca.');
  }
  return {
    familia: valor.familia,
    elementoOrigenId: idElemento(valor.elementoOrigenId, `referenciasOperativas.${indice}.elementoOrigenId`),
    rol: textoAscii(valor.rol, 64, `referenciasOperativas.${indice}.rol`),
    visibilidad: valor.visibilidad,
    metadatos: jsonObjetoOpcional(valor.metadatos, `referenciasOperativas.${indice}.metadatos`)
  };
}

function validarDescarteOrigen(valor) {
  exigirClaves(valor, ['actorReferencia', 'descartada', 'descartadaEnUtc', 'descartadaHastaUtc', 'motivo']);
  const descartada = booleano(valor.descartada, 'descarteOrigen.descartada');
  const descartadaEnUtc = fechaOpcional(valor.descartadaEnUtc, 'descarteOrigen.descartadaEnUtc');
  const descartadaHastaUtc = fechaOpcional(valor.descartadaHastaUtc, 'descarteOrigen.descartadaHastaUtc');
  if (!descartada && (descartadaEnUtc !== null || descartadaHastaUtc !== null || valor.motivo !== '')) {
    fallar('descarte_origen_monitor_incoherente', 'Una alerta no descartada no declara datos de descarte.');
  }
  if (descartada && descartadaEnUtc === null) {
    fallar('descarte_origen_monitor_sin_fecha', 'Un descarte de origen debe indicar cuándo ocurrió.');
  }
  if (descartadaHastaUtc !== null && descartadaHastaUtc < descartadaEnUtc) {
    fallar('vigencia_descarte_origen_invalida', 'El descarte no puede vencer antes de comenzar.');
  }
  const actorReferencia = validarActorReferencia(valor.actorReferencia);
  if (!descartada && actorReferencia.estado !== 'omitida') {
    fallar('actor_descarte_origen_incoherente', 'Una alerta no descartada no declara actor de descarte.');
  }
  return {
    descartada,
    motivo: textoVacio(valor.motivo, 512, 'descarteOrigen.motivo'),
    descartadaEnUtc,
    descartadaHastaUtc,
    actorReferencia
  };
}

function exigirReferenciasOperativasUnicas(referencias) {
  const claves = referencias.map(({ familia, elementoOrigenId, rol }) =>
    `${familia}\u0000${elementoOrigenId}\u0000${rol}`
  );
  if (new Set(claves).size !== claves.length) {
    fallar('referencia_operativa_monitor_duplicada', 'La definición repite una referencia operativa.');
  }
}

function validarActorReferencia(valor) {
  if (!objeto(valor)) fallar('actor_alerta_monitor_invalido', 'La referencia de actor debe ser explícita.');
  if (valor.estado === 'omitida') {
    exigirClaves(valor, ['estado']);
    return { estado: 'omitida' };
  }
  exigirClaves(valor, ['elementoOrigenId', 'estado']);
  if (!['opaca', 'visible'].includes(valor.estado)) {
    fallar('visibilidad_actor_alerta_invalida', 'El actor debe ser visible, opaco u omitido.');
  }
  return {
    estado: valor.estado,
    elementoOrigenId: idElemento(valor.elementoOrigenId, 'descarteOrigen.actorReferencia.elementoOrigenId')
  };
}

function exigirConfiguracionSinCredenciales(valor, ruta = 'configuracionOperativa') {
  for (const [clave, contenido] of Object.entries(valor)) {
    if (CLAVES_SENSIBLES.test(clave)) {
      fallar('credencial_monitor_en_configuracion', `La credencial ${ruta}.${clave} debe viajar por su declaración sensible.`);
    }
    if (CLAVES_IDENTIDAD_LOCAL.test(clave)) {
      fallar('identidad_local_monitor_en_configuracion', `La identidad local ${ruta}.${clave} debe convertirse en referencia de origen.`);
    }
    if (objeto(contenido)) exigirConfiguracionSinCredenciales(contenido, `${ruta}.${clave}`);
    if (Array.isArray(contenido)) {
      contenido.forEach((entrada, indice) => {
        if (objeto(entrada)) exigirConfiguracionSinCredenciales(entrada, `${ruta}.${clave}.${indice}`);
      });
    }
  }
}

function idElemento(valor, campo) {
  try {
    return String(crearIdentidadFederada({ tipo: TIPOS_IDENTIDAD_FEDERADA.ELEMENTO_ORIGEN, valor: String(valor || '') }));
  } catch {
    fallar('identidad_monitor_invalida', `${campo} no es una identidad federada válida.`, campo);
  }
}

function idElementoOpcional(valor, campo) {
  return valor === null || valor === undefined ? null : idElemento(valor, campo);
}

function uuidV7(valor, campo) {
  const texto = String(valor || '').toLowerCase();
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u.test(texto)) {
    fallar('uuidv7_monitor_invalido', `${campo} debe ser un UUIDv7.`, campo);
  }
  return texto;
}

function fecha(valor, campo) {
  const texto = String(valor || '');
  if (!esFechaUtcCanonicaFederacion(texto)) {
    fallar('fecha_monitor_invalida', `${campo} debe ser UTC con milisegundos.`, campo);
  }
  return texto;
}

function fechaOpcional(valor, campo) {
  return valor === null || valor === undefined ? null : fecha(valor, campo);
}

function texto(valor, maximo, campo) {
  const contenido = String(valor ?? '').trim();
  if (!contenido || contenido.length > maximo) fallar('texto_monitor_invalido', `${campo} no es válido.`, campo);
  return contenido;
}

function textoVacio(valor, maximo, campo) {
  const contenido = String(valor ?? '').trim();
  if (contenido.length > maximo) fallar('texto_monitor_invalido', `${campo} supera su límite.`, campo);
  return contenido;
}

function textoOpcional(valor, maximo, campo) {
  return valor === null || valor === undefined ? null : textoVacio(valor, maximo, campo);
}

function textoAscii(valor, maximo, campo) {
  const contenido = texto(valor, maximo, campo);
  if (!/^[\x20-\x7e]+$/u.test(contenido)) fallar('texto_ascii_monitor_invalido', `${campo} debe ser ASCII.`, campo);
  return contenido;
}

function entero(valor, minimo, maximo, campo) {
  const numero = Number(valor);
  if (!Number.isSafeInteger(numero) || numero < minimo || numero > maximo) {
    fallar('entero_monitor_invalido', `${campo} está fuera de rango.`, campo);
  }
  return numero;
}

function booleano(valor, campo) {
  if (typeof valor !== 'boolean') fallar('booleano_monitor_invalido', `${campo} debe ser booleano.`, campo);
  return valor;
}

function jsonObjeto(valor, campo) {
  if (!objeto(valor)) fallar('json_monitor_invalido', `${campo} debe ser un objeto JSON.`, campo);
  return valor;
}

function jsonObjetoOpcional(valor, campo) {
  return valor === null ? null : jsonObjeto(valor, campo);
}

function exigirClaves(valor, esperadas) {
  if (!objeto(valor)) fallar('forma_payload_monitor_invalida', 'El payload contiene un objeto inválido.');
  const actuales = Object.keys(valor).sort();
  const objetivo = [...esperadas].sort();
  if (actuales.length !== objetivo.length || actuales.some((clave, indice) => clave !== objetivo[indice])) {
    fallar('forma_payload_monitor_invalida', 'El payload contiene campos ausentes o desconocidos.');
  }
}

function comunes(campos) { return ['perfil', 'tipoRegistro', 'version', ...campos]; }
function objeto(valor) { return Boolean(valor) && typeof valor === 'object' && !Array.isArray(valor); }

function fallar(codigo, mensaje, campo = null) {
  throw new ErrorPayloadMonitoresFederacion(codigo, mensaje, { campo });
}

import {
  VERSION_NORMALIZACION_BUZON_CORREO,
  exigirBuzonCanonicoCorreo
} from './NormalizadorBuzonCorreo.js';
import {
  CLASIFICACIONES_INTENTO_SMTP_CORREO,
  ESTADOS_INTENTO_SMTP_CORREO,
  ESTADOS_SALIDA_CORREO,
  estadoSalidaDesdeIntentoSmtpCorreo
} from './ContratoSalidaCorreo.js';

export const PERFIL_CONTRATO_TRIGGER_CORREO =
  'sentinelia-trigger-correo-v1';
export const VERSION_CONTRATO_TRIGGER_CORREO = 1;
export const PERFIL_FOTOGRAFIA_CAUSAL_TRIGGER_CORREO =
  'sentinelia-trigger-correo-causa-v1';
export const PERFIL_MENSAJE_MATERIALIZADO_TRIGGER_CORREO =
  'sentinelia-trigger-correo-render-v1';
export const PERFIL_RESULTADO_DESTINATARIO_TRIGGER_CORREO =
  'sentinelia-trigger-correo-destinatario-v1';
export const PERFIL_INTENCION_TRIGGER_CORREO =
  'sentinelia-trigger-correo-intencion-v1';
export const PERFIL_RESULTADO_ACEPTACION_TRIGGER_CORREO =
  'sentinelia-trigger-correo-aceptacion-v1';
export const PERFIL_SALIDA_TRIGGER_CORREO =
  'sentinelia-correo-salida-trigger-v1';
export const PERFIL_INTENTO_SMTP_TRIGGER_CORREO =
  'sentinelia-correo-intento-smtp-v1';
export const PERFIL_CAPACIDAD_DESUSCRIPCION_TRIGGER_CORREO =
  'sentinelia-correo-desuscripcion-v1';
export const PERFIL_MATERIAL_HMAC_CORREO =
  'sentinelia-correo-hmac-v1';

export const VERSION_RENDERIZADOR_TRIGGER_CORREO = 'correo@1';
export const VERSION_NORMALIZACION_BUZON_TRIGGER_CORREO =
  VERSION_NORMALIZACION_BUZON_CORREO;
export const VERSION_PRUEBA_SMTP_TRIGGER_CORREO = 'smtp@1';
export const ESTRATEGIA_EJECUCION_TRIGGER_CORREO =
  'aceptacion_sql_atomica';

export const LIMITES_CONTRATO_TRIGGER_CORREO = Object.freeze({
  ASUNTO_CARACTERES: 255,
  TEXTO_CONFIGURABLE_CARACTERES: 2000,
  CONTEXTO_HUMANO_CARACTERES: 512,
  NOMBRE_MONITOR_CARACTERES: 160,
  TIPO_MONITOR_CARACTERES: 40,
  CODIGO_RESULTADO_CARACTERES: 120,
  MENSAJE_RESULTADO_CARACTERES: 512,
  CUERPO_UTF8_BYTES: 60 * 1024,
  BUZON_UTF8_BYTES: 190,
  RELACIONES_DESTINATARIAS_MAXIMAS: 1000,
  RESPUESTA_SMTP_UTF8_BYTES: 2000,
  TTL_DESUSCRIPCION_DIAS_MINIMO: 1,
  TTL_DESUSCRIPCION_DIAS_MAXIMO: 3650
});

export const TOKENS_ASUNTO_TRIGGER_CORREO = Object.freeze([
  'portal',
  'transicion',
  'monitor',
  'estado'
]);

export const EVENTOS_DISPARO_TRIGGER_CORREO = Object.freeze({
  APERTURA_ALERTA: 'apertura_alerta',
  CIERRE_ALERTA: 'cierre_alerta'
});

export const ORIGENES_CAUSALES_TRIGGER_CORREO = Object.freeze({
  DIRECTO: 'directo',
  TELEMETRIA: 'telemetria',
  LOGICO: 'logico',
  OTRO: 'otro'
});

export const TIPOS_DESTINATARIO_TRIGGER_CORREO = Object.freeze({
  MANUAL: 'manual',
  USUARIO: 'usuario'
});

export const ESTADOS_PARTICIPACION_DESTINATARIO_TRIGGER_CORREO = Object.freeze({
  ACTIVA: 'activa',
  DESUSCRITA: 'desuscrita'
});

export const CODIGOS_RESULTADO_DESTINATARIO_TRIGGER_CORREO = Object.freeze({
  ACEPTADO: 'aceptado',
  USUARIO_INACTIVO: 'usuario_inactivo',
  EMAIL_AUSENTE: 'email_ausente',
  EMAIL_NO_VALIDADO: 'email_no_validado',
  EMAIL_INVALIDO: 'email_invalido'
});

export const CODIGOS_RESULTADO_ACEPTACION_TRIGGER_CORREO = Object.freeze({
  ACEPTADA_COMPLETA: 'correo_notificacion_aceptada_completa',
  ACEPTADA_PARCIAL: 'correo_notificacion_aceptada_parcial',
  CANAL_NO_OPERATIVO: 'correo_canal_no_operativo',
  ORIGEN_PUBLICO_NO_DISPONIBLE: 'correo_origen_publico_no_disponible',
  DECLARACION_INVALIDA: 'correo_declaracion_invalida',
  CONTEXTO_NO_RENDERIZABLE: 'correo_contexto_no_renderizable',
  SIN_DESTINATARIOS_ADMITIDOS: 'correo_sin_destinatarios_admitidos'
});

export const ESTADOS_SALIDA_TRIGGER_CORREO = Object.freeze({
  PENDIENTE: ESTADOS_SALIDA_CORREO.PENDIENTE,
  RECLAMADA: ESTADOS_SALIDA_CORREO.RECLAMADA,
  ENVIANDO: ESTADOS_SALIDA_CORREO.ENVIANDO,
  ERROR_REINTENTABLE: ESTADOS_SALIDA_CORREO.ERROR_REINTENTABLE,
  ENVIADO: ESTADOS_SALIDA_CORREO.ENVIADO,
  ERROR_FINAL: ESTADOS_SALIDA_CORREO.ERROR_FINAL,
  RESULTADO_AMBIGUO: ESTADOS_SALIDA_CORREO.RESULTADO_AMBIGUO
});

export const ESTADOS_TERMINALES_SALIDA_TRIGGER_CORREO = Object.freeze([
  ESTADOS_SALIDA_TRIGGER_CORREO.ENVIADO,
  ESTADOS_SALIDA_TRIGGER_CORREO.ERROR_FINAL,
  ESTADOS_SALIDA_TRIGGER_CORREO.RESULTADO_AMBIGUO
]);

export const ESTADOS_INTENTO_SMTP_TRIGGER_CORREO = ESTADOS_INTENTO_SMTP_CORREO;

export const CLASIFICACIONES_INTENTO_SMTP_TRIGGER_CORREO =
  CLASIFICACIONES_INTENTO_SMTP_CORREO;

export const ESTADOS_CAPACIDAD_DESUSCRIPCION_TRIGGER_CORREO = Object.freeze({
  PREPARADA: 'preparada',
  EMITIDA: 'emitida'
});

export const TIPOS_VALOR_HMAC_CORREO = Object.freeze({
  BOOLEANO: 'booleano',
  ENTERO: 'entero',
  TEXTO: 'texto',
  NULO: 'nulo'
});

export const ORDENES_BLOQUEO_TRIGGER_CORREO = congelarProfundo({
  admision: [
    'configuracion_portal',
    'estado_verificacion_correo',
    'cabecera_configuracion_portal',
    'estado_despliegue_trigger_correo',
    'usuarios',
    'triggers',
    'asignaciones_triggers_monitores',
    'destinatarios_triggers_correo'
  ],
  desuscripcion: [
    'triggers',
    'capacidades_desuscripcion_correo',
    'destinatarios_triggers_correo'
  ],
  retencion: [
    'ejecuciones_triggers',
    'notificaciones_triggers_correo',
    'resultados_destinatarios_triggers_correo',
    'cola_correos_salida',
    'capacidades_desuscripcion_correo',
    'intentos_correos_salida'
  ]
});

export const PROPIEDADES_CONTRATO_TRIGGER_CORREO = congelarProfundo({
  DEFINICION_MENSAJE: [
    'version', 'asuntoPlantilla', 'textoIntroduccion', 'textoCierre'
  ],
  FOTOGRAFIA_CAUSAL: [
    'perfil', 'version', 'ejecucionTriggerId', 'claveIdempotencia', 'triggerId',
    'asignacionId', 'monitorId', 'alertaAuditoriaId', 'eventoDisparo',
    'fechaOcurrenciaUtc', 'validoDesdeUtc', 'nombreMonitor', 'tipoMonitor',
    'estadoMonitor', 'origenCausal', 'codigoResultado', 'mensajeResultado',
    'contextoHumano', 'scopeTrigger', 'scopeMonitor', 'referencias'
  ],
  CONTEXTO_HUMANO: ['descripcionFallo', 'posibleSolucion'],
  SCOPE: ['nivel', 'tenantId', 'empresaId', 'sitioId'],
  REFERENCIAS: ['estadoUrl', 'historicoUrl'],
  MENSAJE_MATERIALIZADO: [
    'perfil', 'version', 'asunto', 'cuerpoBaseTexto', 'origenPublico',
    'renderizadoEnUtc'
  ],
  RESULTADO_DESTINATARIO: [
    'perfil', 'version', 'claveProcedencia', 'relacionDestinatarioId', 'tipo',
    'usuarioId', 'emailManualPresentacion', 'emailManualCanonico',
    'normalizacionBuzonVersion', 'estadoObservado', 'emailResueltoCanonico',
    'claveBuzonSha256', 'codigoInicial', 'salidaId'
  ],
  SALIDA: [
    'perfil', 'version', 'salidaId', 'notificacionId', 'ejecucionTriggerId',
    'buzonCanonico', 'normalizacionBuzonVersion', 'claveBuzonSha256',
    'smtpMessageId', 'asunto', 'cuerpoPrivadoTexto', 'estado', 'intentos',
    'creadaEnUtc'
  ],
  INTENCION: [
    'perfil', 'version', 'notificacionId', 'ejecucionTriggerId',
    'claveIdempotencia', 'definicionMensaje', 'fotografiaCausal',
    'mensajeMaterializado', 'resultadosDestinatarios', 'salidas', 'capacidades',
    'aceptadaEnUtc'
  ],
  RESULTADO_ACEPTACION: [
    'perfil', 'version', 'ejecucionTriggerId', 'estadoEjecucion',
    'codigoResultado', 'notificacionAceptada', 'resultadosDestinatarios',
    'finalizadoEnUtc'
  ],
  TRANSICION_SALIDA: ['estadoAnterior', 'estadoNuevo', 'estadoPrevioReclamacion'],
  INTENTO_SMTP: [
    'perfil', 'version', 'intentoId', 'salidaId', 'numero',
    'versionConfiguracion', 'smtpMessageId', 'estado', 'iniciadoEnUtc',
    'finalizadoEnUtc', 'clasificacion', 'codigo', 'respuestaSaneada'
  ],
  CAPACIDAD: [
    'perfil', 'version', 'salidaId', 'triggerId', 'tokenHashSha256',
    'ttlDias', 'estado', 'emitidaEnUtc', 'expiraEnUtc'
  ],
  MATERIAL_HMAC: ['perfil', 'version', 'perfilSmtp', 'perfilBuzon', 'entradas'],
  ENTRADA_HMAC: ['clave', 'tipo', 'valor']
});

const VERSION_PERFIL = 1;
const EVENTOS = new Set(Object.values(EVENTOS_DISPARO_TRIGGER_CORREO));
const ORIGENES = new Set(Object.values(ORIGENES_CAUSALES_TRIGGER_CORREO));
const TIPOS_DESTINATARIO = new Set(Object.values(TIPOS_DESTINATARIO_TRIGGER_CORREO));
const CODIGOS_DESTINATARIO = new Set(
  Object.values(CODIGOS_RESULTADO_DESTINATARIO_TRIGGER_CORREO)
);
const CODIGOS_ACEPTACION = new Set(
  Object.values(CODIGOS_RESULTADO_ACEPTACION_TRIGGER_CORREO)
);
const ESTADOS_SALIDA = new Set(Object.values(ESTADOS_SALIDA_TRIGGER_CORREO));
const TERMINALES_SALIDA = new Set(ESTADOS_TERMINALES_SALIDA_TRIGGER_CORREO);
const ESTADOS_INTENTO = new Set(Object.values(ESTADOS_INTENTO_SMTP_TRIGGER_CORREO));
const TIPOS_HMAC = new Set(Object.values(TIPOS_VALOR_HMAC_CORREO));
const TOKENS_ASUNTO = new Set(TOKENS_ASUNTO_TRIGGER_CORREO);
const PATRON_HASH_SHA256 = /^[0-9a-f]{64}$/u;
const PATRON_ID_DECIMAL = /^[1-9][0-9]*$/u;
const PATRON_FECHA_UTC =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u;
const PATRON_UUID_V7 =
  /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const PATRON_CODIGO = /^[a-z][a-z0-9_]{0,119}$/u;
const PATRON_CLAVE_HMAC = /^[a-z][a-z0-9_.-]{0,159}$/u;
const PATRON_MESSAGE_ID = /^<([A-Za-z0-9_-]{22,128})@([a-z0-9.-]{1,253})>$/u;

export class ErrorContratoTriggerCorreo extends Error {
  constructor(
    mensaje,
    { codigo = 'contrato_trigger_correo_invalido', campo = null } = {}
  ) {
    super(mensaje);
    this.name = 'ErrorContratoTriggerCorreo';
    this.codigo = codigo;
    this.campo = campo;
  }
}

export function crearDefinicionMensajeTriggerCorreo(entrada) {
  validarClavesExactas(entrada, propiedades('DEFINICION_MENSAJE'), 'definicionMensaje');
  if (entrada.version !== VERSION_PERFIL) {
    fallar(
      'La versión de la definición reusable no pertenece al contrato.',
      'version_contrato_trigger_correo_incompatible',
      'definicionMensaje.version'
    );
  }
  const asuntoPlantilla = textoCabecera(
    entrada.asuntoPlantilla,
    LIMITES_CONTRATO_TRIGGER_CORREO.ASUNTO_CARACTERES,
    'definicionMensaje.asuntoPlantilla'
  );
  validarTokensAsunto(asuntoPlantilla);
  return congelarProfundo({
    version: entrada.version,
    asuntoPlantilla,
    textoIntroduccion: textoCuerpoOpcional(
      entrada.textoIntroduccion,
      LIMITES_CONTRATO_TRIGGER_CORREO.TEXTO_CONFIGURABLE_CARACTERES,
      'definicionMensaje.textoIntroduccion'
    ),
    textoCierre: textoCuerpoOpcional(
      entrada.textoCierre,
      LIMITES_CONTRATO_TRIGGER_CORREO.TEXTO_CONFIGURABLE_CARACTERES,
      'definicionMensaje.textoCierre'
    )
  });
}

export function crearFotografiaCausalTriggerCorreo(entrada) {
  validarClavesExactas(entrada, propiedades('FOTOGRAFIA_CAUSAL'), 'fotografiaCausal');
  exigirPerfil(
    entrada,
    PERFIL_FOTOGRAFIA_CAUSAL_TRIGGER_CORREO,
    'fotografiaCausal'
  );
  if (!EVENTOS.has(entrada.eventoDisparo)) {
    fallar(
      'Solo apertura y cierre pertenecen al contrato de correo.',
      'evento_trigger_correo_invalido',
      'fotografiaCausal.eventoDisparo'
    );
  }
  const fechaOcurrenciaUtc = fechaUtc(
    entrada.fechaOcurrenciaUtc,
    'fotografiaCausal.fechaOcurrenciaUtc'
  );
  const validoDesdeUtc = fechaUtc(
    entrada.validoDesdeUtc,
    'fotografiaCausal.validoDesdeUtc'
  );
  if (Date.parse(fechaOcurrenciaUtc) < Date.parse(validoDesdeUtc)) {
    fallar(
      'La transición no puede preceder al inicio del ciclo de alerta.',
      'cronologia_causal_trigger_correo_invalida',
      'fotografiaCausal.fechaOcurrenciaUtc'
    );
  }
  const estadoEsperado = entrada.eventoDisparo ===
    EVENTOS_DISPARO_TRIGGER_CORREO.APERTURA_ALERTA
    ? 'indisponible'
    : 'disponible';
  if (entrada.estadoMonitor !== estadoEsperado) {
    fallar(
      'El estado fotografiado no corresponde a la transición.',
      'estado_causal_trigger_correo_invalido',
      'fotografiaCausal.estadoMonitor'
    );
  }
  if (!ORIGENES.has(entrada.origenCausal)) {
    fallar(
      'El origen causal no pertenece al vocabulario cerrado.',
      'origen_causal_trigger_correo_invalido',
      'fotografiaCausal.origenCausal'
    );
  }
  return congelarProfundo({
    perfil: entrada.perfil,
    version: entrada.version,
    ejecucionTriggerId: idDecimal(
      entrada.ejecucionTriggerId,
      'fotografiaCausal.ejecucionTriggerId'
    ),
    claveIdempotencia: hashSha256(
      entrada.claveIdempotencia,
      'fotografiaCausal.claveIdempotencia'
    ),
    triggerId: idDecimal(entrada.triggerId, 'fotografiaCausal.triggerId'),
    asignacionId: idDecimal(entrada.asignacionId, 'fotografiaCausal.asignacionId'),
    monitorId: idDecimal(entrada.monitorId, 'fotografiaCausal.monitorId'),
    alertaAuditoriaId: uuidV7(
      entrada.alertaAuditoriaId,
      'fotografiaCausal.alertaAuditoriaId'
    ),
    eventoDisparo: entrada.eventoDisparo,
    fechaOcurrenciaUtc,
    validoDesdeUtc,
    nombreMonitor: textoVisible(
      entrada.nombreMonitor,
      LIMITES_CONTRATO_TRIGGER_CORREO.NOMBRE_MONITOR_CARACTERES,
      'fotografiaCausal.nombreMonitor'
    ),
    tipoMonitor: textoAscii(
      entrada.tipoMonitor,
      LIMITES_CONTRATO_TRIGGER_CORREO.TIPO_MONITOR_CARACTERES,
      'fotografiaCausal.tipoMonitor'
    ),
    estadoMonitor: entrada.estadoMonitor,
    origenCausal: entrada.origenCausal,
    codigoResultado: codigoOpcional(
      entrada.codigoResultado,
      'fotografiaCausal.codigoResultado'
    ),
    mensajeResultado: textoVisibleOpcional(
      entrada.mensajeResultado,
      LIMITES_CONTRATO_TRIGGER_CORREO.MENSAJE_RESULTADO_CARACTERES,
      'fotografiaCausal.mensajeResultado'
    ),
    contextoHumano: normalizarContextoHumano(entrada.contextoHumano),
    scopeTrigger: normalizarScope(entrada.scopeTrigger, 'fotografiaCausal.scopeTrigger'),
    scopeMonitor: normalizarScope(entrada.scopeMonitor, 'fotografiaCausal.scopeMonitor'),
    referencias: normalizarReferencias(entrada.referencias)
  });
}

export function crearMensajeMaterializadoTriggerCorreo(entrada) {
  validarClavesExactas(
    entrada,
    propiedades('MENSAJE_MATERIALIZADO'),
    'mensajeMaterializado'
  );
  exigirPerfil(
    entrada,
    PERFIL_MENSAJE_MATERIALIZADO_TRIGGER_CORREO,
    'mensajeMaterializado'
  );
  if (entrada.version !== VERSION_PERFIL) {
    fallar(
      'La versión del renderizador no pertenece al contrato.',
      'version_contrato_trigger_correo_incompatible',
      'mensajeMaterializado.version'
    );
  }
  return congelarProfundo({
    perfil: entrada.perfil,
    version: entrada.version,
    asunto: textoCabecera(
      entrada.asunto,
      LIMITES_CONTRATO_TRIGGER_CORREO.ASUNTO_CARACTERES,
      'mensajeMaterializado.asunto'
    ),
    cuerpoBaseTexto: textoCuerpoLimitado(
      entrada.cuerpoBaseTexto,
      LIMITES_CONTRATO_TRIGGER_CORREO.CUERPO_UTF8_BYTES,
      'mensajeMaterializado.cuerpoBaseTexto'
    ),
    origenPublico: origenHttps(entrada.origenPublico, 'mensajeMaterializado.origenPublico'),
    renderizadoEnUtc: fechaUtc(
      entrada.renderizadoEnUtc,
      'mensajeMaterializado.renderizadoEnUtc'
    )
  });
}

export function crearResultadoDestinatarioTriggerCorreo(entrada) {
  validarClavesExactas(
    entrada,
    propiedades('RESULTADO_DESTINATARIO'),
    'resultadoDestinatario'
  );
  exigirPerfil(
    entrada,
    PERFIL_RESULTADO_DESTINATARIO_TRIGGER_CORREO,
    'resultadoDestinatario'
  );
  if (!TIPOS_DESTINATARIO.has(entrada.tipo)) {
    fallar(
      'El destinatario debe ser manual o usuario.',
      'tipo_destinatario_trigger_correo_invalido',
      'resultadoDestinatario.tipo'
    );
  }
  if (entrada.estadoObservado !==
      ESTADOS_PARTICIPACION_DESTINATARIO_TRIGGER_CORREO.ACTIVA) {
    fallar(
      'Solo la audiencia efectiva produce resultados de transición.',
      'estado_destinatario_trigger_correo_invalido',
      'resultadoDestinatario.estadoObservado'
    );
  }
  if (!CODIGOS_DESTINATARIO.has(entrada.codigoInicial)) {
    fallar(
      'El resultado inicial del destinatario no pertenece al contrato.',
      'codigo_destinatario_trigger_correo_invalido',
      'resultadoDestinatario.codigoInicial'
    );
  }
  const relacionDestinatarioId = idDecimalOpcional(
    entrada.relacionDestinatarioId,
    'resultadoDestinatario.relacionDestinatarioId'
  );
  const usuarioId = idDecimalOpcional(
    entrada.usuarioId,
    'resultadoDestinatario.usuarioId'
  );
  const emailManualPresentacion = buzonPresentacionOpcional(
    entrada.emailManualPresentacion,
    'resultadoDestinatario.emailManualPresentacion'
  );
  const emailManualCanonico = buzonCanonicoOpcional(
    entrada.emailManualCanonico,
    'resultadoDestinatario.emailManualCanonico'
  );
  const esManual = entrada.tipo === TIPOS_DESTINATARIO_TRIGGER_CORREO.MANUAL;
  if (
    esManual !== (emailManualPresentacion !== null) ||
    esManual !== (emailManualCanonico !== null) ||
    esManual === (usuarioId !== null)
  ) {
    fallar(
      'La procedencia debe identificar exactamente un email manual o un usuario.',
      'identidad_destinatario_trigger_correo_invalida',
      'resultadoDestinatario'
    );
  }
  const aceptado = entrada.codigoInicial ===
    CODIGOS_RESULTADO_DESTINATARIO_TRIGGER_CORREO.ACEPTADO;
  const emailResueltoCanonico = buzonCanonicoOpcional(
    entrada.emailResueltoCanonico,
    'resultadoDestinatario.emailResueltoCanonico'
  );
  const claveBuzonSha256 = hashSha256Opcional(
    entrada.claveBuzonSha256,
    'resultadoDestinatario.claveBuzonSha256'
  );
  const salidaId = idDecimalOpcional(
    entrada.salidaId,
    'resultadoDestinatario.salidaId'
  );
  if (
    aceptado !== (emailResueltoCanonico !== null) ||
    aceptado !== (claveBuzonSha256 !== null) ||
    aceptado !== (salidaId !== null)
  ) {
    fallar(
      'Solo un destinatario aceptado puede quedar ligado a un buzón y salida.',
      'salida_destinatario_trigger_correo_invalida',
      'resultadoDestinatario'
    );
  }
  if (esManual && aceptado && emailManualCanonico !== emailResueltoCanonico) {
    fallar(
      'La procedencia manual aceptada debe conservar el mismo buzón.',
      'buzon_destinatario_trigger_correo_incoherente',
      'resultadoDestinatario.emailResueltoCanonico'
    );
  }
  return congelarProfundo({
    perfil: entrada.perfil,
    version: entrada.version,
    claveProcedencia: hashSha256(
      entrada.claveProcedencia,
      'resultadoDestinatario.claveProcedencia'
    ),
    relacionDestinatarioId,
    tipo: entrada.tipo,
    usuarioId,
    emailManualPresentacion,
    emailManualCanonico,
    normalizacionBuzonVersion: versionBuzon(
      entrada.normalizacionBuzonVersion,
      'resultadoDestinatario.normalizacionBuzonVersion'
    ),
    estadoObservado: entrada.estadoObservado,
    emailResueltoCanonico,
    claveBuzonSha256,
    codigoInicial: entrada.codigoInicial,
    salidaId
  });
}

export function crearSalidaInicialTriggerCorreo(entrada) {
  validarClavesExactas(entrada, propiedades('SALIDA'), 'salida');
  exigirPerfil(entrada, PERFIL_SALIDA_TRIGGER_CORREO, 'salida');
  if (
    entrada.estado !== ESTADOS_SALIDA_TRIGGER_CORREO.PENDIENTE ||
    entrada.intentos !== 0
  ) {
    fallar(
      'Una salida aceptada nace pendiente y sin intentos.',
      'estado_inicial_salida_trigger_correo_invalido',
      'salida'
    );
  }
  return congelarProfundo({
    perfil: entrada.perfil,
    version: entrada.version,
    salidaId: idDecimal(entrada.salidaId, 'salida.salidaId'),
    notificacionId: idDecimal(entrada.notificacionId, 'salida.notificacionId'),
    ejecucionTriggerId: idDecimal(
      entrada.ejecucionTriggerId,
      'salida.ejecucionTriggerId'
    ),
    buzonCanonico: buzonCanonico(entrada.buzonCanonico, 'salida.buzonCanonico'),
    normalizacionBuzonVersion: versionBuzon(
      entrada.normalizacionBuzonVersion,
      'salida.normalizacionBuzonVersion'
    ),
    claveBuzonSha256: hashSha256(
      entrada.claveBuzonSha256,
      'salida.claveBuzonSha256'
    ),
    smtpMessageId: messageId(entrada.smtpMessageId, 'salida.smtpMessageId'),
    asunto: textoCabecera(
      entrada.asunto,
      LIMITES_CONTRATO_TRIGGER_CORREO.ASUNTO_CARACTERES,
      'salida.asunto'
    ),
    cuerpoPrivadoTexto: textoCuerpoLimitado(
      entrada.cuerpoPrivadoTexto,
      LIMITES_CONTRATO_TRIGGER_CORREO.CUERPO_UTF8_BYTES,
      'salida.cuerpoPrivadoTexto'
    ),
    estado: entrada.estado,
    intentos: entrada.intentos,
    creadaEnUtc: fechaUtc(entrada.creadaEnUtc, 'salida.creadaEnUtc')
  });
}

export function crearIntencionNotificacionTriggerCorreo(entrada) {
  validarClavesExactas(entrada, propiedades('INTENCION'), 'intencion');
  exigirPerfil(entrada, PERFIL_INTENCION_TRIGGER_CORREO, 'intencion');
  const notificacionId = idDecimal(entrada.notificacionId, 'intencion.notificacionId');
  const ejecucionTriggerId = idDecimal(
    entrada.ejecucionTriggerId,
    'intencion.ejecucionTriggerId'
  );
  const claveIdempotencia = hashSha256(
    entrada.claveIdempotencia,
    'intencion.claveIdempotencia'
  );
  const definicionMensaje = crearDefinicionMensajeTriggerCorreo(
    entrada.definicionMensaje
  );
  const fotografiaCausal = crearFotografiaCausalTriggerCorreo(
    entrada.fotografiaCausal
  );
  const mensajeMaterializado = crearMensajeMaterializadoTriggerCorreo(
    entrada.mensajeMaterializado
  );
  if (
    fotografiaCausal.ejecucionTriggerId !== ejecucionTriggerId ||
    fotografiaCausal.claveIdempotencia !== claveIdempotencia
  ) {
    fallar(
      'La intención y su fotografía no pertenecen a la misma ejecución.',
      'causa_intencion_trigger_correo_incoherente',
      'intencion.fotografiaCausal'
    );
  }
  const entradasResultados = lista(
    entrada.resultadosDestinatarios,
    'intencion.resultadosDestinatarios'
  );
  const entradasSalidas = lista(entrada.salidas, 'intencion.salidas');
  const entradasCapacidades = lista(
    entrada.capacidades,
    'intencion.capacidades'
  );
  exigirAudienciaAcotada(entradasResultados, 'intencion.resultadosDestinatarios');
  exigirAudienciaAcotada(entradasSalidas, 'intencion.salidas');
  exigirAudienciaAcotada(entradasCapacidades, 'intencion.capacidades');
  const resultadosDestinatarios = entradasResultados.map(
    crearResultadoDestinatarioTriggerCorreo
  );
  const salidas = entradasSalidas.map(crearSalidaInicialTriggerCorreo);
  const capacidades = entradasCapacidades.map(
    crearCapacidadDesuscripcionTriggerCorreo
  );
  if (salidas.length === 0) {
    fallar(
      'Una intención aceptada necesita al menos una salida física.',
      'intencion_trigger_correo_sin_salidas',
      'intencion.salidas'
    );
  }
  validarGrafoDestinatariosYSalidas({
    resultadosDestinatarios,
    salidas,
    notificacionId,
    ejecucionTriggerId,
    mensajeMaterializado
  });
  validarCapacidadesIntencion({
    capacidades,
    salidas,
    triggerId: fotografiaCausal.triggerId
  });
  const aceptadaEnUtc = fechaUtc(entrada.aceptadaEnUtc, 'intencion.aceptadaEnUtc');
  const renderizadoEnMs = Date.parse(mensajeMaterializado.renderizadoEnUtc);
  const aceptadaEnMs = Date.parse(aceptadaEnUtc);
  if (
    aceptadaEnMs < Date.parse(fotografiaCausal.fechaOcurrenciaUtc) ||
    aceptadaEnMs < renderizadoEnMs ||
    salidas.some((salida) => {
      const creadaEnMs = Date.parse(salida.creadaEnUtc);
      return creadaEnMs < renderizadoEnMs || creadaEnMs > aceptadaEnMs;
    })
  ) {
    fallar(
      'La intención no puede aceptarse antes de su causa o renderizado.',
      'cronologia_intencion_trigger_correo_invalida',
      'intencion.aceptadaEnUtc'
    );
  }
  return congelarProfundo({
    perfil: entrada.perfil,
    version: entrada.version,
    notificacionId,
    ejecucionTriggerId,
    claveIdempotencia,
    definicionMensaje,
    fotografiaCausal,
    mensajeMaterializado,
    resultadosDestinatarios,
    salidas,
    capacidades,
    aceptadaEnUtc
  });
}

export function crearResultadoAceptacionTriggerCorreo(entrada) {
  validarClavesExactas(
    entrada,
    propiedades('RESULTADO_ACEPTACION'),
    'resultadoAceptacion'
  );
  exigirPerfil(
    entrada,
    PERFIL_RESULTADO_ACEPTACION_TRIGGER_CORREO,
    'resultadoAceptacion'
  );
  if (!['ok', 'error'].includes(entrada.estadoEjecucion) ||
      !CODIGOS_ACEPTACION.has(entrada.codigoResultado)) {
    fallar(
      'El resultado de aceptación no pertenece al contrato cerrado.',
      'resultado_aceptacion_trigger_correo_invalido',
      'resultadoAceptacion'
    );
  }
  const ejecucionTriggerId = idDecimal(
    entrada.ejecucionTriggerId,
    'resultadoAceptacion.ejecucionTriggerId'
  );
  const aceptada = entrada.notificacionAceptada !== null;
  const codigosOk = new Set([
    CODIGOS_RESULTADO_ACEPTACION_TRIGGER_CORREO.ACEPTADA_COMPLETA,
    CODIGOS_RESULTADO_ACEPTACION_TRIGGER_CORREO.ACEPTADA_PARCIAL
  ]);
  if (
    aceptada !== (entrada.estadoEjecucion === 'ok') ||
    aceptada !== codigosOk.has(entrada.codigoResultado)
  ) {
    fallar(
      'Solo una notificación aceptada puede terminar correctamente la ejecución.',
      'resultado_aceptacion_trigger_correo_incoherente',
      'resultadoAceptacion'
    );
  }
  const notificacionAceptada = aceptada
    ? crearIntencionNotificacionTriggerCorreo(entrada.notificacionAceptada)
    : null;
  const entradasResultados = lista(
    entrada.resultadosDestinatarios,
    'resultadoAceptacion.resultadosDestinatarios'
  );
  exigirAudienciaAcotada(
    entradasResultados,
    'resultadoAceptacion.resultadosDestinatarios'
  );
  const resultadosDestinatarios = entradasResultados.map(
    crearResultadoDestinatarioTriggerCorreo
  );
  if (notificacionAceptada) {
    if (notificacionAceptada.ejecucionTriggerId !== ejecucionTriggerId) {
      fallar(
        'El resultado y la notificación pertenecen a ejecuciones distintas.',
        'resultado_aceptacion_trigger_correo_incoherente',
        'resultadoAceptacion.notificacionAceptada'
      );
    }
    exigirMismaListaResultados(
      resultadosDestinatarios,
      notificacionAceptada.resultadosDestinatarios
    );
    const parcial = resultadosDestinatarios.some((resultado) =>
      resultado.codigoInicial !== CODIGOS_RESULTADO_DESTINATARIO_TRIGGER_CORREO.ACEPTADO
    );
    const esperado = parcial
      ? CODIGOS_RESULTADO_ACEPTACION_TRIGGER_CORREO.ACEPTADA_PARCIAL
      : CODIGOS_RESULTADO_ACEPTACION_TRIGGER_CORREO.ACEPTADA_COMPLETA;
    if (entrada.codigoResultado !== esperado) {
      fallar(
        'El código agregado no refleja el resultado de la audiencia.',
        'resultado_aceptacion_trigger_correo_incoherente',
        'resultadoAceptacion.codigoResultado'
      );
    }
  } else {
    const rechazoAudiencia = entrada.codigoResultado ===
      CODIGOS_RESULTADO_ACEPTACION_TRIGGER_CORREO.SIN_DESTINATARIOS_ADMITIDOS;
    const contieneAceptado = resultadosDestinatarios.some((resultado) =>
      resultado.codigoInicial ===
        CODIGOS_RESULTADO_DESTINATARIO_TRIGGER_CORREO.ACEPTADO
    );
    if (
      (!rechazoAudiencia && resultadosDestinatarios.length > 0) ||
      (rechazoAudiencia && contieneAceptado)
    ) {
      fallar(
        'Solo el rechazo íntegro de audiencia conserva resultados individuales sin intención.',
        'resultado_aceptacion_trigger_correo_incoherente',
        'resultadoAceptacion.resultadosDestinatarios'
      );
    }
  }
  const finalizadoEnUtc = fechaUtc(
    entrada.finalizadoEnUtc,
    'resultadoAceptacion.finalizadoEnUtc'
  );
  if (notificacionAceptada &&
      Date.parse(finalizadoEnUtc) < Date.parse(notificacionAceptada.aceptadaEnUtc)) {
    fallar(
      'La ejecución no puede finalizar antes de aceptar su intención.',
      'cronologia_resultado_aceptacion_trigger_correo_invalida',
      'resultadoAceptacion.finalizadoEnUtc'
    );
  }
  return congelarProfundo({
    perfil: entrada.perfil,
    version: entrada.version,
    ejecucionTriggerId,
    estadoEjecucion: entrada.estadoEjecucion,
    codigoResultado: entrada.codigoResultado,
    notificacionAceptada,
    resultadosDestinatarios,
    finalizadoEnUtc
  });
}

export function validarTransicionSalidaTriggerCorreo(entrada) {
  validarClavesExactas(entrada, propiedades('TRANSICION_SALIDA'), 'transicionSalida');
  if (!ESTADOS_SALIDA.has(entrada.estadoAnterior) ||
      !ESTADOS_SALIDA.has(entrada.estadoNuevo)) {
    fallar(
      'La transición contiene un estado de salida desconocido.',
      'estado_salida_trigger_correo_invalido',
      'transicionSalida'
    );
  }
  if (TERMINALES_SALIDA.has(entrada.estadoAnterior)) {
    fallar(
      'Un estado terminal de salida no puede reabrirse.',
      'terminalidad_salida_trigger_correo_violada',
      'transicionSalida.estadoAnterior'
    );
  }
  const E = ESTADOS_SALIDA_TRIGGER_CORREO;
  const permitidas = new Set([
    `${E.PENDIENTE}:${E.RECLAMADA}`,
    `${E.PENDIENTE}:${E.ERROR_FINAL}`,
    `${E.ERROR_REINTENTABLE}:${E.RECLAMADA}`,
    `${E.ERROR_REINTENTABLE}:${E.ERROR_FINAL}`,
    `${E.RECLAMADA}:${E.PENDIENTE}`,
    `${E.RECLAMADA}:${E.ERROR_REINTENTABLE}`,
    `${E.RECLAMADA}:${E.ENVIANDO}`,
    `${E.ENVIANDO}:${E.ENVIADO}`,
    `${E.ENVIANDO}:${E.ERROR_REINTENTABLE}`,
    `${E.ENVIANDO}:${E.ERROR_FINAL}`,
    `${E.ENVIANDO}:${E.RESULTADO_AMBIGUO}`
  ]);
  if (!permitidas.has(`${entrada.estadoAnterior}:${entrada.estadoNuevo}`)) {
    fallar(
      'La transición de salida no pertenece a la máquina cerrada.',
      'transicion_salida_trigger_correo_invalida',
      'transicionSalida'
    );
  }
  const restaura = entrada.estadoAnterior === E.RECLAMADA &&
    [E.PENDIENTE, E.ERROR_REINTENTABLE].includes(entrada.estadoNuevo);
  const estadoPrevioReclamacion = entrada.estadoPrevioReclamacion;
  if (
    restaura && estadoPrevioReclamacion !== entrada.estadoNuevo ||
    !restaura && estadoPrevioReclamacion !== null
  ) {
    fallar(
      'Restaurar una reclamación exige conservar su estado previo exacto.',
      'restauracion_salida_trigger_correo_invalida',
      'transicionSalida.estadoPrevioReclamacion'
    );
  }
  return Object.freeze({ ...entrada });
}

export function esEstadoTerminalSalidaTriggerCorreo(estado) {
  return TERMINALES_SALIDA.has(estado);
}

export function crearIntentoSmtpTriggerCorreo(entrada) {
  validarClavesExactas(entrada, propiedades('INTENTO_SMTP'), 'intentoSmtp');
  exigirPerfil(entrada, PERFIL_INTENTO_SMTP_TRIGGER_CORREO, 'intentoSmtp');
  if (!ESTADOS_INTENTO.has(entrada.estado)) {
    fallar(
      'El intento SMTP contiene un estado desconocido.',
      'estado_intento_smtp_trigger_correo_invalido',
      'intentoSmtp.estado'
    );
  }
  const iniciadoEnUtc = fechaUtc(entrada.iniciadoEnUtc, 'intentoSmtp.iniciadoEnUtc');
  const enCurso = entrada.estado === ESTADOS_INTENTO_SMTP_TRIGGER_CORREO.EN_CURSO;
  const finalizadoEnUtc = entrada.finalizadoEnUtc === null
    ? null
    : fechaUtc(entrada.finalizadoEnUtc, 'intentoSmtp.finalizadoEnUtc');
  if (
    enCurso !== (finalizadoEnUtc === null) ||
    enCurso !== (entrada.clasificacion === null) ||
    enCurso !== (entrada.codigo === null) ||
    enCurso !== (entrada.respuestaSaneada === null)
  ) {
    fallar(
      'Inicio y terminación del intento SMTP son incoherentes.',
      'resultado_intento_smtp_trigger_correo_invalido',
      'intentoSmtp'
    );
  }
  if (finalizadoEnUtc !== null &&
      Date.parse(finalizadoEnUtc) < Date.parse(iniciadoEnUtc)) {
    fallar(
      'Un intento SMTP no puede finalizar antes de comenzar.',
      'cronologia_intento_smtp_trigger_correo_invalida',
      'intentoSmtp.finalizadoEnUtc'
    );
  }
  if (!enCurso) validarClasificacionIntento(entrada);
  return congelarProfundo({
    perfil: entrada.perfil,
    version: entrada.version,
    intentoId: idDecimal(entrada.intentoId, 'intentoSmtp.intentoId'),
    salidaId: idDecimal(entrada.salidaId, 'intentoSmtp.salidaId'),
    numero: enteroPositivo(entrada.numero, 'intentoSmtp.numero'),
    versionConfiguracion: idDecimal(
      entrada.versionConfiguracion,
      'intentoSmtp.versionConfiguracion'
    ),
    smtpMessageId: messageId(entrada.smtpMessageId, 'intentoSmtp.smtpMessageId'),
    estado: entrada.estado,
    iniciadoEnUtc,
    finalizadoEnUtc,
    clasificacion: entrada.clasificacion,
    codigo: entrada.codigo === null
      ? null
      : codigo(entrada.codigo, 'intentoSmtp.codigo'),
    respuestaSaneada: entrada.respuestaSaneada === null
      ? null
      : textoSmtpSaneado(entrada.respuestaSaneada, 'intentoSmtp.respuestaSaneada')
  });
}

export function estadoSalidaDesdeIntentoSmtpTriggerCorreo(estadoIntento) {
  try {
    return estadoSalidaDesdeIntentoSmtpCorreo(estadoIntento);
  } catch (error) {
    fallar(
      error.message,
      'estado_intento_smtp_trigger_correo_no_terminal',
      'estadoIntento'
    );
  }
}

export function crearCapacidadDesuscripcionTriggerCorreo(entrada) {
  validarClavesExactas(entrada, propiedades('CAPACIDAD'), 'capacidad');
  exigirPerfil(
    entrada,
    PERFIL_CAPACIDAD_DESUSCRIPCION_TRIGGER_CORREO,
    'capacidad'
  );
  if (!Object.values(ESTADOS_CAPACIDAD_DESUSCRIPCION_TRIGGER_CORREO)
    .includes(entrada.estado)) {
    fallar(
      'El estado de capacidad no pertenece al contrato.',
      'estado_capacidad_desuscripcion_trigger_correo_invalido',
      'capacidad.estado'
    );
  }
  const ttlDias = enteroEnRango(
    entrada.ttlDias,
    LIMITES_CONTRATO_TRIGGER_CORREO.TTL_DESUSCRIPCION_DIAS_MINIMO,
    LIMITES_CONTRATO_TRIGGER_CORREO.TTL_DESUSCRIPCION_DIAS_MAXIMO,
    'capacidad.ttlDias'
  );
  const preparada = entrada.estado ===
    ESTADOS_CAPACIDAD_DESUSCRIPCION_TRIGGER_CORREO.PREPARADA;
  const emitidaEnUtc = entrada.emitidaEnUtc === null
    ? null
    : fechaUtc(entrada.emitidaEnUtc, 'capacidad.emitidaEnUtc');
  const expiraEnUtc = entrada.expiraEnUtc === null
    ? null
    : fechaUtc(entrada.expiraEnUtc, 'capacidad.expiraEnUtc');
  if (preparada !== (emitidaEnUtc === null && expiraEnUtc === null)) {
    fallar(
      'Una capacidad preparada no tiene reloj y una emitida exige ambos instantes.',
      'cronologia_capacidad_desuscripcion_trigger_correo_invalida',
      'capacidad'
    );
  }
  if (!preparada) {
    const diferencia = Date.parse(expiraEnUtc) - Date.parse(emitidaEnUtc);
    if (diferencia !== ttlDias * 24 * 60 * 60 * 1000) {
      fallar(
        'La expiración no corresponde a la duración fotografiada.',
        'cronologia_capacidad_desuscripcion_trigger_correo_invalida',
        'capacidad.expiraEnUtc'
      );
    }
  }
  return congelarProfundo({
    perfil: entrada.perfil,
    version: entrada.version,
    salidaId: idDecimal(entrada.salidaId, 'capacidad.salidaId'),
    triggerId: idDecimal(entrada.triggerId, 'capacidad.triggerId'),
    tokenHashSha256: hashSha256(
      entrada.tokenHashSha256,
      'capacidad.tokenHashSha256'
    ),
    ttlDias,
    estado: entrada.estado,
    emitidaEnUtc,
    expiraEnUtc
  });
}

export function crearMaterialHmacConfiguracionCorreo(entrada) {
  validarClavesExactas(entrada, propiedades('MATERIAL_HMAC'), 'materialHmac');
  exigirPerfil(entrada, PERFIL_MATERIAL_HMAC_CORREO, 'materialHmac');
  if (entrada.perfilSmtp !== VERSION_PRUEBA_SMTP_TRIGGER_CORREO ||
      entrada.perfilBuzon !== VERSION_NORMALIZACION_BUZON_TRIGGER_CORREO) {
    fallar(
      'Los perfiles SMTP y de buzón no pertenecen al contrato.',
      'perfil_material_hmac_correo_incompatible',
      'materialHmac'
    );
  }
  const entradas = lista(entrada.entradas, 'materialHmac.entradas');
  if (entradas.length === 0) {
    fallar(
      'El material HMAC requiere un catálogo ordenado no vacío.',
      'entradas_material_hmac_correo_invalidas',
      'materialHmac.entradas'
    );
  }
  const claves = new Set();
  const normalizadas = entradas.map((item, indice) => {
    const ruta = `materialHmac.entradas[${indice}]`;
    validarClavesExactas(item, propiedades('ENTRADA_HMAC'), ruta);
    const clave = claveHmac(item.clave, `${ruta}.clave`);
    if (claves.has(clave)) {
      fallar(
        'El catálogo HMAC no admite claves repetidas.',
        'clave_material_hmac_correo_duplicada',
        `${ruta}.clave`
      );
    }
    claves.add(clave);
    if (!TIPOS_HMAC.has(item.tipo)) {
      fallar(
        'El tipo del valor HMAC no pertenece al contrato.',
        'tipo_material_hmac_correo_invalido',
        `${ruta}.tipo`
      );
    }
    return Object.freeze({
      clave,
      tipo: item.tipo,
      valor: normalizarValorHmac(item.tipo, item.valor, `${ruta}.valor`)
    });
  });
  const campos = [
    ['perfil', entrada.perfil],
    ['version', String(entrada.version)],
    ['perfilSmtp', entrada.perfilSmtp],
    ['perfilBuzon', entrada.perfilBuzon],
    ...normalizadas.flatMap((item) => [
      ['clave', item.clave],
      ['tipo', item.tipo],
      ['valor', serializarValorHmac(item.tipo, item.valor)]
    ])
  ];
  const materialUtf8 = campos.map(([tipo, valor]) =>
    `${tipo}:${longitudUtf8(valor)}:${valor}`
  ).join('|');
  return congelarProfundo({
    algoritmo: 'HMAC-SHA-256',
    codificacion: 'utf8-longitud-prefijada-v1',
    perfil: entrada.perfil,
    version: entrada.version,
    perfilSmtp: entrada.perfilSmtp,
    perfilBuzon: entrada.perfilBuzon,
    entradas: normalizadas,
    materialUtf8
  });
}

function validarGrafoDestinatariosYSalidas({
  resultadosDestinatarios,
  salidas,
  notificacionId,
  ejecucionTriggerId,
  mensajeMaterializado
}) {
  const salidasPorId = new Map();
  const salidasPorHuella = new Map();
  const salidasPorBuzon = new Map();
  const messageIds = new Set();
  for (const salida of salidas) {
    if (salida.notificacionId !== notificacionId ||
        salida.ejecucionTriggerId !== ejecucionTriggerId) {
      fallar(
        'La salida no pertenece a la intención que la contiene.',
        'salida_intencion_trigger_correo_incoherente',
        'intencion.salidas'
      );
    }
    if (salida.asunto !== mensajeMaterializado.asunto ||
        !salida.cuerpoPrivadoTexto.startsWith(
          `${mensajeMaterializado.cuerpoBaseTexto}\n`
        )) {
      fallar(
        'La salida debe conservar el mensaje causal y añadir solo su pie privado.',
        'mensaje_salida_trigger_correo_incoherente',
        'intencion.salidas'
      );
    }
    const salidaMismaHuella = salidasPorHuella.get(salida.claveBuzonSha256);
    const salidaMismoBuzon = salidasPorBuzon.get(salida.buzonCanonico);
    if (salidaMismaHuella &&
        salidaMismaHuella.buzonCanonico !== salida.buzonCanonico) {
      fallar(
        'Una colisión de huella no puede fusionar buzones distintos.',
        'colision_buzon_trigger_correo',
        'intencion.salidas'
      );
    }
    if (salidaMismoBuzon &&
        salidaMismoBuzon.claveBuzonSha256 !== salida.claveBuzonSha256) {
      fallar(
        'Un mismo buzón no puede presentar dos huellas distintas.',
        'huella_buzon_trigger_correo_incoherente',
        'intencion.salidas'
      );
    }
    if (salidasPorId.has(salida.salidaId) || salidaMismaHuella ||
        salidaMismoBuzon) {
      fallar(
        'Una intención solo admite una salida por buzón.',
        'salida_intencion_trigger_correo_duplicada',
        'intencion.salidas'
      );
    }
    if (messageIds.has(salida.smtpMessageId)) {
      fallar(
        'Cada salida física debe conservar un Message-ID distinto.',
        'message_id_salida_trigger_correo_duplicado',
        'intencion.salidas'
      );
    }
    salidasPorId.set(salida.salidaId, salida);
    salidasPorHuella.set(salida.claveBuzonSha256, salida);
    salidasPorBuzon.set(salida.buzonCanonico, salida);
    messageIds.add(salida.smtpMessageId);
  }
  const procedencias = new Set();
  const relacionesVivas = new Set();
  const salidasReferenciadas = new Set();
  const buzonesPorHuella = new Map();
  for (const resultado of resultadosDestinatarios) {
    if (procedencias.has(resultado.claveProcedencia)) {
      fallar(
        'Una procedencia solo puede producir un resultado por ejecución.',
        'procedencia_intencion_trigger_correo_duplicada',
        'intencion.resultadosDestinatarios'
      );
    }
    procedencias.add(resultado.claveProcedencia);
    if (resultado.relacionDestinatarioId !== null) {
      if (relacionesVivas.has(resultado.relacionDestinatarioId)) {
        fallar(
          'Una relación viva no puede producir dos resultados en la ejecución.',
          'relacion_intencion_trigger_correo_duplicada',
          'intencion.resultadosDestinatarios'
        );
      }
      relacionesVivas.add(resultado.relacionDestinatarioId);
    }
    if (resultado.codigoInicial !==
        CODIGOS_RESULTADO_DESTINATARIO_TRIGGER_CORREO.ACEPTADO) continue;
    const salida = salidasPorId.get(resultado.salidaId);
    if (!salida ||
        salida.claveBuzonSha256 !== resultado.claveBuzonSha256 ||
        salida.buzonCanonico !== resultado.emailResueltoCanonico) {
      fallar(
        'El destinatario aceptado no coincide con su salida física.',
        'salida_destinatario_trigger_correo_incoherente',
        'intencion.resultadosDestinatarios'
      );
    }
    const buzonAnterior = buzonesPorHuella.get(resultado.claveBuzonSha256);
    if (buzonAnterior && buzonAnterior !== resultado.emailResueltoCanonico) {
      fallar(
        'Una colisión de huella no puede fusionar buzones distintos.',
        'colision_buzon_trigger_correo',
        'intencion.resultadosDestinatarios'
      );
    }
    buzonesPorHuella.set(
      resultado.claveBuzonSha256,
      resultado.emailResueltoCanonico
    );
    salidasReferenciadas.add(resultado.salidaId);
  }
  if (salidasReferenciadas.size !== salidas.length) {
    fallar(
      'Toda salida necesita al menos una procedencia aceptada.',
      'salida_intencion_trigger_correo_sin_procedencia',
      'intencion.salidas'
    );
  }
}

function exigirMismaListaResultados(actuales, esperados) {
  if (
    actuales.length !== esperados.length ||
    actuales.some((resultado, indice) =>
      JSON.stringify(resultado) !== JSON.stringify(esperados[indice])
    )
  ) {
    fallar(
      'El resultado agregado no puede reescribir la audiencia evaluada.',
      'resultados_destinatarios_trigger_correo_divergentes',
      'resultadoAceptacion.resultadosDestinatarios'
    );
  }
}

function validarCapacidadesIntencion({ capacidades, salidas, triggerId }) {
  const salidasEsperadas = new Set(salidas.map((salida) => salida.salidaId));
  const salidasConCapacidad = new Set();
  const huellasToken = new Set();
  const ttlFotografiado = capacidades[0]?.ttlDias ?? null;
  for (const capacidad of capacidades) {
    if (capacidad.estado !==
        ESTADOS_CAPACIDAD_DESUSCRIPCION_TRIGGER_CORREO.PREPARADA ||
        capacidad.triggerId !== triggerId ||
        !salidasEsperadas.has(capacidad.salidaId) ||
        salidasConCapacidad.has(capacidad.salidaId) ||
        huellasToken.has(capacidad.tokenHashSha256) ||
        capacidad.ttlDias !== ttlFotografiado) {
      fallar(
        'Cada salida aceptada exige una única capacidad preparada del trigger causal.',
        'capacidad_intencion_trigger_correo_incoherente',
        'intencion.capacidades'
      );
    }
    salidasConCapacidad.add(capacidad.salidaId);
    huellasToken.add(capacidad.tokenHashSha256);
  }
  if (salidasConCapacidad.size !== salidasEsperadas.size) {
    fallar(
      'Cada salida aceptada exige una capacidad de desuscripción.',
      'capacidad_intencion_trigger_correo_ausente',
      'intencion.capacidades'
    );
  }
}

function exigirAudienciaAcotada(elementos, campo) {
  if (elementos.length >
      LIMITES_CONTRATO_TRIGGER_CORREO.RELACIONES_DESTINATARIAS_MAXIMAS) {
    fallar(
      'La audiencia supera el máximo absoluto del contrato.',
      'audiencia_trigger_correo_fuera_de_limite',
      campo
    );
  }
}

function validarClasificacionIntento(entrada) {
  const E = ESTADOS_INTENTO_SMTP_TRIGGER_CORREO;
  const C = CLASIFICACIONES_INTENTO_SMTP_TRIGGER_CORREO;
  const esperadas = {
    [E.ACEPTADO]: C.ACEPTACION_DEMOSTRADA,
    [E.RECHAZADO]: C.RECHAZO_PERMANENTE,
    [E.FALLIDO_REINTENTABLE]: C.FALLO_REINTENTABLE,
    [E.FALLIDO_FINAL]: C.FALLO_FINAL,
    [E.AMBIGUO]: C.RESULTADO_AMBIGUO
  };
  if (entrada.clasificacion !== esperadas[entrada.estado] ||
      typeof entrada.codigo !== 'string') {
    fallar(
      'Estado y clasificación del intento SMTP no coinciden.',
      'clasificacion_intento_smtp_trigger_correo_invalida',
      'intentoSmtp.clasificacion'
    );
  }
}

function validarTokensAsunto(asunto) {
  const residuos = asunto.replace(/\{\{([a-z]+)\}\}/gu, (_coincidencia, token) => {
    if (!TOKENS_ASUNTO.has(token)) {
      fallar(
        'La plantilla contiene un token no autorizado.',
        'token_asunto_trigger_correo_invalido',
        'definicionMensaje.asuntoPlantilla'
      );
    }
    return '';
  });
  if (/[{}]/u.test(residuos)) {
    fallar(
      'La plantilla contiene una expresión incompleta o no autorizada.',
      'token_asunto_trigger_correo_invalido',
      'definicionMensaje.asuntoPlantilla'
    );
  }
}

function normalizarContextoHumano(entrada) {
  validarClavesExactas(entrada, propiedades('CONTEXTO_HUMANO'), 'contextoHumano');
  return congelarProfundo({
    descripcionFallo: textoCuerpoOpcional(
      entrada.descripcionFallo,
      LIMITES_CONTRATO_TRIGGER_CORREO.CONTEXTO_HUMANO_CARACTERES,
      'contextoHumano.descripcionFallo'
    ),
    posibleSolucion: textoCuerpoOpcional(
      entrada.posibleSolucion,
      LIMITES_CONTRATO_TRIGGER_CORREO.CONTEXTO_HUMANO_CARACTERES,
      'contextoHumano.posibleSolucion'
    )
  });
}

function normalizarReferencias(entrada) {
  validarClavesExactas(entrada, propiedades('REFERENCIAS'), 'referencias');
  return congelarProfundo({
    estadoUrl: urlHttps(entrada.estadoUrl, 'referencias.estadoUrl'),
    historicoUrl: urlHttps(entrada.historicoUrl, 'referencias.historicoUrl')
  });
}

function normalizarScope(entrada, ruta) {
  validarClavesExactas(entrada, propiedades('SCOPE'), ruta);
  if (!['portal', 'tenant', 'empresa', 'sitio'].includes(entrada.nivel)) {
    fallar('El nivel de scope no es válido.', 'scope_trigger_correo_invalido', `${ruta}.nivel`);
  }
  const scope = {
    nivel: entrada.nivel,
    tenantId: idDecimalOpcional(entrada.tenantId, `${ruta}.tenantId`),
    empresaId: idDecimalOpcional(entrada.empresaId, `${ruta}.empresaId`),
    sitioId: idDecimalOpcional(entrada.sitioId, `${ruta}.sitioId`)
  };
  const valido =
    (scope.nivel === 'portal' && scope.tenantId === null &&
      scope.empresaId === null && scope.sitioId === null) ||
    (scope.nivel === 'tenant' && scope.tenantId !== null &&
      scope.empresaId === null && scope.sitioId === null) ||
    (scope.nivel === 'empresa' && scope.tenantId !== null &&
      scope.empresaId !== null && scope.sitioId === null) ||
    (scope.nivel === 'sitio' && scope.tenantId !== null &&
      scope.empresaId !== null && scope.sitioId !== null);
  if (!valido) {
    fallar(
      'La jerarquía del scope es incoherente.',
      'scope_trigger_correo_invalido',
      ruta
    );
  }
  return congelarProfundo(scope);
}

function normalizarValorHmac(tipo, valor, campo) {
  if (tipo === TIPOS_VALOR_HMAC_CORREO.NULO) {
    if (valor !== null) {
      fallar(
        'Un valor HMAC nulo debe ser null.',
        'valor_material_hmac_correo_invalido',
        campo
      );
    }
    return null;
  }
  if (tipo === TIPOS_VALOR_HMAC_CORREO.BOOLEANO) {
    if (typeof valor !== 'boolean') {
      fallar(
        'Un valor HMAC booleano debe conservar su tipo.',
        'valor_material_hmac_correo_invalido',
        campo
      );
    }
    return valor;
  }
  if (tipo === TIPOS_VALOR_HMAC_CORREO.ENTERO) {
    if (!Number.isSafeInteger(valor)) {
      fallar(
        'Un valor HMAC entero debe ser seguro.',
        'valor_material_hmac_correo_invalido',
        campo
      );
    }
    return Object.is(valor, -0) ? 0 : valor;
  }
  if (typeof valor !== 'string' || !esUnicodeBienFormado(valor)) {
    fallar(
      'Un valor HMAC textual debe conservar su tipo.',
      'valor_material_hmac_correo_invalido',
      campo
    );
  }
  return valor;
}

function serializarValorHmac(tipo, valor) {
  if (tipo === TIPOS_VALOR_HMAC_CORREO.NULO) return 'null';
  if (tipo === TIPOS_VALOR_HMAC_CORREO.BOOLEANO) return valor ? 'true' : 'false';
  if (tipo === TIPOS_VALOR_HMAC_CORREO.ENTERO) return String(valor);
  return valor;
}

function textoCabecera(valor, maximo, campo) {
  if (typeof valor !== 'string' || valor.length === 0 || valor !== valor.trim() ||
      !esUnicodeBienFormado(valor) || [...valor].length > maximo ||
      /[\u0000-\u001f\u007f]/u.test(valor)) {
    fallar('El texto de cabecera no es válido.', 'texto_cabecera_trigger_correo_invalido', campo);
  }
  return valor;
}

function textoCuerpoOpcional(valor, maximo, campo) {
  if (valor === null) return null;
  if (typeof valor !== 'string' || valor !== valor.trim() ||
      !esUnicodeBienFormado(valor) || [...valor].length > maximo ||
      /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f\r]/u.test(valor)) {
    fallar(
      'El texto configurable del cuerpo no es válido.',
      'texto_cuerpo_trigger_correo_invalido',
      campo
    );
  }
  return valor || null;
}

function textoCuerpoLimitado(valor, maximoBytes, campo) {
  if (typeof valor !== 'string' || valor.length === 0 || valor !== valor.trim() ||
      !esUnicodeBienFormado(valor) ||
      /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f\r]/u.test(valor) ||
      longitudUtf8(valor) > maximoBytes) {
    fallar(
      'El cuerpo materializado no es válido.',
      'cuerpo_materializado_trigger_correo_invalido',
      campo
    );
  }
  return valor;
}

function textoVisible(valor, maximo, campo) {
  if (typeof valor !== 'string' || valor.length === 0 || valor !== valor.trim() ||
      !esUnicodeBienFormado(valor) || [...valor].length > maximo ||
      /[\u0000-\u001f\u007f]/u.test(valor)) {
    fallar('El texto visible no es válido.', 'texto_visible_trigger_correo_invalido', campo);
  }
  return valor;
}

function textoVisibleOpcional(valor, maximo, campo) {
  if (valor === null) return null;
  return textoVisible(valor, maximo, campo);
}

function textoAscii(valor, maximo, campo) {
  if (typeof valor !== 'string' || valor.length === 0 || valor !== valor.trim() ||
      valor.length > maximo || !/^[\x21-\x7e]+$/u.test(valor)) {
    fallar('El texto ASCII no es válido.', 'texto_ascii_trigger_correo_invalido', campo);
  }
  return valor;
}

function textoSmtpSaneado(valor, campo) {
  if (typeof valor !== 'string' || valor.length === 0 || valor !== valor.trim() ||
      !esUnicodeBienFormado(valor) || /[\u0000-\u001f\u007f]/u.test(valor) ||
      longitudUtf8(valor) > LIMITES_CONTRATO_TRIGGER_CORREO.RESPUESTA_SMTP_UTF8_BYTES) {
    fallar('La respuesta SMTP no está saneada.', 'respuesta_smtp_trigger_correo_invalida', campo);
  }
  return valor;
}

function codigo(valor, campo) {
  if (typeof valor !== 'string' || !PATRON_CODIGO.test(valor)) {
    fallar(
      'El código no pertenece al formato contractual.',
      'codigo_trigger_correo_invalido',
      campo
    );
  }
  return valor;
}

function codigoOpcional(valor, campo) {
  return valor === null ? null : codigo(valor, campo);
}

function buzonCanonico(valor, campo) {
  try {
    return exigirBuzonCanonicoCorreo(valor);
  } catch {
    fallar(
      'El buzón no usa una representación canónica de buzon@1.',
      'buzon_trigger_correo_invalido',
      campo
    );
  }
}

function buzonCanonicoOpcional(valor, campo) {
  return valor === null ? null : buzonCanonico(valor, campo);
}

function buzonPresentacionOpcional(valor, campo) {
  if (valor === null) return null;
  if (typeof valor !== 'string' || valor !== valor.trim() ||
      !esUnicodeBienFormado(valor) ||
      longitudUtf8(valor) > LIMITES_CONTRATO_TRIGGER_CORREO.BUZON_UTF8_BYTES ||
      /[\s\u0000-\u001f\u007f]/u.test(valor)) {
    fallar(
      'La representación de presentación del buzón no es segura.',
      'buzon_presentacion_trigger_correo_invalido',
      campo
    );
  }
  return valor;
}

function versionBuzon(valor, campo) {
  if (valor !== VERSION_NORMALIZACION_BUZON_TRIGGER_CORREO) {
    fallar(
      'La versión de normalización de buzón no pertenece al contrato.',
      'version_buzon_trigger_correo_incompatible',
      campo
    );
  }
  return valor;
}

function origenHttps(valor, campo) {
  if (typeof valor !== 'string' || valor !== valor.trim()) {
    fallar(
      'El origen público debe ser HTTPS y no contener ruta.',
      'origen_publico_trigger_correo_invalido',
      campo
    );
  }
  try {
    const url = new URL(valor);
    if (url.protocol !== 'https:' || url.username || url.password ||
        url.pathname !== '/' || url.search || url.hash || url.origin !== valor) {
      throw new Error('origen_no_canonico');
    }
    return url.origin;
  } catch (_error) {
    fallar(
      'El origen público debe ser HTTPS y no contener ruta.',
      'origen_publico_trigger_correo_invalido',
      campo
    );
  }
}

function urlHttps(valor, campo) {
  if (typeof valor !== 'string' || valor !== valor.trim()) {
    fallar('La URL debe ser texto canónico.', 'url_trigger_correo_invalida', campo);
  }
  try {
    const url = new URL(valor);
    if (url.protocol !== 'https:' || url.username || url.password || url.hash ||
        url.toString() !== valor) throw new Error('url_no_canonica');
    return valor;
  } catch (_error) {
    fallar('La URL HTTPS no es válida o canónica.', 'url_trigger_correo_invalida', campo);
  }
}

function messageId(valor, campo) {
  const coincidencia = typeof valor === 'string'
    ? PATRON_MESSAGE_ID.exec(valor)
    : null;
  const dominio = coincidencia?.[2] ?? '';
  const etiquetasDominio = dominio.split('.');
  if (!coincidencia || dominio.includes('..') ||
      etiquetasDominio.some((etiqueta) => etiqueta.length === 0 ||
        etiqueta.length > 63 || etiqueta.startsWith('-') || etiqueta.endsWith('-'))) {
    fallar(
      'El Message-ID no pertenece al perfil cerrado.',
      'message_id_trigger_correo_invalido',
      campo
    );
  }
  return valor;
}

function hashSha256(valor, campo) {
  if (typeof valor !== 'string' || !PATRON_HASH_SHA256.test(valor)) {
    fallar(
      'La huella debe ser SHA-256 hexadecimal canónica.',
      'hash_trigger_correo_invalido',
      campo
    );
  }
  return valor;
}

function hashSha256Opcional(valor, campo) {
  return valor === null ? null : hashSha256(valor, campo);
}

function idDecimal(valor, campo) {
  if (typeof valor !== 'string' || !PATRON_ID_DECIMAL.test(valor)) {
    fallar('El id debe ser texto decimal positivo canónico.', 'id_trigger_correo_invalido', campo);
  }
  return valor;
}

function idDecimalOpcional(valor, campo) {
  return valor === null ? null : idDecimal(valor, campo);
}

function enteroPositivo(valor, campo) {
  if (!Number.isSafeInteger(valor) || valor < 1) {
    fallar('El entero debe ser positivo y seguro.', 'entero_trigger_correo_invalido', campo);
  }
  return valor;
}

function enteroEnRango(valor, minimo, maximo, campo) {
  if (!Number.isSafeInteger(valor) || valor < minimo || valor > maximo) {
    fallar('El entero queda fuera del rango contractual.', 'entero_trigger_correo_invalido', campo);
  }
  return valor;
}

function claveHmac(valor, campo) {
  if (typeof valor !== 'string' || !PATRON_CLAVE_HMAC.test(valor)) {
    fallar('La clave de catálogo HMAC no es válida.', 'clave_material_hmac_correo_invalida', campo);
  }
  return valor;
}

function fechaUtc(valor, campo) {
  if (typeof valor !== 'string' || !PATRON_FECHA_UTC.test(valor) ||
      !Number.isFinite(Date.parse(valor)) || new Date(valor).toISOString() !== valor) {
    fallar(
      'La fecha debe ser UTC canónica con milisegundos.',
      'fecha_trigger_correo_invalida',
      campo
    );
  }
  return valor;
}

function uuidV7(valor, campo) {
  if (typeof valor !== 'string' || !PATRON_UUID_V7.test(valor)) {
    fallar(
      'La identidad causal debe ser UUIDv7 canónico.',
      'uuidv7_trigger_correo_invalido',
      campo
    );
  }
  return valor;
}

function lista(valor, campo) {
  if (!Array.isArray(valor) || Object.getPrototypeOf(valor) !== Array.prototype) {
    fallar('El campo debe ser una lista.', 'lista_trigger_correo_invalida', campo);
  }
  let cantidadIndices = 0;
  for (const clave of Reflect.ownKeys(valor)) {
    if (clave === 'length') continue;
    const descriptor = typeof clave === 'string'
      ? Object.getOwnPropertyDescriptor(valor, clave)
      : null;
    const indice = typeof clave === 'string' && /^(?:0|[1-9][0-9]*)$/u.test(clave)
      ? Number(clave)
      : Number.NaN;
    if (!Number.isSafeInteger(indice) || indice < 0 || indice >= valor.length ||
        descriptor?.enumerable !== true || !Object.hasOwn(descriptor, 'value')) {
      fallar(
        'La lista contiene una propiedad o acceso no admitido.',
        'lista_trigger_correo_invalida',
        campo
      );
    }
    cantidadIndices += 1;
  }
  if (cantidadIndices !== valor.length) {
    fallar(
      'La lista no puede contener posiciones dispersas.',
      'lista_trigger_correo_invalida',
      campo
    );
  }
  return valor;
}

function longitudUtf8(valor) {
  return new TextEncoder().encode(valor).byteLength;
}

function esUnicodeBienFormado(valor) {
  for (let indice = 0; indice < valor.length; indice += 1) {
    const unidad = valor.charCodeAt(indice);
    if (unidad >= 0xd800 && unidad <= 0xdbff) {
      const siguiente = valor.charCodeAt(indice + 1);
      if (!(siguiente >= 0xdc00 && siguiente <= 0xdfff)) return false;
      indice += 1;
    } else if (unidad >= 0xdc00 && unidad <= 0xdfff) {
      return false;
    }
  }
  return true;
}

function propiedades(nombre) {
  return PROPIEDADES_CONTRATO_TRIGGER_CORREO[nombre];
}

function exigirPerfil(entrada, perfil, ruta) {
  if (entrada.perfil !== perfil || entrada.version !== VERSION_PERFIL) {
    fallar(
      `${ruta} no usa el perfil y versión esperados.`,
      'version_contrato_trigger_correo_incompatible',
      ruta
    );
  }
}

function validarClavesExactas(entrada, esperadas, ruta) {
  if (!entrada || typeof entrada !== 'object' || Array.isArray(entrada) ||
      Object.getPrototypeOf(entrada) !== Object.prototype) {
    fallar(
      `${ruta} debe ser un objeto JSON plano.`,
      'forma_contrato_trigger_correo_invalida',
      ruta
    );
  }
  const permitidas = new Set(esperadas);
  for (const clave of Reflect.ownKeys(entrada)) {
    const descriptor = typeof clave === 'string'
      ? Object.getOwnPropertyDescriptor(entrada, clave)
      : null;
    if (typeof clave !== 'string' || !permitidas.has(clave) ||
        descriptor?.enumerable !== true || !Object.hasOwn(descriptor, 'value')) {
      fallar(
        `${ruta} contiene una propiedad no admitida.`,
        'propiedad_contrato_trigger_correo_desconocida',
        typeof clave === 'string' ? `${ruta}.${clave}` : ruta
      );
    }
  }
  for (const esperada of esperadas) {
    if (!Object.hasOwn(entrada, esperada)) {
      fallar(
        `${ruta} no contiene todas las propiedades requeridas.`,
        'propiedad_contrato_trigger_correo_ausente',
        `${ruta}.${esperada}`
      );
    }
  }
}

function congelarProfundo(valor) {
  if (!valor || typeof valor !== 'object' || Object.isFrozen(valor)) return valor;
  for (const descendiente of Object.values(valor)) congelarProfundo(descendiente);
  return Object.freeze(valor);
}

function fallar(mensaje, codigoError, campo) {
  throw new ErrorContratoTriggerCorreo(mensaje, {
    codigo: codigoError,
    campo
  });
}

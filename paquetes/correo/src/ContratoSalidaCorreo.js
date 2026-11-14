export const ORIGENES_SALIDA_CORREO = Object.freeze({
  PRUEBA: 'prueba',
  TRIGGER: 'trigger',
  RECUPERACION_PASSWORD: 'recuperacion_password',
  REINICIO_PASSWORD_ADMINISTRATIVO: 'reinicio_password_administrativo',
  VERIFICACION_EMAIL_PERFIL: 'verificacion_email_perfil'
});

export const PROPOSITOS_SALIDA_CORREO_RECUPERACION_PASSWORD = Object.freeze({
  TRANSPORTAR_SOLICITUD: 'transportar_solicitud',
  NOTIFICAR_CAMBIO: 'notificar_cambio'
});

export const ESTADOS_SALIDA_CORREO = Object.freeze({
  PREPARADA: 'preparada',
  PENDIENTE: 'pendiente',
  RECLAMADA: 'reclamada',
  ENVIANDO: 'enviando',
  ERROR_REINTENTABLE: 'error_reintentable',
  ENVIADO: 'enviado',
  ERROR_FINAL: 'error_final',
  RESULTADO_AMBIGUO: 'resultado_ambiguo',
  DESCARTADA: 'descartada'
});

export const CAUSAS_DESCARTE_SALIDA_CORREO = Object.freeze({
  AUTORIDAD_BUZON_RETIRADA: 'autoridad_buzon_retirada',
  OPERACION_EMAIL_PERFIL_SUSTITUIDA: 'operacion_email_perfil_sustituida',
  OPERACION_EMAIL_PERFIL_CONSUMIDA: 'operacion_email_perfil_consumida',
  OPERACION_EMAIL_PERFIL_EXPIRADA: 'operacion_email_perfil_expirada',
  IDENTIDAD_EMAIL_PERFIL_NO_VIGENTE: 'identidad_email_perfil_no_vigente',
  IDENTIDAD_EMAIL_PERFIL_DISTINTA: 'identidad_email_perfil_distinta',
  CREDENCIAL_EMAIL_PERFIL_CAMBIADA: 'credencial_email_perfil_cambiada',
  CORREO_ORIGEN_EMAIL_PERFIL_CAMBIADO: 'correo_origen_email_perfil_cambiado',
  PROPOSITO_EMAIL_PERFIL_AGOTADO: 'proposito_email_perfil_agotado'
});

export const ESTADOS_TERMINALES_SALIDA_CORREO = Object.freeze([
  ESTADOS_SALIDA_CORREO.ENVIADO,
  ESTADOS_SALIDA_CORREO.ERROR_FINAL,
  ESTADOS_SALIDA_CORREO.RESULTADO_AMBIGUO,
  ESTADOS_SALIDA_CORREO.DESCARTADA
]);

export const ESTADOS_INTENTO_SMTP_CORREO = Object.freeze({
  EN_CURSO: 'en_curso',
  ACEPTADO: 'aceptado',
  RECHAZADO: 'rechazado',
  FALLIDO_REINTENTABLE: 'fallido_reintentable',
  FALLIDO_FINAL: 'fallido_final',
  AMBIGUO: 'ambiguo'
});

export const CLASIFICACIONES_INTENTO_SMTP_CORREO = Object.freeze({
  ACEPTACION_DEMOSTRADA: 'aceptacion_demostrada',
  RECHAZO_PERMANENTE: 'rechazo_permanente',
  FALLO_REINTENTABLE: 'fallo_reintentable',
  FALLO_FINAL: 'fallo_final',
  RESULTADO_AMBIGUO: 'resultado_ambiguo'
});

const ESTADOS = new Set(Object.values(ESTADOS_SALIDA_CORREO));
const TERMINALES = new Set(ESTADOS_TERMINALES_SALIDA_CORREO);
const ORIGENES = new Set(Object.values(ORIGENES_SALIDA_CORREO));
const CAUSAS_DESCARTE = new Set(Object.values(CAUSAS_DESCARTE_SALIDA_CORREO));

export class ErrorContratoSalidaCorreo extends Error {
  constructor(mensaje, { codigo, campo } = {}) {
    super(mensaje);
    this.name = 'ErrorContratoSalidaCorreo';
    this.codigo = codigo;
    this.campo = campo;
  }
}

export function validarTransicionSalidaCorreo(entrada) {
  exigirObjetoExacto(
    entrada,
    ['estadoAnterior', 'estadoNuevo', 'estadoPrevioReclamacion'],
    'transicionSalida'
  );
  if (!ESTADOS.has(entrada.estadoAnterior) || !ESTADOS.has(entrada.estadoNuevo)) {
    fallar(
      'La transición contiene un estado de salida desconocido.',
      'estado_salida_correo_invalido',
      'transicionSalida'
    );
  }
  if (TERMINALES.has(entrada.estadoAnterior)) {
    fallar(
      'Un estado terminal de salida no puede reabrirse.',
      'terminalidad_salida_correo_violada',
      'transicionSalida.estadoAnterior'
    );
  }
  const E = ESTADOS_SALIDA_CORREO;
  const permitidas = new Set([
    `${E.PREPARADA}:${E.PENDIENTE}`,
    `${E.PENDIENTE}:${E.RECLAMADA}`,
    `${E.PENDIENTE}:${E.ERROR_FINAL}`,
    `${E.PENDIENTE}:${E.DESCARTADA}`,
    `${E.ERROR_REINTENTABLE}:${E.RECLAMADA}`,
    `${E.ERROR_REINTENTABLE}:${E.ERROR_FINAL}`,
    `${E.ERROR_REINTENTABLE}:${E.DESCARTADA}`,
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
      'transicion_salida_correo_invalida',
      'transicionSalida'
    );
  }
  const restaura = entrada.estadoAnterior === E.RECLAMADA &&
    [E.PENDIENTE, E.ERROR_REINTENTABLE].includes(entrada.estadoNuevo);
  if (
    (restaura && entrada.estadoPrevioReclamacion !== entrada.estadoNuevo) ||
    (!restaura && entrada.estadoPrevioReclamacion !== null)
  ) {
    fallar(
      'Restaurar una reclamación exige conservar su estado previo exacto.',
      'restauracion_salida_correo_invalida',
      'transicionSalida.estadoPrevioReclamacion'
    );
  }
  return Object.freeze({ ...entrada });
}

export function validarCausaDescarteSalidaCorreo(causa) {
  if (!CAUSAS_DESCARTE.has(causa)) {
    fallar(
      'La causa de descarte no pertenece al vocabulario cerrado.',
      'causa_descarte_salida_correo_invalida',
      'causaDescarte'
    );
  }
  return causa;
}

export function esEstadoTerminalSalidaCorreo(estado) {
  return TERMINALES.has(estado);
}

export function esEstadoReclamableSalidaCorreo(estado) {
  return [
    ESTADOS_SALIDA_CORREO.PENDIENTE,
    ESTADOS_SALIDA_CORREO.ERROR_REINTENTABLE
  ].includes(estado);
}

export function estadoSalidaDesdeIntentoSmtpCorreo(estadoIntento) {
  const I = ESTADOS_INTENTO_SMTP_CORREO;
  const E = ESTADOS_SALIDA_CORREO;
  const correspondencias = {
    [I.ACEPTADO]: E.ENVIADO,
    [I.RECHAZADO]: E.ERROR_FINAL,
    [I.FALLIDO_REINTENTABLE]: E.ERROR_REINTENTABLE,
    [I.FALLIDO_FINAL]: E.ERROR_FINAL,
    [I.AMBIGUO]: E.RESULTADO_AMBIGUO
  };
  if (!Object.hasOwn(correspondencias, estadoIntento)) {
    fallar(
      'Un intento no terminal todavía no decide el estado de la salida.',
      'estado_intento_smtp_correo_no_terminal',
      'estadoIntento'
    );
  }
  return correspondencias[estadoIntento];
}

export function exigirProcedenciaDespachoCorreo({ esperada, observada } = {}) {
  if (!ORIGENES.has(esperada) || !ORIGENES.has(observada)) {
    fallar(
      'La procedencia de correo no pertenece al vocabulario cerrado.',
      'procedencia_salida_correo_invalida',
      'procedencia'
    );
  }
  if (esperada !== observada) {
    fallar(
      'Un despachador no puede consumir una procedencia distinta de su contrato.',
      'procedencia_despacho_correo_incompatible',
      'procedencia.observada'
    );
  }
  return observada;
}

function exigirObjetoExacto(entrada, propiedades, campo) {
  const claves = entrada && typeof entrada === 'object' && !Array.isArray(entrada)
    ? Reflect.ownKeys(entrada)
    : [];
  if (!entrada || typeof entrada !== 'object' || Array.isArray(entrada) ||
      Object.getPrototypeOf(entrada) !== Object.prototype ||
      claves.some((clave) => typeof clave !== 'string') ||
      claves.sort().join(',') !== [...propiedades].sort().join(',')) {
    fallar(
      `${campo} no contiene exactamente las propiedades admitidas.`,
      'forma_contrato_salida_correo_invalida',
      campo
    );
  }
}

function fallar(mensaje, codigo, campo) {
  throw new ErrorContratoSalidaCorreo(mensaje, { codigo, campo });
}

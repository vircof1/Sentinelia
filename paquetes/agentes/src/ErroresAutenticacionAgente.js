export const CODIGOS_ERROR_AUTENTICACION_AGENTE = Object.freeze({
  CREDENCIALES_INVALIDAS: 'credenciales_invalidas',
  AGENTE_DESHABILITADO: 'agente_deshabilitado',
  AGENTE_EN_CUARENTENA: 'agente_en_cuarentena',
  LOGIN_EN_PROGRESO: 'login_en_progreso',
  SESION_NO_VIVA: 'sesion_no_vigente',
  SESSION_ID_ACTUAL_NO_COINCIDE: 'session_id_actual_no_coincide',
  BOOT_ID_INCOHERENTE: 'boot_id_incoherente',
  HEARTBEAT_SEQ_ANTIGUO: 'heartbeat_seq_antiguo',
  REFRESH_CONCURRENTE: 'refresh_concurrente',
  ESTADO_INCONSISTENTE: 'estado_inconsistente_relogin_requerido'
});

export const ACCIONES_AUTENTICACION_AGENTE = Object.freeze({
  CONTINUE: 'continue',
  REFRESH_SESSION: 'refresh_session',
  REFRESH_CONFIG: 'refresh_config',
  LOGIN_REQUIRED: 'login_required'
});

export class ErrorAutenticacionAgente extends Error {
  constructor(mensaje, {
    codigo = CODIGOS_ERROR_AUTENTICACION_AGENTE.CREDENCIALES_INVALIDAS,
    statusCode = 401,
    accion = null,
    detalles = {}
  } = {}) {
    super(mensaje);
    this.name = 'ErrorAutenticacionAgente';
    this.codigo = codigo;
    this.statusCode = statusCode;
    this.accion = accion;
    this.detalles = detalles;
  }
}

export function errorCredencialesInvalidas() {
  return new ErrorAutenticacionAgente(
    'Las credenciales técnicas del agente no son válidas.',
    {
      codigo: CODIGOS_ERROR_AUTENTICACION_AGENTE.CREDENCIALES_INVALIDAS,
      statusCode: 401
    }
  );
}

export function errorSesionNoViva(mensaje = 'La sesión técnica del agente ya no está viva.') {
  return new ErrorAutenticacionAgente(mensaje, {
    codigo: CODIGOS_ERROR_AUTENTICACION_AGENTE.SESION_NO_VIVA,
    statusCode: 403,
    accion: ACCIONES_AUTENTICACION_AGENTE.LOGIN_REQUIRED
  });
}

export function errorEstadoInconsistenteAgente(mensaje) {
  return new ErrorAutenticacionAgente(
    mensaje || 'El estado del agente es inconsistente con la sesión actual.',
    {
      codigo: CODIGOS_ERROR_AUTENTICACION_AGENTE.ESTADO_INCONSISTENTE,
      statusCode: 409,
      accion: ACCIONES_AUTENTICACION_AGENTE.LOGIN_REQUIRED
    }
  );
}

export function errorLoginAgenteEnProgreso() {
  return new ErrorAutenticacionAgente(
    'Ya hay un login técnico en curso para este agente.',
    {
      codigo: CODIGOS_ERROR_AUTENTICACION_AGENTE.LOGIN_EN_PROGRESO,
      statusCode: 409,
      accion: 'login_again'
    }
  );
}

export function errorSessionIdActualNoCoincide() {
  return new ErrorAutenticacionAgente(
    'La sesión declarada no coincide con la sesión técnica viva.',
    {
      codigo: CODIGOS_ERROR_AUTENTICACION_AGENTE.SESSION_ID_ACTUAL_NO_COINCIDE,
      statusCode: 409,
      accion: ACCIONES_AUTENTICACION_AGENTE.LOGIN_REQUIRED
    }
  );
}

export function errorBootIdIncoherente() {
  return new ErrorAutenticacionAgente(
    'El bootId del agente no coincide con la sesión técnica viva.',
    {
      codigo: CODIGOS_ERROR_AUTENTICACION_AGENTE.BOOT_ID_INCOHERENTE,
      statusCode: 409,
      accion: ACCIONES_AUTENTICACION_AGENTE.LOGIN_REQUIRED
    }
  );
}

export function errorHeartbeatSeqAntiguo() {
  return new ErrorAutenticacionAgente(
    'El heartbeat recibido es repetido o anterior al último latido aceptado.',
    {
      codigo: CODIGOS_ERROR_AUTENTICACION_AGENTE.HEARTBEAT_SEQ_ANTIGUO,
      statusCode: 409,
      accion: ACCIONES_AUTENTICACION_AGENTE.CONTINUE
    }
  );
}

export function errorRefreshConcurrente() {
  return new ErrorAutenticacionAgente(
    'Otra renovación reemplazó la sesión técnica de forma concurrente.',
    {
      codigo: CODIGOS_ERROR_AUTENTICACION_AGENTE.REFRESH_CONCURRENTE,
      statusCode: 409,
      accion: ACCIONES_AUTENTICACION_AGENTE.LOGIN_REQUIRED
    }
  );
}

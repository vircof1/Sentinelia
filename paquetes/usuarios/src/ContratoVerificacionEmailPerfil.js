import {
  CLASIFICACIONES_INTENTO_SMTP_CORREO,
  ESTADOS_SALIDA_CORREO
} from '../../correo/src/ContratoSalidaCorreo.js';
import { exigirBuzonCanonicoCorreo }
  from '../../correo/src/NormalizadorBuzonCorreo.js';
import { validarUuidV7Auditoria }
  from '../../auditoria/src/UuidV7Auditoria.js';

export const PERFIL_CONTRATO_VERIFICACION_EMAIL_PERFIL =
  'sentinelia-verificacion-email-perfil-v1';
export const VERSION_CONTRATO_VERIFICACION_EMAIL_PERFIL = 1;
export const ORIGEN_SALIDA_CORREO_VERIFICACION_EMAIL_PERFIL =
  'verificacion_email_perfil';

export const PERFILES_VERIFICACION_EMAIL_PERFIL = congelarProfundo({
  EMISION: 'verificacion_email_perfil@1/emision'
});

export const CLASES_EMISION_VERIFICACION_EMAIL_PERFIL = congelarProfundo({
  INICIAL: 'inicial',
  REENVIO: 'reenvio'
});

export const ESTADOS_AUTORIDAD_VERIFICACION_EMAIL_PERFIL = congelarProfundo({
  VIGENTE: 'vigente',
  OPERACION_SUSTITUIDA: 'operacion_sustituida',
  OPERACION_CONSUMIDA: 'operacion_consumida',
  OPERACION_EXPIRADA: 'operacion_expirada',
  IDENTIDAD_NO_VIGENTE: 'identidad_no_vigente',
  IDENTIDAD_DISTINTA: 'identidad_distinta',
  CREDENCIAL_CAMBIADA: 'credencial_cambiada',
  CORREO_ORIGEN_CAMBIADO: 'correo_origen_cambiado',
  PROPOSITO_AGOTADO: 'proposito_agotado',
  REDIS_NO_DISPONIBLE: 'redis_no_disponible',
  SQL_NO_DISPONIBLE: 'sql_no_disponible'
});

export const DECISIONES_INICIO_VERIFICACION_EMAIL_PERFIL = congelarProfundo({
  INICIAR_SMTP: 'iniciar_smtp',
  DESCARTAR: 'descartar',
  REINTENTAR: 'reintentar'
});

export const EFECTOS_OPERACION_VERIFICACION_EMAIL_PERFIL = congelarProfundo({
  CONSERVAR: 'conservar',
  INVALIDAR: 'invalidar'
});

export const EFECTOS_USUARIO_VERIFICACION_EMAIL_PERFIL = congelarProfundo({
  NINGUNO: 'ninguno',
  ESTABLECER_CANDIDATO_NO_VALIDADO: 'establecer_candidato_no_validado'
});

const PROPIEDADES_EMISION = Object.freeze([
  'perfil',
  'version',
  'operacionEmailPerfilId',
  'emisionEmailPerfilId',
  'clase',
  'usuarioId',
  'emailOrigen',
  'emailCandidato',
  'huellaCredencialOrigen'
]);

const CLASES = new Set(Object.values(CLASES_EMISION_VERIFICACION_EMAIL_PERFIL));
const ESTADOS_AUTORIDAD = new Set(
  Object.values(ESTADOS_AUTORIDAD_VERIFICACION_EMAIL_PERFIL)
);
const CLASIFICACIONES_SMTP = new Set(
  Object.values(CLASIFICACIONES_INTENTO_SMTP_CORREO)
);

export class ErrorContratoVerificacionEmailPerfil extends Error {
  constructor(
    mensaje,
    { codigo = 'contrato_verificacion_email_perfil_invalido', campo = null } = {}
  ) {
    super(mensaje);
    this.name = 'ErrorContratoVerificacionEmailPerfil';
    this.codigo = codigo;
    this.campo = campo;
  }
}

export function crearEmisionVerificacionEmailPerfil(entrada) {
  validarClavesExactas(entrada, PROPIEDADES_EMISION, 'emision');
  exigir(
    entrada.perfil === PERFILES_VERIFICACION_EMAIL_PERFIL.EMISION,
    'El perfil de la emisión no pertenece al contrato.',
    'emision.perfil'
  );
  exigir(
    entrada.version === VERSION_CONTRATO_VERIFICACION_EMAIL_PERFIL,
    'La versión de la emisión no pertenece al contrato.',
    'emision.version'
  );
  const operacionEmailPerfilId = exigirUuid(
    entrada.operacionEmailPerfilId,
    'emision.operacionEmailPerfilId'
  );
  const emisionEmailPerfilId = exigirUuidV7(
    entrada.emisionEmailPerfilId,
    'emision.emisionEmailPerfilId'
  );
  exigirEnum(entrada.clase, CLASES, 'emision.clase');
  const usuarioId = exigirIdDecimal(entrada.usuarioId, 'emision.usuarioId');
  const emailOrigen = exigirBuzonCanonico(
    entrada.emailOrigen,
    'emision.emailOrigen'
  );
  const emailCandidato = exigirBuzonCanonico(
    entrada.emailCandidato,
    'emision.emailCandidato'
  );
  const huellaCredencialOrigen = exigirHashSha256(
    entrada.huellaCredencialOrigen,
    'emision.huellaCredencialOrigen'
  );

  return congelarProfundo({
    perfil: entrada.perfil,
    version: entrada.version,
    operacionEmailPerfilId,
    emisionEmailPerfilId,
    clase: entrada.clase,
    usuarioId,
    emailOrigen,
    emailCandidato,
    huellaCredencialOrigen
  });
}

export function decidirInicioDespachoVerificacionEmailPerfil({
  estadoAutoridad
} = {}) {
  exigirEnum(estadoAutoridad, ESTADOS_AUTORIDAD, 'estadoAutoridad');
  if (estadoAutoridad === ESTADOS_AUTORIDAD_VERIFICACION_EMAIL_PERFIL.VIGENTE) {
    return congelarProfundo({
      decision: DECISIONES_INICIO_VERIFICACION_EMAIL_PERFIL.INICIAR_SMTP,
      causa: estadoAutoridad
    });
  }
  if ([
    ESTADOS_AUTORIDAD_VERIFICACION_EMAIL_PERFIL.REDIS_NO_DISPONIBLE,
    ESTADOS_AUTORIDAD_VERIFICACION_EMAIL_PERFIL.SQL_NO_DISPONIBLE
  ].includes(estadoAutoridad)) {
    return congelarProfundo({
      decision: DECISIONES_INICIO_VERIFICACION_EMAIL_PERFIL.REINTENTAR,
      causa: estadoAutoridad
    });
  }
  return congelarProfundo({
    decision: DECISIONES_INICIO_VERIFICACION_EMAIL_PERFIL.DESCARTAR,
    causa: estadoAutoridad
  });
}

export function decidirResultadoSmtpVerificacionEmailPerfil({
  claseEmision,
  clasificacionSmtp,
  candidatoDistinto
} = {}) {
  exigirEnum(claseEmision, CLASES, 'claseEmision');
  exigirEnum(clasificacionSmtp, CLASIFICACIONES_SMTP, 'clasificacionSmtp');
  exigir(
    typeof candidatoDistinto === 'boolean',
    'La relación entre origen y candidato debe ser booleana.',
    'candidatoDistinto'
  );

  const C = CLASIFICACIONES_INTENTO_SMTP_CORREO;
  if (clasificacionSmtp === C.ACEPTACION_DEMOSTRADA) {
    return resultado({ estadoSalida: ESTADOS_SALIDA_CORREO.ENVIADO });
  }
  if (clasificacionSmtp === C.FALLO_REINTENTABLE) {
    return resultado({
      estadoSalida: ESTADOS_SALIDA_CORREO.ERROR_REINTENTABLE,
      reintentar: true
    });
  }
  if (clasificacionSmtp === C.RESULTADO_AMBIGUO) {
    return resultado({ estadoSalida: ESTADOS_SALIDA_CORREO.RESULTADO_AMBIGUO });
  }

  const inicial =
    claseEmision === CLASES_EMISION_VERIFICACION_EMAIL_PERFIL.INICIAL;
  return resultado({
    estadoSalida: ESTADOS_SALIDA_CORREO.ERROR_FINAL,
    efectoOperacion: inicial
      ? EFECTOS_OPERACION_VERIFICACION_EMAIL_PERFIL.INVALIDAR
      : EFECTOS_OPERACION_VERIFICACION_EMAIL_PERFIL.CONSERVAR,
    efectoUsuario: inicial && candidatoDistinto
      ? EFECTOS_USUARIO_VERIFICACION_EMAIL_PERFIL
        .ESTABLECER_CANDIDATO_NO_VALIDADO
      : EFECTOS_USUARIO_VERIFICACION_EMAIL_PERFIL.NINGUNO
  });
}

function resultado({
  estadoSalida,
  reintentar = false,
  efectoOperacion = EFECTOS_OPERACION_VERIFICACION_EMAIL_PERFIL.CONSERVAR,
  efectoUsuario = EFECTOS_USUARIO_VERIFICACION_EMAIL_PERFIL.NINGUNO
}) {
  return congelarProfundo({
    estadoSalida,
    reintentar,
    efectoOperacion,
    efectoUsuario
  });
}

function validarClavesExactas(valor, esperadas, campo) {
  exigirObjetoPlano(valor, campo);
  const observadas = Object.keys(valor).sort();
  const requeridas = [...esperadas].sort();
  exigir(
    observadas.length === requeridas.length &&
      observadas.every((clave, indice) => clave === requeridas[indice]),
    `${campo} exige exactamente: ${requeridas.join(', ')}.`,
    campo
  );
}

function exigirObjetoPlano(valor, campo) {
  exigir(
    valor !== null &&
      typeof valor === 'object' &&
      !Array.isArray(valor) &&
      Object.getPrototypeOf(valor) === Object.prototype,
    `${campo} debe ser un objeto JSON plano.`,
    campo
  );
  for (const clave of Object.keys(valor)) {
    const descriptor = Object.getOwnPropertyDescriptor(valor, clave);
    exigir(
      descriptor && 'value' in descriptor,
      `${campo} no admite accessors.`,
      `${campo}.${clave}`
    );
  }
}

function exigirUuid(valor, campo) {
  exigir(
    typeof valor === 'string' &&
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u
        .test(valor),
    `${campo} debe ser un UUID canónico.`,
    campo
  );
  return valor;
}

function exigirUuidV7(valor, campo) {
  try {
    validarUuidV7Auditoria(valor, campo);
    return valor;
  } catch {
    exigir(false, `${campo} debe ser un UUIDv7 canónico.`, campo);
  }
}

function exigirIdDecimal(valor, campo) {
  exigir(
    typeof valor === 'string' && /^[1-9][0-9]*$/u.test(valor),
    `${campo} debe ser un identificador decimal positivo.`,
    campo
  );
  return valor;
}

function exigirBuzonCanonico(valor, campo) {
  try {
    return exigirBuzonCanonicoCorreo(valor);
  } catch {
    exigir(false, `${campo} debe usar la representación canónica de buzon@1.`, campo);
  }
}

function exigirHashSha256(valor, campo) {
  exigir(
    typeof valor === 'string' && /^[0-9a-f]{64}$/u.test(valor),
    `${campo} debe ser una huella SHA-256 hexadecimal.`,
    campo
  );
  return valor;
}

function exigirEnum(valor, permitidos, campo) {
  exigir(
    permitidos.has(valor),
    `${campo} no pertenece al vocabulario cerrado.`,
    campo
  );
  return valor;
}

function exigir(condicion, mensaje, campo) {
  if (!condicion) {
    throw new ErrorContratoVerificacionEmailPerfil(mensaje, { campo });
  }
}

function congelarProfundo(valor) {
  if (valor && typeof valor === 'object' && !Object.isFrozen(valor)) {
    for (const hijo of Object.values(valor)) congelarProfundo(hijo);
    Object.freeze(valor);
  }
  return valor;
}

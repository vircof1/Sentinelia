export const PERFIL_CONTRATO_REINICIO_PASSWORD_ADMINISTRATIVO =
  'sentinelia-reinicio-password-administrativo-v1';
export const VERSION_CONTRATO_REINICIO_PASSWORD_ADMINISTRATIVO = 1;

export const PERFILES_REINICIO_PASSWORD_ADMINISTRATIVO = congelarProfundo({
  COMANDO: 'reinicio_password_administrativo@1/comando',
  RESULTADO_DURABLE: 'reinicio_password_administrativo@1/resultado_durable',
  DECISION_VIA: 'reinicio_password_administrativo@1/decision_via',
  PROYECCION: 'reinicio_password_administrativo@1/proyeccion'
});

export const VIAS_REINICIO_PASSWORD_ADMINISTRATIVO = Object.freeze({
  CORREO: 'correo',
  MANUAL: 'manual'
});

export const RESULTADOS_DECISION_VIA_REINICIO_PASSWORD_ADMINISTRATIVO =
  Object.freeze({
    APLICABLE: 'aplicable',
    CONFLICTO_VIA: 'conflicto_via',
    NO_EVALUABLE: 'no_evaluable'
  });

export const ESTADOS_PROYECCION_REINICIO_PASSWORD_ADMINISTRATIVO =
  Object.freeze({
    APLICADO_MANUAL: 'aplicado_manual',
    PENDIENTE_ENVIO: 'pendiente_envio',
    ACEPTADO_SMTP: 'aceptado_smtp',
    ERROR_FINAL: 'error_final',
    RESULTADO_AMBIGUO: 'resultado_ambiguo',
    DESCARTADO: 'descartado',
    DETALLE_RETENIDO: 'detalle_retenido'
  });

export const CAUSAS_AUDITORIA_REINICIO_PASSWORD_ADMINISTRATIVO =
  Object.freeze({
    CORREO: 'administrador_via_correo',
    MANUAL: 'administrador_via_manual',
    HISTORICA: 'administrador'
  });

export const ORIGEN_SALIDA_CORREO_REINICIO_PASSWORD_ADMINISTRATIVO =
  'reinicio_password_administrativo';

export const PROPIEDADES_CONTRATO_REINICIO_PASSWORD_ADMINISTRATIVO =
  congelarProfundo({
    COMANDO: [
      'perfil', 'version', 'reinicioId', 'usuarioId', 'viaEsperada',
      'password', 'passwordConfirmacion'
    ],
    RESULTADO_DURABLE: [
      'perfil', 'version', 'reinicioId', 'usuarioId', 'via',
      'salidaCorreoId', 'eventoAuditoriaId', 'versionSesionResultante',
      'generacionRecuperacionResultante', 'aplicadoEnUtc'
    ],
    DECISION_VIA: [
      'perfil', 'version', 'resultado', 'viaEsperada', 'viaEfectiva'
    ],
    PROYECCION: [
      'perfil', 'version', 'reinicioId', 'usuarioId', 'via', 'estado',
      'aplicadoEnUtc'
    ],
    AUTORIDAD_VIA: ['evaluable', 'puedeDespachar', 'viaEsperada'],
    OBJETIVO: ['usuarioIdObjetivo', 'idUsuarioEfectivo', 'idUsuarioReal']
  });

const PATRON_UUID_V7 =
  /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const PATRON_ID_DECIMAL = /^[1-9][0-9]*$/u;
const PATRON_FECHA_UTC =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u;
const VIAS = new Set(Object.values(VIAS_REINICIO_PASSWORD_ADMINISTRATIVO));
const ESTADOS_PROYECCION = new Set(
  Object.values(ESTADOS_PROYECCION_REINICIO_PASSWORD_ADMINISTRATIVO)
);
const ESTADOS_SALIDA_EN_CURSO = new Set([
  'pendiente', 'reclamada', 'enviando', 'error_reintentable'
]);
const ESTADOS_SALIDA_TERMINALES = new Map([
  ['enviado', ESTADOS_PROYECCION_REINICIO_PASSWORD_ADMINISTRATIVO.ACEPTADO_SMTP],
  ['error_final', ESTADOS_PROYECCION_REINICIO_PASSWORD_ADMINISTRATIVO.ERROR_FINAL],
  [
    'resultado_ambiguo',
    ESTADOS_PROYECCION_REINICIO_PASSWORD_ADMINISTRATIVO.RESULTADO_AMBIGUO
  ],
  ['descartada', ESTADOS_PROYECCION_REINICIO_PASSWORD_ADMINISTRATIVO.DESCARTADO]
]);

export class ErrorContratoReinicioPasswordAdministrativo extends Error {
  constructor(
    mensaje,
    {
      codigo = 'contrato_reinicio_password_administrativo_invalido',
      campo = null
    } = {}
  ) {
    super(mensaje);
    this.name = 'ErrorContratoReinicioPasswordAdministrativo';
    this.codigo = codigo;
    this.campo = campo;
  }
}

export function crearComandoReinicioPasswordAdministrativo(entrada = {}) {
  validarClavesExactas(entrada, propiedades('COMANDO'), 'comando');
  exigirSinAccessors(entrada, 'comando');
  exigirPerfil(entrada, 'COMANDO');
  const reinicioId = exigirUuidV7(entrada.reinicioId, 'comando.reinicioId');
  const usuarioId = exigirId(entrada.usuarioId, 'comando.usuarioId');
  const viaEsperada = exigirEnum(
    entrada.viaEsperada,
    VIAS,
    'comando.viaEsperada'
  );

  if (viaEsperada === VIAS_REINICIO_PASSWORD_ADMINISTRATIVO.CORREO) {
    exigir(
      entrada.password === null && entrada.passwordConfirmacion === null,
      'La vía de correo no admite una contraseña aportada por el operador.',
      'comando.password'
    );
  } else {
    exigirPasswordPrivada(entrada.password, 'comando.password');
    exigirPasswordPrivada(
      entrada.passwordConfirmacion,
      'comando.passwordConfirmacion'
    );
    exigir(
      entrada.password === entrada.passwordConfirmacion,
      'La confirmación de la contraseña provisional no coincide.',
      'comando.passwordConfirmacion'
    );
  }

  return congelarProfundo({
    perfil: PERFILES_REINICIO_PASSWORD_ADMINISTRATIVO.COMANDO,
    version: VERSION_CONTRATO_REINICIO_PASSWORD_ADMINISTRATIVO,
    reinicioId,
    usuarioId,
    viaEsperada,
    password: entrada.password,
    passwordConfirmacion: entrada.passwordConfirmacion
  });
}

export function crearResultadoDurableReinicioPasswordAdministrativo(
  entrada = {}
) {
  validarClavesExactas(
    entrada,
    propiedades('RESULTADO_DURABLE'),
    'resultadoDurable'
  );
  exigirSinAccessors(entrada, 'resultadoDurable');
  exigirPerfil(entrada, 'RESULTADO_DURABLE');
  const reinicioId = exigirUuidV7(
    entrada.reinicioId,
    'resultadoDurable.reinicioId'
  );
  const usuarioId = exigirId(entrada.usuarioId, 'resultadoDurable.usuarioId');
  const via = exigirEnum(entrada.via, VIAS, 'resultadoDurable.via');
  const salidaCorreoId = entrada.salidaCorreoId === null
    ? null
    : exigirId(entrada.salidaCorreoId, 'resultadoDurable.salidaCorreoId');
  exigir(
    via === VIAS_REINICIO_PASSWORD_ADMINISTRATIVO.CORREO ||
      salidaCorreoId === null,
    'La vía manual no admite una salida de correo.',
    'resultadoDurable.salidaCorreoId'
  );

  return congelarProfundo({
    perfil: PERFILES_REINICIO_PASSWORD_ADMINISTRATIVO.RESULTADO_DURABLE,
    version: VERSION_CONTRATO_REINICIO_PASSWORD_ADMINISTRATIVO,
    reinicioId,
    usuarioId,
    via,
    salidaCorreoId,
    eventoAuditoriaId: exigirUuidV7(
      entrada.eventoAuditoriaId,
      'resultadoDurable.eventoAuditoriaId'
    ),
    versionSesionResultante: exigirDecimalPositivo(
      entrada.versionSesionResultante,
      'resultadoDurable.versionSesionResultante'
    ),
    generacionRecuperacionResultante: exigirDecimalPositivo(
      entrada.generacionRecuperacionResultante,
      'resultadoDurable.generacionRecuperacionResultante'
    ),
    aplicadoEnUtc: exigirFechaUtc(
      entrada.aplicadoEnUtc,
      'resultadoDurable.aplicadoEnUtc'
    )
  });
}

export function decidirViaReinicioPasswordAdministrativo(entrada = {}) {
  validarClavesExactas(entrada, propiedades('AUTORIDAD_VIA'), 'autoridadVia');
  exigirSinAccessors(entrada, 'autoridadVia');
  exigir(typeof entrada.evaluable === 'boolean', 'evaluable debe ser booleano.', 'autoridadVia.evaluable');
  const viaEsperada = exigirEnum(
    entrada.viaEsperada,
    VIAS,
    'autoridadVia.viaEsperada'
  );

  let resultado;
  let viaEfectiva;
  if (!entrada.evaluable) {
    exigir(
      entrada.puedeDespachar === null,
      'Una autoridad no evaluable no puede afirmar operatividad.',
      'autoridadVia.puedeDespachar'
    );
    resultado =
      RESULTADOS_DECISION_VIA_REINICIO_PASSWORD_ADMINISTRATIVO.NO_EVALUABLE;
    viaEfectiva = null;
  } else {
    exigir(
      typeof entrada.puedeDespachar === 'boolean',
      'Una autoridad evaluable debe resolver puedeDespachar.',
      'autoridadVia.puedeDespachar'
    );
    viaEfectiva = entrada.puedeDespachar
      ? VIAS_REINICIO_PASSWORD_ADMINISTRATIVO.CORREO
      : VIAS_REINICIO_PASSWORD_ADMINISTRATIVO.MANUAL;
    resultado = viaEfectiva === viaEsperada
      ? RESULTADOS_DECISION_VIA_REINICIO_PASSWORD_ADMINISTRATIVO.APLICABLE
      : RESULTADOS_DECISION_VIA_REINICIO_PASSWORD_ADMINISTRATIVO.CONFLICTO_VIA;
  }

  return congelarProfundo({
    perfil: PERFILES_REINICIO_PASSWORD_ADMINISTRATIVO.DECISION_VIA,
    version: VERSION_CONTRATO_REINICIO_PASSWORD_ADMINISTRATIVO,
    resultado,
    viaEsperada,
    viaEfectiva
  });
}

export function exigirObjetivoAjenoReinicioPasswordAdministrativo(entrada = {}) {
  validarClavesExactas(entrada, propiedades('OBJETIVO'), 'objetivo');
  const usuarioIdObjetivo = exigirId(
    entrada.usuarioIdObjetivo,
    'objetivo.usuarioIdObjetivo'
  );
  const idUsuarioEfectivo = exigirId(
    entrada.idUsuarioEfectivo,
    'objetivo.idUsuarioEfectivo'
  );
  const idUsuarioReal = entrada.idUsuarioReal === null
    ? null
    : exigirId(entrada.idUsuarioReal, 'objetivo.idUsuarioReal');
  exigir(
    usuarioIdObjetivo !== idUsuarioEfectivo &&
      usuarioIdObjetivo !== idUsuarioReal,
    'El reinicio administrativo no admite la identidad propia real o efectiva.',
    'objetivo.usuarioIdObjetivo',
    'reinicio_password_administrativo_objetivo_propio'
  );
  return usuarioIdObjetivo;
}

export function exigirReplayCompatibleReinicioPasswordAdministrativo({
  comando,
  resultado
} = {}) {
  const intencion = crearComandoReinicioPasswordAdministrativo(comando);
  const confirmado =
    crearResultadoDurableReinicioPasswordAdministrativo(resultado);
  exigir(
    intencion.reinicioId === confirmado.reinicioId &&
      intencion.usuarioId === confirmado.usuarioId &&
      intencion.viaEsperada === confirmado.via,
    'El reinicioId ya pertenece a otra intención administrativa.',
    'reinicioId',
    'conflicto_idempotencia_reinicio_password_administrativo'
  );
  return confirmado;
}

export function seleccionarUltimoReinicioPasswordAdministrativo(resultados) {
  exigir(
    Array.isArray(resultados) && resultados.length > 0,
    'Se necesita al menos un resultado durable.',
    'resultados'
  );
  const validados = resultados.map((resultado) =>
    crearResultadoDurableReinicioPasswordAdministrativo(resultado)
  );
  const usuarioId = validados[0].usuarioId;
  exigir(
    validados.every((resultado) => resultado.usuarioId === usuarioId),
    'No pueden ordenarse conjuntamente reinicios de identidades diferentes.',
    'resultados'
  );
  const ordenados = [...validados].sort((a, b) =>
    compararDecimales(a.versionSesionResultante, b.versionSesionResultante)
  );
  const ultimo = ordenados.at(-1);
  const anterior = ordenados.at(-2);
  exigir(
    !anterior ||
      anterior.versionSesionResultante !== ultimo.versionSesionResultante ||
      anterior.reinicioId === ultimo.reinicioId,
    'Dos reinicios distintos no pueden confirmar la misma version_sesion.',
    'resultados'
  );
  return ultimo;
}

export function proyectarReinicioPasswordAdministrativo({
  resultado,
  estadoSalidaCorreo = null,
  detalleRetenido = false
} = {}) {
  const confirmado =
    crearResultadoDurableReinicioPasswordAdministrativo(resultado);
  exigir(
    typeof detalleRetenido === 'boolean',
    'detalleRetenido debe ser booleano.',
    'detalleRetenido'
  );
  let estado;
  if (confirmado.via === VIAS_REINICIO_PASSWORD_ADMINISTRATIVO.MANUAL) {
    exigir(
      estadoSalidaCorreo === null && !detalleRetenido,
      'La vía manual no admite estado de correo.',
      'estadoSalidaCorreo'
    );
    estado =
      ESTADOS_PROYECCION_REINICIO_PASSWORD_ADMINISTRATIVO.APLICADO_MANUAL;
  } else if (detalleRetenido) {
    exigir(
      confirmado.salidaCorreoId === null && estadoSalidaCorreo === null,
      'Un detalle retenido ya no conserva salida ni estado SMTP.',
      'estadoSalidaCorreo'
    );
    estado =
      ESTADOS_PROYECCION_REINICIO_PASSWORD_ADMINISTRATIVO.DETALLE_RETENIDO;
  } else if (ESTADOS_SALIDA_EN_CURSO.has(estadoSalidaCorreo)) {
    exigir(
      confirmado.salidaCorreoId !== null,
      'Una salida en curso debe conservar su identidad.',
      'resultado.salidaCorreoId'
    );
    estado =
      ESTADOS_PROYECCION_REINICIO_PASSWORD_ADMINISTRATIVO.PENDIENTE_ENVIO;
  } else {
    exigir(
      confirmado.salidaCorreoId !== null,
      'Una salida terminal debe conservar su identidad hasta la retención.',
      'resultado.salidaCorreoId'
    );
    estado = ESTADOS_SALIDA_TERMINALES.get(estadoSalidaCorreo);
    exigir(
      Boolean(estado),
      'El estado de salida no puede proyectarse.',
      'estadoSalidaCorreo'
    );
  }
  exigir(
    ESTADOS_PROYECCION.has(estado),
    'El estado proyectado no pertenece al contrato.',
    'estado'
  );
  return congelarProfundo({
    perfil: PERFILES_REINICIO_PASSWORD_ADMINISTRATIVO.PROYECCION,
    version: VERSION_CONTRATO_REINICIO_PASSWORD_ADMINISTRATIVO,
    reinicioId: confirmado.reinicioId,
    usuarioId: confirmado.usuarioId,
    via: confirmado.via,
    estado,
    aplicadoEnUtc: confirmado.aplicadoEnUtc
  });
}

export function redactarValorReinicioPasswordAdministrativo(valor) {
  if (Array.isArray(valor)) {
    return Object.freeze(valor.map(redactarValorReinicioPasswordAdministrativo));
  }
  if (!esObjetoPlano(valor)) return valor;
  const salida = {};
  for (const [clave, contenido] of Object.entries(valor)) {
    if (/password|secreto|hash|cuerpo/iu.test(clave)) {
      salida[clave] = '[REDACTADO]';
    } else {
      salida[clave] = redactarValorReinicioPasswordAdministrativo(contenido);
    }
  }
  return congelarProfundo(salida);
}

function exigirPerfil(entrada, clave) {
  exigir(
    entrada.perfil === PERFILES_REINICIO_PASSWORD_ADMINISTRATIVO[clave],
    'El perfil no pertenece al contrato de reinicio administrativo.',
    'perfil'
  );
  exigir(
    entrada.version === VERSION_CONTRATO_REINICIO_PASSWORD_ADMINISTRATIVO,
    'La versión no pertenece al contrato de reinicio administrativo.',
    'version'
  );
}

function propiedades(clave) {
  return PROPIEDADES_CONTRATO_REINICIO_PASSWORD_ADMINISTRATIVO[clave];
}

function exigirUuidV7(valor, campo) {
  exigir(
    typeof valor === 'string' && PATRON_UUID_V7.test(valor),
    'Se esperaba un UUIDv7 textual canónico.',
    campo
  );
  return valor;
}

function exigirId(valor, campo) {
  const canonico = typeof valor === 'number' && Number.isSafeInteger(valor)
    ? String(valor)
    : valor;
  exigir(
    typeof canonico === 'string' && PATRON_ID_DECIMAL.test(canonico),
    'Se esperaba un identificador decimal positivo.',
    campo
  );
  return canonico;
}

function exigirDecimalPositivo(valor, campo) {
  const canonico = typeof valor === 'number' && Number.isSafeInteger(valor)
    ? String(valor)
    : valor;
  exigir(
    typeof canonico === 'string' && PATRON_ID_DECIMAL.test(canonico),
    'Se esperaba una versión decimal positiva canónica.',
    campo
  );
  return canonico;
}

function exigirFechaUtc(valor, campo) {
  exigir(
    typeof valor === 'string' &&
      PATRON_FECHA_UTC.test(valor) &&
      Number.isFinite(Date.parse(valor)),
    'Se esperaba una fecha UTC canónica con milisegundos.',
    campo
  );
  return valor;
}

function exigirPasswordPrivada(valor, campo) {
  exigir(
    typeof valor === 'string' && valor.length > 0,
    'La contraseña provisional debe ser texto no vacío.',
    campo
  );
  exigir(
    Buffer.byteLength(valor, 'utf8') <= 72,
    'La contraseña provisional no puede superar 72 bytes UTF-8.',
    campo
  );
  return valor;
}

function exigirEnum(valor, conjunto, campo) {
  exigir(conjunto.has(valor), 'El valor no pertenece al contrato.', campo);
  return valor;
}

function validarClavesExactas(valor, esperadas, campo) {
  exigir(esObjetoPlano(valor), 'Se esperaba un objeto plano.', campo);
  const actuales = Object.keys(valor).sort();
  const requeridas = [...esperadas].sort();
  exigir(
    actuales.length === requeridas.length &&
      actuales.every((clave, indice) => clave === requeridas[indice]),
    'El objeto exige exactamente las propiedades del contrato.',
    campo
  );
}

function exigirSinAccessors(valor, campo) {
  for (const [clave, descriptor] of Object.entries(
    Object.getOwnPropertyDescriptors(valor)
  )) {
    exigir(
      typeof descriptor.get !== 'function' && typeof descriptor.set !== 'function',
      'El contrato no admite accessors.',
      campo + '.' + clave
    );
  }
}

function compararDecimales(a, b) {
  const izquierda = BigInt(a);
  const derecha = BigInt(b);
  return izquierda < derecha ? -1 : izquierda > derecha ? 1 : 0;
}

function esObjetoPlano(valor) {
  if (!valor || typeof valor !== 'object' || Array.isArray(valor)) return false;
  const prototipo = Object.getPrototypeOf(valor);
  return prototipo === Object.prototype || prototipo === null;
}

function congelarProfundo(valor) {
  if (valor && typeof valor === 'object' && !Object.isFrozen(valor)) {
    for (const contenido of Object.values(valor)) congelarProfundo(contenido);
    Object.freeze(valor);
  }
  return valor;
}

function exigir(
  condicion,
  mensaje,
  campo = null,
  codigo = 'contrato_reinicio_password_administrativo_invalido'
) {
  if (!condicion) {
    throw new ErrorContratoReinicioPasswordAdministrativo(mensaje, {
      codigo,
      campo
    });
  }
}

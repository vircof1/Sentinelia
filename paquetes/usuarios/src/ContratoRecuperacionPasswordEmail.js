import { createHash } from 'node:crypto';

import { exigirBuzonCanonicoCorreo } from '../../correo/src/NormalizadorBuzonCorreo.js';
import {
  PROPOSITOS_SALIDA_CORREO_RECUPERACION_PASSWORD
} from '../../correo/src/ContratoSalidaCorreo.js';

export const PERFIL_CONTRATO_RECUPERACION_PASSWORD_EMAIL =
  'sentinelia-recuperacion-password-email-v1';
export const VERSION_CONTRATO_RECUPERACION_PASSWORD_EMAIL = 1;

export const PERFILES_RECUPERACION_PASSWORD_EMAIL = congelarProfundo({
  SOLICITUD: 'recuperacion_password@1/solicitud',
  FRONTERA: 'recuperacion_password@1/frontera',
  ALEGACION: 'recuperacion_password@1/alegacion',
  RESERVA: 'recuperacion_password@1/reserva',
  ADMISION: 'recuperacion_password@1/admision',
  MENSAJE: 'recuperacion_password@1/mensaje',
  RESULTADO_PUBLICO: 'recuperacion_password@1/resultado_publico'
});

export const ESTADOS_SOLICITUD_RECUPERACION_PASSWORD_EMAIL = Object.freeze({
  PREPARADA: 'preparada',
  ACTIVA: 'activa',
  CONSUMIENDO: 'consumiendo',
  CONSUMIDA: 'consumida'
});

export const ESTADOS_TERMINALES_SOLICITUD_RECUPERACION_PASSWORD_EMAIL =
  Object.freeze([ESTADOS_SOLICITUD_RECUPERACION_PASSWORD_EMAIL.CONSUMIDA]);

export const ESTADOS_IDENTIDAD_FRONTERA_RECUPERACION_PASSWORD_EMAIL =
  Object.freeze({
    UTILIZABLE: 'utilizable',
    RETIRADA: 'retirada'
  });

export const TIPOS_RESERVA_RECUPERACION_PASSWORD_EMAIL = Object.freeze({
  ALEGACION: 'alegacion',
  CONSUMO: 'consumo'
});

export const RESULTADOS_ADMISION_RECUPERACION_PASSWORD_EMAIL = Object.freeze({
  EMITIDA: 'emitida',
  SIN_IDENTIDADES: 'sin_identidades',
  SATURADA: 'saturada',
  INDISPONIBLE: 'indisponible'
});

export const RESULTADOS_ALEGACION_RECUPERACION_PASSWORD_EMAIL = Object.freeze({
  RESUELTA: 'resuelta',
  NO_RESUELTA: 'no_resuelta',
  PRESUPUESTO_AGOTADO: 'presupuesto_agotado'
});

export const PROPOSITOS_CORREO_RECUPERACION_PASSWORD_EMAIL =
  PROPOSITOS_SALIDA_CORREO_RECUPERACION_PASSWORD;

export const DOMINIOS_HUELLA_RECUPERACION_PASSWORD_EMAIL = Object.freeze({
  TOKEN: 'token',
  NOMBRE_ALEGADO: 'nombre_alegado',
  BUZON_ORIGEN: 'buzon_origen'
});

export const RESULTADOS_PUBLICOS_RECUPERACION_PASSWORD_EMAIL =
  congelarProfundo({
    SOLICITUD_RECIBIDA: {
      estadoHttp: 202,
      codigo: 'recuperacion_solicitud_recibida',
      mensaje:
        'Si existen cuentas recuperables asociadas, recibirás las instrucciones necesarias.'
    },
    ADMISION_SATURADA: {
      estadoHttp: 429,
      codigo: 'recuperacion_temporalmente_limitada',
      mensaje: 'No se puede admitir otra solicitud en este momento.'
    },
    PLATAFORMA_NO_DISPONIBLE: {
      estadoHttp: 503,
      codigo: 'recuperacion_no_disponible',
      mensaje: 'La recuperación no está disponible temporalmente.'
    },
    ALEGACION_NO_RESUELTA: {
      estadoHttp: 400,
      codigo: 'recuperacion_identidad_no_resuelta',
      mensaje: 'No se ha podido resolver la cuenta indicada.'
    },
    ALEGACION_RESUELTA: {
      estadoHttp: 200,
      codigo: 'recuperacion_identidad_resuelta',
      mensaje: 'La cuenta ha sido resuelta para esta solicitud.'
    },
    SOLICITUD_NO_UTILIZABLE: {
      estadoHttp: 410,
      codigo: 'recuperacion_solicitud_no_utilizable',
      mensaje: 'La solicitud no está disponible.'
    },
    PASSWORD_SUSTITUIDA: {
      estadoHttp: 200,
      codigo: 'recuperacion_password_sustituida',
      mensaje: 'La contraseña se ha sustituido correctamente.'
    }
  });

export const LIMITES_CONTRATO_RECUPERACION_PASSWORD_EMAIL = Object.freeze({
  PRESUPUESTO_ALEGACIONES_MINIMO: 1,
  PRESUPUESTO_ALEGACIONES_MAXIMO: 20,
  ASUNTO_CARACTERES: 255,
  CUERPO_UTF8_BYTES: 60 * 1024,
  BUZON_UTF8_BYTES: 190,
  URL_CARACTERES: 4096
});

export const PLANTILLAS_CORREO_RECUPERACION_PASSWORD_EMAIL =
  congelarProfundo({
    [PROPOSITOS_CORREO_RECUPERACION_PASSWORD_EMAIL.TRANSPORTAR_SOLICITUD]: {
      asunto: '[{{portal}}] Recuperación de contraseña',
      cuerpo:
        'Se solicitó recuperar una contraseña el {{emitidaEnUtc}}.\n' +
        'La solicitud caduca el {{expiraEnUtc}} (UTC).\n\n' +
        'Continúa desde este enlace:\n{{urlRecuperacion}}\n\n' +
        'Si no realizaste esta solicitud, puedes ignorar este mensaje.'
    },
    [PROPOSITOS_CORREO_RECUPERACION_PASSWORD_EMAIL.NOTIFICAR_CAMBIO]: {
      asunto: '[{{portal}}] Contraseña sustituida',
      cuerpo:
        'La contraseña de la cuenta {{usuario}} se sustituyó el {{cambiadaEnUtc}} (UTC).\n\n' +
        'Si no reconoces esta operación, contacta con quien administre tu acceso.'
    }
  });

export const PROPIEDADES_CONTRATO_RECUPERACION_PASSWORD_EMAIL =
  congelarProfundo({
    MIEMBRO_FRONTERA: [
      'usuarioId', 'generacionRecuperacionObservada', 'estado'
    ],
    FRONTERA: ['perfil', 'version', 'miembros'],
    SOLICITUD: [
      'perfil', 'version', 'solicitudId', 'buzonCanonico',
      'tokenHashSha256', 'frontera', 'estado', 'emitidaEnUtc',
      'expiraEnUtc', 'presupuestoMaximo', 'presupuestoRestante',
      'huellasAlegadas', 'usuarioIdVinculado', 'huellaNombreVinculado',
      'reserva'
    ],
    ALEGACION: [
      'perfil', 'version', 'huellaNombreSha256', 'resultado',
      'usuarioIdResuelto', 'repetida', 'consumePresupuesto'
    ],
    RESERVA: [
      'perfil', 'version', 'reservaId', 'tipo', 'creadaEnUtc', 'venceEnUtc'
    ],
    ADMISION: ['perfil', 'version', 'resultado'],
    MENSAJE: [
      'perfil', 'version', 'proposito', 'solicitudId', 'buzonCanonico',
      'asunto', 'cuerpoTexto'
    ],
    RESULTADO_PUBLICO: ['perfil', 'version', 'estadoHttp', 'codigo', 'mensaje']
  });

const PATRON_UUID_V7 =
  /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const PATRON_ID_DECIMAL = /^[1-9][0-9]*$/u;
const PATRON_GENERACION_DECIMAL = /^[1-9][0-9]*$/u;
const PATRON_HASH_SHA256 = /^[0-9a-f]{64}$/u;
const PATRON_FECHA_UTC =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u;
const ESTADOS = new Set(Object.values(ESTADOS_SOLICITUD_RECUPERACION_PASSWORD_EMAIL));
const ESTADOS_IDENTIDAD = new Set(
  Object.values(ESTADOS_IDENTIDAD_FRONTERA_RECUPERACION_PASSWORD_EMAIL)
);
const TIPOS_RESERVA = new Set(Object.values(TIPOS_RESERVA_RECUPERACION_PASSWORD_EMAIL));
const RESULTADOS_ADMISION = new Set(
  Object.values(RESULTADOS_ADMISION_RECUPERACION_PASSWORD_EMAIL)
);
const RESULTADOS_ALEGACION = new Set(
  Object.values(RESULTADOS_ALEGACION_RECUPERACION_PASSWORD_EMAIL)
);
const PROPOSITOS = new Set(
  Object.values(PROPOSITOS_CORREO_RECUPERACION_PASSWORD_EMAIL)
);
const DOMINIOS_HUELLA = new Set(
  Object.values(DOMINIOS_HUELLA_RECUPERACION_PASSWORD_EMAIL)
);

export class ErrorContratoRecuperacionPasswordEmail extends Error {
  constructor(
    mensaje,
    { codigo = 'contrato_recuperacion_password_invalido', campo = null } = {}
  ) {
    super(mensaje);
    this.name = 'ErrorContratoRecuperacionPasswordEmail';
    this.codigo = codigo;
    this.campo = campo;
  }
}

export function crearFronteraRecuperacionPasswordEmail(entrada) {
  validarClavesExactas(entrada, propiedades('FRONTERA'), 'frontera');
  exigirPerfil(entrada, 'FRONTERA');
  exigirArray(entrada.miembros, 'frontera.miembros');
  exigir(
    entrada.miembros.length > 0,
    'La frontera debe contener al menos una identidad elegible.',
    'frontera.miembros'
  );

  const miembros = entrada.miembros.map((miembro, indice) =>
    crearMiembroFrontera(miembro, `frontera.miembros[${indice}]`)
  );
  const ids = new Set(miembros.map(({ usuarioId }) => usuarioId));
  exigir(ids.size === miembros.length, 'La frontera no admite identidades repetidas.', 'frontera.miembros');

  miembros.sort((a, b) => compararDecimales(a.usuarioId, b.usuarioId));
  return congelarProfundo({
    perfil: PERFILES_RECUPERACION_PASSWORD_EMAIL.FRONTERA,
    version: VERSION_CONTRATO_RECUPERACION_PASSWORD_EMAIL,
    miembros
  });
}

export function crearSolicitudRecuperacionPasswordEmail(entrada) {
  validarClavesExactas(entrada, propiedades('SOLICITUD'), 'solicitud');
  exigirPerfil(entrada, 'SOLICITUD');
  exigirUuidV7(entrada.solicitudId, 'solicitud.solicitudId');
  const buzonCanonico = exigirBuzonCanonicoCorreo(entrada.buzonCanonico);
  exigirHash(entrada.tokenHashSha256, 'solicitud.tokenHashSha256');
  const frontera = crearFronteraRecuperacionPasswordEmail(entrada.frontera);
  exigirEnum(entrada.estado, ESTADOS, 'solicitud.estado');
  const presupuestoMaximo = exigirEnteroAcotado(
    entrada.presupuestoMaximo,
    LIMITES_CONTRATO_RECUPERACION_PASSWORD_EMAIL.PRESUPUESTO_ALEGACIONES_MINIMO,
    LIMITES_CONTRATO_RECUPERACION_PASSWORD_EMAIL.PRESUPUESTO_ALEGACIONES_MAXIMO,
    'solicitud.presupuestoMaximo'
  );
  const presupuestoRestante = exigirEnteroAcotado(
    entrada.presupuestoRestante,
    0,
    presupuestoMaximo,
    'solicitud.presupuestoRestante'
  );
  exigirArray(entrada.huellasAlegadas, 'solicitud.huellasAlegadas');
  const huellasAlegadas = entrada.huellasAlegadas.map((huella, indice) =>
    exigirHash(huella, `solicitud.huellasAlegadas[${indice}]`)
  );
  exigir(
    new Set(huellasAlegadas).size === huellasAlegadas.length,
    'Las alegaciones consolidadas no pueden repetirse.',
    'solicitud.huellasAlegadas'
  );
  exigir(
    huellasAlegadas.length <= presupuestoMaximo - presupuestoRestante,
    'El historial de alegaciones no es compatible con el presupuesto consumido.',
    'solicitud.huellasAlegadas'
  );

  const usuarioIdVinculado = entrada.usuarioIdVinculado === null
    ? null
    : exigirId(entrada.usuarioIdVinculado, 'solicitud.usuarioIdVinculado');
  const huellaNombreVinculado = entrada.huellaNombreVinculado === null
    ? null
    : exigirHash(
      entrada.huellaNombreVinculado,
      'solicitud.huellaNombreVinculado'
    );
  exigir(
    (usuarioIdVinculado === null) === (huellaNombreVinculado === null),
    'La identidad vinculada y la equivalencia que la resolvió nacen y se extinguen juntas.',
    'solicitud.huellaNombreVinculado'
  );
  if (usuarioIdVinculado !== null) {
    exigir(
      frontera.miembros.some(
        (miembro) => miembro.usuarioId === usuarioIdVinculado
      ),
      'La identidad vinculada debe pertenecer a la frontera original.',
      'solicitud.usuarioIdVinculado'
    );
  }

  const reserva = entrada.reserva === null
    ? null
    : crearReservaRecuperacionPasswordEmail(entrada.reserva);
  validarCoherenciaEstado({
    estado: entrada.estado,
    emitidaEnUtc: entrada.emitidaEnUtc,
    expiraEnUtc: entrada.expiraEnUtc,
    reserva,
    usuarioIdVinculado
  });

  return congelarProfundo({
    perfil: PERFILES_RECUPERACION_PASSWORD_EMAIL.SOLICITUD,
    version: VERSION_CONTRATO_RECUPERACION_PASSWORD_EMAIL,
    solicitudId: entrada.solicitudId,
    buzonCanonico,
    tokenHashSha256: entrada.tokenHashSha256,
    frontera,
    estado: entrada.estado,
    emitidaEnUtc: entrada.emitidaEnUtc,
    expiraEnUtc: entrada.expiraEnUtc,
    presupuestoMaximo,
    presupuestoRestante,
    huellasAlegadas: [...huellasAlegadas].sort(),
    usuarioIdVinculado,
    huellaNombreVinculado,
    reserva
  });
}

export function crearAlegacionRecuperacionPasswordEmail(entrada) {
  validarClavesExactas(entrada, propiedades('ALEGACION'), 'alegacion');
  exigirPerfil(entrada, 'ALEGACION');
  exigirHash(entrada.huellaNombreSha256, 'alegacion.huellaNombreSha256');
  exigirEnum(entrada.resultado, RESULTADOS_ALEGACION, 'alegacion.resultado');
  exigirBooleano(entrada.repetida, 'alegacion.repetida');
  exigirBooleano(entrada.consumePresupuesto, 'alegacion.consumePresupuesto');
  const usuarioIdResuelto = entrada.usuarioIdResuelto === null
    ? null
    : exigirId(entrada.usuarioIdResuelto, 'alegacion.usuarioIdResuelto');
  exigir(
    (entrada.resultado === RESULTADOS_ALEGACION_RECUPERACION_PASSWORD_EMAIL.RESUELTA) ===
      (usuarioIdResuelto !== null),
    'Solo una alegación resuelta identifica una cuenta.',
    'alegacion.usuarioIdResuelto'
  );
  exigir(
    entrada.consumePresupuesto === (!entrada.repetida &&
      entrada.resultado !==
        RESULTADOS_ALEGACION_RECUPERACION_PASSWORD_EMAIL.PRESUPUESTO_AGOTADO),
    'El consumo debe corresponder exclusivamente a una alegación distinta evaluada.',
    'alegacion.consumePresupuesto'
  );
  return congelarProfundo({ ...entrada });
}

export function crearReservaRecuperacionPasswordEmail(entrada) {
  validarClavesExactas(entrada, propiedades('RESERVA'), 'reserva');
  exigirPerfil(entrada, 'RESERVA');
  exigirUuidV7(entrada.reservaId, 'reserva.reservaId');
  exigirEnum(entrada.tipo, TIPOS_RESERVA, 'reserva.tipo');
  exigirFechaUtc(entrada.creadaEnUtc, 'reserva.creadaEnUtc');
  exigirFechaUtc(entrada.venceEnUtc, 'reserva.venceEnUtc');
  exigir(
    Date.parse(entrada.venceEnUtc) > Date.parse(entrada.creadaEnUtc),
    'La reserva debe vencer después de su creación.',
    'reserva.venceEnUtc'
  );
  return congelarProfundo({ ...entrada });
}

export function crearDecisionAdmisionRecuperacionPasswordEmail(entrada) {
  validarClavesExactas(entrada, propiedades('ADMISION'), 'admision');
  exigirPerfil(entrada, 'ADMISION');
  exigirEnum(entrada.resultado, RESULTADOS_ADMISION, 'admision.resultado');
  return congelarProfundo({ ...entrada });
}

export function crearMensajeRecuperacionPasswordEmail(entrada) {
  validarClavesExactas(entrada, propiedades('MENSAJE'), 'mensaje');
  exigirPerfil(entrada, 'MENSAJE');
  exigirEnum(entrada.proposito, PROPOSITOS, 'mensaje.proposito');
  exigirUuidV7(entrada.solicitudId, 'mensaje.solicitudId');
  const buzonCanonico = exigirBuzonCanonicoCorreo(entrada.buzonCanonico);
  exigirTextoAcotado(
    entrada.asunto,
    LIMITES_CONTRATO_RECUPERACION_PASSWORD_EMAIL.ASUNTO_CARACTERES,
    'mensaje.asunto'
  );
  exigirTextoUtf8Acotado(
    entrada.cuerpoTexto,
    LIMITES_CONTRATO_RECUPERACION_PASSWORD_EMAIL.CUERPO_UTF8_BYTES,
    'mensaje.cuerpoTexto'
  );
  return congelarProfundo({ ...entrada, buzonCanonico });
}

export function activarSolicitudRecuperacionPasswordEmail(
  solicitud,
  { emitidaEnUtc, expiraEnUtc }
) {
  const actual = crearSolicitudRecuperacionPasswordEmail(solicitud);
  exigir(
    actual.estado === ESTADOS_SOLICITUD_RECUPERACION_PASSWORD_EMAIL.PREPARADA,
    'Solo una solicitud preparada puede activarse.',
    'solicitud.estado'
  );
  exigirFechaUtc(emitidaEnUtc, 'emitidaEnUtc');
  exigirFechaUtc(expiraEnUtc, 'expiraEnUtc');
  exigir(
    Date.parse(expiraEnUtc) > Date.parse(emitidaEnUtc),
    'La expiración debe ser posterior a la emisión.',
    'expiraEnUtc'
  );
  return crearSolicitudRecuperacionPasswordEmail({
    ...actual,
    estado: ESTADOS_SOLICITUD_RECUPERACION_PASSWORD_EMAIL.ACTIVA,
    emitidaEnUtc,
    expiraEnUtc
  });
}

export function retirarIdentidadRecuperacionPasswordEmail(solicitud, usuarioId) {
  const actual = exigirSolicitudMutable(solicitud);
  const id = exigirId(usuarioId, 'usuarioId');
  exigir(
    actual.frontera.miembros.some((miembro) => miembro.usuarioId === id),
    'No puede retirarse una identidad ajena a la frontera original.',
    'usuarioId'
  );
  exigir(
    actual.estado !== ESTADOS_SOLICITUD_RECUPERACION_PASSWORD_EMAIL.CONSUMIENDO,
    'La frontera no puede modificarse durante un consumo reservado.',
    'solicitud.estado'
  );
  return crearSolicitudRecuperacionPasswordEmail({
    ...actual,
    frontera: crearFronteraRecuperacionPasswordEmail({
      perfil: PERFILES_RECUPERACION_PASSWORD_EMAIL.FRONTERA,
      version: VERSION_CONTRATO_RECUPERACION_PASSWORD_EMAIL,
      miembros: actual.frontera.miembros.map((miembro) => ({
        ...miembro,
        estado: miembro.usuarioId === id
          ? ESTADOS_IDENTIDAD_FRONTERA_RECUPERACION_PASSWORD_EMAIL.RETIRADA
          : miembro.estado
      }))
    })
  });
}

export function registrarAlegacionRecuperacionPasswordEmail(
  solicitud,
  { huellaNombreSha256, usuarioIdResuelto = null }
) {
  const actual = exigirSolicitudActiva(solicitud);
  exigirHash(huellaNombreSha256, 'huellaNombreSha256');
  const repetida = actual.huellasAlegadas.includes(huellaNombreSha256);
  if (!repetida && actual.presupuestoRestante === 0) {
    return congelarProfundo({
      solicitud: actual,
      alegacion: crearAlegacionRecuperacionPasswordEmail({
        perfil: PERFILES_RECUPERACION_PASSWORD_EMAIL.ALEGACION,
        version: VERSION_CONTRATO_RECUPERACION_PASSWORD_EMAIL,
        huellaNombreSha256,
        resultado:
          RESULTADOS_ALEGACION_RECUPERACION_PASSWORD_EMAIL.PRESUPUESTO_AGOTADO,
        usuarioIdResuelto: null,
        repetida: false,
        consumePresupuesto: false
      })
    });
  }

  let idResuelto = usuarioIdResuelto === null
    ? null
    : exigirId(usuarioIdResuelto, 'usuarioIdResuelto');
  if (idResuelto !== null) {
    const utilizable = actual.frontera.miembros.some(
      (miembro) =>
        miembro.usuarioId === idResuelto &&
        miembro.estado ===
          ESTADOS_IDENTIDAD_FRONTERA_RECUPERACION_PASSWORD_EMAIL.UTILIZABLE
    );
    if (!utilizable ||
      (actual.usuarioIdVinculado !== null && actual.usuarioIdVinculado !== idResuelto)) {
      idResuelto = null;
    }
  }
  if (
    repetida &&
    (actual.usuarioIdVinculado === null ||
      actual.huellaNombreVinculado !== huellaNombreSha256)
  ) {
    idResuelto = null;
  }

  const siguiente = repetida
    ? actual
    : crearSolicitudRecuperacionPasswordEmail({
      ...actual,
      presupuestoRestante: actual.presupuestoRestante - 1,
      huellasAlegadas: [...actual.huellasAlegadas, huellaNombreSha256],
      usuarioIdVinculado: idResuelto ?? actual.usuarioIdVinculado,
      huellaNombreVinculado: idResuelto === null
        ? actual.huellaNombreVinculado
        : huellaNombreSha256
    });

  return congelarProfundo({
    solicitud: siguiente,
    alegacion: crearAlegacionRecuperacionPasswordEmail({
      perfil: PERFILES_RECUPERACION_PASSWORD_EMAIL.ALEGACION,
      version: VERSION_CONTRATO_RECUPERACION_PASSWORD_EMAIL,
      huellaNombreSha256,
      resultado: idResuelto === null
        ? RESULTADOS_ALEGACION_RECUPERACION_PASSWORD_EMAIL.NO_RESUELTA
        : RESULTADOS_ALEGACION_RECUPERACION_PASSWORD_EMAIL.RESUELTA,
      usuarioIdResuelto: idResuelto,
      repetida,
      consumePresupuesto: !repetida
    })
  });
}

export function reservarConsumoRecuperacionPasswordEmail(solicitud, reserva) {
  const actual = exigirSolicitudActiva(solicitud);
  exigir(actual.usuarioIdVinculado !== null, 'El consumo exige una identidad vinculada.', 'solicitud.usuarioIdVinculado');
  exigir(
    actual.frontera.miembros.some(
      (miembro) =>
        miembro.usuarioId === actual.usuarioIdVinculado &&
        miembro.estado ===
          ESTADOS_IDENTIDAD_FRONTERA_RECUPERACION_PASSWORD_EMAIL.UTILIZABLE
    ),
    'El consumo exige que la identidad vinculada continúe utilizable.',
    'solicitud.usuarioIdVinculado'
  );
  const reservaValidada = crearReservaRecuperacionPasswordEmail(reserva);
  exigir(
    reservaValidada.tipo === TIPOS_RESERVA_RECUPERACION_PASSWORD_EMAIL.CONSUMO,
    'La exclusión de consumo exige una reserva de consumo.',
    'reserva.tipo'
  );
  return crearSolicitudRecuperacionPasswordEmail({
    ...actual,
    estado: ESTADOS_SOLICITUD_RECUPERACION_PASSWORD_EMAIL.CONSUMIENDO,
    reserva: reservaValidada
  });
}

export function liberarReservaConsumoRecuperacionPasswordEmail(solicitud) {
  const actual = crearSolicitudRecuperacionPasswordEmail(solicitud);
  exigir(
    actual.estado === ESTADOS_SOLICITUD_RECUPERACION_PASSWORD_EMAIL.CONSUMIENDO,
    'Solo una solicitud consumiendo puede liberar su reserva.',
    'solicitud.estado'
  );
  return crearSolicitudRecuperacionPasswordEmail({
    ...actual,
    estado: ESTADOS_SOLICITUD_RECUPERACION_PASSWORD_EMAIL.ACTIVA,
    reserva: null
  });
}

export function confirmarConsumoRecuperacionPasswordEmail(solicitud) {
  const actual = crearSolicitudRecuperacionPasswordEmail(solicitud);
  exigir(
    actual.estado === ESTADOS_SOLICITUD_RECUPERACION_PASSWORD_EMAIL.CONSUMIENDO,
    'Solo una solicitud con consumo reservado puede terminar.',
    'solicitud.estado'
  );
  return crearSolicitudRecuperacionPasswordEmail({
    ...actual,
    estado: ESTADOS_SOLICITUD_RECUPERACION_PASSWORD_EMAIL.CONSUMIDA,
    reserva: null,
    presupuestoRestante: 0,
    frontera: crearFronteraRecuperacionPasswordEmail({
      perfil: PERFILES_RECUPERACION_PASSWORD_EMAIL.FRONTERA,
      version: VERSION_CONTRATO_RECUPERACION_PASSWORD_EMAIL,
      miembros: actual.frontera.miembros.map((miembro) => ({
        ...miembro,
        estado: ESTADOS_IDENTIDAD_FRONTERA_RECUPERACION_PASSWORD_EMAIL.RETIRADA
      }))
    }),
    usuarioIdVinculado: null,
    huellaNombreVinculado: null
  });
}

export function inspeccionarPasivamenteRecuperacionPasswordEmail(solicitud) {
  return crearSolicitudRecuperacionPasswordEmail(solicitud);
}

export function esSolicitudRecuperacionPasswordEmailTerminal(solicitud) {
  const actual = crearSolicitudRecuperacionPasswordEmail(solicitud);
  return ESTADOS_TERMINALES_SOLICITUD_RECUPERACION_PASSWORD_EMAIL.includes(
    actual.estado
  );
}

export function crearHuellaRecuperacionPasswordEmail(dominio, valor) {
  exigirEnum(dominio, DOMINIOS_HUELLA, 'dominio');
  exigir(typeof valor === 'string' && valor.length > 0, 'El material de huella debe ser texto no vacío.', 'valor');
  return createHash('sha256')
    .update(`${PERFIL_CONTRATO_RECUPERACION_PASSWORD_EMAIL}\0${dominio}\0`, 'utf8')
    .update(valor, 'utf8')
    .digest('hex');
}

export function proyectarResultadoPublicoRecuperacionPasswordEmail({
  operacion,
  resultadoInterno
}) {
  let resultado;
  if (operacion === 'admision') {
    exigirEnum(resultadoInterno, RESULTADOS_ADMISION, 'resultadoInterno');
    resultado = resultadoInterno === RESULTADOS_ADMISION_RECUPERACION_PASSWORD_EMAIL.SATURADA
      ? RESULTADOS_PUBLICOS_RECUPERACION_PASSWORD_EMAIL.ADMISION_SATURADA
      : resultadoInterno === RESULTADOS_ADMISION_RECUPERACION_PASSWORD_EMAIL.INDISPONIBLE
        ? RESULTADOS_PUBLICOS_RECUPERACION_PASSWORD_EMAIL.PLATAFORMA_NO_DISPONIBLE
        : RESULTADOS_PUBLICOS_RECUPERACION_PASSWORD_EMAIL.SOLICITUD_RECIBIDA;
  } else if (operacion === 'alegacion') {
    exigirEnum(resultadoInterno, RESULTADOS_ALEGACION, 'resultadoInterno');
    resultado = resultadoInterno === RESULTADOS_ALEGACION_RECUPERACION_PASSWORD_EMAIL.RESUELTA
      ? RESULTADOS_PUBLICOS_RECUPERACION_PASSWORD_EMAIL.ALEGACION_RESUELTA
      : RESULTADOS_PUBLICOS_RECUPERACION_PASSWORD_EMAIL.ALEGACION_NO_RESUELTA;
  } else {
    exigir(false, 'La operación pública no pertenece al contrato.', 'operacion');
  }
  return congelarProfundo({
    perfil: PERFILES_RECUPERACION_PASSWORD_EMAIL.RESULTADO_PUBLICO,
    version: VERSION_CONTRATO_RECUPERACION_PASSWORD_EMAIL,
    ...resultado
  });
}

export function redactarValorRecuperacionPasswordEmail(valor) {
  if (Array.isArray(valor)) return valor.map(redactarValorRecuperacionPasswordEmail);
  if (!esObjetoPlano(valor)) return valor;
  const salida = {};
  for (const [clave, contenido] of Object.entries(valor)) {
    if (/token|bearer|password|secreto/iu.test(clave)) {
      salida[clave] = '[REDACTADO]';
    } else if (/frontera|miembros/iu.test(clave)) {
      salida[clave] = '[FRONTERA_PRIVADA]';
    } else {
      salida[clave] = redactarValorRecuperacionPasswordEmail(contenido);
    }
  }
  return congelarProfundo(salida);
}

function crearMiembroFrontera(entrada, ruta) {
  validarClavesExactas(entrada, propiedades('MIEMBRO_FRONTERA'), ruta);
  const usuarioId = exigirId(entrada.usuarioId, `${ruta}.usuarioId`);
  exigir(
    typeof entrada.generacionRecuperacionObservada === 'string' &&
      PATRON_GENERACION_DECIMAL.test(entrada.generacionRecuperacionObservada),
    'La generación observada debe ser una cadena decimal positiva canónica.',
    `${ruta}.generacionRecuperacionObservada`
  );
  exigirEnum(entrada.estado, ESTADOS_IDENTIDAD, `${ruta}.estado`);
  return congelarProfundo({ ...entrada, usuarioId });
}

function validarCoherenciaEstado({
  estado,
  emitidaEnUtc,
  expiraEnUtc,
  reserva,
  usuarioIdVinculado
}) {
  const preparada = estado === ESTADOS_SOLICITUD_RECUPERACION_PASSWORD_EMAIL.PREPARADA;
  if (preparada) {
    exigir(emitidaEnUtc === null && expiraEnUtc === null, 'Una solicitud preparada todavía no tiene vigencia.', 'solicitud.emitidaEnUtc');
  } else {
    exigirFechaUtc(emitidaEnUtc, 'solicitud.emitidaEnUtc');
    exigirFechaUtc(expiraEnUtc, 'solicitud.expiraEnUtc');
    exigir(Date.parse(expiraEnUtc) > Date.parse(emitidaEnUtc), 'La expiración debe seguir a la emisión.', 'solicitud.expiraEnUtc');
  }
  if (estado === ESTADOS_SOLICITUD_RECUPERACION_PASSWORD_EMAIL.CONSUMIENDO) {
    exigir(reserva?.tipo === TIPOS_RESERVA_RECUPERACION_PASSWORD_EMAIL.CONSUMO, 'El estado consumiendo exige su reserva de consumo.', 'solicitud.reserva');
    exigir(usuarioIdVinculado !== null, 'El estado consumiendo exige identidad vinculada.', 'solicitud.usuarioIdVinculado');
  } else {
    exigir(reserva === null, 'Solo el estado consumiendo conserva una reserva principal.', 'solicitud.reserva');
  }
  if (estado === ESTADOS_SOLICITUD_RECUPERACION_PASSWORD_EMAIL.CONSUMIDA) {
    exigir(usuarioIdVinculado === null, 'Una solicitud consumida no conserva autoridad vinculada.', 'solicitud.usuarioIdVinculado');
  }
}

function exigirSolicitudActiva(solicitud) {
  const actual = exigirSolicitudMutable(solicitud);
  exigir(actual.estado === ESTADOS_SOLICITUD_RECUPERACION_PASSWORD_EMAIL.ACTIVA, 'La operación exige una solicitud activa.', 'solicitud.estado');
  return actual;
}

function exigirSolicitudMutable(solicitud) {
  const actual = crearSolicitudRecuperacionPasswordEmail(solicitud);
  exigir(!esSolicitudRecuperacionPasswordEmailTerminal(actual), 'Una solicitud terminal no admite transiciones.', 'solicitud.estado');
  return actual;
}

function exigirPerfil(entrada, clavePerfil) {
  exigir(
    entrada.perfil === PERFILES_RECUPERACION_PASSWORD_EMAIL[clavePerfil],
    `El perfil de ${clavePerfil.toLowerCase()} no es válido.`,
    'perfil'
  );
  exigir(
    entrada.version === VERSION_CONTRATO_RECUPERACION_PASSWORD_EMAIL,
    `La versión de ${clavePerfil.toLowerCase()} no es válida.`,
    'version'
  );
}

function propiedades(clave) {
  return PROPIEDADES_CONTRATO_RECUPERACION_PASSWORD_EMAIL[clave];
}

function exigirUuidV7(valor, campo) {
  exigir(typeof valor === 'string' && PATRON_UUID_V7.test(valor), 'Se esperaba un UUIDv7 canónico.', campo);
  return valor;
}

function exigirId(valor, campo) {
  const canonico = typeof valor === 'number' && Number.isSafeInteger(valor)
    ? String(valor)
    : valor;
  exigir(typeof canonico === 'string' && PATRON_ID_DECIMAL.test(canonico), 'Se esperaba un identificador decimal positivo.', campo);
  return canonico;
}

function exigirHash(valor, campo) {
  exigir(typeof valor === 'string' && PATRON_HASH_SHA256.test(valor), 'Se esperaba una huella SHA-256 hexadecimal canónica.', campo);
  return valor;
}

function exigirFechaUtc(valor, campo) {
  exigir(typeof valor === 'string' && PATRON_FECHA_UTC.test(valor) && Number.isFinite(Date.parse(valor)), 'Se esperaba una fecha UTC canónica con milisegundos.', campo);
  return valor;
}

function exigirEnteroAcotado(valor, minimo, maximo, campo) {
  exigir(Number.isSafeInteger(valor) && valor >= minimo && valor <= maximo, `Se esperaba un entero entre ${minimo} y ${maximo}.`, campo);
  return valor;
}

function exigirTextoAcotado(valor, maximo, campo) {
  exigir(typeof valor === 'string' && valor.length > 0 && valor.length <= maximo, `Se esperaba texto no vacío de hasta ${maximo} caracteres.`, campo);
  return valor;
}

function exigirTextoUtf8Acotado(valor, maximo, campo) {
  exigir(typeof valor === 'string' && valor.length > 0 && Buffer.byteLength(valor, 'utf8') <= maximo, `Se esperaba texto no vacío de hasta ${maximo} bytes UTF-8.`, campo);
  return valor;
}

function exigirBooleano(valor, campo) {
  exigir(typeof valor === 'boolean', 'Se esperaba un booleano.', campo);
  return valor;
}

function exigirArray(valor, campo) {
  exigir(Array.isArray(valor), 'Se esperaba una lista.', campo);
}

function exigirEnum(valor, permitidos, campo) {
  exigir(permitidos.has(valor), `El valor de ${campo} no pertenece al catálogo cerrado.`, campo);
  return valor;
}

function validarClavesExactas(entrada, esperadas, ruta) {
  exigir(esObjetoPlano(entrada), `${ruta} debe ser un objeto plano.`, ruta);
  exigir(Object.getOwnPropertySymbols(entrada).length === 0, `${ruta} no admite propiedades symbol.`, ruta);
  for (const clave of Reflect.ownKeys(entrada)) {
    const descriptor = Object.getOwnPropertyDescriptor(entrada, clave);
    exigir(descriptor && 'value' in descriptor, `${ruta}.${String(clave)} no admite accessors.`, `${ruta}.${String(clave)}`);
  }
  const recibidas = Object.keys(entrada).sort();
  const requeridas = [...esperadas].sort();
  exigir(JSON.stringify(recibidas) === JSON.stringify(requeridas), `${ruta} exige exactamente: ${requeridas.join(', ')}.`, ruta);
}

function esObjetoPlano(valor) {
  if (valor === null || typeof valor !== 'object' || Array.isArray(valor)) return false;
  const prototipo = Object.getPrototypeOf(valor);
  return prototipo === Object.prototype || prototipo === null;
}

function compararDecimales(a, b) {
  const diferenciaLongitud = a.length - b.length;
  return diferenciaLongitud || a.localeCompare(b);
}

function exigir(condicion, mensaje, campo) {
  if (!condicion) throw new ErrorContratoRecuperacionPasswordEmail(mensaje, { campo });
}

function congelarProfundo(valor) {
  if (valor === null || typeof valor !== 'object' || Object.isFrozen(valor)) return valor;
  for (const descendiente of Object.values(valor)) congelarProfundo(descendiente);
  return Object.freeze(valor);
}

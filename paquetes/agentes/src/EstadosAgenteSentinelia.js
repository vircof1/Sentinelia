export const ESTADOS_ADMINISTRATIVOS_AGENTE = Object.freeze({
  ACTIVO: 'activo',
  DESHABILITADO: 'deshabilitado'
});

export const ESTADOS_ACCESO_AGENTE = Object.freeze({
  NORMAL: 'normal',
  CUARENTENA: 'cuarentena'
});

export const ESTADOS_VIDA_POL_AGENTE = Object.freeze({
  NUNCA_CONECTADO: 'nunca_conectado',
  VIVO: 'vivo',
  SILENCIOSO: 'silencioso',
  INCONSISTENTE_RELOGIN_REQUERIDO: 'inconsistente_relogin_requerido'
});

const ADMINISTRATIVOS_VALIDOS = new Set(
  Object.values(ESTADOS_ADMINISTRATIVOS_AGENTE)
);
const ACCESO_VALIDOS = new Set(Object.values(ESTADOS_ACCESO_AGENTE));
const VIDA_POL_VALIDOS = new Set(Object.values(ESTADOS_VIDA_POL_AGENTE));

export function normalizarEstadoAdministrativoAgente(valor) {
  const normalizado = normalizarToken(valor, ESTADOS_ADMINISTRATIVOS_AGENTE.ACTIVO);

  if (!ADMINISTRATIVOS_VALIDOS.has(normalizado)) {
    throw new Error('El estado administrativo del agente no es válido.');
  }

  return normalizado;
}

export function normalizarEstadoAccesoAgente(valor) {
  const normalizado = normalizarToken(valor, ESTADOS_ACCESO_AGENTE.NORMAL);

  if (!ACCESO_VALIDOS.has(normalizado)) {
    throw new Error('El estado de acceso del agente no es válido.');
  }

  return normalizado;
}

export function normalizarEstadoVidaPolAgente(valor) {
  const normalizado = normalizarToken(
    valor,
    ESTADOS_VIDA_POL_AGENTE.NUNCA_CONECTADO
  );

  if (!VIDA_POL_VALIDOS.has(normalizado)) {
    throw new Error('El estado de vida POL del agente no es válido.');
  }

  return normalizado;
}

export function calcularEstadoVidaPolAgente({
  ultimoHeartbeatUtc = null,
  ahoraUtc = new Date(),
  silencioSegundos = 120,
  requiereRelogin = false
} = {}) {
  if (requiereRelogin) {
    return ESTADOS_VIDA_POL_AGENTE.INCONSISTENTE_RELOGIN_REQUERIDO;
  }

  const fechaHeartbeat = convertirFecha(ultimoHeartbeatUtc);

  if (!fechaHeartbeat) {
    return ESTADOS_VIDA_POL_AGENTE.NUNCA_CONECTADO;
  }

  const fechaActual = convertirFecha(ahoraUtc) || new Date();
  const silencioMs = Math.max(0, Number(silencioSegundos || 0)) * 1000;

  if (fechaActual.getTime() - fechaHeartbeat.getTime() >= silencioMs) {
    return ESTADOS_VIDA_POL_AGENTE.SILENCIOSO;
  }

  return ESTADOS_VIDA_POL_AGENTE.VIVO;
}

export function calcularEstadoEfectivoAgente({
  estadoAdministrativo,
  estadoAcceso,
  estadoVidaPol
}) {
  const administrativo = normalizarEstadoAdministrativoAgente(
    estadoAdministrativo
  );

  if (administrativo === ESTADOS_ADMINISTRATIVOS_AGENTE.DESHABILITADO) {
    return ESTADOS_ADMINISTRATIVOS_AGENTE.DESHABILITADO;
  }

  const acceso = normalizarEstadoAccesoAgente(estadoAcceso);

  if (acceso === ESTADOS_ACCESO_AGENTE.CUARENTENA) {
    return ESTADOS_ACCESO_AGENTE.CUARENTENA;
  }

  return normalizarEstadoVidaPolAgente(estadoVidaPol);
}

function normalizarToken(valor, porDefecto) {
  const normalizado = String(valor || porDefecto)
    .trim()
    .toLowerCase();

  return normalizado || porDefecto;
}

function convertirFecha(valor) {
  if (!valor) {
    return null;
  }

  if (valor instanceof Date) {
    return Number.isNaN(valor.getTime()) ? null : valor;
  }

  const fecha = new Date(String(valor).replace(' ', 'T').concat(
    /^\d{4}-\d{2}-\d{2}T/.test(String(valor)) &&
      !/[zZ]|[+-]\d{2}:?\d{2}$/.test(String(valor))
      ? 'Z'
      : ''
  ));

  return Number.isNaN(fecha.getTime()) ? null : fecha;
}

export const ESTADOS_PUBLICACION_DNS = Object.freeze({
  PENDIENTE: 'pendiente',
  EFECTO_INICIADO: 'efecto_iniciado',
  RECARGA_CONFIRMADA: 'recarga_confirmada',
  CONSOLIDADA: 'consolidada',
  SIN_CAMBIOS: 'sin_cambios',
  SUPERADA: 'superada',
  SUPERADA_TRAS_RECUPERACION: 'superada_tras_recuperacion',
  RECUPERACION_PENDIENTE: 'recuperacion_pendiente',
  RECUPERACION_BLOQUEADA: 'recuperacion_bloqueada',
  FALLIDA: 'fallida'
});

export const ESTADOS_PUBLICACION_DNS_TERMINALES = Object.freeze([
  ESTADOS_PUBLICACION_DNS.CONSOLIDADA,
  ESTADOS_PUBLICACION_DNS.SIN_CAMBIOS,
  ESTADOS_PUBLICACION_DNS.SUPERADA,
  ESTADOS_PUBLICACION_DNS.SUPERADA_TRAS_RECUPERACION,
  ESTADOS_PUBLICACION_DNS.FALLIDA
]);

export const ESTADOS_PUBLICACION_DNS_RECLAMABLES = Object.freeze([
  ESTADOS_PUBLICACION_DNS.PENDIENTE,
  ESTADOS_PUBLICACION_DNS.EFECTO_INICIADO,
  ESTADOS_PUBLICACION_DNS.RECARGA_CONFIRMADA,
  ESTADOS_PUBLICACION_DNS.RECUPERACION_PENDIENTE
]);

const TERMINALES = new Set(ESTADOS_PUBLICACION_DNS_TERMINALES);

export const CAUSAS_PUBLICACION_DNS = Object.freeze({
  MUTACION_CATALOGO: 'mutacion_catalogo',
  RECONCILIACION_INICIAL: 'reconciliacion_inicial',
  REINTENTO_RECONCILIACION: 'reintento_reconciliacion',
  DIVERGENCIA_RECUPERACION: 'divergencia_proyeccion_recuperacion',
  REACTIVACION_MANUAL: 'reactivacion_manual',
  REINTENTO_DDNS: 'reintento_ddns'
});

export function esEstadoTerminalPublicacionDns(estado) {
  return TERMINALES.has(estado);
}

export function exigeRecargaForzadaPublicacionDns(operacion, reconciliacion = null) {
  return Boolean(
    operacion?.efectoPosible ||
    (
      reconciliacion &&
      reconciliacion.estado !== 'satisfecha' &&
      reconciliacion.generacionObjetivo === operacion?.generacionDns
    )
  );
}

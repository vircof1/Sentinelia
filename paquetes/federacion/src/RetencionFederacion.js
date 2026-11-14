import { DECISIONES_RETENCION_FEDERACION } from './CatalogosFederacion.js';
import { normalizarJsonFederacion } from './CanonicalizadorFederacion.js';

const PATRON_ENTERO_DECIMAL = /^(0|[1-9][0-9]*)$/;
const PATRON_FECHA_UTC_MILISEGUNDOS =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const MILISEGUNDOS_DIA = 86_400_000n;

export class ErrorRetencionFederacion extends Error {
  constructor(codigo, mensaje, { campo = null } = {}) {
    super(mensaje);
    this.name = 'ErrorRetencionFederacion';
    this.codigo = codigo;
    this.campo = campo;
  }
}

export function calcularPoliticaRetencionEfectivaFederacion({
  retencionGlobalDias,
  retencionRecepcionDias
} = {}) {
  const global = exigirDuracionOpcional(retencionGlobalDias, 'retencionGlobalDias');
  const recepcion = exigirDuracionOpcional(
    retencionRecepcionDias,
    'retencionRecepcionDias'
  );
  const candidatas = [global, recepcion].filter((valor) => valor !== null);
  const efectiva = candidatas.length === 0
    ? null
    : candidatas.map(BigInt).reduce((menor, actual) => actual < menor ? actual : menor).toString();
  return normalizarJsonFederacion({
    retencionGlobalDias: global,
    retencionRecepcionDias: recepcion,
    retencionEfectivaDias: efectiva
  });
}

export function evaluarRetencionDatoFederado({
  retencionGlobalDias,
  retencionRecepcionDias,
  tiempoEfectivoFuenteUtc,
  ahoraUtc,
  minimoOperativoProtegido = false,
  fronteraAntirresurreccion = false
} = {}) {
  exigirBooleano(minimoOperativoProtegido, 'minimoOperativoProtegido');
  exigirBooleano(fronteraAntirresurreccion, 'fronteraAntirresurreccion');
  if (minimoOperativoProtegido && fronteraAntirresurreccion) {
    fallar(
      'protecciones_retencion_incompatibles',
      'Un dato no puede ser simultáneamente estado operativo activo y frontera compactable.',
      'proteccionesRetencion'
    );
  }
  const politica = calcularPoliticaRetencionEfectivaFederacion({
    retencionGlobalDias,
    retencionRecepcionDias
  });
  const tiempoFuente = exigirFechaUtc(
    tiempoEfectivoFuenteUtc,
    'tiempoEfectivoFuenteUtc'
  );
  const ahora = exigirFechaUtc(ahoraUtc, 'ahoraUtc');
  const antiguedadMs = BigInt(Math.max(0, Date.parse(ahora) - Date.parse(tiempoFuente)));
  const limiteMs = politica.retencionEfectivaDias === null
    ? null
    : BigInt(politica.retencionEfectivaDias) * MILISEGUNDOS_DIA;
  const fueraVentana = limiteMs === null ? false : antiguedadMs > limiteMs;
  let decision = 'conservar';
  if (fueraVentana && fronteraAntirresurreccion) {
    decision = 'compactarEvidencia';
  } else if (fueraVentana && minimoOperativoProtegido) {
    decision = 'conservarMinimoOperativo';
  } else if (fueraVentana) {
    decision = 'eliminarContenido';
  }
  DECISIONES_RETENCION_FEDERACION.exigir(decision);
  return normalizarJsonFederacion({
    ...politica,
    tiempoEfectivoFuenteUtc: tiempoFuente,
    ahoraUtc: ahora,
    antiguedadMs: antiguedadMs.toString(),
    fueraVentana,
    minimoOperativoProtegido,
    fronteraAntirresurreccion,
    decision,
    puedeResucitarContenidoEliminado: false
  });
}

function exigirDuracionOpcional(valor, campo) {
  if (valor === null) return null;
  if (typeof valor !== 'string' || !PATRON_ENTERO_DECIMAL.test(valor)) {
    fallar(
      'retencion_invalida',
      `${campo} debe ser null o días enteros canónicos no negativos.`,
      campo
    );
  }
  return valor;
}

function exigirFechaUtc(valor, campo) {
  if (
    typeof valor !== 'string' ||
    !PATRON_FECHA_UTC_MILISEGUNDOS.test(valor) ||
    !Number.isFinite(Date.parse(valor)) ||
    new Date(Date.parse(valor)).toISOString() !== valor
  ) {
    fallar(
      'fecha_utc_invalida',
      `${campo} debe usar UTC canónico con milisegundos.`,
      campo
    );
  }
  return valor;
}

function exigirBooleano(valor, campo) {
  if (typeof valor !== 'boolean') {
    fallar('booleano_invalido', `${campo} debe ser booleano.`, campo);
  }
}

function fallar(codigo, mensaje, campo) {
  throw new ErrorRetencionFederacion(codigo, mensaje, { campo });
}

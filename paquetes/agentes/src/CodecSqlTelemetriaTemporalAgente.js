import {
  normalizarValorDuracionTelemetria,
  normalizarValorMomentoUtcTelemetria
} from './ContratoTelemetriaTemporalAgente.js';

const PATRON_DATETIME_SQL = /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2})$/u;

export function duracionTelemetriaDesdeSql(valor) {
  if (valor == null) {
    return null;
  }
  return normalizarValorDuracionTelemetria(Number(valor));
}

export function duracionTelemetriaASql(valor) {
  if (valor == null) {
    return null;
  }
  return normalizarValorDuracionTelemetria(valor);
}

export function momentoUtcTelemetriaDesdeSql(valor) {
  if (valor == null) {
    return null;
  }

  if (valor instanceof Date) {
    if (Number.isNaN(valor.getTime())) {
      throw new Error('El valor momento_utc persistido no es válido.');
    }
    return normalizarValorMomentoUtcTelemetria(
      `${rellenar(valor.getUTCFullYear(), 4)}-${rellenar(valor.getUTCMonth() + 1)}-` +
      `${rellenar(valor.getUTCDate())}T${rellenar(valor.getUTCHours())}:` +
      `${rellenar(valor.getUTCMinutes())}:${rellenar(valor.getUTCSeconds())}Z`
    );
  }

  const texto = String(valor);
  const coincidencia = PATRON_DATETIME_SQL.exec(texto);
  if (!coincidencia) {
    return normalizarValorMomentoUtcTelemetria(texto);
  }
  return normalizarValorMomentoUtcTelemetria(
    `${coincidencia[1]}-${coincidencia[2]}-${coincidencia[3]}T` +
    `${coincidencia[4]}:${coincidencia[5]}:${coincidencia[6]}Z`
  );
}

export function momentoUtcTelemetriaASql(valor) {
  if (valor == null) {
    return null;
  }
  return normalizarValorMomentoUtcTelemetria(valor)
    .slice(0, -1)
    .replace('T', ' ');
}

function rellenar(valor, longitud = 2) {
  return String(valor).padStart(longitud, '0');
}

import { randomBytes } from 'node:crypto';

import {
  bytesAUuidV7Auditoria,
  uuidV7AuditoriaABytes
} from '../../auditoria/src/UuidV7Auditoria.js';

const RETENCION_PREDETERMINADA_SEGUNDOS = 7 * 24 * 60 * 60;

export class ErrorIdempotenciaTelemetriaAgente extends Error {
  constructor(mensaje, codigo) {
    super(mensaje);
    this.name = 'ErrorIdempotenciaTelemetriaAgente';
    this.code = codigo;
    this.codigo = codigo;
    this.statusCode = 409;
  }
}

export class RepositorioIdempotenciaLotesTelemetriaAgentes {
  constructor(clienteSql, {
    retencionSegundos = RETENCION_PREDETERMINADA_SEGUNDOS,
    generarTokenReserva = () => randomBytes(16)
  } = {}) {
    this.clienteSql = clienteSql;
    this.retencionSegundos = normalizarEnteroPositivo(
      retencionSegundos,
      'La retención idempotente debe expresarse en segundos positivos.'
    );
    this.generarTokenReserva = generarTokenReserva;
  }

  async reservar({
    agenteId,
    telemetriaRequestId,
    huellaSha256
  } = {}) {
    const agente = normalizarIdAgente(agenteId);
    const requestIdBytes = uuidV7AuditoriaABytes(
      telemetriaRequestId,
      'telemetriaRequestId'
    );
    const huella = normalizarBinario(huellaSha256, 32, 'huellaSha256');
    const tokenReserva = normalizarBinario(
      this.generarTokenReserva(),
      16,
      'tokenReserva'
    );

    await this.clienteSql.ejecutar(
      `
        INSERT INTO lotes_idempotentes_telemetria_agentes (
          agente_id,
          telemetria_request_id,
          huella_sha256,
          token_reserva,
          estado,
          resultado_estable,
          recibido_en_utc,
          expira_en_utc
        ) VALUES (?, ?, ?, ?, 'reservado', NULL, NULL,
          DATE_ADD(UTC_TIMESTAMP(6), INTERVAL ? SECOND))
        ON DUPLICATE KEY UPDATE
          huella_sha256 = IF(
            expira_en_utc <= UTC_TIMESTAMP(6),
            VALUES(huella_sha256),
            huella_sha256
          ),
          token_reserva = IF(
            expira_en_utc <= UTC_TIMESTAMP(6),
            VALUES(token_reserva),
            token_reserva
          ),
          estado = IF(
            expira_en_utc <= UTC_TIMESTAMP(6),
            'reservado',
            estado
          ),
          resultado_estable = IF(
            expira_en_utc <= UTC_TIMESTAMP(6),
            NULL,
            resultado_estable
          ),
          recibido_en_utc = IF(
            expira_en_utc <= UTC_TIMESTAMP(6),
            NULL,
            recibido_en_utc
          ),
          fecha_creacion = IF(
            expira_en_utc <= UTC_TIMESTAMP(6),
            UTC_TIMESTAMP(6),
            fecha_creacion
          ),
          fecha_actualizacion = IF(
            expira_en_utc <= UTC_TIMESTAMP(6),
            UTC_TIMESTAMP(6),
            fecha_actualizacion
          ),
          expira_en_utc = IF(
            expira_en_utc <= UTC_TIMESTAMP(6),
            VALUES(expira_en_utc),
            expira_en_utc
          )
      `,
      [agente, requestIdBytes, huella, tokenReserva, this.retencionSegundos]
    );

    const fila = await this.buscarBloqueada({ agente, requestIdBytes });
    if (!fila || !Buffer.from(fila.huella_sha256).equals(huella)) {
      throw new ErrorIdempotenciaTelemetriaAgente(
        'telemetriaRequestId ya fue utilizado para un lote lógico diferente.',
        'telemetria_request_id_divergente'
      );
    }

    if (fila.estado === 'confirmado') {
      return Object.freeze({
        nueva: false,
        replay: true,
        tokenReserva: null,
        resultadoEstable: parsearResultadoEstable(fila.resultado_estable)
      });
    }

    if (!Buffer.from(fila.token_reserva).equals(tokenReserva)) {
      throw new ErrorIdempotenciaTelemetriaAgente(
        'telemetriaRequestId está siendo procesado por otra transacción.',
        'telemetria_request_id_en_curso'
      );
    }

    return Object.freeze({
      nueva: true,
      replay: false,
      tokenReserva
    });
  }

  async confirmar({
    agenteId,
    telemetriaRequestId,
    tokenReserva,
    resultadoEstable,
    recibidoEnUtc
  } = {}) {
    const resultadoJson = normalizarResultadoEstable(resultadoEstable);
    const [resultado] = await this.clienteSql.ejecutar(
      `
        UPDATE lotes_idempotentes_telemetria_agentes
        SET estado = 'confirmado',
            resultado_estable = ?,
            recibido_en_utc = ?,
            fecha_actualizacion = UTC_TIMESTAMP(6)
        WHERE agente_id = ?
          AND telemetria_request_id = ?
          AND token_reserva = ?
          AND estado = 'reservado'
      `,
      [
        resultadoJson,
        normalizarFechaSql(recibidoEnUtc),
        normalizarIdAgente(agenteId),
        uuidV7AuditoriaABytes(telemetriaRequestId, 'telemetriaRequestId'),
        normalizarBinario(tokenReserva, 16, 'tokenReserva')
      ]
    );

    if (Number(resultado.affectedRows || 0) !== 1) {
      throw new Error(
        'La reserva idempotente de telemetría dejó de pertenecer a esta transacción.'
      );
    }
  }

  async buscar({ agenteId, telemetriaRequestId } = {}) {
    const filas = await this.clienteSql.consultar(
      `
        SELECT
          agente_id,
          telemetria_request_id,
          huella_sha256,
          estado,
          resultado_estable,
          recibido_en_utc,
          expira_en_utc
        FROM lotes_idempotentes_telemetria_agentes
        WHERE agente_id = ? AND telemetria_request_id = ?
        LIMIT 1
      `,
      [
        normalizarIdAgente(agenteId),
        uuidV7AuditoriaABytes(telemetriaRequestId, 'telemetriaRequestId')
      ]
    );
    return filas[0] ? serializarFila(filas[0]) : null;
  }

  async purgarExpirados({ limite = 500 } = {}) {
    const [resultado] = await this.clienteSql.ejecutar(
      `
        DELETE FROM lotes_idempotentes_telemetria_agentes
        WHERE expira_en_utc <= UTC_TIMESTAMP(6)
        ORDER BY expira_en_utc, agente_id, telemetria_request_id
        LIMIT ?
      `,
      [normalizarEnteroPositivo(limite, 'El límite de purga debe ser positivo.')]
    );
    return Number(resultado.affectedRows || 0);
  }

  async buscarBloqueada({ agente, requestIdBytes }) {
    const filas = await this.clienteSql.consultar(
      `
        SELECT huella_sha256, token_reserva, estado, resultado_estable
        FROM lotes_idempotentes_telemetria_agentes
        WHERE agente_id = ? AND telemetria_request_id = ?
        LIMIT 1
        FOR UPDATE
      `,
      [agente, requestIdBytes]
    );
    return filas[0] || null;
  }
}

function serializarFila(fila) {
  return Object.freeze({
    agenteId: Number(fila.agente_id),
    telemetriaRequestId: bytesAUuidV7Auditoria(
      fila.telemetria_request_id,
      'telemetriaRequestId'
    ),
    huellaSha256: Buffer.from(fila.huella_sha256).toString('hex'),
    estado: fila.estado,
    resultadoEstable: parsearResultadoEstable(fila.resultado_estable),
    recibidoEnUtc: normalizarMarcaSqlUtc(fila.recibido_en_utc),
    expiraEnUtc: normalizarMarcaSqlUtc(fila.expira_en_utc)
  });
}

function normalizarResultadoEstable(valor) {
  if (!valor || typeof valor !== 'object' || Array.isArray(valor)) {
    throw new Error('El núcleo estable del resultado idempotente no es válido.');
  }
  const serializado = JSON.stringify(valor);
  if (Buffer.byteLength(serializado, 'utf8') > 16384) {
    throw new Error('El núcleo estable del resultado idempotente supera el límite.');
  }
  return serializado;
}

function parsearResultadoEstable(valor) {
  if (valor == null) {
    return null;
  }
  const resultado = typeof valor === 'string' ? JSON.parse(valor) : valor;
  return JSON.parse(JSON.stringify(resultado));
}

function normalizarBinario(valor, longitud, campo) {
  const binario = typeof valor === 'string' && /^[0-9a-f]+$/iu.test(valor)
    ? Buffer.from(valor, 'hex')
    : Buffer.from(valor || []);
  if (binario.byteLength !== longitud) {
    throw new Error(`${campo} debe contener exactamente ${longitud} bytes.`);
  }
  return binario;
}

function normalizarIdAgente(valor) {
  const id = Number.parseInt(String(valor ?? ''), 10);
  if (!Number.isInteger(id) || id <= 0) {
    throw new Error('El agente de la identidad de telemetría no es válido.');
  }
  return id;
}

function normalizarEnteroPositivo(valor, mensaje) {
  const numero = Number.parseInt(String(valor ?? ''), 10);
  if (!Number.isInteger(numero) || numero <= 0) {
    throw new Error(mensaje);
  }
  return numero;
}

function normalizarFechaSql(valor) {
  const fecha = valor instanceof Date ? valor : new Date(valor);
  if (Number.isNaN(fecha.getTime())) {
    throw new Error('La fecha del resultado idempotente no es válida.');
  }
  return fecha;
}

function normalizarMarcaSqlUtc(valor) {
  if (valor == null) {
    return null;
  }
  const fecha = valor instanceof Date ? valor : new Date(`${valor}Z`);
  if (Number.isNaN(fecha.getTime())) {
    throw new Error('La fecha idempotente persistida no es válida.');
  }
  return fecha.toISOString();
}

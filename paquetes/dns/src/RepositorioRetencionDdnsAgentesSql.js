export class RepositorioRetencionDdnsAgentesSql {
  constructor({ clienteSql } = {}) {
    if (typeof clienteSql?.consultar !== 'function') {
      throw new TypeError('La retención DDNS requiere SQL operativo.');
    }
    this.clienteSql = clienteSql;
  }

  async listarCandidatos({ corteUtc, limite = 100 } = {}) {
    validarFecha(corteUtc);
    const filas = await this.clienteSql.consultar(
      `SELECT c.id,HEX(c.concesion_id) AS concesion_hex,c.cerrada_en_utc
         FROM concesiones_ddns_agentes c
        WHERE c.estado='revocada' AND c.cerrada_en_utc<?
          AND NOT EXISTS (
            SELECT 1 FROM intenciones_ddns_agentes i
             WHERE i.concesion_interna_id=c.id AND i.terminal IS NULL
          )
          AND NOT EXISTS (
            SELECT 1 FROM intentos_publicacion_ddns p
             WHERE p.concesion_interna_id=c.id
               AND p.estado IN ('pendiente','procesando','bloqueada')
          )
        ORDER BY c.cerrada_en_utc,c.id LIMIT ?`,
      [fechaSql(corteUtc), normalizarLimite(limite)]
    );
    return Object.freeze(filas.map((fila) => Object.freeze({
      idInterno: String(fila.id),
      concesionHex: String(fila.concesion_hex).toLowerCase(),
      cerradaEnUtc: fechaIso(fila.cerrada_en_utc)
    })));
  }

  async purgarCandidatoEnTransaccion({ idInterno, corteUtc }, { conexion } = {}) {
    if (typeof conexion?.execute !== 'function') {
      throw new TypeError('La purga DDNS exige una conexión prestada.');
    }
    validarFecha(corteUtc);
    const [filas] = await conexion.execute(
      `SELECT id FROM concesiones_ddns_agentes
        WHERE id=? AND estado='revocada' AND cerrada_en_utc<?
          AND NOT EXISTS (
            SELECT 1 FROM intenciones_ddns_agentes i
             WHERE i.concesion_interna_id=concesiones_ddns_agentes.id
               AND i.terminal IS NULL
          )
          AND NOT EXISTS (
            SELECT 1 FROM intentos_publicacion_ddns p
             WHERE p.concesion_interna_id=concesiones_ddns_agentes.id
               AND p.estado IN ('pendiente','procesando','bloqueada')
          )
        FOR UPDATE`,
      [idInterno, fechaSql(corteUtc)]
    );
    if (!filas[0]) return resultadoVacio(false);
    await conexion.execute(
      'UPDATE concesiones_ddns_agentes SET intencion_gobernante_id=NULL WHERE id=?',
      [idInterno]
    );
    const [solicitudes] = await conexion.execute(
      'DELETE FROM solicitudes_ddns_agentes WHERE concesion_interna_id=?',
      [idInterno]
    );
    const [intentos] = await conexion.execute(
      'DELETE FROM intentos_publicacion_ddns WHERE concesion_interna_id=?',
      [idInterno]
    );
    const [intenciones] = await conexion.execute(
      'DELETE FROM intenciones_ddns_agentes WHERE concesion_interna_id=?',
      [idInterno]
    );
    return Object.freeze({
      purgada: true,
      solicitudes: Number(solicitudes.affectedRows || 0),
      intentos: Number(intentos.affectedRows || 0),
      intenciones: Number(intenciones.affectedRows || 0)
    });
  }
}

function resultadoVacio(purgada) {
  return Object.freeze({ purgada, solicitudes: 0, intentos: 0, intenciones: 0 });
}

function normalizarLimite(valor) {
  const numero = Number(valor);
  if (!Number.isInteger(numero) || numero < 1 || numero > 1000) {
    throw new TypeError('El límite de retención DDNS debe estar entre 1 y 1000.');
  }
  return numero;
}

function validarFecha(valor) {
  if (typeof valor !== 'string' || Number.isNaN(Date.parse(valor))) {
    throw new TypeError('El corte de retención DDNS debe ser una fecha UTC válida.');
  }
}

function fechaSql(valor) {
  return new Date(valor).toISOString().slice(0, 23).replace('T', ' ');
}

function fechaIso(valor) {
  if (valor instanceof Date) return valor.toISOString();
  return new Date(String(valor).replace(' ', 'T') + 'Z').toISOString();
}

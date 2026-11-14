import {
  generarUuidV7Auditoria
} from '../../auditoria/src/UuidV7Auditoria.js';
import {
  canonicalizarIpv4Ddns,
  canonicalizarIpv6Ddns
} from './ValidadorEstadoDdnsAgentes.js';

export class ServicioRegistroCausaPolDdns {
  constructor({ repositorioCausasPolDdns, generarCausaId = generarUuidV7Auditoria } = {}) {
    if (typeof repositorioCausasPolDdns?.crearEnTransaccion !== 'function') {
      throw new Error('El registro causal POL DDNS requiere persistencia transaccional.');
    }
    if (typeof generarCausaId !== 'function') {
      throw new TypeError('El registro causal POL DDNS requiere identidad UUIDv7.');
    }
    this.repositorioCausasPolDdns = repositorioCausasPolDdns;
    this.generarCausaId = generarCausaId;
  }

  async registrarEnTransaccion({
    agenteId,
    periodoVidaPolId,
    sesionId = null,
    secuencia,
    aceptadaEnUtc,
    direccionRemota = null
  } = {}, { conexion } = {}) {
    if (typeof conexion?.execute !== 'function') {
      throw new Error('La causa DDNS debe compartir la transacción que acepta el POL.');
    }
    const direccion = interpretarDireccionRemotaPolDdns(direccionRemota);
    const causaId = this.generarCausaId();
    await this.repositorioCausasPolDdns.crearEnTransaccion({
      causaId,
      agenteId,
      periodoVidaPolId,
      sesionId,
      secuencia,
      aceptadaEnUtc,
      direccionRemota: direccion?.valor || null,
      familiaDireccion: direccion?.familia || null
    }, { conexion });
    return Object.freeze({ causaId, direccion });
  }
}

export function interpretarDireccionRemotaPolDdns(valor) {
  if (typeof valor !== 'string' || !valor.trim()) return null;
  const candidata = valor.trim();
  try {
    return Object.freeze({
      valor: canonicalizarIpv4Ddns(candidata),
      familia: 'ipv4'
    });
  } catch {
    try {
      return Object.freeze({
        valor: canonicalizarIpv6Ddns(candidata),
        familia: 'ipv6'
      });
    } catch {
      return null;
    }
  }
}

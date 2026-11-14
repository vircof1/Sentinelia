const TIPO_AVISO = 'perfil_servidor_pol_aceptado';

export class PublicadorAvisosPerfilServidorRedis {
  constructor({ clienteRedis, canal, reloj = () => new Date() } = {}) {
    if (typeof clienteRedis?.publish !== 'function') {
      throw new Error('Los avisos POL del perfil servidor requieren Redis.');
    }
    this.clienteRedis = clienteRedis;
    this.canal = String(canal || '').trim();
    this.reloj = reloj;
    if (!this.canal) {
      throw new Error('El canal Redis del perfil servidor es obligatorio.');
    }
  }

  async publicarPolAceptado({
    agenteId,
    periodoVidaPolId,
    tipoPol,
    seq = null,
    recibidoEnUtc
  } = {}) {
    const tipo = String(tipoPol || '').trim();
    if (!['login', 'heartbeat'].includes(tipo)) {
      throw new Error('El aviso runtime solo admite POL de login o heartbeat.');
    }
    const aviso = {
      tipo: TIPO_AVISO,
      agenteId: enteroPositivo(agenteId, 'agenteId'),
      periodoVidaPolId: enteroPositivo(periodoVidaPolId, 'periodoVidaPolId'),
      tipoPol: tipo,
      seq: seq === null || seq === undefined
        ? null
        : enteroNoNegativo(seq, 'seq'),
      recibidoEnUtc: fechaUtc(recibidoEnUtc, 'recibidoEnUtc'),
      publicadoEnUtc: this.reloj().toISOString()
    };
    const receptores = await this.clienteRedis.publish(
      this.canal,
      JSON.stringify(aviso)
    );
    return Object.freeze({ publicado: true, receptores: Number(receptores || 0) });
  }
}

function enteroPositivo(valor, campo) {
  const numero = Number(valor);
  if (!Number.isSafeInteger(numero) || numero <= 0) {
    throw new Error(`${campo} debe ser un entero positivo.`);
  }
  return numero;
}

function enteroNoNegativo(valor, campo) {
  const numero = Number(valor);
  if (!Number.isSafeInteger(numero) || numero < 0) {
    throw new Error(`${campo} debe ser un entero no negativo.`);
  }
  return numero;
}

function fechaUtc(valor, campo) {
  const fecha = valor instanceof Date ? valor : new Date(valor);
  if (Number.isNaN(fecha.getTime())) {
    throw new Error(`${campo} debe ser una fecha válida.`);
  }
  return fecha.toISOString();
}

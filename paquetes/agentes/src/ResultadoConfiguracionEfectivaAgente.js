import {
  crearConfiguracionEfectivaAgente
} from './ConfiguracionEfectivaAgente.js';

export class ResultadoConfiguracionEfectivaAgente {
  constructor({
    agente,
    sesion,
    ttlRestanteSegundos,
    renewBeforeSeconds,
    configuracion
  }) {
    this.agente = agente;
    this.sesion = sesion;
    this.ttlRestanteSegundos = normalizarEntero(ttlRestanteSegundos, 0);
    this.renewBeforeSeconds = normalizarEntero(renewBeforeSeconds, 120);
    this.configuracion = crearConfiguracionEfectivaAgente(configuracion);
  }

  obtenerRespuestaPublica() {
    return {
      agente: this.agente,
      sesion: {
        sessionId: this.sesion.sessionId,
        expiresInSeconds: Math.max(0, this.ttlRestanteSegundos),
        renewBeforeSeconds: this.renewBeforeSeconds
      },
      configuracion: this.configuracion.obtenerRespuestaPublica()
    };
  }
}

function normalizarEntero(valor, porDefecto) {
  const convertido = Number.parseInt(String(valor ?? ''), 10);
  return Number.isInteger(convertido) ? convertido : porDefecto;
}

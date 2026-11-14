import {
  CoordinadorOperacionesDurables,
  LeaseOperacionDurablePerdido
} from '../../../../paquetes/coordinacion-durable/src/CoordinadorOperacionesDurables.js';
import {
  ConflictoOutboxAuditoriaRuntime
} from '../../../../paquetes/auditoria/src/RepositorioOutboxAuditoriaRuntime.js';
import {
  ConflictoIdempotenciaAuditoria,
  IncoherenciaCadenaAuditoria
} from '../../../../paquetes/auditoria/src/RepositorioAuditoria.js';
import {
  AdaptadorCoordinacionOutboxAuditoriaRuntime
} from '../../../../paquetes/auditoria/src/AdaptadorCoordinacionOutboxAuditoriaRuntime.js';

export class DespachadorOutboxAuditoriaRuntime {
  constructor({
    repositorioOutbox,
    repositorioAuditoria,
    capturadorFederacionAuditoria = null,
    instanciaId,
    concurrencia = 8,
    leaseTtlSegundos = 30,
    reintentoBaseSegundos = 5,
    reintentoMaximoSegundos = 3600,
    reloj = () => new Date()
  } = {}) {
    this.adaptador = new AdaptadorCoordinacionOutboxAuditoriaRuntime({
      repositorioOutbox,
      repositorioAuditoria,
      capturadorFederacionAuditoria
    });
    this.coordinador = new CoordinadorOperacionesDurables({
      repositorio: this.adaptador,
      instanciaId,
      ttlSegundos: normalizarEntero(leaseTtlSegundos, 5, 3600, 'leaseTtlSegundos')
    });
    this.concurrencia = normalizarEntero(concurrencia, 1, 100, 'concurrencia');
    this.reintentoBaseSegundos = normalizarEntero(
      reintentoBaseSegundos,
      1,
      3600,
      'reintentoBaseSegundos'
    );
    this.reintentoMaximoSegundos = normalizarEntero(
      reintentoMaximoSegundos,
      this.reintentoBaseSegundos,
      86_400,
      'reintentoMaximoSegundos'
    );
    this.reloj = reloj;
    this.ejecucionEnCurso = null;
  }

  async procesarPendientes({ origen = 'tick', numeroTick = null } = {}) {
    if (this.ejecucionEnCurso) return this.ejecucionEnCurso;
    this.ejecucionEnCurso = this.#procesarPendientes({ origen, numeroTick })
      .finally(() => { this.ejecucionEnCurso = null; });
    return this.ejecucionEnCurso;
  }

  async #procesarPendientes({ origen, numeroTick }) {
    const iniciadoEnUtc = this.reloj().toISOString();
    const reclamadas = [];
    let errorReclamacion = null;
    try {
      for (let indice = 0; indice < this.concurrencia; indice += 1) {
        const reclamada = await this.coordinador.reclamarSiguiente();
        if (!reclamada) break;
        reclamadas.push(reclamada);
      }
    } catch (error) {
      errorReclamacion = error;
    }

    const resultados = await Promise.all(
      reclamadas.map((reclamada) => this.#procesarUna(reclamada))
    );
    return construirResumen({
      iniciadoEnUtc,
      finalizadoEnUtc: this.reloj().toISOString(),
      origen,
      numeroTick,
      concurrencia: this.concurrencia,
      reclamadas,
      resultados,
      error: errorReclamacion
    });
  }

  async #procesarUna(reclamada) {
    try {
      const consolidada = await this.coordinador.consolidar(reclamada.lease);
      return Object.freeze({
        id: reclamada.lease.operacionId,
        eventoId: consolidada.eventoId,
        claveCadena: reclamada.operacion.claveCadena,
        estado: 'completada',
        resultadoEvento: consolidada.resultadoEvento,
        secuencia: consolidada.secuencia
      });
    } catch (error) {
      if (error instanceof LeaseOperacionDurablePerdido) {
        return resultadoLeasePerdido(reclamada, error);
      }
      const permanente = esFalloPermanente(error);
      try {
        const fallo = await this.coordinador.registrarFallo(reclamada.lease, {
          codigo: obtenerCodigo(error),
          mensaje: error?.message,
          permanente,
          demoraReintentoSegundos: calcularDemora({
            intento: reclamada.intentos,
            base: this.reintentoBaseSegundos,
            maxima: this.reintentoMaximoSegundos
          })
        });
        return Object.freeze({
          id: reclamada.lease.operacionId,
          eventoId: reclamada.operacion.eventoId,
          claveCadena: reclamada.operacion.claveCadena,
          estado: fallo.estado,
          permanente,
          codigoError: obtenerCodigo(error)
        });
      } catch (errorFallo) {
        if (errorFallo instanceof LeaseOperacionDurablePerdido) {
          return resultadoLeasePerdido(reclamada, errorFallo);
        }
        return Object.freeze({
          id: reclamada.lease.operacionId,
          eventoId: reclamada.operacion.eventoId,
          claveCadena: reclamada.operacion.claveCadena,
          estado: 'fallo_no_registrado',
          permanente: false,
          codigoError: obtenerCodigo(errorFallo)
        });
      }
    }
  }
}

function construirResumen({
  iniciadoEnUtc,
  finalizadoEnUtc,
  origen,
  numeroTick,
  concurrencia,
  reclamadas,
  resultados,
  error = null
}) {
  return Object.freeze({
    iniciadoEnUtc,
    finalizadoEnUtc,
    origen,
    numeroTick,
    concurrencia,
    totalReclamadas: reclamadas.length,
    totalCompletadas: resultados.filter(({ estado }) => estado === 'completada').length,
    totalReintentables: resultados.filter(({ estado }) => estado === 'reintentable').length,
    totalBloqueadas: resultados.filter(({ estado }) => estado === 'bloqueo_permanente').length,
    totalLeasePerdido: resultados.filter(({ estado }) => estado === 'lease_perdido').length,
    totalErrores: resultados.filter(({ estado }) => estado === 'fallo_no_registrado').length +
      (error ? 1 : 0),
    resultados: Object.freeze(resultados),
    error: error ? Object.freeze({ codigo: obtenerCodigo(error) }) : null
  });
}

function resultadoLeasePerdido(reclamada, error) {
  return Object.freeze({
    id: reclamada.lease.operacionId,
    eventoId: reclamada.operacion.eventoId,
    claveCadena: reclamada.operacion.claveCadena,
    estado: 'lease_perdido',
    permanente: false,
    codigoError: obtenerCodigo(error)
  });
}

function esFalloPermanente(error) {
  return error?.permanente === true ||
    error instanceof ConflictoIdempotenciaAuditoria ||
    error instanceof IncoherenciaCadenaAuditoria ||
    error instanceof ConflictoOutboxAuditoriaRuntime;
}

function obtenerCodigo(error) {
  return String(error?.codigo || error?.code || 'error_incorporacion_auditoria')
    .toLowerCase()
    .replace(/[^a-z0-9_.-]+/g, '_')
    .slice(0, 64) || 'error_incorporacion_auditoria';
}

function calcularDemora({ intento, base, maxima }) {
  const exponente = Math.max(0, Math.min(30, Number(intento || 1) - 1));
  return Math.min(maxima, base * (2 ** exponente));
}

function normalizarEntero(valor, minimo, maximo, nombre) {
  const numero = Number(valor);
  if (!Number.isInteger(numero) || numero < minimo || numero > maximo) {
    throw new Error(`${nombre} debe estar entre ${minimo} y ${maximo}.`);
  }
  return numero;
}

import { randomBytes } from 'node:crypto';

export class CoordinadorEmisionFederacionRuntime {
  constructor({
    repositorioCoordinacion,
    instanciaId,
    procesarFlujo = null,
    concurrencia = 4,
    leaseTtlSegundos = 30
  } = {}) {
    if (!repositorioCoordinacion?.reclamarSiguiente ||
        !repositorioCoordinacion?.renovarLease ||
        !repositorioCoordinacion?.comprobarLeaseVigente ||
        !repositorioCoordinacion?.liberarLease) {
      throw new Error('El coordinador emisor requiere persistencia de leases completa.');
    }
    this.repositorio = repositorioCoordinacion;
    this.instanciaId = textoAscii(instanciaId, 128, 'instanciaId');
    this.procesarFlujo = typeof procesarFlujo === 'function' ? procesarFlujo : null;
    this.concurrencia = enteroAcotado(concurrencia, 1, 100, 'concurrencia');
    this.leaseTtlSegundos = enteroAcotado(
      leaseTtlSegundos, 5, 3600, 'leaseTtlSegundos'
    );
    this.ejecucionEnCurso = null;
  }

  async procesarPendientes({ origen = 'tick', numeroTick = null } = {}) {
    if (!this.procesarFlujo) {
      return resumen({ origen, numeroTick, omitido: true });
    }
    if (this.ejecucionEnCurso) return this.ejecucionEnCurso;
    this.ejecucionEnCurso = this.#procesar({ origen, numeroTick })
      .finally(() => { this.ejecucionEnCurso = null; });
    return this.ejecucionEnCurso;
  }

  async #procesar({ origen, numeroTick }) {
    const reclamados = [];
    let errorReclamacion = null;
    try {
      for (let indice = 0; indice < this.concurrencia; indice += 1) {
        const reclamado = await this.repositorio.reclamarSiguiente({
          instanciaId: this.instanciaId,
          leaseToken: randomBytes(32),
          ttlSegundos: this.leaseTtlSegundos
        });
        if (!reclamado) break;
        reclamados.push(reclamado);
      }
    } catch (error) {
      errorReclamacion = error;
    }
    const resultados = await Promise.all(reclamados.map((trabajo) =>
      this.#procesarUno(trabajo)));
    return resumen({ origen, numeroTick, resultados, error: errorReclamacion });
  }

  async #procesarUno(trabajo) {
    const renovar = async () => {
      const renovado = await this.repositorio.renovarLease(trabajo.lease, {
        ttlSegundos: this.leaseTtlSegundos
      });
      if (!renovado) throw errorLeasePerdido();
      return true;
    };
    const exigirVigente = async () => {
      if (!await this.repositorio.comprobarLeaseVigente(trabajo.lease)) {
        throw errorLeasePerdido();
      }
      return true;
    };
    try {
      await this.procesarFlujo({ ...trabajo, renovar, exigirVigente });
      await exigirVigente();
      if (!await this.repositorio.liberarLease(trabajo.lease)) {
        throw errorLeasePerdido();
      }
      return Object.freeze({
        flujoId: trabajo.flujo.flujoId,
        estado: 'ciclo_completado',
        fencingToken: trabajo.lease.fencingToken
      });
    } catch (error) {
      const perdido = error?.codigo === 'lease_emision_perdido';
      if (!perdido) await this.repositorio.liberarLease(trabajo.lease).catch(() => false);
      return Object.freeze({
        flujoId: trabajo.flujo.flujoId,
        estado: perdido ? 'lease_perdido' : 'fallo_ciclo',
        codigoError: codigoSeguro(error)
      });
    }
  }
}

function resumen({
  origen,
  numeroTick,
  omitido = false,
  resultados = [],
  error = null
}) {
  return Object.freeze({
    origen,
    numeroTick,
    omitido,
    totalReclamados: resultados.length,
    totalCompletados: resultados.filter((r) => r.estado === 'ciclo_completado').length,
    totalLeasePerdido: resultados.filter((r) => r.estado === 'lease_perdido').length,
    totalFallidos: resultados.filter((r) => r.estado === 'fallo_ciclo').length,
    totalErrores: resultados.filter((r) => r.estado === 'fallo_ciclo').length +
      (error ? 1 : 0),
    resultados: Object.freeze(resultados),
    error: error ? Object.freeze({ codigo: codigoSeguro(error) }) : null
  });
}

function errorLeasePerdido() {
  const error = new Error('El escritor fue sustituido o perdió su lease.');
  error.codigo = 'lease_emision_perdido';
  return error;
}

function codigoSeguro(error) {
  return String(error?.codigo || error?.code || 'error_ciclo_emision')
    .toLowerCase().replace(/[^a-z0-9_.-]+/gu, '_').slice(0, 64);
}

function textoAscii(valor, maximo, campo) {
  const texto = String(valor || '').trim();
  if (!texto || texto.length > maximo || !/^[\x20-\x7e]+$/u.test(texto)) {
    throw new Error(`${campo} debe ser texto ASCII válido.`);
  }
  return texto;
}

function enteroAcotado(valor, minimo, maximo, campo) {
  const numero = Number(valor);
  if (!Number.isInteger(numero) || numero < minimo || numero > maximo) {
    throw new Error(`${campo} debe estar entre ${minimo} y ${maximo}.`);
  }
  return numero;
}

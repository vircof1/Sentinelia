import {
  LeaseOperacionDurablePerdido
} from '../../../../paquetes/coordinacion-durable/src/CoordinadorOperacionesDurables.js';

export class DespachadorOperacionesAdministrativasRuntime {
  constructor({
    procesadorOperaciones,
    procesadorPostcommit,
    loteOperaciones = 5,
    lotePostcommit = 25,
    reloj = () => new Date()
  } = {}) {
    if (typeof procesadorOperaciones?.procesarSiguiente !== 'function' ||
        typeof procesadorPostcommit?.procesarSiguiente !== 'function') {
      throw new Error('El despachador administrativo exige ambos procesadores.');
    }
    this.procesadorOperaciones = procesadorOperaciones;
    this.procesadorPostcommit = procesadorPostcommit;
    this.loteOperaciones = entero(loteOperaciones, 1, 100, 'loteOperaciones');
    this.lotePostcommit = entero(lotePostcommit, 1, 500, 'lotePostcommit');
    this.reloj = reloj;
    this.activo = false;
    this.ejecucionEnCurso = null;
  }

  async arrancar() {
    this.activo = true;
    return this.procesarPendientes({ origen: 'arranque', numeroTick: null });
  }

  async procesarPendientes({ origen = 'tick', numeroTick = null } = {}) {
    if (!this.activo) return resumenOmitido(origen, numeroTick, this.reloj);
    if (this.ejecucionEnCurso) return this.ejecucionEnCurso;
    this.ejecucionEnCurso = this.#procesar({ origen, numeroTick })
      .finally(() => { this.ejecucionEnCurso = null; });
    return this.ejecucionEnCurso;
  }

  async detener() {
    this.activo = false;
    if (this.ejecucionEnCurso) await this.ejecucionEnCurso;
  }

  async #procesar({ origen, numeroTick }) {
    const iniciadoEnUtc = this.reloj().toISOString();
    const operaciones = await this.#drenar(
      this.procesadorOperaciones,
      this.loteOperaciones
    );
    const postcommit = await this.#drenar(
      this.procesadorPostcommit,
      this.lotePostcommit
    );
    return Object.freeze({
      omitido: false,
      origen,
      numeroTick,
      iniciadoEnUtc,
      finalizadoEnUtc: this.reloj().toISOString(),
      operaciones: Object.freeze(operaciones),
      postcommit: Object.freeze(postcommit),
      totalOperaciones: operaciones.length,
      totalPostcommit: postcommit.length,
      totalLeasePerdido: [...operaciones, ...postcommit]
        .filter(({ estado }) => estado === 'lease_perdido').length,
      totalErrores: [...operaciones, ...postcommit]
        .filter(({ estado }) => estado === 'error_despacho').length
    });
  }

  async #drenar(procesador, limite) {
    const resultados = [];
    while (this.activo && resultados.length < limite) {
      try {
        const resultado = await procesador.procesarSiguiente();
        if (resultado === null) break;
        resultados.push(resultado);
      } catch (error) {
        if (error instanceof LeaseOperacionDurablePerdido) {
          resultados.push(Object.freeze({
            estado: 'lease_perdido',
            codigo: error.codigo
          }));
          continue;
        }
        resultados.push(Object.freeze({
          estado: 'error_despacho',
          codigo: codigoSeguro(error)
        }));
        break;
      }
    }
    return resultados;
  }
}

function resumenOmitido(origen, numeroTick, reloj) {
  const instante = reloj().toISOString();
  return Object.freeze({
    omitido: true,
    motivo: 'despachador_detenido',
    origen,
    numeroTick,
    iniciadoEnUtc: instante,
    finalizadoEnUtc: instante,
    operaciones: Object.freeze([]),
    postcommit: Object.freeze([]),
    totalOperaciones: 0,
    totalPostcommit: 0,
    totalLeasePerdido: 0,
    totalErrores: 0
  });
}

function codigoSeguro(error) {
  return String(error?.codigo || error?.code || 'error_operacion_administrativa')
    .toLowerCase()
    .replace(/[^a-z0-9_.-]+/gu, '_')
    .slice(0, 64);
}

function entero(valor, minimo, maximo, campo) {
  const numero = Number(valor);
  if (!Number.isInteger(numero) || numero < minimo || numero > maximo) {
    throw new Error(`${campo} debe estar entre ${minimo} y ${maximo}.`);
  }
  return numero;
}

export class GestorRetencionDatosFederados {
  constructor({
    servicioPoliticas,
    repositorioPurga,
    limitePorFamilia = 250,
    intervaloComprobacionMs = 60_000,
    ahoraMs = () => performance.now()
  } = {}) {
    if (
      typeof servicioPoliticas?.reconciliarLimiteGlobal !== 'function' ||
      typeof repositorioPurga?.purgarLote !== 'function' ||
      typeof repositorioPurga?.obtenerFechaSqlUtc !== 'function' ||
      typeof ahoraMs !== 'function'
    ) {
      throw new Error('La retención federada requiere políticas y purga SQL.');
    }
    this.servicioPoliticas = servicioPoliticas;
    this.repositorioPurga = repositorioPurga;
    this.limitePorFamilia = enteroPositivo(limitePorFamilia, 'limitePorFamilia');
    this.intervaloComprobacionMs = enteroPositivo(
      intervaloComprobacionMs,
      'intervaloComprobacionMs'
    );
    this.ahoraMs = ahoraMs;
    this.ultimaComprobacionMs = null;
    this.fechaSqlUtc = null;
    this.completadas = new Set();
  }

  async ejecutarSiProcede({ forzar = false } = {}) {
    const ahora = this.ahoraMs();
    if (
      !forzar && this.ultimaComprobacionMs !== null &&
      ahora - this.ultimaComprobacionMs < this.intervaloComprobacionMs
    ) {
      return resumenOmitido('intervalo_no_vencido', this.fechaSqlUtc);
    }
    this.ultimaComprobacionMs = ahora;
    const fechaSqlUtc = await this.repositorioPurga.obtenerFechaSqlUtc();
    if (fechaSqlUtc !== this.fechaSqlUtc) {
      this.fechaSqlUtc = fechaSqlUtc;
      this.completadas.clear();
    }
    const reconciliacion = await this.servicioPoliticas.reconciliarLimiteGlobal();
    const resultados = [];
    for (const { politica } of reconciliacion.resultados) {
      const clave = clavePolitica(politica);
      if (this.completadas.has(clave)) continue;
      try {
        const resultado = await this.repositorioPurga.purgarLote({
          relacionId: politica.relacionId,
          familia: politica.familia,
          limite: this.limitePorFamilia
        });
        resultados.push(resultado);
        if (!resultado.hayMas) this.completadas.add(clave);
      } catch (error) {
        resultados.push(Object.freeze({
          relacionId: politica.relacionId,
          familia: politica.familia,
          versionPolitica: politica.version,
          fechaCorteUtc: null,
          eliminados: 0,
          hayMas: true,
          motivo: 'error_purga_familia',
          codigoError: String(error?.codigo || error?.code || 'purga_federada_fallida')
        }));
      }
    }
    let purgaSensible = Object.freeze({
      declaracionesPurgadas: 0,
      sobresInboxPurgados: 0,
      sobresEmisionPurgados: 0,
      totalPurgados: 0,
      hayMas: false
    });
    if (typeof this.repositorioPurga.purgarContenidoSensibleLote === 'function') {
      try {
        purgaSensible = await this.repositorioPurga.purgarContenidoSensibleLote({
          limite: this.limitePorFamilia
        });
      } catch (error) {
        purgaSensible = Object.freeze({
          declaracionesPurgadas: 0,
          sobresInboxPurgados: 0,
          sobresEmisionPurgados: 0,
          totalPurgados: 0,
          hayMas: true,
          codigoError: String(
            error?.codigo || error?.code || 'purga_sensible_federada_fallida'
          )
        });
      }
    }
    return Object.freeze({
      ejecutada: true,
      omitida: false,
      motivo: null,
      fechaSqlUtc,
      totalFamilias: resultados.length,
      totalEliminados: resultados.reduce(
        (total, resultado) => total + resultado.eliminados,
        0
      ),
      totalSensiblesPurgados: purgaSensible.totalPurgados,
      familiasConBacklog: resultados.filter(({ hayMas }) => hayMas).length,
      backlogSensible: purgaSensible.hayMas,
      errores: resultados.filter(({ codigoError }) => codigoError).length +
        (purgaSensible.codigoError ? 1 : 0),
      resultados: Object.freeze(resultados),
      purgaSensible
    });
  }
}

function clavePolitica(politica) {
  return `${politica.relacionId}\u0000${politica.familia}\u0000${politica.version}`;
}

function resumenOmitido(motivo, fechaSqlUtc) {
  return Object.freeze({
    ejecutada: false,
    omitida: true,
    motivo,
    fechaSqlUtc,
    totalFamilias: 0,
    totalEliminados: 0,
    totalSensiblesPurgados: 0,
    familiasConBacklog: 0,
    backlogSensible: false,
    errores: 0,
    resultados: Object.freeze([])
  });
}

function enteroPositivo(valor, campo) {
  const numero = Number(valor);
  if (!Number.isInteger(numero) || numero < 1) {
    throw new Error(`${campo} debe ser un entero positivo.`);
  }
  return numero;
}

import { normalizarMarcaUtc } from '../../../../paquetes/utilidades/src/fechas/normalizarMarcaUtc.js';

function normalizarEnteroNoNegativo(valor, porDefecto = 0) {
  const convertido = Number.parseInt(String(valor ?? ''), 10);

  if (!Number.isInteger(convertido)) {
    return porDefecto;
  }

  return Math.max(0, convertido);
}

export class GestorRetencionMonitores {
  constructor({
    servicioConfiguracionPortal,
    repositorioEventosMonitor,
    repositorioHistoricoMonitores
  }) {
    this.servicioConfiguracionPortal = servicioConfiguracionPortal;
    this.repositorioEventosMonitor = repositorioEventosMonitor;
    this.repositorioHistoricoMonitores = repositorioHistoricoMonitores;
    this.ultimaClaveRetencionEjecutada = null;
  }

  // auditoria-productor: runtime.monitores.retencion_especializada
  async ejecutarSiProcede({ fechaReferenciaUtc = new Date() } = {}) {
    const configuracionPortal =
      await this.servicioConfiguracionPortal.asegurarActualizada();
    const configuracionMonitores =
      configuracionPortal.obtenerConfiguracionMonitores();
    const diasRetencion = normalizarEnteroNoNegativo(
      configuracionMonitores?.retencionEventosDias,
      0
    );

    if (diasRetencion <= 0) {
      return {
        activa: false,
        omitida: true,
        motivo: 'retencion_desactivada',
        diasRetencion,
        fechaCorteUtc: null,
        eventosEliminados: 0,
        historicosEliminados: 0
      };
    }

    const fechaCorte = this.calcularFechaCorteUtc({
      fechaReferenciaUtc,
      diasRetencion
    });
    const fechaCorteUtc = normalizarMarcaUtc(fechaCorte);
    const claveEjecucion = String(fechaCorteUtc || '').slice(0, 10);

    if (
      claveEjecucion &&
      this.ultimaClaveRetencionEjecutada === claveEjecucion
    ) {
      return {
        activa: true,
        omitida: true,
        motivo: 'retencion_ya_ejecutada_para_corte',
        diasRetencion,
        fechaCorteUtc,
        eventosEliminados: 0,
        historicosEliminados: 0
      };
    }

    const historicosEliminados =
      await this.repositorioHistoricoMonitores.eliminarAnterioresAValidoHastaUtc(
        fechaCorte
      );
    const eventosEliminados =
      await this.repositorioEventosMonitor.eliminarAnterioresAEjecutadoEnUtc(
        fechaCorte
      );

    this.ultimaClaveRetencionEjecutada = claveEjecucion || null;

    return {
      activa: true,
      omitida: false,
      motivo: 'retencion_ejecutada',
      diasRetencion,
      fechaCorteUtc,
      eventosEliminados,
      historicosEliminados
    };
  }

  calcularFechaCorteUtc({ fechaReferenciaUtc, diasRetencion }) {
    const fechaBase = new Date(fechaReferenciaUtc);

    if (Number.isNaN(fechaBase.getTime())) {
      return new Date();
    }

    fechaBase.setUTCDate(fechaBase.getUTCDate() - diasRetencion);
    return fechaBase;
  }
}

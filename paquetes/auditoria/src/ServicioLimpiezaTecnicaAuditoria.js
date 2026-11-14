export class ServicioLimpiezaTecnicaAuditoria {
  constructor({
    repositorioLimpieza,
    repositorioOperacionesDns = null
  } = {}) {
    if (!repositorioLimpieza?.ejecutarConBloqueoGlobal ||
        !repositorioLimpieza?.limpiarSesionesWeb ||
        !repositorioLimpieza?.limpiarOutboxAuditoriaCompletada ||
        !repositorioLimpieza?.limpiarEjecucionesVerificacionHistoricas ||
        !repositorioLimpieza?.limpiarIncidentesIntegridadResueltos) {
      throw new Error('ServicioLimpiezaTecnicaAuditoria requiere repositorio de limpieza completo.');
    }
    this.repositorioLimpieza = repositorioLimpieza;
    this.repositorioOperacionesDns = repositorioOperacionesDns;
  }

  async ejecutar({
    limitePorTabla = 500,
    timeoutBloqueoSegundos = 0,
    graciasSegundos = {}
  } = {}) {
    validarLimite(limitePorTabla);
    const gracias = normalizarGracias(graciasSegundos);
    const coordinado = await this.repositorioLimpieza.ejecutarConBloqueoGlobal(
      { timeoutSegundos: timeoutBloqueoSegundos },
      () => this.#ejecutarBajoBloqueo({
        limitePorTabla,
        gracias
      })
    );
    if (!coordinado.adquirido) {
      return Object.freeze({
        activa: true,
        omitida: true,
        bloqueada: true,
        motivo: coordinado.motivo,
        totalEliminadas: 0,
        tablas: Object.freeze({})
      });
    }
    return coordinado.resultado;
  }

  async #ejecutarBajoBloqueo({ limitePorTabla, gracias }) {
    const tablas = {};
    tablas.sesionesWeb =
      await this.repositorioLimpieza.limpiarSesionesWeb({
        graciaSegundos: gracias.sesionesWeb,
        limite: limitePorTabla
      });
    tablas.operacionesDns = this.repositorioOperacionesDns?.limpiarTerminales
      ? await this.repositorioOperacionesDns.limpiarTerminales({
        graciaSegundos: gracias.operacionesDns,
        lote: Math.min(limitePorTabla, 1000)
      })
      : Object.freeze({ eliminadas: 0, omitida: true });
    tablas.outboxAuditoria =
      await this.repositorioLimpieza.limpiarOutboxAuditoriaCompletada({
        graciaSegundos: gracias.outboxAuditoria,
        limite: limitePorTabla
      });
    tablas.ejecucionesVerificacion =
      await this.repositorioLimpieza.limpiarEjecucionesVerificacionHistoricas({
        graciaSegundos: gracias.ejecucionesVerificacion,
        limite: limitePorTabla
      });
    tablas.incidentesIntegridad =
      await this.repositorioLimpieza.limpiarIncidentesIntegridadResueltos({
        graciaSegundos: gracias.incidentesIntegridad,
        limite: limitePorTabla
      });

    const totalEliminadas = Object.values(tablas)
      .reduce((total, resultado) => total + (Number(resultado.eliminadas) || 0), 0);
    return Object.freeze({
      activa: true,
      omitida: false,
      bloqueada: false,
      motivo: 'limpieza_tecnica_ejecutada',
      totalEliminadas,
      backlogPosible: Object.values(tablas)
        .some((resultado) => Number(resultado.eliminadas) >= limitePorTabla),
      tablas: congelarTablas(tablas)
    });
  }
}

function normalizarGracias(gracias = {}) {
  return Object.freeze({
    sesionesWeb: enteroNoNegativo(gracias.sesionesWeb ?? 86_400, 'sesionesWeb'),
    operacionesDns: enteroNoNegativo(gracias.operacionesDns ?? 3_600, 'operacionesDns'),
    outboxAuditoria: enteroNoNegativo(gracias.outboxAuditoria ?? 86_400, 'outboxAuditoria'),
    ejecucionesVerificacion: enteroNoNegativo(
      gracias.ejecucionesVerificacion ?? 2_592_000,
      'ejecucionesVerificacion'
    ),
    incidentesIntegridad: enteroNoNegativo(
      gracias.incidentesIntegridad ?? 7_776_000,
      'incidentesIntegridad'
    )
  });
}

function validarLimite(limite) {
  if (!Number.isInteger(limite) || limite < 1 || limite > 5000) {
    throw new Error('limitePorTabla debe estar entre 1 y 5000.');
  }
}

function enteroNoNegativo(valor, nombre) {
  const numero = Number(valor);
  if (!Number.isInteger(numero) || numero < 0 || numero > 31_536_000) {
    throw new Error(`La gracia ${nombre} debe estar entre 0 y 31536000 segundos.`);
  }
  return numero;
}

function congelarTablas(tablas) {
  return Object.freeze(Object.fromEntries(
    Object.entries(tablas).map(([clave, valor]) => [
      clave,
      Object.freeze({ ...valor })
    ])
  ));
}

export const __testablesServicioLimpiezaTecnicaAuditoria = Object.freeze({
  normalizarGracias
});

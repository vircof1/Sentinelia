function parsearFechaUtc(valor) {
  if (!valor) {
    return null;
  }

  const ms = Date.parse(String(valor));
  return Number.isNaN(ms) ? null : ms;
}

function formatearFechaUtcDesdeMs(valorMs) {
  return new Date(valorMs).toISOString();
}

function compararProgramaciones(a, b) {
  if (a.proximoIntentoEn < b.proximoIntentoEn) {
    return -1;
  }

  if (a.proximoIntentoEn > b.proximoIntentoEn) {
    return 1;
  }

  return a.ordenCatalogo - b.ordenCatalogo;
}

function resolverVencimientoRetardoMs(estadoActual) {
  const retardo = estadoActual?.resultadoActual?.metricaPrincipal?.retardoSenal;

  if (!retardo?.pendiente || !retardo.venceEnUtc) {
    return null;
  }

  return parsearFechaUtc(retardo.venceEnUtc);
}

function resolverVencimientoEntradaFederadaMs(estadoActual) {
  const venceEnUtc = estadoActual?.resultadoActual?.metricaPrincipal
    ?.proximoVencimientoEntradaFederadaUtc;
  return parsearFechaUtc(venceEnUtc);
}

export class SelectorMonitoresVencidos {
  seleccionar({
    catalogoOperativo,
    almacenEstadoActual,
    fechaEvaluacionUtc = new Date().toISOString()
  }) {
    const fechaEvaluacionMs =
      parsearFechaUtc(fechaEvaluacionUtc) ?? Date.now();
    const programaciones = [];

    for (const [ordenCatalogo, monitor] of catalogoOperativo.monitores.entries()) {
      if (!monitor?.activo) {
        continue;
      }

      const estadoActual = almacenEstadoActual.buscarPorMonitorId(monitor.id);

      if (!estadoActual) {
        continue;
      }

      programaciones.push(
        this.calcularProgramacion({
          monitor,
          estadoActual,
          ordenCatalogo,
          fechaEvaluacionMs
        })
      );
    }

    const programacionesOrdenadas = [...programaciones].sort(compararProgramaciones);
    const monitoresVencidos = programacionesOrdenadas.filter(
      (item) => item.vencido
    );
    const proximos = programacionesOrdenadas.filter((item) => !item.vencido);

    return {
      fechaEvaluacionUtc: formatearFechaUtcDesdeMs(fechaEvaluacionMs),
      totalConsiderados: programacionesOrdenadas.length,
      totalVencidos: monitoresVencidos.length,
      totalPendientesFuturos: proximos.length,
      proximoIntentoGlobalEn: programacionesOrdenadas[0]?.proximoIntentoEn || null,
      monitoresVencidos: monitoresVencidos.map((item) =>
        this.serializarCandidato(item)
      ),
      programaciones: programacionesOrdenadas
    };
  }

  calcularProgramacion({
    monitor,
    estadoActual,
    ordenCatalogo,
    fechaEvaluacionMs
  }) {
    const intervaloMs = monitor.programacion.intervaloEjecucionSegundos * 1000;
    const desfaseMs = monitor.programacion.desfaseInicialSegundos * 1000;
    const ultimaEjecucionMs = parsearFechaUtc(estadoActual.fechaUltimaEjecucionUtc);

    let proximoIntentoMs;
    let motivoProgramacion;

    if (ultimaEjecucionMs != null) {
      proximoIntentoMs = ultimaEjecucionMs + intervaloMs;
      motivoProgramacion = 'intervalo_desde_ultima_ejecucion';
    } else {
      const referenciaMs =
        parsearFechaUtc(monitor.version) ?? fechaEvaluacionMs;
      const primerIntentoMs = referenciaMs + desfaseMs;

      if (fechaEvaluacionMs <= primerIntentoMs) {
        proximoIntentoMs = primerIntentoMs;
        motivoProgramacion = 'desfase_inicial';
      } else {
        const ciclos = Math.floor(
          (fechaEvaluacionMs - primerIntentoMs) / intervaloMs
        );
        proximoIntentoMs = primerIntentoMs + (ciclos * intervaloMs);
        motivoProgramacion = 'primera_ejecucion_pendiente';
      }
    }

    const vencimientoRetardoMs = resolverVencimientoRetardoMs(estadoActual);

    if (
      vencimientoRetardoMs != null &&
      vencimientoRetardoMs < proximoIntentoMs
    ) {
      proximoIntentoMs = vencimientoRetardoMs;
      motivoProgramacion = 'retardo_senal_vencido';
    }

    const vencimientoEntradaFederadaMs =
      resolverVencimientoEntradaFederadaMs(estadoActual);
    if (
      vencimientoEntradaFederadaMs != null &&
      vencimientoEntradaFederadaMs < proximoIntentoMs
    ) {
      proximoIntentoMs = vencimientoEntradaFederadaMs;
      motivoProgramacion = 'retardo_entrada_federada_vencido';
    }

    const vencido = proximoIntentoMs <= fechaEvaluacionMs;
    const retrasoSegundos = vencido
      ? Math.floor((fechaEvaluacionMs - proximoIntentoMs) / 1000)
      : 0;

    return {
      monitorId: monitor.id,
      nombre: monitor.nombre,
      tipo: monitor.tipo,
      versionCatalogo: monitor.version,
      scope: {
        ...monitor.scope
      },
      ordenCatalogo,
      intervaloEjecucionSegundos: monitor.programacion.intervaloEjecucionSegundos,
      desfaseInicialSegundos: monitor.programacion.desfaseInicialSegundos,
      fechaUltimaEjecucionUtc: estadoActual.fechaUltimaEjecucionUtc || null,
      proximoIntentoEn: formatearFechaUtcDesdeMs(proximoIntentoMs),
      vencido,
      retrasoSegundos,
      motivoProgramacion
    };
  }

  serializarCandidato(item) {
    return {
      monitorId: item.monitorId,
      nombre: item.nombre,
      tipo: item.tipo,
      versionCatalogo: item.versionCatalogo,
      scope: {
        tenantId: item.scope?.tenantId ?? null,
        empresaId: item.scope?.empresaId ?? null,
        sitioId: item.scope?.sitioId ?? null,
        nivelPertenencia: item.scope?.nivelPertenencia ?? null
      },
      proximoIntentoEn: item.proximoIntentoEn,
      retrasoSegundos: item.retrasoSegundos,
      motivoProgramacion: item.motivoProgramacion
    };
  }
}

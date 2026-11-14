import { EventoMonitor } from '../../../../paquetes/monitores/src/EventoMonitor.js';
import { normalizarMarcaUtc } from '../../../../paquetes/utilidades/src/fechas/normalizarMarcaUtc.js';
import { enlazarRepositorioAConexion } from '../persistencia/RepositorioEnTransaccion.js';

function clonarObjetoPlano(valor) {
  if (Array.isArray(valor)) {
    return JSON.parse(JSON.stringify(valor));
  }

  if (!valor || typeof valor !== 'object') {
    return null;
  }

  return JSON.parse(JSON.stringify(valor));
}

function normalizarEnteroNoNegativo(valor, porDefecto = 0) {
  const convertido = Number.parseInt(String(valor ?? ''), 10);

  if (!Number.isInteger(convertido)) {
    return porDefecto;
  }

  return Math.max(0, convertido);
}

function normalizarTexto(valor) {
  return String(valor ?? '').trim();
}

export class ServicioEventosMonitores {
  constructor({
    repositorioEventosMonitor,
    servicioConfiguracionPortal
  }) {
    this.repositorioEventosMonitor = repositorioEventosMonitor;
    this.servicioConfiguracionPortal = servicioConfiguracionPortal;
  }

  async guardarResultadosEjecucion(
    { catalogoOperativo, resultados = [] },
    { conexion = null } = {}
  ) {
    const resumen = {
      totalResultados: Array.isArray(resultados) ? resultados.length : 0,
      totalConstruidos: 0,
      totalPersistidos: 0,
      eventosPersistidos: [],
      totalDescartados: 0,
      monitorIdsPersistidos: [],
      resultadosDescartados: []
    };

    if (!Array.isArray(resultados) || resultados.length === 0) {
      return resumen;
    }

    const eventos = [];

    for (const resultado of resultados) {
      const evento = this.construirEventoDesdeResultado({
        catalogoOperativo,
        resultado
      });

      if (!evento) {
        resumen.totalDescartados += 1;
        resumen.resultadosDescartados.push({
          monitorId: Number(resultado?.monitorId || 0) || null,
          codigoResultado: String(resultado?.codigoResultado || 'sin_resultado'),
          motivo: 'resultado_sin_snapshot_minimo'
        });
        continue;
      }

      eventos.push(evento);
    }

    resumen.totalConstruidos = eventos.length;

    if (eventos.length === 0) {
      return resumen;
    }

    const repositorio = enlazarRepositorioAConexion(this.repositorioEventosMonitor, conexion);
    const eventosPersistibles = await this.resolverEventosPersistibles(eventos, repositorio);

    if (eventosPersistibles.length === 0) {
      return resumen;
    }

    const persistencia =
      await repositorio.guardarEventosDetallado(
        eventosPersistibles
      );

    resumen.totalPersistidos = persistencia.totalPersistidos;
    resumen.eventosPersistidos = persistencia.eventosPersistidos;
    resumen.monitorIdsPersistidos = persistencia.eventosPersistidos.map(
      (evento) => evento.monitorId
    );
    return resumen;
  }

  async resolverEventosPersistibles(
    eventos = [],
    repositorioEventosMonitor = this.repositorioEventosMonitor
  ) {
    if (!Array.isArray(eventos) || eventos.length === 0) {
      return [];
    }

    const porcentajeCompactacion =
      await this.obtenerPorcentajeCompactacionSerie();

    if (porcentajeCompactacion <= 0) {
      return eventos;
    }

    const idsMonitor = [
      ...new Set(
        eventos
          .map((evento) => normalizarEnteroNoNegativo(evento?.monitorId, 0))
          .filter((id) => id > 0)
      )
    ];
    const eventosPrevios =
      await repositorioEventosMonitor.listarUltimosPorMonitorIds(idsMonitor);
    const ultimoEventoPorMonitor = new Map(
      eventosPrevios.map((evento) => [evento.monitorId, evento])
    );
    const persistibles = [];

    for (const evento of eventos) {
      const ultimoEvento = ultimoEventoPorMonitor.get(evento.monitorId) || null;

      if (
        this.debePersistirEvento({
          eventoActual: evento,
          ultimoEvento,
          porcentajeCompactacion
        })
      ) {
        persistibles.push(evento);
        ultimoEventoPorMonitor.set(evento.monitorId, evento);
      }
    }

    return persistibles;
  }

  async obtenerPorcentajeCompactacionSerie() {
    if (!this.servicioConfiguracionPortal) {
      return 0;
    }

    const configuracionPortal =
      await this.servicioConfiguracionPortal.asegurarActualizada();
    const configuracionMonitores =
      configuracionPortal.obtenerConfiguracionMonitores();

    return normalizarEnteroNoNegativo(
      configuracionMonitores?.compactacionSerieVariacionPorcentaje,
      0
    );
  }

  debePersistirEvento({
    eventoActual,
    ultimoEvento,
    porcentajeCompactacion
  }) {
    if (!ultimoEvento) {
      return true;
    }

    if (
      eventoActual.monitorId !== ultimoEvento.monitorId ||
      eventoActual.tenantId !== ultimoEvento.tenantId ||
      eventoActual.empresaId !== ultimoEvento.empresaId ||
      (eventoActual.sitioId || null) !== (ultimoEvento.sitioId || null) ||
      eventoActual.versionCatalogo !== ultimoEvento.versionCatalogo ||
      eventoActual.tipoMonitor !== ultimoEvento.tipoMonitor
    ) {
      return true;
    }

    if (
      eventoActual.estadoDetectado !== ultimoEvento.estadoDetectado ||
      eventoActual.codigoResultado !== ultimoEvento.codigoResultado ||
      Boolean(eventoActual.exito) !== Boolean(ultimoEvento.exito)
    ) {
      return true;
    }

    const valorActualMs = this.resolverValorReferenciaMs(eventoActual);
    const valorPrevioMs = this.resolverValorReferenciaMs(ultimoEvento);

    if (valorActualMs == null || valorPrevioMs == null) {
      return true;
    }

    const deltaMs = Math.abs(valorActualMs - valorPrevioMs);

    if (deltaMs <= 0) {
      return false;
    }

    const umbralVariacionMs = Math.max(
      1,
      Math.ceil((valorPrevioMs * porcentajeCompactacion) / 100)
    );

    return deltaMs >= umbralVariacionMs;
  }

  resolverValorReferenciaMs(evento) {
    if (!evento || typeof evento !== 'object') {
      return null;
    }

    const tipo = String(evento.tipoMonitor || '').trim().toLowerCase();
    const exitoTecnico = this.resolverExitoTecnicoEvento(evento);
    const rttMs = Number(evento?.payloadEvento?.metricaPrincipal?.rttMs);
    const timeoutMs = Number(evento?.payloadEvento?.protocolo?.timeoutMs);
    const duracionTotalMs = Number(evento?.duracionTotalMs);

    if (tipo === 'ping') {
      if (exitoTecnico && Number.isFinite(rttMs)) {
        return rttMs;
      }

      if (Number.isFinite(timeoutMs) && timeoutMs > 0) {
        return timeoutMs;
      }

      if (Number.isFinite(duracionTotalMs) && duracionTotalMs >= 0) {
        return duracionTotalMs;
      }

      return null;
    }

    if (exitoTecnico && Number.isFinite(duracionTotalMs) && duracionTotalMs >= 0) {
      return duracionTotalMs;
    }

    if (Number.isFinite(timeoutMs) && timeoutMs > 0) {
      return timeoutMs;
    }

    if (Number.isFinite(duracionTotalMs) && duracionTotalMs >= 0) {
      return duracionTotalMs;
    }

    return null;
  }

  resolverExitoTecnicoEvento(evento) {
    if (evento?.exitoTecnico != null) {
      return Boolean(evento.exitoTecnico);
    }

    if (evento?.payloadEvento?.exitoTecnico != null) {
      return Boolean(evento.payloadEvento.exitoTecnico);
    }

    return Boolean(evento?.exito);
  }

  construirEventoDesdeResultado({ catalogoOperativo, resultado }) {
    if (!resultado || typeof resultado !== 'object') {
      return null;
    }

    const monitorCatalogo = resultado.monitorId != null
      ? catalogoOperativo?.buscarPorId?.(resultado.monitorId)
      : null;
    const scope = this.normalizarScopeResultado(
      resultado.scope || monitorCatalogo?.scope || null
    );
    const monitorId = normalizarEnteroNoNegativo(
      resultado.monitorId || monitorCatalogo?.id,
      0
    );
    const versionCatalogo = String(
      resultado.versionCatalogo || monitorCatalogo?.version || ''
    ).trim();
    const tipoMonitor = String(resultado.tipo || monitorCatalogo?.tipo || '')
      .trim()
      .toLowerCase();

    if (
      monitorId <= 0 ||
      scope == null ||
      !versionCatalogo ||
      !tipoMonitor
    ) {
      return null;
    }

    return new EventoMonitor({
      monitor_id: monitorId,
      tenant_id: scope.tenantId,
      empresa_id: scope.empresaId,
      sitio_id: scope.sitioId,
      version_catalogo: versionCatalogo,
      tipo_monitor: tipoMonitor,
      estado_detectado: String(
        resultado.estadoDetectado || (resultado.exito ? 'disponible' : 'indisponible')
      )
        .trim()
        .toLowerCase(),
      codigo_resultado: String(resultado.codigoResultado || 'sin_resultado').trim(),
      mensaje_resultado: String(
        resultado.mensajeResultado || 'Sin mensaje de resultado.'
      ).trim(),
      exito: Boolean(resultado.exito),
      duracion_total_ms: normalizarEnteroNoNegativo(resultado.duracionTotalMs, 0),
      ejecutado_en_utc: normalizarMarcaUtc(
        resultado.finalizadoEnUtc || resultado.ejecutadoEnUtc || new Date()
      ),
      payload_evento: this.construirPayloadEvento({
        monitor: monitorCatalogo,
        resultado
      })
    });
  }

  construirPayloadEvento({ monitor, resultado }) {
    return {
      nombreMonitor: String(resultado?.nombre || monitor?.nombre || '').trim() || null,
      finalizadoEnUtc: normalizarMarcaUtc(resultado?.finalizadoEnUtc),
      descripcionFallo: normalizarTexto(
        resultado?.descripcionFallo || monitor?.descripcionFallo
      ),
      posibleSolucion: normalizarTexto(
        resultado?.posibleSolucion || monitor?.posibleSolucion
      ),
      interpretacionEstado: resultado?.interpretacionEstado || 'normal',
      exitoTecnico:
        resultado?.exitoTecnico == null ? Boolean(resultado?.exito) : Boolean(resultado.exitoTecnico),
      estadoTecnicoDetectado: resultado?.estadoTecnicoDetectado || null,
      codigoResultadoTecnico: resultado?.codigoResultadoTecnico || null,
      mensajeResultadoTecnico: resultado?.mensajeResultadoTecnico || null,
      interpretacionResultado: clonarObjetoPlano(
        resultado?.interpretacionResultado
      ),
      detalleError: clonarObjetoPlano(resultado?.detalleError),
      detalleErrorTecnico: clonarObjetoPlano(resultado?.detalleErrorTecnico),
      metricaPrincipal: clonarObjetoPlano(resultado?.metricaPrincipal),
      protocolo: clonarObjetoPlano(resultado?.protocolo),
      programacion: clonarObjetoPlano(resultado?.programacion),
      intentosRealizados: normalizarEnteroNoNegativo(
        resultado?.intentosRealizados,
        0
      ),
      intentoExitoso:
        resultado?.intentoExitoso == null
          ? null
          : normalizarEnteroNoNegativo(resultado.intentoExitoso, 0),
      intentos: clonarObjetoPlano(resultado?.intentos) || [],
      scope: this.normalizarScopePayload(resultado?.scope || monitor?.scope || null)
    };
  }

  normalizarScopeResultado(scope) {
    const tenantId = normalizarEnteroNoNegativo(scope?.tenantId, 0);
    const empresaId = normalizarEnteroNoNegativo(scope?.empresaId, 0);
    const sitioId = scope?.sitioId == null || String(scope?.sitioId).trim() === ''
      ? null
      : normalizarEnteroNoNegativo(scope?.sitioId, 0);

    if (tenantId <= 0 || empresaId <= 0) {
      return null;
    }

    return {
      tenantId,
      empresaId,
      sitioId
    };
  }

  normalizarScopePayload(scope) {
    const normalizado = this.normalizarScopeResultado(scope);

    if (!normalizado) {
      return null;
    }

    return {
      tenantId: normalizado.tenantId,
      empresaId: normalizado.empresaId,
      sitioId: normalizado.sitioId,
      nivelPertenencia: scope?.nivelPertenencia || null
    };
  }
}

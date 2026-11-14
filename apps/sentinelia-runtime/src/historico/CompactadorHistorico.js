import { TramoHistoricoMonitor } from '../../../../paquetes/monitores/src/TramoHistoricoMonitor.js';
import { normalizarMarcaUtc } from '../../../../paquetes/utilidades/src/fechas/normalizarMarcaUtc.js';

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

export class CompactadorHistorico {
  resolverSnapshotResultado({
    catalogoOperativo,
    resultado,
    eventoPersistido = null,
    configuracionMonitores = null
  }) {
    if (!resultado || typeof resultado !== 'object') {
      return null;
    }

    const monitorCatalogo = resultado.monitorId != null
      ? catalogoOperativo?.buscarPorId?.(resultado.monitorId)
      : null;
    const monitorId = normalizarEnteroNoNegativo(
      resultado.monitorId || monitorCatalogo?.id,
      0
    );
    const scope = this.normalizarScope(
      resultado.scope || monitorCatalogo?.scope || null
    );
    const versionCatalogo = String(
      resultado.versionCatalogo || monitorCatalogo?.version || ''
    ).trim();
    const tipoMonitor = String(resultado.tipo || monitorCatalogo?.tipo || '')
      .trim()
      .toLowerCase();
    const fechaEjecucionUtc = normalizarMarcaUtc(
      resultado.finalizadoEnUtc || resultado.ejecutadoEnUtc || new Date()
    );
    const estadoDetectado = String(
      resultado.estadoDetectado || (resultado.exito ? 'disponible' : 'indisponible')
    )
      .trim()
      .toLowerCase();

    if (
      monitorId <= 0 ||
      scope == null ||
      !versionCatalogo ||
      !tipoMonitor ||
      !fechaEjecucionUtc
    ) {
      return null;
    }

    const firmaCompactacion = this.resolverFirmaCompactacion({
      tipoMonitor,
      estadoDetectado,
      versionCatalogo,
      resultado,
      configuracionMonitores
    });

    return {
      monitorId,
      scope,
      versionCatalogo,
      tipoMonitor,
      fechaEjecucionUtc,
      estadoDetectado,
      codigoResultado: String(resultado.codigoResultado || 'sin_resultado').trim(),
      mensajeResultado: String(
        resultado.mensajeResultado || 'Sin mensaje de resultado.'
      ).trim(),
      nombreMonitor: String(resultado.nombre || monitorCatalogo?.nombre || '').trim() ||
        null,
      descripcionFallo: normalizarTexto(
        resultado.descripcionFallo || monitorCatalogo?.descripcionFallo
      ),
      posibleSolucion: normalizarTexto(
        resultado.posibleSolucion || monitorCatalogo?.posibleSolucion
      ),
      eventoPersistido,
      resultado,
      firmaCompactacion
    };
  }

  resolverDecision({ snapshot, tramoActual = null }) {
    if (!snapshot) {
      return {
        accion: 'descartar',
        motivo: 'snapshot_invalido'
      };
    }

    if (!tramoActual) {
      return {
        accion: 'crear',
        motivo: 'sin_tramo_previo',
        nuevoTramo: this.construirNuevoTramo({ snapshot })
      };
    }

    const fechaActualMs = Date.parse(String(tramoActual.validoHastaUtc || ''));
    const fechaResultadoMs = Date.parse(String(snapshot.fechaEjecucionUtc || ''));

    if (
      !Number.isNaN(fechaActualMs) &&
      !Number.isNaN(fechaResultadoMs) &&
      fechaResultadoMs < fechaActualMs
    ) {
      return {
        accion: 'descartar',
        motivo: 'resultado_fuera_de_orden'
      };
    }

    if (this.debeExtenderTramoActual({ tramoActual, snapshot })) {
      return {
        accion: 'extender',
        motivo: 'firma_equivalente',
        tramoActualizado: this.extenderTramoActual({ tramoActual, snapshot })
      };
    }

    return {
      accion: 'crear',
      motivo: 'transicion_compactacion',
      nuevoTramo: this.construirNuevoTramo({ snapshot })
    };
  }

  debeExtenderTramoActual({ tramoActual, snapshot }) {
    const firmaActual = this.resolverFirmaTramoActual(tramoActual);

    return (
      tramoActual.monitorId === snapshot.monitorId &&
      tramoActual.tenantId === snapshot.scope.tenantId &&
      tramoActual.empresaId === snapshot.scope.empresaId &&
      (tramoActual.sitioId || null) === (snapshot.scope.sitioId || null) &&
      tramoActual.versionCatalogo === snapshot.versionCatalogo &&
      tramoActual.tipoMonitor === snapshot.tipoMonitor &&
      tramoActual.estadoTramo === snapshot.estadoDetectado &&
      firmaActual.familiaResultado ===
        snapshot.firmaCompactacion.familiaResultado &&
      firmaActual.variante === snapshot.firmaCompactacion.variante
    );
  }

  construirNuevoTramo({ snapshot }) {
    return new TramoHistoricoMonitor({
      monitor_id: snapshot.monitorId,
      tenant_id: snapshot.scope.tenantId,
      empresa_id: snapshot.scope.empresaId,
      sitio_id: snapshot.scope.sitioId,
      version_catalogo: snapshot.versionCatalogo,
      tipo_monitor: snapshot.tipoMonitor,
      estado_tramo: snapshot.estadoDetectado,
      codigo_ultimo_resultado: snapshot.codigoResultado,
      mensaje_ultimo_resultado: snapshot.mensajeResultado,
      valido_desde_utc: snapshot.fechaEjecucionUtc,
      valido_hasta_utc: snapshot.fechaEjecucionUtc,
      contador_repeticiones: 1,
      ultimo_evento_id: snapshot.eventoPersistido?.id || null,
      payload_tramo: this.construirPayloadTramo({
        snapshot,
        contadorRepeticiones: 1
      })
    });
  }

  extenderTramoActual({ tramoActual, snapshot }) {
    return new TramoHistoricoMonitor({
      id: tramoActual.id,
      monitor_id: tramoActual.monitorId,
      tenant_id: tramoActual.tenantId,
      empresa_id: tramoActual.empresaId,
      sitio_id: tramoActual.sitioId,
      version_catalogo: tramoActual.versionCatalogo,
      tipo_monitor: tramoActual.tipoMonitor,
      estado_tramo: tramoActual.estadoTramo,
      codigo_ultimo_resultado: snapshot.codigoResultado,
      mensaje_ultimo_resultado: snapshot.mensajeResultado,
      valido_desde_utc: normalizarMarcaUtc(tramoActual.validoDesdeUtc),
      valido_hasta_utc: snapshot.fechaEjecucionUtc,
      contador_repeticiones: Math.max(1, tramoActual.contadorRepeticiones + 1),
      ultimo_evento_id: snapshot.eventoPersistido?.id || tramoActual.ultimoEventoId,
      payload_tramo: this.construirPayloadTramo({
        snapshot,
        contadorRepeticiones: Math.max(1, tramoActual.contadorRepeticiones + 1),
        validoDesdeUtc: tramoActual.validoDesdeUtc
      })
    });
  }

  construirPayloadTramo({
    snapshot,
    contadorRepeticiones,
    validoDesdeUtc = null
  }) {
    return {
      nombreMonitor: snapshot.nombreMonitor,
      finalizadoEnUtc: snapshot.fechaEjecucionUtc,
      codigoResultado: snapshot.codigoResultado,
      mensajeResultado: snapshot.mensajeResultado,
      descripcionFallo: snapshot.descripcionFallo,
      posibleSolucion: snapshot.posibleSolucion,
      interpretacionEstado: snapshot.resultado?.interpretacionEstado || 'normal',
      exitoTecnico:
        snapshot.resultado?.exitoTecnico == null
          ? Boolean(snapshot.resultado?.exito)
          : Boolean(snapshot.resultado.exitoTecnico),
      estadoTecnicoDetectado: snapshot.resultado?.estadoTecnicoDetectado || null,
      codigoResultadoTecnico: snapshot.resultado?.codigoResultadoTecnico || null,
      mensajeResultadoTecnico:
        snapshot.resultado?.mensajeResultadoTecnico || null,
      interpretacionResultado: clonarObjetoPlano(
        snapshot.resultado?.interpretacionResultado
      ),
      compactacion: {
        familiaResultado: snapshot.firmaCompactacion.familiaResultado,
        variante: snapshot.firmaCompactacion.variante,
        razonVariante: snapshot.firmaCompactacion.razonVariante,
        cercaFallo: snapshot.firmaCompactacion.cercaFallo,
        porcentajeCercaFallo: snapshot.firmaCompactacion.porcentajeCercaFallo
      },
      detalleError: clonarObjetoPlano(snapshot.resultado?.detalleError),
      detalleErrorTecnico: clonarObjetoPlano(
        snapshot.resultado?.detalleErrorTecnico
      ),
      metricaPrincipal: clonarObjetoPlano(snapshot.resultado?.metricaPrincipal),
      protocolo: clonarObjetoPlano(snapshot.resultado?.protocolo),
      programacion: clonarObjetoPlano(snapshot.resultado?.programacion),
      intentosRealizados: normalizarEnteroNoNegativo(
        snapshot.resultado?.intentosRealizados,
        0
      ),
      intentoExitoso:
        snapshot.resultado?.intentoExitoso == null
          ? null
          : normalizarEnteroNoNegativo(snapshot.resultado?.intentoExitoso, 0),
      scope: {
        tenantId: snapshot.scope.tenantId,
        empresaId: snapshot.scope.empresaId,
        sitioId: snapshot.scope.sitioId,
        nivelPertenencia: snapshot.scope.nivelPertenencia || null
      },
      validoDesdeUtc: normalizarMarcaUtc(validoDesdeUtc || snapshot.fechaEjecucionUtc),
      contadorRepeticiones
    };
  }

  resolverFirmaTramoActual(tramoActual) {
    const compactacion = tramoActual?.payloadTramo?.compactacion || {};

    return {
      familiaResultado:
        String(compactacion.familiaResultado || '').trim() ||
        this.normalizarFamiliaResultado({
          tipoMonitor: tramoActual?.tipoMonitor,
          codigoResultado: tramoActual?.codigoUltimoResultado
        }),
      variante: String(compactacion.variante || 'estable').trim().toLowerCase()
    };
  }

  resolverFirmaCompactacion({
    tipoMonitor,
    estadoDetectado,
    versionCatalogo,
    resultado,
    configuracionMonitores = null
  }) {
    const familiaResultado = this.normalizarFamiliaResultado({
      tipoMonitor,
      codigoResultado: resultado?.codigoResultado
    });
    const sensibilidad = this.resolverSensibilidadCercaFallo({
      tipoMonitor,
      estadoDetectado,
      versionCatalogo,
      resultado,
      configuracionMonitores
    });

    return {
      estadoDetectado,
      versionCatalogo,
      familiaResultado,
      variante: sensibilidad.activa ? 'cerca_fallo' : 'estable',
      razonVariante: sensibilidad.razon,
      cercaFallo: sensibilidad.activa,
      porcentajeCercaFallo: sensibilidad.porcentaje
    };
  }

  resolverSensibilidadCercaFallo({
    tipoMonitor,
    estadoDetectado,
    resultado,
    configuracionMonitores = null
  }) {
    const porcentaje = Math.max(
      0,
      normalizarEnteroNoNegativo(
        configuracionMonitores?.compactacionCercaFalloPorcentaje,
        0
      )
    );

    if (
      tipoMonitor !== 'tcp' ||
      estadoDetectado !== 'disponible' ||
      !resultado?.protocolo?.usarTls
    ) {
      return {
        activa: false,
        razon: 'sin_regla_aplicable',
        porcentaje
      };
    }

    const diasMinimos = normalizarEnteroNoNegativo(
      resultado?.metricaPrincipal?.certificadoVigenciaMinimaDias,
      0
    );
    const diasRestantes = resultado?.metricaPrincipal?.certificadoDiasRestantes;

    if (diasMinimos <= 0 || !Number.isFinite(diasRestantes)) {
      return {
        activa: false,
        razon: 'tls_sin_umbral_vigencia',
        porcentaje
      };
    }

    const margenDias = Math.ceil((diasMinimos * porcentaje) / 100);
    const umbralCercania = diasMinimos + margenDias;

    return {
      activa: Number(diasRestantes) <= umbralCercania,
      razon: 'tls_vigencia_cercana',
      porcentaje
    };
  }

  normalizarFamiliaResultado({ tipoMonitor, codigoResultado }) {
    const codigo = String(codigoResultado || 'sin_resultado').trim().toLowerCase();
    const tipo = String(tipoMonitor || '').trim().toLowerCase();

    if (
      codigo === 'monitor_no_encontrado' ||
      codigo === 'tipo_no_soportado' ||
      codigo === 'sin_resultado'
    ) {
      return 'runtime';
    }

    if (codigo === 'fallo_por_respuesta') {
      return 'interpretacion_fallo_por_respuesta';
    }

    if (codigo === 'ausencia_respuesta_esperada') {
      return 'interpretacion_ausencia_esperada';
    }

    if (tipo === 'ping') {
      if (codigo === 'respuesta_icmp') {
        return 'ok';
      }

      if (codigo === 'timeout_icmp') {
        return 'icmp_timeout';
      }

      return 'icmp_fallo';
    }

    if (tipo === 'tcp') {
      if (codigo === 'conexion_tcp_ok' || codigo === 'conexion_tls_ok') {
        return 'ok';
      }

      if (codigo === 'timeout_tcp' || codigo === 'timeout_tls') {
        return 'tcp_timeout';
      }

      if (codigo === 'tls_no_autorizado') {
        return 'tls_no_autorizado';
      }

      if (
        codigo === 'tls_vigencia_indeterminada' ||
        codigo === 'tls_vigencia_insuficiente'
      ) {
        return 'tls_vigencia';
      }

      return 'tcp_fallo';
    }

    return `resultado:${codigo.slice(0, 80)}`;
  }

  normalizarScope(scope) {
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
      sitioId,
      nivelPertenencia: scope?.nivelPertenencia || null
    };
  }
}

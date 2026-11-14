import { AlertaActivaMonitor } from '../../../../paquetes/monitores/src/AlertaActivaMonitor.js';
import {
  generarUuidV7Auditoria,
  uuidV7AuditoriaABytes
} from '../../../../paquetes/auditoria/src/UuidV7Auditoria.js';
import { PERFIL_JCS_AUDITORIA_V1 } from '../../../../paquetes/auditoria/src/PerfilJcsAuditoria.js';
import { VERSION_ENCADENADO_AUDITORIA_V1 } from '../../../../paquetes/auditoria/src/SobreCanonicoAuditoria.js';
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

export class GestorAlertasActivasMonitor {
  constructor({
    repositorioAlertasActivasMonitor,
    repositorioOutboxAuditoriaRuntime = null,
    capturadorFederacionMonitores = null,
    runtimeActorId = 'sentinelia-runtime',
    reloj = () => new Date()
  }) {
    this.repositorioAlertasActivasMonitor = repositorioAlertasActivasMonitor;
    this.repositorioOutboxAuditoriaRuntime = repositorioOutboxAuditoriaRuntime;
    this.capturadorFederacionMonitores = capturadorFederacionMonitores;
    this.runtimeActorId = String(runtimeActorId || 'sentinelia-runtime').trim() ||
      'sentinelia-runtime';
    this.reloj = reloj;
  }

  async aplicarResultados(
    { catalogoOperativo, resultados = [] },
    { conexion = null } = {}
  ) {
    const resumen = {
      totalResultados: Array.isArray(resultados) ? resultados.length : 0,
      totalEvaluados: 0,
      totalAperturas: 0,
      totalConfirmaciones: 0,
      totalCierres: 0,
      totalNoConcluyentes: 0,
      totalPersistidas: 0,
      totalEliminadas: 0,
      totalDescartados: 0,
      monitorIdsActivos: [],
      monitorIdsCerrados: [],
      monitorIdsNoConcluyentes: [],
      resultadosDescartados: [],
      resultadosNoConcluyentes: [],
      alertasPersistidas: [],
      aperturasAlerta: [],
      confirmacionesAlerta: [],
      cierresAlerta: []
    };

    if (!Array.isArray(resultados) || resultados.length === 0) {
      return resumen;
    }

    const idsMonitor = resultados
      .map((resultado) => normalizarEnteroNoNegativo(resultado?.monitorId, 0))
      .filter((id) => id > 0);
    const repositorio = enlazarRepositorioAConexion(
      this.repositorioAlertasActivasMonitor,
      conexion
    );
    const alertasExistentes =
      await repositorio.listarPorMonitorIds(idsMonitor);
    const alertasPorMonitorId = new Map(
      alertasExistentes.map((alerta) => [alerta.monitorId, alerta])
    );
    const alertasPersistibles = [];
    const monitorIdsCierre = new Set();

    for (const resultado of resultados) {
      const snapshot = this.resolverSnapshotResultado({
        catalogoOperativo,
        resultado
      });

      if (!snapshot) {
        resumen.totalDescartados += 1;
        resumen.resultadosDescartados.push({
          monitorId: Number(resultado?.monitorId || 0) || null,
          codigoResultado: String(resultado?.codigoResultado || 'sin_resultado'),
          motivo: 'resultado_sin_snapshot_minimo'
        });
        continue;
      }

      resumen.totalEvaluados += 1;
      const alertaExistente = alertasPorMonitorId.get(snapshot.monitorId) || null;

      if (resultado?.efectosDerivadosHabilitados === false) {
        resumen.totalNoConcluyentes += 1;
        resumen.monitorIdsNoConcluyentes.push(snapshot.monitorId);
        resumen.resultadosNoConcluyentes.push({
          monitorId: snapshot.monitorId,
          codigoResultado: snapshot.codigoResultado,
          estadoDetectado: snapshot.estadoDetectado,
          alertaActivaConservada: Boolean(alertaExistente),
          motivo: 'observacion_federada_sin_transicion_local_nueva'
        });
        continue;
      }

      if (snapshot.esNoConcluyente) {
        resumen.totalNoConcluyentes += 1;
        resumen.monitorIdsNoConcluyentes.push(snapshot.monitorId);
        resumen.resultadosNoConcluyentes.push({
          monitorId: snapshot.monitorId,
          codigoResultado: snapshot.codigoResultado,
          estadoDetectado: snapshot.estadoDetectado,
          alertaActivaConservada: Boolean(alertaExistente)
        });
        continue;
      }

      if (snapshot.esSaludable) {
        if (alertaExistente) {
          monitorIdsCierre.add(snapshot.monitorId);
          resumen.totalCierres += 1;
          resumen.monitorIdsCerrados.push(snapshot.monitorId);
          resumen.cierresAlerta.push(
            this.construirTransicionAlerta({
              tipoEventoDisparo: 'cierre_alerta',
              snapshot,
              alertaExistente
            })
          );
        }

        continue;
      }

      const alerta = this.construirAlertaActiva({
        snapshot,
        alertaExistente
      });

      if (alertaExistente) {
        resumen.totalConfirmaciones += 1;
        resumen.confirmacionesAlerta.push(
          this.construirTransicionAlerta({
            tipoEventoDisparo: 'confirmacion_alerta',
            snapshot,
            alertaExistente,
            alertaNueva: alerta
          })
        );
      } else {
        resumen.totalAperturas += 1;
        resumen.aperturasAlerta.push(
          this.construirTransicionAlerta({
            tipoEventoDisparo: 'apertura_alerta',
            snapshot,
            alertaExistente,
            alertaNueva: alerta
          })
        );
      }

      alertasPersistibles.push(alerta);
      resumen.monitorIdsActivos.push(snapshot.monitorId);
    }

    if (alertasPersistibles.length > 0) {
      resumen.alertasPersistidas = alertasPersistibles.map((alerta) =>
        alerta.serializarResumen()
      );
      resumen.totalPersistidas =
        await repositorio.guardarAlertas(
          alertasPersistibles
        );
      if (conexion && this.capturadorFederacionMonitores && resumen.totalPersistidas > 0) {
        resumen.capturasFederadasActivas = await this.capturadorFederacionMonitores
          .capturarRuntimeEnTransaccion({
            alertaMonitorIds: resumen.monitorIdsActivos
          }, { conexion });
      }
      if (resumen.totalPersistidas > 0) {
        await this.encolarAuditoriaCicloAlertas({
          tipo: 'alerta.abierta',
          transiciones: resumen.aperturasAlerta,
          alertas: alertasPersistibles,
          conexion
        });
      }
    }

    if (monitorIdsCierre.size > 0) {
      if (conexion && this.capturadorFederacionMonitores) {
        resumen.capturasFederadasCierre = await this.capturadorFederacionMonitores
          .capturarRuntimeEnTransaccion({
            cierresAlerta: resumen.cierresAlerta
          }, { conexion });
      }
      resumen.totalEliminadas =
        await repositorio.eliminarPorMonitorIds(
          Array.from(monitorIdsCierre)
        );
      if (resumen.totalEliminadas > 0) {
        await this.encolarAuditoriaCicloAlertas({
          tipo: 'alerta.cerrada',
          transiciones: resumen.cierresAlerta,
          alertas: resumen.cierresAlerta,
          conexion
        });
      }
    }

    return resumen;
  }

  construirAlertaActiva({ snapshot, alertaExistente = null }) {
    const contadorRepeticiones = alertaExistente
      ? alertaExistente.contadorRepeticiones + 1
      : 1;

    return new AlertaActivaMonitor({
      monitor_id: snapshot.monitorId,
      tenant_id: snapshot.scope.tenantId,
      empresa_id: snapshot.scope.empresaId,
      sitio_id: snapshot.scope.sitioId,
      version_catalogo: snapshot.versionCatalogo,
      tipo_monitor: snapshot.tipoMonitor,
      estado_alerta: 'activa',
      estado_detectado: snapshot.estadoDetectado,
      codigo_ultimo_resultado: snapshot.codigoResultado,
      mensaje_ultimo_resultado: snapshot.mensajeResultado,
      valido_desde_utc: alertaExistente?.validoDesdeUtc || snapshot.fechaEjecucionUtc,
      ultima_confirmacion_utc: snapshot.fechaEjecucionUtc,
      ultima_ejecucion_utc: snapshot.fechaEjecucionUtc,
      contador_repeticiones: contadorRepeticiones,
      alerta_auditoria_id: uuidV7AuditoriaABytes(
        alertaExistente?.alertaAuditoriaId || generarUuidV7Auditoria(),
        'alertaAuditoriaId'
      ),
      descartada_dashboard: alertaExistente?.descartadaDashboard ? 1 : 0,
      motivo_descarte: alertaExistente?.motivoDescarte || '',
      descartada_por_usuario_id:
        alertaExistente?.descartadaPorUsuarioId || null,
      descartada_en_utc: alertaExistente?.descartadaEnUtc || null,
      descartada_hasta_utc: alertaExistente?.descartadaHastaUtc || null,
      payload_alerta: this.construirPayloadAlerta({
        snapshot,
        alertaExistente
      })
    });
  }

  resolverSnapshotResultado({ catalogoOperativo, resultado }) {
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

    return {
      monitorId,
      scope,
      versionCatalogo,
      tipoMonitor,
      fechaEjecucionUtc,
      estadoDetectado,
      esSaludable: estadoDetectado === 'disponible',
      esNoConcluyente: estadoDetectado === 'desconocido',
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
      resultado,
      causalidadFederada: clonarObjetoPlano(resultado.causalidadFederada)
    };
  }

  construirPayloadAlerta({ snapshot, alertaExistente = null }) {
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
      detalleError: clonarObjetoPlano(snapshot.resultado?.detalleError),
      detalleErrorTecnico: clonarObjetoPlano(
        snapshot.resultado?.detalleErrorTecnico
      ),
      metricaPrincipal: clonarObjetoPlano(snapshot.resultado?.metricaPrincipal),
      causalidadFederada: clonarObjetoPlano(
        snapshot.resultado?.causalidadFederada
      ),
      protocolo: clonarObjetoPlano(snapshot.resultado?.protocolo),
      programacion: clonarObjetoPlano(snapshot.resultado?.programacion),
      intentosRealizados: normalizarEnteroNoNegativo(
        snapshot.resultado?.intentosRealizados,
        0
      ),
      intentoExitoso:
        snapshot.resultado?.intentoExitoso == null
          ? null
          : normalizarEnteroNoNegativo(snapshot.resultado.intentoExitoso, 0),
      intentos: clonarObjetoPlano(snapshot.resultado?.intentos) || [],
      scope: {
        tenantId: snapshot.scope.tenantId,
        empresaId: snapshot.scope.empresaId,
        sitioId: snapshot.scope.sitioId,
        nivelPertenencia: snapshot.scope.nivelPertenencia || null
      },
      validoDesdeUtc: alertaExistente
        ? normalizarMarcaUtc(alertaExistente.validoDesdeUtc)
        : snapshot.fechaEjecucionUtc,
      contadorPrevio: alertaExistente?.contadorRepeticiones || 0
    };
  }

  // auditoria-productor: runtime.alertas.transiciones
  construirTransicionAlerta({
    tipoEventoDisparo,
    snapshot,
    alertaExistente = null,
    alertaNueva = null
  }) {
    const alertaReferencia = alertaNueva || alertaExistente || null;

    return {
      tipoEventoDisparo: String(tipoEventoDisparo || '').trim().toLowerCase(),
      alertaAuditoriaId: alertaReferencia?.alertaAuditoriaId || null,
      monitorId: snapshot.monitorId,
      tenantId: snapshot.scope.tenantId,
      empresaId: snapshot.scope.empresaId,
      sitioId: snapshot.scope.sitioId,
      versionCatalogo: snapshot.versionCatalogo,
      tipoMonitor: snapshot.tipoMonitor,
      nombreMonitor: snapshot.nombreMonitor,
      fechaOcurrenciaUtc: snapshot.fechaEjecucionUtc,
      estadoDetectado: snapshot.estadoDetectado,
      codigoResultado: snapshot.codigoResultado,
      mensajeResultado: snapshot.mensajeResultado,
      validoDesdeUtc: alertaReferencia
        ? normalizarMarcaUtc(alertaReferencia.validoDesdeUtc)
        : snapshot.fechaEjecucionUtc,
      contadorRepeticiones: alertaReferencia?.contadorRepeticiones || 0,
      ultimaConfirmacionUtc: alertaReferencia?.ultimaConfirmacionUtc
        ? normalizarMarcaUtc(alertaReferencia.ultimaConfirmacionUtc)
        : snapshot.fechaEjecucionUtc,
      ultimaEjecucionUtc: alertaReferencia?.ultimaEjecucionUtc
        ? normalizarMarcaUtc(alertaReferencia.ultimaEjecucionUtc)
        : snapshot.fechaEjecucionUtc,
      descarteOperativo:
        this.resolverDescarteOperativoAlerta(alertaReferencia),
      payloadAlerta: alertaReferencia?.payloadAlerta
        ? clonarObjetoPlano(alertaReferencia.payloadAlerta)
        : null,
      causalidadFederada: clonarObjetoPlano(snapshot.causalidadFederada)
    };
  }

  async encolarAuditoriaCicloAlertas({
    tipo, transiciones = [], alertas = [], conexion = null
  }) {
    if (
      !this.repositorioOutboxAuditoriaRuntime ||
      typeof this.repositorioOutboxAuditoriaRuntime.encolarAtomico !== 'function' ||
      !Array.isArray(transiciones) ||
      transiciones.length === 0
    ) {
      return [];
    }

    const alertasPorMonitorId = new Map(
      alertas
        .map((alerta) =>
          typeof alerta?.serializarResumen === 'function'
            ? alerta.serializarResumen()
            : alerta
        )
        .filter(Boolean)
        .map((alerta) => [Number(alerta.monitorId), alerta])
    );
    const intenciones = transiciones
      .map((transicion) => {
        const alerta = alertasPorMonitorId.get(Number(transicion.monitorId)) ||
          transicion;
        const alertaAuditoriaId =
          alerta?.alertaAuditoriaId || transicion.alertaAuditoriaId;
        if (!alertaAuditoriaId) {
          return null;
        }
        return this.construirIntencionAuditoriaCicloAlerta({
          tipo,
          alertaAuditoriaId,
          transicion
        });
      })
      .filter(Boolean);

    if (intenciones.length === 0) {
      return [];
    }

    if (conexion && typeof this.repositorioOutboxAuditoriaRuntime.encolarEnTransaccion === 'function') {
      return this.repositorioOutboxAuditoriaRuntime.encolarEnTransaccion(
        intenciones,
        { conexion }
      );
    }
    return this.repositorioOutboxAuditoriaRuntime.encolarAtomico(intenciones);
  }

  construirIntencionAuditoriaCicloAlerta({
    tipo,
    alertaAuditoriaId,
    transicion
  }) {
    const eventoId = generarUuidV7Auditoria();
    const tenantId = String(transicion.tenantId);
    const scope = {
      tenantId,
      empresaId: transicion.empresaId == null
        ? null
        : String(transicion.empresaId),
      sitioId: transicion.sitioId == null ? null : String(transicion.sitioId)
    };
    const resultado = tipo === 'alerta.abierta' ? 'abierta' : 'cerrada';
    const causa = tipo === 'alerta.abierta'
      ? 'monitor_en_fallo'
      : 'monitor_recuperado';

    return {
      versionContrato: 1,
      eventoId,
      tipo,
      flujo: 'alertas',
      claveCadena: `alertas:tenant:${tenantId}`,
      actor: 'runtime',
      actorReal: { tipo: 'runtime', id: this.runtimeActorId },
      actorEfectivo: null,
      modoActuacion: 'directo',
      sujeto: { tipo: 'alerta', id: alertaAuditoriaId },
      origen: 'runtime',
      correlacionId: alertaAuditoriaId,
      causalidad: transicion.causalidadFederada
        ? {
            tipo: 'transicion_monitor_federado',
            id: transicion.causalidadFederada.transicionMonitorId
          }
        : null,
      productor: 'runtime_alertas',
      claveOperacion: `ciclo:${alertaAuditoriaId}:${resultado}`,
      scope,
      efectivoEnUtc: normalizarMarcaUtc(
        transicion.fechaOcurrenciaUtc || this.reloj()
      ),
      rolEvento: 'principal',
      payload: { resultado, causa },
      versionCanonicalizador: PERFIL_JCS_AUDITORIA_V1,
      versionEncadenado: VERSION_ENCADENADO_AUDITORIA_V1
    };
  }

  resolverDescarteOperativoAlerta(alerta) {
    if (!alerta) {
      return null;
    }

    if (typeof alerta.obtenerDescarteOperativo === 'function') {
      return alerta.obtenerDescarteOperativo();
    }

    if (alerta.descarteOperativo && typeof alerta.descarteOperativo === 'object') {
      return clonarObjetoPlano(alerta.descarteOperativo);
    }

    if (typeof alerta.serializarResumen === 'function') {
      return alerta.serializarResumen().descarteOperativo || null;
    }

    return null;
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

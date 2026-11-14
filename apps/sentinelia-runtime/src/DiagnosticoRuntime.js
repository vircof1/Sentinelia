export class DiagnosticoRuntime {
  constructor({ runtime }) {
    this.runtime = runtime;
  }

  construir() {
    const contexto = this.runtime.contexto || {};
    const resumenArranque = contexto.resumenArranque || {};
    const resumenCatalogo = this.runtime.catalogoOperativo?.serializarResumen?.() || {};
    const resumenEstado = this.runtime.estadoVivo?.serializarResumen?.() || {};
    const resumenRehidratacion = contexto.resumenRehidratacion || {};
    const sincronizacionRedis = contexto.sincronizacionRedis || {};
    const resumenScheduler = {
      ...(contexto.scheduler || {}),
      ...(this.runtime.planificadorMonitores?.serializarResumen?.() || {})
    };
    const relojRelativo =
      resumenScheduler.ultimaPersistenciaEvaluacionTelemetria?.preparacion ||
      contexto.relojRelativoTelemetria || null;
    const validaciones = this.validarCoherencia({
      resumenCatalogo,
      resumenEstado,
      resumenRehidratacion,
      resumenScheduler,
      sincronizacionRedis
    });

    return {
      instanciaId: this.runtime.instanciaId,
      entorno: this.runtime.configuracion.entorno,
      iniciadoEn: this.runtime.iniciadoEn,
      bootstrap: {
        sql: {
          configurado: Boolean(this.runtime.configuracion.sql.estaCompleta),
          usoHorarioUtc: resumenArranque.migraciones?.usoHorarioUtc || null,
          migraciones: {
            ejecutado: Boolean(resumenArranque.migraciones?.ejecutado),
            pendientesAplicadas:
              Number(resumenArranque.migraciones?.pendientesAplicadas || 0),
            mensaje: resumenArranque.migraciones?.mensaje || ''
          }
        },
        redis: {
          estado: resumenArranque.redis?.estado || 'desconocido',
          mensaje: resumenArranque.redis?.mensaje || '',
          versionCatalogoMonitores:
            Number(resumenArranque.redis?.versionCatalogoMonitores || 0) || null,
          versionOperativaMonitores:
            Number(resumenArranque.redis?.versionOperativaMonitores || 0) || null
        },
        configuracionPortal: {
          version: resumenArranque.configuracionPortal?.version ?? null,
          clavesCreadas:
            resumenArranque.configuracionPortal?.clavesCreadas || [],
          mensaje: resumenArranque.configuracionPortal?.mensaje || ''
        }
      },
      catalogo: {
        total: Number(resumenCatalogo.total || 0),
        porTipo: normalizarDistribucionTipos(resumenCatalogo.porTipo),
        ejecutoresRegistrados:
          this.runtime.registroEjecutoresMonitor?.serializarTiposRegistrados?.() || [],
        totalPing: Number(resumenCatalogo.totalPing || 0),
        totalTcp: Number(resumenCatalogo.totalTcp || 0),
        totalEmpresa: Number(resumenCatalogo.totalEmpresa || 0),
        totalSitio: Number(resumenCatalogo.totalSitio || 0),
        totalActivos: Number(resumenCatalogo.totalActivos || 0),
        generadoEn: resumenCatalogo.generadoEn || null
      },
      estadoActual: {
        total: Number(resumenEstado.total || 0),
        totalDesconocidos: Number(resumenEstado.totalDesconocidos || 0),
        totalPendientesScheduler: Number(
          resumenEstado.totalPendientesScheduler || 0
        ),
        totalVencidosParaEjecucion: Number(
          resumenEstado.totalVencidosParaEjecucion || 0
        ),
        totalSinEjecutar: Number(resumenEstado.totalSinEjecutar || 0),
        porTipo: normalizarDistribucionTipos(resumenEstado.porTipo),
        totalPing: Number(resumenEstado.totalPing || 0),
        totalTcp: Number(resumenEstado.totalTcp || 0),
        creadoEn: resumenEstado.creadoEn || null,
        catalogoGeneradoEn: resumenEstado.catalogoGeneradoEn || null,
        proximoIntentoGlobalEn: resumenEstado.proximoIntentoGlobalEn || null
      },
      rehidratacion: {
        registrosPersistidos: Number(
          resumenRehidratacion.registrosPersistidos || 0
        ),
        rehidratados: Number(resumenRehidratacion.rehidratados || 0),
        sinEstadoPrevio: Number(resumenRehidratacion.sinEstadoPrevio || 0),
        versionIncompatible: Number(
          resumenRehidratacion.versionIncompatible || 0
        ),
        descartadosInactivos: Number(
          resumenRehidratacion.descartadosInactivos || 0
        ),
        persistidosTrasRehidratacion: Number(
          resumenRehidratacion.persistidosTrasRehidratacion || 0
        )
      },
      redisEfimero: {
        prefijo: sincronizacionRedis.prefijo || '',
        ttlSegundos: Number(sincronizacionRedis.ttlSegundos || 0),
        intervaloLatidoMs: Number(sincronizacionRedis.intervaloLatidoMs || 0),
        versionCatalogoMonitores:
          Number(sincronizacionRedis.versionCatalogoMonitores || 0) || null,
        versionOperativa: Number(sincronizacionRedis.versionOperativa || 0) || null,
        ultimaPublicacionEn: sincronizacionRedis.ultimaPublicacionEn || null,
        ultimoMotivoPublicacion:
          sincronizacionRedis.ultimoMotivoPublicacion || null,
        totalPublicaciones: Number(sincronizacionRedis.totalPublicaciones || 0),
        ultimoGeneradoCatalogoEn:
          sincronizacionRedis.ultimoGeneradoCatalogoEn || null,
        totalRecargasCatalogo: Number(
          sincronizacionRedis.totalRecargasCatalogo || 0
        ),
        ultimaRecargaCatalogoEn:
          sincronizacionRedis.ultimaRecargaCatalogoEn || null,
        proximoIntentoGlobalEn:
          sincronizacionRedis.proximoIntentoGlobalEn || null,
        totalMonitoresVencidos: Number(
          sincronizacionRedis.totalMonitoresVencidos || 0
        ),
        porTipo: normalizarDistribucionTipos(sincronizacionRedis.porTipo)
      },
      telemetriaRelativa: relojRelativo
        ? {
            ultimaClasificacionReloj:
              relojRelativo.observacionReloj?.clasificacion || null,
            generacionCorreccion:
              relojRelativo.diagnostico?.generacionCorreccion || '0',
            correccionesTotales: Number(
              relojRelativo.diagnostico?.correccionesTotales || 0
            ),
            correccionesPendientes: Number(
              relojRelativo.diagnostico?.correccionesPendientes || 0
            ),
            trabajosPendientes: Number(
              relojRelativo.diagnostico?.trabajosRelativosPendientes || 0
            ),
            trabajosVencidos: Number(
              relojRelativo.diagnostico?.trabajosRelativosVencidos || 0
            ),
            retrasoMaximoSegundos: Number(
              relojRelativo.diagnostico?.retrasoMaximoSegundos || 0
            ),
            trabajosNeutralizados: Number(
              relojRelativo.diagnostico?.trabajosRelativosNeutralizados || 0
            ),
            trabajosReintentados: Number(
              relojRelativo.diagnostico?.trabajosRelativosReintentados || 0
            ),
            totalReintentos: Number(
              relojRelativo.diagnostico?.totalReintentosRelativos || 0
            ),
            leasesVencidos: Number(
              relojRelativo.diagnostico?.leasesRelativosVencidos || 0
            ),
            fronterasNoEvaluadas: Number(
              relojRelativo.diagnostico?.fronterasNoEvaluadas || 0
            ),
            totalLotesUltimoCiclo: Number(relojRelativo.totalLotes || 0),
            trabajosCreadosUltimoCiclo: Number(relojRelativo.trabajosCreados || 0),
            observadoEnUtc: relojRelativo.diagnostico?.observadoEnUtc || null
          }
        : null,
      scheduler: {
        activo: Boolean(resumenScheduler.activo),
        intervaloTickMs: Number(resumenScheduler.intervaloTickMs || 0),
        arrancadoEn: resumenScheduler.arrancadoEn || null,
        ticksEjecutados: Number(resumenScheduler.ticksEjecutados || 0),
        ticksConError: Number(resumenScheduler.ticksConError || 0),
        ticksOmitidosPorSolape: Number(
          resumenScheduler.ticksOmitidosPorSolape || 0
        ),
        fechaEvaluacionUtc: resumenScheduler.fechaEvaluacionUtc || null,
        totalConsiderados: Number(resumenScheduler.totalConsiderados || 0),
        totalVencidos: Number(resumenScheduler.totalVencidos || 0),
        totalPendientesFuturos: Number(
          resumenScheduler.totalPendientesFuturos || 0
        ),
        proximoIntentoGlobalEn: resumenScheduler.proximoIntentoGlobalEn || null,
        ultimoOrigenTick: resumenScheduler.ultimoOrigenTick || null,
        ultimoTickInicioEn: resumenScheduler.ultimoTickInicioEn || null,
        ultimoTickFinEn: resumenScheduler.ultimoTickFinEn || null,
        ultimaDuracionMs: Number(resumenScheduler.ultimaDuracionMs || 0),
        monitoresVencidos: Array.isArray(resumenScheduler.monitoresVencidos)
          ? resumenScheduler.monitoresVencidos
          : [],
        ultimaPersistenciaEstadoActual: resumenScheduler.ultimaPersistenciaEstadoActual
          ? {
              totalResultados: Number(
                resumenScheduler.ultimaPersistenciaEstadoActual.totalResultados || 0
              ),
              totalPersistidos: Number(
                resumenScheduler.ultimaPersistenciaEstadoActual.totalPersistidos || 0
              ),
              totalCambiosEstado: Number(
                resumenScheduler.ultimaPersistenciaEstadoActual.totalCambiosEstado || 0
              ),
              totalSinCambioEstado: Number(
                resumenScheduler.ultimaPersistenciaEstadoActual.totalSinCambioEstado || 0
              ),
              monitoresActualizados: Array.isArray(
                resumenScheduler.ultimaPersistenciaEstadoActual.monitoresActualizados
              )
                ? resumenScheduler.ultimaPersistenciaEstadoActual.monitoresActualizados
                : []
            }
          : null,
        ultimaPersistenciaEventos: resumenScheduler.ultimaPersistenciaEventos
          ? {
              totalResultados: Number(
                resumenScheduler.ultimaPersistenciaEventos.totalResultados || 0
              ),
              totalConstruidos: Number(
                resumenScheduler.ultimaPersistenciaEventos.totalConstruidos || 0
              ),
              totalPersistidos: Number(
                resumenScheduler.ultimaPersistenciaEventos.totalPersistidos || 0
              ),
              totalDescartados: Number(
                resumenScheduler.ultimaPersistenciaEventos.totalDescartados || 0
              ),
              monitorIdsPersistidos: Array.isArray(
                resumenScheduler.ultimaPersistenciaEventos.monitorIdsPersistidos
              )
                ? resumenScheduler.ultimaPersistenciaEventos.monitorIdsPersistidos
                : [],
              resultadosDescartados: Array.isArray(
                resumenScheduler.ultimaPersistenciaEventos.resultadosDescartados
              )
                ? resumenScheduler.ultimaPersistenciaEventos.resultadosDescartados
                : []
            }
          : null,
        ultimaPersistenciaAlertas: resumenScheduler.ultimaPersistenciaAlertas
          ? {
              totalResultados: Number(
                resumenScheduler.ultimaPersistenciaAlertas.totalResultados || 0
              ),
              totalEvaluados: Number(
                resumenScheduler.ultimaPersistenciaAlertas.totalEvaluados || 0
              ),
              totalAperturas: Number(
                resumenScheduler.ultimaPersistenciaAlertas.totalAperturas || 0
              ),
              totalConfirmaciones: Number(
                resumenScheduler.ultimaPersistenciaAlertas.totalConfirmaciones || 0
              ),
              totalCierres: Number(
                resumenScheduler.ultimaPersistenciaAlertas.totalCierres || 0
              ),
              totalPersistidas: Number(
                resumenScheduler.ultimaPersistenciaAlertas.totalPersistidas || 0
              ),
              totalEliminadas: Number(
                resumenScheduler.ultimaPersistenciaAlertas.totalEliminadas || 0
              ),
              totalDescartados: Number(
                resumenScheduler.ultimaPersistenciaAlertas.totalDescartados || 0
              ),
              monitorIdsActivos: Array.isArray(
                resumenScheduler.ultimaPersistenciaAlertas.monitorIdsActivos
              )
                ? resumenScheduler.ultimaPersistenciaAlertas.monitorIdsActivos
                : [],
              monitorIdsCerrados: Array.isArray(
                resumenScheduler.ultimaPersistenciaAlertas.monitorIdsCerrados
              )
                ? resumenScheduler.ultimaPersistenciaAlertas.monitorIdsCerrados
                : [],
              resultadosDescartados: Array.isArray(
                resumenScheduler.ultimaPersistenciaAlertas.resultadosDescartados
              )
                ? resumenScheduler.ultimaPersistenciaAlertas.resultadosDescartados
                : []
            }
          : null,
        ultimaPersistenciaHistorico: resumenScheduler.ultimaPersistenciaHistorico
          ? {
              totalResultados: Number(
                resumenScheduler.ultimaPersistenciaHistorico.totalResultados || 0
              ),
              totalEvaluados: Number(
                resumenScheduler.ultimaPersistenciaHistorico.totalEvaluados || 0
              ),
              totalAperturas: Number(
                resumenScheduler.ultimaPersistenciaHistorico.totalAperturas || 0
              ),
              totalExtensiones: Number(
                resumenScheduler.ultimaPersistenciaHistorico.totalExtensiones || 0
              ),
              totalTransiciones: Number(
                resumenScheduler.ultimaPersistenciaHistorico.totalTransiciones || 0
              ),
              totalPersistidos: Number(
                resumenScheduler.ultimaPersistenciaHistorico.totalPersistidos || 0
              ),
              totalActualizados: Number(
                resumenScheduler.ultimaPersistenciaHistorico.totalActualizados || 0
              ),
              totalDescartados: Number(
                resumenScheduler.ultimaPersistenciaHistorico.totalDescartados || 0
              ),
              monitorIdsNuevos: Array.isArray(
                resumenScheduler.ultimaPersistenciaHistorico.monitorIdsNuevos
              )
                ? resumenScheduler.ultimaPersistenciaHistorico.monitorIdsNuevos
                : [],
              monitorIdsActualizados: Array.isArray(
                resumenScheduler.ultimaPersistenciaHistorico.monitorIdsActualizados
              )
                ? resumenScheduler.ultimaPersistenciaHistorico.monitorIdsActualizados
                : [],
              resultadosDescartados: Array.isArray(
                resumenScheduler.ultimaPersistenciaHistorico.resultadosDescartados
              )
                ? resumenScheduler.ultimaPersistenciaHistorico.resultadosDescartados
                : []
            }
          : null,
        ultimaRetencionMonitores: resumenScheduler.ultimaRetencionMonitores
          ? {
              activa: Boolean(
                resumenScheduler.ultimaRetencionMonitores.activa
              ),
              omitida: Boolean(
                resumenScheduler.ultimaRetencionMonitores.omitida
              ),
              motivo:
                resumenScheduler.ultimaRetencionMonitores.motivo || null,
              diasRetencion: Number(
                resumenScheduler.ultimaRetencionMonitores.diasRetencion || 0
              ),
              fechaCorteUtc:
                resumenScheduler.ultimaRetencionMonitores.fechaCorteUtc || null,
              eventosEliminados: Number(
                resumenScheduler.ultimaRetencionMonitores.eventosEliminados || 0
              ),
              historicosEliminados: Number(
                resumenScheduler.ultimaRetencionMonitores.historicosEliminados || 0
              )
            }
          : null,
        ultimaPersistenciaTriggers: resumenScheduler.ultimaPersistenciaTriggers
          ? {
              omitido: Boolean(resumenScheduler.ultimaPersistenciaTriggers.omitido),
              ejecutadoEnUtc:
                resumenScheduler.ultimaPersistenciaTriggers.ejecutadoEnUtc || null,
              finalizadoEnUtc:
                resumenScheduler.ultimaPersistenciaTriggers.finalizadoEnUtc || null,
              origen: resumenScheduler.ultimaPersistenciaTriggers.origen || null,
              numeroTick: Number(
                resumenScheduler.ultimaPersistenciaTriggers.numeroTick || 0
              ) || null,
              motivo: resumenScheduler.ultimaPersistenciaTriggers.motivo || null,
              totalTransiciones: Number(
                resumenScheduler.ultimaPersistenciaTriggers.totalTransiciones || 0
              ),
              totalPlanes: Number(
                resumenScheduler.ultimaPersistenciaTriggers.totalPlanes || 0
              ),
              totalPlanesUnicos: Number(
                resumenScheduler.ultimaPersistenciaTriggers.totalPlanesUnicos || 0
              ),
              totalEjecutados: Number(
                resumenScheduler.ultimaPersistenciaTriggers.totalEjecutados || 0
              ),
              totalOk: Number(
                resumenScheduler.ultimaPersistenciaTriggers.totalOk || 0
              ),
              totalError: Number(
                resumenScheduler.ultimaPersistenciaTriggers.totalError || 0
              ),
              ejecuciones: Array.isArray(
                resumenScheduler.ultimaPersistenciaTriggers.ejecuciones
              )
                ? resumenScheduler.ultimaPersistenciaTriggers.ejecuciones
                : []
            }
          : null,
        ultimaPersistenciaCorreo: resumenScheduler.ultimaPersistenciaCorreo
          ? {
              omitido: Boolean(resumenScheduler.ultimaPersistenciaCorreo.omitido),
              ejecutadoEnUtc:
                resumenScheduler.ultimaPersistenciaCorreo.ejecutadoEnUtc || null,
              finalizadoEnUtc:
                resumenScheduler.ultimaPersistenciaCorreo.finalizadoEnUtc || null,
              origen: resumenScheduler.ultimaPersistenciaCorreo.origen || null,
              numeroTick: Number(
                resumenScheduler.ultimaPersistenciaCorreo.numeroTick || 0
              ) || null,
              motivo: resumenScheduler.ultimaPersistenciaCorreo.motivo || null,
              loteMaximo: Number(
                resumenScheduler.ultimaPersistenciaCorreo.loteMaximo || 0
              ),
              totalIntentados: Number(
                resumenScheduler.ultimaPersistenciaCorreo.totalIntentados || 0
              ),
              totalDespachados: Number(
                resumenScheduler.ultimaPersistenciaCorreo.totalDespachados || 0
              ),
              totalReintentables: Number(
                resumenScheduler.ultimaPersistenciaCorreo.totalReintentables || 0
              ),
              totalFallosFinales: Number(
                resumenScheduler.ultimaPersistenciaCorreo.totalFallosFinales || 0
              ),
              sinPendientes: Boolean(
                resumenScheduler.ultimaPersistenciaCorreo.sinPendientes
              ),
              correosProcesados: Array.isArray(
                resumenScheduler.ultimaPersistenciaCorreo.correosProcesados
              )
                ? resumenScheduler.ultimaPersistenciaCorreo.correosProcesados
                : [],
              erroresConfiguracion: Array.isArray(
                resumenScheduler.ultimaPersistenciaCorreo.erroresConfiguracion
              )
                ? resumenScheduler.ultimaPersistenciaCorreo.erroresConfiguracion
                : [],
              advertencias: Array.isArray(
                resumenScheduler.ultimaPersistenciaCorreo.advertencias
              )
                ? resumenScheduler.ultimaPersistenciaCorreo.advertencias
                : [],
              error: resumenScheduler.ultimaPersistenciaCorreo.error || null
            }
          : null,
        ultimaCoordinacionBloqueosRedis:
          resumenScheduler.ultimaCoordinacionBloqueosRedis
            ? {
                ejecutadoEnUtc:
                  resumenScheduler.ultimaCoordinacionBloqueosRedis.ejecutadoEnUtc ||
                  null,
                ttlSegundos: Number(
                  resumenScheduler.ultimaCoordinacionBloqueosRedis.ttlSegundos || 0
                ),
                instanciaId:
                  resumenScheduler.ultimaCoordinacionBloqueosRedis.instanciaId ||
                  null,
                origen:
                  resumenScheduler.ultimaCoordinacionBloqueosRedis.origen || null,
                numeroTick: Number(
                  resumenScheduler.ultimaCoordinacionBloqueosRedis.numeroTick || 0
                ) || null,
                totalCandidatos: Number(
                  resumenScheduler.ultimaCoordinacionBloqueosRedis
                    .totalCandidatos || 0
                ),
                totalBloqueados: Number(
                  resumenScheduler.ultimaCoordinacionBloqueosRedis
                    .totalBloqueados || 0
                ),
                totalSaltados: Number(
                  resumenScheduler.ultimaCoordinacionBloqueosRedis.totalSaltados ||
                    0
                ),
                monitorIdsBloqueados: Array.isArray(
                  resumenScheduler.ultimaCoordinacionBloqueosRedis
                    .monitorIdsBloqueados
                )
                  ? resumenScheduler.ultimaCoordinacionBloqueosRedis
                      .monitorIdsBloqueados
                  : [],
                monitorIdsSaltados: Array.isArray(
                  resumenScheduler.ultimaCoordinacionBloqueosRedis
                    .monitorIdsSaltados
                )
                  ? resumenScheduler.ultimaCoordinacionBloqueosRedis
                      .monitorIdsSaltados
                  : [],
                liberacion:
                  resumenScheduler.ultimaCoordinacionBloqueosRedis.liberacion
                    ? {
                        totalBloqueos: Number(
                          resumenScheduler.ultimaCoordinacionBloqueosRedis
                            .liberacion.totalBloqueos || 0
                        ),
                        totalLiberados: Number(
                          resumenScheduler.ultimaCoordinacionBloqueosRedis
                            .liberacion.totalLiberados || 0
                        ),
                        totalNoLiberados: Number(
                          resumenScheduler.ultimaCoordinacionBloqueosRedis
                            .liberacion.totalNoLiberados || 0
                        ),
                        errores: Array.isArray(
                          resumenScheduler.ultimaCoordinacionBloqueosRedis
                            .liberacion.errores
                        )
                          ? resumenScheduler.ultimaCoordinacionBloqueosRedis
                              .liberacion.errores
                          : []
                      }
                    : null
              }
            : null,
        ultimaEjecucion: resumenScheduler.ultimaEjecucion
          ? {
              ejecutadoEnUtc:
                resumenScheduler.ultimaEjecucion.ejecutadoEnUtc || null,
              finalizadoEnUtc:
                resumenScheduler.ultimaEjecucion.finalizadoEnUtc || null,
              totalCandidatos: Number(
                resumenScheduler.ultimaEjecucion.totalCandidatos || 0
              ),
              totalEjecutados: Number(
                resumenScheduler.ultimaEjecucion.totalEjecutados || 0
              ),
              totalExitosos: Number(
                resumenScheduler.ultimaEjecucion.totalExitosos || 0
              ),
              totalFallidos: Number(
                resumenScheduler.ultimaEjecucion.totalFallidos || 0
              ),
              resultados: Array.isArray(resumenScheduler.ultimaEjecucion.resultados)
                ? resumenScheduler.ultimaEjecucion.resultados
                : []
            }
          : null
      },
      validaciones
    };
  }

  validarCoherencia({
    resumenCatalogo = {},
    resumenEstado = {},
    resumenRehidratacion = {},
    resumenScheduler = {},
    sincronizacionRedis = {}
  }) {
    const checks = [];

    checks.push({
      clave: 'catalogo_tipos',
      ok: Number(resumenCatalogo.total || 0) === sumarDistribucionTipos(
        resumenCatalogo.porTipo
      ),
      detalle: 'total catalogo = suma de distribucion por tipo'
    });

    checks.push({
      clave: 'catalogo_pertenencia',
      ok:
        Number(resumenCatalogo.total || 0) ===
        (
          Number(resumenCatalogo.totalEmpresa || 0) +
          Number(resumenCatalogo.totalSitio || 0)
        ),
      detalle: 'total catalogo = empresa + sitio'
    });

    checks.push({
      clave: 'estado_vs_catalogo_total',
      ok: Number(resumenEstado.total || 0) === Number(resumenCatalogo.total || 0),
      detalle: 'total estado actual = total catalogo'
    });

    checks.push({
      clave: 'estado_vs_catalogo_tipos',
      ok: distribucionesTiposIguales(
        resumenEstado.porTipo,
        resumenCatalogo.porTipo
      ),
      detalle: 'distribucion de tipos alineada entre catalogo y estado actual'
    });

    checks.push({
      clave: 'rehidratacion_cubre_total',
      ok:
        (
          Number(resumenRehidratacion.rehidratados || 0) +
          Number(resumenRehidratacion.sinEstadoPrevio || 0) +
          Number(resumenRehidratacion.versionIncompatible || 0)
        ) === Number(resumenCatalogo.total || 0),
      detalle:
        'rehidratados + sin estado previo + incompatibles = total catalogo'
    });

    checks.push({
      clave: 'scheduler_intervalo_valido',
      ok: Number(resumenScheduler.intervaloTickMs || 0) > 0,
      detalle: 'el scheduler tiene un intervalo de tick positivo'
    });

    checks.push({
      clave: 'scheduler_tick_inicial',
      ok: Number(resumenScheduler.ticksEjecutados || 0) >= 1,
      detalle: 'el scheduler ha ejecutado al menos un tick de arranque'
    });

    checks.push({
      clave: 'version_operativa_valida',
      ok:
        sincronizacionRedis.versionOperativa == null ||
        Number(sincronizacionRedis.versionOperativa) >= 1,
      detalle: 'la versión operativa Redis, si existe, es numérica y positiva'
    });

    checks.push({
      clave: 'eventos_no_superan_resultados',
      ok:
        Number(resumenScheduler.ultimaPersistenciaEventos?.totalPersistidos || 0) <=
        Number(resumenScheduler.ultimaPersistenciaEventos?.totalResultados || 0),
      detalle: 'la persistencia de eventos no supera el total de resultados del lote'
    });

    checks.push({
      clave: 'alertas_no_superan_resultados',
      ok:
        Number(resumenScheduler.ultimaPersistenciaAlertas?.totalEvaluados || 0) <=
        Number(resumenScheduler.ultimaPersistenciaAlertas?.totalResultados || 0),
      detalle:
        'la gestión de alertas no evalúa más monitores de los recibidos en el lote'
    });

    checks.push({
      clave: 'historico_no_supera_resultados',
      ok:
        Number(resumenScheduler.ultimaPersistenciaHistorico?.totalEvaluados || 0) <=
        Number(resumenScheduler.ultimaPersistenciaHistorico?.totalResultados || 0),
      detalle:
        'la compactación histórica no evalúa más monitores de los recibidos en el lote'
    });

    checks.push({
      clave: 'scheduler_cubre_catalogo',
      ok:
        (
          Number(resumenScheduler.totalVencidos || 0) +
          Number(resumenScheduler.totalPendientesFuturos || 0)
        ) === Number(resumenCatalogo.total || 0),
      detalle: 'vencidos + pendientes futuros = total catalogo'
    });

    checks.push({
      clave: 'estado_vencidos_alineado_con_scheduler',
      ok:
        Number(resumenEstado.totalVencidosParaEjecucion || 0) ===
        Number(resumenScheduler.totalVencidos || 0),
      detalle: 'el estado vivo refleja el mismo total vencido que el scheduler'
    });

    if (resumenScheduler.ultimaPersistenciaEstadoActual) {
      checks.push({
        clave: 'persistencia_cubre_ejecucion',
        ok:
          Number(
            resumenScheduler.ultimaPersistenciaEstadoActual.totalResultados || 0
          ) ===
          Number(resumenScheduler.ultimaEjecucion?.totalEjecutados || 0),
        detalle:
          'la persistencia del estado actual cubre el mismo número de resultados ejecutados'
      });
    }

    if (resumenScheduler.ultimaPersistenciaAlertas) {
      checks.push({
        clave: 'alertas_cubren_ejecucion',
        ok:
          Number(
            resumenScheduler.ultimaPersistenciaAlertas.totalResultados || 0
          ) === Number(resumenScheduler.ultimaEjecucion?.totalEjecutados || 0),
        detalle:
          'la gestión de alertas recibió el mismo número de resultados que la ejecución real'
      });
    }

    if (resumenScheduler.ultimaPersistenciaHistorico) {
      checks.push({
        clave: 'historico_cubre_ejecucion',
        ok:
          Number(
            resumenScheduler.ultimaPersistenciaHistorico.totalResultados || 0
          ) === Number(resumenScheduler.ultimaEjecucion?.totalEjecutados || 0),
        detalle:
          'la compactación histórica recibió el mismo número de resultados que la ejecución real'
      });
    }

    if (resumenScheduler.ultimaRetencionMonitores) {
      checks.push({
        clave: 'retencion_dias_validos',
        ok:
          Number(resumenScheduler.ultimaRetencionMonitores.diasRetencion || 0) >= 0,
        detalle:
          'la retención de monitores usa un número de días no negativo'
      });

      checks.push({
        clave: 'retencion_resumen_consistente',
        ok:
          !resumenScheduler.ultimaRetencionMonitores.activa ||
          (
            Number(
              resumenScheduler.ultimaRetencionMonitores.eventosEliminados || 0
            ) >= 0 &&
            Number(
              resumenScheduler.ultimaRetencionMonitores.historicosEliminados || 0
            ) >= 0
          ),
        detalle:
          'el resumen de retención reporta contadores no negativos para eventos e histórico'
      });
    }

    if (resumenScheduler.ultimaPersistenciaCorreo) {
      checks.push({
        clave: 'correo_runtime_consistente',
        ok:
          Boolean(resumenScheduler.ultimaPersistenciaCorreo.omitido) ||
          (
            Number(
              resumenScheduler.ultimaPersistenciaCorreo.totalIntentados || 0
            ) ===
            (
              Number(
                resumenScheduler.ultimaPersistenciaCorreo.totalDespachados || 0
              ) +
              Number(
                resumenScheduler.ultimaPersistenciaCorreo.totalReintentables || 0
              ) +
              Number(
                resumenScheduler.ultimaPersistenciaCorreo.totalFallosFinales || 0
              )
            )
          ),
        detalle: Boolean(resumenScheduler.ultimaPersistenciaCorreo.omitido)
          ? 'el despachador de correo se omitió de forma explícita y coherente'
          : 'el resumen del despachador de correo cuadra entre intentados y resultados'
      });
    }

    if (resumenScheduler.ultimaCoordinacionBloqueosRedis) {
      checks.push({
        clave: 'bloqueos_redis_consistentes',
        ok:
          Number(
            resumenScheduler.ultimaCoordinacionBloqueosRedis.totalCandidatos || 0
          ) ===
          (
            Number(
              resumenScheduler.ultimaCoordinacionBloqueosRedis.totalBloqueados || 0
            ) +
            Number(
              resumenScheduler.ultimaCoordinacionBloqueosRedis.totalSaltados || 0
            )
          ),
        detalle:
          'la coordinación Redis reparte cada monitor vencido entre bloqueado o saltado por concurrencia'
      });

      checks.push({
        clave: 'bloqueos_redis_liberacion_consistente',
        ok:
          !resumenScheduler.ultimaCoordinacionBloqueosRedis.liberacion ||
          Number(
            resumenScheduler.ultimaCoordinacionBloqueosRedis.liberacion
              .totalBloqueos || 0
          ) ===
            (
              Number(
                resumenScheduler.ultimaCoordinacionBloqueosRedis.liberacion
                  .totalLiberados || 0
              ) +
              Number(
                resumenScheduler.ultimaCoordinacionBloqueosRedis.liberacion
                  .totalNoLiberados || 0
              )
            ),
        detalle:
          'la liberación de bloqueos Redis cuadra entre liberados y no liberados'
      });
    }

    checks.push({
      clave: 'redis_proximo_intento_alineado',
      ok:
        (sincronizacionRedis.proximoIntentoGlobalEn || null) ===
        (resumenScheduler.proximoIntentoGlobalEn || null),
      detalle:
        'el próximo intento global publicado en Redis coincide con el scheduler'
    });

    checks.push({
      clave: 'redis_vencidos_alineado',
      ok:
        Number(sincronizacionRedis.totalMonitoresVencidos || 0) ===
        Number(resumenScheduler.totalVencidos || 0),
      detalle:
        'el total vencido publicado en Redis coincide con el scheduler'
    });

    checks.push({
      clave: 'redis_tipos_alineado',
      ok:
        !sincronizacionRedis.ultimaPublicacionEn ||
        distribucionesTiposIguales(
          sincronizacionRedis.porTipo,
          resumenEstado.porTipo
        ),
      detalle:
        'la distribución por tipo publicada en Redis coincide con el estado actual'
    });

    return {
      okGlobal: checks.every((check) => check.ok),
      checks
    };
  }
}

function normalizarDistribucionTipos(distribucion = {}) {
  const normalizada = {};

  for (const [tipo, total] of Object.entries(distribucion || {})) {
    const tipoNormalizado = String(tipo || '').trim().toLowerCase();

    if (!tipoNormalizado) {
      continue;
    }

    normalizada[tipoNormalizado] = Number(total || 0);
  }

  return normalizada;
}

function sumarDistribucionTipos(distribucion = {}) {
  return Object.values(normalizarDistribucionTipos(distribucion)).reduce(
    (total, valor) => total + Number(valor || 0),
    0
  );
}

function distribucionesTiposIguales(primera = {}, segunda = {}) {
  const normalizadaPrimera = normalizarDistribucionTipos(primera);
  const normalizadaSegunda = normalizarDistribucionTipos(segunda);
  const tipos = new Set([
    ...Object.keys(normalizadaPrimera),
    ...Object.keys(normalizadaSegunda)
  ]);

  for (const tipo of tipos) {
    if (Number(normalizadaPrimera[tipo] || 0) !== Number(normalizadaSegunda[tipo] || 0)) {
      return false;
    }
  }

  return true;
}

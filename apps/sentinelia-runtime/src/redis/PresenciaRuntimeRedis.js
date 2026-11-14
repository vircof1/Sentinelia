import crypto from 'node:crypto';

function normalizarTextoSignificativo(valor) {
  return String(valor || '').trim().replace(/\s+/g, ' ').slice(0, 240);
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

  return Object.fromEntries(Object.entries(normalizada).sort());
}

export class PresenciaRuntimeRedis {
  constructor({ clienteRedis, configuracionRuntime, entorno }) {
    this.clienteRedis = clienteRedis;
    this.configuracionRuntime = configuracionRuntime;
    this.entorno = entorno;
    this.temporizadorLatido = null;
    this.iniciadoEn = null;
    this.instanciaId = configuracionRuntime.instanciaId;
    this.ultimoPayload = null;
    this.ultimaPublicacionEn = null;
    this.ultimoMotivoPublicacion = null;
    this.totalPublicaciones = 0;
    this.capacidadesDespliegue = {};
  }

  async publicarInicio({
    catalogoOperativo,
    almacenEstadoActual,
    resumenAlertasActivas = null,
    resumenScheduler = null,
    versionCatalogoMonitores = null,
    versionOperativa = null
  }) {
    this.iniciadoEn = this.iniciadoEn || new Date().toISOString();
    this.actualizarPayload({
      catalogoOperativo,
      almacenEstadoActual,
      resumenAlertasActivas,
      resumenScheduler,
      versionCatalogoMonitores,
      versionOperativa
    });
    await this.publicarSnapshotActual({ motivo: 'arranque' });
    this.arrancarLatido();
  }

  actualizarPayload({
    catalogoOperativo,
    almacenEstadoActual,
    resumenAlertasActivas = null,
    resumenScheduler = null,
    versionCatalogoMonitores = null,
    versionOperativa = null
  }) {
    this.ultimoPayload = {
      catalogoOperativo,
      almacenEstadoActual,
      resumenAlertasActivas,
      resumenScheduler,
      versionCatalogoMonitores,
      versionOperativa
    };
  }

  async publicarEstadoOperativo({
    catalogoOperativo,
    almacenEstadoActual,
    resumenAlertasActivas = null,
    resumenScheduler = null,
    versionCatalogoMonitores = null,
    versionOperativa = null,
    motivo = 'actualizacion_operativa'
  }) {
    this.actualizarPayload({
      catalogoOperativo,
      almacenEstadoActual,
      resumenAlertasActivas,
      resumenScheduler,
      versionCatalogoMonitores,
      versionOperativa
    });
    await this.publicarSnapshotActual({ motivo });
  }

  async publicarSnapshotActual({ motivo = 'latido' } = {}) {
    if (!this.ultimoPayload) {
      return;
    }

    const {
      catalogoOperativo,
      almacenEstadoActual,
      resumenAlertasActivas,
      resumenScheduler,
      versionCatalogoMonitores,
      versionOperativa
    } =
      this.ultimoPayload;
    const ttl = this.configuracionRuntime.presenciaTtlSegundos;
    const sincronizadoEn = new Date().toISOString();
    const resumenCatalogo = catalogoOperativo?.serializarResumen?.() || null;
    const resumenEstado = almacenEstadoActual?.serializarResumen?.() || null;
    const snapshotEstado = almacenEstadoActual?.crearSnapshot?.() || null;
    const resumenSchedulerNormalizado = resumenScheduler
      ? this.normalizarResumenScheduler(resumenScheduler)
      : null;

    const payloadPresencia = {
      instanciaId: this.instanciaId,
      entorno: this.entorno,
      pid: process.pid,
      iniciadoEn: this.iniciadoEn,
      sincronizadoEn,
      ttlSegundos: ttl,
      motivoPublicacion: motivo,
      versionCatalogoMonitores: Number(versionCatalogoMonitores || 0) || null,
      versionOperativa: Number(versionOperativa || 0) || null,
      totalPublicaciones: this.totalPublicaciones + 1,
      capacidadesDespliegue: this.capacidadesDespliegue
    };
    const payloadCatalogo = {
      instanciaId: this.instanciaId,
      sincronizadoEn,
      generadoEn: catalogoOperativo?.generadoEn || null,
      versionCatalogoMonitores: Number(versionCatalogoMonitores || 0) || null,
      resumen: resumenCatalogo
    };
    const payloadEstado = {
      instanciaId: this.instanciaId,
      sincronizadoEn,
      resumen: resumenEstado,
      versionOperativa: Number(versionOperativa || 0) || null,
      versionCatalogoMonitores: Number(versionCatalogoMonitores || 0) || null,
      scheduler: resumenSchedulerNormalizado,
      snapshot: snapshotEstado
    };
    const payloadDashboard = {
      instanciaId: this.instanciaId,
      entorno: this.entorno,
      sincronizadoEn,
      motivoPublicacion: motivo,
      versionOperativa: Number(versionOperativa || 0) || null,
      versionCatalogoMonitores: Number(versionCatalogoMonitores || 0) || null,
      firmaDashboard: this.construirFirmaDashboard({
        catalogoOperativo,
        almacenEstadoActual,
        resumenAlertasActivas,
        versionCatalogoMonitores
      }),
      resumenAlertasActivas: resumenAlertasActivas || {
        totalAlertasActivas: 0,
        alertas: []
      },
      resumen: this.construirResumenDashboard({
        catalogoOperativo,
        almacenEstadoActual,
        resumenScheduler: resumenSchedulerNormalizado
      })
    };

    const multi = this.clienteRedis.multi();
    multi.set(this.obtenerClavePresencia(), JSON.stringify(payloadPresencia), {
      EX: ttl
    });
    multi.set(this.obtenerClaveCatalogo(), JSON.stringify(payloadCatalogo), {
      EX: ttl
    });
    multi.set(this.obtenerClaveEstado(), JSON.stringify(payloadEstado), {
      EX: ttl
    });
    multi.set(this.obtenerClaveDashboard(), JSON.stringify(payloadDashboard), {
      EX: ttl
    });
    multi.set(this.obtenerClaveVersionCatalogo(), catalogoOperativo?.generadoEn || '', {
      EX: ttl
    });
    await multi.exec();
    this.ultimaPublicacionEn = sincronizadoEn;
    this.ultimoMotivoPublicacion = motivo;
    this.totalPublicaciones += 1;
  }

  arrancarLatido() {
    if (this.temporizadorLatido) {
      return;
    }

    this.temporizadorLatido = setInterval(() => {
      void this.publicarSnapshotActual({ motivo: 'latido' }).catch((error) => {
        console.error('[sentinelia-runtime] Error al publicar latido Redis');
        console.error(error);
      });
    }, this.configuracionRuntime.latidoIntervaloMs);

    if (typeof this.temporizadorLatido.unref === 'function') {
      this.temporizadorLatido.unref();
    }
  }

  async publicarCapacidadDespliegue(nombre, declaracion) {
    const clave = String(nombre || '').trim();
    if (!/^[a-z][a-z0-9A-Z]*$/u.test(clave) ||
        !declaracion || typeof declaracion !== 'object' || Array.isArray(declaracion)) {
      throw new Error('La capacidad de despliegue runtime no es válida.');
    }
    this.capacidadesDespliegue = Object.freeze({
      ...this.capacidadesDespliegue,
      [clave]: Object.freeze({ ...declaracion })
    });
    await this.publicarSnapshotActual({ motivo: `capacidad:${clave}` });
  }

  async detener() {
    if (this.temporizadorLatido) {
      clearInterval(this.temporizadorLatido);
      this.temporizadorLatido = null;
    }

    await this.clienteRedis.del([
      this.obtenerClavePresencia(),
      this.obtenerClaveCatalogo(),
      this.obtenerClaveEstado(),
      this.obtenerClaveDashboard(),
      this.obtenerClaveVersionCatalogo()
    ]);
  }

  serializarResumen() {
    const payload = this.ultimoPayload || {};
    const dashboard = this.construirResumenDashboard(payload);

    return {
      prefijo: this.configuracionRuntime.redisPrefijo,
      ttlSegundos: this.configuracionRuntime.presenciaTtlSegundos,
      intervaloLatidoMs: this.configuracionRuntime.latidoIntervaloMs,
      ultimaPublicacionEn: this.ultimaPublicacionEn,
      ultimoMotivoPublicacion: this.ultimoMotivoPublicacion,
      totalPublicaciones: this.totalPublicaciones,
      versionOperativa:
        Number(payload.versionOperativa || 0) || null,
      versionCatalogoMonitores:
        Number(payload.versionCatalogoMonitores || 0) || null,
      ultimoGeneradoCatalogoEn: payload.catalogoOperativo?.generadoEn || null,
      proximoIntentoGlobalEn:
        payload.almacenEstadoActual?.serializarResumen?.()?.proximoIntentoGlobalEn ||
        null,
      totalMonitoresVencidos:
        Number(payload.resumenScheduler?.totalVencidos || 0) || 0,
      porTipo: dashboard.porTipo || {},
      firmaDashboard: this.construirFirmaDashboard(payload),
      dashboardResumen: dashboard
    };
  }

  construirResumenDashboard({
    catalogoOperativo,
    almacenEstadoActual,
    resumenScheduler = null
  } = {}) {
    const estadosListado =
      typeof almacenEstadoActual?.listar === 'function'
        ? almacenEstadoActual.listar()
        : [];
    const estados = Array.isArray(estadosListado) ? estadosListado : [];
    const resumenEstado = almacenEstadoActual?.serializarResumen?.() || null;
    const totalDisponibles = estados.filter(
      (estado) => estado.estado === 'disponible'
    ).length;
    const totalIndisponibles = estados.filter(
      (estado) => estado.estado === 'indisponible'
    ).length;
    const totalDegradados = estados.filter(
      (estado) => estado.estado === 'degradado'
    ).length;
    const totalDesconocidos = estados.filter(
      (estado) => estado.estado === 'desconocido'
    ).length;
    const totalSinEjecutar = estados.filter(
      (estado) => !estado.ejecutadoTodavia
    ).length;

    return {
      fuente: 'runtime_redis',
      totalMonitores: Number(catalogoOperativo?.total || estados.length || 0),
      totalActivos: estados.filter((estado) => Boolean(estado.activoCatalogo)).length,
      totalInactivos: estados.filter((estado) => !estado.activoCatalogo).length,
      totalConEstado: Math.max(0, estados.length - totalSinEjecutar),
      totalSinEjecutar,
      totalDisponibles,
      totalIndisponibles,
      totalDegradados,
      totalDesconocidos,
      totalConIncidencia: totalIndisponibles + totalDegradados,
      totalPendientesScheduler: Number(
        resumenEstado?.totalPendientesScheduler || 0
      ),
      totalVencidosParaEjecucion: Number(
        resumenEstado?.totalVencidosParaEjecucion || 0
      ),
      porTipo: resumenEstado?.porTipo || {},
      totalPing: Number(resumenEstado?.totalPing || 0),
      totalTcp: Number(resumenEstado?.totalTcp || 0),
      proximoIntentoGlobalEn:
        resumenScheduler?.proximoIntentoGlobalEn ||
        resumenEstado?.proximoIntentoGlobalEn ||
        null,
      ultimaEjecucion: resumenScheduler?.ultimaEjecucion
        ? {
            ejecutadoEnUtc: resumenScheduler.ultimaEjecucion.ejecutadoEnUtc || null,
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
            )
          }
        : null
    };
  }

  construirFirmaDashboard({
    catalogoOperativo,
    almacenEstadoActual,
    resumenAlertasActivas = null,
    versionCatalogoMonitores = null
  } = {}) {
    const resumen = this.construirResumenDashboard({
      catalogoOperativo,
      almacenEstadoActual
    });
    const estadosListado =
      typeof almacenEstadoActual?.listar === 'function'
        ? almacenEstadoActual.listar()
        : [];
    const estados = Array.isArray(estadosListado) ? estadosListado : [];
    const incidencias = estados
      .filter(
        (estado) =>
          !estado.ejecutadoTodavia || String(estado.estado || '') !== 'disponible'
      )
      .map((estado) => ({
        monitorId: Number(estado.monitorId || 0) || 0,
        tipo: String(estado.tipo || '').trim().toLowerCase(),
        activoCatalogo: Boolean(estado.activoCatalogo),
        ejecutadoTodavia: Boolean(estado.ejecutadoTodavia),
        estado: String(estado.estado || '').trim().toLowerCase(),
        codigoResultado: normalizarTextoSignificativo(
          estado.resultadoActual?.codigoResultado ||
            estado.resultadoActual?.codigo ||
            ''
        ),
        mensajeResultado: normalizarTextoSignificativo(
          estado.resultadoActual?.mensajeResultado ||
            estado.resultadoActual?.mensaje ||
            ''
        ),
        detalleTls: normalizarTextoSignificativo(
          estado.resultadoActual?.detalleTls?.estado ||
            estado.resultadoActual?.detalleTls?.mensaje ||
            ''
        )
      }))
      .filter((estado) => estado.monitorId > 0)
      .sort((a, b) => a.monitorId - b.monitorId);
    const alertas = Array.isArray(resumenAlertasActivas?.alertas)
      ? resumenAlertasActivas.alertas
          .map((alerta) => ({
            monitorId: Number(alerta?.monitorId || 0) || 0,
            tipoMonitor: String(alerta?.tipoMonitor || '').trim().toLowerCase(),
            estadoDetectado: String(alerta?.estadoDetectado || '')
              .trim()
              .toLowerCase(),
            codigoUltimoResultado: normalizarTextoSignificativo(
              alerta?.codigoUltimoResultado
            ),
            mensajeUltimoResultado: normalizarTextoSignificativo(
              alerta?.mensajeUltimoResultado
            )
          }))
          .filter((alerta) => alerta.monitorId > 0)
          .sort((a, b) => a.monitorId - b.monitorId)
      : [];
    const payloadFirma = {
      versionCatalogoMonitores: Number(versionCatalogoMonitores || 0) || 0,
      resumen: {
        totalMonitores: Number(resumen.totalMonitores || 0) || 0,
        totalActivos: Number(resumen.totalActivos || 0) || 0,
        totalInactivos: Number(resumen.totalInactivos || 0) || 0,
        totalConEstado: Number(resumen.totalConEstado || 0) || 0,
        totalSinEjecutar: Number(resumen.totalSinEjecutar || 0) || 0,
        totalDisponibles: Number(resumen.totalDisponibles || 0) || 0,
        totalIndisponibles: Number(resumen.totalIndisponibles || 0) || 0,
        totalDegradados: Number(resumen.totalDegradados || 0) || 0,
        totalDesconocidos: Number(resumen.totalDesconocidos || 0) || 0,
        porTipo: normalizarDistribucionTipos(resumen.porTipo)
      },
      alertas: {
        totalAlertasActivas:
          Number(resumenAlertasActivas?.totalAlertasActivas || 0) || 0,
        items: alertas
      },
      incidencias
    };

    return crypto
      .createHash('sha1')
      .update(JSON.stringify(payloadFirma))
      .digest('hex');
  }

  normalizarResumenScheduler(resumenScheduler) {
    if (!resumenScheduler || typeof resumenScheduler !== 'object') {
      return null;
    }

    return {
      fechaEvaluacionUtc: resumenScheduler.fechaEvaluacionUtc || null,
      totalConsiderados: Number(resumenScheduler.totalConsiderados || 0),
      totalVencidos: Number(resumenScheduler.totalVencidos || 0),
      totalPendientesFuturos: Number(
        resumenScheduler.totalPendientesFuturos || 0
      ),
      proximoIntentoGlobalEn: resumenScheduler.proximoIntentoGlobalEn || null,
      ultimoOrigenTick: resumenScheduler.ultimoOrigenTick || null,
      ultimaEjecucion: resumenScheduler.ultimaEjecucion
        ? {
            ejecutadoEnUtc: resumenScheduler.ultimaEjecucion.ejecutadoEnUtc || null,
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
            )
          }
        : null,
      ultimaPersistenciaEstadoActual: resumenScheduler.ultimaPersistenciaEstadoActual
        ? {
            totalResultados: Number(
              resumenScheduler.ultimaPersistenciaEstadoActual.totalResultados || 0
            ),
            totalPersistidos: Number(
              resumenScheduler.ultimaPersistenciaEstadoActual.totalPersistidos || 0
            ),
            totalCambiosEstado: Number(
              resumenScheduler.ultimaPersistenciaEstadoActual.totalCambiosEstado ||
                0
            ),
            totalSinCambioEstado: Number(
              resumenScheduler.ultimaPersistenciaEstadoActual.totalSinCambioEstado ||
                0
            )
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
            )
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
            )
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
            )
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
            )
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
                resumenScheduler.ultimaCoordinacionBloqueosRedis.monitorIdsSaltados
              )
                ? resumenScheduler.ultimaCoordinacionBloqueosRedis
                    .monitorIdsSaltados
                : [],
              liberacion:
                resumenScheduler.ultimaCoordinacionBloqueosRedis.liberacion
                  ? {
                      totalBloqueos: Number(
                        resumenScheduler.ultimaCoordinacionBloqueosRedis.liberacion
                          .totalBloqueos || 0
                      ),
                      totalLiberados: Number(
                        resumenScheduler.ultimaCoordinacionBloqueosRedis.liberacion
                          .totalLiberados || 0
                      ),
                      totalNoLiberados: Number(
                        resumenScheduler.ultimaCoordinacionBloqueosRedis.liberacion
                          .totalNoLiberados || 0
                      )
                    }
                  : null
            }
          : null
    };
  }

  obtenerClavePresencia() {
    return `${this.configuracionRuntime.redisPrefijo}instancias:${this.instanciaId}:presencia`;
  }

  obtenerClaveCatalogo() {
    return `${this.configuracionRuntime.redisPrefijo}instancias:${this.instanciaId}:catalogo`;
  }

  obtenerClaveEstado() {
    return `${this.configuracionRuntime.redisPrefijo}instancias:${this.instanciaId}:estado`;
  }

  obtenerClaveVersionCatalogo() {
    return `${this.configuracionRuntime.redisPrefijo}instancias:${this.instanciaId}:version_catalogo`;
  }

  obtenerClaveDashboard() {
    return `${this.configuracionRuntime.redisPrefijo}dashboard`;
  }
}

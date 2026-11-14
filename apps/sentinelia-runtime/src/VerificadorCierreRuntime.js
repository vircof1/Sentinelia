import { DiagnosticoRuntime } from './DiagnosticoRuntime.js';
import { RepositorioEventosMonitor } from '../../../paquetes/monitores/src/RepositorioEventosMonitor.js';
import { RepositorioAlertasActivasMonitor } from '../../../paquetes/monitores/src/RepositorioAlertasActivasMonitor.js';
import { RepositorioHistoricoMonitores } from '../../../paquetes/monitores/src/RepositorioHistoricoMonitores.js';

function dormir(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function normalizarFechaMs(valor) {
  if (!valor) {
    return null;
  }

  const ms = Date.parse(String(valor));
  return Number.isNaN(ms) ? null : ms;
}

function normalizarTexto(valor, porDefecto = '') {
  if (valor == null || valor === '') {
    return porDefecto;
  }

  return String(valor).trim();
}

function parsearJsonSeguro(valor) {
  if (!valor) {
    return null;
  }

  if (typeof valor === 'object') {
    return valor;
  }

  try {
    return JSON.parse(String(valor));
  } catch (_error) {
    return null;
  }
}

function esFechaUtcValida(valor) {
  return normalizarFechaMs(valor) != null;
}

function esEstadoSaludable(estado) {
  return normalizarTexto(estado, 'desconocido').toLowerCase() === 'disponible';
}

function esEstadoNoConcluyente(estado) {
  return normalizarTexto(estado, 'desconocido').toLowerCase() === 'desconocido';
}

function esEstadoFalloConcluyente(estado) {
  return !esEstadoSaludable(estado) && !esEstadoNoConcluyente(estado);
}

function sonFechasEquivalentes(a, b) {
  const aMs = normalizarFechaMs(a);
  const bMs = normalizarFechaMs(b);

  if (aMs == null || bMs == null) {
    return false;
  }

  return aMs === bMs;
}

export class VerificadorCierreRuntime {
  constructor({ crearRuntime, timeoutEjecucionMs = 70000 }) {
    this.crearRuntime = crearRuntime;
    this.timeoutEjecucionMs = timeoutEjecucionMs;
  }

  async ejecutar() {
    const primeraInstancia = this.crearRuntime();
    let diagnosticoPrimera = null;
    let sqlPrimera = null;
    let diagnosticoSegunda = null;
    let sqlSegunda = null;

    try {
      await primeraInstancia.arrancar();
      diagnosticoPrimera = await this.esperarPrimeraEjecucionReal(primeraInstancia);
      sqlPrimera = await this.inspeccionarPersistenciaSql({
        runtime: primeraInstancia,
        diagnostico: diagnosticoPrimera
      });
    } finally {
      await primeraInstancia
        .detener({ motivo: 'verificacion cierre estructural primera instancia' })
        .catch(() => {});
    }

    const segundaInstancia = this.crearRuntime();

    try {
      await segundaInstancia.arrancar();
      diagnosticoSegunda = new DiagnosticoRuntime({
        runtime: segundaInstancia
      }).construir();
      sqlSegunda = await this.inspeccionarPersistenciaSql({
        runtime: segundaInstancia,
        diagnostico: diagnosticoSegunda,
        idsMonitorBase: sqlPrimera?.monitorIds || []
      });
    } finally {
      await segundaInstancia
        .detener({ motivo: 'verificacion cierre estructural segunda instancia' })
        .catch(() => {});
    }

    return this.construirResultado({
      diagnosticoPrimera,
      sqlPrimera,
      diagnosticoSegunda,
      sqlSegunda
    });
  }

  async esperarPrimeraEjecucionReal(runtime) {
    const inicioMs = Date.now();
    let ultimoDiagnostico = new DiagnosticoRuntime({ runtime }).construir();

    while (Date.now() - inicioMs < this.timeoutEjecucionMs) {
      const totalResultadosEventos = Number(
        ultimoDiagnostico.scheduler?.ultimaPersistenciaEventos?.totalResultados || 0
      );
      const totalConstruidosEventos = Number(
        ultimoDiagnostico.scheduler?.ultimaPersistenciaEventos?.totalConstruidos || 0
      );
      const totalPersistidosEventos = Number(
        ultimoDiagnostico.scheduler?.ultimaPersistenciaEventos?.totalPersistidos || 0
      );
      const evidencioProcesamientoEventos =
        totalResultadosEventos > 0 &&
        (
          totalConstruidosEventos > 0 ||
          totalPersistidosEventos > 0
        );

      if (
        Number(ultimoDiagnostico.scheduler?.ultimaEjecucion?.totalEjecutados || 0) > 0 &&
        Number(
          ultimoDiagnostico.scheduler?.ultimaPersistenciaEstadoActual
            ?.totalPersistidos || 0
        ) > 0 &&
        evidencioProcesamientoEventos &&
        Number(
          ultimoDiagnostico.scheduler?.ultimaPersistenciaAlertas
            ?.totalResultados || 0
        ) > 0 &&
        (
          Number(
            ultimoDiagnostico.scheduler?.ultimaPersistenciaHistorico
              ?.totalPersistidos || 0
          ) > 0 ||
          Number(
            ultimoDiagnostico.scheduler?.ultimaPersistenciaHistorico
              ?.totalActualizados || 0
          ) > 0
        )
      ) {
        return ultimoDiagnostico;
      }

      const proximoIntentoMs = normalizarFechaMs(
        ultimoDiagnostico.scheduler?.proximoIntentoGlobalEn
      );
      const ahoraMs = Date.now();
      const esperaMs = proximoIntentoMs
        ? Math.max(250, Math.min(5000, (proximoIntentoMs - ahoraMs) + 250))
        : 1000;

      await dormir(esperaMs);
      await runtime.planificadorMonitores.ejecutarTick({
        origen: 'verificacion_cierre'
      });
      ultimoDiagnostico = new DiagnosticoRuntime({ runtime }).construir();
    }

    throw new Error(
      `No se observó una ejecución real con persistencia estructural suficiente dentro de ${this.timeoutEjecucionMs} ms.`
    );
  }

  async inspeccionarPersistenciaSql({
    runtime,
    diagnostico,
    idsMonitorBase = []
  }) {
    const clienteSql = runtime.contexto?.clienteSql || null;

    if (!clienteSql) {
      return {
        monitorIds: [],
        checks: [],
        okGlobal: false,
        detalle: 'El runtime no expuso cliente SQL para la verificación.'
      };
    }

    const repositorioEstadoActual =
      runtime.contexto?.repositorioEstadoActualMonitores || null;
    const repositorioEventos = new RepositorioEventosMonitor(clienteSql);
    const repositorioAlertas = new RepositorioAlertasActivasMonitor(clienteSql);
    const repositorioHistorico = new RepositorioHistoricoMonitores(clienteSql);
    const monitorIds = this.resolverMonitorIdsRelevantes(diagnostico, idsMonitorBase);

    if (monitorIds.length === 0 || !repositorioEstadoActual) {
      return {
        monitorIds,
        checks: [],
        okGlobal: false,
        detalle: 'No hubo monitores relevantes o falta repositorio de estado actual.'
      };
    }

    const estadosActuales =
      await repositorioEstadoActual.listarPorMonitorIds(monitorIds);
    const eventos = await repositorioEventos.listarUltimosPorMonitorIds(monitorIds);
    const alertas = await repositorioAlertas.listarPorMonitorIds(monitorIds);
    const historicos = await repositorioHistorico.listarUltimosPorMonitorIds(
      monitorIds
    );
    const recientesPorMonitor = new Map();

    for (const monitorId of monitorIds) {
      const eventosRecientes = await repositorioEventos.listarPorMonitorId(monitorId, {
        limite: 12
      });
      recientesPorMonitor.set(
        Number(monitorId),
        eventosRecientes
          .map((evento) => evento.serializarResumen())
          .sort(
            (a, b) =>
              (normalizarFechaMs(a.ejecutadoEnUtc) || 0) -
              (normalizarFechaMs(b.ejecutadoEnUtc) || 0)
          )
      );
    }

    const estadosPorMonitor = new Map(
      estadosActuales.map((fila) => [Number(fila.monitor_id), fila])
    );
    const eventosPorMonitor = new Map(
      eventos.map((evento) => [evento.monitorId, evento.serializarResumen()])
    );
    const alertasPorMonitor = new Map(
      alertas.map((alerta) => [alerta.monitorId, alerta.serializarResumen()])
    );
    const historicosPorMonitor = new Map(
      historicos.map((tramo) => [tramo.monitorId, tramo.serializarResumen()])
    );

    const checks = [];

    checks.push({
      clave: 'sql_estado_actual_cubre_monitores',
      ok: estadosActuales.length === monitorIds.length,
      detalle:
        `estado_actual_monitores cubre ${estadosActuales.length}/${monitorIds.length} monitores verificados`
    });

    checks.push({
      clave: 'sql_eventos_cubren_monitores',
      ok: eventos.length === monitorIds.length,
      detalle:
        `eventos_monitores aporta último evento para ${eventos.length}/${monitorIds.length} monitores verificados`
    });

    const incoherenciasScopeEventos = [];
    const incoherenciasEstadoEvento = [];
    const incoherenciasAlerta = [];
    const incoherenciasHistorico = [];
    const incoherenciasUtc = [];

    for (const monitorId of monitorIds) {
      const filaEstado = estadosPorMonitor.get(monitorId) || null;
      const evento = eventosPorMonitor.get(monitorId) || null;
      const alerta = alertasPorMonitor.get(monitorId) || null;
      const historico = historicosPorMonitor.get(monitorId) || null;

      if (evento) {
        const scopeEvento = evento.payloadEvento?.scope || null;
        const protocoloEvento = evento.payloadEvento?.protocolo || null;

        if (
          !scopeEvento ||
          Number(scopeEvento.tenantId || 0) !== Number(evento.tenantId || 0) ||
          Number(scopeEvento.empresaId || 0) !== Number(evento.empresaId || 0) ||
          Number(scopeEvento.sitioId || 0) !== Number(evento.sitioId || 0)
        ) {
          incoherenciasScopeEventos.push({
            monitorId,
            eventoId: evento.id
          });
        }

        if (!esFechaUtcValida(evento.ejecutadoEnUtc)) {
          incoherenciasUtc.push({
            tabla: 'eventos_monitores',
            monitorId,
            campo: 'ejecutado_en_utc'
          });
        }

        if (protocoloEvento?.nombre && protocoloEvento.nombre !== evento.tipoMonitor) {
          incoherenciasScopeEventos.push({
            monitorId,
            eventoId: evento.id,
            motivo: 'tipo_payload_no_alineado'
          });
        }
      }

      if (filaEstado && evento) {
        const resultadoActual = parsearJsonSeguro(filaEstado.resultado_actual);
        const estadoSql = normalizarTexto(filaEstado.estado, 'desconocido').toLowerCase();
        const versionSql = normalizarTexto(filaEstado.version_catalogo, '');
        const codigoResultadoSql = normalizarTexto(
          resultadoActual?.codigoResultado,
          ''
        );

        if (
          versionSql !== evento.versionCatalogo ||
          estadoSql !== evento.estadoDetectado ||
          codigoResultadoSql !== evento.codigoResultado ||
          (
            esFechaUtcValida(filaEstado.fecha_ultima_ejecucion_utc) &&
            esFechaUtcValida(evento.ejecutadoEnUtc) &&
            normalizarFechaMs(evento.ejecutadoEnUtc) >
              normalizarFechaMs(filaEstado.fecha_ultima_ejecucion_utc)
          )
        ) {
          incoherenciasEstadoEvento.push({
            monitorId,
            versionSql,
            versionEvento: evento.versionCatalogo,
            estadoSql,
            estadoEvento: evento.estadoDetectado,
            codigoResultadoSql,
            codigoResultadoEvento: evento.codigoResultado
          });
        }

        if (
          !esFechaUtcValida(filaEstado.fecha_ultima_ejecucion_utc) ||
          !esFechaUtcValida(filaEstado.fecha_ultimo_cambio_utc)
        ) {
          incoherenciasUtc.push({
            tabla: 'estado_actual_monitores',
            monitorId,
            campo: 'fechas_estado'
          });
        }
      }

      if (filaEstado) {
        const estadoSql = normalizarTexto(filaEstado.estado, 'desconocido').toLowerCase();

        if (
          !esEstadoNoConcluyente(estadoSql) &&
          esEstadoSaludable(estadoSql)
        ) {
          if (alerta) {
            incoherenciasAlerta.push({
              monitorId,
              motivo: 'alerta_activa_con_estado_saludable'
            });
          }
        } else if (!esEstadoNoConcluyente(estadoSql) && !alerta) {
          incoherenciasAlerta.push({
            monitorId,
            motivo: 'sin_alerta_para_estado_no_saludable'
          });
        } else if (!esEstadoNoConcluyente(estadoSql)) {
          if (
            alerta.versionCatalogo !== normalizarTexto(filaEstado.version_catalogo, '') ||
            alerta.estadoDetectado !== estadoSql
          ) {
            incoherenciasAlerta.push({
              monitorId,
              motivo: 'alerta_no_alineada_con_estado_actual'
            });
          }

          if (
            !esFechaUtcValida(alerta.validoDesdeUtc) ||
            !esFechaUtcValida(alerta.ultimaConfirmacionUtc) ||
            !esFechaUtcValida(alerta.ultimaEjecucionUtc)
          ) {
            incoherenciasUtc.push({
              tabla: 'alertas_activas_monitores',
              monitorId,
              campo: 'fechas_alerta'
            });
          }
        }
      }

      if (historico) {
        if (
          !esFechaUtcValida(historico.validoDesdeUtc) ||
          !esFechaUtcValida(historico.validoHastaUtc)
        ) {
          incoherenciasUtc.push({
            tabla: 'historico_monitores',
            monitorId,
            campo: 'ventana_historica'
          });
        }

        if (historico.ultimoEventoId != null) {
          const eventoReferenciado =
            await repositorioEventos.buscarPorId(historico.ultimoEventoId);
          const resumenEventoReferenciado =
            eventoReferenciado?.serializarResumen?.() || null;

          if (
            !resumenEventoReferenciado ||
            Number(resumenEventoReferenciado.monitorId || 0) !== Number(monitorId) ||
            resumenEventoReferenciado.versionCatalogo !== historico.versionCatalogo
          ) {
            incoherenciasHistorico.push({
              monitorId,
              tramoId: historico.id,
              ultimoEventoId: historico.ultimoEventoId,
              motivo: 'ultimo_evento_no_alineado'
            });
          }
        }
      }
    }

    checks.push({
      clave: 'sql_scope_eventos_materializado',
      ok: incoherenciasScopeEventos.length === 0,
      detalle:
        incoherenciasScopeEventos.length === 0
          ? 'El scope y el tipo materializados en eventos_monitores son coherentes con su payload.'
          : `${incoherenciasScopeEventos.length} eventos con scope o tipo incoherente`
    });

    checks.push({
      clave: 'sql_estado_vs_evento_actual',
      ok: incoherenciasEstadoEvento.length === 0,
      detalle:
        incoherenciasEstadoEvento.length === 0
          ? 'estado_actual_monitores refleja el último evento persistido por monitor.'
          : `${incoherenciasEstadoEvento.length} monitores con divergencia entre estado actual y último evento`
    });

    checks.push({
      clave: 'sql_alerta_vs_estado_actual',
      ok: incoherenciasAlerta.length === 0,
      detalle:
        incoherenciasAlerta.length === 0
          ? 'La alerta activa actual concuerda con el estado saludable/no saludable del monitor.'
          : `${incoherenciasAlerta.length} incoherencias entre alertas activas y estado actual`
    });

    checks.push({
      clave: 'sql_historico_referencia_evento',
      ok: incoherenciasHistorico.length === 0,
      detalle:
        incoherenciasHistorico.length === 0
          ? 'El histórico compacto mantiene referencias válidas a eventos cuando ultimo_evento_id existe.'
          : `${incoherenciasHistorico.length} tramos con referencia de evento incoherente`
    });

    checks.push({
      clave: 'sql_fechas_utc_validas',
      ok: incoherenciasUtc.length === 0,
      detalle:
        incoherenciasUtc.length === 0
          ? 'Las marcas temporales clave de SQL son parseables y coherentes en UTC.'
          : `${incoherenciasUtc.length} filas con fechas UTC no válidas`
    });

    const evidenciaCiclo = this.analizarEvidenciaSemantica({
      monitorIds,
      recientesPorMonitor,
      alertasPorMonitor
    });

    return {
      monitorIds,
      totalEstadosActuales: estadosActuales.length,
      totalEventos: eventos.length,
      totalAlertas: alertas.length,
      totalHistoricos: historicos.length,
      evidenciaCiclo,
      incoherencias: {
        scopeEventos: incoherenciasScopeEventos,
        estadoEvento: incoherenciasEstadoEvento,
        alertaEstado: incoherenciasAlerta,
        historicoEvento: incoherenciasHistorico,
        utc: incoherenciasUtc
      },
      checks,
      okGlobal: checks.every((check) => check.ok)
    };
  }

  analizarEvidenciaSemantica({
    monitorIds,
    recientesPorMonitor,
    alertasPorMonitor
  }) {
    const monitoresConRepeticion = [];
    const monitoresConRecuperacion = [];
    const monitoresConAlertaActiva = [];

    for (const monitorId of monitorIds) {
      const eventos = recientesPorMonitor.get(Number(monitorId)) || [];
      const alerta = alertasPorMonitor.get(Number(monitorId)) || null;

      if (alerta) {
        monitoresConAlertaActiva.push(Number(monitorId));
      }

      for (let indice = 1; indice < eventos.length; indice += 1) {
        const previo = eventos[indice - 1];
        const actual = eventos[indice];

        if (
          esEstadoFalloConcluyente(previo.estadoDetectado) &&
          esEstadoFalloConcluyente(actual.estadoDetectado) &&
          previo.codigoResultado === actual.codigoResultado
        ) {
          monitoresConRepeticion.push(Number(monitorId));
          break;
        }
      }

      for (let indice = 1; indice < eventos.length; indice += 1) {
        const previo = eventos[indice - 1];
        const actual = eventos[indice];

        if (
          esEstadoFalloConcluyente(previo.estadoDetectado) &&
          esEstadoSaludable(actual.estadoDetectado)
        ) {
          monitoresConRecuperacion.push(Number(monitorId));
          break;
        }
      }
    }

    return {
      monitoresAnalizados: monitorIds.length,
      monitoresConAlertaActiva: [...new Set(monitoresConAlertaActiva)],
      monitoresConRepeticion: [...new Set(monitoresConRepeticion)],
      monitoresConRecuperacion: [...new Set(monitoresConRecuperacion)]
    };
  }

  resolverMonitorIdsRelevantes(diagnostico, idsMonitorBase = []) {
    const idsDesdeResultados = Array.isArray(
      diagnostico?.scheduler?.ultimaEjecucion?.resultados
    )
      ? diagnostico.scheduler.ultimaEjecucion.resultados
          .map((resultado) => Number.parseInt(String(resultado?.monitorId), 10))
          .filter((id) => Number.isInteger(id) && id > 0)
      : [];
    const idsDesdePersistencia = Array.isArray(
      diagnostico?.scheduler?.ultimaPersistenciaEstadoActual?.monitoresActualizados
    )
      ? diagnostico.scheduler.ultimaPersistenciaEstadoActual.monitoresActualizados
          .map((item) => Number.parseInt(String(item?.monitorId), 10))
          .filter((id) => Number.isInteger(id) && id > 0)
      : [];
    const ids = [
      ...idsDesdeResultados,
      ...idsDesdePersistencia,
      ...idsMonitorBase
    ];

    return [...new Set(ids)];
  }

  construirResultado({
    diagnosticoPrimera,
    sqlPrimera,
    diagnosticoSegunda,
    sqlSegunda
  }) {
    const checks = [];

    checks.push({
      clave: 'primera_ejecucion_real',
      ok: Number(diagnosticoPrimera.scheduler?.ultimaEjecucion?.totalEjecutados || 0) > 0,
      detalle: 'la primera instancia llegó a ejecutar al menos un monitor real'
    });

    checks.push({
      clave: 'primera_persistencia_sql',
      ok:
        Number(
          diagnosticoPrimera.scheduler?.ultimaPersistenciaEstadoActual
            ?.totalPersistidos || 0
        ) > 0,
      detalle: 'la primera instancia persistió el lote ejecutado en SQL'
    });

    checks.push({
      clave: 'primera_eventos_historicos',
      ok:
        Number(
          diagnosticoPrimera.scheduler?.ultimaPersistenciaEventos
            ?.totalResultados || 0
        ) > 0 &&
        (
          Number(
            diagnosticoPrimera.scheduler?.ultimaPersistenciaEventos
              ?.totalConstruidos || 0
          ) > 0 ||
          Number(
            diagnosticoPrimera.scheduler?.ultimaPersistenciaEventos
              ?.totalPersistidos || 0
          ) > 0
        ),
      detalle:
        Number(
          diagnosticoPrimera.scheduler?.ultimaPersistenciaEventos
            ?.totalPersistidos || 0
        ) > 0
          ? 'la primera instancia dejó trazas históricas por ejecución real'
          : 'la primera instancia procesó el lote de eventos; si no insertó filas nuevas, la compactación lo absorbió de forma válida'
    });

    checks.push({
      clave: 'primera_alertas_evaluadas',
      ok:
        Number(
          diagnosticoPrimera.scheduler?.ultimaPersistenciaAlertas
            ?.totalResultados || 0
        ) > 0,
      detalle: 'la primera instancia evaluó alertas activas sobre el lote real'
    });

    checks.push({
      clave: 'primera_historico_compacto',
      ok:
        Number(
          diagnosticoPrimera.scheduler?.ultimaPersistenciaHistorico
            ?.totalPersistidos || 0
        ) > 0 ||
        Number(
          diagnosticoPrimera.scheduler?.ultimaPersistenciaHistorico
            ?.totalActualizados || 0
        ) > 0,
      detalle:
        'la primera instancia abrió o extendió tramos de histórico compacto sobre el lote real'
    });

    checks.push({
      clave: 'primera_redis_republicado',
      ok: Number(diagnosticoPrimera.redisEfimero?.totalPublicaciones || 0) >= 2,
      detalle:
        'la primera instancia republicó Redis más allá de la publicación inicial'
    });

    checks.push({
      clave: 'segunda_rehidratacion',
      ok: Number(diagnosticoSegunda.rehidratacion?.rehidratados || 0) > 0,
      detalle: 'la segunda instancia rehidrató estado persistido desde SQL'
    });

    checks.push({
      clave: 'segunda_desconocidos_estables',
      ok:
        Number(diagnosticoSegunda.estadoActual?.totalDesconocidos || 0) ===
        Number(diagnosticoPrimera.estadoActual?.totalDesconocidos || 0),
      detalle:
        'la segunda instancia conservó los estados desconocidos legítimos sin introducir regresiones al rehidratar'
    });

    checks.push({
      clave: 'segunda_redis_publicado',
      ok: Number(diagnosticoSegunda.redisEfimero?.totalPublicaciones || 0) >= 1,
      detalle: 'la segunda instancia republicó su fotografía efímera en Redis'
    });

    checks.push({
      clave: 'utc_mantenido',
      ok:
        Number(
          diagnosticoPrimera.bootstrap?.sql?.usoHorarioUtc?.diferenciaSegundos || 0
        ) === 0 &&
        Number(
          diagnosticoSegunda.bootstrap?.sql?.usoHorarioUtc?.diferenciaSegundos || 0
        ) === 0,
      detalle: 'la validación UTC se mantuvo correcta antes y después del reinicio'
    });

    checks.push({
      clave: 'proximo_intento_rehidratado',
      ok:
        typeof diagnosticoSegunda.estadoActual?.proximoIntentoGlobalEn === 'string' &&
        diagnosticoSegunda.estadoActual.proximoIntentoGlobalEn.length > 0,
      detalle:
        'la segunda instancia recalculó y materializó un próximo intento global tras rehidratar'
    });

    checks.push({
      clave: 'sql_primera_coherente',
      ok: Boolean(sqlPrimera?.okGlobal),
      detalle:
        'los artefactos SQL del primer ciclo son coherentes entre estado actual, eventos, alertas e histórico'
    });

    checks.push({
      clave: 'sql_segunda_coherente',
      ok: Boolean(sqlSegunda?.okGlobal),
      detalle:
        'la segunda instancia sigue viendo coherencia SQL tras rehidratar y republicar'
    });

    return {
      okGlobal: checks.every((check) => check.ok),
      timeoutEjecucionMs: this.timeoutEjecucionMs,
      primeraInstancia: diagnosticoPrimera,
      sqlPrimera,
      segundaInstancia: diagnosticoSegunda,
      sqlSegunda,
      observaciones: {
        evidenciaCicloSql: sqlPrimera?.evidenciaCiclo || null,
        detalle:
          'La evidencia de repetición, alerta activa o recuperación se expone como observación del entorno real y no como check bloqueante.'
      },
      checks
    };
  }
}

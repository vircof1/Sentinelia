function ordenarAlertas(a, b) {
  const fechaA = Date.parse(a.ultimaConfirmacionUtc || a.ultimaEjecucionUtc || 0);
  const fechaB = Date.parse(b.ultimaConfirmacionUtc || b.ultimaEjecucionUtc || 0);

  if (fechaA !== fechaB) {
    return fechaB - fechaA;
  }

  if (a.contadorRepeticiones !== b.contadorRepeticiones) {
    return b.contadorRepeticiones - a.contadorRepeticiones;
  }

  return String(a.monitorNombre || '').localeCompare(
    String(b.monitorNombre || ''),
    'es'
  );
}

function descarteVigente(alertaSerializada) {
  return Boolean(alertaSerializada?.descarteOperativo?.vigente);
}

function normalizarIdPositivo(valor) {
  const convertido = Number.parseInt(String(valor ?? ''), 10);
  return Number.isInteger(convertido) && convertido > 0 ? convertido : null;
}

export class ServicioDashboard {
  constructor({
    repositorioMonitores,
    repositorioAlertasActivasMonitor,
    repositorioUsuarios = null,
    repositorioZonasDns,
    repositorioRegistrosDns,
    servicioAutorizacion,
    servicioAlertasRemotasPortal = null,
    servicioCausalidadAlertasLocalesFederadas = null,
    clienteRedis = null,
    configuracionRuntime = null
  }) {
    this.repositorioMonitores = repositorioMonitores;
    this.repositorioAlertasActivasMonitor = repositorioAlertasActivasMonitor;
    this.repositorioUsuarios = repositorioUsuarios;
    this.repositorioZonasDns = repositorioZonasDns;
    this.repositorioRegistrosDns = repositorioRegistrosDns;
    this.servicioAutorizacion = servicioAutorizacion;
    this.servicioAlertasRemotasPortal = servicioAlertasRemotasPortal;
    this.servicioCausalidadAlertasLocalesFederadas =
      servicioCausalidadAlertasLocalesFederadas;
    this.clienteRedis = clienteRedis;
    this.configuracionRuntime = configuracionRuntime;
  }

  async construirDashboardBase(
    contextoUsuarioActual,
    { limiteAlertasDestacadas = 8 } = {}
  ) {
    const puedeVerMonitores = this.servicioAutorizacion.puedeVerMonitores(
      contextoUsuarioActual
    );
    const puedeGestionarDescartesAlertasActivas =
      this.servicioAutorizacion.puedeGestionarDescartesAlertasActivas(
        contextoUsuarioActual
      );
    const puedeVerDns = this.servicioAutorizacion.puedeVerDns(
      contextoUsuarioActual
    );
    const dashboardBase = {
      habilitado: puedeVerMonitores,
      origenDatos: 'sql',
      generadoEnUtc: new Date().toISOString(),
      version: 1,
      resumenSalud: {
        tono: 'neutro',
        titulo: 'Sin lectura operativa',
        detalle: 'La sesión no tiene permiso para leer monitores.'
      },
      resumenMonitores: {
        totalMonitores: 0,
        totalActivos: 0,
        totalInactivos: 0,
        totalPendientes: 0,
        totalConEstado: 0,
        totalDisponibles: 0,
        totalIndisponibles: 0,
        totalIndisponiblesAlertables: 0,
        totalDegradados: 0,
        totalDegradadosAlertables: 0,
        totalDesconocidos: 0,
        totalAlertasActivas: 0,
        totalAlertasVisibles: 0,
        totalAlertasDescartadas: 0
      },
      resumenDns: {
        habilitado: puedeVerDns,
        totalZonas: 0,
        totalRegistros: 0,
        totalActivas: 0,
        totalPublicadas: 0
      },
      resumenRuntime: await this.construirResumenRuntime(),
      permisosOperativos: {
        puedeGestionarDescartesAlertasActivas
      },
      alertasActivas: [],
      alertasDestacadas: [],
      alertasDescartadas: []
    };
    const puedeVerAlertasRemotas = this.servicioAutorizacion.puedeVerAlertasRemotas(
      contextoUsuarioActual
    );
    dashboardBase.alertasRemotas = puedeVerAlertasRemotas &&
      this.servicioAlertasRemotasPortal
      ? await this.servicioAlertasRemotasPortal.consultar(
          contextoUsuarioActual, { exigirPreferencia: true }
        )
      : { permiso: puedeVerAlertasRemotas,
          preferencia: puedeVerAlertasRemotas && Boolean(
            contextoUsuarioActual.preferenciaMostrarAlertasRemotas
          ), puedeGestionarDescartes: false, totalActuales: 0,
          totalVisibles: 0, totalDescartadas: 0, totalSinVigencia: 0,
          alertasVisibles: [], alertasDescartadas: [], alertasSinVigencia: [] };

    if (puedeVerDns) {
      dashboardBase.resumenDns = await this.construirResumenDns(
        contextoUsuarioActual
      );
    }

    if (!puedeVerMonitores) {
      return dashboardBase;
    }

    const monitores = await this.repositorioMonitores.listarVisibles(
      contextoUsuarioActual
    );
    const monitoresPorId = new Map(
      monitores.map((monitor) => [monitor.id, monitor])
    );
    const monitoresActivos = monitores.filter((monitor) => monitor.activo);
    const alertas = this.repositorioAlertasActivasMonitor
      ? await this.repositorioAlertasActivasMonitor.listarPorMonitorIds(
          monitoresActivos.map((monitor) => monitor.id)
        )
      : [];
    let alertasSerializadas = alertas
      .filter((alerta) => {
        const monitor = monitoresPorId.get(alerta.monitorId);
        return monitor?.activo && !monitor.entradaComposicionBooleana;
      })
      .map((alerta) =>
        this.serializarAlertaParaDashboard(
          alerta,
          monitoresPorId.get(alerta.monitorId) || null
        )
      )
      .filter(Boolean);
    if (this.servicioCausalidadAlertasLocalesFederadas) {
      alertasSerializadas = await this.servicioCausalidadAlertasLocalesFederadas
        .enriquecer(contextoUsuarioActual, alertasSerializadas);
    } else {
      alertasSerializadas = alertasSerializadas.map((alerta) => {
        const { _evidenciaCausalFederada: _omitida, ...publica } = alerta;
        return publica;
      });
    }
    alertasSerializadas.sort(ordenarAlertas);
    await this.enriquecerDescartesConUsuarios(alertasSerializadas);
    const alertasVisibles = alertasSerializadas.filter(
      (alerta) => !descarteVigente(alerta)
    );
    const alertasDescartadas = alertasSerializadas.filter(descarteVigente);
    const resumenMonitores = this.construirResumenMonitores(monitores, {
      totalAlertasActivas: alertasSerializadas.length,
      totalAlertasVisibles: alertasVisibles.length,
      totalAlertasDescartadas: alertasDescartadas.length
    });

    return {
      ...dashboardBase,
      resumenSalud: this.construirResumenSalud(resumenMonitores),
      resumenMonitores,
      alertasActivas: alertasVisibles,
      alertasDestacadas: alertasVisibles.slice(
        0,
        this.normalizarLimiteAlertas(limiteAlertasDestacadas)
      ),
      alertasDescartadas
    };
  }

  async construirResumenDns(contextoUsuarioActual) {
    if (!this.repositorioZonasDns || !this.repositorioRegistrosDns) {
      return {
        habilitado: true,
        totalZonas: 0,
        totalRegistros: 0,
        totalActivas: 0,
        totalPublicadas: 0
      };
    }

    const zonas = await this.repositorioZonasDns.listarVisibles(
      contextoUsuarioActual
    );
    const idsZona = zonas.map((zona) => zona.id).filter(Boolean);
    const registros =
      idsZona.length > 0
        ? await this.repositorioRegistrosDns.listarPorZonaIds(idsZona)
        : [];

    return {
      habilitado: true,
      totalZonas: zonas.length,
      totalRegistros: registros.length,
      totalActivas: zonas.filter((zona) => zona.activo).length,
      totalPublicadas: zonas.filter(
        (zona) => String(zona.estadoPublicacion || '').trim().toLowerCase() === 'publicado'
      ).length
    };
  }

  construirResumenMonitores(monitores, resumenAlertas = {}) {
    const resumen = {
      totalMonitores: monitores.length,
      totalActivos: 0,
      totalInactivos: 0,
      totalPendientes: 0,
      totalConEstado: 0,
      totalDisponibles: 0,
      totalIndisponibles: 0,
      totalIndisponiblesAlertables: 0,
      totalDegradados: 0,
      totalDegradadosAlertables: 0,
      totalDesconocidos: 0,
      totalAlertasActivas: Number(resumenAlertas.totalAlertasActivas || 0),
      totalAlertasVisibles: Number(resumenAlertas.totalAlertasVisibles || 0),
      totalAlertasDescartadas: Number(
        resumenAlertas.totalAlertasDescartadas || 0
      )
    };

    for (const monitor of monitores) {
      if (monitor.activo) {
        resumen.totalActivos += 1;
      } else {
        resumen.totalInactivos += 1;
        continue;
      }

      if (!monitor.estadoActualRuntime?.ejecutadoTodavia) {
        resumen.totalPendientes += 1;
        continue;
      }

      resumen.totalConEstado += 1;
      const estado = String(monitor.estadoActualRuntime.estado || 'desconocido')
        .trim()
        .toLowerCase();

      if (estado === 'disponible') {
        resumen.totalDisponibles += 1;
        continue;
      }

      if (estado === 'indisponible') {
        resumen.totalIndisponibles += 1;
        if (!monitor.entradaComposicionBooleana) {
          resumen.totalIndisponiblesAlertables += 1;
        }
        continue;
      }

      if (estado === 'degradado') {
        resumen.totalDegradados += 1;
        if (!monitor.entradaComposicionBooleana) {
          resumen.totalDegradadosAlertables += 1;
        }
        continue;
      }

      resumen.totalDesconocidos += 1;
    }

    return resumen;
  }

  construirResumenSalud(resumenMonitores) {
    if (resumenMonitores.totalMonitores === 0) {
      return {
        tono: 'neutro',
        titulo: 'Sin monitores visibles',
        detalle: 'No hay monitores dentro del alcance operativo de la sesión.'
      };
    }

    if (resumenMonitores.totalActivos === 0) {
      return {
        tono: 'neutro',
        titulo: 'Sin monitores habilitados',
        detalle: 'Los monitores dentro de tu alcance están inactivos. No hay supervisión activa que requiera atención.'
      };
    }

    if (resumenMonitores.totalAlertasVisibles > 0) {
      return {
        tono: 'alerta',
        titulo: `${resumenMonitores.totalAlertasVisibles} alertas visibles`,
        detalle:
          'El panel excluye descartes vigentes del foco operativo principal.'
      };
    }

    if (resumenMonitores.totalAlertasDescartadas > 0) {
      return {
        tono: 'advertencia',
        titulo: 'Alertas activas descartadas',
        detalle:
          'Hay alertas activas ocultas del foco principal por descarte operativo.'
      };
    }

    if (
      resumenMonitores.totalIndisponiblesAlertables > 0 ||
      resumenMonitores.totalDegradadosAlertables > 0
    ) {
      return {
        tono: 'advertencia',
        titulo: 'Estado operativo degradado',
        detalle:
          'Hay monitores visibles con incidencias, aunque no exista alerta activa abierta en este momento.'
      };
    }

    if (resumenMonitores.totalConEstado === 0) {
      return {
        tono: 'pendiente',
        titulo: 'Sin ejecuciones visibles todavía',
        detalle:
          'Los monitores están definidos, pero aún no hay estado operativo materializado para esta sesión.'
      };
    }

    return {
      tono: 'ok',
      titulo: 'Sin alertas activas',
      detalle:
        'Los monitores visibles ya tienen lectura operativa y no mantienen alertas activas abiertas.'
    };
  }

  serializarAlertaParaDashboard(alerta, monitor) {
    if (!alerta || !monitor) {
      return null;
    }

    const estadoRuntime = monitor.serializarEstadoActualRuntimeVisible();
    const payloadAlerta = alerta.payloadAlerta || {};
    const resumenAlerta = alerta.serializarResumen();

    return {
      monitorId: monitor.id,
      monitorNombre: monitor.nombre,
      tipoMonitor: monitor.tipo,
      monitorActivo: monitor.activo,
      tenantId: monitor.tenantId,
      tenantNombre: monitor.tenantNombre,
      empresaId: monitor.empresaId,
      empresaNombre: monitor.empresaNombre,
      sitioId: monitor.sitioId,
      sitioNombre: monitor.sitioNombre,
      nivelPertenencia: monitor.resolverNivelPertenencia(),
      destinoPrincipal: monitor.obtenerDestinoPrincipal(),
      estadoAlerta: alerta.estadoAlerta,
      estadoDetectado: alerta.estadoDetectado,
      codigoUltimoResultado: alerta.codigoUltimoResultado,
      mensajeUltimoResultado: alerta.mensajeUltimoResultado,
      interpretacionEstado: payloadAlerta.interpretacionEstado || 'normal',
      interpretacionResultado: payloadAlerta.interpretacionResultado || null,
      resultadoTecnico: {
        exito: payloadAlerta.exitoTecnico ?? null,
        estadoDetectado: payloadAlerta.estadoTecnicoDetectado || null,
        codigoResultado: payloadAlerta.codigoResultadoTecnico || null,
        mensajeResultado: payloadAlerta.mensajeResultadoTecnico || null,
        detalleError: payloadAlerta.detalleErrorTecnico || null
      },
      validoDesdeUtc: resumenAlerta.validoDesdeUtc,
      ultimaConfirmacionUtc: resumenAlerta.ultimaConfirmacionUtc,
      ultimaEjecucionUtc: resumenAlerta.ultimaEjecucionUtc,
      contadorRepeticiones: alerta.contadorRepeticiones,
      descarteOperativo: resumenAlerta.descarteOperativo,
      protocolo: {
        host: payloadAlerta.protocolo?.host || monitor.configuracion?.host || null,
        puerto:
          payloadAlerta.protocolo?.puerto ?? monitor.configuracion?.puerto ?? null,
        usarTls:
          payloadAlerta.protocolo?.usarTls ?? monitor.configuracion?.usarTls ?? false
      },
      resumenHumano: {
        tono:
          estadoRuntime?.resumenHumano?.tono ||
          (alerta.estadoDetectado === 'degradado' ? 'advertencia' : 'alerta'),
        etiquetaEstado:
          estadoRuntime?.resumenHumano?.etiquetaEstado || alerta.estadoDetectado,
        etiquetaTecnica:
          estadoRuntime?.resumenHumano?.etiquetaTecnica ||
          alerta.codigoUltimoResultado,
        detalle:
          estadoRuntime?.resumenHumano?.detalle || alerta.mensajeUltimoResultado
      },
      estadoRuntime,
      _evidenciaCausalFederada: {
        causalidad: payloadAlerta.causalidadFederada || null,
        entradas: payloadAlerta.metricaPrincipal?.entradasFederadas || []
      }
    };
  }

  async enriquecerDescartesConUsuarios(alertasSerializadas) {
    if (
      !this.repositorioUsuarios ||
      typeof this.repositorioUsuarios.buscarPorId !== 'function'
    ) {
      return;
    }

    const idsUsuarios = [
      ...new Set(
        alertasSerializadas
          .map((alerta) =>
            normalizarIdPositivo(alerta?.descarteOperativo?.usuarioId)
          )
          .filter(Boolean)
      )
    ];

    if (idsUsuarios.length === 0) {
      return;
    }

    const paresUsuarios = await Promise.all(
      idsUsuarios.map(async (idUsuario) => {
        try {
          const usuario = await this.repositorioUsuarios.buscarPorId(idUsuario);
          return [idUsuario, this.serializarUsuarioDescarte(usuario)];
        } catch (error) {
          console.error(
            `[sentinelia-web] No se pudo resolver usuario de descarte ${idUsuario}.`
          );
          console.error(error);
          return [idUsuario, null];
        }
      })
    );
    const usuariosPorId = new Map(
      paresUsuarios.filter(([, usuario]) => Boolean(usuario))
    );

    for (const alerta of alertasSerializadas) {
      const descarte = alerta?.descarteOperativo || null;
      const usuarioId = normalizarIdPositivo(descarte?.usuarioId);
      const usuario = usuariosPorId.get(usuarioId) || null;

      if (descarte && usuario) {
        descarte.usuario = usuario;
      }
    }
  }

  serializarUsuarioDescarte(usuario) {
    if (!usuario) {
      return null;
    }

    const id = normalizarIdPositivo(usuario.id);
    const login = String(usuario.usuario || '').trim();
    const nombreVisible = String(
      usuario.obtenerNombreVisible?.() ||
        usuario.nombreMostrar ||
        usuario.nombreCompleto ||
        login ||
        ''
    ).trim();

    if (id == null && !login && !nombreVisible) {
      return null;
    }

    return {
      id,
      usuario: login || null,
      nombreVisible: nombreVisible || login || `Usuario #${id}`,
      nombreMostrar: usuario.nombreMostrar || null,
      nombreCompleto: usuario.nombreCompleto || null
    };
  }

  normalizarLimiteAlertas(valor) {
    const convertido = Number.parseInt(String(valor ?? ''), 10);

    if (!Number.isInteger(convertido)) {
      return 8;
    }

    return Math.min(50, Math.max(1, convertido));
  }

  async construirResumenRuntime() {
    const prefijo = String(this.configuracionRuntime?.redisPrefijo || '').trim();
    const ttlSegundos =
      Number(this.configuracionRuntime?.presenciaTtlSegundos || 0) || 0;
    const intervaloLatidoMs =
      Number(this.configuracionRuntime?.latidoIntervaloMs || 0) || 0;
    const resumenBase = {
      disponible: false,
      totalInstanciasActivas: 0,
      ultimoLatidoEnUtc: null,
      ultimoLatidoHaceSegundos: null,
      tono: 'suave',
      tooltip: 'La presencia runtime no está disponible ahora mismo.'
    };

    if (!this.clienteRedis || !prefijo) {
      return {
        ...resumenBase,
        tooltip: 'La presencia runtime no está disponible para esta lectura.'
      };
    }

    try {
      const claves = await this.listarClavesPresenciaRuntime(prefijo);

      if (claves.length === 0) {
        return {
          disponible: true,
          totalInstanciasActivas: 0,
          ultimoLatidoEnUtc: null,
          ultimoLatidoHaceSegundos: null,
          tono: 'alerta',
          tooltip: 'No se detecta ningún runtime activo.'
        };
      }

      const payloads = await this.leerPayloadsRuntime(claves);
      let ultimoLatidoMs = null;
      let ultimoLatidoEnUtc = null;

      for (const payload of payloads) {
        const marcaUtc = String(payload?.sincronizadoEn || '').trim();
        const marcaMs = Date.parse(marcaUtc);

        if (!Number.isFinite(marcaMs)) {
          continue;
        }

        if (ultimoLatidoMs == null || marcaMs > ultimoLatidoMs) {
          ultimoLatidoMs = marcaMs;
          ultimoLatidoEnUtc = new Date(marcaMs).toISOString();
        }
      }

      const ultimoLatidoHaceSegundos =
        ultimoLatidoMs == null
          ? null
          : Math.max(0, Math.floor((Date.now() - ultimoLatidoMs) / 1000));
      const umbralAdvertenciaSegundos =
        ttlSegundos > 0
          ? Math.max(1, Math.floor(ttlSegundos * 0.66))
          : Math.max(10, Math.ceil((intervaloLatidoMs * 2) / 1000));

      return {
        disponible: true,
        totalInstanciasActivas: claves.length,
        ultimoLatidoEnUtc,
        ultimoLatidoHaceSegundos,
        tono:
          ultimoLatidoHaceSegundos == null
            ? 'advertencia'
            : ultimoLatidoHaceSegundos <= umbralAdvertenciaSegundos
              ? 'ok'
              : 'advertencia',
        tooltip: this.construirTooltipRuntime({
          totalInstanciasActivas: claves.length,
          ultimoLatidoEnUtc,
          ultimoLatidoHaceSegundos
        })
      };
    } catch (_error) {
      return {
        ...resumenBase,
        tooltip: 'No se ha podido leer la presencia runtime.'
      };
    }
  }

  async listarClavesPresenciaRuntime(prefijo) {
    const patron = `${prefijo}instancias:*:presencia`;
    const claves = [];

    if (typeof this.clienteRedis.scanIterator === 'function') {
      for await (const clave of this.clienteRedis.scanIterator({
        MATCH: patron,
        COUNT: 100
      })) {
        if (clave) {
          claves.push(clave);
        }
      }

      return claves;
    }

    const listado = await this.clienteRedis.keys(patron);
    return Array.isArray(listado) ? listado.filter(Boolean) : [];
  }

  async leerPayloadsRuntime(claves) {
    if (!Array.isArray(claves) || claves.length === 0) {
      return [];
    }

    const bruto =
      typeof this.clienteRedis.mGet === 'function'
        ? await this.clienteRedis.mGet(claves)
        : await Promise.all(claves.map((clave) => this.clienteRedis.get(clave)));

    return (Array.isArray(bruto) ? bruto : [])
      .map((item) => {
        try {
          return item ? JSON.parse(item) : null;
        } catch (_error) {
          return null;
        }
      })
      .filter(Boolean);
  }

  construirTooltipRuntime({
    totalInstanciasActivas,
    ultimoLatidoEnUtc,
    ultimoLatidoHaceSegundos
  }) {
    if (totalInstanciasActivas <= 0) {
      return 'No se detecta ningún runtime activo.';
    }

    if (ultimoLatidoHaceSegundos == null || !ultimoLatidoEnUtc) {
      return `${totalInstanciasActivas} instancia${totalInstanciasActivas === 1 ? '' : 's'} runtime con latido vigente.`;
    }

    return [
      `Último latido hace ${this.formatearTiempoRelativo(ultimoLatidoHaceSegundos)}.`,
      `Instancias runtime con latido vigente: ${totalInstanciasActivas}.`,
      `Marca UTC: ${ultimoLatidoEnUtc}`
    ].join(' ');
  }

  formatearTiempoRelativo(segundos) {
    const valor = Math.max(0, Number(segundos || 0));

    if (valor < 60) {
      return `${valor} s`;
    }

    if (valor < 3600) {
      return `${Math.floor(valor / 60)} min`;
    }

    if (valor < 86400) {
      return `${Math.floor(valor / 3600)} h`;
    }

    return `${Math.floor(valor / 86400)} d`;
  }
}

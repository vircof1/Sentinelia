export class DespachadorCorreoRuntime {
  constructor({
    servicioCorreoPortal,
    servicioConfiguracionPortal = null,
    despachadorCorreoSql = null,
    evaluadorAutoridadCorreoSql = null,
    fronteraTransaccional = null
  }) {
    this.servicioCorreoPortal = servicioCorreoPortal;
    this.servicioConfiguracionPortal = servicioConfiguracionPortal;
    this.despachadorCorreoSql = despachadorCorreoSql;
    this.evaluadorAutoridadCorreoSql = evaluadorAutoridadCorreoSql;
    this.fronteraTransaccional = fronteraTransaccional;
  }

  async despacharPendientes({ origen = 'tick', numeroTick = null } = {}) {
    const ejecutadoEnUtc = new Date().toISOString();
    await this.servicioConfiguracionPortal?.asegurarActualizada?.();
    if (this.esColaSqlAutoritativa()) {
      return this.despacharPendientesSql({ ejecutadoEnUtc, origen, numeroTick });
    }
    return this.despacharPendientesLegacy({ ejecutadoEnUtc, origen, numeroTick });
  }

  async despacharPendientesLegacy({ ejecutadoEnUtc, origen, numeroTick }) {
    const estado = await this.obtenerEstadoDespachoLegacy();

    if (!estado.activa) {
      return this.construirResumenOmitido({
        ejecutadoEnUtc,
        origen,
        numeroTick,
        motivo: 'correo_desactivado',
        advertencias: estado.advertencias
      });
    }

    if (!estado.puedeDespachar) {
      return this.construirResumenOmitido({
        ejecutadoEnUtc,
        origen,
        numeroTick,
        motivo: estado.configurado
          ? 'correo_no_verificado'
          : 'configuracion_no_despachable',
        erroresConfiguracion: estado.errores,
        advertencias: estado.advertencias
      });
    }

    const configuracionCorreo =
      this.servicioCorreoPortal.obtenerConfiguracionCorreoActual();
    const loteMaximo = Math.max(
      1,
      Number.parseInt(String(configuracionCorreo.runtimeLoteMaximo || 1), 10) || 1
    );
    const correosProcesados = [];
    let totalDespachados = 0;
    let totalReintentables = 0;
    let totalFallosFinales = 0;
    let sinPendientes = false;

    try {
      for (let indice = 0; indice < loteMaximo; indice += 1) {
        const resultado = await (
          estado.autoridadSmtpNueva === true &&
          typeof this.servicioCorreoPortal
            .despacharSiguientePendienteConAutoridad === 'function'
            ? this.servicioCorreoPortal.despacharSiguientePendienteConAutoridad()
            : this.servicioCorreoPortal.despacharSiguientePendiente()
        );

        if (!resultado.correo) {
          sinPendientes = true;
          break;
        }

        correosProcesados.push({
          id: resultado.correo.id,
          estado: resultado.correo.estado,
          destinatarioEmail: resultado.correo.destinatarioEmail,
          asunto: resultado.correo.asunto,
          mensaje: resultado.mensaje || null,
          mensajeId: resultado.mensajeId || null,
          proximoIntentoEn: resultado.proximoIntentoEn || null
        });

        if (resultado.despachado) {
          totalDespachados += 1;
        } else if (resultado.reintentable) {
          totalReintentables += 1;
        } else {
          totalFallosFinales += 1;
        }
      }

      return {
        omitido: false,
        regimen: 'legacy',
        ejecutadoEnUtc,
        finalizadoEnUtc: new Date().toISOString(),
        origen,
        numeroTick,
        loteMaximo,
        totalIntentados:
          totalDespachados + totalReintentables + totalFallosFinales,
        totalDespachados,
        totalReintentables,
        totalFallosFinales,
        totalAmbiguos: 0,
        totalDescartados: 0,
        sinPendientes,
        correosProcesados,
        erroresConfiguracion: estado.errores,
        advertencias: estado.advertencias
      };
    } catch (error) {
      return {
        omitido: false,
        regimen: 'legacy',
        ejecutadoEnUtc,
        finalizadoEnUtc: new Date().toISOString(),
        origen,
        numeroTick,
        loteMaximo,
        totalIntentados:
          totalDespachados + totalReintentables + totalFallosFinales,
        totalDespachados,
        totalReintentables,
        totalFallosFinales,
        totalAmbiguos: 0,
        totalDescartados: 0,
        sinPendientes,
        correosProcesados,
        erroresConfiguracion: estado.errores,
        advertencias: estado.advertencias,
        error: {
          mensaje: String(error?.message || 'Error desconocido al despachar correo.')
        }
      };
    }
  }

  async despacharPendientesSql({ ejecutadoEnUtc, origen, numeroTick }) {
    if (!this.despachadorCorreoSql) {
      return this.construirResumenOmitido({
        ejecutadoEnUtc,
        origen,
        numeroTick,
        motivo: 'cola_sql_sin_despachador',
        regimen: 'sql@1'
      });
    }
    const configuracion = this.servicioCorreoPortal.obtenerConfiguracionCorreoActual();
    const loteMaximo = Math.max(1, Math.min(100,
      Number.parseInt(String(configuracion.runtimeLoteMaximo || 1), 10) || 1));
    const leaseMilisegundos = Math.min(86_400_000, Math.max(30_000,
      configuracion.smtpTimeoutConexionMs + configuracion.smtpTimeoutSaludoMs +
      configuracion.smtpTimeoutSocketMs + 10_000));
    const correosProcesados = [];
    let totalDespachados = 0;
    let totalReintentables = 0;
    let totalFallosFinales = 0;
    let totalAmbiguos = 0;
    let totalDescartados = 0;
    const metricasPorProcedencia = new Map();
    let sinPendientes = false;
    let reconciliacion = null;
    try {
      reconciliacion = await this.despachadorCorreoSql
        .reconciliarLeasesExpiradas({ limite: loteMaximo });
      for (let indice = 0; indice < loteMaximo; indice += 1) {
        const resultado = await this.despachadorCorreoSql.despacharSiguiente({
          leaseMilisegundos
        });
        if (resultado.motivo === 'sin_salidas_reclamables') {
          sinPendientes = true;
          break;
        }
        if (!resultado.salidaId) {
          break;
        }
        correosProcesados.push({
          id: resultado.salidaId || null,
          origenTipo: resultado.origenTipo || null,
          estado: resultado.estadoSalida || null,
          destinatarioEmail: null,
          asunto: null,
          codigo: resultado.codigo || resultado.motivo || null,
          mensaje: resultado.respuestaSaneada || null,
          mensajeId: null,
          proximoIntentoEn: null
        });
        acumularMetricaProcedencia(metricasPorProcedencia, resultado);
        if (resultado.estadoSalida === 'enviado') totalDespachados += 1;
        else if (resultado.estadoSalida === 'error_reintentable') {
          totalReintentables += 1;
        } else if (resultado.estadoSalida === 'resultado_ambiguo') {
          totalAmbiguos += 1;
        } else if (resultado.estadoSalida === 'error_final') {
          totalFallosFinales += 1;
        } else if (resultado.estadoSalida === 'descartada') {
          totalDescartados += 1;
        }
      }
      return {
        omitido: false,
        regimen: 'sql@1',
        ejecutadoEnUtc,
        finalizadoEnUtc: new Date().toISOString(),
        origen,
        numeroTick,
        loteMaximo,
        totalIntentados:
          totalDespachados + totalReintentables + totalFallosFinales +
            totalAmbiguos + totalDescartados,
        totalDespachados,
        totalReintentables,
        totalFallosFinales,
        totalAmbiguos,
        totalDescartados,
        porProcedencia: serializarMetricasProcedencia(metricasPorProcedencia),
        sinPendientes,
        correosProcesados,
        reconciliacion,
        erroresConfiguracion: [],
        advertencias: []
      };
    } catch (error) {
      return {
        omitido: false,
        regimen: 'sql@1',
        ejecutadoEnUtc,
        finalizadoEnUtc: new Date().toISOString(),
        origen,
        numeroTick,
        loteMaximo,
        totalIntentados:
          totalDespachados + totalReintentables + totalFallosFinales +
            totalAmbiguos + totalDescartados,
        totalDespachados,
        totalReintentables,
        totalFallosFinales,
        totalAmbiguos,
        totalDescartados,
        porProcedencia: serializarMetricasProcedencia(metricasPorProcedencia),
        sinPendientes,
        correosProcesados,
        reconciliacion,
        erroresConfiguracion: [],
        advertencias: [],
        error: { mensaje: String(error?.message || 'Error en la cola SQL de correo.') }
      };
    }
  }

  esColaSqlAutoritativa() {
    const estado = this.servicioConfiguracionPortal
      ?.obtenerEstadoDespliegueCorreoActual?.();
    return Number(estado?.cola_sql_autoritativa) === 1;
  }

  async obtenerEstadoDespachoLegacy() {
    const estadoDespliegue = this.servicioConfiguracionPortal
      ?.obtenerEstadoDespliegueCorreoActual?.();
    const smtpAutoritativo =
      Number(estadoDespliegue?.verificacion_smtp_autoritativa) === 1;
    if (!smtpAutoritativo ||
        typeof this.evaluadorAutoridadCorreoSql?.evaluarEnTransaccion !== 'function' ||
        typeof this.fronteraTransaccional?.ejecutar !== 'function') {
      return this.servicioCorreoPortal.obtenerEstadoConfiguracion();
    }
    const autoridad = await this.fronteraTransaccional.ejecutar((conexion) =>
      this.evaluadorAutoridadCorreoSql.evaluarEnTransaccion({ conexion }));
    return {
      autoridadSmtpNueva: true,
      activa: Boolean(autoridad.configuracion?.activo),
      configurado: autoridad.configurado,
      puedeDespachar: autoridad.puedeDespachar,
      errores: autoridad.errores,
      advertencias: autoridad.advertencias
    };
  }

  construirResumenOmitido({
    ejecutadoEnUtc,
    origen,
    numeroTick,
    motivo,
    erroresConfiguracion = [],
    advertencias = [],
    regimen = 'legacy'
  }) {
    return {
      omitido: true,
      regimen,
      ejecutadoEnUtc,
      finalizadoEnUtc: ejecutadoEnUtc,
      origen,
      numeroTick,
      motivo,
      loteMaximo: 0,
      totalIntentados: 0,
      totalDespachados: 0,
      totalReintentables: 0,
      totalFallosFinales: 0,
      totalAmbiguos: 0,
      totalDescartados: 0,
      porProcedencia: [],
      sinPendientes: false,
      correosProcesados: [],
      erroresConfiguracion,
      advertencias
    };
  }
}

function acumularMetricaProcedencia(metricas, resultado) {
  const origenTipo = String(resultado?.origenTipo || '').trim();
  if (!origenTipo) return;
  const actual = metricas.get(origenTipo) || {
    origenTipo,
    totalIntentados: 0,
    totalDespachados: 0,
    totalReintentables: 0,
    totalFallosFinales: 0,
    totalAmbiguos: 0,
    totalDescartados: 0
  };
  actual.totalIntentados += 1;
  if (resultado.estadoSalida === 'enviado') actual.totalDespachados += 1;
  else if (resultado.estadoSalida === 'error_reintentable') {
    actual.totalReintentables += 1;
  } else if (resultado.estadoSalida === 'error_final') {
    actual.totalFallosFinales += 1;
  } else if (resultado.estadoSalida === 'resultado_ambiguo') {
    actual.totalAmbiguos += 1;
  } else if (resultado.estadoSalida === 'descartada') {
    actual.totalDescartados += 1;
  }
  metricas.set(origenTipo, actual);
}

function serializarMetricasProcedencia(metricas) {
  return [...metricas.values()]
    .sort((a, b) => a.origenTipo.localeCompare(b.origenTipo))
    .map((entrada) => Object.freeze({ ...entrada }));
}

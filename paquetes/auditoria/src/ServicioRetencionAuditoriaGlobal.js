export class ServicioRetencionAuditoriaGlobal {
  constructor({
    servicioConfiguracionPortal,
    repositorioCoordinacion,
    servicioRetencionCadena,
    ahora = () => new Date().toISOString()
  } = {}) {
    if (!servicioConfiguracionPortal?.asegurarActualizada) {
      throw new Error('ServicioRetencionAuditoriaGlobal requiere configuración de portal.');
    }
    if (!repositorioCoordinacion?.ejecutarConBloqueoGlobal ||
        !repositorioCoordinacion?.listarClavesCadenas) {
      throw new Error('ServicioRetencionAuditoriaGlobal requiere coordinación de retención.');
    }
    if (!servicioRetencionCadena?.recortarPrefijo) {
      throw new Error('ServicioRetencionAuditoriaGlobal requiere retención por cadena.');
    }
    if (typeof ahora !== 'function') {
      throw new Error('ServicioRetencionAuditoriaGlobal requiere reloj inyectable.');
    }
    this.servicioConfiguracionPortal = servicioConfiguracionPortal;
    this.repositorioCoordinacion = repositorioCoordinacion;
    this.servicioRetencionCadena = servicioRetencionCadena;
    this.ahora = ahora;
    this.ultimaClaveDiariaEjecutada = null;
  }

  async ejecutarBootstrap(opciones = {}) {
    try {
      return await this.ejecutar({
        ...opciones,
        origen: 'bootstrap',
        propagarErrores: false
      });
    } catch (error) {
      return resumenErrorNoFatal({
        origen: 'bootstrap',
        fechaReferenciaUtc: opciones.fechaReferenciaUtc ?? this.ahora(),
        motivo: 'retencion_auditoria_error_bootstrap',
        error
      });
    }
  }

  async ejecutarTareaDiaria({ fechaReferenciaUtc = this.ahora(), ...opciones } = {}) {
    const claveDiaria = claveDiaUtc(fechaReferenciaUtc);
    if (this.ultimaClaveDiariaEjecutada === claveDiaria) {
      return Object.freeze({
        activa: true,
        omitida: true,
        motivo: 'retencion_global_ya_ejecutada_para_dia',
        claveDiaria,
        cadenasProcesadas: 0,
        recortesAplicados: 0,
        sinCambios: 0,
        errores: 0
      });
    }
    let resultado;
    try {
      resultado = await this.ejecutar({
        ...opciones,
        origen: 'tarea_diaria',
        fechaReferenciaUtc,
        propagarErrores: false
      });
    } catch (error) {
      resultado = resumenErrorNoFatal({
        origen: 'tarea_diaria',
        fechaReferenciaUtc,
        motivo: 'retencion_auditoria_error_tarea_diaria',
        error
      });
    }
    if (resultado.activa && !resultado.bloqueada && resultado.errores === 0) {
      this.ultimaClaveDiariaEjecutada = claveDiaria;
    }
    return Object.freeze({ ...resultado, claveDiaria });
  }

  async ejecutar({
    origen = 'manual',
    fechaReferenciaUtc = this.ahora(),
    presupuestoCadenas = 25,
    limiteEventosPorCadena = 500,
    timeoutBloqueoSegundos = 0,
    propagarErrores = false
  } = {}) {
    validarPresupuesto(presupuestoCadenas, 'presupuestoCadenas');
    validarPresupuesto(limiteEventosPorCadena, 'limiteEventosPorCadena');
    const configuracionPortal = await this.servicioConfiguracionPortal.asegurarActualizada();
    const dias = normalizarDiasRetencion(
      configuracionPortal.obtenerConfiguracionAuditoria()?.retencionDias
    );
    if (dias === null) {
      return resumenBase({
        activa: false,
        omitida: true,
        motivo: 'retencion_auditoria_desactivada',
        origen,
        diasRetencion: null,
        fechaReferenciaUtc
      });
    }

    const coordinado = await this.repositorioCoordinacion.ejecutarConBloqueoGlobal(
      { timeoutSegundos: timeoutBloqueoSegundos },
      () => this.#ejecutarBajoBloqueo({
        origen,
        fechaReferenciaUtc,
        dias,
        presupuestoCadenas,
        limiteEventosPorCadena,
        propagarErrores
      })
    );

    if (!coordinado.adquirido) {
      return resumenBase({
        activa: true,
        omitida: true,
        bloqueada: true,
        motivo: coordinado.motivo,
        origen,
        diasRetencion: dias,
        fechaReferenciaUtc
      });
    }

    return coordinado.resultado;
  }

  async #ejecutarBajoBloqueo({
    origen,
    fechaReferenciaUtc,
    dias,
    presupuestoCadenas,
    limiteEventosPorCadena,
    propagarErrores
  }) {
    const cadenas = await this.repositorioCoordinacion.listarClavesCadenas({
      limite: presupuestoCadenas
    });
    const resultado = resumenBase({
      activa: true,
      omitida: false,
      motivo: 'retencion_global_ejecutada',
      origen,
      diasRetencion: dias,
      fechaReferenciaUtc
    });
    const detalles = [];

    for (const { claveCadena } of cadenas) {
      try {
        const recorte = await this.servicioRetencionCadena.recortarPrefijo({
          claveCadena,
          dias,
          limiteEventos: limiteEventosPorCadena,
          efectivoEnUtc: fechaReferenciaUtc
        });
        resultado.cadenasProcesadas += 1;
        resultado.ultimaClaveCadena = claveCadena;
        if (recorte.estado === 'aplicado') {
          resultado.recortesAplicados += 1;
          detalles.push(Object.freeze({
            claveCadena,
            estado: recorte.estado,
            secuenciaHasta: recorte.secuenciaHasta,
            primeraSecuenciaConservada: recorte.primeraSecuenciaConservada
          }));
        } else {
          resultado.sinCambios += 1;
        }
      } catch (error) {
        resultado.errores += 1;
        detalles.push(Object.freeze({
          claveCadena,
          estado: 'error',
          mensaje: String(error?.message || error)
        }));
        if (propagarErrores) throw error;
      }
    }

    resultado.backlogPosible =
      cadenas.length === presupuestoCadenas ||
      resultado.recortesAplicados > 0;
    resultado.detalles = Object.freeze(detalles);
    return Object.freeze(resultado);
  }
}

function resumenErrorNoFatal({ origen, fechaReferenciaUtc, motivo, error }) {
  const resumen = resumenBase({
    activa: true,
    omitida: false,
    motivo,
    origen,
    diasRetencion: null,
    fechaReferenciaUtc
  });
  resumen.errores = 1;
  resumen.detalles = Object.freeze([
    Object.freeze({
      estado: 'error',
      mensaje: String(error?.message || error)
    })
  ]);
  return Object.freeze(resumen);
}

function resumenBase({
  activa,
  omitida,
  bloqueada = false,
  motivo,
  origen,
  diasRetencion,
  fechaReferenciaUtc
}) {
  return {
    activa,
    omitida,
    bloqueada,
    motivo,
    origen,
    diasRetencion,
    fechaReferenciaUtc,
    cadenasProcesadas: 0,
    recortesAplicados: 0,
    sinCambios: 0,
    errores: 0,
    ultimaClaveCadena: null,
    backlogPosible: false,
    detalles: Object.freeze([])
  };
}

function normalizarDiasRetencion(valor) {
  if (valor === null || valor === undefined || valor === '') return null;
  const numero = Number(valor);
  if (!Number.isInteger(numero) || numero < 1 || numero > 36500) return null;
  return numero;
}

function validarPresupuesto(valor, nombre) {
  if (!Number.isInteger(valor) || valor < 1 || valor > 5000) {
    throw new Error(`${nombre} debe estar entre 1 y 5000.`);
  }
}

function claveDiaUtc(fechaReferenciaUtc) {
  const fecha = new Date(fechaReferenciaUtc);
  if (Number.isNaN(fecha.getTime())) return new Date().toISOString().slice(0, 10);
  return fecha.toISOString().slice(0, 10);
}

export const __testablesServicioRetencionAuditoriaGlobal = Object.freeze({
  normalizarDiasRetencion,
  claveDiaUtc
});

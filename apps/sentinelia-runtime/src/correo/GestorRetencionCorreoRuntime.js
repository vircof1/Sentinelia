export class GestorRetencionCorreoRuntime {
  constructor({
    servicioRetencionCorreo,
    servicioConfiguracionPortal,
    repositorioArbolTriggerCorreo,
    ahora = () => new Date()
  } = {}) {
    exigirMetodo(servicioRetencionCorreo, 'listarCandidatos');
    exigirMetodo(servicioRetencionCorreo, 'purgarCandidato');
    exigirMetodo(servicioConfiguracionPortal, 'asegurarActualizada');
    exigirMetodo(repositorioArbolTriggerCorreo,
      'diagnosticarIntegridadEjecucionesAceptadas');
    if (typeof ahora !== 'function') {
      throw new Error('La retención runtime de correo requiere un reloj.');
    }
    this.servicioRetencion = servicioRetencionCorreo;
    this.servicioConfiguracion = servicioConfiguracionPortal;
    this.repositorioArbol = repositorioArbolTriggerCorreo;
    this.ahora = ahora;
    this.ultimaFechaEjecutada = null;
    this.ultimaEjecucion = null;
    this.ejecucionEnCurso = null;
  }

  ejecutarSiProcede({ fechaReferenciaUtc = this.ahora(), forzar = false } = {}) {
    if (this.ejecucionEnCurso) return this.ejecucionEnCurso;
    const tarea = this.ejecutarInterno({ fechaReferenciaUtc, forzar });
    const compartida = tarea.finally(() => {
      if (this.ejecucionEnCurso === compartida) this.ejecucionEnCurso = null;
    });
    this.ejecucionEnCurso = compartida;
    return this.ejecucionEnCurso;
  }

  async ejecutarInterno({ fechaReferenciaUtc, forzar }) {
    const fecha = fechaValida(fechaReferenciaUtc);
    const claveDiaria = fecha.toISOString().slice(0, 10);
    if (!forzar && this.ultimaFechaEjecutada === claveDiaria) {
      return resumenOmitido({
        motivo: 'retencion_ya_ejecutada_hoy',
        fechaReferenciaUtc: fecha.toISOString(),
        anterior: this.ultimaEjecucion
      });
    }

    const configuracion = await this.servicioConfiguracion.asegurarActualizada();
    const correo = configuracion.obtenerConfiguracionCorreo();
    const retencionDias = enteroEnRango(
      correo.retencionSalidasDias, 1, 3650, 'retencionSalidasDias'
    );
    const limite = enteroEnRango(
      correo.runtimeLoteMaximo, 1, 500, 'runtimeLoteMaximo'
    );
    const seleccion = await this.servicioRetencion.listarCandidatos({
      retencionDias,
      limite
    });
    const candidatos = [
      ...seleccion.ejecuciones,
      ...seleccion.pruebas,
      ...(seleccion.recuperaciones || []),
      ...(seleccion.reiniciosAdministrativos || [])
    ]
      .slice(0, limite);
    const metricas = {
      purgados: 0,
      ejecucionesPurgadas: 0,
      pruebasPurgadas: 0,
      recuperacionesPurgadas: 0,
      reiniciosAdministrativosPurgados: 0,
      yaPurgados: 0,
      protegidos: 0,
      ausentes: 0,
      errores: 0
    };
    const erroresPorCodigo = {};
    for (const candidato of candidatos) {
      try {
        const resultado = await this.servicioRetencion.purgarCandidato(
          candidato,
          { retencionDias }
        );
        acumularResultado(metricas, resultado);
      } catch (error) {
        metricas.errores += 1;
        const codigo = normalizarCodigoError(error);
        erroresPorCodigo[codigo] = (erroresPorCodigo[codigo] || 0) + 1;
      }
    }

    const [
      restante,
      diagnosticoCrudo,
      diagnosticoRecuperacion,
      diagnosticoReinicioAdministrativo
    ] = await Promise.all([
      this.servicioRetencion.listarCandidatos({ retencionDias, limite: 1 }),
      this.repositorioArbol.diagnosticarIntegridadEjecucionesAceptadas({
        limit: limite
      }),
      typeof this.servicioRetencion.diagnosticarIntegridadRecuperacionPassword ===
        'function'
        ? this.servicioRetencion.diagnosticarIntegridadRecuperacionPassword({ limite })
        : Promise.resolve({ ok: true, totalIncompatibles: 0, limite, salidas: [] }),
      typeof this.servicioRetencion
        .diagnosticarIntegridadReinicioPasswordAdministrativo === 'function'
        ? this.servicioRetencion
          .diagnosticarIntegridadReinicioPasswordAdministrativo({ limite })
        : Promise.resolve({ ok: true, totalIncompatibles: 0, limite, salidas: [] })
    ]);
    const diagnostico = resumirDiagnostico(
      diagnosticoCrudo,
      diagnosticoRecuperacion,
      diagnosticoReinicioAdministrativo
    );
    const backlogPosible = restante.ejecuciones.length > 0 ||
      restante.pruebas.length > 0 ||
      (restante.recuperaciones || []).length > 0 ||
      (restante.reiniciosAdministrativos || []).length > 0;
    const resumen = Object.freeze({
      activa: true,
      omitida: false,
      motivo: 'retencion_ejecutada',
      fechaReferenciaUtc: fecha.toISOString(),
      retencionDias,
      limite,
      candidatos: candidatos.length,
      ...metricas,
      erroresPorCodigo: Object.freeze(ordenarObjeto(erroresPorCodigo)),
      backlogPosible,
      diagnostico
    });
    this.ultimaFechaEjecutada = claveDiaria;
    this.ultimaEjecucion = resumen;
    return resumen;
  }
}

function acumularResultado(metricas, resultado) {
  if (resultado?.estado === 'purgado') {
    metricas.purgados += 1;
    if (resultado.tipo === 'ejecucion') metricas.ejecucionesPurgadas += 1;
    if (resultado.tipo === 'prueba') metricas.pruebasPurgadas += 1;
    if (resultado.tipo === 'recuperacion_password') {
      metricas.recuperacionesPurgadas += 1;
    }
    if (resultado.tipo === 'reinicio_password_administrativo') {
      metricas.reiniciosAdministrativosPurgados += 1;
    }
    return;
  }
  if (resultado?.estado === 'ya_purgado') metricas.yaPurgados += 1;
  else if (resultado?.estado === 'protegido') metricas.protegidos += 1;
  else if (resultado?.estado === 'ausente') metricas.ausentes += 1;
  else metricas.errores += 1;
}

function resumirDiagnostico(diagnostico, recuperacion, reinicioAdministrativo) {
  const porCodigo = {};
  for (const item of diagnostico?.ejecuciones || []) {
    const codigo = String(item.codigoIntegridad || 'desconocido');
    porCodigo[codigo] = (porCodigo[codigo] || 0) + 1;
  }
  return Object.freeze({
    ok: diagnostico?.ok === true && recuperacion?.ok === true &&
      reinicioAdministrativo?.ok === true,
    totalIncompatibles: Number(diagnostico?.totalIncompatibles || 0) +
      Number(recuperacion?.totalIncompatibles || 0) +
      Number(reinicioAdministrativo?.totalIncompatibles || 0),
    truncado: Number(diagnostico?.totalIncompatibles || 0) >=
      Number(diagnostico?.limite || 0) ||
      Number(recuperacion?.totalIncompatibles || 0) >=
        Number(recuperacion?.limite || 0) ||
      Number(reinicioAdministrativo?.totalIncompatibles || 0) >=
        Number(reinicioAdministrativo?.limite || 0),
    porCodigo: Object.freeze(ordenarObjeto({
      ...porCodigo,
      ...(Number(recuperacion?.totalIncompatibles || 0) > 0
        ? { recuperacion_password_incompatible:
          Number(recuperacion.totalIncompatibles) }
        : {}),
      ...(Number(reinicioAdministrativo?.totalIncompatibles || 0) > 0
        ? { reinicio_password_administrativo_incompatible:
          Number(reinicioAdministrativo.totalIncompatibles) }
        : {})
    }))
  });
}

function resumenOmitido({ motivo, fechaReferenciaUtc, anterior }) {
  return Object.freeze({
    activa: true,
    omitida: true,
    motivo,
    fechaReferenciaUtc,
    retencionDias: anterior?.retencionDias ?? null,
    limite: anterior?.limite ?? null,
    candidatos: 0,
    purgados: 0,
    ejecucionesPurgadas: 0,
    pruebasPurgadas: 0,
    recuperacionesPurgadas: 0,
    reiniciosAdministrativosPurgados: 0,
    yaPurgados: 0,
    protegidos: 0,
    ausentes: 0,
    errores: 0,
    erroresPorCodigo: Object.freeze({}),
    backlogPosible: anterior?.backlogPosible === true,
    diagnostico: anterior?.diagnostico || Object.freeze({
      ok: true,
      totalIncompatibles: 0,
      truncado: false,
      porCodigo: Object.freeze({})
    })
  });
}

function fechaValida(valor) {
  const fecha = valor instanceof Date ? new Date(valor.getTime()) : new Date(valor);
  if (Number.isNaN(fecha.getTime())) {
    throw new Error('La fecha de referencia de retención de correo no es válida.');
  }
  return fecha;
}

function enteroEnRango(valor, minimo, maximo, campo) {
  const numero = Number(valor);
  if (!Number.isSafeInteger(numero) || numero < minimo || numero > maximo) {
    throw new Error(`${campo} está fuera del rango de retención de correo.`);
  }
  return numero;
}

function normalizarCodigoError(error) {
  const codigo = String(error?.codigo || error?.code || 'retencion_correo_fallida')
    .toLowerCase();
  return /^[a-z0-9_]{1,120}$/u.test(codigo)
    ? codigo
    : 'retencion_correo_fallida';
}

function ordenarObjeto(objeto) {
  return Object.fromEntries(
    Object.entries(objeto).sort(([a], [b]) => a.localeCompare(b))
  );
}

function exigirMetodo(objeto, metodo) {
  if (typeof objeto?.[metodo] !== 'function') {
    throw new Error(`La retención runtime de correo requiere ${metodo}().`);
  }
}

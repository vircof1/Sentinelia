import { bytesAUuidV7Auditoria }
  from '../../../../paquetes/auditoria/src/UuidV7Auditoria.js';
import { normalizarMarcaUtc }
  from '../../../../paquetes/utilidades/src/fechas/normalizarMarcaUtc.js';

export class ServicioLecturaTriggerCorreoPortal {
  constructor({
    repositorio,
    fronteraTransaccional,
    servicioAutorizacion
  } = {}) {
    if (typeof repositorio?.leerEjecucionEnTransaccion !== 'function' ||
        typeof fronteraTransaccional?.ejecutar !== 'function' ||
        typeof servicioAutorizacion?.puedeVerTriggers !== 'function' ||
        typeof servicioAutorizacion?.puedeVerMonitores !== 'function') {
      throw new Error('La lectura especializada de correo requiere todos sus puertos.');
    }
    this.repositorio = repositorio;
    this.frontera = fronteraTransaccional;
    this.autorizacion = servicioAutorizacion;
  }

  crearApiPrivadaVerificador() {
    return Object.freeze({
      listar: this.listar.bind(this),
      listarPorTrigger: this.listarPorTrigger.bind(this),
      leerDetalle: this.leerDetalle.bind(this)
    });
  }

  async listarPorTrigger(contextoUsuarioActual, triggerId, { limite = 20 } = {}) {
    return this.frontera.ejecutar(async (conexion) => {
      const ids = await this.repositorio.listarIdsPorTriggerEnTransaccion(
        triggerId,
        { conexion, limite }
      );
      const elementos = [];
      for (const ejecucionId of ids) {
        const lectura = await this.repositorio.leerEjecucionEnTransaccion(
          ejecucionId,
          { conexion }
        );
        const proyectada = lectura && proyectarLectura({
          lectura,
          contexto: contextoUsuarioActual,
          autorizacion: this.autorizacion,
          detalle: false
        });
        if (proyectada) elementos.push(proyectada);
      }
      return congelar({ total: elementos.length, elementos });
    });
  }

  async listar(contextoUsuarioActual, { ejecucionIds = [] } = {}) {
    const ids = normalizarIds(ejecucionIds, 100);
    return this.frontera.ejecutar(async (conexion) => {
      const elementos = [];
      for (const ejecucionId of ids) {
        const lectura = await this.repositorio.leerEjecucionEnTransaccion(
          ejecucionId,
          { conexion }
        );
        if (!lectura) continue;
        const proyectada = proyectarLectura({
          lectura,
          contexto: contextoUsuarioActual,
          autorizacion: this.autorizacion,
          detalle: false
        });
        if (proyectada) elementos.push(proyectada);
      }
      return congelar({ total: elementos.length, elementos });
    });
  }

  async leerDetalle(contextoUsuarioActual, ejecucionId) {
    return this.frontera.ejecutar(async (conexion) => {
      const lectura = await this.repositorio.leerEjecucionEnTransaccion(
        ejecucionId,
        { conexion }
      );
      if (!lectura) lanzarNoDisponible();
      const proyectada = proyectarLectura({
        lectura,
        contexto: contextoUsuarioActual,
        autorizacion: this.autorizacion,
        detalle: true
      });
      if (!proyectada) lanzarNoDisponible();
      return proyectada;
    });
  }
}

function proyectarLectura({ lectura, contexto, autorizacion, detalle }) {
  const { cabecera, resultados, salidas, intentos } = lectura;
  const scopeTrigger = scopeAutoritativo(cabecera, 'trigger');
  const scopeMonitor = scopeAutoritativo(cabecera, 'monitor');
  const triggerVisible = autorizacion.puedeVerTriggers(contexto) &&
    alcanza(contexto, scopeTrigger);
  const monitorVisible = autorizacion.puedeVerMonitores(contexto) &&
    alcanza(contexto, scopeMonitor);
  if (!triggerVisible && !monitorVisible) return null;

  const base = {
    ejecucionId: String(cabecera.ejecucion_id),
    eventoDisparo: cabecera.evento_disparo,
    estadoEjecucion: cabecera.estado_ejecucion,
    codigoResultado: cabecera.codigo_resultado,
    mensajeResultado: cabecera.mensaje_resultado,
    iniciadoEnUtc: normalizarMarcaUtc(cabecera.iniciado_en_utc),
    finalizadoEnUtc: normalizarMarcaUtc(cabecera.finalizado_en_utc),
    trigger: triggerVisible
      ? {
          visible: true,
          id: String(cabecera.trigger_vivo_id ||
            cabecera.trigger_id_fotografia || cabecera.ejecucion_trigger_id),
          nombre: cabecera.trigger_vivo_nombre || cabecera.trigger_nombre,
          scope: scopeTrigger,
          existe: cabecera.trigger_vivo_id != null
        }
      : { visible: false },
    monitor: monitorVisible
      ? {
          visible: true,
          id: String(cabecera.monitor_vivo_id ||
            cabecera.monitor_id_fotografia || cabecera.ejecucion_monitor_id),
          nombre: cabecera.monitor_vivo_nombre ||
            cabecera.fotografia_nombre_monitor || cabecera.monitor_nombre,
          tipo: cabecera.monitor_vivo_tipo || cabecera.tipo_monitor || null,
          scope: scopeMonitor,
          existe: cabecera.monitor_vivo_id != null
        }
      : { visible: false }
  };
  if (!triggerVisible) return congelar({ ...base, correo: null });

  const resultadosVisibles = [];
  const resultadosRestringidos = [];
  const salidasVisiblesIds = new Set();
  for (const resultado of resultados) {
    const visible = resultado.tipo === 'manual' ||
      (resultado.usuario_vivo_id != null &&
        alcanza(contexto, scopeDesdeFila(resultado, 'usuario_vivo')));
    if (!visible) {
      resultadosRestringidos.push(resultado);
      continue;
    }
    const proyectado = proyectarResultadoVisible(resultado);
    resultadosVisibles.push(proyectado);
    if (proyectado.salidaId) salidasVisiblesIds.add(proyectado.salidaId);
  }
  const resumenResultados = resumirPorCodigo(resultados);
  const resumenSalidas = resumirPorCampo(salidas, 'estado');
  const correo = {
    notificacionAceptada: cabecera.notificacion_id != null,
    resumen: {
      totalResultados: resultados.length,
      totalProcedenciasVisibles: resultadosVisibles.length,
      totalProcedenciasRestringidas: resultadosRestringidos.length,
      resultadosPorCodigo: resumenResultados,
      totalSalidas: salidas.length,
      salidasPorEstado: resumenSalidas
    }
  };
  if (!detalle) return congelar({ ...base, correo });

  const intentosPorSalida = agruparIntentos(intentos);
  const salidasVisibles = salidas
    .filter((salida) => salidasVisiblesIds.has(String(salida.id)))
    .map((salida) => proyectarSalidaVisible(
      salida,
      intentosPorSalida.get(String(salida.id)) || [],
      { monitorVisible }
    ));
  const salidasRestringidas = salidas.filter(
    (salida) => !salidasVisiblesIds.has(String(salida.id))
  );
  return congelar({
    ...base,
    correo: {
      ...correo,
      mensaje: cabecera.notificacion_id == null
        ? null
        : {
            version: Number(cabecera.definicion_mensaje_version),
            asuntoPlantilla: cabecera.asunto_plantilla,
            textoIntroduccion: cabecera.texto_introduccion,
            textoCierre: cabecera.texto_cierre,
            renderizadorVersion: cabecera.renderizador_version,
            asuntoMaterializado: monitorVisible ? cabecera.asunto : null,
            renderizadoEnUtc: normalizarMarcaUtc(cabecera.renderizado_en_utc),
            aceptadaEnUtc: normalizarMarcaUtc(cabecera.aceptada_en_utc)
          },
      causa: monitorVisible ? proyectarCausa(cabecera) : { visible: false },
      procedencias: resultadosVisibles,
      procedenciasRestringidasResumen: {
        total: resultadosRestringidos.length,
        porCodigo: resumirPorCodigo(resultadosRestringidos)
      },
      salidas: salidasVisibles,
      salidasRestringidasResumen: {
        total: salidasRestringidas.length,
        porEstado: resumirPorCampo(salidasRestringidas, 'estado')
      }
    }
  });
}

function proyectarResultadoVisible(resultado) {
  const base = {
    relacionId: resultado.relacion_destinatario_id == null
      ? null
      : String(resultado.relacion_destinatario_id),
    tipo: resultado.tipo,
    restringida: false,
    estadoObservado: resultado.estado_observado,
    codigoInicial: resultado.codigo_inicial,
    salidaId: resultado.salida_correo_id == null
      ? null
      : String(resultado.salida_correo_id)
  };
  if (resultado.tipo === 'manual') {
    return {
      ...base,
      email: resultado.email_manual,
      emailCanonico: resultado.email_manual_canonico
    };
  }
  return {
    ...base,
    usuario: {
      id: String(resultado.usuario_vivo_id),
      nombre: resultado.usuario_vivo_nombre_mostrar ||
        resultado.usuario_vivo_nombre_completo || resultado.usuario_vivo_cuenta,
      email: resultado.usuario_vivo_email,
      activo: Boolean(resultado.usuario_vivo_activo),
      emailValidado: Boolean(resultado.usuario_vivo_email_validado),
      scope: scopeDesdeFila(resultado, 'usuario_vivo')
    }
  };
}

function proyectarSalidaVisible(salida, intentos, { monitorVisible }) {
  return {
    salidaId: String(salida.id),
    email: salida.destinatario_email,
    estado: salida.estado,
    intentosTotales: Number(salida.intentos),
    smtpMessageId: salida.smtp_message_id,
    asunto: monitorVisible ? salida.asunto : null,
    codigoResultado: salida.codigo_resultado,
    respuestaSaneada: salida.respuesta_saneada,
    errorUltimo: salida.error_ultimo,
    creadaEnUtc: normalizarMarcaUtc(salida.fecha_creacion),
    ultimoIntentoEnUtc: normalizarMarcaUtc(salida.fecha_ultimo_intento),
    enviadaEnUtc: normalizarMarcaUtc(salida.fecha_envio),
    terminalEnUtc: normalizarMarcaUtc(salida.fecha_terminal_utc),
    intentos: intentos.map((intento) => ({
      numero: Number(intento.numero),
      versionConfiguracion: String(intento.configuracion_version),
      smtpMessageId: intento.smtp_message_id,
      estado: intento.estado,
      iniciadoEnUtc: normalizarMarcaUtc(intento.iniciado_en_utc),
      finalizadoEnUtc: normalizarMarcaUtc(intento.finalizado_en_utc),
      clasificacion: intento.clasificacion,
      codigo: intento.codigo,
      respuestaSaneada: intento.respuesta_saneada
    }))
  };
}

function proyectarCausa(cabecera) {
  return {
    visible: true,
    alertaAuditoriaId: cabecera.alerta_auditoria_id
      ? bytesAUuidV7Auditoria(cabecera.alerta_auditoria_id, 'alertaAuditoriaId')
      : null,
    nombreMonitor: cabecera.fotografia_nombre_monitor,
    tipoMonitor: cabecera.tipo_monitor,
    estadoMonitor: cabecera.estado_monitor,
    origenCausal: cabecera.origen_causal,
    fechaOcurrenciaUtc: normalizarMarcaUtc(cabecera.fecha_ocurrencia_utc),
    validoDesdeUtc: normalizarMarcaUtc(cabecera.valido_desde_utc),
    codigoResultado: cabecera.causa_codigo_resultado,
    mensajeResultado: cabecera.causa_mensaje_resultado,
    contextoHumano: {
      descripcionFallo: cabecera.descripcion_fallo,
      posibleSolucion: cabecera.posible_solucion
    },
    referencias: {
      estadoUrl: cabecera.referencia_estado_url,
      historicoUrl: cabecera.referencia_historico_url
    }
  };
}

function scopeAutoritativo(fila, tipo) {
  if (fila[`${tipo}_vivo_id`] != null) return scopeDesdeFila(fila, `${tipo}_vivo`);
  if (fila.notificacion_id != null) return scopeDesdeFila(fila, `scope_${tipo}`);
  return scopeDesdeFila(fila, tipo);
}

function scopeDesdeFila(fila, prefijo) {
  const tenantId = idOpcional(fila[`${prefijo}_tenant_id`]);
  const empresaId = idOpcional(fila[`${prefijo}_empresa_id`]);
  const sitioId = idOpcional(fila[`${prefijo}_sitio_id`]);
  return {
    nivel: sitioId ? 'sitio' : empresaId ? 'empresa' : tenantId ? 'tenant' : 'portal',
    tenantId,
    empresaId,
    sitioId
  };
}

function alcanza(contexto, scope) {
  if (!scope) return false;
  if (contexto?.nivelScope === 'portal') return true;
  if (contexto?.nivelScope === 'tenant') {
    return scope.tenantId !== null && scope.tenantId === idOpcional(contexto.tenantId);
  }
  if (contexto?.nivelScope === 'empresa') {
    return scope.tenantId === idOpcional(contexto.tenantId) &&
      scope.empresaId !== null && scope.empresaId === idOpcional(contexto.empresaId);
  }
  if (contexto?.nivelScope === 'sitio') {
    return scope.tenantId === idOpcional(contexto.tenantId) &&
      scope.empresaId === idOpcional(contexto.empresaId) &&
      scope.sitioId !== null && scope.sitioId === idOpcional(contexto.sitioId);
  }
  return false;
}

function agruparIntentos(intentos) {
  const mapa = new Map();
  for (const intento of intentos) {
    const salidaId = String(intento.salida_correo_id);
    if (!mapa.has(salidaId)) mapa.set(salidaId, []);
    mapa.get(salidaId).push(intento);
  }
  return mapa;
}

function resumirPorCodigo(resultados) {
  return resumirPorCampo(resultados, 'codigo_inicial');
}

function resumirPorCampo(filas, campo) {
  const resumen = {};
  for (const fila of filas) {
    const clave = String(fila[campo] || 'sin_codigo');
    resumen[clave] = (resumen[clave] || 0) + 1;
  }
  return resumen;
}

function normalizarIds(valores, limite) {
  if (!Array.isArray(valores)) throw new Error('Las ejecuciones deben ser una lista.');
  return [...new Set(valores.map(Number).filter((id) =>
    Number.isSafeInteger(id) && id > 0))].slice(0, limite);
}

function idOpcional(valor) {
  return valor == null ? null : String(valor);
}

function lanzarNoDisponible() {
  throw Object.assign(
    new Error('La ejecución no existe o queda fuera de tu alcance.'),
    { codigo: 'ejecucion_trigger_correo_no_disponible', statusCode: 404 }
  );
}

function congelar(valor) {
  if (!valor || typeof valor !== 'object' || Object.isFrozen(valor)) return valor;
  for (const hijo of Object.values(valor)) congelar(hijo);
  return Object.freeze(valor);
}

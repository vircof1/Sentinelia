import { createHash, randomBytes } from 'node:crypto';

import {
  CODIGOS_RESULTADO_ACEPTACION_TRIGGER_CORREO,
  CODIGOS_RESULTADO_DESTINATARIO_TRIGGER_CORREO,
  ESTADOS_CAPACIDAD_DESUSCRIPCION_TRIGGER_CORREO,
  PERFIL_CAPACIDAD_DESUSCRIPCION_TRIGGER_CORREO,
  PERFIL_INTENCION_TRIGGER_CORREO,
  PERFIL_RESULTADO_ACEPTACION_TRIGGER_CORREO,
  PERFIL_RESULTADO_DESTINATARIO_TRIGGER_CORREO,
  PERFIL_SALIDA_TRIGGER_CORREO,
  crearIntencionNotificacionTriggerCorreo,
  crearResultadoAceptacionTriggerCorreo,
  crearResultadoDestinatarioTriggerCorreo,
  crearSalidaInicialTriggerCorreo
} from './ContratoTriggerCorreo.js';
import { prepararDesuscripcionPrivadaTriggerCorreo }
  from './PreparadorDesuscripcionTriggerCorreo.js';
import { materializarMensajeCausalTriggerCorreo }
  from './RenderizadorTriggerCorreo.js';

const ESTADOS_TERMINALES = new Set(['ok', 'error']);

export class ServicioAceptacionTriggerCorreo {
  tipoTrigger = 'correo';

  constructor({
    servicioFotografiaAdmision,
    repositorioEjecucionesTrigger,
    repositorioArbolTriggerCorreo,
    repositorioColaCorreo,
    reloj = () => new Date(),
    fuenteEntropia = () => randomBytes(32)
  } = {}) {
    exigirMetodo(servicioFotografiaAdmision, 'fotografiarEnTransaccion');
    exigirMetodo(repositorioEjecucionesTrigger, 'buscarPorClaveIdempotencia');
    exigirMetodo(repositorioEjecucionesTrigger, 'crearIdempotente');
    exigirMetodo(repositorioEjecucionesTrigger, 'finalizarReclamada');
    exigirMetodo(repositorioArbolTriggerCorreo, 'crearNotificacionEnTransaccion');
    exigirMetodo(repositorioArbolTriggerCorreo, 'crearResultadoEnTransaccion');
    exigirMetodo(repositorioArbolTriggerCorreo, 'crearCapacidadEnTransaccion');
    exigirMetodo(repositorioArbolTriggerCorreo, 'buscarArbolPorEjecucionEnTransaccion');
    exigirMetodo(repositorioColaCorreo, 'crearSalidaTriggerEnTransaccion');
    if (typeof reloj !== 'function' || typeof fuenteEntropia !== 'function') {
      throw new Error('La aceptación de correo requiere reloj y entropía.');
    }
    this.servicioFotografiaAdmision = servicioFotografiaAdmision;
    this.repositorioEjecuciones = repositorioEjecucionesTrigger;
    this.repositorioArbol = repositorioArbolTriggerCorreo;
    this.repositorioCola = repositorioColaCorreo;
    this.reloj = reloj;
    this.fuenteEntropia = fuenteEntropia;
  }

  async aceptarEnTransaccion({ planDisparo, conexion } = {}) {
    exigirPlan(planDisparo);
    exigirConexion(conexion);
    const claveIdempotencia = construirClaveIdempotenciaPlanTriggerCorreo(
      planDisparo
    );
    const existente = await this.repositorioEjecuciones.buscarPorClaveIdempotencia(
      claveIdempotencia,
      { conexion, bloquear: false }
    );
    if (existente) return this.recuperarTerminal(existente, conexion);

    const decision = await this.servicioFotografiaAdmision.fotografiarEnTransaccion({
      planDisparo,
      conexion
    });
    const planFotografiado = decision.planDisparo || planDisparo;
    const iniciadoEnUtc = fechaCanonica(this.reloj());
    const creacion = await this.repositorioEjecuciones.crearIdempotente(
      construirEjecucion({
        planDisparo: planFotografiado,
        claveIdempotencia,
        iniciadoEnUtc
      }),
      { conexion }
    );
    if (!creacion.creada) {
      return this.recuperarTerminal(creacion.ejecucion, conexion);
    }
    const ejecucion = creacion.ejecucion;

    if (!decision.aceptada) {
      return this.consolidarRechazo({
        decision,
        ejecucion,
        claveIdempotencia,
        finalizadoEnUtc: fechaCanonica(this.reloj()),
        conexion
      });
    }
    return this.consolidarAceptacion({
      decision,
      ejecucion,
      claveIdempotencia,
      conexion
    });
  }

  async consolidarRechazo({
    decision,
    ejecucion,
    claveIdempotencia,
    finalizadoEnUtc,
    conexion
  }) {
    const resultados = decision.codigoResultado ===
        CODIGOS_RESULTADO_ACEPTACION_TRIGGER_CORREO.SIN_DESTINATARIOS_ADMITIDOS
      ? await this.persistirResultados({
          ejecucionId: String(ejecucion.id),
          notificacionId: null,
          audiencia: decision.audiencia,
          salidasPorBuzon: new Map(),
          claveIdempotencia,
          conexion
        })
      : [];
    const resultado = crearResultadoAceptacionTriggerCorreo({
      perfil: PERFIL_RESULTADO_ACEPTACION_TRIGGER_CORREO,
      version: 1,
      ejecucionTriggerId: String(ejecucion.id),
      estadoEjecucion: 'error',
      codigoResultado: decision.codigoResultado,
      notificacionAceptada: null,
      resultadosDestinatarios: resultados,
      finalizadoEnUtc
    });
    const cierre = await this.repositorioEjecuciones.finalizarReclamada({
      idEjecucion: ejecucion.id,
      estadoEjecucion: 'error',
      codigoResultado: resultado.codigoResultado,
      mensajeResultado: mensajeResultado(decision),
      payloadRespuesta: null,
      payloadError: {
        codigo: resultado.codigoResultado,
        detalle: decision.detalleCodigo || null,
        totalResultadosDestinatarios: resultados.length
      },
      finalizadoEnUtc
    }, { conexion });
    exigirCierrePropio(cierre);
    return congelarResultado(resultado, cierre.ejecucion, {
      creada: true,
      recuperada: false
    });
  }

  async consolidarAceptacion({
    decision,
    ejecucion,
    claveIdempotencia,
    conexion
  }) {
    const renderizadoEnUtc = fechaCanonica(this.reloj());
    const material = materializarMensajeCausalTriggerCorreo({
      definicionMensaje: decision.definicionMensaje,
      planDisparo: decision.planDisparo,
      ejecucionTriggerId: String(ejecucion.id),
      claveIdempotencia,
      origenPublico: decision.origenPublico,
      nombrePortal: decision.nombrePortal,
      renderizadoEnUtc
    });
    const aceptadaEnUtc = fechaCanonica(this.reloj());
    const notificacion = await this.repositorioArbol.crearNotificacionEnTransaccion({
      revisionDeclaracion: String(decision.trigger.revisionDeclaracion),
      ejecucionTriggerId: String(ejecucion.id),
      claveIdempotencia,
      ...material,
      aceptadaEnUtc
    }, { conexion });
    const salidas = [];
    const capacidades = [];
    const salidasPorBuzon = new Map();
    for (const destino of decision.audiencia.destinos) {
      const claveBuzonSha256 = hash(destino.emailCanonico);
      detectarColisionBuzon(salidasPorBuzon, claveBuzonSha256,
        destino.emailCanonico);
      const desuscripcion = prepararDesuscripcionPrivadaTriggerCorreo({
        triggerId: String(decision.trigger.id),
        ttlDias: decision.ttlDesuscripcionDias,
        origenPublico: decision.origenPublico,
        cuerpoBaseTexto: material.mensajeMaterializado.cuerpoBaseTexto,
        fuenteEntropia: this.fuenteEntropia
      });
      const salidaSql = await this.repositorioCola.crearSalidaTriggerEnTransaccion({
        notificacionId: String(notificacion.id),
        ejecucionTriggerId: String(ejecucion.id),
        buzonCanonico: destino.emailCanonico,
        normalizacionBuzonVersion: destino.versionNormalizacion,
        claveBuzonSha256,
        smtpMessageId: construirMessageId(claveIdempotencia, destino.emailCanonico),
        asunto: material.mensajeMaterializado.asunto,
        cuerpoPrivadoTexto: desuscripcion.cuerpoPrivadoTexto,
        creadaEnUtc: aceptadaEnUtc
      }, { conexion });
      const salida = crearSalidaInicialTriggerCorreo({
        perfil: PERFIL_SALIDA_TRIGGER_CORREO,
        version: 1,
        salidaId: String(salidaSql.id),
        notificacionId: String(notificacion.id),
        ejecucionTriggerId: String(ejecucion.id),
        buzonCanonico: destino.emailCanonico,
        normalizacionBuzonVersion: destino.versionNormalizacion,
        claveBuzonSha256,
        smtpMessageId: salidaSql.smtpMessageId,
        asunto: salidaSql.asunto,
        cuerpoPrivadoTexto: salidaSql.cuerpoTexto,
        estado: salidaSql.estado,
        intentos: Number(salidaSql.intentos),
        creadaEnUtc: fechaCanonica(salidaSql.fechaCreacion)
      });
      const capacidad = {
        perfil: PERFIL_CAPACIDAD_DESUSCRIPCION_TRIGGER_CORREO,
        version: 1,
        salidaId: salida.salidaId,
        triggerId: String(decision.trigger.id),
        tokenHashSha256: desuscripcion.tokenHashSha256,
        ttlDias: desuscripcion.ttlDias,
        estado: ESTADOS_CAPACIDAD_DESUSCRIPCION_TRIGGER_CORREO.PREPARADA,
        emitidaEnUtc: null,
        expiraEnUtc: null
      };
      await this.repositorioArbol.crearCapacidadEnTransaccion(capacidad, {
        conexion
      });
      salidas.push(salida);
      capacidades.push(capacidad);
      salidasPorBuzon.set(claveBuzonSha256, Object.freeze({
        emailCanonico: destino.emailCanonico,
        salida
      }));
    }
    const resultados = await this.persistirResultados({
      ejecucionId: String(ejecucion.id),
      notificacionId: String(notificacion.id),
      audiencia: decision.audiencia,
      salidasPorBuzon,
      claveIdempotencia,
      conexion
    });
    const intencion = crearIntencionNotificacionTriggerCorreo({
      perfil: PERFIL_INTENCION_TRIGGER_CORREO,
      version: 1,
      notificacionId: String(notificacion.id),
      ejecucionTriggerId: String(ejecucion.id),
      claveIdempotencia,
      ...material,
      resultadosDestinatarios: resultados,
      salidas,
      capacidades,
      aceptadaEnUtc
    });
    const finalizadoEnUtc = fechaCanonica(this.reloj());
    const resultado = crearResultadoAceptacionTriggerCorreo({
      perfil: PERFIL_RESULTADO_ACEPTACION_TRIGGER_CORREO,
      version: 1,
      ejecucionTriggerId: String(ejecucion.id),
      estadoEjecucion: 'ok',
      codigoResultado: decision.codigoResultado,
      notificacionAceptada: intencion,
      resultadosDestinatarios: resultados,
      finalizadoEnUtc
    });
    const cierre = await this.repositorioEjecuciones.finalizarReclamada({
      idEjecucion: ejecucion.id,
      estadoEjecucion: 'ok',
      codigoResultado: resultado.codigoResultado,
      mensajeResultado: mensajeResultado(decision),
      payloadRespuesta: {
        detalle_correo_estado: 'conservado',
        notificacionId: String(notificacion.id),
        totalResultadosDestinatarios: resultados.length,
        totalSalidas: salidas.length
      },
      payloadError: null,
      finalizadoEnUtc
    }, { conexion });
    exigirCierrePropio(cierre);
    return congelarResultado(resultado, cierre.ejecucion, {
      creada: true,
      recuperada: false
    });
  }

  async persistirResultados({
    ejecucionId,
    notificacionId,
    audiencia,
    salidasPorBuzon,
    claveIdempotencia,
    conexion
  }) {
    const resultados = [];
    for (const procedencia of audiencia?.procedencias || []) {
      if (procedencia.estado !== 'activa') continue;
      const claveBuzonSha256 = procedencia.entregable
        ? hash(procedencia.emailCanonico)
        : null;
      const salida = claveBuzonSha256 === null
        ? null
        : salidasPorBuzon.get(claveBuzonSha256)?.salida || null;
      if (procedencia.entregable && !salida) {
        throw new Error('Una procedencia aceptada no dispone de salida física.');
      }
      const resultado = crearResultadoDestinatarioTriggerCorreo({
        perfil: PERFIL_RESULTADO_DESTINATARIO_TRIGGER_CORREO,
        version: 1,
        claveProcedencia: hash(
          `${claveIdempotencia}:procedencia:${procedencia.relacionId}`
        ),
        relacionDestinatarioId: procedencia.relacionId,
        tipo: procedencia.tipo,
        usuarioId: procedencia.usuarioId,
        emailManualPresentacion: procedencia.tipo === 'manual'
          ? procedencia.emailPresentacion
          : null,
        emailManualCanonico: procedencia.tipo === 'manual'
          ? procedencia.emailCanonico
          : null,
        normalizacionBuzonVersion: procedencia.versionNormalizacion,
        estadoObservado: 'activa',
        emailResueltoCanonico: procedencia.entregable
          ? procedencia.emailCanonico
          : null,
        claveBuzonSha256,
        codigoInicial: procedencia.codigo,
        salidaId: salida?.salidaId || null
      });
      await this.repositorioArbol.crearResultadoEnTransaccion({
        ejecucionTriggerId: ejecucionId,
        notificacionId,
        resultadoDestinatario: resultado
      }, { conexion });
      resultados.push(resultado);
    }
    return resultados;
  }

  async recuperarTerminal(ejecucion, conexion) {
    if (!ESTADOS_TERMINALES.has(ejecucion?.estadoEjecucion)) {
      throw Object.assign(
        new Error('Una ejecución atómica de correo quedó durablemente no terminal.'),
        { codigo: 'ejecucion_trigger_correo_no_terminal' }
      );
    }
    const arbol = await this.repositorioArbol.buscarArbolPorEjecucionEnTransaccion({
      ejecucionTriggerId: String(ejecucion.id),
      bloquear: true
    }, { conexion });
    return Object.freeze({
      creada: false,
      recuperada: true,
      ejecucion: ejecucion.serializarResumen?.() || ejecucion,
      arbol: arbol.serializarPrivado?.() || arbol
    });
  }
}

export function construirClaveIdempotenciaPlanTriggerCorreo(planDisparo) {
  exigirPlan(planDisparo);
  const identidadTransicion = planDisparo.transicion?.causalidadFederada
    ?.transicionMonitorId || planDisparo.transicion?.alertaAuditoriaId;
  if (!identidadTransicion) {
    throw new Error('El plan de correo requiere identidad causal de alerta o monitor.');
  }
  return hash([
    planDisparo.eventoDisparo,
    identidadTransicion,
    planDisparo.asignacionId,
    planDisparo.triggerId
  ].join(':'));
}

function construirEjecucion({ planDisparo, claveIdempotencia, iniciadoEnUtc }) {
  return {
    asignacionTriggerMonitorId: planDisparo.asignacionId,
    triggerId: planDisparo.triggerId,
    monitorId: planDisparo.monitorId,
    tenantId: planDisparo.transicion?.tenantId ?? null,
    empresaId: planDisparo.transicion?.empresaId ?? null,
    sitioId: planDisparo.transicion?.sitioId ?? null,
    monitorTenantId: planDisparo.transicion?.tenantId ?? null,
    monitorEmpresaId: planDisparo.transicion?.empresaId ?? null,
    monitorSitioId: planDisparo.transicion?.sitioId ?? null,
    triggerTenantId: planDisparo.trigger?.tenantId ?? null,
    triggerEmpresaId: planDisparo.trigger?.empresaId ?? null,
    triggerSitioId: planDisparo.trigger?.sitioId ?? null,
    versionCatalogo: planDisparo.transicion?.versionCatalogo ?? null,
    claveIdempotencia,
    eventoDisparo: planDisparo.eventoDisparo,
    estadoEjecucion: 'ejecutando',
    tipoTrigger: 'correo',
    triggerNombre: planDisparo.nombreTrigger || planDisparo.trigger?.nombre,
    monitorNombre: planDisparo.transicion?.nombreMonitor || null,
    codigoResultado: 'correo_aceptacion_en_curso',
    mensajeResultado: 'Aceptación atómica de correo en curso.',
    payloadSolicitud: {
      eventoDisparo: planDisparo.eventoDisparo,
      triggerId: Number(planDisparo.triggerId),
      monitorId: Number(planDisparo.monitorId),
      asignacionId: Number(planDisparo.asignacionId),
      alertaAuditoriaId: planDisparo.transicion?.alertaAuditoriaId || null
    },
    payloadRespuesta: null,
    payloadError: null,
    iniciadoEnUtc,
    finalizadoEnUtc: null
  };
}

function construirMessageId(claveIdempotencia, buzonCanonico) {
  const local = createHash('sha256')
    .update(`${claveIdempotencia}:salida:${buzonCanonico}`, 'utf8')
    .digest('base64url');
  return `<${local}@correo.sentinelia>`;
}

function detectarColisionBuzon(salidasPorBuzon, clave, buzon) {
  const existente = salidasPorBuzon.get(clave);
  if (existente && existente.emailCanonico !== buzon) {
    throw Object.assign(new Error('Colisión SHA-256 entre buzones canónicos.'), {
      codigo: 'colision_clave_buzon_correo'
    });
  }
}

function mensajeResultado(decision) {
  return decision.aceptada
    ? 'Notificación de correo aceptada en la cola durable.'
    : 'Notificación de correo rechazada durante la admisión.';
}

function exigirCierrePropio(cierre) {
  if (cierre?.resultado !== 'actualizada' ||
      !ESTADOS_TERMINALES.has(cierre?.ejecucion?.estadoEjecucion)) {
    throw new Error('La ejecución atómica de correo no pudo finalizarse.');
  }
}

function congelarResultado(resultado, ejecucion, metadatos) {
  return Object.freeze({
    ...resultado,
    ...metadatos,
    ejecucion: ejecucion?.serializarResumen?.() || ejecucion
  });
}

function hash(valor) {
  return createHash('sha256').update(String(valor), 'utf8').digest('hex');
}

function fechaCanonica(valor) {
  const fecha = valor instanceof Date ? valor : new Date(valor);
  if (Number.isNaN(fecha.getTime())) throw new Error('El reloj de correo no es válido.');
  return fecha.toISOString();
}

function exigirPlan(plan) {
  if (!plan || typeof plan !== 'object' || !plan.triggerId || !plan.asignacionId ||
      !plan.monitorId || !plan.eventoDisparo || plan.tipoTrigger !== 'correo') {
    throw new Error('El plan de aceptación de correo no es válido.');
  }
}

function exigirConexion(conexion) {
  if (typeof conexion?.execute !== 'function') {
    throw new Error('La aceptación de correo exige conexión SQL prestada.');
  }
}

function exigirMetodo(objeto, metodo) {
  if (typeof objeto?.[metodo] !== 'function') {
    throw new Error(`La aceptación de correo requiere ${metodo}().`);
  }
}

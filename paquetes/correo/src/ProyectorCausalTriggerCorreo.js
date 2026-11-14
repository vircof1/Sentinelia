import {
  CODIGOS_RESULTADO_ACEPTACION_TRIGGER_CORREO,
  EVENTOS_DISPARO_TRIGGER_CORREO,
  ORIGENES_CAUSALES_TRIGGER_CORREO,
  PERFIL_FOTOGRAFIA_CAUSAL_TRIGGER_CORREO,
  crearFotografiaCausalTriggerCorreo
} from './ContratoTriggerCorreo.js';

const TIPOS_DIRECTOS = new Set(['ping', 'tcp']);

export class ErrorProyeccionCausalTriggerCorreo extends Error {
  constructor(mensaje, { codigo, causa = null } = {}) {
    super(mensaje, causa ? { cause: causa } : undefined);
    this.name = 'ErrorProyeccionCausalTriggerCorreo';
    this.codigo = codigo ||
      CODIGOS_RESULTADO_ACEPTACION_TRIGGER_CORREO.CONTEXTO_NO_RENDERIZABLE;
    this.causaCodigo = causa?.codigo || null;
  }
}

export function proyectarFotografiaCausalTriggerCorreo({
  planDisparo,
  ejecucionTriggerId,
  claveIdempotencia,
  origenPublico
} = {}) {
  const origen = exigirOrigenPublico(origenPublico);
  try {
    const plan = exigirObjeto(planDisparo, 'El plan causal de correo es obligatorio.');
    const transicion = exigirObjeto(
      plan.transicion,
      'El plan de correo no contiene una transición causal.'
    );
    const eventoDisparo = String(
      plan.eventoDisparo ?? transicion.tipoEventoDisparo ?? ''
    ).trim().toLowerCase();
    const eventoTransicion = String(transicion.tipoEventoDisparo ?? '').trim().toLowerCase();
    if (eventoTransicion && eventoTransicion !== eventoDisparo) {
      throw new Error('El evento planificado no coincide con la transición fotografiada.');
    }
    const tipoMonitor = String(transicion.tipoMonitor ?? '').trim().toLowerCase();
    const proyeccion = seleccionarProyector(tipoMonitor)(transicion);
    const monitorId = idCanonico(plan.monitorId ?? transicion.monitorId);
    const alertaAuditoriaId = String(transicion.alertaAuditoriaId ?? '').trim();
    const fechaOcurrenciaUtc = fechaCanonica(transicion.fechaOcurrenciaUtc);
    const validoDesdeUtc = fechaCanonica(transicion.validoDesdeUtc);

    return crearFotografiaCausalTriggerCorreo({
      perfil: PERFIL_FOTOGRAFIA_CAUSAL_TRIGGER_CORREO,
      version: 1,
      ejecucionTriggerId: idCanonico(ejecucionTriggerId),
      claveIdempotencia: String(claveIdempotencia ?? ''),
      triggerId: idCanonico(plan.triggerId ?? plan.trigger?.id),
      asignacionId: idCanonico(plan.asignacionId ?? plan.asignacion?.id),
      monitorId,
      alertaAuditoriaId,
      eventoDisparo,
      fechaOcurrenciaUtc,
      validoDesdeUtc,
      nombreMonitor: String(transicion.nombreMonitor ?? '').trim(),
      tipoMonitor,
      estadoMonitor: eventoDisparo ===
        EVENTOS_DISPARO_TRIGGER_CORREO.APERTURA_ALERTA
        ? 'indisponible'
        : 'disponible',
      origenCausal: proyeccion.origenCausal,
      codigoResultado: proyeccion.codigoResultado,
      mensajeResultado: proyeccion.mensajeResultado,
      contextoHumano: proyeccion.contextoHumano,
      scopeTrigger: construirScope(plan.trigger),
      scopeMonitor: construirScope(transicion),
      referencias: construirReferencias({
        origen,
        monitorId,
        alertaAuditoriaId,
        eventoDisparo,
        validoDesdeUtc,
        fechaOcurrenciaUtc
      })
    });
  } catch (error) {
    if (error instanceof ErrorProyeccionCausalTriggerCorreo) throw error;
    throw new ErrorProyeccionCausalTriggerCorreo(
      'La transición no puede representarse mediante el contrato causal de correo.',
      { causa: error }
    );
  }
}

export function proyectarCausaMonitorDirecto(transicion) {
  return proyectarCamposPermitidos(
    transicion,
    ORIGENES_CAUSALES_TRIGGER_CORREO.DIRECTO
  );
}

export function proyectarCausaMonitorTelemetria(transicion) {
  return proyectarCamposPermitidos(
    transicion,
    ORIGENES_CAUSALES_TRIGGER_CORREO.TELEMETRIA
  );
}

export function proyectarCausaMonitorLogico(transicion) {
  return proyectarCamposPermitidos(
    transicion,
    ORIGENES_CAUSALES_TRIGGER_CORREO.LOGICO
  );
}

function seleccionarProyector(tipoMonitor) {
  if (TIPOS_DIRECTOS.has(tipoMonitor)) return proyectarCausaMonitorDirecto;
  if (tipoMonitor === 'telemetria') return proyectarCausaMonitorTelemetria;
  if (tipoMonitor === 'booleano') return proyectarCausaMonitorLogico;
  throw new Error(`El tipo de monitor \"${tipoMonitor || '(vacío)'}\" no posee proyector correo@1.`);
}

function proyectarCamposPermitidos(transicion, origenCausal) {
  const payload = objetoPlano(transicion.payloadAlerta);
  return Object.freeze({
    origenCausal,
    codigoResultado: textoOpcional(transicion.codigoResultado),
    mensajeResultado: textoOpcional(transicion.mensajeResultado),
    contextoHumano: Object.freeze({
      descripcionFallo: textoMultilineaOpcional(payload.descripcionFallo),
      posibleSolucion: textoMultilineaOpcional(payload.posibleSolucion)
    })
  });
}

function construirScope(valor) {
  const tenantId = idOpcional(valor?.tenantId);
  const empresaId = idOpcional(valor?.empresaId);
  const sitioId = idOpcional(valor?.sitioId);
  const nivel = sitioId !== null
    ? 'sitio'
    : empresaId !== null
      ? 'empresa'
      : tenantId !== null
        ? 'tenant'
        : 'portal';
  return { nivel, tenantId, empresaId, sitioId };
}

function construirReferencias({
  origen,
  monitorId,
  alertaAuditoriaId,
  eventoDisparo,
  validoDesdeUtc,
  fechaOcurrenciaUtc
}) {
  const estado = new URL(`/monitores/${encodeURIComponent(monitorId)}`, origen);
  estado.searchParams.set('return_to', '/panel');
  const historico = new URL('/monitores/historico', origen);
  historico.searchParams.set('monitor_id', monitorId);
  historico.searchParams.set('desde', validoDesdeUtc);
  if (eventoDisparo === EVENTOS_DISPARO_TRIGGER_CORREO.CIERRE_ALERTA) {
    historico.searchParams.set('hasta', fechaOcurrenciaUtc);
  }
  historico.searchParams.set('alerta_id', alertaAuditoriaId);
  return { estadoUrl: estado.toString(), historicoUrl: historico.toString() };
}

function exigirOrigenPublico(valor) {
  if (typeof valor !== 'string' || valor !== valor.trim()) {
    throw new ErrorProyeccionCausalTriggerCorreo(
      'El origen público HTTPS del portal no está disponible.',
      { codigo: CODIGOS_RESULTADO_ACEPTACION_TRIGGER_CORREO.ORIGEN_PUBLICO_NO_DISPONIBLE }
    );
  }
  try {
    const url = new URL(valor);
    if (url.protocol !== 'https:' || url.username || url.password ||
        url.pathname !== '/' || url.search || url.hash) {
      throw new Error('origen_no_canonico');
    }
    return url.origin;
  } catch (causa) {
    throw new ErrorProyeccionCausalTriggerCorreo(
      'El origen público HTTPS del portal no está disponible.',
      {
        codigo: CODIGOS_RESULTADO_ACEPTACION_TRIGGER_CORREO.ORIGEN_PUBLICO_NO_DISPONIBLE,
        causa
      }
    );
  }
}

function exigirObjeto(valor, mensaje) {
  if (!valor || typeof valor !== 'object' || Array.isArray(valor)) {
    throw new Error(mensaje);
  }
  return valor;
}

function objetoPlano(valor) {
  return valor && typeof valor === 'object' && !Array.isArray(valor) ? valor : {};
}

function textoOpcional(valor) {
  if (valor === null || valor === undefined || valor === '') return null;
  return String(valor).trim() || null;
}

function textoMultilineaOpcional(valor) {
  const texto = textoOpcional(valor);
  return texto === null ? null : texto.replace(/\r\n/gu, '\n');
}

function idCanonico(valor) {
  const texto = String(valor ?? '').trim();
  if (!/^[1-9][0-9]*$/u.test(texto)) throw new Error('La causa exige ids positivos.');
  return texto;
}

function idOpcional(valor) {
  return valor === null || valor === undefined || String(valor).trim() === ''
    ? null
    : idCanonico(valor);
}

function fechaCanonica(valor) {
  if (valor instanceof Date) return valor.toISOString();
  return String(valor ?? '').trim();
}

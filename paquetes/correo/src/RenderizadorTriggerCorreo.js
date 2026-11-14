import {
  CODIGOS_RESULTADO_ACEPTACION_TRIGGER_CORREO,
  EVENTOS_DISPARO_TRIGGER_CORREO,
  PERFIL_MENSAJE_MATERIALIZADO_TRIGGER_CORREO,
  crearDefinicionMensajeTriggerCorreo,
  crearFotografiaCausalTriggerCorreo,
  crearMensajeMaterializadoTriggerCorreo
} from './ContratoTriggerCorreo.js';
import { proyectarFotografiaCausalTriggerCorreo }
  from './ProyectorCausalTriggerCorreo.js';

const ETIQUETAS_TRANSICION = Object.freeze({
  [EVENTOS_DISPARO_TRIGGER_CORREO.APERTURA_ALERTA]: 'Apertura',
  [EVENTOS_DISPARO_TRIGGER_CORREO.CIERRE_ALERTA]: 'Cierre'
});

export class ErrorMaterializacionTriggerCorreo extends Error {
  constructor(mensaje, { codigo, causa = null } = {}) {
    super(mensaje, causa ? { cause: causa } : undefined);
    this.name = 'ErrorMaterializacionTriggerCorreo';
    this.codigo = codigo;
    this.causaCodigo = causa?.codigo || null;
  }
}

export function materializarMensajeCausalTriggerCorreo({
  definicionMensaje,
  planDisparo,
  ejecucionTriggerId,
  claveIdempotencia,
  origenPublico,
  nombrePortal,
  renderizadoEnUtc
} = {}) {
  let definicion;
  try {
    definicion = crearDefinicionMensajeTriggerCorreo(definicionMensaje);
  } catch (causa) {
    throw new ErrorMaterializacionTriggerCorreo(
      'La definición reusable del mensaje de correo es inválida.',
      {
        codigo: CODIGOS_RESULTADO_ACEPTACION_TRIGGER_CORREO.DECLARACION_INVALIDA,
        causa
      }
    );
  }

  let fotografiaCausal;
  try {
    fotografiaCausal = proyectarFotografiaCausalTriggerCorreo({
      planDisparo,
      ejecucionTriggerId,
      claveIdempotencia,
      origenPublico
    });
  } catch (causa) {
    if (causa?.codigo ===
        CODIGOS_RESULTADO_ACEPTACION_TRIGGER_CORREO.ORIGEN_PUBLICO_NO_DISPONIBLE) {
      throw causa;
    }
    throw new ErrorMaterializacionTriggerCorreo(
      'El contexto causal no puede materializarse como correo.',
      {
        codigo: CODIGOS_RESULTADO_ACEPTACION_TRIGGER_CORREO.CONTEXTO_NO_RENDERIZABLE,
        causa
      }
    );
  }

  try {
    const origenPublicoCanonico = new URL(origenPublico).origin;
    return Object.freeze({
      definicionMensaje: definicion,
      fotografiaCausal,
      mensajeMaterializado: renderizarMensajeTriggerCorreo({
        definicionMensaje: definicion,
        fotografiaCausal,
        origenPublico: origenPublicoCanonico,
        nombrePortal,
        renderizadoEnUtc
      })
    });
  } catch (causa) {
    if (causa instanceof ErrorMaterializacionTriggerCorreo) throw causa;
    throw new ErrorMaterializacionTriggerCorreo(
      'El contexto causal no puede renderizarse sin alterar su significado.',
      {
        codigo: CODIGOS_RESULTADO_ACEPTACION_TRIGGER_CORREO.CONTEXTO_NO_RENDERIZABLE,
        causa
      }
    );
  }
}

export function renderizarMensajeTriggerCorreo({
  definicionMensaje,
  fotografiaCausal,
  origenPublico,
  nombrePortal,
  renderizadoEnUtc
} = {}) {
  const definicion = crearDefinicionMensajeTriggerCorreo(definicionMensaje);
  const fotografia = crearFotografiaCausalTriggerCorreo(fotografiaCausal);
  const portal = String(nombrePortal ?? '').trim();
  if (!portal || /[\u0000-\u001f\u007f]/u.test(portal)) {
    throw new Error('El nombre visible del portal no puede representarse de forma segura.');
  }
  const transicion = ETIQUETAS_TRANSICION[fotografia.eventoDisparo];
  const asunto = sustituirTokens(definicion.asuntoPlantilla, {
    portal,
    transicion,
    monitor: fotografia.nombreMonitor,
    estado: fotografia.estadoMonitor
  });
  const bloques = [
    bloquePresentacion(portal, definicion.textoIntroduccion, fotografia, transicion),
    bloqueContextoHumano(fotografia.contextoHumano),
    bloqueReferencias(fotografia.referencias),
    definicion.textoCierre,
    'Detalles técnicos del aviso',
    bloqueTransicion(fotografia, transicion),
    bloqueResultado(fotografia),
    [
      'Los enlaces anteriores son referencias de navegación y no conceden autoridad. ' +
        'Sentinelia aplicará al abrirlos la sesión, los permisos y el alcance vigentes.',
      'Cada entrega incluirá una capacidad privada para dejar de recibir avisos futuros de este trigger.'
    ].join('\n\n')
  ].filter((bloque) => bloque !== null && bloque !== '');

  return crearMensajeMaterializadoTriggerCorreo({
    perfil: PERFIL_MENSAJE_MATERIALIZADO_TRIGGER_CORREO,
    version: 1,
    asunto,
    cuerpoBaseTexto: bloques.join('\n\n'),
    origenPublico,
    renderizadoEnUtc: fechaCanonica(renderizadoEnUtc)
  });
}

function sustituirTokens(plantilla, valores) {
  return plantilla.replace(/\{\{(portal|transicion|monitor|estado)\}\}/gu,
    (_coincidencia, token) => valores[token]);
}

function bloquePresentacion(portal, introduccion, fotografia, transicion) {
  const resumen = transicion === 'Apertura'
    ? `Se ha abierto una alerta para el monitor «${fotografia.nombreMonitor}».`
    : `Se ha cerrado la alerta del monitor «${fotografia.nombreMonitor}».`;
  return [
    `Portal: ${portal}`,
    resumen,
    introduccion
  ].filter(Boolean).join('\n\n');
}

function bloqueTransicion(fotografia, transicion) {
  return [
    `Transición: ${transicion} de alerta`,
    `Ocurrida en UTC: ${fotografia.fechaOcurrenciaUtc}`,
    `Ciclo válido desde UTC: ${fotografia.validoDesdeUtc}`,
    `Monitor: ${fotografia.nombreMonitor}`,
    `Tipo de monitor: ${fotografia.tipoMonitor}`,
    `Origen causal: ${fotografia.origenCausal}`,
    `Estado observado: ${fotografia.estadoMonitor}`
  ].join('\n');
}

function bloqueResultado(fotografia) {
  const lineas = [];
  lineas.push('Resultado de la comprobación');
  if (fotografia.codigoResultado !== null) {
    lineas.push(`Código operativo: ${fotografia.codigoResultado}`);
  }
  if (fotografia.mensajeResultado !== null) {
    lineas.push(`Mensaje operativo: ${fotografia.mensajeResultado}`);
  }
  return lineas.length > 1 ? lineas.join('\n') : null;
}

function bloqueContextoHumano(contexto) {
  const lineas = [];
  if (contexto.descripcionFallo !== null) {
    lineas.push(`Descripción del problema:\n${contexto.descripcionFallo}`);
  }
  if (contexto.posibleSolucion !== null) {
    lineas.push(`Posible solución:\n${contexto.posibleSolucion}`);
  }
  return lineas.length > 0 ? lineas.join('\n\n') : null;
}

function bloqueReferencias(referencias) {
  return [
    `Estado o problema actual:\n${referencias.estadoUrl}`,
    `Histórico del ciclo:\n${referencias.historicoUrl}`
  ].join('\n\n');
}

function fechaCanonica(valor) {
  if (valor instanceof Date) return valor.toISOString();
  return String(valor ?? '').trim();
}

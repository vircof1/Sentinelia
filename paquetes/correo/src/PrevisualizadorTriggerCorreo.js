import {
  EVENTOS_DISPARO_TRIGGER_CORREO
} from './ContratoTriggerCorreo.js';
import { materializarMensajeCausalTriggerCorreo }
  from './RenderizadorTriggerCorreo.js';

const INSTANTE_SINTETICO = '2030-01-01T12:00:00.000Z';

export function previsualizarTriggerCorreo({
  definicionMensaje,
  origenPublico,
  nombrePortal,
  tipoMonitor = 'ping',
  eventoDisparo = EVENTOS_DISPARO_TRIGGER_CORREO.APERTURA_ALERTA,
  renderizadoEnUtc = null
} = {}) {
  const cierre = eventoDisparo === EVENTOS_DISPARO_TRIGGER_CORREO.CIERRE_ALERTA;
  const instanteRender = renderizadoEnUtc || (cierre
    ? '2030-01-01T12:05:00.010Z'
    : '2030-01-01T12:00:00.010Z');
  const materializacion = materializarMensajeCausalTriggerCorreo({
    definicionMensaje,
    origenPublico,
    nombrePortal,
    renderizadoEnUtc: instanteRender,
    ejecucionTriggerId: '1',
    claveIdempotencia: '0'.repeat(64),
    planDisparo: {
      eventoDisparo,
      monitorId: '1',
      triggerId: '1',
      asignacionId: '1',
      trigger: { id: '1', tenantId: null, empresaId: null, sitioId: null },
      transicion: {
        tipoEventoDisparo: eventoDisparo,
        alertaAuditoriaId: '0199a9f0-7b5c-7a55-b32a-000000000001',
        monitorId: '1',
        tenantId: '1',
        empresaId: '1',
        sitioId: '1',
        tipoMonitor,
        nombreMonitor: '[Vista previa] Monitor sintético',
        fechaOcurrenciaUtc: cierre
          ? '2030-01-01T12:05:00.000Z'
          : INSTANTE_SINTETICO,
        validoDesdeUtc: INSTANTE_SINTETICO,
        codigoResultado: cierre ? 'recuperado' : 'timeout',
        mensajeResultado: cierre
          ? 'Muestra sintética: el servicio vuelve a responder.'
          : 'Muestra sintética: el servicio no respondió dentro del plazo.',
        payloadAlerta: {
          descripcionFallo: 'Contexto humano sintético de la vista previa.',
          posibleSolucion: 'Comprueba la configuración antes de activar el trigger.'
        }
      }
    }
  });
  return Object.freeze({
    sintetica: true,
    advertencia: 'Vista previa sintética: no representa una transición real ni envía correo.',
    ...materializacion
  });
}

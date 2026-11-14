import { crearOcurrenciaOrigenFederada } from './EnvolventeFederacion.js';
import {
  TIPOS_IDENTIDAD_FEDERADA,
  crearIdentidadFederada
} from './IdentidadFederada.js';
import { validarPayloadAuditoriaFederada } from './PayloadAuditoriaFederada.js';
import { validarPayloadAvisosFederados } from './PayloadAvisosFederados.js';
import { validarPayloadMonitoresFederacion } from './PayloadMonitoresFederacion.js';
import { validarPayloadTelemetriaFederacion } from './PayloadTelemetriaFederacion.js';
import { validarPayloadTriggersInformativosFederacion } from './PayloadTriggersInformativosFederacion.js';

const VALIDADORES_HISTORICOS = Object.freeze({
  auditoria: validarPayloadAuditoriaFederada,
  avisosFederados: validarPayloadAvisosFederados,
  monitores: validarPayloadMonitoresFederacion,
  telemetria: validarPayloadTelemetriaFederacion,
  triggersInformativos: validarPayloadTriggersInformativosFederacion
});

export function clasificarDescarteRetencionOcurrenciaFederada(ocurrencia = {}) {
  const validada = validarEnvolvente(ocurrencia);
  if (!validada || validada.operacion !== 'actualizacion') return null;
  const familia = validada.familia;
  const declaracion = validada.campos?.[familia];
  const payloadOriginal = declaracion?.estado === 'presente' ? declaracion.valor : null;
  if (!payloadOriginal || typeof payloadOriginal !== 'object') return null;
  const payload = validarPayload(familia, payloadOriginal);
  if (!payload) return null;

  if (familia === 'auditoria') {
    return candidato(payload.vistaAutorizada?.efectivoEnUtc, null);
  }
  if (familia === 'telemetria') {
    if (!['observacion','eventoDerivado'].includes(payload.tipoRegistro)) return null;
    return candidato(payload.observadoEnUtc, payload.vigenteHastaUtc ?? null);
  }
  if (familia === 'monitores') {
    if (payload.tipoRegistro === 'evento') {
      return candidato(payload.ejecutadoEnUtc, null);
    }
    if (payload.tipoRegistro === 'tramoHistorico') {
      // Un tramo puede comenzar fuera de la ventana retenida y terminar dentro
      // de ella. La retención solo puede descartar el agregado completo cuando
      // también ha vencido su extremo más reciente.
      return candidato(payload.validoHastaUtc, null);
    }
    if (payload.tipoRegistro === 'alerta' && payload.estadoAlerta === 'cerrada') {
      return candidato(payload.cerradaEnUtc ?? payload.ultimaEjecucionUtc, null);
    }
    return null;
  }
  if (
    familia === 'triggersInformativos' &&
    payload.tipoRegistro === 'ejecucionTerminada'
  ) {
    return candidato(payload.finalizadoEnUtc, null);
  }
  if (familia === 'avisosFederados' && payload.tipoRegistro === 'transicion') {
    return candidato(payload.efectivoEnUtc, null);
  }
  return null;
}

function validarPayload(familia, payload) {
  try {
    return VALIDADORES_HISTORICOS[familia]?.(payload, {
      operacion: 'actualizacion'
    }) ?? null;
  } catch {
    // El descarte exige reconocer el contrato completo. Un payload inválido
    // continúa por la validación receptora previa al inbox, que produce su
    // rechazo terminal sin confirmarlo ni crear trabajo de materialización.
    return null;
  }
}

function validarEnvolvente(ocurrencia) {
  try {
    return crearOcurrenciaOrigenFederada({
      ...ocurrencia,
      installationOrigenId: identidad(
        ocurrencia?.installationOrigenId,
        TIPOS_IDENTIDAD_FEDERADA.INSTALACION
      ),
      elementoOrigenId: identidad(
        ocurrencia?.elementoOrigenId,
        TIPOS_IDENTIDAD_FEDERADA.ELEMENTO_ORIGEN
      ),
      ocurrenciaOrigenId: identidad(
        ocurrencia?.ocurrenciaOrigenId,
        TIPOS_IDENTIDAD_FEDERADA.OCURRENCIA_ORIGEN
      )
    }).toJSON();
  } catch {
    // Una envolvente inválida debe seguir el camino ordinario de inbox para
    // obtener un rechazo terminal; la retención nunca puede legitimarla.
    return null;
  }
}

function identidad(valor, tipo) {
  return crearIdentidadFederada({ tipo, valor: String(valor || '') });
}

function candidato(tiempoEfectivoOrigenUtc, vigenteHastaOrigenUtc) {
  if (!fechaValida(tiempoEfectivoOrigenUtc)) return null;
  if (vigenteHastaOrigenUtc !== null && !fechaValida(vigenteHastaOrigenUtc)) {
    return null;
  }
  return Object.freeze({ tiempoEfectivoOrigenUtc, vigenteHastaOrigenUtc });
}

function fechaValida(valor) {
  return typeof valor === 'string' && !Number.isNaN(Date.parse(valor));
}

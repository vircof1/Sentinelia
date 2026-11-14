import { prepararEventoEncadenadoAuditoriaV1 } from '../../auditoria/src/SobreCanonicoAuditoria.js';
import { validarPayloadAuditoriaFederada } from '../src/PayloadAuditoriaFederada.js';

export function evaluarEvidenciaAuditoriaFederada(payload) {
  const normalizado = validarPayloadAuditoriaFederada(payload);
  const evidencia = normalizado.evidenciaOrigen;
  if (evidencia.estado === 'noVerificable') {
    return Object.freeze({
      estado: 'noVerificable',
      causa: evidencia.causa,
      codigo: 'limitada_por_vista_origen'
    });
  }
  try {
    const preparado = prepararEventoEncadenadoAuditoriaV1(
      evidencia.sobreCanonico,
      { hashAnterior: Buffer.from(evidencia.hashAnterior, 'hex') }
    );
    const valida = hashesIguales(preparado.hashPayload, evidencia.hashPayload) &&
      hashesIguales(preparado.hashActual, evidencia.hashActual);
    return Object.freeze({
      estado: valida ? 'verificada' : 'invalida',
      causa: valida ? null : 'hash_recalculado_incoherente',
      codigo: valida ? 'evidencia_estructural_valida' : 'evidencia_estructural_invalida'
    });
  } catch {
    return Object.freeze({
      estado: 'invalida',
      causa: 'sobre_no_recalculable',
      codigo: 'evidencia_estructural_invalida'
    });
  }
}

function hashesIguales(buffer, hexadecimal) {
  const actual = buffer?.toString?.('hex') || '';
  let diferencia = actual.length ^ hexadecimal.length;
  const longitud = Math.max(actual.length, hexadecimal.length);
  for (let indice = 0; indice < longitud; indice += 1) {
    diferencia |= (actual.charCodeAt(indice) || 0) ^
      (hexadecimal.charCodeAt(indice) || 0);
  }
  return diferencia === 0;
}

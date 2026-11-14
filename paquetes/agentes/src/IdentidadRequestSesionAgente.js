import { createHash } from 'node:crypto';
import { uuidV7AuditoriaABytes } from '../../auditoria/src/UuidV7Auditoria.js';

const DOMINIO_REQUEST_ID = Buffer.from('sentinelia-agentes-request-id-v1', 'utf8');

export function calcularDigestRequestIdSesionAgente(requestId) {
  return createHash('sha256')
    .update(DOMINIO_REQUEST_ID)
    .update(Buffer.from([0]))
    .update(uuidV7AuditoriaABytes(requestId, 'requestId'))
    .digest();
}

export function calcularDigestRequestIdSesionAgenteHex(requestId) {
  return calcularDigestRequestIdSesionAgente(requestId).toString('hex');
}

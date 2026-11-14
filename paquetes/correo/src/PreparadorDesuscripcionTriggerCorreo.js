import crypto from 'node:crypto';
import { LIMITES_CONTRATO_TRIGGER_CORREO }
  from './ContratoTriggerCorreo.js';

export function prepararDesuscripcionPrivadaTriggerCorreo({
  triggerId,
  ttlDias,
  origenPublico,
  cuerpoBaseTexto,
  fuenteEntropia = () => crypto.randomBytes(32)
} = {}) {
  const trigger = idDecimal(triggerId, 'triggerId');
  const ttl = enteroEnRango(ttlDias,
    LIMITES_CONTRATO_TRIGGER_CORREO.TTL_DESUSCRIPCION_DIAS_MINIMO,
    LIMITES_CONTRATO_TRIGGER_CORREO.TTL_DESUSCRIPCION_DIAS_MAXIMO,
    'ttlDias');
  const origen = origenHttpsCanonico(origenPublico);
  const cuerpoBase = String(cuerpoBaseTexto ?? '');
  const entropia = fuenteEntropia();
  if (!Buffer.isBuffer(entropia) || entropia.length !== 32) {
    throw new Error('La capacidad de desuscripción exige 256 bits de entropía.');
  }
  const token = entropia.toString('base64url');
  const tokenHashSha256 = crypto.createHash('sha256').update(token, 'ascii').digest('hex');
  const enlace = new URL(`/correo/desuscripcion/${token}`, origen).toString();
  const cuerpoPrivadoTexto = [
    cuerpoBase,
    'Dejar de recibir avisos futuros de este trigger:',
    enlace
  ].filter(Boolean).join('\n\n');
  if (!cuerpoPrivadoTexto ||
      Buffer.byteLength(cuerpoPrivadoTexto, 'utf8') >
        LIMITES_CONTRATO_TRIGGER_CORREO.CUERPO_UTF8_BYTES) {
    throw new Error('El cuerpo privado con desuscripción supera el límite contractual.');
  }
  return Object.freeze({
    triggerId: trigger,
    tokenHashSha256,
    ttlDias: ttl,
    cuerpoPrivadoTexto
  });
}

function origenHttpsCanonico(valor) {
  const texto = String(valor ?? '');
  try {
    const url = new URL(texto);
    if (url.protocol !== 'https:' || url.username || url.password || url.hash ||
        url.pathname !== '/' || url.search || url.toString() !== `${texto}/`) {
      throw new Error('origen_no_canonico');
    }
    return texto;
  } catch {
    throw new Error('La desuscripción exige un origen HTTPS canónico sin path.');
  }
}

function idDecimal(valor, campo) {
  const texto = String(valor ?? '');
  if (!/^[1-9][0-9]*$/u.test(texto)) throw new Error(`${campo} no es canónico.`);
  return texto;
}

function enteroEnRango(valor, minimo, maximo, campo) {
  const numero = Number(valor);
  if (!Number.isSafeInteger(numero) || numero < minimo || numero > maximo) {
    throw new Error(`${campo} está fuera de rango.`);
  }
  return numero;
}

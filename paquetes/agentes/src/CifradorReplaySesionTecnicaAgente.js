import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { canonicalizarJcsAuditoriaV1 } from '../../auditoria/src/PerfilJcsAuditoria.js';
import { validarUuidV7Auditoria } from '../../auditoria/src/UuidV7Auditoria.js';

const ALGORITMO = 'aes-256-gcm';
const PERFIL = 'sentinelia-agentes-replay-a256gcm-v1';
const MAX_BYTES_RESPUESTA = 65_536;

export class CifradorReplaySesionTecnicaAgente {
  constructor({ keyring, generarNonce = () => randomBytes(12) } = {}) {
    if (!keyring?.obtenerActiva || !keyring?.obtener) {
      throw new Error('El cifrador requiere un keyring técnico validado.');
    }
    this.keyring = keyring;
    this.generarNonce = generarNonce;
  }

  cifrar({ aad, respuesta } = {}) {
    const aadCanonico = canonicalizarAad(aad);
    if (!respuesta || typeof respuesta !== 'object' || Array.isArray(respuesta) ||
        Object.getPrototypeOf(respuesta) !== Object.prototype) {
      throw new Error('La respuesta técnica debe ser un objeto JSON plano.');
    }
    const respuestaCanonica = canonicalizarJcsAuditoriaV1(respuesta);
    if (Buffer.byteLength(respuestaCanonica, 'utf8') > MAX_BYTES_RESPUESTA) {
      throw new Error(`La respuesta de sesión supera ${MAX_BYTES_RESPUESTA} bytes UTF-8.`);
    }
    const { keyId, clave } = this.keyring.obtenerActiva();
    const nonce = Buffer.from(this.generarNonce());
    if (nonce.length !== 12) throw new Error('El nonce AES-GCM debe contener 96 bits.');
    const cifrador = createCipheriv(ALGORITMO, clave, nonce, { authTagLength: 16 });
    cifrador.setAAD(Buffer.from(aadCanonico, 'utf8'));
    const ciphertext = Buffer.concat([
      cifrador.update(respuestaCanonica, 'utf8'),
      cifrador.final()
    ]);
    return Object.freeze({
      perfil: PERFIL,
      keyId,
      nonce: nonce.toString('base64url'),
      ciphertext: ciphertext.toString('base64url'),
      tag: cifrador.getAuthTag().toString('base64url')
    });
  }

  descifrar({ aad, sobre } = {}) {
    const aadCanonico = canonicalizarAad(aad);
    validarSobre(sobre);
    const clave = this.keyring.obtener(sobre.keyId);
    if (!clave) throw new RespuestaSesionTecnicaNoRecuperable();
    try {
      const nonce = decodificarBase64Url(sobre.nonce, 12, 'nonce');
      const tag = decodificarBase64Url(sobre.tag, 16, 'tag');
      const ciphertext = decodificarBase64Url(sobre.ciphertext, null, 'ciphertext');
      const descifrador = createDecipheriv(ALGORITMO, clave, nonce, { authTagLength: 16 });
      descifrador.setAAD(Buffer.from(aadCanonico, 'utf8'));
      descifrador.setAuthTag(tag);
      return JSON.parse(Buffer.concat([
        descifrador.update(ciphertext),
        descifrador.final()
      ]).toString('utf8'));
    } catch (error) {
      if (error instanceof RespuestaSesionTecnicaNoRecuperable) throw error;
      throw new RespuestaSesionTecnicaNoRecuperable();
    }
  }
}

export class RespuestaSesionTecnicaNoRecuperable extends Error {
  constructor() {
    super('La respuesta de sesión técnica ya no es recuperable.');
    this.name = 'RespuestaSesionTecnicaNoRecuperable';
    this.codigo = 'RESPUESTA_SESION_NO_RECUPERABLE';
    this.statusCode = 410;
    this.accion = 'login_required';
  }
}

export function canonicalizarAadReplaySesionTecnica(aad) {
  return canonicalizarAad(aad);
}

function canonicalizarAad(aad) {
  if (!aad || typeof aad !== 'object' || Array.isArray(aad) ||
      Object.getPrototypeOf(aad) !== Object.prototype) {
    throw new Error('El AAD de replay debe ser un objeto plano.');
  }
  const claves = Object.keys(aad).sort();
  const esperadas = ['agenteId', 'operacionId', 'requestId', 'sesionAuditoriaId', 'tipo'];
  if (claves.length !== esperadas.length || claves.some((clave, i) => clave !== esperadas[i])) {
    throw new Error('El AAD de replay no coincide con su perfil cerrado.');
  }
  const normalizado = {
    agenteId: idDecimal(aad.agenteId),
    operacionId: validarUuidV7Auditoria(aad.operacionId, 'operacionId'),
    requestId: validarUuidV7Auditoria(aad.requestId, 'requestId'),
    sesionAuditoriaId: validarUuidV7Auditoria(aad.sesionAuditoriaId, 'sesionAuditoriaId'),
    tipo: ['login', 'refresh'].includes(aad.tipo) ? aad.tipo : (() => {
      throw new Error('El tipo del AAD no es válido.');
    })()
  };
  return canonicalizarJcsAuditoriaV1(normalizado);
}

function validarSobre(sobre) {
  if (!sobre || typeof sobre !== 'object' || Array.isArray(sobre)) {
    throw new RespuestaSesionTecnicaNoRecuperable();
  }
  const claves = Object.keys(sobre).sort();
  const esperadas = ['ciphertext', 'keyId', 'nonce', 'perfil', 'tag'];
  if (claves.length !== esperadas.length || claves.some((clave, i) => clave !== esperadas[i]) ||
      sobre.perfil !== PERFIL || typeof sobre.keyId !== 'string') {
    throw new RespuestaSesionTecnicaNoRecuperable();
  }
}

function decodificarBase64Url(valor, longitud, nombre) {
  if (typeof valor !== 'string' || !/^[A-Za-z0-9_-]*$/.test(valor)) {
    throw new Error(`${nombre} no usa base64url canónico.`);
  }
  const bytes = Buffer.from(valor, 'base64url');
  if (bytes.toString('base64url') !== valor || (longitud !== null && bytes.length !== longitud)) {
    throw new Error(`${nombre} no tiene la representación esperada.`);
  }
  return bytes;
}

function idDecimal(valor) {
  const resultado = String(valor ?? '');
  if (!/^[1-9][0-9]*$/.test(resultado)) throw new Error('agenteId no es canónico.');
  return resultado;
}

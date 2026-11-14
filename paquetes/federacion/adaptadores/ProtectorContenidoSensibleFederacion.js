import {
  createCipheriv,
  createDecipheriv,
  randomBytes
} from 'node:crypto';

import { canonicalizarJsonFederacion } from '../src/CanonicalizadorFederacion.js';

export const PERFIL_CONTENIDO_SENSIBLE_FEDERACION =
  'sentinelia-federacion-contenido-sensible-a256gcm-v1';

export class ErrorContenidoSensibleFederacion extends Error {
  constructor(codigo, mensaje) {
    super(mensaje);
    this.name = 'ErrorContenidoSensibleFederacion';
    this.codigo = codigo;
  }
}

export class ProtectorContenidoSensibleFederacion {
  constructor({ keyring, generarNonce = () => randomBytes(12) } = {}) {
    if (typeof keyring?.obtenerClaveActiva !== 'function' ||
        typeof keyring?.obtenerClavePorId !== 'function' ||
        typeof keyring?.referencia !== 'string') {
      throw new Error('El contenido sensible federado requiere un keyring válido.');
    }
    if (typeof generarNonce !== 'function') {
      throw new Error('El contenido sensible federado requiere un generador de nonce.');
    }
    this.keyring = keyring;
    this.generarNonce = generarNonce;
  }

  cifrar({ contenido, aad } = {}) {
    const contenidoCanonico = canonicalizarJsonFederacion(contenido);
    const aadCanonico = canonicalizarJsonFederacion(aad);
    const materialClave = this.keyring.obtenerClaveActiva();
    const keyId = materialClave.keyId;
    const clave = materialClave.clave;
    const contenidoBytes = Buffer.from(contenidoCanonico, 'utf8');
    try {
      exigirClaveDesechable(clave);
      const nonce = Buffer.from(this.generarNonce());
      if (nonce.length !== 12) throw new Error('El nonce AES-GCM debe contener 96 bits.');
      const cifrador = createCipheriv('aes-256-gcm', clave, nonce);
      cifrador.setAAD(Buffer.from(aadCanonico, 'utf8'));
      const ciphertext = Buffer.concat([
        cifrador.update(contenidoBytes),
        cifrador.final()
      ]);
      return Object.freeze({
        perfil: PERFIL_CONTENIDO_SENSIBLE_FEDERACION,
        keyringReferencia: this.keyring.referencia,
        keyId: String(keyId),
        nonce,
        ciphertext,
        authTag: cifrador.getAuthTag()
      });
    } finally {
      contenidoBytes.fill(0);
      if (Buffer.isBuffer(clave)) clave.fill(0);
    }
  }

  descifrar({ sobre, aad } = {}) {
    validarSobre(sobre, this.keyring.referencia);
    try {
      const materialClave = this.keyring.obtenerClavePorId(sobre.keyId);
      if (!materialClave) throw new Error();
      const clave = materialClave;
      let textoBytes;
      try {
        exigirClaveDesechable(clave);
        const descifrador = createDecipheriv(
          'aes-256-gcm', clave, Buffer.from(sobre.nonce)
        );
        descifrador.setAAD(Buffer.from(canonicalizarJsonFederacion(aad), 'utf8'));
        descifrador.setAuthTag(Buffer.from(sobre.authTag));
        textoBytes = Buffer.concat([
          descifrador.update(Buffer.from(sobre.ciphertext)),
          descifrador.final()
        ]);
        return JSON.parse(textoBytes.toString('utf8'));
      } finally {
        textoBytes?.fill(0);
        if (Buffer.isBuffer(clave)) clave.fill(0);
      }
    } catch {
      throw new ErrorContenidoSensibleFederacion(
        'contenido_sensible_no_recuperable',
        'El contenido sensible federado no puede recuperarse con esta custodia.'
      );
    }
  }
}

function validarSobre(sobre, referencia) {
  if (sobre?.perfil !== PERFIL_CONTENIDO_SENSIBLE_FEDERACION ||
      sobre.keyringReferencia !== referencia ||
      typeof sobre.keyId !== 'string' ||
      !Buffer.isBuffer(sobre.nonce) || sobre.nonce.length !== 12 ||
      !Buffer.isBuffer(sobre.ciphertext) || sobre.ciphertext.length === 0 ||
      !Buffer.isBuffer(sobre.authTag) || sobre.authTag.length !== 16) {
    throw new ErrorContenidoSensibleFederacion(
      'sobre_sensible_invalido',
      'El sobre de contenido sensible federado no es válido.'
    );
  }
}

function exigirClaveDesechable(clave) {
  if (!Buffer.isBuffer(clave) || clave.length !== 32) {
    throw new Error('El keyring no entregó una copia desechable de 256 bits.');
  }
}

import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
  timingSafeEqual
} from 'node:crypto';
import { canonicalizarJsonFederacion } from '../src/CanonicalizadorFederacion.js';

export const PERFIL_SECRETO_CIFRADO_FEDERACION =
  'sentinelia-federacion-secreto-a256gcm-v1';
export const PERFIL_VERIFICADOR_SECRETO_FEDERACION =
  'sentinelia-federacion-verificador-sha256-v1';

const PATRON_SECRETO = /^sfr1_[A-Za-z0-9_-]{64}$/u;

export class ProtectorSecretoPersistenteFederacion {
  constructor({ keyring, generarNonce = () => randomBytes(12) } = {}) {
    if (
      typeof keyring?.obtenerClaveActiva !== 'function' ||
      typeof keyring?.obtenerClavePorId !== 'function'
    ) {
      throw new Error('La custodia del secreto federado requiere un keyring válido.');
    }
    if (typeof generarNonce !== 'function') {
      throw new Error('La custodia del secreto federado requiere un generador de nonce.');
    }
    this.keyring = keyring;
    this.generarNonce = generarNonce;
  }

  cifrar({ secreto, aad } = {}) {
    validarSecreto(secreto);
    const aadCanonico = canonicalizarAad(aad);
    const materialClave = this.keyring.obtenerClaveActiva();
    const keyId = materialClave.keyId;
    const clave = materialClave.clave;
    const secretoBytes = Buffer.from(secreto, 'ascii');
    try {
      exigirClaveDesechable(clave);
      const nonce = Buffer.from(this.generarNonce());
      if (nonce.length !== 12) throw new Error('El nonce AES-GCM debe contener 96 bits.');
      const cifrador = createCipheriv('aes-256-gcm', clave, nonce, {
        authTagLength: 16
      });
      cifrador.setAAD(Buffer.from(aadCanonico, 'utf8'));
      const ciphertext = Buffer.concat([
        cifrador.update(secretoBytes),
        cifrador.final()
      ]);
      return Object.freeze({
        perfil: PERFIL_SECRETO_CIFRADO_FEDERACION,
        keyringReferencia: this.keyring.referencia,
        keyId,
        nonce,
        ciphertext,
        authTag: cifrador.getAuthTag()
      });
    } finally {
      secretoBytes.fill(0);
      if (Buffer.isBuffer(clave)) clave.fill(0);
    }
  }

  descifrar({ sobre, aad } = {}) {
    validarSobreCifrado(sobre);
    const aadCanonico = canonicalizarAad(aad);
    if (sobre.keyringReferencia !== this.keyring.referencia) {
      throw new SecretoPersistenteFederacionNoRecuperable();
    }
    try {
      const materialClave = this.keyring.obtenerClavePorId(sobre.keyId);
      if (!materialClave) throw new SecretoPersistenteFederacionNoRecuperable();
      const clave = materialClave;
      let secretoBytes;
      try {
        exigirClaveDesechable(clave);
        const descifrador = createDecipheriv('aes-256-gcm', clave, sobre.nonce, {
          authTagLength: 16
        });
        descifrador.setAAD(Buffer.from(aadCanonico, 'utf8'));
        descifrador.setAuthTag(sobre.authTag);
        secretoBytes = Buffer.concat([
          descifrador.update(sobre.ciphertext),
          descifrador.final()
        ]);
        const secreto = secretoBytes.toString('ascii');
        validarSecreto(secreto);
        return secreto;
      } finally {
        secretoBytes?.fill(0);
        if (Buffer.isBuffer(clave)) clave.fill(0);
      }
    } catch (error) {
      if (error instanceof SecretoPersistenteFederacionNoRecuperable) throw error;
      throw new SecretoPersistenteFederacionNoRecuperable();
    }
  }
}

export class VerificadorSecretoPersistenteFederacion {
  constructor({ generarSal = () => randomBytes(32) } = {}) {
    if (typeof generarSal !== 'function') {
      throw new Error('El verificador federado requiere un generador de sal.');
    }
    this.generarSal = generarSal;
  }

  crear({ secreto, contexto } = {}) {
    validarSecreto(secreto);
    const sal = Buffer.from(this.generarSal());
    if (sal.length !== 32) throw new Error('La sal del verificador debe contener 256 bits.');
    return Object.freeze({
      perfil: PERFIL_VERIFICADOR_SECRETO_FEDERACION,
      sal,
      digest: calcularDigest({ secreto, sal, contexto })
    });
  }

  verificar({ secreto, verificador, contexto } = {}) {
    validarSecreto(secreto);
    validarVerificador(verificador);
    const observado = calcularDigest({
      secreto,
      sal: verificador.sal,
      contexto
    });
    return timingSafeEqual(observado, verificador.digest);
  }
}

export class SecretoPersistenteFederacionNoRecuperable extends Error {
  constructor() {
    super('El secreto persistente federado no puede recuperarse con esta custodia.');
    this.name = 'SecretoPersistenteFederacionNoRecuperable';
    this.codigo = 'SECRETO_PERSISTENTE_NO_RECUPERABLE';
  }
}

export function crearContextoSecretoPersistenteFederacion({
  relacionId,
  installationLocalId,
  installationRemotaId,
  versionCredencial
} = {}) {
  exigirIdentidad(relacionId, 'relacion', 'relacionId');
  exigirIdentidad(installationLocalId, 'instalacion', 'installationLocalId');
  exigirIdentidad(installationRemotaId, 'instalacion', 'installationRemotaId');
  if (!Number.isSafeInteger(versionCredencial) || versionCredencial < 1) {
    throw new Error('versionCredencial debe ser un entero positivo.');
  }
  return Object.freeze({
    perfil: 'sentinelia-federacion-contexto-secreto-v1',
    relacionId,
    installationLocalId,
    installationRemotaId,
    versionCredencial
  });
}

function canonicalizarAad(aad) {
  return canonicalizarJsonFederacion(
    crearContextoSecretoPersistenteFederacion(aad)
  );
}

function calcularDigest({ secreto, sal, contexto }) {
  const aad = canonicalizarAad(contexto);
  return createHash('sha256')
    .update(PERFIL_VERIFICADOR_SECRETO_FEDERACION, 'ascii')
    .update(Buffer.from([0]))
    .update(aad, 'utf8')
    .update(Buffer.from([0]))
    .update(sal)
    .update(Buffer.from([0]))
    .update(secreto, 'ascii')
    .digest();
}

function validarSobreCifrado(sobre) {
  if (
    sobre?.perfil !== PERFIL_SECRETO_CIFRADO_FEDERACION ||
    typeof sobre.keyringReferencia !== 'string' ||
    typeof sobre.keyId !== 'string' ||
    !Buffer.isBuffer(sobre.nonce) || sobre.nonce.length !== 12 ||
    !Buffer.isBuffer(sobre.ciphertext) || sobre.ciphertext.length !== 69 ||
    !Buffer.isBuffer(sobre.authTag) || sobre.authTag.length !== 16
  ) throw new SecretoPersistenteFederacionNoRecuperable();
}

function validarVerificador(verificador) {
  if (
    verificador?.perfil !== PERFIL_VERIFICADOR_SECRETO_FEDERACION ||
    !Buffer.isBuffer(verificador.sal) || verificador.sal.length !== 32 ||
    !Buffer.isBuffer(verificador.digest) || verificador.digest.length !== 32
  ) throw new Error('El verificador persistente no es válido.');
}

function validarSecreto(secreto) {
  if (typeof secreto !== 'string' || !PATRON_SECRETO.test(secreto)) {
    throw new Error('El secreto persistente federado no es canónico.');
  }
}

function exigirClaveDesechable(clave) {
  if (!Buffer.isBuffer(clave) || clave.length !== 32) {
    throw new Error('El keyring no entregó una copia desechable de 256 bits.');
  }
}

function exigirIdentidad(valor, tipo, campo) {
  const finalCanonico = '[A-Za-z0-9_-]{21}[AQgw]';
  if (typeof valor !== 'string' ||
      !new RegExp(`^sfid1\\.${tipo}\\.${finalCanonico}$`, 'u').test(valor)) {
    throw new Error(`${campo} no es una identidad federada canónica.`);
  }
}

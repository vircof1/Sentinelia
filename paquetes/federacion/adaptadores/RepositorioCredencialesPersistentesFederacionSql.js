import {
  PERFIL_SECRETO_CIFRADO_FEDERACION,
  PERFIL_VERIFICADOR_SECRETO_FEDERACION,
  SecretoPersistenteFederacionNoRecuperable,
  crearContextoSecretoPersistenteFederacion
} from './ProtectorSecretoPersistenteFederacion.js';

export class RepositorioCredencialesPersistentesFederacionSql {
  constructor(clienteSql) {
    if (!clienteSql?.obtenerConexion || !clienteSql?.consultar) {
      throw new Error('Las credenciales persistentes federadas requieren SQL operativo.');
    }
    this.clienteSql = clienteSql;
  }

  async guardarSecretoEmisor(entrada = {}, { protector } = {}) {
    exigirMetodo(protector, 'cifrar', 'protector');
    return this.#transaccion((conexion) =>
      this.guardarSecretoEmisorEnTransaccion(entrada, { conexion, protector })
    );
  }

  async guardarSecretoEmisorEnTransaccion(
    entrada = {},
    { conexion, protector } = {}
  ) {
    if (!conexion?.execute) throw new Error('La custodia exige una conexión prestada.');
    exigirMetodo(protector, 'cifrar', 'protector');
    const relacion = await bloquearRelacion(conexion, entrada.relacionId);
    exigirDireccion(relacion, 'emision');
    const versionCredencial = await siguienteVersion(conexion, entrada.relacionId);
    const contexto = crearContexto(entrada, versionCredencial);
    const sobre = protector.cifrar({ secreto: entrada.secreto, aad: contexto });
    const ahora = await ahoraSql(conexion);
    await reemplazarMaterial(conexion, {
      ...entrada,
      tipoMaterial: 'secretoCifrado',
      perfil: PERFIL_SECRETO_CIFRADO_FEDERACION,
      versionCredencial,
      keyringReferencia: sobre.keyringReferencia,
      keyId: sobre.keyId,
      nonce: sobre.nonce,
      ciphertext: sobre.ciphertext,
      authTag: sobre.authTag,
      verificadorSal: null,
      verificadorDigest: null,
      ahora
    });
    return sanearMetadatos(
      await obtenerMetadatosSaneados(conexion, entrada.relacionId)
    );
  }

  async guardarVerificadorReceptorEnTransaccion(
    entrada = {},
    { conexion, verificadorSecretos } = {}
  ) {
    if (!conexion?.execute) throw new Error('El verificador exige una conexión prestada.');
    exigirMetodo(verificadorSecretos, 'crear', 'verificadorSecretos');
    const relacion = await bloquearRelacion(conexion, entrada.relacionId);
    exigirDireccion(relacion, 'recepcion');
    const versionCredencial = await siguienteVersion(conexion, entrada.relacionId);
    const contexto = crearContexto(entrada, versionCredencial);
    const verificador = verificadorSecretos.crear({
      secreto: entrada.secreto,
      contexto
    });
    const ahora = entrada.efectivoEnUtc || await ahoraSql(conexion);
    await reemplazarMaterial(conexion, {
      ...entrada,
      tipoMaterial: 'verificador',
      perfil: PERFIL_VERIFICADOR_SECRETO_FEDERACION,
      versionCredencial,
      keyringReferencia: null,
      keyId: null,
      nonce: null,
      ciphertext: null,
      authTag: null,
      verificadorSal: verificador.sal,
      verificadorDigest: verificador.digest,
      ahora
    });
    return Object.freeze({
      credencialPersistida: true,
      versionCredencial
    });
  }

  async verificarSecretoReceptor(entrada = {}, { verificadorSecretos } = {}) {
    exigirMetodo(verificadorSecretos, 'verificar', 'verificadorSecretos');
    const fila = await obtenerMaterial(this.clienteSql, entrada.relacionId);
    if (
      !fila || fila.tipo_material !== 'verificador' ||
      fila.installation_local_id !== entrada.installationLocalId ||
      fila.installation_remota_id !== entrada.installationRemotaId
    ) return false;
    return verificadorSecretos.verificar({
      secreto: entrada.secreto,
      verificador: {
        perfil: fila.perfil,
        sal: Buffer.from(fila.verificador_salt),
        digest: Buffer.from(fila.verificador_digest)
      },
      contexto: crearContextoSecretoPersistenteFederacion({
        relacionId: fila.relacion_id,
        installationLocalId: fila.installation_local_id,
        installationRemotaId: fila.installation_remota_id,
        versionCredencial: Number(fila.version_credencial)
      })
    });
  }

  async verificarSecretoReceptorEnTransaccion(
    entrada = {},
    { conexion, verificadorSecretos } = {}
  ) {
    if (!conexion?.execute) throw new Error('La verificación exige conexión prestada.');
    exigirMetodo(verificadorSecretos, 'verificar', 'verificadorSecretos');
    const [filas] = await conexion.execute(
      `SELECT * FROM credenciales_persistentes_federacion
        WHERE relacion_id=? FOR UPDATE`,
      [entrada.relacionId]
    );
    const fila = filas[0];
    if (
      !fila || fila.tipo_material !== 'verificador' ||
      fila.installation_local_id !== entrada.installationLocalId ||
      fila.installation_remota_id !== entrada.installationRemotaId
    ) return false;
    return verificadorSecretos.verificar({
      secreto: entrada.secreto,
      verificador: {
        perfil: fila.perfil,
        sal: Buffer.from(fila.verificador_salt),
        digest: Buffer.from(fila.verificador_digest)
      },
      contexto: crearContextoSecretoPersistenteFederacion({
        relacionId: fila.relacion_id,
        installationLocalId: fila.installation_local_id,
        installationRemotaId: fila.installation_remota_id,
        versionCredencial: Number(fila.version_credencial)
      })
    });
  }

  async recuperarSecretoEmisor(entrada = {}, { protector } = {}) {
    exigirMetodo(protector, 'descifrar', 'protector');
    const fila = await obtenerMaterial(this.clienteSql, entrada.relacionId);
    if (
      !fila || fila.tipo_material !== 'secretoCifrado' ||
      fila.installation_local_id !== entrada.installationLocalId ||
      fila.installation_remota_id !== entrada.installationRemotaId
    ) throw new SecretoPersistenteFederacionNoRecuperable();
    return protector.descifrar({
      sobre: {
        perfil: fila.perfil,
        keyringReferencia: fila.keyring_referencia,
        keyId: fila.key_id,
        nonce: Buffer.from(fila.nonce),
        ciphertext: Buffer.from(fila.ciphertext),
        authTag: Buffer.from(fila.auth_tag)
      },
      aad: crearContextoSecretoPersistenteFederacion({
        relacionId: fila.relacion_id,
        installationLocalId: fila.installation_local_id,
        installationRemotaId: fila.installation_remota_id,
        versionCredencial: Number(fila.version_credencial)
      })
    });
  }

  async buscarMetadatosSaneados(relacionId) {
    const filas = await this.clienteSql.consultar(
      `SELECT relacion_id, tipo_material, perfil, version_credencial,
              installation_local_id, installation_remota_id, key_id,
              DATE_FORMAT(creada_en_utc, '%Y-%m-%dT%H:%i:%s.%fZ') AS creada_en_utc,
              DATE_FORMAT(actualizada_en_utc, '%Y-%m-%dT%H:%i:%s.%fZ') AS actualizada_en_utc
         FROM credenciales_persistentes_federacion
        WHERE relacion_id=? LIMIT 1`,
      [relacionId]
    );
    return filas[0] ? sanearMetadatos(filas[0]) : null;
  }

  async #transaccion(operacion) {
    const conexion = await this.clienteSql.obtenerConexion();
    try {
      await conexion.beginTransaction();
      const resultado = await operacion(conexion);
      await conexion.commit();
      return resultado;
    } catch (error) {
      try { await conexion.rollback(); } catch { /* conserva la causa original */ }
      throw error;
    } finally {
      conexion.release();
    }
  }
}

export class PersistidorVerificadorCanjeFederacion {
  constructor({ repositorioCredenciales, verificadorSecretos } = {}) {
    exigirMetodo(
      repositorioCredenciales,
      'guardarVerificadorReceptorEnTransaccion',
      'repositorioCredenciales'
    );
    exigirMetodo(verificadorSecretos, 'crear', 'verificadorSecretos');
    this.repositorioCredenciales = repositorioCredenciales;
    this.verificadorSecretos = verificadorSecretos;
  }

  async registrarEnTransaccion(entrada, { conexion } = {}) {
    const resultado = await this.repositorioCredenciales
      .guardarVerificadorReceptorEnTransaccion({
        relacionId: entrada.relacionId,
        installationLocalId: entrada.installationReceptoraId,
        installationRemotaId: entrada.installationEmisoraId,
        secreto: entrada.secretoPersistente,
        efectivoEnUtc: entrada.efectivoEnUtc
      }, { conexion, verificadorSecretos: this.verificadorSecretos });
    return Object.freeze({
      ...resultado,
      identidadCandidataPersistida: false
    });
  }
}

async function reemplazarMaterial(conexion, entrada) {
  await conexion.execute(
    `INSERT INTO credenciales_persistentes_federacion (
       relacion_id,tipo_material,perfil,version_credencial,
       installation_local_id,installation_remota_id,keyring_referencia,key_id,
       nonce,ciphertext,auth_tag,verificador_salt,verificador_digest,
       creada_en_utc,actualizada_en_utc
     ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
     ON DUPLICATE KEY UPDATE
       tipo_material=VALUES(tipo_material), perfil=VALUES(perfil),
       version_credencial=VALUES(version_credencial),
       installation_local_id=VALUES(installation_local_id),
       installation_remota_id=VALUES(installation_remota_id),
       keyring_referencia=VALUES(keyring_referencia), key_id=VALUES(key_id),
       nonce=VALUES(nonce), ciphertext=VALUES(ciphertext),
       auth_tag=VALUES(auth_tag), verificador_salt=VALUES(verificador_salt),
       verificador_digest=VALUES(verificador_digest),
       actualizada_en_utc=VALUES(actualizada_en_utc)`,
    [
      entrada.relacionId, entrada.tipoMaterial, entrada.perfil,
      entrada.versionCredencial, entrada.installationLocalId,
      entrada.installationRemotaId, entrada.keyringReferencia, entrada.keyId,
      entrada.nonce, entrada.ciphertext, entrada.authTag,
      entrada.verificadorSal, entrada.verificadorDigest,
      entrada.ahora, entrada.ahora
    ]
  );
}

async function bloquearRelacion(conexion, relacionId) {
  const [filas] = await conexion.execute(
    'SELECT relacion_id,direccion FROM relaciones_federacion WHERE relacion_id=? FOR UPDATE',
    [relacionId]
  );
  if (filas.length !== 1) throw new Error('La relación federada no existe.');
  return filas[0];
}

async function siguienteVersion(conexion, relacionId) {
  const [filas] = await conexion.execute(
    `SELECT version_credencial FROM credenciales_persistentes_federacion
      WHERE relacion_id=? FOR UPDATE`,
    [relacionId]
  );
  return filas.length === 0 ? 1 : Number(filas[0].version_credencial) + 1;
}

async function obtenerMaterial(clienteSql, relacionId) {
  const filas = await clienteSql.consultar(
    'SELECT * FROM credenciales_persistentes_federacion WHERE relacion_id=? LIMIT 1',
    [relacionId]
  );
  return filas[0] || null;
}

async function obtenerMetadatosSaneados(conexion, relacionId) {
  const [filas] = await conexion.execute(
    `SELECT relacion_id, tipo_material, perfil, version_credencial,
            installation_local_id, installation_remota_id, key_id,
            DATE_FORMAT(creada_en_utc, '%Y-%m-%dT%H:%i:%s.%fZ') AS creada_en_utc,
            DATE_FORMAT(actualizada_en_utc, '%Y-%m-%dT%H:%i:%s.%fZ') AS actualizada_en_utc
       FROM credenciales_persistentes_federacion
      WHERE relacion_id=? LIMIT 1`,
    [relacionId]
  );
  return filas[0];
}

async function ahoraSql(conexion) {
  const [filas] = await conexion.execute(
    "SELECT DATE_FORMAT(UTC_TIMESTAMP(3), '%Y-%m-%d %H:%i:%s.%f') AS ahora"
  );
  return filas[0].ahora;
}

function crearContexto(entrada, versionCredencial) {
  return crearContextoSecretoPersistenteFederacion({
    relacionId: entrada.relacionId,
    installationLocalId: entrada.installationLocalId,
    installationRemotaId: entrada.installationRemotaId,
    versionCredencial
  });
}

function exigirDireccion(relacion, direccion) {
  if (relacion.direccion !== direccion) {
    throw new Error(`La relación no admite material de ${direccion}.`);
  }
}

function sanearMetadatos(fila) {
  return Object.freeze({
    relacionId: fila.relacion_id || fila.relacionId,
    tipoMaterial: fila.tipo_material,
    perfil: fila.perfil,
    versionCredencial: Number(fila.version_credencial),
    installationLocalId: fila.installation_local_id || fila.installationLocalId,
    installationRemotaId: fila.installation_remota_id || fila.installationRemotaId,
    keyId: fila.key_id || null,
    creadaEnUtc: fila.creada_en_utc,
    actualizadaEnUtc: fila.actualizada_en_utc
  });
}

function exigirMetodo(valor, metodo, campo) {
  if (typeof valor?.[metodo] !== 'function') {
    throw new Error(`${campo} debe implementar ${metodo}().`);
  }
}

import { createHash } from 'node:crypto';

import { canonicalizarJsonFederacion } from '../src/CanonicalizadorFederacion.js';
import { crearOcurrenciaOrigenFederada } from '../src/EnvolventeFederacion.js';
import {
  listarReferenciasContenidoSensibleFederacion,
  restaurarContenidoSensibleFederacion,
  separarContenidoSensibleFederacion
} from '../src/SeparacionContenidoSensibleFederacion.js';
import {
  TIPOS_IDENTIDAD_FEDERADA,
  crearIdentidadFederada
} from '../src/IdentidadFederada.js';

const MAXIMO_BYTES_OCURRENCIA = 2 * 1024 * 1024;

export class ErrorInboxFederacion extends Error {
  constructor(codigo, mensaje) {
    super(mensaje);
    this.name = 'ErrorInboxFederacion';
    this.codigo = codigo;
  }
}

export class RepositorioInboxFederacionSql {
  constructor(clienteSql, { protectorContenidoSensible = null } = {}) {
    if (!clienteSql?.obtenerConexion) {
      throw new Error('La inbox federada requiere SQL operativo.');
    }
    this.clienteSql = clienteSql;
    this.protectorContenidoSensible = protectorContenidoSensible;
  }

  async recibir(entrada) {
    for (let intento = 1; intento <= 4; intento += 1) {
      try {
        return await this.#recibirUnaVez(entrada);
      } catch (error) {
        if (intento === 4 || !esConflictoTransaccionalReintentable(error)) throw error;
      }
    }
    throw new Error('Estado inalcanzable al reintentar la recepción federada.');
  }

  async #recibirUnaVez(entrada) {
    const conexion = await this.clienteSql.obtenerConexion();
    try {
      await conexion.beginTransaction();
      const resultado = await this.recibirEnTransaccion(entrada, { conexion });
      await conexion.commit();
      const { confirmable, ...datos } = resultado;
      return Object.freeze({
        ...datos,
        confirmada: confirmable,
        persistidaDurablemente: true
      });
    } catch (error) {
      try {
        await conexion.rollback();
      } catch {}
      throw error;
    } finally {
      conexion.release();
    }
  }

  async recibirEnTransaccion(entrada, { conexion } = {}) {
    exigirConexion(conexion);
    await exigirTransaccionActiva(conexion);
    rechazarContextoLocalRemoto(entrada);
    const ocurrencia = crearOcurrenciaOrigenFederada({
      ...entrada,
      installationOrigenId: rehidratarIdentidad(
        entrada?.installationOrigenId,
        TIPOS_IDENTIDAD_FEDERADA.INSTALACION
      ),
      elementoOrigenId: rehidratarIdentidad(
        entrada?.elementoOrigenId,
        TIPOS_IDENTIDAD_FEDERADA.ELEMENTO_ORIGEN
      ),
      ocurrenciaOrigenId: rehidratarIdentidad(
        entrada?.ocurrenciaOrigenId,
        TIPOS_IDENTIDAD_FEDERADA.OCURRENCIA_ORIGEN
      )
    });
    const datos = ocurrencia.toJSON();
    const canonicoOriginal = ocurrencia.canonicalizar();
    const bytes = Buffer.byteLength(canonicoOriginal, 'utf8');
    if (bytes > MAXIMO_BYTES_OCURRENCIA) {
      throw new ErrorInboxFederacion(
        'ocurrencia_excede_limite',
        'La ocurrencia supera el máximo físico de la inbox.'
      );
    }
    const hashOriginal = sha256(canonicoOriginal);
    const identidad = identidadDesde(datos);
    const separacion = separarContenidoSensibleFederacion(datos);
    if (separacion.contenidoSensible &&
        typeof this.protectorContenidoSensible?.cifrar !== 'function') {
      throw new ErrorInboxFederacion(
        'custodia_sensible_ausente',
        'La ocurrencia contiene campos sensibles y no existe custodia cifrada operativa.'
      );
    }
    const canonico = canonicalizarJsonFederacion(separacion.publico);
    const hashPublico = sha256(canonico);
    const ahora = await ahoraSql(conexion);
    let creada = false;
    try {
      await conexion.execute(
        `INSERT INTO inbox_ocurrencias_federacion (
           installation_origen_id,familia,elemento_origen_id,
           ocurrencia_origen_id,secuencia_elemento,payload_canonico,
           payload_sha256,estado_integridad,estado_procesamiento,
           veces_observada,recibida_en_utc,ultima_observacion_utc
         ) VALUES (?,?,?,?,?,?,?,'valida','pendiente',1,?,?)`,
        [
          identidad.installationOrigenId,
          identidad.familia,
          identidad.elementoOrigenId,
          identidad.ocurrenciaOrigenId,
          datos.secuenciaElemento,
          canonico,
          hashPublico,
          ahora,
          ahora
        ]
      );
      creada = true;
    } catch (error) {
      if (error?.code !== 'ER_DUP_ENTRY') throw error;
    }
    let fila = await bloquearIdentidad(conexion, identidad);
    let conflictoSecuencia = false;
    if (!fila && !creada) {
      fila = await bloquearSecuencia(conexion, {
        ...identidad,
        secuenciaElemento: datos.secuenciaElemento
      });
      conflictoSecuencia = Boolean(fila);
    }
    if (!fila) {
      throw new ErrorInboxFederacion(
        'inbox_inconsistente',
        'La identidad recibida no quedó disponible en la inbox.'
      );
    }
    if (creada) {
      if (separacion.contenidoSensible) {
        await guardarContenidoSensible(conexion, {
          inboxId: fila.id,
          identidad,
          contenido: separacion.contenidoSensible,
          hashOriginal,
          protector: this.protectorContenidoSensible,
          ahora
        });
      }
      return respuesta(fila, 'aceptada', true);
    }

    if (
      !conflictoSecuencia &&
      Buffer.from(fila.payload_sha256).equals(hashPublico) &&
      coincideContenidoSensible(fila, separacion, hashOriginal) &&
      fila.payload_canonico === canonico
    ) {
      await conexion.execute(
        `UPDATE inbox_ocurrencias_federacion
            SET veces_observada=veces_observada+1,
                ultima_observacion_utc=GREATEST(ultima_observacion_utc,?)
          WHERE id=?`,
        [ahora, fila.id]
      );
      const repetida = await bloquearPorId(conexion, fila.id);
      return respuesta(repetida, 'yaConocida', true);
    }

    if (!conflictoSecuencia && await sonVistasComplementariasCompatibles(
      conexion,
      {
        fila,
        datos,
        publicoEntrante: separacion.publico,
        protector: this.protectorContenidoSensible
      }
    )) {
      await conexion.execute(
        `UPDATE inbox_ocurrencias_federacion
            SET veces_observada=veces_observada+1,
                ultima_observacion_utc=GREATEST(ultima_observacion_utc,?)
          WHERE id=?`,
        [ahora, fila.id]
      );
      const complementaria = await bloquearPorId(conexion, fila.id);
      return respuesta(complementaria, 'yaConocida', true);
    }

    const conflictoId = await registrarConflicto(
      conexion,
      fila.id,
      {
        canonico,
        hash: hashPublico,
        hashContenido: hashOriginal,
        contenidoSensible: separacion.contenidoSensible,
        protector: this.protectorContenidoSensible,
        ahora
      }
    );
    if (conflictoSecuencia) {
      await conexion.execute(
        `UPDATE inbox_ocurrencias_federacion
            SET estado_integridad='conflictiva'
          WHERE id=?`,
        [fila.id]
      );
    } else {
      await conexion.execute(
        `UPDATE inbox_ocurrencias_federacion
            SET estado_integridad='conflictiva',
                veces_observada=veces_observada+1,
                ultima_observacion_utc=GREATEST(ultima_observacion_utc,?)
          WHERE id=?`,
        [ahora, fila.id]
      );
    }
    const conflictiva = await bloquearPorId(conexion, fila.id);
    return respuesta(
      conflictiva,
      'divergenciaContenido',
      false,
      conflictoSecuencia ? identidad : null,
      conflictoId
    );
  }

  async obtenerOcurrenciaMaterializable(inboxId) {
    const filas = await this.clienteSql.consultar(
      `SELECT i.payload_canonico,i.payload_sha256,
              s.perfil,s.keyring_referencia,s.key_id,s.nonce,
              s.ciphertext,s.auth_tag,s.contenido_sha256
         FROM inbox_ocurrencias_federacion i
         LEFT JOIN secretos_inbox_federacion s ON s.inbox_ocurrencia_id=i.id
        WHERE i.id=?`,
      [inboxId]
    );
    if (!filas[0]) return null;
    const publico = JSON.parse(String(filas[0].payload_canonico));
    const referencias = listarReferenciasContenidoSensibleFederacion(publico);
    if (referencias.length === 0) return publico;
    if (!filas[0].perfil || typeof this.protectorContenidoSensible?.descifrar !== 'function') {
      throw new ErrorInboxFederacion(
        'contenido_sensible_purgado',
        'El contenido sensible ya no está disponible para materialización.'
      );
    }
    const identidad = identidadDesde(publico);
    const sensible = this.protectorContenidoSensible.descifrar({
      sobre: {
        perfil: filas[0].perfil,
        keyringReferencia: filas[0].keyring_referencia,
        keyId: filas[0].key_id,
        nonce: Buffer.from(filas[0].nonce),
        ciphertext: Buffer.from(filas[0].ciphertext),
        authTag: Buffer.from(filas[0].auth_tag)
      },
      aad: contextoContenidoSensible(identidad)
    });
    let completa;
    try {
      completa = restaurarContenidoSensibleFederacion(publico, sensible);
    } catch {
      throw new ErrorInboxFederacion(
        'contenido_sensible_incompleto',
        'La custodia sensible no contiene todos los campos referenciados.'
      );
    }
    const canonico = canonicalizarJsonFederacion(completa);
    if (!Buffer.from(filas[0].contenido_sha256).equals(sha256(canonico))) {
      throw new ErrorInboxFederacion(
        'contenido_sensible_divergente',
        'El contenido sensible recuperado no coincide con la ocurrencia aceptada.'
      );
    }
    return completa;
  }

  async purgarContenidoSensible(inboxId) {
    const [resultado] = await this.clienteSql.ejecutar(
      'DELETE FROM secretos_inbox_federacion WHERE inbox_ocurrencia_id=?',
      [inboxId]
    );
    return Object.freeze({ purgado: resultado.affectedRows === 1 });
  }
}

async function sonVistasComplementariasCompatibles(conexion, {
  fila,
  datos,
  publicoEntrante,
  protector
}) {
  let publicaPersistida;
  try {
    publicaPersistida = JSON.parse(String(fila.payload_canonico));
  } catch {
    return false;
  }
  if (canonicalizarJsonFederacion(metadatosComunes(publicaPersistida)) !==
      canonicalizarJsonFederacion(metadatosComunes(publicoEntrante))) {
    return false;
  }
  for (const [nombre, declaracion] of Object.entries(datos.campos || {})) {
    if (declaracion?.estado === 'omitido') continue;
    const [filas] = await conexion.execute(
      `SELECT * FROM declaraciones_campos_inbox_federacion
        WHERE inbox_ocurrencia_id=? AND nombre_sha256=? FOR UPDATE`,
      [fila.id, sha256(nombre)]
    );
    const existente = filas[0];
    if (!existente) {
      const declaracionPersistida = publicaPersistida.campos?.[nombre];
      if (!declaracionPersistida || declaracionPersistida.estado === 'omitido') {
        continue;
      }
      if (declaracionPersistida.sensibilidad === 'sensible' ||
          declaracion.sensibilidad === 'sensible') {
        return false;
      }
      if (canonicalizarJsonFederacion(declaracionPersistida) !==
          canonicalizarJsonFederacion(publicoEntrante.campos?.[nombre])) {
        return false;
      }
      continue;
    }
    if (existente.nombre_campo !== nombre || existente.estado !== declaracion.estado) {
      return false;
    }
    let declaracionExistente;
    if (existente.sensibilidad === 'sensible') {
      if (typeof protector?.descifrar !== 'function') return false;
      try {
        declaracionExistente = protector.descifrar({
          sobre: {
            perfil: existente.perfil_custodia,
            keyringReferencia: existente.keyring_referencia,
            keyId: existente.key_id,
            nonce: existente.nonce,
            ciphertext: existente.ciphertext,
            authTag: existente.auth_tag
          },
          aad: {
            perfil: 'sentinelia-federacion-campo-inbox-v1',
            inboxId: String(fila.id),
            nombre
          }
        });
      } catch {
        return false;
      }
    } else {
      declaracionExistente = JSON.parse(
        String(existente.declaracion_publica_canonica)
      );
    }
    if (canonicalizarJsonFederacion(declaracionExistente) !==
        canonicalizarJsonFederacion(declaracion)) {
      return false;
    }
  }
  return true;
}

function metadatosComunes(ocurrencia) {
  return {
    ...ocurrencia,
    campos: {},
    evidenciaIntegridad: []
  };
}

function rechazarContextoLocalRemoto(entrada) {
  if (!entrada || typeof entrada !== 'object') return;
  const prohibidas = [
    'proyeccionId',
    'scopeLocalRecepcion',
    'contextoLocalProyeccion'
  ];
  const encontrada = prohibidas.find((campo) =>
    Object.prototype.hasOwnProperty.call(entrada, campo));
  if (encontrada) {
    throw new ErrorInboxFederacion(
      'contexto_local_remoto_prohibido',
      `${encontrada} pertenece al receptor y no puede aceptarse desde la ocurrencia.`
    );
  }
}

function esConflictoTransaccionalReintentable(error) {
  return error?.code === 'ER_LOCK_DEADLOCK' ||
    error?.code === 'ER_LOCK_WAIT_TIMEOUT' ||
    error?.sqlState === '40001';
}

async function guardarContenidoSensible(conexion, {
  inboxId, identidad, contenido, hashOriginal, protector, ahora
}) {
  const sobre = protector.cifrar({
    contenido,
    aad: contextoContenidoSensible(identidad)
  });
  await conexion.execute(
    `INSERT INTO secretos_inbox_federacion (
       inbox_ocurrencia_id,perfil,keyring_referencia,key_id,nonce,
       ciphertext,auth_tag,contenido_sha256,creado_en_utc
     ) VALUES (?,?,?,?,?,?,?,?,?)`,
    [
      inboxId, sobre.perfil, sobre.keyringReferencia, sobre.keyId,
      sobre.nonce, sobre.ciphertext, sobre.authTag, hashOriginal, ahora
    ]
  );
}

function coincideContenidoSensible(fila, separacion, hashOriginal) {
  if (!separacion.contenidoSensible) return fila.contenido_sensible_sha256 === null;
  if (fila.contenido_sensible_sha256 === null) {
    // Una purga deliberada conserva identidad y representación saneada. Un
    // replay no puede restaurar el secreto ni necesita volver a reconocerlo.
    return true;
  }
  return Buffer.from(fila.contenido_sensible_sha256).equals(hashOriginal);
}

function contextoContenidoSensible(identidad) {
  return {
    perfil: 'sentinelia-federacion-contexto-contenido-sensible-v1',
    ...identidad
  };
}

function sha256(texto) {
  return createHash('sha256').update(texto, 'utf8').digest();
}

async function registrarConflicto(conexion, inboxId, {
  canonico,
  hash,
  hashContenido,
  contenidoSensible,
  protector,
  ahora
}) {
  const [existentes] = await conexion.execute(
    `SELECT id FROM conflictos_contenido_inbox_federacion
      WHERE inbox_ocurrencia_id=? AND payload_observado_sha256=?
        AND (
          contenido_observado_sha256=?
          OR (contenido_observado_sha256 IS NULL
            AND contenido_sensible_purgado_en_utc IS NOT NULL)
        )
        AND payload_observado_canonico=?
      LIMIT 1 FOR UPDATE`,
    [inboxId, hash, hashContenido, canonico]
  );
  if (existentes[0]) {
    await conexion.execute(
      `UPDATE conflictos_contenido_inbox_federacion
          SET veces_observado=veces_observado+1,
              ultima_observacion_utc=GREATEST(ultima_observacion_utc,?)
        WHERE id=?`,
      [ahora, existentes[0].id]
    );
    return String(existentes[0].id);
  }
  const [insercion] = await conexion.execute(
    `INSERT INTO conflictos_contenido_inbox_federacion (
       inbox_ocurrencia_id,payload_observado_canonico,
       payload_observado_sha256,contenido_observado_sha256,veces_observado,
       primera_observacion_utc,ultima_observacion_utc
     ) VALUES (?,?,?,?,1,?,?)`,
    [inboxId, canonico, hash, hashContenido, ahora, ahora]
  );
  const conflictoId = String(insercion.insertId);
  if (contenidoSensible) {
    const sobre = protector.cifrar({
      contenido: contenidoSensible,
      aad: {
        perfil: 'sentinelia-federacion-conflicto-inbox-v1',
        inboxId: String(inboxId),
        conflictoId
      }
    });
    await conexion.execute(
      `INSERT INTO secretos_conflictos_inbox_federacion (
         conflicto_inbox_id,perfil,keyring_referencia,key_id,nonce,
         ciphertext,auth_tag,contenido_sha256,creado_en_utc
       ) VALUES (?,?,?,?,?,?,?,?,?)`,
      [
        conflictoId,
        sobre.perfil,
        sobre.keyringReferencia,
        sobre.keyId,
        sobre.nonce,
        sobre.ciphertext,
        sobre.authTag,
        hashContenido,
        ahora
      ]
    );
  }
  return conflictoId;
}

async function bloquearIdentidad(conexion, identidad) {
  const [filas] = await conexion.execute(
    `SELECT i.*,s.contenido_sha256 AS contenido_sensible_sha256
       FROM inbox_ocurrencias_federacion i
       LEFT JOIN secretos_inbox_federacion s ON s.inbox_ocurrencia_id=i.id
      WHERE i.installation_origen_id=? AND i.familia=?
        AND i.elemento_origen_id=? AND i.ocurrencia_origen_id=?
      FOR UPDATE`,
    [
      identidad.installationOrigenId,
      identidad.familia,
      identidad.elementoOrigenId,
      identidad.ocurrenciaOrigenId
    ]
  );
  return filas[0] || null;
}

async function bloquearPorId(conexion, id) {
  const [filas] = await conexion.execute(
    `SELECT i.*,s.contenido_sha256 AS contenido_sensible_sha256
       FROM inbox_ocurrencias_federacion i
       LEFT JOIN secretos_inbox_federacion s ON s.inbox_ocurrencia_id=i.id
      WHERE i.id=? FOR UPDATE`,
    [id]
  );
  return filas[0] || null;
}

async function bloquearSecuencia(conexion, identidad) {
  const [filas] = await conexion.execute(
    `SELECT i.*,s.contenido_sha256 AS contenido_sensible_sha256
       FROM inbox_ocurrencias_federacion i
       LEFT JOIN secretos_inbox_federacion s ON s.inbox_ocurrencia_id=i.id
      WHERE i.installation_origen_id=? AND i.familia=?
        AND i.elemento_origen_id=? AND i.secuencia_elemento=?
      FOR UPDATE`,
    [
      identidad.installationOrigenId,
      identidad.familia,
      identidad.elementoOrigenId,
      identidad.secuenciaElemento
    ]
  );
  return filas[0] || null;
}

function respuesta(
  fila,
  codigo,
  confirmable,
  identidadAlternativa = null,
  conflictoId = null
) {
  const identidad = identidadAlternativa ?? {
    installationOrigenId: fila.installation_origen_id,
    familia: fila.familia,
    elementoOrigenId: fila.elemento_origen_id,
    ocurrenciaOrigenId: fila.ocurrencia_origen_id
  };
  return Object.freeze({
    inboxId: String(fila.id),
    codigo,
    confirmable,
    ...(conflictoId === null ? {} : { conflictoId }),
    confirmada: false,
    persistidaDurablemente: false,
    identidad: Object.freeze({
      ...identidad
    }),
    secuenciaElemento: String(fila.secuencia_elemento),
    estadoIntegridad: fila.estado_integridad,
    estadoProcesamiento: fila.estado_procesamiento,
    vecesObservada: String(fila.veces_observada)
  });
}

function identidadDesde(datos) {
  return {
    installationOrigenId: datos.installationOrigenId,
    familia: datos.familia,
    elementoOrigenId: datos.elementoOrigenId,
    ocurrenciaOrigenId: datos.ocurrenciaOrigenId
  };
}

function rehidratarIdentidad(valor, tipo) {
  return crearIdentidadFederada({ tipo, valor: String(valor ?? '') });
}

function exigirConexion(conexion) {
  if (!conexion?.execute || !conexion?.query) {
    throw new ErrorInboxFederacion(
      'transaccion_prestada_ausente',
      'La inbox exige una conexión SQL prestada.'
    );
  }
}

async function exigirTransaccionActiva(conexion) {
  const [filas] = await conexion.query('SELECT @@in_transaction AS activa');
  if (!Boolean(filas[0]?.activa)) {
    throw new ErrorInboxFederacion(
      'transaccion_prestada_inactiva',
      'La recepción solo puede aceptar dentro de una transacción activa.'
    );
  }
}

async function ahoraSql(conexion) {
  const [filas] = await conexion.query('SELECT UTC_TIMESTAMP(3) AS ahora');
  return filas[0].ahora;
}

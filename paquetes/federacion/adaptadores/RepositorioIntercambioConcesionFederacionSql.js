import { createHash } from 'node:crypto';

import {
  bytesAUuidV7Auditoria,
  uuidV7AuditoriaABytes
} from '../../auditoria/src/UuidV7Auditoria.js';
import { canonicalizarJsonFederacion } from '../src/CanonicalizadorFederacion.js';
import { VERSION_PROTOCOLO_FEDERACION } from '../src/CatalogosFederacion.js';
import {
  PERFIL_INTERCAMBIO_DECLARACION_CONCESION_FEDERACION,
  validarIntercambioDeclaracionConcesionFederacion
} from '../src/IntercambioDeclaracionConcesionFederacion.js';

export class ErrorRepositorioIntercambioConcesionFederacion extends Error {
  constructor(codigo, mensaje, { statusCode = 409 } = {}) {
    super(mensaje);
    this.name = 'ErrorRepositorioIntercambioConcesionFederacion';
    this.codigo = codigo;
    this.statusCode = statusCode;
  }
}

export class RepositorioIntercambioConcesionFederacionSql {
  constructor(clienteSql) {
    if (typeof clienteSql?.obtenerConexion !== 'function' ||
        typeof clienteSql?.consultar !== 'function') {
      throw new Error('El intercambio de concesión requiere SQL operativo.');
    }
    this.clienteSql = clienteSql;
  }

  async prepararSalida({ relacionId, installationLocalId, intercambioId } = {}) {
    const conexion = await this.clienteSql.obtenerConexion();
    try {
      await conexion.beginTransaction();
      const relacion = await bloquearRelacion(conexion, relacionId);
      const papel = relacion.direccion === 'emision' ? 'oferta' : 'aceptacion';
      validarRelacionEmisoraDeclaracion(relacion, installationLocalId, papel);
      const revisionId = relacion.direccion === 'emision'
        ? relacion.revision_oferta_actual_id
        : relacion.revision_aceptacion_actual_id;
      if (!revisionId) {
        await conexion.commit();
        return null;
      }
      const [existentes] = await conexion.execute(
        `SELECT * FROM intercambios_declaraciones_concesion_federacion
          WHERE direccion='saliente' AND relacion_id=? AND revision_origen_id=?
          LIMIT 1 FOR UPDATE`,
        [relacionId, revisionId]
      );
      if (existentes[0]) {
        await conexion.commit();
        return declaracionSalida(existentes[0]);
      }
      const [revisiones] = await conexion.execute(
        `SELECT revision_id,ordinal,version_autoridad,seleccion
           FROM revisiones_concesion_federacion
          WHERE revision_id=? AND relacion_id=? AND papel=?
            AND procedencia='local' LIMIT 1 FOR UPDATE`,
        [revisionId, relacionId, papel]
      );
      if (!revisiones[0]) {
        fallar('REVISION_LOCAL_CONCESION_NO_DISPONIBLE',
          'La declaración local vigente no es publicable.', 409);
      }
      const revision = revisiones[0];
      const seleccion = typeof revision.seleccion === 'string'
        ? JSON.parse(revision.seleccion)
        : revision.seleccion;
      const canonica = canonicalizarJsonFederacion(seleccion);
      const huella = createHash('sha256').update(canonica).digest('hex');
      const ahora = await ahoraSql(conexion);
      await conexion.execute(
        `INSERT INTO intercambios_declaraciones_concesion_federacion (
          intercambio_id,direccion,relacion_id,installation_emisora_id,
          installation_receptora_id,papel,revision_origen_id,revision_ordinal,
          version_autoridad,protocolo_version,seleccion,huella_seleccion,
          emitida_en_origen_utc,estado,confirmacion_id,creada_en_utc,confirmada_en_utc
        ) VALUES (?, 'saliente', ?, ?, ?, ?, ?, ?, ?, ?, ?, UNHEX(?), ?,
          'pendiente', NULL, ?, NULL)`,
        [
          uuidV7AuditoriaABytes(intercambioId, 'intercambioId'), relacionId,
          installationLocalId, relacion.installation_remota_id, papel,
          revision.revision_id, String(revision.ordinal),
          String(revision.version_autoridad), VERSION_PROTOCOLO_FEDERACION,
          canonica, huella, ahora, ahora
        ]
      );
      const fila = await buscarPorIntercambio(conexion, intercambioId, relacionId);
      await conexion.commit();
      return declaracionSalida(fila);
    } catch (error) {
      try { await conexion.rollback(); } catch {}
      throw error;
    } finally {
      conexion.release();
    }
  }

  async confirmarSalida({ declaracion, confirmacion } = {}) {
    const confirmacionId = uuidV7AuditoriaABytes(
      confirmacion?.confirmacionId,
      'confirmacionId'
    );
    const conexion = await this.clienteSql.obtenerConexion();
    try {
      await conexion.beginTransaction();
      const fila = await buscarPorIntercambio(
        conexion,
        declaracion.intercambioId,
        declaracion.relacionId
      );
      if (!fila || fila.direccion !== 'saliente') {
        fallar('INTERCAMBIO_SALIENTE_NO_ENCONTRADO',
          'No existe la publicación saliente que debe confirmarse.', 409);
      }
      if (confirmacion?.ok !== true ||
          confirmacion.intercambioId !== declaracion.intercambioId ||
          confirmacion.relacionId !== declaracion.relacionId ||
          confirmacion.revisionId !== declaracion.revisionId ||
          confirmacion.huellaSeleccion !== createHash('sha256')
            .update(canonicalizarJsonFederacion(declaracion.seleccion))
            .digest('hex')) {
        fallar('CONFIRMACION_CONCESION_DIVERGENTE',
          'La contraparte confirmó otra declaración.', 409);
      }
      if (fila.estado === 'confirmada') {
        if (!Buffer.from(fila.confirmacion_id).equals(confirmacionId)) {
          fallar('CONFIRMACION_CONCESION_DIVERGENTE',
            'La publicación ya posee otra confirmación.', 409);
        }
        await conexion.commit();
        return respuesta(fila, 'yaConocida');
      }
      const ahora = await ahoraSql(conexion);
      await conexion.execute(
        `UPDATE intercambios_declaraciones_concesion_federacion
            SET estado='confirmada',confirmacion_id=?,confirmada_en_utc=?
          WHERE intercambio_id=? AND direccion='saliente' AND estado='pendiente'`,
        [confirmacionId, ahora,
          uuidV7AuditoriaABytes(declaracion.intercambioId, 'intercambioId')]
      );
      const confirmada = await buscarPorIntercambio(
        conexion,
        declaracion.intercambioId,
        declaracion.relacionId
      );
      await conexion.commit();
      return respuesta(confirmada, 'confirmada');
    } catch (error) {
      try { await conexion.rollback(); } catch {}
      throw error;
    } finally {
      conexion.release();
    }
  }

  async recibir({ declaracion, confirmacionId } = {}) {
    return this.#recibir({ declaracion, confirmacionId }, false);
  }

  async #recibir({ declaracion, confirmacionId }, reintentoDuplicado) {
    const conexion = await this.clienteSql.obtenerConexion();
    try {
      await conexion.beginTransaction();
      const relacion = await bloquearRelacion(conexion, declaracion.relacionId);
      validarRelacionReceptora(relacion, declaracion);
      const existente = await buscarExistente(conexion, declaracion);
      if (existente) {
        validarReplay(existente, declaracion);
        await conexion.commit();
        return respuesta(existente, 'yaConocida');
      }
      const ahora = await ahoraSql(conexion);
      await conexion.execute(
        `INSERT INTO intercambios_declaraciones_concesion_federacion (
          intercambio_id,direccion,relacion_id,installation_emisora_id,
          installation_receptora_id,papel,revision_origen_id,revision_ordinal,version_autoridad,
          protocolo_version,seleccion,huella_seleccion,emitida_en_origen_utc,
          estado,confirmacion_id,creada_en_utc,confirmada_en_utc
        ) VALUES (?, 'entrante', ?, ?, ?, ?, ?, ?, ?, ?, ?,
          UNHEX(?), ?, 'confirmada', ?, ?, ?)`,
        [
          uuidV7AuditoriaABytes(declaracion.intercambioId, 'intercambioId'),
          declaracion.relacionId,
          declaracion.installationEmisoraId,
          declaracion.installationReceptoraId,
          declaracion.papel,
          declaracion.revisionId,
          declaracion.revisionOrdinal,
          declaracion.versionAutoridad,
          declaracion.protocoloVersion,
          canonicalizarJsonFederacion(declaracion.seleccion),
          declaracion.huellaSeleccion,
          fechaSql(declaracion.emitidaEnUtc),
          uuidV7AuditoriaABytes(confirmacionId, 'confirmacionId'),
          ahora,
          ahora
        ]
      );
      const fila = await buscarPorIntercambio(
        conexion,
        declaracion.intercambioId,
        declaracion.relacionId
      );
      await conexion.commit();
      return respuesta(fila, 'persistida');
    } catch (error) {
      try { await conexion.rollback(); } catch {}
      if (error?.code === 'ER_DUP_ENTRY' && !reintentoDuplicado) {
        return this.#recibir({ declaracion, confirmacionId }, true);
      }
      throw error;
    } finally {
      conexion.release();
    }
  }

  async consultarConfirmacion({ relacionId, intercambioId } = {}) {
    const filas = await this.clienteSql.consultar(
      `SELECT * FROM intercambios_declaraciones_concesion_federacion
       WHERE intercambio_id=? AND relacion_id=? AND direccion='entrante'
       LIMIT 1`,
      [uuidV7AuditoriaABytes(intercambioId, 'intercambioId'), relacionId]
    );
    return filas[0] ? respuesta(filas[0], 'yaConocida') : null;
  }
}

async function bloquearRelacion(conexion, relacionId) {
  const [filas] = await conexion.execute(
    `SELECT r.*,ec.revision_oferta_actual_id,ec.revision_aceptacion_actual_id
       FROM relaciones_federacion r
       LEFT JOIN estado_concesion_relaciones_federacion ec
         ON ec.relacion_id=r.relacion_id
      WHERE r.relacion_id=? FOR UPDATE`,
    [relacionId]
  );
  if (!filas[0]) fallar('RELACION_CONCESION_NO_ENCONTRADA',
    'La relación federada no existe.', 409);
  return filas[0];
}

function validarRelacionEmisoraDeclaracion(relacion, installationLocalId, papel) {
  if (relacion.estado_ciclo !== 'vinculada' ||
      relacion.estado_autoridad !== 'autorizada' ||
      relacion.estado_identidad !== 'valida' ||
      relacion.estado_compatibilidad !== 'compatible') {
    fallar('RELACION_CONCESION_NO_OPERATIVA',
      'La relación no permite publicar su declaración local.', 409);
  }
  if (typeof installationLocalId !== 'string' ||
      !/^sfid1\.instalacion\.[A-Za-z0-9_-]{21}[AQgw]$/u.test(installationLocalId) ||
      !relacion.installation_remota_id ||
      !['oferta', 'aceptacion'].includes(papel)) {
    fallar('IDENTIDAD_INTERCAMBIO_FEDERACION_INVALIDA',
      'La publicación no posee identidades federadas completas.', 409);
  }
}

function validarRelacionReceptora(relacion, declaracion) {
  if (relacion.estado_ciclo !== 'vinculada' ||
      relacion.estado_autoridad !== 'autorizada' ||
      relacion.estado_identidad !== 'valida') {
    fallar('RELACION_CONCESION_NO_OPERATIVA',
      'La relación no admite declaraciones de concesión.', 409);
  }
  if (relacion.estado_compatibilidad !== 'compatible') {
    fallar('VERSION_PROTOCOLO_FEDERACION_INCOMPATIBLE',
      'La relación no posee compatibilidad exacta.', 409);
  }
  if (String(relacion.installation_remota_id) !== declaracion.installationEmisoraId) {
    fallar('INSTALACION_DECLARACION_NO_AUTORIZADA',
      'La declaración no procede de la instalación vinculada.', 403);
  }
  const papelEsperado = relacion.direccion === 'emision' ? 'aceptacion' : 'oferta';
  if (declaracion.papel !== papelEsperado) {
    fallar('PAPEL_DECLARACION_NO_AUTORIZADO',
      'La dirección de la relación no admite ese papel remoto.', 409);
  }
}

async function buscarExistente(conexion, declaracion) {
  const [filas] = await conexion.execute(
    `SELECT * FROM intercambios_declaraciones_concesion_federacion
     WHERE (intercambio_id=? OR
       (direccion='entrante' AND relacion_id=? AND revision_origen_id=?) OR
       (direccion='entrante' AND relacion_id=? AND papel=?
        AND version_autoridad=? AND revision_ordinal=?))
     LIMIT 1 FOR UPDATE`,
    [
      uuidV7AuditoriaABytes(declaracion.intercambioId, 'intercambioId'),
      declaracion.relacionId,
      declaracion.revisionId,
      declaracion.relacionId,
      declaracion.papel,
      declaracion.versionAutoridad,
      declaracion.revisionOrdinal
    ]
  );
  return filas[0] || null;
}

async function buscarPorIntercambio(conexion, intercambioId, relacionId) {
  const [filas] = await conexion.execute(
    `SELECT * FROM intercambios_declaraciones_concesion_federacion
     WHERE intercambio_id=? AND relacion_id=? LIMIT 1`,
    [uuidV7AuditoriaABytes(intercambioId), relacionId]
  );
  return filas[0];
}

function validarReplay(fila, declaracion) {
  const huella = createHash('sha256')
    .update(canonicalizarJsonFederacion(declaracion.seleccion))
    .digest();
  const coincide = fila.direccion === 'entrante' &&
    bytesAUuidV7Auditoria(fila.intercambio_id, 'intercambioId') ===
      declaracion.intercambioId &&
    fila.relacion_id === declaracion.relacionId &&
    fila.installation_emisora_id === declaracion.installationEmisoraId &&
    fila.installation_receptora_id === declaracion.installationReceptoraId &&
    fila.papel === declaracion.papel &&
    fila.revision_origen_id === declaracion.revisionId &&
    String(fila.revision_ordinal) === declaracion.revisionOrdinal &&
    String(fila.version_autoridad) === declaracion.versionAutoridad &&
    Number(fila.protocolo_version) === declaracion.protocoloVersion &&
    iso(fila.emitida_en_origen_utc) === declaracion.emitidaEnUtc &&
    Buffer.from(fila.huella_seleccion).equals(huella);
  if (!coincide) {
    fallar('REPLAY_DECLARACION_FEDERACION_DIVERGENTE',
      'La identidad de intercambio o revisión ya pertenece a otro contenido.', 409);
  }
}

function respuesta(fila, estadoRecepcion) {
  return Object.freeze({
    ok: true,
    intercambioId: bytesAUuidV7Auditoria(fila.intercambio_id, 'intercambioId'),
    relacionId: fila.relacion_id,
    revisionId: fila.revision_origen_id,
    estado: estadoRecepcion,
    confirmacionId: bytesAUuidV7Auditoria(fila.confirmacion_id, 'confirmacionId'),
    recibidaEnUtc: iso(fila.confirmada_en_utc),
    huellaSeleccion: Buffer.from(fila.huella_seleccion).toString('hex')
  });
}

function declaracionSalida(fila) {
  const seleccion = typeof fila.seleccion === 'string'
    ? JSON.parse(fila.seleccion)
    : fila.seleccion;
  const validada = validarIntercambioDeclaracionConcesionFederacion({
    perfil: PERFIL_INTERCAMBIO_DECLARACION_CONCESION_FEDERACION,
    protocoloVersion: Number(fila.protocolo_version),
    intercambioId: bytesAUuidV7Auditoria(fila.intercambio_id, 'intercambioId'),
    relacionId: fila.relacion_id,
    installationEmisoraId: fila.installation_emisora_id,
    installationReceptoraId: fila.installation_receptora_id,
    papel: fila.papel,
    revisionId: fila.revision_origen_id,
    revisionOrdinal: String(fila.revision_ordinal),
    versionAutoridad: String(fila.version_autoridad),
    seleccion,
    emitidaEnUtc: iso(fila.emitida_en_origen_utc)
  });
  const { huellaSeleccion: _huellaInterna, ...transportable } = validada;
  return Object.freeze(transportable);
}

async function ahoraSql(conexion) {
  const [filas] = await conexion.execute(
    "SELECT DATE_FORMAT(UTC_TIMESTAMP(3),'%Y-%m-%dT%H:%i:%s.%fZ') AS ahora"
  );
  return String(filas[0].ahora).replace(/(\.\d{3})\d+Z$/u, '$1Z')
    .replace('T', ' ').replace('Z', '');
}

function iso(valor) {
  if (valor instanceof Date) return valor.toISOString();
  const texto = String(valor).replace(' ', 'T');
  return new Date(texto.endsWith('Z') ? texto : `${texto}Z`).toISOString();
}

function fechaSql(valor) {
  return valor.slice(0, 23).replace('T', ' ').replace('Z', '');
}

function fallar(codigo, mensaje, statusCode) {
  throw new ErrorRepositorioIntercambioConcesionFederacion(
    codigo,
    mensaje,
    { statusCode }
  );
}

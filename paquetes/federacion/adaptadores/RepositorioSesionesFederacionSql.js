import { createHash } from 'node:crypto';

import {
  bytesAUuidV7Auditoria,
  uuidV7AuditoriaABytes
} from '../../auditoria/src/UuidV7Auditoria.js';
import { canonicalizarJsonFederacion } from '../src/CanonicalizadorFederacion.js';

const ESTADOS_AUTENTICABLES = new Set(['pendienteAutenticacion', 'vinculada']);

export class RepositorioSesionesFederacionSql {
  constructor(clienteSql, {
    repositorioCredenciales,
    verificadorSecretos,
    adaptadorAuditoria = null
  } = {}) {
    if (!clienteSql?.obtenerConexion || !clienteSql?.ejecutar) {
      throw new Error('Las sesiones federadas requieren SQL operativo.');
    }
    exigirMetodo(
      repositorioCredenciales,
      'verificarSecretoReceptorEnTransaccion',
      'repositorioCredenciales'
    );
    exigirMetodo(verificadorSecretos, 'verificar', 'verificadorSecretos');
    this.clienteSql = clienteSql;
    this.repositorioCredenciales = repositorioCredenciales;
    this.verificadorSecretos = verificadorSecretos;
    this.adaptadorAuditoria = adaptadorAuditoria;
  }

  reservarLogin(entrada) {
    return this.#reservar({ ...entrada, tipo: 'login' }, { verificarSecreto: true });
  }

  reservarRefresh(entrada) {
    return this.#reservar({ ...entrada, tipo: 'refresh' }, { verificarSecreto: false });
  }

  async consolidar(entrada) {
    return this.#transaccion(async (conexion) => {
      const operacion = await bloquearOperacion(conexion, entrada.operacionId);
      exigirMismaOperacion(operacion, entrada);
      if (operacion.estado === 'consolidada') return sanearOperacion(operacion, true);
      if (operacion.estado !== 'reservada') {
        throw new Error('La operación de sesión ya es terminal.');
      }
      const ahora = await ahoraSql(conexion);
      const [resultado] = await conexion.execute(
        `UPDATE operaciones_sesion_federacion
            SET estado='consolidada', consolidada_en_utc=?
          WHERE operacion_id=? AND estado='reservada'`,
        [ahora, uuidV7AuditoriaABytes(entrada.operacionId, 'operacionId')]
      );
      if (Number(resultado.affectedRows) !== 1) throw conflictoConcurrente();
      if (entrada.tipo === 'login') {
        if (typeof this.adaptadorAuditoria?.registrarLoginEnTransaccion !== 'function') {
          throw new Error('El login federado exige auditoría transaccional.');
        }
        await this.adaptadorAuditoria.registrarLoginEnTransaccion({
          eventoId: entrada.eventoId,
          requestId: entrada.requestId,
          relacionId: operacion.relacion_id,
          installationRemotaId: operacion.installation_remota_id,
          scope: scopeRelacion(await bloquearRelacion(conexion, operacion.relacion_id)),
          efectivoEnUtc: ahora
        }, { conexion });
      }
      return Object.freeze({ ...sanearOperacion(operacion), estado: 'consolidada' });
    });
  }

  async marcarFallida(operacionId) {
    await this.clienteSql.ejecutar(
      `UPDATE operaciones_sesion_federacion
          SET estado='fallida', consolidada_en_utc=UTC_TIMESTAMP(3)
        WHERE operacion_id=? AND estado='reservada'`,
      [uuidV7AuditoriaABytes(operacionId, 'operacionId')]
    );
  }

  async validarAutoridadSesion(contexto, { permitirFencingAnterior = false } = {}) {
    const filas = await this.clienteSql.consultar(
      `SELECT r.direccion,r.estado_ciclo,r.estado_autoridad,r.estado_identidad,
              r.installation_remota_id,e.fencing_token,e.version_revocacion
         FROM relaciones_federacion r
         JOIN estado_sesiones_federacion e ON e.relacion_id=r.relacion_id
        WHERE r.relacion_id=? LIMIT 1`,
      [contexto.relacionId]
    );
    const fila = filas[0];
    return Boolean(
      fila && fila.direccion === 'recepcion' &&
      ESTADOS_AUTENTICABLES.has(fila.estado_ciclo) &&
      fila.estado_autoridad === 'autorizada' && fila.estado_identidad === 'valida' &&
      fila.installation_remota_id === contexto.installationRemotaId &&
      (permitirFencingAnterior
        ? compararDecimal(fila.fencing_token, contexto.fencingToken) >= 0
        : String(fila.fencing_token) === String(contexto.fencingToken)) &&
      String(fila.version_revocacion) === String(contexto.versionRevocacion)
    );
  }

  async revocar(entrada) {
    validarRevocacion(entrada);
    return this.#transaccion(async (conexion) => {
      const relacion = await bloquearRelacion(conexion, entrada.relacionId);
      exigirRelacionAutenticable(relacion, entrada);
      exigirActorRevocacion(relacion, entrada.actor);
      if (typeof this.adaptadorAuditoria?.registrarRevocacionEnTransaccion !== 'function') {
        throw new Error('La revocación federada exige auditoría transaccional.');
      }
      const huella = huellaIntencion({ ...entrada, tipo: 'revocacion' });
      const repetida = await buscarPorRequest(conexion, entrada.requestId);
      if (repetida) {
        if (repetida.tipo !== 'revocacion' ||
            !Buffer.from(repetida.huella_intencion).equals(huella)) {
          throw new Error('requestId ya pertenece a otra intención de sesión.');
        }
        return sanearOperacion(repetida, true);
      }
      const ahora = await ahoraSql(conexion);
      const control = await avanzarControl(conexion, entrada.relacionId, ahora, true);
      await conexion.execute(
        `INSERT INTO operaciones_sesion_federacion (
           operacion_id,request_id,relacion_id,tipo,estado,sesion_id,
           installation_local_id,installation_remota_id,boot_remoto_id,
           fencing_token,version_revocacion,huella_intencion,
           creada_en_utc,consolidada_en_utc
         ) VALUES (?,? ,?,'revocacion','consolidada',NULL,?,?,NULL,?,?,?, ?,?)`,
        [
          uuidV7AuditoriaABytes(entrada.operacionId, 'operacionId'),
          uuidV7AuditoriaABytes(entrada.requestId, 'requestId'),
          entrada.relacionId, entrada.installationLocalId,
          entrada.installationRemotaId, control.fencingToken,
          control.versionRevocacion, huella,
          ahora, ahora
        ]
      );
      await this.adaptadorAuditoria.registrarRevocacionEnTransaccion({
        eventoId: entrada.operacionId,
        requestId: entrada.requestId,
        relacionId: entrada.relacionId,
        actor: entrada.actor,
        scope: scopeRelacion(relacion),
        efectivoEnUtc: ahora
      }, { conexion });
      return Object.freeze({
        relacionId: entrada.relacionId,
        fencingToken: control.fencingToken,
        versionRevocacion: control.versionRevocacion
      });
    });
  }

  async #reservar(entrada, { verificarSecreto }) {
    validarOperacion(entrada, verificarSecreto);
    return this.#transaccion(async (conexion) => {
      const huella = huellaIntencion(entrada);
      const relacion = await bloquearRelacion(conexion, entrada.relacionId);
      exigirRelacionAutenticable(relacion, entrada);
      if (verificarSecreto) {
        const valida = await this.repositorioCredenciales
          .verificarSecretoReceptorEnTransaccion({
            relacionId: entrada.relacionId,
            installationLocalId: entrada.installationLocalId,
            installationRemotaId: entrada.installationRemotaId,
            secreto: entrada.secretoPersistente
          }, { conexion, verificadorSecretos: this.verificadorSecretos });
        if (!valida) throw errorAutenticacion();
      }
      const repetida = await buscarPorRequest(conexion, entrada.requestId);
      if (repetida) {
        if (!Buffer.from(repetida.huella_intencion).equals(huella)) {
          throw new Error('requestId ya pertenece a otra intención de sesión.');
        }
        return sanearOperacion(repetida, true);
      }
      const ahora = await ahoraSql(conexion);
      await actualizarNombreRemotoDeclarado(conexion, relacion, entrada, ahora);
      const control = await avanzarControl(conexion, entrada.relacionId, ahora, false);
      await conexion.execute(
        `INSERT INTO operaciones_sesion_federacion (
           operacion_id,request_id,relacion_id,tipo,estado,sesion_id,
           installation_local_id,installation_remota_id,boot_remoto_id,
           fencing_token,version_revocacion,huella_intencion,
           creada_en_utc,consolidada_en_utc
         ) VALUES (?,?,?,?,'reservada',?,?,?,?,?,?,?, ?,NULL)`,
        [
          uuidV7AuditoriaABytes(entrada.operacionId, 'operacionId'),
          uuidV7AuditoriaABytes(entrada.requestId, 'requestId'),
          entrada.relacionId, entrada.tipo,
          uuidV7AuditoriaABytes(entrada.sesionId, 'sesionId'),
          entrada.installationLocalId, entrada.installationRemotaId,
          entrada.bootRemotoId, control.fencingToken,
          control.versionRevocacion, huella, ahora
        ]
      );
      return Object.freeze({
        operacionId: entrada.operacionId, requestId: entrada.requestId,
        relacionId: entrada.relacionId, tipo: entrada.tipo,
        estado: 'reservada', sesionId: entrada.sesionId,
        installationLocalId: entrada.installationLocalId,
        installationRemotaId: entrada.installationRemotaId,
        bootRemotoId: entrada.bootRemotoId,
        fencingToken: control.fencingToken,
        versionRevocacion: control.versionRevocacion,
        creadaEnUtc: fechaIso(ahora),
        repetida: false
      });
    });
  }

  async #transaccion(operacion) {
    const conexion = await this.clienteSql.obtenerConexion();
    try {
      await conexion.beginTransaction();
      const resultado = await operacion(conexion);
      await conexion.commit();
      return resultado;
    } catch (error) {
      try { await conexion.rollback(); } catch { /* conserva causa */ }
      throw error;
    } finally {
      conexion.release();
    }
  }
}

async function avanzarControl(conexion, relacionId, ahora, revocar) {
  await conexion.execute(
    `INSERT INTO estado_sesiones_federacion (
       relacion_id,fencing_token,version_revocacion,actualizada_en_utc
     ) VALUES (?,1,?,?)
     ON DUPLICATE KEY UPDATE
       fencing_token=fencing_token+1,
       version_revocacion=version_revocacion+?,
       actualizada_en_utc=VALUES(actualizada_en_utc)`,
    [relacionId, revocar ? 2 : 1, ahora, revocar ? 1 : 0]
  );
  const [filas] = await conexion.execute(
    `SELECT fencing_token,version_revocacion
       FROM estado_sesiones_federacion WHERE relacion_id=? FOR UPDATE`,
    [relacionId]
  );
  return {
    fencingToken: String(filas[0].fencing_token),
    versionRevocacion: String(filas[0].version_revocacion)
  };
}

async function bloquearRelacion(conexion, relacionId) {
  const [filas] = await conexion.execute(
    'SELECT * FROM relaciones_federacion WHERE relacion_id=? FOR UPDATE',
    [relacionId]
  );
  if (!filas[0]) throw new Error('La relación federada no existe.');
  return filas[0];
}

async function buscarPorRequest(conexion, requestId) {
  const [filas] = await conexion.execute(
    'SELECT * FROM operaciones_sesion_federacion WHERE request_id=? FOR UPDATE',
    [uuidV7AuditoriaABytes(requestId, 'requestId')]
  );
  return filas[0] || null;
}

async function bloquearOperacion(conexion, operacionId) {
  const [filas] = await conexion.execute(
    'SELECT * FROM operaciones_sesion_federacion WHERE operacion_id=? FOR UPDATE',
    [uuidV7AuditoriaABytes(operacionId, 'operacionId')]
  );
  if (!filas[0]) throw new Error('La operación de sesión no existe.');
  return filas[0];
}

function exigirRelacionAutenticable(relacion, entrada) {
  if (
    relacion.direccion !== 'recepcion' ||
    !ESTADOS_AUTENTICABLES.has(relacion.estado_ciclo) ||
    relacion.estado_autoridad !== 'autorizada' ||
    relacion.estado_identidad !== 'valida' ||
    relacion.installation_remota_id !== entrada.installationRemotaId
  ) throw errorAutenticacion();
}

function exigirActorRevocacion(relacion, actor) {
  if (
    actor?.modo !== 'directo' || actor?.real?.tipo !== 'usuario' ||
    actor?.efectivo != null ||
    String(actor.real.id) !== String(relacion.responsable_usuario_id)
  ) throw new Error('Solo el responsable directo puede revocar la sesión.');
}

function validarOperacion(entrada, conSecreto) {
  for (const [campo, tipo] of [
    ['relacionId', 'relacion'], ['installationLocalId', 'instalacion'],
    ['installationRemotaId', 'instalacion'], ['bootRemotoId', 'arranque']
  ]) exigirIdentidad(entrada[campo], tipo, campo);
  for (const campo of ['operacionId', 'requestId', 'sesionId']) {
    uuidV7AuditoriaABytes(entrada[campo], campo);
  }
  if (entrada.nombreRemotoDeclarado != null &&
      (typeof entrada.nombreRemotoDeclarado !== 'string' ||
       entrada.nombreRemotoDeclarado !== entrada.nombreRemotoDeclarado.trim() ||
       entrada.nombreRemotoDeclarado.length < 1 ||
       entrada.nombreRemotoDeclarado.length > 191 ||
       /[\u0000-\u001f\u007f]/u.test(entrada.nombreRemotoDeclarado))) {
    throw new Error('nombreRemotoDeclarado no es valido.');
  }
  if (conSecreto && (typeof entrada.secretoPersistente !== 'string' ||
      entrada.secretoPersistente.length < 48 || entrada.secretoPersistente.length > 256)) {
    throw errorAutenticacion();
  }
}

function validarRevocacion(entrada) {
  for (const [campo, tipo] of [
    ['relacionId', 'relacion'], ['installationLocalId', 'instalacion'],
    ['installationRemotaId', 'instalacion']
  ]) exigirIdentidad(entrada[campo], tipo, campo);
  uuidV7AuditoriaABytes(entrada.operacionId, 'operacionId');
  uuidV7AuditoriaABytes(entrada.requestId, 'requestId');
}

function huellaIntencion(entrada) {
  return createHash('sha256').update(canonicalizarJsonFederacion({
    tipo: entrada.tipo,
    requestId: entrada.requestId,
    relacionId: entrada.relacionId,
    installationLocalId: entrada.installationLocalId,
    installationRemotaId: entrada.installationRemotaId,
    bootRemotoId: entrada.bootRemotoId ?? null,
    nombreRemotoDeclarado: entrada.nombreRemotoDeclarado ?? null
  }), 'utf8').digest();
}

async function actualizarNombreRemotoDeclarado(conexion, relacion, entrada, ahora) {
  const nombre = entrada.nombreRemotoDeclarado;
  if (nombre == null || nombre === relacion.nombre_remoto_declarado) return;
  const [resultado] = await conexion.execute(
    `UPDATE relaciones_federacion
        SET nombre_remoto_declarado=?,revision=revision+1,actualizada_en_utc=?
      WHERE relacion_id=? AND revision=?`,
    [nombre, ahora, entrada.relacionId, relacion.revision]
  );
  if (Number(resultado.affectedRows) !== 1) throw conflictoConcurrente();
}

function sanearOperacion(fila, repetida = false) {
  return Object.freeze({
    operacionId: bytesAUuidV7Auditoria(fila.operacion_id),
    requestId: bytesAUuidV7Auditoria(fila.request_id),
    relacionId: fila.relacion_id, tipo: fila.tipo, estado: fila.estado,
    sesionId: fila.sesion_id ? bytesAUuidV7Auditoria(fila.sesion_id) : null,
    installationLocalId: fila.installation_local_id,
    installationRemotaId: fila.installation_remota_id,
    bootRemotoId: fila.boot_remoto_id,
    fencingToken: String(fila.fencing_token),
    versionRevocacion: String(fila.version_revocacion),
    creadaEnUtc: fechaIso(fila.creada_en_utc),
    repetida
  });
}

function exigirMismaOperacion(fila, entrada) {
  if (
    bytesAUuidV7Auditoria(fila.request_id) !== entrada.requestId ||
    fila.tipo !== entrada.tipo
  ) throw new Error('La consolidación no coincide con la operación reservada.');
}

function scopeRelacion(relacion) {
  return {
    tenantId: relacion.scope_tenant_id == null ? null : String(relacion.scope_tenant_id),
    empresaId: relacion.scope_empresa_id == null ? null : String(relacion.scope_empresa_id),
    sitioId: relacion.scope_sitio_id == null ? null : String(relacion.scope_sitio_id)
  };
}

function exigirIdentidad(valor, tipo, campo) {
  if (typeof valor !== 'string' ||
      !new RegExp(`^sfid1\\.${tipo}\\.[A-Za-z0-9_-]{21}[AQgw]$`, 'u').test(valor)) {
    throw new Error(`${campo} no es canónica.`);
  }
}

async function ahoraSql(conexion) {
  const [filas] = await conexion.execute(
    "SELECT DATE_FORMAT(UTC_TIMESTAMP(3), '%Y-%m-%d %H:%i:%s.%f') AS ahora"
  );
  return filas[0].ahora;
}

function errorAutenticacion() {
  const error = new Error('La relación no admite autenticación técnica.');
  error.codigo = 'AUTENTICACION_FEDERADA_RECHAZADA';
  error.statusCode = 401;
  return error;
}

function conflictoConcurrente() {
  const error = new Error('La sesión cambió concurrentemente.');
  error.codigo = 'SESION_FEDERADA_CONFLICTO';
  error.statusCode = 409;
  return error;
}

function exigirMetodo(valor, metodo, campo) {
  if (typeof valor?.[metodo] !== 'function') {
    throw new Error(`${campo} debe implementar ${metodo}().`);
  }
}

function compararDecimal(a, b) {
  const izquierda = String(a).replace(/^0+(?=\d)/u, '');
  const derecha = String(b).replace(/^0+(?=\d)/u, '');
  if (izquierda.length !== derecha.length) return izquierda.length > derecha.length ? 1 : -1;
  return izquierda === derecha ? 0 : izquierda > derecha ? 1 : -1;
}

function fechaIso(valor) {
  if (valor instanceof Date) return valor.toISOString();
  const texto = String(valor);
  const sql = texto.match(/^(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2}:\d{2})\.(\d{3})/u);
  return sql ? `${sql[1]}T${sql[2]}.${sql[3]}Z` : texto;
}

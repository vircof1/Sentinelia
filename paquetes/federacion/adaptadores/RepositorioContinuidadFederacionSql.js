import { createHash, timingSafeEqual } from 'node:crypto';

import { uuidV7AuditoriaABytes } from '../../auditoria/src/UuidV7Auditoria.js';
import { canonicalizarJsonFederacion } from '../src/CanonicalizadorFederacion.js';
import { huellaRecuperacionFederacion } from './GeneradorRecuperacionFederacion.js';

export class RespuestaCredencialFederacionNoRecuperable extends Error {
  constructor() {
    super('La operación existe, pero su secreto persistente no puede recuperarse.');
    this.codigo = 'RESPUESTA_CREDENCIAL_FEDERADA_NO_RECUPERABLE';
    this.statusCode = 410;
  }
}

export class RepositorioContinuidadFederacionSql {
  constructor(clienteSql, { repositorioCredenciales, verificadorSecretos,
    adaptadorAuditoria } = {}) {
    if (!clienteSql?.obtenerConexion ||
        typeof repositorioCredenciales?.guardarVerificadorReceptorEnTransaccion !== 'function' ||
        typeof verificadorSecretos?.crear !== 'function' ||
        typeof adaptadorAuditoria?.registrarEnTransaccion !== 'function') {
      throw new Error('La continuidad federada exige SQL, credenciales y auditoría.');
    }
    this.clienteSql = clienteSql;
    this.repositorioCredenciales = repositorioCredenciales;
    this.verificadorSecretos = verificadorSecretos;
    this.adaptadorAuditoria = adaptadorAuditoria;
  }

  emitirRecuperacion(entrada) {
    return this.#transaccion(async (conexion) => {
      const relacion = await bloquearRelacion(conexion, entrada.relacionId);
      await exigirGestorHumano(conexion, relacion, entrada.actor.real.id);
      if (relacion.direccion !== 'recepcion' ||
          !['vinculada', 'deshabilitada'].includes(relacion.estado_ciclo) ||
          relacion.estado_identidad !== 'valida') {
        throw new Error('La relación no admite recuperación ordinaria.');
      }
      const repetida = await buscarRecuperacionPorEvento(conexion, entrada.eventoId);
      if (repetida) throw new RespuestaCredencialFederacionNoRecuperable();
      const ahora = await ahoraSql(conexion);
      const expira = await sumarSegundosSql(conexion, entrada.ttlSegundos);
      await conexion.execute(
        `UPDATE recuperaciones_relacion_federacion
            SET estado=IF(expira_en_utc<=?,'expirada','revocada'),
                recuperacion_vigente_relacion_id=NULL
          WHERE recuperacion_vigente_relacion_id=? AND estado='vigente'`,
        [ahora, entrada.relacionId]
      );
      await conexion.execute(
        `INSERT INTO recuperaciones_relacion_federacion (
          recuperacion_id,relacion_id,credencial_temporal_hash,estado,
          recuperacion_vigente_relacion_id,emitida_por_usuario_id,emitida_en_utc,
          expira_en_utc,consumida_en_utc,installation_emisora_id,boot_emisor_id,
          evento_emision_id,evento_consumo_id,solicitud_canje_id,correlacion_id
        ) VALUES (?,?,?,'vigente',?,?,?, ?,NULL,NULL,NULL,?,NULL,NULL,?)`,
        [entrada.recuperacionId, entrada.relacionId, entrada.credencialHash,
          entrada.relacionId, entrada.actor.real.id, ahora, expira,
          uuidV7AuditoriaABytes(entrada.eventoId),
          uuidV7AuditoriaABytes(entrada.correlacionId)]
      );
      await this.#auditar(conexion, relacion, {
        ...entrada,
        tipo: 'federacion.recuperacion_solicitada',
        sujetoId: entrada.relacionId,
        motivoCodigo: 'continuidad_mismos_installation_id',
        efectivoEnUtc: ahora
      });
      return Object.freeze({ expiraEnUtc: fechaIso(expira) });
    });
  }

  canjearRecuperacion(entrada) {
    return this.#transaccion(async (conexion) => {
      const relacion = await bloquearRelacion(conexion, entrada.relacionId);
      exigirReceptoraVinculada(relacion, entrada.installationRemotaId);
      const existente = await buscarOperacionCredencial(conexion, entrada.solicitudId);
      if (existente) throw new RespuestaCredencialFederacionNoRecuperable();
      const [filas] = await conexion.execute(
        `SELECT *,expira_en_utc<=UTC_TIMESTAMP(3) AS expirada
           FROM recuperaciones_relacion_federacion
          WHERE recuperacion_id=? AND relacion_id=? FOR UPDATE`,
        [entrada.recuperacionId, entrada.relacionId]
      );
      const recuperacion = filas[0];
      if (!recuperacion || recuperacion.estado !== 'vigente' ||
          Boolean(recuperacion.expirada)) throw recuperacionRechazada();
      const presentada = huellaRecuperacionFederacion(entrada.credencialTemporal);
      if (!timingSafeEqual(Buffer.from(recuperacion.credencial_temporal_hash), presentada)) {
        throw recuperacionRechazada();
      }
      const ahora = await ahoraSql(conexion);
      const versionCredencial = await this.#reemplazarVerificador(conexion, entrada, ahora);
      const control = await revocarSesionesEnTransaccion(conexion, entrada.relacionId, ahora);
      const huella = huellaIntencionCredencial('recuperacion', entrada);
      await insertarOperacionCredencial(conexion, {
        ...entrada, tipo: 'recuperacion', versionCredencial, huella, ahora
      });
      const [actualizacion] = await conexion.execute(
        `UPDATE recuperaciones_relacion_federacion SET estado='consumida',
           recuperacion_vigente_relacion_id=NULL,consumida_en_utc=?,
           installation_emisora_id=?,boot_emisor_id=?,evento_consumo_id=?,solicitud_canje_id=?
         WHERE recuperacion_id=? AND estado='vigente' AND expira_en_utc>?`,
        [ahora, entrada.installationRemotaId, entrada.bootRemotoId,
          uuidV7AuditoriaABytes(entrada.eventoId),
          uuidV7AuditoriaABytes(entrada.solicitudId), entrada.recuperacionId, ahora]
      );
      if (Number(actualizacion.affectedRows) !== 1) throw recuperacionRechazada();
      await this.#auditar(conexion, relacion, {
        ...entrada,
        tipo: 'federacion.credencial_recuperada',
        actor: actorRemoto(entrada.installationRemotaId),
        correlacionId: entrada.solicitudId,
        sujetoId: entrada.relacionId,
        motivoCodigo: 'recuperacion_bilateral',
        efectivoEnUtc: ahora
      });
      return Object.freeze({ versionCredencial, ...control });
    });
  }

  rotarCredencial(entrada) {
    return this.#transaccion(async (conexion) => {
      const relacion = await bloquearRelacion(conexion, entrada.relacionId);
      exigirReceptoraVinculada(relacion, entrada.installationRemotaId);
      const existente = await buscarOperacionCredencial(conexion, entrada.solicitudId);
      if (existente) {
        const esperada = huellaIntencionCredencial('rotacion', entrada);
        if (!Buffer.from(existente.huella_intencion).equals(esperada)) {
          throw new Error('solicitudId ya pertenece a otra rotación.');
        }
        throw new RespuestaCredencialFederacionNoRecuperable();
      }
      const ahora = await ahoraSql(conexion);
      const versionCredencial = await this.#reemplazarVerificador(conexion, entrada, ahora);
      const control = await revocarSesionesEnTransaccion(conexion, entrada.relacionId, ahora);
      await insertarOperacionCredencial(conexion, {
        ...entrada, tipo: 'rotacion', versionCredencial,
        huella: huellaIntencionCredencial('rotacion', entrada), ahora
      });
      await this.#auditar(conexion, relacion, {
        ...entrada,
        tipo: 'federacion.credencial_rotada',
        actor: actorRemoto(entrada.installationRemotaId),
        correlacionId: entrada.solicitudId,
        sujetoId: entrada.relacionId,
        motivoCodigo: 'canal_autenticado',
        efectivoEnUtc: ahora
      });
      return Object.freeze({ versionCredencial, ...control });
    });
  }

  proponerLocalizacion(entrada) {
    return this.#transaccion(async (conexion) => {
      const relacion = await bloquearRelacion(conexion, entrada.relacionId);
      if (relacion.direccion !== 'emision' || relacion.estado_identidad !== 'valida' ||
          !['vinculada', 'deshabilitada'].includes(relacion.estado_ciclo)) {
        throw new Error('La relación emisora no admite una localización nueva.');
      }
      if (entrada.origen !== 'contraparte' ||
          entrada.actor.real.tipo !== 'instancia_remota' ||
          entrada.actor.real.id !== relacion.installation_remota_id) {
        throw new Error('La propuesta no procede de la contraparte autenticada de la relación.');
      }
      const [replay] = await conexion.execute(
        'SELECT * FROM localizaciones_relaciones_federacion WHERE evento_auditoria_id=? FOR UPDATE',
        [uuidV7AuditoriaABytes(entrada.eventoId)]
      );
      if (replay[0]) return Object.freeze({ estado: replay[0].estado, repetida: true });
      const ahora = await ahoraSql(conexion);
      await conexion.execute(
        `UPDATE localizaciones_relaciones_federacion
            SET estado='rechazada',finalizada_en_utc=?
          WHERE relacion_id=? AND estado='propuesta'`,
        [ahora, entrada.relacionId]
      );
      await conexion.execute(
        `INSERT INTO localizaciones_relaciones_federacion (
          localizacion_id,relacion_id,endpoint_https,estado,relacion_localizacion_activa,
          origen_propuesta,propuesta_por_usuario_id,aprobada_por_usuario_id,
          propuesta_en_utc,aprobada_en_utc,finalizada_en_utc,
          evento_auditoria_id,correlacion_id
        ) VALUES (?, ?,?,'propuesta',NULL,?, ?,NULL,?,NULL,NULL,?,?)`,
        [uuidV7AuditoriaABytes(entrada.localizacionId), entrada.relacionId,
          entrada.endpoint, entrada.origen,
          entrada.actor.real.tipo === 'usuario' ? entrada.actor.real.id : null,
          ahora, uuidV7AuditoriaABytes(entrada.eventoId),
          uuidV7AuditoriaABytes(entrada.correlacionId)]
      );
      await this.#auditar(conexion, relacion, {
        ...entrada, tipo: 'federacion.localizacion_propuesta',
        sujetoId: entrada.relacionId,
        motivoCodigo: entrada.origen === 'configuracionLocal'
          ? 'configuracion_local' : entrada.origen,
        efectivoEnUtc: ahora
      });
      return Object.freeze({ estado: 'propuesta', repetida: false });
    });
  }

  aprobarLocalizacion(entrada) {
    return this.#transaccion(async (conexion) => {
      const relacion = await bloquearRelacion(conexion, entrada.relacionId);
      await exigirGestorHumano(conexion, relacion, entrada.actor.real.id);
      if (relacion.direccion !== 'emision' || relacion.estado_identidad !== 'valida') {
        throw new Error('La relación no admite aprobar localización.');
      }
      const [replays] = await conexion.execute(
        `SELECT * FROM localizaciones_relaciones_federacion
          WHERE evento_aprobacion_id=? FOR UPDATE`,
        [uuidV7AuditoriaABytes(entrada.eventoId)]
      );
      if (replays[0]) {
        if (replays[0].relacion_id !== entrada.relacionId ||
            !Buffer.from(replays[0].localizacion_id).equals(
              uuidV7AuditoriaABytes(entrada.localizacionId)
            )) throw new Error('eventoId ya aprobó otra localización.');
        return Object.freeze({
          estado: replays[0].estado, endpoint: replays[0].endpoint_https, repetida: true
        });
      }
      const [filas] = await conexion.execute(
        `SELECT * FROM localizaciones_relaciones_federacion
          WHERE localizacion_id=? AND relacion_id=? FOR UPDATE`,
        [uuidV7AuditoriaABytes(entrada.localizacionId), entrada.relacionId]
      );
      const propuesta = filas[0];
      if (!propuesta) throw new Error('La propuesta de localización no existe.');
      if (propuesta.estado === 'activa') {
        throw new Error('La localización ya fue aprobada por otra operación.');
      }
      if (propuesta.estado !== 'propuesta') throw new Error('La propuesta ya es terminal.');
      const ahora = await ahoraSql(conexion);
      await conexion.execute(
        `UPDATE localizaciones_relaciones_federacion
            SET estado='sustituida',relacion_localizacion_activa=NULL,finalizada_en_utc=?
          WHERE relacion_localizacion_activa=? AND estado='activa'`,
        [ahora, entrada.relacionId]
      );
      await conexion.execute(
        `UPDATE localizaciones_relaciones_federacion SET estado='activa',
           relacion_localizacion_activa=relacion_id,aprobada_por_usuario_id=?,aprobada_en_utc=?,
           evento_aprobacion_id=?
         WHERE localizacion_id=? AND estado='propuesta'`,
        [entrada.actor.real.id, ahora, uuidV7AuditoriaABytes(entrada.eventoId),
          uuidV7AuditoriaABytes(entrada.localizacionId)]
      );
      await this.#auditar(conexion, relacion, {
        ...entrada, tipo: 'federacion.localizacion_cambiada',
        sujetoId: entrada.relacionId, motivoCodigo: 'aprobacion_local',
        efectivoEnUtc: ahora
      });
      return Object.freeze({ estado: 'activa', endpoint: propuesta.endpoint_https, repetida: false });
    });
  }

  async #reemplazarVerificador(conexion, entrada, ahora) {
    const resultado = await this.repositorioCredenciales
      .guardarVerificadorReceptorEnTransaccion({
        relacionId: entrada.relacionId,
        installationLocalId: entrada.installationLocalId,
        installationRemotaId: entrada.installationRemotaId,
        secreto: entrada.secretoPersistente,
        efectivoEnUtc: ahora
      }, { conexion, verificadorSecretos: this.verificadorSecretos });
    return resultado.versionCredencial;
  }

  #auditar(conexion, relacion, entrada) {
    return this.adaptadorAuditoria.registrarEnTransaccion({
      ...entrada, relacionId: relacion.relacion_id,
      scope: scopeRelacion(relacion), relacionesAfectadas: 1
    }, { conexion });
  }

  async #transaccion(trabajo) {
    const conexion = await this.clienteSql.obtenerConexion();
    try {
      await conexion.beginTransaction();
      const resultado = await trabajo(conexion);
      await conexion.commit();
      return resultado;
    } catch (error) {
      try { await conexion.rollback(); } catch { /* conserva causa */ }
      throw error;
    } finally { conexion.release(); }
  }
}

async function bloquearRelacion(conexion, relacionId) {
  const [filas] = await conexion.execute(
    'SELECT * FROM relaciones_federacion WHERE relacion_id=? FOR UPDATE', [relacionId]
  );
  if (!filas[0]) throw new Error('La relación federada no existe.');
  return filas[0];
}

function exigirReceptoraVinculada(relacion, installationRemotaId) {
  if (relacion.direccion !== 'recepcion' ||
      !['vinculada', 'deshabilitada'].includes(relacion.estado_ciclo) ||
      relacion.estado_autoridad !== 'autorizada' || relacion.estado_identidad !== 'valida' ||
      relacion.installation_remota_id !== installationRemotaId) {
    throw recuperacionRechazada();
  }
}

async function exigirGestorHumano(conexion, relacion, usuarioId) {
  if (relacion.estado_autoridad !== 'autorizada' ||
      String(relacion.responsable_usuario_id) !== String(usuarioId)) {
    throw new Error('Solo el responsable actual puede gestionar la continuidad.');
  }
  const [filas] = await conexion.execute(
    `SELECT activo,tenant_id,empresa_id,sitio_id,
            permiso_configurar_emisiones_federacion,
            permiso_configurar_recepciones_federacion,
            permiso_gestionar_credenciales_federacion
       FROM usuarios WHERE id=? FOR UPDATE`, [usuarioId]
  );
  const usuario = filas[0];
  const permisoDireccion = relacion.direccion === 'emision'
    ? usuario?.permiso_configurar_emisiones_federacion
    : usuario?.permiso_configurar_recepciones_federacion;
  if (!usuario || !Boolean(usuario.activo) || !Boolean(permisoDireccion) ||
      !Boolean(usuario.permiso_gestionar_credenciales_federacion) ||
      !scopeUsuarioCubreRelacion(usuario, relacion)) {
    throw new Error('El responsable carece del permiso actual para gestionar credenciales.');
  }
}

function scopeUsuarioCubreRelacion(usuario, relacion) {
  const tenant = decimalNullable(usuario.tenant_id);
  const empresa = decimalNullable(usuario.empresa_id);
  const sitio = decimalNullable(usuario.sitio_id);
  if (tenant === null) return empresa === null && sitio === null;
  if (tenant !== decimalNullable(relacion.scope_tenant_id)) return false;
  if (empresa === null) return sitio === null;
  if (empresa !== decimalNullable(relacion.scope_empresa_id)) return false;
  return sitio === null || sitio === decimalNullable(relacion.scope_sitio_id);
}

function decimalNullable(valor) {
  return valor == null ? null : String(valor);
}

async function buscarRecuperacionPorEvento(conexion, eventoId) {
  const [filas] = await conexion.execute(
    'SELECT * FROM recuperaciones_relacion_federacion WHERE evento_emision_id=? FOR UPDATE',
    [uuidV7AuditoriaABytes(eventoId)]
  );
  return filas[0] || null;
}

async function buscarOperacionCredencial(conexion, solicitudId) {
  const [filas] = await conexion.execute(
    'SELECT * FROM operaciones_credencial_federacion WHERE solicitud_id=? FOR UPDATE',
    [uuidV7AuditoriaABytes(solicitudId)]
  );
  return filas[0] || null;
}

async function insertarOperacionCredencial(conexion, entrada) {
  await conexion.execute(
    `INSERT INTO operaciones_credencial_federacion (
      solicitud_id,relacion_id,tipo,version_credencial,installation_remota_id,
      boot_remoto_id,huella_intencion,evento_auditoria_id,efectiva_en_utc
    ) VALUES (?,?,?,?,?,?,?,?,?)`,
    [uuidV7AuditoriaABytes(entrada.solicitudId), entrada.relacionId, entrada.tipo,
      entrada.versionCredencial, entrada.installationRemotaId, entrada.bootRemotoId,
      entrada.huella, uuidV7AuditoriaABytes(entrada.eventoId), entrada.ahora]
  );
}

async function revocarSesionesEnTransaccion(conexion, relacionId, ahora) {
  await conexion.execute(
    `INSERT INTO estado_sesiones_federacion (
       relacion_id,fencing_token,version_revocacion,actualizada_en_utc
     ) VALUES (?,1,2,?)
     ON DUPLICATE KEY UPDATE fencing_token=fencing_token+1,
       version_revocacion=version_revocacion+1,actualizada_en_utc=VALUES(actualizada_en_utc)`,
    [relacionId, ahora]
  );
  const [filas] = await conexion.execute(
    'SELECT fencing_token,version_revocacion FROM estado_sesiones_federacion WHERE relacion_id=?',
    [relacionId]
  );
  return {
    fencingToken: String(filas[0].fencing_token),
    versionRevocacion: String(filas[0].version_revocacion)
  };
}

function huellaIntencionCredencial(tipo, entrada) {
  return createHash('sha256').update(canonicalizarJsonFederacion({
    tipo, solicitudId: entrada.solicitudId, relacionId: entrada.relacionId,
    installationLocalId: entrada.installationLocalId,
    installationRemotaId: entrada.installationRemotaId,
    bootRemotoId: entrada.bootRemotoId
  }), 'utf8').digest();
}

function actorRemoto(id) {
  return { real: { tipo: 'instancia_remota', id }, efectivo: null, modo: 'directo' };
}

function scopeRelacion(relacion) {
  return {
    tenantId: relacion.scope_tenant_id == null ? null : String(relacion.scope_tenant_id),
    empresaId: relacion.scope_empresa_id == null ? null : String(relacion.scope_empresa_id),
    sitioId: relacion.scope_sitio_id == null ? null : String(relacion.scope_sitio_id)
  };
}

async function ahoraSql(conexion) {
  const [filas] = await conexion.execute(
    "SELECT DATE_FORMAT(UTC_TIMESTAMP(3), '%Y-%m-%d %H:%i:%s.%f') AS ahora"
  );
  return String(filas[0].ahora).slice(0, 23);
}
async function sumarSegundosSql(conexion, segundos) {
  const [filas] = await conexion.execute(
    "SELECT DATE_FORMAT(DATE_ADD(UTC_TIMESTAMP(3), INTERVAL ? SECOND), '%Y-%m-%d %H:%i:%s.%f') AS fecha",
    [segundos]
  );
  return String(filas[0].fecha).slice(0, 23);
}
function fechaIso(valor) { return `${String(valor).replace(' ', 'T')}Z`; }
function recuperacionRechazada() {
  const error = new Error('La recuperación federada fue rechazada.');
  error.codigo = 'RECUPERACION_FEDERADA_RECHAZADA';
  error.statusCode = 401;
  return error;
}

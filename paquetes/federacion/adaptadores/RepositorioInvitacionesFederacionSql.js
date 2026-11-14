import { timingSafeEqual } from 'node:crypto';
import { uuidV7AuditoriaABytes } from '../../auditoria/src/UuidV7Auditoria.js';
import { calcularHuellaCredencialTemporalFederacion } from './GeneradorCredencialInvitacionFederacion.js';
import { validarInvitacionIdFederacion } from '../src/InvitacionEstablecimientoFederacion.js';

export class RespuestaInvitacionNoRecuperable extends Error {
  constructor(mensaje = 'La representación de esta invitación ya fue entregada y no puede recuperarse.') {
    super(mensaje);
    this.name = 'RespuestaInvitacionNoRecuperable';
    this.codigo = 'RESPUESTA_INVITACION_NO_RECUPERABLE';
  }
}

export class RepositorioInvitacionesFederacionSql {
  constructor(clienteSql, { adaptadorAuditoria, adaptadorAuditoriaCanje = null } = {}) {
    if (!clienteSql?.obtenerConexion) {
      throw new Error('Las invitaciones federadas requieren SQL operativo.');
    }
    if (typeof adaptadorAuditoria?.registrarEnTransaccion !== 'function') {
      throw new Error('Las invitaciones federadas requieren auditoría transaccional.');
    }
    this.clienteSql = clienteSql;
    this.adaptadorAuditoria = adaptadorAuditoria;
    this.adaptadorAuditoriaCanje = adaptadorAuditoriaCanje;
  }

  async emitir(entrada = {}) {
    validarEmision(entrada);
    return this.#transaccion(async (conexion) => {
      const relacion = await bloquearRelacion(conexion, entrada.relacionId);
      exigirRelacionReceptoraAutorizada(relacion, entrada.auditoria.actor.real.id);
      await exigirGestorInvitacionActual(
        conexion,
        relacion,
        entrada.auditoria.actor.real.id
      );
      const repetida = await buscarPorEventoEmision(
        conexion,
        entrada.auditoria.eventoId
      );
      if (repetida) throw new RespuestaInvitacionNoRecuperable();
      const ahora = await ahoraSql(conexion);
      const expira = await sumarSegundosSql(
        conexion,
        entrada.ttlSegundos
      );
      await terminalizarAnteriorVigente(conexion, {
        relacionId: entrada.relacionId,
        usuarioId: entrada.auditoria.actor.real.id,
        eventoId: entrada.auditoria.eventoId,
        ahora
      });
      await conexion.execute(
        `INSERT INTO invitaciones_establecimiento_federacion (
           invitacion_id, relacion_id, installation_receptora_id,
           credencial_hash, estado, emitida_por_usuario_id,
           revocada_por_usuario_id, emitida_en_utc, expira_en_utc,
           consumida_en_utc, revocada_en_utc, evento_emision_id,
           evento_revocacion_id, correlacion_id, relacion_vigente_id
         ) VALUES (?, ?, ?, ?, 'vigente', ?, NULL, ?, ?, NULL, NULL, ?, NULL, ?, ?)`,
        [
          entrada.invitacionId,
          entrada.relacionId,
          entrada.installationReceptoraId,
          entrada.credencialHash,
          entrada.auditoria.actor.real.id,
          ahora,
          expira,
          uuidV7AuditoriaABytes(entrada.auditoria.eventoId, 'eventoId'),
          uuidV7AuditoriaABytes(entrada.auditoria.correlacionId, 'correlacionId'),
          entrada.relacionId
        ]
      );
      await this.adaptadorAuditoria.registrarEnTransaccion({
        ...entrada.auditoria,
        tipo: 'federacion.vinculacion_solicitada',
        relacionId: entrada.relacionId,
        revisionConcesionId: null,
        motivoCodigo: 'invitacionEmitida',
        scope: scopeRelacion(relacion),
        efectivoEnUtc: ahora
      }, { conexion });
      return Object.freeze({
        estado: 'emitida',
        invitacionId: entrada.invitacionId,
        expiraEnUtc: fechaIso(expira)
      });
    });
  }

  async revocar(entrada = {}) {
    validarRevocacion(entrada);
    return this.#transaccion(async (conexion) => {
      const relacion = await bloquearRelacion(conexion, entrada.relacionId);
      exigirRelacionReceptoraAutorizada(relacion, entrada.auditoria.actor.real.id);
      await exigirGestorInvitacionActual(
        conexion,
        relacion,
        entrada.auditoria.actor.real.id
      );
      const invitacion = await bloquearInvitacion(
        conexion,
        entrada.invitacionId,
        entrada.relacionId
      );
      if (!invitacion) throw new Error('La invitación no existe en esta relación.');
      if (invitacion.estado !== 'vigente') {
        return Object.freeze({ estado: invitacion.estado, cambioEfectivo: false });
      }
      const ahora = await ahoraSql(conexion);
      if (new Date(`${invitacion.expira_en_utc}Z`).getTime() <= new Date(`${ahora}Z`).getTime()) {
        await conexion.execute(
          `UPDATE invitaciones_establecimiento_federacion
              SET estado='expirada', relacion_vigente_id=NULL
            WHERE invitacion_id=? AND estado='vigente'`,
          [entrada.invitacionId]
        );
        return Object.freeze({ estado: 'expirada', cambioEfectivo: false });
      }
      await conexion.execute(
        `UPDATE invitaciones_establecimiento_federacion
            SET estado='revocada', relacion_vigente_id=NULL,
                revocada_por_usuario_id=?,
                revocada_en_utc=?, evento_revocacion_id=?
          WHERE invitacion_id=? AND estado='vigente'`,
        [
          entrada.auditoria.actor.real.id,
          ahora,
          uuidV7AuditoriaABytes(entrada.auditoria.eventoId, 'eventoId'),
          entrada.invitacionId
        ]
      );
      await this.adaptadorAuditoria.registrarEnTransaccion({
        ...entrada.auditoria,
        tipo: 'federacion.invitacion_revocada',
        relacionId: entrada.relacionId,
        revisionConcesionId: null,
        motivoCodigo: 'operador',
        scope: scopeRelacion(relacion),
        efectivoEnUtc: ahora
      }, { conexion });
      return Object.freeze({ estado: 'revocada', cambioEfectivo: true });
    });
  }

  async canjear(entrada = {}) {
    validarCanje(entrada);
    if (typeof this.adaptadorAuditoriaCanje?.registrarEnTransaccion !== 'function') {
      throw new Error('El canje requiere su adaptador de auditoría técnica.');
    }
    const resultado = await this.#transaccion(async (conexion) => {
      const relacion = await bloquearRelacionCanje(
        conexion,
        entrada.invitacion.destino.relacionId
      );
      if (!relacion) throw new InvitacionCanjeRechazada();
      exigirRelacionReceptoraPendiente(relacion);
      const invitacion = await bloquearInvitacionCompleta(
        conexion,
        entrada.invitacion.invitacionId,
        entrada.invitacion.destino.relacionId
      );
      if (!invitacion) throw new InvitacionCanjeRechazada();
      if (invitacion.estado !== 'vigente') {
        return { error: new InvitacionCanjeNoDisponible(invitacion.estado) };
      }
      if (
        invitacion.installation_receptora_id !==
          entrada.invitacion.destino.installationId ||
        Date.parse(fechaIso(invitacion.expira_en_utc)) !==
          Date.parse(entrada.invitacion.expiraEnUtc)
      ) throw new InvitacionCanjeRechazada();
      const huellaPresentada = calcularHuellaCredencialTemporalFederacion(
        entrada.invitacion.credencialTemporal
      );
      if (!timingSafeEqual(Buffer.from(invitacion.credencial_hash), huellaPresentada)) {
        throw new InvitacionCanjeRechazada();
      }
      const ahora = await ahoraSql(conexion);
      if (Date.parse(fechaIso(invitacion.expira_en_utc)) <= Date.parse(fechaIso(ahora))) {
        await conexion.execute(
          `UPDATE invitaciones_establecimiento_federacion
              SET estado='expirada', relacion_vigente_id=NULL
            WHERE invitacion_id=? AND estado='vigente'`,
          [entrada.invitacion.invitacionId]
        );
        return { error: new InvitacionCanjeNoDisponible('expirada') };
      }
      const provision = await entrada.provisionadorCanjePendiente
        .registrarEnTransaccion({
          relacionId: entrada.invitacion.destino.relacionId,
          installationReceptoraId: entrada.invitacion.destino.installationId,
          installationEmisoraId: entrada.installationEmisoraId,
          bootEmisorId: entrada.bootEmisorId,
          nombreEmisorDeclarado: entrada.nombreEmisorDeclarado,
          compatibilidad: entrada.compatibilidad,
          secretoPersistente: entrada.secretoPersistente,
          solicitudCanjeId: entrada.solicitudCanjeId,
          eventoId: entrada.eventoId,
          efectivoEnUtc: ahora
        }, { conexion });
      if (
        provision?.credencialPersistida !== true ||
        provision?.identidadCandidataPersistida !== true
      ) {
        throw new Error(
          'El canje no puede consumirse sin credencial e identidad candidata durables.'
        );
      }
      const [actualizacion] = await conexion.execute(
        `UPDATE invitaciones_establecimiento_federacion
            SET estado='consumida', relacion_vigente_id=NULL,
                consumida_en_utc=?, evento_consumo_id=?, solicitud_canje_id=?,
                installation_emisora_id=?, boot_emisor_id=?
          WHERE invitacion_id=? AND estado='vigente'
            AND expira_en_utc > UTC_TIMESTAMP(3)`,
        [
          ahora,
          uuidV7AuditoriaABytes(entrada.eventoId, 'eventoId'),
          uuidV7AuditoriaABytes(entrada.solicitudCanjeId, 'solicitudCanjeId'),
          entrada.installationEmisoraId,
          entrada.bootEmisorId,
          entrada.invitacion.invitacionId
        ]
      );
      if (Number(actualizacion.affectedRows) !== 1) {
        throw new InvitacionCanjeNoDisponible('expirada');
      }
      await this.adaptadorAuditoriaCanje.registrarEnTransaccion({
        eventoId: entrada.eventoId,
        solicitudCanjeId: entrada.solicitudCanjeId,
        relacionId: entrada.invitacion.destino.relacionId,
        installationEmisoraId: entrada.installationEmisoraId,
        scope: scopeRelacion(relacion),
        efectivoEnUtc: ahora
      }, { conexion });
      return Object.freeze({
        estado: 'pendienteConfirmacionIdentidad',
        provision: provision ?? null
      });
    });
    if (resultado?.error) throw resultado.error;
    return resultado;
  }

  async buscarSaneadaPorId(invitacionId) {
    validarInvitacionIdFederacion(invitacionId);
    const filas = await this.clienteSql.consultar(
      `${seleccionSaneada()}
       WHERE invitacion_id=?
       LIMIT 1`,
      [invitacionId]
    );
    return filas[0] ? sanearFila(filas[0]) : null;
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

async function bloquearRelacion(conexion, relacionId) {
  const [filas] = await conexion.execute(
    'SELECT * FROM relaciones_federacion WHERE relacion_id=? FOR UPDATE',
    [relacionId]
  );
  if (filas.length !== 1) throw new Error('La relación federada no existe.');
  return filas[0];
}

async function bloquearRelacionCanje(conexion, relacionId) {
  const [filas] = await conexion.execute(
    'SELECT * FROM relaciones_federacion WHERE relacion_id=? FOR UPDATE',
    [relacionId]
  );
  return filas[0] || null;
}

function exigirRelacionReceptoraAutorizada(relacion, usuarioId) {
  if (relacion.direccion !== 'recepcion') {
    throw new Error('Solo una relación receptora puede emitir invitaciones.');
  }
  if (![
    'pendienteVinculacion',
    'pendienteConfirmacionIdentidad'
  ].includes(relacion.estado_ciclo)) {
    throw new Error('La relación ya no admite invitaciones de establecimiento.');
  }
  if (
    relacion.estado_autoridad !== 'autorizada' ||
    String(relacion.responsable_usuario_id) !== String(usuarioId)
  ) {
    throw new Error('El actor ya no conserva autoridad sobre la recepción.');
  }
}

async function exigirGestorInvitacionActual(conexion, relacion, usuarioId) {
  const [filas] = await conexion.execute(
    `SELECT activo,tenant_id,empresa_id,sitio_id,
            permiso_configurar_recepciones_federacion,
            permiso_gestionar_credenciales_federacion
       FROM usuarios WHERE id=? FOR UPDATE`,
    [usuarioId]
  );
  const usuario = filas[0];
  if (!usuario || !Boolean(usuario.activo) ||
      !Boolean(usuario.permiso_configurar_recepciones_federacion) ||
      !Boolean(usuario.permiso_gestionar_credenciales_federacion) ||
      !scopeUsuarioCubreRelacion(usuario, relacion)) {
    throw new Error(
      'El responsable ya no conserva autoridad actual para gestionar invitaciones.'
    );
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

async function terminalizarAnteriorVigente(conexion, entrada) {
  const [filas] = await conexion.execute(
    `SELECT invitacion_id,
            expira_en_utc <= UTC_TIMESTAMP(3) AS expirada
       FROM invitaciones_establecimiento_federacion
      WHERE relacion_id=? AND estado='vigente'
      FOR UPDATE`,
    [entrada.relacionId]
  );
  if (filas.length === 0) return;
  const anterior = filas[0];
  if (Boolean(anterior.expirada)) {
    await conexion.execute(
      `UPDATE invitaciones_establecimiento_federacion
          SET estado='expirada', relacion_vigente_id=NULL
        WHERE invitacion_id=? AND estado='vigente'`,
      [anterior.invitacion_id]
    );
    return;
  }
  await conexion.execute(
    `UPDATE invitaciones_establecimiento_federacion
        SET estado='revocada', relacion_vigente_id=NULL,
            revocada_por_usuario_id=?,
            revocada_en_utc=?, evento_revocacion_id=?
      WHERE invitacion_id=? AND estado='vigente'`,
    [
      entrada.usuarioId,
      entrada.ahora,
      uuidV7AuditoriaABytes(entrada.eventoId, 'eventoId'),
      anterior.invitacion_id
    ]
  );
}

async function bloquearInvitacion(conexion, invitacionId, relacionId) {
  const [filas] = await conexion.execute(
    `SELECT invitacion_id, estado,
            DATE_FORMAT(expira_en_utc, '%Y-%m-%d %H:%i:%s.%f') AS expira_en_utc
       FROM invitaciones_establecimiento_federacion
      WHERE invitacion_id=? AND relacion_id=?
      FOR UPDATE`,
    [invitacionId, relacionId]
  );
  return filas[0] || null;
}

async function bloquearInvitacionCompleta(conexion, invitacionId, relacionId) {
  const [filas] = await conexion.execute(
    `SELECT invitacion_id, relacion_id, installation_receptora_id,
            credencial_hash, estado,
            DATE_FORMAT(expira_en_utc, '%Y-%m-%d %H:%i:%s.%f') AS expira_en_utc
       FROM invitaciones_establecimiento_federacion
      WHERE invitacion_id=? AND relacion_id=?
      FOR UPDATE`,
    [invitacionId, relacionId]
  );
  return filas[0] || null;
}

async function buscarPorEventoEmision(conexion, eventoId) {
  const [filas] = await conexion.execute(
    `SELECT invitacion_id
       FROM invitaciones_establecimiento_federacion
      WHERE evento_emision_id=?
      LIMIT 1`,
    [uuidV7AuditoriaABytes(eventoId, 'eventoId')]
  );
  return filas[0] || null;
}

async function ahoraSql(conexion) {
  const [filas] = await conexion.execute(
    "SELECT DATE_FORMAT(UTC_TIMESTAMP(3), '%Y-%m-%d %H:%i:%s.%f') AS ahora"
  );
  return filas[0].ahora;
}

async function sumarSegundosSql(conexion, segundos) {
  const [filas] = await conexion.execute(
    "SELECT DATE_FORMAT(TIMESTAMPADD(SECOND, ?, UTC_TIMESTAMP(3)), '%Y-%m-%d %H:%i:%s.%f') AS expira",
    [segundos]
  );
  return filas[0].expira;
}

function seleccionSaneada() {
  return `SELECT invitacion_id, relacion_id, installation_receptora_id, estado,
                 CAST(emitida_por_usuario_id AS CHAR) AS emitida_por_usuario_id,
                 CAST(revocada_por_usuario_id AS CHAR) AS revocada_por_usuario_id,
                 DATE_FORMAT(emitida_en_utc, '%Y-%m-%dT%H:%i:%s.%fZ') AS emitida_en_utc,
                 DATE_FORMAT(expira_en_utc, '%Y-%m-%dT%H:%i:%s.%fZ') AS expira_en_utc,
                 DATE_FORMAT(consumida_en_utc, '%Y-%m-%dT%H:%i:%s.%fZ') AS consumida_en_utc,
                 DATE_FORMAT(revocada_en_utc, '%Y-%m-%dT%H:%i:%s.%fZ') AS revocada_en_utc
            FROM invitaciones_establecimiento_federacion`;
}

function sanearFila(fila) {
  const estado = fila.estado === 'vigente' && Date.parse(fila.expira_en_utc) <= Date.now()
    ? 'expirada' : fila.estado;
  return Object.freeze({
    invitacionId: fila.invitacion_id,
    relacionId: fila.relacion_id,
    installationReceptoraId: fila.installation_receptora_id,
    estado,
    emitidaPorUsuarioId: fila.emitida_por_usuario_id,
    revocadaPorUsuarioId: fila.revocada_por_usuario_id,
    emitidaEnUtc: fechaIso(fila.emitida_en_utc),
    expiraEnUtc: fechaIso(fila.expira_en_utc),
    consumidaEnUtc: fechaIsoNullable(fila.consumida_en_utc),
    revocadaEnUtc: fechaIsoNullable(fila.revocada_en_utc)
  });
}

function validarEmision(entrada) {
  validarBase(entrada);
  validarInvitacionIdFederacion(entrada.invitacionId);
  if (!Buffer.isBuffer(entrada.credencialHash) || entrada.credencialHash.length !== 32) {
    throw new Error('credencialHash debe ser una huella SHA-256 binaria.');
  }
  if (!/^sfid1\.instalacion\.[A-Za-z0-9_-]{21}[AQgw]$/u.test(entrada.installationReceptoraId)) {
    throw new Error('installationReceptoraId no es canónica.');
  }
  if (!Number.isSafeInteger(entrada.ttlSegundos) || entrada.ttlSegundos < 60 || entrada.ttlSegundos > 86400) {
    throw new Error('ttlSegundos está fuera del contrato.');
  }
}

function validarRevocacion(entrada) {
  validarBase(entrada);
  validarInvitacionIdFederacion(entrada.invitacionId);
}

function validarCanje(entrada) {
  if (typeof entrada?.provisionadorCanjePendiente?.registrarEnTransaccion !== 'function') {
    throw new Error('El canje requiere provisionadorCanjePendiente transaccional.');
  }
  if (typeof entrada.secretoPersistente !== 'string' ||
      !/^sfr1_[A-Za-z0-9_-]{64}$/u.test(entrada.secretoPersistente)) {
    throw new Error('El secreto persistente generado no es válido.');
  }
  if (!entrada.invitacion?.destino?.relacionId || !entrada.invitacion?.invitacionId) {
    throw new Error('La invitación canónica es obligatoria para el canje.');
  }
}

function validarBase(entrada) {
  if (!/^sfid1\.relacion\.[A-Za-z0-9_-]{21}[AQgw]$/u.test(String(entrada.relacionId || ''))) {
    throw new Error('relacionId no es canónica.');
  }
  if (!entrada.auditoria?.actor?.real?.id) throw new Error('La auditoría humana es obligatoria.');
}

function scopeRelacion(relacion) {
  return Object.freeze({
    tenantId: decimalNullable(relacion.scope_tenant_id),
    empresaId: decimalNullable(relacion.scope_empresa_id),
    sitioId: decimalNullable(relacion.scope_sitio_id)
  });
}

function decimalNullable(valor) {
  return valor == null ? null : String(valor);
}

function fechaIso(valor) {
  return new Date(String(valor).replace(' ', 'T').replace(/Z?$/u, 'Z')).toISOString();
}

function fechaIsoNullable(valor) {
  return valor == null ? null : fechaIso(valor);
}

function exigirRelacionReceptoraPendiente(relacion) {
  if (
    relacion.direccion !== 'recepcion' ||
    !['pendienteVinculacion', 'pendienteConfirmacionIdentidad']
      .includes(relacion.estado_ciclo) ||
    relacion.estado_autoridad !== 'autorizada'
  ) {
    throw new InvitacionCanjeNoDisponible('relacion_no_disponible');
  }
}

export class InvitacionCanjeRechazada extends Error {
  constructor() {
    super('La invitación o su credencial temporal no son válidas.');
    this.name = 'InvitacionCanjeRechazada';
    this.codigo = 'INVITACION_RECHAZADA';
    this.statusCode = 401;
  }
}

export class InvitacionCanjeNoDisponible extends Error {
  constructor(estado) {
    super('La invitación ya no está disponible para canje.');
    this.name = 'InvitacionCanjeNoDisponible';
    this.codigo = 'INVITACION_NO_DISPONIBLE';
    this.statusCode = 410;
    this.estado = estado;
  }
}

import {
  generarUuidV7Auditoria,
  uuidV7AuditoriaABytes
} from '../../auditoria/src/UuidV7Auditoria.js';

export class RepositorioImportacionesFederacionSql {
  constructor(clienteSql, {
    repositorioCredenciales,
    protectorSecretoPersistente,
    adaptadorAuditoriaControl,
    adaptadorAuditoriaSeguridad
  } = {}) {
    if (!clienteSql?.obtenerConexion ||
        typeof repositorioCredenciales?.guardarSecretoEmisorEnTransaccion !== 'function' ||
        typeof protectorSecretoPersistente?.cifrar !== 'function' ||
        typeof adaptadorAuditoriaControl?.registrarEnTransaccion !== 'function' ||
        typeof adaptadorAuditoriaSeguridad?.registrarEnTransaccion !== 'function') {
      throw new Error('Las importaciones federadas requieren SQL, custodia y auditoría.');
    }
    this.clienteSql = clienteSql;
    this.repositorioCredenciales = repositorioCredenciales;
    this.protector = protectorSecretoPersistente;
    this.auditoriaControl = adaptadorAuditoriaControl;
    this.auditoriaSeguridad = adaptadorAuditoriaSeguridad;
  }

  prepararEmision(entrada = {}) {
    validarBase(entrada);
    return this.#transaccion(async (conexion) => {
      const existente = await bloquearRelacionOpcional(conexion, entrada.relacionId);
      if (existente) {
        exigirReservaCompatible(existente, entrada);
        const usuario = await bloquearUsuario(conexion, entrada.actor.real.id);
        exigirAutoridad(usuario, entrada.scope, 'emision');
        return Object.freeze({ estado: 'ya_preparada' });
      }
      const usuario = await bloquearUsuario(conexion, entrada.actor.real.id);
      exigirAutoridad(usuario, entrada.scope, 'emision');
      const ahora = await ahoraSql(conexion);
      await conexion.execute(
        `INSERT INTO relaciones_federacion (
          relacion_id,direccion,estado_ciclo,estado_autoridad,estado_identidad,
          estado_compatibilidad,installation_remota_candidata_id,
          installation_remota_id,nombre_remoto_declarado,responsable_usuario_id,
          responsable_original_usuario_id,scope_tenant_id,scope_empresa_id,
          scope_sitio_id,version_autoridad,corte_autoridad_utc,
          creada_por_usuario_id,creada_en_utc,actualizada_en_utc,revision
        ) VALUES (?,'emision','pendienteVinculacion','autorizada','valida',
          NULL,NULL,NULL,NULL,?,?,?,?,?,1,NULL,?,?,?,1)`,
        [entrada.relacionId, entrada.actor.real.id, entrada.actor.real.id,
          entrada.scope.tenantId, entrada.scope.empresaId, entrada.scope.sitioId,
          entrada.actor.real.id, ahora, ahora]
      );
      await insertarHistorico(conexion, {
        relacionId: entrada.relacionId,
        ordinal: 1,
        tipo: 'creacion',
        estadoAnterior: null,
        estadoNuevo: 'pendienteVinculacion',
        responsableUsuarioId: entrada.actor.real.id,
        scope: entrada.scope,
        eventoId: entrada.eventoId,
        correlacionId: entrada.correlacionId,
        ahora,
        detalle: { direccion: 'emision', origen: 'importacion_portal' }
      });
      await this.auditoriaControl.registrarEnTransaccion({
        ...entrada,
        tipo: 'federacion.vinculacion_solicitada',
        revisionConcesionId: null,
        motivoCodigo: 'importacion_invitacion',
        efectivoEnUtc: ahora
      }, { conexion });
      return Object.freeze({ estado: 'preparada' });
    });
  }

  validarRecuperacion(entrada = {}) {
    validarBase(entrada);
    validarIdentidad(entrada.installationRemotaId, 'instalacion', 'installationRemotaId');
    return this.#transaccion(async (conexion) => {
      const relacion = await bloquearRelacion(conexion, entrada.relacionId);
      exigirRecuperacionCompatible(relacion, entrada.installationRemotaId);
      const usuario = await bloquearUsuario(conexion, entrada.actor.real.id);
      exigirAutoridad(usuario, scopeRelacion(relacion), 'emision', {
        gestionarCredenciales: true
      });
      return Object.freeze({ estado: 'autorizada' });
    });
  }

  consolidarInvitacion(entrada = {}) {
    validarBase(entrada);
    validarIdentidad(entrada.installationLocalId, 'instalacion', 'installationLocalId');
    validarIdentidad(entrada.installationRemotaId, 'instalacion', 'installationRemotaId');
    validarSecreto(entrada.secretoPersistente);
    validarOrigen(entrada.origenPublico);
    return this.#transaccion(async (conexion) => {
      const relacion = await bloquearRelacion(conexion, entrada.relacionId);
      exigirReservaCompatible(relacion, entrada);
      const usuario = await bloquearUsuario(conexion, entrada.actor.real.id);
      exigirAutoridad(usuario, scopeRelacion(relacion), 'emision', {
        gestionarCredenciales: true
      });
      const ahora = await ahoraSql(conexion);
      await this.repositorioCredenciales.guardarSecretoEmisorEnTransaccion({
        relacionId: entrada.relacionId,
        installationLocalId: entrada.installationLocalId,
        installationRemotaId: entrada.installationRemotaId,
        secreto: entrada.secretoPersistente
      }, { conexion, protector: this.protector });
      const [actualizacion] = await conexion.execute(
        `UPDATE relaciones_federacion
            SET estado_ciclo='pendienteAutenticacion',
                installation_remota_candidata_id=?,installation_remota_id=?,
                nombre_remoto_declarado=?,revision=revision+1,actualizada_en_utc=?
          WHERE relacion_id=? AND revision=?`,
        [entrada.installationRemotaId, entrada.installationRemotaId,
          entrada.nombreRemotoDeclarado, ahora, entrada.relacionId, relacion.revision]
      );
      if (actualizacion.affectedRows !== 1) {
        throw new Error('La reserva emisora cambió concurrentemente.');
      }
      await reemplazarLocalizacion(conexion, {
        relacionId: entrada.relacionId,
        origenPublico: entrada.origenPublico,
        usuarioId: entrada.actor.real.id,
        eventoId: generarUuidV7Auditoria(),
        correlacionId: entrada.correlacionId,
        ahora,
        origenPropuesta: 'configuracionLocal'
      });
      await insertarHistorico(conexion, {
        relacionId: entrada.relacionId,
        ordinal: await siguienteOrdinal(conexion, entrada.relacionId),
        tipo: 'identidadConfirmada',
        estadoAnterior: relacion.estado_ciclo,
        estadoNuevo: 'pendienteAutenticacion',
        responsableUsuarioId: relacion.responsable_usuario_id,
        scope: scopeRelacion(relacion),
        eventoId: entrada.eventoId,
        correlacionId: entrada.correlacionId,
        ahora,
        detalle: {
          installationRemotaId: entrada.installationRemotaId,
          origen: 'importacion_invitacion'
        }
      });
      await this.auditoriaControl.registrarEnTransaccion({
        eventoId: entrada.eventoId,
        correlacionId: entrada.correlacionId,
        actor: entrada.actor,
        relacionId: entrada.relacionId,
        tipo: 'federacion.vinculacion_confirmada',
        scope: scopeRelacion(relacion),
        revisionConcesionId: null,
        motivoCodigo: 'invitacion_importada',
        efectivoEnUtc: ahora
      }, { conexion });
      return Object.freeze({
        estado: 'pendienteAutenticacion',
        relacionId: entrada.relacionId
      });
    });
  }

  aplicarRecuperacion(entrada = {}) {
    validarBase(entrada);
    validarIdentidad(entrada.installationLocalId, 'instalacion', 'installationLocalId');
    validarIdentidad(entrada.installationRemotaId, 'instalacion', 'installationRemotaId');
    validarSecreto(entrada.secretoPersistente);
    validarOrigen(entrada.origenPublico);
    return this.#transaccion(async (conexion) => {
      const relacion = await bloquearRelacion(conexion, entrada.relacionId);
      exigirRecuperacionCompatible(relacion, entrada.installationRemotaId);
      const usuario = await bloquearUsuario(conexion, entrada.actor.real.id);
      exigirAutoridad(usuario, scopeRelacion(relacion), 'emision');
      const ahora = await ahoraSql(conexion);
      const credencial = await this.repositorioCredenciales
        .guardarSecretoEmisorEnTransaccion({
          relacionId: entrada.relacionId,
          installationLocalId: entrada.installationLocalId,
          installationRemotaId: entrada.installationRemotaId,
          secreto: entrada.secretoPersistente
        }, { conexion, protector: this.protector });
      await reemplazarLocalizacion(conexion, {
        relacionId: entrada.relacionId,
        origenPublico: entrada.origenPublico,
        usuarioId: entrada.actor.real.id,
        eventoId: generarUuidV7Auditoria(),
        correlacionId: entrada.correlacionId,
        ahora,
        origenPropuesta: 'recuperacion'
      });
      await this.auditoriaSeguridad.registrarEnTransaccion({
        eventoId: entrada.eventoId,
        correlacionId: entrada.correlacionId,
        actor: entrada.actor,
        relacionId: entrada.relacionId,
        tipo: 'federacion.credencial_recuperada',
        sujetoId: entrada.relacionId,
        scope: scopeRelacion(relacion),
        motivoCodigo: 'recuperacion_importada',
        efectivoEnUtc: ahora
      }, { conexion });
      return Object.freeze({
        estado: 'recuperada',
        versionCredencial: credencial.versionCredencial
      });
    });
  }

  async #transaccion(trabajo) {
    const conexion = await this.clienteSql.obtenerConexion();
    try {
      await conexion.beginTransaction();
      const resultado = await trabajo(conexion);
      await conexion.commit();
      return resultado;
    } catch (error) {
      try { await conexion.rollback(); } catch { /* conserva la causa */ }
      throw error;
    } finally { conexion.release(); }
  }
}

async function reemplazarLocalizacion(conexion, entrada) {
  const [actuales] = await conexion.execute(
    `SELECT endpoint_https FROM localizaciones_relaciones_federacion
      WHERE relacion_id=? AND estado='activa' FOR UPDATE`,
    [entrada.relacionId]
  );
  if (actuales[0]?.endpoint_https === entrada.origenPublico) return;
  await conexion.execute(
    `UPDATE localizaciones_relaciones_federacion
        SET estado='sustituida',relacion_localizacion_activa=NULL,
            finalizada_en_utc=?
      WHERE relacion_id=? AND estado='activa'`,
    [entrada.ahora, entrada.relacionId]
  );
  await conexion.execute(
    `INSERT INTO localizaciones_relaciones_federacion (
      localizacion_id,relacion_id,endpoint_https,estado,
      relacion_localizacion_activa,origen_propuesta,propuesta_por_usuario_id,
      aprobada_por_usuario_id,propuesta_en_utc,aprobada_en_utc,
      finalizada_en_utc,evento_auditoria_id,correlacion_id
    ) VALUES (?, ?,?,'activa',?,?, ?,?,?,?,NULL,?,?)`,
    [uuidV7AuditoriaABytes(entrada.eventoId), entrada.relacionId,
      entrada.origenPublico, entrada.relacionId, entrada.origenPropuesta,
      entrada.usuarioId, entrada.usuarioId, entrada.ahora, entrada.ahora,
      uuidV7AuditoriaABytes(entrada.eventoId),
      uuidV7AuditoriaABytes(entrada.correlacionId)]
  );
}

async function insertarHistorico(conexion, entrada) {
  await conexion.execute(
    `INSERT INTO historico_estados_relaciones_federacion (
      relacion_id,ordinal,cambio_tipo,estado_ciclo_anterior,estado_ciclo_nuevo,
      estado_autoridad_anterior,estado_autoridad_nuevo,
      estado_identidad_anterior,estado_identidad_nuevo,
      estado_compatibilidad_anterior,estado_compatibilidad_nuevo,
      version_autoridad,responsable_usuario_id,scope_tenant_id,
      scope_empresa_id,scope_sitio_id,efectivo_en_utc,registrado_en_utc,
      evento_auditoria_id,correlacion_id,detalle
    ) VALUES (?,?,?,?,?,'autorizada','autorizada','valida','valida',NULL,NULL,
      1,?,?,?,?,?,?,?,?,?)`,
    [entrada.relacionId, entrada.ordinal, entrada.tipo, entrada.estadoAnterior,
      entrada.estadoNuevo, entrada.responsableUsuarioId, entrada.scope.tenantId,
      entrada.scope.empresaId, entrada.scope.sitioId, entrada.ahora, entrada.ahora,
      uuidV7AuditoriaABytes(entrada.eventoId),
      uuidV7AuditoriaABytes(entrada.correlacionId), JSON.stringify(entrada.detalle)]
  );
}

async function siguienteOrdinal(conexion, relacionId) {
  const [filas] = await conexion.execute(
    `SELECT COALESCE(MAX(ordinal),0)+1 AS ordinal
       FROM historico_estados_relaciones_federacion WHERE relacion_id=?`,
    [relacionId]
  );
  return Number(filas[0].ordinal);
}

async function bloquearRelacion(conexion, relacionId) {
  const relacion = await bloquearRelacionOpcional(conexion, relacionId);
  if (!relacion) throw new Error('La relación federada no existe.');
  return relacion;
}
async function bloquearRelacionOpcional(conexion, relacionId) {
  const [filas] = await conexion.execute(
    'SELECT * FROM relaciones_federacion WHERE relacion_id=? FOR UPDATE',
    [relacionId]
  );
  return filas[0] || null;
}
async function bloquearUsuario(conexion, usuarioId) {
  const [filas] = await conexion.execute(
    `SELECT activo,tenant_id,empresa_id,sitio_id,
            permiso_configurar_emisiones_federacion,
            permiso_gestionar_credenciales_federacion
       FROM usuarios WHERE id=? FOR UPDATE`,
    [usuarioId]
  );
  if (!filas[0]) throw new Error('El responsable local ya no existe.');
  return filas[0];
}
function exigirAutoridad(
  usuario,
  scope,
  direccion,
  { gestionarCredenciales = false } = {}
) {
  if (direccion !== 'emision' || !Boolean(usuario.activo) ||
      !Boolean(usuario.permiso_configurar_emisiones_federacion) ||
      (gestionarCredenciales &&
        !Boolean(usuario.permiso_gestionar_credenciales_federacion)) ||
      decimal(usuario.tenant_id) !== scope.tenantId ||
      decimal(usuario.empresa_id) !== scope.empresaId ||
      decimal(usuario.sitio_id) !== scope.sitioId) {
    throw new Error('El responsable ya no conserva autoridad emisora en el scope exacto.');
  }
}
function exigirReservaCompatible(relacion, entrada) {
  if (relacion.direccion !== 'emision' ||
      relacion.estado_ciclo !== 'pendienteVinculacion' ||
      relacion.estado_autoridad !== 'autorizada' ||
      String(relacion.responsable_usuario_id) !== entrada.actor.real.id ||
      decimal(relacion.scope_tenant_id) !== entrada.scope.tenantId ||
      decimal(relacion.scope_empresa_id) !== entrada.scope.empresaId ||
      decimal(relacion.scope_sitio_id) !== entrada.scope.sitioId) {
    throw new Error('La identidad de relación ya pertenece a otra configuración local.');
  }
}
function exigirRecuperacionCompatible(relacion, installationRemotaId) {
  if (relacion.direccion !== 'emision' ||
      !['vinculada', 'deshabilitada'].includes(relacion.estado_ciclo) ||
      relacion.estado_identidad !== 'valida' ||
      relacion.installation_remota_id !== installationRemotaId) {
    throw new Error('La recuperación no corresponde a una relación emisora válida.');
  }
}
function validarBase(entrada) {
  validarIdentidad(entrada.relacionId, 'relacion', 'relacionId');
  if (entrada.actor?.modo !== 'directo' || entrada.actor.real?.tipo !== 'usuario' ||
      entrada.actor.efectivo != null || !/^[1-9][0-9]*$/u.test(entrada.actor.real.id)) {
    throw new Error('Importar una relación exige una sesión humana directa.');
  }
  if (!entrada.scope || ['tenantId','empresaId','sitioId'].some((campo) =>
    entrada.scope[campo] !== null && !/^[1-9][0-9]*$/u.test(entrada.scope[campo]))) {
    throw new Error('El scope de importación no es válido.');
  }
  if ((entrada.scope.tenantId === null &&
      (entrada.scope.empresaId !== null || entrada.scope.sitioId !== null)) ||
      (entrada.scope.empresaId === null && entrada.scope.sitioId !== null)) {
    throw new Error('El scope de importación no conserva la jerarquía.');
  }
  uuidV7AuditoriaABytes(entrada.eventoId);
  uuidV7AuditoriaABytes(entrada.correlacionId);
}
function validarIdentidad(valor, tipo, campo) {
  if (!new RegExp(`^sfid1\\.${tipo}\\.[A-Za-z0-9_-]{21}[AQgw]$`, 'u')
    .test(String(valor || ''))) throw new Error(`${campo} no es canónica.`);
}
function validarSecreto(valor) {
  if (!/^sfr1_[A-Za-z0-9_-]{64}$/u.test(String(valor || ''))) {
    throw new Error('La respuesta no contiene un secreto persistente válido.');
  }
}
function validarOrigen(valor) {
  const url = new URL(String(valor || ''));
  if (url.protocol !== 'https:' || url.origin !== valor || url.pathname !== '/' ||
      url.search || url.hash || url.username || url.password) {
    throw new Error('El origen importado no es HTTPS canónico.');
  }
}
function scopeRelacion(relacion) {
  return {
    tenantId: decimal(relacion.scope_tenant_id),
    empresaId: decimal(relacion.scope_empresa_id),
    sitioId: decimal(relacion.scope_sitio_id)
  };
}
function decimal(valor) { return valor == null ? null : String(valor); }
async function ahoraSql(conexion) {
  const [filas] = await conexion.execute(
    "SELECT DATE_FORMAT(UTC_TIMESTAMP(3), '%Y-%m-%d %H:%i:%s.%f') AS ahora"
  );
  return String(filas[0].ahora).slice(0, 23);
}

import { createHash } from 'node:crypto';
import { canonicalizarJsonFederacion } from '../src/CanonicalizadorFederacion.js';
import { compararSeleccionesConcesionFederacion } from '../src/RevisionConcesionFederacion.js';
import { generarUuidV7Auditoria, uuidV7AuditoriaABytes } from '../../auditoria/src/UuidV7Auditoria.js';

const REINTENTABLES = new Set(['ER_DUP_ENTRY', 'ER_LOCK_DEADLOCK', 'ER_LOCK_WAIT_TIMEOUT']);

export class RepositorioControlFederacionSql {
  constructor(clienteSql, {
    adaptadorAuditoria, servicioAvisos, repositorioConsecuenciasDatos = null,
    maxReintentos = 3
  } = {}) {
    if (!clienteSql?.obtenerConexion) throw new Error('El control federado requiere SQL.');
    if (typeof adaptadorAuditoria?.registrarEnTransaccion !== 'function') {
      throw new Error('El control federado requiere auditoría transaccional.');
    }
    if (typeof servicioAvisos?.detectar !== 'function') {
      throw new Error('El control federado requiere avisos de plataforma transaccionales.');
    }
    if (!Number.isSafeInteger(maxReintentos) || maxReintentos < 0 || maxReintentos > 10) {
      throw new Error('maxReintentos debe estar entre 0 y 10.');
    }
    this.clienteSql = clienteSql;
    this.adaptadorAuditoria = adaptadorAuditoria;
    this.servicioAvisos = servicioAvisos;
    if (repositorioConsecuenciasDatos !== null &&
        typeof repositorioConsecuenciasDatos?.aplicarEnTransaccion !== 'function') {
      throw new Error('Las consecuencias del plano de datos no son válidas.');
    }
    this.repositorioConsecuenciasDatos = repositorioConsecuenciasDatos;
    this.maxReintentos = maxReintentos;
  }

  registrarRevision(entrada) {
    return this.#atomico(entrada.relacionId, async ({ conexion, relacion, ahora }) => {
      const repetida = await obtenerRevisionPorIdentidad(
        conexion,
        entrada.revision.revisionId
      );
      if (repetida) {
        validarReplayRevision(repetida, entrada);
        return Object.freeze({
          estado: 'ya_procesada',
          ordinal: Number(repetida.ordinal),
          eventoAuditoria: null
        });
      }
      exigirAutoridad(relacion, entrada.versionAutoridad);
      if (String(relacion.responsable_usuario_id) !== String(entrada.responsableUsuarioId)) {
        throw new Error('La revisión no pertenece al responsable actual de la relación.');
      }
      await exigirResponsableRevisionActual(
        conexion,
        relacion,
        entrada.auditoria.actor.real.id
      );
      if (entrada.revision.papel === 'efectiva') {
        await validarReferenciasEfectivas(conexion, entrada);
      }
      const anterior = await obtenerRevisionActual(conexion, entrada.relacionId, entrada.revision.papel);
      const ordinal = anterior ? Number(anterior.ordinal) + 1 : 1;
      let claseCambio = 'inicial';
      if (anterior) {
        claseCambio = compararSeleccionesConcesionFederacion(
          json(anterior.seleccion), entrada.revision.seleccion
        );
        await finalizarRevision(conexion, anterior.revision_id,
          ['reduccion', 'mixta'].includes(claseCambio) ? 'reducida' : 'sustituida', ahora);
      }
      await insertarRevision(conexion, {
        ...entrada, ordinal, estado: entrada.revision.seleccion.vacia ? 'vacia' : 'vigente',
        ahora
      });
      await apuntarRevision(conexion, entrada.relacionId, entrada.revision.papel,
        entrada.revision.revisionId, ahora);
      if (entrada.revision.papel !== 'efectiva' &&
          ['reduccion', 'mixta'].includes(claseCambio)) {
        const efectivaAnterior = await obtenerRevisionActual(
          conexion, entrada.relacionId, 'efectiva'
        ) || await obtenerUltimaRevisionEfectiva(conexion, entrada.relacionId);
        if (efectivaAnterior && this.repositorioConsecuenciasDatos) {
          await this.repositorioConsecuenciasDatos.aplicarEnTransaccion({
            relacionId: entrada.relacionId,
            revisionAnteriorId: efectivaAnterior.revision_id,
            revisionSiguienteId: entrada.revision.revisionId,
            seleccionAnterior: json(efectivaAnterior.seleccion),
            seleccionSiguiente: intersectarReduccionEfectiva(
              json(efectivaAnterior.seleccion),
              entrada.revision.seleccion
            ),
            causa: 'reduccionConcesion',
            ahora
          }, { conexion });
        }
        await retirarRevisionEfectivaActual(conexion, entrada.relacionId, ahora);
      }
      await incrementarRevisionRelacion(conexion, entrada.relacionId, relacion.revision, ahora);
      const evento = await this.adaptadorAuditoria.registrarEnTransaccion({
        ...entrada.auditoria,
        tipo: 'federacion.concesion_revisada',
        relacionId: entrada.relacionId,
        revisionConcesionId: entrada.revision.revisionId,
        scope: scopeRelacion(relacion), efectivoEnUtc: ahora
      }, { conexion });
      return Object.freeze({ estado: 'revisada', ordinal, eventoAuditoria: evento });
    });
  }

  cortarAutoridad(entrada) {
    return this.#atomico(entrada.relacionId, async ({ conexion, relacion, ahora }) => {
      if (relacion.estado_autoridad === 'sinAutoridad') return Object.freeze({ estado: 'sin_cambios' });
      return aplicarCorteEnTransaccion({
        conexion, relacion, causa: entrada.causa, auditoria: entrada.auditoria,
        ahora, adaptadorAuditoria: this.adaptadorAuditoria,
        servicioAvisos: this.servicioAvisos,
        repositorioConsecuenciasDatos: this.repositorioConsecuenciasDatos
      });
    });
  }

  async cortarDependenciasEnTransaccion({
    usuarioIds = [], scopeAfectado = null, causa, actor
  } = {}, { conexion } = {}) {
    if (!conexion?.execute) throw new Error('El corte por dependencia exige conexión prestada.');
    if (!Array.isArray(usuarioIds) ||
        usuarioIds.some((id) => !/^[1-9][0-9]*$/.test(String(id)))) {
      throw new Error('usuarioIds contiene una identidad no canónica.');
    }
    const ids = [...new Set(usuarioIds.map(String))];
    const condiciones = [];
    const parametros = [];
    if (ids.length) {
      condiciones.push(`responsable_usuario_id IN (${ids.map(() => '?').join(',')})`);
      parametros.push(...ids);
    }
    if (scopeAfectado) {
      const columna = { tenant: 'scope_tenant_id', empresa: 'scope_empresa_id', sitio: 'scope_sitio_id' }[scopeAfectado.entidad];
      if (!columna || !/^[1-9][0-9]*$/.test(String(scopeAfectado.id))) {
        throw new Error('El scope afectado por la dependencia no es válido.');
      }
      condiciones.push(`${columna}=?`);
      parametros.push(String(scopeAfectado.id));
    }
    if (!condiciones.length) return Object.freeze([]);
    const [relaciones] = await conexion.execute(
      `SELECT * FROM relaciones_federacion WHERE estado_autoridad='autorizada'
       AND estado_ciclo<>'eliminada' AND (${condiciones.join(' OR ')})
       ORDER BY relacion_id FOR UPDATE`, parametros
    );
    const ahora = await ahoraSql(conexion);
    const resultados = [];
    for (const relacion of relaciones) {
      const auditoria = {
        eventoId: generarUuidV7Auditoria(), correlacionId: generarUuidV7Auditoria(), actor
      };
      resultados.push(await aplicarCorteEnTransaccion({
        conexion, relacion, causa, auditoria, ahora,
        adaptadorAuditoria: this.adaptadorAuditoria,
        servicioAvisos: this.servicioAvisos,
        repositorioConsecuenciasDatos: this.repositorioConsecuenciasDatos
      }));
    }
    return Object.freeze(resultados);
  }

  async reevaluarAutoridadUsuarioEnTransaccion({ usuarioId, actor } = {}, {
    conexion
  } = {}) {
    if (!conexion?.execute) {
      throw new Error('La reevaluación de autoridad exige conexión prestada.');
    }
    if (!/^[1-9][0-9]*$/.test(String(usuarioId))) {
      throw new Error('usuarioId no es válido para reevaluar autoridad federada.');
    }
    const [usuarios] = await conexion.execute(
      `SELECT id, activo, tenant_id, empresa_id, sitio_id,
              permiso_configurar_emisiones_federacion,
              permiso_configurar_recepciones_federacion
       FROM usuarios WHERE id=? FOR UPDATE`,
      [String(usuarioId)]
    );
    const [relaciones] = await conexion.execute(
      `SELECT * FROM relaciones_federacion
       WHERE responsable_usuario_id=? AND estado_autoridad='autorizada'
         AND estado_ciclo<>'eliminada'
       ORDER BY relacion_id FOR UPDATE`,
      [String(usuarioId)]
    );
    if (relaciones.length === 0) return Object.freeze([]);
    const usuario = usuarios[0] || null;
    const ahora = await ahoraSql(conexion);
    const resultados = [];
    for (const relacion of relaciones) {
      const causa = causaPerdidaAutoridadUsuario(usuario, relacion);
      if (!causa) continue;
      resultados.push(await aplicarCorteEnTransaccion({
        conexion,
        relacion,
        causa,
        auditoria: {
          eventoId: generarUuidV7Auditoria(),
          correlacionId: generarUuidV7Auditoria(),
          actor
        },
        ahora,
        adaptadorAuditoria: this.adaptadorAuditoria,
        servicioAvisos: this.servicioAvisos,
        repositorioConsecuenciasDatos: this.repositorioConsecuenciasDatos
      }));
    }
    return Object.freeze(resultados);
  }

  transferirResponsabilidad(entrada) {
    return this.#atomico(entrada.relacionId, async ({ conexion, relacion, ahora }) => {
      const repetida = await obtenerCambioRelacionPorEvento(
        conexion,
        entrada.auditoria.eventoId
      );
      if (repetida) {
        validarReplayTransferencia(repetida, entrada);
        return Object.freeze({
          estado: 'ya_procesada',
          versionAutoridad: String(repetida.version_autoridad),
          eventoAuditoria: null
        });
      }
      if (relacion.estado_ciclo === 'eliminada') throw new Error('Una relación eliminada no admite transferencia.');
      if (relacion.estado_autoridad !== 'sinAutoridad') {
        throw new Error('La transferencia exige un corte de autoridad previo.');
      }
      await exigirOperadorControlActual(
        conexion,
        relacion,
        entrada.auditoria.actor.real.id,
        'transferir'
      );
      await exigirAutoridadNuevoResponsable(
        conexion,
        entrada.nuevoResponsableUsuarioId,
        relacion,
        entrada.scope
      );
      const version = BigInt(relacion.version_autoridad) + 1n;
      const [resultado] = await conexion.execute(
        `UPDATE relaciones_federacion SET estado_autoridad='autorizada',
           responsable_usuario_id=?, scope_tenant_id=?, scope_empresa_id=?, scope_sitio_id=?,
           version_autoridad=?, corte_autoridad_utc=NULL, revision=revision+1,
           actualizada_en_utc=? WHERE relacion_id=? AND revision=?`,
        [entrada.nuevoResponsableUsuarioId, entrada.scope.tenantId, entrada.scope.empresaId,
          entrada.scope.sitioId, version.toString(), ahora, entrada.relacionId, relacion.revision]
      );
      if (resultado.affectedRows !== 1) throw concurrente();
      await insertarHistoricoRelacion(conexion, relacion, {
        tipo: 'responsabilidadTransferida', estadoCiclo: relacion.estado_ciclo,
        estadoAutoridad: 'autorizada', responsable: entrada.nuevoResponsableUsuarioId,
        scope: entrada.scope, version, ahora, eventoId: entrada.auditoria.eventoId,
        correlacionId: entrada.auditoria.correlacionId,
        detalle: { responsableAnteriorUsuarioId: relacion.responsable_usuario_id }
      });
      const evento = await this.adaptadorAuditoria.registrarEnTransaccion({
        ...entrada.auditoria, tipo: 'federacion.responsabilidad_transferida',
        relacionId: entrada.relacionId, revisionConcesionId: null,
        motivoCodigo: null, scope: entrada.scope, efectivoEnUtc: ahora
      }, { conexion });
      return Object.freeze({ estado: 'transferida', versionAutoridad: version.toString(), eventoAuditoria: evento });
    });
  }

  deshabilitarRelacion(entrada) {
    return this.#atomico(entrada.relacionId, async ({ conexion, relacion, ahora }) => {
      await exigirOperadorControlActual(
        conexion,
        relacion,
        entrada.auditoria.actor.real.id,
        'activar'
      );
      if (relacion.estado_ciclo === 'deshabilitada') return Object.freeze({ estado: 'sin_cambios' });
      if (relacion.estado_ciclo !== 'vinculada') throw new Error('Solo una relación vinculada puede deshabilitarse.');
      const [resultado] = await conexion.execute(
        `UPDATE relaciones_federacion SET estado_ciclo='deshabilitada', revision=revision+1,
         actualizada_en_utc=? WHERE relacion_id=? AND revision=?`,
        [ahora, entrada.relacionId, relacion.revision]
      );
      if (resultado.affectedRows !== 1) throw concurrente();
      await aplicarConsecuenciaTotalSiExiste({
        conexion, relacion, causa: 'relacionDeshabilitada', ahora,
        repositorioConsecuenciasDatos: this.repositorioConsecuenciasDatos
      });
      await insertarHistoricoRelacion(conexion, relacion, {
        tipo: 'estadoCambiado', estadoCiclo: 'deshabilitada',
        estadoAutoridad: relacion.estado_autoridad,
        responsable: relacion.responsable_usuario_id,
        version: BigInt(relacion.version_autoridad), ahora,
        eventoId: entrada.auditoria.eventoId,
        correlacionId: entrada.auditoria.correlacionId,
        detalle: { causa: 'deshabilitacion' }
      });
      const evento = await this.adaptadorAuditoria.registrarEnTransaccion({
        ...entrada.auditoria, tipo: 'federacion.relacion_estado_cambiado',
        relacionId: entrada.relacionId, revisionConcesionId: null,
        motivoCodigo: 'deshabilitacion', scope: scopeRelacion(relacion), efectivoEnUtc: ahora
      }, { conexion });
      return Object.freeze({ estado: 'deshabilitada', eventoAuditoria: evento });
    });
  }

  eliminarRelacion(entrada) {
    return this.#atomico(entrada.relacionId, async ({ conexion, relacion, ahora }) => {
      await exigirOperadorControlActual(
        conexion,
        relacion,
        entrada.auditoria.actor.real.id,
        'activar'
      );
      if (relacion.estado_ciclo === 'eliminada') return Object.freeze({ estado: 'sin_cambios' });
      const version = BigInt(relacion.version_autoridad) + 1n;
      const [resultado] = await conexion.execute(
        `UPDATE relaciones_federacion SET estado_ciclo='eliminada',
         estado_autoridad='sinAutoridad', responsable_usuario_id=NULL,
         version_autoridad=?, corte_autoridad_utc=?, revision=revision+1,
         actualizada_en_utc=? WHERE relacion_id=? AND revision=?`,
        [version.toString(), ahora, ahora, entrada.relacionId, relacion.revision]
      );
      if (resultado.affectedRows !== 1) throw concurrente();
      await aplicarConsecuenciaTotalSiExiste({
        conexion, relacion, causa: 'relacionEliminada', ahora,
        repositorioConsecuenciasDatos: this.repositorioConsecuenciasDatos
      });
      await conexion.execute(
        'DELETE FROM credenciales_persistentes_federacion WHERE relacion_id=?',
        [entrada.relacionId]
      );
      await cancelarConcesiones(conexion, entrada.relacionId, ahora);
      await conexion.execute(
        `INSERT INTO cortes_autoridad_federacion (
          relacion_id, version_autoridad, causa, responsable_usuario_id,
          scope_tenant_id, scope_empresa_id, scope_sitio_id, corte_en_utc,
          evento_auditoria_id, correlacion_id
        ) VALUES (?, ?, 'eliminacionRelacion', ?, ?, ?, ?, ?, ?, ?)`,
        [entrada.relacionId, version.toString(), relacion.responsable_usuario_id,
          relacion.scope_tenant_id, relacion.scope_empresa_id, relacion.scope_sitio_id,
          ahora, uuidV7AuditoriaABytes(entrada.auditoria.eventoId),
          uuidV7AuditoriaABytes(entrada.auditoria.correlacionId)]
      );
      await conexion.execute(
        `INSERT INTO tombstones_relaciones_federacion (
          relacion_id, installation_remota_id, direccion, version_autoridad_final,
          eliminada_en_utc, eliminada_por_usuario_id, evento_auditoria_id, correlacion_id
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [entrada.relacionId, relacion.installation_remota_id, relacion.direccion,
          version.toString(), ahora, entrada.eliminadaPorUsuarioId,
          uuidV7AuditoriaABytes(entrada.auditoria.eventoId),
          uuidV7AuditoriaABytes(entrada.auditoria.correlacionId)]
      );
      await insertarHistoricoRelacion(conexion, relacion, {
        tipo: 'eliminacion', estadoCiclo: 'eliminada', estadoAutoridad: 'sinAutoridad',
        responsable: null, version, ahora, eventoId: entrada.auditoria.eventoId,
        correlacionId: entrada.auditoria.correlacionId,
        detalle: { causa: 'eliminacion_terminal' }
      });
      const evento = await this.adaptadorAuditoria.registrarEnTransaccion({
        ...entrada.auditoria, tipo: 'federacion.relacion_estado_cambiado',
        relacionId: entrada.relacionId, revisionConcesionId: null,
        motivoCodigo: 'eliminacion_relacion', scope: scopeRelacion(relacion), efectivoEnUtc: ahora
      }, { conexion });
      return Object.freeze({ estado: 'eliminada', versionAutoridad: version.toString(), eventoAuditoria: evento });
    });
  }

  async #atomico(relacionId, trabajo) {
    let intento = 0;
    while (true) {
      const conexion = await this.clienteSql.obtenerConexion();
      try {
        await conexion.beginTransaction();
        const relacion = await bloquearRelacion(conexion, relacionId);
        const ahora = await ahoraSql(conexion);
        const resultado = await trabajo({ conexion, relacion, ahora });
        await conexion.commit();
        return Object.freeze({ ...resultado, reintentos: intento });
      } catch (error) {
        await rollback(conexion);
        if (!REINTENTABLES.has(error?.code) || intento >= this.maxReintentos) throw error;
        intento += 1;
      } finally { conexion.release(); }
    }
  }
}

async function obtenerRevisionPorIdentidad(conexion, revisionId) {
  const [filas] = await conexion.execute(
    `SELECT * FROM revisiones_concesion_federacion
     WHERE revision_id=? LIMIT 1 FOR UPDATE`,
    [revisionId]
  );
  return filas[0] || null;
}

function validarReplayRevision(existente, entrada) {
  const refs = entrada.referencias || {};
  const coincide = existente.relacion_id === entrada.relacionId &&
    existente.papel === entrada.revision.papel &&
    canonicalizarJsonFederacion(json(existente.seleccion)) ===
      canonicalizarJsonFederacion(entrada.revision.seleccion) &&
    String(existente.autorizada_por_usuario_id) ===
      String(entrada.responsableUsuarioId) &&
    String(existente.version_autoridad) === String(entrada.versionAutoridad) &&
    decimalNullable(existente.version_autoridad_remota) ===
      (entrada.revision.papel === 'efectiva'
        ? String(entrada.versionAutoridadRemota ?? entrada.versionAutoridad)
        : null) &&
    (existente.revision_oferta_id || null) === (refs.ofertaId || null) &&
    (existente.revision_aceptacion_id || null) === (refs.aceptacionId || null) &&
    Buffer.from(existente.evento_auditoria_id).equals(
      uuidV7AuditoriaABytes(entrada.auditoria.eventoId)
    ) &&
    Buffer.from(existente.correlacion_id).equals(
      uuidV7AuditoriaABytes(entrada.auditoria.correlacionId)
    );
  if (!coincide) {
    throw new Error('revisionConcesionId ya pertenece a otro contenido o autoridad.');
  }
}

async function obtenerCambioRelacionPorEvento(conexion, eventoId) {
  const [filas] = await conexion.execute(
    `SELECT * FROM historico_estados_relaciones_federacion
     WHERE evento_auditoria_id=? LIMIT 1 FOR UPDATE`,
    [uuidV7AuditoriaABytes(eventoId)]
  );
  return filas[0] || null;
}

function validarReplayTransferencia(existente, entrada) {
  const scope = entrada.scope;
  const coincide = existente.relacion_id === entrada.relacionId &&
    existente.cambio_tipo === 'responsabilidadTransferida' &&
    String(existente.responsable_usuario_id) ===
      String(entrada.nuevoResponsableUsuarioId) &&
    decimalNullable(existente.scope_tenant_id) === scope.tenantId &&
    decimalNullable(existente.scope_empresa_id) === scope.empresaId &&
    decimalNullable(existente.scope_sitio_id) === scope.sitioId &&
    Buffer.from(existente.correlacion_id).equals(
      uuidV7AuditoriaABytes(entrada.auditoria.correlacionId)
    );
  if (!coincide) {
    throw new Error('El eventoId ya pertenece a otra transición de relación federada.');
  }
}

function decimalNullable(valor) {
  return valor == null ? null : String(valor);
}

function causaPerdidaAutoridadUsuario(usuario, relacion) {
  if (!usuario) return 'usuarioEliminado';
  if (!Boolean(usuario.activo)) return 'usuarioInactivo';
  if (!scopeUsuarioCubreRelacion(usuario, relacion)) return 'scopePerdido';
  if (relacion.direccion === 'emision' &&
      !Boolean(usuario.permiso_configurar_emisiones_federacion)) {
    return 'permisoPerdido';
  }
  if (relacion.direccion === 'recepcion' &&
      !Boolean(usuario.permiso_configurar_recepciones_federacion)) {
    return 'permisoPerdido';
  }
  return null;
}

function scopeUsuarioCubreRelacion(usuario, relacion) {
  const tenantUsuario = decimalNullable(usuario.tenant_id);
  const empresaUsuario = decimalNullable(usuario.empresa_id);
  const sitioUsuario = decimalNullable(usuario.sitio_id);
  if (tenantUsuario === null) return empresaUsuario === null && sitioUsuario === null;
  if (tenantUsuario !== decimalNullable(relacion.scope_tenant_id)) return false;
  if (empresaUsuario === null) return sitioUsuario === null;
  if (empresaUsuario !== decimalNullable(relacion.scope_empresa_id)) return false;
  if (sitioUsuario === null) return true;
  return sitioUsuario === decimalNullable(relacion.scope_sitio_id);
}

async function exigirAutoridadNuevoResponsable(
  conexion,
  usuarioId,
  relacion,
  scopeDeclarado
) {
  const [filas] = await conexion.execute(
    `SELECT activo,tenant_id,empresa_id,sitio_id,
            permiso_configurar_emisiones_federacion,
            permiso_configurar_recepciones_federacion
       FROM usuarios WHERE id=? FOR UPDATE`,
    [usuarioId]
  );
  const usuario = filas[0];
  const scopeRelacionActual = scopeRelacion(relacion);
  if (!usuario || !Boolean(usuario.activo) ||
      scopeRelacionActual.tenantId !== scopeDeclarado.tenantId ||
      scopeRelacionActual.empresaId !== scopeDeclarado.empresaId ||
      scopeRelacionActual.sitioId !== scopeDeclarado.sitioId ||
      !scopeUsuarioCubreRelacion(usuario, relacion) ||
      (relacion.direccion === 'emision'
        ? !Boolean(usuario.permiso_configurar_emisiones_federacion)
        : !Boolean(usuario.permiso_configurar_recepciones_federacion))) {
    throw new Error(
      'El nuevo responsable ya no conserva permiso y scope exactos para la relación.'
    );
  }
}

async function exigirResponsableRevisionActual(
  conexion,
  relacion,
  usuarioId
) {
  const [filas] = await conexion.execute(
    `SELECT activo,tenant_id,empresa_id,sitio_id,
            permiso_configurar_emisiones_federacion,
            permiso_configurar_recepciones_federacion
       FROM usuarios WHERE id=? FOR UPDATE`,
    [usuarioId]
  );
  const usuario = filas[0];
  const permisoVigente = relacion.direccion === 'emision'
    ? Boolean(usuario?.permiso_configurar_emisiones_federacion)
    : Boolean(usuario?.permiso_configurar_recepciones_federacion);
  if (!usuario || !Boolean(usuario.activo) || !permisoVigente ||
      !scopeUsuarioCubreRelacion(usuario, relacion)) {
    throw new Error(
      'El responsable ya no conserva permiso y scope actuales para revisar la concesión.'
    );
  }
}

async function exigirOperadorControlActual(
  conexion,
  relacion,
  usuarioId,
  capacidad
) {
  const columnaPermiso = capacidad === 'transferir'
    ? 'permiso_transferir_responsabilidad_federacion'
    : 'permiso_activar_relaciones_federacion';
  const [filas] = await conexion.execute(
    `SELECT activo,tenant_id,empresa_id,sitio_id,${columnaPermiso} AS permitido
       FROM usuarios WHERE id=? FOR UPDATE`,
    [usuarioId]
  );
  const usuario = filas[0];
  if (!usuario || !Boolean(usuario.activo) || !Boolean(usuario.permitido) ||
      !scopeUsuarioAlcanzaRelacion(usuario, relacion)) {
    throw new Error('El operador ya no conserva autoridad actual sobre la relación.');
  }
}

function scopeUsuarioAlcanzaRelacion(usuario, relacion) {
  const tenant = decimalNullable(usuario.tenant_id);
  const empresa = decimalNullable(usuario.empresa_id);
  const sitio = decimalNullable(usuario.sitio_id);
  if (tenant === null) return empresa === null && sitio === null;
  if (tenant !== decimalNullable(relacion.scope_tenant_id)) return false;
  if (empresa === null) return sitio === null;
  if (empresa !== decimalNullable(relacion.scope_empresa_id)) return false;
  return sitio === null || sitio === decimalNullable(relacion.scope_sitio_id);
}

async function bloquearRelacion(conexion, relacionId) {
  const [filas] = await conexion.execute(
    'SELECT * FROM relaciones_federacion WHERE relacion_id=? FOR UPDATE', [relacionId]
  );
  if (!filas[0]) throw new Error('La relación federada no existe.');
  return filas[0];
}

async function aplicarCorteEnTransaccion({
  conexion, relacion, causa, auditoria, ahora, adaptadorAuditoria, servicioAvisos,
  repositorioConsecuenciasDatos = null
}) {
  const version = BigInt(relacion.version_autoridad) + 1n;
  const [actualizacion] = await conexion.execute(
    `UPDATE relaciones_federacion SET estado_autoridad='sinAutoridad',
       responsable_usuario_id=NULL, version_autoridad=?, corte_autoridad_utc=?,
       revision=revision+1, actualizada_en_utc=?
     WHERE relacion_id=? AND revision=? AND estado_autoridad='autorizada'`,
    [version.toString(), ahora, ahora, relacion.relacion_id, relacion.revision]
  );
  if (actualizacion.affectedRows !== 1) throw concurrente();
  await aplicarConsecuenciaTotalSiExiste({
    conexion, relacion, causa: 'sinAutoridad', ahora,
    repositorioConsecuenciasDatos
  });
  await cancelarConcesiones(conexion, relacion.relacion_id, ahora);
  await conexion.execute(
    `INSERT INTO cortes_autoridad_federacion (
       relacion_id, version_autoridad, causa, responsable_usuario_id,
       scope_tenant_id, scope_empresa_id, scope_sitio_id, corte_en_utc,
       evento_auditoria_id, correlacion_id
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [relacion.relacion_id, version.toString(), causa, relacion.responsable_usuario_id,
      relacion.scope_tenant_id, relacion.scope_empresa_id, relacion.scope_sitio_id,
      ahora, uuidV7AuditoriaABytes(auditoria.eventoId),
      uuidV7AuditoriaABytes(auditoria.correlacionId)]
  );
  await insertarHistoricoRelacion(conexion, relacion, {
    tipo: 'autoridadPerdida', estadoCiclo: relacion.estado_ciclo,
    estadoAutoridad: 'sinAutoridad', responsable: null, version, ahora,
    eventoId: auditoria.eventoId, correlacionId: auditoria.correlacionId,
    detalle: { causa }
  });
  const evento = await adaptadorAuditoria.registrarEnTransaccion({
    ...auditoria, tipo: 'federacion.relacion_estado_cambiado',
    relacionId: relacion.relacion_id, revisionConcesionId: null,
    motivoCodigo: causa, scope: scopeRelacion(relacion), efectivoEnUtc: ahora
  }, { conexion });
  await servicioAvisos.detectar({
    eventoId: generarUuidV7Auditoria(),
    correlacionId: auditoria.correlacionId,
    efectivoEnUtc: `${ahora.replace(' ', 'T')}Z`,
    causalidad: null,
    actor: { tipo: 'runtime', id: 'sentinelia-runtime' },
    claveCausal: {
      versionCatalogo: 1,
      tipoCodigo: 'autoridad',
      causaCodigo: 'perdida_autoridad_responsable',
      objetoTipo: 'responsable_federacion',
      objetoId: `usuario:${relacion.responsable_usuario_id}`,
      relacionId: relacion.relacion_id,
      flujoId: null,
      scope: scopeRelacion(relacion)
    },
    contextoHumano: {
      relacionId: relacion.relacion_id,
      causaCodigo: causa
    },
    resumen: { versionAutoridad: version.toString() }
  }, { conexion });
  return Object.freeze({
    estado: 'autoridad_cortada', relacionId: relacion.relacion_id,
    versionAutoridad: version.toString(), eventoAuditoria: evento
  });
}

async function aplicarConsecuenciaTotalSiExiste({
  conexion, relacion, causa, ahora, repositorioConsecuenciasDatos
}) {
  if (!repositorioConsecuenciasDatos) return;
  const efectivaAnterior = await obtenerRevisionActual(
    conexion, relacion.relacion_id, 'efectiva'
  );
  if (!efectivaAnterior) return;
  await repositorioConsecuenciasDatos.aplicarEnTransaccion({
    relacionId: relacion.relacion_id,
    revisionAnteriorId: efectivaAnterior.revision_id,
    seleccionAnterior: json(efectivaAnterior.seleccion),
    seleccionSiguiente: null,
    causa,
    ahora
  }, { conexion });
}

function intersectarReduccionEfectiva(efectiva, declaracion) {
  const nivelesPermitidos = new Set(declaracion.nivelesScope || []);
  const nivelesScope = (efectiva.nivelesScope || [])
    .filter((nivel) => nivelesPermitidos.has(nivel));
  const familias = {};
  for (const [familia, selectorEfectivo] of Object.entries(efectiva.familias || {})) {
    const selectorDeclarado = declaracion.familias?.[familia];
    if (!selectorDeclarado) continue;
    const camposPermitidos = new Set(selectorDeclarado.campos || []);
    familias[familia] = {
      campos: (selectorEfectivo.campos || [])
        .filter((campo) => camposPermitidos.has(campo)),
      permiteContenidoSensible: Boolean(
        selectorEfectivo.permiteContenidoSensible &&
        selectorDeclarado.permiteContenidoSensible
      ),
      permiteRefederacion: Boolean(
        selectorEfectivo.permiteRefederacion && selectorDeclarado.permiteRefederacion
      )
    };
  }
  const activa = Boolean(efectiva.activa && declaracion.activa &&
    nivelesScope.length && Object.keys(familias).length);
  return {
    activa,
    vacia: !activa,
    nivelesScope: activa ? nivelesScope : [],
    familias: activa ? familias : {}
  };
}

async function obtenerRevisionActual(conexion, relacionId, papel) {
  const columna = { oferta: 'revision_oferta_actual_id', aceptacion: 'revision_aceptacion_actual_id', efectiva: 'revision_efectiva_actual_id' }[papel];
  const [filas] = await conexion.execute(
    `SELECT r.* FROM estado_concesion_relaciones_federacion e
     JOIN revisiones_concesion_federacion r ON r.revision_id=e.${columna}
     WHERE e.relacion_id=?`, [relacionId]
  );
  return filas[0] || null;
}

async function obtenerUltimaRevisionEfectiva(conexion, relacionId) {
  const [filas] = await conexion.execute(
    `SELECT * FROM revisiones_concesion_federacion
      WHERE relacion_id=? AND papel='efectiva'
      ORDER BY version_autoridad DESC,ordinal DESC LIMIT 1 FOR UPDATE`,
    [relacionId]
  );
  return filas[0] || null;
}

async function validarReferenciasEfectivas(conexion, entrada) {
  const refs = entrada.referencias || {};
  const [filas] = await conexion.execute(
    `SELECT r.revision_id, r.papel, r.seleccion
     FROM revisiones_concesion_federacion r
     JOIN estado_concesion_relaciones_federacion e ON e.relacion_id=r.relacion_id
     WHERE r.relacion_id=? AND r.revision_id IN (?, ?) FOR UPDATE`,
    [entrada.relacionId, refs.ofertaId, refs.aceptacionId]
  );
  const porId = new Map(filas.map((fila) => [fila.revision_id, fila]));
  const oferta = porId.get(refs.ofertaId);
  const aceptacion = porId.get(refs.aceptacionId);
  if (oferta?.papel !== 'oferta' || aceptacion?.papel !== 'aceptacion') {
    throw new Error('La revisión efectiva no referencia una oferta y aceptación vigentes de la relación.');
  }
  const [estado] = await conexion.execute(
    `SELECT revision_oferta_actual_id, revision_aceptacion_actual_id
     FROM estado_concesion_relaciones_federacion WHERE relacion_id=? FOR UPDATE`,
    [entrada.relacionId]
  );
  if (estado[0]?.revision_oferta_actual_id !== refs.ofertaId ||
      estado[0]?.revision_aceptacion_actual_id !== refs.aceptacionId) {
    throw new Error('La oferta o aceptación dejó de ser actual antes de consolidar la efectiva.');
  }
  if (canonicalizarJsonFederacion(json(oferta.seleccion)) !==
      canonicalizarJsonFederacion(refs.ofertaSeleccion) ||
      canonicalizarJsonFederacion(json(aceptacion.seleccion)) !==
      canonicalizarJsonFederacion(refs.aceptacionSeleccion)) {
    throw new Error('La intersección efectiva no corresponde a las revisiones referenciadas.');
  }
}

async function insertarRevision(conexion, entrada) {
  const canonico = canonicalizarJsonFederacion(entrada.revision.seleccion);
  const huella = createHash('sha256').update(canonico).digest();
  const refs = entrada.referencias || {};
  await conexion.execute(
    `INSERT INTO revisiones_concesion_federacion (
       revision_id, relacion_id, papel, procedencia, ordinal, estado, revision_oferta_id,
       revision_aceptacion_id, seleccion, huella_seleccion,
       autorizada_por_usuario_id, version_autoridad, version_autoridad_remota, creada_en_utc,
       vigente_desde_utc, evento_auditoria_id, correlacion_id
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [entrada.revision.revisionId, entrada.relacionId, entrada.revision.papel,
      entrada.revision.papel === 'efectiva' ? 'derivada' : 'local',
      entrada.ordinal, entrada.estado, refs.ofertaId || null, refs.aceptacionId || null,
      canonico, huella, entrada.responsableUsuarioId, entrada.versionAutoridad,
      entrada.revision.papel === 'efectiva'
        ? String(entrada.versionAutoridadRemota ?? entrada.versionAutoridad)
        : null,
      entrada.ahora, entrada.ahora, uuidV7AuditoriaABytes(entrada.auditoria.eventoId),
      uuidV7AuditoriaABytes(entrada.auditoria.correlacionId)]
  );
  for (const [familia, selector] of Object.entries(entrada.revision.seleccion.familias || {})) {
    await conexion.execute(
      `INSERT INTO selectores_revision_concesion_federacion
       (revision_id, familia, niveles_scope, campos, permite_contenido_sensible, permite_refederacion)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [entrada.revision.revisionId, familia,
        JSON.stringify(entrada.revision.seleccion.nivelesScope || []),
        JSON.stringify(selector.campos), selector.permiteContenidoSensible,
        selector.permiteRefederacion]
    );
  }
}

async function apuntarRevision(conexion, relacionId, papel, revisionId, ahora) {
  const columna = { oferta: 'revision_oferta_actual_id', aceptacion: 'revision_aceptacion_actual_id', efectiva: 'revision_efectiva_actual_id' }[papel];
  await conexion.execute(
    `INSERT INTO estado_concesion_relaciones_federacion (relacion_id, ${columna}, revision, actualizada_en_utc)
     VALUES (?, ?, 1, ?) ON DUPLICATE KEY UPDATE ${columna}=VALUES(${columna}),
     revision=revision+1, actualizada_en_utc=VALUES(actualizada_en_utc)`,
    [relacionId, revisionId, ahora]
  );
}

async function finalizarRevision(conexion, revisionId, estado, ahora) {
  await conexion.execute(
    `UPDATE revisiones_concesion_federacion SET estado=?, finalizada_en_utc=?
     WHERE revision_id=?`, [estado, ahora, revisionId]
  );
}

async function cancelarConcesiones(conexion, relacionId, ahora) {
  await conexion.execute(
    `UPDATE revisiones_concesion_federacion SET estado='cancelada', finalizada_en_utc=?
     WHERE relacion_id=? AND estado IN ('propuesta','vigente','vacia')`, [ahora, relacionId]
  );
  await conexion.execute(
    `UPDATE estado_concesion_relaciones_federacion SET revision_oferta_actual_id=NULL,
       revision_aceptacion_actual_id=NULL, revision_efectiva_actual_id=NULL,
       revision=revision+1, actualizada_en_utc=? WHERE relacion_id=?`, [ahora, relacionId]
  );
}

async function retirarRevisionEfectivaActual(conexion, relacionId, ahora) {
  const actual = await obtenerRevisionActual(conexion, relacionId, 'efectiva');
  if (!actual) return;
  await finalizarRevision(conexion, actual.revision_id, 'reducida', ahora);
  await conexion.execute(
    `UPDATE estado_concesion_relaciones_federacion
     SET revision_efectiva_actual_id=NULL, revision=revision+1, actualizada_en_utc=?
     WHERE relacion_id=?`, [ahora, relacionId]
  );
}

async function incrementarRevisionRelacion(conexion, relacionId, revision, ahora) {
  const [r] = await conexion.execute(
    `UPDATE relaciones_federacion SET revision=revision+1, actualizada_en_utc=?
     WHERE relacion_id=? AND revision=?`, [ahora, relacionId, revision]
  );
  if (r.affectedRows !== 1) throw concurrente();
}

async function insertarHistoricoRelacion(conexion, relacion, cambio) {
  const [filas] = await conexion.execute(
    'SELECT COALESCE(MAX(ordinal),0)+1 AS ordinal FROM historico_estados_relaciones_federacion WHERE relacion_id=?',
    [relacion.relacion_id]
  );
  const scope = cambio.scope || scopeRelacion(relacion);
  await conexion.execute(
    `INSERT INTO historico_estados_relaciones_federacion (
       relacion_id, ordinal, cambio_tipo, estado_ciclo_anterior, estado_ciclo_nuevo,
       estado_autoridad_anterior, estado_autoridad_nuevo, estado_identidad_anterior,
       estado_identidad_nuevo, estado_compatibilidad_anterior, estado_compatibilidad_nuevo,
       version_autoridad, responsable_usuario_id, scope_tenant_id, scope_empresa_id,
       scope_sitio_id, efectivo_en_utc, registrado_en_utc, evento_auditoria_id,
       correlacion_id, detalle
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [relacion.relacion_id, filas[0].ordinal, cambio.tipo, relacion.estado_ciclo,
      cambio.estadoCiclo, relacion.estado_autoridad, cambio.estadoAutoridad,
      relacion.estado_identidad, relacion.estado_identidad, relacion.estado_compatibilidad,
      relacion.estado_compatibilidad, cambio.version.toString(), cambio.responsable,
      scope.tenantId, scope.empresaId, scope.sitioId, cambio.ahora, cambio.ahora,
      uuidV7AuditoriaABytes(cambio.eventoId), uuidV7AuditoriaABytes(cambio.correlacionId),
      JSON.stringify(cambio.detalle)]
  );
}

function exigirAutoridad(relacion, version) {
  if (relacion.estado_autoridad !== 'autorizada') throw new Error('La relación carece de autoridad actual.');
  if (String(relacion.version_autoridad) !== String(version)) throw concurrente();
}
function scopeRelacion(r) { return Object.freeze({ tenantId: r.scope_tenant_id == null ? null : String(r.scope_tenant_id), empresaId: r.scope_empresa_id == null ? null : String(r.scope_empresa_id), sitioId: r.scope_sitio_id == null ? null : String(r.scope_sitio_id) }); }
function json(valor) { return typeof valor === 'string' ? JSON.parse(valor) : valor; }
async function ahoraSql(c) { const [f] = await c.execute("SELECT DATE_FORMAT(UTC_TIMESTAMP(3), '%Y-%m-%d %H:%i:%s.%f') AS ahora"); return String(f[0].ahora).slice(0, 23); }
function concurrente() { const e = new Error('El control federado cambió concurrentemente.'); e.code = 'FEDERACION_REVISION_CONFLICTO'; return e; }
async function rollback(c) { try { await c.rollback(); } catch {} }

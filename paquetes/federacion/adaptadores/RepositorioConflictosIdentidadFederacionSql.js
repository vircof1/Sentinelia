import { generarUuidV7Auditoria, bytesAUuidV7Auditoria,
  uuidV7AuditoriaABytes } from '../../auditoria/src/UuidV7Auditoria.js';

export class RepositorioConflictosIdentidadFederacionSql {
  constructor(clienteSql, { adaptadorAuditoria, servicioAvisos } = {}) {
    if (!clienteSql?.obtenerConexion || !clienteSql?.consultar ||
        typeof adaptadorAuditoria?.registrarEnTransaccion !== 'function' ||
        typeof servicioAvisos?.detectar !== 'function' ||
        typeof servicioAvisos?.cambiarGravedad !== 'function' ||
        typeof servicioAvisos?.resolver !== 'function') {
      throw new Error('Los conflictos de identidad exigen SQL, auditoría y avisos.');
    }
    this.clienteSql = clienteSql;
    this.adaptadorAuditoria = adaptadorAuditoria;
    this.servicioAvisos = servicioAvisos;
  }

  observar(entrada) {
    return this.#transaccion(async (conexion) => {
      const ahora = await ahoraSql(conexion);
      let incidente = await bloquearIncidenteAbierto(conexion, entrada.installationRemotaId);
      const estadoSolicitado = entrada.confirmar ? 'conflicto' : 'sospecha';
      let transicion = 'sin_cambios';
      if (!incidente) {
        await conexion.execute(
          `INSERT INTO incidentes_identidad_federacion (
            incidente_id,installation_remota_id,estado,boot_ids,evidencia,
            primera_deteccion_utc,ultima_deteccion_utc,confirmado_en_utc,resuelto_en_utc,
            resuelto_por_usuario_id,installation_clon_nueva_id,requiere_resincronizacion,
            evento_deteccion_id,evento_resolucion_id,incidente_abierto_installation_id
          ) VALUES (?,?,?,?,?,?,?, ?,NULL,NULL,NULL,0,?,NULL,?)`,
          [uuidV7AuditoriaABytes(entrada.incidenteId), entrada.installationRemotaId,
            estadoSolicitado, JSON.stringify(entrada.bootIds), JSON.stringify(entrada.evidencia),
            ahora, ahora, entrada.confirmar ? ahora : null,
            uuidV7AuditoriaABytes(entrada.eventoDeteccionId), entrada.installationRemotaId]
        );
        incidente = await bloquearIncidenteAbierto(conexion, entrada.installationRemotaId);
        transicion = entrada.confirmar ? 'conflicto_confirmado' : 'sospecha_creada';
      } else {
        const confirmaAhora = incidente.estado === 'sospecha' && entrada.confirmar;
        await conexion.execute(
          `UPDATE incidentes_identidad_federacion SET estado=?,boot_ids=?,evidencia=?,
             ultima_deteccion_utc=?,confirmado_en_utc=IF(?=1,?,confirmado_en_utc)
           WHERE incidente_id=?`,
          [confirmaAhora ? 'conflicto' : incidente.estado,
            JSON.stringify(entrada.bootIds), JSON.stringify(entrada.evidencia),
            ahora, confirmaAhora ? 1 : 0, ahora, incidente.incidente_id]
        );
        if (confirmaAhora) transicion = 'conflicto_confirmado';
      }
      const incidenteId = bytesAUuidV7Auditoria(incidente.incidente_id);
      const relacionesNuevas = [];
      for (const presencia of entrada.presencias) {
        if (await vincularRelacion(conexion, incidente.incidente_id, presencia, ahora)) {
          relacionesNuevas.push(presencia.relacionId);
        }
      }
      const estadoIncidente = entrada.confirmar || incidente.estado === 'conflicto'
        ? 'conflicto' : 'sospecha';
      if (estadoIncidente === 'sospecha' && relacionesNuevas.length) {
        const relaciones = await cargarRelaciones(conexion,
          [...new Set(relacionesNuevas)]);
        for (const relacion of relaciones) {
          await detectarAviso(this.servicioAvisos, conexion, relacion, incidenteId,
            entrada.bootIds, ahora, 'sospecha');
        }
      }
      const relacionesCuarentena = estadoIncidente === 'conflicto'
        ? await confirmarConflicto({
            conexion,
            installationRemotaId: entrada.installationRemotaId,
            incidenteId,
            bootIds: entrada.bootIds,
            ahora,
            adaptadorAuditoria: this.adaptadorAuditoria,
            servicioAvisos: this.servicioAvisos
          })
        : [];
      return Object.freeze({
        incidenteId,
        estado: estadoIncidente,
        transicion,
        relacionesCuarentena: Object.freeze(relacionesCuarentena)
      });
    });
  }

  async listarAbiertos() {
    const incidentes = await this.clienteSql.consultar(
      `SELECT incidente_id,installation_remota_id,estado,boot_ids,evidencia,
              primera_deteccion_utc,ultima_deteccion_utc,confirmado_en_utc
         FROM incidentes_identidad_federacion
        WHERE estado IN ('sospecha','conflicto')
        ORDER BY ultima_deteccion_utc DESC,incidente_id`
    );
    if (!incidentes.length) return Object.freeze([]);
    const resultado = [];
    for (const incidente of incidentes) {
      const relaciones = await this.clienteSql.consultar(
        `SELECT ri.relacion_id,ri.boot_ids,ri.papel,
                r.direccion,r.estado_ciclo,r.estado_identidad,
                r.nombre_remoto_declarado,r.scope_tenant_id,
                r.scope_empresa_id,r.scope_sitio_id
           FROM relaciones_incidente_identidad_federacion ri
           JOIN relaciones_federacion r ON r.relacion_id=ri.relacion_id
          WHERE ri.incidente_id=? ORDER BY ri.relacion_id`,
        [incidente.incidente_id]
      );
      resultado.push(Object.freeze({
        incidenteId: bytesAUuidV7Auditoria(incidente.incidente_id),
        installationRemotaId: incidente.installation_remota_id,
        estado: incidente.estado,
        bootIds: Object.freeze(jsonLista(incidente.boot_ids)),
        evidencia: Object.freeze(jsonObjeto(incidente.evidencia)),
        primeraDeteccionEnUtc: fechaIso(incidente.primera_deteccion_utc),
        ultimaDeteccionEnUtc: fechaIso(incidente.ultima_deteccion_utc),
        confirmadoEnUtc: incidente.confirmado_en_utc == null
          ? null
          : fechaIso(incidente.confirmado_en_utc),
        relaciones: Object.freeze(relaciones.map(sanearRelacionIncidente))
      }));
    }
    return Object.freeze(resultado);
  }

  resolver(entrada) {
    return this.#transaccion(async (conexion) => {
      const incidente = await bloquearIncidente(conexion, entrada.incidenteId);
      if (incidente.estado === 'resuelto') {
        if (bytesAUuidV7Auditoria(incidente.evento_resolucion_id) !== entrada.eventoId) {
          throw new Error('El conflicto ya fue resuelto por otra decisión.');
        }
        return Object.freeze({ estado: 'resuelto', repetida: true });
      }
      if (incidente.estado !== 'conflicto') {
        throw new Error('Una sospecha no puede resolverse como clon confirmado.');
      }
      await exigirOperadorPortal(conexion, entrada.actor.real.id);
      const [vinculos] = await conexion.execute(
        `SELECT DISTINCT relacion_id FROM relaciones_incidente_identidad_federacion
          WHERE incidente_id=? ORDER BY relacion_id FOR UPDATE`,
        [incidente.incidente_id]
      );
      const afectadas = vinculos.map((fila) => fila.relacion_id);
      validarParticion(afectadas, entrada.relacionesLegitimas, entrada.relacionesClon);
      if (entrada.installationClonNuevaId === incidente.installation_remota_id) {
        throw new Error('El clon debe recibir un installationId nuevo.');
      }
      await exigirRelacionesNuevasClon(conexion, {
        installationClonNuevaId: entrada.installationClonNuevaId,
        relacionesClon: entrada.relacionesClon,
        relacionesNuevasClon: entrada.relacionesNuevasClon
      });
      const ahora = await ahoraSql(conexion);
      let primero = true;
      for (const relacionId of afectadas) {
        const relacion = (await cargarRelaciones(conexion, [relacionId]))[0];
        const legitima = entrada.relacionesLegitimas.includes(relacionId);
        const eventoId = primero ? entrada.eventoId : generarUuidV7Auditoria();
        primero = false;
        if (legitima && relacion.estado_identidad !== 'valida') {
          await conexion.execute(
            `UPDATE relaciones_federacion SET estado_identidad='valida',revision=revision+1,
               actualizada_en_utc=? WHERE relacion_id=?`, [ahora, relacionId]
          );
          await insertarHistoricoIdentidad(conexion, relacion, 'valida', eventoId,
            entrada.correlacionId, ahora, { incidenteId: entrada.incidenteId, papel: 'legitima' });
        }
        await conexion.execute(
          `UPDATE relaciones_incidente_identidad_federacion SET papel=?
            WHERE incidente_id=? AND relacion_id=?`,
          [legitima ? 'legitima' : 'clon', incidente.incidente_id, relacionId]
        );
        await this.adaptadorAuditoria.registrarEnTransaccion({
          eventoId,
          correlacionId: entrada.correlacionId,
          tipo: 'federacion.conflicto_identidad_resuelto',
          actor: entrada.actor,
          sujetoId: incidente.installation_remota_id,
          relacionId,
          scope: scopeRelacion(relacion),
          motivoCodigo: legitima ? 'rama_legitima' : 'rama_clon_reidentificada',
          relacionesAfectadas: afectadas.length,
          efectivoEnUtc: ahora
        }, { conexion });
        if (legitima) {
          await resolverAviso(this.servicioAvisos, conexion, relacion,
            ahora, entrada.correlacionId);
        }
      }
      await conexion.execute(
        `UPDATE incidentes_identidad_federacion SET estado='resuelto',resuelto_en_utc=?,
           resuelto_por_usuario_id=?,installation_clon_nueva_id=?,requiere_resincronizacion=1,
           evento_resolucion_id=?,incidente_abierto_installation_id=NULL
         WHERE incidente_id=? AND estado='conflicto'`,
        [ahora, entrada.actor.real.id, entrada.installationClonNuevaId,
          uuidV7AuditoriaABytes(entrada.eventoId), incidente.incidente_id]
      );
      return Object.freeze({
        estado: 'resuelto', repetida: false, requiereResincronizacion: true,
        relacionesLegitimas: Object.freeze([...entrada.relacionesLegitimas]),
        relacionesClon: Object.freeze([...entrada.relacionesClon]),
        relacionesNuevasClon: Object.freeze([...entrada.relacionesNuevasClon])
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
      try { await conexion.rollback(); } catch { /* conserva causa */ }
      throw error;
    } finally { conexion.release(); }
  }
}

async function confirmarConflicto({ conexion, installationRemotaId, incidenteId,
  bootIds, ahora, adaptadorAuditoria, servicioAvisos }) {
  const [relaciones] = await conexion.execute(
    `SELECT * FROM relaciones_federacion WHERE installation_remota_id=?
      AND estado_ciclo<>'eliminada' ORDER BY relacion_id FOR UPDATE`,
    [installationRemotaId]
  );
  const ids = [];
  for (const relacion of relaciones) {
    ids.push(relacion.relacion_id);
    const eventoId = generarUuidV7Auditoria();
    if (relacion.estado_identidad !== 'conflictiva') {
      await conexion.execute(
        `UPDATE relaciones_federacion SET estado_identidad='conflictiva',revision=revision+1,
           actualizada_en_utc=? WHERE relacion_id=?`, [ahora, relacion.relacion_id]
      );
      await revocarSesiones(conexion, relacion.relacion_id, ahora);
      await insertarHistoricoIdentidad(conexion, relacion, 'conflictiva', eventoId,
        eventoId, ahora, { incidenteId, bootIds });
      await adaptadorAuditoria.registrarEnTransaccion({
        eventoId,
        correlacionId: eventoId,
        tipo: 'federacion.conflicto_identidad_detectado',
        actor: { real: { tipo: 'runtime', id: 'sentinelia-runtime' },
          efectivo: null, modo: 'directo' },
        sujetoId: installationRemotaId,
        relacionId: relacion.relacion_id,
        scope: scopeRelacion(relacion),
        motivoCodigo: 'boot_ids_simultaneos_fuera_margen',
        relacionesAfectadas: relaciones.length,
        efectivoEnUtc: ahora
      }, { conexion });
      await resolverAviso(servicioAvisos, conexion, relacion, ahora, incidenteId, 'sospecha');
      await detectarAviso(servicioAvisos, conexion, relacion, incidenteId, bootIds, ahora,
        'conflicto');
    }
    await vincularRelacion(conexion, uuidV7AuditoriaABytes(incidenteId), {
      relacionId: relacion.relacion_id, bootIds
    }, ahora);
  }
  return ids;
}

async function bloquearIncidenteAbierto(conexion, installationId) {
  const [filas] = await conexion.execute(
    `SELECT * FROM incidentes_identidad_federacion
      WHERE incidente_abierto_installation_id=? FOR UPDATE`, [installationId]
  );
  return filas[0] || null;
}
async function bloquearIncidente(conexion, incidenteId) {
  const [filas] = await conexion.execute(
    'SELECT * FROM incidentes_identidad_federacion WHERE incidente_id=? FOR UPDATE',
    [uuidV7AuditoriaABytes(incidenteId)]
  );
  if (!filas[0]) throw new Error('El incidente de identidad no existe.');
  return filas[0];
}

async function vincularRelacion(conexion, incidenteIdBinario, presencia, ahora) {
  const bootIds = presencia.bootIds || [presencia.bootRemotoId];
  const [resultado] = await conexion.execute(
    `INSERT INTO relaciones_incidente_identidad_federacion (
      incidente_id,relacion_id,boot_ids,papel,vinculada_en_utc
    ) VALUES (?,?,?,'observada',?) ON DUPLICATE KEY UPDATE
      boot_ids=VALUES(boot_ids),vinculada_en_utc=VALUES(vinculada_en_utc)`,
    [incidenteIdBinario, presencia.relacionId, JSON.stringify(bootIds), ahora]
  );
  return Number(resultado.affectedRows) === 1;
}

async function cargarRelaciones(conexion, ids) {
  if (!ids.length) return [];
  const [filas] = await conexion.execute(
    `SELECT * FROM relaciones_federacion WHERE relacion_id IN (${ids.map(() => '?').join(',')})
      ORDER BY relacion_id FOR UPDATE`, ids
  );
  return filas;
}

async function insertarHistoricoIdentidad(conexion, relacion, estadoNuevo,
  eventoId, correlacionId, ahora, detalle) {
  const [ordinal] = await conexion.execute(
    `SELECT COALESCE(MAX(ordinal),0)+1 AS ordinal FROM historico_estados_relaciones_federacion
      WHERE relacion_id=?`, [relacion.relacion_id]
  );
  await conexion.execute(
    `INSERT INTO historico_estados_relaciones_federacion (
      relacion_id,ordinal,cambio_tipo,estado_ciclo_anterior,estado_ciclo_nuevo,
      estado_autoridad_anterior,estado_autoridad_nuevo,estado_identidad_anterior,
      estado_identidad_nuevo,estado_compatibilidad_anterior,estado_compatibilidad_nuevo,
      version_autoridad,responsable_usuario_id,scope_tenant_id,scope_empresa_id,
      scope_sitio_id,efectivo_en_utc,registrado_en_utc,evento_auditoria_id,
      correlacion_id,detalle
    ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    [relacion.relacion_id, ordinal[0].ordinal,
      estadoNuevo === 'conflictiva' ? 'identidadConflictiva' : 'identidadResuelta',
      relacion.estado_ciclo, relacion.estado_ciclo,
      relacion.estado_autoridad, relacion.estado_autoridad,
      relacion.estado_identidad, estadoNuevo,
      relacion.estado_compatibilidad, relacion.estado_compatibilidad,
      String(relacion.version_autoridad), relacion.responsable_usuario_id,
      relacion.scope_tenant_id, relacion.scope_empresa_id, relacion.scope_sitio_id,
      ahora, ahora, uuidV7AuditoriaABytes(eventoId),
      uuidV7AuditoriaABytes(correlacionId), JSON.stringify(detalle)]
  );
}

async function revocarSesiones(conexion, relacionId, ahora) {
  await conexion.execute(
    `INSERT INTO estado_sesiones_federacion (
      relacion_id,fencing_token,version_revocacion,actualizada_en_utc
    ) VALUES (?,1,2,?) ON DUPLICATE KEY UPDATE fencing_token=fencing_token+1,
      version_revocacion=version_revocacion+1,actualizada_en_utc=VALUES(actualizada_en_utc)`,
    [relacionId, ahora]
  );
}

async function detectarAviso(servicio, conexion, relacion, incidenteId, bootIds, ahora, estado) {
  await servicio.detectar({
    eventoId: generarUuidV7Auditoria(), correlacionId: incidenteId,
    efectivoEnUtc: fechaIso(ahora), causalidad: null,
    actor: { tipo: 'runtime', id: 'sentinelia-runtime' },
    claveCausal: claveAviso(relacion, estado),
    contextoHumano: { incidenteId, installationRemotaId: relacion.installation_remota_id },
    resumen: { bootIds }
  }, { conexion });
}
async function resolverAviso(servicio, conexion, relacion, ahora, correlacionId,
  estado = 'conflicto') {
  await servicio.resolver({
    eventoId: generarUuidV7Auditoria(), correlacionId,
    efectivoEnUtc: fechaIso(ahora), causalidad: null,
    actor: { tipo: 'runtime', id: 'sentinelia-runtime' },
    claveCausal: claveAviso(relacion, estado), viaResolucion: 'causa_desaparecida'
  }, { conexion });
}
function claveAviso(relacion, estado = 'conflicto') {
  return {
    versionCatalogo: 1, tipoCodigo: 'identidad',
    causaCodigo: estado === 'sospecha'
      ? 'sospecha_identidad_instalacion' : 'conflicto_identidad_instalacion',
    objetoTipo: 'instalacion_federada', objetoId: relacion.installation_remota_id,
    relacionId: relacion.relacion_id, flujoId: null, scope: scopeRelacion(relacion)
  };
}

async function exigirOperadorPortal(conexion, usuarioId) {
  const [filas] = await conexion.execute(
    `SELECT activo,tenant_id,empresa_id,sitio_id,permiso_resolver_conflictos_federacion
      FROM usuarios WHERE id=? FOR UPDATE`, [usuarioId]
  );
  const usuario = filas[0];
  if (!usuario || !Boolean(usuario.activo) ||
      !Boolean(usuario.permiso_resolver_conflictos_federacion) ||
      usuario.tenant_id != null || usuario.empresa_id != null || usuario.sitio_id != null) {
    throw new Error('Resolver un clon transversal exige un operador directo de portal.');
  }
}

function validarParticion(afectadas, legitimas, clones) {
  if (!Array.isArray(legitimas) || !Array.isArray(clones) || !legitimas.length || !clones.length) {
    throw new Error('La resolución debe distinguir relaciones legítimas y clonadas.');
  }
  const declaradas = [...legitimas, ...clones];
  if (new Set(declaradas).size !== declaradas.length ||
      [...afectadas].sort().join('\0') !== [...declaradas].sort().join('\0')) {
    throw new Error('La resolución debe clasificar exactamente todas las relaciones afectadas.');
  }
}

async function exigirRelacionesNuevasClon(conexion, entrada) {
  if (!Array.isArray(entrada.relacionesNuevasClon) ||
      entrada.relacionesNuevasClon.length !== entrada.relacionesClon.length ||
      new Set(entrada.relacionesNuevasClon).size !== entrada.relacionesNuevasClon.length) {
    throw new Error('Cada relación del clon debe tener una relación nueva inequívoca.');
  }
  const anteriores = await cargarRelaciones(conexion, entrada.relacionesClon);
  const nuevas = await cargarRelaciones(conexion, entrada.relacionesNuevasClon);
  if (nuevas.length !== entrada.relacionesNuevasClon.length || nuevas.some((relacion) =>
    relacion.installation_remota_id !== entrada.installationClonNuevaId ||
    relacion.estado_identidad !== 'valida' ||
    !['vinculada', 'deshabilitada'].includes(relacion.estado_ciclo))) {
    throw new Error('Las relaciones nuevas no demuestran la identidad válida del clon.');
  }
  const formasAnteriores = anteriores.map(formaRelacion).sort();
  const formasNuevas = nuevas.map(formaRelacion).sort();
  if (formasAnteriores.join('\0') !== formasNuevas.join('\0')) {
    throw new Error('Las relaciones nuevas del clon no conservan dirección y scopes afectados.');
  }
}

function formaRelacion(relacion) {
  return JSON.stringify([
    relacion.direccion,
    relacion.scope_tenant_id == null ? null : String(relacion.scope_tenant_id),
    relacion.scope_empresa_id == null ? null : String(relacion.scope_empresa_id),
    relacion.scope_sitio_id == null ? null : String(relacion.scope_sitio_id)
  ]);
}

function scopeRelacion(r) {
  return {
    tenantId: r.scope_tenant_id == null ? null : String(r.scope_tenant_id),
    empresaId: r.scope_empresa_id == null ? null : String(r.scope_empresa_id),
    sitioId: r.scope_sitio_id == null ? null : String(r.scope_sitio_id)
  };
}
async function ahoraSql(conexion) {
  const [filas] = await conexion.execute(
    "SELECT DATE_FORMAT(UTC_TIMESTAMP(3), '%Y-%m-%d %H:%i:%s.%f') AS ahora"
  );
  return String(filas[0].ahora).slice(0, 23);
}
function fechaIso(valor) {
  if (valor instanceof Date) return valor.toISOString();
  return `${String(valor).replace(' ', 'T').replace(/Z$/u, '')}Z`;
}

function sanearRelacionIncidente(fila) {
  return Object.freeze({
    relacionId: fila.relacion_id,
    bootIds: Object.freeze(jsonLista(fila.boot_ids)),
    papel: fila.papel,
    direccion: fila.direccion,
    estadoCiclo: fila.estado_ciclo,
    estadoIdentidad: fila.estado_identidad,
    nombreRemotoDeclarado: fila.nombre_remoto_declarado,
    scope: Object.freeze(scopeRelacion(fila))
  });
}

function jsonLista(valor) {
  const datos = typeof valor === 'string' ? JSON.parse(valor) : valor;
  return Array.isArray(datos) ? datos.map(String) : [];
}

function jsonObjeto(valor) {
  const datos = typeof valor === 'string' ? JSON.parse(valor) : valor;
  return datos && typeof datos === 'object' && !Array.isArray(datos) ? datos : {};
}

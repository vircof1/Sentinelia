import {
  bytesAUuidV7Auditoria,
  uuidV7AuditoriaABytes
} from '../../auditoria/src/UuidV7Auditoria.js';

export class RepositorioRelacionesFederacionSql {
  constructor(clienteSql, { adaptadorAuditoria } = {}) {
    if (!clienteSql?.obtenerConexion) {
      throw new Error('La administración de relaciones federadas requiere SQL.');
    }
    if (typeof adaptadorAuditoria?.registrarEnTransaccion !== 'function') {
      throw new Error('La creación de relaciones federadas requiere auditoría transaccional.');
    }
    this.clienteSql = clienteSql;
    this.adaptadorAuditoria = adaptadorAuditoria;
  }

  async crearRecepcion(entrada = {}) {
    validarCreacion(entrada);
    const conexion = await this.clienteSql.obtenerConexion();
    try {
      await conexion.beginTransaction();
      const usuario = await bloquearUsuario(conexion, entrada.actor.real.id);
      exigirAutoridadActualRecepcion(usuario, entrada.scope);
      const ahora = await ahoraSql(conexion);
      await conexion.execute(
        `INSERT INTO relaciones_federacion (
           relacion_id,direccion,estado_ciclo,estado_autoridad,
           estado_identidad,estado_compatibilidad,
           installation_remota_candidata_id,installation_remota_id,
           nombre_remoto_declarado,responsable_usuario_id,
           responsable_original_usuario_id,scope_tenant_id,scope_empresa_id,
           scope_sitio_id,version_autoridad,corte_autoridad_utc,
           creada_por_usuario_id,creada_en_utc,actualizada_en_utc,revision
         ) VALUES (
           ?,'recepcion','pendienteVinculacion','autorizada','valida',NULL,
           NULL,NULL,NULL,?,?,?,?,?,1,NULL,?,?,?,1
         )`,
        [
          entrada.relacionId,
          entrada.actor.real.id,
          entrada.actor.real.id,
          entrada.scope.tenantId,
          entrada.scope.empresaId,
          entrada.scope.sitioId,
          entrada.actor.real.id,
          ahora,
          ahora
        ]
      );
      await conexion.execute(
        `INSERT INTO historico_estados_relaciones_federacion (
           relacion_id,ordinal,cambio_tipo,estado_ciclo_anterior,
           estado_ciclo_nuevo,estado_autoridad_anterior,estado_autoridad_nuevo,
           estado_identidad_anterior,estado_identidad_nuevo,
           estado_compatibilidad_anterior,estado_compatibilidad_nuevo,
           version_autoridad,responsable_usuario_id,scope_tenant_id,
           scope_empresa_id,scope_sitio_id,efectivo_en_utc,registrado_en_utc,
           evento_auditoria_id,correlacion_id,detalle
         ) VALUES (
           ?,1,'creacion',NULL,'pendienteVinculacion',NULL,'autorizada',
           NULL,'valida',NULL,NULL,1,?,?,?,?,?,?,?,?,?
         )`,
        [
          entrada.relacionId,
          entrada.actor.real.id,
          entrada.scope.tenantId,
          entrada.scope.empresaId,
          entrada.scope.sitioId,
          ahora,
          ahora,
          uuidV7AuditoriaABytes(entrada.eventoId, 'eventoId'),
          uuidV7AuditoriaABytes(entrada.correlacionId, 'correlacionId'),
          JSON.stringify({ direccion: 'recepcion', origen: 'portal' })
        ]
      );
      await this.adaptadorAuditoria.registrarEnTransaccion({
        eventoId: entrada.eventoId,
        correlacionId: entrada.correlacionId,
        actor: entrada.actor,
        tipo: 'federacion.relacion_estado_cambiado',
        relacionId: entrada.relacionId,
        revisionConcesionId: null,
        motivoCodigo: 'creacionRelacion',
        scope: entrada.scope,
        efectivoEnUtc: ahora
      }, { conexion });
      await conexion.commit();
      return Object.freeze({
        relacionId: entrada.relacionId,
        direccion: 'recepcion',
        estadoCiclo: 'pendienteVinculacion',
        scope: Object.freeze({ ...entrada.scope })
      });
    } catch (error) {
      try { await conexion.rollback(); } catch { /* conserva la causa original */ }
      throw error;
    } finally {
      conexion.release();
    }
  }

  async listarVisibles({ scope } = {}) {
    validarScope(scope);
    const { clausula, parametros } = predicadoScopeVisible(scope, 'r');
    const relaciones = await this.clienteSql.consultar(
      `SELECT r.relacion_id,r.direccion,r.estado_ciclo,r.estado_autoridad,
              r.estado_identidad,r.estado_compatibilidad,
              r.installation_remota_candidata_id,r.installation_remota_id,
              r.nombre_remoto_declarado,r.responsable_usuario_id,
              r.responsable_original_usuario_id,
              r.scope_tenant_id,r.scope_empresa_id,r.scope_sitio_id,
              r.version_autoridad,r.creada_en_utc,r.actualizada_en_utc,
              u.usuario AS responsable_usuario,
              u.nombre_mostrar AS responsable_nombre_mostrar,
              u.nombre_completo AS responsable_nombre_completo,
              uo.usuario AS responsable_original_usuario,
              uo.nombre_mostrar AS responsable_original_nombre_mostrar,
              uo.nombre_completo AS responsable_original_nombre_completo,
              t.nombre AS scope_tenant_nombre,e.nombre AS scope_empresa_nombre,
              si.nombre AS scope_sitio_nombre,
              c.ordinal AS candidatura_ordinal,
              c.boot_remoto_candidato_id,c.protocolo_version AS candidato_protocolo,
              c.producto_version AS candidato_producto,
              c.registrada_en_utc AS candidatura_registrada_en_utc,
              i.invitacion_id,i.estado AS invitacion_estado,
              i.expira_en_utc AS invitacion_expira_en_utc,
              l.endpoint_https AS localizacion_propuesta_endpoint,
              l.localizacion_id AS localizacion_propuesta_id,
              s.ultimo_seq,s.boot_remoto_id,s.estado_compatibilidad AS salud_compatibilidad,
              s.estado_temporal,s.ultimo_heartbeat_utc,
              ec.revision AS concesion_revision,
              ec.revision_oferta_actual_id,ec.revision_aceptacion_actual_id,
              ec.revision_efectiva_actual_id,
              ro.ordinal AS oferta_ordinal,ro.seleccion AS oferta_seleccion,
              ra.ordinal AS aceptacion_ordinal,ra.seleccion AS aceptacion_seleccion,
              re.ordinal AS efectiva_ordinal,re.seleccion AS efectiva_seleccion
         FROM relaciones_federacion r
         LEFT JOIN candidaturas_identidad_federacion c
           ON c.relacion_id=r.relacion_id AND c.estado='pendiente'
         LEFT JOIN invitaciones_establecimiento_federacion i
           ON i.relacion_vigente_id=r.relacion_id AND i.estado='vigente'
         LEFT JOIN localizaciones_relaciones_federacion l
           ON l.relacion_id=r.relacion_id AND l.estado='propuesta'
          AND l.id=(
            SELECT MAX(lp.id) FROM localizaciones_relaciones_federacion lp
             WHERE lp.relacion_id=r.relacion_id AND lp.estado='propuesta'
          )
         LEFT JOIN estado_salud_relaciones_federacion s
           ON s.relacion_id=r.relacion_id
         LEFT JOIN estado_concesion_relaciones_federacion ec
           ON ec.relacion_id=r.relacion_id
         LEFT JOIN revisiones_concesion_federacion ro
           ON ro.revision_id=ec.revision_oferta_actual_id
         LEFT JOIN revisiones_concesion_federacion ra
           ON ra.revision_id=ec.revision_aceptacion_actual_id
         LEFT JOIN revisiones_concesion_federacion re
           ON re.revision_id=ec.revision_efectiva_actual_id
         LEFT JOIN usuarios u ON u.id=r.responsable_usuario_id
         LEFT JOIN usuarios uo ON uo.id=r.responsable_original_usuario_id
         LEFT JOIN tenants t ON t.id=r.scope_tenant_id
         LEFT JOIN empresas e ON e.id=r.scope_empresa_id
         LEFT JOIN sitios si ON si.id=r.scope_sitio_id
        WHERE r.estado_ciclo<>'eliminada' AND ${clausula}
        ORDER BY r.actualizada_en_utc DESC,r.relacion_id`,
      parametros
    );
    const flujosPorRelacion = await this.#listarFlujosRelaciones(
      relaciones.map((fila) => fila.relacion_id)
    );
    return Object.freeze(relaciones.map((fila) => sanearRelacion(
      fila,
      flujosPorRelacion.get(fila.relacion_id) ?? Object.freeze([])
    )));
  }

  async #listarFlujosRelaciones(relacionesIds) {
    if (relacionesIds.length === 0) return new Map();
    const marcadores = relacionesIds.map(() => '?').join(',');
    const filas = await this.clienteSql.consultar(
      `SELECT f.relacion_id,f.flujo_id,f.direccion,f.familia,
              f.version_familia,f.scope_nivel,f.scope_tenant_id,
              f.scope_empresa_id,f.scope_sitio_id,f.estado,
              f.generacion_activa_id,f.version_estado,f.actualizada_en_utc,
              g.ordinal AS generacion_ordinal,g.clase AS generacion_clase,
              g.estado AS generacion_estado,
              ci.estado AS corte_inicial_estado,
              fr.sincronizando,fr.operativamente_completa,
              fr.historicamente_completa,fr.parcial_por_scope,fr.degradada
         FROM flujos_federacion f
         LEFT JOIN generaciones_flujos_federacion g
           ON g.generacion_id=f.generacion_activa_id AND g.flujo_id=f.flujo_id
         LEFT JOIN cortes_iniciales_generaciones_federacion ci
           ON ci.generacion_id=f.generacion_activa_id AND ci.flujo_id=f.flujo_id
         LEFT JOIN fronteras_generaciones_federacion fr
           ON fr.generacion_id=f.generacion_activa_id
        WHERE f.relacion_id IN (${marcadores})
        ORDER BY f.relacion_id,f.familia,f.flujo_id`,
      relacionesIds
    );
    const resultado = new Map(relacionesIds.map((relacionId) => [relacionId, []]));
    for (const fila of filas) resultado.get(fila.relacion_id)?.push(sanearFlujo(fila));
    for (const [relacionId, flujos] of resultado) {
      resultado.set(relacionId, Object.freeze(flujos));
    }
    return resultado;
  }

  async listarResponsablesTransferibles({ relacionId, scopeSolicitante } = {}) {
    validarRelacionId(relacionId);
    validarScope(scopeSolicitante);
    const { clausula, parametros } = predicadoScopeVisible(scopeSolicitante, 'r');
    const filas = await this.clienteSql.consultar(
      `SELECT u.id,u.usuario,u.nombre_mostrar,u.nombre_completo,
              u.tenant_id,u.empresa_id,u.sitio_id,
              t.nombre AS tenant_nombre,e.nombre AS empresa_nombre,
              s.nombre AS sitio_nombre,r.direccion
         FROM relaciones_federacion r
         JOIN usuarios u
           ON u.activo=1
          AND u.tenant_id <=> r.scope_tenant_id
          AND u.empresa_id <=> r.scope_empresa_id
          AND u.sitio_id <=> r.scope_sitio_id
          AND ((r.direccion='emision' AND u.permiso_configurar_emisiones_federacion=1)
            OR (r.direccion='recepcion' AND u.permiso_configurar_recepciones_federacion=1))
         LEFT JOIN tenants t ON t.id=u.tenant_id
         LEFT JOIN empresas e ON e.id=u.empresa_id
         LEFT JOIN sitios s ON s.id=u.sitio_id
        WHERE r.relacion_id=? AND r.estado_ciclo<>'eliminada'
          AND r.estado_autoridad='sinAutoridad' AND ${clausula}
        ORDER BY COALESCE(u.nombre_mostrar,u.nombre_completo,u.usuario),u.id`,
      [relacionId, ...parametros]
    );
    return Object.freeze(filas.map((fila) => sanearResponsable(fila)));
  }

  async obtenerContextoTransferencia({
    relacionId,
    nuevoResponsableUsuarioId,
    scopeSolicitante
  } = {}) {
    validarRelacionId(relacionId);
    validarDecimal(nuevoResponsableUsuarioId, 'nuevoResponsableUsuarioId');
    validarScope(scopeSolicitante);
    const visible = predicadoScopeVisible(scopeSolicitante, 'r');
    const filas = await this.clienteSql.consultar(
      `SELECT r.direccion,r.scope_tenant_id,r.scope_empresa_id,r.scope_sitio_id,
              u.id,u.activo,u.tenant_id,u.empresa_id,u.sitio_id,
              u.permiso_configurar_emisiones_federacion,
              u.permiso_configurar_recepciones_federacion
         FROM relaciones_federacion r
         JOIN usuarios u ON u.id=?
        WHERE r.relacion_id=? AND r.estado_ciclo<>'eliminada'
          AND r.estado_autoridad='sinAutoridad' AND ${visible.clausula} LIMIT 1`,
      [nuevoResponsableUsuarioId, relacionId, ...visible.parametros]
    );
    if (!filas[0]) throw new Error('La relación no admite esa transferencia.');
    const fila = filas[0];
    return Object.freeze({
      direccion: fila.direccion,
      scope: Object.freeze({
        tenantId: decimalNullable(fila.scope_tenant_id),
        empresaId: decimalNullable(fila.scope_empresa_id),
        sitioId: decimalNullable(fila.scope_sitio_id)
      }),
      responsable: Object.freeze({
        usuarioId: String(fila.id),
        activa: Boolean(fila.activo),
        scope: Object.freeze({
          tenantId: decimalNullable(fila.tenant_id),
          empresaId: decimalNullable(fila.empresa_id),
          sitioId: decimalNullable(fila.sitio_id)
        }),
        puedeConfigurar: fila.direccion === 'emision'
          ? Boolean(fila.permiso_configurar_emisiones_federacion)
          : Boolean(fila.permiso_configurar_recepciones_federacion)
      })
    });
  }
}

async function bloquearUsuario(conexion, usuarioId) {
  const [filas] = await conexion.execute(
    `SELECT id,activo,tenant_id,empresa_id,sitio_id,
            permiso_configurar_recepciones_federacion
       FROM usuarios WHERE id=? FOR UPDATE`,
    [usuarioId]
  );
  if (!filas[0]) throw new Error('El usuario responsable ya no existe.');
  return filas[0];
}

function exigirAutoridadActualRecepcion(usuario, scope) {
  if (!Boolean(usuario.activo) ||
      !Boolean(usuario.permiso_configurar_recepciones_federacion)) {
    throw new Error('El usuario ya no conserva permiso para configurar recepciones.');
  }
  const actual = {
    tenantId: decimalNullable(usuario.tenant_id),
    empresaId: decimalNullable(usuario.empresa_id),
    sitioId: decimalNullable(usuario.sitio_id)
  };
  if (actual.tenantId !== scope.tenantId || actual.empresaId !== scope.empresaId ||
      actual.sitioId !== scope.sitioId) {
    throw new Error('El scope actual del usuario cambió antes de crear la relación.');
  }
}

function predicadoScopeVisible(scope, alias) {
  if (scope.tenantId === null) return { clausula: '1=1', parametros: [] };
  if (scope.empresaId === null) {
    return {
      clausula: `${alias}.scope_tenant_id=?`,
      parametros: [scope.tenantId]
    };
  }
  if (scope.sitioId === null) {
    return {
      clausula: `${alias}.scope_tenant_id=? AND ${alias}.scope_empresa_id=?`,
      parametros: [scope.tenantId, scope.empresaId]
    };
  }
  return {
    clausula: `${alias}.scope_tenant_id=? AND ${alias}.scope_empresa_id=? AND ${alias}.scope_sitio_id=?`,
    parametros: [scope.tenantId, scope.empresaId, scope.sitioId]
  };
}

function sanearRelacion(fila, flujos = Object.freeze([])) {
  const bloqueos = detectarBloqueosRelacion(fila, flujos);
  return Object.freeze({
    relacionId: fila.relacion_id,
    direccion: fila.direccion,
    estadoCiclo: fila.estado_ciclo,
    estadoAutoridad: fila.estado_autoridad,
    estadoIdentidad: fila.estado_identidad,
    estadoCompatibilidad: fila.estado_compatibilidad,
    installationRemotaCandidataId: fila.installation_remota_candidata_id,
    installationRemotaId: fila.installation_remota_id,
    nombreRemotoDeclarado: fila.nombre_remoto_declarado,
    responsableUsuarioId: decimalNullable(fila.responsable_usuario_id),
    responsableNombre: fila.responsable_usuario_id == null
      ? null
      : fila.responsable_nombre_mostrar || fila.responsable_nombre_completo ||
        fila.responsable_usuario || `Usuario #${fila.responsable_usuario_id}`,
    responsableOriginalUsuarioId: decimalNullable(
      fila.responsable_original_usuario_id
    ),
    responsableOriginalNombre: fila.responsable_original_usuario_id == null
      ? null
      : fila.responsable_original_nombre_mostrar ||
        fila.responsable_original_nombre_completo ||
        fila.responsable_original_usuario ||
        `Usuario #${fila.responsable_original_usuario_id}`,
    scope: Object.freeze({
      tenantId: decimalNullable(fila.scope_tenant_id),
      empresaId: decimalNullable(fila.scope_empresa_id),
      sitioId: decimalNullable(fila.scope_sitio_id),
      tenantNombre: fila.scope_tenant_nombre || null,
      empresaNombre: fila.scope_empresa_nombre || null,
      sitioNombre: fila.scope_sitio_nombre || null
    }),
    versionAutoridad: String(fila.version_autoridad),
    creadaEnUtc: fechaIso(fila.creada_en_utc),
    actualizadaEnUtc: fechaIso(fila.actualizada_en_utc),
    candidatura: fila.candidatura_ordinal == null ? null : Object.freeze({
      ordinal: Number(fila.candidatura_ordinal),
      installationRemotaId: fila.installation_remota_candidata_id,
      bootRemotoId: fila.boot_remoto_candidato_id,
      nombreRemotoDeclarado: fila.nombre_remoto_declarado,
      protocoloVersion: Number(fila.candidato_protocolo),
      productoVersion: fila.candidato_producto,
      registradaEnUtc: fechaIso(fila.candidatura_registrada_en_utc)
    }),
    invitacionVigente: fila.invitacion_id == null ? null : Object.freeze({
      invitacionId: fila.invitacion_id,
      estado: fila.invitacion_estado,
      expiraEnUtc: fechaIso(fila.invitacion_expira_en_utc)
    }),
    localizacionPropuesta: fila.localizacion_propuesta_id == null ? null : Object.freeze({
      localizacionId: bytesAUuidV7Auditoria(fila.localizacion_propuesta_id),
      endpoint: fila.localizacion_propuesta_endpoint
    }),
    salud: fila.ultimo_seq == null ? null : Object.freeze({
      ultimoSeq: String(fila.ultimo_seq),
      bootRemotoId: fila.boot_remoto_id,
      estadoCompatibilidad: fila.salud_compatibilidad,
      estadoTemporal: fila.estado_temporal,
      ultimoHeartbeatUtc: fechaIso(fila.ultimo_heartbeat_utc)
    }),
    concesion: Object.freeze({
      revision: fila.concesion_revision == null ? null : String(fila.concesion_revision),
      oferta: sanearRevisionConcesion(
        fila.revision_oferta_actual_id,
        fila.oferta_ordinal,
        fila.oferta_seleccion
      ),
      aceptacion: sanearRevisionConcesion(
        fila.revision_aceptacion_actual_id,
        fila.aceptacion_ordinal,
        fila.aceptacion_seleccion
      ),
      efectiva: sanearRevisionConcesion(
        fila.revision_efectiva_actual_id,
        fila.efectiva_ordinal,
        fila.efectiva_seleccion
      )
    }),
    flujos,
    bloqueos
  });
}

function sanearFlujo(fila) {
  return Object.freeze({
    flujoId: fila.flujo_id,
    direccion: fila.direccion,
    familia: fila.familia,
    versionFamilia: Number(fila.version_familia),
    scope: Object.freeze({
      nivel: fila.scope_nivel,
      tenantId: decimalNullable(fila.scope_tenant_id),
      empresaId: decimalNullable(fila.scope_empresa_id),
      sitioId: decimalNullable(fila.scope_sitio_id)
    }),
    estado: fila.estado,
    versionEstado: String(fila.version_estado),
    generacion: fila.generacion_activa_id == null ? null : Object.freeze({
      generacionId: fila.generacion_activa_id,
      ordinal: Number(fila.generacion_ordinal),
      clase: fila.generacion_clase,
      estado: fila.generacion_estado,
      corteInicial: fila.corte_inicial_estado,
      sincronizando: Boolean(fila.sincronizando),
      operativamenteCompleta: Boolean(fila.operativamente_completa),
      historicamenteCompleta: Boolean(fila.historicamente_completa),
      parcialPorScope: Boolean(fila.parcial_por_scope),
      degradada: Boolean(fila.degradada)
    }),
    actualizadaEnUtc: fechaIso(fila.actualizada_en_utc)
  });
}

function detectarBloqueosRelacion(fila, flujos) {
  const bloqueos = [];
  if (fila.estado_ciclo !== 'vinculada') bloqueos.push(`ciclo:${fila.estado_ciclo}`);
  if (fila.estado_autoridad !== 'autorizada') {
    bloqueos.push(`autoridad:${fila.estado_autoridad}`);
  }
  if (fila.estado_identidad !== 'valida') bloqueos.push(`identidad:${fila.estado_identidad}`);
  if (fila.estado_compatibilidad !== 'compatible') {
    bloqueos.push(`compatibilidad:${fila.estado_compatibilidad || 'pendiente'}`);
  }
  const revisionLocal = fila.direccion === 'emision'
    ? fila.revision_oferta_actual_id
    : fila.revision_aceptacion_actual_id;
  const revisionRemota = fila.direccion === 'emision'
    ? fila.revision_aceptacion_actual_id
    : fila.revision_oferta_actual_id;
  if (!revisionLocal) bloqueos.push('concesion:declaracionLocalPendiente');
  if (!revisionRemota) bloqueos.push('concesion:declaracionRemotaPendiente');
  if (!fila.revision_efectiva_actual_id) bloqueos.push('concesion:efectivaPendiente');
  for (const flujo of flujos) {
    if (['sinSincronizar', 'degradado', 'saturado', 'detenido'].includes(flujo.estado)) {
      bloqueos.push(`flujo:${flujo.familia}:${flujo.estado}`);
    } else if (flujo.generacion?.corteInicial === 'pendiente') {
      bloqueos.push(`flujo:${flujo.familia}:corteInicialPendiente`);
    } else if (flujo.generacion?.degradada) {
      bloqueos.push(`flujo:${flujo.familia}:degradado`);
    }
  }
  return Object.freeze(bloqueos);
}

function sanearRevisionConcesion(revisionId, ordinal, seleccion) {
  if (revisionId == null) return null;
  const datos = typeof seleccion === 'string' ? JSON.parse(seleccion) : seleccion;
  return Object.freeze({
    revisionId,
    ordinal: Number(ordinal),
    seleccion: congelarJson(datos)
  });
}

function congelarJson(valor) {
  if (valor && typeof valor === 'object') {
    Object.values(valor).forEach(congelarJson);
    Object.freeze(valor);
  }
  return valor;
}

function sanearResponsable(fila) {
  return Object.freeze({
    usuarioId: String(fila.id),
    nombre: fila.nombre_mostrar || fila.nombre_completo || fila.usuario,
    usuario: fila.usuario,
    scope: Object.freeze({
      tenantId: decimalNullable(fila.tenant_id),
      empresaId: decimalNullable(fila.empresa_id),
      sitioId: decimalNullable(fila.sitio_id),
      tenantNombre: fila.tenant_nombre || null,
      empresaNombre: fila.empresa_nombre || null,
      sitioNombre: fila.sitio_nombre || null
    })
  });
}

function validarRelacionId(valor) {
  if (!/^sfid1\.relacion\.[A-Za-z0-9_-]{21}[AQgw]$/u.test(String(valor || ''))) {
    throw new Error('relacionId no es canónica.');
  }
}

function validarDecimal(valor, campo) {
  if (!/^[1-9][0-9]*$/u.test(String(valor || ''))) {
    throw new Error(`${campo} no es canónico.`);
  }
}

function validarCreacion(entrada) {
  if (!/^sfid1\.relacion\.[A-Za-z0-9_-]{21}[AQgw]$/u.test(String(entrada.relacionId || ''))) {
    throw new Error('relacionId no es canónica.');
  }
  validarScope(entrada.scope);
  uuidV7AuditoriaABytes(entrada.eventoId, 'eventoId');
  uuidV7AuditoriaABytes(entrada.correlacionId, 'correlacionId');
  if (entrada.actor?.modo !== 'directo' || entrada.actor?.real?.tipo !== 'usuario' ||
      entrada.actor?.efectivo != null ||
      !/^[1-9][0-9]*$/u.test(String(entrada.actor?.real?.id || ''))) {
    throw new Error('La creación de una relación exige una sesión humana directa.');
  }
}

function validarScope(scope) {
  if (!scope || typeof scope !== 'object' || Array.isArray(scope)) {
    throw new Error('scope no es válido.');
  }
  for (const campo of ['tenantId', 'empresaId', 'sitioId']) {
    if (scope[campo] !== null && !/^[1-9][0-9]*$/u.test(String(scope[campo]))) {
      throw new Error(`scope.${campo} no es válido.`);
    }
  }
  if (scope.tenantId === null && (scope.empresaId !== null || scope.sitioId !== null)) {
    throw new Error('Un scope portal no admite empresa ni sitio.');
  }
  if (scope.empresaId === null && scope.sitioId !== null) {
    throw new Error('Un sitio exige empresa.');
  }
}

async function ahoraSql(conexion) {
  const [filas] = await conexion.execute(
    "SELECT DATE_FORMAT(UTC_TIMESTAMP(3),'%Y-%m-%d %H:%i:%s.%f') AS ahora"
  );
  return filas[0].ahora;
}

function decimalNullable(valor) {
  return valor == null ? null : String(valor);
}

function fechaIso(valor) {
  if (valor == null) return null;
  if (valor instanceof Date) return valor.toISOString();
  const texto = String(valor);
  if (texto.includes('T')) return texto.endsWith('Z') ? texto : `${texto}Z`;
  return `${texto.replace(' ', 'T')}Z`;
}

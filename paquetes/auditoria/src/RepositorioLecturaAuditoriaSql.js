import { bytesAUuidV7Auditoria, uuidV7AuditoriaABytes } from './UuidV7Auditoria.js';
import {
  construirCondicionesAvanzadasAuditoriaSql,
  resolverCadenaFiltroAuditoriaSql
} from './FiltrosSqlConsultaAuditoria.js';

export class RepositorioLecturaAuditoriaSql {
  constructor({ clienteSql } = {}) {
    if (!clienteSql?.obtenerConexion) {
      throw new Error('RepositorioLecturaAuditoriaSql requiere cliente SQL.');
    }
    this.clienteSql = clienteSql;
  }

  async listarPaginaEventos({
    contextoUsuarioActual,
    filtros = {},
    cursor = null,
    limite = 25,
    orden = 'desc'
  } = {}) {
    const limiteNormalizado = normalizarLimitePagina(limite);
    const filas = await this.listarEventos({
      contextoUsuarioActual,
      filtros,
      cursor,
      limite: limiteNormalizado,
      orden
    });
    const eventos = Object.freeze(filas.slice(0, limiteNormalizado));
    const ultimo = eventos.at(-1) ?? null;
    return Object.freeze({
      eventos,
      hayMas: filas.length > limiteNormalizado,
      siguientePosicion: filas.length > limiteNormalizado && ultimo
        ? Object.freeze({
          registradoEnUtc: ultimo.registradoEnUtc,
          eventoId: ultimo.eventoId
        })
        : null
    });
  }

  async listarEventos({ contextoUsuarioActual, filtros = {}, cursor = null, limite = 50, orden = 'desc' } = {}) {
    const limiteNormalizado = normalizarLimitePagina(limite);
    const conexion = await this.clienteSql.obtenerConexion();
    try {
      const filtrosSql = await resolverCadenaFiltroAuditoriaSql({
        conexion,
        contextoUsuarioActual,
        filtros
      });
      const { where, parametros } = construirWhere({
        contextoUsuarioActual,
        filtros: filtrosSql,
        cursor,
        orden
      });
      const direccion = orden === 'asc' ? 'ASC' : 'DESC';
      const [filas] = await conexion.execute(
        `
          SELECT
            evento_id,
            evento_contraparte_id,
            tipo_evento,
            version_contrato,
            flujo,
            clave_cadena,
            CAST(secuencia AS CHAR) AS secuencia,
            actor_real_tipo,
            actor_real_id,
            actor_efectivo_tipo,
            actor_efectivo_id,
            modo_actuacion,
            sujeto_tipo,
            sujeto_id,
            origen,
            CAST(scope_tenant_id AS CHAR) AS scope_tenant_id,
            CAST(scope_empresa_id AS CHAR) AS scope_empresa_id,
            CAST(scope_sitio_id AS CHAR) AS scope_sitio_id,
            correlacion_id,
            causalidad_tipo,
            causalidad_id,
            productor,
            clave_operacion,
            rol_evento,
            DATE_FORMAT(efectivo_en_utc, '%Y-%m-%dT%H:%i:%s.%fZ') AS efectivo_en_utc,
            DATE_FORMAT(registrado_en_utc, '%Y-%m-%dT%H:%i:%s.%fZ') AS registrado_en_utc,
            version_canonicalizador,
            version_encadenado,
            payload,
            HEX(hash_payload) AS hash_payload,
            HEX(hash_anterior) AS hash_anterior,
            HEX(hash_actual) AS hash_actual
          FROM eventos_auditoria
          WHERE ${where}
          ORDER BY registrado_en_utc ${direccion}, evento_id ${direccion}
          LIMIT ?
        `,
        [...parametros, limiteNormalizado + 1]
      );
      return Object.freeze(filas.map(mapearEvento));
    } finally {
      conexion.release();
    }
  }

  async contarEventos({ contextoUsuarioActual, filtros = {} } = {}) {
    const conexion = await this.clienteSql.obtenerConexion();
    try {
      const filtrosSql = await resolverCadenaFiltroAuditoriaSql({
        conexion,
        contextoUsuarioActual,
        filtros
      });
      const { where, parametros } = construirWhere({
        contextoUsuarioActual,
        filtros: filtrosSql
      });
      const [filas] = await conexion.execute(
        `SELECT COUNT(*) AS total FROM eventos_auditoria WHERE ${where}`,
        parametros
      );
      return Number(filas[0]?.total || 0);
    } finally {
      conexion.release();
    }
  }

  async listarClavesCorrelacion({
    contextoUsuarioActual,
    filtros = {},
    cursor = null,
    limite = 25,
    orden = 'desc'
  } = {}) {
    const conexion = await this.clienteSql.obtenerConexion();
    try {
      const filtrosSql = await resolverCadenaFiltroAuditoriaSql({
        conexion,
        contextoUsuarioActual,
        filtros
      });
      const { where, parametros } = construirWhere({
        contextoUsuarioActual,
        filtros: filtrosSql
      });
      const direccion = orden === 'asc' ? 'ASC' : 'DESC';
      const comparador = orden === 'asc' ? '>' : '<';
      const condicionCursor = cursor
        ? `WHERE (
            clave_fecha ${comparador} ?
            OR (clave_fecha = ? AND clave_evento_id ${comparador} ?)
            OR (clave_fecha = ? AND clave_evento_id = ? AND correlacion_id ${comparador} ?)
          )`
        : '';
      const parametrosCursor = cursor
        ? [
          fechaUtcASql(cursor.registradoEnUtc),
          fechaUtcASql(cursor.registradoEnUtc),
          uuidV7AuditoriaABytes(cursor.eventoId, 'cursor.eventoId'),
          fechaUtcASql(cursor.registradoEnUtc),
          uuidV7AuditoriaABytes(cursor.eventoId, 'cursor.eventoId'),
          uuidV7AuditoriaABytes(cursor.correlacionId, 'cursor.correlacionId')
        ]
        : [];
      const [filas] = await conexion.execute(
        `
          WITH eventos_visibles AS (
            SELECT
              correlacion_id,
              registrado_en_utc,
              evento_id,
              ROW_NUMBER() OVER (
                PARTITION BY correlacion_id
                ORDER BY registrado_en_utc ${direccion}, evento_id ${direccion}
              ) AS posicion_grupo
            FROM eventos_auditoria
            WHERE ${where}
          ), claves_grupo AS (
            SELECT
              correlacion_id,
              registrado_en_utc AS clave_fecha,
              evento_id AS clave_evento_id
            FROM eventos_visibles
            WHERE posicion_grupo = 1
          )
          SELECT
            correlacion_id,
            clave_evento_id,
            DATE_FORMAT(clave_fecha, '%Y-%m-%dT%H:%i:%s.%fZ') AS clave_fecha
          FROM claves_grupo
          ${condicionCursor}
          ORDER BY clave_fecha ${direccion}, clave_evento_id ${direccion}, correlacion_id ${direccion}
          LIMIT ?
        `,
        [...parametros, ...parametrosCursor, Number(limite) + 1]
      );
      return Object.freeze(filas.map((fila) => Object.freeze({
        correlacionId: bytesAUuidV7Auditoria(fila.correlacion_id, 'correlacionId'),
        registradoEnUtc: normalizarFecha(fila.clave_fecha),
        eventoId: bytesAUuidV7Auditoria(fila.clave_evento_id, 'eventoId')
      })));
    } finally {
      conexion.release();
    }
  }

  async listarDiagnosticos({ contextoUsuarioActual, limite = 50 } = {}) {
    const conexion = await this.clienteSql.obtenerConexion();
    try {
      const { condicion, parametros } = condicionScopeCadena(contextoUsuarioActual, 'clave_cadena');
      const [filas] = await conexion.execute(
        `
          SELECT
            clave_cadena,
            estado_verificacion,
            pendiente_revision,
            CAST(desde_secuencia AS CHAR) AS desde_secuencia,
            CAST(hasta_secuencia AS CHAR) AS hasta_secuencia,
            CAST(ultima_secuencia_verificada AS CHAR) AS ultima_secuencia_verificada,
            HEX(hash_final_verificado) AS hash_final_verificado,
            HEX(hash_final_esperado) AS hash_final_esperado,
            CAST(cabecera_ultima_secuencia AS CHAR) AS cabecera_ultima_secuencia,
            HEX(cabecera_ultimo_hash) AS cabecera_ultimo_hash,
            DATE_FORMAT(actualizado_en_utc, '%Y-%m-%dT%H:%i:%s.%fZ') AS actualizado_en_utc,
            diagnostico
          FROM diagnosticos_integridad_auditoria
          WHERE ${condicion}
          ORDER BY actualizado_en_utc DESC, clave_cadena ASC
          LIMIT ?
        `,
        [...parametros, Number(limite)]
      );
      return Object.freeze(filas.map((fila) => Object.freeze({
        claveCadena: fila.clave_cadena,
        estadoVerificacion: fila.estado_verificacion,
        pendienteRevision: Boolean(fila.pendiente_revision),
        desdeSecuencia: fila.desde_secuencia ?? null,
        hastaSecuencia: fila.hasta_secuencia ?? null,
        ultimaSecuenciaVerificada: fila.ultima_secuencia_verificada ?? null,
        hashFinalVerificado: fila.hash_final_verificado?.toLowerCase() ?? null,
        hashFinalEsperado: fila.hash_final_esperado?.toLowerCase() ?? null,
        cabeceraUltimaSecuencia: fila.cabecera_ultima_secuencia ?? null,
        cabeceraUltimoHash: fila.cabecera_ultimo_hash?.toLowerCase() ?? null,
        actualizadoEnUtc: normalizarFecha(fila.actualizado_en_utc),
        diagnostico: typeof fila.diagnostico === 'string' ? JSON.parse(fila.diagnostico) : fila.diagnostico
      })));
    } finally {
      conexion.release();
    }
  }

  async listarIncidentes({ contextoUsuarioActual, soloActivos = true, limite = 50 } = {}) {
    const conexion = await this.clienteSql.obtenerConexion();
    try {
      const { condicion, parametros } = condicionScopeCadena(contextoUsuarioActual, 'clave_cadena');
      const [filas] = await conexion.execute(
        `
          SELECT
            episodio_id,
            HEX(huella) AS huella,
            clave_cadena,
            codigo,
            estado_verificacion,
            estado_deteccion,
            DATE_FORMAT(primera_deteccion_utc, '%Y-%m-%dT%H:%i:%s.%fZ') AS primera_deteccion_utc,
            DATE_FORMAT(ultima_deteccion_utc, '%Y-%m-%dT%H:%i:%s.%fZ') AS ultima_deteccion_utc,
            DATE_FORMAT(resuelto_en_utc, '%Y-%m-%dT%H:%i:%s.%fZ') AS resuelto_en_utc,
            DATE_FORMAT(reconocido_en_utc, '%Y-%m-%dT%H:%i:%s.%fZ') AS reconocido_en_utc,
            CAST(reconocido_por_usuario_id AS CHAR) AS reconocido_por_usuario_id,
            detalle
          FROM incidentes_integridad_auditoria
          WHERE ${condicion}
            AND (? = 0 OR estado_deteccion = 'activo')
          ORDER BY ultima_deteccion_utc DESC, episodio_id DESC
          LIMIT ?
        `,
        [...parametros, soloActivos ? 1 : 0, Number(limite)]
      );
      return Object.freeze(filas.map(mapearIncidente));
    } finally {
      conexion.release();
    }
  }

  async obtenerIncidenteVisible({ episodioId, contextoUsuarioActual } = {}) {
    const conexion = await this.clienteSql.obtenerConexion();
    try {
      const { condicion, parametros } = condicionScopeCadena(contextoUsuarioActual, 'clave_cadena');
      const [filas] = await conexion.execute(
        `
          SELECT
            episodio_id,
            HEX(huella) AS huella,
            clave_cadena,
            codigo,
            estado_verificacion,
            estado_deteccion,
            DATE_FORMAT(primera_deteccion_utc, '%Y-%m-%dT%H:%i:%s.%fZ') AS primera_deteccion_utc,
            DATE_FORMAT(ultima_deteccion_utc, '%Y-%m-%dT%H:%i:%s.%fZ') AS ultima_deteccion_utc,
            DATE_FORMAT(resuelto_en_utc, '%Y-%m-%dT%H:%i:%s.%fZ') AS resuelto_en_utc,
            DATE_FORMAT(reconocido_en_utc, '%Y-%m-%dT%H:%i:%s.%fZ') AS reconocido_en_utc,
            CAST(reconocido_por_usuario_id AS CHAR) AS reconocido_por_usuario_id,
            detalle
          FROM incidentes_integridad_auditoria
          WHERE episodio_id = ?
            AND ${condicion}
          LIMIT 1
        `,
        [uuidV7AuditoriaABytes(episodioId, 'episodioId'), ...parametros]
      );
      return filas[0] ? mapearIncidente(filas[0]) : null;
    } finally {
      conexion.release();
    }
  }

  async eventoVisiblePorId({ eventoId, contextoUsuarioActual } = {}) {
    const visibles = await this.eventosVisiblesPorIds({
      eventoIds: [eventoId],
      contextoUsuarioActual
    });
    return visibles.includes(String(eventoId));
  }

  async eventosVisiblesPorIds({ eventoIds = [], contextoUsuarioActual } = {}) {
    const ids = normalizarIdsLote(eventoIds, 'eventoIds');
    if (ids.length === 0) return Object.freeze([]);
    const conexion = await this.clienteSql.obtenerConexion();
    try {
      const { condicion, parametros } = condicionScopeEvento(contextoUsuarioActual, 'e');
      const marcadores = ids.map(() => '?').join(', ');
      const [filas] = await conexion.execute(
        `
          SELECT e.evento_id
          FROM eventos_auditoria e
          WHERE e.evento_id IN (${marcadores})
            AND ${condicion}
        `,
        [
          ...ids.map((id) => uuidV7AuditoriaABytes(id, 'eventoIds')),
          ...parametros
        ]
      );
      return Object.freeze(filas.map((fila) =>
        bytesAUuidV7Auditoria(fila.evento_id, 'eventoId visible')
      ));
    } finally {
      conexion.release();
    }
  }

  async causalidadVisible({ tipo, id, contextoUsuarioActual } = {}) {
    const visibles = await this.causalidadesVisiblesPorTipo({
      tipo,
      ids: [id],
      contextoUsuarioActual
    });
    return visibles.includes(String(id));
  }

  async causalidadesVisiblesPorTipo({ tipo, ids = [], contextoUsuarioActual } = {}) {
    const unicos = normalizarIdsLote(ids, 'causalidad.ids');
    if (tipo === 'solicitud_recuperacion_password') {
      if (contextoUsuarioActual?.nivelScope !== 'portal') return Object.freeze([]);
      return Object.freeze(unicos.map((id) =>
        validarIdSolicitudRecuperacion(id)
      ));
    }
    if (unicos.length === 0) return Object.freeze([]);
    if (tipo === 'evento_auditoria') {
      return this.eventosVisiblesPorIds({
        eventoIds: unicos,
        contextoUsuarioActual
      });
    }
    const consulta = construirConsultaCausalLote({
      tipo,
      ids: unicos,
      contextoUsuarioActual
    });
    if (!consulta) return Object.freeze([]);
    const conexion = await this.clienteSql.obtenerConexion();
    try {
      const [filas] = await conexion.execute(consulta.sql, consulta.parametros);
      return Object.freeze(filas.map(consulta.mapearId));
    } finally {
      conexion.release();
    }
  }
}

function validarIdSolicitudRecuperacion(valor) {
  uuidV7AuditoriaABytes(valor, 'causalidad.id');
  return String(valor);
}

function construirConsultaCausal({ tipo, id, contextoUsuarioActual }) {
  const definicion = DEFINICIONES_CAUSALES[tipo];
  if (!definicion) return null;
  if (tipo === 'generacion_dns' && contextoUsuarioActual?.nivelScope !== 'portal') return null;
  const scope = definicion.scope
    ? condicionScopeColumnas(contextoUsuarioActual, definicion.scope)
    : { condicion: '1 = 1', parametros: [] };
  return {
    sql: `SELECT 1 AS visible FROM ${definicion.tabla} WHERE ${definicion.idColumna} = ? AND ${scope.condicion} LIMIT 1`,
    parametros: [definicion.convertirId(id), ...scope.parametros]
  };
}

function construirConsultaCausalLote({ tipo, ids, contextoUsuarioActual }) {
  const definicion = DEFINICIONES_CAUSALES[tipo];
  if (!definicion) return null;
  if (tipo === 'generacion_dns' && contextoUsuarioActual?.nivelScope !== 'portal') return null;
  const scope = definicion.scope
    ? condicionScopeColumnas(contextoUsuarioActual, definicion.scope)
    : { condicion: '1 = 1', parametros: [] };
  const marcadores = ids.map(() => '?').join(', ');
  return {
    sql: `SELECT ${definicion.idColumna} AS id_visible FROM ${definicion.tabla} WHERE ${definicion.idColumna} IN (${marcadores}) AND ${scope.condicion}`,
    parametros: [
      ...ids.map((id) => definicion.convertirId(id)),
      ...scope.parametros
    ],
    mapearId: definicion.mapearId
  };
}

const DEFINICIONES_CAUSALES = Object.freeze({
  evento_monitor: Object.freeze({
    tabla: 'eventos_monitores',
    idColumna: 'id',
    scope: Object.freeze(['tenant_id', 'empresa_id', 'sitio_id']),
    convertirId: idDecimalPositivo,
    mapearId: (fila) => String(fila.id_visible)
  }),
  ejecucion_trigger: Object.freeze({
    tabla: 'ejecuciones_triggers',
    idColumna: 'id',
    scope: Object.freeze(['trigger_tenant_id', 'trigger_empresa_id', 'trigger_sitio_id']),
    convertirId: idDecimalPositivo,
    mapearId: (fila) => String(fila.id_visible)
  }),
  operacion_sesion_agente: Object.freeze({
    tabla: 'operaciones_sesion_agentes',
    idColumna: 'operacion_id',
    scope: Object.freeze(['scope_tenant_id', 'scope_empresa_id', 'scope_sitio_id']),
    convertirId: (valor) => uuidV7AuditoriaABytes(valor, 'causalidad.id'),
    mapearId: (fila) => bytesAUuidV7Auditoria(fila.id_visible, 'causalidad visible')
  }),
  generacion_dns: Object.freeze({
    tabla: 'operaciones_publicacion_dns',
    idColumna: 'generacion_dns',
    scope: null,
    convertirId: idDecimalPositivo,
    mapearId: (fila) => String(fila.id_visible)
  })
});

function condicionScopeColumnas(contexto, [tenant, empresa, sitio]) {
  if (contexto?.nivelScope === 'portal') return { condicion: '1 = 1', parametros: [] };
  if (contexto?.nivelScope === 'tenant' && contexto.tenantId != null) {
    return { condicion: `${tenant} = ?`, parametros: [contexto.tenantId] };
  }
  if (contexto?.nivelScope === 'empresa' && contexto.empresaId != null) {
    return { condicion: `${empresa} = ?`, parametros: [contexto.empresaId] };
  }
  if (contexto?.nivelScope === 'sitio' && contexto.sitioId != null) {
    return { condicion: `${sitio} = ?`, parametros: [contexto.sitioId] };
  }
  return { condicion: '0 = 1', parametros: [] };
}

function idDecimalPositivo(valor) {
  const texto = String(valor ?? '');
  if (!/^[1-9][0-9]*$/.test(texto)) throw new Error('causalidad.id decimal no válido.');
  return texto;
}

function normalizarIdsLote(valores, nombre) {
  if (!Array.isArray(valores)) throw new Error(`${nombre} debe ser una lista.`);
  const unicos = [...new Set(valores.map((valor) => String(valor)))];
  if (unicos.length > 200) throw new Error(`${nombre} no puede superar 200 identidades.`);
  return unicos;
}

function construirWhere({ contextoUsuarioActual, filtros = {}, cursor = null, orden = 'desc' }) {
  const partes = [];
  const parametros = [];
  const scope = condicionScopeEvento(contextoUsuarioActual, 'eventos_auditoria');
  partes.push(scope.condicion);
  parametros.push(...scope.parametros);

  if (filtros.flujo) {
    partes.push('flujo = ?');
    parametros.push(filtros.flujo);
  }
  if (filtros.tipoEvento) {
    partes.push('tipo_evento = ?');
    parametros.push(filtros.tipoEvento);
  }
  const sujetoTipoPresente = filtros.sujetoTipo != null;
  const sujetoIdPresente = filtros.sujetoId != null;
  if (sujetoTipoPresente !== sujetoIdPresente) {
    throw new Error('Los filtros sujetoTipo y sujetoId deben aparecer juntos.');
  }
  if (sujetoTipoPresente) {
    partes.push('sujeto_tipo = ?');
    parametros.push(filtros.sujetoTipo);
    partes.push('sujeto_id = ?');
    parametros.push(filtros.sujetoId);
  }
  if (filtros.desdeUtc) {
    partes.push('registrado_en_utc >= ?');
    parametros.push(fechaUtcASql(filtros.desdeUtc));
  }
  if (filtros.hastaUtc) {
    partes.push('registrado_en_utc <= ?');
    parametros.push(fechaUtcASql(filtros.hastaUtc));
  }
  if (filtros.correlacionId) {
    partes.push('correlacion_id = ?');
    parametros.push(uuidV7AuditoriaABytes(filtros.correlacionId, 'correlacionId'));
  }
  const avanzados = construirCondicionesAvanzadasAuditoriaSql(filtros);
  partes.push(...avanzados.partes);
  parametros.push(...avanzados.parametros);
  if (cursor) {
    const comparador = orden === 'asc' ? '>' : '<';
    partes.push(`
      (
        registrado_en_utc ${comparador} ?
        OR (
          registrado_en_utc = ?
          AND evento_id ${comparador} ?
        )
      )
    `);
    parametros.push(
      fechaUtcASql(cursor.registradoEnUtc),
      fechaUtcASql(cursor.registradoEnUtc),
      uuidV7AuditoriaABytes(cursor.eventoId, 'cursor.eventoId')
    );
  }
  return {
    where: partes.map((parte) => `(${parte})`).join(' AND '),
    parametros
  };
}

function normalizarLimitePagina(valor) {
  const limite = Number(valor);
  if (!Number.isInteger(limite) || limite < 1 || limite > 100) {
    throw new Error('El límite de lectura de auditoría debe estar entre 1 y 100.');
  }
  return limite;
}

function condicionScopeEvento(contexto, alias) {
  const prefijo = alias ? `${alias}.` : '';
  if (contexto?.nivelScope === 'portal') {
    return { condicion: '1 = 1', parametros: [] };
  }
  if (contexto?.nivelScope === 'tenant' && contexto.tenantId != null) {
    return {
      condicion: `${prefijo}scope_tenant_id = ?`,
      parametros: [contexto.tenantId]
    };
  }
  if (contexto?.nivelScope === 'empresa' && contexto.empresaId != null) {
    return {
      condicion: `${prefijo}scope_empresa_id = ?`,
      parametros: [contexto.empresaId]
    };
  }
  if (contexto?.nivelScope === 'sitio' && contexto.sitioId != null) {
    return {
      condicion: `${prefijo}scope_sitio_id = ?`,
      parametros: [contexto.sitioId]
    };
  }
  return { condicion: '0 = 1', parametros: [] };
}

function condicionScopeCadena(contexto, columna) {
  if (contexto?.nivelScope === 'portal') {
    return { condicion: '1 = 1', parametros: [] };
  }
  if (['tenant', 'empresa', 'sitio'].includes(contexto?.nivelScope) && contexto.tenantId != null) {
    return {
      condicion: `${columna} LIKE ?`,
      parametros: [`%:tenant:${contexto.tenantId}`]
    };
  }
  return { condicion: '0 = 1', parametros: [] };
}

function mapearEvento(fila) {
  return Object.freeze({
    eventoId: bytesAUuidV7Auditoria(fila.evento_id, 'eventoId'),
    eventoContraparteId: fila.evento_contraparte_id
      ? bytesAUuidV7Auditoria(fila.evento_contraparte_id, 'eventoContraparteId')
      : null,
    tipoEvento: fila.tipo_evento,
    versionContrato: Number(fila.version_contrato),
    flujo: fila.flujo,
    claveCadena: fila.clave_cadena,
    secuencia: fila.secuencia,
    actorReal: { tipo: fila.actor_real_tipo, id: fila.actor_real_id },
    actorEfectivo: fila.actor_efectivo_tipo
      ? { tipo: fila.actor_efectivo_tipo, id: fila.actor_efectivo_id }
      : null,
    modoActuacion: fila.modo_actuacion,
    sujeto: { tipo: fila.sujeto_tipo, id: fila.sujeto_id },
    origen: fila.origen,
    scope: {
      tenantId: fila.scope_tenant_id,
      empresaId: fila.scope_empresa_id,
      sitioId: fila.scope_sitio_id
    },
    correlacionId: bytesAUuidV7Auditoria(fila.correlacion_id, 'correlacionId'),
    causalidadTipo: fila.causalidad_tipo,
    causalidadId: fila.causalidad_id,
    productor: fila.productor,
    claveOperacion: Buffer.from(fila.clave_operacion).toString('ascii'),
    rolEvento: fila.rol_evento,
    efectivoEnUtc: normalizarFecha(fila.efectivo_en_utc),
    registradoEnUtc: normalizarFecha(fila.registrado_en_utc),
    versionCanonicalizador: fila.version_canonicalizador,
    versionEncadenado: fila.version_encadenado,
    payload: typeof fila.payload === 'string' ? JSON.parse(fila.payload) : fila.payload,
    hashPayload: String(fila.hash_payload).toLowerCase(),
    hashAnterior: String(fila.hash_anterior).toLowerCase(),
    hashActual: String(fila.hash_actual).toLowerCase()
  });
}

function mapearIncidente(fila) {
  return Object.freeze({
    episodioId: bytesAUuidV7Auditoria(fila.episodio_id, 'episodioId'),
    huella: fila.huella?.toLowerCase() ?? null,
    claveCadena: fila.clave_cadena,
    codigo: fila.codigo,
    estadoVerificacion: fila.estado_verificacion,
    estadoDeteccion: fila.estado_deteccion,
    primeraDeteccionUtc: normalizarFecha(fila.primera_deteccion_utc),
    ultimaDeteccionUtc: normalizarFecha(fila.ultima_deteccion_utc),
    resueltoEnUtc: fila.resuelto_en_utc == null ? null : normalizarFecha(fila.resuelto_en_utc),
    reconocidoEnUtc: fila.reconocido_en_utc == null ? null : normalizarFecha(fila.reconocido_en_utc),
    reconocidoPorUsuarioId: fila.reconocido_por_usuario_id ?? null,
    detalle: typeof fila.detalle === 'string' ? JSON.parse(fila.detalle) : fila.detalle
  });
}

function fechaUtcASql(fecha) {
  return String(fecha).slice(0, -1).replace('T', ' ');
}

function normalizarFecha(valor) {
  return String(valor || '').replace(/(\.\d{3})\d*Z$/, '$1Z');
}

export const __testablesRepositorioLecturaAuditoriaSql = Object.freeze({
  condicionScopeEvento,
  condicionScopeCadena,
  condicionScopeColumnas,
  construirConsultaCausal,
  construirConsultaCausalLote,
  construirWhere,
  normalizarLimitePagina
});

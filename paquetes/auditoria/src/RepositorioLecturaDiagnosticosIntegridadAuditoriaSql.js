export class RepositorioLecturaDiagnosticosIntegridadAuditoriaSql {
  constructor({ clienteSql = null, conexion = null } = {}) {
    if (!clienteSql && !conexion?.execute) {
      throw new Error('RepositorioLecturaDiagnosticosIntegridadAuditoriaSql requiere clienteSql o conexión SQL.');
    }
    this.clienteSql = clienteSql;
    this.conexion = conexion;
  }

  async listarDiagnosticosVisibles(contextoUsuarioActual) {
    return this.#usarConexion(async (conexion) => {
      const { condicion, parametros } = condicionScope(contextoUsuarioActual, 'clave_cadena');
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
          ORDER BY clave_cadena ASC
        `,
        parametros
      );
      return Object.freeze(filas.map(mapearDiagnostico));
    });
  }

  async listarIncidentesVisibles(contextoUsuarioActual, { soloActivos = true } = {}) {
    return this.#usarConexion(async (conexion) => {
      const { condicion, parametros } = condicionScope(contextoUsuarioActual, 'clave_cadena');
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
          ORDER BY ultima_deteccion_utc DESC, id DESC
        `,
        [...parametros, soloActivos ? 1 : 0]
      );
      return Object.freeze(filas.map(mapearIncidente));
    });
  }

  async #usarConexion(tarea) {
    if (this.conexion) return tarea(this.conexion);
    const conexion = await this.clienteSql.obtenerConexion();
    try {
      return await tarea(conexion);
    } finally {
      conexion.release();
    }
  }
}

function condicionScope(contexto, columna) {
  if (contexto?.nivelScope === 'portal') {
    return { condicion: '1 = 1', parametros: [] };
  }
  if (['tenant', 'empresa', 'sitio'].includes(contexto?.nivelScope) && contexto.tenantId != null) {
    return {
      condicion: `${columna} LIKE ?`,
      parametros: [`%:tenant:${contexto.tenantId}`]
    };
  }
  return { condicion: '1 = 0', parametros: [] };
}

function mapearDiagnostico(fila) {
  return Object.freeze({
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
    actualizadoEnUtc: normalizarFechaSqlTexto(fila.actualizado_en_utc),
    diagnostico: typeof fila.diagnostico === 'string' ? JSON.parse(fila.diagnostico) : fila.diagnostico
  });
}

function mapearIncidente(fila) {
  return Object.freeze({
    episodioId: Buffer.from(fila.episodio_id).toString('hex'),
    huella: fila.huella?.toLowerCase() ?? null,
    claveCadena: fila.clave_cadena,
    codigo: fila.codigo,
    estadoVerificacion: fila.estado_verificacion,
    estadoDeteccion: fila.estado_deteccion,
    primeraDeteccionUtc: normalizarFechaSqlTexto(fila.primera_deteccion_utc),
    ultimaDeteccionUtc: normalizarFechaSqlTexto(fila.ultima_deteccion_utc),
    resueltoEnUtc: fila.resuelto_en_utc == null ? null : normalizarFechaSqlTexto(fila.resuelto_en_utc),
    reconocidoEnUtc: fila.reconocido_en_utc == null ? null : normalizarFechaSqlTexto(fila.reconocido_en_utc),
    reconocidoPorUsuarioId: fila.reconocido_por_usuario_id ?? null,
    detalle: typeof fila.detalle === 'string' ? JSON.parse(fila.detalle) : fila.detalle
  });
}

function normalizarFechaSqlTexto(valor) {
  const texto = String(valor);
  const coincidencia = texto.match(
    /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})\.(\d{3})\d{3}Z$/
  );
  if (!coincidencia) throw new Error(`Fecha SQL UTC no canónica: ${texto}.`);
  return `${coincidencia[1]}.${coincidencia[2]}Z`;
}

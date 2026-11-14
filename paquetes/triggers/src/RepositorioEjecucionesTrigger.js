import { EjecucionTrigger } from './EjecucionTrigger.js';
import { normalizarTipoTrigger } from './CatalogoTiposTrigger.js';
import { normalizarEstadoEjecucionTrigger } from './estadosEjecucionTrigger.js';

function normalizarFechaSqlUtc(valor) {
  if (!valor) {
    return null;
  }

  const fecha = valor instanceof Date ? valor : new Date(valor);

  if (Number.isNaN(fecha.getTime())) {
    return null;
  }

  return fecha.toISOString().slice(0, 19).replace('T', ' ');
}

function clonarJsonSeguro(valor) {
  if (!valor || typeof valor !== 'object') {
    return null;
  }

  return JSON.parse(JSON.stringify(valor));
}

export class RepositorioEjecucionesTrigger {
  constructor(clienteSql) {
    this.clienteSql = clienteSql;
  }

  async buscarPorId(idEjecucion, { conexion = null } = {}) {
    const ejecucionId = this.normalizarId(idEjecucion);

    if (ejecucionId == null) {
      return null;
    }

    const filas = await consultar(conexion || this.clienteSql,
      `
        SELECT
          id,
          asignacion_trigger_monitor_id,
          trigger_id,
          monitor_id,
          tenant_id,
          empresa_id,
          sitio_id,
          monitor_tenant_id,
          monitor_empresa_id,
          monitor_sitio_id,
          trigger_tenant_id,
          trigger_empresa_id,
          trigger_sitio_id,
          version_catalogo,
          clave_idempotencia,
          evento_disparo,
          estado_ejecucion,
          tipo_trigger,
          trigger_nombre,
          monitor_nombre,
          codigo_resultado,
          mensaje_resultado,
          payload_solicitud,
          payload_respuesta,
          payload_error,
          iniciado_en_utc,
          finalizado_en_utc,
          fecha_creacion,
          fecha_actualizacion
        FROM ejecuciones_triggers
        WHERE id = ?
        LIMIT 1
      `,
      [ejecucionId]
    );

    return filas.length > 0 ? new EjecucionTrigger(filas[0]) : null;
  }

  async buscarPorClaveIdempotencia(
    claveIdempotencia,
    { conexion = null, bloquear = false } = {}
  ) {
    const clave = this.normalizarClaveIdempotencia(claveIdempotencia);
    if (!clave) return null;
    const filas = await consultar(conexion || this.clienteSql, `
      SELECT * FROM ejecuciones_triggers
      WHERE clave_idempotencia = ? LIMIT 1${bloquear ? ' FOR UPDATE' : ''}
    `, [clave]);
    return filas.length > 0 ? new EjecucionTrigger(filas[0]) : null;
  }

  async listarPendientes({ limit = 100, tiposTrigger = null } = {}) {
    const tipos = this.normalizarTiposTrigger(tiposTrigger);
    if (Array.isArray(tiposTrigger) && tipos.length === 0) return [];
    const filtroTipos = tipos.length > 0
      ? ` AND tipo_trigger IN (${tipos.map(() => '?').join(',')})`
      : '';
    const filas = await consultar(this.clienteSql, `
      SELECT * FROM ejecuciones_triggers
      WHERE estado_ejecucion = 'pendiente'
        AND clave_idempotencia IS NOT NULL
        ${filtroTipos}
      ORDER BY id ASC LIMIT ?
    `, [...tipos, this.normalizarLimite(limit)]);
    return filas.map((fila) => new EjecucionTrigger(fila));
  }

  async listarNoTerminalesPorTipos({ tiposTrigger = [], limit = 100 } = {}) {
    const tipos = this.normalizarTiposTrigger(tiposTrigger);
    if (tipos.length === 0) return [];
    const marcadores = tipos.map(() => '?').join(',');
    const filas = await consultar(this.clienteSql, `
      SELECT * FROM ejecuciones_triggers
      WHERE estado_ejecucion IN ('pendiente', 'ejecutando')
        AND tipo_trigger IN (${marcadores})
      ORDER BY id ASC LIMIT ?
    `, [...tipos, this.normalizarLimite(limit)]);
    return filas.map((fila) => new EjecucionTrigger(fila));
  }

  async cancelarDnsPendientesPorZonaEnTransaccion(zonaId, {
    conexion,
    finalizadoEnUtc = new Date()
  } = {}) {
    if (!conexion?.execute || this.normalizarId(zonaId) == null) {
      throw new Error('La cancelación DNS requiere zona y transacción SQL.');
    }
    // El objetivo del plan aceptado puede diferir del objetivo actual de la
    // acción. Por ello se consulta la fotografía y no solo el trigger_id.
    const filas = await consultar(conexion, `
      SELECT et.id FROM ejecuciones_triggers et
      WHERE et.tipo_trigger = 'dns' AND et.estado_ejecucion = 'pendiente' AND (
        JSON_UNQUOTE(JSON_EXTRACT(et.payload_solicitud, '$.configuracionEfectiva.zonaId')) = ?
        OR EXISTS (
          SELECT 1 FROM registros_dns r WHERE r.zona_id = ?
          AND JSON_UNQUOTE(JSON_EXTRACT(et.payload_solicitud, '$.configuracionEfectiva.registroId')) = CAST(r.id AS CHAR)
        )
      ) ORDER BY et.id FOR UPDATE
    `, [String(zonaId), zonaId]);
    const canceladas = [];
    for (const fila of filas) {
      // El contrato admite ok/error como terminales. El código identifica una
      // cancelación administrativa sin ejecutar; no se toca trabajo en curso.
      await ejecutar(conexion, `
        UPDATE ejecuciones_triggers SET estado_ejecucion = 'error',
          codigo_resultado = 'dns_objetivo_eliminado',
          mensaje_resultado = 'Cancelada sin ejecutar: se ha eliminado la zona DNS objetivo.',
          finalizado_en_utc = ?
        WHERE id = ? AND estado_ejecucion = 'pendiente'
      `, [normalizarFechaSqlUtc(finalizadoEnUtc), fila.id]);
      canceladas.push(await this.buscarPorId(fila.id, { conexion }));
    }
    return canceladas;
  }

  async cancelarDnsPendientesPorRegistroEnTransaccion(registroId, {
    conexion,
    finalizadoEnUtc = new Date()
  } = {}) {
    if (!conexion?.execute || this.normalizarId(registroId) == null) {
      throw new Error('La cancelación DNS requiere registro y transacción SQL.');
    }
    // Se usa el destino del plan aceptado, aunque su acción se haya reasignado
    // después. Las ejecuciones ya iniciadas conservan su estado e historial.
    const filas = await consultar(conexion, `
      SELECT et.id FROM ejecuciones_triggers et
      WHERE et.tipo_trigger = 'dns' AND et.estado_ejecucion = 'pendiente'
        AND JSON_UNQUOTE(JSON_EXTRACT(
          et.payload_solicitud, '$.configuracionEfectiva.registroId'
        )) = ?
      ORDER BY et.id FOR UPDATE
    `, [String(registroId)]);
    const canceladas = [];
    for (const fila of filas) {
      await ejecutar(conexion, `
        UPDATE ejecuciones_triggers SET estado_ejecucion = 'error',
          codigo_resultado = 'dns_objetivo_eliminado',
          mensaje_resultado = 'Cancelada sin ejecutar: se ha eliminado el registro DNS objetivo.',
          finalizado_en_utc = ?
        WHERE id = ? AND estado_ejecucion = 'pendiente'
      `, [normalizarFechaSqlUtc(finalizadoEnUtc), fila.id]);
      canceladas.push(await this.buscarPorId(fila.id, { conexion }));
    }
    return canceladas;
  }

  async listarPorMonitorId(idMonitor, { limit = 50 } = {}) {
    return this.listarPorCampo('monitor_id', idMonitor, limit);
  }

  async listarPorTriggerId(idTrigger, { limit = 50 } = {}) {
    return this.listarPorCampo('trigger_id', idTrigger, limit);
  }

  async listarPorAsignacionId(idAsignacion, { limit = 50 } = {}) {
    return this.listarPorCampo('asignacion_trigger_monitor_id', idAsignacion, limit);
  }

  async listarRecientesPorMonitorIds(idsMonitor = [], { limit = 50 } = {}) {
    if (!Array.isArray(idsMonitor) || idsMonitor.length === 0) {
      return [];
    }

    const idsNormalizados = idsMonitor
      .map((id) => this.normalizarId(id))
      .filter(Boolean);

    if (idsNormalizados.length === 0) {
      return [];
    }

    const limiteNormalizado = this.normalizarLimite(limit);
    const placeholders = idsNormalizados.map(() => '?').join(', ');
    const filas = await this.clienteSql.consultar(
      `
        SELECT
          id,
          asignacion_trigger_monitor_id,
          trigger_id,
          monitor_id,
          tenant_id,
          empresa_id,
          sitio_id,
          monitor_tenant_id,
          monitor_empresa_id,
          monitor_sitio_id,
          trigger_tenant_id,
          trigger_empresa_id,
          trigger_sitio_id,
          version_catalogo,
          clave_idempotencia,
          evento_disparo,
          estado_ejecucion,
          tipo_trigger,
          trigger_nombre,
          monitor_nombre,
          codigo_resultado,
          mensaje_resultado,
          payload_solicitud,
          payload_respuesta,
          payload_error,
          iniciado_en_utc,
          finalizado_en_utc,
          fecha_creacion,
          fecha_actualizacion
        FROM ejecuciones_triggers
        WHERE monitor_id IN (${placeholders})
        ORDER BY id DESC
        LIMIT ?
      `,
      [...idsNormalizados, limiteNormalizado]
    );

    return filas.map((fila) => new EjecucionTrigger(fila));
  }

  async listarUltimasPorTriggerIdsVisible(contextoUsuarioActual, idsTrigger = []) {
    if (!Array.isArray(idsTrigger) || idsTrigger.length === 0) {
      return new Map();
    }

    const idsNormalizados = idsTrigger
      .map((id) => this.normalizarId(id))
      .filter(Boolean);

    if (idsNormalizados.length === 0) {
      return new Map();
    }

    const placeholders = idsNormalizados.map(() => '?').join(', ');
    const { condiciones, parametros } =
      this.construirCondicionesScope(contextoUsuarioActual, 'eti');
    condiciones.push(`eti.trigger_id IN (${placeholders})`);
    const filas = await this.clienteSql.consultar(
      `
        SELECT
          et.id,
          et.asignacion_trigger_monitor_id,
          et.trigger_id,
          et.monitor_id,
          et.tenant_id,
          et.empresa_id,
          et.sitio_id,
          et.monitor_tenant_id,
          et.monitor_empresa_id,
          et.monitor_sitio_id,
          et.trigger_tenant_id,
          et.trigger_empresa_id,
          et.trigger_sitio_id,
          et.version_catalogo,
          et.clave_idempotencia,
          et.evento_disparo,
          et.estado_ejecucion,
          et.tipo_trigger,
          et.trigger_nombre,
          et.monitor_nombre,
          et.codigo_resultado,
          et.mensaje_resultado,
          et.payload_solicitud,
          et.payload_respuesta,
          et.payload_error,
          et.iniciado_en_utc,
          et.finalizado_en_utc,
          et.fecha_creacion,
          et.fecha_actualizacion
        FROM ejecuciones_triggers et
        INNER JOIN (
          SELECT
            eti.trigger_id,
            MAX(eti.id) AS ultima_id
          FROM ejecuciones_triggers eti
          WHERE ${condiciones.join(' AND ')}
          GROUP BY eti.trigger_id
        ) ultimas ON ultimas.ultima_id = et.id
        ORDER BY et.id DESC
      `,
      [...parametros, ...idsNormalizados]
    );

    return new Map(
      filas.map((fila) => {
        const ejecucion = new EjecucionTrigger(fila);
        return [Number(ejecucion.triggerId), ejecucion.serializarResumen()];
      })
    );
  }

  async crear(ejecucion, { conexion = null } = {}) {
    const fila = this.normalizarEjecucionPersistible(ejecucion);
    const [resultado] = await ejecutar(conexion || this.clienteSql,
      `
        INSERT INTO ejecuciones_triggers (
          asignacion_trigger_monitor_id,
          trigger_id,
          monitor_id,
          tenant_id,
          empresa_id,
          sitio_id,
          monitor_tenant_id,
          monitor_empresa_id,
          monitor_sitio_id,
          trigger_tenant_id,
          trigger_empresa_id,
          trigger_sitio_id,
          version_catalogo,
          clave_idempotencia,
          evento_disparo,
          estado_ejecucion,
          tipo_trigger,
          trigger_nombre,
          monitor_nombre,
          codigo_resultado,
          mensaje_resultado,
          payload_solicitud,
          payload_respuesta,
          payload_error,
          iniciado_en_utc,
          finalizado_en_utc
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
      [
        fila.asignacionTriggerMonitorId,
        fila.triggerId,
        fila.monitorId,
        fila.tenantId,
        fila.empresaId,
        fila.sitioId,
        fila.monitorTenantId,
        fila.monitorEmpresaId,
        fila.monitorSitioId,
        fila.triggerTenantId,
        fila.triggerEmpresaId,
        fila.triggerSitioId,
        fila.versionCatalogo,
        fila.claveIdempotencia,
        fila.eventoDisparo,
        fila.estadoEjecucion,
        fila.tipoTrigger,
        fila.triggerNombre,
        fila.monitorNombre,
        fila.codigoResultado,
        fila.mensajeResultado,
        fila.payloadSolicitud == null ? null : JSON.stringify(fila.payloadSolicitud),
        fila.payloadRespuesta == null ? null : JSON.stringify(fila.payloadRespuesta),
        fila.payloadError == null ? null : JSON.stringify(fila.payloadError),
        fila.iniciadoEnUtc,
        fila.finalizadoEnUtc
      ]
    );

    return this.buscarPorId(resultado.insertId, { conexion });
  }

  async crearIdempotente(ejecucion, { conexion = null } = {}) {
    const clave = this.normalizarClaveIdempotencia(ejecucion?.claveIdempotencia);
    if (!clave) throw new Error('La ejecución idempotente requiere una clave SHA-256.');
    const existente = await this.buscarPorClaveIdempotencia(clave, { conexion });
    if (existente) return { ejecucion: existente, creada: false };
    try {
      const creada = await this.crear({ ...ejecucion, claveIdempotencia: clave }, { conexion });
      return { ejecucion: creada, creada: true };
    } catch (error) {
      if (error?.code !== 'ER_DUP_ENTRY') throw error;
      // Bajo REPEATABLE READ, el SELECT inicial puede haber fijado una vista
      // anterior al INSERT concurrente que provocó el duplicado. Una lectura
      // bloqueante es una lectura actual y permite recuperar la fila ganadora
      // sin convertir una carrera idempotente en un error espurio.
      const concurrente = await this.buscarPorClaveIdempotencia(clave, {
        conexion,
        bloquear: Boolean(conexion)
      });
      if (!concurrente) throw error;
      return { ejecucion: concurrente, creada: false };
    }
  }

  async actualizarResultado({
    idEjecucion,
    estadoEjecucion,
    codigoResultado = null,
    mensajeResultado = null,
    payloadRespuesta = null,
    payloadError = null,
    finalizadoEnUtc = new Date()
  }, { conexion = null } = {}) {
    const resultado = await this.finalizarReclamada({
      idEjecucion,
      estadoEjecucion,
      codigoResultado,
      mensajeResultado,
      payloadRespuesta,
      payloadError,
      finalizadoEnUtc
    }, { conexion });
    return resultado.ejecucion;
  }

  async finalizarReclamada({
    idEjecucion,
    estadoEjecucion,
    codigoResultado = null,
    mensajeResultado = null,
    payloadRespuesta = null,
    payloadError = null,
    finalizadoEnUtc = new Date()
  }, { conexion = null } = {}) {
    const ejecucionId = this.normalizarId(idEjecucion);

    if (ejecucionId == null) {
      throw new Error('El id de la ejecución de trigger no es válido.');
    }

    const estadoNormalizado = normalizarEstadoEjecucionTrigger(estadoEjecucion, {
      porDefecto: 'pendiente'
    });
    if (!['ok', 'error'].includes(estadoNormalizado)) {
      throw new Error('Una ejecución reclamada solo puede finalizar en ok o error.');
    }
    const fechaFinalizada = normalizarFechaSqlUtc(finalizadoEnUtc);

    if (!fechaFinalizada) {
      throw new Error('La fecha final de la ejecución del trigger no es válida.');
    }

    const [resultado] = await ejecutar(conexion || this.clienteSql,
      `
        UPDATE ejecuciones_triggers
        SET
          estado_ejecucion = ?,
          codigo_resultado = ?,
          mensaje_resultado = ?,
          payload_respuesta = ?,
          payload_error = ?,
          finalizado_en_utc = ?
        WHERE id = ? AND estado_ejecucion = 'ejecutando'
      `,
      [
        estadoNormalizado,
        this.normalizarTextoOpcional(codigoResultado, 80),
        this.normalizarTextoOpcional(mensajeResultado, 255),
        this.normalizarPayloadOpcional(payloadRespuesta),
        this.normalizarPayloadOpcional(payloadError),
        fechaFinalizada,
        ejecucionId
      ]
    );

    const ejecucion = await this.buscarPorId(ejecucionId, { conexion });
    if (!ejecucion) {
      return Object.freeze({
        resultado: 'fuente_eliminada',
        estadoEjecucion: estadoNormalizado,
        ejecucion: null
      });
    }
    if (Number(resultado.affectedRows || 0) === 1) {
      return Object.freeze({
        resultado: 'actualizada',
        estadoEjecucion: estadoNormalizado,
        ejecucion
      });
    }
    return Object.freeze({
      resultado: 'ya_finalizada',
      estadoEjecucion: ejecucion.estadoEjecucion,
      ejecucion
    });
  }

  async marcarEjecutando(idEjecucion, { codigoResultado = null, mensajeResultado = null } = {}) {
    const ejecucionId = this.normalizarId(idEjecucion);

    if (ejecucionId == null) {
      throw new Error('El id de la ejecución de trigger no es válido.');
    }

    const [resultado] = await this.clienteSql.ejecutar(
      `
        UPDATE ejecuciones_triggers
        SET
          estado_ejecucion = 'ejecutando',
          codigo_resultado = ?,
          mensaje_resultado = ?
        WHERE id = ? AND estado_ejecucion = 'pendiente'
      `,
      [
        this.normalizarTextoOpcional(codigoResultado, 80),
        this.normalizarTextoOpcional(mensajeResultado, 255),
        ejecucionId
      ]
    );

    if (Number(resultado.affectedRows || 0) === 0) return null;
    return this.buscarPorId(ejecucionId);
  }

  async listarPorCampo(campo, valor, limit = 50) {
    const idNormalizado = this.normalizarId(valor);

    if (idNormalizado == null) {
      return [];
    }

    const limiteNormalizado = this.normalizarLimite(limit);
    const filas = await this.clienteSql.consultar(
      `
        SELECT
          id,
          asignacion_trigger_monitor_id,
          trigger_id,
          monitor_id,
          tenant_id,
          empresa_id,
          sitio_id,
          monitor_tenant_id,
          monitor_empresa_id,
          monitor_sitio_id,
          trigger_tenant_id,
          trigger_empresa_id,
          trigger_sitio_id,
          version_catalogo,
          clave_idempotencia,
          evento_disparo,
          estado_ejecucion,
          tipo_trigger,
          trigger_nombre,
          monitor_nombre,
          codigo_resultado,
          mensaje_resultado,
          payload_solicitud,
          payload_respuesta,
          payload_error,
          iniciado_en_utc,
          finalizado_en_utc,
          fecha_creacion,
          fecha_actualizacion
        FROM ejecuciones_triggers
        WHERE ${campo} = ?
        ORDER BY id DESC
        LIMIT ?
      `,
      [idNormalizado, limiteNormalizado]
    );

    return filas.map((fila) => new EjecucionTrigger(fila));
  }

  normalizarEjecucionPersistible(ejecucion) {
    if (!ejecucion) {
      throw new Error('La ejecución de trigger es obligatoria.');
    }

    const serializada =
      typeof ejecucion.serializarPersistencia === 'function'
        ? ejecucion.serializarPersistencia()
        : ejecucion;
    const triggerId = this.normalizarId(serializada.triggerId);
    const eventoDisparo = this.normalizarTextoObligatorio(
      serializada.eventoDisparo,
      'El evento de disparo de la ejecución del trigger es obligatorio.',
      40
    );
    const tipoTrigger = this.normalizarTextoObligatorio(
      serializada.tipoTrigger,
      'El tipo de trigger de la ejecución es obligatorio.',
      40
    );
    const triggerNombre = this.normalizarTextoObligatorio(
      serializada.triggerNombre,
      'El nombre del trigger ejecutado es obligatorio.',
      160
    );
    const iniciadoEnUtc = normalizarFechaSqlUtc(serializada.iniciadoEnUtc);

    if (triggerId == null) {
      throw new Error('El trigger asociado a la ejecución no es válido.');
    }

    if (!iniciadoEnUtc) {
      throw new Error('La fecha de inicio de la ejecución del trigger no es válida.');
    }

    return {
      asignacionTriggerMonitorId: this.normalizarIdOpcional(
        serializada.asignacionTriggerMonitorId
      ),
      triggerId,
      monitorId: this.normalizarIdOpcional(serializada.monitorId),
      tenantId: this.normalizarIdOpcional(serializada.tenantId),
      empresaId: this.normalizarIdOpcional(serializada.empresaId),
      sitioId: this.normalizarIdOpcional(serializada.sitioId),
      monitorTenantId: this.normalizarIdOpcional(
        serializada.monitorTenantId ?? serializada.tenantId
      ),
      monitorEmpresaId: this.normalizarIdOpcional(
        serializada.monitorEmpresaId ?? serializada.empresaId
      ),
      monitorSitioId: this.normalizarIdOpcional(
        serializada.monitorSitioId ?? serializada.sitioId
      ),
      triggerTenantId: this.normalizarIdOpcional(serializada.triggerTenantId),
      triggerEmpresaId: this.normalizarIdOpcional(serializada.triggerEmpresaId),
      triggerSitioId: this.normalizarIdOpcional(serializada.triggerSitioId),
      versionCatalogo: this.normalizarTextoOpcional(serializada.versionCatalogo, 64),
      claveIdempotencia: this.normalizarClaveIdempotencia(
        serializada.claveIdempotencia
      ),
      eventoDisparo,
      estadoEjecucion: normalizarEstadoEjecucionTrigger(
        serializada.estadoEjecucion,
        { porDefecto: 'pendiente' }
      ),
      tipoTrigger,
      triggerNombre,
      monitorNombre: this.normalizarTextoOpcional(serializada.monitorNombre, 160),
      codigoResultado: this.normalizarTextoOpcional(serializada.codigoResultado, 80),
      mensajeResultado: this.normalizarTextoOpcional(
        serializada.mensajeResultado,
        255
      ),
      payloadSolicitud: clonarJsonSeguro(serializada.payloadSolicitud),
      payloadRespuesta: clonarJsonSeguro(serializada.payloadRespuesta),
      payloadError: clonarJsonSeguro(serializada.payloadError),
      iniciadoEnUtc,
      finalizadoEnUtc: normalizarFechaSqlUtc(serializada.finalizadoEnUtc)
    };
  }

  normalizarId(valor) {
    const convertido = Number.parseInt(String(valor ?? ''), 10);
    return Number.isInteger(convertido) && convertido > 0 ? convertido : null;
  }

  normalizarTiposTrigger(valores) {
    if (valores == null) return [];
    if (!Array.isArray(valores)) {
      throw new Error('Los tipos de ejecución de trigger deben ser una lista.');
    }
    return Array.from(new Set(valores.map((tipo) => normalizarTipoTrigger(tipo))));
  }

  normalizarIdOpcional(valor) {
    if (valor == null || String(valor).trim() === '') {
      return null;
    }

    return this.normalizarId(valor);
  }

  normalizarLimite(valor) {
    const convertido = Number.parseInt(String(valor ?? ''), 10);

    if (!Number.isInteger(convertido) || convertido <= 0) {
      return 50;
    }

    return Math.min(convertido, 500);
  }

  normalizarClaveIdempotencia(valor) {
    const clave = String(valor || '').trim().toLowerCase();
    return /^[0-9a-f]{64}$/.test(clave) ? clave : null;
  }

  construirCondicionesScope(contextoUsuarioActual, alias = 'et') {
    if (contextoUsuarioActual?.nivelScope === 'portal') {
      return { condiciones: [], parametros: [] };
    }

    if (contextoUsuarioActual?.nivelScope === 'tenant') {
      return {
        condiciones: [`${alias}.monitor_tenant_id = ?`],
        parametros: [contextoUsuarioActual.tenantId]
      };
    }

    if (contextoUsuarioActual?.nivelScope === 'empresa') {
      return {
        condiciones: [`${alias}.monitor_empresa_id = ?`],
        parametros: [contextoUsuarioActual.empresaId]
      };
    }

    if (contextoUsuarioActual?.nivelScope === 'sitio') {
      return {
        condiciones: [`${alias}.monitor_sitio_id = ?`],
        parametros: [contextoUsuarioActual.sitioId]
      };
    }

    return {
      condiciones: ['1 = 0'],
      parametros: []
    };
  }

  normalizarTextoObligatorio(valor, mensaje, maximo) {
    const normalizado = String(valor || '').trim();

    if (!normalizado) {
      throw new Error(mensaje);
    }

    return normalizado.slice(0, maximo);
  }

  normalizarTextoOpcional(valor, maximo) {
    const normalizado = String(valor || '').trim();
    return normalizado ? normalizado.slice(0, maximo) : null;
  }

  normalizarPayloadOpcional(valor) {
    if (valor == null) {
      return null;
    }

    if (typeof valor === 'string') {
      return valor;
    }

    return JSON.stringify(valor);
  }
}

async function ejecutar(ejecutor, sql, parametros = []) {
  return typeof ejecutor.ejecutar === 'function'
    ? ejecutor.ejecutar(sql, parametros)
    : ejecutor.execute(sql, parametros);
}

async function consultar(ejecutor, sql, parametros = []) {
  if (typeof ejecutor.consultar === 'function') return ejecutor.consultar(sql, parametros);
  const [filas] = await ejecutor.execute(sql, parametros);
  return filas;
}

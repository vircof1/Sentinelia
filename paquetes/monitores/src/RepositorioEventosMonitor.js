import { EventoMonitor } from './EventoMonitor.js';
import {
  normalizarTipoMonitor as normalizarTipoMonitorCatalogo
} from './CatalogoTiposMonitor.js';

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

export class RepositorioEventosMonitor {
  constructor(clienteSql) {
    this.clienteSql = clienteSql;
  }

  async buscarPorId(idEvento) {
    const idNormalizado = this.normalizarIdPositivo(idEvento);

    if (idNormalizado == null) {
      return null;
    }

    const filas = await this.clienteSql.consultar(
      `
        SELECT
          id,
          monitor_id,
          tenant_id,
          empresa_id,
          sitio_id,
          version_catalogo,
          tipo_monitor,
          estado_detectado,
          codigo_resultado,
          mensaje_resultado,
          exito,
          duracion_total_ms,
          ejecutado_en_utc,
          payload_evento,
          fecha_creacion
        FROM eventos_monitores
        WHERE id = ?
        LIMIT 1
      `,
      [idNormalizado]
    );

    return filas.length > 0 ? new EventoMonitor(filas[0]) : null;
  }

  async listarPorMonitorId(
    monitorId,
    {
      limite = 50,
      ejecutadoDesdeUtc = null,
      ejecutadoHastaUtc = null
    } = {}
  ) {
    const monitorIdNormalizado = this.normalizarIdPositivo(monitorId);

    if (monitorIdNormalizado == null) {
      return [];
    }

    const limiteNormalizado = this.normalizarLimite(limite);
    const condiciones = ['monitor_id = ?'];
    const parametros = [monitorIdNormalizado];
    const fechaDesdeSql = normalizarFechaSqlUtc(ejecutadoDesdeUtc);
    const fechaHastaSql = normalizarFechaSqlUtc(ejecutadoHastaUtc);

    if (fechaDesdeSql) {
      condiciones.push('ejecutado_en_utc >= ?');
      parametros.push(fechaDesdeSql);
    }

    if (fechaHastaSql) {
      condiciones.push('ejecutado_en_utc <= ?');
      parametros.push(fechaHastaSql);
    }

    const filas = await this.clienteSql.consultar(
      `
        SELECT
          id,
          monitor_id,
          tenant_id,
          empresa_id,
          sitio_id,
          version_catalogo,
          tipo_monitor,
          estado_detectado,
          codigo_resultado,
          mensaje_resultado,
          exito,
          duracion_total_ms,
          ejecutado_en_utc,
          payload_evento,
          fecha_creacion
        FROM eventos_monitores
        WHERE ${condiciones.join(' AND ')}
        ORDER BY ejecutado_en_utc DESC, id DESC
        LIMIT ?
      `,
      [...parametros, limiteNormalizado]
    );

    return filas.map((fila) => new EventoMonitor(fila));
  }

  async listarUltimosPorMonitorIds(idsMonitor = []) {
    if (!Array.isArray(idsMonitor) || idsMonitor.length === 0) {
      return [];
    }

    const idsNormalizados = [
      ...new Set(
        idsMonitor
          .map((id) => this.normalizarIdPositivo(id))
          .filter(Boolean)
      )
    ];

    if (idsNormalizados.length === 0) {
      return [];
    }

    const placeholders = idsNormalizados.map(() => '?').join(', ');
    const filas = await this.clienteSql.consultar(
      `
        SELECT
          id,
          monitor_id,
          tenant_id,
          empresa_id,
          sitio_id,
          version_catalogo,
          tipo_monitor,
          estado_detectado,
          codigo_resultado,
          mensaje_resultado,
          exito,
          duracion_total_ms,
          ejecutado_en_utc,
          payload_evento,
          fecha_creacion
        FROM eventos_monitores
        WHERE monitor_id IN (${placeholders})
        ORDER BY monitor_id ASC, ejecutado_en_utc DESC, id DESC
      `,
      idsNormalizados
    );

    const ultimos = new Map();

    for (const fila of filas) {
      const monitorId = this.normalizarIdPositivo(fila.monitor_id);

      if (monitorId == null || ultimos.has(monitorId)) {
        continue;
      }

      ultimos.set(monitorId, new EventoMonitor(fila));
    }

    return Array.from(ultimos.values());
  }

  async listarVisiblesFiltrados(
    contextoUsuarioActual,
    {
      monitorId = null,
      monitorIds = [],
      tipo = null,
      estadoDetectado = null,
      codigoResultado = null,
      desdeUtc = null,
      hastaUtc = null,
      limite = 1000,
      orden = 'asc'
    } = {}
  ) {
    const consulta = this.construirConsultaListadoVisible(contextoUsuarioActual, {
      monitorId,
      monitorIds,
      tipo,
      estadoDetectado,
      codigoResultado,
      desdeUtc,
      hastaUtc
    });
    const limiteNormalizado = this.normalizarLimite(limite);
    const direccion = String(orden || '').trim().toLowerCase() === 'desc'
      ? 'DESC'
      : 'ASC';
    const filas = await this.clienteSql.consultar(
      `
        SELECT
          id,
          monitor_id,
          tenant_id,
          empresa_id,
          sitio_id,
          version_catalogo,
          tipo_monitor,
          estado_detectado,
          codigo_resultado,
          mensaje_resultado,
          exito,
          duracion_total_ms,
          ejecutado_en_utc,
          payload_evento,
          fecha_creacion
        FROM eventos_monitores
        ${consulta.where}
        ORDER BY ejecutado_en_utc ${direccion}, id ${direccion}
        LIMIT ?
      `,
      [...consulta.parametros, limiteNormalizado]
    );

    return filas.map((fila) => new EventoMonitor(fila));
  }

  async contarVisiblesFiltrados(
    contextoUsuarioActual,
    {
      monitorId = null,
      monitorIds = [],
      tipo = null,
      estadoDetectado = null,
      codigoResultado = null,
      desdeUtc = null,
      hastaUtc = null
    } = {}
  ) {
    const consulta = this.construirConsultaListadoVisible(contextoUsuarioActual, {
      monitorId,
      monitorIds,
      tipo,
      estadoDetectado,
      codigoResultado,
      desdeUtc,
      hastaUtc
    });
    const filas = await this.clienteSql.consultar(
      `
        SELECT COUNT(*) AS total
        FROM eventos_monitores
        ${consulta.where}
      `,
      consulta.parametros
    );

    return Number(filas[0]?.total || 0);
  }

  async resumirIntervalosVisibles(
    contextoUsuarioActual,
    {
      monitorId,
      tipo = null,
      estadoDetectado = null,
      codigoResultado = null,
      desdeUtc,
      hastaUtc,
      intervalos = 48
    } = {}
  ) {
    const monitorIdNormalizado = this.normalizarIdPositivo(monitorId);
    if (monitorIdNormalizado == null) {
      throw new Error('El resumen temporal exige un monitor concreto.');
    }
    const cantidadIntervalos = Math.max(12, Math.min(72, Number.parseInt(intervalos, 10) || 48));
    const desdeMs = Date.parse(desdeUtc);
    const hastaMs = Date.parse(hastaUtc);
    if (!Number.isFinite(desdeMs) || !Number.isFinite(hastaMs) || hastaMs <= desdeMs) {
      throw new Error('El rango temporal no es válido.');
    }
    const anchoMicrosegundos = Math.max(1, Math.ceil(((hastaMs - desdeMs) * 1000) / cantidadIntervalos));
    const consulta = this.construirConsultaListadoVisible(contextoUsuarioActual, {
      monitorId: monitorIdNormalizado,
      tipo,
      estadoDetectado,
      codigoResultado,
      desdeUtc,
      hastaUtc
    });
    const desdeSql = normalizarFechaSqlUtc(desdeUtc);
    const filas = await this.clienteSql.consultar(
      `
        WITH filtrados AS (
          SELECT id, ejecutado_en_utc, duracion_total_ms, exito,
                 LEAST(?, FLOOR(TIMESTAMPDIFF(MICROSECOND, ?, ejecutado_en_utc) / ?)) AS intervalo
          FROM eventos_monitores
          ${consulta.where}
        ), ordenados AS (
          SELECT intervalo, duracion_total_ms, exito,
                 ROW_NUMBER() OVER (PARTITION BY intervalo ORDER BY ejecutado_en_utc, id) AS primero,
                 ROW_NUMBER() OVER (PARTITION BY intervalo ORDER BY ejecutado_en_utc DESC, id DESC) AS ultimo
          FROM filtrados
        )
        SELECT intervalo,
               COUNT(*) AS cantidad,
               SUM(CASE WHEN exito = 0 THEN 1 ELSE 0 END) AS fallos,
               MIN(duracion_total_ms) AS minimo,
               MAX(duracion_total_ms) AS maximo,
               MAX(CASE WHEN primero = 1 THEN duracion_total_ms END) AS apertura,
               MAX(CASE WHEN ultimo = 1 THEN duracion_total_ms END) AS cierre
        FROM ordenados
        GROUP BY intervalo
        ORDER BY intervalo
      `,
      [cantidadIntervalos - 1, desdeSql, anchoMicrosegundos, ...consulta.parametros]
    );

    return {
      intervalos: cantidadIntervalos,
      puntos: filas.map((fila) => ({
        intervalo: Number(fila.intervalo),
        cantidad: Number(fila.cantidad),
        fallos: Number(fila.fallos),
        minimo: Number(fila.minimo),
        maximo: Number(fila.maximo),
        apertura: Number(fila.apertura),
        cierre: Number(fila.cierre)
      }))
    };
  }

  async resumirIntervalosComparados(
    contextoUsuarioActual,
    { monitorIds = [], desdeUtc, hastaUtc, intervalos = 48 } = {}
  ) {
    const ids = this.normalizarIdsPositivosUnicos(monitorIds).slice(0, 3);
    const desdeMs = Date.parse(desdeUtc);
    const hastaMs = Date.parse(hastaUtc);
    if (ids.length === 0 || !Number.isFinite(desdeMs) ||
      !Number.isFinite(hastaMs) || hastaMs <= desdeMs) {
      throw new Error('La comparación necesita monitores y un período válido.');
    }

    const cantidadIntervalos = Math.max(24, Math.min(72, Number.parseInt(intervalos, 10) || 48));
    const anchoMicrosegundos = Math.max(1, Math.ceil(((hastaMs - desdeMs) * 1000) / cantidadIntervalos));
    const consulta = this.construirConsultaListadoVisible(contextoUsuarioActual, {
      monitorIds: ids, desdeUtc, hastaUtc
    });
    const desdeSql = normalizarFechaSqlUtc(desdeUtc);
    const exitoTecnico = `COALESCE(
      CASE JSON_UNQUOTE(JSON_EXTRACT(payload_evento, '$.exitoTecnico'))
        WHEN 'true' THEN 1 WHEN 'false' THEN 0 END,
      exito
    )`;
    const rtt = `CAST(JSON_UNQUOTE(JSON_EXTRACT(payload_evento, '$.metricaPrincipal.rttMs')) AS DECIMAL(14,3))`;
    const timeout = `CAST(JSON_UNQUOTE(JSON_EXTRACT(payload_evento, '$.protocolo.timeoutMs')) AS DECIMAL(14,3))`;
    const metrica = `CASE
      WHEN tipo_monitor = 'ping' AND ${exitoTecnico} = 1
        THEN COALESCE(${rtt}, ${timeout}, duracion_total_ms)
      WHEN ${exitoTecnico} = 0
        THEN COALESCE(${timeout}, duracion_total_ms)
      ELSE duracion_total_ms
    END`;
    const filas = await this.clienteSql.consultar(
      `
        WITH filtrados AS (
          SELECT monitor_id, id, ejecutado_en_utc,
                 ${exitoTecnico} AS exito_tecnico,
                 ${metrica} AS metrica_ms,
                 LEAST(?, FLOOR(TIMESTAMPDIFF(MICROSECOND, ?, ejecutado_en_utc) / ?)) AS intervalo
          FROM eventos_monitores
          ${consulta.where}
        ), ordenados AS (
          SELECT monitor_id, intervalo, metrica_ms, exito_tecnico,
                 ROW_NUMBER() OVER (PARTITION BY monitor_id, intervalo ORDER BY ejecutado_en_utc, id) AS primero,
                 COUNT(*) OVER (PARTITION BY monitor_id, intervalo) AS total_intervalo
          FROM filtrados
        )
        SELECT monitor_id, intervalo, COUNT(*) AS cantidad,
               SUM(CASE WHEN exito_tecnico = 0 THEN 1 ELSE 0 END) AS fallos,
               MIN(metrica_ms) AS minimo, MAX(metrica_ms) AS maximo,
               MAX(CASE WHEN primero = 1 THEN metrica_ms END) AS apertura,
               MAX(CASE WHEN primero = total_intervalo THEN metrica_ms END) AS cierre
        FROM ordenados
        GROUP BY monitor_id, intervalo
        ORDER BY intervalo, monitor_id
      `,
      [cantidadIntervalos - 1, desdeSql, anchoMicrosegundos, ...consulta.parametros]
    );

    return {
      intervalos: cantidadIntervalos,
      puntos: filas.map((fila) => ({
        monitorId: Number(fila.monitor_id),
        intervalo: Number(fila.intervalo),
        cantidad: Number(fila.cantidad),
        fallos: Number(fila.fallos),
        minimo: Number(fila.minimo),
        maximo: Number(fila.maximo),
        apertura: Number(fila.apertura),
        cierre: Number(fila.cierre)
      }))
    };
  }

  async resolverHitosVisiblesPorMonitorId(contextoUsuarioActual, monitorId) {
    const ultimoFallo = (await this.listarVisiblesFiltrados(
      contextoUsuarioActual,
      {
        monitorId,
        estadoDetectado: 'indisponible',
        limite: 1,
        orden: 'desc'
      }
    ))[0] || null;

    if (!ultimoFallo?.ejecutadoEnUtc) {
      return {
        ultimoFallo: null,
        ultimaRecuperacion: null
      };
    }

    const ultimaRecuperacion = (await this.listarVisiblesFiltrados(
      contextoUsuarioActual,
      {
        monitorId,
        estadoDetectado: 'disponible',
        desdeUtc: ultimoFallo.ejecutadoEnUtc,
        limite: 1,
        orden: 'asc'
      }
    ))[0] || null;

    return {
      ultimoFallo,
      ultimaRecuperacion
    };
  }

  async crearEvento(evento) {
    const [resultado] = await this.insertarEventos([evento]);
    return this.buscarPorId(resultado.insertId);
  }

  async guardarEventos(eventos = []) {
    const resultado = await this.guardarEventosDetallado(eventos);
    return resultado.totalPersistidos;
  }

  async guardarEventosDetallado(eventos = []) {
    const filas = this.prepararFilasPersistibles(eventos);

    if (filas.length === 0) {
      return {
        totalPersistidos: 0,
        eventosPersistidos: []
      };
    }

    const [resultado] = await this.insertarEventosDesdeFilas(filas);
    const totalPersistidos = Number(resultado.affectedRows || 0);
    const primerId = this.normalizarIdPositivo(resultado.insertId);
    const eventosPersistidos = [];

    for (let indice = 0; indice < totalPersistidos; indice += 1) {
      const fila = filas[indice];

      eventosPersistidos.push(
        new EventoMonitor({
          id: primerId == null ? null : primerId + indice,
          monitor_id: fila.monitorId,
          tenant_id: fila.tenantId,
          empresa_id: fila.empresaId,
          sitio_id: fila.sitioId,
          version_catalogo: fila.versionCatalogo,
          tipo_monitor: fila.tipoMonitor,
          estado_detectado: fila.estadoDetectado,
          codigo_resultado: fila.codigoResultado,
          mensaje_resultado: fila.mensajeResultado,
          exito: fila.exito,
          duracion_total_ms: fila.duracionTotalMs,
          ejecutado_en_utc: fila.ejecutadoEnUtc,
          payload_evento: fila.payloadEvento
        })
      );
    }

    return {
      totalPersistidos,
      eventosPersistidos
    };
  }

  async eliminarAnterioresAEjecutadoEnUtc(fechaCorteUtc) {
    const fechaCorteNormalizada = normalizarFechaSqlUtc(fechaCorteUtc);

    if (!fechaCorteNormalizada) {
      return 0;
    }

    const [resultado] = await this.clienteSql.ejecutar(
      `
        DELETE FROM eventos_monitores
        WHERE ejecutado_en_utc < ?
      `,
      [fechaCorteNormalizada]
    );

    return Number(resultado.affectedRows || 0);
  }

  async insertarEventos(eventos = []) {
    const filas = this.prepararFilasPersistibles(eventos);
    return this.insertarEventosDesdeFilas(filas);
  }

  async insertarEventosDesdeFilas(filas = []) {
    if (!Array.isArray(filas) || filas.length === 0) {
      return [{ affectedRows: 0 }];
    }

    const placeholders = filas.map(() => '(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').join(', ');
    const parametros = filas.flatMap((fila) => [
      fila.monitorId,
      fila.tenantId,
      fila.empresaId,
      fila.sitioId,
      fila.versionCatalogo,
      fila.tipoMonitor,
      fila.estadoDetectado,
      fila.codigoResultado,
      fila.mensajeResultado,
      fila.exito ? 1 : 0,
      fila.duracionTotalMs,
      fila.ejecutadoEnUtc,
      fila.payloadEvento == null ? null : JSON.stringify(fila.payloadEvento)
    ]);

    return this.clienteSql.ejecutar(
      `
        INSERT INTO eventos_monitores (
          monitor_id,
          tenant_id,
          empresa_id,
          sitio_id,
          version_catalogo,
          tipo_monitor,
          estado_detectado,
          codigo_resultado,
          mensaje_resultado,
          exito,
          duracion_total_ms,
          ejecutado_en_utc,
          payload_evento
        ) VALUES ${placeholders}
      `,
      parametros
    );
  }

  prepararFilasPersistibles(eventos = []) {
    if (!Array.isArray(eventos) || eventos.length === 0) {
      return [];
    }

    return eventos
      .map((evento) => this.normalizarEventoPersistible(evento))
      .filter(Boolean);
  }

  normalizarEventoPersistible(evento) {
    if (!evento) {
      return null;
    }

    const serializado =
      typeof evento.serializarPersistencia === 'function'
        ? evento.serializarPersistencia()
        : evento;

    const monitorId = this.normalizarIdPositivo(serializado.monitorId);
    const tenantId = this.normalizarIdPositivo(serializado.tenantId);
    const empresaId = this.normalizarIdPositivo(serializado.empresaId);
    const sitioId = this.normalizarIdPositivo(serializado.sitioId);
    const ejecutadoEnUtc = normalizarFechaSqlUtc(serializado.ejecutadoEnUtc);
    const versionCatalogo = String(serializado.versionCatalogo || '').trim();
    const tipoMonitor = String(serializado.tipoMonitor || '')
      .trim()
      .toLowerCase()
      .slice(0, 40);

    if (
      monitorId == null ||
      tenantId == null ||
      empresaId == null ||
      !ejecutadoEnUtc ||
      !versionCatalogo ||
      !tipoMonitor
    ) {
      return null;
    }

    return {
      monitorId,
      tenantId,
      empresaId,
      sitioId,
      versionCatalogo,
      tipoMonitor,
      estadoDetectado: String(serializado.estadoDetectado || 'desconocido')
        .trim()
        .toLowerCase(),
      codigoResultado: String(serializado.codigoResultado || 'sin_resultado')
        .trim()
        .slice(0, 80),
      mensajeResultado: String(
        serializado.mensajeResultado || 'Sin mensaje de resultado.'
      )
        .trim()
        .slice(0, 500),
      exito: Boolean(serializado.exito),
      duracionTotalMs: Math.max(
        0,
        Number.parseInt(String(serializado.duracionTotalMs || 0), 10) || 0
      ),
      ejecutadoEnUtc,
      payloadEvento: clonarJsonSeguro(serializado.payloadEvento)
    };
  }

  normalizarIdPositivo(valor) {
    const convertido = Number.parseInt(String(valor ?? ''), 10);
    return Number.isInteger(convertido) && convertido > 0 ? convertido : null;
  }

  normalizarIdsPositivosUnicos(valores = []) {
    if (!Array.isArray(valores) || valores.length === 0) {
      return [];
    }

    return [
      ...new Set(
        valores
          .map((valor) => this.normalizarIdPositivo(valor))
          .filter(Boolean)
      )
    ];
  }

  construirConsultaListadoVisible(
    contextoUsuarioActual,
    {
      monitorId = null,
      monitorIds = [],
      tipo = null,
      estadoDetectado = null,
      codigoResultado = null,
      desdeUtc = null,
      hastaUtc = null
    } = {}
  ) {
    const { condiciones, parametros } =
      this.construirCondicionesScope(contextoUsuarioActual);
    const monitorIdNormalizado = this.normalizarIdPositivo(monitorId);
    const monitorIdsNormalizados = this.normalizarIdsPositivosUnicos(monitorIds);
    const tipoNormalizado = this.normalizarTipoMonitor(tipo);
    const estadoNormalizado = this.normalizarEstadoDetectado(estadoDetectado);
    const codigoNormalizado = this.normalizarTextoCorto(codigoResultado, 80);
    const desdeSql = normalizarFechaSqlUtc(desdeUtc);
    const hastaSql = normalizarFechaSqlUtc(hastaUtc);

    if (monitorIdsNormalizados.length > 0) {
      const placeholders = monitorIdsNormalizados.map(() => '?').join(', ');
      condiciones.push(`monitor_id IN (${placeholders})`);
      parametros.push(...monitorIdsNormalizados);
    } else if (monitorIdNormalizado != null) {
      condiciones.push('monitor_id = ?');
      parametros.push(monitorIdNormalizado);
    }

    if (tipoNormalizado) {
      condiciones.push('tipo_monitor = ?');
      parametros.push(tipoNormalizado);
    }

    if (estadoNormalizado) {
      condiciones.push('estado_detectado = ?');
      parametros.push(estadoNormalizado);
    }

    if (codigoNormalizado) {
      condiciones.push('codigo_resultado = ?');
      parametros.push(codigoNormalizado);
    }

    if (desdeSql) {
      condiciones.push('ejecutado_en_utc >= ?');
      parametros.push(desdeSql);
    }

    if (hastaSql) {
      condiciones.push('ejecutado_en_utc <= ?');
      parametros.push(hastaSql);
    }

    return {
      where: condiciones.length > 0 ? `WHERE ${condiciones.join(' AND ')}` : '',
      parametros
    };
  }

  construirCondicionesScope(contextoUsuarioActual) {
    if (contextoUsuarioActual?.esOperadorSistema) {
      return { condiciones: [], parametros: [] };
    }

    if (contextoUsuarioActual?.nivelScope === 'tenant') {
      return {
        condiciones: ['tenant_id = ?'],
        parametros: [contextoUsuarioActual.tenantId]
      };
    }

    if (contextoUsuarioActual?.nivelScope === 'empresa') {
      return {
        condiciones: ['empresa_id = ?'],
        parametros: [contextoUsuarioActual.empresaId]
      };
    }

    if (contextoUsuarioActual?.nivelScope === 'sitio') {
      return {
        condiciones: ['sitio_id = ?'],
        parametros: [contextoUsuarioActual.sitioId]
      };
    }

    return {
      condiciones: ['1 = 0'],
      parametros: []
    };
  }

  normalizarTipoMonitor(valor) {
    const normalizado = normalizarTipoMonitorCatalogo(valor);
    return normalizado ? normalizado.slice(0, 40) : null;
  }

  normalizarEstadoDetectado(valor) {
    const normalizado = String(valor || '').trim().toLowerCase();
    return ['disponible', 'indisponible', 'degradado', 'desconocido'].includes(
      normalizado
    )
      ? normalizado
      : null;
  }

  normalizarTextoCorto(valor, maxLongitud = 80) {
    const normalizado = String(valor || '').trim();
    return normalizado ? normalizado.slice(0, maxLongitud) : null;
  }

  normalizarLimite(valor) {
    const convertido = Number.parseInt(String(valor ?? ''), 10);

    if (!Number.isInteger(convertido) || convertido <= 0) {
      return 50;
    }

    return Math.min(5000, convertido);
  }
}

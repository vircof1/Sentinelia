import { TramoHistoricoMonitor } from './TramoHistoricoMonitor.js';
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

export class RepositorioHistoricoMonitores {
  constructor(clienteSql) {
    this.clienteSql = clienteSql;
  }

  async buscarPorId(idTramo) {
    const idNormalizado = this.normalizarIdPositivo(idTramo);

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
          estado_tramo,
          codigo_ultimo_resultado,
          mensaje_ultimo_resultado,
          valido_desde_utc,
          valido_hasta_utc,
          contador_repeticiones,
          ultimo_evento_id,
          payload_tramo,
          fecha_creacion,
          fecha_actualizacion
        FROM historico_monitores
        WHERE id = ?
        LIMIT 1
      `,
      [idNormalizado]
    );

    return filas.length > 0 ? new TramoHistoricoMonitor(filas[0]) : null;
  }

  async listarPorMonitorId(
    monitorId,
    {
      limite = 50,
      validoDesdeUtc = null,
      validoHastaUtc = null
    } = {}
  ) {
    const monitorIdNormalizado = this.normalizarIdPositivo(monitorId);

    if (monitorIdNormalizado == null) {
      return [];
    }

    const limiteNormalizado = this.normalizarLimite(limite);
    const condiciones = ['monitor_id = ?'];
    const parametros = [monitorIdNormalizado];
    const fechaDesdeSql = normalizarFechaSqlUtc(validoDesdeUtc);
    const fechaHastaSql = normalizarFechaSqlUtc(validoHastaUtc);

    if (fechaDesdeSql) {
      condiciones.push('valido_hasta_utc >= ?');
      parametros.push(fechaDesdeSql);
    }

    if (fechaHastaSql) {
      condiciones.push('valido_desde_utc <= ?');
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
          estado_tramo,
          codigo_ultimo_resultado,
          mensaje_ultimo_resultado,
          valido_desde_utc,
          valido_hasta_utc,
          contador_repeticiones,
          ultimo_evento_id,
          payload_tramo,
          fecha_creacion,
          fecha_actualizacion
        FROM historico_monitores
        WHERE ${condiciones.join(' AND ')}
        ORDER BY valido_hasta_utc DESC, id DESC
        LIMIT ?
      `,
      [...parametros, limiteNormalizado]
    );

    return filas.map((fila) => new TramoHistoricoMonitor(fila));
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
          estado_tramo,
          codigo_ultimo_resultado,
          mensaje_ultimo_resultado,
          valido_desde_utc,
          valido_hasta_utc,
          contador_repeticiones,
          ultimo_evento_id,
          payload_tramo,
          fecha_creacion,
          fecha_actualizacion
        FROM historico_monitores
        WHERE monitor_id IN (${placeholders})
        ORDER BY monitor_id ASC, valido_hasta_utc DESC, id DESC
      `,
      idsNormalizados
    );

    const ultimos = new Map();

    for (const fila of filas) {
      const monitorId = this.normalizarIdPositivo(fila.monitor_id);

      if (monitorId == null || ultimos.has(monitorId)) {
        continue;
      }

      ultimos.set(monitorId, new TramoHistoricoMonitor(fila));
    }

    return Array.from(ultimos.values());
  }

  async listarPaginadoVisible(
    contextoUsuarioActual,
    {
      monitorId = null,
      tipo = null,
      estadoTramo = null,
      codigoResultado = null,
      desdeUtc = null,
      hastaUtc = null,
      pagina = 1,
      tamanoPagina = 25,
      ordenarPor = 'valido_hasta',
      direccionOrden = 'desc'
    } = {}
  ) {
    const consulta = this.construirConsultaListadoVisible(contextoUsuarioActual, {
      monitorId,
      tipo,
      estadoTramo,
      codigoResultado,
      desdeUtc,
      hastaUtc
    });
    const tamanoNormalizado = this.normalizarTamanoPagina(tamanoPagina);
    const paginaSolicitada = this.normalizarPagina(pagina);
    const orden = this.resolverOrdenListado(ordenarPor, direccionOrden);
    const [totalVisible, resumen] = await Promise.all([
      this.contarVisible(contextoUsuarioActual),
      this.resumirFiltrado(contextoUsuarioActual, {
        monitorId,
        tipo,
        estadoTramo,
        codigoResultado,
        desdeUtc,
        hastaUtc
      })
    ]);
    const totalFiltrado = Number(resumen.totalTramos || 0);
    const totalPaginas = Math.max(1, Math.ceil(totalFiltrado / tamanoNormalizado));
    const paginaEfectiva = Math.min(paginaSolicitada, totalPaginas);
    const offset = (paginaEfectiva - 1) * tamanoNormalizado;
    const filas = await this.clienteSql.consultar(
      `
        SELECT
          ${this.columnasSeleccionHistorico('h')},
          m.nombre AS monitor_nombre,
          m.activo AS monitor_activo,
          t.nombre AS tenant_nombre,
          e.nombre AS empresa_nombre,
          s.nombre AS sitio_nombre
        FROM historico_monitores h
        LEFT JOIN monitores m ON m.id = h.monitor_id
        LEFT JOIN tenants t ON t.id = h.tenant_id
        LEFT JOIN empresas e ON e.id = h.empresa_id
        LEFT JOIN sitios s ON s.id = h.sitio_id
        ${consulta.where}
        ORDER BY ${orden.campo} ${orden.direccion}, h.id ${orden.direccion}
        LIMIT ? OFFSET ?
      `,
      [...consulta.parametros, tamanoNormalizado, offset]
    );

    return {
      tramos: filas.map((fila) => new TramoHistoricoMonitor(fila)),
      resumen,
      paginacion: {
        pagina: paginaEfectiva,
        tamanoPagina: tamanoNormalizado,
        totalVisible,
        totalFiltrado,
        totalPaginas
      }
    };
  }

  async crearTramo(tramo) {
    const [resultado] = await this.insertarTramos([tramo]);
    return this.buscarPorId(resultado.insertId);
  }

  async guardarTramos(tramos = []) {
    const [resultado] = await this.insertarTramos(tramos);
    return Number(resultado.affectedRows || 0);
  }

  async actualizarTramo(tramo) {
    if (!tramo) {
      return 0;
    }

    const serializado =
      typeof tramo.serializarPersistencia === 'function'
        ? tramo.serializarPersistencia()
        : tramo;
    const id = this.normalizarIdPositivo(serializado.id);
    const fila = this.normalizarTramoPersistible(serializado);

    if (id == null || !fila) {
      return 0;
    }

    const [resultado] = await this.clienteSql.ejecutar(
      `
        UPDATE historico_monitores
        SET
          monitor_id = ?,
          tenant_id = ?,
          empresa_id = ?,
          sitio_id = ?,
          version_catalogo = ?,
          tipo_monitor = ?,
          estado_tramo = ?,
          codigo_ultimo_resultado = ?,
          mensaje_ultimo_resultado = ?,
          valido_desde_utc = ?,
          valido_hasta_utc = ?,
          contador_repeticiones = ?,
          ultimo_evento_id = ?,
          payload_tramo = ?
        WHERE id = ?
        LIMIT 1
      `,
      [
        fila.monitorId,
        fila.tenantId,
        fila.empresaId,
        fila.sitioId,
        fila.versionCatalogo,
        fila.tipoMonitor,
        fila.estadoTramo,
        fila.codigoUltimoResultado,
        fila.mensajeUltimoResultado,
        fila.validoDesdeUtc,
        fila.validoHastaUtc,
        fila.contadorRepeticiones,
        fila.ultimoEventoId,
        fila.payloadTramo == null ? null : JSON.stringify(fila.payloadTramo),
        id
      ]
    );

    return Number(resultado.affectedRows || 0);
  }

  async eliminarPorIds(idsTramo = []) {
    if (!Array.isArray(idsTramo) || idsTramo.length === 0) {
      return 0;
    }

    const idsNormalizados = idsTramo
      .map((id) => this.normalizarIdPositivo(id))
      .filter(Boolean);

    if (idsNormalizados.length === 0) {
      return 0;
    }

    const placeholders = idsNormalizados.map(() => '?').join(', ');
    const [resultado] = await this.clienteSql.ejecutar(
      `
        DELETE FROM historico_monitores
        WHERE id IN (${placeholders})
      `,
      idsNormalizados
    );

    return Number(resultado.affectedRows || 0);
  }

  async eliminarAnterioresAValidoHastaUtc(fechaCorteUtc) {
    const fechaCorteNormalizada = normalizarFechaSqlUtc(fechaCorteUtc);

    if (!fechaCorteNormalizada) {
      return 0;
    }

    const [resultado] = await this.clienteSql.ejecutar(
      `
        DELETE FROM historico_monitores
        WHERE valido_hasta_utc < ?
      `,
      [fechaCorteNormalizada]
    );

    return Number(resultado.affectedRows || 0);
  }

  async insertarTramos(tramos = []) {
    if (!Array.isArray(tramos) || tramos.length === 0) {
      return [{ affectedRows: 0 }];
    }

    const filas = tramos
      .map((tramo) => this.normalizarTramoPersistible(tramo))
      .filter(Boolean);

    if (filas.length === 0) {
      return [{ affectedRows: 0 }];
    }

    const placeholders = filas
      .map(() => '(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .join(', ');
    const parametros = filas.flatMap((fila) => [
      fila.monitorId,
      fila.tenantId,
      fila.empresaId,
      fila.sitioId,
      fila.versionCatalogo,
      fila.tipoMonitor,
      fila.estadoTramo,
      fila.codigoUltimoResultado,
      fila.mensajeUltimoResultado,
      fila.validoDesdeUtc,
      fila.validoHastaUtc,
      fila.contadorRepeticiones,
      fila.ultimoEventoId,
      fila.payloadTramo == null ? null : JSON.stringify(fila.payloadTramo)
    ]);

    return this.clienteSql.ejecutar(
      `
        INSERT INTO historico_monitores (
          monitor_id,
          tenant_id,
          empresa_id,
          sitio_id,
          version_catalogo,
          tipo_monitor,
          estado_tramo,
          codigo_ultimo_resultado,
          mensaje_ultimo_resultado,
          valido_desde_utc,
          valido_hasta_utc,
          contador_repeticiones,
          ultimo_evento_id,
          payload_tramo
        ) VALUES ${placeholders}
      `,
      parametros
    );
  }

  normalizarTramoPersistible(tramo) {
    if (!tramo) {
      return null;
    }

    const serializado =
      typeof tramo.serializarPersistencia === 'function'
        ? tramo.serializarPersistencia()
        : tramo;

    const monitorId = this.normalizarIdPositivo(serializado.monitorId);
    const tenantId = this.normalizarIdPositivo(serializado.tenantId);
    const empresaId = this.normalizarIdPositivo(serializado.empresaId);
    const sitioId = this.normalizarIdPositivo(serializado.sitioId);
    const versionCatalogo = String(serializado.versionCatalogo || '').trim();
    const tipoMonitor = String(serializado.tipoMonitor || '')
      .trim()
      .toLowerCase()
      .slice(0, 40);
    const validoDesdeUtc = normalizarFechaSqlUtc(serializado.validoDesdeUtc);
    const validoHastaUtc = normalizarFechaSqlUtc(serializado.validoHastaUtc);
    const ultimoEventoId = this.normalizarIdPositivo(serializado.ultimoEventoId);

    if (
      monitorId == null ||
      tenantId == null ||
      empresaId == null ||
      !versionCatalogo ||
      !tipoMonitor ||
      !validoDesdeUtc ||
      !validoHastaUtc
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
      estadoTramo: String(serializado.estadoTramo || 'desconocido')
        .trim()
        .toLowerCase()
        .slice(0, 40),
      codigoUltimoResultado: String(
        serializado.codigoUltimoResultado || 'sin_resultado'
      )
        .trim()
        .slice(0, 80),
      mensajeUltimoResultado: String(
        serializado.mensajeUltimoResultado || 'Sin mensaje de resultado.'
      )
        .trim()
        .slice(0, 500),
      validoDesdeUtc,
      validoHastaUtc,
      contadorRepeticiones: Math.max(
        1,
        Number.parseInt(String(serializado.contadorRepeticiones || 1), 10) || 1
      ),
      ultimoEventoId,
      payloadTramo: clonarJsonSeguro(serializado.payloadTramo)
    };
  }

  normalizarIdPositivo(valor) {
    const convertido = Number.parseInt(String(valor ?? ''), 10);
    return Number.isInteger(convertido) && convertido > 0 ? convertido : null;
  }

  columnasSeleccionHistorico(alias) {
    return `
      ${alias}.id,
      ${alias}.monitor_id,
      ${alias}.tenant_id,
      ${alias}.empresa_id,
      ${alias}.sitio_id,
      ${alias}.version_catalogo,
      ${alias}.tipo_monitor,
      ${alias}.estado_tramo,
      ${alias}.codigo_ultimo_resultado,
      ${alias}.mensaje_ultimo_resultado,
      ${alias}.valido_desde_utc,
      ${alias}.valido_hasta_utc,
      ${alias}.contador_repeticiones,
      ${alias}.ultimo_evento_id,
      ${alias}.payload_tramo,
      ${alias}.fecha_creacion,
      ${alias}.fecha_actualizacion
    `;
  }

  construirConsultaListadoVisible(
    contextoUsuarioActual,
    {
      monitorId = null,
      tipo = null,
      estadoTramo = null,
      codigoResultado = null,
      desdeUtc = null,
      hastaUtc = null
    } = {}
  ) {
    const { condiciones, parametros } =
      this.construirCondicionesScope(contextoUsuarioActual);
    const monitorIdNormalizado = this.normalizarIdPositivo(monitorId);
    const tipoNormalizado = this.normalizarTipoMonitor(tipo);
    const estadoNormalizado = this.normalizarEstadoTramo(estadoTramo);
    const codigoNormalizado = this.normalizarTextoCorto(codigoResultado, 80);
    const desdeSql = normalizarFechaSqlUtc(desdeUtc);
    const hastaSql = normalizarFechaSqlUtc(hastaUtc);

    if (monitorIdNormalizado != null) {
      condiciones.push('h.monitor_id = ?');
      parametros.push(monitorIdNormalizado);
    }

    if (tipoNormalizado) {
      condiciones.push('h.tipo_monitor = ?');
      parametros.push(tipoNormalizado);
    }

    if (estadoNormalizado) {
      condiciones.push('h.estado_tramo = ?');
      parametros.push(estadoNormalizado);
    }

    if (codigoNormalizado) {
      condiciones.push('h.codigo_ultimo_resultado = ?');
      parametros.push(codigoNormalizado);
    }

    if (desdeSql) {
      condiciones.push('h.valido_hasta_utc >= ?');
      parametros.push(desdeSql);
    }

    if (hastaSql) {
      condiciones.push('h.valido_desde_utc <= ?');
      parametros.push(hastaSql);
    }

    return {
      where: condiciones.length > 0 ? `WHERE ${condiciones.join(' AND ')}` : '',
      parametros
    };
  }

  construirCondicionesScope(contextoUsuarioActual) {
    if (
      contextoUsuarioActual?.esOperadorSistema ||
      contextoUsuarioActual?.nivelScope === 'portal'
    ) {
      return { condiciones: [], parametros: [] };
    }

    if (contextoUsuarioActual?.nivelScope === 'tenant') {
      return {
        condiciones: ['h.tenant_id = ?'],
        parametros: [contextoUsuarioActual.tenantId]
      };
    }

    if (contextoUsuarioActual?.nivelScope === 'empresa') {
      return {
        condiciones: ['h.empresa_id = ?'],
        parametros: [contextoUsuarioActual.empresaId]
      };
    }

    if (contextoUsuarioActual?.nivelScope === 'sitio') {
      return {
        condiciones: ['h.sitio_id = ?'],
        parametros: [contextoUsuarioActual.sitioId]
      };
    }

    return {
      condiciones: ['1 = 0'],
      parametros: []
    };
  }

  async contarVisible(contextoUsuarioActual) {
    const consulta = this.construirConsultaListadoVisible(contextoUsuarioActual);
    const filas = await this.clienteSql.consultar(
      `
        SELECT COUNT(*) AS total
        FROM historico_monitores h
        ${consulta.where}
      `,
      consulta.parametros
    );

    return Number(filas[0]?.total || 0);
  }

  async resumirFiltrado(contextoUsuarioActual, filtros = {}) {
    const consulta = this.construirConsultaListadoVisible(
      contextoUsuarioActual,
      filtros
    );
    const filas = await this.clienteSql.consultar(
      `
        SELECT
          COUNT(*) AS total_tramos,
          COUNT(DISTINCT h.monitor_id) AS total_monitores_distintos,
          SUM(CASE WHEN h.estado_tramo = 'disponible' THEN 1 ELSE 0 END) AS total_disponibles,
          SUM(CASE WHEN h.estado_tramo = 'indisponible' THEN 1 ELSE 0 END) AS total_indisponibles,
          SUM(CASE WHEN h.estado_tramo = 'degradado' THEN 1 ELSE 0 END) AS total_degradados,
          SUM(CASE WHEN h.estado_tramo = 'desconocido' THEN 1 ELSE 0 END) AS total_desconocidos
        FROM historico_monitores h
        ${consulta.where}
      `,
      consulta.parametros
    );

    return {
      totalTramos: Number(filas[0]?.total_tramos || 0),
      totalMonitoresDistintos: Number(
        filas[0]?.total_monitores_distintos || 0
      ),
      totalDisponibles: Number(filas[0]?.total_disponibles || 0),
      totalIndisponibles: Number(filas[0]?.total_indisponibles || 0),
      totalDegradados: Number(filas[0]?.total_degradados || 0),
      totalDesconocidos: Number(filas[0]?.total_desconocidos || 0)
    };
  }

  resolverOrdenListado(ordenarPor, direccionOrden) {
    const columnas = {
      id: 'h.id',
      monitor: 'COALESCE(m.nombre, \'\')',
      tipo: 'h.tipo_monitor',
      estado: 'h.estado_tramo',
      codigo: 'h.codigo_ultimo_resultado',
      valido_desde: 'h.valido_desde_utc',
      valido_hasta: 'h.valido_hasta_utc',
      repeticiones: 'h.contador_repeticiones',
      creado: 'h.fecha_creacion',
      actualizado: 'h.fecha_actualizacion'
    };
    const campo = columnas[String(ordenarPor || '').trim()] || 'h.valido_hasta_utc';
    const direccion = String(direccionOrden || '').trim().toLowerCase() === 'asc'
      ? 'ASC'
      : 'DESC';

    return { campo, direccion };
  }

  normalizarPagina(valor) {
    const pagina = Number.parseInt(String(valor ?? ''), 10);
    return Number.isInteger(pagina) && pagina > 0 ? pagina : 1;
  }

  normalizarTamanoPagina(valor) {
    const tamano = Number.parseInt(String(valor ?? ''), 10);

    if (!Number.isInteger(tamano) || tamano <= 0) {
      return 25;
    }

    return Math.min(tamano, 100);
  }

  normalizarTipoMonitor(valor) {
    const normalizado = normalizarTipoMonitorCatalogo(valor);
    return normalizado ? normalizado.slice(0, 40) : null;
  }

  normalizarEstadoTramo(valor) {
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

    return Math.min(500, convertido);
  }
}

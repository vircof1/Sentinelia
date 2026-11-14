import { normalizarMarcaUtc } from '../../utilidades/src/fechas/normalizarMarcaUtc.js';
import {
  crearFuenteDirectaMonitorTelemetria,
  crearFuenteFederadaMonitorTelemetria,
  crearFuenteReglaMonitorTelemetria,
  MonitorTelemetriaAgente,
  TIPOS_FUENTE_MONITOR_TELEMETRIA
} from './MonitorTelemetriaAgente.js';

export const CODIGOS_ERROR_VINCULO_MONITOR_TELEMETRIA = Object.freeze({
  OBJETIVO_INCOMPATIBLE: 'objetivo_monitor_telemetria_incompatible',
  MONITOR_YA_VINCULADO: 'monitor_telemetria_ya_vinculado',
  ESTADO_INCONSISTENTE: 'vinculo_monitor_telemetria_inconsistente'
});

export class ErrorVinculoMonitorTelemetria extends Error {
  constructor(mensaje, codigo) {
    super(mensaje);
    this.name = 'ErrorVinculoMonitorTelemetria';
    this.code = codigo;
  }
}

export class VinculoMonitorTelemetriaPersistido {
  constructor(fila = {}) {
    const tipoFuente = normalizarTipoFuente(fila.tipo_fuente);
    const agenteId = fila.agente_id == null ? null : normalizarId(
      fila.agente_id,
      'El vínculo persistido no identifica un agente válido.'
    );
    const fuente = tipoFuente === TIPOS_FUENTE_MONITOR_TELEMETRIA.SENAL_DIRECTA
      ? crearFuenteDirectaMonitorTelemetria({
          agenteId,
          senalId: fila.senal_id
        })
      : tipoFuente === TIPOS_FUENTE_MONITOR_TELEMETRIA.REGLA_DERIVACION
        ? crearFuenteReglaMonitorTelemetria({ reglaId: fila.regla_id })
        : crearFuenteFederadaMonitorTelemetria({
            proyeccionId: fila.proyeccion_federada_id
          });

    this.monitor = new MonitorTelemetriaAgente({
      monitorId: fila.monitor_id,
      scope: {
        tenantId: fila.tenant_id,
        empresaId: fila.empresa_id,
        sitioId: fila.sitio_id
      },
      fuente
    });
    this.monitorId = this.monitor.monitorId;
    this.tipoFuente = tipoFuente;
    this.scope = this.monitor.scope;
    this.fuente = this.monitor.fuente;
    this.agenteId = agenteId;
    this.senalOrigen = this.fuente.esSenalFederada() ? null : congelarObjeto({
      id: normalizarId(
        fila.senal_origen_id,
        'El vínculo persistido no identifica su señal de origen.'
      ),
      agenteId,
      tipoDato: normalizarTextoObligatorio(
        fila.senal_origen_tipo_dato,
        'El vínculo persistido no identifica el tipo de su señal de origen.'
      ),
      unidad: normalizarTextoOpcional(fila.senal_origen_unidad)
    });
    this.estadoRegla = tipoFuente ===
      TIPOS_FUENTE_MONITOR_TELEMETRIA.REGLA_DERIVACION
      ? normalizarTextoObligatorio(
          fila.regla_estado,
          'El vínculo derivado no identifica el estado de su regla.'
        )
      : null;
    this.fechaCreacion = normalizarMarcaUtc(fila.fecha_creacion);
    this.fechaActualizacion = normalizarMarcaUtc(fila.fecha_actualizacion);

    Object.freeze(this);
  }

  esSenalDirecta() {
    return this.fuente.esSenalDirecta();
  }

  esReglaDerivacion() {
    return this.fuente.esReglaDerivacion();
  }

  esSenalFederada() {
    return this.fuente.esSenalFederada();
  }

  serializar() {
    return {
      monitorId: this.monitorId,
      tipoFuente: this.tipoFuente,
      scope: { ...this.scope },
      fuente: this.fuente.serializar(),
      agenteId: this.agenteId,
      senalOrigen: this.senalOrigen ? { ...this.senalOrigen } : null,
      estadoRegla: this.estadoRegla,
      fechaCreacion: this.fechaCreacion,
      fechaActualizacion: this.fechaActualizacion
    };
  }
}

export class RepositorioVinculosMonitoresTelemetria {
  constructor(clienteSql) {
    this.clienteSql = clienteSql;
  }

  async vincularSenalDirecta(
    { monitorId, agenteId, senalId } = {},
    { conexion = null } = {}
  ) {
    const ids = {
      monitorId: normalizarId(monitorId, 'El monitor de telemetría no es válido.'),
      agenteId: normalizarId(agenteId, 'El agente de telemetría no es válido.'),
      senalId: normalizarId(senalId, 'La señal de telemetría no es válida.')
    };

    await this.insertarVinculo(
      `
        INSERT INTO vinculos_monitores_telemetria (
          monitor_id,
          monitor_tipo,
          tenant_id,
          empresa_id,
          sitio_id,
          tipo_fuente,
          agente_id,
          senal_id,
          regla_id
        )
        SELECT
          m.id,
          m.tipo,
          m.tenant_id,
          m.empresa_id,
          m.sitio_id,
          'senal_directa',
          a.id,
          st.id,
          NULL
        FROM monitores m
        INNER JOIN agentes_sentinelia a
          ON a.tenant_id = m.tenant_id
          AND a.empresa_id = m.empresa_id
          AND a.sitio_id = m.sitio_id
        INNER JOIN senales_telemetria_agentes st
          ON st.agente_id = a.id
        WHERE m.id = ?
          AND m.tipo = 'telemetria'
          AND m.sitio_id IS NOT NULL
          AND a.id = ?
          AND st.id = ?
          AND st.tipo_dato IN ('numero', 'booleano', 'estado', 'texto')
      `,
      [ids.monitorId, ids.agenteId, ids.senalId],
      'El monitor, el agente y la señal deben existir, compartir scope y admitir evaluación directa.',
      { conexion }
    );

    return this.obtenerVinculoCreado(ids.monitorId, { conexion });
  }

  async vincularReglaDerivacion(
    { monitorId, reglaId } = {},
    { conexion = null } = {}
  ) {
    const ids = {
      monitorId: normalizarId(monitorId, 'El monitor de telemetría no es válido.'),
      reglaId: normalizarId(reglaId, 'La regla de derivación no es válida.')
    };

    await this.insertarVinculo(
      `
        INSERT INTO vinculos_monitores_telemetria (
          monitor_id,
          monitor_tipo,
          tenant_id,
          empresa_id,
          sitio_id,
          tipo_fuente,
          agente_id,
          senal_id,
          regla_id
        )
        SELECT
          m.id,
          m.tipo,
          m.tenant_id,
          m.empresa_id,
          m.sitio_id,
          'regla_derivacion',
          r.agente_id,
          NULL,
          r.id
        FROM monitores m
        INNER JOIN reglas_derivacion_telemetria r
          ON r.tenant_id = m.tenant_id
          AND r.empresa_id = m.empresa_id
          AND r.sitio_id = m.sitio_id
        WHERE m.id = ?
          AND m.tipo = 'telemetria'
          AND m.sitio_id IS NOT NULL
          AND r.id = ?
      `,
      [ids.monitorId, ids.reglaId],
      'El monitor y la regla deben existir y compartir exactamente el mismo scope.',
      { conexion }
    );

    return this.obtenerVinculoCreado(ids.monitorId, { conexion });
  }

  async vincularSenalFederada(
    { monitorId, proyeccionId } = {},
    { conexion = null } = {}
  ) {
    const idMonitor = normalizarId(
      monitorId,
      'El monitor de telemetría no es válido.'
    );
    const idProyeccion = crearFuenteFederadaMonitorTelemetria({
      proyeccionId
    }).proyeccionId;
    await this.insertarVinculo(
      `INSERT INTO vinculos_monitores_telemetria (
         monitor_id,monitor_tipo,tenant_id,empresa_id,sitio_id,tipo_fuente,
         agente_id,senal_id,regla_id,proyeccion_federada_id
       )
       SELECT m.id,m.tipo,m.tenant_id,m.empresa_id,m.sitio_id,
              'senal_federada',NULL,NULL,NULL,p.proyeccion_id
         FROM monitores m
         JOIN proyecciones_federacion p
           ON p.proyeccion_id=? AND p.familia='telemetria'
        WHERE m.id=? AND m.tipo='telemetria' AND m.sitio_id IS NOT NULL`,
      [idProyeccion, idMonitor],
      'El monitor local y la proyección deben existir y ser telemetría compatible.',
      { conexion }
    );
    return this.obtenerVinculoCreado(idMonitor, { conexion });
  }

  async buscarPorMonitorId(monitorId, { conexion = null } = {}) {
    const id = normalizarId(monitorId, 'El monitor de telemetría no es válido.');
    const vinculos = await this.consultarVinculos(
      'v.monitor_id = ?',
      [id],
      { conexion }
    );
    return vinculos[0] || null;
  }

  async eliminarPorMonitorId(monitorId, { conexion = null } = {}) {
    const id = normalizarId(monitorId, 'El monitor de telemetría no es válido.');
    const [resultado] = await ejecutar(
      conexion || this.clienteSql,
      `DELETE FROM vinculos_monitores_telemetria WHERE monitor_id = ?`,
      [id]
    );
    return Number(resultado?.affectedRows || 0) > 0;
  }

  async listarPorSenalDirecta({ agenteId, senalId } = {}) {
    const agente = normalizarId(agenteId, 'El agente de telemetría no es válido.');
    const senal = normalizarId(senalId, 'La señal de telemetría no es válida.');
    return this.consultarVinculos(
      `v.tipo_fuente = 'senal_directa'
        AND v.agente_id = ?
        AND v.senal_id = ?`,
      [agente, senal]
    );
  }

  async listarPorReglaDerivacion(reglaId) {
    const id = normalizarId(reglaId, 'La regla de derivación no es válida.');
    return this.consultarVinculos(
      `v.tipo_fuente = 'regla_derivacion'
        AND v.regla_id = ?`,
      [id]
    );
  }

  async listarPorProyeccionFederada(proyeccionId) {
    const id = crearFuenteFederadaMonitorTelemetria({ proyeccionId })
      .proyeccionId;
    return this.consultarVinculos(
      `v.tipo_fuente = 'senal_federada'
        AND v.proyeccion_federada_id = ?`,
      [id]
    );
  }

  async listarPorAgente(agenteId) {
    const id = normalizarId(agenteId, 'El agente de telemetría no es válido.');
    return this.consultarVinculos('v.agente_id = ?', [id]);
  }

  async insertarVinculo(
    sql,
    parametros,
    mensajeIncompatible,
    { conexion = null } = {}
  ) {
    try {
      const [resultado] = await ejecutar(
        conexion || this.clienteSql,
        sql,
        parametros
      );
      if (Number(resultado?.affectedRows || 0) !== 1) {
        throw new ErrorVinculoMonitorTelemetria(
          mensajeIncompatible,
          CODIGOS_ERROR_VINCULO_MONITOR_TELEMETRIA.OBJETIVO_INCOMPATIBLE
        );
      }
    } catch (error) {
      if (error instanceof ErrorVinculoMonitorTelemetria) {
        throw error;
      }
      if (error?.code === 'ER_DUP_ENTRY' || Number(error?.errno) === 1062) {
        throw new ErrorVinculoMonitorTelemetria(
          'El monitor de telemetría ya tiene una fuente vinculada.',
          CODIGOS_ERROR_VINCULO_MONITOR_TELEMETRIA.MONITOR_YA_VINCULADO
        );
      }
      throw error;
    }
  }

  async obtenerVinculoCreado(monitorId, { conexion = null } = {}) {
    const vinculo = await this.buscarPorMonitorId(monitorId, { conexion });
    if (!vinculo) {
      throw new ErrorVinculoMonitorTelemetria(
        'El vínculo se creó, pero no pudo recuperarse de forma consistente.',
        CODIGOS_ERROR_VINCULO_MONITOR_TELEMETRIA.ESTADO_INCONSISTENTE
      );
    }
    return vinculo;
  }

  async consultarVinculos(
    condicion,
    parametros,
    { conexion = null } = {}
  ) {
    const filas = await consultar(
      conexion || this.clienteSql,
      `
        SELECT
          v.monitor_id,
          v.tipo_fuente,
          v.tenant_id,
          v.empresa_id,
          v.sitio_id,
          v.agente_id,
          v.senal_id,
          v.regla_id,
          v.proyeccion_federada_id,
          COALESCE(sd.id, sr.id) AS senal_origen_id,
          COALESCE(sd.tipo_dato, sr.tipo_dato) AS senal_origen_tipo_dato,
          COALESCE(sd.unidad, sr.unidad) AS senal_origen_unidad,
          r.estado AS regla_estado,
          v.fecha_creacion,
          v.fecha_actualizacion
        FROM vinculos_monitores_telemetria v
        LEFT JOIN senales_telemetria_agentes sd
          ON v.tipo_fuente = 'senal_directa'
          AND sd.id = v.senal_id
          AND sd.agente_id = v.agente_id
        LEFT JOIN reglas_derivacion_telemetria r
          ON v.tipo_fuente = 'regla_derivacion'
          AND r.id = v.regla_id
          AND r.agente_id = v.agente_id
        LEFT JOIN senales_telemetria_agentes sr
          ON sr.id = r.senal_id
          AND sr.agente_id = r.agente_id
        WHERE ${condicion}
        ORDER BY v.monitor_id ASC
      `,
      parametros
    );
    return filas.map((fila) => new VinculoMonitorTelemetriaPersistido(fila));
  }
}

function normalizarTipoFuente(valor) {
  const tipo = String(valor ?? '').trim().toLowerCase();
  if (!Object.values(TIPOS_FUENTE_MONITOR_TELEMETRIA).includes(tipo)) {
    throw new Error('El vínculo persistido tiene un tipo de fuente inválido.');
  }
  return tipo;
}

function normalizarId(valor, mensaje) {
  if (typeof valor === 'boolean' || String(valor ?? '').trim() === '') {
    throw new Error(mensaje);
  }
  const id = Number(valor);
  if (!Number.isInteger(id) || id <= 0) {
    throw new Error(mensaje);
  }
  return id;
}

function normalizarTextoObligatorio(valor, mensaje) {
  const texto = String(valor ?? '').trim();
  if (!texto) {
    throw new Error(mensaje);
  }
  return texto;
}

function normalizarTextoOpcional(valor) {
  const texto = String(valor ?? '').trim();
  return texto || null;
}

function congelarObjeto(valor) {
  return Object.freeze(valor);
}

async function ejecutar(ejecutor, sql, parametros = []) {
  return typeof ejecutor.ejecutar === 'function'
    ? ejecutor.ejecutar(sql, parametros)
    : ejecutor.execute(sql, parametros);
}

async function consultar(ejecutor, sql, parametros = []) {
  if (typeof ejecutor.consultar === 'function') {
    return ejecutor.consultar(sql, parametros);
  }

  const [filas] = await ejecutor.execute(sql, parametros);
  return filas;
}

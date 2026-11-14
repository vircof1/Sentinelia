import { normalizarMarcaUtc } from '../../utilidades/src/fechas/normalizarMarcaUtc.js';
import {
  ESTADOS_REGLA_DERIVACION_TELEMETRIA,
  ReglaDerivacionTelemetria,
  RevisionReglaDerivacionTelemetria,
  TIPOS_CONDICION_DERIVACION_TELEMETRIA,
  crearCondicionDerivacionTelemetria
} from './EventosDerivadosTelemetriaAgentes.js';
import {
  TIPO_CONDICION_MOMENTO_UTC_RELATIVO
} from './EvaluadorMomentoUtcRelativoTelemetria.js';

export class ReglaDerivacionTelemetriaPersistida {
  constructor(fila = {}) {
    this.regla = crearReglaDesdeFila(fila);
    this.revisionVigente = fila.revision_id
      ? crearRevisionDesdeFila(fila)
      : null;
    this.fechaCreacion = normalizarMarcaUtc(fila.regla_fecha_creacion);
    this.fechaActualizacion = normalizarMarcaUtc(fila.regla_fecha_actualizacion);
  }

  serializar() {
    return {
      ...this.regla.serializar(),
      revisionVigente: this.revisionVigente?.serializar() || null,
      fechaCreacion: this.fechaCreacion,
      fechaActualizacion: this.fechaActualizacion
    };
  }
}

export class ReglaRevisionAplicableTelemetriaPersistida {
  constructor(fila = {}) {
    this.regla = crearReglaDesdeFila(fila);
    this.revisionAplicable = crearRevisionDesdeFila(fila);
    Object.freeze(this);
  }

  serializar() {
    return {
      regla: this.regla.serializar(),
      revisionAplicable: this.revisionAplicable.serializar()
    };
  }
}

export class RepositorioReglasDerivacionTelemetria {
  constructor(clienteSql) {
    this.clienteSql = clienteSql;
  }

  async crearConRevisionInicial({
    agenteId,
    senalId,
    tenantId,
    empresaId,
    sitioId,
    estado = ESTADOS_REGLA_DERIVACION_TELEMETRIA.ACTIVA,
    revision
  } = {}) {
    return this.#enTransaccion((conexion) =>
      this.crearConRevisionInicialEnTransaccion({
        agenteId,
        senalId,
        tenantId,
        empresaId,
        sitioId,
        estado,
        revision
      }, { conexion })
    );
  }

  async crearConRevisionInicialEnTransaccion({
    agenteId,
    senalId,
    tenantId,
    empresaId,
    sitioId,
    estado = ESTADOS_REGLA_DERIVACION_TELEMETRIA.ACTIVA,
    revision
  } = {}, { conexion } = {}) {
    exigirConexion(conexion);
    const ids = normalizarIdentidadObjetivo({
      agenteId,
      senalId,
      tenantId,
      empresaId,
      sitioId
    });
    const objetivo = await obtenerObjetivoCatalogado(conexion, ids);
    const reglaValidada = new ReglaDerivacionTelemetria({
      id: 1,
      agente: objetivo.agente,
      senal: objetivo.senal,
      scope: ids,
      estado
    });
    const ahoraUtc = await obtenerAhoraSql(conexion);
    const revisionValidada = construirRevisionValidada({
      datos: revision,
      id: 1,
      reglaId: 1,
      numero: 1,
      vigenteDesdeUtc: ahoraUtc
    });
    comprobarCondicionConSenal(revisionValidada.condicion, objetivo.senal);

    const [resultadoRegla] = await conexion.execute(
      construirSqlInsercionRegla(),
      [
        reglaValidada.agenteId,
        reglaValidada.senalId,
        reglaValidada.tenantId,
        reglaValidada.empresaId,
        reglaValidada.sitioId,
        reglaValidada.estado
      ]
    );
    const reglaId = normalizarId(
      resultadoRegla.insertId,
      'No se pudo obtener la identidad de la regla creada.'
    );
    const revisionPersistible = construirRevisionValidada({
      datos: revision,
      id: 1,
      reglaId,
      numero: 1,
      vigenteDesdeUtc: ahoraUtc
    });
    const revisionId = await insertarRevision(conexion, revisionPersistible);
    await actualizarPunteroRevision(conexion, reglaId, revisionId);
    return this.buscarPorId(reglaId, { conexion });
  }

  async crearNuevaRevision({ reglaId, revision } = {}) {
    return this.#enTransaccion((conexion) =>
      this.crearNuevaRevisionEnTransaccion({ reglaId, revision }, { conexion })
    );
  }

  async crearNuevaRevisionEnTransaccion({ reglaId, revision } = {}, { conexion } = {}) {
    exigirConexion(conexion);
    const id = normalizarId(reglaId, 'La regla de derivación no es válida.');
    const filaRegla = await obtenerReglaParaActualizar(conexion, id);
    const revisionAnterior = await obtenerRevisionAbiertaParaActualizar(
      conexion,
      filaRegla
    );
    const ahoraSql = await obtenerAhoraSql(conexion);
    const vigenteDesdeUtc = asegurarInstantePosterior(
      ahoraSql,
      revisionAnterior.vigenteDesdeUtc
    );
    const revisionValidada = construirRevisionValidada({
      datos: revision,
      id: 1,
      reglaId: id,
      numero: revisionAnterior.numero + 1,
      vigenteDesdeUtc
    });
    comprobarCondicionConSenal(revisionValidada.condicion, filaRegla.senal);

    const [cierre] = await conexion.execute(
      `
        UPDATE revisiones_reglas_derivacion_telemetria
        SET vigente_hasta_utc = ?
        WHERE id = ?
          AND regla_id = ?
          AND vigente_hasta_utc IS NULL
      `,
      [new Date(vigenteDesdeUtc), revisionAnterior.id, id]
    );
    asegurarUnaFilaAfectada(
      cierre,
      'La revisión vigente cambió durante la edición de la regla.'
    );

    const revisionId = await insertarRevision(conexion, revisionValidada);
    await actualizarPunteroRevision(conexion, id, revisionId, {
      incrementarGeneracion: true
    });
    return this.buscarRevisionPorId(revisionId, { conexion });
  }

  async cambiarEstado(reglaId, estado) {
    return this.#enTransaccion((conexion) =>
      this.cambiarEstadoEnTransaccion(reglaId, estado, { conexion })
    );
  }

  async cambiarEstadoEnTransaccion(reglaId, estado, { conexion = null } = {}) {
    exigirConexion(conexion);
    const id = normalizarId(reglaId, 'La regla de derivación no es válida.');
    const reglaValidada = new ReglaDerivacionTelemetria({
      id,
      agente: { id: 1, tenantId: 1, empresaId: 1, sitioId: 1 },
      senal: { id: 1, agenteId: 1 },
      scope: { tenantId: 1, empresaId: 1, sitioId: 1 },
      estado
    });
    const filas = await consultar(
      conexion,
      `SELECT estado FROM reglas_derivacion_telemetria
        WHERE id = ? LIMIT 1 FOR UPDATE`,
      [id]
    );
    if (filas.length === 0) {
      throw new Error('La regla de derivación no existe.');
    }
    if (filas[0].estado === reglaValidada.estado) {
      return this.buscarPorId(id, { conexion });
    }
    const [resultado] = await conexion.execute(
      `
        UPDATE reglas_derivacion_telemetria
        SET estado = ?,
            generacion_autoridad = generacion_autoridad + 1
        WHERE id = ?
      `,
      [reglaValidada.estado, id]
    );
    asegurarUnaFilaAfectada(resultado, 'La regla de derivación no existe.');
    return this.buscarPorId(id, { conexion });
  }

  async buscarPorId(reglaId, { conexion = null } = {}) {
    const id = normalizarId(reglaId, 'La regla de derivación no es válida.');
    const filas = await consultar(
      conexion || this.clienteSql,
      `
        SELECT
          ${columnasRegla('r')},
          ${columnasRevision('rv')}
        FROM reglas_derivacion_telemetria r
        LEFT JOIN revisiones_reglas_derivacion_telemetria rv
          ON rv.id = r.revision_vigente_id
          AND rv.regla_id = r.id
        WHERE r.id = ?
        LIMIT 1
      `,
      [id]
    );
    return filas.length > 0
      ? new ReglaDerivacionTelemetriaPersistida(filas[0])
      : null;
  }

  async listarPorAgente(agenteId) {
    const id = normalizarId(
      agenteId,
      'El agente de las reglas de derivación no es válido.'
    );
    const filas = await this.clienteSql.consultar(
      `
        SELECT
          ${columnasRegla('r')},
          ${columnasRevision('rv')}
        FROM reglas_derivacion_telemetria r
        LEFT JOIN revisiones_reglas_derivacion_telemetria rv
          ON rv.id = r.revision_vigente_id
          AND rv.regla_id = r.id
        WHERE r.agente_id = ?
        ORDER BY r.fecha_creacion DESC, r.id DESC
      `,
      [id]
    );
    return filas.map(
      (fila) => new ReglaDerivacionTelemetriaPersistida(fila)
    );
  }

  async contarPorSenalesDeAgente(agenteId, senalIds = []) {
    const idAgente = normalizarId(
      agenteId,
      'El agente de las reglas de derivación no es válido.'
    );
    const ids = [...new Set(senalIds.map((senalId) => normalizarId(
      senalId,
      'La señal de telemetría no es válida.'
    )))];
    const conteos = new Map(ids.map((senalId) => [senalId, 0]));

    if (ids.length === 0) {
      return conteos;
    }

    const filas = await this.clienteSql.consultar(
      `
        SELECT r.senal_id, COUNT(*) AS total
        FROM reglas_derivacion_telemetria r
        WHERE r.agente_id = ?
          AND r.senal_id IN (${ids.map(() => '?').join(', ')})
        GROUP BY r.senal_id
      `,
      [idAgente, ...ids]
    );

    for (const fila of filas) {
      conteos.set(Number(fila.senal_id), Number(fila.total));
    }

    return conteos;
  }

  async buscarRevisionPorId(revisionId, { conexion = null } = {}) {
    const id = normalizarId(
      revisionId,
      'La revisión de la regla de derivación no es válida.'
    );
    const filas = await consultar(
      conexion || this.clienteSql,
      `
        SELECT ${columnasRevision('rv')}
        FROM revisiones_reglas_derivacion_telemetria rv
        WHERE rv.id = ?
        LIMIT 1
      `,
      [id]
    );
    return filas.length > 0 ? crearRevisionDesdeFila(filas[0]) : null;
  }

  async listarRevisionesPorRegla(reglaId) {
    const id = normalizarId(reglaId, 'La regla de derivación no es válida.');
    const filas = await this.clienteSql.consultar(
      `
        SELECT ${columnasRevision('rv')}
        FROM revisiones_reglas_derivacion_telemetria rv
        WHERE rv.regla_id = ?
        ORDER BY rv.numero DESC, rv.id DESC
      `,
      [id]
    );
    return filas.map(crearRevisionDesdeFila);
  }

  async buscarRevisionAplicable({ reglaId, recibidoEnUtc } = {}, opciones = {}) {
    const id = normalizarId(reglaId, 'La regla de derivación no es válida.');
    const fecha = normalizarFechaSql(
      recibidoEnUtc,
      'La fecha recibida para resolver la revisión no es válida.'
    );
    const filas = await consultar(
      opciones.conexion || this.clienteSql,
      `
        SELECT ${columnasRevision('rv')}
        FROM revisiones_reglas_derivacion_telemetria rv
        WHERE rv.regla_id = ?
          AND rv.vigente_desde_utc <= ?
          AND (
            rv.vigente_hasta_utc IS NULL
            OR ? < rv.vigente_hasta_utc
          )
        ORDER BY rv.numero DESC
        LIMIT 1
      `,
      [id, fecha, fecha]
    );
    return filas.length > 0 ? crearRevisionDesdeFila(filas[0]) : null;
  }

  async listarActivasPorSenalEn({ senalId, recibidoEnUtc } = {}, opciones = {}) {
    const id = normalizarId(senalId, 'La señal de telemetría no es válida.');
    const fecha = normalizarFechaSql(
      recibidoEnUtc,
      'La fecha recibida para resolver reglas activas no es válida.'
    );
    const filas = await consultar(
      opciones.conexion || this.clienteSql,
      `
        SELECT
          ${columnasRegla('r')},
          ${columnasRevision('rv')}
        FROM reglas_derivacion_telemetria r
        INNER JOIN revisiones_reglas_derivacion_telemetria rv
          ON rv.regla_id = r.id
        WHERE r.senal_id = ?
          AND r.estado = 'activa'
          AND rv.condicion_tipo <> 'momento_utc_relativo'
          AND rv.vigente_desde_utc <= ?
          AND (
            rv.vigente_hasta_utc IS NULL
            OR ? < rv.vigente_hasta_utc
          )
        ORDER BY r.id ASC
      `,
      [id, fecha, fecha]
    );
    return filas.map(
      (fila) => new ReglaRevisionAplicableTelemetriaPersistida(fila)
    );
  }

  async bloquearRelativasActivasVigentesPorSenalesEnTransaccion({
    agenteId,
    senalIds = []
  } = {}, { conexion } = {}) {
    exigirConexion(conexion);
    const agente = normalizarId(
      agenteId,
      'El agente de las reglas relativas es obligatorio.'
    );
    const ids = [...new Set(senalIds.map((senalId) =>
      normalizarId(senalId, 'La señal de una regla relativa no es válida.')
    ))].sort((a, b) => a - b);
    if (ids.length === 0) return [];

    const reglas = await consultar(
      conexion,
      `
        SELECT ${columnasRegla('r')}
        FROM reglas_derivacion_telemetria r
        WHERE r.agente_id = ?
          AND r.senal_id IN (${ids.map(() => '?').join(', ')})
          AND r.estado = 'activa'
        ORDER BY r.id ASC
        FOR UPDATE
      `,
      [agente, ...ids]
    );
    if (reglas.length === 0) return [];
    const revisionesIds = reglas.map((fila) => Number(fila.regla_revision_vigente_id));
    const revisiones = await consultar(
      conexion,
      `SELECT ${columnasRevision('rv')}
         FROM revisiones_reglas_derivacion_telemetria rv
        WHERE rv.id IN (${revisionesIds.map(() => '?').join(', ')})
        ORDER BY rv.regla_id ASC
        FOR UPDATE`,
      revisionesIds
    );
    const revisionesPorId = new Map(revisiones.map((fila) => [
      Number(fila.revision_id),
      fila
    ]));
    const filas = reglas.map((regla) => ({
      ...regla,
      ...revisionesPorId.get(Number(regla.regla_revision_vigente_id))
    })).filter((fila) =>
      fila.condicion_tipo === 'momento_utc_relativo' &&
      Number(fila.condicion_version) === 1
    );

    return filas.map(crearAutoridadRelativaPreparadaDesdeFila);
  }

  async #enTransaccion(trabajo) {
    const conexion = await this.clienteSql.obtenerConexion();
    try {
      await conexion.beginTransaction();
      const resultado = await trabajo(conexion);
      await conexion.commit();
      return resultado;
    } catch (error) {
      await rollbackSeguro(conexion);
      throw error;
    } finally {
      conexion.release();
    }
  }
}

function crearAutoridadRelativaPreparadaDesdeFila(fila) {
  return Object.freeze({
    regla: Object.freeze({
      id: Number(fila.regla_id),
      agenteId: Number(fila.regla_agente_id),
      senalId: Number(fila.regla_senal_id),
      tenantId: Number(fila.regla_tenant_id),
      empresaId: Number(fila.regla_empresa_id),
      sitioId: Number(fila.regla_sitio_id),
      estado: fila.regla_estado,
      revisionVigenteId: Number(fila.regla_revision_vigente_id),
      generacionAutoridad: Number(fila.regla_generacion_autoridad)
    }),
    revision: Object.freeze({
      id: Number(fila.revision_id),
      reglaId: Number(fila.revision_regla_id),
      numero: Number(fila.revision_numero),
      tipo: fila.condicion_tipo,
      version: Number(fila.condicion_version),
      vigenteDesdeUtc: normalizarMarcaUtc(fila.vigente_desde_utc),
      vigenteHastaUtc: normalizarMarcaUtc(fila.vigente_hasta_utc)
    })
  });
}

function construirSqlInsercionRegla() {
  return `
    INSERT INTO reglas_derivacion_telemetria (
      agente_id,
      senal_id,
      tenant_id,
      empresa_id,
      sitio_id,
      estado
    ) VALUES (?, ?, ?, ?, ?, ?)
  `;
}

async function insertarRevision(conexion, revision) {
  const [resultado] = await conexion.execute(
    `
      INSERT INTO revisiones_reglas_derivacion_telemetria (
        regla_id,
        numero,
        condicion_tipo,
        condicion_version,
        condicion_canonica,
        severidad_calculada,
        mensaje_operativo,
        nombre,
        descripcion,
        metadatos_descriptivos,
        vigente_desde_utc,
        vigente_hasta_utc
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `,
    [
      revision.reglaId,
      revision.numero,
      revision.condicion.tipo,
      revision.condicion.version,
      revision.condicion.obtenerCanonica(),
      revision.severidadCalculada,
      revision.mensajeOperativo,
      revision.nombre,
      revision.descripcion,
      revision.metadatos == null ? null : JSON.stringify(revision.metadatos),
      new Date(revision.vigenteDesdeUtc),
      revision.vigenteHastaUtc ? new Date(revision.vigenteHastaUtc) : null
    ]
  );
  return normalizarId(
    resultado.insertId,
    'No se pudo obtener la identidad de la revisión creada.'
  );
}

async function actualizarPunteroRevision(
  conexion,
  reglaId,
  revisionId,
  { incrementarGeneracion = false } = {}
) {
  const [resultado] = await conexion.execute(
    `
      UPDATE reglas_derivacion_telemetria
      SET revision_vigente_id = ?
          ${incrementarGeneracion
            ? ', generacion_autoridad = generacion_autoridad + 1'
            : ''}
      WHERE id = ?
    `,
    [revisionId, reglaId]
  );
  asegurarUnaFilaAfectada(
    resultado,
    'No se pudo actualizar la revisión vigente de la regla.'
  );
}

async function obtenerObjetivoCatalogado(conexion, ids) {
  const [filas] = await conexion.execute(
    `
      SELECT
        a.id AS agente_id,
        a.tenant_id,
        a.empresa_id,
        a.sitio_id,
        s.id AS senal_id,
        s.agente_id AS senal_agente_id,
        s.tipo_dato,
        s.unidad
      FROM agentes_sentinelia a
      INNER JOIN senales_telemetria_agentes s
        ON s.agente_id = a.id
      WHERE a.id = ?
        AND s.id = ?
      LIMIT 1
      FOR UPDATE
    `,
    [ids.agenteId, ids.senalId]
  );
  if (filas.length === 0) {
    throw new Error('La señal catalogada no pertenece al agente indicado.');
  }
  return convertirObjetivoDesdeFila(filas[0]);
}

async function obtenerReglaParaActualizar(conexion, reglaId) {
  const [filas] = await conexion.execute(
    `
      SELECT
        ${columnasRegla('r')},
        s.tipo_dato,
        s.unidad
      FROM reglas_derivacion_telemetria r
      INNER JOIN senales_telemetria_agentes s
        ON s.id = r.senal_id
        AND s.agente_id = r.agente_id
      WHERE r.id = ?
      LIMIT 1
      FOR UPDATE
    `,
    [reglaId]
  );
  if (filas.length === 0) {
    throw new Error('La regla de derivación indicada no existe.');
  }
  const fila = filas[0];
  return {
    fila,
    senal: {
      id: fila.regla_senal_id,
      agenteId: fila.regla_agente_id,
      tipoDato: fila.tipo_dato,
      unidad: normalizarUnidad(fila.unidad)
    }
  };
}

async function obtenerRevisionAbiertaParaActualizar(conexion, regla) {
  if (!regla.fila.regla_revision_vigente_id) {
    throw new Error('La regla de derivación no tiene una revisión vigente.');
  }
  const [filas] = await conexion.execute(
    `
      SELECT ${columnasRevision('rv')}
      FROM revisiones_reglas_derivacion_telemetria rv
      WHERE rv.id = ?
        AND rv.regla_id = ?
        AND rv.vigente_hasta_utc IS NULL
      LIMIT 1
      FOR UPDATE
    `,
    [regla.fila.regla_revision_vigente_id, regla.fila.regla_id]
  );
  if (filas.length === 0) {
    throw new Error('La revisión vigente de la regla es inconsistente.');
  }
  return crearRevisionDesdeFila(filas[0]);
}

async function obtenerAhoraSql(conexion) {
  const [filas] = await conexion.execute(
    'SELECT UTC_TIMESTAMP(6) AS ahora_utc'
  );
  const ahora = normalizarMarcaUtc(filas[0]?.ahora_utc);
  if (!ahora) {
    throw new Error('No se pudo resolver el reloj SQL para versionar la regla.');
  }
  return ahora;
}

function construirRevisionValidada({
  datos,
  id,
  reglaId,
  numero,
  vigenteDesdeUtc
}) {
  if (!datos || typeof datos !== 'object') {
    throw new Error('La configuración de la revisión es obligatoria.');
  }
  return new RevisionReglaDerivacionTelemetria({
    id,
    reglaId,
    numero,
    condicion: datos.condicion,
    severidadCalculada: datos.severidadCalculada,
    mensajeOperativo: datos.mensajeOperativo,
    nombre: datos.nombre,
    descripcion: datos.descripcion,
    metadatos: datos.metadatos,
    vigenteDesdeUtc
  });
}

function crearReglaDesdeFila(fila) {
  return new ReglaDerivacionTelemetria({
    id: fila.regla_id,
    agente: {
      id: fila.regla_agente_id,
      tenantId: fila.regla_tenant_id,
      empresaId: fila.regla_empresa_id,
      sitioId: fila.regla_sitio_id
    },
    senal: {
      id: fila.regla_senal_id,
      agenteId: fila.regla_agente_id
    },
    scope: {
      tenantId: fila.regla_tenant_id,
      empresaId: fila.regla_empresa_id,
      sitioId: fila.regla_sitio_id
    },
    estado: fila.regla_estado,
    revisionVigenteId: fila.regla_revision_vigente_id,
    generacionAutoridad: fila.regla_generacion_autoridad ?? 1
  });
}

function crearRevisionDesdeFila(fila) {
  const condicionSerializada = parsearJson(fila.condicion_canonica);
  const condicion = crearCondicionDerivacionTelemetria(condicionSerializada);
  if (
    condicion.tipo !== fila.condicion_tipo ||
    condicion.version !== Number(fila.condicion_version)
  ) {
    throw new Error('La condición persistida no coincide con sus columnas de control.');
  }
  return new RevisionReglaDerivacionTelemetria({
    id: fila.revision_id,
    reglaId: fila.revision_regla_id,
    numero: fila.revision_numero,
    condicion,
    severidadCalculada: fila.severidad_calculada,
    mensajeOperativo: fila.mensaje_operativo,
    nombre: fila.revision_nombre,
    descripcion: fila.revision_descripcion,
    metadatos: parsearJsonOpcional(fila.metadatos_descriptivos),
    vigenteDesdeUtc: normalizarMarcaUtc(fila.vigente_desde_utc),
    vigenteHastaUtc: normalizarMarcaUtc(fila.vigente_hasta_utc)
  });
}

function convertirObjetivoDesdeFila(fila) {
  return {
    agente: {
      id: fila.agente_id,
      tenantId: fila.tenant_id,
      empresaId: fila.empresa_id,
      sitioId: fila.sitio_id
    },
    senal: {
      id: fila.senal_id,
      agenteId: fila.senal_agente_id,
      tipoDato: fila.tipo_dato,
      unidad: normalizarUnidad(fila.unidad)
    }
  };
}

function comprobarCondicionConSenal(condicion, senal) {
  if (condicion.tipo === TIPOS_CONDICION_DERIVACION_TELEMETRIA.CALIDAD) {
    return;
  }
  const tipoDatoEsperado = condicion.tipo ===
    TIPOS_CONDICION_DERIVACION_TELEMETRIA.TEXTO_REGEX
    ? 'texto'
    : condicion.tipo === TIPO_CONDICION_MOMENTO_UTC_RELATIVO
      ? 'momento_utc'
    : condicion.tipo;
  if (tipoDatoEsperado !== senal.tipoDato) {
    throw new Error('La condición no coincide con el tipo catalogado de la señal.');
  }
  if (condicion.tipo === TIPOS_CONDICION_DERIVACION_TELEMETRIA.TEXTO_REGEX) {
    return;
  }
  if ([
    TIPOS_CONDICION_DERIVACION_TELEMETRIA.DURACION,
    TIPOS_CONDICION_DERIVACION_TELEMETRIA.MOMENTO_UTC,
    TIPO_CONDICION_MOMENTO_UTC_RELATIVO
  ].includes(condicion.tipo)) {
    if (normalizarUnidad(senal.unidad) !== null) {
      throw new Error('El tipo temporal catalogado debe conservar su unidad implícita.');
    }
    return;
  }
  if (condicion.configuracion.unidad !== normalizarUnidad(senal.unidad)) {
    throw new Error('La condición no coincide exactamente con la unidad catalogada.');
  }
}

function columnasRegla(alias) {
  return `
    ${alias}.id AS regla_id,
    ${alias}.agente_id AS regla_agente_id,
    ${alias}.senal_id AS regla_senal_id,
    ${alias}.tenant_id AS regla_tenant_id,
    ${alias}.empresa_id AS regla_empresa_id,
    ${alias}.sitio_id AS regla_sitio_id,
    ${alias}.estado AS regla_estado,
    ${alias}.revision_vigente_id AS regla_revision_vigente_id,
    ${alias}.generacion_autoridad AS regla_generacion_autoridad,
    ${alias}.fecha_creacion AS regla_fecha_creacion,
    ${alias}.fecha_actualizacion AS regla_fecha_actualizacion
  `;
}

function columnasRevision(alias) {
  return `
    ${alias}.id AS revision_id,
    ${alias}.regla_id AS revision_regla_id,
    ${alias}.numero AS revision_numero,
    ${alias}.condicion_tipo,
    ${alias}.condicion_version,
    ${alias}.condicion_canonica,
    ${alias}.severidad_calculada,
    ${alias}.mensaje_operativo,
    ${alias}.nombre AS revision_nombre,
    ${alias}.descripcion AS revision_descripcion,
    ${alias}.metadatos_descriptivos,
    ${alias}.vigente_desde_utc,
    ${alias}.vigente_hasta_utc
  `;
}

async function consultar(ejecutor, sql, parametros) {
  if (typeof ejecutor.consultar === 'function') {
    return ejecutor.consultar(sql, parametros);
  }
  const [filas] = await ejecutor.execute(sql, parametros);
  return filas;
}

function exigirConexion(conexion) {
  if (!conexion?.execute) {
    throw new Error('La operación transaccional de reglas exige conexión SQL.');
  }
}

async function rollbackSeguro(conexion) {
  try {
    await conexion.rollback();
  } catch {
    // La excepción original conserva prioridad.
  }
}

function normalizarIdentidadObjetivo({
  agenteId,
  senalId,
  tenantId,
  empresaId,
  sitioId
}) {
  return {
    agenteId: normalizarId(agenteId, 'El agente de la regla es obligatorio.'),
    senalId: normalizarId(senalId, 'La señal de la regla es obligatoria.'),
    tenantId: normalizarId(tenantId, 'El tenant de la regla es obligatorio.'),
    empresaId: normalizarId(empresaId, 'La empresa de la regla es obligatoria.'),
    sitioId: normalizarId(sitioId, 'El sitio de la regla es obligatorio.')
  };
}

function normalizarId(valor, mensaje) {
  const id = Number(valor);
  if (!Number.isInteger(id) || id <= 0) {
    throw new Error(mensaje);
  }
  return id;
}

function normalizarFechaSql(valor, mensaje) {
  const normalizada = normalizarMarcaUtc(valor);
  if (!normalizada || Number.isNaN(Date.parse(normalizada))) {
    throw new Error(mensaje);
  }
  return new Date(normalizada);
}

function normalizarUnidad(valor) {
  const unidad = String(valor ?? '').trim();
  return unidad || null;
}

function parsearJson(valor) {
  if (valor && typeof valor === 'object') {
    return JSON.parse(JSON.stringify(valor));
  }
  try {
    return JSON.parse(String(valor));
  } catch {
    throw new Error('El JSON persistido de la condición no es válido.');
  }
}

function parsearJsonOpcional(valor) {
  return valor == null ? null : parsearJson(valor);
}

function asegurarUnaFilaAfectada(resultado, mensaje) {
  if (Number(resultado?.affectedRows) !== 1) {
    throw new Error(mensaje);
  }
}

function asegurarInstantePosterior(candidato, anterior) {
  const candidatoMs = Date.parse(candidato);
  const anteriorMs = Date.parse(anterior);
  return new Date(Math.max(candidatoMs, anteriorMs + 1)).toISOString();
}

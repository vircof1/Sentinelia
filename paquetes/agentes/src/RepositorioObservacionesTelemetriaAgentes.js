import { normalizarMarcaUtc } from '../../utilidades/src/fechas/normalizarMarcaUtc.js';
import {
  bytesAUuidV7Auditoria,
  uuidV7AuditoriaABytes
} from '../../auditoria/src/UuidV7Auditoria.js';
import {
  crearLecturaTelemetriaAgenteConTiposInternos
} from './TelemetriaAgente.js';
import {
  duracionTelemetriaASql,
  duracionTelemetriaDesdeSql,
  momentoUtcTelemetriaASql,
  momentoUtcTelemetriaDesdeSql
} from './CodecSqlTelemetriaTemporalAgente.js';

export class ObservacionTelemetriaAgenteHistorica {
  constructor(fila = {}) {
    this.id = fila.id;
    this.agenteId = fila.agente_id;
    this.senalId = fila.senal_id || null;
    this.periodoVidaPolId = fila.periodo_vida_pol_id || null;
    this.sesionIdDiagnostico = fila.sesion_id_diagnostico || null;
    this.sesionHuellaSha256 = fila.sesion_huella_sha256 || null;
    this.sesionAuditoriaId = fila.sesion_auditoria_id
      ? bytesAUuidV7Auditoria(fila.sesion_auditoria_id, 'sesionAuditoriaId')
      : null;
    this.categoria = fila.categoria;
    this.clave = fila.clave;
    this.tag = fila.tag || null;
    this.codigoSenal = fila.codigo_senal;
    this.tipoDato = fila.tipo_dato;
    this.unidad = fila.unidad || null;
    this.valorNumero = fila.valor_numero == null ? null : Number(fila.valor_numero);
    this.valorBooleano = fila.valor_booleano == null
      ? null
      : Boolean(Number(fila.valor_booleano));
    this.valorTexto = fila.valor_texto ?? null;
    this.valorEstado = fila.valor_estado ?? null;
    this.valorJson = parsearJsonOpcional(fila.valor_json);
    if (this.tipoDato === 'duracion') {
      this.valorDuracion = duracionTelemetriaDesdeSql(fila.valor_duracion);
      this.valorMomentoUtc = null;
    } else if (this.tipoDato === 'momento_utc') {
      this.valorDuracion = null;
      this.valorMomentoUtc = momentoUtcTelemetriaDesdeSql(fila.valor_momento_utc);
    }
    this.calidad = fila.calidad;
    this.severidadDeclarada = fila.severidad_declarada;
    this.origen = fila.origen;
    this.vigenteHastaUtc = normalizarMarcaUtc(fila.vigente_hasta_utc);
    this.detalleHumano = fila.detalle_humano ?? null;
    this.metadatos = parsearJsonOpcional(fila.metadatos_contextuales);
    this.emitidoEnUtc = normalizarMarcaUtc(fila.emitido_en_utc);
    this.observadoEnUtc = normalizarMarcaUtc(fila.observado_en_utc);
    this.recibidoEnUtc = normalizarMarcaUtc(fila.recibido_en_utc);
    this.fechaCreacion = normalizarMarcaUtc(fila.fecha_creacion);
    this.fechaActualizacion = normalizarMarcaUtc(fila.fecha_actualizacion);
  }

  serializar() {
    const serializada = {
      id: this.id,
      agenteId: this.agenteId,
      senalId: this.senalId,
      periodoVidaPolId: this.periodoVidaPolId,
      sesionIdDiagnostico: this.sesionIdDiagnostico,
      sesionHuellaSha256: this.sesionHuellaSha256,
      sesionAuditoriaId: this.sesionAuditoriaId,
      categoria: this.categoria,
      clave: this.clave,
      tag: this.tag,
      codigoSenal: this.codigoSenal,
      tipoDato: this.tipoDato,
      unidad: this.unidad,
      valorNumero: this.valorNumero,
      valorBooleano: this.valorBooleano,
      valorTexto: this.valorTexto,
      valorEstado: this.valorEstado,
      valorJson: clonarJson(this.valorJson),
      calidad: this.calidad,
      severidadDeclarada: this.severidadDeclarada,
      origen: this.origen,
      vigenteHastaUtc: this.vigenteHastaUtc,
      detalleHumano: this.detalleHumano,
      metadatos: clonarJson(this.metadatos),
      emitidoEnUtc: this.emitidoEnUtc,
      observadoEnUtc: this.observadoEnUtc,
      recibidoEnUtc: this.recibidoEnUtc,
      fechaCreacion: this.fechaCreacion,
      fechaActualizacion: this.fechaActualizacion
    };
    if (this.tipoDato === 'duracion' || this.tipoDato === 'momento_utc') {
      serializada.valorDuracion = this.valorDuracion;
      serializada.valorMomentoUtc = this.valorMomentoUtc;
    }
    return serializada;
  }
}

export class RepositorioObservacionesTelemetriaAgentes {
  constructor(clienteSql) {
    this.clienteSql = clienteSql;
  }

  async insertarLoteAceptado({
    agenteId,
    observacionesAceptadas = [],
    observacionesRechazadas = [],
    senalesCatalogadas = [],
    emitidoEnUtc = null,
    recibidoEnUtc = null,
    periodoVidaPolId = null,
    sesionAuditoriaId = null,
    sesionIdDiagnostico = null,
    sesionHuellaSha256 = null
  } = {}) {
    const agenteNormalizado = normalizarIdObligatorio(
      agenteId,
      'El agente de las observaciones de telemetría es obligatorio.'
    );
    const mapaSenales = construirMapaSenalesCatalogadas(senalesCatalogadas);
    const lecturas = normalizarArray(observacionesAceptadas).map((observacion) =>
      crearLecturaTelemetriaAgenteConTiposInternos(observacion)
    );
    const filas = lecturas.map((lectura) =>
      convertirLecturaAFilaPersistible({
        agenteId: agenteNormalizado,
        lectura,
        senalId: resolverSenalId(mapaSenales, agenteNormalizado, lectura),
        emitidoEnUtc,
        recibidoEnUtc,
        periodoVidaPolId,
        sesionAuditoriaId,
        sesionIdDiagnostico,
        sesionHuellaSha256
      })
    );
    const idsInsertados = await this.insertarFilas(filas);
    const insertadas = [];

    for (const idInsertado of idsInsertados) {
      insertadas.push(await this.buscarPorId(idInsertado));
    }

    return {
      insertadas: insertadas.filter(Boolean),
      totalInsertadas: insertadas.filter(Boolean).length,
      rechazosIgnorados: normalizarArray(observacionesRechazadas).length
    };
  }

  async insertarFilas(filas) {
    if (filas.length === 0) {
      return [];
    }

    if (typeof this.clienteSql.obtenerConexion === 'function') {
      return this.insertarFilasTransaccional(filas);
    }

    const ids = [];

    for (const fila of filas) {
      const [resultado] = await this.clienteSql.ejecutar(
        construirSqlInsercionObservacion(),
        construirParametrosInsercion(fila)
      );
      ids.push(resultado.insertId);
    }

    return ids;
  }

  async insertarFilasTransaccional(filas) {
    const conexion = await this.clienteSql.obtenerConexion();
    const ids = [];

    try {
      await conexion.beginTransaction();

      for (const fila of filas) {
        const [resultado] = await conexion.execute(
          construirSqlInsercionObservacion(),
          construirParametrosInsercion(fila)
        );
        ids.push(resultado.insertId);
      }

      await conexion.commit();
      return ids;
    } catch (error) {
      await conexion.rollback();
      throw error;
    } finally {
      conexion.release();
    }
  }

  async buscarPorId(idObservacion) {
    const idNormalizado = normalizarIdObligatorio(
      idObservacion,
      'La observación de telemetría no es válida.'
    );
    const filas = await this.clienteSql.consultar(
      `
        SELECT ${this.columnasSeleccion('o')}
        FROM observaciones_telemetria_agentes o
        WHERE o.id = ?
        LIMIT 1
      `,
      [idNormalizado]
    );

    return filas.length > 0 ? crearObservacionTelemetriaDesdeFila(filas[0]) : null;
  }

  async listarPorAgenteYRango({
    agenteId,
    desdeUtc = null,
    hastaUtc = null,
    limite = 500,
    orden = 'asc'
  } = {}) {
    const agenteNormalizado = normalizarIdObligatorio(
      agenteId,
      'El agente de las observaciones de telemetría es obligatorio.'
    );
    const consulta = construirFiltroRango({
      condiciones: ['o.agente_id = ?'],
      parametros: [agenteNormalizado],
      desdeUtc,
      hastaUtc
    });

    return this.listarConFiltro({
      where: consulta.where,
      parametros: consulta.parametros,
      limite,
      orden
    });
  }

  async listarPorSenalYRango({
    agenteId,
    senalId = null,
    categoria = null,
    clave = null,
    tag = null,
    desdeUtc = null,
    hastaUtc = null,
    limite = 500,
    orden = 'asc'
  } = {}) {
    const agenteNormalizado = normalizarIdObligatorio(
      agenteId,
      'El agente de las observaciones de telemetría es obligatorio.'
    );
    const condiciones = ['o.agente_id = ?'];
    const parametros = [agenteNormalizado];
    const senalNormalizada = normalizarIdOpcional(senalId);

    if (senalNormalizada) {
      condiciones.push(`
        (
          o.senal_id = ?
          OR (
            o.senal_id IS NULL
            AND EXISTS (
              SELECT 1
              FROM senales_telemetria_agentes s
              WHERE s.id = ?
                AND s.agente_id = o.agente_id
                AND s.categoria = o.categoria
                AND s.clave = o.clave
                AND s.tag = o.tag
            )
          )
        )
      `);
      parametros.push(senalNormalizada, senalNormalizada);
    } else {
      const identidad = normalizarIdentidadSenal({ categoria, clave, tag });
      condiciones.push('o.categoria = ?', 'o.clave = ?', 'o.tag = ?');
      parametros.push(identidad.categoria, identidad.clave, identidad.tag);
    }

    const consulta = construirFiltroRango({
      condiciones,
      parametros,
      desdeUtc,
      hastaUtc
    });

    return this.listarConFiltro({
      where: consulta.where,
      parametros: consulta.parametros,
      limite,
      orden
    });
  }

  async listarConFiltro({
    where,
    parametros,
    limite,
    orden
  }) {
    const direccion = normalizarOrden(orden);
    const filas = await this.clienteSql.consultar(
      `
        SELECT ${this.columnasSeleccion('o')}
        FROM observaciones_telemetria_agentes o
        ${where}
        ORDER BY o.observado_en_utc ${direccion}, o.id ${direccion}
        LIMIT ?
      `,
      [...parametros, normalizarLimite(limite)]
    );

    return filas.map((fila) => crearObservacionTelemetriaDesdeFila(fila));
  }

  columnasSeleccion(alias) {
    return `
      ${alias}.id,
      ${alias}.agente_id,
      ${alias}.senal_id,
      ${alias}.periodo_vida_pol_id,
      ${alias}.sesion_id_diagnostico,
      ${alias}.sesion_huella_sha256,
      ${alias}.sesion_auditoria_id,
      ${alias}.categoria,
      ${alias}.clave,
      ${alias}.tag,
      ${alias}.codigo_senal,
      ${alias}.tipo_dato,
      ${alias}.unidad,
      ${alias}.valor_numero,
      ${alias}.valor_booleano,
      ${alias}.valor_texto,
      ${alias}.valor_estado,
      ${alias}.valor_json,
      ${alias}.valor_duracion,
      ${alias}.valor_momento_utc,
      ${alias}.calidad,
      ${alias}.severidad_declarada,
      ${alias}.origen,
      ${alias}.vigente_hasta_utc,
      ${alias}.detalle_humano,
      ${alias}.metadatos_contextuales,
      ${alias}.emitido_en_utc,
      ${alias}.observado_en_utc,
      ${alias}.recibido_en_utc,
      ${alias}.fecha_creacion,
      ${alias}.fecha_actualizacion
    `;
  }
}

export function crearObservacionTelemetriaDesdeFila(fila) {
  return fila ? new ObservacionTelemetriaAgenteHistorica(fila) : null;
}

function convertirLecturaAFilaPersistible({
  agenteId,
  lectura,
  senalId,
  emitidoEnUtc,
  recibidoEnUtc,
  periodoVidaPolId,
  sesionAuditoriaId,
  sesionIdDiagnostico,
  sesionHuellaSha256
}) {
  const serializada = lectura.serializar();

  return {
    agenteId,
    senalId,
    periodoVidaPolId: normalizarIdOpcional(periodoVidaPolId),
    sesionAuditoriaId: sesionAuditoriaId == null
      ? null
      : uuidV7AuditoriaABytes(sesionAuditoriaId, 'sesionAuditoriaId'),
    sesionIdDiagnostico: normalizarTextoOpcional(sesionIdDiagnostico, 80),
    sesionHuellaSha256: normalizarSha256Opcional(sesionHuellaSha256),
    categoria: serializada.categoria,
    clave: serializada.clave,
    tag: serializada.tag || '',
    codigoSenal: serializada.codigoSenal,
    tipoDato: serializada.tipoDato,
    unidad: serializada.unidad || '',
    valorNumero: serializada.valorNumero,
    valorBooleano: serializada.valorBooleano == null
      ? null
      : serializada.valorBooleano ? 1 : 0,
    valorTexto: serializada.valorTexto,
    valorEstado: serializada.valorEstado,
    valorJsonSerializado: serializada.valorJson == null
      ? null
      : JSON.stringify(serializada.valorJson),
    valorDuracion: duracionTelemetriaASql(serializada.valorDuracion),
    valorMomentoUtc: momentoUtcTelemetriaASql(serializada.valorMomentoUtc),
    calidad: serializada.calidad,
    severidadDeclarada: serializada.severidadDeclarada,
    origen: serializada.origen,
    vigenteHastaUtc: normalizarFechaSqlOpcional(serializada.vigenteHastaUtc),
    detalleHumano: serializada.detalleHumano,
    metadatosSerializados: serializada.metadatos == null
      ? null
      : JSON.stringify(serializada.metadatos),
    emitidoEnUtc: normalizarFechaSqlOpcional(emitidoEnUtc),
    observadoEnUtc: normalizarFechaSqlObligatoria(serializada.observadoEnUtc),
    recibidoEnUtc: normalizarFechaSqlOpcional(recibidoEnUtc, {
      conservarMilisegundos: true
    })
  };
}

function construirSqlInsercionObservacion() {
  return `
    INSERT INTO observaciones_telemetria_agentes (
      agente_id,
      senal_id,
      periodo_vida_pol_id,
      sesion_id_diagnostico,
      sesion_huella_sha256,
      sesion_auditoria_id,
      categoria,
      clave,
      tag,
      codigo_senal,
      tipo_dato,
      unidad,
      valor_numero,
      valor_booleano,
      valor_texto,
      valor_estado,
      valor_json,
      valor_duracion,
      valor_momento_utc,
      calidad,
      severidad_declarada,
      origen,
      vigente_hasta_utc,
      detalle_humano,
      metadatos_contextuales,
      emitido_en_utc,
      observado_en_utc,
      recibido_en_utc
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, COALESCE(?, UTC_TIMESTAMP()))
  `;
}

function construirParametrosInsercion(fila) {
  return [
    fila.agenteId,
    fila.senalId,
    fila.periodoVidaPolId,
    fila.sesionIdDiagnostico,
    fila.sesionHuellaSha256,
    fila.sesionAuditoriaId,
    fila.categoria,
    fila.clave,
    fila.tag,
    fila.codigoSenal,
    fila.tipoDato,
    fila.unidad,
    fila.valorNumero,
    fila.valorBooleano,
    fila.valorTexto,
    fila.valorEstado,
    fila.valorJsonSerializado,
    fila.valorDuracion,
    fila.valorMomentoUtc,
    fila.calidad,
    fila.severidadDeclarada,
    fila.origen,
    fila.vigenteHastaUtc,
    fila.detalleHumano,
    fila.metadatosSerializados,
    fila.emitidoEnUtc,
    fila.observadoEnUtc,
    fila.recibidoEnUtc
  ];
}

function construirMapaSenalesCatalogadas(senales = []) {
  const mapa = new Map();

  for (const senal of normalizarArray(senales)) {
    const serializada = typeof senal?.serializar === 'function'
      ? senal.serializar()
      : senal;
    const id = normalizarIdOpcional(serializada?.id);

    if (!id) {
      continue;
    }

    mapa.set(
      construirClaveIdentidad({
        agenteId: serializada.agenteId,
        categoria: serializada.categoria,
        clave: serializada.clave,
        tag: serializada.tag
      }),
      id
    );
  }

  return mapa;
}

function resolverSenalId(mapaSenales, agenteId, lectura) {
  return mapaSenales.get(
    construirClaveIdentidad({
      agenteId,
      categoria: lectura.categoria,
      clave: lectura.clave,
      tag: lectura.tag
    })
  ) || null;
}

function construirClaveIdentidad({
  agenteId,
  categoria,
  clave,
  tag = null
}) {
  return [
    Number(agenteId),
    String(categoria || '').trim(),
    String(clave || '').trim(),
    String(tag || '').trim()
  ].join('\u0000');
}

function construirFiltroRango({
  condiciones,
  parametros,
  desdeUtc,
  hastaUtc
}) {
  const desde = normalizarFechaSqlOpcional(desdeUtc);
  const hasta = normalizarFechaSqlOpcional(hastaUtc);

  if (desde) {
    condiciones.push('o.observado_en_utc >= ?');
    parametros.push(desde);
  }

  if (hasta) {
    condiciones.push('o.observado_en_utc <= ?');
    parametros.push(hasta);
  }

  return {
    where: `WHERE ${condiciones.join(' AND ')}`,
    parametros
  };
}

function normalizarIdentidadSenal({ categoria, clave, tag = null }) {
  const categoriaNormalizada = String(categoria || '').trim();
  const claveNormalizada = String(clave || '').trim();

  if (!categoriaNormalizada || !claveNormalizada) {
    throw new Error(
      'La identidad de señal de telemetría necesita categoría y clave.'
    );
  }

  return {
    categoria: categoriaNormalizada,
    clave: claveNormalizada,
    tag: String(tag || '').trim()
  };
}

function normalizarArray(valor) {
  return Array.isArray(valor) ? valor : [];
}

function normalizarFechaSqlObligatoria(valor) {
  const normalizada = normalizarFechaSqlOpcional(valor);

  if (!normalizada) {
    throw new Error('La fecha observada de telemetría es obligatoria.');
  }

  return normalizada;
}

function normalizarFechaSqlOpcional(
  valor,
  { conservarMilisegundos = false } = {}
) {
  if (!valor) {
    return null;
  }

  const fecha = valor instanceof Date ? valor : new Date(valor);

  if (Number.isNaN(fecha.getTime())) {
    throw new Error('La fecha de telemetría no es válida.');
  }

  return fecha.toISOString()
    .slice(0, conservarMilisegundos ? 23 : 19)
    .replace('T', ' ');
}

function normalizarIdObligatorio(valor, mensaje) {
  const normalizado = normalizarIdOpcional(valor);

  if (!normalizado) {
    throw new Error(mensaje);
  }

  return normalizado;
}

function normalizarIdOpcional(valor) {
  const normalizado = Number.parseInt(String(valor ?? ''), 10);
  return Number.isInteger(normalizado) && normalizado > 0
    ? normalizado
    : null;
}

function normalizarTextoOpcional(valor, longitudMaxima) {
  const normalizado = String(valor || '').trim();

  if (!normalizado) {
    return null;
  }

  return normalizado.slice(0, longitudMaxima);
}

function normalizarSha256Opcional(valor) {
  const normalizado = String(valor || '').trim().toLowerCase();

  if (!normalizado) {
    return null;
  }

  if (!/^[0-9a-f]{64}$/.test(normalizado)) {
    throw new Error('La huella SHA-256 de sesión del agente no es válida.');
  }

  return normalizado;
}

function normalizarLimite(valor) {
  const normalizado = Number.parseInt(String(valor ?? ''), 10);

  if (!Number.isInteger(normalizado) || normalizado <= 0) {
    return 500;
  }

  return Math.min(normalizado, 5000);
}

function normalizarOrden(valor) {
  return String(valor || '').trim().toLowerCase() === 'desc' ? 'DESC' : 'ASC';
}

function parsearJsonOpcional(valor) {
  if (valor == null || valor === '') {
    return null;
  }

  if (typeof valor === 'object') {
    return clonarJson(valor);
  }

  try {
    return JSON.parse(String(valor));
  } catch {
    throw new Error('El JSON histórico de telemetría está corrupto.');
  }
}

function clonarJson(valor) {
  if (valor == null) {
    return null;
  }

  return JSON.parse(JSON.stringify(valor));
}

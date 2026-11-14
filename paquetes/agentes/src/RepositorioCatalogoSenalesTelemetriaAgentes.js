import { normalizarMarcaUtc } from '../../utilidades/src/fechas/normalizarMarcaUtc.js';
import {
  crearDefinicionSenalAgenteConTiposInternos,
  crearSenalTelemetriaAgenteConTiposInternos
} from './TelemetriaAgente.js';

export const CODIGO_ERROR_COMPATIBILIDAD_CATALOGO_TELEMETRIA =
  'senal_catalogo_incompatible';

export class ErrorCompatibilidadCatalogoTelemetria extends Error {
  constructor(mensaje) {
    super(mensaje);
    this.name = 'ErrorCompatibilidadCatalogoTelemetria';
    this.code = CODIGO_ERROR_COMPATIBILIDAD_CATALOGO_TELEMETRIA;
  }
}

export class SenalCatalogoTelemetriaAgente {
  constructor(fila = {}) {
    const senal = crearSenalTelemetriaAgenteConTiposInternos({
      categoria: fila.categoria,
      clave: fila.clave,
      tag: fila.tag || null,
      tipoDato: fila.tipo_dato,
      unidad: fila.unidad || null,
      nombreHumano: fila.nombre_humano || null,
      descripcion: fila.descripcion || null,
      metadatos: parsearJsonOpcional(fila.metadatos_descriptivos),
      codigoSenal: fila.codigo_senal,
      consolidadaEnUtc: fila.consolidada_en_utc
    }).serializar();

    this.id = fila.id;
    this.agenteId = fila.agente_id;
    this.categoria = senal.categoria;
    this.clave = senal.clave;
    this.tag = senal.tag;
    this.codigoSenal = senal.codigoSenal;
    this.tipoDato = senal.tipoDato;
    this.unidad = senal.unidad;
    this.nombreHumano = senal.nombreHumano;
    this.descripcion = senal.descripcion;
    this.metadatos = senal.metadatos;
    this.consolidadaEnUtc = senal.consolidadaEnUtc;
    this.ultimaDeclaracionUtc = normalizarMarcaUtc(fila.ultima_declaracion_utc);
    this.fechaCreacion = normalizarMarcaUtc(fila.fecha_creacion);
    this.fechaActualizacion = normalizarMarcaUtc(fila.fecha_actualizacion);
  }

  serializar() {
    return {
      id: this.id,
      agenteId: this.agenteId,
      categoria: this.categoria,
      clave: this.clave,
      tag: this.tag,
      codigoSenal: this.codigoSenal,
      tipoDato: this.tipoDato,
      unidad: this.unidad,
      nombreHumano: this.nombreHumano,
      descripcion: this.descripcion,
      metadatos: clonarJson(this.metadatos),
      consolidadaEnUtc: this.consolidadaEnUtc,
      ultimaDeclaracionUtc: this.ultimaDeclaracionUtc,
      fechaCreacion: this.fechaCreacion,
      fechaActualizacion: this.fechaActualizacion
    };
  }
}

export class RepositorioCatalogoSenalesTelemetriaAgentes {
  constructor(clienteSql) {
    this.clienteSql = clienteSql;
  }

  async guardarDeclaracionSenal({
    agenteId,
    definicion,
    declaradaEnUtc = null
  } = {}) {
    const agenteNormalizado = this.normalizarIdAgente(agenteId);
    const senal = crearDefinicionSenalAgenteConTiposInternos(definicion);
    const fisica = this.convertirDefinicionAFilaFisica(senal);
    const declaracionUtc = normalizarFechaSqlOpcional(declaradaEnUtc);
    const [resultado] = await this.clienteSql.ejecutar(
      `
        INSERT INTO senales_telemetria_agentes (
          agente_id,
          categoria,
          clave,
          tag,
          codigo_senal,
          tipo_dato,
          unidad,
          nombre_humano,
          descripcion,
          metadatos_descriptivos,
          ultima_declaracion_utc
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, COALESCE(?, UTC_TIMESTAMP()))
        ON DUPLICATE KEY UPDATE
          id = LAST_INSERT_ID(id),
          codigo_senal = CASE
            WHEN tipo_dato = VALUES(tipo_dato) AND unidad = VALUES(unidad)
              THEN VALUES(codigo_senal)
            ELSE codigo_senal
          END,
          nombre_humano = CASE
            WHEN tipo_dato = VALUES(tipo_dato)
              AND unidad = VALUES(unidad)
              AND VALUES(nombre_humano) <> ''
              THEN VALUES(nombre_humano)
            ELSE nombre_humano
          END,
          descripcion = CASE
            WHEN tipo_dato = VALUES(tipo_dato)
              AND unidad = VALUES(unidad)
              AND VALUES(descripcion) <> ''
              THEN VALUES(descripcion)
            ELSE descripcion
          END,
          metadatos_descriptivos = CASE
            WHEN tipo_dato = VALUES(tipo_dato)
              AND unidad = VALUES(unidad)
              AND VALUES(metadatos_descriptivos) IS NOT NULL
              THEN VALUES(metadatos_descriptivos)
            ELSE metadatos_descriptivos
          END,
          ultima_declaracion_utc = CASE
            WHEN tipo_dato = VALUES(tipo_dato) AND unidad = VALUES(unidad)
              THEN VALUES(ultima_declaracion_utc)
            ELSE ultima_declaracion_utc
          END
      `,
      [
        agenteNormalizado,
        fisica.categoria,
        fisica.clave,
        fisica.tag,
        fisica.codigoSenal,
        fisica.tipoDato,
        fisica.unidad,
        fisica.nombreHumano,
        fisica.descripcion,
        fisica.metadatosSerializados,
        declaracionUtc
      ]
    );

    const catalogada = await this.buscarPorId(resultado.insertId);

    if (!catalogada) {
      throw new Error('No se pudo consolidar la señal de telemetría del agente.');
    }

    this.asegurarCompatibilidadDeclaracion(senal, catalogada);

    return catalogada;
  }

  async buscarPorId(idSenal) {
    const idNormalizado = this.normalizarId(idSenal, 'La señal de telemetría no es válida.');
    const filas = await this.clienteSql.consultar(
      `
        SELECT ${this.columnasSeleccion('s')}
        FROM senales_telemetria_agentes s
        WHERE s.id = ?
        LIMIT 1
      `,
      [idNormalizado]
    );

    return filas.length > 0 ? crearSenalCatalogoDesdeFila(filas[0]) : null;
  }

  async buscarPorIdentidad({
    agenteId,
    categoria,
    clave,
    tag = null
  } = {}) {
    const agenteNormalizado = this.normalizarIdAgente(agenteId);
    const senal = crearDefinicionSenalAgenteConTiposInternos({
      categoria,
      clave,
      tag,
      tipoDato: 'texto'
    });
    const filas = await this.clienteSql.consultar(
      `
        SELECT ${this.columnasSeleccion('s')}
        FROM senales_telemetria_agentes s
        WHERE s.agente_id = ?
          AND s.categoria = ?
          AND s.clave = ?
          AND s.tag = ?
        LIMIT 1
      `,
      [
        agenteNormalizado,
        senal.categoria,
        senal.clave,
        senal.tag || ''
      ]
    );

    return filas.length > 0 ? crearSenalCatalogoDesdeFila(filas[0]) : null;
  }

  async listarPorAgente(agenteId) {
    const agenteNormalizado = this.normalizarIdAgente(agenteId);
    const filas = await this.clienteSql.consultar(
      `
        SELECT ${this.columnasSeleccion('s')}
        FROM senales_telemetria_agentes s
        WHERE s.agente_id = ?
        ORDER BY s.categoria ASC, s.clave ASC, s.tag ASC, s.id ASC
      `,
      [agenteNormalizado]
    );

    return filas.map((fila) => crearSenalCatalogoDesdeFila(fila));
  }

  columnasSeleccion(alias) {
    return `
      ${alias}.id,
      ${alias}.agente_id,
      ${alias}.categoria,
      ${alias}.clave,
      ${alias}.tag,
      ${alias}.codigo_senal,
      ${alias}.tipo_dato,
      ${alias}.unidad,
      ${alias}.nombre_humano,
      ${alias}.descripcion,
      ${alias}.metadatos_descriptivos,
      ${alias}.consolidada_en_utc,
      ${alias}.ultima_declaracion_utc,
      ${alias}.fecha_creacion,
      ${alias}.fecha_actualizacion
    `;
  }

  convertirDefinicionAFilaFisica(definicion) {
    return {
      categoria: definicion.categoria,
      clave: definicion.clave,
      tag: definicion.tag || '',
      codigoSenal: definicion.obtenerCodigoSenal(),
      tipoDato: definicion.tipoDato,
      unidad: definicion.unidad || '',
      nombreHumano: definicion.nombreHumano || '',
      descripcion: definicion.descripcion || '',
      metadatosSerializados: definicion.metadatos == null
        ? null
        : JSON.stringify(definicion.metadatos)
    };
  }

  asegurarCompatibilidadDeclaracion(definicion, catalogada) {
    const unidadDeclarada = definicion.unidad || null;

    if (
      catalogada.tipoDato !== definicion.tipoDato ||
      catalogada.unidad !== unidadDeclarada
    ) {
      throw new ErrorCompatibilidadCatalogoTelemetria(
        'La señal de telemetría ya existe con tipo de dato o unidad distinta.'
      );
    }
  }

  normalizarIdAgente(valor) {
    return this.normalizarId(valor, 'El agente de la señal de telemetría es obligatorio.');
  }

  normalizarId(valor, mensaje) {
    const normalizado = Number.parseInt(String(valor ?? ''), 10);

    if (!Number.isInteger(normalizado) || normalizado <= 0) {
      throw new Error(mensaje);
    }

    return normalizado;
  }
}

export function crearSenalCatalogoDesdeFila(fila) {
  return fila ? new SenalCatalogoTelemetriaAgente(fila) : null;
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
    return null;
  }
}

function clonarJson(valor) {
  if (valor == null) {
    return null;
  }

  return JSON.parse(JSON.stringify(valor));
}

function normalizarFechaSqlOpcional(valor) {
  if (!valor) {
    return null;
  }

  const fechaUtc = normalizarMarcaUtc(valor);
  const fecha = new Date(fechaUtc);

  if (Number.isNaN(fecha.getTime())) {
    throw new Error('La fecha de declaración de la señal de telemetría no es válida.');
  }

  return fecha;
}

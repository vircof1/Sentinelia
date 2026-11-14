import { normalizarMarcaUtc } from '../../utilidades/src/fechas/normalizarMarcaUtc.js';
import {
  bytesAUuidV7Auditoria,
  uuidV7AuditoriaABytes
} from '../../auditoria/src/UuidV7Auditoria.js';
import {
  crearLecturaActualTelemetriaAgenteConTiposInternos,
  resolverActualizacionFotografiaTelemetria
} from './TelemetriaAgente.js';
import {
  duracionTelemetriaASql,
  duracionTelemetriaDesdeSql,
  momentoUtcTelemetriaASql,
  momentoUtcTelemetriaDesdeSql
} from './CodecSqlTelemetriaTemporalAgente.js';

export class LecturaActualTelemetriaAgentePersistida {
  constructor(fila = {}) {
    const lectura = crearLecturaActualTelemetriaAgenteConTiposInternos({
      id: fila.id,
      agenteId: fila.agente_id,
      senalId: fila.senal_id,
      ultimaObservacionId: fila.ultima_observacion_id,
      periodoVidaPolId: fila.periodo_vida_pol_id,
      sesionAuditoriaId: fila.sesion_auditoria_id
        ? bytesAUuidV7Auditoria(fila.sesion_auditoria_id, 'sesionAuditoriaId')
        : null,
      sesionIdDiagnostico: fila.sesion_id_diagnostico,
      sesionHuellaSha256: fila.sesion_huella_sha256,
      categoria: fila.categoria,
      clave: fila.clave,
      tag: fila.tag || null,
      tipoDato: fila.tipo_dato,
      unidad: fila.unidad || null,
      valorNumero: fila.valor_numero == null ? null : Number(fila.valor_numero),
      valorBooleano: fila.valor_booleano == null
        ? null
        : Boolean(Number(fila.valor_booleano)),
      valorTexto: fila.valor_texto ?? null,
      valorEstado: fila.valor_estado ?? null,
      valorJson: parsearJsonObligatorioSiPresente(fila.valor_json),
      valorDuracion: duracionTelemetriaDesdeSql(fila.valor_duracion),
      valorMomentoUtc: momentoUtcTelemetriaDesdeSql(fila.valor_momento_utc),
      calidad: fila.calidad,
      severidadDeclarada: fila.severidad_declarada,
      origen: fila.origen,
      vigenteHastaUtc: normalizarMarcaUtc(fila.vigente_hasta_utc),
      detalleHumano: fila.detalle_humano,
      metadatos: parsearJsonObligatorioSiPresente(fila.metadatos_contextuales),
      emitidoEnUtc: normalizarMarcaUtc(fila.emitido_en_utc),
      observadoEnUtc: normalizarMarcaUtc(fila.observado_en_utc),
      recibidoEnUtc: normalizarMarcaUtc(fila.recibido_en_utc)
    }).serializar();

    Object.assign(this, lectura, {
      fechaCreacion: normalizarMarcaUtc(fila.fecha_creacion),
      fechaActualizacion: normalizarMarcaUtc(fila.fecha_actualizacion)
    });
  }

  serializar() {
    const serializada = {
      id: this.id,
      agenteId: this.agenteId,
      senalId: this.senalId,
      ultimaObservacionId: this.ultimaObservacionId,
      periodoVidaPolId: this.periodoVidaPolId,
      sesionIdDiagnostico: this.sesionIdDiagnostico,
      sesionHuellaSha256: this.sesionHuellaSha256,
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

export class RepositorioEstadoActualTelemetriaAgentes {
  constructor(clienteSql) {
    this.clienteSql = clienteSql;
  }

  async aplicarObservacionesHistoricas(observaciones = []) {
    const resultado = {
      procesadas: 0,
      creadas: 0,
      actualizadas: 0,
      ignoradas: 0,
      fotografias: []
    };

    for (const observacion of normalizarArray(observaciones)) {
      const aplicada = await this.aplicarObservacionHistorica(observacion);
      resultado.procesadas += 1;

      if (aplicada.decision.actualizar) {
        if (aplicada.decision.resultado === 'crear') {
          resultado.creadas += 1;
        } else {
          resultado.actualizadas += 1;
        }
        resultado.fotografias.push(aplicada.fotografia);
      } else {
        resultado.ignoradas += 1;
      }
    }

    return resultado;
  }

  async aplicarObservacionHistorica(observacion) {
    const candidata = construirCandidataDesdeObservacionHistorica(observacion);
    const actual = await this.buscarPorIdentidad(candidata);
    const decision = resolverActualizacionFotografiaTelemetria({
      actual: actual?.serializar() || null,
      candidata
    });

    if (!decision.actualizar) {
      return {
        decision,
        fotografia: actual ? actual.serializar() : null
      };
    }

    await this.guardarFotografia(candidata);
    const fotografia = await this.buscarPorIdentidad(candidata);

    return {
      decision,
      fotografia: fotografia?.serializar() || null
    };
  }

  async buscarPorIdentidad({
    agenteId,
    categoria,
    clave,
    tag = null
  } = {}) {
    const identidad = normalizarIdentidad({ agenteId, categoria, clave, tag });
    const filas = await this.clienteSql.consultar(
      `
        SELECT ${this.columnasSeleccion('e')}
        FROM estado_actual_telemetria_agentes e
        WHERE e.agente_id = ?
          AND e.categoria = ?
          AND e.clave = ?
          AND e.tag = ?
        LIMIT 1
      `,
      [
        identidad.agenteId,
        identidad.categoria,
        identidad.clave,
        identidad.tag
      ]
    );

    return filas.length > 0 ? crearLecturaActualDesdeFila(filas[0]) : null;
  }

  async listarPorAgente(agenteId) {
    const agenteNormalizado = normalizarIdObligatorio(
      agenteId,
      'El agente de la fotografía de telemetría es obligatorio.'
    );
    const filas = await this.clienteSql.consultar(
      `
        SELECT ${this.columnasSeleccion('e')}
        FROM estado_actual_telemetria_agentes e
        WHERE e.agente_id = ?
        ORDER BY e.categoria ASC, e.clave ASC, e.tag ASC, e.id ASC
      `,
      [agenteNormalizado]
    );

    return filas.map((fila) => crearLecturaActualDesdeFila(fila));
  }

  async buscarPorSenalId({ agenteId, senalId } = {}) {
    const agenteNormalizado = normalizarIdObligatorio(
      agenteId,
      'El agente de la fotografía de telemetría es obligatorio.'
    );
    const senalNormalizada = normalizarIdObligatorio(
      senalId,
      'La señal de la fotografía de telemetría es obligatoria.'
    );
    const filas = await this.clienteSql.consultar(
      `
        SELECT ${this.columnasSeleccion('e')}
        FROM estado_actual_telemetria_agentes e
        WHERE e.agente_id = ?
          AND e.senal_id = ?
        LIMIT 1
      `,
      [agenteNormalizado, senalNormalizada]
    );

    return filas.length > 0 ? crearLecturaActualDesdeFila(filas[0]) : null;
  }

  async bloquearPorSenalEnTransaccion({
    agenteId,
    senalId
  } = {}, { conexion } = {}) {
    const [fotografia = null] = await this.bloquearPorSenalesEnTransaccion({
      agenteId,
      senalIds: [senalId]
    }, { conexion });
    return fotografia;
  }

  async bloquearPorSenalesEnTransaccion({
    agenteId,
    senalIds = []
  } = {}, { conexion } = {}) {
    exigirConexionTransaccional(conexion);
    const agenteNormalizado = normalizarIdObligatorio(
      agenteId,
      'El agente de las fotografías a retirar es obligatorio.'
    );
    const ids = normalizarIdsUnicos(senalIds, 'senalIds');
    if (ids.length === 0) return [];
    const [filas] = await conexion.execute(
      `
        SELECT ${this.columnasSeleccion('e')}
        FROM estado_actual_telemetria_agentes e
        WHERE e.agente_id = ?
          AND e.senal_id IN (${ids.map(() => '?').join(', ')})
        ORDER BY e.id ASC
        FOR UPDATE
      `,
      [agenteNormalizado, ...ids]
    );
    return filas.map((fila) => crearLecturaActualDesdeFila(fila));
  }

  async eliminarBloqueadasEnTransaccion({
    agenteId,
    fotografiaIds = []
  } = {}, { conexion } = {}) {
    exigirConexionTransaccional(conexion);
    const agenteNormalizado = normalizarIdObligatorio(
      agenteId,
      'El agente de las fotografías a retirar es obligatorio.'
    );
    const ids = normalizarIdsUnicos(fotografiaIds, 'fotografiaIds');
    if (ids.length === 0) return 0;
    const [resultado] = await conexion.execute(
      `DELETE FROM estado_actual_telemetria_agentes
        WHERE agente_id = ?
          AND id IN (${ids.map(() => '?').join(', ')})`,
      [agenteNormalizado, ...ids]
    );
    const eliminadas = Number(resultado.affectedRows || 0);
    if (eliminadas !== ids.length) {
      throw new Error(
        'Las fotografías bloqueadas cambiaron durante su retirada.'
      );
    }
    return eliminadas;
  }

  async guardarFotografia(fotografia) {
    const fila = convertirFotografiaAFilaPersistible(fotografia);
    await this.clienteSql.ejecutar(
      construirSqlUpsertFotografia(),
      construirParametrosUpsert(fila)
    );
  }

  columnasSeleccion(alias) {
    return `
      ${alias}.id,
      ${alias}.agente_id,
      ${alias}.senal_id,
      ${alias}.ultima_observacion_id,
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

function exigirConexionTransaccional(conexion) {
  if (typeof conexion?.execute !== 'function') {
    throw new Error('La retirada de fotografía exige una transacción SQL.');
  }
}

function normalizarIdsUnicos(valores, campo) {
  if (!Array.isArray(valores)) {
    throw new TypeError(`${campo} debe ser una lista.`);
  }
  return [...new Set(valores.map((valor) =>
    normalizarIdObligatorio(valor, `${campo} contiene una identidad inválida.`)
  ))];
}

export function crearLecturaActualDesdeFila(fila) {
  return fila ? new LecturaActualTelemetriaAgentePersistida(fila) : null;
}

function construirCandidataDesdeObservacionHistorica(observacion) {
  const serializada = typeof observacion?.serializar === 'function'
    ? observacion.serializar()
    : observacion;

  return crearLecturaActualTelemetriaAgenteConTiposInternos({
    agenteId: serializada.agenteId,
    senalId: serializada.senalId,
    ultimaObservacionId: serializada.id,
    periodoVidaPolId: serializada.periodoVidaPolId,
    sesionAuditoriaId: serializada.sesionAuditoriaId,
    sesionIdDiagnostico: serializada.sesionIdDiagnostico,
    sesionHuellaSha256: serializada.sesionHuellaSha256,
    categoria: serializada.categoria,
    clave: serializada.clave,
    tag: serializada.tag,
    tipoDato: serializada.tipoDato,
    unidad: serializada.unidad,
    valorNumero: serializada.valorNumero,
    valorBooleano: serializada.valorBooleano,
    valorTexto: serializada.valorTexto,
    valorEstado: serializada.valorEstado,
    valorJson: serializada.valorJson,
    valorDuracion: serializada.valorDuracion,
    valorMomentoUtc: serializada.valorMomentoUtc,
    calidad: serializada.calidad,
    severidadDeclarada: serializada.severidadDeclarada,
    origen: serializada.origen,
    vigenteHastaUtc: serializada.vigenteHastaUtc,
    detalleHumano: serializada.detalleHumano,
    metadatos: serializada.metadatos,
    emitidoEnUtc: serializada.emitidoEnUtc,
    observadoEnUtc: serializada.observadoEnUtc,
    recibidoEnUtc: serializada.recibidoEnUtc
  }).serializar();
}

function convertirFotografiaAFilaPersistible(fotografia) {
  const normalizada = crearLecturaActualTelemetriaAgenteConTiposInternos(
    fotografia
  ).serializar();

  return {
    agenteId: normalizada.agenteId,
    senalId: normalizada.senalId,
    ultimaObservacionId: normalizada.ultimaObservacionId,
    periodoVidaPolId: normalizada.periodoVidaPolId,
    sesionAuditoriaId: normalizada.sesionAuditoriaId == null
      ? null
      : uuidV7AuditoriaABytes(normalizada.sesionAuditoriaId, 'sesionAuditoriaId'),
    sesionIdDiagnostico: normalizarTextoOpcional(normalizada.sesionIdDiagnostico, 80),
    sesionHuellaSha256: normalizarTextoOpcional(normalizada.sesionHuellaSha256, 64),
    categoria: normalizada.categoria,
    clave: normalizada.clave,
    tag: normalizada.tag || '',
    codigoSenal: normalizada.codigoSenal,
    tipoDato: normalizada.tipoDato,
    unidad: normalizada.unidad || '',
    valorNumero: normalizada.valorNumero,
    valorBooleano: normalizada.valorBooleano == null
      ? null
      : normalizada.valorBooleano ? 1 : 0,
    valorTexto: normalizada.valorTexto,
    valorEstado: normalizada.valorEstado,
    valorJsonSerializado: normalizada.valorJson == null
      ? null
      : JSON.stringify(normalizada.valorJson),
    valorDuracion: duracionTelemetriaASql(normalizada.valorDuracion),
    valorMomentoUtc: momentoUtcTelemetriaASql(normalizada.valorMomentoUtc),
    calidad: normalizada.calidad,
    severidadDeclarada: normalizada.severidadDeclarada,
    origen: normalizada.origen,
    vigenteHastaUtc: normalizarFechaSqlOpcional(normalizada.vigenteHastaUtc),
    detalleHumano: normalizada.detalleHumano,
    metadatosSerializados: normalizada.metadatos == null
      ? null
      : JSON.stringify(normalizada.metadatos),
    emitidoEnUtc: normalizarFechaSqlOpcional(normalizada.emitidoEnUtc),
    observadoEnUtc: normalizarFechaSqlObligatoria(normalizada.observadoEnUtc),
    recibidoEnUtc: normalizarFechaSqlObligatoria(
      normalizada.recibidoEnUtc,
      { conservarMilisegundos: true }
    )
  };
}

function construirSqlUpsertFotografia() {
  const condicionActualizacion =
    '(VALUES(observado_en_utc) > observado_en_utc OR ' +
    '(VALUES(observado_en_utc) = observado_en_utc ' +
    'AND VALUES(ultima_observacion_id) IS NOT NULL ' +
    'AND ultima_observacion_id IS NOT NULL ' +
    'AND VALUES(ultima_observacion_id) > ultima_observacion_id))';
  const columnasActualizables = [
    'senal_id',
    'periodo_vida_pol_id',
    'sesion_id_diagnostico',
    'sesion_huella_sha256',
    'sesion_auditoria_id',
    'codigo_senal',
    'tipo_dato',
    'unidad',
    'valor_numero',
    'valor_booleano',
    'valor_texto',
    'valor_estado',
    'valor_json',
    'valor_duracion',
    'valor_momento_utc',
    'calidad',
    'severidad_declarada',
    'origen',
    'vigente_hasta_utc',
    'detalle_humano',
    'metadatos_contextuales',
    'emitido_en_utc',
    'recibido_en_utc',
    'ultima_observacion_id',
    'observado_en_utc'
  ];
  const actualizaciones = columnasActualizables
    .map((columna) =>
      `${columna} = CASE WHEN ${condicionActualizacion} THEN VALUES(${columna}) ELSE ${columna} END`
    )
    .join(',\n          ');

  return `
    INSERT INTO estado_actual_telemetria_agentes (
      agente_id,
      senal_id,
      ultima_observacion_id,
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
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON DUPLICATE KEY UPDATE
          ${actualizaciones}
  `;
}

function construirParametrosUpsert(fila) {
  return [
    fila.agenteId,
    fila.senalId,
    fila.ultimaObservacionId,
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

function normalizarIdentidad({ agenteId, categoria, clave, tag = null }) {
  return {
    agenteId: normalizarIdObligatorio(
      agenteId,
      'El agente de la fotografía de telemetría es obligatorio.'
    ),
    categoria: normalizarTextoObligatorio(
      categoria,
      'La categoría de la fotografía de telemetría es obligatoria.'
    ),
    clave: normalizarTextoObligatorio(
      clave,
      'La clave de la fotografía de telemetría es obligatoria.'
    ),
    tag: normalizarTextoOpcional(tag, 128) || ''
  };
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

function normalizarTextoObligatorio(valor, mensaje) {
  const normalizado = normalizarTextoOpcional(valor, 128);

  if (!normalizado) {
    throw new Error(mensaje);
  }

  return normalizado;
}

function normalizarTextoOpcional(valor, longitudMaxima) {
  const normalizado = String(valor || '').trim();

  if (!normalizado) {
    return null;
  }

  return normalizado.slice(0, longitudMaxima);
}

function normalizarFechaSqlObligatoria(valor, opciones = {}) {
  const normalizada = normalizarFechaSqlOpcional(valor, opciones);

  if (!normalizada) {
    throw new Error('La fecha de telemetría es obligatoria.');
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

function parsearJsonObligatorioSiPresente(valor) {
  if (valor == null || valor === '') {
    return null;
  }

  if (typeof valor === 'object') {
    return clonarJson(valor);
  }

  try {
    return JSON.parse(String(valor));
  } catch {
    throw new Error('El JSON de la fotografía de telemetría está corrupto.');
  }
}

function normalizarArray(valor) {
  return Array.isArray(valor) ? valor : [];
}

function clonarJson(valor) {
  if (valor == null) {
    return null;
  }

  return JSON.parse(JSON.stringify(valor));
}

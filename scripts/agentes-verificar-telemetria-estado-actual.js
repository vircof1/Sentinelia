import assert from 'node:assert/strict';
import {
  RepositorioEstadoActualTelemetriaAgentes
} from '../paquetes/agentes/src/RepositorioEstadoActualTelemetriaAgentes.js';
import {
  ServicioIngestaTelemetriaAgentes
} from '../paquetes/agentes/src/ServicioIngestaTelemetriaAgentes.js';
import {
  construirCodigoSenal,
  TIPOS_DATO_TELEMETRIA_AGENTE
} from '../paquetes/agentes/src/TelemetriaAgente.js';

async function main() {
  const clienteSql = new ClienteSqlEstadoActualFalso();
  const repositorio = new RepositorioEstadoActualTelemetriaAgentes(clienteSql);

  await verificarPrimeraObservacionCreaFotografia(repositorio, clienteSql);
  await verificarObservacionRecienteActualiza(repositorio);
  await verificarObservacionAntiguaNoPisa(repositorio);
  await verificarMismaFechaConObservacionPosteriorActualiza(repositorio);
  await verificarMismaFechaSinObservacionPosteriorNoPisa(repositorio);
  await verificarListadoVacioEstable(repositorio);
  await verificarIntegracionServicioActualizaFotografia();
  verificarContratoSqlEmitido(clienteSql);

  console.log('[agentes-telemetria] OK: fotografía actual verificada.');
}

async function verificarPrimeraObservacionCreaFotografia(repositorio, clienteSql) {
  const resultado = await repositorio.aplicarObservacionesHistoricas([
    crearObservacionHistorica({
      id: 1,
      valorNumero: 42,
      observadoEnUtc: '2026-07-07T10:00:00Z',
      recibidoEnUtc: '2026-07-07T10:00:05Z'
    })
  ]);

  assert.equal(resultado.procesadas, 1);
  assert.equal(resultado.creadas, 1);
  assert.equal(resultado.actualizadas, 0);
  assert.equal(resultado.ignoradas, 0);
  assert.equal(clienteSql.filas.length, 1);
  assert.equal(resultado.fotografias[0].valorNumero, 42);
  assert.equal(resultado.fotografias[0].ultimaObservacionId, 1);
}

async function verificarObservacionRecienteActualiza(repositorio) {
  const resultado = await repositorio.aplicarObservacionesHistoricas([
    crearObservacionHistorica({
      id: 2,
      valorNumero: 55,
      observadoEnUtc: '2026-07-07T10:02:00Z',
      recibidoEnUtc: '2026-07-07T10:02:04Z',
      detalleHumano: 'Lectura más reciente.'
    })
  ]);
  const actual = await repositorio.buscarPorIdentidad({
    agenteId: 7,
    categoria: 'sistema',
    clave: 'cpu',
    tag: 'socket0'
  });

  assert.equal(resultado.creadas, 0);
  assert.equal(resultado.actualizadas, 1);
  assert.equal(resultado.ignoradas, 0);
  assert.equal(actual.valorNumero, 55);
  assert.equal(actual.ultimaObservacionId, 2);
  assert.equal(actual.detalleHumano, 'Lectura más reciente.');
  assert.equal(actual.observadoEnUtc, '2026-07-07T10:02:00.000Z');
}

async function verificarObservacionAntiguaNoPisa(repositorio) {
  const resultado = await repositorio.aplicarObservacionesHistoricas([
    crearObservacionHistorica({
      id: 3,
      valorNumero: 12,
      observadoEnUtc: '2026-07-07T09:59:00Z',
      recibidoEnUtc: '2026-07-07T10:30:00Z',
      detalleHumano: 'Llegó tarde, no debe pisar.'
    })
  ]);
  const actual = await repositorio.buscarPorIdentidad({
    agenteId: 7,
    categoria: 'sistema',
    clave: 'cpu',
    tag: 'socket0'
  });

  assert.equal(resultado.creadas, 0);
  assert.equal(resultado.actualizadas, 0);
  assert.equal(resultado.ignoradas, 1);
  assert.equal(actual.valorNumero, 55);
  assert.equal(actual.ultimaObservacionId, 2);
  assert.equal(actual.detalleHumano, 'Lectura más reciente.');
}

async function verificarMismaFechaConObservacionPosteriorActualiza(repositorio) {
  const resultado = await repositorio.aplicarObservacionesHistoricas([
    crearObservacionHistorica({
      id: 4,
      valorNumero: 58,
      observadoEnUtc: '2026-07-07T10:02:00Z',
      recibidoEnUtc: '2026-07-07T10:31:00Z',
      detalleHumano: 'Misma fecha observada, observación posterior.'
    })
  ]);
  const actual = await repositorio.buscarPorIdentidad({
    agenteId: 7,
    categoria: 'sistema',
    clave: 'cpu',
    tag: 'socket0'
  });

  assert.equal(resultado.creadas, 0);
  assert.equal(resultado.actualizadas, 1);
  assert.equal(resultado.ignoradas, 0);
  assert.equal(actual.valorNumero, 58);
  assert.equal(actual.ultimaObservacionId, 4);
  assert.equal(actual.detalleHumano, 'Misma fecha observada, observación posterior.');
}

async function verificarMismaFechaSinObservacionPosteriorNoPisa(repositorio) {
  const resultado = await repositorio.aplicarObservacionesHistoricas([
    crearObservacionHistorica({
      id: 3,
      valorNumero: 99,
      observadoEnUtc: '2026-07-07T10:02:00Z',
      recibidoEnUtc: '2026-07-07T10:32:00Z',
      detalleHumano: 'Misma fecha observada, observación no posterior.'
    })
  ]);
  const actual = await repositorio.buscarPorIdentidad({
    agenteId: 7,
    categoria: 'sistema',
    clave: 'cpu',
    tag: 'socket0'
  });

  assert.equal(resultado.creadas, 0);
  assert.equal(resultado.actualizadas, 0);
  assert.equal(resultado.ignoradas, 1);
  assert.equal(actual.valorNumero, 58);
  assert.equal(actual.ultimaObservacionId, 4);
  assert.equal(actual.detalleHumano, 'Misma fecha observada, observación posterior.');
}

async function verificarListadoVacioEstable(repositorio) {
  const listado = await repositorio.listarPorAgente(999);
  assert.deepEqual(listado, []);
}

async function verificarIntegracionServicioActualizaFotografia() {
  const clienteSql = new ClienteSqlEstadoActualFalso();
  const repositorioEstadoActual =
    new RepositorioEstadoActualTelemetriaAgentes(clienteSql);
  const servicio = new ServicioIngestaTelemetriaAgentes({
    repositorioCatalogoSenales: new RepositorioCatalogoNulo(),
    repositorioObservaciones: new RepositorioObservacionesHistoricasFalso(),
    repositorioEstadoActual,
    generarRequestId: () => 'req_estado_actual',
    reloj: () => new Date('2026-07-07T11:00:00Z')
  });

  const resultado = await servicio.ingestarLote({
    agenteId: 9,
    lote: {
      observaciones: [
        {
          categoria: 'sistema',
          clave: 'ram',
          tipoDato: TIPOS_DATO_TELEMETRIA_AGENTE.NUMERO,
          unidad: '%',
          observadoEnUtc: '2026-07-07T10:59:00Z',
          valorNumero: 64
        }
      ]
    }
  });
  const actuales = await repositorioEstadoActual.listarPorAgente(9);

  assert.equal(resultado.persistencia.totalInsertadas, 1);
  assert.equal(resultado.persistencia.fotografiaActual.procesadas, 1);
  assert.equal(resultado.persistencia.fotografiaActual.creadas, 1);
  assert.equal(actuales.length, 1);
  assert.equal(actuales[0].clave, 'ram');
  assert.equal(actuales[0].valorNumero, 64);
}

function verificarContratoSqlEmitido(clienteSql) {
  const upsert = clienteSql.consultasEjecutadas.find((consulta) =>
    consulta.sql.includes('INSERT INTO estado_actual_telemetria_agentes')
  );

  assert.ok(upsert, 'El repositorio debe emitir upsert de fotografía actual.');
  assert.ok(
    upsert.sql.includes('ON DUPLICATE KEY UPDATE'),
    'La fotografía actual debe poder actualizarse de forma idempotente.'
  );
  assert.ok(
    upsert.sql.includes('VALUES(observado_en_utc) > observado_en_utc'),
    'El SQL debe proteger contra observaciones antiguas.'
  );
  assert.ok(
    upsert.sql.includes('VALUES(ultima_observacion_id) > ultima_observacion_id'),
    'El SQL debe contemplar desempate por observación histórica posterior.'
  );
  assert.ok(
    upsert.sql.indexOf('recibido_en_utc = CASE') <
      upsert.sql.indexOf('ultima_observacion_id = CASE') &&
      upsert.sql.indexOf('recibido_en_utc = CASE') <
        upsert.sql.indexOf('observado_en_utc = CASE'),
    'El SQL debe actualizar recibido_en_utc antes de mutar las columnas usadas por la condición temporal.'
  );
}

function crearObservacionHistorica({
  id,
  agenteId = 7,
  senalId = 11,
  periodoVidaPolId = 3,
  categoria = 'sistema',
  clave = 'cpu',
  tag = 'socket0',
  tipoDato = TIPOS_DATO_TELEMETRIA_AGENTE.NUMERO,
  unidad = '%',
  valorNumero = 42,
  valorBooleano = null,
  valorTexto = null,
  valorEstado = null,
  valorJson = null,
  calidad = 'valida',
  severidadDeclarada = 'info',
  origen = 'directa',
  vigenteHastaUtc = null,
  detalleHumano = 'Lectura histórica.',
  metadatos = { origenPrueba: true },
  emitidoEnUtc = '2026-07-07T10:00:01Z',
  observadoEnUtc,
  recibidoEnUtc
}) {
  return {
    id,
    agenteId,
    senalId,
    periodoVidaPolId,
    sesionIdDiagnostico: 'ags_estado_actual',
    sesionHuellaSha256: 'c'.repeat(64),
    categoria,
    clave,
    tag,
    codigoSenal: construirCodigoSenal({ categoria, clave, tag }),
    tipoDato,
    unidad,
    valorNumero,
    valorBooleano,
    valorTexto,
    valorEstado,
    valorJson,
    calidad,
    severidadDeclarada,
    origen,
    vigenteHastaUtc,
    detalleHumano,
    metadatos,
    emitidoEnUtc,
    observadoEnUtc,
    recibidoEnUtc,
    serializar() {
      const { serializar, ...datos } = this;
      return { ...datos };
    }
  };
}

class RepositorioCatalogoNulo {
  constructor() {
    this.siguienteId = 1;
  }

  async buscarPorIdentidad() {
    return null;
  }

  async guardarDeclaracionSenal({ agenteId, definicion }) {
    const serializada = typeof definicion?.serializar === 'function'
      ? definicion.serializar()
      : definicion;
    const senal = {
      id: this.siguienteId++,
      agenteId,
      categoria: serializada.categoria,
      clave: serializada.clave,
      tag: serializada.tag || null,
      codigoSenal: serializada.tag
        ? `${serializada.categoria}.${serializada.clave}:${serializada.tag}`
        : `${serializada.categoria}.${serializada.clave}`,
      tipoDato: serializada.tipoDato,
      unidad: serializada.unidad || null,
      nombreHumano: serializada.nombreHumano || null,
      descripcion: serializada.descripcion || null,
      metadatos: serializada.metadatos || null,
      serializar() {
        const { serializar, ...datos } = this;
        return { ...datos };
      }
    };

    return senal;
  }
}

class RepositorioObservacionesHistoricasFalso {
  constructor() {
    this.siguienteId = 1;
  }

  async insertarLoteAceptado({
    agenteId,
    observacionesAceptadas = [],
    observacionesRechazadas = [],
    emitidoEnUtc = null,
    recibidoEnUtc = null,
    periodoVidaPolId = null,
    sesionIdDiagnostico = null,
    sesionHuellaSha256 = null
  } = {}) {
    const insertadas = observacionesAceptadas.map((observacion) =>
      crearObservacionHistorica({
        id: this.siguienteId++,
        agenteId,
        senalId: null,
        periodoVidaPolId,
        sesionIdDiagnostico,
        sesionHuellaSha256,
        categoria: observacion.categoria,
        clave: observacion.clave,
        tag: observacion.tag,
        tipoDato: observacion.tipoDato,
        unidad: observacion.unidad,
        valorNumero: observacion.valorNumero,
        valorBooleano: observacion.valorBooleano,
        valorTexto: observacion.valorTexto,
        valorEstado: observacion.valorEstado,
        valorJson: observacion.valorJson,
        calidad: observacion.calidad,
        severidadDeclarada: observacion.severidadDeclarada,
        origen: observacion.origen,
        vigenteHastaUtc: observacion.vigenteHastaUtc,
        detalleHumano: observacion.detalleHumano,
        metadatos: observacion.metadatos,
        emitidoEnUtc,
        observadoEnUtc: observacion.observadoEnUtc,
        recibidoEnUtc
      })
    );

    return {
      insertadas,
      totalInsertadas: insertadas.length,
      rechazosIgnorados: observacionesRechazadas.length
    };
  }
}

class ClienteSqlEstadoActualFalso {
  constructor() {
    this.filas = [];
    this.siguienteId = 1;
    this.consultasEjecutadas = [];
  }

  async ejecutar(sql, parametros = []) {
    this.consultasEjecutadas.push({ tipo: 'ejecutar', sql, parametros });

    if (sql.includes('INSERT INTO estado_actual_telemetria_agentes')) {
      const fila = this.crearFila(parametros);
      const existente = this.buscarFilaPorIdentidad(fila);

      if (!existente) {
        this.filas.push(fila);
        return [{ insertId: fila.id, affectedRows: 1 }];
      }

      if (this.debeActualizar(existente, fila)) {
        Object.assign(existente, {
          ...fila,
          id: existente.id,
          fecha_creacion: existente.fecha_creacion,
          fecha_actualizacion: '2026-07-07 10:45:00'
        });
        return [{ insertId: existente.id, affectedRows: 2 }];
      }

      return [{ insertId: existente.id, affectedRows: 0 }];
    }

    throw new Error(`SQL de escritura no soportado por el cliente falso: ${sql}`);
  }

  async consultar(sql, parametros = []) {
    this.consultasEjecutadas.push({ tipo: 'consultar', sql, parametros });

    if (
      sql.includes('WHERE e.agente_id = ?') &&
      sql.includes('AND e.categoria = ?') &&
      sql.includes('AND e.clave = ?') &&
      sql.includes('AND e.tag = ?')
    ) {
      return this.filas.filter(
        (fila) =>
          fila.agente_id === Number(parametros[0]) &&
          fila.categoria === parametros[1] &&
          fila.clave === parametros[2] &&
          fila.tag === parametros[3]
      );
    }

    if (sql.includes('WHERE e.agente_id = ?')) {
      return this.filas
        .filter((fila) => fila.agente_id === Number(parametros[0]))
        .sort((a, b) =>
          `${a.categoria}\u0000${a.clave}\u0000${a.tag}\u0000${a.id}`.localeCompare(
            `${b.categoria}\u0000${b.clave}\u0000${b.tag}\u0000${b.id}`
          )
        );
    }

    throw new Error(`SQL de lectura no soportado por el cliente falso: ${sql}`);
  }

  crearFila([
    agenteId,
    senalId,
    ultimaObservacionId,
    periodoVidaPolId,
    sesionIdDiagnostico,
    sesionHuellaSha256,
    sesionAuditoriaId,
    categoria,
    clave,
    tag,
    codigoSenal,
    tipoDato,
    unidad,
    valorNumero,
    valorBooleano,
    valorTexto,
    valorEstado,
    valorJsonSerializado,
    valorDuracion,
    valorMomentoUtc,
    calidad,
    severidadDeclarada,
    origen,
    vigenteHastaUtc,
    detalleHumano,
    metadatosSerializados,
    emitidoEnUtc,
    observadoEnUtc,
    recibidoEnUtc
  ]) {
    const ahora = '2026-07-07 10:40:00';

    return {
      id: this.siguienteId++,
      agente_id: Number(agenteId),
      senal_id: senalId,
      ultima_observacion_id: ultimaObservacionId,
      periodo_vida_pol_id: periodoVidaPolId,
      sesion_id_diagnostico: sesionIdDiagnostico,
      sesion_huella_sha256: sesionHuellaSha256,
      sesion_auditoria_id: sesionAuditoriaId,
      categoria,
      clave,
      tag,
      codigo_senal: codigoSenal,
      tipo_dato: tipoDato,
      unidad,
      valor_numero: valorNumero,
      valor_booleano: valorBooleano,
      valor_texto: valorTexto,
      valor_estado: valorEstado,
      valor_json: valorJsonSerializado,
      valor_duracion: valorDuracion,
      valor_momento_utc: valorMomentoUtc,
      calidad,
      severidad_declarada: severidadDeclarada,
      origen,
      vigente_hasta_utc: vigenteHastaUtc,
      detalle_humano: detalleHumano,
      metadatos_contextuales: metadatosSerializados,
      emitido_en_utc: emitidoEnUtc,
      observado_en_utc: observadoEnUtc,
      recibido_en_utc: recibidoEnUtc,
      fecha_creacion: ahora,
      fecha_actualizacion: ahora
    };
  }

  buscarFilaPorIdentidad(fila) {
    return this.filas.find(
      (existente) =>
        existente.agente_id === fila.agente_id &&
        existente.categoria === fila.categoria &&
        existente.clave === fila.clave &&
        existente.tag === fila.tag
    );
  }

  debeActualizar(actual, candidata) {
    if (candidata.observado_en_utc > actual.observado_en_utc) {
      return true;
    }

    return (
      candidata.observado_en_utc === actual.observado_en_utc &&
      candidata.ultima_observacion_id != null &&
      actual.ultima_observacion_id != null &&
      candidata.ultima_observacion_id > actual.ultima_observacion_id
    );
  }
}

main().catch((error) => {
  console.error('[agentes-telemetria] Error verificando fotografía actual');
  console.error(error);
  process.exit(1);
});

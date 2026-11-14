import assert from 'node:assert/strict';
import {
  RepositorioObservacionesTelemetriaAgentes
} from '../paquetes/agentes/src/RepositorioObservacionesTelemetriaAgentes.js';
import {
  ServicioIngestaTelemetriaAgentes
} from '../paquetes/agentes/src/ServicioIngestaTelemetriaAgentes.js';
import {
  ErrorCompatibilidadCatalogoTelemetria
} from '../paquetes/agentes/src/RepositorioCatalogoSenalesTelemetriaAgentes.js';
import {
  construirCodigoSenal,
  TIPOS_DATO_TELEMETRIA_AGENTE
} from '../paquetes/agentes/src/TelemetriaAgente.js';

async function main() {
  const clienteSql = new ClienteSqlObservacionesFalso();
  const repositorio = new RepositorioObservacionesTelemetriaAgentes(clienteSql);

  await verificarInsercionSoloAceptadas(repositorio, clienteSql);
  await verificarValoresPorTipo(repositorio);
  await verificarConsultasPorRango(repositorio);
  await verificarAislamientoPorAgente(repositorio);
  await verificarFechasInvalidasFallan(repositorio);
  await verificarJsonHistoricoCorruptoFalla(repositorio, clienteSql);
  await verificarServicioIngestaYPersisteAceptadas();
  await verificarServicioIngestaEnlazaCatalogoExistente();
  await verificarConsultaPorSenalIncluyeHistoricoSinEnlace();
  await verificarAtomicidadCatalogoObservaciones();
  verificarContratoSqlEmitido(clienteSql);

  console.log('[agentes-telemetria] OK: observaciones históricas verificadas.');
}

async function verificarInsercionSoloAceptadas(repositorio, clienteSql) {
  const resultado = await repositorio.insertarLoteAceptado({
    agenteId: 7,
    senalesCatalogadas: [
      {
        id: 11,
        agenteId: 7,
        categoria: 'sistema',
        clave: 'cpu',
        tag: 'socket0'
      }
    ],
    periodoVidaPolId: 3,
    sesionIdDiagnostico: 'ags_prueba',
    sesionHuellaSha256: 'a'.repeat(64),
    emitidoEnUtc: '2026-07-07T10:00:01Z',
    recibidoEnUtc: '2026-07-07T10:00:02Z',
    observacionesAceptadas: [
      {
        categoria: 'sistema',
        clave: 'cpu',
        tag: 'socket0',
        tipoDato: TIPOS_DATO_TELEMETRIA_AGENTE.NUMERO,
        unidad: '%',
        observadoEnUtc: '2026-07-07T10:00:00Z',
        valorNumero: 42.5,
        calidad: 'valida',
        severidadDeclarada: 'info',
        origen: 'directa',
        detalleHumano: 'CPU estable',
        metadatos: {
          cores: 4
        }
      }
    ],
    observacionesRechazadas: [
      {
        categoria: 'sistema',
        clave: 'basura'
      }
    ]
  });

  assert.equal(resultado.totalInsertadas, 1);
  assert.equal(resultado.rechazosIgnorados, 1);
  assert.equal(clienteSql.filas.length, 1);
  assert.equal(resultado.insertadas[0].senalId, 11);
  assert.equal(resultado.insertadas[0].periodoVidaPolId, 3);
  assert.equal(resultado.insertadas[0].valorNumero, 42.5);
  assert.deepEqual(resultado.insertadas[0].metadatos, { cores: 4 });
}

async function verificarValoresPorTipo(repositorio) {
  const textoAcotado = 'lectura '.repeat(250).trim();
  const jsonAcotado = {
    usadoGb: 4.4,
    totalGb: 10,
    detalle: 'memoria '.repeat(120).trim()
  };
  const resultado = await repositorio.insertarLoteAceptado({
    agenteId: 7,
    observacionesAceptadas: [
      {
        categoria: 'sistema',
        clave: 'activo',
        tipoDato: TIPOS_DATO_TELEMETRIA_AGENTE.BOOLEANO,
        observadoEnUtc: '2026-07-07T10:01:00Z',
        valorBooleano: false
      },
      {
        categoria: 'sistema',
        clave: 'estado',
        tipoDato: TIPOS_DATO_TELEMETRIA_AGENTE.ESTADO,
        observadoEnUtc: '2026-07-07T10:02:00Z',
        valorEstado: 'degradado'
      },
      {
        categoria: 'sistema',
        clave: 'mensaje',
        tipoDato: TIPOS_DATO_TELEMETRIA_AGENTE.TEXTO,
        observadoEnUtc: '2026-07-07T10:03:00Z',
        valorTexto: textoAcotado
      },
      {
        categoria: 'sistema',
        clave: 'payload',
        tipoDato: TIPOS_DATO_TELEMETRIA_AGENTE.JSON,
        observadoEnUtc: '2026-07-07T10:04:00Z',
        valorJson: jsonAcotado
      }
    ]
  });

  assert.equal(resultado.totalInsertadas, 4);
  assert.equal(resultado.insertadas[0].valorBooleano, false);
  assert.equal(resultado.insertadas[1].valorEstado, 'degradado');
  assert.equal(resultado.insertadas[2].valorTexto, textoAcotado);
  assert.deepEqual(resultado.insertadas[3].valorJson, jsonAcotado);
  assert.ok(resultado.insertadas[2].valorTexto.length <= 2048);
  assert.ok(JSON.stringify(resultado.insertadas[3].valorJson).length <= 2048);
}

async function verificarConsultasPorRango(repositorio) {
  const porAgente = await repositorio.listarPorAgenteYRango({
    agenteId: 7,
    desdeUtc: '2026-07-07T10:01:00Z',
    hastaUtc: '2026-07-07T10:03:00Z',
    orden: 'asc'
  });
  assert.deepEqual(
    porAgente.map((observacion) => observacion.clave),
    ['activo', 'estado', 'mensaje']
  );

  const porIdentidad = await repositorio.listarPorSenalYRango({
    agenteId: 7,
    categoria: 'sistema',
    clave: 'cpu',
    tag: 'socket0',
    desdeUtc: '2026-07-07T09:00:00Z',
    hastaUtc: '2026-07-07T11:00:00Z'
  });
  assert.equal(porIdentidad.length, 1);
  assert.equal(porIdentidad[0].codigoSenal, 'sistema.cpu:socket0');

  const porSenal = await repositorio.listarPorSenalYRango({
    agenteId: 7,
    senalId: 11
  });
  assert.equal(porSenal.length, 1);
  assert.equal(porSenal[0].senalId, 11);

  const descendenteLimitado = await repositorio.listarPorAgenteYRango({
    agenteId: 7,
    desdeUtc: '2026-07-07T10:01:00Z',
    hastaUtc: '2026-07-07T10:04:00Z',
    orden: 'desc',
    limite: 2
  });
  assert.deepEqual(
    descendenteLimitado.map((observacion) => observacion.clave),
    ['payload', 'mensaje']
  );
}

async function verificarAislamientoPorAgente(repositorio) {
  await repositorio.insertarLoteAceptado({
    agenteId: 8,
    senalesCatalogadas: [
      {
        id: 22,
        agenteId: 8,
        categoria: 'sistema',
        clave: 'cpu',
        tag: 'socket0'
      }
    ],
    observacionesAceptadas: [
      {
        categoria: 'sistema',
        clave: 'cpu',
        tag: 'socket0',
        tipoDato: TIPOS_DATO_TELEMETRIA_AGENTE.NUMERO,
        unidad: '%',
        observadoEnUtc: '2026-07-07T10:02:30Z',
        valorNumero: 91
      }
    ]
  });

  const porAgenteOriginal = await repositorio.listarPorAgenteYRango({
    agenteId: 7,
    desdeUtc: '2026-07-07T10:02:00Z',
    hastaUtc: '2026-07-07T10:03:00Z'
  });
  assert.deepEqual(
    porAgenteOriginal.map((observacion) => observacion.agenteId),
    [7, 7]
  );

  const porAgenteAislado = await repositorio.listarPorSenalYRango({
    agenteId: 8,
    senalId: 22,
    desdeUtc: '2026-07-07T10:00:00Z',
    hastaUtc: '2026-07-07T11:00:00Z'
  });
  assert.equal(porAgenteAislado.length, 1);
  assert.equal(porAgenteAislado[0].agenteId, 8);
  assert.equal(porAgenteAislado[0].valorNumero, 91);
}

async function verificarServicioIngestaEnlazaCatalogoExistente() {
  const clienteSql = new ClienteSqlObservacionesFalso();
  const repositorioObservaciones =
    new RepositorioObservacionesTelemetriaAgentes(clienteSql);
  const repositorioCatalogo = new RepositorioCatalogoEnMemoria();
  const servicio = new ServicioIngestaTelemetriaAgentes({
    repositorioCatalogoSenales: repositorioCatalogo
  });

  await servicio.ingestarLoteConRepositorios({
    agenteId: 7,
    lote: {
      emitidoEnUtc: '2026-07-07T10:00:01Z',
      observaciones: [
        {
          categoria: 'sistema',
          clave: 'cpu.uso',
          tag: 'global',
          tipoDato: TIPOS_DATO_TELEMETRIA_AGENTE.NUMERO,
          unidad: '%',
          observadoEnUtc: '2026-07-07T10:00:00Z',
          valorNumero: 12
        }
      ]
    },
    repositorioCatalogoSenales: repositorioCatalogo,
    repositorioObservaciones
  });

  const primera = clienteSql.filas.at(-1);
  assert.equal(primera.senal_id, 1);

  await servicio.ingestarLoteConRepositorios({
    agenteId: 7,
    lote: {
      emitidoEnUtc: '2026-07-07T10:01:01Z',
      observaciones: [
        {
          categoria: 'sistema',
          clave: 'cpu.uso',
          tag: 'global',
          tipoDato: TIPOS_DATO_TELEMETRIA_AGENTE.NUMERO,
          unidad: '%',
          observadoEnUtc: '2026-07-07T10:01:00Z',
          valorNumero: 18
        }
      ]
    },
    repositorioCatalogoSenales: repositorioCatalogo,
    repositorioObservaciones
  });

  const segunda = clienteSql.filas.at(-1);
  assert.equal(segunda.senal_id, 1);
}

async function verificarConsultaPorSenalIncluyeHistoricoSinEnlace() {
  const clienteSql = new ClienteSqlObservacionesFalso();
  const repositorio = new RepositorioObservacionesTelemetriaAgentes(clienteSql);

  clienteSql.registrarSenalCatalogada({
    id: 77,
    agenteId: 7,
    categoria: 'sistema',
    clave: 'cpu.uso',
    tag: 'global'
  });
  clienteSql.insertarFilaHistoricaManual({
    agente_id: 7,
    senal_id: null,
    categoria: 'sistema',
    clave: 'cpu.uso',
    tag: 'global',
    codigo_senal: 'sistema.cpu.uso:global',
    observado_en_utc: '2026-07-07 10:02:00',
    valor_numero: 22
  });

  const historico = await repositorio.listarPorSenalYRango({
    agenteId: 7,
    senalId: 77,
    desdeUtc: '2026-07-07T10:00:00Z',
    hastaUtc: '2026-07-07T11:00:00Z'
  });

  assert.equal(historico.length, 1);
  assert.equal(historico[0].valorNumero, 22);
  assert.equal(historico[0].senalId, null);
}

async function verificarFechasInvalidasFallan(repositorio) {
  await assert.rejects(
    () =>
      repositorio.insertarLoteAceptado({
        agenteId: 7,
        observacionesAceptadas: [
          {
            categoria: 'sistema',
            clave: 'fecha_invalida',
            tipoDato: TIPOS_DATO_TELEMETRIA_AGENTE.NUMERO,
            observadoEnUtc: '2026-07-07T10:05:00Z',
            vigenteHastaUtc: 'fecha imposible',
            valorNumero: 1
          }
        ]
      }),
    /fecha de telemetría no es válida/
  );

  await assert.rejects(
    () =>
      repositorio.listarPorAgenteYRango({
        agenteId: 7,
        desdeUtc: 'ayer por la tarde'
      }),
    /fecha de telemetría no es válida/
  );
}

async function verificarJsonHistoricoCorruptoFalla(repositorio, clienteSql) {
  const idCorrupto = clienteSql.insertarFilaHistoricaManual({
    clave: 'json_corrupto',
    tipo_dato: TIPOS_DATO_TELEMETRIA_AGENTE.JSON,
    valor_numero: null,
    valor_json: '{json roto'
  });

  await assert.rejects(
    () => repositorio.buscarPorId(idCorrupto),
    /JSON histórico de telemetría está corrupto/
  );
}

async function verificarServicioIngestaYPersisteAceptadas() {
  const clienteSql = new ClienteSqlObservacionesFalso();
  const repositorioObservaciones =
    new RepositorioObservacionesTelemetriaAgentes(clienteSql);
  const repositorioCatalogo = new RepositorioCatalogoEnMemoria();
  const servicio = new ServicioIngestaTelemetriaAgentes({
    repositorioCatalogoSenales: repositorioCatalogo,
    repositorioObservaciones,
    generarRequestId: () => 'req_ingesta_observaciones',
    reloj: () => new Date('2026-07-07T11:00:00Z')
  });

  const resultado = await servicio.ingestarLote({
    agenteId: 9,
    periodoVidaPolId: 31,
    sesionIdDiagnostico: 'ags_sesion_ingesta',
    sesionHuellaSha256: 'b'.repeat(64),
    lote: {
      emitidoEnUtc: '2026-07-07T10:59:58Z',
      observaciones: [
        {
          categoria: 'sistema',
          clave: 'cpu',
          tag: 'socket0',
          tipoDato: TIPOS_DATO_TELEMETRIA_AGENTE.NUMERO,
          unidad: '%',
          observadoEnUtc: '2026-07-07T10:59:55Z',
          valorNumero: 66.6,
          calidad: 'estimada',
          severidadDeclarada: 'aviso',
          origen: 'calculada',
          vigenteHastaUtc: '2026-07-07T11:04:55Z',
          detalleHumano: 'Ventana de cinco minutos.',
          metadatos: {
            ventanaSegundos: 300
          },
          definicionSenal: {
            categoria: 'sistema',
            clave: 'cpu',
            tag: 'socket0',
            tipoDato: TIPOS_DATO_TELEMETRIA_AGENTE.NUMERO,
            unidad: '%',
            nombreHumano: 'CPU socket 0'
          }
        },
        {
          categoria: 'sistema',
          clave: 'cpu',
          tag: 'socket0',
          tipoDato: TIPOS_DATO_TELEMETRIA_AGENTE.NUMERO,
          unidad: 'ºC',
          observadoEnUtc: '2026-07-07T10:59:56Z',
          valorNumero: 71.2
        }
      ]
    }
  });

  assert.equal(resultado.resultado.resultado, 'parcial');
  assert.equal(resultado.resultado.aceptadas, 1);
  assert.equal(resultado.resultado.rechazadas, 1);
  assert.equal(resultado.persistencia.totalInsertadas, 1);
  assert.equal(resultado.persistencia.rechazosIgnorados, 1);
  assert.equal(clienteSql.filas.length, 1);

  const historica = resultado.persistencia.observaciones[0];
  assert.equal(historica.senalId, 1);
  assert.equal(historica.periodoVidaPolId, 31);
  assert.equal(historica.sesionIdDiagnostico, 'ags_sesion_ingesta');
  assert.equal(historica.valorNumero, 66.6);
  assert.equal(historica.calidad, 'estimada');
  assert.equal(historica.severidadDeclarada, 'aviso');
  assert.equal(historica.origen, 'calculada');
  assert.equal(historica.detalleHumano, 'Ventana de cinco minutos.');
  assert.deepEqual(historica.metadatos, { ventanaSegundos: 300 });
  assert.equal(historica.emitidoEnUtc, '2026-07-07T10:59:58.000Z');
  assert.equal(historica.recibidoEnUtc, '2026-07-07T11:00:00.000Z');
}

async function verificarAtomicidadCatalogoObservaciones() {
  const clienteSql = new ClienteSqlAtomicidadFalso();
  const repositorioCatalogoSenales = new RepositorioCatalogoAtomicidad(clienteSql);
  const repositorioObservaciones = new RepositorioObservacionesAtomicidad(clienteSql);
  const servicio = new ServicioIngestaTelemetriaAgentes({
    repositorioCatalogoSenales,
    repositorioObservaciones,
    generarRequestId: () => 'req_atomicidad_catalogo_observaciones',
    reloj: () => new Date('2026-07-07T12:00:00Z')
  });

  await assert.rejects(
    () =>
      servicio.ingestarLote({
        agenteId: 77,
        lote: {
          observaciones: [
            {
              categoria: 'sistema',
              clave: 'cpu',
              tag: 'socket0',
              tipoDato: TIPOS_DATO_TELEMETRIA_AGENTE.NUMERO,
              unidad: '%',
              observadoEnUtc: '2026-07-07T12:00:00Z',
              valorNumero: 12,
              definicionSenal: {
                categoria: 'sistema',
                clave: 'cpu',
                tag: 'socket0',
                tipoDato: TIPOS_DATO_TELEMETRIA_AGENTE.NUMERO,
                unidad: '%'
              }
            }
          ]
        }
      }),
    /fallo insertando observaciones/
  );

  assert.deepEqual(
    clienteSql.operacionesPersistidas,
    [],
    'Si falla la persistencia de observaciones, el catálogo no debe quedar adelantado.'
  );
  assert.equal(clienteSql.transacciones[0].begin, true);
  assert.equal(clienteSql.transacciones[0].rollback, true);
  assert.equal(clienteSql.transacciones[0].commit, false);
}

function verificarContratoSqlEmitido(clienteSql) {
  const insercion = clienteSql.consultasEjecutadas.find((consulta) =>
    consulta.sql.includes('INSERT INTO observaciones_telemetria_agentes')
  );
  assert.ok(insercion, 'El repositorio debe insertar observaciones históricas.');
  assert.equal(
    clienteSql.filas.some((fila) => fila.clave === 'basura'),
    false,
    'Las observaciones rechazadas no deben persistirse como basura histórica.'
  );
  assert.equal(
    insercion.parametros[15],
    null,
    'Una lectura numérica no debe rellenar valor_json.'
  );
}

class RepositorioCatalogoEnMemoria {
  constructor() {
    this.siguienteId = 1;
    this.senales = new Map();
  }

  async guardarDeclaracionSenal({ agenteId, definicion }) {
    const clave = this.construirClave({
      agenteId,
      categoria: definicion.categoria,
      clave: definicion.clave,
      tag: definicion.tag
    });
    const existente = this.senales.get(clave);

    if (existente) {
      if (
        existente.tipoDato !== definicion.tipoDato ||
        existente.unidad !== (definicion.unidad || null)
      ) {
        throw new ErrorCompatibilidadCatalogoTelemetria(
          'La señal de telemetría ya existe con tipo de dato o unidad distinta.'
        );
      }

      return this.crearSerializable(existente);
    }

    const senal = {
      id: this.siguienteId++,
      agenteId,
      categoria: definicion.categoria,
      clave: definicion.clave,
      tag: definicion.tag || null,
      codigoSenal: construirCodigoSenal(definicion),
      tipoDato: definicion.tipoDato,
      unidad: definicion.unidad || null
    };
    this.senales.set(clave, senal);
    return this.crearSerializable(senal);
  }

  async buscarPorIdentidad({ agenteId, categoria, clave, tag = null }) {
    const senal = this.senales.get(
      this.construirClave({ agenteId, categoria, clave, tag })
    );

    return senal ? this.crearSerializable(senal) : null;
  }

  construirClave({
    agenteId,
    categoria,
    clave,
    tag = null
  }) {
    return [
      agenteId,
      categoria,
      clave,
      tag || ''
    ].join('\u0000');
  }

  crearSerializable(senal) {
    return {
      ...senal,
      serializar() {
        return { ...senal };
      }
    };
  }
}

class ClienteSqlObservacionesFalso {
  constructor() {
    this.filas = [];
    this.senalesCatalogadas = new Map();
    this.siguienteId = 1;
    this.consultasEjecutadas = [];
  }

  async ejecutar(sql, parametros = []) {
    this.consultasEjecutadas.push({ tipo: 'ejecutar', sql, parametros });

    if (sql.includes('INSERT INTO observaciones_telemetria_agentes')) {
      const fila = this.crearFila(parametros);
      this.filas.push(fila);
      return [{ insertId: fila.id, affectedRows: 1 }];
    }

    throw new Error(`SQL de escritura no soportado por el cliente falso: ${sql}`);
  }

  async consultar(sql, parametros = []) {
    this.consultasEjecutadas.push({ tipo: 'consultar', sql, parametros });

    if (sql.includes('WHERE o.id = ?')) {
      return this.filas.filter((fila) => fila.id === Number(parametros[0]));
    }

    if (sql.includes('FROM observaciones_telemetria_agentes o')) {
      return this.filtrarObservaciones(sql, parametros);
    }

    throw new Error(`SQL de lectura no soportado por el cliente falso: ${sql}`);
  }

  crearFila([
    agenteId,
    senalId,
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
    const ahora = '2026-07-07 10:30:00';

    return {
      id: this.siguienteId++,
      agente_id: Number(agenteId),
      senal_id: senalId,
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
      recibido_en_utc: recibidoEnUtc || ahora,
      fecha_creacion: ahora,
      fecha_actualizacion: ahora
    };
  }

  insertarFilaHistoricaManual(sobrescritura = {}) {
    const ahora = '2026-07-07 10:30:00';
    const fila = {
      id: this.siguienteId++,
      agente_id: 7,
      senal_id: null,
      periodo_vida_pol_id: null,
      sesion_id_diagnostico: null,
      sesion_huella_sha256: null,
      sesion_auditoria_id: null,
      categoria: 'sistema',
      clave: 'manual',
      tag: '',
      codigo_senal: 'sistema.manual',
      tipo_dato: TIPOS_DATO_TELEMETRIA_AGENTE.NUMERO,
      unidad: '',
      valor_numero: 1,
      valor_booleano: null,
      valor_texto: null,
      valor_estado: null,
      valor_json: null,
      valor_duracion: null,
      valor_momento_utc: null,
      calidad: 'valida',
      severidad_declarada: 'info',
      origen: 'directa',
      vigente_hasta_utc: null,
      detalle_humano: null,
      metadatos_contextuales: null,
      emitido_en_utc: null,
      observado_en_utc: '2026-07-07 10:29:00',
      recibido_en_utc: ahora,
      fecha_creacion: ahora,
      fecha_actualizacion: ahora,
      ...sobrescritura
    };
    this.filas.push(fila);
    return fila.id;
  }

  registrarSenalCatalogada({
    id,
    agenteId,
    categoria,
    clave,
    tag = ''
  }) {
    this.senalesCatalogadas.set(Number(id), {
      id: Number(id),
      agente_id: Number(agenteId),
      categoria,
      clave,
      tag: tag || ''
    });
  }

  filtrarObservaciones(sql, parametros) {
    const limite = Number(parametros.at(-1));
    const parametrosFiltro = parametros.slice(0, -1);
    let indice = 0;
    let filas = [...this.filas];

    if (sql.includes('o.agente_id = ?')) {
      const agenteId = Number(parametrosFiltro[indice++]);
      filas = filas.filter((fila) => fila.agente_id === agenteId);
    }

    if (sql.includes('o.senal_id = ?')) {
      const senalId = Number(parametrosFiltro[indice++]);
      const usaFallbackPorIdentidad = sql.includes('FROM senales_telemetria_agentes s');
      const senalFallback = usaFallbackPorIdentidad
        ? this.senalesCatalogadas.get(Number(parametrosFiltro[indice++]))
        : null;
      filas = filas.filter(
        (fila) =>
          fila.senal_id === senalId ||
          (
            fila.senal_id == null &&
            senalFallback &&
            fila.agente_id === senalFallback.agente_id &&
            fila.categoria === senalFallback.categoria &&
            fila.clave === senalFallback.clave &&
            fila.tag === senalFallback.tag
          )
      );
    }

    if (
      sql.includes('o.categoria = ?') &&
      sql.includes('o.clave = ?') &&
      sql.includes('o.tag = ?')
    ) {
      const categoria = parametrosFiltro[indice++];
      const clave = parametrosFiltro[indice++];
      const tag = parametrosFiltro[indice++];
      filas = filas.filter(
        (fila) =>
          fila.categoria === categoria &&
          fila.clave === clave &&
          fila.tag === tag
      );
    }

    if (sql.includes('o.observado_en_utc >= ?')) {
      const desde = parametrosFiltro[indice++];
      filas = filas.filter((fila) => fila.observado_en_utc >= desde);
    }

    if (sql.includes('o.observado_en_utc <= ?')) {
      const hasta = parametrosFiltro[indice++];
      filas = filas.filter((fila) => fila.observado_en_utc <= hasta);
    }

    const descendente = sql.includes('ORDER BY o.observado_en_utc DESC');
    filas.sort((a, b) => {
      const comparacion = `${a.observado_en_utc}\u0000${a.id}`.localeCompare(
        `${b.observado_en_utc}\u0000${b.id}`
      );
      return descendente ? -comparacion : comparacion;
    });

    return filas.slice(0, limite);
  }
}

class RepositorioCatalogoAtomicidad {
  constructor(clienteSql) {
    this.clienteSql = clienteSql;
  }

  async guardarDeclaracionSenal({ agenteId, definicion }) {
    await this.clienteSql.ejecutar('INSERT INTO catalogo_atomicidad', [
      agenteId,
      definicion.categoria,
      definicion.clave,
      definicion.tag || ''
    ]);

    return {
      id: 101,
      agenteId,
      categoria: definicion.categoria,
      clave: definicion.clave,
      tag: definicion.tag || null,
      codigoSenal: construirCodigoSenal(definicion),
      tipoDato: definicion.tipoDato,
      unidad: definicion.unidad || null,
      serializar() {
        return {
          id: 101,
          agenteId,
          categoria: definicion.categoria,
          clave: definicion.clave,
          tag: definicion.tag || null,
          codigoSenal: construirCodigoSenal(definicion),
          tipoDato: definicion.tipoDato,
          unidad: definicion.unidad || null
        };
      }
    };
  }

  async buscarPorIdentidad() {
    return null;
  }
}

class RepositorioObservacionesAtomicidad {
  constructor(clienteSql) {
    this.clienteSql = clienteSql;
  }

  async insertarLoteAceptado() {
    await this.clienteSql.ejecutar('INSERT INTO observaciones_atomicidad', []);
    throw new Error('fallo insertando observaciones');
  }
}

class ClienteSqlAtomicidadFalso {
  constructor() {
    this.operacionesPersistidas = [];
    this.transacciones = [];
  }

  async obtenerConexion() {
    const transaccion = {
      begin: false,
      commit: false,
      rollback: false,
      liberada: false,
      operaciones: []
    };
    this.transacciones.push(transaccion);

    return {
      beginTransaction: async () => {
        transaccion.begin = true;
      },
      execute: async (sql, parametros = []) => {
        transaccion.operaciones.push({ sql, parametros });
        return [{ insertId: transaccion.operaciones.length, affectedRows: 1 }];
      },
      commit: async () => {
        transaccion.commit = true;
        this.operacionesPersistidas.push(...transaccion.operaciones);
      },
      rollback: async () => {
        transaccion.rollback = true;
      },
      release: () => {
        transaccion.liberada = true;
      }
    };
  }
}

main().catch((error) => {
  console.error('[agentes-telemetria] Error verificando observaciones');
  console.error(error);
  process.exit(1);
});

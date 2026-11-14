import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PublicadorAvisosEvaluacionTelemetriaRedis } from '../paquetes/agentes/src/PublicadorAvisosEvaluacionTelemetriaRedis.js';
import { RepositorioTrabajosEvaluacionTelemetria } from '../paquetes/agentes/src/RepositorioTrabajosEvaluacionTelemetria.js';
import { ServicioIngestaTelemetriaAgentes } from '../paquetes/agentes/src/ServicioIngestaTelemetriaAgentes.js';

const rutaMigracion = new URL(
  '../migraciones/sql/0001_esquema_inicial.sql',
  import.meta.url
);
const rutaServicio = new URL(
  '../paquetes/agentes/src/ServicioIngestaTelemetriaAgentes.js',
  import.meta.url
);

async function main() {
  await verificarEstructuraOutbox();
  await verificarRepositorioIdempotente();
  await verificarIntegracionAtomicaYRevisionHistorica();
  await verificarSenalSinReglas();
  await verificarFalloOutboxRevierteIngesta();
  await verificarRedisEsPosteriorYNoAutoritativo();
  verificarConfiguracionAtomicaObligatoria();

  console.log(
    '[agentes-telemetria] OK outbox e integración con ingesta verificadas hasta 5.20a.6'
  );
}

async function verificarEstructuraOutbox() {
  const [migracion, servicio] = await Promise.all([
    readFile(rutaMigracion, 'utf8').then(normalizarSqlConsolidado),
    readFile(rutaServicio, 'utf8')
  ]);

  for (const fragmento of [
    'CREATE TABLE IF NOT EXISTS trabajos_evaluacion_telemetria',
    "ENUM('pendiente', 'procesando', 'completado', 'error', 'neutralizado')",
    'UNIQUE KEY uk_trabajos_evaluacion_huella_causal (huella_causal_sha256)',
    'clave_causal_canonica',
    'siguiente_intento_utc',
    'ultimo_codigo_error',
    'ultimo_mensaje_error',
    'reclamado_en_utc',
    'completado_en_utc',
    'FOREIGN KEY (regla_id, regla_revision_id)',
    'FOREIGN KEY (observacion_id, agente_id, senal_id)',
    'ON DELETE CASCADE'
  ]) {
    assert.ok(migracion.includes(fragmento), `La migración debe contener: ${fragmento}`);
  }

  assert.ok(
    servicio.indexOf('await conexion.commit()') <
      servicio.indexOf('publicarAvisoEvaluacionSinAfectarIngesta'),
    'El aviso efímero debe quedar después del commit SQL.'
  );
  assert.equal(
    /periodos_vida_pol|ultimo_heartbeat|eventos_derivados_telemetria/i.test(
      extraerDefinicionTabla(migracion, 'trabajos_evaluacion_telemetria')
    ),
    false,
    'La outbox no debe modificar POL ni producir todavía eventos derivados.'
  );
}

async function verificarRepositorioIdempotente() {
  const clienteSql = new ClienteOutboxDirectoFalso();
  const repositorio = new RepositorioTrabajosEvaluacionTelemetria(clienteSql);
  const datos = crearDatosTrabajo();

  const primera = await repositorio.encolar(datos);
  const duplicada = await repositorio.encolar(datos);

  assert.equal(primera.creado, true);
  assert.equal(duplicada.creado, false);
  assert.equal(duplicada.trabajo.id, primera.trabajo.id);
  assert.equal(clienteSql.trabajos.length, 1);
  assert.equal(primera.trabajo.estado, 'pendiente');
  assert.equal(primera.trabajo.reglaRevisionId, 101);
  assert.equal(primera.trabajo.observacionId, 501);
}

async function verificarIntegracionAtomicaYRevisionHistorica() {
  const entorno = crearEntornoIngesta({ conRegla: true });
  const servicio = crearServicioDerivacion(entorno);
  const resultado = await servicio.ingestarLote(crearPeticionIngesta());

  assert.equal(entorno.base.observaciones.length, 1);
  assert.equal(entorno.base.fotografias.length, 1);
  assert.equal(entorno.base.trabajos.length, 1);
  assert.equal(entorno.base.trabajos[0].regla_revision_id, 101);
  assert.equal(
    entorno.base.trabajos[0].recibido_en_utc.toISOString(),
    '2026-07-10T10:00:00.000Z'
  );
  assert.deepEqual(entorno.base.eventos, []);

  const posicionTrabajo = entorno.orden.indexOf('insertar_trabajo');
  const posicionCommit = entorno.orden.indexOf('commit');
  const posicionAviso = entorno.orden.indexOf('redis_publish');
  assert.ok(posicionTrabajo > -1 && posicionTrabajo < posicionCommit);
  assert.ok(posicionAviso > posicionCommit);
  assert.equal(entorno.avisos.length, 1);
  assert.equal(
    entorno.avisos[0].canal,
    'sentinelia:prueba:telemetria:evaluacion:pendiente'
  );
  assert.deepEqual(entorno.avisos[0].contenido, {
    tipo: 'trabajos_evaluacion_telemetria_pendientes',
    totalTrabajos: 1,
    publicadoEnUtc: '2026-07-20T12:00:01.000Z'
  });

  const entornoBase = crearEntornoIngesta({ conRegla: false });
  const servicioBase = crearServicioBase(entornoBase);
  const resultadoBase = await servicioBase.ingestarLote(crearPeticionIngesta());
  assert.deepEqual(
    resultado,
    resultadoBase,
    'Crear trabajo durable no debe ampliar ni alterar la respuesta de ingesta.'
  );
  assert.equal('trabajosEvaluacion' in resultado.persistencia, false);
}

async function verificarSenalSinReglas() {
  const entorno = crearEntornoIngesta({ conRegla: false });
  const servicio = crearServicioDerivacion(entorno);
  const resultado = await servicio.ingestarLote(crearPeticionIngesta());

  assert.equal(resultado.persistencia.totalInsertadas, 1);
  assert.equal(entorno.base.trabajos.length, 0);
  assert.equal(entorno.avisos.length, 0);
  assert.equal(entorno.orden.includes('redis_publish'), false);
}

async function verificarFalloOutboxRevierteIngesta() {
  const entorno = crearEntornoIngesta({ conRegla: true, fallarOutbox: true });
  const servicio = crearServicioDerivacion(entorno);

  await assert.rejects(
    servicio.ingestarLote(crearPeticionIngesta()),
    /Fallo SQL simulado en outbox/
  );
  assert.equal(entorno.base.observaciones.length, 0);
  assert.equal(entorno.base.fotografias.length, 0);
  assert.equal(entorno.base.trabajos.length, 0);
  assert.equal(entorno.avisos.length, 0);
  assert.ok(entorno.orden.includes('rollback'));
  assert.equal(entorno.orden.includes('commit'), false);
}

async function verificarRedisEsPosteriorYNoAutoritativo() {
  const entorno = crearEntornoIngesta({
    conRegla: true,
    fallarRedis: true
  });
  const servicio = crearServicioDerivacion(entorno);
  const resultado = await servicio.ingestarLote(crearPeticionIngesta());

  assert.equal(resultado.resultado.ok, true);
  assert.equal(entorno.base.trabajos.length, 1);
  assert.ok(entorno.orden.indexOf('redis_publish') > entorno.orden.indexOf('commit'));
  assert.equal(entorno.base.trabajos[0].estado, 'pendiente');
}

function verificarConfiguracionAtomicaObligatoria() {
  assert.throws(
    () => new ServicioIngestaTelemetriaAgentes({
      repositorioCatalogoSenales: {},
      repositorioReglasDerivacion: {}
    }),
    /deben configurarse conjuntamente/
  );
}

function crearServicioDerivacion(entorno) {
  return new ServicioIngestaTelemetriaAgentes({
    repositorioCatalogoSenales: new RepositorioCatalogoFalso(entorno.clienteSql),
    repositorioObservaciones: new RepositorioObservacionesFalso(entorno.clienteSql),
    repositorioEstadoActual: new RepositorioEstadoActualFalso(entorno.clienteSql),
    repositorioReglasDerivacion: new RepositorioReglasFalso(entorno.clienteSql),
    repositorioTrabajosEvaluacion:
      new RepositorioTrabajosEvaluacionTelemetria(entorno.clienteSql),
    publicadorAvisosEvaluacion: entorno.publicador,
    generarRequestId: () => 'req_outbox_5_20a_6',
    reloj: () => new Date('2026-07-20T12:00:00Z')
  });
}

function crearServicioBase(entorno) {
  return new ServicioIngestaTelemetriaAgentes({
    repositorioCatalogoSenales: new RepositorioCatalogoFalso(entorno.clienteSql),
    repositorioObservaciones: new RepositorioObservacionesFalso(entorno.clienteSql),
    repositorioEstadoActual: new RepositorioEstadoActualFalso(entorno.clienteSql),
    generarRequestId: () => 'req_outbox_5_20a_6',
    reloj: () => new Date('2026-07-20T12:00:00Z')
  });
}

function crearPeticionIngesta() {
  return {
    agenteId: 7,
    recibidoEnUtc: '2026-07-10T10:00:00Z',
    periodoVidaPolId: 41,
    sesionIdDiagnostico: 'ags_outbox',
    sesionHuellaSha256: 'd'.repeat(64),
    lote: {
      emitidoEnUtc: '2026-07-10T09:59:59Z',
      observaciones: [
        {
          categoria: 'ambiente',
          clave: 'temperatura',
          tipoDato: 'numero',
          unidad: 'ºC',
          valorNumero: 84,
          observadoEnUtc: '2026-07-10T09:59:58Z'
        }
      ]
    }
  };
}

function crearEntornoIngesta({
  conRegla,
  fallarOutbox = false,
  fallarRedis = false
}) {
  const orden = [];
  const base = {
    observaciones: [],
    fotografias: [],
    trabajos: [],
    eventos: []
  };
  const conexion = new ConexionIngestaFalsa({
    base,
    orden,
    conRegla,
    fallarOutbox
  });
  const clienteSql = {
    obtenerConexion: async () => conexion
  };
  const avisos = [];
  const publicador = new PublicadorAvisosEvaluacionTelemetriaRedis({
    clienteRedis: {
      async publish(canal, contenido) {
        orden.push('redis_publish');
        avisos.push({ canal, contenido: JSON.parse(contenido) });
        if (fallarRedis) {
          throw new Error('Redis no disponible');
        }
        return 1;
      }
    },
    canal: 'sentinelia:prueba:telemetria:evaluacion:pendiente',
    reloj: () => new Date('2026-07-20T12:00:01Z')
  });

  return { base, orden, avisos, clienteSql, publicador };
}

class RepositorioCatalogoFalso {
  constructor(clienteSql) {
    this.clienteSql = clienteSql;
  }

  async buscarPorIdentidad() {
    return crearSenal();
  }

  async guardarDeclaracionSenal() {
    return crearSenal();
  }
}

class RepositorioObservacionesFalso {
  constructor(clienteSql) {
    this.clienteSql = clienteSql;
  }

  async insertarLoteAceptado({
    agenteId,
    observacionesAceptadas,
    observacionesRechazadas,
    recibidoEnUtc
  }) {
    const [resultado] = await this.clienteSql.ejecutar(
      'INSERT INTO observaciones_prueba',
      [agenteId, observacionesAceptadas[0], recibidoEnUtc]
    );
    const observacion = {
      id: resultado.insertId,
      agenteId,
      senalId: 23,
      ...observacionesAceptadas[0],
      recibidoEnUtc: new Date(recibidoEnUtc).toISOString(),
      serializar() {
        const { serializar: _serializar, ...datos } = this;
        return { ...datos };
      }
    };

    return {
      insertadas: [observacion],
      totalInsertadas: 1,
      rechazosIgnorados: observacionesRechazadas.length
    };
  }
}

class RepositorioEstadoActualFalso {
  constructor(clienteSql) {
    this.clienteSql = clienteSql;
  }

  async aplicarObservacionesHistoricas(observaciones) {
    await this.clienteSql.ejecutar('INSERT INTO fotografia_prueba', [observaciones[0]]);
    return {
      procesadas: 1,
      creadas: 1,
      actualizadas: 0,
      ignoradas: 0,
      fotografias: []
    };
  }
}

class RepositorioReglasFalso {
  constructor(clienteSql) {
    this.clienteSql = clienteSql;
  }

  async listarActivasPorSenalEn({ senalId, recibidoEnUtc }) {
    return this.clienteSql.consultar('SELECT reglas_aplicables_prueba', [
      senalId,
      new Date(recibidoEnUtc)
    ]);
  }
}

class ConexionIngestaFalsa {
  constructor({ base, orden, conRegla, fallarOutbox }) {
    this.base = base;
    this.orden = orden;
    this.conRegla = conRegla;
    this.fallarOutbox = fallarOutbox;
    this.pendientes = null;
  }

  async beginTransaction() {
    this.orden.push('begin');
    this.pendientes = { observaciones: [], fotografias: [], trabajos: [] };
  }

  async commit() {
    this.orden.push('commit');
    this.base.observaciones.push(...this.pendientes.observaciones);
    this.base.fotografias.push(...this.pendientes.fotografias);
    this.base.trabajos.push(...this.pendientes.trabajos);
    this.pendientes = null;
  }

  async rollback() {
    this.orden.push('rollback');
    this.pendientes = null;
  }

  release() {
    this.orden.push('release');
  }

  async execute(sql, parametros = []) {
    const sentencia = normalizarSql(sql);
    if (sentencia === 'INSERT INTO observaciones_prueba') {
      this.orden.push('insertar_observacion');
      const fila = { id: 501, agenteId: parametros[0] };
      this.pendientes.observaciones.push(fila);
      return [{ insertId: fila.id, affectedRows: 1 }];
    }
    if (sentencia === 'INSERT INTO fotografia_prueba') {
      this.orden.push('actualizar_fotografia');
      this.pendientes.fotografias.push({ observacionId: parametros[0].id });
      return [{ affectedRows: 1 }];
    }
    if (sentencia === 'SELECT reglas_aplicables_prueba') {
      this.orden.push('resolver_revision');
      return [this.resolverReglas(parametros[0], parametros[1])];
    }
    if (sentencia.startsWith('INSERT INTO trabajos_evaluacion_telemetria')) {
      this.orden.push('insertar_trabajo');
      if (this.fallarOutbox) {
        throw new Error('Fallo SQL simulado en outbox');
      }
      const fila = construirFilaTrabajo(parametros, 701);
      this.pendientes.trabajos.push(fila);
      return [{ insertId: fila.id, affectedRows: 1 }];
    }
    if (sentencia.includes('FROM trabajos_evaluacion_telemetria t')) {
      const porId = sentencia.includes('WHERE t.id = ?');
      const porHuella = sentencia.includes('WHERE t.huella_causal_sha256 = ?');
      const trabajos = [...this.base.trabajos, ...this.pendientes.trabajos];
      const fila = porId
        ? trabajos.find((trabajo) => trabajo.id === Number(parametros[0]))
        : porHuella
          ? trabajos.find((trabajo) => Buffer.from(trabajo.huella_causal_sha256)
            .equals(Buffer.from(parametros[0])))
          : trabajos.find(
            (trabajo) =>
              trabajo.regla_revision_id === Number(parametros[0]) &&
              trabajo.observacion_id === Number(parametros[1])
          );
      return [fila ? [fila] : []];
    }
    throw new Error(`SQL falso no contemplado: ${sentencia}`);
  }

  resolverReglas(senalId, recibidoEnUtc) {
    if (!this.conRegla || Number(senalId) !== 23) {
      return [];
    }
    const recibida = new Date(recibidoEnUtc).getTime();
    const corte = new Date('2026-07-15T00:00:00Z').getTime();
    const revision = recibida < corte
      ? crearRevision({
          id: 101,
          numero: 1,
          vigenteDesdeUtc: '2026-07-01T00:00:00Z',
          vigenteHastaUtc: '2026-07-15T00:00:00Z'
        })
      : crearRevision({
          id: 102,
          numero: 2,
          vigenteDesdeUtc: '2026-07-15T00:00:00Z'
        });
    return [{ regla: crearRegla(), revisionAplicable: revision }];
  }
}

class ClienteOutboxDirectoFalso {
  constructor() {
    this.trabajos = [];
  }

  async ejecutar(sql, parametros) {
    assert.ok(normalizarSql(sql).startsWith('INSERT INTO trabajos_evaluacion_telemetria'));
    const duplicado = this.trabajos.find(
      (trabajo) =>
        trabajo.regla_revision_id === parametros[2] &&
        trabajo.observacion_id === parametros[0]
    );
    if (duplicado) {
      const error = new Error('Duplicate entry');
      error.code = 'ER_DUP_ENTRY';
      throw error;
    }
    const fila = construirFilaTrabajo(parametros, this.trabajos.length + 1);
    this.trabajos.push(fila);
    return [{ insertId: fila.id, affectedRows: 1 }];
  }

  async consultar(sql, parametros) {
    const sentencia = normalizarSql(sql);
    const fila = sentencia.includes('WHERE t.id = ?')
      ? this.trabajos.find((trabajo) => trabajo.id === Number(parametros[0]))
      : sentencia.includes('WHERE t.huella_causal_sha256 = ?')
        ? this.trabajos.find((trabajo) => Buffer.from(trabajo.huella_causal_sha256)
          .equals(Buffer.from(parametros[0])))
      : this.trabajos.find(
          (trabajo) =>
            trabajo.regla_revision_id === Number(parametros[0]) &&
            trabajo.observacion_id === Number(parametros[1])
        );
    return fila ? [fila] : [];
  }
}

function crearDatosTrabajo() {
  return {
    observacion: {
      id: 501,
      agenteId: 7,
      senalId: 23,
      recibidoEnUtc: '2026-07-10T10:00:00Z'
    },
    regla: crearRegla(),
    revision: crearRevision({
      id: 101,
      numero: 1,
      vigenteDesdeUtc: '2026-07-01T00:00:00Z',
      vigenteHastaUtc: '2026-07-15T00:00:00Z'
    })
  };
}

function crearRegla() {
  return {
    id: 31,
    agenteId: 7,
    senalId: 23,
    tenantId: 1,
    empresaId: 2,
    sitioId: 3,
    revisionVigenteId: 102
  };
}

function crearRevision({ id, numero, vigenteDesdeUtc, vigenteHastaUtc = null }) {
  return {
    id,
    reglaId: 31,
    numero,
    vigenteDesdeUtc,
    vigenteHastaUtc
  };
}

function crearSenal() {
  return {
    id: 23,
    agenteId: 7,
    categoria: 'ambiente',
    clave: 'temperatura',
    tag: null,
    tipoDato: 'numero',
    unidad: 'ºC'
  };
}

function construirFilaTrabajo(parametros, id) {
  return {
    id,
    observacion_id: parametros[0],
    regla_id: parametros[1],
    regla_revision_id: parametros[2],
    agente_id: parametros[3],
    senal_id: parametros[4],
    tenant_id: parametros[5],
    empresa_id: parametros[6],
    sitio_id: parametros[7],
    causa: parametros[8],
    generacion_autoridad: parametros[9],
    generacion_correccion: parametros[10],
    recibido_en_utc: parametros[11],
    programado_para_utc: parametros[12],
    clave_causal_canonica: parametros[13],
    huella_causal_sha256: parametros[14],
    estado: 'pendiente',
    intentos: 0,
    siguiente_intento_utc: parametros[16],
    reclamado_por: null,
    reclamado_en_utc: null,
    reclamo_expira_en_utc: null,
    ultimo_codigo_error: null,
    ultimo_mensaje_error: null,
    motivo_neutralizacion: null,
    completado_en_utc: null,
    creado_en_utc: new Date('2026-07-20T12:00:00Z'),
    fecha_actualizacion: new Date('2026-07-20T12:00:00Z')
  };
}

function normalizarSql(sql) {
  return String(sql).replace(/\s+/g, ' ').trim();
}

main().catch((error) => {
  console.error('[agentes-telemetria] Error verificando outbox 5.20a.6');
  console.error(error);
  process.exit(1);
});

function normalizarSqlConsolidado(contenido) {
  return contenido
    .replaceAll('`', '')
    .replace(/^CREATE TABLE /gm, 'CREATE TABLE IF NOT EXISTS ')
    .replace(/,(?!\s)/g, ', ')
    .replace(/\benum\(/g, 'ENUM(')
    .replace(
      /ENUM\('pendiente','procesando','completado','error'\)/g,
      "ENUM('pendiente', 'procesando', 'completado', 'error')"
    );
}

function extraerDefinicionTabla(sql, tabla) {
  const inicio = sql.indexOf(`CREATE TABLE IF NOT EXISTS ${tabla}`);
  const fin = sql.indexOf(';', sql.indexOf('\n) ENGINE=', inicio));
  assert.notEqual(inicio, -1, `No se encontró la tabla ${tabla}.`);
  assert.notEqual(fin, -1, `No se encontró el final de la tabla ${tabla}.`);
  return sql.slice(inicio, fin + 1);
}

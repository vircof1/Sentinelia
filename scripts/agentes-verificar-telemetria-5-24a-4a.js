import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';

import { generarUuidV7Auditoria } from '../paquetes/auditoria/src/UuidV7Auditoria.js';
import {
  crearCondicionMomentoUtcRelativo
} from '../paquetes/agentes/src/EvaluadorMomentoUtcRelativoTelemetria.js';
import {
  ProcesadorObligacionesRelativasTelemetria
} from '../paquetes/agentes/src/ProcesadorObligacionesRelativasTelemetria.js';
import {
  RepositorioCatalogoSenalesTelemetriaAgentes
} from '../paquetes/agentes/src/RepositorioCatalogoSenalesTelemetriaAgentes.js';
import {
  RepositorioEstadoActualTelemetriaAgentes
} from '../paquetes/agentes/src/RepositorioEstadoActualTelemetriaAgentes.js';
import {
  RepositorioEstadoActualEvaluacionReglasTelemetria,
  RepositorioEvaluacionesReglasTelemetria,
  RepositorioEventosDerivadosTelemetria
} from '../paquetes/agentes/src/RepositorioEvaluacionesDerivadasTelemetria.js';
import {
  RepositorioIdempotenciaLotesTelemetriaAgentes
} from '../paquetes/agentes/src/RepositorioIdempotenciaLotesTelemetriaAgentes.js';
import {
  RepositorioObservacionesTelemetriaAgentes
} from '../paquetes/agentes/src/RepositorioObservacionesTelemetriaAgentes.js';
import {
  RepositorioReglasDerivacionTelemetria
} from '../paquetes/agentes/src/RepositorioReglasDerivacionTelemetria.js';
import {
  CAUSAS_TRABAJO_EVALUACION_TELEMETRIA,
  RepositorioTrabajosEvaluacionTelemetria
} from '../paquetes/agentes/src/RepositorioTrabajosEvaluacionTelemetria.js';
import {
  ServicioIngestaTelemetriaAgentes
} from '../paquetes/agentes/src/ServicioIngestaTelemetriaAgentes.js';
import { ClienteSql } from '../paquetes/persistencia-sql/src/ClienteSql.js';
import { EjecutorMigraciones } from '../paquetes/persistencia-sql/src/EjecutorMigraciones.js';
import { RepositorioMigraciones } from '../paquetes/persistencia-sql/src/RepositorioMigraciones.js';
import {
  obtenerConfiguracionAplicacion,
  obtenerRutaMigraciones
} from '../paquetes/utilidades/src/configuracion/obtenerConfiguracionAplicacion.js';

await main();

async function main() {
  const configuracion = obtenerConfiguracionAplicacion();
  assert.equal(configuracion.sql.estaCompleta, true, '5.24a.4a exige SQL real.');
  const baseDatos = `sentinelia_fixture_524a4a_${randomBytes(6).toString('hex')}`;
  const administrador = new ClienteSql(configuracion.sql);
  await administrador.ejecutar(
    `CREATE DATABASE ${administrador.escaparIdentificador(baseDatos)} ` +
    'CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci'
  );
  const sql = new ClienteSql({ ...configuracion.sql, baseDatos });
  try {
    await new EjecutorMigraciones({
      clienteSql: sql,
      repositorioMigraciones: new RepositorioMigraciones(sql),
      rutaMigraciones: obtenerRutaMigraciones()
    }).ejecutarPendientes();
    await sql.verificarUsoHorarioUtc();
    await verificarProductorDeIngesta(sql, await crearBase(sql));
  } finally {
    await sql.cerrar();
    await administrador.ejecutar(
      `DROP DATABASE IF EXISTS ${administrador.escaparIdentificador(baseDatos)}`
    ).catch(() => {});
    await administrador.cerrar();
  }
  console.log(
    '[agentes] OK 5.24a.4a: lote=ganador_final tardias=historia empate=id ' +
    'replay=idempotente autoridad=vigente vencimiento=cercado redis=postcommit'
  );
}

async function verificarProductorDeIngesta(sql, base) {
  const catalogo = new RepositorioCatalogoSenalesTelemetriaAgentes(sql);
  const senal = await catalogo.guardarDeclaracionSenal({
    agenteId: base.agenteId,
    definicion: {
      categoria: 'copias',
      clave: 'proxima_programada',
      tipoDato: 'momento_utc',
      nombreHumano: 'Próxima copia programada'
    }
  });
  const autoridades = await crearReglas(sql, base, senal);
  const publicaciones = [];
  const servicio = crearServicio(sql, publicaciones);
  const ahora = await ahoraSql(sql);
  const recibidoInicial = sumarSegundos(ahora, 1);
  const peticionInicial = peticion({
    base,
    telemetriaRequestId: generarUuidV7Auditoria(),
    huellaLoteSha256: randomBytes(32),
    recibidoEnUtc: recibidoInicial,
    observaciones: [
      lectura(senal, sumarSegundos(ahora, -30), sumarSegundos(ahora, 3600)),
      lectura(senal, sumarSegundos(ahora, -10), sumarSegundos(ahora, 7200)),
      lectura(senal, sumarSegundos(ahora, -20), sumarSegundos(ahora, 10800))
    ]
  });
  const inicial = await servicio.ingestarLote(peticionInicial);
  assert.equal(inicial.persistencia.totalInsertadas, 3);
  const trabajosIniciales = await trabajosDeReglas(sql, autoridades);
  const reactivosIniciales = trabajosIniciales.filter(
    (trabajo) => trabajo.regla_id === autoridades.absoluta.reglaId
  );
  const relativosIniciales = trabajosIniciales.filter(
    (trabajo) => trabajo.regla_id === autoridades.relativa.reglaId &&
      trabajo.causa === 'observacion'
  );
  assert.equal(reactivosIniciales.length, 3);
  assert.equal(relativosIniciales.length, 1);
  assert.equal(
    Number(relativosIniciales[0].observacion_id),
    Number(inicial.persistencia.fotografiaActual.fotografias.at(-1).ultimaObservacionId)
  );
  assert.equal(String(relativosIniciales[0].generacion_autoridad), '1');
  assert.equal(Number(relativosIniciales[0].regla_revision_id), autoridades.relativa.revisionId);

  const repositorioTrabajos = new RepositorioTrabajosEvaluacionTelemetria(sql);
  const vencimiento = await repositorioTrabajos.encolar({
    observacion: observacionTrabajo(inicial, relativosIniciales[0]),
    regla: reglaTrabajo(base, senal.id, autoridades.relativa, 1),
    revision: revisionTrabajo(autoridades.relativa, recibidoInicial),
    causa: CAUSAS_TRABAJO_EVALUACION_TELEMETRIA.VENCIMIENTO_TEMPORAL,
    programadoParaUtc: sumarSegundos(ahora, 3600)
  });

  const tardia = await servicio.ingestarLote(peticion({
    base,
    recibidoEnUtc: sumarSegundos(ahora, 2),
    observaciones: [
      lectura(senal, sumarSegundos(ahora, -40), sumarSegundos(ahora, 14400))
    ]
  }));
  assert.equal(tardia.persistencia.fotografiaActual.ignoradas, 1);
  assert.equal((await relativosObservacion(sql, autoridades.relativa.reglaId)).length, 1);
  assert.equal((await trabajosDeReglas(sql, autoridades)).filter(
    (trabajo) => trabajo.regla_id === autoridades.absoluta.reglaId
  ).length, 4);

  const requestEmpate = generarUuidV7Auditoria();
  const huellaEmpate = randomBytes(32);
  const instanteEmpate = sumarSegundos(ahora, 5);
  const peticionEmpate = peticion({
    base,
    telemetriaRequestId: requestEmpate,
    huellaLoteSha256: huellaEmpate,
    recibidoEnUtc: sumarSegundos(ahora, 6),
    observaciones: [
      lectura(senal, instanteEmpate, sumarSegundos(ahora, 18000)),
      lectura(senal, instanteEmpate, sumarSegundos(ahora, 21600))
    ]
  });
  const empate = await servicio.ingestarLote(peticionEmpate);
  const fotoEmpate = empate.persistencia.fotografiaActual.fotografias.at(-1);
  const observacionesEmpate = empate.persistencia.observaciones;
  assert.equal(Number(fotoEmpate.ultimaObservacionId), Number(observacionesEmpate[1].id));
  let relativos = await relativosObservacion(sql, autoridades.relativa.reglaId);
  assert.equal(relativos.length, 2);
  assert.equal(Number(relativos.at(-1).observacion_id), Number(observacionesEmpate[1].id));

  const replay = await servicio.ingestarLote(peticionEmpate);
  assert.equal(replay.idempotencia.replay, true);
  assert.equal((await relativosObservacion(sql, autoridades.relativa.reglaId)).length, 2);

  await cercarVencimientoSustituido(sql, vencimiento.trabajo);

  const nuevaRevision = await prepararEdicionBloqueada(
    sql,
    autoridades.relativa,
    crearCondicionMomentoUtcRelativo({
      forma: 'limite_inferior',
      limite: { direccion: 'pasado', segundos: '60' },
      histeresisSegundos: '5'
    }).obtenerCanonica()
  );
  const ingestaConcurrente = servicio.ingestarLote(peticion({
    base,
    recibidoEnUtc: sumarSegundos(ahora, 8),
    observaciones: [
      lectura(senal, sumarSegundos(ahora, 7), sumarSegundos(ahora, 25200))
    ]
  }));
  await nuevaRevision.confirmarEdicion();
  await ingestaConcurrente;
  relativos = await relativosObservacion(sql, autoridades.relativa.reglaId);
  assert.equal(String(relativos.at(-1).generacion_autoridad), '2');
  assert.equal(Number(relativos.at(-1).regla_revision_id), nuevaRevision.revisionId);
  assert.ok(publicaciones.length >= 2, 'Los publicadores postcommit debieron ejecutarse.');
  assert.ok(publicaciones.every((publicacion) => publicacion === 'despues_commit'));
}

function crearServicio(sql, publicaciones) {
  const marcarYFallar = async () => {
    const [fila] = await sql.consultar('SELECT 1 AS confirmado');
    assert.equal(Number(fila.confirmado), 1);
    publicaciones.push('despues_commit');
    throw new Error('redis_no_disponible_fixture');
  };
  return new ServicioIngestaTelemetriaAgentes({
    repositorioCatalogoSenales: new RepositorioCatalogoSenalesTelemetriaAgentes(sql),
    repositorioObservaciones: new RepositorioObservacionesTelemetriaAgentes(sql),
    repositorioEstadoActual: new RepositorioEstadoActualTelemetriaAgentes(sql),
    repositorioIdempotenciaLotes: new RepositorioIdempotenciaLotesTelemetriaAgentes(sql),
    repositorioReglasDerivacion: new RepositorioReglasDerivacionTelemetria(sql),
    repositorioTrabajosEvaluacion: new RepositorioTrabajosEvaluacionTelemetria(sql),
    publicadorAvisosEvaluacion: { publicarTrabajosPendientes: marcarYFallar },
    publicadorInvalidacionesMonitores: { publicarFotografiasActualizadas: marcarYFallar }
  });
}

async function crearReglas(sql, base, senal) {
  const desde = sumarSegundos(await ahoraSql(sql), -60);
  const relativaCanonica = crearCondicionMomentoUtcRelativo({
    forma: 'limite_superior',
    limite: { direccion: 'futuro', segundos: '3600' },
    histeresisSegundos: '30'
  }).obtenerCanonica();
  const absolutaCanonica = JSON.stringify({
    configuracion: { operador: '>', umbralUtc: '2027-01-01T00:00:00Z' },
    tipo: 'momento_utc',
    version: 1
  });
  return {
    relativa: await insertarRegla(sql, base, senal.id, relativaCanonica,
      'momento_utc_relativo', desde),
    absoluta: await insertarRegla(sql, base, senal.id, absolutaCanonica,
      'momento_utc', desde)
  };
}

async function insertarRegla(sql, base, senalId, canonica, tipo, desde) {
  const [regla] = await sql.ejecutar(
    `INSERT INTO reglas_derivacion_telemetria
       (agente_id,senal_id,tenant_id,empresa_id,sitio_id,estado,generacion_autoridad)
     VALUES (?,?,?,?,?,'activa',1)`,
    [base.agenteId, senalId, base.tenantId, base.empresaId, base.sitioId]
  );
  const [revision] = await sql.ejecutar(
    `INSERT INTO revisiones_reglas_derivacion_telemetria
       (regla_id,numero,condicion_tipo,condicion_version,condicion_canonica,
        severidad_calculada,mensaje_operativo,nombre,vigente_desde_utc)
     VALUES (?,1,?,1,?,'advertencia','Fixture 5.24a.4a','Fixture',?)`,
    [regla.insertId, tipo, canonica, new Date(desde)]
  );
  await sql.ejecutar(
    'UPDATE reglas_derivacion_telemetria SET revision_vigente_id=? WHERE id=?',
    [revision.insertId, regla.insertId]
  );
  return { reglaId: Number(regla.insertId), revisionId: Number(revision.insertId), desde };
}

async function prepararEdicionBloqueada(sql, autoridad, canonica) {
  const conexion = await sql.obtenerConexion();
  await conexion.beginTransaction();
  await conexion.execute(
    'SELECT id FROM reglas_derivacion_telemetria WHERE id=? FOR UPDATE',
    [autoridad.reglaId]
  );
  const desde = sumarSegundos(await ahoraSqlConexion(conexion), 1);
  await conexion.execute(
    'UPDATE revisiones_reglas_derivacion_telemetria SET vigente_hasta_utc=? WHERE id=?',
    [new Date(desde), autoridad.revisionId]
  );
  const [revision] = await conexion.execute(
    `INSERT INTO revisiones_reglas_derivacion_telemetria
       (regla_id,numero,condicion_tipo,condicion_version,condicion_canonica,
        severidad_calculada,mensaje_operativo,nombre,vigente_desde_utc)
     VALUES (?,2,'momento_utc_relativo',1,?,'advertencia',
       'Fixture editada','Fixture editada',?)`,
    [autoridad.reglaId, canonica, new Date(desde)]
  );
  await conexion.execute(
    `UPDATE reglas_derivacion_telemetria
        SET revision_vigente_id=?,generacion_autoridad=2 WHERE id=?`,
    [revision.insertId, autoridad.reglaId]
  );
  return {
    revisionId: Number(revision.insertId),
    async confirmarEdicion() {
      await new Promise((resolve) => setTimeout(resolve, 40));
      await conexion.commit();
      conexion.release();
    }
  };
}

async function cercarVencimientoSustituido(sql, trabajo) {
  const reclamador = `fixture-524a4a-${randomBytes(3).toString('hex')}`;
  await sql.ejecutar(
    `UPDATE trabajos_evaluacion_telemetria
        SET estado='procesando',intentos=intentos+1,reclamado_por=?,
            reclamado_en_utc=UTC_TIMESTAMP(6),
            reclamo_expira_en_utc=TIMESTAMPADD(MINUTE,1,UTC_TIMESTAMP(6))
      WHERE id=?`,
    [reclamador, trabajo.id]
  );
  const repositorioTrabajos = new RepositorioTrabajosEvaluacionTelemetria(sql);
  const resultado = await new ProcesadorObligacionesRelativasTelemetria({
    repositorioTrabajos,
    repositorioEvaluaciones: new RepositorioEvaluacionesReglasTelemetria(sql),
    repositorioEstadoActual:
      new RepositorioEstadoActualEvaluacionReglasTelemetria(sql),
    repositorioEventosDerivados: new RepositorioEventosDerivadosTelemetria(sql),
    capturadorFederacionTelemetria: {
      async capturarEvaluacionEnTransaccion() {
        throw new Error('Un vencimiento cercado no debe capturarse.');
      }
    }
  }).procesar({
    trabajo: await repositorioTrabajos.buscarPorId(trabajo.id),
    reclamadoPor: reclamador
  });
  assert.equal(resultado.neutralizada, true);
  assert.equal(resultado.motivoNeutralizacion, 'observacion_sustituida');
  const [fila] = await sql.consultar(
    'SELECT estado,motivo_neutralizacion FROM trabajos_evaluacion_telemetria WHERE id=?',
    [trabajo.id]
  );
  assert.deepEqual([fila.estado, fila.motivo_neutralizacion],
    ['neutralizado', 'observacion_sustituida']);
}

function peticion({
  base,
  observaciones,
  recibidoEnUtc,
  telemetriaRequestId = null,
  huellaLoteSha256 = null
}) {
  return {
    agenteId: base.agenteId,
    lote: { emitidoEnUtc: recibidoEnUtc, observaciones },
    recibidoEnUtc,
    telemetriaRequestId,
    huellaLoteSha256
  };
}

function lectura(senal, observadoEnUtc, valorMomentoUtc) {
  return {
    categoria: senal.categoria,
    clave: senal.clave,
    tipoDato: 'momento_utc',
    calidad: 'valida',
    observadoEnUtc,
    valorMomentoUtc
  };
}

function observacionTrabajo(resultado, fila) {
  const observacion = resultado.persistencia.observaciones.find(
    ({ id }) => Number(id) === Number(fila.observacion_id)
  );
  return observacion;
}

function reglaTrabajo(base, senalId, autoridad, generacionAutoridad) {
  return {
    id: autoridad.reglaId,
    agenteId: base.agenteId,
    senalId,
    tenantId: base.tenantId,
    empresaId: base.empresaId,
    sitioId: base.sitioId,
    generacionAutoridad
  };
}

function revisionTrabajo(autoridad, recibidoEnUtc) {
  return {
    id: autoridad.revisionId,
    reglaId: autoridad.reglaId,
    vigenteDesdeUtc: sumarSegundos(recibidoEnUtc, -120),
    vigenteHastaUtc: null
  };
}

async function trabajosDeReglas(sql, autoridades) {
  return sql.consultar(
    `SELECT id,regla_id,regla_revision_id,observacion_id,causa,generacion_autoridad
       FROM trabajos_evaluacion_telemetria
      WHERE regla_id IN (?,?) ORDER BY id`,
    [autoridades.relativa.reglaId, autoridades.absoluta.reglaId]
  );
}

async function relativosObservacion(sql, reglaId) {
  return sql.consultar(
    `SELECT id,regla_revision_id,observacion_id,generacion_autoridad
       FROM trabajos_evaluacion_telemetria
      WHERE regla_id=? AND causa='observacion' ORDER BY id`,
    [reglaId]
  );
}

async function crearBase(sql) {
  const alias = `fixture-524a4a-${randomBytes(4).toString('hex')}`;
  const [tenant] = await sql.ejecutar(
    'INSERT INTO tenants (nombre,alias) VALUES (?,?)', ['Tenant 5.24a.4a', alias]
  );
  const [empresa] = await sql.ejecutar(
    'INSERT INTO empresas (tenant_id,nombre,alias) VALUES (?,?,?)',
    [tenant.insertId, 'Empresa 5.24a.4a', alias]
  );
  const [sitio] = await sql.ejecutar(
    'INSERT INTO sitios (tenant_id,empresa_id,nombre,alias) VALUES (?,?,?,?)',
    [tenant.insertId, empresa.insertId, 'Sitio 5.24a.4a', alias]
  );
  const [agente] = await sql.ejecutar(
    `INSERT INTO agentes_sentinelia
       (guid,tenant_id,empresa_id,sitio_id,nombre,secreto_hash)
     VALUES (?,?,?,?,?,?)`,
    [randomUUID(), tenant.insertId, empresa.insertId, sitio.insertId,
      'Agente 5.24a.4a', 'hash-no-utilizable']
  );
  return {
    agenteId: Number(agente.insertId),
    tenantId: Number(tenant.insertId),
    empresaId: Number(empresa.insertId),
    sitioId: Number(sitio.insertId)
  };
}

async function ahoraSql(sql) {
  const [fila] = await sql.consultar('SELECT UTC_TIMESTAMP(0) AS ahora_utc');
  return fechaIso(fila.ahora_utc);
}

async function ahoraSqlConexion(conexion) {
  const [filas] = await conexion.execute('SELECT UTC_TIMESTAMP(0) AS ahora_utc');
  return fechaIso(filas[0].ahora_utc);
}

function sumarSegundos(valor, segundos) {
  return new Date(Date.parse(valor) + segundos * 1000)
    .toISOString()
    .replace('.000Z', 'Z');
}

function fechaIso(valor) {
  return new Date(valor).toISOString();
}

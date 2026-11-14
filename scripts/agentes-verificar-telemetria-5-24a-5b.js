import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';

import {
  crearLecturaTelemetriaAgenteConTiposInternos
} from '../paquetes/agentes/src/TelemetriaAgente.js';
import {
  RepositorioCatalogoSenalesTelemetriaAgentes
} from '../paquetes/agentes/src/RepositorioCatalogoSenalesTelemetriaAgentes.js';
import {
  RepositorioCorreccionesRelojTelemetria
} from '../paquetes/agentes/src/RepositorioCorreccionesRelojTelemetria.js';
import {
  RepositorioEstadoActualTelemetriaAgentes
} from '../paquetes/agentes/src/RepositorioEstadoActualTelemetriaAgentes.js';
import {
  RepositorioObservacionesTelemetriaAgentes
} from '../paquetes/agentes/src/RepositorioObservacionesTelemetriaAgentes.js';
import {
  RepositorioTrabajosEvaluacionTelemetria
} from '../paquetes/agentes/src/RepositorioTrabajosEvaluacionTelemetria.js';
import {
  RepositorioEstadoActualEvaluacionReglasTelemetria,
  RepositorioEvaluacionesReglasTelemetria,
  RepositorioEventosDerivadosTelemetria
} from '../paquetes/agentes/src/RepositorioEvaluacionesDerivadasTelemetria.js';
import {
  ProcesadorObligacionesRelativasTelemetria
} from '../paquetes/agentes/src/ProcesadorObligacionesRelativasTelemetria.js';
import { ClienteSql } from '../paquetes/persistencia-sql/src/ClienteSql.js';
import { EjecutorMigraciones } from '../paquetes/persistencia-sql/src/EjecutorMigraciones.js';
import { RepositorioMigraciones } from '../paquetes/persistencia-sql/src/RepositorioMigraciones.js';
import {
  CoordinadorRelojRelativoTelemetriaRuntime
} from '../apps/sentinelia-runtime/src/telemetria/CoordinadorRelojRelativoTelemetriaRuntime.js';
import {
  DespachadorEvaluacionesTelemetriaRuntime
} from '../apps/sentinelia-runtime/src/telemetria/DespachadorEvaluacionesTelemetriaRuntime.js';
import { DiagnosticoRuntime } from '../apps/sentinelia-runtime/src/DiagnosticoRuntime.js';
import {
  obtenerConfiguracionAplicacion,
  obtenerRutaMigraciones
} from '../paquetes/utilidades/src/configuracion/obtenerConfiguracionAplicacion.js';

await main();

async function main() {
  await verificarOrdenAntesDeReclamar();
  await verificarAvisoSalud();
  verificarProyeccionDiagnosticoRuntime();
  const configuracion = obtenerConfiguracionAplicacion();
  assert.equal(configuracion.sql.estaCompleta, true, '5.24a.5b exige SQL real.');
  const baseDatos = `sentinelia_fixture_524a5b_${randomBytes(6).toString('hex')}`;
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
    await verificarRecuperacionDurable(sql);
  } finally {
    await sql.cerrar();
    await administrador.ejecutar(
      `DROP DATABASE IF EXISTS ${administrador.escaparIdentificador(baseDatos)}`
    ).catch(() => {});
    await administrador.cerrar();
  }
  console.log(
    '[agentes] OK 5.24a.5b: deteccion=antes_de_claim arranque=reanudable ' +
    'correccion=idempotente reloj_adelante=sin_transicion n_menor_recibido=admitido ' +
    'salud=backlog_fronteras_reintentos_neutralizaciones avisos=sin_silencio'
  );
}

async function verificarOrdenAntesDeReclamar() {
  const orden = [];
  const despachador = new DespachadorEvaluacionesTelemetriaRuntime({
    repositorioTrabajos: {
      async reclamarSiguientes() { orden.push('reclamar'); return []; }
    },
    procesadorTrabajos: {},
    prepararAntesDeReclamar: async () => {
      orden.push('observar_y_reconciliar');
      return { diagnostico: { trabajosRelativosPendientes: 0 } };
    },
    instanciaId: 'fixture-runtime'
  });
  const resultado = await despachador.procesarPendientes({ origen: 'fixture' });
  assert.deepEqual(orden, ['observar_y_reconciliar', 'reclamar']);
  assert.ok(resultado.preparacion, 'El resumen debe publicar la preparación previa.');
}

async function verificarAvisoSalud() {
  const llamadas = [];
  const diagnosticos = [{
    observadoEnUtc: '2026-09-05T10:00:00.000Z', fronterasNoEvaluadas: 2,
    trabajosRelativosVencidos: 3, retrasoMaximoSegundos: 61
  }, {
    observadoEnUtc: '2026-09-05T10:01:02.000Z', fronterasNoEvaluadas: 0,
    trabajosRelativosVencidos: 0, retrasoMaximoSegundos: 0
  }];
  const coordinador = new CoordinadorRelojRelativoTelemetriaRuntime({
    repositorioCorrecciones: {
      async observarReloj() { return { clasificacion: 'avance' }; },
      async procesarSiguienteLote() { return null; },
      async obtenerDiagnostico() { return diagnosticos.shift(); }
    },
    repositorioTrabajos: { async encolarAutoridadActualEnTransaccion() {} },
    servicioAvisos: {
      async detectar(entrada) { llamadas.push(['detectar', entrada]); return {}; },
      async resolver(entrada) { llamadas.push(['resolver', entrada]); return {}; }
    },
    instanciaId: 'fixture-runtime',
    umbralAvisoRetrasoSegundos: 60,
    generarEventoId: () => randomUUID().replace(/^(.{14})./, '$17')
  });
  await coordinador.procesarAntesDeReclamar();
  await coordinador.procesarAntesDeReclamar();
  assert.deepEqual(llamadas.map(([tipo]) => tipo), ['detectar', 'resolver']);
  assert.equal(llamadas[0][1].contextoHumano.fronterasNoEvaluadas, 2);
  assert.equal(llamadas[1][1].viaResolucion, 'causa_desaparecida');
}

function verificarProyeccionDiagnosticoRuntime() {
  const diagnostico = new DiagnosticoRuntime({
    runtime: {
      instanciaId: 'fixture-runtime',
      configuracion: { entorno: 'test', sql: { estaCompleta: true } },
      iniciadoEn: '2026-09-05T10:00:00.000Z',
      contexto: {
        relojRelativoTelemetria: {
          observacionReloj: { clasificacion: 'retroceso' },
          totalLotes: 2,
          trabajosCreados: 3,
          diagnostico: {
            observadoEnUtc: '2026-09-05T10:00:00.000Z',
            generacionCorreccion: '7', correccionesTotales: 7,
            correccionesPendientes: 1, trabajosRelativosPendientes: 4,
            trabajosRelativosVencidos: 2, retrasoMaximoSegundos: 61,
            trabajosRelativosNeutralizados: 5,
            trabajosRelativosReintentados: 1, totalReintentosRelativos: 2,
            leasesRelativosVencidos: 1, fronterasNoEvaluadas: 2
          }
        }
      }
    }
  }).construir();
  assert.deepEqual([
    diagnostico.telemetriaRelativa.ultimaClasificacionReloj,
    diagnostico.telemetriaRelativa.generacionCorreccion,
    diagnostico.telemetriaRelativa.fronterasNoEvaluadas,
    diagnostico.telemetriaRelativa.trabajosCreadosUltimoCiclo
  ], ['retroceso', '7', 2, 3]);
}

async function verificarRecuperacionDurable(sql) {
  const base = await crearBase(sql);
  const fuentes = [];
  for (const clave of ['primera', 'segunda']) {
    fuentes.push(await crearSenalConFotografia(sql, base, clave));
  }
  const reglas = [];
  for (const fuente of fuentes) {
    reglas.push(await crearReglaRelativa(sql, base, fuente.senal.id));
  }
  const ahora = await ahoraSql(sql);
  const inicial = new RepositorioCorreccionesRelojTelemetria(sql, {
    lectorRelojSql: async () => ahora
  });
  assert.equal((await inicial.observarReloj()).clasificacion, 'inicializado');
  const corregido = restarSegundos(ahora, 2);
  const crearCoordinador = () => new CoordinadorRelojRelativoTelemetriaRuntime({
    repositorioCorrecciones: new RepositorioCorreccionesRelojTelemetria(sql, {
      lectorRelojSql: async () => corregido
    }),
    repositorioTrabajos: new RepositorioTrabajosEvaluacionTelemetria(sql),
    instanciaId: 'fixture-runtime', limiteLote: 1, maximoLotesPorCiclo: 1
  });

  const primerArranque = await crearCoordinador().procesarAntesDeReclamar({
    origen: 'arranque'
  });
  assert.equal(primerArranque.observacionReloj.clasificacion, 'retroceso');
  assert.deepEqual([primerArranque.totalLotes, primerArranque.trabajosCreados], [1, 1]);
  assert.equal(primerArranque.diagnostico.correccionesPendientes, 1);

  const segundoArranque = await crearCoordinador().procesarAntesDeReclamar({
    origen: 'arranque_reemplazo'
  });
  assert.equal(segundoArranque.observacionReloj.clasificacion, 'repeticion');
  assert.deepEqual([segundoArranque.totalLotes, segundoArranque.trabajosCreados], [1, 1]);
  assert.equal(segundoArranque.diagnostico.correccionesPendientes, 0);

  let trabajos = await sql.consultar(
    `SELECT causa,clave_causal_canonica,recibido_en_utc
       FROM trabajos_evaluacion_telemetria ORDER BY regla_id`
  );
  assert.equal(trabajos.length, 2);
  assert.ok(trabajos.every((trabajo) =>
    trabajo.causa === 'reconciliacion_reloj' &&
    trabajo.clave_causal_canonica.endsWith('|correccion=1')));
  assert.ok(trabajos.every((trabajo) => new Date(corregido) < trabajo.recibido_en_utc),
    'La corrección debe conservar evidencia cuando N precede a la recepción.');

  await sql.ejecutar(
    `UPDATE reconciliaciones_reloj_relativo_telemetria
        SET estado='pendiente',cursor_regla_id=0,reglas_procesadas=0,
            completada_en_utc=NULL WHERE generacion_correccion=1`
  );
  const repeticionBarrido = await new CoordinadorRelojRelativoTelemetriaRuntime({
    repositorioCorrecciones: new RepositorioCorreccionesRelojTelemetria(sql, {
      lectorRelojSql: async () => corregido
    }),
    repositorioTrabajos: new RepositorioTrabajosEvaluacionTelemetria(sql),
    instanciaId: 'fixture-runtime', limiteLote: 10, maximoLotesPorCiclo: 2
  }).procesarAntesDeReclamar({ origen: 'repeticion_barrido' });
  assert.deepEqual(
    [repeticionBarrido.trabajosCreados, repeticionBarrido.trabajosExistentes],
    [0, 2]
  );
  trabajos = await sql.consultar('SELECT id FROM trabajos_evaluacion_telemetria');
  assert.equal(trabajos.length, 2, 'La generación causal debe converger en las mismas filas.');

  const avance = await new RepositorioCorreccionesRelojTelemetria(sql, {
    lectorRelojSql: async () => sumarSegundos(ahora, 30)
  }).observarReloj();
  assert.equal(avance.clasificacion, 'avance');
  assert.equal((await inicial.listarReconciliaciones()).length, 1,
    'Un salto hacia delante no inventa una transición ni una corrección.');

  await sql.ejecutar(
    `UPDATE trabajos_evaluacion_telemetria
        SET estado='error',intentos=3,siguiente_intento_utc=TIMESTAMPADD(SECOND,-20,UTC_TIMESTAMP(6)),
            ultimo_codigo_error='fixture',ultimo_mensaje_error='fixture'
      WHERE regla_id=?`,
    [reglas[0].id]
  );
  await sql.ejecutar(
    `UPDATE trabajos_evaluacion_telemetria
        SET estado='neutralizado',motivo_neutralizacion='observacion_sustituida',
            completado_en_utc=UTC_TIMESTAMP(6)
      WHERE regla_id=?`,
    [reglas[1].id]
  );
  await insertarFronteraVencida(sql, base, fuentes[0], reglas[0]);
  const diagnostico = await inicial.obtenerDiagnostico();
  assert.deepEqual([
    diagnostico.trabajosRelativosPendientes,
    diagnostico.trabajosRelativosVencidos,
    diagnostico.trabajosRelativosNeutralizados,
    diagnostico.trabajosRelativosReintentados,
    diagnostico.totalReintentosRelativos,
    diagnostico.fronterasNoEvaluadas,
    diagnostico.correccionesTotales
  ], [1, 1, 1, 1, 2, 1, 1]);
  assert.ok(diagnostico.retrasoMaximoSegundos >= 29,
    'El retraso incluye una frontera sin trabajo, no sólo el backlog existente.');

  const repositorioTrabajos = new RepositorioTrabajosEvaluacionTelemetria(sql);
  const [reclamado] = await repositorioTrabajos.reclamarSiguientes({
    reclamadoPor: 'fixture-5.24a.5b', limite: 1, ttlSegundos: 30
  });
  assert.equal(reclamado.generacionCorreccion, '1');
  const resultado = await new ProcesadorObligacionesRelativasTelemetria({
    repositorioTrabajos,
    repositorioEvaluaciones: new RepositorioEvaluacionesReglasTelemetria(sql),
    repositorioEstadoActual:
      new RepositorioEstadoActualEvaluacionReglasTelemetria(sql),
    repositorioEventosDerivados: new RepositorioEventosDerivadosTelemetria(sql),
    capturadorFederacionTelemetria: {
      async capturarEvaluacionEnTransaccion() { return { capturada: true }; }
    }
  }).procesar({ trabajo: reclamado, reclamadoPor: 'fixture-5.24a.5b' });
  assert.equal(resultado.ok, true);
  assert.equal(
    resultado.evaluacion.evidenciaContextual.temporal.correccionReloj
      .generacionCorreccion,
    '1'
  );
  assert.ok(Date.parse(resultado.evaluacion.evaluadoEnUtc) <
    Date.parse(resultado.evaluacion.recibidoEnUtc),
  'Una evaluación corregida debe admitir que N preceda a la recepción durable.');
}

async function insertarFronteraVencida(sql, base, fuente, regla) {
  await sql.ejecutar(
    `INSERT INTO estado_actual_evaluacion_reglas_telemetria
       (regla_id,regla_revision_id,observacion_id,agente_id,senal_id,
        tenant_id,empresa_id,sitio_id,generacion_autoridad,causalidad_revision,
        resultado,lado_atencion,codigo_motivo,explicacion,condicion_canonica,
        valor_evaluado,tipo_dato,calidad,mensaje_operativo,observado_en_utc,
        recibido_en_utc,evaluado_en_utc,proxima_reevaluacion_utc)
     VALUES (?,?,?,?,?,?,?,?,1,'autoridad_actual','no_coincide',NULL,
       'fixture','Fixture',?,?,'momento_utc','valida','Fixture',?,?,?,
       TIMESTAMPADD(SECOND,-30,UTC_TIMESTAMP(6)))`,
    [regla.id, regla.revisionId, fuente.observacion.id, base.id, fuente.senal.id,
      base.tenantId, base.empresaId, base.sitioId,
      JSON.stringify({ tipo: 'momento_utc_relativo' }),
      JSON.stringify({ valorMomentoUtc: fuente.observacion.valorMomentoUtc }),
      new Date(fuente.observacion.observadoEnUtc),
      new Date(fuente.observacion.recibidoEnUtc), new Date()]
  );
}

async function crearSenalConFotografia(sql, base, clave) {
  const senal = await new RepositorioCatalogoSenalesTelemetriaAgentes(sql)
    .guardarDeclaracionSenal({
      agenteId: base.id,
      definicion: { categoria: 'reloj', clave, tipoDato: 'momento_utc', nombreHumano: clave }
    });
  const recibidoEnUtc = sumarSegundos(await ahoraSql(sql), 30);
  const lote = await new RepositorioObservacionesTelemetriaAgentes(sql)
    .insertarLoteAceptado({
      agenteId: base.id, senalesCatalogadas: [senal], recibidoEnUtc,
      observacionesAceptadas: [crearLecturaTelemetriaAgenteConTiposInternos({
        categoria: senal.categoria, clave: senal.clave, tipoDato: 'momento_utc',
        valorMomentoUtc: sumarSegundos(recibidoEnUtc, 3600), calidad: 'valida',
        observadoEnUtc: recibidoEnUtc
      })]
    });
  await new RepositorioEstadoActualTelemetriaAgentes(sql)
    .aplicarObservacionesHistoricas(lote.insertadas);
  return { senal, observacion: lote.insertadas[0] };
}

async function crearReglaRelativa(sql, base, senalId) {
  const [regla] = await sql.ejecutar(
    `INSERT INTO reglas_derivacion_telemetria
       (agente_id,senal_id,tenant_id,empresa_id,sitio_id,estado)
     VALUES (?,?,?,?,?,'activa')`,
    [base.id, senalId, base.tenantId, base.empresaId, base.sitioId]
  );
  const [revision] = await sql.ejecutar(
    `INSERT INTO revisiones_reglas_derivacion_telemetria
       (regla_id,numero,condicion_tipo,condicion_version,condicion_canonica,
        severidad_calculada,mensaje_operativo,nombre,vigente_desde_utc)
     VALUES (?,1,'momento_utc_relativo',1,?,'advertencia','Fixture','Fixture',
       UTC_TIMESTAMP(6))`,
    [regla.insertId,
      '{"configuracion":{"forma":"limite_superior","histeresisSegundos":"0",' +
      '"limite":{"direccion":"futuro","segundos":"10"}},' +
      '"tipo":"momento_utc_relativo","version":1}']
  );
  await sql.ejecutar(
    'UPDATE reglas_derivacion_telemetria SET revision_vigente_id=? WHERE id=?',
    [revision.insertId, regla.insertId]
  );
  return { id: Number(regla.insertId), revisionId: Number(revision.insertId) };
}

async function crearBase(sql) {
  const alias = `fixture-524a5b-${randomBytes(4).toString('hex')}`;
  const [tenant] = await sql.ejecutar(
    'INSERT INTO tenants (nombre,alias) VALUES (?,?)', ['Tenant 5.24a.5b', alias]
  );
  const [empresa] = await sql.ejecutar(
    'INSERT INTO empresas (tenant_id,nombre,alias) VALUES (?,?,?)',
    [tenant.insertId, 'Empresa 5.24a.5b', alias]
  );
  const [sitio] = await sql.ejecutar(
    'INSERT INTO sitios (tenant_id,empresa_id,nombre,alias) VALUES (?,?,?,?)',
    [tenant.insertId, empresa.insertId, 'Sitio 5.24a.5b', alias]
  );
  const [agente] = await sql.ejecutar(
    `INSERT INTO agentes_sentinelia
       (guid,tenant_id,empresa_id,sitio_id,nombre,secreto_hash)
     VALUES (?,?,?,?,?,?)`,
    [randomUUID(), tenant.insertId, empresa.insertId, sitio.insertId,
      'Agente 5.24a.5b', 'hash-no-utilizable']
  );
  return {
    id: Number(agente.insertId), tenantId: Number(tenant.insertId),
    empresaId: Number(empresa.insertId), sitioId: Number(sitio.insertId)
  };
}

async function ahoraSql(sql) {
  const [fila] = await sql.consultar('SELECT UTC_TIMESTAMP(0) AS ahora_utc');
  return isoSegundo(fila.ahora_utc);
}

function sumarSegundos(valor, segundos) {
  return isoSegundo(Date.parse(valor) + segundos * 1000);
}

function restarSegundos(valor, segundos) {
  return sumarSegundos(valor, -segundos);
}

function isoSegundo(valor) {
  return new Date(valor).toISOString().replace('.000Z', 'Z');
}

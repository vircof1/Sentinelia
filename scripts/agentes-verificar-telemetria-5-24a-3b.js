import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';

import {
  DespachadorEvaluacionesTelemetriaRuntime
} from '../apps/sentinelia-runtime/src/telemetria/DespachadorEvaluacionesTelemetriaRuntime.js';
import {
  crearLecturaTelemetriaAgenteConTiposInternos
} from '../paquetes/agentes/src/TelemetriaAgente.js';
import {
  crearCondicionMomentoUtcRelativo
} from '../paquetes/agentes/src/EvaluadorMomentoUtcRelativoTelemetria.js';
import {
  ProcesadorObligacionesRelativasTelemetria
} from '../paquetes/agentes/src/ProcesadorObligacionesRelativasTelemetria.js';
import {
  ProcesadorTrabajosEvaluacionTelemetriaEnrutado
} from '../paquetes/agentes/src/ProcesadorTrabajosEvaluacionTelemetriaEnrutado.js';
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
  RepositorioObservacionesTelemetriaAgentes
} from '../paquetes/agentes/src/RepositorioObservacionesTelemetriaAgentes.js';
import {
  CAUSAS_TRABAJO_EVALUACION_TELEMETRIA,
  RepositorioTrabajosEvaluacionTelemetria
} from '../paquetes/agentes/src/RepositorioTrabajosEvaluacionTelemetria.js';
import { ClienteSql } from '../paquetes/persistencia-sql/src/ClienteSql.js';
import {
  obtenerConfiguracionAplicacion
} from '../paquetes/utilidades/src/configuracion/obtenerConfiguracionAplicacion.js';
import { migrar } from './federacion-verificar-5-22-15g.js';

await main();

async function main() {
  const configuracion = obtenerConfiguracionAplicacion();
  assert.equal(configuracion.sql.estaCompleta, true, '5.24a.3b necesita MariaDB real.');
  const administrador = new ClienteSql(configuracion.sql);
  const nombre = `sentinelia_fixture_524a3b_${randomBytes(5).toString('hex')}`;
  let sql;
  try {
    await administrador.ejecutar(
      `CREATE DATABASE ${administrador.escaparIdentificador(nombre)} ` +
      'CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci'
    );
    sql = new ClienteSql({ ...configuracion.sql, baseDatos: nombre });
    await migrar(sql);
    await sql.verificarUsoHorarioUtc();
    const base = await crearBase(sql);
    await verificarEnrutadoExplicito();
    await verificarCompetenciaEInvalidacionPostcommit(sql, base, configuracion);
    await verificarBackoffRelativo(sql, base, configuracion);
    await verificarSinInvalidacionPorEvidenciaSola();
    console.log(
      '[agentes] OK 5.24a.3b: claim=comun ruta=explicita runtimes=2 ' +
      'fencing=propietario evaluacion_evento=unicos backoff=durable ' +
      'invalidacion=postcommit_y_solo_transicion catalogo=publico_cerrado'
    );
  } finally {
    await sql?.cerrar().catch(() => {});
    await administrador.ejecutar(
      `DROP DATABASE IF EXISTS ${administrador.escaparIdentificador(nombre)}`
    ).catch(() => {});
    await administrador.cerrar();
  }
}

async function verificarEnrutadoExplicito() {
  const llamadas = [];
  const enrutador = new ProcesadorTrabajosEvaluacionTelemetriaEnrutado({
    procesadorReactivo: {
      async procesar() { llamadas.push('reactivo'); return { ok: true }; }
    },
    procesadorRelativo: {
      async procesar() { llamadas.push('relativo'); return { ok: true }; }
    },
    repositorioTrabajos: { async registrarErrorTecnico() { return true; } }
  });
  assert.equal((await enrutador.procesar({
    trabajo: { condicionTipoRevision: 'numero' }
  })).recorridoEvaluacion, 'reactivo');
  assert.equal((await enrutador.procesar({
    trabajo: { condicionTipoRevision: 'momento_utc_relativo' }
  })).recorridoEvaluacion, 'relativo');
  assert.deepEqual(llamadas, ['reactivo', 'relativo']);
}

async function verificarCompetenciaEInvalidacionPostcommit(sql, base, configuracion) {
  const agregado = await crearAgregado(sql, base, 'competencia');
  const trabajos = new RepositorioTrabajosEvaluacionTelemetria(sql);
  const llamadasReactivas = [];
  const publicaciones = [];
  const publicador = {
    async publicarEstadosReglasActualizados({ estados }) {
      const [fila] = await sql.consultar(
        `SELECT
           (SELECT COUNT(*) FROM evaluaciones_reglas_telemetria WHERE trabajo_id=?) evaluaciones,
           (SELECT COUNT(*) FROM eventos_derivados_telemetria WHERE regla_id=?) eventos,
           (SELECT estado FROM trabajos_evaluacion_telemetria WHERE id=?) estado`,
        [agregado.trabajoId, agregado.reglaId, agregado.trabajoId]
      );
      assert.deepEqual(
        [Number(fila.evaluaciones), Number(fila.eventos), fila.estado],
        [1, 1, 'completado']
      );
      publicaciones.push(estados);
      return { publicado: true, totalReglas: estados.length };
    }
  };
  const crearDespachador = (instanciaId) => new DespachadorEvaluacionesTelemetriaRuntime({
    repositorioTrabajos: trabajos,
    procesadorTrabajos: crearEnrutadorReal({
      sql,
      trabajos,
      llamadasReactivas,
      configuracion
    }),
    publicadorInvalidacionesMonitores: publicador,
    instanciaId,
    loteMaximo: 10,
    reclamoTtlSegundos: 30
  });
  const resultados = await Promise.all([
    crearDespachador('runtime-a').procesarPendientes({ origen: 'prueba', numeroTick: 1 }),
    crearDespachador('runtime-b').procesarPendientes({ origen: 'prueba', numeroTick: 1 })
  ]);
  assert.equal(resultados.reduce((total, item) => total + item.totalReclamados, 0), 1);
  assert.equal(resultados.reduce((total, item) => total + item.totalCompletados, 0), 1);
  assert.equal(llamadasReactivas.length, 0);
  assert.equal(publicaciones.length, 1);
  assert.equal(publicaciones[0][0].resultado, 'coincide');
  const [conteo] = await sql.consultar(
    `SELECT
       (SELECT COUNT(*) FROM evaluaciones_reglas_telemetria WHERE trabajo_id=?) evaluaciones,
       (SELECT COUNT(*) FROM eventos_derivados_telemetria WHERE regla_id=?) eventos,
       (SELECT COUNT(*) FROM trabajos_evaluacion_telemetria WHERE regla_id=? AND id<>?) siguientes`,
    [agregado.trabajoId, agregado.reglaId, agregado.reglaId, agregado.trabajoId]
  );
  assert.deepEqual(
    [conteo.evaluaciones, conteo.eventos, conteo.siguientes].map(Number),
    [1, 1, 1]
  );
}

async function verificarBackoffRelativo(sql, base, configuracion) {
  const agregado = await crearAgregado(sql, base, 'backoff');
  const trabajos = new RepositorioTrabajosEvaluacionTelemetria(sql);
  const enrutador = crearEnrutadorReal({
    sql,
    trabajos,
    configuracion,
    capturador: {
      async capturarEvaluacionEnTransaccion() {
        throw new Error('captura_temporalmente_no_disponible');
      }
    }
  });
  const resumen = await new DespachadorEvaluacionesTelemetriaRuntime({
    repositorioTrabajos: trabajos,
    procesadorTrabajos: enrutador,
    instanciaId: 'runtime-backoff',
    loteMaximo: 1,
    reclamoTtlSegundos: 30
  }).procesarPendientes({ origen: 'prueba', numeroTick: 2 });
  assert.equal(resumen.totalReclamados, 1);
  assert.equal(resumen.totalErrores, 1);
  assert.equal(resumen.procesados[0].errorRegistrado, true);
  assert.equal(resumen.procesados[0].demoraReintentoSegundos,
    configuracion.runtime.telemetriaEvaluacionReintentoBaseSegundos);
  const trabajo = await trabajos.buscarPorId(agregado.trabajoId);
  assert.equal(trabajo.estado, 'error');
  assert.match(trabajo.ultimoMensajeError, /captura_temporalmente_no_disponible/u);
  const [fila] = await sql.consultar(
    'SELECT COUNT(*) total FROM evaluaciones_reglas_telemetria WHERE trabajo_id=?',
    [agregado.trabajoId]
  );
  assert.equal(Number(fila.total), 0);
}

async function verificarSinInvalidacionPorEvidenciaSola() {
  let publicaciones = 0;
  const despachador = new DespachadorEvaluacionesTelemetriaRuntime({
    repositorioTrabajos: {
      async reclamarSiguientes() {
        return [{ id: 1, intentos: 1 }];
      }
    },
    procesadorTrabajos: {
      async procesar() {
        return {
          ok: true,
          trabajoId: 1,
          resultado: { resultado: 'coincide' },
          persistencia: {
            estadoActualizado: true,
            gobiernaEstadoActual: true,
            cambioEstadoMonitor: false,
            estadoActual: { reglaId: 1, revisionId: 1, observacionId: 1 }
          }
        };
      }
    },
    publicadorInvalidacionesMonitores: {
      async publicarEstadosReglasActualizados() { publicaciones += 1; }
    },
    instanciaId: 'runtime-evidencia'
  });
  const resumen = await despachador.procesarPendientes({ origen: 'prueba' });
  assert.equal(publicaciones, 0);
  assert.equal(resumen.invalidacionMonitores.motivo, 'sin_estados_actualizados');
}

function crearEnrutadorReal({
  sql,
  trabajos,
  configuracion,
  llamadasReactivas = [],
  capturador = { async capturarEvaluacionEnTransaccion() {} }
}) {
  const relativo = new ProcesadorObligacionesRelativasTelemetria({
    repositorioTrabajos: trabajos,
    repositorioEvaluaciones: new RepositorioEvaluacionesReglasTelemetria(sql),
    repositorioEstadoActual:
      new RepositorioEstadoActualEvaluacionReglasTelemetria(sql),
    repositorioEventosDerivados: new RepositorioEventosDerivadosTelemetria(sql),
    capturadorFederacionTelemetria: capturador
  });
  return new ProcesadorTrabajosEvaluacionTelemetriaEnrutado({
    procesadorReactivo: {
      async procesar() {
        llamadasReactivas.push(true);
        throw new Error('El fixture no esperaba el recorrido reactivo.');
      }
    },
    procesadorRelativo: relativo,
    repositorioTrabajos: trabajos,
    reintentoBaseSegundos:
      configuracion.runtime.telemetriaEvaluacionReintentoBaseSegundos,
    reintentoMaximoSegundos:
      configuracion.runtime.telemetriaEvaluacionReintentoMaximoSegundos
  });
}

async function crearAgregado(sql, base, sufijo) {
  const ahora = await ahoraSql(sql);
  const momento = new Date(ahora.getTime() + 3600_000);
  const senal = await new RepositorioCatalogoSenalesTelemetriaAgentes(sql)
    .guardarDeclaracionSenal({
      agenteId: base.agenteId,
      definicion: {
        categoria: 'fixture-524a3b',
        clave: `${sufijo}-${randomBytes(3).toString('hex')}`,
        tipoDato: 'momento_utc',
        nombreHumano: `Momento ${sufijo}`
      }
    });
  const observacion = (await new RepositorioObservacionesTelemetriaAgentes(sql)
    .insertarLoteAceptado({
      agenteId: base.agenteId,
      senalesCatalogadas: [senal],
      recibidoEnUtc: isoSegundos(ahora),
      observacionesAceptadas: [crearLecturaTelemetriaAgenteConTiposInternos({
        categoria: senal.categoria,
        clave: senal.clave,
        tipoDato: 'momento_utc',
        valorMomentoUtc: isoSegundos(momento),
        calidad: 'valida',
        observadoEnUtc: isoSegundos(ahora)
      })]
    })).insertadas[0];
  await new RepositorioEstadoActualTelemetriaAgentes(sql)
    .aplicarObservacionesHistoricas([observacion]);
  const condicion = crearCondicionMomentoUtcRelativo({
    forma: 'limite_superior',
    limite: { direccion: 'futuro', segundos: '60' },
    histeresisSegundos: '10'
  });
  const [regla] = await sql.ejecutar(
    `INSERT INTO reglas_derivacion_telemetria
       (agente_id,senal_id,tenant_id,empresa_id,sitio_id,estado,generacion_autoridad)
     VALUES (?,?,?,?,?,'activa',1)`,
    [base.agenteId, senal.id, base.tenantId, base.empresaId, base.sitioId]
  );
  const [revision] = await sql.ejecutar(
    `INSERT INTO revisiones_reglas_derivacion_telemetria
       (regla_id,numero,condicion_tipo,condicion_version,condicion_canonica,
        severidad_calculada,mensaje_operativo,nombre,vigente_desde_utc)
     VALUES (?,1,'momento_utc_relativo',1,?,'advertencia',?,?,?)`,
    [regla.insertId, condicion.obtenerCanonica(), 'Momento fuera del límite.',
      `Regla ${sufijo}`, ahora]
  );
  await sql.ejecutar(
    'UPDATE reglas_derivacion_telemetria SET revision_vigente_id=? WHERE id=?',
    [revision.insertId, regla.insertId]
  );
  const trabajo = (await new RepositorioTrabajosEvaluacionTelemetria(sql).encolar({
    observacion,
    regla: {
      id: regla.insertId, agenteId: base.agenteId, senalId: senal.id,
      tenantId: base.tenantId, empresaId: base.empresaId, sitioId: base.sitioId,
      generacionAutoridad: 1
    },
    revision: {
      id: revision.insertId, reglaId: regla.insertId,
      vigenteDesdeUtc: isoSegundos(ahora), vigenteHastaUtc: null
    },
    causa: CAUSAS_TRABAJO_EVALUACION_TELEMETRIA.RECONCILIACION_ADMINISTRATIVA
  })).trabajo;
  assert.equal(trabajo.condicionTipoRevision, 'momento_utc_relativo');
  return {
    reglaId: Number(regla.insertId),
    trabajoId: Number(trabajo.id)
  };
}

async function crearBase(sql) {
  const alias = `fixture-524a3b-${randomBytes(4).toString('hex')}`;
  const [tenant] = await sql.ejecutar('INSERT INTO tenants (nombre,alias) VALUES (?,?)',
    ['Tenant 5.24a.3b', alias]);
  const [empresa] = await sql.ejecutar(
    'INSERT INTO empresas (tenant_id,nombre,alias) VALUES (?,?,?)',
    [tenant.insertId, 'Empresa 5.24a.3b', alias]
  );
  const [sitio] = await sql.ejecutar(
    'INSERT INTO sitios (tenant_id,empresa_id,nombre,alias) VALUES (?,?,?,?)',
    [tenant.insertId, empresa.insertId, 'Sitio 5.24a.3b', alias]
  );
  const [agente] = await sql.ejecutar(
    `INSERT INTO agentes_sentinelia
       (guid,tenant_id,empresa_id,sitio_id,nombre,secreto_hash)
     VALUES (?,?,?,?,?,?)`,
    [randomUUID(), tenant.insertId, empresa.insertId, sitio.insertId,
      'Agente relativo runtime', 'sin-secreto-utilizable']
  );
  return {
    agenteId: Number(agente.insertId), tenantId: Number(tenant.insertId),
    empresaId: Number(empresa.insertId), sitioId: Number(sitio.insertId)
  };
}

async function ahoraSql(sql) {
  const [fila] = await sql.consultar('SELECT UTC_TIMESTAMP(0) ahora');
  return fila.ahora instanceof Date ? fila.ahora : new Date(fila.ahora);
}

function isoSegundos(fecha) {
  return fecha.toISOString().replace(/\.000Z$/u, 'Z');
}

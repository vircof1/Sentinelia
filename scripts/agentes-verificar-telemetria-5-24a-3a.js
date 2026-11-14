import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';

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
  MOTIVOS_NEUTRALIZACION_TRABAJO_TELEMETRIA,
  RepositorioTrabajosEvaluacionTelemetria
} from '../paquetes/agentes/src/RepositorioTrabajosEvaluacionTelemetria.js';
import {
  FuenteEntropiaCriptograficaNode
} from '../paquetes/federacion/adaptadores/FuenteEntropiaCriptograficaNode.js';
import {
  RepositorioTelemetriaLocalSql
} from '../paquetes/federacion/adaptadores/RepositorioTelemetriaLocalSql.js';
import {
  GeneradorIdentidadesFederadas,
  TIPOS_IDENTIDAD_FEDERADA
} from '../paquetes/federacion/src/IdentidadFederada.js';
import { ClienteSql } from '../paquetes/persistencia-sql/src/ClienteSql.js';
import {
  obtenerConfiguracionAplicacion
} from '../paquetes/utilidades/src/configuracion/obtenerConfiguracionAplicacion.js';
import { migrar } from './federacion-verificar-5-22-15g.js';

const RECLAMADOR = 'fixture-5.24a.3a';
const ETAPAS_FALLO = Object.freeze([
  'ledger', 'estado', 'evento', 'siguiente', 'captura', 'completado'
]);
const generador = new GeneradorIdentidadesFederadas({
  fuenteEntropia: new FuenteEntropiaCriptograficaNode()
});

await main();

async function main() {
  const configuracion = obtenerConfiguracionAplicacion();
  assert.equal(configuracion.sql.estaCompleta, true, '5.24a.3a necesita MariaDB real.');
  const administrador = new ClienteSql(configuracion.sql);
  const nombre = `sentinelia_fixture_524a3a_${randomBytes(5).toString('hex')}`;
  let sql;
  try {
    await administrador.ejecutar(
      `CREATE DATABASE ${administrador.escaparIdentificador(nombre)} ` +
      'CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci'
    );
    sql = new ClienteSql({ ...configuracion.sql, baseDatos: nombre });
    await migrar(sql);
    await sql.verificarUsoHorarioUtc();
    await sql.ejecutar(
      `CREATE TABLE capturas_atomicas_524a3a (
         id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
         regla_id BIGINT UNSIGNED NOT NULL,
         payload JSON NOT NULL
       ) ENGINE=InnoDB`
    );
    const base = await crearBase(sql);
    await verificarRollbackPorEscritura(sql, base);
    await verificarConfirmacionAtomica(sql, base);
    await verificarNeutralizaciones(sql, base);
    console.log(
      '[agentes] OK 5.24a.3a: transaccion=unica locks=ordenados reloj=sql_unico ' +
      'fencing=regla_generacion_revision_fotografia ledger=append_only ' +
      'estado_evento=atomicos siguiente=durable captura=preparada rollback=6_puntos ' +
      'legacy=intacto'
    );
  } finally {
    await sql?.cerrar().catch(() => {});
    await administrador.ejecutar(
      `DROP DATABASE IF EXISTS ${administrador.escaparIdentificador(nombre)}`
    ).catch(() => {});
    await administrador.cerrar();
  }
}

async function verificarRollbackPorEscritura(sql, base) {
  for (const etapa of ETAPAS_FALLO) {
    const agregado = await crearAgregado(sql, base, `fallo-${etapa}`);
    const { procesador } = crearProcesador(sql, base, { fallarDespuesDe: etapa });
    await assert.rejects(
      procesador.procesar({ trabajo: agregado.trabajo, reclamadoPor: RECLAMADOR }),
      new RegExp(`fallo_inyectado_${etapa}`, 'u')
    );
    await verificarSinEfectos(sql, agregado);
    const reintento = crearProcesador(sql, base).procesador;
    const confirmado = await reintento.procesar({
      trabajo: agregado.trabajo,
      reclamadoPor: RECLAMADOR
    });
    assert.equal(confirmado.ok, true);
    assert.equal(confirmado.neutralizada, false);
    await verificarEfectosUnicos(sql, agregado);
  }
}

async function verificarConfirmacionAtomica(sql, base) {
  const agregado = await crearAgregado(sql, base, 'confirmacion');
  const trazas = [];
  const { procesador } = crearProcesador(sql, base, { trazas });
  const resultado = await procesador.procesar({
    trabajo: agregado.trabajo,
    reclamadoPor: RECLAMADOR
  });
  assert.equal(resultado.ok, true);
  assert.equal(resultado.neutralizada, false);
  assert.equal(resultado.evaluacion.resultado, 'coincide');
  assert.equal(resultado.evaluacion.ladoAtencion, 'superior');
  assert.equal(resultado.evaluacion.causalidadRevision, 'autoridad_actual');
  assert.equal(resultado.persistencia.estadoActualizado, true);
  assert.equal(resultado.persistencia.eventoCreado, true);
  assert.equal(resultado.persistencia.siguienteTrabajo.creado, true);
  assert.equal(
    resultado.persistencia.siguienteTrabajo.trabajo.siguienteIntentoUtc,
    resultado.evaluacion.proximaReevaluacionUtc
  );
  const [conteos] = await sql.consultar(
    `SELECT
       (SELECT COUNT(*) FROM evaluaciones_reglas_telemetria WHERE trabajo_id=?) evaluaciones,
       (SELECT COUNT(*) FROM estado_actual_evaluacion_reglas_telemetria WHERE regla_id=?) estados,
       (SELECT COUNT(*) FROM eventos_derivados_telemetria WHERE regla_id=?) eventos,
       (SELECT COUNT(*) FROM trabajos_evaluacion_telemetria WHERE regla_id=? AND id<>?) siguientes,
       (SELECT COUNT(*) FROM capturas_atomicas_524a3a WHERE regla_id=?) capturas`,
    [agregado.trabajo.id, agregado.reglaId, agregado.reglaId,
      agregado.reglaId, agregado.trabajo.id, agregado.reglaId]
  );
  assert.deepEqual(
    [conteos.evaluaciones, conteos.estados, conteos.eventos,
      conteos.siguientes, conteos.capturas].map(Number),
    [1, 1, 1, 1, 1]
  );
  const trabajo = await new RepositorioTrabajosEvaluacionTelemetria(sql)
    .buscarPorId(agregado.trabajo.id);
  assert.equal(trabajo.estado, 'completado');
  verificarOrdenLocks(trazas);
}

async function verificarNeutralizaciones(sql, base) {
  for (const caso of [
    ['deshabilitada', MOTIVOS_NEUTRALIZACION_TRABAJO_TELEMETRIA.REGLA_DESHABILITADA],
    ['generacion', MOTIVOS_NEUTRALIZACION_TRABAJO_TELEMETRIA.GENERACION_SUSTITUIDA],
    ['revision', MOTIVOS_NEUTRALIZACION_TRABAJO_TELEMETRIA.REVISION_SUSTITUIDA],
    ['observacion', MOTIVOS_NEUTRALIZACION_TRABAJO_TELEMETRIA.OBSERVACION_SUSTITUIDA]
  ]) {
    const agregado = await crearAgregado(sql, base, `neutral-${caso[0]}`);
    await retirarAutoridad(sql, agregado, caso[0]);
    const { procesador } = crearProcesador(sql, base);
    const resultado = await procesador.procesar({
      trabajo: agregado.trabajo,
      reclamadoPor: RECLAMADOR
    });
    assert.equal(resultado.neutralizada, true);
    assert.equal(resultado.motivoNeutralizacion, caso[1]);
    const trabajo = await new RepositorioTrabajosEvaluacionTelemetria(sql)
      .buscarPorId(agregado.trabajo.id);
    assert.equal(trabajo.estado, 'neutralizado');
    assert.equal(trabajo.motivoNeutralizacion, caso[1]);
    await verificarSinProyecciones(sql, agregado);
  }
}

function crearProcesador(sql, base, { fallarDespuesDe = null, trazas = [] } = {}) {
  const cliente = clienteTrazado(sql, trazas);
  const trabajosBase = new RepositorioTrabajosEvaluacionTelemetria(cliente);
  const trabajos = envolverFallos(trabajosBase, {
    encolarEnTransaccion: 'siguiente',
    marcarCompletado: 'completado'
  }, fallarDespuesDe);
  const evaluaciones = envolverFallos(
    new RepositorioEvaluacionesReglasTelemetria(sql),
    { registrar: 'ledger' },
    fallarDespuesDe
  );
  const estado = envolverFallos(
    new RepositorioEstadoActualEvaluacionReglasTelemetria(sql),
    { aplicarResultado: 'estado' },
    fallarDespuesDe
  );
  const eventos = envolverFallos(
    new RepositorioEventosDerivadosTelemetria(sql),
    { insertarSiCoincide: 'evento' },
    fallarDespuesDe
  );
  const local = new RepositorioTelemetriaLocalSql(sql, {
    installationLocalId: base.installationLocalId,
    generadorIdentidades: generador,
    permitirMomentoUtcRelativo: true
  });
  const capturador = {
    async capturarEvaluacionEnTransaccion({
      reglaId,
      eventoCreado,
      eventoDerivadoId
    }, { conexion }) {
      const capturas = [await local.prepararCapturaEnTransaccion({
        tipoRegistro: 'reglaDerivacion', idLocal: reglaId
      }, { conexion })];
      if (eventoCreado) {
        capturas.push(await local.prepararCapturaEnTransaccion({
          tipoRegistro: 'eventoDerivado', idLocal: eventoDerivadoId
        }, { conexion }));
      }
      await conexion.execute(
        'INSERT INTO capturas_atomicas_524a3a (regla_id,payload) VALUES (?,?)',
        [reglaId, JSON.stringify(capturas.map(({ payload }) => payload))]
      );
      if (fallarDespuesDe === 'captura') throw new Error('fallo_inyectado_captura');
    }
  };
  return {
    procesador: new ProcesadorObligacionesRelativasTelemetria({
      repositorioTrabajos: trabajos,
      repositorioEvaluaciones: evaluaciones,
      repositorioEstadoActual: estado,
      repositorioEventosDerivados: eventos,
      capturadorFederacionTelemetria: capturador
    })
  };
}

function envolverFallos(objetivo, etapas, etapaActiva) {
  return new Proxy(objetivo, {
    get(valor, propiedad) {
      const original = valor[propiedad];
      if (typeof original !== 'function') return original;
      return async (...argumentos) => {
        const resultado = await original.apply(valor, argumentos);
        if (etapas[propiedad] === etapaActiva) {
          throw new Error(`fallo_inyectado_${etapaActiva}`);
        }
        return resultado;
      };
    }
  });
}

function clienteTrazado(sql, trazas) {
  return {
    ...sql,
    async obtenerConexion() {
      const conexion = await sql.obtenerConexion();
      return {
        beginTransaction: conexion.beginTransaction.bind(conexion),
        commit: conexion.commit.bind(conexion),
        rollback: conexion.rollback.bind(conexion),
        release: conexion.release.bind(conexion),
        async execute(consulta, parametros) {
          trazas.push(String(consulta).replace(/\s+/gu, ' ').trim());
          return conexion.execute(consulta, parametros);
        },
        async query(consulta, parametros) {
          trazas.push(String(consulta).replace(/\s+/gu, ' ').trim());
          return conexion.query(consulta, parametros);
        }
      };
    }
  };
}

function verificarOrdenLocks(trazas) {
  const patrones = [
    'FROM trabajos_evaluacion_telemetria t',
    'FROM reglas_derivacion_telemetria',
    'SELECT id,regla_id,condicion_tipo,condicion_version,condicion_canonica',
    'FROM estado_actual_telemetria_agentes',
    'FROM observaciones_telemetria_agentes',
    'FROM estado_actual_evaluacion_reglas_telemetria e',
    'SELECT UTC_TIMESTAMP(0) AS ahora_utc'
  ];
  const posiciones = patrones.map((patron) => trazas.findIndex(
    (consulta) => consulta.includes(patron) &&
      (patron.startsWith('SELECT UTC') || consulta.includes('FOR UPDATE'))
  ));
  assert.equal(posiciones.every((posicion) => posicion >= 0), true);
  assert.deepEqual([...posiciones].sort((a, b) => a - b), posiciones);
  assert.equal(trazas.filter((consulta) =>
    consulta.includes('SELECT UTC_TIMESTAMP(0) AS ahora_utc')).length, 1);
}

async function crearAgregado(sql, base, sufijo) {
  const ahora = await ahoraSql(sql);
  const momento = new Date(ahora.getTime() + 3600_000);
  const catalogo = new RepositorioCatalogoSenalesTelemetriaAgentes(sql);
  const senal = await catalogo.guardarDeclaracionSenal({
    agenteId: base.agenteId,
    definicion: {
      categoria: 'fixture-524a3a', clave: `${sufijo}-${randomBytes(3).toString('hex')}`,
      tipoDato: 'momento_utc', nombreHumano: `Momento ${sufijo}`
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
  const repositorioTrabajos = new RepositorioTrabajosEvaluacionTelemetria(sql);
  const encolado = await repositorioTrabajos.encolar({
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
  });
  await sql.ejecutar(
    `UPDATE trabajos_evaluacion_telemetria
        SET estado='procesando',intentos=1,reclamado_por=?,
            reclamado_en_utc=UTC_TIMESTAMP(6),
            reclamo_expira_en_utc=TIMESTAMPADD(MINUTE,5,UTC_TIMESTAMP(6))
      WHERE id=?`,
    [RECLAMADOR, encolado.trabajo.id]
  );
  return {
    reglaId: Number(regla.insertId),
    revisionId: Number(revision.insertId),
    observacionId: Number(observacion.id),
    senalId: Number(senal.id),
    trabajo: await repositorioTrabajos.buscarPorId(encolado.trabajo.id)
  };
}

async function retirarAutoridad(sql, agregado, caso) {
  if (caso === 'deshabilitada') {
    await sql.ejecutar(
      "UPDATE reglas_derivacion_telemetria SET estado='deshabilitada' WHERE id=?",
      [agregado.reglaId]
    );
  } else if (caso === 'generacion') {
    await sql.ejecutar(
      'UPDATE reglas_derivacion_telemetria SET generacion_autoridad=2 WHERE id=?',
      [agregado.reglaId]
    );
  } else if (caso === 'revision') {
    await sql.ejecutar(
      `UPDATE revisiones_reglas_derivacion_telemetria
          SET vigente_hasta_utc=TIMESTAMPADD(MICROSECOND,1,vigente_desde_utc)
        WHERE id=?`,
      [agregado.revisionId]
    );
    await sql.ejecutar(
      `INSERT INTO revisiones_reglas_derivacion_telemetria
         (regla_id,numero,condicion_tipo,condicion_version,condicion_canonica,
          severidad_calculada,mensaje_operativo,nombre,vigente_desde_utc)
       SELECT regla_id,2,condicion_tipo,condicion_version,condicion_canonica,
              severidad_calculada,mensaje_operativo,CONCAT(nombre,' v2'),
              TIMESTAMPADD(MICROSECOND,1,vigente_desde_utc)
         FROM revisiones_reglas_derivacion_telemetria WHERE id=?`,
      [agregado.revisionId]
    );
    const [filas] = await sql.consultar(
      'SELECT MAX(id) id FROM revisiones_reglas_derivacion_telemetria WHERE regla_id=?',
      [agregado.reglaId]
    );
    await sql.ejecutar(
      'UPDATE reglas_derivacion_telemetria SET revision_vigente_id=? WHERE id=?',
      [filas.id, agregado.reglaId]
    );
  } else {
    await sql.ejecutar(
      'DELETE FROM estado_actual_telemetria_agentes WHERE senal_id=?',
      [agregado.senalId]
    );
  }
}

async function verificarSinEfectos(sql, agregado) {
  const trabajo = await new RepositorioTrabajosEvaluacionTelemetria(sql)
    .buscarPorId(agregado.trabajo.id);
  assert.equal(trabajo.estado, 'procesando');
  await verificarSinProyecciones(sql, agregado);
}

async function verificarEfectosUnicos(sql, agregado) {
  const [fila] = await sql.consultar(
    `SELECT
       (SELECT COUNT(*) FROM evaluaciones_reglas_telemetria WHERE trabajo_id=?) evaluaciones,
       (SELECT COUNT(*) FROM estado_actual_evaluacion_reglas_telemetria WHERE regla_id=?) estados,
       (SELECT COUNT(*) FROM eventos_derivados_telemetria WHERE regla_id=?) eventos,
       (SELECT COUNT(*) FROM trabajos_evaluacion_telemetria WHERE regla_id=? AND id<>?) siguientes,
       (SELECT COUNT(*) FROM capturas_atomicas_524a3a WHERE regla_id=?) capturas`,
    [agregado.trabajo.id, agregado.reglaId, agregado.reglaId,
      agregado.reglaId, agregado.trabajo.id, agregado.reglaId]
  );
  assert.deepEqual(
    [fila.evaluaciones, fila.estados, fila.eventos, fila.siguientes, fila.capturas]
      .map(Number),
    [1, 1, 1, 1, 1]
  );
}

async function verificarSinProyecciones(sql, agregado) {
  const [fila] = await sql.consultar(
    `SELECT
       (SELECT COUNT(*) FROM evaluaciones_reglas_telemetria WHERE trabajo_id=?) evaluaciones,
       (SELECT COUNT(*) FROM estado_actual_evaluacion_reglas_telemetria WHERE regla_id=?) estados,
       (SELECT COUNT(*) FROM eventos_derivados_telemetria WHERE regla_id=?) eventos,
       (SELECT COUNT(*) FROM trabajos_evaluacion_telemetria WHERE regla_id=? AND id<>?) siguientes,
       (SELECT COUNT(*) FROM capturas_atomicas_524a3a WHERE regla_id=?) capturas`,
    [agregado.trabajo.id, agregado.reglaId, agregado.reglaId,
      agregado.reglaId, agregado.trabajo.id, agregado.reglaId]
  );
  assert.deepEqual(
    [fila.evaluaciones, fila.estados, fila.eventos, fila.siguientes, fila.capturas]
      .map(Number),
    [0, 0, 0, 0, 0]
  );
}

async function crearBase(sql) {
  const alias = `fixture-524a3a-${randomBytes(4).toString('hex')}`;
  const [tenant] = await sql.ejecutar('INSERT INTO tenants (nombre,alias) VALUES (?,?)',
    ['Tenant 5.24a.3a', alias]);
  const [empresa] = await sql.ejecutar(
    'INSERT INTO empresas (tenant_id,nombre,alias) VALUES (?,?,?)',
    [tenant.insertId, 'Empresa 5.24a.3a', alias]
  );
  const [sitio] = await sql.ejecutar(
    'INSERT INTO sitios (tenant_id,empresa_id,nombre,alias) VALUES (?,?,?,?)',
    [tenant.insertId, empresa.insertId, 'Sitio 5.24a.3a', alias]
  );
  const [agente] = await sql.ejecutar(
    `INSERT INTO agentes_sentinelia
       (guid,tenant_id,empresa_id,sitio_id,nombre,secreto_hash)
     VALUES (?,?,?,?,?,?)`,
    [randomUUID(), tenant.insertId, empresa.insertId, sitio.insertId,
      'Agente relativo atómico', 'sin-secreto-utilizable']
  );
  return {
    agenteId: Number(agente.insertId),
    tenantId: Number(tenant.insertId),
    empresaId: Number(empresa.insertId),
    sitioId: Number(sitio.insertId),
    installationLocalId: String(generador.generar(TIPOS_IDENTIDAD_FEDERADA.INSTALACION))
  };
}

async function ahoraSql(sql) {
  const [fila] = await sql.consultar('SELECT UTC_TIMESTAMP(0) ahora');
  return fila.ahora instanceof Date ? fila.ahora : new Date(fila.ahora);
}

function isoSegundos(fecha) {
  return fecha.toISOString().replace(/\.000Z$/u, 'Z');
}

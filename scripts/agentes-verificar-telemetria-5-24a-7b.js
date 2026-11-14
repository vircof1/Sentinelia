import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';

import { ControladorReglasDerivacionTelemetria } from '../apps/sentinelia-web/src/controladores/ControladorReglasDerivacionTelemetria.js';
import { MotorTriggersRuntime } from '../apps/sentinelia-runtime/src/triggers/MotorTriggersRuntime.js';
import {
  CAPACIDADES_RUNTIME_MOMENTO_UTC_RELATIVO,
  CAPACIDADES_WEB_MOMENTO_UTC_RELATIVO,
  crearDeclaracionCompatibilidadRuntimeMomentoUtcRelativo,
  evaluarPreparacionLocalMomentoUtcRelativo,
  evaluarUnanimidadMomentoUtcRelativo
} from '../paquetes/agentes/src/CompatibilidadDespliegueMomentoUtcRelativo.js';
import {
  EvaluadorCondicionesDerivacionTelemetria,
  crearCondicionTipadaDerivacionTelemetria
} from '../paquetes/agentes/src/EvaluadorCondicionesDerivacionTelemetria.js';
import {
  ReglaDerivacionTelemetria,
  RevisionReglaDerivacionTelemetria
} from '../paquetes/agentes/src/EventosDerivadosTelemetriaAgentes.js';
import { ProcesadorObligacionesRelativasTelemetria } from '../paquetes/agentes/src/ProcesadorObligacionesRelativasTelemetria.js';
import { RepositorioCatalogoSenalesTelemetriaAgentes } from '../paquetes/agentes/src/RepositorioCatalogoSenalesTelemetriaAgentes.js';
import {
  RepositorioEstadoActualEvaluacionReglasTelemetria,
  RepositorioEvaluacionesReglasTelemetria,
  RepositorioEventosDerivadosTelemetria
} from '../paquetes/agentes/src/RepositorioEvaluacionesDerivadasTelemetria.js';
import { RepositorioEstadoActualTelemetriaAgentes } from '../paquetes/agentes/src/RepositorioEstadoActualTelemetriaAgentes.js';
import { RepositorioObservacionesTelemetriaAgentes } from '../paquetes/agentes/src/RepositorioObservacionesTelemetriaAgentes.js';
import { RepositorioReglasDerivacionTelemetria } from '../paquetes/agentes/src/RepositorioReglasDerivacionTelemetria.js';
import { RepositorioTrabajosEvaluacionTelemetria } from '../paquetes/agentes/src/RepositorioTrabajosEvaluacionTelemetria.js';
import { ServicioAdministracionReglasDerivacionTelemetria } from '../paquetes/agentes/src/ServicioAdministracionReglasDerivacionTelemetria.js';
import { crearLecturaTelemetriaAgenteConTiposInternos } from '../paquetes/agentes/src/TelemetriaAgente.js';
import { EvaluadorFuenteReglaMonitorTelemetria } from '../paquetes/monitores/src/EvaluadorFuenteReglaMonitorTelemetria.js';
import { ClienteSql } from '../paquetes/persistencia-sql/src/ClienteSql.js';
import { EjecutorMigraciones } from '../paquetes/persistencia-sql/src/EjecutorMigraciones.js';
import { RepositorioMigraciones } from '../paquetes/persistencia-sql/src/RepositorioMigraciones.js';
import {
  obtenerConfiguracionAplicacion,
  obtenerRutaMigraciones
} from '../paquetes/utilidades/src/configuracion/obtenerConfiguracionAplicacion.js';

const N0 = '2026-09-05T12:00:00Z';

async function main() {
  await verificarActivacionCoordinada();
  const configuracion = obtenerConfiguracionAplicacion();
  assert.equal(configuracion.sql.estaCompleta, true, '5.24a.7b exige MariaDB real.');
  const administrador = new ClienteSql(configuracion.sql);
  const baseDatos = `sentinelia_fixture_524a7b_${randomBytes(6).toString('hex')}`;
  let sqlBase;
  try {
    await administrador.ejecutar(
      `CREATE DATABASE ${administrador.escaparIdentificador(baseDatos)} ` +
      'CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci'
    );
    sqlBase = new ClienteSql({ ...configuracion.sql, baseDatos });
    await new EjecutorMigraciones({
      clienteSql: sqlBase,
      repositorioMigraciones: new RepositorioMigraciones(sqlBase),
      rutaMigraciones: obtenerRutaMigraciones()
    }).ejecutarPendientes();
    const sql = new ClienteSqlConReloj(sqlBase, N0);
    await verificarRecorridoProductivo(sql);
  } finally {
    await sqlBase?.cerrar().catch(() => {});
    await administrador.ejecutar(
      `DROP DATABASE IF EXISTS ${administrador.escaparIdentificador(baseDatos)}`
    ).catch(() => {});
    await administrador.cerrar();
  }
  console.log(
    '[agentes] OK 5.24a.7b: despliegue=unanimidad_web_runtime ' +
    'migraciones=0232-0234 federacion=emision_y_recepcion portal=abierto ' +
    'trayectoria=futuro_normal_pasado observaciones_nuevas=0 ledger=3 ' +
    'monitor=fallo_normal_fallo triggers=apertura_cierre_apertura absoluto=estable'
  );
}

async function verificarActivacionCoordinada() {
  const preparacion = evaluarPreparacionLocalMomentoUtcRelativo({
    migracionesAplicadas: ['0001_esquema_inicial.sql'],
    postcondicionesMigracionesVerificadas: true
  });
  const declaracion = crearDeclaracionCompatibilidadRuntimeMomentoUtcRelativo({
    instanciaId: 'runtime-7b', preparacionLocal: preparacion
  });
  const presencia = {
    instanciaId: 'runtime-7b',
    capacidadesDespliegue: { momentoUtcRelativo: declaracion }
  };
  const unanimidad = evaluarUnanimidadMomentoUtcRelativo({
    preparacionLocal: preparacion,
    capacidadesWeb: CAPACIDADES_WEB_MOMENTO_UTC_RELATIVO,
    instanciasRuntime: [presencia]
  });
  assert.equal(unanimidad.gateAbierto, true);
  assert.equal(unanimidad.instanciasRuntimeCompatibles, 1);
  assert.throws(() => evaluarUnanimidadMomentoUtcRelativo({
    preparacionLocal: preparacion,
    capacidadesWeb: CAPACIDADES_WEB_MOMENTO_UTC_RELATIVO,
    instanciasRuntime: [{ ...presencia, capacidadesDespliegue: {} }]
  }), (error) => error.codigo === 'runtime_capacidad_ausente');
  assert.ok(CAPACIDADES_RUNTIME_MOMENTO_UTC_RELATIVO.length >= 4);

  const [web, runtime, bootstrap, registro] = await Promise.all([
    leer('apps/sentinelia-web/src/index.js'),
    leer('apps/sentinelia-runtime/src/RuntimeSentinelia.js'),
    leer('apps/sentinelia-runtime/src/BootstrapRuntime.js'),
    leer('paquetes/federacion/aplicacion/crearRegistroFamiliasFederacionSql.js')
  ]);
  assert.match(web, /resolverUnanimidadMomentoUtcRelativo/u);
  assert.match(web, /permitirMomentoUtcRelativo:\s*activacionMomentoUtcRelativo\.gateAbierto/u);
  assert.match(runtime, /publicarCapacidadDespliegue\([\s\S]*?'momentoUtcRelativo'/u);
  assert.ok(
    runtime.indexOf("'momentoUtcRelativo'") <
      runtime.indexOf('await this.presenciaRedis.publicarInicio'),
    'La primera presencia runtime debe declarar momento UTC relativo.'
  );
  assert.match(bootstrap, /permitirMomentoUtcRelativo:\s*true/u);
  assert.match(registro, /RepositorioTelemetriaRemotaSql\(clienteSql, \{[\s\S]*?permitirMomentoUtcRelativo/u);
}

async function verificarRecorridoProductivo(sql) {
  const base = await crearBase(sql);
  const catalogo = new RepositorioCatalogoSenalesTelemetriaAgentes(sql);
  const senal = await catalogo.guardarDeclaracionSenal({
    agenteId: base.agenteId,
    definicion: {
      categoria: 'copias', clave: 'proxima', tipoDato: 'momento_utc',
      nombreHumano: 'Próxima copia'
    }
  });
  const observacion = await insertarFotografia(sql, base, senal);
  const servicio = crearServicioPortal(sql, base, senal);
  const controlador = new ControladorReglasDerivacionTelemetria({
    servicioAdministracionReglas: servicio
  });
  const respuesta = { destino: null, redirect(destino) { this.destino = destino; } };
  const requisicion = {
    params: { id: String(base.agenteId) },
    contextoUsuarioActual: {},
    session: {},
    body: {
      senal_id: String(senal.id),
      nombre: 'Ventana de próxima copia',
      descripcion: 'Supervisa el instante frente al presente.',
      severidad_calculada: 'advertencia',
      mensaje_operativo: 'La próxima copia queda fuera de su ventana.',
      condicion_tipo: 'momento_utc_relativo',
      relativo_forma: 'fuera_intervalo',
      relativo_inferior_direccion: 'pasado',
      relativo_inferior_magnitud: '1',
      relativo_inferior_unidad: 'minutos',
      relativo_superior_direccion: 'futuro',
      relativo_superior_magnitud: '1',
      relativo_superior_unidad: 'minutos',
      relativo_histeresis_inferior: '0',
      relativo_histeresis_inferior_unidad: 'segundos',
      relativo_histeresis_superior: '0',
      relativo_histeresis_superior_unidad: 'segundos'
    }
  };
  await controlador.crearRegla(requisicion, respuesta);
  assert.match(respuesta.destino, /\/reglas\/\d+$/u);
  const reglaId = Number(respuesta.destino.split('/').at(-1));

  const trabajos = new RepositorioTrabajosEvaluacionTelemetria(sql);
  const estados = new RepositorioEstadoActualEvaluacionReglasTelemetria(sql);
  const procesador = new ProcesadorObligacionesRelativasTelemetria({
    repositorioTrabajos: trabajos,
    repositorioEvaluaciones: new RepositorioEvaluacionesReglasTelemetria(sql),
    repositorioEstadoActual: estados,
    repositorioEventosDerivados: new RepositorioEventosDerivadosTelemetria(sql),
    capturadorFederacionTelemetria: {
      async capturarEvaluacionEnTransaccion() {}
    }
  });
  const resultados = [];
  for (let paso = 0; paso < 3; paso += 1) {
    const reclamados = await trabajos.reclamarSiguientes({
      reclamadoPor: 'runtime-7b', limite: 1, ttlSegundos: 30
    });
    assert.equal(reclamados.length, 1, `Debe existir el trabajo del paso ${paso}.`);
    resultados.push(await procesador.procesar({
      trabajo: reclamados[0], reclamadoPor: 'runtime-7b'
    }));
    if (paso < 2) {
      const siguiente = resultados[paso].persistencia.siguienteTrabajo?.trabajo;
      assert.ok(siguiente?.programadoParaUtc);
      sql.fijar(siguiente.programadoParaUtc);
    }
  }
  assert.deepEqual(resultados.map((item) => item.evaluacion.resultado),
    ['coincide', 'no_coincide', 'coincide']);
  assert.deepEqual(resultados.map((item) => item.evaluacion.ladoAtencion),
    ['superior', null, 'inferior']);
  assert.deepEqual(resultados.map((item) => ({
    creado: item.persistencia.eventoCreado,
    motivo: item.persistencia.motivoEvento
  })), [
    { creado: true, motivo: 'evento_creado' },
    { creado: false, motivo: 'resultado_no_coincidente' },
    { creado: true, motivo: 'evento_creado' }
  ]);
  const [conteos] = await sql.consultar(
    `SELECT
       (SELECT COUNT(*) FROM observaciones_telemetria_agentes WHERE senal_id=?) observaciones,
       (SELECT COUNT(*) FROM evaluaciones_reglas_telemetria WHERE regla_id=?) evaluaciones,
       (SELECT COUNT(*) FROM eventos_derivados_telemetria WHERE regla_id=?) eventos`,
    [senal.id, reglaId, reglaId]
  );
  assert.deepEqual([conteos.observaciones, conteos.evaluaciones, conteos.eventos].map(Number),
    [1, 3, 2]);
  assert.equal(Number(observacion.id) > 0, true);

  const evaluaciones = await sql.consultar(
    'SELECT * FROM evaluaciones_reglas_telemetria WHERE regla_id=? ORDER BY id',
    [reglaId]
  );
  const vinculo = {
    esReglaDerivacion: () => true,
    estadoRegla: 'activa',
    fuente: { reglaId },
    agenteId: base.agenteId,
    senalOrigen: { id: Number(senal.id) },
    scope: {
      tenantId: base.tenantId, empresaId: base.empresaId, sitioId: base.sitioId
    }
  };
  const evaluadorMonitor = new EvaluadorFuenteReglaMonitorTelemetria();
  const estadosMonitor = evaluaciones.map((fila) => evaluadorMonitor.evaluar({
    vinculo,
    estadoActualRegla: estadoDesdeEvaluacion(fila)
  }).estado);
  assert.deepEqual(estadosMonitor, ['fallo', 'normal', 'fallo']);
  await verificarTriggersDerivados(estadosMonitor);
  verificarMomentoAbsolutoEstable(base, senal);
}

async function verificarTriggersDerivados(estadosMonitor) {
  const transiciones = estadosMonitor.map((estado, indice) => ({ estado, indice }));
  const aperturasAlerta = transiciones.filter(({ estado }) => estado === 'fallo');
  const cierresAlerta = transiciones.filter(({ estado }) => estado === 'normal');
  const aceptadas = [];
  const motor = new MotorTriggersRuntime({
    servicioTriggers: {
      async resolverDisparosDesdeTransiciones({ aperturasAlerta: aperturas, cierresAlerta: cierres }) {
        return {
          disparos: [...aperturas, ...cierres].map((transicion, indice) => ({
            eventoDisparo: `evento-${transicion.indice}`,
            asignacionId: indice + 1,
            monitorId: 1,
            triggerId: 1,
            tipoTrigger: 'correo',
            transicion
          }))
        };
      },
      async aceptarPlanAtomicoEnTransaccion({ planDisparo }) {
        aceptadas.push(planDisparo.transicion.estado);
        return { id: aceptadas.length, creada: true };
      }
    }
  });
  const resumen = await motor.planificarDesdePersistenciaAlertas({
    persistenciaAlertas: { aperturasAlerta, cierresAlerta },
    conexion: {}
  });
  assert.equal(resumen.totalPlanes, 3);
  assert.deepEqual(aceptadas.sort(), ['fallo', 'fallo', 'normal'].sort());
}

function verificarMomentoAbsolutoEstable(base, senal) {
  const condicion = crearCondicionTipadaDerivacionTelemetria({
    senal, tipo: 'momento_utc', operador: '>', umbralUtc: '2026-09-05T12:01:00Z'
  });
  const regla = new ReglaDerivacionTelemetria({
    id: 999, agente: { id: base.agenteId, ...base },
    senal: { id: Number(senal.id), agenteId: base.agenteId },
    scope: base, revisionVigenteId: 998
  });
  const revision = new RevisionReglaDerivacionTelemetria({
    id: 998, reglaId: 999, numero: 1, nombre: 'Absoluta',
    severidadCalculada: 'advertencia', mensajeOperativo: 'Absoluta', condicion,
    vigenteDesdeUtc: N0
  });
  const observacion = {
    id: 997, agenteId: base.agenteId, senalId: Number(senal.id),
    valor: '2026-09-05T12:02:00Z', tipoDato: 'momento_utc', unidad: null,
    calidad: 'valida', observadoEnUtc: N0, recibidoEnUtc: N0
  };
  const evaluador = new EvaluadorCondicionesDerivacionTelemetria();
  const uno = evaluador.evaluar({ regla, revision, senal, observacion, evaluadoEnUtc: N0 });
  const dos = evaluador.evaluar({
    regla, revision, senal, observacion, evaluadoEnUtc: '2030-01-01T00:00:00Z'
  });
  assert.equal(uno.resultado, dos.resultado);
  assert.equal(uno.codigoMotivo, dos.codigoMotivo);
}

function crearServicioPortal(sql, base, senal) {
  return new ServicioAdministracionReglasDerivacionTelemetria({
    repositorioAgentes: {
      async buscarPorId(id) {
        return Number(id) === base.agenteId ? { id: base.agenteId, ...base } : null;
      }
    },
    repositorioCatalogoSenales: {
      async buscarPorId(id) { return Number(id) === Number(senal.id) ? senal : null; },
      async listarPorAgente() { return [senal]; }
    },
    repositorioReglas: new RepositorioReglasDerivacionTelemetria(sql),
    repositorioTrabajosEvaluacion: new RepositorioTrabajosEvaluacionTelemetria(sql),
    repositorioEstadoActualTelemetria: new RepositorioEstadoActualTelemetriaAgentes(sql),
    politicaPermisosAgentes: {
      assertPuedeModificar() {}, assertPuedeVer() {}, puedeAlcanzarAgente() { return true; }
    },
    fronteraTransaccional: frontera(sql),
    capturadorFederacionTelemetria: { async capturarReglaEnTransaccion() {} },
    permitirMomentoUtcRelativo: true,
    permitirPrevisualizacionMomentoUtcRelativo: true,
    leerAhoraUtcSql: async () => sql.instante
  });
}

async function insertarFotografia(sql, base, senal) {
  const lote = await new RepositorioObservacionesTelemetriaAgentes(sql)
    .insertarLoteAceptado({
      agenteId: base.agenteId,
      senalesCatalogadas: [senal],
      recibidoEnUtc: N0,
      observacionesAceptadas: [crearLecturaTelemetriaAgenteConTiposInternos({
        categoria: senal.categoria,
        clave: senal.clave,
        tipoDato: 'momento_utc',
        valorMomentoUtc: '2026-09-05T12:02:00Z',
        calidad: 'valida',
        observadoEnUtc: N0
      })]
    });
  await new RepositorioEstadoActualTelemetriaAgentes(sql)
    .aplicarObservacionesHistoricas(lote.insertadas);
  return lote.insertadas[0];
}

async function crearBase(sql) {
  const alias = `fixture-524a7b-${randomBytes(4).toString('hex')}`;
  const [tenant] = await sql.ejecutar('INSERT INTO tenants (nombre,alias) VALUES (?,?)',
    ['Tenant 5.24a.7b', alias]);
  const [empresa] = await sql.ejecutar(
    'INSERT INTO empresas (tenant_id,nombre,alias) VALUES (?,?,?)',
    [tenant.insertId, 'Empresa 5.24a.7b', alias]
  );
  const [sitio] = await sql.ejecutar(
    'INSERT INTO sitios (tenant_id,empresa_id,nombre,alias) VALUES (?,?,?,?)',
    [tenant.insertId, empresa.insertId, 'Sitio 5.24a.7b', alias]
  );
  const [agente] = await sql.ejecutar(
    `INSERT INTO agentes_sentinelia
       (guid,tenant_id,empresa_id,sitio_id,nombre,secreto_hash)
     VALUES (?,?,?,?,?,?)`,
    [randomUUID(), tenant.insertId, empresa.insertId, sitio.insertId,
      'Agente relativo productivo', 'sin-secreto-utilizable']
  );
  return {
    agenteId: Number(agente.insertId),
    tenantId: Number(tenant.insertId),
    empresaId: Number(empresa.insertId),
    sitioId: Number(sitio.insertId)
  };
}

function estadoDesdeEvaluacion(fila) {
  return {
    reglaId: Number(fila.regla_id), revisionId: Number(fila.regla_revision_id),
    observacionId: Number(fila.observacion_id), agenteId: Number(fila.agente_id),
    senalId: Number(fila.senal_id), tenantId: Number(fila.tenant_id),
    empresaId: Number(fila.empresa_id), sitioId: Number(fila.sitio_id),
    resultado: fila.resultado, codigoMotivo: fila.codigo_motivo,
    explicacion: fila.explicacion, condicionCanonica: fila.condicion_canonica,
    severidadCalculada: fila.severidad_calculada,
    mensajeOperativo: fila.mensaje_operativo,
    evidenciaContextual: fila.evidencia_contextual,
    valorEvaluado: fila.valor_evaluado, calidad: fila.calidad,
    observadoEnUtc: fila.observado_en_utc, recibidoEnUtc: fila.recibido_en_utc,
    evaluadoEnUtc: fila.evaluado_en_utc
  };
}

function frontera(sql) {
  return {
    async ejecutar(trabajo) {
      const conexion = await sql.obtenerConexion();
      try {
        await conexion.beginTransaction();
        const resultado = await trabajo(conexion);
        await conexion.commit();
        return resultado;
      } catch (error) {
        await conexion.rollback();
        throw error;
      } finally {
        conexion.release();
      }
    }
  };
}

class ClienteSqlConReloj {
  constructor(base, instante) {
    this.base = base;
    this.fijar(instante);
  }

  fijar(instante) {
    const fecha = new Date(instante);
    if (Number.isNaN(fecha.getTime())) throw new Error('Reloj fixture inválido.');
    this.instante = fecha.toISOString().replace(/\.000Z$/u, 'Z');
    this.epoch = Math.floor(fecha.getTime() / 1000);
  }

  async obtenerConexion() {
    const conexion = await this.base.obtenerConexion();
    await conexion.query(`SET timestamp = ${this.epoch}`);
    return conexion;
  }

  async ejecutar(sql, parametros = []) {
    const conexion = await this.obtenerConexion();
    try {
      return await conexion.execute(sql, parametros);
    } finally {
      conexion.release();
    }
  }

  async consultar(sql, parametros = []) {
    const [filas] = await this.ejecutar(sql, parametros);
    return filas;
  }
}

async function leer(ruta) {
  return readFile(new URL(`../${ruta}`, import.meta.url), 'utf8');
}

await main();

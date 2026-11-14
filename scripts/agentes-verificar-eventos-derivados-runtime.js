import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { DespachadorEvaluacionesTelemetriaRuntime } from '../apps/sentinelia-runtime/src/telemetria/DespachadorEvaluacionesTelemetriaRuntime.js';
import { SuscriptorAvisosEvaluacionTelemetriaRedis } from '../apps/sentinelia-runtime/src/telemetria/SuscriptorAvisosEvaluacionTelemetriaRedis.js';
import { EvaluadorCondicionesDerivacionTelemetria } from '../paquetes/agentes/src/EvaluadorCondicionesDerivacionTelemetria.js';
import {
  CondicionDerivacionTelemetria,
  ReglaDerivacionTelemetria,
  RevisionReglaDerivacionTelemetria
} from '../paquetes/agentes/src/EventosDerivadosTelemetriaAgentes.js';
import { ProcesadorTrabajosEvaluacionTelemetria } from '../paquetes/agentes/src/ProcesadorTrabajosEvaluacionTelemetria.js';
import { ProyectorEvaluacionesDerivadasTelemetria } from '../paquetes/agentes/src/ProyectorEvaluacionesDerivadasTelemetria.js';

const rutaRepositorio = new URL(
  '../paquetes/agentes/src/RepositorioTrabajosEvaluacionTelemetria.js',
  import.meta.url
);
const rutaProcesador = new URL(
  '../paquetes/agentes/src/ProcesadorTrabajosEvaluacionTelemetria.js',
  import.meta.url
);
const rutaBootstrap = new URL(
  '../apps/sentinelia-runtime/src/BootstrapRuntime.js',
  import.meta.url
);
const rutaRuntime = new URL(
  '../apps/sentinelia-runtime/src/RuntimeSentinelia.js',
  import.meta.url
);

async function main() {
  await verificarContratoReclamacionRuntime();
  await verificarEvaluacionYFinalizacionAtomica();
  await verificarCoordinacionEntreInstancias();
  await verificarErrorReintentoYRecuperacion();
  await verificarRecuperacionDeLeaseExpirado();
  await verificarAvisoRedisSoloDespierta();

  console.log(
    '[agentes-telemetria] OK evaluador Runtime, reclamación y reintentos verificados hasta 5.20a.7'
  );
}

async function verificarContratoReclamacionRuntime() {
  const [repositorio, procesador, bootstrap, runtime] = await Promise.all([
    readFile(rutaRepositorio, 'utf8'),
    readFile(rutaProcesador, 'utf8'),
    readFile(rutaBootstrap, 'utf8'),
    readFile(rutaRuntime, 'utf8')
  ]);

  for (const fragmento of [
    'FOR UPDATE SKIP LOCKED',
    'intentos = intentos + 1',
    "estado = 'procesando'",
    'reclamo_expira_en_utc <= UTC_TIMESTAMP(6)',
    'reclamado_en_utc = UTC_TIMESTAMP(6)',
    "estado = 'error'",
    'siguiente_intento_utc = TIMESTAMPADD(',
    "estado = 'completado'",
    'AND reclamado_por = ?'
  ]) {
    assert.ok(
      repositorio.includes(fragmento),
      `La reclamación SQL debe contener: ${fragmento}`
    );
  }
  assert.ok(procesador.includes('persistirEfectosYCompletar'));
  assert.ok(
    procesador.indexOf('proyectorEvaluaciones.proyectar(') <
      procesador.indexOf('marcarCompletado(')
  );
  assert.equal(
    /periodos_vida_pol|ultimo_heartbeat|cerrarPeriodoVidaPol/i.test(procesador),
    false,
    'El evaluador no debe conocer ni modificar POL.'
  );
  assert.ok(bootstrap.includes('ProcesadorTrabajosEvaluacionTelemetria'));
  assert.ok(runtime.includes('DespachadorEvaluacionesTelemetriaRuntime'));
  assert.ok(runtime.includes('ultimaPersistenciaEvaluacionTelemetria'));
  assert.ok(runtime.includes('SuscriptorAvisosEvaluacionTelemetriaRedis'));
}

async function verificarEvaluacionYFinalizacionAtomica() {
  const entorno = crearEntorno();
  const resumen = await entorno.despachador.procesarPendientes({
    origen: 'prueba',
    numeroTick: 1
  });

  assert.equal(resumen.totalReclamados, 1);
  assert.equal(resumen.totalCompletados, 1);
  assert.equal(resumen.totalErrores, 0);
  assert.equal(entorno.trabajo.estado, 'completado');
  assert.equal(entorno.trabajo.intentos, 1);
  assert.deepEqual(entorno.revisionesConsultadas, [101]);
  assert.equal(entorno.estados.length, 1);
  assert.equal(entorno.estados[0].resultado, 'coincide');
  assert.equal(entorno.eventos.length, 1);
  assert.equal(entorno.eventos[0].revisionId, 101);
  assert.equal(entorno.eventos[0].valorEvaluado, 85);
  assert.deepEqual(
    entorno.orden.filter((paso) =>
      ['persistir_estado', 'persistir_evento', 'completar_trabajo', 'commit'].includes(paso)
    ),
    ['persistir_estado', 'persistir_evento', 'completar_trabajo', 'commit']
  );
}

async function verificarCoordinacionEntreInstancias() {
  const entorno = crearEntorno();
  const segundoDespachador = crearDespachador({
    entorno,
    instanciaId: 'runtime-b',
    idReclamacion: 'reclamo-b'
  });
  const [primero, segundo] = await Promise.all([
    entorno.despachador.procesarPendientes({ origen: 'concurrente', numeroTick: 2 }),
    segundoDespachador.procesarPendientes({ origen: 'concurrente', numeroTick: 2 })
  ]);

  assert.equal(primero.totalReclamados + segundo.totalReclamados, 1);
  assert.equal(primero.totalCompletados + segundo.totalCompletados, 1);
  assert.equal(entorno.eventos.length, 1);
  assert.equal(entorno.trabajo.intentos, 1);
}

async function verificarErrorReintentoYRecuperacion() {
  const entorno = crearEntorno({ fallarPersistenciaEvento: true });
  const primera = await entorno.despachador.procesarPendientes({
    origen: 'fallo',
    numeroTick: 3
  });

  assert.equal(primera.totalErrores, 1);
  assert.equal(entorno.trabajo.estado, 'error');
  assert.equal(entorno.trabajo.intentos, 1);
  assert.equal(entorno.trabajo.ultimo_codigo_error, 'ER_EVENTO_SIMULADO');
  assert.match(entorno.trabajo.ultimo_mensaje_error, /evento derivado/);
  assert.equal(entorno.estados.length, 0, 'El estado parcial debe revertirse.');
  assert.equal(entorno.eventos.length, 0);
  assert.equal(entorno.observaciones.length, 1, 'La ingesta confirmada permanece.');
  assert.deepEqual(entorno.periodosPol, [{ id: 41, estado: 'abierto' }]);

  const antesDeTiempo = await entorno.despachador.procesarPendientes({
    origen: 'fallo',
    numeroTick: 4
  });
  assert.equal(antesDeTiempo.totalReclamados, 0);

  entorno.avanzarMs(5000);
  entorno.repositorioEventosDerivados.fallar = false;
  const reintento = await entorno.despachador.procesarPendientes({
    origen: 'reintento',
    numeroTick: 5
  });

  assert.equal(reintento.totalCompletados, 1);
  assert.equal(entorno.trabajo.estado, 'completado');
  assert.equal(entorno.trabajo.intentos, 2);
  assert.equal(entorno.estados.length, 1);
  assert.equal(entorno.eventos.length, 1);
  assert.equal(entorno.observaciones.length, 1);
  assert.deepEqual(entorno.periodosPol, [{ id: 41, estado: 'abierto' }]);
}

async function verificarRecuperacionDeLeaseExpirado() {
  const entorno = crearEntorno();
  entorno.trabajo.estado = 'procesando';
  entorno.trabajo.reclamadoPor = 'runtime-caido:reclamo-antiguo';
  entorno.trabajo.reclamadoEnUtc = new Date(entorno.ahoraMs - 60_000).toISOString();
  entorno.trabajo.reclamoExpiraEnUtc = new Date(entorno.ahoraMs - 30_000).toISOString();

  const resumen = await entorno.despachador.procesarPendientes({
    origen: 'recuperacion',
    numeroTick: 6
  });

  assert.equal(resumen.totalReclamados, 1);
  assert.equal(resumen.totalCompletados, 1);
  assert.equal(entorno.trabajo.estado, 'completado');
  assert.equal(entorno.trabajo.intentos, 1);
}

async function verificarAvisoRedisSoloDespierta() {
  const clienteSuscriptor = new ClienteSuscriptorRedisFalso();
  const avisos = [];
  const suscriptor = new SuscriptorAvisosEvaluacionTelemetriaRedis({
    clienteRedis: {
      duplicate() {
        return clienteSuscriptor;
      }
    },
    canal: 'sentinelia:runtime:telemetria:evaluacion:pendiente',
    onAviso: (aviso) => avisos.push(aviso)
  });

  const arrancado = await suscriptor.arrancar();
  assert.equal(arrancado.activo, true);
  clienteSuscriptor.emitir('texto no JSON');
  clienteSuscriptor.emitir(JSON.stringify({ tipo: 'otro', totalTrabajos: 1 }));
  clienteSuscriptor.emitir(JSON.stringify({
    tipo: 'trabajos_evaluacion_telemetria_pendientes',
    totalTrabajos: 2
  }));
  assert.equal(avisos.length, 1);
  assert.equal(avisos[0].totalTrabajos, 2);

  const detenido = await suscriptor.detener();
  assert.equal(detenido.activo, false);
  assert.equal(clienteSuscriptor.desuscrito, true);
  assert.equal(clienteSuscriptor.cerrado, true);
}

function crearEntorno({ fallarPersistenciaEvento = false } = {}) {
  const orden = [];
  const estados = [];
  const eventos = [];
  const observaciones = [crearObservacion()];
  const periodosPol = [{ id: 41, estado: 'abierto' }];
  const revisionesConsultadas = [];
  const entorno = {
    ahoraMs: new Date('2026-07-20T12:00:00Z').getTime(),
    avanzarMs(ms) {
      this.ahoraMs += ms;
    }
  };
  const clienteSql = new ClienteSqlEfectosFalso({ orden });
  const trabajo = crearTrabajo();
  const repositorioTrabajos = new RepositorioTrabajosRuntimeFalso({
    trabajo,
    clienteSql,
    entorno,
    orden
  });
  const repositorioEventosDerivados = new RepositorioEventosFalso({
    eventos,
    orden,
    fallar: fallarPersistenciaEvento
  });
  const procesador = new ProcesadorTrabajosEvaluacionTelemetria({
    repositorioTrabajos,
    repositorioReglas: {
      async buscarPorId(id) {
        assert.equal(id, 31);
        return { regla: crearReglaDeshabilitada() };
      },
      async buscarRevisionPorId(id) {
        revisionesConsultadas.push(id);
        return id === 101 ? crearRevisionHistorica() : null;
      }
    },
    repositorioObservaciones: {
      async buscarPorId(id) {
        return observaciones.find((observacion) => observacion.id === id) || null;
      }
    },
    repositorioCatalogoSenales: {
      async buscarPorId(id) {
        return id === 23 ? crearSenal() : null;
      }
    },
    proyectorEvaluaciones: new ProyectorEvaluacionesDerivadasTelemetria({
      repositorioEstadoActual: new RepositorioEstadoFalso({ estados, orden }),
      repositorioEventosDerivados
    }),
    evaluador: new EvaluadorCondicionesDerivacionTelemetria(),
    reintentoBaseSegundos: 5,
    reintentoMaximoSegundos: 60,
    reloj: () => new Date(entorno.ahoraMs)
  });

  Object.assign(entorno, {
    orden,
    estados,
    eventos,
    observaciones,
    periodosPol,
    revisionesConsultadas,
    trabajo,
    repositorioTrabajos,
    repositorioEventosDerivados,
    procesador
  });
  entorno.despachador = crearDespachador({
    entorno,
    instanciaId: 'runtime-a',
    idReclamacion: 'reclamo-a'
  });
  return entorno;
}

function crearDespachador({ entorno, instanciaId, idReclamacion }) {
  return new DespachadorEvaluacionesTelemetriaRuntime({
    repositorioTrabajos: entorno.repositorioTrabajos,
    procesadorTrabajos: entorno.procesador,
    instanciaId,
    loteMaximo: 10,
    reclamoTtlSegundos: 30,
    reloj: () => new Date(entorno.ahoraMs),
    generarIdReclamacion: () => idReclamacion
  });
}

class RepositorioTrabajosRuntimeFalso {
  constructor({ trabajo, clienteSql, entorno, orden }) {
    this.trabajo = trabajo;
    this.clienteSql = clienteSql;
    this.entorno = entorno;
    this.orden = orden;
  }

  async reclamarSiguientes({ reclamadoPor, limite, ttlSegundos }) {
    const ahora = this.entorno.ahoraMs;
    const reclamable = (
      ['pendiente', 'error'].includes(this.trabajo.estado) &&
      new Date(this.trabajo.siguienteIntentoUtc).getTime() <= ahora
    ) || (
      this.trabajo.estado === 'procesando' &&
      new Date(this.trabajo.reclamoExpiraEnUtc).getTime() <= ahora
    );
    if (!reclamable || limite < 1) {
      return [];
    }

    this.trabajo.estado = 'procesando';
    this.trabajo.intentos += 1;
    this.trabajo.reclamadoPor = reclamadoPor;
    this.trabajo.reclamadoEnUtc = new Date(ahora).toISOString();
    this.trabajo.reclamoExpiraEnUtc =
      new Date(ahora + ttlSegundos * 1000).toISOString();
    this.orden.push('reclamar_trabajo');
    return [this.trabajo];
  }

  async marcarCompletado({ trabajoId, reclamadoPor }, { conexion }) {
    this.asegurarPropiedad(trabajoId, reclamadoPor);
    this.orden.push('completar_trabajo');
    conexion.aplicarAlConfirmar(() => {
      this.trabajo.estado = 'completado';
      this.trabajo.reclamadoPor = null;
      this.trabajo.reclamadoEnUtc = null;
      this.trabajo.reclamoExpiraEnUtc = null;
      this.trabajo.ultimo_codigo_error = null;
      this.trabajo.ultimo_mensaje_error = null;
    });
  }

  async registrarErrorTecnico({
    trabajoId,
    reclamadoPor,
    codigoError,
    mensajeError,
    demoraReintentoSegundos
  }) {
    this.asegurarPropiedad(trabajoId, reclamadoPor);
    this.trabajo.estado = 'error';
    this.trabajo.siguienteIntentoUtc = new Date(
      this.entorno.ahoraMs + demoraReintentoSegundos * 1000
    ).toISOString();
    this.trabajo.reclamadoPor = null;
    this.trabajo.reclamadoEnUtc = null;
    this.trabajo.reclamoExpiraEnUtc = null;
    this.trabajo.ultimo_codigo_error = codigoError;
    this.trabajo.ultimo_mensaje_error = mensajeError;
    this.orden.push('registrar_error');
    return {
      registrado: true,
      siguienteIntentoUtc: this.trabajo.siguienteIntentoUtc
    };
  }

  asegurarPropiedad(trabajoId, reclamadoPor) {
    if (
      this.trabajo.id !== trabajoId ||
      this.trabajo.estado !== 'procesando' ||
      this.trabajo.reclamadoPor !== reclamadoPor
    ) {
      throw new Error('La reclamación del trabajo ya no pertenece al Runtime.');
    }
  }
}

class ClienteSuscriptorRedisFalso {
  constructor() {
    this.isOpen = false;
    this.callback = null;
    this.desuscrito = false;
    this.cerrado = false;
  }

  on() {}

  async connect() {
    this.isOpen = true;
  }

  async subscribe(_canal, callback) {
    this.callback = callback;
  }

  emitir(mensaje) {
    this.callback(mensaje);
  }

  async unsubscribe() {
    this.desuscrito = true;
  }

  async quit() {
    this.isOpen = false;
    this.cerrado = true;
  }
}

class ClienteSqlEfectosFalso {
  constructor({ orden }) {
    this.orden = orden;
  }

  async obtenerConexion() {
    return new ConexionEfectosFalsa(this.orden);
  }
}

class ConexionEfectosFalsa {
  constructor(orden) {
    this.orden = orden;
    this.operaciones = [];
  }

  async beginTransaction() {
    this.orden.push('begin_efectos');
  }

  aplicarAlConfirmar(operacion) {
    this.operaciones.push(operacion);
  }

  async commit() {
    this.orden.push('commit');
    for (const operacion of this.operaciones) {
      operacion();
    }
    this.operaciones = [];
  }

  async rollback() {
    this.orden.push('rollback');
    this.operaciones = [];
  }

  release() {
    this.orden.push('release');
  }
}

class RepositorioEstadoFalso {
  constructor({ estados, orden }) {
    this.estados = estados;
    this.orden = orden;
  }

  async aplicarResultado(resultado, { conexion }) {
    const serializado = resultado.serializar();
    this.orden.push('persistir_estado');
    conexion.aplicarAlConfirmar(() => this.estados.push(serializado));
    return {
      actualizado: true,
      gobiernaEstadoActual: true,
      estado: serializado
    };
  }
}

class RepositorioEventosFalso {
  constructor({ eventos, orden, fallar }) {
    this.eventos = eventos;
    this.orden = orden;
    this.fallar = fallar;
  }

  async insertarSiCoincide(resultado, { conexion }) {
    this.orden.push('persistir_evento');
    if (this.fallar) {
      const error = new Error('Fallo simulado persistiendo evento derivado.');
      error.code = 'ER_EVENTO_SIMULADO';
      throw error;
    }
    const serializado = resultado.serializar();
    conexion.aplicarAlConfirmar(() => this.eventos.push(serializado));
    return {
      creado: resultado.coincide(),
      motivo: resultado.coincide() ? 'evento_creado' : 'resultado_no_coincidente',
      evento: resultado.coincide() ? serializado : null
    };
  }
}

function crearTrabajo() {
  return {
    id: 701,
    observacionId: 501,
    reglaId: 31,
    reglaRevisionId: 101,
    agenteId: 7,
    senalId: 23,
    tenantId: 1,
    empresaId: 2,
    sitioId: 3,
    recibidoEnUtc: '2026-07-10T10:00:00.000Z',
    estado: 'pendiente',
    intentos: 0,
    siguienteIntentoUtc: '2026-07-10T10:00:00.000Z',
    reclamadoPor: null,
    reclamadoEnUtc: null,
    reclamoExpiraEnUtc: null,
    ultimo_codigo_error: null,
    ultimo_mensaje_error: null
  };
}

function crearReglaDeshabilitada() {
  return new ReglaDerivacionTelemetria({
    id: 31,
    agente: { id: 7, tenantId: 1, empresaId: 2, sitioId: 3 },
    senal: { id: 23, agenteId: 7 },
    scope: { tenantId: 1, empresaId: 2, sitioId: 3 },
    estado: 'deshabilitada',
    revisionVigenteId: 102
  });
}

function crearRevisionHistorica() {
  return new RevisionReglaDerivacionTelemetria({
    id: 101,
    reglaId: 31,
    numero: 1,
    condicion: new CondicionDerivacionTelemetria({
      tipo: 'numero',
      version: 1,
      configuracion: {
        operador: '>',
        umbral: 80,
        unidad: 'ºC'
      }
    }),
    severidadCalculada: 'advertencia',
    mensajeOperativo: 'Temperatura fuera del rango operativo.',
    nombre: 'Temperatura elevada',
    vigenteDesdeUtc: '2026-07-01T00:00:00Z',
    vigenteHastaUtc: '2026-07-15T00:00:00Z'
  });
}

function crearSenal() {
  return {
    id: 23,
    agenteId: 7,
    tipoDato: 'numero',
    unidad: 'ºC'
  };
}

function crearObservacion() {
  return {
    id: 501,
    agenteId: 7,
    senalId: 23,
    tipoDato: 'numero',
    unidad: 'ºC',
    valorNumero: 85,
    valorBooleano: null,
    valorTexto: null,
    valorEstado: null,
    valorJson: null,
    calidad: 'valida',
    observadoEnUtc: '2026-07-10T09:59:58.000Z',
    recibidoEnUtc: '2026-07-10T10:00:00.000Z',
    serializar() {
      const { serializar: _serializar, ...datos } = this;
      return { ...datos };
    }
  };
}

main().catch((error) => {
  console.error('[agentes-telemetria] Error verificando Runtime 5.20a.7');
  console.error(error);
  process.exit(1);
});

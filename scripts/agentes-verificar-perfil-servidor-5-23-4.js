import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import {
  EstadoRuntimeServidorAgente,
  EvidenciaPolServidorAgente
} from '../paquetes/agentes/src/EstadoRuntimeServidorAgente.js';
import {
  RepositorioEstadoRuntimeServidorAgentes
} from '../paquetes/agentes/src/RepositorioEstadoRuntimeServidorAgentes.js';
import {
  PublicadorAvisosPerfilServidorRedis
} from '../paquetes/agentes/src/PublicadorAvisosPerfilServidorRedis.js';
import {
  ServicioAutenticacionAgentes
} from '../paquetes/agentes/src/ServicioAutenticacionAgentes.js';
import {
  ProcesadorSenalesServidorRuntime
} from '../apps/sentinelia-runtime/src/agentes/ProcesadorSenalesServidorRuntime.js';
import {
  SuscriptorAvisosPerfilServidorRedis
} from '../apps/sentinelia-runtime/src/agentes/SuscriptorAvisosPerfilServidorRedis.js';

const RAIZ = new URL('../', import.meta.url);
const AHORA = new Date('2026-08-24T14:10:00.000Z');

await main();

async function main() {
  verificarEvidenciaPolCompacta();
  await verificarRepositorioMonotono();
  await verificarArmadoPosteriorYFotografiaInicial();
  await verificarHeartbeatArmaSesionPreexistente();
  await verificarRenovacionSinTelemetriaRedundante();
  await verificarRecuperacionInmediata();
  await verificarAvisoRedisDescartable();
  await verificarFalloAvisoNoRechazaPol();
  await verificarSuscriptorSoloDespierta();
  await verificarComposicionYDocumentacion();

  console.log(
    '[agentes] OK 5.23.4: login=pol heartbeat=renovacion ' +
    'armado=posterior monotonicidad=periodo_seq recuperacion=inmediata ' +
    'redis=aviso_descartable reconciliacion=sql bootid=fuera_5_23_4'
  );
}

function verificarEvidenciaPolCompacta() {
  const periodo = crearEvidencia();
  assert.deepEqual(periodo.obtenerUltimaPresencia(), {
    tipo: 'heartbeat',
    observadoEnUtc: '2026-08-24T14:03:00.000Z',
    seq: 8
  });
  assert.deepEqual(
    periodo.obtenerPrimeraPresenciaPosterior('2026-08-24T13:59:59.000Z'),
    {
      tipo: 'login',
      observadoEnUtc: '2026-08-24T14:00:00.000Z',
      seq: null
    }
  );
  assert.deepEqual(
    periodo.obtenerPrimeraPresenciaPosterior('2026-08-24T14:00:01.000Z'),
    {
      tipo: 'heartbeat',
      observadoEnUtc: '2026-08-24T14:03:00.000Z',
      seq: 8
    }
  );
  assert.equal(
    periodo.obtenerPrimeraPresenciaPosterior('2026-08-24T14:03:01.000Z'),
    null
  );
  assert.throws(
    () => crearEvidencia({ ultimo_seq: null }),
    /exige una secuencia durable/u
  );
}

async function verificarRepositorioMonotono() {
  const operaciones = [];
  const conexion = {
    async execute(sql, parametros) {
      operaciones.push({ sql, parametros });
      if (sql.includes('INNER JOIN periodos_vida_pol_agentes pol')) {
        return [[filaCandidataPolSql()], []];
      }
      if (sql.includes('UPDATE perfiles_servidor_agentes')) {
        return [{ affectedRows: 1 }, []];
      }
      if (sql.includes('UPDATE estados_runtime_servidor_agentes')) {
        return [{ affectedRows: 1 }, []];
      }
      if (sql.includes('FROM estados_runtime_servidor_agentes e')) {
        return [[filaEstadoAplicadoSql()], []];
      }
      throw new Error(`SQL no esperado: ${sql}`);
    }
  };
  const repositorio = new RepositorioEstadoRuntimeServidorAgentes({});
  const candidatos = await repositorio.bloquearCandidatosPolEnTransaccion(
    { limite: 25 },
    { conexion }
  );
  assert.equal(candidatos.length, 1);
  assert.equal(candidatos[0].evidencia.periodoVidaPolId, 41);
  assert.equal(candidatos[0].evidencia.ultimoSeq, 8);
  const seleccion = operaciones[0];
  assert.match(seleccion.sql, /FOR UPDATE SKIP LOCKED/u);
  assert.match(seleccion.sql, /pol_candidato\.inicio_utc > p\.generada_en_utc/u);
  assert.match(seleccion.sql, /pol_candidato\.ultimo_seq > e\.ultimo_seq/u);
  assert.match(seleccion.sql, /ORDER BY pol_candidato\.id ASC/u);

  const estado = await repositorio.aplicarPolEnTransaccion({
    agenteId: 7,
    generacion: 2,
    armarPerfil: true,
    armadaEnUtc: '2026-08-24T14:00:00.000Z',
    bootIdReferencia: 'boot-a',
    periodoVidaPolId: 41,
    ultimoSeq: 8,
    ultimoPolUtc: '2026-08-24T14:03:00.000Z',
    tipoUltimoPol: 'heartbeat',
    valorSinPol: false,
    venceSinPolUtc: '2026-08-24T14:05:00.000Z',
    histeresisSinPolCapturadaSegundos: 120,
    valorReinicioReciente: false,
    checkpointCausal: 'pol:41|seq:8'
  }, { conexion });
  assert.equal(estado.ultimoPeriodoPolId, 41);
  assert.equal(estado.ultimoSeq, 8);
  const actualizacion = operaciones.find(({ sql }) =>
    sql.includes('UPDATE estados_runtime_servidor_agentes')
  );
  assert.match(actualizacion.sql, /ultimo_periodo_pol_id < \?/u);
  assert.match(actualizacion.sql, /ultimo_seq < \?/u);
  assert.match(actualizacion.sql, /histeresis_sin_pol_capturada_segundos = \?/u);
}

async function verificarArmadoPosteriorYFotografiaInicial() {
  const perfil = crearPerfil({
    estado: 'pendiente_primera_evidencia',
    generadaEnUtc: '2026-08-24T13:59:30.000Z'
  });
  const estado = crearEstadoPendiente();
  const entorno = crearEntornoProcesador({
    candidatosPol: [{ perfil, estado, evidencia: crearEvidencia() }],
    estadoAplicado: crearEstado({
      boot_id_referencia: 'boot-a',
      ultimo_periodo_pol_id: 41,
      ultimo_seq: 8,
      ultimo_pol_utc: '2026-08-24 14:03:00.000',
      tipo_ultimo_pol: 'heartbeat',
      valor_sin_pol: 0,
      vence_sin_pol_utc: '2026-08-24 14:05:00.000',
      histeresis_sin_pol_capturada_segundos: 120,
      valor_reinicio_reciente: 0,
      checkpoint_causal: 'armado',
      version_estado: 2
    })
  });
  const resultado = await entorno.procesador.procesarPendientes({
    origen: 'prueba_armado'
  });

  assert.equal(resultado.totalPerfilesArmados, 1);
  assert.equal(resultado.totalEvidenciasPolReducidas, 1);
  assert.equal(resultado.totalTransiciones, 2);
  assert.deepEqual(
    entorno.publicaciones[0].transiciones.map(({ codigoSenal, valor }) => ({
      codigoSenal,
      valor
    })),
    [
      { codigoSenal: 'runtime.servidor.sin_pol', valor: false },
      { codigoSenal: 'runtime.servidor.reinicio_reciente', valor: false }
    ]
  );
  assert(entorno.publicaciones[0].transiciones.every(
    ({ observadoEnUtc }) => observadoEnUtc === '2026-08-24T14:00:00.000Z'
  ));
  assert.equal(entorno.aplicaciones[0].armarPerfil, true);
  assert.equal(entorno.aplicaciones[0].armadaEnUtc, '2026-08-24T14:00:00.000Z');
  assert.equal(entorno.aplicaciones[0].ultimoPolUtc, '2026-08-24T14:03:00.000Z');
  assert.equal(entorno.aplicaciones[0].venceSinPolUtc, '2026-08-24T14:05:00.000Z');
}

async function verificarRenovacionSinTelemetriaRedundante() {
  const estado = crearEstado({
    ultimo_periodo_pol_id: 41,
    ultimo_seq: 7,
    ultimo_pol_utc: '2026-08-24 14:02:00.000',
    tipo_ultimo_pol: 'heartbeat',
    valor_sin_pol: 0,
    vence_sin_pol_utc: '2026-08-24 14:04:00.000',
    valor_reinicio_reciente: 0
  });
  const entorno = crearEntornoProcesador({
    candidatosPol: [{
      perfil: crearPerfil(),
      estado,
      evidencia: crearEvidencia()
    }],
    estadoAplicado: crearEstado({
      ultimo_periodo_pol_id: 41,
      ultimo_seq: 8,
      ultimo_pol_utc: '2026-08-24 14:03:00.000',
      tipo_ultimo_pol: 'heartbeat',
      valor_sin_pol: 0,
      vence_sin_pol_utc: '2026-08-24 14:05:00.000',
      valor_reinicio_reciente: 0,
      version_estado: 4
    })
  });
  const resultado = await entorno.procesador.procesarPendientes();
  assert.equal(resultado.totalEvidenciasPolReducidas, 1);
  assert.equal(resultado.totalTransiciones, 0);
  assert.equal(entorno.publicaciones.length, 0);
  assert.equal(entorno.aplicaciones[0].ultimoSeq, 8);
  assert.equal(entorno.aplicaciones[0].histeresisSinPolCapturadaSegundos, 120);
}

async function verificarHeartbeatArmaSesionPreexistente() {
  const perfil = crearPerfil({
    estado: 'pendiente_primera_evidencia',
    generadaEnUtc: '2026-08-24T14:01:00.000Z'
  });
  const entorno = crearEntornoProcesador({
    candidatosPol: [{
      perfil,
      estado: crearEstadoPendiente(),
      evidencia: crearEvidencia()
    }],
    estadoAplicado: crearEstado({
      ultimo_periodo_pol_id: 41,
      ultimo_seq: 8,
      ultimo_pol_utc: '2026-08-24 14:03:00.000',
      tipo_ultimo_pol: 'heartbeat',
      valor_sin_pol: 0,
      vence_sin_pol_utc: '2026-08-24 14:05:00.000',
      valor_reinicio_reciente: 0,
      version_estado: 2
    })
  });
  const resultado = await entorno.procesador.procesarPendientes();
  assert.equal(resultado.totalPerfilesArmados, 1);
  assert.equal(entorno.aplicaciones[0].armadaEnUtc,
    '2026-08-24T14:03:00.000Z');
  assert(entorno.publicaciones[0].transiciones.every(
    ({ observadoEnUtc }) => observadoEnUtc === '2026-08-24T14:03:00.000Z'
  ));
}

async function verificarRecuperacionInmediata() {
  const estado = crearEstado({
    ultimo_periodo_pol_id: 40,
    ultimo_seq: 12,
    ultimo_pol_utc: '2026-08-24 13:30:00.000',
    tipo_ultimo_pol: 'heartbeat',
    valor_sin_pol: 1,
    vence_sin_pol_utc: null,
    valor_reinicio_reciente: 0
  });
  const entorno = crearEntornoProcesador({
    candidatosPol: [{
      perfil: crearPerfil(),
      estado,
      evidencia: crearEvidencia({
        ultimo_heartbeat_utc: '2026-08-24 14:09:00.000',
        ultimo_seq: 9,
        heartbeats_recibidos: 9
      })
    }],
    estadoAplicado: crearEstado({
      ultimo_periodo_pol_id: 41,
      ultimo_seq: 9,
      ultimo_pol_utc: '2026-08-24 14:09:00.000',
      tipo_ultimo_pol: 'heartbeat',
      valor_sin_pol: 0,
      vence_sin_pol_utc: '2026-08-24 14:11:00.000',
      valor_reinicio_reciente: 0,
      version_estado: 6
    })
  });
  const resultado = await entorno.procesador.procesarPendientes();
  assert.equal(resultado.totalTransiciones, 1);
  assert.equal(entorno.publicaciones[0].transiciones[0].codigoSenal,
    'runtime.servidor.sin_pol');
  assert.equal(entorno.publicaciones[0].transiciones[0].valor, false);
  assert.equal(
    entorno.publicaciones[0].transiciones[0].observadoEnUtc,
    '2026-08-24T14:00:00.000Z'
  );
  assert.equal(entorno.registradas[0].causa, 'pol_recuperado');
}

async function verificarAvisoRedisDescartable() {
  const llamadas = [];
  const publicador = new PublicadorAvisosPerfilServidorRedis({
    clienteRedis: {
      async publish(canal, mensaje) {
        llamadas.push({ canal, mensaje: JSON.parse(mensaje) });
        return 2;
      }
    },
    canal: 'prueba:perfil-servidor:avisos',
    reloj: () => AHORA
  });
  const resultado = await publicador.publicarPolAceptado({
    agenteId: 7,
    periodoVidaPolId: 41,
    tipoPol: 'heartbeat',
    seq: 8,
    recibidoEnUtc: '2026-08-24T14:03:00.000Z'
  });
  assert.equal(resultado.receptores, 2);
  assert.equal(llamadas[0].mensaje.tipo, 'perfil_servidor_pol_aceptado');
  assert.equal(llamadas[0].mensaje.agenteId, 7);
  assert.equal(Object.hasOwn(llamadas[0].mensaje, 'bootId'), false);
}

async function verificarFalloAvisoNoRechazaPol() {
  const servicio = new ServicioAutenticacionAgentes({
    repositorioAgentes: {},
    repositorioSesionesAgentesRedis: {},
    perfilServidorHabilitado: true,
    publicadorAvisosPerfilServidor: {
      async publicarPolAceptado() {
        throw new Error('Redis caído');
      }
    }
  });
  const avisos = [];
  const warn = console.warn;
  console.warn = (...argumentos) => avisos.push(argumentos);
  try {
    const resultado = await servicio.publicarAvisoPolPerfilServidorBestEffort({
      agenteId: 7,
      periodoVidaPolId: 41,
      tipoPol: 'login',
      recibidoEnUtc: AHORA
    });
    assert.equal(resultado.publicado, false);
    assert.equal(resultado.motivo, 'redis_no_disponible');
    assert.equal(avisos.length, 2);
  } finally {
    console.warn = warn;
  }
}

async function verificarSuscriptorSoloDespierta() {
  const recibidos = [];
  const suscriptor = new SuscriptorAvisosPerfilServidorRedis({
    clienteRedis: { duplicate() {} },
    canal: 'prueba:avisos',
    onAviso: async (aviso) => recibidos.push(aviso)
  });
  suscriptor.recibirAviso('{no-json');
  suscriptor.recibirAviso(JSON.stringify({
    tipo: 'perfil_servidor_runtime_actualizado',
    agenteId: 7,
    periodoVidaPolId: 41
  }));
  suscriptor.recibirAviso(JSON.stringify({
    tipo: 'perfil_servidor_pol_aceptado',
    agenteId: 7,
    periodoVidaPolId: 41
  }));
  await Promise.all([...suscriptor.avisosEnCurso]);
  assert.equal(recibidos.length, 1);
  assert.equal(suscriptor.totalAvisos, 1);
}

async function verificarComposicionYDocumentacion() {
  const [
    autenticacion,
    runtime,
    web,
    repositorio,
    paquete
  ] = await Promise.all([
    leer('paquetes/agentes/src/ServicioAutenticacionAgentes.js'),
    leer('apps/sentinelia-runtime/src/RuntimeSentinelia.js'),
    leer('apps/sentinelia-web/src/index.js'),
    leer('paquetes/agentes/src/RepositorioEstadoRuntimeServidorAgentes.js'),
    leer('package.json')
  ]);
  assert.match(autenticacion, /publicarAvisoPolPerfilServidorBestEffort/u);
  assert(
    autenticacion.indexOf('registrarHeartbeatPeriodoAbierto') <
    autenticacion.indexOf("tipoPol: 'heartbeat'")
  );
  assert.match(runtime, /new SuscriptorAvisosPerfilServidorRedis/u);
  assert.match(runtime, /origen: 'aviso_pol_redis'/u);
  assert.match(web, /new PublicadorAvisosPerfilServidorRedis/u);
  assert.match(repositorio, /FOR UPDATE SKIP LOCKED/u);
  assert.doesNotMatch(autenticacion, /comparar.*bootIdReferencia/iu);
  assert.match(paquete, /agentes:verificar-perfil-servidor-5-23-4/u);
}

function crearEntornoProcesador({ candidatosPol, estadoAplicado }) {
  const registradas = [];
  const confirmadas = [];
  const aplicaciones = [];
  const publicaciones = [];
  let siguienteTransicion = 1;
  let siguienteObservacion = 101;
  let polConsultado = false;
  const repositorio = {
    async bloquearCandidatosPolEnTransaccion() {
      if (polConsultado) return [];
      polConsultado = true;
      return candidatosPol;
    },
    async bloquearCandidatosEnTransaccion() {
      return [];
    },
    async crearParaPerfilEnTransaccion({ perfil }) {
      return crearEstadoPendiente({
        agente_id: perfil.agenteId,
        generacion: perfil.generacion
      });
    },
    async registrarTransicionEnTransaccion(datos) {
      registradas.push(datos);
      return {
        creada: true,
        transicion: {
          id: siguienteTransicion++,
          claveCausal: datos.claveCausal,
          materializadaEnUtc: null,
          observacionTelemetriaId: null
        }
      };
    },
    async confirmarTransicionEnTransaccion(datos) {
      confirmadas.push(datos);
    },
    async aplicarPolEnTransaccion(datos) {
      aplicaciones.push(datos);
      return estadoAplicado;
    }
  };
  const procesador = new ProcesadorSenalesServidorRuntime({
    repositorioEstadoRuntime: repositorio,
    publicadorTelemetriaRuntime: {
      async publicarTransicionesEnTransaccion(datos) {
        publicaciones.push(datos);
        const observaciones = datos.transiciones.map(() => ({
          id: siguienteObservacion++
        }));
        return {
          persistencia: { observaciones },
          efectosPostCommit: {
            trabajosEvaluacionIds: [],
            fotografiasActualizadas: []
          }
        };
      }
    },
    fronteraTransaccional: {
      async ejecutar(operacion) {
        return operacion({ execute: async () => [[], []] });
      }
    },
    coordinadorRedis: {
      async sincronizarProyecciones({ estados }) {
        return { sincronizadas: estados.length };
      }
    },
    reloj: () => AHORA
  });
  return {
    procesador,
    registradas,
    confirmadas,
    aplicaciones,
    publicaciones
  };
}

function crearPerfil(sobrescritura = {}) {
  return {
    agenteId: 7,
    generacion: 2,
    estado: 'activo',
    histeresisSinPolSegundos: 120,
    duracionReinicioRecienteSegundos: 300,
    generadaEnUtc: '2026-08-24T13:50:00.000Z',
    ...sobrescritura
  };
}

function crearEvidencia(sobrescritura = {}) {
  return new EvidenciaPolServidorAgente({
    id: 41,
    agente_id: 7,
    boot_id: 'boot-a',
    inicio_utc: '2026-08-24 14:00:00.000',
    ultimo_heartbeat_utc: '2026-08-24 14:03:00.000',
    ultimo_seq: 8,
    heartbeats_recibidos: 8,
    ...sobrescritura
  });
}

function crearEstadoPendiente(sobrescritura = {}) {
  return crearEstado({
    boot_id_referencia: null,
    ultimo_periodo_pol_id: null,
    ultimo_seq: null,
    ultimo_pol_utc: null,
    tipo_ultimo_pol: null,
    valor_sin_pol: null,
    vence_sin_pol_utc: null,
    histeresis_sin_pol_capturada_segundos: null,
    valor_reinicio_reciente: null,
    vence_reinicio_reciente_utc: null,
    duracion_reinicio_capturada_segundos: null,
    ultimo_cambio_boot_id_utc: null,
    checkpoint_causal: null,
    ...sobrescritura
  });
}

function crearEstado(sobrescritura = {}) {
  return new EstadoRuntimeServidorAgente({
    agente_id: 7,
    generacion: 2,
    boot_id_referencia: 'boot-a',
    ultimo_periodo_pol_id: 40,
    ultimo_seq: 12,
    ultimo_pol_utc: '2026-08-24 13:30:00.000',
    tipo_ultimo_pol: 'heartbeat',
    valor_sin_pol: 0,
    vence_sin_pol_utc: '2026-08-24 13:32:00.000',
    histeresis_sin_pol_capturada_segundos: 120,
    valor_reinicio_reciente: 0,
    vence_reinicio_reciente_utc: null,
    duracion_reinicio_capturada_segundos: null,
    ultimo_cambio_boot_id_utc: null,
    checkpoint_causal: 'pol:40|seq:12',
    version_estado: 3,
    fecha_creacion: '2026-08-24 13:00:00.000',
    fecha_actualizacion: '2026-08-24 13:30:00.000',
    ...sobrescritura
  });
}

function filaCandidataPolSql() {
  const perfil = {
    agente_id: 7,
    generacion: 2,
    estado: 'pendiente_primera_evidencia',
    histeresis_sin_pol_segundos: 120,
    duracion_reinicio_reciente_segundos: 300,
    generada_en_utc: '2026-08-24 13:59:30.000',
    armada_en_utc: null,
    cerrada_en_utc: null,
    codigo_cierre: null,
    detalle_cierre: null,
    version_estado: 1,
    fecha_creacion: '2026-08-24 13:59:30.000',
    fecha_actualizacion: '2026-08-24 13:59:30.000'
  };
  const runtime = Object.fromEntries(Object.entries(filaEstadoPendienteSql())
    .map(([clave, valor]) => [`runtime_${clave}`, valor]));
  return {
    ...perfil,
    ...runtime,
    pol_id: 41,
    pol_agente_id: 7,
    pol_boot_id: 'boot-a',
    pol_inicio_utc: '2026-08-24 14:00:00.000',
    pol_ultimo_heartbeat_utc: '2026-08-24 14:03:00.000',
    pol_ultimo_seq: 8,
    pol_heartbeats_recibidos: 8
  };
}

function filaEstadoPendienteSql() {
  return {
    agente_id: 7,
    generacion: 2,
    boot_id_referencia: null,
    ultimo_periodo_pol_id: null,
    ultimo_seq: null,
    ultimo_pol_utc: null,
    tipo_ultimo_pol: null,
    valor_sin_pol: null,
    vence_sin_pol_utc: null,
    histeresis_sin_pol_capturada_segundos: null,
    valor_reinicio_reciente: null,
    vence_reinicio_reciente_utc: null,
    duracion_reinicio_capturada_segundos: null,
    ultimo_cambio_boot_id_utc: null,
    checkpoint_causal: null,
    version_estado: 1,
    fecha_creacion: '2026-08-24 13:59:30.000',
    fecha_actualizacion: '2026-08-24 13:59:30.000'
  };
}

function filaEstadoAplicadoSql() {
  return {
    ...filaEstadoPendienteSql(),
    boot_id_referencia: 'boot-a',
    ultimo_periodo_pol_id: 41,
    ultimo_seq: 8,
    ultimo_pol_utc: '2026-08-24 14:03:00.000',
    tipo_ultimo_pol: 'heartbeat',
    valor_sin_pol: 0,
    vence_sin_pol_utc: '2026-08-24 14:05:00.000',
    histeresis_sin_pol_capturada_segundos: 120,
    valor_reinicio_reciente: 0,
    checkpoint_causal: 'pol:41|seq:8',
    version_estado: 2,
    fecha_actualizacion: '2026-08-24 14:03:00.000'
  };
}

function leer(ruta) {
  return readFile(new URL(ruta, RAIZ), 'utf8');
}

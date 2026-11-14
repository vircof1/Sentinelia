import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import {
  EstadoRuntimeServidorAgente
} from '../paquetes/agentes/src/EstadoRuntimeServidorAgente.js';
import {
  RepositorioEstadoRuntimeServidorAgentes
} from '../paquetes/agentes/src/RepositorioEstadoRuntimeServidorAgentes.js';
import {
  CoordinadorPerfilServidorRedis
} from '../paquetes/agentes/src/CoordinadorPerfilServidorRedis.js';
import {
  ProcesadorSenalesServidorRuntime
} from '../apps/sentinelia-runtime/src/agentes/ProcesadorSenalesServidorRuntime.js';

const RAIZ = new URL('../', import.meta.url);
const AHORA = new Date('2026-08-24T12:10:00.000Z');

await main();

async function main() {
  verificarEntidadCompactaSinFotografiaPendiente();
  await verificarRepositorioTransaccionalYSkipLocked();
  await verificarReduccionDeVencimientosYLibroCausal();
  await verificarReplayCausalNoDuplicaObservacion();
  await verificarGeneracionPendienteSoloRehidrataProyeccion();
  await verificarAgendaRedisDescartable();
  await verificarSuperficieYDocumentacion();

  console.log(
    '[agentes] OK 5.23.3: proyeccion=sql_compacta libro=causal_unico ' +
    'vencimientos=skip_locked redis=agenda_descartable ' +
    'rehidratacion=sql postcommit=aislado pol=pendiente_5_23_4'
  );
}

function verificarEntidadCompactaSinFotografiaPendiente() {
  const pendiente = crearEstado({
    boot_id_referencia: null,
    ultimo_periodo_pol_id: null,
    ultimo_seq: null,
    ultimo_pol_utc: null,
    tipo_ultimo_pol: null,
    valor_sin_pol: null,
    valor_reinicio_reciente: null,
    vence_sin_pol_utc: null,
    vence_reinicio_reciente_utc: null,
    checkpoint_causal: null
  });
  assert.equal(pendiente.tieneFotografia(), false);
  assert.equal(pendiente.bootIdReferencia, null);
  assert.equal(pendiente.ultimoPeriodoPolId, null);
  assert.equal(pendiente.checkpointCausal, null);

  const armada = crearEstado();
  assert.equal(armada.tieneFotografia(), true);
  assert.equal(armada.valorSinPol, false);
  assert.equal(armada.valorReinicioReciente, true);
  assert.equal(armada.histeresisSinPolCapturadaSegundos, 120);
  assert.equal(armada.duracionReinicioCapturadaSegundos, 300);
  assert.throws(
    () => crearEstado({
      vence_sin_pol_utc: '2026-08-24 12:05:00.000',
      histeresis_sin_pol_capturada_segundos: null
    }),
    /histéresis capturada/u
  );
}

async function verificarRepositorioTransaccionalYSkipLocked() {
  const sql = [];
  const fila = filaCandidataSql();
  const conexion = {
    async execute(consulta, parametros) {
      sql.push({ consulta, parametros });
      if (consulta.includes('INSERT IGNORE INTO estados_runtime_servidor_agentes')) {
        return [{ affectedRows: 1 }, []];
      }
      if (consulta.includes('FROM estados_runtime_servidor_agentes e') &&
          consulta.includes('WHERE e.agente_id = ?')) {
        return [[filaEstadoSql()], []];
      }
      if (consulta.includes('FROM perfiles_servidor_agentes p')) {
        return [[fila], []];
      }
      throw new Error(`SQL no esperado: ${consulta}`);
    }
  };
  const repositorio = new RepositorioEstadoRuntimeServidorAgentes({});
  const creada = await repositorio.crearParaPerfilEnTransaccion({
    perfil: { agenteId: 7, generacion: 2 }
  }, { conexion });
  assert.equal(creada.agenteId, 7);
  assert.equal(creada.generacion, 2);

  const candidatos = await repositorio.bloquearCandidatosEnTransaccion({
    ahoraUtc: AHORA,
    limite: 25
  }, { conexion });
  assert.equal(candidatos.length, 1);
  assert.equal(candidatos[0].perfil.estado, 'activo');
  assert.equal(candidatos[0].estado.venceSinPolUtc, '2026-08-24T12:05:00.000Z');
  const consultaBloqueo = sql.find(({ consulta }) =>
    consulta.includes('FROM perfiles_servidor_agentes p')
  );
  assert.match(
    consultaBloqueo.consulta,
    /INNER JOIN agentes_sentinelia a ON a\.id = p\.agente_id/u
  );
  assert.match(consultaBloqueo.consulta, /FOR UPDATE SKIP LOCKED/u);
  assert.match(consultaBloqueo.consulta, /e\.vence_sin_pol_utc <= \?/u);
  assert.match(consultaBloqueo.consulta, /e\.vence_reinicio_reciente_utc <= \?/u);
  assert.equal(consultaBloqueo.parametros.at(-1), 25);
}

async function verificarReduccionDeVencimientosYLibroCausal() {
  const eventos = [];
  const registradas = [];
  const confirmadas = [];
  const resoluciones = [];
  const publicaciones = [];
  let siguienteTransicionId = 1;
  const estado = crearEstado();
  const perfil = crearPerfil();
  const repositorio = {
    async bloquearCandidatosPolEnTransaccion() {
      return [];
    },
    async bloquearCandidatosEnTransaccion() {
      eventos.push('sql:candidatos');
      return [{ perfil, estado }];
    },
    async registrarTransicionEnTransaccion(datos) {
      registradas.push(datos);
      return {
        creada: true,
        transicion: {
          id: siguienteTransicionId++,
          claveCausal: datos.claveCausal,
          materializadaEnUtc: null,
          observacionTelemetriaId: null
        }
      };
    },
    async confirmarTransicionEnTransaccion(datos) {
      confirmadas.push(datos);
    },
    async resolverVencimientosEnTransaccion(datos) {
      resoluciones.push(datos);
      return crearEstado({
        valor_sin_pol: 1,
        vence_sin_pol_utc: null,
        valor_reinicio_reciente: 0,
        vence_reinicio_reciente_utc: null,
        checkpoint_causal: datos.checkpointCausal,
        version_estado: 4
      });
    }
  };
  const publicador = {
    async publicarTransicionesEnTransaccion(datos) {
      eventos.push('sql:publicacion');
      publicaciones.push(datos);
      return {
        persistencia: {
          observaciones: [{ id: 101 }, { id: 102 }]
        },
        efectosPostCommit: {
          trabajosEvaluacionIds: ['501', '502'],
          fotografiasActualizadas: [
            { agenteId: 7, senalId: 11, ultimaObservacionId: 101 },
            { agenteId: 7, senalId: 12, ultimaObservacionId: 102 }
          ]
        }
      };
    }
  };
  const fronteraTransaccional = {
    async ejecutar(operacion) {
      eventos.push('tx:begin');
      const resultado = await operacion({ execute: async () => [[], []] });
      eventos.push('tx:commit');
      return resultado;
    }
  };
  const coordinaciones = [];
  const avisos = [];
  const invalidaciones = [];
  const procesador = new ProcesadorSenalesServidorRuntime({
    repositorioEstadoRuntime: repositorio,
    publicadorTelemetriaRuntime: publicador,
    fronteraTransaccional,
    coordinadorRedis: {
      async sincronizarProyecciones(datos) {
        eventos.push('redis:estado');
        coordinaciones.push(datos);
        return { sincronizadas: datos.estados.length };
      }
    },
    publicadorAvisosEvaluacion: {
      async publicarTrabajosPendientes(datos) {
        eventos.push('redis:evaluaciones');
        avisos.push(datos);
        return { publicado: true };
      }
    },
    publicadorInvalidacionesMonitores: {
      async publicarFotografiasActualizadas(datos) {
        eventos.push('redis:monitores');
        invalidaciones.push(datos);
        return { publicado: true };
      }
    },
    reloj: () => AHORA
  });
  const resultado = await procesador.procesarPendientes({
    origen: 'prueba',
    numeroTick: 8
  });

  assert.equal(resultado.totalCandidatos, 1);
  assert.equal(resultado.totalTransiciones, 2);
  assert.equal(resultado.totalTransicionesReutilizadas, 0);
  assert.equal(publicaciones.length, 1);
  assert.deepEqual(
    publicaciones[0].transiciones.map(({ codigoSenal, valor, observadoEnUtc }) => ({
      codigoSenal,
      valor,
      observadoEnUtc
    })),
    [
      {
        codigoSenal: 'runtime.servidor.sin_pol',
        valor: true,
        observadoEnUtc: '2026-08-24T12:05:00.000Z'
      },
      {
        codigoSenal: 'runtime.servidor.reinicio_reciente',
        valor: false,
        observadoEnUtc: '2026-08-24T12:06:00.000Z'
      }
    ]
  );
  assert.equal(registradas.length, 2);
  assert(registradas.every(({ claveCausal }) => /^[0-9a-f]{64}$/u.test(claveCausal)));
  assert.notEqual(registradas[0].claveCausal, registradas[1].claveCausal);
  assert.deepEqual(confirmadas.map(({ observacionTelemetriaId }) =>
    observacionTelemetriaId), [101, 102]);
  assert.equal(resoluciones[0].resolverSinPol, true);
  assert.equal(resoluciones[0].resolverReinicioReciente, true);
  assert.equal(coordinaciones[0].estados[0].versionEstado, 4);
  assert.deepEqual(avisos, [{ totalTrabajos: 2 }]);
  assert.equal(invalidaciones[0].fotografias.length, 2);
  assert(eventos.indexOf('tx:commit') < eventos.indexOf('redis:estado'));
  assert(eventos.indexOf('tx:commit') < eventos.indexOf('redis:evaluaciones'));
  assert(eventos.indexOf('tx:commit') < eventos.indexOf('redis:monitores'));
}

async function verificarReplayCausalNoDuplicaObservacion() {
  let publicaciones = 0;
  let resoluciones = 0;
  const estado = crearEstado({
    valor_reinicio_reciente: 0,
    vence_reinicio_reciente_utc: null
  });
  const procesador = new ProcesadorSenalesServidorRuntime({
    repositorioEstadoRuntime: {
      async bloquearCandidatosPolEnTransaccion() {
        return [];
      },
      async bloquearCandidatosEnTransaccion() {
        return [{ perfil: crearPerfil(), estado }];
      },
      async registrarTransicionEnTransaccion(datos) {
        return {
          creada: false,
          transicion: {
            id: 9,
            claveCausal: datos.claveCausal,
            materializadaEnUtc: '2026-08-24T12:05:01.000Z',
            observacionTelemetriaId: 88
          }
        };
      },
      async resolverVencimientosEnTransaccion(datos) {
        resoluciones += 1;
        return crearEstado({
          valor_sin_pol: 1,
          vence_sin_pol_utc: null,
          valor_reinicio_reciente: 0,
          vence_reinicio_reciente_utc: null,
          checkpoint_causal: datos.checkpointCausal,
          version_estado: 4
        });
      }
    },
    publicadorTelemetriaRuntime: {
      async publicarTransicionesEnTransaccion() { publicaciones += 1; }
    },
    fronteraTransaccional: {
      async ejecutar(operacion) {
        return operacion({ execute: async () => [[], []] });
      }
    },
    coordinadorRedis: {
      async sincronizarProyecciones() {
        throw new Error('Redis no disponible');
      }
    },
    reloj: () => AHORA
  });
  const resultado = await procesador.procesarPendientes();

  assert.equal(publicaciones, 0);
  assert.equal(resoluciones, 1);
  assert.equal(resultado.totalTransiciones, 0);
  assert.equal(resultado.totalTransicionesReutilizadas, 1);
  assert.equal(
    resultado.efectosPostCommit.coordinacionRedis.motivo,
    'error_postcommit'
  );
}

async function verificarGeneracionPendienteSoloRehidrataProyeccion() {
  let creadas = 0;
  let publicaciones = 0;
  const pendiente = {
    ...crearPerfil(),
    estado: 'pendiente_primera_evidencia'
  };
  const estadoPendiente = crearEstado({
    valor_sin_pol: null,
    valor_reinicio_reciente: null,
    vence_sin_pol_utc: null,
    vence_reinicio_reciente_utc: null
  });
  const procesador = new ProcesadorSenalesServidorRuntime({
    repositorioEstadoRuntime: {
      async bloquearCandidatosPolEnTransaccion() {
        return [];
      },
      async bloquearCandidatosEnTransaccion() {
        return [{ perfil: pendiente, estado: null }];
      },
      async crearParaPerfilEnTransaccion() {
        creadas += 1;
        return estadoPendiente;
      }
    },
    publicadorTelemetriaRuntime: {
      async publicarTransicionesEnTransaccion() { publicaciones += 1; }
    },
    fronteraTransaccional: {
      async ejecutar(operacion) {
        return operacion({ execute: async () => [[], []] });
      }
    },
    reloj: () => AHORA
  });
  const resultado = await procesador.procesarPendientes();
  assert.equal(creadas, 1);
  assert.equal(publicaciones, 0);
  assert.equal(resultado.totalProyeccionesCreadas, 1);
  assert.equal(resultado.estados[0].valorSinPol, null);
}

async function verificarAgendaRedisDescartable() {
  const llamadas = [];
  const coordinador = new CoordinadorPerfilServidorRedis({
    clienteRedis: {
      async eval(script, opciones) {
        llamadas.push({ script, opciones });
        return 3;
      }
    },
    prefijoRedis: 'prueba:perfil:',
    reloj: () => AHORA
  });
  const resultado = await coordinador.sincronizarProyecciones({
    estados: [crearEstado()],
    motivo: 'prueba'
  });
  assert.equal(resultado.sincronizadas, 1);
  assert.deepEqual(llamadas[0].opciones.keys, [
    'prueba:perfil:estado:7:2',
    'prueba:perfil:vencimientos',
    'prueba:perfil:avisos'
  ]);
  assert.equal(
    llamadas[0].opciones.arguments[3],
    String(Date.parse('2026-08-24T12:05:00.000Z'))
  );
  assert.equal(
    llamadas[0].opciones.arguments[5],
    String(Date.parse('2026-08-24T12:06:00.000Z'))
  );
  const fotografia = JSON.parse(llamadas[0].opciones.arguments[0]);
  assert.equal(fotografia.autoridad, 'sql');
  assert.equal(fotografia.versionEstado, 3);
}

async function verificarSuperficieYDocumentacion() {
  const [
    migracion,
    runtime,
    bootstrap,
    autenticacion,
    configuracion,
    entorno
  ] = await Promise.all([
    leer('migraciones/sql/0001_esquema_inicial.sql').then(normalizarSqlConsolidado),
    leer('apps/sentinelia-runtime/src/RuntimeSentinelia.js'),
    leer('apps/sentinelia-runtime/src/BootstrapRuntime.js'),
    leer('paquetes/agentes/src/ServicioAutenticacionAgentes.js'),
    leer('paquetes/utilidades/src/configuracion/obtenerConfiguracionAplicacion.js'),
    leer('.env.ejemplo')
  ]);

  assert.match(migracion, /CREATE TABLE estados_runtime_servidor_agentes/u);
  assert.match(migracion, /CREATE TABLE transiciones_runtime_servidor_agentes/u);
  assert.match(migracion, /uk_transicion_runtime_servidor_causal/u);
  assert.match(migracion, /ON DELETE CASCADE/u);
  assert.match(migracion, /vence_sin_pol_utc/u);
  assert.match(migracion, /vence_reinicio_reciente_utc/u);
  assert.doesNotMatch(migracion, /heartbeat.*inbox|inbox.*heartbeat/iu);
  assert(
    runtime.indexOf('procesadorSenalesServidorRuntime.procesarPendientes') <
    runtime.indexOf('selectorMonitoresVencidos.seleccionar')
  );
  assert.match(runtime, /rehidratarCoordinacion/u);
  assert.match(bootstrap, /new RepositorioEstadoRuntimeServidorAgentes/u);
  assert.doesNotMatch(autenticacion, /ProcesadorSenalesServidorRuntime/u);
  assert.match(configuracion, /RUNTIME_PERFIL_SERVIDOR_LOTE_MAXIMO[\s\S]*50/u);
  assert.match(configuracion, /AGENTES_PERFIL_SERVIDOR_HABILITADO[\s\S]*true/u);
  assert.match(entorno, /RUNTIME_PERFIL_SERVIDOR_LOTE_MAXIMO=50/u);
}

function crearEstado(sobrescritura = {}) {
  return new EstadoRuntimeServidorAgente({
    agente_id: 7,
    generacion: 2,
    boot_id_referencia: 'boot-a',
    ultimo_periodo_pol_id: 31,
    ultimo_seq: 8,
    ultimo_pol_utc: '2026-08-24 12:03:00.000',
    tipo_ultimo_pol: 'heartbeat',
    valor_sin_pol: 0,
    vence_sin_pol_utc: '2026-08-24 12:05:00.000',
    histeresis_sin_pol_capturada_segundos: 120,
    valor_reinicio_reciente: 1,
    vence_reinicio_reciente_utc: '2026-08-24 12:06:00.000',
    duracion_reinicio_capturada_segundos: 300,
    ultimo_cambio_boot_id_utc: '2026-08-24 12:01:00.000',
    checkpoint_causal: 'estado:2|periodo:31|seq:8',
    version_estado: 3,
    fecha_creacion: '2026-08-24 12:00:00.000',
    fecha_actualizacion: '2026-08-24 12:03:00.000',
    ...sobrescritura
  });
}

function crearPerfil() {
  return {
    agenteId: 7,
    generacion: 2,
    estado: 'activo'
  };
}

function filaEstadoSql() {
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
    fecha_creacion: '2026-08-24 12:00:00.000',
    fecha_actualizacion: '2026-08-24 12:00:00.000'
  };
}

function filaCandidataSql() {
  const estado = filaEstadoSql();
  const prefijado = Object.fromEntries(
    Object.entries({
      ...estado,
      boot_id_referencia: 'boot-a',
      ultimo_periodo_pol_id: 31,
      ultimo_seq: 8,
      ultimo_pol_utc: '2026-08-24 12:03:00.000',
      tipo_ultimo_pol: 'heartbeat',
      valor_sin_pol: 0,
      vence_sin_pol_utc: '2026-08-24 12:05:00.000',
      histeresis_sin_pol_capturada_segundos: 120,
      valor_reinicio_reciente: 1,
      vence_reinicio_reciente_utc: '2026-08-24 12:06:00.000',
      duracion_reinicio_capturada_segundos: 300,
      version_estado: 3
    }).map(([clave, valor]) => [`runtime_${clave}`, valor])
  );
  return {
    agente_id: 7,
    generacion: 2,
    estado: 'activo',
    histeresis_sin_pol_segundos: 120,
    duracion_reinicio_reciente_segundos: 300,
    generada_en_utc: '2026-08-24 11:00:00.000',
    armada_en_utc: '2026-08-24 12:00:00.000',
    cerrada_en_utc: null,
    codigo_cierre: null,
    detalle_cierre: null,
    version_estado: 2,
    fecha_creacion: '2026-08-24 11:00:00.000',
    fecha_actualizacion: '2026-08-24 12:00:00.000',
    ...prefijado
  };
}

function leer(ruta) {
  return readFile(new URL(ruta, RAIZ), 'utf8');
}

function normalizarSqlConsolidado(contenido) {
  return contenido.replaceAll('`', '').replace(/,(?!\s)/g, ', ');
}

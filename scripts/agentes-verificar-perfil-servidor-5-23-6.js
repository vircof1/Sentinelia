import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import {
  ReglaDerivacionTelemetria,
  ResultadoEvaluacionRegla,
  RevisionReglaDerivacionTelemetria
} from '../paquetes/agentes/src/EventosDerivadosTelemetriaAgentes.js';
import {
  RepositorioEstadoActualEvaluacionReglasTelemetria
} from '../paquetes/agentes/src/RepositorioEvaluacionesDerivadasTelemetria.js';
import {
  RepositorioEstadoRuntimeServidorAgentes
} from '../paquetes/agentes/src/RepositorioEstadoRuntimeServidorAgentes.js';
import {
  ServicioRetiradaPerfilServidorAgenteEnTransaccion
} from '../paquetes/agentes/src/ServicioRetiradaPerfilServidorAgenteEnTransaccion.js';
import {
  crearPuertosCapturaTecnicaFederacion
} from '../paquetes/federacion/aplicacion/crearPuertosCapturaTecnicaFederacion.js';
import {
  asegurarIdentidadElementoTelemetriaFederacion
} from '../paquetes/federacion/adaptadores/RepositorioTelemetriaLocalSql.js';
import {
  CoordinadorPerfilServidorRedis
} from '../paquetes/agentes/src/CoordinadorPerfilServidorRedis.js';
import {
  ProcesadorSenalesServidorRuntime
} from '../apps/sentinelia-runtime/src/agentes/ProcesadorSenalesServidorRuntime.js';
import {
  validarEventoAuditableV1
} from '../paquetes/auditoria/src/ValidadorContratoAuditoria.js';

const AHORA = new Date('2026-08-24T18:00:00.000Z');

await verificarRetiradaTransversalYOrdenada();
await verificarRetiradaIdempotente();
await verificarEvaluacionPendienteNoResucitaEstadoActual();
await verificarTombstonesUsanProductorFederado();
await verificarNuevaEncarnacionFederadaDeFotografia();
await verificarDesactivacionIncompatibleEnRuntime();
await verificarDetectorSoloUsaEvidenciaDurablePosterior();
await verificarLimpiezaRedisDeLaGeneracion();
await verificarCascadasYDocumentacion();

console.log(
  '[agentes] OK 5.23.6: retirada=fotografia_y_reglas ' +
  'carrera=fuente_antes_estado tombstone=preborrado ' +
  'federacion=regla_sin_estado_y_nueva_encarnacion incompatibilidad=durable_postpromocion ' +
  'redis=retirado cascada=agregado'
);

async function verificarRetiradaTransversalYOrdenada() {
  const eventos = [];
  const perfil = crearPerfilVigente();
  const perfilCerrado = crearPerfilCerrado();
  const fotografias = [
    { id: 71, agenteId: 7, senalId: 11, ultimaObservacionId: 101 },
    { id: 72, agenteId: 7, senalId: 12, ultimaObservacionId: 102 }
  ];
  const estados = [
    { reglaId: 31, revisionId: 301, observacionId: 101, agenteId: 7, senalId: 11 },
    { reglaId: 32, revisionId: 302, observacionId: 102, agenteId: 7, senalId: 12 }
  ];
  const servicio = new ServicioRetiradaPerfilServidorAgenteEnTransaccion({
    repositorioPerfilesServidor: {
      async buscarPorAgenteId(_id, opciones) {
        assert.equal(opciones.bloquear, true);
        eventos.push('perfil:bloqueado');
        return perfil;
      },
      async cerrarEnTransaccion(datos) {
        eventos.push('perfil:cerrado');
        assert.equal(datos.estado, 'retirado');
        return perfilCerrado;
      }
    },
    repositorioEstadoRuntimeServidor: {
      async buscarPorPerfil(_identidad, opciones) {
        assert.equal(opciones.bloquear, true);
        eventos.push('proyeccion:bloqueada');
        return { agenteId: 7, generacion: 2, versionEstado: 8 };
      }
    },
    repositorioCatalogoSenales: {
      async buscarPorIdentidad({ clave }) {
        eventos.push(`catalogo:${clave}`);
        return clave === 'sin_pol'
          ? { id: 11, agenteId: 7 }
          : { id: 12, agenteId: 7 };
      }
    },
    repositorioEstadoActualTelemetria: {
      async bloquearPorSenalesEnTransaccion({ senalIds }) {
        eventos.push('fotografias:bloqueadas');
        assert.deepEqual(senalIds, [11, 12]);
        return fotografias;
      },
      async eliminarBloqueadasEnTransaccion({ fotografiaIds }) {
        eventos.push('fotografias:eliminadas');
        assert.deepEqual(fotografiaIds, [71, 72]);
        return 2;
      }
    },
    repositorioEstadoActualEvaluacion: {
      async bloquearPorSenalesEnTransaccion() {
        eventos.push('reglas:bloqueadas');
        return estados;
      },
      async eliminarBloqueadosEnTransaccion({ reglaIds }) {
        eventos.push('reglas:eliminadas');
        assert.deepEqual(reglaIds, [31, 32]);
        return 2;
      }
    },
    capturadorFederacionTelemetria: {
      async retirarFotografiasEnTransaccion({ fotografiaIds }) {
        eventos.push('federacion:tombstones');
        assert.deepEqual(fotografiaIds, [71, 72]);
      },
      async capturarReglaEnTransaccion({ reglaId }) {
        eventos.push(`federacion:regla:${reglaId}`);
      }
    }
  });

  const resultado = await servicio.retirarEnTransaccion({
    agenteId: 7,
    generacion: 2,
    cerradaEnUtc: AHORA
  }, { conexion: conexionPrestada() });

  assert.equal(resultado.retirada, true);
  assert.equal(resultado.perfil.estado, 'retirado');
  assert.deepEqual(resultado.senales.map(({ id }) => id), [11, 12]);
  assert.deepEqual(
    resultado.fotografiasRetiradas.map(({ id }) => id),
    [71, 72]
  );
  assert.deepEqual(
    resultado.estadosReglasRetirados.map(({ reglaId }) => reglaId),
    [31, 32]
  );
  assertOrden(eventos, 'fotografias:bloqueadas', 'reglas:bloqueadas');
  assertOrden(eventos, 'federacion:tombstones', 'fotografias:eliminadas');
  assertOrden(eventos, 'fotografias:eliminadas', 'reglas:eliminadas');
  assertOrden(eventos, 'reglas:eliminadas', 'federacion:regla:31');
  assertOrden(eventos, 'federacion:regla:32', 'perfil:cerrado');
}

async function verificarRetiradaIdempotente() {
  let efectosLaterales = 0;
  const servicio = new ServicioRetiradaPerfilServidorAgenteEnTransaccion({
    repositorioPerfilesServidor: {
      async buscarPorAgenteId() { return crearPerfilCerrado(); },
      async cerrarEnTransaccion() { efectosLaterales += 1; }
    },
    repositorioEstadoRuntimeServidor: {
      async buscarPorPerfil() { efectosLaterales += 1; }
    },
    repositorioCatalogoSenales: {
      async buscarPorIdentidad() { efectosLaterales += 1; }
    },
    repositorioEstadoActualTelemetria: {
      async bloquearPorSenalesEnTransaccion() { efectosLaterales += 1; },
      async eliminarBloqueadasEnTransaccion() { efectosLaterales += 1; }
    },
    repositorioEstadoActualEvaluacion: {
      async bloquearPorSenalesEnTransaccion() { efectosLaterales += 1; },
      async eliminarBloqueadosEnTransaccion() { efectosLaterales += 1; }
    },
    capturadorFederacionTelemetria: {
      async retirarFotografiasEnTransaccion() { efectosLaterales += 1; },
      async capturarReglaEnTransaccion() { efectosLaterales += 1; }
    }
  });
  const resultado = await servicio.retirarEnTransaccion(
    { agenteId: 7, generacion: 2 },
    { conexion: conexionPrestada() }
  );
  assert.equal(resultado.retirada, false);
  assert.equal(resultado.motivo, 'perfil_ya_cerrado');
  assert.equal(efectosLaterales, 0);
}

async function verificarEvaluacionPendienteNoResucitaEstadoActual() {
  const sentencias = [];
  const conexion = {
    async execute(sql) {
      sentencias.push(sql);
      if (sql.includes('FROM agentes_sentinelia')) {
        return [[{ id: 7 }], []];
      }
      if (sql.includes('FROM estado_actual_telemetria_agentes')) {
        return [[], []];
      }
      if (sql.includes('FROM estado_actual_evaluacion_reglas_telemetria')) {
        return [[], []];
      }
      throw new Error('Una evaluación sin fotografía no debe ejecutar INSERT.');
    }
  };
  const repositorio = new RepositorioEstadoActualEvaluacionReglasTelemetria({});
  const respuesta = await repositorio.aplicarResultado(
    crearResultadoEvaluacion(),
    { conexion }
  );
  assert.equal(respuesta.actualizado, false);
  assert.equal(respuesta.gobiernaEstadoActual, false);
  assert.equal(respuesta.fuenteVigente, true);
  assert.equal(respuesta.fotografiaVigente, false);
  assert.equal(respuesta.estado, null);
  assert.match(sentencias[0], /FOR UPDATE/u);
  assert.match(sentencias[0], /FROM agentes_sentinelia/u);
  assert.match(sentencias[1], /ultima_observacion_id = \?/u);
  assert.equal(
    sentencias.some((sql) => sql.includes(
      'INSERT INTO estado_actual_evaluacion_reglas_telemetria'
    )),
    false
  );
}

async function verificarTombstonesUsanProductorFederado() {
  const preparadas = [];
  const puertos = crearPuertosCapturaTecnicaFederacion({
    capturador: {
      async capturarEnTransaccion({ familia, prepararCapturas }) {
        assert.equal(familia, 'telemetria');
        const capturas = await prepararCapturas({
          interfazCaptura: {
            async prepararRetiradaEnTransaccion(solicitud) {
              preparadas.push(solicitud);
              return { definicion: { familia: 'telemetria', operacion: 'retirada' } };
            }
          }
        });
        return { estado: 'capturada', capturas };
      }
    }
  });
  await puertos.telemetria.retirarFotografiasEnTransaccion({
    fotografiaIds: [71, 72, 71]
  }, { conexion: conexionPrestada() });
  assert.deepEqual(preparadas, [
    { tipoRegistro: 'fotografiaSenal', idLocal: 71 },
    { tipoRegistro: 'fotografiaSenal', idLocal: 72 }
  ]);
}

async function verificarNuevaEncarnacionFederadaDeFotografia() {
  const filas = [
    identidadFotografia('71', 'retirado', 'sfel_retirada_1'),
    identidadFotografia('71:2', 'retirado', 'sfel_retirada_2')
  ];
  const inserciones = [];
  const conexion = {
    async query() { return [[{ activa: 1 }], []]; },
    async execute(sql, parametros) {
      if (sql.includes('FROM identidades_elementos_telemetria_federacion')) {
        assert.match(
          sql,
          /clave_local LIKE CONCAT\(CONVERT\(\? USING ascii\),_ascii':%'\)/u
        );
        return [filas, []];
      }
      if (sql.includes('INSERT INTO identidades_elementos_telemetria_federacion')) {
        inserciones.push(parametros);
        filas.push(identidadFotografia(parametros[1], 'vigente', parametros[3]));
        return [{ affectedRows: 1 }, []];
      }
      throw new Error(`SQL no esperado: ${sql}`);
    }
  };
  const datos = {
    conexion,
    tipo: 'fotografiaSenal',
    id: 71,
    agente: { id: 7, tenant_id: 1, empresa_id: 2, sitio_id: 3 },
    instante: AHORA,
    generador: { generar: () => 'sfel_encarnacion_3' }
  };
  const nueva = await asegurarIdentidadElementoTelemetriaFederacion(datos);
  assert.equal(nueva, 'sfel_encarnacion_3');
  assert.equal(inserciones[0][1], '71:3');

  datos.generador = { generar: () => { throw new Error('No debe regenerar la identidad vigente.'); } };
  const estable = await asegurarIdentidadElementoTelemetriaFederacion(datos);
  assert.equal(estable, nueva);

  const adaptador = await leer(
    'paquetes/federacion/adaptadores/RepositorioTelemetriaLocalSql.js'
  );
  assert.match(
    adaptador,
    /WHERE tipo_elemento=\? AND elemento_origen_id=\?/u,
    'La retirada debe dirigirse a la encarnación opaca, no al id físico reutilizable.'
  );
}

async function verificarDesactivacionIncompatibleEnRuntime() {
  const eventos = [];
  let detectorConsultado = false;
  const retirada = {
    retirada: true,
    agenteId: 7,
    generacion: 2,
    fotografiasRetiradas: [
      { agenteId: 7, senalId: 11, ultimaObservacionId: 101 }
    ],
    estadosReglasRetirados: [
      { reglaId: 31, revisionId: 301, observacionId: 101 }
    ]
  };
  const procesador = new ProcesadorSenalesServidorRuntime({
    repositorioEstadoRuntime: {
      async bloquearCandidatosIncompatiblesEnTransaccion() {
        detectorConsultado = true;
        return [{
          perfil: crearPerfilVigente(),
          agente: { id: 7, tenantId: 1, empresaId: 2, sitioId: 3 },
          evidencia: {
            periodoVidaPolId: 90,
            codigo: 'pol_heartbeat_incompleto'
          }
        }];
      },
      async bloquearCandidatosPolEnTransaccion() { return []; },
      async bloquearCandidatosEnTransaccion() { return []; }
    },
    publicadorTelemetriaRuntime: {
      async publicarTransicionesEnTransaccion() {}
    },
    servicioRetiradaPerfilServidor: {
      async retirarEnTransaccion(datos) {
        eventos.push('tx:retirada');
        assert.equal(datos.estadoFinal, 'desactivado_incompatible');
        assert.equal(datos.codigoCierre, 'pol_heartbeat_incompleto');
        assert.match(datos.detalleCierre, /Periodo POL #90/u);
        return retirada;
      }
    },
    repositorioOutboxAuditoriaRuntime: {
      async encolarEnTransaccion(intenciones) {
        eventos.push('tx:auditoria');
        assert.doesNotThrow(() => validarEventoAuditableV1(intenciones[0]));
        assert.equal(
          intenciones[0].tipo,
          'agente.perfil_servidor_desactivado'
        );
      }
    },
    fronteraTransaccional: {
      async ejecutar(operacion) {
        eventos.push('tx:begin');
        const resultado = await operacion(conexionPrestada());
        eventos.push('tx:commit');
        return resultado;
      }
    },
    coordinadorRedis: {
      async sincronizarProyecciones() { eventos.push('redis:sincronizar'); },
      async retirarProyecciones() { eventos.push('redis:retirar'); }
    },
    publicadorInvalidacionesMonitores: {
      async publicarFotografiasActualizadas({ fotografias }) {
        eventos.push(`monitor:fotografia:${fotografias.length}`);
      },
      async publicarEstadosReglasActualizados({ estados }) {
        eventos.push(`monitor:regla:${estados.length}`);
      }
    },
    reloj: () => AHORA
  });
  const resultado = await procesador.procesarPendientes();
  assert.equal(detectorConsultado, true);
  assert.equal(resultado.totalPerfilesDesactivadosIncompatibles, 1);
  assertOrden(eventos, 'tx:retirada', 'tx:commit');
  assertOrden(eventos, 'tx:commit', 'redis:retirar');
  assertOrden(eventos, 'tx:commit', 'monitor:fotografia:1');
  assertOrden(eventos, 'tx:commit', 'monitor:regla:1');
}

async function verificarDetectorSoloUsaEvidenciaDurablePosterior() {
  let sql = '';
  const repositorio = new RepositorioEstadoRuntimeServidorAgentes({});
  await repositorio.bloquearCandidatosIncompatiblesEnTransaccion(
    { limite: 10 },
    {
      conexion: {
        async execute(sentencia) {
          sql = sentencia;
          return [[], []];
        }
      }
    }
  );
  assert.match(sql, /candidato\.inicio_utc > p\.generada_en_utc/u);
  assert.match(sql, /candidato\.ultimo_heartbeat_utc > p\.generada_en_utc/u);
  assert.match(sql, /heartbeats_recibidos > 0/u);
  assert.match(sql, /FOR UPDATE SKIP LOCKED/u);
  assert.doesNotMatch(sql, /agentes_sentinelia\.ultimo_boot_id/u);
}

async function verificarLimpiezaRedisDeLaGeneracion() {
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
  const resultado = await coordinador.retirarProyecciones({
    perfiles: [{ agenteId: 7, generacion: 2 }]
  });
  assert.equal(resultado.retiradas, 1);
  assert.match(llamadas[0].script, /redis\.call\('DEL'/u);
  assert.match(llamadas[0].script, /redis\.call\('ZREM'/u);
  assert.deepEqual(llamadas[0].opciones.keys, [
    'prueba:perfil:estado:7:2',
    'prueba:perfil:vencimientos',
    'prueba:perfil:avisos'
  ]);
}

async function verificarCascadasYDocumentacion() {
  const [agentes, catalogo, perfil, runtime, paquete] =
    await Promise.all([
      leer('migraciones/sql/0001_esquema_inicial.sql').then(normalizarSqlConsolidado),
      leer('migraciones/sql/0001_esquema_inicial.sql').then(normalizarSqlConsolidado),
      leer('migraciones/sql/0001_esquema_inicial.sql').then(normalizarSqlConsolidado),
      leer('migraciones/sql/0001_esquema_inicial.sql').then(normalizarSqlConsolidado),
      leer('package.json')
    ]);
  assert.match(agentes, /periodos_vida_pol_agentes[\s\S]*ON DELETE CASCADE/u);
  assert.match(catalogo, /senales_telemetria_agentes[\s\S]*ON DELETE CASCADE/u);
  assert.match(perfil, /perfiles_servidor_agentes[\s\S]*ON DELETE CASCADE/u);
  assert.match(runtime, /estados_runtime_servidor_agentes[\s\S]*ON DELETE CASCADE/u);
  assert.match(paquete, /agentes:verificar-perfil-servidor-5-23-6/u);
}

function crearPerfilVigente() {
  return {
    agenteId: 7,
    generacion: 2,
    estado: 'activo',
    estaVigente: () => true,
    serializar() {
      return { agenteId: 7, generacion: 2, estado: 'activo' };
    }
  };
}

function identidadFotografia(claveLocal, estado, elementoOrigenId) {
  return {
    clave_local: claveLocal,
    elemento_origen_id: elementoOrigenId,
    estado,
    agente_id_local: 7,
    scope_tenant_id: 1,
    scope_empresa_id: 2,
    scope_sitio_id: 3
  };
}

function crearPerfilCerrado() {
  return {
    agenteId: 7,
    generacion: 2,
    estado: 'retirado',
    estaVigente: () => false,
    serializar() {
      return { agenteId: 7, generacion: 2, estado: 'retirado' };
    }
  };
}

function crearResultadoEvaluacion() {
  const regla = new ReglaDerivacionTelemetria({
    id: 31,
    agente: { id: 7, tenantId: 1, empresaId: 2, sitioId: 3 },
    senal: { id: 23, agenteId: 7 },
    scope: { tenantId: 1, empresaId: 2, sitioId: 3 },
    revisionVigenteId: 101
  });
  const revision = new RevisionReglaDerivacionTelemetria({
    id: 101,
    reglaId: 31,
    numero: 1,
    condicion: {
      tipo: 'numero',
      version: 1,
      configuracion: { operador: '>', umbral: 80, unidad: 'ºC' }
    },
    severidadCalculada: 'advertencia',
    mensajeOperativo: 'Temperatura fuera del rango operativo.',
    nombre: 'Temperatura elevada',
    vigenteDesdeUtc: '2026-07-01T00:00:00.000Z'
  });
  return new ResultadoEvaluacionRegla({
    regla,
    revision,
    observacion: {
      id: 501,
      agenteId: 7,
      senalId: 23,
      valor: 85,
      tipoDato: 'numero',
      unidad: 'ºC',
      calidad: 'valida',
      observadoEnUtc: '2026-07-20T10:00:00.000Z',
      recibidoEnUtc: '2026-07-20T10:05:00.000Z'
    },
    resultado: 'coincide',
    codigoMotivo: 'condicion_cumplida',
    explicacion: 'Resultado coincidente.',
    evaluadoEnUtc: '2026-07-20T10:05:01.000Z'
  });
}

function conexionPrestada() {
  return { execute: async () => [[], []] };
}

function assertOrden(eventos, primero, despues) {
  assert.ok(eventos.indexOf(primero) >= 0, `Falta ${primero}.`);
  assert.ok(eventos.indexOf(despues) >= 0, `Falta ${despues}.`);
  assert.ok(
    eventos.indexOf(primero) < eventos.indexOf(despues),
    `${primero} debe ocurrir antes de ${despues}.`
  );
}

function leer(ruta) {
  return readFile(new URL(`../${ruta}`, import.meta.url), 'utf8');
}

function normalizarSqlConsolidado(contenido) {
  return contenido.replaceAll('`', '').replace(/,(?!\s)/g, ', ');
}

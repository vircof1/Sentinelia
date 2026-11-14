import assert from 'node:assert/strict';

import {
  AUTORIDAD_PERFIL_SERVIDOR_AGENTE,
  CONFIGURACION_TEMPORAL_PERFIL_SERVIDOR_AGENTE,
  ContratoPerfilServidorAgente,
  DECISIONES_RECONCILIACION_PERFIL_SERVIDOR,
  ESTADOS_PERFIL_SERVIDOR_AGENTE,
  OPERACIONES_PRESENCIA_SERVIDOR_AGENTE,
  ORIGEN_TELEMETRIA_RUNTIME_SERVIDOR,
  PERFILES_OPERATIVOS_AGENTE,
  PRECISION_TEMPORAL_PERFIL_SERVIDOR_AGENTE,
  SENALES_RUNTIME_SERVIDOR_AGENTE,
  VERSION_CONTRATO_PERFIL_SERVIDOR_AGENTE
} from '../paquetes/agentes/src/ContratoPerfilServidorAgente.js';
import {
  crearPeriodoVidaPolAgenteDesdeFila
} from '../paquetes/agentes/src/PeriodoVidaPolAgente.js';
import {
  crearSolicitudHeartbeatAgente
} from '../paquetes/agentes/src/SolicitudHeartbeatAgente.js';
import {
  construirCodigoSenal
} from '../paquetes/agentes/src/TelemetriaAgente.js';

await main();

async function main() {
  verificarIdentidadesCerradas();
  verificarSemanticaPresencia();
  verificarElegibilidadYArmado();
  verificarAutoridadesYDegradacion();
  verificarContratoActualDeHeartbeatYPol();

  console.log(
    '[agentes] OK 5.23.0: contrato=perfil-servidor-v1 ' +
    'pol=login+heartbeat sql=durable_compacto redis=operacional ' +
    'precision=no_forense efectos_retroactivos=no'
  );
}
function verificarIdentidadesCerradas() {
  assert.equal(VERSION_CONTRATO_PERFIL_SERVIDOR_AGENTE, 1);
  assert.deepEqual(PERFILES_OPERATIVOS_AGENTE, {
    GENERICO: 'generico',
    SERVIDOR: 'servidor'
  });
  assert.deepEqual(ESTADOS_PERFIL_SERVIDOR_AGENTE, {
    PENDIENTE_PRIMERA_EVIDENCIA: 'pendiente_primera_evidencia',
    ACTIVO: 'activo',
    RETIRADO: 'retirado',
    DESACTIVADO_INCOMPATIBLE: 'desactivado_incompatible'
  });
  assert.equal(ORIGEN_TELEMETRIA_RUNTIME_SERVIDOR, 'runtime');

  const senales = Object.values(SENALES_RUNTIME_SERVIDOR_AGENTE);
  assert.equal(senales.length, 2);
  assert.deepEqual(
    senales.map((senal) => senal.codigoSenal),
    [
      'runtime.servidor.sin_pol',
      'runtime.servidor.reinicio_reciente'
    ]
  );

  for (const senal of senales) {
    assert.equal(construirCodigoSenal(senal), senal.codigoSenal);
    assert.equal(senal.tipoDato, 'booleano');
    assert.equal(senal.origen, 'runtime');
    assert.equal(senal.valorInicial, false);
    assert.equal(senal.federable, true);
    assert.equal(senal.metadatos.productor, 'sentinelia-runtime');
    assert.equal(senal.metadatos.sistema, true);
    assert.equal(senal.metadatos.contrato, 'perfil-servidor-v1');
    assert.equal(Object.isFrozen(senal), true);
    assert.equal(Object.isFrozen(senal.metadatos), true);
  }
}

function verificarSemanticaPresencia() {
  const contrato = new ContratoPerfilServidorAgente();
  assert.equal(contrato.version, 1);
  assert.throws(
    () => new ContratoPerfilServidorAgente({ version: 2 }),
    /no está soportada/u
  );

  assert.deepEqual(
    contrato.obtenerSemanticaOperacion(
      OPERACIONES_PRESENCIA_SERVIDOR_AGENTE.LOGIN
    ),
    {
      cuentaComoPol: true,
      demuestraHeartbeatExplicito: false,
      puedeArmarGeneracion: true
    }
  );
  assert.deepEqual(
    contrato.obtenerSemanticaOperacion(
      OPERACIONES_PRESENCIA_SERVIDOR_AGENTE.HEARTBEAT
    ),
    {
      cuentaComoPol: true,
      demuestraHeartbeatExplicito: true,
      puedeArmarGeneracion: true
    }
  );

  for (const operacion of [
    OPERACIONES_PRESENCIA_SERVIDOR_AGENTE.REFRESH,
    OPERACIONES_PRESENCIA_SERVIDOR_AGENTE.TELEMETRIA
  ]) {
    assert.deepEqual(contrato.obtenerSemanticaOperacion(operacion), {
      cuentaComoPol: false,
      demuestraHeartbeatExplicito: false,
      puedeArmarGeneracion: false
    });
  }

  assert.throws(
    () => contrato.obtenerSemanticaOperacion('lectura_arbitraria'),
    /no pertenece al contrato de presencia/u
  );
}

function verificarElegibilidadYArmado() {
  const contrato = new ContratoPerfilServidorAgente();
  const sinEvidencia = contrato.evaluarElegibilidad();
  assert.equal(sinEvidencia.elegible, false);
  assert.equal(sinEvidencia.caduca, false);
  assert.deepEqual(sinEvidencia.requisitosPendientes, [
    'login_valido_con_boot_id',
    'heartbeat_explicito_aceptado'
  ]);

  assert.equal(contrato.evaluarElegibilidad({
    loginValidoConBootId: true
  }).elegible, false);
  const elegibilidadHistorica = contrato.evaluarElegibilidad({
    loginValidoConBootId: true,
    heartbeatExplicitoAceptado: true,
    evidenciaEnUtc: '2020-01-01T00:00:00.000Z'
  });
  assert.deepEqual(elegibilidadHistorica, {
    elegible: true,
    caduca: false,
    requisitosPendientes: []
  });

  assert.deepEqual(contrato.evaluarArmado({
    perfilPromovido: true,
    operacion: OPERACIONES_PRESENCIA_SERVIDOR_AGENTE.LOGIN,
    posteriorALaGeneracion: true,
    bootIdValido: true
  }), {
    armable: true,
    estado: ESTADOS_PERFIL_SERVIDOR_AGENTE.ACTIVO
  });
  assert.deepEqual(contrato.evaluarArmado({
    perfilPromovido: true,
    operacion: OPERACIONES_PRESENCIA_SERVIDOR_AGENTE.REFRESH,
    posteriorALaGeneracion: true,
    bootIdValido: true
  }), {
    armable: false,
    estado: ESTADOS_PERFIL_SERVIDOR_AGENTE.PENDIENTE_PRIMERA_EVIDENCIA
  });
  assert.equal(contrato.evaluarArmado({
    perfilPromovido: true,
    operacion: OPERACIONES_PRESENCIA_SERVIDOR_AGENTE.HEARTBEAT,
    posteriorALaGeneracion: false,
    bootIdValido: true
  }).armable, false);
}

function verificarAutoridadesYDegradacion() {
  assert.deepEqual(CONFIGURACION_TEMPORAL_PERFIL_SERVIDOR_AGENTE, {
    campos: {
      HISTERESIS_SIN_POL: 'histeresisSinPolSegundos',
      DURACION_REINICIO_RECIENTE: 'duracionReinicioRecienteSegundos'
    },
    unidad: 'segundos',
    exigeEnterosPositivos: true,
    aplicacion: 'prospectiva',
    recalculaVencimientosAbiertos: false
  });
  assert.deepEqual(AUTORIDAD_PERFIL_SERVIDOR_AGENTE, {
    reloj: 'sentinelia',
    persistenciaDurable: 'sql',
    coordinacionOperativa: 'redis',
    redisEsAutoridadHistorica: false,
    proyeccionSql: 'compacta',
    diarioSqlPorHeartbeat: false
  });
  assert.deepEqual(PRECISION_TEMPORAL_PERFIL_SERVIDOR_AGENTE, {
    modo: 'operacional_no_forense',
    conservaEstadoActual: true,
    conservaVencimientosVigentes: true,
    reconstruyeCiclosResueltos: false,
    ejecutaEfectosRetrospectivos: false
  });

  const contrato = new ContratoPerfilServidorAgente();
  const decisiones = DECISIONES_RECONCILIACION_PERFIL_SERVIDOR;
  assert.equal(contrato.resolverReconciliacionOperativa(),
    decisiones.MANTENER_PENDIENTE_SIN_FOTOGRAFIA);
  assert.equal(contrato.resolverReconciliacionOperativa({
    generacionArmada: true,
    condicionVigente: true,
    valorPublicado: false
  }), decisiones.MATERIALIZAR_CONDICION_VIGENTE);
  assert.equal(contrato.resolverReconciliacionOperativa({
    generacionArmada: true,
    condicionVigente: true,
    valorPublicado: true
  }), decisiones.SIN_CAMBIOS);
  assert.equal(contrato.resolverReconciliacionOperativa({
    generacionArmada: true,
    condicionVigente: false,
    valorPublicado: true
  }), decisiones.MATERIALIZAR_RECUPERACION);
  assert.equal(contrato.resolverReconciliacionOperativa({
    generacionArmada: true,
    condicionVigente: false,
    valorPublicado: false
  }), decisiones.ADOPTAR_ESTADO_ACTUAL_SIN_HISTORIA);
  assert.equal(contrato.resolverReconciliacionOperativa({
    generacionArmada: true,
    condicionVigente: false,
    valorPublicado: null
  }), decisiones.ADOPTAR_ESTADO_ACTUAL_SIN_HISTORIA);
  assert.throws(
    () => contrato.resolverReconciliacionOperativa({
      generacionArmada: true,
      condicionVigente: 'no'
    }),
    /condicionVigente debe ser booleano/u
  );
}

function verificarContratoActualDeHeartbeatYPol() {
  const solicitud = crearSolicitudHeartbeatAgente({
    seq: 8,
    bootId: 'boot-servidor-1',
    timestampClienteUtc: '2099-01-01T00:00:00.000Z'
  });
  const aceptado = solicitud.obtenerHeartbeatAceptado({
    recibidoEnUtc: '2026-08-24T10:30:00.000Z'
  });
  assert.equal(aceptado.seqAceptado, 8);
  assert.equal(aceptado.recibidoEnUtc, '2026-08-24T10:30:00.000Z');
  assert.notEqual(aceptado.desfaseClienteMs, 0);

  const periodo = crearPeriodoVidaPolAgenteDesdeFila({
    id: 9,
    agente_id: 4,
    boot_id: 'boot-servidor-1',
    inicio_utc: '2026-08-24T10:00:00.000Z',
    fin_utc: null,
    heartbeats_recibidos: 8,
    ultimo_heartbeat_utc: '2026-08-24T10:30:00.000Z',
    ultimo_seq: 8,
    motivo_cierre: null,
    fecha_creacion: '2026-08-24T10:00:00.000Z',
    fecha_actualizacion: '2026-08-24T10:30:00.000Z'
  }).serializar();
  assert.equal(periodo.bootId, 'boot-servidor-1');
  assert.equal(periodo.heartbeatsRecibidos, 8);
  assert.equal(periodo.ultimoHeartbeatUtc, '2026-08-24T10:30:00.000Z');
  assert.equal(periodo.ultimoSeq, 8);
  assert.equal(Object.hasOwn(periodo, 'heartbeats'), false);
}

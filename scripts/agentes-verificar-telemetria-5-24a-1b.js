import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';

import {
  crearLecturaTelemetriaAgenteConTiposInternos
} from '../paquetes/agentes/src/TelemetriaAgente.js';
import {
  crearCondicionTipadaDerivacionTelemetria
} from '../paquetes/agentes/src/EvaluadorCondicionesDerivacionTelemetria.js';
import {
  EstadoActualEvaluacionReglaPersistido,
  EventoDerivadoTelemetriaPersistido,
  RepositorioEstadoActualEvaluacionReglasTelemetria,
  RepositorioEvaluacionesReglasTelemetria,
  RepositorioEventosDerivadosTelemetria
} from '../paquetes/agentes/src/RepositorioEvaluacionesDerivadasTelemetria.js';
import {
  RepositorioCatalogoSenalesTelemetriaAgentes
} from '../paquetes/agentes/src/RepositorioCatalogoSenalesTelemetriaAgentes.js';
import {
  RepositorioEstadoActualTelemetriaAgentes
} from '../paquetes/agentes/src/RepositorioEstadoActualTelemetriaAgentes.js';
import {
  RepositorioObservacionesTelemetriaAgentes
} from '../paquetes/agentes/src/RepositorioObservacionesTelemetriaAgentes.js';
import {
  RepositorioReglasDerivacionTelemetria
} from '../paquetes/agentes/src/RepositorioReglasDerivacionTelemetria.js';
import {
  CAUSAS_TRABAJO_EVALUACION_TELEMETRIA,
  MOTIVOS_NEUTRALIZACION_TRABAJO_TELEMETRIA,
  RepositorioTrabajosEvaluacionTelemetria,
  construirClaveCausalCanonica
} from '../paquetes/agentes/src/RepositorioTrabajosEvaluacionTelemetria.js';
import { ClienteSql } from '../paquetes/persistencia-sql/src/ClienteSql.js';
import { EjecutorMigraciones } from '../paquetes/persistencia-sql/src/EjecutorMigraciones.js';
import { RepositorioMigraciones } from '../paquetes/persistencia-sql/src/RepositorioMigraciones.js';
import {
  obtenerConfiguracionAplicacion,
  obtenerRutaMigraciones
} from '../paquetes/utilidades/src/configuracion/obtenerConfiguracionAplicacion.js';

await main();

async function main() {
  verificarCodecsLegacy();
  verificarClavesCausales();
  const configuracion = obtenerConfiguracionAplicacion();
  assert.equal(configuracion.sql.estaCompleta, true, '5.24a.1b necesita MariaDB real.');
  const administrador = new ClienteSql(configuracion.sql);
  const nombre = `sentinelia_fixture_524a1b_${randomBytes(5).toString('hex')}`;
  let sql;
  try {
    await administrador.ejecutar(
      `CREATE DATABASE ${administrador.escaparIdentificador(nombre)} ` +
      'CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci'
    );
    sql = new ClienteSql({ ...configuracion.sql, baseDatos: nombre });
    await new EjecutorMigraciones({
      clienteSql: sql,
      repositorioMigraciones: new RepositorioMigraciones(sql),
      rutaMigraciones: obtenerRutaMigraciones()
    }).ejecutarPendientes();
    await sql.verificarUsoHorarioUtc();

    const fixture = await crearFixture(sql);
    await verificarTrabajos(sql, fixture);
    await verificarLedgerProyeccionesYCascada(sql, fixture);

    console.log(
      '[agentes] OK 5.24a.1b: regla=generacion trabajo=huella_causal ' +
      'neutralizacion=fenced ledger=round_trip_idempotente ' +
      'estado_evento=evaluacion programacion=gobernante legacy=compatible'
    );
  } finally {
    await sql?.cerrar().catch(() => {});
    await administrador.ejecutar(
      `DROP DATABASE IF EXISTS ${administrador.escaparIdentificador(nombre)}`
    ).catch(() => {});
    await administrador.cerrar();
  }
}

function verificarCodecsLegacy() {
  const comun = {
    id: 1, regla_id: 2, regla_revision_id: 3, observacion_id: 4,
    agente_id: 5, senal_id: 6, tenant_id: 7, empresa_id: 8, sitio_id: 9,
    resultado: 'no_coincide', codigo_motivo: 'legacy', explicacion: 'Legacy',
    condicion_canonica: '{"tipo":"calidad"}', valor_evaluado: '"valida"',
    tipo_dato: 'momento_utc', unidad: '', calidad: 'valida',
    severidad_calculada: null, mensaje_operativo: 'Legacy',
    evidencia_contextual: null, observado_en_utc: '2026-09-05 00:00:00',
    recibido_en_utc: '2026-09-05 00:00:01', evaluado_en_utc: '2026-09-05 00:00:02'
  };
  const estado = new EstadoActualEvaluacionReglaPersistido(comun);
  const evento = new EventoDerivadoTelemetriaPersistido(comun);
  for (const valor of [estado, evento]) {
    assert.equal(valor.evaluacionId, null);
    assert.equal(valor.generacionAutoridad, 1);
    assert.equal(valor.causalidadRevision, 'historica_recepcion');
    assert.equal(valor.ladoAtencion, null);
    assert.equal(valor.proximaReevaluacionUtc, null);
  }
}

function verificarClavesCausales() {
  const base = {
    reglaId: 2, generacionAutoridad: 3, reglaRevisionId: 4, observacionId: 5
  };
  assert.equal(
    construirClaveCausalCanonica({
      ...base,
      causa: CAUSAS_TRABAJO_EVALUACION_TELEMETRIA.OBSERVACION
    }),
    'evaluacion_telemetria@1|causa=observacion|regla=2|generacion=3|revision=4|observacion=5'
  );
  assert.match(construirClaveCausalCanonica({
    ...base,
    causa: CAUSAS_TRABAJO_EVALUACION_TELEMETRIA.VENCIMIENTO_TEMPORAL,
    programadoParaUtc: '2026-09-05T01:02:03Z'
  }), /\|programado=2026-09-05T01:02:03\.000Z$/u);
  assert.match(construirClaveCausalCanonica({
    ...base,
    causa: CAUSAS_TRABAJO_EVALUACION_TELEMETRIA.RECONCILIACION_RELOJ,
    generacionCorreccion: '9'
  }), /\|correccion=9$/u);
  assert.throws(() => construirClaveCausalCanonica({
    ...base,
    causa: CAUSAS_TRABAJO_EVALUACION_TELEMETRIA.RECONCILIACION_RELOJ,
    generacionCorreccion: '09'
  }), /corrección causal/u);
}

async function crearFixture(sql) {
  const alias = `f524a1b-${randomBytes(4).toString('hex')}`;
  const [tenant] = await sql.ejecutar('INSERT INTO tenants (nombre,alias) VALUES (?,?)',
    ['Tenant 1b', alias]);
  const [empresa] = await sql.ejecutar(
    'INSERT INTO empresas (tenant_id,nombre,alias) VALUES (?,?,?)',
    [tenant.insertId, 'Empresa 1b', alias]
  );
  const [sitio] = await sql.ejecutar(
    'INSERT INTO sitios (tenant_id,empresa_id,nombre,alias) VALUES (?,?,?,?)',
    [tenant.insertId, empresa.insertId, 'Sitio 1b', alias]
  );
  const [agenteFila] = await sql.ejecutar(
    `INSERT INTO agentes_sentinelia
      (guid,tenant_id,empresa_id,sitio_id,nombre,secreto_hash)
     VALUES (?,?,?,?,?,?)`,
    [randomUUID(), tenant.insertId, empresa.insertId, sitio.insertId,
      'Agente 1b', 'hash-no-utilizable']
  );
  const agente = {
    id: Number(agenteFila.insertId), tenantId: Number(tenant.insertId),
    empresaId: Number(empresa.insertId), sitioId: Number(sitio.insertId)
  };
  const senal = await new RepositorioCatalogoSenalesTelemetriaAgentes(sql)
    .guardarDeclaracionSenal({
      agenteId: agente.id,
      definicion: {
        categoria: 'copias', clave: 'proxima', tipoDato: 'momento_utc',
        nombreHumano: 'Próxima copia'
      }
    });
  const condicion = crearCondicionTipadaDerivacionTelemetria({
    senal, tipo: 'calidad', operador: '=', calidadEsperada: 'valida'
  });
  const reglaPersistida = await new RepositorioReglasDerivacionTelemetria(sql)
    .crearConRevisionInicial({
      agenteId: agente.id, senalId: senal.id, ...agente,
      revision: {
        condicion, severidadCalculada: 'advertencia',
        mensajeOperativo: 'La copia requiere atención.', nombre: 'Copia relativa'
      }
    });
  assert.equal(reglaPersistida.regla.generacionAutoridad, 1);
  const recibidoEnUtc = new Date(
    Date.parse(reglaPersistida.revisionVigente.vigenteDesdeUtc) + 1000
  ).toISOString();
  const lote = await new RepositorioObservacionesTelemetriaAgentes(sql)
    .insertarLoteAceptado({
      agenteId: agente.id,
      senalesCatalogadas: [senal],
      recibidoEnUtc,
      observacionesAceptadas: [crearLecturaTelemetriaAgenteConTiposInternos({
        categoria: 'copias', clave: 'proxima', tipoDato: 'momento_utc',
        valorMomentoUtc: '2026-09-05T02:00:00Z', calidad: 'valida',
        observadoEnUtc: '2026-09-05T00:00:00Z'
      })]
    });
  await new RepositorioEstadoActualTelemetriaAgentes(sql)
    .aplicarObservacionesHistoricas(lote.insertadas);
  return {
    ...agente, senal, regla: reglaPersistida.regla,
    revision: reglaPersistida.revisionVigente, observacion: lote.insertadas[0]
  };
}

async function verificarTrabajos(sql, fixture) {
  const repositorio = new RepositorioTrabajosEvaluacionTelemetria(sql);
  const historico1 = await repositorio.encolar(fixture);
  const historico2 = await repositorio.encolar(fixture);
  assert.equal(historico1.creado, true);
  assert.equal(historico2.creado, false);
  assert.equal(historico2.trabajo.id, historico1.trabajo.id);
  assert.equal(historico1.trabajo.huellaCausalSha256.length, 64);

  const programadoParaUtc = new Date(Date.parse(fixture.observacion.recibidoEnUtc) + 2000)
    .toISOString();
  const vencimiento1 = await repositorio.encolar({
    ...fixture,
    causa: CAUSAS_TRABAJO_EVALUACION_TELEMETRIA.VENCIMIENTO_TEMPORAL,
    programadoParaUtc
  });
  const vencimiento2 = await repositorio.encolar({
    ...fixture,
    causa: CAUSAS_TRABAJO_EVALUACION_TELEMETRIA.VENCIMIENTO_TEMPORAL,
    programadoParaUtc
  });
  assert.equal(vencimiento1.creado, true);
  assert.equal(vencimiento2.creado, false);
  assert.notEqual(vencimiento1.trabajo.id, historico1.trabajo.id);

  await sql.ejecutar(
    `UPDATE trabajos_evaluacion_telemetria
        SET siguiente_intento_utc=TIMESTAMPADD(SECOND,-1,UTC_TIMESTAMP(6))
      WHERE id=?`,
    [vencimiento1.trabajo.id]
  );
  const reclamado = (await repositorio.reclamarSiguientes({
    reclamadoPor: 'fixture-1b-neutraliza', limite: 10, ttlSegundos: 30
  })).find(({ id }) => Number(id) === Number(vencimiento1.trabajo.id));
  assert.ok(reclamado);
  await repositorio.marcarNeutralizado({
    trabajoId: reclamado.id,
    reclamadoPor: 'fixture-1b-neutraliza',
    motivo: MOTIVOS_NEUTRALIZACION_TRABAJO_TELEMETRIA.REVISION_SUSTITUIDA
  });
  const neutralizado = await repositorio.buscarPorId(reclamado.id);
  assert.equal(neutralizado.estado, 'neutralizado');
  assert.equal(neutralizado.motivoNeutralizacion, 'revision_sustituida');
  assert.ok(neutralizado.completadoEnUtc);

  const reintento = (await repositorio.encolar({
    ...fixture,
    causa: CAUSAS_TRABAJO_EVALUACION_TELEMETRIA.RECONCILIACION_RELOJ,
    generacionCorreccion: '1'
  })).trabajo;
  await sql.ejecutar(
    `UPDATE trabajos_evaluacion_telemetria
        SET siguiente_intento_utc=TIMESTAMPADD(SECOND,-1,UTC_TIMESTAMP(6))
      WHERE id=?`,
    [reintento.id]
  );
  const primerClaim = (await repositorio.reclamarSiguientes({
    reclamadoPor: 'fixture-1b-reintento', limite: 10, ttlSegundos: 30
  })).find(({ id }) => Number(id) === Number(reintento.id));
  assert.equal(primerClaim?.intentos, 1);
  const error = await repositorio.registrarErrorTecnico({
    trabajoId: reintento.id,
    reclamadoPor: 'fixture-1b-reintento',
    codigoError: 'fallo_fixture',
    mensajeError: 'Fallo recuperable preparado.',
    demoraReintentoSegundos: 1
  });
  assert.equal(error.registrado, true);
  await sql.ejecutar(
    `UPDATE trabajos_evaluacion_telemetria
        SET siguiente_intento_utc=TIMESTAMPADD(SECOND,-1,UTC_TIMESTAMP(6))
      WHERE id=?`,
    [reintento.id]
  );
  const segundoClaim = (await repositorio.reclamarSiguientes({
    reclamadoPor: 'fixture-1b-reintento-2', limite: 10, ttlSegundos: 30
  })).find(({ id }) => Number(id) === Number(reintento.id));
  assert.equal(segundoClaim?.intentos, 2);
  await repositorio.marcarNeutralizado({
    trabajoId: reintento.id,
    reclamadoPor: 'fixture-1b-reintento-2',
    motivo: MOTIVOS_NEUTRALIZACION_TRABAJO_TELEMETRIA.GENERACION_SUSTITUIDA
  });

  fixture.trabajoLedger = (await repositorio.encolar({
    ...fixture,
    causa: CAUSAS_TRABAJO_EVALUACION_TELEMETRIA.RECONCILIACION_ADMINISTRATIVA
  })).trabajo;
}

async function verificarLedgerProyeccionesYCascada(sql, fixture) {
  const ledger = new RepositorioEvaluacionesReglasTelemetria(sql);
  const estados = new RepositorioEstadoActualEvaluacionReglasTelemetria(sql);
  const eventos = new RepositorioEventosDerivadosTelemetria(sql);
  const ahoraUtc = new Date(Date.parse(fixture.observacion.recibidoEnUtc) + 3000)
    .toISOString();
  const datos = {
    reglaId: fixture.regla.id,
    revisionId: fixture.revision.id,
    observacionId: fixture.observacion.id,
    agenteId: fixture.id,
    senalId: fixture.senal.id,
    tenantId: fixture.tenantId,
    empresaId: fixture.empresaId,
    sitioId: fixture.sitioId,
    generacionAutoridad: 1,
    causalidadRevision: 'autoridad_actual',
    resultado: 'coincide',
    ladoAtencion: 'inferior',
    resultadoAnterior: 'no_coincide',
    ladoAnterior: null,
    momentoUtc: '2026-09-05T02:00:00Z',
    ahoraUtc,
    desviacionSegundos: '-3600',
    proximaReevaluacionUtc: new Date(Date.parse(ahoraUtc) + 1000).toISOString(),
    codigoMotivo: 'momento_fuera_limite_inferior',
    explicacion: 'La fecha está por debajo del límite relativo.',
    condicionCanonica: fixture.revision.condicion.obtenerCanonica(),
    valorEvaluado: '2026-09-05T02:00:00Z',
    tipoDato: 'momento_utc',
    unidad: null,
    calidad: 'valida',
    severidadCalculada: 'advertencia',
    mensajeOperativo: 'La copia requiere atención.',
    evidenciaContextual: { fuente: 'fixture-1b' },
    observadoEnUtc: fixture.observacion.observadoEnUtc,
    recibidoEnUtc: fixture.observacion.recibidoEnUtc,
    evaluadoEnUtc: ahoraUtc
  };
  const primera = await ledger.registrar({ trabajo: fixture.trabajoLedger, evaluacion: datos });
  const segunda = await ledger.registrar({ trabajo: fixture.trabajoLedger, evaluacion: datos });
  assert.equal(primera.creado, true);
  assert.equal(segunda.creado, false);
  assert.equal(primera.evaluacion.id, segunda.evaluacion.id);
  assert.equal(primera.evaluacion.desviacionSegundos, '-3600');
  await assert.rejects(
    ledger.registrar({
      trabajo: fixture.trabajoLedger,
      evaluacion: { ...datos, codigoMotivo: 'decision_distinta' }
    }),
    /evaluación durable diferente/u
  );
  await assert.rejects(
    ledger.registrar({
      trabajo: { ...fixture.trabajoLedger.serializar(), id: 999999 },
      evaluacion: { ...datos, evidenciaContextual: { texto: 'x'.repeat(4097) } }
    }),
    /4096/u
  );

  const proyectado = await estados.aplicarResultado(primera.evaluacion);
  assert.equal(proyectado.actualizado, true);
  assert.equal(proyectado.estado.evaluacionId, primera.evaluacion.id);
  const gobernante = await estados.buscarProgramacionGobernantePorRegla(fixture.regla.id);
  assert.equal(gobernante?.proximaReevaluacionUtc, datos.proximaReevaluacionUtc);

  const evento1 = await eventos.insertarSiCoincide(primera.evaluacion);
  const evento2 = await eventos.insertarSiCoincide(primera.evaluacion);
  assert.equal(evento1.creado, true);
  assert.equal(evento2.creado, false);
  assert.equal(evento1.evento.evaluacionId, primera.evaluacion.id);

  await sql.ejecutar('DELETE FROM trabajos_evaluacion_telemetria WHERE id=?',
    [fixture.trabajoLedger.id]);
  const [conteos] = await sql.consultar(
    `SELECT
       (SELECT COUNT(*) FROM evaluaciones_reglas_telemetria WHERE id=?) evaluaciones,
       (SELECT COUNT(*) FROM estado_actual_evaluacion_reglas_telemetria
         WHERE evaluacion_id=?) estados,
       (SELECT COUNT(*) FROM eventos_derivados_telemetria WHERE evaluacion_id=?) eventos`,
    [primera.evaluacion.id, primera.evaluacion.id, primera.evaluacion.id]
  );
  assert.deepEqual(
    [Number(conteos.evaluaciones), Number(conteos.estados), Number(conteos.eventos)],
    [0, 0, 0]
  );
}

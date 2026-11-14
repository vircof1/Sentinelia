import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';

import { AdaptadorCapturaTransaccionalFederacionSql } from '../paquetes/federacion/adaptadores/AdaptadorCapturaTransaccionalFederacionSql.js';
import { FuenteEntropiaCriptograficaNode } from '../paquetes/federacion/adaptadores/FuenteEntropiaCriptograficaNode.js';
import { RepositorioCursoresRecepcionFederacionSql } from '../paquetes/federacion/adaptadores/RepositorioCursoresRecepcionFederacionSql.js';
import { RepositorioEntregasFederacionSql } from '../paquetes/federacion/adaptadores/RepositorioEntregasFederacionSql.js';
import { RepositorioFlujosFederacionSql } from '../paquetes/federacion/adaptadores/RepositorioFlujosFederacionSql.js';
import { RepositorioInboxFederacionSql } from '../paquetes/federacion/adaptadores/RepositorioInboxFederacionSql.js';
import { RepositorioOcurrenciasFederacionSql } from '../paquetes/federacion/adaptadores/RepositorioOcurrenciasFederacionSql.js';
import { RepositorioOutboxFederacionSql } from '../paquetes/federacion/adaptadores/RepositorioOutboxFederacionSql.js';
import {
  ServicioRecepcionLotesFederacionLocal,
  validarContratoRecepcionOcurrenciaFederada
} from '../paquetes/federacion/aplicacion/ServicioRecepcionLotesFederacionLocal.js';
import { crearFixtureConfiguracionFederacion } from '../paquetes/federacion/fixtures/ContratoFederacionFixtures.js';
import { crearCampoPresenteFederado } from '../paquetes/federacion/src/EnvolventeFederacion.js';
import {
  crearContratoFragmentacionTipadaFederacion,
  fragmentarOcurrenciaTipadaFederacion,
  planificarLotesFederacion,
  reagruparFragmentosTipadosFederacion
} from '../paquetes/federacion/src/PlanificacionLotesFederacion.js';
import {
  GeneradorIdentidadesFederadas,
  TIPOS_IDENTIDAD_FEDERADA,
  crearIdentidadFederada
} from '../paquetes/federacion/src/IdentidadFederada.js';
import { ClienteSql } from '../paquetes/persistencia-sql/src/ClienteSql.js';
import { EjecutorMigraciones } from '../paquetes/persistencia-sql/src/EjecutorMigraciones.js';
import { RepositorioMigraciones } from '../paquetes/persistencia-sql/src/RepositorioMigraciones.js';
import {
  obtenerConfiguracionAplicacion,
  obtenerRutaMigraciones
} from '../paquetes/utilidades/src/configuracion/obtenerConfiguracionAplicacion.js';

const USUARIO_FIXTURE = '5221210';
const generador = new GeneradorIdentidadesFederadas({
  fuenteEntropia: new FuenteEntropiaCriptograficaNode()
});

await main();

async function main() {
  await verificarRegistro();
  verificarPlanificacionYFragmentacion();
  verificarValidacionContractualPrevia();
  const configuracion = obtenerConfiguracionAplicacion();
  assert.equal(configuracion.sql.estaCompleta, true);
  const sql = new ClienteSql(configuracion.sql);
  const ids = crearIdentidades();
  try {
    await new EjecutorMigraciones({
      clienteSql: sql,
      repositorioMigraciones: new RepositorioMigraciones(sql),
      rutaMigraciones: obtenerRutaMigraciones()
    }).ejecutarPendientes();
    await limpiar(sql);
    await crearPlanoControl(sql, ids);
    await verificarPrioridadOutbox(sql, ids);
    await verificarLimitesYBackpressure(sql, ids);
  } finally {
    await limpiar(sql);
    await sql.cerrar();
  }
  console.log(
    '[federacion] OK 5.22.12j: prioridad=durable backpressure=dinamico ' +
    'limites=reagrupables fragmentacion=tipada ocurrencia=inmutable ' +
    'procedencia=contabilizada'
  );
}

function verificarValidacionContractualPrevia() {
  const registro = {
    obtenerProductivo({ familia, versionFamilia }) {
      if (familia !== 'monitores' || versionFamilia !== 1) {
        const error = new Error('Versión no soportada.');
        error.name = 'ErrorAdaptadoresFamiliasFederacion';
        error.codigo = 'adaptador_familia_no_registrado';
        throw error;
      }
      return {
        interfaces: {
          payload: {
            validarPayload(payload) {
              if (payload?.perfil !== 'fixture-valido') {
                const error = new Error('Payload inválido.');
                error.name = 'ErrorPayloadMonitoresFederacion';
                error.codigo = 'forma_payload_monitor_invalida';
                throw error;
              }
              return payload;
            }
          }
        }
      };
    }
  };
  const valida = {
    familia: 'monitores',
    familiaVersion: 1,
    operacion: 'actualizacion',
    campos: {
      monitores: crearCampoPresenteFederado({
        valor: { perfil: 'fixture-valido' }
      })
    }
  };
  assert.deepEqual(
    validarContratoRecepcionOcurrenciaFederada(valida, registro),
    { perfil: 'fixture-valido' }
  );
  assert.throws(
    () => validarContratoRecepcionOcurrenciaFederada({
      ...valida,
      campos: {
        monitores: crearCampoPresenteFederado({ valor: { perfil: 'invalido' } })
      }
    }, registro),
    (error) => error.name === 'ErrorPayloadMonitoresFederacion'
  );
  assert.throws(
    () => validarContratoRecepcionOcurrenciaFederada({
      ...valida,
      familiaVersion: 2
    }, registro),
    (error) => error.codigo === 'adaptador_familia_no_registrado'
  );
}

async function verificarRegistro() {
  const [planificador, servicio] = await Promise.all([
    leer('../paquetes/federacion/src/PlanificacionLotesFederacion.js'),
    leer('../paquetes/federacion/aplicacion/ServicioRecepcionLotesFederacionLocal.js')
  ]);
  assert.match(planificador, /fragmentarOcurrenciaTipadaFederacion/u);
  assert.match(planificador, /planificarLotesFederacion/u);
  assert.match(servicio, /resolverCapacidad/u);
  assert.doesNotMatch(planificador, /from\s+['"](?:node:|mysql|redis|express)/u);
}

function verificarPlanificacionYFragmentacion() {
  const ids = crearIdentidades();
  const ocurrencias = [
    ocurrencia(ids, ids.ocurrenciasRecepcion[0], ids.elementosRecepcion[0], '1', 'histórico'),
    ocurrencia(ids, ids.ocurrenciasRecepcion[1], ids.elementosRecepcion[1], '1', 'actual')
  ];
  const lotesGenerados = [ids.lotesPlanificados[0], ids.lotesPlanificados[1]];
  const plan = planificarLotesFederacion({
    relacionId: ids.relacionRecepcionId,
    flujoId: ids.flujoRecepcionId,
    generacionId: ids.generacionRecepcionId,
    candidatos: [
      entregaPlan(ids.entregasRecepcion[0], '1', 'reconstruccion', ocurrencias[0]),
      entregaPlan(ids.entregasRecepcion[1], '2', 'operativaActual', ocurrencias[1])
    ],
    capacidad: {
      maximoOcurrenciasPorLote: 1,
      maximoBytesPorLote: 4096,
      maximoBytesPorOcurrencia: 2048
    },
    generarLoteId: () => lotesGenerados.shift()
  });
  assert.deepEqual(plan.lotes.map((lote) => [
    lote.prioridad,
    lote.entregas[0].entregaId,
    lote.entregas[0].ocurrencia.ocurrenciaOrigenId
  ]), [
    ['operativaActual', ids.entregasRecepcion[1], String(ids.ocurrenciasRecepcion[1])],
    ['reconstruccion', ids.entregasRecepcion[0], String(ids.ocurrenciasRecepcion[0])]
  ]);

  const grande = ocurrencia(
    ids,
    ids.ocurrenciasRecepcion[2],
    ids.elementosRecepcion[2],
    '1',
    'á'.repeat(900)
  );
  const contrato = crearContratoFragmentacionTipadaFederacion({
    familia: 'monitores',
    versionFamilia: 1,
    tipo: 'monitor-completo-v1'
  });
  const fragmentacion = fragmentarOcurrenciaTipadaFederacion({
    ocurrencia: grande,
    entregaId: ids.entregasRecepcion[2],
    contrato,
    maximoBytesFragmento: 256,
    calcularHuella: sha256Hex
  });
  assert.ok(fragmentacion.fragmentos.length > 2);
  assert.ok(fragmentacion.fragmentos.every((fragmento) =>
    fragmento.identidadOcurrencia.ocurrenciaOrigenId ===
      String(ids.ocurrenciasRecepcion[2])));
  const reagrupada = reagruparFragmentosTipadosFederacion({
    fragmentos: [...fragmentacion.fragmentos].reverse(),
    contrato,
    calcularHuella: sha256Hex
  });
  assert.deepEqual(reagrupada, JSON.parse(JSON.stringify(grande)));
  assert.throws(
    () => reagruparFragmentosTipadosFederacion({
      fragmentos: fragmentacion.fragmentos.map((fragmento, indice) => indice === 1
        ? { ...fragmento, contenido: `${fragmento.contenido}x` }
        : fragmento),
      contrato,
      calcularHuella: sha256Hex
    }),
    (error) => error.codigo === 'fragmentacion_divergente'
  );
}

async function verificarPrioridadOutbox(sql, ids) {
  const ocurrencias = new RepositorioOcurrenciasFederacionSql(sql, {
    installationLocalId: ids.installationLocalId
  });
  const outbox = new RepositorioOutboxFederacionSql(sql);
  const captura = new AdaptadorCapturaTransaccionalFederacionSql({
    repositorioOcurrencias: ocurrencias,
    repositorioOutbox: outbox
  });
  const conexion = await sql.obtenerConexion();
  try {
    await conexion.beginTransaction();
    await captura.capturarEnTransaccion({
      definicion: ocurrenciaDefinicionLocal(ids, 0, 'histórico'),
      destinos: [{
        flujoId: ids.flujoEmisionId,
        generacionId: ids.generacionEmisionId,
        prioridad: 'reconstruccion'
      }]
    }, { conexion });
    await captura.capturarEnTransaccion({
      definicion: ocurrenciaDefinicionLocal(ids, 1, 'estado-vigente'),
      destinos: [{
        flujoId: ids.flujoEmisionId,
        generacionId: ids.generacionEmisionId,
        prioridad: 'operativaActual'
      }]
    }, { conexion });
    await conexion.commit();
  } catch (error) {
    await conexion.rollback().catch(() => {});
    throw error;
  } finally {
    conexion.release();
  }
  const pendientes = await outbox.listarPendientes({ limite: 10 });
  const propias = pendientes.filter((item) => item.flujoId === ids.flujoEmisionId);
  assert.deepEqual(propias.map((item) => [item.posicionFlujo, item.prioridad]), [
    ['2', 'operativaActual'],
    ['1', 'reconstruccion']
  ]);
  await assert.rejects(
    sql.ejecutar(
      "UPDATE outbox_federacion SET prioridad='operativaActual' WHERE flujo_id=? AND posicion_flujo=1",
      [ids.flujoEmisionId]
    ),
    (error) => error.sqlState === '45000'
  );
}

async function verificarLimitesYBackpressure(sql, ids) {
  let versionConfiguracion = 1;
  let maximoOcurrencias = 1;
  let capacidadTemporal = 2;
  let disponible = true;
  let maximoBytesLote = 4096;
  let maximoBytesOcurrencia = 1024;
  const resolverCapacidad = async () => ({
    versionConfiguracion: String(versionConfiguracion),
    configuracion: crearFixtureConfiguracionFederacion({
      loteMaximoOcurrencias: maximoOcurrencias,
      loteMaximoBytes: maximoBytesLote,
      ocurrenciaMaximaBytes: maximoBytesOcurrencia,
      capacidadReceptoraOcurrencias: capacidadTemporal
    }),
    disponible,
    familiasSoportadas: ['monitores'],
    versionesFamilia: { monitores: 1 }
  });
  const servicio = crearServicioRecepcion(sql, resolverCapacidad);
  const dos = loteRecepcion(ids, ids.loteLimiteId, [0, 1]);
  await assert.rejects(
    servicio.entregarLote(dos),
    (error) => error.codigo === 'lote_excede_limites' &&
      error.capacidad.versionConfiguracion === '1'
  );
  assert.equal(await contarLote(sql, ids.loteLimiteId), 0);

  maximoOcurrencias = 10;
  capacidadTemporal = 1;
  versionConfiguracion = 2;
  const parcial = await servicio.entregarLote({ ...dos, loteId: ids.loteCapacidadId });
  assert.equal(parcial.estado, 'parcialTemporal');
  assert.equal(parcial.capacidad.versionConfiguracion, '2');
  assert.deepEqual(parcial.resultados.map((resultado) => [
    resultado.resultado,
    resultado.errorTemporal
  ]), [
    ['aceptada', null],
    ['aplazadaCapacidad', 'capacidadTemporalAgotada']
  ]);

  capacidadTemporal = 2;
  versionConfiguracion = 3;
  const terminal = await servicio.entregarLote({ ...dos, loteId: ids.loteCapacidadId });
  assert.equal(terminal.estado, 'terminal');
  assert.equal(terminal.capacidad.versionConfiguracion, '3');
  assert.deepEqual(terminal.resultados.map((resultado) => resultado.resultado), [
    'aceptada', 'aceptada'
  ]);

  const grande = loteRecepcion(ids, ids.loteGrandeId, [2], { detalleGrande: 'x'.repeat(1500) });
  const rechazo = await servicio.entregarLote(grande);
  assert.equal(rechazo.resultados[0].resultado, 'rechazadaDefinitiva');
  assert.equal(rechazo.resultados[0].errorTerminal, 'ocurrenciaExcedeLimite');

  disponible = false;
  versionConfiguracion = 4;
  const detenidaEntrada = loteRecepcion(ids, ids.loteDetenidoId, [3]);
  const detenida = await servicio.entregarLote(detenidaEntrada);
  assert.equal(detenida.resultados[0].errorTemporal, 'relacionTemporalmenteDetenida');
  disponible = true;
  versionConfiguracion = 5;
  const recuperada = await servicio.entregarLote(detenidaEntrada);
  assert.equal(recuperada.resultados[0].resultado, 'aceptada');
  assert.equal(recuperada.progreso.posicionTerminalContigua, '4');

  maximoBytesLote = 4 * 1024 * 1024;
  maximoBytesOcurrencia = 2 * 1024 * 1024;
  versionConfiguracion = 6;
  const fisicamenteGrande = loteRecepcion(
    ids,
    ids.loteFisicamenteGrandeId,
    [4],
    { detalleGrande: 'x'.repeat((2 * 1024 * 1024) + 1024) }
  );
  const rechazoFisico = await servicio.entregarLote(fisicamenteGrande);
  assert.equal(rechazoFisico.resultados[0].errorTerminal, 'ocurrenciaExcedeLimite');
  assert.equal(rechazoFisico.progreso.posicionTerminalContigua, '5');
  const [entregaFisica] = await sql.consultar(
    `SELECT OCTET_LENGTH(ocurrencia_canonica) AS bytes
       FROM entregas_recepcion_federacion
      WHERE entrega_id=?`,
    [ids.entregasRecepcion[4]]
  );
  assert.ok(Number(entregaFisica.bytes) > 2 * 1024 * 1024);

  maximoBytesLote = 4096;
  maximoBytesOcurrencia = 1024;
  versionConfiguracion = 7;
  const procedenciaGrande = loteRecepcion(
    ids,
    ids.loteProcedenciaGrandeId,
    [5],
    { procedenciaGrande: 'p'.repeat(1500) }
  );
  const rechazoProcedencia = await servicio.entregarLote(procedenciaGrande);
  assert.equal(rechazoProcedencia.resultados[0].resultado, 'rechazadaDefinitiva');
  assert.equal(
    rechazoProcedencia.resultados[0].errorTerminal,
    'ocurrenciaExcedeLimite'
  );
}

function crearServicioRecepcion(sql, resolverCapacidad) {
  return new ServicioRecepcionLotesFederacionLocal({
    clienteSql: sql,
    repositorioEntregas: new RepositorioEntregasFederacionSql(sql),
    repositorioInbox: new RepositorioInboxFederacionSql(sql),
    repositorioCursores: new RepositorioCursoresRecepcionFederacionSql(sql),
    resolverCapacidad
  });
}

function loteRecepcion(
  ids,
  loteId,
  indices,
  { detalleGrande = null, procedenciaGrande = null } = {}
) {
  return {
    loteId,
    relacionId: ids.relacionRecepcionId,
    flujoId: ids.flujoRecepcionId,
    generacionId: ids.generacionRecepcionId,
    entregas: indices.map((indice) => ({
      entregaId: ids.entregasRecepcion[indice],
      posicionFlujo: String(indice + 1),
      ocurrencia: ocurrencia(
        ids,
        ids.ocurrenciasRecepcion[indice],
        ids.elementosRecepcion[indice],
        '1',
        detalleGrande ?? `recepción-${indice + 1}`
      ),
      ...(procedenciaGrande === null
        ? {}
        : { procedencia: { detalle: procedenciaGrande } })
    }))
  };
}

function entregaPlan(entregaId, posicionFlujo, prioridad, contenido) {
  return { entregaId, posicionFlujo, prioridad, ocurrencia: contenido };
}

function ocurrencia(ids, ocurrenciaId, elementoId, secuencia, detalle) {
  return {
    familia: 'monitores',
    familiaVersion: 1,
    installationOrigenId: identidad(
      TIPOS_IDENTIDAD_FEDERADA.INSTALACION,
      ids.installationRemotaId
    ),
    elementoOrigenId: identidad(TIPOS_IDENTIDAD_FEDERADA.ELEMENTO_ORIGEN, elementoId),
    ocurrenciaOrigenId: identidad(
      TIPOS_IDENTIDAD_FEDERADA.OCURRENCIA_ORIGEN,
      ocurrenciaId
    ),
    secuenciaElemento: secuencia,
    operacion: 'actualizacion',
    tiempoOrigenUtc: '2030-01-01T00:00:00.000Z',
    scopeOrigenDeclarado: {
      nivel: 'portal', tenantId: null, empresaId: null, sitioId: null
    },
    vigenciaRestanteMs: '300000',
    campos: {
      estadoOperativo: crearCampoPresenteFederado({ valor: { detalle } })
    },
    evidenciaIntegridad: []
  };
}

function ocurrenciaDefinicionLocal(ids, indice, detalle) {
  return {
    ...ocurrencia(
      { ...ids, installationRemotaId: ids.installationLocalId },
      ids.ocurrenciasEmision[indice],
      ids.elementosEmision[indice],
      '1',
      detalle
    ),
    installationOrigenId: identidad(
      TIPOS_IDENTIDAD_FEDERADA.INSTALACION,
      ids.installationLocalId
    )
  };
}

async function crearPlanoControl(sql, ids) {
  await crearRelacion(sql, {
    relacionId: ids.relacionEmisionId,
    installationRemotaId: ids.installationRemotaId,
    direccion: 'emision'
  });
  await crearRelacion(sql, {
    relacionId: ids.relacionRecepcionId,
    installationRemotaId: ids.installationRemotaId,
    direccion: 'recepcion'
  });
  const flujos = new RepositorioFlujosFederacionSql(sql, {
    installationLocalId: ids.installationLocalId
  });
  await flujos.crearFlujoInicial({
    flujo: definicionFlujo(ids.flujoEmisionId, ids.relacionEmisionId, 'emision'),
    generacion: definicionGeneracion(
      ids.generacionEmisionId,
      ids.installationLocalId,
      ids.bootLocalId,
      '0'
    )
  });
  await flujos.crearFlujoInicial({
    flujo: definicionFlujo(ids.flujoRecepcionId, ids.relacionRecepcionId, 'recepcion'),
    generacion: definicionGeneracion(
      ids.generacionRecepcionId,
      ids.installationRemotaId,
      ids.bootRemotoId,
      '4'
    )
  });
}

async function crearRelacion(sql, { relacionId, installationRemotaId, direccion }) {
  const ahora = new Date();
  await sql.ejecutar(
    `INSERT INTO relaciones_federacion (
       relacion_id,direccion,estado_ciclo,estado_autoridad,estado_identidad,
       estado_compatibilidad,installation_remota_candidata_id,
       installation_remota_id,nombre_remoto_declarado,responsable_usuario_id,
       responsable_original_usuario_id,scope_tenant_id,scope_empresa_id,
       scope_sitio_id,version_autoridad,corte_autoridad_utc,
       creada_por_usuario_id,creada_en_utc,actualizada_en_utc,revision
     ) VALUES (
       ?,?,'vinculada','autorizada','valida','compatible',?,?,
       'fixture 5.22.12j',?,?,NULL,NULL,NULL,1,NULL,?,?,?,1
     )`,
    [
      relacionId,
      direccion,
      installationRemotaId,
      installationRemotaId,
      USUARIO_FIXTURE,
      USUARIO_FIXTURE,
      USUARIO_FIXTURE,
      ahora,
      ahora
    ]
  );
}

function definicionFlujo(flujoId, relacionId, direccion) {
  return {
    flujoId,
    relacionId,
    direccion,
    familia: 'monitores',
    versionFamilia: 1,
    contexto: { nivel: 'portal' }
  };
}

function definicionGeneracion(generacionId, installationId, bootId, fronteraInicial) {
  return {
    generacionId,
    clase: 'inicial',
    fronteraInicial,
    propietario: { installationId, bootId, version: 1 }
  };
}

async function limpiar(sql) {
  const relaciones = await sql.consultar(
    'SELECT relacion_id,installation_remota_id FROM relaciones_federacion WHERE creada_por_usuario_id=?',
    [USUARIO_FIXTURE]
  ).catch(() => []);
  for (const relacion of relaciones) {
    const flujos = await sql.consultar(
      'SELECT flujo_id FROM flujos_federacion WHERE relacion_id=?',
      [relacion.relacion_id]
    ).catch(() => []);
    const flujoIds = flujos.map((fila) => fila.flujo_id);
    const origenes = flujoIds.length
      ? await sql.consultar(
          `SELECT DISTINCT installation_origen_id
             FROM posiciones_ocurrencias_flujos_federacion
            WHERE flujo_id IN (${flujoIds.map(() => '?').join(',')})`,
          flujoIds
        ).catch(() => [])
      : [];
    if (flujoIds.length) await limpiarFlujos(sql, flujoIds);
    await sql.ejecutar(
      `DELETE c FROM conflictos_contenido_inbox_federacion c
        JOIN inbox_ocurrencias_federacion i ON i.id=c.inbox_ocurrencia_id
       WHERE i.installation_origen_id IN (?,?)`,
      [relacion.installation_remota_id, relacion.installation_remota_id]
    ).catch(() => {});
    await sql.ejecutar(
      'DELETE FROM inbox_ocurrencias_federacion WHERE installation_origen_id=?',
      [relacion.installation_remota_id]
    ).catch(() => {});
    await sql.ejecutar('DELETE FROM relaciones_federacion WHERE relacion_id=?', [relacion.relacion_id])
      .catch(() => {});
    for (const origen of origenes) {
      await limpiarOcurrencias(sql, origen.installation_origen_id);
    }
  }
  for (const installationId of [...new Set(relaciones.map((r) => r.installation_remota_id))]) {
    await limpiarOcurrencias(sql, installationId);
  }
}

async function limpiarFlujos(sql, flujoIds) {
  const marcas = flujoIds.map(() => '?').join(',');
  await sql.ejecutar(
    `DELETE FROM resultados_entregas_recepcion_federacion WHERE lote_id IN (
       SELECT lote_id FROM lotes_recepcion_federacion WHERE flujo_id IN (${marcas})
     )`, flujoIds
  ).catch(() => {});
  for (const tabla of [
    'intentos_lotes_recepcion_federacion',
    'composiciones_lotes_recepcion_federacion'
  ]) {
    await sql.ejecutar(
      `DELETE FROM ${tabla} WHERE lote_id IN (
         SELECT lote_id FROM lotes_recepcion_federacion WHERE flujo_id IN (${marcas})
       )`, flujoIds
    ).catch(() => {});
  }
  await sql.ejecutar(
    `DELETE FROM lotes_recepcion_federacion WHERE flujo_id IN (${marcas})`, flujoIds
  ).catch(() => {});
  await sql.ejecutar(
    `DELETE FROM entregas_recepcion_federacion WHERE flujo_id IN (${marcas})`, flujoIds
  ).catch(() => {});
  await sql.ejecutar(
    `DELETE FROM rangos_terminales_recepcion_federacion WHERE generacion_id IN (
       SELECT generacion_id FROM generaciones_flujos_federacion WHERE flujo_id IN (${marcas})
     )`, flujoIds
  ).catch(() => {});
  await sql.ejecutar(
    `DELETE FROM cursores_generaciones_recepcion_federacion WHERE flujo_id IN (${marcas})`, flujoIds
  ).catch(() => {});
  await sql.ejecutar(`DELETE FROM outbox_federacion WHERE flujo_id IN (${marcas})`, flujoIds)
    .catch(() => {});
  await sql.ejecutar(
    `DELETE FROM posiciones_ocurrencias_flujos_federacion WHERE flujo_id IN (${marcas})`, flujoIds
  ).catch(() => {});
  await sql.ejecutar(
    `DELETE FROM contadores_posiciones_generaciones_federacion WHERE flujo_id IN (${marcas})`, flujoIds
  ).catch(() => {});
  await sql.ejecutar(
    `DELETE FROM propietarios_emision_flujos_federacion WHERE flujo_id IN (${marcas})`, flujoIds
  ).catch(() => {});
  await sql.ejecutar(
    `UPDATE flujos_federacion SET generacion_activa_id=NULL WHERE flujo_id IN (${marcas})`, flujoIds
  ).catch(() => {});
  await sql.ejecutar(
    `DELETE FROM fronteras_generaciones_federacion WHERE generacion_id IN (
       SELECT generacion_id FROM generaciones_flujos_federacion WHERE flujo_id IN (${marcas})
     )`, flujoIds
  ).catch(() => {});
  await sql.ejecutar(
    `DELETE FROM generaciones_flujos_federacion WHERE flujo_id IN (${marcas})`, flujoIds
  ).catch(() => {});
  await sql.ejecutar(`DELETE FROM flujos_federacion WHERE flujo_id IN (${marcas})`, flujoIds)
    .catch(() => {});
}

async function limpiarOcurrencias(sql, installationId) {
  await sql.ejecutar(
    'DELETE FROM ocurrencias_federacion WHERE installation_origen_id=?', [installationId]
  ).catch(() => {});
  await sql.ejecutar(
    'DELETE FROM reservas_identidad_ocurrencias_federacion WHERE installation_origen_id=?',
    [installationId]
  ).catch(() => {});
  await sql.ejecutar(
    'DELETE FROM contadores_secuencia_elementos_federacion WHERE installation_origen_id=?',
    [installationId]
  ).catch(() => {});
}

async function contarLote(sql, loteId) {
  return Number((await sql.consultar(
    'SELECT COUNT(*) AS total FROM lotes_recepcion_federacion WHERE lote_id=?',
    [loteId]
  ))[0].total);
}

function crearIdentidades() {
  const generar = (tipo) => String(generador.generar(tipo));
  return {
    installationLocalId: generar(TIPOS_IDENTIDAD_FEDERADA.INSTALACION),
    installationRemotaId: generar(TIPOS_IDENTIDAD_FEDERADA.INSTALACION),
    bootLocalId: generar(TIPOS_IDENTIDAD_FEDERADA.ARRANQUE),
    bootRemotoId: generar(TIPOS_IDENTIDAD_FEDERADA.ARRANQUE),
    relacionEmisionId: generar(TIPOS_IDENTIDAD_FEDERADA.RELACION),
    relacionRecepcionId: generar(TIPOS_IDENTIDAD_FEDERADA.RELACION),
    flujoEmisionId: generar(TIPOS_IDENTIDAD_FEDERADA.FLUJO),
    flujoRecepcionId: generar(TIPOS_IDENTIDAD_FEDERADA.FLUJO),
    generacionEmisionId: generar(TIPOS_IDENTIDAD_FEDERADA.GENERACION),
    generacionRecepcionId: generar(TIPOS_IDENTIDAD_FEDERADA.GENERACION),
    lotesPlanificados: Array.from({ length: 2 }, () => generar(TIPOS_IDENTIDAD_FEDERADA.LOTE)),
    loteLimiteId: generar(TIPOS_IDENTIDAD_FEDERADA.LOTE),
    loteCapacidadId: generar(TIPOS_IDENTIDAD_FEDERADA.LOTE),
    loteGrandeId: generar(TIPOS_IDENTIDAD_FEDERADA.LOTE),
    loteDetenidoId: generar(TIPOS_IDENTIDAD_FEDERADA.LOTE),
    loteFisicamenteGrandeId: generar(TIPOS_IDENTIDAD_FEDERADA.LOTE),
    loteProcedenciaGrandeId: generar(TIPOS_IDENTIDAD_FEDERADA.LOTE),
    entregasRecepcion: Array.from({ length: 6 }, () => generar(TIPOS_IDENTIDAD_FEDERADA.ENTREGA)),
    elementosRecepcion: Array.from({ length: 6 }, () => generar(TIPOS_IDENTIDAD_FEDERADA.ELEMENTO_ORIGEN)),
    ocurrenciasRecepcion: Array.from({ length: 6 }, () => generar(TIPOS_IDENTIDAD_FEDERADA.OCURRENCIA_ORIGEN)),
    elementosEmision: Array.from({ length: 2 }, () => generar(TIPOS_IDENTIDAD_FEDERADA.ELEMENTO_ORIGEN)),
    ocurrenciasEmision: Array.from({ length: 2 }, () => generar(TIPOS_IDENTIDAD_FEDERADA.OCURRENCIA_ORIGEN))
  };
}

function identidad(tipo, valor) {
  return crearIdentidadFederada({ tipo, valor: String(valor) });
}

function sha256Hex(texto) {
  return createHash('sha256').update(texto, 'utf8').digest('hex');
}

function leer(ruta) {
  return readFile(new URL(ruta, import.meta.url), 'utf8');
}

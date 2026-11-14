import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import { FuenteEntropiaCriptograficaNode } from '../paquetes/federacion/adaptadores/FuenteEntropiaCriptograficaNode.js';
import { RepositorioEntregasFederacionSql } from '../paquetes/federacion/adaptadores/RepositorioEntregasFederacionSql.js';
import { RepositorioCursoresRecepcionFederacionSql } from '../paquetes/federacion/adaptadores/RepositorioCursoresRecepcionFederacionSql.js';
import { RepositorioFlujosFederacionSql } from '../paquetes/federacion/adaptadores/RepositorioFlujosFederacionSql.js';
import { RepositorioInboxFederacionSql } from '../paquetes/federacion/adaptadores/RepositorioInboxFederacionSql.js';
import { ServicioRecepcionLotesFederacionLocal } from '../paquetes/federacion/aplicacion/ServicioRecepcionLotesFederacionLocal.js';
import {
  crearCampoPresenteFederado,
  crearOcurrenciaOrigenFederada
} from '../paquetes/federacion/src/EnvolventeFederacion.js';
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

const USUARIO_FIXTURE = '5221208';
const generador = new GeneradorIdentidadesFederadas({
  fuenteEntropia: new FuenteEntropiaCriptograficaNode()
});

await main();

async function main() {
  await verificarRegistro();
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
    const auditoriaAntes = await contarAuditoriaFixture(sql, ids);
    const outboxAntes = await contarOutboxFixture(sql, ids);
    await verificarIntentosResultadosYReplay(sql, ids);
    await verificarReagrupacion(sql, ids);
    await verificarContratoFlujoYFotografia(sql, ids);
    await verificarSemanticaResultados(sql, ids);
    await verificarInmutabilidad(sql, ids);
    await verificarReplayTerminalSinAutoridadActual(sql, ids);
    assert.equal(await contarAuditoriaFixture(sql, ids), auditoriaAntes);
    assert.equal(await contarOutboxFixture(sql, ids), outboxAntes);
  } finally {
    await limpiar(sql);
    await sql.cerrar();
  }
  console.log(
    '[federacion] OK 5.22.12h: lotes=composicion-inmutable ' +
    'intentos=append-only resultados=individuales replay=selectivo transporte=local'
  );
}

async function verificarRegistro() {
  const [repositorio, servicio] = await Promise.all([
    leer('../paquetes/federacion/adaptadores/RepositorioEntregasFederacionSql.js'),
    leer('../paquetes/federacion/aplicacion/ServicioRecepcionLotesFederacionLocal.js')
  ]);
  assert.doesNotMatch(repositorio, /cursor|frontera.*validada/iu);
  assert.doesNotMatch(`${repositorio}\n${servicio}`, /(?:redis|https?:|node:http|outbox_auditoria)/iu);
}

async function verificarIntentosResultadosYReplay(sql, ids) {
  const inbox = new RepositorioInboxFederacionSql(sql);
  const conocida = await inbox.recibir(ocurrencia(ids, ids.ocurrenciaConocidaId, 'conocida', '2'));
  assert.equal(conocida.codigo, 'aceptada');

  let aplazar = true;
  const servicio = crearServicio(sql, {
    decidirAplazamiento: async ({ entrega }) => {
      if (!aplazar || entrega.entregaId !== ids.entregaAplazadaId) return null;
      return {
        resultado: 'aplazadaCapacidad',
        errorTemporal: 'capacidadTemporalAgotada'
      };
    }
  });
  const entrada = lote(ids, ids.loteId);
  const primero = await servicio.entregarLote(entrada);
  assert.equal(primero.persistidoDurablemente, true);
  assert.equal(primero.estado, 'parcialTemporal');
  assert.equal(primero.clase, 'inicial');
  assert.deepEqual(
    primero.resultados.map((resultado) => [
      resultado.resultado,
      resultado.clasificacion,
      resultado.confirmada
    ]),
    [
      ['aceptada', 'terminal', true],
      ['yaConocida', 'terminal', true],
      ['rechazadaDefinitiva', 'terminal', false],
      ['aplazadaCapacidad', 'temporal', false]
    ]
  );
  assert.equal(primero.resultados[2].errorTerminal, 'ocurrenciaInvalida');
  assert.equal(primero.resultados[3].errorTemporal, 'capacidadTemporalAgotada');
  await assert.rejects(
    sql.ejecutar(
      "UPDATE lotes_recepcion_federacion SET estado='pendiente' WHERE lote_id=?",
      [ids.loteId]
    ),
    (error) => error.sqlState === '45000'
  );

  aplazar = false;
  const segundo = await servicio.entregarLote(entrada);
  assert.equal(segundo.estado, 'terminal');
  assert.equal(segundo.clase, 'reintento');
  assert.deepEqual(
    segundo.resultados.map((resultado) => resultado.reutilizado),
    [true, true, true, false]
  );
  assert.equal(segundo.resultados[3].resultado, 'aceptada');

  const tercero = await servicio.entregarLote(entrada);
  assert.equal(tercero.clase, 'replayTerminal');
  assert.ok(tercero.resultados.every((resultado) => resultado.reutilizado));
  const intentos = await sql.consultar(
    `SELECT numero_intento,clase,total_terminales,total_temporales
       FROM intentos_lotes_recepcion_federacion
      WHERE lote_id=? ORDER BY numero_intento`,
    [ids.loteId]
  );
  assert.deepEqual(intentos.map((fila) => [
    String(fila.numero_intento),
    fila.clase,
    Number(fila.total_terminales),
    Number(fila.total_temporales)
  ]), [
    ['1', 'inicial', 3, 1],
    ['2', 'reintento', 4, 0],
    ['3', 'replayTerminal', 4, 0]
  ]);
  const resultados = await sql.consultar(
    `SELECT COUNT(*) AS total,
            SUM(clasificacion='temporal') AS temporales,
            SUM(reutilizado=TRUE) AS reutilizados
       FROM resultados_entregas_recepcion_federacion r
       JOIN intentos_lotes_recepcion_federacion i ON i.id=r.intento_id
      WHERE i.lote_id=?`,
    [ids.loteId]
  );
  assert.equal(Number(resultados[0].total), 12);
  assert.equal(Number(resultados[0].temporales), 1);
  assert.equal(Number(resultados[0].reutilizados), 7);

  await assert.rejects(
    servicio.entregarLote({
      ...entrada,
      entregas: entrada.entregas.map((entrega, indice) => indice === 0
        ? { ...entrega, ocurrencia: { ...entrega.ocurrencia, vigenciaRestanteMs: '1' } }
        : entrega)
    }),
    (error) => error.codigo === 'lote_id_reutilizado'
  );
  assert.equal(
    Number((await sql.consultar(
      'SELECT total_intentos FROM lotes_recepcion_federacion WHERE lote_id=?',
      [ids.loteId]
    ))[0].total_intentos),
    3
  );
}

async function verificarReagrupacion(sql, ids) {
  const resultado = await crearServicio(sql).entregarLote(lote(ids, ids.loteReagrupadoId));
  assert.equal(resultado.clase, 'inicial');
  assert.deepEqual(
    resultado.resultados.map((individual) => individual.resultado),
    ['yaConocida', 'yaConocida', 'rechazadaDefinitiva', 'yaConocida']
  );
  const filas = await sql.consultar(
    `SELECT e.entrega_id,COUNT(c.lote_id) AS lotes
       FROM entregas_recepcion_federacion e
       JOIN composiciones_lotes_recepcion_federacion c
         ON c.entrega_id=e.entrega_id
      WHERE e.entrega_id=? GROUP BY e.entrega_id`,
    [ids.entregaAceptadaId]
  );
  assert.equal(Number(filas[0].lotes), 2);
}

async function verificarContratoFlujoYFotografia(sql, ids) {
  const retirada = crearOcurrenciaOrigenFederada({
    ...ocurrencia(ids, ids.ocurrenciaRetiradaId, 'retirada', '5'),
    operacion: 'retirada',
    vigenciaRestanteMs: null,
    campos: {}
  });
  const aceptada = await crearServicio(sql).entregarLote({
    loteId: ids.loteRetiradaId,
    relacionId: ids.relacionId,
    flujoId: ids.flujoId,
    generacionId: ids.generacionId,
    entregas: [entrega(ids.entregaRetiradaId, '5', retirada)]
  });
  assert.equal(aceptada.resultados[0].resultado, 'retiradaAceptada');

  await assert.rejects(
    crearServicio(sql).entregarLote({
      loteId: ids.loteContratoIncompatibleId,
      relacionId: ids.relacionId,
      flujoId: ids.flujoId,
      generacionId: ids.generacionId,
      entregas: [entrega(ids.entregaContratoIncompatibleId, '6', {
        ...ocurrencia(ids, ids.ocurrenciaContratoIncompatibleId, 'telemetria', '6'),
        familia: 'telemetria'
      })]
    }),
    (error) => error.codigo === 'contrato_lote_incompatible'
  );
  assert.equal(Number((await sql.consultar(
    'SELECT COUNT(*) AS total FROM lotes_recepcion_federacion WHERE lote_id=?',
    [ids.loteContratoIncompatibleId]
  ))[0].total), 0);
}

async function verificarSemanticaResultados(sql, ids) {
  const conexion = await sql.obtenerConexion();
  const repositorio = new RepositorioEntregasFederacionSql(sql);
  try {
    await conexion.beginTransaction();
    const preparacion = await repositorio.prepararIntentoEnTransaccion({
      loteId: ids.loteResultadoInvalidoId,
      relacionId: ids.relacionId,
      flujoId: ids.flujoId,
      generacionId: ids.generacionId,
      entregas: [entrega(ids.entregaResultadoInvalidoId, '6', ocurrencia(
        ids, ids.ocurrenciaResultadoInvalidoId, 'resultado-invalido', '6'
      ))]
    }, { conexion });
    await assert.rejects(
      repositorio.guardarIntentoEnTransaccion(preparacion, [{
        clasificacion: 'terminal',
        resultado: 'aceptada',
        errorTerminal: null,
        errorTemporal: null,
        inboxId: null,
        confirmada: false,
        reutilizado: false
      }], { conexion }),
      (error) => error.codigo === 'resultado_entrega_invalido'
    );
  } finally {
    await conexion.rollback().catch(() => {});
    conexion.release();
  }
}

async function verificarInmutabilidad(sql, ids) {
  await assert.rejects(
    sql.ejecutar(
      'UPDATE entregas_recepcion_federacion SET posicion_flujo=99 WHERE entrega_id=?',
      [ids.entregaAceptadaId]
    ),
    (error) => error.sqlState === '45000'
  );
  const [resultado] = await sql.consultar(
    `SELECT r.id FROM resultados_entregas_recepcion_federacion r
       JOIN intentos_lotes_recepcion_federacion i ON i.id=r.intento_id
      WHERE i.lote_id=? LIMIT 1`,
    [ids.loteId]
  );
  await assert.rejects(
    sql.ejecutar(
      'UPDATE resultados_entregas_recepcion_federacion SET confirmada=FALSE WHERE id=?',
      [resultado.id]
    ),
    (error) => error.sqlState === '45000'
  );
  await verificarPertenenciaFisicaResultado(sql, ids);
}

async function verificarReplayTerminalSinAutoridadActual(sql, ids) {
  await sql.ejecutar(
    `UPDATE relaciones_federacion
        SET estado_autoridad='sinAutoridad',corte_autoridad_utc=UTC_TIMESTAMP(3),
            version_autoridad=version_autoridad+1,revision=revision+1,
            actualizada_en_utc=UTC_TIMESTAMP(3)
      WHERE relacion_id=?`,
    [ids.relacionId]
  );
  const servicio = crearServicio(sql, {
    resolverCapacidad: async () => ({
      versionConfiguracion: '99',
      configuracion: { loteMaximoOcurrencias: 1 }
    })
  });
  const replay = await servicio.entregarLote(lote(ids, ids.loteId));
  assert.equal(replay.clase, 'replayTerminal');
  assert.ok(replay.resultados.every((resultado) => resultado.reutilizado));

  await assert.rejects(
    servicio.entregarLote({
      ...lote(ids, ids.loteId),
      loteId: String(generador.generar(TIPOS_IDENTIDAD_FEDERADA.LOTE))
    }),
    (error) => error.codigo === 'relacion_recepcion_no_operativa'
  );
}

async function verificarPertenenciaFisicaResultado(sql, ids) {
  const [intento] = await sql.consultar(
    `SELECT id FROM intentos_lotes_recepcion_federacion
      WHERE lote_id=? ORDER BY numero_intento LIMIT 1`,
    [ids.loteId]
  );
  await assert.rejects(
    sql.ejecutar(
      `INSERT INTO resultados_entregas_recepcion_federacion (
         intento_id,lote_id,entrega_id,clasificacion,resultado,error_terminal,
         error_temporal,inbox_ocurrencia_id,confirmada,reutilizado,creado_en_utc
       ) VALUES (?, ?, ?, 'terminal', 'rechazadaDefinitiva',
         'ocurrenciaInvalida', NULL, NULL, FALSE, FALSE, UTC_TIMESTAMP(3))`,
      [
        intento.id,
        ids.loteId,
        String(generador.generar(TIPOS_IDENTIDAD_FEDERADA.ENTREGA))
      ]
    ),
    (error) => error.sqlState === '23000'
  );
}

function crearServicio(sql, { decidirAplazamiento, resolverCapacidad } = {}) {
  return new ServicioRecepcionLotesFederacionLocal({
    clienteSql: sql,
    repositorioEntregas: new RepositorioEntregasFederacionSql(sql),
    repositorioInbox: new RepositorioInboxFederacionSql(sql),
    repositorioCursores: new RepositorioCursoresRecepcionFederacionSql(sql),
    decidirAplazamiento,
    resolverCapacidad
  });
}

function lote(ids, loteId) {
  return {
    loteId,
    relacionId: ids.relacionId,
    flujoId: ids.flujoId,
    generacionId: ids.generacionId,
    entregas: [
      entrega(ids.entregaAceptadaId, '1', ocurrencia(
        ids, ids.ocurrenciaAceptadaId, 'aceptada', '1', ids.elementoAceptadoId
      )),
      entrega(ids.entregaConocidaId, '2', ocurrencia(
        ids, ids.ocurrenciaConocidaId, 'conocida', '2'
      )),
      entrega(ids.entregaInvalidaId, '3', {
        ...ocurrencia(ids, ids.ocurrenciaInvalidaId, 'invalida', '3'),
        secuenciaElemento: '0'
      }),
      entrega(ids.entregaAplazadaId, '4', ocurrencia(
        ids, ids.ocurrenciaAplazadaId, 'aplazada', '4', ids.elementoAplazadoId
      ))
    ]
  };
}

function entrega(entregaId, posicionFlujo, contenido) {
  return { entregaId, posicionFlujo, ocurrencia: contenido };
}

function ocurrencia(
  ids,
  ocurrenciaOrigenId,
  estado,
  secuenciaElemento,
  elementoOrigenId = ids.elementoComunId
) {
  return {
    familia: 'monitores',
    familiaVersion: 1,
    installationOrigenId: identidad(
      TIPOS_IDENTIDAD_FEDERADA.INSTALACION,
      ids.installationRemotaId
    ),
    elementoOrigenId: identidad(
      TIPOS_IDENTIDAD_FEDERADA.ELEMENTO_ORIGEN,
      elementoOrigenId
    ),
    ocurrenciaOrigenId: identidad(
      TIPOS_IDENTIDAD_FEDERADA.OCURRENCIA_ORIGEN,
      ocurrenciaOrigenId
    ),
    secuenciaElemento,
    operacion: 'actualizacion',
    tiempoOrigenUtc: '2030-01-01T00:00:00.000Z',
    scopeOrigenDeclarado: {
      nivel: 'portal', tenantId: null, empresaId: null, sitioId: null
    },
    vigenciaRestanteMs: '300000',
    campos: {
      estadoOperativo: crearCampoPresenteFederado({ valor: { estado } })
    },
    evidenciaIntegridad: []
  };
}

async function crearPlanoControl(sql, ids) {
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
       ?,'recepcion','vinculada','autorizada','valida','compatible',?, ?,
       'fixture 5.22.12h',?,?,NULL,NULL,NULL,1,NULL,?,?,?,1
     )`,
    [
      ids.relacionId,
      ids.installationRemotaId,
      ids.installationRemotaId,
      USUARIO_FIXTURE,
      USUARIO_FIXTURE,
      USUARIO_FIXTURE,
      ahora,
      ahora
    ]
  );
  await new RepositorioFlujosFederacionSql(sql, {
    installationLocalId: ids.installationLocalId
  }).crearFlujoInicial({
    flujo: {
      flujoId: ids.flujoId,
      relacionId: ids.relacionId,
      direccion: 'recepcion',
      familia: 'monitores',
      versionFamilia: 1,
      contexto: { nivel: 'portal' }
    },
    generacion: {
      generacionId: ids.generacionId,
      clase: 'inicial',
      fronteraInicial: '4',
      propietario: {
        installationId: ids.installationRemotaId,
        bootId: ids.bootRemotoId,
        version: 1
      }
    }
  });
}

async function limpiar(sql) {
  const relaciones = await sql.consultar(
    `SELECT relacion_id,installation_remota_id
       FROM relaciones_federacion WHERE creada_por_usuario_id=?`,
    [USUARIO_FIXTURE]
  ).catch(() => []);
  for (const {
    relacion_id: relacionId,
    installation_remota_id: installationRemotaId
  } of relaciones) {
    const flujos = await sql.consultar(
      'SELECT flujo_id FROM flujos_federacion WHERE relacion_id=?',
      [relacionId]
    ).catch(() => []);
    const flujoIds = flujos.map((fila) => fila.flujo_id);
    if (flujoIds.length) {
      const marcas = flujoIds.map(() => '?').join(',');
      await sql.ejecutar(
        `DELETE FROM resultados_entregas_recepcion_federacion
          WHERE intento_id IN (
            SELECT id FROM intentos_lotes_recepcion_federacion
             WHERE lote_id IN (
               SELECT lote_id FROM lotes_recepcion_federacion
                WHERE flujo_id IN (${marcas})
             )
          )`,
        flujoIds
      ).catch(() => {});
      await sql.ejecutar(
        `DELETE FROM intentos_lotes_recepcion_federacion
          WHERE lote_id IN (
            SELECT lote_id FROM lotes_recepcion_federacion
             WHERE flujo_id IN (${marcas})
          )`,
        flujoIds
      ).catch(() => {});
      await sql.ejecutar(
        `DELETE FROM composiciones_lotes_recepcion_federacion
          WHERE lote_id IN (
            SELECT lote_id FROM lotes_recepcion_federacion
             WHERE flujo_id IN (${marcas})
          )`,
        flujoIds
      ).catch(() => {});
      await sql.ejecutar(
        `DELETE FROM lotes_recepcion_federacion WHERE flujo_id IN (${marcas})`,
        flujoIds
      ).catch(() => {});
      await sql.ejecutar(
        `DELETE FROM entregas_recepcion_federacion WHERE flujo_id IN (${marcas})`,
        flujoIds
      ).catch(() => {});
      await sql.ejecutar(
        `DELETE FROM rangos_terminales_recepcion_federacion
          WHERE generacion_id IN (
            SELECT generacion_id FROM generaciones_flujos_federacion
             WHERE flujo_id IN (${marcas})
          )`,
        flujoIds
      ).catch(() => {});
      await sql.ejecutar(
        `DELETE FROM cursores_generaciones_recepcion_federacion
          WHERE flujo_id IN (${marcas})`,
        flujoIds
      ).catch(() => {});
      await sql.ejecutar(
        `DELETE FROM propietarios_emision_flujos_federacion WHERE flujo_id IN (${marcas})`,
        flujoIds
      ).catch(() => {});
      await sql.ejecutar(
        `UPDATE flujos_federacion SET generacion_activa_id=NULL WHERE flujo_id IN (${marcas})`,
        flujoIds
      ).catch(() => {});
      await sql.ejecutar(
        `DELETE FROM fronteras_generaciones_federacion WHERE generacion_id IN (
          SELECT generacion_id FROM generaciones_flujos_federacion
           WHERE flujo_id IN (${marcas})
        )`,
        flujoIds
      ).catch(() => {});
      await sql.ejecutar(
        `DELETE FROM generaciones_flujos_federacion WHERE flujo_id IN (${marcas})`,
        flujoIds
      ).catch(() => {});
      await sql.ejecutar(
        `DELETE FROM flujos_federacion WHERE flujo_id IN (${marcas})`,
        flujoIds
      ).catch(() => {});
    }
    await sql.ejecutar(
      `DELETE c FROM conflictos_contenido_inbox_federacion c
        JOIN inbox_ocurrencias_federacion i ON i.id=c.inbox_ocurrencia_id
       WHERE i.installation_origen_id=?`,
      [installationRemotaId]
    ).catch(() => {});
    await sql.ejecutar(
      'DELETE FROM inbox_ocurrencias_federacion WHERE installation_origen_id=?',
      [installationRemotaId]
    ).catch(() => {});
    await sql.ejecutar('DELETE FROM relaciones_federacion WHERE relacion_id=?', [relacionId])
      .catch(() => {});
  }
}

function crearIdentidades() {
  const generar = (tipo) => String(generador.generar(tipo));
  return {
    installationLocalId: generar(TIPOS_IDENTIDAD_FEDERADA.INSTALACION),
    installationRemotaId: generar(TIPOS_IDENTIDAD_FEDERADA.INSTALACION),
    bootRemotoId: generar(TIPOS_IDENTIDAD_FEDERADA.ARRANQUE),
    relacionId: generar(TIPOS_IDENTIDAD_FEDERADA.RELACION),
    flujoId: generar(TIPOS_IDENTIDAD_FEDERADA.FLUJO),
    generacionId: generar(TIPOS_IDENTIDAD_FEDERADA.GENERACION),
    loteId: generar(TIPOS_IDENTIDAD_FEDERADA.LOTE),
    loteReagrupadoId: generar(TIPOS_IDENTIDAD_FEDERADA.LOTE),
    loteRetiradaId: generar(TIPOS_IDENTIDAD_FEDERADA.LOTE),
    loteContratoIncompatibleId: generar(TIPOS_IDENTIDAD_FEDERADA.LOTE),
    loteResultadoInvalidoId: generar(TIPOS_IDENTIDAD_FEDERADA.LOTE),
    entregaAceptadaId: generar(TIPOS_IDENTIDAD_FEDERADA.ENTREGA),
    entregaConocidaId: generar(TIPOS_IDENTIDAD_FEDERADA.ENTREGA),
    entregaInvalidaId: generar(TIPOS_IDENTIDAD_FEDERADA.ENTREGA),
    entregaAplazadaId: generar(TIPOS_IDENTIDAD_FEDERADA.ENTREGA),
    entregaRetiradaId: generar(TIPOS_IDENTIDAD_FEDERADA.ENTREGA),
    entregaContratoIncompatibleId: generar(TIPOS_IDENTIDAD_FEDERADA.ENTREGA),
    entregaResultadoInvalidoId: generar(TIPOS_IDENTIDAD_FEDERADA.ENTREGA),
    elementoComunId: generar(TIPOS_IDENTIDAD_FEDERADA.ELEMENTO_ORIGEN),
    elementoAceptadoId: generar(TIPOS_IDENTIDAD_FEDERADA.ELEMENTO_ORIGEN),
    elementoAplazadoId: generar(TIPOS_IDENTIDAD_FEDERADA.ELEMENTO_ORIGEN),
    ocurrenciaAceptadaId: generar(TIPOS_IDENTIDAD_FEDERADA.OCURRENCIA_ORIGEN),
    ocurrenciaConocidaId: generar(TIPOS_IDENTIDAD_FEDERADA.OCURRENCIA_ORIGEN),
    ocurrenciaInvalidaId: generar(TIPOS_IDENTIDAD_FEDERADA.OCURRENCIA_ORIGEN),
    ocurrenciaAplazadaId: generar(TIPOS_IDENTIDAD_FEDERADA.OCURRENCIA_ORIGEN),
    ocurrenciaRetiradaId: generar(TIPOS_IDENTIDAD_FEDERADA.OCURRENCIA_ORIGEN),
    ocurrenciaContratoIncompatibleId: generar(TIPOS_IDENTIDAD_FEDERADA.OCURRENCIA_ORIGEN),
    ocurrenciaResultadoInvalidoId: generar(TIPOS_IDENTIDAD_FEDERADA.OCURRENCIA_ORIGEN)
  };
}

function identidad(tipo, valor) {
  return crearIdentidadFederada({ tipo, valor: String(valor) });
}

async function contar(sql, tabla) {
  const filas = await sql.consultar(`SELECT COUNT(*) AS total FROM ${tabla}`);
  return Number(filas[0].total);
}

async function contarAuditoriaFixture(sql, ids) {
  const filas = await sql.consultar(
    `SELECT COUNT(*) AS total FROM outbox_auditoria_runtime
      WHERE actor_real_id=? OR actor_efectivo_id=? OR sujeto_id=?
         OR causalidad_id IN (?,?)`,
    [
      USUARIO_FIXTURE,
      USUARIO_FIXTURE,
      USUARIO_FIXTURE,
      ids.relacionId,
      ids.flujoId
    ]
  );
  return Number(filas[0].total);
}

async function contarOutboxFixture(sql, ids) {
  const filas = await sql.consultar(
    'SELECT COUNT(*) AS total FROM outbox_federacion WHERE flujo_id=?',
    [ids.flujoId]
  );
  return Number(filas[0].total);
}

function leer(ruta) {
  return readFile(new URL(ruta, import.meta.url), 'utf8');
}

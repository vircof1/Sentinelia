import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { readFile } from 'node:fs/promises';

import { FuenteEntropiaCriptograficaNode } from '../paquetes/federacion/adaptadores/FuenteEntropiaCriptograficaNode.js';
import { RepositorioCursoresRecepcionFederacionSql } from '../paquetes/federacion/adaptadores/RepositorioCursoresRecepcionFederacionSql.js';
import { RepositorioEntregasFederacionSql } from '../paquetes/federacion/adaptadores/RepositorioEntregasFederacionSql.js';
import { RepositorioFlujosFederacionSql } from '../paquetes/federacion/adaptadores/RepositorioFlujosFederacionSql.js';
import { RepositorioInboxFederacionSql } from '../paquetes/federacion/adaptadores/RepositorioInboxFederacionSql.js';
import { ServicioRecepcionLotesFederacionLocal } from '../paquetes/federacion/aplicacion/ServicioRecepcionLotesFederacionLocal.js';
import { crearCampoPresenteFederado } from '../paquetes/federacion/src/EnvolventeFederacion.js';
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

const USUARIO_FIXTURE = '5221209';
const generador = new GeneradorIdentidadesFederadas({
  fuenteEntropia: new FuenteEntropiaCriptograficaNode()
});

await main();

async function main() {
  await verificarRegistro();
  const configuracion = obtenerConfiguracionAplicacion();
  assert.equal(configuracion.sql.estaCompleta, true);
  const baseDatos = `sentinelia_fixture_52212i_${randomBytes(6).toString('hex')}`;
  const administrador = new ClienteSql(configuracion.sql);
  await administrador.ejecutar(`CREATE DATABASE ${administrador.escaparIdentificador(baseDatos)} CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
  const sql = new ClienteSql({ ...configuracion.sql, baseDatos });
  const ids = crearIdentidades();
  try {
    await new EjecutorMigraciones({
      clienteSql: sql,
      repositorioMigraciones: new RepositorioMigraciones(sql),
      rutaMigraciones: obtenerRutaMigraciones()
    }).ejecutarPendientes();
    await limpiar(sql);
    await crearPlanoControl(sql, ids);
    await verificarPrefijoRangosYFrontera(sql, ids);
    await verificarProteccionFisica(sql, ids);
  } finally {
    await limpiar(sql);
    await sql.cerrar();
    await administrador.ejecutar(`DROP DATABASE IF EXISTS ${administrador.escaparIdentificador(baseDatos)}`).catch(() => {});
    await administrador.cerrar();
  }
  console.log(
    '[federacion] OK 5.22.12i: cursor=prefijo-terminal ' +
    'rangos=dispersos huecos=no-saltan frontera=recorrida-y-degradada'
  );
}

async function verificarRegistro() {
  const [repositorio, servicio] = await Promise.all([
    leer('../paquetes/federacion/adaptadores/RepositorioCursoresRecepcionFederacionSql.js'),
    leer('../paquetes/federacion/aplicacion/ServicioRecepcionLotesFederacionLocal.js')
  ]);
  assert.match(repositorio, /posicion \+ 1n/u);
  assert.match(servicio, /aplicarResultadosEnTransaccion/u);
  assert.doesNotMatch(`${repositorio}\n${servicio}`, /(?:redis|https?:|node:http)/iu);
}

async function verificarPrefijoRangosYFrontera(sql, ids) {
  let aplazarPosicionDos = true;
  const cursores = new RepositorioCursoresRecepcionFederacionSql(sql);
  const servicio = crearServicio(sql, cursores, async ({ entrega }) => {
    if (!aplazarPosicionDos || entrega.posicionFlujo !== '2') return null;
    return {
      resultado: 'aplazadaValidacion',
      errorTemporal: 'dependenciaValidacionTemporal'
    };
  });

  const posicionTres = await servicio.entregarLote(loteUnaPosicion(ids, 3));
  verificarProgreso(posicionTres.progreso, {
    cursor: '0', version: '2', recorrida: false, degradada: false,
    prefijoDegradado: false, rangos: [['3', '3', false]]
  });

  const posicionCinco = await servicio.entregarLote(loteUnaPosicion(ids, 5));
  verificarProgreso(posicionCinco.progreso, {
    cursor: '0', version: '3', recorrida: false, degradada: false,
    prefijoDegradado: false,
    rangos: [['3', '3', false], ['5', '5', false]]
  });

  const posicionUno = await servicio.entregarLote(loteUnaPosicion(ids, 1));
  verificarProgreso(posicionUno.progreso, {
    cursor: '1', version: '4', recorrida: false, degradada: false,
    prefijoDegradado: false,
    rangos: [['3', '3', false], ['5', '5', false]]
  });

  const posicionCuatro = await servicio.entregarLote(loteUnaPosicion(ids, 4, {
    invalida: true
  }));
  assert.equal(posicionCuatro.resultados[0].resultado, 'rechazadaDefinitiva');
  verificarProgreso(posicionCuatro.progreso, {
    cursor: '1', version: '5', recorrida: false, degradada: true,
    prefijoDegradado: false, rangos: [['3', '5', true]]
  });

  const posicionDosTemporal = await servicio.entregarLote(loteUnaPosicion(ids, 2));
  assert.equal(posicionDosTemporal.resultados[0].clasificacion, 'temporal');
  verificarProgreso(posicionDosTemporal.progreso, {
    cursor: '1', version: '5', recorrida: false, degradada: true,
    prefijoDegradado: false, rangos: [['3', '5', true]]
  });

  aplazarPosicionDos = false;
  const posicionDosTerminal = await servicio.entregarLote(loteUnaPosicion(ids, 2));
  assert.equal(posicionDosTerminal.resultados[0].resultado, 'aceptada');
  verificarProgreso(posicionDosTerminal.progreso, {
    cursor: '5', version: '6', recorrida: true, degradada: true,
    prefijoDegradado: true, rangos: []
  });

  const replay = await servicio.entregarLote(loteUnaPosicion(ids, 3));
  assert.equal(replay.clase, 'replayTerminal');
  verificarProgreso(replay.progreso, {
    cursor: '5', version: '6', recorrida: true, degradada: true,
    prefijoDegradado: true, rangos: []
  });

  const recuperado = await cursores.obtenerProgreso({
    flujoId: ids.flujoId,
    generacionId: ids.generacionId
  });
  assert.deepEqual(recuperado, replay.progreso);
  assert.equal(
    Number((await sql.consultar(
      'SELECT COUNT(*) AS total FROM rangos_terminales_recepcion_federacion WHERE generacion_id=?',
      [ids.generacionId]
    ))[0].total),
    0
  );
  const [frontera] = await sql.consultar(
    `SELECT f.estado,g.estado AS estado_generacion,
            b.posicion_operativa_validada,b.posicion_historica_validada,
            b.sincronizando,b.operativamente_completa,
            b.historicamente_completa,b.degradada
       FROM fronteras_generaciones_federacion b
       JOIN generaciones_flujos_federacion g
         ON g.generacion_id=b.generacion_id
       JOIN flujos_federacion f ON f.flujo_id=g.flujo_id
      WHERE b.generacion_id=?`,
    [ids.generacionId]
  );
  assert.equal(String(frontera.posicion_operativa_validada), '4');
  assert.equal(frontera.posicion_historica_validada, null);
  assert.equal(Boolean(frontera.sincronizando), false);
  assert.equal(Boolean(frontera.operativamente_completa), true);
  assert.equal(Boolean(frontera.historicamente_completa), false);
  assert.equal(Boolean(frontera.degradada), true);
  assert.equal(frontera.estado, 'degradado');
  assert.equal(frontera.estado_generacion, 'degradada');

  await sql.ejecutar(
    'DELETE FROM cursores_generaciones_recepcion_federacion WHERE generacion_id=?',
    [ids.generacionId]
  );
  assert.equal(await cursores.obtenerProgreso({
    flujoId: ids.flujoId,
    generacionId: ids.generacionId
  }), null);
  const reconstruido = await servicio.entregarLote(loteUnaPosicion(ids, 3));
  verificarProgreso(reconstruido.progreso, {
    cursor: '5', version: '2', recorrida: true, degradada: true,
    prefijoDegradado: true, rangos: []
  });
}

async function verificarProteccionFisica(sql, ids) {
  await assert.rejects(
    sql.ejecutar(
      `UPDATE cursores_generaciones_recepcion_federacion
          SET posicion_terminal_contigua=0,version_cursor=version_cursor+1
        WHERE generacion_id=?`,
      [ids.generacionId]
    ),
    (error) => error.sqlState === '45000'
  );
}

function verificarProgreso(progreso, esperado) {
  assert.equal(progreso.posicionTerminalContigua, esperado.cursor);
  assert.equal(progreso.fronteraInicial, '4');
  assert.equal(progreso.version, esperado.version);
  assert.equal(progreso.fronteraInicialRecorrida, esperado.recorrida);
  assert.equal(progreso.fronteraInicialDegradada, esperado.degradada);
  assert.equal(progreso.prefijoDegradado, esperado.prefijoDegradado);
  assert.deepEqual(
    progreso.rangosTerminalesDispersos.map((rango) => [
      rango.inicio, rango.fin, rango.contieneDegradacion
    ]),
    esperado.rangos
  );
}

function crearServicio(sql, repositorioCursores, decidirAplazamiento) {
  return new ServicioRecepcionLotesFederacionLocal({
    clienteSql: sql,
    repositorioEntregas: new RepositorioEntregasFederacionSql(sql),
    repositorioInbox: new RepositorioInboxFederacionSql(sql),
    repositorioCursores,
    decidirAplazamiento
  });
}

function loteUnaPosicion(ids, posicion, { invalida = false } = {}) {
  const indice = posicion - 1;
  const contenido = ocurrencia(ids, indice, String(posicion));
  return {
    loteId: ids.lotes[indice],
    relacionId: ids.relacionId,
    flujoId: ids.flujoId,
    generacionId: ids.generacionId,
    entregas: [{
      entregaId: ids.entregas[indice],
      posicionFlujo: String(posicion),
      ocurrencia: invalida ? { ...contenido, secuenciaElemento: '0' } : contenido
    }]
  };
}

function ocurrencia(ids, indice, secuenciaElemento) {
  return {
    familia: 'monitores',
    familiaVersion: 1,
    installationOrigenId: identidad(
      TIPOS_IDENTIDAD_FEDERADA.INSTALACION,
      ids.installationRemotaId
    ),
    elementoOrigenId: identidad(
      TIPOS_IDENTIDAD_FEDERADA.ELEMENTO_ORIGEN,
      ids.elementos[indice]
    ),
    ocurrenciaOrigenId: identidad(
      TIPOS_IDENTIDAD_FEDERADA.OCURRENCIA_ORIGEN,
      ids.ocurrencias[indice]
    ),
    secuenciaElemento,
    operacion: 'actualizacion',
    tiempoOrigenUtc: '2030-01-01T00:00:00.000Z',
    scopeOrigenDeclarado: {
      nivel: 'portal', tenantId: null, empresaId: null, sitioId: null
    },
    vigenciaRestanteMs: '300000',
    campos: {
      estadoOperativo: crearCampoPresenteFederado({
        valor: { posicion: indice + 1, fixture: '5.22.12i' }
      })
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
       'fixture 5.22.12i',?,?,NULL,NULL,NULL,1,NULL,?,?,?,1
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
  for (const relacion of relaciones) {
    const flujos = await sql.consultar(
      'SELECT flujo_id FROM flujos_federacion WHERE relacion_id=?',
      [relacion.relacion_id]
    ).catch(() => []);
    const flujoIds = flujos.map((fila) => fila.flujo_id);
    if (flujoIds.length) await limpiarFlujos(sql, flujoIds);
    await sql.ejecutar(
      `DELETE c FROM conflictos_contenido_inbox_federacion c
        JOIN inbox_ocurrencias_federacion i ON i.id=c.inbox_ocurrencia_id
       WHERE i.installation_origen_id=?`,
      [relacion.installation_remota_id]
    ).catch(() => {});
    await sql.ejecutar(
      'DELETE FROM inbox_ocurrencias_federacion WHERE installation_origen_id=?',
      [relacion.installation_remota_id]
    ).catch(() => {});
    await sql.ejecutar(
      'DELETE FROM relaciones_federacion WHERE relacion_id=?',
      [relacion.relacion_id]
    ).catch(() => {});
  }
}

async function limpiarFlujos(sql, flujoIds) {
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
  for (const tabla of [
    'intentos_lotes_recepcion_federacion',
    'composiciones_lotes_recepcion_federacion'
  ]) {
    await sql.ejecutar(
      `DELETE FROM ${tabla} WHERE lote_id IN (
        SELECT lote_id FROM lotes_recepcion_federacion
         WHERE flujo_id IN (${marcas})
      )`,
      flujoIds
    ).catch(() => {});
  }
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
  await sql.ejecutar(`DELETE FROM flujos_federacion WHERE flujo_id IN (${marcas})`, flujoIds)
    .catch(() => {});
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
    lotes: Array.from({ length: 5 }, () => generar(TIPOS_IDENTIDAD_FEDERADA.LOTE)),
    entregas: Array.from(
      { length: 5 },
      () => generar(TIPOS_IDENTIDAD_FEDERADA.ENTREGA)
    ),
    elementos: Array.from(
      { length: 5 },
      () => generar(TIPOS_IDENTIDAD_FEDERADA.ELEMENTO_ORIGEN)
    ),
    ocurrencias: Array.from(
      { length: 5 },
      () => generar(TIPOS_IDENTIDAD_FEDERADA.OCURRENCIA_ORIGEN)
    )
  };
}

function identidad(tipo, valor) {
  return crearIdentidadFederada({ tipo, valor: String(valor) });
}

function leer(ruta) {
  return readFile(new URL(ruta, import.meta.url), 'utf8');
}

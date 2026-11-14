import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';

import { AdaptadorCapturaTransaccionalFederacionSql } from '../paquetes/federacion/adaptadores/AdaptadorCapturaTransaccionalFederacionSql.js';
import { FuenteEntropiaCriptograficaNode } from '../paquetes/federacion/adaptadores/FuenteEntropiaCriptograficaNode.js';
import { RepositorioCoordinacionEmisionFederacionSql } from '../paquetes/federacion/adaptadores/RepositorioCoordinacionEmisionFederacionSql.js';
import { RepositorioFlujosFederacionSql } from '../paquetes/federacion/adaptadores/RepositorioFlujosFederacionSql.js';
import { RepositorioGeneracionesCandidatasFederacionSql } from '../paquetes/federacion/adaptadores/RepositorioGeneracionesCandidatasFederacionSql.js';
import { RepositorioOcurrenciasFederacionSql } from '../paquetes/federacion/adaptadores/RepositorioOcurrenciasFederacionSql.js';
import { RepositorioOutboxFederacionSql } from '../paquetes/federacion/adaptadores/RepositorioOutboxFederacionSql.js';
import { ServicioCorteInicialGeneracionFederacion } from '../paquetes/federacion/aplicacion/ServicioCorteInicialGeneracionFederacion.js';
import { crearCampoPresenteFederado } from '../paquetes/federacion/src/EnvolventeFederacion.js';
import {
  GeneradorIdentidadesFederadas,
  TIPOS_IDENTIDAD_FEDERADA
} from '../paquetes/federacion/src/IdentidadFederada.js';
import { ClienteSql } from '../paquetes/persistencia-sql/src/ClienteSql.js';
import { EjecutorMigraciones } from '../paquetes/persistencia-sql/src/EjecutorMigraciones.js';
import { RepositorioMigraciones } from '../paquetes/persistencia-sql/src/RepositorioMigraciones.js';
import {
  obtenerConfiguracionAplicacion,
  obtenerRutaMigraciones
} from '../paquetes/utilidades/src/configuracion/obtenerConfiguracionAplicacion.js';

const USUARIO_FIXTURE = 5_221_402;
const generador = new GeneradorIdentidadesFederadas({
  fuenteEntropia: new FuenteEntropiaCriptograficaNode()
});

async function main() {
  const configuracion = obtenerConfiguracionAplicacion();
  assert.equal(configuracion.sql.estaCompleta, true);
  const baseDatos = `sentinelia_fixture_52214b_${randomBytes(6).toString('hex')}`;
  const administrador = new ClienteSql(configuracion.sql);
  let sql;
  try {
    await administrador.ejecutar(
      `CREATE DATABASE ${administrador.escaparIdentificador(baseDatos)} ` +
      'CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci'
    );
    sql = new ClienteSql({ ...configuracion.sql, baseDatos });
    await migrar(sql);
    await verificarCicloCandidatas(sql);
  } finally {
    await sql?.cerrar().catch(() => {});
    await administrador.ejecutar(
      `DROP DATABASE IF EXISTS ${administrador.escaparIdentificador(baseDatos)}`
    ).catch(() => {});
    await administrador.cerrar();
  }
  console.log(
    '[federacion] OK 5.22.14b: activa=1 candidatas=aisladas ' +
    'espera/ampliacion/coexistencia/sustitucion=deterministas promocion=atomica'
  );
}

async function verificarCicloCandidatas(sql) {
  const ids = crearIds();
  await crearRelacion(sql, ids);
  const entorno = crearEntorno(sql, ids);
  await entorno.servicioVacio.preparar({
    flujo: definicionFlujo(ids),
    generacion: definicionGeneracion(ids, ids.generacionActivaId, 'inicial', 1)
  });
  await entorno.servicioVacio.cerrar(destino(ids, ids.generacionActivaId));
  await completarActiva(entorno.flujos, ids);

  const token1 = propietario(ids, 1);
  const candidataA = await entorno.candidatas.resolver({
    flujoId: ids.flujoId,
    generacion: definicionGeneracion(
      ids,
      ids.generacionAId,
      'resincronizacion',
      1
    ),
    propietario: token1,
    estrategia: 'coexistir'
  });
  assert.equal(candidataA.resultado, 'creada');
  await exigirActiva(sql, ids.flujoId, ids.generacionActivaId, 1);
  await cerrarConUnaCaptura(entorno, ids, ids.generacionAId, ids.ocurrenciaAId);
  const candidataAPreparada = (await entorno.candidatas.listar(ids.flujoId))[0];
  await entorno.candidatas.avanzar({
    flujoId: ids.flujoId,
    generacionId: ids.generacionAId,
    propietario: token1,
    versionEstadoEsperada: candidataAPreparada.versionEstado,
    versionFronteraEsperada: candidataAPreparada.frontera.version,
    estadoGeneracion: 'transfiriendo',
    frontera: fronteraSincronizando()
  });

  const coordinacion = new RepositorioCoordinacionEmisionFederacionSql(sql);
  const lease = await coordinacion.reclamarSiguiente({
    instanciaId: 'runtime-14b',
    leaseToken: randomBytes(32),
    ttlSegundos: 30
  });
  assert.equal(lease.flujo.generacionId, ids.generacionAId);
  assert.equal(await coordinacion.comprobarLeaseVigente(lease.lease), true);
  assert.equal(await coordinacion.liberarLease(lease.lease), true);

  const espera = await entorno.candidatas.resolver({
    flujoId: ids.flujoId,
    propietario: token1,
    estrategia: 'esperar'
  });
  assert.equal(espera.resultado, 'espera');
  assert.equal(espera.candidatas.length, 1);
  const ampliacion = await entorno.candidatas.resolver({
    flujoId: ids.flujoId,
    propietario: token1,
    estrategia: 'ampliarCompatible',
    generacionObjetivoId: ids.generacionAId
  });
  assert.equal(ampliacion.resultado, 'ampliacionCompatible');
  assert.equal(ampliacion.candidata.generacionId, ids.generacionAId);

  await entorno.candidatas.resolver({
    flujoId: ids.flujoId,
    generacion: definicionGeneracion(
      ids,
      ids.generacionBId,
      'reconstruccion',
      1
    ),
    propietario: token1,
    estrategia: 'coexistir'
  });
  assert.equal((await entorno.candidatas.listar(ids.flujoId)).length, 2);

  const sustitucion = await entorno.candidatas.resolver({
    flujoId: ids.flujoId,
    generacion: definicionGeneracion(
      ids,
      ids.generacionCId,
      'resincronizacion',
      1
    ),
    propietario: token1,
    estrategia: 'sustituir'
  });
  assert.equal(sustitucion.resultado, 'creada');
  assert.deepEqual(
    sustitucion.candidatas.map(({ generacionId }) => generacionId),
    [ids.generacionCId]
  );
  await exigirCancelacion(sql, ids);
  await exigirActiva(sql, ids.flujoId, ids.generacionActivaId, 1);

  await cerrarConUnaCaptura(entorno, ids, ids.generacionCId, ids.ocurrenciaCId);
  let candidataC = (await entorno.candidatas.listar(ids.flujoId))[0];
  candidataC = await entorno.candidatas.avanzar({
    flujoId: ids.flujoId,
    generacionId: ids.generacionCId,
    propietario: token1,
    versionEstadoEsperada: candidataC.versionEstado,
    versionFronteraEsperada: candidataC.frontera.version,
    estadoGeneracion: 'transfiriendo',
    frontera: fronteraSincronizando()
  });
  candidataC = await entorno.candidatas.avanzar({
    flujoId: ids.flujoId,
    generacionId: ids.generacionCId,
    propietario: token1,
    versionEstadoEsperada: candidataC.versionEstado,
    versionFronteraEsperada: candidataC.frontera.version,
    estadoGeneracion: 'completa',
    frontera: fronteraCompleta('1')
  });
  assert.equal(candidataC.estado, 'completa');
  await entorno.candidatas.resolver({
    flujoId: ids.flujoId,
    generacion: definicionGeneracion(
      ids,
      ids.generacionEId,
      'reconstruccion',
      1
    ),
    propietario: token1,
    estrategia: 'coexistir'
  });
  await entorno.servicioVacio.cerrar(destino(ids, ids.generacionEId));

  const promociones = await Promise.allSettled([
    entorno.candidatas.promover({
      flujoId: ids.flujoId,
      generacionId: ids.generacionCId,
      propietario: token1
    }),
    entorno.candidatas.promover({
      flujoId: ids.flujoId,
      generacionId: ids.generacionCId,
      propietario: token1
    })
  ]);
  assert.equal(promociones.filter(({ status }) => status === 'fulfilled').length, 1);
  assert.equal(promociones.filter(({ status }) => status === 'rejected').length, 1);
  const promocion = promociones.find(({ status }) => status === 'fulfilled').value;
  assert.equal(promocion.generacionActivaId, ids.generacionCId);
  assert.equal(promocion.versionPropietario, 2);
  assert.equal(promocion.estadoFlujo, 'resincronizando');
  assert.equal(promocion.estadoOperativoActivo, 'operativoCompleto');
  assert.equal(promocion.candidatasRestantes.length, 1);
  assert.equal(promocion.candidatasRestantes[0].requiereRevalidacion, true);
  await exigirActiva(sql, ids.flujoId, ids.generacionCId, 2);

  const token2 = propietario(ids, 2);
  await assert.rejects(
    entorno.candidatas.promover({
      flujoId: ids.flujoId,
      generacionId: ids.generacionEId,
      propietario: token2
    }),
    (error) => error.codigo === 'candidata_requiere_revalidacion'
  );
  let candidataE = (await entorno.candidatas.listar(ids.flujoId)).find(
    ({ generacionId }) => generacionId === ids.generacionEId
  );
  candidataE = await entorno.candidatas.avanzar({
    flujoId: ids.flujoId,
    generacionId: ids.generacionEId,
    propietario: token2,
    versionEstadoEsperada: candidataE.versionEstado,
    versionFronteraEsperada: candidataE.frontera.version,
    estadoGeneracion: 'transfiriendo',
    frontera: fronteraSincronizando()
  });
  candidataE = await entorno.candidatas.avanzar({
    flujoId: ids.flujoId,
    generacionId: ids.generacionEId,
    propietario: token2,
    versionEstadoEsperada: candidataE.versionEstado,
    versionFronteraEsperada: candidataE.frontera.version,
    estadoGeneracion: 'completa',
    frontera: fronteraCompleta('0')
  });
  candidataE = await entorno.candidatas.revalidar({
    flujoId: ids.flujoId,
    generacionId: ids.generacionEId,
    propietario: token2
  });
  assert.equal(candidataE.requiereRevalidacion, false);
  assert.equal(candidataE.generacionPredecesoraId, ids.generacionCId);
  await entorno.candidatas.cancelar({
    flujoId: ids.flujoId,
    generacionId: ids.generacionEId,
    propietario: token2
  });
  assert.equal(await entorno.candidatas.listar(ids.flujoId).then((v) => v.length), 0);

  await assert.rejects(
    entorno.candidatas.resolver({
      flujoId: ids.flujoId,
      generacion: definicionGeneracion(
        ids,
        ids.generacionDId,
        'resincronizacion',
        1
      ),
      propietario: token1,
      estrategia: 'coexistir'
    }),
    (error) => error.codigo === 'propietario_sustituido'
  );

  await entorno.candidatas.resolver({
    flujoId: ids.flujoId,
    generacion: definicionGeneracion(
      ids,
      ids.generacionDId,
      'reconstruccion',
      2
    ),
    propietario: token2,
    estrategia: 'coexistir'
  });
  const cancelacion = await entorno.candidatas.cancelar({
    flujoId: ids.flujoId,
    generacionId: ids.generacionDId,
    propietario: token2
  });
  assert.equal(cancelacion.resultado, 'cancelada');
  assert.equal(cancelacion.candidatasRestantes.length, 0);
  const [flujoRestaurado] = await sql.consultar(
    `SELECT estado,estado_previo_resincronizacion,generacion_activa_id
       FROM flujos_federacion WHERE flujo_id=?`,
    [ids.flujoId]
  );
  assert.equal(flujoRestaurado.estado, 'operativoCompleto');
  assert.equal(flujoRestaurado.estado_previo_resincronizacion, null);
  assert.equal(flujoRestaurado.generacion_activa_id, ids.generacionCId);
}

async function completarActiva(repositorio, ids) {
  const token = propietario(ids, 1);
  let agregado = await repositorio.obtener(ids.flujoId);
  agregado = await repositorio.avanzarGeneracion({
    flujoId: ids.flujoId,
    propietario: token,
    versionEstadoEsperada: agregado.generacion.versionEstado,
    versionFronteraEsperada: agregado.generacion.frontera.version,
    estadoGeneracion: 'transfiriendo',
    estadoFlujo: 'sincronizando',
    frontera: fronteraSincronizando()
  });
  await repositorio.avanzarGeneracion({
    flujoId: ids.flujoId,
    propietario: token,
    versionEstadoEsperada: agregado.generacion.versionEstado,
    versionFronteraEsperada: agregado.generacion.frontera.version,
    estadoGeneracion: 'completa',
    estadoFlujo: 'operativoCompleto',
    frontera: fronteraCompleta('0')
  });
}

async function cerrarConUnaCaptura(entorno, ids, generacionId, ocurrenciaId) {
  const servicio = crearServicioCorte(entorno, [{
    definicion: definicionOcurrencia(ids, ocurrenciaId),
    prioridad: 'operativaActual'
  }]);
  const cierre = await servicio.cerrar(destino(ids, generacionId));
  assert.equal(cierre.fronteraInicial, '1');
}

function crearEntorno(sql, ids) {
  const flujos = new RepositorioFlujosFederacionSql(sql, {
    installationLocalId: ids.installationLocalId
  });
  const ocurrencias = new RepositorioOcurrenciasFederacionSql(sql, {
    installationLocalId: ids.installationLocalId
  });
  const outbox = new RepositorioOutboxFederacionSql(sql);
  const adaptadorCaptura = new AdaptadorCapturaTransaccionalFederacionSql({
    repositorioOcurrencias: ocurrencias,
    repositorioOutbox: outbox
  });
  const entorno = {
    sql,
    ids,
    flujos,
    ocurrencias,
    adaptadorCaptura,
    candidatas: new RepositorioGeneracionesCandidatasFederacionSql(sql, {
      installationLocalId: ids.installationLocalId
    })
  };
  entorno.servicioVacio = crearServicioCorte(entorno, []);
  return entorno;
}

function crearServicioCorte(entorno, capturas) {
  return new ServicioCorteInicialGeneracionFederacion({
    clienteSql: entorno.sql,
    repositorioFlujos: entorno.flujos,
    repositorioOcurrencias: entorno.ocurrencias,
    adaptadorCaptura: entorno.adaptadorCaptura,
    fuenteFotografia: {
      listarCapturasEnTransaccion: async () => capturas
    }
  });
}

async function exigirCancelacion(sql, ids) {
  const generaciones = await sql.consultar(
    `SELECT generacion_id,estado,rol_generacion
       FROM generaciones_flujos_federacion
      WHERE generacion_id IN (?,?) ORDER BY generacion_id`,
    [ids.generacionAId, ids.generacionBId]
  );
  assert.equal(generaciones.every(
    ({ estado, rol_generacion: rol }) => estado === 'cancelada' && rol === 'historica'
  ), true);
  const [corteB] = await sql.consultar(
    `SELECT estado FROM cortes_iniciales_generaciones_federacion
      WHERE generacion_id=?`,
    [ids.generacionBId]
  );
  assert.equal(corteB.estado, 'cancelado');
  const [outboxA] = await sql.consultar(
    `SELECT estado FROM outbox_federacion WHERE generacion_id=?`,
    [ids.generacionAId]
  );
  assert.equal(outboxA.estado, 'canceladaGeneracion');
}

async function exigirActiva(sql, flujoId, generacionId, versionPropietario) {
  const [flujo] = await sql.consultar(
    `SELECT generacion_activa_id,version_propietario
       FROM flujos_federacion WHERE flujo_id=?`,
    [flujoId]
  );
  assert.equal(flujo.generacion_activa_id, generacionId);
  assert.equal(Number(flujo.version_propietario), versionPropietario);
  const [conteo] = await sql.consultar(
    `SELECT SUM(rol_generacion='activa') AS activas,
            SUM(rol_generacion='candidata') AS candidatas
       FROM generaciones_flujos_federacion WHERE flujo_id=?`,
    [flujoId]
  );
  assert.equal(Number(conteo.activas), 1);
  const [propietarios] = await sql.consultar(
    `SELECT COUNT(*) AS total FROM propietarios_emision_flujos_federacion
      WHERE flujo_id=? AND estado='vigente'`,
    [flujoId]
  );
  assert.equal(Number(propietarios.total), 1);
}

function definicionFlujo(ids) {
  return {
    flujoId: ids.flujoId,
    relacionId: ids.relacionId,
    direccion: 'emision',
    familia: 'monitores',
    versionFamilia: 1,
    contexto: { nivel: 'portal', tenantId: null, empresaId: null, sitioId: null }
  };
}

function definicionGeneracion(ids, generacionId, clase, version) {
  return {
    generacionId,
    clase,
    fronteraInicial: '0',
    propietario: propietario(ids, version)
  };
}

function propietario(ids, version) {
  return {
    installationId: ids.installationLocalId,
    bootId: ids.bootId,
    version
  };
}

function destino(ids, generacionId) {
  return { flujoId: ids.flujoId, generacionId };
}

function fronteraSincronizando() {
  return {
    posicionOperativa: null,
    posicionHistorica: null,
    sincronizando: true,
    operativamenteCompleta: false,
    historicamenteCompleta: false,
    parcialPorScope: false,
    degradada: false
  };
}

function fronteraCompleta(posicion) {
  return {
    posicionOperativa: posicion,
    posicionHistorica: posicion,
    sincronizando: false,
    operativamenteCompleta: true,
    historicamenteCompleta: true,
    parcialPorScope: false,
    degradada: false
  };
}

function definicionOcurrencia(ids, ocurrenciaOrigenId) {
  return {
    familia: 'monitores',
    familiaVersion: 1,
    installationOrigenId: ids.installationLocal,
    elementoOrigenId: ids.elementoOrigen,
    ocurrenciaOrigenId,
    operacion: 'actualizacion',
    tiempoOrigenUtc: '2030-01-01T00:00:00.000Z',
    scopeOrigenDeclarado: {
      nivel: 'portal', tenantId: null, empresaId: null, sitioId: null
    },
    vigenciaRestanteMs: '300000',
    campos: {
      estado: crearCampoPresenteFederado({ valor: `fixture-${ocurrenciaOrigenId}` })
    },
    evidenciaIntegridad: []
  };
}

async function crearRelacion(sql, ids) {
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
       ?,'emision','vinculada','autorizada','valida','compatible',?,?,?,
       ?,?,NULL,NULL,NULL,1,NULL,?,?,?,1
     )`,
    [
      ids.relacionId,
      ids.installationRemotaId,
      ids.installationRemotaId,
      'fixture 5.22.14b',
      USUARIO_FIXTURE,
      USUARIO_FIXTURE,
      USUARIO_FIXTURE,
      ahora,
      ahora
    ]
  );
}

function crearIds() {
  const generar = (tipo) => generador.generar(tipo);
  const installationLocal = generar(TIPOS_IDENTIDAD_FEDERADA.INSTALACION);
  return Object.freeze({
    installationLocal,
    installationLocalId: String(installationLocal),
    installationRemotaId: String(generar(TIPOS_IDENTIDAD_FEDERADA.INSTALACION)),
    bootId: String(generar(TIPOS_IDENTIDAD_FEDERADA.ARRANQUE)),
    relacionId: String(generar(TIPOS_IDENTIDAD_FEDERADA.RELACION)),
    flujoId: String(generar(TIPOS_IDENTIDAD_FEDERADA.FLUJO)),
    generacionActivaId: String(generar(TIPOS_IDENTIDAD_FEDERADA.GENERACION)),
    generacionAId: String(generar(TIPOS_IDENTIDAD_FEDERADA.GENERACION)),
    generacionBId: String(generar(TIPOS_IDENTIDAD_FEDERADA.GENERACION)),
    generacionCId: String(generar(TIPOS_IDENTIDAD_FEDERADA.GENERACION)),
    generacionDId: String(generar(TIPOS_IDENTIDAD_FEDERADA.GENERACION)),
    generacionEId: String(generar(TIPOS_IDENTIDAD_FEDERADA.GENERACION)),
    elementoOrigen: generar(TIPOS_IDENTIDAD_FEDERADA.ELEMENTO_ORIGEN),
    ocurrenciaAId: generar(TIPOS_IDENTIDAD_FEDERADA.OCURRENCIA_ORIGEN),
    ocurrenciaCId: generar(TIPOS_IDENTIDAD_FEDERADA.OCURRENCIA_ORIGEN)
  });
}

async function migrar(sql) {
  await new EjecutorMigraciones({
    clienteSql: sql,
    repositorioMigraciones: new RepositorioMigraciones(sql),
    rutaMigraciones: obtenerRutaMigraciones()
  }).ejecutarPendientes();
}


await main();

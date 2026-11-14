import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { readFile } from 'node:fs/promises';

import { FuenteEntropiaCriptograficaNode } from '../paquetes/federacion/adaptadores/FuenteEntropiaCriptograficaNode.js';
import { RepositorioFlujosFederacionSql } from '../paquetes/federacion/adaptadores/RepositorioFlujosFederacionSql.js';
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

const SUFIJO_FIXTURE = '5221201';
const generador = new GeneradorIdentidadesFederadas({
  fuenteEntropia: new FuenteEntropiaCriptograficaNode()
});

await main();

async function main() {
  const configuracion = obtenerConfiguracionAplicacion();
  assert.equal(configuracion.sql.estaCompleta, true);
  const baseDatos = `sentinelia_fixture_52212a_${randomBytes(6).toString('hex')}`;
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
    await limpiar(sql, ids);
    await crearRelacionFixture(sql, ids);
    await verificarFlujoGeneracionYFencing(sql, ids);
    await verificarRestriccionesFisicas(sql, ids);
  } finally {
    await limpiar(sql, ids);
    await sql.cerrar();
    await administrador.ejecutar(`DROP DATABASE IF EXISTS ${administrador.escaparIdentificador(baseDatos)}`).catch(() => {});
    await administrador.cerrar();
  }
  console.log(
    '[federacion] OK 5.22.12a: flujo=durable generacion=versionada ' +
    'frontera=explicita propietario=fencing-sql transporte=bloqueado'
  );
}

async function verificarFlujoGeneracionYFencing(sql, ids) {
  const repositorio = new RepositorioFlujosFederacionSql(sql, {
    installationLocalId: ids.installationLocalId
  });
  const creado = await repositorio.crearFlujoInicial({
    flujo: {
      flujoId: ids.flujoId,
      relacionId: ids.relacionId,
      direccion: 'emision',
      familia: 'monitores',
      versionFamilia: 1,
      contexto: { nivel: 'portal', tenantId: null, empresaId: null, sitioId: null }
    },
    generacion: {
      generacionId: ids.generacionId,
      clase: 'inicial',
      fronteraInicial: '10',
      propietario: propietario(ids, 1)
    }
  });
  assert.equal(creado.estado, 'sinSincronizar');
  assert.equal(creado.generacion.estado, 'preparada');
  assert.equal(creado.generacion.frontera.posicionInicial, '10');
  assert.equal(creado.generacion.frontera.sincronizando, true);
  assert.equal(creado.generacion.propietario.version, 1);

  const transfiriendo = await repositorio.avanzarGeneracion({
    flujoId: ids.flujoId,
    propietario: propietario(ids, 1),
    versionEstadoEsperada: 1,
    versionFronteraEsperada: 1,
    estadoGeneracion: 'transfiriendo',
    estadoFlujo: 'sincronizando',
    frontera: frontera({ sincronizando: true })
  });
  assert.equal(transfiriendo.generacion.versionEstado, '2');
  assert.equal(transfiriendo.generacion.frontera.version, '2');

  const reemplazado = await repositorio.reemplazarPropietario({
    flujoId: ids.flujoId,
    propietarioEsperado: propietario(ids, 1),
    nuevoPropietario: {
      installationId: ids.installationLocalId,
      bootId: ids.bootNuevoId,
      version: 2
    }
  });
  assert.equal(reemplazado.generacion.propietario.bootId, ids.bootNuevoId);
  assert.equal(reemplazado.generacion.propietario.version, 2);
  await assert.rejects(
    repositorio.reemplazarPropietario({
      flujoId: ids.flujoId,
      propietarioEsperado: {
        installationId: ids.installationLocalId,
        bootId: ids.bootNuevoId,
        version: 2
      },
      nuevoPropietario: {
        installationId: ids.installationRemotaId,
        bootId: ids.bootNuevoId,
        version: 3
      }
    }),
    (error) => error.codigo === 'installation_propietaria_inmutable'
  );
  await assert.rejects(
    repositorio.avanzarGeneracion({
      flujoId: ids.flujoId,
      propietario: propietario(ids, 1),
      versionEstadoEsperada: 2,
      versionFronteraEsperada: 2,
      estadoGeneracion: 'fronteraOperativaValidada',
      estadoFlujo: 'operativoParcial',
      frontera: frontera({
        sincronizando: true,
        operativamenteCompleta: true,
        posicionOperativa: '10'
      })
    }),
    (error) => error.codigo === 'propietario_sustituido'
  );

  const operativo = await repositorio.avanzarGeneracion({
    flujoId: ids.flujoId,
    propietario: {
      installationId: ids.installationLocalId,
      bootId: ids.bootNuevoId,
      version: 2
    },
    versionEstadoEsperada: 2,
    versionFronteraEsperada: 2,
    estadoGeneracion: 'fronteraOperativaValidada',
    estadoFlujo: 'operativoParcial',
    frontera: frontera({
      sincronizando: true,
      operativamenteCompleta: true,
      posicionOperativa: '10',
      posicionHistorica: '4',
      parcialPorScope: true
    })
  });
  assert.equal(operativo.generacion.frontera.operativamenteCompleta, true);
  assert.equal(operativo.generacion.frontera.parcialPorScope, true);
  assert.equal(operativo.generacion.frontera.historicamenteCompleta, false);

  const completo = await repositorio.avanzarGeneracion({
    flujoId: ids.flujoId,
    propietario: {
      installationId: ids.installationLocalId,
      bootId: ids.bootNuevoId,
      version: 2
    },
    versionEstadoEsperada: 3,
    versionFronteraEsperada: 3,
    estadoGeneracion: 'completa',
    estadoFlujo: 'operativoCompleto',
    frontera: frontera({
      sincronizando: false,
      operativamenteCompleta: true,
      historicamenteCompleta: true,
      posicionOperativa: '10',
      posicionHistorica: '10',
      parcialPorScope: true
    })
  });
  assert.equal(completo.generacion.estado, 'completa');
  assert.equal(completo.generacion.frontera.historicamenteCompleta, true);
  assert.equal(completo.generacion.frontera.parcialPorScope, true);

  const propietarios = await sql.consultar(
    `SELECT version_propietario,boot_propietario_id,estado
       FROM propietarios_emision_flujos_federacion
      WHERE flujo_id=? ORDER BY version_propietario`,
    [ids.flujoId]
  );
  assert.deepEqual(
    propietarios.map((fila) => [
      Number(fila.version_propietario),
      fila.boot_propietario_id,
      fila.estado
    ]),
    [
      [1, ids.bootInicialId, 'sustituido'],
      [2, ids.bootNuevoId, 'vigente']
    ]
  );
}

async function verificarRestriccionesFisicas(sql, ids) {
  const repositorio = new RepositorioFlujosFederacionSql(sql, {
    installationLocalId: ids.installationLocalId
  });
  await assert.rejects(
    repositorio.crearFlujoInicial({
      flujo: {
        flujoId: ids.flujoDuplicadoId,
        relacionId: ids.relacionId,
        direccion: 'emision',
        familia: 'monitores',
        contexto: { nivel: 'portal' }
      },
      generacion: {
        generacionId: ids.generacionDuplicadaId,
        clase: 'inicial',
        fronteraInicial: '0',
        propietario: {
          installationId: ids.installationLocalId,
          bootId: ids.bootNuevoId,
          version: 1
        }
      }
    }),
    (error) => error.code === 'ER_DUP_ENTRY'
  );
}

async function crearRelacionFixture(sql, ids) {
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
       ?,'emision','vinculada','autorizada','valida','compatible',?,?,
       'fixture 5.22.12a',?, ?,NULL,NULL,NULL,1,NULL,?,?,?,1
     )`,
    [
      ids.relacionId,
      ids.installationRemotaId,
      ids.installationRemotaId,
      SUFIJO_FIXTURE,
      SUFIJO_FIXTURE,
      SUFIJO_FIXTURE,
      ahora,
      ahora
    ]
  );
}

async function limpiar(sql, ids) {
  const residuos = await sql.consultar(
    `SELECT f.flujo_id,f.generacion_activa_id,r.relacion_id
       FROM relaciones_federacion r
       LEFT JOIN flujos_federacion f ON f.relacion_id=r.relacion_id
      WHERE r.creada_por_usuario_id=?`,
    [SUFIJO_FIXTURE]
  ).catch(() => []);
  const flujoIds = [...new Set([
    ids.flujoId,
    ids.flujoDuplicadoId,
    ...residuos.map((fila) => fila.flujo_id).filter(Boolean)
  ])];
  const relacionIds = [...new Set([
    ids.relacionId,
    ...residuos.map((fila) => fila.relacion_id).filter(Boolean)
  ])];
  const marcasFlujo = flujoIds.map(() => '?').join(',');
  await sql.ejecutar(
    `DELETE FROM propietarios_emision_flujos_federacion
      WHERE flujo_id IN (${marcasFlujo})`,
    flujoIds
  ).catch(() => {});
  await sql.ejecutar(
    `UPDATE flujos_federacion SET generacion_activa_id=NULL
      WHERE flujo_id IN (${marcasFlujo})`,
    flujoIds
  ).catch(() => {});
  await sql.ejecutar(
    `DELETE FROM fronteras_generaciones_federacion
      WHERE generacion_id IN (
        SELECT generacion_id FROM generaciones_flujos_federacion
         WHERE flujo_id IN (${marcasFlujo})
      )`,
    flujoIds
  ).catch(() => {});
  await sql.ejecutar(
    `DELETE FROM generaciones_flujos_federacion
      WHERE flujo_id IN (${marcasFlujo})`,
    flujoIds
  ).catch(() => {});
  await sql.ejecutar(
    `DELETE FROM flujos_federacion WHERE flujo_id IN (${marcasFlujo})`,
    flujoIds
  ).catch(() => {});
  await sql.ejecutar(
    `DELETE FROM relaciones_federacion
      WHERE relacion_id IN (${relacionIds.map(() => '?').join(',')})`,
    relacionIds
  ).catch(() => {});
}

function crearIdentidades() {
  const generar = (tipo) => String(generador.generar(tipo));
  return {
    installationLocalId: generar(TIPOS_IDENTIDAD_FEDERADA.INSTALACION),
    installationRemotaId: generar(TIPOS_IDENTIDAD_FEDERADA.INSTALACION),
    bootInicialId: generar(TIPOS_IDENTIDAD_FEDERADA.ARRANQUE),
    bootNuevoId: generar(TIPOS_IDENTIDAD_FEDERADA.ARRANQUE),
    relacionId: generar(TIPOS_IDENTIDAD_FEDERADA.RELACION),
    flujoId: generar(TIPOS_IDENTIDAD_FEDERADA.FLUJO),
    flujoDuplicadoId: generar(TIPOS_IDENTIDAD_FEDERADA.FLUJO),
    generacionId: generar(TIPOS_IDENTIDAD_FEDERADA.GENERACION),
    generacionDuplicadaId: generar(TIPOS_IDENTIDAD_FEDERADA.GENERACION)
  };
}

function propietario(ids, version) {
  return {
    installationId: ids.installationLocalId,
    bootId: ids.bootInicialId,
    version
  };
}

function frontera({
  posicionOperativa = null,
  posicionHistorica = null,
  sincronizando,
  operativamenteCompleta = false,
  historicamenteCompleta = false,
  parcialPorScope = false,
  degradada = false
}) {
  return {
    posicionOperativa,
    posicionHistorica,
    sincronizando,
    operativamenteCompleta,
    historicamenteCompleta,
    parcialPorScope,
    degradada
  };
}

function leer(ruta) {
  return readFile(new URL(ruta, import.meta.url), 'utf8');
}

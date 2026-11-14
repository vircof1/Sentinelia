import assert from 'node:assert/strict';
import { createHash, randomBytes } from 'node:crypto';
import { readFile } from 'node:fs/promises';

import { FuenteEntropiaCriptograficaNode } from '../paquetes/federacion/adaptadores/FuenteEntropiaCriptograficaNode.js';
import { RepositorioFlujosFederacionSql } from '../paquetes/federacion/adaptadores/RepositorioFlujosFederacionSql.js';
import { RepositorioInboxFederacionSql } from '../paquetes/federacion/adaptadores/RepositorioInboxFederacionSql.js';
import { RepositorioMaterializacionFederacionSql } from '../paquetes/federacion/adaptadores/RepositorioMaterializacionFederacionSql.js';
import { canonicalizarJsonFederacion } from '../paquetes/federacion/src/CanonicalizadorFederacion.js';
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

const USUARIO_FIXTURE = 5_221_403;
const generador = new GeneradorIdentidadesFederadas({
  fuenteEntropia: new FuenteEntropiaCriptograficaNode()
});

async function main() {
  await verificarRegistro();
  const configuracion = obtenerConfiguracionAplicacion();
  assert.equal(configuracion.sql.estaCompleta, true);
  const baseDatos = `sentinelia_fixture_52214c_${randomBytes(6).toString('hex')}`;
  const administrador = new ClienteSql(configuracion.sql);
  let sql;
  try {
    await administrador.ejecutar(
      `CREATE DATABASE ${administrador.escaparIdentificador(baseDatos)} ` +
      'CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci'
    );
    sql = new ClienteSql({ ...configuracion.sql, baseDatos });
    await migrar(sql);
    await verificarIdentidadesYScopes(sql);
  } finally {
    await sql?.cerrar().catch(() => {});
    await administrador.ejecutar(
      `DROP DATABASE IF EXISTS ${administrador.escaparIdentificador(baseDatos)}`
    ).catch(() => {});
    await administrador.cerrar();
  }
  console.log(
    '[federacion] OK 5.22.14c: ocurrencia=global proyeccion=contextual ' +
    'misma_scope=deduplicada scopes_distintos=aislados materializacion=una_por_proyeccion'
  );
}

async function verificarRegistro() {
  const [repositorio] = await Promise.all([
    leer('../paquetes/federacion/adaptadores/RepositorioMaterializacionFederacionSql.js')
  ]);
  assert.match(repositorio, /aplicacionNueva: false/u);
}

async function verificarIdentidadesYScopes(sql) {
  const ids = crearIds();
  const contextos = [
    { nivel: 'empresa', tenantId: '10', empresaId: '20', sitioId: null },
    { nivel: 'empresa', tenantId: '10', empresaId: '20', sitioId: null },
    { nivel: 'sitio', tenantId: '10', empresaId: '20', sitioId: '30' }
  ];
  const repositorioFlujos = new RepositorioFlujosFederacionSql(sql, {
    installationLocalId: ids.installationLocalId
  });
  for (let indice = 0; indice < 3; indice += 1) {
    await crearRelacion(sql, ids, indice);
    await repositorioFlujos.crearFlujoInicial({
      flujo: {
        flujoId: ids.flujos[indice],
        relacionId: ids.relaciones[indice],
        direccion: 'recepcion',
        familia: 'monitores',
        versionFamilia: 1,
        contexto: contextos[indice]
      },
      generacion: {
        generacionId: ids.generaciones[indice],
        clase: 'inicial',
        fronteraInicial: '0',
        propietario: {
          installationId: ids.installationRemotaId,
          bootId: ids.bootRemotoId,
          version: 1
        }
      }
    });
  }

  const proyeccionesGeneradas = [ids.proyeccionEmpresaId, ids.proyeccionSitioId];
  const materializacion = new RepositorioMaterializacionFederacionSql(sql, {
    generarProyeccionId: () => {
      const siguiente = proyeccionesGeneradas.shift();
      assert.ok(siguiente, 'No debe nacer una tercera proyección contextual.');
      return siguiente;
    }
  });
  const inbox = new RepositorioInboxFederacionSql(sql);
  const ocurrencia = crearOcurrencia(ids);
  await assert.rejects(
    inbox.recibir({ ...ocurrencia, proyeccionId: ids.proyeccionEmpresaId }),
    (error) => error.codigo === 'contexto_local_remoto_prohibido'
  );
  const resultados = [];
  for (let indice = 0; indice < 3; indice += 1) {
    resultados.push(await recibirRuta({
      sql,
      inbox,
      materializacion,
      ids,
      indice,
      ocurrencia
    }));
  }

  assert.equal(resultados[0].inbox.codigo, 'aceptada');
  assert.equal(resultados[1].inbox.codigo, 'yaConocida');
  assert.equal(resultados[2].inbox.codigo, 'yaConocida');
  assert.equal(resultados[0].trabajo.aplicacionNueva, true);
  assert.equal(resultados[1].trabajo.aplicacionNueva, false);
  assert.equal(resultados[1].trabajo.entregaId, ids.entregas[0]);
  assert.equal(resultados[2].trabajo.aplicacionNueva, true);
  assert.equal(resultados[0].trabajo.proyeccionId, ids.proyeccionEmpresaId);
  assert.equal(resultados[1].trabajo.proyeccionId, ids.proyeccionEmpresaId);
  assert.equal(resultados[2].trabajo.proyeccionId, ids.proyeccionSitioId);

  const conteos = await contarModelo(sql);
  assert.deepEqual(conteos, {
    ocurrencias: 1,
    proyecciones: 2,
    aplicaciones: 2,
    trabajos: 2,
    observacionesInbox: 3,
    observacionesEmpresa: 2
  });
  const ocurrenciaConcurrente = {
    ...crearOcurrencia(ids),
    ocurrenciaOrigenId: ids.ocurrenciaConcurrenteId,
    secuenciaElemento: '2'
  };
  const concurrentes = await Promise.all([
    recibirRuta({
      sql,
      inbox,
      materializacion,
      ids,
      indice: 0,
      ocurrencia: ocurrenciaConcurrente,
      entregaId: ids.entregasConcurrentes[0],
      posicionFlujo: '2'
    }),
    recibirRuta({
      sql,
      inbox,
      materializacion,
      ids,
      indice: 1,
      ocurrencia: ocurrenciaConcurrente,
      entregaId: ids.entregasConcurrentes[1],
      posicionFlujo: '2'
    })
  ]);
  assert.equal(
    concurrentes.filter(({ trabajo }) => trabajo.aplicacionNueva).length,
    1
  );
  assert.equal(concurrentes[0].trabajo.proyeccionId, ids.proyeccionEmpresaId);
  assert.equal(concurrentes[1].trabajo.proyeccionId, ids.proyeccionEmpresaId);
  const [trasConcurrencia] = await sql.consultar(
    `SELECT
       (SELECT COUNT(*) FROM inbox_ocurrencias_federacion) AS ocurrencias,
       (SELECT COUNT(*) FROM aplicaciones_ocurrencias_proyecciones_federacion)
         AS aplicaciones,
       (SELECT COUNT(*) FROM trabajos_materializacion_federacion) AS trabajos`
  );
  assert.deepEqual([
    Number(trasConcurrencia.ocurrencias),
    Number(trasConcurrencia.aplicaciones),
    Number(trasConcurrencia.trabajos)
  ], [2, 3, 3]);
  const scopes = await sql.consultar(
    `SELECT proyeccion_id,scope_nivel,scope_tenant_id,
            scope_empresa_id,scope_sitio_id
       FROM proyecciones_federacion ORDER BY scope_nivel`
  );
  assert.deepEqual(scopes.map((fila) => [
    fila.scope_nivel,
    String(fila.scope_tenant_id),
    String(fila.scope_empresa_id),
    fila.scope_sitio_id === null ? null : String(fila.scope_sitio_id)
  ]), [
    ['empresa', '10', '20', null],
    ['sitio', '10', '20', '30']
  ]);

  const reclamados = await materializacion.reclamarPendientes({
    propietario: 'worker-14c',
    limite: 10,
    leaseMs: 30_000
  });
  assert.equal(reclamados.length, 3);
  assert.deepEqual(
    new Set(reclamados.map(({ proyeccionId }) => proyeccionId)),
    new Set([ids.proyeccionEmpresaId, ids.proyeccionSitioId])
  );
  await assert.rejects(
    sql.ejecutar(
      `UPDATE proyecciones_federacion SET scope_sitio_id=31
        WHERE proyeccion_id=?`,
      [ids.proyeccionSitioId]
    ),
    (error) => error.sqlState === '45000'
  );
}

async function recibirRuta(entrada) {
  for (let intento = 1; intento <= 4; intento += 1) {
    try {
      return await recibirRutaUnaVez(entrada);
    } catch (error) {
      if (intento === 4 || !esConflictoTransaccional(error)) throw error;
    }
  }
  throw new Error('Estado inalcanzable al reintentar la ruta 14c.');
}

async function recibirRutaUnaVez({
  sql,
  inbox,
  materializacion,
  ids,
  indice,
  ocurrencia,
  entregaId = ids.entregas[indice],
  posicionFlujo = '1'
}) {
  const conexion = await sql.obtenerConexion();
  try {
    await conexion.beginTransaction();
    const resultadoInbox = await inbox.recibirEnTransaccion(ocurrencia, { conexion });
    const canonico = canonicalizarJsonFederacion(ocurrencia);
    const ahora = await ahoraSql(conexion);
    await conexion.execute(
      `INSERT INTO entregas_recepcion_federacion (
         entrega_id,relacion_id,flujo_id,generacion_id,posicion_flujo,
         ocurrencia_canonica,ocurrencia_sha256,creada_en_utc
       ) VALUES (?,?,?,?,?,?,?,?)`,
      [
        entregaId,
        ids.relaciones[indice],
        ids.flujos[indice],
        ids.generaciones[indice],
        posicionFlujo,
        canonico,
        createHash('sha256').update(canonico, 'utf8').digest(),
        ahora
      ]
    );
    const trabajo = await materializacion.registrarTrabajoEnTransaccion({
      lote: {
        relacionId: ids.relaciones[indice],
        flujoId: ids.flujos[indice],
        generacionId: ids.generaciones[indice]
      },
      entrega: {
        entregaId,
        posicionFlujo,
        ocurrencia
      },
      inboxId: resultadoInbox.inboxId
    }, { conexion });
    await conexion.commit();
    return { inbox: resultadoInbox, trabajo };
  } catch (error) {
    await conexion.rollback().catch(() => {});
    throw error;
  } finally {
    conexion.release();
  }
}

function esConflictoTransaccional(error) {
  return error?.code === 'ER_LOCK_DEADLOCK' ||
    error?.code === 'ER_LOCK_WAIT_TIMEOUT' ||
    error?.sqlState === '40001';
}

async function contarModelo(sql) {
  const [fila] = await sql.consultar(
    `SELECT
       (SELECT COUNT(*) FROM inbox_ocurrencias_federacion) AS ocurrencias,
       (SELECT COUNT(*) FROM proyecciones_federacion) AS proyecciones,
       (SELECT COUNT(*) FROM aplicaciones_ocurrencias_proyecciones_federacion)
         AS aplicaciones,
       (SELECT COUNT(*) FROM trabajos_materializacion_federacion) AS trabajos,
       (SELECT veces_observada FROM inbox_ocurrencias_federacion LIMIT 1)
         AS observaciones_inbox,
       (SELECT veces_observada
          FROM aplicaciones_ocurrencias_proyecciones_federacion
         WHERE proyeccion_id=? LIMIT 1) AS observaciones_empresa`,
    [String((await sql.consultar(
      `SELECT proyeccion_id FROM proyecciones_federacion
        WHERE scope_nivel='empresa' LIMIT 1`
    ))[0].proyeccion_id)]
  );
  return {
    ocurrencias: Number(fila.ocurrencias),
    proyecciones: Number(fila.proyecciones),
    aplicaciones: Number(fila.aplicaciones),
    trabajos: Number(fila.trabajos),
    observacionesInbox: Number(fila.observaciones_inbox),
    observacionesEmpresa: Number(fila.observaciones_empresa)
  };
}

function crearOcurrencia(ids) {
  return {
    familia: 'monitores',
    familiaVersion: 1,
    installationOrigenId: ids.installationRemotaId,
    elementoOrigenId: ids.elementoOrigenId,
    ocurrenciaOrigenId: ids.ocurrenciaOrigenId,
    secuenciaElemento: '1',
    operacion: 'actualizacion',
    tiempoOrigenUtc: '2030-01-01T00:00:00.000Z',
    scopeOrigenDeclarado: {
      nivel: 'portal', tenantId: null, empresaId: null, sitioId: null
    },
    vigenciaRestanteMs: '300000',
    campos: {
      estadoOperativo: crearCampoPresenteFederado({ valor: true })
    },
    evidenciaIntegridad: []
  };
}

async function crearRelacion(sql, ids, indice) {
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
       ?,'recepcion','vinculada','autorizada','valida','compatible',?,?,?,
       ?,?,NULL,NULL,NULL,1,NULL,?,?,?,1
     )`,
    [
      ids.relaciones[indice],
      ids.installationRemotaId,
      ids.installationRemotaId,
      `ruta 14c ${indice + 1}`,
      USUARIO_FIXTURE,
      USUARIO_FIXTURE,
      USUARIO_FIXTURE,
      ahora,
      ahora
    ]
  );
}

function crearIds() {
  const id = (tipo) => String(generador.generar(tipo));
  return Object.freeze({
    installationLocalId: id(TIPOS_IDENTIDAD_FEDERADA.INSTALACION),
    installationRemotaId: id(TIPOS_IDENTIDAD_FEDERADA.INSTALACION),
    bootRemotoId: id(TIPOS_IDENTIDAD_FEDERADA.ARRANQUE),
    relaciones: Array.from({ length: 3 }, () => id(TIPOS_IDENTIDAD_FEDERADA.RELACION)),
    flujos: Array.from({ length: 3 }, () => id(TIPOS_IDENTIDAD_FEDERADA.FLUJO)),
    generaciones: Array.from(
      { length: 3 },
      () => id(TIPOS_IDENTIDAD_FEDERADA.GENERACION)
    ),
    entregas: Array.from({ length: 3 }, () => id(TIPOS_IDENTIDAD_FEDERADA.ENTREGA)),
    elementoOrigenId: id(TIPOS_IDENTIDAD_FEDERADA.ELEMENTO_ORIGEN),
    ocurrenciaOrigenId: id(TIPOS_IDENTIDAD_FEDERADA.OCURRENCIA_ORIGEN),
    ocurrenciaConcurrenteId: id(TIPOS_IDENTIDAD_FEDERADA.OCURRENCIA_ORIGEN),
    entregasConcurrentes: Array.from(
      { length: 2 },
      () => id(TIPOS_IDENTIDAD_FEDERADA.ENTREGA)
    ),
    proyeccionEmpresaId: id(TIPOS_IDENTIDAD_FEDERADA.PROYECCION),
    proyeccionSitioId: id(TIPOS_IDENTIDAD_FEDERADA.PROYECCION)
  });
}

async function migrar(sql) {
  await new EjecutorMigraciones({
    clienteSql: sql,
    repositorioMigraciones: new RepositorioMigraciones(sql),
    rutaMigraciones: obtenerRutaMigraciones()
  }).ejecutarPendientes();
}

async function ahoraSql(conexion) {
  const [filas] = await conexion.query('SELECT UTC_TIMESTAMP(3) AS ahora');
  return filas[0].ahora;
}

function leer(ruta) {
  return readFile(new URL(ruta, import.meta.url), 'utf8');
}

await main();

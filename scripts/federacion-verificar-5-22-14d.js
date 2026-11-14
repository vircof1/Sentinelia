import assert from 'node:assert/strict';
import { createHash, randomBytes } from 'node:crypto';
import { readFile } from 'node:fs/promises';

import { FuenteEntropiaCriptograficaNode } from '../paquetes/federacion/adaptadores/FuenteEntropiaCriptograficaNode.js';
import { RepositorioContribucionesFederacionSql } from '../paquetes/federacion/adaptadores/RepositorioContribucionesFederacionSql.js';
import { RepositorioFlujosFederacionSql } from '../paquetes/federacion/adaptadores/RepositorioFlujosFederacionSql.js';
import { RepositorioInboxFederacionSql } from '../paquetes/federacion/adaptadores/RepositorioInboxFederacionSql.js';
import { RepositorioMaterializacionFederacionSql } from '../paquetes/federacion/adaptadores/RepositorioMaterializacionFederacionSql.js';
import { RepositorioProcedenciaEmisionFederacionSql } from '../paquetes/federacion/adaptadores/RepositorioProcedenciaEmisionFederacionSql.js';
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

const USUARIO_FIXTURE = 5_221_404;
const LONGITUD_RECORRIDO = 300;
const generador = new GeneradorIdentidadesFederadas({
  fuenteEntropia: new FuenteEntropiaCriptograficaNode()
});

async function main() {
  await verificarRegistro();
  const configuracion = obtenerConfiguracionAplicacion();
  assert.equal(configuracion.sql.estaCompleta, true);
  const baseDatos = `sentinelia_fixture_52214d_${randomBytes(6).toString('hex')}`;
  const administrador = new ClienteSql(configuracion.sql);
  let sql;
  try {
    await administrador.ejecutar(
      `CREATE DATABASE ${administrador.escaparIdentificador(baseDatos)} ` +
      'CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci'
    );
    sql = new ClienteSql({ ...configuracion.sql, baseDatos });
    await migrar(sql);
    await verificarContribucionesYRutas(sql);
  } finally {
    await sql?.cerrar().catch(() => {});
    await administrador.ejecutar(
      `DROP DATABASE IF EXISTS ${administrador.escaparIdentificador(baseDatos)}`
    ).catch(() => {});
    await administrador.cerrar();
  }
  console.log(
    '[federacion] OK 5.22.14d: contribuciones=por_relacion_revision_ruta ' +
    `recorrido_completo=${LONGITUD_RECORRIDO} sin_maximo_semantico ` +
    'ocurrencia_conocida=aporta_ruta materializacion=no_duplicada'
  );
}

async function verificarRegistro() {
  const [repositorio] = await Promise.all([
    leer('../paquetes/federacion/adaptadores/RepositorioContribucionesFederacionSql.js')
  ]);
  assert.match(repositorio, /exigirRecorridoPersistido/u);
}

async function verificarContribucionesYRutas(sql) {
  const ids = crearIds();
  const repositorioFlujos = new RepositorioFlujosFederacionSql(sql, {
    installationLocalId: ids.installationLocalId
  });
  for (let indice = 0; indice < 2; indice += 1) {
    await crearRelacion(sql, ids, indice);
    await crearRevisionEfectiva(sql, {
      relacionId: ids.relaciones[indice],
      ofertaId: ids.ofertas[indice],
      aceptacionId: ids.aceptaciones[indice],
      efectivaId: ids.revisiones[indice]
    });
    await sql.ejecutar(
      `INSERT INTO estado_concesion_relaciones_federacion (
         relacion_id,revision_oferta_actual_id,revision_aceptacion_actual_id,
         revision_efectiva_actual_id,revision,actualizada_en_utc
       ) VALUES (?,?,?,?,1,UTC_TIMESTAMP(3))`,
      [
        ids.relaciones[indice], ids.ofertas[indice],
        ids.aceptaciones[indice], ids.revisiones[indice]
      ]
    );
    await repositorioFlujos.crearFlujoInicial({
      flujo: {
        flujoId: ids.flujos[indice],
        relacionId: ids.relaciones[indice],
        direccion: 'recepcion',
        familia: 'monitores',
        versionFamilia: 1,
        contexto: {
          nivel: 'empresa', tenantId: '10', empresaId: '20', sitioId: null
        }
      },
      generacion: {
        generacionId: ids.generaciones[indice],
        clase: 'inicial',
        fronteraInicial: '0',
        propietario: {
          installationId: ids.emisores[indice],
          bootId: ids.boots[indice],
          version: 1
        }
      }
    });
  }

  const contribucionesDisponibles = [...ids.contribuciones];
  const contribuciones = new RepositorioContribucionesFederacionSql(sql, {
    generarContribucionId: () => {
      const siguiente = contribucionesDisponibles.shift();
      assert.ok(siguiente, 'No debe nacer una contribución inesperada.');
      return siguiente;
    }
  });
  const materializacion = new RepositorioMaterializacionFederacionSql(sql, {
    generarProyeccionId: () => ids.proyeccionId,
    repositorioContribuciones: contribuciones
  });
  const inbox = new RepositorioInboxFederacionSql(sql);
  const ocurrencia = crearOcurrencia(ids, {
    ocurrenciaOrigenId: ids.ocurrencias[0],
    secuenciaElemento: '1'
  });
  const rutaDirecta = procedencia({
    recorrido: [ids.installationOrigenId],
    emisor: ids.installationOrigenId,
    boot: ids.boots[0]
  });
  const recorridoLargo = [
    ids.installationOrigenId,
    ...ids.intermedias,
    ids.emisores[1]
  ];
  assert.equal(recorridoLargo.length, LONGITUD_RECORRIDO);
  const rutaLarga = procedencia({
    recorrido: recorridoLargo,
    emisor: ids.emisores[1],
    boot: ids.boots[1]
  });

  const directa = await recibir({
    sql, inbox, materializacion, ids, indiceRuta: 0,
    entregaId: ids.entregas[0], posicionFlujo: '1', ocurrencia,
    revisionConcesionEfectiva: ids.revisiones[0], procedencia: rutaDirecta
  });
  const alternativa = await recibir({
    sql, inbox, materializacion, ids, indiceRuta: 1,
    entregaId: ids.entregas[1], posicionFlujo: '1', ocurrencia,
    revisionConcesionEfectiva: ids.revisiones[1], procedencia: rutaLarga
  });
  assert.equal(directa.inbox.codigo, 'aceptada');
  assert.equal(alternativa.inbox.codigo, 'yaConocida');
  assert.equal(directa.trabajo.aplicacionNueva, true);
  assert.equal(alternativa.trabajo.aplicacionNueva, false);
  assert.equal(directa.trabajo.proyeccionId, alternativa.trabajo.proyeccionId);
  assert.equal(directa.trabajo.contribucion.contribucionNueva, true);
  assert.equal(alternativa.trabajo.contribucion.contribucionNueva, true);
  assert.equal(alternativa.trabajo.contribucion.longitudRecorrido, LONGITUD_RECORRIDO);
  const replayAlternativa = await recibir({
    sql, inbox, materializacion, ids, indiceRuta: 1,
    entregaId: ids.entregas[1], posicionFlujo: '1', ocurrencia,
    revisionConcesionEfectiva: ids.revisiones[1], procedencia: rutaLarga,
    persistirEntrega: false
  });
  assert.equal(replayAlternativa.inbox.codigo, 'yaConocida');
  assert.equal(replayAlternativa.trabajo.aplicacionNueva, false);
  assert.equal(replayAlternativa.trabajo.contribucion.contribucionNueva, false);
  assert.equal(replayAlternativa.trabajo.contribucion.aporteNuevo, false);

  const ocurrenciaPosterior = crearOcurrencia(ids, {
    ocurrenciaOrigenId: ids.ocurrencias[1],
    secuenciaElemento: '2'
  });
  const posterior = await recibir({
    sql, inbox, materializacion, ids, indiceRuta: 1,
    entregaId: ids.entregas[2], posicionFlujo: '2', ocurrencia: ocurrenciaPosterior,
    revisionConcesionEfectiva: ids.revisiones[1], procedencia: rutaLarga
  });
  assert.equal(posterior.trabajo.contribucion.contribucionNueva, false);
  assert.equal(posterior.trabajo.contribucion.aporteNuevo, true);

  const filas = await sql.consultar(
    `SELECT
       (SELECT COUNT(*) FROM inbox_ocurrencias_federacion) AS ocurrencias,
       (SELECT COUNT(*) FROM proyecciones_federacion) AS proyecciones,
       (SELECT COUNT(*) FROM aplicaciones_ocurrencias_proyecciones_federacion)
         AS aplicaciones,
       (SELECT COUNT(*) FROM trabajos_materializacion_federacion) AS trabajos,
       (SELECT COUNT(*) FROM contribuciones_proyecciones_federacion)
         AS contribuciones,
       (SELECT COUNT(*) FROM recorrido_contribuciones_federacion) AS saltos,
       (SELECT COUNT(*) FROM aportes_ocurrencias_contribuciones_federacion)
         AS aportes`
  );
  assert.deepEqual(Object.fromEntries(Object.entries(filas[0]).map(([clave, valor]) => [
    clave, Number(valor)
  ])), {
    ocurrencias: 2,
    proyecciones: 1,
    aplicaciones: 2,
    trabajos: 2,
    contribuciones: 2,
    saltos: LONGITUD_RECORRIDO + 1,
    aportes: 3
  });
  const recorridoPersistido = await sql.consultar(
    `SELECT ordinal,installation_id
       FROM recorrido_contribuciones_federacion
      WHERE contribucion_id=? ORDER BY ordinal`,
    [ids.contribuciones[1]]
  );
  assert.equal(recorridoPersistido.length, LONGITUD_RECORRIDO);
  assert.deepEqual(
    recorridoPersistido.map((fila) => fila.installation_id),
    recorridoLargo
  );
  assert.deepEqual(
    recorridoPersistido.map((fila) => String(fila.ordinal)),
    Array.from({ length: LONGITUD_RECORRIDO }, (_, indice) => String(indice + 1))
  );
  const [aporteLargo] = await sql.consultar(
    `SELECT primera_procedencia_canonica,ultima_procedencia_canonica
       FROM aportes_ocurrencias_contribuciones_federacion
      WHERE contribucion_id=? AND inbox_ocurrencia_id=?`,
    [ids.contribuciones[1], alternativa.inbox.inboxId]
  );
  assert.equal(
    deserializarJson(aporteLargo.primera_procedencia_canonica).recorridoInstalaciones.length,
    LONGITUD_RECORRIDO
  );
  assert.equal(
    canonicalizarJsonFederacion(deserializarJson(aporteLargo.primera_procedencia_canonica)),
    canonicalizarJsonFederacion(deserializarJson(aporteLargo.ultima_procedencia_canonica))
  );

  await assert.rejects(
    recibir({
      sql, inbox, materializacion, ids, indiceRuta: 1,
      entregaId: ids.entregas[3], posicionFlujo: '3',
      ocurrencia: crearOcurrencia(ids, {
        ocurrenciaOrigenId: ids.ocurrencias[2], secuenciaElemento: '3'
      }),
      revisionConcesionEfectiva: ids.revisiones[0],
      procedencia: rutaLarga
    }),
    (error) => error.codigo === 'revision_concesion_efectiva_desconocida'
  );
  const [sinResiduo] = await sql.consultar(
    `SELECT COUNT(*) AS total FROM inbox_ocurrencias_federacion
      WHERE ocurrencia_origen_id=?`,
    [ids.ocurrencias[2]]
  );
  assert.equal(Number(sinResiduo.total), 0, 'La contribución inválida revierte toda la entrega.');
  await assert.rejects(
    sql.ejecutar(
      `UPDATE recorrido_contribuciones_federacion SET installation_id=?
        WHERE contribucion_id=? AND ordinal=1`,
      [ids.installationLocalId, ids.contribuciones[1]]
    ),
    (error) => error.sqlState === '45000'
  );
  await verificarProcedenciaEmisora(sql, ids, ocurrencia);
}

async function verificarProcedenciaEmisora(sql, ids, ocurrencia) {
  await crearRelacionEmision(sql, ids);
  await crearRevisionEfectiva(sql, {
    relacionId: ids.relacionEmision,
    ofertaId: ids.ofertaEmision,
    aceptacionId: ids.aceptacionEmision,
    efectivaId: ids.revisionEmision
  });
  await sql.ejecutar(
    `INSERT INTO estado_concesion_relaciones_federacion (
       relacion_id,revision_oferta_actual_id,revision_aceptacion_actual_id,
       revision_efectiva_actual_id,revision,actualizada_en_utc
     ) VALUES (?,?,?,?,1,UTC_TIMESTAMP(3))`,
    [
      ids.relacionEmision,
      ids.ofertaEmision,
      ids.aceptacionEmision,
      ids.revisionEmision
    ]
  );
  const repositorio = new RepositorioProcedenciaEmisionFederacionSql(sql, {
    installationLocalId: ids.installationOrigenId,
    bootLocalId: ids.boots[0]
  });
  const resuelta = await repositorio.resolverParaLote({
    relacionId: ids.relacionEmision,
    candidatos: [{ entregaId: ids.entregaEmision, ocurrencia }]
  });
  assert.equal(resuelta.revisionConcesionEfectiva, ids.revisionEmision);
  assert.deepEqual(
    resuelta.ocurrenciasAutorizadas.get(ids.entregaEmision).campos.estadoOperativo,
    { estado: 'omitido', causa: 'noAutorizado' },
    'El emisor no debe poner en red campos ajenos al selector efectivo.'
  );
  assert.deepEqual(
    resuelta.procedencias.get(ids.entregaEmision).recorridoInstalaciones,
    [ids.installationOrigenId]
  );
  assert.equal(
    resuelta.procedencias.get(ids.entregaEmision)
      .tiemposSaltosDisponibles[0].emitidoUtc.endsWith('Z'),
    true
  );
  const ocurrenciaSensible = {
    ...ocurrencia,
    campos: {
      monitores: {
        estado: 'presente',
        sensibilidad: 'sensible',
        valor: {
          tipoRegistro: 'definicion',
          credencialPropia: { estado: 'presente', contenido: { token: 'no-sale' } }
        }
      }
    }
  };
  const sensibleDenegada = await repositorio.resolverParaLote({
    relacionId: ids.relacionEmision,
    candidatos: [{ entregaId: ids.entregaEmision, ocurrencia: ocurrenciaSensible }]
  });
  assert.deepEqual(
    sensibleDenegada.ocurrenciasAutorizadas.get(ids.entregaEmision).campos.monitores,
    { estado: 'omitido', causa: 'noAutorizado' }
  );
  const ocurrenciaFueraScope = {
    ...ocurrencia,
    scopeOrigenDeclarado: {
      nivel: 'tenant', tenantId: '10', empresaId: null, sitioId: null
    }
  };
  await assert.rejects(
    repositorio.resolverParaLote({
      relacionId: ids.relacionEmision,
      candidatos: [{ entregaId: ids.entregaEmision, ocurrencia: ocurrenciaFueraScope }]
    }),
    (error) => error.codigo === 'scope_ocurrencia_fuera_concesion_actual'
  );
  await sql.ejecutar(
    `UPDATE revisiones_concesion_federacion
        SET estado='reducida',finalizada_en_utc=UTC_TIMESTAMP(3)
      WHERE revision_id=?`,
    [ids.revisionEmision]
  );
  await assert.rejects(
    repositorio.resolverParaLote({
      relacionId: ids.relacionEmision,
      candidatos: [{ entregaId: ids.entregaEmision, ocurrencia }]
    }),
    (error) => error.codigo === 'revision_efectiva_emision_ausente'
  );
}

async function recibir({
  sql,
  inbox,
  materializacion,
  ids,
  indiceRuta,
  entregaId,
  posicionFlujo,
  ocurrencia,
  revisionConcesionEfectiva,
  procedencia: datosProcedencia,
  persistirEntrega = true
}) {
  const conexion = await sql.obtenerConexion();
  try {
    await conexion.beginTransaction();
    const resultadoInbox = await inbox.recibirEnTransaccion(ocurrencia, { conexion });
    const canonico = canonicalizarJsonFederacion(ocurrencia);
    const ahora = await ahoraSql(conexion);
    if (persistirEntrega) {
      await conexion.execute(
        `INSERT INTO entregas_recepcion_federacion (
           entrega_id,relacion_id,flujo_id,generacion_id,posicion_flujo,
           ocurrencia_canonica,ocurrencia_sha256,creada_en_utc
         ) VALUES (?,?,?,?,?,?,?,?)`,
        [
          entregaId,
          ids.relaciones[indiceRuta],
          ids.flujos[indiceRuta],
          ids.generaciones[indiceRuta],
          posicionFlujo,
          canonico,
          createHash('sha256').update(canonico, 'utf8').digest(),
          ahora
        ]
      );
    }
    const trabajo = await materializacion.registrarTrabajoEnTransaccion({
      lote: {
        relacionId: ids.relaciones[indiceRuta],
        flujoId: ids.flujos[indiceRuta],
        generacionId: ids.generaciones[indiceRuta],
        revisionConcesionEfectiva
      },
      entrega: { entregaId, posicionFlujo, ocurrencia, procedencia: datosProcedencia },
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

function procedencia({ recorrido, emisor, boot }) {
  return {
    installationEmisoraId: emisor,
    bootEmisorId: boot,
    recorridoInstalaciones: recorrido,
    tiemposSaltosDisponibles: [{
      installationId: emisor,
      bootId: boot,
      recibidoUtc: '2030-01-01T00:00:01.000Z',
      emitidoUtc: '2030-01-01T00:00:02.000Z'
    }]
  };
}

function crearOcurrencia(ids, { ocurrenciaOrigenId, secuenciaElemento }) {
  return {
    familia: 'monitores',
    familiaVersion: 1,
    installationOrigenId: ids.installationOrigenId,
    elementoOrigenId: ids.elementoOrigenId,
    ocurrenciaOrigenId,
    secuenciaElemento,
    operacion: 'actualizacion',
    tiempoOrigenUtc: '2030-01-01T00:00:00.000Z',
    scopeOrigenDeclarado: {
      nivel: 'portal', tenantId: null, empresaId: null, sitioId: null
    },
    vigenciaRestanteMs: '300000',
    campos: { estadoOperativo: crearCampoPresenteFederado({ valor: true }) },
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
      ids.emisores[indice],
      ids.emisores[indice],
      `ruta 14d ${indice + 1}`,
      USUARIO_FIXTURE,
      USUARIO_FIXTURE,
      USUARIO_FIXTURE,
      ahora,
      ahora
    ]
  );
}

async function crearRelacionEmision(sql, ids) {
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
      ids.relacionEmision,
      ids.installationLocalId,
      ids.installationLocalId,
      'emisión local 14d',
      USUARIO_FIXTURE,
      USUARIO_FIXTURE,
      USUARIO_FIXTURE,
      ahora,
      ahora
    ]
  );
}

async function crearRevisionEfectiva(sql, {
  relacionId,
  ofertaId,
  aceptacionId,
  efectivaId
}) {
  const ahora = new Date();
  const seleccion = '{}';
  const huella = createHash('sha256').update(seleccion).digest();
  for (const [indice, [revisionId, papel]] of [
    [ofertaId, 'oferta'],
    [aceptacionId, 'aceptacion'],
    [efectivaId, 'efectiva']
  ].entries()) {
    await sql.ejecutar(
      `INSERT INTO revisiones_concesion_federacion (
         revision_id,relacion_id,papel,ordinal,estado,revision_oferta_id,
         revision_aceptacion_id,seleccion,huella_seleccion,
         autorizada_por_usuario_id,version_autoridad,version_autoridad_remota,
         procedencia,creada_en_utc,
         vigente_desde_utc,finalizada_en_utc,evento_auditoria_id,correlacion_id
       ) VALUES (?,?,?,?,?,?,?,?,?,?,1,?,?,?,?,NULL,?,?)`,
      [
        revisionId,
        relacionId,
        papel,
        1,
        'vigente',
        papel === 'efectiva' ? ofertaId : null,
        papel === 'efectiva' ? aceptacionId : null,
        seleccion,
        huella,
        USUARIO_FIXTURE,
        papel === 'efectiva' ? '1' : null,
        papel === 'efectiva' ? 'derivada' : 'local',
        ahora,
        ahora,
        randomBytes(16),
        randomBytes(16)
      ]
    );
    assert.equal(indice >= 0, true);
    if (papel === 'efectiva') {
      await sql.ejecutar(
        `INSERT INTO selectores_revision_concesion_federacion (
           revision_id,familia,niveles_scope,campos,
           permite_contenido_sensible,permite_refederacion
         ) VALUES (?,'monitores','["portal"]','["monitores"]',FALSE,FALSE)`,
        [revisionId]
      );
    }
  }
}

function crearIds() {
  const id = (tipo) => String(generador.generar(tipo));
  const installationOrigenId = id(TIPOS_IDENTIDAD_FEDERADA.INSTALACION);
  const emisorIntermedio = id(TIPOS_IDENTIDAD_FEDERADA.INSTALACION);
  return Object.freeze({
    installationLocalId: id(TIPOS_IDENTIDAD_FEDERADA.INSTALACION),
    installationOrigenId,
    emisores: [installationOrigenId, emisorIntermedio],
    intermedias: Array.from(
      { length: LONGITUD_RECORRIDO - 2 },
      () => id(TIPOS_IDENTIDAD_FEDERADA.INSTALACION)
    ),
    boots: Array.from({ length: 2 }, () => id(TIPOS_IDENTIDAD_FEDERADA.ARRANQUE)),
    relaciones: Array.from({ length: 2 }, () => id(TIPOS_IDENTIDAD_FEDERADA.RELACION)),
    relacionEmision: id(TIPOS_IDENTIDAD_FEDERADA.RELACION),
    ofertas: Array.from(
      { length: 2 },
      () => id(TIPOS_IDENTIDAD_FEDERADA.REVISION_CONCESION)
    ),
    aceptaciones: Array.from(
      { length: 2 },
      () => id(TIPOS_IDENTIDAD_FEDERADA.REVISION_CONCESION)
    ),
    revisiones: Array.from(
      { length: 2 },
      () => id(TIPOS_IDENTIDAD_FEDERADA.REVISION_CONCESION)
    ),
    ofertaEmision: id(TIPOS_IDENTIDAD_FEDERADA.REVISION_CONCESION),
    aceptacionEmision: id(TIPOS_IDENTIDAD_FEDERADA.REVISION_CONCESION),
    revisionEmision: id(TIPOS_IDENTIDAD_FEDERADA.REVISION_CONCESION),
    flujos: Array.from({ length: 2 }, () => id(TIPOS_IDENTIDAD_FEDERADA.FLUJO)),
    generaciones: Array.from(
      { length: 2 }, () => id(TIPOS_IDENTIDAD_FEDERADA.GENERACION)
    ),
    entregas: Array.from({ length: 4 }, () => id(TIPOS_IDENTIDAD_FEDERADA.ENTREGA)),
    entregaEmision: id(TIPOS_IDENTIDAD_FEDERADA.ENTREGA),
    elementoOrigenId: id(TIPOS_IDENTIDAD_FEDERADA.ELEMENTO_ORIGEN),
    ocurrencias: Array.from(
      { length: 3 }, () => id(TIPOS_IDENTIDAD_FEDERADA.OCURRENCIA_ORIGEN)
    ),
    proyeccionId: id(TIPOS_IDENTIDAD_FEDERADA.PROYECCION),
    contribuciones: Array.from(
      { length: 4 }, () => id(TIPOS_IDENTIDAD_FEDERADA.CONTRIBUCION)
    )
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

function deserializarJson(valor) {
  return typeof valor === 'string' ? JSON.parse(valor) : valor;
}

await main();

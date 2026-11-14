import assert from 'node:assert/strict';
import { createHash, randomBytes } from 'node:crypto';
import { readFile } from 'node:fs/promises';

import { AdaptadorTelemetriaFederacion } from '../paquetes/federacion/adaptadores/AdaptadorTelemetriaFederacion.js';
import { RepositorioPurgaDatosFederadosSql } from '../paquetes/federacion/adaptadores/RepositorioPurgaDatosFederadosSql.js';
import { RepositorioTelemetriaRemotaSql } from '../paquetes/federacion/adaptadores/RepositorioTelemetriaRemotaSql.js';
import { GestorRetencionDatosFederados } from '../paquetes/federacion/aplicacion/GestorRetencionDatosFederados.js';
import { TIPOS_IDENTIDAD_FEDERADA } from '../paquetes/federacion/src/IdentidadFederada.js';
import { PERFIL_PAYLOAD_TELEMETRIA_FEDERACION } from '../paquetes/federacion/src/PayloadTelemetriaFederacion.js';
import { ClienteSql } from '../paquetes/persistencia-sql/src/ClienteSql.js';
import { obtenerConfiguracionAplicacion } from '../paquetes/utilidades/src/configuracion/obtenerConfiguracionAplicacion.js';
import {
  contextoCierre,
  crearElemento,
  id,
  materializar,
  migrar,
  recibirYReclamar
} from './federacion-verificar-5-22-15g.js';

await main();

async function main() {
  await verificarRegistroDocumental();
  await verificarPlanificacionSensible();
  const configuracion = obtenerConfiguracionAplicacion();
  assert.equal(configuracion.sql.estaCompleta, true);
  const baseDatos = `sentinelia_fixture_52217c_${randomBytes(6).toString('hex')}`;
  const administrador = new ClienteSql(configuracion.sql);
  let sql;
  try {
    await administrador.ejecutar(
      `CREATE DATABASE ${administrador.escaparIdentificador(baseDatos)} CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`
    );
    sql = new ClienteSql({ ...configuracion.sql, baseDatos });
    await migrar(sql);
    await verificarRetiradaElemento(sql);
    await verificarRetiradaCampo(sql);
  } finally {
    await sql?.cerrar().catch(() => {});
    await administrador.ejecutar(
      `DROP DATABASE IF EXISTS ${administrador.escaparIdentificador(baseDatos)}`
    ).catch(() => {});
    await administrador.cerrar();
  }
  console.log(
    '[federacion] OK 5.22.17c: tombstone=maduro watermark=conservado ' +
    'campo_sensible=purga_irreversible soporte_ordinario=no_retiene_secreto ' +
    'inbox=reconocible resurreccion=bloqueada'
  );
}

async function verificarPlanificacionSensible() {
  let ejecuciones = 0;
  const gestor = new GestorRetencionDatosFederados({
    servicioPoliticas: {
      reconciliarLimiteGlobal: async () => ({ resultados: [] })
    },
    repositorioPurga: {
      obtenerFechaSqlUtc: async () => '2026-08-08',
      purgarLote: async () => assert.fail('No existe política histórica que purgar.'),
      purgarContenidoSensibleLote: async () => {
        ejecuciones += 1;
        return {
          declaracionesPurgadas: 0,
          sobresInboxPurgados: 1,
          sobresEmisionPurgados: 0,
          totalPurgados: 1,
          hayMas: false
        };
      }
    },
    intervaloComprobacionMs: 1,
    ahoraMs: () => ejecuciones + 1
  });
  const primera = await gestor.ejecutarSiProcede({ forzar: true });
  const segunda = await gestor.ejecutarSiProcede({ forzar: true });
  assert.equal(primera.totalSensiblesPurgados, 1);
  assert.equal(segunda.totalSensiblesPurgados, 1);
  assert.equal(ejecuciones, 2);
}

async function verificarRegistroDocumental() {
  const repositorio = await leer(
    '../paquetes/federacion/adaptadores/RepositorioPurgaDatosFederadosSql.js'
  );
  assert.match(repositorio, /purgarContenidoSensibleLote/u);
}

async function verificarRetiradaElemento(sql) {
  const caso = await crearCaso(sql);
  await insertarSobreInbox(sql, caso.trabajo.inboxId);
  const declaracionElementoId = await insertarDeclaracionSensible(
    sql,
    caso.trabajo.inboxId,
    'secretoRetiradoConElemento'
  );
  const conflictoId = await insertarConflictoSensible(sql, caso.trabajo.inboxId);
  const repositorio = new RepositorioPurgaDatosFederadosSql(sql);
  assert.equal((await repositorio.purgarContenidoSensibleLote({ limite: 10 })).totalPurgados, 0);

  const retirada = await recibirYReclamar({
    sql,
    contexto: caso,
    secuencia: 2,
    operacion: 'retirada',
    payload: null
  });
  await materializar({
    sql,
    adaptador: caso.adaptador,
    trabajo: retirada,
    payload: null,
    operacion: 'retirada'
  });
  await caso.cicloTrabajos.completar(contextoCierre(retirada));

  const purga = await repositorio.purgarContenidoSensibleLote({ limite: 10 });
  assert.equal(purga.sobresInboxPurgados, 1);
  assert.equal(await contar(sql, 'secretos_inbox_federacion', 'inbox_ocurrencia_id', caso.trabajo.inboxId), 0);
  assert.equal(await contar(sql, 'inbox_ocurrencias_federacion', 'id', caso.trabajo.inboxId), 1);
  assert.equal(await contar(
    sql,
    'registros_telemetria_remotos',
    'inbox_ocurrencia_id',
    caso.trabajo.inboxId
  ), 0);
  const [declaracionElemento] = await sql.consultar(
    `SELECT ciphertext,causa_purga FROM declaraciones_campos_inbox_federacion
      WHERE id=?`,
    [declaracionElementoId]
  );
  assert.equal(declaracionElemento.ciphertext, null);
  assert.equal(declaracionElemento.causa_purga, 'retiradaElemento');
  const [conflicto] = await sql.consultar(
    `SELECT contenido_observado_sha256,contenido_sensible_purgado_en_utc
       FROM conflictos_contenido_inbox_federacion WHERE id=?`,
    [conflictoId]
  );
  assert.equal(conflicto.contenido_observado_sha256, null);
  assert.ok(conflicto.contenido_sensible_purgado_en_utc);
  assert.equal(await contar(
    sql,
    'secretos_conflictos_inbox_federacion',
    'conflicto_inbox_id',
    conflictoId
  ), 0);
  const [frontera] = await sql.consultar(
    `SELECT t.secuencia_retirada,w.maxima_secuencia_observada,
            w.maxima_secuencia_materializada
       FROM tombstones_elementos_federacion t
       JOIN watermarks_elementos_federacion w
         ON w.relacion_id=t.relacion_id AND w.flujo_id=t.flujo_id
        AND w.generacion_id=t.generacion_id
        AND w.installation_origen_id=t.installation_origen_id
        AND w.familia=t.familia AND w.elemento_origen_id=t.elemento_origen_id
      WHERE t.relacion_id=?`,
    [caso.ids.relacionId]
  );
  assert.equal(String(frontera.secuencia_retirada), '2');
  assert.equal(String(frontera.maxima_secuencia_observada), '2');
  assert.equal(String(frontera.maxima_secuencia_materializada), '2');
  assert.equal((await repositorio.purgarContenidoSensibleLote({ limite: 10 })).totalPurgados, 0);
}

async function verificarRetiradaCampo(sql) {
  const caso = await crearCaso(sql);
  const inboxId = caso.trabajo.inboxId;
  await insertarSobreInbox(sql, inboxId);
  const contribucionId = await crearContribucionFixture(sql, caso);
  const nombre = 'campoSensiblePrueba';
  const huella = createHash('sha256').update(nombre, 'utf8').digest();
  const declaracionId = await insertarDeclaracionSensible(sql, inboxId, nombre);
  const declaracionOrdinariaId = await insertarDeclaracionOrdinaria(
    sql,
    inboxId,
    'campoOrdinarioVigente'
  );
  await insertarSoporteActivo(
    sql,
    caso,
    declaracionOrdinariaId,
    inboxId,
    'campoOrdinarioVigente'
  );
  await sql.ejecutar(
    `INSERT INTO eventos_soporte_campos_federacion (
       proyeccion_id,contribucion_id,generacion_id,nombre_sha256,nombre_campo,
       tipo,declaracion_campo_id,inbox_ocurrencia_id,secuencia_elemento,
       causa,ocurrido_en_utc
     ) VALUES
       (?,?,?,?,?,'aportado',?,?,1,NULL,UTC_TIMESTAMP(3)),
       (?,?,?,?,?,'retiradoCampo',?,?,2,NULL,UTC_TIMESTAMP(3))`,
    [
      caso.ids.proyeccionId, contribucionId, caso.ids.generacionId,
      huella, nombre, declaracionId, inboxId,
      caso.ids.proyeccionId, contribucionId, caso.ids.generacionId,
      huella, nombre, declaracionId, inboxId
    ]
  );
  const repositorio = new RepositorioPurgaDatosFederadosSql(sql);
  const purga = await repositorio.purgarContenidoSensibleLote({ limite: 10 });
  assert.equal(purga.declaracionesPurgadas, 1);
  assert.equal(purga.sobresInboxPurgados, 1);
  assert.equal(await contar(sql, 'secretos_inbox_federacion', 'inbox_ocurrencia_id', inboxId), 0);
  assert.equal(await contar(
    sql,
    'soportes_campos_contribuciones_federacion',
    'declaracion_campo_id',
    declaracionOrdinariaId
  ), 1);
  assert.equal(await contar(
    sql,
    'registros_telemetria_remotos',
    'inbox_ocurrencia_id',
    inboxId
  ), 1);
  const [declaracion] = await sql.consultar(
    `SELECT ciphertext,causa_purga,purgada_en_utc,
            declaracion_publica_canonica
       FROM declaraciones_campos_inbox_federacion WHERE id=?`,
    [declaracionId]
  );
  assert.equal(declaracion.ciphertext, null);
  assert.equal(declaracion.causa_purga, 'retiradaCampo');
  assert.ok(declaracion.purgada_en_utc);
  assert.match(declaracion.declaracion_publica_canonica, /referencia-contenido-sensible/u);
  await assert.rejects(
    sql.ejecutar(
      `UPDATE declaraciones_campos_inbox_federacion
          SET ciphertext=?,nonce=?,auth_tag=?,perfil_custodia=?,
              keyring_referencia=?,key_id=?,causa_purga=NULL,purgada_en_utc=NULL
        WHERE id=?`,
      [
        randomBytes(32), randomBytes(12), randomBytes(16),
        'sentinelia-federacion-contenido-sensible-a256gcm-v1',
        'fixture-17c', 'clave-2', declaracionId
      ]
    )
  );
}

async function insertarDeclaracionSensible(sql, inboxId, nombre) {
  const huella = createHash('sha256').update(nombre, 'utf8').digest();
  const [insercion] = await sql.ejecutar(
    `INSERT INTO declaraciones_campos_inbox_federacion (
       inbox_ocurrencia_id,nombre_sha256,nombre_campo,estado,sensibilidad,
       declaracion_publica_canonica,perfil_custodia,keyring_referencia,
       key_id,nonce,ciphertext,auth_tag,creada_en_utc
     ) VALUES (?,?,?,'presente','sensible',?,?,?,?,?,?,?,UTC_TIMESTAMP(3))`,
    [
      inboxId,
      huella,
      nombre,
      JSON.stringify({
        estado: 'presente',
        sensibilidad: 'sensible',
        valor: {
          perfil: 'sentinelia-federacion-referencia-contenido-sensible-v1',
          campo: nombre
        }
      }),
      'sentinelia-federacion-contenido-sensible-a256gcm-v1',
      'fixture-17c',
      'clave-1',
      randomBytes(12),
      randomBytes(32),
      randomBytes(16)
    ]
  );
  return String(insercion.insertId);
}

async function insertarDeclaracionOrdinaria(sql, inboxId, nombre) {
  const huella = createHash('sha256').update(nombre, 'utf8').digest();
  const [insercion] = await sql.ejecutar(
    `INSERT INTO declaraciones_campos_inbox_federacion (
       inbox_ocurrencia_id,nombre_sha256,nombre_campo,estado,sensibilidad,
       declaracion_publica_canonica,creada_en_utc
     ) VALUES (?,?,?,'presente','ordinario',?,UTC_TIMESTAMP(3))`,
    [
      inboxId,
      huella,
      nombre,
      JSON.stringify({ estado: 'presente', sensibilidad: 'ordinario', valor: 'vigente' })
    ]
  );
  return String(insercion.insertId);
}

async function insertarSoporteActivo(
  sql,
  caso,
  declaracionId,
  inboxId,
  nombre
) {
  const huella = createHash('sha256').update(nombre, 'utf8').digest();
  const [aporte] = await sql.consultar(
    `SELECT contribucion_id,generacion_id
       FROM aportes_ocurrencias_contribuciones_federacion
      WHERE inbox_ocurrencia_id=? LIMIT 1`,
    [inboxId]
  );
  assert.ok(aporte);
  await sql.ejecutar(
    `INSERT INTO eventos_soporte_campos_federacion (
       proyeccion_id,contribucion_id,generacion_id,nombre_sha256,nombre_campo,
       tipo,declaracion_campo_id,inbox_ocurrencia_id,secuencia_elemento,
       causa,ocurrido_en_utc
     ) VALUES (?,?,?,?,?,'aportado',?,?,1,NULL,UTC_TIMESTAMP(3))`,
    [
      caso.ids.proyeccionId, aporte.contribucion_id, aporte.generacion_id,
      huella, nombre, declaracionId, inboxId
    ]
  );
  await sql.ejecutar(
    `INSERT INTO soportes_campos_contribuciones_federacion (
       contribucion_id,generacion_id,nombre_sha256,nombre_campo,
       estado,declaracion_campo_id,
       inbox_ocurrencia_id,secuencia_elemento,primera_aportacion_utc,
       ultima_actualizacion_utc
     ) VALUES (?,?,?,?,'activo',?,?,1,UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))`,
    [
      aporte.contribucion_id, aporte.generacion_id, huella, nombre,
      declaracionId, inboxId
    ]
  );
}

async function crearContribucionFixture(sql, caso) {
  const ofertaId = id(TIPOS_IDENTIDAD_FEDERADA.REVISION_CONCESION);
  const aceptacionId = id(TIPOS_IDENTIDAD_FEDERADA.REVISION_CONCESION);
  const efectivaId = id(TIPOS_IDENTIDAD_FEDERADA.REVISION_CONCESION);
  const [relacion] = await sql.consultar(
    `SELECT responsable_usuario_id FROM relaciones_federacion WHERE relacion_id=?`,
    [caso.ids.relacionId]
  );
  const seleccion = JSON.stringify({ familias: ['telemetria'] });
  const huellaSeleccion = createHash('sha256').update(seleccion).digest();
  for (const [ordinal, papel, revisionId, oferta, aceptacion] of [
    [1, 'oferta', ofertaId, null, null],
    [1, 'aceptacion', aceptacionId, null, null],
    [1, 'efectiva', efectivaId, ofertaId, aceptacionId]
  ]) {
    await sql.ejecutar(
      `INSERT INTO revisiones_concesion_federacion (
         revision_id,relacion_id,papel,ordinal,estado,
         revision_oferta_id,revision_aceptacion_id,seleccion,huella_seleccion,
         autorizada_por_usuario_id,version_autoridad,version_autoridad_remota,
         procedencia,creada_en_utc,
         vigente_desde_utc,finalizada_en_utc,evento_auditoria_id,correlacion_id
       ) VALUES (?,?,?,?,'vigente',?,?,?,?,?,1,?,?,UTC_TIMESTAMP(3),
                 UTC_TIMESTAMP(3),NULL,?,?)`,
      [
        revisionId, caso.ids.relacionId, papel, ordinal, oferta, aceptacion,
        seleccion, huellaSeleccion, relacion.responsable_usuario_id,
        papel === 'efectiva' ? '1' : null,
        papel === 'efectiva' ? 'derivada' : 'local',
        randomBytes(16), randomBytes(16)
      ]
    );
  }
  const contribucionId = id(TIPOS_IDENTIDAD_FEDERADA.CONTRIBUCION);
  await sql.ejecutar(
    `INSERT INTO contribuciones_proyecciones_federacion (
       contribucion_id,proyeccion_id,relacion_id,revision_concesion_id,
       installation_emisora_id,boot_emisor_ultimo_id,recorrido_sha256,
       longitud_recorrido,estado_autoridad,estado_identidad,
       estado_compatibilidad,resultado_validacion,estado_integridad,
       veces_observada,primera_comunicacion_valida_utc,
       ultima_comunicacion_valida_utc,creada_en_utc,actualizada_en_utc
     ) VALUES (?,?,?,?,?,?,?,1,'autorizada','valida','compatible','valida',
               'valida',1,UTC_TIMESTAMP(3),UTC_TIMESTAMP(3),
               UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))`,
    [
      contribucionId, caso.ids.proyeccionId, caso.ids.relacionId, efectivaId,
      caso.ids.installationRemotaId, caso.ids.bootRemotoId, randomBytes(32)
    ]
  );
  const procedencia = JSON.stringify({
    installationOrigenId: caso.ids.installationRemotaId,
    recorridoInstalaciones: [caso.ids.installationRemotaId]
  });
  const huellaProcedencia = createHash('sha256').update(procedencia).digest();
  await sql.ejecutar(
    `INSERT INTO aportes_ocurrencias_contribuciones_federacion (
       contribucion_id,inbox_ocurrencia_id,flujo_id,generacion_id,
       primera_entrega_id,ultima_entrega_id,primera_procedencia_canonica,
       primera_procedencia_sha256,ultima_procedencia_canonica,
       ultima_procedencia_sha256,vigencia_restante_recepcion_ms,
       veces_observada,primera_observacion_utc,ultima_observacion_utc
     ) VALUES (?,?,?,?,?,?,?,?,?,?,NULL,1,UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))`,
    [
      contribucionId, caso.trabajo.inboxId, caso.ids.flujoId,
      caso.ids.generacionId, caso.trabajo.entregaId, caso.trabajo.entregaId,
      procedencia, huellaProcedencia, procedencia, huellaProcedencia
    ]
  );
  return contribucionId;
}

async function crearCaso(sql) {
  const adaptador = new AdaptadorTelemetriaFederacion({
    repositorioRemoto: new RepositorioTelemetriaRemotaSql(sql)
  });
  const caso = await crearElemento({
    sql,
    adaptador,
    installationRemotaId: id(TIPOS_IDENTIDAD_FEDERADA.INSTALACION),
    elementoOrigenId: id(TIPOS_IDENTIDAD_FEDERADA.ELEMENTO_ORIGEN),
    payload: payload()
  });
  return { ...caso, adaptador };
}

function payload() {
  return {
    perfil: PERFIL_PAYLOAD_TELEMETRIA_FEDERACION,
    version: 1,
    tipoRegistro: 'observacion',
    fuenteOrigenId: id(TIPOS_IDENTIDAD_FEDERADA.ELEMENTO_ORIGEN),
    senalOrigenId: id(TIPOS_IDENTIDAD_FEDERADA.ELEMENTO_ORIGEN),
    periodoPolOrigenId: null,
    categoria: 'sistema',
    clave: 'carga',
    tag: '',
    codigoSenal: 'sistema.carga',
    tipoDato: 'numero',
    unidad: '%',
    valor: 42,
    calidad: 'buena',
    severidadDeclarada: 'informativa',
    origen: 'agente',
    vigenteHastaUtc: '2031-01-01T00:05:00.000Z',
    detalleHumano: 'Fixture sensible 17c',
    metadatosContextuales: {},
    emitidoEnUtc: '2031-01-01T00:00:00.000Z',
    observadoEnUtc: '2031-01-01T00:00:00.000Z',
    recibidoEnUtc: '2031-01-01T00:00:01.000Z'
  };
}

async function insertarSobreInbox(sql, inboxId) {
  await sql.ejecutar(
    `INSERT INTO secretos_inbox_federacion (
       inbox_ocurrencia_id,perfil,keyring_referencia,key_id,nonce,
       ciphertext,auth_tag,contenido_sha256,creado_en_utc
     ) VALUES (?,?,?,?,?,?,?,?,UTC_TIMESTAMP(3))`,
    [
      inboxId,
      'sentinelia-federacion-contenido-sensible-a256gcm-v1',
      'fixture-17c',
      'clave-1',
      randomBytes(12),
      randomBytes(32),
      randomBytes(16),
      randomBytes(32)
    ]
  );
}

async function insertarConflictoSensible(sql, inboxId) {
  const canonico = JSON.stringify({ variante: 'saneada' });
  const [insercion] = await sql.ejecutar(
    `INSERT INTO conflictos_contenido_inbox_federacion (
       inbox_ocurrencia_id,payload_observado_canonico,
       payload_observado_sha256,contenido_observado_sha256,
       veces_observado,primera_observacion_utc,ultima_observacion_utc
     ) VALUES (?,?,?,?,1,UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))`,
    [
      inboxId,
      canonico,
      createHash('sha256').update(canonico).digest(),
      randomBytes(32)
    ]
  );
  const conflictoId = String(insercion.insertId);
  await sql.ejecutar(
    `INSERT INTO secretos_conflictos_inbox_federacion (
       conflicto_inbox_id,perfil,keyring_referencia,key_id,nonce,
       ciphertext,auth_tag,contenido_sha256,creado_en_utc
     ) VALUES (?,?,?,?,?,?,?,?,UTC_TIMESTAMP(3))`,
    [
      conflictoId,
      'sentinelia-federacion-contenido-sensible-a256gcm-v1',
      'fixture-17c',
      'clave-1',
      randomBytes(12),
      randomBytes(32),
      randomBytes(16),
      randomBytes(32)
    ]
  );
  return conflictoId;
}

async function contar(sql, tabla, columna, valor) {
  const [fila] = await sql.consultar(
    `SELECT COUNT(*) AS total FROM ${tabla} WHERE ${columna}=?`,
    [valor]
  );
  return Number(fila.total);
}

function leer(ruta) {
  return readFile(new URL(ruta, import.meta.url), 'utf8');
}

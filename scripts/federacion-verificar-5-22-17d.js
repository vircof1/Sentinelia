import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { readFile } from 'node:fs/promises';

import { AdaptadorAuditoriaFederacion } from '../paquetes/federacion/adaptadores/AdaptadorAuditoriaFederacion.js';
import { RepositorioAuditoriaRemotaSql } from '../paquetes/federacion/adaptadores/RepositorioAuditoriaRemotaSql.js';
import { RepositorioPoliticasRetencionFederacionSql } from '../paquetes/federacion/adaptadores/RepositorioPoliticasRetencionFederacionSql.js';
import { RepositorioPurgaDatosFederadosSql } from '../paquetes/federacion/adaptadores/RepositorioPurgaDatosFederadosSql.js';
import { ServicioPoliticasRetencionFederacion } from '../paquetes/federacion/aplicacion/ServicioPoliticasRetencionFederacion.js';
import { crearPayloadAuditoriaFederadaDesdeVista } from '../paquetes/federacion/src/PayloadAuditoriaFederada.js';
import { TIPOS_IDENTIDAD_FEDERADA } from '../paquetes/federacion/src/IdentidadFederada.js';
import { PERFIL_JCS_AUDITORIA_V1 } from '../paquetes/auditoria/src/PerfilJcsAuditoria.js';
import {
  VERSION_ENCADENADO_AUDITORIA_V1,
  prepararEventoEncadenadoAuditoriaV1
} from '../paquetes/auditoria/src/SobreCanonicoAuditoria.js';
import { generarUuidV7Auditoria } from '../paquetes/auditoria/src/UuidV7Auditoria.js';
import { ClienteSql } from '../paquetes/persistencia-sql/src/ClienteSql.js';
import { obtenerConfiguracionAplicacion } from '../paquetes/utilidades/src/configuracion/obtenerConfiguracionAplicacion.js';
import {
  contextoCierre,
  crearElemento,
  id,
  materializar,
  migrar,
  publicarHasta,
  recibirYReclamar
} from './federacion-verificar-5-22-15g.js';

await main();

async function main() {
  await verificarRegistroDocumental();
  const configuracion = obtenerConfiguracionAplicacion();
  assert.equal(configuracion.sql.estaCompleta, true);
  const baseDatos = `sentinelia_fixture_52217d_${randomBytes(6).toString('hex')}`;
  const administrador = new ClienteSql(configuracion.sql);
  let sql;
  try {
    await administrador.ejecutar(
      `CREATE DATABASE ${administrador.escaparIdentificador(baseDatos)} CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`
    );
    sql = new ClienteSql({ ...configuracion.sql, baseDatos });
    await migrar(sql);
    await verificarRecorte(sql);
  } finally {
    await sql?.cerrar().catch(() => {});
    await administrador.ejecutar(
      `DROP DATABASE IF EXISTS ${administrador.escaparIdentificador(baseDatos)}`
    ).catch(() => {});
    await administrador.cerrar();
  }
  console.log(
    '[federacion] OK 5.22.17d: auditoria=prefijo-retirado ' +
    'ancla=local continuidad=desde-ancla origen=intacto sensible=purgado'
  );
}

async function verificarRegistroDocumental() {
  const repositorio = await leer(
    '../paquetes/federacion/adaptadores/RepositorioPurgaDatosFederadosSql.js'
  );
  assert.match(repositorio, /anclajes_retencion_auditoria_remota/u);
}

async function verificarRecorte(sql) {
  const repositorioAuditoria = new RepositorioAuditoriaRemotaSql(sql);
  const adaptador = new AdaptadorAuditoriaFederacion({
    repositorioRemoto: repositorioAuditoria
  });
  const installationRemotaId = id(TIPOS_IDENTIDAD_FEDERADA.INSTALACION);
  const elementoOrigenId = id(TIPOS_IDENTIDAD_FEDERADA.ELEMENTO_ORIGEN);
  const primero = crearEvento({ secuencia: 1, fecha: '2020-01-01T00:00:00.000Z' });
  const segundo = crearEvento({
    secuencia: 2,
    fecha: '2020-01-02T00:00:00.000Z',
    hashAnterior: primero.hashActual
  });
  const caso = await crearElemento({
    sql,
    adaptador,
    installationRemotaId,
    elementoOrigenId,
    payload: primero.payload,
    familia: 'auditoria',
    versionFamilia: 1
  });
  for (const [secuencia, evento] of [[2, segundo]]) {
    const trabajo = await recibirYReclamar({
      sql,
      contexto: caso,
      secuencia,
      operacion: 'actualizacion',
      payload: evento.payload,
      familia: 'auditoria'
    });
    await materializar({ sql, adaptador, trabajo, payload: evento.payload });
    await caso.cicloTrabajos.completar(contextoCierre(trabajo));
    await publicarHasta(sql, caso.ids.proyeccionId, caso.ids.generacionId, String(secuencia));
  }
  await sql.ejecutar(
    `UPDATE generaciones_flujos_federacion
        SET estado='completa',actualizada_en_utc=UTC_TIMESTAMP(3)
      WHERE generacion_id=?`,
    [caso.ids.generacionId]
  );
  await sql.ejecutar(
    `UPDATE fronteras_generaciones_federacion
        SET posicion_operativa_validada=0,posicion_historica_validada=0,
            sincronizando=FALSE,operativamente_completa=TRUE,
            historicamente_completa=TRUE,version_frontera=version_frontera+1,
            actualizada_en_utc=UTC_TIMESTAMP(3)
      WHERE generacion_id=?`,
    [caso.ids.generacionId]
  );
  await new ServicioPoliticasRetencionFederacion({
    repositorioPoliticas: new RepositorioPoliticasRetencionFederacionSql(sql),
    servicioConfiguracionPortal: configuracionPortalFixture()
  }).reconciliarLimiteGlobal();
  await insertarSobreSensible(sql, caso.trabajo.inboxId);

  const repositorioPurga = new RepositorioPurgaDatosFederadosSql(sql);
  const primeraPurga = await repositorioPurga.purgarLote({
    relacionId: caso.ids.relacionId,
    familia: 'auditoria',
    limite: 1
  });
  assert.equal(primeraPurga.eliminados, 1);
  assert.equal(primeraPurga.motivo, 'verificadaDesdeAncla');
  const [anclaPrimera] = await sql.consultar(
    `SELECT ultima_secuencia_retirada,primera_secuencia_conservada,
            estado_continuidad,eventos_retirados_acumulados,
            HEX(hash_ancla_local) AS hash_ancla_local
       FROM anclajes_retencion_auditoria_remota
      WHERE generacion_id=?`,
    [caso.ids.generacionId]
  );
  assert.equal(String(anclaPrimera.ultima_secuencia_retirada), '1');
  assert.equal(String(anclaPrimera.primera_secuencia_conservada), '2');
  assert.equal(anclaPrimera.estado_continuidad, 'verificadaDesdeAncla');
  assert.equal(String(anclaPrimera.eventos_retirados_acumulados), '1');
  const [anclaPublica] = await repositorioAuditoria.listarAnclajesRetencion({
    installationOrigenId: installationRemotaId,
    claveCadenaOrigen: 'monitores:tenant:9'
  });
  assert.equal(anclaPublica.estadoContinuidad, 'verificadaDesdeAncla');
  assert.equal(anclaPublica.primeraSecuenciaConservada, '2');
  const [secretos] = await sql.consultar(
    'SELECT COUNT(*) AS total FROM secretos_inbox_federacion WHERE inbox_ocurrencia_id=?',
    [caso.trabajo.inboxId]
  );
  assert.equal(Number(secretos.total), 0);

  const segundaPurga = await repositorioPurga.purgarLote({
    relacionId: caso.ids.relacionId,
    familia: 'auditoria',
    limite: 10
  });
  assert.equal(segundaPurga.eliminados, 1);
  const [anclaSegunda] = await sql.consultar(
    `SELECT ultima_secuencia_retirada,primera_secuencia_conservada,
            estado_continuidad,eventos_retirados_acumulados,
            HEX(hash_ancla_local) AS hash_ancla_local
       FROM anclajes_retencion_auditoria_remota
      WHERE generacion_id=?`,
    [caso.ids.generacionId]
  );
  assert.equal(String(anclaSegunda.ultima_secuencia_retirada), '2');
  assert.equal(anclaSegunda.primera_secuencia_conservada, null);
  assert.equal(anclaSegunda.estado_continuidad, 'sinContenidoConservado');
  assert.equal(String(anclaSegunda.eventos_retirados_acumulados), '2');
  assert.notEqual(anclaSegunda.hash_ancla_local, anclaPrimera.hash_ancla_local);
  assert.equal((await repositorioAuditoria.listarEventos()).length, 0);
  assert.equal((await repositorioPurga.purgarLote({
    relacionId: caso.ids.relacionId,
    familia: 'auditoria',
    limite: 10
  })).eliminados, 0);
  const [local] = await sql.consultar('SELECT COUNT(*) AS total FROM eventos_auditoria');
  assert.equal(Number(local.total), 0);
}

function crearEvento({ secuencia, fecha, hashAnterior = Buffer.from('22'.repeat(32), 'hex') }) {
  const eventoId = generarUuidV7Auditoria();
  const sobre = {
    eventoId,
    tipo: 'monitor.actualizado',
    versionContrato: 1,
    flujo: 'monitores',
    claveCadena: 'monitores:tenant:9',
    secuencia: String(secuencia),
    actorReal: { tipo: 'usuario', id: '5' },
    actorEfectivo: null,
    modoActuacion: 'directo',
    sujeto: { tipo: 'monitor', id: '4' },
    origen: 'web',
    scope: { tenantId: '9', empresaId: '20', sitioId: null },
    correlacionId: generarUuidV7Auditoria(),
    causalidad: null,
    productor: 'portal_web',
    claveOperacion: `federacion-17d-${eventoId}`,
    rolEvento: 'principal',
    efectivoEnUtc: fecha,
    registradoEnUtc: fecha,
    versionCanonicalizador: PERFIL_JCS_AUDITORIA_V1,
    versionEncadenado: VERSION_ENCADENADO_AUDITORIA_V1,
    payload: {
      resultado: 'actualizado',
      camposCambiados: ['nombre'],
      antes: { nombre: `Monitor ${secuencia - 1}` },
      despues: { nombre: `Monitor ${secuencia}` }
    }
  };
  const preparado = prepararEventoEncadenadoAuditoriaV1(sobre, { hashAnterior });
  return {
    hashActual: preparado.hashActual,
    payload: crearPayloadAuditoriaFederadaDesdeVista({
      vistaAutorizada: preparado.sobre,
      evidenciaOrigen: {
        estado: 'verificable',
        sobreCanonico: preparado.sobre,
        hashPayload: preparado.hashPayload.toString('hex'),
        hashAnterior: preparado.hashAnterior.toString('hex'),
        hashActual: preparado.hashActual.toString('hex')
      }
    })
  };
}

function configuracionPortalFixture() {
  return {
    asegurarActualizada: async () => {},
    obtenerConfiguracionActual: () => ({
      version: 1,
      obtenerConfiguracionFederacion: () => ({ retencionMaximaDias: 1 })
    })
  };
}

async function insertarSobreSensible(sql, inboxId) {
  await sql.ejecutar(
    `INSERT INTO secretos_inbox_federacion (
       inbox_ocurrencia_id,perfil,keyring_referencia,key_id,nonce,
       ciphertext,auth_tag,contenido_sha256,creado_en_utc
     ) VALUES (?,?,?,?,?,?,?,?,UTC_TIMESTAMP(3))`,
    [
      inboxId,
      'sentinelia-federacion-contenido-sensible-a256gcm-v1',
      'fixture-17d',
      'clave-1',
      randomBytes(12),
      randomBytes(32),
      randomBytes(16),
      randomBytes(32)
    ]
  );
}

function leer(ruta) {
  return readFile(new URL(ruta, import.meta.url), 'utf8');
}

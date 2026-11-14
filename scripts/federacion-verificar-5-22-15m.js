import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { readFile } from 'node:fs/promises';

import {
  AdaptadorAuditoriaFederacion,
  crearDefinicionAdaptadorAuditoriaFederacion
} from '../paquetes/federacion/adaptadores/AdaptadorAuditoriaFederacion.js';
import { RepositorioAuditoriaRemotaSql } from '../paquetes/federacion/adaptadores/RepositorioAuditoriaRemotaSql.js';
import {
  crearPayloadAuditoriaFederadaDesdeVista,
  validarPayloadAuditoriaFederada
} from '../paquetes/federacion/src/PayloadAuditoriaFederada.js';
import { evaluarEvidenciaAuditoriaFederada } from '../paquetes/federacion/adaptadores/EvaluadorEvidenciaAuditoriaFederada.js';
import { TIPOS_IDENTIDAD_FEDERADA } from '../paquetes/federacion/src/IdentidadFederada.js';
import {
  PERFIL_JCS_AUDITORIA_V1
} from '../paquetes/auditoria/src/PerfilJcsAuditoria.js';
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
  await verificarRegistro();
  const configuracion = obtenerConfiguracionAplicacion();
  assert.equal(configuracion.sql.estaCompleta, true);
  const baseDatos = `sentinelia_fixture_52215m_${randomBytes(6).toString('hex')}`;
  const administrador = new ClienteSql(configuracion.sql);
  let sql;
  try {
    await administrador.ejecutar(
      `CREATE DATABASE ${administrador.escaparIdentificador(baseDatos)} CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`
    );
    sql = new ClienteSql({ ...configuracion.sql, baseDatos });
    await migrar(sql);
    await verificarMaterializacion(sql);
  } finally {
    await sql?.cerrar().catch(() => {});
    await administrador.ejecutar(
      `DROP DATABASE IF EXISTS ${administrador.escaparIdentificador(baseDatos)}`
    ).catch(() => {});
    await administrador.cerrar();
  }
  console.log(
    '[federacion] OK 5.22.15m: auditoria=remota_separada ' +
    'verificacion=limitada_por_origen evidencia=validada ancla=receptor ' +
    'retirada=prohibida auditoria_local=intacta'
  );
}

async function verificarRegistro() {
  const [runtime, web] = await Promise.all([
    leer('../apps/sentinelia-runtime/src/BootstrapRuntime.js'),
    leer('../apps/sentinelia-web/src/index.js')
  ]);
  assert.doesNotMatch(runtime, /RepositorioAuditoriaRemotaSql/u);
  assert.match(web, /RepositorioAuditoriaRemotaSql/u);
  assert.match(web, /ServicioAuditoriaRemotaFederacionPortal/u);
}

async function verificarMaterializacion(sql) {
  const repositorio = new RepositorioAuditoriaRemotaSql(sql);
  const adaptador = new AdaptadorAuditoriaFederacion({ repositorioRemoto: repositorio });
  const definicion = crearDefinicionAdaptadorAuditoriaFederacion({
    repositorioRemoto: repositorio
  });
  assert.equal(definicion.productivo, false);
  assert.deepEqual(Object.keys(definicion.interfaces), ['payload', 'materializacion']);

  const installationRemotaId = id(TIPOS_IDENTIDAD_FEDERADA.INSTALACION);
  const verificable = crearEventoVerificable();
  assert.equal(evaluarEvidenciaAuditoriaFederada(verificable).estado, 'verificada');
  assert.throws(
    () => validarPayloadAuditoriaFederada({
      ...verificable,
      vistaAutorizada: {
        ...verificable.vistaAutorizada,
        payload: {
          ...verificable.vistaAutorizada.payload,
          despues: { nombre: 'Vista distinta' }
        }
      }
    }),
    (error) => error.codigo === 'evidencia_auditoria_federada_fuera_de_vista'
  );
  const elemento = await crearEvento({
    sql,
    adaptador,
    installationRemotaId,
    elementoOrigenId: id(TIPOS_IDENTIDAD_FEDERADA.ELEMENTO_ORIGEN),
    payload: verificable,
    finalizar: false,
    publicar: false
  });
  assert.deepEqual(await repositorio.listarEventos(), []);
  const replay = await materializar({
    sql, adaptador, trabajo: elemento.trabajo, payload: verificable
  });
  assert.equal(replay.yaMaterializada, true);
  await elemento.cicloTrabajos.completar(contextoCierre(elemento.trabajo));
  await publicarHasta(sql, elemento.ids.proyeccionId, elemento.ids.generacionId, '1');
  const repetido = await recibirYReclamar({
    sql,
    contexto: elemento,
    secuencia: 2,
    operacion: 'actualizacion',
    payload: verificable,
    familia: 'auditoria'
  });
  const consolidado = await materializar({
    sql, adaptador, trabajo: repetido, payload: verificable
  });
  assert.equal(consolidado.yaMaterializada, true);
  await elemento.cicloTrabajos.completar(contextoCierre(repetido));
  await publicarHasta(sql, elemento.ids.proyeccionId, elemento.ids.generacionId, '2');
  assert.equal((await repositorio.listarEventos()).length, 1);

  const noVerificable = crearEventoNoVerificable();
  await crearEvento({
    sql,
    adaptador,
    installationRemotaId,
    elementoOrigenId: id(TIPOS_IDENTIDAD_FEDERADA.ELEMENTO_ORIGEN),
    payload: noVerificable
  });
  const invalido = crearEventoVerificable({ corromperHashActual: true });
  assert.equal(evaluarEvidenciaAuditoriaFederada(invalido).estado, 'invalida');
  await crearEvento({
    sql,
    adaptador,
    installationRemotaId,
    elementoOrigenId: id(TIPOS_IDENTIDAD_FEDERADA.ELEMENTO_ORIGEN),
    payload: invalido
  });

  const eventos = await repositorio.listarEventos({ installationOrigenId: installationRemotaId });
  assert.equal(eventos.length, 3);
  assert.deepEqual(
    new Set(eventos.map((evento) => evento.resultadoValidacionReceptor)),
    new Set(['verificada', 'noVerificable', 'invalida'])
  );
  const validado = eventos.find((evento) => evento.resultadoValidacionReceptor === 'verificada');
  assert.equal(validado.hashesOrigen.actual.length, 64);
  assert.equal(validado.anclaReceptor.hashRepresentacion.length, 64);
  assert.equal(validado.anclaReceptor.hashAncla.length, 64);
  assert.notEqual(validado.anclaReceptor.hashAncla, validado.hashesOrigen.actual);
  const limitado = eventos.find((evento) => evento.resultadoValidacionReceptor === 'noVerificable');
  assert.equal(limitado.claveCadenaOrigen, null);
  assert.equal(limitado.hashesOrigen.actual, null);

  assert.throws(
    () => validarPayloadAuditoriaFederada(null, { operacion: 'retirada' }),
    (error) => error.codigo === 'operacion_auditoria_federada_invalida'
  );
  const [conteoLocal] = await sql.consultar(
    'SELECT COUNT(*) AS total FROM eventos_auditoria'
  );
  assert.equal(Number(conteoLocal.total), 0);
}

function crearEventoVerificable({ corromperHashActual = false } = {}) {
  const eventoId = generarUuidV7Auditoria();
  const sobre = {
    eventoId,
    tipo: 'monitor.actualizado',
    versionContrato: 1,
    flujo: 'monitores',
    claveCadena: 'monitores:tenant:9',
    secuencia: '7',
    actorReal: { tipo: 'usuario', id: '5' },
    actorEfectivo: null,
    modoActuacion: 'directo',
    sujeto: { tipo: 'monitor', id: '4' },
    origen: 'web',
    scope: { tenantId: '9', empresaId: '20', sitioId: null },
    correlacionId: generarUuidV7Auditoria(),
    causalidad: null,
    productor: 'portal_web',
    claveOperacion: `federacion-15m-${eventoId}`,
    rolEvento: 'principal',
    efectivoEnUtc: '2031-01-01T00:00:00.000Z',
    registradoEnUtc: '2031-01-01T00:00:01.000Z',
    versionCanonicalizador: PERFIL_JCS_AUDITORIA_V1,
    versionEncadenado: VERSION_ENCADENADO_AUDITORIA_V1,
    payload: {
      resultado: 'actualizado',
      camposCambiados: ['nombre'],
      antes: { nombre: 'Monitor de origen' },
      despues: { nombre: 'Monitor federado' }
    }
  };
  const preparado = prepararEventoEncadenadoAuditoriaV1(sobre, {
    hashAnterior: Buffer.from('22'.repeat(32), 'hex')
  });
  return crearPayloadAuditoriaFederadaDesdeVista({
    vistaAutorizada: preparado.sobre,
    evidenciaOrigen: {
      estado: 'verificable',
      sobreCanonico: preparado.sobre,
      hashPayload: preparado.hashPayload.toString('hex'),
      hashAnterior: preparado.hashAnterior.toString('hex'),
      hashActual: corromperHashActual
        ? 'ff'.repeat(32)
        : preparado.hashActual.toString('hex')
    }
  });
}

function crearEventoNoVerificable() {
  const eventoId = generarUuidV7Auditoria();
  return crearPayloadAuditoriaFederadaDesdeVista({
    vistaAutorizada: {
      eventoId,
      tipoEvento: 'monitor.actualizado',
      versionContrato: 1,
      flujo: 'monitores',
      sujeto: { tipo: 'monitor', id: '4' },
      scope: { tenantId: '9', empresaId: '20', sitioId: null },
      efectivoEnUtc: '2031-01-01T00:00:00.000Z',
      registradoEnUtc: '2031-01-01T00:00:01.000Z',
      payload: { resultado: 'actualizado' }
    },
    evidenciaOrigen: {
      estado: 'noVerificable',
      causa: 'vistaParcialOrigen'
    }
  });
}

function crearEvento(opciones) {
  return crearElemento({
    ...opciones,
    familia: 'auditoria',
    versionFamilia: 1
  });
}

function leer(ruta) {
  return readFile(new URL(ruta, import.meta.url), 'utf8');
}

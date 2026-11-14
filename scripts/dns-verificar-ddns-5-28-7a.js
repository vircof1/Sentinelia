import assert from 'node:assert/strict';
import http from 'node:http';
import { randomBytes } from 'node:crypto';

import express from 'express';

import { ControladorApiAgentes }
  from '../apps/sentinelia-web/src/controladores/ControladorApiAgentes.js';
import { crearRutasApiAgentes }
  from '../apps/sentinelia-web/src/rutas/crearRutasApiAgentes.js';
import { ServicioAutenticacionAgentes }
  from '../paquetes/agentes/src/ServicioAutenticacionAgentes.js';
import { RepositorioCausasPolDdns }
  from '../paquetes/dns/src/RepositorioCausasPolDdns.js';
import {
  interpretarDireccionRemotaPolDdns,
  ServicioRegistroCausaPolDdns
} from '../paquetes/dns/src/ServicioRegistroCausaPolDdns.js';
import { ResolutorRedPublicaFederacion }
  from '../paquetes/federacion/aplicacion/ResolutorRedPublicaFederacion.js';
import { ClienteSql } from '../paquetes/persistencia-sql/src/ClienteSql.js';
import { EjecutorMigraciones } from '../paquetes/persistencia-sql/src/EjecutorMigraciones.js';
import { FronteraTransaccionalLocal }
  from '../paquetes/persistencia-sql/src/FronteraTransaccionalLocal.js';
import { RepositorioMigraciones }
  from '../paquetes/persistencia-sql/src/RepositorioMigraciones.js';
import { obtenerConfiguracionAplicacion, obtenerRutaMigraciones }
  from '../paquetes/utilidades/src/configuracion/obtenerConfiguracionAplicacion.js';

await main();

async function main() {
  await verificarFronteraHttp();
  await verificarCommitCausalPol();
  console.log('[dns-ddns] OK 5.28.7a: direccion=middleware_global socket=directo proxy=confiable-no_confiable familias=ipv4-ipv6-mapeada ausente=no_invalida pol=commit_atomico replay=sin_causa respuesta=inalterada');
}

async function verificarFronteraHttp() {
  const directo = await crearServidorHeartbeat(['10.0.0.0/8']);
  try {
    const respuesta = await solicitarHeartbeat(directo.puerto, {
      'x-forwarded-for': '203.0.113.99'
    });
    assert.equal(respuesta.statusCode, 200);
    assert.equal(directo.capturas.length, 1);
    assert.equal(
      interpretarDireccionRemotaPolDdns(directo.capturas[0].direccionRemota)?.familia,
      'ipv4'
    );
    assert.notEqual(directo.capturas[0].direccionRemota, '203.0.113.99');
    exigirRespuestaPolAnterior(respuesta.json);
  } finally {
    await directo.cerrar();
  }

  const proxy = await crearServidorHeartbeat(['127.0.0.1/32']);
  try {
    let respuesta = await solicitarHeartbeat(proxy.puerto, {
      'x-forwarded-for': '198.51.100.27'
    });
    assert.equal(proxy.capturas.at(-1).direccionRemota, '198.51.100.27');
    exigirRespuestaPolAnterior(respuesta.json);

    respuesta = await solicitarHeartbeat(proxy.puerto, {
      'x-forwarded-for': '2001:db8::27'
    }, 2);
    assert.deepEqual(
      interpretarDireccionRemotaPolDdns(proxy.capturas.at(-1).direccionRemota),
      { valor: '2001:db8::27', familia: 'ipv6' }
    );
    exigirRespuestaPolAnterior(respuesta.json, 2);
  } finally {
    await proxy.cerrar();
  }
}

async function verificarCommitCausalPol() {
  const configuracion = obtenerConfiguracionAplicacion();
  assert.equal(configuracion.sql.estaCompleta, true, '5.28.7a necesita MariaDB real.');
  const administrador = new ClienteSql(configuracion.sql);
  const base = `sentinelia_fixture_5287a_${randomBytes(5).toString('hex')}`;
  let sql;
  try {
    await administrador.ejecutar(
      `CREATE DATABASE ${administrador.escaparIdentificador(base)} ` +
      'CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci'
    );
    sql = new ClienteSql({ ...configuracion.sql, baseDatos: base });
    await new EjecutorMigraciones({
      clienteSql: sql,
      repositorioMigraciones: new RepositorioMigraciones(sql),
      rutaMigraciones: obtenerRutaMigraciones()
    }).ejecutarPendientes();
    const registrador = new ServicioRegistroCausaPolDdns({
      repositorioCausasPolDdns: new RepositorioCausasPolDdns(sql)
    });
    const caso = crearServicioHeartbeat(sql, registrador, { periodoId: 71 });
    const direcciones = [
      '192.0.2.71', '2001:db8::71', '::ffff:192.0.2.72',
      'direccion-no-interpretable', null
    ];
    for (let indice = 0; indice < direcciones.length; indice += 1) {
      await caso.servicio.registrarHeartbeat({
        sessionToken: 'token-vivo', seq: indice + 1, bootId: 'boot-7a',
        direccionRemota: direcciones[indice]
      });
    }
    const causas = await sql.consultar(
      `SELECT secuencia,direccion_remota,familia_direccion
         FROM causas_pol_ddns WHERE periodo_vida_pol_id=71 ORDER BY secuencia`
    );
    assert.deepEqual(causas.map((fila) => [
      String(fila.secuencia), fila.direccion_remota, fila.familia_direccion
    ]), [
      ['1', '192.0.2.71', 'ipv4'],
      ['2', '2001:db8::71', 'ipv6'],
      ['3', '192.0.2.72', 'ipv4'],
      ['4', null, null],
      ['5', null, null]
    ]);

    await assert.rejects(
      caso.servicio.registrarHeartbeat({
        sessionToken: 'token-vivo', seq: 5, bootId: 'boot-7a',
        direccionRemota: '198.51.100.200'
      }),
      (error) => error?.codigo === 'heartbeat_seq_antiguo'
    );
    assert.equal((await sql.consultar(
      'SELECT COUNT(*) total FROM causas_pol_ddns WHERE periodo_vida_pol_id=71'
    ))[0].total, 5);

    const rollback = crearServicioHeartbeat(sql, registrador, {
      periodoId: 72,
      fallarSnapshot: true
    });
    await assert.rejects(
      rollback.servicio.registrarHeartbeat({
        sessionToken: 'token-vivo', seq: 1, bootId: 'boot-7a',
        direccionRemota: '198.51.100.72'
      }),
      /fallo posterior simulado/u
    );
    assert.equal((await sql.consultar(
      'SELECT COUNT(*) total FROM causas_pol_ddns WHERE periodo_vida_pol_id=72'
    ))[0].total, 0, 'La causa no puede sobrevivir al rollback del POL.');
  } finally {
    await sql?.cerrar().catch(() => {});
    await administrador.ejecutar(
      `DROP DATABASE IF EXISTS ${administrador.escaparIdentificador(base)}`
    ).catch(() => {});
    await administrador.cerrar();
  }
}

function crearServicioHeartbeat(sql, registradorCausaPolDdns, {
  periodoId,
  fallarSnapshot = false
}) {
  let ultimoSeq = null;
  let heartbeats = 0;
  const periodo = () => ({
    id: String(periodoId),
    sesionIdDiagnostico: 'sesion-7a',
    ultimoSeq,
    heartbeatsRecibidos: heartbeats
  });
  const repositorioAgentes = {
    buscarPeriodoVidaPolAbierto: async () => periodo(),
    registrarHeartbeatPeriodoAbierto: async ({ seq }) => {
      ultimoSeq = seq;
      heartbeats += 1;
      return periodo();
    },
    actualizarSnapshotHeartbeat: async () => {
      if (fallarSnapshot) throw new Error('fallo posterior simulado');
      return identidadAgente();
    }
  };
  const servicio = new ServicioAutenticacionAgentes({
    repositorioAgentes,
    repositorioSesionesAgentesRedis: {
      registrarHeartbeatSesionActualSiCoincide: async () => ({
        registrado: true,
        ttlRestanteSegundos: 600
      })
    },
    fronteraTransaccional: new FronteraTransaccionalLocal(sql),
    repositorioFronteraRuntime: {
      bloquearYValidarEnTransaccion: async () => true
    },
    registradorCausaPolDdns
  });
  servicio.inspeccionarSesionViva = async () => ({
    sesion: {
      agenteId: 71,
      guid: 'agente-7a',
      tenantId: 1,
      empresaId: 1,
      sitioId: 1,
      versionSecreto: 1,
      sessionId: 'sesion-7a',
      sessionTokenHash: 'a'.repeat(64),
      bootId: 'boot-7a',
      versionAgente: '7a'
    },
    agente: {
      ...identidadAgente(),
      versionScopeAgente: '1',
      versionAutorizacionAgente: '1'
    },
    ttlRestanteSegundos: 600
  });
  return { servicio };
}

async function crearServidorHeartbeat(proxiesConfiables) {
  const capturas = [];
  const resolutor = new ResolutorRedPublicaFederacion({
    servicioConfiguracionPortal: {
      async asegurarActualizada() {
        return {
          obtenerConfiguracionFederacion: () => ({
            origenPublico: 'https://sentinelia.example',
            proxiesConfiables
          })
        };
      },
      obtenerVersionActual: () => 1
    }
  });
  await resolutor.inicializar();
  const aplicacion = express();
  resolutor.configurarAplicacionExpress(aplicacion);
  aplicacion.use(express.json());
  const controlador = new ControladorApiAgentes({
    servicioAutenticacionAgentes: {
      async registrarHeartbeat(entrada) {
        capturas.push(entrada);
        return {
          obtenerRespuestaPublica: () => respuestaPublica(entrada.seq)
        };
      }
    }
  });
  aplicacion.use(crearRutasApiAgentes({
    controladorApiAgentes: controlador,
    ddnsAgentesHabilitado: true
  }));
  const servidor = http.createServer(aplicacion);
  await new Promise((resolver, rechazar) => {
    servidor.once('error', rechazar);
    servidor.listen(0, '127.0.0.1', resolver);
  });
  return {
    capturas,
    puerto: servidor.address().port,
    cerrar: () => new Promise((resolver) => servidor.close(resolver))
  };
}

function solicitarHeartbeat(puerto, cabeceras = {}, seq = 1) {
  return new Promise((resolve, reject) => {
    const cuerpo = JSON.stringify({ seq, bootId: 'boot-http-7a' });
    const peticion = http.request({
      hostname: '127.0.0.1', port: puerto, method: 'POST',
      path: '/api/agentes/v1/heartbeat',
      headers: {
        authorization: 'Bearer token-http-7a',
        'content-type': 'application/json',
        'content-length': Buffer.byteLength(cuerpo),
        ...cabeceras
      }
    }, (respuesta) => {
      const fragmentos = [];
      respuesta.on('data', (fragmento) => fragmentos.push(fragmento));
      respuesta.on('end', () => resolve({
        statusCode: respuesta.statusCode,
        json: JSON.parse(Buffer.concat(fragmentos).toString('utf8'))
      }));
    });
    peticion.once('error', reject);
    peticion.end(cuerpo);
  });
}

function exigirRespuestaPolAnterior(cuerpo, seq = 1) {
  assert.deepEqual(Object.keys(cuerpo).sort(), [
    'agente', 'coordinacion', 'heartbeat', 'ok', 'pol', 'requestId',
    'serverTimeUtc', 'sesion'
  ]);
  assert.equal(cuerpo.ok, true);
  assert.deepEqual(cuerpo.heartbeat, respuestaPublica(seq).heartbeat);
  assert.deepEqual(cuerpo.pol, respuestaPublica(seq).pol);
  assert.equal(Object.hasOwn(cuerpo, 'ddns'), false);
}

function respuestaPublica(seq) {
  return {
    agente: identidadAgente(),
    sesion: { sessionId: 'sesion-http', expiresInSeconds: 600, renewBeforeSeconds: 120 },
    heartbeat: { seqAceptado: seq, recibidoEnUtc: '2026-09-09T12:00:00.000Z', desfaseClienteMs: null },
    pol: { estadoVidaPol: 'vivo', periodoId: '71', heartbeatsRecibidos: seq, ultimoSeq: seq },
    coordinacion: {
      accion: 'continue', requiereRefreshSesion: false,
      requiereConfiguracion: false, revisionConfiguracionActual: null,
      requierePolitica: false, revisionPoliticaActual: null
    }
  };
}

function identidadAgente() {
  return {
    id: 71, guid: 'agente-7a', nombre: 'Agente 7a', tenantId: 1,
    empresaId: 1, sitioId: 1, estadoAdministrativo: 'activo',
    estadoAcceso: 'habilitado'
  };
}

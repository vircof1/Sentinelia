import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { readFile } from 'node:fs/promises';

import { CoordinadorEmisionFederacionRuntime } from '../apps/sentinelia-runtime/src/federacion/CoordinadorEmisionFederacionRuntime.js';
import { EmisorHeartbeatFederacionRuntime } from '../apps/sentinelia-runtime/src/federacion/EmisorHeartbeatFederacionRuntime.js';
import { GestorSesionEmisionFederacionRuntime } from '../apps/sentinelia-runtime/src/federacion/GestorSesionEmisionFederacionRuntime.js';
import { SuscriptorSenalesFederacionRedis } from '../apps/sentinelia-runtime/src/federacion/SuscriptorSenalesFederacionRedis.js';
import { generarUuidV7Auditoria } from '../paquetes/auditoria/src/UuidV7Auditoria.js';
import { AdaptadorCapturaTransaccionalFederacionSql } from '../paquetes/federacion/adaptadores/AdaptadorCapturaTransaccionalFederacionSql.js';
import { FuenteEntropiaCriptograficaNode } from '../paquetes/federacion/adaptadores/FuenteEntropiaCriptograficaNode.js';
import { PublicadorDisponibilidadOutboxFederacionRedis } from '../paquetes/federacion/adaptadores/PublicadorDisponibilidadOutboxFederacionRedis.js';
import { RepositorioCoordinacionEmisionFederacionSql } from '../paquetes/federacion/adaptadores/RepositorioCoordinacionEmisionFederacionSql.js';
import { RepositorioFlujosFederacionSql } from '../paquetes/federacion/adaptadores/RepositorioFlujosFederacionSql.js';
import { RepositorioOcurrenciasFederacionSql } from '../paquetes/federacion/adaptadores/RepositorioOcurrenciasFederacionSql.js';
import { RepositorioOutboxFederacionSql } from '../paquetes/federacion/adaptadores/RepositorioOutboxFederacionSql.js';
import { crearCampoPresenteFederado } from '../paquetes/federacion/src/EnvolventeFederacion.js';
import { GeneradorIdentidadesFederadas, TIPOS_IDENTIDAD_FEDERADA } from '../paquetes/federacion/src/IdentidadFederada.js';
import { ClienteSql } from '../paquetes/persistencia-sql/src/ClienteSql.js';
import { EjecutorMigraciones } from '../paquetes/persistencia-sql/src/EjecutorMigraciones.js';
import { RepositorioMigraciones } from '../paquetes/persistencia-sql/src/RepositorioMigraciones.js';
import { ServicioConexionRedis } from '../paquetes/sesiones/src/ServicioConexionRedis.js';
import {
  obtenerConfiguracionAplicacion,
  obtenerRutaMigraciones
} from '../paquetes/utilidades/src/configuracion/obtenerConfiguracionAplicacion.js';

const generador = new GeneradorIdentidadesFederadas({
  fuenteEntropia: new FuenteEntropiaCriptograficaNode()
});
const USUARIO_SQL = '5221309';

await main();

async function main() {
  await verificarRegistroYFronteras();
  await verificarNuevaSesionTrasPerdidaRemotaRedis();
  await verificarSenalesRealesYConvergenciaSql();
  console.log(
    '[federacion] OK 5.22.13i: redis=senal_efimera ' +
    'despertar=inmediato invalidacion=referencial perdida=sql_converge'
  );
}

async function verificarNuevaSesionTrasPerdidaRemotaRedis() {
  const ids = crearIds();
  const tokens = [`sfop1_${'I'.repeat(64)}`, `sfop1_${'R'.repeat(64)}`];
  let ahora = Date.parse('2026-08-03T16:30:00.000Z');
  let logins = 0;
  let heartbeats = 0;
  const cliente = {
    async iniciarSesion({ solicitud }) {
      const indice = logins;
      logins += 1;
      return {
        ok: true,
        requestId: solicitud.loginRequestId,
        serverTimeUtc: new Date(ahora).toISOString(),
        sesion: {
          sessionId: generarUuidV7Auditoria(),
          token: tokens[indice],
          expiresInSeconds: 300,
          fencingToken: String(logins),
          versionRevocacion: '1'
        }
      };
    },
    async refrescarSesion() {
      throw new Error('La sesión no debe alcanzar su margen de refresh en este fixture.');
    },
    async registrarHeartbeat({ solicitud }) {
      heartbeats += 1;
      if (heartbeats === 1) {
        const error = new Error('El Redis receptor perdió la sesión operativa.');
        error.statusCode = 403;
        error.codigoRemoto = 'SESION_FEDERADA_NO_VIVA';
        throw error;
      }
      return {
        ok: true,
        heartbeatRequestId: solicitud.heartbeatRequestId,
        seq: solicitud.seq,
        presenciaTtlSeconds: 90,
        relacion: {
          relacionId: solicitud.relacionId,
          estado: 'vinculada',
          compatibilidad: 'compatible',
          temporal: {
            estado: 'pendiente',
            desfaseEstimadoMs: null,
            rttEstimadoMs: null,
            toleranciaTemporalMs: 5000
          }
        },
        muestraTemporal: {
          muestraId: generarUuidV7Auditoria(),
          clienteEnviaEnUtc: solicitud.clienteEnviaEnUtc,
          servidorRecibeEnUtc: new Date(ahora).toISOString(),
          servidorEnviaEnUtc: new Date(ahora).toISOString()
        }
      };
    }
  };
  const gestorSesiones = new GestorSesionEmisionFederacionRuntime({
    repositorioDestinos: {
      async obtenerAprobadoOperativo() {
        return {
          relacionId: ids.relacionId,
          installationRemotaId: ids.installationRemotaId,
          endpoint: 'https://receptor.example'
        };
      }
    },
    clienteHttp: cliente,
    custodiaSecretoEmision: {
      async obtenerParaLoginTecnico() { return `sfr1_${'S'.repeat(64)}`; }
    },
    installationLocalId: ids.installationLocalId,
    bootLocalId: ids.bootId,
    reloj: () => ahora
  });
  const emisor = new EmisorHeartbeatFederacionRuntime({
    repositorioDestinos: {
      async listarVinculadosAutenticables() { return [{ relacionId: ids.relacionId }]; }
    },
    gestorSesiones,
    servicioCliente: cliente,
    repositorioSalud: {
      async registrarHeartbeatEmisor() {}
    },
    bootLocalId: ids.bootId,
    reloj: () => new Date(ahora)
  });
  assert.equal((await emisor.ejecutar({ silencioRelacionMs: 120000 })).totalFallidas, 1);
  ahora += 40_000;
  assert.equal((await emisor.ejecutar({ silencioRelacionMs: 120000 })).totalExitosas, 1);
  assert.equal(logins, 2, 'El rechazo remoto debe forzar un login técnico nuevo.');
}

async function verificarRegistroYFronteras() {
  const [coordinacion, publicador, suscriptor] = await Promise.all([
    leer('../paquetes/federacion/adaptadores/RepositorioCoordinacionEmisionFederacionSql.js'),
    leer('../paquetes/federacion/adaptadores/PublicadorDisponibilidadOutboxFederacionRedis.js'),
    leer('../apps/sentinelia-runtime/src/federacion/SuscriptorSenalesFederacionRedis.js')
  ]);
  assert.doesNotMatch(coordinacion, /redis|publish|subscribe/iu);
  assert.doesNotMatch(publicador, /ocurrencia|payload|contenido|cursor/iu);
  assert.match(suscriptor, /totalIgnoradas/u);
  assert.match(suscriptor, /clavesExactas/u);
  assert.match(suscriptor, /redis_despertar|despertar/u);
}

async function verificarSenalesRealesYConvergenciaSql() {
  const configuracion = obtenerConfiguracionAplicacion();
  assert.equal(configuracion.sql.estaCompleta, true);
  const baseDatos = `sentinelia_fixture_52213i_${randomBytes(6).toString('hex')}`;
  const administrador = new ClienteSql(configuracion.sql);
  await administrador.ejecutar(
    `CREATE DATABASE ${administrador.escaparIdentificador(baseDatos)} ` +
    'CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci'
  );
  const sql = new ClienteSql({ ...configuracion.sql, baseDatos });
  await new EjecutorMigraciones({
    clienteSql: sql,
    repositorioMigraciones: new RepositorioMigraciones(sql),
    rutaMigraciones: obtenerRutaMigraciones()
  }).ejecutarPendientes();
  const conexionRedis = new ServicioConexionRedis(configuracion.redis);
  const redis = await conexionRedis.conectar();
  const ids = crearIds();
  const sufijo = ids.relacionId.split('.').at(-1);
  const prefijo = `sentinelia:fixture:52213i:${sufijo}`;
  const canalDespertar = `${prefijo}:datos:disponibles:v1`;
  const canalInvalidaciones = `${prefijo}:invalidaciones:v1`;
  const despertares = [];
  const invalidaciones = [];
  const suscriptor = new SuscriptorSenalesFederacionRedis({
    clienteRedis: redis,
    canalDespertar,
    canalInvalidaciones,
    onDespertar: async (senal) => { despertares.push(senal); },
    onInvalidacion: async (senal) => { invalidaciones.push(senal); }
  });
  try {
    await limpiarSql(sql, ids);
    await borrarPrefijoRedis(redis, prefijo);
    await crearTrabajoSql(sql, ids);
    await suscriptor.arrancar();
    const publicador = new PublicadorDisponibilidadOutboxFederacionRedis({
      clienteRedis: redis,
      canal: canalDespertar,
      reloj: () => new Date('2026-08-03T16:00:00.000Z')
    });
    const publicacion = await publicador.publicar({
      posiciones: [{
        flujoId: ids.flujoId,
        generacionId: ids.generacionId,
        posicionFlujo: '1'
      }]
    });
    assert.deepEqual(Object.keys(publicacion.mensaje).sort(), [
      'perfil', 'prefijos', 'publicadoEnUtc', 'version'
    ]);
    await esperar(() => despertares.length === 1);
    assert.equal(despertares[0].prefijos[0].flujoId, ids.flujoId);

    await redis.publish(canalInvalidaciones, JSON.stringify({
      perfil: 'sentinelia-federacion-invalidacion-v1',
      version: 1,
      recursoTipo: 'flujo',
      recursoId: ids.flujoId,
      revision: '2',
      publicadoEnUtc: '2026-08-03T16:00:01.000Z'
    }));
    await esperar(() => invalidaciones.length === 1);
    await redis.publish(canalInvalidaciones, JSON.stringify({
      perfil: 'sentinelia-federacion-invalidacion-v1',
      version: 1,
      recursoTipo: 'flujo',
      recursoId: ids.flujoId,
      revision: '3',
      publicadoEnUtc: '2026-08-03T16:00:02.000Z',
      contenido: { prohibido: true }
    }));
    await esperar(() => suscriptor.serializarResumen().totalIgnoradas === 1);
    assert.equal(invalidaciones.length, 1);

    await redis.set(`${prefijo}:presencia:fixture`, 'efimera', { EX: 60 });
    await redis.set(`${prefijo}:invalidacion:fixture`, 'efimera', { EX: 60 });
    const antes = await fotografiarSql(sql, ids);
    await borrarPrefijoRedis(redis, prefijo);
    assert.equal((await clavesPrefijo(redis, prefijo)).length, 0);
    assert.deepEqual(await fotografiarSql(sql, ids), antes);

    const repositorio = new RepositorioCoordinacionEmisionFederacionSql(sql);
    const procesados = [];
    const coordinador = new CoordinadorEmisionFederacionRuntime({
      repositorioCoordinacion: repositorio,
      instanciaId: 'runtime-fixture-13i',
      concurrencia: 1,
      procesarFlujo: async ({ flujo }) => { procesados.push(flujo.flujoId); }
    });
    const recuperacion = await coordinador.procesarPendientes({
      origen: 'sondeo_sql_sin_redis',
      numeroTick: null
    });
    assert.equal(recuperacion.totalCompletados, 1);
    assert.deepEqual(procesados, [ids.flujoId]);
    assert.deepEqual(await fotografiarSql(sql, ids), antes);
  } finally {
    await suscriptor.detener().catch(() => {});
    await borrarPrefijoRedis(redis, prefijo).catch(() => {});
    await limpiarSql(sql, ids).catch(() => {});
    await conexionRedis.cerrar();
    await sql.cerrar();
    await administrador.ejecutar(
      `DROP DATABASE IF EXISTS ${administrador.escaparIdentificador(baseDatos)}`
    ).catch(() => {});
    await administrador.cerrar();
  }
}

async function crearTrabajoSql(sql, ids) {
  await sql.ejecutar(
    `INSERT INTO relaciones_federacion (
       relacion_id,direccion,estado_ciclo,estado_autoridad,estado_identidad,
       estado_compatibilidad,installation_remota_candidata_id,
       installation_remota_id,nombre_remoto_declarado,responsable_usuario_id,
       responsable_original_usuario_id,scope_tenant_id,scope_empresa_id,
       scope_sitio_id,version_autoridad,corte_autoridad_utc,
       creada_por_usuario_id,creada_en_utc,actualizada_en_utc,revision
     ) VALUES (?,'emision','vinculada','autorizada','valida','compatible',?,?,
       'fixture 5.22.13i',?,?,NULL,NULL,NULL,1,NULL,?,UTC_TIMESTAMP(3),UTC_TIMESTAMP(3),1)`,
    [ids.relacionId, ids.installationRemotaId, ids.installationRemotaId,
      USUARIO_SQL, USUARIO_SQL, USUARIO_SQL]
  );
  const repositorioFlujos = new RepositorioFlujosFederacionSql(sql, {
    installationLocalId: ids.installationLocalId
  });
  const preparado = await repositorioFlujos.crearFlujoInicial({
    flujo: {
      flujoId: ids.flujoId,
      relacionId: ids.relacionId,
      direccion: 'emision',
      familia: 'monitores',
      versionFamilia: 1,
      contexto: { nivel: 'portal' }
    },
    generacion: {
      generacionId: ids.generacionId,
      clase: 'inicial',
      fronteraInicial: '0',
      propietario: {
        installationId: ids.installationLocalId,
        bootId: ids.bootId,
        version: 1
      }
    }
  });
  await repositorioFlujos.avanzarGeneracion({
    flujoId: ids.flujoId,
    propietario: preparado.generacion.propietario,
    versionEstadoEsperada: preparado.generacion.versionEstado,
    versionFronteraEsperada: preparado.generacion.frontera.version,
    estadoGeneracion: 'transfiriendo',
    estadoFlujo: 'sincronizando',
    frontera: {
      posicionOperativa: null, posicionHistorica: null, sincronizando: true,
      operativamenteCompleta: false, historicamenteCompleta: false,
      parcialPorScope: false, degradada: false
    }
  });
  const captura = new AdaptadorCapturaTransaccionalFederacionSql({
    repositorioOcurrencias: new RepositorioOcurrenciasFederacionSql(sql, {
      installationLocalId: ids.installationLocalId
    }),
    repositorioOutbox: new RepositorioOutboxFederacionSql(sql)
  });
  const conexion = await sql.obtenerConexion();
  try {
    await conexion.beginTransaction();
    await captura.capturarEnTransaccion({
      definicion: {
        familia: 'monitores',
        familiaVersion: 1,
        installationOrigenId: ids.installationLocal,
        elementoOrigenId: ids.elemento,
        ocurrenciaOrigenId: ids.ocurrencia,
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
      },
      destinos: [{ flujoId: ids.flujoId, generacionId: ids.generacionId }]
    }, { conexion });
    await conexion.commit();
  } catch (error) {
    await conexion.rollback();
    throw error;
  } finally {
    conexion.release();
  }
}

async function fotografiarSql(sql, ids) {
  const [filas] = await sql.consultar(
    `SELECT
       (SELECT COUNT(*) FROM ocurrencias_federacion
         WHERE installation_origen_id=?) AS ocurrencias,
       (SELECT COUNT(*) FROM outbox_federacion
         WHERE flujo_id=? AND generacion_id=?) AS outbox,
       (SELECT COUNT(*) FROM flujos_federacion WHERE flujo_id=?) AS flujos`,
    [ids.installationLocalId, ids.flujoId, ids.generacionId, ids.flujoId]
  );
  return {
    ocurrencias: Number(filas.ocurrencias),
    outbox: Number(filas.outbox),
    flujos: Number(filas.flujos)
  };
}

async function limpiarSql(sql, ids) {
  await sql.ejecutar('DELETE FROM control_generaciones_emision_federacion WHERE generacion_id=?', [ids.generacionId]).catch(() => {});
  await sql.ejecutar('DELETE FROM outbox_federacion WHERE flujo_id=?', [ids.flujoId]).catch(() => {});
  await sql.ejecutar('DELETE FROM posiciones_ocurrencias_flujos_federacion WHERE flujo_id=?', [ids.flujoId]).catch(() => {});
  await sql.ejecutar('DELETE FROM contadores_posiciones_generaciones_federacion WHERE flujo_id=?', [ids.flujoId]).catch(() => {});
  await sql.ejecutar('DELETE FROM propietarios_emision_flujos_federacion WHERE flujo_id=?', [ids.flujoId]).catch(() => {});
  await sql.ejecutar('UPDATE flujos_federacion SET generacion_activa_id=NULL WHERE flujo_id=?', [ids.flujoId]).catch(() => {});
  await sql.ejecutar('DELETE FROM fronteras_generaciones_federacion WHERE generacion_id=?', [ids.generacionId]).catch(() => {});
  await sql.ejecutar('DELETE FROM generaciones_flujos_federacion WHERE flujo_id=?', [ids.flujoId]).catch(() => {});
  await sql.ejecutar('DELETE FROM flujos_federacion WHERE flujo_id=?', [ids.flujoId]).catch(() => {});
  await sql.ejecutar('DELETE FROM relaciones_federacion WHERE relacion_id=?', [ids.relacionId]).catch(() => {});
  await sql.ejecutar('DELETE FROM ocurrencias_federacion WHERE installation_origen_id=?', [ids.installationLocalId]).catch(() => {});
  await sql.ejecutar('DELETE FROM reservas_identidad_ocurrencias_federacion WHERE installation_origen_id=?', [ids.installationLocalId]).catch(() => {});
  await sql.ejecutar('DELETE FROM contadores_secuencia_elementos_federacion WHERE installation_origen_id=?', [ids.installationLocalId]).catch(() => {});
}

async function borrarPrefijoRedis(redis, prefijo) {
  const claves = await clavesPrefijo(redis, prefijo);
  if (claves.length > 0) await redis.del(claves);
}

async function clavesPrefijo(redis, prefijo) {
  const claves = [];
  for await (const clave of redis.scanIterator({ MATCH: `${prefijo}:*`, COUNT: 100 })) {
    claves.push(clave);
  }
  return claves;
}

async function esperar(condicion, timeoutMs = 2000) {
  const limite = Date.now() + timeoutMs;
  while (!condicion()) {
    if (Date.now() >= limite) throw new Error('Timeout esperando señal Redis fixture.');
    await new Promise((resolver) => setTimeout(resolver, 10));
  }
}

function crearIds() {
  const id = (tipo) => String(generador.generar(tipo));
  const installationLocal = generador.generar(TIPOS_IDENTIDAD_FEDERADA.INSTALACION);
  const elemento = generador.generar(TIPOS_IDENTIDAD_FEDERADA.ELEMENTO_ORIGEN);
  const ocurrencia = generador.generar(TIPOS_IDENTIDAD_FEDERADA.OCURRENCIA_ORIGEN);
  return {
    installationLocal,
    installationLocalId: String(installationLocal),
    installationRemotaId: id(TIPOS_IDENTIDAD_FEDERADA.INSTALACION),
    bootId: id(TIPOS_IDENTIDAD_FEDERADA.ARRANQUE),
    relacionId: id(TIPOS_IDENTIDAD_FEDERADA.RELACION),
    flujoId: id(TIPOS_IDENTIDAD_FEDERADA.FLUJO),
    generacionId: id(TIPOS_IDENTIDAD_FEDERADA.GENERACION),
    elemento,
    ocurrencia
  };
}

function leer(ruta) {
  return readFile(new URL(ruta, import.meta.url), 'utf8');
}

import assert from 'node:assert/strict';
import { execFile, spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import net from 'node:net';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

import mysql from 'mysql2/promise';
import { createClient } from 'redis';

import { ClienteSql } from '../paquetes/persistencia-sql/src/ClienteSql.js';
import { EjecutorMigraciones } from '../paquetes/persistencia-sql/src/EjecutorMigraciones.js';
import { RepositorioMigraciones } from '../paquetes/persistencia-sql/src/RepositorioMigraciones.js';
import {
  obtenerConfiguracionAplicacion,
  obtenerRutaMigraciones
} from '../paquetes/utilidades/src/configuracion/obtenerConfiguracionAplicacion.js';
import {
  formatearDiagnosticoSeguroProceso
} from './lib/DiagnosticoSeguroProcesos.js';

const ejecutarArchivo = promisify(execFile);
const raizProyecto = fileURLToPath(new URL('../', import.meta.url));
const PREFIJO_BASE = 'sentinelia_gate_52220f_';
const PRUEBAS_OBLIGATORIAS = Object.freeze([
  'composeProductivoValido', 'webProductivaArrancada', 'saludWebOperativa',
  'portalFederacionDefinitivo', 'portalFederacionAutenticadoVerificado',
  'planoDatosAutenticadoActivo', 'planoDatosBearerVerificado',
  'diagnosticoDespliegueValido',
  'runtimeProductivoArrancado', 'runtimeTickEjecutado',
  'identidadDurableCompartida', 'apagadoRuntimeLimpio',
  'recursosEfimerosAislados'
]);
const GATES_PROVISIONALES = Object.freeze([
  Object.freeze({
    id: '5.22.11i-representacion-provisional-relaciones',
    reemplazo: '5.22.18-portal-federacion-productivo',
    pruebas: Object.freeze([
      'webProductivaArrancada', 'saludWebOperativa', 'portalFederacionDefinitivo',
      'portalFederacionAutenticadoVerificado', 'identidadDurableCompartida'
    ])
  }),
  Object.freeze({
    id: '5.22.13b-plano-datos-503-temporal',
    reemplazo: '5.22.13c-plano-datos-autenticado',
    pruebas: Object.freeze([
      'webProductivaArrancada', 'planoDatosAutenticadoActivo',
      'planoDatosBearerVerificado', 'diagnosticoDespliegueValido'
    ])
  })
]);

await main();

async function main() {
  const configuracion = obtenerConfiguracionAplicacion();
  assert.equal(configuracion.sql.estaCompleta, true,
    '5.22.20f requiere SQL configurado para su entorno desechable.');
  const sufijo = `${process.pid}_${randomBytes(6).toString('hex')}`;
  const baseDatos = `${PREFIJO_BASE}${sufijo}`;
  const prefijoRedis = `sentinelia:gate:52220f:${sufijo}:`;
  const puerto = await obtenerPuertoLibre();
  const evidencias = Object.fromEntries(
    PRUEBAS_OBLIGATORIAS.map((nombre) => [nombre, false])
  );
  let administrativa;
  let sql;
  let redis;
  let web;
  let runtime;

  assert.throws(
    () => resolverRetiradaGates({ ...evidencias, composeProductivoValido: true }),
    /matriz obligatoria incompleta/u
  );

  try {
    administrativa = await crearConexionAdministrativa(configuracion.sql);
    await administrativa.query(
      `CREATE DATABASE \`${baseDatos}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`
    );
    sql = new ClienteSql({ ...configuracion.sql, baseDatos });
    await new EjecutorMigraciones({
      clienteSql: sql,
      repositorioMigraciones: new RepositorioMigraciones(sql),
      rutaMigraciones: obtenerRutaMigraciones()
    }).ejecutarPendientes();

    const entorno = construirEntorno({ baseDatos, prefijoRedis, puerto, sufijo });
    redis = createClient({ url: configuracion.redis.url });
    redis.on('error', () => {});
    await redis.connect();
    await verificarComposeProductivo(entorno);
    evidencias.composeProductivoValido = true;

    runtime = arrancarProceso('runtime', 'apps/sentinelia-runtime/src/index.js', entorno);
    await esperarSalida(runtime, /\[sentinelia-runtime\] instancia .* arrancada\./u, 120_000);
    evidencias.runtimeProductivoArrancado = true;
    await esperarSalida(runtime, /Scheduler activo\.|Tick [0-9]+/u, 60_000);
    evidencias.runtimeTickEjecutado = true;

    web = arrancarProceso('web', 'apps/sentinelia-web/src/index.js', entorno);
    await esperarSalida(web, /\[sentinelia-web\] escuchando en puerto/u, 120_000);
    evidencias.webProductivaArrancada = true;

    const salud = await solicitarJson(`http://127.0.0.1:${puerto}/salud`);
    assert.equal(salud.estado, 200);
    assert.equal(salud.json.estado, 'ok');
    assert.equal(salud.json.entorno, 'production');
    assert.equal(salud.json.sqlConfigurado, true);
    assert.equal(salud.json.redis, 'PONG');
    assert.equal(salud.json.sqlUsoHorarioUtc?.diferenciaSegundos, 0);
    evidencias.saludWebOperativa = true;

    const portalFederacion = await fetch(`http://127.0.0.1:${puerto}/federacion`, {
      redirect: 'manual'
    });
    assert.equal(portalFederacion.status, 302);
    assert.match(portalFederacion.headers.get('location') || '', /^\/login/u);
    const vistaFederacion = await readFile(
      new URL('../apps/sentinelia-web/src/views/portal/federacion.ejs', import.meta.url),
      'utf8'
    );
    assert.match(vistaFederacion, /panel\.permisos\.explorarDatosRemotos/u);
    assert.match(vistaFederacion, /credenciales operativas nunca se muestran/u);
    evidencias.portalFederacionDefinitivo = true;
    await ejecutarGarantia(
      'scripts/federacion-verificar-5-22-18b.js',
      /OK 5\.22\.18b/u,
      entorno
    );
    evidencias.portalFederacionAutenticadoVerificado = true;

    const datos = await solicitarJson(
      `http://127.0.0.1:${puerto}/api/federacion/v1/datos/capacidad`,
      { headers: {
        'x-forwarded-for': '198.51.100.20',
        'x-forwarded-host': 'sentinelia-smoke.invalid',
        'x-forwarded-proto': 'https',
        accept: 'application/problem+json'
      } }
    );
    assert.equal(datos.estado, 401);
    assert.equal(datos.json.codigo, 'BEARER_FEDERADO_REQUERIDO');
    assert.notEqual(datos.json.codigo, 'PLANO_DATOS_FEDERACION_NO_DISPONIBLE');
    evidencias.planoDatosAutenticadoActivo = true;
    await ejecutarGarantia(
      'scripts/federacion-verificar-5-22-13c.js',
      /OK 5\.22\.13c/u,
      entorno
    );
    evidencias.planoDatosBearerVerificado = true;

    const diagnostico = await ejecutarArchivo(
      process.execPath,
      ['scripts/federacion-diagnosticar-despliegue.js'],
      { cwd: raizProyecto, env: entorno, timeout: 45_000, maxBuffer: 1024 * 1024 }
    );
    assert.match(diagnostico.stdout, /DIAGNOSTICO_DESPLIEGUE_OK/u);
    assert.match(diagnostico.stdout, /"federacionActiva":true/u);
    assert.match(diagnostico.stdout, /"proxiesConfiables":1/u);
    evidencias.diagnosticoDespliegueValido = true;

    const identidad = await sql.consultar(
      `SELECT i.installation_id, COUNT(a.id) AS total_arranques
         FROM identidad_instalacion_federacion i
         JOIN arranques_instalacion_federacion a
           ON a.installation_id=i.installation_id
        WHERE i.id=1 GROUP BY i.installation_id`
    );
    assert.equal(identidad.length, 1);
    assert.match(identidad[0].installation_id, /^sfid1\.instalacion\./u);
    assert.ok(Number(identidad[0].total_arranques) >= 1,
      'Web y runtime deben compartir una installationId con arranque lógico durable.');
    evidencias.identidadDurableCompartida = true;

    runtime.proceso.kill('SIGTERM');
    const cierreRuntime = await esperarCierre(runtime.proceso, 20_000);
    assert.equal(cierreRuntime.codigo, 0);
    assert.match(runtime.salida(), /detenida correctamente/u);
    runtime = null;
    evidencias.apagadoRuntimeLimpio = true;

    verificarAislamientoRedis(entorno, prefijoRedis);
    evidencias.recursosEfimerosAislados = true;

    const retirados = resolverRetiradaGates(evidencias);
    assert.deepEqual(retirados.map((gate) => gate.id),
      GATES_PROVISIONALES.map((gate) => gate.id));
    console.log(
      '[federacion] OK 5.22.20f: smoke=production web=ok runtime=ok ' +
      'sql=efimero redis=aislado plano_datos=autenticado diagnostico=ok ' +
      `matriz=${PRUEBAS_OBLIGATORIAS.length}/${PRUEBAS_OBLIGATORIAS.length} ` +
      `gates_retirados=${retirados.length}`
    );
  } finally {
    await limpiarRecursos({
      runtime: runtime?.proceso,
      web: web?.proceso,
      redis,
      prefijoRedis,
      sql,
      administrativa,
      baseDatos
    });
  }
}

async function limpiarRecursos({
  runtime, web, redis, prefijoRedis, sql, administrativa, baseDatos
}) {
  const errores = [];
  for (const operacion of [
    () => detenerSiSigueVivo(runtime, true),
    () => detenerSiSigueVivo(web, false),
    () => limpiarRedis(redis, prefijoRedis),
    () => redis?.isOpen ? redis.quit() : Promise.resolve(),
    () => sql?.cerrar(),
    () => administrativa?.query(`DROP DATABASE IF EXISTS \`${baseDatos}\``),
    () => administrativa?.end()
  ]) {
    try {
      await operacion();
    } catch (error) {
      errores.push(error);
    }
  }
  if (errores.length > 0) {
    throw new AggregateError(
      errores,
      '5.22.20f no pudo retirar todos sus recursos efímeros.'
    );
  }
}

function verificarAislamientoRedis(entorno, prefijoRedis) {
  const nombres = [
    'RUNTIME_REDIS_PREFIJO', 'REDIS_PREFIJO_SESIONES',
    'REDIS_PREFIJO_PREAUTENTICACIONES', 'REDIS_PREFIJO_SESIONES_WEB_DURABLES',
    'REDIS_CANAL_INVALIDACIONES_SESIONES_WEB', 'REDIS_PREFIJO_SESIONES_AGENTES',
    'REDIS_PREFIJO_VERSION_USUARIO', 'REDIS_CLAVE_VERSION_CONFIGURACION_PORTAL',
    'REDIS_CLAVE_VERSION_RUNTIME_MONITORES',
    'REDIS_CLAVE_VERSION_CATALOGO_MONITORES', 'REDIS_CLAVE_VERSION_DNS',
    'REDIS_PREFIJO_BLOQUEO_CORREO',
    'REDIS_PREFIJO_VERIFICACION_CORREO_OPERATIVO',
    'REDIS_PREFIJO_AUTORIZACION_PERFIL',
    'REDIS_PREFIJO_OPERACIONES_EMAIL_PERFIL', 'REDIS_PREFIJO_FEDERACION',
    'POW_REDIS_PREFIJO'
  ];
  for (const nombre of nombres) {
    assert.ok(String(entorno[nombre]).startsWith(prefijoRedis),
      `${nombre} debe pertenecer al espacio Redis efímero del smoke.`);
  }
}

function resolverRetiradaGates(evidencias) {
  const ausentes = PRUEBAS_OBLIGATORIAS.filter((nombre) => evidencias[nombre] !== true);
  if (ausentes.length > 0) {
    throw new Error(`No se pueden retirar gates: matriz obligatoria incompleta (${ausentes.join(',')}).`);
  }
  for (const gate of GATES_PROVISIONALES) {
    assert.ok(gate.pruebas.every((prueba) => evidencias[prueba] === true));
  }
  return GATES_PROVISIONALES;
}

function construirEntorno({ baseDatos, prefijoRedis, puerto, sufijo }) {
  const clave = randomBytes(32).toString('base64');
  const keyring = JSON.stringify({ 'smoke-20f': clave });
  const prefijo = (nombre) => `${prefijoRedis}${nombre}`;
  return {
    ...process.env,
    NODE_ENV: 'production', PUERTO_WEB: String(puerto),
    SQL_BASE_DATOS: baseDatos, SQL_BOOTSTRAP_MIGRACIONES: 'true',
    USUARIO_ADMIN_INICIAL: `smoke_${sufijo}`,
    PASSWORD_ADMIN_INICIAL: `Smoke-${randomBytes(18).toString('base64url')}!`,
    EMAIL_ADMIN_INICIAL: `smoke-${sufijo}@example.invalid`,
    NOMBRE_ADMIN_INICIAL: 'Smoke 5.22.20f',
    SESION_SECRETO: randomBytes(48).toString('base64url'),
    SESION_COOKIE_NOMBRE: `sentinelia.52220f.${sufijo}`,
    AGENTES_SESION_KEYRING: keyring,
    AGENTES_SESION_KEY_ID_ACTIVA: 'smoke-20f',
    CORREO_KEYRING: keyring,
    CORREO_KEY_ID_ACTIVA: 'smoke-20f',
    FEDERACION_ACTIVA: 'true', FEDERACION_KEYRING: keyring,
    FEDERACION_KEY_ID_ACTIVA: 'smoke-20f',
    FEDERACION_KEYRING_REFERENCIA: `smoke/5.22.20f/${sufijo}`,
    PORTAL_ORIGEN_PUBLICO: 'https://sentinelia-smoke.invalid',
    PORTAL_PROXIES_REVERSOS_CONFIABLES: '127.0.0.1/32',
    DNS_ACTIVO: 'false', CORREO_ACTIVO: 'false', POW_ACTIVO: 'false',
    RUNTIME_INSTANCIA_ID: `smoke-52220f-${sufijo}`,
    RUNTIME_SCHEDULER_TICK_MS: '250', RUNTIME_LATIDO_INTERVALO_MS: '250',
    RUNTIME_APAGADO_TIMEOUT_MS: '10000',
    RUNTIME_REDIS_PREFIJO: prefijo('runtime:'),
    REDIS_PREFIJO_SESIONES: prefijo('sesiones:'),
    REDIS_PREFIJO_PREAUTENTICACIONES: prefijo('preauth:'),
    REDIS_PREFIJO_SESIONES_WEB_DURABLES: prefijo('sesiones-web:'),
    REDIS_CANAL_INVALIDACIONES_SESIONES_WEB: prefijo('canal-sesiones'),
    REDIS_PREFIJO_SESIONES_AGENTES: prefijo('sesiones-agentes:'),
    REDIS_PREFIJO_VERSION_USUARIO: prefijo('version-usuario:'),
    REDIS_CLAVE_VERSION_CONFIGURACION_PORTAL: prefijo('config-version'),
    REDIS_CLAVE_VERSION_RUNTIME_MONITORES: prefijo('runtime-monitores-version'),
    REDIS_CLAVE_VERSION_CATALOGO_MONITORES: prefijo('catalogo-monitores-version'),
    REDIS_CLAVE_VERSION_DNS: prefijo('dns-version'),
    REDIS_PREFIJO_BLOQUEO_CORREO: prefijo('correo-bloqueo:'),
    REDIS_PREFIJO_VERIFICACION_CORREO_OPERATIVO: prefijo('correo-operativo:'),
    REDIS_PREFIJO_AUTORIZACION_PERFIL: prefijo('perfil-autorizacion:'),
    REDIS_PREFIJO_OPERACIONES_EMAIL_PERFIL: prefijo('perfil-email:'),
    REDIS_PREFIJO_FEDERACION: prefijo('federacion'),
    POW_REDIS_PREFIJO: prefijo('pow:')
  };
}

async function verificarComposeProductivo(entorno) {
  await ejecutarArchivo('docker', [
    'compose', '-f', 'despliegue/docker/node-bind/docker-compose.productivo.yml',
    'config', '--quiet'
  ], { cwd: raizProyecto, env: entorno, timeout: 30_000, maxBuffer: 1024 * 1024 });
}

async function ejecutarGarantia(archivo, marcador, entorno) {
  try {
    const { stdout = '', stderr = '' } = await ejecutarArchivo(
      process.execPath,
      [archivo],
      {
        cwd: raizProyecto,
        env: entorno,
        encoding: 'utf8',
        timeout: 1_800_000,
        maxBuffer: 64 * 1024 * 1024,
        windowsHide: true
      }
    );
    assert.match(stdout, marcador);
    assert.equal(stderr.trim(), '');
  } catch (error) {
    console.error(
      `[federacion] FALLO garantía smoke: ${formatearDiagnosticoSeguroProceso(error)}`
    );
    throw new Error('Una garantía autenticada requerida por el smoke falló.');
  }
}

function arrancarProceso(nombre, ruta, entorno) {
  const proceso = spawn(process.execPath, [ruta], {
    cwd: raizProyecto, env: entorno, stdio: ['ignore', 'pipe', 'pipe']
  });
  let texto = '';
  for (const canal of [proceso.stdout, proceso.stderr]) {
    canal.setEncoding('utf8');
    canal.on('data', (fragmento) => { texto = `${texto}${fragmento}`.slice(-200_000); });
  }
  return { nombre, proceso, salida: () => texto };
}

async function esperarSalida(descriptor, patron, timeoutMs) {
  await esperarCondicion(() => {
    if (descriptor.proceso.exitCode != null || descriptor.proceso.signalCode != null) {
      throw new Error(`${descriptor.nombre} terminó prematuramente:\n${descriptor.salida()}`);
    }
    return patron.test(descriptor.salida());
  }, timeoutMs, () => `${descriptor.nombre} no produjo ${patron}:\n${descriptor.salida()}`);
}

async function solicitarJson(url, opciones = {}) {
  const respuesta = await fetch(url, opciones);
  const texto = await respuesta.text();
  let json;
  try { json = JSON.parse(texto); } catch { json = { texto }; }
  return { estado: respuesta.status, json };
}

async function obtenerPuertoLibre() {
  const servidor = net.createServer();
  await new Promise((resolve, reject) => {
    servidor.once('error', reject);
    servidor.listen(0, '127.0.0.1', resolve);
  });
  const puerto = servidor.address().port;
  await new Promise((resolve, reject) => servidor.close((error) =>
    error ? reject(error) : resolve()));
  return puerto;
}

function crearConexionAdministrativa(sql) {
  return mysql.createConnection({
    host: sql.host, port: sql.puerto, user: sql.usuario,
    password: sql.password, timezone: 'Z'
  });
}

async function detenerSiSigueVivo(proceso, exigirCodigoCero) {
  if (!proceso || proceso.exitCode != null || proceso.signalCode != null) return;
  proceso.kill('SIGTERM');
  let cierre = await esperarCierre(proceso, 15_000).catch(() => null);
  if (!cierre) {
    proceso.kill('SIGKILL');
    cierre = await esperarCierre(proceso, 5_000);
  }
  if (exigirCodigoCero && cierre) assert.equal(cierre.codigo, 0);
}

function esperarCierre(proceso, timeoutMs) {
  if (proceso.exitCode != null || proceso.signalCode != null) {
    return Promise.resolve({ codigo: proceso.exitCode, senal: proceso.signalCode });
  }
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('Timeout al detener proceso.')), timeoutMs);
    proceso.once('exit', (codigo, senal) => {
      clearTimeout(timeout);
      resolve({ codigo, senal });
    });
  });
}

async function limpiarRedis(redis, prefijo) {
  if (!redis?.isOpen) return;
  for (let pasada = 0; pasada < 3; pasada += 1) {
    const claves = [];
    for await (const clave of redis.scanIterator({ MATCH: `${prefijo}*`, COUNT: 100 })) {
      claves.push(clave);
      if (claves.length === 100) await redis.unlink(claves.splice(0));
    }
    if (claves.length > 0) await redis.unlink(claves);
    const restantes = [];
    for await (const clave of redis.scanIterator({ MATCH: `${prefijo}*`, COUNT: 100 })) {
      restantes.push(clave);
    }
    if (restantes.length === 0) return;
  }
  throw new Error('La limpieza Redis dejó claves dentro del namespace del smoke.');
}

async function esperarCondicion(condicion, timeoutMs, mensaje) {
  const limite = Date.now() + timeoutMs;
  while (Date.now() < limite) {
    if (await condicion()) return;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(mensaje());
}

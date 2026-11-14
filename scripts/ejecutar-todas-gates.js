import { execFile, spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { chown, mkdir, mkdtemp, open, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { setTimeout as esperar } from 'node:timers/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { descubrirGates, ejecutarProcesoGate } from './soporte/ejecutor-gates.js';

const ejecutarArchivo = promisify(execFile);
const raiz = fileURLToPath(new URL('..', import.meta.url));
const paquete = JSON.parse(await readFile(path.join(raiz, 'package.json'), 'utf8'));
const opciones = leerOpciones(process.argv.slice(2));
const gates = descubrirGates(paquete.scripts, opciones.solo);

if (opciones.ayuda) {
  console.log('Uso: npm run gates:todas -- [--listar] [--solo gate:a,gate:b] [--salida directorio] [--timeout segundos] [--parar-al-fallar]');
} else if (opciones.listar) {
  console.log(gates.join('\n'));
  console.log(`Total: ${gates.length} gates; orden de package.json.`);
} else {
  try {
    if (opciones.interno) await ejecutarBateria();
    else await ejecutarEnDocker();
  } catch (error) {
    console.error(`[gates] ${error.message}`);
    process.exitCode = 1;
  }
}

function leerOpciones(argumentos) {
  const resultado = { solo: [], timeout: 900, interno: false };
  for (let indice = 0; indice < argumentos.length; indice += 1) {
    const opcion = argumentos[indice];
    if (['--listar', '--parar-al-fallar', '--interno', '--ayuda'].includes(opcion)) {
      resultado[opcion === '--parar-al-fallar' ? 'parar' : opcion.slice(2)] = true;
    } else if (['--solo', '--salida', '--timeout'].includes(opcion)) {
      const valor = argumentos[++indice];
      if (!valor || valor.startsWith('--')) throw new Error(`Falta valor para ${opcion}.`);
      if (opcion === '--solo') {
        const seleccion = valor.split(',').map((nombre) => nombre.trim()).filter(Boolean);
        if (!seleccion.length) throw new Error('--solo necesita al menos un gate.');
        resultado.solo.push(...seleccion);
      } else if (opcion === '--timeout') {
        if (!/^[1-9][0-9]*$/u.test(valor) || !Number.isSafeInteger(Number(valor)) || Number(valor) * 1000 > 2147483647) {
          throw new Error('--timeout debe ser un número entero positivo de segundos.');
        }
        resultado.timeout = Number(valor);
      } else resultado.salida = path.resolve(valor);
    } else throw new Error(`Opción desconocida: ${opcion}`);
  }
  return resultado;
}

async function ejecutarEnDocker() {
  const { stdout } = await ejecutarArchivo('docker', ['inspect', 'sentinelia-app']);
  const [app] = JSON.parse(stdout);
  if (!app.State.Running) throw new Error('sentinelia-app debe estar en ejecución.');
  const red = Object.keys(app.NetworkSettings.Networks)[0];
  if (!red) throw new Error('La instancia no tiene una red Docker.');
  const entornoApp = Object.fromEntries(app.Config.Env.map((entrada) => {
    const separador = entrada.indexOf('=');
    return [entrada.slice(0, separador), entrada.slice(separador + 1)];
  }));
  const { stdout: informacion } = await ejecutarArchivo('docker', [
    'info', '--format', '{{json .ClientInfo.Plugins}}'
  ]);
  const compose = JSON.parse(informacion).find(({ Name }) => Name === 'compose');
  if (!compose?.Path) throw new Error('Se necesita el plugin Docker Compose.');
  const { stdout: rutaDocker } = await ejecutarArchivo('sh', ['-c', 'command -v docker']);
  const salida = opciones.salida || path.join(raiz, 'logs', 'gates', identificador());
  await mkdir(salida, { recursive: true, mode: 0o700 });
  if ((await readdir(salida)).length) throw new Error('El directorio de evidencias debe estar vacío.');
  const argumentos = [
    'run', '--rm', '--init', '--network', red,
    '--env-file', path.join(raiz, '.env'),
    '--env', 'SQL_HOST', '--env', 'SQL_PUERTO', '--env', 'REDIS_URL',
    '--env', `SENTINELIA_GATES_UID=${process.getuid()}`,
    '--env', `SENTINELIA_GATES_GID=${process.getgid()}`,
    '--mount', `type=bind,source=${raiz},target=/app,readonly`,
    '--mount', `type=bind,source=${salida},target=/evidencias`,
    '--mount', `type=bind,source=${rutaDocker.trim()},target=/usr/local/bin/docker,readonly`,
    '--mount', `type=bind,source=${compose.Path},target=/usr/local/lib/docker/cli-plugins/docker-compose,readonly`,
    '--workdir', '/app', '--entrypoint', 'node', app.Image,
    'scripts/ejecutar-todas-gates.js', '--interno', '--salida', '/evidencias',
    '--timeout', String(opciones.timeout)
  ];
  if (opciones.solo.length) argumentos.push('--solo', opciones.solo.join(','));
  if (opciones.parar) argumentos.push('--parar-al-fallar');
  console.log(`[gates] ${gates.length} gates en un contenedor temporal. Evidencias: ${salida}`);
  const hijo = spawn('docker', argumentos, {
    cwd: raiz, stdio: 'inherit', shell: false,
    env: { ...process.env, SQL_HOST: entornoApp.SQL_HOST,
      SQL_PUERTO: entornoApp.SQL_PUERTO, REDIS_URL: entornoApp.REDIS_URL }
  });
  const reenviar = () => hijo.kill('SIGINT');
  process.on('SIGINT', reenviar);
  process.on('SIGTERM', reenviar);
  try {
    process.exitCode = await new Promise((resolve, reject) => {
      hijo.once('error', reject);
      hijo.once('close', (codigo) => resolve(codigo ?? 1));
    });
  } finally {
    process.removeListener('SIGINT', reenviar);
    process.removeListener('SIGTERM', reenviar);
    console.log(`[gates] Resultados en ${path.join(salida, 'resumen.json')}`);
  }
}

async function ejecutarBateria() {
  const { ClienteSql } = await import('../paquetes/persistencia-sql/src/ClienteSql.js');
  const { EjecutorMigraciones } = await import('../paquetes/persistencia-sql/src/EjecutorMigraciones.js');
  const { RepositorioMigraciones } = await import('../paquetes/persistencia-sql/src/RepositorioMigraciones.js');
  const { FronteraTransaccionalLocal } = await import('../paquetes/persistencia-sql/src/FronteraTransaccionalLocal.js');
  const { BootstrapIdentidadInstalacionFederacion } = await import('../paquetes/federacion/aplicacion/BootstrapIdentidadInstalacionFederacion.js');
  const { RepositorioIdentidadFederacionSql } = await import('../paquetes/federacion/adaptadores/RepositorioIdentidadFederacionSql.js');
  const { FuenteEntropiaCriptograficaNode } = await import('../paquetes/federacion/adaptadores/FuenteEntropiaCriptograficaNode.js');
  const { GeneradorIdentidadesFederadas, TIPOS_IDENTIDAD_FEDERADA } = await import('../paquetes/federacion/src/index.js');
  const { obtenerConfiguracionAplicacion, obtenerRutaMigraciones } = await import('../paquetes/utilidades/src/configuracion/obtenerConfiguracionAplicacion.js');
  const { createClient } = await import('redis');
  const { parse } = await import('dotenv');
  const configuracion = obtenerConfiguracionAplicacion();
  if (!configuracion.sql.estaCompleta) throw new Error('La batería necesita SQL configurado.');
  const administrador = new ClienteSql(configuracion.sql);
  const redis = createClient({ url: configuracion.redis.url,
    socket: { connectTimeout: 3000, reconnectStrategy: false } });
  redis.on('error', () => {});
  const contrato = parse(await readFile(path.join(raiz, '.env.ejemplo')));
  const clavesRedis = Object.keys({ ...contrato, ...process.env }).filter((clave) =>
    /^REDIS_(?:PREFIJO|CLAVE|CANAL)_/u.test(clave) ||
    ['RUNTIME_REDIS_PREFIJO', 'POW_REDIS_PREFIJO'].includes(clave));
  const controlador = new AbortController();
  const cancelar = () => controlador.abort();
  process.on('SIGINT', cancelar);
  process.on('SIGTERM', cancelar);
  const id = identificador();
  const salida = opciones.salida || path.join(raiz, 'logs', 'gates', id);
  await mkdir(salida, { recursive: true, mode: 0o700 });
  const informe = { inicio: new Date().toISOString(), gates, timeoutSegundos: opciones.timeout,
    resultados: [], estado: 'en_curso' };
  const guardar = async () => {
    const destino = path.join(salida, 'resumen.json');
    await writeFile(destino + '.tmp', JSON.stringify(informe, null, 2) + '\n', { mode: 0o600 });
    await asignarPropietario(destino + '.tmp');
    await rename(destino + '.tmp', destino);
  };
  try {
    await guardar();
    await administrador.consultar('SELECT 1');
    await redis.connect();
    await redis.ping();
    for (const [indice, gate] of gates.entries()) {
      if (controlador.signal.aborted) break;
      const base = `sentinelia_suite_${id}_${indice}`;
      const prefijo = `sentinelia:suite:${id}:${indice}:`;
      const log = `${String(indice + 1).padStart(3, '0')}-${gate.replace(/[^a-zA-Z0-9_.-]/gu, '_')}.log`;
      const cliente = new ClienteSql({ ...configuracion.sql, baseDatos: base });
      let resultado;
      let bind;
      const inicio = Date.now();
      console.log(`[gates] ${indice + 1}/${gates.length} ${gate}`);
      const latido = setInterval(() => console.log(
        `[gates] En curso: ${gate} (${Math.round((Date.now() - inicio) / 1000)} s)`
      ), 30000);
      try {
        await administrador.ejecutar(`CREATE DATABASE ${administrador.escaparIdentificador(base)} CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
        const migracion = await new EjecutorMigraciones({ clienteSql: cliente,
          repositorioMigraciones: new RepositorioMigraciones(cliente),
          rutaMigraciones: obtenerRutaMigraciones() }).ejecutarPendientes();
        if (!migracion.integridad.ok) throw new Error('Integridad del fixture SQL no satisfecha.');
        const generador = new GeneradorIdentidadesFederadas({
          fuenteEntropia: new FuenteEntropiaCriptograficaNode()
        });
        await new BootstrapIdentidadInstalacionFederacion({
          fronteraTransaccional: new FronteraTransaccionalLocal(cliente),
          repositorioIdentidad: new RepositorioIdentidadFederacionSql(cliente),
          generadorIdentidades: generador
        }).asegurar({ bootId: generador.generar(TIPOS_IDENTIDAD_FEDERADA.ARRANQUE) });
        await cliente.cerrar();
        const env = { ...process.env, SQL_BASE_DATOS: base };
        for (const clave of clavesRedis) env[clave] = `${prefijo}${clave.toLowerCase()}:`;
        bind = await prepararBind(env, path.join(salida, log + '.bind'));
        resultado = await ejecutarProcesoGate({ comando: 'npm', argumentos: ['run', gate],
          cwd: raiz, env, log: path.join(salida, log),
          timeoutMs: opciones.timeout * 1000, signal: controlador.signal });
        if (resultado.estado === 'interrumpido') {
          await writeFile(path.join(salida, log), '\nEjecución cancelada.\n', { flag: 'a', mode: 0o600 });
        }
      } catch (error) {
        resultado = { estado: 'error', error: error.code || 'PREPARACION_FALLIDA',
          duracionMs: Date.now() - inicio };
        let diagnostico = String(error.stderr || error.message || resultado.error);
        for (const [clave, valor] of Object.entries(process.env)) {
          if (/PASSWORD|SECRETO|KEYRING|TOKEN/u.test(clave) && valor.length > 4) {
            diagnostico = diagnostico.replaceAll(valor, '[dato_sensible]');
          }
        }
        await writeFile(path.join(salida, log), `No se pudo ejecutar ${gate}: ${diagnostico}\n`, { flag: 'a', mode: 0o600 });
      } finally {
        clearInterval(latido);
        const erroresLimpieza = [];
        for (const limpiar of [
          async () => { if (bind) await bind.cerrar(); },
          () => cliente.cerrar(),
          () => administrador.ejecutar(`DROP DATABASE IF EXISTS ${administrador.escaparIdentificador(base)}`),
          async () => {
            for await (const entrada of redis.scanIterator({ MATCH: prefijo + '*', COUNT: 100 })) {
              const claves = Array.isArray(entrada) ? entrada : [entrada];
              if (claves.length) await redis.del(claves);
            }
          }
        ]) {
          try { await limpiar(); } catch (error) { erroresLimpieza.push(error.code || 'LIMPIEZA_FALLIDA'); }
        }
        if (erroresLimpieza.length) resultado = { ...resultado, estado: 'error', erroresLimpieza };
      }
      informe.resultados.push({ gate, log, ...resultado });
      await asignarPropietario(path.join(salida, log));
      await guardar();
      console.log(`[gates] ${resultado.estado.toUpperCase()}: ${gate} (${Math.round(resultado.duracionMs / 1000)} s)`);
      if (controlador.signal.aborted || (opciones.parar && resultado.estado !== 'correcto')) break;
    }
    informe.estado = controlador.signal.aborted ? 'interrumpido' :
      informe.resultados.length === gates.length && informe.resultados.every((r) => r.estado === 'correcto') ? 'correcto' : 'fallido';
  } catch (error) {
    informe.estado = controlador.signal.aborted ? 'interrumpido' : 'error';
    informe.error = error.code || 'PREFLIGHT_FALLIDO';
  } finally {
    informe.fin = new Date().toISOString();
    informe.correctas = informe.resultados.filter((r) => r.estado === 'correcto').length;
    informe.fallidas = informe.resultados.length - informe.correctas;
    informe.pendientes = gates.length - informe.resultados.length;
    const cierres = await Promise.allSettled([
      administrador.cerrar(),
      redis.isOpen ? redis.disconnect() : Promise.resolve()
    ]);
    if (cierres.some((cierre) => cierre.status === 'rejected')) {
      informe.estado = 'error';
      informe.error = 'CIERRE_CONEXIONES_FALLIDO';
    }
    try { await guardar(); } finally {
      process.removeListener('SIGINT', cancelar);
      process.removeListener('SIGTERM', cancelar);
    }
  }
  console.log(`[gates] ${informe.estado.toUpperCase()}: ${informe.correctas} correctas, ${informe.fallidas} fallidas, ${informe.pendientes} pendientes.`);
  process.exitCode = informe.estado === 'correcto' ? 0 : informe.estado === 'interrumpido' ? 130 : 1;
}

function identificador() {
  return new Date().toISOString().replace(/[-:.TZ]/gu, '') + '_' + randomBytes(4).toString('hex');
}

async function asignarPropietario(archivo) {
  const uid = Number(process.env.SENTINELIA_GATES_UID);
  const gid = Number(process.env.SENTINELIA_GATES_GID);
  if (Number.isInteger(uid) && Number.isInteger(gid) && uid >= 0 && gid >= 0) {
    try { await chown(archivo, uid, gid); } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
  }
}

async function prepararBind(env, log) {
  const directorio = await mkdtemp(path.join(tmpdir(), 'sentinelia-suite-bind-'));
  Object.assign(env, {
    BIND_PUBLICADOR_COORDINADO_ACTIVO: 'true',
    BIND_RAIZ_ARTEFACTOS: path.join(directorio, 'artefactos'),
    BIND_SELECTOR_ACTIVO: path.join(directorio, 'selector.conf'),
    BIND_LOCK_FILE: path.join(directorio, 'publicacion.lock'),
    BIND_NAMED_CONF_ACTIVO: path.join(directorio, 'named.conf'),
    BIND_NAMED_EXECUTABLE: '/usr/sbin/named',
    BIND_NAMED_ARGUMENTOS_JSON: '[]',
    BIND_RNDC_EXECUTABLE: '/usr/sbin/rndc',
    BIND_RNDC_ARGUMENTOS_JSON: '["-s","127.0.0.1","-p","953","-k","/run/named/sentinelia-rndc.key"]',
    BIND_CHECKCONF_EXECUTABLE: '/usr/bin/named-checkconf',
    BIND_CHECKZONE_EXECUTABLE: '/usr/bin/named-checkzone'
  });
  await mkdir(env.BIND_RAIZ_ARTEFACTOS);
  const archivo = await open(log, 'wx', 0o600);
  let hijo;
  let falloInicio;
  const cerrar = async () => {
    if (hijo?.pid && hijo.exitCode === null && hijo.signalCode === null) {
      const fin = new Promise((resolve) => hijo.once('close', resolve));
      hijo.kill('SIGTERM');
      const forzar = setTimeout(() => hijo.kill('SIGKILL'), 3000);
      await fin;
      clearTimeout(forzar);
    }
    await archivo.close();
    await asignarPropietario(log);
    await rm(directorio, { recursive: true, force: true });
  };
  try {
    await ejecutarArchivo('/bin/sh', [path.join(raiz, 'despliegue/docker/node-bind/docker-entrypoint.sh'), '/usr/bin/true'], { env, timeout: 10000 });
    hijo = spawn('/usr/sbin/named', ['-g', '-u', 'root', '-c', env.BIND_NAMED_CONF_ACTIVO], {
      env, cwd: directorio, stdio: ['ignore', archivo.fd, archivo.fd], shell: false
    });
    hijo.once('error', (error) => { falloInicio = error; });
    for (let intento = 0; intento < 50; intento += 1) {
      if (falloInicio) throw falloInicio;
      if (hijo.exitCode !== null) throw new Error('BIND terminó durante su preparación.');
      try {
        await ejecutarArchivo('/usr/sbin/rndc', ['-s', '127.0.0.1', '-p', '953',
          '-k', '/run/named/sentinelia-rndc.key', 'status'], { timeout: 1000 });
        return { cerrar };
      } catch {
        await esperar(100);
      }
    }
    throw new Error('BIND no alcanzó disponibilidad para el gate.');
  } catch (error) {
    await cerrar();
    throw error;
  }
}

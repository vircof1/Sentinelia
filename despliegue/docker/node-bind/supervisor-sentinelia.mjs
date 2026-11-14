import { spawn } from 'node:child_process';
import { obtenerConfiguracionAplicacion } from '../../../paquetes/utilidades/src/configuracion/obtenerConfiguracionAplicacion.js';
import { esperarSqlDisponible } from './esperar-sql-disponible.mjs';

const procesos = new Set();
let deteniendo = false;

await esperarSqlDisponible(obtenerConfiguracionAplicacion().sql);
await ejecutar('node', ['scripts/ejecutar-migraciones.js'], {
  SQL_BOOTSTRAP_MIGRACIONES: process.env.SQL_BOOTSTRAP_MIGRACIONES || 'true'
});

// named es infraestructura del contenedor y debe estar disponible antes de
// que el portal active la publicacion DNS. DNS_ACTIVO sigue siendo el valor
// inicial de la configuracion funcional, no un interruptor de procesos.
const named = iniciarNamed();
const runtime = {
  hijo: iniciar('node', ['apps/sentinelia-runtime/src/index.js'], 'runtime'),
  nombre: 'runtime'
};
const web = {
  hijo: iniciar('node', ['apps/sentinelia-web/src/index.js'], 'web'),
  nombre: 'web'
};

for (const senal of ['SIGINT', 'SIGTERM']) {
  process.on(senal, () => detenerTodos(senal, 0));
}

process.on('uncaughtException', (error) => {
  registrarDiagnostico('excepcion_no_capturada', error);
  detenerTodos('uncaughtException', 1);
});

process.on('unhandledRejection', (error) => {
  registrarDiagnostico('promesa_rechazada', error);
  detenerTodos('unhandledRejection', 1);
});

await Promise.race(
  [named, runtime, web]
    .filter(Boolean)
    .map(({ hijo, nombre }) => esperarSalida(hijo, nombre))
);

function iniciarNamed() {
  const ejecutable = process.env.BIND_NAMED_EXECUTABLE || '/usr/sbin/named';
  const configuracion = process.env.BIND_NAMED_CONF_ACTIVO || '/etc/bind/sentinelia-root.conf';
  const argumentosConfigurados = leerArgumentosJson(
    process.env.BIND_NAMED_ARGUMENTOS_JSON,
    'BIND_NAMED_ARGUMENTOS_JSON'
  );
  // El contenedor ejecuta también el publicador y comparte su key RNDC. BIND
  // debe conservar el usuario del proceso para poder leer esa key efímera;
  // el aislamiento de privilegios corresponde aquí al propio contenedor.
  const hijo = iniciar(ejecutable, [...argumentosConfigurados, '-g', '-u', 'root', '-c', configuracion], 'named');
  return { hijo, nombre: 'named' };
}

function iniciar(ejecutable, argumentos, nombre) {
  const hijo = spawn(ejecutable, argumentos, {
    stdio: 'inherit',
    shell: false,
    env: process.env
  });
  procesos.add(hijo);
  hijo.once('exit', () => procesos.delete(hijo));
  hijo.once('error', (error) => {
    registrarDiagnostico('proceso_no_iniciado', error, { proceso: nombre });
    detenerTodos(`error:${nombre}`, 1);
  });
  return hijo;
}

function leerArgumentosJson(valor, nombre) {
  try {
    const lista = JSON.parse(valor == null || valor === '' ? '[]' : String(valor));
    if (!Array.isArray(lista)) throw new Error('no_array');
    return lista.map((item) => {
      if (typeof item !== 'string' || item.length === 0) throw new Error('argumento_invalido');
      return item;
    });
  } catch {
    throw new Error(`${nombre} debe ser un array JSON válido de strings.`);
  }
}

function ejecutar(ejecutable, argumentos, entornoExtra = {}) {
  return new Promise((resolve, reject) => {
    const hijo = spawn(ejecutable, argumentos, {
      stdio: 'inherit',
      shell: false,
      env: { ...process.env, ...entornoExtra }
    });
    hijo.once('exit', (codigo, senal) => {
      if (codigo === 0) resolve();
      else reject(Object.assign(new Error('Un proceso previo terminó sin éxito.'), {
        codigo: 'proceso_previo_fallido',
        proceso: ejecutable,
        resultado: String(codigo ?? senal ?? 'desconocido')
      }));
    });
    hijo.once('error', reject);
  });
}

function esperarSalida(hijo, nombre) {
  return new Promise((resolve) => {
    hijo.once('exit', (codigo, senal) => {
      if (!deteniendo) {
        console.error(`[sentinelia-supervisor] ${nombre} terminó inesperadamente: ${codigo ?? senal}.`);
        detenerTodos(`salida:${nombre}`, codigo === 0 ? 1 : Number(codigo || 1));
      }
      resolve();
    });
  });
}

function registrarDiagnostico(codigo, error, contexto = {}) {
  const mensaje = String(error?.message || 'Fallo no detallado.')
    .replace(/[\u0000-\u001f\u007f]+/g, ' ')
    .replace(/\b(?:authorization|password|cookie|secret|token)\b\s*[:=]?\s*[^,;\s]+/gi, '[dato_sensible]')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 512);
  console.error(JSON.stringify({
    componente: 'sentinelia-supervisor',
    codigo,
    ...contexto,
    mensaje
  }));
}

function detenerTodos(motivo, codigoSalida) {
  if (deteniendo) return;
  deteniendo = true;
  console.error(`[sentinelia-supervisor] Deteniendo procesos por ${motivo}.`);
  for (const hijo of procesos) {
    if (hijo.exitCode === null && hijo.signalCode === null) {
      hijo.kill('SIGTERM');
    }
  }
  setTimeout(() => {
    for (const hijo of procesos) {
      if (hijo.exitCode === null && hijo.signalCode === null) {
        hijo.kill('SIGKILL');
      }
    }
    process.exit(codigoSalida);
  }, Number(process.env.RUNTIME_APAGADO_TIMEOUT_MS || 10000)).unref();
}

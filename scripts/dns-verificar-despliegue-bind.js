import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';

const raiz = new URL('..', import.meta.url);
const base = new URL('despliegue/docker/node-bind/', raiz);

const archivos = {
  dockerfile: await leer('Dockerfile'),
  entrypoint: await leer('docker-entrypoint.sh'),
  supervisor: await leer('supervisor-sentinelia.mjs'),
  productivo: await leer('docker-compose.productivo.yml'),
  desarrollo: await leer('docker-compose.desarrollo.yml'),
  reload: await leer('reload.sh'),
  readme: await leer('README.md'),
  envEjemplo: await fs.readFile(new URL('.env.ejemplo', raiz), 'utf8')
};

verificarDockerfile();
verificarEntrypointYSupervisor();
verificarComposeProductivo();
verificarOverrideDesarrollo();
verificarRecargaAplicacion();
verificarEnvEjemplo();
verificarDocumentacion();

console.log('[dns] OK 5.21.11f: despliegue=canonico imagen=5.21 npm=imagen mounts_app=prohibidos bind_env=BIND comandos=sin_shell supervisor=node override=desarrollo');

async function leer(nombre) {
  return fs.readFile(new URL(nombre, base), 'utf8');
}

function verificarDockerfile() {
  assert.match(archivos.dockerfile, /FROM node:24-bookworm-slim/);
  assert.match(archivos.dockerfile, /bind9/);
  assert.match(archivos.dockerfile, /bind9-utils/);
  assert.match(archivos.dockerfile, /npm ci --omit=dev/);
  assert.match(archivos.dockerfile, /es\.sentinelia\.contrato-dns="5\.21"/);
  assert.match(archivos.dockerfile, /ENTRYPOINT \["\/app\/despliegue\/docker\/node-bind\/docker-entrypoint\.sh"\]/);
  assert.match(archivos.dockerfile, /CMD \["node", "despliegue\/docker\/node-bind\/supervisor-sentinelia\.mjs"\]/);
  assert.doesNotMatch(archivos.dockerfile, /node_modules\s*:/);
  assert.doesNotMatch(archivos.dockerfile, /DNS_(RUTA|DIRECTORIO|COMANDO)_/);
}

function verificarEntrypointYSupervisor() {
  assert.match(archivos.entrypoint, /BIND_NAMED_CONF_ACTIVO/);
  assert.match(archivos.entrypoint, /BIND_SELECTOR_ACTIVO/);
  assert.match(archivos.entrypoint, /include "%s";/);
  assert.match(archivos.entrypoint, /Variable obsoleta %s detectada/);
  assert.match(archivos.entrypoint, /DNS_RUTA_INCLUDE_GESTIONADO/);
  assert.match(archivos.entrypoint, /DNS_COMANDO_RECARGA/);
  assert.match(archivos.supervisor, /scripts\/ejecutar-migraciones\.js/);
  assert.match(archivos.supervisor, /apps\/sentinelia-runtime\/src\/index\.js/);
  assert.match(archivos.supervisor, /apps\/sentinelia-web\/src\/index\.js/);
  assert.match(archivos.supervisor, /const named = iniciarNamed\(\);/);
  assert.doesNotMatch(archivos.supervisor, /function dnsActivo\(/);
  assert.match(archivos.supervisor, /shell: false/g);
  assert.doesNotMatch(archivos.supervisor, /sh -c|execFile\(|spawn\(['"]sh['"]/);
}

function verificarComposeProductivo() {
  assert.match(archivos.productivo, /image: sentinelia-node-bind:5\.21/);
  assert.match(archivos.productivo, /dockerfile: despliegue\/docker\/node-bind\/Dockerfile/);
  for (const variable of variablesBind()) {
    assert.match(archivos.productivo, new RegExp(`${variable}:`));
  }
  assert.doesNotMatch(archivos.productivo, /DNS_(RUTA|DIRECTORIO|COMANDO)_/);
  assert.doesNotMatch(archivos.productivo, /(["']?)\/app\1/);
  assert.doesNotMatch(archivos.productivo, /\/app\/node_modules/);
  assert.doesNotMatch(archivos.productivo, /node_modules:\s*\/app\/node_modules/);
  assert.match(archivos.productivo, /bind_artifacts:\/var\/lib\/sentinelia\/bind/);
  assert.match(archivos.productivo, /bind_config:\/etc\/bind/);
  assert.match(archivos.productivo, /command: \["redis-server", "--appendonly", "yes"\]/);
}

function verificarOverrideDesarrollo() {
  assert.match(archivos.desarrollo, /NODE_ENV: development/);
  assert.match(archivos.desarrollo, /\.\.\/\.\.\/\.\.:\/app/);
  assert.match(archivos.desarrollo, /node_modules_dev:\/app\/node_modules/);
  assert.match(archivos.desarrollo, /docker-compose\.desarrollo|supervisor-sentinelia\.mjs/);
}

function verificarRecargaAplicacion() {
  assert.match(archivos.reload, /build app/);
  assert.match(archivos.reload, /up -d --no-deps --force-recreate --wait/);
  assert.match(archivos.reload, /--wait-timeout/);
  assert.match(archivos.reload, /logs --no-color --tail=120 app/);
  assert.doesNotMatch(archivos.reload, /build --no-cache/);
  assert.doesNotMatch(archivos.reload, /\b(up|build)\b[^\n]*(mariadb|redis)/);
}

function verificarEnvEjemplo() {
  for (const variable of variablesBind()) {
    assert.match(archivos.envEjemplo, new RegExp(`^${variable}=`, 'm'));
  }
  assert.match(archivos.envEjemplo, /^DNS_ACTIVO=false$/m);
  assert.match(archivos.envEjemplo, /^DNS_LISTEN_ON=/m);
  assert.doesNotMatch(archivos.envEjemplo, /DNS_RUTA_INCLUDE_GESTIONADO/);
  assert.doesNotMatch(archivos.envEjemplo, /DNS_DIRECTORIO_ZONAS/);
  assert.doesNotMatch(archivos.envEjemplo, /DNS_COMANDO_/);
}

function verificarDocumentacion() {
  assert.match(archivos.readme, /no monta `\/app` ni `\/app\/node_modules`/);
  assert.match(archivos.readme, /ejecutable \+ argumentos, sin shell/);
  assert.match(archivos.readme, /DNS_RUTA_\*/);
  assert.match(archivos.readme, /DNS_COMANDO_\*/);
  assert.match(archivos.readme, /`named` arranca siempre/);
  assert.match(archivos.readme, /activación posterior se gobierna desde el portal/);
  assert.match(archivos.readme, /`\.\/reload\.sh`/);
  assert.match(archivos.readme, /no recrea MariaDB ni Redis/);
}

function variablesBind() {
  return [
    'BIND_RAIZ_ARTEFACTOS',
    'BIND_SELECTOR_ACTIVO',
    'BIND_LOCK_FILE',
    'BIND_NAMED_CONF_ACTIVO',
    'BIND_NAMED_EXECUTABLE',
    'BIND_NAMED_ARGUMENTOS_JSON',
    'BIND_RNDC_EXECUTABLE',
    'BIND_RNDC_ARGUMENTOS_JSON',
    'BIND_CHECKCONF_EXECUTABLE',
    'BIND_CHECKZONE_EXECUTABLE'
  ];
}

export function resolverRutaDespliegueBind(nombre) {
  return path.join('despliegue/docker/node-bind', nombre);
}

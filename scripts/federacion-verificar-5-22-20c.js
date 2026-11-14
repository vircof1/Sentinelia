import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

import { AuditorKeyringFederacionSql } from
  '../paquetes/federacion/adaptadores/AuditorKeyringFederacionSql.js';
import { ResolutorConfiguracionFederacionPortal } from
  '../paquetes/federacion/aplicacion/ResolutorConfiguracionFederacionPortal.js';

const ejecutarArchivo = promisify(execFile);
const raizProyecto = fileURLToPath(new URL('../', import.meta.url));

await main();

async function main() {
  await verificarKeyringHistoricoFailSafe();
  await verificarContratoAutodesplegable();
  await verificarDiagnosticoRealYSaneado();
  await verificarGarantiasReutilizadas();
  await verificarRegistro();
  console.log(
    '[federacion] OK 5.22.20c: bootstrap=web_runtime sql=utc_migrado ' +
    'redis=operativo keyring=historico_fail_safe proxy=nginx_https_privado ' +
    'recuperacion=documentada diagnostico=saneado_autodesplegable'
  );
}

async function verificarKeyringHistoricoFailSafe() {
  const clienteSql = {
    async consultar() {
      return [{
        keyring_referencia: 'sentinelia/federacion/v1',
        key_id: 'historica',
        total: 2
      }];
    },
    async verificarUsoHorarioUtc() {
      return { diferenciaSegundos: 0 };
    }
  };
  const auditor = new AuditorKeyringFederacionSql(clienteSql);
  assert.deepEqual(await auditor.inventariar(), {
    totalSobres: 2,
    entradas: [{
      referencia: 'sentinelia/federacion/v1',
      keyId: 'historica',
      totalSobres: 2
    }]
  });
  const servicioConfiguracionPortal = servicioPortal(false);
  await assert.rejects(
    new ResolutorConfiguracionFederacionPortal({
      servicioConfiguracionPortal,
      clienteSql,
      auditorKeyring: auditor
    }).cargarActual(),
    (error) => error.codigo === 'KEYRING_HISTORICO_AUSENTE'
  );

  const sinSobres = new AuditorKeyringFederacionSql({
    ...clienteSql,
    async consultar() { return []; }
  });
  const fotografia = await new ResolutorConfiguracionFederacionPortal({
    servicioConfiguracionPortal,
    clienteSql,
    auditorKeyring: sinSobres
  }).cargarActual();
  assert.equal(fotografia.configuracion.activacionFederacion, false);
  assert.equal(fotografia.keyring.disponible, false);
}

async function verificarContratoAutodesplegable() {
  const [entorno, compose, nginx, guia, fabrica, web, runtime] = await Promise.all([
    leer('../.env.ejemplo'),
    leer('../despliegue/docker/node-bind/docker-compose.productivo.yml'),
    leer('../despliegue/federacion/nginx/sentinelia.conf.example'),
    leer('../despliegue/federacion/README.md'),
    leer('../paquetes/federacion/aplicacion/crearPlanoControlFederacionLocal.js'),
    leer('../apps/sentinelia-web/src/index.js'),
    leer('../apps/sentinelia-runtime/src/BootstrapRuntime.js')
  ]);
  for (const variable of [
    'WEB_BIND_ADDRESS=127.0.0.1', 'PORTAL_ORIGEN_PUBLICO=',
    'PORTAL_PROXIES_REVERSOS_CONFIABLES=', 'FEDERACION_KEYRING_REFERENCIA=',
    'FEDERACION_KEYRING=', 'FEDERACION_KEY_ID_ACTIVA='
  ]) assert.ok(entorno.includes(variable), `Falta ${variable} en .env.ejemplo.`);
  assert.match(compose, /WEB_BIND_ADDRESS:-127\.0\.0\.1/u);
  assert.match(compose, /mariadb_data:/u);
  assert.match(compose, /redis_data:/u);
  assert.match(nginx, /proxy_pass http:\/\/127\.0\.0\.1:3001;/u);
  assert.match(nginx, /proxy_set_header X-Forwarded-Proto https;/u);
  assert.match(nginx, /proxy_set_header X-Forwarded-For \$remote_addr;/u);
  assert.match(nginx, /proxy_set_header Forwarded "";/u);
  assert.match(nginx, /map \$http_upgrade \$sentinelia_connection_upgrade/u);
  assert.match(nginx, /proxy_set_header Upgrade \$http_upgrade;/u);
  assert.match(
    nginx,
    /proxy_set_header Connection \$sentinelia_connection_upgrade;/u
  );
  assert.doesNotMatch(nginx, /\$proxy_add_x_forwarded_for/u);
  for (const concepto of [
    /red privada de confianza/u, /SQL pasa a ser la autoridad/u,
    /nginx -t/u, /installationId/u, /posible\s+clon/u, /clave histórica/u,
    /federacion:diagnosticar-despliegue/u
  ]) assert.match(guia, concepto, `La guía no cierra: ${concepto}.`);
  assert.match(fabrica, /const auditorKeyring = new AuditorKeyringFederacionSql/u);
  assert.match(fabrica, /auditorKeyring\n/u);
  assert.match(web, /crearPlanoControlFederacionLocal\s*\(\s*\{/u);
  assert.match(runtime, /crearPlanoControlFederacionLocal\s*\(\s*\{/u);
}

async function verificarDiagnosticoRealYSaneado() {
  const correcto = await ejecutar('scripts/federacion-diagnosticar-despliegue.js');
  assert.equal(correcto.stderr.trim(), '');
  assert.match(correcto.stdout, /DIAGNOSTICO_DESPLIEGUE_OK/u);
  const linea = correcto.stdout.trim().split(/\r?\n/u).at(-1);
  const resumen = JSON.parse(linea.slice(linea.indexOf('{')));
  assert.equal(resumen.sqlUtc, true);
  assert.equal(resumen.redis, true);
  assert.equal(resumen.installationIdInicializada, true);
  assert.ok(Number.isSafeInteger(resumen.migraciones) && resumen.migraciones > 0);
  for (const campoProhibido of [
    'installationId', 'bootId', 'origenPublico', 'referencia', 'keyIds'
  ]) assert.equal(Object.hasOwn(resumen, campoProhibido), false);

  const secretoHostil = 'material-super-secreto-no-publicable';
  await assert.rejects(
    ejecutar('scripts/federacion-diagnosticar-despliegue.js', {
      ...process.env,
      FEDERACION_KEYRING: secretoHostil,
      FEDERACION_KEY_ID_ACTIVA: 'principal'
    }),
    (error) => {
      const salida = `${error.stdout || ''}\n${error.stderr || ''}`;
      assert.match(salida, /codigo=KEYRING_DESPLIEGUE_INVALIDO/u);
      assert.doesNotMatch(salida, new RegExp(secretoHostil, 'u'));
      assert.doesNotMatch(salida, /FEDERACION_KEYRING debe/u);
      return true;
    }
  );
}

async function verificarGarantiasReutilizadas() {
  for (const unidad of ['10c', '11h', '19a', '19b']) {
    const resultado = await ejecutar(`scripts/federacion-verificar-5-22-${unidad}.js`);
    assert.equal(resultado.stderr.trim(), '');
    assert.match(resultado.stdout, new RegExp(`OK 5\\.22\\.${unidad}`, 'u'));
  }
}

async function verificarRegistro() {
  const packageJson = JSON.parse(await leer('../package.json'));
  assert.equal(
    packageJson.scripts['federacion:diagnosticar-despliegue'],
    'node scripts/federacion-diagnosticar-despliegue.js'
  );
}

function servicioPortal(activacionFederacion) {
  const configuracion = Object.freeze({
    activacionFederacion,
    origenPublico: null,
    proxiesConfiables: [],
    keyringReferenciaDespliegue: 'sentinelia/federacion/v1'
  });
  const portal = Object.freeze({
    obtenerConfiguracionFederacion() { return configuracion; }
  });
  return Object.freeze({
    async asegurarActualizada() { return portal; },
    obtenerConfiguracionActual() { return portal; }
  });
}

function ejecutar(archivo, env = process.env) {
  return ejecutarArchivo(process.execPath, [archivo], {
    cwd: raizProyecto,
    env,
    encoding: 'utf8',
    timeout: 1_800_000,
    maxBuffer: 64 * 1024 * 1024,
    windowsHide: true
  });
}

function leer(ruta) {
  return readFile(new URL(ruta, import.meta.url), 'utf8');
}

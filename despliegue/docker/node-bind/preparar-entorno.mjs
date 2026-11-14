import { randomBytes } from 'node:crypto';
import { chmod, copyFile, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

const rutaEntorno = path.resolve(process.argv[2] || '.env');
const rutaPlantilla = path.resolve(process.argv[3] || '.env.ejemplo');

await asegurarEntorno();
let contenido = await readFile(rutaEntorno, 'utf8');
const generadas = [];

provisionarTexto('SQL_PASSWORD', () => randomBytes(32).toString('base64url'));
provisionarTexto('PASSWORD_ADMIN_INICIAL', () => randomBytes(24).toString('base64url'));
provisionarTexto('SESION_SECRETO', () => randomBytes(32).toString('hex'));
provisionarKeyring('AGENTES_SESION_KEYRING', 'AGENTES_SESION_KEY_ID_ACTIVA', 'agentes');
provisionarKeyring('CORREO_KEYRING', 'CORREO_KEY_ID_ACTIVA', 'correo');
provisionarKeyring('FEDERACION_KEYRING', 'FEDERACION_KEY_ID_ACTIVA', 'federacion');

if (generadas.length > 0) {
  const temporal = `${rutaEntorno}.tmp-${process.pid}-${randomBytes(6).toString('hex')}`;
  await writeFile(temporal, contenido, { encoding: 'utf8', mode: 0o600 });
  await chmod(temporal, 0o600);
  await rename(temporal, rutaEntorno);
}
await chmod(rutaEntorno, 0o600);

console.log(generadas.length > 0
  ? `[bootstrap-entorno] Garantías iniciales materializadas: ${generadas.join(', ')}.`
  : '[bootstrap-entorno] Entorno ya provisionado; no se modificó ningún secreto.');

async function asegurarEntorno() {
  try {
    await readFile(rutaEntorno, 'utf8');
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
    await copyFile(rutaPlantilla, rutaEntorno);
    await chmod(rutaEntorno, 0o600);
    console.log(`[bootstrap-entorno] Creado ${rutaEntorno} desde la plantilla.`);
  }
}

function provisionarTexto(clave, generar) {
  const valor = leer(clave);
  exigirDeclarada(clave, valor);
  if (!pendiente(valor)) return;
  reemplazar(clave, generar());
  generadas.push(clave);
}

function provisionarKeyring(claveKeyring, claveId, dominio) {
  const keyringActual = leer(claveKeyring);
  const idActual = leer(claveId);
  exigirDeclarada(claveKeyring, keyringActual);
  exigirDeclarada(claveId, idActual);

  if (pendiente(keyringActual)) {
    const id = `instalacion-${dominio}-${randomBytes(6).toString('hex')}`;
    reemplazar(claveKeyring, JSON.stringify({
      [id]: randomBytes(32).toString('base64')
    }));
    reemplazar(claveId, id);
    generadas.push(claveKeyring, claveId);
    return;
  }

  if (!pendiente(idActual)) return;
  let keyring;
  try {
    keyring = JSON.parse(keyringActual);
  } catch {
    throw new Error(`${claveKeyring} debe ser JSON para deducir su clave activa.`);
  }
  const ids = Object.keys(keyring || {});
  if (ids.length !== 1) {
    throw new Error(`${claveId} debe indicarse cuando ${claveKeyring} contiene ${ids.length} claves.`);
  }
  reemplazar(claveId, ids[0]);
  generadas.push(claveId);
}

function leer(clave) {
  const coincidencia = contenido.match(new RegExp(`^${clave}=(.*)$`, 'm'));
  return coincidencia ? coincidencia[1] : undefined;
}

function reemplazar(clave, valor) {
  contenido = contenido.replace(new RegExp(`^${clave}=.*$`, 'm'), `${clave}=${valor}`);
}

function pendiente(valor) {
  return valor === '' || String(valor).includes('REEMPLAZAR_');
}

function exigirDeclarada(clave, valor) {
  if (valor === undefined) {
    throw new Error(`Falta ${clave} en el contrato de entorno.`);
  }
}

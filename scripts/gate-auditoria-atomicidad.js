import { randomBytes } from 'node:crypto';
import { spawn } from 'node:child_process';
import { ClienteSql } from '../paquetes/persistencia-sql/src/ClienteSql.js';
import { obtenerConfiguracionAplicacion } from '../paquetes/utilidades/src/configuracion/obtenerConfiguracionAplicacion.js';

const configuracion = obtenerConfiguracionAplicacion().sql;
const administrador = new ClienteSql(configuracion);
const base = `sentinelia_atomicidad_${randomBytes(8).toString('hex')}`;
try {
  await administrador.ejecutar(`CREATE DATABASE ${administrador.escaparIdentificador(base)} CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
  for (const script of [
    'auditoria-verificar-frontera-transaccional-local.js',
    'auditoria-verificar-registro-sincrono.js',
    'auditoria-verificar-movimientos-atomicos.js'
  ]) {
    await new Promise((resolve, reject) => {
      const proceso = spawn(process.execPath, ['scripts/' + script], {
        cwd: new URL('..', import.meta.url),
        env: { ...process.env, SQL_BASE_DATOS: base }, stdio: 'inherit'
      });
      proceso.once('error', reject);
      proceso.once('exit', (codigo, senal) => codigo === 0 ? resolve() : reject(
        new Error(script + ' terminó con ' + (senal || codigo) + '.')
      ));
    });
  }
} finally {
  try {
    await administrador.ejecutar(`DROP DATABASE IF EXISTS ${administrador.escaparIdentificador(base)}`);
  } finally {
    await administrador.cerrar();
  }
}
console.log('[gate:auditoria:atomicidad] OK: frontera, registro y movimientos verificados en SQL efímero.');

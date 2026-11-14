import { randomBytes } from 'node:crypto';
import { spawn } from 'node:child_process';
import { ClienteSql } from '../../paquetes/persistencia-sql/src/ClienteSql.js';
import { EjecutorMigraciones } from '../../paquetes/persistencia-sql/src/EjecutorMigraciones.js';
import { RepositorioMigraciones } from '../../paquetes/persistencia-sql/src/RepositorioMigraciones.js';
import { obtenerConfiguracionAplicacion, obtenerRutaMigraciones } from '../../paquetes/utilidades/src/configuracion/obtenerConfiguracionAplicacion.js';

export async function ejecutarGateSqlEfimero(scripts) {
  const configuracion = obtenerConfiguracionAplicacion().sql;
  const administrador = new ClienteSql(configuracion);
  const base = `sentinelia_gate_${randomBytes(12).toString('hex')}`;
  const fixture = new ClienteSql({ ...configuracion, baseDatos: base });
  try {
    await administrador.ejecutar(`CREATE DATABASE ${administrador.escaparIdentificador(base)} CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
    try {
      await new EjecutorMigraciones({ clienteSql: fixture,
        repositorioMigraciones: new RepositorioMigraciones(fixture),
        rutaMigraciones: obtenerRutaMigraciones() }).ejecutarPendientes();
    } finally {
      await fixture.cerrar();
    }
    for (const script of scripts) {
      await new Promise((resolve, reject) => {
        const proceso = spawn(process.execPath, ['scripts/' + script], {
          cwd: new URL('../..', import.meta.url),
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
}

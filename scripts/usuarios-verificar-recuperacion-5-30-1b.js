import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';

import { ClienteSql } from '../paquetes/persistencia-sql/src/ClienteSql.js';
import { EjecutorMigraciones } from '../paquetes/persistencia-sql/src/EjecutorMigraciones.js';
import { RepositorioMigraciones } from '../paquetes/persistencia-sql/src/RepositorioMigraciones.js';
import {
  ESCRITORES_SENSIBLES_RECUPERACION_PASSWORD
} from '../paquetes/usuarios/src/EscritoresSensiblesRecuperacionPassword.js';
import { RepositorioUsuarios } from '../paquetes/usuarios/src/RepositorioUsuarios.js';
import {
  obtenerConfiguracionAplicacion,
  obtenerRutaMigraciones
} from '../paquetes/utilidades/src/configuracion/obtenerConfiguracionAplicacion.js';

await main();

async function main() {
  await verificarInventarioEstructural();
  const configuracion = obtenerConfiguracionAplicacion();
  assert.equal(configuracion.sql.estaCompleta, true, '5.30.1b necesita MariaDB real.');
  const administrador = new ClienteSql(configuracion.sql);
  const base = `sentinelia_fixture_5301b_${randomBytes(5).toString('hex')}`;
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
    await verificarAltas(sql);
    await verificarEscritoresEfectivos(sql);
    console.log(
      '[usuarios] OK 5.30.1b: escritores=14 generacion=misma_frontera_sql ' +
      'altas=generacion_1 no_op=no_avanza password_email_validacion_actividad=avanzan ' +
      'nombre_scope_permisos_preferencia=no_avanzan guard=estructural'
    );
  } finally {
    await sql?.cerrar().catch(() => {});
    await administrador.ejecutar(
      `DROP DATABASE IF EXISTS ${administrador.escaparIdentificador(base)}`
    ).catch(() => {});
    await administrador.cerrar();
  }
}

async function verificarAltas(sql) {
  const repositorio = new RepositorioUsuarios(sql);
  const conexion = await sql.obtenerConexion();
  try {
    await conexion.beginTransaction();
    const inicial = await repositorio.crearUsuarioInicialEnTransaccion({
      usuario: 'Inicial5301b',
      email: 'inicial@example.test',
      hashPassword: 'hash-inicial',
      nombreMostrar: 'Inicial'
    }, { conexion });
    assert.equal(inicial.creado, true);
    const creado = await repositorio.buscarPorIdEnTransaccion(
      inicial.usuarioId,
      { conexion }
    );
    assert.equal(creado.generacionRecuperacion, '1');
    await conexion.rollback();
  } finally {
    conexion.release();
  }

  const administrativo = await repositorio.crearUsuarioAdministrativo({
    usuario: 'Administrativo5301b',
    email: 'administrativo@example.test',
    hashPassword: 'hash-administrativo-1',
    nombreMostrar: 'Administrativo',
    nombreCompleto: 'Usuario Administrativo',
    tenantId: null,
    empresaId: null,
    sitioId: null,
    permisos: permisosVacios(),
    requiereCambioPassword: true
  });
  assert.equal(administrativo.generacionRecuperacion, '1');
}

async function verificarEscritoresEfectivos(sql) {
  const repositorio = new RepositorioUsuarios(sql);
  let usuario = await repositorio.buscarPorUsuario('Administrativo5301b');
  const id = usuario.id;

  await repositorio.actualizarNombreMostrarPropio({ idUsuario: id, nombreMostrar: 'Otro' });
  await exigirGeneracion(repositorio, id, '1');
  await repositorio.actualizarPreferenciaAlertasRemotasPropiaEnTransaccion(
    { idUsuario: id, mostrar: true }
  );
  await exigirGeneracion(repositorio, id, '1');

  await repositorio.actualizarPasswordObligatoria({
    idUsuario: id,
    hashPasswordNuevo: 'hash-obligatoria-2',
    versionSesionObservada: usuario.versionSesion
  });
  usuario = await exigirGeneracion(repositorio, id, '2');

  const propio = await repositorio.actualizarPasswordPropio({
    idUsuario: id,
    hashPasswordActual: usuario.hashPassword,
    hashPasswordNuevo: 'hash-propia-3',
    versionSesionActual: usuario.versionSesion
  });
  assert.equal(propio.estado, 'actualizado');
  usuario = await exigirGeneracion(repositorio, id, '3');

  await repositorio.reiniciarPasswordAdministrativa({
    idUsuario: id,
    hashPasswordNuevo: 'hash-administrativa-4'
  });
  await exigirGeneracion(repositorio, id, '4');

  await repositorio.establecerActivoAdministrativo({ idUsuario: id, activo: false });
  await exigirGeneracion(repositorio, id, '5');
  await repositorio.establecerActivoAdministrativo({ idUsuario: id, activo: false });
  await exigirGeneracion(repositorio, id, '5');
  await repositorio.establecerActivoAdministrativo({ idUsuario: id, activo: true });
  await exigirGeneracion(repositorio, id, '6');

  await repositorio.actualizarMetadatosAdministrativos({
    idUsuario: id,
    email: 'administrativo@example.test',
    nombreMostrar: 'Metadatos',
    nombreCompleto: 'Solo metadatos'
  });
  await exigirGeneracion(repositorio, id, '6');
  await repositorio.actualizarMetadatosAdministrativos({
    idUsuario: id,
    email: 'cambio@example.test',
    nombreMostrar: 'Metadatos',
    nombreCompleto: 'Con correo'
  });
  await exigirGeneracion(repositorio, id, '7');

  await repositorio.actualizarEmailYEstadoValidacion({
    idUsuario: id,
    email: 'cambio@example.test',
    emailValidado: true
  });
  await exigirGeneracion(repositorio, id, '8');
  await repositorio.actualizarEmailYEstadoValidacion({
    idUsuario: id,
    email: 'cambio@example.test',
    emailValidado: true
  });
  await exigirGeneracion(repositorio, id, '8');

  const noValidado = await repositorio.actualizarEmailNoValidado({
    idUsuario: id,
    emailActual: 'cambio@example.test',
    emailNuevo: 'pendiente@example.test'
  });
  assert.equal(noValidado.estado, 'actualizado');
  await exigirGeneracion(repositorio, id, '9');
  await repositorio.actualizarEmailNoValidado({
    idUsuario: id,
    emailActual: 'pendiente@example.test',
    emailNuevo: 'pendiente@example.test'
  });
  await exigirGeneracion(repositorio, id, '9');

  await repositorio.marcarEmailValidadoSiCoincide({
    idUsuario: id,
    email: 'pendiente@example.test'
  });
  await exigirGeneracion(repositorio, id, '10');
  await repositorio.marcarEmailValidadoSiCoincide({
    idUsuario: id,
    email: 'pendiente@example.test'
  });
  await exigirGeneracion(repositorio, id, '10');

  const conexion = await sql.obtenerConexion();
  try {
    await conexion.beginTransaction();
    const confirmada =
      await repositorio.confirmarEmailValidadoPendienteEnTransaccion({
        idUsuario: id,
        emailOrigen: 'pendiente@example.test',
        emailCandidato: 'confirmado@example.test'
      }, { conexion });
    assert.equal(confirmada.estado, 'actualizado');
    await conexion.commit();
  } finally {
    conexion.release();
  }
  await exigirGeneracion(repositorio, id, '11');
  const repetida = await repositorio.confirmarEmailValidadoPendiente({
    idUsuario: id,
    emailOrigen: 'pendiente@example.test',
    emailCandidato: 'confirmado@example.test'
  });
  assert.equal(repetida.estado, 'ya_aplicado');
  usuario = await exigirGeneracion(repositorio, id, '11');

  await repositorio.actualizarUsuarioAdministrativo({
    idUsuario: id,
    email: 'confirmado@example.test',
    nombreMostrar: 'Nuevo nombre',
    nombreCompleto: usuario.nombreCompleto,
    tenantId: null,
    empresaId: null,
    sitioId: null,
    permisos: usuario.permisos.serializar(),
    incrementarVersionSesion: false
  });
  await exigirGeneracion(repositorio, id, '11');
  await repositorio.actualizarUsuarioAdministrativo({
    idUsuario: id,
    email: 'final@example.test',
    nombreMostrar: 'Nuevo nombre',
    nombreCompleto: usuario.nombreCompleto,
    tenantId: null,
    empresaId: null,
    sitioId: null,
    permisos: usuario.permisos.serializar(),
    incrementarVersionSesion: false
  });
  await exigirGeneracion(repositorio, id, '12');
}

async function exigirGeneracion(repositorio, idUsuario, esperada) {
  const usuario = await repositorio.buscarPorId(idUsuario);
  assert.equal(usuario.generacionRecuperacion, esperada);
  return usuario;
}

async function verificarInventarioEstructural() {
  assert.equal(ESCRITORES_SENSIBLES_RECUPERACION_PASSWORD.length, 14);
  const raiz = new URL('../', import.meta.url);
  const fuentes = new Map();
  for (const escritor of ESCRITORES_SENSIBLES_RECUPERACION_PASSWORD) {
    const fuente = fuentes.get(escritor.archivo) ??
      await readFile(new URL(escritor.archivo, raiz), 'utf8');
    fuentes.set(escritor.archivo, fuente);
    const segmento = extraerOperacion(fuente, escritor.operacion);
    assert.match(segmento, /generacion_recuperacion/u, escritor.operacion);
    for (const campo of escritor.campos) assert.match(segmento, new RegExp(campo, 'u'));
  }

  const repositorio = fuentes.get('paquetes/usuarios/src/RepositorioUsuarios.js');
  const actualizacionesSensibles = [...repositorio.matchAll(/UPDATE usuarios[\s\S]*?`/gu)]
    .filter(([sql]) => {
      const asignaciones = sql.split(/\bWHERE\b/iu, 1)[0];
      return /(hash_password\s*=|email\s*=|email_validado\s*=|activo\s*=)/u
        .test(asignaciones);
    });
  assert.equal(actualizacionesSensibles.length, 12);
  assert.ok(actualizacionesSensibles.every(([sql]) => sql.includes('generacion_recuperacion')));
  const altas = [...repositorio.matchAll(/INSERT INTO usuarios[\s\S]*?`/gu)];
  assert.equal(altas.length, 2);
  assert.ok(altas.every(([sql]) => sql.includes('generacion_recuperacion')));

  for (const directorio of ['paquetes', 'apps']) {
    for (const archivo of await listarJs(new URL(`${directorio}/`, raiz))) {
      if (archivo.pathname.endsWith('/RepositorioUsuarios.js')) continue;
      const fuente = await readFile(archivo, 'utf8');
      assert.doesNotMatch(
        fuente,
        /(?:UPDATE|INSERT INTO)\s+usuarios[\s\S]{0,1200}(?:hash_password\s*[=,]|email_validado\s*[=,]|email\s*[=,]|activo\s*[=,])/iu,
        `escritor sensible no inventariado: ${archivo.pathname}`
      );
    }
  }
}

function extraerOperacion(fuente, nombre) {
  const inicio = fuente.search(new RegExp(`(?:async function|async)\\s+${nombre}\\b`, 'u'));
  assert.ok(inicio >= 0, `falta escritor inventariado ${nombre}`);
  const siguiente = fuente.slice(inicio + 1).search(/\n(?:  async |async function )/u);
  return siguiente < 0 ? fuente.slice(inicio) : fuente.slice(inicio, inicio + 1 + siguiente);
}

async function listarJs(directorio) {
  const salida = [];
  for (const entrada of await readdir(directorio, { withFileTypes: true })) {
    if (entrada.name === 'node_modules') continue;
    const url = new URL(entrada.name + (entrada.isDirectory() ? '/' : ''), directorio);
    if (entrada.isDirectory()) salida.push(...await listarJs(url));
    else if (entrada.name.endsWith('.js')) salida.push(url);
  }
  return salida;
}

function permisosVacios() {
  return new Proxy({}, { get: () => false });
}

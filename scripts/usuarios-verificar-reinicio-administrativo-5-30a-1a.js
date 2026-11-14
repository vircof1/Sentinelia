import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';

import bcrypt from 'bcrypt';

import { ControladorLogin } from '../apps/sentinelia-web/src/controladores/ControladorLogin.js';
import { ClienteSql } from '../paquetes/persistencia-sql/src/ClienteSql.js';
import { EjecutorMigraciones } from '../paquetes/persistencia-sql/src/EjecutorMigraciones.js';
import { RepositorioMigraciones } from '../paquetes/persistencia-sql/src/RepositorioMigraciones.js';
import { RepositorioUsuarios } from '../paquetes/usuarios/src/RepositorioUsuarios.js';
import {
  ErrorPreautenticacionCambioPasswordNoVigente,
  ServicioAutenticacion
} from '../paquetes/usuarios/src/ServicioAutenticacion.js';
import {
  obtenerConfiguracionAplicacion,
  obtenerRutaMigraciones
} from '../paquetes/utilidades/src/configuracion/obtenerConfiguracionAplicacion.js';

await main();

async function main() {
  const configuracion = obtenerConfiguracionAplicacion();
  assert.equal(configuracion.sql.estaCompleta, true, '5.30a.1a necesita MariaDB real.');
  const administrador = new ClienteSql(configuracion.sql);
  const base = `sentinelia_fixture_530a1a_${randomBytes(5).toString('hex')}`;
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

    await verificarCasSql(sql);
    await verificarServicioConProyeccionRezagada();
    await verificarDestruccionContinuacionWeb();
    console.log(
      '[usuarios] OK 5.30a.1a: cas=version_sesion activo=cercado ' +
      'doble_submit=uno concurrencia=uno reset_intermedio=extingue ' +
      'redis_rezagado=extingue web=login'
    );
  } finally {
    await sql?.cerrar().catch(() => {});
    await administrador.ejecutar(
      `DROP DATABASE IF EXISTS ${administrador.escaparIdentificador(base)}`
    ).catch(() => {});
    await administrador.cerrar();
  }
}

async function verificarCasSql(sql) {
  const repositorio = new RepositorioUsuarios(sql);

  const doble = await crearUsuario(repositorio, 'Doble530a1a');
  const primera = await repositorio.actualizarPasswordObligatoria({
    idUsuario: doble.id,
    hashPasswordNuevo: 'hash-confirmada',
    versionSesionObservada: doble.versionSesion
  });
  assert.equal(primera.versionSesion, doble.versionSesion + 1);
  assert.equal(primera.requiereCambioPassword, false);
  const repetida = await repositorio.actualizarPasswordObligatoria({
    idUsuario: doble.id,
    hashPasswordNuevo: 'hash-que-no-debe-escribirse',
    versionSesionObservada: doble.versionSesion
  });
  assert.equal(repetida, null);
  const trasRepetida = await repositorio.buscarPorId(doble.id);
  assert.equal(trasRepetida.hashPassword, 'hash-confirmada');
  assert.equal(trasRepetida.versionSesion, doble.versionSesion + 1);

  const intervenido = await crearUsuario(repositorio, 'Intermedio530a1a');
  await repositorio.reiniciarPasswordAdministrativa({
    idUsuario: intervenido.id,
    hashPasswordNuevo: 'hash-administrativa'
  });
  const obsoleta = await repositorio.actualizarPasswordObligatoria({
    idUsuario: intervenido.id,
    hashPasswordNuevo: 'hash-preautenticacion-antigua',
    versionSesionObservada: intervenido.versionSesion
  });
  assert.equal(obsoleta, null);
  const trasIntervencion = await repositorio.buscarPorId(intervenido.id);
  assert.equal(trasIntervencion.hashPassword, 'hash-administrativa');

  const concurrente = await crearUsuario(repositorio, 'Concurrente530a1a');
  const resultados = await Promise.all([
    repositorio.actualizarPasswordObligatoria({
      idUsuario: concurrente.id,
      hashPasswordNuevo: 'hash-concurrente-a',
      versionSesionObservada: concurrente.versionSesion
    }),
    repositorio.actualizarPasswordObligatoria({
      idUsuario: concurrente.id,
      hashPasswordNuevo: 'hash-concurrente-b',
      versionSesionObservada: concurrente.versionSesion
    })
  ]);
  assert.equal(resultados.filter(Boolean).length, 1);
  const trasConcurrencia = await repositorio.buscarPorId(concurrente.id);
  assert.equal(trasConcurrencia.versionSesion, concurrente.versionSesion + 1);
}

async function verificarServicioConProyeccionRezagada() {
  const hashActual = await bcrypt.hash('temporal-segura', 4);
  let versionRecibida = null;
  let accesos = 0;
  const servicio = new ServicioAutenticacion({
    repositorioUsuarios: {
      async buscarPorId() {
        return {
          id: 81,
          activo: true,
          requiereCambioPassword: true,
          hashPassword: hashActual,
          versionSesion: 8
        };
      },
      async actualizarPasswordObligatoria({ versionSesionObservada }) {
        versionRecibida = versionSesionObservada;
        return null;
      },
      async registrarAccesoExitoso() {
        accesos += 1;
      }
    }
  });
  servicio.crearHashPassword = async () => 'hash-nuevo';

  await assert.rejects(
    servicio.completarCambioPasswordObligatorio({
      idUsuario: 81,
      versionSesionObservada: 7,
      passwordNuevo: 'otra-clave-segura',
      passwordConfirmacion: 'otra-clave-segura'
    }),
    ErrorPreautenticacionCambioPasswordNoVigente
  );
  assert.equal(versionRecibida, 7);
  assert.equal(accesos, 0);
}

async function verificarDestruccionContinuacionWeb() {
  let destrucciones = 0;
  let consumos = 0;
  let sesiones = 0;
  const servicioSesion = {
    async asegurarTokenCsrfPublico() { return 'csrf'; },
    async validarVersionSesionCambioPassword() { return true; },
    async destruirSesion() { destrucciones += 1; },
    async consumirSesionCambioPasswordPendiente() { consumos += 1; },
    async crearSesionUsuario() { sesiones += 1; }
  };
  const controlador = new ControladorLogin({
    servicioAutenticacion: {
      async completarCambioPasswordObligatorio(argumentos) {
        assert.equal(argumentos.versionSesionObservada, 5);
        throw new ErrorPreautenticacionCambioPasswordNoVigente();
      }
    },
    servicioSesion,
    configuracionSesion: { nombreCookie: 'sentinelia.sid' },
    servicioPow: null
  });
  const requisicion = {
    body: {
      password_nuevo: 'otra-clave-segura',
      password_confirmacion: 'otra-clave-segura'
    },
    session: {
      usuarioCambioPassword: {
        idUsuario: 12,
        usuario: 'Pendiente',
        versionSesion: 5
      }
    }
  };
  const respuesta = crearRespuestaFalsa();
  let errorPropagado = null;

  await controlador.procesarCambioPasswordObligatorio(
    requisicion,
    respuesta,
    (error) => { errorPropagado = error; }
  );

  assert.equal(errorPropagado, null);
  assert.equal(destrucciones, 1);
  assert.equal(consumos, 0);
  assert.equal(sesiones, 0);
  assert.equal(respuesta.cookieEliminada, 'sentinelia.sid');
  assert.equal(respuesta.destino, '/login');
  assert.equal(respuesta.renderizados, 0);
}

async function crearUsuario(repositorio, usuario) {
  return repositorio.crearUsuarioAdministrativo({
    usuario,
    email: `${usuario.toLowerCase()}@example.test`,
    hashPassword: 'hash-temporal',
    nombreMostrar: usuario,
    nombreCompleto: usuario,
    tenantId: null,
    empresaId: null,
    sitioId: null,
    permisos: permisosVacios(),
    requiereCambioPassword: true
  });
}

function crearRespuestaFalsa() {
  return {
    locals: {},
    cookieEliminada: null,
    destino: null,
    renderizados: 0,
    clearCookie(nombre) { this.cookieEliminada = nombre; },
    redirect(destino) { this.destino = destino; },
    status() { return this; },
    render() { this.renderizados += 1; }
  };
}

function permisosVacios() {
  return new Proxy({}, { get: () => false });
}

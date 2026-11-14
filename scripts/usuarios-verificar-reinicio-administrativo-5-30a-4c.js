import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { createClient } from 'redis';

import { RepositorioAuditoria }
  from '../paquetes/auditoria/src/RepositorioAuditoria.js';
import { ServicioAuditoriaOperativa }
  from '../paquetes/auditoria/src/ServicioAuditoriaOperativa.js';
import { generarUuidV7Auditoria }
  from '../paquetes/auditoria/src/UuidV7Auditoria.js';
import { RepositorioCoordinacionCorreoReinicioPasswordAdministrativoSql }
  from '../paquetes/correo/src/RepositorioCoordinacionCorreoReinicioPasswordAdministrativoSql.js';
import { ClienteSql } from '../paquetes/persistencia-sql/src/ClienteSql.js';
import { EjecutorMigraciones }
  from '../paquetes/persistencia-sql/src/EjecutorMigraciones.js';
import { FronteraTransaccionalLocal }
  from '../paquetes/persistencia-sql/src/FronteraTransaccionalLocal.js';
import { RepositorioMigraciones }
  from '../paquetes/persistencia-sql/src/RepositorioMigraciones.js';
import { ServicioSesion } from '../paquetes/sesiones/src/ServicioSesion.js';
import { RepositorioSesionesWebAuditoria }
  from '../paquetes/sesiones/src/RepositorioSesionesWebAuditoria.js';
import { VIAS_REINICIO_PASSWORD_ADMINISTRATIVO }
  from '../paquetes/usuarios/src/ContratoReinicioPasswordAdministrativo.js';
import { RepositorioReiniciosPasswordAdministrativosSql }
  from '../paquetes/usuarios/src/RepositorioReiniciosPasswordAdministrativosSql.js';
import { ServicioReinicioPasswordAdministrativo }
  from '../paquetes/usuarios/src/ServicioReinicioPasswordAdministrativo.js';
import { ServicioEstadoSensibleUsuario }
  from '../paquetes/usuarios/src/ServicioEstadoSensibleUsuario.js';
import { RepositorioUsuarios }
  from '../paquetes/usuarios/src/RepositorioUsuarios.js';
import {
  obtenerConfiguracionAplicacion,
  obtenerRutaMigraciones
} from '../paquetes/utilidades/src/configuracion/obtenerConfiguracionAplicacion.js';

const CONTEXTO = Object.freeze({
  idUsuario: '1', idUsuarioReal: '1', impersonacionActiva: false,
  nivelScope: 'portal', tenantId: null, empresaId: null, sitioId: null
});

async function main() {
  const configuracion = obtenerConfiguracionAplicacion();
  assert.equal(configuracion.sql.estaCompleta, true, '5.30a.4c necesita MariaDB real.');
  const administrador = new ClienteSql(configuracion.sql);
  const base = `sentinelia_fixture_530a4c_${randomBytes(5).toString('hex')}`;
  let sql;
  let redis;
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
    await crearUsuario(sql, 1, 'operador-530a4c');
    await verificarReplayYConvergencia(sql);
    await verificarScopeVigente(sql);
    await verificarDosInstancias(sql);
    await verificarReplayCorreoSinEntropia(sql);
    redis = createClient({ url: configuracion.redis.url });
    await redis.connect();
    await verificarVersionMonotona(redis, configuracion);
    await verificarComposicionPrivada();
    console.log(
      '[usuarios] OK 5.30a.4c: replay=sin_efectos scope=vigente ' +
      'postcommit=reintentable instancias=2 entropia_replay=0 ' +
      'version_redis=monotona bootstrap=puerto_privado'
    );
  } finally {
    await redis?.quit().catch(() => {});
    await sql?.cerrar().catch(() => {});
    await administrador.ejecutar(
      `DROP DATABASE IF EXISTS ${administrador.escaparIdentificador(base)}`
    ).catch(() => {});
    await administrador.cerrar();
  }
}

async function verificarReplayYConvergencia(sql) {
  const usuarioId = await crearUsuario(sql, null, 'replay-530a4c');
  const reinicioId = generarUuidV7Auditoria();
  const primeraSesion = new SesionFixture({ fallar: true });
  const primero = crearServicio(sql, { servicioSesion: primeraSesion });
  const inicial = await primero.servicio.reiniciarManual(
    entradaManual(reinicioId, usuarioId, 'PasswordManual_530a4c_Primera')
  );
  assert.equal(inicial.convergenciaPostcommit.completa, false);
  assert.deepEqual(inicial.convergenciaPostcommit.fallos,
    [{ componente: 'sesiones_redis' }]);

  const authReplay = new AutenticacionFixture();
  const segundaSesion = new SesionFixture();
  const segundo = crearServicio(sql, {
    servicioSesion: segundaSesion,
    autenticacion: authReplay
  });
  const repetido = await segundo.servicio.reiniciarManual(
    entradaManual(reinicioId, usuarioId, 'PasswordManual_530a4c_Distinta')
  );
  assert.equal(repetido.resultado.replay, true);
  assert.equal(repetido.convergenciaPostcommit.completa, true);
  assert.equal(authReplay.validaciones, 0);
  assert.equal(authReplay.hashes, 0);
  assert.equal(segundaSesion.versiones.at(-1), '2');
  assert.equal((await new RepositorioUsuarios(sql).buscarPorId(usuarioId)).hashPassword,
    'hash:PasswordManual_530a4c_Primera');
  assert.equal(await contar(sql, 'reinicios_password_administrativos',
    'usuario_id=?', [usuarioId]), 1);
  assert.equal(await contarEventoOperacion(sql, reinicioId), 1);
}

async function verificarScopeVigente(sql) {
  const usuarioId = await crearUsuario(sql, null, 'scope-530a4c');
  const reinicioId = generarUuidV7Auditoria();
  const entorno = crearServicio(sql);
  await entorno.servicio.reiniciarManual(
    entradaManual(reinicioId, usuarioId, 'PasswordManual_530a4c_Scope')
  );
  await assert.rejects(
    entorno.servicio.reiniciarManual({
      ...entradaManual(reinicioId, usuarioId, 'PasswordManual_530a4c_Scope2'),
      contextoUsuarioActual: {
        ...CONTEXTO, nivelScope: 'tenant', tenantId: '999'
      }
    }),
    /alcance visible/u
  );
}

async function verificarDosInstancias(sql) {
  const usuarioId = await crearUsuario(sql, null, 'instancias-530a4c');
  const reinicioId = generarUuidV7Auditoria();
  const uno = crearServicio(sql).servicio;
  const dos = crearServicio(sql).servicio;
  const resultados = await Promise.all([
    uno.reiniciarManual(
      entradaManual(reinicioId, usuarioId, 'PasswordManual_530a4c_Uno')
    ),
    dos.reiniciarManual(
      entradaManual(reinicioId, usuarioId, 'PasswordManual_530a4c_Dos')
    )
  ]);
  assert.deepEqual(resultados.map((r) => r.resultado.replay).sort(), [false, true]);
  assert.equal(await contar(sql, 'reinicios_password_administrativos',
    'usuario_id=?', [usuarioId]), 1);
  assert.equal(await contarEventoOperacion(sql, reinicioId), 1);
}

async function verificarReplayCorreoSinEntropia(sql) {
  const usuarioId = await crearUsuario(sql, null, 'correo-530a4c');
  const reinicioId = generarUuidV7Auditoria();
  const primero = crearServicio(sql, {
    passwords: ['PasswordCorreo_530a4c_Primera'],
    puedeDespachar: true
  });
  await primero.servicio.reiniciarCorreo(entradaCorreo(reinicioId, usuarioId));
  const generador = { llamadas: 0, generar() {
    this.llamadas += 1;
    throw new Error('No debe generarse entropía durante un replay.');
  } };
  const segundo = crearServicio(sql, { generador, puedeDespachar: true });
  const repetido = await segundo.servicio.reiniciarCorreo(
    entradaCorreo(reinicioId, usuarioId)
  );
  assert.equal(repetido.resultado.replay, true);
  assert.equal(generador.llamadas, 0);
  assert.equal(await contar(sql, 'cola_correos_salida',
    'reinicio_password_administrativo_id=UNHEX(?)',
    [reinicioId.replaceAll('-', '')]), 1);
}

async function verificarVersionMonotona(redis, configuracion) {
  const prefijo = `sentinelia:fixture:530a4c:${randomBytes(5).toString('hex')}:`;
  const servicio = new ServicioSesion({
    clienteRedis: redis,
    configuracionSesion: configuracion.sesion,
    configuracionRedis: {
      ...configuracion.redis,
      prefijoSesiones: `${prefijo}sesiones:`,
      prefijoVersionUsuario: `${prefijo}version:`
    }
  });
  try {
    assert.equal(await servicio.sincronizarVersionUsuario('77', '12'), '12');
    assert.equal(await servicio.sincronizarVersionUsuario('77', '9'), '12');
    assert.equal(await servicio.sincronizarVersionUsuario('77', '13'), '13');
    assert.equal(await redis.get(`${prefijo}version:77:version_sesion`), '13');
  } finally {
    const claves = [];
    for await (const clave of redis.scanIterator({ MATCH: `${prefijo}*` })) {
      claves.push(clave);
    }
    if (claves.length) await redis.del(claves);
  }
}

async function verificarComposicionPrivada() {
  const indice = await readFile(
    new URL('../apps/sentinelia-web/src/index.js', import.meta.url), 'utf8'
  );
  const controlador = await readFile(
    new URL('../apps/sentinelia-web/src/controladores/ControladorUsuarios.js',
      import.meta.url), 'utf8'
  );
  assert.match(indice, /new ServicioReinicioPasswordAdministrativo\(/u);
  assert.match(indice, /servicioReinicioPasswordAdministrativo/u);
  assert.match(controlador, /this\.servicioReinicioPasswordAdministrativo/u);
  assert.doesNotMatch(controlador, /reiniciarPasswordAdministrativo\s*\(/u);
}

function crearServicio(sql, {
  servicioSesion = new SesionFixture(),
  autenticacion = new AutenticacionFixture(),
  passwords = ['PasswordCorreo_530a4c_Defecto'],
  generador = null,
  puedeDespachar = false
} = {}) {
  let indice = 0;
  const estadoSensible = new ServicioEstadoSensibleUsuario({
    repositorioOperacionesEmail: {
      async adquirirBloqueoUsuario() { return 'lease-fixture'; },
      async liberarBloqueoUsuario() {},
      async invalidarOperacionUsuario() { return 0; }
    },
    servicioAutorizacionPerfil: {
      async revocarTodasLasAutorizaciones() { return { total: 0 }; }
    }
  });
  return {
    servicio: new ServicioReinicioPasswordAdministrativo({
      repositorioUsuarios: new RepositorioUsuarios(sql),
      repositorioOperaciones: new RepositorioReiniciosPasswordAdministrativosSql(sql),
      repositorioCoordinacionCorreo:
        new RepositorioCoordinacionCorreoReinicioPasswordAdministrativoSql(sql),
      repositorioSesionesWeb: new RepositorioSesionesWebAuditoria(sql),
      servicioSesion,
      evaluadorAutoridadCorreoSql: {
        async evaluarEnTransaccion() {
          return { puedeDespachar,
            lectura: { valores: new Map([['portal.nombre_visible', 'Sentinelia']]) } };
        }
      },
      servicioAutenticacion: autenticacion,
      servicioEstadoSensibleUsuario: estadoSensible,
      servicioAuditoria: new ServicioAuditoriaOperativa({
        repositorioAuditoria: new RepositorioAuditoria(sql)
      }),
      fronteraTransaccional: new FronteraTransaccionalLocal(sql),
      ahora: () => new Date('2026-09-08T20:00:00.000Z'),
      generadorPasswordProvisional: generador || {
        generar() { return passwords[indice++]; }
      }
    })
  };
}

class AutenticacionFixture {
  constructor() { this.validaciones = 0; this.hashes = 0; }
  obtenerLongitudMinimaPassword() { return 24; }
  validarPasswordNueva(password, confirmacion) {
    this.validaciones += 1;
    assert.equal(password, confirmacion);
  }
  async crearHashPassword(password) {
    this.hashes += 1;
    return `hash:${password}`;
  }
}

class SesionFixture {
  constructor({ fallar = false } = {}) { this.fallar = fallar; this.versiones = []; }
  async invalidarSesionesUsuario(_usuarioId, versionSesion) {
    this.versiones.push(String(versionSesion));
    if (this.fallar) throw new Error('fixture Redis posterior al commit');
    return { sesionesEliminadas: 0, versionSesion: Number(versionSesion) };
  }
}

function entradaManual(reinicioId, usuarioId, password) {
  return {
    contextoUsuarioActual: CONTEXTO, reinicioId, usuarioId,
    viaEsperada: VIAS_REINICIO_PASSWORD_ADMINISTRATIVO.MANUAL,
    password, passwordConfirmacion: password
  };
}

function entradaCorreo(reinicioId, usuarioId) {
  return {
    contextoUsuarioActual: CONTEXTO, reinicioId, usuarioId,
    viaEsperada: VIAS_REINICIO_PASSWORD_ADMINISTRATIVO.CORREO
  };
}

async function crearUsuario(sql, id, usuario) {
  const [resultado] = await sql.ejecutar(
    `INSERT INTO usuarios (
       id,usuario,email,hash_password,activo,email_validado,
       requiere_cambio_password,version_sesion,generacion_recuperacion
     ) VALUES (?,?,?,?,1,1,0,1,1)`,
    [id, usuario, `${usuario}@example.test`, 'hash-anterior']
  );
  return String(id || resultado.insertId);
}

async function contar(sql, tabla, condicion, parametros) {
  const [fila] = await sql.consultar(
    `SELECT COUNT(*) AS total FROM ${tabla} WHERE ${condicion}`, parametros
  );
  return Number(fila.total);
}

async function contarEventoOperacion(sql, reinicioId) {
  const operacion = await new RepositorioReiniciosPasswordAdministrativosSql(sql)
    .buscarPorId(reinicioId);
  return contar(sql, 'eventos_auditoria', 'evento_id=UNHEX(?)', [
    operacion.eventoAuditoriaId.replaceAll('-', '')
  ]);
}

await main();

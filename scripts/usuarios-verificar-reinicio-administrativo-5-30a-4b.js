import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';

import { RepositorioAuditoria }
  from '../paquetes/auditoria/src/RepositorioAuditoria.js';
import { ServicioAuditoriaOperativa }
  from '../paquetes/auditoria/src/ServicioAuditoriaOperativa.js';
import { generarUuidV7Auditoria }
  from '../paquetes/auditoria/src/UuidV7Auditoria.js';
import { RepositorioCoordinacionCorreoReinicioPasswordAdministrativoSql }
  from '../paquetes/correo/src/RepositorioCoordinacionCorreoReinicioPasswordAdministrativoSql.js';
import { extraerPasswordProvisionalMensajeReinicioAdministrativo }
  from '../paquetes/correo/src/CodecMensajeReinicioPasswordAdministrativo.js';
import { ClienteSql } from '../paquetes/persistencia-sql/src/ClienteSql.js';
import { EjecutorMigraciones }
  from '../paquetes/persistencia-sql/src/EjecutorMigraciones.js';
import { FronteraTransaccionalLocal }
  from '../paquetes/persistencia-sql/src/FronteraTransaccionalLocal.js';
import { RepositorioMigraciones }
  from '../paquetes/persistencia-sql/src/RepositorioMigraciones.js';
import { RepositorioSesionesWebAuditoria }
  from '../paquetes/sesiones/src/RepositorioSesionesWebAuditoria.js';
import { VIAS_REINICIO_PASSWORD_ADMINISTRATIVO }
  from '../paquetes/usuarios/src/ContratoReinicioPasswordAdministrativo.js';
import { RepositorioReiniciosPasswordAdministrativosSql }
  from '../paquetes/usuarios/src/RepositorioReiniciosPasswordAdministrativosSql.js';
import {
  ErrorViaReinicioPasswordAdministrativo,
  ServicioReinicioPasswordAdministrativo
} from '../paquetes/usuarios/src/ServicioReinicioPasswordAdministrativo.js';
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
const FECHA = '2026-09-08T19:00:00.000Z';

async function main() {
  const configuracion = obtenerConfiguracionAplicacion();
  assert.equal(configuracion.sql.estaCompleta, true, '5.30a.4b necesita MariaDB real.');
  const administrador = new ClienteSql(configuracion.sql);
  const base = `sentinelia_fixture_530a4b_${randomBytes(5).toString('hex')}`;
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
    await crearUsuario(sql, 1, 'operador-530a4b', 'operador@example.test', true, true);
    await verificarCorreoSinValidacion(sql);
    await verificarCorreoDurableInvalido(sql);
    await verificarSalidaRechazada(sql);
    await verificarOrdenDeReinicios(sql);
    console.log(
      '[usuarios] OK 5.30a.4b: via=correo atomica=credencial+salida+auditoria+' +
      'sesiones+operacion email_validado=no_bloquea buzon_invalido=fail_closed ' +
      'rollback=salida_rechazada secreto=no_expuesto obsolescencia=ultimo_commit_gana'
    );
  } finally {
    await sql?.cerrar().catch(() => {});
    await administrador.ejecutar(
      `DROP DATABASE IF EXISTS ${administrador.escaparIdentificador(base)}`
    ).catch(() => {});
    await administrador.cerrar();
  }
}

async function verificarCorreoSinValidacion(sql) {
  const usuarioId = await crearUsuario(
    sql, null, 'objetivo-no-validado', 'NoValidado@Example.Test', true, false
  );
  const passwords = ['PasswordProvisional_530a4b_A'];
  const servicio = crearServicio(sql, { passwords });
  const reinicioId = generarUuidV7Auditoria();
  const respuesta = await servicio.reiniciarCorreo(entrada(reinicioId, usuarioId));
  const usuario = await new RepositorioUsuarios(sql).buscarPorId(usuarioId);
  const [salida] = await sql.consultar(
    'SELECT * FROM cola_correos_salida WHERE reinicio_password_administrativo_id=UNHEX(?)',
    [reinicioId.replaceAll('-', '')]
  );
  assert.equal(usuario.emailValidado, false);
  assert.equal(usuario.hashPassword, `hash:${passwords[0]}`);
  assert.equal(usuario.requiereCambioPassword, true);
  assert.equal(Number(usuario.versionSesion), 2);
  assert.equal(usuario.generacionRecuperacion, '2');
  assert.equal(salida.destinatario_email, 'NoValidado@example.test');
  assert.equal(salida.estado, 'pendiente');
  assert.equal(extraerPasswordProvisionalMensajeReinicioAdministrativo({
    asunto: salida.asunto, cuerpoTexto: salida.cuerpo_texto
  }), passwords[0]);
  assert.equal(respuesta.resultado.operacion.salidaCorreoId, String(salida.id));
  assert.doesNotMatch(JSON.stringify(respuesta), /PasswordProvisional|hash:/u);

  await sql.ejecutar(
    `UPDATE cola_correos_salida SET estado='error_final',
       codigo_resultado='smtp_fixture',fecha_terminal_utc=UTC_TIMESTAMP(3)
     WHERE id=?`,
    [salida.id]
  );
  assert.equal((await new RepositorioUsuarios(sql).buscarPorId(usuarioId)).hashPassword,
    `hash:${passwords[0]}`);
}

async function verificarCorreoDurableInvalido(sql) {
  const usuarioId = await crearUsuario(sql, null, 'objetivo-invalido', 'sin-arroba', true, true);
  const reinicioId = generarUuidV7Auditoria();
  await assert.rejects(
    crearServicio(sql).reiniciarCorreo(entrada(reinicioId, usuarioId)),
    /buzón|correo|email/iu
  );
  await exigirSinEfectos(sql, usuarioId, reinicioId);
}

async function verificarSalidaRechazada(sql) {
  const usuarioId = await crearUsuario(
    sql, null, 'objetivo-salida', 'salida@example.test', true, true
  );
  const reinicioId = generarUuidV7Auditoria();
  const coordinacion = new RepositorioCoordinacionCorreoReinicioPasswordAdministrativoSql(sql);
  await assert.rejects(
    crearServicio(sql, { coordinacion: {
      async crearSalidaEnTransaccion(...args) {
        await coordinacion.crearSalidaEnTransaccion(...args);
        throw new Error('fixture salida rechazada');
      }
    } }).reiniciarCorreo(entrada(reinicioId, usuarioId)),
    /salida rechazada/u
  );
  await exigirSinEfectos(sql, usuarioId, reinicioId);
  assert.equal(await contar(sql, 'cola_correos_salida',
    'reinicio_password_administrativo_id=UNHEX(?)', [reinicioId.replaceAll('-', '')]), 0);
}

async function verificarOrdenDeReinicios(sql) {
  const usuarioId = await crearUsuario(
    sql, null, 'objetivo-orden', 'orden@example.test', true, true
  );
  const passwords = [
    'PasswordProvisional_530a4b_B',
    'PasswordProvisional_530a4b_C'
  ];
  const servicio = crearServicio(sql, { passwords });
  const primero = generarUuidV7Auditoria();
  const segundo = generarUuidV7Auditoria();
  await servicio.reiniciarCorreo(entrada(primero, usuarioId));
  await servicio.reiniciarCorreo(entrada(segundo, usuarioId));
  const usuario = await new RepositorioUsuarios(sql).buscarPorId(usuarioId);
  assert.equal(usuario.hashPassword, `hash:${passwords[1]}`);
  assert.equal(Number(usuario.versionSesion), 3);
  assert.equal(usuario.generacionRecuperacion, '3');
  const salidas = await sql.consultar(
    `SELECT asunto,cuerpo_texto FROM cola_correos_salida
      WHERE reinicio_password_administrativo_id IN (UNHEX(?),UNHEX(?)) ORDER BY id`,
    [primero.replaceAll('-', ''), segundo.replaceAll('-', '')]
  );
  assert.deepEqual(salidas.map((salida) =>
    extraerPasswordProvisionalMensajeReinicioAdministrativo({
      asunto: salida.asunto, cuerpoTexto: salida.cuerpo_texto
    })), passwords);
}

function crearServicio(sql, {
  passwords = ['PasswordProvisional_530a4b_D'],
  coordinacion = new RepositorioCoordinacionCorreoReinicioPasswordAdministrativoSql(sql)
} = {}) {
  let indice = 0;
  return new ServicioReinicioPasswordAdministrativo({
    repositorioUsuarios: new RepositorioUsuarios(sql),
    repositorioOperaciones: new RepositorioReiniciosPasswordAdministrativosSql(sql),
    repositorioCoordinacionCorreo: coordinacion,
    repositorioSesionesWeb: new RepositorioSesionesWebAuditoria(sql),
    servicioSesion: {
      async invalidarSesionesUsuario(_usuarioId, versionSesion) {
        return { sesionesEliminadas: 0, versionSesion: String(versionSesion) };
      }
    },
    evaluadorAutoridadCorreoSql: {
      async evaluarEnTransaccion() {
        return {
          puedeDespachar: true,
          lectura: { valores: new Map([['portal.nombre_visible', 'Sentinelia fixture']]) }
        };
      }
    },
    servicioAutenticacion: {
      obtenerLongitudMinimaPassword() { return 24; },
      validarPasswordNueva(password, confirmacion) {
        assert.equal(password, confirmacion);
        assert.match(password, /^[A-Za-z0-9_-]{24,72}$/u);
      },
      async crearHashPassword(password) { return `hash:${password}`; }
    },
    servicioEstadoSensibleUsuario: crearEstadoSensible(),
    servicioAuditoria: new ServicioAuditoriaOperativa({
      repositorioAuditoria: new RepositorioAuditoria(sql)
    }),
    fronteraTransaccional: new FronteraTransaccionalLocal(sql),
    ahora: () => new Date(FECHA),
    generadorPasswordProvisional: {
      generar() { return passwords[indice++]; }
    }
  });
}

function crearEstadoSensible() {
  return new ServicioEstadoSensibleUsuario({
    repositorioOperacionesEmail: {
      async adquirirBloqueoUsuario() { return 'lease-fixture'; },
      async liberarBloqueoUsuario() {},
      async invalidarOperacionUsuario() { return 0; }
    },
    servicioAutorizacionPerfil: {
      async revocarTodasLasAutorizaciones() { return { total: 0 }; }
    }
  });
}

function entrada(reinicioId, usuarioId) {
  return {
    contextoUsuarioActual: CONTEXTO,
    reinicioId,
    usuarioId,
    viaEsperada: VIAS_REINICIO_PASSWORD_ADMINISTRATIVO.CORREO
  };
}

async function crearUsuario(sql, id, usuario, email, activo, validado) {
  const [resultado] = await sql.ejecutar(
    `INSERT INTO usuarios (
       id,usuario,email,hash_password,activo,email_validado,
       requiere_cambio_password,version_sesion,generacion_recuperacion
     ) VALUES (?,?,?,?,?,?,0,1,1)`,
    [id, usuario, email, 'hash-anterior', activo ? 1 : 0, validado ? 1 : 0]
  );
  return String(id || resultado.insertId);
}

async function exigirSinEfectos(sql, usuarioId, reinicioId) {
  const usuario = await new RepositorioUsuarios(sql).buscarPorId(usuarioId);
  assert.equal(usuario.hashPassword, 'hash-anterior');
  assert.equal(Number(usuario.versionSesion), 1);
  assert.equal(usuario.generacionRecuperacion, '1');
  assert.equal(await new RepositorioReiniciosPasswordAdministrativosSql(sql)
    .buscarPorId(reinicioId), null);
}

async function contar(sql, tabla, condicion = '1=1', parametros = []) {
  const [fila] = await sql.consultar(
    `SELECT COUNT(*) AS total FROM ${tabla} WHERE ${condicion}`, parametros
  );
  return Number(fila.total);
}

await main();

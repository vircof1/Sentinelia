import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';

import { RepositorioAuditoria }
  from '../paquetes/auditoria/src/RepositorioAuditoria.js';
import { ServicioAuditoriaOperativa }
  from '../paquetes/auditoria/src/ServicioAuditoriaOperativa.js';
import { generarUuidV7Auditoria }
  from '../paquetes/auditoria/src/UuidV7Auditoria.js';
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

const CONTEXTO_PORTAL = Object.freeze({
  idUsuario: '1',
  idUsuarioReal: '1',
  impersonacionActiva: false,
  nivelScope: 'portal',
  tenantId: null,
  empresaId: null,
  sitioId: null
});

async function main() {
  const configuracion = obtenerConfiguracionAplicacion();
  assert.equal(configuracion.sql.estaCompleta, true, '5.30a.4a necesita MariaDB real.');
  const administrador = new ClienteSql(configuracion.sql);
  const base = `sentinelia_fixture_530a4a_${randomBytes(5).toString('hex')}`;
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
    await crearUsuario(sql, 1, 'operador-530a4a', true);
    await verificarCasoFeliz(sql);
    await verificarCambioCanal(sql);
    await verificarObjetivoRetirado(sql);
    await verificarRollbackAuditoria(sql);
    await verificarRollbackSesiones(sql);
    await verificarRollbackConfirmacion(sql);

    console.log(
      '[usuarios] OK 5.30a.4a: via=manual_autoritativa ' +
      'commit=credencial+generaciones+auditoria+sesiones+operacion ' +
      'scope=for_update objetivo=ajeno cambio_canal=409 ' +
      'rollback=auditoria+sesiones+confirmacion correo=ausente secreto=no_expuesto'
    );
  } finally {
    await sql?.cerrar().catch(() => {});
    await administrador.ejecutar(
      `DROP DATABASE IF EXISTS ${administrador.escaparIdentificador(base)}`
    ).catch(() => {});
    await administrador.cerrar();
  }
}

async function verificarCasoFeliz(sql) {
  const usuarioId = await crearUsuario(sql, null, 'objetivo-feliz', true);
  const sesiones = new RepositorioSesionesWebAuditoria(sql);
  const sesionId = generarUuidV7Auditoria();
  await sesiones.abrirAtomica({
    sesionAuditoriaId: sesionId,
    usuarioRealId: usuarioId,
    usuarioEfectivoId: usuarioId,
    versionSesionReal: 1,
    versionSesionEfectiva: 1,
    scopeApertura: scopePortal(),
    scopeEfectivoActual: scopePortal()
  });
  const entorno = crearServicio(sql, { repositorioSesionesWeb: sesiones });
  const reinicioId = generarUuidV7Auditoria();
  const resultado = await entorno.servicio.reiniciarManual(entrada({
    reinicioId, usuarioId
  }));
  const usuario = await new RepositorioUsuarios(sql).buscarPorId(usuarioId);
  assert.equal(usuario.hashPassword, 'hash:Temporal_530a4a_segura');
  assert.equal(usuario.requiereCambioPassword, true);
  assert.equal(Number(usuario.versionSesion), 2);
  assert.equal(usuario.generacionRecuperacion, '2');
  assert.equal((await sesiones.buscarPorId(sesionId)).estado, 'invalidada');
  assert.equal(resultado.resultado.operacion.reinicioId, reinicioId);
  assert.equal(resultado.resultado.operacion.via, 'manual');
  assert.equal(resultado.resultado.sesionesInvalidadas.length, 1);
  assert.equal(resultado.limpiezaEstadoSensible.completa, true);
  assert.equal(entorno.estadoSensible.invalidaciones, 2);
  assert.equal(await contar(sql, 'cola_correos_salida'), 0);
  assert.equal(await contar(sql, 'eventos_auditoria', 'evento_id=?', [
    Buffer.from(resultado.resultado.operacion.eventoAuditoriaId.replaceAll('-', ''), 'hex')
  ]), 1);
  assert.doesNotMatch(JSON.stringify(resultado), /Temporal_530a4a_segura|hash:/u);
}

async function verificarCambioCanal(sql) {
  const usuarioId = await crearUsuario(sql, null, 'objetivo-canal', true);
  const reinicioId = generarUuidV7Auditoria();
  const { servicio } = crearServicio(sql, { puedeDespachar: true });
  await assert.rejects(
    servicio.reiniciarManual(entrada({ reinicioId, usuarioId })),
    (error) => error instanceof ErrorViaReinicioPasswordAdministrativo &&
      error.codigo === 'VIA_REINICIO_PASSWORD_CAMBIADA' && error.statusCode === 409
  );
  await exigirSinEfectos(sql, { usuarioId, reinicioId });
}

async function verificarObjetivoRetirado(sql) {
  const usuarioId = await crearUsuario(sql, null, 'objetivo-inactivo', false);
  const reinicioId = generarUuidV7Auditoria();
  const { servicio } = crearServicio(sql);
  await assert.rejects(
    servicio.reiniciarManual(entrada({ reinicioId, usuarioId })),
    /alcance vigente/u
  );
  await exigirSinEfectos(sql, { usuarioId, reinicioId });

  const movidoId = await crearUsuario(sql, null, 'objetivo-movido', true);
  const movidoReinicioId = generarUuidV7Auditoria();
  await assert.rejects(
    servicio.reiniciarManual({
      ...entrada({ reinicioId: movidoReinicioId, usuarioId: movidoId }),
      contextoUsuarioActual: {
        ...CONTEXTO_PORTAL, nivelScope: 'tenant', tenantId: '999'
      }
    }),
    /alcance vigente/u
  );
  await exigirSinEfectos(sql, {
    usuarioId: movidoId, reinicioId: movidoReinicioId
  });
}

async function verificarRollbackAuditoria(sql) {
  const usuarioId = await crearUsuario(sql, null, 'objetivo-auditoria', true);
  const reinicioId = generarUuidV7Auditoria();
  const { servicio } = crearServicio(sql, {
    servicioAuditoria: { async registrarEnTransaccion() {
      throw new Error('fixture fallo auditoria');
    } }
  });
  await assert.rejects(
    servicio.reiniciarManual(entrada({ reinicioId, usuarioId })),
    /fallo auditoria/u
  );
  await exigirSinEfectos(sql, { usuarioId, reinicioId });
}

async function verificarRollbackSesiones(sql) {
  const usuarioId = await crearUsuario(sql, null, 'objetivo-sesiones', true);
  const reinicioId = generarUuidV7Auditoria();
  const { servicio } = crearServicio(sql, {
    repositorioSesionesWeb: { async invalidarVigentesPorUsuariosEnTransaccion() {
      throw new Error('fixture fallo sesiones');
    } }
  });
  await assert.rejects(
    servicio.reiniciarManual(entrada({ reinicioId, usuarioId })),
    /fallo sesiones/u
  );
  await exigirSinEfectos(sql, { usuarioId, reinicioId });
}

async function verificarRollbackConfirmacion(sql) {
  const usuarioId = await crearUsuario(sql, null, 'objetivo-confirmacion', true);
  const reinicioId = generarUuidV7Auditoria();
  const operaciones = new RepositorioReiniciosPasswordAdministrativosSql(sql);
  const { servicio } = crearServicio(sql, {
    repositorioOperaciones: {
      reservarEnTransaccion: (...args) => operaciones.reservarEnTransaccion(...args),
      buscarPorId: (...args) => operaciones.buscarPorId(...args),
      buscarPorIdEnTransaccion: (...args) =>
        operaciones.buscarPorIdEnTransaccion(...args),
      async confirmarEnTransaccion() {
        throw new Error('fixture fallo confirmacion');
      }
    }
  });
  await assert.rejects(
    servicio.reiniciarManual(entrada({ reinicioId, usuarioId })),
    /fallo confirmacion/u
  );
  await exigirSinEfectos(sql, { usuarioId, reinicioId });
}

function crearServicio(sql, {
  puedeDespachar = false,
  repositorioSesionesWeb = new RepositorioSesionesWebAuditoria(sql),
  servicioAuditoria = new ServicioAuditoriaOperativa({
    repositorioAuditoria: new RepositorioAuditoria(sql)
  }),
  repositorioOperaciones = new RepositorioReiniciosPasswordAdministrativosSql(sql)
} = {}) {
  const estadoSensible = new EstadoSensibleFixture();
  return {
    estadoSensible,
    servicio: new ServicioReinicioPasswordAdministrativo({
      repositorioUsuarios: new RepositorioUsuarios(sql),
      repositorioOperaciones,
      repositorioSesionesWeb,
      servicioSesion: {
        async invalidarSesionesUsuario(_usuarioId, versionSesion) {
          return { sesionesEliminadas: 0, versionSesion: String(versionSesion) };
        }
      },
      evaluadorAutoridadCorreoSql: {
        async evaluarEnTransaccion() { return { puedeDespachar }; }
      },
      servicioAutenticacion: {
        obtenerLongitudMinimaPassword() { return 24; },
        validarPasswordNueva(password, confirmacion) {
          assert.equal(password, confirmacion);
        },
        async crearHashPassword(password) { return `hash:${password}`; }
      },
      servicioEstadoSensibleUsuario: estadoSensible.servicio,
      servicioAuditoria,
      fronteraTransaccional: new FronteraTransaccionalLocal(sql),
      ahora: () => new Date('2026-09-08T18:00:00.000Z')
    })
  };
}

class EstadoSensibleFixture {
  constructor() {
    this.invalidaciones = 0;
    this.servicio = new ServicioEstadoSensibleUsuario({
      repositorioOperacionesEmail: {
        async adquirirBloqueoUsuario() { return 'lease-fixture'; },
        async liberarBloqueoUsuario() {},
        invalidarOperacionUsuario: async () => {
          this.invalidaciones += 1;
          return 0;
        }
      },
      servicioAutorizacionPerfil: {
        revocarTodasLasAutorizaciones: async () => {
          this.invalidaciones += 1;
          return { total: 0 };
        }
      }
    });
  }
}

function entrada({ reinicioId, usuarioId }) {
  return {
    contextoUsuarioActual: CONTEXTO_PORTAL,
    reinicioId,
    usuarioId,
    viaEsperada: VIAS_REINICIO_PASSWORD_ADMINISTRATIVO.MANUAL,
    password: 'Temporal_530a4a_segura',
    passwordConfirmacion: 'Temporal_530a4a_segura'
  };
}

async function crearUsuario(sql, id, usuario, activo) {
  const [resultado] = await sql.ejecutar(
    `INSERT INTO usuarios (
       id,usuario,email,hash_password,activo,email_validado,
       requiere_cambio_password,version_sesion,generacion_recuperacion
     ) VALUES (?,?,?,?,?,1,0,1,1)`,
    [id, usuario, `${usuario}@example.test`, 'hash-anterior', activo ? 1 : 0]
  );
  return String(id || resultado.insertId);
}

async function exigirSinEfectos(sql, { usuarioId, reinicioId }) {
  const usuario = await new RepositorioUsuarios(sql).buscarPorId(usuarioId);
  assert.equal(usuario.hashPassword, 'hash-anterior');
  assert.equal(Number(usuario.versionSesion), 1);
  assert.equal(usuario.generacionRecuperacion, '1');
  assert.equal(
    await new RepositorioReiniciosPasswordAdministrativosSql(sql)
      .buscarPorId(reinicioId),
    null
  );
}

function scopePortal() {
  return { tenantId: null, empresaId: null, sitioId: null };
}

async function contar(sql, tabla, condicion = '1=1', parametros = []) {
  const [fila] = await sql.consultar(
    `SELECT COUNT(*) AS total FROM ${tabla} WHERE ${condicion}`, parametros
  );
  return Number(fila.total);
}

await main();

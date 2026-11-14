import assert from 'node:assert/strict';
import { ServicioAutorizacion } from '../paquetes/autorizacion/src/ServicioAutorizacion.js';
import { PermisosUsuario } from '../paquetes/autorizacion/src/PermisosUsuario.js';
import { ClienteSql } from '../paquetes/persistencia-sql/src/ClienteSql.js';
import { EjecutorMigraciones } from '../paquetes/persistencia-sql/src/EjecutorMigraciones.js';
import { RepositorioMigraciones } from '../paquetes/persistencia-sql/src/RepositorioMigraciones.js';
import { AsignadorPermisosUsuario } from '../paquetes/usuarios/src/AsignadorPermisosUsuario.js';
import { ControladorBootstrapUsuarioInicial } from '../paquetes/usuarios/src/ControladorBootstrapUsuarioInicial.js';
import { RepositorioUsuarios } from '../paquetes/usuarios/src/RepositorioUsuarios.js';
import { ServicioUsuarios } from '../paquetes/usuarios/src/ServicioUsuarios.js';
import {
  obtenerConfiguracionAplicacion,
  obtenerRutaMigraciones
} from '../paquetes/utilidades/src/configuracion/obtenerConfiguracionAplicacion.js';

const sufijo = `${Date.now()}-${process.pid}`;
const usuariosPrueba = [
  `audit-default-${sufijo}`,
  `audit-bootstrap-${sufijo}`,
  `audit-admin-${sufijo}`
];

async function main() {
  const configuracion = obtenerConfiguracionAplicacion();
  assert.equal(configuracion.sql.estaCompleta, true, 'La verificación 5.21.4d requiere SQL local.');
  const clienteSql = new ClienteSql(configuracion.sql);
  let errorPrincipal = null;
  try {
    await asegurarMigraciones(clienteSql);
    const snapshot = await fotografiarUsuariosExistentes(clienteSql);
    await asegurarMigraciones(clienteSql);
    assert.deepEqual(
      await fotografiarUsuariosExistentes(clienteSql),
      snapshot,
      'Reejecutar migraciones no puede alterar permisos existentes.'
    );
    await verificarDefinicionSql(clienteSql);
    await verificarModeloYAutorizacion();
    await verificarDelegacion();
    await verificarDenegacionPorDefecto(clienteSql);
    await verificarBootstrapExplicito();
    await verificarAltaAdministrativaDenegada(clienteSql);
  } catch (error) {
    errorPrincipal = error;
  } finally {
    try {
      await limpiarUsuariosPrueba(clienteSql);
    } catch (errorLimpieza) {
      if (!errorPrincipal) throw errorLimpieza;
      console.error('[auditoria] Error adicional limpiando usuarios de prueba');
      console.error(errorLimpieza);
    }
    await clienteSql.cerrar();
  }
  if (errorPrincipal) throw errorPrincipal;
  console.log('[auditoria] OK 5.21.4d: default=denegado existentes=conservados bootstrap=concedido delegacion=no_escalable');
}

async function asegurarMigraciones(clienteSql) {
  const ejecutor = new EjecutorMigraciones({
    clienteSql,
    repositorioMigraciones: new RepositorioMigraciones(clienteSql),
    rutaMigraciones: obtenerRutaMigraciones()
  });
  await ejecutor.ejecutarPendientes();
  await ejecutor.ejecutarPendientes();
}

async function verificarDefinicionSql(clienteSql) {
  const [columna] = await clienteSql.consultar(
    `SELECT COLUMN_TYPE AS tipo, IS_NULLABLE AS nullable, COLUMN_DEFAULT AS valor_por_defecto
     FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE()
       AND TABLE_NAME = 'usuarios'
       AND COLUMN_NAME = 'permiso_ver_auditoria'`
  );
  assert.equal(columna.tipo.toLowerCase(), 'tinyint(1)');
  assert.equal(columna.nullable, 'NO');
  assert.equal(String(columna.valor_por_defecto), '0');

}

function verificarModeloYAutorizacion() {
  const denegados = new PermisosUsuario({});
  const concedidos = new PermisosUsuario({ verAuditoria: true });
  assert.equal(denegados.serializar().verAuditoria, false);
  assert.equal(concedidos.serializar().verAuditoria, true);
  assert.equal(concedidos.listarActivos().includes('verAuditoria'), true);

  const autorizacion = new ServicioAutorizacion();
  assert.equal(autorizacion.puedeVerAuditoria({ permisos: denegados }), false);
  assert.equal(autorizacion.resolverPermiso('ver_auditoria', { permisos: concedidos }), true);
}

function verificarDelegacion() {
  const asignador = new AsignadorPermisosUsuario();
  assert.equal(asignador.construirPermisosIniciales().verAuditoria, 0);
  assert.equal(
    asignador.obtenerDefinicionesPermisos().some(
      ({ claveFormulario }) => claveFormulario === 'permiso_ver_auditoria'
    ),
    true
  );

  const servicio = Object.create(ServicioUsuarios.prototype);
  servicio.asignadorPermisosUsuario = asignador;
  servicio.servicioAutorizacion = new ServicioAutorizacion();
  const sinPermiso = { permisos: new PermisosUsuario({}) };
  const conPermiso = { permisos: new PermisosUsuario({ verAuditoria: true }) };
  assert.equal(servicio.puedeOtorgarClavePermiso(sinPermiso, 'permiso_ver_auditoria'), false);
  assert.equal(servicio.puedeOtorgarClavePermiso(conPermiso, 'permiso_ver_auditoria'), true);
  assert.equal(
    servicio.construirPermisosObjetivoDesdeFormulario({
      contextoUsuarioActual: sinPermiso,
      datos: { permiso_ver_auditoria: '1', nivelScope: 'portal' }
    }).verAuditoria,
    0,
    'Un actor sin permiso no puede fabricarlo desde el formulario.'
  );
  assert.equal(
    servicio.construirPermisosObjetivoDesdeFormulario({
      contextoUsuarioActual: conPermiso,
      datos: { permiso_ver_auditoria: '1', nivelScope: 'portal' }
    }).verAuditoria,
    1
  );
}

async function verificarDenegacionPorDefecto(clienteSql) {
  await clienteSql.ejecutar(
    'INSERT INTO usuarios (usuario, email, hash_password) VALUES (?, ?, ?)',
    [usuariosPrueba[0], `${usuariosPrueba[0]}@example.invalid`, 'hash-no-utilizable']
  );
  const [fila] = await clienteSql.consultar(
    'SELECT permiso_ver_auditoria FROM usuarios WHERE usuario = ?',
    [usuariosPrueba[0]]
  );
  assert.equal(Number(fila.permiso_ver_auditoria), 0);
}

async function verificarBootstrapExplicito() {
  let altaSolicitada = null;
  let intencionAuditable = null;
  const conexion = { execute() {} };
  const controlador = new ControladorBootstrapUsuarioInicial({
    repositorioUsuarios: {
      async contarUsuarios() { return 0; },
      async crearUsuarioInicialEnTransaccion(datos, opciones) {
        assert.equal(opciones.conexion, conexion);
        altaSolicitada = datos;
        return { creado: true, usuarioId: '101', totalUsuarios: 1 };
      }
    },
    servicioAutenticacion: {
      validarPasswordNueva() {},
      async crearHashPassword() { return 'hash-bootstrap'; }
    },
    configuracionUsuarioInicial: {
      usuario: 'primero',
      password: 'Password-bootstrap-segura-1',
      email: 'primero@example.invalid',
      nombreMostrar: 'Primer administrador'
    },
    fronteraTransaccional: {
      async ejecutar(trabajo) { return trabajo(conexion); }
    },
    servicioAuditoria: {
      async registrarEnTransaccion({ intencion }, opciones) {
        assert.equal(opciones.conexion, conexion);
        intencionAuditable = intencion;
      }
    }
  });
  assert.equal((await controlador.arrancarSiProcede()).creado, true);
  assert.equal(altaSolicitada.usuario, 'primero');
  assert.equal(intencionAuditable.tipo, 'usuario.creado');
  assert.equal(intencionAuditable.payload.despues.permisoVerAuditoria, true);
}

async function verificarAltaAdministrativaDenegada(clienteSql) {
  const repositorio = new RepositorioUsuarios(clienteSql);
  const asignador = new AsignadorPermisosUsuario();
  const usuario = await repositorio.crearUsuarioAdministrativo({
    usuario: usuariosPrueba[2],
    email: `${usuariosPrueba[2]}@example.invalid`,
    hashPassword: 'hash-administrativo-no-utilizable',
    nombreMostrar: 'Administrativo de prueba',
    nombreCompleto: null,
    tenantId: null,
    empresaId: null,
    sitioId: null,
    permisos: asignador.construirPermisosIniciales()
  });
  assert.equal(usuario.permisos.verAuditoria, false);
  const permisosActualizados = asignador.construirPermisosIniciales();
  permisosActualizados.verAuditoria = 1;
  const actualizado = await repositorio.actualizarUsuarioAdministrativo({
    idUsuario: usuario.id,
    email: usuario.email,
    nombreMostrar: usuario.nombreMostrar,
    nombreCompleto: usuario.nombreCompleto,
    tenantId: null,
    empresaId: null,
    sitioId: null,
    permisos: permisosActualizados
  });
  assert.equal(actualizado.permisos.verAuditoria, true);
}

async function fotografiarUsuariosExistentes(clienteSql) {
  const tablas = await clienteSql.consultar(
    `SELECT COUNT(*) AS total
     FROM information_schema.TABLES
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'usuarios'`
  );
  if (Number(tablas[0].total) === 0) return [];
  return clienteSql.consultar(
    `SELECT
       CAST(id AS CHAR) AS id,
       permiso_ver, permiso_ver_monitores,
       permiso_ver_triggers, permiso_ver_dns, permiso_editar,
       permiso_administrar_usuarios, permiso_administrar_configuracion,
       permiso_impersonacion, permiso_ver_auditoria
     FROM usuarios
     WHERE usuario NOT IN (?, ?, ?)
     ORDER BY id`,
    usuariosPrueba
  );
}

async function limpiarUsuariosPrueba(clienteSql) {
  await clienteSql.ejecutar(
    'DELETE FROM usuarios WHERE usuario IN (?, ?, ?)',
    usuariosPrueba
  );
}

main().catch((error) => {
  console.error('[auditoria] Error verificando 5.21.4d');
  console.error(error);
  process.exit(1);
});

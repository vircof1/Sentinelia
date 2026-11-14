import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { ConfiguracionPortal } from '../paquetes/configuracion/src/ConfiguracionPortal.js';
import { obtenerDefinicionesConfiguracionPortal } from '../paquetes/configuracion/src/obtenerDefinicionesConfiguracionPortal.js';
import { normalizarValorConfiguracionPersistible } from '../paquetes/configuracion/src/tiposDatoConfiguracion.js';
import { RepositorioUsuarios } from '../paquetes/usuarios/src/RepositorioUsuarios.js';
import { ServicioAutenticacion } from '../paquetes/usuarios/src/ServicioAutenticacion.js';
import { Usuario } from '../paquetes/usuarios/src/Usuario.js';
import { obtenerConfiguracionAplicacion } from '../paquetes/utilidades/src/configuracion/obtenerConfiguracionAplicacion.js';

async function main() {
  await verificarMigracionEmailValidado();
  verificarModeloUsuario();
  verificarConfiguracionPassword();
  await verificarRepositorioUsuarios();

  console.log(
    '[usuarios] Fase 1 de autogestión verificada: persistencia y configuración correctas.'
  );
}

async function verificarMigracionEmailValidado() {
  const ruta = new URL(
    '../migraciones/sql/0001_esquema_inicial.sql',
    import.meta.url
  );
  const esquema = await fs.readFile(ruta, 'utf8');
  const tabla = esquema.match(/CREATE TABLE `usuarios` \([\s\S]*?\) ENGINE=/u)?.[0];
  assert.ok(tabla, 'El esquema inicial debe definir usuarios.');
  const sql = tabla.replaceAll('`', '');
  assert.match(sql, /email_validado TINYINT\(1\) NOT NULL DEFAULT 0/i);
  assert.doesNotMatch(sql, /UNIQUE KEY[^\n]*\(email\)/i);
}

function verificarModeloUsuario() {
  const usuarioNoValidado = new Usuario(crearFilaUsuario({ email_validado: 0 }));
  const usuarioValidado = new Usuario(crearFilaUsuario({ email_validado: 1 }));

  assert.equal(usuarioNoValidado.emailValidado, false);
  assert.equal(usuarioValidado.emailValidado, true);

  const resumen = usuarioValidado.obtenerResumenAdministracion({
    resolutorScopeUsuario: {
      resolverNivelScope() {
        return 'portal';
      }
    }
  });

  assert.equal(resumen.emailValidado, true);
}

function verificarConfiguracionPassword() {
  const configuracionEntorno = obtenerConfiguracionAplicacion();
  const definiciones = obtenerDefinicionesConfiguracionPortal(
    configuracionEntorno
  );
  const definicionPassword = definiciones.find(
    (definicion) =>
      definicion.clave === 'usuarios.password_longitud_minima'
  );

  assert.ok(definicionPassword);
  assert.equal(definicionPassword.valorPorDefecto, 8);
  assert.equal(definicionPassword.minimo, 1);
  assert.equal(definicionPassword.maximo, 72);
  assert.equal(
    normalizarValorConfiguracionPersistible('12', definicionPassword),
    '12'
  );
  assert.throws(
    () => normalizarValorConfiguracionPersistible('0', definicionPassword),
    /mayor o igual a 1/
  );
  assert.throws(
    () => normalizarValorConfiguracionPersistible('73', definicionPassword),
    /menor o igual a 72/
  );

  const configuracionPortal = new ConfiguracionPortal({
    definiciones,
    valoresPersistidos: new Map([
      ['usuarios.password_longitud_minima', '12']
    ]),
    version: 1
  });
  const servicio = new ServicioAutenticacion({
    repositorioUsuarios: {},
    servicioConfiguracionPortal: {
      obtenerConfiguracionActual() {
        return configuracionPortal;
      }
    }
  });
  const entradaPassword = configuracionPortal.listarEntradas().find(
    (entrada) => entrada.clave === 'usuarios.password_longitud_minima'
  );

  assert.equal(entradaPassword.minimo, 1);
  assert.equal(entradaPassword.maximo, 72);
  assert.equal(servicio.obtenerLongitudMinimaPassword(), 12);
  assert.throws(
    () => servicio.validarPasswordNueva('12345678901', '12345678901'),
    /al menos 12 caracteres/
  );
  assert.doesNotThrow(() =>
    servicio.validarPasswordNueva('123456789012', '123456789012')
  );
  assert.throws(
    () => servicio.validarPasswordNueva('á'.repeat(37), 'á'.repeat(37)),
    /72 bytes/
  );
}

async function verificarRepositorioUsuarios() {
  const ejecuciones = [];
  const clienteSql = {
    async ejecutar(sql, parametros = []) {
      ejecuciones.push({ sql, parametros });
      return [{ affectedRows: 1 }];
    },
    async consultar() {
      return [crearFilaUsuario({
        email: 'nuevo@example.test',
        email_validado: 1
      })];
    }
  };
  const repositorio = new RepositorioUsuarios(clienteSql);

  const actualizado = await repositorio.actualizarEmailYEstadoValidacion({
    idUsuario: 7,
    email: 'nuevo@example.test',
    emailValidado: true
  });

  assert.equal(actualizado.email, 'nuevo@example.test');
  assert.equal(actualizado.emailValidado, true);
  assert.match(ejecuciones[0].sql, /email = \?/);
  assert.match(ejecuciones[0].sql, /email_validado = \?/);
  assert.deepEqual(ejecuciones[0].parametros, [
    'nuevo@example.test',
    1,
    'nuevo@example.test',
    1,
    7
  ]);

  ejecuciones.length = 0;
  await repositorio.actualizarMetadatosAdministrativos({
    idUsuario: 7,
    email: 'nuevo@example.test',
    nombreMostrar: 'Operador',
    nombreCompleto: 'Operador de prueba'
  });

  assert.match(
    ejecuciones[0].sql,
    /WHEN BINARY email = BINARY \? THEN email_validado\s+ELSE 0/i
  );
  assert.deepEqual(ejecuciones[0].parametros.slice(0, 2), [
    'nuevo@example.test',
    'nuevo@example.test'
  ]);

  ejecuciones.length = 0;
  const validado = await repositorio.marcarEmailValidadoSiCoincide({
    idUsuario: 7,
    email: 'nuevo@example.test'
  });

  assert.equal(validado.emailValidado, true);
  assert.match(ejecuciones[0].sql, /AND BINARY email = BINARY \?/i);
}

function crearFilaUsuario(sobrescrituras = {}) {
  return {
    id: 7,
    usuario: 'operador',
    email: 'operador@example.test',
    email_validado: 0,
    hash_password: '$2b$12$prueba',
    activo: 1,
    es_superusuario: 0,
    requiere_cambio_password: 0,
    version_sesion: 1,
    ultimo_acceso: null,
    contador_accesos: 0,
    nombre_mostrar: 'Operador',
    nombre_completo: 'Operador de prueba',
    tenant_id: null,
    empresa_id: null,
    sitio_id: null,
    fecha_creacion: null,
    fecha_actualizacion: null,
    permiso_ver: 1,
    permiso_ver_monitores: 1,
    permiso_ver_triggers: 0,
    permiso_ver_dns: 0,
    permiso_editar: 0,
    permiso_editar_triggers: 0,
    permiso_editar_dns: 0,
    permiso_gestionar_vinculos_triggers: 0,
    permiso_administrar_usuarios: 0,
    permiso_administrar_configuracion: 0,
    permiso_publicar_dns: 0,
    permiso_administrar_dns_avanzado: 0,
    permiso_ver_agentes: 0,
    permiso_modificar_agentes: 0,
    permiso_eliminar_agentes: 0,
    permiso_administrar_organizacion: 0,
    permiso_administrar_tenants: 0,
    permiso_administrar_empresas: 0,
    permiso_administrar_sitios: 0,
    permiso_impersonacion: 0,
    ...sobrescrituras
  };
}

main().catch((error) => {
  console.error('[usuarios] Falló la verificación de la fase 1 de autogestión.');
  console.error(error);
  process.exit(1);
});

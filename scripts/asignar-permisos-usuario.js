import { ClienteSql } from '../paquetes/persistencia-sql/src/ClienteSql.js';
import { obtenerConfiguracionAplicacion } from '../paquetes/utilidades/src/configuracion/obtenerConfiguracionAplicacion.js';
import { ServicioConexionRedis } from '../paquetes/sesiones/src/ServicioConexionRedis.js';

async function main() {
  const configuracion = obtenerConfiguracionAplicacion();
  const usuario = process.env.USUARIO_OBJETIVO || '';

  if (!usuario) {
    throw new Error('Debes definir USUARIO_OBJETIVO.');
  }

  const permisoVer = booleanoDesdeEntorno(process.env.PERMISO_VER, false);
  const permisoVerMonitores = booleanoDesdeEntorno(
    process.env.PERMISO_VER_MONITORES,
    false
  );
  const permisoVerTriggers = booleanoDesdeEntorno(
    process.env.PERMISO_VER_TRIGGERS,
    false
  );
  const permisoEditar = booleanoDesdeEntorno(process.env.PERMISO_EDITAR, false);
  const permisoEditarTriggers = booleanoDesdeEntorno(
    process.env.PERMISO_EDITAR_TRIGGERS,
    false
  );
  const permisoGestionarVinculosTriggers = booleanoDesdeEntorno(
    process.env.PERMISO_GESTIONAR_VINCULOS_TRIGGERS,
    false
  );
  const permisoAdministrarUsuarios = booleanoDesdeEntorno(
    process.env.PERMISO_ADMINISTRAR_USUARIOS,
    false
  );
  const permisoAdministrarConfiguracion = booleanoDesdeEntorno(
    process.env.PERMISO_ADMINISTRAR_CONFIGURACION,
    false
  );
  const permisoVerAgentes = booleanoDesdeEntorno(
    process.env.PERMISO_VER_AGENTES,
    false
  );
  const permisoModificarAgentes = booleanoDesdeEntorno(
    process.env.PERMISO_MODIFICAR_AGENTES,
    false
  );
  const permisoEliminarAgentes = booleanoDesdeEntorno(
    process.env.PERMISO_ELIMINAR_AGENTES,
    false
  );
  const permisoAdministrarOrganizacion = booleanoDesdeEntorno(
    process.env.PERMISO_ADMINISTRAR_ORGANIZACION,
    false
  );
  const permisoAdministrarTenants = booleanoDesdeEntorno(
    process.env.PERMISO_ADMINISTRAR_TENANTS,
    false
  );
  const permisoAdministrarEmpresas = booleanoDesdeEntorno(
    process.env.PERMISO_ADMINISTRAR_EMPRESAS,
    false
  );
  const permisoAdministrarSitios = booleanoDesdeEntorno(
    process.env.PERMISO_ADMINISTRAR_SITIOS,
    false
  );
  const permisoImpersonacion = booleanoDesdeEntorno(
    process.env.PERMISO_IMPERSONACION,
    false
  );
  const permisoConfigurarEmisionesFederacion = booleanoDesdeEntorno(
    process.env.PERMISO_CONFIGURAR_EMISIONES_FEDERACION,
    false
  );
  const permisoConfigurarRecepcionesFederacion = booleanoDesdeEntorno(
    process.env.PERMISO_CONFIGURAR_RECEPCIONES_FEDERACION,
    false
  );
  const permisoActivarRelacionesFederacion = booleanoDesdeEntorno(
    process.env.PERMISO_ACTIVAR_RELACIONES_FEDERACION,
    false
  );
  const permisoGestionarCredencialesFederacion = booleanoDesdeEntorno(
    process.env.PERMISO_GESTIONAR_CREDENCIALES_FEDERACION,
    false
  );
  const permisoTransferirResponsabilidadFederacion = booleanoDesdeEntorno(
    process.env.PERMISO_TRANSFERIR_RESPONSABILIDAD_FEDERACION,
    false
  );
  const permisoResolverConflictosFederacion = booleanoDesdeEntorno(
    process.env.PERMISO_RESOLVER_CONFLICTOS_FEDERACION,
    false
  );
  const permisoVerDiagnosticoFederacion = booleanoDesdeEntorno(
    process.env.PERMISO_VER_DIAGNOSTICO_FEDERACION,
    false
  );
  const permisoVerAvisosPlataforma = booleanoDesdeEntorno(
    process.env.PERMISO_VER_AVISOS_PLATAFORMA,
    false
  );
  const permisoVerAlertasRemotas = booleanoDesdeEntorno(
    process.env.PERMISO_VER_ALERTAS_REMOTAS,
    false
  );

  const clienteSql = new ClienteSql(configuracion.sql);
  await clienteSql.ejecutar(
    `
      UPDATE usuarios
      SET
        permiso_ver_monitores = ?,
        permiso_ver_triggers = ?,
        permiso_ver = ?,
        permiso_editar = ?,
        permiso_editar_triggers = ?,
        permiso_gestionar_vinculos_triggers = ?,
        permiso_administrar_usuarios = ?,
        permiso_administrar_configuracion = ?,
        permiso_ver_agentes = ?,
        permiso_modificar_agentes = ?,
        permiso_eliminar_agentes = ?,
        permiso_administrar_organizacion = ?,
        permiso_administrar_tenants = ?,
        permiso_administrar_empresas = ?,
        permiso_administrar_sitios = ?,
        permiso_impersonacion = ?,
        permiso_configurar_emisiones_federacion = ?,
        permiso_configurar_recepciones_federacion = ?,
        permiso_activar_relaciones_federacion = ?,
        permiso_gestionar_credenciales_federacion = ?,
        permiso_transferir_responsabilidad_federacion = ?,
        permiso_resolver_conflictos_federacion = ?,
        permiso_ver_diagnostico_federacion = ?,
        permiso_ver_avisos_plataforma = ?,
        permiso_ver_alertas_remotas = ?,
        version_sesion = version_sesion + 1
      WHERE usuario = ?
    `,
    [
      permisoVerMonitores ? 1 : 0,
      permisoVerTriggers ? 1 : 0,
      permisoVer ? 1 : 0,
      permisoEditar ? 1 : 0,
      permisoEditarTriggers ? 1 : 0,
      permisoGestionarVinculosTriggers ? 1 : 0,
      permisoAdministrarUsuarios ? 1 : 0,
      permisoAdministrarConfiguracion ? 1 : 0,
      permisoVerAgentes || permisoModificarAgentes || permisoEliminarAgentes
        ? 1
        : 0,
      permisoModificarAgentes ? 1 : 0,
      permisoEliminarAgentes ? 1 : 0,
      permisoAdministrarOrganizacion ? 1 : 0,
      permisoAdministrarTenants ? 1 : 0,
      permisoAdministrarEmpresas ? 1 : 0,
      permisoAdministrarSitios ? 1 : 0,
      permisoImpersonacion ? 1 : 0,
      permisoConfigurarEmisionesFederacion ? 1 : 0,
      permisoConfigurarRecepcionesFederacion ? 1 : 0,
      permisoActivarRelacionesFederacion ? 1 : 0,
      permisoGestionarCredencialesFederacion ? 1 : 0,
      permisoTransferirResponsabilidadFederacion ? 1 : 0,
      permisoResolverConflictosFederacion ? 1 : 0,
      permisoVerDiagnosticoFederacion ? 1 : 0,
      permisoVerAvisosPlataforma ? 1 : 0,
      permisoVerAlertasRemotas ? 1 : 0,
      usuario
    ]
  );

  const filas = await clienteSql.consultar(
    `
      SELECT id, version_sesion
      FROM usuarios
      WHERE usuario = ?
      LIMIT 1
    `,
    [usuario]
  );

  if (filas.length === 0) {
    throw new Error(`No existe el usuario ${usuario}.`);
  }

  const servicioConexionRedis = new ServicioConexionRedis(configuracion.redis);
  const clienteRedis = await servicioConexionRedis.conectar();
  await clienteRedis.set(
    `${configuracion.redis.prefijoVersionUsuario}${filas[0].id}:version_sesion`,
    String(filas[0].version_sesion)
  );
  await servicioConexionRedis.cerrar();
  await clienteSql.cerrar();

  console.log(
    `[usuarios] Permisos actualizados para ${usuario}: ver=${permisoVer}, ver_monitores=${permisoVerMonitores}, ver_triggers=${permisoVerTriggers}, editar=${permisoEditar}, editar_triggers=${permisoEditarTriggers}, gestionar_vinculos_triggers=${permisoGestionarVinculosTriggers}, administrar_usuarios=${permisoAdministrarUsuarios}, administrar_configuracion=${permisoAdministrarConfiguracion}, ver_agentes=${permisoVerAgentes || permisoModificarAgentes}, modificar_agentes=${permisoModificarAgentes}, administrar_organizacion=${permisoAdministrarOrganizacion}, administrar_tenants=${permisoAdministrarTenants}, administrar_empresas=${permisoAdministrarEmpresas}, administrar_sitios=${permisoAdministrarSitios}, impersonacion=${permisoImpersonacion}, configurar_emisiones_federacion=${permisoConfigurarEmisionesFederacion}, configurar_recepciones_federacion=${permisoConfigurarRecepcionesFederacion}, activar_relaciones_federacion=${permisoActivarRelacionesFederacion}, gestionar_credenciales_federacion=${permisoGestionarCredencialesFederacion}, transferir_responsabilidad_federacion=${permisoTransferirResponsabilidadFederacion}, resolver_conflictos_federacion=${permisoResolverConflictosFederacion}, ver_diagnostico_federacion=${permisoVerDiagnosticoFederacion}, ver_avisos_plataforma=${permisoVerAvisosPlataforma}, ver_alertas_remotas=${permisoVerAlertasRemotas}`
  );
}

function booleanoDesdeEntorno(valor, valorPorDefecto) {
  if (valor === undefined) {
    return valorPorDefecto;
  }

  return ['1', 'true', 'si', 'yes', 'on'].includes(String(valor).toLowerCase());
}

main().catch((error) => {
  console.error('[usuarios] Error fatal');
  console.error(error);
  process.exit(1);
});

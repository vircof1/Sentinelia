import { ClienteSql } from '../paquetes/persistencia-sql/src/ClienteSql.js';
import { RepositorioUsuarios } from '../paquetes/usuarios/src/RepositorioUsuarios.js';
import { ServicioAutenticacion } from '../paquetes/usuarios/src/ServicioAutenticacion.js';
import { ServicioConexionRedis } from '../paquetes/sesiones/src/ServicioConexionRedis.js';
import { VersionadorCatalogoMonitoresRedis } from '../paquetes/monitores/src/VersionadorCatalogoMonitoresRedis.js';
import { VersionadorConfiguracionRedis } from '../paquetes/configuracion/src/VersionadorConfiguracionRedis.js';
import { VersionadorDnsRedis } from '../paquetes/dns/src/VersionadorDnsRedis.js';
import { obtenerConfiguracionAplicacion } from '../paquetes/utilidades/src/configuracion/obtenerConfiguracionAplicacion.js';

const PASSWORD_DEMO =
  String(process.env.DATOS_EJEMPLO_PASSWORD || '').trim() ||
  'SentineliaDemo123!';

async function main() {
  const configuracion = obtenerConfiguracionAplicacion();

  if (!configuracion.sql.estaCompleta) {
    throw new Error(
      'Configuracion SQL incompleta. Revisa SQL_HOST, SQL_USUARIO y SQL_BASE_DATOS.'
    );
  }

  const clienteSql = new ClienteSql(configuracion.sql);
  const repositorioUsuarios = new RepositorioUsuarios(clienteSql);
  const servicioAutenticacion = new ServicioAutenticacion({
    repositorioUsuarios
  });

  try {
    const resumen = await sembrarDatosEjemplo({
      clienteSql,
      servicioAutenticacion
    });

    const versiones = await incrementarVersionesRedisSiProcede({
      clienteSql,
      configuracion,
      resumen
    });

    imprimirResumen(resumen, versiones);
  } finally {
    await clienteSql.cerrar();
  }
}

async function sembrarDatosEjemplo({ clienteSql, servicioAutenticacion }) {
  const resumen = crearResumen();

  const tenantAcme = await asegurarTenant(clienteSql, resumen, {
    nombre: 'Demo Acme Corp',
    alias: 'demo-acme',
    descripcion: 'Tenant de ejemplo para pruebas funcionales.',
    estado: 'activo'
  });
  const tenantGlobex = await asegurarTenant(clienteSql, resumen, {
    nombre: 'Demo Globex',
    alias: 'demo-globex',
    descripcion: 'Segundo tenant para validar filtros y scopes.',
    estado: 'activo'
  });

  const empresaAcmeOps = await asegurarEmpresa(clienteSql, resumen, {
    tenantId: tenantAcme.id,
    nombre: 'Acme Operaciones',
    alias: 'acme-operaciones',
    cif: 'DEMO-ACME-OPS',
    descripcion: 'Empresa demo con CPD y monitores activos.',
    estado: 'activo'
  });
  const empresaAcmeRetail = await asegurarEmpresa(clienteSql, resumen, {
    tenantId: tenantAcme.id,
    nombre: 'Acme Retail',
    alias: 'acme-retail',
    cif: 'DEMO-ACME-RTL',
    descripcion: 'Empresa demo orientada a sedes remotas.',
    estado: 'activo'
  });
  const empresaGlobexEu = await asegurarEmpresa(clienteSql, resumen, {
    tenantId: tenantGlobex.id,
    nombre: 'Globex Europa',
    alias: 'globex-europa',
    cif: 'DEMO-GLOBEX-EU',
    descripcion: 'Empresa demo para validar aislamiento multi-tenant.',
    estado: 'activo'
  });

  const sitioMadrid = await asegurarSitio(clienteSql, resumen, {
    tenantId: tenantAcme.id,
    empresaId: empresaAcmeOps.id,
    nombre: 'CPD Madrid',
    alias: 'mad-cpd',
    timezone: 'Europe/Madrid',
    descripcion: 'Sitio principal demo.',
    estado: 'activo'
  });
  const sitioBarcelona = await asegurarSitio(clienteSql, resumen, {
    tenantId: tenantAcme.id,
    empresaId: empresaAcmeRetail.id,
    nombre: 'Tienda Barcelona',
    alias: 'bcn-tienda',
    timezone: 'Europe/Madrid',
    descripcion: 'Sede comercial demo.',
    estado: 'activo'
  });
  const sitioLisboa = await asegurarSitio(clienteSql, resumen, {
    tenantId: tenantGlobex.id,
    empresaId: empresaGlobexEu.id,
    nombre: 'Edge Lisboa',
    alias: 'lis-edge',
    timezone: 'Europe/Lisbon',
    descripcion: 'Nodo edge demo.',
    estado: 'activo'
  });

  const usuarios = await asegurarUsuariosDemo({
    clienteSql,
    servicioAutenticacion,
    resumen,
    tenantAcme,
    empresaAcmeOps,
    sitioMadrid,
    tenantGlobex,
    empresaGlobexEu,
    sitioLisboa
  });

  const monitores = await asegurarMonitoresDemo(clienteSql, resumen, {
    tenantAcme,
    empresaAcmeOps,
    empresaAcmeRetail,
    sitioMadrid,
    sitioBarcelona,
    tenantGlobex,
    empresaGlobexEu,
    sitioLisboa
  });

  const triggers = await asegurarTriggersDemo(clienteSql, resumen, {
    tenantAcme,
    empresaAcmeOps,
    sitioMadrid,
    monitores
  });

  await asegurarDnsDemo(clienteSql, resumen, {
    tenantAcme,
    empresaAcmeOps,
    sitioMadrid,
    tenantGlobex,
    empresaGlobexEu,
    sitioLisboa
  });

  await asegurarCorreoDemo(clienteSql, resumen, {
    usuarioAdminId: usuarios.admin.id
  });

  await asegurarConfiguracionDemo(clienteSql, resumen);

  return resumen;
}

function crearResumen() {
  return {
    tenants: 0,
    empresas: 0,
    sitios: 0,
    usuarios: 0,
    monitores: 0,
    triggers: 0,
    asignacionesTriggers: 0,
    zonasDns: 0,
    registrosDns: 0,
    correos: 0,
    configuracion: 0
  };
}

async function asegurarTenant(clienteSql, resumen, datos) {
  const [resultado] = await clienteSql.ejecutar(
    `
      INSERT INTO tenants (
        nombre,
        alias,
        descripcion,
        estado,
        configuracion
      ) VALUES (?, ?, ?, ?, ?)
      ON DUPLICATE KEY UPDATE
        id = LAST_INSERT_ID(id),
        nombre = VALUES(nombre),
        descripcion = VALUES(descripcion),
        estado = VALUES(estado),
        configuracion = VALUES(configuracion)
    `,
    [
      datos.nombre,
      datos.alias,
      datos.descripcion,
      datos.estado,
      JSON.stringify({ origenDemo: true })
    ]
  );

  resumen.tenants += 1;
  return { id: resultado.insertId, ...datos };
}

async function asegurarEmpresa(clienteSql, resumen, datos) {
  const [resultado] = await clienteSql.ejecutar(
    `
      INSERT INTO empresas (
        tenant_id,
        nombre,
        alias,
        cif,
        descripcion,
        estado,
        configuracion
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
      ON DUPLICATE KEY UPDATE
        id = LAST_INSERT_ID(id),
        nombre = VALUES(nombre),
        cif = VALUES(cif),
        descripcion = VALUES(descripcion),
        estado = VALUES(estado),
        configuracion = VALUES(configuracion)
    `,
    [
      datos.tenantId,
      datos.nombre,
      datos.alias,
      datos.cif,
      datos.descripcion,
      datos.estado,
      JSON.stringify({ origenDemo: true })
    ]
  );

  resumen.empresas += 1;
  return { id: resultado.insertId, ...datos };
}

async function asegurarSitio(clienteSql, resumen, datos) {
  const [resultado] = await clienteSql.ejecutar(
    `
      INSERT INTO sitios (
        tenant_id,
        empresa_id,
        nombre,
        alias,
        timezone,
        descripcion,
        estado,
        configuracion
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON DUPLICATE KEY UPDATE
        id = LAST_INSERT_ID(id),
        tenant_id = VALUES(tenant_id),
        nombre = VALUES(nombre),
        timezone = VALUES(timezone),
        descripcion = VALUES(descripcion),
        estado = VALUES(estado),
        configuracion = VALUES(configuracion)
    `,
    [
      datos.tenantId,
      datos.empresaId,
      datos.nombre,
      datos.alias,
      datos.timezone,
      datos.descripcion,
      datos.estado,
      JSON.stringify({ origenDemo: true })
    ]
  );

  resumen.sitios += 1;
  return { id: resultado.insertId, ...datos };
}

async function asegurarUsuariosDemo({
  clienteSql,
  servicioAutenticacion,
  resumen,
  tenantAcme,
  empresaAcmeOps,
  sitioMadrid,
  tenantGlobex,
  empresaGlobexEu,
  sitioLisboa
}) {
  const hashPassword = await servicioAutenticacion.crearHashPassword(PASSWORD_DEMO);
  const admin = await asegurarUsuario(clienteSql, resumen, {
    usuario: 'demo_admin',
    email: 'demo.admin@sentinelia.local',
    hashPassword,
    nombreMostrar: 'Demo Admin',
    nombreCompleto: 'Administrador Demo',
    tenantId: null,
    empresaId: null,
    sitioId: null,
    esSuperusuario: true,
    permisos: permisosCompletos()
  });
  const operador = await asegurarUsuario(clienteSql, resumen, {
    usuario: 'demo_ops',
    email: 'demo.ops@sentinelia.local',
    hashPassword,
    nombreMostrar: 'Demo Ops',
    nombreCompleto: 'Operador Acme',
    tenantId: tenantAcme.id,
    empresaId: empresaAcmeOps.id,
    sitioId: null,
    esSuperusuario: false,
    permisos: {
      ...permisosLectura(),
      editar: true,
      editarTriggers: true,
      gestionarVinculosTriggers: true,
      editarDns: true,
      publicarDns: true
    }
  });
  const visor = await asegurarUsuario(clienteSql, resumen, {
    usuario: 'demo_viewer',
    email: 'demo.viewer@sentinelia.local',
    hashPassword,
    nombreMostrar: 'Demo Viewer',
    nombreCompleto: 'Visor Lisboa',
    tenantId: tenantGlobex.id,
    empresaId: empresaGlobexEu.id,
    sitioId: sitioLisboa.id,
    esSuperusuario: false,
    permisos: permisosLectura()
  });

  await asegurarUsuario(clienteSql, resumen, {
    usuario: 'demo_site',
    email: 'demo.site@sentinelia.local',
    hashPassword,
    nombreMostrar: 'Demo Site',
    nombreCompleto: 'Tecnico CPD Madrid',
    tenantId: tenantAcme.id,
    empresaId: empresaAcmeOps.id,
    sitioId: sitioMadrid.id,
    esSuperusuario: false,
    permisos: permisosLectura()
  });

  return { admin, operador, visor };
}

function permisosCompletos() {
  return {
    verMonitores: true,
    verTriggers: true,
    verDns: true,
    ver: true,
    editar: true,
    editarTriggers: true,
    editarDns: true,
    gestionarVinculosTriggers: true,
    administrarUsuarios: true,
    administrarConfiguracion: true,
    publicarDns: true,
    administrarDnsAvanzado: true,
    verAgentes: true,
    modificarAgentes: true,
    eliminarAgentes: true,
    administrarOrganizacion: true,
    administrarTenants: true,
    administrarEmpresas: true,
    administrarSitios: true,
    impersonacion: true,
    configurarEmisionesFederacion: true,
    configurarRecepcionesFederacion: true,
    activarRelacionesFederacion: true,
    gestionarCredencialesFederacion: true,
    transferirResponsabilidadFederacion: true,
    resolverConflictosFederacion: true,
    verDiagnosticoFederacion: true,
    verAvisosPlataforma: true,
    verAlertasRemotas: true
  };
}

function permisosLectura() {
  return {
    verMonitores: true,
    verTriggers: true,
    verDns: true,
    ver: true,
    editar: false,
    editarTriggers: false,
    editarDns: false,
    gestionarVinculosTriggers: false,
    administrarUsuarios: false,
    administrarConfiguracion: false,
    publicarDns: false,
    administrarDnsAvanzado: false,
    verAgentes: true,
    modificarAgentes: false,
    eliminarAgentes: false,
    administrarOrganizacion: false,
    administrarTenants: false,
    administrarEmpresas: false,
    administrarSitios: false,
    impersonacion: false,
    configurarEmisionesFederacion: false,
    configurarRecepcionesFederacion: false,
    activarRelacionesFederacion: false,
    gestionarCredencialesFederacion: false,
    transferirResponsabilidadFederacion: false,
    resolverConflictosFederacion: false,
    verDiagnosticoFederacion: true,
    verAvisosPlataforma: true,
    verAlertasRemotas: true
  };
}

async function asegurarUsuario(clienteSql, resumen, datos) {
  const p = datos.permisos;
  const [resultado] = await clienteSql.ejecutar(
    `
      INSERT INTO usuarios (
        usuario,
        email,
        email_validado,
        hash_password,
        activo,
        es_superusuario,
        requiere_cambio_password,
        version_sesion,
        generacion_recuperacion,
        contador_accesos,
        nombre_mostrar,
        nombre_completo,
        tenant_id,
        empresa_id,
        sitio_id,
        permiso_ver_monitores,
        permiso_ver_triggers,
        permiso_ver_dns,
        permiso_ver,
        permiso_editar,
        permiso_editar_triggers,
        permiso_editar_dns,
        permiso_gestionar_vinculos_triggers,
        permiso_administrar_usuarios,
        permiso_administrar_configuracion,
        permiso_publicar_dns,
        permiso_administrar_dns_avanzado,
        permiso_ver_agentes,
        permiso_modificar_agentes,
        permiso_eliminar_agentes,
        permiso_administrar_organizacion,
        permiso_administrar_tenants,
        permiso_administrar_empresas,
        permiso_administrar_sitios,
        permiso_impersonacion,
        permiso_configurar_emisiones_federacion,
        permiso_configurar_recepciones_federacion,
        permiso_activar_relaciones_federacion,
        permiso_gestionar_credenciales_federacion,
        permiso_transferir_responsabilidad_federacion,
        permiso_resolver_conflictos_federacion,
        permiso_ver_diagnostico_federacion,
        permiso_ver_avisos_plataforma,
        permiso_ver_alertas_remotas
      ) VALUES (?, ?, 0, ?, 1, ?, 0, 1, 1, 0, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON DUPLICATE KEY UPDATE
        id = LAST_INSERT_ID(id),
        generacion_recuperacion = generacion_recuperacion + IF(
          NOT (BINARY email <=> BINARY VALUES(email))
            OR NOT (BINARY hash_password <=> BINARY VALUES(hash_password))
            OR activo <> VALUES(activo),
          1,
          0
        ),
        email_validado = CASE
          WHEN BINARY email = BINARY VALUES(email) THEN email_validado
          ELSE 0
        END,
        email = VALUES(email),
        hash_password = VALUES(hash_password),
        activo = VALUES(activo),
        es_superusuario = VALUES(es_superusuario),
        requiere_cambio_password = VALUES(requiere_cambio_password),
        version_sesion = version_sesion + 1,
        nombre_mostrar = VALUES(nombre_mostrar),
        nombre_completo = VALUES(nombre_completo),
        tenant_id = VALUES(tenant_id),
        empresa_id = VALUES(empresa_id),
        sitio_id = VALUES(sitio_id),
        permiso_ver_monitores = VALUES(permiso_ver_monitores),
        permiso_ver_triggers = VALUES(permiso_ver_triggers),
        permiso_ver_dns = VALUES(permiso_ver_dns),
        permiso_ver = VALUES(permiso_ver),
        permiso_editar = VALUES(permiso_editar),
        permiso_editar_triggers = VALUES(permiso_editar_triggers),
        permiso_editar_dns = VALUES(permiso_editar_dns),
        permiso_gestionar_vinculos_triggers = VALUES(permiso_gestionar_vinculos_triggers),
        permiso_administrar_usuarios = VALUES(permiso_administrar_usuarios),
        permiso_administrar_configuracion = VALUES(permiso_administrar_configuracion),
        permiso_publicar_dns = VALUES(permiso_publicar_dns),
        permiso_administrar_dns_avanzado = VALUES(permiso_administrar_dns_avanzado),
        permiso_ver_agentes = VALUES(permiso_ver_agentes),
        permiso_modificar_agentes = VALUES(permiso_modificar_agentes),
        permiso_eliminar_agentes = VALUES(permiso_eliminar_agentes),
        permiso_administrar_organizacion = VALUES(permiso_administrar_organizacion),
        permiso_administrar_tenants = VALUES(permiso_administrar_tenants),
        permiso_administrar_empresas = VALUES(permiso_administrar_empresas),
        permiso_administrar_sitios = VALUES(permiso_administrar_sitios),
        permiso_impersonacion = VALUES(permiso_impersonacion),
        permiso_configurar_emisiones_federacion = VALUES(permiso_configurar_emisiones_federacion),
        permiso_configurar_recepciones_federacion = VALUES(permiso_configurar_recepciones_federacion),
        permiso_activar_relaciones_federacion = VALUES(permiso_activar_relaciones_federacion),
        permiso_gestionar_credenciales_federacion = VALUES(permiso_gestionar_credenciales_federacion),
        permiso_transferir_responsabilidad_federacion = VALUES(permiso_transferir_responsabilidad_federacion),
        permiso_resolver_conflictos_federacion = VALUES(permiso_resolver_conflictos_federacion),
        permiso_ver_diagnostico_federacion = VALUES(permiso_ver_diagnostico_federacion),
        permiso_ver_avisos_plataforma = VALUES(permiso_ver_avisos_plataforma),
        permiso_ver_alertas_remotas = VALUES(permiso_ver_alertas_remotas)
    `,
    [
      datos.usuario,
      datos.email,
      datos.hashPassword,
      datos.esSuperusuario ? 1 : 0,
      datos.nombreMostrar,
      datos.nombreCompleto,
      datos.tenantId,
      datos.empresaId,
      datos.sitioId,
      bool(p.verMonitores),
      bool(p.verTriggers),
      bool(p.verDns),
      bool(p.ver),
      bool(p.editar),
      bool(p.editarTriggers),
      bool(p.editarDns),
      bool(p.gestionarVinculosTriggers),
      bool(p.administrarUsuarios),
      bool(p.administrarConfiguracion),
      bool(p.publicarDns),
      bool(p.administrarDnsAvanzado),
      bool(p.verAgentes),
      bool(p.modificarAgentes),
      bool(p.eliminarAgentes),
      bool(p.administrarOrganizacion),
      bool(p.administrarTenants),
      bool(p.administrarEmpresas),
      bool(p.administrarSitios),
      bool(p.impersonacion),
      bool(p.configurarEmisionesFederacion),
      bool(p.configurarRecepcionesFederacion),
      bool(p.activarRelacionesFederacion),
      bool(p.gestionarCredencialesFederacion),
      bool(p.transferirResponsabilidadFederacion),
      bool(p.resolverConflictosFederacion),
      bool(p.verDiagnosticoFederacion),
      bool(p.verAvisosPlataforma),
      bool(p.verAlertasRemotas)
    ]
  );

  resumen.usuarios += 1;
  return { id: resultado.insertId, ...datos };
}

async function asegurarMonitoresDemo(clienteSql, resumen, datos) {
  const monitores = {};

  monitores.gatewayMadrid = await asegurarMonitor(clienteSql, resumen, {
    tenantId: datos.tenantAcme.id,
    empresaId: datos.empresaAcmeOps.id,
    sitioId: datos.sitioMadrid.id,
    nombre: 'Demo Ping Gateway Madrid',
    tipo: 'ping',
    descripcion: 'Ping local para validar visibilidad de monitores.',
    activo: true,
    intervaloEjecucionSegundos: 30,
    desfaseInicialSegundos: 2,
    configuracion: {
      host: '127.0.0.1',
      timeoutMs: 1200,
      reintentos: 1,
      tamanoPaqueteBytes: 56,
      ttl: 64
    }
  });
  monitores.portalPublico = await asegurarMonitor(clienteSql, resumen, {
    tenantId: datos.tenantAcme.id,
    empresaId: datos.empresaAcmeOps.id,
    sitioId: null,
    nombre: 'Demo TCP Portal Publico',
    tipo: 'tcp',
    descripcion: 'Chequeo HTTPS publico de ejemplo.',
    activo: true,
    intervaloEjecucionSegundos: 60,
    desfaseInicialSegundos: 10,
    configuracion: {
      host: 'example.com',
      puerto: 443,
      timeoutMs: 2500,
      reintentos: 1,
      usarTls: true,
      vigenciaMinimaCertDias: 14
    }
  });
  monitores.redisLocal = await asegurarMonitor(clienteSql, resumen, {
    tenantId: datos.tenantAcme.id,
    empresaId: datos.empresaAcmeRetail.id,
    sitioId: datos.sitioBarcelona.id,
    nombre: 'Demo TCP Redis Local',
    tipo: 'tcp',
    descripcion: 'Chequeo TCP contra Redis local.',
    activo: true,
    intervaloEjecucionSegundos: 45,
    desfaseInicialSegundos: 5,
    configuracion: {
      host: '127.0.0.1',
      puerto: 6379,
      timeoutMs: 1500,
      reintentos: 1,
      usarTls: false,
      vigenciaMinimaCertDias: 0
    }
  });
  monitores.edgeLisboa = await asegurarMonitor(clienteSql, resumen, {
    tenantId: datos.tenantGlobex.id,
    empresaId: datos.empresaGlobexEu.id,
    sitioId: datos.sitioLisboa.id,
    nombre: 'Demo Ping Edge Lisboa',
    tipo: 'ping',
    descripcion: 'Ping externo para tenant Globex demo.',
    activo: true,
    intervaloEjecucionSegundos: 90,
    desfaseInicialSegundos: 15,
    configuracion: {
      host: '1.1.1.1',
      timeoutMs: 1500,
      reintentos: 1,
      tamanoPaqueteBytes: 56,
      ttl: 64
    }
  });

  return monitores;
}

async function asegurarMonitor(clienteSql, resumen, datos) {
  const existente = await seleccionarUno(
    clienteSql,
    `
      SELECT id
      FROM monitores
      WHERE tenant_id = ?
        AND empresa_id = ?
        AND sitio_id <=> ?
        AND nombre = ?
      LIMIT 1
    `,
    [datos.tenantId, datos.empresaId, datos.sitioId, datos.nombre]
  );

  if (existente) {
    await clienteSql.ejecutar(
      `
        UPDATE monitores
        SET
          tipo = ?,
          descripcion = ?,
          activo = ?,
          intervalo_ejecucion_segundos = ?,
          desfase_inicial_segundos = ?,
          configuracion = ?
        WHERE id = ?
      `,
      [
        datos.tipo,
        datos.descripcion,
        bool(datos.activo),
        datos.intervaloEjecucionSegundos,
        datos.desfaseInicialSegundos,
        JSON.stringify(datos.configuracion),
        existente.id
      ]
    );

    resumen.monitores += 1;
    return { id: existente.id, ...datos };
  }

  const [resultado] = await clienteSql.ejecutar(
    `
      INSERT INTO monitores (
        tenant_id,
        empresa_id,
        sitio_id,
        nombre,
        tipo,
        descripcion,
        activo,
        intervalo_ejecucion_segundos,
        desfase_inicial_segundos,
        configuracion
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `,
    [
      datos.tenantId,
      datos.empresaId,
      datos.sitioId,
      datos.nombre,
      datos.tipo,
      datos.descripcion,
      bool(datos.activo),
      datos.intervaloEjecucionSegundos,
      datos.desfaseInicialSegundos,
      JSON.stringify(datos.configuracion)
    ]
  );

  resumen.monitores += 1;
  return { id: resultado.insertId, ...datos };
}

async function asegurarTriggersDemo(clienteSql, resumen, datos) {
  const triggerOps = await asegurarTrigger(clienteSql, resumen, {
    tenantId: datos.tenantAcme.id,
    empresaId: datos.empresaAcmeOps.id,
    sitioId: null,
    nombre: 'Demo aviso operaciones',
    tipo: 'api',
    descripcion: 'Webhook demo desactivable para alertas de operaciones.',
    activo: false,
    configuracion: {
      url: 'https://example.invalid/sentinelia/alerta',
      metodo: 'POST',
      timeoutMs: 5000,
      reintentos: 1,
      permiteTlsInseguro: false,
      cabeceras: {
        'x-sentinelia-demo': 'true'
      },
      plantillaCuerpo:
        '{"monitor":"{{monitor.nombre}}","evento":"{{evento_disparo}}","estado":"{{estado_detectado}}"}',
      parametroOpcional: null
    }
  });
  const triggerCierre = await asegurarTrigger(clienteSql, resumen, {
    tenantId: datos.tenantAcme.id,
    empresaId: datos.empresaAcmeOps.id,
    sitioId: datos.sitioMadrid.id,
    nombre: 'Demo cierre ticket',
    tipo: 'api',
    descripcion: 'Webhook demo para eventos de cierre de alerta.',
    activo: false,
    configuracion: {
      url: 'https://example.invalid/sentinelia/cierre',
      metodo: 'POST',
      timeoutMs: 5000,
      reintentos: 0,
      permiteTlsInseguro: false,
      cabeceras: {},
      plantillaCuerpo: '{"monitor":"{{monitor.nombre}}","resuelto":true}',
      parametroOpcional: null
    }
  });

  await asegurarAsignacionTrigger(clienteSql, resumen, {
    monitorId: datos.monitores.gatewayMadrid.id,
    triggerId: triggerOps.id,
    activo: true,
    ordenEjecucion: 10,
    eventosDisparo: ['apertura_alerta'],
    configuracionOverride: null
  });
  await asegurarAsignacionTrigger(clienteSql, resumen, {
    monitorId: datos.monitores.gatewayMadrid.id,
    triggerId: triggerCierre.id,
    activo: true,
    ordenEjecucion: 20,
    eventosDisparo: ['cierre_alerta'],
    configuracionOverride: null
  });
  await asegurarAsignacionTrigger(clienteSql, resumen, {
    monitorId: datos.monitores.portalPublico.id,
    triggerId: triggerOps.id,
    activo: true,
    ordenEjecucion: 10,
    eventosDisparo: ['apertura_alerta'],
    configuracionOverride: {
      parametroOpcional: 'portal-publico'
    }
  });

  return { triggerOps, triggerCierre };
}

async function asegurarTrigger(clienteSql, resumen, datos) {
  const [resultado] = await clienteSql.ejecutar(
    `
      INSERT INTO triggers (
        tenant_id,
        empresa_id,
        sitio_id,
        nombre,
        tipo,
        descripcion,
        activo,
        configuracion
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON DUPLICATE KEY UPDATE
        id = LAST_INSERT_ID(id),
        tipo = VALUES(tipo),
        descripcion = VALUES(descripcion),
        activo = VALUES(activo),
        configuracion = VALUES(configuracion)
    `,
    [
      datos.tenantId,
      datos.empresaId,
      datos.sitioId,
      datos.nombre,
      datos.tipo,
      datos.descripcion,
      bool(datos.activo),
      JSON.stringify(datos.configuracion)
    ]
  );

  resumen.triggers += 1;
  return { id: resultado.insertId, ...datos };
}

async function asegurarAsignacionTrigger(clienteSql, resumen, datos) {
  await clienteSql.ejecutar(
    `
      INSERT INTO asignaciones_triggers_monitores (
        monitor_id,
        trigger_id,
        activo,
        orden_ejecucion,
        eventos_disparo,
        configuracion_override
      ) VALUES (?, ?, ?, ?, ?, ?)
      ON DUPLICATE KEY UPDATE
        activo = VALUES(activo),
        orden_ejecucion = VALUES(orden_ejecucion),
        eventos_disparo = VALUES(eventos_disparo),
        configuracion_override = VALUES(configuracion_override)
    `,
    [
      datos.monitorId,
      datos.triggerId,
      bool(datos.activo),
      datos.ordenEjecucion,
      JSON.stringify(datos.eventosDisparo),
      datos.configuracionOverride == null
        ? null
        : JSON.stringify(datos.configuracionOverride)
    ]
  );

  resumen.asignacionesTriggers += 1;
}

async function asegurarDnsDemo(clienteSql, resumen, datos) {
  const zonaAcme = await asegurarZonaDns(clienteSql, resumen, {
    tenantId: datos.tenantAcme.id,
    empresaId: datos.empresaAcmeOps.id,
    sitioId: datos.sitioMadrid.id,
    nombreZona: 'demo-acme.internal',
    descripcion: 'Zona DNS demo de Acme.',
    ttlDefectoSegundos: 300,
    soaMname: 'ns1.demo-acme.internal',
    soaRname: 'hostmaster.demo-acme.internal',
    estadoPublicacion: 'pendiente'
  });
  const zonaGlobex = await asegurarZonaDns(clienteSql, resumen, {
    tenantId: datos.tenantGlobex.id,
    empresaId: datos.empresaGlobexEu.id,
    sitioId: datos.sitioLisboa.id,
    nombreZona: 'globex-demo.internal',
    descripcion: 'Zona DNS demo de Globex.',
    ttlDefectoSegundos: 600,
    soaMname: 'ns1.globex-demo.internal',
    soaRname: 'hostmaster.globex-demo.internal',
    estadoPublicacion: 'pendiente'
  });

  await asegurarRegistroDns(clienteSql, resumen, {
    zonaId: zonaAcme.id,
    hostRelativo: '@',
    tipoRegistro: 'A',
    valorPrincipal: '10.10.0.10',
    ttlSegundos: 300,
    descripcion: 'Apex demo Acme'
  });
  await asegurarRegistroDns(clienteSql, resumen, {
    zonaId: zonaAcme.id,
    hostRelativo: 'ns1',
    tipoRegistro: 'A',
    valorPrincipal: '10.10.0.11',
    ttlSegundos: 300,
    descripcion: 'Nameserver demo'
  });
  await asegurarRegistroDns(clienteSql, resumen, {
    zonaId: zonaAcme.id,
    hostRelativo: '@',
    tipoRegistro: 'NS',
    valorPrincipal: 'ns1.demo-acme.internal',
    ttlSegundos: 300,
    descripcion: 'NS demo'
  });
  await asegurarRegistroDns(clienteSql, resumen, {
    zonaId: zonaAcme.id,
    hostRelativo: 'portal',
    tipoRegistro: 'CNAME',
    valorPrincipal: 'app.demo-acme.internal',
    ttlSegundos: 300,
    descripcion: 'Alias portal demo'
  });
  await asegurarRegistroDns(clienteSql, resumen, {
    zonaId: zonaAcme.id,
    hostRelativo: '_sentinelia._tcp',
    tipoRegistro: 'SRV',
    valorPrincipal: 'app.demo-acme.internal',
    ttlSegundos: 300,
    prioridad: 10,
    peso: 20,
    puerto: 443,
    descripcion: 'Servicio demo Sentinelia'
  });
  await asegurarRegistroDns(clienteSql, resumen, {
    zonaId: zonaGlobex.id,
    hostRelativo: '@',
    tipoRegistro: 'A',
    valorPrincipal: '10.20.0.10',
    ttlSegundos: 600,
    descripcion: 'Apex demo Globex'
  });
  await asegurarRegistroDns(clienteSql, resumen, {
    zonaId: zonaGlobex.id,
    hostRelativo: 'edge',
    tipoRegistro: 'AAAA',
    valorPrincipal: '2001:db8::10',
    ttlSegundos: 600,
    descripcion: 'Nodo edge demo'
  });
  await asegurarRegistroDns(clienteSql, resumen, {
    zonaId: zonaGlobex.id,
    hostRelativo: '@',
    tipoRegistro: 'TXT',
    valorPrincipal: 'sentinelia-demo=globex',
    ttlSegundos: 600,
    descripcion: 'TXT demo'
  });
}

async function asegurarZonaDns(clienteSql, resumen, datos) {
  const [resultado] = await clienteSql.ejecutar(
    `
      INSERT INTO zonas_dns (
        tenant_id,
        empresa_id,
        sitio_id,
        nombre_zona,
        tipo_zona,
        categoria_origen,
        publicar_en_bind,
        descripcion,
        ttl_defecto_segundos,
        soa_mname,
        soa_rname,
        soa_serial,
        soa_refresh_segundos,
        soa_retry_segundos,
        soa_expire_segundos,
        soa_minimum_segundos,
        version_modelo,
        estado_publicacion,
        activo
      ) VALUES (?, ?, ?, ?, 'master', 'normal', 1, ?, ?, ?, ?, 1, 3600, 600, 1209600, 300, 1, ?, 1)
      ON DUPLICATE KEY UPDATE
        id = LAST_INSERT_ID(id),
        tenant_id = VALUES(tenant_id),
        empresa_id = VALUES(empresa_id),
        sitio_id = VALUES(sitio_id),
        descripcion = VALUES(descripcion),
        ttl_defecto_segundos = VALUES(ttl_defecto_segundos),
        soa_mname = VALUES(soa_mname),
        soa_rname = VALUES(soa_rname),
        estado_publicacion = VALUES(estado_publicacion),
        activo = VALUES(activo),
        version_modelo = version_modelo + 1
    `,
    [
      datos.tenantId,
      datos.empresaId,
      datos.sitioId,
      datos.nombreZona,
      datos.descripcion,
      datos.ttlDefectoSegundos,
      datos.soaMname,
      datos.soaRname,
      datos.estadoPublicacion
    ]
  );

  resumen.zonasDns += 1;
  return { id: resultado.insertId, ...datos };
}

async function asegurarRegistroDns(clienteSql, resumen, datos) {
  const existente = await seleccionarUno(
    clienteSql,
    `
      SELECT id
      FROM registros_dns
      WHERE zona_id = ?
        AND host_relativo = ?
        AND tipo_registro = ?
        AND valor_principal <=> ?
      LIMIT 1
    `,
    [
      datos.zonaId,
      datos.hostRelativo,
      datos.tipoRegistro,
      datos.valorPrincipal
    ]
  );

  if (existente) {
    await clienteSql.ejecutar(
      `
        UPDATE registros_dns
        SET
          ttl_segundos = ?,
          prioridad = ?,
          peso = ?,
          puerto = ?,
          flags = ?,
          tag = ?,
          categoria_origen = 'normal',
          publicar_en_bind = 1,
          datos_auxiliares = ?,
          descripcion = ?,
          activo = 1
        WHERE id = ?
      `,
      [
        datos.ttlSegundos ?? null,
        datos.prioridad ?? null,
        datos.peso ?? null,
        datos.puerto ?? null,
        datos.flags ?? null,
        datos.tag ?? null,
        datos.datosAuxiliares == null
          ? null
          : JSON.stringify(datos.datosAuxiliares),
        datos.descripcion ?? null,
        existente.id
      ]
    );

    resumen.registrosDns += 1;
    return { id: existente.id, ...datos };
  }

  const [resultado] = await clienteSql.ejecutar(
    `
      INSERT INTO registros_dns (
        zona_id,
        tenant_id,
        empresa_id,
        sitio_id,
        host_relativo,
        tipo_registro,
        valor_principal,
        ttl_segundos,
        prioridad,
        peso,
        puerto,
        flags,
        tag,
        categoria_origen,
        publicar_en_bind,
        datos_auxiliares,
        descripcion,
        activo
      )
      SELECT
        z.id,
        z.tenant_id,
        z.empresa_id,
        z.sitio_id,
        ?,
        ?,
        ?,
        ?,
        ?,
        ?,
        ?,
        ?,
        ?,
        'normal',
        1,
        ?,
        ?,
        1
      FROM zonas_dns z
      WHERE z.id = ?
    `,
    [
      datos.hostRelativo,
      datos.tipoRegistro,
      datos.valorPrincipal,
      datos.ttlSegundos ?? null,
      datos.prioridad ?? null,
      datos.peso ?? null,
      datos.puerto ?? null,
      datos.flags ?? null,
      datos.tag ?? null,
      datos.datosAuxiliares == null ? null : JSON.stringify(datos.datosAuxiliares),
      datos.descripcion ?? null,
      datos.zonaId
    ]
  );

  resumen.registrosDns += 1;
  return { id: resultado.insertId, ...datos };
}

async function asegurarCorreoDemo(clienteSql, resumen, { usuarioAdminId }) {
  const asunto = '[DEMO] Primer aviso Sentinelia';
  const existente = await seleccionarUno(
    clienteSql,
    `
      SELECT id
      FROM cola_correos_salida
      WHERE asunto = ?
        AND destinatario_email = 'demo.ops@sentinelia.local'
      LIMIT 1
    `,
    [asunto]
  );

  if (existente) {
    await clienteSql.ejecutar(
      `
        UPDATE cola_correos_salida
        SET
          destinatario_nombre = 'Demo Ops',
          remitente_email = 'sentinelia-demo@local.test',
          remitente_nombre = 'Sentinelia Demo',
          cuerpo_texto = ?,
          estado = 'pendiente',
          intentos = 0,
          error_ultimo = NULL,
          proximo_intento_en = NULL,
          creado_por_usuario_id = ?
        WHERE id = ?
      `,
      [cuerpoCorreoDemo(), usuarioAdminId, existente.id]
    );
  } else {
    await clienteSql.ejecutar(
      `
        INSERT INTO cola_correos_salida (
          destinatario_email,
          destinatario_nombre,
          remitente_email,
          remitente_nombre,
          asunto,
          cuerpo_texto,
          estado,
          intentos,
          creado_por_usuario_id
        ) VALUES (?, ?, ?, ?, ?, ?, 'pendiente', 0, ?)
      `,
      [
        'demo.ops@sentinelia.local',
        'Demo Ops',
        'sentinelia-demo@local.test',
        'Sentinelia Demo',
        asunto,
        cuerpoCorreoDemo(),
        usuarioAdminId
      ]
    );
  }

  resumen.correos += 1;
}

function cuerpoCorreoDemo() {
  return [
    'Correo de ejemplo generado por el seed de Sentinelia.',
    '',
    'Sirve para validar la cola de salida y las vistas de correo sin depender de alertas reales.'
  ].join('\n');
}

async function asegurarConfiguracionDemo(clienteSql, resumen) {
  const claves = [
    {
      clave: 'portal.nombre_visible',
      valor: 'Sentinelia Demo',
      tipoDato: 'texto',
      descripcion: 'Nombre visible del portal para entorno demo.'
    },
    {
      clave: 'correo.remitente_email',
      valor: 'sentinelia-demo@local.test',
      tipoDato: 'email',
      descripcion: 'Remitente demo para pruebas de correo.'
    },
    {
      clave: 'correo.remitente_nombre',
      valor: 'Sentinelia Demo',
      tipoDato: 'texto',
      descripcion: 'Nombre remitente demo.'
    }
  ];

  for (const clave of claves) {
    await clienteSql.ejecutar(
      `
        INSERT INTO configuracion_portal (
          clave,
          valor,
          tipo_dato,
          descripcion,
          creado_automaticamente
        ) VALUES (?, ?, ?, ?, 0)
        ON DUPLICATE KEY UPDATE
          valor = VALUES(valor),
          tipo_dato = VALUES(tipo_dato),
          descripcion = VALUES(descripcion),
          creado_automaticamente = VALUES(creado_automaticamente)
      `,
      [clave.clave, clave.valor, clave.tipoDato, clave.descripcion]
    );

    resumen.configuracion += 1;
  }
}

async function incrementarVersionesRedisSiProcede({
  clienteSql,
  configuracion,
  resumen
}) {
  const servicioConexionRedis = new ServicioConexionRedis(configuracion.redis);

  try {
    const clienteRedis = await servicioConexionRedis.conectar();
    const versiones = {};

    if (resumen.configuracion > 0) {
      const versionadorConfiguracion = new VersionadorConfiguracionRedis({
        clienteRedis,
        claveVersion: configuracion.redis.claveVersionConfiguracionPortal
      });
      const [resultadoVersion] = await clienteSql.ejecutar(`
        UPDATE cabecera_configuracion_portal
           SET version = version + 1
         WHERE id = 1 AND version < 18446744073709551615
      `);
      if (Number(resultadoVersion.affectedRows) !== 1) {
        throw new Error('No se pudo incrementar la versión durable de configuración.');
      }
      const [cabecera] = await clienteSql.consultar(`
        SELECT CAST(version AS CHAR) AS version
          FROM cabecera_configuracion_portal
         WHERE id = 1
      `);
      if (!cabecera) {
        throw new Error('Falta la cabecera durable de configuración.');
      }
      versiones.configuracion = await versionadorConfiguracion
        .publicarVersion(cabecera.version);
    }

    if (resumen.monitores > 0 || resumen.triggers > 0) {
      const versionadorMonitores = new VersionadorCatalogoMonitoresRedis({
        clienteRedis,
        claveVersion: configuracion.redis.claveVersionCatalogoMonitores
      });
      versiones.monitores = await versionadorMonitores.incrementarVersion();
    }

    if (resumen.zonasDns > 0 || resumen.registrosDns > 0) {
      const versionadorDns = new VersionadorDnsRedis({
        clienteRedis,
        claveVersion: configuracion.redis.claveVersionDns
      });
      versiones.dns = await versionadorDns.incrementarVersion();
    }

    return versiones;
  } catch (error) {
    return {
      aviso:
        `No se pudieron publicar versiones Redis tras el seed: ${error.message}`
    };
  } finally {
    await servicioConexionRedis.cerrar().catch(() => {});
  }
}

async function seleccionarUno(clienteSql, sql, parametros = []) {
  const filas = await clienteSql.consultar(sql, parametros);
  return filas[0] || null;
}

function bool(valor) {
  return valor ? 1 : 0;
}

function imprimirResumen(resumen, versiones) {
  console.log('[datos-ejemplo] Seed completado.');
  console.log(`[datos-ejemplo] tenants=${resumen.tenants}`);
  console.log(`[datos-ejemplo] empresas=${resumen.empresas}`);
  console.log(`[datos-ejemplo] sitios=${resumen.sitios}`);
  console.log(`[datos-ejemplo] usuarios=${resumen.usuarios}`);
  console.log(`[datos-ejemplo] monitores=${resumen.monitores}`);
  console.log(`[datos-ejemplo] triggers=${resumen.triggers}`);
  console.log(
    `[datos-ejemplo] asignaciones_triggers=${resumen.asignacionesTriggers}`
  );
  console.log(`[datos-ejemplo] zonas_dns=${resumen.zonasDns}`);
  console.log(`[datos-ejemplo] registros_dns=${resumen.registrosDns}`);
  console.log(`[datos-ejemplo] correos=${resumen.correos}`);
  console.log(`[datos-ejemplo] configuracion=${resumen.configuracion}`);
  console.log('[datos-ejemplo] historico/eventos/estado runtime omitidos.');
  console.log('[datos-ejemplo] usuarios demo: demo_admin, demo_ops, demo_viewer, demo_site');
  console.log(`[datos-ejemplo] password demo: ${PASSWORD_DEMO}`);

  if (versiones?.aviso) {
    console.log(`[datos-ejemplo] ${versiones.aviso}`);
    return;
  }

  console.log(
    `[datos-ejemplo] versiones redis: configuracion=${versiones.configuracion ?? 'n/a'}, monitores=${versiones.monitores ?? 'n/a'}, dns=${versiones.dns ?? 'n/a'}`
  );
}

main().catch((error) => {
  console.error('[datos-ejemplo] Error fatal');
  console.error(error);
  process.exit(1);
});

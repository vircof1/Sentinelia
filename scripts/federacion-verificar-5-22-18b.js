import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import ejs from 'ejs';

import { ServicioAutorizacion } from '../paquetes/autorizacion/src/ServicioAutorizacion.js';
import { PermisosUsuario } from '../paquetes/autorizacion/src/PermisosUsuario.js';
import { RepositorioAuditoria } from '../paquetes/auditoria/src/RepositorioAuditoria.js';
import {
  MANIFIESTO_RUTAS_AUDITORIA
} from '../paquetes/auditoria/src/ManifiestoCoberturaAuditoria.js';
import { generarUuidV7Auditoria } from '../paquetes/auditoria/src/UuidV7Auditoria.js';
import { AdaptadorAuditoriaControlFederacion } from '../paquetes/federacion/adaptadores/AdaptadorAuditoriaControlFederacion.js';
import { AdaptadorAuditoriaHeartbeatFederacion } from '../paquetes/federacion/adaptadores/AdaptadorAuditoriaHeartbeatFederacion.js';
import { AdaptadorAuditoriaSeguridadFederacion } from '../paquetes/federacion/adaptadores/AdaptadorAuditoriaSeguridadFederacion.js';
import { KeyringFederacionDespliegue } from '../paquetes/federacion/adaptadores/KeyringFederacionDespliegue.js';
import { ProtectorSecretoPersistenteFederacion } from '../paquetes/federacion/adaptadores/ProtectorSecretoPersistenteFederacion.js';
import { RepositorioCredencialesPersistentesFederacionSql } from '../paquetes/federacion/adaptadores/RepositorioCredencialesPersistentesFederacionSql.js';
import { RepositorioImportacionesFederacionSql } from '../paquetes/federacion/adaptadores/RepositorioImportacionesFederacionSql.js';
import { RepositorioSaludFederacionSql } from '../paquetes/federacion/adaptadores/RepositorioSaludFederacionSql.js';
import {
  ServicioAdministracionFederacionPortal
} from '../paquetes/federacion/aplicacion/ServicioAdministracionFederacionPortal.js';
import {
  ServicioImportacionFederacionPortal
} from '../paquetes/federacion/aplicacion/ServicioImportacionFederacionPortal.js';
import { ClienteSql } from '../paquetes/persistencia-sql/src/ClienteSql.js';
import { EjecutorMigraciones } from '../paquetes/persistencia-sql/src/EjecutorMigraciones.js';
import { RepositorioMigraciones } from '../paquetes/persistencia-sql/src/RepositorioMigraciones.js';
import {
  obtenerConfiguracionAplicacion,
  obtenerRutaMigraciones
} from '../paquetes/utilidades/src/configuracion/obtenerConfiguracionAplicacion.js';

const INSTALACION = `sfid1.instalacion.${'A'.repeat(21)}Q`;
const ARRANQUE = `sfid1.arranque.${'B'.repeat(21)}g`;
const RELACION = `sfid1.relacion.${'C'.repeat(21)}w`;
const RELACION_NUEVA = `sfid1.relacion.${'D'.repeat(21)}A`;
const INSTALACION_CLON = `sfid1.instalacion.${'E'.repeat(21)}Q`;
const INCIDENTE = '018f7a44-6b2c-7d11-8c24-0123456789ab';
const RELACION_SQL = `sfid1.relacion.${'M'.repeat(21)}Q`;
const USUARIO_SQL = 91822;

await verificarComposicion();
await verificarPresentacionYAutoridad();
await verificarCanjeBackendSinRetornoDeSecretos();
await verificarPersistenciaImportacion();
console.log(
  '[federacion] OK 5.22.18b: UX=relaciones+identidad+continuidad ' +
  'responsabilidad=actual clon=explicito secretos=ausentes guardas=granulares'
);

async function verificarComposicion() {
  const [rutas, controlador, vista, repositorioControl, repositorioConflictos,
    repositorioImportaciones, repositorioDestinos, repositorioSalud, catalogoAuditoria,
    index] = await Promise.all([
    leer('../apps/sentinelia-web/src/rutas/crearRutasPortal.js'),
    leer('../apps/sentinelia-web/src/controladores/ControladorFederacion.js'),
    leer('../apps/sentinelia-web/src/views/portal/federacion.ejs'),
    leer('../paquetes/federacion/adaptadores/RepositorioControlFederacionSql.js'),
    leer('../paquetes/federacion/adaptadores/RepositorioConflictosIdentidadFederacionSql.js'),
    leer('../paquetes/federacion/adaptadores/RepositorioImportacionesFederacionSql.js'),
    leer('../paquetes/federacion/adaptadores/RepositorioDestinosEmisionFederacionSql.js'),
    leer('../paquetes/federacion/adaptadores/RepositorioSaludFederacionSql.js'),
    leer('../paquetes/auditoria/src/CatalogoAuditoria.js'),
    leer('../apps/sentinelia-web/src/index.js')
  ]);
  assert.match(rutas, /requerirConfigurarRecepcionesFederacion[\s\S]*crearRecepcion/u);
  assert.match(rutas, /requerirGestionarCredencialesFederacion[\s\S]*emitirInvitacion/u);
  assert.match(rutas, /requerirTransferirResponsabilidadFederacion[\s\S]*transferirResponsabilidad/u);
  assert.match(rutas, /requerirResolverConflictosFederacion[\s\S]*resolverConflicto/u);
  assert.match(rutas, /requerirConfigurarEmisionesFederacion[\s\S]*importarInvitacion/u);
  assert.match(controlador, /confirmacion[^\n]*ELIMINAR/u);
  assert.match(controlador, /relacionesNuevasClon/u);
  assert.match(vista, /Responsable actual/u);
  assert.match(vista, /clasificar todo el conjunto observado/u);
  assert.match(vista, /La credencial persistente y las credenciales operativas nunca se muestran/u);
  assert.doesNotMatch(vista, /<%[-=]?\s*(?:panel\.)?(?:secretoPersistente|tokenOperativo|credencialHash)/u);
  assert.match(repositorioControl, /FROM usuarios WHERE id=\? FOR UPDATE/u);
  assert.match(repositorioControl, /nuevo responsable ya no conserva permiso y scope exactos/iu);
  assert.match(repositorioConflictos, /async listarAbiertos\(\)/u);
  assert.match(repositorioImportaciones, /guardarSecretoEmisorEnTransaccion/u);
  assert.match(repositorioImportaciones, /FROM usuarios WHERE id=\? FOR UPDATE/u);
  assert.match(repositorioDestinos, /pendienteAutenticacion','vinculada/u);
  assert.match(repositorioSalud, /estadoRemoto === 'vinculada'/u);
  assert.match(repositorioSalud, /registrarCompatibilidadEnTransaccion/u);
  assert.match(
    catalogoAuditoria,
    /'federacion\.credencial_recuperada': politicaFederacionWebApi/u
  );
  const rutasFederacionAuditables = MANIFIESTO_RUTAS_AUDITORIA.filter(
    (entrada) => entrada.path.startsWith('/federacion/')
  );
  for (const path of [
    '/federacion/relaciones/recepcion',
    '/federacion/importaciones/invitacion',
    '/federacion/importaciones/recuperacion',
    '/federacion/relaciones/:relacionId/invitaciones',
    '/federacion/relaciones/:relacionId/invitaciones/revocar',
    '/federacion/relaciones/:relacionId/confirmar-identidad',
    '/federacion/relaciones/:relacionId/recuperaciones',
    '/federacion/relaciones/:relacionId/aprobar-localizacion',
    '/federacion/relaciones/:relacionId/transferir-responsabilidad',
    '/federacion/relaciones/:relacionId/deshabilitar',
    '/federacion/relaciones/:relacionId/eliminar',
    '/federacion/conflictos/:incidenteId/resolver'
  ]) {
    const entrada = rutasFederacionAuditables.find((ruta) => ruta.path === path);
    assert.equal(entrada?.clasificacion, 'auditable');
    assert.ok(entrada.eventos.length > 0);
  }
  assert.match(index, /servicioControl:\s*new ServicioControlFederacion/u);
  ejs.compile(vista, {
    filename: new URL(
      '../apps/sentinelia-web/src/views/portal/federacion.ejs',
      import.meta.url
    ).pathname
  });
}

async function verificarCanjeBackendSinRetornoDeSecretos() {
  const secretoInvitacion = `sfr1_${'G'.repeat(64)}`;
  const secretoRecuperacion = `sfr1_${'H'.repeat(64)}`;
  const llamadas = { preparacion: null, consolidacion: null, recuperacion: null };
  const invitacion = {
    perfil: 'sentinelia-federacion-invitacion-v1', version: 1,
    destino: {
      origenPublico: 'https://receptor.example.test',
      installationId: INSTALACION_CLON,
      relacionId: RELACION
    },
    invitacionId: `sfinv1_${'I'.repeat(21)}A`,
    credencialTemporal: `sft1_${'J'.repeat(42)}A`,
    expiraEnUtc: new Date(Date.now() + 60000).toISOString()
  };
  const recuperacion = {
    perfil: 'sentinelia-federacion-recuperacion-v1', version: 1,
    destino: { ...invitacion.destino },
    recuperacionId: `sfrec1_${'K'.repeat(21)}A`,
    credencialTemporal: `sfrt1_${'L'.repeat(42)}A`,
    expiraEnUtc: new Date(Date.now() + 60000).toISOString()
  };
  const servicio = new ServicioImportacionFederacionPortal({
    repositorioImportaciones: {
      prepararEmision(entrada) { llamadas.preparacion = entrada; },
      consolidarInvitacion(entrada) {
        llamadas.consolidacion = entrada;
        return { relacionId: entrada.relacionId, estado: 'pendienteAutenticacion' };
      },
      validarRecuperacion(entrada) {
        llamadas.validacionRecuperacion = entrada;
        return { estado: 'autorizada' };
      },
      aplicarRecuperacion(entrada) {
        llamadas.recuperacion = entrada;
        return { estado: 'recuperada', versionCredencial: 2 };
      }
    },
    clienteHttp: {
      canjearInvitacion() {
        return {
          ok: true, relacionReceptoraId: RELACION,
          installationReceptoraId: INSTALACION_CLON,
          secretoPersistente: secretoInvitacion,
          estado: 'pendienteConfirmacionIdentidad'
        };
      },
      canjearRecuperacion() {
        return {
          ok: true, relacionReceptoraId: RELACION,
          installationReceptoraId: INSTALACION_CLON,
          secretoPersistente: secretoRecuperacion,
          versionCredencial: 2, estado: 'recuperada'
        };
      }
    },
    installationLocalId: INSTALACION,
    bootLocalId: ARRANQUE,
    resolverNombreLocal: () => 'Sentinelia local',
    productoVersion: '0.1.0'
  });
  const actor = { modo: 'directo', real: { tipo: 'usuario', id: '101' }, efectivo: null };
  const scope = { tenantId: null, empresaId: null, sitioId: null };
  const importada = await servicio.importarInvitacion({
    representacion: invitacion, actor, scope
  });
  assert.equal(JSON.stringify(importada).includes(secretoInvitacion), false);
  assert.equal(llamadas.consolidacion.secretoPersistente, secretoInvitacion);
  const recuperada = await servicio.importarRecuperacion({
    representacion: recuperacion, actor, scope
  });
  assert.equal(JSON.stringify(recuperada).includes(secretoRecuperacion), false);
  assert.equal(llamadas.validacionRecuperacion.relacionId, RELACION);
  assert.equal(llamadas.recuperacion.secretoPersistente, secretoRecuperacion);
}

async function verificarPresentacionYAutoridad() {
  const llamadas = { transferencia: null, conflicto: null };
  const relacion = Object.freeze({
    relacionId: RELACION,
    direccion: 'recepcion',
    estadoCiclo: 'deshabilitada',
    estadoAutoridad: 'sinAutoridad',
    estadoIdentidad: 'conflictiva',
    scope: Object.freeze({ tenantId: null, empresaId: null, sitioId: null })
  });
  const repositorioRelaciones = {
    async crearRecepcion() { return relacion; },
    async listarVisibles() { return Object.freeze([relacion]); },
    async listarResponsablesTransferibles() {
      return Object.freeze([Object.freeze({
        usuarioId: '202', nombre: 'Responsable nuevo', usuario: 'nuevo',
        scope: Object.freeze({ tenantId: null, empresaId: null, sitioId: null })
      })]);
    },
    async obtenerContextoTransferencia() {
      return Object.freeze({
        direccion: 'recepcion',
        scope: Object.freeze({ tenantId: null, empresaId: null, sitioId: null }),
        responsable: Object.freeze({
          usuarioId: '202', activa: true,
          scope: Object.freeze({ tenantId: null, empresaId: null, sitioId: null }),
          puedeConfigurar: true
        })
      });
    }
  };
  const servicio = new ServicioAdministracionFederacionPortal({
    repositorioRelaciones,
    servicioInvitaciones: { emitir() {}, revocar() {} },
    servicioConfirmacionIdentidad: { confirmar() {} },
    servicioContinuidad: { emitirRecuperacion() {}, aprobarLocalizacion() {} },
    servicioControl: {
      transferirResponsabilidad(entrada) {
        llamadas.transferencia = entrada;
        return { estado: 'transferida' };
      },
      deshabilitarRelacion() {},
      eliminarRelacion() {}
    },
    servicioConflictos: {
      async listarAbiertos() {
        return Object.freeze([Object.freeze({
          incidenteId: INCIDENTE,
          estado: 'conflicto',
          installationRemotaId: INSTALACION,
          relaciones: Object.freeze([relacion])
        })]);
      },
      resolver(entrada) {
        llamadas.conflicto = entrada;
        return { estado: 'resuelto' };
      }
    },
    servicioAutorizacion: new ServicioAutorizacion(),
    generadorIdentidades: { generar() { return RELACION; } },
    installationId: INSTALACION,
    bootId: ARRANQUE
  });
  const contexto = crearContexto();
  const panel = await servicio.obtenerPanel(contexto);
  assert.equal(panel.relaciones[0].responsablesTransferibles.length, 1);
  assert.equal(panel.conflictos.length, 1);
  assert.doesNotMatch(
    JSON.stringify(panel),
    /(?:sfr1_|sfop1_|credencialTemporal|secretoPersistente|ciphertext)/u
  );

  await servicio.transferirResponsabilidad({
    contextoUsuarioActual: contexto,
    relacionId: RELACION,
    nuevoResponsableUsuarioId: '202'
  });
  assert.equal(llamadas.transferencia.nuevoResponsableUsuarioId, '202');
  assert.equal(llamadas.transferencia.autoridadActualNueva.toJSON().activa, true);
  assert.deepEqual(llamadas.transferencia.scope, {
    tenantId: null, empresaId: null, sitioId: null
  });

  await servicio.resolverConflicto({
    contextoUsuarioActual: contexto,
    incidenteId: INCIDENTE,
    installationClonNuevaId: INSTALACION_CLON,
    relacionesLegitimas: [RELACION],
    relacionesClon: [RELACION_NUEVA],
    relacionesNuevasClon: [RELACION]
  });
  assert.equal(llamadas.conflicto.actor.modo, 'directo');
  assert.equal(llamadas.conflicto.actor.efectivo, null);

  const contextoAcotado = { ...contexto, tenantId: '1', nivelScope: 'tenant' };
  const panelAcotado = await servicio.obtenerPanel(contextoAcotado);
  assert.equal(panelAcotado.conflictos.length, 0);
  assert.throws(
    () => servicio.resolverConflicto({
      contextoUsuarioActual: contextoAcotado,
      incidenteId: INCIDENTE,
      installationClonNuevaId: INSTALACION_CLON,
      relacionesLegitimas: [RELACION],
      relacionesClon: [RELACION_NUEVA],
      relacionesNuevasClon: [RELACION]
    }),
    (error) => error?.statusCode === 403
  );
}

function crearContexto() {
  return {
    idUsuario: '101', tenantId: null, empresaId: null, sitioId: null,
    nivelScope: 'portal', impersonacionActiva: false,
    permisos: new PermisosUsuario({
      configurarRecepcionesFederacion: true,
      activarRelacionesFederacion: true,
      gestionarCredencialesFederacion: true,
      transferirResponsabilidadFederacion: true,
      resolverConflictosFederacion: true,
      verDiagnosticoFederacion: true
    })
  };
}

async function verificarPersistenciaImportacion() {
  const configuracion = obtenerConfiguracionAplicacion();
  assert.equal(configuracion.sql.estaCompleta, true, '5.22.18b requiere SQL local.');
  const sql = new ClienteSql(configuracion.sql);
  try {
    const migrador = new EjecutorMigraciones({
      clienteSql: sql,
      repositorioMigraciones: new RepositorioMigraciones(sql),
      rutaMigraciones: obtenerRutaMigraciones()
    });
    await migrador.ejecutarPendientes();
    await limpiarSql(sql);
    await sql.ejecutar(
      `INSERT INTO usuarios (
        id,usuario,email,hash_password,activo,
        permiso_configurar_emisiones_federacion,
        permiso_gestionar_credenciales_federacion
      ) VALUES (?, ?, ?, 'fixture-no-login',1,1,1)`,
      [USUARIO_SQL, `fixture-fed-${USUARIO_SQL}`,
        `fixture-fed-${USUARIO_SQL}@invalid.local`]
    );
    const repositorioAuditoria = new RepositorioAuditoria(sql);
    const credenciales = new RepositorioCredencialesPersistentesFederacionSql(sql);
    const protector = new ProtectorSecretoPersistenteFederacion({
      keyring: new KeyringFederacionDespliegue({
        referencia: 'sentinelia/federacion/fixture-18b',
        keyring: { activa: Buffer.alloc(32, 18).toString('base64') },
        keyIdActiva: 'activa'
      })
    });
    const repositorio = new RepositorioImportacionesFederacionSql(sql, {
      repositorioCredenciales: credenciales,
      protectorSecretoPersistente: protector,
      adaptadorAuditoriaControl: new AdaptadorAuditoriaControlFederacion({
        repositorioAuditoria
      }),
      adaptadorAuditoriaSeguridad: new AdaptadorAuditoriaSeguridadFederacion({
        repositorioAuditoria
      })
    });
    const actor = {
      modo: 'directo', real: { tipo: 'usuario', id: String(USUARIO_SQL) },
      efectivo: null
    };
    const scope = { tenantId: null, empresaId: null, sitioId: null };
    await repositorio.prepararEmision({
      relacionId: RELACION_SQL, actor, scope,
      eventoId: generarUuidV7Auditoria(), correlacionId: generarUuidV7Auditoria()
    });
    const secretoInicial = `sfr1_${'N'.repeat(64)}`;
    await repositorio.consolidarInvitacion({
      relacionId: RELACION_SQL,
      installationLocalId: INSTALACION,
      installationRemotaId: INSTALACION_CLON,
      nombreRemotoDeclarado: 'receptor.example.test',
      origenPublico: 'https://receptor.example.test',
      secretoPersistente: secretoInicial,
      actor, scope,
      eventoId: generarUuidV7Auditoria(), correlacionId: generarUuidV7Auditoria()
    });
    let [relacion] = await sql.consultar(
      'SELECT estado_ciclo,estado_compatibilidad FROM relaciones_federacion WHERE relacion_id=?',
      [RELACION_SQL]
    );
    assert.equal(relacion.estado_ciclo, 'pendienteAutenticacion');
    const metadatos = await credenciales.buscarMetadatosSaneados(RELACION_SQL);
    assert.equal(metadatos.tipoMaterial, 'secretoCifrado');
    assert.equal(JSON.stringify(metadatos).includes(secretoInicial), false);
    const salud = new RepositorioSaludFederacionSql(sql, {
      adaptadorAuditoria: new AdaptadorAuditoriaHeartbeatFederacion({
        repositorioAuditoria
      })
    });
    await salud.registrarHeartbeatEmisor({
      relacionId: RELACION_SQL,
      sesionId: generarUuidV7Auditoria(),
      seq: '1', compatibilidad: 'compatible',
      estadoRemoto: 'pendienteAutenticacion', exito: true
    });
    [relacion] = await sql.consultar(
      'SELECT estado_ciclo FROM relaciones_federacion WHERE relacion_id=?',
      [RELACION_SQL]
    );
    assert.equal(relacion.estado_ciclo, 'pendienteAutenticacion');
    await salud.registrarHeartbeatEmisor({
      relacionId: RELACION_SQL,
      sesionId: generarUuidV7Auditoria(),
      seq: '2', compatibilidad: 'compatible',
      estadoRemoto: 'vinculada', exito: true
    });
    [relacion] = await sql.consultar(
      'SELECT estado_ciclo,estado_compatibilidad FROM relaciones_federacion WHERE relacion_id=?',
      [RELACION_SQL]
    );
    assert.deepEqual(
      [relacion.estado_ciclo, relacion.estado_compatibilidad],
      ['vinculada', 'compatible']
    );
    await repositorio.validarRecuperacion({
      relacionId: RELACION_SQL,
      installationRemotaId: INSTALACION_CLON,
      actor, scope,
      eventoId: generarUuidV7Auditoria(), correlacionId: generarUuidV7Auditoria()
    });
    await sql.ejecutar(
      'UPDATE usuarios SET permiso_configurar_emisiones_federacion=0 WHERE id=?',
      [USUARIO_SQL]
    );
    await assert.rejects(
      repositorio.validarRecuperacion({
        relacionId: RELACION_SQL,
        installationRemotaId: INSTALACION_CLON,
        actor, scope,
        eventoId: generarUuidV7Auditoria(), correlacionId: generarUuidV7Auditoria()
      }),
      /ya no conserva autoridad emisora/u
    );
    await sql.ejecutar(
      'UPDATE usuarios SET permiso_configurar_emisiones_federacion=1 WHERE id=?',
      [USUARIO_SQL]
    );
    const secretoRecuperado = `sfr1_${'O'.repeat(64)}`;
    const recuperada = await repositorio.aplicarRecuperacion({
      relacionId: RELACION_SQL,
      installationLocalId: INSTALACION,
      installationRemotaId: INSTALACION_CLON,
      origenPublico: 'https://receptor-nuevo.example.test',
      secretoPersistente: secretoRecuperado,
      actor, scope,
      eventoId: generarUuidV7Auditoria(), correlacionId: generarUuidV7Auditoria()
    });
    assert.equal(recuperada.versionCredencial, 2);
    const [localizacion] = await sql.consultar(
      `SELECT endpoint_https FROM localizaciones_relaciones_federacion
        WHERE relacion_id=? AND estado='activa'`,
      [RELACION_SQL]
    );
    assert.equal(localizacion.endpoint_https, 'https://receptor-nuevo.example.test');
    const eventosAuditoria = await sql.consultar(
      'SELECT payload FROM eventos_auditoria WHERE sujeto_id=?',
      [RELACION_SQL]
    );
    assert.equal(JSON.stringify(eventosAuditoria).includes('sfr1_'), false);
  } finally {
    await limpiarSql(sql);
    await sql.cerrar();
  }
}

async function limpiarSql(sql) {
  await sql.ejecutar(
    'DELETE FROM actividad_emision_relaciones_federacion WHERE relacion_id=?',
    [RELACION_SQL]
  ).catch(() => {});
  await sql.ejecutar(
    'DELETE FROM credenciales_persistentes_federacion WHERE relacion_id=?',
    [RELACION_SQL]
  ).catch(() => {});
  await sql.ejecutar(
    'DELETE FROM localizaciones_relaciones_federacion WHERE relacion_id=?',
    [RELACION_SQL]
  ).catch(() => {});
  await sql.ejecutar(
    'DELETE FROM historico_estados_relaciones_federacion WHERE relacion_id=?',
    [RELACION_SQL]
  ).catch(() => {});
  await sql.ejecutar(
    'DELETE FROM relaciones_federacion WHERE relacion_id=?',
    [RELACION_SQL]
  ).catch(() => {});
  await sql.ejecutar('DELETE FROM usuarios WHERE id=?', [USUARIO_SQL]).catch(() => {});
}

function leer(ruta) {
  return readFile(new URL(ruta, import.meta.url), 'utf8');
}

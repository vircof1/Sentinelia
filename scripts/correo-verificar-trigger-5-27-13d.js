import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import {
  evaluarPreparacionLocalTriggerCorreo,
  PERFIL_DESPLIEGUE_TRIGGER_CORREO,
  RepositorioPreparacionDespliegueTriggerCorreoSql
} from '../paquetes/correo/src/CompatibilidadDespliegueTriggerCorreo.js';
import { EvaluadorAutoridadCorreoSql }
  from '../paquetes/correo/src/EvaluadorAutoridadCorreoSql.js';
import { KeyringTecnicoCorreo }
  from '../paquetes/correo/src/KeyringTecnicoCorreo.js';
import { PerfilSmtpCorreo } from '../paquetes/correo/src/PerfilSmtpCorreo.js';
import { ServicioCorteAutoridadOrigenCorreo }
  from '../paquetes/correo/src/ServicioCorteAutoridadOrigenCorreo.js';
import { ServicioCorteRevisionTriggersCorreo }
  from '../paquetes/correo/src/ServicioCorteRevisionTriggersCorreo.js';
import { ServicioCorteVerificacionSmtpCorreo }
  from '../paquetes/correo/src/ServicioCorteVerificacionSmtpCorreo.js';
import { ValidadorConfiguracionCorreo }
  from '../paquetes/correo/src/ValidadorConfiguracionCorreo.js';
import { RepositorioConfiguracion }
  from '../paquetes/configuracion/src/RepositorioConfiguracion.js';
import { ServicioConfiguracionPortal }
  from '../paquetes/configuracion/src/ServicioConfiguracionPortal.js';
import { obtenerDefinicionesConfiguracionPortal }
  from '../paquetes/configuracion/src/obtenerDefinicionesConfiguracionPortal.js';
import { ClienteSql } from '../paquetes/persistencia-sql/src/ClienteSql.js';
import { EjecutorMigraciones }
  from '../paquetes/persistencia-sql/src/EjecutorMigraciones.js';
import { FronteraTransaccionalLocal }
  from '../paquetes/persistencia-sql/src/FronteraTransaccionalLocal.js';
import { RepositorioMigraciones }
  from '../paquetes/persistencia-sql/src/RepositorioMigraciones.js';
import {
  obtenerConfiguracionAplicacion,
  obtenerRutaMigraciones
} from '../paquetes/utilidades/src/configuracion/obtenerConfiguracionAplicacion.js';

const CONTEXTO_ADMIN = Object.freeze({
  idUsuario: 1,
  idUsuarioReal: 1,
  nivelScope: 'portal',
  permisos: Object.freeze({ administrarConfiguracion: true, verAuditoria: true })
});

await main();

async function main() {
  const configuracion = obtenerConfiguracionAplicacion();
  assert.equal(configuracion.sql.estaCompleta, true,
    '5.27.13d necesita MariaDB real.');
  const administrador = new ClienteSql(configuracion.sql);
  const nombre = `sentinelia_fixture_52713d_${randomBytes(5).toString('hex')}`;
  let sql;
  try {
    await administrador.ejecutar(
      `CREATE DATABASE ${administrador.escaparIdentificador(nombre)} ` +
        'CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci'
    );
    sql = new ClienteSql({ ...configuracion.sql, baseDatos: nombre });
    const repositorioMigraciones = new RepositorioMigraciones(sql);
    const migraciones = await new EjecutorMigraciones({
      clienteSql: sql,
      repositorioMigraciones,
      rutaMigraciones: obtenerRutaMigraciones()
    }).ejecutarPendientes();
    assert.equal(migraciones.integridad.ok, true);
    const frontera = new FronteraTransaccionalLocal(sql);
    const repositorio = new RepositorioConfiguracion(sql);
    const perfil = new PerfilSmtpCorreo({
      keyringTecnicoCorreo: new KeyringTecnicoCorreo({
        keyring: { activa: Buffer.alloc(32, 0x5d).toString('base64') },
        keyIdActiva: 'activa'
      })
    });
    let versionRedis = null;
    const versionador = {
      async obtenerVersionActual() { return versionRedis; },
      async publicarVersion(version) {
        versionRedis = Number(version);
        return versionRedis;
      }
    };
    const servicioConfiguracion = new ServicioConfiguracionPortal({
      repositorioConfiguracion: repositorio,
      versionadorConfiguracionRedis: versionador,
      definiciones: obtenerDefinicionesConfiguracionPortal(configuracion),
      fronteraTransaccional: frontera,
      servicioAuditoria: { async registrarEnTransaccion() {} },
      perfilSmtpCorreo: perfil
    });
    await servicioConfiguracion.bootstrapYcargar();
    await configurarSmtpLegacy(sql);
    const unanimidad = {
      unanimidad: true,
      gateAbierto: false,
      perfil: PERFIL_DESPLIEGUE_TRIGGER_CORREO
    };
    await new ServicioCorteAutoridadOrigenCorreo({
      repositorioConfiguracion: repositorio,
      fronteraTransaccional: frontera,
      versionadorConfiguracionRedis: versionador
    }).ejecutar({ preparacionUnanime: unanimidad });
    await new ServicioCorteRevisionTriggersCorreo({
      repositorioConfiguracion: repositorio,
      fronteraTransaccional: frontera
    }).ejecutar({ preparacionUnanime: unanimidad });
    const evaluador = new EvaluadorAutoridadCorreoSql({
      repositorioConfiguracion: repositorio,
      perfilSmtpCorreo: perfil,
      validadorConfiguracionCorreo: new ValidadorConfiguracionCorreo()
    });
    assert.equal((await evaluar(frontera, evaluador)).puedeDespachar, false);
    const servicioCorte = new ServicioCorteVerificacionSmtpCorreo({
      repositorioConfiguracion: repositorio,
      fronteraTransaccional: frontera,
      versionadorConfiguracionRedis: versionador
    });
    const corte = await servicioCorte.ejecutar({ preparacionUnanime: unanimidad });
    assert.equal(corte.cambioEfectivo, true);
    assert.equal(corte.requiereReverificacion, true);
    await servicioConfiguracion.asegurarActualizada();
    const fotografia = await new RepositorioPreparacionDespliegueTriggerCorreoSql(sql)
      .fotografiar();
    assert.equal(evaluarPreparacionLocalTriggerCorreo({
      migracionesAplicadas: await repositorioMigraciones.listarNombresAplicados(),
      postcondicionesMigracionesVerificadas: migraciones.integridad.ok,
      fotografia
    }).estado, 'corte_verificacion');
    assert.equal((await sql.consultar(
      `SELECT valor FROM configuracion_portal
        WHERE clave='correo.operativo_verificado'`
    ))[0].valor, 'false');
    const [estadoInvalidado] = await sql.consultar(
      'SELECT * FROM estado_verificacion_correo WHERE id=1'
    );
    assert.equal(Number(estadoInvalidado.verificado), 0);
    assert.equal(estadoInvalidado.codigo_invalidacion,
      'corte_smtp_reverificacion_requerida');
    assert.equal((await evaluar(frontera, evaluador)).codigo,
      'correo_smtp_no_verificado');
    await assert.rejects(
      servicioConfiguracion.marcarCorreoOperativoVerificado(CONTEXTO_ADMIN),
      /verificación legacy de correo ya no es autoridad/u
    );
    const lectura = await frontera.ejecutar((conexion) =>
      repositorio.bloquearAutoridadCorreoEnTransaccion({
        conexion,
        modo: 'compartido'
      })
    );
    const prueba = perfil.crearPrueba(lectura.valores);
    await servicioConfiguracion.promoverCorreoSmtpVerificado({
      pruebaToken: {
        perfilSmtp: prueba.perfilVersion,
        perfilBuzon: prueba.perfilBuzon,
        keyId: prueba.keyId,
        huellaConfiguracion: prueba.huellaHmac.toString('hex')
      },
      contextoUsuarioActual: CONTEXTO_ADMIN
    });
    assert.equal((await evaluar(frontera, evaluador)).puedeDespachar, true);
    const repetido = await servicioCorte.ejecutar({ preparacionUnanime: unanimidad });
    assert.equal(repetido.cambioEfectivo, false);
    assert.equal(repetido.requiereReverificacion, false,
      'Un reinicio no puede retirar una reverificación smtp@1 posterior al corte.');
    assert.equal((await evaluar(frontera, evaluador)).puedeDespachar, true);
    assert.equal((await new ServicioCorteAutoridadOrigenCorreo({
      repositorioConfiguracion: repositorio,
      fronteraTransaccional: frontera,
      versionadorConfiguracionRedis: versionador
    }).ejecutar({ preparacionUnanime: unanimidad })).cambioEfectivo, false);
    assert.equal((await new ServicioCorteRevisionTriggersCorreo({
      repositorioConfiguracion: repositorio,
      fronteraTransaccional: frontera
    }).ejecutar({ preparacionUnanime: unanimidad })).cambioEfectivo, false);
    console.log(
      '[correo-trigger] OK 5.27.13d: legacy retirado, POST smtp@1 habilitado, ' +
      'canal cerrado hasta reverificación explícita y reinicio idempotente'
    );
  } finally {
    await sql?.cerrar().catch(() => {});
    await administrador.ejecutar(
      `DROP DATABASE IF EXISTS ${administrador.escaparIdentificador(nombre)}`
    ).catch(() => {});
    await administrador.cerrar();
  }
}

async function configurarSmtpLegacy(sql) {
  const valores = new Map([
    ['correo.activo', 'true'],
    ['correo.smtp_host', 'smtp.example.test'],
    ['correo.smtp_puerto', '587'],
    ['correo.smtp_secure', 'false'],
    ['correo.smtp_usuario', 'sentinelia'],
    ['correo.smtp_password', 'secreto-13d'],
    ['correo.smtp_auth_method', 'PLAIN'],
    ['correo.smtp_timeout_conexion_ms', '10000'],
    ['correo.smtp_timeout_saludo_ms', '10000'],
    ['correo.smtp_timeout_socket_ms', '30000'],
    ['correo.smtp_tls_permitir_inseguro', 'false'],
    ['correo.remitente_email', 'alertas@example.test'],
    ['correo.remitente_nombre', 'Sentinelia'],
    ['correo.operativo_verificado', 'true']
  ]);
  for (const [clave, valor] of valores) {
    await sql.ejecutar(
      'UPDATE configuracion_portal SET valor=? WHERE clave=?',
      [valor, clave]
    );
  }
}

function evaluar(frontera, evaluador) {
  return frontera.ejecutar((conexion) =>
    evaluador.evaluarEnTransaccion({ conexion }));
}

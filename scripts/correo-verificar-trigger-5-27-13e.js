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
import { RepositorioColaCorreo }
  from '../paquetes/correo/src/RepositorioColaCorreo.js';
import { DespachadorCorreoRuntime }
  from '../apps/sentinelia-runtime/src/correo/DespachadorCorreoRuntime.js';
import { ServicioCorteAutoridadColaCorreo }
  from '../paquetes/correo/src/ServicioCorteAutoridadColaCorreo.js';
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

const ADMIN = Object.freeze({
  idUsuario: 1,
  idUsuarioReal: 1,
  nivelScope: 'portal',
  permisos: Object.freeze({ administrarConfiguracion: true, verAuditoria: true })
});

await main();

async function main() {
  const configuracion = obtenerConfiguracionAplicacion();
  assert.equal(configuracion.sql.estaCompleta, true,
    '5.27.13e necesita MariaDB real.');
  const administrador = new ClienteSql(configuracion.sql);
  const nombre = `sentinelia_fixture_52713e_${randomBytes(5).toString('hex')}`;
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
    const repositorioConfiguracion = new RepositorioConfiguracion(sql);
    const perfil = new PerfilSmtpCorreo({
      keyringTecnicoCorreo: new KeyringTecnicoCorreo({
        keyring: { activa: Buffer.alloc(32, 0x6e).toString('base64') },
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
      repositorioConfiguracion,
      versionadorConfiguracionRedis: versionador,
      definiciones: obtenerDefinicionesConfiguracionPortal(configuracion),
      fronteraTransaccional: frontera,
      servicioAuditoria: { async registrarEnTransaccion() {} },
      perfilSmtpCorreo: perfil
    });
    await servicioConfiguracion.bootstrapYcargar();
    await prepararCorteSmtp(sql);
    const [cabecera] = await sql.consultar(
      'SELECT CAST(version AS CHAR) AS version FROM cabecera_configuracion_portal WHERE id=1'
    );
    await versionador.publicarVersion(cabecera.version);
    await servicioConfiguracion.cargarDesdePersistencia(cabecera.version);
    const evaluador = new EvaluadorAutoridadCorreoSql({
      repositorioConfiguracion,
      perfilSmtpCorreo: perfil,
      validadorConfiguracionCorreo: new ValidadorConfiguracionCorreo()
    });
    const lectura = await frontera.ejecutar((conexion) =>
      repositorioConfiguracion.bloquearAutoridadCorreoEnTransaccion({
        conexion, modo: 'compartido'
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
      contextoUsuarioActual: ADMIN
    });
    const cola = new RepositorioColaCorreo(sql);
    const legado = await cola.crearPendienteLegacy({
      destinatarioEmail: 'destino@example.test',
      destinatarioNombre: 'Destino',
      remitenteEmail: 'alertas@example.test',
      remitenteNombre: 'Sentinelia',
      asunto: 'Pendiente legacy',
      cuerpoTexto: 'Debe drenarse antes del corte.',
      creadoPorUsuarioId: null
    });
    let reloj = new Date('2026-09-03T20:00:00.000Z');
    const servicio = new ServicioCorteAutoridadColaCorreo({
      repositorioConfiguracion,
      evaluadorAutoridadCorreoSql: evaluador,
      fronteraTransaccional: frontera,
      versionadorConfiguracionRedis: versionador,
      ahora: () => reloj
    });
    const unanimidad = {
      unanimidad: true,
      gateAbierto: false,
      perfil: PERFIL_DESPLIEGUE_TRIGGER_CORREO
    };
    assert.equal((await servicio.avanzar({ preparacionUnanime: unanimidad })).fase,
      'drenando');
    await assert.rejects(
      cola.crearPendienteLegacy({
        destinatarioEmail: 'nuevo@example.test',
        remitenteEmail: 'alertas@example.test',
        asunto: 'Reaparición',
        cuerpoTexto: 'No debe entrar.'
      }),
      /quietud de correo rechaza productores legacy/u
    );
    const drenando = await servicio.avanzar({ preparacionUnanime: unanimidad });
    assert.equal(drenando.fase, 'drenando');
    assert.equal(drenando.fotografia.legacyActivas, 1);
    await cola.registrarEnvioExitoso({
      idCorreo: legado.id,
      mensajeId: 'legacy-drenado',
      respuestaProveedor: '250 accepted'
    });
    const observada = await servicio.avanzar({ preparacionUnanime: unanimidad });
    assert.equal(observada.fase, 'esperando_quietud');
    assert.ok(observada.quietudRestanteMs > 0);
    reloj = new Date(reloj.getTime() + observada.quietudRestanteMs + 1);
    const activada = await servicio.avanzar({ preparacionUnanime: unanimidad });
    assert.equal(activada.fase, 'activada');
    const fotografia = await new RepositorioPreparacionDespliegueTriggerCorreoSql(sql)
      .fotografiar();
    assert.equal(evaluarPreparacionLocalTriggerCorreo({
      migracionesAplicadas: await repositorioMigraciones.listarNombresAplicados(),
      postcondicionesMigracionesVerificadas: migraciones.integridad.ok,
      fotografia
    }).estado, 'activado');
    assert.equal(Number(fotografia.estado.cola_sql_autoritativa), 1);
    assert.ok(fotografia.estado.quietud_iniciada_en_utc);
    assert.ok(fotografia.estado.quietud_observada_en_utc);
    assert.ok(fotografia.estado.activado_en_utc);
    await assert.rejects(
      sql.ejecutar('UPDATE cola_correos_salida SET asunto=asunto WHERE id=?', [legado.id]),
      /autoridad SQL de correo rechaza despachadores legacy/u
    );
    assert.equal((await servicio.avanzar({ preparacionUnanime: unanimidad })).fase,
      'activada');
    assert.equal((await new ServicioCorteAutoridadOrigenCorreo({
      repositorioConfiguracion,
      fronteraTransaccional: frontera,
      versionadorConfiguracionRedis: versionador
    }).ejecutar({ preparacionUnanime: unanimidad })).cambioEfectivo, false);
    assert.equal((await new ServicioCorteRevisionTriggersCorreo({
      repositorioConfiguracion,
      fronteraTransaccional: frontera
    }).ejecutar({ preparacionUnanime: unanimidad })).cambioEfectivo, false);
    assert.equal((await new ServicioCorteVerificacionSmtpCorreo({
      repositorioConfiguracion,
      fronteraTransaccional: frontera,
      versionadorConfiguracionRedis: versionador
    }).ejecutar({ preparacionUnanime: unanimidad })).cambioEfectivo, false);
    await verificarDrenajeLegacyConAutoridadSmtp();
    console.log(
      '[correo-trigger] OK 5.27.13e: productor legacy bloqueado, drenaje permitido, ' +
      'quietud doble demostrada, propietarios ausentes y cola SQL irreversible'
    );
  } finally {
    await sql?.cerrar().catch(() => {});
    await administrador.ejecutar(
      `DROP DATABASE IF EXISTS ${administrador.escaparIdentificador(nombre)}`
    ).catch(() => {});
    await administrador.cerrar();
  }
}

async function verificarDrenajeLegacyConAutoridadSmtp() {
  let evaluaciones = 0;
  const runtime = new DespachadorCorreoRuntime({
    servicioConfiguracionPortal: {
      async asegurarActualizada() {},
      obtenerEstadoDespliegueCorreoActual() {
        return { verificacion_smtp_autoritativa: 1, cola_sql_autoritativa: 0 };
      }
    },
    servicioCorreoPortal: {
      obtenerEstadoConfiguracion() {
        throw new Error('No debe consultar la autoridad booleana legacy.');
      },
      obtenerConfiguracionCorreoActual() { return { runtimeLoteMaximo: 1 }; },
      async despacharSiguientePendiente() {
        throw new Error('No debe revalidar el booleano legacy.');
      },
      async despacharSiguientePendienteConAutoridad() { return { correo: null }; }
    },
    evaluadorAutoridadCorreoSql: {
      async evaluarEnTransaccion() {
        evaluaciones += 1;
        return {
          puedeDespachar: true,
          configurado: true,
          configuracion: { activo: true },
          errores: [],
          advertencias: []
        };
      }
    },
    fronteraTransaccional: { async ejecutar(trabajo) { return trabajo({}); } }
  });
  const resultado = await runtime.despacharPendientes({ origen: 'corte' });
  assert.equal(resultado.regimen, 'legacy');
  assert.equal(resultado.sinPendientes, true);
  assert.equal(evaluaciones, 1);
}

async function prepararCorteSmtp(sql) {
  const valores = new Map([
    ['correo.activo', 'true'],
    ['correo.smtp_host', 'smtp.example.test'],
    ['correo.smtp_puerto', '587'],
    ['correo.smtp_secure', 'false'],
    ['correo.smtp_usuario', 'sentinelia'],
    ['correo.smtp_password', 'secreto-13e'],
    ['correo.smtp_auth_method', 'PLAIN'],
    ['correo.smtp_timeout_conexion_ms', '1000'],
    ['correo.smtp_timeout_saludo_ms', '1000'],
    ['correo.smtp_timeout_socket_ms', '1000'],
    ['correo.smtp_tls_permitir_inseguro', 'false'],
    ['correo.remitente_email', 'alertas@example.test'],
    ['correo.remitente_nombre', 'Sentinelia'],
    ['correo.operativo_verificado', 'false']
  ]);
  for (const [clave, valor] of valores) {
    await sql.ejecutar('UPDATE configuracion_portal SET valor=? WHERE clave=?', [valor, clave]);
  }
  await sql.ejecutar(
    `UPDATE estado_despliegue_trigger_correo
        SET estado='corte_verificacion', guard_metadatos_activo=1,
            origen_portal_autoritativo=1, verificacion_smtp_autoritativa=1,
            guard_verificacion_legacy_activo=1,
            guard_revision_trigger_activo=1, cortado_en_utc=UTC_TIMESTAMP(3),
            revision=4
      WHERE id=1`
  );
  await sql.ejecutar(
    'UPDATE cabecera_configuracion_portal SET version=version+1 WHERE id=1'
  );
}

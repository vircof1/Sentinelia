import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';

import { validarEventoAuditableV1 } from '../paquetes/auditoria/src/ValidadorContratoAuditoria.js';
import { ServicioVerificacionCorreoOperativo }
  from '../apps/sentinelia-web/src/servicios/ServicioVerificacionCorreoOperativo.js';
import { ConfiguracionCorreo } from '../paquetes/correo/src/ConfiguracionCorreo.js';
import { EvaluadorAutoridadCorreoSql }
  from '../paquetes/correo/src/EvaluadorAutoridadCorreoSql.js';
import { KeyringTecnicoCorreo }
  from '../paquetes/correo/src/KeyringTecnicoCorreo.js';
import { PerfilSmtpCorreo } from '../paquetes/correo/src/PerfilSmtpCorreo.js';
import { RepositorioColaCorreo } from '../paquetes/correo/src/RepositorioColaCorreo.js';
import { ValidadorConfiguracionCorreo }
  from '../paquetes/correo/src/ValidadorConfiguracionCorreo.js';
import { obtenerDefinicionesConfiguracionPortal }
  from '../paquetes/configuracion/src/obtenerDefinicionesConfiguracionPortal.js';
import { RepositorioConfiguracion }
  from '../paquetes/configuracion/src/RepositorioConfiguracion.js';
import { ServicioConfiguracionPortal }
  from '../paquetes/configuracion/src/ServicioConfiguracionPortal.js';
import { ClienteSql } from '../paquetes/persistencia-sql/src/ClienteSql.js';
import { EjecutorMigraciones } from '../paquetes/persistencia-sql/src/EjecutorMigraciones.js';
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

async function main() {
  const configuracion = obtenerConfiguracionAplicacion();
  assert.equal(configuracion.sql.estaCompleta, true, '5.27.1d necesita MariaDB real.');
  const administrador = new ClienteSql(configuracion.sql);
  const nombre = `sentinelia_fixture_5271d_${randomBytes(5).toString('hex')}`;
  let sql;
  try {
    await administrador.ejecutar(
      `CREATE DATABASE ${administrador.escaparIdentificador(nombre)} ` +
        'CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci'
    );
    sql = new ClienteSql({ ...configuracion.sql, baseDatos: nombre });
    await new EjecutorMigraciones({
      clienteSql: sql,
      repositorioMigraciones: new RepositorioMigraciones(sql),
      rutaMigraciones: obtenerRutaMigraciones()
    }).ejecutarPendientes();

    const keyring = new KeyringTecnicoCorreo({
      keyring: { activa: Buffer.alloc(32, 0x51).toString('base64') },
      keyIdActiva: 'activa'
    });
    const perfil = new PerfilSmtpCorreo({ keyringTecnicoCorreo: keyring });
    const repositorio = new RepositorioConfiguracion(sql);
    const auditoria = [];
    const servicioConfiguracion = crearServicioConfiguracion({
      sql,
      repositorio,
      definiciones: obtenerDefinicionesConfiguracionPortal(configuracion),
      perfil,
      auditoria
    });
    await servicioConfiguracion.bootstrapYcargar();
    await prepararConfiguracionYBacklog(sql);
    await recargarConfiguracion(sql, servicioConfiguracion);

    const smtp = new SmtpFixture();
    const cola = new RepositorioColaCorreo(sql);
    const servicioCorreo = crearServicioCorreo({
      servicioConfiguracion,
      cola,
      smtp
    });
    const redis = new RedisMemoria();
    const verificacion = new ServicioVerificacionCorreoOperativo({
      clienteRedis: redis,
      repositorioUsuarios: new RepositorioUsuariosFixture(),
      servicioConfiguracionPortal: servicioConfiguracion,
      servicioCorreoPortal: servicioCorreo,
      perfilSmtpCorreo: perfil
    });

    const portalPreparado = servicioConfiguracion.obtenerConfiguracionActual();
    assert.equal(portalPreparado.obtenerOrigenPublicoPortal(),
      'https://legacy.example');
    assert.equal(portalPreparado.obtenerConfiguracionFederacion().origenPublico,
      'https://legacy.example');
    assert.deepEqual(origenesVisibles(portalPreparado),
      ['federacion.origen_publico']);

    await verificacion.iniciarVerificacion({ idUsuario: 1 });
    assert.match(smtp.ultimo.enlaceVerificacion,
      /^https:\/\/legacy\.example\/configuracion\/correo\/verificar\//u);
    const tokenLegacy = tokenDesde(smtp.ultimo.enlaceVerificacion);
    const confirmacionLegacy = await verificacion.abrirVerificacion({
      token: tokenLegacy,
      idUsuario: 1,
      contextoUsuarioActual: CONTEXTO_ADMIN
    });
    assert.equal(confirmacionLegacy.legado, true);
    assert.equal(await cargarValor(sql, 'correo.operativo_verificado'), 'true');
    assert.equal(Number((await cargarEstadoVerificacion(sql)).verificado), 0,
      'La preparación no promociona silenciosamente la cabecera smtp@1.');

    await prepararCorteDePrueba(sql);
    await recargarConfiguracion(sql, servicioConfiguracion);
    const portalNeutral = servicioConfiguracion.obtenerConfiguracionActual();
    assert.equal(portalNeutral.obtenerOrigenPublicoPortal(),
      'https://neutral.example');
    assert.equal(portalNeutral.obtenerConfiguracionFederacion().origenPublico,
      'https://neutral.example');
    assert.deepEqual(origenesVisibles(portalNeutral), ['portal.origen_publico']);
    await assert.rejects(
      servicioConfiguracion.actualizarValor({
        clave: 'federacion.origen_publico',
        valor: 'https://resurreccion.example',
        contextoUsuarioActual: CONTEXTO_ADMIN
      }),
      /no es editable/iu
    );

    await verificacion.iniciarVerificacion({ idUsuario: 1 });
    assert.match(smtp.ultimo.enlaceVerificacion,
      /^https:\/\/neutral\.example\/configuracion\/correo\/verificar\//u);
    const token = tokenDesde(smtp.ultimo.enlaceVerificacion);
    const mutacionesAntesGet = redis.mutaciones;
    const estadoAntesGet = await cargarEstadoVerificacion(sql);
    const inspeccion = await verificacion.abrirVerificacion({
      token,
      idUsuario: 1,
      contextoUsuarioActual: CONTEXTO_ADMIN
    });
    assert.equal(inspeccion.requiereConfirmacion, true);
    assert.equal(inspeccion.backlog.total, 2);
    assert.equal(inspeccion.backlog.porOrigen[0].origen, 'legacy');
    assert.equal(redis.mutaciones, mutacionesAntesGet,
      'GET no consume, renueva ni reemplaza la capacidad.');
    assert.deepEqual(await cargarEstadoVerificacion(sql), estadoAntesGet,
      'GET no promueve ninguna autoridad SQL.');

    await assert.rejects(
      verificacion.confirmarVerificacion({
        token,
        idUsuario: 1,
        contextoUsuarioActual: CONTEXTO_ADMIN,
        aceptaReanudacion: false
      }),
      (error) => error?.codigo === 'correo_reanudacion_no_aceptada'
    );
    assert.equal(await redis.get(verificacion.obtenerClaveToken(token)) !== null, true);

    const confirmada = await verificacion.confirmarVerificacion({
      token,
      idUsuario: 1,
      contextoUsuarioActual: CONTEXTO_ADMIN,
      aceptaReanudacion: true
    });
    assert.equal(confirmada.promocion.perfilVersion, 'smtp@1');
    assert.equal(confirmada.backlog.total, 2);
    assert.equal(await redis.get(verificacion.obtenerClaveToken(token)), null);
    const estadoPromovido = await cargarEstadoVerificacion(sql);
    assert.equal(Number(estadoPromovido.verificado), 1);
    assert.equal(estadoPromovido.perfil_version, 'smtp@1');
    assert.equal(estadoPromovido.key_id, 'activa');
    assert.equal(await cargarValor(sql, 'correo.operativo_verificado'), 'false');
    assert.equal(auditoria.filter((evento) =>
      evento.tipo === 'configuracion.correo_operativo_verificado').length, 2);

    const evaluador = new EvaluadorAutoridadCorreoSql({
      repositorioConfiguracion: repositorio,
      perfilSmtpCorreo: perfil,
      validadorConfiguracionCorreo: new ValidadorConfiguracionCorreo()
    });
    assert.equal((await evaluar(sql, evaluador)).puedeDespachar, true);

    await servicioConfiguracion.actualizarValor({
      clave: 'portal.origen_publico',
      valor: 'https://neutral-dos.example',
      contextoUsuarioActual: CONTEXTO_ADMIN
    });
    assert.equal(
      servicioConfiguracion.obtenerConfiguracionActual()
        .obtenerConfiguracionFederacion().origenPublico,
      'https://neutral-dos.example'
    );
    assert.equal((await evaluar(sql, evaluador)).puedeDespachar, true,
      'Cambiar el origen no finge que el transporte SMTP haya cambiado.');

    await verificacion.iniciarVerificacion({ idUsuario: 1 });
    const tokenObsoleto = tokenDesde(smtp.ultimo.enlaceVerificacion);
    await verificacion.abrirVerificacion({
      token: tokenObsoleto,
      idUsuario: 1,
      contextoUsuarioActual: CONTEXTO_ADMIN
    });
    await servicioConfiguracion.actualizarValor({
      clave: 'correo.smtp_host',
      valor: 'smtp-cambiado.example',
      contextoUsuarioActual: CONTEXTO_ADMIN
    });
    await assert.rejects(
      verificacion.confirmarVerificacion({
        token: tokenObsoleto,
        idUsuario: 1,
        contextoUsuarioActual: CONTEXTO_ADMIN,
        aceptaReanudacion: true
      }),
      (error) => error?.codigo === 'correo_prueba_smtp_obsoleta'
    );
    assert.equal(await redis.get(verificacion.obtenerClaveToken(tokenObsoleto)), null);
    assert.equal(Number((await cargarEstadoVerificacion(sql)).verificado), 0);

    await verificarSuperficieSegura();
    console.log(
      '[correo-trigger] OK 5.27.1d: origen=neutral_condicionado ' +
        'get=sin_efecto post=explicito backlog=visible smtp@1=atomico ' +
        'tokens=redactados gate_trigger=cerrado'
    );
  } finally {
    await sql?.cerrar().catch(() => {});
    await administrador.ejecutar(
      `DROP DATABASE IF EXISTS ${administrador.escaparIdentificador(nombre)}`
    ).catch(() => {});
    await administrador.cerrar();
  }
}

function crearServicioConfiguracion({ sql, repositorio, definiciones, perfil, auditoria }) {
  let version = null;
  return new ServicioConfiguracionPortal({
    repositorioConfiguracion: repositorio,
    definiciones,
    perfilSmtpCorreo: perfil,
    fronteraTransaccional: new FronteraTransaccionalLocal(sql),
    versionadorConfiguracionRedis: {
      async obtenerVersionActual() { return version; },
      async publicarVersion(nueva) {
        version = Number(nueva);
        return version;
      }
    },
    servicioAuditoria: {
      async registrarEnTransaccion({ intencion }) {
        validarEventoAuditableV1({
          tipo: intencion.tipo,
          actor: intencion.actorReal.tipo,
          origen: intencion.origen,
          sujeto: intencion.sujeto,
          flujo: intencion.flujo,
          productor: intencion.productor,
          rolEvento: intencion.rolEvento,
          payload: intencion.payload
        });
        auditoria.push(intencion);
      }
    },
    ahora: () => new Date('2026-09-03T15:00:00.000Z')
  });
}

function crearServicioCorreo({ servicioConfiguracion, cola, smtp }) {
  const validador = new ValidadorConfiguracionCorreo();
  return {
    obtenerConfiguracionCorreoActual() {
      return new ConfiguracionCorreo(
        servicioConfiguracion.obtenerConfiguracionActual().obtenerConfiguracionCorreo()
      );
    },
    obtenerEstadoConfiguracion() {
      return validador.evaluar(this.obtenerConfiguracionCorreoActual());
    },
    async enviarCorreoVerificacionOperativa(entrada) {
      return smtp.enviar(null, entrada);
    },
    async resumirBacklogDetenido() {
      return cola.resumirBacklogDetenido();
    }
  };
}

async function prepararConfiguracionYBacklog(sql) {
  const valores = new Map([
    ['federacion.origen_publico', 'https://legacy.example'],
    ['portal.origen_publico', 'https://neutral.example'],
    ['correo.activo', 'true'],
    ['correo.smtp_host', 'smtp.example'],
    ['correo.smtp_puerto', '587'],
    ['correo.smtp_secure', 'false'],
    ['correo.smtp_usuario', 'sentinelia'],
    ['correo.smtp_password', 'secreto-smtp-1d'],
    ['correo.smtp_auth_method', 'PLAIN'],
    ['correo.smtp_timeout_conexion_ms', '10000'],
    ['correo.smtp_timeout_saludo_ms', '10000'],
    ['correo.smtp_timeout_socket_ms', '30000'],
    ['correo.smtp_tls_permitir_inseguro', 'false'],
    ['correo.remitente_email', 'alertas@example.com'],
    ['correo.remitente_nombre', 'Sentinelia'],
    ['correo.operativo_verificado', 'false']
  ]);
  await enTransaccion(sql, async (conexion) => {
    for (const [clave, valor] of valores) {
      await conexion.execute(
        'UPDATE configuracion_portal SET valor = ? WHERE clave = ?',
        [valor, clave]
      );
    }
    for (const [estado, fecha] of [
      ['pendiente', '2026-09-01 10:00:00'],
      ['error_reintentable', '2026-09-02 10:00:00'],
      ['enviado', '2026-09-03 10:00:00']
    ]) {
      await conexion.execute(
        `INSERT INTO cola_correos_salida (
           destinatario_email, remitente_email, asunto, cuerpo_texto,
           estado, intentos, fecha_creacion, fecha_actualizacion
         ) VALUES ('destino@example.com', 'alertas@example.com', 'fixture',
                   'fixture', ?, 0, ?, ?)`,
        [estado, fecha, fecha]
      );
    }
    await conexion.execute(
      'UPDATE cabecera_configuracion_portal SET version = version + 1 WHERE id = 1'
    );
  });
}

async function prepararCorteDePrueba(sql) {
  await enTransaccion(sql, async (conexion) => {
    await conexion.execute(
      "UPDATE configuracion_portal SET valor='false' " +
        "WHERE clave='correo.operativo_verificado'"
    );
    await conexion.execute(
      `UPDATE estado_despliegue_trigger_correo
          SET estado = 'corte_verificacion',
              guard_metadatos_activo = 1,
              origen_portal_autoritativo = 1,
              verificacion_smtp_autoritativa = 1,
              guard_verificacion_legacy_activo = 1,
              cortado_en_utc = UTC_TIMESTAMP(3)
        WHERE id = 1`
    );
    await conexion.execute(
      'UPDATE cabecera_configuracion_portal SET version = version + 1 WHERE id = 1'
    );
  });
}

async function recargarConfiguracion(sql, servicio) {
  const [fila] = await sql.consultar(
    'SELECT CAST(version AS CHAR) AS version FROM cabecera_configuracion_portal WHERE id=1'
  );
  await servicio.cargarDesdePersistencia(fila.version);
}

function origenesVisibles(portal) {
  return portal.listarEntradas()
    .map((entrada) => entrada.clave)
    .filter((clave) => clave.endsWith('.origen_publico'));
}

function tokenDesde(enlace) {
  return decodeURIComponent(new URL(enlace).pathname.split('/').at(-1));
}

async function evaluar(sql, evaluador) {
  return enTransaccion(sql, (conexion) =>
    evaluador.evaluarEnTransaccion({ conexion }));
}

async function cargarEstadoVerificacion(sql) {
  const [fila] = await sql.consultar(
    'SELECT * FROM estado_verificacion_correo WHERE id=1'
  );
  return fila;
}

async function cargarValor(sql, clave) {
  const [fila] = await sql.consultar(
    'SELECT valor FROM configuracion_portal WHERE clave=?',
    [clave]
  );
  return fila?.valor;
}

async function verificarSuperficieSegura() {
  const [
    rutas,
    controlador,
    vista,
    nginx,
    catalogoTipos,
    servicioTriggers,
    manifiestoAuditoria
  ] = await Promise.all([
    leer('../apps/sentinelia-web/src/rutas/crearRutasPortal.js'),
    leer('../apps/sentinelia-web/src/controladores/ControladorPortal.js'),
    leer('../apps/sentinelia-web/src/views/portal/correo-verificacion-confirmar.ejs'),
    leer('../despliegue/federacion/nginx/sentinelia.conf.example'),
    leer('../paquetes/triggers/src/CatalogoTiposTrigger.js'),
    leer('../paquetes/triggers/src/ServicioTriggers.js'),
    leer('../paquetes/auditoria/src/ManifiestoCoberturaAuditoria.js')
  ]);
  assert.match(rutas,
    /router\.post\([\s\S]*?\/configuracion\/correo\/verificar\/:token[\s\S]*?validarCsrfPortal/u);
  for (const cabecera of ['Cache-Control', 'Referrer-Policy', 'Content-Security-Policy']) {
    assert.match(controlador, new RegExp(cabecera, 'u'));
  }
  assert.doesNotMatch(vista, /https?:\/\//u,
    'La confirmación no carga recursos de terceros.');
  assert.match(nginx, /correo\/verificar\/\[REDACTADO\]/u);
  assert.match(nginx, /email\/confirmar\/\[REDACTADO\]/u);
  assert.match(nginx, /\$sentinelia_http_referer_log/u);
  assert.equal(
    (nginx.match(/access_log \/var\/log\/nginx\/access\.log sentinelia_sin_secretos;/gu) || [])
      .length,
    2,
    'HTTP y HTTPS deben compartir la redacción de capacidades.'
  );
  assert.match(catalogoTipos, /correo/u,
    'Las unidades posteriores pueden declarar correo en el catálogo común.');
  assert.match(servicioTriggers, /tipo_correo_habilitado/u,
    'Declarar el tipo no debe abrir su creación o activación pública.');
  assert.match(
    manifiestoAuditoria,
    /ruta\('POST', '\/configuracion\/correo\/verificar\/:token', 'auditable'/u
  );
}

async function leer(ruta) {
  return readFile(new URL(ruta, import.meta.url), 'utf8');
}

async function enTransaccion(sql, trabajo) {
  const conexion = await sql.obtenerConexion();
  try {
    await conexion.beginTransaction();
    const resultado = await trabajo(conexion);
    await conexion.commit();
    return resultado;
  } catch (error) {
    await conexion.rollback().catch(() => {});
    throw error;
  } finally {
    conexion.release();
  }
}

class RedisMemoria {
  constructor() {
    this.valores = new Map();
    this.mutaciones = 0;
  }

  async get(clave) { return this.valores.get(clave) ?? null; }

  async set(clave, valor) {
    this.valores.set(clave, valor);
    this.mutaciones += 1;
  }

  async del(clave) {
    this.valores.delete(clave);
    this.mutaciones += 1;
  }
}

class RepositorioUsuariosFixture {
  async buscarPorId(id) {
    if (Number(id) !== 1) return null;
    return {
      id: 1,
      activo: true,
      email: 'admin@example.com',
      obtenerNombreVisible: () => 'Administración'
    };
  }
}

class SmtpFixture {
  async enviar(_configuracion, mensaje) {
    this.ultimo = Object.freeze({ ...mensaje });
    return Object.freeze({ aceptado: true });
  }
}

await main();

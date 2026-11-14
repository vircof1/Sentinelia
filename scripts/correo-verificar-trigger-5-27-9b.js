import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import ejs from 'ejs';

import { ServicioAdministracionTriggersPortal }
  from '../apps/sentinelia-web/src/servicios/ServicioAdministracionTriggersPortal.js';
import { RepositorioAdministracionTriggerCorreoSql }
  from '../paquetes/correo/src/RepositorioAdministracionTriggerCorreoSql.js';
import { RepositorioAudienciaTriggerCorreoSql }
  from '../paquetes/correo/src/RepositorioAudienciaTriggerCorreoSql.js';
import { RepositorioColaCorreo }
  from '../paquetes/correo/src/RepositorioColaCorreo.js';
import { ServicioAudienciaTriggerCorreo }
  from '../paquetes/correo/src/ServicioAudienciaTriggerCorreo.js';
import { ClienteSql } from '../paquetes/persistencia-sql/src/ClienteSql.js';
import { EjecutorMigraciones }
  from '../paquetes/persistencia-sql/src/EjecutorMigraciones.js';
import { FronteraTransaccionalLocal }
  from '../paquetes/persistencia-sql/src/FronteraTransaccionalLocal.js';
import { RepositorioMigraciones }
  from '../paquetes/persistencia-sql/src/RepositorioMigraciones.js';
import { RepositorioAsignacionesTriggerMonitor }
  from '../paquetes/triggers/src/RepositorioAsignacionesTriggerMonitor.js';
import { RepositorioTriggers } from '../paquetes/triggers/src/RepositorioTriggers.js';
import { ServicioTriggers } from '../paquetes/triggers/src/ServicioTriggers.js';
import { ValidadorTrigger } from '../paquetes/triggers/src/ValidadorTrigger.js';
import {
  obtenerConfiguracionAplicacion,
  obtenerRutaMigraciones
} from '../paquetes/utilidades/src/configuracion/obtenerConfiguracionAplicacion.js';

await main();

async function main() {
  const configuracion = obtenerConfiguracionAplicacion();
  assert.equal(configuracion.sql.estaCompleta, true, '5.27.9b necesita MariaDB real.');
  const administrador = new ClienteSql(configuracion.sql);
  const nombre = `sentinelia_fixture_5279b_${randomBytes(5).toString('hex')}`;
  let sql;
  try {
    await administrador.ejecutar(
      `CREATE DATABASE ${administrador.escaparIdentificador(nombre)} ` +
        'CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci'
    );
    sql = new ClienteSql({ ...configuracion.sql, baseDatos: nombre });
    const migraciones = await new EjecutorMigraciones({
      clienteSql: sql,
      repositorioMigraciones: new RepositorioMigraciones(sql),
      rutaMigraciones: obtenerRutaMigraciones()
    }).ejecutarPendientes();
    assert.equal(migraciones.integridad.ok, true);
    await sql.ejecutar(`
      INSERT INTO usuarios (id,usuario,hash_password,activo,email,email_validado)
      VALUES (1,'operador-5279b','fixture',1,'operador@example.test',1)
    `);

    const entorno = crearEntorno(sql);
    await verificarComposicionAtomica(sql, entorno);
    await verificarPruebaAislada(sql, entorno);
    await verificarEstadoYGate(sql, entorno);
    await verificarSuperficie();
    console.log(
      '[correo-trigger] OK 5.27.9b: formulario=mensaje_audiencia_atomicos ' +
        'revision=409 rollback=integro estados=derivados vinculo=capacidad_completa ' +
        'historico=especializado prueba=un_buzon_sin_semantica_trigger gate=oculto'
    );
  } finally {
    await sql?.cerrar().catch(() => {});
    await administrador.ejecutar(
      `DROP DATABASE IF EXISTS ${administrador.escaparIdentificador(nombre)}`
    ).catch(() => {});
    await administrador.cerrar();
  }
}

function crearEntorno(sql) {
  const frontera = new FronteraTransaccionalLocal(sql);
  const repositorioTriggers = new RepositorioTriggers(sql);
  const repositorioAudiencia = new RepositorioAudienciaTriggerCorreoSql();
  const servicioAudiencia = new ServicioAudienciaTriggerCorreo({
    repositorioAudiencia,
    fronteraTransaccional: frontera
  });
  const configuracionPortal = crearConfiguracionPortal();
  const apiAudiencia = {
    mutar: (_contexto, comando, { conexion = null } = {}) =>
      servicioAudiencia.mutar(comando, { conexion }),
    async leer() { return { relaciones: [], total: 0, restringidas: 0 }; },
    async buscarUsuariosElegibles() { return { resultados: [] }; }
  };
  const repositorioCola = new RepositorioColaCorreo(sql);
  const correoEstado = { puedeDespachar: true, errores: [] };
  const servicioCorreoPortal = {
    obtenerEstadoConfiguracion: () => ({ ...correoEstado }),
    encolarCorreoPrueba: (entrada) => repositorioCola.crearPendienteLegacy({
      ...entrada,
      remitenteEmail: 'sentinelia@example.test',
      remitenteNombre: 'Sentinelia'
    })
  };
  const servicioTriggers = new ServicioTriggers({
    repositorioTriggers,
    repositorioAsignacionesTriggerMonitor:
      new RepositorioAsignacionesTriggerMonitor(sql),
    validadorTrigger: new ValidadorTrigger(),
    servicioConfiguracionPortal: configuracionPortal
  });
  const crearPortal = (api = apiAudiencia) => new ServicioAdministracionTriggersPortal({
    repositorioTriggers,
    servicioTriggers,
    servicioMonitores: {},
    apiPrivadaAudienciaTriggerCorreo: api,
    apiPrivadaLecturaTriggerCorreo: {
      async listarPorTrigger() { return { total: 0, elementos: [] }; },
      async leerDetalle() { return null; }
    },
    repositorioAdministracionTriggerCorreo:
      new RepositorioAdministracionTriggerCorreoSql(sql),
    servicioConfiguracionPortal: configuracionPortal,
    servicioCorreoPortal,
    fronteraTransaccional: frontera
  });
  return {
    frontera,
    repositorioTriggers,
    repositorioAudiencia,
    servicioAudiencia,
    apiAudiencia,
    repositorioCola,
    configuracionPortal,
    servicioCorreoPortal,
    correoEstado,
    crearPortal,
    portal: crearPortal()
  };
}

async function verificarComposicionAtomica(sql, entorno) {
  const contexto = contextoPortal();
  const creado = await entorno.portal.crearTrigger(contexto, formulario({
    nombre: 'Correo 9b',
    audienciaManuales: 'uno@example.test',
    activo: '0'
  }));
  assert.equal(creado.tipo, 'correo');
  assert.equal(creado.revisionDeclaracion, 2);
  assert.equal((await contar(sql, 'triggers')), 1);
  assert.equal((await contar(sql, 'destinatarios_triggers_correo')), 1);

  const actualizado = await entorno.portal.actualizarTrigger(
    contexto,
    creado.id,
    formulario({
      id: creado.id,
      nombre: 'Correo 9b editado',
      revisionDeclaracion: creado.revisionDeclaracion,
      audienciaManuales: 'dos@example.test',
      activo: '1'
    })
  );
  assert.equal(actualizado.activo, true);
  assert.equal(actualizado.revisionDeclaracion, 4);
  assert.equal((await contar(sql, 'destinatarios_triggers_correo')), 2);

  await assert.rejects(
    entorno.portal.actualizarTrigger(contexto, creado.id, formulario({
      id: creado.id,
      nombre: 'No debe persistir',
      revisionDeclaracion: 2,
      audienciaManuales: 'tres@example.test',
      activo: '1'
    })),
    (error) => error?.codigo === 'trigger_revision_obsoleta' &&
      error?.statusCode === 409
  );
  assert.equal((await entorno.repositorioTriggers.buscarPorId(creado.id)).nombre,
    'Correo 9b editado');

  const apiQueFalla = {
    ...entorno.apiAudiencia,
    async mutar(contexto, comando, opciones) {
      await entorno.apiAudiencia.mutar(contexto, comando, opciones);
      throw new Error('fallo_inyectado_despues_audiencia');
    }
  };
  await assert.rejects(
    entorno.crearPortal(apiQueFalla).actualizarTrigger(
      contexto,
      creado.id,
      formulario({
        id: creado.id,
        nombre: 'Rollback 9b',
        revisionDeclaracion: actualizado.revisionDeclaracion,
        audienciaManuales: 'rollback@example.test',
        activo: '1'
      })
    ),
    /fallo_inyectado/u
  );
  assert.equal((await entorno.repositorioTriggers.buscarPorId(creado.id)).nombre,
    'Correo 9b editado');
  assert.equal((await contar(sql, 'destinatarios_triggers_correo')), 2);

  entorno.correoEstado.puedeDespachar = false;
  entorno.correoEstado.errores = ['Canal detenido para fixture.'];
  const editadoDuranteBloqueo = await entorno.portal.actualizarTrigger(
    contexto,
    creado.id,
    formulario({
      id: creado.id,
      nombre: 'Correo editable durante bloqueo',
      revisionDeclaracion: actualizado.revisionDeclaracion,
      activo: '1'
    })
  );
  assert.equal(editadoDuranteBloqueo.activo, true,
    'Perder SMTP no desactiva ni impide editar una declaración activa.');
  await assert.rejects(
    entorno.portal.crearTrigger(contexto, formulario({
      nombre: 'Creación bloqueada',
      audienciaManuales: 'bloqueada@example.test'
    })),
    (error) => error?.codigo === 'trigger_correo_sin_capacidad'
  );
  entorno.correoEstado.puedeDespachar = true;
  entorno.correoEstado.errores = [];
  entorno.triggerId = creado.id;
  entorno.revision = editadoDuranteBloqueo.revisionDeclaracion;
}

async function verificarPruebaAislada(sql, entorno) {
  const antes = {
    ejecuciones: await contar(sql, 'ejecuciones_triggers'),
    notificaciones: await contar(sql, 'notificaciones_triggers_correo'),
    capacidades: await contar(sql, 'capacidades_desuscripcion_correo')
  };
  const salida = await entorno.portal.probarCorreo(
    contextoPortal(),
    entorno.triggerId,
    {
      ...formulario({ revisionDeclaracion: entorno.revision, activo: '1' }),
      destinatarioEmail: 'diagnostico@example.test'
    }
  );
  assert.equal(salida.origenTipo, 'prueba');
  const [fila] = await sql.consultar(
    'SELECT origen_tipo,productor_version,destinatario_email FROM cola_correos_salida WHERE id=?',
    [salida.salidaId]
  );
  assert.deepEqual(fila, {
    origen_tipo: 'prueba',
    productor_version: 'legacy',
    destinatario_email: 'diagnostico@example.test'
  });
  assert.equal(await contar(sql, 'ejecuciones_triggers'), antes.ejecuciones);
  assert.equal(await contar(sql, 'notificaciones_triggers_correo'), antes.notificaciones);
  assert.equal(await contar(sql, 'capacidades_desuscripcion_correo'), antes.capacidades);
}

async function verificarEstadoYGate(sql, entorno) {
  const resumen = await new RepositorioAdministracionTriggerCorreoSql(sql)
    .resumir(entorno.triggerId);
  assert.equal(resumen.relacionesEntregables, 2);
  assert.equal(resumen.backlogAceptado, 0,
    'Las pruebas no pertenecen al backlog operacional del trigger.');
  const trigger = (await entorno.repositorioTriggers.buscarPorId(entorno.triggerId))
    .serializarResumen();
  const experiencia = await entorno.portal.construirExperienciaCorreo(
    contextoPortal(),
    trigger,
    formulario({ activo: '1', revisionDeclaracion: entorno.revision })
  );
  assert.equal(experiencia.estado.operativo, true);
  assert.equal(experiencia.resumen.relacionesDormidas, 0);
  const html = ejs.render(await leer(
    '../apps/sentinelia-web/src/views/portal/triggers/parciales/trigger-form-correo.ejs'
  ), {
    formulario: formulario({ activo: '1' }),
    experienciaCorreo: experiencia,
    triggerObjetivo: trigger,
    modo: 'editar'
  });
  assert.match(html, /Vista previa del correo/u);
  assert.match(html, /Pueden recibir avisos/u);

  entorno.configuracionPortal.estado.tipo_correo_habilitado = 0;
  const listadoCerrado = await entorno.portal.listarTriggersAdministracion(
    contextoPortal()
  );
  assert.equal(listadoCerrado.triggers.length, 0);
  assert.equal(listadoCerrado.resumen.totalTriggers, 0);
  assert.equal(listadoCerrado.resumen.totalCorreo, 0);
  await assert.rejects(
    entorno.portal.previsualizarCorreo(
      contextoPortal(), entorno.triggerId, formulario({ activo: '1' })
    ),
    (error) => error?.codigo === 'trigger_correo_no_habilitado' &&
      error?.statusCode === 404
  );
  entorno.configuracionPortal.estado.tipo_correo_habilitado = 1;
}

async function verificarSuperficie() {
  const [rutas, formularioVista, parcial, controlador] = await Promise.all([
    leer('../apps/sentinelia-web/src/rutas/crearRutasPortal.js'),
    leer('../apps/sentinelia-web/src/views/portal/trigger-formulario.ejs'),
    leer('../apps/sentinelia-web/src/views/portal/triggers/parciales/trigger-form-correo.ejs'),
    leer('../apps/sentinelia-web/src/controladores/ControladorTriggers.js')
  ]);
  assert.match(rutas, /:id\/correo\/audiencia/u);
  assert.match(rutas, /:id\/correo\/probar/u);
  assert.match(rutas, /correo\/ejecuciones\/:ejecucionId/u);
  assert.match(formularioVista, /experienciaCorreo/u);
  assert.match(parcial, /Usuario fuera de alcance/u);
  assert.match(parcial, /Enviar correo de prueba/u);
  assert.match(parcial, /Actividad de correo reciente/u);
  assert.match(parcial, /experienciaCorreo\.historico\.elementos/u);
  assert.match(parcial, /Ver detalle autorizado/u);
  assert.match(controlador, /status\(409\)/u);
}

function crearConfiguracionPortal() {
  const estado = { tipo_correo_habilitado: 1, cola_sql_autoritativa: 0 };
  const actual = {
    obtenerOrigenPublicoPortal: () => 'https://sentinelia.example.test/',
    obtenerNombreVisiblePortal: () => 'Sentinelia prueba',
    obtenerConfiguracionCorreo: () => ({ destinatariosTriggerMaximos: 100 })
  };
  return {
    estado,
    async asegurarActualizada() {},
    obtenerEstadoDespliegueCorreoActual: () => ({ ...estado }),
    obtenerConfiguracionActual: () => actual
  };
}

function formulario(sobrescribir = {}) {
  return {
    nombre: 'Correo 9b',
    tipo: 'correo',
    descripcion: 'Prueba administrativa',
    activo: '0',
    nivelPertenencia: 'portal',
    tenantId: '',
    empresaId: '',
    sitioId: '',
    versionCorreo: '1',
    asuntoPlantilla: '[Sentinelia] {{estado}} · {{monitor}}',
    textoIntroduccion: 'Contexto',
    textoCierre: 'Fin',
    audienciaManuales: '',
    ...sobrescribir
  };
}

function contextoPortal() {
  return {
    idUsuario: '1',
    idUsuarioReal: '1',
    esOperadorSistema: true,
    nivelScope: 'portal',
    tenantId: null,
    empresaId: null,
    sitioId: null,
    permisos: { verTriggers: true, editarTriggers: true }
  };
}

async function contar(sql, tabla) {
  const [fila] = await sql.consultar(`SELECT COUNT(*) AS total FROM ${tabla}`);
  return Number(fila.total);
}

function leer(ruta) {
  return readFile(new URL(ruta, import.meta.url), 'utf8');
}

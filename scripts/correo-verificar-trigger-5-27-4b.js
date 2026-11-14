import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { readFile } from 'node:fs/promises';

import { ServicioAdministracionAudienciaTriggerCorreo }
  from '../apps/sentinelia-web/src/servicios/ServicioAdministracionAudienciaTriggerCorreo.js';
import { ServicioAutorizacion }
  from '../paquetes/autorizacion/src/ServicioAutorizacion.js';
import { prepararIntencionAuditoriaV1 }
  from '../paquetes/auditoria/src/HuellaIntencionAuditoria.js';
import { validarEventoAuditableV1 }
  from '../paquetes/auditoria/src/ValidadorContratoAuditoria.js';
import { RepositorioAudienciaTriggerCorreoSql }
  from '../paquetes/correo/src/RepositorioAudienciaTriggerCorreoSql.js';
import { ServicioAudienciaTriggerCorreo }
  from '../paquetes/correo/src/ServicioAudienciaTriggerCorreo.js';
import { FronteraTransaccionalLocal }
  from '../paquetes/persistencia-sql/src/FronteraTransaccionalLocal.js';
import { ClienteSql } from '../paquetes/persistencia-sql/src/ClienteSql.js';
import { EjecutorMigraciones } from '../paquetes/persistencia-sql/src/EjecutorMigraciones.js';
import { RepositorioMigraciones }
  from '../paquetes/persistencia-sql/src/RepositorioMigraciones.js';
import { RepositorioTriggers } from '../paquetes/triggers/src/RepositorioTriggers.js';
import { RepositorioUsuarios } from '../paquetes/usuarios/src/RepositorioUsuarios.js';
import {
  obtenerConfiguracionAplicacion,
  obtenerRutaMigraciones
} from '../paquetes/utilidades/src/configuracion/obtenerConfiguracionAplicacion.js';

async function main() {
  const configuracion = obtenerConfiguracionAplicacion();
  assert.equal(configuracion.sql.estaCompleta, true, '5.27.4b necesita MariaDB real.');
  const administrador = new ClienteSql(configuracion.sql);
  const nombre = `sentinelia_fixture_5274b_${randomBytes(5).toString('hex')}`;
  let sql;
  try {
    await administrador.ejecutar(
      `CREATE DATABASE ${administrador.escaparIdentificador(nombre)} ` +
        'CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci'
    );
    sql = new ClienteSql({ ...configuracion.sql, baseDatos: nombre });
    const migracion = await new EjecutorMigraciones({
      clienteSql: sql,
      repositorioMigraciones: new RepositorioMigraciones(sql),
      rutaMigraciones: obtenerRutaMigraciones()
    }).ejecutarPendientes();
    assert.equal(migracion.integridad.ok, true);
    const ids = await crearFixtures(sql);
    const auditoria = new AuditoriaVerificadora();
    const entorno = crearEntorno(sql, auditoria);

    await verificarPermisosScopeYRedaccion(entorno, ids);
    await verificarMutacionesAuditables(entorno, ids, auditoria);
    await verificarRollbackAuditoria(sql, ids);
    await verificarApiPrivadaYWiring(entorno);

    console.log(
      '[correo-trigger] OK 5.27.4b: permisos=ver_editar scope=doble ' +
        'opacas=redactadas mutacion=lock_reautoriza auditoria=allowlist_atomica ' +
        'canal_bloqueado=editable api=privada_sin_superficie_navegable'
    );
  } finally {
    await sql?.cerrar().catch(() => {});
    await administrador.ejecutar(
      `DROP DATABASE IF EXISTS ${administrador.escaparIdentificador(nombre)}`
    ).catch(() => {});
    await administrador.cerrar();
  }
}

function crearEntorno(sql, auditoria) {
  const repositorioAudiencia = new RepositorioAudienciaTriggerCorreoSql();
  const frontera = new FronteraTransaccionalLocal(sql);
  const servicioAudiencia = new ServicioAudienciaTriggerCorreo({
    repositorioAudiencia,
    fronteraTransaccional: frontera
  });
  const servicio = new ServicioAdministracionAudienciaTriggerCorreo({
    servicioAudiencia,
    repositorioAudiencia,
    repositorioTriggers: new RepositorioTriggers(sql),
    repositorioUsuarios: new RepositorioUsuarios(sql),
    fronteraTransaccional: frontera,
    servicioAutorizacion: new ServicioAutorizacion(),
    servicioAuditoria: auditoria,
    ahora: () => new Date('2026-09-03T15:00:00.000Z')
  });
  return { servicio, api: servicio.crearApiPrivadaVerificador() };
}

async function verificarPermisosScopeYRedaccion({ api }, ids) {
  await assert.rejects(
    api.leer(contextoTenant(ids.tenantUnoId, { editarTriggers: false }), ids.triggerId),
    (error) => error?.codigo === 'audiencia_trigger_correo_no_autorizada' &&
      error?.statusCode === 403
  );
  await assert.rejects(
    api.leer(contextoTenant(ids.tenantDosId), ids.triggerId),
    (error) => error?.codigo === 'trigger_no_disponible' && error?.statusCode === 404
  );
  await assert.rejects(
    api.mutar(contextoTenant(ids.tenantDosId), {
      triggerId: ids.triggerId,
      revisionDeclaracion: 999,
      altasManuales: [{ email: 'sin-filtracion@example.test' }]
    }),
    (error) => error?.codigo === 'trigger_no_disponible' && error?.statusCode === 404,
    'El conflicto de revisión no puede revelar un trigger fuera de scope.'
  );

  const lectura = await api.leer(contextoTenant(ids.tenantUnoId), ids.triggerId);
  assert.equal(lectura.total, 3);
  assert.equal(lectura.restringidas, 1);
  const opaca = lectura.relaciones.find((relacion) => relacion.restringida);
  assert.deepEqual(Object.keys(opaca).sort(), [
    'estadoParticipacion', 'restringida', 'tipo'
  ]);
  assert.equal(JSON.stringify(opaca).includes(String(ids.usuarioOcultoId)), false);
  const manual = lectura.relaciones.find((relacion) => relacion.tipo === 'manual');
  assert.equal(manual.email, 'manual@example.test');
  const visible = lectura.relaciones.find((relacion) => relacion.usuario);
  assert.equal(visible.usuario.id, String(ids.usuarioVisibleId));

  const selector = await api.buscarUsuariosElegibles(
    contextoTenant(ids.tenantUnoId),
    { triggerId: ids.triggerId, texto: 'visible' }
  );
  assert.deepEqual(
    selector.resultados.map((usuario) => usuario.id).sort(),
    [
      ids.usuarioVisibleId,
      ids.usuarioNoValidadoVisibleId,
      ids.usuarioInvalidoVisibleId
    ].map(String).sort()
  );
  assert.equal(selector.resultados.some((usuario) =>
    usuario.id === String(ids.usuarioOcultoId)), false);
  assert.equal('permisos' in selector.resultados[0], false);

  const selectorDormido = await api.buscarUsuariosElegibles(
    contextoTenant(ids.tenantUnoId),
    { triggerId: ids.triggerId, texto: 'no-validado' }
  );
  assert.deepEqual(selectorDormido.resultados.map((usuario) => usuario.id), [
    String(ids.usuarioNoValidadoVisibleId)
  ]);
  assert.equal(selectorDormido.resultados[0].entregableAhora, false);
  assert.equal(selectorDormido.resultados[0].diagnosticoEntrega, 'email_no_validado');

  const selectorPortal = await api.buscarUsuariosElegibles(
    contextoPortal(),
    { triggerId: ids.triggerId }
  );
  assert.equal(
    selectorPortal.resultados.some((usuario) =>
      usuario.id === String(ids.usuarioOcultoId)),
    true,
    'El scope portal debe alcanzar usuarios pertenecientes a tenants.'
  );
}

async function verificarMutacionesAuditables({ api }, ids, auditoria) {
  await assert.rejects(
    api.mutar(contextoTenant(ids.tenantUnoId), {
      triggerId: ids.triggerId,
      revisionDeclaracion: 4,
      retiradasIds: [ids.relacionOcultaId]
    }),
    (error) => error?.codigo === 'relacion_audiencia_correo_restringida' &&
      error?.statusCode === 403
  );
  assert.equal(await revisionTrigger(ids.sql, ids.triggerId), 4,
    'La reautorización fallida bajo lock debe revertir sin avanzar revisión.');

  const alta = await api.mutar(contextoTenant(ids.tenantUnoId), {
    triggerId: ids.triggerId,
    revisionDeclaracion: 4,
    altasManuales: [{ email: 'durante-bloqueo@example.test' }]
  });
  assert.equal(alta.revisionDeclaracion, 5,
    'La edición de audiencia no depende del estado del canal SMTP.');
  const eventoAlta = auditoria.eventos.at(-1);
  assert.equal(eventoAlta.tipo, 'trigger.audiencia_destinatario_agregado');
  assert.deepEqual(eventoAlta.sujeto, {
    tipo: 'destinatario_trigger_correo',
    id: alta.relacionesCreadas[0].id
  });
  assert.equal(eventoAlta.payload.despues.buzonManual,
    'durante-bloqueo@example.test');
  assert.equal(JSON.stringify(eventoAlta.payload).includes('usuarioVisible'), false);

  const triggerUltimoId = await insertarTrigger(
    ids.sql,
    ids.tenantUnoId,
    'Auditoría última relación 5274b',
    true
  );
  const creada = await api.mutar(contextoTenant(ids.tenantUnoId), {
    triggerId: triggerUltimoId,
    revisionDeclaracion: 1,
    altasManuales: [{ email: 'ultima-audit@example.test' }]
  });
  auditoria.eventos.length = 0;
  const retirada = await api.mutar(contextoTenant(ids.tenantUnoId), {
    triggerId: triggerUltimoId,
    revisionDeclaracion: 2,
    retiradasIds: [creada.relacionesCreadas[0].id]
  });
  assert.equal(retirada.desactivadoAutomaticamente, true);
  assert.deepEqual(auditoria.eventos.map((evento) => evento.tipo), [
    'trigger.audiencia_destinatario_retirado',
    'trigger.audiencia_vacia_desactivado'
  ]);
  assert.equal(auditoria.eventos[0].sujeto.tipo,
    'destinatario_trigger_correo');
  assert.equal(auditoria.eventos[1].sujeto.tipo, 'trigger');
  assert.deepEqual(auditoria.eventos[1].payload.camposCambiados, ['activo']);
}

async function verificarRollbackAuditoria(sql, ids) {
  const triggerId = await insertarTrigger(
    sql,
    ids.tenantUnoId,
    'Rollback auditoría audiencia 5274b',
    false
  );
  const entorno = crearEntorno(sql, {
    async registrarEnTransaccion() {
      throw new Error('auditoria-no-disponible-fixture');
    }
  });
  await assert.rejects(
    entorno.api.mutar(contextoTenant(ids.tenantUnoId), {
      triggerId,
      revisionDeclaracion: 1,
      altasManuales: [{ email: 'rollback@example.test' }]
    }),
    /auditoria-no-disponible-fixture/u
  );
  const [conteo] = await sql.consultar(`
    SELECT COUNT(*) AS total
      FROM destinatarios_triggers_correo
     WHERE trigger_id = ?
  `, [triggerId]);
  assert.equal(Number(conteo.total), 0);
  assert.equal(await revisionTrigger(sql, triggerId), 1);
}

async function verificarApiPrivadaYWiring({ api }) {
  assert.equal(Object.isFrozen(api), true);
  assert.deepEqual(Object.keys(api).sort(), [
    'buscarUsuariosElegibles', 'leer', 'mutar'
  ]);
  const [indice, portal, rutas] = await Promise.all([
    leer('../apps/sentinelia-web/src/index.js'),
    leer('../apps/sentinelia-web/src/servicios/ServicioAdministracionTriggersPortal.js'),
    leer('../apps/sentinelia-web/src/rutas/crearRutasPortal.js')
  ]);
  assert.match(indice, /ServicioAdministracionAudienciaTriggerCorreo/u);
  assert.match(portal, /apiPrivadaAudienciaTriggerCorreo/u);
  assert.doesNotMatch(rutas, /triggers\/api\/audiencia/u,
    '5.27.4b no debe anticipar la superficie HTTP navegable.');
}

async function crearFixtures(sql) {
  const tenantUnoId = await insertarId(sql,
    "INSERT INTO tenants (nombre, alias) VALUES ('Tenant uno 5274b', 'tenant-uno-5274b')"
  );
  const tenantDosId = await insertarId(sql,
    "INSERT INTO tenants (nombre, alias) VALUES ('Tenant dos 5274b', 'tenant-dos-5274b')"
  );
  const usuarioVisibleId = await insertarUsuario(sql, {
    usuario: 'visible-5274b',
    email: 'visible@example.test',
    tenantId: tenantUnoId
  });
  const usuarioOcultoId = await insertarUsuario(sql, {
    usuario: 'oculto-5274b',
    email: 'oculto@example.test',
    tenantId: tenantDosId
  });
  const usuarioNoValidadoVisibleId = await insertarUsuario(sql, {
    usuario: 'no-validado-visible-5274b',
    email: 'no-validado-visible@example.test',
    tenantId: tenantUnoId,
    validado: 0
  });
  const usuarioInvalidoVisibleId = await insertarUsuario(sql, {
    usuario: 'invalido-visible-5274b',
    email: 'email-invalido',
    tenantId: tenantUnoId
  });
  const triggerId = await insertarTrigger(
    sql,
    tenantUnoId,
    'Trigger redacción 5274b',
    false
  );
  const entornoPortal = crearEntorno(sql, new AuditoriaVerificadora());
  const manual = await entornoPortal.api.mutar(contextoPortal(), {
    triggerId,
    revisionDeclaracion: 1,
    altasManuales: [{ email: 'manual@example.test' }]
  });
  const visible = await entornoPortal.api.mutar(contextoPortal(), {
    triggerId,
    revisionDeclaracion: 2,
    altasUsuarios: [usuarioVisibleId]
  });
  const oculta = await entornoPortal.api.mutar(contextoPortal(), {
    triggerId,
    revisionDeclaracion: 3,
    altasUsuarios: [usuarioOcultoId]
  });
  return {
    sql,
    tenantUnoId,
    tenantDosId,
    triggerId,
    usuarioVisibleId,
    usuarioOcultoId,
    usuarioNoValidadoVisibleId,
    usuarioInvalidoVisibleId,
    relacionManualId: manual.relacionesCreadas[0].id,
    relacionVisibleId: visible.relacionesCreadas[0].id,
    relacionOcultaId: oculta.relacionesCreadas[0].id
  };
}

class AuditoriaVerificadora {
  constructor() {
    this.eventos = [];
  }

  async registrarEnTransaccion({ intencion }, { conexion } = {}) {
    assert.ok(conexion);
    validarEventoAuditableV1(intencion);
    prepararIntencionAuditoriaV1(intencion);
    this.eventos.push(intencion);
    return { evento: intencion, estado: 'incorporado' };
  }
}

function contextoPortal(permisos = {}) {
  return contexto({ nivelScope: 'portal', ...permisos });
}

function contextoTenant(tenantId, permisos = {}) {
  return contexto({ nivelScope: 'tenant', tenantId, ...permisos });
}

function contexto({
  nivelScope,
  tenantId = null,
  verTriggers = true,
  editarTriggers = true
}) {
  return {
    idUsuario: 7,
    idUsuarioReal: 7,
    nivelScope,
    tenantId,
    empresaId: null,
    sitioId: null,
    permisos: { verTriggers, editarTriggers }
  };
}

async function insertarTrigger(sql, tenantId, nombre, activo) {
  return insertarId(sql, `
    INSERT INTO triggers (
      tenant_id, nombre, tipo, descripcion, activo, configuracion
    ) VALUES (?, ?, 'correo', 'fixture 5.27.4b', ?, JSON_OBJECT(
      'version', 1,
      'asuntoPlantilla', 'Aviso {{monitor}}',
      'textoIntroduccion', NULL,
      'textoCierre', NULL
    ))
  `, [tenantId, nombre, activo ? 1 : 0]);
}

async function insertarUsuario(sql, { usuario, email, tenantId, validado = 1 }) {
  return insertarId(sql, `
    INSERT INTO usuarios (
      usuario, email, email_validado, hash_password, activo, tenant_id
    ) VALUES (?, ?, ?, 'fixture', 1, ?)
  `, [usuario, email, validado, tenantId]);
}

async function insertarId(sql, sentencia, parametros = []) {
  const [resultado] = await sql.ejecutar(sentencia, parametros);
  return Number(resultado.insertId);
}

async function revisionTrigger(sql, triggerId) {
  const [fila] = await sql.consultar(
    'SELECT revision_declaracion FROM triggers WHERE id = ?',
    [triggerId]
  );
  return Number(fila.revision_declaracion);
}

function leer(ruta) {
  return readFile(new URL(ruta, import.meta.url), 'utf8');
}

await main();

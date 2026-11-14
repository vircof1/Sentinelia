import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import ejs from 'ejs';
import { ClienteSql } from '../paquetes/persistencia-sql/src/ClienteSql.js';
import { FronteraTransaccionalLocal } from '../paquetes/persistencia-sql/src/FronteraTransaccionalLocal.js';
import { EjecutorMigraciones } from '../paquetes/persistencia-sql/src/EjecutorMigraciones.js';
import { RepositorioMigraciones } from '../paquetes/persistencia-sql/src/RepositorioMigraciones.js';
import { obtenerConfiguracionAplicacion, obtenerRutaMigraciones } from '../paquetes/utilidades/src/configuracion/obtenerConfiguracionAplicacion.js';
import { RepositorioZonasDns } from '../paquetes/dns/src/RepositorioZonasDns.js';
import { RepositorioRegistrosDns } from '../paquetes/dns/src/RepositorioRegistrosDns.js';
import { RepositorioConcesionesDdnsAgentes } from '../paquetes/dns/src/RepositorioConcesionesDdnsAgentes.js';
import { RepositorioCoordinacionGeneracionesDns } from '../paquetes/dns/src/RepositorioCoordinacionGeneracionesDns.js';
import { ServicioAplicacionDdnsAgentes } from '../paquetes/dns/src/ServicioAplicacionDdnsAgentes.js';
import { PERFILES_DDNS_AGENTES, VERSION_CONTRATO_DDNS_AGENTES } from '../paquetes/dns/src/ContratoDdnsAgentes.js';
import { RepositorioUsuarios } from '../paquetes/usuarios/src/RepositorioUsuarios.js';
import { RepositorioAuditoria } from '../paquetes/auditoria/src/RepositorioAuditoria.js';
import { ServicioAuditoriaOperativa } from '../paquetes/auditoria/src/ServicioAuditoriaOperativa.js';
import { RepositorioOutboxAuditoriaRuntime } from '../paquetes/auditoria/src/RepositorioOutboxAuditoriaRuntime.js';
import { generarUuidV7Auditoria } from '../paquetes/auditoria/src/UuidV7Auditoria.js';
import { ServicioAdministracionDnsPortal } from '../apps/sentinelia-web/src/servicios/ServicioAdministracionDnsPortal.js';
import { ControladorDns } from '../apps/sentinelia-web/src/controladores/ControladorDns.js';
import { ServicioTriggers } from '../paquetes/triggers/src/ServicioTriggers.js';
import { RepositorioTriggers } from '../paquetes/triggers/src/RepositorioTriggers.js';
import { RepositorioAsignacionesTriggerMonitor } from '../paquetes/triggers/src/RepositorioAsignacionesTriggerMonitor.js';
import { RepositorioEjecucionesTrigger } from '../paquetes/triggers/src/RepositorioEjecucionesTrigger.js';
import { ValidadorTrigger } from '../paquetes/triggers/src/ValidadorTrigger.js';
import { ResolutorEjecutorTrigger } from '../paquetes/triggers/src/ResolutorEjecutorTrigger.js';
import { EjecutorTriggerDns } from '../paquetes/triggers/src/EjecutorTriggerDns.js';

const config = obtenerConfiguracionAplicacion();
assert.equal(config.sql.estaCompleta, true);
const base = `sentinelia_fixture_baja_registro_${randomBytes(5).toString('hex')}`;
const admin = new ClienteSql(config.sql);
const sql = new ClienteSql({ ...config.sql, baseDatos: base });
let creada = false;
try {
  await sql.crearBaseDatosSiNoExiste();
  creada = true;
  await new EjecutorMigraciones({
    clienteSql: sql,
    repositorioMigraciones: new RepositorioMigraciones(sql),
    rutaMigraciones: obtenerRutaMigraciones()
  }).ejecutarPendientes();
  await verificar();
} finally {
  await sql.cerrar();
  assert.match(base, /^sentinelia_fixture_baja_registro_[a-f0-9]{10}$/);
  if (creada) await admin.ejecutar(`DROP DATABASE ${admin.escaparIdentificador(base)}`);
  await admin.cerrar();
  console.log('Fixture aislada eliminada; catálogo productivo intacto.');
}

async function verificar() {
  const insertar = async (consulta, valores = []) => (await sql.ejecutar(consulta, valores))[0].insertId;
  const tenant = await insertar("INSERT INTO tenants(nombre,alias) VALUES ('Baja registro','baja-registro')");
  const empresa = await insertar("INSERT INTO empresas(tenant_id,nombre,alias) VALUES (?,'Baja registro','baja-registro')", [tenant]);
  const sitio = await insertar("INSERT INTO sitios(tenant_id,empresa_id,nombre,alias) VALUES (?,?,'Baja registro','baja-registro')", [tenant, empresa]);
  const usuario = await insertar("INSERT INTO usuarios(usuario,email,hash_password,permiso_administrar_dns_avanzado) VALUES ('baja-registro','fixture@example.test','fixture',1)");
  const agente = await insertar("INSERT INTO agentes_sentinelia(guid,tenant_id,empresa_id,sitio_id,nombre,secreto_hash) VALUES (?,?,?,?,'Baja registro','fixture')", [generarUuidV7Auditoria(), tenant, empresa, sitio]);
  const zona = await insertar("INSERT INTO zonas_dns(tenant_id,empresa_id,sitio_id,nombre_zona,soa_mname,soa_rname) VALUES (?,?,?,'registro.example.','ns.example.','hostmaster.example.')", [tenant, empresa, sitio]);
  const otraZona = await insertar("INSERT INTO zonas_dns(nombre_zona,soa_mname,soa_rname) VALUES ('otra.example.','ns.example.','hostmaster.example.')");
  const crearRegistro = (zonaId, host, categoria) => insertar(
    "INSERT INTO registros_dns(zona_id,host_relativo,tipo_registro,valor_principal,categoria_origen) VALUES (?,?,'A','192.0.2.10',?)",
    [zonaId, host, categoria]
  );
  const objetivo = await crearRegistro(zona, 'objetivo', 'trigger');
  const conservado = await crearRegistro(zona, 'conservado', 'trigger');
  const dinamico = await crearRegistro(zona, 'dinamico', 'ddns');
  const ajeno = await crearRegistro(otraZona, 'ajeno', 'trigger');
  // La fotografía DDNS requiere el alcance real del sitio del agente.
  await sql.ejecutar('UPDATE registros_dns SET tenant_id=?,empresa_id=?,sitio_id=? WHERE zona_id=?', [tenant, empresa, sitio, zona]);
  const configuracionObjetivo = { zonaId: zona, registroId: objetivo, operacion: 'activar', legado: 'conservar' };
  const crearAccion = (nombre, registroId, zonaId = zona, activo = 1, tipo = 'dns') => insertar(
    'INSERT INTO triggers(nombre,tipo,activo,configuracion) VALUES (?,?,?,?)',
    [nombre, tipo, activo, JSON.stringify({ ...configuracionObjetivo, registroId, zonaId })]
  );
  const activa = await crearAccion('DNS objetivo', objetivo);
  const inactiva = await crearAccion('DNS inactiva', objetivo, zona, 0);
  const incoherente = await crearAccion('DNS zona incoherente', String(objetivo), String(otraZona));
  const reasignada = await crearAccion('DNS otro registro de la misma zona', conservado);
  const externa = await crearAccion('DNS otra zona', ajeno, otraZona);
  const api = await crearAccion('API conservada', objetivo, zona, 1, 'api');
  const ddnsObsoleta = await crearAccion('DNS con destino DDNS obsoleto', dinamico);
  const monitor = await insertar("INSERT INTO monitores(tenant_id,empresa_id,sitio_id,nombre,tipo,configuracion) VALUES (?,?,?,'Monitor baja registro','ping','{}')", [tenant, empresa, sitio]);
  for (const id of [activa, reasignada]) {
    await insertar("INSERT INTO asignaciones_triggers_monitores(monitor_id,trigger_id,eventos_disparo) VALUES (?,?,'[\"apertura_alerta\"]')", [monitor, id]);
  }
  const contexto = {
    idUsuario: usuario, idUsuarioReal: usuario, nivelScope: 'portal', esOperadorSistema: true,
    permisos: { administrarDnsAvanzado: true, editarDns: true, publicarDns: true, verDns: true }
  };
  const zonas = new RepositorioZonasDns(sql);
  const registros = new RepositorioRegistrosDns(sql);
  const acciones = new RepositorioTriggers(sql);
  const ejecuciones = new RepositorioEjecucionesTrigger(sql);
  const fronteraTransaccional = new FronteraTransaccionalLocal(sql);
  const auditoria = new ServicioAuditoriaOperativa({ repositorioAuditoria: new RepositorioAuditoria(sql) });
  const concesiones = new RepositorioConcesionesDdnsAgentes(sql);
  const coordinacion = new RepositorioCoordinacionGeneracionesDns({
    clienteSql: sql,
    bloquearCatalogoEnTransaccion: async ({ conexion }) => {
      await conexion.execute('SELECT id FROM zonas_dns ORDER BY id FOR UPDATE');
      await conexion.execute('SELECT id FROM registros_dns ORDER BY zona_id,id FOR UPDATE');
    }
  });
  const ddns = new ServicioAplicacionDdnsAgentes({
    clienteSql: sql, repositorioUsuarios: new RepositorioUsuarios(sql),
    repositorioConcesiones: concesiones, repositorioCoordinacionGeneracionesDns: coordinacion,
    servicioAuditoria: auditoria, repositorioOutboxAuditoria: new RepositorioOutboxAuditoriaRuntime(sql)
  });
  const concesion = await concesiones.crearConcesion({
    concesionId: generarUuidV7Auditoria(), agenteId: agente, registroDnsId: dinamico
  });
  const aceptada = await ddns.aceptarIntencionExplicita({
    contextoSesionTecnica: { sesion: { agenteId: String(agente) } },
    concesionId: concesion.concesionId,
    solicitud: {
      perfil: PERFILES_DDNS_AGENTES.SOLICITUD, versionContrato: VERSION_CONTRATO_DDNS_AGENTES,
      solicitudId: generarUuidV7Auditoria(), versionEsperada: '0',
      estadoDeseado: { perfil: PERFILES_DDNS_AGENTES.ESTADO_DESEADO,
        versionContrato: VERSION_CONTRATO_DDNS_AGENTES, tipo: 'A', modo: 'declarada',
        valor: { direccionIpv4: '192.0.2.100' } }
    }
  });
  assert.equal(aceptada.resultado, 'aceptada');
  const servicioTriggers = new ServicioTriggers({
    repositorioTriggers: acciones,
    repositorioAsignacionesTriggerMonitor: new RepositorioAsignacionesTriggerMonitor(sql),
    repositorioEjecucionesTrigger: ejecuciones, validadorTrigger: new ValidadorTrigger(),
    servicioAuditoria: auditoria, fronteraTransaccional,
    resolutorEjecutorTrigger: new ResolutorEjecutorTrigger({ ejecutores: [
      new EjecutorTriggerDns({ repositorioRegistrosDns: registros, repositorioZonasDns: zonas })
    ] })
  });
  const dns = new ServicioAdministracionDnsPortal({
    repositorioZonasDns: zonas, repositorioRegistrosDns: registros,
    servicioTriggers, servicioAplicacionDdnsAgentes: ddns,
    repositorioCoordinacionGeneracionesDns: coordinacion, servicioAuditoria: auditoria,
    fronteraTransaccional
  });
  const transicion = { monitorId: monitor, tenantId: tenant, empresaId: empresa, sitioId: sitio,
    alertaAuditoriaId: generarUuidV7Auditoria() };
  const planes = await servicioTriggers.resolverDisparosDesdeTransiciones({ aperturasAlerta: [transicion] });
  const plan = planes.disparos.find((entrada) => entrada.triggerId === activa);
  assert.ok(plan);
  const crearPendiente = (cambios = {}) => servicioTriggers.registrarEjecucionPendiente({
    planDisparo: { ...plan, ...cambios,
      transicion: { ...transicion, alertaAuditoriaId: generarUuidV7Auditoria() } }
  });
  const pendiente = await crearPendiente();
  const pendienteReasignada = await crearPendiente({ triggerId: reasignada });
  const pendienteOtroDestino = await crearPendiente({
    configuracionEfectiva: { ...configuracionObjetivo, registroId: conservado }
  });
  const enCurso = await crearPendiente();
  await servicioTriggers.marcarEjecucionEjecutando(enCurso.id);
  const terminada = await crearPendiente();
  await servicioTriggers.marcarEjecucionEjecutando(terminada.id);
  await servicioTriggers.finalizarEjecucionTrigger({
    idEjecucion: terminada.id, estadoEjecucion: 'ok', codigoResultado: 'dns_ok'
  });
  assert.equal((await ejecuciones.buscarPorId(terminada.id)).estadoEjecucion, 'ok');
  const pendienteDdns = await crearPendiente({ triggerId: ddnsObsoleta,
    configuracionEfectiva: { ...configuracionObjetivo, registroId: dinamico } });

  const fotografia = async () => {
    const tablas = ['zonas_dns', 'registros_dns', 'triggers', 'ejecuciones_triggers',
      'concesiones_ddns_agentes', 'intenciones_ddns_agentes', 'cabecera_generacion_dns',
      'eventos_auditoria', 'outbox_auditoria_runtime'];
    return Promise.all(tablas.map((tabla) => sql.consultar(`SELECT * FROM ${tabla} ORDER BY 1`)));
  };
  const antes = await fotografia();
  const impacto = await dns.obtenerImpactoEliminacionRegistro(contexto, zona, objetivo);
  assert.deepEqual(impacto, {
    id: String(objetivo), zonaId: String(zona), nombre: 'objetivo.registro.example.',
    tipo: 'A', esSistema: false, afectaPublicacion: true,
    concesionesDdns: 0, accionesDns: 2, ejecucionesPendientes: 2, ejecucionesEnCurso: 1
  });
  assert.deepEqual(await dns.obtenerImpactoEliminacionRegistro(contexto, zona, dinamico), {
    id: String(dinamico), zonaId: String(zona), nombre: 'dinamico.registro.example.',
    tipo: 'A', esSistema: false, afectaPublicacion: true,
    concesionesDdns: 1, accionesDns: 1, ejecucionesPendientes: 1, ejecucionesEnCurso: 0
  });
  const impactoOtro = await dns.obtenerImpactoEliminacionRegistro(contexto, zona, conservado);
  assert.equal(impactoOtro.accionesDns, 1);
  assert.equal(impactoOtro.ejecucionesPendientes, 1);
  for (const [ctx, zonaId, registroId, statusCode] of [
    [{ ...contexto, nivelScope: 'tenant', tenantId: tenant + 100 }, zona, objetivo, 404],
    [contexto, zona, ajeno, 404],
    [contexto, zona, 99999999, 404],
    [{ ...contexto, permisos: { editarDns: true } }, zona, objetivo, 403],
    [{ ...contexto, permisos: { editarDns: true, publicarDns: true } }, zona, objetivo, 403]
  ]) {
    await assert.rejects(() => dns.obtenerImpactoEliminacionRegistro(ctx, zonaId, registroId),
      (error) => error.statusCode === statusCode);
  }
  // La carga del modal solo consulta. El controlador conserva los estados de
  // autorización y no devuelve un impacto utilizable si el objetivo desaparece.
  const controlador = new ControladorDns({ servicioAdministracionDnsPortal: dns });
  const consultarImpacto = async (registroId) => {
    const salida = { codigo: 200, cabeceras: {}, datos: null };
    const respuesta = {
      set: (clave, valor) => { salida.cabeceras[clave] = valor; return respuesta; },
      status: (codigo) => { salida.codigo = codigo; return respuesta; },
      json: (datos) => { salida.datos = datos; }
    };
    await controlador.mostrarImpactoEliminacionRegistro({
      contextoUsuarioActual: contexto, params: { id: zona, registroId }
    }, respuesta, (error) => { throw error; });
    return salida;
  };
  const respuestaImpacto = await consultarImpacto(objetivo);
  assert.deepEqual(respuestaImpacto.datos, { ok: true, impacto });
  assert.equal(respuestaImpacto.cabeceras['Cache-Control'], 'no-store');
  const inexistente = await consultarImpacto(99999999);
  assert.equal(inexistente.codigo, 404);
  assert.equal(inexistente.datos.ok, false);
  const htmlModal = await ejs.renderFile(fileURLToPath(new URL(
    '../apps/sentinelia-web/src/views/portal/parciales/dns-registro-modal-eliminacion.ejs', import.meta.url
  )), { zona: { id: zona }, tokenCSRFPortal: 'fixture-csrf' });
  assert.match(htmlModal, /name="tokenCSRF" value="fixture-csrf"/);
  assert.match(htmlModal, new RegExp(`action="/dns/${zona}/registros/eliminar"`));
  assert.match(htmlModal, /name="id_registro"/);
  assert.match(htmlModal, /name="return_to"/);
  assert.match(htmlModal, /disabled data-dns-eliminar-confirmar/);
  assert.deepEqual(await fotografia(), antes, 'Revisar impacto no modifica datos');
  await assert.rejects(() => new ServicioAdministracionDnsPortal({
    repositorioZonasDns: zonas, repositorioRegistrosDns: registros
  }).eliminarRegistro(contexto, zona, objetivo), /sin revocar/);
  await assert.rejects(() => dns.eliminarRegistro({ ...contexto,
    nivelScope: 'tenant', tenantId: tenant + 100 }, zona, objetivo), /fuera|alcance/);
  assert.deepEqual(await fotografia(), antes);

  // Un borrado sin fila afectada debe revertir la deshabilitación y los planes.
  const eliminarReal = registros.eliminar.bind(registros);
  registros.eliminar = async () => false;
  try {
    await assert.rejects(() => dns.eliminarRegistro(contexto, zona, objetivo), /No se pudo eliminar/);
  } finally {
    registros.eliminar = eliminarReal;
  }
  assert.deepEqual(await fotografia(), antes);
  // Un fallo posterior al DELETE también revierte toda la unidad y su auditoría.
  dns.servicioAuditoria = { registrarEnTransaccion: async () => { throw new Error('fallo auditoría fixture'); } };
  await assert.rejects(() => dns.eliminarRegistro(contexto, zona, objetivo), /fallo auditoría fixture/);
  assert.deepEqual(await fotografia(), antes);
  dns.servicioAuditoria = auditoria;
  await dns.eliminarRegistro(contexto, zona, objetivo);
  assert.equal(await registros.buscarPorId(objetivo), null);
  assert.equal((await consultarImpacto(objetivo)).codigo, 404);
  assert.ok(await zonas.buscarPorId(zona));
  for (const id of [conservado, dinamico, ajeno]) assert.ok(await registros.buscarPorId(id));
  for (const id of [activa, incoherente]) {
    const accion = await acciones.buscarPorId(id);
    assert.equal(accion.activo, false);
    assert.equal(accion.revisionDeclaracion, 2);
  }
  assert.equal((await acciones.buscarPorId(inactiva)).revisionDeclaracion, 1);
  for (const id of [reasignada, externa, api, ddnsObsoleta]) assert.equal((await acciones.buscarPorId(id)).activo, true);
  const [configuracion] = await sql.consultar('SELECT configuracion FROM triggers WHERE id=?', [activa]);
  const contenido = configuracion.configuracion;
  assert.deepEqual(typeof contenido === 'string' ? JSON.parse(contenido) : contenido,
    configuracionObjetivo);
  for (const id of [pendiente.id, pendienteReasignada.id]) {
    const cancelada = await ejecuciones.buscarPorId(id);
    assert.equal(cancelada.estadoEjecucion, 'error');
    assert.equal(cancelada.codigoResultado, 'dns_objetivo_eliminado');
    assert.match(cancelada.mensajeResultado, /registro DNS objetivo/);
    assert.ok(cancelada.finalizadoEnUtc);
  }
  assert.equal((await ejecuciones.buscarPorId(pendienteOtroDestino.id)).estadoEjecucion, 'pendiente');
  assert.equal((await ejecuciones.buscarPorId(enCurso.id)).estadoEjecucion, 'ejecutando');
  assert.equal((await ejecuciones.buscarPorId(terminada.id)).estadoEjecucion, 'ok');
  assert.equal((await ejecuciones.buscarPorId(pendienteDdns.id)).estadoEjecucion, 'pendiente');
  assert.equal((await concesiones.buscarPorConcesionId(concesion.concesionId)).estado, 'vigente');
  const nuevosPlanes = await servicioTriggers.resolverDisparosDesdeTransiciones({ aperturasAlerta: [
    { ...transicion, alertaAuditoriaId: generarUuidV7Auditoria() }
  ] });
  assert.deepEqual(nuevosPlanes.disparos.map(({ triggerId }) => triggerId), [reasignada]);

  // DDNS y una acción con configuración obsoleta comparten el mismo rollback.
  const antesDdns = await fotografia();
  dns.servicioAuditoria = { registrarEnTransaccion: async () => { throw new Error('fallo auditoría DDNS'); } };
  await assert.rejects(() => dns.eliminarRegistro(contexto, zona, dinamico), /fallo auditoría DDNS/);
  assert.deepEqual(await fotografia(), antesDdns);
  dns.servicioAuditoria = auditoria;
  await dns.eliminarRegistro(contexto, zona, dinamico);
  const cerrada = await concesiones.buscarPorConcesionId(concesion.concesionId);
  assert.equal(cerrada.estado, 'revocada');
  assert.equal(cerrada.causaCierre, 'registro_eliminado');
  assert.equal(cerrada.registroDnsId, null);
  const [intencion] = await sql.consultar('SELECT terminal FROM intenciones_ddns_agentes');
  assert.equal(intencion.terminal, 'objetivo_eliminado');
  assert.equal((await acciones.buscarPorId(ddnsObsoleta)).activo, false);
  assert.equal((await ejecuciones.buscarPorId(pendienteDdns.id)).codigoResultado, 'dns_objetivo_eliminado');
  const eventos = await sql.consultar("SELECT tipo_evento FROM eventos_auditoria WHERE tipo_evento='trigger.actualizado'");
  assert.equal(eventos.length, 3, 'Solo las tres acciones afectadas generan una deshabilitación auditada');
  const [resumen] = await sql.consultar(`SELECT
    (SELECT COUNT(*) FROM triggers) acciones,
    (SELECT COUNT(*) FROM asignaciones_triggers_monitores WHERE activo=1) vinculos,
    (SELECT COUNT(*) FROM monitores) monitores,
    (SELECT COUNT(*) FROM agentes_sentinelia) agentes,
    (SELECT COUNT(*) FROM ejecuciones_triggers) ejecuciones`);
  assert.deepEqual(resumen, { acciones: 7, vinculos: 2, monitores: 1, agentes: 1, ejecuciones: 6 });
  console.log('[dns] OK: registro eliminado, acciones deshabilitadas con revisión y auditoría, ' +
    'planes cancelados por destino aceptado, rollback integral, DDNS revocado e historial conservado; ' +
    'otros registros, acciones, vínculos, monitores y agentes intactos.');
}

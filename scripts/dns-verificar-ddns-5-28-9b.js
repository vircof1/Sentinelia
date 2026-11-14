import assert from 'node:assert/strict';
import { createHash, randomBytes } from 'node:crypto';

import { RepositorioAuditoria } from '../paquetes/auditoria/src/RepositorioAuditoria.js';
import { RepositorioResolutoresAuditoriaSql }
  from '../paquetes/auditoria/src/RepositorioResolutoresAuditoriaSql.js';
import { ServicioAuditoriaOperativa }
  from '../paquetes/auditoria/src/ServicioAuditoriaOperativa.js';
import { ServicioResolutoresConsultaAuditoria }
  from '../paquetes/auditoria/src/ServicioResolutoresConsultaAuditoria.js';
import { generarUuidV7Auditoria, uuidV7AuditoriaABytes }
  from '../paquetes/auditoria/src/UuidV7Auditoria.js';
import { construirIntencionAuditoriaDdns }
  from '../paquetes/dns/src/EventosAuditoriaDdnsAgentes.js';
import { RepositorioConcesionesDdnsAgentes }
  from '../paquetes/dns/src/RepositorioConcesionesDdnsAgentes.js';
import { RepositorioRetencionDdnsAgentesSql }
  from '../paquetes/dns/src/RepositorioRetencionDdnsAgentesSql.js';
import { ServicioConsultaAdministrativaDdnsAgentes }
  from '../paquetes/dns/src/ServicioConsultaAdministrativaDdnsAgentes.js';
import { ServicioConsultaDdnsAgentes }
  from '../paquetes/dns/src/ServicioConsultaDdnsAgentes.js';
import { ServicioRetencionDdnsAgentes }
  from '../paquetes/dns/src/ServicioRetencionDdnsAgentes.js';
import { ClienteSql } from '../paquetes/persistencia-sql/src/ClienteSql.js';
import { EjecutorMigraciones } from '../paquetes/persistencia-sql/src/EjecutorMigraciones.js';
import { FronteraTransaccionalLocal }
  from '../paquetes/persistencia-sql/src/FronteraTransaccionalLocal.js';
import { RepositorioMigraciones }
  from '../paquetes/persistencia-sql/src/RepositorioMigraciones.js';
import { obtenerConfiguracionAplicacion, obtenerRutaMigraciones }
  from '../paquetes/utilidades/src/configuracion/obtenerConfiguracionAplicacion.js';

await main();

async function main() {
  const configuracion = obtenerConfiguracionAplicacion();
  assert.equal(configuracion.sql.estaCompleta, true, '5.28.9b necesita MariaDB real.');
  const administrador = new ClienteSql(configuracion.sql);
  const base = `sentinelia_fixture_5289b_${randomBytes(5).toString('hex')}`;
  let sql;
  try {
    await administrador.ejecutar(
      `CREATE DATABASE ${administrador.escaparIdentificador(base)} ` +
      'CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci'
    );
    sql = new ClienteSql({ ...configuracion.sql, baseDatos: base });
    await new EjecutorMigraciones({
      clienteSql: sql,
      repositorioMigraciones: new RepositorioMigraciones(sql),
      rutaMigraciones: obtenerRutaMigraciones()
    }).ejecutarPendientes();
    const fixture = await crearFixture(sql);
    await verificarDiagnosticosYVisibilidad(sql, fixture);
    await verificarResolutores(sql, fixture);
    await verificarRetencion(sql, fixture);
    console.log('[dns-ddns] OK 5.28.9b: diagnostico=separado vistas=autorizadas-restringidas resolutores=scope purga=terminal auditoria=superviviente secretos=ausentes');
  } finally {
    await sql?.cerrar().catch(() => {});
    await administrador.ejecutar(
      `DROP DATABASE IF EXISTS ${administrador.escaparIdentificador(base)}`
    ).catch(() => {});
    await administrador.cerrar();
  }
}

async function crearFixture(sql) {
  const [tenant] = await sql.ejecutar(
    "INSERT INTO tenants (nombre,alias) VALUES ('Tenant 9b','tenant-5289b')"
  );
  const [empresa] = await sql.ejecutar(
    "INSERT INTO empresas (tenant_id,nombre,alias) VALUES (?,'Empresa 9b','empresa-5289b')",
    [tenant.insertId]
  );
  const [sitio] = await sql.ejecutar(
    "INSERT INTO sitios (tenant_id,empresa_id,nombre,alias) VALUES (?,?,'Sitio 9b','sitio-5289b')",
    [tenant.insertId, empresa.insertId]
  );
  const [agente] = await sql.ejecutar(
    `INSERT INTO agentes_sentinelia
       (guid,tenant_id,empresa_id,sitio_id,nombre,secreto_hash)
     VALUES (?,?,?,?,?,'hash')`,
    [generarUuidV7Auditoria(), tenant.insertId, empresa.insertId,
      sitio.insertId, 'Agente 9b']
  );
  const [zona] = await sql.ejecutar(
    `INSERT INTO zonas_dns
       (tenant_id,empresa_id,sitio_id,nombre_zona,soa_mname,soa_rname)
     VALUES (?,?,?,?,?,?)`,
    [tenant.insertId, empresa.insertId, sitio.insertId,
      'retencion.5289b.example.', 'ns.example.', 'hostmaster.example.']
  );
  const registros = [];
  for (const host of ['cerrado', 'vigente']) {
    const [registro] = await sql.ejecutar(
      `INSERT INTO registros_dns
         (zona_id,tenant_id,empresa_id,sitio_id,host_relativo,tipo_registro,
          valor_principal,ttl_segundos,categoria_origen)
       VALUES (?,?,?,?,?,'A','192.0.2.90',300,'ddns')`,
      [zona.insertId, tenant.insertId, empresa.insertId, sitio.insertId, host]
    );
    registros.push(registro.insertId);
  }
  const repo = new RepositorioConcesionesDdnsAgentes(sql);
  const cerrada = await prepararConcesion(sql, repo, agente.insertId, registros[0], true);
  const vigente = await prepararConcesion(sql, repo, agente.insertId, registros[1], false);
  return Object.freeze({
    tenantId: String(tenant.insertId),
    empresaId: String(empresa.insertId),
    sitioId: String(sitio.insertId),
    agenteId: String(agente.insertId),
    registroCerradoId: String(registros[0]),
    cerrada,
    vigente
  });
}

async function prepararConcesion(sql, repo, agenteId, registroId, cerrar) {
  const concesionId = generarUuidV7Auditoria();
  const concesion = await repo.crearConcesion({ concesionId, agenteId, registroDnsId: registroId });
  const intencionId = generarUuidV7Auditoria();
  const solicitudId = generarUuidV7Auditoria();
  const estado = JSON.stringify({ modo: 'declarada', tipo: 'A',
    valor: { direccionIpv4: cerrar ? '192.0.2.91' : '192.0.2.92' } });
  const huella = createHash('sha256').update(estado).digest();
  const [intencion] = await sql.ejecutar(
    `INSERT INTO intenciones_ddns_agentes
       (intencion_id,concesion_interna_id,agente_id_fotografia,
        registro_dns_id_fotografia,origen,version_ddns,modo,
        estado_deseado_canonico,estado_deseado_sha256,causa_tipo,causa_id,
        hito,persistida_en_utc,terminal,terminada_en_utc)
     VALUES (?,?,?,?, 'agente_explicita',1,'declarada',?,?,'solicitud_agente',?,
             'contenido_deseado_persistido',UTC_TIMESTAMP(3),
             'publicacion_fallida',UTC_TIMESTAMP(3))`,
    [uuidV7AuditoriaABytes(intencionId), concesion.idInterno, agenteId, registroId,
      estado, huella, uuidV7AuditoriaABytes(solicitudId)]
  );
  await sql.ejecutar(
    `UPDATE concesiones_ddns_agentes
        SET version_ddns=1,decision='operativa',modo='declarada',
            intencion_gobernante_id=?,contenido_deseado_canonico=?,
            contenido_deseado_sha256=?,condicion_operativa='publicacion_fallida'
      WHERE id=?`,
    [intencion.insertId, estado, huella, concesion.idInterno]
  );
  await sql.ejecutar(
    `INSERT INTO solicitudes_ddns_agentes
       (solicitud_id,agente_id_fotografia,concesion_interna_id,
        cuerpo_canonico_sha256,intencion_interna_id,resultado,estado_http)
     VALUES (?,?,?,?,?,'aceptada',202)`,
    [uuidV7AuditoriaABytes(solicitudId), agenteId, concesion.idInterno,
      randomBytes(32), intencion.insertId]
  );
  await sql.ejecutar(
    `INSERT INTO intentos_publicacion_ddns
       (concesion_interna_id,intencion_interna_id,version_ddns,numero_intento,
        generacion_dns,estado,atribucion,codigo_diagnostico,mensaje_diagnostico,
        terminada_en_utc)
     VALUES (?,?,1,1,81,'rechazo_atribuible','registro',
             'bind_rechazo','ruta /etc/bind/privada: línea 7',UTC_TIMESTAMP(3))`,
    [concesion.idInterno, intencion.insertId]
  );
  if (cerrar) {
    await repo.cerrarConcesion({ concesionId, causa: 'revocada_desde_registro' });
    await sql.ejecutar(
      "UPDATE concesiones_ddns_agentes SET cerrada_en_utc='2026-01-01 00:00:00.000' WHERE id=?",
      [concesion.idInterno]
    );
  }
  return Object.freeze({ concesionId, intencionId, idInterno: concesion.idInterno });
}

async function verificarDiagnosticosYVisibilidad(sql, fixture) {
  const contexto = contextoPortal(fixture, { verAgentes: true, verDns: true });
  const servicio = new ServicioConsultaAdministrativaDdnsAgentes({ clienteSql: sql });
  const completa = await servicio.obtenerDesdeAgente({
    contextoUsuarioActual: contexto,
    concesionId: fixture.cerrada.concesionId,
    agenteId: fixture.agenteId
  });
  assert.equal(completa.registro.restringido, false);
  assert.equal(completa.operacion.ultimoIntento.codigoDiagnostico, 'bind_rechazo');
  assert.match(completa.operacion.ultimoIntento.mensajeDiagnostico, /\/etc\/bind/);
  const parcial = await servicio.obtenerDesdeAgente({
    contextoUsuarioActual: contextoPortal(fixture, { verAgentes: true, verDns: false }),
    concesionId: fixture.cerrada.concesionId,
    agenteId: fixture.agenteId
  });
  assert.deepEqual(parcial.registro, { restringido: true, tipo: 'registro_dns' });
  assert.deepEqual(parcial.operacion, { restringido: true, tipo: 'registro_dns' });
  assert.equal('id' in parcial.registro, false);
  const denegada = await servicio.obtenerDesdeRegistro({
    contextoUsuarioActual: contextoPortal(fixture, { verAgentes: true, verDns: false }),
    concesionId: fixture.cerrada.concesionId,
    registroDnsId: fixture.registroCerradoId
  });
  assert.equal(denegada, null);

  const publica = await new ServicioConsultaDdnsAgentes({
    clienteSql: sql,
    secretoCursores: Buffer.alloc(32, 0x9b)
  }).listar({ agenteId: fixture.agenteId });
  assert.equal(publica.concesiones.length, 1);
  assert.equal(publica.concesiones[0].diagnostico, 'publicacion_fallida');
  assert.doesNotMatch(JSON.stringify(publica), /\/etc\/bind|línea 7|bind_rechazo/);
}

async function verificarResolutores(sql, fixture) {
  const servicio = new ServicioResolutoresConsultaAuditoria({
    repositorioResolutores: new RepositorioResolutoresAuditoriaSql({ clienteSql: sql })
  });
  const contexto = contextoPortal(fixture, {
    verAuditoria: true, verDns: true, verAgentes: false
  });
  const concesiones = await servicio.resolverSujetos({
    contextoUsuarioActual: contexto,
    consulta: { tipo: 'concesion_ddns', texto: fixture.cerrada.concesionId }
  });
  assert.equal(concesiones.opciones[0].id, fixture.cerrada.concesionId);
  const intenciones = await servicio.resolverSujetos({
    contextoUsuarioActual: contexto,
    consulta: { tipo: 'intencion_ddns', texto: fixture.cerrada.intencionId }
  });
  assert.equal(intenciones.opciones[0].id, fixture.cerrada.intencionId);
  await assert.rejects(
    servicio.resolverSujetos({
      contextoUsuarioActual: contextoPortal(fixture, {
        verAuditoria: true, verDns: false, verAgentes: true
      }),
      consulta: { tipo: 'concesion_ddns' }
    }),
    (error) => error.statusCode === 403
  );
}

async function verificarRetencion(sql, fixture) {
  const auditoria = new ServicioAuditoriaOperativa({
    repositorioAuditoria: new RepositorioAuditoria(sql)
  });
  const intencionAuditoria = construirIntencionAuditoriaDdns({
      eventoId: generarUuidV7Auditoria(),
      tipo: 'ddns.intencion_terminada',
      actorReal: { tipo: 'runtime', id: 'sentinelia-runtime' },
      sujetoId: fixture.cerrada.intencionId,
      scope: { tenantId: fixture.tenantId, empresaId: fixture.empresaId,
        sitioId: fixture.sitioId },
      correlacionId: fixture.cerrada.intencionId,
      causalidadIntencionId: fixture.cerrada.intencionId,
      productor: 'runtime_dns',
      claveOperacion: `fixture:retencion:${fixture.cerrada.intencionId}`,
      rolEvento: 'resultado',
      payload: { resultado: 'publicacion_fallida', tipoRegistro: 'A',
        modo: 'declarada', versionDdns: '1', origenIntencion: 'agente_explicita',
        agenteId: fixture.agenteId, registroDnsId: fixture.registroCerradoId }
    });
  await new FronteraTransaccionalLocal(sql).ejecutar((conexion) =>
    auditoria.registrarEnTransaccion({
      cambioEfectivo: true,
      intencion: intencionAuditoria
    }, { conexion })
  );
  const repositorio = new RepositorioRetencionDdnsAgentesSql({ clienteSql: sql });
  const candidatosPrevios = await repositorio.listarCandidatos({
    corteUtc: '2026-08-10T12:00:00.000Z',
    limite: 10
  });
  assert.equal(candidatosPrevios.length, 1);
  const servicio = new ServicioRetencionDdnsAgentes({
    servicioConfiguracionPortal: {
      asegurarActualizada: async () => ({
        obtenerConfiguracionAuditoria: () => ({ retencionDias: 30 })
      })
    },
    repositorio,
    fronteraTransaccional: new FronteraTransaccionalLocal(sql),
    ahora: () => '2026-09-09T12:00:00.000Z'
  });
  const resultado = await servicio.ejecutar({ limite: 10 });
  assert.deepEqual(
    [resultado.purgadas, resultado.solicitudes, resultado.intenciones, resultado.intentos],
    [1, 1, 1, 1]
  );
  const [conteos] = await sql.consultar(
    `SELECT
       (SELECT COUNT(*) FROM concesiones_ddns_agentes) AS concesiones,
       (SELECT COUNT(*) FROM solicitudes_ddns_agentes) AS solicitudes,
       (SELECT COUNT(*) FROM intenciones_ddns_agentes) AS intenciones,
       (SELECT COUNT(*) FROM intentos_publicacion_ddns) AS intentos,
       (SELECT COUNT(*) FROM eventos_auditoria WHERE tipo_evento LIKE 'ddns.%') AS eventos`
  );
  assert.deepEqual(
    [Number(conteos.concesiones), Number(conteos.solicitudes),
      Number(conteos.intenciones), Number(conteos.intentos), Number(conteos.eventos)],
    [2, 1, 1, 1, 1]
  );
  const vigente = await sql.consultar(
    'SELECT intencion_gobernante_id FROM concesiones_ddns_agentes WHERE id=?',
    [fixture.vigente.idInterno]
  );
  assert.notEqual(vigente[0].intencion_gobernante_id, null);
  assert.doesNotMatch(JSON.stringify(resultado), /bearer|authorization|secreto|cabecera/i);
}

function contextoPortal(fixture, permisos) {
  return Object.freeze({
    nivelScope: 'portal',
    tenantId: fixture.tenantId,
    empresaId: fixture.empresaId,
    sitioId: fixture.sitioId,
    permisos: Object.freeze(permisos)
  });
}

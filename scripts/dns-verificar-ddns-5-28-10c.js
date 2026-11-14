import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';

import { RepositorioAuditoria } from '../paquetes/auditoria/src/RepositorioAuditoria.js';
import { ServicioAuditoriaOperativa }
  from '../paquetes/auditoria/src/ServicioAuditoriaOperativa.js';
import {
  generarUuidV7Auditoria,
  uuidV7AuditoriaABytes
} from '../paquetes/auditoria/src/UuidV7Auditoria.js';
import {
  PERFILES_DDNS_AGENTES,
  VERSION_CONTRATO_DDNS_AGENTES
} from '../paquetes/dns/src/ContratoDdnsAgentes.js';
import { ConsolidadorPublicacionDdnsSql }
  from '../paquetes/dns/src/ConsolidadorPublicacionDdnsSql.js';
import { PreparadorEliminacionDdnsAgentesEnTransaccion }
  from '../paquetes/dns/src/PreparadorEliminacionDdnsAgentesEnTransaccion.js';
import { RepositorioConcesionesDdnsAgentes }
  from '../paquetes/dns/src/RepositorioConcesionesDdnsAgentes.js';
import { RepositorioCoordinacionGeneracionesDns }
  from '../paquetes/dns/src/RepositorioCoordinacionGeneracionesDns.js';
import { ServicioAplicacionDdnsAgentes }
  from '../paquetes/dns/src/ServicioAplicacionDdnsAgentes.js';
import { ClienteSql } from '../paquetes/persistencia-sql/src/ClienteSql.js';
import { EjecutorMigraciones } from '../paquetes/persistencia-sql/src/EjecutorMigraciones.js';
import { RepositorioMigraciones }
  from '../paquetes/persistencia-sql/src/RepositorioMigraciones.js';
import { RepositorioUsuarios } from '../paquetes/usuarios/src/RepositorioUsuarios.js';
import { RepositorioEliminacionAdministrativaAgentesSql }
  from '../paquetes/agentes/src/RepositorioEliminacionAdministrativaAgentesSql.js';
import { RepositorioImpactoEliminacionOrganizacionSql }
  from '../paquetes/jerarquia-organizativa/src/RepositorioImpactoEliminacionOrganizacionSql.js';
import { obtenerConfiguracionAplicacion, obtenerRutaMigraciones }
  from '../paquetes/utilidades/src/configuracion/obtenerConfiguracionAplicacion.js';

await main();

async function main() {
  const configuracion = obtenerConfiguracionAplicacion();
  assert.equal(configuracion.sql.estaCompleta, true, '5.28.10c necesita MariaDB real.');
  const administrador = new ClienteSql(configuracion.sql);
  const base = `sentinelia_fixture_52810c_${randomBytes(5).toString('hex')}`;
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
    const componentes = crearComponentes(sql);
    await verificarBajaAgente(sql, fixture.directa, componentes);
    await verificarBajaOrganizativa(sql, fixture.organizativa, componentes);
    await verificarAuditoria(sql);
    console.log(
      '[dns-ddns] OK 5.28.10c: bajas=agente+organizacion ' +
      'aceptada=snapshot_publicable objetivo_eliminado=prevalece ' +
      'causa_pol=descartada extremos=desacoplados runtimes=2'
    );
  } finally {
    await sql?.cerrar().catch(() => {});
    await administrador.ejecutar(
      `DROP DATABASE IF EXISTS ${administrador.escaparIdentificador(base)}`
    ).catch(() => {});
    await administrador.cerrar();
  }
}

function crearComponentes(sql) {
  const servicioAuditoria = new ServicioAuditoriaOperativa({
    repositorioAuditoria: new RepositorioAuditoria(sql)
  });
  const repositorioConcesiones = new RepositorioConcesionesDdnsAgentes(sql);
  return Object.freeze({
    repositorioConcesiones,
    preparadores: Object.freeze([
      new PreparadorEliminacionDdnsAgentesEnTransaccion({
        clienteSql: sql,
        servicioAuditoria,
        repositorioConcesiones
      }),
      new PreparadorEliminacionDdnsAgentesEnTransaccion({
        clienteSql: sql,
        servicioAuditoria,
        repositorioConcesiones
      })
    ]),
    servicio: new ServicioAplicacionDdnsAgentes({
      clienteSql: sql,
      repositorioUsuarios: new RepositorioUsuarios(sql),
      repositorioConcesiones,
      repositorioCoordinacionGeneracionesDns:
        new RepositorioCoordinacionGeneracionesDns({
          clienteSql: sql,
          bloquearCatalogoEnTransaccion
        })
    })
  });
}

async function verificarBajaAgente(sql, escenario, componentes) {
  const concesion = await concederYDeclarar(componentes, escenario);
  await insertarCausaPol(sql, escenario.agenteId, 1);
  const impacto = await transaccion(sql, (conexion) =>
    new RepositorioEliminacionAdministrativaAgentesSql(sql)
      .cargarImpactoEnTransaccion(
        { agenteId: escenario.agenteId },
        { conexion }
      )
  );
  exigirConteosDdns(impacto.conteos);
  const resultado = await transaccion(sql, async (conexion) => {
    const preparacion = await componentes.preparadores[0]
      .prepararAgenteEnTransaccion({
        agenteId: escenario.agenteId,
        operacionId: generarUuidV7Auditoria(),
        actores: actores(escenario.usuarioId)
      }, { conexion });
    await conexion.execute('DELETE FROM agentes_sentinelia WHERE id=?', [escenario.agenteId]);
    return preparacion;
  });
  assert.equal(resultado.concesionesCerradas, '1');
  assert.equal(resultado.intencionesAceptadasSupervivientes, '1');
  assert.equal(resultado.causasPolDescartadas, '1');

  let estado = await fotografiar(sql, concesion.idInterno);
  assert.deepEqual(
    [estado.estado, estado.causa_cierre, estado.agente_id, estado.terminal, estado.intento],
    ['revocada', 'agente_eliminado', null, null, 'pendiente']
  );
  await transaccion(sql, (conexion) =>
    new ConsolidadorPublicacionDdnsSql().consolidarEnTransaccion({
      conexion,
      generacionDns: '501',
      diagnostico: diagnostico(concesion, escenario)
    })
  );
  estado = await fotografiar(sql, concesion.idInterno);
  assert.deepEqual(
    [estado.terminal, estado.intento, estado.generacion_dns_publicada],
    ['publicada', 'publicada', '501'],
    'la intención aceptada termina desde snapshots aunque el agente ya no exista'
  );
}

async function verificarBajaOrganizativa(sql, escenario, componentes) {
  const concesion = await concederYDeclarar(componentes, escenario);
  await componentes.repositorioConcesiones.cerrarConcesion({
    concesionId: concesion.concesionId,
    causa: 'revocada_desde_agente'
  });
  await insertarCausaPol(sql, escenario.agenteId, 2);
  exigirConteosDdns(await new RepositorioImpactoEliminacionOrganizacionSql(sql)
    .cargarConteos({
      sujeto: { tipo: 'sitio', id: escenario.sitioId },
      actorEfectivoId: escenario.usuarioId
    }));
  const resultado = await transaccion(sql, async (conexion) => {
    const preparacion = await componentes.preparadores[1]
      .prepararOrganizacionEnTransaccion({
        raiz: { tipo: 'sitio', id: escenario.sitioId },
        agenteIds: [escenario.agenteId],
        operacionId: generarUuidV7Auditoria(),
        actores: actores(escenario.usuarioId)
      }, { conexion });
    await conexion.execute('DELETE FROM registros_dns WHERE id=?', [escenario.registroId]);
    await conexion.execute('DELETE FROM zonas_dns WHERE id=?', [escenario.zonaId]);
    await conexion.execute('DELETE FROM agentes_sentinelia WHERE id=?', [escenario.agenteId]);
    await conexion.execute('DELETE FROM sitios WHERE id=?', [escenario.sitioId]);
    return preparacion;
  });
  assert.equal(resultado.concesionesCerradas, '0');
  assert.equal(resultado.intencionesObjetivoEliminado, '1');
  assert.equal(resultado.causasPolDescartadas, '1');
  assert.deepEqual(resultado.registrosObjetivoIds, [String(escenario.registroId)]);

  const estado = await fotografiar(sql, concesion.idInterno);
  assert.deepEqual(
    [estado.estado, estado.agente_id, estado.registro_dns_id,
      estado.terminal, estado.intento],
    ['revocada', null, null, 'objetivo_eliminado', 'objetivo_eliminado'],
    'la desaparición del objetivo prevalece aun sobre una revocación anterior'
  );
}

async function concederYDeclarar(componentes, escenario) {
  const concesion = await componentes.repositorioConcesiones.crearConcesion({
    concesionId: generarUuidV7Auditoria(),
    agenteId: escenario.agenteId,
    registroDnsId: escenario.registroId
  });
  const resultado = await componentes.servicio.aceptarIntencionExplicita({
    contextoSesionTecnica: { sesion: { agenteId: String(escenario.agenteId) } },
    concesionId: concesion.concesionId,
    solicitud: {
      perfil: PERFILES_DDNS_AGENTES.SOLICITUD,
      versionContrato: VERSION_CONTRATO_DDNS_AGENTES,
      solicitudId: generarUuidV7Auditoria(),
      versionEsperada: '0',
      estadoDeseado: {
        perfil: PERFILES_DDNS_AGENTES.ESTADO_DESEADO,
        versionContrato: VERSION_CONTRATO_DDNS_AGENTES,
        tipo: 'A',
        modo: 'declarada',
        valor: { direccionIpv4: escenario.valorDeseado }
      }
    }
  });
  assert.equal(resultado.resultado, 'aceptada');
  return componentes.repositorioConcesiones.buscarPorConcesionId(concesion.concesionId);
}

async function insertarCausaPol(sql, agenteId, secuencia) {
  await sql.ejecutar(
    `INSERT INTO causas_pol_ddns (
       causa_id,agente_id_fotografia,periodo_vida_pol_id,secuencia,
       aceptada_en_utc,estado,disponible_en_utc,actualizada_en_utc
     ) VALUES (?,?,?, ?,UTC_TIMESTAMP(3),'pendiente',UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))`,
    [uuidV7AuditoriaABytes(generarUuidV7Auditoria()), agenteId, secuencia, secuencia]
  );
}

async function fotografiar(sql, concesionId) {
  const [fila] = await sql.consultar(
    `SELECT c.estado,c.causa_cierre,c.agente_id,c.registro_dns_id,
            CAST(c.generacion_dns_publicada AS CHAR) generacion_dns_publicada,
            i.terminal,p.estado intento
       FROM concesiones_ddns_agentes c
       JOIN intenciones_ddns_agentes i ON i.id=c.intencion_gobernante_id
       JOIN intentos_publicacion_ddns p ON p.intencion_interna_id=i.id
      WHERE c.id=?`,
    [concesionId]
  );
  return fila;
}

async function verificarAuditoria(sql) {
  const eventos = await sql.consultar(
    `SELECT tipo_evento,productor FROM eventos_auditoria
      WHERE tipo_evento IN ('ddns.concesion_revocada','ddns.intencion_terminada')
      ORDER BY secuencia`
  );
  assert.deepEqual(
    eventos.map(({ tipo_evento }) => tipo_evento),
    ['ddns.concesion_revocada', 'ddns.intencion_terminada']
  );
  assert.deepEqual(
    eventos.map(({ productor }) => productor),
    ['runtime_operaciones_administrativas', 'runtime_dns']
  );
}

function exigirConteosDdns(conteos) {
  const indice = new Map(conteos.map(({ categoria, cantidad }) => [categoria, cantidad]));
  assert.equal(indice.get('concesiones_ddns'), '1');
  assert.equal(indice.get('intenciones_ddns_aceptadas'), '1');
  assert.equal(indice.get('causas_pol_ddns_pendientes'), '1');
}

async function crearFixture(sql) {
  const [usuario] = await sql.ejecutar(
    `INSERT INTO usuarios (usuario,email,hash_password)
     VALUES ('operador-52810c','operador@example.test','hash')`
  );
  return Object.freeze({
    directa: await crearEscenario(sql, usuario.insertId, 'directa', '192.0.2.201'),
    organizativa: await crearEscenario(sql, usuario.insertId, 'organizativa', '192.0.2.202')
  });
}

async function crearEscenario(sql, usuarioId, sufijo, valorDeseado) {
  const [tenant] = await sql.ejecutar(
    'INSERT INTO tenants (nombre,alias) VALUES (?,?)',
    [`Tenant ${sufijo} 5.28.10c`, `tenant-${sufijo}-52810c`]
  );
  const [empresa] = await sql.ejecutar(
    'INSERT INTO empresas (tenant_id,nombre,alias) VALUES (?,?,?)',
    [tenant.insertId, `Empresa ${sufijo} 5.28.10c`, `empresa-${sufijo}-52810c`]
  );
  const [sitio] = await sql.ejecutar(
    'INSERT INTO sitios (tenant_id,empresa_id,nombre,alias) VALUES (?,?,?,?)',
    [tenant.insertId, empresa.insertId, `Sitio ${sufijo} 5.28.10c`,
      `sitio-${sufijo}-52810c`]
  );
  const [agente] = await sql.ejecutar(
    `INSERT INTO agentes_sentinelia
       (guid,tenant_id,empresa_id,sitio_id,nombre,secreto_hash)
     VALUES (?,?,?,?,?,'hash')`,
    [generarUuidV7Auditoria(), tenant.insertId, empresa.insertId,
      sitio.insertId, `Agente ${sufijo} 5.28.10c`]
  );
  const [zona] = await sql.ejecutar(
    `INSERT INTO zonas_dns
       (tenant_id,empresa_id,sitio_id,nombre_zona,soa_mname,soa_rname)
     VALUES (?,?,?,?,?,?)`,
    [tenant.insertId, empresa.insertId, sitio.insertId,
      `${sufijo}.52810c.example.`, 'ns.example.', 'hostmaster.example.']
  );
  const [registro] = await sql.ejecutar(
    `INSERT INTO registros_dns
       (zona_id,tenant_id,empresa_id,sitio_id,host_relativo,tipo_registro,
        valor_principal,categoria_origen)
     VALUES (?,?,?,?,?,'A','192.0.2.200','ddns')`,
    [zona.insertId, tenant.insertId, empresa.insertId, sitio.insertId, 'host']
  );
  return Object.freeze({
    usuarioId: String(usuarioId),
    tenantId: String(tenant.insertId),
    empresaId: String(empresa.insertId),
    sitioId: String(sitio.insertId),
    agenteId: String(agente.insertId),
    zonaId: String(zona.insertId),
    registroId: String(registro.insertId),
    valorDeseado
  });
}

function diagnostico(concesion, escenario) {
  return {
    perfil: 'sentinelia-bind-diagnostico-v1',
    entradas: [{
      zonaDnsId: escenario.zonaId,
      rutaZona: 'zonas/zona',
      linea: 1,
      registroDnsId: escenario.registroId,
      concesionId: concesion.concesionId,
      versionDdns: '1'
    }]
  };
}

function actores(usuarioId) {
  return Object.freeze({
    real: Object.freeze({ usuarioId }),
    efectivo: Object.freeze({ usuarioId })
  });
}

async function bloquearCatalogoEnTransaccion({ conexion }) {
  await conexion.execute('SELECT id FROM zonas_dns ORDER BY id FOR UPDATE');
  await conexion.execute('SELECT id FROM registros_dns ORDER BY zona_id,id FOR UPDATE');
}

async function transaccion(sql, trabajo) {
  const conexion = await sql.obtenerConexion();
  try {
    await conexion.beginTransaction();
    const resultado = await trabajo(conexion);
    await conexion.commit();
    return resultado;
  } catch (error) {
    await conexion.rollback();
    throw error;
  } finally {
    conexion.release();
  }
}

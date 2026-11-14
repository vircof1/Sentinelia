import assert from 'node:assert/strict';
import { createHash, randomBytes } from 'node:crypto';

import { canonicalizarJcsAuditoriaV1 } from '../paquetes/auditoria/src/PerfilJcsAuditoria.js';
import {
  generarUuidV7Auditoria,
  uuidV7AuditoriaABytes
} from '../paquetes/auditoria/src/UuidV7Auditoria.js';
import { RepositorioUsuarios } from '../paquetes/usuarios/src/RepositorioUsuarios.js';
import { RepositorioConcesionesDdnsAgentes } from '../paquetes/dns/src/RepositorioConcesionesDdnsAgentes.js';
import { RepositorioCoordinacionGeneracionesDns } from '../paquetes/dns/src/RepositorioCoordinacionGeneracionesDns.js';
import { RepositorioRegistrosDns } from '../paquetes/dns/src/RepositorioRegistrosDns.js';
import { RepositorioZonasDns } from '../paquetes/dns/src/RepositorioZonasDns.js';
import { ServicioAplicacionDdnsAgentes } from '../paquetes/dns/src/ServicioAplicacionDdnsAgentes.js';
import { ResolutorScopeUsuario } from '../paquetes/contexto-usuario/src/ResolutorScopeUsuario.js';
import { ServicioAdministracionDnsPortal } from '../apps/sentinelia-web/src/servicios/ServicioAdministracionDnsPortal.js';
import {
  PERFILES_DDNS_AGENTES,
  VERSION_CONTRATO_DDNS_AGENTES
} from '../paquetes/dns/src/ContratoDdnsAgentes.js';
import {
  crearEstadoInicialDdnsAgentes,
  decidirIntencionDdnsAgentes
} from '../paquetes/dns/src/MaquinaEstadoDdnsAgentes.js';
import { canonicalizarEstadoDeseadoDdnsAgentes } from '../paquetes/dns/src/ValidadorEstadoDdnsAgentes.js';
import { ClienteSql } from '../paquetes/persistencia-sql/src/ClienteSql.js';
import { EjecutorMigraciones } from '../paquetes/persistencia-sql/src/EjecutorMigraciones.js';
import { RepositorioMigraciones } from '../paquetes/persistencia-sql/src/RepositorioMigraciones.js';
import {
  obtenerConfiguracionAplicacion,
  obtenerRutaMigraciones
} from '../paquetes/utilidades/src/configuracion/obtenerConfiguracionAplicacion.js';

await main();

async function main() {
  const configuracion = obtenerConfiguracionAplicacion();
  assert.equal(configuracion.sql.estaCompleta, true, '5.28.3c necesita MariaDB real.');
  const administrador = new ClienteSql(configuracion.sql);
  const base = `sentinelia_fixture_5283c_${randomBytes(5).toString('hex')}`;
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
    const repositorioConcesiones = new RepositorioConcesionesDdnsAgentes(sql);
    const repositorioGeneraciones = new RepositorioCoordinacionGeneracionesDns({
      clienteSql: sql,
      bloquearCatalogoEnTransaccion
    });
    const servicio = new ServicioAplicacionDdnsAgentes({
      clienteSql: sql,
      repositorioUsuarios: new RepositorioUsuarios(sql),
      repositorioConcesiones,
      repositorioCoordinacionGeneracionesDns: repositorioGeneraciones
    });
    const concesion = await repositorioConcesiones.crearConcesion({
      concesionId: generarUuidV7Auditoria(),
      agenteId: fixture.agente,
      registroDnsId: fixture.registro
    });
    await hacerOperativaObservada(sql, concesion);
    const concesionMx = await repositorioConcesiones.crearConcesion({
      concesionId: generarUuidV7Auditoria(),
      agenteId: fixture.agente,
      registroDnsId: fixture.registroMx
    });
    await hacerOperativaDeclaradaMx(sql, concesionMx);

    const primera = await servicio.editarValorGobernado({
      contextoUsuarioActual: contexto(fixture.usuario, fixture.scope),
      registroDnsId: fixture.registro,
      valorPrincipal: '203.0.113.10'
    });
    assert.deepEqual(
      seleccionar(primera, ['gobernado', 'cambioEfectivo', 'version', 'modo', 'origen']),
      {
        gobernado: true,
        cambioEfectivo: true,
        version: '2',
        modo: 'observada',
        origen: 'usuario'
      }
    );

    const repetida = await servicio.editarValorGobernado({
      contextoUsuarioActual: contexto(fixture.usuario, fixture.scope),
      registroDnsId: fixture.registro,
      valorPrincipal: '203.0.113.10'
    });
    assert.equal(repetida.cambioEfectivo, false);
    assert.equal(repetida.version, '2');

    const segunda = await servicio.editarValorGobernado({
      contextoUsuarioActual: contexto(fixture.usuario, fixture.scope),
      registroDnsId: fixture.registro,
      valorPrincipal: '203.0.113.11'
    });
    assert.equal(segunda.version, '3');
    assert.equal(segunda.modo, 'observada');
    const cambioMx = await servicio.editarValorGobernado({
      contextoUsuarioActual: contexto(fixture.usuario, fixture.scope),
      registroDnsId: fixture.registroMx,
      valorPrincipal: 'Mail.Nuevo.Example',
      prioridad: 25
    });
    assert.equal(cambioMx.version, '2');
    assert.equal(cambioMx.modo, 'declarada');
    await verificarPersistencia(sql, fixture, concesion);
    const [registroMx] = await sql.consultar(
      'SELECT valor_principal,prioridad,ttl_segundos FROM registros_dns WHERE id=?',
      [fixture.registroMx]
    );
    assert.equal(registroMx.valor_principal, 'mail.nuevo.example.');
    assert.equal(Number(registroMx.prioridad), 25);
    assert.equal(Number(registroMx.ttl_segundos), 900);
    await verificarRecorridoPortal({
      sql,
      servicio,
      repositorioGeneraciones,
      fixture
    });
    await verificarNoGobernado(servicio, fixture);
    await verificarAutoridadViva(sql, servicio, fixture);
    verificarConflictoYAusenciaDePrecedencia(concesion.concesionId);

    console.log(
      '[dns-ddns] OK 5.28.3c: edicion_humana=causal modo=conservado ' +
      'origen=usuario ultimo_escritor=aceptado agente_anterior=obsoleto ' +
      'repeticion=sin_version prioridad=delegada ttl=no_delegado'
    );
  } finally {
    await sql?.cerrar().catch(() => {});
    await administrador.ejecutar(
      `DROP DATABASE IF EXISTS ${administrador.escaparIdentificador(base)}`
    ).catch(() => {});
    await administrador.cerrar();
  }
}

async function verificarRecorridoPortal({
  sql,
  servicio,
  repositorioGeneraciones,
  fixture
}) {
  const servicioPortal = new ServicioAdministracionDnsPortal({
    repositorioZonasDns: new RepositorioZonasDns(sql),
    repositorioRegistrosDns: new RepositorioRegistrosDns(sql),
    repositorioTenants: null,
    repositorioEmpresas: null,
    repositorioSitios: null,
    resolutorScopeUsuario: new ResolutorScopeUsuario(),
    servicioLecturaDnsPortal: {},
    servicioAplicacionDdnsAgentes: servicio,
    repositorioCoordinacionGeneracionesDns: repositorioGeneraciones,
    servicioDns: { invalidarCatalogoDns: async () => {} }
  });
  const actualizado = await servicioPortal.actualizarRegistro(
    contexto(fixture.usuario, fixture.scope),
    fixture.zona,
    fixture.registro,
    {
      hostRelativo: 'host',
      tipoRegistro: 'A',
      valorPrincipal: '203.0.113.12',
      ttlSegundos: 301,
      categoriaOrigen: 'ddns',
      publicarEnBind: true,
      activo: true
    }
  );
  assert.equal(actualizado.valorPrincipal, '203.0.113.12');
  assert.equal(actualizado.ttlSegundos, 301);
  const [causal] = await sql.consultar(
    `SELECT CAST(version_ddns AS CHAR) AS version_ddns,modo
       FROM concesiones_ddns_agentes WHERE registro_dns_id=?`,
    [fixture.registro]
  );
  assert.equal(causal.version_ddns, '4');
  assert.equal(causal.modo, 'observada');
  const [cabecera] = await sql.consultar(
    'SELECT CAST(ultima_generacion_dns AS CHAR) AS ultima FROM cabecera_generacion_dns WHERE id=1'
  );
  assert.equal(cabecera.ultima, '4', 'el recorrido web no debe duplicar la generación DDNS');
}

function verificarConflictoYAusenciaDePrecedencia(concesionId) {
  let estado = crearEstadoInicialDdnsAgentes({ concesionId });
  const agenteInicial = decidirIntencionDdnsAgentes(
    estado,
    solicitud('0', '192.0.2.30')
  );
  estado = agenteInicial.estado;
  const usuarioPosterior = decidirIntencionDdnsAgentes(
    estado,
    solicitud('1', '192.0.2.31')
  );
  estado = usuarioPosterior.estado;
  const agenteObsoleto = decidirIntencionDdnsAgentes(
    estado,
    solicitud('1', '192.0.2.32')
  );
  assert.equal(agenteObsoleto.respuesta.resultado, 'rechazada');
  assert.equal(agenteObsoleto.respuesta.error, 'version_obsoleta');
  const agenteActual = decidirIntencionDdnsAgentes(
    estado,
    solicitud('2', '192.0.2.32')
  );
  assert.equal(agenteActual.respuesta.resultado, 'aceptada');
  assert.equal(agenteActual.respuesta.version, '3');
}

function solicitud(versionEsperada, direccionIpv4) {
  return {
    perfil: PERFILES_DDNS_AGENTES.SOLICITUD,
    versionContrato: VERSION_CONTRATO_DDNS_AGENTES,
    solicitudId: generarUuidV7Auditoria(),
    versionEsperada,
    estadoDeseado: {
      perfil: PERFILES_DDNS_AGENTES.ESTADO_DESEADO,
      versionContrato: VERSION_CONTRATO_DDNS_AGENTES,
      tipo: 'A',
      modo: 'declarada',
      valor: { direccionIpv4 }
    }
  };
}

async function hacerOperativaObservada(sql, concesion) {
  const estado = canonicalizarEstadoDeseadoDdnsAgentes({
    tipo: 'A',
    modo: 'observada',
    valor: null
  });
  const canonico = canonicalizarJcsAuditoriaV1(estado);
  const huella = createHash('sha256').update(canonico, 'utf8').digest();
  const [intencion] = await sql.ejecutar(
    `INSERT INTO intenciones_ddns_agentes (
       intencion_id,concesion_interna_id,agente_id_fotografia,
       registro_dns_id_fotografia,origen,version_ddns,modo,
       estado_deseado_canonico,estado_deseado_sha256,causa_tipo,causa_id
     ) VALUES (?,?,?,?,?,'1','observada',?,?,?,?)`,
    [
      uuidV7AuditoriaABytes(generarUuidV7Auditoria()),
      concesion.idInterno,
      concesion.agenteIdFotografia,
      concesion.registroDnsIdFotografia,
      'agente_explicita',
      canonico,
      huella,
      'solicitud_agente',
      uuidV7AuditoriaABytes(generarUuidV7Auditoria())
    ]
  );
  await sql.ejecutar(
    `UPDATE concesiones_ddns_agentes
        SET version_ddns=1,decision='operativa',modo='observada',
            intencion_gobernante_id=?,contenido_deseado_canonico=?,
            contenido_deseado_sha256=?,condicion_operativa='esperando_observacion'
      WHERE id=?`,
    [intencion.insertId, canonico, huella, concesion.idInterno]
  );
}

async function hacerOperativaDeclaradaMx(sql, concesion) {
  const estado = canonicalizarEstadoDeseadoDdnsAgentes({
    tipo: 'MX',
    modo: 'declarada',
    valor: { prioridad: 10, destino: 'mail.inicial.example.' }
  });
  const canonico = canonicalizarJcsAuditoriaV1(estado);
  const huella = createHash('sha256').update(canonico, 'utf8').digest();
  const [intencion] = await sql.ejecutar(
    `INSERT INTO intenciones_ddns_agentes (
       intencion_id,concesion_interna_id,agente_id_fotografia,
       registro_dns_id_fotografia,origen,version_ddns,modo,
       estado_deseado_canonico,estado_deseado_sha256,causa_tipo,causa_id,
       hito,persistida_en_utc
     ) VALUES (?,?,?,?,?,'1','declarada',?,?,?,?,
               'contenido_deseado_persistido',UTC_TIMESTAMP(3))`,
    [
      uuidV7AuditoriaABytes(generarUuidV7Auditoria()),
      concesion.idInterno,
      concesion.agenteIdFotografia,
      concesion.registroDnsIdFotografia,
      'agente_explicita',
      canonico,
      huella,
      'solicitud_agente',
      uuidV7AuditoriaABytes(generarUuidV7Auditoria())
    ]
  );
  await sql.ejecutar(
    `UPDATE concesiones_ddns_agentes
        SET version_ddns=1,decision='operativa',modo='declarada',
            intencion_gobernante_id=?,contenido_deseado_canonico=?,
            contenido_deseado_sha256=?,condicion_operativa='operativa'
      WHERE id=?`,
    [intencion.insertId, canonico, huella, concesion.idInterno]
  );
}

async function verificarPersistencia(sql, fixture, concesion) {
  const [registro] = await sql.consultar(
    'SELECT valor_principal,ttl_segundos FROM registros_dns WHERE id=?',
    [fixture.registro]
  );
  assert.equal(registro.valor_principal, '203.0.113.11');
  assert.equal(Number(registro.ttl_segundos), 300);
  const [estado] = await sql.consultar(
    `SELECT CAST(version_ddns AS CHAR) AS version_ddns,modo,
            contenido_deseado_canonico
       FROM concesiones_ddns_agentes WHERE id=?`,
    [concesion.idInterno]
  );
  assert.equal(estado.version_ddns, '3');
  assert.equal(estado.modo, 'observada');
  const contenido = estado.contenido_deseado_canonico;
  assert.deepEqual(typeof contenido === 'string' ? JSON.parse(contenido) : contenido, {
    tipo: 'A',
    modo: 'observada',
    valor: { direccionIpv4: '203.0.113.11' }
  });
  const intenciones = await sql.consultar(
    `SELECT origen,CAST(version_ddns AS CHAR) AS version_ddns,terminal,hito
       FROM intenciones_ddns_agentes WHERE concesion_interna_id=?
      ORDER BY version_ddns`,
    [concesion.idInterno]
  );
  assert.deepEqual(intenciones.map((fila) => ({
    origen: fila.origen,
    version: fila.version_ddns,
    terminal: fila.terminal,
    hito: fila.hito
  })), [
    { origen: 'agente_explicita', version: '1', terminal: 'sustituida', hito: 'intencion_aceptada' },
    { origen: 'usuario', version: '2', terminal: 'sustituida', hito: 'contenido_deseado_persistido' },
    { origen: 'usuario', version: '3', terminal: null, hito: 'contenido_deseado_persistido' }
  ]);
  const intentos = await sql.consultar(
    `SELECT CAST(version_ddns AS CHAR) AS version_ddns,estado
       FROM intentos_publicacion_ddns WHERE concesion_interna_id=?
      ORDER BY version_ddns`,
    [concesion.idInterno]
  );
  assert.deepEqual(intentos.map((fila) => [fila.version_ddns, fila.estado]), [
    ['2', 'sustituida'],
    ['3', 'pendiente']
  ]);
  const [cabecera] = await sql.consultar(
    'SELECT CAST(ultima_generacion_dns AS CHAR) AS ultima FROM cabecera_generacion_dns WHERE id=1'
  );
  assert.equal(cabecera.ultima, '3');
}

async function verificarNoGobernado(servicio, fixture) {
  const resultado = await servicio.editarValorGobernado({
    contextoUsuarioActual: contexto(fixture.usuario, fixture.scope),
    registroDnsId: fixture.registroLibre,
    valorPrincipal: '198.51.100.20'
  });
  assert.deepEqual(resultado, { gobernado: false, cambioEfectivo: false });
}

async function verificarAutoridadViva(sql, servicio, fixture) {
  await sql.ejecutar(
    'UPDATE usuarios SET permiso_administrar_dns_avanzado=0 WHERE id=?',
    [fixture.usuario]
  );
  await assert.rejects(
    servicio.editarValorGobernado({
      contextoUsuarioActual: contexto(fixture.usuario, fixture.scope),
      registroDnsId: fixture.registro,
      valorPrincipal: '203.0.113.12'
    }),
    (error) => error?.codigo === 'autoridad_insuficiente'
  );
}

async function crearFixture(sql) {
  const [tenant] = await sql.ejecutar(
    "INSERT INTO tenants (nombre,alias) VALUES ('Tenant 5.28.3c','tenant-5283c')"
  );
  const [empresa] = await sql.ejecutar(
    "INSERT INTO empresas (tenant_id,nombre,alias) VALUES (?,'Empresa 5.28.3c','empresa-5283c')",
    [tenant.insertId]
  );
  const [sitio] = await sql.ejecutar(
    "INSERT INTO sitios (tenant_id,empresa_id,nombre,alias) VALUES (?,?,'Sitio 5.28.3c','sitio-5283c')",
    [tenant.insertId, empresa.insertId]
  );
  const scope = {
    tenantId: tenant.insertId,
    empresaId: empresa.insertId,
    sitioId: sitio.insertId
  };
  const [usuario] = await sql.ejecutar(
    `INSERT INTO usuarios (
       usuario,email,hash_password,tenant_id,empresa_id,sitio_id,
       permiso_administrar_dns_avanzado
     ) VALUES ('usuario-5283c','usuario@example.test','hash',?,?,?,1)`,
    [scope.tenantId, scope.empresaId, scope.sitioId]
  );
  const [agente] = await sql.ejecutar(
    `INSERT INTO agentes_sentinelia (
       guid,tenant_id,empresa_id,sitio_id,nombre,secreto_hash
     ) VALUES (?,?,?,?,?,'hash')`,
    [generarUuidV7Auditoria(), scope.tenantId, scope.empresaId, scope.sitioId, 'Agente 5.28.3c']
  );
  const [zona] = await sql.ejecutar(
    `INSERT INTO zonas_dns (
       tenant_id,empresa_id,sitio_id,nombre_zona,soa_mname,soa_rname
     ) VALUES (?,?,?,?,?,?)`,
    [scope.tenantId, scope.empresaId, scope.sitioId, 'ddns-5283c.example.', 'ns.example.', 'hostmaster.example.']
  );
  const [registro] = await sql.ejecutar(
    `INSERT INTO registros_dns (
       zona_id,tenant_id,empresa_id,sitio_id,host_relativo,tipo_registro,
       valor_principal,ttl_segundos,categoria_origen
     ) VALUES (?,?,?,?,'host','A','192.0.2.10',300,'ddns')`,
    [zona.insertId, scope.tenantId, scope.empresaId, scope.sitioId]
  );
  const [registroLibre] = await sql.ejecutar(
    `INSERT INTO registros_dns (
       zona_id,tenant_id,empresa_id,sitio_id,host_relativo,tipo_registro,
       valor_principal,ttl_segundos,categoria_origen
     ) VALUES (?,?,?,?,'libre','A','192.0.2.20',600,'ddns')`,
    [zona.insertId, scope.tenantId, scope.empresaId, scope.sitioId]
  );
  const [registroMx] = await sql.ejecutar(
    `INSERT INTO registros_dns (
       zona_id,tenant_id,empresa_id,sitio_id,host_relativo,tipo_registro,
       valor_principal,ttl_segundos,prioridad,categoria_origen
     ) VALUES (?,?,?,?,'@','MX','mail.inicial.example.',900,10,'ddns')`,
    [zona.insertId, scope.tenantId, scope.empresaId, scope.sitioId]
  );
  return Object.freeze({
    usuario: usuario.insertId,
    agente: agente.insertId,
    registro: registro.insertId,
    registroMx: registroMx.insertId,
    registroLibre: registroLibre.insertId,
    zona: zona.insertId,
    scope
  });
}

function contexto(idUsuario, scope) {
  return Object.freeze({
    idUsuario,
    idUsuarioReal: idUsuario,
    nivelScope: 'sitio',
    esOperadorSistema: false,
    ...scope,
    permisos: Object.freeze({ administrarDnsAvanzado: true })
  });
}

async function bloquearCatalogoEnTransaccion({ conexion }) {
  await conexion.execute('SELECT id FROM zonas_dns ORDER BY id FOR UPDATE');
  await conexion.execute('SELECT id FROM registros_dns ORDER BY zona_id,id FOR UPDATE');
}

function seleccionar(objeto, claves) {
  return Object.fromEntries(claves.map((clave) => [clave, objeto[clave]]));
}

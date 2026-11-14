import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';

import { generarUuidV7Auditoria } from '../paquetes/auditoria/src/UuidV7Auditoria.js';
import { ConsolidadorPublicacionDdnsSql } from '../paquetes/dns/src/ConsolidadorPublicacionDdnsSql.js';
import { PERFILES_DDNS_AGENTES, VERSION_CONTRATO_DDNS_AGENTES }
  from '../paquetes/dns/src/ContratoDdnsAgentes.js';
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
import { obtenerConfiguracionAplicacion, obtenerRutaMigraciones }
  from '../paquetes/utilidades/src/configuracion/obtenerConfiguracionAplicacion.js';

await main();

async function main() {
  const configuracion = obtenerConfiguracionAplicacion();
  assert.equal(configuracion.sql.estaCompleta, true, '5.28.7c necesita MariaDB real.');
  const administrador = new ClienteSql(configuracion.sql);
  const base = `sentinelia_fixture_5287c_${randomBytes(5).toString('hex')}`;
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
    await verificarAutomatismo(sql);
    console.log('[dns-ddns] OK 5.28.7c: modo=precede-pol familia=ipv4-ipv6 carreras=declarada-revocada-humana idempotencia=causa-concesion publicacion=causal continuidad=publicada-pol');
  } finally {
    await sql?.cerrar().catch(() => {});
    await administrador.ejecutar(
      `DROP DATABASE IF EXISTS ${administrador.escaparIdentificador(base)}`
    ).catch(() => {});
    await administrador.cerrar();
  }
}

async function verificarAutomatismo(sql) {
  const fixture = await crearFixture(sql);
  const repositorioConcesiones = new RepositorioConcesionesDdnsAgentes(sql);
  let invalidaciones = 0;
  const servicio = new ServicioAplicacionDdnsAgentes({
    clienteSql: sql,
    repositorioUsuarios: new RepositorioUsuarios(sql),
    repositorioCoordinacionGeneracionesDns:
      new RepositorioCoordinacionGeneracionesDns({
        clienteSql: sql,
        bloquearCatalogoEnTransaccion
      }),
    servicioDns: { async invalidarCatalogoDns() { invalidaciones += 1; } }
  });

  const principalA = await concederObservada({
    servicio, repositorioConcesiones, fixture, registro: fixture.registros.a
  });
  const principalAaaa = await concederObservada({
    servicio, repositorioConcesiones, fixture, registro: fixture.registros.aaaa
  });
  const candidatas = await repositorioConcesiones
    .listarObservadasAptasPorAgente(fixture.agente);
  const candidataA = buscarCandidata(candidatas, principalA.concesionId);
  const candidataAaaa = buscarCandidata(candidatas, principalAaaa.concesionId);
  const causaIpv4 = causa(fixture, 'ipv4', '192.0.2.210');

  const aplicadaA = await servicio.aplicarObservacionPol({
    causa: causaIpv4,
    concesion: candidataA
  });
  assert.deepEqual([aplicadaA.resultado, aplicadaA.version], ['aceptada', '2']);
  assert.equal((await valorRegistro(sql, fixture.registros.a)), '192.0.2.210');
  assert.equal(invalidaciones, 1);

  const familiaAjena = await servicio.aplicarObservacionPol({
    causa: causaIpv4,
    concesion: candidataAaaa
  });
  assert.deepEqual(
    [familiaAjena.resultado, familiaAjena.causa],
    ['descartada', 'familia_no_aplicable']
  );
  assert.equal((await valorRegistro(sql, fixture.registros.aaaa)), '2001:db8::10');

  const replay = await servicio.aplicarObservacionPol({
    causa: causaIpv4,
    concesion: candidataA
  });
  assert.deepEqual([replay.resultado, replay.version], ['repetida', '2']);
  const cuentaCausa = await sql.consultar(
    `SELECT COUNT(*) total FROM intenciones_ddns_agentes
      WHERE concesion_interna_id=? AND causa_tipo='pol'`,
    [principalA.idInterno]
  );
  assert.equal(Number(cuentaCausa[0].total), 1);
  await confirmarPublicacionFixture(sql, principalA, fixture, '2');

  // E01: una NUEVA intención observada debe consumir un POL posterior,
  // incluso cuando su dirección coincide con el contenido ya persistido.
  const nuevaObservada = solicitudObservada('A', '2');
  const nueva = await aceptar(servicio, fixture, principalA, nuevaObservada);
  assert.equal(nueva.version, '3');
  assert.equal(nueva.condicion, 'esperando_observacion');
  const candidataNueva = buscarCandidata(
    await repositorioConcesiones.listarObservadasAptasPorAgente(fixture.agente),
    principalA.concesionId
  );
  const antiguaMismaIp = await servicio.aplicarObservacionPol({
    causa: causa(fixture, 'ipv4', '192.0.2.210', -10_000), concesion: candidataNueva
  });
  assert.equal(antiguaMismaIp.causa, 'modo_posterior_al_pol');
  const [instante] = await sql.consultar(
    `SELECT i.aceptada_en_utc FROM intenciones_ddns_agentes i
       JOIN concesiones_ddns_agentes c ON c.intencion_gobernante_id=i.id WHERE c.id=?`,
    [principalA.idInterno]
  );
  const simultanea = await servicio.aplicarObservacionPol({
    causa: { ...causa(fixture, 'ipv4', '192.0.2.210'), aceptadaEnUtc: instante.aceptada_en_utc },
    concesion: candidataNueva
  });
  assert.equal(simultanea.causa, 'modo_posterior_al_pol');
  const repetidaObservada = await aceptar(servicio, fixture, principalA, nuevaObservada);
  assert.equal(repetidaObservada.resultado, 'repetida');
  assert.equal(repetidaObservada.version, '3');
  const obsoleta = await aceptar(servicio, fixture, principalA, solicitudDeclarada('2', '192.0.2.211'));
  assert.equal(obsoleta.error, 'version_obsoleta');
  const polMismaIp = causa(fixture, 'ipv4', '192.0.2.210');
  const desbloqueada = await servicio.aplicarObservacionPol({
    causa: polMismaIp, concesion: candidataNueva
  });
  assert.equal(desbloqueada.resultado, 'aceptada',
    'E01: el POL posterior con la misma IP no puede abandonar la intención pendiente');
  assert.equal(desbloqueada.version, '4');
  const [estadoTrasPol] = await sql.consultar(
    `SELECT c.condicion_operativa,i.hito,i.terminal,i.persistida_en_utc
       FROM concesiones_ddns_agentes c
       JOIN intenciones_ddns_agentes i ON i.id=c.intencion_gobernante_id WHERE c.id=?`,
    [principalA.idInterno]
  );
  assert.equal(estadoTrasPol.condicion_operativa, 'operativa');
  assert.equal(estadoTrasPol.hito, 'contenido_deseado_persistido');
  assert.ok(estadoTrasPol.persistida_en_utc);
  assert.equal(invalidaciones, 2, 'La nueva versión tiene una publicación causal propia');
  const [presupuesto] = await sql.consultar(
    'SELECT COUNT(*) total FROM intentos_publicacion_ddns WHERE concesion_interna_id=? AND version_ddns=4',
    [principalA.idInterno]
  );
  assert.equal(Number(presupuesto.total), 1);
  await confirmarPublicacionFixture(sql, principalA, fixture, '4');
  const [publicada] = await sql.consultar(
    `SELECT c.version_ddns,c.condicion_operativa,c.contenido_deseado_sha256,
            c.contenido_publicado_sha256,i.hito,i.terminal,i.aceptada_en_utc,
            i.persistida_en_utc,i.publicada_en_utc,i.terminada_en_utc
       FROM concesiones_ddns_agentes c
       JOIN intenciones_ddns_agentes i ON i.id=c.intencion_gobernante_id WHERE c.id=?`,
    [principalA.idInterno]
  );
  assert.equal(String(publicada.version_ddns), '4');
  assert.equal(publicada.terminal, 'publicada');
  assert.equal(publicada.hito, 'contenido_publicado');
  assert.deepEqual(publicada.contenido_deseado_sha256, publicada.contenido_publicado_sha256);
  assert.ok(publicada.aceptada_en_utc <= publicada.persistida_en_utc);
  assert.ok(publicada.persistida_en_utc <= publicada.publicada_en_utc);
  assert.ok(publicada.terminada_en_utc);
  const replayPolMismaIp = await servicio.aplicarObservacionPol({
    causa: polMismaIp, concesion: candidataNueva
  });
  assert.equal(replayPolMismaIp.resultado, 'repetida');
  assert.equal(replayPolMismaIp.version, '4');
  const candidataResuelta = buscarCandidata(
    await repositorioConcesiones.listarObservadasAptasPorAgente(fixture.agente),
    principalA.concesionId
  );
  const sinCambios = await servicio.aplicarObservacionPol({
    causa: causa(fixture, 'ipv4', '192.0.2.210'), concesion: candidataResuelta
  });
  assert.equal(sinCambios.resultado, 'sin_cambios');
  assert.equal(sinCambios.version, '4');
  const replayTrasPublicar = await aceptar(servicio, fixture, principalA, nuevaObservada);
  assert.equal(replayTrasPublicar.resultado, 'repetida');
  assert.equal(replayTrasPublicar.version, '4');
  assert.equal((await valorRegistro(sql, fixture.registros.a)), '192.0.2.210');

  const causaIpv6 = causa(fixture, 'ipv6', '2001:db8::210');
  const aplicadaAaaa = await servicio.aplicarObservacionPol({
    causa: causaIpv6,
    concesion: candidataAaaa
  });
  assert.equal(aplicadaAaaa.resultado, 'aceptada');
  assert.equal((await valorRegistro(sql, fixture.registros.aaaa)), '2001:db8::210');

  const reciente = await repositorioConcesiones.crearConcesion({
    concesionId: generarUuidV7Auditoria(),
    agenteId: fixture.agente,
    registroDnsId: fixture.registros.reciente
  });
  const causaAnterior = causa(fixture, 'ipv4', '192.0.2.220', -10_000);
  await aceptar(servicio, fixture, reciente, solicitudObservada('A', '0'));
  const candidataReciente = buscarCandidata(
    await repositorioConcesiones.listarObservadasAptasPorAgente(fixture.agente),
    reciente.concesionId
  );
  const anterior = await servicio.aplicarObservacionPol({
    causa: causaAnterior,
    concesion: candidataReciente
  });
  assert.deepEqual(
    [anterior.resultado, anterior.causa],
    ['descartada', 'modo_posterior_al_pol']
  );

  const carreraDeclarada = await concederObservada({
    servicio, repositorioConcesiones, fixture, registro: fixture.registros.declarada
  });
  const candidataDeclarada = buscarCandidata(
    await repositorioConcesiones.listarObservadasAptasPorAgente(fixture.agente),
    carreraDeclarada.concesionId
  );
  const causaDeclarada = causa(fixture, 'ipv4', '192.0.2.230');
  await aceptar(servicio, fixture, carreraDeclarada,
    solicitudDeclarada('1', '192.0.2.231'));
  const descartadaDeclarada = await servicio.aplicarObservacionPol({
    causa: causaDeclarada,
    concesion: candidataDeclarada
  });
  assert.equal(descartadaDeclarada.causa, 'fotografia_obsoleta');
  assert.equal((await valorRegistro(sql, fixture.registros.declarada)), '192.0.2.231');

  const carreraRevocada = await concederObservada({
    servicio, repositorioConcesiones, fixture, registro: fixture.registros.revocada
  });
  const candidataRevocada = buscarCandidata(
    await repositorioConcesiones.listarObservadasAptasPorAgente(fixture.agente),
    carreraRevocada.concesionId
  );
  await repositorioConcesiones.cerrarConcesion({
    concesionId: carreraRevocada.concesionId,
    causa: 'revocada_desde_agente'
  });
  const descartadaRevocada = await servicio.aplicarObservacionPol({
    causa: causa(fixture, 'ipv4', '192.0.2.240'),
    concesion: candidataRevocada
  });
  assert.equal(descartadaRevocada.causa, 'fotografia_obsoleta');

  const carreraHumana = await concederObservada({
    servicio, repositorioConcesiones, fixture, registro: fixture.registros.humana
  });
  const candidataHumana = buscarCandidata(
    await repositorioConcesiones.listarObservadasAptasPorAgente(fixture.agente),
    carreraHumana.concesionId
  );
  const causaHumana = causa(fixture, 'ipv4', '192.0.2.250');
  await servicio.editarValorGobernado({
    contextoUsuarioActual: contextoUsuario(fixture),
    registroDnsId: fixture.registros.humana,
    valorPrincipal: '192.0.2.251'
  });
  await sql.ejecutar(
    `UPDATE intenciones_ddns_agentes i
       JOIN concesiones_ddns_agentes c ON c.intencion_gobernante_id=i.id
        SET i.hito='contenido_publicado',i.terminal='publicada',
            i.publicada_en_utc=UTC_TIMESTAMP(3),i.terminada_en_utc=UTC_TIMESTAMP(3)
      WHERE c.id=?`,
    [carreraHumana.idInterno]
  );
  const descartadaHumana = await servicio.aplicarObservacionPol({
    causa: causaHumana,
    concesion: candidataHumana
  });
  assert.equal(descartadaHumana.causa, 'fotografia_obsoleta');
  assert.equal((await valorRegistro(sql, fixture.registros.humana)), '192.0.2.251');

  const candidataHumanaActualizada = buscarCandidata(
    await repositorioConcesiones.listarObservadasAptasPorAgente(fixture.agente),
    carreraHumana.concesionId
  );
  const observacionPosterior = await servicio.aplicarObservacionPol({
    causa: causa(fixture, 'ipv4', '192.0.2.252', 20_000),
    concesion: candidataHumanaActualizada
  });
  assert.deepEqual(
    [observacionPosterior.resultado, observacionPosterior.version],
    ['aceptada', '3']
  );
  assert.equal((await valorRegistro(sql, fixture.registros.humana)), '192.0.2.252');
  const historialHumano = await sql.consultar(
    `SELECT version_ddns,terminal FROM intenciones_ddns_agentes
      WHERE concesion_interna_id=? ORDER BY version_ddns`,
    [carreraHumana.idInterno]
  );
  assert.deepEqual(
    historialHumano.map(({ version_ddns: version, terminal }) => [String(version), terminal]),
    [['1', 'sustituida'], ['2', 'publicada'], ['3', null]]
  );
  await verificarRetornoDeclarado(sql, servicio, repositorioConcesiones, fixture);
}

async function verificarRetornoDeclarado(sql, servicio, repositorioConcesiones, fixture) {
  for (const [clave, tipo, valor] of [
    ['retornoAaaa', 'AAAA', { direccionIpv6: '2001:db8::19' }],
    ['retornoA', 'A', { direccionIpv4: '192.0.2.19' }]
  ]) {
    const registro = fixture.registros[clave];
    const concesion = await repositorioConcesiones.crearConcesion({
      concesionId: generarUuidV7Auditoria(), agenteId: fixture.agente, registroDnsId: registro
    });
    const publicada = { ...fixture, registros: { a: registro } };
    await aceptar(servicio, fixture, concesion, solicitud(tipo, 'declarada', valor, '0'));
    await confirmarPublicacionFixture(sql, concesion, publicada, '1');
    await aceptar(servicio, fixture, concesion, solicitudObservada(tipo, '1'));
    const retorno = solicitud(tipo, 'declarada', valor, '2');
    const aceptada = await aceptar(servicio, fixture, concesion, retorno);
    assert.deepEqual([aceptada.resultado, aceptada.version], ['aceptada', '3']);
    const intentos = await sql.consultar(
      `SELECT numero_intento,estado,generacion_dns FROM intentos_publicacion_ddns
        WHERE concesion_interna_id=? AND version_ddns=3`, [concesion.idInterno]);
    assert.equal(intentos.length, 1,
      `${tipo}: volver a declarar el valor publicado necesita una vía de confirmación`);
    assert.equal(Number(intentos[0].numero_intento), 1);
    assert.equal(intentos[0].estado, 'pendiente');
    assert.equal((await aceptar(servicio, fixture, concesion, retorno)).resultado, 'repetida');
    assert.equal((await aceptar(servicio, fixture, concesion,
      solicitudObservada(tipo, '2'))).error, 'version_obsoleta');
    await confirmarPublicacionFixture(sql, concesion, publicada, '3');
    const [actual] = await sql.consultar(
      `SELECT i.hito,i.terminal,i.aceptada_en_utc,i.persistida_en_utc,i.publicada_en_utc,
              c.contenido_deseado_sha256=c.contenido_publicado_sha256 AS coincide
         FROM concesiones_ddns_agentes c JOIN intenciones_ddns_agentes i
           ON i.id=c.intencion_gobernante_id WHERE c.id=?`, [concesion.idInterno]);
    assert.equal(actual.hito, 'contenido_publicado');
    assert.equal(actual.terminal, 'publicada');
    assert.equal(Number(actual.coincide), 1);
    assert.ok(actual.aceptada_en_utc <= actual.persistida_en_utc);
    assert.ok(actual.persistida_en_utc <= actual.publicada_en_utc);
    assert.equal((await aceptar(servicio, fixture, concesion, retorno)).resultado, 'repetida');
    assert.equal((await aceptar(servicio, fixture, concesion,
      solicitud(tipo, 'declarada', valor, '3'))).resultado, 'sin_cambios');
    const [cuenta] = await sql.consultar(
      'SELECT COUNT(*) total FROM intentos_publicacion_ddns WHERE concesion_interna_id=? AND version_ddns=3',
      [concesion.idInterno]);
    assert.equal(Number(cuenta.total), 1);
    assert.equal(await valorRegistro(sql, registro), Object.values(valor)[0]);
  }
}

async function concederObservada({ servicio, repositorioConcesiones, fixture, registro }) {
  const concesion = await repositorioConcesiones.crearConcesion({
    concesionId: generarUuidV7Auditoria(),
    agenteId: fixture.agente,
    registroDnsId: registro
  });
  const resultado = await aceptar(
    servicio,
    fixture,
    concesion,
    solicitudObservada(registro === fixture.registros.aaaa ? 'AAAA' : 'A', '0')
  );
  assert.equal(resultado.resultado, 'aceptada');
  return concesion;
}

// Simula la confirmación BIND exclusivamente en esta base aislada: prueba SQL,
// no constituye una comprobación DNS autoritativa del entorno real.
async function confirmarPublicacionFixture(sql, concesion, fixture, versionDdns) {
  const [intento] = await sql.consultar(
    'SELECT generacion_dns FROM intentos_publicacion_ddns WHERE concesion_interna_id=? AND version_ddns=?',
    [concesion.idInterno, versionDdns]
  );
  const conexion = await sql.obtenerConexion();
  try {
    await conexion.beginTransaction();
    await new ConsolidadorPublicacionDdnsSql().consolidarEnTransaccion({
      conexion, generacionDns: String(intento.generacion_dns),
      diagnostico: { entradas: [{ concesionId: concesion.concesionId,
        versionDdns, registroDnsId: String(fixture.registros.a) }] }
    });
    await conexion.commit();
  } catch (error) {
    await conexion.rollback();
    throw error;
  } finally { conexion.release(); }
}

function aceptar(servicio, fixture, concesion, solicitud) {
  return servicio.aceptarIntencionExplicita({
    contextoSesionTecnica: { sesion: { agenteId: String(fixture.agente) } },
    concesionId: concesion.concesionId,
    solicitud
  });
}

function solicitudObservada(tipo, versionEsperada) {
  return solicitud(tipo, 'observada', null, versionEsperada);
}

function solicitudDeclarada(versionEsperada, direccionIpv4) {
  return solicitud('A', 'declarada', { direccionIpv4 }, versionEsperada);
}

function solicitud(tipo, modo, valor, versionEsperada) {
  return {
    perfil: PERFILES_DDNS_AGENTES.SOLICITUD,
    versionContrato: VERSION_CONTRATO_DDNS_AGENTES,
    solicitudId: generarUuidV7Auditoria(),
    versionEsperada,
    estadoDeseado: {
      perfil: PERFILES_DDNS_AGENTES.ESTADO_DESEADO,
      versionContrato: VERSION_CONTRATO_DDNS_AGENTES,
      tipo,
      modo,
      valor
    }
  };
}

function causa(fixture, familiaDireccion, direccionRemota, diferenciaMs = 10_000) {
  return Object.freeze({
    causaId: generarUuidV7Auditoria(),
    agenteId: String(fixture.agente),
    periodoVidaPolId: '1',
    secuencia: '1',
    aceptadaEnUtc: new Date(Date.now() + diferenciaMs),
    familiaDireccion,
    direccionRemota
  });
}

function buscarCandidata(candidatas, concesionId) {
  const candidata = candidatas.find((item) => item.concesionId === concesionId);
  assert.ok(candidata, `No apareció la candidata ${concesionId}.`);
  return candidata;
}

async function valorRegistro(sql, id) {
  return (await sql.consultar('SELECT valor_principal FROM registros_dns WHERE id=?', [id]))[0]
    .valor_principal;
}

function contextoUsuario(fixture) {
  return {
    idUsuario: fixture.usuario,
    idUsuarioReal: fixture.usuario,
    nivelScope: 'sitio',
    tenantId: fixture.tenant,
    empresaId: fixture.empresa,
    sitioId: fixture.sitio,
    permisos: { administrarDnsAvanzado: true }
  };
}

async function bloquearCatalogoEnTransaccion({ conexion }) {
  await conexion.execute('SELECT id FROM zonas_dns ORDER BY id FOR UPDATE');
  await conexion.execute('SELECT id FROM registros_dns ORDER BY zona_id,id FOR UPDATE');
}

async function crearFixture(sql) {
  const [tenant] = await sql.ejecutar(
    "INSERT INTO tenants (nombre,alias) VALUES ('Tenant 7c','tenant-5287c')"
  );
  const [empresa] = await sql.ejecutar(
    "INSERT INTO empresas (tenant_id,nombre,alias) VALUES (?,'Empresa 7c','empresa-5287c')",
    [tenant.insertId]
  );
  const [sitio] = await sql.ejecutar(
    "INSERT INTO sitios (tenant_id,empresa_id,nombre,alias) VALUES (?,?,'Sitio 7c','sitio-5287c')",
    [tenant.insertId, empresa.insertId]
  );
  const [usuario] = await sql.ejecutar(
    `INSERT INTO usuarios (
       usuario,email,hash_password,tenant_id,empresa_id,sitio_id,
       permiso_administrar_dns_avanzado
     ) VALUES ('usuario-5287c','usuario@example.test','hash',?,?,?,1)`,
    [tenant.insertId, empresa.insertId, sitio.insertId]
  );
  const [agente] = await sql.ejecutar(
    `INSERT INTO agentes_sentinelia
       (guid,tenant_id,empresa_id,sitio_id,nombre,secreto_hash)
     VALUES (?,?,?,?,?,'hash')`,
    [generarUuidV7Auditoria(), tenant.insertId, empresa.insertId,
      sitio.insertId, 'Agente 7c']
  );
  const [zona] = await sql.ejecutar(
    `INSERT INTO zonas_dns
       (tenant_id,empresa_id,sitio_id,nombre_zona,soa_mname,soa_rname)
     VALUES (?,?,?,?,?,?)`,
    [tenant.insertId, empresa.insertId, sitio.insertId,
      'causal.5287c.example.', 'ns.example.', 'hostmaster.example.']
  );
  const definiciones = {
    a: ['a', 'A', '192.0.2.10'],
    aaaa: ['aaaa', 'AAAA', '2001:db8::10'],
    reciente: ['reciente', 'A', '192.0.2.20'],
    declarada: ['declarada', 'A', '192.0.2.30'],
    revocada: ['revocada', 'A', '192.0.2.40'],
    humana: ['humana', 'A', '192.0.2.50'],
    retornoAaaa: ['retorno-aaaa', 'AAAA', '2001:db8::10'],
    retornoA: ['retorno-a', 'A', '192.0.2.10']
  };
  const registros = {};
  for (const [clave, [host, tipo, valor]] of Object.entries(definiciones)) {
    const [registro] = await sql.ejecutar(
      `INSERT INTO registros_dns
         (zona_id,tenant_id,empresa_id,sitio_id,host_relativo,tipo_registro,
          valor_principal,ttl_segundos,categoria_origen)
       VALUES (?,?,?,?,?,?,?,300,'ddns')`,
      [zona.insertId, tenant.insertId, empresa.insertId, sitio.insertId,
        host, tipo, valor]
    );
    registros[clave] = registro.insertId;
  }
  return Object.freeze({
    tenant: tenant.insertId,
    empresa: empresa.insertId,
    sitio: sitio.insertId,
    usuario: usuario.insertId,
    agente: agente.insertId,
    zona: zona.insertId,
    registros: Object.freeze(registros)
  });
}

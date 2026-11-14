import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';

import { DespachadorOutboxAuditoriaRuntime }
  from '../apps/sentinelia-runtime/src/auditoria/DespachadorOutboxAuditoriaRuntime.js';
import { RepositorioAuditoria } from '../paquetes/auditoria/src/RepositorioAuditoria.js';
import { RepositorioOutboxAuditoriaRuntime }
  from '../paquetes/auditoria/src/RepositorioOutboxAuditoriaRuntime.js';
import { ServicioAuditoriaOperativa }
  from '../paquetes/auditoria/src/ServicioAuditoriaOperativa.js';
import { generarUuidV7Auditoria }
  from '../paquetes/auditoria/src/UuidV7Auditoria.js';
import { construirIntencionAuditoriaDdns }
  from '../paquetes/dns/src/EventosAuditoriaDdnsAgentes.js';
import { ClienteSql } from '../paquetes/persistencia-sql/src/ClienteSql.js';
import { EjecutorMigraciones } from '../paquetes/persistencia-sql/src/EjecutorMigraciones.js';
import { RepositorioMigraciones }
  from '../paquetes/persistencia-sql/src/RepositorioMigraciones.js';
import { obtenerConfiguracionAplicacion, obtenerRutaMigraciones }
  from '../paquetes/utilidades/src/configuracion/obtenerConfiguracionAplicacion.js';

await main();

async function main() {
  const configuracion = obtenerConfiguracionAplicacion();
  assert.equal(configuracion.sql.estaCompleta, true, '5.28.9a necesita MariaDB real.');
  const administrador = new ClienteSql(configuracion.sql);
  const base = `sentinelia_fixture_5289a_${randomBytes(5).toString('hex')}`;
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
    await verificarCatalogosFisicos(sql, base);
    await verificarActoresEncadenadoYReplay(sql);
    console.log('[dns-ddns] OK 5.28.9a: catalogo=9 eventos actores=usuario-agente-runtime scope=historico outbox=durable replay=exacto secretos=ausentes');
  } finally {
    await sql?.cerrar().catch(() => {});
    await administrador.ejecutar(
      `DROP DATABASE IF EXISTS ${administrador.escaparIdentificador(base)}`
    ).catch(() => {});
    await administrador.cerrar();
  }
}

async function verificarCatalogosFisicos(sql, base) {
  const filas = await sql.consultar(
    `SELECT TABLE_NAME,COLUMN_NAME,COLUMN_TYPE
       FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA=? AND TABLE_NAME IN ('eventos_auditoria','outbox_auditoria_runtime')
        AND COLUMN_NAME IN ('sujeto_tipo','causalidad_tipo')`,
    [base]
  );
  assert.equal(filas.length, 4);
  for (const fila of filas.filter((item) => item.COLUMN_NAME === 'sujeto_tipo')) {
    assert.match(fila.COLUMN_TYPE, /concesion_ddns/);
    assert.match(fila.COLUMN_TYPE, /intencion_ddns/);
  }
  for (const fila of filas.filter((item) => item.COLUMN_NAME === 'causalidad_tipo')) {
    assert.match(fila.COLUMN_TYPE, /intencion_ddns/);
  }
}

async function verificarActoresEncadenadoYReplay(sql) {
  const repositorioAuditoria = new RepositorioAuditoria(sql);
  const servicioAuditoria = new ServicioAuditoriaOperativa({ repositorioAuditoria });
  const outbox = new RepositorioOutboxAuditoriaRuntime(sql);
  const scope = { tenantId: '71', empresaId: '711', sitioId: null };
  const concesionId = generarUuidV7Auditoria();
  const intencionId = generarUuidV7Auditoria();
  const correlacionId = intencionId;
  const estado = {
    tipo: 'A',
    modo: 'declarada',
    valor: { direccionIpv4: '192.0.2.71' }
  };
  const humana = construirIntencionAuditoriaDdns({
    eventoId: generarUuidV7Auditoria(),
    tipo: 'ddns.concesion_creada',
    actorReal: { tipo: 'usuario', id: '17' },
    actorEfectivo: { tipo: 'usuario', id: '18' },
    sujetoId: concesionId,
    scope,
    correlacionId: concesionId,
    productor: 'portal_web',
    claveOperacion: `prueba:concesion:${concesionId}`,
    payload: {
      resultado: 'creada',
      tipoRegistro: 'A',
      estadoPosterior: estado,
      agenteId: '27',
      registroDnsId: '37'
    }
  });
  const agente = construirIntencionAuditoriaDdns({
    eventoId: generarUuidV7Auditoria(),
    tipo: 'ddns.intencion_aceptada',
    actorReal: { tipo: 'agente', id: '27' },
    sujetoId: intencionId,
    scope,
    correlacionId,
    productor: 'api_agentes',
    claveOperacion: `prueba:solicitud:${intencionId}`,
    payload: {
      resultado: 'aceptada',
      tipoRegistro: 'A',
      modo: 'declarada',
      estadoPosterior: estado,
      versionDdns: '1',
      origenIntencion: 'agente_explicita',
      agenteId: '27',
      registroDnsId: '37'
    }
  });
  const runtime = construirIntencionAuditoriaDdns({
    eventoId: generarUuidV7Auditoria(),
    tipo: 'ddns.contenido_deseado_persistido',
    actorReal: { tipo: 'runtime', id: 'sentinelia-runtime' },
    sujetoId: intencionId,
    scope,
    correlacionId,
    causalidadIntencionId: intencionId,
    productor: 'runtime_automatizacion',
    claveOperacion: `prueba:persistida:${intencionId}:1`,
    rolEvento: 'resultado',
    payload: {
      resultado: 'persistido',
      tipoRegistro: 'A',
      modo: 'declarada',
      estadoPosterior: estado,
      versionDdns: '1',
      origenIntencion: 'agente_explicita',
      generacionDns: '91',
      agenteId: '27',
      registroDnsId: '37'
    }
  });

  await transaccion(sql, async (conexion) => {
    await servicioAuditoria.registrarEnTransaccion(
      { cambioEfectivo: true, intencion: humana }, { conexion }
    );
    await servicioAuditoria.registrarEnTransaccion(
      { cambioEfectivo: true, intencion: agente }, { conexion }
    );
    const primera = await outbox.encolarEnTransaccion([runtime], { conexion });
    const repetida = await outbox.encolarEnTransaccion([runtime], { conexion });
    assert.equal(primera[0].resultadoAlta, 'creada');
    assert.equal(repetida[0].resultadoAlta, 'existente');
    assert.equal(primera[0].id, repetida[0].id);
  });

  const despachador = new DespachadorOutboxAuditoriaRuntime({
    repositorioOutbox: outbox,
    repositorioAuditoria,
    instanciaId: 'fixture-ddns-9a',
    concurrencia: 4,
    leaseTtlSegundos: 30,
    reintentoBaseSegundos: 1,
    reintentoMaximoSegundos: 8
  });
  const despacho = await despachador.procesarPendientes({ origen: 'fixture' });
  assert.equal(despacho.resultados.filter((r) => r.estado === 'completada').length, 1);

  const eventos = await sql.consultar(
    `SELECT tipo_evento,actor_real_tipo,actor_real_id,actor_efectivo_tipo,
            actor_efectivo_id,modo_actuacion,sujeto_tipo,sujeto_id,
            scope_tenant_id,scope_empresa_id,causalidad_tipo,causalidad_id,
            productor,payload,secuencia,hash_anterior,hash_actual
       FROM eventos_auditoria
      WHERE tipo_evento LIKE 'ddns.%'
      ORDER BY secuencia`
  );
  assert.equal(eventos.length, 3);
  const porTipo = new Map(eventos.map((evento) => [evento.tipo_evento, evento]));
  assert.deepEqual(
    [porTipo.get('ddns.concesion_creada').actor_real_id,
      porTipo.get('ddns.concesion_creada').actor_efectivo_id,
      porTipo.get('ddns.concesion_creada').modo_actuacion],
    ['17', '18', 'impersonado']
  );
  assert.equal(porTipo.get('ddns.intencion_aceptada').actor_real_tipo, 'agente');
  assert.equal(porTipo.get('ddns.contenido_deseado_persistido').actor_real_tipo, 'runtime');
  assert.equal(porTipo.get('ddns.contenido_deseado_persistido').causalidad_tipo, 'intencion_ddns');
  for (const evento of eventos) {
    assert.equal(String(evento.scope_tenant_id), '71');
    assert.equal(String(evento.scope_empresa_id), '711');
    assert.equal(Buffer.from(evento.hash_actual).length, 32);
    assert.doesNotMatch(JSON.stringify(evento.payload), /bearer|authorization|proxy|secreto|cabecera/i);
  }
  assert.equal(
    eventos.slice(1).every((evento, indice) =>
      Buffer.from(evento.hash_anterior).equals(Buffer.from(eventos[indice].hash_actual))),
    true,
    'La cadena DDNS debe permanecer enlazada en orden causal.'
  );
  const [obligacion] = await sql.consultar(
    `SELECT estado,intentos,evento_incorporado_id,payload
       FROM outbox_auditoria_runtime WHERE evento_id=?`,
    [Buffer.from(runtime.eventoId.replaceAll('-', ''), 'hex')]
  );
  assert.equal(obligacion.estado, 'completada');
  assert.equal(Number(obligacion.intentos), 1);
  assert.doesNotMatch(JSON.stringify(obligacion.payload), /bearer|authorization|proxy|secreto|cabecera/i);
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

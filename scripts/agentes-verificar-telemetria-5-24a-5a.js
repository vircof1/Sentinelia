import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';

import {
  crearLecturaTelemetriaAgenteConTiposInternos
} from '../paquetes/agentes/src/TelemetriaAgente.js';
import {
  RepositorioCatalogoSenalesTelemetriaAgentes
} from '../paquetes/agentes/src/RepositorioCatalogoSenalesTelemetriaAgentes.js';
import {
  RepositorioCorreccionesRelojTelemetria
} from '../paquetes/agentes/src/RepositorioCorreccionesRelojTelemetria.js';
import {
  RepositorioEstadoActualTelemetriaAgentes
} from '../paquetes/agentes/src/RepositorioEstadoActualTelemetriaAgentes.js';
import {
  RepositorioObservacionesTelemetriaAgentes
} from '../paquetes/agentes/src/RepositorioObservacionesTelemetriaAgentes.js';
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
  assert.equal(configuracion.sql.estaCompleta, true, '5.24a.5a exige SQL real.');
  const baseDatos = `sentinelia_fixture_524a5a_${randomBytes(6).toString('hex')}`;
  const administrador = new ClienteSql(configuracion.sql);
  await administrador.ejecutar(
    `CREATE DATABASE ${administrador.escaparIdentificador(baseDatos)} ` +
    'CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci'
  );
  const sql = new ClienteSql({ ...configuracion.sql, baseDatos });
  try {
    await new EjecutorMigraciones({
      clienteSql: sql,
      repositorioMigraciones: new RepositorioMigraciones(sql),
      rutaMigraciones: obtenerRutaMigraciones()
    }).ejecutarPendientes();
    await sql.verificarUsoHorarioUtc();
    await verificarCheckpointYLeases(sql);
    await verificarBarridoReanudable(sql);
  } finally {
    await sql.cerrar();
    await administrador.ejecutar(
      `DROP DATABASE IF EXISTS ${administrador.escaparIdentificador(baseDatos)}`
    ).catch(() => {});
    await administrador.cerrar();
  }
  console.log(
    '[agentes] OK 5.24a.5a: checkpoint=singleton reloj=sql_segundo ' +
    'avance_repeticion_retroceso=distintos correccion=generacional ' +
    'leases_relativos=cercados cursor=transaccional_reanudable presencias=coordinadas'
  );
}

async function verificarCheckpointYLeases(sql) {
  const base = await crearBase(sql, 'reloj');
  const fotografia = await crearSenalConFotografia(sql, base, 'reloj');
  const relativa = await crearRegla(sql, base, fotografia.senal.id, {
    tipo: 'momento_utc_relativo', estado: 'activa'
  });
  const absoluta = await crearRegla(sql, base, fotografia.senal.id, {
    tipo: 'momento_utc', estado: 'activa'
  });
  const trabajoRelativo = await crearTrabajoProcesando(
    sql, base, fotografia.observacion, relativa, 'relativo'
  );
  const trabajoAbsoluto = await crearTrabajoProcesando(
    sql, base, fotografia.observacion, absoluta, 'absoluto'
  );

  const inicial = crearRepositorioConReloj(sql, '2026-09-05T10:00:00.900Z');
  assert.equal((await inicial.observarReloj()).clasificacion, 'inicializado');
  assert.equal(
    (await crearRepositorioConReloj(sql, '2026-09-05T10:00:00.100Z')
      .observarReloj()).clasificacion,
    'repeticion',
    'Las fracciones no pueden inventar un retroceso menor de un segundo.'
  );
  assert.equal(
    (await crearRepositorioConReloj(sql, '2026-09-05T10:00:02Z')
      .observarReloj()).clasificacion,
    'avance'
  );

  const [retrocesoA, retrocesoB] = await Promise.all([
    crearRepositorioConReloj(sql, '2026-09-05T10:00:01Z').observarReloj(),
    crearRepositorioConReloj(sql, '2026-09-05T10:00:01Z').observarReloj()
  ]);
  assert.deepEqual(
    [retrocesoA.clasificacion, retrocesoB.clasificacion].sort(),
    ['repeticion', 'retroceso'],
    'Dos presencias deben serializar una única corrección para el mismo N.'
  );
  const retroceso = retrocesoA.clasificacion === 'retroceso' ? retrocesoA : retrocesoB;
  assert.equal(retroceso.generacionCorreccion, '1');
  assert.equal(retroceso.leasesCercados, 1);

  const [relativoSql] = await sql.consultar(
    `SELECT estado,reclamado_por,reclamado_en_utc,reclamo_expira_en_utc
       FROM trabajos_evaluacion_telemetria WHERE id=?`,
    [trabajoRelativo]
  );
  const [absolutoSql] = await sql.consultar(
    `SELECT estado,reclamado_por FROM trabajos_evaluacion_telemetria WHERE id=?`,
    [trabajoAbsoluto]
  );
  assert.deepEqual(
    [relativoSql.estado, relativoSql.reclamado_por,
      relativoSql.reclamado_en_utc, relativoSql.reclamo_expira_en_utc],
    ['pendiente', null, null, null]
  );
  assert.deepEqual([absolutoSql.estado, absolutoSql.reclamado_por],
    ['procesando', 'fixture-5.24a.5a']);
  assert.deepEqual(await inicial.obtenerCheckpoint(), {
    ultimoRelojAceptadoUtc: '2026-09-05T10:00:01.000Z',
    generacionCorreccion: '1'
  });
  assert.equal((await inicial.listarReconciliaciones()).length, 1);
  while (await inicial.procesarSiguienteLote({
    limite: 100,
    aplicarReglaEnTransaccion: async () => {}
  })) {
    // Drena la primera corrección antes de construir el escenario del cursor.
  }
  await sql.ejecutar(
    "UPDATE reglas_derivacion_telemetria SET estado='deshabilitada' WHERE id=?",
    [relativa.id]
  );
}

async function verificarBarridoReanudable(sql) {
  const base = await crearBase(sql, 'barrido');
  const fotos = [];
  for (const clave of ['uno', 'dos', 'tres']) {
    fotos.push(await crearSenalConFotografia(sql, base, clave));
  }
  const sinFoto = await crearSenal(sql, base, 'sin-foto');
  const reglas = [];
  for (const foto of fotos) {
    reglas.push(await crearRegla(sql, base, foto.senal.id, {
      tipo: 'momento_utc_relativo', estado: 'activa'
    }));
  }
  reglas.push(await crearRegla(sql, base, sinFoto.id, {
    tipo: 'momento_utc_relativo', estado: 'activa'
  }));
  await crearRegla(sql, base, fotos[0].senal.id, {
    tipo: 'momento_utc_relativo', estado: 'deshabilitada'
  });
  await crearRegla(sql, base, fotos[0].senal.id, {
    tipo: 'momento_utc', estado: 'activa'
  });

  const repo = crearRepositorioConReloj(sql, '2026-09-05T09:59:59Z');
  assert.equal((await repo.observarReloj()).clasificacion, 'retroceso');

  const vistos = [];
  const aplicar = async (entrada, { conexion }) => {
    assert.ok(conexion, 'El aplicador debe compartir la transacción del cursor.');
    vistos.push(entrada);
  };
  const lote1 = await repo.procesarSiguienteLote({ limite: 2, aplicarReglaEnTransaccion: aplicar });
  assert.deepEqual([lote1.procesadas, lote1.completada], [2, false]);
  assert.equal((await repo.listarReconciliaciones()).at(-1).reglasProcesadas, '2');

  let falloVisto = null;
  await assert.rejects(
    repo.procesarSiguienteLote({
      limite: 1,
      aplicarReglaEnTransaccion: async (entrada) => {
        falloVisto = entrada.regla.id;
        throw new Error('fallo inyectado antes del commit');
      }
    }),
    /fallo inyectado/
  );
  assert.equal((await repo.listarReconciliaciones()).at(-1).reglasProcesadas, '2');
  const lote2 = await repo.procesarSiguienteLote({
    limite: 1,
    aplicarReglaEnTransaccion: async (entrada) => {
      assert.equal(entrada.regla.id, falloVisto, 'El rollback debe repetir la misma regla.');
      vistos.push(entrada);
    }
  });
  assert.deepEqual([lote2.procesadas, lote2.completada], [1, false]);
  const lote3 = await repo.procesarSiguienteLote({ limite: 10, aplicarReglaEnTransaccion: aplicar });
  assert.deepEqual([lote3.procesadas, lote3.completada], [1, true]);
  assert.equal(vistos.length, 4);
  assert.deepEqual(vistos.map(({ regla }) => regla.id), reglas.map(({ id }) => id));
  assert.deepEqual(vistos.map(({ fotografia }) => fotografia !== null),
    [true, true, true, false]);
  assert.ok(vistos.every(({ reconciliacion }) =>
    reconciliacion.relojCorregidoUtc === '2026-09-05T09:59:59.000Z'));
  assert.equal(await repo.procesarSiguienteLote({ limite: 10, aplicarReglaEnTransaccion: aplicar }), null);
}

function crearRepositorioConReloj(sql, reloj) {
  return new RepositorioCorreccionesRelojTelemetria(sql, {
    lectorRelojSql: async () => reloj
  });
}

async function crearSenalConFotografia(sql, base, clave) {
  const senal = await crearSenal(sql, base, clave);
  const recibidoEnUtc = '2026-09-05T09:00:00Z';
  const lote = await new RepositorioObservacionesTelemetriaAgentes(sql)
    .insertarLoteAceptado({
      agenteId: base.id,
      senalesCatalogadas: [senal],
      recibidoEnUtc,
      observacionesAceptadas: [crearLecturaTelemetriaAgenteConTiposInternos({
        categoria: senal.categoria,
        clave: senal.clave,
        tipoDato: 'momento_utc',
        valorMomentoUtc: '2026-09-06T09:00:00Z',
        calidad: 'valida',
        observadoEnUtc: recibidoEnUtc
      })]
    });
  await new RepositorioEstadoActualTelemetriaAgentes(sql)
    .aplicarObservacionesHistoricas(lote.insertadas);
  return { senal, observacion: lote.insertadas[0] };
}

async function crearSenal(sql, base, clave) {
  return new RepositorioCatalogoSenalesTelemetriaAgentes(sql)
    .guardarDeclaracionSenal({
      agenteId: base.id,
      definicion: {
        categoria: 'reloj', clave, tipoDato: 'momento_utc', nombreHumano: clave
      }
    });
}

async function crearRegla(sql, base, senalId, { tipo, estado }) {
  const [regla] = await sql.ejecutar(
    `INSERT INTO reglas_derivacion_telemetria
       (agente_id,senal_id,tenant_id,empresa_id,sitio_id,estado)
     VALUES (?,?,?,?,?,?)`,
    [base.id, senalId, base.tenantId, base.empresaId, base.sitioId, estado]
  );
  const [revision] = await sql.ejecutar(
    `INSERT INTO revisiones_reglas_derivacion_telemetria
       (regla_id,numero,condicion_tipo,condicion_version,condicion_canonica,
        severidad_calculada,mensaje_operativo,nombre,vigente_desde_utc)
     VALUES (?,1,?,1,?,'advertencia','Fixture','Fixture',UTC_TIMESTAMP(6))`,
    [regla.insertId, tipo, JSON.stringify({ tipo, version: 1, configuracion: {} })]
  );
  await sql.ejecutar(
    'UPDATE reglas_derivacion_telemetria SET revision_vigente_id=? WHERE id=?',
    [revision.insertId, regla.insertId]
  );
  return { id: Number(regla.insertId), revisionId: Number(revision.insertId) };
}

async function crearTrabajoProcesando(sql, base, observacion, regla, sufijo) {
  const clave = `fixture-5.24a.5a-${sufijo}-${randomUUID()}`;
  const [trabajo] = await sql.ejecutar(
    `INSERT INTO trabajos_evaluacion_telemetria
       (observacion_id,regla_id,regla_revision_id,agente_id,senal_id,
        tenant_id,empresa_id,sitio_id,causa,generacion_autoridad,
        recibido_en_utc,estado,intentos,siguiente_intento_utc,reclamado_por,
        reclamado_en_utc,reclamo_expira_en_utc,clave_causal_canonica,
        huella_causal_sha256)
     VALUES (?,?,?,?,?,?,?,?,'observacion',1,?,'procesando',1,?, ?,?,?,?,UNHEX(SHA2(?,256)))`,
    [observacion.id, regla.id, regla.revisionId, base.id, observacion.senalId,
      base.tenantId, base.empresaId, base.sitioId, new Date(observacion.recibidoEnUtc),
      new Date('2026-09-05T11:00:00Z'), 'fixture-5.24a.5a',
      new Date('2026-09-05T10:00:00Z'), new Date('2026-09-05T10:05:00Z'),
      clave, clave]
  );
  return Number(trabajo.insertId);
}

async function crearBase(sql, sufijo) {
  const alias = `fixture-524a5a-${sufijo}-${randomBytes(4).toString('hex')}`;
  const [tenant] = await sql.ejecutar(
    'INSERT INTO tenants (nombre,alias) VALUES (?,?)', ['Tenant 5.24a.5a', alias]
  );
  const [empresa] = await sql.ejecutar(
    'INSERT INTO empresas (tenant_id,nombre,alias) VALUES (?,?,?)',
    [tenant.insertId, 'Empresa 5.24a.5a', alias]
  );
  const [sitio] = await sql.ejecutar(
    'INSERT INTO sitios (tenant_id,empresa_id,nombre,alias) VALUES (?,?,?,?)',
    [tenant.insertId, empresa.insertId, 'Sitio 5.24a.5a', alias]
  );
  const [agente] = await sql.ejecutar(
    `INSERT INTO agentes_sentinelia
       (guid,tenant_id,empresa_id,sitio_id,nombre,secreto_hash)
     VALUES (?,?,?,?,?,?)`,
    [randomUUID(), tenant.insertId, empresa.insertId, sitio.insertId,
      'Agente 5.24a.5a', 'hash-no-utilizable']
  );
  return {
    id: Number(agente.insertId), tenantId: Number(tenant.insertId),
    empresaId: Number(empresa.insertId), sitioId: Number(sitio.insertId)
  };
}

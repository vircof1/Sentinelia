import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';

import {
  crearLecturaTelemetriaAgenteConTiposInternos
} from '../paquetes/agentes/src/TelemetriaAgente.js';
import {
  RepositorioCatalogoSenalesTelemetriaAgentes
} from '../paquetes/agentes/src/RepositorioCatalogoSenalesTelemetriaAgentes.js';
import {
  RepositorioEstadoActualTelemetriaAgentes
} from '../paquetes/agentes/src/RepositorioEstadoActualTelemetriaAgentes.js';
import {
  RepositorioObservacionesTelemetriaAgentes
} from '../paquetes/agentes/src/RepositorioObservacionesTelemetriaAgentes.js';
import {
  RepositorioReglasDerivacionTelemetria
} from '../paquetes/agentes/src/RepositorioReglasDerivacionTelemetria.js';
import {
  RepositorioTrabajosEvaluacionTelemetria
} from '../paquetes/agentes/src/RepositorioTrabajosEvaluacionTelemetria.js';
import {
  ServicioAdministracionReglasDerivacionTelemetria
} from '../paquetes/agentes/src/ServicioAdministracionReglasDerivacionTelemetria.js';
import { validarEventoAuditableV1 } from '../paquetes/auditoria/src/ValidadorContratoAuditoria.js';
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
  assert.equal(configuracion.sql.estaCompleta, true, '5.24a.4b exige SQL real.');
  const baseDatos = `sentinelia_fixture_524a4b_${randomBytes(6).toString('hex')}`;
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
    await verificarAdministracionRelativa(sql, await crearBase(sql));
  } finally {
    await sql.cerrar();
    await administrador.ejecutar(
      `DROP DATABASE IF EXISTS ${administrador.escaparIdentificador(baseDatos)}`
    ).catch(() => {});
    await administrador.cerrar();
  }
  console.log(
    '[agentes] OK 5.24a.4b: generacion=revision_estado reconciliacion=atomica ' +
    'fotografia=vigente ausencia=sin_dato_y_sin_trabajo reactivacion=explicita ' +
    'auditoria=generacion_revision_reloj catalogo_publico=cerrado'
  );
}

async function verificarAdministracionRelativa(sql, base) {
  const catalogoReal = new RepositorioCatalogoSenalesTelemetriaAgentes(sql);
  const senal = await catalogoReal.guardarDeclaracionSenal({
    agenteId: base.id,
    definicion: {
      categoria: 'copias', clave: 'proxima', tipoDato: 'momento_utc',
      nombreHumano: 'Próxima copia'
    }
  });
  const observacion = await insertarFotografia(sql, base, senal);
  const auditoria = crearAuditoria();
  const servicio = crearServicio(sql, base, new Map([[Number(senal.id), senal]]), {
    auditoria,
    permitirMomentoUtcRelativo: true
  });
  const contexto = {};

  const creada = await servicio.crearRegla(contexto, {
    agenteId: base.id,
    senalId: senal.id,
    revision: revisionRelativa('Regla inicial', '3600')
  });
  assert.equal(creada.generacionAutoridad, 1);
  let trabajos = await listarTrabajos(sql, creada.id);
  assert.equal(trabajos.length, 1);
  assert.deepEqual(
    [trabajos[0].causa, String(trabajos[0].generacion_autoridad),
      Number(trabajos[0].observacion_id)],
    ['reconciliacion_administrativa', '1', Number(observacion.id)]
  );

  const revision2 = await servicio.crearNuevaRevision(contexto, {
    reglaId: creada.id,
    revision: revisionRelativa('Regla revisada', '7200')
  });
  let reglaSql = await cargarRegla(sql, creada.id);
  assert.equal(String(reglaSql.generacion_autoridad), '2');
  assert.equal(Number(reglaSql.revision_vigente_id), Number(revision2.revision.id));
  trabajos = await listarTrabajos(sql, creada.id);
  assert.equal(trabajos.length, 2);
  assert.deepEqual(trabajos.map((trabajo) => String(trabajo.generacion_autoridad)),
    ['1', '2']);

  await servicio.desactivarRegla(contexto, creada.id);
  reglaSql = await cargarRegla(sql, creada.id);
  assert.deepEqual([reglaSql.estado, String(reglaSql.generacion_autoridad)],
    ['deshabilitada', '3']);
  assert.equal((await listarTrabajos(sql, creada.id)).length, 2);

  await servicio.activarRegla(contexto, creada.id);
  reglaSql = await cargarRegla(sql, creada.id);
  assert.deepEqual([reglaSql.estado, String(reglaSql.generacion_autoridad)],
    ['activa', '4']);
  trabajos = await listarTrabajos(sql, creada.id);
  assert.equal(trabajos.length, 3);
  assert.equal(String(trabajos.at(-1).generacion_autoridad), '4');
  assert.equal(Number(trabajos.at(-1).regla_revision_id), Number(revision2.revision.id));

  const senalSinDato = await catalogoReal.guardarDeclaracionSenal({
    agenteId: base.id,
    definicion: {
      categoria: 'copias', clave: 'sin_dato', tipoDato: 'momento_utc',
      nombreHumano: 'Sin fotografía'
    }
  });
  servicio.repositorioCatalogoSenales.senales.set(Number(senalSinDato.id), senalSinDato);
  const sinDato = await servicio.crearRegla(contexto, {
    agenteId: base.id,
    senalId: senalSinDato.id,
    revision: revisionRelativa('Sin dato', '60')
  });
  assert.equal((await listarTrabajos(sql, sinDato.id)).length, 0);
  assert.equal(await new RepositorioEstadoActualTelemetriaAgentes(sql)
    .buscarPorSenalId({ agenteId: base.id, senalId: senalSinDato.id }), null);

  assert.equal(auditoria.eventos.length, 5);
  const [alta, revision, desactivacion, activacion] = auditoria.eventos;
  assert.equal(alta.payload.despues.generacionAutoridad, '1');
  assert.equal(revision.payload.despues.generacionAutoridad, '2');
  assert.equal(revision.payload.despues.revision.generacionAutoridad, '2');
  assert.deepEqual([
    desactivacion.payload.generacionAutoridadAntes,
    desactivacion.payload.generacionAutoridadDespues,
    activacion.payload.generacionAutoridadAntes,
    activacion.payload.generacionAutoridadDespues
  ], ['2', '3', '3', '4']);
  assert.ok(auditoria.eventos.every(
    (evento) => Date.parse(evento.efectivoEnUtc) ===
      Date.parse('2026-09-05T10:00:00Z')
  ));

  const cerrado = crearServicio(sql, base, new Map([[Number(senal.id), senal]]));
  await assert.rejects(
    cerrado.crearRegla(contexto, {
      agenteId: base.id,
      senalId: senal.id,
      revision: revisionRelativa('No publicada', '10')
    }),
    /todavía no está habilitada/u
  );
}

function crearServicio(
  sql,
  agente,
  senales,
  { auditoria = null, permitirMomentoUtcRelativo = false } = {}
) {
  const repositorioCatalogoSenales = {
    senales,
    async buscarPorId(id) { return this.senales.get(Number(id)) || null; },
    async listarPorAgente() { return [...this.senales.values()]; }
  };
  return new ServicioAdministracionReglasDerivacionTelemetria({
    repositorioAgentes: {
      async buscarPorId(id) { return Number(id) === Number(agente.id) ? agente : null; }
    },
    repositorioCatalogoSenales,
    repositorioReglas: new RepositorioReglasDerivacionTelemetria(sql),
    repositorioTrabajosEvaluacion: new RepositorioTrabajosEvaluacionTelemetria(sql),
    repositorioEstadoActualTelemetria: new RepositorioEstadoActualTelemetriaAgentes(sql),
    politicaPermisosAgentes: {
      assertPuedeModificar() {},
      assertPuedeVer() {},
      puedeAlcanzarAgente() { return true; }
    },
    fronteraTransaccional: crearFrontera(sql),
    servicioAuditoria: auditoria,
    permitirMomentoUtcRelativo,
    ahora: () => new Date('2026-09-05T10:00:00Z')
  });
}

function crearFrontera(sql) {
  return {
    async ejecutar(trabajo) {
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
  };
}

function crearAuditoria() {
  return {
    eventos: [],
    async registrarEnTransaccion({ intencion }) {
      validarEventoAuditableV1(intencion);
      this.eventos.push(intencion);
      return { evento: intencion, estado: 'incorporado' };
    }
  };
}

async function insertarFotografia(sql, base, senal) {
  const ahora = await ahoraSql(sql);
  const lote = await new RepositorioObservacionesTelemetriaAgentes(sql)
    .insertarLoteAceptado({
      agenteId: base.id,
      senalesCatalogadas: [senal],
      recibidoEnUtc: ahora,
      observacionesAceptadas: [crearLecturaTelemetriaAgenteConTiposInternos({
        categoria: senal.categoria,
        clave: senal.clave,
        tipoDato: 'momento_utc',
        valorMomentoUtc: sumarSegundos(ahora, 3600),
        calidad: 'valida',
        observadoEnUtc: ahora
      })]
    });
  await new RepositorioEstadoActualTelemetriaAgentes(sql)
    .aplicarObservacionesHistoricas(lote.insertadas);
  return lote.insertadas[0];
}

function revisionRelativa(nombre, segundos) {
  return {
    nombre,
    descripcion: 'Fixture de autoridad administrativa relativa.',
    severidadCalculada: 'advertencia',
    mensajeOperativo: 'La fecha comunicada exige atención.',
    metadatos: { origen: 'verificador' },
    condicion: {
      tipo: 'momento_utc_relativo',
      version: 1,
      configuracion: {
        forma: 'limite_superior',
        limite: { direccion: 'futuro', segundos },
        histeresisSegundos: '5'
      }
    }
  };
}

async function listarTrabajos(sql, reglaId) {
  return sql.consultar(
    `SELECT id,regla_revision_id,observacion_id,causa,generacion_autoridad
       FROM trabajos_evaluacion_telemetria WHERE regla_id=? ORDER BY id`,
    [reglaId]
  );
}

async function cargarRegla(sql, reglaId) {
  const [fila] = await sql.consultar(
    `SELECT estado,generacion_autoridad,revision_vigente_id
       FROM reglas_derivacion_telemetria WHERE id=?`,
    [reglaId]
  );
  return fila;
}

async function crearBase(sql) {
  const alias = `fixture-524a4b-${randomBytes(4).toString('hex')}`;
  const [tenant] = await sql.ejecutar(
    'INSERT INTO tenants (nombre,alias) VALUES (?,?)', ['Tenant 5.24a.4b', alias]
  );
  const [empresa] = await sql.ejecutar(
    'INSERT INTO empresas (tenant_id,nombre,alias) VALUES (?,?,?)',
    [tenant.insertId, 'Empresa 5.24a.4b', alias]
  );
  const [sitio] = await sql.ejecutar(
    'INSERT INTO sitios (tenant_id,empresa_id,nombre,alias) VALUES (?,?,?,?)',
    [tenant.insertId, empresa.insertId, 'Sitio 5.24a.4b', alias]
  );
  const [agente] = await sql.ejecutar(
    `INSERT INTO agentes_sentinelia
       (guid,tenant_id,empresa_id,sitio_id,nombre,secreto_hash)
     VALUES (?,?,?,?,?,?)`,
    [randomUUID(), tenant.insertId, empresa.insertId, sitio.insertId,
      'Agente 5.24a.4b', 'hash-no-utilizable']
  );
  return {
    id: Number(agente.insertId),
    tenantId: Number(tenant.insertId),
    empresaId: Number(empresa.insertId),
    sitioId: Number(sitio.insertId)
  };
}

async function ahoraSql(sql) {
  const [fila] = await sql.consultar('SELECT UTC_TIMESTAMP(0) AS ahora_utc');
  return new Date(fila.ahora_utc).toISOString().replace('.000Z', 'Z');
}

function sumarSegundos(valor, segundos) {
  return new Date(Date.parse(valor) + segundos * 1000)
    .toISOString()
    .replace('.000Z', 'Z');
}

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  ClienteSqlInstrumentadoAuditoria
} from '../paquetes/auditoria/src/ClienteSqlInstrumentadoAuditoria.js';
import {
  RepositorioLecturaAuditoriaSql,
  __testablesRepositorioLecturaAuditoriaSql
} from '../paquetes/auditoria/src/RepositorioLecturaAuditoriaSql.js';
import {
  crearFixtureConsultaAuditoriaUx
} from '../paquetes/auditoria/src/fixturesConsultaAuditoriaUx.js';
import { uuidV7AuditoriaABytes } from '../paquetes/auditoria/src/UuidV7Auditoria.js';

async function main() {
  verificarWhereBaseYSujeto();
  await verificarPaginaDeCorrelacionGrande();
  await verificarPaginaConMuchasCorrelaciones();
  await verificarPaginaFinalYLimites();
  await verificarFronterasDeUnidad();
  console.log('[auditoria] OK 5.21.16d: listado=plano limite=25 consulta=26 sujeto=exacto cursor=fecha_evento');
}

function verificarWhereBaseYSujeto() {
  const correlacionId = '018f8f70-7b5c-7a55-b32a-111111111111';
  const eventoId = '018f8f70-7b5c-7a55-b32a-222222222222';
  const consulta = __testablesRepositorioLecturaAuditoriaSql.construirWhere({
    contextoUsuarioActual: { nivelScope: 'tenant', tenantId: '101' },
    filtros: {
      flujo: 'usuarios',
      tipoEvento: 'usuario.perfil_cambiado',
      sujetoTipo: 'usuario',
      sujetoId: '42',
      desdeUtc: '2026-07-20T00:00:00.000Z',
      hastaUtc: '2026-07-27T23:59:59.999Z',
      correlacionId
    },
    cursor: {
      registradoEnUtc: '2026-07-25T12:00:00.000Z',
      eventoId
    },
    orden: 'asc'
  });
  assert.match(consulta.where, /scope_tenant_id = \?/);
  assert.match(consulta.where, /flujo = \?/);
  assert.match(consulta.where, /tipo_evento = \?/);
  assert.match(consulta.where, /sujeto_tipo = \?[\s\S]*sujeto_id = \?/);
  assert.match(consulta.where, /registrado_en_utc >= \?/);
  assert.match(consulta.where, /registrado_en_utc <= \?/);
  assert.match(consulta.where, /correlacion_id = \?/);
  assert.match(consulta.where, /registrado_en_utc > \?[\s\S]*evento_id > \?/);
  assert.deepEqual(consulta.parametros.slice(0, 7), [
    '101',
    'usuarios',
    'usuario.perfil_cambiado',
    'usuario',
    '42',
    '2026-07-20 00:00:00.000',
    '2026-07-27 23:59:59.999'
  ]);
  assert.deepEqual(consulta.parametros[7], uuidV7AuditoriaABytes(correlacionId));
  assert.deepEqual(consulta.parametros.slice(8, 10), [
    '2026-07-25 12:00:00.000',
    '2026-07-25 12:00:00.000'
  ]);
  assert.deepEqual(consulta.parametros[10], uuidV7AuditoriaABytes(eventoId));

  assert.throws(
    () => __testablesRepositorioLecturaAuditoriaSql.construirWhere({
      contextoUsuarioActual: { nivelScope: 'portal' },
      filtros: { sujetoTipo: 'usuario' }
    }),
    /deben aparecer juntos/
  );
  assert.throws(
    () => __testablesRepositorioLecturaAuditoriaSql.construirWhere({
      contextoUsuarioActual: { nivelScope: 'portal' },
      filtros: { sujetoId: '42' }
    }),
    /deben aparecer juntos/
  );
}

async function verificarPaginaDeCorrelacionGrande() {
  const fixture = crearFixtureConsultaAuditoriaUx();
  const eventosGrupo = fixture.eventos.filter((evento) =>
    evento.correlacionId === fixture.ids.correlacionGrande
  );
  const entorno = crearRepositorioInstrumentado(eventosGrupo);
  const pagina = await entorno.repositorio.listarPaginaEventos({
    contextoUsuarioActual: { nivelScope: 'sitio', sitioId: '10001' },
    filtros: { correlacionId: fixture.ids.correlacionGrande },
    limite: 25,
    orden: 'asc'
  });
  assert.equal(pagina.eventos.length, 25);
  assert.equal(pagina.hayMas, true);
  assert.deepEqual(pagina.siguientePosicion, {
    registradoEnUtc: pagina.eventos.at(-1).registradoEnUtc,
    eventoId: pagina.eventos.at(-1).eventoId
  });
  assert.ok(pagina.eventos.every((evento) =>
    evento.correlacionId === fixture.ids.correlacionGrande
  ));
  const trazas = entorno.clienteInstrumentado.obtenerTrazas();
  assert.equal(trazas.length, 1);
  assert.equal(trazas[0].parametros.at(-1), 26);
  assert.equal(trazas[0].filas, 26);
  assert.match(trazas[0].sqlNormalizado, /ORDER BY registrado_en_utc ASC, evento_id ASC LIMIT \?/);
  assert.doesNotMatch(trazas[0].sqlNormalizado, /ROW_NUMBER|PARTITION BY|COUNT\(\*\)/i);
}

async function verificarPaginaConMuchasCorrelaciones() {
  const fixture = crearFixtureConsultaAuditoriaUx();
  const eventos = fixture.eventos.filter((evento) =>
    evento.correlacionId !== fixture.ids.correlacionGrande
  );
  const entorno = crearRepositorioInstrumentado(eventos);
  const pagina = await entorno.repositorio.listarPaginaEventos({
    contextoUsuarioActual: { nivelScope: 'portal' },
    limite: 25,
    orden: 'asc'
  });
  assert.equal(pagina.eventos.length, 25);
  assert.ok(new Set(pagina.eventos.map((evento) => evento.correlacionId)).size > 10);
  assert.equal(entorno.clienteInstrumentado.obtenerResumen().total, 1);
}

async function verificarPaginaFinalYLimites() {
  const fixture = crearFixtureConsultaAuditoriaUx();
  const entorno = crearRepositorioInstrumentado(fixture.eventos.slice(0, 25));
  const pagina = await entorno.repositorio.listarPaginaEventos({
    contextoUsuarioActual: { nivelScope: 'portal' },
    limite: '25',
    orden: 'desc'
  });
  assert.equal(pagina.eventos.length, 25);
  assert.equal(pagina.hayMas, false);
  assert.equal(pagina.siguientePosicion, null);
  for (const invalido of [0, 101, 1.5, 'x']) {
    await assert.rejects(
      () => entorno.repositorio.listarPaginaEventos({
        contextoUsuarioActual: { nivelScope: 'portal' },
        limite: invalido
      }),
      /entre 1 y 100/
    );
  }
}

async function verificarFronterasDeUnidad() {
  const repositorio = await readFile(
    new URL('../paquetes/auditoria/src/RepositorioLecturaAuditoriaSql.js', import.meta.url),
    'utf8'
  );
  assert.match(repositorio, /async listarPaginaEventos/);
  assert.match(repositorio, /filas\.slice\(0, limiteNormalizado\)/);
  assert.match(repositorio, /filas\.length > limiteNormalizado/);
  assert.match(repositorio, /sujeto_tipo = \?/);
  assert.match(repositorio, /sujeto_id = \?/);
  assert.doesNotMatch(repositorio, /actor_real_tipo = \?|actor_efectivo_tipo = \?|causalidad_tipo = \?/);

  const servicio = await readFile(
    new URL('../paquetes/auditoria/src/ServicioLecturaAuditoria.js', import.meta.url),
    'utf8'
  );
  assert.doesNotMatch(servicio, /listarPaginaEventos/);
}

function crearRepositorioInstrumentado(eventos) {
  const clienteBase = new ClienteSqlListadoFixture(eventos.map(filaSql));
  const clienteInstrumentado = new ClienteSqlInstrumentadoAuditoria({ clienteSql: clienteBase });
  return {
    clienteInstrumentado,
    repositorio: new RepositorioLecturaAuditoriaSql({ clienteSql: clienteInstrumentado })
  };
}

function filaSql(evento) {
  return {
    evento_id: uuidV7AuditoriaABytes(evento.eventoId),
    evento_contraparte_id: null,
    tipo_evento: evento.tipoEvento,
    version_contrato: evento.versionContrato,
    flujo: evento.flujo,
    clave_cadena: evento.claveCadena,
    secuencia: evento.secuencia,
    actor_real_tipo: evento.actorReal.tipo,
    actor_real_id: evento.actorReal.id,
    actor_efectivo_tipo: evento.actorEfectivo?.tipo ?? null,
    actor_efectivo_id: evento.actorEfectivo?.id ?? null,
    modo_actuacion: evento.modoActuacion,
    sujeto_tipo: evento.sujeto.tipo,
    sujeto_id: evento.sujeto.id,
    origen: evento.origen,
    scope_tenant_id: evento.scope.tenantId,
    scope_empresa_id: evento.scope.empresaId,
    scope_sitio_id: evento.scope.sitioId,
    correlacion_id: uuidV7AuditoriaABytes(evento.correlacionId),
    causalidad_tipo: evento.causalidadTipo,
    causalidad_id: evento.causalidadId,
    productor: evento.productor,
    clave_operacion: Buffer.from(evento.claveOperacion, 'ascii'),
    rol_evento: evento.rolEvento,
    efectivo_en_utc: evento.efectivoEnUtc,
    registrado_en_utc: evento.registradoEnUtc,
    version_canonicalizador: evento.versionCanonicalizador,
    version_encadenado: evento.versionEncadenado,
    payload: evento.payload,
    hash_payload: evento.hashPayload,
    hash_anterior: evento.hashAnterior,
    hash_actual: evento.hashActual
  };
}

class ClienteSqlListadoFixture {
  constructor(filas) {
    this.filas = filas;
  }

  async obtenerConexion() {
    return {
      execute: async (sql, parametros) => {
        assert.doesNotMatch(String(sql), /COUNT\(\*\)|ROW_NUMBER|PARTITION BY/i);
        const limite = Number(parametros.at(-1));
        return [this.filas.slice(0, limite), []];
      },
      release() {}
    };
  }
}

main().catch((error) => {
  console.error('[auditoria] ERROR 5.21.16d:', error);
  process.exitCode = 1;
});

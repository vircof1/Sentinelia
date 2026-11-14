import assert from 'node:assert/strict';
import {
  ClienteSqlInstrumentadoAuditoria
} from '../paquetes/auditoria/src/ClienteSqlInstrumentadoAuditoria.js';
import {
  RepositorioLecturaAuditoriaSql
} from '../paquetes/auditoria/src/RepositorioLecturaAuditoriaSql.js';
import {
  ResolutorVisibilidadCausalAuditoria
} from '../paquetes/auditoria/src/ResolutorVisibilidadCausalAuditoria.js';
import {
  ServicioLecturaAuditoria
} from '../paquetes/auditoria/src/ServicioLecturaAuditoria.js';

async function main() {
  await verificarCotaIndependienteDelTamano();
  await verificarPermisosAntesDeConsultar();
  await verificarScopeYNoRevelacion();
  await verificarIntegracionServicioSinFallbackNMasUno();
  await verificarLimiteDefensivo();
  console.log('[auditoria] OK 5.21.16g: paginas=10_100 consultas=5 causalidad=por_tipo scope=sql n_mas_uno=eliminado');
}

async function verificarCotaIndependienteDelTamano() {
  for (const tamano of [10, 100]) {
    const entorno = crearEntornoSql();
    const eventos = crearEventos(tamano);
    const visibilidad = await entorno.resolutor.resolverLote({
      eventos,
      contextoUsuarioActual: contextoCompleto()
    });
    const trazas = entorno.instrumentado.obtenerTrazas();
    assert.equal(trazas.length, 5, `La página de ${tamano} debe usar cinco consultas.`);
    assert.equal(trazas.filter((traza) => /FROM eventos_auditoria e/.test(traza.sql)).length, 1);
    for (const tabla of [
      'eventos_monitores',
      'ejecuciones_triggers',
      'operaciones_sesion_agentes',
      'operaciones_publicacion_dns'
    ]) {
      assert.equal(trazas.filter((traza) => traza.sql.includes(`FROM ${tabla}`)).length, 1);
    }
    assert.ok(trazas.every((traza) => /\bIN\s*\(/i.test(traza.sql)));
    assert.ok(visibilidad.eventosAuditoriaVisibles.length > 0);
    assert.deepEqual(
      Object.keys(visibilidad.causalidadesPorTipo).sort(),
      ['ejecucion_trigger', 'evento_monitor', 'generacion_dns', 'operacion_sesion_agente']
    );
  }
}

async function verificarPermisosAntesDeConsultar() {
  const entorno = crearEntornoSql();
  const eventos = crearEventos(10);
  const ctx = contextoCompleto({
    verTriggers: false,
    verAgentes: false,
    verDns: false
  });
  const visibilidad = await entorno.resolutor.resolverLote({
    eventos,
    contextoUsuarioActual: ctx
  });
  const trazas = entorno.instrumentado.obtenerTrazas();
  assert.equal(trazas.length, 2);
  assert.ok(trazas.some((traza) => /FROM eventos_auditoria e/.test(traza.sql)));
  assert.ok(trazas.some((traza) => /FROM eventos_monitores/.test(traza.sql)));
  assert.equal('ejecucion_trigger' in visibilidad.causalidadesPorTipo, false);
  assert.equal('operacion_sesion_agente' in visibilidad.causalidadesPorTipo, false);
  assert.equal('generacion_dns' in visibilidad.causalidadesPorTipo, false);

  for (const evento of eventos) {
    const causalidad = await entorno.resolutor.proyectarCausalidad({
      evento,
      contextoUsuarioActual: ctx,
      visibilidadLote: visibilidad
    });
    if (evento.causalidadTipo === 'evento_monitor' ||
        evento.causalidadTipo === 'evento_auditoria') {
      assert.ok(causalidad);
    } else {
      assert.equal(causalidad, null);
    }
  }
  assert.equal(entorno.instrumentado.obtenerTrazas().length, 2);
}

async function verificarScopeYNoRevelacion() {
  const entornoTenant = crearEntornoSql();
  await entornoTenant.resolutor.resolverLote({
    eventos: crearEventos(10),
    contextoUsuarioActual: contextoCompleto({ nivelScope: 'tenant', tenantId: '9' })
  });
  const trazasTenant = entornoTenant.instrumentado.obtenerTrazas();
  assert.equal(trazasTenant.length, 4, 'DNS no se consulta fuera del scope portal.');
  for (const traza of trazasTenant) {
    assert.match(traza.sqlNormalizado, /(?:scope_tenant_id|tenant_id|trigger_tenant_id) = \?/);
    assert.equal(traza.parametros.at(-1), '9');
  }

  const entornoFuera = crearEntornoSql({ tenantVisible: '9' });
  const eventos = crearEventos(10);
  const ctxFuera = contextoCompleto({ nivelScope: 'tenant', tenantId: '999' });
  const lote = await entornoFuera.resolutor.resolverLote({
    eventos,
    contextoUsuarioActual: ctxFuera
  });
  assert.deepEqual(lote.eventosAuditoriaVisibles, []);
  assert.ok(Object.values(lote.causalidadesPorTipo).every((ids) => ids.length === 0));
  const contraparte = await entornoFuera.resolutor.proyectarContraparte({
    evento: eventos[0],
    contextoUsuarioActual: ctxFuera,
    visibilidadLote: lote
  });
  const causalidad = await entornoFuera.resolutor.proyectarCausalidad({
    evento: eventos[0],
    contextoUsuarioActual: ctxFuera,
    visibilidadLote: lote
  });
  assert.equal(contraparte, null);
  assert.equal(causalidad, null);
}

async function verificarIntegracionServicioSinFallbackNMasUno() {
  const eventos = crearEventos(100);
  const repositorio = new RepositorioServicioLote(eventos);
  const servicio = new ServicioLecturaAuditoria({
    repositorioLectura: repositorio,
    secretoCursores: 'secreto-proyeccion-lote-5-21-16g',
    resolutorVisibilidadCausal: new ResolutorVisibilidadCausalAuditoria({
      repositorioLectura: repositorio
    })
  });
  const resultado = await servicio.listarEventos({
    contextoUsuarioActual: contextoCompleto(),
    sesionActual: { sesionAuditoriaId: uuid(9000) },
    consulta: { limite: 100 }
  });
  assert.equal(resultado.eventos.length, 100);
  assert.equal(repositorio.consultasEventosLote, 1);
  assert.equal(repositorio.consultasPorTipo.size, 4);
  assert.equal([...repositorio.consultasPorTipo.values()].every((total) => total === 1), true);
  assert.equal(repositorio.consultasIndividuales, 0);
}

async function verificarLimiteDefensivo() {
  const entorno = crearEntornoSql();
  await assert.rejects(
    () => entorno.repositorio.eventosVisiblesPorIds({
      eventoIds: Array.from({ length: 201 }, (_, indice) => uuid(10000 + indice)),
      contextoUsuarioActual: contextoCompleto()
    }),
    /200 identidades/
  );
  assert.equal(entorno.instrumentado.obtenerTrazas().length, 0);
}

function crearEntornoSql({ tenantVisible = null } = {}) {
  const base = new ClienteSqlProyeccionFixture({ tenantVisible });
  const instrumentado = new ClienteSqlInstrumentadoAuditoria({ clienteSql: base });
  const repositorio = new RepositorioLecturaAuditoriaSql({ clienteSql: instrumentado });
  return {
    instrumentado,
    repositorio,
    resolutor: new ResolutorVisibilidadCausalAuditoria({ repositorioLectura: repositorio })
  };
}

class ClienteSqlProyeccionFixture {
  constructor({ tenantVisible }) {
    this.tenantVisible = tenantVisible;
  }

  async obtenerConexion() {
    return {
      execute: async (sql, parametros) => {
        const sentencia = String(sql);
        const cantidadIds = (sentencia.match(/\bIN\s*\(([^)]*)\)/i)?.[1].match(/\?/g) || []).length;
        const ids = parametros.slice(0, cantidadIds);
        if (this.tenantVisible != null && String(parametros.at(-1)) !== this.tenantVisible) {
          return [[], []];
        }
        if (sentencia.includes('FROM eventos_auditoria e')) {
          return [ids.map((evento_id) => ({ evento_id })), []];
        }
        return [ids.map((id_visible) => ({ id_visible })), []];
      },
      release() {}
    };
  }
}

class RepositorioServicioLote {
  constructor(eventos) {
    this.eventos = eventos;
    this.consultasEventosLote = 0;
    this.consultasPorTipo = new Map();
    this.consultasIndividuales = 0;
  }

  async listarEventos({ limite }) {
    return this.eventos.slice(0, Number(limite) + 1);
  }

  async contarEventos() {
    return this.eventos.length;
  }

  async eventosVisiblesPorIds({ eventoIds }) {
    this.consultasEventosLote += 1;
    return eventoIds;
  }

  async causalidadesVisiblesPorTipo({ tipo, ids }) {
    this.consultasPorTipo.set(tipo, (this.consultasPorTipo.get(tipo) || 0) + 1);
    return ids;
  }

  async eventoVisiblePorId() {
    this.consultasIndividuales += 1;
    throw new Error('No debe usarse la lectura individual de contraparte.');
  }

  async causalidadVisible() {
    this.consultasIndividuales += 1;
    throw new Error('No debe usarse la lectura individual de causalidad.');
  }
}

function crearEventos(tamano) {
  const tipos = [
    'evento_auditoria',
    'evento_monitor',
    'ejecucion_trigger',
    'operacion_sesion_agente',
    'generacion_dns'
  ];
  return Array.from({ length: tamano }, (_, indice) => {
    const tipo = tipos[indice % tipos.length];
    return Object.freeze({
      eventoId: uuid(indice + 1),
      eventoContraparteId: uuid(2000 + indice),
      tipoEvento: 'usuario.actualizado',
      versionContrato: 1,
      flujo: 'usuarios',
      claveCadena: 'usuarios:portal',
      secuencia: String(indice + 1),
      actorReal: Object.freeze({ tipo: 'usuario', id: '1' }),
      actorEfectivo: null,
      modoActuacion: 'directo',
      sujeto: Object.freeze({ tipo: 'usuario', id: String(indice + 1) }),
      origen: 'web',
      scope: Object.freeze({ tenantId: null, empresaId: null, sitioId: null }),
      correlacionId: uuid(8000),
      causalidadTipo: tipo,
      causalidadId: tipo === 'evento_auditoria'
        ? uuid(3000 + indice)
        : tipo === 'operacion_sesion_agente'
          ? uuid(4000 + indice)
          : String(5000 + indice),
      productor: 'portal_web',
      rolEvento: 'principal',
      efectivoEnUtc: fecha(indice),
      registradoEnUtc: fecha(indice),
      payload: Object.freeze({ resultado: 'actualizado' }),
      hashPayload: 'a'.repeat(64),
      hashAnterior: 'b'.repeat(64),
      hashActual: 'c'.repeat(64),
      versionCanonicalizador: 'sentinelia-auditoria-jcs-v1',
      versionEncadenado: 'sentinelia-auditoria-sha256-v1'
    });
  });
}

function contextoCompleto(sobrescribir = {}) {
  const permisosSobrescritos = sobrescribir.permisos || Object.fromEntries(
    Object.entries(sobrescribir).filter(([clave]) => clave.startsWith('ver'))
  );
  return {
    nivelScope: 'portal',
    tenantId: null,
    empresaId: null,
    sitioId: null,
    permisos: {
      verAuditoria: true,
      verMonitores: true,
      verTriggers: true,
      verAgentes: true,
      verDns: true,
      ...permisosSobrescritos
    },
    ...Object.fromEntries(
      Object.entries(sobrescribir).filter(([clave]) => clave !== 'permisos' && !clave.startsWith('ver'))
    )
  };
}

function uuid(numero) {
  return `018f8f70-7b5c-7a55-b32a-${Number(numero).toString(16).padStart(12, '0')}`;
}

function fecha(indice) {
  return new Date(Date.UTC(2026, 6, 25, 12, 0, 0, indice)).toISOString();
}

main().catch((error) => {
  console.error('[auditoria] ERROR 5.21.16g:', error);
  process.exitCode = 1;
});

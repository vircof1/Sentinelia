import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  ACTORES_AUDITORIA,
  CAUSALIDADES_AUDITORIA,
  FLUJOS_AUDITORIA,
  ORIGENES_AUDITORIA,
  SUJETOS_AUDITORIA,
  listarTiposEventoAuditoria
} from '../paquetes/auditoria/src/CatalogoAuditoria.js';
import {
  CODIGOS_ERROR_CONSULTA_AUDITORIA,
  CONTRATO_PARAMETROS_CONSULTA_AUDITORIA,
  CONTRATO_RESPUESTA_CONSULTA_AUDITORIA,
  LIMITE_MAXIMO_CONSULTA_AUDITORIA,
  LIMITE_POR_DEFECTO_CONSULTA_AUDITORIA,
  LIMITES_UX_CONSULTA_AUDITORIA,
  PARAMETROS_PROHIBIDOS_CONSULTA_AUDITORIA,
  VERSION_CONTRATO_CONSULTA_AUDITORIA,
  validarConsultaAuditoriaSegunContrato
} from '../paquetes/auditoria/src/ContratoConsultaAuditoria.js';

async function main() {
  verificarCoberturaParametros();
  verificarCatalogosCompartidos();
  verificarParejasYCoherencia();
  verificarFechasLimitesYUuid();
  verificarSuperficieCerradaYErrores();
  verificarRespuestaYPaginacion();
  await verificarFronteraDeImplementacion();
  console.log('[auditoria] OK 5.21.16a: contrato_consulta=v2 parametros=cerrados errores=publicos paginacion=eventos');
}

function verificarCoberturaParametros() {
  assert.equal(VERSION_CONTRATO_CONSULTA_AUDITORIA, 2);
  assert.equal(LIMITE_POR_DEFECTO_CONSULTA_AUDITORIA, 25);
  assert.equal(LIMITE_MAXIMO_CONSULTA_AUDITORIA, 100);
  assert.deepEqual(LIMITES_UX_CONSULTA_AUDITORIA, [10, 25, 50]);

  for (const [nombre, contrato] of Object.entries(CONTRATO_PARAMETROS_CONSULTA_AUDITORIA)) {
    assert.ok('ejemploValido' in contrato, `${nombre} carece de ejemplo válido`);
    assert.ok('ejemploInvalido' in contrato, `${nombre} carece de frontera inválida`);
    assert.ok('resultadoEsperado' in contrato, `${nombre} carece de resultado esperado`);
    assert.equal(contrato.validar(contrato.ejemploValido), true, `${nombre} rechaza su ejemplo válido`);
    assert.equal(contrato.validar(contrato.ejemploInvalido), false, `${nombre} acepta su frontera inválida`);
  }

  assert.equal(validarConsultaAuditoriaSegunContrato({}), true);
  assert.equal(validarConsultaAuditoriaSegunContrato({ limite: '100' }), true);
  assert.equal(validarConsultaAuditoriaSegunContrato({ limite: '101' }), true);
  assert.equal(CONTRATO_PARAMETROS_CONSULTA_AUDITORIA.limite.maximo, 100);
  assert.equal(CONTRATO_PARAMETROS_CONSULTA_AUDITORIA.limite.resultadoExceso, 100);
}

function verificarCatalogosCompartidos() {
  assert.strictEqual(CONTRATO_PARAMETROS_CONSULTA_AUDITORIA.flujo.valores, FLUJOS_AUDITORIA);
  assert.strictEqual(CONTRATO_PARAMETROS_CONSULTA_AUDITORIA.sujetoTipo.valores, SUJETOS_AUDITORIA);
  assert.strictEqual(CONTRATO_PARAMETROS_CONSULTA_AUDITORIA.actorTipo.valores, ACTORES_AUDITORIA);
  assert.strictEqual(CONTRATO_PARAMETROS_CONSULTA_AUDITORIA.origen.valores, ORIGENES_AUDITORIA);
  assert.strictEqual(CONTRATO_PARAMETROS_CONSULTA_AUDITORIA.causalidadTipo.valores, CAUSALIDADES_AUDITORIA);
  assert.deepEqual(CONTRATO_PARAMETROS_CONSULTA_AUDITORIA.tipoEvento.valores, listarTiposEventoAuditoria());

  for (const flujo of FLUJOS_AUDITORIA) {
    assert.equal(validarConsultaAuditoriaSegunContrato({ flujo }), true);
  }
  for (const tipoEvento of listarTiposEventoAuditoria()) {
    assert.equal(validarConsultaAuditoriaSegunContrato({ tipoEvento }), true);
  }
}

function verificarParejasYCoherencia() {
  assert.equal(validarConsultaAuditoriaSegunContrato({ sujetoTipo: 'usuario', sujetoId: '42' }), true);
  assert.equal(validarConsultaAuditoriaSegunContrato({
    actorRol: 'efectivo',
    actorTipo: 'usuario',
    actorId: '42',
    modoActuacion: 'impersonado'
  }), true);
  assert.equal(validarConsultaAuditoriaSegunContrato({
    causalidadTipo: 'evento_auditoria',
    causalidadId: UUID_V7
  }), true);
  assert.equal(validarConsultaAuditoriaSegunContrato({
    flujo: 'usuarios',
    claveCadena: 'usuarios:tenant:9'
  }), true);

  exigirError({ sujetoTipo: 'usuario' }, 'FILTROS_INCOMPATIBLES', 'sujetoTipo');
  exigirError({ sujetoId: '42' }, 'FILTROS_INCOMPATIBLES', 'sujetoTipo');
  exigirError({ causalidadTipo: 'evento_auditoria' }, 'FILTROS_INCOMPATIBLES', 'causalidadTipo');
  exigirError({ actorTipo: 'usuario', actorId: '42' }, 'FILTROS_INCOMPATIBLES', 'actorRol');
  exigirError({ actorRol: 'real' }, 'FILTROS_INCOMPATIBLES', 'actorRol');
  exigirError({ actorRol: 'efectivo', actorTipo: 'runtime', actorId: 'runtime' }, 'FILTROS_INCOMPATIBLES', 'actorTipo');
  exigirError({
    actorRol: 'efectivo', actorTipo: 'usuario', actorId: '42', modoActuacion: 'directo'
  }, 'FILTROS_INCOMPATIBLES', 'modoActuacion');
  exigirError({ flujo: 'dns', claveCadena: 'usuarios:portal' }, 'FILTROS_INCOMPATIBLES', 'claveCadena');
}

function verificarFechasLimitesYUuid() {
  assert.equal(validarConsultaAuditoriaSegunContrato({
    desdeUtc: '2026-07-20T00:00:00.000Z',
    hastaUtc: '2026-07-27T00:00:00Z',
    correlacionId: UUID_V7
  }), true);
  exigirError({ desdeUtc: '2026-07-28T00:00:00Z', hastaUtc: '2026-07-27T00:00:00Z' }, 'FILTROS_INCOMPATIBLES', 'desdeUtc');
  exigirError({ desdeUtc: '2026-07-20' }, 'FILTRO_INVALIDO', 'desdeUtc');
  exigirError({ desdeUtc: '2026-02-31T00:00:00Z' }, 'FILTRO_INVALIDO', 'desdeUtc');
  exigirError({ correlacionId: '01984f5a-9b8c-4def-8123-456789abcdef' }, 'FILTRO_INVALIDO', 'correlacionId');
  exigirError({ limite: '0' }, 'FILTRO_INVALIDO', 'limite');
  exigirError({ limite: 25 }, 'FILTRO_INVALIDO', 'limite');
  exigirError({ sujetoTipo: 'usuario', sujetoId: 'x'.repeat(192) }, 'FILTRO_INVALIDO', 'sujetoId');
  exigirError({ actorRol: 'real', actorTipo: 'usuario', actorId: 'x'.repeat(129) }, 'FILTRO_INVALIDO', 'actorId');
}

function verificarSuperficieCerradaYErrores() {
  assert.deepEqual(PARAMETROS_PROHIBIDOS_CONSULTA_AUDITORIA, [
    'resultado', 'estado', 'q', 'texto', 'busqueda', 'payload'
  ]);
  for (const campo of PARAMETROS_PROHIBIDOS_CONSULTA_AUDITORIA) {
    exigirError({ [campo]: 'dato' }, 'PARAMETRO_NO_ADMITIDO', campo);
  }
  exigirError({ desconocido: 'dato' }, 'PARAMETRO_NO_ADMITIDO', 'desconocido');
  exigirError({ flujo: ['usuarios', 'dns'] }, 'FILTRO_INVALIDO', 'flujo');
  exigirError({ cursor: 'sin-firma' }, 'CURSOR_INVALIDO', 'cursor');

  assert.deepEqual(Object.values(CODIGOS_ERROR_CONSULTA_AUDITORIA), [
    'FILTRO_AUDITORIA_INVALIDO',
    'FILTROS_AUDITORIA_INCOMPATIBLES',
    'PARAMETRO_AUDITORIA_NO_ADMITIDO',
    'CURSOR_AUDITORIA_INVALIDO',
    'CURSOR_AUDITORIA_INCOMPATIBLE'
  ]);
}

function verificarRespuestaYPaginacion() {
  assert.deepEqual(CONTRATO_RESPUESTA_CONSULTA_AUDITORIA.camposRaiz, [
    'eventos', 'paginacion', 'filtros', 'total'
  ]);
  assert.equal(CONTRATO_RESPUESTA_CONSULTA_AUDITORIA.paginacion.unidad, 'evento_visible');
  assert.deepEqual(CONTRATO_RESPUESTA_CONSULTA_AUDITORIA.paginacion.posicion, [
    'registradoEnUtc', 'eventoId'
  ]);
  assert.equal(CONTRATO_RESPUESTA_CONSULTA_AUDITORIA.paginacion.estrategia, 'cursor_firmado_sin_offset');
  assert.equal(CONTRATO_RESPUESTA_CONSULTA_AUDITORIA.agrupacionImplicita, false);
  assert.equal(Object.isFrozen(CONTRATO_PARAMETROS_CONSULTA_AUDITORIA), true);
  assert.equal(Object.isFrozen(CONTRATO_RESPUESTA_CONSULTA_AUDITORIA.paginacion.posicion), true);
}

async function verificarFronteraDeImplementacion() {
  const servicio = await readFile(
    new URL('../paquetes/auditoria/src/ServicioLecturaAuditoria.js', import.meta.url),
    'utf8'
  );
  assert.doesNotMatch(servicio, /ContratoConsultaAuditoria/);

  const rutas = await readFile(
    new URL('../apps/sentinelia-web/src/rutas/crearRutasPortal.js', import.meta.url),
    'utf8'
  );
  assert.doesNotMatch(rutas, /ContratoConsultaAuditoria/);
}

function exigirError(consulta, claveCodigo, campo) {
  assert.throws(
    () => validarConsultaAuditoriaSegunContrato(consulta),
    (error) => {
      assert.equal(error.statusCode, 400);
      assert.equal(error.codigo, CODIGOS_ERROR_CONSULTA_AUDITORIA[claveCodigo]);
      assert.equal(error.campo, campo);
      return true;
    }
  );
}

const UUID_V7 = '01984f5a-9b8c-7def-8123-456789abcdef';

main().catch((error) => {
  console.error('[auditoria] ERROR 5.21.16a:', error);
  process.exitCode = 1;
});

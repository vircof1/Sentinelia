import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import canonicalize from 'canonicalize';
import {
  CODIGOS_ERROR_CONSULTA_AUDITORIA
} from '../paquetes/auditoria/src/ContratoConsultaAuditoria.js';
import {
  construirIdentidadCursorAuditoriaV2,
  codificarCursorAuditoriaV2,
  decodificarCursorAuditoriaV2
} from '../paquetes/auditoria/src/CodecCursorConsultaAuditoria.js';
import {
  normalizarConsultaAuditoria
} from '../paquetes/auditoria/src/NormalizadorConsultaAuditoria.js';

async function main() {
  verificarNormalizacionCanonica();
  verificarIdentidadCanonica();
  verificarIdaYVueltaCursor();
  verificarAislamientoDeIdentidad();
  verificarModoCorrelacion();
  verificarRechazosCriptograficosYVersion();
  await verificarFronteraPura();
  console.log('[auditoria] OK 5.21.16b: normalizacion=canonica cursor=v2 firma=hmac identidad=completa');
}

function verificarNormalizacionCanonica() {
  const consultaA = normalizarConsultaAuditoria({
    hastaUtc: '2026-07-27T13:14:15Z',
    sujetoId: '42',
    flujo: 'usuarios',
    sujetoTipo: 'usuario',
    desdeUtc: '2026-07-20T00:00:00.1Z',
    limite: '250',
    orden: 'asc',
    incluirTotal: 'true'
  });
  const consultaB = normalizarConsultaAuditoria({
    incluirTotal: true,
    orden: 'asc',
    limite: '250',
    desdeUtc: '2026-07-20T00:00:00.100Z',
    sujetoTipo: 'usuario',
    flujo: 'usuarios',
    sujetoId: '42',
    hastaUtc: '2026-07-27T13:14:15.000Z'
  });
  assert.deepEqual(consultaA, consultaB);
  assert.deepEqual(consultaA, {
    filtros: {
      desdeUtc: '2026-07-20T00:00:00.100Z',
      hastaUtc: '2026-07-27T13:14:15.000Z',
      flujo: 'usuarios',
      sujetoTipo: 'usuario',
      sujetoId: '42'
    },
    orden: 'asc',
    limite: 100,
    incluirTotal: true,
    cursor: null
  });
  assert.deepEqual(normalizarConsultaAuditoria({}), {
    filtros: {},
    orden: 'desc',
    limite: 25,
    incluirTotal: false,
    cursor: null
  });
  assert.equal(Object.isFrozen(consultaA), true);
  assert.equal(Object.isFrozen(consultaA.filtros), true);
}

function verificarIdentidadCanonica() {
  const consulta = normalizarConsultaAuditoria({
    causalidadId: EVENTO_B,
    causalidadTipo: 'evento_auditoria',
    origen: 'web',
    limite: '50'
  });
  const identidadA = identidad({ consulta });
  const identidadB = identidad({
    consulta,
    contexto: crearContexto({ tenantId: 9 }),
    sesion: crearSesion({
      idUsuarioReal: 1,
      idUsuarioEfectivo: 2,
      versionSesionReal: 5,
      versionSesionEfectiva: 6
    })
  });
  assert.deepEqual(identidadA, identidadB);
  assert.equal(identidadA.v, 2);
  assert.equal(identidadA.modo, 'eventos');
  assert.equal(identidadA.consulta.correlacionId, null);
  assert.deepEqual(identidadA.consulta.filtros, consulta.filtros);
  assert.equal('incluirTotal' in identidadA.consulta, false);
  assert.equal('cursor' in identidadA.consulta, false);
  assert.equal(Object.isFrozen(identidadA.autorizacion.scope), true);
}

function verificarIdaYVueltaCursor() {
  const consulta = normalizarConsultaAuditoria({ flujo: 'dns', orden: 'desc', limite: '10' });
  const identidadActual = identidad({ consulta });
  const cursorA = codificarCursorAuditoriaV2({
    identidad: identidadActual,
    posicion: POSICION,
    secreto: SECRETO
  });
  const cursorB = codificarCursorAuditoriaV2({
    secreto: SECRETO,
    posicion: { eventoId: EVENTO_A, registradoEnUtc: POSICION.registradoEnUtc },
    identidad: identidadActual
  });
  assert.equal(cursorA, cursorB);
  assert.deepEqual(decodificarCursorAuditoriaV2({
    cursor: cursorA,
    identidad: identidadActual,
    secreto: SECRETO
  }), POSICION);

  const conTotal = normalizarConsultaAuditoria({ flujo: 'dns', orden: 'desc', limite: '10', incluirTotal: 'true' });
  assert.doesNotThrow(() => decodificarCursorAuditoriaV2({
    cursor: cursorA,
    identidad: identidad({ consulta: conTotal }),
    secreto: SECRETO
  }));
}

function verificarAislamientoDeIdentidad() {
  const consulta = normalizarConsultaAuditoria({ flujo: 'usuarios', limite: '25' });
  const base = identidad({ consulta });
  const cursor = codificarCursorAuditoriaV2({ identidad: base, posicion: POSICION, secreto: SECRETO });

  const variantes = [
    identidad({ consulta, sesion: crearSesion({ sesionAuditoriaId: SESION_B }) }),
    identidad({ consulta, sesion: crearSesion({ idUsuarioReal: '3' }) }),
    identidad({ consulta, sesion: crearSesion({ idUsuarioEfectivo: '3' }) }),
    identidad({ consulta, sesion: crearSesion({ versionSesionReal: '7' }) }),
    identidad({ consulta, sesion: crearSesion({ versionSesionEfectiva: '7' }) }),
    identidad({ consulta, contexto: crearContexto({ verAuditoria: false }) }),
    identidad({ consulta, contexto: crearContexto({ esOperadorSistema: true }) }),
    identidad({ consulta, contexto: crearContexto({ nivelScope: 'empresa', tenantId: 9, empresaId: 4 }) }),
    identidad({ consulta: normalizarConsultaAuditoria({ flujo: 'dns', limite: '25' }) }),
    identidad({ consulta: normalizarConsultaAuditoria({ flujo: 'usuarios', limite: '50' }) }),
    identidad({ consulta: normalizarConsultaAuditoria({ flujo: 'usuarios', limite: '25', orden: 'asc' }) })
  ];
  for (const variante of variantes) {
    exigirErrorCursor(
      () => decodificarCursorAuditoriaV2({ cursor, identidad: variante, secreto: SECRETO }),
      CODIGOS_ERROR_CONSULTA_AUDITORIA.CURSOR_INCOMPATIBLE
    );
  }
}

function verificarModoCorrelacion() {
  const consulta = normalizarConsultaAuditoria({ limite: '25', orden: 'asc' });
  const identidadCorrelacion = identidad({
    modo: 'correlacion',
    consulta,
    correlacionId: EVENTO_C
  });
  const cursor = codificarCursorAuditoriaV2({
    identidad: identidadCorrelacion,
    posicion: POSICION,
    secreto: SECRETO
  });
  assert.deepEqual(decodificarCursorAuditoriaV2({
    cursor,
    identidad: identidadCorrelacion,
    secreto: SECRETO
  }), POSICION);
  exigirErrorCursor(
    () => decodificarCursorAuditoriaV2({
      cursor,
      identidad: identidad({ consulta }),
      secreto: SECRETO
    }),
    CODIGOS_ERROR_CONSULTA_AUDITORIA.CURSOR_INCOMPATIBLE
  );
  exigirErrorCursor(
    () => decodificarCursorAuditoriaV2({
      cursor,
      identidad: identidad({ modo: 'correlacion', consulta, correlacionId: EVENTO_B }),
      secreto: SECRETO
    }),
    CODIGOS_ERROR_CONSULTA_AUDITORIA.CURSOR_INCOMPATIBLE
  );
}

function verificarRechazosCriptograficosYVersion() {
  const consulta = normalizarConsultaAuditoria({});
  const identidadActual = identidad({ consulta });
  const cursor = codificarCursorAuditoriaV2({ identidad: identidadActual, posicion: POSICION, secreto: SECRETO });
  const [cuerpo, firma] = cursor.split('.');
  const firmaAlterada = `${firma.slice(0, -1)}${firma.endsWith('A') ? 'B' : 'A'}`;
  exigirErrorCursor(
    () => decodificarCursorAuditoriaV2({ cursor: `${cuerpo}.${firmaAlterada}`, identidad: identidadActual, secreto: SECRETO }),
    CODIGOS_ERROR_CONSULTA_AUDITORIA.CURSOR_INVALIDO
  );
  exigirErrorCursor(
    () => decodificarCursorAuditoriaV2({ cursor, identidad: identidadActual, secreto: `${SECRETO}-distinto` }),
    CODIGOS_ERROR_CONSULTA_AUDITORIA.CURSOR_INVALIDO
  );

  const payloadV1 = { v: 1, identidad: { ...identidadActual, v: 1 }, posicion: POSICION };
  const cuerpoV1 = Buffer.from(canonicalize(payloadV1), 'utf8').toString('base64url');
  const cursorV1 = `${cuerpoV1}.${firmar(cuerpoV1)}`;
  exigirErrorCursor(
    () => decodificarCursorAuditoriaV2({ cursor: cursorV1, identidad: identidadActual, secreto: SECRETO }),
    CODIGOS_ERROR_CONSULTA_AUDITORIA.CURSOR_INVALIDO
  );

  const payloadPosicionInvalida = { v: 2, identidad: identidadActual, posicion: { ...POSICION, eventoId: 'uuid-invalido' } };
  const cuerpoInvalido = Buffer.from(canonicalize(payloadPosicionInvalida), 'utf8').toString('base64url');
  exigirErrorCursor(
    () => decodificarCursorAuditoriaV2({
      cursor: `${cuerpoInvalido}.${firmar(cuerpoInvalido)}`,
      identidad: identidadActual,
      secreto: SECRETO
    }),
    CODIGOS_ERROR_CONSULTA_AUDITORIA.CURSOR_INVALIDO
  );
}

async function verificarFronteraPura() {
  const servicio = await readFile(
    new URL('../paquetes/auditoria/src/ServicioLecturaAuditoria.js', import.meta.url),
    'utf8'
  );
  assert.doesNotMatch(servicio, /NormalizadorConsultaAuditoria|CodecCursorConsultaAuditoria/);
  const rutas = await readFile(
    new URL('../apps/sentinelia-web/src/rutas/crearRutasPortal.js', import.meta.url),
    'utf8'
  );
  assert.doesNotMatch(rutas, /NormalizadorConsultaAuditoria|CodecCursorConsultaAuditoria/);
}

function identidad({
  modo = 'eventos',
  consulta,
  contexto: contextoActual = crearContexto(),
  sesion: sesionActual = crearSesion(),
  correlacionId = null
}) {
  return construirIdentidadCursorAuditoriaV2({
    modo,
    contextoUsuarioActual: contextoActual,
    sesionActual,
    consultaNormalizada: consulta,
    correlacionId
  });
}

function crearContexto({
  nivelScope = 'tenant',
  tenantId = '9',
  empresaId = null,
  sitioId = null,
  verAuditoria = true,
  esOperadorSistema = false
} = {}) {
  return {
    idUsuario: '2',
    idUsuarioReal: '1',
    nivelScope,
    tenantId,
    empresaId,
    sitioId,
    esOperadorSistema,
    permisos: { verAuditoria }
  };
}

function crearSesion(cambios = {}) {
  return {
    sesionAuditoriaId: SESION_A,
    idUsuarioReal: '1',
    idUsuarioEfectivo: '2',
    versionSesionReal: '5',
    versionSesionEfectiva: '6',
    ...cambios
  };
}

function exigirErrorCursor(operacion, codigo) {
  assert.throws(operacion, (error) => {
    assert.equal(error.statusCode, 400);
    assert.equal(error.codigo, codigo);
    assert.equal(error.campo, 'cursor');
    return true;
  });
}

function firmar(cuerpo) {
  return createHmac('sha256', SECRETO).update(cuerpo).digest('base64url');
}

const SECRETO = 'secreto-estable-de-pruebas-5-21-16b';
const SESION_A = '018f8f70-7b5c-7a55-b32a-111111111111';
const SESION_B = '018f8f70-7b5c-7a55-b32a-222222222222';
const EVENTO_A = '018f8f70-7b5c-7a55-b32a-333333333333';
const EVENTO_B = '018f8f70-7b5c-7a55-b32a-444444444444';
const EVENTO_C = '018f8f70-7b5c-7a55-b32a-555555555555';
const POSICION = Object.freeze({
  registradoEnUtc: '2026-07-27T12:00:00.000Z',
  eventoId: EVENTO_A
});

main().catch((error) => {
  console.error('[auditoria] ERROR 5.21.16b:', error);
  process.exitCode = 1;
});

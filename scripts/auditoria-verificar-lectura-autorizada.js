import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  ServicioLecturaAuditoria,
  __testablesServicioLecturaAuditoria
} from '../paquetes/auditoria/src/ServicioLecturaAuditoria.js';
import { ResolutorVisibilidadCausalAuditoria } from '../paquetes/auditoria/src/ResolutorVisibilidadCausalAuditoria.js';

async function main() {
  await verificarPermisoObligatorio();
  await verificarProyeccionScopeParcial();
  await verificarCursorFirmado();
  await verificarContraparteYCausalidad();
  await verificarDiagnosticosSoloScopeCompleto();
  await verificarContratoSqlYRutas();
  console.log('[auditoria] OK 5.21.14a: lectura=autorizada scope=filtrado cursor=firmado causalidad=no_inferencia hashes=scope_completo');
}

async function verificarPermisoObligatorio() {
  const servicio = crearServicio();
  await assert.rejects(
    () => servicio.listarEventos({
      contextoUsuarioActual: contexto({ verAuditoria: false }),
      sesionActual: sesion(),
      consulta: {}
    }),
    /verAuditoria/
  );
}

async function verificarProyeccionScopeParcial() {
  const repositorio = new RepositorioFixture({
    eventos: [evento({ scope: { tenantId: '9', empresaId: '4', sitioId: null } })]
  });
  const servicio = crearServicio({ repositorio });
  const resultado = await servicio.listarEventos({
    contextoUsuarioActual: contexto({
      nivelScope: 'empresa',
      tenantId: '9',
      empresaId: '4',
      verAuditoria: true
    }),
    sesionActual: sesion(),
    consulta: { limite: 10 }
  });
  assert.equal(resultado.eventos.length, 1);
  assert.equal(resultado.eventos[0].eventoId, EVENTO_A);
  assert.equal('secuencia' in resultado.eventos[0], false);
  assert.equal('hashActual' in resultado.eventos[0], false);
  assert.equal('claveCadena' in resultado.eventos[0], false);
}

async function verificarCursorFirmado() {
  const repositorio = new RepositorioFixture({
    eventos: [
      evento({ eventoId: EVENTO_A, registradoEnUtc: '2026-07-25T12:00:02.000Z' }),
      evento({ eventoId: EVENTO_B, registradoEnUtc: '2026-07-25T12:00:01.000Z' })
    ]
  });
  const servicio = crearServicio({ repositorio });
  const ctx = contexto({ nivelScope: 'portal', verAuditoria: true });
  const primera = await servicio.listarEventos({
    contextoUsuarioActual: ctx,
    sesionActual: sesion(),
    consulta: { limite: 1, incluirTotal: true }
  });
  assert.equal(primera.total, 2);
  assert.equal(primera.paginacion.hayMas, true);
  assert.ok(primera.paginacion.siguienteCursor);
  await assert.rejects(
    () => servicio.listarEventos({
      contextoUsuarioActual: contexto({ nivelScope: 'tenant', tenantId: '9', verAuditoria: true }),
      sesionActual: sesion(),
      consulta: { cursor: primera.paginacion.siguienteCursor }
    }),
    /Cursor/
  );

  const identidad = __testablesServicioLecturaAuditoria.identidadCursor({
    contextoUsuarioActual: ctx,
    sesionActual: sesion(),
    filtros: {},
    orden: 'desc',
    limite: 50
  });
  const cursor = __testablesServicioLecturaAuditoria.codificarCursor({
    identidad,
    posicion: { registradoEnUtc: '2026-07-25T12:00:02.000Z', eventoId: EVENTO_A },
    secreto: SECRETO
  });
  assert.deepEqual(
    __testablesServicioLecturaAuditoria.decodificarCursor({
      cursor,
      identidad,
      secreto: SECRETO
    }),
    { registradoEnUtc: '2026-07-25T12:00:02.000Z', eventoId: EVENTO_A }
  );
}

async function verificarContraparteYCausalidad() {
  const repositorio = new RepositorioFixture({
    eventos: [
      evento({
        eventoId: EVENTO_A,
        eventoContraparteId: EVENTO_B,
        causalidadTipo: 'evento_auditoria',
        causalidadId: EVENTO_C
      })
    ],
    visibles: new Set([EVENTO_B])
  });
  const servicio = crearServicio({ repositorio });
  const resultado = await servicio.listarEventos({
    contextoUsuarioActual: contexto({ nivelScope: 'portal', verAuditoria: true }),
    sesionActual: sesion(),
    consulta: {}
  });
  assert.equal(resultado.eventos[0].eventoContraparteId, EVENTO_B);
  assert.equal('causalidad' in resultado.eventos[0], false);
}

async function verificarDiagnosticosSoloScopeCompleto() {
  const repositorio = new RepositorioFixture({
    diagnosticos: [{ claveCadena: 'sistema:portal', estadoVerificacion: 'integra' }]
  });
  const servicio = crearServicio({ repositorio });
  const resultado = await servicio.listarDiagnosticos({
    contextoUsuarioActual: contexto({ nivelScope: 'portal', verAuditoria: true }),
    consulta: { limite: 5 }
  });
  assert.equal(resultado.cadenas.length, 1);
  assert.equal(resultado.resumen.total, 1);
}

async function verificarContratoSqlYRutas() {
  const servicio = await readFile(
    new URL('../paquetes/auditoria/src/ServicioLecturaAuditoria.js', import.meta.url),
    'utf8'
  );
  assert.match(servicio, /createHmac\('sha256'/);
  assert.match(servicio, /sesionAuditoriaId/);
  assert.match(servicio, /versionSesionReal/);
  assert.match(servicio, /versionSesionEfectiva/);
  assert.match(servicio, /scopeHash/);
  assert.match(servicio, /filtro global .* no está permitido/i);
  assert.match(servicio, /tieneAlcanceCompletoCadena/);

  const repositorio = await readFile(
    new URL('../paquetes/auditoria/src/RepositorioLecturaAuditoriaSql.js', import.meta.url),
    'utf8'
  );
  assert.match(repositorio, /WHERE \$\{where\}/);
  assert.match(repositorio, /ORDER BY registrado_en_utc \$\{direccion\}, evento_id \$\{direccion\}/);
  assert.match(repositorio, /COUNT\(\*\) AS total/);
  assert.match(repositorio, /FROM diagnosticos_integridad_auditoria/);
  assert.match(repositorio, /eventoVisiblePorId/);
  assert.doesNotMatch(repositorio, /\bresultado\b\s*=/i);
  assert.doesNotMatch(repositorio, /\bestado\b\s*=/i);

  const resolutor = await readFile(
    new URL('../paquetes/auditoria/src/ResolutorVisibilidadCausalAuditoria.js', import.meta.url),
    'utf8'
  );
  assert.match(resolutor, /eventoVisiblePorId/);
  assert.match(resolutor, /PERMISO_POR_TIPO/);
  assert.match(resolutor, /causalidadVisible/);

  const rutas = await readFile(
    new URL('../apps/sentinelia-web/src/rutas/crearRutasPortal.js', import.meta.url),
    'utf8'
  );
  assert.match(rutas, /requerirVerAuditoria/);
  assert.match(rutas, /\/auditoria\/api\/eventos/);
  assert.match(rutas, /\/auditoria\/api\/diagnosticos/);
}

function crearServicio({ repositorio = new RepositorioFixture() } = {}) {
  return new ServicioLecturaAuditoria({
    repositorioLectura: repositorio,
    secretoCursores: SECRETO,
    resolutorVisibilidadCausal: new ResolutorVisibilidadCausalAuditoria({
      repositorioLectura: repositorio
    })
  });
}

class RepositorioFixture {
  constructor({ eventos = [evento()], diagnosticos = [], visibles = new Set() } = {}) {
    this.eventos = eventos;
    this.diagnosticos = diagnosticos;
    this.visibles = visibles;
  }

  async listarEventos({ limite }) {
    return this.eventos.slice(0, Number(limite) + 1);
  }

  async contarEventos() {
    return this.eventos.length;
  }

  async listarDiagnosticos() {
    return this.diagnosticos;
  }

  async eventoVisiblePorId({ eventoId }) {
    return this.visibles.has(eventoId);
  }

  async causalidadVisible({ id }) {
    return this.visibles.has(id);
  }
}

function evento({
  eventoId = EVENTO_A,
  eventoContraparteId = null,
  causalidadTipo = null,
  causalidadId = null,
  registradoEnUtc = '2026-07-25T12:00:00.000Z',
  scope = { tenantId: '9', empresaId: null, sitioId: null }
} = {}) {
  return {
    eventoId,
    eventoContraparteId,
    tipoEvento: 'usuario.actualizado',
    versionContrato: 1,
    flujo: 'usuarios',
    claveCadena: 'usuarios:tenant:9',
    secuencia: '7',
    actorReal: { tipo: 'usuario', id: '1' },
    actorEfectivo: null,
    modoActuacion: 'directo',
    sujeto: { tipo: 'usuario', id: '2' },
    origen: 'web',
    scope,
    correlacionId: EVENTO_C,
    causalidadTipo,
    causalidadId,
    productor: 'portal_web',
    rolEvento: 'principal',
    efectivoEnUtc: registradoEnUtc,
    registradoEnUtc,
    payload: { resultado: 'actualizado' },
    hashPayload: 'a'.repeat(64),
    hashAnterior: 'b'.repeat(64),
    hashActual: 'c'.repeat(64),
    versionCanonicalizador: 'sentinelia-auditoria-jcs-v1',
    versionEncadenado: 'sentinelia-auditoria-sha256-v1'
  };
}

function contexto({
  nivelScope = 'portal',
  tenantId = null,
  empresaId = null,
  sitioId = null,
  verAuditoria = true
} = {}) {
  return {
    idUsuario: '2',
    idUsuarioReal: '1',
    nivelScope,
    tenantId,
    empresaId,
    sitioId,
    permisos: { verAuditoria }
  };
}

function sesion() {
  return {
    sesionAuditoriaId: EVENTO_C,
    idUsuarioReal: '1',
    idUsuarioEfectivo: '2',
    versionSesionReal: '5',
    versionSesionEfectiva: '6'
  };
}

const SECRETO = 'secreto-estable-de-pruebas-5-21-14a';
const EVENTO_A = '018f8f70-7b5c-7a55-b32a-111111111111';
const EVENTO_B = '018f8f70-7b5c-7a55-b32a-222222222222';
const EVENTO_C = '018f8f70-7b5c-7a55-b32a-333333333333';

main().catch((error) => {
  console.error('[auditoria] Falló la verificación 5.21.14a');
  console.error(error);
  process.exitCode = 1;
});

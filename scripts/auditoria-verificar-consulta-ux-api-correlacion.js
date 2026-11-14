import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { ControladorAuditoria } from '../apps/sentinelia-web/src/controladores/ControladorAuditoria.js';
import {
  CODIGOS_ERROR_CONSULTA_AUDITORIA,
  CONTRATO_RESPUESTA_CONSULTA_AUDITORIA
} from '../paquetes/auditoria/src/ContratoConsultaAuditoria.js';
import { ServicioLecturaAuditoria } from '../paquetes/auditoria/src/ServicioLecturaAuditoria.js';

async function main() {
  await verificarPaginacionMasivaYAislamiento();
  await verificarCursoresIndependientes();
  await verificarContratoHttpYRuta();
  console.log('[auditoria] OK 5.21.16i: correlacion=paginada cursor=independiente scope=estricto total=nulo');
}

async function verificarPaginacionMasivaYAislamiento() {
  const correlacionId = uuid(8000);
  const repositorio = new RepositorioCorrelacionFixture([
    ...crearEventos(125, correlacionId, '9'),
    ...crearEventos(7, correlacionId, '10', 500),
    ...crearEventos(3, uuid(8001), '9', 700)
  ]);
  const servicio = crearServicio(repositorio);
  const contextoUsuarioActual = contexto();
  let cursor = null;
  const recibidos = [];
  const tamanos = [];
  do {
    const respuesta = await servicio.listarEventosCorrelacionados({
      contextoUsuarioActual,
      sesionActual: sesion(),
      correlacionId,
      consulta: { limite: '50', ...(cursor ? { cursor } : {}) }
    });
    assert.deepEqual(Object.keys(respuesta), CONTRATO_RESPUESTA_CONSULTA_AUDITORIA.camposRaiz);
    assert.equal('grupos' in respuesta, false);
    assert.deepEqual(respuesta.filtros, { correlacionId });
    assert.equal(respuesta.total, null);
    assert.ok(respuesta.eventos.every((evento) =>
      evento.correlacionId === correlacionId && evento.scope.tenantId === '9'
    ));
    tamanos.push(respuesta.eventos.length);
    recibidos.push(...respuesta.eventos);
    cursor = respuesta.paginacion.siguienteCursor;
  } while (cursor);

  assert.deepEqual(tamanos, [50, 50, 25]);
  assert.equal(recibidos.length, 125);
  assert.equal(new Set(recibidos.map(({ eventoId }) => eventoId)).size, 125);
  assert.equal(repositorio.llamadasConteo, 0);
  assert.equal(repositorio.llamadasPagina.length, 3);
  assert.ok(repositorio.llamadasPagina.every((llamada) =>
    llamada.contextoUsuarioActual === contextoUsuarioActual &&
    llamada.filtros.correlacionId === correlacionId &&
    Object.keys(llamada.filtros).length === 1
  ));

  const invisible = await servicio.listarEventosCorrelacionados({
    contextoUsuarioActual: contexto({ tenantId: '11' }),
    sesionActual: sesion(),
    correlacionId,
    consulta: {}
  });
  const inexistente = await servicio.listarEventosCorrelacionados({
    contextoUsuarioActual,
    sesionActual: sesion(),
    correlacionId: uuid(8999),
    consulta: {}
  });
  assert.deepEqual(invisible.eventos, inexistente.eventos);
  assert.equal(invisible.paginacion.hayMas, false);
  assert.equal(inexistente.paginacion.hayMas, false);
}

async function verificarCursoresIndependientes() {
  const correlacionA = uuid(8100);
  const correlacionB = uuid(8101);
  const repositorio = new RepositorioCorrelacionFixture(crearEventos(3, correlacionA, '9'));
  const servicio = crearServicio(repositorio);
  const primera = await servicio.listarEventosCorrelacionados({
    contextoUsuarioActual: contexto(),
    sesionActual: sesion(),
    correlacionId: correlacionA,
    consulta: { limite: '1' }
  });
  const cursor = primera.paginacion.siguienteCursor;

  await assert.rejects(
    () => servicio.listarEventosCorrelacionados({
      contextoUsuarioActual: contexto(),
      sesionActual: sesion(),
      correlacionId: correlacionB,
      consulta: { limite: '1', cursor }
    }),
    (error) => error.codigo === CODIGOS_ERROR_CONSULTA_AUDITORIA.CURSOR_INCOMPATIBLE
  );
  await assert.rejects(
    () => servicio.listarEventosCorrelacionados({
      contextoUsuarioActual: contexto({ tenantId: '10' }),
      sesionActual: sesion(),
      correlacionId: correlacionA,
      consulta: { limite: '1', cursor }
    }),
    (error) => error.codigo === CODIGOS_ERROR_CONSULTA_AUDITORIA.CURSOR_INCOMPATIBLE
  );
  await assert.rejects(
    () => servicio.listarEventos({
      contextoUsuarioActual: contexto(),
      sesionActual: sesion(),
      consulta: { limite: '1', cursor }
    }),
    (error) => error.codigo === CODIGOS_ERROR_CONSULTA_AUDITORIA.CURSOR_INCOMPATIBLE
  );
  assert.equal(repositorio.llamadasPagina.length, 1);
}

async function verificarContratoHttpYRuta() {
  const servicio = crearServicio(new RepositorioCorrelacionFixture([]));
  const controlador = new ControladorAuditoria({ servicioLecturaAuditoria: servicio });
  const invalida = new RespuestaFixture();
  await controlador.apiListarEventosCorrelacionados(
    requisicion({ correlacionId: 'no-es-uuid-v7' }),
    invalida,
    assert.fail
  );
  assert.equal(invalida.statusCode, 400);
  assert.equal(invalida.cuerpo.codigo, CODIGOS_ERROR_CONSULTA_AUDITORIA.FILTRO_INVALIDO);
  assert.equal(invalida.cuerpo.campo, 'correlacionId');

  const filtroAjeno = new RespuestaFixture();
  await controlador.apiListarEventosCorrelacionados(
    requisicion({ query: { incluirTotal: 'true' } }),
    filtroAjeno,
    assert.fail
  );
  assert.equal(filtroAjeno.statusCode, 400);
  assert.equal(filtroAjeno.cuerpo.codigo, CODIGOS_ERROR_CONSULTA_AUDITORIA.PARAMETRO_NO_ADMITIDO);
  assert.equal(filtroAjeno.cuerpo.campo, 'incluirTotal');

  const rutas = await readFile(
    new URL('../apps/sentinelia-web/src/rutas/crearRutasPortal.js', import.meta.url),
    'utf8'
  );
  assert.match(rutas, /'\/auditoria\/api\/' \+ 'correlaciones\/:correlacionId\/eventos'/);
  assert.match(
    rutas,
    /correlaciones\/:correlacionId\/eventos'[\s\S]*requerirAutenticacion[\s\S]*cargarContextoUsuario[\s\S]*requerirVerAuditoria[\s\S]*apiListarEventosCorrelacionados/
  );
}

class RepositorioCorrelacionFixture {
  constructor(eventos) {
    this.eventos = eventos;
    this.llamadasPagina = [];
    this.llamadasConteo = 0;
  }

  async listarPaginaEventos(entrada) {
    this.llamadasPagina.push(entrada);
    const visibles = this.eventos.filter((evento) =>
      evento.correlacionId === entrada.filtros.correlacionId &&
      evento.scope.tenantId === entrada.contextoUsuarioActual.tenantId
    );
    const inicio = entrada.cursor
      ? visibles.findIndex(({ eventoId }) => eventoId === entrada.cursor.eventoId) + 1
      : 0;
    const filas = visibles.slice(inicio, inicio + entrada.limite + 1);
    return {
      eventos: filas.slice(0, entrada.limite),
      hayMas: filas.length > entrada.limite,
      siguientePosicion: null
    };
  }

  async listarEventos() { return []; }

  async contarEventos() {
    this.llamadasConteo += 1;
    return this.eventos.length;
  }

  async eventosVisiblesPorIds() { return []; }

  async causalidadesVisiblesPorTipo() { return []; }
}

class RespuestaFixture {
  constructor() {
    this.statusCode = 200;
    this.cuerpo = null;
  }

  status(codigo) {
    this.statusCode = codigo;
    return this;
  }

  json(cuerpo) {
    this.cuerpo = cuerpo;
    return this;
  }
}

function crearServicio(repositorio) {
  return new ServicioLecturaAuditoria({
    repositorioLectura: repositorio,
    secretoCursores: SECRETO
  });
}

function crearEventos(cantidad, correlacionId, tenantId, desplazamiento = 0) {
  return Array.from({ length: cantidad }, (_, indice) =>
    evento(indice + desplazamiento + 1, correlacionId, tenantId)
  );
}

function evento(indice, correlacionId, tenantId) {
  const registradoEnUtc = new Date(Date.UTC(2026, 6, 27, 12) - indice * 1000).toISOString();
  return Object.freeze({
    eventoId: uuid(indice),
    eventoContraparteId: null,
    tipoEvento: 'usuario.sesion_iniciada',
    versionContrato: 1,
    flujo: 'usuarios',
    claveCadena: `usuarios:tenant:${tenantId}`,
    secuencia: String(indice),
    actorReal: Object.freeze({ tipo: 'usuario', id: '1' }),
    actorEfectivo: null,
    modoActuacion: 'directo',
    sujeto: Object.freeze({ tipo: 'usuario', id: '2' }),
    origen: 'web',
    scope: Object.freeze({ tenantId, empresaId: null, sitioId: null }),
    correlacionId,
    causalidadTipo: null,
    causalidadId: null,
    productor: 'portal_web',
    rolEvento: 'principal',
    efectivoEnUtc: registradoEnUtc,
    registradoEnUtc,
    payload: Object.freeze({ resultado: 'iniciada' }),
    hashPayload: 'a'.repeat(64),
    hashAnterior: 'b'.repeat(64),
    hashActual: 'c'.repeat(64),
    versionCanonicalizador: 'sentinelia-auditoria-jcs-v1',
    versionEncadenado: 'sentinelia-auditoria-sha256-v1'
  });
}

function contexto(sobrescribir = {}) {
  return {
    idUsuario: '2',
    idUsuarioReal: '1',
    nivelScope: 'tenant',
    tenantId: '9',
    empresaId: null,
    sitioId: null,
    permisos: { verAuditoria: true },
    ...sobrescribir
  };
}

function sesion() {
  return {
    sesionAuditoriaId: SESION_ID,
    idUsuarioReal: '1',
    idUsuarioEfectivo: '2',
    versionSesionReal: '5',
    versionSesionEfectiva: '6'
  };
}

function requisicion({ correlacionId = uuid(8000), query = {} } = {}) {
  return {
    params: { correlacionId },
    query,
    contextoUsuarioActual: contexto(),
    sesionWebAuditoria: {
      sesionAuditoriaId: SESION_ID,
      usuarioRealId: '1',
      usuarioEfectivoId: '2',
      versionSesionReal: '5',
      versionSesionEfectiva: '6'
    },
    session: { usuarioAutenticado: {} }
  };
}

function uuid(numero) {
  return `018f8f70-7b5c-7a55-b32a-${Number(numero).toString(16).padStart(12, '0')}`;
}

const SECRETO = 'secreto-estable-api-correlacion-5-21-16i';
const SESION_ID = uuid(9000);

main().catch((error) => {
  console.error('[auditoria] ERROR 5.21.16i:', error);
  process.exitCode = 1;
});

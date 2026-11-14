import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { ControladorAuditoria } from '../apps/sentinelia-web/src/controladores/ControladorAuditoria.js';
import {
  CODIGOS_ERROR_CONSULTA_AUDITORIA,
  CONTRATO_RESPUESTA_CONSULTA_AUDITORIA
} from '../paquetes/auditoria/src/ContratoConsultaAuditoria.js';
import { ServicioLecturaAuditoria } from '../paquetes/auditoria/src/ServicioLecturaAuditoria.js';

async function main() {
  await verificarRespuestaPlanaYCursorV2();
  await verificarTotalExplicitoYLimiteDefensivo();
  await verificarMinimizacionYProyeccionLote();
  await verificarErroresPublicosDelControlador();
  await verificarFronteraDeRutaYUnidad();
  console.log('[auditoria] OK 5.21.16h: api=eventos_v2 plana=si limite=25 cursor=firmado errores=400 scope=sql');
}

async function verificarRespuestaPlanaYCursorV2() {
  const repositorio = new RepositorioApiFixture(crearEventos(26));
  const servicio = crearServicio(repositorio);
  const consulta = consultaCompleta();
  const ctx = contexto();
  const primera = await servicio.listarEventos({
    contextoUsuarioActual: ctx,
    sesionActual: sesion(),
    consulta
  });

  assert.deepEqual(Object.keys(primera), CONTRATO_RESPUESTA_CONSULTA_AUDITORIA.camposRaiz);
  assert.equal('grupos' in primera, false);
  assert.equal(primera.eventos.length, 25);
  assert.deepEqual(Object.keys(primera.paginacion),
    CONTRATO_RESPUESTA_CONSULTA_AUDITORIA.paginacion.campos);
  assert.deepEqual(primera.paginacion, {
    orden: 'desc',
    limite: 25,
    siguienteCursor: primera.paginacion.siguienteCursor,
    hayMas: true
  });
  assert.match(primera.paginacion.siguienteCursor, /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
  assert.equal(primera.total, null);
  assert.deepEqual(primera.filtros, filtrosEsperados());
  assert.equal(repositorio.llamadasPagina.length, 1);
  assert.equal(repositorio.llamadasListadoLegado, 0);
  assert.equal(repositorio.llamadasGrupos, 0);
  assert.equal(repositorio.llamadasConteo, 0);
  assert.equal(repositorio.llamadasPagina[0].contextoUsuarioActual, ctx);
  assert.deepEqual(repositorio.llamadasPagina[0].filtros, filtrosEsperados());
  assert.equal(repositorio.llamadasPagina[0].cursor, null);

  const segunda = await servicio.listarEventos({
    contextoUsuarioActual: ctx,
    sesionActual: sesion(),
    consulta: { ...consulta, cursor: primera.paginacion.siguienteCursor }
  });
  assert.equal(segunda.eventos.length, 1);
  assert.equal(segunda.paginacion.hayMas, false);
  assert.equal(segunda.paginacion.siguienteCursor, null);
  assert.deepEqual(repositorio.llamadasPagina[1].cursor, {
    registradoEnUtc: primera.eventos.at(-1).registradoEnUtc,
    eventoId: primera.eventos.at(-1).eventoId
  });

  await assert.rejects(
    () => servicio.listarEventos({
      contextoUsuarioActual: { ...ctx, nivelScope: 'tenant', tenantId: '9' },
      sesionActual: sesion(),
      consulta: { ...consulta, cursor: primera.paginacion.siguienteCursor }
    }),
    (error) => error.codigo === CODIGOS_ERROR_CONSULTA_AUDITORIA.CURSOR_INCOMPATIBLE
  );
  assert.equal(repositorio.llamadasPagina.length, 2);
}

async function verificarTotalExplicitoYLimiteDefensivo() {
  const repositorio = new RepositorioApiFixture(crearEventos(130), { excederLimite: true });
  const servicio = crearServicio(repositorio);
  const resultado = await servicio.listarEventos({
    contextoUsuarioActual: contexto(),
    sesionActual: sesion(),
    consulta: { limite: '999', incluirTotal: 'true' }
  });
  assert.equal(resultado.paginacion.limite, 100);
  assert.equal(resultado.eventos.length, 100);
  assert.equal(resultado.total, 130);
  assert.equal(repositorio.llamadasConteo, 1);
  assert.equal(repositorio.llamadasPagina[0].limite, 100);
}

async function verificarMinimizacionYProyeccionLote() {
  const eventoEmpresa = evento(1, {
    scope: { tenantId: '9', empresaId: '4', sitioId: null },
    eventoContraparteId: uuid(7000),
    causalidadTipo: 'evento_auditoria',
    causalidadId: uuid(7001)
  });
  const repositorio = new RepositorioApiFixture([eventoEmpresa]);
  const resultado = await crearServicio(repositorio).listarEventos({
    contextoUsuarioActual: contexto({
      nivelScope: 'empresa', tenantId: '9', empresaId: '4'
    }),
    sesionActual: sesion(),
    consulta: {}
  });
  const proyectado = resultado.eventos[0];
  assert.equal('claveCadena' in proyectado, false);
  assert.equal('secuencia' in proyectado, false);
  assert.equal('hashActual' in proyectado, false);
  assert.equal(proyectado.eventoContraparteId, uuid(7000));
  assert.deepEqual(proyectado.causalidad, {
    tipo: 'evento_auditoria',
    id: uuid(7001)
  });
  assert.equal(repositorio.llamadasEventosVisiblesLote, 1);
  assert.equal(repositorio.llamadasVisibilidadIndividual, 0);
}

async function verificarErroresPublicosDelControlador() {
  const repositorio = new RepositorioApiFixture(crearEventos(1));
  const controlador = new ControladorAuditoria({
    servicioLecturaAuditoria: crearServicio(repositorio)
  });
  const respuesta = new RespuestaFixture();
  let errorDelegado = null;
  await controlador.apiListarEventos(
    requisicion({ query: { q: 'texto libre' } }),
    respuesta,
    (error) => { errorDelegado = error; }
  );
  assert.equal(errorDelegado, null);
  assert.equal(respuesta.statusCode, 400);
  assert.deepEqual(respuesta.cuerpo, {
    ok: false,
    codigo: CODIGOS_ERROR_CONSULTA_AUDITORIA.PARAMETRO_NO_ADMITIDO,
    campo: 'q',
    mensaje: 'El parámetro q no forma parte del contrato de consulta.'
  });

  const respuestaCursor = new RespuestaFixture();
  await controlador.apiListarEventos(
    requisicion({ query: { cursor: 'eA.eA' } }),
    respuestaCursor,
    (error) => { errorDelegado = error; }
  );
  assert.equal(errorDelegado, null);
  assert.equal(respuestaCursor.statusCode, 400);
  assert.equal(respuestaCursor.cuerpo.codigo, CODIGOS_ERROR_CONSULTA_AUDITORIA.CURSOR_INVALIDO);
  assert.equal(respuestaCursor.cuerpo.campo, 'cursor');

  const servicioRoto = {
    async listarEventos() { throw new Error('fallo interno'); },
    async listarDiagnosticos() { return {}; }
  };
  const controladorRoto = new ControladorAuditoria({ servicioLecturaAuditoria: servicioRoto });
  await controladorRoto.apiListarEventos(
    requisicion(),
    new RespuestaFixture(),
    (error) => { errorDelegado = error; }
  );
  assert.equal(errorDelegado.message, 'fallo interno');
}

async function verificarFronteraDeRutaYUnidad() {
  const [servicio, coordinador, controlador, rutas] = await Promise.all([
    leer('../paquetes/auditoria/src/ServicioLecturaAuditoria.js'),
    leer('../paquetes/auditoria/src/ConsultaEventosAuditoriaV2.js'),
    leer('../apps/sentinelia-web/src/controladores/ControladorAuditoria.js'),
    leer('../apps/sentinelia-web/src/rutas/crearRutasPortal.js')
  ]);
  assert.match(coordinador, /listarPaginaEventos/);
  assert.ok(
    servicio.indexOf('if (admiteConsultaEventosAuditoriaV2(this.repositorioLectura))') <
      servicio.indexOf('if (this.repositorioLectura.listarClavesCorrelacion)'),
    'El camino plano v2 debe gobernar antes que la compatibilidad agrupada.'
  );
  assert.match(controlador, /instanceof ErrorContratoConsultaAuditoria/);
  assert.match(
    rutas,
    /\/auditoria\/api\/eventos'[\s\S]*requerirAutenticacion[\s\S]*cargarContextoUsuario[\s\S]*requerirVerAuditoria[\s\S]*apiListarEventos/
  );
  assert.doesNotMatch(rutas, /\/auditoria\/api\/correlaciones\/:correlacionId\/eventos/);
}

function crearServicio(repositorio) {
  return new ServicioLecturaAuditoria({
    repositorioLectura: repositorio,
    secretoCursores: SECRETO
  });
}

class RepositorioApiFixture {
  constructor(eventos, { excederLimite = false } = {}) {
    this.eventos = eventos;
    this.excederLimite = excederLimite;
    this.llamadasPagina = [];
    this.llamadasListadoLegado = 0;
    this.llamadasGrupos = 0;
    this.llamadasConteo = 0;
    this.llamadasEventosVisiblesLote = 0;
    this.llamadasVisibilidadIndividual = 0;
  }

  async listarPaginaEventos(entrada) {
    this.llamadasPagina.push(entrada);
    const inicio = entrada.cursor
      ? this.eventos.findIndex((actual) => actual.eventoId === entrada.cursor.eventoId) + 1
      : 0;
    const extra = this.excederLimite ? 1 : 0;
    const eventos = this.eventos.slice(inicio, inicio + entrada.limite + extra);
    return {
      eventos,
      hayMas: inicio + eventos.length < this.eventos.length || eventos.length > entrada.limite,
      siguientePosicion: null
    };
  }

  async listarEventos() {
    this.llamadasListadoLegado += 1;
    throw new Error('El endpoint v2 no debe usar listarEventos().');
  }

  async listarClavesCorrelacion() {
    this.llamadasGrupos += 1;
    throw new Error('El endpoint v2 no debe agrupar correlaciones.');
  }

  async contarEventos() {
    this.llamadasConteo += 1;
    return this.eventos.length;
  }

  async eventosVisiblesPorIds({ eventoIds }) {
    this.llamadasEventosVisiblesLote += 1;
    return eventoIds;
  }

  async causalidadesVisiblesPorTipo({ ids }) {
    return ids;
  }

  async eventoVisiblePorId() {
    this.llamadasVisibilidadIndividual += 1;
    return true;
  }

  async causalidadVisible() {
    this.llamadasVisibilidadIndividual += 1;
    return true;
  }
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

function requisicion({ query = {} } = {}) {
  return {
    query,
    contextoUsuarioActual: contexto(),
    sesionWebAuditoria: {
      sesionAuditoriaId: SESION_ID,
      usuarioRealId: '1',
      usuarioEfectivoId: '2',
      versionSesionReal: '5',
      versionSesionEfectiva: '6'
    },
    session: {
      usuarioAutenticado: {
        idUsuarioReal: '1',
        idUsuarioEfectivo: '2',
        versionSesionReal: '5',
        versionSesionEfectiva: '6'
      }
    }
  };
}

function consultaCompleta() {
  return {
    limite: '25',
    orden: 'desc',
    desdeUtc: '2026-07-20T00:00:00Z',
    hastaUtc: '2026-07-27T23:59:59.999Z',
    flujo: 'usuarios',
    tipoEvento: 'usuario.sesion_iniciada',
    sujetoTipo: 'usuario',
    sujetoId: '2',
    actorRol: 'real',
    actorTipo: 'usuario',
    actorId: '1',
    modoActuacion: 'directo',
    origen: 'web',
    claveCadena: 'usuarios:tenant:9',
    correlacionId: uuid(8000),
    causalidadTipo: 'evento_monitor',
    causalidadId: '501'
  };
}

function filtrosEsperados() {
  const { limite: _limite, orden: _orden, ...filtros } = consultaCompleta();
  return {
    ...filtros,
    desdeUtc: '2026-07-20T00:00:00.000Z'
  };
}

function crearEventos(cantidad) {
  return Array.from({ length: cantidad }, (_, indice) => evento(indice + 1));
}

function evento(indice, sobrescribir = {}) {
  const registradoEnUtc = new Date(Date.UTC(2026, 6, 27, 12, 0, 0) - indice * 1000).toISOString();
  return Object.freeze({
    eventoId: uuid(indice),
    eventoContraparteId: null,
    tipoEvento: 'usuario.sesion_iniciada',
    versionContrato: 1,
    flujo: 'usuarios',
    claveCadena: 'usuarios:tenant:9',
    secuencia: String(indice),
    actorReal: Object.freeze({ tipo: 'usuario', id: '1' }),
    actorEfectivo: null,
    modoActuacion: 'directo',
    sujeto: Object.freeze({ tipo: 'usuario', id: '2' }),
    origen: 'web',
    scope: Object.freeze({ tenantId: '9', empresaId: null, sitioId: null }),
    correlacionId: uuid(8000),
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
    versionEncadenado: 'sentinelia-auditoria-sha256-v1',
    ...sobrescribir
  });
}

function contexto(sobrescribir = {}) {
  return {
    idUsuario: '2',
    idUsuarioReal: '1',
    nivelScope: 'portal',
    tenantId: null,
    empresaId: null,
    sitioId: null,
    esOperadorSistema: true,
    permisos: {
      verAuditoria: true,
      verMonitores: true,
      verTriggers: true,
      verAgentes: true,
      verDns: true
    },
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

function uuid(numero) {
  return `018f8f70-7b5c-7a55-b32a-${Number(numero).toString(16).padStart(12, '0')}`;
}

function leer(ruta) {
  return readFile(new URL(ruta, import.meta.url), 'utf8');
}

const SECRETO = 'secreto-estable-api-eventos-5-21-16h';
const SESION_ID = uuid(9000);

main().catch((error) => {
  console.error('[auditoria] ERROR 5.21.16h:', error);
  process.exitCode = 1;
});

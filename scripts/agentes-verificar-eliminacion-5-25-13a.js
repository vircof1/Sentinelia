import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import express from 'express';

import { ControladorEliminacionAdministrativaAgentes }
  from '../apps/sentinelia-web/src/controladores/ControladorEliminacionAdministrativaAgentes.js';
import { crearMiddlewareRequerirCapacidadEliminacionAdministrativaAgentes }
  from '../apps/sentinelia-web/src/middleware/requerirCapacidadEliminacionAdministrativaAgentes.js';
import { crearMiddlewareValidarCsrfPortal }
  from '../apps/sentinelia-web/src/middleware/validarCsrfPortal.js';
import { crearRutasPortal }
  from '../apps/sentinelia-web/src/rutas/crearRutasPortal.js';
import { ServicioBuzonNotificacionesUsuario }
  from '../paquetes/agentes/src/ServicioBuzonNotificacionesUsuario.js';
import { crearCatalogoResolutoresSujetosAgenteNotificaciones }
  from '../paquetes/agentes/src/ResolutorSujetosAgenteNotificaciones.js';
import { ServicioConsultaOperacionesAdministrativas }
  from '../paquetes/coordinacion-durable/src/ServicioConsultaOperacionesAdministrativas.js';
import { ProyectorConsultaOperacionEliminacionAgente }
  from '../paquetes/agentes/src/ProyectorConsultaOperacionEliminacionAgente.js';
import { CatalogoProyectoresConsultaOperacionesAdministrativas }
  from '../paquetes/coordinacion-durable/src/CatalogoProyectoresConsultaOperacionesAdministrativas.js';
import { obtenerConfiguracionAplicacion }
  from '../paquetes/utilidades/src/configuracion/obtenerConfiguracionAplicacion.js';

const OPERACION_ID = '018f7f40-1111-7111-8111-111111111111';
const NOTIFICACION_ID = '018f7f40-2222-7222-8222-222222222222';

async function main() {
  verificarCapacidadApagada();
  await verificarRutasApagadasEnExpress();
  verificarCsrf();
  await verificarControladorPrivado();
  await verificarConsultaConScopeActual();
  await verificarBuzonSinSocket();
  await verificarSuperficieEstatica();

  console.log(
    '[agentes] OK 5.25.13a: gate=apagado_por_defecto rutas=privadas ' +
    'csrf=obligatorio impersonacion=doble_actor aceptacion=202 replay=202 ' +
    'operacion=scope_actual buzon=paginado lectura=idempotente socket=opcional ' +
    'salida=saneada openapi_agente=intacto'
  );
}

async function verificarRutasApagadasEnExpress() {
  const controlador = new Proxy({}, {
    get() { return function adaptadorNoInvocable() {}; }
  });
  const servicioSesion = {
    async validarVersionSesion() { return false; },
    async destruirSesion() {}
  };
  const aplicacion = express();
  aplicacion.use(express.json());
  aplicacion.use(crearRutasPortal({
    controladorLogin: controlador,
    controladorPortal: controlador,
    controladorOrganizacion: controlador,
    controladorUsuarios: controlador,
    controladorImpersonacion: controlador,
    controladorMonitores: controlador,
    controladorTriggers: controlador,
    controladorDns: controlador,
    controladorAgentes: controlador,
    controladorEliminacionAdministrativaAgentes: controlador,
    controladorEliminacionAdministrativaOrganizaciones: controlador,
    controladorReglasDerivacionTelemetria: controlador,
    controladorAuditoria: controlador,
    controladorFederacion: controlador,
    controladorPow: controlador,
    controladorDesuscripcionTriggerCorreo: controlador,
    servicioSesion,
    servicioContextoUsuario: { async cargarDesdeSesion() { return null; } },
    servicioAutorizacion: { resolverPermiso() { return false; } },
    eliminacionAdministrativaAgentesHttpHabilitada: false
  }));
  const servidor = await new Promise((resolve) => {
    const activo = aplicacion.listen(0, '127.0.0.1', () => resolve(activo));
  });
  try {
    const puerto = servidor.address().port;
    for (const [metodo, ruta] of [
      ['GET', '/agentes/9/eliminar'],
      ['POST', '/agentes/9/eliminar'],
      ['GET', `/api/operaciones-administrativas/${OPERACION_ID}`],
      ['GET', `/operaciones-administrativas/${OPERACION_ID}`],
      ['GET', '/buzon/api/notificaciones'],
      ['GET', '/buzon/api/contador'],
      ['POST', `/buzon/api/notificaciones/${NOTIFICACION_ID}/leer`]
    ]) {
      const respuesta = await fetch(`http://127.0.0.1:${puerto}${ruta}`, {
        method: metodo,
        headers: { accept: 'application/json' }
      });
      assert.equal(respuesta.status, 404, `${metodo} ${ruta} debe quedar oculta.`);
      assert.equal((await respuesta.json()).codigo, 'recurso_no_encontrado');
    }
  } finally {
    await new Promise((resolve, reject) => servidor.close((error) =>
      error ? reject(error) : resolve()));
  }
}

function verificarCapacidadApagada() {
  const nombre = 'AGENTES_ELIMINACION_ADMINISTRATIVA_HTTP_HABILITADA';
  const anterior = process.env[nombre];
  delete process.env[nombre];
  try {
    assert.equal(
      obtenerConfiguracionAplicacion().agentes
        .eliminacionAdministrativaHttpHabilitada,
      false
    );
  } finally {
    if (anterior === undefined) delete process.env[nombre];
    else process.env[nombre] = anterior;
  }

  let siguiente = false;
  const apagada = crearMiddlewareRequerirCapacidadEliminacionAdministrativaAgentes();
  const respuesta = crearRespuesta();
  apagada({}, respuesta, () => { siguiente = true; });
  assert.equal(siguiente, false);
  assert.equal(respuesta.statusCode, 404);
  assert.deepEqual(respuesta.cuerpo, {
    ok: false,
    codigo: 'recurso_no_encontrado',
    mensaje: 'El recurso solicitado no está disponible.'
  });

  const encendida = crearMiddlewareRequerirCapacidadEliminacionAdministrativaAgentes({
    habilitada: true
  });
  encendida({}, crearRespuesta(), () => { siguiente = true; });
  assert.equal(siguiente, true);
}

function verificarCsrf() {
  const middleware = crearMiddlewareValidarCsrfPortal();
  const base = {
    method: 'POST',
    session: { usuarioAutenticado: { tokenCSRF: 'csrf-fixture-seguro' } },
    body: {},
    get(nombre) {
      if (nombre === 'accept') return 'application/json';
      return '';
    }
  };
  const denegada = crearRespuesta();
  middleware(base, denegada, () => assert.fail('CSRF ausente no debe continuar.'));
  assert.equal(denegada.statusCode, 403);

  let aceptada = false;
  middleware(
    { ...base, body: { tokenCSRF: 'csrf-fixture-seguro' } },
    crearRespuesta(),
    () => { aceptada = true; }
  );
  assert.equal(aceptada, true);
}

async function verificarControladorPrivado() {
  const llamadas = [];
  let aceptaciones = 0;
  const controlador = new ControladorEliminacionAdministrativaAgentes({
    servicioImpacto: {
      async preparar(entrada) {
        llamadas.push(['impacto', entrada]);
        return {
          sujeto: { tipo: 'agente', id: '9', guid: 'guid-publico' },
          resumenImpacto: { observaciones: '42' },
          fraseConfirmacion: 'Montessori abcdef12',
          tokenConfirmacion: 'token-opaco-confirmacion',
          expiraEnUtc: '2026-08-30T12:10:00.000Z'
        };
      }
    },
    servicioAceptacion: {
      async aceptar(entrada) {
        llamadas.push(['aceptacion', entrada]);
        aceptaciones += 1;
        return {
          codigo: aceptaciones === 1
            ? 'agente_eliminacion_encolada'
            : 'agente_eliminacion_repetida',
          repetida: aceptaciones > 1,
          operacionId: OPERACION_ID,
          estado: 'encolada'
        };
      }
    },
    servicioConsultaOperaciones: {
      async obtener() {
        return { operacionId: OPERACION_ID, estado: 'encolada' };
      }
    },
    servicioBuzon: {
      async listar(_contexto, opciones) {
        llamadas.push(['listar', opciones]);
        return { notificaciones: [], paginacion: {}, noLeidas: 0 };
      },
      async resumir() {
        return { noLeidas: 0, firma: 'a'.repeat(64), actualizadaEnUtc: null };
      },
      async marcarLeida() {
        return { cambioEfectivo: false, notificacionId: NOTIFICACION_ID };
      }
    }
  });
  const requisicion = {
    params: { id: '9' },
    query: {},
    body: {
      tokenConfirmacion: 'token-opaco-confirmacion',
      fraseConfirmacion: 'Montessori abcdef12'
    },
    contextoUsuarioActual: { idUsuario: 22, idUsuarioReal: 11 },
    session: { usuarioAutenticado: { tokenCSRF: 'csrf-fixture-seguro' } }
  };

  const impacto = crearRespuesta();
  await controlador.obtenerImpacto(requisicion, impacto, assert.ifError);
  assert.equal(impacto.statusCode, 200);
  assert.deepEqual(llamadas[0][1], {
    actorRealId: 11,
    actorEfectivoId: 22,
    agenteId: '9',
    csrfToken: 'csrf-fixture-seguro'
  });
  assert.equal(JSON.stringify(impacto.cuerpo).includes('csrf-fixture-seguro'), false);

  for (const repetida of [false, true]) {
    const respuesta = crearRespuesta();
    await controlador.aceptar(requisicion, respuesta, assert.ifError);
    assert.equal(respuesta.statusCode, 202);
    assert.equal(respuesta.cuerpo.repetida, repetida);
    const serializado = JSON.stringify(respuesta.cuerpo);
    assert.equal(serializado.includes('token-opaco-confirmacion'), false);
    assert.equal(serializado.includes('Montessori abcdef12'), false);
    assert.equal(serializado.includes('csrf-fixture-seguro'), false);
  }

  const buzon = crearRespuesta();
  await controlador.listarBuzon(
    { ...requisicion, query: { limite: '37', cursor: 'cursor-opaco' } },
    buzon,
    assert.ifError
  );
  assert.deepEqual(llamadas.at(-1)[1], { limite: 37, cursor: 'cursor-opaco' });
}

async function verificarConsultaConScopeActual() {
  let situacion = null;
  let consultasPostcommit = 0;
  const operacion = {
    operacionId: OPERACION_ID,
    tipo: 'eliminar_agente',
    version: 1,
    sujeto: {
      tipo: 'agente',
      id: '9',
      guid: '01234567-89ab-4def-8abc-0123456789ab',
      scope: { nivel: 'sitio', tenantId: '1', empresaId: '2', sitioId: '3' }
    },
    estado: 'ejecutando',
    fase: 'eliminacion',
    intentos: 1,
    maxIntentos: 3,
    terminal: false,
    resultado: null,
    ultimoError: null,
    creadaEnUtc: '2026-08-30T12:00:00.000Z',
    actualizadaEnUtc: '2026-08-30T12:01:00.000Z',
    terminadaEnUtc: null
  };
  const autorizacion = {
    puedeEliminarAgentes(contexto) { return contexto.permitido === true; }
  };
  const servicio = new ServicioConsultaOperacionesAdministrativas({
    repositorioOperaciones: { async buscarPorId() { return operacion; } },
    repositorioObligaciones: {
      async obtenerSituacionPorOperacion() {
        consultasPostcommit += 1;
        return situacion;
      }
    },
    catalogoProyectores: new CatalogoProyectoresConsultaOperacionesAdministrativas({
      proyectores: [new ProyectorConsultaOperacionEliminacionAgente({
        repositorioAgentes: {
          async buscarPorId() {
            return {
              id: 9,
              guid: operacion.sujeto.guid,
              nombre: 'Montessori',
              tenantId: 1,
              empresaId: 2,
              sitioId: 3
            };
          }
        },
        servicioAutorizacion: autorizacion
      })]
    })
  });
  const visible = await servicio.obtener({
    permitido: true,
    nivelScope: 'empresa',
    tenantId: 1,
    empresaId: 2
  }, OPERACION_ID);
  assert.equal(visible.operacionId, OPERACION_ID);
  assert.equal('claveOperacion' in visible, false);
  assert.equal('comando' in visible, false);
  assert.equal('instanciaId' in visible, false);
  assert.equal(visible.limpiezaPostcommit, null);
  assert.equal(consultasPostcommit, 0);

  operacion.estado = 'completada';
  operacion.fase = 'limpieza';
  operacion.terminal = true;
  operacion.resultado = {
    resultado: 'eliminado',
    estado: 'completada',
    obligaciones: [
      { obligacionId: NOTIFICACION_ID, tipo: 'publicar_invalidacion_portal' },
      { obligacionId: OPERACION_ID, tipo: 'invalidar_catalogo_monitores' }
    ]
  };
  situacion = {
    total: 2,
    completadas: 1,
    pendientes: 1,
    bloqueadas: 0,
    convergida: false
  };
  const conLimpiezaPendiente = await servicio.obtener({
    permitido: true,
    nivelScope: 'empresa',
    tenantId: 1,
    empresaId: 2
  }, OPERACION_ID);
  assert.deepEqual(conLimpiezaPendiente.limpiezaPostcommit, {
    estado: 'pendiente',
    total: 2,
    completadas: 1,
    pendientes: 1,
    bloqueadas: 0
  });
  assert.equal(conLimpiezaPendiente.resultado.obligacionesPendientes, 1);
  assert.equal(conLimpiezaPendiente.resultado.obligacionesBloqueadas, 0);

  situacion = {
    total: 2,
    completadas: 2,
    pendientes: 0,
    bloqueadas: 0,
    convergida: true
  };
  const convergida = await servicio.obtener({
    permitido: true,
    nivelScope: 'empresa',
    tenantId: 1,
    empresaId: 2
  }, OPERACION_ID);
  assert.equal(convergida.estado, 'completada');
  assert.equal(convergida.limpiezaPostcommit.estado, 'convergida');
  assert.equal(consultasPostcommit, 2);

  for (const contexto of [
    { permitido: false, nivelScope: 'portal' },
    { permitido: true, nivelScope: 'empresa', tenantId: 1, empresaId: 99 }
  ]) {
    await assert.rejects(
      servicio.obtener(contexto, OPERACION_ID),
      (error) => error.statusCode === 404 &&
        error.codigo === 'operacion_administrativa_no_encontrada'
    );
  }
}

async function verificarBuzonSinSocket() {
  let leida = false;
  const notificacion = {
    notificacionId: NOTIFICACION_ID,
    operacionId: OPERACION_ID,
    tipo: 'eliminacion_agente_encolada',
    emisor: { tipo: 'usuario', actorRealId: '11', actorEfectivoId: '22' },
    estadoOperacion: 'encolada',
    tituloCodigo: 'eliminacion_agente_encolada_titulo',
    resumenCodigo: 'eliminacion_agente_encolada_resumen',
    emitidaEnUtc: '2026-08-30T12:00:00.000Z',
    leida: false,
    leidaEnUtc: null,
    referenciaSujeto: {
      tipo: 'agente',
      id: '9',
      guid: '01234567-89ab-4def-8abc-0123456789ab'
    }
  };
  const repositorio = {
    async listarPagina({ limite }) {
      assert.equal(limite, 1);
      return {
        notificaciones: [notificacion],
        hayMas: true,
        siguientePosicion: {
          emitidaEnUtc: notificacion.emitidaEnUtc,
          notificacionId: NOTIFICACION_ID
        }
      };
    },
    async contarNoLeidas() { return leida ? 0 : 1; },
    async marcarLeida() {
      const cambioEfectivo = !leida;
      leida = true;
      return {
        cambioEfectivo,
        notificacion: { ...notificacion, leida: true, leidaEnUtc: notificacion.emitidaEnUtc }
      };
    },
    async obtenerFirma() {
      return {
        firma: 'b'.repeat(64),
        noLeidas: leida ? '0' : '1',
        actualizadaEnUtc: notificacion.emitidaEnUtc
      };
    }
  };
  const servicio = new ServicioBuzonNotificacionesUsuario({
    repositorio,
    catalogoResolutoresSujetos:
      crearCatalogoResolutoresSujetosAgenteNotificaciones({
        repositorioAgentes: {
          async buscarVisiblesPorIds() {
            return [{
              id: 9,
              guid: notificacion.referenciaSujeto.guid,
              nombre: 'Montessori',
              tenantNombre: 'Centro',
              empresaNombre: 'Colegio',
              sitioNombre: 'Servidor'
            }];
          }
        },
        servicioAutorizacion: {
          puedeVerAgentes: () => true
        }
      }),
    servicioAutorizacion: {
      puedeUsarBuzonPersonal: () => true
    },
    secretoCursores: 'secreto-fixture-buzon-con-mas-de-32-bytes'
  });
  const contexto = { idUsuario: 22, idUsuarioReal: 11 };
  const pagina = await servicio.listar(contexto, { limite: 1 });
  assert.equal(pagina.notificaciones.length, 1);
  assert.deepEqual(pagina.notificaciones[0].emisor, {
    tipo: 'usuario',
    etiqueta: 'Usuario'
  });
  assert.equal(
    pagina.notificaciones[0].operacion.enlace,
    `/operaciones-administrativas/${OPERACION_ID}`
  );
  assert.equal(pagina.paginacion.hayMas, true);
  assert.ok(pagina.paginacion.siguienteCursor);
  assert.equal(pagina.noLeidas, 1);
  assert.equal((await servicio.resumir(contexto)).noLeidas, 1);
  assert.equal((await servicio.marcarLeida(contexto, NOTIFICACION_ID)).cambioEfectivo, true);
  assert.equal((await servicio.marcarLeida(contexto, NOTIFICACION_ID)).cambioEfectivo, false);
}

async function verificarSuperficieEstatica() {
  const [rutas, controlador, openapi] = await Promise.all([
    readFile(new URL('../apps/sentinelia-web/src/rutas/crearRutasPortal.js', import.meta.url), 'utf8'),
    readFile(new URL('../apps/sentinelia-web/src/controladores/ControladorEliminacionAdministrativaAgentes.js', import.meta.url), 'utf8'),
    readFile(new URL('../openapi/agentes.v1.yaml', import.meta.url), 'utf8')
  ]);
  for (const ruta of [
    '/agentes/:id/eliminar',
    '/api/operaciones-administrativas/:operacionId',
    '/operaciones-administrativas/:operacionId',
    '/buzon/api/notificaciones',
    '/buzon/api/contador',
    '/buzon/api/notificaciones/:notificacionId/leer'
  ]) {
    assert.ok(rutas.includes(ruta), `Falta la ruta privada ${ruta}.`);
  }
  assert.ok(
    rutas.indexOf('requerirEliminacionAdministrativaAgentesHttp') <
      rutas.indexOf("'/api/operaciones-administrativas/:operacionId'")
  );
  assert.equal(controlador.includes(".render('portal/agente-eliminar'"), false);
  assert.ok(controlador.includes("return respuesta.redirect(303, '/agentes')"));
  assert.equal(controlador.includes('claveOperacion'), false);
  assert.equal(openapi.includes('/agentes/{id}/eliminar'), false);
  assert.equal(openapi.includes('/buzon/'), false);
}

function crearRespuesta() {
  return {
    statusCode: 200,
    cuerpo: null,
    cabeceras: {},
    status(codigo) { this.statusCode = codigo; return this; },
    set(nombre, valor) { this.cabeceras[nombre] = valor; return this; },
    json(cuerpo) { this.cuerpo = cuerpo; return this; }
  };
}

await main();

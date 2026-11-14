import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import {
  ControladorEliminacionAdministrativaOrganizaciones
} from '../apps/sentinelia-web/src/controladores/ControladorEliminacionAdministrativaOrganizaciones.js';
import {
  crearMiddlewareRequerirCapacidadEliminacionAdministrativaOrganizaciones
} from '../apps/sentinelia-web/src/middleware/requerirCapacidadEliminacionAdministrativaOrganizaciones.js';

const OPERACION_ID = '018f2f0f-7f40-7000-8000-000000000123';

function crearRespuesta() {
  return {
    statusCode: null,
    cabeceras: {},
    cuerpo: null,
    status(codigo) {
      this.statusCode = codigo;
      return this;
    },
    set(nombre, valor) {
      this.cabeceras[nombre] = valor;
      return this;
    },
    json(cuerpo) {
      this.cuerpo = cuerpo;
      return this;
    }
  };
}

function crearRequisicion({ tipo = 'empresa', id = '17', body = {} } = {}) {
  return {
    params: { tipo, id },
    body,
    contextoUsuarioActual: { idUsuario: '23', idUsuarioReal: '11' },
    session: { usuarioAutenticado: { tokenCSRF: 'csrf-prueba' } }
  };
}

async function verificarContratoControlador() {
  const llamadas = [];
  const controlador = new ControladorEliminacionAdministrativaOrganizaciones({
    servicioImpacto: {
      async preparar(entrada) {
        llamadas.push(['impacto', entrada]);
        return { sujeto: entrada.sujeto, tokenConfirmacion: 'token' };
      }
    },
    servicioAceptacion: {
      async aceptar(entrada) {
        llamadas.push(['aceptacion', entrada]);
        return {
          codigo: 'organizacion_eliminacion_encolada',
          repetida: false,
          operacionId: OPERACION_ID,
          estado: 'encolada'
        };
      }
    }
  });
  const errores = [];
  const respuestaImpacto = crearRespuesta();
  await controlador.obtenerImpacto(
    crearRequisicion(),
    respuestaImpacto,
    (error) => errores.push(error)
  );
  assert.equal(respuestaImpacto.statusCode, 200);
  assert.equal(respuestaImpacto.cabeceras['Cache-Control'], 'no-store');
  assert.deepEqual(respuestaImpacto.cuerpo, {
    ok: true,
    impacto: {
      sujeto: { tipo: 'empresa', id: '17' },
      tokenConfirmacion: 'token'
    }
  });
  assert.deepEqual(llamadas[0], ['impacto', {
    actorRealId: '11',
    actorEfectivoId: '23',
    sujeto: { tipo: 'empresa', id: '17' },
    csrfToken: 'csrf-prueba'
  }]);

  const respuestaAceptacion = crearRespuesta();
  await controlador.aceptar(
    crearRequisicion({
      tipo: 'sitio',
      id: '31',
      body: {
        tokenConfirmacion: 'token-firmado',
        fraseConfirmacion: 'ELIMINAR sitio 31'
      }
    }),
    respuestaAceptacion,
    (error) => errores.push(error)
  );
  assert.equal(respuestaAceptacion.statusCode, 202);
  assert.equal(respuestaAceptacion.cuerpo.operacionId, OPERACION_ID);
  assert.equal(
    respuestaAceptacion.cuerpo.urlOperacion,
    `/api/operaciones-administrativas/${OPERACION_ID}`
  );
  assert.equal(
    respuestaAceptacion.cuerpo.urlSeguimiento,
    `/operaciones-administrativas/${OPERACION_ID}`
  );
  assert.deepEqual(llamadas[1], ['aceptacion', {
    actorRealId: '11',
    actorEfectivoId: '23',
    sujeto: { tipo: 'sitio', id: '31' },
    tokenConfirmacion: 'token-firmado',
    fraseConfirmacion: 'ELIMINAR sitio 31',
    csrfToken: 'csrf-prueba'
  }]);

  const respuestaTenant = crearRespuesta();
  await controlador.obtenerImpacto(
    crearRequisicion({ tipo: 'tenant', id: '7' }),
    respuestaTenant,
    (error) => errores.push(error)
  );
  assert.equal(respuestaTenant.statusCode, 200);
  assert.deepEqual(llamadas[2][1].sujeto, { tipo: 'tenant', id: '7' });
  assert.deepEqual(errores, []);
}

async function verificarErroresCerrados() {
  for (const caso of [
    ['organizacion_eliminacion_no_autorizada', 'ErrorAutorizacion', 404],
    ['organizacion_eliminacion_confirmacion_expirada',
      'ErrorConfirmacionEliminacionOrganizacion', 410],
    ['organizacion_eliminacion_operacion_en_curso',
      'ErrorAceptacionEliminacionAdministrativaOrganizacion', 409],
    ['organizacion_eliminacion_confirmacion_invalida',
      'ErrorConfirmacionEliminacionOrganizacion', 400]
  ]) {
    const [codigo, nombre, statusCode] = caso;
    const error = Object.assign(new Error(codigo), { codigo, name: nombre });
    const controlador = new ControladorEliminacionAdministrativaOrganizaciones({
      servicioImpacto: { preparar: async () => { throw error; } },
      servicioAceptacion: { aceptar: async () => { throw error; } }
    });
    const respuesta = crearRespuesta();
    await controlador.obtenerImpacto(
      crearRequisicion(),
      respuesta,
      (inesperado) => { throw inesperado; }
    );
    assert.equal(respuesta.statusCode, statusCode, codigo);
    assert.equal(respuesta.cabeceras['Cache-Control'], 'no-store');
  }

  const controlador = new ControladorEliminacionAdministrativaOrganizaciones({
    servicioImpacto: { preparar: async () => assert.fail('No debe invocarse.') },
    servicioAceptacion: { aceptar: async () => assert.fail('No debe invocarse.') }
  });
  const respuesta = crearRespuesta();
  await controlador.obtenerImpacto(
    crearRequisicion({ tipo: 'desconocido', id: '0' }),
    respuesta,
    (error) => { throw error; }
  );
  assert.equal(respuesta.statusCode, 404);
  assert.equal(respuesta.cuerpo.codigo, 'organizacion_eliminacion_no_encontrada');
}

function verificarGate() {
  let continuaciones = 0;
  const cerrado = crearMiddlewareRequerirCapacidadEliminacionAdministrativaOrganizaciones();
  const respuesta = crearRespuesta();
  cerrado({}, respuesta, () => { continuaciones += 1; });
  assert.equal(continuaciones, 0);
  assert.equal(respuesta.statusCode, 404);
  assert.equal(respuesta.cuerpo.codigo, 'recurso_no_encontrado');
  assert.equal(respuesta.cabeceras['Cache-Control'], 'no-store');

  const abierto = crearMiddlewareRequerirCapacidadEliminacionAdministrativaOrganizaciones({
    habilitada: true
  });
  abierto({}, crearRespuesta(), () => { continuaciones += 1; });
  assert.equal(continuaciones, 1);
}

async function verificarComposicionPrivada() {
  const [rutas, aplicacion, indice, controlador] = await Promise.all([
    readFile(new URL('../apps/sentinelia-web/src/rutas/crearRutasPortal.js', import.meta.url), 'utf8'),
    readFile(new URL('../apps/sentinelia-web/src/crearAplicacion.js', import.meta.url), 'utf8'),
    readFile(new URL('../apps/sentinelia-web/src/index.js', import.meta.url), 'utf8'),
    readFile(new URL('../apps/sentinelia-web/src/controladores/ControladorEliminacionAdministrativaOrganizaciones.js', import.meta.url), 'utf8')
  ]);
  assert.match(rutas, /'\/api\/organizacion\/:tipo\/:id\/eliminacion'/u);
  assert.match(
    rutas,
    /'\/api\/organizacion\/:tipo\/:id\/eliminacion',[\s\S]{0,120}requerirEliminacionAdministrativaOrganizacionesHttp/u
  );
  assert.match(rutas, /eliminacionAdministrativaAgentesHttpHabilitada \|\|[\s\S]{0,80}eliminacionAdministrativaOrganizacionesHttpHabilitada/u);
  assert.match(rutas, /'\/api\/operaciones-administrativas\/:operacionId',[\s\S]{0,100}requerirOperacionesAdministrativasHttp/u);
  assert.match(aplicacion, /controladorEliminacionAdministrativaOrganizaciones/u);
  assert.match(indice, /new ServicioImpactoEliminacionOrganizacion/u);
  assert.match(indice, /new ServicioAceptacionEliminacionAdministrativaOrganizacion/u);
  assert.match(indice, /new ControladorEliminacionAdministrativaOrganizaciones/u);
  assert.match(
    indice,
    /eliminacionAdministrativaOrganizacionesHttpHabilitada:[\s\S]{0,100}activacionEliminacionAdministrativaOrganizaciones\.habilitada/u
  );
  assert.match(
    rutas,
    /El gate HTTP organizativo no puede abrirse sin su controlador durable/u
  );
  assert.match(indice, /resolverActivacionEliminacionAdministrativaOrganizaciones/u);
  assert.doesNotMatch(
    controlador,
    /ServicioJerarquiaOrganizativa|eliminarTenant|eliminarEmpresa|eliminarSitio/u
  );
}

await verificarContratoControlador();
await verificarErroresCerrados();
verificarGate();
await verificarComposicionPrivada();

console.log(
  '5.26.12a verificada: impacto y aceptación organizativos quedan compuestos tras un gate privado, responden 202 sin fallback síncrono y reutilizan la consulta transversal.'
);

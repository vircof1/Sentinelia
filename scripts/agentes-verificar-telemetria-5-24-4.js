import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import { generarUuidV7Auditoria } from '../paquetes/auditoria/src/UuidV7Auditoria.js';
import { ControladorApiAgentes } from '../apps/sentinelia-web/src/controladores/ControladorApiAgentes.js';
import {
  TIPOS_DATO_TELEMETRIA_AGENTE,
  crearLoteTelemetriaAgente
} from '../paquetes/agentes/src/TelemetriaAgente.js';

const MARCA_RECIBIDO_ORIGINAL = '2026-08-26T08:00:00.000Z';

await verificarTiposTemporalesPublicos();
await verificarFronteraHttpIdempotente();
await verificarErroresDeFrontera();
await verificarContratoHttpEstrictoDeSesionYPol();
await verificarContratoOpenApi();
await verificarCableadoRuntime();

console.log(
  '[agentes] OK 5.24.4: http=contrato_estricto identidad=uuidv7_sha256 ' +
  'replay=correlacion_nueva errores=redactados openapi=temporal_v1 ' +
  'runtime=purga_acotada publicador_interno=sin_identidad_http'
);

async function verificarTiposTemporalesPublicos() {
  assert.equal(TIPOS_DATO_TELEMETRIA_AGENTE.DURACION, 'duracion');
  assert.equal(TIPOS_DATO_TELEMETRIA_AGENTE.MOMENTO_UTC, 'momento_utc');
  const lote = crearLoteTelemetriaAgente(crearCuerpoValido()).serializar();
  assert.deepEqual(
    lote.observaciones.map((observacion) => observacion.tipoDato),
    ['duracion', 'momento_utc']
  );
  assert.equal(lote.observaciones[0].valorDuracion, 1683.8219);
  assert.equal(
    lote.observaciones[1].valorMomentoUtc,
    '2026-08-27T02:30:00Z'
  );
}

async function verificarFronteraHttpIdempotente() {
  const llamadasAutenticacion = [];
  const llamadasIngesta = [];
  let intento = 0;
  const controlador = crearControlador({
    llamadasAutenticacion,
    llamadasIngesta,
    crearResultado: ({ requestId }) => ({
      resultado: {
        ok: true,
        resultado: 'aceptado',
        requestId,
        serverTimeUtc: `2026-08-26T08:00:0${intento++}.000Z`,
        recibidoEnUtc: MARCA_RECIBIDO_ORIGINAL,
        aceptadas: 2,
        rechazadas: 0,
        errores: []
      },
      idempotencia: { replay: intento > 1 },
      persistencia: { datoInterno: 'no_publicar' }
    })
  });
  const cuerpo = crearCuerpoValido();
  const primera = crearRespuesta();
  await controlador.telemetria(crearRequisicion(cuerpo), primera);
  const segunda = crearRespuesta();
  await controlador.telemetria(crearRequisicion(cuerpo), segunda);

  assert.equal(primera.statusCode, 200);
  assert.equal(segunda.statusCode, 200);
  assert.equal(llamadasAutenticacion.length, 2);
  assert.equal(llamadasIngesta.length, 2);
  assert.equal(llamadasIngesta[0].telemetriaRequestId, cuerpo.telemetriaRequestId);
  assert.equal(llamadasIngesta[0].huellaLoteSha256.length, 32);
  assert.deepEqual(
    llamadasIngesta[0].huellaLoteSha256,
    llamadasIngesta[1].huellaLoteSha256
  );
  assert.notEqual(llamadasIngesta[0].requestId, llamadasIngesta[1].requestId);
  assert.equal(primera.body.telemetriaRequestId, cuerpo.telemetriaRequestId);
  assert.equal(segunda.body.telemetriaRequestId, cuerpo.telemetriaRequestId);
  assert.equal(segunda.body.recibidoEnUtc, MARCA_RECIBIDO_ORIGINAL);
  assert.equal(primera.body.coordinacion.revisionConfiguracionActual, 'cfg_1');
  assert.equal(segunda.body.coordinacion.revisionConfiguracionActual, 'cfg_2');
  assert.equal(Object.hasOwn(primera.body, 'idempotencia'), false);
  assert.equal(Object.hasOwn(primera.body, 'persistencia'), false);
}

async function verificarErroresDeFrontera() {
  const casos400 = [
    {
      nombre: 'propiedad desconocida',
      cuerpo: { ...crearCuerpoValido(), propiedadInventada: true }
    },
    {
      nombre: 'duración negativa',
      cuerpo: modificarPrimeraObservacion({ valorDuracion: -1 })
    },
    {
      nombre: 'duración con exceso de precisión',
      cuerpo: modificarPrimeraObservacion({ valorDuracion: 1.23456 })
    },
    {
      nombre: 'momento con fracciones',
      cuerpo: modificarSegundaObservacion({
        valorMomentoUtc: '2026-08-27T02:30:00.123Z'
      })
    },
    {
      nombre: 'dos campos de valor',
      cuerpo: modificarPrimeraObservacion({ valorNumero: 1 })
    }
  ];

  for (const caso of casos400) {
    const llamadasAutenticacion = [];
    const llamadasIngesta = [];
    const respuesta = crearRespuesta();
    await crearControlador({ llamadasAutenticacion, llamadasIngesta })
      .telemetria(crearRequisicion(caso.cuerpo), respuesta);
    assert.equal(respuesta.statusCode, 400, caso.nombre);
    assert.equal(llamadasAutenticacion.length, 0, caso.nombre);
    assert.equal(llamadasIngesta.length, 0, caso.nombre);
  }

  const sinIdentidad = crearCuerpoValido();
  delete sinIdentidad.telemetriaRequestId;
  const respuesta422 = crearRespuesta();
  await crearControlador().telemetria(
    crearRequisicion(sinIdentidad),
    respuesta422
  );
  assert.equal(respuesta422.statusCode, 422);
  assert.equal(respuesta422.body.code, 'validacion_dominio');
  assert.equal(respuesta422.body.validation[0].field, 'telemetriaRequestId');

  const divergencia = new Error('Identidad usada para otro lote.');
  divergencia.statusCode = 409;
  divergencia.codigo = 'telemetria_request_id_divergente';
  const respuesta409 = crearRespuesta();
  await crearControlador({ errorIngesta: divergencia }).telemetria(
    crearRequisicion(crearCuerpoValido()),
    respuesta409
  );
  assert.equal(respuesta409.statusCode, 409);
  assert.equal(respuesta409.body.code, 'telemetria_request_id_divergente');

  const infraestructura = new Error('password=mysql://dato-secreto');
  infraestructura.codigo = 'ER_ACCESS_DENIED_DATO_INTERNO';
  const respuesta500 = crearRespuesta();
  await crearControlador({ errorIngesta: infraestructura }).telemetria(
    crearRequisicion(crearCuerpoValido()),
    respuesta500
  );
  assert.equal(respuesta500.statusCode, 500);
  assert.equal(respuesta500.body.code, 'error_interno_telemetria');
  assert.doesNotMatch(
    JSON.stringify(respuesta500.body),
    /dato-secreto|ER_ACCESS_DENIED_DATO_INTERNO/u
  );
}

async function verificarContratoHttpEstrictoDeSesionYPol() {
  const controlador = crearControlador();
  const loginValido = {
    guid: '123e4567-e89b-42d3-a456-426614174000',
    secreto: 's'.repeat(32),
    loginRequestId: generarUuidV7Auditoria(),
    bootId: 'boot-contrato-estricto',
    timestampClienteUtc: '2026-08-26T10:00:00+02:00'
  };
  const refreshValido = {
    refreshRequestId: generarUuidV7Auditoria(),
    sessionIdActual: 'ags_contrato_estricto',
    bootId: 'boot-contrato-estricto',
    revisionConfiguracionConocida: null
  };
  const heartbeatValido = {
    seq: 1,
    bootId: 'boot-contrato-estricto',
    uptimeSeconds: 30
  };

  assert.doesNotThrow(() => controlador.validarPeticionLogin(loginValido));
  assert.doesNotThrow(() => controlador.validarPeticionRefresh(refreshValido));
  assert.doesNotThrow(() => controlador.validarPeticionHeartbeat(heartbeatValido));

  for (const [nombre, ejecutar, campo] of [
    [
      'login con propiedad desconocida',
      () => controlador.validarPeticionLogin({ ...loginValido, inventada: true }),
      'body.inventada'
    ],
    [
      'refresh con propiedad desconocida',
      () => controlador.validarPeticionRefresh({ ...refreshValido, inventada: true }),
      'body.inventada'
    ],
    [
      'heartbeat con secuencia textual',
      () => controlador.validarPeticionHeartbeat({ ...heartbeatValido, seq: '1x' }),
      'seq'
    ],
    [
      'heartbeat con uptime textual',
      () => controlador.validarPeticionHeartbeat({
        ...heartbeatValido,
        uptimeSeconds: '30s'
      }),
      'uptimeSeconds'
    ],
    [
      'login con fecha imposible',
      () => controlador.validarPeticionLogin({
        ...loginValido,
        timestampClienteUtc: '2026-02-30T10:00:00Z'
      }),
      'timestampClienteUtc'
    ]
  ]) {
    assert.throws(
      ejecutar,
      (error) =>
        error.statusCode === 422 &&
        error.codigo === 'validacion_dominio' &&
        error.validation?.[0]?.field === campo,
      nombre
    );
  }
}

async function verificarContratoOpenApi() {
  const openapi = await readFile(
    new URL('../openapi/agentes.v1.yaml', import.meta.url),
    'utf8'
  );
  for (const marca of [
    'telemetriaRequestId:',
    'const: duracion',
    'const: momento_utc',
    'valorDuracion:',
    'valorMomentoUtc:',
    'multipleOf: 0.0001',
    'maximum: 1.7976931348623157e+308',
    'ValidationErrorDetail:',
    'senal_catalogo_incompatible',
    'telemetria_request_id_divergente'
  ]) assert.match(openapi, new RegExp(escaparExpresion(marca), 'u'));
  assert.match(
    openapi,
    /El resultado parcial[\s\S]{0,180}conflictos de catálogo/iu
  );
  assert.match(
    openapi,
    /- telemetriaRequestId\n\s+- observaciones/u
  );
  assert.match(
    openapi,
    /SessionRequestId:[\s\S]{0,180}pattern: "\^\[0-9a-f\]/u
  );
  assert.match(
    openapi,
    /ValidationErrorResponse:[\s\S]{0,180}required:\n\s+- validation/u
  );
  assert.doesNotMatch(openapi, /TooManyRequests|"429"|retryAfterSeconds/u);
}

async function verificarCableadoRuntime() {
  const [bootstrap, runtime, publicador, servicio] = await Promise.all([
    leer('../apps/sentinelia-runtime/src/BootstrapRuntime.js'),
    leer('../apps/sentinelia-runtime/src/RuntimeSentinelia.js'),
    leer('../paquetes/agentes/src/PublicadorTelemetriaRuntimeEnTransaccion.js'),
    leer('../paquetes/agentes/src/ServicioIngestaTelemetriaAgentes.js')
  ]);
  assert.match(bootstrap, /RepositorioIdempotenciaLotesTelemetriaAgentes/u);
  assert.match(runtime, /purgarExpirados\(\{[\s\S]{0,80}limite: 500/u);
  assert.match(runtime, /ultimaPurgaIdempotenciaTelemetria/u);
  assert.doesNotMatch(publicador, /telemetriaRequestId/u);
  assert.match(servicio, /if \(!replay\) \{[\s\S]*publicarAvisoEvaluacion/u);
  const nucleoEstable = servicio.match(
    /function extraerNucleoEstableResultado[\s\S]*?\n\}/u
  )?.[0];
  assert.ok(nucleoEstable);
  assert.doesNotMatch(nucleoEstable, /persistencia/u);
}

function crearControlador({
  llamadasAutenticacion = [],
  llamadasIngesta = [],
  crearResultado = ({ requestId }) => ({
    resultado: {
      ok: true,
      resultado: 'aceptado',
      requestId,
      serverTimeUtc: new Date().toISOString(),
      recibidoEnUtc: MARCA_RECIBIDO_ORIGINAL,
      aceptadas: 2,
      rechazadas: 0,
      errores: []
    }
  }),
  errorIngesta = null
} = {}) {
  return new ControladorApiAgentes({
    servicioAutenticacionAgentes: {
      async obtenerContextoIngestaTelemetria(solicitud) {
        llamadasAutenticacion.push(solicitud);
        const numero = llamadasAutenticacion.length;
        return {
          sesion: {
            agenteId: 7,
            sessionId: `sesion_${numero}`,
            sessionTokenHash: `huella_${numero}`
          },
          periodoVidaPol: { id: 90 + numero },
          coordinacion: {
            accion: 'continue',
            requiereRefreshSesion: false,
            requiereConfiguracion: false,
            revisionConfiguracionActual: `cfg_${numero}`,
            requierePolitica: false,
            revisionPoliticaActual: `pol_${numero}`
          }
        };
      }
    },
    servicioIngestaTelemetriaAgentes: {
      async ingestarLote(solicitud) {
        llamadasIngesta.push(solicitud);
        if (errorIngesta) throw errorIngesta;
        return crearResultado(solicitud);
      }
    }
  });
}

function crearCuerpoValido() {
  return {
    telemetriaRequestId: generarUuidV7Auditoria(),
    observaciones: [
      {
        categoria: 'copias',
        clave: 'ultima_duracion',
        tag: 'principal',
        tipoDato: 'duracion',
        unidad: 's',
        observadoEnUtc: '2026-08-26T07:59:58Z',
        valorDuracion: 1683.8219,
        calidad: 'valida',
        severidadDeclarada: 'info',
        origen: 'directa'
      },
      {
        categoria: 'copias',
        clave: 'proxima_ejecucion',
        tag: 'principal',
        tipoDato: 'momento_utc',
        unidad: null,
        observadoEnUtc: '2026-08-26T07:59:58Z',
        valorMomentoUtc: '2026-08-27T02:30:00Z',
        calidad: 'valida',
        severidadDeclarada: 'info',
        origen: 'directa'
      }
    ]
  };
}

function modificarPrimeraObservacion(cambios) {
  const cuerpo = crearCuerpoValido();
  cuerpo.observaciones[0] = { ...cuerpo.observaciones[0], ...cambios };
  return cuerpo;
}

function modificarSegundaObservacion(cambios) {
  const cuerpo = crearCuerpoValido();
  cuerpo.observaciones[1] = { ...cuerpo.observaciones[1], ...cambios };
  return cuerpo;
}

function crearRequisicion(body) {
  return {
    body,
    get(nombre) {
      return nombre.toLowerCase() === 'authorization'
        ? 'Bearer sesion_fixture'
        : '';
    }
  };
}

function crearRespuesta() {
  return {
    statusCode: 200,
    body: null,
    status(codigo) {
      this.statusCode = codigo;
      return this;
    },
    json(cuerpo) {
      this.body = cuerpo;
      return this;
    }
  };
}

function leer(ruta) {
  return readFile(new URL(ruta, import.meta.url), 'utf8');
}

function escaparExpresion(valor) {
  return valor.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
}

import assert from 'node:assert/strict';
import http from 'node:http';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { setTimeout as esperar } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import ejs from 'ejs';
import express from 'express';
import { ClienteSql } from '../paquetes/persistencia-sql/src/ClienteSql.js';
import { RepositorioMigraciones } from '../paquetes/persistencia-sql/src/RepositorioMigraciones.js';
import { EjecutorMigraciones } from '../paquetes/persistencia-sql/src/EjecutorMigraciones.js';
import { ServicioConexionRedis } from '../paquetes/sesiones/src/ServicioConexionRedis.js';
import {
  RepositorioAgentesSentinelia
} from '../paquetes/agentes/src/RepositorioAgentesSentinelia.js';
import {
  RepositorioSesionesAgentesRedis
} from '../paquetes/agentes/src/RepositorioSesionesAgentesRedis.js';
import {
  ServicioAutenticacionAgentes
} from '../paquetes/agentes/src/ServicioAutenticacionAgentes.js';
import {
  ConfiguracionEfectivaAgente
} from '../paquetes/agentes/src/ConfiguracionEfectivaAgente.js';
import {
  crearLecturaOperativaAgente
} from '../paquetes/agentes/src/LecturaOperativaAgente.js';
import {
  crearLoteTelemetriaAgente,
  crearResultadoIngestaTelemetria,
  crearSenalTelemetriaAgente,
  TIPOS_DATO_TELEMETRIA_AGENTE
} from '../paquetes/agentes/src/TelemetriaAgente.js';
import {
  RepositorioCatalogoSenalesTelemetriaAgentes
} from '../paquetes/agentes/src/RepositorioCatalogoSenalesTelemetriaAgentes.js';
import {
  RepositorioObservacionesTelemetriaAgentes
} from '../paquetes/agentes/src/RepositorioObservacionesTelemetriaAgentes.js';
import {
  RepositorioEstadoActualTelemetriaAgentes
} from '../paquetes/agentes/src/RepositorioEstadoActualTelemetriaAgentes.js';
import {
  RepositorioIdempotenciaLotesTelemetriaAgentes
} from '../paquetes/agentes/src/RepositorioIdempotenciaLotesTelemetriaAgentes.js';
import {
  ServicioIngestaTelemetriaAgentes
} from '../paquetes/agentes/src/ServicioIngestaTelemetriaAgentes.js';
import {
  GeneradorSesionAgenteSentinelia
} from '../paquetes/agentes/src/GeneradorSesionAgenteSentinelia.js';
import {
  SesionAgenteSentinelia
} from '../paquetes/agentes/src/SesionAgenteSentinelia.js';
import {
  calcularEstadoVidaPolAgente
} from '../paquetes/agentes/src/EstadosAgenteSentinelia.js';
import {
  ServicioProvisionamientoAgentes
} from '../paquetes/agentes/src/ServicioProvisionamientoAgentes.js';
import {
  ServicioAdministracionAgentesPortal
} from '../apps/sentinelia-web/src/servicios/ServicioAdministracionAgentesPortal.js';
import {
  GeneradorCredencialesAgenteSentinelia
} from '../paquetes/agentes/src/GeneradorCredencialesAgenteSentinelia.js';
import {
  obtenerConfiguracionAplicacion
} from '../paquetes/utilidades/src/configuracion/obtenerConfiguracionAplicacion.js';
import {
  obtenerDefinicionesConfiguracionPortal
} from '../paquetes/configuracion/src/obtenerDefinicionesConfiguracionPortal.js';
import {
  ConfiguracionPortal
} from '../paquetes/configuracion/src/ConfiguracionPortal.js';
import {
  ControladorApiAgentes
} from '../apps/sentinelia-web/src/controladores/ControladorApiAgentes.js';
import {
  crearRutasApiAgentes
} from '../apps/sentinelia-web/src/rutas/crearRutasApiAgentes.js';
import {
  generarUuidV7Auditoria
} from '../paquetes/auditoria/src/UuidV7Auditoria.js';

const RUTA_VISTA_AGENTES = fileURLToPath(
  new URL('../apps/sentinelia-web/src/views/portal/agentes.ejs', import.meta.url)
);
const RUTA_OPENAPI_AGENTES = fileURLToPath(
  new URL('../openapi/agentes.v1.yaml', import.meta.url)
);
const RUTA_RUTAS_API_AGENTES = fileURLToPath(
  new URL('../apps/sentinelia-web/src/rutas/crearRutasApiAgentes.js', import.meta.url)
);
const RUTAS_API_AGENTES = Object.freeze([
  { metodo: 'post', ruta: '/api/agentes/v1/login' },
  { metodo: 'get', ruta: '/api/agentes/v1/me' },
  { metodo: 'post', ruta: '/api/agentes/v1/session/refresh' },
  { metodo: 'post', ruta: '/api/agentes/v1/heartbeat' },
  { metodo: 'get', ruta: '/api/agentes/v1/configuracion' }
]);
const RUTAS_OPENAPI_AGENTES = Object.freeze([
  ...RUTAS_API_AGENTES,
  { metodo: 'post', ruta: '/api/agentes/v1/telemetria' }
]);
const RUTAS_AGENTES_NO_IMPLEMENTADAS = Object.freeze([
  '/api/agentes/v1/telemetry',
  '/api/agentes/v1/logs',
  '/api/agentes/v1/comandos',
  '/api/agentes/v1/commands',
  '/api/agentes/v1/dynamic-dns',
  '/api/agentes/v1/trabajos',
  '/api/agentes/v1/jobs'
]);
const ESQUEMAS_TELEMETRIA_OPENAPI = Object.freeze([
  'TelemetryBatchRequest',
  'TelemetrySignalCatalog',
  'TelemetrySignalDefinition',
  'TelemetrySignal',
  'TelemetryObservation',
  'TelemetryIngestionResponse',
  'TelemetryObservationError',
  'TelemetryDataType',
  'TelemetryQuality',
  'TelemetryDeclaredSeverity',
  'TelemetryOrigin',
  'TelemetryIngestionStatus'
]);
const EJEMPLOS_TELEMETRIA_OPENAPI = Object.freeze([
  'metricaNumerica',
  'estadoDiscreto',
  'observacionesDiferidas',
  'detalleHumano',
  'catalogoDeclarado',
  'aceptacionTotal',
  'aceptacionParcial'
]);
const TEXTOS_CASTELLANO_OPENAPI_TELEMETRIA = Object.freeze([
  'Recibe observaciones de telemetría del agente actual.',
  'Métrica numérica viva.',
  'Estado discreto vivo.',
  'Observaciones pasadas recuperadas tras desconexión.',
  'Observación con detalle humano.',
  'Catálogo declarado junto a observaciones.',
  'Lote aceptado parcialmente.'
]);
const RUTA_MIGRACIONES_SQL = fileURLToPath(
  new URL('../migraciones/sql', import.meta.url)
);
async function asegurarMigracionesTelemetriaAplicadas(clienteSql) {
  const repositorioMigraciones = new RepositorioMigraciones(clienteSql);
  const ejecutorMigraciones = new EjecutorMigraciones({
    clienteSql,
    repositorioMigraciones,
    rutaMigraciones: RUTA_MIGRACIONES_SQL
  });
  const resultado = await ejecutorMigraciones.ejecutarPendientes();

  if (resultado.pendientesAplicadas > 0) {
    console.log(
      `[agentes-migraciones] migraciones aplicadas antes de verificar: ${resultado.pendientesAplicadas}`
    );
  }
}

async function main() {
  const configuracion = obtenerConfiguracionAplicacion();

  if (!configuracion.sql.estaCompleta) {
    throw new Error(
      'Configuracion SQL incompleta. Revisa SQL_HOST, SQL_USUARIO y SQL_BASE_DATOS.'
    );
  }

  const clienteSql = new ClienteSql(configuracion.sql);
  const servicioConexionRedis = new ServicioConexionRedis(configuracion.redis);
  const clienteRedis = await servicioConexionRedis.conectar();
  const repositorioAgentes = new RepositorioAgentesSentinelia(clienteSql);
  const repositorioSesionesAgentesRedis = new RepositorioSesionesAgentesRedis({
    clienteRedis,
    prefijoSesionesAgentes: `sentinelia:test:agentes:${Date.now()}:`
  });
  const generadorCredenciales = new GeneradorCredencialesAgenteSentinelia();
  const ids = {
    tenantId: null,
    empresaId: null,
    sitioId: null,
    agentes: []
  };

  try {
    await clienteSql.verificarUsoHorarioUtc();
    await asegurarMigracionesTelemetriaAplicadas(clienteSql);
    await limpiarRedisVerificacion(clienteRedis, repositorioSesionesAgentesRedis);
    await crearJerarquiaTemporal(clienteSql, ids);

    verificarConfiguracionPortalAgentes(configuracion);
    await verificarLoginCorrectoYMe({
      repositorioAgentes,
      repositorioSesionesAgentesRedis,
      generadorCredenciales,
      ids
    });
    await verificarInvalidacionAdministrativa({
      repositorioAgentes,
      repositorioSesionesAgentesRedis,
      generadorCredenciales,
      ids
    });
    await verificarSesionReemplazadaYPol({
      clienteSql,
      repositorioAgentes,
      repositorioSesionesAgentesRedis,
      generadorCredenciales,
      ids
    });
    await verificarRefreshValido({
      clienteSql,
      repositorioAgentes,
      repositorioSesionesAgentesRedis,
      generadorCredenciales,
      ids
    });
    await verificarRefreshHttpReal({
      repositorioAgentes,
      repositorioSesionesAgentesRedis,
      generadorCredenciales,
      ids
    });
    await verificarHeartbeatValido({
      clienteSql,
      repositorioAgentes,
      repositorioSesionesAgentesRedis,
      generadorCredenciales,
      ids
    });
    await verificarHeartbeatDuplicado({
      clienteSql,
      repositorioAgentes,
      repositorioSesionesAgentesRedis,
      generadorCredenciales,
      ids
    });
    await verificarHeartbeatBootIncoherente({
      repositorioAgentes,
      repositorioSesionesAgentesRedis,
      generadorCredenciales,
      ids
    });
    await verificarHeartbeatSesionReemplazada({
      repositorioAgentes,
      repositorioSesionesAgentesRedis,
      generadorCredenciales,
      ids
    });
    await verificarHeartbeatPeriodoCerradoDuranteRegistro({
      repositorioAgentes,
      repositorioSesionesAgentesRedis,
      generadorCredenciales,
      ids
    });
    await verificarHeartbeatHttpReal({
      repositorioAgentes,
      repositorioSesionesAgentesRedis,
      generadorCredenciales,
      ids
    });
    await verificarConfiguracionEfectivaDominio({
      repositorioAgentes,
      repositorioSesionesAgentesRedis,
      generadorCredenciales,
      ids
    });
    await verificarConfiguracionEfectivaRevision({
      repositorioAgentes,
      repositorioSesionesAgentesRedis,
      generadorCredenciales,
      ids
    });
    await verificarConfiguracionEfectivaHttpReal({
      repositorioAgentes,
      repositorioSesionesAgentesRedis,
      generadorCredenciales,
      ids
    });
    await verificarConfiguracionEfectivaSesionNoVigente({
      repositorioAgentes,
      repositorioSesionesAgentesRedis,
      generadorCredenciales,
      ids
    });
    await verificarLecturaOperativaAdministrativa({
      clienteSql,
      repositorioAgentes,
      repositorioSesionesAgentesRedis,
      generadorCredenciales,
      ids
    });
    await verificarPanelAdministrativoAgentesScopePermisosYEstados({
      clienteSql,
      repositorioAgentes,
      repositorioSesionesAgentesRedis,
      generadorCredenciales,
      ids
    });
    verificarEstadoVidaPolDerivado();
    await verificarCierrePolPorIndiceRedisPerdido({
      clienteSql,
      clienteRedis,
      repositorioAgentes,
      repositorioSesionesAgentesRedis,
      generadorCredenciales,
      ids
    });
    await verificarRefreshSesionExpirada({
      repositorioAgentes,
      repositorioSesionesAgentesRedis,
      generadorCredenciales,
      ids
    });
    await verificarRefreshSesionReemplazada({
      repositorioAgentes,
      repositorioSesionesAgentesRedis,
      generadorCredenciales,
      ids
    });
    await verificarRefreshSesionDeOtroAgente({
      repositorioAgentes,
      repositorioSesionesAgentesRedis,
      generadorCredenciales,
      ids
    });
    await verificarRefreshConcurrente({
      repositorioAgentes,
      repositorioSesionesAgentesRedis,
      generadorCredenciales,
      ids
    });
    await verificarRefreshBootIncoherente({
      repositorioAgentes,
      repositorioSesionesAgentesRedis,
      generadorCredenciales,
      ids
    });
    await verificarCredencialesInvalidasYCuarentena({
      repositorioAgentes,
      repositorioSesionesAgentesRedis,
      generadorCredenciales,
      ids
    });
    await verificarAgenteDeshabilitado({
      repositorioAgentes,
      repositorioSesionesAgentesRedis,
      generadorCredenciales,
      ids
    });
    await verificarLoginConcurrenteBloqueado({
      repositorioAgentes,
      repositorioSesionesAgentesRedis,
      generadorCredenciales,
      ids
    });
    await verificarExpiracionRedis({
      repositorioAgentes,
      repositorioSesionesAgentesRedis,
      generadorCredenciales,
      ids
    });
    await verificarContratoApiAgentes();
    verificarDominioBaseTelemetriaAgente();
    verificarValidacionValorTelemetriaAgente();
    verificarSemanticaOperativaTelemetriaAgente();
    await verificarContextoIngestaTelemetriaCoordinaSesionYConfiguracion();
    await verificarEndpointTelemetriaAgentes();
    await verificarEndpointTelemetriaEndToEnd({
      clienteSql,
      repositorioAgentes,
      repositorioSesionesAgentesRedis,
      generadorCredenciales,
      ids
    });
    console.log(
      '[agentes-login] OK: autenticación, sesiones, configuración e ingesta de telemetría verificadas.'
    );
  } finally {
    await limpiarSqlVerificacion(clienteSql, ids);
    await limpiarRedisVerificacion(clienteRedis, repositorioSesionesAgentesRedis);
    await servicioConexionRedis.cerrar();
    await clienteSql.cerrar();
  }
}

async function verificarContratoApiAgentes() {
  const [openapiYaml, rutasApi] = await Promise.all([
    readFile(RUTA_OPENAPI_AGENTES, 'utf8'),
    readFile(RUTA_RUTAS_API_AGENTES, 'utf8')
  ]);
  const pathsOpenApi = extraerPathsOpenApiAgentes(openapiYaml);

  assert.ok(
    /servers:\s*\n\s+- url: \/\s*\n/.test(openapiYaml),
    'El contrato OpenAPI debe usar el mismo origen como server base.'
  );

  for (const endpoint of RUTAS_API_AGENTES) {
    assert.equal(
      pathsOpenApi.get(endpoint.ruta),
      endpoint.metodo,
      `OpenAPI debe declarar ${endpoint.metodo.toUpperCase()} ${endpoint.ruta}.`
    );
    assert.ok(
      rutasApi.includes(`router.${endpoint.metodo}(`) &&
        rutasApi.includes(`'${endpoint.ruta}'`),
      `Express debe exponer ${endpoint.metodo.toUpperCase()} ${endpoint.ruta}.`
    );
  }

  for (const endpoint of RUTAS_OPENAPI_AGENTES) {
    assert.equal(
      pathsOpenApi.get(endpoint.ruta),
      endpoint.metodo,
      `OpenAPI debe declarar ${endpoint.metodo.toUpperCase()} ${endpoint.ruta}.`
    );
  }

  assert.ok(
    rutasApi.includes("router.post(") &&
      rutasApi.includes("'/api/agentes/v1/telemetria'"),
    'POST /api/agentes/v1/telemetria debe estar implementada en Express.'
  );

  verificarContratoOpenApiTelemetria(openapiYaml);

  assert.ok(
    pathsOpenApi.size >= RUTAS_OPENAPI_AGENTES.length,
    'OpenAPI debe conservar todas las rutas técnicas requeridas.'
  );

  for (const rutaNoImplementada of RUTAS_AGENTES_NO_IMPLEMENTADAS) {
    assert.equal(
      pathsOpenApi.has(rutaNoImplementada),
      false,
      `${rutaNoImplementada} no pertenece al contrato vigente.`
    );
    assert.equal(
      rutasApi.includes(`'${rutaNoImplementada}'`),
      false,
      `${rutaNoImplementada} no debe estar implementada en las rutas Express.`
    );
  }

  console.log('[agentes-contrato] OpenAPI y rutas Express verificados.');
}

function verificarContratoOpenApiTelemetria(openapiYaml) {
  assert.ok(
    /\/api\/agentes\/v1\/telemetria:\s*\n\s+post:\s*\n/.test(openapiYaml),
    'OpenAPI debe declarar POST /api/agentes/v1/telemetria.'
  );
  assert.ok(
    /\/api\/agentes\/v1\/telemetria:[\s\S]*?security:\s*\n\s+- bearerAuth: \[\]/.test(openapiYaml),
    'La telemetria debe exigir Bearer de sesion viva Redis.'
  );
  assert.ok(
    /\/api\/agentes\/v1\/telemetria:[\s\S]*?no acepta el secreto persistente del agente/.test(openapiYaml),
    'La telemetria debe documentar que no acepta secreto persistente.'
  );
  assert.ok(
    /\/api\/agentes\/v1\/telemetria:[\s\S]*?\$ref: "#\/components\/schemas\/TelemetryBatchRequest"/.test(openapiYaml),
    'La peticion de telemetria debe usar TelemetryBatchRequest.'
  );
  assert.ok(
    /\/api\/agentes\/v1\/telemetria:[\s\S]*?\$ref: "#\/components\/schemas\/TelemetryIngestionResponse"/.test(openapiYaml),
    'La respuesta de telemetria debe usar TelemetryIngestionResponse.'
  );
  assert.ok(
    /aceptadas:\s*\n\s+type: integer[\s\S]*?rechazadas:\s*\n\s+type: integer/.test(openapiYaml),
    'La respuesta de telemetria debe documentar conteos de aceptadas y rechazadas.'
  );
  assert.ok(
    /resultado:\s*\n\s+\$ref: "#\/components\/schemas\/TelemetryIngestionStatus"/.test(openapiYaml),
    'La respuesta de telemetria debe declarar resultado de ingesta.'
  );
  assert.ok(
    /revisionConfiguracionConocida:\s*\n\s+type:\s*\n\s+- string\s*\n\s+- "null"/.test(openapiYaml),
    'La peticion de telemetria debe permitir declarar revisionConfiguracionConocida.'
  );
  assert.ok(
    /revisionPoliticaConocida:\s*\n\s+type:\s*\n\s+- string\s*\n\s+- "null"/.test(openapiYaml),
    'La peticion de telemetria debe permitir declarar revisionPoliticaConocida.'
  );
  assert.ok(
    /vigenteHastaUtc:\s*\n\s+type:\s*\n\s+- string\s*\n\s+- "null"\s*\n\s+format: date-time/.test(openapiYaml),
    'La observacion de telemetria debe documentar vigenteHastaUtc opcional.'
  );

  for (const esquema of ESQUEMAS_TELEMETRIA_OPENAPI) {
    assert.ok(
      openapiYaml.includes(`    ${esquema}:`),
      `OpenAPI debe declarar el esquema ${esquema}.`
    );
  }

  for (const ejemplo of EJEMPLOS_TELEMETRIA_OPENAPI) {
    assert.ok(
      openapiYaml.includes(`              ${ejemplo}:`) ||
        openapiYaml.includes(`                ${ejemplo}:`),
      `OpenAPI debe declarar el ejemplo ${ejemplo}.`
    );
  }

  for (const texto of TEXTOS_CASTELLANO_OPENAPI_TELEMETRIA) {
    assert.ok(
      openapiYaml.includes(texto),
      `OpenAPI debe mantener texto visible en castellano: ${texto}`
    );
  }
}

function verificarDominioBaseTelemetriaAgente() {
  const lote = crearLoteTelemetriaAgente({
    emitidoEnUtc: '2026-07-07T10:30:00Z',
    catalogo: {
      revision: 'cat_20260707_001',
      senales: [
        {
          categoria: ' sistema ',
          clave: 'ram.uso',
          tipoDato: TIPOS_DATO_TELEMETRIA_AGENTE.NUMERO,
          unidad: '%',
          nombreHumano: 'Uso de RAM'
        }
      ]
    },
    observaciones: [
      {
        categoria: 'sistema',
        clave: 'ram.uso',
        tipoDato: TIPOS_DATO_TELEMETRIA_AGENTE.NUMERO,
        unidad: '%',
        observadoEnUtc: '2026-07-07T10:29:30Z',
        valorNumero: 44,
        detalleHumano: '4,4 GB usados de 10 GB visibles por el agente.',
        metadatos: {
          usadoGb: 4.4,
          totalGb: 10
        }
      }
    ]
  });
  const serializado = lote.serializar();

  assert.equal(serializado.emitidoEnUtc, '2026-07-07T10:30:00.000Z');
  assert.equal(serializado.catalogo.revision, 'cat_20260707_001');
  assert.equal(serializado.catalogo.senales[0].categoria, 'sistema');
  assert.equal(serializado.catalogo.senales[0].tipoDato, 'numero');
  assert.equal(serializado.observaciones.length, 1);
  assert.equal(serializado.observaciones[0].codigoSenal, 'sistema.ram.uso');
  assert.equal(serializado.observaciones[0].valorNumero, 44);
  assert.equal(serializado.observaciones[0].metadatos.usadoGb, 4.4);

  const senal = crearSenalTelemetriaAgente({
    categoria: 'ambiente',
    clave: 'temperatura',
    tag: 'camara-frigorifica',
    tipoDato: TIPOS_DATO_TELEMETRIA_AGENTE.NUMERO,
    unidad: 'ºC',
    consolidadaEnUtc: '2026-07-07T10:31:00Z'
  }).serializar();

  assert.equal(senal.codigoSenal, 'ambiente.temperatura:camara-frigorifica');
  assert.equal(senal.consolidadaEnUtc, '2026-07-07T10:31:00.000Z');

  const resultado = crearResultadoIngestaTelemetria({
    requestId: 'req_telemetria_5_20_2a',
    aceptadas: 1,
    rechazadas: 1,
    errores: [
      {
        indice: 1,
        code: 'conflicto_semantico_senal',
        message: 'La señal ya está consolidada con otra unidad.',
        campo: 'unidad'
      }
    ],
    recibidoEnUtc: '2026-07-07T10:32:00Z'
  }).serializar();

  assert.equal(resultado.ok, false);
  assert.equal(resultado.resultado, 'parcial');
  assert.equal(resultado.aceptadas, 1);
  assert.equal(resultado.rechazadas, 1);
  assert.equal(resultado.errores[0].campo, 'unidad');

  assert.throws(
    () =>
      crearLoteTelemetriaAgente({
        observaciones: [
          {
            categoria: 'sistema',
            clave: 'cpu.uso',
            tipoDato: 'temperatura',
            observadoEnUtc: '2026-07-07T10:33:00Z'
          }
        ]
      }),
    /tipo de dato/
  );

  console.log('[agentes-telemetria] dominio base verificado.');
}

function verificarValidacionValorTelemetriaAgente() {
  const base = {
    categoria: 'sistema',
    clave: 'senal.prueba',
    observadoEnUtc: '2026-07-07T10:40:00Z'
  };
  const casosValidos = [
    {
      tipoDato: TIPOS_DATO_TELEMETRIA_AGENTE.NUMERO,
      valorNumero: 0
    },
    {
      tipoDato: TIPOS_DATO_TELEMETRIA_AGENTE.BOOLEANO,
      valorBooleano: false
    },
    {
      tipoDato: TIPOS_DATO_TELEMETRIA_AGENTE.TEXTO,
      valorTexto: 'texto operativo'
    },
    {
      tipoDato: TIPOS_DATO_TELEMETRIA_AGENTE.ESTADO,
      valorEstado: 'cerrada'
    },
    {
      tipoDato: TIPOS_DATO_TELEMETRIA_AGENTE.JSON,
      valorJson: {
        usadoGb: 4.4,
        totalGb: 10
      }
    }
  ];

  for (const casoValido of casosValidos) {
    const serializada = crearLoteTelemetriaAgente({
      observaciones: [
        {
          ...base,
          ...casoValido
        }
      ]
    }).serializar().observaciones[0];

    assert.equal(serializada.tipoDato, casoValido.tipoDato);
  }

  assert.throws(
    () =>
      crearLoteTelemetriaAgente({
        observaciones: [
          {
            ...base,
            tipoDato: TIPOS_DATO_TELEMETRIA_AGENTE.NUMERO
          }
        ]
      }),
    /exactamente un campo de valor/
  );
  assert.throws(
    () =>
      crearLoteTelemetriaAgente({
        observaciones: [
          {
            ...base,
            tipoDato: TIPOS_DATO_TELEMETRIA_AGENTE.NUMERO,
            valorNumero: 1,
            valorEstado: 'abierta'
          }
        ]
      }),
    /exactamente un campo de valor/
  );
  assert.throws(
    () =>
      crearLoteTelemetriaAgente({
        observaciones: [
          {
            ...base,
            tipoDato: TIPOS_DATO_TELEMETRIA_AGENTE.NUMERO,
            valorEstado: 'abierta'
          }
        ]
      }),
    /debe usar valorNumero/
  );
  assert.throws(
    () =>
      crearLoteTelemetriaAgente({
        observaciones: [
          {
            ...base,
            tipoDato: TIPOS_DATO_TELEMETRIA_AGENTE.NUMERO,
            valorNumero: '42'
          }
        ]
      }),
    /valor numérico/
  );
  assert.throws(
    () =>
      crearLoteTelemetriaAgente({
        observaciones: [
          {
            ...base,
            tipoDato: TIPOS_DATO_TELEMETRIA_AGENTE.BOOLEANO,
            valorBooleano: 'true'
          }
        ]
      }),
    /valor booleano/
  );
  assert.throws(
    () =>
      crearLoteTelemetriaAgente({
        observaciones: [
          {
            ...base,
            tipoDato: TIPOS_DATO_TELEMETRIA_AGENTE.JSON,
            valorJson: 'no-es-json-estructurado'
          }
        ]
      }),
    /valor JSON/
  );

  console.log('[agentes-telemetria] validación de valores verificada.');
}

function verificarSemanticaOperativaTelemetriaAgente() {
  const lectura = crearLoteTelemetriaAgente({
    observaciones: [
      {
        categoria: 'ambiente',
        clave: 'temperatura',
        tag: 'camara-frigorifica',
        tipoDato: TIPOS_DATO_TELEMETRIA_AGENTE.NUMERO,
        unidad: 'ºC',
        observadoEnUtc: '2026-07-07T10:45:00Z',
        vigenteHastaUtc: '2026-07-07T10:50:00Z',
        valorNumero: 3.6,
        calidad: 'estimada',
        severidadDeclarada: 'aviso',
        origen: 'calculada',
        definicionSenal: {
          categoria: 'ambiente',
          clave: 'temperatura',
          tag: 'camara-frigorifica',
          tipoDato: TIPOS_DATO_TELEMETRIA_AGENTE.NUMERO,
          unidad: 'ºC',
          nombreHumano: 'Temperatura de cámara frigorífica'
        },
        metadatos: {
          sensor: 'sensor-principal',
          metodo: 'promedio'
        }
      }
    ]
  }).serializar().observaciones[0];

  assert.equal(lectura.calidad, 'estimada');
  assert.equal(lectura.severidadDeclarada, 'aviso');
  assert.equal(lectura.origen, 'calculada');
  assert.equal(lectura.vigenteHastaUtc, '2026-07-07T10:50:00.000Z');
  assert.equal(lectura.definicionSenal.nombreHumano, 'Temperatura de cámara frigorífica');

  assert.throws(
    () =>
      crearLoteTelemetriaAgente({
        observaciones: [
          {
            categoria: 'ambiente',
            clave: 'temperatura',
            tag: 'camara-frigorifica',
            tipoDato: TIPOS_DATO_TELEMETRIA_AGENTE.NUMERO,
            unidad: 'ºC',
            observadoEnUtc: '2026-07-07T10:45:00Z',
            valorNumero: 3.6,
            definicionSenal: {
              categoria: 'ambiente',
              clave: 'humedad',
              tag: 'camara-frigorifica',
              tipoDato: TIPOS_DATO_TELEMETRIA_AGENTE.NUMERO,
              unidad: 'ºC'
            }
          }
        ]
      }),
    /no coincide.*clave/
  );
  assert.throws(
    () =>
      crearLoteTelemetriaAgente({
        observaciones: [
          {
            categoria: 'ambiente',
            clave: 'temperatura',
            tag: 'camara-frigorifica',
            tipoDato: TIPOS_DATO_TELEMETRIA_AGENTE.NUMERO,
            unidad: 'ºC',
            observadoEnUtc: '2026-07-07T10:45:00Z',
            valorNumero: 3.6,
            definicionSenal: {
              categoria: 'ambiente',
              clave: 'temperatura',
              tag: 'socket0',
              tipoDato: TIPOS_DATO_TELEMETRIA_AGENTE.NUMERO,
              unidad: 'ºC'
            }
          }
        ]
      }),
    /no coincide.*tag/
  );
  assert.throws(
    () =>
      crearLoteTelemetriaAgente({
        observaciones: [
          {
            categoria: 'ambiente',
            clave: 'temperatura',
            tag: 'camara-frigorifica',
            tipoDato: TIPOS_DATO_TELEMETRIA_AGENTE.NUMERO,
            unidad: 'ºC',
            observadoEnUtc: '2026-07-07T10:45:00Z',
            valorNumero: 3.6,
            definicionSenal: {
              categoria: 'ambiente',
              clave: 'temperatura',
              tag: 'camara-frigorifica',
              tipoDato: TIPOS_DATO_TELEMETRIA_AGENTE.NUMERO,
              unidad: '%'
            }
          }
        ]
      }),
    /no coincide.*unidad/
  );
  assert.throws(
    () =>
      crearLoteTelemetriaAgente({
        observaciones: [
          {
            categoria: 'ambiente',
            clave: 'temperatura',
            tipoDato: TIPOS_DATO_TELEMETRIA_AGENTE.NUMERO,
            unidad: 'ºC',
            observadoEnUtc: '2026-07-07T10:45:00Z',
            valorNumero: 3.6,
            calidad: 'perfecta'
          }
        ]
      }),
    /calidad/
  );
  assert.throws(
    () =>
      crearLoteTelemetriaAgente({
        observaciones: [
          {
            categoria: 'ambiente',
            clave: 'temperatura',
            tipoDato: TIPOS_DATO_TELEMETRIA_AGENTE.NUMERO,
            unidad: 'ºC',
            observadoEnUtc: '2026-07-07T10:45:00Z',
            valorNumero: 3.6,
            metadatos: {
              relleno: 'x'.repeat(2100)
            }
          }
        ]
      }),
    /JSON/
  );

  console.log('[agentes-telemetria] semántica operativa verificada.');
}

async function verificarEndpointTelemetriaAgentes() {
  const llamadasIngesta = [];
  const llamadasContextoIngesta = [];
  const servicioAutenticacionAgentes = {
    async obtenerContextoIngestaTelemetria(parametros) {
      llamadasContextoIngesta.push(parametros);
      assert.equal(parametros.sessionToken, 'token_telemetria_valido');

      return {
        agente: {
          id: 77,
          guid: '123e4567-e89b-42d3-a456-426614170000',
          nombre: 'Agente telemetría'
        },
        sesion: {
          agenteId: 77,
          sessionId: 'ags_telemetria_actual',
          sessionTokenHash: 'd'.repeat(64)
        },
        ttlRestanteSegundos: 600,
        periodoVidaPol: {
          id: 901,
          agenteId: 77,
          sesionIdDiagnostico: 'ags_telemetria_actual',
          sesionHuellaSha256: 'd'.repeat(64)
        },
        coordinacion: {
          accion: 'refresh_config',
          requiereRefreshSesion: false,
          requiereConfiguracion: true,
          revisionConfiguracionActual: 'cfg_actual',
          requierePolitica: false,
          revisionPoliticaActual: null
        }
      };
    }
  };
  const servicioIngestaTelemetriaAgentes = {
    async ingestarLote(parametros) {
      llamadasIngesta.push(parametros);

      return {
        resultado: crearResultadoIngestaTelemetria({
          ok: true,
          resultado: 'aceptado',
          requestId: parametros.requestId,
          serverTimeUtc: '2026-07-07T10:20:00Z',
          recibidoEnUtc: parametros.recibidoEnUtc,
          aceptadas: 1,
          rechazadas: 0,
          errores: [],
          coordinacion: {
            agenteId: parametros.agenteId
          }
        }).serializar()
      };
    }
  };
  const servidor = await arrancarServidorApiAgentes({
    servicio: servicioAutenticacionAgentes,
    servicioIngestaTelemetriaAgentes
  });

  try {
    const sinBearer = await fetch(`${servidor.url}/api/agentes/v1/telemetria`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ observaciones: [] })
    });
    const cuerpoSinBearer = await sinBearer.json();

    assert.equal(sinBearer.status, 401);
    assert.equal(cuerpoSinBearer.code, 'bearer_requerido');

    const conBearer = await fetch(`${servidor.url}/api/agentes/v1/telemetria`, {
      method: 'POST',
      headers: {
        authorization: 'Bearer token_telemetria_valido',
        'content-type': 'application/json'
      },
      body: JSON.stringify({
        telemetriaRequestId: generarUuidV7Auditoria(),
        revisionConfiguracionConocida: 'cfg_antigua',
        observaciones: [
          {
            categoria: 'sistema',
            clave: 'cpu',
            tipoDato: TIPOS_DATO_TELEMETRIA_AGENTE.NUMERO,
            unidad: '%',
            observadoEnUtc: '2026-07-07T10:19:00Z',
            valorNumero: 51
          }
        ]
      })
    });
    const cuerpoConBearer = await conBearer.json();

    assert.equal(conBearer.status, 200);
    assert.equal(cuerpoConBearer.ok, true);
    assert.equal(cuerpoConBearer.resultado, 'aceptado');
    assert.equal(cuerpoConBearer.aceptadas, 1);
    assert.equal(cuerpoConBearer.coordinacion.accion, 'refresh_config');
    assert.equal(cuerpoConBearer.coordinacion.requiereConfiguracion, true);
    assert.equal(
      cuerpoConBearer.coordinacion.revisionConfiguracionActual,
      'cfg_actual'
    );
    assert.equal(llamadasContextoIngesta.length, 1);
    assert.equal(
      llamadasContextoIngesta[0].revisionConfiguracionConocida,
      'cfg_antigua'
    );
    assert.equal(llamadasIngesta.length, 1);
    assert.equal(llamadasIngesta[0].agenteId, 77);
    assert.equal(llamadasIngesta[0].periodoVidaPolId, 901);
    assert.equal(llamadasIngesta[0].sesionIdDiagnostico, 'ags_telemetria_actual');
    assert.equal(llamadasIngesta[0].sesionHuellaSha256, 'd'.repeat(64));
    assert.ok(llamadasIngesta[0].requestId.startsWith('req_'));
  } finally {
    await servidor.cerrar();
  }

  console.log('[agentes-telemetria] endpoint HTTP verificado.');
}

async function verificarEndpointTelemetriaEndToEnd({
  clienteSql,
  repositorioAgentes,
  repositorioSesionesAgentesRedis,
  generadorCredenciales,
  ids
}) {
  const { agente, secreto } = await crearAgenteTemporal({
    repositorioAgentes,
    generadorCredenciales,
    ids,
    nombre: 'Agente telemetria end-to-end'
  });
  const servicio = crearServicioAutenticacion({
    repositorioAgentes,
    repositorioSesionesAgentesRedis
  });
  const repositorioCatalogoSenales = new RepositorioCatalogoSenalesTelemetriaAgentes(
    clienteSql
  );
  const repositorioObservaciones = new RepositorioObservacionesTelemetriaAgentes(
    clienteSql
  );
  const repositorioEstadoActual = new RepositorioEstadoActualTelemetriaAgentes(
    clienteSql
  );
  const repositorioIdempotenciaLotes =
    new RepositorioIdempotenciaLotesTelemetriaAgentes(clienteSql);
  const servicioIngestaTelemetriaAgentes = new ServicioIngestaTelemetriaAgentes({
    repositorioCatalogoSenales,
    repositorioObservaciones,
    repositorioEstadoActual,
    repositorioIdempotenciaLotes
  });
  const servidor = await arrancarServidorApiAgentes({
    servicio,
    servicioIngestaTelemetriaAgentes
  });
  const login = await servicio.autenticar({
    guid: agente.guid,
    secreto,
    bootId: 'boot-telemetria-e2e',
    hostname: 'host-telemetria-e2e',
    versionAgente: 'beta-0.5.30C'
  });
  const periodoAntes = await repositorioAgentes.buscarPeriodoVidaPolAbierto(
    agente.id
  );
  const sesionRedisAntesTelemetria =
    await repositorioSesionesAgentesRedis.diagnosticarSesionPorToken(
      login.sessionToken
    );

  assert.ok(periodoAntes);
  assert.equal(periodoAntes.id, login.periodoVidaPol.id);
  assert.equal(sesionRedisAntesTelemetria.estado, 'viva');
  assert.equal(sesionRedisAntesTelemetria.sesion.sessionId, login.sesion.sessionId);

  try {
    const sinBearer = await postTelemetriaEndToEnd({
      servidor,
      body: crearLoteTelemetriaCpu({
        observadoEnUtc: '2026-07-08T10:00:00Z',
        valorNumero: 41
      })
    });
    const cuerpoSinBearer = await sinBearer.json();

    assert.equal(sinBearer.status, 401);
    assert.equal(cuerpoSinBearer.code, 'bearer_requerido');

    const loteValido = await postTelemetriaEndToEnd({
      servidor,
      sessionToken: login.sessionToken,
      body: crearLoteTelemetriaCpu({
        observadoEnUtc: '2026-07-08T10:01:00Z',
        valorNumero: 42,
        incluirCatalogo: true
      })
    });
    const cuerpoValido = await loteValido.json();

    assert.equal(loteValido.status, 200, JSON.stringify(cuerpoValido));
    assert.equal(cuerpoValido.ok, true);
    assert.equal(cuerpoValido.resultado, 'aceptado');
    assert.equal(cuerpoValido.aceptadas, 1);
    assert.equal(cuerpoValido.rechazadas, 0);
    assert.equal(cuerpoValido.errores.length, 0);
    assert.equal(cuerpoValido.coordinacion.accion, 'continue');

    let observaciones = await repositorioObservaciones.listarPorAgenteYRango({
      agenteId: agente.id,
      desdeUtc: '2026-07-08T10:00:00Z',
      hastaUtc: '2026-07-08T10:04:00Z',
      orden: 'asc'
    });
    assert.equal(observaciones.length, 1);
    assert.equal(observaciones[0].valorNumero, 42);
    assert.equal(observaciones[0].periodoVidaPolId, periodoAntes.id);
    assert.equal(observaciones[0].sesionIdDiagnostico, login.sesion.sessionId);
    assert.equal(
      observaciones[0].sesionHuellaSha256,
      periodoAntes.sesionHuellaSha256
    );

    let fotografiaActual = await repositorioEstadoActual.listarPorAgente(
      agente.id
    );
    assert.equal(fotografiaActual.length, 1);
    assert.equal(fotografiaActual[0].valorNumero, 42);
    assert.equal(fotografiaActual[0].periodoVidaPolId, periodoAntes.id);

    const loteParcial = await postTelemetriaEndToEnd({
      servidor,
      sessionToken: login.sessionToken,
      body: {
        telemetriaRequestId: generarUuidV7Auditoria(),
        emitidoEnUtc: '2026-07-08T10:04:00Z',
        observaciones: [
          crearObservacionTelemetriaCpu({
            observadoEnUtc: '2026-07-08T10:02:00Z',
            valorNumero: 55
          }),
          crearObservacionTelemetriaCpu({
            observadoEnUtc: '2026-07-08T10:03:00Z',
            valorNumero: 12,
            unidad: 'ms'
          })
        ]
      }
    });
    const cuerpoParcial = await loteParcial.json();

    assert.equal(loteParcial.status, 200);
    assert.equal(cuerpoParcial.ok, false);
    assert.equal(cuerpoParcial.resultado, 'parcial');
    assert.equal(cuerpoParcial.aceptadas, 1);
    assert.equal(cuerpoParcial.rechazadas, 1);
    assert.equal(cuerpoParcial.errores.length, 1);
    assert.equal(cuerpoParcial.errores[0].indice, 1);

    const sesionRedisDespuesTelemetria =
      await repositorioSesionesAgentesRedis.diagnosticarSesionPorToken(
        login.sessionToken
      );

    assert.equal(sesionRedisDespuesTelemetria.estado, 'viva');
    for (const campo of [
      'agenteId',
      'sessionId',
      'sessionTokenHash',
      'bootId',
      'hostname',
      'versionAgente'
    ]) {
      assert.equal(
        sesionRedisDespuesTelemetria.sesion[campo],
        sesionRedisAntesTelemetria.sesion[campo],
        `La telemetria no debe mutar la sesion Redis viva: ${campo}.`
      );
    }
    assert.ok(
      sesionRedisDespuesTelemetria.ttlRestanteSegundos <=
        sesionRedisAntesTelemetria.ttlRestanteSegundos,
      'La telemetria no debe renovar ni aumentar el TTL de la sesion Redis.'
    );
    assert.ok(
      sesionRedisDespuesTelemetria.ttlRestanteSegundos > 0,
      'La sesion Redis debe seguir viva tras ingerir telemetria.'
    );

    observaciones = await repositorioObservaciones.listarPorAgenteYRango({
      agenteId: agente.id,
      desdeUtc: '2026-07-08T10:00:00Z',
      hastaUtc: '2026-07-08T10:04:00Z',
      orden: 'asc'
    });
    assert.equal(observaciones.length, 2);
    assert.deepEqual(
      observaciones.map((observacion) => observacion.valorNumero),
      [42, 55]
    );

    fotografiaActual = await repositorioEstadoActual.listarPorAgente(agente.id);
    assert.equal(fotografiaActual.length, 1);
    assert.equal(fotografiaActual[0].valorNumero, 55);

    const periodoDespuesTelemetria =
      await repositorioAgentes.buscarPeriodoVidaPolAbierto(agente.id);
    assert.equal(periodoDespuesTelemetria.id, periodoAntes.id);
    assert.equal(
      periodoDespuesTelemetria.heartbeatsRecibidos,
      periodoAntes.heartbeatsRecibidos
    );
    assert.equal(periodoDespuesTelemetria.ultimoSeq, periodoAntes.ultimoSeq);
    assert.equal(periodoDespuesTelemetria.finUtc, null);

    await repositorioSesionesAgentesRedis.invalidarSesionActualAgente(agente.id);

    const sesionCaducada = await postTelemetriaEndToEnd({
      servidor,
      sessionToken: login.sessionToken,
      body: crearLoteTelemetriaCpu({
        observadoEnUtc: '2026-07-08T10:04:00Z',
        valorNumero: 61
      })
    });
    const cuerpoSesionCaducada = await sesionCaducada.json();

    assert.equal(sesionCaducada.status, 403);
    assert.equal(cuerpoSesionCaducada.code, 'sesion_no_vigente');
    assert.equal(cuerpoSesionCaducada.action, 'login_required');

    observaciones = await repositorioObservaciones.listarPorAgenteYRango({
      agenteId: agente.id,
      desdeUtc: '2026-07-08T10:00:00Z',
      hastaUtc: '2026-07-08T10:05:00Z',
      orden: 'asc'
    });
    assert.equal(observaciones.length, 2);
  } finally {
    await servidor.cerrar();
  }

  console.log('[agentes-telemetria] endpoint end-to-end verificado.');
}

async function postTelemetriaEndToEnd({
  servidor,
  sessionToken = null,
  body
}) {
  const headers = { 'content-type': 'application/json' };

  if (sessionToken) {
    headers.authorization = `Bearer ${sessionToken}`;
  }

  return fetch(`${servidor.url}/api/agentes/v1/telemetria`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body)
  });
}

function crearLoteTelemetriaCpu({
  observadoEnUtc,
  valorNumero,
  incluirCatalogo = false,
  emitidoEnUtc = calcularEmitidoEnUtcDesdeObservado(observadoEnUtc)
}) {
  return {
    telemetriaRequestId: generarUuidV7Auditoria(),
    emitidoEnUtc,
    catalogo: incluirCatalogo
      ? {
          senales: [
            {
              categoria: 'sistema',
              clave: 'cpu',
              tag: 'socket0',
              tipoDato: TIPOS_DATO_TELEMETRIA_AGENTE.NUMERO,
              unidad: '%',
              nombreHumano: 'CPU socket 0'
            }
          ]
        }
      : undefined,
    observaciones: [
      crearObservacionTelemetriaCpu({
        observadoEnUtc,
        valorNumero
      })
    ]
  };
}

function calcularEmitidoEnUtcDesdeObservado(observadoEnUtc) {
  const observadoMs = new Date(observadoEnUtc).getTime();

  if (Number.isNaN(observadoMs)) {
    return null;
  }

  return new Date(observadoMs + 60_000).toISOString();
}

function crearObservacionTelemetriaCpu({
  observadoEnUtc,
  valorNumero,
  unidad = '%'
}) {
  return {
    categoria: 'sistema',
    clave: 'cpu',
    tag: 'socket0',
    tipoDato: TIPOS_DATO_TELEMETRIA_AGENTE.NUMERO,
    unidad,
    observadoEnUtc,
    valorNumero
  };
}

async function verificarContextoIngestaTelemetriaCoordinaSesionYConfiguracion() {
  const crearServicio = ({ ttlRestanteSegundos }) =>
    new ServicioAutenticacionAgentes({
      repositorioAgentes: {
        async buscarPorId(idAgente) {
          return {
            id: idAgente,
            estadoAdministrativo: 'activo'
          };
        },
        async buscarPeriodoVidaPolAbierto(agenteId) {
          return {
            id: 321,
            agenteId,
            sesionIdDiagnostico: 'ags_contexto_ingesta',
            sesionHuellaSha256: 'e'.repeat(64)
          };
        }
      },
      repositorioSesionesAgentesRedis: {
        async diagnosticarSesionPorToken(sessionToken) {
          assert.equal(sessionToken, 'token_contexto_ingesta');

          return {
            estado: 'viva',
            ttlRestanteSegundos,
            sesion: {
              agenteId: 88,
              sessionId: 'ags_contexto_ingesta',
              sessionTokenHash: 'e'.repeat(64)
            }
          };
        }
      },
      servicioConfiguracionPortal: {
        async asegurarActualizada() {
          return {
            obtenerConfiguracionAgentes: () => ({
              sessionTtlSegundos: 900
            })
          };
        },
        obtenerVersionActual() {
          return 'cfg_actual_ingesta';
        }
      }
    });

  const contextoRefreshSesion = await crearServicio({
    ttlRestanteSegundos: 60
  }).obtenerContextoIngestaTelemetria({
    sessionToken: 'token_contexto_ingesta',
    revisionConfiguracionConocida: 'cfg_antigua'
  });

  assert.equal(contextoRefreshSesion.periodoVidaPol.id, 321);
  assert.equal(contextoRefreshSesion.coordinacion.accion, 'refresh_session');
  assert.equal(contextoRefreshSesion.coordinacion.requiereRefreshSesion, true);
  assert.equal(contextoRefreshSesion.coordinacion.requiereConfiguracion, true);
  assert.equal(
    contextoRefreshSesion.coordinacion.revisionConfiguracionActual,
    'cfg_actual_ingesta'
  );

  const contextoRefreshConfig = await crearServicio({
    ttlRestanteSegundos: 600
  }).obtenerContextoIngestaTelemetria({
    sessionToken: 'token_contexto_ingesta',
    revisionConfiguracionConocida: 'cfg_antigua'
  });

  assert.equal(contextoRefreshConfig.coordinacion.accion, 'refresh_config');
  assert.equal(contextoRefreshConfig.coordinacion.requiereRefreshSesion, false);
  assert.equal(contextoRefreshConfig.coordinacion.requiereConfiguracion, true);

  console.log('[agentes-telemetria] contexto de coordinación verificado.');
}

function extraerPathsOpenApiAgentes(openapiYaml) {
  const paths = new Map();
  let rutaActual = null;
  let dentroPaths = false;

  for (const linea of openapiYaml.split(/\r?\n/)) {
    if (linea === 'paths:') {
      dentroPaths = true;
      continue;
    }

    if (dentroPaths && /^components:/.test(linea)) {
      break;
    }

    if (!dentroPaths) {
      continue;
    }

    const coincidenciaRuta = linea.match(/^  (\/api\/agentes\/v1\/[^:]+):\s*$/);
    if (coincidenciaRuta) {
      rutaActual = coincidenciaRuta[1];
      continue;
    }

    const coincidenciaMetodo = linea.match(/^    (get|post|put|patch|delete):\s*$/);
    if (rutaActual && coincidenciaMetodo) {
      paths.set(rutaActual, coincidenciaMetodo[1]);
      rutaActual = null;
    }
  }

  return paths;
}

function extraerRutasExpressApiAgentes(rutasApi) {
  return Array.from(
    rutasApi.matchAll(/router\.(get|post|put|patch|delete)\(\s*\n\s*'([^']+)'/g)
  ).map((coincidencia) => ({
    metodo: coincidencia[1],
    ruta: coincidencia[2]
  }));
}

function extraerBloqueOpenApiPath(openapiYaml, ruta) {
  const marcador = `  ${ruta}:\n`;
  const inicio = openapiYaml.indexOf(marcador);

  assert.notEqual(inicio, -1, `No se encontró el path OpenAPI ${ruta}.`);

  const resto = openapiYaml.slice(inicio + marcador.length);
  const siguientePath = resto.search(/\n  \/api\/agentes\/v1\/[^:]+:\s*\n/);
  const fin = siguientePath === -1
    ? openapiYaml.indexOf('\ncomponents:', inicio)
    : inicio + marcador.length + siguientePath;

  assert.notEqual(fin, -1, `No se encontró cierre del path OpenAPI ${ruta}.`);

  return openapiYaml.slice(inicio, fin);
}

function extraerFragmentoFuente(contenido, marcadorInicio, marcadorFin) {
  const inicio = contenido.indexOf(marcadorInicio);

  assert.notEqual(
    inicio,
    -1,
    `No se encontró el marcador de inicio en fuente: ${marcadorInicio}.`
  );

  const fin = contenido.indexOf(marcadorFin, inicio + marcadorInicio.length);

  assert.notEqual(
    fin,
    -1,
    `No se encontró el marcador de fin en fuente: ${marcadorFin}.`
  );

  return contenido.slice(inicio, fin);
}

function extraerBloqueRouterGet(contenido, ruta) {
  const inicioRuta = contenido.indexOf(`'${ruta}'`);
  assert.notEqual(inicioRuta, -1, `No se encontró la ruta ${ruta}.`);

  const inicioRouter = contenido.lastIndexOf('router.get(', inicioRuta);
  const finRouter = contenido.indexOf('\n  );', inicioRuta);

  assert.notEqual(inicioRouter, -1, `No se encontró router.get para ${ruta}.`);
  assert.notEqual(finRouter, -1, `No se encontró cierre de router.get para ${ruta}.`);

  return contenido.slice(inicioRouter, finRouter);
}

async function verificarLoginCorrectoYMe({
  repositorioAgentes,
  repositorioSesionesAgentesRedis,
  generadorCredenciales,
  ids
}) {
  const { agente, secreto } = await crearAgenteTemporal({
    repositorioAgentes,
    generadorCredenciales,
    ids,
    nombre: 'Agente login correcto'
  });
  const servicio = crearServicioAutenticacion({
    repositorioAgentes,
    repositorioSesionesAgentesRedis
  });
  const login = await servicio.autenticar({
    guid: agente.guid,
    secreto,
    bootId: 'boot-login-correcto',
    hostname: 'host-login-correcto',
    versionAgente: 'beta-0.5.30C'
  });

  assert.equal(login.agente.id, agente.id);
  assert.ok(login.sessionToken.startsWith('sat_'));
  assert.equal(login.periodoVidaPol.agenteId, agente.id);
  assert.equal(login.periodoVidaPol.finUtc, null);

  const agenteTrasLogin = await repositorioAgentes.buscarPorId(agente.id);
  assert.equal(agenteTrasLogin.estadoVidaPol, 'vivo');
  assert.equal(agenteTrasLogin.ultimoHeartbeatUtc, null);

  const inspeccion = await servicio.inspeccionarSesionViva(login.sessionToken);
  assert.equal(inspeccion.agente.id, agente.id);
  assert.equal(inspeccion.sesion.sessionId, login.sesion.sessionId);
  assert.ok(inspeccion.ttlRestanteSegundos > 0);

  console.log('[agentes-login] login correcto y me con sesion viva');
}

async function verificarSesionReemplazadaYPol({
  clienteSql,
  repositorioAgentes,
  repositorioSesionesAgentesRedis,
  generadorCredenciales,
  ids
}) {
  const { agente, secreto } = await crearAgenteTemporal({
    repositorioAgentes,
    generadorCredenciales,
    ids,
    nombre: 'Agente sesion reemplazada'
  });
  const servicio = crearServicioAutenticacion({
    repositorioAgentes,
    repositorioSesionesAgentesRedis
  });
  const loginInicial = await servicio.autenticar({
    guid: agente.guid,
    secreto,
    bootId: 'boot-reemplazo-a',
    hostname: 'host-reemplazo'
  });
  const loginNuevo = await servicio.autenticar({
    guid: agente.guid,
    secreto,
    sessionIdAnterior: loginInicial.sesion.sessionId,
    bootId: 'boot-reemplazo-b',
    hostname: 'host-reemplazo'
  });

  assert.notEqual(loginInicial.sesion.sessionId, loginNuevo.sesion.sessionId);

  await assert.rejects(
    () => servicio.inspeccionarSesionViva(loginInicial.sessionToken),
    (error) => error.codigo === 'sesion_no_vigente'
  );

  const periodos = await clienteSql.consultar(
    `
      SELECT fin_utc, motivo_cierre
      FROM periodos_vida_pol_agentes
      WHERE agente_id = ?
      ORDER BY id ASC
    `,
    [agente.id]
  );

  assert.equal(periodos.length, 2);
  assert.ok(periodos[0].fin_utc);
  assert.equal(periodos[0].motivo_cierre, 'sesion_reemplazada');
  assert.equal(periodos[1].fin_utc, null);

  console.log('[agentes-login] reemplazo de sesion y POL coherente');
}

async function verificarRefreshValido({
  clienteSql,
  repositorioAgentes,
  repositorioSesionesAgentesRedis,
  generadorCredenciales,
  ids
}) {
  const { agente, secreto } = await crearAgenteTemporal({
    repositorioAgentes,
    generadorCredenciales,
    ids,
    nombre: 'Agente refresh correcto'
  });
  const servicio = crearServicioAutenticacion({
    repositorioAgentes,
    repositorioSesionesAgentesRedis
  });
  const login = await servicio.autenticar({
    guid: agente.guid,
    secreto,
    bootId: 'boot-refresh-correcto',
    hostname: 'host-refresh-correcto',
    versionAgente: 'beta-0.5.30C'
  });
  const refresh = await servicio.renovarSesion({
    sessionToken: login.sessionToken,
    sessionIdActual: login.sesion.sessionId,
    bootId: 'boot-refresh-correcto',
    revisionConfiguracionConocida: null,
    revisionPoliticaConocida: null
  });
  const publico = refresh.obtenerRespuestaPublica();

  assert.equal(publico.agente.id, agente.id);
  assert.notEqual(publico.sesion.sessionId, login.sesion.sessionId);
  assert.ok(publico.sesion.sessionToken.startsWith('sat_'));
  assert.equal(publico.sesion.previousSessionId, login.sesion.sessionId);
  assert.equal(publico.pol.periodoId, login.periodoVidaPol.id);
  assert.equal(publico.coordinacion.requiereConfiguracion, false);
  assert.equal(publico.coordinacion.revisionConfiguracionActual, null);
  assert.equal(publico.coordinacion.requierePolitica, false);
  assert.equal(publico.coordinacion.revisionPoliticaActual, null);

  await assert.rejects(
    () => servicio.inspeccionarSesionViva(login.sessionToken),
    (error) => error.codigo === 'sesion_no_vigente'
  );

  const inspeccionNueva = await servicio.inspeccionarSesionViva(
    publico.sesion.sessionToken
  );
  assert.equal(inspeccionNueva.sesion.sessionId, publico.sesion.sessionId);

  const heartbeatTrasRefresh = await servicio.registrarHeartbeat({
    sessionToken: publico.sesion.sessionToken,
    seq: 1,
    bootId: 'boot-refresh-correcto',
    timestampClienteUtc: new Date().toISOString(),
    uptimeSeconds: 60
  });
  const heartbeatPublico = heartbeatTrasRefresh.obtenerRespuestaPublica();
  assert.equal(heartbeatPublico.heartbeat.seqAceptado, 1);
  assert.equal(heartbeatPublico.pol.periodoId, login.periodoVidaPol.id);

  const agenteActualizado = await repositorioAgentes.buscarPorId(agente.id);
  assert.equal(
    agenteActualizado.ultimaSesionIdDiagnostico,
    publico.sesion.sessionId
  );

  const periodos = await clienteSql.consultar(
    `
      SELECT id, sesion_id_diagnostico, sesion_huella_sha256, fin_utc, ultimo_seq
      FROM periodos_vida_pol_agentes
      WHERE agente_id = ?
      ORDER BY id ASC
    `,
    [agente.id]
  );

  assert.equal(periodos.length, 1);
  assert.equal(periodos[0].id, login.periodoVidaPol.id);
  assert.equal(periodos[0].sesion_id_diagnostico, publico.sesion.sessionId);
  assert.match(periodos[0].sesion_huella_sha256, /^[0-9a-f]{64}$/);
  assert.equal(periodos[0].fin_utc, null);
  assert.equal(periodos[0].ultimo_seq, 1);

  console.log('[agentes-refresh] refresh valido renueva token y conserva POL');
}

async function verificarRefreshHttpReal({
  repositorioAgentes,
  repositorioSesionesAgentesRedis,
  generadorCredenciales,
  ids
}) {
  const { agente, secreto } = await crearAgenteTemporal({
    repositorioAgentes,
    generadorCredenciales,
    ids,
    nombre: 'Agente refresh HTTP'
  });
  const servicio = crearServicioAutenticacion({
    repositorioAgentes,
    repositorioSesionesAgentesRedis
  });
  const login = await servicio.autenticar({
    guid: agente.guid,
    secreto,
    bootId: 'boot-refresh-http',
    hostname: 'host-refresh-http',
    versionAgente: 'beta-0.5.30C'
  });
  const servidor = await arrancarServidorApiAgentes({ servicio });

  try {
    const respuesta = await fetch(
      `${servidor.url}/api/agentes/v1/session/refresh`,
      {
        method: 'POST',
        headers: {
          authorization: `Bearer ${login.sessionToken}`,
          'content-type': 'application/json'
        },
        body: JSON.stringify({
          refreshRequestId: generarUuidV7Auditoria(),
          sessionIdActual: login.sesion.sessionId,
          bootId: 'boot-refresh-http'
        })
      }
    );
    const cuerpo = await respuesta.json();

    assert.equal(respuesta.status, 200);
    assert.equal(cuerpo.ok, true);
    assert.equal(cuerpo.agente.id, agente.id);
    assert.notEqual(cuerpo.sesion.sessionId, login.sesion.sessionId);
    assert.ok(cuerpo.sesion.sessionToken.startsWith('sat_'));
    assert.equal(cuerpo.sesion.previousSessionId, login.sesion.sessionId);
    assert.equal(cuerpo.pol.estadoVidaPol, 'vivo');

    await assert.rejects(
      () => servicio.inspeccionarSesionViva(login.sessionToken),
      (error) => error.codigo === 'sesion_no_vigente'
    );

    const inspeccionNueva = await servicio.inspeccionarSesionViva(
      cuerpo.sesion.sessionToken
    );
    assert.equal(inspeccionNueva.sesion.sessionId, cuerpo.sesion.sessionId);
  } finally {
    await servidor.cerrar();
  }

  console.log('[agentes-refresh] endpoint HTTP real renueva sesion');
}

async function verificarHeartbeatValido({
  clienteSql,
  repositorioAgentes,
  repositorioSesionesAgentesRedis,
  generadorCredenciales,
  ids
}) {
  const { agente, secreto } = await crearAgenteTemporal({
    repositorioAgentes,
    generadorCredenciales,
    ids,
    nombre: 'Agente heartbeat correcto'
  });
  const servicio = crearServicioAutenticacion({
    repositorioAgentes,
    repositorioSesionesAgentesRedis
  });
  const login = await servicio.autenticar({
    guid: agente.guid,
    secreto,
    bootId: 'boot-heartbeat-correcto',
    hostname: 'host-heartbeat-correcto',
    versionAgente: 'beta-0.5.30C'
  });
  const primerLatido = await servicio.registrarHeartbeat({
    sessionToken: login.sessionToken,
    seq: 1,
    bootId: 'boot-heartbeat-correcto',
    timestampClienteUtc: new Date(Date.now() - 1000).toISOString(),
    uptimeSeconds: 42
  });
  const publico = primerLatido.obtenerRespuestaPublica();

  assert.equal(publico.agente.id, agente.id);
  assert.equal(publico.sesion.sessionId, login.sesion.sessionId);
  assert.equal(publico.heartbeat.seqAceptado, 1);
  assert.equal(publico.pol.periodoId, login.periodoVidaPol.id);
  assert.equal(publico.pol.heartbeatsRecibidos, 1);
  assert.equal(publico.pol.ultimoSeq, 1);
  assert.equal(publico.coordinacion.accion, 'continue');

  const inspeccion = await servicio.inspeccionarSesionViva(login.sessionToken);
  assert.equal(inspeccion.sesion.sessionId, login.sesion.sessionId);
  assert.equal(inspeccion.sesion.ultimoSeq, 1);
  assert.equal(inspeccion.sesion.uptimeSeconds, 42);
  assert.ok(inspeccion.sesion.ultimoHeartbeatUtc);

  const segundoLatido = await servicio.registrarHeartbeat({
    sessionToken: login.sessionToken,
    seq: 2,
    bootId: 'boot-heartbeat-correcto',
    uptimeSeconds: 43
  });
  const publicoSegundo = segundoLatido.obtenerRespuestaPublica();

  assert.equal(publicoSegundo.pol.heartbeatsRecibidos, 2);
  assert.equal(publicoSegundo.pol.ultimoSeq, 2);

  const agenteActualizado = await repositorioAgentes.buscarPorId(agente.id);
  assert.equal(agenteActualizado.ultimoSeq, 2);
  assert.ok(agenteActualizado.ultimoHeartbeatUtc);

  const periodos = await clienteSql.consultar(
    `
      SELECT heartbeats_recibidos, ultimo_seq, fin_utc
      FROM periodos_vida_pol_agentes
      WHERE agente_id = ?
      ORDER BY id ASC
    `,
    [agente.id]
  );

  assert.equal(periodos.length, 1);
  assert.equal(periodos[0].heartbeats_recibidos, 2);
  assert.equal(periodos[0].ultimo_seq, 2);
  assert.equal(periodos[0].fin_utc, null);

  console.log('[agentes-heartbeat] latido valido compacta POL y conserva sesion');
}

async function verificarHeartbeatDuplicado({
  clienteSql,
  repositorioAgentes,
  repositorioSesionesAgentesRedis,
  generadorCredenciales,
  ids
}) {
  const { agente, secreto } = await crearAgenteTemporal({
    repositorioAgentes,
    generadorCredenciales,
    ids,
    nombre: 'Agente heartbeat duplicado'
  });
  const servicio = crearServicioAutenticacion({
    repositorioAgentes,
    repositorioSesionesAgentesRedis
  });
  const login = await servicio.autenticar({
    guid: agente.guid,
    secreto,
    bootId: 'boot-heartbeat-duplicado'
  });

  await servicio.registrarHeartbeat({
    sessionToken: login.sessionToken,
    seq: 1,
    bootId: 'boot-heartbeat-duplicado'
  });

  await assert.rejects(
    () => servicio.registrarHeartbeat({
      sessionToken: login.sessionToken,
      seq: 1,
      bootId: 'boot-heartbeat-duplicado'
    }),
    (error) =>
      error.codigo === 'heartbeat_seq_antiguo' &&
      error.accion === 'continue'
  );

  const inspeccion = await servicio.inspeccionarSesionViva(login.sessionToken);
  assert.equal(inspeccion.sesion.sessionId, login.sesion.sessionId);

  const periodos = await clienteSql.consultar(
    `
      SELECT heartbeats_recibidos, ultimo_seq
      FROM periodos_vida_pol_agentes
      WHERE agente_id = ?
      ORDER BY id ASC
    `,
    [agente.id]
  );

  assert.equal(periodos.length, 1);
  assert.equal(periodos[0].heartbeats_recibidos, 1);
  assert.equal(periodos[0].ultimo_seq, 1);

  console.log('[agentes-heartbeat] latido duplicado falla sin relogin');
}

async function verificarHeartbeatBootIncoherente({
  repositorioAgentes,
  repositorioSesionesAgentesRedis,
  generadorCredenciales,
  ids
}) {
  const { agente, secreto } = await crearAgenteTemporal({
    repositorioAgentes,
    generadorCredenciales,
    ids,
    nombre: 'Agente heartbeat boot incoherente'
  });
  const servicio = crearServicioAutenticacion({
    repositorioAgentes,
    repositorioSesionesAgentesRedis
  });
  const login = await servicio.autenticar({
    guid: agente.guid,
    secreto,
    bootId: 'boot-heartbeat-original'
  });

  await assert.rejects(
    () => servicio.registrarHeartbeat({
      sessionToken: login.sessionToken,
      seq: 1,
      bootId: 'boot-heartbeat-distinto'
    }),
    (error) => error.codigo === 'boot_id_incoherente'
  );

  const inspeccion = await servicio.inspeccionarSesionViva(login.sessionToken);
  assert.equal(inspeccion.sesion.sessionId, login.sesion.sessionId);

  console.log('[agentes-heartbeat] bootId incoherente bloquea latido');
}

async function verificarHeartbeatSesionReemplazada({
  repositorioAgentes,
  repositorioSesionesAgentesRedis,
  generadorCredenciales,
  ids
}) {
  const { agente, secreto } = await crearAgenteTemporal({
    repositorioAgentes,
    generadorCredenciales,
    ids,
    nombre: 'Agente heartbeat reemplazado'
  });
  const servicio = crearServicioAutenticacion({
    repositorioAgentes,
    repositorioSesionesAgentesRedis
  });
  const loginInicial = await servicio.autenticar({
    guid: agente.guid,
    secreto,
    bootId: 'boot-heartbeat-reemplazo'
  });

  await servicio.autenticar({
    guid: agente.guid,
    secreto,
    sessionIdAnterior: loginInicial.sesion.sessionId,
    bootId: 'boot-heartbeat-reemplazo'
  });

  await assert.rejects(
    () => servicio.registrarHeartbeat({
      sessionToken: loginInicial.sessionToken,
      seq: 1,
      bootId: 'boot-heartbeat-reemplazo'
    }),
    (error) => error.codigo === 'sesion_no_vigente'
  );

  console.log('[agentes-heartbeat] sesion reemplazada fuerza relogin');
}

async function verificarHeartbeatPeriodoCerradoDuranteRegistro({
  repositorioAgentes,
  repositorioSesionesAgentesRedis,
  generadorCredenciales,
  ids
}) {
  const { agente, secreto } = await crearAgenteTemporal({
    repositorioAgentes,
    generadorCredenciales,
    ids,
    nombre: 'Agente heartbeat periodo cerrado'
  });
  const servicioLogin = crearServicioAutenticacion({
    repositorioAgentes,
    repositorioSesionesAgentesRedis
  });
  const login = await servicioLogin.autenticar({
    guid: agente.guid,
    secreto,
    bootId: 'boot-heartbeat-periodo-cerrado'
  });
  const repositorioConCarrera =
    crearRepositorioAgentesConCierrePeriodoHeartbeat(repositorioAgentes);
  const servicioConCarrera = crearServicioAutenticacion({
    repositorioAgentes: repositorioConCarrera,
    repositorioSesionesAgentesRedis
  });

  await assert.rejects(
    () => servicioConCarrera.registrarHeartbeat({
      sessionToken: login.sessionToken,
      seq: 1,
      bootId: 'boot-heartbeat-periodo-cerrado'
    }),
    (error) => error.codigo === 'sesion_no_vigente'
  );

  console.log('[agentes-heartbeat] periodo cerrado durante latido fuerza relogin');
}

async function verificarHeartbeatHttpReal({
  repositorioAgentes,
  repositorioSesionesAgentesRedis,
  generadorCredenciales,
  ids
}) {
  const { agente, secreto } = await crearAgenteTemporal({
    repositorioAgentes,
    generadorCredenciales,
    ids,
    nombre: 'Agente heartbeat HTTP'
  });
  const servicio = crearServicioAutenticacion({
    repositorioAgentes,
    repositorioSesionesAgentesRedis
  });
  const login = await servicio.autenticar({
    guid: agente.guid,
    secreto,
    bootId: 'boot-heartbeat-http',
    hostname: 'host-heartbeat-http',
    versionAgente: 'beta-0.5.30C'
  });
  const servidor = await arrancarServidorApiAgentes({ servicio });

  try {
    const respuesta = await fetch(
      `${servidor.url}/api/agentes/v1/heartbeat`,
      {
        method: 'POST',
        headers: {
          authorization: `Bearer ${login.sessionToken}`,
          'content-type': 'application/json'
        },
        body: JSON.stringify({
          seq: 1,
          bootId: 'boot-heartbeat-http',
          uptimeSeconds: 10
        })
      }
    );
    const cuerpo = await respuesta.json();

    assert.equal(respuesta.status, 200);
    assert.equal(cuerpo.ok, true);
    assert.equal(cuerpo.agente.id, agente.id);
    assert.equal(cuerpo.sesion.sessionId, login.sesion.sessionId);
    assert.equal(cuerpo.heartbeat.seqAceptado, 1);
    assert.equal(cuerpo.pol.estadoVidaPol, 'vivo');
    assert.equal(cuerpo.pol.heartbeatsRecibidos, 1);
    assert.equal(cuerpo.coordinacion.accion, 'continue');

    const respuestaDuplicada = await fetch(
      `${servidor.url}/api/agentes/v1/heartbeat`,
      {
        method: 'POST',
        headers: {
          authorization: `Bearer ${login.sessionToken}`,
          'content-type': 'application/json'
        },
        body: JSON.stringify({
          seq: 1,
          bootId: 'boot-heartbeat-http'
        })
      }
    );
    const cuerpoDuplicado = await respuestaDuplicada.json();

    assert.equal(respuestaDuplicada.status, 409);
    assert.equal(cuerpoDuplicado.code, 'heartbeat_seq_antiguo');
    assert.equal(cuerpoDuplicado.action, 'continue');
  } finally {
    await servidor.cerrar();
  }

  console.log('[agentes-heartbeat] endpoint HTTP real registra latido');
}

async function verificarConfiguracionEfectivaDominio({
  repositorioAgentes,
  repositorioSesionesAgentesRedis,
  generadorCredenciales,
  ids
}) {
  const { agente, secreto } = await crearAgenteTemporal({
    repositorioAgentes,
    generadorCredenciales,
    ids,
    nombre: 'Agente configuracion efectiva dominio'
  });
  const servicio = crearServicioAutenticacion({
    repositorioAgentes,
    repositorioSesionesAgentesRedis,
    configuracionAgentes: {
      sessionTtlSegundos: 777,
      heartbeatIntervalSegundos: 17,
      heartbeatGraceSegundos: 51,
      loginFallosMaximos: 5,
      cuarentenaSegundos: 60
    }
  });
  const login = await servicio.autenticar({
    guid: agente.guid,
    secreto,
    bootId: 'boot-configuracion-dominio',
    hostname: 'host-configuracion-dominio',
    versionAgente: 'beta-0.5.30C'
  });
  const resultado = await servicio.obtenerConfiguracionEfectiva({
    sessionToken: login.sessionToken
  });
  const publico = resultado.obtenerRespuestaPublica();

  assert.equal(publico.agente.id, agente.id);
  assert.equal(publico.sesion.sessionId, login.sesion.sessionId);
  assert.ok(publico.sesion.expiresInSeconds > 0);
  assert.ok(publico.sesion.expiresInSeconds <= 777);
  assert.equal(publico.sesion.sessionToken, undefined);
  assert.equal(publico.configuracion.revisionConfiguracion, null);
  assert.equal(publico.configuracion.revisionPolitica, null);
  assert.equal(publico.configuracion.politicaVida.sessionTtlSeconds, 777);
  assert.equal(publico.configuracion.politicaVida.refreshBeforeSeconds, 120);
  assert.equal(publico.configuracion.politicaVida.heartbeatIntervalSeconds, 17);
  assert.equal(publico.configuracion.politicaVida.heartbeatGraceSeconds, 51);
  assert.equal(
    publico.configuracion.capacidades.find(
      (capacidad) => capacidad.codigo === 'heartbeat'
    )?.habilitada,
    true
  );
  assert.equal(
    publico.configuracion.capacidades.find(
      (capacidad) => capacidad.codigo === 'telemetry'
    )?.habilitada,
    false
  );

  const configuracionConDuplicados = new ConfiguracionEfectivaAgente({
    capacidades: [
      {
        codigo: 'telemetry',
        habilitada: true,
        descripcion: 'Primera declaración.'
      },
      {
        codigo: 'telemetry',
        habilitada: false,
        descripcion: 'Declaración duplicada.'
      }
    ]
  }).obtenerRespuestaPublica();
  const telemetrias = configuracionConDuplicados.capacidades.filter(
    (capacidad) => capacidad.codigo === 'telemetry'
  );

  assert.equal(telemetrias.length, 1);
  assert.equal(telemetrias[0].habilitada, true);
  assert.equal(telemetrias[0].descripcion, 'Primera declaración.');

  console.log('[agentes-configuracion] dominio devuelve politica y capacidades');
}

async function verificarConfiguracionEfectivaRevision({
  repositorioAgentes,
  repositorioSesionesAgentesRedis,
  generadorCredenciales,
  ids
}) {
  const { agente, secreto } = await crearAgenteTemporal({
    repositorioAgentes,
    generadorCredenciales,
    ids,
    nombre: 'Agente configuracion efectiva revision'
  });
  const configuracionPortal = crearServicioConfiguracionPortalFalso({
    versionInicial: 'cfg_revision_inicial',
    configuracionAgentes: {
      sessionTtlSegundos: 456,
      loginFallosMaximos: 5,
      cuarentenaSegundos: 60
    }
  });
  const servicio = crearServicioAutenticacion({
    repositorioAgentes,
    repositorioSesionesAgentesRedis,
    servicioConfiguracionPortal: configuracionPortal
  });
  const login = await servicio.autenticar({
    guid: agente.guid,
    secreto,
    bootId: 'boot-configuracion-revision',
    hostname: 'host-configuracion-revision',
    versionAgente: 'beta-0.5.30C'
  });

  const inicial = (
    await servicio.obtenerConfiguracionEfectiva({
      sessionToken: login.sessionToken
    })
  ).obtenerRespuestaPublica();

  assert.equal(inicial.configuracion.revisionConfiguracion, 'cfg_revision_inicial');
  assert.equal(inicial.configuracion.politicaVida.sessionTtlSeconds, 456);

  configuracionPortal.fijarVersion('cfg_revision_actualizada');

  const actualizada = (
    await servicio.obtenerConfiguracionEfectiva({
      sessionToken: login.sessionToken
    })
  ).obtenerRespuestaPublica();

  assert.equal(
    actualizada.configuracion.revisionConfiguracion,
    'cfg_revision_actualizada'
  );
  assert.equal(actualizada.configuracion.revisionPolitica, null);

  console.log('[agentes-configuracion] revision efectiva cambia con portal');
}

async function verificarConfiguracionEfectivaHttpReal({
  repositorioAgentes,
  repositorioSesionesAgentesRedis,
  generadorCredenciales,
  ids
}) {
  const { agente, secreto } = await crearAgenteTemporal({
    repositorioAgentes,
    generadorCredenciales,
    ids,
    nombre: 'Agente configuracion efectiva HTTP'
  });
  const servicio = crearServicioAutenticacion({
    repositorioAgentes,
    repositorioSesionesAgentesRedis,
    configuracionAgentes: {
      sessionTtlSegundos: 640,
      heartbeatIntervalSegundos: 25,
      heartbeatGraceSegundos: 75,
      loginFallosMaximos: 5,
      cuarentenaSegundos: 60
    }
  });
  const login = await servicio.autenticar({
    guid: agente.guid,
    secreto,
    bootId: 'boot-configuracion-http',
    hostname: 'host-configuracion-http',
    versionAgente: 'beta-0.5.30C'
  });
  const servidor = await arrancarServidorApiAgentes({ servicio });

  try {
    const respuesta = await fetch(
      `${servidor.url}/api/agentes/v1/configuracion`,
      {
        method: 'GET',
        headers: {
          authorization: `Bearer ${login.sessionToken}`
        }
      }
    );
    const cuerpo = await respuesta.json();

    assert.equal(respuesta.status, 200);
    assert.equal(cuerpo.ok, true);
    assert.equal(cuerpo.agente.id, agente.id);
    assert.equal(cuerpo.sesion.sessionId, login.sesion.sessionId);
    assert.equal(cuerpo.sesion.sessionToken, undefined);
    assert.equal(cuerpo.configuracion.politicaVida.sessionTtlSeconds, 640);
    assert.equal(cuerpo.configuracion.politicaVida.heartbeatIntervalSeconds, 25);
    assert.equal(cuerpo.configuracion.politicaVida.heartbeatGraceSeconds, 75);
    assert.ok(
      cuerpo.configuracion.capacidades.some(
        (capacidad) =>
          capacidad.codigo === 'effective_configuration' &&
          capacidad.habilitada === true
      )
    );
    assert.ok(
      cuerpo.configuracion.capacidades.some(
        (capacidad) =>
          capacidad.codigo === 'commands' && capacidad.habilitada === false
      )
    );
  } finally {
    await servidor.cerrar();
  }

  console.log('[agentes-configuracion] endpoint HTTP real devuelve configuracion');
}

async function verificarConfiguracionEfectivaSesionNoVigente({
  repositorioAgentes,
  repositorioSesionesAgentesRedis,
  generadorCredenciales,
  ids
}) {
  const { agente, secreto } = await crearAgenteTemporal({
    repositorioAgentes,
    generadorCredenciales,
    ids,
    nombre: 'Agente configuracion sesion no vigente'
  });
  const servicio = crearServicioAutenticacion({
    repositorioAgentes,
    repositorioSesionesAgentesRedis
  });
  const loginAntiguo = await servicio.autenticar({
    guid: agente.guid,
    secreto,
    bootId: 'boot-configuracion-no-vigente',
    hostname: 'host-configuracion-no-vigente'
  });

  await servicio.autenticar({
    guid: agente.guid,
    secreto,
    sessionIdAnterior: loginAntiguo.sesion.sessionId,
    bootId: 'boot-configuracion-no-vigente',
    hostname: 'host-configuracion-no-vigente'
  });

  const servidor = await arrancarServidorApiAgentes({ servicio });

  try {
    const respuesta = await fetch(
      `${servidor.url}/api/agentes/v1/configuracion`,
      {
        method: 'GET',
        headers: {
          authorization: `Bearer ${loginAntiguo.sessionToken}`
        }
      }
    );
    const cuerpo = await respuesta.json();

    assert.equal(respuesta.status, 403);
    assert.equal(cuerpo.ok, false);
    assert.equal(cuerpo.code, 'sesion_no_vigente');
    assert.equal(cuerpo.action, 'login_required');
  } finally {
    await servidor.cerrar();
  }

  console.log('[agentes-configuracion] sesion no vigente fuerza relogin');
}

async function verificarLecturaOperativaAdministrativa({
  clienteSql,
  repositorioAgentes,
  repositorioSesionesAgentesRedis,
  generadorCredenciales,
  ids
}) {
  const { agente, secreto } = await crearAgenteTemporal({
    repositorioAgentes,
    generadorCredenciales,
    ids,
    nombre: 'Agente lectura operativa'
  });
  const servicio = crearServicioAutenticacion({
    repositorioAgentes,
    repositorioSesionesAgentesRedis
  });
  const login = await servicio.autenticar({
    guid: agente.guid,
    secreto,
    bootId: 'boot-lectura-operativa',
    hostname: 'host-lectura-operativa',
    versionAgente: 'beta-0.5.30C'
  });
  const referenciaSesion =
    await repositorioSesionesAgentesRedis.obtenerSesionActualAgente(agente.id);
  const agenteActualizado = await repositorioAgentes.buscarPorId(agente.id);
  const lectura = crearLecturaOperativaAgente({
    agente: agenteActualizado,
    referenciaSesionRedis: referenciaSesion
  }).serializar();

  assert.equal(referenciaSesion.estado, 'viva');
  assert.equal(lectura.id, agente.id);
  assert.equal(lectura.estadoAdministrativo, 'activo');
  assert.equal(lectura.estadoAcceso, 'normal');
  assert.equal(lectura.estadoVidaPol, 'vivo');
  assert.equal(lectura.sesionRedis.viva, true);
  assert.equal(lectura.sesionRedis.sesion.sessionId, login.sesion.sessionId);
  assert.equal(lectura.sesionRedis.sesion.sessionTokenHash, undefined);
  assert.ok(lectura.sesionRedis.ttlRestanteSegundos > 0);
  assert.ok(lectura.ultimaConexionUtc);

  const servicioProvisionamiento = new ServicioProvisionamientoAgentes({
    repositorioAgentes,
    repositorioSitios: {}
  });
  const servicioAdministracionPortal = new ServicioAdministracionAgentesPortal({
    servicioProvisionamientoAgentes: servicioProvisionamiento,
    repositorioAgentes,
    repositorioSitios: {},
    repositorioSesionesAgentesRedis
  });
  const contextoPortalLectura = {
    esOperadorSistema: true,
    nivelScope: 'portal',
    permisos: {
      verAgentes: true,
      modificarAgentes: false
    }
  };
  const vistaConSesionRedis =
    await servicioAdministracionPortal.construirVistaListado(
      contextoPortalLectura,
      { foco_operativo: 'sesion_redis_viva' }
    );
  const agenteConSesionRedis = vistaConSesionRedis.agentes.find(
    (item) => item.id === agente.id
  );

  assert.ok(agenteConSesionRedis);
  assert.equal(agenteConSesionRedis.sesionRedis.viva, true);

  await clienteSql.ejecutar(
    `
      UPDATE agentes_sentinelia
      SET
        ultimo_login_utc = DATE_SUB(UTC_TIMESTAMP(), INTERVAL 2 MINUTE),
        ultimo_heartbeat_utc = DATE_SUB(UTC_TIMESTAMP(), INTERVAL 2 MINUTE)
      WHERE id = ?
    `,
    [agente.id]
  );

  const agenteSilenciosoConRedis = await repositorioAgentes.buscarPorId(agente.id);
  const lecturaSilenciosaConRedis = crearLecturaOperativaAgente({
    agente: agenteSilenciosoConRedis,
    referenciaSesionRedis: referenciaSesion
  }).serializar();

  assert.equal(lecturaSilenciosaConRedis.sesionRedis.viva, true);
  assert.equal(lecturaSilenciosaConRedis.estadoVidaPol, 'silencioso');

  const vistaPorTexto =
    await servicioAdministracionPortal.construirVistaListado(
      contextoPortalLectura,
      { q: agente.guid.slice(0, 12) }
    );

  assert.ok(vistaPorTexto.agentes.some((item) => item.id === agente.id));
  assert.equal(vistaPorTexto.filtros.textoBusqueda, agente.guid.slice(0, 12));

  await repositorioSesionesAgentesRedis.invalidarSesionActualAgente(agente.id);

  const referenciaSinSesion =
    await repositorioSesionesAgentesRedis.obtenerSesionActualAgente(agente.id);
  const lecturaSinSesion = crearLecturaOperativaAgente({
    agente: agenteActualizado,
    referenciaSesionRedis: referenciaSinSesion
  }).serializar();

  assert.equal(referenciaSinSesion.estado, 'sin_sesion');
  assert.equal(lecturaSinSesion.sesionRedis.viva, false);
  assert.equal(lecturaSinSesion.sesionRedis.sesion, null);

  const vista = await servicioAdministracionPortal.construirVistaListado(
    contextoPortalLectura,
    { foco_operativo: 'sin_sesion_redis' }
  );
  const agenteVisible = vista.agentes.find((item) => item.id === agente.id);

  assert.ok(agenteVisible);
  assert.equal(agenteVisible.sesionRedis.viva, false);
  assert.equal(vista.puedeModificarAgentes, false);
  assert.equal(vista.filtros.focoOperativo, 'sin_sesion_redis');

  console.log('[agentes-panel] lectura operativa administrativa fusiona SQL y Redis');
}

async function verificarPanelAdministrativoAgentesScopePermisosYEstados({
  clienteSql,
  repositorioAgentes,
  repositorioSesionesAgentesRedis,
  generadorCredenciales,
  ids
}) {
  const sitioAjenoId = await crearSitioTemporal(clienteSql, ids, {
    nombre: 'Sitio ajeno panel agentes',
    alias: `sitio-ajeno-agentes-${randomUUID().slice(0, 8)}`
  });
  const agenteVivo = await crearAgenteTemporal({
    repositorioAgentes,
    generadorCredenciales,
    ids,
    nombre: 'Agente panel vivo'
  });
  const agenteSilencioso = await crearAgenteTemporal({
    repositorioAgentes,
    generadorCredenciales,
    ids,
    nombre: 'Agente panel silencioso'
  });
  const agenteFueraScope = await crearAgenteTemporal({
    repositorioAgentes,
    generadorCredenciales,
    ids,
    nombre: 'Agente panel fuera scope',
    sitioId: sitioAjenoId
  });
  const servicioAutenticacion = crearServicioAutenticacion({
    repositorioAgentes,
    repositorioSesionesAgentesRedis
  });

  await servicioAutenticacion.autenticar({
    guid: agenteVivo.agente.guid,
    secreto: agenteVivo.secreto,
    bootId: 'boot-panel-vivo',
    hostname: 'host-panel-vivo',
    versionAgente: 'beta-0.5.30C'
  });
  await clienteSql.ejecutar(
    `
      UPDATE agentes_sentinelia
      SET
        ultimo_login_utc = DATE_SUB(UTC_TIMESTAMP(), INTERVAL 10 MINUTE),
        ultimo_heartbeat_utc = DATE_SUB(UTC_TIMESTAMP(), INTERVAL 10 MINUTE),
        ultimo_boot_id = 'boot-panel-silencioso',
        ultima_version_agente = 'beta-0.5.30C',
        ultimo_hostname = 'host-panel-silencioso',
        ultimo_seq = 7
      WHERE id = ?
    `,
    [agenteSilencioso.agente.id]
  );

  const servicioProvisionamiento = new ServicioProvisionamientoAgentes({
    repositorioAgentes,
    repositorioSitios: {}
  });
  const servicioAdministracionPortal = new ServicioAdministracionAgentesPortal({
    servicioProvisionamientoAgentes: servicioProvisionamiento,
    repositorioAgentes,
    repositorioSitios: {},
    repositorioSesionesAgentesRedis
  });
  const contextoSitioLectura = {
    esOperadorSistema: false,
    nivelScope: 'sitio',
    tenantId: ids.tenantId,
    empresaId: ids.empresaId,
    sitioId: ids.sitioId,
    permisos: {
      verAgentes: true,
      modificarAgentes: false
    }
  };
  const vistaSitio = await servicioAdministracionPortal.construirVistaListado(
    contextoSitioLectura
  );

  assert.ok(vistaSitio.agentes.some((item) => item.id === agenteVivo.agente.id));
  assert.ok(
    vistaSitio.agentes.some((item) => item.id === agenteSilencioso.agente.id)
  );
  assert.equal(
    vistaSitio.agentes.some((item) => item.id === agenteFueraScope.agente.id),
    false
  );
  assert.equal(vistaSitio.puedeModificarAgentes, false);

  const listadoAjaxSitio =
    await servicioAdministracionPortal.listarAgentesAdministracion(
      contextoSitioLectura,
      { page_size: 1, sort_by: 'nombre', sort_dir: 'asc' }
    );

  assert.equal(listadoAjaxSitio.agentes.length, 1);
  assert.equal(listadoAjaxSitio.paginacion.tamanoPagina, 1);
  assert.ok(listadoAjaxSitio.paginacion.totalFiltrado >= 2);
  assert.equal(
    listadoAjaxSitio.agentes.some((item) => item.id === agenteFueraScope.agente.id),
    false
  );

  const listadoAjaxTexto =
    await servicioAdministracionPortal.listarAgentesAdministracion(
      contextoSitioLectura,
      {
        q: agenteVivo.agente.guid.slice(0, 12),
        page_size: 10
      }
    );

  assert.ok(
    listadoAjaxTexto.agentes.some((item) => item.id === agenteVivo.agente.id)
  );
  assert.equal(
    listadoAjaxTexto.agentes.some((item) => item.id === agenteFueraScope.agente.id),
    false
  );

  const listadoAjaxFocoRedis =
    await servicioAdministracionPortal.listarAgentesAdministracion(
      contextoSitioLectura,
      { foco_operativo: 'sesion_redis_viva', page_size: 10 }
    );

  assert.equal(listadoAjaxFocoRedis.filtros.focoOperativo, 'todos');
  assert.equal(
    listadoAjaxFocoRedis.opcionesFiltros.focosOperativos.some((opcion) =>
      opcion.valor === 'sesion_redis_viva' || opcion.valor === 'sin_sesion_redis'
    ),
    false
  );

  const vistaShellSitio =
    await servicioAdministracionPortal.construirVistaListadoShell(
      contextoSitioLectura,
      { page_size: 25, sort_by: 'heartbeat', sort_dir: 'desc' }
    );
  const htmlSoloLectura = await renderizarVistaAgentesParaVerificacion(
    vistaShellSitio,
    contextoSitioLectura
  );

  assert.equal(htmlSoloLectura.includes('/rotar-secreto'), false);
  assert.equal(htmlSoloLectura.includes('/deshabilitar'), false);
  assert.equal(htmlSoloLectura.includes('/habilitar'), false);
  assert.equal(htmlSoloLectura.includes('/editar'), false);
  assert.equal(htmlSoloLectura.includes('Nuevo agente'), false);
  assert.equal(htmlSoloLectura.includes('Contrato OpenAPI'), true);
  assert.equal(htmlSoloLectura.includes('data-agentes-lista'), true);
  assert.equal(htmlSoloLectura.includes('data-url-listado="/agentes/api/listado"'), true);
  assert.equal(htmlSoloLectura.includes('data-agentes-filas'), true);
  assert.equal(htmlSoloLectura.includes('/js/agentes.js'), true);
  assert.equal(htmlSoloLectura.includes('Referencia Redis no viva'), false);

  const vistaSilenciosos =
    await servicioAdministracionPortal.construirVistaListado(
      contextoSitioLectura,
      { estado_vida_pol: 'silencioso' }
    );

  assert.ok(
    vistaSilenciosos.agentes.some(
      (item) => item.id === agenteSilencioso.agente.id
    )
  );
  assert.equal(
    vistaSilenciosos.agentes.some((item) => item.id === agenteVivo.agente.id),
    false
  );
  assert.equal(
    vistaSilenciosos.agentes.every(
      (item) => item.estadoVidaPol === 'silencioso'
    ),
    true
  );

  const vistaVivos = await servicioAdministracionPortal.construirVistaListado(
    contextoSitioLectura,
    { estado_vida_pol: 'vivo' }
  );

  assert.ok(vistaVivos.agentes.some((item) => item.id === agenteVivo.agente.id));
  assert.equal(
    vistaVivos.agentes.some((item) => item.id === agenteSilencioso.agente.id),
    false
  );

  await assert.rejects(
    () => servicioAdministracionPortal.construirVistaListado({
      ...contextoSitioLectura,
      permisos: {
        verAgentes: false,
        modificarAgentes: false
      }
    }),
    /No tienes permiso para ver agentes/
  );

  console.log('[agentes-panel] scope permisos y estados POL verificados');
}

function verificarConfiguracionPortalAgentes(configuracionEntorno) {
  const definiciones = obtenerDefinicionesConfiguracionPortal(configuracionEntorno);
  const claves = new Set(definiciones.map((definicion) => definicion.clave));

  for (const clave of [
    'agentes.session_ttl_segundos',
    'agentes.heartbeat_interval_segundos',
    'agentes.heartbeat_grace_segundos',
    'agentes.login_fallos_maximos',
    'agentes.cuarentena_segundos'
  ]) {
    assert.equal(claves.has(clave), true);
  }

  const configuracionPortal = new ConfiguracionPortal({
    definiciones,
    valoresPersistidos: new Map(),
    version: 'verificacion'
  });
  const agentes = configuracionPortal.obtenerConfiguracionAgentes();

  assert.equal(
    agentes.sessionTtlSegundos,
    configuracionEntorno.agentes.sessionTtlSegundos
  );
  assert.equal(
    agentes.heartbeatIntervalSegundos,
    configuracionEntorno.agentes.heartbeatIntervalSegundos
  );
  assert.equal(
    agentes.heartbeatGraceSegundos,
    configuracionEntorno.agentes.heartbeatGraceSegundos
  );
  assert.equal(
    agentes.loginFallosMaximos,
    configuracionEntorno.agentes.loginFallosMaximos
  );
  assert.equal(
    agentes.cuarentenaSegundos,
    configuracionEntorno.agentes.cuarentenaSegundos
  );

  console.log('[agentes-configuracion] claves portal de agentes disponibles');
}

function verificarEstadoVidaPolDerivado() {
  const ahoraUtc = '2026-07-06T12:00:00.000Z';

  assert.equal(
    calcularEstadoVidaPolAgente({
      ultimoHeartbeatUtc: null,
      ahoraUtc,
      silencioSegundos: 120
    }),
    'nunca_conectado'
  );
  assert.equal(
    calcularEstadoVidaPolAgente({
      ultimoHeartbeatUtc: '2026-07-06T11:59:30.000Z',
      ahoraUtc,
      silencioSegundos: 120
    }),
    'vivo'
  );
  assert.equal(
    calcularEstadoVidaPolAgente({
      ultimoHeartbeatUtc: '2026-07-06T11:58:00.000Z',
      ahoraUtc,
      silencioSegundos: 120
    }),
    'silencioso'
  );
  assert.equal(
    calcularEstadoVidaPolAgente({
      ultimoHeartbeatUtc: '2026-07-06T11:57:00.000Z',
      ahoraUtc,
      silencioSegundos: 120
    }),
    'silencioso'
  );
  assert.equal(
    calcularEstadoVidaPolAgente({
      ultimoHeartbeatUtc: '2026-07-06T11:59:30.000Z',
      ahoraUtc,
      silencioSegundos: 120,
      requiereRelogin: true
    }),
    'inconsistente_relogin_requerido'
  );

  console.log('[agentes-heartbeat] estado POL derivado cubre silencio');
}

async function verificarCierrePolPorIndiceRedisPerdido({
  clienteSql,
  clienteRedis,
  repositorioAgentes,
  repositorioSesionesAgentesRedis,
  generadorCredenciales,
  ids
}) {
  const { agente, secreto } = await crearAgenteTemporal({
    repositorioAgentes,
    generadorCredenciales,
    ids,
    nombre: 'Agente indice Redis perdido'
  });
  const servicio = crearServicioAutenticacion({
    repositorioAgentes,
    repositorioSesionesAgentesRedis
  });
  const login = await servicio.autenticar({
    guid: agente.guid,
    secreto,
    bootId: 'boot-indice-redis-perdido'
  });

  await clienteRedis.del(
    repositorioSesionesAgentesRedis.obtenerClaveSesionActualAgente(agente.id)
  );

  await assert.rejects(
    () => servicio.inspeccionarSesionViva(login.sessionToken),
    (error) => error.codigo === 'sesion_no_vigente'
  );

  const periodos = await clienteSql.consultar(
    `
      SELECT fin_utc, motivo_cierre
      FROM periodos_vida_pol_agentes
      WHERE agente_id = ?
      ORDER BY id ASC
    `,
    [agente.id]
  );

  assert.equal(periodos.length, 1);
  assert.ok(periodos[0].fin_utc);
  assert.equal(periodos[0].motivo_cierre, 'sesion_redis_no_vigente');

  console.log('[agentes-login] indice Redis perdido cierra POL coincidente');
}

async function verificarRefreshSesionExpirada({
  repositorioAgentes,
  repositorioSesionesAgentesRedis,
  generadorCredenciales,
  ids
}) {
  const { agente, secreto } = await crearAgenteTemporal({
    repositorioAgentes,
    generadorCredenciales,
    ids,
    nombre: 'Agente refresh expirado'
  });
  const servicio = crearServicioAutenticacion({
    repositorioAgentes,
    repositorioSesionesAgentesRedis,
    configuracionAgentes: {
      sessionTtlSegundos: 1,
      loginFallosMaximos: 5,
      cuarentenaSegundos: 60
    }
  });
  const login = await servicio.autenticar({
    guid: agente.guid,
    secreto,
    bootId: 'boot-refresh-expirado'
  });

  await esperar(1300);

  await assert.rejects(
    () => servicio.renovarSesion({
      sessionToken: login.sessionToken,
      sessionIdActual: login.sesion.sessionId,
      bootId: 'boot-refresh-expirado'
    }),
    (error) => error.codigo === 'sesion_no_vigente'
  );

  console.log('[agentes-refresh] sesion expirada fuerza relogin');
}

async function verificarRefreshSesionReemplazada({
  repositorioAgentes,
  repositorioSesionesAgentesRedis,
  generadorCredenciales,
  ids
}) {
  const { agente, secreto } = await crearAgenteTemporal({
    repositorioAgentes,
    generadorCredenciales,
    ids,
    nombre: 'Agente refresh reemplazado'
  });
  const servicio = crearServicioAutenticacion({
    repositorioAgentes,
    repositorioSesionesAgentesRedis
  });
  const loginInicial = await servicio.autenticar({
    guid: agente.guid,
    secreto,
    bootId: 'boot-refresh-reemplazo'
  });

  await servicio.autenticar({
    guid: agente.guid,
    secreto,
    sessionIdAnterior: loginInicial.sesion.sessionId,
    bootId: 'boot-refresh-reemplazo'
  });

  await assert.rejects(
    () => servicio.renovarSesion({
      sessionToken: loginInicial.sessionToken,
      sessionIdActual: loginInicial.sesion.sessionId,
      bootId: 'boot-refresh-reemplazo'
    }),
    (error) => error.codigo === 'sesion_no_vigente'
  );

  console.log('[agentes-refresh] sesion reemplazada fuerza relogin');
}

async function verificarRefreshSesionDeOtroAgente({
  repositorioAgentes,
  repositorioSesionesAgentesRedis,
  generadorCredenciales,
  ids
}) {
  const agenteA = await crearAgenteTemporal({
    repositorioAgentes,
    generadorCredenciales,
    ids,
    nombre: 'Agente refresh origen'
  });
  const agenteB = await crearAgenteTemporal({
    repositorioAgentes,
    generadorCredenciales,
    ids,
    nombre: 'Agente refresh ajeno'
  });
  const servicio = crearServicioAutenticacion({
    repositorioAgentes,
    repositorioSesionesAgentesRedis
  });
  const loginA = await servicio.autenticar({
    guid: agenteA.agente.guid,
    secreto: agenteA.secreto,
    bootId: 'boot-refresh-origen'
  });
  const loginB = await servicio.autenticar({
    guid: agenteB.agente.guid,
    secreto: agenteB.secreto,
    bootId: 'boot-refresh-ajeno'
  });

  await assert.rejects(
    () => servicio.renovarSesion({
      sessionToken: loginA.sessionToken,
      sessionIdActual: loginB.sesion.sessionId,
      bootId: 'boot-refresh-origen'
    }),
    (error) => error.codigo === 'session_id_actual_no_coincide'
  );

  const inspeccionA = await servicio.inspeccionarSesionViva(loginA.sessionToken);
  const inspeccionB = await servicio.inspeccionarSesionViva(loginB.sessionToken);
  assert.equal(inspeccionA.sesion.sessionId, loginA.sesion.sessionId);
  assert.equal(inspeccionB.sesion.sessionId, loginB.sesion.sessionId);

  console.log('[agentes-refresh] sesion de otro agente queda bloqueada');
}

async function verificarRefreshConcurrente({
  repositorioAgentes,
  repositorioSesionesAgentesRedis,
  generadorCredenciales,
  ids
}) {
  const { agente, secreto } = await crearAgenteTemporal({
    repositorioAgentes,
    generadorCredenciales,
    ids,
    nombre: 'Agente refresh concurrente'
  });
  const servicioLogin = crearServicioAutenticacion({
    repositorioAgentes,
    repositorioSesionesAgentesRedis
  });
  const login = await servicioLogin.autenticar({
    guid: agente.guid,
    secreto,
    bootId: 'boot-refresh-concurrente'
  });
  const repositorioConCarrera = crearRepositorioSesionesConRefreshConcurrente(
    repositorioSesionesAgentesRedis
  );
  const servicioConCarrera = crearServicioAutenticacion({
    repositorioAgentes,
    repositorioSesionesAgentesRedis: repositorioConCarrera
  });

  await assert.rejects(
    () => servicioConCarrera.renovarSesion({
      sessionToken: login.sessionToken,
      sessionIdActual: login.sesion.sessionId,
      bootId: 'boot-refresh-concurrente'
    }),
    (error) => error.codigo === 'refresh_concurrente'
  );

  await assert.rejects(
    () => servicioLogin.inspeccionarSesionViva(login.sessionToken),
    (error) => error.codigo === 'sesion_no_vigente'
  );

  console.log('[agentes-refresh] refresh concurrente falla de forma controlada');
}

async function verificarRefreshBootIncoherente({
  repositorioAgentes,
  repositorioSesionesAgentesRedis,
  generadorCredenciales,
  ids
}) {
  const { agente, secreto } = await crearAgenteTemporal({
    repositorioAgentes,
    generadorCredenciales,
    ids,
    nombre: 'Agente refresh boot incoherente'
  });
  const servicio = crearServicioAutenticacion({
    repositorioAgentes,
    repositorioSesionesAgentesRedis
  });
  const login = await servicio.autenticar({
    guid: agente.guid,
    secreto,
    bootId: 'boot-refresh-original'
  });

  await assert.rejects(
    () => servicio.renovarSesion({
      sessionToken: login.sessionToken,
      sessionIdActual: login.sesion.sessionId,
      bootId: 'boot-refresh-distinto'
    }),
    (error) => error.codigo === 'boot_id_incoherente'
  );

  const inspeccion = await servicio.inspeccionarSesionViva(login.sessionToken);
  assert.equal(inspeccion.sesion.sessionId, login.sesion.sessionId);

  console.log('[agentes-refresh] bootId incoherente fuerza relogin');
}

async function verificarCredencialesInvalidasYCuarentena({
  repositorioAgentes,
  repositorioSesionesAgentesRedis,
  generadorCredenciales,
  ids
}) {
  const { agente, secreto } = await crearAgenteTemporal({
    repositorioAgentes,
    generadorCredenciales,
    ids,
    nombre: 'Agente cuarentena'
  });
  const servicio = crearServicioAutenticacion({
    repositorioAgentes,
    repositorioSesionesAgentesRedis,
    configuracionAgentes: {
      sessionTtlSegundos: 900,
      loginFallosMaximos: 2,
      cuarentenaSegundos: 60
    }
  });

  await assert.rejects(
    () => servicio.autenticar({
      guid: agente.guid,
      secreto: `${secreto}-incorrecto`,
      bootId: 'boot-cuarentena'
    }),
    (error) => error.codigo === 'credenciales_invalidas'
  );
  await assert.rejects(
    () => servicio.autenticar({
      guid: agente.guid,
      secreto: `${secreto}-incorrecto-2`,
      bootId: 'boot-cuarentena'
    }),
    (error) => error.codigo === 'credenciales_invalidas'
  );
  await assert.rejects(
    () => servicio.autenticar({
      guid: agente.guid,
      secreto,
      bootId: 'boot-cuarentena'
    }),
    (error) => error.codigo === 'agente_en_cuarentena'
  );

  const actualizado = await repositorioAgentes.buscarPorId(agente.id);
  assert.equal(actualizado.estadoAcceso, 'cuarentena');
  assert.equal(actualizado.contadorLoginFallidos, 2);

  console.log('[agentes-login] credenciales invalidas y cuarentena automatica');
}

async function verificarAgenteDeshabilitado({
  repositorioAgentes,
  repositorioSesionesAgentesRedis,
  generadorCredenciales,
  ids
}) {
  const { agente, secreto } = await crearAgenteTemporal({
    repositorioAgentes,
    generadorCredenciales,
    ids,
    nombre: 'Agente deshabilitado'
  });
  const servicio = crearServicioAutenticacion({
    repositorioAgentes,
    repositorioSesionesAgentesRedis
  });

  await repositorioAgentes.actualizarEstadoAdministrativo({
    idAgente: agente.id,
    estadoAdministrativo: 'deshabilitado'
  });

  await assert.rejects(
    () => servicio.autenticar({
      guid: agente.guid,
      secreto,
      bootId: 'boot-deshabilitado'
    }),
    (error) => error.codigo === 'agente_deshabilitado'
  );

  console.log('[agentes-login] agente deshabilitado bloquea login');
}

async function verificarLoginConcurrenteBloqueado({
  repositorioAgentes,
  repositorioSesionesAgentesRedis,
  generadorCredenciales,
  ids
}) {
  const { agente, secreto } = await crearAgenteTemporal({
    repositorioAgentes,
    generadorCredenciales,
    ids,
    nombre: 'Agente lock login'
  });
  const servicio = crearServicioAutenticacion({
    repositorioAgentes,
    repositorioSesionesAgentesRedis
  });
  const identificadorBloqueo = 'verificacion-login-lock';

  assert.equal(
    await repositorioSesionesAgentesRedis.intentarBloquearLoginAgente({
      idAgente: agente.id,
      identificadorBloqueo,
      ttlSegundos: 5
    }),
    true
  );

  try {
    await assert.rejects(
      () => servicio.autenticar({
        guid: agente.guid,
        secreto,
        bootId: 'boot-lock'
      }),
      (error) => error.codigo === 'login_en_progreso'
    );
  } finally {
    await repositorioSesionesAgentesRedis.liberarBloqueoLoginAgente({
      idAgente: agente.id,
      identificadorBloqueo
    });
  }

  console.log('[agentes-login] doble login bloqueado por candado Redis');
}

async function verificarInvalidacionAdministrativa({
  repositorioAgentes,
  repositorioSesionesAgentesRedis,
  generadorCredenciales,
  ids
}) {
  const { agente, secreto } = await crearAgenteTemporal({
    repositorioAgentes,
    generadorCredenciales,
    ids,
    nombre: 'Agente invalidacion administrativa'
  });
  const servicio = crearServicioAutenticacion({
    repositorioAgentes,
    repositorioSesionesAgentesRedis
  });
  const loginRotacion = await servicio.autenticar({
    guid: agente.guid,
    secreto,
    bootId: 'boot-invalidacion-rotacion'
  });
  const servicioProvisionamiento = new ServicioProvisionamientoAgentes({
    repositorioAgentes,
    repositorioSitios: {},
    invalidarSesionesAgente: async ({ agenteId, motivo }) => {
      await repositorioSesionesAgentesRedis.invalidarSesionActualAgente(agenteId);
      await repositorioAgentes.cerrarPeriodoVidaPolAbierto({
        agenteId,
        motivoCierre: motivo
      });
    }
  });
  const contextoPortal = {
    esOperadorSistema: true,
    nivelScope: 'portal',
    permisos: {
      modificarAgentes: true
    }
  };
  const rotacion = await servicioProvisionamiento.rotarSecretoAgente(
    contextoPortal,
    agente.id
  );

  await assert.rejects(
    () => servicio.inspeccionarSesionViva(loginRotacion.sessionToken),
    (error) => error.codigo === 'sesion_no_vigente'
  );

  const loginDeshabilitado = await servicio.autenticar({
    guid: agente.guid,
    secreto: rotacion.credenciales.secreto,
    bootId: 'boot-invalidacion-deshabilitado'
  });

  await servicioProvisionamiento.deshabilitarAgente(contextoPortal, agente.id);

  await assert.rejects(
    () => servicio.inspeccionarSesionViva(loginDeshabilitado.sessionToken),
    (error) => error.codigo === 'sesion_no_vigente'
  );

  const periodos = await repositorioAgentes.clienteSql.consultar(
    `
      SELECT motivo_cierre
      FROM periodos_vida_pol_agentes
      WHERE agente_id = ?
        AND motivo_cierre IN ('rotacion_secreto', 'agente_deshabilitado')
      ORDER BY id ASC
    `,
    [agente.id]
  );

  assert.deepEqual(
    periodos.map((periodo) => periodo.motivo_cierre),
    ['rotacion_secreto', 'agente_deshabilitado']
  );

  console.log('[agentes-login] invalidacion administrativa cierra sesion y POL');
}

async function verificarExpiracionRedis({
  repositorioAgentes,
  repositorioSesionesAgentesRedis,
  generadorCredenciales,
  ids
}) {
  const { agente, secreto } = await crearAgenteTemporal({
    repositorioAgentes,
    generadorCredenciales,
    ids,
    nombre: 'Agente ttl redis'
  });
  const servicio = crearServicioAutenticacion({
    repositorioAgentes,
    repositorioSesionesAgentesRedis,
    configuracionAgentes: {
      sessionTtlSegundos: 1,
      loginFallosMaximos: 5,
      cuarentenaSegundos: 60
    }
  });
  const login = await servicio.autenticar({
    guid: agente.guid,
    secreto,
    bootId: 'boot-ttl'
  });

  await esperar(1300);

  await assert.rejects(
    () => servicio.inspeccionarSesionViva(login.sessionToken),
    (error) => error.codigo === 'sesion_no_vigente'
  );

  console.log('[agentes-login] expiracion Redis fuerza relogin');
}

async function crearJerarquiaTemporal(clienteSql, ids) {
  const sufijo = randomUUID().slice(0, 8);
  const [tenantResultado] = await clienteSql.ejecutar(
    `
      INSERT INTO tenants (nombre, alias, descripcion, estado, configuracion)
      VALUES (?, ?, ?, 'activo', ?)
    `,
    [
      `Verificacion agentes ${sufijo}`,
      `verif-agentes-${sufijo}`,
      'Jerarquía temporal para gate de agentes',
      JSON.stringify({ verificacion: 'gate-agentes' })
    ]
  );
  ids.tenantId = tenantResultado.insertId;

  const [empresaResultado] = await clienteSql.ejecutar(
    `
      INSERT INTO empresas (
        tenant_id,
        nombre,
        alias,
        cif,
        descripcion,
        estado,
        configuracion
      ) VALUES (?, ?, ?, ?, ?, 'activo', ?)
    `,
    [
      ids.tenantId,
      `Empresa verificacion ${sufijo}`,
      `empresa-verif-${sufijo}`,
      null,
      'Empresa temporal para gate de agentes',
      JSON.stringify({ verificacion: 'gate-agentes' })
    ]
  );
  ids.empresaId = empresaResultado.insertId;

  const [sitioResultado] = await clienteSql.ejecutar(
    `
      INSERT INTO sitios (
        tenant_id,
        empresa_id,
        nombre,
        alias,
        timezone,
        descripcion,
        estado,
        configuracion
      ) VALUES (?, ?, ?, ?, 'UTC', ?, 'activo', ?)
    `,
    [
      ids.tenantId,
      ids.empresaId,
      `Sitio verificacion ${sufijo}`,
      `sitio-verif-${sufijo}`,
      'Sitio temporal para gate de agentes',
      JSON.stringify({ verificacion: 'gate-agentes' })
    ]
  );
  ids.sitioId = sitioResultado.insertId;
}

async function renderizarVistaAgentesParaVerificacion(vista, contextoUsuarioActual) {
  return ejs.renderFile(RUTA_VISTA_AGENTES, {
    titulo: 'Agentes',
    usuarioActual: {
      usuario: 'verificador',
      nombreVisible: 'Verificador'
    },
    tokenCSRFPortal: 'csrf_verificacion',
    contextoUsuarioActual,
    rutaActual: '/agentes',
    queryActual: {},
    tiposMonitorNavegacion: [],
    nombrePortalVisible: 'Sentinelia 2.0',
    capacidadesPortal: {},
    puedeEliminarAgentes: false,
    flashAgentes: null,
    ...vista
  });
}

async function crearAgenteTemporal({
  repositorioAgentes,
  generadorCredenciales,
  ids,
  nombre,
  sitioId = ids.sitioId
}) {
  const credenciales = await generadorCredenciales.generarParCredenciales();
  const agente = await repositorioAgentes.crear({
    guid: credenciales.guid,
    tenantId: ids.tenantId,
    empresaId: ids.empresaId,
    sitioId,
    nombre,
    descripcion: 'Agente temporal del gate de agentes',
    secretoHash: credenciales.secretoHash
  });

  ids.agentes.push(agente.id);

  return {
    agente,
    secreto: credenciales.secreto
  };
}

async function crearSitioTemporal(clienteSql, ids, { nombre, alias }) {
  const [resultado] = await clienteSql.ejecutar(
    `
      INSERT INTO sitios (
        tenant_id,
        empresa_id,
        nombre,
        alias,
        timezone,
        descripcion,
        estado,
        configuracion
      ) VALUES (?, ?, ?, ?, 'UTC', ?, 'activo', ?)
    `,
    [
      ids.tenantId,
      ids.empresaId,
      nombre,
      alias,
      'Sitio temporal adicional para verificacion de agentes',
      JSON.stringify({ verificacion: 'gate-agentes' })
    ]
  );

  return resultado.insertId;
}

function crearServicioAutenticacion({
  repositorioAgentes,
  repositorioSesionesAgentesRedis,
  servicioConfiguracionPortal = null,
  configuracionAgentes = {
    sessionTtlSegundos: 900,
    loginFallosMaximos: 5,
    cuarentenaSegundos: 60
  }
}) {
  return new ServicioAutenticacionAgentes({
    repositorioAgentes,
    repositorioSesionesAgentesRedis,
    servicioConfiguracionPortal,
    configuracionAgentes
  });
}

function crearServicioConfiguracionPortalFalso({
  versionInicial,
  configuracionAgentes
}) {
  let versionActual = versionInicial;

  return {
    async asegurarActualizada() {
      return {
        obtenerConfiguracionAgentes: () => ({ ...configuracionAgentes })
      };
    },
    obtenerVersionActual() {
      return versionActual;
    },
    fijarVersion(nuevaVersion) {
      versionActual = nuevaVersion;
    }
  };
}

async function arrancarServidorApiAgentes({
  servicio,
  servicioIngestaTelemetriaAgentes = null
}) {
  const aplicacion = express();
  const controladorApiAgentes = new ControladorApiAgentes({
    servicioAutenticacionAgentes: servicio,
    servicioIngestaTelemetriaAgentes
  });

  aplicacion.use(express.json());
  aplicacion.use(crearRutasApiAgentes({ controladorApiAgentes }));

  const servidor = http.createServer(aplicacion);

  await new Promise((resolver) => {
    servidor.listen(0, '127.0.0.1', resolver);
  });

  const direccion = servidor.address();

  return {
    url: `http://127.0.0.1:${direccion.port}`,
    cerrar: () => new Promise((resolver, rechazar) => {
      servidor.close((error) => {
        if (error) {
          rechazar(error);
          return;
        }

        resolver();
      });
    })
  };
}

function crearRepositorioSesionesConRefreshConcurrente(repositorioBase) {
  const generadorSesiones = new GeneradorSesionAgenteSentinelia();
  let carreraInyectada = false;

  return new Proxy(repositorioBase, {
    get(objetivo, propiedad) {
      if (propiedad === 'refrescarSesionSiCoincide') {
        return async (argumentos) => {
          if (!carreraInyectada) {
            carreraInyectada = true;

            const parCompetidor = generadorSesiones.generarParSesion();
            const sesionCompetidora = new SesionAgenteSentinelia({
              agenteId: argumentos.sesion.agenteId,
              guid: argumentos.sesion.guid,
              tenantId: argumentos.sesion.tenantId,
              empresaId: argumentos.sesion.empresaId,
              sitioId: argumentos.sesion.sitioId,
              sessionId: parCompetidor.sessionId,
              sessionTokenHash: parCompetidor.sessionTokenHash,
              versionSecreto: argumentos.sesion.versionSecreto,
              bootId: argumentos.sesion.bootId,
              hostname: argumentos.sesion.hostname,
              versionAgente: argumentos.sesion.versionAgente,
              sessionIdAnterior: argumentos.sessionIdActual,
              sospechas: argumentos.sesion.sospechas,
              ttlSegundos: argumentos.sesion.ttlSegundos
            });

            await objetivo.refrescarSesionSiCoincide({
              sesion: sesionCompetidora,
              ttlSegundos: argumentos.ttlSegundos,
              sessionIdActual: argumentos.sessionIdActual,
              sessionTokenHashActual: argumentos.sessionTokenHashActual
            });
          }

          return objetivo.refrescarSesionSiCoincide(argumentos);
        };
      }

      const valor = objetivo[propiedad];
      return typeof valor === 'function' ? valor.bind(objetivo) : valor;
    }
  });
}

function crearRepositorioAgentesConCierrePeriodoHeartbeat(repositorioBase) {
  let carreraInyectada = false;

  return new Proxy(repositorioBase, {
    get(objetivo, propiedad) {
      if (propiedad === 'registrarHeartbeatPeriodoAbierto') {
        return async (argumentos) => {
          if (!carreraInyectada) {
            carreraInyectada = true;
            await objetivo.cerrarPeriodoVidaPolAbierto({
              agenteId: argumentos.agenteId,
              motivoCierre: 'verificacion_carrera_heartbeat'
            });
          }

          return objetivo.registrarHeartbeatPeriodoAbierto(argumentos);
        };
      }

      const valor = objetivo[propiedad];
      return typeof valor === 'function' ? valor.bind(objetivo) : valor;
    }
  });
}

async function limpiarSqlVerificacion(clienteSql, ids) {
  if (ids.tenantId) {
    await clienteSql.ejecutar('DELETE FROM tenants WHERE id = ?', [ids.tenantId]);
  }
}

async function limpiarRedisVerificacion(clienteRedis, repositorioSesionesAgentesRedis) {
  const patron = `${repositorioSesionesAgentesRedis.prefijoSesionesAgentes}*`;
  const claves = [];

  for await (const clave of clienteRedis.scanIterator({
    MATCH: patron,
    COUNT: 100
  })) {
    claves.push(clave);
  }

  if (claves.length > 0) {
    await clienteRedis.del(claves);
  }
}

main().catch((error) => {
  console.error('[agentes-login] Error fatal en verificacion de sesiones tecnicas');
  console.error(error);
  process.exit(1);
});

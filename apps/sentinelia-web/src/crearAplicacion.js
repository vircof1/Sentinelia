import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { crearMiddlewareInyectarSesionVista } from './middleware/inyectarSesionVista.js';
import { crearMiddlewareSincronizarConfiguracionPortal } from './middleware/sincronizarConfiguracionPortal.js';
import { crearRutasApiAgentes } from './rutas/crearRutasApiAgentes.js';
import { crearRutasApiFederacion } from './rutas/crearRutasApiFederacion.js';
import { crearRutasDatosFederacion } from './rutas/crearRutasDatosFederacion.js';
import { crearRutasPortal } from './rutas/crearRutasPortal.js';
import { responderErrorDatosFederacion } from './middleware/responderErrorDatosFederacion.js';
import {
  GuardiaRecepcionFederacion
} from '../../../paquetes/federacion/aplicacion/GuardiaRecepcionFederacion.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export function crearAplicacion({
  configuracion,
  resumenArranque,
  sessionMiddleware,
  servicioSesion,
  controladorLogin,
  controladorRecuperacionPassword,
  controladorPortal,
  controladorOrganizacion,
  controladorUsuarios,
  controladorImpersonacion,
  controladorMonitores,
  controladorTriggers,
  controladorDns,
  controladorAgentes,
  controladorEliminacionAdministrativaAgentes,
  controladorEliminacionAdministrativaOrganizaciones,
  controladorReglasDerivacionTelemetria,
  controladorAuditoria,
  controladorFederacion,
  controladorApiAgentes,
  controladorApiFederacion,
  controladorDatosFederacion = null,
  middlewareAutenticacionDatosFederacion = null,
  middlewareInterpretacionLoteFederacion = null,
  controladorPow,
  controladorDesuscripcionTriggerCorreo,
  estadoRedis,
  servicioContextoUsuario,
  servicioAutorizacion,
  servicioConfiguracionPortal,
  servicioCorreoPortal,
  resolutorRedPublicaFederacion,
  guardiaRecepcionFederacion = null,
  ddnsAgentesHabilitado = false,
  eliminacionAdministrativaAgentesHttpHabilitada = false,
  eliminacionAdministrativaOrganizacionesHttpHabilitada = false
}) {
  const aplicacion = express();
  const guardiaRecepcion = guardiaRecepcionFederacion ||
    new GuardiaRecepcionFederacion({ servicioConfiguracionPortal });

  aplicacion.disable('x-powered-by');
  aplicacion.use(redactarCapacidadDesuscripcionParaLogs);
  resolutorRedPublicaFederacion.configurarAplicacionExpress(aplicacion);
  aplicacion.set('view engine', 'ejs');
  aplicacion.set('views', path.join(__dirname, 'views'));
  aplicacion.use(
    crearRutasDatosFederacion({
      servicioConfiguracionPortal,
      controladorDatosFederacion,
      middlewareAutenticacionDatosFederacion,
      middlewareInterpretacionLoteFederacion,
      guardiaRecepcionFederacion: guardiaRecepcion
    })
  );
  // TelemetryBatchRequest limita el contenido lógico (500 observaciones,
  // campos y catálogo), no los bytes de su representación HTTP. Los espacios
  // y escapes JSON no tienen un máximo contractual: un límite finito aquí
  // rechazaría cuerpos válidos antes de validar el lote en el controlador.
  aplicacion.use('/api/agentes/v1/telemetria', express.json({ limit: Infinity }));
  aplicacion.use(express.urlencoded({ extended: false }));
  aplicacion.use(express.json());
  aplicacion.use(express.static(path.join(__dirname, 'public')));
  aplicacion.use(
    '/vendor/bootstrap',
    express.static(path.join(__dirname, '../../../node_modules/bootstrap/dist'))
  );
  aplicacion.use(
    '/vendor/chartjs',
    express.static(path.join(__dirname, '../../../node_modules/chart.js/dist'))
  );
  aplicacion.use(
    '/vendor/swagger-ui',
    express.static(path.join(__dirname, '../../../node_modules/swagger-ui-dist'))
  );
  aplicacion.get('/api/federacion/v1/openapi.yaml', (_requisicion, respuesta) => {
    respuesta
      .type('application/yaml')
      .set('Cache-Control', 'no-store')
      .sendFile(path.join(__dirname, '../../../openapi/federacion-control.v1.yaml'));
  });
  aplicacion.use(
    crearRutasApiFederacion({
      controladorApiFederacion,
      guardiaRecepcionFederacion: guardiaRecepcion
    })
  );
  aplicacion.use(
    crearRutasApiAgentes({
      controladorApiAgentes,
      ddnsAgentesHabilitado
    })
  );
  aplicacion.use(sessionMiddleware);
  aplicacion.use(
    crearMiddlewareSincronizarConfiguracionPortal({
      servicioConfiguracionPortal
    })
  );
  aplicacion.use(crearMiddlewareInyectarSesionVista({
    ddnsAgentesHabilitado,
    eliminacionAdministrativaAgentesHttpHabilitada:
      eliminacionAdministrativaAgentesHttpHabilitada,
    eliminacionAdministrativaOrganizacionesHttpHabilitada:
      eliminacionAdministrativaOrganizacionesHttpHabilitada
  }));

  aplicacion.use(
    crearRutasPortal({
      controladorLogin,
      controladorRecuperacionPassword,
      controladorPortal,
      controladorOrganizacion,
      controladorUsuarios,
      controladorImpersonacion,
      controladorMonitores,
      controladorTriggers,
      controladorDns,
      controladorAgentes,
      controladorEliminacionAdministrativaAgentes,
      controladorEliminacionAdministrativaOrganizaciones,
      controladorReglasDerivacionTelemetria,
      controladorAuditoria,
      controladorFederacion,
      servicioSesion,
      controladorPow,
      controladorDesuscripcionTriggerCorreo,
      servicioContextoUsuario,
      servicioAutorizacion,
      ddnsAgentesHabilitado,
      eliminacionAdministrativaAgentesHttpHabilitada:
        eliminacionAdministrativaAgentesHttpHabilitada,
      eliminacionAdministrativaOrganizacionesHttpHabilitada:
        eliminacionAdministrativaOrganizacionesHttpHabilitada
    })
  );

  aplicacion.get('/', (_peticion, respuesta) => {
    respuesta.redirect('/panel');
  });

  aplicacion.get('/salud', (_peticion, respuesta) => {
    respuesta.json({
      estado: 'ok',
      aplicacion: 'sentinelia-web',
      faseActual: '5.12.6',
      entorno: configuracion.entorno,
      sqlConfigurado: configuracion.sql.estaCompleta,
      sqlUsoHorarioUtc: resumenArranque.migraciones.usoHorarioUtc,
      redis: estadoRedis,
      configuracionPortal: {
        ...resumenArranque.configuracionPortal,
        version: servicioConfiguracionPortal.obtenerVersionActual(),
        totalClaves:
          servicioConfiguracionPortal.construirResumenEstado().totalClaves
      },
      correo: servicioCorreoPortal.obtenerEstadoConfiguracion(),
      eliminacionAdministrativaAgentes:
        resumenArranque.eliminacionAdministrativaAgentes,
      eliminacionAdministrativaOrganizaciones:
        resumenArranque.eliminacionAdministrativaOrganizaciones,
      despliegueTriggerCorreo: resumenArranque.despliegueTriggerCorreo,
      despliegueDdnsAgentes: resumenArranque.despliegueDdnsAgentes,
      migraciones: resumenArranque.migraciones
    });
  });

  aplicacion.use((peticion, respuesta, next) => {
    if (peticion.method !== 'GET' && peticion.method !== 'HEAD') {
      next();
      return;
    }

    if (!peticion.accepts('html')) {
      respuesta.status(404).json({
        ok: false,
        codigo: 'recurso_no_encontrado',
        mensaje: 'El recurso solicitado no está disponible.'
      });
      return;
    }

    respuesta
      .status(404)
      .set('Cache-Control', 'no-store')
      .render('portal/no-encontrado', {
        titulo: 'Página no encontrada'
      });
  });

  aplicacion.use((error, peticion, respuesta, _next) => {
    if (peticion.path?.startsWith('/api/federacion/v1/datos/')) {
      return responderErrorDatosFederacion(error, peticion, respuesta);
    }
    if (peticion.path?.startsWith('/api/federacion/')) {
      const jsonInvalido = error?.type === 'entity.parse.failed';
      if (!jsonInvalido) {
        console.error(
          `[sentinelia-web] Fallo interno en API federada (${error?.name || 'Error'}).`
        );
      }
      respuesta
        .status(jsonInvalido ? 400 : 500)
        .type('application/problem+json')
        .set('Cache-Control', 'no-store')
        .json({
          ok: false,
          codigo: jsonInvalido ? 'PETICION_JSON_INVALIDA' : 'ERROR_INTERNO_FEDERACION',
          mensaje: jsonInvalido
            ? 'El cuerpo de la petición no es JSON válido.'
            : 'La API federada no pudo procesar la petición.'
        });
      return;
    }

    if (peticion.path?.startsWith('/api/agentes/')) {
      // body-parser puede adjuntar el cuerpo a la excepción: nunca registrarlo
      // en esta frontera (también atiende login y renovación de sesión).
      const errorLectura = [
        'entity.parse.failed', 'entity.too.large', 'request.aborted',
        'request.size.invalid', 'charset.unsupported', 'encoding.unsupported'
      ].includes(error?.type);
      const publico = errorLectura
        ? Object.assign(new Error('El cuerpo de la petición no es JSON válido.'), {
          statusCode: 400, codigo: 'peticion_invalida'
        })
        : error;
      const requestId = controladorApiAgentes.generarRequestId();
      if (!errorLectura) {
        console.error('[sentinelia-web] Fallo interno en API de agentes.');
      }
      if (/^\/api\/agentes\/v1\/telemetria\/?$/u.test(peticion.path)) {
        controladorApiAgentes.responderErrorTelemetria(respuesta, publico, requestId);
      } else if (errorLectura) {
        controladorApiAgentes.responderError(respuesta, publico, requestId);
      } else {
        respuesta.status(500).json({ ok: false, requestId,
          code: 'error_interno', message: 'No se pudo completar la petición del agente.' });
      }
      return;
    }

    console.error('[sentinelia-web] Error de peticion');
    console.error(error);

    respuesta.status(500).send('Error interno del portal.');
  });

  return aplicacion;
}

function redactarCapacidadDesuscripcionParaLogs(requisicion, _respuesta, next) {
  if (/^\/correo\/desuscripcion\/[^/?]+/u.test(requisicion.originalUrl || '')) {
    requisicion.originalUrl = String(requisicion.originalUrl).replace(
      /^(\/correo\/desuscripcion\/)[^/?]+/u,
      '$1[REDACTADO]'
    );
  }
  next();
}

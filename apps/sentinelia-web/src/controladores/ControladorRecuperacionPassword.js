import { ErrorNormalizacionBuzonCorreo }
  from '../../../../paquetes/correo/src/NormalizadorBuzonCorreo.js';
import {
  RESULTADOS_PUBLICOS_RECUPERACION_PASSWORD_EMAIL
} from '../../../../paquetes/usuarios/src/ContratoRecuperacionPasswordEmail.js';
import { AlegacionWebRecuperacionPasswordInvalida }
  from '../../../../paquetes/usuarios/src/ServicioContinuacionWebRecuperacionPasswordEmail.js';
import { ErrorPoliticaPasswordRecuperacion }
  from '../../../../paquetes/usuarios/src/ServicioSustitucionPasswordRecuperacionEmail.js';

const RUTA_CONTINUACION = '/recuperacion-password/continuar';
const MENSAJE_NO_UTILIZABLE =
  'No se puede continuar con esta solicitud. Solicita un enlace nuevo si todavía necesitas recuperar tu contraseña.';
const MENSAJE_ALEGACION_NO_RESUELTA =
  'No se ha podido comprobar esa cuenta con esta solicitud.';

export class ControladorRecuperacionPassword {
  constructor({
    servicioInicio,
    servicioContinuacion,
    servicioSesion,
    superficiePublicaHabilitada = () => false
  } = {}) {
    exigirMetodo(servicioInicio, 'emitirDesafio', 'servicioInicio');
    exigirMetodo(servicioInicio, 'iniciar', 'servicioInicio');
    exigirMetodo(servicioContinuacion, 'inspeccionar', 'servicioContinuacion');
    exigirMetodo(servicioContinuacion, 'resolver', 'servicioContinuacion');
    exigirMetodo(servicioContinuacion, 'sustituir', 'servicioContinuacion');
    exigirMetodo(servicioSesion, 'asegurarTokenCsrfPublico', 'servicioSesion');
    exigirMetodo(servicioSesion, 'guardarContinuacionRecuperacionPassword',
      'servicioSesion');
    exigirMetodo(servicioSesion, 'obtenerContinuacionRecuperacionPassword',
      'servicioSesion');
    exigirMetodo(servicioSesion, 'marcarIdentidadResueltaRecuperacionPassword',
      'servicioSesion');
    exigirMetodo(servicioSesion, 'limpiarContinuacionRecuperacionPassword',
      'servicioSesion');
    if (typeof superficiePublicaHabilitada !== 'function') {
      throw new Error('La superficie pública requiere un gate explícito.');
    }
    this.inicio = servicioInicio;
    this.continuacion = servicioContinuacion;
    this.sesiones = servicioSesion;
    this.superficiePublicaHabilitada = superficiePublicaHabilitada;
  }

  async recibirEnlace(requisicion, respuesta) {
    endurecerRespuesta(respuesta);
    try {
      const token = typeof requisicion.query?.token === 'string'
        ? requisicion.query.token
        : '';
      const inspeccion = await this.continuacion.inspeccionar(token);
      if (inspeccion.utilizable) {
        await this.sesiones.guardarContinuacionRecuperacionPassword(requisicion, {
          token,
          expiraEnUtc: inspeccion.expiraEnUtc
        });
      } else {
        await this.sesiones.limpiarContinuacionRecuperacionPassword(requisicion);
      }
      respuesta.redirect(303, RUTA_CONTINUACION);
    } catch (error) {
      console.error(
        `[sentinelia-web] Inspección de recuperación no disponible (${String(error?.codigo || error?.name || 'Error')}).`
      );
      respuesta.redirect(303, `${RUTA_CONTINUACION}?estado=indisponible`);
    }
  }

  async mostrarResolucion(requisicion, respuesta) {
    endurecerRespuesta(respuesta);
    try {
      const tokenCSRFPortal =
        await this.sesiones.asegurarTokenCsrfPublico(requisicion);
      respuesta.locals.tokenCSRFPortal = tokenCSRFPortal;
      if (requisicion.query?.estado === 'indisponible') {
        this.#renderizarResolucion(respuesta, {
          estadoHttp: 503,
          disponible: false,
          mensaje: RESULTADOS_PUBLICOS_RECUPERACION_PASSWORD_EMAIL
            .PLATAFORMA_NO_DISPONIBLE.mensaje
        });
        return;
      }
      const continuacion =
        this.sesiones.obtenerContinuacionRecuperacionPassword(requisicion);
      if (!continuacion) {
        this.#renderizarResolucion(respuesta, {
          estadoHttp: 400,
          disponible: false,
          mensaje: MENSAJE_NO_UTILIZABLE
        });
        return;
      }
      const inspeccion = await this.continuacion.inspeccionar(continuacion.token);
      if (!inspeccion.utilizable) {
        await this.sesiones.limpiarContinuacionRecuperacionPassword(requisicion);
        this.#renderizarResolucion(respuesta, {
          estadoHttp: 400,
          disponible: false,
          mensaje: MENSAJE_NO_UTILIZABLE
        });
        return;
      }
      this.#renderizarResolucion(respuesta, {
        estadoHttp: 200,
        disponible: true,
        resuelta: continuacion.identidadResuelta
      });
    } catch (error) {
      this.#registrarFalloContinuacion(error);
      this.#renderizarResolucion(respuesta, {
        estadoHttp: 503,
        disponible: false,
        mensaje: RESULTADOS_PUBLICOS_RECUPERACION_PASSWORD_EMAIL
          .PLATAFORMA_NO_DISPONIBLE.mensaje
      });
    }
  }

  async resolverIdentidad(requisicion, respuesta) {
    endurecerRespuesta(respuesta);
    const usuario = String(requisicion.body?.usuario || '').trim();
    try {
      const tokenCSRFPortal =
        await this.sesiones.asegurarTokenCsrfPublico(requisicion);
      respuesta.locals.tokenCSRFPortal = tokenCSRFPortal;
      const continuacion =
        this.sesiones.obtenerContinuacionRecuperacionPassword(requisicion);
      if (!continuacion) {
        this.#renderizarResolucion(respuesta, {
          estadoHttp: 400,
          disponible: false,
          mensaje: MENSAJE_NO_UTILIZABLE
        });
        return;
      }
      const resultado = await this.continuacion.resolver({
        token: continuacion.token,
        usuario
      });
      if (resultado.resuelta) {
        await this.sesiones.marcarIdentidadResueltaRecuperacionPassword(requisicion);
        this.#renderizarResolucion(respuesta, {
          estadoHttp: 200,
          disponible: true,
          resuelta: true
        });
        return;
      }
      if (!resultado.utilizable || resultado.estado === 'presupuesto_agotado') {
        await this.sesiones.limpiarContinuacionRecuperacionPassword(requisicion);
        this.#renderizarResolucion(respuesta, {
          estadoHttp: 400,
          disponible: false,
          mensaje: MENSAJE_NO_UTILIZABLE
        });
        return;
      }
      this.#renderizarResolucion(respuesta, {
        estadoHttp: 200,
        disponible: true,
        error: MENSAJE_ALEGACION_NO_RESUELTA,
        usuario: ''
      });
    } catch (error) {
      if (error instanceof AlegacionWebRecuperacionPasswordInvalida) {
        this.#renderizarResolucion(respuesta, {
          estadoHttp: 200,
          disponible: true,
          error: MENSAJE_ALEGACION_NO_RESUELTA,
          usuario: ''
        });
        return;
      }
      this.#registrarFalloContinuacion(error);
      this.#renderizarResolucion(respuesta, {
        estadoHttp: 503,
        disponible: false,
        mensaje: RESULTADOS_PUBLICOS_RECUPERACION_PASSWORD_EMAIL
          .PLATAFORMA_NO_DISPONIBLE.mensaje
      });
    }
  }

  async sustituirPassword(requisicion, respuesta) {
    endurecerRespuesta(respuesta);
    try {
      const tokenCSRFPortal =
        await this.sesiones.asegurarTokenCsrfPublico(requisicion);
      respuesta.locals.tokenCSRFPortal = tokenCSRFPortal;
      const continuacion =
        this.sesiones.obtenerContinuacionRecuperacionPassword(requisicion);
      if (!continuacion?.identidadResuelta) {
        this.#renderizarResolucion(respuesta, {
          estadoHttp: 400,
          disponible: false,
          mensaje: MENSAJE_NO_UTILIZABLE
        });
        return;
      }
      const resultado = await this.continuacion.sustituir({
        token: continuacion.token,
        passwordNuevo: requisicion.body?.password_nuevo,
        passwordConfirmacion: requisicion.body?.password_confirmacion
      });
      if (resultado.sustituida) {
        await this.sesiones.limpiarContinuacionRecuperacionPassword(requisicion)
          .catch((error) => this.#registrarFalloContinuacion(error));
        this.#renderizarResolucion(respuesta, {
          estadoHttp: 200,
          disponible: false,
          completada: true,
          mensaje:
            'La contraseña se ha sustituido. Inicia sesión de nuevo con tu nueva credencial.'
        });
        return;
      }
      await this.sesiones.limpiarContinuacionRecuperacionPassword(requisicion);
      this.#renderizarResolucion(respuesta, {
        estadoHttp: 400,
        disponible: false,
        mensaje: MENSAJE_NO_UTILIZABLE
      });
    } catch (error) {
      if (error instanceof ErrorPoliticaPasswordRecuperacion) {
        this.#renderizarResolucion(respuesta, {
          estadoHttp: 400,
          disponible: true,
          resuelta: true,
          error: error.message
        });
        return;
      }
      this.#registrarFalloContinuacion(error);
      this.#renderizarResolucion(respuesta, {
        estadoHttp: 503,
        disponible: false,
        mensaje: RESULTADOS_PUBLICOS_RECUPERACION_PASSWORD_EMAIL
          .PLATAFORMA_NO_DISPONIBLE.mensaje
      });
    }
  }

  async mostrarFormulario(requisicion, respuesta, next) {
    try {
      const tokenCSRFPortal =
        await this.sesiones.asegurarTokenCsrfPublico(requisicion);
      respuesta.locals.tokenCSRFPortal = tokenCSRFPortal;
      if (!await this.superficiePublicaHabilitada()) {
        this.#renderizar(respuesta, {
          estadoHttp: 503,
          disponible: false,
          mensaje: RESULTADOS_PUBLICOS_RECUPERACION_PASSWORD_EMAIL
            .PLATAFORMA_NO_DISPONIBLE.mensaje
        });
        return;
      }
      this.#renderizar(respuesta, { estadoHttp: 200, disponible: true });
    } catch (error) {
      next(error);
    }
  }

  async emitirDesafio(requisicion, respuesta, _next) {
    try {
      if (!await this.superficiePublicaHabilitada()) {
        respuesta.status(503).json(
          RESULTADOS_PUBLICOS_RECUPERACION_PASSWORD_EMAIL.PLATAFORMA_NO_DISPONIBLE
        );
        return;
      }
      const desafio = await this.inicio.emitirDesafio({
        origenRed: resolverIpCliente(requisicion),
        hashrateCliente: Number(requisicion.body?.hashrateCliente || 0)
      });
      respuesta.json(desafio);
    } catch (error) {
      console.error(
        `[sentinelia-web] Desafío de recuperación no disponible (${String(error?.codigo || error?.name || 'Error')}).`
      );
      respuesta.status(503).json(
        RESULTADOS_PUBLICOS_RECUPERACION_PASSWORD_EMAIL.PLATAFORMA_NO_DISPONIBLE
      );
    }
  }

  async procesar(requisicion, respuesta, _next) {
    try {
      const tokenCSRFPortal =
        await this.sesiones.asegurarTokenCsrfPublico(requisicion);
      respuesta.locals.tokenCSRFPortal = tokenCSRFPortal;
      if (!await this.superficiePublicaHabilitada()) {
        this.#renderizar(respuesta, {
          estadoHttp: 503,
          disponible: false,
          mensaje: RESULTADOS_PUBLICOS_RECUPERACION_PASSWORD_EMAIL
            .PLATAFORMA_NO_DISPONIBLE.mensaje
        });
        return;
      }
      const buzon = String(requisicion.body?.email || '');
      const resultado = await this.inicio.iniciar({
        buzon,
        origenRed: resolverIpCliente(requisicion),
        entregaPow: {
          idDesafio: requisicion.body?.pow_desafio_id,
          nonce: requisicion.body?.pow_nonce,
          duracionClienteMs: requisicion.body?.pow_duracion_ms,
          hashrateCliente: requisicion.body?.pow_hashrate_cliente
        }
      });
      if (!resultado.alcanzoAdmision && resultado.resultadoPow) {
        this.#renderizar(respuesta, {
          estadoHttp: 400,
          disponible: true,
          error: String(resultado.resultadoPow.mensaje ||
            'No se pudo validar la prueba de trabajo.'),
          email: buzon.trim()
        });
        return;
      }
      const publico = resultado.resultadoPublico;
      this.#renderizar(respuesta, {
        estadoHttp: publico.estadoHttp,
        disponible: publico.estadoHttp !== 503,
        mensaje: publico.mensaje,
        completada: publico.estadoHttp === 202,
        email: publico.estadoHttp === 202 ? '' : buzon.trim()
      });
    } catch (error) {
      if (error instanceof ErrorNormalizacionBuzonCorreo) {
        this.#renderizar(respuesta, {
          estadoHttp: 400,
          disponible: true,
          error: 'Indica una dirección de correo válida.',
          email: String(requisicion.body?.email || '').trim()
        });
        return;
      }
      console.error(
        `[sentinelia-web] Recuperación pública no disponible (${String(error?.codigo || error?.name || 'Error')}).`
      );
      this.#renderizar(respuesta, {
        estadoHttp: 503,
        disponible: false,
        mensaje: RESULTADOS_PUBLICOS_RECUPERACION_PASSWORD_EMAIL
          .PLATAFORMA_NO_DISPONIBLE.mensaje
      });
    }
  }

  #renderizar(respuesta, {
    estadoHttp,
    disponible,
    mensaje = null,
    error = null,
    completada = false,
    email = ''
  }) {
    respuesta.status(estadoHttp).set('Cache-Control', 'no-store').render(
      'recuperacion-password-inicio',
      {
        titulo: 'Recuperar contraseña',
        disponible,
        mensaje,
        error,
        completada,
        formulario: { email }
      }
    );
  }

  #renderizarResolucion(respuesta, {
    estadoHttp,
    disponible,
    mensaje = null,
    error = null,
    resuelta = false,
    completada = false,
    usuario = ''
  }) {
    endurecerRespuesta(respuesta);
    respuesta.status(estadoHttp).render('recuperacion-password-resolucion', {
      titulo: 'Continuar recuperación',
      disponible,
      mensaje,
      error,
      resuelta,
      completada,
      formulario: { usuario }
    });
  }

  #registrarFalloContinuacion(error) {
    console.error(
      `[sentinelia-web] Continuación de recuperación no disponible (${String(error?.codigo || error?.name || 'Error')}).`
    );
  }
}

function resolverIpCliente(requisicion) {
  return String(requisicion.ip || '').replace(/^::ffff:/u, '').trim();
}

function endurecerRespuesta(respuesta) {
  respuesta.set('Cache-Control', 'no-store, max-age=0');
  respuesta.set('Pragma', 'no-cache');
  respuesta.set('Referrer-Policy', 'no-referrer');
  respuesta.set('X-Robots-Tag', 'noindex, nofollow, noarchive');
  return respuesta;
}

function exigirMetodo(objeto, metodo, nombre) {
  if (typeof objeto?.[metodo] !== 'function') {
    throw new Error(`${nombre}.${metodo} es obligatorio.`);
  }
}

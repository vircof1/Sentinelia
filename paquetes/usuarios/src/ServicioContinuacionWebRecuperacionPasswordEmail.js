import {
  ESTADOS_SOLICITUD_RECUPERACION_PASSWORD_EMAIL,
  RESULTADOS_ALEGACION_RECUPERACION_PASSWORD_EMAIL
} from './ContratoRecuperacionPasswordEmail.js';

const PATRON_TOKEN_BEARER = /^[A-Za-z0-9_-]{43}$/u;

export class AlegacionWebRecuperacionPasswordInvalida extends Error {
  constructor() {
    super('La identidad alegada no tiene un formato válido.');
    this.name = 'AlegacionWebRecuperacionPasswordInvalida';
    this.codigo = 'ALEGACION_RECUPERACION_PASSWORD_INVALIDA';
  }
}

export class ServicioContinuacionWebRecuperacionPasswordEmail {
  constructor({
    repositorioSolicitudes,
    servicioResolucion,
    servicioConsumo,
    servicioConfiguracionPortal
  } = {}) {
    exigirMetodo(repositorioSolicitudes, 'inspeccionar', 'repositorioSolicitudes');
    exigirMetodo(servicioResolucion, 'resolver', 'servicioResolucion');
    exigirMetodo(servicioConsumo, 'sustituirYConverger', 'servicioConsumo');
    exigirMetodo(servicioConfiguracionPortal, 'asegurarActualizada',
      'servicioConfiguracionPortal');
    exigirMetodo(servicioConfiguracionPortal, 'obtenerConfiguracionActual',
      'servicioConfiguracionPortal');
    this.solicitudes = repositorioSolicitudes;
    this.resolucion = servicioResolucion;
    this.consumo = servicioConsumo;
    this.configuracion = servicioConfiguracionPortal;
  }

  async inspeccionar(token) {
    if (!tokenBearerValido(token)) return resultadoNoUtilizable('ausente');
    const inspeccion = await this.solicitudes.inspeccionar(token);
    const utilizable = inspeccion.estado ===
      ESTADOS_SOLICITUD_RECUPERACION_PASSWORD_EMAIL.ACTIVA &&
      Boolean(inspeccion.solicitud?.expiraEnUtc);
    if (!utilizable) return resultadoNoUtilizable(inspeccion.estado);
    return Object.freeze({
      estado: inspeccion.estado,
      utilizable: true,
      expiraEnUtc: inspeccion.solicitud.expiraEnUtc
    });
  }

  async resolver({ token, usuario } = {}) {
    if (!tokenBearerValido(token)) return resultadoNoUtilizable('ausente');
    const nombre = String(usuario ?? '').trim();
    if (!/^[a-zA-Z0-9._-]{3,80}$/u.test(nombre)) {
      throw new AlegacionWebRecuperacionPasswordInvalida();
    }
    await this.configuracion.asegurarActualizada();
    const politica = this.configuracion.obtenerConfiguracionActual()
      .obtenerConfiguracionUsuarios();
    const resultado = await this.resolucion.resolver({
      token,
      usuario: nombre,
      leaseSegundos: politica.recuperacionEmailLeaseAlegacionSegundos
    });
    return Object.freeze({
      estado: resultado.estado,
      utilizable: Boolean(resultado.utilizable),
      resuelta: resultado.estado ===
        RESULTADOS_ALEGACION_RECUPERACION_PASSWORD_EMAIL.RESUELTA
    });
  }

  async sustituir({ token, passwordNuevo, passwordConfirmacion } = {}) {
    if (!tokenBearerValido(token)) return resultadoNoUtilizable('ausente');
    await this.configuracion.asegurarActualizada();
    const politica = this.configuracion.obtenerConfiguracionActual()
      .obtenerConfiguracionUsuarios();
    const resultado = await this.consumo.sustituirYConverger({
      token,
      passwordNuevo,
      passwordConfirmacion,
      leaseSegundos: politica.recuperacionEmailLeaseConsumoSegundos
    });
    return Object.freeze({
      estado: String(resultado.estado || 'no_utilizable'),
      sustituida: resultado.sustituida === true,
      convergencia: resultado.convergencia || null
    });
  }
}

function tokenBearerValido(token) {
  return typeof token === 'string' && PATRON_TOKEN_BEARER.test(token);
}

function resultadoNoUtilizable(estado) {
  return Object.freeze({ estado: String(estado || 'ausente'), utilizable: false });
}

function exigirMetodo(objeto, metodo, nombre) {
  if (typeof objeto?.[metodo] !== 'function') {
    throw new Error(`${nombre}.${metodo} es obligatorio.`);
  }
}

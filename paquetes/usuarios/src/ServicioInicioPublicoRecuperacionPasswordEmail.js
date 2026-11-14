import { normalizarBuzonCorreo }
  from '../../correo/src/NormalizadorBuzonCorreo.js';
import {
  RESULTADOS_ADMISION_RECUPERACION_PASSWORD_EMAIL,
  proyectarResultadoPublicoRecuperacionPasswordEmail
} from './ContratoRecuperacionPasswordEmail.js';

export class ServicioInicioPublicoRecuperacionPasswordEmail {
  constructor({
    servicioAdmision,
    servicioPreparacion,
    servicioActivacion,
    servicioConfiguracionPortal,
    esperar = esperarMilisegundos,
    aleatorio = Math.random
  } = {}) {
    exigirMetodo(servicioAdmision, 'emitirDesafio', 'servicioAdmision');
    exigirMetodo(servicioAdmision, 'admitir', 'servicioAdmision');
    exigirMetodo(servicioPreparacion, 'preparar', 'servicioPreparacion');
    exigirMetodo(servicioActivacion, 'activarYLiberar', 'servicioActivacion');
    exigirMetodo(servicioConfiguracionPortal, 'asegurarActualizada',
      'servicioConfiguracionPortal');
    exigirMetodo(servicioConfiguracionPortal, 'obtenerConfiguracionActual',
      'servicioConfiguracionPortal');
    if (typeof esperar !== 'function' || typeof aleatorio !== 'function') {
      throw new Error('El jitter público requiere reloj y aleatoriedad.');
    }
    this.admision = servicioAdmision;
    this.preparacion = servicioPreparacion;
    this.activacion = servicioActivacion;
    this.configuracion = servicioConfiguracionPortal;
    this.esperar = esperar;
    this.aleatorio = aleatorio;
  }

  emitirDesafio(entrada = {}) {
    return this.admision.emitirDesafio(entrada);
  }

  async iniciar({ buzon, origenRed, entregaPow } = {}) {
    const buzonCanonico = normalizarBuzonCorreo(String(buzon ?? '')).canonico;
    const admision = await this.admision.admitir({
      buzonCanonico,
      origenRed,
      entregaPow
    });
    if (!admision.alcanzoAdmision) {
      return Object.freeze({
        admitida: false,
        alcanzoAdmision: false,
        resultadoPow: admision.resultadoPow
      });
    }
    if (!admision.admitida) {
      return Object.freeze({
        admitida: false,
        alcanzoAdmision: true,
        resultadoPublico: admision.resultadoPublico
      });
    }

    const preparacion = await this.preparacion.preparar({
      buzon: buzonCanonico,
      direccionIp: origenRed
    });
    if (preparacion.preparada) {
      await this.activacion.activarYLiberar(preparacion);
    }

    await this.#aplicarJitter();
    return Object.freeze({
      admitida: true,
      alcanzoAdmision: true,
      resultadoPublico: proyectarResultadoPublicoRecuperacionPasswordEmail({
        operacion: 'admision',
        resultadoInterno: preparacion.preparada
          ? RESULTADOS_ADMISION_RECUPERACION_PASSWORD_EMAIL.EMITIDA
          : RESULTADOS_ADMISION_RECUPERACION_PASSWORD_EMAIL.SIN_IDENTIDADES
      })
    });
  }

  async #aplicarJitter() {
    await this.configuracion.asegurarActualizada();
    const maximo = Number(this.configuracion.obtenerConfiguracionActual()
      .obtenerConfiguracionUsuarios().recuperacionEmailJitterMaximoMs);
    const fraccion = Math.max(0, Math.min(0.999999999, Number(this.aleatorio())));
    const demora = Math.floor(fraccion * (Math.max(0, maximo) + 1));
    if (demora > 0) await this.esperar(demora);
  }
}

function esperarMilisegundos(milisegundos) {
  return new Promise((resolver) => setTimeout(resolver, milisegundos));
}

function exigirMetodo(objeto, metodo, nombre) {
  if (typeof objeto?.[metodo] !== 'function') {
    throw new Error(`${nombre}.${metodo} es obligatorio.`);
  }
}

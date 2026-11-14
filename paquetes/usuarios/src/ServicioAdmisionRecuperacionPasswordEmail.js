import {
  RESULTADOS_ADMISION_RECUPERACION_PASSWORD_EMAIL,
  proyectarResultadoPublicoRecuperacionPasswordEmail
} from './ContratoRecuperacionPasswordEmail.js';

export class ServicioAdmisionRecuperacionPasswordEmail {
  constructor({
    servicioPow,
    repositorioAdmision,
    servicioConfiguracionPortal
  } = {}) {
    exigirMetodo(servicioPow, 'emitirDesafio', 'servicioPow');
    exigirMetodo(servicioPow, 'validarEntrega', 'servicioPow');
    exigirMetodo(repositorioAdmision, 'registrarIntento', 'repositorioAdmision');
    exigirMetodo(servicioConfiguracionPortal, 'asegurarActualizada',
      'servicioConfiguracionPortal');
    exigirMetodo(servicioConfiguracionPortal, 'obtenerConfiguracionActual',
      'servicioConfiguracionPortal');
    this.servicioPow = servicioPow;
    this.repositorioAdmision = repositorioAdmision;
    this.servicioConfiguracionPortal = servicioConfiguracionPortal;
  }

  emitirDesafio({ origenRed, hashrateCliente } = {}) {
    return this.servicioPow.emitirDesafio({
      ip: exigirOrigenRed(origenRed),
      hashrateCliente
    });
  }

  async admitir({ buzonCanonico, origenRed, entregaPow } = {}) {
    const origen = exigirOrigenRed(origenRed);
    const resultadoPow = await this.servicioPow.validarEntrega({
      ip: origen,
      idDesafio: entregaPow?.idDesafio,
      nonce: entregaPow?.nonce,
      duracionClienteMs: entregaPow?.duracionClienteMs,
      hashrateCliente: entregaPow?.hashrateCliente
    });
    if (!resultadoPow.exito) {
      return Object.freeze({
        admitida: false,
        alcanzoAdmision: false,
        resultadoPow: Object.freeze({ ...resultadoPow })
      });
    }

    await this.servicioConfiguracionPortal.asegurarActualizada();
    const configuracion = this.servicioConfiguracionPortal
      .obtenerConfiguracionActual()
      .obtenerConfiguracionUsuarios();
    const evaluacion = await this.repositorioAdmision.registrarIntento({
      buzonCanonico,
      origenRed: origen,
      configuracion
    });
    const resultadoInterno = evaluacion.admitida
      ? RESULTADOS_ADMISION_RECUPERACION_PASSWORD_EMAIL.EMITIDA
      : RESULTADOS_ADMISION_RECUPERACION_PASSWORD_EMAIL.SATURADA;
    return Object.freeze({
      admitida: evaluacion.admitida,
      alcanzoAdmision: true,
      resultadoPublico: proyectarResultadoPublicoRecuperacionPasswordEmail({
        operacion: 'admision',
        resultadoInterno
      }),
      observadaEnUtc: evaluacion.observadaEnUtc
    });
  }
}

function exigirOrigenRed(valor) {
  const origen = String(valor ?? '').replace(/^::ffff:/u, '').trim();
  if (!origen || origen.length > 255) {
    throw new Error('La admisión requiere requisicion.ip resuelta por Express.');
  }
  return origen;
}

function exigirMetodo(objeto, metodo, nombre) {
  if (typeof objeto?.[metodo] !== 'function') {
    throw new Error(`${nombre}.${metodo} es obligatorio.`);
  }
}

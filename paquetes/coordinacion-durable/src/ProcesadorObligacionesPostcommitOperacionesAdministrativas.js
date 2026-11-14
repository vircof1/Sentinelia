import {
  LeaseOperacionDurablePerdido
} from './CoordinadorOperacionesDurables.js';

export class ProcesadorObligacionesPostcommitOperacionesAdministrativas {
  constructor({ coordinador, ejecutor } = {}) {
    if (typeof coordinador?.reclamarSiguiente !== 'function' ||
        typeof coordinador?.consolidar !== 'function' ||
        typeof coordinador?.registrarFallo !== 'function') {
      throw new Error('El procesador postcommit exige coordinación durable.');
    }
    if (typeof ejecutor?.ejecutar !== 'function' ||
        typeof ejecutor?.publicarInvalidacionDestinatario !== 'function') {
      throw new Error('El procesador postcommit exige un ejecutor tipado.');
    }
    this.coordinador = coordinador;
    this.ejecutor = ejecutor;
  }

  async procesarSiguiente() {
    const reclamada = await this.coordinador.reclamarSiguiente();
    if (reclamada === null) return null;
    const { lease, intentos, operacion } = reclamada;
    try {
      const efecto = await this.ejecutor.ejecutar(operacion);
      const cierre = await this.coordinador.consolidar(
        lease,
        { resultado: null }
      );
      let invalidacionFinal = null;
      const destinatario = cierre.convergencia?.notificacion
        ? cierre.convergencia.destinatarioUsuarioId
        : null;
      if (destinatario) {
        try {
          invalidacionFinal = await this.ejecutor
            .publicarInvalidacionDestinatario(destinatario);
        } catch (error) {
          invalidacionFinal = Object.freeze({
            publicada: false,
            motivo: 'canal_no_disponible',
            codigo: codigoError(error)
          });
        }
      }
      return Object.freeze({
        obligacionId: operacion.obligacionId,
        operacionId: operacion.eliminacionOperacionId,
        tipo: operacion.tipo,
        ...(operacion.objetivoTipado
          ? { objetivoTipado: operacion.objetivoTipado }
          : {}),
        estado: cierre.estado,
        intento: intentos,
        efecto,
        situacion: cierre.situacion,
        convergencia: cierre.convergencia,
        invalidacionFinal
      });
    } catch (error) {
      if (error instanceof LeaseOperacionDurablePerdido) throw error;
      const fallo = clasificarFallo(error);
      const registrado = await this.coordinador.registrarFallo(lease, {
        ...fallo,
        demoraReintentoSegundos: calcularDemoraReintento(intentos)
      });
      return Object.freeze({
        obligacionId: operacion.obligacionId,
        operacionId: operacion.eliminacionOperacionId,
        tipo: operacion.tipo,
        ...(operacion.objetivoTipado
          ? { objetivoTipado: operacion.objetivoTipado }
          : {}),
        estado: registrado.estado,
        intento: intentos,
        codigo: fallo.codigo
      });
    }
  }
}

function clasificarFallo(error) {
  if (error?.esErrorObligacionPostcommit === true) {
    return Object.freeze({
      codigo: error.codigo,
      mensaje: error.message,
      permanente: error.permanente
    });
  }
  return Object.freeze({
    codigo: 'obligacion_postcommit_error_inesperado',
    mensaje: error?.message || 'La obligación postcommit falló sin diagnóstico.',
    permanente: false
  });
}

function calcularDemoraReintento(intentos) {
  const exponente = Math.max(0, Math.min(Number(intentos) - 1, 8));
  return Math.min(2 ** exponente, 300);
}

function codigoError(error) {
  return String(error?.codigo || error?.code || 'error_publicacion_postcommit')
    .replace(/[^a-z0-9_]+/giu, '_')
    .slice(0, 64);
}

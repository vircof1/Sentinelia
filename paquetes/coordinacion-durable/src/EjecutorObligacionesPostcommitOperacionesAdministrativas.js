export class EjecutorObligacionesPostcommitOperacionesAdministrativas {
  constructor({ ejecutorAgentes, ejecutorOrganizacion } = {}) {
    exigirEjecutor(ejecutorAgentes, 'agentes');
    exigirEjecutor(ejecutorOrganizacion, 'organización');
    if (typeof ejecutorAgentes.publicarInvalidacionDestinatario !== 'function') {
      throw new Error('El ejecutor común exige publicación final de buzón.');
    }
    this.ejecutorAgentes = ejecutorAgentes;
    this.ejecutorOrganizacion = ejecutorOrganizacion;
  }

  async ejecutar(obligacion) {
    const tipoObjetivo = String(obligacion?.objetivoTipado?.tipo || '');
    if (['tenant', 'empresa', 'sitio'].includes(tipoObjetivo)) {
      return this.ejecutorOrganizacion.ejecutar(obligacion);
    }
    if (['agente', 'usuario'].includes(tipoObjetivo)) {
      return this.ejecutorAgentes.ejecutar(obligacion);
    }
    throw errorContrato('El objetivo postcommit no pertenece al catálogo común.');
  }

  publicarInvalidacionDestinatario(destinatarioUsuarioId) {
    return this.ejecutorAgentes
      .publicarInvalidacionDestinatario(destinatarioUsuarioId);
  }
}

function exigirEjecutor(ejecutor, nombre) {
  if (typeof ejecutor?.ejecutar !== 'function') {
    throw new Error(`El ejecutor común exige el adaptador de ${nombre}.`);
  }
}

function errorContrato(mensaje) {
  return Object.assign(new Error(mensaje), {
    codigo: 'obligacion_postcommit_contrato_incompatible',
    permanente: true,
    esErrorObligacionPostcommit: true
  });
}

import { sanearDiagnosticoOperacionDurable } from '../../coordinacion-durable/src/CoordinadorOperacionesDurables.js';

export class ServicioControlRecargaBindDns {
  constructor({
    configuracion,
    comandos,
    supervisor,
    validadorGrafo,
    validadorCandidata,
    activador,
    repositorioCoordinacion,
    coordinador,
    servicioBloqueosDdns = null
  } = {}) {
    if (!configuracion?.activo || !comandos?.validarConfiguracionActiva ||
        !supervisor?.estaVivo || !validadorGrafo?.validar || !validadorCandidata?.validar ||
        !activador?.leerSelectorActivo || !activador?.rutaDirectorioGeneracion ||
        !repositorioCoordinacion?.verificarAutoridadConLease ||
        !coordinador?.avanzar || !coordinador?.consolidar) {
      throw new Error('El control de recarga BIND requiere todos sus puertos operativos.');
    }
    Object.assign(this, {
      configuracion,
      comandos,
      supervisor,
      validadorGrafo,
      validadorCandidata,
      activador,
      repositorioCoordinacion,
      coordinador
    });
    this.servicioBloqueosDdns = servicioBloqueosDdns;
  }

  async observarRecarga({ lease, operacion, fotografia, resultado } = {}) {
    exigirEfecto(lease, operacion, fotografia);
    try {
      await this.validadorCandidata.validar({
        directorioStaging: this.activador.rutaDirectorioGeneracion(operacion.generacionDns),
        proyeccion: fotografia.proyeccion
      });
      await this.validadorGrafo.validar();
      const selectorAntes = await this.#exigirSelectorObjetivo(operacion);
      await this.comandos.validarConfiguracionActiva();
      this.#exigirNamedVivo();
      const recarga = await this.comandos.recargar();
      this.#exigirNamedVivo();
      const selectorDespues = await this.#exigirSelectorObjetivo(operacion);
      if (selectorAntes.generacionDns !== selectorDespues.generacionDns ||
          selectorAntes.hashProyeccion !== selectorDespues.hashProyeccion) {
        throw new Error('El selector BIND cambió durante la recarga.');
      }
      if (!await this.repositorioCoordinacion.verificarAutoridadConLease(
        leaseParaRepositorio(lease)
      )) throw new Error('El publicador perdió fencing antes de confirmar la recarga.');
      const confirmada = await this.coordinador.avanzar(lease, {
        transicion: 'recarga_observada',
        datos: { resultado }
      });
      return Object.freeze({
        observada: true,
        forzada: true,
        selector: selectorDespues,
        recarga,
        operacion: confirmada.operacion
      });
    } catch (causa) {
      await this.#dejarRecuperable(lease, operacion, causa);
      throw new RecargaBindNoObservada(causa);
    }
  }

  async consolidarConfirmada({ lease, operacion, resultado } = {}) {
    if (String(lease?.operacionId) !== String(operacion?.generacionDns) ||
        operacion?.estado !== 'recarga_confirmada' || !operacion?.recargaConfirmadaEnUtc) {
      throw new Error('Solo una recarga durable confirmada puede consolidar su resultado BIND.');
    }
    return this.coordinador.consolidar(lease, { resultado });
  }

  async #exigirSelectorObjetivo(operacion) {
    const selector = await this.activador.leerSelectorActivo();
    if (!selector || selector.generacionDns !== operacion.generacionDns ||
        selector.hashProyeccion !== operacion.hashProyeccion) {
      throw new Error('El selector activo no identifica la proyección congelada de la operación.');
    }
    return selector;
  }

  #exigirNamedVivo() {
    if (!this.supervisor.estaVivo() ||
        !this.supervisor.usaConfiguracion(this.configuracion.namedConfActivo)) {
      throw new Error('El hijo named supervisado no está vivo con BIND_NAMED_CONF_ACTIVO.');
    }
  }

  async #dejarRecuperable(lease, operacion, causa) {
    const diagnostico = sanearDiagnosticoOperacionDurable({
      codigo: causa?.codigo || 'bind_recarga_no_observada',
      mensaje: causa?.message || 'No se observó la recarga BIND.'
    });
    try {
      const bloqueo = await this.servicioBloqueosDdns?.resolver?.({
        lease,
        operacion,
        error: causa,
        efectoIncierto: true
      });
      if (bloqueo?.bloqueado) return;
      await this.coordinador.avanzar(lease, {
        transicion: 'recuperacion_pendiente',
        datos: { diagnostico }
      });
    } catch {
      // Perder el lease impide registrar con autoridad antigua; la operación
      // permanece no terminal y será recuperada por el siguiente propietario.
    }
  }
}

export class RecargaBindNoObservada extends Error {
  constructor(causa) {
    super(causa?.message || 'La recarga BIND no pudo observarse.', { cause: causa });
    this.name = 'RecargaBindNoObservada';
    this.codigo = causa?.codigo || 'bind_recarga_no_observada';
    this.recuperable = true;
  }
}

function exigirEfecto(lease, operacion, fotografia) {
  if (String(lease?.operacionId) !== String(operacion?.generacionDns) ||
      !operacion?.efectoPosible ||
      !['efecto_iniciado', 'recuperacion_pendiente'].includes(operacion?.estado) ||
      fotografia?.generacionLeida !== operacion.generacionLeida ||
      fotografia?.proyeccion?.perfilProyeccion !== operacion.perfilProyeccion ||
      fotografia?.proyeccion?.hashProyeccion?.toString('hex') !== operacion.hashProyeccion) {
    throw new Error('La recarga BIND exige la misma proyección congelada con efecto posible.');
  }
}

function leaseParaRepositorio(lease) {
  return {
    generacionDns: lease.operacionId,
    instanciaId: lease.instanciaId,
    leaseToken: lease.leaseToken,
    fencingToken: lease.fencingToken
  };
}

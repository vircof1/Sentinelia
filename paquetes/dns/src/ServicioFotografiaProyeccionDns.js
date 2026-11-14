import { PERFIL_PROYECCION_BIND_DNS_V1 } from './ProyeccionBindDeterministaDns.js';
import { GeneracionDnsNoFotografiable } from './RepositorioFotografiaCatalogoDns.js';

export class ServicioFotografiaProyeccionDns {
  constructor({ repositorioFotografia, repositorioCoordinacion, coordinador } = {}) {
    if (!repositorioFotografia?.materializar ||
        !repositorioCoordinacion?.verificarAutoridadConLease ||
        !repositorioCoordinacion?.crearSucesoraPorDivergencia ||
        !coordinador?.avanzar) {
      throw new Error('El servicio de fotografía DNS requiere sus tres puertos operativos.');
    }
    this.repositorioFotografia = repositorioFotografia;
    this.repositorioCoordinacion = repositorioCoordinacion;
    this.coordinador = coordinador;
  }

  async prepararEfecto({ lease, operacion } = {}) {
    exigirOperacionReclamada(lease, operacion);
    if (operacion.recargaConfirmadaEnUtc) {
      return Object.freeze({ consolidarSinRenderizar: true, operacion });
    }
    if (!await this.repositorioCoordinacion.verificarAutoridadConLease(
      leaseParaRepositorio(lease)
    )) {
      throw new Error('El lease DNS perdió autoridad antes de fotografiar el catálogo.');
    }

    let fotografia;
    try {
      fotografia = await this.repositorioFotografia.materializar({
        generacionDns: operacion.generacionDns
      });
    } catch (error) {
      if (operacion.efectoPosible && error instanceof GeneracionDnsNoFotografiable) {
        return this.#derivarSucesora(
          lease,
          operacion,
          'La cabecera DNS avanzó desde el efecto congelado.'
        );
      }
      throw error;
    }
    const datosCongelados = {
      generacionLeida: fotografia.generacionLeida,
      perfilProyeccion: fotografia.proyeccion.perfilProyeccion,
      hashProyeccion: fotografia.proyeccion.hashProyeccion,
      fotografiaZonas: fotografia.fotografiaZonas ?? null
    };

    if (!operacion.efectoPosible) {
      const avance = await this.coordinador.avanzar(lease, {
        transicion: 'efecto_iniciado',
        datos: datosCongelados
      });
      return Object.freeze({
        consolidarSinRenderizar: false,
        recuperacion: false,
        fotografia,
        operacion: avance.operacion
      });
    }

    if (coincideConEfectoCongelado(operacion, datosCongelados)) {
      if (!await this.repositorioCoordinacion.verificarAutoridadConLease(
        leaseParaRepositorio(lease)
      )) {
        throw new Error('El lease DNS perdió autoridad al recuperar la proyección.');
      }
      return Object.freeze({
        consolidarSinRenderizar: false,
        recuperacion: true,
        fotografia,
        operacion
      });
    }

    return this.#derivarSucesora(
      lease,
      operacion,
      'La fotografía recuperada no coincide con los campos congelados del efecto.'
    );
  }

  async #derivarSucesora(lease, operacion, mensaje) {
    const sucesora = await this.repositorioCoordinacion.crearSucesoraPorDivergencia(
      operacion.generacionDns,
      {
        codigo: 'dns_proyeccion_recuperada_divergente',
        mensaje
      },
      { lease: leaseParaRepositorio(lease) }
    );
    return Object.freeze({
      consolidarSinRenderizar: false,
      recuperacion: true,
      divergente: true,
      sucesora,
      fotografia: null,
      operacion
    });
  }
}

function exigirOperacionReclamada(lease, operacion) {
  if (!lease || !operacion || String(lease.operacionId) !== String(operacion.generacionDns)) {
    throw new Error('La operación DNS no corresponde al lease reclamado.');
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

function coincideConEfectoCongelado(operacion, datos) {
  return operacion.generacionLeida === datos.generacionLeida &&
    operacion.perfilProyeccion === PERFIL_PROYECCION_BIND_DNS_V1 &&
    operacion.perfilProyeccion === datos.perfilProyeccion &&
    operacion.hashProyeccion === Buffer.from(datos.hashProyeccion).toString('hex');
}

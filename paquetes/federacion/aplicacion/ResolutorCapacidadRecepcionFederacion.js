import {
  FAMILIAS_FEDERACION,
  VERSION_PROTOCOLO_FEDERACION,
  VERSIONES_FAMILIA_FEDERACION
} from '../src/CatalogosFederacion.js';
import {
  crearDeclaracionCapacidadReceptoraFederacion
} from '../src/ConfiguracionFederacion.js';

export class ResolutorCapacidadRecepcionFederacion {
  constructor({ servicioConfiguracionPortal } = {}) {
    if (typeof servicioConfiguracionPortal?.asegurarActualizada !== 'function' ||
        typeof servicioConfiguracionPortal?.obtenerVersionActual !== 'function') {
      throw new Error('La capacidad receptora requiere configuración de portal viva.');
    }
    this.servicioConfiguracionPortal = servicioConfiguracionPortal;
  }

  async resolver(configuracionPortal = null) {
    const portal = configuracionPortal ||
      await this.servicioConfiguracionPortal.asegurarActualizada();
    const configuracion = portal.obtenerConfiguracionFederacion();
    const versionConfiguracion = String(
      this.servicioConfiguracionPortal.obtenerVersionActual()
    );
    const declaracion = crearDeclaracionCapacidadReceptoraFederacion({
      configuracion,
      familiasSoportadas: FAMILIAS_FEDERACION.valores,
      versionesFamilia: VERSIONES_FAMILIA_FEDERACION,
      protocoloVersion: VERSION_PROTOCOLO_FEDERACION,
      disponible: true,
      prioridadOperativaActual: true
    });
    const aplicada = Object.freeze({
      versionConfiguracion,
      disponible: declaracion.disponible,
      familiasSoportadas: declaracion.familiasSoportadas,
      versionesFamilia: declaracion.versionesFamilia,
      maximoOcurrenciasPorLote: declaracion.maximoOcurrenciasPorLote,
      maximoBytesPorLote: declaracion.maximoBytesPorLote,
      maximoBytesPorOcurrencia: declaracion.maximoBytesPorOcurrencia,
      capacidadTemporalOcurrencias: declaracion.capacidadTemporalOcurrencias
    });
    return Object.freeze({ configuracion, declaracion, aplicada });
  }
}

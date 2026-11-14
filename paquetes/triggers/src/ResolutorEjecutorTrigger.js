import {
  ESTRATEGIAS_EJECUCION_TRIGGER,
  normalizarTipoTrigger,
  obtenerEstrategiaEjecucionTrigger
} from './CatalogoTiposTrigger.js';

export class ResolutorEjecutorTrigger {
  constructor({ ejecutores = [] } = {}) {
    this.ejecutoresPorTipo = new Map();

    for (const ejecutor of ejecutores) {
      this.registrar(ejecutor);
    }
  }

  registrar(ejecutor) {
    const tipo = normalizarTipoTrigger(String(
      ejecutor?.tipoTrigger || ejecutor?.tipo || ''
    ));
    const estrategiaEsperada = obtenerEstrategiaEjecucionTrigger(tipo);
    const estrategiaDeclarada = String(
      ejecutor?.estrategiaEjecucion || estrategiaEsperada
    ).trim().toLowerCase();
    if (estrategiaDeclarada !== estrategiaEsperada) {
      throw new Error(
        `El manejador del tipo "${tipo}" declara una estrategia incompatible.`
      );
    }
    const metodoEsperado = estrategiaEsperada ===
        ESTRATEGIAS_EJECUCION_TRIGGER.EFECTO_EXTERNO_DIFERIDO
      ? 'ejecutar'
      : 'aceptarEnTransaccion';
    if (typeof ejecutor?.[metodoEsperado] !== 'function') {
      throw new Error(
        `El manejador del tipo "${tipo}" debe exponer ${metodoEsperado}(...).`
      );
    }

    this.ejecutoresPorTipo.set(tipo, Object.freeze({
      tipoTrigger: tipo,
      estrategiaEjecucion: estrategiaEsperada,
      manejador: ejecutor
    }));
    return ejecutor;
  }

  resolverPorTipo(tipoTrigger) {
    const tipo = normalizarTipoTrigger(tipoTrigger);
    const ejecutor = this.ejecutoresPorTipo.get(tipo) || null;

    if (!ejecutor) {
      throw Object.assign(
        new Error(`No existe un manejador registrado para el tipo de trigger "${tipo}".`),
        { codigo: 'manejador_trigger_no_registrado', tipoTrigger: tipo }
      );
    }

    return ejecutor;
  }

  resolverParaTrigger(trigger) {
    return this.resolverPorTipo(trigger?.tipo);
  }

  listarTiposRegistrados() {
    return Array.from(this.ejecutoresPorTipo.keys()).sort();
  }

  resolverEstrategiaPorTipo(tipoTrigger) {
    return obtenerEstrategiaEjecucionTrigger(tipoTrigger);
  }

  resolverManejadorDiferidoPorTipo(tipoTrigger) {
    const descriptor = this.resolverPorTipo(tipoTrigger);
    if (descriptor.estrategiaEjecucion !==
        ESTRATEGIAS_EJECUCION_TRIGGER.EFECTO_EXTERNO_DIFERIDO) {
      throw Object.assign(
        new Error(`El tipo "${descriptor.tipoTrigger}" no admite ejecución diferida.`),
        { codigo: 'estrategia_trigger_diferida_incompatible' }
      );
    }
    return descriptor.manejador;
  }

  resolverManejadorAtomicoPorTipo(tipoTrigger) {
    const descriptor = this.resolverPorTipo(tipoTrigger);
    if (descriptor.estrategiaEjecucion !==
        ESTRATEGIAS_EJECUCION_TRIGGER.ACEPTACION_SQL_ATOMICA) {
      throw Object.assign(
        new Error(`El tipo "${descriptor.tipoTrigger}" no admite aceptación SQL atómica.`),
        { codigo: 'estrategia_trigger_atomica_incompatible' }
      );
    }
    return descriptor.manejador;
  }
}

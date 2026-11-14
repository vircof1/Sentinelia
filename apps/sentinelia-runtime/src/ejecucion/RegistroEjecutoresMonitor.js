import { obtenerDefinicionTipoMonitor } from '../../../../paquetes/monitores/src/CatalogoTiposMonitor.js';

export class RegistroEjecutoresMonitor {
  constructor({ ejecutores = [] } = {}) {
    this.ejecutoresPorTipo = new Map();

    for (const ejecutor of ejecutores) {
      this.registrar(ejecutor);
    }
  }

  registrar(ejecutor) {
    const tipo = this.normalizarTipoEjecutor(ejecutor);

    if (!tipo) {
      throw new Error('El ejecutor de monitor debe declarar un tipo válido.');
    }

    if (typeof ejecutor?.ejecutar !== 'function') {
      throw new Error(`El ejecutor del monitor ${tipo} debe exponer ejecutar().`);
    }

    this.ejecutoresPorTipo.set(tipo, ejecutor);
  }

  obtener(tipoMonitor) {
    return this.ejecutoresPorTipo.get(this.normalizarTipo(tipoMonitor)) || null;
  }

  tieneEjecutor(tipoMonitor) {
    return this.obtener(tipoMonitor) != null;
  }

  serializarTiposRegistrados() {
    return Array.from(this.ejecutoresPorTipo.keys()).sort();
  }

  construirResultadoTipoSinEjecutor(monitor, { programacion = null } = {}) {
    const tipo = this.normalizarTipo(monitor?.tipo);
    const definicion = obtenerDefinicionTipoMonitor(tipo);
    const mensaje = definicion?.capacidades?.ejecutaSondeoExterno === false
      ? `El tipo ${tipo} no declara ejecución directa por sondeo externo.`
      : `No existe ejecutor para el tipo ${tipo || 'desconocido'}.`;

    return {
      monitorId: monitor.id,
      nombre: monitor.nombre,
      tipo: monitor.tipo,
      versionCatalogo: monitor.version,
      scope: { ...monitor.scope },
      ejecutadoEnUtc: new Date().toISOString(),
      finalizadoEnUtc: new Date().toISOString(),
      duracionTotalMs: 0,
      programacion,
      protocolo: {
        nombre: tipo || monitor.tipo
      },
      intentosRealizados: 0,
      intentoExitoso: null,
      exito: false,
      estadoDetectado: 'indisponible',
      codigoResultado: 'tipo_no_soportado',
      mensajeResultado: mensaje,
      detalleError: {
        codigo: 'TIPO_NO_SOPORTADO',
        mensaje: `No existe ejecutor registrado para ${tipo || monitor.tipo}.`
      },
      metricaPrincipal: {},
      intentos: []
    };
  }

  normalizarTipoEjecutor(ejecutor) {
    return this.normalizarTipo(
      ejecutor?.tipoMonitor || ejecutor?.tipo || ejecutor?.protocolo?.nombre
    );
  }

  normalizarTipo(valor) {
    return String(valor || '').trim().toLowerCase();
  }
}

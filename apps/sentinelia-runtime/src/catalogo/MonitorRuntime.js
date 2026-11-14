import { existeTipoMonitor } from '../../../../paquetes/monitores/src/CatalogoTiposMonitor.js';
import {
  normalizarInterpretacionEstadoMonitorPorTipo
} from '../../../../paquetes/monitores/src/SemanticaEstadoMonitor.js';

function normalizarEntero(valor, porDefecto = 0) {
  const convertido = Number.parseInt(String(valor ?? ''), 10);
  return Number.isInteger(convertido) ? convertido : porDefecto;
}

function normalizarTexto(valor, porDefecto = '') {
  const normalizado = String(valor ?? '').trim();
  return normalizado || porDefecto;
}

function normalizarBooleano(valor) {
  if (typeof valor === 'boolean') {
    return valor;
  }

  return ['1', 'true', 'si', 'yes', 'on'].includes(
    String(valor ?? '').trim().toLowerCase()
  );
}

export class MonitorRuntime {
  constructor(definicion) {
    this.id = normalizarEntero(definicion?.id, 0);
    this.nombre = normalizarTexto(definicion?.nombre);
    this.tipo = normalizarTexto(definicion?.tipo).toLowerCase();
    this.interpretacionEstado = normalizarInterpretacionEstadoMonitorPorTipo({
      tipo: this.tipo,
      valor: definicion?.interpretacionEstado
    });
    this.descripcionFallo = normalizarTexto(definicion?.descripcionFallo, '');
    this.posibleSolucion = normalizarTexto(definicion?.posibleSolucion, '');
    this.activo = normalizarBooleano(definicion?.activo);
    this.inferenciasIndisponibleConsecutivas = normalizarEntero(
      definicion?.inferenciasIndisponibleConsecutivas, 1
    );
    this.inferenciasDisponibleConsecutivas = normalizarEntero(
      definicion?.inferenciasDisponibleConsecutivas, 1
    );
    this.entradaComposicionBooleana = normalizarBooleano(
      definicion?.entradaComposicionBooleana
    );
    this.version = normalizarTexto(definicion?.version);
    this.scope = this.normalizarScope(definicion?.scope);
    this.programacion = this.normalizarProgramacion(definicion?.programacion);
    this.configuracion = this.normalizarConfiguracion(definicion?.configuracion);
    this.validar();
  }

  normalizarScope(scope) {
    return {
      tenantId: normalizarEntero(scope?.tenantId, 0),
      empresaId: normalizarEntero(scope?.empresaId, 0),
      sitioId: scope?.sitioId == null || String(scope?.sitioId).trim() === ''
        ? null
        : normalizarEntero(scope?.sitioId, 0),
      nivelPertenencia: ['empresa', 'sitio'].includes(
        String(scope?.nivelPertenencia || '').trim().toLowerCase()
      )
        ? String(scope.nivelPertenencia).trim().toLowerCase()
        : 'empresa'
    };
  }

  normalizarProgramacion(programacion) {
    return {
      intervaloEjecucionSegundos: normalizarEntero(
        programacion?.intervaloEjecucionSegundos,
        60
      ),
      desfaseInicialSegundos: normalizarEntero(
        programacion?.desfaseInicialSegundos,
        0
      )
    };
  }

  normalizarConfiguracion(configuracion) {
    if (!configuracion || typeof configuracion !== 'object') {
      return {};
    }

    return { ...configuracion };
  }

  validar() {
    if (this.id <= 0) {
      throw new Error('La definición runtime de monitor requiere un id válido.');
    }

    if (!this.nombre) {
      throw new Error(`El monitor runtime ${this.id} no tiene nombre válido.`);
    }

    if (!existeTipoMonitor(this.tipo)) {
      throw new Error(
        `El monitor runtime ${this.id} tiene un tipo no soportado: ${this.tipo || '(vacío)'}.`
      );
    }

    if (this.scope.tenantId <= 0 || this.scope.empresaId <= 0) {
      throw new Error(
        `El monitor runtime ${this.id} requiere tenant y empresa materializados.`
      );
    }

    if (
      this.scope.nivelPertenencia === 'sitio' &&
      (this.scope.sitioId == null || this.scope.sitioId <= 0)
    ) {
      throw new Error(
        `El monitor runtime ${this.id} marca pertenencia de sitio sin sitio válido.`
      );
    }

    if (this.programacion.intervaloEjecucionSegundos <= 0) {
      throw new Error(
        `El monitor runtime ${this.id} requiere un intervalo de ejecución positivo.`
      );
    }

    if (this.programacion.desfaseInicialSegundos < 0) {
      throw new Error(
        `El monitor runtime ${this.id} requiere un desfase inicial no negativo.`
      );
    }
    if (
      this.inferenciasIndisponibleConsecutivas < 1 ||
      this.inferenciasIndisponibleConsecutivas > 1000 ||
      this.inferenciasDisponibleConsecutivas < 1 ||
      this.inferenciasDisponibleConsecutivas > 1000
    ) {
      throw new Error(`El monitor runtime ${this.id} requiere histéresis positiva.`);
    }
  }

  serializar() {
    return {
      id: this.id,
      nombre: this.nombre,
      tipo: this.tipo,
      interpretacionEstado: this.interpretacionEstado,
      descripcionFallo: this.descripcionFallo,
      posibleSolucion: this.posibleSolucion,
      activo: this.activo,
      inferenciasIndisponibleConsecutivas: this.inferenciasIndisponibleConsecutivas,
      inferenciasDisponibleConsecutivas: this.inferenciasDisponibleConsecutivas,
      entradaComposicionBooleana: this.entradaComposicionBooleana,
      version: this.version,
      scope: { ...this.scope },
      programacion: { ...this.programacion },
      configuracion: { ...this.configuracion }
    };
  }
}

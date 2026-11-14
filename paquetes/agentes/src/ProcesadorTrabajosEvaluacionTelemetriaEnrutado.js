import {
  TIPOS_CONDICION_DERIVACION_TELEMETRIA
} from './EventosDerivadosTelemetriaAgentes.js';
import {
  TIPO_CONDICION_MOMENTO_UTC_RELATIVO
} from './EvaluadorMomentoUtcRelativoTelemetria.js';

const CODIGO_ERROR_POR_DEFECTO = 'error_evaluacion_telemetria';
const TIPOS_REACTIVOS = new Set(
  Object.values(TIPOS_CONDICION_DERIVACION_TELEMETRIA)
);

export class ProcesadorTrabajosEvaluacionTelemetriaEnrutado {
  constructor({
    procesadorReactivo,
    procesadorRelativo,
    repositorioTrabajos,
    reintentoBaseSegundos = 5,
    reintentoMaximoSegundos = 300
  } = {}) {
    if (
      typeof procesadorReactivo?.procesar !== 'function' ||
      typeof procesadorRelativo?.procesar !== 'function' ||
      typeof repositorioTrabajos?.registrarErrorTecnico !== 'function'
    ) {
      throw new Error(
        'El enrutador de evaluaciones requiere ambos procesadores y la cola durable.'
      );
    }
    this.procesadorReactivo = procesadorReactivo;
    this.procesadorRelativo = procesadorRelativo;
    this.repositorioTrabajos = repositorioTrabajos;
    this.reintentoBaseSegundos = normalizarEnteroPositivo(
      reintentoBaseSegundos,
      5
    );
    this.reintentoMaximoSegundos = Math.max(
      this.reintentoBaseSegundos,
      normalizarEnteroPositivo(reintentoMaximoSegundos, 300)
    );
  }

  async procesar({ trabajo, reclamadoPor } = {}) {
    let recorrido = 'desconocido';
    try {
      recorrido = resolverRecorrido(trabajo?.condicionTipoRevision);
      if (recorrido === 'reactivo') {
        const resultado = await this.procesadorReactivo.procesar({
          trabajo,
          reclamadoPor
        });
        return { ...resultado, recorridoEvaluacion: recorrido };
      }
      const resultado = await this.procesadorRelativo.procesar({
        trabajo,
        reclamadoPor
      });
      return {
        ...resultado,
        recorridoEvaluacion: recorrido,
        resultado: resultado.resultado || resultado.evaluacion || null
      };
    } catch (error) {
      return this.#registrarFalloRelativo({
        trabajo,
        reclamadoPor,
        error,
        recorrido
      });
    }
  }

  async #registrarFalloRelativo({ trabajo, reclamadoPor, error, recorrido }) {
    const demoraReintentoSegundos = this.#calcularDemoraReintentoSegundos(
      trabajo?.intentos
    );
    let registro = null;
    let errorRegistro = null;
    try {
      registro = await this.repositorioTrabajos.registrarErrorTecnico({
        trabajoId: trabajo?.id,
        reclamadoPor,
        codigoError: normalizarCodigoError(error),
        mensajeError: String(error?.message || 'Error técnico desconocido.'),
        demoraReintentoSegundos
      });
    } catch (errorPersistencia) {
      errorRegistro = errorPersistencia;
    }
    const registrado = Boolean(registro?.registrado ?? registro);
    return {
      ok: false,
      recorridoEvaluacion: recorrido,
      trabajoId: trabajo?.id || null,
      intentos: Number(trabajo?.intentos || 0),
      error: {
        codigo: normalizarCodigoError(error),
        mensaje: String(error?.message || 'Error técnico desconocido.')
      },
      errorRegistrado: registrado,
      siguienteIntentoUtc: registro?.siguienteIntentoUtc || null,
      demoraReintentoSegundos: registrado ? demoraReintentoSegundos : null,
      errorRegistro: errorRegistro
        ? String(errorRegistro?.message || 'No se pudo registrar el error técnico.')
        : null
    };
  }

  #calcularDemoraReintentoSegundos(intentos) {
    const exponente = Math.max(0, Math.min(20, Number(intentos || 1) - 1));
    return Math.min(
      this.reintentoMaximoSegundos,
      this.reintentoBaseSegundos * (2 ** exponente)
    );
  }
}

function resolverRecorrido(tipoCondicion) {
  if (tipoCondicion === TIPO_CONDICION_MOMENTO_UTC_RELATIVO) return 'relativo';
  if (TIPOS_REACTIVOS.has(tipoCondicion)) return 'reactivo';
  throw new Error('El trabajo reclamado refiere un tipo de condición desconocido.');
}

function normalizarCodigoError(error) {
  const codigo = String(error?.code || CODIGO_ERROR_POR_DEFECTO).trim();
  return (codigo || CODIGO_ERROR_POR_DEFECTO).slice(0, 80);
}

function normalizarEnteroPositivo(valor, porDefecto) {
  const numero = Number(valor);
  return Number.isInteger(numero) && numero > 0 ? numero : porDefecto;
}

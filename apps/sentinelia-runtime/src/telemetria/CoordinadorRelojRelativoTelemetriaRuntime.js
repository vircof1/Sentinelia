import {
  CAUSAS_TRABAJO_EVALUACION_TELEMETRIA
} from '../../../../paquetes/agentes/src/RepositorioTrabajosEvaluacionTelemetria.js';
import {
  generarIdAvisoPlataforma
} from '../../../../paquetes/avisos-plataforma/src/IdentidadAvisoPlataforma.js';

export class CoordinadorRelojRelativoTelemetriaRuntime {
  constructor({
    repositorioCorrecciones,
    repositorioTrabajos,
    servicioAvisos = null,
    instanciaId,
    limiteLote = 100,
    maximoLotesPorCiclo = 4,
    umbralAvisoRetrasoSegundos = 60,
    generarEventoId = generarIdAvisoPlataforma
  } = {}) {
    exigirMetodo(repositorioCorrecciones, 'observarReloj', 'repositorioCorrecciones');
    exigirMetodo(repositorioCorrecciones, 'procesarSiguienteLote', 'repositorioCorrecciones');
    exigirMetodo(repositorioCorrecciones, 'obtenerDiagnostico', 'repositorioCorrecciones');
    exigirMetodo(repositorioTrabajos, 'encolarAutoridadActualEnTransaccion',
      'repositorioTrabajos');
    if (servicioAvisos !== null) {
      exigirMetodo(servicioAvisos, 'detectar', 'servicioAvisos');
      exigirMetodo(servicioAvisos, 'resolver', 'servicioAvisos');
    }
    this.repositorioCorrecciones = repositorioCorrecciones;
    this.repositorioTrabajos = repositorioTrabajos;
    this.servicioAvisos = servicioAvisos;
    this.instanciaId = String(instanciaId || 'runtime-desconocido');
    this.limiteLote = enteroAcotado(limiteLote, 1, 1000, 100);
    this.maximoLotesPorCiclo = enteroAcotado(maximoLotesPorCiclo, 1, 100, 4);
    this.umbralAvisoRetrasoSegundos = enteroAcotado(
      umbralAvisoRetrasoSegundos, 1, 604800, 60
    );
    this.generarEventoId = generarEventoId;
    this.ejecucionEnCurso = null;
  }

  procesarAntesDeReclamar({ origen = 'tick', numeroTick = null } = {}) {
    if (this.ejecucionEnCurso) return this.ejecucionEnCurso;
    this.ejecucionEnCurso = this.#procesar({ origen, numeroTick })
      .finally(() => { this.ejecucionEnCurso = null; });
    return this.ejecucionEnCurso;
  }

  async #procesar({ origen, numeroTick }) {
    const observacionReloj = await this.repositorioCorrecciones.observarReloj();
    const lotes = [];
    let trabajosCreados = 0;
    let trabajosExistentes = 0;
    for (let indice = 0; indice < this.maximoLotesPorCiclo; indice += 1) {
      const lote = await this.repositorioCorrecciones.procesarSiguienteLote({
        limite: this.limiteLote,
        aplicarReglaEnTransaccion: async ({
          reconciliacion, regla, revision, fotografia
        }, { conexion }) => {
          if (!fotografia) return;
          const resultado = await this.repositorioTrabajos
            .encolarAutoridadActualEnTransaccion({
              observacion: fotografia,
              regla,
              revision,
              causa: CAUSAS_TRABAJO_EVALUACION_TELEMETRIA.RECONCILIACION_RELOJ,
              generacionAutoridad: regla.generacionAutoridad,
              generacionCorreccion: reconciliacion.generacionCorreccion
            }, { conexion });
          if (resultado.creado) trabajosCreados += 1;
          else trabajosExistentes += 1;
        }
      });
      if (!lote) break;
      lotes.push(lote);
      if (lote.completada) continue;
    }
    const diagnostico = await this.repositorioCorrecciones.obtenerDiagnostico();
    const aviso = await this.#sincronizarAviso(diagnostico);
    return Object.freeze({
      origen,
      numeroTick,
      observacionReloj,
      lotes: Object.freeze(lotes),
      totalLotes: lotes.length,
      trabajosCreados,
      trabajosExistentes,
      diagnostico,
      aviso
    });
  }

  async #sincronizarAviso(diagnostico) {
    if (!this.servicioAvisos) return null;
    const retrasada = diagnostico.fronterasNoEvaluadas > 0 &&
      diagnostico.retrasoMaximoSegundos >= this.umbralAvisoRetrasoSegundos;
    const eventoId = this.generarEventoId();
    const correlacionId = this.generarEventoId();
    const base = {
      eventoId,
      correlacionId,
      efectivoEnUtc: diagnostico.observadoEnUtc,
      actor: { tipo: 'runtime', id: this.instanciaId },
      causalidad: { tipo: 'checkpointRelojRelativo', id: '1' },
      claveCausal: {
        versionCatalogo: 1,
        tipoCodigo: 'capacidad',
        causaCodigo: 'saturacion_prolongada',
        objetoTipo: 'cola_evaluacion_telemetria',
        objetoId: 'momento_utc_relativo',
        relacionId: null,
        flujoId: null,
        scope: { tenantId: null, empresaId: null, sitioId: null }
      }
    };
    if (retrasada) {
      return this.servicioAvisos.detectar({
        ...base,
        contextoHumano: {
          fronterasNoEvaluadas: diagnostico.fronterasNoEvaluadas,
          trabajosVencidos: diagnostico.trabajosRelativosVencidos,
          retrasoMaximoSegundos: diagnostico.retrasoMaximoSegundos
        },
        resumen: {
          mensaje: 'La reevaluación temporal relativa acumula fronteras vencidas.',
          umbralSegundos: this.umbralAvisoRetrasoSegundos
        }
      });
    }
    return this.servicioAvisos.resolver({
      ...base,
      viaResolucion: 'causa_desaparecida'
    });
  }
}

function exigirMetodo(objeto, metodo, nombre) {
  if (typeof objeto?.[metodo] !== 'function') {
    throw new Error(`${nombre} debe implementar ${metodo}().`);
  }
}

function enteroAcotado(valor, minimo, maximo, predeterminado) {
  const numero = Number(valor ?? predeterminado);
  return Number.isInteger(numero) && numero >= minimo && numero <= maximo
    ? numero
    : predeterminado;
}

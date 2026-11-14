import { normalizarMarcaUtc } from '../../../../paquetes/utilidades/src/fechas/normalizarMarcaUtc.js';
import { enlazarRepositorioAConexion } from '../persistencia/RepositorioEnTransaccion.js';

function clonarObjetoPlano(valor) {
  if (!valor || typeof valor !== 'object') {
    return null;
  }

  return JSON.parse(JSON.stringify(valor));
}

export class AplicadorResultadosEstadoActual {
  constructor({ repositorioEstadoActualMonitores, capturadorFederacionMonitores = null }) {
    this.repositorioEstadoActualMonitores = repositorioEstadoActualMonitores;
    this.capturadorFederacionMonitores = capturadorFederacionMonitores;
  }

  async aplicar({ almacenEstadoActual, resultados = [] }, { conexion = null } = {}) {
    const resumen = {
      totalResultados: Array.isArray(resultados) ? resultados.length : 0,
      totalPersistidos: 0,
      totalCambiosEstado: 0,
      totalSinCambioEstado: 0,
      monitoresActualizados: [],
      resultadosEstabilizados: []
    };

    if (!Array.isArray(resultados) || resultados.length === 0) {
      return resumen;
    }

    const estadosActualizados = [];

    for (const resultado of resultados) {
      const estadoActual = almacenEstadoActual.buscarPorMonitorId(resultado.monitorId);

      if (!estadoActual) {
        continue;
      }

      const estadoPrevio = estadoActual.serializar();
      const estadoInferido = this.resolverEstadoDesdeResultado(resultado);
      const histeresis = this.resolverHisteresis({
        estadoPrevio,
        estadoInferido,
        estadoActual,
        resultado
      });
      const estadoNuevo = histeresis.estado;
      const fechaEjecucionUtc = normalizarMarcaUtc(
        resultado.finalizadoEnUtc || resultado.ejecutadoEnUtc || new Date()
      );
      const cambioEstado = estadoPrevio.estado !== estadoNuevo;

      estadoActual.actualizar({
        estado: estadoNuevo,
        ejecutadoTodavia: true,
        pendienteScheduler: false,
        fechaUltimaEjecucionUtc: fechaEjecucionUtc,
        fechaUltimoCambioUtc: cambioEstado
          ? fechaEjecucionUtc
          : (estadoPrevio.fechaUltimoCambioUtc || null),
        resultadoActual: {
          ...this.construirResultadoPersistible(resultado),
          histeresis: histeresis.contador
        }
      });

      estadosActualizados.push(estadoActual);
      resumen.resultadosEstabilizados.push({
        ...resultado,
        estadoDetectado: estadoNuevo,
        estadoInferido,
        exito: estadoNuevo === 'disponible',
        histeresisPendiente: histeresis.pendiente,
        efectosDerivadosHabilitados:
          resultado.efectosDerivadosHabilitados !== false &&
          !histeresis.pendiente && estadoNuevo !== 'desconocido'
      });
      resumen.monitoresActualizados.push({
        monitorId: estadoActual.monitorId,
        estadoAnterior: estadoPrevio.estado,
        estadoNuevo,
        cambioEstado,
        cambioSalidaEstable: cambioEstado &&
          resultado.efectosDerivadosHabilitados !== false,
        efectosDerivadosHabilitados:
          resultado.efectosDerivadosHabilitados !== false,
        fechaUltimaEjecucionUtc: fechaEjecucionUtc,
        fechaUltimoCambioUtc: estadoActual.fechaUltimoCambioUtc
      });

      if (cambioEstado) {
        resumen.totalCambiosEstado += 1;
      } else {
        resumen.totalSinCambioEstado += 1;
      }
    }

    const repositorio = enlazarRepositorioAConexion(
      this.repositorioEstadoActualMonitores,
      conexion
    );
    resumen.totalPersistidos =
      await repositorio.guardarEstadosActuales(
        estadosActualizados
      );

    if (conexion && this.capturadorFederacionMonitores && resumen.totalPersistidos > 0) {
      resumen.capturasFederadas = await this.capturadorFederacionMonitores
        .capturarRuntimeEnTransaccion({
          estadoMonitorIds: resumen.monitoresActualizados.map(({ monitorId }) => monitorId)
        }, { conexion });
    }

    return resumen;
  }

  resolverEstadoDesdeResultado(resultado) {
    if (resultado?.estadoDetectado) {
      return String(resultado.estadoDetectado).trim().toLowerCase();
    }

    return resultado?.exito ? 'disponible' : 'indisponible';
  }

  resolverHisteresis({ estadoPrevio, estadoInferido, estadoActual, resultado }) {
    const estado = estadoPrevio.estado || 'desconocido';
    const anterior = estadoPrevio.resultadoActual?.histeresis || {};
    const vacio = { estadoInferido: null, inferenciasConsecutivas: 0 };
    if (resultado.efectosDerivadosHabilitados === false) {
      return { estado, contador: anterior, pendiente: true };
    }
    if (!['disponible', 'indisponible'].includes(estadoInferido)) {
      return { estado, contador: vacio, pendiente: true };
    }
    if (estadoInferido === estado) {
      return { estado, contador: vacio, pendiente: false };
    }
    const necesarias = estadoInferido === 'disponible'
      ? estadoActual.inferenciasDisponibleConsecutivas
      : estadoActual.inferenciasIndisponibleConsecutivas;
    const consecutivas = anterior.estadoInferido === estadoInferido
      ? Number(anterior.inferenciasConsecutivas || 0) + 1
      : 1;
    if (consecutivas >= necesarias) {
      return { estado: estadoInferido, contador: vacio, pendiente: false };
    }
    return {
      estado,
      contador: { estadoInferido, inferenciasConsecutivas: consecutivas },
      pendiente: true
    };
  }

  construirResultadoPersistible(resultado) {
    return {
      monitorId: resultado.monitorId,
      tipo: resultado.tipo,
      ejecutadoEnUtc: normalizarMarcaUtc(resultado.ejecutadoEnUtc),
      finalizadoEnUtc: normalizarMarcaUtc(resultado.finalizadoEnUtc),
      duracionTotalMs: Number(resultado.duracionTotalMs || 0),
      exito: Boolean(resultado.exito),
      exitoTecnico:
        resultado.exitoTecnico == null
          ? Boolean(resultado.exito)
          : Boolean(resultado.exitoTecnico),
      interpretacionEstado: String(resultado.interpretacionEstado || 'normal'),
      resultadoInterpretado: Boolean(resultado.resultadoInterpretado),
      estadoDetectado: this.resolverEstadoDesdeResultado(resultado),
      estadoTecnicoDetectado: String(
        resultado.estadoTecnicoDetectado ||
          this.resolverEstadoDesdeResultado(resultado)
      ),
      codigoResultado: String(resultado.codigoResultado || 'sin_resultado'),
      codigoResultadoTecnico: String(
        resultado.codigoResultadoTecnico ||
          resultado.codigoResultado ||
          'sin_resultado'
      ),
      mensajeResultado: String(
        resultado.mensajeResultado || 'Sin mensaje de resultado.'
      ),
      mensajeResultadoTecnico: String(
        resultado.mensajeResultadoTecnico ||
          resultado.mensajeResultado ||
          'Sin mensaje de resultado.'
      ),
      interpretacionResultado: clonarObjetoPlano(
        resultado.interpretacionResultado
      ),
      detalleError: clonarObjetoPlano(resultado.detalleError),
      detalleErrorTecnico: clonarObjetoPlano(resultado.detalleErrorTecnico),
      metricaPrincipal: clonarObjetoPlano(resultado.metricaPrincipal),
      protocolo: clonarObjetoPlano(resultado.protocolo),
      programacion: clonarObjetoPlano(resultado.programacion),
      intentosRealizados: Number(resultado.intentosRealizados || 0),
      causalidadFederada: clonarObjetoPlano(resultado.causalidadFederada),
      intentoExitoso:
        resultado.intentoExitoso == null
          ? null
          : Number(resultado.intentoExitoso),
      intentos: clonarObjetoPlano(resultado.intentos) || []
    };
  }
}

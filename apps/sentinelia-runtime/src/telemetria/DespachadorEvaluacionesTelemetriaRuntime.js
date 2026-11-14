import { randomUUID } from 'node:crypto';

export class DespachadorEvaluacionesTelemetriaRuntime {
  constructor({
    repositorioTrabajos,
    procesadorTrabajos,
    publicadorInvalidacionesMonitores = null,
    instanciaId,
    loteMaximo = 25,
    reclamoTtlSegundos = 30,
    prepararAntesDeReclamar = null,
    reloj = () => new Date(),
    generarIdReclamacion = () => randomUUID()
  } = {}) {
    if (!repositorioTrabajos || !procesadorTrabajos) {
      throw new Error(
        'El despachador de evaluaciones requiere repositorio y procesador.'
      );
    }

    this.repositorioTrabajos = repositorioTrabajos;
    this.procesadorTrabajos = procesadorTrabajos;
    this.publicadorInvalidacionesMonitores = publicadorInvalidacionesMonitores;
    this.instanciaId = String(instanciaId || 'runtime-desconocido');
    this.loteMaximo = normalizarEntero(loteMaximo, 1, 250, 25);
    this.reclamoTtlSegundos = normalizarEntero(
      reclamoTtlSegundos,
      5,
      3600,
      30
    );
    if (prepararAntesDeReclamar !== null &&
        typeof prepararAntesDeReclamar !== 'function') {
      throw new Error('La preparación previa a reclamar debe ser una función.');
    }
    this.prepararAntesDeReclamar = prepararAntesDeReclamar;
    this.reloj = reloj;
    this.generarIdReclamacion = generarIdReclamacion;
    this.ejecucionEnCurso = null;
  }

  // auditoria-productor: runtime.telemetria.derivada
  async procesarPendientes({ origen = 'tick', numeroTick = null } = {}) {
    if (this.ejecucionEnCurso) {
      return this.ejecucionEnCurso;
    }

    this.ejecucionEnCurso = this.procesarPendientesInterno({
      origen,
      numeroTick
    }).finally(() => {
      this.ejecucionEnCurso = null;
    });
    return this.ejecucionEnCurso;
  }

  async procesarPendientesInterno({ origen, numeroTick }) {
    const iniciadoEnUtc = this.reloj().toISOString();
    const reclamadoPor = this.construirIdReclamacion({ origen, numeroTick });
    let trabajos = [];
    const procesados = [];
    const estadosReglasActualizados = [];
    let preparacion = null;

    try {
      preparacion = this.prepararAntesDeReclamar
        ? await this.prepararAntesDeReclamar({ origen, numeroTick })
        : null;
      trabajos = await this.repositorioTrabajos.reclamarSiguientes({
        reclamadoPor,
        limite: this.loteMaximo,
        ttlSegundos: this.reclamoTtlSegundos
      });

      for (const trabajo of trabajos) {
        const resultado =
          await this.procesadorTrabajos.procesar({ trabajo, reclamadoPor });
        if (cambioEstadoActualConfirmado(resultado?.persistencia)) {
          estadosReglasActualizados.push(resultado.persistencia.estadoActual);
        }
        procesados.push(compactarResultadoProcesamiento(resultado));
      }
    } catch (error) {
      return {
        iniciadoEnUtc,
        finalizadoEnUtc: this.reloj().toISOString(),
        origen,
        numeroTick,
        reclamadoPor,
        loteMaximo: this.loteMaximo,
        totalReclamados: trabajos.length,
        totalCompletados: procesados.filter((resultado) => resultado.ok).length,
        totalErrores:
          procesados.filter((resultado) => !resultado.ok).length + 1,
        procesados,
        preparacion,
        error: {
          mensaje: String(error?.message || 'Error procesando evaluaciones.')
        }
      };
    }

    const invalidacionMonitores =
      await this.publicarInvalidacionesSinAfectarTrabajos(
        estadosReglasActualizados
      );
    return {
      iniciadoEnUtc,
      finalizadoEnUtc: this.reloj().toISOString(),
      origen,
      numeroTick,
      reclamadoPor,
      loteMaximo: this.loteMaximo,
      totalReclamados: trabajos.length,
      totalCompletados: procesados.filter((resultado) => resultado.ok).length,
      totalErrores: procesados.filter((resultado) => !resultado.ok).length,
      procesados,
      preparacion,
      invalidacionMonitores
    };
  }

  async publicarInvalidacionesSinAfectarTrabajos(estados) {
    if (
      estados.length === 0 ||
      !this.publicadorInvalidacionesMonitores?.publicarEstadosReglasActualizados
    ) {
      return {
        publicado: false,
        totalReglas: estados.length,
        motivo: estados.length === 0
          ? 'sin_estados_actualizados'
          : 'publicador_no_configurado'
      };
    }
    try {
      return await this.publicadorInvalidacionesMonitores
        .publicarEstadosReglasActualizados({ estados });
    } catch (error) {
      return {
        publicado: false,
        totalReglas: estados.length,
        motivo: 'error_publicacion_redis',
        error: String(error?.message || 'No se pudo publicar la invalidación.')
      };
    }
  }

  construirIdReclamacion({ origen, numeroTick }) {
    return [
      this.instanciaId,
      String(origen || 'tick'),
      String(numeroTick ?? '0'),
      this.generarIdReclamacion()
    ].join(':').slice(0, 160);
  }
}

function cambioEstadoActualConfirmado(proyeccion) {
  if (!proyeccion) {
    return false;
  }
  if (typeof proyeccion.cambioEstadoActual === 'function') {
    return proyeccion.cambioEstadoActual();
  }
  if (typeof proyeccion.cambioEstadoMonitor === 'boolean') {
    return proyeccion.cambioEstadoMonitor &&
      proyeccion.estadoActualizado === true &&
      proyeccion.gobiernaEstadoActual === true;
  }
  return proyeccion.estadoActualizado === true &&
    proyeccion.gobiernaEstadoActual === true;
}

function compactarResultadoProcesamiento(resultado) {
  if (resultado.ok) {
    return {
      ok: true,
      terminal: resultado.terminal === true,
      descartada: resultado.descartada === true,
      trabajoId: resultado.trabajoId,
      intentos: resultado.intentos,
      resultado: resultado.resultado?.resultado || null,
      codigoMotivo:
        resultado.codigoMotivo || resultado.resultado?.codigoMotivo || null
    };
  }

  return {
    ok: false,
    trabajoId: resultado.trabajoId,
    intentos: resultado.intentos,
    error: resultado.error,
    errorRegistrado: resultado.errorRegistrado,
    siguienteIntentoUtc: resultado.siguienteIntentoUtc,
    demoraReintentoSegundos: resultado.demoraReintentoSegundos,
    errorRegistro: resultado.errorRegistro
  };
}

function normalizarEntero(valor, minimo, maximo, porDefecto) {
  const numero = Number(valor);
  return Number.isInteger(numero) && numero >= minimo && numero <= maximo
    ? numero
    : porDefecto;
}

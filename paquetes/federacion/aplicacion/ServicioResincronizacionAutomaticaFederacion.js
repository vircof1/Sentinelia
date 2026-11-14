import {
  TIPOS_IDENTIDAD_FEDERADA
} from '../src/IdentidadFederada.js';

export class ErrorResincronizacionAutomaticaFederacion extends Error {
  constructor(codigo, mensaje) {
    super(mensaje);
    this.name = 'ErrorResincronizacionAutomaticaFederacion';
    this.codigo = codigo;
  }
}

export class ServicioResincronizacionAutomaticaFederacion {
  constructor({
    repositorioFlujos,
    repositorioCandidatas,
    servicioCorteInicial,
    generadorIdentidades
  } = {}) {
    if (typeof repositorioFlujos?.obtener !== 'function' ||
        typeof repositorioCandidatas?.resolver !== 'function' ||
        typeof repositorioCandidatas?.obtenerResincronizacionAutomaticaActiva !== 'function' ||
        typeof repositorioCandidatas?.registrarReintentoResincronizacionAutomatica !== 'function' ||
        typeof repositorioCandidatas?.resumirEntregaResincronizacionAutomatica !== 'function' ||
        typeof repositorioCandidatas?.avanzar !== 'function' ||
        typeof repositorioCandidatas?.promover !== 'function' ||
        typeof repositorioCandidatas?.cancelar !== 'function' ||
        typeof servicioCorteInicial?.cerrar !== 'function' ||
        typeof generadorIdentidades?.generar !== 'function') {
      throw new Error(
        'La resincronización automática requiere flujo, candidata, corte e identidades.'
      );
    }
    this.repositorioFlujos = repositorioFlujos;
    this.repositorioCandidatas = repositorioCandidatas;
    this.servicioCorteInicial = servicioCorteInicial;
    this.generadorIdentidades = generadorIdentidades;
  }

  async solicitar({ flujoId, causa, detalle = null } = {}) {
    const existente = await this.repositorioCandidatas
      .obtenerResincronizacionAutomaticaActiva(flujoId);
    if (existente) {
      const conservada = await this.repositorioCandidatas
        .registrarReintentoResincronizacionAutomatica(flujoId);
      if (conservada) {
        return Object.freeze({
          resultado: 'yaEnCurso',
          operacion: await this.repositorioCandidatas
            .obtenerResincronizacionAutomaticaActiva(flujoId)
        });
      }
    }
    const flujo = await this.repositorioFlujos.obtener(flujoId);
    if (!flujo) {
      fallar('flujo_inexistente', 'No existe el flujo que debe resincronizarse.');
    }
    if (flujo.direccion !== 'emision') {
      fallar(
        'direccion_resincronizacion_invalida',
        'La instalación emisora es quien crea la nueva generación automática.'
      );
    }
    const generacionId = String(
      this.generadorIdentidades.generar(TIPOS_IDENTIDAD_FEDERADA.GENERACION)
    );
    try {
      await this.repositorioCandidatas.resolver({
        flujoId: flujo.flujoId,
        generacion: {
          generacionId,
          clase: 'resincronizacion',
          fronteraInicial: '0',
          propietario: flujo.generacion.propietario
        },
        propietario: flujo.generacion.propietario,
        estrategia: 'coexistir',
        resincronizacionAutomatica: { causa, detalle }
      });
    } catch (error) {
      if (!esColisionOperacionActiva(error)) throw error;
      const conservada = await this.repositorioCandidatas
        .registrarReintentoResincronizacionAutomatica(flujoId);
      if (!conservada) {
        fallar(
          'resincronizacion_automatica_concurrente',
          'La operación concurrente terminó antes de poder consolidar la solicitud.'
        );
      }
      return Object.freeze({
        resultado: 'yaEnCurso',
        operacion: await this.repositorioCandidatas
          .obtenerResincronizacionAutomaticaActiva(flujoId)
      });
    }
    return Object.freeze({
      resultado: 'solicitada',
      operacion: await this.repositorioCandidatas
        .obtenerResincronizacionAutomaticaActiva(flujoId)
    });
  }

  async ejecutarPaso(flujoId) {
    let operacion = await this.repositorioCandidatas
      .obtenerResincronizacionAutomaticaActiva(flujoId);
    if (!operacion) return Object.freeze({ resultado: 'sinTrabajo', operacion: null });

    if (operacion.estado === 'preparada') {
      await this.servicioCorteInicial.cerrar({
        flujoId: operacion.flujoId,
        generacionId: operacion.generacionId
      });
      operacion = await this.repositorioCandidatas
        .obtenerResincronizacionAutomaticaActiva(flujoId);
      operacion = await this.#avanzar(operacion, 'transfiriendo', {
        posicionOperativa: null,
        posicionHistorica: null,
        sincronizando: true,
        operativamenteCompleta: false,
        historicamenteCompleta: false,
        parcialPorScope: false,
        degradada: false
      });
      return Object.freeze({ resultado: 'fotografiaPreparada', operacion });
    }

    if (operacion.estado === 'transfiriendo') {
      const resumen = await this.repositorioCandidatas
        .resumirEntregaResincronizacionAutomatica(flujoId);
      if (resumen?.operativasBloqueadas > 0) {
        await this.repositorioCandidatas.cancelar({
          flujoId: operacion.flujoId,
          generacionId: operacion.generacionId,
          propietario: operacion.candidata.propietario,
          resultadoAutomatico: 'fallida'
        });
        return Object.freeze({
          resultado: 'fallidaPorBloqueoOperativo',
          operacion: null,
          resumen
        });
      }
      if (!resumen?.operativaCompleta) {
        return Object.freeze({ resultado: 'esperandoEntregas', operacion, resumen });
      }
      const completa = resumen.historicaCompleta;
      operacion = await this.#avanzar(
        operacion,
        completa ? 'completa' : 'fronteraOperativaValidada',
        {
          posicionOperativa: resumen.fronteraInicial,
          posicionHistorica: completa ? resumen.fronteraInicial : null,
          sincronizando: !completa,
          operativamenteCompleta: true,
          historicamenteCompleta: completa,
          parcialPorScope: false,
          degradada: resumen.bloqueadas > 0
        }
      );
      return Object.freeze({ resultado: 'fronteraOperativaValidada', operacion, resumen });
    }

    if (['fronteraOperativaValidada', 'completa'].includes(operacion.estado)) {
      const promocion = await this.repositorioCandidatas.promover({
        flujoId: operacion.flujoId,
        generacionId: operacion.generacionId,
        propietario: operacion.candidata.propietario
      });
      return Object.freeze({ resultado: 'promovida', promocion, operacion: null });
    }

    return Object.freeze({ resultado: 'esperandoEntregas', operacion });
  }

  async fallar({ flujoId, motivo = null } = {}) {
    const operacion = await this.repositorioCandidatas
      .obtenerResincronizacionAutomaticaActiva(flujoId);
    if (!operacion) return Object.freeze({ resultado: 'sinTrabajo' });
    await this.repositorioCandidatas.cancelar({
      flujoId: operacion.flujoId,
      generacionId: operacion.generacionId,
      propietario: operacion.candidata.propietario,
      resultadoAutomatico: 'fallida'
    });
    return Object.freeze({ resultado: 'fallida', motivo });
  }

  async #avanzar(operacion, estadoGeneracion, frontera) {
    await this.repositorioCandidatas.avanzar({
      flujoId: operacion.flujoId,
      generacionId: operacion.generacionId,
      propietario: operacion.candidata.propietario,
      versionEstadoEsperada: operacion.candidata.versionEstado,
      versionFronteraEsperada: operacion.candidata.frontera.version,
      estadoGeneracion,
      frontera: {
        posicionInicial: operacion.candidata.frontera.posicionInicial,
        ...frontera
      }
    });
    return this.repositorioCandidatas
      .obtenerResincronizacionAutomaticaActiva(operacion.flujoId);
  }
}

function esColisionOperacionActiva(error) {
  return error?.code === 'ER_DUP_ENTRY' &&
    String(error?.message || '').includes('uk_resincronizacion_automatica_activa');
}

function fallar(codigo, mensaje) {
  throw new ErrorResincronizacionAutomaticaFederacion(codigo, mensaje);
}

import { generarUuidV7Auditoria } from '../../auditoria/src/UuidV7Auditoria.js';
import { TIPOS_IDENTIDAD_FEDERADA } from '../src/IdentidadFederada.js';

const ESTRATEGIAS = new Set([
  'esperar',
  'ampliarCompatible',
  'sustituir',
  'coexistir'
]);

export class ErrorReconstruccionManualFederacion extends Error {
  constructor(codigo, mensaje) {
    super(mensaje);
    this.name = 'ErrorReconstruccionManualFederacion';
    this.codigo = codigo;
  }
}

export class ServicioReconstruccionesManualesFederacion {
  constructor({
    repositorioFlujos,
    repositorioCandidatas,
    servicioCorteInicial,
    generadorIdentidades,
    generarEventoId = generarUuidV7Auditoria
  } = {}) {
    if (typeof repositorioFlujos?.obtener !== 'function' ||
        typeof repositorioCandidatas?.resolver !== 'function' ||
        typeof repositorioCandidatas?.listar !== 'function' ||
        typeof repositorioCandidatas?.avanzar !== 'function' ||
        typeof repositorioCandidatas?.cancelar !== 'function' ||
        typeof repositorioCandidatas?.promover !== 'function' ||
        typeof repositorioCandidatas?.revalidar !== 'function' ||
        typeof servicioCorteInicial?.cerrar !== 'function' ||
        typeof generadorIdentidades?.generar !== 'function' ||
        typeof generarEventoId !== 'function') {
      throw new Error(
        'Las reconstrucciones manuales requieren flujo, candidatas, corte e identidades.'
      );
    }
    this.repositorioFlujos = repositorioFlujos;
    this.repositorioCandidatas = repositorioCandidatas;
    this.servicioCorteInicial = servicioCorteInicial;
    this.generadorIdentidades = generadorIdentidades;
    this.generarEventoId = generarEventoId;
  }

  async listar(flujoId) {
    const flujo = await this.#flujo(flujoId);
    return Object.freeze({
      flujo,
      candidatas: await this.repositorioCandidatas.listar(flujo.flujoId)
    });
  }

  async decidir({
    flujoId,
    estrategia,
    generacionObjetivoId = null,
    contextoUsuarioActual,
    motivo = null
  } = {}) {
    const estrategiaNormalizada = exigirEstrategia(estrategia);
    const flujo = await this.#flujo(flujoId);
    const decisionManual = this.#decision(contextoUsuarioActual, motivo);
    const crea = ['coexistir', 'sustituir'].includes(estrategiaNormalizada);
    if (crea && flujo.direccion !== 'emision') {
      fallar(
        'direccion_reconstruccion_invalida',
        'Solo la instalación emisora puede materializar una generación nueva.'
      );
    }
    const generacionId = crea
      ? String(this.generadorIdentidades.generar(TIPOS_IDENTIDAD_FEDERADA.GENERACION))
      : null;
    const resultado = await this.repositorioCandidatas.resolver({
      flujoId: flujo.flujoId,
      generacion: crea ? {
        generacionId,
        clase: 'reconstruccion',
        fronteraInicial: '0',
        propietario: flujo.generacion.propietario
      } : null,
      propietario: flujo.generacion.propietario,
      estrategia: estrategiaNormalizada,
      generacionObjetivoId,
      decisionManual
    });
    if (resultado.resultado === 'creada') {
      const corte = await this.servicioCorteInicial.cerrar({
        flujoId: flujo.flujoId,
        generacionId
      });
      const candidata = (await this.repositorioCandidatas.listar(flujo.flujoId))
        .find(({ generacionId: actual }) => actual === generacionId);
      const transfiriendo = await this.repositorioCandidatas.avanzar({
        flujoId: flujo.flujoId,
        generacionId,
        propietario: candidata.propietario,
        versionEstadoEsperada: candidata.versionEstado,
        versionFronteraEsperada: candidata.frontera.version,
        estadoGeneracion: 'transfiriendo',
        frontera: {
          posicionOperativa: null,
          posicionHistorica: null,
          sincronizando: true,
          operativamenteCompleta: false,
          historicamenteCompleta: false,
          parcialPorScope: false,
          degradada: false
        }
      });
      return Object.freeze({ ...resultado, candidata: transfiriendo, corte });
    }
    return resultado;
  }

  async cancelar({
    flujoId,
    generacionId,
    contextoUsuarioActual,
    motivo = null
  } = {}) {
    const candidata = await this.#candidata(flujoId, generacionId);
    return this.repositorioCandidatas.cancelar({
      flujoId,
      generacionId,
      propietario: candidata.propietario,
      decisionManual: this.#decision(contextoUsuarioActual, motivo)
    });
  }

  async promover({
    flujoId,
    generacionId,
    contextoUsuarioActual,
    motivo = null
  } = {}) {
    const candidata = await this.#candidata(flujoId, generacionId);
    return this.repositorioCandidatas.promover({
      flujoId,
      generacionId,
      propietario: candidata.propietario,
      decisionManual: this.#decision(contextoUsuarioActual, motivo)
    });
  }

  async revalidar({
    flujoId,
    generacionId,
    contextoUsuarioActual,
    motivo = null
  } = {}) {
    const candidata = await this.#candidata(flujoId, generacionId);
    if (!candidata.requiereRevalidacion) {
      fallar(
        'candidata_no_requiere_revalidacion',
        'La candidata ya está validada contra la generación activa vigente.'
      );
    }
    const revalidada = await this.repositorioCandidatas.revalidar({
      flujoId,
      generacionId,
      propietario: candidata.propietario,
      decisionManual: this.#decision(contextoUsuarioActual, motivo)
    });
    return Object.freeze({ resultado: 'revalidada', candidata: revalidada });
  }

  async #flujo(flujoId) {
    const flujo = await this.repositorioFlujos.obtener(flujoId);
    if (!flujo) {
      fallar('flujo_inexistente', 'No existe el flujo solicitado.');
    }
    return flujo;
  }

  async #candidata(flujoId, generacionId) {
    await this.#flujo(flujoId);
    const candidata = (await this.repositorioCandidatas.listar(flujoId)).find(
      ({ generacionId: actual }) => actual === String(generacionId)
    );
    if (!candidata) {
      fallar('candidata_inexistente', 'La generación ya no es candidata del flujo.');
    }
    return candidata;
  }

  #decision(contextoUsuarioActual, motivo) {
    if (!contextoUsuarioActual || contextoUsuarioActual.impersonacionActiva ||
        !/^[1-9][0-9]*$/u.test(String(contextoUsuarioActual.idUsuario || ''))) {
      fallar(
        'sesion_directa_requerida',
        'La reconstrucción exige una sesión humana directa identificable.'
      );
    }
    const eventoId = this.generarEventoId();
    return Object.freeze({
      eventoId,
      correlacionId: this.generarEventoId(),
      actor: Object.freeze({
        real: Object.freeze({
          tipo: 'usuario',
          id: String(contextoUsuarioActual.idUsuario)
        }),
        efectivo: null,
        modo: 'directo'
      }),
      motivo
    });
  }
}

function exigirEstrategia(valor) {
  const estrategia = String(valor || '');
  if (!ESTRATEGIAS.has(estrategia)) {
    fallar(
      'estrategia_reconstruccion_invalida',
      'Debe elegirse esperar, ampliar, sustituir o coexistir.'
    );
  }
  return estrategia;
}

function fallar(codigo, mensaje) {
  throw new ErrorReconstruccionManualFederacion(codigo, mensaje);
}

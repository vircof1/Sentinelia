import { crearLoteRecepcionFederacion } from '../../../../paquetes/federacion/src/LoteRecepcionFederacion.js';
import {
  TIPOS_IDENTIDAD_FEDERADA,
  crearIdentidadFederada
} from '../../../../paquetes/federacion/src/IdentidadFederada.js';

export class ControladorDatosFederacion {
  constructor({
    servicioRecepcionLotes,
    repositorioCursores,
    servicioDisponibilidad,
    repositorioDisponibilidad,
    resolutorCapacidad,
    exigirContribuciones = false
  } = {}) {
    if (typeof servicioRecepcionLotes?.entregarLote !== 'function' ||
        typeof servicioRecepcionLotes?.esReplayTerminalExacto !== 'function' ||
        typeof repositorioCursores?.obtenerProgresoParaRelacion !== 'function' ||
        typeof servicioDisponibilidad?.registrar !== 'function' ||
        typeof repositorioDisponibilidad?.listarParaRelacion !== 'function' ||
        typeof resolutorCapacidad?.resolver !== 'function') {
      throw new Error('El controlador de datos federados requiere sus puertos completos.');
    }
    this.servicioRecepcionLotes = servicioRecepcionLotes;
    this.repositorioCursores = repositorioCursores;
    this.servicioDisponibilidad = servicioDisponibilidad;
    this.repositorioDisponibilidad = repositorioDisponibilidad;
    this.resolutorCapacidad = resolutorCapacidad;
    this.exigirContribuciones = exigirContribuciones === true;
  }

  async obtenerCapacidad(requisicion, respuesta, next) {
    try {
      const capacidad = await this.resolutorCapacidad.resolver(
        requisicion.configuracionPortalActual
      );
      return responderJson(respuesta, capacidad.declaracion);
    } catch (error) {
      next(error);
    }
  }

  async entregarLote(requisicion, respuesta, next) {
    try {
      const capacidad = requisicion.capacidadRecepcionFederacion ||
        await this.resolutorCapacidad.resolver(requisicion.configuracionPortalActual);
      const prevalidacion = validarLoteAntesDeReserva(
        requisicion.body,
        capacidad.aplicada,
        { exigirContribuciones: this.exigirContribuciones }
      );
      const lote = prevalidacion.lote;
      if (lote.relacionId !== requisicion.sesionFederacion?.relacionId) {
        const error = new Error('La sesión no autoriza la relación declarada por el lote.');
        error.codigo = 'RELACION_LOTE_NO_AUTORIZADA';
        error.statusCode = 403;
        throw error;
      }
      if (prevalidacion.excedeLimite &&
          !await this.servicioRecepcionLotes.esReplayTerminalExacto(requisicion.body)) {
        throw errorLimiteLote(capacidad.aplicada);
      }
      const resultado = await this.servicioRecepcionLotes.entregarLote(
        requisicion.body,
        { capacidad: capacidad.aplicada }
      );
      return responderJson(respuesta, resultado);
    } catch (error) {
      next(error);
    }
  }

  async obtenerProgreso(requisicion, respuesta, next) {
    try {
      const flujoId = identidad(
        requisicion.params.flujoId,
        TIPOS_IDENTIDAD_FEDERADA.FLUJO
      );
      const generacionId = identidad(
        requisicion.params.generacionId,
        TIPOS_IDENTIDAD_FEDERADA.GENERACION
      );
      const progreso = await this.repositorioCursores.obtenerProgresoParaRelacion({
        relacionId: requisicion.sesionFederacion.relacionId,
        flujoId,
        generacionId
      });
      if (!progreso) {
        const error = new Error('No existe progreso receptor para esa generación.');
        error.codigo = 'PROGRESO_FEDERADO_NO_ENCONTRADO';
        error.statusCode = 404;
        throw error;
      }
      return responderJson(respuesta, progreso);
    } catch (error) {
      next(error);
    }
  }

  async registrarDisponibilidad(requisicion, respuesta, next) {
    try {
      const flujoId = identidad(requisicion.params.flujoId, TIPOS_IDENTIDAD_FEDERADA.FLUJO);
      const generacionId = identidad(
        requisicion.params.generacionId,
        TIPOS_IDENTIDAD_FEDERADA.GENERACION
      );
      const declaracion = requisicion.body;
      if (!declaracion || typeof declaracion !== 'object' ||
          Array.isArray(declaracion) ||
          Object.getPrototypeOf(declaracion) !== Object.prototype) {
        const error = new Error('La declaración de disponibilidad debe ser un objeto JSON.');
        error.codigo = 'DISPONIBILIDAD_FEDERADA_JSON_INVALIDA';
        error.statusCode = 400;
        throw error;
      }
      if (declaracion?.relacionId !== requisicion.sesionFederacion?.relacionId ||
          declaracion?.flujoId !== flujoId || declaracion?.generacionId !== generacionId) {
        const error = new Error('La sesión o la ruta no autorizan la declaración de disponibilidad.');
        error.codigo = 'DISPONIBILIDAD_FEDERADA_NO_AUTORIZADA';
        error.statusCode = 403;
        throw error;
      }
      return responderJson(
        respuesta,
        disponibilidadPublica(
          await this.servicioDisponibilidad.registrar(declaracion)
        )
      );
    } catch (error) {
      next(error);
    }
  }

  async listarDisponibilidad(requisicion, respuesta, next) {
    try {
      const flujoId = identidad(requisicion.params.flujoId, TIPOS_IDENTIDAD_FEDERADA.FLUJO);
      const generacionId = identidad(
        requisicion.params.generacionId,
        TIPOS_IDENTIDAD_FEDERADA.GENERACION
      );
      const declaraciones = await this.repositorioDisponibilidad.listarParaRelacion({
        relacionId: requisicion.sesionFederacion.relacionId,
        flujoId,
        generacionId
      });
      return responderJson(respuesta, { declaraciones });
    } catch (error) {
      next(error);
    }
  }
}

function validarLoteAntesDeReserva(
  entrada,
  capacidad,
  { exigirContribuciones = false } = {}
) {
  exigirObjetoConOpcionales(
    entrada,
    [
      'loteId', 'relacionId', 'flujoId', 'generacionId', 'entregas',
      ...(exigirContribuciones ? ['revisionConcesionEfectiva'] : [])
    ],
    exigirContribuciones ? [] : ['revisionConcesionEfectiva']
  );
  const lote = crearLoteRecepcionFederacion(entrada);
  entrada.entregas.forEach((entrega) => exigirObjetoConOpcionales(
    entrega,
    [
      'entregaId', 'posicionFlujo', 'ocurrencia',
      ...(exigirContribuciones ? ['procedencia'] : [])
    ],
    exigirContribuciones ? [] : ['procedencia']
  ));
  let excedeLimite = lote.entregas.length > capacidad.maximoOcurrenciasPorLote;
  let bytes = 2;
  for (const entrega of lote.entregas) {
    bytes += Buffer.byteLength(entrega.ocurrenciaCanonica, 'utf8') +
      (entrega.procedenciaCanonica === null
        ? 0
        : Buffer.byteLength(entrega.procedenciaCanonica, 'utf8')) +
      (entrega.ordinalLote === 1 ? 0 : 1);
    excedeLimite = excedeLimite || bytes > capacidad.maximoBytesPorLote;
  }
  return Object.freeze({ lote, excedeLimite, bytesCanonicos: bytes });
}

function exigirObjetoConOpcionales(valor, requeridas, opcionales) {
  exigirObjetoExacto(valor, [
    ...requeridas,
    ...opcionales.filter((clave) => Object.hasOwn(valor || {}, clave))
  ]);
}

function exigirObjetoExacto(valor, claves) {
  if (!valor || typeof valor !== 'object' || Array.isArray(valor) ||
      Object.getPrototypeOf(valor) !== Object.prototype) {
    const error = new Error('El lote debe ser un objeto JSON.');
    error.codigo = 'LOTE_JSON_INVALIDO';
    error.statusCode = 400;
    throw error;
  }
  const observadas = Object.keys(valor).sort();
  const esperadas = [...claves].sort();
  if (observadas.length !== esperadas.length ||
      observadas.some((clave, indice) => clave !== esperadas[indice])) {
    const error = new Error('El lote contiene campos ausentes o desconocidos.');
    error.codigo = 'LOTE_JSON_INVALIDO';
    error.statusCode = 400;
    throw error;
  }
}

function errorLimiteLote(capacidad) {
  const error = new Error('El lote supera los límites vigentes del receptor.');
  error.codigo = 'lote_excede_limites';
  error.statusCode = 413;
  error.capacidad = capacidad;
  return error;
}

function identidad(valor, tipo) {
  try {
    return String(crearIdentidadFederada({ tipo, valor: String(valor || '') }));
  } catch {
    const error = new Error('La ruta no contiene identidades federadas canónicas.');
    error.codigo = 'IDENTIDAD_RUTA_FEDERADA_INVALIDA';
    error.statusCode = 400;
    throw error;
  }
}

function responderJson(respuesta, cuerpo) {
  return respuesta.set('Cache-Control', 'no-store').json(cuerpo);
}

function disponibilidadPublica(resultado) {
  const declaracion = resultado.declaracion;
  return Object.freeze({
    declaracion: Object.freeze({
      declaracionId: declaracion.declaracionId,
      relacionId: declaracion.relacionId,
      flujoId: declaracion.flujoId,
      generacionId: declaracion.generacionId,
      installationDeclaranteId: declaracion.installationDeclaranteId,
      familia: declaracion.familia,
      tipo: declaracion.tipo,
      inicioPosicion: declaracion.inicioPosicion,
      finPosicion: declaracion.finPosicion,
      causa: declaracion.causa,
      rutasAlternativasAgotadas: declaracion.rutasAlternativasAgotadas,
      declaradaEnOrigenUtc: declaracion.declaradaEnOrigenUtc,
      recibidaEnUtc: declaracion.recibidaEnUtc,
      aplicadaCursor: declaracion.aplicadaCursor,
      yaConocida: declaracion.yaConocida
    }),
    progreso: resultado.progreso,
    avisoPlataformaActualizado: resultado.aviso !== null
  });
}

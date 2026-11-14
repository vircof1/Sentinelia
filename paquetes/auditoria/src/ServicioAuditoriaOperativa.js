import { prepararIntencionAuditoriaV1 } from './HuellaIntencionAuditoria.js';
import {
  ConflictoIdempotenciaAuditoria,
  IncoherenciaCadenaAuditoria
} from './RepositorioAuditoria.js';
import {
  CODIGOS_ERROR_REGISTRO_AUDITORIA,
  ErrorRegistroAuditoria
} from './ErroresRegistroAuditoria.js';
import { validarParMovimientoAuditoriaV1 } from './ValidadorContratoAuditoria.js';

const ERRORES_TRANSITORIOS_SQL = new Set([
  'ER_LOCK_DEADLOCK',
  'ER_CHECKREAD',
  'ER_LOCK_WAIT_TIMEOUT'
]);

export class ServicioAuditoriaOperativa {
  constructor({ repositorioAuditoria, capturadorFederacion = null } = {}) {
    if (typeof repositorioAuditoria?.incorporarEnTransaccion !== 'function') {
      throw new Error(
        'ServicioAuditoriaOperativa requiere un repositorio de auditoría operativo.'
      );
    }
    if (capturadorFederacion !== null &&
        typeof capturadorFederacion?.capturarEnTransaccion !== 'function') {
      throw new Error('El productor federado de auditoría no es transaccional.');
    }
    this.repositorioAuditoria = repositorioAuditoria;
    this.capturadorFederacion = capturadorFederacion;
  }

  async registrarEnTransaccion(solicitud, { conexion } = {}) {
    const { cambioEfectivo, intencion } = validarSolicitud(solicitud);
    if (!cambioEfectivo) return construirResultadoSinCambios();

    validarConexionPrestada(conexion);
    const intencionValidada = validarIntencion(intencion);
    const resultado = await incorporar(
      this.repositorioAuditoria,
      [intencionValidada],
      conexion
    );

    if (resultado?.eventos?.length !== 1) {
      throw new ErrorRegistroAuditoria(
        'El repositorio no devolvió exactamente un evento para la intención.',
        {
          codigo: CODIGOS_ERROR_REGISTRO_AUDITORIA.INCOHERENCIA_CADENA
        }
      );
    }

    const evento = Object.freeze({ ...resultado.eventos[0] });
    await this.#capturarEventosNuevos(
      [evento],
      conexion
    );
    return Object.freeze({
      estado: evento.estado,
      evento,
      genesis: Object.freeze([...(resultado.genesis || [])]),
      registradoEnUtc: resultado.registradoEnUtc,
      esNoOp: false
    });
  }

  async recuperarPorIdentidadEnTransaccion(identidad, { conexion } = {}) {
    validarConexionPrestada(conexion);
    if (typeof this.repositorioAuditoria.buscarPorIdentidadEnTransaccion !== 'function') {
      throw new ErrorRegistroAuditoria(
        'El repositorio no permite recuperar una intención auditable durable.',
        { codigo: CODIGOS_ERROR_REGISTRO_AUDITORIA.PERSISTENCIA_FALLIDA }
      );
    }
    return this.repositorioAuditoria.buscarPorIdentidadEnTransaccion(
      identidad,
      { conexion }
    );
  }

  async registrarMovimientoEnTransaccion(solicitud, { conexion } = {}) {
    const { cambioEfectivo, salida, entrada } =
      validarSolicitudMovimiento(solicitud);
    if (!cambioEfectivo) return construirResultadoMovimientoSinCambios();

    validarConexionPrestada(conexion);
    const salidaValidada = validarIntencion(salida);
    const entradaValidada = validarIntencion(entrada);
    try {
      validarParMovimientoAuditoriaV1(salidaValidada, entradaValidada);
    } catch (causa) {
      throw entradaInvalida(
        'El par de movimiento no satisface el contrato salida/entrada.',
        causa
      );
    }
    const resultado = await incorporar(
      this.repositorioAuditoria,
      [salidaValidada, entradaValidada],
      conexion
    );
    if (resultado?.eventos?.length !== 2) {
      throw incoherenciaResultado(
        'El repositorio no devolvió ambos lados del movimiento.'
      );
    }
    const [eventoSalida, eventoEntrada] = resultado.eventos.map(
      (evento) => Object.freeze({ ...evento })
    );
    const estados = [eventoSalida.estado, eventoEntrada.estado];
    const incorporados = estados.filter(
      (estado) => estado === 'incorporado'
    ).length;
    if (incorporados !== 0 && incorporados !== 2) {
      throw incoherenciaResultado(
        'El repositorio devolvió una incorporación parcial del movimiento.'
      );
    }
    if (
      incorporados === 0 &&
      estados.some((estado) => !['existente', 'retenido'].includes(estado))
    ) {
      throw incoherenciaResultado(
        'El repositorio devolvió un estado desconocido para el movimiento.'
      );
    }
    await this.#capturarEventosNuevos(
      [eventoSalida, eventoEntrada],
      conexion
    );
    return Object.freeze({
      estado: incorporados === 2 ? 'incorporado' : 'existente',
      salida: eventoSalida,
      entrada: eventoEntrada,
      genesis: Object.freeze([...(resultado.genesis || [])]),
      registradoEnUtc: resultado.registradoEnUtc,
      esNoOp: false
    });
  }

  async registrarMovimientoConResultadosEnTransaccion(
    solicitud,
    { conexion } = {}
  ) {
    validarObjetoSolicitud(solicitud, [
      'cambioEfectivo', 'entrada', 'principales', 'resultados', 'salida'
    ], 'movimiento con resultados');
    const { cambioEfectivo, salida, entrada, principales, resultados } = solicitud;
    if (typeof cambioEfectivo !== 'boolean' || !Array.isArray(principales) ||
        !Array.isArray(resultados)) {
      throw entradaInvalida(
        'El movimiento exige cambioEfectivo booleano y arrays de principales y resultados.'
      );
    }
    if (!cambioEfectivo) {
      if (salida !== null || entrada !== null || principales.length !== 0 ||
          resultados.length !== 0) {
        throw entradaInvalida(
          'Un movimiento no-op exige lados nulos y eventos auxiliares vacíos.'
        );
      }
      return construirResultadoMovimientoSinCambios();
    }
    validarConexionPrestada(conexion);
    const salidaValidada = validarIntencion(salida);
    const entradaValidada = validarIntencion(entrada);
    const principalesValidados = principales.map(validarIntencion);
    const resultadosValidados = resultados.map(validarIntencion);
    try {
      validarParMovimientoAuditoriaV1(salidaValidada, entradaValidada);
    } catch (causa) {
      throw entradaInvalida(
        'El par del movimiento con resultados no satisface el contrato.',
        causa
      );
    }
    for (const principal of principalesValidados) {
      if (
        principal.rolEvento !== 'principal' ||
        principal.correlacionId !== salidaValidada.correlacionId ||
        principal.causalidad !== null
      ) {
        throw entradaInvalida(
          'Un evento principal auxiliar debe compartir correlación y carecer de causalidad.'
        );
      }
    }
    for (const consecuencia of resultadosValidados) {
      if (
        consecuencia.rolEvento !== 'resultado' ||
        consecuencia.correlacionId !== salidaValidada.correlacionId ||
        consecuencia.causalidad?.tipo !== 'evento_auditoria' ||
        consecuencia.causalidad?.id !== salidaValidada.eventoId
      ) {
        throw entradaInvalida(
          'Una consecuencia debe ser resultado correlacionado y causado por la salida.'
        );
      }
    }
    const lote = [
      salidaValidada,
      entradaValidada,
      ...principalesValidados,
      ...resultadosValidados
    ];
    const resultado = await incorporar(this.repositorioAuditoria, lote, conexion);
    if (resultado?.eventos?.length !== lote.length) {
      throw incoherenciaResultado(
        'El repositorio no devolvió el movimiento y todos sus resultados.'
      );
    }
    const [eventoSalida, eventoEntrada, ...eventosAuxiliares] = resultado.eventos;
    const eventosPrincipales = eventosAuxiliares.slice(0, principalesValidados.length);
    const eventosResultado = eventosAuxiliares.slice(principalesValidados.length);
    const estadosPar = [eventoSalida.estado, eventoEntrada.estado];
    if (estadosPar.filter((estado) => estado === 'incorporado').length === 1) {
      throw incoherenciaResultado(
        'El repositorio devolvió una incorporación parcial del movimiento.'
      );
    }
    await this.#capturarEventosNuevos(
      resultado.eventos,
      conexion
    );
    return Object.freeze({
      estado: estadosPar.every((estado) => estado === 'incorporado')
        ? 'incorporado' : 'existente',
      salida: Object.freeze({ ...eventoSalida }),
      entrada: Object.freeze({ ...eventoEntrada }),
      principales: Object.freeze(
        eventosPrincipales.map((evento) => Object.freeze({ ...evento }))
      ),
      resultados: Object.freeze(
        eventosResultado.map((evento) => Object.freeze({ ...evento }))
      ),
      genesis: Object.freeze([...(resultado.genesis || [])]),
      registradoEnUtc: resultado.registradoEnUtc,
      esNoOp: false
    });
  }

  async #capturarEventosNuevos(eventos, conexion) {
    if (!this.capturadorFederacion) return null;
    const nuevos = eventos.filter((evento) => evento.estado === 'incorporado');
    if (nuevos.length === 0) return null;
    return this.capturadorFederacion.capturarEnTransaccion({
      familia: 'auditoria',
      prepararCapturas: async ({ selector, interfazCaptura }) => {
        const incluirPayloadCompleto = selector.permiteContenidoSensible &&
          selector.campos.includes('payloadCompleto');
        const capturas = [];
        for (const evento of nuevos) {
          capturas.push(await interfazCaptura.prepararCapturaEnTransaccion({
            eventoId: evento.eventoId,
            incluirPayloadCompleto,
            puedeFederarPayloadCompleto: incluirPayloadCompleto
          }, { conexion }));
        }
        return capturas;
      }
    }, { conexion });
  }
}

function validarSolicitud(solicitud) {
  if (
    solicitud === null ||
    typeof solicitud !== 'object' ||
    Array.isArray(solicitud) ||
    Object.getPrototypeOf(solicitud) !== Object.prototype
  ) {
    throw entradaInvalida('La solicitud de auditoría debe ser un objeto plano.');
  }
  const propiedades = Reflect.ownKeys(solicitud);
  if (propiedades.some((clave) => typeof clave !== 'string')) {
    throw entradaInvalida('La solicitud de auditoría contiene claves no válidas.');
  }
  const claves = propiedades.sort();
  if (
    claves.length !== 2 ||
    claves[0] !== 'cambioEfectivo' ||
    claves[1] !== 'intencion'
  ) {
    throw entradaInvalida(
      'La solicitud de auditoría exige únicamente cambioEfectivo e intencion.'
    );
  }
  if (typeof solicitud.cambioEfectivo !== 'boolean') {
    throw entradaInvalida('cambioEfectivo debe ser booleano.');
  }
  if (!solicitud.cambioEfectivo && solicitud.intencion !== null) {
    throw entradaInvalida('Un no-op exige intencion=null.');
  }
  if (
    solicitud.cambioEfectivo &&
    (solicitud.intencion === null || typeof solicitud.intencion !== 'object')
  ) {
    throw entradaInvalida('Un cambio efectivo exige una intención auditable.');
  }
  return solicitud;
}

function construirResultadoSinCambios() {
  return Object.freeze({
    estado: 'sin_cambios',
    evento: null,
    genesis: Object.freeze([]),
    registradoEnUtc: null,
    esNoOp: true
  });
}

function validarSolicitudMovimiento(solicitud) {
  validarObjetoSolicitud(solicitud, [
    'cambioEfectivo',
    'entrada',
    'salida'
  ], 'movimiento');
  if (typeof solicitud.cambioEfectivo !== 'boolean') {
    throw entradaInvalida('cambioEfectivo debe ser booleano.');
  }
  if (
    !solicitud.cambioEfectivo &&
    (solicitud.salida !== null || solicitud.entrada !== null)
  ) {
    throw entradaInvalida('Un movimiento no-op exige salida=null y entrada=null.');
  }
  if (
    solicitud.cambioEfectivo &&
    [solicitud.salida, solicitud.entrada].some(
      (lado) => lado === null || typeof lado !== 'object' || Array.isArray(lado)
    )
  ) {
    throw entradaInvalida('Un movimiento efectivo exige salida y entrada.');
  }
  return solicitud;
}

function validarObjetoSolicitud(solicitud, clavesEsperadas, nombre) {
  if (
    solicitud === null ||
    typeof solicitud !== 'object' ||
    Array.isArray(solicitud) ||
    Object.getPrototypeOf(solicitud) !== Object.prototype
  ) {
    throw entradaInvalida(`La solicitud de ${nombre} debe ser un objeto plano.`);
  }
  const propiedades = Reflect.ownKeys(solicitud);
  if (propiedades.some((clave) => typeof clave !== 'string')) {
    throw entradaInvalida(`La solicitud de ${nombre} contiene claves no válidas.`);
  }
  const claves = propiedades.sort();
  const esperadas = [...clavesEsperadas].sort();
  if (
    claves.length !== esperadas.length ||
    claves.some((clave, indice) => clave !== esperadas[indice])
  ) {
    throw entradaInvalida(
      `La solicitud de ${nombre} no coincide con su contrato cerrado.`
    );
  }
}

function construirResultadoMovimientoSinCambios() {
  return Object.freeze({
    estado: 'sin_cambios',
    salida: null,
    entrada: null,
    genesis: Object.freeze([]),
    registradoEnUtc: null,
    esNoOp: true
  });
}

function validarConexionPrestada(conexion) {
  if (typeof conexion?.execute !== 'function') {
    throw new ErrorRegistroAuditoria(
      'El registro auditable exige una conexión SQL prestada.',
      {
        codigo: CODIGOS_ERROR_REGISTRO_AUDITORIA.FRONTERA_INVALIDA
      }
    );
  }
}

function validarIntencion(intencion) {
  try {
    return prepararIntencionAuditoriaV1(intencion).intencion;
  } catch (causa) {
    throw entradaInvalida(
      'La intención auditable no satisface el contrato activo.',
      causa
    );
  }
}

async function incorporar(repositorioAuditoria, intenciones, conexion) {
  try {
    return await repositorioAuditoria.incorporarEnTransaccion(
      intenciones,
      { conexion }
    );
  } catch (causa) {
    throw estructurarFalloPersistencia(causa);
  }
}

function incoherenciaResultado(mensaje) {
  return new ErrorRegistroAuditoria(mensaje, {
    codigo: CODIGOS_ERROR_REGISTRO_AUDITORIA.INCOHERENCIA_CADENA
  });
}

function estructurarFalloPersistencia(causa) {
  if (causa instanceof ConflictoIdempotenciaAuditoria) {
    return new ErrorRegistroAuditoria(
      'La identidad idempotente ya protege otra intención.',
      {
        codigo: CODIGOS_ERROR_REGISTRO_AUDITORIA.CONFLICTO_IDEMPOTENCIA,
        causa
      }
    );
  }
  if (causa instanceof IncoherenciaCadenaAuditoria) {
    return new ErrorRegistroAuditoria(
      'La cadena auditable no conserva una punta coherente.',
      {
        codigo: CODIGOS_ERROR_REGISTRO_AUDITORIA.INCOHERENCIA_CADENA,
        causa
      }
    );
  }
  return new ErrorRegistroAuditoria(
    'No se pudo persistir la evidencia auditable.',
    {
      codigo: CODIGOS_ERROR_REGISTRO_AUDITORIA.PERSISTENCIA_FALLIDA,
      causa,
      reintentable: ERRORES_TRANSITORIOS_SQL.has(causa?.code)
    }
  );
}

function entradaInvalida(mensaje, causa = null) {
  return new ErrorRegistroAuditoria(mensaje, {
    codigo: CODIGOS_ERROR_REGISTRO_AUDITORIA.ENTRADA_INVALIDA,
    causa
  });
}

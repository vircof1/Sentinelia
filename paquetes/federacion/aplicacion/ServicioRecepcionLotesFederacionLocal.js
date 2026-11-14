import { crearAplazamientoEntregaFederacion } from '../src/LoteRecepcionFederacion.js';
import {
  clasificarDescarteRetencionOcurrenciaFederada
} from '../src/ClasificadorRetencionOcurrenciaFederada.js';
import {
  obtenerContratoFamiliaFederacion
} from '../src/ContratosFamiliasFederacion.js';

const ERRORES_OCURRENCIA = new Set([
  'ErrorEnvolventeFederacion',
  'ErrorCanonicalizacionFederacion',
  'ErrorIdentidadFederada',
  'ErrorCatalogoFederacion',
  'ErrorScopeFederacion',
  'ErrorInboxFederacion',
  'ErrorContribucionesFederacion',
  'ErrorSoporteCamposFederacion',
  'ErrorEstadoProyeccionFederacionSql',
  'ErrorValidacionRecepcionFederacion',
  'ErrorAdaptadoresFamiliasFederacion',
  'ErrorPayloadEstructuraOrganizativaFederacion',
  'ErrorPayloadContextoOperativoAgentesSesionesFederacion',
  'ErrorPayloadTelemetriaFederacion',
  'ErrorPayloadMonitoresFederacion',
  'ErrorPayloadTriggersInformativosFederacion',
  'ErrorPayloadAuditoriaFederada',
  'ErrorPayloadAvisosFederados'
]);

export class ErrorValidacionRecepcionFederacion extends Error {
  constructor(codigo, mensaje) {
    super(mensaje);
    this.name = 'ErrorValidacionRecepcionFederacion';
    this.codigo = codigo;
  }
}

export class ServicioRecepcionLotesFederacionLocal {
  constructor({
    clienteSql,
    repositorioEntregas,
    repositorioInbox,
    repositorioCursores,
    repositorioMaterializacion = null,
    repositorioDivergencias = null,
    repositorioDisponibilidad = null,
    registroFamilias = null,
    testimoniadorRecepcion = null,
    normalizadorVistas = null,
    resolverCapacidad = async () => null,
    decidirAplazamiento = async () => null,
    guardiaActivacion = null
  } = {}) {
    if (!clienteSql?.obtenerConexion ||
        typeof repositorioEntregas?.prepararIntentoEnTransaccion !== 'function' ||
        typeof repositorioEntregas?.guardarIntentoEnTransaccion !== 'function' ||
        typeof repositorioInbox?.recibirEnTransaccion !== 'function' ||
        typeof repositorioCursores?.aplicarResultadosEnTransaccion !== 'function' ||
        (repositorioMaterializacion !== null &&
          typeof repositorioMaterializacion?.registrarTrabajoEnTransaccion !== 'function') ||
        (repositorioDivergencias !== null &&
          typeof repositorioDivergencias?.registrarEnTransaccion !== 'function') ||
        (repositorioDisponibilidad !== null &&
          typeof repositorioDisponibilidad?.evaluarDescarteEnTransaccion !== 'function') ||
        (testimoniadorRecepcion !== null &&
          typeof testimoniadorRecepcion?.registrarRecepcionEnTransaccion !== 'function') ||
        (normalizadorVistas !== null &&
          (typeof normalizadorVistas?.sanearLote !== 'function' ||
            typeof normalizadorVistas?.sanearLoteEnTransaccion !== 'function')) ||
        (registroFamilias !== null &&
          typeof registroFamilias?.obtenerProductivo !== 'function') ||
        typeof resolverCapacidad !== 'function' ||
        typeof decidirAplazamiento !== 'function') {
      throw new Error('La recepción local de lotes requiere sus puertos SQL completos.');
    }
    this.clienteSql = clienteSql;
    this.repositorioEntregas = repositorioEntregas;
    this.repositorioInbox = repositorioInbox;
    this.repositorioCursores = repositorioCursores;
    this.repositorioMaterializacion = repositorioMaterializacion;
    this.repositorioDivergencias = repositorioDivergencias;
    this.repositorioDisponibilidad = repositorioDisponibilidad;
    this.testimoniadorRecepcion = testimoniadorRecepcion;
    this.normalizadorVistas = normalizadorVistas;
    this.registroFamilias = registroFamilias;
    this.resolverCapacidad = resolverCapacidad;
    this.decidirAplazamiento = decidirAplazamiento;
    if (guardiaActivacion !== null &&
        typeof guardiaActivacion?.exigirActiva !== 'function') {
      throw new Error('guardiaActivacion debe implementar exigirActiva().');
    }
    this.guardiaActivacion = guardiaActivacion;
  }

  async esReplayTerminalExacto(entrada) {
    if (typeof this.repositorioEntregas.esReplayTerminalExacto !== 'function') {
      return false;
    }
    const entradaPersistible = this.normalizadorVistas
      ? await this.normalizadorVistas.sanearLote(entrada)
      : entrada;
    return this.repositorioEntregas.esReplayTerminalExacto(entradaPersistible);
  }

  async entregarLote(entrada, { capacidad = null } = {}) {
    await this.guardiaActivacion?.exigirActiva('recibir_lote');
    for (let intento = 1; intento <= 4; intento += 1) {
      try {
        return await this.#entregarLoteUnaVez(entrada, capacidad);
      } catch (error) {
        if (intento === 4 || !esConflictoTransaccionalReintentable(error)) throw error;
      }
    }
    throw new Error('Estado inalcanzable al reintentar el lote federado.');
  }

  async #entregarLoteUnaVez(entrada, capacidad) {
    const capacidadSolicitada = capacidad || await this.resolverCapacidad();
    const conexion = await this.clienteSql.obtenerConexion();
    try {
      await conexion.beginTransaction();
      const entradaPersistible = this.normalizadorVistas
        ? await this.normalizadorVistas.sanearLoteEnTransaccion(
          entrada,
          { conexion }
        )
        : entrada;
      const preparacion = await this.repositorioEntregas.prepararIntentoEnTransaccion(
        entradaPersistible,
        { conexion, capacidad: capacidadSolicitada }
      );
      const resultados = [];
      let capacidadConsumida = 0;
      for (const entrega of preparacion.lote.entregas) {
        const terminalPrevio = preparacion.terminalesPrevios.get(entrega.entregaId);
        if (terminalPrevio) {
          resultados.push(terminalPrevio);
          continue;
        }
        if (preparacion.entregasExcedidas.includes(entrega.entregaId)) {
          resultados.push(rechazoOcurrenciaExcedida());
          continue;
        }
        if (this.repositorioDisponibilidad) {
          const descarte = await this.repositorioDisponibilidad
            .evaluarDescarteEnTransaccion({
              lote: preparacion.lote,
              entrega,
              candidato: clasificarDescarteRetencionOcurrenciaFederada(
                entrega.ocurrencia
              )
            }, { conexion });
          if (descarte) {
            resultados.push(descarte);
            continue;
          }
        }
        if (!preparacion.capacidad.disponible ||
            capacidadConsumida >= preparacion.capacidad.capacidadTemporalOcurrencias) {
          resultados.push(crearAplazamientoEntregaFederacion({
            resultado: 'aplazadaCapacidad',
            errorTemporal: preparacion.capacidad.disponible
              ? 'capacidadTemporalAgotada'
              : 'relacionTemporalmenteDetenida'
          }));
          continue;
        }
        capacidadConsumida += 1;
        resultados.push(await this.#procesarEntrega({
          entrega,
          lote: preparacion.lote,
          numeroIntento: preparacion.numeroIntento,
          conexion
        }));
      }
      const durablePendiente = await this.repositorioEntregas.guardarIntentoEnTransaccion(
        preparacion,
        resultados,
        { conexion }
      );
      const progreso = await this.repositorioCursores.aplicarResultadosEnTransaccion({
        flujoId: preparacion.lote.flujoId,
        generacionId: preparacion.lote.generacionId,
        resultados: durablePendiente.resultados
      }, { conexion });
      if (this.testimoniadorRecepcion) {
        await this.testimoniadorRecepcion.registrarRecepcionEnTransaccion({
          preparacion,
          resultadoDurable: durablePendiente
        }, { conexion });
      }
      await conexion.commit();
      return hacerDurable(durablePendiente, progreso, preparacion.capacidad);
    } catch (error) {
      try {
        await conexion.rollback();
      } catch {}
      throw error;
    } finally {
      conexion.release();
    }
  }

  async #procesarEntrega({ lote, entrega, numeroIntento, conexion }) {
    const decision = await this.decidirAplazamiento({ entrega, numeroIntento });
    if (decision) return crearAplazamientoEntregaFederacion(decision);

    const savepoint = `entrega_${entrega.ordinalLote}`;
    await conexion.query(`SAVEPOINT ${savepoint}`);
    try {
      if (this.registroFamilias) {
        validarContratoRecepcionOcurrenciaFederada(
          entrega.ocurrencia,
          this.registroFamilias
        );
      }
      const resultadoInbox = await this.repositorioInbox.recibirEnTransaccion(
        entrega.ocurrencia,
        { conexion }
      );
      if (resultadoInbox.codigo === 'divergenciaContenido' &&
          this.repositorioDivergencias) {
        await this.repositorioDivergencias.registrarEnTransaccion({
          lote,
          entrega,
          inboxId: resultadoInbox.inboxId,
          conflictoId: resultadoInbox.conflictoId
        }, { conexion });
      } else if (resultadoInbox.codigo !== 'divergenciaContenido' &&
                 this.repositorioMaterializacion) {
        await this.repositorioMaterializacion.registrarTrabajoEnTransaccion({
          lote,
          entrega,
          inboxId: resultadoInbox.inboxId
        }, { conexion });
      }
      await conexion.query(`RELEASE SAVEPOINT ${savepoint}`);
      return mapearResultadoInbox(resultadoInbox, entrega.ocurrencia);
    } catch (error) {
      await conexion.query(`ROLLBACK TO SAVEPOINT ${savepoint}`);
      await conexion.query(`RELEASE SAVEPOINT ${savepoint}`);
      if (!esErrorIndividualDeOcurrencia(error)) throw error;
      return Object.freeze({
        clasificacion: 'terminal',
        resultado: 'rechazadaDefinitiva',
        errorTerminal: error?.codigo === 'ocurrencia_excede_limite'
          ? 'ocurrenciaExcedeLimite'
          : 'ocurrenciaInvalida',
        errorTemporal: null,
        inboxId: null,
        confirmada: false,
        reutilizado: false
      });
    }
  }
}

export function validarContratoRecepcionOcurrenciaFederada(
  ocurrencia,
  registroFamilias
) {
  if (typeof registroFamilias?.obtenerProductivo !== 'function') {
    throw new ErrorValidacionRecepcionFederacion(
      'registro_familias_recepcion_invalido',
      'La validación receptora exige el registro productivo de familias.'
    );
  }
  const adaptador = registroFamilias.obtenerProductivo({
    familia: ocurrencia?.familia,
    versionFamilia: ocurrencia?.familiaVersion
  });
  if (ocurrencia?.operacion !== 'actualizacion') return null;
  const contrato = obtenerContratoFamiliaFederacion(ocurrencia.familia);
  const declaracion = ocurrencia?.campos?.[contrato.selector.campoBase];
  if (!declaracion || declaracion.estado !== 'presente' ||
      !Object.hasOwn(declaracion, 'valor')) {
    throw new ErrorValidacionRecepcionFederacion(
      'campo_base_recepcion_ausente',
      'La actualización no contiene el conjunto funcional de su familia.'
    );
  }
  return adaptador.interfaces.payload.validarPayload(declaracion.valor, {
    operacion: ocurrencia.operacion
  });
}

function esConflictoTransaccionalReintentable(error) {
  return error?.code === 'ER_LOCK_DEADLOCK' ||
    error?.code === 'ER_LOCK_WAIT_TIMEOUT' ||
    error?.sqlState === '40001';
}

function rechazoOcurrenciaExcedida() {
  return Object.freeze({
    clasificacion: 'terminal',
    resultado: 'rechazadaDefinitiva',
    errorTerminal: 'ocurrenciaExcedeLimite',
    errorTemporal: null,
    inboxId: null,
    confirmada: false,
    reutilizado: false
  });
}

function esErrorIndividualDeOcurrencia(error) {
  if (ERRORES_OCURRENCIA.has(error?.name)) return true;
  return error?.sqlState === '23000' &&
    typeof error?.sql === 'string' &&
    error.sql.includes('inbox_ocurrencias_federacion');
}

function mapearResultadoInbox(resultado, ocurrencia) {
  if (resultado.codigo === 'divergenciaContenido') {
    return Object.freeze({
      clasificacion: 'terminal',
      resultado: 'divergente',
      errorTerminal: 'divergenciaContenido',
      errorTemporal: null,
      inboxId: resultado.inboxId,
      confirmada: false,
      reutilizado: false
    });
  }
  const resultadoAceptado = resultado.codigo === 'yaConocida'
    ? 'yaConocida'
    : ocurrencia.operacion === 'retirada'
      ? 'retiradaAceptada'
      : ocurrencia.operacion === 'salidaProyeccion'
        ? 'salidaAceptada'
        : 'aceptada';
  return Object.freeze({
    clasificacion: 'terminal',
    resultado: resultadoAceptado,
    errorTerminal: null,
    errorTemporal: null,
    inboxId: resultado.inboxId,
    confirmada: Boolean(resultado.confirmable),
    reutilizado: false
  });
}

function hacerDurable(resultado, progreso, capacidad) {
  return Object.freeze({
    loteId: resultado.loteId,
    intentoId: resultado.intentoId,
    numeroIntento: resultado.numeroIntento,
    clase: resultado.clase,
    estado: resultado.estado,
    persistidoDurablemente: true,
    capacidad,
    progreso,
    resultados: Object.freeze(resultado.resultados.map((individual) => {
      const { resultadoId, inboxId, ...publico } = individual;
      return Object.freeze({
        ...publico,
        persistidoDurablemente: true
      });
    }))
  });
}

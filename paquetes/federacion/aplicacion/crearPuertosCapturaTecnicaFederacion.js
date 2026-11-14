import {
  crearSolicitudCapturaTecnicaFederacion,
  OPERACIONES_CAPTURA_TECNICA_FEDERACION
} from '../src/OperacionesCapturaTecnicaFederacion.js';

export function crearPuertosCapturaTecnicaFederacion({ capturador } = {}) {
  if (typeof capturador?.capturarEnTransaccion !== 'function') {
    throw new Error('Los productores técnicos requieren captura federada transaccional.');
  }

  const monitores = Object.freeze({
    capturarRuntimeEnTransaccion: (solicitud, { conexion } = {}) =>
      capturador.capturarEnTransaccion({
        familia: 'monitores',
        prepararCapturas: ({ interfazCaptura }) =>
          interfazCaptura.prepararCapturaEnTransaccion(
            crearSolicitudCapturaTecnicaFederacion(
              OPERACIONES_CAPTURA_TECNICA_FEDERACION.MONITORES_RUNTIME,
              solicitud
            ),
            { conexion }
          )
      }, { conexion })
  });

  const telemetria = Object.freeze({
    capturarIngestaEnTransaccion: (solicitud, { conexion } = {}) => {
      let incluirFuente;
      return capturarTelemetria(capturador, async ({ interfazCaptura }) => {
        incluirFuente ??= await requiereFuenteTelemetria(
          conexion,
          solicitud?.agenteId
        );
        return interfazCaptura.prepararCapturaEnTransaccion(
          crearSolicitudCapturaTecnicaFederacion(
            OPERACIONES_CAPTURA_TECNICA_FEDERACION.TELEMETRIA_INGESTA,
            { ...solicitud, incluirFuente }
          ),
          { conexion }
        );
      }, conexion);
    },

    capturarReglaEnTransaccion: ({ reglaId } = {}, { conexion } = {}) =>
      capturarTelemetria(capturador, ({ interfazCaptura }) =>
        interfazCaptura.prepararCapturaEnTransaccion({
          tipoRegistro: 'reglaDerivacion',
          idLocal: reglaId
        }, { conexion }), conexion),

    retirarFotografiasEnTransaccion: ({ fotografiaIds = [] } = {}, {
      conexion
    } = {}) => {
      const ids = idsPositivosUnicos(fotografiaIds, 'fotografiaIds');
      if (ids.length === 0) return resultadoSinCambios();
      return capturarTelemetria(capturador, async ({ interfazCaptura }) => {
        const retiradas = [];
        for (const idLocal of ids) {
          retiradas.push(
            await interfazCaptura.prepararRetiradaEnTransaccion({
              tipoRegistro: 'fotografiaSenal',
              idLocal
            }, { conexion })
          );
        }
        return retiradas;
      }, conexion);
    },

    capturarEvaluacionEnTransaccion: ({
      reglaId,
      estadoActualizado = false,
      eventoDerivadoId = null,
      eventoCreado = false
    } = {}, { conexion } = {}) => {
      if (!estadoActualizado && !eventoCreado) return resultadoSinCambios();
      return capturarTelemetria(capturador, async ({ interfazCaptura }) => {
        const capturas = [];
        if (estadoActualizado) {
          capturas.push(await interfazCaptura.prepararCapturaEnTransaccion({
            tipoRegistro: 'reglaDerivacion',
            idLocal: reglaId
          }, { conexion }));
        }
        if (eventoCreado) {
          capturas.push(await interfazCaptura.prepararCapturaEnTransaccion({
            tipoRegistro: 'eventoDerivado',
            idLocal: eventoDerivadoId
          }, { conexion }));
        }
        return capturas;
      }, conexion);
    }
  });

  const triggers = Object.freeze({
    capturarEjecucionEnTransaccion: ({ ejecucionId } = {}, { conexion } = {}) =>
      capturador.capturarEnTransaccion({
        familia: 'triggersInformativos',
        prepararCapturas: ({ selector, interfazCaptura }) => {
          const incluirContenidoSensible = selector.permiteContenidoSensible &&
            selector.campos.includes('contenidoSensibleEjecucion');
          return interfazCaptura.prepararCapturaEnTransaccion(
            crearSolicitudCapturaTecnicaFederacion(
              OPERACIONES_CAPTURA_TECNICA_FEDERACION.TRIGGERS_EJECUCION,
              {
                ejecucionIds: [ejecucionId],
                incluirContenidoSensible,
                puedeFederarContenidoSensible: incluirContenidoSensible,
                monitorIdsVisibles: []
              }
            ),
            { conexion }
          );
        }
      }, { conexion })
  });

  const auditoria = Object.freeze({
    capturarEventoEnTransaccion: ({ eventoId } = {}, { conexion } = {}) =>
      capturador.capturarEnTransaccion({
        familia: 'auditoria',
        prepararCapturas: ({ selector, interfazCaptura }) => {
          const incluirPayloadCompleto = selector.permiteContenidoSensible &&
            selector.campos.includes('payloadCompleto');
          return interfazCaptura.prepararCapturaEnTransaccion({
            eventoId,
            incluirPayloadCompleto,
            puedeFederarPayloadCompleto: incluirPayloadCompleto
          }, { conexion });
        }
      }, { conexion })
  });

  return Object.freeze({ monitores, telemetria, triggers, auditoria });
}

function capturarTelemetria(capturador, prepararCapturas, conexion) {
  return capturador.capturarEnTransaccion({
    familia: 'telemetria',
    prepararCapturas
  }, { conexion });
}

async function requiereFuenteTelemetria(conexion, agenteId) {
  if (typeof conexion?.execute !== 'function') {
    throw new Error('La ingesta federable requiere una conexión SQL prestada.');
  }
  const [filas] = await conexion.execute(
    `SELECT 1 FROM identidades_elementos_telemetria_federacion
      WHERE tipo_elemento='fuente' AND clave_local=? AND estado='vigente'
      LIMIT 1 FOR UPDATE`,
    [String(agenteId)]
  );
  return !filas[0];
}

function resultadoSinCambios() {
  return Object.freeze({
    estado: 'sinCambiosFederables',
    ocurrencias: Object.freeze([]),
    posiciones: Object.freeze([])
  });
}

function idsPositivosUnicos(valores, campo) {
  if (!Array.isArray(valores)) {
    throw new TypeError(`${campo} debe ser una lista.`);
  }
  const ids = valores.map((valor) => Number(valor));
  if (ids.some((id) => !Number.isSafeInteger(id) || id <= 0)) {
    throw new Error(`${campo} contiene una identidad inválida.`);
  }
  return [...new Set(ids)];
}

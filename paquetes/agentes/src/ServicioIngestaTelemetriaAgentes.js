import {
  crearLoteTelemetriaAgente,
  crearResultadoIngestaTelemetria
} from './TelemetriaAgente.js';
import {
  CODIGO_ERROR_COMPATIBILIDAD_CATALOGO_TELEMETRIA,
  ErrorCompatibilidadCatalogoTelemetria
} from './RepositorioCatalogoSenalesTelemetriaAgentes.js';
import {
  AUTORIDADES_INGESTA_TELEMETRIA,
  asegurarAutoridadLoteTelemetria
} from './AutoridadTelemetriaAgentes.js';
import {
  crearRepositoriosTelemetriaEnTransaccion
} from './InfraestructuraTransaccionalTelemetriaAgentes.js';
import {
  construirSolicitudCapturaFederadaTelemetria
} from './CapturaFederadaTelemetriaAgentes.js';

const MARGEN_OBSERVACION_VIVA_SEGUNDOS = 300;

export class ServicioIngestaTelemetriaAgentes {
  constructor({
    repositorioCatalogoSenales,
    repositorioObservaciones = null,
    repositorioEstadoActual = null,
    repositorioIdempotenciaLotes = null,
    repositorioReglasDerivacion = null,
    repositorioTrabajosEvaluacion = null,
    repositorioFronteraRuntime = null,
    capturadorFederacionTelemetria = null,
    publicadorAvisosEvaluacion = null,
    publicadorInvalidacionesMonitores = null,
    generarRequestId = generarRequestIdTelemetria,
    reloj = () => new Date()
  } = {}) {
    if (!repositorioCatalogoSenales) {
      throw new Error('El repositorio de catálogo de telemetría es obligatorio.');
    }
    if (Boolean(repositorioReglasDerivacion) !== Boolean(repositorioTrabajosEvaluacion)) {
      throw new Error(
        'Las reglas de derivación y su outbox deben configurarse conjuntamente.'
      );
    }
    if (
      capturadorFederacionTelemetria !== null &&
      typeof capturadorFederacionTelemetria?.capturarIngestaEnTransaccion !== 'function'
    ) {
      throw new Error('La captura federada de telemetría requiere un puerto transaccional.');
    }

    this.repositorioCatalogoSenales = repositorioCatalogoSenales;
    this.repositorioObservaciones = repositorioObservaciones;
    this.repositorioEstadoActual = repositorioEstadoActual;
    this.repositorioIdempotenciaLotes = repositorioIdempotenciaLotes;
    this.repositorioReglasDerivacion = repositorioReglasDerivacion;
    this.repositorioTrabajosEvaluacion = repositorioTrabajosEvaluacion;
    this.repositorioFronteraRuntime = repositorioFronteraRuntime;
    this.capturadorFederacionTelemetria = capturadorFederacionTelemetria;
    this.publicadorAvisosEvaluacion = publicadorAvisosEvaluacion;
    this.publicadorInvalidacionesMonitores = publicadorInvalidacionesMonitores;
    this.generarRequestId = generarRequestId;
    this.reloj = reloj;
  }

  async ingestarLote({
    agenteId,
    lote,
    requestId = null,
    telemetriaRequestId = null,
    huellaLoteSha256 = null,
    recibidoEnUtc = null,
    periodoVidaPolId = null,
    sesionIdDiagnostico = null,
    sesionHuellaSha256 = null,
    autoridadRuntime = null
  } = {}) {
    if (!this.repositorioObservaciones) {
      throw new Error(
        'El repositorio de observaciones de telemetría es obligatorio para ingestar.'
      );
    }

    const repositorios = {
      repositorioCatalogoSenales: this.repositorioCatalogoSenales,
      repositorioObservaciones: this.repositorioObservaciones,
      repositorioEstadoActual: this.repositorioEstadoActual,
      repositorioIdempotenciaLotes: this.repositorioIdempotenciaLotes,
      repositorioReglasDerivacion: this.repositorioReglasDerivacion,
      repositorioTrabajosEvaluacion: this.repositorioTrabajosEvaluacion
    };
    const identidadIdempotente = normalizarIdentidadIdempotenteOpcional({
      telemetriaRequestId,
      huellaLoteSha256
    });
    if (identidadIdempotente && !this.repositorioIdempotenciaLotes) {
      throw new Error(
        'La ingesta idempotente requiere su repositorio SQL durable.'
      );
    }

    if (puedeUsarTransaccionCompartida(repositorios)) {
      return this.ingestarLoteTransaccional({
        agenteId,
        lote,
        requestId,
        telemetriaRequestId: identidadIdempotente?.telemetriaRequestId || null,
        huellaLoteSha256: identidadIdempotente?.huellaLoteSha256 || null,
        recibidoEnUtc,
        periodoVidaPolId,
        sesionIdDiagnostico,
        sesionHuellaSha256,
        autoridadRuntime
      });
    }

    if (this.repositorioReglasDerivacion) {
      throw new Error(
        'La ingesta con evaluación derivada requiere una única conexión SQL transaccional.'
      );
    }
    if (this.capturadorFederacionTelemetria) {
      throw new Error(
        'La captura federada de telemetría requiere una única conexión SQL transaccional.'
      );
    }
    if (identidadIdempotente) {
      throw new Error(
        'La ingesta idempotente requiere una única conexión SQL transaccional.'
      );
    }

    const resultado = await this.ingestarLoteConRepositorios({
      agenteId,
      lote,
      requestId,
      recibidoEnUtc,
      periodoVidaPolId,
      sesionIdDiagnostico,
      sesionHuellaSha256,
      repositorioCatalogoSenales: this.repositorioCatalogoSenales,
      repositorioObservaciones: this.repositorioObservaciones,
      repositorioEstadoActual: this.repositorioEstadoActual
    });
    await this.publicarInvalidacionesMonitoresSinAfectarIngesta(resultado);
    return resultado;
  }

  async ingestarLoteTransaccional({
    agenteId,
    lote,
    requestId = null,
    telemetriaRequestId = null,
    huellaLoteSha256 = null,
    recibidoEnUtc = null,
    periodoVidaPolId = null,
    sesionIdDiagnostico = null,
    sesionHuellaSha256 = null,
    autoridadRuntime = null,
    intentoTransaccional = 0
  } = {}) {
    const clienteSql = this.repositorioCatalogoSenales.clienteSql;
    const conexion = await clienteSql.obtenerConexion();
    const {
      repositorioCatalogoSenales,
      repositorioObservaciones,
      repositorioEstadoActual,
      repositorioIdempotenciaLotes,
      repositorioReglasDerivacion,
      repositorioTrabajosEvaluacion
    } = crearRepositoriosTelemetriaEnTransaccion({
      repositorioCatalogoSenales: this.repositorioCatalogoSenales,
      repositorioObservaciones: this.repositorioObservaciones,
      repositorioEstadoActual: this.repositorioEstadoActual,
      repositorioIdempotenciaLotes: this.repositorioIdempotenciaLotes,
      repositorioReglasDerivacion: this.repositorioReglasDerivacion,
      repositorioTrabajosEvaluacion: this.repositorioTrabajosEvaluacion
    }, conexion);
    const trabajosEncolados = [];
    let resultado;
    let replay = false;
    let errorParaReintentar = null;

    try {
      await conexion.beginTransaction();
      if (
        autoridadRuntime &&
        typeof this.repositorioFronteraRuntime
          ?.bloquearYValidarEnTransaccion === 'function'
      ) {
        await this.repositorioFronteraRuntime.bloquearYValidarEnTransaccion(
          { ...autoridadRuntime, agenteId },
          { conexion }
        );
      }
      const identidadIdempotente = normalizarIdentidadIdempotenteOpcional({
        telemetriaRequestId,
        huellaLoteSha256
      });
      const reserva = identidadIdempotente
        ? await repositorioIdempotenciaLotes.reservar({
          agenteId,
          telemetriaRequestId: identidadIdempotente.telemetriaRequestId,
          huellaSha256: identidadIdempotente.huellaLoteSha256
        })
        : null;

      if (reserva?.replay) {
        replay = true;
        resultado = reconstruirResultadoReplay({
          resultadoEstable: reserva.resultadoEstable,
          requestId: requestId || this.generarRequestId(),
          serverTimeUtc: this.reloj(),
          telemetriaRequestId
        });
      } else {
        resultado = await this.ingestarLoteConRepositorios({
          agenteId,
          lote,
          requestId,
          recibidoEnUtc,
          periodoVidaPolId,
          sesionIdDiagnostico,
          sesionHuellaSha256,
          repositorioCatalogoSenales,
          repositorioObservaciones,
          repositorioEstadoActual,
          repositorioReglasDerivacion,
          repositorioTrabajosEvaluacion,
          trabajosEncolados,
          conexion
        });
      }
      if (!replay && this.capturadorFederacionTelemetria) {
        await this.capturadorFederacionTelemetria.capturarIngestaEnTransaccion(
          construirSolicitudCapturaFederadaTelemetria({ agenteId, resultado }),
          { conexion }
        );
      }
      if (reserva?.nueva) {
        const resultadoEstable = extraerNucleoEstableResultado(resultado.resultado);
        await repositorioIdempotenciaLotes.confirmar({
          agenteId,
          telemetriaRequestId,
          tokenReserva: reserva.tokenReserva,
          resultadoEstable,
          recibidoEnUtc: resultadoEstable.recibidoEnUtc
        });
        resultado = {
          ...resultado,
          idempotencia: {
            telemetriaRequestId,
            replay: false
          }
        };
      }
      await conexion.commit();
    } catch (error) {
      await conexion.rollback();
      if (esConflictoTransaccionalReintentable(error) && intentoTransaccional < 2) {
        errorParaReintentar = error;
      } else {
        throw error;
      }
    } finally {
      conexion.release();
    }

    if (errorParaReintentar) {
      return this.ingestarLoteTransaccional({
        agenteId,
        lote,
        requestId,
        telemetriaRequestId,
        huellaLoteSha256,
        recibidoEnUtc,
        periodoVidaPolId,
        sesionIdDiagnostico,
        sesionHuellaSha256,
        autoridadRuntime,
        intentoTransaccional: intentoTransaccional + 1
      });
    }

    if (!replay) {
      await this.publicarAvisoEvaluacionSinAfectarIngesta(trabajosEncolados.length);
      await this.publicarInvalidacionesMonitoresSinAfectarIngesta(resultado);
    }
    return resultado;
  }

  async ingestarLoteConRepositorios({
    agenteId,
    lote,
    requestId = null,
    recibidoEnUtc = null,
    periodoVidaPolId = null,
    sesionIdDiagnostico = null,
    sesionHuellaSha256 = null,
    repositorioCatalogoSenales,
    repositorioObservaciones,
    repositorioEstadoActual = null,
    repositorioReglasDerivacion = null,
    repositorioTrabajosEvaluacion = null,
    trabajosEncolados = [],
    conexion = null,
    autoridad = AUTORIDADES_INGESTA_TELEMETRIA.AGENTE
  } = {}) {
    const preparacion = await this.prepararLote({
      agenteId,
      lote,
      requestId,
      recibidoEnUtc,
      repositorioCatalogoSenales,
      autoridad
    });
    const persistencia = await repositorioObservaciones.insertarLoteAceptado({
      agenteId,
      observacionesAceptadas: preparacion.observacionesAceptadas,
      observacionesRechazadas: preparacion.observacionesRechazadas,
      senalesCatalogadas: preparacion.senalesCatalogadas,
      emitidoEnUtc: preparacion.lote.emitidoEnUtc,
      recibidoEnUtc: preparacion.resultado.recibidoEnUtc,
      periodoVidaPolId,
      sesionIdDiagnostico,
      sesionHuellaSha256
    });
    const autoridadesRelativas = await bloquearAutoridadesRelativasDeLote({
      agenteId,
      observaciones: persistencia.insertadas,
      repositorioEstadoActual,
      repositorioReglasDerivacion,
      repositorioTrabajosEvaluacion,
      conexion
    });
    const fotografiaActual = repositorioEstadoActual
      ? await repositorioEstadoActual.aplicarObservacionesHistoricas(
          persistencia.insertadas
        )
      : null;
    await encolarEvaluacionesDerivadas({
      observaciones: persistencia.insertadas,
      repositorioReglasDerivacion,
      repositorioTrabajosEvaluacion,
      trabajosEncolados
    });
    await encolarEvaluacionesRelativasGobernantes({
      observaciones: persistencia.insertadas,
      fotografiaActual,
      autoridadesRelativas,
      repositorioTrabajosEvaluacion,
      trabajosEncolados,
      conexion
    });

    return {
      ...preparacion,
      persistencia: {
        totalInsertadas: persistencia.totalInsertadas,
        rechazosIgnorados: persistencia.rechazosIgnorados,
        fotografiaActual: fotografiaActual
          ? {
              procesadas: fotografiaActual.procesadas,
              creadas: fotografiaActual.creadas,
              actualizadas: fotografiaActual.actualizadas,
              ignoradas: fotografiaActual.ignoradas,
              fotografias: fotografiaActual.fotografias.map((fotografia) =>
                typeof fotografia?.serializar === 'function'
                  ? fotografia.serializar()
                  : fotografia
              )
            }
          : null,
        observaciones: persistencia.insertadas.map((observacion) =>
          typeof observacion.serializar === 'function'
            ? observacion.serializar()
            : observacion
        )
      }
    };
  }

  async publicarAvisoEvaluacionSinAfectarIngesta(totalTrabajos) {
    if (!this.publicadorAvisosEvaluacion || totalTrabajos <= 0) {
      return;
    }

    try {
      await this.publicadorAvisosEvaluacion.publicarTrabajosPendientes({
        totalTrabajos
      });
    } catch (_error) {
      // SQL conserva el trabajo durable. El Runtime también barre por cadencia.
    }
  }

  async publicarInvalidacionesMonitoresSinAfectarIngesta(resultado) {
    const fotografias = resultado?.persistencia?.fotografiaActual?.fotografias || [];
    if (!this.publicadorInvalidacionesMonitores || fotografias.length === 0) {
      return;
    }
    try {
      await this.publicadorInvalidacionesMonitores.publicarFotografiasActualizadas({
        fotografias
      });
    } catch (_error) {
      // La fotografía SQL ya es autoritativa y el scheduler reconciliará el monitor.
    }
  }

  async prepararLote({
    agenteId,
    lote,
    requestId = null,
    recibidoEnUtc = null,
    repositorioCatalogoSenales = this.repositorioCatalogoSenales,
    autoridad = AUTORIDADES_INGESTA_TELEMETRIA.AGENTE
  } = {}) {
    const agenteNormalizado = normalizarIdAgente(agenteId);
    const loteNormalizado = crearLoteTelemetriaAgente(lote);
    const recibido = recibidoEnUtc || this.reloj();
    asegurarAutoridadLoteTelemetria(loteNormalizado, { autoridad });
    if (autoridad === AUTORIDADES_INGESTA_TELEMETRIA.AGENTE) {
      asegurarEmitidoEnUtcParaObservacionesDiferidas({
        lote: loteNormalizado,
        recibidoEnUtc: recibido
      });
    }
    const declaradaEnUtc = loteNormalizado.emitidoEnUtc || recibido;
    const catalogoDeclarado = await this.aplicarCatalogoDeclarado({
      agenteId: agenteNormalizado,
      catalogo: loteNormalizado.catalogo,
      declaradaEnUtc,
      repositorioCatalogoSenales
    });
    const senalesCatalogadas = [...catalogoDeclarado.senalesCatalogadas];
    const senalesModificadas = [...catalogoDeclarado.senalesCatalogadas];
    const observacionesAceptadas = [];
    const observacionesRechazadas = [];
    const errores = [];

    for (const [indice, observacion] of loteNormalizado.observaciones.entries()) {
      try {
        const catalogoObservacion = await this.validarYAplicarCatalogoObservacion({
          agenteId: agenteNormalizado,
          observacion,
          declaradaEnUtc,
          repositorioCatalogoSenales
        });

        if (catalogoObservacion.senal) {
          senalesCatalogadas.push(catalogoObservacion.senal);
        }
        if (catalogoObservacion.modificada) {
          senalesModificadas.push(catalogoObservacion.senal);
        }

        observacionesAceptadas.push(observacion.serializar());
      } catch (error) {
        if (!esErrorCompatibilidadCatalogo(error)) {
          throw error;
        }

        observacionesRechazadas.push(observacion.serializar());
        errores.push({
          indice,
          code: CODIGO_ERROR_COMPATIBILIDAD_CATALOGO_TELEMETRIA,
          message: error.message,
          campo: `observaciones.${indice}.definicionSenal`
        });
      }
    }

    const senalesCatalogadasUnicas = deduplicarSenalesCatalogadas(senalesCatalogadas);
    const hayRechazos =
      observacionesRechazadas.length > 0 || catalogoDeclarado.errores.length > 0;
    const resultado = crearResultadoIngestaTelemetria({
      ok: !hayRechazos,
      resultado: resolverResultadoPreparacion({
        aceptadas: observacionesAceptadas.length,
        rechazadas: observacionesRechazadas.length,
        erroresCatalogo: catalogoDeclarado.errores.length
      }),
      requestId: requestId || this.generarRequestId(),
      recibidoEnUtc: recibido,
      serverTimeUtc: this.reloj(),
      aceptadas: observacionesAceptadas.length,
      rechazadas: observacionesRechazadas.length,
      errores,
      coordinacion: {
        agenteId: agenteNormalizado,
        senalesCatalogadas: senalesCatalogadasUnicas.length,
        catalogoDeclarado: {
          aceptadas: catalogoDeclarado.senalesCatalogadas.length,
          rechazadas: catalogoDeclarado.errores.length
        },
        erroresCatalogo: catalogoDeclarado.errores.map((error) => ({ ...error }))
      }
    });

    return {
      resultado: resultado.serializar(),
      lote: loteNormalizado.serializar(),
      observacionesAceptadas,
      observacionesRechazadas,
      senalesCatalogadas: senalesCatalogadasUnicas.map((senal) =>
        typeof senal.serializar === 'function' ? senal.serializar() : senal
      ),
      senalesModificadas: deduplicarSenalesCatalogadas(senalesModificadas).map((senal) =>
        typeof senal.serializar === 'function' ? senal.serializar() : senal
      ),
      erroresCatalogo: catalogoDeclarado.errores.map((error) => ({ ...error }))
    };
  }

  async aplicarCatalogoDeclarado({
    agenteId,
    catalogo,
    declaradaEnUtc,
    repositorioCatalogoSenales = this.repositorioCatalogoSenales
  }) {
    if (!catalogo) {
      return {
        senalesCatalogadas: [],
        errores: []
      };
    }

    const senalesCatalogadas = [];
    const errores = [];

    for (const [indice, definicion] of catalogo.senales.entries()) {
      try {
        senalesCatalogadas.push(
          await repositorioCatalogoSenales.guardarDeclaracionSenal({
            agenteId,
            definicion,
            declaradaEnUtc
          })
        );
      } catch (error) {
        if (!esErrorCompatibilidadCatalogo(error)) {
          throw error;
        }

        errores.push({
          indice,
          code: CODIGO_ERROR_COMPATIBILIDAD_CATALOGO_TELEMETRIA,
          message: error.message,
          campo: `catalogo.senales.${indice}`
        });
      }
    }

    return {
      senalesCatalogadas,
      errores
    };
  }

  async validarYAplicarCatalogoObservacion({
    agenteId,
    observacion,
    declaradaEnUtc,
    repositorioCatalogoSenales = this.repositorioCatalogoSenales
  }) {
    if (observacion.definicionSenal) {
      return {
        senal: await repositorioCatalogoSenales.guardarDeclaracionSenal({
          agenteId,
          definicion: observacion.definicionSenal,
          declaradaEnUtc
        }),
        modificada: true
      };
    }

    const existente = await repositorioCatalogoSenales.buscarPorIdentidad({
      agenteId,
      categoria: observacion.categoria,
      clave: observacion.clave,
      tag: observacion.tag
    });

    if (!existente) {
      return {
        senal: await repositorioCatalogoSenales.guardarDeclaracionSenal({
          agenteId,
          definicion: construirDefinicionDesdeObservacion(observacion),
          declaradaEnUtc
        }),
        modificada: true
      };
    }

    asegurarCompatibilidadObservacionCatalogada(observacion, existente);
    return { senal: existente, modificada: false };
  }
}

function asegurarEmitidoEnUtcParaObservacionesDiferidas({
  lote,
  recibidoEnUtc
}) {
  if (lote.emitidoEnUtc) {
    return;
  }

  const recibidoMs = new Date(recibidoEnUtc).getTime();
  const margenMs = MARGEN_OBSERVACION_VIVA_SEGUNDOS * 1000;
  const tieneObservacionDiferida = lote.observaciones.some((observacion) => {
    const observadoMs = new Date(observacion.observadoEnUtc).getTime();
    return recibidoMs - observadoMs > margenMs;
  });

  if (!tieneObservacionDiferida) {
    return;
  }

  const error = new Error(
    'emitidoEnUtc es obligatorio cuando el lote contiene observaciones diferidas.'
  );
  error.statusCode = 400;
  error.codigo = 'emitido_en_utc_requerido';
  throw error;
}

function normalizarIdAgente(valor) {
  const normalizado = Number.parseInt(String(valor ?? ''), 10);

  if (!Number.isInteger(normalizado) || normalizado <= 0) {
    throw new Error('El agente del lote de telemetría es obligatorio.');
  }

  return normalizado;
}

function asegurarCompatibilidadObservacionCatalogada(observacion, catalogada) {
  const unidadObservada = observacion.unidad || null;

  if (
    catalogada.tipoDato !== observacion.tipoDato ||
    catalogada.unidad !== unidadObservada
  ) {
    throw new ErrorCompatibilidadCatalogoTelemetria(
      'La observación reutiliza una señal existente con tipo de dato o unidad distinta.'
    );
  }
}

function construirDefinicionDesdeObservacion(observacion) {
  return {
    categoria: observacion.categoria,
    clave: observacion.clave,
    tag: observacion.tag,
    tipoDato: observacion.tipoDato,
    unidad: observacion.unidad
  };
}

function generarRequestIdTelemetria() {
  return `req_tel_${Date.now().toString(36)}_${Math.random()
    .toString(36)
    .slice(2, 10)}`;
}

function puedeUsarTransaccionCompartida({
  repositorioCatalogoSenales,
  repositorioObservaciones,
  repositorioEstadoActual = null,
  repositorioIdempotenciaLotes = null,
  repositorioReglasDerivacion = null,
  repositorioTrabajosEvaluacion = null
}) {
  const clienteSql = repositorioCatalogoSenales?.clienteSql;

  return Boolean(
    clienteSql &&
    clienteSql === repositorioObservaciones?.clienteSql &&
    (!repositorioEstadoActual || clienteSql === repositorioEstadoActual.clienteSql) &&
    (!repositorioIdempotenciaLotes ||
      clienteSql === repositorioIdempotenciaLotes.clienteSql) &&
    (!repositorioReglasDerivacion ||
      clienteSql === repositorioReglasDerivacion.clienteSql) &&
    (!repositorioTrabajosEvaluacion ||
      clienteSql === repositorioTrabajosEvaluacion.clienteSql) &&
    typeof clienteSql.obtenerConexion === 'function'
  );
}

function normalizarIdentidadIdempotenteOpcional({
  telemetriaRequestId,
  huellaLoteSha256
}) {
  const tieneRequestId = telemetriaRequestId != null && telemetriaRequestId !== '';
  const tieneHuella = huellaLoteSha256 != null;
  if (!tieneRequestId && !tieneHuella) {
    return null;
  }
  if (!tieneRequestId || !tieneHuella) {
    throw new Error(
      'telemetriaRequestId y la huella lógica deben declararse conjuntamente.'
    );
  }
  return { telemetriaRequestId, huellaLoteSha256 };
}

function extraerNucleoEstableResultado(resultado = {}) {
  return {
    ok: Boolean(resultado.ok),
    resultado: resultado.resultado,
    recibidoEnUtc: resultado.recibidoEnUtc,
    aceptadas: Number(resultado.aceptadas || 0),
    rechazadas: Number(resultado.rechazadas || 0),
    errores: Array.isArray(resultado.errores)
      ? resultado.errores.map((error) => ({ ...error }))
      : []
  };
}

function reconstruirResultadoReplay({
  resultadoEstable,
  requestId,
  serverTimeUtc,
  telemetriaRequestId
}) {
  const resultado = crearResultadoIngestaTelemetria({
    ...resultadoEstable,
    requestId,
    serverTimeUtc,
    recibidoEnUtc: resultadoEstable.recibidoEnUtc
  }).serializar();
  return {
    resultado,
    idempotencia: {
      telemetriaRequestId,
      replay: true
    }
  };
}

async function encolarEvaluacionesDerivadas({
  observaciones,
  repositorioReglasDerivacion,
  repositorioTrabajosEvaluacion,
  trabajosEncolados
}) {
  if (!repositorioReglasDerivacion || !repositorioTrabajosEvaluacion) {
    return;
  }

  const reglasPorSenalYFecha = new Map();
  for (const observacion of observaciones) {
    if (!observacion?.senalId) {
      continue;
    }

    const clave = `${observacion.senalId}:${new Date(observacion.recibidoEnUtc).toISOString()}`;
    let reglasAplicables = reglasPorSenalYFecha.get(clave);
    if (!reglasAplicables) {
      reglasAplicables = await repositorioReglasDerivacion.listarActivasPorSenalEn({
        senalId: observacion.senalId,
        recibidoEnUtc: observacion.recibidoEnUtc
      });
      reglasPorSenalYFecha.set(clave, reglasAplicables);
    }

    for (const aplicable of reglasAplicables) {
      const resultado = await repositorioTrabajosEvaluacion.encolar({
        observacion,
        regla: aplicable.regla,
        revision: aplicable.revisionAplicable
      });
      if (resultado.trabajo) {
        trabajosEncolados.push(resultado.trabajo);
      }
    }
  }
}

async function bloquearAutoridadesRelativasDeLote({
  agenteId,
  observaciones,
  repositorioEstadoActual,
  repositorioReglasDerivacion,
  repositorioTrabajosEvaluacion,
  conexion
}) {
  if (!repositorioReglasDerivacion || !repositorioTrabajosEvaluacion) return [];
  if (typeof repositorioReglasDerivacion
    .bloquearRelativasActivasVigentesPorSenalesEnTransaccion !== 'function') {
    return [];
  }
  if (!conexion) {
    throw new Error('La autoridad relativa de ingesta exige una transacción SQL.');
  }
  const senalIds = [...new Set(observaciones
    .map((observacion) => Number(observacion?.senalId))
    .filter((senalId) => Number.isInteger(senalId) && senalId > 0))];
  if (senalIds.length === 0) return [];
  const autoridades = await repositorioReglasDerivacion
    .bloquearRelativasActivasVigentesPorSenalesEnTransaccion(
      { agenteId, senalIds },
      { conexion }
    );
  if (autoridades.length > 0 && !repositorioEstadoActual) {
    throw new Error('Una regla relativa exige fotografía SQL autoritativa.');
  }
  return autoridades;
}

async function encolarEvaluacionesRelativasGobernantes({
  observaciones,
  fotografiaActual,
  autoridadesRelativas,
  repositorioTrabajosEvaluacion,
  trabajosEncolados,
  conexion
}) {
  if (autoridadesRelativas.length === 0) return;
  const observacionesPorId = new Map(observaciones.map((observacion) => [
    Number(observacion?.id),
    observacion
  ]));
  const ganadorasPorSenal = new Map();
  for (const fotografia of fotografiaActual?.fotografias || []) {
    const observacion = observacionesPorId.get(Number(fotografia?.ultimaObservacionId));
    if (observacion) {
      ganadorasPorSenal.set(Number(fotografia.senalId), observacion);
    }
  }

  for (const autoridad of autoridadesRelativas) {
    const observacion = ganadorasPorSenal.get(Number(autoridad.regla.senalId));
    if (!observacion) continue;
    const resultado = await repositorioTrabajosEvaluacion
      .encolarAutoridadActualEnTransaccion({
        observacion,
        regla: autoridad.regla,
        revision: autoridad.revision,
        generacionAutoridad: autoridad.regla.generacionAutoridad
      }, { conexion });
    if (resultado.creado && resultado.trabajo) {
      trabajosEncolados.push(resultado.trabajo);
    }
  }
}

function esErrorCompatibilidadCatalogo(error) {
  return error?.code === CODIGO_ERROR_COMPATIBILIDAD_CATALOGO_TELEMETRIA;
}

function esConflictoTransaccionalReintentable(error) {
  return ['ER_CHECKREAD', 'ER_LOCK_DEADLOCK', 'ER_LOCK_WAIT_TIMEOUT']
    .includes(error?.code);
}

function resolverResultadoPreparacion({
  aceptadas,
  rechazadas,
  erroresCatalogo
}) {
  if (rechazadas > 0 && aceptadas > 0) {
    return 'parcial';
  }

  if (rechazadas > 0) {
    return 'rechazado';
  }

  if (erroresCatalogo > 0 && aceptadas > 0) {
    return 'parcial';
  }

  if (erroresCatalogo > 0) {
    return 'rechazado';
  }

  return 'aceptado';
}

function deduplicarSenalesCatalogadas(senales = []) {
  const resultado = [];
  const vistas = new Set();

  for (const senal of senales) {
    const serializada = typeof senal?.serializar === 'function'
      ? senal.serializar()
      : senal;
    const identidad = [
      serializada?.agenteId ?? '',
      serializada?.categoria ?? '',
      serializada?.clave ?? '',
      serializada?.tag ?? ''
    ].join('\u0000');

    if (vistas.has(identidad)) {
      continue;
    }

    vistas.add(identidad);
    resultado.push(senal);
  }

  return resultado;
}

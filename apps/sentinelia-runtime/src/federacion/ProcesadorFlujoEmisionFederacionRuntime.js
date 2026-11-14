import {
  ERRORES_TEMPORALES_FEDERACION,
  ERRORES_TERMINALES_FEDERACION,
  FAMILIAS_FEDERACION,
  RESULTADOS_OCURRENCIA_FEDERACION,
  VERSION_PROTOCOLO_FEDERACION
} from '../../../../paquetes/federacion/src/CatalogosFederacion.js';
import {
  LIMITES_DUROS_RECURSOS_FEDERACION
} from '../../../../paquetes/federacion/src/ConfiguracionFederacion.js';
import { planificarLotesFederacion } from '../../../../paquetes/federacion/src/PlanificacionLotesFederacion.js';
import { TIPOS_IDENTIDAD_FEDERADA } from '../../../../paquetes/federacion/src/IdentidadFederada.js';

const MAX_REAGRUPACIONES_RESPUESTA = 16;
const ERRORES_RESPUESTA_REAGRUPABLES = new Set([
  'respuesta_federada_invalida',
  'resultados_federados_invalidos',
  'timeout_transporte_federado'
]);

export class ProcesadorFlujoEmisionFederacionRuntime {
  constructor({
    repositorioCoordinacion,
    repositorioOcurrencias,
    servicioCliente,
    gestorSesiones,
    generadorIdentidades,
    repositorioProcedencia = null,
    resolverActivacion = async () => true,
    reintentoBaseSegundos = 2,
    reintentoMaximoSegundos = 300,
    aleatorio = Math.random
  } = {}) {
    exigirMetodo(repositorioCoordinacion, 'prepararCandidatos', 'repositorioCoordinacion');
    exigirMetodo(repositorioCoordinacion, 'aplicarResultados', 'repositorioCoordinacion');
    exigirMetodo(repositorioOcurrencias, 'buscarOcurrenciaPorIdentidad', 'repositorioOcurrencias');
    exigirMetodo(servicioCliente, 'obtenerCapacidad', 'servicioCliente');
    exigirMetodo(servicioCliente, 'entregarLote', 'servicioCliente');
    exigirMetodo(gestorSesiones, 'obtenerToken', 'gestorSesiones');
    exigirMetodo(generadorIdentidades, 'generar', 'generadorIdentidades');
    if (typeof resolverActivacion !== 'function') {
      throw new Error('resolverActivacion debe ser una función.');
    }
    if (typeof aleatorio !== 'function') throw new Error('aleatorio debe ser una función.');
    this.repositorioCoordinacion = repositorioCoordinacion;
    this.repositorioOcurrencias = repositorioOcurrencias;
    this.servicioCliente = servicioCliente;
    this.gestorSesiones = gestorSesiones;
    this.generadorIdentidades = generadorIdentidades;
    if (repositorioProcedencia !== null) {
      exigirMetodo(repositorioProcedencia, 'resolverParaLote', 'repositorioProcedencia');
    }
    this.repositorioProcedencia = repositorioProcedencia;
    this.resolverActivacion = resolverActivacion;
    this.reintentoBaseSegundos = enteroAcotado(
      reintentoBaseSegundos, 1, 3600, 'reintentoBaseSegundos'
    );
    this.reintentoMaximoSegundos = enteroAcotado(
      reintentoMaximoSegundos,
      this.reintentoBaseSegundos,
      86400,
      'reintentoMaximoSegundos'
    );
    this.aleatorio = aleatorio;
  }

  async procesar({ lease, flujo, intentos = 1, renovar, exigirVigente }) {
    if (!await this.resolverActivacion()) {
      return Object.freeze({ omitido: true, motivo: 'federacion_desactivada' });
    }
    await renovar();
    const referencias = await this.repositorioCoordinacion.prepararCandidatos(
      lease,
      {
        limite: 5000,
        generarEntregaId: () => this.generadorIdentidades.generar(
          TIPOS_IDENTIDAD_FEDERADA.ENTREGA
        )
      }
    );
    const candidatos = [];
    for (const referencia of referencias) {
      const ocurrencia = await this.repositorioOcurrencias.buscarOcurrenciaPorIdentidad(
        referencia.identidadOcurrencia
      );
      if (!ocurrencia) {
        const error = new Error('La outbox referencia una ocurrencia local inexistente.');
        error.codigo = 'ocurrencia_outbox_no_recuperable';
        throw error;
      }
      candidatos.push({
        entregaId: referencia.entregaId,
        posicionFlujo: referencia.posicionFlujo,
        prioridad: referencia.prioridad,
        intentos: referencia.intentos,
        ocurrencia: typeof ocurrencia.toJSON === 'function'
          ? ocurrencia.toJSON()
          : ocurrencia
      });
    }
    if (candidatos.length === 0) return Object.freeze({ totalLotes: 0 });
    const metadatosProcedencia = this.repositorioProcedencia
      ? await this.repositorioProcedencia.resolverParaLote({
        relacionId: flujo.relacionId,
        flujoId: flujo.flujoId,
        generacionId: flujo.generacionId,
        candidatos
      })
      : null;
    exigirMetadatosProcedencia(metadatosProcedencia, candidatos, {
      obligatorios: this.repositorioProcedencia !== null
    });
    let token;
    let capacidad;
    try {
      token = await this.gestorSesiones.obtenerToken({ relacionId: flujo.relacionId });
      capacidad = validarCapacidad(await this.servicioCliente.obtenerCapacidad({
        relacionId: flujo.relacionId,
        token
      }), flujo);
    } catch (error) {
      await invalidarSesionRechazada(this.gestorSesiones, {
        error, relacionId: flujo.relacionId, token
      });
      if (!error?.reintentable ||
          typeof this.repositorioCoordinacion.pausarFlujo !== 'function') throw error;
      const demora = this.#demora(intentos);
      await this.repositorioCoordinacion.pausarFlujo(lease, {
        causa: codigoTransporte(error), demoraReintentoSegundos: demora
      });
      return Object.freeze({ pausado: true, demoraReintentoSegundos: demora,
        motivo: codigoTransporte(error), totalLotes: 0 });
    }
    const candidatosConProcedencia = candidatos.map((candidato) => ({
      ...candidato,
      ocurrencia: metadatosProcedencia === null
        ? candidato.ocurrencia
        : metadatosProcedencia.ocurrenciasAutorizadas.get(candidato.entregaId),
      procedencia: metadatosProcedencia?.procedencias.get(candidato.entregaId) ?? null
    }));
    const plan = planificarLotesFederacion({
      relacionId: flujo.relacionId,
      flujoId: flujo.flujoId,
      generacionId: flujo.generacionId,
      revisionConcesionEfectiva:
        metadatosProcedencia?.revisionConcesionEfectiva ?? null,
      candidatos: candidatosConProcedencia,
      capacidad,
      generarLoteId: () => this.generadorIdentidades.generar(
        TIPOS_IDENTIDAD_FEDERADA.LOTE
      )
    });
    if (plan.excedidas.length > 0) {
      await this.repositorioCoordinacion.aplicarResultados(lease, {
        resultados: plan.excedidas.map((excedida) => ({
          entregaId: excedida.entregaId,
          bloqueadaLocalmente: true,
          errorTerminal: excedida.errorTerminal
        }))
      });
    }
    let totalTerminales = plan.excedidas.length;
    let totalTemporales = 0;
    let totalReagrupaciones = 0;
    let totalLotesEnviados = 0;
    let pausado = false;
    const lotesPendientes = [...plan.lotes];
    while (lotesPendientes.length > 0) {
      let lote = lotesPendientes.shift();
      await renovar();
      if (this.repositorioProcedencia !== null) {
        const actuales = await this.repositorioProcedencia.resolverParaLote({
          relacionId: flujo.relacionId,
          flujoId: flujo.flujoId,
          generacionId: flujo.generacionId,
          candidatos: lote.entregas
        });
        exigirMetadatosProcedencia(actuales, lote.entregas, { obligatorios: true });
        lote = {
          ...lote,
          revisionConcesionEfectiva: actuales.revisionConcesionEfectiva,
          entregas: lote.entregas.map((entrega) => ({
            ...entrega,
            ocurrencia: actuales.ocurrenciasAutorizadas.get(entrega.entregaId),
            procedencia: actuales.procedencias.get(entrega.entregaId)
          }))
        };
      }
      let respuesta;
      let resultados;
      try {
        respuesta = await this.servicioCliente.entregarLote({
          relacionId: flujo.relacionId,
          token,
          lote: serializarLote(lote)
        });
        totalLotesEnviados += 1;
        resultados = validarResultadosRemotos(respuesta, lote);
      } catch (error) {
        await invalidarSesionRechazada(this.gestorSesiones, {
          error, relacionId: flujo.relacionId, token
        });
        if (error?.statusCode === 413 && error.capacidad &&
            totalReagrupaciones < 16) {
          let capacidadAdaptada;
          try {
            capacidadAdaptada = adaptarCapacidad(capacidad, error.capacidad);
          } catch (errorAdaptacion) {
            if (!errorAdaptacion?.reintentable ||
                typeof this.repositorioCoordinacion.aplazarEntregas !== 'function') {
              throw errorAdaptacion;
            }
            const demora = this.#demora(maximoIntentos(lote));
            await this.repositorioCoordinacion.aplazarEntregas(lease, {
              entregaIds: lote.entregas.map((entrega) => entrega.entregaId),
              codigoTransporte: codigoTransporte(errorAdaptacion),
              demoraReintentoSegundos: demora
            });
            pausado = true;
            break;
          }
          if (typeof this.repositorioCoordinacion
            .registrarReagrupacionPorCapacidad === 'function') {
            await this.repositorioCoordinacion.registrarReagrupacionPorCapacidad(
              lease,
              { entregaIds: lote.entregas.map((entrega) => entrega.entregaId) }
            );
          }
          const replanteado = planificarLotesFederacion({
            relacionId: flujo.relacionId,
            flujoId: flujo.flujoId,
            generacionId: flujo.generacionId,
            revisionConcesionEfectiva: lote.revisionConcesionEfectiva,
            candidatos: lote.entregas.map((entrega) => ({
              ...entrega,
              intentos: entrega.intentos + 1,
              prioridad: lote.prioridad
            })),
            capacidad: capacidadAdaptada,
            generarLoteId: () => this.generadorIdentidades.generar(
              TIPOS_IDENTIDAD_FEDERADA.LOTE
            )
          });
          if (replanteado.excedidas.length > 0) {
            await this.repositorioCoordinacion.aplicarResultados(lease, {
              resultados: replanteado.excedidas.map((excedida) => ({
                entregaId: excedida.entregaId,
                bloqueadaLocalmente: true,
                errorTerminal: excedida.errorTerminal
              }))
            });
            totalTerminales += replanteado.excedidas.length;
          }
          lotesPendientes.unshift(...replanteado.lotes);
          capacidad = capacidadAdaptada;
          totalReagrupaciones += 1;
          continue;
        }
        const respuestaReagrupable = esRespuestaReagrupable(error);
        if (respuestaReagrupable && lote.entregas.length > 1 &&
            totalReagrupaciones < MAX_REAGRUPACIONES_RESPUESTA) {
          if (typeof this.repositorioCoordinacion
            .registrarReagrupacionPorRespuesta === 'function') {
            await this.repositorioCoordinacion.registrarReagrupacionPorRespuesta(
              lease,
              {
                entregaIds: lote.entregas.map((entrega) => entrega.entregaId),
                codigoTransporte: codigoTransporte(error)
              }
            );
          }
          const reagrupados = reagruparLotePorRespuesta({
            lote,
            capacidad,
            generarLoteId: () => this.generadorIdentidades.generar(
              TIPOS_IDENTIDAD_FEDERADA.LOTE
            )
          });
          lotesPendientes.unshift(...reagrupados);
          totalReagrupaciones += 1;
          continue;
        }
        if (!error?.reintentable ||
            typeof this.repositorioCoordinacion.aplazarEntregas !== 'function') {
          throw error;
        }
        const demora = this.#demora(maximoIntentos(lote));
        await this.repositorioCoordinacion.aplazarEntregas(lease, {
          entregaIds: lote.entregas.map((entrega) => entrega.entregaId),
          codigoTransporte: codigoTransporte(error),
          demoraReintentoSegundos: demora
        });
        pausado = true;
        if (respuestaReagrupable && lote.reagrupadoPorRespuesta === true &&
            lote.entregas.length === 1) {
          continue;
        }
        break;
      }
      await exigirVigente();
      const demora = this.#demora(maximoIntentos(lote));
      await this.repositorioCoordinacion.aplicarResultados(lease, {
        resultados,
        progreso: respuesta.progreso || null,
        demoraReintentoSegundos: demora
      });
      totalTerminales += resultados.filter((r) => r.clasificacion === 'terminal').length;
      totalTemporales += resultados.filter((r) => r.clasificacion === 'temporal').length;
      if (resultados.some((resultado) => resultado.clasificacion === 'temporal')) {
        pausado = true;
        break;
      }
    }
    return Object.freeze({
      totalLotes: plan.lotes.length,
      totalLotesEnviados,
      totalCandidatos: candidatos.length,
      totalTerminales,
      totalTemporales,
      totalExcedidas: plan.excedidas.length,
      totalReagrupaciones,
      pausado
    });
  }

  #demora(intentos) {
    const exponente = Math.min(Math.max(Number(intentos) - 1, 0), 16);
    const base = Math.min(
      this.reintentoMaximoSegundos,
      this.reintentoBaseSegundos * (2 ** exponente)
    );
    const muestra = Number(this.aleatorio());
    const jitter = Number.isFinite(muestra) && muestra >= 0 && muestra < 1
      ? 0.75 + muestra * 0.5
      : 1;
    return Math.max(1, Math.min(
      this.reintentoMaximoSegundos,
      Math.round(base * jitter)
    ));
  }
}

async function invalidarSesionRechazada(gestorSesiones, { error, relacionId, token }) {
  if (!esRechazoAutenticacion(error) ||
      typeof gestorSesiones?.invalidar !== 'function') return false;
  try {
    return await gestorSesiones.invalidar({ relacionId, token });
  } catch {
    return false;
  }
}

function esRechazoAutenticacion(error) {
  return error?.statusCode === 401 || error?.statusCode === 403 ||
    ['sesion_federada_no_viva', 'autenticacion_federada_rechazada']
      .includes(String(error?.codigoRemoto || '').toLowerCase());
}

function adaptarCapacidad(actual, entrada) {
  if (!validarCapacidadAplicada(entrada)) {
    const error = new Error('El 413 no aportó una capacidad aplicada interpretable.');
    error.codigo = 'capacidad_413_invalida';
    error.reintentable = true;
    throw error;
  }
  const propuesta = {
    maximoOcurrenciasPorLote: enteroAcotado(
      entrada.maximoOcurrenciasPorLote, 1, 5000, 'maximoOcurrenciasPorLote'
    ),
    maximoBytesPorLote: enteroAcotado(
      entrada.maximoBytesPorLote, 1, 16 * 1024 * 1024, 'maximoBytesPorLote'
    ),
    maximoBytesPorOcurrencia: enteroAcotado(
      entrada.maximoBytesPorOcurrencia, 1, 2 * 1024 * 1024,
      'maximoBytesPorOcurrencia'
    )
  };
  const adaptada = Object.fromEntries(Object.keys(propuesta).map((clave) => [
    clave, Math.min(actual[clave], propuesta[clave])
  ]));
  if (Object.keys(adaptada).every((clave) => adaptada[clave] === actual[clave])) {
    const error = new Error('El 413 no aportó límites más restrictivos para reagrupar.');
    error.codigo = 'capacidad_413_no_adaptativa';
    throw error;
  }
  return adaptada;
}

function maximoIntentos(lote) {
  return Math.max(1, ...lote.entregas.map((entrega) =>
    Number.isInteger(entrega.intentos) ? entrega.intentos + 1 : 1));
}

function codigoTransporte(error) {
  const saneado = String(
    error?.codigoDiagnostico || error?.codigo || 'transporte_federado_no_disponible'
  )
    .toLowerCase().replace(/[^a-z0-9_.-]+/gu, '_').slice(0, 64);
  return /^[a-z][a-z0-9_.-]{0,63}$/u.test(saneado)
    ? saneado
    : 'transporte_federado_no_disponible';
}

function esRespuestaReagrupable(error) {
  return error?.reintentable === true &&
    ERRORES_RESPUESTA_REAGRUPABLES.has(String(error?.codigo || ''));
}

function reagruparLotePorRespuesta({ lote, capacidad, generarLoteId }) {
  const maximoOcurrenciasPorLote = Math.max(
    1,
    Math.ceil(lote.entregas.length / 2)
  );
  const replanteado = planificarLotesFederacion({
    relacionId: lote.relacionId,
    flujoId: lote.flujoId,
    generacionId: lote.generacionId,
    revisionConcesionEfectiva: lote.revisionConcesionEfectiva,
    candidatos: lote.entregas.map((entrega) => ({
      ...entrega,
      intentos: entrega.intentos + 1,
      prioridad: lote.prioridad
    })),
    capacidad: {
      ...capacidad,
      maximoOcurrenciasPorLote: Math.min(
        capacidad.maximoOcurrenciasPorLote,
        maximoOcurrenciasPorLote
      )
    },
    generarLoteId
  });
  if (replanteado.excedidas.length > 0 || replanteado.lotes.length < 2) {
    throw new Error('La reagrupación adaptativa no pudo reducir el lote federado.');
  }
  return replanteado.lotes.map((subLote) => Object.freeze({
    ...subLote,
    reagrupadoPorRespuesta: true
  }));
}

function validarCapacidad(entrada, flujo) {
  const familias = entrada?.familiasSoportadas;
  const versiones = entrada?.versionesFamilia;
  const formaValida = clavesExactas(entrada, [
    'capacidadTemporalOcurrencias', 'disponible', 'familiasSoportadas',
    'maximoBytesPorLote', 'maximoBytesPorOcurrencia', 'maximoOcurrenciasPorLote',
    'perfil', 'prioridadOperativaActual', 'protocoloVersion',
    'toleranciaTemporalMs', 'versionesFamilia'
  ]) && Array.isArray(familias) && familias.length > 0 &&
    new Set(familias).size === familias.length &&
    familias.every((familia) => FAMILIAS_FEDERACION.valores.includes(familia)) &&
    versiones && typeof versiones === 'object' && !Array.isArray(versiones) &&
    Object.getPrototypeOf(versiones) === Object.prototype &&
    Object.keys(versiones).length === familias.length &&
    familias.every((familia) => Number.isSafeInteger(versiones[familia]) &&
      versiones[familia] >= 1) &&
    enteroEnRango(entrada.maximoOcurrenciasPorLote, 1,
      LIMITES_DUROS_RECURSOS_FEDERACION.loteMaximoOcurrencias) &&
    enteroEnRango(entrada.maximoBytesPorLote, 1024,
      LIMITES_DUROS_RECURSOS_FEDERACION.loteMaximoBytes) &&
    enteroEnRango(entrada.maximoBytesPorOcurrencia, 512,
      LIMITES_DUROS_RECURSOS_FEDERACION.ocurrenciaMaximaBytes) &&
    enteroEnRango(entrada.capacidadTemporalOcurrencias, 0, 100000) &&
    enteroEnRango(entrada.toleranciaTemporalMs, 0, 300000) &&
    typeof entrada.disponible === 'boolean' &&
    typeof entrada.prioridadOperativaActual === 'boolean';
  if (!formaValida) {
    throw errorCapacidad(
      'respuesta_capacidad_federada_invalida',
      'El receptor devolvió una declaración de capacidad no interpretable.'
    );
  }
  if (entrada.perfil !== 'sentinelia-federacion-capacidad-receptora-v1' ||
      entrada.protocoloVersion !== VERSION_PROTOCOLO_FEDERACION ||
      entrada.prioridadOperativaActual !== true ||
      !familias.includes(flujo.familia) ||
      versiones[flujo.familia] !== flujo.versionFamilia) {
    throw errorCapacidad(
      'capacidad_federada_no_compatible',
      'El receptor no declara capacidad compatible para el flujo.'
    );
  }
  if (!entrada.disponible) {
    throw errorCapacidad(
      'capacidad_federada_temporalmente_no_disponible',
      'El receptor declara temporalmente detenida la recepción.'
    );
  }
  return {
    maximoOcurrenciasPorLote: entrada.maximoOcurrenciasPorLote,
    maximoBytesPorLote: entrada.maximoBytesPorLote,
    maximoBytesPorOcurrencia: entrada.maximoBytesPorOcurrencia
  };
}

function errorCapacidad(codigo, mensaje) {
  const error = new Error(mensaje);
  error.codigo = codigo;
  error.reintentable = true;
  return error;
}

function enteroEnRango(valor, minimo, maximo) {
  return Number.isSafeInteger(valor) && valor >= minimo && valor <= maximo;
}

function clavesExactas(valor, claves) {
  if (!valor || typeof valor !== 'object' || Array.isArray(valor)) return false;
  const observadas = Object.keys(valor).sort();
  const esperadas = [...claves].sort();
  return observadas.length === esperadas.length &&
    observadas.every((clave, indice) => clave === esperadas[indice]);
}

function validarResultadosRemotos(respuesta, lote) {
  if (!clavesExactas(respuesta, [
    'capacidad', 'clase', 'estado', 'intentoId', 'loteId', 'numeroIntento',
    'persistidoDurablemente', 'progreso', 'resultados'
  ]) || respuesta.persistidoDurablemente !== true || respuesta.loteId !== lote.loteId ||
      !decimalCanonico(respuesta.intentoId, false) ||
      !decimalCanonico(respuesta.numeroIntento, false) ||
      !['inicial', 'reintento', 'replayTerminal'].includes(respuesta.clase) ||
      !['terminal', 'parcialTemporal'].includes(respuesta.estado) ||
      !validarCapacidadAplicada(respuesta.capacidad) ||
      !Array.isArray(respuesta.resultados)) {
    throw errorRespuesta('envolvente_respuesta');
  }
  validarProgresoRemoto(respuesta.progreso, lote);
  const esperadas = new Map(lote.entregas.map((entrega) => [
    entrega.entregaId, entrega
  ]));
  if (respuesta.resultados.length !== esperadas.size) {
    throw errorRespuesta('cantidad_resultados');
  }
  const observadas = new Set();
  const resultados = respuesta.resultados.map((entrada) => {
    const esperada = esperadas.get(entrada?.entregaId);
    if (!clavesExactas(entrada, [
      'clasificacion', 'confirmada', 'entregaId', 'errorTemporal', 'errorTerminal',
      'persistidoDurablemente', 'posicionFlujo', 'resultado', 'reutilizado'
    ]) || !esperada || observadas.has(entrada.entregaId) ||
        entrada.posicionFlujo !== esperada.posicionFlujo ||
        entrada.persistidoDurablemente !== true ||
        typeof entrada.confirmada !== 'boolean' ||
        typeof entrada.reutilizado !== 'boolean' ||
        !['terminal', 'temporal'].includes(entrada.clasificacion)) {
      throw errorRespuesta('identidad_resultado');
    }
    observadas.add(entrada.entregaId);
    const resultado = exigirCatalogoRespuesta(
      RESULTADOS_OCURRENCIA_FEDERACION,
      entrada.resultado
    );
    const errorTerminal = entrada.errorTerminal == null ? null :
      exigirCatalogoRespuesta(ERRORES_TERMINALES_FEDERACION, entrada.errorTerminal);
    const errorTemporal = entrada.errorTemporal == null ? null :
      exigirCatalogoRespuesta(ERRORES_TEMPORALES_FEDERACION, entrada.errorTemporal);
    if ((entrada.clasificacion === 'terminal' && errorTemporal !== null) ||
        (entrada.clasificacion === 'temporal' && errorTerminal !== null) ||
        (entrada.clasificacion === 'terminal' &&
          ['aplazadaCapacidad', 'aplazadaValidacion'].includes(resultado)) ||
        (entrada.clasificacion === 'temporal' &&
          (!['aplazadaCapacidad', 'aplazadaValidacion'].includes(resultado) ||
            errorTemporal === null)) ||
        (entrada.clasificacion === 'temporal' &&
          (entrada.confirmada || entrada.reutilizado)) ||
        (entrada.confirmada && ![
          'aceptada', 'yaConocida', 'retiradaAceptada', 'salidaAceptada',
          'descartadaPorRetencion'
        ].includes(resultado))) {
      throw errorRespuesta('semantica_resultado');
    }
    return { entregaId: entrada.entregaId, clasificacion: entrada.clasificacion,
      resultado, errorTerminal, errorTemporal };
  });
  const contieneTemporal = resultados.some((resultado) =>
    resultado.clasificacion === 'temporal');
  if (respuesta.estado !== (contieneTemporal ? 'parcialTemporal' : 'terminal')) {
    throw errorRespuesta('estado_lote');
  }
  return resultados;
}

function validarProgresoRemoto(progreso, lote) {
  if (!clavesExactas(progreso, [
    'flujoId', 'fronteraInicial', 'fronteraInicialDegradada',
    'fronteraInicialRecorrida', 'generacionId', 'posicionTerminalContigua',
    'prefijoDegradado', 'rangosTerminalesDispersos', 'version'
  ]) || progreso.flujoId !== lote.flujoId ||
      progreso.generacionId !== lote.generacionId ||
      !decimalCanonico(progreso.posicionTerminalContigua, true) ||
      !decimalCanonico(progreso.fronteraInicial, true) ||
      !decimalCanonico(progreso.version, false) ||
      typeof progreso.fronteraInicialRecorrida !== 'boolean' ||
      typeof progreso.fronteraInicialDegradada !== 'boolean' ||
      typeof progreso.prefijoDegradado !== 'boolean' ||
      !Array.isArray(progreso.rangosTerminalesDispersos) ||
      !progreso.rangosTerminalesDispersos.every(validarRangoTerminal)) {
    throw errorRespuesta('progreso_remoto');
  }
}

function validarRangoTerminal(rango) {
  return clavesExactas(rango, ['contieneDegradacion', 'fin', 'inicio']) &&
    decimalCanonico(rango.inicio, false) && decimalCanonico(rango.fin, false) &&
    BigInt(rango.inicio) <= BigInt(rango.fin) &&
    typeof rango.contieneDegradacion === 'boolean';
}

function validarCapacidadAplicada(capacidad) {
  if (!clavesExactas(capacidad, [
    'capacidadTemporalOcurrencias', 'disponible', 'familiasSoportadas',
    'maximoBytesPorLote', 'maximoBytesPorOcurrencia', 'maximoOcurrenciasPorLote',
    'versionConfiguracion', 'versionesFamilia'
  ]) || !decimalCanonico(capacidad.versionConfiguracion, true) ||
      typeof capacidad.disponible !== 'boolean' ||
      !enteroEnRango(capacidad.maximoOcurrenciasPorLote, 1,
        LIMITES_DUROS_RECURSOS_FEDERACION.loteMaximoOcurrencias) ||
      !enteroEnRango(capacidad.maximoBytesPorLote, 1024,
        LIMITES_DUROS_RECURSOS_FEDERACION.loteMaximoBytes) ||
      !enteroEnRango(capacidad.maximoBytesPorOcurrencia, 512,
        LIMITES_DUROS_RECURSOS_FEDERACION.ocurrenciaMaximaBytes) ||
      !enteroEnRango(capacidad.capacidadTemporalOcurrencias, 0, 100000)) return false;
  if (capacidad.familiasSoportadas === null || capacidad.versionesFamilia === null) {
    return capacidad.familiasSoportadas === null && capacidad.versionesFamilia === null;
  }
  return Array.isArray(capacidad.familiasSoportadas) &&
    capacidad.versionesFamilia && typeof capacidad.versionesFamilia === 'object' &&
    !Array.isArray(capacidad.versionesFamilia) &&
    new Set(capacidad.familiasSoportadas).size === capacidad.familiasSoportadas.length &&
    capacidad.familiasSoportadas.every((familia) =>
      FAMILIAS_FEDERACION.valores.includes(familia) &&
      Number.isSafeInteger(capacidad.versionesFamilia[familia]) &&
      capacidad.versionesFamilia[familia] >= 1) &&
    Object.keys(capacidad.versionesFamilia).length ===
      capacidad.familiasSoportadas.length;
}

function decimalCanonico(valor, admiteCero) {
  const patron = admiteCero ? /^(0|[1-9][0-9]*)$/u : /^[1-9][0-9]*$/u;
  return typeof valor === 'string' && patron.test(valor) &&
    BigInt(valor) <= 18_446_744_073_709_551_615n;
}

function serializarLote(lote) {
  return {
    loteId: lote.loteId,
    relacionId: lote.relacionId,
    flujoId: lote.flujoId,
    generacionId: lote.generacionId,
    ...(lote.revisionConcesionEfectiva === null
      ? {}
      : { revisionConcesionEfectiva: lote.revisionConcesionEfectiva }),
    entregas: lote.entregas.map((entrega) => ({
      entregaId: entrega.entregaId,
      posicionFlujo: entrega.posicionFlujo,
      ocurrencia: entrega.ocurrencia,
      ...(entrega.procedencia === null
        ? {}
        : { procedencia: entrega.procedencia })
    }))
  };
}

function errorRespuesta(causa = 'desconocida') {
  const error = new Error('El receptor devolvió resultados parciales incoherentes.');
  error.codigo = 'resultados_federados_invalidos';
  error.codigoDiagnostico = `resultados_federados_invalidos.${causa}`;
  error.reintentable = true;
  return error;
}

function exigirCatalogoRespuesta(catalogo, valor) {
  try {
    return catalogo.exigir(valor);
  } catch {
    throw errorRespuesta('catalogo_resultado');
  }
}

function exigirMetodo(valor, metodo, campo) {
  if (typeof valor?.[metodo] !== 'function') throw new Error(`${campo} requiere ${metodo}().`);
}

function exigirMetadatosProcedencia(metadatos, candidatos, { obligatorios }) {
  if (!obligatorios) return;
  if (!metadatos?.revisionConcesionEfectiva ||
      !(metadatos.procedencias instanceof Map) ||
      !(metadatos.ocurrenciasAutorizadas instanceof Map) ||
      candidatos.some((candidato) =>
        !metadatos.procedencias.has(candidato.entregaId) ||
        !metadatos.ocurrenciasAutorizadas.has(candidato.entregaId))) {
    const error = new Error(
      'La procedencia no devolvió una vista autorizada completa de cada ocurrencia.'
    );
    error.codigo = 'metadatos_procedencia_incompletos';
    throw error;
  }
}

function enteroAcotado(valor, minimo, maximo, campo) {
  const numero = Number(valor);
  if (!Number.isInteger(numero) || numero < minimo || numero > maximo) {
    throw new Error(`${campo} debe estar entre ${minimo} y ${maximo}.`);
  }
  return numero;
}

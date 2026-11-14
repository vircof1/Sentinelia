import { createHash } from 'node:crypto';
import {
  evaluarExpresionMonitorLogico
} from '../../../../paquetes/monitores/src/AnalizadorExpresionMonitorLogico.js';
import {
  normalizarDependenciasMonitorLogico
} from '../../../../paquetes/monitores/src/DependenciasMonitorLogico.js';
import {
  CONDICION_FUENTE_FEDERADA_RETIRADA,
  esFuenteFederadaRetirada,
  MENSAJE_FUENTE_FEDERADA_RETIRADA
} from '../../../../paquetes/monitores/src/CondicionFuenteFederada.js';

function calcularDuracionMs(inicioIso, finIso) {
  const inicioMs = Date.parse(String(inicioIso || ''));
  const finMs = Date.parse(String(finIso || ''));

  if (Number.isNaN(inicioMs) || Number.isNaN(finMs)) {
    return 0;
  }

  return Math.max(0, finMs - inicioMs);
}

function serializarCanonico(valor) {
  if (Array.isArray(valor)) return `[${valor.map(serializarCanonico).join(',')}]`;
  if (valor && typeof valor === 'object') {
    return `{${Object.keys(valor).sort().map((clave) =>
      `${JSON.stringify(clave)}:${serializarCanonico(valor[clave])}`
    ).join(',')}}`;
  }
  return JSON.stringify(valor ?? null);
}

function configuracionOperativaCausal(monitor) {
  const configuracion = monitor.configuracion || {};
  return {
    expresion: configuracion.expresion,
    estadoInicial: configuracion.estadoInicial,
    retardoSenalSegundos: configuracion.retardoSenalSegundos,
    dependencias: (configuracion.dependencias || []).map((dependencia) => ({
      variable: dependencia.variable,
      fuente: dependencia.fuente,
      monitorId: dependencia.monitorId ?? null,
      proyeccionId: dependencia.proyeccionId ?? null,
      estadoInicial: dependencia.estadoInicial ?? null,
      inversion: dependencia.inversion ?? null,
      retardoCambioSegundos: dependencia.retardoCambioSegundos ?? null,
      politicaPerdidaEnFallo: dependencia.politicaPerdidaEnFallo ?? null,
      politicaPerdidaEnCorrecto: dependencia.politicaPerdidaEnCorrecto ?? null
    }))
  };
}

function construirCausalidadFederada({
  monitor,
  evaluacion,
  entradas,
  transicionAnteriorId = null
}) {
  const causas = entradas.map((entrada) => ({
    entradaId: entrada.entradaId,
    proyeccionId: entrada.proyeccionId,
    revisionConfiguracion: entrada.revisionConfiguracion,
    valorBinarioEfectivo: entrada.valorBinarioEfectivo,
    generacionId: entrada.evidenciaEfectiva?.generacionId ?? null,
    secuenciaElemento: entrada.evidenciaEfectiva?.secuenciaElemento ?? null,
    ocurrenciaOrigenId: entrada.evidenciaEfectiva?.ocurrenciaOrigenId ?? null,
    transicionTemporalId: entrada.evidenciaEfectiva?.transicionTemporalId ?? null,
    condicionFuente: entrada.condicionFuente
  })).sort((a, b) => Number(a.entradaId) - Number(b.entradaId));
  const material = {
    version: 1,
    monitorId: Number(monitor.id),
    configuracionOperativa: configuracionOperativaCausal(monitor),
    estadoDetectado: evaluacion.estadoDetectado,
    bloqueaEvaluacion: Boolean(evaluacion.bloqueaEvaluacion),
    transicionAnteriorId,
    causas
  };
  const huella = createHash('sha256')
    .update(serializarCanonico(material))
    .digest('hex');
  return {
    version: 1,
    transicionMonitorId: `monitor-federado:${huella}`,
    causas
  };
}

function resolverCausalidadYEfectosFederados({
  monitor,
  evaluacion,
  resumenFederado,
  almacenEstadoActual
}) {
  if (resumenFederado.total === 0) {
    return { causalidadFederada: null, efectosDerivadosHabilitados: true };
  }
  const estadoActual = almacenEstadoActual?.buscarPorMonitorId(monitor.id);
  const causalidadAnterior = estadoActual?.resultadoActual?.causalidadFederada;
  const existeAnterior = Boolean(causalidadAnterior?.transicionMonitorId);
  const retiradaDefinitiva = resumenFederado.entradas.some(
    esFuenteFederadaRetirada
  );
  const retiradaYaMaterializada = causalidadAnterior?.causas?.some(
    esFuenteFederadaRetirada
  );
  const cambiaSalida = !estadoActual?.ejecutadoTodavia ||
    estadoActual.estado !== evaluacion.estadoDetectado;
  if (retiradaDefinitiva) {
    return {
      causalidadFederada: retiradaYaMaterializada
        ? causalidadAnterior
        : construirCausalidadFederada({
            monitor,
            evaluacion,
            entradas: resumenFederado.entradas,
            transicionAnteriorId: causalidadAnterior?.transicionMonitorId || null
          }),
      efectosDerivadosHabilitados: false
    };
  }
  if (existeAnterior && !cambiaSalida) {
    return {
      causalidadFederada: causalidadAnterior,
      efectosDerivadosHabilitados: false
    };
  }
  return {
    causalidadFederada: construirCausalidadFederada({
      monitor,
      evaluacion,
      entradas: resumenFederado.entradas,
      transicionAnteriorId: causalidadAnterior?.transicionMonitorId || null
    }),
    efectosDerivadosHabilitados: true
  };
}

function resolverEstadoInicial(configuracion) {
  return configuracion?.estadoInicial === 'indisponible'
    ? 'indisponible'
    : 'disponible';
}

function normalizarRetardoSenalSegundos(configuracion) {
  const valor = Number.parseInt(
    String(configuracion?.retardoSenalSegundos ?? '0'),
    10
  );

  if (!Number.isInteger(valor) || valor <= 0) {
    return 0;
  }

  return valor;
}

function estadoDesdeResultadoLogico(resultado) {
  return resultado ? 'disponible' : 'indisponible';
}

function resultadoLogicoDesdeEstado(estado) {
  return String(estado || '').trim().toLowerCase() === 'disponible';
}

function calcularTranscurridoSegundos(inicioIso, finIso) {
  const inicioMs = Date.parse(String(inicioIso || ''));
  const finMs = Date.parse(String(finIso || ''));

  if (Number.isNaN(inicioMs) || Number.isNaN(finMs)) {
    return null;
  }

  return Math.max(0, Math.floor((finMs - inicioMs) / 1000));
}

function resumirRetardoSenalDependencia(estadoDependencia) {
  const retardo = estadoDependencia?.resultadoActual?.metricaPrincipal
    ?.retardoSenal || null;

  if (!retardo || typeof retardo !== 'object') {
    return null;
  }

  return {
    activo: Boolean(retardo.activo),
    pendiente: Boolean(retardo.pendiente),
    retardoSegundos: Number(retardo.retardoSegundos || 0),
    salidaEstable: resultadoLogicoDesdeEstado(estadoDependencia.estado),
    salidaCandidata: retardo.salidaCandidata ?? null,
    iniciadoEnUtc: retardo.iniciadoEnUtc || null,
    venceEnUtc: retardo.venceEnUtc || null,
    restanteSegundos:
      retardo.restanteSegundos == null
        ? null
        : Number(retardo.restanteSegundos)
  };
}

function construirEventoRetardoSenal({
  tipo,
  salidaEstable,
  salidaCandidata,
  retardoSegundos,
  iniciadoEnUtc = null,
  venceEnUtc = null,
  ejecutadoEnUtc,
  transcurridoSegundos = null,
  restanteSegundos = null
}) {
  return {
    tipo,
    resultadoAnterior: salidaEstable,
    resultadoNuevo: salidaCandidata,
    duracionExigidaSegundos: retardoSegundos,
    duracionObservadaSegundos: transcurridoSegundos,
    condicionEstableDesdeUtc: iniciadoEnUtc,
    venceEnUtc,
    registradoEnUtc: ejecutadoEnUtc,
    restanteSegundos
  };
}

function normalizarEstadoRemotoEstable(valor) {
  const estado = String(valor || '').trim().toLowerCase();
  if (['vivo', 'correcto', 'normal', 'disponible'].includes(estado)) {
    return 'correcto';
  }
  if (['fallo', 'indisponible'].includes(estado)) return 'fallo';
  return null;
}

function valorDesdeEstadoRemoto(estado, inversion) {
  const valor = estado === 'correcto';
  return inversion ? !valor : valor;
}

function valorInicialFederado(entrada) {
  return entrada?.estadoInicial !== 'fallo';
}

function valorConservadoFederado(entrada) {
  return entrada?.ultimoEstadoRemotoEstable
    ? valorDesdeEstadoRemoto(
        entrada.ultimoEstadoRemotoEstable,
        entrada.inversion
      )
    : valorInicialFederado(entrada);
}

function entradaFederadaUtilizable(base, {
  valor,
  condicionFuente,
  accionAplicada,
  causa = null
}) {
  return {
    ...base,
    valor,
    valorBinarioEfectivo: valor,
    condicionFuente,
    accionAplicada,
    causa,
    estado: condicionFuente,
    bloqueaEvaluacion: false,
    motivoBloqueo: null
  };
}

function entradaFederadaIncompleta(dependencia, { condicionFuente, motivo }) {
  return {
    variable: dependencia.variable,
    fuente: dependencia.fuente,
    referencia: dependencia.proyeccionId,
    proyeccionId: dependencia.proyeccionId,
    valor: null,
    valorBinarioEfectivo: null,
    condicionFuente,
    accionAplicada: 'ninguna',
    estado: condicionFuente,
    bloqueaEvaluacion: true,
    motivoBloqueo: motivo
  };
}

export class EjecutorMonitorBooleano {
  tipoMonitor = 'booleano';

  constructor({ repositorioEntradasFederadas = null } = {}) {
    this.repositorioEntradasFederadas = repositorioEntradasFederadas;
  }

  async ejecutar(
    monitor,
    {
      programacion = null,
      almacenEstadoActual = null,
      ejecutadoEnUtc = new Date().toISOString()
    } = {}
  ) {
    try {
      const evaluacion = await this.evaluarMonitorLogico(monitor, {
        almacenEstadoActual,
        ejecutadoEnUtc
      });
      const finalizadoEnUtc = new Date().toISOString();
      const resumenFederado = resumirEntradasFederadas(evaluacion.entradas);
      const { causalidadFederada, efectosDerivadosHabilitados } =
        resolverCausalidadYEfectosFederados({
          monitor,
          evaluacion,
          resumenFederado,
          almacenEstadoActual
        });

      return {
        monitorId: monitor.id,
        nombre: monitor.nombre,
        tipo: monitor.tipo,
        ejecutadoEnUtc,
        finalizadoEnUtc,
        duracionTotalMs: calcularDuracionMs(ejecutadoEnUtc, finalizadoEnUtc),
        programacion: programacion
          ? {
              proximoIntentoEvaluadoEn: programacion.proximoIntentoEn,
              retrasoSegundos: programacion.retrasoSegundos,
              motivoProgramacion: programacion.motivoProgramacion
            }
          : null,
        protocolo: {
          nombre: 'booleano',
          expresion: evaluacion.expresion,
          totalDependencias: evaluacion.entradas.length
        },
        intentosRealizados: 1,
        intentoExitoso: evaluacion.bloqueaEvaluacion ? null : 1,
        exito: !evaluacion.bloqueaEvaluacion && evaluacion.resultado === true,
        estadoDetectado: evaluacion.estadoDetectado,
        codigoResultado: evaluacion.codigoResultado,
        mensajeResultado: evaluacion.mensajeResultado,
        detalleError: evaluacion.detalleError,
        origenOperativo: resumenFederado.total > 0
          ? 'monitor_local_con_entradas_federadas'
          : 'monitor_local',
        efectosDerivadosHabilitados,
        causalidadFederada,
        metricaPrincipal: {
          resultadoLogico: evaluacion.resultado,
          bloqueaEvaluacion: evaluacion.bloqueaEvaluacion,
          dependenciaCausante: evaluacion.dependenciaCausante,
          retardoSenal: evaluacion.retardoSenal,
          entradasFederadas: resumenFederado.entradas,
          totalEntradasFederadas: resumenFederado.total,
          totalTransicionesEntradasFederadas: resumenFederado.totalTransiciones,
          proximoVencimientoEntradaFederadaUtc:
            resumenFederado.proximoVencimientoUtc
        },
        intentos: [
          {
            numeroIntento: 1,
            inicioUtc: ejecutadoEnUtc,
            finUtc: finalizadoEnUtc,
            duracionMs: calcularDuracionMs(ejecutadoEnUtc, finalizadoEnUtc),
            exito: !evaluacion.bloqueaEvaluacion,
            codigoResultado: evaluacion.codigoResultado,
            mensajeResultado: evaluacion.mensajeResultado,
            detalleError: evaluacion.detalleError,
            detalle: {
              expresion: evaluacion.expresion,
              entradas: evaluacion.entradas,
              resultado: evaluacion.resultado,
              retardoSenal: evaluacion.retardoSenal
            }
          }
        ]
      };
    } catch (error) {
      return this.construirResultadoErrorConfiguracion({
        monitor,
        programacion,
        ejecutadoEnUtc,
        error
      });
    }
  }

  async evaluarMonitorLogico(monitor, { almacenEstadoActual, ejecutadoEnUtc }) {
    const configuracion = monitor.configuracion || {};
    const dependencias = normalizarDependenciasMonitorLogico(
      configuracion.dependencias
    );
    const entradasFederadas = await this.cargarEntradasFederadas(
      monitor,
      dependencias,
      ejecutadoEnUtc
    );
    const entradas = dependencias.map((dependencia) =>
      this.resolverEntradaDependencia(dependencia, {
        almacenEstadoActual,
        entradasFederadas
      })
    );
    const incompleta = entradas.find((entrada) => entrada.bloqueaEvaluacion);

    if (incompleta) {
      const estadoConservado = this.resolverEstadoConservado(monitor, {
        almacenEstadoActual
      });
      const fuenteRetirada = esFuenteFederadaRetirada(incompleta);

      return {
        expresion: configuracion.expresion,
        entradas,
        resultado: null,
        bloqueaEvaluacion: true,
        estadoDetectado: estadoConservado,
        codigoResultado: fuenteRetirada
          ? CONDICION_FUENTE_FEDERADA_RETIRADA
          : 'booleano_inicializando',
        mensajeResultado: fuenteRetirada
          ? MENSAJE_FUENTE_FEDERADA_RETIRADA
          : 'El monitor lógico conserva su salida porque todavía no dispone de todas las entradas.',
        detalleError: {
          codigo: fuenteRetirada
            ? 'FUENTE_FEDERADA_RETIRADA'
            : 'ENTRADA_LOGICA_INCOMPLETA',
          mensaje: incompleta.motivoBloqueo
        },
        dependenciaCausante: incompleta.variable,
        retardoSenal: null
      };
    }

    const valoresVariables = Object.fromEntries(
      entradas.map((entrada) => [entrada.variable, entrada.valor])
    );
    const resultado = evaluarExpresionMonitorLogico(
      configuracion.expresion,
      valoresVariables
    );

    return this.aplicarRetardoSenal({
      monitor,
      configuracion,
      almacenEstadoActual,
      ejecutadoEnUtc,
      evaluacion: {
        expresion: configuracion.expresion,
        entradas,
        resultado,
        bloqueaEvaluacion: false,
        estadoDetectado: resultado ? 'disponible' : 'indisponible',
        codigoResultado: resultado ? 'booleano_ok' : 'booleano_false',
        mensajeResultado: resultado
          ? 'La expresión lógica evaluó a disponible.'
          : (configuracion.mensajeFallo || 'La expresión lógica evaluó a indisponible.'),
        detalleError: resultado
          ? null
          : {
              codigo: 'SALIDA_LOGICA_FALSE',
              mensaje:
                configuracion.mensajeFallo ||
                'La salida lógica no cumple la condición definida.'
            },
        dependenciaCausante: resultado
          ? null
          : entradas.find((entrada) => entrada.valor === false)?.variable || null,
        retardoSenal: null
      }
    });
  }

  aplicarRetardoSenal({
    monitor,
    configuracion,
    almacenEstadoActual,
    ejecutadoEnUtc,
    evaluacion
  }) {
    const retardoSegundos = normalizarRetardoSenalSegundos(configuracion);

    if (retardoSegundos <= 0) {
      return {
        ...evaluacion,
        retardoSenal: {
          activo: false,
          retardoSegundos: 0,
          salidaEstable: evaluacion.resultado,
          salidaCandidata: evaluacion.resultado,
          pendiente: false,
          evento: null
        }
      };
    }

    const estadoActual = almacenEstadoActual?.buscarPorMonitorId(monitor.id);
    const estadoEstable = estadoActual?.ejecutadoTodavia
      ? (estadoActual.estado === 'indisponible' ? 'indisponible' : 'disponible')
      : resolverEstadoInicial(configuracion);
    const salidaEstable = resultadoLogicoDesdeEstado(estadoEstable);

    const retardoPrevio = estadoActual?.resultadoActual?.metricaPrincipal
      ?.retardoSenal || null;
    const candidatoPrevio = retardoPrevio?.pendiente
      ? Boolean(retardoPrevio.salidaCandidata)
      : null;

    if (estadoDesdeResultadoLogico(evaluacion.resultado) === estadoEstable) {
      const eventoCancelado = retardoPrevio?.pendiente
        ? construirEventoRetardoSenal({
            tipo: 'retardo_senal_cancelado',
            salidaEstable,
            salidaCandidata: candidatoPrevio,
            retardoSegundos,
            iniciadoEnUtc: retardoPrevio.iniciadoEnUtc || null,
            venceEnUtc: retardoPrevio.venceEnUtc || null,
            ejecutadoEnUtc,
            transcurridoSegundos: calcularTranscurridoSegundos(
              retardoPrevio.iniciadoEnUtc,
              ejecutadoEnUtc
            ),
            restanteSegundos: null
          })
        : null;

      return {
        ...evaluacion,
        retardoSenal: {
          activo: true,
          retardoSegundos,
          salidaEstable: evaluacion.resultado,
          salidaCandidata: evaluacion.resultado,
          pendiente: false,
          iniciadoEnUtc: null,
          venceEnUtc: null,
          restanteSegundos: 0,
          evento: eventoCancelado
        }
      };
    }

    const iniciadoEnUtc = candidatoPrevio === evaluacion.resultado &&
      retardoPrevio?.iniciadoEnUtc
      ? retardoPrevio.iniciadoEnUtc
      : ejecutadoEnUtc;
    const inicioMs = Date.parse(iniciadoEnUtc);
    const ahoraMs = Date.parse(ejecutadoEnUtc);
    const transcurridoSegundos = Number.isNaN(inicioMs) || Number.isNaN(ahoraMs)
      ? 0
      : Math.max(0, Math.floor((ahoraMs - inicioMs) / 1000));
    const restanteSegundos = Math.max(0, retardoSegundos - transcurridoSegundos);
    const venceEnUtc = Number.isNaN(inicioMs)
      ? null
      : new Date(inicioMs + retardoSegundos * 1000).toISOString();

    if (transcurridoSegundos >= retardoSegundos) {
      return {
        ...evaluacion,
        retardoSenal: {
          activo: true,
          retardoSegundos,
          salidaEstable: evaluacion.resultado,
          salidaCandidata: evaluacion.resultado,
          pendiente: false,
          aplicado: true,
          iniciadoEnUtc,
          venceEnUtc,
          transcurridoSegundos,
          restanteSegundos: 0,
          evento: construirEventoRetardoSenal({
            tipo: 'retardo_senal_aplicado',
            salidaEstable,
            salidaCandidata: evaluacion.resultado,
            retardoSegundos,
            iniciadoEnUtc,
            venceEnUtc,
            ejecutadoEnUtc,
            transcurridoSegundos,
            restanteSegundos: 0
          })
        }
      };
    }

    const tipoEventoRetardo = candidatoPrevio === evaluacion.resultado
      ? 'retardo_senal_pendiente'
      : 'retardo_senal_iniciado';

    return {
      ...evaluacion,
      resultado: salidaEstable,
      estadoDetectado: estadoEstable,
      codigoResultado: 'booleano_retardo_pendiente',
      mensajeResultado:
        `La salida candidata debe permanecer estable ${retardoSegundos} segundos antes de aplicarse.`,
      detalleError: estadoEstable === 'disponible'
        ? null
        : {
            codigo: 'RETARDO_SENAL_PENDIENTE',
            mensaje:
              'El monitor lógico mantiene la salida indisponible estable mientras espera confirmar la nueva salida candidata.'
          },
      dependenciaCausante: evaluacion.dependenciaCausante,
      retardoSenal: {
        activo: true,
        retardoSegundos,
        salidaEstable,
        salidaCandidata: evaluacion.resultado,
        pendiente: true,
        iniciadoEnUtc,
        venceEnUtc,
        transcurridoSegundos,
        restanteSegundos,
        evento: construirEventoRetardoSenal({
          tipo: tipoEventoRetardo,
          salidaEstable,
          salidaCandidata: evaluacion.resultado,
          retardoSegundos,
          iniciadoEnUtc,
          venceEnUtc,
          ejecutadoEnUtc,
          transcurridoSegundos,
          restanteSegundos
        })
      }
    };
  }

  async cargarEntradasFederadas(monitor, dependencias, observadoEnUtc) {
    if (!dependencias.some((dependencia) => dependencia.fuente === 'monitor_federado')) {
      return new Map();
    }
    const repositorio = this.repositorioEntradasFederadas;
    if (typeof repositorio?.observarEntradasOperativasPorMonitorId === 'function') {
      const entradas = await repositorio.observarEntradasOperativasPorMonitorId(
        monitor.id,
        { observadoEnUtc }
      );
      return new Map(entradas.map((entrada) => [entrada.variable, entrada]));
    }
    if (typeof repositorio?.resolverEntradasOperativasPorMonitorId !== 'function') {
      return new Map();
    }
    const entradas = await repositorio
      .resolverEntradasOperativasPorMonitorId(monitor.id);
    return new Map(entradas.map((entrada) => [entrada.variable, entrada]));
  }

  resolverEntradaDependencia(
    dependencia,
    { almacenEstadoActual, entradasFederadas = new Map() }
  ) {
    if (dependencia.fuente === 'monitor_federado') {
      return this.resolverEntradaFederada(
        dependencia,
        entradasFederadas.get(dependencia.variable) || null
      );
    }

    if (dependencia.fuente !== 'monitor') {
      return {
        variable: dependencia.variable,
        fuente: dependencia.fuente,
        referencia: dependencia.referencia ?? dependencia.proyeccionId ?? null,
        proyeccionId: dependencia.proyeccionId ?? null,
        valor: null,
        estado: 'desconocido',
        bloqueaEvaluacion: true,
        motivoBloqueo:
          `La fuente ${dependencia.fuente} está reservada pero aún no tiene lector runtime.`
      };
    }

    const estadoDependencia = almacenEstadoActual?.buscarPorMonitorId(
      dependencia.monitorId
    );

    if (!estadoDependencia) {
      return {
        variable: dependencia.variable,
        fuente: dependencia.fuente,
        monitorId: dependencia.monitorId,
        valor: null,
        estado: 'desconocido',
        bloqueaEvaluacion: true,
        motivoBloqueo:
          `No existe estado runtime para el monitor dependiente #${dependencia.monitorId}.`
      };
    }

    if (!estadoDependencia.activoCatalogo) {
      return {
        variable: dependencia.variable,
        fuente: dependencia.fuente,
        monitorId: dependencia.monitorId,
        valor: null,
        estado: estadoDependencia.estado,
        bloqueaEvaluacion: true,
        motivoBloqueo:
          `El monitor dependiente #${dependencia.monitorId} está deshabilitado.`
      };
    }

    if (!estadoDependencia.ejecutadoTodavia) {
      return {
        variable: dependencia.variable,
        fuente: dependencia.fuente,
        monitorId: dependencia.monitorId,
        valor: null,
        estado: estadoDependencia.estado,
        bloqueaEvaluacion: true,
        motivoBloqueo:
          `El monitor dependiente #${dependencia.monitorId} aún no tiene ejecución.`
      };
    }

    const salidaEstable = resultadoLogicoDesdeEstado(
      estadoDependencia.estado
    );
    return {
      variable: dependencia.variable,
      fuente: dependencia.fuente,
      monitorId: dependencia.monitorId,
      valor: salidaEstable,
      estado: estadoDependencia.estado,
      retardoSenalDependencia: resumirRetardoSenalDependencia(
        estadoDependencia
      ),
      bloqueaEvaluacion: false,
      motivoBloqueo: null
    };
  }

  resolverEntradaFederada(dependencia, entrada) {
    if (entrada?.interpretacionDurable) {
      return {
        ...entrada,
        estado: entrada.condicionFuente,
        valor: entrada.valorBinarioEfectivo
      };
    }
    if (!entrada || entrada.proyeccionId !== dependencia.proyeccionId) {
      return entradaFederadaIncompleta(dependencia, {
        condicionFuente: 'inicial',
        motivo:
          'La incorporación federada no posee un vínculo runtime coherente con su configuración.'
      });
    }

    const base = {
      variable: dependencia.variable,
      fuente: dependencia.fuente,
      referencia: dependencia.proyeccionId,
      proyeccionId: dependencia.proyeccionId,
      entradaId: entrada.entradaId,
      revisionConfiguracion: entrada.revisionConfiguracion,
      estadoInicial: entrada.estadoInicial,
      inversion: entrada.inversion,
      estadoOperativoRemoto: entrada.estadoOperativoRemoto,
      remotoEjecutadoTodavia: entrada.remotoEjecutadoTodavia,
      ultimoEstadoRemotoEstable: entrada.ultimoEstadoRemotoEstable,
      generacionId: entrada.generacionId,
      secuenciaElemento: entrada.secuenciaElemento,
      ocurrenciaOrigenId: entrada.ocurrenciaOrigenId,
      vigenteHastaEfectivaUtc: entrada.vigenteHastaEfectivaUtc,
      efectivoEnUtc: entrada.efectivoEnUtc,
      materializadoEnUtc: entrada.materializadoEnUtc,
      transicionTemporalId: entrada.transicionTemporalId
    };

    if (entrada.estadoVigencia === 'retirada') {
      return {
        ...base,
        valor: valorInicialFederado(entrada),
        valorBinarioEfectivo: valorInicialFederado(entrada),
        condicionFuente: CONDICION_FUENTE_FEDERADA_RETIRADA,
        accionAplicada: 'ninguna',
        bloqueaEvaluacion: true,
        motivoBloqueo: MENSAJE_FUENTE_FEDERADA_RETIRADA
      };
    }

    if (
      entrada.estadoAutorizacion === 'noAutorizada' ||
      entrada.condicionTemporal === 'noAutorizada'
    ) {
      return {
        ...base,
        valor: valorConservadoFederado(entrada),
        valorBinarioEfectivo: valorConservadoFederado(entrada),
        condicionFuente: 'noAutorizada',
        accionAplicada: 'ninguna',
        bloqueaEvaluacion: true,
        motivoBloqueo:
          'La entrada perdió la autoridad local necesaria y no puede participar en nuevas evaluaciones.'
      };
    }

    if (!entrada.generacionId || !entrada.condicionTemporal) {
      const valor = valorInicialFederado(entrada);
      return entradaFederadaUtilizable(base, {
        valor,
        condicionFuente: 'inicial',
        accionAplicada: 'estado_inicial'
      });
    }

    if (entrada.condicionTemporal === 'consolidando') {
      const valor = valorConservadoFederado(entrada);
      return entradaFederadaUtilizable(base, {
        valor,
        condicionFuente: 'consolidando',
        accionAplicada: entrada.ultimoEstadoRemotoEstable
          ? 'conservar_ultimo_estado_estable'
          : 'estado_inicial'
      });
    }

    const estadoActualEstable = entrada.remotoEjecutadoTodavia
      ? normalizarEstadoRemotoEstable(entrada.estadoOperativoRemoto)
      : null;
    const incompatible = entrada.condicionTemporal === 'incompatible' ||
      (entrada.estadoCoherencia !== null && entrada.estadoCoherencia !== 'coherente') ||
      entrada.estadoSoporte === 'huerfana';
    if (entrada.condicionTemporal === 'vencida' || incompatible) {
      return this.aplicarPerdidaTemporal(base, entrada, {
        causa: incompatible ? 'incompatible' : 'vigencia_agotada'
      });
    }

    if (entrada.condicionTemporal === 'vigente' && estadoActualEstable) {
      const valor = valorDesdeEstadoRemoto(
        estadoActualEstable,
        entrada.inversion
      );
      return entradaFederadaUtilizable(base, {
        valor,
        condicionFuente: 'vigente',
        accionAplicada: entrada.inversion
          ? 'estado_remoto_invertido'
          : 'estado_remoto'
      });
    }

    if (entrada.ultimoEstadoRemotoEstable) {
      return this.aplicarPerdidaTemporal(base, entrada, {
        causa: 'sin_estado_operativo',
        condicionFuente: 'sinEstadoOperativo'
      });
    }

    return entradaFederadaUtilizable(base, {
      valor: valorInicialFederado(entrada),
      condicionFuente: 'sinEstadoOperativo',
      accionAplicada: 'estado_inicial'
    });
  }

  aplicarPerdidaTemporal(base, entrada, {
    causa,
    condicionFuente = 'perdidaTemporal'
  }) {
    const ultimoEstado = entrada.ultimoEstadoRemotoEstable;
    if (!ultimoEstado) {
      return entradaFederadaUtilizable(base, {
        valor: valorInicialFederado(entrada),
        condicionFuente,
        accionAplicada: 'estado_inicial',
        causa
      });
    }
    const politica = ultimoEstado === 'fallo'
      ? entrada.politicaPerdidaEnFallo
      : entrada.politicaPerdidaEnCorrecto;
    const valor = politica === 'forzar_fallo'
      ? false
      : politica === 'forzar_correcto'
        ? true
        : valorDesdeEstadoRemoto(ultimoEstado, entrada.inversion);
    return entradaFederadaUtilizable(base, {
      valor,
      condicionFuente,
      accionAplicada: politica,
      causa
    });
  }

  resolverEstadoConservado(monitor, { almacenEstadoActual }) {
    const estadoActual = almacenEstadoActual?.buscarPorMonitorId(monitor.id);

    if (estadoActual?.ejecutadoTodavia) {
      return estadoActual.estado === 'indisponible'
        ? 'indisponible'
        : 'disponible';
    }

    return resolverEstadoInicial(monitor.configuracion);
  }

  construirResultadoErrorConfiguracion({
    monitor,
    programacion,
    ejecutadoEnUtc,
    error
  }) {
    const finalizadoEnUtc = new Date().toISOString();

    return {
      monitorId: monitor.id,
      nombre: monitor.nombre,
      tipo: monitor.tipo,
      ejecutadoEnUtc,
      finalizadoEnUtc,
      duracionTotalMs: calcularDuracionMs(ejecutadoEnUtc, finalizadoEnUtc),
      programacion,
      protocolo: {
        nombre: 'booleano'
      },
      intentosRealizados: 1,
      intentoExitoso: null,
      exito: false,
      estadoDetectado: resolverEstadoInicial(monitor.configuracion),
      codigoResultado: 'booleano_error_configuracion',
      mensajeResultado:
        error?.message || 'La configuración del monitor lógico no es válida.',
      detalleError: {
        codigo: 'CONFIGURACION_LOGICA_INVALIDA',
        mensaje:
          error?.message || 'La configuración del monitor lógico no es válida.'
      },
      metricaPrincipal: {
        resultadoLogico: null,
        bloqueaEvaluacion: true,
        dependenciaCausante: null
      },
      intentos: []
    };
  }
}

function resumirEntradasFederadas(entradas = []) {
  const federadas = (Array.isArray(entradas) ? entradas : [])
    .filter((entrada) => entrada?.fuente === 'monitor_federado')
    .map((entrada) => ({
      entradaId: entrada.entradaId ?? null,
      variable: entrada.variable,
      proyeccionId: entrada.proyeccionId,
      revisionConfiguracion: entrada.revisionConfiguracion ?? null,
      valorBinarioEfectivo: entrada.valorBinarioEfectivo,
      condicionFuente: entrada.condicionFuente,
      bloqueaEvaluacion: Boolean(entrada.bloqueaEvaluacion),
      candidatoPendiente: Boolean(entrada.candidatoPendiente),
      candidatoValor: entrada.candidatoValor ?? null,
      candidatoIniciadoEnUtc: entrada.candidatoIniciadoEnUtc ?? null,
      candidatoVenceEnUtc: entrada.candidatoVenceEnUtc ?? null,
      transicionAplicada: Boolean(entrada.transicionAplicada),
      observacionCompletaPostArranque:
        Boolean(entrada.observacionCompletaPostArranque),
      generacionId: entrada.generacionId ?? null,
      secuenciaElemento: entrada.secuenciaElemento ?? null,
      ocurrenciaOrigenId: entrada.ocurrenciaOrigenId ?? null,
      transicionTemporalId: entrada.transicionTemporalId ?? null,
      evidenciaEfectiva: entrada.evidenciaEfectiva ?? null
    }));
  const vencimientos = federadas
    .filter((entrada) => entrada.candidatoPendiente && entrada.candidatoVenceEnUtc)
    .map((entrada) => entrada.candidatoVenceEnUtc)
    .sort();
  return {
    total: federadas.length,
    totalTransiciones: federadas.filter((entrada) => entrada.transicionAplicada).length,
    proximoVencimientoUtc: vencimientos[0] || null,
    entradas: federadas
  };
}

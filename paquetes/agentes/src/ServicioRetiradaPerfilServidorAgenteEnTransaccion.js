import {
  ESTADOS_PERFIL_SERVIDOR_AGENTE,
  SENALES_RUNTIME_SERVIDOR_AGENTE
} from './ContratoPerfilServidorAgente.js';
import {
  clonarRepositorioConClienteSql,
  crearEjecutorTelemetriaEnTransaccion
} from './InfraestructuraTransaccionalTelemetriaAgentes.js';

const ESTADOS_CIERRE = new Set([
  ESTADOS_PERFIL_SERVIDOR_AGENTE.RETIRADO,
  ESTADOS_PERFIL_SERVIDOR_AGENTE.DESACTIVADO_INCOMPATIBLE
]);

/**
 * Retira la presencia operativa de una generación sin destruir catálogo,
 * histórico, reglas, monitores ni su proyección diagnóstica compacta.
 */
export class ServicioRetiradaPerfilServidorAgenteEnTransaccion {
  constructor({
    repositorioPerfilesServidor,
    repositorioEstadoRuntimeServidor,
    repositorioCatalogoSenales,
    repositorioEstadoActualTelemetria,
    repositorioEstadoActualEvaluacion,
    capturadorFederacionTelemetria
  } = {}) {
    exigirMetodo(
      repositorioPerfilesServidor,
      'buscarPorAgenteId',
      'repositorioPerfilesServidor'
    );
    exigirMetodo(
      repositorioPerfilesServidor,
      'cerrarEnTransaccion',
      'repositorioPerfilesServidor'
    );
    exigirMetodo(
      repositorioEstadoRuntimeServidor,
      'buscarPorPerfil',
      'repositorioEstadoRuntimeServidor'
    );
    exigirMetodo(
      repositorioCatalogoSenales,
      'buscarPorIdentidad',
      'repositorioCatalogoSenales'
    );
    exigirMetodo(
      repositorioEstadoActualTelemetria,
      'bloquearPorSenalesEnTransaccion',
      'repositorioEstadoActualTelemetria'
    );
    exigirMetodo(
      repositorioEstadoActualTelemetria,
      'eliminarBloqueadasEnTransaccion',
      'repositorioEstadoActualTelemetria'
    );
    exigirMetodo(
      repositorioEstadoActualEvaluacion,
      'bloquearPorSenalesEnTransaccion',
      'repositorioEstadoActualEvaluacion'
    );
    exigirMetodo(
      repositorioEstadoActualEvaluacion,
      'eliminarBloqueadosEnTransaccion',
      'repositorioEstadoActualEvaluacion'
    );
    exigirMetodo(
      capturadorFederacionTelemetria,
      'retirarFotografiasEnTransaccion',
      'capturadorFederacionTelemetria'
    );
    exigirMetodo(
      capturadorFederacionTelemetria,
      'capturarReglaEnTransaccion',
      'capturadorFederacionTelemetria'
    );

    this.repositorioPerfiles = repositorioPerfilesServidor;
    this.repositorioEstadoRuntime = repositorioEstadoRuntimeServidor;
    this.repositorioCatalogo = repositorioCatalogoSenales;
    this.repositorioFotografias = repositorioEstadoActualTelemetria;
    this.repositorioEstadosReglas = repositorioEstadoActualEvaluacion;
    this.capturadorFederacion = capturadorFederacionTelemetria;
  }

  async retirarEnTransaccion({
    agenteId,
    generacion = null,
    versionEsperada = null,
    estadoFinal = ESTADOS_PERFIL_SERVIDOR_AGENTE.RETIRADO,
    codigoCierre = 'retirada_administrativa',
    detalleCierre = null,
    cerradaEnUtc = new Date()
  } = {}, { conexion } = {}) {
    exigirConexion(conexion);
    const agente = idPositivo(agenteId, 'agenteId');
    const generacionEsperada = generacion == null
      ? null
      : idPositivo(generacion, 'generacion');
    const version = versionEsperada == null
      ? null
      : idPositivo(versionEsperada, 'versionEsperada');
    const estado = String(estadoFinal || '').trim();
    if (!ESTADOS_CIERRE.has(estado)) {
      throw new Error('El estado final solicitado no cierra un perfil servidor.');
    }

    const perfil = await this.repositorioPerfiles.buscarPorAgenteId(
      agente,
      { conexion, bloquear: true }
    );
    if (!perfil) return resultadoSinPerfil(agente);
    if (generacionEsperada !== null && perfil.generacion !== generacionEsperada) {
      throw new Error(
        'La generación servidor cambió antes de completar su retirada.'
      );
    }
    if (version !== null && perfil.versionEstado !== version) {
      throw new Error(
        'El perfil servidor cambió mientras se preparaba su retirada.'
      );
    }
    if (!perfil.estaVigente()) {
      return resultadoSinCambios(perfil);
    }

    const proyeccion = await this.repositorioEstadoRuntime.buscarPorPerfil({
      agenteId: agente,
      generacion: perfil.generacion
    }, { conexion, bloquear: true });
    const catalogo = clonarRepositorioConClienteSql(
      this.repositorioCatalogo,
      crearEjecutorTelemetriaEnTransaccion(conexion)
    );
    const senales = [];
    for (const contrato of Object.values(SENALES_RUNTIME_SERVIDOR_AGENTE)) {
      const senal = await catalogo.buscarPorIdentidad({
        agenteId: agente,
        categoria: contrato.categoria,
        clave: contrato.clave,
        tag: contrato.tag
      });
      if (senal) senales.push(serializar(senal));
    }
    const senalIds = senales.map(({ id }) => Number(id));

    // Orden global de bloqueo: fotografía fuente y después estado de regla.
    const fotografias = await this.repositorioFotografias
      .bloquearPorSenalesEnTransaccion({
        agenteId: agente,
        senalIds
      }, { conexion });
    const estadosReglas = await this.repositorioEstadosReglas
      .bloquearPorSenalesEnTransaccion({
        agenteId: agente,
        senalIds
      }, { conexion });
    const fotografiasSerializadas = fotografias.map(serializar);
    const estadosSerializados = estadosReglas.map(serializar);
    const fotografiaIds = fotografiasSerializadas.map(({ id }) => Number(id));
    const reglaIds = [...new Set(
      estadosSerializados.map(({ reglaId }) => Number(reglaId))
    )];

    // El tombstone se prepara mientras la fila local todavía existe.
    await this.capturadorFederacion.retirarFotografiasEnTransaccion({
      fotografiaIds
    }, { conexion });
    await this.repositorioFotografias.eliminarBloqueadasEnTransaccion({
      agenteId: agente,
      fotografiaIds
    }, { conexion });
    await this.repositorioEstadosReglas.eliminarBloqueadosEnTransaccion({
      agenteId: agente,
      reglaIds
    }, { conexion });

    // El estado de regla viaja embebido en reglaDerivacion; se recaptura ya nulo.
    for (const reglaId of reglaIds) {
      await this.capturadorFederacion.capturarReglaEnTransaccion(
        { reglaId },
        { conexion }
      );
    }

    const perfilCerrado = await this.repositorioPerfiles.cerrarEnTransaccion({
      agenteId: agente,
      generacion: perfil.generacion,
      estado,
      codigoCierre,
      detalleCierre,
      cerradaEnUtc
    }, { conexion });

    return congelarResultado({
      retirada: true,
      motivo: estado === ESTADOS_PERFIL_SERVIDOR_AGENTE.RETIRADO
        ? 'perfil_retirado'
        : 'perfil_desactivado_incompatible',
      agenteId: agente,
      generacion: perfil.generacion,
      perfil: serializar(perfilCerrado),
      proyeccion: serializar(proyeccion),
      senales,
      fotografiasRetiradas: fotografiasSerializadas,
      estadosReglasRetirados: estadosSerializados
    });
  }
}

function resultadoSinPerfil(agenteId) {
  return congelarResultado({
    retirada: false,
    motivo: 'perfil_inexistente',
    agenteId,
    generacion: null,
    perfil: null,
    proyeccion: null,
    senales: [],
    fotografiasRetiradas: [],
    estadosReglasRetirados: []
  });
}

function resultadoSinCambios(perfil) {
  return congelarResultado({
    retirada: false,
    motivo: 'perfil_ya_cerrado',
    agenteId: perfil.agenteId,
    generacion: perfil.generacion,
    perfil: serializar(perfil),
    proyeccion: null,
    senales: [],
    fotografiasRetiradas: [],
    estadosReglasRetirados: []
  });
}

function congelarResultado(resultado) {
  return Object.freeze({
    ...resultado,
    senales: Object.freeze(resultado.senales.map((senal) => Object.freeze(senal))),
    fotografiasRetiradas: Object.freeze(
      resultado.fotografiasRetiradas.map((foto) => Object.freeze(foto))
    ),
    estadosReglasRetirados: Object.freeze(
      resultado.estadosReglasRetirados.map((estado) => Object.freeze(estado))
    )
  });
}

function serializar(valor) {
  if (valor == null) return null;
  return typeof valor.serializar === 'function'
    ? valor.serializar()
    : { ...valor };
}

function exigirMetodo(objeto, metodo, nombre) {
  if (typeof objeto?.[metodo] !== 'function') {
    throw new Error(`${nombre} no implementa ${metodo}().`);
  }
}

function exigirConexion(conexion) {
  if (typeof conexion?.execute !== 'function') {
    throw new Error('La retirada del perfil servidor exige una transacción SQL.');
  }
}

function idPositivo(valor, campo) {
  const id = Number(valor);
  if (!Number.isSafeInteger(id) || id <= 0) {
    throw new Error(`${campo} debe ser un entero positivo.`);
  }
  return id;
}

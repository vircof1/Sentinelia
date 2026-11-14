export const VERSION_CONTRATO_PERFIL_SERVIDOR_AGENTE = 1;

export const PERFILES_OPERATIVOS_AGENTE = Object.freeze({
  GENERICO: 'generico',
  SERVIDOR: 'servidor'
});

export const ESTADOS_PERFIL_SERVIDOR_AGENTE = Object.freeze({
  PENDIENTE_PRIMERA_EVIDENCIA: 'pendiente_primera_evidencia',
  ACTIVO: 'activo',
  RETIRADO: 'retirado',
  DESACTIVADO_INCOMPATIBLE: 'desactivado_incompatible'
});

export const OPERACIONES_PRESENCIA_SERVIDOR_AGENTE = Object.freeze({
  LOGIN: 'login',
  HEARTBEAT: 'heartbeat',
  REFRESH: 'refresh',
  TELEMETRIA: 'telemetria'
});

export const ORIGEN_TELEMETRIA_RUNTIME_SERVIDOR = 'runtime';

export const CONFIGURACION_TEMPORAL_PERFIL_SERVIDOR_AGENTE = Object.freeze({
  campos: Object.freeze({
    HISTERESIS_SIN_POL: 'histeresisSinPolSegundos',
    DURACION_REINICIO_RECIENTE: 'duracionReinicioRecienteSegundos'
  }),
  unidad: 'segundos',
  exigeEnterosPositivos: true,
  aplicacion: 'prospectiva',
  recalculaVencimientosAbiertos: false
});

export const SENALES_RUNTIME_SERVIDOR_AGENTE = Object.freeze({
  SIN_POL: Object.freeze({
    categoria: 'runtime.servidor',
    clave: 'sin_pol',
    codigoSenal: 'runtime.servidor.sin_pol',
    tag: null,
    tipoDato: 'booleano',
    unidad: null,
    nombreHumano: 'Servidor sin prueba de vida',
    descripcion:
      'Indica que venció la histéresis sin recibir una nueva prueba de vida.',
    origen: ORIGEN_TELEMETRIA_RUNTIME_SERVIDOR,
    valorInicial: false,
    federable: true,
    metadatos: Object.freeze({
      productor: 'sentinelia-runtime',
      sistema: true,
      contrato: 'perfil-servidor-v1'
    })
  }),
  REINICIO_RECIENTE: Object.freeze({
    categoria: 'runtime.servidor',
    clave: 'reinicio_reciente',
    codigoSenal: 'runtime.servidor.reinicio_reciente',
    tag: null,
    tipoDato: 'booleano',
    unidad: null,
    nombreHumano: 'Reinicio reciente del servidor',
    descripcion:
      'Indica que Sentinelia observó un cambio de bootId dentro de su ventana activa.',
    origen: ORIGEN_TELEMETRIA_RUNTIME_SERVIDOR,
    valorInicial: false,
    federable: true,
    metadatos: Object.freeze({
      productor: 'sentinelia-runtime',
      sistema: true,
      contrato: 'perfil-servidor-v1'
    })
  })
});

export const AUTORIDAD_PERFIL_SERVIDOR_AGENTE = Object.freeze({
  reloj: 'sentinelia',
  persistenciaDurable: 'sql',
  coordinacionOperativa: 'redis',
  redisEsAutoridadHistorica: false,
  proyeccionSql: 'compacta',
  diarioSqlPorHeartbeat: false
});

export const PRECISION_TEMPORAL_PERFIL_SERVIDOR_AGENTE = Object.freeze({
  modo: 'operacional_no_forense',
  conservaEstadoActual: true,
  conservaVencimientosVigentes: true,
  reconstruyeCiclosResueltos: false,
  ejecutaEfectosRetrospectivos: false
});

export const DECISIONES_RECONCILIACION_PERFIL_SERVIDOR = Object.freeze({
  MANTENER_PENDIENTE_SIN_FOTOGRAFIA: 'mantener_pendiente_sin_fotografia',
  SIN_CAMBIOS: 'sin_cambios',
  MATERIALIZAR_CONDICION_VIGENTE: 'materializar_condicion_vigente',
  MATERIALIZAR_RECUPERACION: 'materializar_recuperacion',
  ADOPTAR_ESTADO_ACTUAL_SIN_HISTORIA: 'adoptar_estado_actual_sin_historia'
});

const SEMANTICA_OPERACIONES = Object.freeze({
  [OPERACIONES_PRESENCIA_SERVIDOR_AGENTE.LOGIN]: Object.freeze({
    cuentaComoPol: true,
    demuestraHeartbeatExplicito: false,
    puedeArmarGeneracion: true
  }),
  [OPERACIONES_PRESENCIA_SERVIDOR_AGENTE.HEARTBEAT]: Object.freeze({
    cuentaComoPol: true,
    demuestraHeartbeatExplicito: true,
    puedeArmarGeneracion: true
  }),
  [OPERACIONES_PRESENCIA_SERVIDOR_AGENTE.REFRESH]: Object.freeze({
    cuentaComoPol: false,
    demuestraHeartbeatExplicito: false,
    puedeArmarGeneracion: false
  }),
  [OPERACIONES_PRESENCIA_SERVIDOR_AGENTE.TELEMETRIA]: Object.freeze({
    cuentaComoPol: false,
    demuestraHeartbeatExplicito: false,
    puedeArmarGeneracion: false
  })
});

export class ContratoPerfilServidorAgente {
  constructor({ version = VERSION_CONTRATO_PERFIL_SERVIDOR_AGENTE } = {}) {
    if (version !== VERSION_CONTRATO_PERFIL_SERVIDOR_AGENTE) {
      throw new Error(`La versión ${version} del perfil servidor no está soportada.`);
    }

    this.version = version;
  }

  obtenerSemanticaOperacion(operacion) {
    const normalizada = String(operacion || '').trim();
    const semantica = SEMANTICA_OPERACIONES[normalizada];

    if (!semantica) {
      const nombre = normalizada || '(vacía)';
      throw new Error(
        `La operación ${nombre} no pertenece al contrato de presencia.`
      );
    }

    return semantica;
  }

  evaluarElegibilidad({
    loginValidoConBootId = false,
    heartbeatExplicitoAceptado = false
  } = {}) {
    const pendientes = [];

    if (loginValidoConBootId !== true) {
      pendientes.push('login_valido_con_boot_id');
    }
    if (heartbeatExplicitoAceptado !== true) {
      pendientes.push('heartbeat_explicito_aceptado');
    }

    return Object.freeze({
      elegible: pendientes.length === 0,
      caduca: false,
      requisitosPendientes: Object.freeze(pendientes)
    });
  }

  evaluarArmado({
    perfilPromovido = false,
    operacion = null,
    posteriorALaGeneracion = false,
    bootIdValido = false
  } = {}) {
    const semantica = this.obtenerSemanticaOperacion(operacion);
    const armable = perfilPromovido === true &&
      posteriorALaGeneracion === true &&
      bootIdValido === true &&
      semantica.puedeArmarGeneracion;

    return Object.freeze({
      armable,
      estado: armable
        ? ESTADOS_PERFIL_SERVIDOR_AGENTE.ACTIVO
        : ESTADOS_PERFIL_SERVIDOR_AGENTE.PENDIENTE_PRIMERA_EVIDENCIA
    });
  }

  resolverReconciliacionOperativa({
    generacionArmada = false,
    condicionVigente = null,
    valorPublicado = null
  } = {}) {
    exigirBooleano(generacionArmada, 'generacionArmada');
    if (!generacionArmada) {
      return DECISIONES_RECONCILIACION_PERFIL_SERVIDOR
        .MANTENER_PENDIENTE_SIN_FOTOGRAFIA;
    }

    exigirBooleano(condicionVigente, 'condicionVigente');
    exigirBooleanoONulo(valorPublicado, 'valorPublicado');

    if (condicionVigente && valorPublicado === true) {
      return DECISIONES_RECONCILIACION_PERFIL_SERVIDOR.SIN_CAMBIOS;
    }
    if (condicionVigente) {
      return DECISIONES_RECONCILIACION_PERFIL_SERVIDOR
        .MATERIALIZAR_CONDICION_VIGENTE;
    }
    if (valorPublicado === true) {
      return DECISIONES_RECONCILIACION_PERFIL_SERVIDOR
        .MATERIALIZAR_RECUPERACION;
    }

    return DECISIONES_RECONCILIACION_PERFIL_SERVIDOR
      .ADOPTAR_ESTADO_ACTUAL_SIN_HISTORIA;
  }
}

function exigirBooleano(valor, campo) {
  if (typeof valor !== 'boolean') {
    throw new TypeError(`${campo} debe ser booleano.`);
  }
}

function exigirBooleanoONulo(valor, campo) {
  if (valor !== null && typeof valor !== 'boolean') {
    throw new TypeError(`${campo} debe ser booleano o null.`);
  }
}

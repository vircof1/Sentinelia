export const CAPACIDADES_AGENTES = Object.freeze({
  HEARTBEAT: 'heartbeat',
  SESSION_REFRESH: 'session_refresh',
  EFFECTIVE_CONFIGURATION: 'effective_configuration',
  TELEMETRY: 'telemetry',
  LOGS: 'logs',
  COMMANDS: 'commands',
  DYNAMIC_DNS: 'dynamic_dns'
});

export const CONFIGURACION_EFECTIVA_AGENTE_POR_DEFECTO = Object.freeze({
  heartbeatIntervalSeconds: 30,
  heartbeatGraceSeconds: 90,
  sessionTtlSeconds: 900,
  refreshBeforeSeconds: 120
});

export class ConfiguracionEfectivaAgente {
  constructor({
    revisionConfiguracion = null,
    revisionPolitica = null,
    generadaEnUtc = new Date(),
    politicaVida = {},
    capacidades = null
  } = {}) {
    this.revisionConfiguracion = normalizarTextoOpcional(
      revisionConfiguracion,
      120
    );
    this.revisionPolitica = normalizarTextoOpcional(revisionPolitica, 120);
    this.generadaEnUtc = normalizarFechaServidor(generadaEnUtc);
    this.politicaVida = normalizarPoliticaVida(politicaVida);
    this.capacidades = normalizarCapacidades(capacidades);
  }

  obtenerRespuestaPublica() {
    return {
      revisionConfiguracion: this.revisionConfiguracion,
      revisionPolitica: this.revisionPolitica,
      generadaEnUtc: this.generadaEnUtc,
      politicaVida: { ...this.politicaVida },
      capacidades: this.capacidades.map((capacidad) => ({ ...capacidad }))
    };
  }
}

export function crearConfiguracionEfectivaAgente(datos) {
  return datos instanceof ConfiguracionEfectivaAgente
    ? datos
    : new ConfiguracionEfectivaAgente(datos || {});
}

export function construirCapacidadesAgentePorDefecto() {
  return [
    capacidad(CAPACIDADES_AGENTES.HEARTBEAT, true, 'Prueba de vida POL mínima.'),
    capacidad(
      CAPACIDADES_AGENTES.SESSION_REFRESH,
      true,
      'Renovación de sesión efímera.'
    ),
    capacidad(
      CAPACIDADES_AGENTES.EFFECTIVE_CONFIGURATION,
      true,
      'Lectura de configuración efectiva mínima.'
    ),
    capacidad(
      CAPACIDADES_AGENTES.TELEMETRY,
      false,
      'Reservada para fases futuras.'
    ),
    capacidad(CAPACIDADES_AGENTES.LOGS, false, 'Reservada para fases futuras.'),
    capacidad(
      CAPACIDADES_AGENTES.COMMANDS,
      false,
      'Reservada para fases futuras.'
    ),
    capacidad(
      CAPACIDADES_AGENTES.DYNAMIC_DNS,
      false,
      'Reservada para fases futuras.'
    )
  ];
}

function normalizarPoliticaVida(politicaVida = {}) {
  const sessionTtlSeconds = normalizarEnteroPositivo(
    politicaVida.sessionTtlSeconds ?? politicaVida.sessionTtlSegundos,
    CONFIGURACION_EFECTIVA_AGENTE_POR_DEFECTO.sessionTtlSeconds
  );
  const refreshBeforeSeconds = Math.min(
    normalizarEnteroPositivo(
      politicaVida.refreshBeforeSeconds ?? politicaVida.refreshBeforeSegundos,
      CONFIGURACION_EFECTIVA_AGENTE_POR_DEFECTO.refreshBeforeSeconds
    ),
    sessionTtlSeconds
  );
  const heartbeatIntervalSeconds = normalizarEnteroPositivo(
    politicaVida.heartbeatIntervalSeconds ??
      politicaVida.heartbeatIntervalSegundos,
    CONFIGURACION_EFECTIVA_AGENTE_POR_DEFECTO.heartbeatIntervalSeconds
  );
  const heartbeatGraceSeconds = Math.max(
    normalizarEnteroPositivo(
      politicaVida.heartbeatGraceSeconds ?? politicaVida.heartbeatGraceSegundos,
      CONFIGURACION_EFECTIVA_AGENTE_POR_DEFECTO.heartbeatGraceSeconds
    ),
    heartbeatIntervalSeconds
  );

  return {
    heartbeatIntervalSeconds,
    heartbeatGraceSeconds,
    sessionTtlSeconds,
    refreshBeforeSeconds
  };
}

function normalizarCapacidades(capacidades) {
  if (!Array.isArray(capacidades) || capacidades.length === 0) {
    return construirCapacidadesAgentePorDefecto();
  }

  const conocidas = new Set(Object.values(CAPACIDADES_AGENTES));
  const normalizadasPorCodigo = new Map();

  for (const capacidadDeclarada of capacidades) {
    const normalizada = capacidad(
      capacidadDeclarada?.codigo,
      capacidadDeclarada?.habilitada,
      capacidadDeclarada?.descripcion
    );

    if (
      conocidas.has(normalizada.codigo) &&
      !normalizadasPorCodigo.has(normalizada.codigo)
    ) {
      normalizadasPorCodigo.set(normalizada.codigo, normalizada);
    }
  }

  for (const capacidadBase of construirCapacidadesAgentePorDefecto()) {
    if (!normalizadasPorCodigo.has(capacidadBase.codigo)) {
      normalizadasPorCodigo.set(capacidadBase.codigo, capacidadBase);
    }
  }

  return Array.from(normalizadasPorCodigo.values());
}

function capacidad(codigo, habilitada, descripcion) {
  return {
    codigo: normalizarTexto(codigo, 80),
    habilitada: Boolean(habilitada),
    descripcion: normalizarTextoOpcional(descripcion, 255)
  };
}

function normalizarEnteroPositivo(valor, porDefecto) {
  const convertido = Number.parseInt(String(valor ?? ''), 10);
  return Number.isInteger(convertido) && convertido > 0 ? convertido : porDefecto;
}

function normalizarFechaServidor(valor) {
  const fecha = valor instanceof Date ? valor : new Date(valor);
  return Number.isNaN(fecha.getTime())
    ? new Date().toISOString()
    : fecha.toISOString();
}

function normalizarTexto(valor, longitudMaxima) {
  return String(valor || '').trim().slice(0, longitudMaxima);
}

function normalizarTextoOpcional(valor, longitudMaxima) {
  const normalizado = normalizarTexto(valor, longitudMaxima);
  return normalizado || null;
}

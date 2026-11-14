const DEFINICIONES_TIPOS_MONITOR = Object.freeze([
  Object.freeze({
    valor: 'ping',
    etiqueta: 'Ping',
    descripcion: 'Comprobacion ICMP de disponibilidad y latencia basica.',
    icono: 'broadcast-pin',
    claseCss: 'ping',
    familiaOperativa: 'sondeo_externo',
    ui: Object.freeze({
      tituloListado: 'Monitores Ping',
      subtituloListado:
        'Supervision ICMP con foco en latencia basica, alcance y disponibilidad.',
      ayudaListado:
        'Vista especializada para catalogos ICMP con payload, TTL, timeout y reintentos.',
      etiquetaNuevaEntidad: 'Nuevo ping',
      etiquetaBloqueTipo: 'Parametros ICMP',
      ayudaFormulario:
        'Monitor ICMP con destino, timeout, reintentos, payload y TTL.',
      etiquetaDestino: 'Destino ICMP',
      ayudaDestino: 'Destino ICMP con payload y TTL configurables.',
      etiquetaCrear: 'Crear Ping',
      etiquetaGuardar: 'Guardar Ping'
    }),
    capacidades: Object.freeze({
      ejecutaSondeoExterno: true,
      evaluaEstadoInterno: false,
      admiteProgramacion: true,
      generaEventos: true,
      generaAlertas: true,
      admiteTriggers: true,
      creableDesdePortal: true
    })
  }),
  Object.freeze({
    valor: 'tcp',
    etiqueta: 'TCP',
    descripcion: 'Comprobacion de conectividad TCP y TLS opcional.',
    icono: 'plug',
    claseCss: 'tcp',
    familiaOperativa: 'sondeo_externo',
    ui: Object.freeze({
      tituloListado: 'Monitores TCP',
      subtituloListado:
        'Supervision de conectividad por socket con puerto, timeout y validacion TLS confiable.',
      ayudaListado:
        'Vista especializada para endpoints TCP con puerto explicito y validacion de confianza TLS.',
      etiquetaNuevaEntidad: 'Nuevo TCP',
      etiquetaBloqueTipo: 'Parametros TCP',
      ayudaFormulario:
        'Monitor TCP con host, puerto, timeout, reintentos y validacion TLS confiable.',
      etiquetaDestino: 'Destino TCP',
      ayudaDestino: 'Destino TCP con puerto y TLS opcional.',
      etiquetaCrear: 'Crear TCP',
      etiquetaGuardar: 'Guardar TCP'
    }),
    capacidades: Object.freeze({
      ejecutaSondeoExterno: true,
      evaluaEstadoInterno: false,
      admiteProgramacion: true,
      generaEventos: true,
      generaAlertas: true,
      admiteTriggers: true,
      creableDesdePortal: true
    })
  }),
  Object.freeze({
    valor: 'booleano',
    etiqueta: 'Monitor lógico',
    descripcion:
      'Comportamiento derivado que evalúa entradas internas con lógica booleana acotada.',
    icono: 'diagram-3',
    claseCss: 'booleano',
    familiaOperativa: 'derivado',
    ui: Object.freeze({
      tituloListado: 'Monitores lógicos',
      subtituloListado:
        'Comportamientos derivados que interpretan señales internas y producen una salida monitorizable.',
      ayudaListado:
        'Vista de monitores lógicos: condiciones derivadas con entradas, expresión, salida y triggers por el circuito normal.',
      etiquetaNuevaEntidad: 'Nuevo monitor lógico',
      etiquetaBloqueTipo: 'Lógica operativa',
      ayudaFormulario:
        'Monitor lógico con entradas dinámicas, expresión booleana acotada, salida única y mensaje humano de fallo.',
      etiquetaDestino: 'Entradas lógicas',
      ayudaDestino:
        'Entradas internas que alimentan la expresión. No ejecutan sondeos en cascada; leen el último estado disponible.',
      etiquetaCrear: 'Crear monitor lógico',
      etiquetaGuardar: 'Guardar monitor lógico'
    }),
    capacidades: Object.freeze({
      ejecutaSondeoExterno: false,
      evaluaEstadoInterno: true,
      admiteProgramacion: true,
      generaEventos: true,
      generaAlertas: true,
      admiteTriggers: true,
      creableDesdePortal: false
    })
  }),
  Object.freeze({
    valor: 'telemetria',
    etiqueta: 'Telemetría de agente',
    descripcion:
      'Supervisión de una señal enviada por un agente mediante un criterio operativo.',
    icono: 'activity',
    claseCss: 'telemetria',
    familiaOperativa: 'telemetria',
    ui: Object.freeze({
      tituloListado: 'Monitores de telemetría',
      subtituloListado:
        'Vigila las señales enviadas por los agentes y convierte sus lecturas en estados comprensibles para el equipo.',
      ayudaListado:
        'Cada monitor vigila una señal mediante valores normales definidos aquí o una regla de interpretación reutilizable.',
      etiquetaNuevaEntidad: 'Nuevo monitor de telemetría',
      etiquetaBloqueTipo: 'Señal y criterio de evaluación',
      ayudaFormulario:
        'Elige el agente, la señal que quieres vigilar y qué debe considerarse fuera de lo esperado.',
      etiquetaDestino: 'Señal o regla de interpretación',
      ayudaDestino:
        'Puedes definir los valores normales en este monitor o reutilizar una regla de interpretación existente.',
      etiquetaCrear: 'Crear monitor de telemetría',
      etiquetaGuardar: 'Guardar monitor de telemetría'
    }),
    capacidades: Object.freeze({
      ejecutaSondeoExterno: false,
      evaluaEstadoInterno: true,
      admiteProgramacion: true,
      generaEventos: true,
      generaAlertas: true,
      admiteTriggers: true,
      creableDesdePortal: true
    })
  })
]);

const TIPOS_MONITOR_SOPORTADOS = Object.freeze(
  DEFINICIONES_TIPOS_MONITOR.map((definicion) => definicion.valor)
);

const DEFINICIONES_TIPOS_MONITOR_POR_VALOR = new Map(
  DEFINICIONES_TIPOS_MONITOR.map((definicion) => [definicion.valor, definicion])
);

export function listarDefinicionesTiposMonitor() {
  return DEFINICIONES_TIPOS_MONITOR.map((definicion) =>
    clonarDefinicionTipoMonitor(definicion)
  );
}

export function listarTiposMonitorSoportados() {
  return [...TIPOS_MONITOR_SOPORTADOS];
}

export function normalizarTipoMonitor(valor) {
  return String(valor || '').trim().toLowerCase();
}

export function existeTipoMonitor(valor) {
  return DEFINICIONES_TIPOS_MONITOR_POR_VALOR.has(normalizarTipoMonitor(valor));
}

export function obtenerDefinicionTipoMonitor(valor) {
  const definicion = DEFINICIONES_TIPOS_MONITOR_POR_VALOR.get(
    normalizarTipoMonitor(valor)
  );

  return definicion ? clonarDefinicionTipoMonitor(definicion) : null;
}

export function listarTiposMonitorPorFamilia(familiaOperativa) {
  const familiaNormalizada = String(familiaOperativa || '').trim().toLowerCase();

  return DEFINICIONES_TIPOS_MONITOR
    .filter((definicion) => definicion.familiaOperativa === familiaNormalizada)
    .map((definicion) => clonarDefinicionTipoMonitor(definicion));
}

export function agruparMonitoresPorTipo(items = []) {
  const distribucion = Object.fromEntries(
    TIPOS_MONITOR_SOPORTADOS.map((tipo) => [tipo, 0])
  );

  for (const item of items) {
    const tipo = normalizarTipoMonitor(item?.tipo);
    if (!tipo) {
      continue;
    }

    distribucion[tipo] = Number(distribucion[tipo] || 0) + 1;
  }

  return distribucion;
}

function clonarDefinicionTipoMonitor(definicion) {
  return {
    ...definicion,
    ui: { ...(definicion.ui || {}) },
    capacidades: { ...definicion.capacidades }
  };
}

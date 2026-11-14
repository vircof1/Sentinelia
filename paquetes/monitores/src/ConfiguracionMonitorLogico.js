export const VERSION_CONFIGURACION_MONITOR_LOGICO = 4;
export const VERSION_LAYOUT_VISUAL_MONITOR_LOGICO = 1;
export const VERSION_GRAFO_LOGICO_MONITOR_LOGICO = 1;

export const TIPOS_NODO_GRAFO_LOGICO_MONITOR_LOGICO = Object.freeze([
  'entrada',
  'and',
  'or',
  'not',
  'salida',
  'expresion'
]);

export const FUENTES_SENAL_MONITOR_LOGICO = Object.freeze([
  'monitor',
  'monitor_federado',
  'agente',
  'alerta_agente',
  'evento_plataforma'
]);

export const ESTADOS_INICIALES_MONITOR_LOGICO = Object.freeze([
  'disponible',
  'indisponible'
]);

export const POLITICAS_ENTRADAS_INCOMPLETAS_MONITOR_LOGICO = Object.freeze([
  'conservar_salida'
]);

export const ESTADOS_INICIALES_ENTRADA_FEDERADA_MONITOR_LOGICO = Object.freeze([
  'correcto',
  'fallo'
]);

export const POLITICAS_PERDIDA_ENTRADA_FEDERADA_MONITOR_LOGICO = Object.freeze([
  'forzar_fallo',
  'forzar_correcto',
  'conservar'
]);

export const RETARDO_SENAL_MAXIMO_SEGUNDOS_MONITOR_LOGICO = 86400;

export function crearConfiguracionMonitorLogicoBase(sobrescritura = {}) {
  const configuracion = sobrescritura && typeof sobrescritura === 'object'
    ? sobrescritura
    : {};

  return {
    version: VERSION_CONFIGURACION_MONITOR_LOGICO,
    expresion: String(configuracion.expresion || '').trim(),
    variables: normalizarLista(configuracion.variables),
    dependencias: normalizarLista(configuracion.dependencias),
    mensajeFallo: String(configuracion.mensajeFallo || '').trim(),
    estadoInicial: normalizarEstadoInicial(configuracion.estadoInicial),
    retardoSenalSegundos: normalizarRetardoSenalSegundos(
      configuracion.retardoSenalSegundos
    ),
    politicaEntradasIncompletas: normalizarPoliticaEntradasIncompletas(
      configuracion.politicaEntradasIncompletas
    ),
    layoutVisual: normalizarLayoutVisual(configuracion.layoutVisual)
  };
}

export function normalizarEstadoInicial(valor) {
  const normalizado = String(valor || '').trim().toLowerCase();
  return ESTADOS_INICIALES_MONITOR_LOGICO.includes(normalizado)
    ? normalizado
    : 'disponible';
}

export function normalizarRetardoSenalSegundos(valor) {
  if (valor === undefined || valor === null || String(valor).trim() === '') {
    return 0;
  }

  const convertido = Number.parseInt(String(valor), 10);

  if (
    !Number.isInteger(convertido) ||
    convertido < 0 ||
    convertido > RETARDO_SENAL_MAXIMO_SEGUNDOS_MONITOR_LOGICO
  ) {
    throw new Error(
      `El retardo de señal del monitor lógico debe estar entre 0 y ${RETARDO_SENAL_MAXIMO_SEGUNDOS_MONITOR_LOGICO} segundos.`
    );
  }

  return convertido;
}

export function normalizarPoliticaEntradasIncompletas(valor) {
  const normalizado = String(valor || '').trim().toLowerCase();
  return POLITICAS_ENTRADAS_INCOMPLETAS_MONITOR_LOGICO.includes(normalizado)
    ? normalizado
    : 'conservar_salida';
}

export function normalizarLayoutVisual(valor) {
  const layout = valor && typeof valor === 'object' ? valor : {};

  return {
    version: VERSION_LAYOUT_VISUAL_MONITOR_LOGICO,
    nodos: normalizarLista(layout.nodos),
    conexiones: normalizarLista(layout.conexiones),
    grafoLogico: normalizarGrafoLogicoVisual(layout.grafoLogico || layout)
  };
}

function normalizarLista(valor) {
  return Array.isArray(valor) ? valor : [];
}

export function normalizarGrafoLogicoVisual(valor = {}) {
  const grafo = valor && typeof valor === 'object' ? valor : {};
  const nodosEntrada = normalizarLista(grafo.nodos);
  const conexionesEntrada = normalizarLista(grafo.conexiones);
  const errores = [];
  const ids = new Set();
  const nodos = [];

  nodosEntrada.forEach((nodo, indice) => {
    const normalizado = normalizarNodoGrafoLogico(nodo, indice, errores);

    if (!normalizado) {
      return;
    }

    if (ids.has(normalizado.id)) {
      errores.push(`El nodo "${normalizado.id}" está duplicado.`);
    }

    ids.add(normalizado.id);
    nodos.push(normalizado);
  });

  const conexiones = conexionesEntrada
    .map((conexion, indice) =>
      normalizarConexionGrafoLogico(conexion, indice, errores)
    )
    .filter(Boolean);

  for (const conexion of conexiones) {
    if (!ids.has(conexion.desde)) {
      errores.push(`La conexión sale de un nodo inexistente: "${conexion.desde}".`);
    }

    if (!ids.has(conexion.hasta)) {
      errores.push(`La conexión llega a un nodo inexistente: "${conexion.hasta}".`);
    }
  }

  const salidas = nodos.filter((nodo) => nodo.tipo === 'salida');
  const tieneContenido = nodos.length > 0 || conexiones.length > 0;

  if (salidas.length > 1) {
    errores.push('El grafo lógico solo puede tener una salida.');
  }

  if (tieneContenido && salidas.length === 0) {
    errores.push('El grafo lógico requiere una salida.');
  }

  const salidaId = salidas[0]?.id || null;

  if (
    salidaId &&
    !conexiones.some((conexion) => conexion.hasta === salidaId)
  ) {
    errores.push('La salida del grafo lógico no está conectada.');
  }

  detectarPuertasIncompletasGrafoLogico(nodos, conexiones, errores);
  detectarCiclosGrafoLogico(nodos, conexiones, errores);

  const compilacion = compilarGrafoLogicoNormalizadoAExpresion(
    nodos,
    conexiones,
    salidaId
  );
  errores.push(...compilacion.errores);

  return {
    version: VERSION_GRAFO_LOGICO_MONITOR_LOGICO,
    nodos,
    conexiones,
    salidaId,
    expresionCompilada: compilacion.expresion,
    variablesUsadas: compilacion.variablesUsadas,
    valido: errores.length === 0,
    errores
  };
}

export function compilarGrafoLogicoAExpresion(valor = {}) {
  const grafo = normalizarGrafoLogicoVisual(valor);

  if (!grafo.valido || !grafo.expresionCompilada) {
    throw new Error(
      grafo.errores.length > 0
        ? `El grafo lógico no puede compilarse: ${grafo.errores.join(' ')}`
        : 'El grafo lógico no puede compilarse de forma determinista.'
    );
  }

  return {
    expresion: grafo.expresionCompilada,
    variablesUsadas: grafo.variablesUsadas
  };
}

function compilarGrafoLogicoNormalizadoAExpresion(nodos, conexiones, salidaId) {
  const errores = [];

  if (!salidaId) {
    return { expresion: null, variablesUsadas: [], errores };
  }

  const nodosPorId = new Map(nodos.map((nodo) => [nodo.id, nodo]));
  const entradasPorDestino = new Map();

  for (const conexion of conexiones) {
    if (!entradasPorDestino.has(conexion.hasta)) {
      entradasPorDestino.set(conexion.hasta, []);
    }
    entradasPorDestino.get(conexion.hasta).push(conexion.desde);
  }

  const compilarNodo = function (idNodo, ruta = []) {
    const nodo = nodosPorId.get(idNodo);

    if (!nodo) {
      errores.push(`No se puede compilar el nodo inexistente "${idNodo}".`);
      return null;
    }

    if (ruta.includes(idNodo)) {
      errores.push(`No se puede compilar el ciclo ${[...ruta, idNodo].join(' -> ')}.`);
      return null;
    }

    if (nodo.tipo === 'entrada') {
      const variable = resolverVariableNodoEntrada(nodo);
      if (!variable) {
        errores.push(`La entrada "${nodo.id}" no declara una variable lógica válida.`);
        return null;
      }

      return {
        expresion: variable,
        variablesUsadas: [variable],
        precedencia: 4
      };
    }

    const entradas = entradasPorDestino.get(nodo.id) || [];

    if (nodo.tipo === 'salida' || nodo.tipo === 'expresion') {
      if (entradas.length !== 1) {
        errores.push(
          `El nodo ${nodo.tipo} "${nodo.id}" requiere exactamente una entrada para compilar.`
        );
        return null;
      }

      return compilarNodo(entradas[0], [...ruta, idNodo]);
    }

    if (nodo.tipo === 'not') {
      if (entradas.length !== 1) {
        errores.push(`La puerta NOT "${nodo.id}" requiere exactamente una entrada para compilar.`);
        return null;
      }

      const hijo = compilarNodo(entradas[0], [...ruta, idNodo]);
      if (!hijo) {
        return null;
      }

      return {
        expresion: hijo.precedencia >= 3
          ? `NOT ${hijo.expresion}`
          : `NOT (${hijo.expresion})`,
        variablesUsadas: hijo.variablesUsadas,
        precedencia: 3
      };
    }

    if (nodo.tipo === 'and' || nodo.tipo === 'or') {
      if (entradas.length < 2) {
        errores.push(
          `La puerta ${nodo.tipo.toUpperCase()} "${nodo.id}" requiere al menos dos entradas para compilar.`
        );
        return null;
      }

      const operador = nodo.tipo === 'and' ? 'AND' : 'OR';
      const precedencia = nodo.tipo === 'and' ? 2 : 1;
      const hijos = entradas
        .map((entrada) => compilarNodo(entrada, [...ruta, idNodo]))
        .filter(Boolean);

      if (hijos.length !== entradas.length) {
        return null;
      }

      return {
        expresion: hijos
          .map((hijo) =>
            hijo.precedencia < precedencia
              ? `(${hijo.expresion})`
              : hijo.expresion
          )
          .join(` ${operador} `),
        variablesUsadas: [...new Set(hijos.flatMap((hijo) => hijo.variablesUsadas))].sort(),
        precedencia
      };
    }

    errores.push(`El nodo "${nodo.id}" tiene un tipo no compilable.`);
    return null;
  };

  const resultado = compilarNodo(salidaId);

  return {
    expresion: resultado?.expresion || null,
    variablesUsadas: resultado?.variablesUsadas || [],
    errores
  };
}

function resolverVariableNodoEntrada(nodo) {
  const variableDeclarada = String(nodo.variable || '').trim().toUpperCase();

  if (/^[A-Z]$/.test(variableDeclarada)) {
    return variableDeclarada;
  }

  const coincidenciaEntrada = String(nodo.id || '').match(/(?:entrada[-_:]?)([a-z])$/i);
  if (coincidenciaEntrada) {
    return coincidenciaEntrada[1].toUpperCase();
  }

  const idComoVariable = String(nodo.id || '').trim().toUpperCase();
  return /^[A-Z]$/.test(idComoVariable) ? idComoVariable : null;
}

function normalizarNodoGrafoLogico(nodo, indice, errores) {
  if (!nodo || typeof nodo !== 'object') {
    errores.push(`El nodo visual #${indice + 1} debe ser un objeto.`);
    return null;
  }

  const id = normalizarIdNodoGrafoLogico(nodo.id, indice, errores);
  const tipo = normalizarTipoNodoGrafoLogico(nodo.tipo || nodo.operador);
  const x = normalizarCoordenadaNodoGrafoLogico(nodo.x);
  const y = normalizarCoordenadaNodoGrafoLogico(nodo.y);

  if (!tipo) {
    errores.push(`El nodo "${id}" tiene un tipo lógico no soportado.`);
  }

  return {
    id,
    tipo: tipo || 'entrada',
    etiqueta: String(nodo.etiqueta || nodo.label || '').trim() || null,
    variable: String(nodo.variable || '').trim().toUpperCase() || null,
    x,
    y,
    puertos: normalizarPuertosNodoGrafoLogico(nodo.puertos)
  };
}

function normalizarIdNodoGrafoLogico(valor, indice, errores) {
  const id = String(valor || '').trim();

  if (/^[a-zA-Z0-9_.:-]{1,80}$/.test(id)) {
    return id;
  }

  const fallback = `nodo-${indice + 1}`;
  errores.push(`El nodo visual #${indice + 1} no tiene un identificador estable válido.`);
  return fallback;
}

function normalizarTipoNodoGrafoLogico(valor) {
  const tipo = String(valor || '').trim().toLowerCase();
  const mapaCompatibilidad = {
    operador: 'expresion',
    expression: 'expresion',
    output: 'salida',
    input: 'entrada',
    puerta_and: 'and',
    puerta_or: 'or',
    puerta_not: 'not'
  };
  const normalizado = mapaCompatibilidad[tipo] || tipo;

  return TIPOS_NODO_GRAFO_LOGICO_MONITOR_LOGICO.includes(normalizado)
    ? normalizado
    : null;
}

function normalizarCoordenadaNodoGrafoLogico(valor) {
  const numero = Number(valor);
  return Number.isFinite(numero) ? numero : null;
}

function normalizarPuertosNodoGrafoLogico(puertos) {
  const entrada = normalizarLista(puertos?.entrada || puertos?.entradas)
    .map((puerto) => String(puerto || '').trim())
    .filter(Boolean);
  const salida = normalizarLista(puertos?.salida || puertos?.salidas)
    .map((puerto) => String(puerto || '').trim())
    .filter(Boolean);

  return { entrada, salida };
}

function normalizarConexionGrafoLogico(conexion, indice, errores) {
  if (!conexion || typeof conexion !== 'object') {
    errores.push(`La conexión visual #${indice + 1} debe ser un objeto.`);
    return null;
  }

  const desde = String(conexion.desde || conexion.origen || '').trim();
  const hasta = String(conexion.hasta || conexion.hacia || conexion.destino || '').trim();

  if (!desde || !hasta) {
    errores.push(`La conexión visual #${indice + 1} requiere origen y destino.`);
    return null;
  }

  return {
    desde,
    hasta,
    puertoDesde: String(conexion.puertoDesde || conexion.salida || '').trim() || null,
    puertoHasta: String(conexion.puertoHasta || conexion.entrada || '').trim() || null
  };
}

function detectarPuertasIncompletasGrafoLogico(nodos, conexiones, errores) {
  for (const nodo of nodos) {
    const entradas = conexiones.filter((conexion) => conexion.hasta === nodo.id);

    if ((nodo.tipo === 'and' || nodo.tipo === 'or') && entradas.length < 2) {
      errores.push(`La puerta ${nodo.tipo.toUpperCase()} "${nodo.id}" requiere al menos dos entradas.`);
    }

    if (nodo.tipo === 'not' && entradas.length !== 1) {
      errores.push(`La puerta NOT "${nodo.id}" requiere exactamente una entrada.`);
    }
  }
}

function detectarCiclosGrafoLogico(nodos, conexiones, errores) {
  const ids = new Set(nodos.map((nodo) => nodo.id));
  const adyacencias = new Map(
    nodos.map((nodo) => [nodo.id, []])
  );

  for (const conexion of conexiones) {
    if (ids.has(conexion.desde) && ids.has(conexion.hasta)) {
      adyacencias.get(conexion.desde).push(conexion.hasta);
    }
  }

  const visitados = new Set();
  const enRuta = new Set();

  const visitar = function (idNodo, ruta = []) {
    if (enRuta.has(idNodo)) {
      errores.push(
        `El grafo lógico contiene un ciclo interno (${[...ruta, idNodo].join(' -> ')}).`
      );
      return;
    }

    if (visitados.has(idNodo)) {
      return;
    }

    visitados.add(idNodo);
    enRuta.add(idNodo);

    for (const siguiente of adyacencias.get(idNodo) || []) {
      visitar(siguiente, [...ruta, idNodo]);
    }

    enRuta.delete(idNodo);
  };

  for (const nodo of nodos) {
    visitar(nodo.id);
  }
}

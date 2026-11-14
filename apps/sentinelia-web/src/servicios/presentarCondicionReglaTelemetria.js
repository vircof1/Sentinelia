const OPERADORES = Object.freeze({
  '>': 'mayor que',
  '>=': 'mayor o igual que',
  '<': 'menor que',
  '<=': 'menor o igual que',
  '=': 'igual a',
  '!=': 'distinto de'
});
const OPERADORES_FECHA = Object.freeze({
  '>': 'posterior a',
  '>=': 'posterior o igual a',
  '<': 'anterior a',
  '<=': 'anterior o igual a',
  '=': 'igual a',
  '!=': 'distinta de'
});
const CALIDADES = Object.freeze({ valida: 'válida', incierta: 'incierta', invalida: 'inválida' });

export function presentarCondicionReglaTelemetria(condicion) {
  if (!condicion || typeof condicion !== 'object') {
    return 'Todavía no hay una versión activa.';
  }
  const configuracion = condicion.configuracion;
  if (!configuracion || typeof configuracion !== 'object') {
    return resumenNoDisponible(condicion.tipo);
  }
  const operador = OPERADORES[configuracion.operador];

  switch (condicion.tipo) {
    case 'numero':
      return operador && numeroValido(configuracion.umbral)
        ? `El valor es ${operador} ${configuracion.umbral}${configuracion.unidad ? ` ${configuracion.unidad}` : ''}.`
        : resumenNoDisponible(condicion.tipo);
    case 'duracion':
      return operador && numeroValido(configuracion.umbral)
        ? `La duración es ${operador} ${configuracion.umbral} segundos.`
        : resumenNoDisponible(condicion.tipo);
    case 'momento_utc':
      return operador && typeof configuracion.umbralUtc === 'string'
        ? `La fecha es ${OPERADORES_FECHA[configuracion.operador]} ${configuracion.umbralUtc} (UTC).`
        : resumenNoDisponible(condicion.tipo);
    case 'booleano':
      return operador && typeof configuracion.valorEsperado === 'boolean'
        ? `El valor es ${operador} ${configuracion.valorEsperado ? 'verdadero' : 'falso'}.`
        : resumenNoDisponible(condicion.tipo);
    case 'estado':
    case 'texto':
      return operador && typeof configuracion.valorEsperado === 'string'
        ? `El ${condicion.tipo === 'estado' ? 'estado' : 'texto'} es ${operador} ${entreComillas(configuracion.valorEsperado)}.`
        : resumenNoDisponible(condicion.tipo);
    case 'calidad':
      return operador && typeof configuracion.calidadEsperada === 'string'
        ? `La calidad de la lectura es ${configuracion.operador === '!=' ? 'distinta de' : 'igual a'} ${CALIDADES[configuracion.calidadEsperada] || configuracion.calidadEsperada}.`
        : resumenNoDisponible(condicion.tipo);
    case 'texto_regex':
      return presentarPatron(configuracion);
    case 'momento_utc_relativo':
      return presentarMomentoRelativo(configuracion);
    default:
      return resumenNoDisponible(condicion.tipo);
  }
}

function presentarPatron(configuracion) {
  if (typeof configuracion.patron !== 'string' || !Array.isArray(configuracion.opciones)) {
    return resumenNoDisponible('texto_regex');
  }
  const patron = `/${configuracion.patron.length > 72
    ? `${configuracion.patron.slice(0, 72)}…`
    : configuracion.patron}/${configuracion.opciones.join('')}`;
  if (configuracion.modo === 'existe') {
    return `El texto contiene una coincidencia del patrón ${patron}.`;
  }
  const operador = OPERADORES[configuracion.operador];
  return configuracion.modo === 'conteo' && operador && Number.isSafeInteger(configuracion.umbral)
    ? `El número de coincidencias del patrón ${patron} es ${operador} ${configuracion.umbral}.`
    : resumenNoDisponible('texto_regex');
}

function presentarMomentoRelativo(configuracion) {
  const limite = presentarLimite(configuracion.limite);
  if (configuracion.forma === 'limite_inferior' && limite) {
    return `La fecha es anterior a ${limite}${presentarMargen(configuracion.histeresisSegundos)}.`;
  }
  if (configuracion.forma === 'limite_superior' && limite) {
    return `La fecha es posterior a ${limite}${presentarMargen(configuracion.histeresisSegundos)}.`;
  }
  const inferior = presentarLimite(configuracion.limiteInferior);
  const superior = presentarLimite(configuracion.limiteSuperior);
  if (configuracion.forma === 'fuera_intervalo' && inferior && superior) {
    const margenInferior = presentarMargen(configuracion.histeresisInferiorSegundos);
    const margenSuperior = presentarMargen(configuracion.histeresisSuperiorSegundos);
    return `La fecha queda fuera del intervalo entre ${inferior} y ${superior}${margenInferior || margenSuperior ? ' (con márgenes de estabilidad)' : ''}.`;
  }
  return resumenNoDisponible('momento_utc_relativo');
}

function presentarLimite(limite) {
  if (!limite || !/^(0|[1-9][0-9]*)$/u.test(String(limite.segundos))) return null;
  if (limite.direccion === 'ahora' && String(limite.segundos) === '0') return 'ahora';
  if (!['pasado', 'futuro'].includes(limite.direccion)) return null;
  const segundos = BigInt(limite.segundos);
  if (segundos === 0n) return null;
  const unidades = [
    [604800n, 'semana'], [86400n, 'día'], [3600n, 'hora'], [60n, 'minuto']
  ];
  const unidad = unidades.find(([factor]) => segundos % factor === 0n);
  const cantidad = unidad ? segundos / unidad[0] : segundos;
  const nombre = unidad?.[1] || 'segundo';
  return `ahora ${limite.direccion === 'pasado' ? '−' : '+'} ${cantidad} ${nombre}${cantidad === 1n ? '' : 's'}`;
}

function presentarMargen(segundos) {
  return segundos != null && String(segundos) !== '0'
    ? ` (margen de estabilidad: ${segundos} s)`
    : '';
}

function entreComillas(valor) {
  return `«${valor.length > 72 ? `${valor.slice(0, 72)}…` : valor}»`;
}

function numeroValido(valor) {
  return typeof valor === 'number' && Number.isFinite(valor);
}

function resumenNoDisponible(tipo) {
  return `Condición de ${tipo || 'tipo desconocido'}. Abre los detalles para consultar su definición.`;
}

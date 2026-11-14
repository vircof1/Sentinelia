export const PERFIL_REFERENCIA_CONTENIDO_SENSIBLE_FEDERACION =
  'sentinelia-federacion-referencia-contenido-sensible-v1';

export function separarContenidoSensibleFederacion(datos) {
  const publico = clonar(datos);
  const contenidoSensible = {};
  for (const [campo, declaracion] of Object.entries(publico.campos || {})) {
    if (declaracion?.estado !== 'presente' || declaracion.sensibilidad !== 'sensible') continue;
    contenidoSensible[campo] = declaracion.valor;
    declaracion.valor = {
      perfil: PERFIL_REFERENCIA_CONTENIDO_SENSIBLE_FEDERACION,
      campo
    };
  }
  return Object.freeze({
    publico,
    contenidoSensible: Object.keys(contenidoSensible).length
      ? contenidoSensible
      : null
  });
}

export function listarReferenciasContenidoSensibleFederacion(publico) {
  return Object.entries(publico.campos || {})
    .filter(([campo, declaracion]) =>
      declaracion?.estado === 'presente' &&
      declaracion.sensibilidad === 'sensible' &&
      declaracion.valor?.perfil === PERFIL_REFERENCIA_CONTENIDO_SENSIBLE_FEDERACION &&
      declaracion.valor?.campo === campo)
    .map(([campo]) => campo);
}

export function restaurarContenidoSensibleFederacion(publico, sensible) {
  const completa = clonar(publico);
  for (const campo of listarReferenciasContenidoSensibleFederacion(completa)) {
    if (!Object.hasOwn(sensible || {}, campo)) {
      throw new Error('La custodia sensible no contiene todos los campos referenciados.');
    }
    completa.campos[campo].valor = sensible[campo];
  }
  return completa;
}

function clonar(valor) {
  return JSON.parse(JSON.stringify(valor));
}

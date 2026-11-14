import {
  crearIdentidadFederada,
  TIPOS_IDENTIDAD_FEDERADA
} from './IdentidadFederada.js';
import {
  crearDeclaracionConcesionFederacion,
  esConcesionEfectivaFederacion,
  esDeclaracionConcesionFederacion
} from './AutoridadConcesionFederacion.js';
import { normalizarJsonFederacion } from './CanonicalizadorFederacion.js';

export function crearRevisionConcesionFederacion({
  revisionId,
  papel,
  seleccion
} = {}) {
  const identidad = crearIdentidadFederada({
    tipo: TIPOS_IDENTIDAD_FEDERADA.REVISION_CONCESION,
    valor: revisionId
  });
  if (!['oferta', 'aceptacion', 'efectiva'].includes(papel)) {
    throw new Error('El papel de la revisión de concesión no es válido.');
  }
  let datos;
  if (papel === 'efectiva') {
    if (!esConcesionEfectivaFederacion(seleccion)) {
      throw new Error('La revisión efectiva exige una concesión efectiva nominal.');
    }
    datos = seleccion.toJSON();
  } else {
    if (!esDeclaracionConcesionFederacion(seleccion)) {
      throw new Error('Oferta y aceptación exigen una declaración nominal.');
    }
    datos = seleccion.toJSON();
  }
  return Object.freeze({
    revisionId: identidad.toString(),
    papel,
    seleccion: normalizarJsonFederacion(datos)
  });
}

export function hidratarDeclaracionConcesionFederacion(datos) {
  const normalizados = normalizarJsonFederacion(datos);
  return crearDeclaracionConcesionFederacion({
    activa: normalizados.activa,
    nivelesScope: normalizados.nivelesScope,
    familias: normalizados.familias
  });
}

export function compararSeleccionesConcesionFederacion(anterior, posterior) {
  const a = normalizarSeleccion(anterior);
  const b = normalizarSeleccion(posterior);
  const posteriorIncluida = seleccionIncluida(b, a);
  const anteriorIncluida = seleccionIncluida(a, b);
  if (posteriorIncluida && anteriorIncluida) return 'equivalente';
  if (posteriorIncluida) return 'reduccion';
  if (anteriorIncluida) return 'ampliacion';
  return 'mixta';
}

function normalizarSeleccion(valor) {
  const datos = typeof valor?.toJSON === 'function' ? valor.toJSON() : valor;
  const resultado = normalizarJsonFederacion(datos);
  if (!resultado || typeof resultado !== 'object' || Array.isArray(resultado)) {
    throw new Error('La selección de concesión no es válida.');
  }
  return resultado;
}

function seleccionIncluida(candidata, limite) {
  if (candidata.activa && !limite.activa) return false;
  if (!incluida(candidata.nivelesScope || [], limite.nivelesScope || [])) return false;
  for (const [familia, seleccion] of Object.entries(candidata.familias || {})) {
    const autorizada = limite.familias?.[familia];
    if (!autorizada) return false;
    if (!incluida(seleccion.campos, autorizada.campos)) return false;
    if (seleccion.permiteContenidoSensible && !autorizada.permiteContenidoSensible) return false;
    if (seleccion.permiteRefederacion && !autorizada.permiteRefederacion) return false;
  }
  return true;
}

function incluida(valores, limite) {
  const permitidos = new Set(limite);
  return valores.every((valor) => permitidos.has(valor));
}

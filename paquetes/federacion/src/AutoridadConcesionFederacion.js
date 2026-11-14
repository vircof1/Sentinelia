import {
  FAMILIAS_FEDERACION,
  NIVELES_SCOPE_FEDERACION
} from './CatalogosFederacion.js';
import { normalizarJsonFederacion } from './CanonicalizadorFederacion.js';
import {
  esScopeFederacion,
  profundidadFederablePorScope,
  scopeFederacionCubre
} from './ScopeFederacion.js';

const ORDEN_NIVELES = Object.freeze({ portal: 0, tenant: 1, empresa: 2, sitio: 3 });
const RESPONSABILIDADES_FEDERADAS = new WeakSet();
const DECLARACIONES_CONCESION_FEDERACION = new WeakSet();
const CONCESIONES_EFECTIVAS_FEDERACION = new WeakSet();
const AUTORIDADES_ACTUALES_FEDERACION = new WeakSet();

export class ErrorAutoridadFederacion extends Error {
  constructor(codigo, mensaje, { campo = null } = {}) {
    super(mensaje);
    this.name = 'ErrorAutoridadFederacion';
    this.codigo = codigo;
    this.campo = campo;
  }
}

class ResponsabilidadFederada {
  #usuarioId;
  #activa;
  #scopeActual;
  #permisos;

  constructor({ usuarioId, activa, scopeActual, permisos }) {
    this.#usuarioId = usuarioId;
    this.#activa = activa;
    this.#scopeActual = scopeActual;
    this.#permisos = new Set(permisos);
    RESPONSABILIDADES_FEDERADAS.add(this);
    Object.freeze(this);
  }

  get usuarioId() {
    return this.#usuarioId;
  }

  get activa() {
    return this.#activa;
  }

  get scopeActual() {
    return this.#scopeActual;
  }

  poseePermiso(permiso) {
    return this.#permisos.has(permiso);
  }

  toJSON() {
    return normalizarJsonFederacion({
      usuarioId: this.#usuarioId,
      activa: this.#activa,
      scopeActual: this.#scopeActual.toJSON(),
      permisos: [...this.#permisos].sort()
    });
  }
}

class DeclaracionConcesionFederacion {
  #datos;

  constructor(datos) {
    this.#datos = normalizarJsonFederacion(datos);
    Object.freeze(this);
  }

  toJSON() {
    return this.#datos;
  }
}

class ConcesionEfectivaFederacion extends DeclaracionConcesionFederacion {
  constructor(datos) {
    super(datos);
    CONCESIONES_EFECTIVAS_FEDERACION.add(this);
  }
}

class AutoridadActualFederacion extends DeclaracionConcesionFederacion {
  constructor(datos) {
    super(datos);
    AUTORIDADES_ACTUALES_FEDERACION.add(this);
  }
}

export function crearResponsabilidadFederada({
  usuarioId,
  activa = true,
  scopeActual,
  permisos = []
} = {}) {
  exigirTexto(usuarioId, 'usuarioId');
  exigirBooleano(activa, 'activa');
  if (!esScopeFederacion(scopeActual)) {
    fallar('scope_actual_invalido', 'La responsabilidad necesita un scope actual.', 'scopeActual');
  }
  const permisosNormalizados = normalizarTextosUnicos(permisos, 'permisos');
  return new ResponsabilidadFederada({
    usuarioId,
    activa,
    scopeActual,
    permisos: permisosNormalizados
  });
}

export function evaluarAutoridadResponsabilidadFederada({
  responsabilidad,
  scopeLocalMaterializado,
  nivelFederado,
  permisoRequerido
} = {}) {
  if (!RESPONSABILIDADES_FEDERADAS.has(responsabilidad)) {
    fallar(
      'responsabilidad_invalida',
      'Debe evaluarse una responsabilidad federada válida.',
      'responsabilidad'
    );
  }
  if (!esScopeFederacion(scopeLocalMaterializado)) {
    fallar(
      'scope_materializado_invalido',
      'El scope local materializado no es válido.',
      'scopeLocalMaterializado'
    );
  }
  NIVELES_SCOPE_FEDERACION.exigir(nivelFederado);
  exigirTexto(permisoRequerido, 'permisoRequerido');
  const causas = [];
  if (!responsabilidad.activa) causas.push('responsableInactivo');
  if (!scopeFederacionCubre(responsabilidad.scopeActual, scopeLocalMaterializado)) {
    causas.push('scopeLocalFueraDeAutoridad');
  }
  if (!profundidadFederablePorScope({
    scopeAutoridad: responsabilidad.scopeActual,
    nivelFederado
  })) {
    causas.push('profundidadFederadaNoDelegable');
  }
  if (!responsabilidad.poseePermiso(permisoRequerido)) {
    causas.push('permisoActualAusente');
  }
  return normalizarJsonFederacion({
    autorizada: causas.length === 0,
    causas
  });
}

export function crearDeclaracionConcesionFederacion({
  activa = true,
  nivelesScope,
  familias
} = {}) {
  exigirBooleano(activa, 'activa');
  const niveles = normalizarNiveles(nivelesScope);
  const familiasNormalizadas = normalizarFamilias(familias);
  const declaracion = new DeclaracionConcesionFederacion({
    activa,
    nivelesScope: niveles,
    familias: familiasNormalizadas
  });
  DECLARACIONES_CONCESION_FEDERACION.add(declaracion);
  return declaracion;
}

export function crearLimitesAutoridadActualFederacion({
  responsabilidad,
  permisoRequerido,
  scopeLocalConfiguracion,
  nivelesScope,
  familias
} = {}) {
  if (!RESPONSABILIDADES_FEDERADAS.has(responsabilidad)) {
    fallar(
      'responsabilidad_invalida',
      'Los límites actuales deben derivarse de una responsabilidad válida.',
      'responsabilidad'
    );
  }
  if (!esScopeFederacion(scopeLocalConfiguracion)) {
    fallar(
      'scope_configuracion_invalido',
      'Los limites actuales necesitan el scope local concreto de la configuracion.',
      'scopeLocalConfiguracion'
    );
  }
  exigirTexto(permisoRequerido, 'permisoRequerido');
  const nivelesSolicitados = normalizarNiveles(nivelesScope);
  const nivelesAutorizados = nivelesSolicitados.filter((nivelFederado) =>
    profundidadFederablePorScope({
      scopeAutoridad: responsabilidad.scopeActual,
      nivelFederado
    }));
  const causas = [];
  if (!responsabilidad.activa) causas.push('responsableInactivo');
  if (!scopeFederacionCubre(
    responsabilidad.scopeActual,
    scopeLocalConfiguracion
  )) {
    causas.push('scopeLocalFueraDeAutoridad');
  }
  if (!responsabilidad.poseePermiso(permisoRequerido)) {
    causas.push('permisoActualAusente');
  }
  if (nivelesAutorizados.length === 0) {
    causas.push('profundidadFederadaNoDelegable');
  }
  const tieneAutoridad = causas.length === 0;
  return new AutoridadActualFederacion({
    activa: tieneAutoridad,
    scopeLocalConfiguracion: scopeLocalConfiguracion.toJSON(),
    causas,
    nivelesScope: tieneAutoridad ? nivelesAutorizados : [],
    familias: tieneAutoridad ? normalizarFamilias(familias) : {}
  });
}

export function crearLimitesAutoridadRemotaDeclaradaFederacion({
  declaracion
} = {}) {
  if (!DECLARACIONES_CONCESION_FEDERACION.has(declaracion)) {
    fallar(
      'declaracion_remota_invalida',
      'La autoridad remota debe proceder de una declaración validada.',
      'declaracion'
    );
  }
  const datos = declaracion.toJSON();
  return new AutoridadActualFederacion({
    activa: datos.activa,
    scopeLocalConfiguracion: null,
    causas: [],
    nivelesScope: datos.nivelesScope,
    familias: datos.familias
  });
}

export function calcularConcesionEfectivaFederacion({
  ofertaEmisora,
  aceptacionReceptora,
  autoridadActualEmisora,
  autoridadActualReceptora
} = {}) {
  const selecciones = [ofertaEmisora, aceptacionReceptora];
  for (const [indice, declaracion] of selecciones.entries()) {
    if (!esSeleccionConcesionFederacion(declaracion)) {
      fallar(
        'declaracion_concesion_invalida',
        'La concesión bilateral requiere cuatro declaraciones válidas.',
        `selecciones[${indice}]`
      );
    }
  }
  for (const [indice, autoridad] of [
    autoridadActualEmisora,
    autoridadActualReceptora
  ].entries()) {
    if (!AUTORIDADES_ACTUALES_FEDERACION.has(autoridad)) {
      fallar(
        'autoridad_actual_invalida',
        'La concesión exige límites derivados de cada responsabilidad actual.',
        `autoridades[${indice}]`
      );
    }
  }
  const declaraciones = [
    ...selecciones,
    autoridadActualEmisora,
    autoridadActualReceptora
  ];
  const datos = declaraciones.map((declaracion) => declaracion.toJSON());
  const activa = datos.every((declaracion) => declaracion.activa);
  const nivelesScope = intersectarListas(datos.map((declaracion) => declaracion.nivelesScope))
    .sort((a, b) => ORDEN_NIVELES[a] - ORDEN_NIVELES[b]);
  const nombresFamilia = intersectarListas(
    datos.map((declaracion) => Object.keys(declaracion.familias))
  ).sort();
  const familias = Object.fromEntries(nombresFamilia.map((familia) => {
    const limites = datos.map((declaracion) => declaracion.familias[familia]);
    return [familia, {
      campos: intersectarListas(limites.map((limite) => limite.campos)).sort(),
      permiteContenidoSensible: limites.every(
        (limite) => limite.permiteContenidoSensible
      ),
      permiteRefederacion: limites.every((limite) => limite.permiteRefederacion)
    }];
  }));
  const vacia = !activa || nivelesScope.length === 0 || nombresFamilia.length === 0;
  return new ConcesionEfectivaFederacion({
    activa: activa && !vacia,
    vacia,
    nivelesScope: vacia ? [] : nivelesScope,
    familias: vacia ? {} : familias
  });
}

export function esResponsabilidadFederada(valor) {
  return RESPONSABILIDADES_FEDERADAS.has(valor);
}

export function esDeclaracionConcesionFederacion(valor) {
  return esSeleccionConcesionFederacion(valor);
}

export function esConcesionEfectivaFederacion(valor) {
  return CONCESIONES_EFECTIVAS_FEDERACION.has(valor);
}

export function esLimiteAutoridadActualFederacion(valor) {
  return AUTORIDADES_ACTUALES_FEDERACION.has(valor);
}

function esSeleccionConcesionFederacion(valor) {
  return DECLARACIONES_CONCESION_FEDERACION.has(valor);
}

function normalizarNiveles(niveles) {
  niveles = normalizarEntradaJsonAutoridad(
    niveles,
    'niveles_scope_invalidos',
    'Una declaración debe contener niveles de scope como datos JSON.',
    'nivelesScope'
  );
  if (!Array.isArray(niveles) || niveles.length === 0) {
    fallar(
      'niveles_scope_invalidos',
      'Una declaración debe contener al menos un nivel de scope.',
      'nivelesScope'
    );
  }
  const normalizados = niveles.map((nivel) => NIVELES_SCOPE_FEDERACION.exigir(nivel));
  if (new Set(normalizados).size !== normalizados.length) {
    fallar('niveles_scope_duplicados', 'Los niveles de scope no pueden repetirse.', 'nivelesScope');
  }
  return Object.freeze(normalizados.sort((a, b) => ORDEN_NIVELES[a] - ORDEN_NIVELES[b]));
}

function normalizarFamilias(familias) {
  familias = normalizarEntradaJsonAutoridad(
    familias,
    'familias_invalidas',
    'Las familias deben declararse como un objeto JSON de datos.',
    'familias'
  );
  if (!familias || typeof familias !== 'object' || Array.isArray(familias)) {
    fallar('familias_invalidas', 'Las familias deben declararse como objeto.', 'familias');
  }
  const resultado = [];
  for (const [familia, limites] of Object.entries(familias)) {
    FAMILIAS_FEDERACION.exigir(familia);
    if (!limites || typeof limites !== 'object' || Array.isArray(limites)) {
      fallar('limite_familia_invalido', `La familia ${familia} no tiene límites válidos.`, familia);
    }
    const claves = Object.keys(limites).sort();
    const esperadas = ['campos', 'permiteContenidoSensible', 'permiteRefederacion'];
    if (
      claves.length !== esperadas.length ||
      claves.some((clave, indice) => clave !== esperadas[indice])
    ) {
      fallar('limite_familia_invalido', `La familia ${familia} no usa la forma cerrada.`, familia);
    }
    exigirBooleano(limites.permiteContenidoSensible, `${familia}.permiteContenidoSensible`);
    exigirBooleano(limites.permiteRefederacion, `${familia}.permiteRefederacion`);
    resultado.push([familia, {
      campos: normalizarTextosUnicos(limites.campos, `${familia}.campos`),
      permiteContenidoSensible: limites.permiteContenidoSensible,
      permiteRefederacion: limites.permiteRefederacion
    }]);
  }
  return normalizarJsonFederacion(Object.fromEntries(resultado));
}

function intersectarListas(listas) {
  if (listas.length === 0) return [];
  const restantes = listas.slice(1).map((lista) => new Set(lista));
  return listas[0].filter((valor) => restantes.every((set) => set.has(valor)));
}

function normalizarTextosUnicos(valores, campo) {
  valores = normalizarEntradaJsonAutoridad(
    valores,
    'lista_textos_invalida',
    `${campo} debe contener textos únicos como datos JSON.`,
    campo
  );
  if (
    !Array.isArray(valores) ||
    valores.some((valor) => typeof valor !== 'string' || valor.length === 0) ||
    new Set(valores).size !== valores.length
  ) {
    fallar('lista_textos_invalida', `${campo} debe contener textos únicos.`, campo);
  }
  return Object.freeze([...valores].sort());
}

function normalizarEntradaJsonAutoridad(valor, codigo, mensaje, campo) {
  try {
    return normalizarJsonFederacion(valor);
  } catch {
    fallar(codigo, mensaje, campo);
  }
}

function exigirTexto(valor, campo) {
  if (typeof valor !== 'string' || valor.length === 0) {
    fallar('texto_invalido', `${campo} debe ser un texto no vacío.`, campo);
  }
}

function exigirBooleano(valor, campo) {
  if (typeof valor !== 'boolean') {
    fallar('booleano_invalido', `${campo} debe ser booleano.`, campo);
  }
}

function fallar(codigo, mensaje, campo) {
  throw new ErrorAutoridadFederacion(codigo, mensaje, { campo });
}

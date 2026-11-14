import { NIVELES_SCOPE_FEDERACION } from './CatalogosFederacion.js';
import { normalizarJsonFederacion } from './CanonicalizadorFederacion.js';

const PROFUNDIDAD_SCOPE = Object.freeze({
  portal: 0,
  tenant: 1,
  empresa: 2,
  sitio: 3
});
const SCOPES_FEDERACION = new WeakSet();

export class ErrorScopeFederacion extends Error {
  constructor(codigo, mensaje, { campo = null } = {}) {
    super(mensaje);
    this.name = 'ErrorScopeFederacion';
    this.codigo = codigo;
    this.campo = campo;
  }
}

class ScopeFederacion {
  #datos;

  constructor(datos) {
    this.#datos = normalizarJsonFederacion(datos);
    SCOPES_FEDERACION.add(this);
    Object.freeze(this);
  }

  get nivel() {
    return this.#datos.nivel;
  }

  get profundidad() {
    return PROFUNDIDAD_SCOPE[this.#datos.nivel];
  }

  toJSON() {
    return this.#datos;
  }
}

export function crearScopeFederacion(entrada = {}) {
  const normalizada = normalizarEntradaScope(entrada);
  const {
    nivel,
    tenantId = null,
    empresaId = null,
    sitioId = null
  } = normalizada;
  const nivelValidado = NIVELES_SCOPE_FEDERACION.exigir(nivel);
  const identidades = { tenantId, empresaId, sitioId };
  validarFormaScope(nivelValidado, identidades);
  return new ScopeFederacion({ nivel: nivelValidado, ...identidades });
}

export function esScopeFederacion(valor) {
  return SCOPES_FEDERACION.has(valor);
}

export function profundidadScopeFederacion(scope) {
  return exigirScope(scope, 'scope').profundidad;
}

export function profundidadFederablePorScope({ scopeAutoridad, nivelFederado } = {}) {
  const autoridad = exigirScope(scopeAutoridad, 'scopeAutoridad');
  const nivel = NIVELES_SCOPE_FEDERACION.exigir(nivelFederado);
  return PROFUNDIDAD_SCOPE[nivel] >= autoridad.profundidad;
}

export function scopeFederacionCubre(scopeSuperior, scopeObjetivo) {
  const superior = exigirScope(scopeSuperior, 'scopeSuperior');
  const objetivo = exigirScope(scopeObjetivo, 'scopeObjetivo');
  if (superior.profundidad > objetivo.profundidad) return false;
  const datosSuperior = superior.toJSON();
  const datosObjetivo = objetivo.toJSON();
  for (const campo of ['tenantId', 'empresaId', 'sitioId']) {
    if (
      datosSuperior[campo] !== null &&
      datosSuperior[campo] !== datosObjetivo[campo]
    ) {
      return false;
    }
  }
  return true;
}

export function puedeMaterializarEnScopeFederacion({
  scopeAutoridad,
  scopeLocalMaterializado
} = {}) {
  return scopeFederacionCubre(scopeAutoridad, scopeLocalMaterializado);
}

export function puedeVerScopeFederacion({ scopeUsuario, scopeRecurso } = {}) {
  return scopeFederacionCubre(scopeUsuario, scopeRecurso);
}

function validarFormaScope(nivel, identidades) {
  const profundidad = PROFUNDIDAD_SCOPE[nivel];
  const campos = ['tenantId', 'empresaId', 'sitioId'];
  for (const [indice, campo] of campos.entries()) {
    const requerido = indice < profundidad;
    const valor = identidades[campo];
    if (requerido) {
      if (typeof valor !== 'string' || valor.trim().length === 0) {
        fallar(
          'identidad_scope_requerida',
          `${campo} es obligatorio para un scope ${nivel}.`,
          campo
        );
      }
    } else if (valor !== null) {
      fallar(
        'identidad_scope_fuera_nivel',
        `${campo} debe ser null para un scope ${nivel}.`,
        campo
      );
    }
  }
}

function normalizarEntradaScope(entrada) {
  let normalizada;
  try {
    normalizada = normalizarJsonFederacion(entrada);
  } catch {
    fallar(
      'forma_scope_invalida',
      'El scope debe ser un objeto JSON plano.',
      'scope'
    );
  }
  if (
    normalizada === null ||
    typeof normalizada !== 'object' ||
    Array.isArray(normalizada)
  ) {
    fallar(
      'forma_scope_invalida',
      'El scope debe ser un objeto JSON plano.',
      'scope'
    );
  }
  const admitidas = new Set(['nivel', 'tenantId', 'empresaId', 'sitioId']);
  const desconocida = Object.keys(normalizada).find(
    (clave) => !admitidas.has(clave)
  );
  if (desconocida !== undefined) {
    fallar(
      'campo_scope_desconocido',
      `El scope contiene el campo no contractual ${desconocida}.`,
      desconocida
    );
  }
  return normalizada;
}

function exigirScope(valor, campo) {
  if (!SCOPES_FEDERACION.has(valor)) {
    fallar(
      'scope_invalido',
      `${campo} debe ser un value object de scope federado.`,
      campo
    );
  }
  return valor;
}

function fallar(codigo, mensaje, campo) {
  throw new ErrorScopeFederacion(codigo, mensaje, { campo });
}

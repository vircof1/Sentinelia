import {
  CAPACIDADES_COMPLETITUD_FEDERACION,
  FAMILIAS_FEDERACION
} from './CatalogosFederacion.js';

export const VERSION_GRAFO_DEPENDENCIAS_FAMILIAS_FEDERACION = 1;
export const PERFIL_GRAFO_DEPENDENCIAS_FAMILIAS_FEDERACION =
  'sentinelia-federacion-dependencias-familias-v1';

const TIPOS_DEPENDENCIA = new Set(['obligatoria', 'opcional']);

export class ErrorDependenciasFamiliasFederacion extends Error {
  constructor(codigo, mensaje, { familia = null, dependencia = null } = {}) {
    super(mensaje);
    this.name = 'ErrorDependenciasFamiliasFederacion';
    this.codigo = codigo;
    this.familia = familia;
    this.dependencia = dependencia;
  }
}

export class GrafoDependenciasFamiliasFederacion {
  #declaraciones;

  constructor({
    version = VERSION_GRAFO_DEPENDENCIAS_FAMILIAS_FEDERACION,
    declaraciones = []
  } = {}) {
    if (!Number.isInteger(version) || version < 1) {
      throw new ErrorDependenciasFamiliasFederacion(
        'version_grafo_invalida',
        'El grafo de familias necesita una versión positiva.'
      );
    }
    if (!Array.isArray(declaraciones)) {
      throw new ErrorDependenciasFamiliasFederacion(
        'declaraciones_dependencias_invalidas',
        'Las dependencias de familias deben declararse como una lista.'
      );
    }
    this.version = version;
    this.perfil = PERFIL_GRAFO_DEPENDENCIAS_FAMILIAS_FEDERACION;
    this.#declaraciones = normalizarDeclaraciones(declaraciones);
    exigirAusenciaCiclosObligatorios(this.#declaraciones);
    Object.freeze(this);
  }

  obtener(familia) {
    const nombre = exigirFamilia(familia);
    return this.#declaraciones.get(nombre) || declaracionVacia(nombre);
  }

  listar() {
    return Object.freeze(FAMILIAS_FEDERACION.valores.map((familia) =>
      this.obtener(familia)
    ));
  }

  resolverCierre(familias, { incluirOpcionales = false } = {}) {
    if (!Array.isArray(familias) || familias.length === 0) {
      throw new ErrorDependenciasFamiliasFederacion(
        'seleccion_familias_invalida',
        'El cierre necesita al menos una familia seleccionada.'
      );
    }
    if (typeof incluirOpcionales !== 'boolean') {
      throw new ErrorDependenciasFamiliasFederacion(
        'seleccion_dependencias_opcionales_invalida',
        'incluirOpcionales debe ser booleano.'
      );
    }
    const seleccionadas = [...new Set(familias.map(exigirFamilia))];
    const visitadas = new Set();
    const resultado = [];
    const visitar = (familia) => {
      if (visitadas.has(familia)) return;
      visitadas.add(familia);
      const declaracion = this.obtener(familia);
      const dependencias = declaracion.dependencias.filter(
        (entrada) => entrada.tipo === 'obligatoria' || incluirOpcionales
      );
      for (const dependencia of dependencias) visitar(dependencia.familia);
      resultado.push(familia);
    };
    for (const familia of seleccionadas) visitar(familia);
    return Object.freeze(resultado);
  }

  toJSON() {
    return Object.freeze({
      perfil: this.perfil,
      version: this.version,
      declaraciones: this.listar()
    });
  }
}

function normalizarDeclaraciones(declaraciones) {
  const resultado = new Map();
  for (const entrada of declaraciones) {
    const familia = exigirFamilia(entrada?.familia);
    if (resultado.has(familia)) {
      throw new ErrorDependenciasFamiliasFederacion(
        'familia_dependencias_duplicada',
        `La familia ${familia} repite su declaración de dependencias.`,
        { familia }
      );
    }
    if (!Array.isArray(entrada?.dependencias)) {
      throw new ErrorDependenciasFamiliasFederacion(
        'dependencias_familia_invalidas',
        `La familia ${familia} debe declarar una lista de dependencias.`,
        { familia }
      );
    }
    const vistas = new Set();
    const dependencias = entrada.dependencias.map((dependencia) => {
      const nombre = exigirFamilia(dependencia?.familia);
      const tipo = dependencia?.tipo;
      if (nombre === familia) {
        throw new ErrorDependenciasFamiliasFederacion(
          'dependencia_reflexiva',
          `La familia ${familia} no puede depender de sí misma.`,
          { familia, dependencia: nombre }
        );
      }
      if (!TIPOS_DEPENDENCIA.has(tipo)) {
        throw new ErrorDependenciasFamiliasFederacion(
          'tipo_dependencia_invalido',
          `La dependencia ${familia} -> ${nombre} no declara un tipo válido.`,
          { familia, dependencia: nombre }
        );
      }
      if (vistas.has(nombre)) {
        throw new ErrorDependenciasFamiliasFederacion(
          'dependencia_duplicada',
          `La familia ${familia} repite la dependencia ${nombre}.`,
          { familia, dependencia: nombre }
        );
      }
      vistas.add(nombre);
      const capacidades = normalizarCapacidades(dependencia?.capacidades, {
        familia,
        dependencia: nombre
      });
      return Object.freeze({ familia: nombre, tipo, capacidades });
    });
    resultado.set(familia, Object.freeze({
      familia,
      dependencias: Object.freeze(dependencias)
    }));
  }
  return resultado;
}

function normalizarCapacidades(capacidades, contexto) {
  if (!Array.isArray(capacidades) || capacidades.length === 0) {
    throw new ErrorDependenciasFamiliasFederacion(
      'capacidades_dependencia_invalidas',
      'Cada dependencia debe indicar qué capacidad permite sostener.',
      contexto
    );
  }
  const resultado = [...new Set(capacidades.map((capacidad) =>
    CAPACIDADES_COMPLETITUD_FEDERACION.exigir(capacidad, {
      campo: 'capacidadDependencia'
    })
  ))];
  if (resultado.length !== capacidades.length) {
    throw new ErrorDependenciasFamiliasFederacion(
      'capacidad_dependencia_duplicada',
      'Una dependencia no puede repetir capacidades de completitud.',
      contexto
    );
  }
  return Object.freeze(resultado);
}

function exigirAusenciaCiclosObligatorios(declaraciones) {
  const visitadas = new Set();
  const abiertas = new Set();
  const visitar = (familia) => {
    if (abiertas.has(familia)) {
      throw new ErrorDependenciasFamiliasFederacion(
        'ciclo_dependencias_obligatorias',
        `La dependencia obligatoria de ${familia} forma un ciclo.`,
        { familia }
      );
    }
    if (visitadas.has(familia)) return;
    abiertas.add(familia);
    const declaracion = declaraciones.get(familia);
    for (const dependencia of declaracion?.dependencias || []) {
      if (dependencia.tipo === 'obligatoria') visitar(dependencia.familia);
    }
    abiertas.delete(familia);
    visitadas.add(familia);
  };
  for (const familia of FAMILIAS_FEDERACION.valores) visitar(familia);
}

function declaracionVacia(familia) {
  return Object.freeze({ familia, dependencias: Object.freeze([]) });
}

function exigirFamilia(familia) {
  try {
    return FAMILIAS_FEDERACION.exigir(familia, { campo: 'familia' });
  } catch (causa) {
    throw new ErrorDependenciasFamiliasFederacion(
      'familia_dependencia_desconocida',
      'La dependencia no pertenece al catálogo de familias federables.',
      { familia },
      { cause: causa }
    );
  }
}

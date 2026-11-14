import {
  FAMILIAS_FEDERACION,
  VERSIONES_FAMILIA_FEDERACION
} from './CatalogosFederacion.js';
import { GrafoDependenciasFamiliasFederacion } from './GrafoDependenciasFamiliasFederacion.js';

export const VERSION_REGISTRO_ADAPTADORES_FAMILIAS_FEDERACION = 1;
export const PERFIL_REGISTRO_ADAPTADORES_FAMILIAS_FEDERACION =
  'sentinelia-federacion-adaptadores-familias-v1';

export const CONTRATOS_ADAPTADORES_FAMILIA_FEDERACION = congelarProfundo({
  captura: {
    metodo: 'prepararCapturaEnTransaccion',
    transaccion: 'requerida',
    responsabilidad: 'traducir_mutacion_local_a_ocurrencia_tipificada'
  },
  fotografiaInicial: {
    metodo: 'listarCapturasEnTransaccion',
    transaccion: 'requerida',
    responsabilidad: 'enumerar_fotografia_coherente_en_orden_estable'
  },
  payload: {
    metodo: 'validarPayload',
    transaccion: 'ninguna',
    responsabilidad: 'validar_y_normalizar_payload_versionado'
  },
  retirada: {
    metodo: 'prepararRetiradaEnTransaccion',
    transaccion: 'requerida',
    responsabilidad: 'traducir_retirada_o_cascada_sin_inferir_desaparicion'
  },
  materializacion: {
    metodo: 'materializarEnTransaccion',
    transaccion: 'requerida',
    responsabilidad: 'aplicar_actualizacion_o_retirada_en_tablas_remotas'
  }
});

const NOMBRES_INTERFACES = Object.freeze(
  Object.keys(CONTRATOS_ADAPTADORES_FAMILIA_FEDERACION)
);

export class ErrorAdaptadoresFamiliasFederacion extends Error {
  constructor(codigo, mensaje, {
    familia = null,
    versionFamilia = null,
    interfaz = null,
    metodo = null
  } = {}) {
    super(mensaje);
    this.name = 'ErrorAdaptadoresFamiliasFederacion';
    this.codigo = codigo;
    this.familia = familia;
    this.versionFamilia = versionFamilia;
    this.interfaz = interfaz;
    this.metodo = metodo;
  }
}

export class RegistroAdaptadoresFamiliasFederacion {
  #adaptadores;

  constructor({
    version = VERSION_REGISTRO_ADAPTADORES_FAMILIAS_FEDERACION,
    grafoDependencias = new GrafoDependenciasFamiliasFederacion(),
    adaptadores = []
  } = {}) {
    if (!Number.isInteger(version) || version < 1) {
      throw new ErrorAdaptadoresFamiliasFederacion(
        'version_registro_invalida',
        'El registro de adaptadores necesita una versión positiva.'
      );
    }
    if (!(grafoDependencias instanceof GrafoDependenciasFamiliasFederacion)) {
      throw new ErrorAdaptadoresFamiliasFederacion(
        'grafo_dependencias_invalido',
        'El registro necesita un grafo de dependencias de familias.'
      );
    }
    if (!Array.isArray(adaptadores)) {
      throw new ErrorAdaptadoresFamiliasFederacion(
        'adaptadores_familias_invalidos',
        'Los adaptadores deben registrarse como una lista.'
      );
    }
    this.version = version;
    this.perfil = PERFIL_REGISTRO_ADAPTADORES_FAMILIAS_FEDERACION;
    this.grafoDependencias = grafoDependencias;
    this.#adaptadores = new Map();
    for (const definicion of adaptadores) {
      const adaptador = crearAdaptadorFamiliaFederacion(definicion);
      const clave = claveAdaptador(adaptador.familia, adaptador.versionFamilia);
      if (this.#adaptadores.has(clave)) {
        throw new ErrorAdaptadoresFamiliasFederacion(
          'adaptador_familia_duplicado',
          `El adaptador ${clave} ya está registrado.`,
          adaptador
        );
      }
      this.#adaptadores.set(clave, adaptador);
    }
    exigirDependenciasProductivas(this.#adaptadores, this.grafoDependencias);
    Object.freeze(this);
  }

  obtener(entrada = {}) {
    return this.#obtener(entrada, true);
  }

  obtenerProductivo(entrada) {
    return this.#obtener(entrada, true);
  }

  obtenerEnConstruccion(entrada) {
    return this.#obtener(entrada, false);
  }

  #obtener({ familia, versionFamilia } = {}, exigirProductivo) {
    const nombre = exigirFamilia(familia);
    const version = exigirVersionFamilia(nombre, versionFamilia);
    const adaptador = this.#adaptadores.get(claveAdaptador(nombre, version));
    if (!adaptador) {
      throw new ErrorAdaptadoresFamiliasFederacion(
        'adaptador_familia_no_registrado',
        `No existe adaptador para ${nombre}@${version}.`,
        { familia: nombre, versionFamilia: version }
      );
    }
    if (exigirProductivo && !adaptador.productivo) {
      throw new ErrorAdaptadoresFamiliasFederacion(
        'adaptador_familia_no_productivo',
        `El adaptador ${nombre}@${version} todavía no es productivo.`,
        { familia: nombre, versionFamilia: version }
      );
    }
    return adaptador;
  }

  listar({ soloProductivos = false } = {}) {
    if (typeof soloProductivos !== 'boolean') {
      throw new ErrorAdaptadoresFamiliasFederacion(
        'filtro_productivo_invalido',
        'soloProductivos debe ser booleano.'
      );
    }
    return Object.freeze([...this.#adaptadores.values()].filter(
      (adaptador) => !soloProductivos || adaptador.productivo
    ));
  }

  resolverCierreProductivo(familias, opciones = {}) {
    const cierre = this.grafoDependencias.resolverCierre(familias, opciones);
    return Object.freeze(cierre.map((familia) => this.obtenerProductivo({
      familia,
      versionFamilia: VERSIONES_FAMILIA_FEDERACION[familia]
    })));
  }

  toJSON() {
    return Object.freeze({
      perfil: this.perfil,
      version: this.version,
      grafoDependencias: this.grafoDependencias.toJSON(),
      adaptadores: Object.freeze(this.listar().map((adaptador) => Object.freeze({
        familia: adaptador.familia,
        versionFamilia: adaptador.versionFamilia,
        perfilPayload: adaptador.perfilPayload,
        productivo: adaptador.productivo,
        interfaces: adaptador.interfacesDisponibles
      })))
    });
  }
}

export function crearAdaptadorFamiliaFederacion({
  familia,
  versionFamilia,
  perfilPayload,
  productivo = false,
  interfaces = {}
} = {}) {
  const nombre = exigirFamilia(familia);
  const version = exigirVersionFamilia(nombre, versionFamilia);
  if (typeof perfilPayload !== 'string' || !perfilPayload.trim()) {
    throw new ErrorAdaptadoresFamiliasFederacion(
      'perfil_payload_invalido',
      `El adaptador ${nombre}@${version} necesita un perfil de payload estable.`,
      { familia: nombre, versionFamilia: version }
    );
  }
  if (typeof productivo !== 'boolean') {
    throw new ErrorAdaptadoresFamiliasFederacion(
      'estado_productivo_invalido',
      'productivo debe ser booleano.',
      { familia: nombre, versionFamilia: version }
    );
  }
  if (!interfaces || typeof interfaces !== 'object' || Array.isArray(interfaces)) {
    throw new ErrorAdaptadoresFamiliasFederacion(
      'interfaces_familia_invalidas',
      'Las interfaces del adaptador deben declararse por responsabilidad.',
      { familia: nombre, versionFamilia: version }
    );
  }
  for (const interfaz of Object.keys(interfaces)) {
    if (!NOMBRES_INTERFACES.includes(interfaz)) {
      throw new ErrorAdaptadoresFamiliasFederacion(
        'interfaz_familia_desconocida',
        `La interfaz ${interfaz} no pertenece al contrato común.`,
        { familia: nombre, versionFamilia: version, interfaz }
      );
    }
  }
  const fachadas = {};
  for (const interfaz of NOMBRES_INTERFACES) {
    if (interfaces[interfaz] !== undefined) {
      fachadas[interfaz] = crearFachadaInterfaz({
        familia: nombre,
        versionFamilia: version,
        interfaz,
        implementacion: interfaces[interfaz]
      });
    }
  }
  const interfacesDisponibles = Object.freeze(Object.keys(fachadas));
  const completo = interfacesDisponibles.length === NOMBRES_INTERFACES.length;
  if (productivo && !completo) {
    const faltante = NOMBRES_INTERFACES.find(
      (interfaz) => !interfacesDisponibles.includes(interfaz)
    );
    throw new ErrorAdaptadoresFamiliasFederacion(
      'adaptador_productivo_incompleto',
      `El adaptador productivo ${nombre}@${version} no implementa ${faltante}.`,
      { familia: nombre, versionFamilia: version, interfaz: faltante }
    );
  }
  return Object.freeze({
    familia: nombre,
    versionFamilia: version,
    perfilPayload: perfilPayload.trim(),
    productivo,
    completo,
    interfacesDisponibles,
    interfaces: Object.freeze(fachadas)
  });
}

function crearFachadaInterfaz({
  familia,
  versionFamilia,
  interfaz,
  implementacion
}) {
  const contrato = CONTRATOS_ADAPTADORES_FAMILIA_FEDERACION[interfaz];
  const funcion = obtenerMetodo(implementacion, contrato.metodo);
  if (typeof funcion !== 'function') {
    throw new ErrorAdaptadoresFamiliasFederacion(
      'metodo_interfaz_familia_ausente',
      `La interfaz ${interfaz} debe implementar ${contrato.metodo}().`,
      {
        familia,
        versionFamilia,
        interfaz,
        metodo: contrato.metodo
      }
    );
  }
  return Object.freeze({
    [contrato.metodo]: (...argumentos) => Reflect.apply(
      funcion,
      implementacion,
      argumentos
    )
  });
}

function exigirDependenciasProductivas(adaptadores, grafo) {
  for (const adaptador of adaptadores.values()) {
    if (!adaptador.productivo) continue;
    const dependencias = grafo.obtener(adaptador.familia).dependencias.filter(
      (dependencia) => dependencia.tipo === 'obligatoria'
    );
    for (const dependencia of dependencias) {
      const version = VERSIONES_FAMILIA_FEDERACION[dependencia.familia];
      const registrada = adaptadores.get(claveAdaptador(
        dependencia.familia,
        version
      ));
      if (!registrada?.productivo) {
        throw new ErrorAdaptadoresFamiliasFederacion(
          'dependencia_productiva_ausente',
          `El adaptador productivo ${adaptador.familia} requiere ` +
            `${dependencia.familia}@${version}.`,
          {
            familia: adaptador.familia,
            versionFamilia: adaptador.versionFamilia
          }
        );
      }
    }
  }
}

function obtenerMetodo(implementacion, metodo) {
  if (
    implementacion === null ||
    (typeof implementacion !== 'object' && typeof implementacion !== 'function')
  ) return undefined;
  let propietario = implementacion;
  const visitados = new Set();
  while (propietario !== null && !visitados.has(propietario)) {
    visitados.add(propietario);
    const descriptor = Object.getOwnPropertyDescriptor(propietario, metodo);
    if (descriptor) return 'value' in descriptor ? descriptor.value : undefined;
    propietario = Object.getPrototypeOf(propietario);
  }
  return undefined;
}

function exigirFamilia(familia) {
  try {
    return FAMILIAS_FEDERACION.exigir(familia, { campo: 'familia' });
  } catch (causa) {
    throw new ErrorAdaptadoresFamiliasFederacion(
      'familia_adaptador_desconocida',
      'El adaptador no pertenece al catálogo de familias federables.',
      { familia },
      { cause: causa }
    );
  }
}

function exigirVersionFamilia(familia, version) {
  if (!Number.isInteger(version) || version < 1) {
    throw new ErrorAdaptadoresFamiliasFederacion(
      'version_familia_invalida',
      `La versión del adaptador ${familia} debe ser positiva.`,
      { familia, versionFamilia: version }
    );
  }
  return version;
}

function claveAdaptador(familia, version) {
  return `${familia}@${version}`;
}

function congelarProfundo(valor) {
  if (valor === null || typeof valor !== 'object') return valor;
  for (const descendiente of Object.values(valor)) congelarProfundo(descendiente);
  return Object.freeze(valor);
}

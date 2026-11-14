export const PERFIL_CANONICO_FEDERACION =
  'sentinelia-federacion-json-canonico-v1';
export const PROFUNDIDAD_MAXIMA_JSON_FEDERACION = 256;

export class ErrorCanonicalizacionFederacion extends Error {
  constructor(codigo, mensaje, { ruta = '$' } = {}) {
    super(mensaje);
    this.name = 'ErrorCanonicalizacionFederacion';
    this.codigo = codigo;
    this.ruta = ruta;
  }
}

export function canonicalizarJsonFederacion(valor) {
  return serializarValor(valor, '$', new Set(), 0);
}

export function codificarUtf8CanonicoFederacion(valor) {
  return new TextEncoder().encode(canonicalizarJsonFederacion(valor));
}

export function normalizarJsonFederacion(valor) {
  const normalizado = JSON.parse(canonicalizarJsonFederacion(valor));
  return congelarProfundo(normalizado);
}

function serializarValor(valor, ruta, visitados, profundidad) {
  if (profundidad > PROFUNDIDAD_MAXIMA_JSON_FEDERACION) {
    fallar(
      'profundidad_json_excedida',
      `${ruta} supera la profundidad máxima del perfil canónico.`,
      ruta
    );
  }
  if (valor === null) return 'null';
  if (valor === true) return 'true';
  if (valor === false) return 'false';
  if (typeof valor === 'string') {
    validarUnicode(valor, ruta);
    return JSON.stringify(valor);
  }
  if (typeof valor === 'number') {
    if (!Number.isFinite(valor)) {
      fallar(
        'numero_no_finito',
        `${ruta} no admite NaN ni valores infinitos.`,
        ruta
      );
    }
    return JSON.stringify(valor);
  }
  if (typeof valor !== 'object') {
    fallar(
      'tipo_no_representable',
      `${ruta} contiene un tipo no representable en JSON canónico.`,
      ruta
    );
  }
  if (visitados.has(valor)) {
    fallar(
      'referencia_circular',
      `${ruta} contiene una referencia circular.`,
      ruta
    );
  }
  visitados.add(valor);
  try {
    return Array.isArray(valor)
      ? serializarArray(valor, ruta, visitados, profundidad)
      : serializarObjeto(valor, ruta, visitados, profundidad);
  } finally {
    visitados.delete(valor);
  }
}

function serializarArray(valor, ruta, visitados, profundidad) {
  const claves = Reflect.ownKeys(valor);
  for (const clave of claves) {
    if (
      clave !== 'length' &&
      !(
        typeof clave === 'string' &&
        /^(0|[1-9][0-9]*)$/.test(clave) &&
        Number(clave) < valor.length
      )
    ) {
      fallar(
        'array_no_json',
        `${ruta} contiene propiedades ajenas a un array JSON denso.`,
        ruta
      );
    }
  }
  const elementos = [];
  for (let indice = 0; indice < valor.length; indice += 1) {
    if (!Object.hasOwn(valor, indice)) {
      fallar(
        'array_con_huecos',
        `${ruta} contiene una posición ausente.`,
        `${ruta}[${indice}]`
      );
    }
    const descriptor = Object.getOwnPropertyDescriptor(valor, String(indice));
    validarDescriptorDatos(descriptor, `${ruta}[${indice}]`);
    elementos.push(
      serializarValor(
        descriptor.value,
        `${ruta}[${indice}]`,
        visitados,
        profundidad + 1
      )
    );
  }
  return `[${elementos.join(',')}]`;
}

function serializarObjeto(valor, ruta, visitados, profundidad) {
  if (Object.getPrototypeOf(valor) !== Object.prototype) {
    fallar(
      'objeto_no_plano',
      `${ruta} debe ser un objeto JSON plano.`,
      ruta
    );
  }
  const entradas = [];
  for (const clave of Reflect.ownKeys(valor)) {
    if (typeof clave !== 'string') {
      fallar(
        'clave_no_representable',
        `${ruta} contiene una clave Symbol.`,
        ruta
      );
    }
    validarUnicode(clave, `${ruta} (clave)`);
    const descriptor = Object.getOwnPropertyDescriptor(valor, clave);
    validarDescriptorDatos(descriptor, `${ruta}.${clave}`);
    entradas.push([clave, descriptor.value]);
  }
  entradas.sort(([claveA], [claveB]) => {
    if (claveA < claveB) return -1;
    if (claveA > claveB) return 1;
    return 0;
  });
  return `{${entradas.map(([clave, contenido]) =>
    `${JSON.stringify(clave)}:${serializarValor(
      contenido,
      `${ruta}.${clave}`,
      visitados,
      profundidad + 1
    )}`).join(',')}}`;
}

function validarDescriptorDatos(descriptor, ruta) {
  if (!descriptor || descriptor.enumerable !== true || !('value' in descriptor)) {
    fallar(
      'propiedad_no_json',
      `${ruta} debe ser una propiedad enumerable de datos.`,
      ruta
    );
  }
}

function validarUnicode(valor, ruta) {
  for (let indice = 0; indice < valor.length; indice += 1) {
    const unidad = valor.charCodeAt(indice);
    if (unidad >= 0xd800 && unidad <= 0xdbff) {
      const siguiente = valor.charCodeAt(indice + 1);
      if (!(siguiente >= 0xdc00 && siguiente <= 0xdfff)) {
        fallar(
          'unicode_invalido',
          `${ruta} contiene un sustituto Unicode alto aislado.`,
          ruta
        );
      }
      indice += 1;
      continue;
    }
    if (unidad >= 0xdc00 && unidad <= 0xdfff) {
      fallar(
        'unicode_invalido',
        `${ruta} contiene un sustituto Unicode bajo aislado.`,
        ruta
      );
    }
  }
}

function congelarProfundo(valor) {
  if (valor === null || typeof valor !== 'object') return valor;
  for (const descendiente of Object.values(valor)) {
    congelarProfundo(descendiente);
  }
  return Object.freeze(valor);
}

function fallar(codigo, mensaje, ruta) {
  throw new ErrorCanonicalizacionFederacion(codigo, mensaje, { ruta });
}

import {
  calcularSha256Federacion,
  codificarUtf8Federacion
} from './HuellaSha256Federacion.js';

const PREFIJO_IDENTIDAD_FEDERADA = 'sfid1';
const ALFABETO_BASE64URL =
  'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
const INDICES_BASE64URL = new Map(
  [...ALFABETO_BASE64URL].map((caracter, indice) => [caracter, indice])
);

export const BYTES_IDENTIDAD_FEDERADA = 16;
export const ENTROPIA_MINIMA_IDENTIDAD_FEDERADA_BITS =
  BYTES_IDENTIDAD_FEDERADA * 8;

export const TIPOS_IDENTIDAD_FEDERADA = Object.freeze({
  INSTALACION: 'instalacion',
  ARRANQUE: 'arranque',
  RELACION: 'relacion',
  REVISION_CONCESION: 'revision_concesion',
  FLUJO: 'flujo',
  GENERACION: 'generacion',
  LOTE: 'lote',
  ELEMENTO_ORIGEN: 'elemento_origen',
  OCURRENCIA_ORIGEN: 'ocurrencia_origen',
  ENTREGA: 'entrega',
  CONTRIBUCION: 'contribucion',
  PROYECCION: 'proyeccion'
});

const TIPOS_ADMITIDOS = new Set(Object.values(TIPOS_IDENTIDAD_FEDERADA));
const IDENTIDADES_FEDERADAS = new WeakSet();

export class ErrorIdentidadFederada extends Error {
  constructor(codigo, mensaje) {
    super(mensaje);
    this.name = 'ErrorIdentidadFederada';
    this.codigo = codigo;
  }
}

class IdentidadFederada {
  #tipo;
  #valor;

  constructor({ tipo, valor }) {
    this.#tipo = tipo;
    this.#valor = valor;
    IDENTIDADES_FEDERADAS.add(this);
    Object.freeze(this);
  }

  get tipo() {
    return this.#tipo;
  }

  serializar() {
    return this.#valor;
  }

  esIgual(otra) {
    return IDENTIDADES_FEDERADAS.has(otra) &&
      otra.#tipo === this.#tipo &&
      otra.#valor === this.#valor;
  }

  toString() {
    return this.#valor;
  }

  toJSON() {
    return this.#valor;
  }
}

export class GeneradorIdentidadesFederadas {
  #generarBytes;

  constructor({ fuenteEntropia } = {}) {
    validarFuenteEntropia(fuenteEntropia);
    this.#generarBytes = fuenteEntropia.generarBytes.bind(fuenteEntropia);
    Object.freeze(this);
  }

  generar(tipo) {
    const tipoNormalizado = validarTipoIdentidadFederada(tipo);
    const material = this.#generarBytes({
      cantidadBytes: BYTES_IDENTIDAD_FEDERADA,
      tipo: tipoNormalizado
    });
    const materialNormalizado = normalizarMaterialEntropia(material);
    const valor = construirValorIdentidad({
      tipo: tipoNormalizado,
      material: materialNormalizado
    });
    return new IdentidadFederada({ tipo: tipoNormalizado, valor });
  }
}

export function crearIdentidadFederada({ tipo, valor } = {}) {
  const tipoEsperado = validarTipoIdentidadFederada(tipo);
  if (typeof valor !== 'string' || valor.length === 0) {
    throw new ErrorIdentidadFederada(
      'formato_invalido',
      'La identidad federada debe ser un texto canónico no vacío.'
    );
  }
  const partes = valor.split('.');
  if (partes.length !== 3 || partes[0] !== PREFIJO_IDENTIDAD_FEDERADA) {
    throw new ErrorIdentidadFederada(
      'formato_invalido',
      'La identidad federada no usa el formato versionado esperado.'
    );
  }
  const tipoObservado = validarTipoIdentidadFederada(partes[1]);
  if (tipoObservado !== tipoEsperado) {
    throw new ErrorIdentidadFederada(
      'tipo_mezclado',
      `Se esperaba una identidad ${tipoEsperado}, no ${tipoObservado}.`
    );
  }
  const material = decodificarBase64Url(partes[2]);
  normalizarMaterialEntropia(material);
  if (construirValorIdentidad({ tipo: tipoObservado, material }) !== valor) {
    throw new ErrorIdentidadFederada(
      'formato_no_canonico',
      'La identidad federada no está expresada en su forma canónica.'
    );
  }
  return new IdentidadFederada({ tipo: tipoObservado, valor });
}

export function derivarIdentidadFederada({ tipo, perfil, componentes } = {}) {
  const tipoNormalizado = validarTipoIdentidadFederada(tipo);
  if (typeof perfil !== 'string' || !/^[a-z0-9][a-z0-9-]{0,127}$/u.test(perfil)) {
    throw new ErrorIdentidadFederada(
      'perfil_derivacion_invalido',
      'La derivación determinista exige un perfil cerrado y versionado.'
    );
  }
  if (!Array.isArray(componentes) || componentes.length === 0 ||
      componentes.some((valor) => typeof valor !== 'string')) {
    throw new ErrorIdentidadFederada(
      'componentes_derivacion_invalidos',
      'La derivación determinista exige componentes textuales ordenados.'
    );
  }
  const partes = [];
  for (const valor of [PREFIJO_IDENTIDAD_FEDERADA, tipoNormalizado, perfil,
    ...componentes]) {
    const bytes = codificarUtf8Federacion(valor);
    partes.push(Uint8Array.from([
      bytes.byteLength >>> 24,
      bytes.byteLength >>> 16,
      bytes.byteLength >>> 8,
      bytes.byteLength
    ]), bytes);
  }
  const material = calcularSha256Federacion(partes)
    .slice(0, BYTES_IDENTIDAD_FEDERADA);
  return new IdentidadFederada({
    tipo: tipoNormalizado,
    valor: construirValorIdentidad({ tipo: tipoNormalizado, material })
  });
}

export function exigirIdentidadFederada(
  identidad,
  { tipo, campo = 'identidad' } = {}
) {
  const tipoEsperado = validarTipoIdentidadFederada(tipo);
  if (!IDENTIDADES_FEDERADAS.has(identidad)) {
    throw new ErrorIdentidadFederada(
      'instancia_invalida',
      `${campo} debe ser una identidad federada opaca.`
    );
  }
  if (identidad.tipo !== tipoEsperado) {
    throw new ErrorIdentidadFederada(
      'tipo_mezclado',
      `${campo} debe ser ${tipoEsperado}, no ${identidad.tipo}.`
    );
  }
  return identidad;
}

export function esIdentidadFederada(valor, tipo = null) {
  if (!IDENTIDADES_FEDERADAS.has(valor)) return false;
  return tipo == null
    ? true
    : valor.tipo === validarTipoIdentidadFederada(tipo);
}

function validarFuenteEntropia(fuenteEntropia) {
  if (!fuenteEntropia || typeof fuenteEntropia.generarBytes !== 'function') {
    throw new ErrorIdentidadFederada(
      'fuente_entropia_invalida',
      'El generador requiere una fuente de entropía inyectada.'
    );
  }
  if (
    !Number.isInteger(fuenteEntropia.entropiaBitsPorIdentidad) ||
    fuenteEntropia.entropiaBitsPorIdentidad <
      ENTROPIA_MINIMA_IDENTIDAD_FEDERADA_BITS
  ) {
    throw new ErrorIdentidadFederada(
      'entropia_insuficiente',
      `La fuente debe declarar al menos ${ENTROPIA_MINIMA_IDENTIDAD_FEDERADA_BITS} bits de entropía por identidad.`
    );
  }
}

function normalizarMaterialEntropia(material) {
  let bytes;
  try {
    if (!(material instanceof Uint8Array)) throw new TypeError();
    const iteradorNativo = Reflect.apply(
      Uint8Array.prototype.values,
      material,
      []
    );
    bytes = Array.from(iteradorNativo);
  } catch {
    bytes = null;
  }
  if (bytes?.length !== BYTES_IDENTIDAD_FEDERADA) {
    throw new ErrorIdentidadFederada(
      'entropia_insuficiente',
      `La fuente debe entregar exactamente ${BYTES_IDENTIDAD_FEDERADA} bytes por identidad.`
    );
  }
  return Uint8Array.from(bytes);
}

function validarTipoIdentidadFederada(tipo) {
  if (!TIPOS_ADMITIDOS.has(tipo)) {
    throw new ErrorIdentidadFederada(
      'tipo_invalido',
      'El tipo de identidad federada no pertenece al catálogo cerrado.'
    );
  }
  return tipo;
}

function construirValorIdentidad({ tipo, material }) {
  return `${PREFIJO_IDENTIDAD_FEDERADA}.${tipo}.${codificarBase64Url(material)}`;
}

function codificarBase64Url(material) {
  let acumulador = 0;
  let bits = 0;
  let salida = '';
  for (const byte of material) {
    acumulador = (acumulador << 8) | byte;
    bits += 8;
    while (bits >= 6) {
      bits -= 6;
      salida += ALFABETO_BASE64URL[(acumulador >>> bits) & 63];
      acumulador &= (1 << bits) - 1;
    }
  }
  if (bits > 0) {
    salida += ALFABETO_BASE64URL[(acumulador << (6 - bits)) & 63];
  }
  return salida;
}

function decodificarBase64Url(valor) {
  if (typeof valor !== 'string' || valor.length !== 22) {
    throw new ErrorIdentidadFederada(
      'formato_invalido',
      'El material de identidad debe contener 128 bits en base64url sin padding.'
    );
  }
  let acumulador = 0;
  let bits = 0;
  const bytes = [];
  for (const caracter of valor) {
    const indice = INDICES_BASE64URL.get(caracter);
    if (indice == null) {
      throw new ErrorIdentidadFederada(
        'formato_invalido',
        'La identidad contiene caracteres ajenos a base64url.'
      );
    }
    acumulador = (acumulador << 6) | indice;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      bytes.push((acumulador >>> bits) & 255);
      acumulador &= (1 << bits) - 1;
    }
  }
  if (bits > 0 && acumulador !== 0) {
    throw new ErrorIdentidadFederada(
      'formato_no_canonico',
      'La identidad contiene bits residuales no canónicos.'
    );
  }
  return Uint8Array.from(bytes);
}

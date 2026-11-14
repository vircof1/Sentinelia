import canonicalize from 'canonicalize';

export const PERFIL_JCS_AUDITORIA_V1 = 'sentinelia-auditoria-jcs-v1';
export const MAX_BYTES_PAYLOAD_AUDITORIA_V1 = 65_536;

const PATRON_FECHA_UTC_MILISEGUNDOS = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const PATRON_ENTERO_DECIMAL_CANONICO = /^(0|[1-9][0-9]*)$/;
const PATRON_ID_DECIMAL_POSITIVO = /^[1-9][0-9]*$/;
const PATRON_DECIMAL_EXACTO = /^(?:0(?:\.[0-9]*[1-9])?|[1-9][0-9]*(?:\.[0-9]*[1-9])?|-(?:0\.[0-9]*[1-9]|[1-9][0-9]*(?:\.[0-9]*[1-9])?))$/;

/**
 * Delega la serialización normativa a la dependencia RFC 8785 fijada en el
 * lockfile. Esta entrada conserva el dominio numérico completo de JCS y existe
 * para verificar sus vectores oficiales; el perfil Sentinelia usa la variante
 * estricta exportada más abajo.
 */
export function canonicalizarRfc8785(valor) {
  validarArbolJson(valor, { enterosSegurosUnicamente: false });
  return canonicalize(valor);
}

/**
 * Canonicaliza un valor conforme al perfil de dominio. Sentinelia no ordena ni
 * serializa JSON por su cuenta: primero restringe el árbol y después delega JCS.
 */
export function canonicalizarJcsAuditoriaV1(valor) {
  validarArbolJson(valor, { enterosSegurosUnicamente: true });
  return canonicalize(valor);
}

export function serializarPayloadAuditoriaV1(payload) {
  const canonico = canonicalizarJcsAuditoriaV1(payload);
  const longitudBytes = Buffer.byteLength(canonico, 'utf8');
  exigir(
    longitudBytes <= MAX_BYTES_PAYLOAD_AUDITORIA_V1,
    `El payload canónico supera ${MAX_BYTES_PAYLOAD_AUDITORIA_V1} bytes UTF-8.`
  );
  return Object.freeze({
    perfil: PERFIL_JCS_AUDITORIA_V1,
    canonico,
    bytes: Buffer.from(canonico, 'utf8'),
    longitudBytes
  });
}

export function validarIdDominio(valor, nombre = 'id') {
  exigir(typeof valor === 'string', `${nombre} debe ser un string.`);
  exigir(valor.length > 0, `${nombre} no puede estar vacío.`);
  validarUnicode(valor, nombre);
  return valor;
}

export function validarIdDecimalPositivo(valor, nombre = 'id') {
  validarIdDominio(valor, nombre);
  exigir(PATRON_ID_DECIMAL_POSITIVO.test(valor), `${nombre} debe ser un id decimal canónico positivo.`);
  return valor;
}

export function validarFechaUtcMilisegundos(valor, nombre = 'fecha') {
  exigir(
    typeof valor === 'string' && PATRON_FECHA_UTC_MILISEGUNDOS.test(valor),
    `${nombre} debe usar UTC con milisegundos y sufijo Z.`
  );
  const instante = Date.parse(valor);
  exigir(Number.isFinite(instante), `${nombre} no representa una fecha real.`);
  exigir(new Date(instante).toISOString() === valor, `${nombre} no es una fecha UTC canónica.`);
  return valor;
}

export function validarEnteroSeguro(valor, nombre = 'entero') {
  exigir(Number.isSafeInteger(valor), `${nombre} debe ser un entero seguro de JavaScript.`);
  return valor;
}

export function validarEnteroDecimalCanonico(
  valor,
  { nombre = 'entero', positivo = false, maximo = null } = {}
) {
  exigir(
    typeof valor === 'string' && PATRON_ENTERO_DECIMAL_CANONICO.test(valor),
    `${nombre} debe ser un string entero decimal canónico.`
  );
  const entero = BigInt(valor);
  exigir(!positivo || entero > 0n, `${nombre} debe ser positivo.`);
  if (maximo !== null) {
    exigir(typeof maximo === 'bigint' && maximo >= 0n, `El máximo de ${nombre} no es válido.`);
    exigir(entero <= maximo, `${nombre} supera su máximo admitido.`);
  }
  return valor;
}

export function validarDecimalExacto(
  valor,
  { nombre = 'decimal', escala, minimo, maximo } = {}
) {
  exigir(
    Number.isInteger(escala) && escala >= 0,
    `La escala de ${nombre} debe declararse como entero no negativo.`
  );
  exigir(typeof minimo === 'string' && typeof maximo === 'string', `El rango de ${nombre} debe declararse con strings exactos.`);

  const decimal = descomponerDecimalCanonico(valor, nombre);
  const limiteInferior = descomponerDecimalCanonico(minimo, `mínimo de ${nombre}`);
  const limiteSuperior = descomponerDecimalCanonico(maximo, `máximo de ${nombre}`);
  for (const candidato of [decimal, limiteInferior, limiteSuperior]) {
    exigir(candidato.escala <= escala, `${nombre} supera la escala ${escala}.`);
  }

  const inferiorEscalado = escalarDecimal(limiteInferior, escala);
  const superiorEscalado = escalarDecimal(limiteSuperior, escala);
  exigir(inferiorEscalado <= superiorEscalado, `El rango declarado de ${nombre} está invertido.`);
  const valorEscalado = escalarDecimal(decimal, escala);
  exigir(
    valorEscalado >= inferiorEscalado && valorEscalado <= superiorEscalado,
    `${nombre} queda fuera del rango admitido.`
  );
  return valor;
}

function validarArbolJson(raiz, { enterosSegurosUnicamente }) {
  const visitados = new Set();

  function visitar(valor, ruta) {
    if (valor === null || typeof valor === 'boolean') {
      return;
    }
    if (typeof valor === 'string') {
      validarUnicode(valor, ruta);
      return;
    }
    if (typeof valor === 'number') {
      exigir(Number.isFinite(valor), `${ruta} no admite NaN ni infinitos.`);
      if (enterosSegurosUnicamente) {
        validarEnteroSeguro(valor, ruta);
      }
      return;
    }
    exigir(typeof valor === 'object', `${ruta} contiene un tipo no representable en JSON/JCS.`);
    exigir(!visitados.has(valor), `${ruta} contiene una referencia circular.`);
    visitados.add(valor);

    if (Array.isArray(valor)) {
      const claves = Reflect.ownKeys(valor);
      exigir(
        claves.every((clave) => clave === 'length' || (typeof clave === 'string' && /^(0|[1-9][0-9]*)$/.test(clave))),
        `${ruta} contiene propiedades de array ajenas a JSON.`
      );
      for (let indice = 0; indice < valor.length; indice += 1) {
        exigir(Object.hasOwn(valor, indice), `${ruta} contiene una posición ausente.`);
        const descriptor = Object.getOwnPropertyDescriptor(valor, String(indice));
        exigir(descriptor?.enumerable === true && 'value' in descriptor, `${ruta}[${indice}] debe ser un elemento JSON enumerable de datos.`);
        visitar(descriptor.value, `${ruta}[${indice}]`);
      }
      visitados.delete(valor);
      return;
    }

    exigir(Object.getPrototypeOf(valor) === Object.prototype, `${ruta} debe ser un objeto JSON plano.`);
    for (const clave of Reflect.ownKeys(valor)) {
      exigir(typeof clave === 'string', `${ruta} contiene una clave Symbol no representable en JSON.`);
      validarUnicode(clave, `${ruta} (clave)`);
      const descriptor = Object.getOwnPropertyDescriptor(valor, clave);
      exigir(descriptor?.enumerable === true && 'value' in descriptor, `${ruta}.${clave} debe ser una propiedad JSON enumerable de datos.`);
      visitar(descriptor.value, `${ruta}.${clave}`);
    }
    visitados.delete(valor);
  }

  visitar(raiz, '$');
}

function validarUnicode(valor, nombre) {
  for (let indice = 0; indice < valor.length; indice += 1) {
    const unidad = valor.charCodeAt(indice);
    if (unidad >= 0xd800 && unidad <= 0xdbff) {
      const siguiente = valor.charCodeAt(indice + 1);
      exigir(siguiente >= 0xdc00 && siguiente <= 0xdfff, `${nombre} contiene un sustituto Unicode alto aislado.`);
      indice += 1;
      continue;
    }
    exigir(!(unidad >= 0xdc00 && unidad <= 0xdfff), `${nombre} contiene un sustituto Unicode bajo aislado.`);
  }
}

function descomponerDecimalCanonico(valor, nombre) {
  exigir(
    typeof valor === 'string' && PATRON_DECIMAL_EXACTO.test(valor),
    `${nombre} debe ser un decimal exacto canónico sin exponente, signo +, ceros redundantes ni -0.`
  );
  const negativo = valor.startsWith('-');
  const absoluto = negativo ? valor.slice(1) : valor;
  const [entero, fraccion = ''] = absoluto.split('.');
  return {
    negativo,
    digitos: BigInt(`${entero}${fraccion}`),
    escala: fraccion.length
  };
}

function escalarDecimal(decimal, escalaObjetivo) {
  const magnitud = decimal.digitos * 10n ** BigInt(escalaObjetivo - decimal.escala);
  return decimal.negativo ? -magnitud : magnitud;
}

function exigir(condicion, mensaje) {
  if (!condicion) {
    throw new Error(mensaje);
  }
}

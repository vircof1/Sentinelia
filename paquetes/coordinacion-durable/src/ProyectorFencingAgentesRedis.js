const MAX_BIGINT_UNSIGNED = 18_446_744_073_709_551_615n;
const PATRON_UUID_V7 = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

const SCRIPT_APLICAR_PROYECCION = `
local function compararDecimal(a, b)
  if string.len(a) < string.len(b) then return -1 end
  if string.len(a) > string.len(b) then return 1 end
  if a < b then return -1 end
  if a > b then return 1 end
  return 0
end

local fencingActual = redis.call('HGET', KEYS[1], 'fencingToken')
local operacionActual = redis.call('HGET', KEYS[1], 'operacionId')

if fencingActual then
  local comparacion = compararDecimal(ARGV[1], fencingActual)
  if comparacion < 0 then
    return { 'fencing_antiguo', fencingActual, operacionActual or '' }
  end
  if comparacion == 0 and operacionActual ~= ARGV[2] then
    return { 'conflicto_mismo_fencing', fencingActual, operacionActual or '' }
  end
end

local repetida = fencingActual == ARGV[1] and operacionActual == ARGV[2]
redis.call('HSET', KEYS[1], 'fencingToken', ARGV[1], 'operacionId', ARGV[2])

if ARGV[3] == 'establecer' then
  redis.call('SET', KEYS[2], ARGV[4], 'EX', tonumber(ARGV[5]))
else
  redis.call('DEL', KEYS[2])
end

if repetida then
  return { 'repetida', ARGV[1], ARGV[2] }
end
return { 'aplicada', ARGV[1], ARGV[2] }
`;

export class ProyectorFencingAgentesRedis {
  constructor({
    clienteRedis,
    prefijo = 'sentinelia:coordinacion:agentes:'
  } = {}) {
    if (typeof clienteRedis?.eval !== 'function') {
      throw new Error('La proyección fencing requiere un cliente Redis operativo.');
    }
    this.clienteRedis = clienteRedis;
    this.prefijo = normalizarPrefijo(prefijo);
  }

  async aplicar({
    agenteId,
    operacionId,
    fencingToken,
    proyeccion,
    ttlSegundos = 900
  } = {}) {
    const id = normalizarIdAgente(agenteId);
    const operacion = normalizarOperacionId(operacionId);
    const fencing = normalizarFencing(fencingToken);
    const eliminar = proyeccion === null;
    const ttl = eliminar ? 1 : normalizarTtl(ttlSegundos);
    const payload = eliminar ? '' : serializarProyeccion(proyeccion);
    const resultado = await this.clienteRedis.eval(
      SCRIPT_APLICAR_PROYECCION,
      {
        keys: [
          this.obtenerClaveAutoridad(id),
          this.obtenerClaveProyeccion(id)
        ],
        arguments: [
          fencing,
          operacion,
          eliminar ? 'eliminar' : 'establecer',
          payload,
          String(ttl)
        ]
      }
    );
    const valores = Array.isArray(resultado) ? resultado : [resultado];
    const estado = String(valores[0] || 'respuesta_invalida');
    return Object.freeze({
      estado,
      aplicada: estado === 'aplicada' || estado === 'repetida',
      repetida: estado === 'repetida',
      fencingVigente: valores[1] == null ? null : String(valores[1]),
      operacionVigente: valores[2] ? String(valores[2]) : null
    });
  }

  async obtenerAutoridad(agenteId) {
    const autoridad = await this.clienteRedis.hGetAll(
      this.obtenerClaveAutoridad(agenteId)
    );
    if (!autoridad?.fencingToken) return null;
    return Object.freeze({
      fencingToken: String(autoridad.fencingToken),
      operacionId: String(autoridad.operacionId)
    });
  }

  async obtenerProyeccion(agenteId) {
    const valor = await this.clienteRedis.get(
      this.obtenerClaveProyeccion(agenteId)
    );
    return valor === null ? null : JSON.parse(valor);
  }

  obtenerClaveAutoridad(agenteId) {
    return `${this.prefijo}agente:${normalizarIdAgente(agenteId)}:fencing`;
  }

  obtenerClaveProyeccion(agenteId) {
    return `${this.prefijo}agente:${normalizarIdAgente(agenteId)}:proyeccion`;
  }
}

function serializarProyeccion(proyeccion) {
  if (
    proyeccion === null ||
    typeof proyeccion !== 'object' ||
    Array.isArray(proyeccion) ||
    Object.getPrototypeOf(proyeccion) !== Object.prototype
  ) {
    throw new Error('La proyección Redis debe ser un objeto JSON plano.');
  }
  validarValorJson(proyeccion, new Set());
  let serializada;
  try {
    serializada = JSON.stringify(proyeccion);
  } catch {
    throw new Error('La proyección Redis no es serializable como JSON.');
  }
  if (serializada === undefined || Buffer.byteLength(serializada, 'utf8') > 65_536) {
    throw new Error('La proyección Redis supera el tamaño admitido.');
  }
  return serializada;
}

function normalizarIdAgente(valor) {
  const texto = String(valor ?? '');
  if (
    !/^[1-9][0-9]*$/.test(texto) ||
    BigInt(texto) > MAX_BIGINT_UNSIGNED
  ) {
    throw new Error('agenteId debe ser decimal canónico positivo.');
  }
  return texto;
}

function normalizarOperacionId(valor) {
  const texto = String(valor || '');
  if (!PATRON_UUID_V7.test(texto)) {
    throw new Error('operacionId debe ser UUIDv7 canónico.');
  }
  return texto;
}

function validarValorJson(valor, visitados) {
  if (
    valor === null ||
    typeof valor === 'string' ||
    typeof valor === 'boolean'
  ) return;
  if (typeof valor === 'number') {
    if (!Number.isFinite(valor)) {
      throw new Error('La proyección Redis contiene un número no finito.');
    }
    return;
  }
  if (typeof valor !== 'object') {
    throw new Error('La proyección Redis contiene un valor no JSON.');
  }
  if (visitados.has(valor)) {
    throw new Error('La proyección Redis contiene una referencia circular.');
  }
  if (!Array.isArray(valor) && Object.getPrototypeOf(valor) !== Object.prototype) {
    throw new Error('La proyección Redis contiene un objeto no JSON.');
  }
  visitados.add(valor);
  const valores = Array.isArray(valor) ? valor : Object.values(valor);
  for (const hijo of valores) validarValorJson(hijo, visitados);
  visitados.delete(valor);
}

function normalizarFencing(valor) {
  const texto = String(valor ?? '');
  if (
    !/^[1-9][0-9]*$/.test(texto) ||
    BigInt(texto) > MAX_BIGINT_UNSIGNED
  ) {
    throw new Error('fencingToken debe caber en BIGINT UNSIGNED y ser positivo.');
  }
  return texto;
}

function normalizarTtl(valor) {
  const numero = Number(valor);
  if (!Number.isInteger(numero) || numero < 1 || numero > 86_400) {
    throw new Error('ttlSegundos debe estar entre 1 y 86400.');
  }
  return numero;
}

function normalizarPrefijo(valor) {
  const texto = String(valor || '');
  if (texto.length === 0 || texto.length > 200 || !/^[\x21-\x7e]+$/.test(texto)) {
    throw new Error('El prefijo Redis de coordinación no es válido.');
  }
  return texto;
}

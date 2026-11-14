import { createHash, randomBytes } from 'node:crypto';

const SCRIPT_INSTALAR = `
local function mayor(a, b)
  a = string.gsub(a, '^0+', '')
  b = string.gsub(b, '^0+', '')
  if a == '' then a = '0' end
  if b == '' then b = '0' end
  if string.len(a) ~= string.len(b) then return string.len(a) > string.len(b) end
  return a > b
end
local actualRaw = redis.call('GET', KEYS[1])
if actualRaw then
  local actual = cjson.decode(actualRaw)
  if mayor(actual.fencingToken, ARGV[2]) then return 'fencing_obsoleto' end
  if actual.fencingToken == ARGV[2] then
    if actual.operacionId == ARGV[3] then return 'repetida' end
    return 'fencing_conflictivo'
  end
  local claveAnterior = ARGV[6] .. actual.sessionTokenHash
  if ARGV[7] == 'refresh' then
    actual.soloReplayRequestId = ARGV[8]
    redis.call('SET', claveAnterior, cjson.encode(actual), 'EX', ARGV[9])
  else
    redis.call('DEL', claveAnterior)
  end
end
redis.call('SET', KEYS[1], ARGV[1], 'EX', ARGV[4])
redis.call('SET', KEYS[2], ARGV[1], 'EX', ARGV[4])
redis.call('SET', KEYS[3], ARGV[5], 'EX', ARGV[4])
return 'aplicada'
`;

const SCRIPT_RETIRAR = `
local actualRaw = redis.call('GET', KEYS[1])
if not actualRaw then return 0 end
local actual = cjson.decode(actualRaw)
if actual.operacionId ~= ARGV[1] or actual.fencingToken ~= ARGV[2] then return 0 end
redis.call('DEL', KEYS[1])
redis.call('DEL', ARGV[3] .. actual.sessionTokenHash)
return 1
`;

const SCRIPT_REVOCAR = `
local actualRaw = redis.call('GET', KEYS[1])
if not actualRaw then return 0 end
local actual = cjson.decode(actualRaw)
redis.call('DEL', KEYS[1])
redis.call('DEL', ARGV[1] .. actual.sessionTokenHash)
return 1
`;

export class RepositorioSesionesFederacionRedis {
  constructor({ clienteRedis, prefijo = 'sentinelia:federacion', ttlSegundos = 300,
    graciaRefreshSegundos = 30 } = {}) {
    if (typeof clienteRedis?.eval !== 'function' || typeof clienteRedis?.get !== 'function') {
      throw new Error('Las sesiones federadas requieren Redis operativo.');
    }
    if (!Number.isSafeInteger(ttlSegundos) || ttlSegundos < 30 ||
        !Number.isSafeInteger(graciaRefreshSegundos) || graciaRefreshSegundos < 1 ||
        graciaRefreshSegundos >= ttlSegundos) {
      throw new Error('Los TTL de sesión federada no son válidos.');
    }
    this.clienteRedis = clienteRedis;
    this.prefijo = String(prefijo).replace(/:+$/u, '');
    this.ttlSegundos = ttlSegundos;
    this.graciaRefreshSegundos = graciaRefreshSegundos;
  }

  generarToken() {
    return `sfop1_${randomBytes(48).toString('base64url')}`;
  }

  async instalar({ contexto, token, requestId, respuesta, modo }) {
    const sessionTokenHash = hashToken(token);
    const completo = Object.freeze({ ...contexto, sessionTokenHash });
    const resultado = await this.clienteRedis.eval(SCRIPT_INSTALAR, {
      keys: [
        this.claveActual(contexto.relacionId),
        this.claveToken(sessionTokenHash),
        this.claveReplay(contexto.relacionId, requestId)
      ],
      arguments: [
        JSON.stringify(completo), String(contexto.fencingToken), contexto.operacionId,
        String(this.ttlSegundos), JSON.stringify(respuesta), `${this.prefijo}:sesion:token:`,
        modo, requestId, String(this.graciaRefreshSegundos)
      ]
    });
    if (resultado === 'fencing_obsoleto' || resultado === 'fencing_conflictivo') {
      const error = new Error('Un escritor con fencing superior gobierna la sesión.');
      error.codigo = 'FENCING_SESION_FEDERADA_RECHAZADO';
      error.statusCode = 409;
      throw error;
    }
    return Object.freeze({ estado: resultado, sessionTokenHash });
  }

  async obtenerReplay(relacionId, requestId) {
    const valor = await this.clienteRedis.get(this.claveReplay(relacionId, requestId));
    return valor ? Object.freeze(JSON.parse(valor)) : null;
  }

  async validarToken(token, { refreshRequestId = null } = {}) {
    if (typeof token !== 'string' || !/^sfop1_[A-Za-z0-9_-]{64}$/u.test(token)) return null;
    const valor = await this.clienteRedis.get(this.claveToken(hashToken(token)));
    if (!valor) return null;
    const contexto = JSON.parse(valor);
    if (contexto.soloReplayRequestId != null &&
        contexto.soloReplayRequestId !== refreshRequestId) return null;
    return Object.freeze(contexto);
  }

  async retirarSiCoincide({ relacionId, operacionId, fencingToken }) {
    return Boolean(await this.clienteRedis.eval(SCRIPT_RETIRAR, {
      keys: [this.claveActual(relacionId)],
      arguments: [operacionId, String(fencingToken), `${this.prefijo}:sesion:token:`]
    }));
  }

  async revocar(relacionId) {
    return Boolean(await this.clienteRedis.eval(SCRIPT_REVOCAR, {
      keys: [this.claveActual(relacionId)],
      arguments: [`${this.prefijo}:sesion:token:`]
    }));
  }

  claveActual(relacionId) {
    return `${this.prefijo}:sesion:actual:${relacionId}`;
  }

  claveToken(hash) {
    return `${this.prefijo}:sesion:token:${hash}`;
  }

  claveReplay(relacionId, requestId) {
    return `${this.prefijo}:sesion:replay:${relacionId}:${requestId}`;
  }
}

function hashToken(token) {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}

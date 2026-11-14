import {
  calcularHuellaSesionAgente
} from './GeneradorSesionAgenteSentinelia.js';
import {
  SesionAgenteSentinelia,
  crearSesionAgenteDesdeRedis
} from './SesionAgenteSentinelia.js';

const SCRIPT_REEMPLAZAR_SESION = `
local actual = redis.call('GET', KEYS[1])
local sesionAnteriorId = ''
local tokenAnteriorClave = ''

if actual then
  local ok, data = pcall(cjson.decode, actual)
  if ok and data then
    sesionAnteriorId = data.sessionId or ''
    if data.sessionTokenHash then
      tokenAnteriorClave = ARGV[4] .. data.sessionTokenHash
    end
  end
end

redis.call('SET', KEYS[2], ARGV[1], 'EX', tonumber(ARGV[3]))
redis.call('SET', KEYS[1], ARGV[2], 'EX', tonumber(ARGV[3]))

if tokenAnteriorClave ~= '' and tokenAnteriorClave ~= KEYS[2] then
  redis.call('DEL', tokenAnteriorClave)
end

return sesionAnteriorId
`;

const SCRIPT_REFRESCAR_SESION_SI_COINCIDE = `
local actual = redis.call('GET', KEYS[1])
if not actual then
  return { 'sin_indice_actual', '' }
end

local ok, data = pcall(cjson.decode, actual)
if not ok or not data then
  return { 'indice_invalido', '' }
end

if data.sessionId ~= ARGV[3] or data.sessionTokenHash ~= ARGV[4] then
  return { 'no_coincide', data.sessionId or '' }
end

redis.call('SET', KEYS[3], ARGV[1], 'EX', tonumber(ARGV[5]))
redis.call('SET', KEYS[1], ARGV[2], 'EX', tonumber(ARGV[5]))
redis.call('DEL', KEYS[2])

return { 'refrescada', data.sessionId or '' }
`;

const SCRIPT_INVALIDAR_SI_COINCIDE = `
local actual = redis.call('GET', KEYS[1])
if not actual then
  return 0
end

local ok, data = pcall(cjson.decode, actual)
if not ok or not data or data.sessionTokenHash ~= ARGV[1] then
  return 0
end

redis.call('DEL', KEYS[1])
redis.call('DEL', KEYS[2])
return 1
`;

const SCRIPT_REGISTRAR_HEARTBEAT_SI_COINCIDE = `
local indice = redis.call('GET', KEYS[1])
if not indice then
  return { 'sin_indice_actual', '0' }
end

local okIndice, dataIndice = pcall(cjson.decode, indice)
if not okIndice or not dataIndice then
  return { 'indice_invalido', '0' }
end

if dataIndice.sessionId ~= ARGV[1] or dataIndice.sessionTokenHash ~= ARGV[2] then
  return { 'no_coincide', '0' }
end

local sesion = redis.call('GET', KEYS[2])
if not sesion then
  return { 'sin_token_actual', '0' }
end

local ttlToken = redis.call('TTL', KEYS[2])
if ttlToken <= 0 then
  return { 'sin_ttl', '0' }
end

local okSesion, dataSesion = pcall(cjson.decode, sesion)
if not okSesion or not dataSesion then
  return { 'payload_invalido', tostring(ttlToken) }
end

dataSesion.ultimoHeartbeatUtc = ARGV[3]
dataSesion.ultimoSeq = tonumber(ARGV[4])
if ARGV[5] ~= '' then
  dataSesion.uptimeSeconds = tonumber(ARGV[5])
end

dataIndice.ultimoHeartbeatUtc = ARGV[3]
dataIndice.ultimoSeq = tonumber(ARGV[4])

redis.call('SET', KEYS[2], cjson.encode(dataSesion), 'EX', ttlToken)
redis.call('SET', KEYS[1], cjson.encode(dataIndice), 'EX', ttlToken)

return { 'registrado', tostring(ttlToken) }
`;

const SCRIPT_LIBERAR_BLOQUEO_LOGIN = `
if redis.call('GET', KEYS[1]) == ARGV[1] then
  return redis.call('DEL', KEYS[1])
end

return 0
`;

export class RepositorioSesionesAgentesRedis {
  constructor({
    clienteRedis,
    prefijoSesionesAgentes = 'sentinelia:agentes:sesiones:'
  }) {
    this.clienteRedis = clienteRedis;
    this.prefijoSesionesAgentes = prefijoSesionesAgentes;
  }

  async reemplazarSesionActual({ sesion, ttlSegundos }) {
    const sesionNormalizada = sesion instanceof SesionAgenteSentinelia
      ? sesion
      : new SesionAgenteSentinelia(sesion);
    const ttl = this.normalizarTtl(ttlSegundos || sesionNormalizada.ttlSegundos);
    const claveActual = this.obtenerClaveSesionActualAgente(
      sesionNormalizada.agenteId
    );
    const claveToken = this.obtenerClaveTokenHash(
      sesionNormalizada.sessionTokenHash
    );

    const sesionAnteriorId = await this.clienteRedis.eval(
      SCRIPT_REEMPLAZAR_SESION,
      {
        keys: [claveActual, claveToken],
        arguments: [
          JSON.stringify(sesionNormalizada.serializarRedis()),
          JSON.stringify(sesionNormalizada.obtenerIndiceActualRedis()),
          String(ttl),
          this.obtenerPrefijoTokenHash()
        ]
      }
    );

    return {
      sesion: sesionNormalizada,
      sesionAnteriorId: sesionAnteriorId || null,
      reemplazoSesionAnterior: Boolean(sesionAnteriorId)
    };
  }

  async refrescarSesionSiCoincide({
    sesion,
    ttlSegundos,
    sessionIdActual,
    sessionTokenHashActual
  }) {
    const sesionNormalizada = sesion instanceof SesionAgenteSentinelia
      ? sesion
      : new SesionAgenteSentinelia(sesion);
    const ttl = this.normalizarTtl(ttlSegundos || sesionNormalizada.ttlSegundos);
    const hashActual = normalizarHashSesion(sessionTokenHashActual);
    const claveActual = this.obtenerClaveSesionActualAgente(
      sesionNormalizada.agenteId
    );
    const resultado = await this.clienteRedis.eval(
      SCRIPT_REFRESCAR_SESION_SI_COINCIDE,
      {
        keys: [
          claveActual,
          this.obtenerClaveTokenHash(hashActual),
          this.obtenerClaveTokenHash(sesionNormalizada.sessionTokenHash)
        ],
        arguments: [
          JSON.stringify(sesionNormalizada.serializarRedis()),
          JSON.stringify(sesionNormalizada.obtenerIndiceActualRedis()),
          String(sessionIdActual || '').trim(),
          hashActual,
          String(ttl)
        ]
      }
    );
    const estado = Array.isArray(resultado) ? resultado[0] : resultado;
    const previousSessionId = Array.isArray(resultado) ? resultado[1] : null;

    return {
      estado: estado || 'desconocido',
      sesion: estado === 'refrescada' ? sesionNormalizada : null,
      previousSessionId: previousSessionId || null,
      refrescada: estado === 'refrescada'
    };
  }

  async obtenerSesionVivaPorToken(sessionToken) {
    const diagnostico = await this.diagnosticarSesionPorToken(sessionToken);
    return diagnostico.estado === 'viva' ? diagnostico.sesion : null;
  }

  async diagnosticarSesionPorToken(sessionToken) {
    const sessionTokenHash = calcularHuellaSesionAgente(sessionToken);
    const claveToken = this.obtenerClaveTokenHash(sessionTokenHash);
    const bruto = await this.clienteRedis.get(claveToken);

    if (!bruto) {
      return { estado: 'no_encontrada', sesion: null, ttlRestanteSegundos: 0 };
    }

    const ttlRestanteSegundos = await this.clienteRedis.ttl(claveToken);
    const sesion = this.parsearSesionRedis(bruto);

    if (ttlRestanteSegundos === -2) {
      return {
        estado: sesion ? 'token_sin_ttl' : 'no_encontrada',
        sesion,
        ttlRestanteSegundos: 0
      };
    }

    if (!sesion) {
      return { estado: 'payload_invalido', sesion: null, ttlRestanteSegundos };
    }

    const actualBruto = await this.clienteRedis.get(
      this.obtenerClaveSesionActualAgente(sesion.agenteId)
    );

    if (!actualBruto) {
      return { estado: 'sin_indice_actual', sesion, ttlRestanteSegundos };
    }

    const actual = this.parsearJson(actualBruto);

    if (
      actual?.sessionId !== sesion.sessionId ||
      actual?.sessionTokenHash !== sesion.sessionTokenHash
    ) {
      return { estado: 'reemplazada', sesion, ttlRestanteSegundos };
    }

    return {
      estado: 'viva',
      sesion,
      ttlRestanteSegundos: ttlRestanteSegundos < 0
        ? sesion.ttlSegundos
        : ttlRestanteSegundos
    };
  }

  async obtenerSesionActualAgente(idAgente) {
    const claveActual = this.obtenerClaveSesionActualAgente(idAgente);
    const indice = this.parsearJson(await this.clienteRedis.get(claveActual));

    if (!indice) {
      return { estado: 'sin_sesion', sesion: null, ttlRestanteSegundos: 0 };
    }

    if (!indice.sessionTokenHash || !indice.sessionId) {
      return { estado: 'indice_invalido', sesion: null, ttlRestanteSegundos: 0 };
    }

    const claveToken = this.obtenerClaveTokenHash(indice.sessionTokenHash);
    const brutoSesion = await this.clienteRedis.get(claveToken);

    if (!brutoSesion) {
      return { estado: 'token_no_encontrado', sesion: null, ttlRestanteSegundos: 0 };
    }

    const ttlRestanteSegundos = await this.clienteRedis.ttl(claveToken);

    if (ttlRestanteSegundos === -2) {
      return { estado: 'token_no_encontrado', sesion: null, ttlRestanteSegundos: 0 };
    }

    const sesion = this.parsearSesionRedis(brutoSesion);

    if (!sesion) {
      return {
        estado: 'payload_invalido',
        sesion: null,
        ttlRestanteSegundos: Math.max(0, ttlRestanteSegundos)
      };
    }

    if (
      Number(sesion.agenteId) !== Number(idAgente) ||
      sesion.sessionId !== indice.sessionId ||
      sesion.sessionTokenHash !== indice.sessionTokenHash
    ) {
      return {
        estado: 'no_coincide',
        sesion,
        ttlRestanteSegundos: Math.max(0, ttlRestanteSegundos)
      };
    }

    return {
      estado: 'viva',
      sesion,
      ttlRestanteSegundos: ttlRestanteSegundos < 0
        ? sesion.ttlSegundos
        : ttlRestanteSegundos
    };
  }

  async invalidarSesionActualAgente(idAgente) {
    const claveActual = this.obtenerClaveSesionActualAgente(idAgente);
    const actual = this.parsearJson(await this.clienteRedis.get(claveActual));
    const claves = [claveActual];

    if (actual?.sessionTokenHash) {
      claves.push(this.obtenerClaveTokenHash(actual.sessionTokenHash));
    }

    const eliminadas = await this.clienteRedis.del(claves);

    return {
      eliminadas: Number(eliminadas || 0),
      sessionId: actual?.sessionId || null
    };
  }

  async invalidarSesionSiCoincide({ idAgente, sessionTokenHash }) {
    const hash = String(sessionTokenHash || '').trim().toLowerCase();

    if (!/^[0-9a-f]{64}$/.test(hash)) {
      return false;
    }

    const resultado = await this.clienteRedis.eval(
      SCRIPT_INVALIDAR_SI_COINCIDE,
      {
        keys: [
          this.obtenerClaveSesionActualAgente(idAgente),
          this.obtenerClaveTokenHash(hash)
        ],
        arguments: [hash]
      }
    );

    return Number(resultado || 0) > 0;
  }

  async registrarHeartbeatSesionActualSiCoincide({
    idAgente,
    sessionId,
    sessionTokenHash,
    recibidoEnUtc,
    seq,
    uptimeSeconds = null
  }) {
    const hash = normalizarHashSesion(sessionTokenHash);
    const resultado = await this.clienteRedis.eval(
      SCRIPT_REGISTRAR_HEARTBEAT_SI_COINCIDE,
      {
        keys: [
          this.obtenerClaveSesionActualAgente(idAgente),
          this.obtenerClaveTokenHash(hash)
        ],
        arguments: [
          String(sessionId || '').trim(),
          hash,
          normalizarIsoUtc(recibidoEnUtc),
          String(this.normalizarEnteroMinimo(seq, 0)),
          uptimeSeconds == null
            ? ''
            : String(this.normalizarEnteroMinimo(uptimeSeconds, 0))
        ]
      }
    );
    const estado = Array.isArray(resultado) ? resultado[0] : resultado;
    const ttlRestanteSegundos = Array.isArray(resultado)
      ? Number.parseInt(String(resultado[1] || '0'), 10)
      : 0;

    return {
      estado: estado || 'desconocido',
      registrado: estado === 'registrado',
      ttlRestanteSegundos: Number.isInteger(ttlRestanteSegundos)
        ? Math.max(0, ttlRestanteSegundos)
        : 0
    };
  }

  async intentarBloquearLoginAgente({
    idAgente,
    identificadorBloqueo,
    ttlSegundos = 15
  }) {
    const resultado = await this.clienteRedis.set(
      this.obtenerClaveBloqueoLoginAgente(idAgente),
      identificadorBloqueo,
      {
        NX: true,
        EX: this.normalizarTtl(ttlSegundos)
      }
    );

    return resultado === 'OK';
  }

  async liberarBloqueoLoginAgente({ idAgente, identificadorBloqueo }) {
    const resultado = await this.clienteRedis.eval(
      SCRIPT_LIBERAR_BLOQUEO_LOGIN,
      {
        keys: [this.obtenerClaveBloqueoLoginAgente(idAgente)],
        arguments: [identificadorBloqueo]
      }
    );

    return Number(resultado || 0) > 0;
  }

  obtenerClaveSesionActualAgente(idAgente) {
    return `${this.prefijoSesionesAgentes}agente:${idAgente}:actual`;
  }

  obtenerClaveTokenHash(sessionTokenHash) {
    return `${this.obtenerPrefijoTokenHash()}${sessionTokenHash}`;
  }

  obtenerClaveBloqueoLoginAgente(idAgente) {
    return `${this.prefijoSesionesAgentes}agente:${idAgente}:login_lock`;
  }

  obtenerPrefijoTokenHash() {
    return `${this.prefijoSesionesAgentes}token:`;
  }

  parsearSesionRedis(bruto) {
    const payload = this.parsearJson(bruto);
    return payload ? crearSesionAgenteDesdeRedis(payload) : null;
  }

  parsearJson(bruto) {
    if (!bruto) {
      return null;
    }

    try {
      return JSON.parse(bruto);
    } catch (_error) {
      return null;
    }
  }

  normalizarTtl(valor) {
    const convertido = Number.parseInt(String(valor ?? ''), 10);
    return Number.isInteger(convertido) && convertido > 0 ? convertido : 900;
  }

  normalizarEnteroMinimo(valor, minimo) {
    const convertido = Number.parseInt(String(valor ?? ''), 10);

    if (!Number.isInteger(convertido) || convertido < minimo) {
      throw new Error('El valor numérico de sesión del agente no es válido.');
    }

    return convertido;
  }
}

function normalizarHashSesion(valor) {
  const normalizado = String(valor || '').trim().toLowerCase();

  if (!/^[0-9a-f]{64}$/.test(normalizado)) {
    throw new Error('La huella de sesión del agente no es válida.');
  }

  return normalizado;
}

function normalizarIsoUtc(valor) {
  const fecha = valor instanceof Date ? valor : new Date(valor);

  if (Number.isNaN(fecha.getTime())) {
    throw new Error('La fecha de heartbeat de sesión no es válida.');
  }

  return fecha.toISOString();
}

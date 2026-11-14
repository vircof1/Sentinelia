import { validarUuidV7Auditoria } from '../../auditoria/src/UuidV7Auditoria.js';

const MAX_BIGINT_UNSIGNED = 18_446_744_073_709_551_615n;

const SCRIPT_APLICAR = `
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
  if comparacion < 0 then return { 'fencing_antiguo', fencingActual, operacionActual or '' } end
  if comparacion == 0 and operacionActual ~= ARGV[2] then
    return { 'conflicto_mismo_fencing', fencingActual, operacionActual or '' }
  end
end

local actual = redis.call('GET', KEYS[2])
local hashAnterior = ''
if actual then
  local ok, datos = pcall(cjson.decode, actual)
  if ok and datos and datos.sessionTokenHash then hashAnterior = datos.sessionTokenHash end
end

local repetida = fencingActual == ARGV[1] and operacionActual == ARGV[2]
if repetida and ARGV[4] == 'establecer' and actual and actual ~= ARGV[5] then
  return { 'conflicto_repeticion_payload', fencingActual, operacionActual }
end
local replayActual = redis.call('GET', KEYS[4])
if repetida and ARGV[9] == 'con_replay' and replayActual and replayActual ~= ARGV[10] then
  return { 'conflicto_repeticion_replay', fencingActual, operacionActual }
end
if not repetida and ARGV[9] == 'con_replay' and ARGV[12] ~= '' and hashAnterior ~= ARGV[12] then
  return { 'token_anterior_no_coincide', ARGV[1], ARGV[2] }
end
redis.call('HSET', KEYS[1],
  'fencingToken', ARGV[1],
  'operacionId', ARGV[2],
  'sesionAuditoriaId', ARGV[3])

if ARGV[4] == 'establecer' then
  redis.call('SET', KEYS[2], ARGV[5], 'EX', tonumber(ARGV[6]))
  redis.call('SET', KEYS[3], ARGV[5], 'EX', tonumber(ARGV[6]))
else
  redis.call('DEL', KEYS[2])
end
if ARGV[9] == 'con_replay' then
  redis.call('SET', KEYS[4], ARGV[10], 'EX', tonumber(ARGV[11]))
  if ARGV[12] ~= '' then
    redis.call('SET', ARGV[8] .. ARGV[12], ARGV[13], 'EX', tonumber(ARGV[11]))
  elseif hashAnterior ~= '' and hashAnterior ~= ARGV[7] then
    redis.call('DEL', ARGV[8] .. hashAnterior)
  end
elseif hashAnterior ~= '' and hashAnterior ~= ARGV[7] then
  redis.call('DEL', ARGV[8] .. hashAnterior)
end

if repetida then return { 'repetida', ARGV[1], ARGV[2] } end
return { 'aplicada', ARGV[1], ARGV[2] }
`;

const SCRIPT_RETIRAR_SI_COINCIDE = `
if redis.call('HGET', KEYS[1], 'fencingToken') ~= ARGV[1]
   or redis.call('HGET', KEYS[1], 'operacionId') ~= ARGV[2] then
  return 0
end
local actual = redis.call('GET', KEYS[2])
if not actual then return 0 end
local ok, datos = pcall(cjson.decode, actual)
if not ok or not datos or datos.fencingToken ~= ARGV[1]
   or datos.operacionId ~= ARGV[2] then return 0 end
if datos.sessionTokenHash then redis.call('DEL', ARGV[3] .. datos.sessionTokenHash) end
redis.call('DEL', KEYS[2])
return 1
`;

export class RepositorioSesionesTecnicasCoordinadasRedis {
  constructor({
    clienteRedis,
    prefijo = 'sentinelia:agentes:sesiones:v2:'
  } = {}) {
    if (!clienteRedis?.eval || !clienteRedis?.get || !clienteRedis?.hGetAll) {
      throw new Error('Las sesiones técnicas coordinadas requieren Redis operativo.');
    }
    this.clienteRedis = clienteRedis;
    this.prefijo = normalizarPrefijo(prefijo);
  }

  async aplicar({
    agenteId,
    operacionId,
    sesionAuditoriaId,
    fencingToken,
    proyeccion,
    ttlSegundos = 900,
    replay = null
  } = {}) {
    const id = idDecimal(agenteId, 'agenteId');
    const operacion = validarUuidV7Auditoria(operacionId, 'operacionId');
    const sesion = validarUuidV7Auditoria(sesionAuditoriaId, 'sesionAuditoriaId');
    const fencing = bigintPositivo(fencingToken, 'fencingToken');
    const eliminar = proyeccion === null;
    const payload = eliminar
      ? ''
      : serializarProyeccion(proyeccion, { id, operacion, sesion, fencing });
    const ttl = eliminar ? 1 : entero(ttlSegundos, 1, 86_400, 'ttlSegundos');
    const hash = eliminar ? '' : proyeccion.sessionTokenHash;
    if (eliminar && replay !== null) {
      throw new Error('Una invalidación no puede conservar replay cifrado.');
    }
    const replayNormalizado = replay === null
      ? null
      : normalizarReplay(replay, { id, operacion, sesion });
    const resultado = await this.clienteRedis.eval(SCRIPT_APLICAR, {
      keys: [
        this.claveAutoridad(id),
        this.claveActual(id),
        eliminar ? this.claveTokenVacia() : this.claveToken(hash),
        replayNormalizado ? this.claveReplay(operacion) : this.claveReplayVacia()
      ],
      arguments: [
        fencing,
        operacion,
        sesion,
        eliminar ? 'eliminar' : 'establecer',
        payload,
        String(ttl),
        hash,
        `${this.prefijo}token:`,
        replayNormalizado ? 'con_replay' : 'sin_replay',
        replayNormalizado?.payload ?? '',
        String(replayNormalizado?.ttlSegundos ?? 1),
        replayNormalizado?.tokenAnteriorHash ?? '',
        replayNormalizado?.payloadSoloReplay ?? ''
      ]
    });
    const valores = Array.isArray(resultado) ? resultado : [resultado];
    const estado = String(valores[0] || 'respuesta_invalida');
    return Object.freeze({
      estado,
      aplicada: ['aplicada', 'repetida'].includes(estado),
      repetida: estado === 'repetida',
      fencingVigente: valores[1] == null ? null : String(valores[1]),
      operacionVigente: valores[2] ? String(valores[2]) : null
    });
  }

  async retirarSiCoincide({ agenteId, operacionId, fencingToken } = {}) {
    const id = idDecimal(agenteId, 'agenteId');
    const operacion = validarUuidV7Auditoria(operacionId, 'operacionId');
    const fencing = bigintPositivo(fencingToken, 'fencingToken');
    const resultado = await this.clienteRedis.eval(SCRIPT_RETIRAR_SI_COINCIDE, {
      keys: [this.claveAutoridad(id), this.claveActual(id)],
      arguments: [fencing, operacion, `${this.prefijo}token:`]
    });
    return Number(resultado || 0) === 1;
  }

  async obtenerActual(agenteId) {
    return parsear(await this.clienteRedis.get(this.claveActual(agenteId)));
  }

  async obtenerPorTokenHash(sessionTokenHash) {
    return parsear(await this.clienteRedis.get(this.claveToken(hashSha256(sessionTokenHash))));
  }

  async obtenerAutoridad(agenteId) {
    const datos = await this.clienteRedis.hGetAll(this.claveAutoridad(agenteId));
    if (!datos?.fencingToken) return null;
    return Object.freeze({
      fencingToken: String(datos.fencingToken),
      operacionId: String(datos.operacionId),
      sesionAuditoriaId: String(datos.sesionAuditoriaId)
    });
  }

  async obtenerReplay(operacionId) {
    return parsear(await this.clienteRedis.get(this.claveReplay(operacionId)));
  }

  claveAutoridad(agenteId) {
    return `${this.prefijo}agente:${idDecimal(agenteId, 'agenteId')}:fencing`;
  }

  claveActual(agenteId) {
    return `${this.prefijo}agente:${idDecimal(agenteId, 'agenteId')}:actual`;
  }

  claveToken(hash) {
    return `${this.prefijo}token:${hashSha256(hash)}`;
  }

  claveTokenVacia() {
    return `${this.prefijo}token:__invalidacion__`;
  }

  claveReplay(operacionId) {
    return `${this.prefijo}replay:${validarUuidV7Auditoria(operacionId, 'operacionId')}`;
  }

  claveReplayVacia() {
    return `${this.prefijo}replay:__sin_replay__`;
  }
}

function normalizarReplay(replay, identidad) {
  if (!replay || typeof replay !== 'object' || Array.isArray(replay) ||
      Object.getPrototypeOf(replay) !== Object.prototype) {
    throw new Error('El replay técnico debe ser un objeto plano.');
  }
  const tipo = ['login', 'refresh'].includes(replay.tipo) ? replay.tipo : (() => {
    throw new Error('El tipo de replay no es válido.');
  })();
  const requestId = validarUuidV7Auditoria(replay.requestId, 'requestId');
  const ttlSegundos = entero(replay.ttlSegundos, 1, 900, 'replay.ttlSegundos');
  if (!replay.sobre || typeof replay.sobre !== 'object' || Array.isArray(replay.sobre)) {
    throw new Error('El sobre de replay no es válido.');
  }
  const normalizado = {
    agenteId: identidad.id,
    operacionId: identidad.operacion,
    requestId,
    sesionAuditoriaId: identidad.sesion,
    sobre: replay.sobre,
    tipo
  };
  validarJson(normalizado, new Set(), 'replay');
  const payload = JSON.stringify(normalizado);
  if (Buffer.byteLength(payload, 'utf8') > 90_000) {
    throw new Error('El sobre técnico de replay supera el límite admitido.');
  }
  let tokenAnteriorHash = '';
  let payloadSoloReplay = '';
  if (tipo === 'refresh') {
    tokenAnteriorHash = hashSha256(replay.tokenAnteriorHash);
    const soloReplay = {
      agenteId: identidad.id,
      estadoToken: 'solo_replay',
      operacionId: identidad.operacion,
      refreshRequestId: requestId,
      sesionAuditoriaId: identidad.sesion,
      sessionTokenHash: tokenAnteriorHash
    };
    payloadSoloReplay = JSON.stringify(soloReplay);
  } else if (replay.tokenAnteriorHash != null) {
    throw new Error('Login no admite token anterior para replay.');
  }
  return Object.freeze({ payload, payloadSoloReplay, tokenAnteriorHash, ttlSegundos });
}

function serializarProyeccion(proyeccion, identidad) {
  if (!proyeccion || typeof proyeccion !== 'object' || Array.isArray(proyeccion) || Object.getPrototypeOf(proyeccion) !== Object.prototype) {
    throw new Error('La proyección técnica debe ser un objeto plano.');
  }
  const claves = Object.keys(proyeccion).sort();
  const esperadas = [
    'agenteId', 'estadoToken', 'fencingToken', 'operacionId', 'scope',
    'sesionAuditoriaId', 'sessionId', 'sessionTokenHash', 'ttlSegundos',
    'versionAutorizacionAgente', 'versionScopeAgente'
  ].sort();
  if (claves.length !== esperadas.length || claves.some((clave, indice) => clave !== esperadas[indice])) {
    throw new Error('La proyección técnica no coincide con su perfil cerrado 5.21.5g.');
  }
  const normalizada = {
    agenteId: idDecimal(proyeccion.agenteId, 'proyeccion.agenteId'),
    operacionId: validarUuidV7Auditoria(proyeccion.operacionId, 'proyeccion.operacionId'),
    sesionAuditoriaId: validarUuidV7Auditoria(
      proyeccion.sesionAuditoriaId,
      'proyeccion.sesionAuditoriaId'
    ),
    fencingToken: bigintPositivo(proyeccion.fencingToken, 'proyeccion.fencingToken'),
    versionScopeAgente: bigintPositivo(
      proyeccion.versionScopeAgente,
      'proyeccion.versionScopeAgente'
    ),
    versionAutorizacionAgente: bigintPositivo(
      proyeccion.versionAutorizacionAgente,
      'proyeccion.versionAutorizacionAgente'
    ),
    scope: normalizarScope(proyeccion.scope),
    sessionId: texto(proyeccion.sessionId, 128, 'sessionId'),
    sessionTokenHash: hashSha256(proyeccion.sessionTokenHash),
    ttlSegundos: entero(proyeccion.ttlSegundos, 1, 86_400, 'ttlSegundos'),
    estadoToken: proyeccion.estadoToken === 'actual' ? 'actual' : (() => {
      throw new Error('estadoToken debe ser actual en 5.21.5g.');
    })()
  };
  if (
    normalizada.agenteId !== identidad.id ||
    normalizada.operacionId !== identidad.operacion ||
    normalizada.sesionAuditoriaId !== identidad.sesion ||
    normalizada.fencingToken !== identidad.fencing
  ) {
    throw new Error('La proyección no coincide con la operación durable.');
  }
  validarJson(normalizada, new Set(), 'proyeccion');
  const serializada = JSON.stringify(normalizada);
  if (Buffer.byteLength(serializada, 'utf8') > 65_536) {
    throw new Error('La proyección técnica supera 65.536 bytes UTF-8.');
  }
  return serializada;
}

function parsear(valor) {
  if (!valor) return null;
  try {
    const datos = JSON.parse(valor);
    validarJson(datos, new Set(), 'proyeccion');
    return Object.freeze(datos);
  } catch {
    return null;
  }
}

function validarJson(valor, visitados, ruta) {
  if (valor === null || typeof valor === 'string' || typeof valor === 'boolean') return;
  if (typeof valor === 'number' && Number.isFinite(valor)) return;
  if (typeof valor !== 'object' || visitados.has(valor)) {
    throw new Error(`${ruta} no es JSON acíclico.`);
  }
  if (!Array.isArray(valor) && Object.getPrototypeOf(valor) !== Object.prototype) {
    throw new Error(`${ruta} contiene un objeto no plano.`);
  }
  visitados.add(valor);
  if (Array.isArray(valor)) {
    for (let indice = 0; indice < valor.length; indice += 1) {
      if (!Object.hasOwn(valor, indice)) throw new Error(`${ruta} contiene una posición vacía.`);
      validarJson(valor[indice], visitados, `${ruta}[${indice}]`);
    }
  } else {
    for (const clave of Reflect.ownKeys(valor)) {
      if (typeof clave !== 'string' || !Object.prototype.propertyIsEnumerable.call(valor, clave)) {
        throw new Error(`${ruta} contiene una propiedad no JSON.`);
      }
      if (/^(?:bearer|sessionToken|secreto|password)$/i.test(clave)) {
        throw new Error(`${ruta}.${clave} contiene material prohibido.`);
      }
      validarJson(valor[clave], visitados, `${ruta}.${clave}`);
    }
  }
  visitados.delete(valor);
}

function normalizarScope(scope) {
  const resultado = {
    tenantId: scope?.tenantId == null ? null : idDecimal(scope.tenantId, 'scope.tenantId'),
    empresaId: scope?.empresaId == null ? null : idDecimal(scope.empresaId, 'scope.empresaId'),
    sitioId: scope?.sitioId == null ? null : idDecimal(scope.sitioId, 'scope.sitioId')
  };
  if ((!resultado.tenantId && (resultado.empresaId || resultado.sitioId)) ||
      (!resultado.empresaId && resultado.sitioId)) {
    throw new Error('La proyección no respeta la jerarquía de scope.');
  }
  return Object.freeze(resultado);
}

function idDecimal(valor, nombre) {
  const textoValor = String(valor ?? '');
  if (!/^[1-9][0-9]*$/.test(textoValor) || BigInt(textoValor) > MAX_BIGINT_UNSIGNED) {
    throw new Error(`${nombre} debe ser decimal positivo.`);
  }
  return textoValor;
}

function bigintPositivo(valor, nombre) {
  return idDecimal(valor, nombre);
}

function hashSha256(valor) {
  const textoValor = String(valor || '').toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(textoValor)) throw new Error('sessionTokenHash debe ser SHA-256 hexadecimal.');
  return textoValor;
}

function texto(valor, maximo, nombre) {
  const resultado = String(valor || '').trim();
  if (!resultado || resultado.length > maximo) throw new Error(`${nombre} no es válido.`);
  return resultado;
}

function entero(valor, minimo, maximo, nombre) {
  if (!Number.isInteger(valor) || valor < minimo || valor > maximo) {
    throw new Error(`${nombre} queda fuera de rango.`);
  }
  return valor;
}

function normalizarPrefijo(valor) {
  const resultado = String(valor || '');
  if (!resultado.endsWith(':') || resultado.length > 200 || !/^[\x21-\x7e]+$/.test(resultado)) {
    throw new Error('El prefijo Redis técnico no es válido.');
  }
  return resultado;
}

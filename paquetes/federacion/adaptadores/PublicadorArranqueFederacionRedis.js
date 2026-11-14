const SCRIPT_ASEGURAR_PRESENCIA = `
local actual = redis.call('GET', KEYS[1])
if actual then
  local estado = cjson.decode(actual)
  if estado.installationId ~= ARGV[1] then return {'conflicto_instalacion'} end
  if ARGV[3] ~= '' and estado.bootId ~= ARGV[3] then
    return {'conflicto_arranque', actual}
  end
  redis.call('EXPIRE', KEYS[1], tonumber(ARGV[4]))
  return {'existente', actual}
end
local bootId = ARGV[3] ~= '' and ARGV[3] or ARGV[2]
local nuevo = cjson.encode({
  versionContrato = 1,
  installationId = ARGV[1],
  bootId = bootId,
  ttlSegundos = tonumber(ARGV[4])
})
redis.call('SET', KEYS[1], nuevo, 'EX', tonumber(ARGV[4]))
return {ARGV[3] ~= '' and 'reconstruido' or 'creado', nuevo}
`;

const SCRIPT_REEMPLAZAR_PRESENCIA = `
local actual = redis.call('GET', KEYS[1])
if not actual then return {'ausente'} end
local estado = cjson.decode(actual)
if estado.installationId ~= ARGV[1] then return {'conflicto_instalacion'} end
if estado.bootId ~= ARGV[2] then return {'arranque_cambio'} end
local nuevo = cjson.encode({
  versionContrato = 1,
  installationId = ARGV[1],
  bootId = ARGV[3],
  ttlSegundos = tonumber(ARGV[4])
})
redis.call('SET', KEYS[1], nuevo, 'EX', tonumber(ARGV[4]))
return {'renovado', nuevo}
`;

export class PublicadorArranqueFederacionRedis {
  constructor({
    clienteRedis,
    prefijo = 'sentinelia:federacion',
    ttlSegundos = 120
  } = {}) {
    if (typeof clienteRedis?.eval !== 'function') {
      throw new Error(
        'PublicadorArranqueFederacionRedis requiere un cliente Redis operativo.'
      );
    }
    const prefijoNormalizado = String(prefijo || '').trim().replace(/:+$/u, '');
    if (!prefijoNormalizado) {
      throw new Error('El prefijo Redis de federación no puede estar vacío.');
    }
    if (!Number.isSafeInteger(ttlSegundos) || ttlSegundos < 1 || ttlSegundos > 86400) {
      throw new Error('El TTL de presencia federada debe estar entre 1 y 86400 segundos.');
    }
    this.clienteRedis = clienteRedis;
    this.clave = `${prefijoNormalizado}:arranque-logico-actual:v1`;
    this.ttlSegundos = ttlSegundos;
    Object.freeze(this);
  }

  async asegurar({ installationId, bootIdCandidato, bootIdConocido = null } = {}) {
    const ids = serializarIds({ installationId, bootIdCandidato, bootIdConocido });
    const respuesta = await this.clienteRedis.eval(SCRIPT_ASEGURAR_PRESENCIA, {
      keys: [this.clave],
      arguments: [
        ids.installationId,
        ids.bootIdCandidato,
        ids.bootIdConocido ?? '',
        String(this.ttlSegundos)
      ]
    });
    return interpretarRespuesta(respuesta);
  }

  async reemplazar({ installationId, bootIdActual, bootIdNuevo } = {}) {
    const ids = serializarIds({
      installationId,
      bootIdCandidato: bootIdNuevo,
      bootIdConocido: bootIdActual
    });
    const respuesta = await this.clienteRedis.eval(SCRIPT_REEMPLAZAR_PRESENCIA, {
      keys: [this.clave],
      arguments: [
        ids.installationId,
        ids.bootIdConocido,
        ids.bootIdCandidato,
        String(this.ttlSegundos)
      ]
    });
    return interpretarRespuesta(respuesta);
  }
}

function serializarIds({ installationId, bootIdCandidato, bootIdConocido }) {
  const instalacion = installationId?.serializar?.();
  const candidato = bootIdCandidato?.serializar?.();
  const conocido = bootIdConocido?.serializar?.() ?? null;
  if (!instalacion || !candidato || (bootIdConocido !== null && !conocido)) {
    throw new Error('La presencia Redis exige identidades federadas nominales.');
  }
  return { installationId: instalacion, bootIdCandidato: candidato, bootIdConocido: conocido };
}

function interpretarRespuesta(respuesta) {
  const [codigo, json = null] = Array.isArray(respuesta) ? respuesta : [];
  if (!['creado', 'existente', 'reconstruido', 'renovado'].includes(codigo)) {
    const error = new Error(`No se pudo coordinar la presencia federada: ${codigo || 'respuesta_invalida'}.`);
    error.codigo = codigo || 'respuesta_invalida';
    throw error;
  }
  let estado;
  try {
    estado = JSON.parse(json);
  } catch {
    throw new Error('Redis devolvió una presencia federada ilegible.');
  }
  return Object.freeze({ codigo, ...estado });
}

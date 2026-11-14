const SCRIPT_PUBLICAR = `
local function compararDecimal(a, b)
  a = string.gsub(a, '^0+', '')
  b = string.gsub(b, '^0+', '')
  if a == '' then a = '0' end
  if b == '' then b = '0' end
  if string.len(a) ~= string.len(b) then
    return string.len(a) > string.len(b) and 1 or -1
  end
  if a == b then return 0 end
  return a > b and 1 or -1
end
local actualRaw = redis.call('GET', KEYS[1])
if actualRaw then
  local actual = cjson.decode(actualRaw)
  local ordenFencing = compararDecimal(tostring(actual.fencingToken), ARGV[2])
  if ordenFencing > 0 then return 'fencing_obsoleto' end
  if ordenFencing == 0 and compararDecimal(tostring(actual.seq), ARGV[3]) > 0 then
    return 'secuencia_obsoleta'
  end
end
redis.call('SET', KEYS[1], ARGV[1], 'EX', ARGV[4])
local pulsoRaw = redis.call('GET', KEYS[2])
local pulso = cjson.decode(ARGV[1])
if pulsoRaw then
  local anterior = cjson.decode(pulsoRaw)
  pulso.primeroObservadoEnUtc = anterior.primeroObservadoEnUtc
else
  pulso.primeroObservadoEnUtc = pulso.observadoEnUtc
end
redis.call('SET', KEYS[2], cjson.encode(pulso), 'EX', ARGV[4])
return 'publicada'
`;

export class RepositorioPresenciaFederacionRedis {
  constructor({ clienteRedis, prefijo = 'sentinelia:federacion', ttlSegundos = 90 } = {}) {
    if (typeof clienteRedis?.eval !== 'function' || typeof clienteRedis?.get !== 'function' ||
        typeof clienteRedis?.scanIterator !== 'function') {
      throw new Error('La presencia federada requiere Redis operativo.');
    }
    if (!Number.isSafeInteger(ttlSegundos) || ttlSegundos < 10) {
      throw new Error('El TTL de presencia federada no es válido.');
    }
    this.clienteRedis = clienteRedis;
    this.prefijo = String(prefijo).replace(/:+$/u, '');
    this.ttlSegundos = ttlSegundos;
  }

  async publicar(presencia, { ttlSegundos = this.ttlSegundos } = {}) {
    if (!Number.isSafeInteger(ttlSegundos) || ttlSegundos < 1 ||
        ttlSegundos > this.ttlSegundos) {
      throw new Error('El TTL efectivo de presencia federada no es válido.');
    }
    const resultado = await this.clienteRedis.eval(SCRIPT_PUBLICAR, {
      keys: [
        this.clave(presencia.relacionId),
        this.clavePulso(presencia.installationRemotaId, presencia.bootRemotoId,
          presencia.relacionId)
      ],
      arguments: [
        JSON.stringify(presencia), String(presencia.fencingToken),
        String(presencia.seq), String(ttlSegundos)
      ]
    });
    if (resultado !== 'publicada') {
      const error = new Error('La presencia pertenece a una sesión o secuencia sustituida.');
      error.codigo = 'PRESENCIA_FEDERADA_OBSOLETA';
      error.statusCode = 409;
      throw error;
    }
    return Object.freeze({ estado: resultado, ttlSegundos });
  }

  async consultar(relacionId) {
    const valor = await this.clienteRedis.get(this.clave(relacionId));
    return valor ? Object.freeze(JSON.parse(valor)) : null;
  }

  async listarPorInstalacion(installationRemotaId) {
    const presencias = [];
    for await (const clave of this.clienteRedis.scanIterator({
      MATCH: `${this.prefijo}:presencia:instalacion:${installationRemotaId}:*`,
      COUNT: 100
    })) {
      const valor = await this.clienteRedis.get(clave);
      if (valor) presencias.push(Object.freeze(JSON.parse(valor)));
    }
    return Object.freeze(presencias.sort((a, b) =>
      a.bootRemotoId.localeCompare(b.bootRemotoId) || a.relacionId.localeCompare(b.relacionId)));
  }

  clave(relacionId) {
    return `${this.prefijo}:presencia:${relacionId}`;
  }

  clavePulso(installationRemotaId, bootRemotoId, relacionId) {
    return `${this.prefijo}:presencia:instalacion:${installationRemotaId}:${bootRemotoId}:${relacionId}`;
  }
}

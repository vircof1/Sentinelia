export class VersionadorConfiguracionRedis {
  constructor({ clienteRedis, claveVersion }) {
    this.clienteRedis = clienteRedis;
    this.claveVersion = claveVersion;
  }

  async obtenerVersionActual() {
    const versionActual = await this.clienteRedis.get(this.claveVersion);

    if (!versionActual) {
      return null;
    }

    return Number(versionActual);
  }

  async publicarVersion(version) {
    const normalizada = String(version ?? '');
    if (!/^[1-9][0-9]*$/.test(normalizada)) {
      throw new Error('La versión durable de configuración no es válida.');
    }
    const resultado = await this.clienteRedis.eval(
      `local actual = redis.call('GET', KEYS[1])
       local nueva = ARGV[1]
       local function menor(a, b)
         if string.len(a) ~= string.len(b) then return string.len(a) < string.len(b) end
         return a < b
       end
       if not actual or menor(actual, nueva) then
         redis.call('SET', KEYS[1], nueva)
         return nueva
       end
       return actual`,
      { keys: [this.claveVersion], arguments: [normalizada] }
    );
    return Number(resultado);
  }
}

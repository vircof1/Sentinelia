const SCRIPT_SINCRONIZAR_PROYECCION = `
  redis.call('SET', KEYS[1], ARGV[1], 'EX', ARGV[2])
  redis.call('ZREM', KEYS[2], ARGV[3], ARGV[5])
  if ARGV[4] ~= '' then
    redis.call('ZADD', KEYS[2], ARGV[4], ARGV[3])
  end
  if ARGV[6] ~= '' then
    redis.call('ZADD', KEYS[2], ARGV[6], ARGV[5])
  end
  return redis.call('PUBLISH', KEYS[3], ARGV[7])
`;

const SCRIPT_RETIRAR_PROYECCION = `
  redis.call('DEL', KEYS[1])
  redis.call('ZREM', KEYS[2], ARGV[1], ARGV[2])
  return redis.call('PUBLISH', KEYS[3], ARGV[3])
`;

export class CoordinadorPerfilServidorRedis {
  constructor({
    clienteRedis,
    prefijoRedis = 'sentinelia:runtime:perfil-servidor:',
    ttlProyeccionSegundos = 7 * 24 * 60 * 60,
    reloj = () => new Date()
  } = {}) {
    if (typeof clienteRedis?.eval !== 'function') {
      throw new Error('La coordinación del perfil servidor requiere Redis.');
    }
    this.clienteRedis = clienteRedis;
    this.prefijoRedis = String(prefijoRedis || '').trim();
    this.ttlProyeccionSegundos = enteroPositivo(
      ttlProyeccionSegundos,
      'ttlProyeccionSegundos'
    );
    this.reloj = reloj;
  }

  async sincronizarProyecciones({ estados = [], motivo = 'reconciliacion' } = {}) {
    const resultados = [];
    for (const entrada of Array.isArray(estados) ? estados : []) {
      const estado = serializar(entrada);
      const miembroBase = `${estado.agenteId}:${estado.generacion}`;
      const payload = {
        ...estado,
        autoridad: 'sql',
        sincronizadaEnUtc: this.reloj().toISOString()
      };
      const aviso = {
        tipo: 'perfil_servidor_runtime_actualizado',
        agenteId: estado.agenteId,
        generacion: estado.generacion,
        versionEstado: estado.versionEstado,
        motivo,
        publicadoEnUtc: payload.sincronizadaEnUtc
      };
      const receptores = await this.clienteRedis.eval(
        SCRIPT_SINCRONIZAR_PROYECCION,
        {
          keys: [
            this.claveProyeccion(estado.agenteId, estado.generacion),
            this.claveAgenda(),
            this.claveCanalAvisos()
          ],
          arguments: [
            JSON.stringify(payload),
            String(this.ttlProyeccionSegundos),
            `${miembroBase}:sin_pol`,
            puntuacionFecha(estado.venceSinPolUtc),
            `${miembroBase}:reinicio_reciente`,
            puntuacionFecha(estado.venceReinicioRecienteUtc),
            JSON.stringify(aviso)
          ]
        }
      );
      resultados.push({
        agenteId: estado.agenteId,
        generacion: estado.generacion,
        receptores: Number(receptores || 0)
      });
    }

    return Object.freeze({
      sincronizadas: resultados.length,
      resultados: Object.freeze(resultados)
    });
  }

  async retirarProyecciones({
    perfiles = [],
    motivo = 'perfil_retirado'
  } = {}) {
    const resultados = [];
    for (const perfil of Array.isArray(perfiles) ? perfiles : []) {
      const agenteId = enteroPositivo(perfil?.agenteId, 'agenteId');
      const generacion = enteroPositivo(perfil?.generacion, 'generacion');
      const miembroBase = `${agenteId}:${generacion}`;
      const publicadoEnUtc = this.reloj().toISOString();
      const receptores = await this.clienteRedis.eval(
        SCRIPT_RETIRAR_PROYECCION,
        {
          keys: [
            this.claveProyeccion(agenteId, generacion),
            this.claveAgenda(),
            this.claveCanalAvisos()
          ],
          arguments: [
            `${miembroBase}:sin_pol`,
            `${miembroBase}:reinicio_reciente`,
            JSON.stringify({
              tipo: 'perfil_servidor_runtime_retirado',
              agenteId,
              generacion,
              motivo,
              publicadoEnUtc
            })
          ]
        }
      );
      resultados.push({ agenteId, generacion, receptores: Number(receptores || 0) });
    }
    return Object.freeze({
      retiradas: resultados.length,
      resultados: Object.freeze(resultados)
    });
  }

  claveProyeccion(agenteId, generacion) {
    return `${this.prefijoRedis}estado:${enteroPositivo(agenteId, 'agenteId')}:` +
      `${enteroPositivo(generacion, 'generacion')}`;
  }

  claveAgenda() {
    return `${this.prefijoRedis}vencimientos`;
  }

  claveCanalAvisos() {
    return `${this.prefijoRedis}avisos`;
  }
}

function serializar(valor) {
  return typeof valor?.serializar === 'function' ? valor.serializar() : { ...valor };
}

function puntuacionFecha(valor) {
  if (!valor) return '';
  const milisegundos = Date.parse(valor);
  if (!Number.isFinite(milisegundos)) {
    throw new Error('La agenda runtime recibió un vencimiento inválido.');
  }
  return String(milisegundos);
}

function enteroPositivo(valor, campo) {
  const numero = Number(valor);
  if (!Number.isSafeInteger(numero) || numero <= 0) {
    throw new Error(`${campo} debe ser un entero positivo.`);
  }
  return numero;
}

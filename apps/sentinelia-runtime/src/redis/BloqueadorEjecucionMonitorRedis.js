function construirMarcaTemporal() {
  return new Date().toISOString();
}

function normalizarEnteroPositivo(valor, porDefecto) {
  const convertido = Number.parseInt(String(valor ?? ''), 10);
  return Number.isInteger(convertido) && convertido > 0 ? convertido : porDefecto;
}

export class BloqueadorEjecucionMonitorRedis {
  constructor({
    clienteRedis,
    servicioConfiguracionPortal,
    prefijoBloqueoMonitores
  }) {
    this.clienteRedis = clienteRedis;
    this.servicioConfiguracionPortal = servicioConfiguracionPortal;
    this.prefijoBloqueoMonitores = prefijoBloqueoMonitores;
  }

  async bloquearCandidatos({
    candidatos = [],
    instanciaId,
    origen = 'tick',
    numeroTick = null
  }) {
    const ejecutadoEnUtc = construirMarcaTemporal();
    const ttlSegundos = await this.obtenerTtlBloqueoSegundos();
    const bloqueos = [];
    const candidatosBloqueados = [];
    const candidatosSaltados = [];

    try {
      for (const candidato of candidatos) {
        const token = this.construirToken({
          monitorId: candidato.monitorId,
          instanciaId,
          origen,
          numeroTick,
          ejecutadoEnUtc
        });
        const clave = this.obtenerClaveBloqueo(candidato.monitorId);
        const adquirido = await this.clienteRedis.set(clave, token, {
          NX: true,
          EX: ttlSegundos
        });

        if (adquirido === 'OK') {
          bloqueos.push({
            clave,
            token,
            monitorId: candidato.monitorId
          });
          candidatosBloqueados.push(candidato);
        } else {
          candidatosSaltados.push(candidato);
        }
      }
    } catch (error) {
      if (bloqueos.length > 0) {
        await this.liberarBloqueos(bloqueos);
      }
      throw error;
    }

    return {
      resumen: {
        ejecutadoEnUtc,
        ttlSegundos,
        instanciaId,
        origen,
        numeroTick,
        totalCandidatos: candidatos.length,
        totalBloqueados: candidatosBloqueados.length,
        totalSaltados: candidatosSaltados.length,
        monitorIdsBloqueados: candidatosBloqueados.map((item) => item.monitorId),
        monitorIdsSaltados: candidatosSaltados.map((item) => item.monitorId)
      },
      candidatosBloqueados,
      candidatosSaltados,
      bloqueos
    };
  }

  async liberarBloqueos(bloqueos = []) {
    const errores = [];
    let totalLiberados = 0;
    let totalNoLiberados = 0;

    for (const bloqueo of bloqueos) {
      try {
        const liberado = await this.clienteRedis.eval(
          `
            if redis.call('GET', KEYS[1]) == ARGV[1] then
              return redis.call('DEL', KEYS[1])
            end
            return 0
          `,
          {
            keys: [bloqueo.clave],
            arguments: [bloqueo.token]
          }
        );

        if (Number(liberado || 0) > 0) {
          totalLiberados += 1;
        } else {
          totalNoLiberados += 1;
        }
      } catch (error) {
        totalNoLiberados += 1;
        errores.push({
          monitorId: bloqueo.monitorId,
          mensaje: String(error?.message || 'Error liberando bloqueo Redis.')
        });
      }
    }

    return {
      totalBloqueos: bloqueos.length,
      totalLiberados,
      totalNoLiberados,
      errores
    };
  }

  async obtenerTtlBloqueoSegundos() {
    await this.servicioConfiguracionPortal.asegurarActualizada();
    const configuracionPortal =
      this.servicioConfiguracionPortal.obtenerConfiguracionActual();
    const configuracionMonitores = configuracionPortal.obtenerConfiguracionMonitores();

    return normalizarEnteroPositivo(
      configuracionMonitores.runtimeBloqueoTtlSegundos,
      30
    );
  }

  construirToken({ monitorId, instanciaId, origen, numeroTick, ejecutadoEnUtc }) {
    return [
      String(instanciaId || 'runtime-desconocido'),
      String(origen || 'tick'),
      String(numeroTick || '0'),
      String(monitorId || '0'),
      String(ejecutadoEnUtc || construirMarcaTemporal())
    ].join(':');
  }

  obtenerClaveBloqueo(monitorId) {
    return `${this.prefijoBloqueoMonitores}${monitorId}`;
  }
}

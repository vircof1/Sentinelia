export class ProcesadorOperacionesSesionTecnicaAgentes {
  constructor({
    coordinador,
    adaptadorCoordinacion,
    repositorioRedis,
    resolverProyeccionInicial = async () => null,
    replayCifrado = false
  } = {}) {
    if (!coordinador?.reclamarSiguiente || !adaptadorCoordinacion?.verificarAutoridad) {
      throw new Error('El procesador requiere coordinación durable común.');
    }
    if (!repositorioRedis?.aplicar || !repositorioRedis?.retirarSiCoincide) {
      throw new Error('El procesador requiere la proyección Redis con fencing.');
    }
    this.coordinador = coordinador;
    this.adaptador = adaptadorCoordinacion;
    this.repositorioRedis = repositorioRedis;
    this.resolverProyeccionInicial = resolverProyeccionInicial;
    this.replayCifrado = Boolean(replayCifrado);
    if (this.replayCifrado && typeof repositorioRedis.obtenerReplay !== 'function') {
      throw new Error('El replay cifrado requiere persistencia Redis de sobres.');
    }
  }

  async procesarSiguiente() {
    const reclamada = await this.coordinador.reclamarSiguiente();
    if (!reclamada) return null;
    const { lease, operacion } = reclamada;
    try {
      if (operacion.estado === 'pendiente') {
        return await this.#prepararRedis(lease, operacion);
      }
      if (operacion.estado === 'redis_preparada') {
        return await this.#consolidarSql(lease, operacion);
      }
      if (operacion.estado === 'respuesta_pendiente') {
        return await this.#autorizarRespuesta(lease, operacion);
      }
      throw new Error(`Estado no procesable: ${operacion.estado}.`);
    } catch (error) {
      if (error?.operacionGestionada) throw error;
      await this.coordinador.registrarFallo(lease, {
        codigo: 'sesion_tecnica_reintentable',
        mensaje: error?.message || 'Fallo técnico recuperable.',
        permanente: false,
        demoraReintentoSegundos: 1
      }).catch(() => {});
      throw error;
    }
  }

  async #prepararRedis(lease, operacion) {
    const comprobacion = await this.adaptador.verificarAutoridad(lease);
    if (!comprobacion?.autoridad.vigente) {
      return this.#reemplazar(lease, operacion, 'autoridad_sql_superada');
    }
    const autoridadRedis = await this.repositorioRedis.obtenerAutoridad(operacion.agenteId);
    if (autoridadPosterior(autoridadRedis, operacion)) {
      return this.#reemplazar(lease, operacion, 'fencing_redis_superior');
    }
    const actualRedis = await this.repositorioRedis.obtenerActual(operacion.agenteId);
    const replayRedis = this.replayCifrado && operacion.tipo !== 'invalidacion'
      ? await this.repositorioRedis.obtenerReplay(operacion.operacionId)
      : null;
    const yaAplicada = proyeccionRepresentaOperacion(actualRedis, operacion) ||
      (operacion.tipo === 'invalidacion' &&
        autoridadRepresentaOperacion(autoridadRedis, operacion) && !actualRedis);
    const requiereAplicar = !yaAplicada ||
      (this.replayCifrado && operacion.tipo !== 'invalidacion' && !replayRedis);
    if (requiereAplicar) {
      const material = operacion.tipo === 'invalidacion'
        ? null
        : await this.resolverProyeccionInicial(operacion);
      const proyeccion = this.replayCifrado && material
        ? material.proyeccion
        : material;
      const replay = this.replayCifrado && material
        ? material.replay
        : null;
      if (operacion.tipo !== 'invalidacion' && !proyeccion) {
        const fallo = new Error(
          'La operación no llegó a Redis y ya no conserva material técnico recuperable.'
        );
        const resultado = await this.coordinador.registrarFallo(lease, {
          codigo: 'proyeccion_inicial_no_recuperable',
          mensaje: fallo.message,
          permanente: true
        });
        fallo.operacionGestionada = true;
        fallo.resultado = resultado;
        throw fallo;
      }
      const aplicada = await this.repositorioRedis.aplicar({
        agenteId: operacion.agenteId,
        operacionId: operacion.operacionId,
        sesionAuditoriaId: operacion.sesionAuditoriaId,
        fencingToken: operacion.fencingToken,
        proyeccion,
        ttlSegundos: proyeccion?.ttlSegundos ?? 900,
        replay
      });
      if (!aplicada.aplicada) {
        return this.#reemplazar(lease, operacion, aplicada.estado);
      }
    }
    const segundaComprobacion = await this.adaptador.verificarAutoridad(lease);
    if (!segundaComprobacion?.autoridad.vigente) {
      await this.#retirarPropia(operacion);
      return this.#reemplazar(lease, operacion, 'autoridad_cambio_despues_redis');
    }
    const avanzada = await this.coordinador.avanzar(lease, {
      transicion: 'redis_observada'
    });
    return Object.freeze({
      operacionId: operacion.operacionId,
      estado: 'redis_preparada',
      resultado: avanzada
    });
  }

  async #consolidarSql(lease, operacion) {
    const autoridadRedis = await this.repositorioRedis.obtenerAutoridad(operacion.agenteId);
    const actualRedis = await this.repositorioRedis.obtenerActual(operacion.agenteId);
    if (autoridadPosterior(autoridadRedis, operacion)) {
      return this.#reemplazar(lease, operacion, 'fencing_redis_superior');
    }
    const observada = operacion.tipo === 'invalidacion'
      ? autoridadRepresentaOperacion(autoridadRedis, operacion) && !actualRedis
      : proyeccionRepresentaOperacion(actualRedis, operacion);
    if (!observada) {
      throw new Error('Redis todavía no demuestra el efecto de esta operación.');
    }
    const replay = this.replayCifrado && operacion.tipo !== 'invalidacion'
      ? await this.repositorioRedis.obtenerReplay(operacion.operacionId)
      : null;
    if (this.replayCifrado && operacion.tipo !== 'invalidacion' && !replay) {
      throw new Error('Redis no conserva el sobre cifrado de la operación observada.');
    }
    const consolidada = await this.coordinador.consolidar(lease, {
      resultado: {
        efectoRedisObservado: true,
        replayCifradoDisponible: Boolean(replay),
        keyId: replay?.sobre?.keyId ?? null
      }
    });
    if (consolidada.reemplazada) await this.#retirarPropia(operacion);
    return Object.freeze({
      operacionId: operacion.operacionId,
      estado: consolidada.operacion?.estado ?? 'reemplazada',
      resultado: consolidada
    });
  }

  async #autorizarRespuesta(lease, operacion) {
    const actualRedis = await this.repositorioRedis.obtenerActual(operacion.agenteId);
    if (!proyeccionRepresentaOperacion(actualRedis, operacion)) {
      return this.#reemplazar(lease, operacion, 'respuesta_superada_en_redis');
    }
    const consolidada = await this.coordinador.consolidar(lease, {
      resultado: { respuestaAutorizada: true }
    });
    if (consolidada.reemplazada) {
      await this.#retirarPropia(operacion);
      return Object.freeze({
        operacionId: operacion.operacionId,
        estado: 'reemplazada',
        liberarRespuesta: false
      });
    }
    const finalRedis = await this.repositorioRedis.obtenerActual(operacion.agenteId);
    const liberarRespuesta = proyeccionRepresentaOperacion(finalRedis, operacion);
    return Object.freeze({
      operacionId: operacion.operacionId,
      estado: 'consolidada',
      liberarRespuesta,
      sesionAuditoriaId: liberarRespuesta ? operacion.sesionAuditoriaId : null
    });
  }

  async #reemplazar(lease, operacion, motivo) {
    await this.#retirarPropia(operacion);
    const resultado = await this.adaptador.reemplazarConLease(lease, motivo);
    return Object.freeze({
      operacionId: operacion.operacionId,
      estado: 'reemplazada',
      liberarRespuesta: false,
      resultado
    });
  }

  #retirarPropia(operacion) {
    return this.repositorioRedis.retirarSiCoincide({
      agenteId: operacion.agenteId,
      operacionId: operacion.operacionId,
      fencingToken: operacion.fencingToken
    });
  }
}

function autoridadRepresentaOperacion(autoridad, operacion) {
  return autoridad?.operacionId === operacion.operacionId &&
    autoridad?.fencingToken === operacion.fencingToken &&
    autoridad?.sesionAuditoriaId === operacion.sesionAuditoriaId;
}

function proyeccionRepresentaOperacion(proyeccion, operacion) {
  return proyeccion?.operacionId === operacion.operacionId &&
    proyeccion?.sesionAuditoriaId === operacion.sesionAuditoriaId &&
    proyeccion?.fencingToken === operacion.fencingToken &&
    String(proyeccion.agenteId) === operacion.agenteId &&
    proyeccion.versionScopeAgente === operacion.versionScopeObservada &&
    proyeccion.versionAutorizacionAgente === operacion.versionAutorizacionObservada;
}

function autoridadPosterior(autoridad, operacion) {
  if (!autoridad) return false;
  const actual = BigInt(autoridad.fencingToken);
  const propia = BigInt(operacion.fencingToken);
  return actual > propia ||
    (actual === propia && autoridad.operacionId !== operacion.operacionId);
}

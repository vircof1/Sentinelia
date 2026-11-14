export class AdaptadorCoordinacionSesionesTecnicasAgentes {
  constructor({ repositorioOperaciones, consolidadorSql } = {}) {
    if (!repositorioOperaciones?.reclamarSiguienteConLease) {
      throw new Error('El adaptador requiere operaciones de sesión durables.');
    }
    if (typeof consolidadorSql?.consolidarEnTransaccion !== 'function') {
      throw new Error('El adaptador requiere consolidación SQL de sesión.');
    }
    this.repositorio = repositorioOperaciones;
    this.consolidadorSql = consolidadorSql;
  }

  async reclamarSiguiente({ instanciaId, leaseToken, ttlSegundos, operacionId = null }) {
    const operacion = await this.repositorio.reclamarSiguienteConLease({
      instanciaId,
      leaseToken,
      ttlSegundos,
      operacionId
    });
    if (!operacion) return null;
    return {
      operacionId: operacion.operacionId,
      fencingToken: operacion.fencingToken,
      intentos: operacion.intentos,
      operacion
    };
  }

  async renovarLease(parametros) {
    return { actualizada: await this.repositorio.renovarLease(parametros) };
  }

  async avanzarConLease(parametros) {
    if (parametros.transicion !== 'redis_observada') {
      throw new Error('La operación técnica solo admite redis_observada como avance.');
    }
    const resultado = await this.#transaccion(async (conexion) => {
      const actual = await this.repositorio.bloquearLeaseVigente(parametros, { conexion });
      if (!actual || actual.estado !== 'pendiente') return null;
      return this.repositorio.transicionarConLeaseEnTransaccion(
        parametros,
        'redis_preparada',
        { conexion }
      );
    });
    return { actualizada: Boolean(resultado), operacion: resultado };
  }

  async consolidarConLease(parametros) {
    const previa = await this.repositorio.buscarPorId(parametros.operacionId);
    if (!previa) return { actualizada: false };
    const resultado = await this.#transaccion(async (conexion) => {
      const autoridad = await this.repositorio.verificarAutoridadOperacionEnTransaccion(
        previa,
        { conexion }
      );
      const operacion = await this.repositorio.bloquearLeaseVigente(parametros, { conexion });
      if (!operacion) return null;
      if (!autoridad.vigente) {
        const reemplazada = await this.repositorio.transicionarConLeaseEnTransaccion(
          parametros,
          'reemplazada',
          {
            conexion,
            codigoError: 'autoridad_superada',
            mensajeError: 'Versiones o fencing posteriores sustituyeron la operación.'
          }
        );
        return { operacion: reemplazada, reemplazada: true, autoridad };
      }
      if (operacion.estado === 'redis_preparada') {
        const consolidacion = await this.consolidadorSql.consolidarEnTransaccion(
          operacion,
          { conexion }
        );
        const estado = operacion.tipo === 'invalidacion'
          ? 'consolidada'
          : 'respuesta_pendiente';
        const avanzada = await this.repositorio.transicionarConLeaseEnTransaccion(
          parametros,
          estado,
          {
            conexion,
            replayCifradoDisponible:
              estado === 'respuesta_pendiente' &&
              parametros.resultado?.replayCifradoDisponible === true,
            keyId: parametros.resultado?.keyId ?? null
          }
        );
        return { operacion: avanzada, consolidacion, reemplazada: false, autoridad };
      }
      if (operacion.estado === 'respuesta_pendiente') {
        const consolidada = await this.repositorio.transicionarConLeaseEnTransaccion(
          parametros,
          'consolidada',
          { conexion }
        );
        return { operacion: consolidada, reemplazada: false, autoridad };
      }
      return null;
    });
    return resultado
      ? { actualizada: true, ...resultado }
      : { actualizada: false };
  }

  async reemplazarConLease(parametros, motivo = 'autoridad_superada') {
    const operacion = await this.#transaccion((conexion) =>
      this.repositorio.transicionarConLeaseEnTransaccion(
        parametros,
        'reemplazada',
        {
          conexion,
          codigoError: motivo,
          mensajeError: 'Una operación posterior posee la autoridad del agente.'
        }
      )
    );
    return { actualizada: Boolean(operacion), operacion };
  }

  async verificarAutoridad(lease) {
    const previa = await this.repositorio.buscarPorId(lease.operacionId);
    if (!previa) return null;
    return this.#transaccion(async (conexion) => {
      const autoridad = await this.repositorio.verificarAutoridadOperacionEnTransaccion(
        previa,
        { conexion }
      );
      const operacion = await this.repositorio.bloquearLeaseVigente(lease, { conexion });
      if (!operacion) return null;
      return { operacion, autoridad };
    });
  }

  async registrarFalloConLease(parametros) {
    const resultado = await this.#transaccion(async (conexion) => {
      const actual = await this.repositorio.bloquearLeaseVigente(parametros, { conexion });
      if (!actual) return null;
      if (parametros.permanente && actual.estado === 'pendiente') {
        return this.repositorio.transicionarConLeaseEnTransaccion(
          parametros,
          'fallida',
          {
            conexion,
            codigoError: parametros.diagnostico.codigo,
            mensajeError: parametros.diagnostico.mensaje
          }
        );
      }
      return this.repositorio.reintentarConLeaseEnTransaccion(parametros, {
        conexion,
        demoraSegundos: parametros.demoraReintentoSegundos,
        codigoError: parametros.diagnostico.codigo,
        mensajeError: parametros.diagnostico.mensaje
      });
    });
    return { actualizada: Boolean(resultado), operacion: resultado };
  }

  async #transaccion(trabajo) {
    const conexion = await this.repositorio.clienteSql.obtenerConexion();
    try {
      await conexion.beginTransaction();
      const resultado = await trabajo(conexion);
      await conexion.commit();
      return resultado;
    } catch (error) {
      try { await conexion.rollback(); } catch {}
      throw error;
    } finally {
      conexion.release();
    }
  }
}

export class ServicioEjecucionVerificacionAuditoria {
  constructor({
    repositorioCoordinacion,
    verificadorCadena,
    servicioDiagnosticos,
    ahoraMs = () => Date.now()
  } = {}) {
    if (!repositorioCoordinacion?.comprobarCabecerasRapido ||
        !repositorioCoordinacion?.reclamarLease ||
        !repositorioCoordinacion?.seleccionarCadenasRotacion ||
        !repositorioCoordinacion?.liberarLease) {
      throw new Error('ServicioEjecucionVerificacionAuditoria requiere repositorio de coordinación completo.');
    }
    if (!verificadorCadena?.verificarCadena || !servicioDiagnosticos?.registrarResultadoVerificacion) {
      throw new Error('ServicioEjecucionVerificacionAuditoria requiere verificador y servicio de diagnósticos.');
    }
    this.repositorioCoordinacion = repositorioCoordinacion;
    this.verificadorCadena = verificadorCadena;
    this.servicioDiagnosticos = servicioDiagnosticos;
    this.ahoraMs = ahoraMs;
  }

  async comprobarBootstrap({ limite = 50 } = {}) {
    const cabeceras = await this.repositorioCoordinacion.comprobarCabecerasRapido({ limite });
    const pendientes = cabeceras.filter((cabecera) =>
      cabecera.diagnosticoEstado === null ||
      cabecera.pendienteRevision ||
      (
        cabecera.diagnosticoHastaSecuencia !== null &&
        BigInt(cabecera.ultimaSecuencia) > BigInt(cabecera.diagnosticoHastaSecuencia)
      )
    );
    return Object.freeze({
      modo: 'bootstrap',
      bloqueante: false,
      totalCabecerasObservadas: cabeceras.length,
      pendientes: pendientes.length,
      estado: pendientes.length === 0 ? 'vigente' : 'pendiente',
      muestras: Object.freeze(pendientes.slice(0, 10))
    });
  }

  async ejecutarDiaria({
    instanciaId,
    ttlSegundos = 300,
    limiteCadenas = 25,
    presupuestoMs = 30_000
  } = {}) {
    const inicio = this.ahoraMs();
    const lease = await this.repositorioCoordinacion.reclamarLease({
      instanciaId,
      ttlSegundos
    });
    if (!lease) {
      return Object.freeze({
        modo: 'diaria',
        estado: 'omitida_por_lease',
        cadenasProcesadas: 0,
        resultados: Object.freeze([])
      });
    }
    const resultados = [];
    let cursorClaveCadena = null;
    try {
      const candidatas = await this.repositorioCoordinacion.seleccionarCadenasRotacion({
        limite: limiteCadenas
      });
      for (const candidata of candidatas) {
        if (this.ahoraMs() - inicio >= presupuestoMs) break;
        const resultado = await this.verificadorCadena.verificarCadena({
          claveCadena: candidata.claveCadena
        });
        const registrado = await this.servicioDiagnosticos.registrarResultadoVerificacion(resultado);
        resultados.push(Object.freeze({
          claveCadena: candidata.claveCadena,
          estado: resultado.estado,
          pendienteRevision: registrado.pendienteRevision,
          intervalo: resultado.intervalo
        }));
        cursorClaveCadena = candidata.claveCadena;
        if (this.repositorioCoordinacion.renovarLease) {
          const renovado = await this.repositorioCoordinacion.renovarLease(lease, { ttlSegundos });
          if (!renovado) throw new Error('La verificación perdió el lease durante la ronda.');
        }
      }
      await this.repositorioCoordinacion.liberarLease(lease, { cursorClaveCadena });
      return Object.freeze({
        modo: 'diaria',
        estado: 'ejecutada',
        cadenasProcesadas: resultados.length,
        cursorClaveCadena,
        resultados: Object.freeze(resultados)
      });
    } catch (error) {
      await this.repositorioCoordinacion.liberarLease(lease, { cursorClaveCadena });
      throw error;
    }
  }

  async verificarCadena({ claveCadena } = {}) {
    const resultado = await this.verificadorCadena.verificarCadena({ claveCadena });
    const registrado = await this.servicioDiagnosticos.registrarResultadoVerificacion(resultado);
    return Object.freeze({
      modo: 'cadena',
      estado: resultado.estado,
      claveCadena,
      pendienteRevision: registrado.pendienteRevision,
      intervalo: resultado.intervalo,
      incidencias: resultado.incidencias
    });
  }

  formatearSalida(resultado, { json = false } = {}) {
    if (json) return `${JSON.stringify(resultado, null, 2)}\n`;
    if (resultado.modo === 'bootstrap') {
      return `bootstrap auditoría: ${resultado.estado}; cabeceras=${resultado.totalCabecerasObservadas}; pendientes=${resultado.pendientes}\n`;
    }
    if (resultado.modo === 'diaria') {
      return `verificación auditoría diaria: ${resultado.estado}; cadenas=${resultado.cadenasProcesadas}; cursor=${resultado.cursorClaveCadena ?? '-'}\n`;
    }
    return `cadena ${resultado.claveCadena}: ${resultado.estado}; intervalo=${resultado.intervalo?.desdeSecuencia ?? '-'}..${resultado.intervalo?.hastaSecuencia ?? '-'}\n`;
  }
}

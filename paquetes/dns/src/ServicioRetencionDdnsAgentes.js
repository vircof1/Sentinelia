export class ServicioRetencionDdnsAgentes {
  constructor({ servicioConfiguracionPortal, repositorio, fronteraTransaccional,
    ahora = () => new Date().toISOString() } = {}) {
    exigirMetodo(servicioConfiguracionPortal, 'asegurarActualizada');
    exigirMetodo(repositorio, 'listarCandidatos');
    exigirMetodo(repositorio, 'purgarCandidatoEnTransaccion');
    exigirMetodo(fronteraTransaccional, 'ejecutar');
    this.configuracion = servicioConfiguracionPortal;
    this.repositorio = repositorio;
    this.frontera = fronteraTransaccional;
    this.ahora = ahora;
    this.ultimaClaveDiaria = null;
  }

  ejecutarBootstrap(opciones = {}) {
    return this.#seguro({ ...opciones, origen: 'bootstrap' });
  }

  async ejecutarTareaDiaria({ fechaReferenciaUtc = this.ahora(), ...opciones } = {}) {
    const clave = fechaReferenciaUtc.slice(0, 10);
    if (this.ultimaClaveDiaria === clave) {
      return resumen({ omitida: true, motivo: 'retencion_ddns_ya_ejecutada',
        fechaReferenciaUtc });
    }
    const resultado = await this.#seguro({
      ...opciones,
      origen: 'tarea_diaria',
      fechaReferenciaUtc
    });
    if (resultado.errores === 0) this.ultimaClaveDiaria = clave;
    return resultado;
  }

  async ejecutar({ fechaReferenciaUtc = this.ahora(), limite = 100,
    origen = 'manual' } = {}) {
    const configuracion = await this.configuracion.asegurarActualizada();
    const dias = Number(configuracion.obtenerConfiguracionAuditoria()?.retencionDias);
    if (!Number.isInteger(dias) || dias < 1 || dias > 36500) {
      return resumen({ omitida: true, motivo: 'retencion_auditoria_desactivada',
        origen, fechaReferenciaUtc });
    }
    const corteUtc = new Date(Date.parse(fechaReferenciaUtc) - dias * 86_400_000)
      .toISOString();
    const candidatos = await this.repositorio.listarCandidatos({ corteUtc, limite });
    const acumulado = { solicitudes: 0, intentos: 0, intenciones: 0 };
    let purgadas = 0;
    let errores = 0;
    for (const candidato of candidatos) {
      try {
        const resultado = await this.frontera.ejecutar((conexion) =>
          this.repositorio.purgarCandidatoEnTransaccion(
            { idInterno: candidato.idInterno, corteUtc }, { conexion }
          ));
        if (resultado.purgada) purgadas += 1;
        for (const campo of Object.keys(acumulado)) acumulado[campo] += resultado[campo];
      } catch {
        errores += 1;
      }
    }
    return resumen({
      origen,
      fechaReferenciaUtc,
      diasRetencion: dias,
      candidatos: candidatos.length,
      purgadas,
      errores,
      backlogPosible: candidatos.length === limite,
      ...acumulado
    });
  }

  async #seguro(opciones) {
    try {
      return await this.ejecutar(opciones);
    } catch {
      return resumen({ origen: opciones.origen,
        fechaReferenciaUtc: opciones.fechaReferenciaUtc ?? this.ahora(), errores: 1,
        motivo: 'retencion_ddns_error' });
    }
  }
}

function resumen(valores = {}) {
  return Object.freeze({
    omitida: false,
    motivo: null,
    origen: 'manual',
    fechaReferenciaUtc: null,
    diasRetencion: null,
    candidatos: 0,
    purgadas: 0,
    solicitudes: 0,
    intentos: 0,
    intenciones: 0,
    errores: 0,
    backlogPosible: false,
    ...valores
  });
}

function exigirMetodo(objeto, metodo) {
  if (typeof objeto?.[metodo] !== 'function') {
    throw new TypeError(`La retención DDNS requiere ${metodo}().`);
  }
}

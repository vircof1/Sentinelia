export class CoordinadorEmisionesRecuperacionPasswordRuntime {
  constructor({
    servicioConfiguracionPortal,
    servicioCorreoPortal,
    repositorioCoordinacionCorreo,
    servicioActivacion,
    fronteraTransaccional
  } = {}) {
    exigirMetodo(servicioConfiguracionPortal, 'asegurarActualizada',
      'servicioConfiguracionPortal');
    exigirMetodo(servicioCorreoPortal, 'obtenerConfiguracionCorreoActual',
      'servicioCorreoPortal');
    exigirMetodo(repositorioCoordinacionCorreo,
      'seleccionarSiguientePreparacionEnTransaccion',
      'repositorioCoordinacionCorreo');
    exigirMetodo(repositorioCoordinacionCorreo,
      'eliminarPreparacionHuerfanaEnTransaccion',
      'repositorioCoordinacionCorreo');
    exigirMetodo(servicioActivacion, 'activarYLiberarEnTransaccion',
      'servicioActivacion');
    exigirMetodo(fronteraTransaccional, 'ejecutar', 'fronteraTransaccional');
    this.servicioConfiguracionPortal = servicioConfiguracionPortal;
    this.servicioCorreoPortal = servicioCorreoPortal;
    this.repositorio = repositorioCoordinacionCorreo;
    this.servicioActivacion = servicioActivacion;
    this.frontera = fronteraTransaccional;
  }

  async procesarPendientes({ origen = 'tick', numeroTick = null } = {}) {
    const iniciadoEnUtc = new Date().toISOString();
    await this.servicioConfiguracionPortal.asegurarActualizada();
    const limite = Math.max(1, Math.min(100, Number.parseInt(String(
      this.servicioCorreoPortal.obtenerConfiguracionCorreoActual()
        .runtimeLoteMaximo || 1
    ), 10) || 1));
    const resultados = [];

    for (let indice = 0; indice < limite; indice += 1) {
      const resultado = await this.frontera.ejecutar(async (conexion) => {
        const preparacion = await this.repositorio
          .seleccionarSiguientePreparacionEnTransaccion({ conexion });
        if (!preparacion) return null;
        const entrada = reconstruirEntrada(preparacion);
        try {
          const completada = await this.servicioActivacion
            .activarYLiberarEnTransaccion(entrada, { conexion });
          return Object.freeze({
            salidaId: preparacion.salidaId,
            solicitudId: preparacion.solicitudId,
            estado: 'liberada',
            emitidaEnUtc: completada.emitidaEnUtc,
            expiraEnUtc: completada.expiraEnUtc
          });
        } catch (error) {
          if (!esPreparacionRedisExtinguida(error)) throw error;
          await this.repositorio.eliminarPreparacionHuerfanaEnTransaccion({
            salidaId: preparacion.salidaId,
            solicitudId: preparacion.solicitudId
          }, { conexion });
          return Object.freeze({
            salidaId: preparacion.salidaId,
            solicitudId: preparacion.solicitudId,
            estado: 'descartada_sin_autoridad_redis'
          });
        }
      });
      if (!resultado) break;
      resultados.push(resultado);
    }

    return Object.freeze({
      origen,
      numeroTick,
      iniciadoEnUtc,
      finalizadoEnUtc: new Date().toISOString(),
      loteMaximo: limite,
      totalProcesadas: resultados.length,
      totalLiberadas: resultados.filter(({ estado }) => estado === 'liberada').length,
      totalDescartadas: resultados.filter(({ estado }) =>
        estado === 'descartada_sin_autoridad_redis').length,
      resultados: Object.freeze(resultados)
    });
  }
}

function reconstruirEntrada(preparacion) {
  const material = preparacion.materialPreparacion;
  return Object.freeze({
    preparada: true,
    resultado: 'preparada',
    salidaId: preparacion.salidaId,
    solicitudId: preparacion.solicitudId,
    eventoEmisionId: preparacion.eventoEmisionId,
    eventoConsumoId: material?.eventoConsumoId,
    operacionId: material?.operacionId,
    token: material?.token,
    buzonCanonico: preparacion.buzonCanonico,
    direccionIp: preparacion.direccionIp,
    asunto: preparacion.asunto,
    materialPreparacion: material
  });
}

function esPreparacionRedisExtinguida(error) {
  return error?.codigo === 'activacion_redis_no_disponible' &&
    ['ausente', 'incompleta', 'lease_preparacion_expirada']
      .includes(error?.estadoRedis);
}

function exigirMetodo(objeto, metodo, nombre) {
  if (typeof objeto?.[metodo] !== 'function') {
    throw new Error(`${nombre}.${metodo} es obligatorio.`);
  }
}

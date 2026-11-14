import { EjecutorMonitorPing } from './EjecutorMonitorPing.js';
import { EjecutorMonitorTcp } from './EjecutorMonitorTcp.js';
import { EjecutorMonitorBooleano } from './EjecutorMonitorBooleano.js';
import { RegistroEjecutoresMonitor } from './RegistroEjecutoresMonitor.js';
import { TraductorResultadoTecnicoAEstadoLogico } from '../estado/TraductorResultadoTecnicoAEstadoLogico.js';

export class MotorMonitores {
  constructor({
    registroEjecutores = null,
    traductorResultadoTecnicoAEstadoLogico = null
  } = {}) {
    this.registroEjecutores =
      registroEjecutores || crearRegistroEjecutoresMonitorPorDefecto();
    this.traductorResultadoTecnicoAEstadoLogico =
      traductorResultadoTecnicoAEstadoLogico ||
      new TraductorResultadoTecnicoAEstadoLogico();
  }

  async ejecutarMonitores({
    catalogoOperativo,
    almacenEstadoActual = null,
    candidatos = []
  }) {
    const ejecutadoEnUtc = new Date().toISOString();
    const resultados = [];

    for (const candidato of candidatos) {
      const monitor = catalogoOperativo.buscarPorId(candidato.monitorId);

      if (!monitor) {
        resultados.push({
          monitorId: candidato.monitorId,
          nombre: candidato.nombre,
          tipo: candidato.tipo,
          versionCatalogo: candidato.versionCatalogo || '',
          scope: candidato.scope || null,
          ejecutadoEnUtc,
          finalizadoEnUtc: new Date().toISOString(),
          duracionTotalMs: 0,
          programacion: {
            proximoIntentoEvaluadoEn: candidato.proximoIntentoEn,
            retrasoSegundos: candidato.retrasoSegundos,
            motivoProgramacion: candidato.motivoProgramacion
          },
          protocolo: {
            nombre: candidato.tipo || 'desconocido'
          },
          intentosRealizados: 0,
          intentoExitoso: null,
          exito: false,
          estadoDetectado: 'indisponible',
          codigoResultado: 'monitor_no_encontrado',
          mensajeResultado:
            'El monitor seleccionado ya no existe en el catálogo operativo.',
          detalleError: {
            codigo: 'MONITOR_NO_ENCONTRADO',
            mensaje:
              'El monitor seleccionado no estaba disponible al iniciar la ejecución.'
          },
          metricaPrincipal: {},
          intentos: []
        });
        continue;
      }

      resultados.push(await this.ejecutarMonitor(monitor, {
        programacion: candidato,
        almacenEstadoActual
      }));
    }

    const finalizadoEnUtc = new Date().toISOString();

    return {
      ejecutadoEnUtc,
      finalizadoEnUtc,
      totalCandidatos: candidatos.length,
      totalEjecutados: resultados.length,
      totalExitosos: resultados.filter((resultado) => resultado.exito).length,
      totalFallidos: resultados.filter((resultado) => !resultado.exito).length,
      resultados
    };
  }

  async ejecutarMonitor(
    monitor,
    {
      programacion = null,
      almacenEstadoActual = null
    } = {}
  ) {
    const ejecutor = this.registroEjecutores.obtener(monitor.tipo);

    if (!ejecutor) {
      return this.construirResultadoTipoSinEjecutor(monitor, {
        programacion
      });
    }

    const resultado = await ejecutor.ejecutar(monitor, {
      programacion,
      almacenEstadoActual
    });

    return this.construirResultadoEjecutado(monitor, resultado);
  }

  construirResultadoTipoSinEjecutor(monitor, { programacion = null } = {}) {
    return this.traductorResultadoTecnicoAEstadoLogico.traducir({
      monitor,
      resultado: {
        ...this.registroEjecutores.construirResultadoTipoSinEjecutor(monitor, {
          programacion
        }),
        versionCatalogo: monitor.version,
        scope: { ...monitor.scope }
      }
    });
  }

  construirResultadoEjecutado(monitor, resultado) {
    return this.traductorResultadoTecnicoAEstadoLogico.traducir({
      monitor,
      resultado: {
        ...resultado,
        versionCatalogo: monitor.version,
        scope: { ...monitor.scope }
      }
    });
  }
}

function crearRegistroEjecutoresMonitorPorDefecto() {
  return new RegistroEjecutoresMonitor({
    ejecutores: [
      new EjecutorMonitorPing(),
      new EjecutorMonitorTcp(),
      new EjecutorMonitorBooleano()
    ]
  });
}

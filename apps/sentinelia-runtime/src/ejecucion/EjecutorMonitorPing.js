import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

function crearDetalleError(error) {
  if (!error) {
    return null;
  }

  return {
    codigo: error.code == null ? null : String(error.code),
    senal: error.signal == null ? null : String(error.signal),
    mensaje: String(error.message || 'Error desconocido de ejecución ping.')
  };
}

function calcularDuracionMs(inicioIso, finIso) {
  if (!inicioIso || !finIso) {
    return 0;
  }

  const inicioMs = Date.parse(inicioIso);
  const finMs = Date.parse(finIso);

  if (Number.isNaN(inicioMs) || Number.isNaN(finMs)) {
    return 0;
  }

  return Math.max(0, finMs - inicioMs);
}

function parsearSalidaPing(texto) {
  const salida = String(texto || '');
  const rtt = salida.match(/time[=<]([\d.]+)\s*ms/i);
  const ttl = salida.match(/\bttl[=\s](\d+)\b/i);
  const bytes = salida.match(/(\d+)\s+bytes\s+from/i);
  const resumen = salida.match(
    /(\d+)\s+packets transmitted,\s+(\d+)\s+received(?:,\s*\+?(\d+)\s+errors)?/i
  );

  return {
    rttMs: rtt ? Number.parseFloat(rtt[1]) : null,
    ttlRespuesta: ttl ? Number.parseInt(ttl[1], 10) : null,
    bytesRespuesta: bytes ? Number.parseInt(bytes[1], 10) : null,
    paquetesTransmitidos: resumen ? Number.parseInt(resumen[1], 10) : null,
    paquetesRecibidos: resumen ? Number.parseInt(resumen[2], 10) : null
  };
}

export class EjecutorMonitorPing {
  tipoMonitor = 'ping';

  async ejecutar(monitor, { programacion = null } = {}) {
    const reintentos = Number.parseInt(String(monitor.configuracion?.reintentos ?? 0), 10);
    const intentosMaximos = 1 + Math.max(0, Number.isNaN(reintentos) ? 0 : reintentos);
    const intentos = [];
    const ejecutadoEnUtc = new Date().toISOString();
    let intentoExitoso = null;

    for (let numeroIntento = 1; numeroIntento <= intentosMaximos; numeroIntento += 1) {
      const intento = await this.ejecutarIntento(monitor, numeroIntento);
      intentos.push(intento);

      if (intento.exito) {
        intentoExitoso = intento;
        break;
      }
    }

    const finalizadoEnUtc = new Date().toISOString();
    const resultadoFinal = intentoExitoso || intentos.at(-1) || null;

    return {
      monitorId: monitor.id,
      nombre: monitor.nombre,
      tipo: monitor.tipo,
      ejecutadoEnUtc,
      finalizadoEnUtc,
      duracionTotalMs: calcularDuracionMs(ejecutadoEnUtc, finalizadoEnUtc),
      programacion: programacion
        ? {
            proximoIntentoEvaluadoEn: programacion.proximoIntentoEn,
            retrasoSegundos: programacion.retrasoSegundos,
            motivoProgramacion: programacion.motivoProgramacion
          }
        : null,
      protocolo: {
        nombre: 'ping',
        host: monitor.configuracion.host,
        timeoutMs: monitor.configuracion.timeoutMs,
        reintentosConfigurados: Math.max(0, intentosMaximos - 1),
        payloadBytes: monitor.configuracion.tamanoPaqueteBytes,
        ttl: monitor.configuracion.ttl
      },
      intentosRealizados: intentos.length,
      intentoExitoso: intentoExitoso?.numeroIntento || null,
      exito: Boolean(intentoExitoso),
      estadoDetectado: intentoExitoso ? 'disponible' : 'indisponible',
      codigoResultado: resultadoFinal?.codigoResultado || 'sin_resultado',
      mensajeResultado:
        resultadoFinal?.mensajeResultado || 'No se obtuvo resultado técnico.',
      detalleError: intentoExitoso ? null : resultadoFinal?.detalleError || null,
      metricaPrincipal: {
        rttMs: intentoExitoso?.detalle?.rttMs ?? null,
        ttlRespuesta: intentoExitoso?.detalle?.ttlRespuesta ?? null
      },
      intentos
    };
  }

  async ejecutarIntento(monitor, numeroIntento) {
    const inicioUtc = new Date().toISOString();
    const timeoutMs = Number.parseInt(
      String(monitor.configuracion?.timeoutMs ?? 1000),
      10
    );
    const timeoutSegundos = Math.max(1, Math.ceil(timeoutMs / 1000));
    const args = [
      '-n',
      '-c',
      '1',
      '-W',
      String(timeoutSegundos),
      '-s',
      String(monitor.configuracion.tamanoPaqueteBytes),
      '-t',
      String(monitor.configuracion.ttl),
      String(monitor.configuracion.host)
    ];

    try {
      const { stdout, stderr } = await execFileAsync('ping', args, {
        timeout: timeoutMs + 250,
        env: {
          ...process.env,
          LC_ALL: 'C'
        }
      });
      const finUtc = new Date().toISOString();
      const detalle = parsearSalidaPing(`${stdout}\n${stderr}`);

      return {
        numeroIntento,
        inicioUtc,
        finUtc,
        duracionMs: calcularDuracionMs(inicioUtc, finUtc),
        exito: true,
        codigoResultado: 'respuesta_icmp',
        mensajeResultado: 'Respuesta ICMP recibida.',
        detalleError: null,
        detalle
      };
    } catch (error) {
      const finUtc = new Date().toISOString();
      const detalle = parsearSalidaPing(`${error.stdout || ''}\n${error.stderr || ''}`);
      const timeout = Boolean(error.killed) || String(error.signal || '') === 'SIGTERM';

      return {
        numeroIntento,
        inicioUtc,
        finUtc,
        duracionMs: calcularDuracionMs(inicioUtc, finUtc),
        exito: false,
        codigoResultado: timeout ? 'timeout_icmp' : 'fallo_icmp',
        mensajeResultado: timeout
          ? 'Timeout esperando respuesta ICMP.'
          : 'No se recibió respuesta ICMP válida.',
        detalleError: crearDetalleError(error),
        detalle
      };
    }
  }
}

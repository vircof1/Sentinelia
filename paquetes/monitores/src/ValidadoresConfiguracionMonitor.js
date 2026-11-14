import { listarTiposMonitorSoportados } from './CatalogoTiposMonitor.js';
import { analizarExpresionMonitorLogico } from './AnalizadorExpresionMonitorLogico.js';
import {
  crearConfiguracionMonitorLogicoBase
} from './ConfiguracionMonitorLogico.js';
import {
  crearConfiguracionMonitorTelemetria,
  crearConfiguracionTemporalMonitorTelemetria
} from './ConfiguracionMonitorTelemetria.js';
import {
  FUENTE_MONITOR_FEDERADO,
  extraerVariablesDependenciasMonitorLogico,
  normalizarDependenciasMonitorLogico,
  resumirDependenciasMonitorLogico
} from './DependenciasMonitorLogico.js';

const CONFIGURACION_POR_TIPO = {
  ping: {
    timeoutMs: 1200,
    reintentos: 1,
    tamanoPaqueteBytes: 56,
    ttl: 64
  },
  tcp: {
    puerto: 443,
    timeoutMs: 1500,
    reintentos: 1,
    usarTls: false,
    vigenciaMinimaCertDias: 0
  }
};

export class ValidadorConfiguracionMonitorPing {
  constructor(normalizadores) {
    this.normalizadores = normalizadores;
  }

  normalizar(datos) {
    return {
      host: this.normalizadores.normalizarHost(datos.host),
      timeoutMs: this.normalizadores.normalizarEnteroEnRango(
        datos.timeoutMs,
        250,
        60000,
        'El timeout de un monitor ping debe estar entre 250 y 60000 ms.',
        CONFIGURACION_POR_TIPO.ping.timeoutMs
      ),
      reintentos: this.normalizadores.normalizarEnteroEnRango(
        datos.reintentos,
        0,
        10,
        'Los reintentos de un monitor ping deben estar entre 0 y 10.',
        CONFIGURACION_POR_TIPO.ping.reintentos
      ),
      tamanoPaqueteBytes: this.normalizadores.normalizarEnteroEnRango(
        datos.tamanoPaqueteBytes,
        8,
        4096,
        'El tamaño de paquete del monitor ping debe estar entre 8 y 4096 bytes.',
        CONFIGURACION_POR_TIPO.ping.tamanoPaqueteBytes
      ),
      ttl: this.normalizadores.normalizarEnteroEnRango(
        datos.ttl,
        1,
        255,
        'El TTL del monitor ping debe estar entre 1 y 255.',
        CONFIGURACION_POR_TIPO.ping.ttl
      )
    };
  }
}

export class ValidadorConfiguracionMonitorTcp {
  constructor(normalizadores) {
    this.normalizadores = normalizadores;
  }

  normalizar(datos) {
    const usarTls = this.normalizadores.normalizarBooleanoEstricto(
      datos.usarTls,
      CONFIGURACION_POR_TIPO.tcp.usarTls,
      'El flag TLS del monitor TCP no es válido.'
    );

    return {
      host: this.normalizadores.normalizarHost(datos.host),
      puerto: this.normalizadores.normalizarEnteroEnRango(
        datos.puerto,
        1,
        65535,
        'El puerto del monitor TCP debe estar entre 1 y 65535.',
        CONFIGURACION_POR_TIPO.tcp.puerto
      ),
      timeoutMs: this.normalizadores.normalizarEnteroEnRango(
        datos.timeoutMs,
        250,
        60000,
        'El timeout de un monitor TCP debe estar entre 250 y 60000 ms.',
        CONFIGURACION_POR_TIPO.tcp.timeoutMs
      ),
      reintentos: this.normalizadores.normalizarEnteroEnRango(
        datos.reintentos,
        0,
        10,
        'Los reintentos de un monitor TCP deben estar entre 0 y 10.',
        CONFIGURACION_POR_TIPO.tcp.reintentos
      ),
      usarTls,
      vigenciaMinimaCertDias: usarTls
        ? this.normalizadores.normalizarEnteroEnRango(
            datos.vigenciaMinimaCertDias,
            0,
            3650,
            'La vigencia mínima del certificado TLS debe estar entre 0 y 3650 días.',
            CONFIGURACION_POR_TIPO.tcp.vigenciaMinimaCertDias
          )
        : CONFIGURACION_POR_TIPO.tcp.vigenciaMinimaCertDias
    };
  }
}

export class ValidadorConfiguracionMonitorLogico {
  normalizar(datos) {
    const configuracion = crearConfiguracionMonitorLogicoBase(
      datos.configuracionLogica || datos
    );
    const mensajeFallo = String(configuracion.mensajeFallo || '').trim();

    if (!mensajeFallo) {
      throw new Error('El monitor lógico requiere un mensaje humano de fallo.');
    }

    const dependencias = normalizarDependenciasMonitorLogico(
      configuracion.dependencias
    );
    const variables = extraerVariablesDependenciasMonitorLogico(dependencias);
    const dependenciasNoOperativas = dependencias.filter(
      (dependencia) => !['monitor', FUENTE_MONITOR_FEDERADO]
        .includes(dependencia.fuente)
    );

    if (dependenciasNoOperativas.length > 0) {
      throw new Error(
        'El monitor lógico solo puede usar monitores locales o entradas federadas explícitas en esta fase.'
      );
    }

    const grafoLogico = configuracion.layoutVisual?.grafoLogico || null;

    if (grafoLogico?.errores?.length > 0) {
      throw new Error(
        `El grafo visual del monitor lógico no puede compilarse: ${grafoLogico.errores.join(' ')}`
      );
    }

    const analisis = analizarExpresionMonitorLogico(
      configuracion.expresion,
      variables
    );

    if (
      grafoLogico?.expresionCompilada &&
      !grafoLogico.nodos?.some((nodo) => nodo.tipo === 'expresion')
    ) {
      const analisisGrafo = analizarExpresionMonitorLogico(
        grafoLogico.expresionCompilada,
        variables
      );

      if (analisisGrafo.expresionNormalizada !== analisis.expresionNormalizada) {
        throw new Error(
          `El grafo visual compila a "${grafoLogico.expresionCompilada}", pero la expresión textual normalizada es "${analisis.expresionNormalizada}".`
        );
      }
    }

    if (grafoLogico?.variablesUsadas?.length > 0) {
      const variablesGrafo = new Set(grafoLogico.variablesUsadas);
      const variablesFueraDeDependencias = [...variablesGrafo]
        .filter((variable) => !variables.includes(variable));

      if (variablesFueraDeDependencias.length > 0) {
        throw new Error(
          `El grafo visual usa variables sin dependencia declarada: ${variablesFueraDeDependencias.join(', ')}.`
        );
      }
    }

    const variablesUsadas = new Set(analisis.variablesUsadas);
    const variablesNoUsadas = variables.filter(
      (variable) => !variablesUsadas.has(variable)
    );

    if (variablesNoUsadas.length > 0) {
      throw new Error(
        `La expresión lógica no usa las dependencias declaradas: ${variablesNoUsadas.join(', ')}.`
      );
    }

    return {
      ...configuracion,
      variables,
      dependencias,
      expresion: analisis.expresionNormalizada,
      variablesUsadas: analisis.variablesUsadas,
      resumenDependencias: resumirDependenciasMonitorLogico(dependencias)
    };
  }
}

export class ValidadorConfiguracionMonitorTelemetria {
  normalizar(datos) {
    const configuracion = datos.configuracionTelemetria || datos;
    const normalizada = configuracion?.condicion
      ? crearConfiguracionMonitorTelemetria(configuracion)
      : crearConfiguracionTemporalMonitorTelemetria(configuracion);

    return typeof normalizada.serializar === 'function'
      ? normalizada.serializar()
      : { ...normalizada };
  }
}

export class RegistroValidadoresConfiguracionMonitor {
  constructor(normalizadores) {
    this.validadores = new Map([
      ['ping', new ValidadorConfiguracionMonitorPing(normalizadores)],
      ['tcp', new ValidadorConfiguracionMonitorTcp(normalizadores)],
      ['booleano', new ValidadorConfiguracionMonitorLogico()],
      ['telemetria', new ValidadorConfiguracionMonitorTelemetria()]
    ]);
  }

  normalizar(tipo, datos) {
    const validador = this.validadores.get(tipo);

    if (!validador) {
      throw new Error(
        `El tipo de monitor debe ser uno de: ${listarTiposMonitorSoportados().join(', ')}.`
      );
    }

    return validador.normalizar(datos);
  }
}

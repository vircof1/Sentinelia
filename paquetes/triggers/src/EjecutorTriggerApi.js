import http from 'node:http';
import https from 'node:https';
import { ESTRATEGIAS_EJECUCION_TRIGGER } from './CatalogoTiposTrigger.js';

function clonarJsonSeguro(valor) {
  if (!valor || typeof valor !== 'object') {
    return null;
  }

  return JSON.parse(JSON.stringify(valor));
}

function normalizarEnteroNoNegativo(valor, porDefecto = 0) {
  const convertido = Number.parseInt(String(valor ?? ''), 10);

  if (!Number.isInteger(convertido)) {
    return porDefecto;
  }

  return Math.max(0, convertido);
}

function resolverValorRuta(objeto, ruta) {
  if (!ruta) {
    return '';
  }

  return String(ruta)
    .split('.')
    .reduce((actual, segmento) => {
      if (actual == null) {
        return undefined;
      }

      return actual[segmento];
    }, objeto);
}

function renderizarPlantilla(texto, contexto) {
  const fuente = String(texto ?? '');

  return fuente.replace(/\{\{\s*([^}]+?)\s*\}\}/g, (_coincidencia, ruta) => {
    const valor = resolverValorRuta(contexto, String(ruta || '').trim());

    if (valor == null) {
      return '';
    }

    if (typeof valor === 'object') {
      return JSON.stringify(valor);
    }

    return String(valor);
  });
}

function truncarTexto(texto, maximo = 8000) {
  const valor = String(texto ?? '');

  if (valor.length <= maximo) {
    return valor;
  }

  return `${valor.slice(0, maximo)}…`;
}

function inferirContentType(cuerpo) {
  const texto = String(cuerpo ?? '').trim();

  if (!texto) {
    return 'text/plain; charset=utf-8';
  }

  if (
    (texto.startsWith('{') && texto.endsWith('}')) ||
    (texto.startsWith('[') && texto.endsWith(']'))
  ) {
    return 'application/json; charset=utf-8';
  }

  return 'text/plain; charset=utf-8';
}

function normalizarCabeceras(cabeceras = {}, contexto = {}) {
  const normalizadas = {};

  for (const [clave, valor] of Object.entries(cabeceras || {})) {
    const claveNormalizada = String(clave || '').trim();

    if (!claveNormalizada) {
      continue;
    }

    normalizadas[claveNormalizada] = renderizarPlantilla(valor, contexto);
  }

  return normalizadas;
}

function construirPayloadError(error, intento = null) {
  if (!error) {
    return null;
  }

  return {
    intento,
    nombre: error.name || 'Error',
    codigo: error.code == null ? null : String(error.code),
    mensaje: String(error.message || 'Error desconocido al ejecutar trigger API.'),
    stack: error.stack ? truncarTexto(String(error.stack), 4000) : null
  };
}

export class EjecutorTriggerApi {
  constructor() {
    this.tipoTrigger = 'api';
    this.estrategiaEjecucion =
      ESTRATEGIAS_EJECUCION_TRIGGER.EFECTO_EXTERNO_DIFERIDO;
  }

  async ejecutar(contexto = {}) {
    const configuracion = this.normalizarConfiguracion(
      contexto.configuracionEfectiva || {}
    );
    const plantilla = this.construirContextoPlantilla(contexto, configuracion);
    configuracion.url = renderizarPlantilla(configuracion.url, plantilla);
    const cuerpo = this.construirCuerpoSolicitud(configuracion, plantilla);
    const cabeceras = this.construirCabecerasSolicitud({
      configuracion,
      plantilla,
      cuerpo
    });
    const intentos = [];
    const totalIntentos = 1 + normalizarEnteroNoNegativo(configuracion.reintentos, 0);
    let ultimoError = null;

    for (let numeroIntento = 1; numeroIntento <= totalIntentos; numeroIntento += 1) {
      try {
        const respuesta = await this.ejecutarIntento({
          numeroIntento,
          configuracion,
          cabeceras,
          cuerpo
        });

        intentos.push(respuesta.intento);

        if (respuesta.ok) {
          return {
            estadoEjecucion: 'ok',
            codigoResultado: 'api_ok',
            mensajeResultado: `Trigger API completado con HTTP ${respuesta.statusCode}.`,
            payloadRespuesta: {
              url: configuracion.url,
              metodo: configuracion.metodo,
              timeoutMs: configuracion.timeoutMs,
              intentosRealizados: intentos.length,
              intentoExitoso: numeroIntento,
              respuestaFinal: respuesta.respuesta,
              intentos
            },
            payloadError: null
          };
        }

        ultimoError = new Error(
          `El endpoint respondió HTTP ${respuesta.statusCode}.`
        );
        ultimoError.code = `HTTP_${respuesta.statusCode}`;
        ultimoError.payloadRespuesta = respuesta.respuesta;
        ultimoError.intento = respuesta.intento;
      } catch (error) {
        ultimoError = error;

        if (error?.intento) {
          intentos.push(error.intento);
        } else {
          intentos.push({
            numeroIntento,
            exito: false,
            codigoResultado: error?.code || 'API_ERROR',
            mensajeResultado: String(
              error?.message || 'Error desconocido al ejecutar trigger API.'
            ),
            detalleError: construirPayloadError(error, numeroIntento)
          });
        }
      }
    }

    return {
      estadoEjecucion: 'error',
      codigoResultado: this.resolverCodigoError(ultimoError),
      mensajeResultado: String(
        ultimoError?.message || 'No se pudo completar el trigger API.'
      ),
      payloadRespuesta: {
        url: configuracion.url,
        metodo: configuracion.metodo,
        timeoutMs: configuracion.timeoutMs,
        intentosRealizados: intentos.length,
        intentoExitoso: null,
        respuestaFinal: ultimoError?.payloadRespuesta || null,
        intentos
      },
      payloadError: ultimoError?.payloadRespuesta
        ? {
            codigo: ultimoError.code || null,
            mensaje: ultimoError.message || null,
            respuesta: ultimoError.payloadRespuesta
          }
        : construirPayloadError(ultimoError, intentos.length || null)
    };
  }

  async ejecutarIntento({
    numeroIntento,
    configuracion,
    cabeceras,
    cuerpo
  }) {
    const inicioUtc = new Date().toISOString();
    const respuesta = await this.enviarSolicitud({
      url: configuracion.url,
      metodo: configuracion.metodo,
      timeoutMs: configuracion.timeoutMs,
      permiteTlsInseguro: configuracion.permiteTlsInseguro,
      cabeceras,
      cuerpo
    });
    const finUtc = new Date().toISOString();
    const intento = {
      numeroIntento,
      inicioUtc,
      finUtc,
      duracionMs: this.calcularDuracionMs(inicioUtc, finUtc),
      exito: respuesta.ok,
      codigoResultado: respuesta.ok
        ? 'api_ok'
        : `http_${respuesta.statusCode}`,
      mensajeResultado: respuesta.ok
        ? `Respuesta HTTP ${respuesta.statusCode}.`
        : `Respuesta HTTP ${respuesta.statusCode}.`,
      respuesta: respuesta.respuesta
    };

    return {
      ok: respuesta.ok,
      statusCode: respuesta.statusCode,
      respuesta: respuesta.respuesta,
      intento
    };
  }

  enviarSolicitud({
    url,
    metodo,
    timeoutMs,
    permiteTlsInseguro,
    cabeceras,
    cuerpo
  }) {
    const destino = new URL(url);
    const cliente = destino.protocol === 'https:' ? https : http;
    const opciones = {
      protocol: destino.protocol,
      hostname: destino.hostname,
      port:
        destino.port ||
        (destino.protocol === 'https:' ? 443 : 80),
      path: `${destino.pathname || '/'}${destino.search || ''}`,
      method: metodo,
      headers: cabeceras
    };

    if (destino.protocol === 'https:') {
      opciones.rejectUnauthorized = !permiteTlsInseguro;
      opciones.servername = destino.hostname;
    }

    return new Promise((resolve, reject) => {
      const chunks = [];
      const solicitud = cliente.request(opciones, (respuesta) => {
        respuesta.on('data', (chunk) => {
          chunks.push(Buffer.from(chunk));
        });

        respuesta.on('end', () => {
          const cuerpoTexto = Buffer.concat(chunks).toString('utf8');
          const headers = {};

          for (const [clave, valor] of Object.entries(respuesta.headers || {})) {
            headers[clave] = Array.isArray(valor) ? valor.join(', ') : (valor ?? null);
          }

          const payloadRespuesta = {
            statusCode: Number(respuesta.statusCode || 0),
            statusMessage: respuesta.statusMessage || '',
            headers,
            bodyTexto: truncarTexto(cuerpoTexto, 16000),
            bodyJson: this.parsearJsonSeguro(cuerpoTexto)
          };

          resolve({
            ok:
              payloadRespuesta.statusCode >= 200 &&
              payloadRespuesta.statusCode < 300,
            statusCode: payloadRespuesta.statusCode,
            respuesta: payloadRespuesta
          });
        });
      });

      solicitud.setTimeout(timeoutMs, () => {
        solicitud.destroy(
          Object.assign(new Error('Timeout esperando respuesta del endpoint API.'), {
            code: 'API_TIMEOUT'
          })
        );
      });

      solicitud.on('error', (error) => {
        reject(error);
      });

      if (cuerpo != null) {
        solicitud.write(cuerpo);
      }

      solicitud.end();
    });
  }

  construirContextoPlantilla(contexto, configuracion) {
    return {
      eventoDisparo: contexto.eventoDisparo || null,
      configuracionEfectiva: clonarJsonSeguro(configuracion),
      trigger: clonarJsonSeguro(contexto.planDisparo?.trigger || null),
      asignacion: clonarJsonSeguro(contexto.planDisparo?.asignacion || null),
      transicion: clonarJsonSeguro(contexto.transicion || contexto.planDisparo?.transicion || null),
      monitor: {
        id: contexto.planDisparo?.monitorId || null,
        nombre:
          contexto.transicion?.nombreMonitor ||
          contexto.planDisparo?.transicion?.nombreMonitor ||
          null
      }
    };
  }

  construirCabecerasSolicitud({ configuracion, plantilla, cuerpo }) {
    const cabeceras = normalizarCabeceras(configuracion.cabeceras, plantilla);

    if (
      cuerpo != null &&
      cuerpo !== '' &&
      !Object.keys(cabeceras).some((clave) => clave.toLowerCase() === 'content-type')
    ) {
      cabeceras['content-type'] = inferirContentType(cuerpo);
    }

    if (cuerpo != null && cuerpo !== '') {
      cabeceras['content-length'] = String(Buffer.byteLength(cuerpo, 'utf8'));
    }

    return cabeceras;
  }

  construirCuerpoSolicitud(configuracion, plantilla) {
    if (!configuracion.plantillaCuerpo) {
      return null;
    }

    if (['GET', 'HEAD'].includes(configuracion.metodo)) {
      return null;
    }

    return renderizarPlantilla(configuracion.plantillaCuerpo, plantilla);
  }

  normalizarConfiguracion(configuracion) {
    return {
      url: String(configuracion.url || '').trim(),
      metodo: String(configuracion.metodo || 'POST').trim().toUpperCase(),
      timeoutMs: Math.max(
        250,
        normalizarEnteroNoNegativo(configuracion.timeoutMs, 5000)
      ),
      reintentos: Math.max(
        0,
        normalizarEnteroNoNegativo(configuracion.reintentos, 0)
      ),
      permiteTlsInseguro: Boolean(configuracion.permiteTlsInseguro),
      cabeceras:
        configuracion.cabeceras &&
        typeof configuracion.cabeceras === 'object' &&
        !Array.isArray(configuracion.cabeceras)
          ? { ...configuracion.cabeceras }
          : {},
      plantillaCuerpo:
        configuracion.plantillaCuerpo == null ||
        String(configuracion.plantillaCuerpo).trim() === ''
          ? null
          : String(configuracion.plantillaCuerpo)
    };
  }

  resolverCodigoError(error) {
    const codigo = String(error?.code || '').trim();

    if (!codigo) {
      return 'api_error';
    }

    if (codigo === 'API_TIMEOUT') {
      return 'api_timeout';
    }

    if (/^HTTP_\d+$/.test(codigo)) {
      return codigo.toLowerCase();
    }

    return 'api_error';
  }

  parsearJsonSeguro(texto) {
    const fuente = String(texto || '').trim();

    if (!fuente) {
      return null;
    }

    try {
      return JSON.parse(fuente);
    } catch (_error) {
      return null;
    }
  }

  calcularDuracionMs(inicioIso, finIso) {
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
}

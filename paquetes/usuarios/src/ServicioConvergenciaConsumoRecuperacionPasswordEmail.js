import { generarIdAvisoPlataforma }
  from '../../avisos-plataforma/src/IdentidadAvisoPlataforma.js';

export class ServicioConvergenciaConsumoRecuperacionPasswordEmail {
  constructor({
    servicioSustitucion,
    repositorioSolicitudes,
    servicioSesion,
    servicioAvisosPlataforma,
    actorRuntimeId
  } = {}) {
    exigirMetodo(servicioSustitucion, 'sustituir', 'servicioSustitucion');
    exigirMetodo(servicioSustitucion, 'resolverResultadoIndeterminado',
      'servicioSustitucion');
    exigirMetodo(repositorioSolicitudes, 'consumir', 'repositorioSolicitudes');
    exigirMetodo(servicioSesion, 'invalidarSesionesUsuario', 'servicioSesion');
    exigirMetodo(servicioAvisosPlataforma, 'detectar',
      'servicioAvisosPlataforma');
    exigirMetodo(servicioAvisosPlataforma, 'resolver',
      'servicioAvisosPlataforma');
    this.sustitucion = servicioSustitucion;
    this.solicitudes = repositorioSolicitudes;
    this.sesiones = servicioSesion;
    this.avisos = servicioAvisosPlataforma;
    this.actorRuntimeId = textoAscii(actorRuntimeId, 'actorRuntimeId');
  }

  async sustituirYConverger(entrada = {}) {
    let resultado;
    try {
      resultado = await this.sustitucion.sustituir(entrada);
    } catch (error) {
      resultado = await this.sustitucion.resolverResultadoIndeterminado(error);
      if (!resultado.sustituida) throw error;
    }
    if (!resultado.sustituida) return resultado;

    const fallos = [];
    try {
      const consumo = await this.solicitudes.consumir({
        token: entrada.token,
        reservaId: resultado.reservaId,
        propietario: resultado.propietario
      });
      if (!['consumida', 'ya_consumida'].includes(consumo.estado)) {
        throw new Error(`Redis no consolidó el consumo: ${consumo.estado}.`);
      }
    } catch (error) {
      fallos.push(Object.freeze({ componente: 'autoridad_recuperacion',
        codigo: codigoError(error) }));
    }

    try {
      await this.sesiones.invalidarSesionesUsuario(
        resultado.usuarioId,
        resultado.versionSesion
      );
    } catch (error) {
      fallos.push(Object.freeze({ componente: 'sesiones',
        codigo: codigoError(error) }));
    }

    if (fallos.length > 0) {
      await this.#detectar(resultado, fallos).catch(() => {});
      return Object.freeze({
        ...resultado,
        estado: 'sustituida',
        convergencia: 'pendiente',
        fallos: Object.freeze(fallos)
      });
    }

    await this.#resolver(resultado).catch(() => {});
    return Object.freeze({
      ...resultado,
      estado: 'sustituida',
      convergencia: 'completa',
      fallos: Object.freeze([])
    });
  }

  #base(resultado) {
    return {
      actor: { tipo: 'runtime', id: this.actorRuntimeId },
      causalidad: {
        tipo: 'solicitud_recuperacion_password',
        id: resultado.eventoConsumoId
      },
      claveCausal: {
        versionCatalogo: 1,
        tipoCodigo: 'consistencia',
        causaCodigo: 'recuperacion_password_convergencia_redis',
        objetoTipo: 'usuario',
        objetoId: String(resultado.usuarioId),
        relacionId: null,
        flujoId: null,
        scope: resultado.scope
      },
      correlacionId: resultado.eventoConsumoId
    };
  }

  #detectar(resultado, fallos) {
    return this.avisos.detectar({
      ...this.#base(resultado),
      eventoId: generarIdAvisoPlataforma(),
      efectivoEnUtc: new Date().toISOString(),
      contextoHumano: {
        usuarioId: String(resultado.usuarioId),
        componentesPendientes: fallos.map(({ componente }) => componente)
      },
      resumen: {
        titulo: 'Convergencia Redis pendiente tras recuperar una contraseña',
        detalle:
          'La credencial cambió en SQL, pero alguna proyección efímera no convergió.'
      }
    });
  }

  #resolver(resultado) {
    return this.avisos.resolver({
      ...this.#base(resultado),
      eventoId: generarIdAvisoPlataforma(),
      efectivoEnUtc: new Date().toISOString(),
      viaResolucion: 'causa_desaparecida'
    });
  }
}

function codigoError(error) {
  return String(error?.codigo || error?.code || error?.name || 'error_tecnico')
    .slice(0, 100);
}

function textoAscii(valor, campo) {
  const texto = String(valor ?? '');
  if (!/^[\x21-\x7e]{1,191}$/u.test(texto)) {
    throw new Error(`${campo} no es una identidad técnica válida.`);
  }
  return texto;
}

function exigirMetodo(objeto, metodo, nombre) {
  if (typeof objeto?.[metodo] !== 'function') {
    throw new Error(`${nombre}.${metodo} es obligatorio.`);
  }
}

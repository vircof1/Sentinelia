import { generarUuidV7Auditoria } from '../../../../paquetes/auditoria/src/UuidV7Auditoria.js';
import { validarIdAvisoPlataforma } from '../../../../paquetes/avisos-plataforma/src/IdentidadAvisoPlataforma.js';

const CLAVES_SENSIBLES = /(?:secret|secreto|token|password|contrasena|credencial|authorization|cookie|payload|body)/iu;

export class ServicioPresentacionAvisosPlataforma {
  constructor({ repositorio, servicioAutorizacion, difusorWebSocketPortal = null }) {
    this.repositorio = repositorio;
    this.servicioAutorizacion = servicioAutorizacion;
    this.difusorWebSocketPortal = difusorWebSocketPortal;
  }

  async obtenerResumen(contexto) {
    this.exigirLectura(contexto);
    const parametros = { usuarioId: contexto.idUsuario, scope: contexto };
    const [agregado, filas] = await Promise.all([
      this.repositorio.resumirActivosVisibles(parametros),
      this.repositorio.listarActivosVisibles({ ...parametros, limite: 50 })
    ]);
    const avisos = filas.map((aviso) => ({
      ...aviso,
      contextoHumano: sanearJson(aviso.contextoHumano),
      resumen: sanearJson(aviso.resumen)
    }));
    return Object.freeze({
      ...agregado,
      puedeGestionarOverlays: !contexto?.impersonacionActiva,
      avisos
    });
  }

  async reconocer(contexto, avisoId) {
    return this.cambiarEstado(contexto, avisoId, 'reconocido');
  }

  async ocultar(contexto, avisoId) {
    return this.cambiarEstado(contexto, avisoId, 'oculto');
  }

  async cambiarEstado(contexto, avisoId, estado) {
    this.exigirLectura(contexto);
    if (contexto?.impersonacionActiva) {
      throw crearErrorPresentacion(
        'La sesión impersonada solo puede consultar avisos de plataforma.',
        403,
        'MUTACION_IMPERSONADA_NO_PERMITIDA'
      );
    }
    try { validarIdAvisoPlataforma(avisoId, 'avisoId'); } catch {
      throw crearErrorPresentacion('La identidad del aviso no es válida.', 400, 'AVISO_INVALIDO');
    }
    let resultado;
    try {
      resultado = await this.repositorio.cambiarEstadoPersonal({
        avisoId,
        estado,
        eventoId: generarUuidV7Auditoria(),
        contextoUsuarioActual: contexto
      });
    } catch (error) {
      if (error?.codigo === 'AVISO_NO_VISIBLE') {
        throw crearErrorPresentacion(
          'El aviso no existe, ya no está activo o queda fuera de tu alcance.',
          404,
          'AVISO_NO_VISIBLE'
        );
      }
      throw error;
    }
    this.difusorWebSocketPortal?.emitirAvisosPlataformaActualizados?.();
    return resultado;
  }

  exigirLectura(contexto) {
    if (!this.servicioAutorizacion.puedeVerAvisosPlataforma(contexto)) {
      throw crearErrorPresentacion(
        'No tienes permiso para ver avisos de plataforma.', 403, 'PERMISO_DENEGADO'
      );
    }
  }
}

function crearErrorPresentacion(mensaje, statusCode, codigo) {
  const error = new Error(mensaje);
  error.statusCode = statusCode;
  error.codigo = codigo;
  return error;
}

function sanearJson(valor, profundidad = 0) {
  if (valor == null || typeof valor === 'boolean' || typeof valor === 'number') return valor;
  if (typeof valor === 'string') return valor.slice(0, 1000);
  if (profundidad >= 4) return '[contenido acotado]';
  if (Array.isArray(valor)) return valor.slice(0, 30).map((item) => sanearJson(item, profundidad + 1));
  if (typeof valor !== 'object') return null;
  return Object.fromEntries(Object.entries(valor).filter(([clave]) =>
    !CLAVES_SENSIBLES.test(clave)
  ).slice(0, 50).map(([clave, item]) => [clave, sanearJson(item, profundidad + 1)]));
}

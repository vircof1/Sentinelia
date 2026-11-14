import { createHmac, timingSafeEqual } from 'node:crypto';
import {
  claveSujetoNotificacion,
  scopeActualCubre
} from '../../coordinacion-durable/src/CatalogoResolutoresSujetosNotificaciones.js';

const TEXTOS = Object.freeze({
  eliminacion_agente_encolada_titulo: 'Eliminación de agente encolada',
  eliminacion_agente_encolada_resumen: 'La eliminación administrativa está pendiente de ejecución.',
  agente_eliminado_titulo: 'Agente eliminado',
  agente_eliminado_resumen: 'La eliminación administrativa ha terminado correctamente.',
  agente_eliminado_limpieza_pendiente_titulo: 'Agente eliminado con limpieza pendiente',
  agente_eliminado_limpieza_pendiente_resumen: 'El agente ya no existe; quedan tareas técnicas de limpieza.',
  limpieza_tecnica_completada_titulo: 'Limpieza técnica completada',
  limpieza_tecnica_completada_resumen: 'Las tareas técnicas posteriores a la eliminación han terminado.',
  eliminacion_agente_fallida_titulo: 'No se pudo eliminar el agente',
  eliminacion_agente_fallida_resumen: 'La operación terminó sin eliminar el agente.',
  eliminacion_organizacion_encolada_titulo: 'Eliminación organizativa encolada',
  eliminacion_organizacion_encolada_resumen:
    'La eliminación administrativa está pendiente de ejecución.',
  organizacion_eliminada_titulo: 'Organización eliminada',
  organizacion_eliminada_resumen:
    'La eliminación administrativa ha terminado correctamente.',
  eliminacion_organizacion_fallida_titulo: 'No se pudo eliminar la organización',
  eliminacion_organizacion_fallida_resumen:
    'La operación terminó sin eliminar la organización.'
});
const UUID_V7 = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;

export class ServicioBuzonNotificacionesUsuario {
  constructor({
    repositorio,
    catalogoResolutoresSujetos,
    servicioAutorizacion,
    publicadorInvalidaciones = null,
    secretoCursores
  } = {}) {
    if (
      typeof repositorio?.listarPagina !== 'function' ||
      typeof repositorio?.contarNoLeidas !== 'function' ||
      typeof repositorio?.marcarLeida !== 'function' ||
      typeof repositorio?.obtenerFirma !== 'function'
    ) {
      throw new Error('El servicio de buzón requiere su repositorio durable completo.');
    }
    if (typeof catalogoResolutoresSujetos?.resolverPagina !== 'function') {
      throw new Error('El buzón requiere un catálogo cerrado de resolutores de sujeto.');
    }
    if (typeof servicioAutorizacion?.puedeUsarBuzonPersonal !== 'function') {
      throw new Error('El buzón requiere autorización explícita.');
    }
    if (publicadorInvalidaciones !== null &&
        typeof publicadorInvalidaciones?.publicar !== 'function') {
      throw new Error('El publicador del buzón no cumple su puerto.');
    }
    const secreto = Buffer.from(String(secretoCursores || ''), 'utf8');
    if (secreto.length < 32) {
      throw new Error('El secreto de cursores del buzón debe contener al menos 32 bytes.');
    }
    this.repositorio = repositorio;
    this.catalogoResolutoresSujetos = catalogoResolutoresSujetos;
    this.servicioAutorizacion = servicioAutorizacion;
    this.publicadorInvalidaciones = publicadorInvalidaciones;
    this.secretoCursores = secreto;
  }

  async listar(contextoUsuarioActual, { limite = 25, cursor = null } = {}) {
    const destinatarioUsuarioId = this.#destinatario(contextoUsuarioActual);
    const posicion = cursor ? this.#decodificarCursor(cursor) : null;
    const pagina = await this.repositorio.listarPagina({
      destinatarioUsuarioId,
      limite,
      cursor: posicion
    });
    const sujetos = await this.catalogoResolutoresSujetos.resolverPagina(
      contextoUsuarioActual,
      pagina.notificaciones
    );
    const notificaciones = pagina.notificaciones.map((notificacion) =>
      presentarNotificacion(notificacion, sujetos, contextoUsuarioActual));
    const siguienteCursor = pagina.siguientePosicion
      ? this.#codificarCursor(pagina.siguientePosicion)
      : null;
    return Object.freeze({
      notificaciones: Object.freeze(notificaciones),
      paginacion: Object.freeze({
        hayMas: pagina.hayMas,
        siguienteCursor
      }),
      noLeidas: await this.repositorio.contarNoLeidas(destinatarioUsuarioId)
    });
  }

  async resumir(contextoUsuarioActual) {
    const destinatarioUsuarioId = this.#destinatario(contextoUsuarioActual);
    const firma = await this.repositorio.obtenerFirma(destinatarioUsuarioId);
    return Object.freeze({
      noLeidas: Number(firma.noLeidas),
      firma: firma.firma,
      actualizadaEnUtc: firma.actualizadaEnUtc
    });
  }

  async marcarLeida(contextoUsuarioActual, notificacionId) {
    const destinatarioUsuarioId = this.#destinatario(contextoUsuarioActual);
    const resultado = await this.repositorio.marcarLeida({
      destinatarioUsuarioId,
      notificacionId
    });
    if (!resultado) {
      throw errorHttp(404, 'notificacion_buzon_no_encontrada', 'La notificación no existe.');
    }
    let invalidacionPublicada = false;
    if (resultado.cambioEfectivo && this.publicadorInvalidaciones) {
      try {
        const firma = await this.repositorio.obtenerFirma(destinatarioUsuarioId);
        await this.publicadorInvalidaciones.publicar({
          destinatarioUsuarioId,
          firmaBuzon: firma.firma
        });
        invalidacionPublicada = true;
      } catch (error) {
        console.error(
          `[buzon-usuarios] Invalidación no publicada: ${codigoSeguro(error)}`
        );
      }
    }
    return Object.freeze({
      cambioEfectivo: resultado.cambioEfectivo,
      notificacionId: resultado.notificacion.notificacionId,
      leida: resultado.notificacion.leida,
      leidaEnUtc: resultado.notificacion.leidaEnUtc,
      invalidacionPublicada,
      noLeidas: await this.repositorio.contarNoLeidas(destinatarioUsuarioId)
    });
  }

  #destinatario(contexto) {
    if (!this.servicioAutorizacion.puedeUsarBuzonPersonal(contexto)) {
      throw errorHttp(403, 'buzon_personal_no_autorizado', 'El buzón personal no está disponible.');
    }
    const valor = String(contexto?.idUsuarioReal ?? contexto?.idUsuario ?? '');
    if (!/^[1-9][0-9]*$/u.test(valor)) {
      throw errorHttp(403, 'buzon_personal_sin_actor_real', 'No se pudo resolver el actor real.');
    }
    return valor;
  }

  #codificarCursor(posicion) {
    const cuerpo = Buffer.from(JSON.stringify({
      v: 1,
      emitidaEnUtc: posicion.emitidaEnUtc,
      notificacionId: posicion.notificacionId
    }), 'utf8').toString('base64url');
    return `${cuerpo}.${this.#firmar(cuerpo)}`;
  }

  #decodificarCursor(cursor) {
    const entrada = String(cursor || '');
    if (entrada.length > 512) {
      throw errorHttp(400, 'cursor_buzon_invalido', 'El cursor del buzón no es válido.');
    }
    const [cuerpo, firma, extra] = entrada.split('.');
    if (!cuerpo || !firma || extra !== undefined || !firmaValida(firma, this.#firmar(cuerpo))) {
      throw errorHttp(400, 'cursor_buzon_invalido', 'El cursor del buzón no es válido.');
    }
    try {
      const datos = JSON.parse(Buffer.from(cuerpo, 'base64url').toString('utf8'));
      if (
        datos.v !== 1 ||
        typeof datos.emitidaEnUtc !== 'string' ||
        typeof datos.notificacionId !== 'string' ||
        Object.keys(datos).sort().join(',') !== 'emitidaEnUtc,notificacionId,v'
      ) {
        throw new Error('forma');
      }
      return Object.freeze({
        emitidaEnUtc: datos.emitidaEnUtc,
        notificacionId: datos.notificacionId
      });
    } catch {
      throw errorHttp(400, 'cursor_buzon_invalido', 'El cursor del buzón no es válido.');
    }
  }

  #firmar(cuerpo) {
    return createHmac('sha256', this.secretoCursores)
      .update(cuerpo, 'ascii')
      .digest('base64url');
  }
}

function presentarNotificacion(notificacion, sujetos, contextoUsuarioActual) {
  const referencia = notificacion.referenciaSujeto;
  const sujetoResuelto = sujetos.get(claveSujetoNotificacion(referencia)) || null;
  const sujeto = presentarSujeto(referencia, sujetoResuelto, contextoUsuarioActual);
  const tipoEmisor = notificacion.emisor?.tipo || 'sistema';
  const operacionId = String(notificacion.operacionId || '').toLowerCase();
  return Object.freeze({
    notificacionId: notificacion.notificacionId,
    tipo: notificacion.tipo,
    estadoOperacion: notificacion.estadoOperacion,
    titulo: textoTipado(notificacion.tituloCodigo),
    resumen: textoTipado(notificacion.resumenCodigo),
    emitidaEnUtc: notificacion.emitidaEnUtc,
    leida: notificacion.leida,
    leidaEnUtc: notificacion.leidaEnUtc,
    formato: 'texto_plano',
    emisor: Object.freeze({
      tipo: tipoEmisor,
      etiqueta: etiquetaEmisor(tipoEmisor)
    }),
    operacion: Object.freeze({
      operacionId: UUID_V7.test(operacionId) ? operacionId : null,
      enlace: (sujeto.disponible || sujeto.fotografiaFinal) && UUID_V7.test(operacionId)
        ? `/operaciones-administrativas/${encodeURIComponent(operacionId)}`
        : null
    }),
    sujeto
  });
}

function presentarSujeto(referencia, resuelto, contexto) {
  if (resuelto?.disponible) {
    return Object.freeze({
      tipo: resuelto.tipo,
      disponible: true,
      id: String(resuelto.id),
      ...(resuelto.guid ? { guid: String(resuelto.guid) } : {}),
      nombre: textoPlano(resuelto.nombre, 191),
      ubicacion: textoPlano(resuelto.ubicacion, 300) || null,
      enlace: resuelto.enlace || null
    });
  }
  const fotografia = referencia.fotografiaFinal;
  if (
    resuelto?.existe === false &&
    fotografia &&
    scopeActualCubre(contexto, fotografia.scopeFinal)
  ) {
    return Object.freeze({
      tipo: referencia.tipo,
      disponible: false,
      fotografiaFinal: true,
      id: String(fotografia.id),
      nombre: textoPlano(fotografia.nombre, 191),
      ubicacion: null,
      enlace: null,
      capturadaEnUtc: fotografia.capturadaEnUtc
    });
  }
  return Object.freeze({ tipo: referencia.tipo, disponible: false });
}

function etiquetaEmisor(tipo) {
  return ({
    usuario: 'Usuario',
    sistema: 'Sistema',
    proceso: 'Proceso administrativo'
  })[tipo] || 'Plataforma';
}

function textoTipado(codigo) {
  const texto = TEXTOS[codigo];
  if (!texto) throw new Error(`No existe plantilla segura para ${codigo}.`);
  return texto;
}

function textoPlano(valor, maximo) {
  return String(valor || '')
    .replace(/[\u0000-\u001f\u007f]+/gu, ' ')
    .replaceAll('&', '＆')
    .replaceAll('<', '‹')
    .replaceAll('>', '›')
    .replace(/\s+/gu, ' ')
    .trim()
    .slice(0, maximo);
}

function firmaValida(recibida, esperada) {
  const a = Buffer.from(String(recibida), 'ascii');
  const b = Buffer.from(String(esperada), 'ascii');
  return a.length === b.length && timingSafeEqual(a, b);
}

function errorHttp(statusCode, codigo, mensaje) {
  return Object.assign(new Error(mensaje), { statusCode, codigo });
}

function codigoSeguro(error) {
  return String(error?.codigo || error?.code || 'error_publicacion_buzon')
    .replace(/[^a-z0-9_.-]+/giu, '_')
    .slice(0, 64);
}

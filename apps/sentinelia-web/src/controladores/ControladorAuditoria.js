import { ErrorContratoConsultaAuditoria } from '../../../../paquetes/auditoria/src/ContratoConsultaAuditoria.js';
import { CATALOGO_TIPOS_EVENTO_AUDITORIA } from '../../../../paquetes/auditoria/src/CatalogoAuditoria.js';
import { ErrorResolutorConsultaAuditoria } from '../../../../paquetes/auditoria/src/ServicioResolutoresConsultaAuditoria.js';

export class ControladorAuditoria {
  constructor({ servicioLecturaAuditoria, servicioResolutoresAuditoria = null }) {
    if (!servicioLecturaAuditoria?.listarEventos || !servicioLecturaAuditoria?.listarDiagnosticos) {
      throw new Error('ControladorAuditoria requiere servicio de lectura.');
    }
    this.servicioLecturaAuditoria = servicioLecturaAuditoria;
    this.servicioResolutoresAuditoria = servicioResolutoresAuditoria;
  }

  async mostrarCronologia(requisicion, respuesta, next) {
    try {
      respuesta.render('portal/auditoria-cronologia', {
        titulo: 'Cronología de auditoría',
        usuarioActual: requisicion.session?.usuarioAutenticado ?? null,
        contextoUsuarioActual: requisicion.contextoUsuarioActual,
        tiposEventoAuditoria: CATALOGO_TIPOS_EVENTO_AUDITORIA.map(({ tipo, flujo }) => ({
          tipo,
          flujo: flujo || 'transversal',
          etiqueta: etiquetarTipoEventoAuditoria(tipo)
        }))
      });
    } catch (error) {
      next(error);
    }
  }

  async apiListarEventos(requisicion, respuesta, next) {
    try {
      const resultado = await this.servicioLecturaAuditoria.listarEventos({
        contextoUsuarioActual: requisicion.contextoUsuarioActual,
        sesionActual: construirSesionConsultaAuditoria(requisicion),
        consulta: requisicion.query
      });
      respuesta.json(await this.#enriquecerResultado(resultado, requisicion.contextoUsuarioActual));
    } catch (error) {
      if (error instanceof ErrorContratoConsultaAuditoria) {
        respuesta.status(400).json({
          ok: false,
          codigo: error.codigo,
          campo: error.campo,
          mensaje: error.message
        });
        return;
      }
      next(error);
    }
  }

  async apiListarEventosCorrelacionados(requisicion, respuesta, next) {
    try {
      const resultado = await this.servicioLecturaAuditoria.listarEventosCorrelacionados({
        contextoUsuarioActual: requisicion.contextoUsuarioActual,
        sesionActual: construirSesionConsultaAuditoria(requisicion),
        correlacionId: requisicion.params.correlacionId,
        consulta: requisicion.query
      });
      respuesta.json(await this.#enriquecerResultado(resultado, requisicion.contextoUsuarioActual));
    } catch (error) {
      if (error instanceof ErrorContratoConsultaAuditoria) {
        respuesta.status(400).json({
          ok: false,
          codigo: error.codigo,
          campo: error.campo,
          mensaje: error.message
        });
        return;
      }
      next(error);
    }
  }

  async apiResolverSujetos(requisicion, respuesta, next) {
    return this.#resolverOpciones('resolverSujetos', requisicion, respuesta, next);
  }

  async apiResolverActores(requisicion, respuesta, next) {
    return this.#resolverOpciones('resolverActores', requisicion, respuesta, next);
  }

  async #resolverOpciones(metodo, requisicion, respuesta, next) {
    try {
      if (typeof this.servicioResolutoresAuditoria?.[metodo] !== 'function') {
        throw new Error('Los resolutores de auditoría no están disponibles.');
      }
      const resultado = await this.servicioResolutoresAuditoria[metodo]({
        contextoUsuarioActual: requisicion.contextoUsuarioActual,
        consulta: requisicion.query
      });
      respuesta.json(resultado);
    } catch (error) {
      if (error instanceof ErrorResolutorConsultaAuditoria) {
        respuesta.status(error.statusCode).json({
          ok: false,
          codigo: error.codigo,
          campo: error.campo,
          mensaje: error.message
        });
        return;
      }
      next(error);
    }
  }

  async #enriquecerResultado(resultado, contextoUsuarioActual) {
    if (typeof this.servicioResolutoresAuditoria?.enriquecerEventos !== 'function') return resultado;
    if (Array.isArray(resultado?.eventos)) {
      return {
        ...resultado,
        eventos: await this.servicioResolutoresAuditoria.enriquecerEventos({
          contextoUsuarioActual,
          eventos: resultado.eventos
        })
      };
    }
    if (!Array.isArray(resultado?.grupos)) return resultado;
    const eventos = resultado.grupos.flatMap((grupo) => grupo.eventos || []);
    const enriquecidos = await this.servicioResolutoresAuditoria.enriquecerEventos({
      contextoUsuarioActual,
      eventos
    });
    let indice = 0;
    return {
      ...resultado,
      grupos: resultado.grupos.map((grupo) => ({
        ...grupo,
        eventos: (grupo.eventos || []).map(() => enriquecidos[indice++])
      }))
    };
  }

  async apiListarDiagnosticos(requisicion, respuesta, next) {
    try {
      const resultado = await this.servicioLecturaAuditoria.listarDiagnosticos({
        contextoUsuarioActual: requisicion.contextoUsuarioActual,
        consulta: requisicion.query
      });
      respuesta.json(resultado);
    } catch (error) {
      next(error);
    }
  }

  async apiReconocerIncidente(requisicion, respuesta) {
    try {
      const resultado = await this.servicioLecturaAuditoria.reconocerIncidente({
        contextoUsuarioActual: requisicion.contextoUsuarioActual,
        sesionActual: requisicion.session?.usuarioAutenticado ?? null,
        episodioId: requisicion.params.episodioId,
        comentario: normalizarComentario(requisicion.body?.comentario)
      });
      respuesta.json(resultado);
    } catch (error) {
      respuesta.status(error.statusCode || 400).json({
        ok: false,
        codigo: error.codigo || 'reconocimiento_no_aplicado',
        mensaje: error.message || 'No se pudo reconocer la incidencia.'
      });
    }
  }
}

function etiquetarTipoEventoAuditoria(tipo) {
  const [familia, ...accion] = String(tipo).split('.');
  const accionesConocidas = {
    'usuario.password_cambiado': 'contraseña modificada',
    'usuario.password_reiniciado': 'contraseña restablecida',
    'usuario.password_recuperado': 'contraseña recuperada',
    'usuario.email_validado': 'correo verificado',
    'scope.entidad_entrada': 'entrada en el alcance',
    'scope.entidad_salida': 'salida del alcance'
  };
  const familias = {
    recuperacion_password: 'Recuperación de contraseña',
    auditoria: 'Auditoría',
    configuracion: 'Configuración',
    plataforma: 'Plataforma',
    usuario: 'Usuario',
    organizacion: 'Organización',
    agente: 'Agente',
    regla_telemetria: 'Regla de telemetría',
    monitor: 'Monitor',
    alerta: 'Alerta',
    trigger: 'Acción',
    dns: 'DNS',
    ddns: 'DNS dinámico',
    federacion: 'Federación',
    cadena: 'Cadena de auditoría',
    scope: 'Cambio de alcance'
  };
  const descripcion = accionesConocidas[tipo] || accion.join('.').replaceAll('_', ' ')
    .replace(/\bpermisos cambiados\b/u, 'permisos modificados')
    .replace(/\bretencion aplicada\b/u, 'retención aplicada')
    .replace(/\bsesion\b/gu, 'sesión')
    .replace(/\bconfiguracion\b/gu, 'configuración')
    .replace(/\bpublicacion\b/gu, 'publicación')
    .replace(/\bimpersonacion\b/gu, 'impersonación')
    .replace(/\bbinding\b/gu, 'vínculo');
  return `${familias[familia] || familia} · ${descripcion}`;
}

function construirSesionConsultaAuditoria(requisicion) {
  const autenticada = requisicion.session?.usuarioAutenticado ?? {};
  const auditable = requisicion.sesionWebAuditoria ?? {};
  return {
    ...autenticada,
    sesionAuditoriaId: auditable.sesionAuditoriaId ?? autenticada.sesionAuditoriaId,
    idUsuarioReal: autenticada.idUsuarioReal ?? auditable.usuarioRealId,
    idUsuarioEfectivo: autenticada.idUsuarioEfectivo ?? auditable.usuarioEfectivoId,
    versionSesionReal: autenticada.versionSesionReal ?? auditable.versionSesionReal,
    versionSesionEfectiva:
      autenticada.versionSesionEfectiva ?? auditable.versionSesionEfectiva
  };
}

function normalizarComentario(valor) {
  const texto = String(valor ?? '').trim();
  return texto.length ? texto : null;
}

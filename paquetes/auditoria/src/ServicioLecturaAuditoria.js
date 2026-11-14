import { createHmac, createHash, timingSafeEqual } from 'node:crypto';
import { ResolutorVisibilidadCausalAuditoria } from './ResolutorVisibilidadCausalAuditoria.js';
import {
  admiteConsultaEventosAuditoriaV2,
  construirRespuestaCorrelacionAuditoriaV2,
  construirRespuestaEventosAuditoriaV2,
  leerPaginaEventosAuditoriaV2,
  prepararConsultaCorrelacionAuditoriaV2,
  prepararConsultaEventosAuditoriaV2
} from './ConsultaEventosAuditoriaV2.js';
import {
  ServicioVisibilidadDiagnosticosIntegridadAuditoria,
  tieneAlcanceCompletoCadena as tieneAlcanceCompletoCadenaIntegridad
} from './ServicioVisibilidadDiagnosticosIntegridadAuditoria.js';
import { proyectarDetalleCambiosAuditoria } from './ProyectorDetalleCambiosAuditoria.js';
import { FLUJOS_AUDITORIA } from './CatalogoAuditoria.js';

const FLUJOS = new Set(FLUJOS_AUDITORIA);
const MAX_EVENTOS_GRUPO = 100;

export class ServicioLecturaAuditoria {
  constructor({
    repositorioLectura,
    secretoCursores,
    resolutorVisibilidadCausal = null,
    servicioDiagnosticosIntegridad = null,
    servicioVisibilidadDiagnosticos = null
  } = {}) {
    if (!repositorioLectura?.listarEventos || !repositorioLectura?.contarEventos) {
      throw new Error('ServicioLecturaAuditoria requiere repositorio de lectura.');
    }
    if (typeof secretoCursores !== 'string' || secretoCursores.length < 16) {
      throw new Error('ServicioLecturaAuditoria requiere secreto estable para cursores.');
    }
    this.repositorioLectura = repositorioLectura;
    this.secretoCursores = secretoCursores;
    this.servicioDiagnosticosIntegridad = servicioDiagnosticosIntegridad;
    this.resolutorVisibilidadCausal = resolutorVisibilidadCausal ||
      new ResolutorVisibilidadCausalAuditoria({ repositorioLectura });
    this.servicioVisibilidadDiagnosticos = servicioVisibilidadDiagnosticos ||
      new ServicioVisibilidadDiagnosticosIntegridadAuditoria();
  }

  async listarEventos({ contextoUsuarioActual, sesionActual, consulta = {} } = {}) {
    exigirPermiso(contextoUsuarioActual);
    if (admiteConsultaEventosAuditoriaV2(this.repositorioLectura)) {
      return this.#listarEventosV2({
        contextoUsuarioActual,
        sesionActual,
        consulta
      });
    }
    const limite = normalizarLimite(consulta.limite);
    const orden = consulta.orden === 'asc' ? 'asc' : 'desc';
    const filtros = normalizarFiltros(consulta);
    const identidad = identidadCursor({
      contextoUsuarioActual,
      sesionActual,
      filtros,
      orden,
      limite
    });
    const cursor = consulta.cursor
      ? decodificarCursor({
        cursor: consulta.cursor,
        identidad,
        secreto: this.secretoCursores
      })
      : null;
    if (this.repositorioLectura.listarClavesCorrelacion) {
      return this.#listarGrupos({
        contextoUsuarioActual,
        filtros,
        cursor,
        limite,
        orden,
        identidad,
        incluirTotal: Boolean(consulta.incluirTotal)
      });
    }
    const filas = await this.repositorioLectura.listarEventos({
      contextoUsuarioActual,
      filtros,
      cursor,
      limite,
      orden
    });
    const visibles = filas.slice(0, limite);
    const eventos = await this.#proyectarEventos({
      eventos: visibles,
      contextoUsuarioActual
    });
    const siguienteBase = filas.length > limite ? filas[limite - 1] : null;
    const siguienteCursor = siguienteBase
      ? codificarCursor({
        identidad,
        posicion: {
          registradoEnUtc: siguienteBase.registradoEnUtc,
          eventoId: siguienteBase.eventoId
        },
        secreto: this.secretoCursores
      })
      : null;
    const total = consulta.incluirTotal
      ? await this.repositorioLectura.contarEventos({ contextoUsuarioActual, filtros })
      : null;
    return Object.freeze({
      eventos: Object.freeze(eventos),
      paginacion: Object.freeze({
        orden,
        limite,
        siguienteCursor,
        hayMas: Boolean(siguienteCursor)
      }),
      filtros: Object.freeze(filtros),
      total
    });
  }

  async #listarEventosV2({ contextoUsuarioActual, sesionActual, consulta }) {
    const preparada = prepararConsultaEventosAuditoriaV2({
      consulta,
      contextoUsuarioActual,
      sesionActual,
      secreto: this.secretoCursores
    });
    const { normalizada } = preparada;
    const pagina = await leerPaginaEventosAuditoriaV2({
      repositorioLectura: this.repositorioLectura,
      contextoUsuarioActual,
      filtros: normalizada.filtros,
      cursor: preparada.posicion,
      limite: normalizada.limite,
      orden: normalizada.orden
    });
    const visibles = pagina.eventos.slice(0, normalizada.limite);
    const eventos = await this.#proyectarEventos({
      eventos: visibles,
      contextoUsuarioActual
    });
    const total = normalizada.incluirTotal
      ? await this.repositorioLectura.contarEventos({
        contextoUsuarioActual,
        filtros: normalizada.filtros
      })
      : null;
    return construirRespuestaEventosAuditoriaV2({
      preparada,
      eventos,
      hayMas: Boolean(pagina.hayMas),
      total,
      secreto: this.secretoCursores
    });
  }

  async listarEventosCorrelacionados({
    contextoUsuarioActual,
    sesionActual,
    correlacionId,
    consulta = {}
  } = {}) {
    exigirPermiso(contextoUsuarioActual);
    const preparada = prepararConsultaCorrelacionAuditoriaV2({
      correlacionId,
      consulta,
      contextoUsuarioActual,
      sesionActual,
      secreto: this.secretoCursores
    });
    const { normalizada } = preparada;
    const pagina = await leerPaginaEventosAuditoriaV2({
      repositorioLectura: this.repositorioLectura,
      contextoUsuarioActual,
      filtros: Object.freeze({ correlacionId: preparada.correlacionId }),
      cursor: preparada.posicion,
      limite: normalizada.limite,
      orden: normalizada.orden
    });
    const visibles = pagina.eventos.slice(0, normalizada.limite);
    const eventos = await this.#proyectarEventos({
      eventos: visibles,
      contextoUsuarioActual
    });
    return construirRespuestaCorrelacionAuditoriaV2({
      preparada,
      eventos,
      hayMas: Boolean(pagina.hayMas),
      secreto: this.secretoCursores
    });
  }

  async #listarGrupos({
    contextoUsuarioActual,
    filtros,
    cursor,
    limite,
    orden,
    identidad,
    incluirTotal
  }) {
    if (cursor?.modo === 'grupo_interno') {
      return this.#continuarGrupo({
        contextoUsuarioActual, filtros, cursor, limite, orden, identidad, incluirTotal
      });
    }
    const posicionExterna = cursor?.modo === 'grupos' ? cursor.grupo : null;
    const claves = await this.repositorioLectura.listarClavesCorrelacion({
      contextoUsuarioActual,
      filtros,
      cursor: posicionExterna,
      limite,
      orden
    });
    const seleccionadas = claves.slice(0, limite);
    const grupos = [];
    let siguientePosicion = null;
    for (const clave of seleccionadas) {
      const filas = await this.repositorioLectura.listarEventos({
        contextoUsuarioActual,
        filtros: { ...filtros, correlacionId: clave.correlacionId },
        cursor: null,
        limite: MAX_EVENTOS_GRUPO,
        orden
      });
      const visibles = filas.slice(0, MAX_EVENTOS_GRUPO);
      grupos.push(await this.#proyectarGrupo({
        clave,
        filas: visibles,
        contextoUsuarioActual,
        parcial: filas.length > MAX_EVENTOS_GRUPO,
        continuacion: false
      }));
      if (filas.length > MAX_EVENTOS_GRUPO) {
        const ultimo = visibles.at(-1);
        siguientePosicion = {
          modo: 'grupo_interno',
          grupo: clave,
          interno: { registradoEnUtc: ultimo.registradoEnUtc, eventoId: ultimo.eventoId }
        };
        break;
      }
    }
    if (!siguientePosicion && claves.length > limite && grupos.length) {
      siguientePosicion = { modo: 'grupos', grupo: grupos.at(-1).clavePresentacion };
    }
    return this.#respuestaGrupos({
      grupos,
      siguientePosicion,
      identidad,
      orden,
      limite,
      contextoUsuarioActual,
      filtros,
      incluirTotal
    });
  }

  async #continuarGrupo({
    contextoUsuarioActual,
    filtros,
    cursor,
    limite,
    orden,
    identidad,
    incluirTotal
  }) {
    const filas = await this.repositorioLectura.listarEventos({
      contextoUsuarioActual,
      filtros: { ...filtros, correlacionId: cursor.grupo.correlacionId },
      cursor: cursor.interno,
      limite: MAX_EVENTOS_GRUPO,
      orden
    });
    const visibles = filas.slice(0, MAX_EVENTOS_GRUPO);
    const parcial = filas.length > MAX_EVENTOS_GRUPO;
    const grupo = await this.#proyectarGrupo({
      clave: cursor.grupo,
      filas: visibles,
      contextoUsuarioActual,
      parcial,
      continuacion: true
    });
    const ultimo = visibles.at(-1);
    let siguientePosicion = null;
    if (parcial) {
      siguientePosicion = {
        modo: 'grupo_interno',
        grupo: cursor.grupo,
        interno: { registradoEnUtc: ultimo.registradoEnUtc, eventoId: ultimo.eventoId }
      };
    } else {
      const siguientes = await this.repositorioLectura.listarClavesCorrelacion({
        contextoUsuarioActual,
        filtros,
        cursor: cursor.grupo,
        limite: 1,
        orden
      });
      if (siguientes.length) siguientePosicion = { modo: 'grupos', grupo: cursor.grupo };
    }
    return this.#respuestaGrupos({
      grupos: visibles.length ? [grupo] : [],
      siguientePosicion,
      identidad,
      orden,
      limite,
      contextoUsuarioActual,
      filtros,
      incluirTotal
    });
  }

  async #proyectarGrupo({ clave, filas, contextoUsuarioActual, parcial, continuacion }) {
    const eventos = await this.#proyectarEventos({
      eventos: filas,
      contextoUsuarioActual
    });
    return Object.freeze({
      correlacionId: clave.correlacionId,
      clavePresentacion: Object.freeze({ ...clave }),
      parcial,
      continuacion,
      eventos: Object.freeze(eventos)
    });
  }

  async #respuestaGrupos({
    grupos,
    siguientePosicion,
    identidad,
    orden,
    limite,
    contextoUsuarioActual,
    filtros,
    incluirTotal
  }) {
    const siguienteCursor = siguientePosicion
      ? codificarCursor({ identidad, posicion: siguientePosicion, secreto: this.secretoCursores })
      : null;
    const total = incluirTotal
      ? await this.repositorioLectura.contarEventos({ contextoUsuarioActual, filtros })
      : null;
    return Object.freeze({
      grupos: Object.freeze(grupos),
      eventos: Object.freeze(grupos.flatMap((grupo) => grupo.eventos)),
      paginacion: Object.freeze({ orden, limite, siguienteCursor, hayMas: Boolean(siguienteCursor) }),
      filtros: Object.freeze(filtros),
      total
    });
  }

  async listarDiagnosticos({ contextoUsuarioActual, consulta = {} } = {}) {
    exigirPermiso(contextoUsuarioActual);
    const limite = normalizarLimite(consulta.limite);
    const diagnosticos = this.repositorioLectura.listarDiagnosticos
      ? await this.repositorioLectura.listarDiagnosticos({ contextoUsuarioActual, limite })
      : [];
    const incidentes = this.repositorioLectura.listarIncidentes
      ? await this.repositorioLectura.listarIncidentes({
        contextoUsuarioActual,
        soloActivos: consulta.soloActivos !== 'false',
        limite
      })
      : [];
    const vista = this.servicioVisibilidadDiagnosticos.construirVista({
      contextoUsuarioActual,
      diagnosticos,
      incidentes
    });
    return Object.freeze({
      ...vista,
      limite
    });
  }

  async reconocerIncidente({ contextoUsuarioActual, sesionActual, episodioId, comentario = null } = {}) {
    exigirPermiso(contextoUsuarioActual);
    if (!this.servicioDiagnosticosIntegridad?.reconocerIncidente) {
      throw crearErrorHttp(
        'El reconocimiento de incidencias no está disponible en esta instancia.',
        503,
        'reconocimiento_no_disponible'
      );
    }
    if (!this.repositorioLectura.obtenerIncidenteVisible) {
      throw crearErrorHttp(
        'No se puede comprobar el alcance del incidente.',
        503,
        'lectura_incidente_no_disponible'
      );
    }
    const incidente = await this.repositorioLectura.obtenerIncidenteVisible({
      episodioId,
      contextoUsuarioActual
    });
    if (!incidente) {
      throw crearErrorHttp('Incidente no visible o inexistente.', 404, 'incidente_no_visible');
    }
    if (incidente.estadoDeteccion !== 'activo') {
      throw crearErrorHttp('El incidente ya no está activo.', 409, 'incidente_no_activo');
    }
    if (incidente.reconocidoEnUtc) {
      throw crearErrorHttp('El incidente ya fue reconocido.', 409, 'incidente_ya_reconocido');
    }
    if (!tieneAlcanceCompletoCadenaIntegridad(incidente.claveCadena, contextoUsuarioActual)) {
      throw crearErrorHttp(
        'Tu alcance permite ver el resumen, pero no reconocer esta incidencia de integridad.',
        403,
        'alcance_insuficiente'
      );
    }
    const actorId = contextoUsuarioActual?.idUsuarioReal ??
      sesionActual?.idUsuarioReal ??
      contextoUsuarioActual?.idUsuario ??
      sesionActual?.id;
    const resultado = await this.servicioDiagnosticosIntegridad.reconocerIncidente({
      episodioId,
      comentario,
      actor: { tipo: 'usuario', id: String(actorId) }
    });
    return Object.freeze({
      ok: true,
      episodioId,
      eventoId: resultado.evento.eventoId,
      mensaje: 'Incidencia reconocida y registrada en auditoría.'
    });
  }

  async #proyectarEventos({ eventos, contextoUsuarioActual }) {
    const visibilidadLote = this.resolutorVisibilidadCausal.resolverLote
      ? await this.resolutorVisibilidadCausal.resolverLote({
        eventos,
        contextoUsuarioActual
      })
      : null;
    return Promise.all(eventos.map((evento) => this.#proyectarEvento({
      evento,
      contextoUsuarioActual,
      visibilidadLote
    })));
  }

  async #proyectarEvento({ evento, contextoUsuarioActual, visibilidadLote = null }) {
    const alcanceCompleto = tieneAlcanceCompletoCadena(contextoUsuarioActual, evento);
    const proyectado = {
      eventoId: evento.eventoId,
      tipoEvento: evento.tipoEvento,
      versionContrato: evento.versionContrato,
      flujo: evento.flujo,
      claveCadena: alcanceCompleto ? evento.claveCadena : undefined,
      actorReal: evento.actorReal,
      actorEfectivo: evento.actorEfectivo,
      modoActuacion: evento.modoActuacion,
      sujeto: evento.sujeto,
      origen: evento.origen,
      scope: evento.scope,
      correlacionId: evento.correlacionId,
      productor: evento.productor,
      rolEvento: evento.rolEvento,
      efectivoEnUtc: evento.efectivoEnUtc,
      registradoEnUtc: evento.registradoEnUtc,
      payload: evento.payload
    };
    const detalleCambios = proyectarDetalleCambiosAuditoria({
      evento,
      alcanceCompleto
    });
    if (detalleCambios) proyectado.detalleCambios = detalleCambios;
    if (alcanceCompleto) {
      proyectado.secuencia = evento.secuencia;
      proyectado.hashPayload = evento.hashPayload;
      proyectado.hashAnterior = evento.hashAnterior;
      proyectado.hashActual = evento.hashActual;
      proyectado.versionCanonicalizador = evento.versionCanonicalizador;
      proyectado.versionEncadenado = evento.versionEncadenado;
    }
    const contraparte = await this.resolutorVisibilidadCausal.proyectarContraparte({
      evento,
      contextoUsuarioActual,
      visibilidadLote
    });
    if (contraparte) proyectado.eventoContraparteId = contraparte;
    const causalidad = await this.resolutorVisibilidadCausal.proyectarCausalidad({
      evento,
      contextoUsuarioActual,
      visibilidadLote
    });
    if (causalidad) proyectado.causalidad = causalidad;
    return Object.freeze(
      Object.fromEntries(Object.entries(proyectado).filter(([, valor]) => valor !== undefined))
    );
  }
}

function exigirPermiso(contextoUsuarioActual) {
  if (!contextoUsuarioActual?.permisos?.verAuditoria) {
    const error = new Error('Se requiere permiso verAuditoria.');
    error.codigo = 'permiso_ver_auditoria_requerido';
    error.statusCode = 403;
    throw error;
  }
}

function normalizarLimite(valor) {
  const numero = Number(valor ?? 50);
  if (!Number.isInteger(numero) || numero < 1) return 50;
  return Math.min(numero, 100);
}

function normalizarFiltros(consulta = {}) {
  const filtros = {};
  if (consulta.flujo) {
    if (!FLUJOS.has(String(consulta.flujo))) throw new Error('Filtro flujo no válido.');
    filtros.flujo = String(consulta.flujo);
  }
  if (consulta.tipoEvento) {
    const tipo = String(consulta.tipoEvento);
    if (!/^[a-z0-9_.:-]{3,96}$/.test(tipo)) throw new Error('Filtro tipoEvento no válido.');
    filtros.tipoEvento = tipo;
  }
  if (consulta.desdeUtc) filtros.desdeUtc = normalizarFechaFiltro(consulta.desdeUtc, 'desdeUtc');
  if (consulta.hastaUtc) filtros.hastaUtc = normalizarFechaFiltro(consulta.hastaUtc, 'hastaUtc');
  for (const prohibido of ['resultado', 'estado']) {
    if (consulta[prohibido] !== undefined) {
      throw new Error(`El filtro global ${prohibido} no está permitido.`);
    }
  }
  return filtros;
}

function normalizarFechaFiltro(valor, nombre) {
  const texto = String(valor);
  const fecha = new Date(texto);
  if (!/Z$/.test(texto) || Number.isNaN(fecha.getTime())) {
    throw new Error(`Filtro ${nombre} no válido.`);
  }
  return fecha.toISOString();
}

function crearErrorHttp(mensaje, statusCode, codigo) {
  const error = new Error(mensaje);
  error.statusCode = statusCode;
  error.codigo = codigo;
  return error;
}

function identidadCursor({ contextoUsuarioActual, sesionActual, filtros, orden, limite }) {
  return Object.freeze({
    v: 1,
    sesionAuditoriaId: sesionActual?.sesionAuditoriaId ?? null,
    idUsuarioReal: String(sesionActual?.idUsuarioReal ?? contextoUsuarioActual?.idUsuarioReal ?? ''),
    idUsuarioEfectivo: String(sesionActual?.idUsuarioEfectivo ?? contextoUsuarioActual?.idUsuario ?? ''),
    versionSesionReal: String(sesionActual?.versionSesionReal ?? ''),
    versionSesionEfectiva: String(sesionActual?.versionSesionEfectiva ?? sesionActual?.versionSesion ?? ''),
    verAuditoria: Boolean(contextoUsuarioActual?.permisos?.verAuditoria),
    scopeHash: hashScope(contextoUsuarioActual),
    filtros,
    orden,
    limite: Number(limite)
  });
}

function codificarCursor({ identidad, posicion, secreto }) {
  const payload = { identidad, posicion };
  const cuerpo = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const firma = firmar(cuerpo, secreto);
  return `${cuerpo}.${firma}`;
}

function decodificarCursor({ cursor, identidad, secreto }) {
  const [cuerpo, firma] = String(cursor).split('.');
  if (!cuerpo || !firma) throw crearErrorCursor('CURSOR_INVALIDO');
  const firmaEsperada = firmar(cuerpo, secreto);
  if (!seguroIgual(firma, firmaEsperada)) throw crearErrorCursor('CURSOR_INVALIDO');
  let payload;
  try {
    payload = JSON.parse(Buffer.from(cuerpo, 'base64url').toString('utf8'));
  } catch {
    throw crearErrorCursor('CURSOR_INVALIDO');
  }
  if (JSON.stringify(payload.identidad) !== JSON.stringify(identidad)) {
    throw crearErrorCursor('CURSOR_AUTORIZACION_CAMBIADA');
  }
  return payload.posicion;
}

function crearErrorCursor(codigo) {
  const error = new Error(
    codigo === 'CURSOR_AUTORIZACION_CAMBIADA'
      ? 'Cursor de auditoría inválido porque cambió la autorización; reinicia la consulta.'
      : 'Cursor de auditoría no válido.'
  );
  error.codigo = codigo;
  error.statusCode = 400;
  return error;
}

function firmar(cuerpo, secreto) {
  return createHmac('sha256', secreto).update(cuerpo).digest('base64url');
}

function seguroIgual(a, b) {
  const ba = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  return ba.length === bb.length && timingSafeEqual(ba, bb);
}

function hashScope(contexto) {
  return createHash('sha256')
    .update(JSON.stringify({
      nivelScope: contexto?.nivelScope ?? null,
      tenantId: contexto?.tenantId ?? null,
      empresaId: contexto?.empresaId ?? null,
      sitioId: contexto?.sitioId ?? null
    }))
    .digest('hex');
}

function tieneAlcanceCompletoCadena(contexto, evento) {
  if (contexto?.nivelScope === 'portal') return true;
  if (contexto?.nivelScope !== 'tenant') return false;
  return String(evento?.scope?.tenantId ?? '') === String(contexto.tenantId ?? '') &&
    evento?.scope?.empresaId == null &&
    evento?.scope?.sitioId == null;
}

export const __testablesServicioLecturaAuditoria = Object.freeze({
  normalizarFiltros,
  identidadCursor,
  codificarCursor,
  decodificarCursor,
  tieneAlcanceCompletoCadena
});

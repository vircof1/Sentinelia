import { normalizarConsultaAuditoria } from './NormalizadorConsultaAuditoria.js';
import {
  codificarCursorAuditoriaV2,
  construirIdentidadCursorAuditoriaV2,
  decodificarCursorAuditoriaV2
} from './CodecCursorConsultaAuditoria.js';
import {
  CODIGOS_ERROR_CONSULTA_AUDITORIA,
  CONTRATO_PARAMETROS_CONSULTA_AUDITORIA,
  ErrorContratoConsultaAuditoria
} from './ContratoConsultaAuditoria.js';

const PARAMETROS_CONSULTA_CORRELACION = new Set(['limite', 'orden', 'cursor']);

export function admiteConsultaEventosAuditoriaV2(repositorioLectura) {
  return typeof repositorioLectura?.listarPaginaEventos === 'function';
}

export function leerPaginaEventosAuditoriaV2({ repositorioLectura, ...entrada } = {}) {
  return repositorioLectura.listarPaginaEventos(entrada);
}

export function prepararConsultaEventosAuditoriaV2({
  consulta,
  contextoUsuarioActual,
  sesionActual,
  secreto
} = {}) {
  const normalizada = normalizarConsultaAuditoria(consulta);
  const identidad = construirIdentidadCursorAuditoriaV2({
    modo: 'eventos',
    contextoUsuarioActual,
    sesionActual,
    consultaNormalizada: normalizada
  });
  const posicion = normalizada.cursor
    ? decodificarCursorAuditoriaV2({
      cursor: normalizada.cursor,
      identidad,
      secreto
    })
    : null;
  return Object.freeze({ normalizada, identidad, posicion });
}

export function prepararConsultaCorrelacionAuditoriaV2({
  correlacionId,
  consulta,
  contextoUsuarioActual,
  sesionActual,
  secreto
} = {}) {
  validarCorrelacionId(correlacionId);
  validarParametrosConsultaCorrelacion(consulta);
  const normalizada = normalizarConsultaAuditoria(consulta);
  const identidad = construirIdentidadCursorAuditoriaV2({
    modo: 'correlacion',
    contextoUsuarioActual,
    sesionActual,
    consultaNormalizada: normalizada,
    correlacionId
  });
  const posicion = normalizada.cursor
    ? decodificarCursorAuditoriaV2({
      cursor: normalizada.cursor,
      identidad,
      secreto
    })
    : null;
  return Object.freeze({ correlacionId, normalizada, identidad, posicion });
}

export function construirRespuestaEventosAuditoriaV2({
  preparada,
  eventos,
  hayMas,
  total,
  secreto
} = {}) {
  return construirRespuesta({
    preparada,
    eventos,
    hayMas,
    total,
    filtros: preparada.normalizada.filtros,
    incluirTotal: preparada.normalizada.incluirTotal,
    secreto
  });
}

export function construirRespuestaCorrelacionAuditoriaV2({
  preparada,
  eventos,
  hayMas,
  secreto
} = {}) {
  return construirRespuesta({
    preparada,
    eventos,
    hayMas,
    total: null,
    filtros: Object.freeze({ correlacionId: preparada.correlacionId }),
    incluirTotal: false,
    secreto
  });
}

function construirRespuesta({
  preparada,
  eventos,
  hayMas,
  total,
  filtros,
  incluirTotal,
  secreto
}) {
  const visibles = Object.freeze([...eventos]);
  const ultimo = visibles.at(-1) ?? null;
  const siguienteCursor = hayMas && ultimo
    ? codificarCursorAuditoriaV2({
      identidad: preparada.identidad,
      posicion: {
        registradoEnUtc: ultimo.registradoEnUtc,
        eventoId: ultimo.eventoId
      },
      secreto
    })
    : null;
  return Object.freeze({
    eventos: visibles,
    paginacion: Object.freeze({
      orden: preparada.normalizada.orden,
      limite: preparada.normalizada.limite,
      siguienteCursor,
      hayMas: Boolean(siguienteCursor)
    }),
    filtros,
    total: incluirTotal ? Number(total) : null
  });
}

function validarCorrelacionId(correlacionId) {
  if (!CONTRATO_PARAMETROS_CONSULTA_AUDITORIA.correlacionId.validar(correlacionId)) {
    throw new ErrorContratoConsultaAuditoria(
      'El parámetro correlacionId no cumple el contrato de consulta.',
      {
        codigo: CODIGOS_ERROR_CONSULTA_AUDITORIA.FILTRO_INVALIDO,
        campo: 'correlacionId'
      }
    );
  }
}

function validarParametrosConsultaCorrelacion(consulta = {}) {
  if (!consulta || typeof consulta !== 'object' || Array.isArray(consulta)) return;
  for (const nombre of Object.keys(consulta)) {
    if (PARAMETROS_CONSULTA_CORRELACION.has(nombre)) continue;
    throw new ErrorContratoConsultaAuditoria(
      `El parámetro ${nombre} no forma parte del contrato de consulta correlacionada.`,
      {
        codigo: CODIGOS_ERROR_CONSULTA_AUDITORIA.PARAMETRO_NO_ADMITIDO,
        campo: nombre
      }
    );
  }
}

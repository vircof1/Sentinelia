import {
  CONTRATO_PARAMETROS_CONSULTA_AUDITORIA,
  LIMITE_MAXIMO_CONSULTA_AUDITORIA,
  LIMITE_POR_DEFECTO_CONSULTA_AUDITORIA,
  validarConsultaAuditoriaSegunContrato
} from './ContratoConsultaAuditoria.js';

const CAMPOS_FILTRO_CANONICOS = Object.freeze([
  'desdeUtc',
  'hastaUtc',
  'flujo',
  'tipoEvento',
  'sujetoTipo',
  'sujetoId',
  'actorRol',
  'actorTipo',
  'actorId',
  'modoActuacion',
  'origen',
  'claveCadena',
  'correlacionId',
  'causalidadTipo',
  'causalidadId'
]);

export function normalizarConsultaAuditoria(consulta = {}) {
  validarConsultaAuditoriaSegunContrato(consulta);
  const filtros = {};
  for (const campo of CAMPOS_FILTRO_CANONICOS) {
    if (consulta[campo] === undefined) continue;
    filtros[campo] = campo === 'desdeUtc' || campo === 'hastaUtc'
      ? new Date(consulta[campo]).toISOString()
      : consulta[campo];
  }

  const limite = consulta.limite === undefined
    ? LIMITE_POR_DEFECTO_CONSULTA_AUDITORIA
    : Math.min(Number(consulta.limite), LIMITE_MAXIMO_CONSULTA_AUDITORIA);

  return congelar({
    filtros,
    orden: consulta.orden ?? CONTRATO_PARAMETROS_CONSULTA_AUDITORIA.orden.defecto,
    limite,
    incluirTotal: consulta.incluirTotal === true || consulta.incluirTotal === 'true',
    cursor: consulta.cursor ?? null
  });
}

export const __testablesNormalizadorConsultaAuditoria = Object.freeze({
  CAMPOS_FILTRO_CANONICOS
});

function congelar(valor) {
  if (valor && typeof valor === 'object' && !Object.isFrozen(valor)) {
    Object.freeze(valor);
    for (const hijo of Object.values(valor)) congelar(hijo);
  }
  return valor;
}

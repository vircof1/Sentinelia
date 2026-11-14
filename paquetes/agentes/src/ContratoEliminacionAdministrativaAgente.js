import { createHash } from 'node:crypto';
import { validate as validarUuid, version as obtenerVersionUuid } from 'uuid';

import {
  canonicalizarRfc8785,
  validarFechaUtcMilisegundos
} from '../../auditoria/src/PerfilJcsAuditoria.js';
import { validarUuidV7Auditoria } from '../../auditoria/src/UuidV7Auditoria.js';
import {
  CAUSAS_REINTENTABLES_INFRAESTRUCTURA_OPERACION_ADMINISTRATIVA,
  CAUSAS_TERMINALES_INFRAESTRUCTURA_OPERACION_ADMINISTRATIVA
} from '../../coordinacion-durable/src/DiagnosticosOperacionesAdministrativas.js';

export const PERFIL_CONTRATO_ELIMINACION_ADMINISTRATIVA_AGENTE =
  'sentinelia-eliminacion-administrativa-agente-v1';
export const VERSION_CONTRATO_ELIMINACION_ADMINISTRATIVA_AGENTE = 1;
export const PERFIL_FOTOGRAFIA_AUTORIZACION_ELIMINACION_AGENTE =
  'sentinelia-eliminacion-agente-autorizacion-v1';
export const PERFIL_FOTOGRAFIA_ESTRUCTURAL_ELIMINACION_AGENTE =
  'sentinelia-eliminacion-agente-estructura-v1';
export const PERFIL_RESUMEN_IMPACTO_ELIMINACION_AGENTE =
  'sentinelia-eliminacion-agente-impacto-v1';
export const PERFIL_RESULTADO_ELIMINACION_AGENTE =
  'sentinelia-eliminacion-agente-resultado-v1';
export const PERFIL_NOTIFICACION_OPERACION_ADMINISTRATIVA =
  'sentinelia-notificacion-operacion-administrativa-v1';
export const PERFIL_OBLIGACION_POSTCOMMIT_ELIMINACION_AGENTE =
  'sentinelia-eliminacion-agente-obligacion-postcommit-v1';

export const TIPOS_OPERACION_ADMINISTRATIVA = Object.freeze({
  ELIMINAR_AGENTE: 'eliminar_agente'
});

export const TIPOS_SUJETO_OPERACION_ADMINISTRATIVA = Object.freeze({
  AGENTE: 'agente'
});

export const ESTADOS_OPERACION_ADMINISTRATIVA = Object.freeze({
  ENCOLADA: 'encolada',
  EJECUTANDO: 'ejecutando',
  COMPLETADA: 'completada',
  COMPLETADA_CON_ADVERTENCIAS: 'completada_con_advertencias',
  FALLIDA: 'fallida'
});

export const FASES_ELIMINACION_ADMINISTRATIVA_AGENTE = Object.freeze({
  PREPARACION: 'preparacion',
  VALIDACION: 'validacion',
  ELIMINACION: 'eliminacion',
  COMMIT: 'commit',
  LIMPIEZA: 'limpieza'
});

export const CAUSAS_REINTENTABLES_ELIMINACION_AGENTE = Object.freeze([
  ...CAUSAS_REINTENTABLES_INFRAESTRUCTURA_OPERACION_ADMINISTRATIVA
]);

export const CAUSAS_TERMINALES_ELIMINACION_AGENTE = Object.freeze([
  'agente_eliminacion_estructura_modificada',
  'agente_eliminacion_identidad_federada_incompleta',
  'agente_eliminacion_impacto_no_seguro',
  'agente_eliminacion_sujeto_ausente',
  ...CAUSAS_TERMINALES_INFRAESTRUCTURA_OPERACION_ADMINISTRATIVA
]);

export const TIPOS_NOTIFICACION_ELIMINACION_AGENTE = Object.freeze({
  ENCOLADA: 'eliminacion_encolada',
  ELIMINADA: 'agente_eliminado',
  ELIMINADA_LIMPIEZA_PENDIENTE: 'agente_eliminado_limpieza_pendiente',
  LIMPIEZA_COMPLETADA: 'limpieza_tecnica_completada',
  FALLIDA: 'eliminacion_fallida'
});

export const EMISORES_NOTIFICACION_OPERACION_ADMINISTRATIVA = Object.freeze({
  USUARIO: 'usuario',
  SISTEMA: 'sistema',
  PROCESO: 'proceso'
});

export const CAPACIDADES_ELIMINACION_ADMINISTRATIVA_AGENTE = Object.freeze({
  cancelable: false,
  progreso: 'fases_semanticas',
  porcentaje: false
});

export const RESPUESTAS_HTTP_ACEPTACION_ELIMINACION_AGENTE = congelarProfundo({
  agente_eliminacion_encolada: { statusHttp: 202, satisfactoria: true },
  agente_eliminacion_repetida: { statusHttp: 202, satisfactoria: true },
  agente_eliminacion_no_autorizada: { statusHttp: 404, satisfactoria: false },
  agente_eliminacion_no_encontrada: { statusHttp: 404, satisfactoria: false },
  agente_eliminacion_confirmacion_invalida: { statusHttp: 400, satisfactoria: false },
  agente_eliminacion_confirmacion_expirada: { statusHttp: 410, satisfactoria: false },
  agente_eliminacion_estructura_modificada: { statusHttp: 409, satisfactoria: false },
  agente_eliminacion_identidad_federada_incompleta: { statusHttp: 409, satisfactoria: false },
  agente_eliminacion_impacto_no_seguro: { statusHttp: 409, satisfactoria: false },
  agente_eliminacion_operacion_en_curso: { statusHttp: 409, satisfactoria: false }
});

export const CATEGORIAS_IMPACTO_ELIMINACION_AGENTE = Object.freeze([
  'agente',
  'reglas',
  'monitores',
  'asignaciones_trigger',
  'perfil_servidor',
  'sesiones_tecnicas',
  'identidades_federadas',
  'senales',
  'observaciones',
  'pol',
  'estados_actuales',
  'eventos',
  'ejecuciones_trigger',
  'correo_aceptado_preservadas',
  'concesiones_ddns',
  'intenciones_ddns_aceptadas',
  'causas_pol_ddns_pendientes',
  'referencias_compartidas',
  'obligaciones_postcommit'
]);

export const PRECISIONES_IMPACTO_ELIMINACION_AGENTE = Object.freeze({
  EXACTA: 'exacta',
  ESTIMADA: 'estimada'
});

export const TIPOS_OBLIGACION_POSTCOMMIT_ELIMINACION_AGENTE = Object.freeze([
  'retirar_sesion_redis',
  'retirar_perfil_servidor_redis',
  'retirar_agenda_servidor_redis',
  'invalidar_catalogo_monitores',
  'publicar_invalidacion_portal'
]);

export const ESTADOS_OBLIGACION_POSTCOMMIT_ELIMINACION_AGENTE = Object.freeze({
  PENDIENTE: 'pendiente',
  PROCESANDO: 'procesando',
  REINTENTABLE: 'reintentable',
  BLOQUEO_PERMANENTE: 'bloqueo_permanente',
  COMPLETADA: 'completada'
});

export const PROPIEDADES_CONTRATO_ELIMINACION_ADMINISTRATIVA_AGENTE =
  congelarProfundo({
    COMANDO: [
      'perfil',
      'version',
      'tipoOperacion',
      'estado',
      'fase',
      'cancelable',
      'progreso',
      'identidades',
      'sujeto',
      'fotografiaAutorizacion',
      'fotografiaEstructural',
      'resumenImpacto'
    ],
    IDENTIDADES: ['operacionId', 'claveOperacion', 'correlacionId', 'eventoId'],
    SUJETO: ['tipo', 'id', 'guid', 'scope'],
    SCOPE: ['nivel', 'tenantId', 'empresaId', 'sitioId'],
    ACTOR: ['usuarioId', 'estado', 'decision', 'scope'],
    AUTORIZACION: [
      'perfil',
      'version',
      'decision',
      'aceptadaEnUtc',
      'actorReal',
      'actorEfectivo',
      'destinatarioUsuarioId'
    ],
    ESTRUCTURA: [
      'perfil',
      'version',
      'sujeto',
      'huellaEstructuralSha256',
      'confirmadaEnUtc'
    ],
    IMPACTO: ['perfil', 'version', 'conteos'],
    CONTEO_IMPACTO: ['categoria', 'cantidad', 'precision'],
    TRANSICION: [
      'estadoAnterior',
      'faseAnterior',
      'estadoNuevo',
      'faseNueva',
      'causaCodigo'
    ],
    DIAGNOSTICO: ['codigo', 'mensaje'],
    FALLO_TERMINAL: ['fase', 'codigo', 'mensaje'],
    CRONOLOGIA: ['aceptadaEnUtc', 'efectivoEnUtc', 'registradoEnUtc'],
    OBLIGACION: ['obligacionId', 'tipo', 'estado'],
    OBLIGACION_POSTCOMMIT: [
      'perfil',
      'version',
      'obligacionId',
      'operacionId',
      'tipo',
      'objetivo'
    ],
    OBJETIVO_OBLIGACION_SESION: ['agenteId', 'operacionSesionId'],
    OBJETIVO_OBLIGACION_PERFIL: ['agenteId', 'generacionPerfil'],
    OBJETIVO_OBLIGACION_AGENTE: ['agenteId'],
    OBJETIVO_OBLIGACION_PORTAL: ['destinatarioUsuarioId'],
    RESULTADO: [
      'perfil',
      'version',
      'resultado',
      'estado',
      'sujeto',
      'impactoResumen',
      'cronologia',
      'eventoAuditoriaId',
      'obligaciones'
    ],
    EMISOR_NOTIFICACION: ['tipo', 'actorRealId', 'actorEfectivoId'],
    REFERENCIA_SUJETO: ['tipo', 'id', 'guid'],
    NOTIFICACION: [
      'perfil',
      'version',
      'notificacionId',
      'tipo',
      'operacionId',
      'destinatarioUsuarioId',
      'emisor',
      'emitidaEnUtc',
      'estadoOperacion',
      'referenciaSujeto',
      'leida',
      'leidaEnUtc',
      'tituloCodigo',
      'resumenCodigo'
    ],
    PAYLOAD_NOTIFICACION: ['estadoOperacion', 'referenciaSujeto'],
    REPETICION: ['existente', 'candidata']
  });

const VERSION_PERFIL = 1;
const PATRON_SHA256 = /^[0-9a-f]{64}$/u;
const PATRON_GUID_UUID_CANONICO =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const PATRON_ENTERO_DECIMAL_NO_NEGATIVO = /^(0|[1-9][0-9]*)$/u;
const ESTADOS = new Set(Object.values(ESTADOS_OPERACION_ADMINISTRATIVA));
const FASES = new Set(Object.values(FASES_ELIMINACION_ADMINISTRATIVA_AGENTE));
const CAUSAS_REINTENTABLES = new Set(CAUSAS_REINTENTABLES_ELIMINACION_AGENTE);
const CAUSAS_TERMINALES = new Set(CAUSAS_TERMINALES_ELIMINACION_AGENTE);
const CATEGORIAS_IMPACTO = new Set(CATEGORIAS_IMPACTO_ELIMINACION_AGENTE);
const PRECISIONES_IMPACTO = new Set(Object.values(PRECISIONES_IMPACTO_ELIMINACION_AGENTE));
const TIPOS_OBLIGACION = new Set(TIPOS_OBLIGACION_POSTCOMMIT_ELIMINACION_AGENTE);
const TIPOS_NOTIFICACION = new Set(Object.values(TIPOS_NOTIFICACION_ELIMINACION_AGENTE));
const TIPOS_EMISOR = new Set(Object.values(EMISORES_NOTIFICACION_OPERACION_ADMINISTRATIVA));
const FASES_EJECUCION = Object.freeze([
  FASES_ELIMINACION_ADMINISTRATIVA_AGENTE.PREPARACION,
  FASES_ELIMINACION_ADMINISTRATIVA_AGENTE.VALIDACION,
  FASES_ELIMINACION_ADMINISTRATIVA_AGENTE.ELIMINACION,
  FASES_ELIMINACION_ADMINISTRATIVA_AGENTE.COMMIT
]);
const CATEGORIAS_HISTORICAS = new Set([
  'correo_aceptado_preservadas',
  'senales',
  'observaciones',
  'pol',
  'estados_actuales',
  'eventos',
  'ejecuciones_trigger'
]);
export const CONTRATOS_NOTIFICACION_ELIMINACION_AGENTE = congelarProfundo({
  eliminacion_encolada: {
    estado: ESTADOS_OPERACION_ADMINISTRATIVA.ENCOLADA,
    emisor: EMISORES_NOTIFICACION_OPERACION_ADMINISTRATIVA.USUARIO,
    tituloCodigo: 'eliminacion_agente_encolada_titulo',
    resumenCodigo: 'eliminacion_agente_encolada_resumen'
  },
  agente_eliminado: {
    estado: ESTADOS_OPERACION_ADMINISTRATIVA.COMPLETADA,
    emisor: EMISORES_NOTIFICACION_OPERACION_ADMINISTRATIVA.PROCESO,
    tituloCodigo: 'agente_eliminado_titulo',
    resumenCodigo: 'agente_eliminado_resumen'
  },
  agente_eliminado_limpieza_pendiente: {
    estado: ESTADOS_OPERACION_ADMINISTRATIVA.COMPLETADA_CON_ADVERTENCIAS,
    emisor: EMISORES_NOTIFICACION_OPERACION_ADMINISTRATIVA.PROCESO,
    tituloCodigo: 'agente_eliminado_limpieza_pendiente_titulo',
    resumenCodigo: 'agente_eliminado_limpieza_pendiente_resumen'
  },
  limpieza_tecnica_completada: {
    estado: ESTADOS_OPERACION_ADMINISTRATIVA.COMPLETADA,
    emisor: EMISORES_NOTIFICACION_OPERACION_ADMINISTRATIVA.PROCESO,
    tituloCodigo: 'limpieza_tecnica_completada_titulo',
    resumenCodigo: 'limpieza_tecnica_completada_resumen'
  },
  eliminacion_fallida: {
    estado: ESTADOS_OPERACION_ADMINISTRATIVA.FALLIDA,
    emisor: EMISORES_NOTIFICACION_OPERACION_ADMINISTRATIVA.PROCESO,
    tituloCodigo: 'eliminacion_agente_fallida_titulo',
    resumenCodigo: 'eliminacion_agente_fallida_resumen'
  }
});

export class ErrorContratoEliminacionAdministrativaAgente extends Error {
  constructor(mensaje, { codigo = 'contrato_eliminacion_agente_invalido', campo = null } = {}) {
    super(mensaje);
    this.name = 'ErrorContratoEliminacionAdministrativaAgente';
    this.codigo = codigo;
    this.campo = campo;
  }
}

export function crearIdentidadesEliminacionAdministrativaAgente(entrada) {
  validarClavesExactas(
    entrada,
    PROPIEDADES_CONTRATO_ELIMINACION_ADMINISTRATIVA_AGENTE.IDENTIDADES,
    'identidades'
  );
  const identidades = {
    operacionId: uuidV7(entrada.operacionId, 'identidades.operacionId'),
    claveOperacion: uuidV7(entrada.claveOperacion, 'identidades.claveOperacion'),
    correlacionId: uuidV7(entrada.correlacionId, 'identidades.correlacionId'),
    eventoId: uuidV7(entrada.eventoId, 'identidades.eventoId')
  };
  if (new Set(Object.values(identidades)).size !== Object.keys(identidades).length) {
    fallar(
      'Las identidades de operación, idempotencia, correlación y evento deben ser distintas.',
      'identidad_eliminacion_agente_reutilizada',
      'identidades'
    );
  }
  return congelarProfundo(identidades);
}

export function crearSujetoEliminacionAdministrativaAgente(entrada) {
  validarClavesExactas(
    entrada,
    PROPIEDADES_CONTRATO_ELIMINACION_ADMINISTRATIVA_AGENTE.SUJETO,
    'sujeto'
  );
  exigirIgual(
    entrada.tipo,
    TIPOS_SUJETO_OPERACION_ADMINISTRATIVA.AGENTE,
    'tipo_sujeto_eliminacion_agente_invalido',
    'sujeto.tipo'
  );
  return congelarProfundo({
    tipo: entrada.tipo,
    id: idDecimalPositivo(entrada.id, 'sujeto.id'),
    guid: guidAgente(entrada.guid, 'sujeto.guid'),
    scope: normalizarScope(entrada.scope, 'sujeto.scope')
  });
}

export function crearFotografiaAutorizacionEliminacionAgente(entrada) {
  validarClavesExactas(
    entrada,
    PROPIEDADES_CONTRATO_ELIMINACION_ADMINISTRATIVA_AGENTE.AUTORIZACION,
    'fotografiaAutorizacion'
  );
  exigirPerfil(
    entrada,
    PERFIL_FOTOGRAFIA_AUTORIZACION_ELIMINACION_AGENTE,
    'fotografiaAutorizacion'
  );
  exigirIgual(
    entrada.decision,
    'autorizada',
    'decision_autorizacion_eliminacion_agente_invalida',
    'fotografiaAutorizacion.decision'
  );
  const actorReal = normalizarActor(entrada.actorReal, 'fotografiaAutorizacion.actorReal');
  const actorEfectivo = normalizarActor(
    entrada.actorEfectivo,
    'fotografiaAutorizacion.actorEfectivo'
  );
  const destinatarioUsuarioId = idDecimalPositivo(
    entrada.destinatarioUsuarioId,
    'fotografiaAutorizacion.destinatarioUsuarioId'
  );
  if (destinatarioUsuarioId !== actorReal.usuarioId) {
    fallar(
      'El buzón destinatario debe pertenecer al actor real que confirmó el comando.',
      'destinatario_eliminacion_agente_invalido',
      'fotografiaAutorizacion.destinatarioUsuarioId'
    );
  }
  if (
    actorReal.usuarioId === actorEfectivo.usuarioId &&
    canonicalizarRfc8785(actorReal) !== canonicalizarRfc8785(actorEfectivo)
  ) {
    fallar(
      'Una actuación directa no puede fotografiar dos autoridades distintas para el mismo usuario.',
      'actores_eliminacion_agente_incoherentes',
      'fotografiaAutorizacion'
    );
  }
  return congelarProfundo({
    perfil: entrada.perfil,
    version: entrada.version,
    decision: entrada.decision,
    aceptadaEnUtc: fechaUtc(entrada.aceptadaEnUtc, 'fotografiaAutorizacion.aceptadaEnUtc'),
    actorReal,
    actorEfectivo,
    destinatarioUsuarioId
  });
}

export function crearFotografiaEstructuralEliminacionAgente(entrada) {
  validarClavesExactas(
    entrada,
    PROPIEDADES_CONTRATO_ELIMINACION_ADMINISTRATIVA_AGENTE.ESTRUCTURA,
    'fotografiaEstructural'
  );
  exigirPerfil(
    entrada,
    PERFIL_FOTOGRAFIA_ESTRUCTURAL_ELIMINACION_AGENTE,
    'fotografiaEstructural'
  );
  return congelarProfundo({
    perfil: entrada.perfil,
    version: entrada.version,
    sujeto: crearSujetoEliminacionAdministrativaAgente(entrada.sujeto),
    huellaEstructuralSha256: sha256Hex(
      entrada.huellaEstructuralSha256,
      'fotografiaEstructural.huellaEstructuralSha256'
    ),
    confirmadaEnUtc: fechaUtc(
      entrada.confirmadaEnUtc,
      'fotografiaEstructural.confirmadaEnUtc'
    )
  });
}

export function crearResumenImpactoEliminacionAgente(entrada) {
  validarClavesExactas(
    entrada,
    PROPIEDADES_CONTRATO_ELIMINACION_ADMINISTRATIVA_AGENTE.IMPACTO,
    'resumenImpacto'
  );
  exigirPerfil(entrada, PERFIL_RESUMEN_IMPACTO_ELIMINACION_AGENTE, 'resumenImpacto');
  if (!Array.isArray(entrada.conteos) || entrada.conteos.length === 0) {
    fallar(
      'El resumen de impacto debe contener al menos un conteo.',
      'resumen_impacto_eliminacion_agente_invalido',
      'resumenImpacto.conteos'
    );
  }
  const categorias = new Set();
  const conteos = entrada.conteos.map((conteo, indice) => {
    const ruta = `resumenImpacto.conteos[${indice}]`;
    validarClavesExactas(
      conteo,
      PROPIEDADES_CONTRATO_ELIMINACION_ADMINISTRATIVA_AGENTE.CONTEO_IMPACTO,
      ruta
    );
    if (!CATEGORIAS_IMPACTO.has(conteo.categoria) || categorias.has(conteo.categoria)) {
      fallar(
        'Las categorías del resumen de impacto deben ser cerradas y únicas.',
        'categoria_impacto_eliminacion_agente_invalida',
        `${ruta}.categoria`
      );
    }
    categorias.add(conteo.categoria);
    if (!PRECISIONES_IMPACTO.has(conteo.precision)) {
      fallar(
        'La precisión del conteo de impacto no pertenece al contrato.',
        'precision_impacto_eliminacion_agente_invalida',
        `${ruta}.precision`
      );
    }
    if (
      conteo.precision === PRECISIONES_IMPACTO_ELIMINACION_AGENTE.ESTIMADA &&
      !CATEGORIAS_HISTORICAS.has(conteo.categoria)
    ) {
      fallar(
        'Solo los históricos operativos admiten conteos estimados.',
        'precision_impacto_eliminacion_agente_invalida',
        `${ruta}.precision`
      );
    }
    return {
      categoria: conteo.categoria,
      cantidad: enteroDecimalNoNegativo(conteo.cantidad, `${ruta}.cantidad`),
      precision: conteo.precision
    };
  }).sort((a, b) => a.categoria.localeCompare(b.categoria));

  const agente = conteos.find(({ categoria }) => categoria === 'agente');
  if (!agente || agente.cantidad !== '1' || agente.precision !== 'exacta') {
    fallar(
      'La eliminación directa debe declarar exactamente un agente.',
      'raiz_impacto_eliminacion_agente_invalida',
      'resumenImpacto.conteos'
    );
  }
  return congelarProfundo({
    perfil: entrada.perfil,
    version: entrada.version,
    conteos
  });
}

export function crearComandoEliminacionAdministrativaAgente(entrada) {
  validarClavesExactas(
    entrada,
    PROPIEDADES_CONTRATO_ELIMINACION_ADMINISTRATIVA_AGENTE.COMANDO,
    'comando'
  );
  exigirPerfil(
    entrada,
    PERFIL_CONTRATO_ELIMINACION_ADMINISTRATIVA_AGENTE,
    'comando'
  );
  exigirIgual(
    entrada.tipoOperacion,
    TIPOS_OPERACION_ADMINISTRATIVA.ELIMINAR_AGENTE,
    'tipo_operacion_eliminacion_agente_invalido',
    'comando.tipoOperacion'
  );
  exigirIgual(
    entrada.estado,
    ESTADOS_OPERACION_ADMINISTRATIVA.ENCOLADA,
    'estado_inicial_eliminacion_agente_invalido',
    'comando.estado'
  );
  exigirIgual(
    entrada.fase,
    FASES_ELIMINACION_ADMINISTRATIVA_AGENTE.PREPARACION,
    'fase_inicial_eliminacion_agente_invalida',
    'comando.fase'
  );
  exigirIgual(
    entrada.cancelable,
    false,
    'cancelacion_eliminacion_agente_no_admitida',
    'comando.cancelable'
  );
  exigirIgual(
    entrada.progreso,
    'fases_semanticas',
    'progreso_eliminacion_agente_invalido',
    'comando.progreso'
  );

  const identidades = crearIdentidadesEliminacionAdministrativaAgente(entrada.identidades);
  const sujeto = crearSujetoEliminacionAdministrativaAgente(entrada.sujeto);
  const fotografiaAutorizacion =
    crearFotografiaAutorizacionEliminacionAgente(entrada.fotografiaAutorizacion);
  const fotografiaEstructural =
    crearFotografiaEstructuralEliminacionAgente(entrada.fotografiaEstructural);
  const resumenImpacto = crearResumenImpactoEliminacionAgente(entrada.resumenImpacto);

  if (canonicalizarRfc8785(sujeto) !== canonicalizarRfc8785(fotografiaEstructural.sujeto)) {
    fallar(
      'La fotografía estructural pertenece a otro sujeto.',
      'sujeto_eliminacion_agente_incoherente',
      'comando.fotografiaEstructural.sujeto'
    );
  }
  for (const [rol, actor] of [
    ['actorReal', fotografiaAutorizacion.actorReal],
    ['actorEfectivo', fotografiaAutorizacion.actorEfectivo]
  ]) {
    if (!scopeAlcanza(actor.scope, sujeto.scope)) {
      fallar(
        `El ${rol} fotografiado no alcanza el sujeto confirmado.`,
        'scope_autorizacion_eliminacion_agente_invalido',
        `comando.fotografiaAutorizacion.${rol}.scope`
      );
    }
  }
  if (
    Date.parse(fotografiaEstructural.confirmadaEnUtc) >
    Date.parse(fotografiaAutorizacion.aceptadaEnUtc)
  ) {
    fallar(
      'La fotografía estructural no puede ser posterior a la aceptación.',
      'cronologia_confirmacion_eliminacion_agente_invalida',
      'comando.fotografiaEstructural.confirmadaEnUtc'
    );
  }

  return congelarProfundo({
    perfil: entrada.perfil,
    version: entrada.version,
    tipoOperacion: entrada.tipoOperacion,
    estado: entrada.estado,
    fase: entrada.fase,
    cancelable: entrada.cancelable,
    progreso: entrada.progreso,
    identidades,
    sujeto,
    fotografiaAutorizacion,
    fotografiaEstructural,
    resumenImpacto
  });
}

export function canonicalizarComandoEliminacionAdministrativaAgente(entrada) {
  return canonicalizarRfc8785(crearComandoEliminacionAdministrativaAgente(entrada));
}

export function calcularHuellaIntencionEliminacionAgenteSha256(entrada) {
  return createHash('sha256')
    .update(canonicalizarComandoEliminacionAdministrativaAgente(entrada), 'utf8')
    .digest('hex');
}

export function clasificarRepeticionEliminacionAdministrativaAgente(entrada) {
  validarClavesExactas(
    entrada,
    PROPIEDADES_CONTRATO_ELIMINACION_ADMINISTRATIVA_AGENTE.REPETICION,
    'repeticion'
  );
  const existente = crearComandoEliminacionAdministrativaAgente(entrada.existente);
  const candidata = crearComandoEliminacionAdministrativaAgente(entrada.candidata);
  if (existente.identidades.claveOperacion !== candidata.identidades.claveOperacion) {
    return Object.freeze({
      resultado: 'nueva',
      operacionId: candidata.identidades.operacionId
    });
  }
  if (
    canonicalizarRfc8785(existente) !== canonicalizarRfc8785(candidata)
  ) {
    fallar(
      'La clave de operación ya protege otra intención.',
      'clave_operacion_eliminacion_agente_reutilizada',
      'repeticion.candidata.identidades.claveOperacion'
    );
  }
  return Object.freeze({
    resultado: 'repetida',
    operacionId: existente.identidades.operacionId
  });
}

export function validarTransicionEliminacionAdministrativaAgente(entrada) {
  validarClavesExactas(
    entrada,
    PROPIEDADES_CONTRATO_ELIMINACION_ADMINISTRATIVA_AGENTE.TRANSICION,
    'transicion'
  );
  validarEstadoFase(entrada.estadoAnterior, entrada.faseAnterior, 'anterior');
  validarEstadoFase(entrada.estadoNuevo, entrada.faseNueva, 'nuevo');
  const causa = entrada.causaCodigo;
  if (causa !== null && typeof causa !== 'string') {
    fallar(
      'La causa de transición debe ser nula o un código cerrado.',
      'causa_transicion_eliminacion_agente_invalida',
      'transicion.causaCodigo'
    );
  }

  const inicio =
    entrada.estadoAnterior === ESTADOS_OPERACION_ADMINISTRATIVA.ENCOLADA &&
    entrada.faseAnterior === FASES_ELIMINACION_ADMINISTRATIVA_AGENTE.PREPARACION &&
    entrada.estadoNuevo === ESTADOS_OPERACION_ADMINISTRATIVA.EJECUTANDO &&
    entrada.faseNueva === FASES_ELIMINACION_ADMINISTRATIVA_AGENTE.PREPARACION &&
    causa === null;
  const avance = avanceEjecucionValido(entrada) && causa === null;
  const reintento =
    entrada.estadoAnterior === ESTADOS_OPERACION_ADMINISTRATIVA.EJECUTANDO &&
    FASES_EJECUCION.includes(entrada.faseAnterior) &&
    entrada.estadoNuevo === ESTADOS_OPERACION_ADMINISTRATIVA.ENCOLADA &&
    entrada.faseNueva === FASES_ELIMINACION_ADMINISTRATIVA_AGENTE.PREPARACION &&
    CAUSAS_REINTENTABLES.has(causa);
  const fallo =
    entrada.estadoAnterior === ESTADOS_OPERACION_ADMINISTRATIVA.EJECUTANDO &&
    FASES_EJECUCION.includes(entrada.faseAnterior) &&
    entrada.estadoNuevo === ESTADOS_OPERACION_ADMINISTRATIVA.FALLIDA &&
    entrada.faseNueva === entrada.faseAnterior &&
    CAUSAS_TERMINALES.has(causa);
  const completada =
    entrada.estadoAnterior === ESTADOS_OPERACION_ADMINISTRATIVA.EJECUTANDO &&
    entrada.faseAnterior === FASES_ELIMINACION_ADMINISTRATIVA_AGENTE.COMMIT &&
    entrada.estadoNuevo === ESTADOS_OPERACION_ADMINISTRATIVA.COMPLETADA &&
    entrada.faseNueva === FASES_ELIMINACION_ADMINISTRATIVA_AGENTE.LIMPIEZA &&
    causa === null;

  if (!(inicio || avance || reintento || fallo || completada)) {
    fallar(
      'La transición no pertenece al ciclo cerrado de eliminación administrativa.',
      'transicion_eliminacion_agente_invalida',
      'transicion'
    );
  }
  return congelarProfundo({ ...entrada });
}

export function esEstadoTerminalOperacionAdministrativa(estado) {
  if (!ESTADOS.has(estado)) {
    fallar(
      'El estado no pertenece al contrato de operaciones administrativas.',
      'estado_operacion_administrativa_invalido',
      'estado'
    );
  }
  return [
    ESTADOS_OPERACION_ADMINISTRATIVA.COMPLETADA,
    ESTADOS_OPERACION_ADMINISTRATIVA.COMPLETADA_CON_ADVERTENCIAS,
    ESTADOS_OPERACION_ADMINISTRATIVA.FALLIDA
  ].includes(estado);
}

export function crearDiagnosticoErrorEliminacionAgente(entrada) {
  validarClavesExactas(
    entrada,
    PROPIEDADES_CONTRATO_ELIMINACION_ADMINISTRATIVA_AGENTE.DIAGNOSTICO,
    'diagnostico'
  );
  const codigo = String(entrada.codigo || '');
  const reintentable = CAUSAS_REINTENTABLES.has(codigo);
  if (!reintentable && !CAUSAS_TERMINALES.has(codigo)) {
    fallar(
      'El diagnóstico no pertenece al catálogo cerrado de eliminación.',
      'diagnostico_eliminacion_agente_invalido',
      'diagnostico.codigo'
    );
  }
  if (typeof entrada.mensaje !== 'string') {
    fallar(
      'El mensaje de diagnóstico debe ser texto.',
      'diagnostico_eliminacion_agente_invalido',
      'diagnostico.mensaje'
    );
  }
  return Object.freeze({
    codigo,
    reintentable,
    mensaje: sanearMensajeTecnico(entrada.mensaje)
  });
}

export function crearFalloTerminalEliminacionAdministrativaAgente(entrada) {
  validarClavesExactas(
    entrada,
    PROPIEDADES_CONTRATO_ELIMINACION_ADMINISTRATIVA_AGENTE.FALLO_TERMINAL,
    'fallo'
  );
  if (!FASES_EJECUCION.includes(entrada.fase)) {
    fallar(
      'La fase del fallo terminal no pertenece a la frontera precommit.',
      'fase_fallo_eliminacion_agente_invalida',
      'fallo.fase'
    );
  }
  const diagnostico = crearDiagnosticoErrorEliminacionAgente({
    codigo: entrada.codigo,
    mensaje: entrada.mensaje
  });
  if (diagnostico.reintentable) {
    fallar(
      'Una causa reintentable no puede cerrar la operación como fallida.',
      'fallo_terminal_eliminacion_agente_invalido',
      'fallo.codigo'
    );
  }
  return congelarProfundo({
    perfil: PERFIL_RESULTADO_ELIMINACION_AGENTE,
    version: VERSION_PERFIL,
    estado: ESTADOS_OPERACION_ADMINISTRATIVA.FALLIDA,
    fase: entrada.fase,
    error: diagnostico
  });
}

export function crearReferenciaObligacionEliminacionAgente(entrada) {
  validarClavesExactas(
    entrada,
    PROPIEDADES_CONTRATO_ELIMINACION_ADMINISTRATIVA_AGENTE.OBLIGACION,
    'obligacion'
  );
  if (!TIPOS_OBLIGACION.has(entrada.tipo) || entrada.estado !== 'pendiente') {
    fallar(
      'La obligación postcommit no pertenece al contrato inicial.',
      'obligacion_eliminacion_agente_invalida',
      'obligacion'
    );
  }
  return Object.freeze({
    obligacionId: uuidV7(entrada.obligacionId, 'obligacion.obligacionId'),
    tipo: entrada.tipo,
    estado: entrada.estado
  });
}

export function crearObligacionPostcommitEliminacionAgente(entrada) {
  validarClavesExactas(
    entrada,
    PROPIEDADES_CONTRATO_ELIMINACION_ADMINISTRATIVA_AGENTE.OBLIGACION_POSTCOMMIT,
    'obligacionPostcommit'
  );
  exigirPerfil(
    entrada,
    PERFIL_OBLIGACION_POSTCOMMIT_ELIMINACION_AGENTE,
    'obligacionPostcommit'
  );
  if (!TIPOS_OBLIGACION.has(entrada.tipo)) {
    fallar(
      'El tipo de obligación postcommit no pertenece al contrato cerrado.',
      'tipo_obligacion_postcommit_eliminacion_agente_invalido',
      'obligacionPostcommit.tipo'
    );
  }
  const obligacionId = uuidV7(
    entrada.obligacionId,
    'obligacionPostcommit.obligacionId'
  );
  const operacionId = uuidV7(
    entrada.operacionId,
    'obligacionPostcommit.operacionId'
  );
  if (obligacionId === operacionId) {
    fallar(
      'La obligación y su operación causal deben tener identidades distintas.',
      'identidad_obligacion_postcommit_eliminacion_agente_reutilizada',
      'obligacionPostcommit.obligacionId'
    );
  }
  const objetivo = crearObjetivoObligacionPostcommitEliminacionAgente(
    entrada.tipo,
    entrada.objetivo
  );
  if (
    entrada.tipo === 'retirar_sesion_redis' &&
    [obligacionId, operacionId].includes(objetivo.operacionSesionId)
  ) {
    fallar(
      'La operación de sesión no puede reutilizar otra identidad causal.',
      'identidad_obligacion_postcommit_eliminacion_agente_reutilizada',
      'obligacionPostcommit.objetivo.operacionSesionId'
    );
  }
  return congelarProfundo({
    perfil: entrada.perfil,
    version: entrada.version,
    obligacionId,
    operacionId,
    tipo: entrada.tipo,
    objetivo
  });
}

export function canonicalizarObligacionPostcommitEliminacionAgente(entrada) {
  return canonicalizarRfc8785(crearObligacionPostcommitEliminacionAgente(entrada));
}

export function canonicalizarObjetivoObligacionPostcommitEliminacionAgente(
  entrada
) {
  return canonicalizarRfc8785(
    crearObligacionPostcommitEliminacionAgente(entrada).objetivo
  );
}

export function calcularHuellaObjetivoObligacionPostcommitEliminacionAgenteSha256(
  entrada
) {
  return createHash('sha256')
    .update(
      canonicalizarObjetivoObligacionPostcommitEliminacionAgente(entrada),
      'utf8'
    )
    .digest('hex');
}

function crearObjetivoObligacionPostcommitEliminacionAgente(tipo, entrada) {
  if (tipo === 'retirar_sesion_redis') {
    validarClavesExactas(
      entrada,
      PROPIEDADES_CONTRATO_ELIMINACION_ADMINISTRATIVA_AGENTE
        .OBJETIVO_OBLIGACION_SESION,
      'obligacionPostcommit.objetivo'
    );
    return Object.freeze({
      agenteId: idDecimalPositivo(
        entrada.agenteId,
        'obligacionPostcommit.objetivo.agenteId'
      ),
      operacionSesionId: uuidV7(
        entrada.operacionSesionId,
        'obligacionPostcommit.objetivo.operacionSesionId'
      )
    });
  }
  if ([
    'retirar_perfil_servidor_redis',
    'retirar_agenda_servidor_redis'
  ].includes(tipo)) {
    validarClavesExactas(
      entrada,
      PROPIEDADES_CONTRATO_ELIMINACION_ADMINISTRATIVA_AGENTE
        .OBJETIVO_OBLIGACION_PERFIL,
      'obligacionPostcommit.objetivo'
    );
    return Object.freeze({
      agenteId: idDecimalPositivo(
        entrada.agenteId,
        'obligacionPostcommit.objetivo.agenteId'
      ),
      generacionPerfil: idDecimalPositivo(
        entrada.generacionPerfil,
        'obligacionPostcommit.objetivo.generacionPerfil'
      )
    });
  }
  if (tipo === 'invalidar_catalogo_monitores') {
    validarClavesExactas(
      entrada,
      PROPIEDADES_CONTRATO_ELIMINACION_ADMINISTRATIVA_AGENTE
        .OBJETIVO_OBLIGACION_AGENTE,
      'obligacionPostcommit.objetivo'
    );
    return Object.freeze({
      agenteId: idDecimalPositivo(
        entrada.agenteId,
        'obligacionPostcommit.objetivo.agenteId'
      )
    });
  }
  validarClavesExactas(
    entrada,
    PROPIEDADES_CONTRATO_ELIMINACION_ADMINISTRATIVA_AGENTE
      .OBJETIVO_OBLIGACION_PORTAL,
    'obligacionPostcommit.objetivo'
  );
  return Object.freeze({
    destinatarioUsuarioId: idDecimalPositivo(
      entrada.destinatarioUsuarioId,
      'obligacionPostcommit.objetivo.destinatarioUsuarioId'
    )
  });
}

export function crearResultadoEliminacionAdministrativaAgente(entrada) {
  validarClavesExactas(
    entrada,
    PROPIEDADES_CONTRATO_ELIMINACION_ADMINISTRATIVA_AGENTE.RESULTADO,
    'resultado'
  );
  exigirPerfil(entrada, PERFIL_RESULTADO_ELIMINACION_AGENTE, 'resultado');
  exigirIgual(
    entrada.resultado,
    'eliminado',
    'resultado_eliminacion_agente_invalido',
    'resultado.resultado'
  );
  if (entrada.estado !== ESTADOS_OPERACION_ADMINISTRATIVA.COMPLETADA) {
    fallar(
      'El resultado destructivo de un agente exige el estado completada.',
      'estado_resultado_eliminacion_agente_invalido',
      'resultado.estado'
    );
  }
  if (!Array.isArray(entrada.obligaciones)) {
    fallar(
      'Las obligaciones del resultado deben ser una lista.',
      'obligaciones_resultado_eliminacion_agente_invalidas',
      'resultado.obligaciones'
    );
  }
  const obligaciones = entrada.obligaciones.map(crearReferenciaObligacionEliminacionAgente);
  const ids = obligaciones.map(({ obligacionId }) => obligacionId);
  if (new Set(ids).size !== ids.length) {
    fallar(
      'Una obligación no puede aparecer dos veces en el resultado.',
      'obligaciones_resultado_eliminacion_agente_invalidas',
      'resultado.obligaciones'
    );
  }
  const eventoAuditoriaId = uuidV7(
    entrada.eventoAuditoriaId,
    'resultado.eventoAuditoriaId'
  );
  if (ids.includes(eventoAuditoriaId)) {
    fallar(
      'El evento de auditoría no puede reutilizar una identidad de obligación.',
      'identidad_eliminacion_agente_reutilizada',
      'resultado.eventoAuditoriaId'
    );
  }
  const cronologia = crearCronologiaEliminacionAgente(entrada.cronologia);
  return congelarProfundo({
    perfil: entrada.perfil,
    version: entrada.version,
    resultado: entrada.resultado,
    estado: entrada.estado,
    sujeto: crearSujetoEliminacionAdministrativaAgente(entrada.sujeto),
    impactoResumen: crearResumenImpactoEliminacionAgente(entrada.impactoResumen),
    cronologia,
    eventoAuditoriaId,
    obligaciones
  });
}

export function crearCronologiaEliminacionAgente(entrada) {
  validarClavesExactas(
    entrada,
    PROPIEDADES_CONTRATO_ELIMINACION_ADMINISTRATIVA_AGENTE.CRONOLOGIA,
    'cronologia'
  );
  const cronologia = {
    aceptadaEnUtc: fechaUtc(entrada.aceptadaEnUtc, 'cronologia.aceptadaEnUtc'),
    efectivoEnUtc: fechaUtc(entrada.efectivoEnUtc, 'cronologia.efectivoEnUtc'),
    registradoEnUtc: fechaUtc(
      entrada.registradoEnUtc,
      'cronologia.registradoEnUtc'
    )
  };
  if (
    Date.parse(cronologia.aceptadaEnUtc) > Date.parse(cronologia.efectivoEnUtc) ||
    Date.parse(cronologia.efectivoEnUtc) > Date.parse(cronologia.registradoEnUtc)
  ) {
    fallar(
      'Aceptación, efecto y registro deben respetar su orden causal.',
      'cronologia_eliminacion_agente_invalida',
      'cronologia'
    );
  }
  return Object.freeze(cronologia);
}

export function crearNotificacionEliminacionAdministrativaAgente(entrada) {
  validarClavesExactas(
    entrada,
    PROPIEDADES_CONTRATO_ELIMINACION_ADMINISTRATIVA_AGENTE.NOTIFICACION,
    'notificacion'
  );
  exigirPerfil(entrada, PERFIL_NOTIFICACION_OPERACION_ADMINISTRATIVA, 'notificacion');
  if (!TIPOS_NOTIFICACION.has(entrada.tipo)) {
    fallar(
      'El tipo de notificación no pertenece al ciclo de eliminación.',
      'tipo_notificacion_eliminacion_agente_invalido',
      'notificacion.tipo'
    );
  }
  const contrato = CONTRATOS_NOTIFICACION_ELIMINACION_AGENTE[entrada.tipo];
  if (entrada.estadoOperacion !== contrato.estado) {
    fallar(
      'La notificación no coincide con el estado de la operación.',
      'estado_notificacion_eliminacion_agente_invalido',
      'notificacion.estadoOperacion'
    );
  }
  if (
    entrada.tituloCodigo !== contrato.tituloCodigo ||
    entrada.resumenCodigo !== contrato.resumenCodigo
  ) {
    fallar(
      'La notificación debe usar los textos tipados de su catálogo.',
      'contenido_notificacion_eliminacion_agente_invalido',
      'notificacion'
    );
  }
  const notificacionId = uuidV7(entrada.notificacionId, 'notificacion.notificacionId');
  const operacionId = uuidV7(entrada.operacionId, 'notificacion.operacionId');
  if (notificacionId === operacionId) {
    fallar(
      'La notificación no puede reutilizar la identidad de la operación.',
      'identidad_eliminacion_agente_reutilizada',
      'notificacion.notificacionId'
    );
  }
  const emisor = normalizarEmisorNotificacion(entrada.emisor);
  if (emisor.tipo !== contrato.emisor) {
    fallar(
      'El emisor no corresponde al tipo de notificación.',
      'emisor_notificacion_eliminacion_agente_invalido',
      'notificacion.emisor.tipo'
    );
  }
  if (typeof entrada.leida !== 'boolean') {
    fallar(
      'El estado de lectura debe ser booleano.',
      'lectura_notificacion_eliminacion_agente_invalida',
      'notificacion.leida'
    );
  }
  const emitidaEnUtc = fechaUtc(entrada.emitidaEnUtc, 'notificacion.emitidaEnUtc');
  const leidaEnUtc = entrada.leidaEnUtc === null
    ? null
    : fechaUtc(entrada.leidaEnUtc, 'notificacion.leidaEnUtc');
  if (
    entrada.leida !== (leidaEnUtc !== null) ||
    (leidaEnUtc !== null && Date.parse(leidaEnUtc) < Date.parse(emitidaEnUtc))
  ) {
    fallar(
      'La lectura de la notificación posee una cronología incoherente.',
      'lectura_notificacion_eliminacion_agente_invalida',
      'notificacion.leidaEnUtc'
    );
  }
  return congelarProfundo({
    perfil: entrada.perfil,
    version: entrada.version,
    notificacionId,
    tipo: entrada.tipo,
    operacionId,
    destinatarioUsuarioId: idDecimalPositivo(
      entrada.destinatarioUsuarioId,
      'notificacion.destinatarioUsuarioId'
    ),
    emisor,
    emitidaEnUtc,
    estadoOperacion: entrada.estadoOperacion,
    referenciaSujeto: normalizarReferenciaSujeto(entrada.referenciaSujeto),
    leida: entrada.leida,
    leidaEnUtc,
    tituloCodigo: entrada.tituloCodigo,
    resumenCodigo: entrada.resumenCodigo
  });
}

export function crearPayloadPersistenteNotificacionEliminacionAgente(entrada) {
  const notificacion = crearNotificacionEliminacionAdministrativaAgente(entrada);
  return congelarProfundo({
    estadoOperacion: notificacion.estadoOperacion,
    referenciaSujeto: notificacion.referenciaSujeto
  });
}

export function canonicalizarPayloadPersistenteNotificacionEliminacionAgente(
  entrada
) {
  return canonicalizarRfc8785(
    crearPayloadPersistenteNotificacionEliminacionAgente(entrada)
  );
}

export function calcularHuellaPayloadNotificacionEliminacionAgenteSha256(
  entrada
) {
  return createHash('sha256')
    .update(
      canonicalizarPayloadPersistenteNotificacionEliminacionAgente(entrada),
      'utf8'
    )
    .digest('hex');
}

function normalizarActor(entrada, ruta) {
  validarClavesExactas(
    entrada,
    PROPIEDADES_CONTRATO_ELIMINACION_ADMINISTRATIVA_AGENTE.ACTOR,
    ruta
  );
  if (entrada.estado !== 'activo' || entrada.decision !== 'autorizada') {
    fallar(
      'La fotografía solo admite actores activos y autorizados.',
      'actor_autorizacion_eliminacion_agente_invalido',
      ruta
    );
  }
  return congelarProfundo({
    usuarioId: idDecimalPositivo(entrada.usuarioId, `${ruta}.usuarioId`),
    estado: entrada.estado,
    decision: entrada.decision,
    scope: normalizarScope(entrada.scope, `${ruta}.scope`)
  });
}

function normalizarScope(entrada, ruta) {
  validarClavesExactas(
    entrada,
    PROPIEDADES_CONTRATO_ELIMINACION_ADMINISTRATIVA_AGENTE.SCOPE,
    ruta
  );
  const niveles = new Set(['portal', 'tenant', 'empresa', 'sitio']);
  if (!niveles.has(entrada.nivel)) {
    fallar('El nivel de scope no es válido.', 'scope_eliminacion_agente_invalido', `${ruta}.nivel`);
  }
  const scope = {
    nivel: entrada.nivel,
    tenantId: idDecimalOpcional(entrada.tenantId, `${ruta}.tenantId`),
    empresaId: idDecimalOpcional(entrada.empresaId, `${ruta}.empresaId`),
    sitioId: idDecimalOpcional(entrada.sitioId, `${ruta}.sitioId`)
  };
  const formaValida =
    (scope.nivel === 'portal' && scope.tenantId === null && scope.empresaId === null && scope.sitioId === null) ||
    (scope.nivel === 'tenant' && scope.tenantId !== null && scope.empresaId === null && scope.sitioId === null) ||
    (scope.nivel === 'empresa' && scope.tenantId !== null && scope.empresaId !== null && scope.sitioId === null) ||
    (scope.nivel === 'sitio' && scope.tenantId !== null && scope.empresaId !== null && scope.sitioId !== null);
  if (!formaValida) {
    fallar('La jerarquía del scope es incoherente.', 'scope_eliminacion_agente_invalido', ruta);
  }
  return congelarProfundo(scope);
}

function scopeAlcanza(actor, sujeto) {
  if (actor.nivel === 'portal') return true;
  if (actor.tenantId !== sujeto.tenantId) return false;
  if (actor.nivel === 'tenant') return true;
  if (actor.empresaId !== sujeto.empresaId) return false;
  if (actor.nivel === 'empresa') return true;
  return actor.sitioId === sujeto.sitioId;
}

function normalizarEmisorNotificacion(entrada) {
  validarClavesExactas(
    entrada,
    PROPIEDADES_CONTRATO_ELIMINACION_ADMINISTRATIVA_AGENTE.EMISOR_NOTIFICACION,
    'notificacion.emisor'
  );
  if (!TIPOS_EMISOR.has(entrada.tipo)) {
    fallar(
      'El tipo de emisor de notificación no existe.',
      'emisor_notificacion_eliminacion_agente_invalido',
      'notificacion.emisor.tipo'
    );
  }
  const actorRealId = idDecimalOpcional(
    entrada.actorRealId,
    'notificacion.emisor.actorRealId'
  );
  const actorEfectivoId = idDecimalOpcional(
    entrada.actorEfectivoId,
    'notificacion.emisor.actorEfectivoId'
  );
  const humano = entrada.tipo === EMISORES_NOTIFICACION_OPERACION_ADMINISTRATIVA.USUARIO;
  if (humano !== (actorRealId !== null && actorEfectivoId !== null)) {
    fallar(
      'Solo un emisor humano declara actor real y efectivo.',
      'emisor_notificacion_eliminacion_agente_invalido',
      'notificacion.emisor'
    );
  }
  return Object.freeze({ tipo: entrada.tipo, actorRealId, actorEfectivoId });
}

function normalizarReferenciaSujeto(entrada) {
  validarClavesExactas(
    entrada,
    PROPIEDADES_CONTRATO_ELIMINACION_ADMINISTRATIVA_AGENTE.REFERENCIA_SUJETO,
    'notificacion.referenciaSujeto'
  );
  exigirIgual(
    entrada.tipo,
    TIPOS_SUJETO_OPERACION_ADMINISTRATIVA.AGENTE,
    'tipo_sujeto_eliminacion_agente_invalido',
    'notificacion.referenciaSujeto.tipo'
  );
  return Object.freeze({
    tipo: entrada.tipo,
    id: idDecimalPositivo(entrada.id, 'notificacion.referenciaSujeto.id'),
    guid: guidAgente(entrada.guid, 'notificacion.referenciaSujeto.guid')
  });
}

function validarEstadoFase(estado, fase, rol) {
  if (!ESTADOS.has(estado) || !FASES.has(fase)) {
    fallar(
      'Estado o fase desconocidos.',
      'estado_fase_eliminacion_agente_invalido',
      `transicion.${rol}`
    );
  }
  const valida =
    (estado === ESTADOS_OPERACION_ADMINISTRATIVA.ENCOLADA && fase === FASES_ELIMINACION_ADMINISTRATIVA_AGENTE.PREPARACION) ||
    (estado === ESTADOS_OPERACION_ADMINISTRATIVA.EJECUTANDO && FASES_EJECUCION.includes(fase)) ||
    ([ESTADOS_OPERACION_ADMINISTRATIVA.COMPLETADA, ESTADOS_OPERACION_ADMINISTRATIVA.COMPLETADA_CON_ADVERTENCIAS].includes(estado) && fase === FASES_ELIMINACION_ADMINISTRATIVA_AGENTE.LIMPIEZA) ||
    (estado === ESTADOS_OPERACION_ADMINISTRATIVA.FALLIDA && FASES_EJECUCION.includes(fase));
  if (!valida) {
    fallar(
      'El estado y la fase no forman una posición válida del ciclo.',
      'estado_fase_eliminacion_agente_invalido',
      `transicion.${rol}`
    );
  }
}

function avanceEjecucionValido(entrada) {
  if (
    entrada.estadoAnterior !== ESTADOS_OPERACION_ADMINISTRATIVA.EJECUTANDO ||
    entrada.estadoNuevo !== ESTADOS_OPERACION_ADMINISTRATIVA.EJECUTANDO
  ) {
    return false;
  }
  const anterior = FASES_EJECUCION.indexOf(entrada.faseAnterior);
  return anterior >= 0 && FASES_EJECUCION[anterior + 1] === entrada.faseNueva;
}

function exigirPerfil(entrada, perfil, ruta) {
  if (entrada.perfil !== perfil || entrada.version !== VERSION_PERFIL) {
    fallar(
      `${ruta} no usa el perfil y versión esperados.`,
      'version_contrato_eliminacion_agente_incompatible',
      ruta
    );
  }
}

function fechaUtc(valor, campo) {
  try {
    return validarFechaUtcMilisegundos(valor, campo);
  } catch (causa) {
    const error = new ErrorContratoEliminacionAdministrativaAgente(causa.message, {
      codigo: 'fecha_eliminacion_agente_invalida',
      campo
    });
    error.cause = causa;
    throw error;
  }
}

function uuidV7(valor, campo) {
  try {
    return validarUuidV7Auditoria(valor, campo);
  } catch (causa) {
    const error = new ErrorContratoEliminacionAdministrativaAgente(causa.message, {
      codigo: 'uuidv7_eliminacion_agente_invalido',
      campo
    });
    error.cause = causa;
    throw error;
  }
}

function guidAgente(valor, campo) {
  if (
    typeof valor !== 'string' ||
    !PATRON_GUID_UUID_CANONICO.test(valor) ||
    !validarUuid(valor) ||
    obtenerVersionUuid(valor) !== 4
  ) {
    fallar(
      'El GUID del agente debe ser un UUIDv4 textual canónico en minúsculas.',
      'guid_eliminacion_agente_invalido',
      campo
    );
  }
  return valor;
}

function sha256Hex(valor, campo) {
  if (typeof valor !== 'string' || !PATRON_SHA256.test(valor)) {
    fallar(
      'La huella debe ser SHA-256 hexadecimal canónica.',
      'huella_eliminacion_agente_invalida',
      campo
    );
  }
  return valor;
}

function idDecimalPositivo(valor, campo) {
  const texto = String(valor ?? '');
  if (!/^[1-9][0-9]*$/u.test(texto)) {
    fallar('El id debe ser decimal positivo y canónico.', 'id_eliminacion_agente_invalido', campo);
  }
  return texto;
}

function idDecimalOpcional(valor, campo) {
  return valor === null ? null : idDecimalPositivo(valor, campo);
}

function enteroDecimalNoNegativo(valor, campo) {
  if (typeof valor !== 'string' || !PATRON_ENTERO_DECIMAL_NO_NEGATIVO.test(valor)) {
    fallar(
      'El conteo debe ser un entero decimal canónico no negativo.',
      'conteo_impacto_eliminacion_agente_invalido',
      campo
    );
  }
  return valor;
}

function validarClavesExactas(entrada, esperadas, ruta) {
  if (
    !entrada ||
    typeof entrada !== 'object' ||
    Array.isArray(entrada) ||
    Object.getPrototypeOf(entrada) !== Object.prototype
  ) {
    fallar(
      `${ruta} debe ser un objeto JSON plano.`,
      'forma_contrato_eliminacion_agente_invalida',
      ruta
    );
  }
  const actuales = Reflect.ownKeys(entrada);
  const permitidas = new Set(esperadas);
  for (const clave of actuales) {
    const descriptor = typeof clave === 'string'
      ? Object.getOwnPropertyDescriptor(entrada, clave)
      : null;
    if (
      typeof clave !== 'string' ||
      !permitidas.has(clave) ||
      descriptor?.enumerable !== true ||
      !Object.hasOwn(descriptor, 'value')
    ) {
      fallar(
        `${ruta} contiene una propiedad no admitida.`,
        'propiedad_contrato_eliminacion_agente_desconocida',
        typeof clave === 'string' ? `${ruta}.${clave}` : ruta
      );
    }
  }
  for (const esperada of esperadas) {
    if (!Object.hasOwn(entrada, esperada)) {
      fallar(
        `${ruta} no contiene todas las propiedades requeridas.`,
        'propiedad_contrato_eliminacion_agente_ausente',
        `${ruta}.${esperada}`
      );
    }
  }
}

function sanearMensajeTecnico(valor) {
  const saneado = valor
    .replace(/[\u0000-\u001f\u007f]+/gu, ' ')
    .replace(/\bbearer\s+[a-z0-9._~+/=-]+/giu, '[dato_sensible]')
    .replace(
      /\b(?:authorization|password|contraseña|cookie|set-cookie|csrf|secret|secreto|clave|api[_-]?key|access[_-]?token|refresh[_-]?token|token)\b["']?\s*[:=]?\s*["']?[^"',;\s}]+["']?/giu,
      '[dato_sensible]'
    )
    .replace(/\b(?:sa|sft1|sfrt1|sfop1|sfr1)_[A-Za-z0-9_-]{20,128}\b/gu, '[dato_sensible]')
    .replace(/\bhttps:\/\/[^/\s:@]+:[^/\s@]+@/giu, 'https://[dato_sensible]@')
    .replace(/\s+/gu, ' ')
    .trim()
    .slice(0, 512);
  return saneado || 'Error técnico de eliminación administrativa.';
}

function exigirIgual(actual, esperado, codigo, campo) {
  if (actual !== esperado) {
    fallar(`${campo} no pertenece al contrato cerrado.`, codigo, campo);
  }
}

function congelarProfundo(valor) {
  if (!valor || typeof valor !== 'object' || Object.isFrozen(valor)) return valor;
  for (const descendiente of Object.values(valor)) congelarProfundo(descendiente);
  return Object.freeze(valor);
}

function fallar(mensaje, codigo, campo) {
  throw new ErrorContratoEliminacionAdministrativaAgente(mensaje, { codigo, campo });
}

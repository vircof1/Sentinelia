import { createHash } from 'node:crypto';

import {
  canonicalizarRfc8785,
  validarFechaUtcMilisegundos
} from '../../auditoria/src/PerfilJcsAuditoria.js';
import { validarUuidV7Auditoria } from '../../auditoria/src/UuidV7Auditoria.js';
import {
  CAUSAS_REINTENTABLES_INFRAESTRUCTURA_OPERACION_ADMINISTRATIVA,
  CAUSAS_TERMINALES_INFRAESTRUCTURA_OPERACION_ADMINISTRATIVA
} from '../../coordinacion-durable/src/DiagnosticosOperacionesAdministrativas.js';

export const PERFIL_CONTRATO_ELIMINACION_ADMINISTRATIVA_ORGANIZACION =
  'sentinelia-eliminacion-administrativa-organizacion-v1';
export const VERSION_CONTRATO_ELIMINACION_ADMINISTRATIVA_ORGANIZACION = 1;
export const PERFIL_FOTOGRAFIA_AUTORIZACION_ELIMINACION_ORGANIZACION =
  'sentinelia-eliminacion-organizacion-autorizacion-v1';
export const PERFIL_RESERVA_ELIMINACION_ORGANIZACION =
  'sentinelia-eliminacion-organizacion-reserva-v1';
export const PERFIL_RESUMEN_IMPACTO_ELIMINACION_ORGANIZACION =
  'sentinelia-eliminacion-organizacion-impacto-v1';
export const PERFIL_FOTOGRAFIA_FINAL_ELIMINACION_ORGANIZACION =
  'sentinelia-eliminacion-organizacion-fotografia-final-v1';
export const PERFIL_RESULTADO_ELIMINACION_ORGANIZACION =
  'sentinelia-eliminacion-organizacion-resultado-v1';
export const PERFIL_NOTIFICACION_OPERACION_ADMINISTRATIVA =
  'sentinelia-notificacion-operacion-administrativa-v1';

export const TIPOS_OPERACION_ADMINISTRATIVA_ORGANIZACION = Object.freeze({
  ELIMINAR_ORGANIZACION: 'eliminar_organizacion'
});

export const TIPOS_SUJETO_ELIMINACION_ORGANIZACION = Object.freeze({
  TENANT: 'tenant',
  EMPRESA: 'empresa',
  SITIO: 'sitio'
});

export const ESTADOS_OPERACION_ADMINISTRATIVA_ORGANIZACION = Object.freeze({
  ENCOLADA: 'encolada',
  EJECUTANDO: 'ejecutando',
  COMPLETADA: 'completada',
  COMPLETADA_CON_ADVERTENCIAS: 'completada_con_advertencias',
  FALLIDA: 'fallida'
});

export const FASES_ELIMINACION_ADMINISTRATIVA_ORGANIZACION = Object.freeze({
  PREPARACION: 'preparacion',
  VALIDACION: 'validacion',
  ELIMINACION: 'eliminacion',
  COMMIT: 'commit',
  LIMPIEZA: 'limpieza'
});

export const CAPACIDADES_ELIMINACION_ADMINISTRATIVA_ORGANIZACION =
  Object.freeze({
    cancelable: false,
    progreso: 'fases_semanticas',
    porcentaje: false
  });

export const CAUSAS_REINTENTABLES_ELIMINACION_ORGANIZACION = Object.freeze([
  ...CAUSAS_REINTENTABLES_INFRAESTRUCTURA_OPERACION_ADMINISTRATIVA
]);

export const CAUSAS_TERMINALES_ELIMINACION_ORGANIZACION = Object.freeze([
  'organizacion_eliminacion_sujeto_ausente',
  'organizacion_eliminacion_actor_incluido',
  'organizacion_eliminacion_scope_final_no_autorizado',
  'organizacion_eliminacion_impacto_no_seguro',
  ...CAUSAS_TERMINALES_INFRAESTRUCTURA_OPERACION_ADMINISTRATIVA
]);

export const RESPUESTAS_HTTP_ACEPTACION_ELIMINACION_ORGANIZACION =
  congelarProfundo({
    organizacion_eliminacion_encolada: { statusHttp: 202, satisfactoria: true },
    organizacion_eliminacion_repetida: { statusHttp: 202, satisfactoria: true },
    organizacion_eliminacion_no_autorizada: { statusHttp: 404, satisfactoria: false },
    organizacion_eliminacion_no_encontrada: { statusHttp: 404, satisfactoria: false },
    organizacion_eliminacion_confirmacion_invalida: { statusHttp: 400, satisfactoria: false },
    organizacion_eliminacion_confirmacion_expirada: { statusHttp: 410, satisfactoria: false },
    organizacion_eliminacion_actor_incluido: { statusHttp: 409, satisfactoria: false },
    organizacion_eliminacion_operacion_en_curso: { statusHttp: 409, satisfactoria: false },
    organizacion_eliminacion_clave_divergente: { statusHttp: 409, satisfactoria: false }
  });

export const CLASES_IMPACTO_ELIMINACION_ORGANIZACION = Object.freeze({
  PREVIO: 'previo',
  FINAL: 'final'
});

export const PRECISIONES_IMPACTO_ELIMINACION_ORGANIZACION = Object.freeze({
  EXACTA: 'exacta',
  ESTIMADA: 'estimada',
  MINIMA: 'minima'
});

export const CATEGORIAS_IMPACTO_ELIMINACION_ORGANIZACION = Object.freeze([
  'raiz',
  'empresas',
  'sitios',
  'usuarios',
  'agentes',
  'reglas',
  'monitores',
  'sesiones',
  'identidades_federadas',
  'referencias_restrict',
  'audiencia_correo_visible',
  'audiencia_correo_restringida',
  'triggers_correo_supervivientes_desactivados',
  'senales',
  'observaciones',
  'pol',
  'eventos',
  'ejecuciones_trigger',
  'correo_aceptado_preservadas',
  'concesiones_ddns',
  'intenciones_ddns_aceptadas',
  'causas_pol_ddns_pendientes',
  'obligaciones_postcommit'
]);

export const TIPOS_OBLIGACION_RESULTADO_ELIMINACION_ORGANIZACION =
  Object.freeze([
    'retirar_sesion_redis',
    'retirar_perfil_servidor_redis',
    'retirar_agenda_servidor_redis',
    'invalidar_catalogo_monitores',
    'invalidar_sesiones_usuarios_redis',
    'retirar_estructura_organizacion_redis',
    'publicar_invalidacion_portal'
  ]);

export const TIPOS_NOTIFICACION_ELIMINACION_ORGANIZACION = Object.freeze({
  ENCOLADA: 'eliminacion_encolada',
  ELIMINADA: 'organizacion_eliminada',
  FALLIDA: 'eliminacion_fallida',
  LIMPIEZA_COMPLETADA: 'limpieza_tecnica_completada'
});

export const EMISORES_NOTIFICACION_OPERACION_ADMINISTRATIVA = Object.freeze({
  USUARIO: 'usuario',
  SISTEMA: 'sistema',
  PROCESO: 'proceso'
});

export const CONTRATOS_NOTIFICACION_ELIMINACION_ORGANIZACION =
  congelarProfundo({
    eliminacion_encolada: {
      estado: ESTADOS_OPERACION_ADMINISTRATIVA_ORGANIZACION.ENCOLADA,
      emisor: EMISORES_NOTIFICACION_OPERACION_ADMINISTRATIVA.USUARIO,
      exigeFotografiaFinal: false,
      tituloCodigo: 'eliminacion_organizacion_encolada_titulo',
      resumenCodigo: 'eliminacion_organizacion_encolada_resumen'
    },
    organizacion_eliminada: {
      estado: ESTADOS_OPERACION_ADMINISTRATIVA_ORGANIZACION.COMPLETADA,
      emisor: EMISORES_NOTIFICACION_OPERACION_ADMINISTRATIVA.PROCESO,
      exigeFotografiaFinal: true,
      tituloCodigo: 'organizacion_eliminada_titulo',
      resumenCodigo: 'organizacion_eliminada_resumen'
    },
    eliminacion_fallida: {
      estado: ESTADOS_OPERACION_ADMINISTRATIVA_ORGANIZACION.FALLIDA,
      emisor: EMISORES_NOTIFICACION_OPERACION_ADMINISTRATIVA.PROCESO,
      exigeFotografiaFinal: false,
      tituloCodigo: 'eliminacion_organizacion_fallida_titulo',
      resumenCodigo: 'eliminacion_organizacion_fallida_resumen'
    },
    limpieza_tecnica_completada: {
      estado: ESTADOS_OPERACION_ADMINISTRATIVA_ORGANIZACION.COMPLETADA,
      emisor: EMISORES_NOTIFICACION_OPERACION_ADMINISTRATIVA.PROCESO,
      exigeFotografiaFinal: true,
      tituloCodigo: 'limpieza_tecnica_completada_titulo',
      resumenCodigo: 'limpieza_tecnica_completada_resumen'
    }
  });

export const PROPIEDADES_CONTRATO_ELIMINACION_ADMINISTRATIVA_ORGANIZACION =
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
      'fotografiaAutorizacion'
    ],
    IDENTIDADES: ['operacionId', 'claveOperacion', 'correlacionId', 'eventoId'],
    SUJETO: ['tipo', 'id', 'scope'],
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
    RESERVA: ['perfil', 'version', 'tipoRecurso', 'recursoId'],
    CONFIRMACION: ['sujeto', 'frase'],
    IMPACTO: ['perfil', 'version', 'clase', 'conteos'],
    CONTEO_IMPACTO: ['categoria', 'cantidad', 'precision'],
    FOTOGRAFIA_FINAL: [
      'perfil',
      'version',
      'tipo',
      'id',
      'nombre',
      'scopeFinal',
      'capturadaEnUtc'
    ],
    CRONOLOGIA: ['aceptadaEnUtc', 'efectivoEnUtc', 'registradoEnUtc'],
    OBLIGACION: ['obligacionId', 'tipo', 'estado'],
    RESULTADO: [
      'perfil',
      'version',
      'resultado',
      'estado',
      'sujeto',
      'fotografiaFinal',
      'impactoFinal',
      'cronologia',
      'eventoAuditoriaId',
      'obligaciones'
    ],
    TRANSICION: [
      'estadoAnterior',
      'faseAnterior',
      'estadoNuevo',
      'faseNueva',
      'causaCodigo'
    ],
    DIAGNOSTICO: ['codigo', 'mensaje'],
    FALLO_TERMINAL: ['fase', 'codigo', 'mensaje'],
    EMISOR_NOTIFICACION: ['tipo', 'actorRealId', 'actorEfectivoId'],
    REFERENCIA_SUJETO: ['tipo', 'id', 'fotografiaFinal'],
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
    REPETICION: ['existente', 'candidata']
  });

const VERSION_PERFIL = 1;
const PATRON_ENTERO_DECIMAL_NO_NEGATIVO = /^(0|[1-9][0-9]*)$/u;
const TIPOS_SUJETO = new Set(Object.values(TIPOS_SUJETO_ELIMINACION_ORGANIZACION));
const ESTADOS = new Set(Object.values(ESTADOS_OPERACION_ADMINISTRATIVA_ORGANIZACION));
const FASES = new Set(Object.values(FASES_ELIMINACION_ADMINISTRATIVA_ORGANIZACION));
const CAUSAS_REINTENTABLES = new Set(CAUSAS_REINTENTABLES_ELIMINACION_ORGANIZACION);
const CAUSAS_TERMINALES = new Set(CAUSAS_TERMINALES_ELIMINACION_ORGANIZACION);
const CATEGORIAS_IMPACTO = new Set(CATEGORIAS_IMPACTO_ELIMINACION_ORGANIZACION);
const PRECISIONES_IMPACTO = new Set(
  Object.values(PRECISIONES_IMPACTO_ELIMINACION_ORGANIZACION)
);
const TIPOS_OBLIGACION = new Set(TIPOS_OBLIGACION_RESULTADO_ELIMINACION_ORGANIZACION);
const CATEGORIAS_HISTORICAS = new Set([
  'correo_aceptado_preservadas',
  'senales',
  'observaciones',
  'pol',
  'eventos',
  'ejecuciones_trigger'
]);
const FASES_EJECUCION = Object.freeze([
  FASES_ELIMINACION_ADMINISTRATIVA_ORGANIZACION.PREPARACION,
  FASES_ELIMINACION_ADMINISTRATIVA_ORGANIZACION.VALIDACION,
  FASES_ELIMINACION_ADMINISTRATIVA_ORGANIZACION.ELIMINACION,
  FASES_ELIMINACION_ADMINISTRATIVA_ORGANIZACION.COMMIT
]);

export class ErrorContratoEliminacionAdministrativaOrganizacion extends Error {
  constructor(
    mensaje,
    { codigo = 'contrato_eliminacion_organizacion_invalido', campo = null } = {}
  ) {
    super(mensaje);
    this.name = 'ErrorContratoEliminacionAdministrativaOrganizacion';
    this.codigo = codigo;
    this.campo = campo;
  }
}

export function crearIdentidadesEliminacionAdministrativaOrganizacion(entrada) {
  validarClavesExactas(entrada, propiedades('IDENTIDADES'), 'identidades');
  const identidades = {
    operacionId: uuidV7(entrada.operacionId, 'identidades.operacionId'),
    claveOperacion: uuidV7(entrada.claveOperacion, 'identidades.claveOperacion'),
    correlacionId: uuidV7(entrada.correlacionId, 'identidades.correlacionId'),
    eventoId: uuidV7(entrada.eventoId, 'identidades.eventoId')
  };
  if (new Set(Object.values(identidades)).size !== 4) {
    fallar(
      'Las identidades causales deben ser distintas.',
      'identidad_eliminacion_organizacion_reutilizada',
      'identidades'
    );
  }
  return congelarProfundo(identidades);
}

export function crearSujetoEliminacionAdministrativaOrganizacion(entrada) {
  validarClavesExactas(entrada, propiedades('SUJETO'), 'sujeto');
  if (!TIPOS_SUJETO.has(entrada.tipo)) {
    fallar(
      'La raíz organizativa debe ser tenant, empresa o sitio.',
      'tipo_sujeto_eliminacion_organizacion_invalido',
      'sujeto.tipo'
    );
  }
  const sujeto = {
    tipo: entrada.tipo,
    id: idDecimalPositivo(entrada.id, 'sujeto.id'),
    scope: normalizarScope(entrada.scope, 'sujeto.scope')
  };
  validarIdentidadRaizEnScope(sujeto);
  return congelarProfundo(sujeto);
}

export function crearFotografiaAutorizacionEliminacionOrganizacion(entrada) {
  validarClavesExactas(entrada, propiedades('AUTORIZACION'), 'fotografiaAutorizacion');
  exigirPerfil(
    entrada,
    PERFIL_FOTOGRAFIA_AUTORIZACION_ELIMINACION_ORGANIZACION,
    'fotografiaAutorizacion'
  );
  exigirIgual(
    entrada.decision,
    'autorizada',
    'decision_autorizacion_eliminacion_organizacion_invalida',
    'fotografiaAutorizacion.decision'
  );
  const actorReal = normalizarActor(
    entrada.actorReal,
    'fotografiaAutorizacion.actorReal'
  );
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
      'El buzón destinatario debe pertenecer al actor real.',
      'destinatario_eliminacion_organizacion_invalido',
      'fotografiaAutorizacion.destinatarioUsuarioId'
    );
  }
  if (
    actorReal.usuarioId === actorEfectivo.usuarioId &&
    canonicalizarRfc8785(actorReal) !== canonicalizarRfc8785(actorEfectivo)
  ) {
    fallar(
      'Una actuación directa no admite dos fotografías para el mismo usuario.',
      'actores_eliminacion_organizacion_incoherentes',
      'fotografiaAutorizacion'
    );
  }
  return congelarProfundo({
    perfil: entrada.perfil,
    version: entrada.version,
    decision: entrada.decision,
    aceptadaEnUtc: fechaUtc(
      entrada.aceptadaEnUtc,
      'fotografiaAutorizacion.aceptadaEnUtc'
    ),
    actorReal,
    actorEfectivo,
    destinatarioUsuarioId
  });
}

export function crearComandoEliminacionAdministrativaOrganizacion(entrada) {
  validarClavesExactas(entrada, propiedades('COMANDO'), 'comando');
  exigirPerfil(
    entrada,
    PERFIL_CONTRATO_ELIMINACION_ADMINISTRATIVA_ORGANIZACION,
    'comando'
  );
  exigirIgual(
    entrada.tipoOperacion,
    TIPOS_OPERACION_ADMINISTRATIVA_ORGANIZACION.ELIMINAR_ORGANIZACION,
    'tipo_operacion_eliminacion_organizacion_invalido',
    'comando.tipoOperacion'
  );
  exigirIgual(
    entrada.estado,
    ESTADOS_OPERACION_ADMINISTRATIVA_ORGANIZACION.ENCOLADA,
    'estado_inicial_eliminacion_organizacion_invalido',
    'comando.estado'
  );
  exigirIgual(
    entrada.fase,
    FASES_ELIMINACION_ADMINISTRATIVA_ORGANIZACION.PREPARACION,
    'fase_inicial_eliminacion_organizacion_invalida',
    'comando.fase'
  );
  exigirIgual(
    entrada.cancelable,
    false,
    'cancelacion_eliminacion_organizacion_no_admitida',
    'comando.cancelable'
  );
  exigirIgual(
    entrada.progreso,
    'fases_semanticas',
    'progreso_eliminacion_organizacion_invalido',
    'comando.progreso'
  );
  const identidades = crearIdentidadesEliminacionAdministrativaOrganizacion(
    entrada.identidades
  );
  const sujeto = crearSujetoEliminacionAdministrativaOrganizacion(entrada.sujeto);
  const fotografiaAutorizacion =
    crearFotografiaAutorizacionEliminacionOrganizacion(
      entrada.fotografiaAutorizacion
    );
  for (const [rol, actor] of [
    ['actorReal', fotografiaAutorizacion.actorReal],
    ['actorEfectivo', fotografiaAutorizacion.actorEfectivo]
  ]) {
    if (!scopeAlcanza(actor.scope, sujeto.scope)) {
      fallar(
        `El ${rol} no alcanza la raíz organizativa.`,
        'scope_autorizacion_eliminacion_organizacion_invalido',
        `comando.fotografiaAutorizacion.${rol}.scope`
      );
    }
    if (scopePerteneceARaiz(actor.scope, sujeto)) {
      fallar(
        `El ${rol} pertenece al agregado que intenta eliminar.`,
        'organizacion_eliminacion_actor_incluido',
        `comando.fotografiaAutorizacion.${rol}.scope`
      );
    }
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
    fotografiaAutorizacion
  });
}

export function canonicalizarComandoEliminacionAdministrativaOrganizacion(
  entrada
) {
  return canonicalizarRfc8785(
    crearComandoEliminacionAdministrativaOrganizacion(entrada)
  );
}

export function calcularHuellaIntencionEliminacionOrganizacionSha256(entrada) {
  return createHash('sha256')
    .update(canonicalizarComandoEliminacionAdministrativaOrganizacion(entrada), 'utf8')
    .digest('hex');
}

export function clasificarRepeticionEliminacionAdministrativaOrganizacion(
  entrada
) {
  validarClavesExactas(entrada, propiedades('REPETICION'), 'repeticion');
  const existente = crearComandoEliminacionAdministrativaOrganizacion(
    entrada.existente
  );
  const candidata = crearComandoEliminacionAdministrativaOrganizacion(
    entrada.candidata
  );
  if (existente.identidades.claveOperacion !== candidata.identidades.claveOperacion) {
    return Object.freeze({
      resultado: 'nueva',
      operacionId: candidata.identidades.operacionId
    });
  }
  if (canonicalizarRfc8785(existente) !== canonicalizarRfc8785(candidata)) {
    fallar(
      'La clave de operación protege otra intención.',
      'clave_operacion_eliminacion_organizacion_reutilizada',
      'repeticion.candidata.identidades.claveOperacion'
    );
  }
  return Object.freeze({
    resultado: 'repetida',
    operacionId: existente.identidades.operacionId
  });
}

export function crearReservaEliminacionAdministrativaOrganizacion(entrada) {
  validarClavesExactas(entrada, propiedades('RESERVA'), 'reserva');
  exigirPerfil(
    entrada,
    PERFIL_RESERVA_ELIMINACION_ORGANIZACION,
    'reserva'
  );
  if (!TIPOS_SUJETO.has(entrada.tipoRecurso)) {
    fallar(
      'La reserva debe reclamar una raíz organizativa.',
      'tipo_reserva_eliminacion_organizacion_invalido',
      'reserva.tipoRecurso'
    );
  }
  return Object.freeze({
    perfil: entrada.perfil,
    version: entrada.version,
    tipoRecurso: entrada.tipoRecurso,
    recursoId: idDecimalPositivo(entrada.recursoId, 'reserva.recursoId')
  });
}

export function crearReservaDesdeComandoEliminacionOrganizacion(entrada) {
  const comando = crearComandoEliminacionAdministrativaOrganizacion(entrada);
  return crearReservaEliminacionAdministrativaOrganizacion({
    perfil: PERFIL_RESERVA_ELIMINACION_ORGANIZACION,
    version: VERSION_PERFIL,
    tipoRecurso: comando.sujeto.tipo,
    recursoId: comando.sujeto.id
  });
}

export function crearFraseConfirmacionEliminacionOrganizacion(sujeto) {
  const normalizado = crearSujetoEliminacionAdministrativaOrganizacion(sujeto);
  return `ELIMINAR ${normalizado.tipo} ${normalizado.id}`;
}

export function validarFraseConfirmacionEliminacionOrganizacion(entrada) {
  validarClavesExactas(entrada, propiedades('CONFIRMACION'), 'confirmacion');
  if (
    typeof entrada.frase !== 'string' ||
    entrada.frase !== crearFraseConfirmacionEliminacionOrganizacion(entrada.sujeto)
  ) {
    fallar(
      'La frase de confirmación no coincide exactamente con tipo e id.',
      'confirmacion_eliminacion_organizacion_invalida',
      'confirmacion.frase'
    );
  }
  return entrada.frase;
}

export function crearResumenImpactoEliminacionOrganizacion(entrada) {
  validarClavesExactas(entrada, propiedades('IMPACTO'), 'impacto');
  exigirPerfil(
    entrada,
    PERFIL_RESUMEN_IMPACTO_ELIMINACION_ORGANIZACION,
    'impacto'
  );
  if (!Object.values(CLASES_IMPACTO_ELIMINACION_ORGANIZACION).includes(entrada.clase)) {
    fallar(
      'La clase de impacto debe ser previa o final.',
      'clase_impacto_eliminacion_organizacion_invalida',
      'impacto.clase'
    );
  }
  if (!Array.isArray(entrada.conteos) || entrada.conteos.length === 0) {
    fallar(
      'El impacto debe declarar al menos la raíz.',
      'resumen_impacto_eliminacion_organizacion_invalido',
      'impacto.conteos'
    );
  }
  const categorias = new Set();
  const conteos = entrada.conteos.map((conteo, indice) => {
    const ruta = `impacto.conteos[${indice}]`;
    validarClavesExactas(conteo, propiedades('CONTEO_IMPACTO'), ruta);
    if (!CATEGORIAS_IMPACTO.has(conteo.categoria) || categorias.has(conteo.categoria)) {
      fallar(
        'Las categorías de impacto deben ser cerradas y únicas.',
        'categoria_impacto_eliminacion_organizacion_invalida',
        `${ruta}.categoria`
      );
    }
    categorias.add(conteo.categoria);
    if (!PRECISIONES_IMPACTO.has(conteo.precision)) {
      fallar(
        'La precisión de impacto no pertenece al contrato.',
        'precision_impacto_eliminacion_organizacion_invalida',
        `${ruta}.precision`
      );
    }
    if (
      entrada.clase === CLASES_IMPACTO_ELIMINACION_ORGANIZACION.FINAL &&
      CATEGORIAS_HISTORICAS.has(conteo.categoria)
    ) {
      fallar(
        'El impacto final no enumera colecciones históricas acumulativas.',
        'categoria_impacto_final_eliminacion_organizacion_invalida',
        `${ruta}.categoria`
      );
    }
    if (
      conteo.precision !== PRECISIONES_IMPACTO_ELIMINACION_ORGANIZACION.EXACTA &&
      (
        entrada.clase === CLASES_IMPACTO_ELIMINACION_ORGANIZACION.FINAL ||
        !CATEGORIAS_HISTORICAS.has(conteo.categoria)
      )
    ) {
      fallar(
        'Solo la vista previa de históricos admite estimaciones.',
        'precision_impacto_eliminacion_organizacion_invalida',
        `${ruta}.precision`
      );
    }
    return {
      categoria: conteo.categoria,
      cantidad: enteroDecimalNoNegativo(conteo.cantidad, `${ruta}.cantidad`),
      precision: conteo.precision
    };
  }).sort((a, b) => a.categoria.localeCompare(b.categoria));
  const raiz = conteos.find(({ categoria }) => categoria === 'raiz');
  if (
    !raiz ||
    raiz.cantidad !== '1' ||
    raiz.precision !== PRECISIONES_IMPACTO_ELIMINACION_ORGANIZACION.EXACTA
  ) {
    fallar(
      'El impacto debe declarar exactamente una raíz.',
      'raiz_impacto_eliminacion_organizacion_invalida',
      'impacto.conteos'
    );
  }
  return congelarProfundo({
    perfil: entrada.perfil,
    version: entrada.version,
    clase: entrada.clase,
    conteos
  });
}

export function crearFotografiaFinalEliminacionOrganizacion(entrada) {
  validarClavesExactas(entrada, propiedades('FOTOGRAFIA_FINAL'), 'fotografiaFinal');
  exigirPerfil(
    entrada,
    PERFIL_FOTOGRAFIA_FINAL_ELIMINACION_ORGANIZACION,
    'fotografiaFinal'
  );
  if (!TIPOS_SUJETO.has(entrada.tipo)) {
    fallar(
      'La fotografía debe identificar tenant, empresa o sitio.',
      'tipo_sujeto_eliminacion_organizacion_invalido',
      'fotografiaFinal.tipo'
    );
  }
  const id = idDecimalPositivo(entrada.id, 'fotografiaFinal.id');
  const scopeFinal = normalizarScope(entrada.scopeFinal, 'fotografiaFinal.scopeFinal');
  validarRaizEnScope(
    { tipo: entrada.tipo, id, scope: scopeFinal },
    'scope_fotografia_final_eliminacion_organizacion_invalido',
    'fotografiaFinal.scopeFinal'
  );
  return congelarProfundo({
    perfil: entrada.perfil,
    version: entrada.version,
    tipo: entrada.tipo,
    id,
    nombre: nombreOrganizacion(entrada.nombre, 'fotografiaFinal.nombre'),
    scopeFinal,
    capturadaEnUtc: fechaUtc(
      entrada.capturadaEnUtc,
      'fotografiaFinal.capturadaEnUtc'
    )
  });
}

export function crearCronologiaEliminacionOrganizacion(entrada) {
  validarClavesExactas(entrada, propiedades('CRONOLOGIA'), 'cronologia');
  const cronologia = {
    aceptadaEnUtc: fechaUtc(entrada.aceptadaEnUtc, 'cronologia.aceptadaEnUtc'),
    efectivoEnUtc: fechaUtc(entrada.efectivoEnUtc, 'cronologia.efectivoEnUtc'),
    registradoEnUtc: fechaUtc(entrada.registradoEnUtc, 'cronologia.registradoEnUtc')
  };
  if (
    Date.parse(cronologia.aceptadaEnUtc) > Date.parse(cronologia.efectivoEnUtc) ||
    Date.parse(cronologia.efectivoEnUtc) > Date.parse(cronologia.registradoEnUtc)
  ) {
    fallar(
      'Aceptación, efecto y registro deben respetar su orden causal.',
      'cronologia_eliminacion_organizacion_invalida',
      'cronologia'
    );
  }
  return Object.freeze(cronologia);
}

export function crearResultadoEliminacionAdministrativaOrganizacion(entrada) {
  validarClavesExactas(entrada, propiedades('RESULTADO'), 'resultado');
  exigirPerfil(
    entrada,
    PERFIL_RESULTADO_ELIMINACION_ORGANIZACION,
    'resultado'
  );
  exigirIgual(
    entrada.resultado,
    'eliminada',
    'resultado_eliminacion_organizacion_invalido',
    'resultado.resultado'
  );
  exigirIgual(
    entrada.estado,
    ESTADOS_OPERACION_ADMINISTRATIVA_ORGANIZACION.COMPLETADA,
    'estado_resultado_eliminacion_organizacion_invalido',
    'resultado.estado'
  );
  const sujeto = crearSujetoEliminacionAdministrativaOrganizacion(entrada.sujeto);
  const fotografiaFinal = crearFotografiaFinalEliminacionOrganizacion(
    entrada.fotografiaFinal
  );
  if (identidadSujeto(sujeto) !== identidadSujeto(fotografiaFinal)) {
    fallar(
      'El resultado y la fotografía final pertenecen a raíces distintas.',
      'sujeto_resultado_eliminacion_organizacion_incoherente',
      'resultado.fotografiaFinal'
    );
  }
  const impactoFinal = crearResumenImpactoEliminacionOrganizacion(
    entrada.impactoFinal
  );
  exigirIgual(
    impactoFinal.clase,
    CLASES_IMPACTO_ELIMINACION_ORGANIZACION.FINAL,
    'clase_resultado_eliminacion_organizacion_invalida',
    'resultado.impactoFinal.clase'
  );
  const cronologia = crearCronologiaEliminacionOrganizacion(entrada.cronologia);
  if (
    Date.parse(fotografiaFinal.capturadaEnUtc) >
    Date.parse(cronologia.efectivoEnUtc)
  ) {
    fallar(
      'La fotografía final debe preceder al efecto destructivo.',
      'cronologia_eliminacion_organizacion_invalida',
      'resultado.fotografiaFinal.capturadaEnUtc'
    );
  }
  const eventoAuditoriaId = uuidV7(
    entrada.eventoAuditoriaId,
    'resultado.eventoAuditoriaId'
  );
  if (!Array.isArray(entrada.obligaciones)) {
    fallar(
      'Las obligaciones del resultado deben formar una lista.',
      'obligaciones_resultado_eliminacion_organizacion_invalidas',
      'resultado.obligaciones'
    );
  }
  const ids = new Set([eventoAuditoriaId]);
  const obligaciones = entrada.obligaciones.map((obligacion, indice) => {
    const ruta = `resultado.obligaciones[${indice}]`;
    validarClavesExactas(obligacion, propiedades('OBLIGACION'), ruta);
    const obligacionId = uuidV7(obligacion.obligacionId, `${ruta}.obligacionId`);
    if (ids.has(obligacionId)) {
      fallar(
        'Las identidades del resultado deben ser distintas.',
        'identidad_eliminacion_organizacion_reutilizada',
        `${ruta}.obligacionId`
      );
    }
    ids.add(obligacionId);
    if (!TIPOS_OBLIGACION.has(obligacion.tipo) || obligacion.estado !== 'pendiente') {
      fallar(
        'La obligación no pertenece al contrato de resultado.',
        'obligacion_eliminacion_organizacion_invalida',
        ruta
      );
    }
    return {
      obligacionId,
      tipo: obligacion.tipo,
      estado: obligacion.estado
    };
  });
  return congelarProfundo({
    perfil: entrada.perfil,
    version: entrada.version,
    resultado: entrada.resultado,
    estado: entrada.estado,
    sujeto,
    fotografiaFinal,
    impactoFinal,
    cronologia,
    eventoAuditoriaId,
    obligaciones
  });
}

export function validarTransicionEliminacionAdministrativaOrganizacion(entrada) {
  validarClavesExactas(entrada, propiedades('TRANSICION'), 'transicion');
  validarEstadoFase(entrada.estadoAnterior, entrada.faseAnterior, 'anterior');
  validarEstadoFase(entrada.estadoNuevo, entrada.faseNueva, 'nuevo');
  const causa = entrada.causaCodigo;
  if (causa !== null && typeof causa !== 'string') {
    fallar(
      'La causa debe ser nula o un código cerrado.',
      'causa_transicion_eliminacion_organizacion_invalida',
      'transicion.causaCodigo'
    );
  }
  const E = ESTADOS_OPERACION_ADMINISTRATIVA_ORGANIZACION;
  const F = FASES_ELIMINACION_ADMINISTRATIVA_ORGANIZACION;
  const inicio =
    entrada.estadoAnterior === E.ENCOLADA &&
    entrada.faseAnterior === F.PREPARACION &&
    entrada.estadoNuevo === E.EJECUTANDO &&
    entrada.faseNueva === F.PREPARACION &&
    causa === null;
  const avance = avanceEjecucionValido(entrada) && causa === null;
  const reintento =
    entrada.estadoAnterior === E.EJECUTANDO &&
    FASES_EJECUCION.includes(entrada.faseAnterior) &&
    entrada.estadoNuevo === E.ENCOLADA &&
    entrada.faseNueva === F.PREPARACION &&
    CAUSAS_REINTENTABLES.has(causa);
  const fallo =
    entrada.estadoAnterior === E.EJECUTANDO &&
    FASES_EJECUCION.includes(entrada.faseAnterior) &&
    entrada.estadoNuevo === E.FALLIDA &&
    entrada.faseNueva === entrada.faseAnterior &&
    CAUSAS_TERMINALES.has(causa);
  const completada =
    entrada.estadoAnterior === E.EJECUTANDO &&
    entrada.faseAnterior === F.COMMIT &&
    entrada.estadoNuevo === E.COMPLETADA &&
    entrada.faseNueva === F.LIMPIEZA &&
    causa === null;
  if (!(inicio || avance || reintento || fallo || completada)) {
    fallar(
      'La transición no pertenece al ciclo organizativo cerrado.',
      'transicion_eliminacion_organizacion_invalida',
      'transicion'
    );
  }
  return congelarProfundo({ ...entrada });
}

export function crearDiagnosticoErrorEliminacionOrganizacion(entrada) {
  validarClavesExactas(entrada, propiedades('DIAGNOSTICO'), 'diagnostico');
  const codigo = String(entrada.codigo || '');
  const reintentable = CAUSAS_REINTENTABLES.has(codigo);
  if (!reintentable && !CAUSAS_TERMINALES.has(codigo)) {
    fallar(
      'El diagnóstico no pertenece al catálogo cerrado.',
      'diagnostico_eliminacion_organizacion_invalido',
      'diagnostico.codigo'
    );
  }
  if (typeof entrada.mensaje !== 'string') {
    fallar(
      'El mensaje técnico debe ser texto.',
      'diagnostico_eliminacion_organizacion_invalido',
      'diagnostico.mensaje'
    );
  }
  return Object.freeze({
    codigo,
    reintentable,
    mensaje: sanearMensajeTecnico(entrada.mensaje)
  });
}

export function crearFalloTerminalEliminacionAdministrativaOrganizacion(
  entrada
) {
  validarClavesExactas(entrada, propiedades('FALLO_TERMINAL'), 'fallo');
  if (!FASES_EJECUCION.includes(entrada.fase)) {
    fallar(
      'La fase del fallo debe pertenecer a la frontera precommit.',
      'fase_fallo_eliminacion_organizacion_invalida',
      'fallo.fase'
    );
  }
  const diagnostico = crearDiagnosticoErrorEliminacionOrganizacion({
    codigo: entrada.codigo,
    mensaje: entrada.mensaje
  });
  if (diagnostico.reintentable) {
    fallar(
      'Una causa reintentable no puede cerrar la operación.',
      'fallo_terminal_eliminacion_organizacion_invalido',
      'fallo.codigo'
    );
  }
  return congelarProfundo({
    perfil: PERFIL_RESULTADO_ELIMINACION_ORGANIZACION,
    version: VERSION_PERFIL,
    estado: ESTADOS_OPERACION_ADMINISTRATIVA_ORGANIZACION.FALLIDA,
    fase: entrada.fase,
    error: diagnostico
  });
}

export function esEstadoTerminalOperacionAdministrativaOrganizacion(estado) {
  if (!ESTADOS.has(estado)) {
    fallar(
      'El estado no pertenece al contrato administrativo.',
      'estado_operacion_administrativa_organizacion_invalido',
      'estado'
    );
  }
  return [
    ESTADOS_OPERACION_ADMINISTRATIVA_ORGANIZACION.COMPLETADA,
    ESTADOS_OPERACION_ADMINISTRATIVA_ORGANIZACION.COMPLETADA_CON_ADVERTENCIAS,
    ESTADOS_OPERACION_ADMINISTRATIVA_ORGANIZACION.FALLIDA
  ].includes(estado);
}

export function crearNotificacionEliminacionAdministrativaOrganizacion(entrada) {
  validarClavesExactas(entrada, propiedades('NOTIFICACION'), 'notificacion');
  exigirPerfil(entrada, PERFIL_NOTIFICACION_OPERACION_ADMINISTRATIVA, 'notificacion');
  const contrato = CONTRATOS_NOTIFICACION_ELIMINACION_ORGANIZACION[entrada.tipo];
  if (!contrato) {
    fallar(
      'El tipo de notificación no pertenece al contrato.',
      'tipo_notificacion_eliminacion_organizacion_invalido',
      'notificacion.tipo'
    );
  }
  exigirIgual(
    entrada.estadoOperacion,
    contrato.estado,
    'estado_notificacion_eliminacion_organizacion_invalido',
    'notificacion.estadoOperacion'
  );
  const emisor = normalizarEmisorNotificacion(entrada.emisor);
  exigirIgual(
    emisor.tipo,
    contrato.emisor,
    'emisor_notificacion_eliminacion_organizacion_invalido',
    'notificacion.emisor.tipo'
  );
  exigirIgual(
    entrada.tituloCodigo,
    contrato.tituloCodigo,
    'contenido_notificacion_eliminacion_organizacion_invalido',
    'notificacion.tituloCodigo'
  );
  exigirIgual(
    entrada.resumenCodigo,
    contrato.resumenCodigo,
    'contenido_notificacion_eliminacion_organizacion_invalido',
    'notificacion.resumenCodigo'
  );
  const referenciaSujeto = normalizarReferenciaSujeto(entrada.referenciaSujeto);
  if (contrato.exigeFotografiaFinal !== (referenciaSujeto.fotografiaFinal !== null)) {
    fallar(
      'La referencia no contiene la fotografía final exigida por su tipo.',
      'fotografia_notificacion_eliminacion_organizacion_invalida',
      'notificacion.referenciaSujeto.fotografiaFinal'
    );
  }
  const emitidaEnUtc = fechaUtc(entrada.emitidaEnUtc, 'notificacion.emitidaEnUtc');
  if (typeof entrada.leida !== 'boolean') {
    fallar(
      'El estado de lectura debe ser booleano.',
      'lectura_notificacion_eliminacion_organizacion_invalida',
      'notificacion.leida'
    );
  }
  const leidaEnUtc = entrada.leidaEnUtc === null
    ? null
    : fechaUtc(entrada.leidaEnUtc, 'notificacion.leidaEnUtc');
  if (
    entrada.leida !== (leidaEnUtc !== null) ||
    (leidaEnUtc !== null && Date.parse(leidaEnUtc) < Date.parse(emitidaEnUtc))
  ) {
    fallar(
      'La cronología de lectura es incoherente.',
      'lectura_notificacion_eliminacion_organizacion_invalida',
      'notificacion.leidaEnUtc'
    );
  }
  const notificacionId = uuidV7(
    entrada.notificacionId,
    'notificacion.notificacionId'
  );
  const operacionId = uuidV7(entrada.operacionId, 'notificacion.operacionId');
  if (notificacionId === operacionId) {
    fallar(
      'Notificación y operación deben tener identidades distintas.',
      'identidad_eliminacion_organizacion_reutilizada',
      'notificacion.notificacionId'
    );
  }
  const destinatarioUsuarioId = idDecimalPositivo(
    entrada.destinatarioUsuarioId,
    'notificacion.destinatarioUsuarioId'
  );
  if (
    emisor.tipo === EMISORES_NOTIFICACION_OPERACION_ADMINISTRATIVA.USUARIO &&
    emisor.actorRealId !== destinatarioUsuarioId
  ) {
    fallar(
      'La notificación humana pertenece al buzón del actor real.',
      'destinatario_eliminacion_organizacion_invalido',
      'notificacion.destinatarioUsuarioId'
    );
  }
  if (
    referenciaSujeto.fotografiaFinal !== null &&
    Date.parse(referenciaSujeto.fotografiaFinal.capturadaEnUtc) >
      Date.parse(emitidaEnUtc)
  ) {
    fallar(
      'La fotografía final no puede ser posterior a la notificación.',
      'cronologia_notificacion_eliminacion_organizacion_invalida',
      'notificacion.referenciaSujeto.fotografiaFinal.capturadaEnUtc'
    );
  }
  return congelarProfundo({
    perfil: entrada.perfil,
    version: entrada.version,
    notificacionId,
    tipo: entrada.tipo,
    operacionId,
    destinatarioUsuarioId,
    emisor,
    emitidaEnUtc,
    estadoOperacion: entrada.estadoOperacion,
    referenciaSujeto,
    leida: entrada.leida,
    leidaEnUtc,
    tituloCodigo: entrada.tituloCodigo,
    resumenCodigo: entrada.resumenCodigo
  });
}

export function crearPayloadPersistenteNotificacionEliminacionOrganizacion(
  entrada
) {
  const notificacion = crearNotificacionEliminacionAdministrativaOrganizacion(
    entrada
  );
  return congelarProfundo({
    estadoOperacion: notificacion.estadoOperacion,
    referenciaSujeto: notificacion.referenciaSujeto
  });
}

export function canonicalizarPayloadPersistenteNotificacionEliminacionOrganizacion(
  entrada
) {
  return canonicalizarRfc8785(
    crearPayloadPersistenteNotificacionEliminacionOrganizacion(entrada)
  );
}

function normalizarActor(entrada, ruta) {
  validarClavesExactas(entrada, propiedades('ACTOR'), ruta);
  if (entrada.estado !== 'activo' || entrada.decision !== 'autorizada') {
    fallar(
      'La fotografía solo admite actores activos y autorizados.',
      'actor_eliminacion_organizacion_invalido',
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
  validarClavesExactas(entrada, propiedades('SCOPE'), ruta);
  if (!['portal', 'tenant', 'empresa', 'sitio'].includes(entrada.nivel)) {
    fallar(
      'El nivel de scope no es válido.',
      'scope_eliminacion_organizacion_invalido',
      `${ruta}.nivel`
    );
  }
  const scope = {
    nivel: entrada.nivel,
    tenantId: idDecimalOpcional(entrada.tenantId, `${ruta}.tenantId`),
    empresaId: idDecimalOpcional(entrada.empresaId, `${ruta}.empresaId`),
    sitioId: idDecimalOpcional(entrada.sitioId, `${ruta}.sitioId`)
  };
  const valido =
    (scope.nivel === 'portal' && scope.tenantId === null && scope.empresaId === null && scope.sitioId === null) ||
    (scope.nivel === 'tenant' && scope.tenantId !== null && scope.empresaId === null && scope.sitioId === null) ||
    (scope.nivel === 'empresa' && scope.tenantId !== null && scope.empresaId !== null && scope.sitioId === null) ||
    (scope.nivel === 'sitio' && scope.tenantId !== null && scope.empresaId !== null && scope.sitioId !== null);
  if (!valido) {
    fallar(
      'La jerarquía del scope es incoherente.',
      'scope_eliminacion_organizacion_invalido',
      ruta
    );
  }
  return congelarProfundo(scope);
}

function validarIdentidadRaizEnScope(sujeto) {
  validarRaizEnScope(
    sujeto,
    'scope_sujeto_eliminacion_organizacion_invalido',
    'sujeto.scope'
  );
}

function validarRaizEnScope(sujeto, codigo, campo) {
  const nivelEsperado = sujeto.tipo;
  const idEnScope = {
    tenant: sujeto.scope.tenantId,
    empresa: sujeto.scope.empresaId,
    sitio: sujeto.scope.sitioId
  }[sujeto.tipo];
  if (sujeto.scope.nivel !== nivelEsperado || idEnScope !== sujeto.id) {
    fallar(
      'Tipo, id y scope de la raíz no identifican la misma organización.',
      codigo,
      campo
    );
  }
}

function scopeAlcanza(actor, objetivo) {
  if (actor.nivel === 'portal') return true;
  if (actor.tenantId !== objetivo.tenantId) return false;
  if (actor.nivel === 'tenant') return true;
  if (actor.empresaId !== objetivo.empresaId) return false;
  if (actor.nivel === 'empresa') return true;
  return actor.sitioId === objetivo.sitioId;
}

function scopePerteneceARaiz(scope, sujeto) {
  if (sujeto.tipo === TIPOS_SUJETO_ELIMINACION_ORGANIZACION.TENANT) {
    return scope.tenantId === sujeto.id;
  }
  if (sujeto.tipo === TIPOS_SUJETO_ELIMINACION_ORGANIZACION.EMPRESA) {
    return scope.empresaId === sujeto.id;
  }
  return scope.sitioId === sujeto.id;
}

function normalizarEmisorNotificacion(entrada) {
  validarClavesExactas(entrada, propiedades('EMISOR_NOTIFICACION'), 'notificacion.emisor');
  if (!Object.values(EMISORES_NOTIFICACION_OPERACION_ADMINISTRATIVA).includes(entrada.tipo)) {
    fallar(
      'El emisor de notificación no pertenece al contrato.',
      'emisor_notificacion_eliminacion_organizacion_invalido',
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
      'Solo el emisor humano declara ambos actores.',
      'emisor_notificacion_eliminacion_organizacion_invalido',
      'notificacion.emisor'
    );
  }
  return Object.freeze({ tipo: entrada.tipo, actorRealId, actorEfectivoId });
}

function normalizarReferenciaSujeto(entrada) {
  validarClavesExactas(entrada, propiedades('REFERENCIA_SUJETO'), 'notificacion.referenciaSujeto');
  if (!TIPOS_SUJETO.has(entrada.tipo)) {
    fallar(
      'La referencia debe identificar una raíz organizativa.',
      'tipo_sujeto_eliminacion_organizacion_invalido',
      'notificacion.referenciaSujeto.tipo'
    );
  }
  const id = idDecimalPositivo(entrada.id, 'notificacion.referenciaSujeto.id');
  const fotografiaFinal = entrada.fotografiaFinal === null
    ? null
    : crearFotografiaFinalEliminacionOrganizacion(entrada.fotografiaFinal);
  if (
    fotografiaFinal !== null &&
    identidadSujeto({ tipo: entrada.tipo, id }) !==
      identidadSujeto(fotografiaFinal)
  ) {
    fallar(
      'La fotografía final pertenece a otra referencia.',
      'sujeto_notificacion_eliminacion_organizacion_incoherente',
      'notificacion.referenciaSujeto.fotografiaFinal'
    );
  }
  return congelarProfundo({ tipo: entrada.tipo, id, fotografiaFinal });
}

function validarEstadoFase(estado, fase, rol) {
  if (!ESTADOS.has(estado) || !FASES.has(fase)) {
    fallar(
      'Estado o fase desconocidos.',
      'estado_fase_eliminacion_organizacion_invalido',
      `transicion.${rol}`
    );
  }
  const E = ESTADOS_OPERACION_ADMINISTRATIVA_ORGANIZACION;
  const F = FASES_ELIMINACION_ADMINISTRATIVA_ORGANIZACION;
  const valido =
    (estado === E.ENCOLADA && fase === F.PREPARACION) ||
    (estado === E.EJECUTANDO && FASES_EJECUCION.includes(fase)) ||
    ([E.COMPLETADA, E.COMPLETADA_CON_ADVERTENCIAS].includes(estado) && fase === F.LIMPIEZA) ||
    (estado === E.FALLIDA && FASES_EJECUCION.includes(fase));
  if (!valido) {
    fallar(
      'Estado y fase no forman una posición válida.',
      'estado_fase_eliminacion_organizacion_invalido',
      `transicion.${rol}`
    );
  }
}

function avanceEjecucionValido(entrada) {
  const E = ESTADOS_OPERACION_ADMINISTRATIVA_ORGANIZACION;
  if (entrada.estadoAnterior !== E.EJECUTANDO || entrada.estadoNuevo !== E.EJECUTANDO) {
    return false;
  }
  const anterior = FASES_EJECUCION.indexOf(entrada.faseAnterior);
  return anterior >= 0 && FASES_EJECUCION[anterior + 1] === entrada.faseNueva;
}

function nombreOrganizacion(valor, campo) {
  if (
    typeof valor !== 'string' ||
    valor.length < 1 ||
    valor.length > 160 ||
    valor !== valor.trim() ||
    /[\u0000-\u001f\u007f]/u.test(valor)
  ) {
    fallar(
      'El nombre debe ser texto saneado de hasta 160 caracteres.',
      'nombre_fotografia_final_eliminacion_organizacion_invalido',
      campo
    );
  }
  return valor;
}

function fechaUtc(valor, campo) {
  try {
    return validarFechaUtcMilisegundos(valor, campo);
  } catch (causa) {
    const error = new ErrorContratoEliminacionAdministrativaOrganizacion(
      causa.message,
      { codigo: 'fecha_eliminacion_organizacion_invalida', campo }
    );
    error.cause = causa;
    throw error;
  }
}

function uuidV7(valor, campo) {
  try {
    return validarUuidV7Auditoria(valor, campo);
  } catch (causa) {
    const error = new ErrorContratoEliminacionAdministrativaOrganizacion(
      causa.message,
      { codigo: 'uuidv7_eliminacion_organizacion_invalido', campo }
    );
    error.cause = causa;
    throw error;
  }
}

function idDecimalPositivo(valor, campo) {
  if (typeof valor !== 'string' || !/^[1-9][0-9]*$/u.test(valor)) {
    fallar(
      'El id debe ser texto decimal positivo y canónico.',
      'id_eliminacion_organizacion_invalido',
      campo
    );
  }
  return valor;
}

function idDecimalOpcional(valor, campo) {
  return valor === null ? null : idDecimalPositivo(valor, campo);
}

function enteroDecimalNoNegativo(valor, campo) {
  if (typeof valor !== 'string' || !PATRON_ENTERO_DECIMAL_NO_NEGATIVO.test(valor)) {
    fallar(
      'El conteo debe ser texto decimal no negativo y canónico.',
      'conteo_impacto_eliminacion_organizacion_invalido',
      campo
    );
  }
  return valor;
}

function identidadSujeto(sujeto) {
  return `${sujeto.tipo}:${sujeto.id}`;
}

function exigirPerfil(entrada, perfil, ruta) {
  if (entrada.perfil !== perfil || entrada.version !== VERSION_PERFIL) {
    fallar(
      `${ruta} no usa el perfil y versión esperados.`,
      'version_contrato_eliminacion_organizacion_incompatible',
      ruta
    );
  }
}

function exigirIgual(actual, esperado, codigo, campo) {
  if (actual !== esperado) {
    fallar(`${campo} no pertenece al contrato cerrado.`, codigo, campo);
  }
}

function propiedades(nombre) {
  return PROPIEDADES_CONTRATO_ELIMINACION_ADMINISTRATIVA_ORGANIZACION[nombre];
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
      'forma_contrato_eliminacion_organizacion_invalida',
      ruta
    );
  }
  const permitidas = new Set(esperadas);
  for (const clave of Reflect.ownKeys(entrada)) {
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
        'propiedad_contrato_eliminacion_organizacion_desconocida',
        typeof clave === 'string' ? `${ruta}.${clave}` : ruta
      );
    }
  }
  for (const esperada of esperadas) {
    if (!Object.hasOwn(entrada, esperada)) {
      fallar(
        `${ruta} no contiene todas las propiedades requeridas.`,
        'propiedad_contrato_eliminacion_organizacion_ausente',
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

function congelarProfundo(valor) {
  if (!valor || typeof valor !== 'object' || Object.isFrozen(valor)) return valor;
  for (const descendiente of Object.values(valor)) congelarProfundo(descendiente);
  return Object.freeze(valor);
}

function fallar(mensaje, codigo, campo) {
  throw new ErrorContratoEliminacionAdministrativaOrganizacion(mensaje, {
    codigo,
    campo
  });
}

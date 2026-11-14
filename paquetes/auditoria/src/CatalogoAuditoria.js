const congelar = (valor) => {
  if (valor && typeof valor === 'object' && !Object.isFrozen(valor)) {
    Object.freeze(valor);
    for (const hijo of Object.values(valor)) {
      congelar(hijo);
    }
  }
  return valor;
};

export const VERSION_CONTRATO_AUDITORIA = 1;
export const VERSION_CONTRATO_AUDITORIA_FEDERACION = 2;

export const ACTORES_AUDITORIA = congelar([
  'usuario',
  'agente',
  'runtime',
  'sistema',
  'instancia_remota'
]);

export const ORIGENES_AUDITORIA = congelar([
  'web',
  'api_agentes',
  'runtime',
  'bootstrap',
  'tarea_sistema',
  'api_federacion'
]);

export const SUJETOS_AUDITORIA = congelar([
  'frontera_internet',
  'usuario',
  'sesion_usuario',
  'agente',
  'sesion_agente',
  'regla_telemetria',
  'monitor',
  'alerta',
  'trigger',
  'destinatario_trigger_correo',
  'binding_trigger',
  'zona_dns',
  'registro_dns',
  'concesion_ddns',
  'intencion_ddns',
  'tenant',
  'empresa',
  'sitio',
  'configuracion_portal',
  'cadena_auditoria',
  'incidente_integridad',
  'instalacion_federada',
  'relacion_federada',
  'revision_concesion_federada',
  'flujo_federado',
  'lote_federado',
  'proyeccion_federada',
  'aviso_plataforma'
]);

export const ORIGENES_RESERVADOS_AUDITORIA = congelar([]);
export const ACTORES_RESERVADOS_AUDITORIA = congelar([]);

export const FLUJOS_AUDITORIA = congelar([
  'internet',
  'sistema',
  'usuarios',
  'organizacion',
  'agentes',
  'monitores',
  'alertas',
  'automatizacion',
  'dns',
  'federacion'
]);

export const CAUSALIDADES_AUDITORIA = congelar([
  'solicitud_recuperacion_password',
  'evento_auditoria',
  'evento_monitor',
  'ejecucion_trigger',
  'operacion_sesion_agente',
  'generacion_dns',
  'intencion_ddns',
  'relacion_federacion',
  'ocurrencia_federacion',
  'entrega_federacion',
  'aviso_plataforma'
]);

export const CLAVES_CADENA_POR_FLUJO = congelar(
  Object.fromEntries(
    FLUJOS_AUDITORIA.map((flujo) => [
      flujo,
      {
        tenant: `${flujo}:tenant:{tenantId}`,
        portal: `${flujo}:portal`
      }
    ])
  )
);

export const PERFILES_PAYLOAD_AUDITORIA = congelar({
  recuperacion_password_emision_v1: ['resultado', 'buzonCanonico', 'direccionIp'],
  alta_v1: ['resultado', 'antes', 'despues'],
  cambio_v1: ['resultado', 'camposCambiados', 'antes', 'despues'],
  estado_v1: ['estadoAntes', 'estadoDespues', 'motivo'],
  eliminacion_v1: ['resultado', 'antes', 'despues', 'impactoResumen'],
  eliminacion_agente_v1: [
    'resultado',
    'aceptadaEnUtc',
    'antes',
    'despues',
    'impactoResumen',
    'referenciasCompartidasConservadas',
    'identidadesFederadasRetiradas',
    'obligacionesPostcommit'
  ],
  eliminacion_organizacion_v1: [
    'resultado',
    'aceptadaEnUtc',
    'sujetoAceptado',
    'autorizacionAceptada',
    'antes',
    'despues',
    'impactoResumen',
    'identidadesFederadasRetiradas',
    'obligacionesPostcommit'
  ],
  scope_v1: ['direccion', 'scopePropio', 'eventoContraparteId', 'impactoResumen'],
  sesion_v1: ['sesionAuditoriaId', 'resultado', 'causa'],
  credencial_v1: ['operacion', 'resultado', 'causa'],
  ciclo_alerta_v1: ['resultado', 'causa'],
  descarte_alerta_v1: ['resultado', 'causa'],
  resultado_externo_v1: [
    'sistemaDestino',
    'resultado',
    'codigo',
    'versionRecurso',
    'resumen'
  ],
  retencion_v1: [
    'cadenaAfectada',
    'secuenciaDesde',
    'secuenciaHasta',
    'hashAnteriorAlTramo',
    'hashHasta',
    'primeraSecuenciaConservada',
    'dias'
  ],
  incidente_v1: ['incidenteId', 'huella', 'estado', 'comentario'],
  genesis_v1: ['flujo', 'claveCadena', 'scopeCadena', 'versiones'],
  federacion_control_v1: [
    'accion',
    'resultado',
    'motivoCodigo',
    'revisionConcesionId',
    'resumen'
  ],
  federacion_transporte_v1: [
    'direccion',
    'resultado',
    'generacionId',
    'loteId',
    'rango',
    'conteos',
    'codigo'
  ],
  aviso_plataforma_v1: [
    'operacion',
    'estadoAntes',
    'estadoDespues',
    'gravedadAntes',
    'gravedadDespues',
    'causaCodigo',
    'cicloAnteriorId'
  ],
  ddns_v1: [
    'resultado',
    'tipoRegistro',
    'modo',
    'estadoAnterior',
    'estadoPosterior',
    'versionDdns',
    'origenIntencion',
    'generacionDns',
    'causa',
    'agenteId',
    'registroDnsId',
    'extremo'
  ]
});

const TIPOS_POR_FLUJO = congelar({
  internet: ['recuperacion_password.solicitud_emitida'],
  sistema: [
    'auditoria.retencion_aplicada',
    'auditoria.incidencia_integridad_reconocida',
    'configuracion.portal_actualizada',
    'configuracion.portal_restablecida',
    'configuracion.portal_sincronizada',
    'configuracion.correo_operativo_verificado',
    'plataforma.aviso_abierto',
    'plataforma.aviso_actualizado',
    'plataforma.aviso_resuelto',
    'plataforma.aviso_reabierto',
    'plataforma.aviso_reconocido',
    'plataforma.aviso_ocultado'
  ],
  usuarios: [
    'usuario.creado',
    'usuario.perfil_cambiado',
    'usuario.permisos_cambiados',
    'usuario.estado_cambiado',
    'usuario.password_cambiado',
    'usuario.password_reiniciado',
    'usuario.password_recuperado',
    'usuario.email_validado',
    'usuario.eliminado',
    'usuario.sesion_iniciada',
    'usuario.sesion_cerrada',
    'usuario.sesion_invalidada',
    'usuario.impersonacion_iniciada',
    'usuario.impersonacion_finalizada'
  ],
  organizacion: [
    'organizacion.tenant_creado',
    'organizacion.tenant_actualizado',
    'organizacion.tenant_eliminado',
    'organizacion.empresa_creada',
    'organizacion.empresa_actualizada',
    'organizacion.empresa_eliminada',
    'organizacion.sitio_creado',
    'organizacion.sitio_actualizado',
    'organizacion.sitio_eliminado'
  ],
  agentes: [
    'agente.provisionado',
    'agente.perfil_servidor_solicitado',
    'agente.configuracion_servidor_cambiada',
    'agente.perfil_servidor_retirado',
    'agente.perfil_servidor_desactivado',
    'agente.metadatos_cambiados',
    'agente.estado_administrativo_cambiado',
    'agente.secreto_rotado',
    'agente.cuarentena_activada',
    'agente.cuarentena_desactivada',
    'agente.sesion_iniciada',
    'agente.sesion_reemplazada',
    'agente.sesion_invalidada',
    'agente.eliminado',
    'regla_telemetria.creada',
    'regla_telemetria.revision_creada',
    'regla_telemetria.estado_cambiado'
  ],
  monitores: ['monitor.creado', 'monitor.actualizado', 'monitor.eliminado'],
  alertas: [
    'alerta.abierta',
    'alerta.cerrada',
    'alerta.descarte_aplicado',
    'alerta.descarte_revertido'
  ],
  automatizacion: [
    'trigger.creado',
    'trigger.actualizado',
    'trigger.eliminado',
    'trigger.audiencia_destinatario_agregado',
    'trigger.audiencia_destinatario_retirado',
    'trigger.audiencia_destinatario_desuscrito',
    'trigger.audiencia_destinatario_reincorporado',
    'trigger.audiencia_vacia_desactivado',
    'trigger.binding_creado',
    'trigger.binding_actualizado',
    'trigger.binding_eliminado'
  ],
  dns: [
    'dns.zona_creada',
    'dns.zona_actualizada',
    'dns.zona_eliminada',
    'dns.registro_creado',
    'dns.registro_actualizado',
    'dns.registro_eliminado',
    'dns.publicacion_aplicada',
    'dns.publicacion_fallida',
    'ddns.concesion_creada',
    'ddns.concesion_revocada',
    'ddns.concesion_scope_actualizado',
    'ddns.intencion_aceptada',
    'ddns.contenido_deseado_persistido',
    'ddns.publicacion_bloqueada',
    'ddns.publicacion_fallida',
    'ddns.contenido_publicado',
    'ddns.intencion_terminada'
  ],
  federacion: [
    'federacion.vinculacion_solicitada',
    'federacion.invitacion_revocada',
    'federacion.invitacion_consumida',
    'federacion.vinculacion_confirmada',
    'federacion.sesion_iniciada',
    'federacion.sesion_revocada',
    'federacion.compatibilidad_comprobada',
    'federacion.recuperacion_solicitada',
    'federacion.credencial_recuperada',
    'federacion.localizacion_propuesta',
    'federacion.localizacion_cambiada',
    'federacion.relacion_estado_cambiado',
    'federacion.concesion_revisada',
    'federacion.credencial_rotada',
    'federacion.responsabilidad_transferida',
    'federacion.conflicto_identidad_detectado',
    'federacion.conflicto_identidad_resuelto',
    'federacion.resincronizacion_solicitada',
    'federacion.reconstruccion_decidida',
    'federacion.lote_emitido',
    'federacion.lote_recibido',
    'federacion.lote_confirmado',
    'federacion.lote_rechazado',
    'federacion.divergencia_detectada',
    'federacion.ruta_excluida',
    'federacion.consolidacion_estados_remotos_iniciada',
    'federacion.consolidacion_estados_remotos_finalizada',
    'federacion.estado_temporal_remoto_cambiado'
  ]
});

const TIPOS_TRANSVERSALES = congelar([
  'cadena.iniciada',
  'scope.entidad_salida',
  'scope.entidad_entrada'
]);

const TIPOS_POR_PERFIL = congelar({
  recuperacion_password_emision_v1: [
    'recuperacion_password.solicitud_emitida'
  ],
  genesis_v1: ['cadena.iniciada'],
  retencion_v1: ['auditoria.retencion_aplicada'],
  incidente_v1: ['auditoria.incidencia_integridad_reconocida'],
  resultado_externo_v1: [
    'configuracion.correo_operativo_verificado',
    'dns.publicacion_aplicada',
    'dns.publicacion_fallida'
  ],
  scope_v1: ['scope.entidad_salida', 'scope.entidad_entrada'],
  sesion_v1: [
    'usuario.sesion_iniciada',
    'usuario.sesion_cerrada',
    'usuario.sesion_invalidada',
    'usuario.impersonacion_iniciada',
    'usuario.impersonacion_finalizada',
    'agente.sesion_iniciada',
    'agente.sesion_reemplazada',
    'agente.sesion_invalidada'
  ],
  credencial_v1: [
    'usuario.password_cambiado',
    'usuario.password_reiniciado',
    'usuario.password_recuperado',
    'agente.secreto_rotado'
  ],
  ciclo_alerta_v1: ['alerta.abierta', 'alerta.cerrada'],
  alta_v1: [
    'usuario.creado',
    'organizacion.tenant_creado',
    'organizacion.empresa_creada',
    'organizacion.sitio_creado',
    'agente.provisionado',
    'agente.perfil_servidor_solicitado',
    'regla_telemetria.creada',
    'regla_telemetria.revision_creada',
    'monitor.creado',
    'trigger.creado',
    'trigger.audiencia_destinatario_agregado',
    'trigger.binding_creado',
    'dns.zona_creada',
    'dns.registro_creado'
  ],
  eliminacion_v1: [
    'usuario.eliminado',
    'organizacion.tenant_eliminado',
    'organizacion.empresa_eliminada',
    'organizacion.sitio_eliminado',
    'monitor.eliminado',
    'trigger.eliminado',
    'trigger.audiencia_destinatario_retirado',
    'trigger.binding_eliminado',
    'dns.zona_eliminada',
    'dns.registro_eliminado'
  ],
  eliminacion_agente_v1: ['agente.eliminado'],
  estado_v1: [
    'usuario.estado_cambiado',
    'usuario.email_validado',
    'agente.estado_administrativo_cambiado',
    'agente.perfil_servidor_retirado',
    'agente.perfil_servidor_desactivado',
    'agente.cuarentena_activada',
    'agente.cuarentena_desactivada',
    'regla_telemetria.estado_cambiado'
  ],
  descarte_alerta_v1: [
    'alerta.descarte_aplicado',
    'alerta.descarte_revertido'
  ],
  cambio_v1: [
    'configuracion.portal_actualizada',
    'configuracion.portal_restablecida',
    'configuracion.portal_sincronizada',
    'usuario.perfil_cambiado',
    'usuario.permisos_cambiados',
    'organizacion.tenant_actualizado',
    'organizacion.empresa_actualizada',
    'organizacion.sitio_actualizado',
    'agente.metadatos_cambiados',
    'agente.configuracion_servidor_cambiada',
    'monitor.actualizado',
    'trigger.actualizado',
    'trigger.audiencia_destinatario_desuscrito',
    'trigger.audiencia_destinatario_reincorporado',
    'trigger.audiencia_vacia_desactivado',
    'trigger.binding_actualizado',
    'dns.zona_actualizada',
    'dns.registro_actualizado'
  ],
  federacion_control_v1: [
    'federacion.vinculacion_solicitada',
    'federacion.invitacion_revocada',
    'federacion.invitacion_consumida',
    'federacion.vinculacion_confirmada',
    'federacion.sesion_iniciada',
    'federacion.sesion_revocada',
    'federacion.compatibilidad_comprobada',
    'federacion.recuperacion_solicitada',
    'federacion.credencial_recuperada',
    'federacion.localizacion_propuesta',
    'federacion.localizacion_cambiada',
    'federacion.relacion_estado_cambiado',
    'federacion.concesion_revisada',
    'federacion.credencial_rotada',
    'federacion.responsabilidad_transferida',
    'federacion.conflicto_identidad_detectado',
    'federacion.conflicto_identidad_resuelto',
    'federacion.resincronizacion_solicitada',
    'federacion.reconstruccion_decidida',
    'federacion.ruta_excluida',
    'federacion.consolidacion_estados_remotos_iniciada',
    'federacion.consolidacion_estados_remotos_finalizada',
    'federacion.estado_temporal_remoto_cambiado'
  ],
  federacion_transporte_v1: [
    'federacion.lote_emitido',
    'federacion.lote_recibido',
    'federacion.lote_confirmado',
    'federacion.lote_rechazado',
    'federacion.divergencia_detectada'
  ],
  aviso_plataforma_v1: [
    'plataforma.aviso_abierto',
    'plataforma.aviso_actualizado',
    'plataforma.aviso_resuelto',
    'plataforma.aviso_reabierto',
    'plataforma.aviso_reconocido',
    'plataforma.aviso_ocultado'
  ],
  ddns_v1: [
    'ddns.concesion_creada',
    'ddns.concesion_revocada',
    'ddns.concesion_scope_actualizado',
    'ddns.intencion_aceptada',
    'ddns.contenido_deseado_persistido',
    'ddns.publicacion_bloqueada',
    'ddns.publicacion_fallida',
    'ddns.contenido_publicado',
    'ddns.intencion_terminada'
  ]
});

const SUJETOS_POR_PREFIJO = congelar({
  'recuperacion_password.': 'frontera_internet',
  'usuario.': 'usuario',
  'organizacion.tenant_': 'tenant',
  'organizacion.empresa_': 'empresa',
  'organizacion.sitio_': 'sitio',
  'agente.': 'agente',
  'regla_telemetria.': 'regla_telemetria',
  'monitor.': 'monitor',
  'alerta.': 'alerta',
  'trigger.binding_': 'binding_trigger',
  'trigger.': 'trigger',
  'dns.zona_': 'zona_dns',
  'dns.registro_': 'registro_dns',
  'ddns.concesion_': 'concesion_ddns',
  'ddns.': 'intencion_ddns',
  'federacion.vinculacion_': 'relacion_federada',
  'federacion.invitacion_': 'relacion_federada',
  'federacion.relacion_': 'relacion_federada',
  'federacion.concesion_': 'revision_concesion_federada',
  'federacion.credencial_': 'relacion_federada',
  'federacion.recuperacion_': 'relacion_federada',
  'federacion.localizacion_': 'relacion_federada',
  'federacion.responsabilidad_': 'relacion_federada',
  'federacion.conflicto_identidad_': 'instalacion_federada',
  'federacion.resincronizacion_': 'flujo_federado',
  'federacion.reconstruccion_': 'flujo_federado',
  'federacion.lote_': 'lote_federado',
  'federacion.divergencia_': 'proyeccion_federada',
  'federacion.ruta_': 'proyeccion_federada',
  'plataforma.aviso_': 'aviso_plataforma'
});

const PAREJAS_ACTOR_ORIGEN_ESPECIALES = congelar({
  'cadena.iniciada': [
    ['sistema', 'web'],
    ['sistema', 'api_agentes'],
    ['sistema', 'runtime'],
    ['sistema', 'bootstrap'],
    ['sistema', 'tarea_sistema'],
    ['sistema', 'api_federacion']
  ],
  'configuracion.portal_sincronizada': [
    ['usuario', 'web'],
    ['sistema', 'bootstrap']
  ],
  'usuario.creado': [
    ['usuario', 'web'],
    ['sistema', 'bootstrap']
  ],
  'usuario.sesion_invalidada': [
    ['usuario', 'web'],
    ['sistema', 'web']
  ],
  'alerta.descarte_revertido': [
    ['usuario', 'web'],
    ['runtime', 'runtime']
  ],
  'dns.registro_actualizado': [
    ['usuario', 'web'],
    ['runtime', 'runtime']
  ]
});

function politicaEliminacionOrganizacionDurable() {
  return {
    parejas: [['usuario', 'web']],
    productores: ['portal_web', 'runtime_operaciones_administrativas'],
    emisiones: [
      ['usuario', 'web', 'portal_web'],
      ['usuario', 'web', 'runtime_operaciones_administrativas']
    ],
    perfilesPorProductor: {
      runtime_operaciones_administrativas: 'eliminacion_organizacion_v1'
    },
    roles: ['principal'],
    fuenteClaveOperacion: 'claveOperacion durable de la eliminación organizativa'
  };
}

function politicaDdnsHumana(sujeto) {
  return {
    parejas: [['usuario', 'web']],
    sujetos: [sujeto],
    productores: ['portal_web'],
    roles: ['principal'],
    fuenteClaveOperacion: 'concesión DDNS más decisión humana durable'
  };
}

function politicaResultadoDdns(productor) {
  return {
    parejas: [['runtime', 'runtime']],
    sujetos: ['intencion_ddns'],
    productores: [productor],
    roles: ['resultado'],
    fuenteClaveOperacion: 'concesión más versión DDNS y resultado causal'
  };
}

const POLITICAS_ESPECIALES = congelar({
  'recuperacion_password.solicitud_emitida': {
    parejas: [['sistema', 'web']],
    sujetos: ['frontera_internet'],
    productores: ['recuperacion_password'],
    roles: ['principal'],
    fuenteClaveOperacion: 'eventoEmisionId UUIDv7 preasignado'
  },
  'usuario.password_recuperado': {
    parejas: [['sistema', 'web']],
    sujetos: ['usuario'],
    productores: ['recuperacion_password'],
    roles: ['principal'],
    fuenteClaveOperacion: 'eventoConsumoId UUIDv7 preasignado'
  },
  'trigger.audiencia_destinatario_agregado': {
    sujetos: ['destinatario_trigger_correo']
  },
  'trigger.audiencia_destinatario_retirado': {
    sujetos: ['destinatario_trigger_correo']
  },
  'trigger.audiencia_destinatario_desuscrito': {
    parejas: [['sistema', 'web']],
    sujetos: ['destinatario_trigger_correo'],
    fuenteClaveOperacion: 'UUIDv7 generado al consumir la capacidad'
  },
  'trigger.audiencia_destinatario_reincorporado': {
    sujetos: ['destinatario_trigger_correo']
  },
  'trigger.audiencia_vacia_desactivado': {
    parejas: [['usuario', 'web'], ['sistema', 'web']],
    sujetos: ['trigger']
  },
  'cadena.iniciada': {
    sujetos: ['cadena_auditoria'],
    productores: ['auditoria_nucleo'],
    roles: ['principal'],
    fuenteClaveOperacion: 'prefijo_v1 + claveCadena'
  },
  'auditoria.retencion_aplicada': {
    parejas: [['sistema', 'tarea_sistema'], ['sistema', 'bootstrap']],
    sujetos: ['cadena_auditoria'],
    productores: ['tarea_retencion'],
    roles: ['principal'],
    fuenteClaveOperacion:
      'UUIDv7 durable único por cadena, checkpoint anterior y secuencia final'
  },
  'auditoria.incidencia_integridad_reconocida': {
    parejas: [['usuario', 'web']],
    sujetos: ['incidente_integridad']
  },
  'configuracion.portal_actualizada': {
    parejas: [['usuario', 'web']],
    sujetos: ['configuracion_portal']
  },
  'configuracion.portal_restablecida': {
    parejas: [['usuario', 'web']],
    sujetos: ['configuracion_portal']
  },
  'configuracion.portal_sincronizada': {
    sujetos: ['configuracion_portal'],
    productores: ['portal_web', 'bootstrap'],
    emisiones: [
      ['usuario', 'web', 'portal_web'],
      ['sistema', 'bootstrap', 'bootstrap']
    ],
    fuenteClaveOperacion:
      'UUIDv7 web o nombre de operación más revisión persistida de bootstrap'
  },
  'configuracion.correo_operativo_verificado': {
    parejas: [['usuario', 'web']],
    sujetos: ['configuracion_portal'],
    roles: ['resultado']
  },
  'usuario.creado': {
    productores: ['portal_web', 'bootstrap'],
    emisiones: [
      ['usuario', 'web', 'portal_web'],
      ['sistema', 'bootstrap', 'bootstrap']
    ],
    fuenteClaveOperacion:
      'UUIDv7 web o nombre de operación más identidad persistida de bootstrap'
  },
  'usuario.sesion_iniciada': { sujetos: ['sesion_usuario'] },
  'usuario.sesion_cerrada': { sujetos: ['sesion_usuario'] },
  'usuario.sesion_invalidada': {
    sujetos: ['sesion_usuario'],
    roles: ['resultado']
  },
  'usuario.impersonacion_iniciada': { sujetos: ['sesion_usuario'] },
  'usuario.impersonacion_finalizada': { sujetos: ['sesion_usuario'] },
  'agente.cuarentena_activada': {
    parejas: [['sistema', 'api_agentes']],
    productores: ['api_agentes']
  },
  'agente.cuarentena_desactivada': {
    parejas: [['sistema', 'api_agentes']],
    productores: ['api_agentes']
  },
  'agente.sesion_iniciada': {
    parejas: [['agente', 'api_agentes']],
    sujetos: ['sesion_agente'],
    productores: ['api_agentes'],
    fuenteClaveOperacion: 'agenteId + loginRequestId requerido'
  },
  'agente.sesion_reemplazada': {
    parejas: [['agente', 'api_agentes']],
    sujetos: ['sesion_agente'],
    productores: ['api_agentes'],
    roles: ['resultado'],
    fuenteClaveOperacion: 'clave hija durable del login técnico'
  },
  'agente.sesion_invalidada': {
    parejas: [['usuario', 'web']],
    sujetos: ['sesion_agente'],
    roles: ['resultado']
  },
  'agente.perfil_servidor_desactivado': {
    parejas: [['runtime', 'runtime']],
    sujetos: ['agente'],
    productores: ['runtime_agentes'],
    fuenteClaveOperacion:
      'agenteId, generación y cierre durable de perfil servidor'
  },
  'agente.eliminado': {
    parejas: [['usuario', 'web']],
    sujetos: ['agente'],
    productores: ['runtime_operaciones_administrativas'],
    roles: ['principal'],
    fuenteClaveOperacion: 'claveOperacion durable de la eliminación administrativa'
  },
  'organizacion.tenant_eliminado': politicaEliminacionOrganizacionDurable(),
  'organizacion.empresa_eliminada': politicaEliminacionOrganizacionDurable(),
  'organizacion.sitio_eliminado': politicaEliminacionOrganizacionDurable(),
  'alerta.abierta': {
    parejas: [['runtime', 'runtime']],
    productores: ['runtime_alertas'],
    fuenteClaveOperacion: 'id estable de transición u obligación outbox'
  },
  'alerta.cerrada': {
    parejas: [['runtime', 'runtime'], ['usuario', 'web']],
    productores: ['runtime_alertas', 'portal_web'],
    emisiones: [
      ['usuario', 'web', 'portal_web'],
      ['runtime', 'runtime', 'runtime_alertas']
    ],
    fuenteClaveOperacion: 'id estable de transición u obligación outbox'
  },
  'alerta.descarte_revertido': {
    productores: ['portal_web', 'runtime_alertas'],
    emisiones: [
      ['usuario', 'web', 'portal_web'],
      ['runtime', 'runtime', 'runtime_alertas']
    ],
    fuenteClaveOperacion: 'UUIDv7 web o id estable de obligación por vencimiento'
  },
  'dns.registro_actualizado': {
    productores: ['portal_web', 'runtime_automatizacion'],
    emisiones: [
      ['usuario', 'web', 'portal_web'],
      ['runtime', 'runtime', 'runtime_automatizacion']
    ],
    fuenteClaveOperacion:
      'UUIDv7 web o ejecución de trigger más ordinal determinista'
  },
  'dns.publicacion_aplicada': {
    parejas: [['runtime', 'runtime']],
    sujetos: ['configuracion_portal'],
    productores: ['runtime_dns'],
    roles: ['resultado'],
    fuenteClaveOperacion: 'generacionDns'
  },
  'dns.publicacion_fallida': {
    parejas: [['runtime', 'runtime']],
    sujetos: ['configuracion_portal'],
    productores: ['runtime_dns'],
    roles: ['resultado'],
    fuenteClaveOperacion: 'generacionDns'
  },
  'ddns.concesion_creada': politicaDdnsHumana('concesion_ddns'),
  'ddns.concesion_revocada': {
    parejas: [['usuario', 'web']],
    sujetos: ['concesion_ddns'],
    productores: ['portal_web', 'runtime_operaciones_administrativas'],
    emisiones: [
      ['usuario', 'web', 'portal_web'],
      ['usuario', 'web', 'runtime_operaciones_administrativas']
    ],
    roles: ['principal'],
    fuenteClaveOperacion: 'concesión DDNS más decisión humana durable'
  },
  'ddns.concesion_scope_actualizado': politicaDdnsHumana('concesion_ddns'),
  'ddns.intencion_aceptada': {
    parejas: [
      ['agente', 'api_agentes'],
      ['usuario', 'web'],
      ['runtime', 'runtime']
    ],
    sujetos: ['intencion_ddns'],
    productores: ['api_agentes', 'portal_web', 'runtime_automatizacion'],
    emisiones: [
      ['agente', 'api_agentes', 'api_agentes'],
      ['usuario', 'web', 'portal_web'],
      ['runtime', 'runtime', 'runtime_automatizacion']
    ],
    fuenteClaveOperacion: 'solicitud UUIDv7 o concesión más versión DDNS'
  },
  'ddns.contenido_deseado_persistido': politicaResultadoDdns(
    'runtime_automatizacion'
  ),
  'ddns.publicacion_bloqueada': politicaResultadoDdns('runtime_dns'),
  'ddns.publicacion_fallida': politicaResultadoDdns('runtime_dns'),
  'ddns.contenido_publicado': politicaResultadoDdns('runtime_dns'),
  'ddns.intencion_terminada': politicaResultadoDdns('runtime_dns'),
  'scope.entidad_salida': {
    parejas: [['usuario', 'web']],
    sujetos: ['usuario', 'agente', 'empresa', 'sitio', 'monitor', 'trigger', 'zona_dns'],
    productores: ['portal_web'],
    roles: ['salida']
  },
  'scope.entidad_entrada': {
    parejas: [['usuario', 'web']],
    sujetos: ['usuario', 'agente', 'empresa', 'sitio', 'monitor', 'trigger', 'zona_dns'],
    productores: ['portal_web'],
    roles: ['entrada']
  },
  'federacion.vinculacion_solicitada': politicaFederacionWeb(
    'relacion_federada'
  ),
  'federacion.invitacion_revocada': politicaFederacionWeb(
    'relacion_federada'
  ),
  'federacion.invitacion_consumida': politicaFederacionApi(
    'relacion_federada'
  ),
  'federacion.vinculacion_confirmada': politicaFederacionWeb(
    'relacion_federada'
  ),
  'federacion.sesion_iniciada': politicaFederacionApi(
    'relacion_federada'
  ),
  'federacion.sesion_revocada': politicaFederacionWeb(
    'relacion_federada'
  ),
  'federacion.compatibilidad_comprobada': politicaFederacionApi(
    'relacion_federada'
  ),
  'federacion.relacion_estado_cambiado': politicaFederacionWeb(
    'relacion_federada'
  ),
  'federacion.concesion_revisada': politicaFederacionWebApi(
    'revision_concesion_federada'
  ),
  'federacion.credencial_rotada': politicaFederacionWebApi('relacion_federada'),
  'federacion.recuperacion_solicitada': politicaFederacionWeb('relacion_federada'),
  'federacion.credencial_recuperada': politicaFederacionWebApi('relacion_federada'),
  'federacion.localizacion_propuesta': politicaFederacionWebApi('relacion_federada'),
  'federacion.localizacion_cambiada': politicaFederacionWeb('relacion_federada'),
  'federacion.responsabilidad_transferida': politicaFederacionWeb(
    'relacion_federada'
  ),
  'federacion.conflicto_identidad_detectado': politicaFederacionRuntime(
    'instalacion_federada'
  ),
  'federacion.conflicto_identidad_resuelto': politicaFederacionWeb(
    'instalacion_federada'
  ),
  'federacion.resincronizacion_solicitada': {
    parejas: [['usuario', 'web'], ['runtime', 'runtime']],
    sujetos: ['flujo_federado'],
    productores: ['portal_federacion', 'runtime_federacion'],
    emisiones: [
      ['usuario', 'web', 'portal_federacion'],
      ['runtime', 'runtime', 'runtime_federacion']
    ]
  },
  'federacion.reconstruccion_decidida': politicaFederacionWeb('flujo_federado'),
  'federacion.lote_emitido': politicaFederacionRuntime('lote_federado'),
  'federacion.lote_recibido': politicaFederacionApi('lote_federado'),
  'federacion.lote_confirmado': politicaFederacionApi('lote_federado'),
  'federacion.lote_rechazado': politicaFederacionApi('lote_federado'),
  'federacion.divergencia_detectada': politicaFederacionRuntime(
    'proyeccion_federada'
  ),
  'federacion.ruta_excluida': politicaFederacionWeb('proyeccion_federada'),
  'federacion.consolidacion_estados_remotos_iniciada': politicaFederacionRuntime(
    'instalacion_federada'
  ),
  'federacion.consolidacion_estados_remotos_finalizada': politicaFederacionRuntime(
    'instalacion_federada'
  ),
  'federacion.estado_temporal_remoto_cambiado': politicaFederacionRuntime(
    'proyeccion_federada'
  ),
  'plataforma.aviso_abierto': politicaFederacionRuntime('aviso_plataforma'),
  'plataforma.aviso_actualizado': politicaFederacionRuntime('aviso_plataforma'),
  'plataforma.aviso_resuelto': politicaAvisoPlataformaResolucion(),
  'plataforma.aviso_reabierto': politicaFederacionRuntime('aviso_plataforma'),
  'plataforma.aviso_reconocido': politicaFederacionWeb('aviso_plataforma'),
  'plataforma.aviso_ocultado': politicaFederacionWeb('aviso_plataforma')
});

function politicaFederacionWeb(sujeto) {
  return {
    parejas: [['usuario', 'web']],
    sujetos: [sujeto],
    productores: ['portal_federacion']
  };
}

function politicaFederacionApi(sujeto) {
  return {
    parejas: [['instancia_remota', 'api_federacion']],
    sujetos: [sujeto],
    productores: ['api_federacion']
  };
}

function politicaFederacionWebApi(sujeto) {
  return {
    parejas: [['usuario', 'web'], ['instancia_remota', 'api_federacion']],
    sujetos: [sujeto],
    productores: ['portal_federacion', 'api_federacion'],
    emisiones: [
      ['usuario', 'web', 'portal_federacion'],
      ['instancia_remota', 'api_federacion', 'api_federacion']
    ]
  };
}

function politicaFederacionRuntime(sujeto) {
  return {
    parejas: [['runtime', 'runtime']],
    sujetos: [sujeto],
    productores: ['runtime_federacion'],
    fuenteClaveOperacion: 'identidad durable de obligación o transición federada'
  };
}

function politicaAvisoPlataformaResolucion() {
  return {
    parejas: [['runtime', 'runtime'], ['usuario', 'web']],
    sujetos: ['aviso_plataforma'],
    productores: ['runtime_federacion', 'portal_federacion'],
    emisiones: [
      ['runtime', 'runtime', 'runtime_federacion'],
      ['usuario', 'web', 'portal_federacion']
    ]
  };
}

export const FLUJO_MOVIMIENTO_POR_SUJETO = congelar({
  usuario: 'usuarios',
  agente: 'agentes',
  empresa: 'organizacion',
  sitio: 'organizacion',
  monitor: 'monitores',
  trigger: 'automatizacion',
  zona_dns: 'dns'
});

export const ENUMS_CERRADOS_POR_TIPO = congelar({
  'usuario.sesion_iniciada': { causa: ['login', 'cambio_password_obligatorio'] },
  'usuario.sesion_cerrada': { causa: ['logout'] },
  'usuario.sesion_invalidada': {
    causa: [
      'permisos_cambiados',
      'scope_cambiado',
      'estado_cambiado',
      'password_cambiado',
      'password_reiniciado',
      'usuario_eliminado'
    ]
  },
  'usuario.impersonacion_iniciada': { causa: ['operador'] },
  'usuario.impersonacion_finalizada': { causa: ['operador'] },
  'agente.sesion_iniciada': { causa: ['login'] },
  'agente.sesion_reemplazada': { causa: ['nuevo_login'] },
  'agente.sesion_invalidada': {
    causa: ['scope_cambiado', 'secreto_rotado', 'estado_administrativo_cambiado']
  },
  'agente.perfil_servidor_retirado': { motivo: ['operador'] },
  'agente.perfil_servidor_desactivado': {
    motivo: [
      'pol_boot_id_ausente',
      'pol_heartbeat_incompleto',
      'pol_login_incoherente',
      'pol_cronologia_incompatible'
    ]
  },
  'usuario.password_cambiado': { causa: ['voluntario', 'obligatorio'] },
  'usuario.password_reiniciado': {
    causa: [
      'administrador',
      'administrador_via_correo',
      'administrador_via_manual'
    ]
  },
  'usuario.password_recuperado': { causa: ['posesion_buzon_verificada'] },
  'agente.secreto_rotado': { causa: ['administrador'] },
  'usuario.estado_cambiado': { motivo: ['operador'] },
  'usuario.email_validado': { motivo: ['confirmacion_email'] },
  'agente.estado_administrativo_cambiado': { motivo: ['operador'] },
  'agente.cuarentena_activada': { motivo: ['umbral_fallos_login'] },
  'agente.cuarentena_desactivada': { motivo: ['plazo_cuarentena_cumplido'] },
  'regla_telemetria.estado_cambiado': { motivo: ['operador'] },
  'configuracion.correo_operativo_verificado': { codigo: [null] },
  'dns.publicacion_aplicada': { codigo: [null] },
  'dns.publicacion_fallida': {
    codigo: [
      'artefacto_invalido',
      'checkconf_rechazado',
      'checkzone_rechazado',
      'configuracion_despliegue_invalida'
    ]
  },
  'federacion.vinculacion_solicitada': {
    accion: ['solicitar_vinculacion'], resultado: ['solicitada']
  },
  'federacion.invitacion_revocada': {
    accion: ['revocar_invitacion'], resultado: ['revocada']
  },
  'federacion.invitacion_consumida': {
    accion: ['consumir_invitacion'], resultado: ['consumida']
  },
  'federacion.vinculacion_confirmada': {
    accion: ['confirmar_vinculacion'], resultado: ['confirmada']
  },
  'federacion.sesion_iniciada': {
    accion: ['iniciar_sesion'], resultado: ['iniciada']
  },
  'federacion.sesion_revocada': {
    accion: ['revocar_sesion'], resultado: ['revocada']
  },
  'federacion.compatibilidad_comprobada': {
    accion: ['comprobar_compatibilidad'], resultado: ['compatible', 'incompatible']
  },
  'federacion.relacion_estado_cambiado': {
    accion: ['cambiar_estado_relacion'], resultado: ['actualizada']
  },
  'federacion.concesion_revisada': {
    accion: ['revisar_concesion'], resultado: ['revisada']
  },
  'federacion.credencial_rotada': {
    accion: ['rotar_credencial'], resultado: ['rotada']
  },
  'federacion.recuperacion_solicitada': {
    accion: ['solicitar_recuperacion'], resultado: ['solicitada']
  },
  'federacion.credencial_recuperada': {
    accion: ['recuperar_credencial'], resultado: ['recuperada']
  },
  'federacion.localizacion_propuesta': {
    accion: ['proponer_localizacion'], resultado: ['propuesta']
  },
  'federacion.localizacion_cambiada': {
    accion: ['cambiar_localizacion'], resultado: ['actualizada']
  },
  'federacion.responsabilidad_transferida': {
    accion: ['transferir_responsabilidad'], resultado: ['transferida']
  },
  'federacion.conflicto_identidad_detectado': {
    accion: ['detectar_conflicto_identidad'], resultado: ['detectado']
  },
  'federacion.conflicto_identidad_resuelto': {
    accion: ['resolver_conflicto_identidad'], resultado: ['resuelto']
  },
  'federacion.resincronizacion_solicitada': {
    accion: ['solicitar_resincronizacion'], resultado: ['solicitada']
  },
  'federacion.reconstruccion_decidida': {
    accion: [
      'iniciar_reconstruccion','esperar_candidata','ampliar_candidata',
      'sustituir_candidatas','cancelar_candidata','promover_candidata',
      'revalidar_candidata'
    ],
    resultado: [
      'creada','espera','ampliada','sustituida','cancelada','promovida','revalidada'
    ]
  },
  'federacion.ruta_excluida': {
    accion: ['excluir_ruta'], resultado: ['excluida']
  },
  'federacion.consolidacion_estados_remotos_iniciada': {
    accion: ['iniciar_consolidacion_estados_remotos'], resultado: ['iniciada']
  },
  'federacion.consolidacion_estados_remotos_finalizada': {
    accion: ['finalizar_consolidacion_estados_remotos'], resultado: ['finalizada']
  },
  'federacion.estado_temporal_remoto_cambiado': {
    accion: ['cambiar_estado_temporal_remoto'], resultado: ['actualizado']
  },
  'federacion.lote_emitido': {
    direccion: ['emision'], resultado: ['emitido'], codigo: [null]
  },
  'federacion.lote_recibido': {
    direccion: ['recepcion'], resultado: ['persistido'], codigo: [null]
  },
  'federacion.lote_confirmado': {
    direccion: ['recepcion'], resultado: ['confirmado'], codigo: [null]
  },
  'federacion.lote_rechazado': {
    direccion: ['recepcion'],
    resultado: ['rechazado'],
    codigo: ['incompatible', 'no_autorizado', 'payload_invalido', 'saturado']
  },
  'federacion.divergencia_detectada': {
    direccion: ['recepcion'], resultado: ['divergente'], codigo: ['divergencia']
  }
});

export const TRANSICIONES_ESTADO_POR_TIPO = congelar({
  'usuario.estado_cambiado': [['activo', 'inactivo'], ['inactivo', 'activo']],
  'usuario.email_validado': [['no_validado', 'validado']],
  'agente.estado_administrativo_cambiado': [
    ['activo', 'deshabilitado'],
    ['deshabilitado', 'activo']
  ],
  'agente.perfil_servidor_retirado': [
    ['pendiente_primera_evidencia', 'retirado'],
    ['activo', 'retirado']
  ],
  'agente.perfil_servidor_desactivado': [
    ['pendiente_primera_evidencia', 'desactivado_incompatible'],
    ['activo', 'desactivado_incompatible']
  ],
  'agente.cuarentena_activada': [['normal', 'cuarentena']],
  'agente.cuarentena_desactivada': [['cuarentena', 'normal']],
  'regla_telemetria.estado_cambiado': [
    ['activa', 'deshabilitada'],
    ['deshabilitada', 'activa']
  ]
});

const PERFIL_POR_TIPO = new Map();
for (const [perfil, tipos] of Object.entries(TIPOS_POR_PERFIL)) {
  for (const tipo of tipos) {
    if (PERFIL_POR_TIPO.has(tipo)) {
      throw new Error(`El tipo auditable ${tipo} tiene más de un perfil.`);
    }
    PERFIL_POR_TIPO.set(tipo, perfil);
  }
}

const FLUJO_POR_TIPO = new Map();
for (const [flujo, tipos] of Object.entries(TIPOS_POR_FLUJO)) {
  for (const tipo of tipos) {
    FLUJO_POR_TIPO.set(tipo, flujo);
  }
}

function resolverSujetoBase(tipo) {
  for (const [prefijo, sujeto] of Object.entries(SUJETOS_POR_PREFIJO)) {
    if (tipo.startsWith(prefijo)) {
      return sujeto;
    }
  }
  return null;
}

function resolverParejasBase(tipo) {
  if (PAREJAS_ACTOR_ORIGEN_ESPECIALES[tipo]) {
    return PAREJAS_ACTOR_ORIGEN_ESPECIALES[tipo];
  }
  if (tipo.startsWith('alerta.') && !tipo.includes('descarte_aplicado')) {
    return [['runtime', 'runtime']];
  }
  return [['usuario', 'web']];
}

function construirDefinicionTipo(tipo) {
  const especial = POLITICAS_ESPECIALES[tipo] || {};
  const esTransversal = TIPOS_TRANSVERSALES.includes(tipo);
  const flujo = FLUJO_POR_TIPO.get(tipo) || null;
  const parejas = especial.parejas || resolverParejasBase(tipo);
  const productores = especial.productores || ['portal_web'];
  const emisiones = especial.emisiones || parejas.flatMap(([actor, origen]) =>
    productores.map((productor) => ({ actor, origen, productor }))
  );
  return congelar({
    tipo,
    versionContrato:
      tipo.startsWith('federacion.') || tipo.startsWith('plataforma.aviso_')
        ? VERSION_CONTRATO_AUDITORIA_FEDERACION
        : VERSION_CONTRATO_AUDITORIA,
    perfil: PERFIL_POR_TIPO.get(tipo),
    perfilesPorProductor: especial.perfilesPorProductor || {},
    flujo: esTransversal ? null : flujo,
    reglaFlujo:
      tipo === 'cadena.iniciada'
        ? 'flujo_cabecera'
        : tipo.startsWith('scope.')
          ? 'tipo_sujeto'
          : 'fijo',
    parejasActorOrigen: parejas.map(([actor, origen]) => ({ actor, origen })),
    sujetos: especial.sujetos || [resolverSujetoBase(tipo)],
    productores,
    emisionesPermitidas: emisiones.map((emision) => {
      if (Array.isArray(emision)) {
        const [actor, origen, productor] = emision;
        return { actor, origen, productor };
      }
      return emision;
    }),
    roles: especial.roles || ['principal'],
    fuenteClaveOperacion:
      especial.fuenteClaveOperacion || 'UUIDv7 generado antes de mutar'
  });
}

const TODOS_LOS_TIPOS = [
  ...Object.values(TIPOS_POR_FLUJO).flat(),
  ...TIPOS_TRANSVERSALES
];

export const CATALOGO_TIPOS_EVENTO_AUDITORIA = congelar(
  TODOS_LOS_TIPOS.map(construirDefinicionTipo)
);

const DEFINICIONES_POR_TIPO = new Map(
  CATALOGO_TIPOS_EVENTO_AUDITORIA.map((definicion) => [
    definicion.tipo,
    definicion
  ])
);

validarIntegridadInterna();

export function listarTiposEventoAuditoria() {
  return [...DEFINICIONES_POR_TIPO.keys()];
}

export function obtenerDefinicionTipoEventoAuditoria(tipo) {
  return DEFINICIONES_POR_TIPO.get(String(tipo || '').trim()) || null;
}

export function resolverFlujoEventoAuditoria(tipo, sujetoTipo = null, flujoCabecera = null) {
  const definicion = obtenerDefinicionTipoEventoAuditoria(tipo);
  if (!definicion) {
    throw new Error(`Tipo de evento auditable desconocido: ${tipo}.`);
  }
  if (definicion.reglaFlujo === 'fijo') {
    return definicion.flujo;
  }
  if (definicion.reglaFlujo === 'flujo_cabecera') {
    if (!FLUJOS_AUDITORIA.includes(flujoCabecera)) {
      throw new Error('La génesis exige el flujo válido de su cabecera.');
    }
    return flujoCabecera;
  }
  const flujo = FLUJO_MOVIMIENTO_POR_SUJETO[sujetoTipo];
  if (!flujo) {
    throw new Error(`El sujeto ${sujetoTipo} no admite movimientos auditables.`);
  }
  return flujo;
}

export function construirClaveCadenaAuditoria({ flujo, tenantId = null } = {}) {
  if (!FLUJOS_AUDITORIA.includes(flujo)) {
    throw new Error(`Flujo auditable desconocido: ${flujo}.`);
  }
  if (tenantId == null) {
    return CLAVES_CADENA_POR_FLUJO[flujo].portal;
  }
  if (flujo === 'internet') {
    throw new Error('El flujo internet solo admite la cadena portal.');
  }
  const id = String(tenantId);
  if (!/^[1-9][0-9]*$/.test(id)) {
    throw new Error('tenantId debe ser un string decimal canónico positivo.');
  }
  return `${flujo}:tenant:${id}`;
}

export function esClaveCadenaAuditoria(valor) {
  if (typeof valor !== 'string') return false;
  const partes = valor.split(':');
  if (!FLUJOS_AUDITORIA.includes(partes[0])) return false;
  if (partes.length === 2) return partes[1] === 'portal';
  return partes.length === 3 &&
    partes[1] === 'tenant' &&
    /^[1-9][0-9]*$/.test(partes[2]);
}

function validarIntegridadInterna() {
  const tiposUnicos = new Set(TODOS_LOS_TIPOS);
  if (tiposUnicos.size !== TODOS_LOS_TIPOS.length) {
    throw new Error('El catálogo auditable contiene tipos duplicados.');
  }
  for (const tipo of TODOS_LOS_TIPOS) {
    const definicion = DEFINICIONES_POR_TIPO.get(tipo);
    if (!definicion?.perfil || !PERFILES_PAYLOAD_AUDITORIA[definicion.perfil]) {
      throw new Error(`El tipo ${tipo} no tiene exactamente un perfil conocido.`);
    }
    for (const [productor, perfil] of Object.entries(
      definicion.perfilesPorProductor
    )) {
      if (!definicion.productores.includes(productor) ||
          !PERFILES_PAYLOAD_AUDITORIA[perfil]) {
        throw new Error(`El tipo ${tipo} declara un perfil alternativo inválido.`);
      }
    }
    if (!definicion.sujetos.length || definicion.sujetos.some((s) => !SUJETOS_AUDITORIA.includes(s))) {
      throw new Error(`El tipo ${tipo} declara sujetos inválidos.`);
    }
    if (!definicion.roles.length || !definicion.productores.length) {
      throw new Error(`El tipo ${tipo} carece de productor o rol.`);
    }
    if (!definicion.emisionesPermitidas.length) {
      throw new Error(`El tipo ${tipo} carece de fronteras de emisión.`);
    }
    for (const emision of definicion.emisionesPermitidas) {
      if (
        !definicion.parejasActorOrigen.some(
          (pareja) =>
            pareja.actor === emision.actor && pareja.origen === emision.origen
        ) ||
        !definicion.productores.includes(emision.productor)
      ) {
        throw new Error(`El tipo ${tipo} declara una frontera incoherente.`);
      }
    }
    for (const { actor, origen } of definicion.parejasActorOrigen) {
      if (!ACTORES_AUDITORIA.includes(actor) || !ORIGENES_AUDITORIA.includes(origen)) {
        throw new Error(`El tipo ${tipo} declara actor u origen inválidos.`);
      }
    }
  }
}

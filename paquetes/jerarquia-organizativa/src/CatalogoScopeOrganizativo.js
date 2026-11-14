export const CATALOGO_TABLAS_SCOPE_ORGANIZATIVO = Object.freeze([
  {
    tabla: 'empresas',
    etiqueta: 'Empresas',
    columnasScope: ['tenant_id'],
    categoriaDatos: 'vivo',
    actualizableEnCambioTenantEmpresa: true
  },
  {
    tabla: 'sitios',
    etiqueta: 'Sitios',
    columnasScope: ['tenant_id', 'empresa_id'],
    categoriaDatos: 'vivo',
    actualizableEnCambioTenantEmpresa: true
  },
  {
    tabla: 'usuarios',
    etiqueta: 'Usuarios',
    columnasScope: ['tenant_id', 'empresa_id', 'sitio_id'],
    categoriaDatos: 'vivo',
    actualizableEnCambioTenantEmpresa: true
  },
  {
    tabla: 'monitores',
    etiqueta: 'Monitores',
    columnasScope: ['tenant_id', 'empresa_id', 'sitio_id'],
    categoriaDatos: 'vivo',
    actualizableEnCambioTenantEmpresa: true
  },
  {
    tabla: 'alertas_activas_monitores',
    etiqueta: 'Alertas activas de monitores',
    columnasScope: ['tenant_id', 'empresa_id', 'sitio_id'],
    categoriaDatos: 'vivo',
    actualizableEnCambioTenantEmpresa: true
  },
  {
    tabla: 'eventos_monitores',
    etiqueta: 'Eventos de monitores',
    columnasScope: ['tenant_id', 'empresa_id', 'sitio_id'],
    categoriaDatos: 'historico',
    actualizableEnCambioTenantEmpresa: true
  },
  {
    tabla: 'historico_monitores',
    etiqueta: 'Historico de monitores',
    columnasScope: ['tenant_id', 'empresa_id', 'sitio_id'],
    categoriaDatos: 'historico',
    actualizableEnCambioTenantEmpresa: true
  },
  {
    tabla: 'triggers',
    etiqueta: 'Triggers',
    columnasScope: ['tenant_id', 'empresa_id', 'sitio_id'],
    categoriaDatos: 'vivo',
    actualizableEnCambioTenantEmpresa: true
  },
  {
    tabla: 'ejecuciones_triggers',
    etiqueta: 'Ejecuciones de triggers',
    columnasScope: ['tenant_id', 'empresa_id', 'sitio_id'],
    categoriaDatos: 'historico',
    actualizableEnCambioTenantEmpresa: true
  },
  {
    tabla: 'zonas_dns',
    etiqueta: 'Zonas DNS',
    columnasScope: ['tenant_id', 'empresa_id', 'sitio_id'],
    categoriaDatos: 'vivo',
    actualizableEnCambioTenantEmpresa: true
  },
  {
    tabla: 'registros_dns',
    etiqueta: 'Registros DNS',
    columnasScope: ['tenant_id', 'empresa_id', 'sitio_id'],
    categoriaDatos: 'vivo',
    actualizableEnCambioTenantEmpresa: true
  },
  {
    tabla: 'agentes_sentinelia',
    etiqueta: 'Agentes Sentinelia',
    columnasScope: ['tenant_id', 'empresa_id', 'sitio_id'],
    categoriaDatos: 'vivo',
    actualizableEnCambioTenantEmpresa: true
  },
  {
    tabla: 'reglas_derivacion_telemetria',
    etiqueta: 'Reglas de interpretación de telemetría',
    columnasScope: ['tenant_id', 'empresa_id', 'sitio_id'],
    categoriaDatos: 'vivo',
    actualizableEnCambioTenantEmpresa: true
  },
  {
    tabla: 'estado_actual_evaluacion_reglas_telemetria',
    etiqueta: 'Estado actual de reglas de telemetría',
    columnasScope: ['tenant_id', 'empresa_id', 'sitio_id'],
    categoriaDatos: 'vivo',
    actualizableEnCambioTenantEmpresa: true
  },
  {
    tabla: 'trabajos_evaluacion_telemetria',
    etiqueta: 'Trabajos de evaluación de telemetría',
    columnasScope: ['tenant_id', 'empresa_id', 'sitio_id'],
    categoriaDatos: 'vivo',
    actualizableEnCambioTenantEmpresa: true
  },
  {
    tabla: 'vinculos_monitores_telemetria',
    etiqueta: 'Vínculos de monitores de telemetría',
    columnasScope: ['tenant_id', 'empresa_id', 'sitio_id'],
    categoriaDatos: 'vivo',
    actualizableEnCambioTenantEmpresa: true
  },
  {
    tabla: 'eventos_derivados_telemetria',
    etiqueta: 'Eventos derivados de telemetría',
    columnasScope: ['tenant_id', 'empresa_id', 'sitio_id'],
    categoriaDatos: 'historico',
    actualizableEnCambioTenantEmpresa: true
  },
  {
    tabla: 'evaluaciones_reglas_telemetria',
    etiqueta: 'Evaluaciones de reglas de telemetría',
    columnasScope: ['tenant_id', 'empresa_id', 'sitio_id'],
    categoriaDatos: 'historico',
    actualizableEnCambioTenantEmpresa: true
  }
]);

const CLASIFICACIONES_TECNICAS = new Set([
  'estado_actual_evaluacion_reglas_telemetria',
  'trabajos_evaluacion_telemetria'
]);

const CLASES_SEMANTICAS_ESPECIALES = Object.freeze({
  alertas_activas_monitores: 'alertas_activas',
  agentes_sentinelia: 'agentes',
  reglas_derivacion_telemetria: 'reglas_telemetria',
  estado_actual_evaluacion_reglas_telemetria: 'estados_evaluacion_telemetria'
});

export const DENYLIST_TABLAS_SCOPE_ORGANIZATIVO = Object.freeze([
  'cadenas_auditoria',
  'eventos_auditoria',
  'checkpoints_auditoria',
  'identidades_idempotentes_auditoria',
  'tombstones_identidad_auditoria',
  'sesiones_web_auditoria',
  'operaciones_sesion_agente',
  'operaciones_sesion_agentes',
  'cabeceras_coordinacion_sesion_agentes',
  'identidades_request_id_sesion_agentes',
  'reservas_request_id_sesion_agentes',
  'migracion_sesiones_5_21',
  'cabecera_bootstrap_usuario_inicial',
  'estado_verificacion_correo',
  'estado_despliegue_trigger_correo',
  'destinatarios_triggers_correo',
  'notificaciones_triggers_correo',
  'resultados_destinatarios_triggers_correo',
  'capacidades_desuscripcion_correo',
  'cola_correos_salida',
  'reclamaciones_correos_salida',
  'intentos_correos_salida',
  'identidades_justificantes_correos_recuperacion_password',
  'cabecera_generacion_dns',
  'reconciliacion_inicial_dns',
  'operaciones_publicacion_dns',
  'vencimientos_descarte_alertas',
  'cabeceras_outbox_auditoria_runtime',
  'outbox_auditoria_runtime',
  'cabecera_verificacion_auditoria',
  'incidentes_integridad_auditoria',
  'identidad_instalacion_federacion',
  'arranques_instalacion_federacion',
  'catalogo_causas_avisos_plataforma',
  'avisos_plataforma',
  'historico_avisos_plataforma',
  'relaciones_federacion',
  'historico_estados_relaciones_federacion',
  'localizaciones_relaciones_federacion',
  'revisiones_concesion_federacion',
  'selectores_revision_concesion_federacion',
  'estado_concesion_relaciones_federacion',
  'cortes_autoridad_federacion',
  'tombstones_relaciones_federacion',
  'identidades_estructura_organizativa_federacion',
  'identidades_contexto_operativo_agentes_federacion',
  'identidades_elementos_telemetria_federacion',
  'identidades_elementos_monitores_federacion',
  'identidades_triggers_referenciados_federacion',
  'identidades_registros_triggers_federacion',
  'identidades_elementos_avisos_federacion',
  'identidades_eventos_auditoria_federacion'
]);

export const MANIFIESTO_FISICO_SCOPE_ORGANIZATIVO = Object.freeze([
  ...CATALOGO_TABLAS_SCOPE_ORGANIZATIVO.map((entrada) => Object.freeze({
    tabla: entrada.tabla,
    columnasScope: Object.freeze([...entrada.columnasScope]),
    clasificacion: CLASIFICACIONES_TECNICAS.has(entrada.tabla)
      ? 'tecnica_mutable'
      : entrada.categoriaDatos === 'historico' ? 'historica' : 'viva',
    disposicion: 'participa_cascada'
  })),
  Object.freeze({
    tabla: 'cadenas_auditoria',
    columnasScope: Object.freeze(['tenant_id']),
    clasificacion: 'persistencia_protegida',
    disposicion: 'fuera_cascada'
  }),
  Object.freeze({
    tabla: 'cabeceras_outbox_auditoria_runtime',
    columnasScope: Object.freeze(['tenant_id']),
    clasificacion: 'persistencia_protegida',
    disposicion: 'fuera_cascada'
  }),
  Object.freeze({
    tabla: 'avisos_plataforma',
    columnasScope: Object.freeze([
      'scope_tenant_id',
      'scope_empresa_id',
      'scope_sitio_id'
    ]),
    clasificacion: 'persistencia_protegida',
    disposicion: 'fuera_cascada'
  }),
  Object.freeze({
    tabla: 'relaciones_federacion',
    columnasScope: Object.freeze([
      'scope_tenant_id',
      'scope_empresa_id',
      'scope_sitio_id'
    ]),
    clasificacion: 'persistencia_protegida',
    disposicion: 'fuera_cascada'
  }),
  Object.freeze({
    tabla: 'cortes_autoridad_federacion',
    columnasScope: Object.freeze([
      'scope_tenant_id',
      'scope_empresa_id',
      'scope_sitio_id'
    ]),
    clasificacion: 'persistencia_protegida',
    disposicion: 'fuera_cascada'
  }),
  Object.freeze({
    tabla: 'identidades_estructura_organizativa_federacion',
    columnasScope: Object.freeze([
      'scope_tenant_id',
      'scope_empresa_id',
      'scope_sitio_id'
    ]),
    clasificacion: 'persistencia_protegida',
    disposicion: 'fuera_cascada'
  }),
  Object.freeze({
    tabla: 'identidades_contexto_operativo_agentes_federacion',
    columnasScope: Object.freeze([
      'scope_tenant_id',
      'scope_empresa_id',
      'scope_sitio_id'
    ]),
    clasificacion: 'persistencia_protegida',
    disposicion: 'fuera_cascada'
  }),
  Object.freeze({
    tabla: 'identidades_elementos_telemetria_federacion',
    columnasScope: Object.freeze([
      'scope_tenant_id',
      'scope_empresa_id',
      'scope_sitio_id'
    ]),
    clasificacion: 'persistencia_protegida',
    disposicion: 'fuera_cascada'
  }),
  Object.freeze({
    tabla: 'identidades_elementos_monitores_federacion',
    columnasScope: Object.freeze([
      'scope_tenant_id',
      'scope_empresa_id',
      'scope_sitio_id'
    ]),
    clasificacion: 'persistencia_protegida',
    disposicion: 'fuera_cascada'
  }),
  Object.freeze({
    tabla: 'identidades_triggers_referenciados_federacion',
    columnasScope: Object.freeze([
      'scope_tenant_id',
      'scope_empresa_id',
      'scope_sitio_id'
    ]),
    clasificacion: 'persistencia_protegida',
    disposicion: 'fuera_cascada'
  }),
  Object.freeze({
    tabla: 'identidades_registros_triggers_federacion',
    columnasScope: Object.freeze([
      'scope_tenant_id',
      'scope_empresa_id',
      'scope_sitio_id'
    ]),
    clasificacion: 'persistencia_protegida',
    disposicion: 'fuera_cascada'
  }),
  Object.freeze({
    tabla: 'identidades_elementos_avisos_federacion',
    columnasScope: Object.freeze([
      'scope_tenant_id',
      'scope_empresa_id',
      'scope_sitio_id'
    ]),
    clasificacion: 'persistencia_protegida',
    disposicion: 'fuera_cascada'
  }),
  Object.freeze({
    tabla: 'identidades_eventos_auditoria_federacion',
    columnasScope: Object.freeze([
      'scope_tenant_id',
      'scope_empresa_id',
      'scope_sitio_id'
    ]),
    clasificacion: 'persistencia_protegida',
    disposicion: 'fuera_cascada'
  })
]);

const MANIFIESTO_POR_TABLA = new Map(
  MANIFIESTO_FISICO_SCOPE_ORGANIZATIVO.map((entrada) => [entrada.tabla, entrada])
);

export function resolverDisposicionFisicaScopeOrganizativo(tabla) {
  return MANIFIESTO_POR_TABLA.get(String(tabla || '').trim()) || null;
}

export function resolverClaseSemanticaScopeOrganizativo(tabla) {
  const nombre = String(tabla || '').trim();
  if (!MANIFIESTO_POR_TABLA.has(nombre) ||
      MANIFIESTO_POR_TABLA.get(nombre).disposicion !== 'participa_cascada') {
    return null;
  }
  return CLASES_SEMANTICAS_ESPECIALES[nombre] || nombre;
}

export function verificarCoberturaFisicaScopeOrganizativo(tablasFisicas = []) {
  const fisicas = new Set(tablasFisicas.map((tabla) => String(tabla).trim()));
  const catalogadas = new Set(MANIFIESTO_POR_TABLA.keys());
  const sinDisposicion = [...fisicas].filter((tabla) => !catalogadas.has(tabla)).sort();
  const ausentesEnEsquema = [...catalogadas].filter((tabla) => !fisicas.has(tabla)).sort();
  if (sinDisposicion.length || ausentesEnEsquema.length) {
    throw new Error(
      `Catálogo físico de scope incoherente. Sin disposición: ${sinDisposicion.join(', ') || 'ninguna'}. ` +
      `Ausentes en esquema: ${ausentesEnEsquema.join(', ') || 'ninguna'}.`
    );
  }
  for (const entrada of MANIFIESTO_FISICO_SCOPE_ORGANIZATIVO) {
    if (entrada.disposicion === 'fuera_cascada' &&
        !DENYLIST_TABLAS_SCOPE_ORGANIZATIVO.includes(entrada.tabla)) {
      throw new Error(`${entrada.tabla} está protegida pero no figura en la denylist.`);
    }
  }
  return Object.freeze({
    total: fisicas.size,
    vivas: contarClasificacion('viva'),
    historicas: contarClasificacion('historica'),
    tecnicasMutables: contarClasificacion('tecnica_mutable'),
    protegidas: contarClasificacion('persistencia_protegida'),
    sinDisposicion: Object.freeze([])
  });
}

function contarClasificacion(clasificacion) {
  return MANIFIESTO_FISICO_SCOPE_ORGANIZATIVO
    .filter((entrada) => entrada.clasificacion === clasificacion).length;
}

function extraerTablasPorColumna(columna) {
  return Object.freeze(
    CATALOGO_TABLAS_SCOPE_ORGANIZATIVO
      .filter((item) => item.columnasScope.includes(columna))
      .map((item) => item.tabla)
  );
}

function extraerTablasCambioTenantEmpresa({ categoriaDatos, actualizable }) {
  return Object.freeze(
    CATALOGO_TABLAS_SCOPE_ORGANIZATIVO
      .filter((item) => {
        if (categoriaDatos && item.categoriaDatos !== categoriaDatos) {
          return false;
        }

        if (
          typeof actualizable === 'boolean' &&
          item.actualizableEnCambioTenantEmpresa !== actualizable
        ) {
          return false;
        }

        return true;
      })
      .map((item) => item.tabla)
  );
}

export const TABLAS_CON_TENANT_ID = extraerTablasPorColumna('tenant_id');
export const TABLAS_CON_EMPRESA_ID = extraerTablasPorColumna('empresa_id');
export const TABLAS_CON_SITIO_ID = extraerTablasPorColumna('sitio_id');

export const TABLAS_VIVAS_CAMBIO_TENANT_EMPRESA =
  extraerTablasCambioTenantEmpresa({
    categoriaDatos: 'vivo',
    actualizable: true
  });

export const TABLAS_HISTORICAS_CAMBIO_TENANT_EMPRESA =
  extraerTablasCambioTenantEmpresa({
    categoriaDatos: 'historico',
    actualizable: true
  });

export const TABLAS_VIVAS_CAMBIO_EMPRESA_SITIO = Object.freeze(
  CATALOGO_TABLAS_SCOPE_ORGANIZATIVO
    .filter((item) => (
      item.categoriaDatos === 'vivo' &&
      item.columnasScope.includes('sitio_id')
    ))
    .map((item) => item.tabla)
);

export const TABLAS_HISTORICAS_CAMBIO_EMPRESA_SITIO = Object.freeze(
  CATALOGO_TABLAS_SCOPE_ORGANIZATIVO
    .filter((item) => (
      item.categoriaDatos === 'historico' &&
      item.columnasScope.includes('sitio_id')
    ))
    .map((item) => item.tabla)
);

export const ETIQUETAS_TABLAS_SCOPE_ORGANIZATIVO = Object.freeze(
  Object.fromEntries(
    CATALOGO_TABLAS_SCOPE_ORGANIZATIVO.map((item) => [item.tabla, item.etiqueta])
  )
);

export const METADATOS_TABLAS_SCOPE_ORGANIZATIVO = Object.freeze(
  Object.fromEntries(
    CATALOGO_TABLAS_SCOPE_ORGANIZATIVO.map((item) => [item.tabla, item])
  )
);

export function resolverEtiquetaTablaScopeOrganizativo(tabla) {
  return ETIQUETAS_TABLAS_SCOPE_ORGANIZATIVO[tabla] || tabla;
}

export function resolverMetadatosTablaScopeOrganizativo(tabla) {
  return METADATOS_TABLAS_SCOPE_ORGANIZATIVO[tabla] || null;
}

export function tablaTieneTenantId(tabla) {
  return Boolean(
    resolverMetadatosTablaScopeOrganizativo(tabla)?.columnasScope?.includes(
      'tenant_id'
    )
  );
}

export function tablaTieneEmpresaId(tabla) {
  return Boolean(
    resolverMetadatosTablaScopeOrganizativo(tabla)?.columnasScope?.includes(
      'empresa_id'
    )
  );
}

export function tablaTieneSitioId(tabla) {
  return Boolean(
    resolverMetadatosTablaScopeOrganizativo(tabla)?.columnasScope?.includes(
      'sitio_id'
    )
  );
}

const congelarTiposColumnas = (columnas) => Object.freeze(
  Object.fromEntries(Object.entries(columnas).map(([nombre, tipo]) => [
    nombre,
    Array.isArray(tipo) ? Object.freeze([...tipo]) : tipo
  ]))
);

const definir = ({
  tipo = 'tabla',
  tabla,
  collation = null,
  columnas,
  atributosColumnas = {},
  indices,
  checks = [],
  foraneas = [],
  tablasAdicionales = [],
  triggersAdicionales = [],
  validacionesDatos = []
}) =>
  Object.freeze({
    tipo,
    tabla: Array.isArray(tabla) ? Object.freeze([...tabla]) : tabla,
    collation,
    columnas: congelarTiposColumnas(columnas),
    atributosColumnas: Object.freeze({ ...atributosColumnas }),
    indices: Object.freeze(indices.map((indice) => Object.freeze({
      ...indice,
      columnas: Object.freeze([...indice.columnas]),
      columnasAlternativas: Object.freeze(
        (indice.columnasAlternativas || []).map((columnas) =>
          Object.freeze([...columnas])
        )
      )
    }))),
    checks: Object.freeze([...checks]),
    foraneas: Object.freeze(foraneas.map((foranea) => Object.freeze({ ...foranea }))),
    tablasAdicionales: Object.freeze(tablasAdicionales.map((adicional) =>
      Object.freeze({
        tabla: adicional.tabla,
        collation: adicional.collation || null,
        columnas: congelarTiposColumnas(adicional.columnas),
        atributosColumnas: Object.freeze({ ...(adicional.atributosColumnas || {}) }),
        indices: Object.freeze((adicional.indices || []).map((indice) => Object.freeze({
          ...indice,
          columnas: Object.freeze([...indice.columnas]),
          columnasAlternativas: Object.freeze(
            (indice.columnasAlternativas || []).map((columnas) =>
              Object.freeze([...columnas])
            )
          )
        }))),
        checks: Object.freeze([...(adicional.checks || [])]),
        foraneas: Object.freeze(
          (adicional.foraneas || []).map((foranea) => Object.freeze({ ...foranea }))
        )
      })
    )),
    triggersAdicionales: Object.freeze(
      triggersAdicionales.map((trigger) => Object.freeze({
        ...trigger,
        trigger: Array.isArray(trigger.trigger)
          ? Object.freeze([...trigger.trigger])
          : trigger.trigger,
        tabla: Array.isArray(trigger.tabla)
          ? Object.freeze([...trigger.tabla])
          : trigger.tabla
      }))
    ),
    validacionesDatos: Object.freeze(
      validacionesDatos.map((validacion) => Object.freeze({ ...validacion }))
    )
  });

const definirTrigger = ({ trigger, tabla, momento, evento }) =>
  Object.freeze({ tipo: 'trigger', trigger, tabla, momento, evento });

const BOOLEANO_DENEGADO_POR_DEFECTO = Object.freeze({
  nullable: false,
  valorPorDefecto: '0'
});

export const POSTCONDICIONES_MIGRACIONES = Object.freeze({
  '0252_historificar_planes_federados_pendientes.sql': definir({
    tabla: 'versiones_planes_flujos_federacion',
    columnas: { flujo_id: 'varchar(64)', revision_efectiva_id: 'char(47)',
      generacion_id: 'varchar(64)' },
    indices: [
      { nombre: 'PRIMARY', unico: true, columnas: ['flujo_id', 'revision_efectiva_id'] },
      { nombre: 'uk_version_plan_identidad', unico: true,
        columnas: ['flujo_id', 'revision_efectiva_id', 'generacion_id'] }
    ],
    foraneas: [
      { nombre: 'fk_version_plan_flujo', tablaReferenciada: 'reconciliaciones_flujos_concesion_federacion', alBorrar: 'RESTRICT', alActualizar: 'RESTRICT' },
      { nombre: 'fk_version_plan_revision', tablaReferenciada: 'revisiones_concesion_federacion', alBorrar: 'RESTRICT', alActualizar: 'RESTRICT' }
    ],
    tablasAdicionales: [{
      tabla: 'historico_reconciliaciones_flujos_concesion_federacion',
      columnas: { flujo_id: 'varchar(64)', revision_efectiva_id: 'char(47)', generacion_id: 'varchar(64)' },
      foraneas: [{ nombre: 'fk_historico_reconciliacion_version_plan', tablaReferenciada: 'versiones_planes_flujos_federacion', alBorrar: 'RESTRICT', alActualizar: 'RESTRICT' }]
    }],
    triggersAdicionales: [{ trigger: 'trg_version_plan_federacion_inmutable',
      tabla: 'versiones_planes_flujos_federacion', momento: 'BEFORE', evento: 'UPDATE' }]
  }),
  '0251_estado_aplicado_zonas_dns.sql': definir({
    tipo: 'alteracion_tabla', tabla: 'zonas_dns',
    columnas: {
      generacion_aplicada_bind: 'bigint(20) unsigned',
      version_aplicada_bind: 'bigint(20) unsigned'
    },
    indices: [], checks: ['chk_zonas_dns_version_aplicada_bind'],
    tablasAdicionales: [{
      tabla: 'operaciones_publicacion_dns', columnas: { fotografia_zonas: 'longtext' },
      indices: [], checks: ['chk_operaciones_dns_fotografia_zonas']
    }],
    triggersAdicionales: [{
      trigger: 'trg_operaciones_dns_fotografia_zonas_inmutable',
      tabla: 'operaciones_publicacion_dns', momento: 'BEFORE', evento: 'UPDATE'
    }]
  }),
  '0049_crear_cadenas_auditoria.sql': definir({
    tabla: 'cadenas_auditoria',
    columnas: {
      id: 'bigint(20) unsigned',
      clave_cadena: 'varchar(128)',
      tenant_id: 'bigint(20) unsigned',
      ultima_secuencia: 'bigint(20) unsigned',
      ultimo_hash: 'binary(32)',
      fecha_creacion_utc: 'datetime(3)',
      fecha_actualizacion_utc: 'datetime(3)'
    },
    indices: [
      { nombre: 'PRIMARY', unico: true, columnas: ['id'] },
      { nombre: 'uk_cadenas_auditoria_clave', unico: true, columnas: ['clave_cadena'] },
      { nombre: 'uk_cadenas_auditoria_id_clave_flujo', unico: true, columnas: ['id', 'clave_cadena', 'flujo'] }
    ],
    checks: ['chk_cadenas_auditoria_clave_scope', 'chk_cadenas_auditoria_secuencia']
  }),
  '0050_crear_eventos_auditoria.sql': definir({
    tabla: 'eventos_auditoria',
    columnas: {
      id: 'bigint(20) unsigned',
      evento_id: 'binary(16)',
      cadena_id: 'bigint(20) unsigned',
      tipo_evento: 'varchar(96)',
      version_contrato: 'smallint(5) unsigned',
      clave_cadena: 'varchar(128)',
      secuencia: 'bigint(20) unsigned',
      actor_real_id: 'varchar(128)',
      actor_efectivo_id: 'varchar(128)',
      sujeto_id: 'varchar(191)',
      scope_tenant_id: 'bigint(20) unsigned',
      correlacion_id: 'binary(16)',
      clave_operacion: 'varbinary(128)',
      efectivo_en_utc: 'datetime(3)',
      registrado_en_utc: 'datetime(3)',
      payload: 'longtext',
      hash_payload: 'binary(32)',
      hash_anterior: 'binary(32)',
      hash_actual: 'binary(32)'
    },
    indices: [
      { nombre: 'PRIMARY', unico: true, columnas: ['id'] },
      { nombre: 'uk_eventos_auditoria_evento', unico: true, columnas: ['evento_id'] },
      { nombre: 'uk_eventos_auditoria_cadena_secuencia', unico: true, columnas: ['cadena_id', 'secuencia'] },
      { nombre: 'idx_eventos_auditoria_cronologia', unico: false, columnas: ['registrado_en_utc', 'evento_id'] },
      { nombre: 'idx_eventos_auditoria_scope', unico: false, columnas: ['scope_tenant_id', 'scope_empresa_id', 'scope_sitio_id', 'registrado_en_utc', 'evento_id'] }
    ],
    checks: [
      'chk_eventos_auditoria_clave_scope',
      'chk_eventos_auditoria_scope_jerarquia',
      'chk_eventos_auditoria_actor_efectivo',
      'chk_eventos_auditoria_causalidad',
      'chk_eventos_auditoria_secuencia',
      'chk_eventos_auditoria_clave_operacion'
    ],
    foraneas: [
      {
        nombre: 'fk_eventos_auditoria_cadena',
        tablaReferenciada: 'cadenas_auditoria',
        alBorrar: 'RESTRICT',
        alActualizar: 'RESTRICT'
      }
    ]
  }),
  '0051_crear_identidades_idempotentes_auditoria.sql': definir({
    tabla: 'identidades_idempotentes_auditoria',
    columnas: {
      id: 'bigint(20) unsigned',
      clave_operacion: 'varbinary(128)',
      huella_intencion: 'binary(32)',
      evento_id: 'binary(16)',
      primera_observacion_utc: 'datetime(3)',
      retenido_en_utc: 'datetime(3)'
    },
    indices: [
      { nombre: 'PRIMARY', unico: true, columnas: ['id'] },
      { nombre: 'uk_identidades_auditoria_operacion', unico: true, columnas: ['productor', 'clave_operacion', 'rol_evento'] },
      { nombre: 'uk_identidades_auditoria_evento', unico: true, columnas: ['evento_id'] }
    ],
    checks: ['chk_identidades_auditoria_clave', 'chk_identidades_auditoria_retencion']
  }),
  '0052_crear_tombstones_identidad_auditoria.sql': definir({
    tabla: 'tombstones_identidad_auditoria',
    columnas: {
      huella_evento_id: 'binary(32)'
    },
    indices: [
      { nombre: 'PRIMARY', unico: true, columnas: ['huella_evento_id'] }
    ]
  }),
  '0053_crear_checkpoints_auditoria.sql': definir({
    tabla: 'checkpoints_auditoria',
    columnas: {
      id: 'bigint(20) unsigned',
      cadena_id: 'bigint(20) unsigned',
      ultima_secuencia_retirada: 'bigint(20) unsigned',
      hash_ultima_secuencia_retirada: 'binary(32)',
      primera_secuencia_conservada: 'bigint(20) unsigned',
      politica_dias: 'smallint(5) unsigned',
      aplicado_en_utc: 'datetime(3)',
      evento_retencion_id: 'binary(16)'
    },
    indices: [
      { nombre: 'PRIMARY', unico: true, columnas: ['id'] },
      { nombre: 'uk_checkpoints_auditoria_cadena', unico: true, columnas: ['cadena_id'] },
      { nombre: 'uk_checkpoints_auditoria_evento_retencion', unico: true, columnas: ['evento_retencion_id'] }
    ],
    checks: ['chk_checkpoints_auditoria_secuencias', 'chk_checkpoints_auditoria_politica'],
    foraneas: [
      {
        nombre: 'fk_checkpoints_auditoria_cadena',
        tablaReferenciada: 'cadenas_auditoria',
        alBorrar: 'RESTRICT',
        alActualizar: 'RESTRICT'
      }
    ]
  }),
  '0054_proteger_eventos_auditoria_append_only.sql': definirTrigger({
    trigger: 'trg_eventos_auditoria_impedir_update',
    tabla: 'eventos_auditoria',
    momento: 'BEFORE',
    evento: 'UPDATE'
  }),
  '0055_agregar_contraparte_eventos_auditoria.sql': definir({
    tipo: 'alteracion_tabla',
    tabla: 'eventos_auditoria',
    columnas: {
      evento_contraparte_id: 'binary(16)'
    },
    indices: [
      {
        nombre: 'idx_eventos_auditoria_contraparte',
        unico: false,
        columnas: ['evento_contraparte_id']
      }
    ],
    checks: ['chk_eventos_auditoria_contraparte']
  }),
  '0056_crear_cabeceras_outbox_auditoria_runtime.sql': definir({
    tabla: 'cabeceras_outbox_auditoria_runtime',
    columnas: {
      id: 'bigint(20) unsigned',
      clave_cadena: 'varchar(128)',
      tenant_id: 'bigint(20) unsigned',
      ultimo_orden: 'bigint(20) unsigned',
      creada_en_utc: 'datetime(3)',
      actualizada_en_utc: 'datetime(3)'
    },
    indices: [
      { nombre: 'PRIMARY', unico: true, columnas: ['id'] },
      {
        nombre: 'uk_cabeceras_outbox_auditoria_clave',
        unico: true,
        columnas: ['clave_cadena']
      },
      {
        nombre: 'uk_cabeceras_outbox_auditoria_id_clave',
        unico: true,
        columnas: ['id', 'clave_cadena']
      }
    ],
    checks: ['chk_cabeceras_outbox_auditoria_clave']
  }),
  '0057_crear_outbox_auditoria_runtime.sql': definir({
    tabla: 'outbox_auditoria_runtime',
    columnas: {
      id: 'bigint(20) unsigned',
      cabecera_id: 'bigint(20) unsigned',
      orden_obligacion: 'bigint(20) unsigned',
      evento_id: 'binary(16)',
      correlacion_id: 'binary(16)',
      clave_operacion: 'varbinary(128)',
      efectivo_en_utc: 'datetime(3)',
      payload: 'longtext',
      huella_intencion: 'binary(32)',
      intentos: 'smallint(5) unsigned',
      max_intentos: 'smallint(5) unsigned',
      proximo_intento_utc: 'datetime(3)',
      lease_token: 'binary(32)',
      lease_expira_utc: 'datetime(3)',
      fencing_token: 'bigint(20) unsigned',
      evento_incorporado_id: 'binary(16)',
      completada_en_utc: 'datetime(3)'
    },
    indices: [
      { nombre: 'PRIMARY', unico: true, columnas: ['id'] },
      {
        nombre: 'uk_outbox_auditoria_cadena_orden',
        unico: true,
        columnas: ['cabecera_id', 'orden_obligacion']
      },
      {
        nombre: 'uk_outbox_auditoria_evento',
        unico: true,
        columnas: ['evento_id']
      },
      {
        nombre: 'uk_outbox_auditoria_idempotencia',
        unico: true,
        columnas: ['productor', 'clave_operacion', 'rol_evento']
      },
      {
        nombre: 'idx_outbox_auditoria_fifo',
        unico: false,
        columnas: ['clave_cadena', 'estado', 'orden_obligacion']
      }
    ],
    checks: [
      'chk_outbox_auditoria_scope',
      'chk_outbox_auditoria_actor',
      'chk_outbox_auditoria_causalidad',
      'chk_outbox_auditoria_clave',
      'chk_outbox_auditoria_intentos',
      'chk_outbox_auditoria_estado'
    ],
    foraneas: [
      {
        nombre: 'fk_outbox_auditoria_cabecera',
        tablaReferenciada: 'cabeceras_outbox_auditoria_runtime',
        alBorrar: 'RESTRICT',
        alActualizar: 'RESTRICT'
      }
    ]
  }),
  '0058_proteger_contenido_outbox_auditoria_runtime.sql': definirTrigger({
    trigger: 'trg_outbox_auditoria_impedir_mutar_contenido',
    tabla: 'outbox_auditoria_runtime',
    momento: 'BEFORE',
    evento: 'UPDATE'
  }),
  '0059_proteger_borrado_outbox_auditoria_runtime.sql': definirTrigger({
    trigger: 'trg_outbox_auditoria_impedir_borrar_no_terminal',
    tabla: 'outbox_auditoria_runtime',
    momento: 'BEFORE',
    evento: 'DELETE'
  }),
  '0060_reforzar_transiciones_outbox_auditoria_runtime.sql': definirTrigger({
    trigger: 'trg_outbox_auditoria_impedir_mutar_contenido',
    tabla: 'outbox_auditoria_runtime',
    momento: 'BEFORE',
    evento: 'UPDATE'
  }),
  '0061_proteger_cabeceras_outbox_auditoria_runtime.sql': definirTrigger({
    trigger: 'trg_cabeceras_outbox_auditoria_impedir_regresion',
    tabla: 'cabeceras_outbox_auditoria_runtime',
    momento: 'BEFORE',
    evento: 'UPDATE'
  }),
  '0062_agregar_permiso_ver_auditoria_usuarios.sql': definir({
    tipo: 'alteracion_tabla',
    tabla: 'usuarios',
    columnas: {
      permiso_ver_auditoria: 'tinyint(1)'
    },
    atributosColumnas: {
      permiso_ver_auditoria: {
        nullable: false,
        valorPorDefecto: '0'
      }
    },
    indices: []
  }),
  '0102_agregar_permisos_federacion_usuarios.sql': definir({
    tipo: 'alteracion_tabla',
    tabla: 'usuarios',
    columnas: {
      permiso_configurar_emisiones_federacion: 'tinyint(1)',
      permiso_configurar_recepciones_federacion: 'tinyint(1)',
      permiso_activar_relaciones_federacion: 'tinyint(1)',
      permiso_gestionar_credenciales_federacion: 'tinyint(1)',
      permiso_transferir_responsabilidad_federacion: 'tinyint(1)',
      permiso_resolver_conflictos_federacion: 'tinyint(1)',
      permiso_ver_diagnostico_federacion: 'tinyint(1)',
      permiso_ver_avisos_plataforma: 'tinyint(1)',
      permiso_ver_alertas_remotas: 'tinyint(1)',
      preferencia_mostrar_alertas_remotas: 'tinyint(1)'
    },
    atributosColumnas: {
      permiso_configurar_emisiones_federacion: BOOLEANO_DENEGADO_POR_DEFECTO,
      permiso_configurar_recepciones_federacion: BOOLEANO_DENEGADO_POR_DEFECTO,
      permiso_activar_relaciones_federacion: BOOLEANO_DENEGADO_POR_DEFECTO,
      permiso_gestionar_credenciales_federacion: BOOLEANO_DENEGADO_POR_DEFECTO,
      permiso_transferir_responsabilidad_federacion: BOOLEANO_DENEGADO_POR_DEFECTO,
      permiso_resolver_conflictos_federacion: BOOLEANO_DENEGADO_POR_DEFECTO,
      permiso_ver_diagnostico_federacion: BOOLEANO_DENEGADO_POR_DEFECTO,
      permiso_ver_avisos_plataforma: BOOLEANO_DENEGADO_POR_DEFECTO,
      permiso_ver_alertas_remotas: BOOLEANO_DENEGADO_POR_DEFECTO,
      preferencia_mostrar_alertas_remotas: BOOLEANO_DENEGADO_POR_DEFECTO
    },
    indices: []
  }),
  '0103_ampliar_catalogos_auditoria_federacion.sql': definir({
    tipo: 'alteracion_tabla',
    tabla: 'eventos_auditoria',
    columnas: {
      flujo: "enum('sistema','usuarios','organizacion','agentes','monitores','alertas','automatizacion','dns','federacion')",
      actor_real_tipo: "enum('usuario','agente','runtime','sistema','instancia_remota')",
      sujeto_tipo: [
        "enum('usuario','sesion_usuario','agente','sesion_agente','regla_telemetria','monitor','alerta','trigger','binding_trigger','zona_dns','registro_dns','tenant','empresa','sitio','configuracion_portal','cadena_auditoria','incidente_integridad','instalacion_federada','relacion_federada','revision_concesion_federada','flujo_federado','lote_federado','proyeccion_federada','aviso_plataforma')",
        "enum('usuario','sesion_usuario','agente','sesion_agente','regla_telemetria','monitor','alerta','trigger','destinatario_trigger_correo','binding_trigger','zona_dns','registro_dns','tenant','empresa','sitio','configuracion_portal','cadena_auditoria','incidente_integridad','instalacion_federada','relacion_federada','revision_concesion_federada','flujo_federado','lote_federado','proyeccion_federada','aviso_plataforma')"
      ],
      origen: "enum('web','api_agentes','runtime','bootstrap','tarea_sistema','api_federacion')",
      causalidad_tipo: "enum('evento_auditoria','evento_monitor','ejecucion_trigger','operacion_sesion_agente','generacion_dns','relacion_federacion','ocurrencia_federacion','entrega_federacion','aviso_plataforma')",
      productor: [
        "enum('auditoria_nucleo','portal_web','api_agentes','runtime_alertas','runtime_automatizacion','runtime_dns','bootstrap','tarea_retencion','portal_federacion','api_federacion','runtime_federacion')",
        "enum('auditoria_nucleo','portal_web','api_agentes','runtime_alertas','runtime_automatizacion','runtime_dns','runtime_agentes','runtime_operaciones_administrativas','bootstrap','tarea_retencion','portal_federacion','api_federacion','runtime_federacion')"
      ]
    },
    indices: [],
    foraneas: [
      {
        nombre: 'fk_eventos_auditoria_cadena',
        tablaReferenciada: 'cadenas_auditoria',
        alBorrar: 'RESTRICT',
        alActualizar: 'RESTRICT'
      }
    ],
    tablasAdicionales: [
      {
        tabla: 'cadenas_auditoria',
        columnas: {
          flujo: "enum('sistema','usuarios','organizacion','agentes','monitores','alertas','automatizacion','dns','federacion')"
        }
      },
      {
        tabla: 'cabeceras_outbox_auditoria_runtime',
        columnas: {
          flujo: "enum('sistema','usuarios','organizacion','agentes','monitores','alertas','automatizacion','dns','federacion')"
        }
      },
      {
        tabla: 'outbox_auditoria_runtime',
        columnas: {
          flujo: "enum('sistema','usuarios','organizacion','agentes','monitores','alertas','automatizacion','dns','federacion')",
          sujeto_tipo: [
            "enum('usuario','sesion_usuario','agente','sesion_agente','regla_telemetria','monitor','alerta','trigger','binding_trigger','zona_dns','registro_dns','tenant','empresa','sitio','configuracion_portal','cadena_auditoria','incidente_integridad','instalacion_federada','relacion_federada','revision_concesion_federada','flujo_federado','lote_federado','proyeccion_federada','aviso_plataforma')",
            "enum('usuario','sesion_usuario','agente','sesion_agente','regla_telemetria','monitor','alerta','trigger','destinatario_trigger_correo','binding_trigger','zona_dns','registro_dns','tenant','empresa','sitio','configuracion_portal','cadena_auditoria','incidente_integridad','instalacion_federada','relacion_federada','revision_concesion_federada','flujo_federado','lote_federado','proyeccion_federada','aviso_plataforma')"
          ],
          causalidad_tipo: "enum('evento_auditoria','evento_monitor','ejecucion_trigger','operacion_sesion_agente','generacion_dns','relacion_federacion','ocurrencia_federacion','entrega_federacion','aviso_plataforma')",
          productor: "enum('runtime_alertas','runtime_automatizacion','runtime_dns','runtime_federacion')"
        }
      }
    ]
  }),
  '0104_crear_ciclos_avisos_plataforma.sql': definir({
    tabla: 'avisos_plataforma',
    columnas: {
      id: 'bigint(20) unsigned',
      aviso_id: 'binary(16)',
      version_catalogo: 'smallint(5) unsigned',
      tipo_codigo: 'varchar(64)',
      causa_codigo: 'varchar(64)',
      clave_causal: 'binary(32)',
      estado_ciclo: "enum('pendiente','resuelto','obsoleto')",
      clave_causal_activa: 'binary(32)',
      gravedad: "enum('informativa','advertencia','critica')",
      scope_tenant_id: 'bigint(20) unsigned',
      scope_empresa_id: 'bigint(20) unsigned',
      scope_sitio_id: 'bigint(20) unsigned',
      objeto_tipo: 'varchar(64)',
      objeto_id: 'varchar(191)',
      relacion_id: 'varchar(64)',
      flujo_id: 'varchar(64)',
      ciclo_anterior_aviso_id: 'binary(16)',
      primera_deteccion_utc: 'datetime(3)',
      ultima_deteccion_utc: 'datetime(3)',
      resuelto_en_utc: 'datetime(3)',
      obsoleto_en_utc: 'datetime(3)',
      contador_detecciones: 'bigint(20) unsigned',
      contexto_humano: 'longtext',
      resumen: 'longtext',
      correlacion_apertura_id: 'binary(16)',
      evento_apertura_id: 'binary(16)',
      evento_ultima_transicion_id: 'binary(16)'
    },
    indices: [
      { nombre: 'PRIMARY', unico: true, columnas: ['id'] },
      { nombre: 'uk_avisos_plataforma_aviso', unico: true, columnas: ['aviso_id'] },
      { nombre: 'uk_avisos_plataforma_causa_activa', unico: true, columnas: ['clave_causal_activa'] },
      { nombre: 'uk_avisos_plataforma_ciclo_anterior', unico: true, columnas: ['ciclo_anterior_aviso_id'] },
      {
        nombre: 'idx_avisos_plataforma_scope_activos',
        unico: false,
        columnas: [
          'estado_ciclo',
          'scope_tenant_id',
          'scope_empresa_id',
          'scope_sitio_id',
          'gravedad',
          'ultima_deteccion_utc',
          'aviso_id'
        ]
      },
      {
        nombre: 'idx_avisos_plataforma_causa_historica',
        unico: false,
        columnas: ['clave_causal', 'primera_deteccion_utc', 'aviso_id']
      },
      {
        nombre: 'idx_avisos_plataforma_objeto',
        unico: false,
        columnas: ['objeto_tipo', 'objeto_id', 'estado_ciclo', 'ultima_deteccion_utc']
      }
    ],
    checks: [
      'chk_avisos_plataforma_uuidv7',
      'chk_avisos_plataforma_scope',
      'chk_avisos_plataforma_referencias_federadas',
      'chk_avisos_plataforma_objeto',
      'chk_avisos_plataforma_cronologia',
      'chk_avisos_plataforma_estado',
      'chk_avisos_plataforma_contexto'
    ],
    foraneas: [
      {
        nombre: 'fk_avisos_plataforma_causa',
        tablaReferenciada: 'catalogo_causas_avisos_plataforma',
        alBorrar: 'RESTRICT',
        alActualizar: 'RESTRICT'
      },
      {
        nombre: 'fk_avisos_plataforma_ciclo_anterior',
        tablaReferenciada: 'avisos_plataforma',
        alBorrar: 'RESTRICT',
        alActualizar: 'RESTRICT'
      }
    ],
    tablasAdicionales: [
      {
        tabla: 'catalogo_causas_avisos_plataforma',
        columnas: {
          version_catalogo: 'smallint(5) unsigned',
          tipo_codigo: 'varchar(64)',
          causa_codigo: 'varchar(64)',
          gravedad_inicial: "enum('informativa','advertencia','critica')",
          admite_resolucion_administrativa: 'tinyint(1)'
        }
      }
    ]
  }),
  '0105_crear_historico_avisos_plataforma.sql': definir({
    tabla: 'historico_avisos_plataforma',
    columnas: {
      id: 'bigint(20) unsigned',
      aviso_id: 'binary(16)',
      ordinal: 'int(10) unsigned',
      transicion_tipo: "enum('apertura','confirmacion_tecnica','actualizacion','escalado','desescalado','resolucion','obsolescencia','reapertura')",
      estado_anterior: "enum('pendiente','resuelto','obsoleto')",
      estado_nuevo: "enum('pendiente','resuelto','obsoleto')",
      gravedad_anterior: "enum('informativa','advertencia','critica')",
      gravedad_nueva: "enum('informativa','advertencia','critica')",
      contador_detecciones: 'bigint(20) unsigned',
      efectivo_en_utc: 'datetime(3)',
      registrado_en_utc: 'datetime(3)',
      evento_auditoria_id: 'binary(16)',
      correlacion_id: 'binary(16)',
      detalle: 'longtext'
    },
    indices: [
      { nombre: 'PRIMARY', unico: true, columnas: ['id'] },
      {
        nombre: 'uk_historico_avisos_plataforma_ordinal',
        unico: true,
        columnas: ['aviso_id', 'ordinal']
      },
      {
        nombre: 'uk_historico_avisos_plataforma_evento',
        unico: true,
        columnas: ['evento_auditoria_id']
      },
      {
        nombre: 'idx_historico_avisos_plataforma_cronologia',
        unico: false,
        columnas: ['aviso_id', 'efectivo_en_utc', 'ordinal']
      }
    ],
    checks: [
      'chk_historico_avisos_plataforma_uuidv7',
      'chk_historico_avisos_plataforma_contadores',
      'chk_historico_avisos_plataforma_cronologia',
      'chk_historico_avisos_plataforma_transicion',
      'chk_historico_avisos_plataforma_detalle'
    ],
    foraneas: [
      {
        nombre: 'fk_historico_avisos_plataforma_aviso',
        tablaReferenciada: 'avisos_plataforma',
        alBorrar: 'RESTRICT',
        alActualizar: 'RESTRICT'
      }
    ]
  }),
  '0106_proteger_avisos_plataforma.sql': definirTrigger({
    trigger: 'trg_avisos_plataforma_proteger_causalidad',
    tabla: 'avisos_plataforma',
    momento: 'BEFORE',
    evento: 'UPDATE'
  }),
  '0107_agregar_contexto_historico_avisos_plataforma.sql': definir({
    tipo: 'alteracion_tabla',
    tabla: 'historico_avisos_plataforma',
    columnas: {
      contexto_humano: 'longtext',
      resumen: 'longtext'
    },
    indices: [],
    checks: [
      'chk_historico_avisos_plataforma_contexto'
    ]
  }),
  '0108_ampliar_productores_identidad_auditoria_federacion.sql': definir({
    tipo: 'alteracion_tabla',
    tabla: 'identidades_idempotentes_auditoria',
    columnas: {
      productor: [
        "enum('auditoria_nucleo','portal_web','api_agentes','runtime_alertas','runtime_automatizacion','runtime_dns','bootstrap','tarea_retencion','portal_federacion','api_federacion','runtime_federacion')",
        "enum('auditoria_nucleo','portal_web','api_agentes','runtime_alertas','runtime_automatizacion','runtime_dns','runtime_agentes','runtime_operaciones_administrativas','bootstrap','tarea_retencion','portal_federacion','api_federacion','runtime_federacion')"
      ]
    },
    indices: []
  }),
  '0109_crear_relaciones_federacion.sql': definir({
    tabla: 'relaciones_federacion',
    columnas: {
      id: 'bigint(20) unsigned',
      relacion_id: 'char(37)',
      direccion: "enum('emision','recepcion')",
      estado_ciclo: [
        "enum('pendientevinculacion','vinculada','deshabilitada','eliminada')",
        "enum('pendientevinculacion','pendienteconfirmacionidentidad','pendienteautenticacion','vinculada','deshabilitada','eliminada')"
      ],
      estado_autoridad: "enum('autorizada','sinautoridad')",
      estado_identidad: "enum('valida','conflictiva')",
      estado_compatibilidad: "enum('compatible','compatibleparcial','incompatible')",
      installation_remota_candidata_id: 'char(40)',
      installation_remota_id: 'char(40)',
      nombre_remoto_declarado: 'varchar(191)',
      responsable_usuario_id: 'bigint(20) unsigned',
      responsable_original_usuario_id: 'bigint(20) unsigned',
      scope_tenant_id: 'bigint(20) unsigned',
      scope_empresa_id: 'bigint(20) unsigned',
      scope_sitio_id: 'bigint(20) unsigned',
      version_autoridad: 'bigint(20) unsigned',
      corte_autoridad_utc: 'datetime(3)',
      creada_por_usuario_id: 'bigint(20) unsigned',
      creada_en_utc: 'datetime(3)',
      actualizada_en_utc: 'datetime(3)',
      revision: 'bigint(20) unsigned'
    },
    indices: [
      { nombre: 'PRIMARY', unico: true, columnas: ['id'] },
      { nombre: 'uk_relaciones_federacion_identidad', unico: true, columnas: ['relacion_id'] },
      {
        nombre: 'idx_relaciones_federacion_responsable',
        unico: false,
        columnas: ['responsable_usuario_id', 'estado_autoridad', 'estado_ciclo', 'relacion_id']
      },
      {
        nombre: 'idx_relaciones_federacion_scope',
        unico: false,
        columnas: [
          'scope_tenant_id', 'scope_empresa_id', 'scope_sitio_id',
          'direccion', 'estado_ciclo', 'relacion_id'
        ]
      },
      {
        nombre: 'idx_relaciones_federacion_contraparte',
        unico: false,
        columnas: ['installation_remota_id', 'direccion', 'estado_ciclo', 'relacion_id']
      }
    ],
    checks: [
      'chk_relaciones_federacion_identidades',
      'chk_relaciones_federacion_scope',
      'chk_relaciones_federacion_responsabilidad',
      'chk_relaciones_federacion_vinculacion',
      'chk_relaciones_federacion_contadores',
      'chk_relaciones_federacion_cronologia'
    ],
    tablasAdicionales: [
      {
        tabla: 'historico_estados_relaciones_federacion',
        columnas: {
          relacion_id: 'char(37)',
          ordinal: 'int(10) unsigned',
          cambio_tipo: [
            "enum('creacion','identidadcandidata','identidadconfirmada','estadocambiado','autoridadperdida','responsabilidadtransferida','compatibilidadcambiada','eliminacion')",
            "enum('creacion','identidadcandidata','identidadconfirmada','estadocambiado','autoridadperdida','responsabilidadtransferida','compatibilidadcambiada','eliminacion','identidadconflictiva','identidadresuelta')"
          ],
          evento_auditoria_id: 'binary(16)',
          correlacion_id: 'binary(16)',
          detalle: 'longtext'
        }
      }
    ]
  }),
  '0110_crear_localizaciones_relaciones_federacion.sql': definir({
    tabla: 'localizaciones_relaciones_federacion',
    columnas: {
      id: 'bigint(20) unsigned',
      localizacion_id: 'binary(16)',
      relacion_id: 'char(37)',
      endpoint_https: 'varchar(2048)',
      estado: "enum('propuesta','activa','sustituida','rechazada')",
      relacion_localizacion_activa: 'char(37)',
      origen_propuesta: "enum('configuracionlocal','contraparte','recuperacion')",
      propuesta_por_usuario_id: 'bigint(20) unsigned',
      aprobada_por_usuario_id: 'bigint(20) unsigned',
      propuesta_en_utc: 'datetime(3)',
      aprobada_en_utc: 'datetime(3)',
      finalizada_en_utc: 'datetime(3)',
      evento_auditoria_id: 'binary(16)',
      correlacion_id: 'binary(16)'
    },
    indices: [
      { nombre: 'PRIMARY', unico: true, columnas: ['id'] },
      { nombre: 'uk_localizaciones_relaciones_identidad', unico: true, columnas: ['localizacion_id'] },
      { nombre: 'uk_localizaciones_relaciones_activa', unico: true, columnas: ['relacion_localizacion_activa'] },
      { nombre: 'uk_localizaciones_relaciones_evento', unico: true, columnas: ['evento_auditoria_id'] },
      {
        nombre: 'idx_localizaciones_relaciones_historico',
        unico: false,
        columnas: ['relacion_id', 'propuesta_en_utc', 'localizacion_id']
      }
    ],
    checks: [
      'chk_localizaciones_relaciones_uuidv7',
      'chk_localizaciones_relaciones_endpoint',
      'chk_localizaciones_relaciones_estado',
      'chk_localizaciones_relaciones_cronologia'
    ],
    foraneas: [
      {
        nombre: 'fk_localizaciones_relaciones_relacion',
        tablaReferenciada: 'relaciones_federacion',
        alBorrar: 'RESTRICT',
        alActualizar: 'RESTRICT'
      }
    ]
  }),
  '0111_proteger_relaciones_federacion.sql': definirTrigger({
    trigger: 'trg_relaciones_federacion_proteger_identidad',
    tabla: 'relaciones_federacion',
    momento: 'BEFORE',
    evento: 'UPDATE'
  }),
  '0112_reforzar_identidades_federadas_canonicas.sql': definir({
    tipo: 'alteracion_tabla',
    tabla: 'identidad_instalacion_federacion',
    columnas: {
      installation_id: 'char(40)'
    },
    indices: [],
    checks: [
      'chk_identidad_instalacion_federacion_formato'
    ]
  }),
  '0113_crear_revisiones_concesion_federacion.sql': definir({
    tabla: 'revisiones_concesion_federacion',
    columnas: {
      id: 'bigint(20) unsigned', revision_id: ['char(46)', 'char(47)'], relacion_id: 'char(37)',
      papel: "enum('oferta','aceptacion','efectiva')", ordinal: 'int(10) unsigned',
      estado: "enum('propuesta','vigente','sustituida','reducida','cancelada','vacia')",
      revision_oferta_id: ['char(46)', 'char(47)'],
      revision_aceptacion_id: ['char(46)', 'char(47)'],
      seleccion: 'longtext', huella_seleccion: 'binary(32)',
      autorizada_por_usuario_id: 'bigint(20) unsigned',
      version_autoridad: 'bigint(20) unsigned', creada_en_utc: 'datetime(3)',
      vigente_desde_utc: 'datetime(3)', finalizada_en_utc: 'datetime(3)',
      evento_auditoria_id: 'binary(16)', correlacion_id: 'binary(16)'
    },
    indices: [
      { nombre: 'PRIMARY', unico: true, columnas: ['id'] },
      { nombre: 'uk_revisiones_concesion_identidad', unico: true, columnas: ['revision_id'] },
      {
        nombre: 'uk_revisiones_concesion_ordinal',
        unico: true,
        columnas: ['relacion_id', 'papel', 'ordinal'],
        columnasAlternativas: [
          ['relacion_id', 'papel', 'version_autoridad', 'ordinal']
        ]
      },
      { nombre: 'uk_revisiones_concesion_evento', unico: true, columnas: ['evento_auditoria_id'] },
      { nombre: 'idx_revisiones_concesion_estado', unico: false, columnas: ['relacion_id', 'papel', 'estado', 'ordinal'] }
    ],
    checks: ['chk_revisiones_concesion_identidad', 'chk_revisiones_concesion_forma', 'chk_revisiones_concesion_estado', 'chk_revisiones_concesion_contadores', 'chk_revisiones_concesion_json'],
    tablasAdicionales: [
      { tabla: 'selectores_revision_concesion_federacion', columnas: { revision_id: ['char(46)', 'char(47)'], familia: 'varchar(64)', niveles_scope: 'longtext', campos: 'longtext', permite_contenido_sensible: 'tinyint(1)', permite_refederacion: 'tinyint(1)' } },
      { tabla: 'estado_concesion_relaciones_federacion', columnas: { relacion_id: 'char(37)', revision_oferta_actual_id: ['char(46)', 'char(47)'], revision_aceptacion_actual_id: ['char(46)', 'char(47)'], revision_efectiva_actual_id: ['char(46)', 'char(47)'], revision: 'bigint(20) unsigned', actualizada_en_utc: 'datetime(3)' } }
    ]
  }),
  '0114_crear_cortes_tombstones_federacion.sql': definir({
    tabla: 'cortes_autoridad_federacion',
    columnas: {
      id: 'bigint(20) unsigned', relacion_id: 'char(37)',
      version_autoridad: 'bigint(20) unsigned',
      causa: "enum('usuarioinactivo','usuarioeliminado','scopeperdido','permisoperdido','organizacionmovida','organizacioneliminada','deshabilitacion','eliminacionrelacion')",
      responsable_usuario_id: 'bigint(20) unsigned', scope_tenant_id: 'bigint(20) unsigned',
      scope_empresa_id: 'bigint(20) unsigned', scope_sitio_id: 'bigint(20) unsigned',
      corte_en_utc: 'datetime(3)', evento_auditoria_id: 'binary(16)', correlacion_id: 'binary(16)'
    },
    indices: [
      { nombre: 'PRIMARY', unico: true, columnas: ['id'] },
      { nombre: 'uk_cortes_autoridad_version', unico: true, columnas: ['relacion_id', 'version_autoridad'] },
      { nombre: 'uk_cortes_autoridad_evento', unico: true, columnas: ['evento_auditoria_id'] },
      { nombre: 'idx_cortes_autoridad_responsable', unico: false, columnas: ['responsable_usuario_id', 'corte_en_utc', 'relacion_id'] }
    ],
    checks: ['chk_cortes_autoridad_version', 'chk_cortes_autoridad_scope', 'chk_cortes_autoridad_uuidv7'],
    tablasAdicionales: [
      { tabla: 'tombstones_relaciones_federacion', columnas: { relacion_id: 'char(37)', installation_remota_id: 'char(40)', direccion: "enum('emision','recepcion')", version_autoridad_final: 'bigint(20) unsigned', eliminada_en_utc: 'datetime(3)', eliminada_por_usuario_id: 'bigint(20) unsigned', evento_auditoria_id: 'binary(16)', correlacion_id: 'binary(16)' } }
    ]
  }),
  '0115_proteger_control_federacion.sql': definirTrigger({
    trigger: 'trg_revisiones_concesion_inmutables',
    tabla: 'revisiones_concesion_federacion', momento: 'BEFORE', evento: 'UPDATE'
  }),
  '0116_corregir_longitud_revision_concesion_federacion.sql': definir({
    tipo: 'alteracion_tabla',
    tabla: 'revisiones_concesion_federacion',
    columnas: {
      revision_id: 'char(47)', revision_oferta_id: 'char(47)',
      revision_aceptacion_id: 'char(47)'
    },
    indices: [],
    tablasAdicionales: [
      { tabla: 'selectores_revision_concesion_federacion', columnas: { revision_id: 'char(47)' } },
      { tabla: 'estado_concesion_relaciones_federacion', columnas: { revision_oferta_actual_id: 'char(47)', revision_aceptacion_actual_id: 'char(47)', revision_efectiva_actual_id: 'char(47)' } }
    ]
  }),
  '0117_proteger_terminalidad_relaciones_federacion.sql': definirTrigger({
    trigger: 'trg_relaciones_federacion_estado_terminal',
    tabla: 'relaciones_federacion',
    momento: 'BEFORE',
    evento: 'UPDATE'
  }),
  '0118_crear_invitaciones_establecimiento_federacion.sql': definir({
    tabla: 'invitaciones_establecimiento_federacion',
    columnas: {
      id: 'bigint(20) unsigned', invitacion_id: 'char(29)',
      relacion_id: 'char(37)', installation_receptora_id: 'char(40)',
      credencial_hash: 'binary(32)',
      estado: "enum('vigente','consumida','revocada','expirada')",
      emitida_por_usuario_id: 'bigint(20) unsigned',
      revocada_por_usuario_id: 'bigint(20) unsigned',
      emitida_en_utc: 'datetime(3)', expira_en_utc: 'datetime(3)',
      consumida_en_utc: 'datetime(3)', revocada_en_utc: 'datetime(3)',
      evento_emision_id: 'binary(16)', evento_revocacion_id: 'binary(16)',
      correlacion_id: 'binary(16)', relacion_vigente_id: 'char(37)'
    },
    indices: [
      { nombre: 'PRIMARY', unico: true, columnas: ['id'] },
      { nombre: 'uk_invitaciones_federacion_identidad', unico: true, columnas: ['invitacion_id'] },
      { nombre: 'uk_invitaciones_federacion_hash', unico: true, columnas: ['credencial_hash'] },
      { nombre: 'uk_invitaciones_federacion_evento_emision', unico: true, columnas: ['evento_emision_id'] },
      { nombre: 'uk_invitaciones_federacion_evento_revocacion', unico: true, columnas: ['evento_revocacion_id'] },
      { nombre: 'uk_invitaciones_federacion_relacion_vigente', unico: true, columnas: ['relacion_vigente_id'] },
      { nombre: 'idx_invitaciones_federacion_expiracion', unico: false, columnas: ['estado', 'expira_en_utc', 'invitacion_id'] },
      { nombre: 'idx_invitaciones_federacion_relacion', unico: false, columnas: ['relacion_id', 'emitida_en_utc', 'invitacion_id'] }
    ],
    checks: [
      'chk_invitaciones_federacion_identidades',
      'chk_invitaciones_federacion_cronologia',
      'chk_invitaciones_federacion_estado',
      'chk_invitaciones_federacion_uuidv7'
    ]
  }),
  '0119_proteger_invitaciones_establecimiento_federacion.sql': definirTrigger({
    trigger: 'trg_invitaciones_federacion_transiciones',
    tabla: 'invitaciones_establecimiento_federacion',
    momento: 'BEFORE',
    evento: 'UPDATE'
  }),
  '0120_agregar_testimonio_consumo_invitaciones_federacion.sql': definir({
    tipo: 'alteracion_tabla',
    tabla: 'invitaciones_establecimiento_federacion',
    columnas: {
      evento_consumo_id: 'binary(16)', solicitud_canje_id: 'binary(16)',
      installation_emisora_id: 'char(40)', boot_emisor_id: 'char(37)'
    },
    indices: [
      { nombre: 'uk_invitaciones_federacion_evento_consumo', unico: true, columnas: ['evento_consumo_id'] },
      { nombre: 'uk_invitaciones_federacion_solicitud_canje', unico: true, columnas: ['solicitud_canje_id'] },
      { nombre: 'idx_invitaciones_federacion_emisor', unico: false, columnas: ['installation_emisora_id', 'consumida_en_utc', 'invitacion_id'] }
    ],
    checks: ['chk_invitaciones_federacion_testimonio_consumo']
  }),
  '0121_crear_credenciales_persistentes_federacion.sql': definir({
    tabla: 'credenciales_persistentes_federacion',
    columnas: {
      id: 'bigint(20) unsigned', relacion_id: 'char(37)',
      tipo_material: "enum('secretocifrado','verificador')",
      perfil: 'varchar(80)', version_credencial: 'int(10) unsigned',
      installation_local_id: 'char(40)', installation_remota_id: 'char(40)',
      keyring_referencia: 'varchar(200)', key_id: 'varchar(64)',
      nonce: 'binary(12)', ciphertext: 'varbinary(96)', auth_tag: 'binary(16)',
      verificador_salt: 'binary(32)', verificador_digest: 'binary(32)',
      creada_en_utc: 'datetime(3)', actualizada_en_utc: 'datetime(3)'
    },
    indices: [
      { nombre: 'PRIMARY', unico: true, columnas: ['id'] },
      { nombre: 'uk_credenciales_persistentes_federacion_relacion', unico: true, columnas: ['relacion_id'] },
      { nombre: 'idx_credenciales_persistentes_federacion_contraparte', unico: false, columnas: ['installation_remota_id', 'tipo_material', 'relacion_id'] },
      { nombre: 'idx_credenciales_persistentes_federacion_keyring', unico: false, columnas: ['keyring_referencia', 'key_id', 'relacion_id'] }
    ],
    checks: [
      'chk_credenciales_persistentes_federacion_identidades',
      'chk_credenciales_persistentes_federacion_version',
      'chk_credenciales_persistentes_federacion_cronologia',
      'chk_credenciales_persistentes_federacion_material'
    ],
    foraneas: [{
      nombre: 'fk_credenciales_persistentes_federacion_relacion',
      tablaReferenciada: 'relaciones_federacion',
      alBorrar: 'RESTRICT',
      alActualizar: 'RESTRICT'
    }]
  }),
  '0122_reforzar_identidades_credenciales_persistentes_federacion.sql': definir({
    tipo: 'alteracion_tabla',
    tabla: 'credenciales_persistentes_federacion',
    columnas: {},
    indices: [],
    checks: ['chk_credenciales_persistentes_federacion_identidades']
  }),
  '0123_crear_candidaturas_identidad_federacion.sql': definir({
    tabla: 'candidaturas_identidad_federacion',
    columnas: {
      solicitud_canje_id: 'binary(16)', relacion_id: 'char(37)',
      ordinal: 'int(10) unsigned',
      installation_remota_candidata_id: 'char(40)',
      boot_remoto_candidato_id: 'char(37)',
      nombre_remoto_declarado: 'varchar(191)',
      protocolo_version: 'int(10) unsigned', producto_version: 'varchar(64)',
      estado: "enum('pendiente','confirmada','sustituida')",
      relacion_pendiente_id: 'char(37)', registrada_en_utc: 'datetime(3)',
      finalizada_en_utc: 'datetime(3)', evento_canje_id: 'binary(16)',
      evento_confirmacion_id: 'binary(16)',
      correlacion_confirmacion_id: 'binary(16)',
      confirmada_por_usuario_id: 'bigint(20) unsigned'
    },
    indices: [
      { nombre: 'PRIMARY', unico: true, columnas: ['solicitud_canje_id'] },
      { nombre: 'uk_candidaturas_identidad_evento_canje', unico: true, columnas: ['evento_canje_id'] },
      { nombre: 'uk_candidaturas_identidad_evento_confirmacion', unico: true, columnas: ['evento_confirmacion_id'] },
      { nombre: 'uk_candidaturas_identidad_relacion_ordinal', unico: true, columnas: ['relacion_id', 'ordinal'] },
      { nombre: 'uk_candidaturas_identidad_relacion_pendiente', unico: true, columnas: ['relacion_pendiente_id'] },
      { nombre: 'idx_candidaturas_identidad_instalacion', unico: false, columnas: ['installation_remota_candidata_id', 'estado', 'relacion_id'] }
    ],
    checks: [
      'chk_candidaturas_identidad_identidades',
      'chk_candidaturas_identidad_contadores',
      'chk_candidaturas_identidad_estado',
      'chk_candidaturas_identidad_cronologia',
      'chk_candidaturas_identidad_uuidv7'
    ],
    foraneas: [
      { nombre: 'fk_candidaturas_identidad_relacion', tablaReferenciada: 'relaciones_federacion', alBorrar: 'RESTRICT', alActualizar: 'RESTRICT' },
      { nombre: 'fk_candidaturas_identidad_usuario_confirmacion', tablaReferenciada: 'usuarios', alBorrar: 'RESTRICT', alActualizar: 'RESTRICT' }
    ]
  }),
  '0124_ampliar_establecimiento_relaciones_federacion.sql': definir({
    tipo: 'alteracion_tabla',
    tabla: 'relaciones_federacion',
    columnas: {
      estado_ciclo: "enum('pendientevinculacion','pendienteconfirmacionidentidad','pendienteautenticacion','vinculada','deshabilitada','eliminada')"
    },
    indices: [],
    checks: ['chk_relaciones_federacion_vinculacion'],
    tablasAdicionales: [{
      tabla: 'historico_estados_relaciones_federacion',
      columnas: {
        estado_ciclo_anterior: "enum('pendientevinculacion','pendienteconfirmacionidentidad','pendienteautenticacion','vinculada','deshabilitada','eliminada')",
        estado_ciclo_nuevo: "enum('pendientevinculacion','pendienteconfirmacionidentidad','pendienteautenticacion','vinculada','deshabilitada','eliminada')"
      }
    }]
  }),
  '0125_crear_coordinacion_sesiones_federacion.sql': definir({
    tabla: 'estado_sesiones_federacion',
    columnas: {
      relacion_id: 'char(37)', fencing_token: 'bigint(20) unsigned',
      version_revocacion: 'bigint(20) unsigned',
      actualizada_en_utc: 'datetime(3)'
    },
    indices: [
      { nombre: 'PRIMARY', unico: true, columnas: ['relacion_id'] }
    ],
    checks: [
      'chk_estado_sesiones_federacion_contadores',
      'chk_estado_sesiones_federacion_relacion'
    ],
    foraneas: [{
      nombre: 'fk_estado_sesiones_federacion_relacion',
      tablaReferenciada: 'relaciones_federacion',
      alBorrar: 'RESTRICT', alActualizar: 'RESTRICT'
    }],
    tablasAdicionales: [{
      tabla: 'operaciones_sesion_federacion',
      columnas: {
        operacion_id: 'binary(16)', request_id: 'binary(16)',
        relacion_id: 'char(37)', tipo: "enum('login','refresh','revocacion')",
        estado: "enum('reservada','consolidada','fallida','reemplazada')",
        sesion_id: 'binary(16)', installation_local_id: 'char(40)',
        installation_remota_id: 'char(40)', boot_remoto_id: 'char(37)',
        fencing_token: 'bigint(20) unsigned',
        version_revocacion: 'bigint(20) unsigned',
        huella_intencion: 'binary(32)', creada_en_utc: 'datetime(3)',
        consolidada_en_utc: 'datetime(3)'
      }
    }]
  }),
  '0126_crear_salud_heartbeat_federacion.sql': definir({
    tabla: 'estado_salud_relaciones_federacion',
    columnas: {
      relacion_id: 'char(37)', ultimo_heartbeat_request_id: 'binary(16)',
      ultima_sesion_id: 'binary(16)', ultimo_seq: 'bigint(20) unsigned',
      huella_ultimo_heartbeat: 'binary(32)', boot_remoto_id: 'char(37)',
      producto_version: 'varchar(64)', protocolo_version: 'int(10) unsigned',
      familias_soportadas: 'longtext', versiones_familia: 'longtext',
      estado_compatibilidad: "enum('pendiente','compatible','incompatible')",
      estado_temporal: "enum('pendiente','tolerable','notolerable')",
      desfase_estimado_ms: 'bigint(20)', rtt_estimado_ms: 'bigint(20) unsigned',
      muestra_id: 'binary(16)', muestra_cliente_envia_utc: 'datetime(3)',
      muestra_servidor_recibe_utc: 'datetime(3)',
      muestra_servidor_envia_utc: 'datetime(3)',
      ultimo_heartbeat_utc: 'datetime(3)', respuesta_ultimo_heartbeat: 'longtext',
      actualizada_en_utc: 'datetime(3)'
    },
    indices: [
      { nombre: 'PRIMARY', unico: true, columnas: ['relacion_id'] },
      { nombre: 'idx_salud_relaciones_heartbeat', unico: false,
        columnas: ['ultimo_heartbeat_utc', 'relacion_id'] }
    ],
    checks: [
      'chk_salud_relaciones_federacion_identidades',
      'chk_salud_relaciones_federacion_uuidv7',
      'chk_salud_relaciones_federacion_forma',
      'chk_salud_relaciones_federacion_muestra',
      'chk_salud_relaciones_federacion_temporal'
    ],
    foraneas: [{
      nombre: 'fk_salud_relaciones_federacion_relacion',
      tablaReferenciada: 'relaciones_federacion',
      alBorrar: 'RESTRICT', alActualizar: 'RESTRICT'
    }],
    tablasAdicionales: [{
      tabla: 'arranques_remotos_federacion',
      columnas: {
        relacion_id: 'char(37)', boot_remoto_id: 'char(37)',
        primera_observacion_utc: 'datetime(3)', ultima_observacion_utc: 'datetime(3)',
        contador_heartbeats: 'bigint(20) unsigned'
      }
    }]
  }),
  '0127_agregar_idempotencia_aviso_heartbeat_federacion.sql': definir({
    tipo: 'alteracion_tabla',
    tabla: 'estado_salud_relaciones_federacion',
    columnas: { evento_aviso_id: 'binary(16)' },
    indices: [],
    checks: ['chk_salud_relaciones_federacion_evento_aviso_uuidv7']
  }),
  '0128_crear_continuidad_seguridad_federacion.sql': definir({
    tabla: 'recuperaciones_relacion_federacion',
    columnas: {
      recuperacion_id: 'char(29)', relacion_id: 'char(37)',
      credencial_temporal_hash: 'binary(32)',
      estado: "enum('vigente','consumida','revocada','expirada')",
      recuperacion_vigente_relacion_id: 'char(37)',
      emitida_por_usuario_id: 'bigint(20) unsigned',
      emitida_en_utc: 'datetime(3)', expira_en_utc: 'datetime(3)',
      consumida_en_utc: 'datetime(3)', installation_emisora_id: 'char(40)',
      boot_emisor_id: 'char(37)', evento_emision_id: 'binary(16)',
      evento_consumo_id: 'binary(16)', solicitud_canje_id: 'binary(16)',
      correlacion_id: 'binary(16)'
    },
    indices: [
      { nombre: 'PRIMARY', unico: true, columnas: ['recuperacion_id'] },
      { nombre: 'uk_recuperaciones_relacion_vigente', unico: true,
        columnas: ['recuperacion_vigente_relacion_id'] },
      { nombre: 'uk_recuperaciones_relacion_solicitud', unico: true,
        columnas: ['solicitud_canje_id'] }
    ],
    checks: [
      'chk_recuperaciones_relacion_identidades', 'chk_recuperaciones_relacion_estado',
      'chk_recuperaciones_relacion_cronologia', 'chk_recuperaciones_relacion_uuidv7'
    ],
    tablasAdicionales: [
      {
        tabla: 'operaciones_credencial_federacion',
        columnas: {
          solicitud_id: 'binary(16)', relacion_id: 'char(37)',
          tipo: "enum('rotacion','recuperacion')", version_credencial: 'int(10) unsigned',
          installation_remota_id: 'char(40)', boot_remoto_id: 'char(37)',
          huella_intencion: 'binary(32)', evento_auditoria_id: 'binary(16)',
          efectiva_en_utc: 'datetime(3)'
        }
      },
      {
        tabla: 'incidentes_identidad_federacion',
        columnas: {
          incidente_id: 'binary(16)', installation_remota_id: 'char(40)',
          estado: "enum('sospecha','conflicto','resuelto')", boot_ids: 'longtext',
          evidencia: 'longtext', requiere_resincronizacion: 'tinyint(1)',
          evento_deteccion_id: 'binary(16)', evento_resolucion_id: 'binary(16)'
        }
      },
      {
        tabla: 'relaciones_incidente_identidad_federacion',
        columnas: {
          incidente_id: 'binary(16)', relacion_id: 'char(37)', boot_ids: 'longtext',
          papel: "enum('observada','legitima','clon')", vinculada_en_utc: 'datetime(3)'
        }
      },
      {
        tabla: 'localizaciones_relaciones_federacion',
        columnas: { evento_aprobacion_id: 'binary(16)' }
      },
      {
        tabla: 'historico_estados_relaciones_federacion',
        columnas: {
          cambio_tipo: "enum('creacion','identidadcandidata','identidadconfirmada','estadocambiado','autoridadperdida','responsabilidadtransferida','compatibilidadcambiada','eliminacion','identidadconflictiva','identidadresuelta')"
        }
      }
    ]
  }),
  '0129_corregir_gravedad_conflicto_identidad_federacion.sql': definir({
    tipo: 'alteracion_tabla',
    tabla: 'catalogo_causas_avisos_plataforma',
    columnas: {},
    indices: []
  }),
  '0130_canonicalizar_identidades_establecimiento_federacion.sql': definir({
    tipo: 'alteracion_tabla',
    tabla: 'invitaciones_establecimiento_federacion',
    columnas: {},
    indices: [],
    checks: [
      'chk_invitaciones_federacion_identidades',
      'chk_invitaciones_federacion_testimonio_consumo'
    ],
    tablasAdicionales: [
      { tabla: 'recuperaciones_relacion_federacion', columnas: {} }
    ]
  }),
  '0096_serializar_bootstrap_usuario_inicial.sql': definir({
    tabla: 'cabecera_bootstrap_usuario_inicial',
    columnas: {
      id: 'tinyint(3) unsigned',
      revision: 'bigint(20) unsigned',
      actualizada_en_utc: 'datetime(3)'
    },
    indices: [
      { nombre: 'PRIMARY', unico: true, columnas: ['id'] }
    ],
    checks: [
      'chk_cabecera_bootstrap_usuario_inicial_unica',
      'chk_cabecera_bootstrap_usuario_inicial_revision'
    ]
  }),
  '0097_crear_diagnosticos_integridad_auditoria.sql': definir({
    tabla: 'incidentes_integridad_auditoria',
    columnas: {
      id: 'bigint(20) unsigned',
      episodio_id: 'binary(16)',
      huella: 'binary(32)',
      huella_activa: 'binary(32)',
      clave_cadena: 'varchar(128)',
      codigo: 'varchar(96)',
      estado_deteccion: "enum('activo','resuelto')",
      primera_deteccion_utc: 'datetime(3)',
      ultima_deteccion_utc: 'datetime(3)',
      resuelto_en_utc: 'datetime(3)',
      reconocido_en_utc: 'datetime(3)',
      reconocido_por_usuario_id: 'bigint(20) unsigned',
      evento_reconocimiento_id: 'binary(16)',
      detalle: 'longtext'
    },
    indices: [
      { nombre: 'PRIMARY', unico: true, columnas: ['id'] },
      { nombre: 'uk_incidentes_integridad_auditoria_episodio', unico: true, columnas: ['episodio_id'] },
      { nombre: 'uk_incidentes_integridad_auditoria_activo', unico: true, columnas: ['huella_activa'] }
    ],
    checks: [
      'chk_incidentes_integridad_auditoria_reconocimiento',
      'chk_incidentes_integridad_auditoria_resolucion'
    ]
  }),
  '0098_crear_coordinacion_verificacion_auditoria.sql': definir({
    tabla: 'cabecera_verificacion_auditoria',
    columnas: {
      id: 'tinyint(3) unsigned',
      instancia_id: 'varchar(128)',
      lease_token: 'binary(32)',
      lease_expira_utc: 'datetime(3)',
      fencing_token: 'bigint(20) unsigned',
      cursor_clave_cadena: 'varchar(128)',
      ultima_ejecucion_utc: 'datetime(3)',
      actualizada_en_utc: 'datetime(3)'
    },
    indices: [
      { nombre: 'PRIMARY', unico: true, columnas: ['id'] }
    ],
    checks: [
      'chk_cabecera_verificacion_auditoria_unica',
      'chk_cabecera_verificacion_auditoria_lease',
      'chk_cabecera_verificacion_auditoria_fencing'
    ]
  }),
  '0099_agregar_indices_consulta_auditoria.sql': definir({
    tipo: 'alteracion_tabla',
    tabla: 'eventos_auditoria',
    columnas: {},
    indices: [
      {
        nombre: 'idx_eventos_auditoria_scope_empresa_cronologia',
        unico: false,
        columnas: ['scope_empresa_id', 'registrado_en_utc', 'evento_id']
      },
      {
        nombre: 'idx_eventos_auditoria_scope_sitio_cronologia',
        unico: false,
        columnas: ['scope_sitio_id', 'registrado_en_utc', 'evento_id']
      },
      {
        nombre: 'idx_eventos_auditoria_flujo_cronologia',
        unico: false,
        columnas: ['flujo', 'registrado_en_utc', 'evento_id']
      },
      {
        nombre: 'idx_eventos_auditoria_cadena_cronologia',
        unico: false,
        columnas: ['cadena_id', 'registrado_en_utc', 'evento_id']
      },
      {
        nombre: 'idx_eventos_auditoria_actor_real_cronologia',
        unico: false,
        columnas: ['actor_real_tipo', 'actor_real_id', 'registrado_en_utc', 'evento_id']
      },
      {
        nombre: 'idx_eventos_auditoria_actor_efectivo_cronologia',
        unico: false,
        columnas: ['actor_efectivo_tipo', 'actor_efectivo_id', 'registrado_en_utc', 'evento_id']
      },
      {
        nombre: 'idx_eventos_auditoria_causalidad_cronologia',
        unico: false,
        columnas: ['causalidad_tipo', 'causalidad_id', 'registrado_en_utc', 'evento_id']
      }
    ]
  }),
  '0100_crear_identidad_instalacion_federacion.sql': definir({
    tabla: 'identidad_instalacion_federacion',
    columnas: {
      id: 'tinyint(3) unsigned',
      installation_id: 'char(40)',
      version_contrato: 'smallint(5) unsigned',
      creada_en_utc: 'datetime(3)'
    },
    atributosColumnas: {
      version_contrato: { nullable: false, valorPorDefecto: '1' }
    },
    indices: [
      { nombre: 'PRIMARY', unico: true, columnas: ['id'] },
      {
        nombre: 'uk_identidad_instalacion_federacion_identidad',
        unico: true,
        columnas: ['installation_id']
      }
    ],
    checks: [
      'chk_identidad_instalacion_federacion_singleton',
      'chk_identidad_instalacion_federacion_version',
      'chk_identidad_instalacion_federacion_formato'
    ]
  }),
  '0101_crear_historico_arranques_federacion.sql': definir({
    tabla: 'arranques_instalacion_federacion',
    columnas: {
      id: 'bigint(20) unsigned',
      boot_id: 'char(37)',
      installation_id: 'char(40)',
      version_contrato: 'smallint(5) unsigned',
      iniciado_en_utc: 'datetime(3)',
      registrado_en_utc: 'datetime(3)'
    },
    atributosColumnas: {
      version_contrato: { nullable: false, valorPorDefecto: '1' }
    },
    indices: [
      { nombre: 'PRIMARY', unico: true, columnas: ['id'] },
      {
        nombre: 'uk_arranques_federacion_boot',
        unico: true,
        columnas: ['boot_id']
      },
      {
        nombre: 'uk_arranques_federacion_instalacion_boot',
        unico: true,
        columnas: ['installation_id', 'boot_id']
      },
      {
        nombre: 'idx_arranques_federacion_instalacion_cronologia',
        unico: false,
        columnas: ['installation_id', 'iniciado_en_utc', 'id']
      }
    ],
    checks: [
      'chk_arranques_federacion_version',
      'chk_arranques_federacion_boot_formato',
      'chk_arranques_federacion_instalacion_formato',
      'chk_arranques_federacion_cronologia'
    ],
    foraneas: [
      {
        nombre: 'fk_arranques_federacion_instalacion',
        tablaReferenciada: 'identidad_instalacion_federacion',
        alBorrar: 'RESTRICT',
        alActualizar: 'RESTRICT'
      }
    ]
  }),
  '0063_crear_sesiones_web_auditoria.sql': definir({
    tabla: 'sesiones_web_auditoria',
    columnas: {
      sesion_auditoria_id: 'binary(16)',
      usuario_real_id: 'bigint(20) unsigned',
      usuario_efectivo_id: 'bigint(20) unsigned',
      version_sesion_real: 'int(10) unsigned',
      version_sesion_efectiva: 'int(10) unsigned',
      apertura_tenant_id: 'bigint(20) unsigned',
      apertura_empresa_id: 'bigint(20) unsigned',
      apertura_sitio_id: 'bigint(20) unsigned',
      efectivo_tenant_id: 'bigint(20) unsigned',
      efectivo_empresa_id: 'bigint(20) unsigned',
      efectivo_sitio_id: 'bigint(20) unsigned',
      evento_impersonacion_iniciada_id: 'binary(16)',
      estado: "enum('abierta','cerrada','invalidada')",
      expira_en_utc: 'datetime(3)',
      creada_en_utc: 'datetime(3)',
      renovada_en_utc: 'datetime(3)',
      cerrada_en_utc: 'datetime(3)'
    },
    indices: [
      {
        nombre: 'PRIMARY',
        unico: true,
        columnas: ['sesion_auditoria_id']
      },
      {
        nombre: 'idx_sesiones_web_usuario_real_vigencia',
        unico: false,
        columnas: ['usuario_real_id', 'estado', 'expira_en_utc', 'sesion_auditoria_id']
      },
      {
        nombre: 'idx_sesiones_web_usuario_efectivo_vigencia',
        unico: false,
        columnas: ['usuario_efectivo_id', 'estado', 'expira_en_utc', 'sesion_auditoria_id']
      },
      {
        nombre: 'idx_sesiones_web_estado_expiracion',
        unico: false,
        columnas: ['estado', 'expira_en_utc', 'sesion_auditoria_id']
      },
      {
        nombre: 'idx_sesiones_web_evento_impersonacion',
        unico: false,
        columnas: ['evento_impersonacion_iniciada_id']
      },
      {
        nombre: 'idx_sesiones_web_cierre',
        unico: false,
        columnas: ['estado', 'cerrada_en_utc', 'sesion_auditoria_id']
      }
    ],
    checks: [
      'chk_sesiones_web_versiones',
      'chk_sesiones_web_scope_apertura',
      'chk_sesiones_web_scope_efectivo',
      'chk_sesiones_web_directa',
      'chk_sesiones_web_impersonacion_abierta',
      'chk_sesiones_web_marcas'
    ]
  }),
  '0064_proteger_sesiones_web_auditoria.sql': definirTrigger({
    trigger: 'trg_sesiones_web_auditoria_proteger_update',
    tabla: 'sesiones_web_auditoria',
    momento: 'BEFORE',
    evento: 'UPDATE'
  }),
  '0065_proteger_borrado_sesiones_web_auditoria.sql': definirTrigger({
    trigger: 'trg_sesiones_web_auditoria_proteger_delete',
    tabla: 'sesiones_web_auditoria',
    momento: 'BEFORE',
    evento: 'DELETE'
  }),
  '0066_agregar_versiones_sesion_agentes.sql': definir({
    tipo: 'alteracion_tabla',
    tabla: 'agentes_sentinelia',
    columnas: {
      version_scope_agente: 'bigint(20) unsigned',
      version_autorizacion_agente: 'bigint(20) unsigned'
    },
    atributosColumnas: {
      version_scope_agente: { nullable: false, valorPorDefecto: '1' },
      version_autorizacion_agente: { nullable: false, valorPorDefecto: '1' }
    },
    indices: [],
    checks: ['chk_agentes_sentinelia_versiones_sesion']
  }),
  '0067_proteger_versiones_sesion_agentes.sql': definirTrigger({
    trigger: 'trg_agentes_sentinelia_versiones_monotonicas',
    tabla: 'agentes_sentinelia',
    momento: 'BEFORE',
    evento: 'UPDATE'
  }),
  '0068_crear_cabeceras_coordinacion_sesion_agentes.sql': definir({
    tabla: 'cabeceras_coordinacion_sesion_agentes',
    columnas: {
      agente_id: 'bigint(20) unsigned',
      fencing_token: 'bigint(20) unsigned',
      creada_en_utc: 'datetime(3)',
      actualizada_en_utc: 'datetime(3)'
    },
    indices: [
      { nombre: 'PRIMARY', unico: true, columnas: ['agente_id'] }
    ],
    checks: ['chk_cabeceras_sesion_agentes_fencing']
  }),
  '0069_proteger_cabeceras_coordinacion_sesion_agentes.sql': definirTrigger({
    trigger: 'trg_cabeceras_sesion_agentes_fencing_monotonico',
    tabla: 'cabeceras_coordinacion_sesion_agentes',
    momento: 'BEFORE',
    evento: 'UPDATE'
  }),
  '0070_crear_operaciones_sesion_agentes.sql': definir({
    tabla: 'operaciones_sesion_agentes',
    columnas: {
      operacion_id: 'binary(16)',
      tipo: "enum('login','refresh','invalidacion')",
      agente_id: 'bigint(20) unsigned',
      sesion_auditoria_id: 'binary(16)',
      login_request_id: 'binary(16)',
      refresh_request_id: 'binary(16)',
      causa_operacion_id: 'binary(16)',
      huella_intencion: 'binary(32)',
      version_scope_observada: 'bigint(20) unsigned',
      version_autorizacion_observada: 'bigint(20) unsigned',
      fencing_token: 'bigint(20) unsigned',
      lease_token: 'binary(32)',
      replay_cifrado_disponible: 'tinyint(1)',
      key_id: 'varchar(64)',
      creada_en_utc: 'datetime(3)',
      terminada_en_utc: 'datetime(3)'
    },
    indices: [
      { nombre: 'PRIMARY', unico: true, columnas: ['operacion_id'] },
      {
        nombre: 'uk_operaciones_sesion_invalidacion',
        unico: true,
        columnas: ['tipo', 'causa_operacion_id', 'agente_id', 'sesion_auditoria_id']
      },
      {
        nombre: 'idx_operaciones_sesion_agente_estado',
        unico: false,
        columnas: ['agente_id', 'estado', 'proximo_intento_utc', 'operacion_id']
      }
    ],
    checks: [
      'chk_operaciones_sesion_identidad_tipo',
      'chk_operaciones_sesion_contadores',
      'chk_operaciones_sesion_scope',
      'chk_operaciones_sesion_lease',
      'chk_operaciones_sesion_replay',
      'chk_operaciones_sesion_terminalidad'
    ]
  }),
  '0071_proteger_operaciones_sesion_agentes.sql': definirTrigger({
    trigger: 'trg_operaciones_sesion_agentes_proteger_update',
    tabla: 'operaciones_sesion_agentes',
    momento: 'BEFORE',
    evento: 'UPDATE'
  }),
  '0072_proteger_borrado_operaciones_sesion_agentes.sql': definirTrigger({
    trigger: 'trg_operaciones_sesion_agentes_proteger_delete',
    tabla: 'operaciones_sesion_agentes',
    momento: 'BEFORE',
    evento: 'DELETE'
  }),
  '0073_restringir_respuesta_operaciones_sesion_agentes.sql': definir({
    tipo: 'alteracion_tabla',
    tabla: 'operaciones_sesion_agentes',
    columnas: {},
    indices: [],
    checks: ['chk_operaciones_sesion_estado_tipo']
  }),
  '0074_agregar_actor_efectivo_operaciones_sesion_agentes.sql': definir({
    tipo: 'alteracion_tabla',
    tabla: 'operaciones_sesion_agentes',
    columnas: {
      actor_efectivo_tipo: "enum('usuario','agente','sistema')",
      actor_efectivo_id: 'varchar(128)',
      modo_actuacion: "enum('directo','impersonado')"
    },
    atributosColumnas: {
      actor_efectivo_tipo: { nullable: true },
      actor_efectivo_id: { nullable: true },
      modo_actuacion: { nullable: false, valorPorDefecto: "'directo'" }
    },
    indices: [],
    checks: ['chk_operaciones_sesion_actor_efectivo']
  }),
  '0075_reforzar_inmutabilidad_operaciones_sesion_agentes.sql': definirTrigger({
    trigger: 'trg_operaciones_sesion_agentes_proteger_update',
    tabla: 'operaciones_sesion_agentes',
    momento: 'BEFORE',
    evento: 'UPDATE'
  }),
  '0076_agregar_sesion_auditoria_agentes.sql': definir({
    tipo: 'alteracion_tabla',
    tabla: 'agentes_sentinelia',
    columnas: { sesion_auditoria_id: 'binary(16)' },
    atributosColumnas: { sesion_auditoria_id: { nullable: true } },
    indices: [
      {
        nombre: 'idx_agentes_sentinelia_sesion_auditoria',
        unico: false,
        columnas: ['sesion_auditoria_id']
      }
    ],
    checks: ['chk_agentes_sentinelia_identidad_sesion']
  }),
  '0077_agregar_sesion_auditoria_pol_agentes.sql': definir({
    tipo: 'alteracion_tabla',
    tabla: 'periodos_vida_pol_agentes',
    columnas: { sesion_auditoria_id: 'binary(16)' },
    atributosColumnas: { sesion_auditoria_id: { nullable: true } },
    indices: [
      {
        nombre: 'idx_periodos_vida_pol_sesion_auditoria',
        unico: false,
        columnas: ['sesion_auditoria_id', 'inicio_utc', 'id']
      }
    ],
    checks: ['chk_periodos_vida_pol_identidad_sesion']
  }),
  '0078_agregar_sesion_auditoria_observaciones_agentes.sql': definir({
    tipo: 'alteracion_tabla',
    tabla: 'observaciones_telemetria_agentes',
    columnas: { sesion_auditoria_id: 'binary(16)' },
    atributosColumnas: { sesion_auditoria_id: { nullable: true } },
    indices: [
      {
        nombre: 'idx_observaciones_telemetria_sesion_auditoria',
        unico: false,
        columnas: ['sesion_auditoria_id', 'observado_en_utc', 'id']
      }
    ],
    checks: ['chk_observaciones_telemetria_identidad_sesion']
  }),
  '0079_agregar_sesion_auditoria_estado_telemetria_agentes.sql': definir({
    tipo: 'alteracion_tabla',
    tabla: 'estado_actual_telemetria_agentes',
    columnas: { sesion_auditoria_id: 'binary(16)' },
    atributosColumnas: { sesion_auditoria_id: { nullable: true } },
    indices: [
      {
        nombre: 'idx_estado_actual_telemetria_sesion_auditoria',
        unico: false,
        columnas: ['sesion_auditoria_id', 'observado_en_utc', 'id']
      }
    ],
    checks: ['chk_estado_actual_telemetria_identidad_sesion']
  }),
  '0080_crear_migracion_sesiones_5_21.sql': definir({
    tabla: 'migracion_sesiones_5_21',
    columnas: {
      id: 'tinyint(3) unsigned',
      fase: "enum('pendiente','sql_saneado','redis_limpio','completada')",
      iniciada_en_utc: 'datetime(3)',
      sql_saneado_en_utc: 'datetime(3)',
      redis_limpio_en_utc: 'datetime(3)',
      completada_en_utc: 'datetime(3)',
      actualizada_en_utc: 'datetime(3)'
    },
    indices: [{ nombre: 'PRIMARY', unico: true, columnas: ['id'] }],
    checks: [
      'chk_migracion_sesiones_5_21_singleton',
      'chk_migracion_sesiones_5_21_fases'
    ]
  }),
  '0081_proteger_fases_migracion_sesiones_5_21.sql': definirTrigger({
    trigger: 'trg_migracion_sesiones_5_21_fases_monotonicas',
    tabla: 'migracion_sesiones_5_21',
    momento: 'BEFORE',
    evento: 'UPDATE'
  }),
  '0082_proteger_identidad_sesion_5_21.sql': definirTrigger({
    trigger: 'trg_agentes_sentinelia_impedir_identidad_legacy_5_21',
    tabla: 'agentes_sentinelia',
    momento: 'BEFORE',
    evento: 'UPDATE'
  }),
  '0083_proteger_altas_identidad_sesion_5_21.sql': definirTrigger({
    trigger: 'trg_pol_agentes_impedir_alta_legacy_5_21',
    tabla: 'periodos_vida_pol_agentes',
    momento: 'BEFORE',
    evento: 'INSERT'
  }),
  '0084_proteger_altas_agentes_identidad_sesion_5_21.sql': definirTrigger({
    trigger: 'trg_agentes_sentinelia_impedir_alta_legacy_5_21',
    tabla: 'agentes_sentinelia',
    momento: 'BEFORE',
    evento: 'INSERT'
  }),
  '0085_crear_cabecera_generacion_dns.sql': definir({
    tabla: 'cabecera_generacion_dns',
    columnas: {
      id: 'tinyint(3) unsigned',
      ultima_generacion_dns: 'bigint(20) unsigned',
      generacion_observada: 'bigint(20) unsigned',
      fencing_token: 'bigint(20) unsigned',
      creada_en_utc: 'datetime(3)',
      actualizada_en_utc: 'datetime(3)'
    },
    indices: [{ nombre: 'PRIMARY', unico: true, columnas: ['id'] }],
    checks: [
      'chk_cabecera_generacion_dns_singleton',
      'chk_cabecera_generacion_dns_observada'
    ]
  }),
  '0086_crear_reconciliacion_inicial_dns.sql': definir({
    tabla: 'reconciliacion_inicial_dns',
    columnas: {
      id: 'tinyint(3) unsigned',
      estado: "enum('activa','bloqueada','satisfecha')",
      generacion_objetivo: 'bigint(20) unsigned',
      ultimo_intento_generacion_dns: 'bigint(20) unsigned',
      intentos: 'smallint(5) unsigned',
      max_intentos: 'smallint(5) unsigned',
      proximo_intento_utc: 'datetime(3)',
      ultimo_codigo_error: 'varchar(64)',
      ultimo_mensaje_error: 'varchar(512)',
      creada_en_utc: 'datetime(3)',
      actualizada_en_utc: 'datetime(3)',
      satisfecha_en_utc: 'datetime(3)'
    },
    indices: [{ nombre: 'PRIMARY', unico: true, columnas: ['id'] }],
    checks: [
      'chk_reconciliacion_inicial_dns_singleton',
      'chk_reconciliacion_inicial_dns_intentos',
      'chk_reconciliacion_inicial_dns_diagnostico',
      'chk_reconciliacion_inicial_dns_estado'
    ]
  }),
  '0087_crear_operaciones_publicacion_dns.sql': definir({
    tabla: 'operaciones_publicacion_dns',
    columnas: {
      generacion_dns: 'bigint(20) unsigned',
      generacion_raiz_recuperacion: 'bigint(20) unsigned',
      raiz_sucesion_automatica: 'bigint(20) unsigned',
      generacion_leida: 'bigint(20) unsigned',
      perfil_proyeccion: 'varchar(64)',
      hash_proyeccion: 'binary(32)',
      generacion_observada: 'bigint(20) unsigned',
      generacion_convergente: 'bigint(20) unsigned',
      fencing_token: 'bigint(20) unsigned',
      lease_token: 'binary(32)',
      obligacion_outbox_id: 'bigint(20) unsigned',
      evento_resultado_id: 'binary(16)'
    },
    indices: [
      { nombre: 'PRIMARY', unico: true, columnas: ['generacion_dns'] },
      {
        nombre: 'uk_operaciones_dns_predecesora_fallida',
        unico: true,
        columnas: ['generacion_predecesora_fallida']
      },
      {
        nombre: 'uk_operaciones_dns_raiz_sucesion_automatica',
        unico: true,
        columnas: ['raiz_sucesion_automatica']
      },
      {
        nombre: 'uk_operaciones_dns_obligacion_outbox',
        unico: true,
        columnas: ['obligacion_outbox_id']
      },
      {
        nombre: 'uk_operaciones_dns_evento_resultado',
        unico: true,
        columnas: ['evento_resultado_id']
      },
      {
        nombre: 'idx_operaciones_dns_generacion_ascendente',
        unico: false,
        columnas: ['generacion_raiz_recuperacion', 'generacion_dns']
      }
    ],
    checks: [
      'chk_operaciones_dns_causalidad',
      'chk_operaciones_dns_lease',
      'chk_operaciones_dns_diagnostico',
      'chk_operaciones_dns_proyeccion',
      'chk_operaciones_dns_recarga',
      'chk_operaciones_dns_convergencia',
      'chk_operaciones_dns_resultado',
      'chk_operaciones_dns_terminalidad'
    ]
  }),
  '0088_proteger_operaciones_publicacion_dns.sql': definirTrigger({
    trigger: 'trg_operaciones_dns_proteger_update',
    tabla: 'operaciones_publicacion_dns',
    momento: 'BEFORE',
    evento: 'UPDATE'
  }),
  '0089_proteger_coordinacion_publicacion_dns.sql': definirTrigger({
    trigger: 'trg_cabecera_generacion_dns_proteger_update',
    tabla: 'cabecera_generacion_dns',
    momento: 'BEFORE',
    evento: 'UPDATE'
  }),
  '0090_agregar_identidad_auditoria_alertas_activas.sql': definir({
    tipo: 'alteracion_tabla',
    tabla: 'alertas_activas_monitores',
    columnas: { alerta_auditoria_id: 'binary(16)' },
    atributosColumnas: { alerta_auditoria_id: { nullable: false } },
    indices: [
      {
        nombre: 'uk_alertas_activas_alerta_auditoria',
        unico: true,
        columnas: ['alerta_auditoria_id']
      }
    ],
    checks: ['chk_alertas_activas_alerta_auditoria_uuidv7']
  }),
  '0091_proteger_identidad_auditoria_alertas_activas.sql': definirTrigger({
    trigger: 'trg_alertas_activas_proteger_identidad_auditoria',
    tabla: 'alertas_activas_monitores',
    momento: 'BEFORE',
    evento: 'UPDATE'
  }),
  '0092_crear_vencimientos_descarte_alertas.sql': definir({
    tabla: 'vencimientos_descarte_alertas',
    columnas: {
      id: 'bigint(20) unsigned',
      alerta_auditoria_id: 'binary(16)',
      monitor_id: 'bigint(20) unsigned',
      descartada_hasta_utc: 'datetime(3)',
      estado: "enum('pendiente','consolidada','neutralizada')",
      proximo_intento_utc: 'datetime(3)',
      instancia_id: 'varchar(128)',
      lease_token: 'binary(32)',
      lease_expira_utc: 'datetime(3)',
      fencing_token: 'bigint(20) unsigned',
      obligacion_outbox_id: 'bigint(20) unsigned',
      evento_resultado_id: 'binary(16)',
      terminada_en_utc: 'datetime(3)'
    },
    indices: [
      { nombre: 'PRIMARY', unico: true, columnas: ['id'] },
      {
        nombre: 'uk_vencimientos_descarte_identidad',
        unico: true,
        columnas: ['alerta_auditoria_id', 'descartada_hasta_utc']
      },
      {
        nombre: 'uk_vencimientos_descarte_obligacion_outbox',
        unico: true,
        columnas: ['obligacion_outbox_id']
      },
      {
        nombre: 'uk_vencimientos_descarte_evento_resultado',
        unico: true,
        columnas: ['evento_resultado_id']
      },
      {
        nombre: 'idx_vencimientos_descarte_elegibles',
        unico: false,
        columnas: ['estado', 'proximo_intento_utc', 'lease_expira_utc', 'id']
      }
    ],
    checks: [
      'chk_vencimientos_descarte_uuidv7',
      'chk_vencimientos_descarte_lease',
      'chk_vencimientos_descarte_diagnostico',
      'chk_vencimientos_descarte_estado'
    ]
  }),
  '0093_proteger_vencimientos_descarte_alertas.sql': definirTrigger({
    trigger: 'trg_vencimientos_descarte_proteger_update',
    tabla: 'vencimientos_descarte_alertas',
    momento: 'BEFORE',
    evento: 'UPDATE'
  }),
  '0215_agregar_permiso_eliminar_agentes.sql': definir({
    tipo: 'alteracion_tabla',
    tabla: 'usuarios',
    columnas: {
      permiso_eliminar_agentes: 'tinyint(1)'
    },
    atributosColumnas: {
      permiso_eliminar_agentes: BOOLEANO_DENEGADO_POR_DEFECTO
    },
    indices: []
  }),
  '0216_crear_operaciones_administrativas.sql': definir({
    tabla: 'operaciones_administrativas',
    columnas: {
      operacion_id: 'binary(16)',
      clave_operacion: 'binary(16)',
      correlacion_id: 'binary(16)',
      evento_aceptacion_id: 'binary(16)',
      tipo: [
        "enum('eliminar_agente')",
        "enum('eliminar_agente','eliminar_organizacion')"
      ],
      version_contrato: 'smallint(5) unsigned',
      sujeto_tipo: [
        "enum('agente')",
        "enum('agente','tenant','empresa','sitio')"
      ],
      sujeto_id: 'bigint(20) unsigned',
      sujeto_guid: 'char(36)',
      actor_real_usuario_id: 'bigint(20) unsigned',
      actor_efectivo_usuario_id: 'bigint(20) unsigned',
      destinatario_usuario_id: 'bigint(20) unsigned',
      comando_canonico: 'longtext',
      huella_intencion: 'binary(32)',
      estado: "enum('encolada','ejecutando','completada','completada_con_advertencias','fallida')",
      fase: "enum('preparacion','validacion','eliminacion','commit','limpieza')",
      intentos: 'smallint(5) unsigned',
      max_intentos: 'smallint(5) unsigned',
      disponible_desde_utc: 'datetime(3)',
      instancia_id: 'varchar(128)',
      lease_token: 'binary(32)',
      lease_expira_utc: 'datetime(3)',
      fencing_token: 'bigint(20) unsigned',
      ultimo_codigo_error: 'varchar(64)',
      ultimo_mensaje_error: 'varchar(512)',
      resultado_canonico: 'longtext',
      creada_en_utc: 'datetime(3)',
      actualizada_en_utc: 'datetime(3)',
      terminada_en_utc: 'datetime(3)'
    },
    indices: [
      { nombre: 'PRIMARY', unico: true, columnas: ['operacion_id'] },
      {
        nombre: 'uk_operaciones_administrativas_clave',
        unico: true,
        columnas: ['clave_operacion']
      },
      {
        nombre: 'uk_operaciones_administrativas_evento',
        unico: true,
        columnas: ['evento_aceptacion_id']
      },
      {
        nombre: 'idx_operaciones_administrativas_sujeto',
        unico: false,
        columnas: ['sujeto_tipo', 'sujeto_id', 'estado', 'creada_en_utc', 'operacion_id']
      },
      {
        nombre: 'idx_operaciones_administrativas_reclamacion',
        unico: false,
        columnas: ['estado', 'disponible_desde_utc', 'creada_en_utc', 'operacion_id']
      },
      {
        nombre: 'idx_operaciones_administrativas_lease',
        unico: false,
        columnas: ['estado', 'lease_expira_utc', 'creada_en_utc', 'operacion_id']
      },
      {
        nombre: 'idx_operaciones_administrativas_fencing',
        unico: false,
        columnas: ['instancia_id', 'fencing_token', 'lease_expira_utc', 'operacion_id']
      }
    ],
    checks: [
      'chk_operaciones_administrativas_uuidv7',
      'chk_operaciones_administrativas_contrato',
      'chk_operaciones_administrativas_contadores',
      'chk_operaciones_administrativas_cronologia',
      'chk_operaciones_administrativas_diagnostico',
      'chk_operaciones_administrativas_estado'
    ],
    tablasAdicionales: [{
      tabla: 'recursos_operaciones_administrativas',
      columnas: {
        operacion_id: 'binary(16)',
        tipo_recurso: [
          "enum('agente')",
          "enum('agente','tenant','empresa','sitio')"
        ],
        recurso_id: 'bigint(20) unsigned',
        recurso_clave: 'varchar(64)',
        estado_reclamo: "enum('activo','liberado')",
        recurso_clave_activa: 'varchar(64)',
        reclamado_en_utc: 'datetime(3)',
        liberado_en_utc: 'datetime(3)'
      },
      indices: [
        {
          nombre: 'PRIMARY',
          unico: true,
          columnas: ['operacion_id', 'tipo_recurso', 'recurso_id']
        },
        {
          nombre: 'uk_recursos_operaciones_administrativas_activo',
          unico: true,
          columnas: ['recurso_clave_activa']
        },
        {
          nombre: 'idx_recursos_operaciones_administrativas_operacion',
          unico: false,
          columnas: ['operacion_id', 'estado_reclamo', 'recurso_clave']
        },
        {
          nombre: 'idx_recursos_operaciones_administrativas_historial',
          unico: false,
          columnas: ['recurso_clave', 'reclamado_en_utc', 'operacion_id']
        }
      ],
      checks: [
        'chk_recursos_operaciones_administrativas_identidad',
        'chk_recursos_operaciones_administrativas_estado'
      ],
      foraneas: [{
        nombre: 'fk_recursos_operaciones_administrativas_operacion',
        tablaReferenciada: 'operaciones_administrativas',
        alBorrar: 'RESTRICT',
        alActualizar: 'RESTRICT'
      }]
    }]
  }),
  '0217_crear_notificaciones_usuarios.sql': definir({
    tabla: 'notificaciones_usuarios',
    columnas: {
      notificacion_id: 'binary(16)',
      destinatario_usuario_id: 'bigint(20) unsigned',
      tipo: [
        "enum('eliminacion_encolada','agente_eliminado','agente_eliminado_limpieza_pendiente','limpieza_tecnica_completada','eliminacion_fallida')",
        "enum('eliminacion_encolada','agente_eliminado','agente_eliminado_limpieza_pendiente','organizacion_eliminada','limpieza_tecnica_completada','eliminacion_fallida')"
      ],
      version_contrato: 'smallint(5) unsigned',
      operacion_id: 'binary(16)',
      emisor_tipo: "enum('usuario','sistema','proceso')",
      actor_real_usuario_id: 'bigint(20) unsigned',
      actor_efectivo_usuario_id: 'bigint(20) unsigned',
      estado_operacion: "enum('encolada','ejecutando','completada','completada_con_advertencias','fallida')",
      sujeto_tipo: [
        "enum('agente')",
        "enum('agente','tenant','empresa','sitio')"
      ],
      sujeto_id: 'bigint(20) unsigned',
      sujeto_guid: 'char(36)',
      titulo_codigo: 'varchar(64)',
      resumen_codigo: 'varchar(64)',
      payload_canonico: 'longtext',
      huella_payload: 'binary(32)',
      emitida_en_utc: 'datetime(3)',
      leida: 'tinyint(1)',
      leida_en_utc: 'datetime(3)',
      actualizada_en_utc: 'datetime(3)',
      retener_hasta_utc: 'datetime(3)'
    },
    atributosColumnas: {
      leida: { nullable: false, valorPorDefecto: '0' }
    },
    indices: [
      { nombre: 'PRIMARY', unico: true, columnas: ['notificacion_id'] },
      {
        nombre: 'uk_notificaciones_usuarios_operacion_tipo',
        unico: true,
        columnas: ['destinatario_usuario_id', 'operacion_id', 'tipo']
      },
      {
        nombre: 'idx_notificaciones_usuarios_buzon',
        unico: false,
        columnas: ['destinatario_usuario_id', 'emitida_en_utc', 'notificacion_id']
      },
      {
        nombre: 'idx_notificaciones_usuarios_no_leidas',
        unico: false,
        columnas: ['destinatario_usuario_id', 'leida', 'emitida_en_utc', 'notificacion_id']
      },
      {
        nombre: 'idx_notificaciones_usuarios_retencion',
        unico: false,
        columnas: ['retener_hasta_utc', 'notificacion_id']
      }
    ],
    checks: [
      'chk_notificaciones_usuarios_uuidv7',
      'chk_notificaciones_usuarios_emisor',
      'chk_notificaciones_usuarios_contrato',
      'chk_notificaciones_usuarios_tipo',
      'chk_notificaciones_usuarios_lectura',
      'chk_notificaciones_usuarios_cronologia'
    ],
    foraneas: [{
      nombre: 'fk_notificaciones_usuarios_destinatario',
      tablaReferenciada: 'usuarios',
      alBorrar: 'CASCADE',
      alActualizar: 'RESTRICT'
    }],
    triggersAdicionales: [{
      trigger: 'trg_notificaciones_usuarios_proteger_update',
      tabla: 'notificaciones_usuarios',
      momento: 'BEFORE',
      evento: 'UPDATE'
    }]
  }),
  '0218_crear_obligaciones_postcommit_eliminacion_agentes.sql': definir({
    tabla: [
      'obligaciones_postcommit_eliminacion_agentes',
      'obligaciones_postcommit_operaciones_administrativas'
    ],
    columnas: {
      obligacion_id: 'binary(16)',
      operacion_id: 'binary(16)',
      tipo: [
        "enum('retirar_sesion_redis','retirar_perfil_servidor_redis','retirar_agenda_servidor_redis','invalidar_catalogo_monitores','publicar_invalidacion_portal')",
        "enum('retirar_sesion_redis','retirar_perfil_servidor_redis','retirar_agenda_servidor_redis','invalidar_catalogo_monitores','invalidar_sesiones_usuarios_redis','retirar_estructura_organizacion_redis','publicar_invalidacion_portal')"
      ],
      version_contrato: 'smallint(5) unsigned',
      agente_id: 'bigint(20) unsigned',
      operacion_sesion_id: 'binary(16)',
      generacion_perfil: 'bigint(20) unsigned',
      destinatario_usuario_id: 'bigint(20) unsigned',
      objetivo_canonico: 'longtext',
      huella_objetivo: 'binary(32)',
      estado: "enum('pendiente','procesando','reintentable','bloqueo_permanente','completada')",
      intentos: 'smallint(5) unsigned',
      max_intentos: 'smallint(5) unsigned',
      proximo_intento_utc: 'datetime(3)',
      instancia_id: 'varchar(128)',
      lease_token: 'binary(32)',
      lease_expira_utc: 'datetime(3)',
      fencing_token: 'bigint(20) unsigned',
      ultimo_codigo_error: 'varchar(64)',
      ultimo_mensaje_error: 'varchar(512)',
      creada_en_utc: 'datetime(3)',
      actualizada_en_utc: 'datetime(3)',
      terminada_en_utc: 'datetime(3)',
      retener_hasta_utc: 'datetime(3)'
    },
    atributosColumnas: {
      estado: { nullable: false, valorPorDefecto: "'pendiente'" },
      intentos: { nullable: false, valorPorDefecto: '0' },
      max_intentos: { nullable: false, valorPorDefecto: '20' },
      fencing_token: { nullable: false, valorPorDefecto: '0' }
    },
    indices: [
      { nombre: 'PRIMARY', unico: true, columnas: ['obligacion_id'] },
      {
        nombre: 'idx_obligaciones_postcommit_objetivo',
        unico: false,
        columnas: ['operacion_id', 'tipo', 'huella_objetivo', 'obligacion_id']
      },
      {
        nombre: 'idx_obligaciones_postcommit_operacion',
        unico: false,
        columnas: ['operacion_id', 'estado', 'tipo', 'obligacion_id']
      },
      {
        nombre: 'idx_obligaciones_postcommit_reclamacion',
        unico: false,
        columnas: ['estado', 'proximo_intento_utc', 'creada_en_utc', 'obligacion_id']
      },
      {
        nombre: 'idx_obligaciones_postcommit_lease',
        unico: false,
        columnas: ['estado', 'lease_expira_utc', 'creada_en_utc', 'obligacion_id']
      },
      {
        nombre: 'idx_obligaciones_postcommit_fencing',
        unico: false,
        columnas: ['instancia_id', 'fencing_token', 'lease_expira_utc', 'obligacion_id']
      },
      {
        nombre: 'idx_obligaciones_postcommit_retencion',
        unico: false,
        columnas: ['retener_hasta_utc', 'obligacion_id']
      }
    ],
    checks: [
      'chk_obligaciones_postcommit_uuidv7',
      'chk_obligaciones_postcommit_contrato',
      'chk_obligaciones_postcommit_objetivo',
      'chk_obligaciones_postcommit_contadores',
      'chk_obligaciones_postcommit_diagnostico',
      'chk_obligaciones_postcommit_cronologia',
      'chk_obligaciones_postcommit_estado'
    ],
    triggersAdicionales: [{
      trigger: [
        'trg_obligaciones_postcommit_proteger_update',
        'trg_obligaciones_postcommit_operaciones_proteger_update'
      ],
      tabla: [
        'obligaciones_postcommit_eliminacion_agentes',
        'obligaciones_postcommit_operaciones_administrativas'
      ],
      momento: 'BEFORE',
      evento: 'UPDATE'
    }]
  }),
  '0219_atribuir_identidades_telemetria_agentes.sql': definir({
    tabla: 'identidades_elementos_telemetria_federacion',
    columnas: {
      agente_id_local: 'bigint(20) unsigned'
    },
    atributosColumnas: {
      agente_id_local: { nullable: true }
    },
    indices: [{
      nombre: 'idx_identidades_telemetria_agente',
      unico: false,
      columnas: ['agente_id_local', 'tipo_elemento', 'estado', 'clave_local']
    }],
    checks: ['chk_identidades_telemetria_agente'],
    triggersAdicionales: [
      {
        trigger: 'trg_identidad_telemetria_atribuida',
        tabla: 'identidades_elementos_telemetria_federacion',
        momento: 'BEFORE',
        evento: 'INSERT'
      },
      {
        trigger: 'trg_identidad_telemetria_inmutable',
        tabla: 'identidades_elementos_telemetria_federacion',
        momento: 'BEFORE',
        evento: 'UPDATE'
      }
    ],
    validacionesDatos: [{
      sql: `SELECT COUNT(*) AS incumplimientos
              FROM identidades_elementos_telemetria_federacion
             WHERE estado='vigente' AND agente_id_local IS NULL`,
      mensaje: 'Existen identidades vigentes de telemetría sin agente local demostrable.'
    }]
  }),
  '0220_indexar_inventario_eliminacion_agentes.sql': definir({
    tabla: 'reglas_derivacion_telemetria',
    columnas: {},
    indices: [{
      nombre: 'idx_reglas_derivacion_agente_id',
      unico: false,
      columnas: ['agente_id', 'id']
    }],
    tablasAdicionales: [
      {
        tabla: 'vinculos_monitores_telemetria',
        columnas: {},
        indices: [{
          nombre: 'idx_vinculos_monitores_agente_monitor',
          unico: false,
          columnas: ['agente_id', 'monitor_id']
        }]
      },
      {
        tabla: 'asignaciones_triggers_monitores',
        columnas: {},
        indices: [{
          nombre: 'idx_asignaciones_monitor_id',
          unico: false,
          columnas: ['monitor_id', 'id']
        }]
      },
      {
        tabla: 'identidades_elementos_telemetria_federacion',
        columnas: {},
        indices: [{
          nombre: 'idx_identidades_telemetria_agente_orden',
          unico: false,
          columnas: [
            'agente_id_local', 'tipo_elemento', 'clave_local', 'elemento_origen_id'
          ]
        }]
      },
      {
        tabla: 'identidades_elementos_monitores_federacion',
        columnas: {},
        indices: [{
          nombre: 'idx_identidades_monitores_monitor_orden',
          unico: false,
          columnas: [
            'monitor_id_local', 'tipo_elemento', 'clave_local', 'elemento_origen_id'
          ]
        }]
      },
      {
        tabla: 'operaciones_sesion_agentes',
        columnas: {},
        indices: [{
          nombre: 'idx_operaciones_sesion_agente_operacion',
          unico: false,
          columnas: ['agente_id', 'operacion_id']
        }]
      },
      {
        tabla: 'ejecuciones_triggers',
        columnas: {},
        indices: [{
          nombre: 'idx_ejecuciones_trigger_monitor_id',
          unico: false,
          columnas: ['monitor_id', 'id']
        }]
      }
    ]
  }),
  '0221_ampliar_productores_auditoria_agentes.sql': definir({
    tipo: 'alteracion_tabla',
    tabla: 'eventos_auditoria',
    columnas: {
      productor: "enum('auditoria_nucleo','portal_web','api_agentes','runtime_alertas','runtime_automatizacion','runtime_dns','runtime_agentes','runtime_operaciones_administrativas','bootstrap','tarea_retencion','portal_federacion','api_federacion','runtime_federacion')"
    },
    indices: [],
    tablasAdicionales: [{
      tabla: 'identidades_idempotentes_auditoria',
      columnas: {
        productor: "enum('auditoria_nucleo','portal_web','api_agentes','runtime_alertas','runtime_automatizacion','runtime_dns','runtime_agentes','runtime_operaciones_administrativas','bootstrap','tarea_retencion','portal_federacion','api_federacion','runtime_federacion')"
      }
    }]
  }),
  '0222_separar_resultado_eliminacion_limpieza_postcommit.sql': definir({
    tipo: 'alteracion_tabla',
    tabla: 'notificaciones_usuarios',
    columnas: {},
    indices: [],
    checks: ['chk_notificaciones_usuarios_tipo']
  }),
  '0223_ampliar_operaciones_administrativas_organizacion.sql': definir({
    tipo: 'alteracion_tabla',
    tabla: 'operaciones_administrativas',
    columnas: {
      tipo: "enum('eliminar_agente','eliminar_organizacion')",
      sujeto_tipo: "enum('agente','tenant','empresa','sitio')",
      sujeto_guid: 'char(36)'
    },
    atributosColumnas: {
      sujeto_guid: { nullable: true }
    },
    indices: [
      {
        nombre: 'idx_operaciones_administrativas_sujeto',
        unico: false,
        columnas: ['sujeto_tipo', 'sujeto_id', 'estado', 'creada_en_utc', 'operacion_id']
      }
    ],
    checks: ['chk_operaciones_administrativas_contrato'],
    tablasAdicionales: [{
      tabla: 'recursos_operaciones_administrativas',
      columnas: {
        tipo_recurso: "enum('agente','tenant','empresa','sitio')"
      },
      indices: [
        {
          nombre: 'idx_recursos_operaciones_administrativas_resolucion',
          unico: false,
          columnas: ['tipo_recurso', 'estado_reclamo', 'recurso_id', 'operacion_id']
        }
      ],
      checks: ['chk_recursos_operaciones_administrativas_identidad']
    }]
  }),
  '0224_generalizar_notificaciones_operaciones_administrativas.sql': definir({
    tipo: 'alteracion_tabla',
    tabla: 'notificaciones_usuarios',
    columnas: {
      tipo: "enum('eliminacion_encolada','agente_eliminado','agente_eliminado_limpieza_pendiente','organizacion_eliminada','limpieza_tecnica_completada','eliminacion_fallida')",
      sujeto_tipo: "enum('agente','tenant','empresa','sitio')",
      sujeto_guid: 'char(36)'
    },
    atributosColumnas: {
      sujeto_guid: { nullable: true }
    },
    indices: [],
    checks: [
      'chk_notificaciones_usuarios_contrato',
      'chk_notificaciones_usuarios_tipo'
    ]
  }),
  '0225_generalizar_obligaciones_postcommit_operaciones_administrativas.sql': definir({
    tipo: 'alteracion_tabla',
    tabla: 'obligaciones_postcommit_operaciones_administrativas',
    columnas: {
      tipo: "enum('retirar_sesion_redis','retirar_perfil_servidor_redis','retirar_agenda_servidor_redis','invalidar_catalogo_monitores','invalidar_sesiones_usuarios_redis','retirar_estructura_organizacion_redis','publicar_invalidacion_portal')",
      objetivo_tipo: "enum('agente','usuario','tenant','empresa','sitio')",
      objetivo_id: 'bigint(20) unsigned',
      agente_id: 'bigint(20) unsigned',
      destinatario_usuario_id: 'bigint(20) unsigned'
    },
    atributosColumnas: {
      objetivo_tipo: { nullable: false },
      objetivo_id: { nullable: false }
    },
    indices: [{
      nombre: 'idx_obligaciones_postcommit_identidad_objetivo',
      unico: false,
      columnas: ['objetivo_tipo', 'objetivo_id', 'estado', 'obligacion_id']
    }],
    checks: [
      'chk_obligaciones_postcommit_uuidv7',
      'chk_obligaciones_postcommit_contrato',
      'chk_obligaciones_postcommit_objetivo',
      'chk_obligaciones_postcommit_contadores',
      'chk_obligaciones_postcommit_diagnostico',
      'chk_obligaciones_postcommit_cronologia',
      'chk_obligaciones_postcommit_estado'
    ],
    triggersAdicionales: [{
      trigger: 'trg_obligaciones_postcommit_operaciones_proteger_update',
      tabla: 'obligaciones_postcommit_operaciones_administrativas',
      momento: 'BEFORE',
      evento: 'UPDATE'
    }]
  }),
  '0226_preparar_autoridad_global_correo.sql': definir({
    tipo: 'alteracion_tabla',
    tabla: 'configuracion_portal',
    columnas: {
      participa_admision_correo: 'tinyint(1)',
      invalida_prueba_smtp: 'tinyint(1)'
    },
    atributosColumnas: {
      participa_admision_correo: BOOLEANO_DENEGADO_POR_DEFECTO,
      invalida_prueba_smtp: BOOLEANO_DENEGADO_POR_DEFECTO
    },
    indices: [
      {
        nombre: 'idx_configuracion_portal_admision_correo',
        unico: false,
        columnas: ['participa_admision_correo', 'clave']
      },
      {
        nombre: 'idx_configuracion_portal_prueba_smtp',
        unico: false,
        columnas: ['invalida_prueba_smtp', 'clave']
      }
    ],
    checks: [
      'chk_configuracion_portal_admision_correo',
      'chk_configuracion_portal_prueba_smtp'
    ],
    tablasAdicionales: [
      {
        tabla: 'estado_verificacion_correo',
        columnas: {
          id: 'tinyint(3) unsigned',
          verificado: 'tinyint(1)',
          perfil_version: 'varchar(32)',
          huella_hmac: 'binary(32)',
          key_id: 'varchar(64)',
          configuracion_version: 'bigint(20) unsigned',
          verificado_por_usuario_id: 'bigint(20) unsigned',
          verificado_en_utc: 'datetime(3)',
          invalidado_en_utc: 'datetime(3)'
        },
        checks: [
          'chk_estado_verificacion_correo_unico',
          'chk_estado_verificacion_correo_booleano',
          'chk_estado_verificacion_correo_prueba',
          'chk_estado_verificacion_correo_invalidacion'
        ]
      },
      {
        tabla: 'estado_despliegue_trigger_correo',
        columnas: {
          id: 'tinyint(3) unsigned',
          perfil_objetivo: 'varchar(64)',
          estado: "enum('preparacion','corte_origen','corte_verificacion','quietud_cola','activado')",
          guard_metadatos_activo: 'tinyint(1)',
          origen_portal_autoritativo: 'tinyint(1)',
          verificacion_smtp_autoritativa: 'tinyint(1)',
          guard_verificacion_legacy_activo: 'tinyint(1)',
          guard_revision_trigger_activo: 'tinyint(1)',
          cola_sql_autoritativa: 'tinyint(1)',
          tipo_correo_habilitado: 'tinyint(1)',
          revision: 'bigint(20) unsigned',
          preparado_en_utc: 'datetime(3)',
          cortado_en_utc: 'datetime(3)',
          activado_en_utc: 'datetime(3)'
        },
        checks: [
          'chk_estado_despliegue_correo_unico',
          'chk_estado_despliegue_correo_revision',
          'chk_estado_despliegue_correo_guards',
          'chk_estado_despliegue_correo_cronologia',
          'chk_estado_despliegue_correo_activacion'
        ]
      }
    ],
    validacionesDatos: [
      {
        sql: `SELECT ABS(4 - COUNT(*)) AS incumplimientos
                FROM (
                  SELECT clave
                    FROM configuracion_portal
                   WHERE clave IN (
                     'portal.origen_publico',
                     'correo.desuscripcion_ttl_dias',
                     'correo.destinatarios_trigger_maximos',
                     'correo.retencion_salidas_dias'
                   )
                   GROUP BY clave
                ) AS presentes`,
        mensaje: 'Faltan valores globales preparados para correo.'
      },
      {
        sql: `SELECT ABS(1 - COUNT(*)) AS incumplimientos
                FROM estado_verificacion_correo
               WHERE id = 1`,
        mensaje: 'Falta la cabecera única de verificación de correo.'
      },
      {
        sql: `SELECT ABS(1 - COUNT(*)) AS incumplimientos
                FROM estado_despliegue_trigger_correo
               WHERE id = 1`,
        mensaje: 'Falta la cabecera única de despliegue del trigger de correo.'
      }
    ]
  }),
  '0226b_preparar_guards_autoridad_correo.sql': definirTrigger({
    trigger: 'trg_configuracion_portal_guard_correo',
    tabla: 'configuracion_portal',
    momento: 'BEFORE',
    evento: 'UPDATE'
  }),
  '0227_crear_declaracion_intencion_trigger_correo.sql': definir({
    tipo: 'alteracion_tabla',
    tabla: 'triggers',
    columnas: {
      revision_declaracion: 'bigint(20) unsigned'
    },
    atributosColumnas: {
      revision_declaracion: { nullable: false, valorPorDefecto: '1' }
    },
    indices: [],
    checks: ['chk_triggers_revision_declaracion'],
    tablasAdicionales: [
      {
        tabla: 'destinatarios_triggers_correo',
        collation: 'utf8mb4_bin',
        columnas: {
          id: 'bigint(20) unsigned',
          trigger_id: 'bigint(20) unsigned',
          tipo: "enum('manual','usuario')",
          usuario_id: 'bigint(20) unsigned',
          email_manual: 'varchar(190)',
          email_manual_canonico: 'varchar(190)',
          normalizacion_buzon_version: 'varchar(32)',
          estado_participacion: "enum('activa','desuscrita')",
          desuscrita_en_utc: 'datetime(3)',
          reincorporada_en_utc: 'datetime(3)',
          cambiada_en_utc: 'datetime(3)'
        },
        atributosColumnas: {
          email_manual_canonico: { collation: 'utf8mb4_bin' },
          normalizacion_buzon_version: {
            nullable: false,
            valorPorDefecto: 'buzon@1',
            collation: 'ascii_bin'
          }
        },
        indices: [
          {
            nombre: 'uk_destinatarios_correo_trigger_usuario',
            unico: true,
            columnas: ['trigger_id', 'usuario_id']
          },
          {
            nombre: 'uk_destinatarios_correo_trigger_manual',
            unico: true,
            columnas: ['trigger_id', 'email_manual_canonico']
          },
          {
            nombre: 'idx_destinatarios_correo_trigger_estado',
            unico: false,
            columnas: ['trigger_id', 'estado_participacion', 'id']
          }
        ],
        checks: [
          'chk_destinatarios_correo_identidad',
          'chk_destinatarios_correo_normalizacion',
          'chk_destinatarios_correo_desuscripcion',
          'chk_destinatarios_correo_cronologia'
        ],
        foraneas: [
          {
            nombre: 'fk_destinatarios_correo_trigger',
            tablaReferenciada: 'triggers',
            alBorrar: 'CASCADE',
            alActualizar: 'RESTRICT'
          },
          {
            nombre: 'fk_destinatarios_correo_usuario',
            tablaReferenciada: 'usuarios',
            alBorrar: 'CASCADE',
            alActualizar: 'RESTRICT'
          }
        ]
      },
      {
        tabla: 'notificaciones_triggers_correo',
        collation: 'utf8mb4_bin',
        columnas: {
          id: 'bigint(20) unsigned',
          ejecucion_trigger_id: 'bigint(20) unsigned',
          clave_idempotencia: 'binary(32)',
          revision_declaracion: 'bigint(20) unsigned',
          trigger_id: 'bigint(20) unsigned',
          trigger_id_fotografia: 'bigint(20) unsigned',
          asignacion_trigger_monitor_id: 'bigint(20) unsigned',
          asignacion_id_fotografia: 'bigint(20) unsigned',
          monitor_id: 'bigint(20) unsigned',
          monitor_id_fotografia: 'bigint(20) unsigned',
          alerta_auditoria_id: 'binary(16)',
          evento_disparo: "enum('apertura_alerta','cierre_alerta')",
          origen_causal: "enum('directo','telemetria','logico','otro')",
          scope_trigger_nivel: "enum('portal','tenant','empresa','sitio')",
          scope_monitor_nivel: "enum('portal','tenant','empresa','sitio')",
          cuerpo_base_texto: 'text',
          renderizador_version: 'varchar(32)',
          aceptada_en_utc: 'datetime(3)'
        },
        atributosColumnas: {
          trigger_id: { nullable: true },
          asignacion_trigger_monitor_id: { nullable: true },
          monitor_id: { nullable: true },
          renderizador_version: { nullable: false, collation: 'ascii_bin' }
        },
        indices: [
          {
            nombre: 'uk_notificaciones_correo_ejecucion',
            unico: true,
            columnas: ['ejecucion_trigger_id']
          },
          {
            nombre: 'uk_notificaciones_correo_id_ejecucion',
            unico: true,
            columnas: ['id', 'ejecucion_trigger_id']
          },
          {
            nombre: 'uk_notificaciones_correo_idempotencia',
            unico: true,
            columnas: ['clave_idempotencia']
          }
        ],
        checks: [
          'chk_notificaciones_correo_versiones',
          'chk_notificaciones_correo_identidades',
          'chk_notificaciones_correo_uuidv7',
          'chk_notificaciones_correo_transicion',
          'chk_notificaciones_correo_scope_trigger',
          'chk_notificaciones_correo_scope_monitor',
          'chk_notificaciones_correo_cronologia'
        ],
        foraneas: [
          {
            nombre: 'fk_notificaciones_correo_ejecucion',
            tablaReferenciada: 'ejecuciones_triggers',
            alBorrar: 'RESTRICT',
            alActualizar: 'RESTRICT'
          },
          {
            nombre: 'fk_notificaciones_correo_trigger',
            tablaReferenciada: 'triggers',
            alBorrar: 'SET NULL',
            alActualizar: 'RESTRICT'
          },
          {
            nombre: 'fk_notificaciones_correo_asignacion',
            tablaReferenciada: 'asignaciones_triggers_monitores',
            alBorrar: 'SET NULL',
            alActualizar: 'RESTRICT'
          },
          {
            nombre: 'fk_notificaciones_correo_monitor',
            tablaReferenciada: 'monitores',
            alBorrar: 'SET NULL',
            alActualizar: 'RESTRICT'
          }
        ]
      },
      {
        tabla: 'resultados_destinatarios_triggers_correo',
        collation: 'utf8mb4_bin',
        columnas: {
          id: 'bigint(20) unsigned',
          ejecucion_trigger_id: 'bigint(20) unsigned',
          notificacion_trigger_correo_id: 'bigint(20) unsigned',
          clave_procedencia: 'binary(32)',
          relacion_destinatario_id: 'bigint(20) unsigned',
          tipo: "enum('manual','usuario')",
          usuario_id: 'bigint(20) unsigned',
          usuario_id_fotografia: 'bigint(20) unsigned',
          email_manual_canonico: 'varchar(190)',
          normalizacion_buzon_version: 'varchar(32)',
          estado_observado: "enum('activa')",
          clave_buzon_sha256: 'binary(32)',
          codigo_inicial: "enum('aceptado','usuario_inactivo','email_ausente','email_no_validado','email_invalido')",
          salida_correo_id: 'bigint(20) unsigned'
        },
        atributosColumnas: {
          notificacion_trigger_correo_id: { nullable: true },
          relacion_destinatario_id: { nullable: true },
          usuario_id: { nullable: true },
          email_manual_canonico: { collation: 'utf8mb4_bin' },
          normalizacion_buzon_version: { collation: 'ascii_bin' },
          email_resuelto_canonico: { collation: 'utf8mb4_bin' },
          salida_correo_id: { nullable: true }
        },
        indices: [
          {
            nombre: 'uk_resultados_correo_ejecucion_procedencia',
            unico: true,
            columnas: ['ejecucion_trigger_id', 'clave_procedencia']
          },
          {
            nombre: 'idx_resultados_correo_notificacion',
            unico: false,
            columnas: ['notificacion_trigger_correo_id', 'ejecucion_trigger_id', 'id']
          }
        ],
        checks: [
          'chk_resultados_correo_procedencia',
          'chk_resultados_correo_normalizacion',
          'chk_resultados_correo_aceptacion',
          'chk_resultados_correo_manual_resuelto'
        ],
        foraneas: [
          {
            nombre: 'fk_resultados_correo_ejecucion',
            tablaReferenciada: 'ejecuciones_triggers',
            alBorrar: 'RESTRICT',
            alActualizar: 'RESTRICT'
          },
          {
            nombre: 'fk_resultados_correo_notificacion_ejecucion',
            tablaReferenciada: 'notificaciones_triggers_correo',
            alBorrar: 'RESTRICT',
            alActualizar: 'RESTRICT'
          },
          {
            nombre: 'fk_resultados_correo_relacion',
            tablaReferenciada: 'destinatarios_triggers_correo',
            alBorrar: 'SET NULL',
            alActualizar: 'RESTRICT'
          },
          {
            nombre: 'fk_resultados_correo_usuario',
            tablaReferenciada: 'usuarios',
            alBorrar: 'SET NULL',
            alActualizar: 'RESTRICT'
          },
          {
            nombre: 'fk_resultados_correo_salida',
            tablaReferenciada: 'cola_correos_salida',
            alBorrar: 'RESTRICT',
            alActualizar: 'RESTRICT'
          }
        ]
      },
      {
        tabla: 'capacidades_desuscripcion_correo',
        collation: 'utf8mb4_bin',
        columnas: {
          id: 'bigint(20) unsigned',
          salida_correo_id: 'bigint(20) unsigned',
          trigger_id: 'bigint(20) unsigned',
          trigger_id_fotografia: 'bigint(20) unsigned',
          perfil_version: 'smallint(5) unsigned',
          token_hash_sha256: 'binary(32)',
          ttl_dias: 'smallint(5) unsigned',
          estado: "enum('preparada','emitida')",
          emitida_en_utc: 'datetime(3)',
          expira_en_utc: 'datetime(3)'
        },
        atributosColumnas: {
          trigger_id: { nullable: true },
          emitida_en_utc: { nullable: true },
          expira_en_utc: { nullable: true }
        },
        indices: [
          {
            nombre: 'uk_capacidades_correo_salida',
            unico: true,
            columnas: ['salida_correo_id']
          },
          {
            nombre: 'uk_capacidades_correo_token',
            unico: true,
            columnas: ['token_hash_sha256']
          }
        ],
        checks: [
          'chk_capacidades_correo_version',
          'chk_capacidades_correo_ttl',
          'chk_capacidades_correo_estado'
        ],
        foraneas: [
          {
            nombre: 'fk_capacidades_correo_salida',
            tablaReferenciada: 'cola_correos_salida',
            alBorrar: 'RESTRICT',
            alActualizar: 'RESTRICT'
          },
          {
            nombre: 'fk_capacidades_correo_trigger',
            tablaReferenciada: 'triggers',
            alBorrar: 'SET NULL',
            alActualizar: 'RESTRICT'
          }
        ]
      }
    ],
    validacionesDatos: [{
      sql: `SELECT COUNT(*) AS incumplimientos
              FROM triggers
             WHERE revision_declaracion < 1`,
      mensaje: 'Existen triggers sin revisión de declaración válida.'
    }]
  }),
  '0227b_preparar_guard_revision_triggers.sql': definirTrigger({
    trigger: 'trg_triggers_guard_revision_declaracion',
    tabla: 'triggers',
    momento: 'BEFORE',
    evento: 'UPDATE'
  }),
  '0228_ampliar_autoridad_cola_correo.sql': definir({
    tipo: 'alteracion_tabla',
    tabla: 'cola_correos_salida',
    columnas: {
      origen_tipo: "enum('prueba','trigger')",
      productor_version: 'varchar(32)',
      notificacion_trigger_correo_id: 'bigint(20) unsigned',
      ejecucion_trigger_id: 'bigint(20) unsigned',
      destinatario_email: 'varchar(190)',
      normalizacion_buzon_version: 'varchar(32)',
      clave_buzon_sha256: 'binary(32)',
      modo_remitente: "enum('fotografiado','configuracion_actual')",
      remitente_email: 'varchar(190)',
      remitente_nombre: 'varchar(190)',
      smtp_message_id: 'varchar(384)',
      estado: "enum('pendiente','reclamada','enviando','error_reintentable','enviado','error_final','resultado_ambiguo')",
      estado_previo_reclamacion: "enum('pendiente','error_reintentable')",
      claim_id: 'binary(32)',
      propietario_claim: 'varchar(190)',
      lease_token: 'binary(32)',
      lease_expira_utc: 'datetime(3)',
      fencing_token: 'bigint(20) unsigned',
      reclamada_en_utc: 'datetime(3)',
      enviando_en_utc: 'datetime(3)',
      configuracion_version_ultimo_intento: 'bigint(20) unsigned',
      codigo_resultado: 'varchar(120)',
      respuesta_saneada: 'text',
      fecha_terminal_utc: 'datetime(3)',
      proximo_intento_en: 'datetime(3)',
      fecha_creacion: 'datetime(3)',
      fecha_actualizacion: 'datetime(3)',
      fecha_ultimo_intento: 'datetime(3)',
      fecha_envio: 'datetime(3)'
    },
    atributosColumnas: {
      origen_tipo: { nullable: false, valorPorDefecto: 'prueba' },
      productor_version: { nullable: false, valorPorDefecto: 'legacy' },
      notificacion_trigger_correo_id: { nullable: true },
      ejecucion_trigger_id: { nullable: true },
      normalizacion_buzon_version: { nullable: true },
      clave_buzon_sha256: { nullable: true },
      modo_remitente: { nullable: false, valorPorDefecto: 'fotografiado' },
      remitente_email: { nullable: true },
      remitente_nombre: { nullable: true },
      smtp_message_id: { nullable: true },
      claim_id: { nullable: true },
      lease_token: { nullable: true },
      fencing_token: { nullable: false, valorPorDefecto: '0' },
      fecha_terminal_utc: { nullable: true }
    },
    indices: [
      {
        nombre: 'uk_cola_correos_notificacion_buzon',
        unico: true,
        columnas: ['notificacion_trigger_correo_id', 'clave_buzon_sha256']
      },
      {
        nombre: 'uk_cola_correos_smtp_message_id',
        unico: true,
        columnas: ['smtp_message_id']
      },
      {
        nombre: 'uk_cola_correos_claim_id',
        unico: true,
        columnas: ['claim_id']
      },
      {
        nombre: 'idx_cola_correos_reclamacion_sql',
        unico: false,
        columnas: ['productor_version', 'estado', 'proximo_intento_en', 'id']
      },
      {
        nombre: 'idx_cola_correos_lease',
        unico: false,
        columnas: ['productor_version', 'estado', 'lease_expira_utc', 'id']
      }
    ],
    checks: [
      'chk_cola_correos_origen',
      'chk_cola_correos_productor',
      'chk_cola_correos_remitente',
      'chk_cola_correos_message_id',
      'chk_cola_correos_claim',
      'chk_cola_correos_frontera_envio',
      'chk_cola_correos_terminal',
      'chk_cola_correos_respuesta_saneada'
    ],
    foraneas: [
      {
        nombre: 'fk_cola_correos_notificacion_ejecucion',
        tablaReferenciada: 'notificaciones_triggers_correo',
        alBorrar: 'RESTRICT',
        alActualizar: 'RESTRICT'
      },
      {
        nombre: 'fk_cola_correos_ejecucion',
        tablaReferenciada: 'ejecuciones_triggers',
        alBorrar: 'RESTRICT',
        alActualizar: 'RESTRICT'
      }
    ],
    tablasAdicionales: [
      {
        tabla: 'reclamaciones_correos_salida',
        collation: 'utf8mb4_bin',
        columnas: {
          id: 'bigint(20) unsigned',
          salida_correo_id: 'bigint(20) unsigned',
          claim_id: 'binary(32)',
          fencing_token: 'bigint(20) unsigned',
          propietario_claim: 'varchar(190)',
          estado_previo: "enum('pendiente','error_reintentable')",
          estado: "enum('reclamada','enviando','liberada','finalizada','resultado_ambiguo')",
          reclamada_en_utc: 'datetime(3)',
          lease_expira_utc: 'datetime(3)',
          enviando_en_utc: 'datetime(3)',
          finalizada_en_utc: 'datetime(3)',
          codigo_resultado: 'varchar(120)'
        },
        atributosColumnas: {
          claim_id: { nullable: false },
          fencing_token: { nullable: false },
          propietario_claim: { nullable: false, collation: 'ascii_bin' }
        },
        indices: [
          {
            nombre: 'uk_reclamaciones_correo_claim',
            unico: true,
            columnas: ['claim_id']
          },
          {
            nombre: 'uk_reclamaciones_correo_salida_fencing',
            unico: true,
            columnas: ['salida_correo_id', 'fencing_token']
          },
          {
            nombre: 'idx_reclamaciones_correo_estado_lease',
            unico: false,
            columnas: ['estado', 'lease_expira_utc', 'id']
          }
        ],
        checks: [
          'chk_reclamaciones_correo_fencing',
          'chk_reclamaciones_correo_lease',
          'chk_reclamaciones_correo_estado',
          'chk_reclamaciones_correo_cronologia'
        ],
        foraneas: [{
          nombre: 'fk_reclamaciones_correo_salida',
          tablaReferenciada: 'cola_correos_salida',
          alBorrar: 'RESTRICT',
          alActualizar: 'RESTRICT'
        }]
      },
      {
        tabla: 'intentos_correos_salida',
        collation: 'utf8mb4_bin',
        columnas: {
          id: 'bigint(20) unsigned',
          salida_correo_id: 'bigint(20) unsigned',
          reclamacion_correo_id: 'bigint(20) unsigned',
          perfil_version: 'smallint(5) unsigned',
          numero: 'int(10) unsigned',
          configuracion_version: 'bigint(20) unsigned',
          smtp_message_id: 'varchar(384)',
          estado: "enum('en_curso','aceptado','rechazado','fallido_reintentable','fallido_final','ambiguo')",
          iniciado_en_utc: 'datetime(3)',
          finalizado_en_utc: 'datetime(3)',
          clasificacion: "enum('aceptacion_demostrada','rechazo_permanente','fallo_reintentable','fallo_final','resultado_ambiguo')",
          codigo: 'varchar(120)',
          respuesta_saneada: 'text'
        },
        atributosColumnas: {
          perfil_version: { nullable: false, valorPorDefecto: '1' },
          smtp_message_id: { nullable: false, collation: 'ascii_bin' },
          finalizado_en_utc: { nullable: true },
          clasificacion: { nullable: true },
          codigo: { nullable: true },
          respuesta_saneada: { nullable: true }
        },
        indices: [
          {
            nombre: 'uk_intentos_correo_salida_numero',
            unico: true,
            columnas: ['salida_correo_id', 'numero']
          },
          {
            nombre: 'uk_intentos_correo_reclamacion',
            unico: true,
            columnas: ['reclamacion_correo_id']
          }
        ],
        checks: [
          'chk_intentos_correo_version',
          'chk_intentos_correo_estado',
          'chk_intentos_correo_clasificacion',
          'chk_intentos_correo_cronologia',
          'chk_intentos_correo_respuesta'
        ],
        foraneas: [
          {
            nombre: 'fk_intentos_correo_salida',
            tablaReferenciada: 'cola_correos_salida',
            alBorrar: 'RESTRICT',
            alActualizar: 'RESTRICT'
          },
          {
            nombre: 'fk_intentos_correo_reclamacion',
            tablaReferenciada: 'reclamaciones_correos_salida',
            alBorrar: 'RESTRICT',
            alActualizar: 'RESTRICT'
          }
        ]
      }
    ],
    triggersAdicionales: [
      {
        trigger: 'trg_cola_correos_guard_productor',
        tabla: 'cola_correos_salida',
        momento: 'BEFORE',
        evento: 'INSERT'
      },
      {
        trigger: 'trg_cola_correos_guard_mutacion',
        tabla: 'cola_correos_salida',
        momento: 'BEFORE',
        evento: 'UPDATE'
      }
    ],
    validacionesDatos: [{
      sql: `SELECT COUNT(*) AS incumplimientos
              FROM cola_correos_salida
             WHERE productor_version = 'legacy'
               AND (origen_tipo <> 'prueba'
                 OR modo_remitente <> 'fotografiado'
                 OR notificacion_trigger_correo_id IS NOT NULL
                 OR ejecucion_trigger_id IS NOT NULL
                 OR clave_buzon_sha256 IS NOT NULL
                 OR smtp_message_id IS NOT NULL)`,
      mensaje: 'La migración reinterpretó una salida legacy existente.'
    }]
  }),
  '0232_preparar_autoridad_evaluaciones_temporales_relativas.sql': definir({
    tipo: 'alteracion_tabla',
    tabla: 'reglas_derivacion_telemetria',
    columnas: {
      generacion_autoridad: 'bigint(20) unsigned'
    },
    atributosColumnas: {
      generacion_autoridad: { nullable: false, valorPorDefecto: '1' }
    },
    indices: [],
    checks: ['chk_reglas_derivacion_generacion_autoridad'],
    tablasAdicionales: [
      {
        tabla: 'revisiones_reglas_derivacion_telemetria',
        columnas: {
          condicion_tipo: "enum('numero','booleano','estado','texto','calidad','duracion','momento_utc','texto_regex','momento_utc_relativo')"
        }
      },
      {
        tabla: 'trabajos_evaluacion_telemetria',
        columnas: {
          causa: "enum('observacion','vencimiento_temporal','reconciliacion_administrativa','reconciliacion_reloj')",
          generacion_autoridad: 'bigint(20) unsigned',
          programado_para_utc: 'datetime(6)',
          clave_causal_canonica: 'varchar(768)',
          huella_causal_sha256: 'binary(32)',
          estado: "enum('pendiente','procesando','completado','error','neutralizado')",
          motivo_neutralizacion: "enum('regla_deshabilitada','generacion_sustituida','revision_sustituida','observacion_sustituida')"
        },
        atributosColumnas: {
          causa: { nullable: false, valorPorDefecto: 'observacion' },
          generacion_autoridad: { nullable: false, valorPorDefecto: '1' },
          programado_para_utc: { nullable: true },
          clave_causal_canonica: {
            nullable: false,
            valorPorDefecto: '',
            collation: 'ascii_bin'
          },
          huella_causal_sha256: { nullable: false },
          motivo_neutralizacion: { nullable: true }
        },
        indices: [
          {
            nombre: 'uk_trabajos_evaluacion_huella_causal',
            unico: true,
            columnas: ['huella_causal_sha256']
          },
          {
            nombre: 'idx_trabajos_evaluacion_programados',
            unico: false,
            columnas: ['estado', 'programado_para_utc', 'id']
          },
          {
            nombre: 'idx_trabajos_evaluacion_autoridad',
            unico: false,
            columnas: [
              'regla_id', 'generacion_autoridad', 'regla_revision_id',
              'observacion_id', 'id'
            ]
          }
        ],
        checks: [
          'chk_trabajos_evaluacion_generacion_autoridad',
          'chk_trabajos_evaluacion_programacion',
          'chk_trabajos_evaluacion_neutralizacion'
        ]
      },
      {
        tabla: 'evaluaciones_reglas_telemetria',
        columnas: {
          id: 'bigint(20) unsigned',
          trabajo_id: 'bigint(20) unsigned',
          regla_id: 'bigint(20) unsigned',
          causa: "enum('observacion','vencimiento_temporal','reconciliacion_administrativa','reconciliacion_reloj')",
          generacion_autoridad: 'bigint(20) unsigned',
          causalidad_revision: "enum('historica_recepcion','autoridad_actual')",
          resultado: "enum('coincide','no_coincide','no_evaluable')",
          lado_atencion: "enum('inferior','superior')",
          resultado_anterior: "enum('coincide','no_coincide','no_evaluable')",
          lado_anterior: "enum('inferior','superior')",
          momento_utc: 'datetime(6)',
          ahora_utc: 'datetime(6)',
          desviacion_segundos: 'bigint(20)',
          proxima_reevaluacion_utc: 'datetime(6)'
        },
        atributosColumnas: {
          trabajo_id: { nullable: false },
          causalidad_revision: { nullable: false },
          lado_atencion: { nullable: true },
          resultado_anterior: { nullable: true },
          lado_anterior: { nullable: true },
          momento_utc: { nullable: true },
          ahora_utc: { nullable: true },
          desviacion_segundos: { nullable: true },
          proxima_reevaluacion_utc: { nullable: true }
        },
        indices: [
          { nombre: 'PRIMARY', unico: true, columnas: ['id'] },
          { nombre: 'uk_evaluaciones_reglas_trabajo', unico: true, columnas: ['trabajo_id'] },
          {
            nombre: 'idx_evaluaciones_reglas_autoridad',
            unico: false,
            columnas: [
              'regla_id', 'generacion_autoridad', 'regla_revision_id',
              'observacion_id', 'id'
            ]
          },
          {
            nombre: 'idx_evaluaciones_reglas_proxima',
            unico: false,
            columnas: ['proxima_reevaluacion_utc', 'regla_id', 'id']
          }
        ],
        checks: [
          'chk_evaluaciones_reglas_generacion',
          'chk_evaluaciones_reglas_programacion',
          'chk_evaluaciones_reglas_lado',
          'chk_evaluaciones_reglas_estado_anterior',
          'chk_evaluaciones_reglas_temporal',
          'chk_evaluaciones_reglas_severidad'
        ],
        foraneas: [
          {
            nombre: 'fk_evaluaciones_reglas_trabajo',
            tablaReferenciada: 'trabajos_evaluacion_telemetria',
            alBorrar: 'CASCADE',
            alActualizar: 'RESTRICT'
          },
          {
            nombre: 'fk_evaluaciones_reglas_regla_contexto',
            tablaReferenciada: 'reglas_derivacion_telemetria',
            alBorrar: 'CASCADE',
            alActualizar: 'RESTRICT'
          },
          {
            nombre: 'fk_evaluaciones_reglas_revision',
            tablaReferenciada: 'revisiones_reglas_derivacion_telemetria',
            alBorrar: 'CASCADE',
            alActualizar: 'RESTRICT'
          },
          {
            nombre: 'fk_evaluaciones_reglas_observacion',
            tablaReferenciada: 'observaciones_telemetria_agentes',
            alBorrar: 'CASCADE',
            alActualizar: 'RESTRICT'
          }
        ]
      },
      {
        tabla: 'estado_actual_evaluacion_reglas_telemetria',
        columnas: {
          evaluacion_id: 'bigint(20) unsigned',
          generacion_autoridad: 'bigint(20) unsigned',
          causalidad_revision: "enum('historica_recepcion','autoridad_actual')",
          lado_atencion: "enum('inferior','superior')",
          proxima_reevaluacion_utc: 'datetime(6)'
        },
        atributosColumnas: {
          evaluacion_id: { nullable: true },
          generacion_autoridad: { nullable: false, valorPorDefecto: '1' },
          causalidad_revision: { nullable: false, valorPorDefecto: 'historica_recepcion' },
          lado_atencion: { nullable: true },
          proxima_reevaluacion_utc: { nullable: true }
        },
        indices: [
          { nombre: 'uk_estado_evaluacion_evaluacion', unico: true, columnas: ['evaluacion_id'] },
          {
            nombre: 'idx_estado_evaluacion_proxima',
            unico: false,
            columnas: ['proxima_reevaluacion_utc', 'regla_id', 'generacion_autoridad']
          }
        ],
        checks: ['chk_estado_evaluacion_generacion', 'chk_estado_evaluacion_lado'],
        foraneas: [{
          nombre: 'fk_estado_evaluacion_ledger',
          tablaReferenciada: 'evaluaciones_reglas_telemetria',
          alBorrar: 'CASCADE',
          alActualizar: 'RESTRICT'
        }]
      },
      {
        tabla: 'eventos_derivados_telemetria',
        columnas: {
          evaluacion_id: 'bigint(20) unsigned',
          generacion_autoridad: 'bigint(20) unsigned',
          causalidad_revision: "enum('historica_recepcion','autoridad_actual')",
          lado_atencion: "enum('inferior','superior')",
          proxima_reevaluacion_utc: 'datetime(6)'
        },
        atributosColumnas: {
          evaluacion_id: { nullable: true },
          generacion_autoridad: { nullable: false, valorPorDefecto: '1' },
          causalidad_revision: { nullable: false, valorPorDefecto: 'historica_recepcion' },
          lado_atencion: { nullable: true },
          proxima_reevaluacion_utc: { nullable: true }
        },
        indices: [
          { nombre: 'uk_eventos_derivados_evaluacion', unico: true, columnas: ['evaluacion_id'] },
          {
            nombre: 'idx_eventos_derivados_revision',
            unico: false,
            columnas: ['regla_id', 'regla_revision_id']
          },
          {
            nombre: 'idx_eventos_derivados_autoridad',
            unico: false,
            columnas: [
              'regla_id', 'generacion_autoridad', 'regla_revision_id',
              'observacion_id', 'id'
            ]
          }
        ],
        checks: ['chk_eventos_derivados_generacion', 'chk_eventos_derivados_lado'],
        foraneas: [{
          nombre: 'fk_eventos_derivados_evaluacion',
          tablaReferenciada: 'evaluaciones_reglas_telemetria',
          alBorrar: 'CASCADE',
          alActualizar: 'RESTRICT'
        }]
      }
    ],
    triggersAdicionales: [
      {
        trigger: 'trg_trabajos_evaluacion_causal_legacy',
        tabla: 'trabajos_evaluacion_telemetria',
        momento: 'BEFORE',
        evento: 'INSERT'
      },
      {
        trigger: 'trg_evaluaciones_reglas_impedir_update',
        tabla: 'evaluaciones_reglas_telemetria',
        momento: 'BEFORE',
        evento: 'UPDATE'
      },
      {
        trigger: 'trg_evaluaciones_reglas_impedir_delete',
        tabla: 'evaluaciones_reglas_telemetria',
        momento: 'BEFORE',
        evento: 'DELETE'
      }
    ],
    validacionesDatos: [
      {
        sql: `SELECT COUNT(*) AS incumplimientos
                FROM reglas_derivacion_telemetria
               WHERE generacion_autoridad < 1`,
        mensaje: 'Existe una regla sin generación de autoridad válida.'
      },
      {
        sql: `SELECT COUNT(*) AS incumplimientos
                FROM trabajos_evaluacion_telemetria
               WHERE causa IS NULL
                  OR generacion_autoridad < 1
                  OR clave_causal_canonica IS NULL
                  OR huella_causal_sha256 IS NULL`,
        mensaje: 'El backfill causal de trabajos de evaluación quedó incompleto.'
      }
    ]
  }),
  '0233_checkpoint_reloj_relativo_telemetria.sql': definir({
    tipo: 'creacion_tabla',
    tabla: 'checkpoint_reloj_relativo_telemetria',
    columnas: {
      id: 'tinyint(3) unsigned',
      ultimo_reloj_aceptado_utc: 'datetime',
      generacion_correccion: 'bigint(20) unsigned',
      fecha_creacion: 'datetime(6)',
      fecha_actualizacion: 'datetime(6)'
    },
    atributosColumnas: {
      id: { nullable: false },
      ultimo_reloj_aceptado_utc: { nullable: true },
      generacion_correccion: { nullable: false, valorPorDefecto: '0' }
    },
    indices: [{ nombre: 'PRIMARY', unico: true, columnas: ['id'] }],
    checks: [
      'chk_checkpoint_reloj_relativo_unico',
      'chk_checkpoint_reloj_relativo_generacion'
    ],
    tablasAdicionales: [{
      tabla: 'reconciliaciones_reloj_relativo_telemetria',
      columnas: {
        generacion_correccion: 'bigint(20) unsigned',
        reloj_anterior_utc: 'datetime',
        reloj_corregido_utc: 'datetime',
        cursor_regla_id: 'bigint(20) unsigned',
        reglas_procesadas: 'bigint(20) unsigned',
        estado: "enum('pendiente','completada')",
        completada_en_utc: 'datetime(6)'
      },
      atributosColumnas: {
        generacion_correccion: { nullable: false },
        cursor_regla_id: { nullable: false, valorPorDefecto: '0' },
        reglas_procesadas: { nullable: false, valorPorDefecto: '0' },
        estado: { nullable: false, valorPorDefecto: 'pendiente' },
        completada_en_utc: { nullable: true }
      },
      indices: [
        { nombre: 'PRIMARY', unico: true, columnas: ['generacion_correccion'] },
        {
          nombre: 'idx_reconciliaciones_reloj_relativo_pendientes',
          unico: false,
          columnas: ['estado', 'generacion_correccion', 'cursor_regla_id']
        }
      ],
      checks: [
        'chk_reconciliacion_reloj_relativo_generacion',
        'chk_reconciliacion_reloj_relativo_retroceso',
        'chk_reconciliacion_reloj_relativo_terminal'
      ]
    }],
    validacionesDatos: [{
      sql: `SELECT IF(COUNT(*) = 1 AND MIN(id) = 1, 0, 1) AS incumplimientos
              FROM checkpoint_reloj_relativo_telemetria`,
      mensaje: 'El checkpoint relativo no conserva su identidad singleton.'
    }]
  }),
  '0234_persistir_evidencia_correccion_reloj_telemetria.sql': definir({
    tipo: 'alteracion_tabla',
    tabla: 'trabajos_evaluacion_telemetria',
    columnas: {
      generacion_correccion: 'bigint(20) unsigned'
    },
    atributosColumnas: {
      generacion_correccion: { nullable: true }
    },
    indices: [{
      nombre: 'idx_trabajos_evaluacion_correccion',
      unico: false,
      columnas: ['generacion_correccion', 'regla_id', 'id']
    }],
    checks: ['chk_trabajos_evaluacion_correccion'],
    validacionesDatos: [{
      sql: `SELECT COUNT(*) AS incumplimientos
              FROM trabajos_evaluacion_telemetria
             WHERE (causa='reconciliacion_reloj' AND generacion_correccion IS NULL)
                OR (causa<>'reconciliacion_reloj' AND generacion_correccion IS NOT NULL)`,
      mensaje: 'La evidencia durable de corrección no corresponde a la causa.'
    }]
  }),
  '0235_agregar_generacion_recuperacion_usuarios.sql': definir({
    tipo: 'alteracion_tabla',
    tabla: 'usuarios',
    columnas: {
      generacion_recuperacion: 'bigint(20) unsigned'
    },
    atributosColumnas: {
      generacion_recuperacion: { nullable: false, valorPorDefecto: '1' }
    },
    indices: [{
      nombre: 'idx_usuarios_recuperacion_buzon',
      unico: false,
      columnas: [
        'email',
        'activo',
        'email_validado',
        'id',
        'generacion_recuperacion'
      ]
    }],
    checks: ['chk_usuarios_generacion_recuperacion'],
    validacionesDatos: [{
      sql: `SELECT COUNT(*) AS incumplimientos
              FROM usuarios
             WHERE generacion_recuperacion IS NULL
                OR generacion_recuperacion < 1`,
      mensaje: 'La generación de recuperación de usuarios no es positiva.'
    }]
  }),
  '0236_ampliar_cola_recuperacion_password.sql': definir({
    tipo: 'alteracion_tabla',
    tabla: 'cola_correos_salida',
    columnas: {
      origen_tipo: "enum('prueba','trigger','recuperacion_password')",
      proposito_recuperacion_password:
        "enum('transportar_solicitud','notificar_cambio')",
      solicitud_recuperacion_password_id: 'binary(16)',
      evento_emision_recuperacion_password_id: 'binary(16)',
      clave_operacion_recuperacion_password_sha256: 'binary(32)',
      direccion_ip_origen: 'varchar(45)',
      material_preparacion_recuperacion_password: 'longtext',
      cuerpo_texto: 'text',
      estado: "enum('preparada','pendiente','reclamada','enviando','error_reintentable','enviado','error_final','resultado_ambiguo','descartada')",
      causa_descarte: "enum('autoridad_buzon_retirada')"
    },
    atributosColumnas: {
      proposito_recuperacion_password: { nullable: true },
      solicitud_recuperacion_password_id: { nullable: true },
      evento_emision_recuperacion_password_id: { nullable: true },
      clave_operacion_recuperacion_password_sha256: { nullable: true },
      direccion_ip_origen: { nullable: true, collation: 'ascii_bin' },
      material_preparacion_recuperacion_password: { nullable: true },
      cuerpo_texto: { nullable: true },
      causa_descarte: { nullable: true }
    },
    indices: [
      {
        nombre: 'uk_cola_correos_recuperacion_proposito',
        unico: true,
        columnas: [
          'solicitud_recuperacion_password_id',
          'proposito_recuperacion_password'
        ]
      },
      {
        nombre: 'uk_cola_correos_recuperacion_operacion',
        unico: true,
        columnas: ['clave_operacion_recuperacion_password_sha256']
      },
      {
        nombre: 'idx_cola_correos_recuperacion_preparada',
        unico: false,
        columnas: ['origen_tipo', 'estado', 'fecha_creacion', 'id']
      }
    ],
    checks: [
      'chk_cola_correos_origen',
      'chk_cola_correos_productor',
      'chk_cola_correos_message_id',
      'chk_cola_correos_claim',
      'chk_cola_correos_frontera_envio',
      'chk_cola_correos_terminal',
      'chk_cola_correos_recuperacion_identidad',
      'chk_cola_correos_recuperacion_preparacion',
      'chk_cola_correos_descarte'
    ],
    tablasAdicionales: [
      {
        tabla: 'identidades_justificantes_correos_recuperacion_password',
        collation: 'utf8mb4_bin',
        columnas: {
          salida_correo_id: 'bigint(20) unsigned',
          usuario_id: 'bigint(20) unsigned',
          creada_en_utc: 'datetime(3)'
        },
        indices: [
          {
            nombre: 'PRIMARY',
            unico: true,
            columnas: ['salida_correo_id', 'usuario_id']
          },
          {
            nombre: 'idx_identidades_justificantes_correo_usuario',
            unico: false,
            columnas: ['usuario_id', 'salida_correo_id']
          }
        ],
        checks: ['chk_identidades_justificantes_correo_usuario'],
        foraneas: [{
          nombre: 'fk_identidades_justificantes_correo_salida',
          tablaReferenciada: 'cola_correos_salida',
          alBorrar: 'CASCADE',
          alActualizar: 'RESTRICT'
        }]
      },
      {
        tabla: 'cadenas_auditoria',
        columnas: {
          flujo: "enum('sistema','usuarios','organizacion','agentes','monitores','alertas','automatizacion','dns','federacion','internet')"
        },
        indices: []
      },
      {
        tabla: 'eventos_auditoria',
        columnas: {
          flujo: "enum('sistema','usuarios','organizacion','agentes','monitores','alertas','automatizacion','dns','federacion','internet')",
          sujeto_tipo: [
            "enum('usuario','sesion_usuario','agente','sesion_agente','regla_telemetria','monitor','alerta','trigger','destinatario_trigger_correo','binding_trigger','zona_dns','registro_dns','tenant','empresa','sitio','configuracion_portal','cadena_auditoria','incidente_integridad','instalacion_federada','relacion_federada','revision_concesion_federada','flujo_federado','lote_federado','proyeccion_federada','aviso_plataforma','frontera_internet')",
            "enum('frontera_internet','usuario','sesion_usuario','agente','sesion_agente','regla_telemetria','monitor','alerta','trigger','destinatario_trigger_correo','binding_trigger','zona_dns','registro_dns','concesion_ddns','intencion_ddns','tenant','empresa','sitio','configuracion_portal','cadena_auditoria','incidente_integridad','instalacion_federada','relacion_federada','revision_concesion_federada','flujo_federado','lote_federado','proyeccion_federada','aviso_plataforma')"
          ],
          causalidad_tipo: [
            "enum('evento_auditoria','evento_monitor','ejecucion_trigger','operacion_sesion_agente','generacion_dns','relacion_federacion','ocurrencia_federacion','entrega_federacion','aviso_plataforma','solicitud_recuperacion_password')",
            "enum('solicitud_recuperacion_password','evento_auditoria','evento_monitor','ejecucion_trigger','operacion_sesion_agente','generacion_dns','intencion_ddns','relacion_federacion','ocurrencia_federacion','entrega_federacion','aviso_plataforma')"
          ],
          productor: "enum('auditoria_nucleo','portal_web','api_agentes','runtime_alertas','runtime_automatizacion','runtime_dns','runtime_agentes','runtime_operaciones_administrativas','bootstrap','tarea_retencion','portal_federacion','api_federacion','runtime_federacion','recuperacion_password')"
        },
        indices: [],
        foraneas: [{
          nombre: 'fk_eventos_auditoria_cadena',
          tablaReferenciada: 'cadenas_auditoria',
          alBorrar: 'RESTRICT',
          alActualizar: 'RESTRICT'
        }]
      },
      {
        tabla: 'identidades_idempotentes_auditoria',
        columnas: {
          productor: "enum('auditoria_nucleo','portal_web','api_agentes','runtime_alertas','runtime_automatizacion','runtime_dns','runtime_agentes','runtime_operaciones_administrativas','bootstrap','tarea_retencion','portal_federacion','api_federacion','runtime_federacion','recuperacion_password')"
        },
        indices: []
      }
    ],
    triggersAdicionales: [
      {
        trigger: 'trg_cola_correos_guard_productor',
        tabla: 'cola_correos_salida',
        momento: 'BEFORE',
        evento: 'INSERT'
      },
      {
        trigger: 'trg_cola_correos_guard_mutacion',
        tabla: 'cola_correos_salida',
        momento: 'BEFORE',
        evento: 'UPDATE'
      }
    ],
    validacionesDatos: [{
      sql: `SELECT COUNT(*) AS incumplimientos
              FROM cola_correos_salida
             WHERE origen_tipo IN ('prueba','trigger')
               AND (proposito_recuperacion_password IS NOT NULL
                 OR solicitud_recuperacion_password_id IS NOT NULL
                 OR evento_emision_recuperacion_password_id IS NOT NULL
                 OR clave_operacion_recuperacion_password_sha256 IS NOT NULL
                 OR direccion_ip_origen IS NOT NULL
                 OR material_preparacion_recuperacion_password IS NOT NULL)`,
      mensaje: 'Una salida histórica adquirió semántica de recuperación.'
    }]
  }),
  '0237_crear_reinicios_password_administrativos.sql': definir({
    tabla: 'reinicios_password_administrativos',
    collation: 'utf8mb4_bin',
    columnas: {
      reinicio_id: 'binary(16)',
      usuario_id: 'bigint(20) unsigned',
      via: "enum('correo','manual')",
      estado: "enum('reservado','confirmado')",
      evento_auditoria_id: 'binary(16)',
      salida_correo_id: 'bigint(20) unsigned',
      version_sesion_resultante: 'int(10) unsigned',
      generacion_recuperacion_resultante: 'bigint(20) unsigned',
      creado_en_utc: 'datetime(3)',
      aplicado_en_utc: 'datetime(3)'
    },
    atributosColumnas: {
      reinicio_id: { nullable: false },
      usuario_id: { nullable: false },
      via: { nullable: false },
      estado: { nullable: false, valorPorDefecto: 'reservado' },
      evento_auditoria_id: { nullable: true },
      salida_correo_id: { nullable: true },
      version_sesion_resultante: { nullable: true },
      generacion_recuperacion_resultante: { nullable: true },
      creado_en_utc: { nullable: false },
      aplicado_en_utc: { nullable: true }
    },
    indices: [
      { nombre: 'PRIMARY', unico: true, columnas: ['reinicio_id'] },
      {
        nombre: 'uk_reinicios_password_administrativos_evento',
        unico: true,
        columnas: ['evento_auditoria_id']
      },
      {
        nombre: 'idx_reinicios_password_administrativos_usuario',
        unico: false,
        columnas: ['usuario_id', 'aplicado_en_utc', 'reinicio_id']
      },
      {
        nombre: 'idx_reinicios_password_administrativos_salida',
        unico: false,
        columnas: ['salida_correo_id']
      }
    ],
    checks: [
      'chk_reinicios_password_administrativos_uuidv7',
      'chk_reinicios_password_administrativos_usuario',
      'chk_reinicios_password_administrativos_estado'
    ],
    foraneas: [{
      nombre: 'fk_reinicios_password_administrativos_salida',
      tablaReferenciada: 'cola_correos_salida',
      alBorrar: 'SET NULL',
      alActualizar: 'RESTRICT'
    }]
  }),
  '0238_ampliar_cola_reinicio_password_administrativo.sql': definir({
    tipo: 'alteracion_tabla',
    tabla: 'cola_correos_salida',
    columnas: {
      origen_tipo:
        "enum('prueba','trigger','recuperacion_password','reinicio_password_administrativo')",
      reinicio_password_administrativo_id: 'binary(16)'
    },
    atributosColumnas: {
      reinicio_password_administrativo_id: { nullable: true }
    },
    indices: [{
      nombre: 'uk_cola_correos_reinicio_password_administrativo',
      unico: true,
      columnas: ['reinicio_password_administrativo_id']
    }],
    checks: [
      'chk_cola_correos_origen',
      'chk_cola_correos_reinicio_password_identidad'
    ],
    triggersAdicionales: [
      {
        trigger: 'trg_cola_correos_guard_productor',
        tabla: 'cola_correos_salida',
        momento: 'BEFORE',
        evento: 'INSERT'
      },
      {
        trigger: 'trg_cola_correos_guard_mutacion',
        tabla: 'cola_correos_salida',
        momento: 'BEFORE',
        evento: 'UPDATE'
      }
    ],
    validacionesDatos: [{
      sql: `SELECT COUNT(*) AS incumplimientos
              FROM cola_correos_salida
             WHERE (origen_tipo='reinicio_password_administrativo')
                <> (reinicio_password_administrativo_id IS NOT NULL)`,
      mensaje: 'La identidad administrativa contaminó otra procedencia de correo.'
    }]
  }),
  '0249_ampliar_cola_verificacion_email_perfil.sql': definir({
    tipo: 'alteracion_tabla',
    tabla: 'cola_correos_salida',
    columnas: {
      origen_tipo:
        "enum('prueba','trigger','recuperacion_password','reinicio_password_administrativo','verificacion_email_perfil')",
      causa_descarte:
        "enum('autoridad_buzon_retirada','operacion_email_perfil_sustituida','operacion_email_perfil_consumida','operacion_email_perfil_expirada','identidad_email_perfil_no_vigente','identidad_email_perfil_distinta','credencial_email_perfil_cambiada','correo_origen_email_perfil_cambiado','proposito_email_perfil_agotado')",
      operacion_email_perfil_id: 'binary(16)',
      emision_email_perfil_id: 'binary(16)',
      clase_emision_email_perfil: "enum('inicial','reenvio')"
    },
    atributosColumnas: {
      operacion_email_perfil_id: { nullable: true },
      emision_email_perfil_id: { nullable: true },
      clase_emision_email_perfil: { nullable: true }
    },
    indices: [
      {
        nombre: 'uk_cola_correos_emision_email_perfil',
        unico: true,
        columnas: ['emision_email_perfil_id']
      },
      {
        nombre: 'idx_cola_correos_operacion_email_perfil',
        unico: false,
        columnas: [
          'operacion_email_perfil_id', 'clase_emision_email_perfil', 'id'
        ]
      }
    ],
    checks: [
      'chk_cola_correos_origen',
      'chk_cola_correos_email_perfil_identidad',
      'chk_cola_correos_recuperacion_preparacion',
      'chk_cola_correos_descarte',
      'chk_cola_correos_email_perfil_descarte'
    ],
    triggersAdicionales: [
      {
        trigger: 'trg_cola_correos_guard_productor',
        tabla: 'cola_correos_salida',
        momento: 'BEFORE',
        evento: 'INSERT'
      },
      {
        trigger: 'trg_cola_correos_guard_mutacion',
        tabla: 'cola_correos_salida',
        momento: 'BEFORE',
        evento: 'UPDATE'
      }
    ],
    validacionesDatos: [{
      sql: `SELECT COUNT(*) AS incumplimientos
              FROM cola_correos_salida
             WHERE (origen_tipo='verificacion_email_perfil')
                <> (operacion_email_perfil_id IS NOT NULL
                    AND emision_email_perfil_id IS NOT NULL
                    AND clase_emision_email_perfil IS NOT NULL)`,
      mensaje: 'La identidad de verificación de email contaminó otra procedencia.'
    }]
  }),
  '0239_crear_concesiones_intenciones_ddns_agentes.sql': definir({
    tabla: 'concesiones_ddns_agentes',
    collation: 'utf8mb4_bin',
    columnas: {
      id: 'bigint(20) unsigned',
      concesion_id: 'binary(16)',
      agente_id: 'bigint(20) unsigned',
      registro_dns_id: 'bigint(20) unsigned',
      version_ddns: 'bigint(20) unsigned',
      intencion_gobernante_id: 'bigint(20) unsigned',
      contenido_deseado_canonico: 'longtext',
      contenido_publicado_canonico: 'longtext',
      registro_dns_id_vigente: 'bigint(20) unsigned'
    },
    atributosColumnas: {
      concesion_id: { nullable: false },
      agente_id: { nullable: true },
      registro_dns_id: { nullable: true },
      version_ddns: { nullable: false, valorPorDefecto: '0' },
      registro_dns_id_vigente: { nullable: true, generada: 'STORED' }
    },
    indices: [
      { nombre: 'PRIMARY', unico: true, columnas: ['id'] },
      { nombre: 'uk_concesiones_ddns_id_publico', unico: true, columnas: ['concesion_id'] },
      { nombre: 'uk_concesiones_ddns_registro_vigente', unico: true, columnas: ['registro_dns_id_vigente'] },
      { nombre: 'idx_concesiones_ddns_agente_estado', unico: false, columnas: ['agente_id', 'estado', 'id'] },
      { nombre: 'idx_concesiones_ddns_registro_estado', unico: false, columnas: ['registro_dns_id', 'estado', 'id'] },
      { nombre: 'idx_concesiones_ddns_agente_fotografia', unico: false, columnas: ['agente_id_fotografia', 'creada_en_utc', 'id'] }
    ],
    checks: [
      'chk_concesiones_ddns_uuidv7', 'chk_concesiones_ddns_extremos',
      'chk_concesiones_ddns_fotografias', 'chk_concesiones_ddns_decision',
      'chk_concesiones_ddns_contenido_deseado',
      'chk_concesiones_ddns_contenido_publicado'
    ],
    foraneas: [
      { nombre: 'fk_concesiones_ddns_agente', tablaReferenciada: 'agentes_sentinelia', alBorrar: 'RESTRICT', alActualizar: 'RESTRICT' },
      { nombre: 'fk_concesiones_ddns_registro', tablaReferenciada: 'registros_dns', alBorrar: 'RESTRICT', alActualizar: 'RESTRICT' },
      { nombre: 'fk_concesiones_ddns_intencion_gobernante', tablaReferenciada: 'intenciones_ddns_agentes', alBorrar: 'RESTRICT', alActualizar: 'RESTRICT' }
    ],
    tablasAdicionales: [
      {
        tabla: 'intenciones_ddns_agentes',
        collation: 'utf8mb4_bin',
        columnas: {
          id: 'bigint(20) unsigned', intencion_id: 'binary(16)',
          concesion_interna_id: 'bigint(20) unsigned',
          agente_id_fotografia: 'bigint(20) unsigned',
          registro_dns_id_fotografia: 'bigint(20) unsigned',
          version_ddns: 'bigint(20) unsigned',
          estado_deseado_canonico: 'longtext',
          estado_deseado_sha256: 'binary(32)', causa_id: 'binary(16)'
        },
        indices: [
          { nombre: 'PRIMARY', unico: true, columnas: ['id'] },
          { nombre: 'uk_intenciones_ddns_id_publico', unico: true, columnas: ['intencion_id'] },
          { nombre: 'uk_intenciones_ddns_concesion_version', unico: true, columnas: ['concesion_interna_id', 'version_ddns'] },
          { nombre: 'idx_intenciones_ddns_objetivo', unico: false, columnas: ['registro_dns_id_fotografia', 'aceptada_en_utc', 'id'] }
        ],
        checks: [
          'chk_intenciones_ddns_uuidv7', 'chk_intenciones_ddns_identidad',
          'chk_intenciones_ddns_estado', 'chk_intenciones_ddns_causa'
        ],
        foraneas: [{ nombre: 'fk_intenciones_ddns_concesion', tablaReferenciada: 'concesiones_ddns_agentes', alBorrar: 'RESTRICT', alActualizar: 'RESTRICT' }]
      },
      {
        tabla: 'solicitudes_ddns_agentes',
        collation: 'utf8mb4_bin',
        columnas: {
          id: 'bigint(20) unsigned', solicitud_id: 'binary(16)',
          agente_id_fotografia: 'bigint(20) unsigned',
          concesion_interna_id: 'bigint(20) unsigned',
          cuerpo_canonico_sha256: 'binary(32)',
          intencion_interna_id: 'bigint(20) unsigned',
          estado_http: 'smallint(5) unsigned'
        },
        indices: [
          { nombre: 'PRIMARY', unico: true, columnas: ['id'] },
          { nombre: 'uk_solicitudes_ddns_agente_id', unico: true, columnas: ['agente_id_fotografia', 'solicitud_id'] },
          { nombre: 'idx_solicitudes_ddns_concesion', unico: false, columnas: ['concesion_interna_id', 'creada_en_utc', 'id'] },
          { nombre: 'idx_solicitudes_ddns_intencion', unico: false, columnas: ['intencion_interna_id'] }
        ],
        checks: ['chk_solicitudes_ddns_uuidv7', 'chk_solicitudes_ddns_resultado'],
        foraneas: [
          { nombre: 'fk_solicitudes_ddns_concesion', tablaReferenciada: 'concesiones_ddns_agentes', alBorrar: 'RESTRICT', alActualizar: 'RESTRICT' },
          { nombre: 'fk_solicitudes_ddns_intencion', tablaReferenciada: 'intenciones_ddns_agentes', alBorrar: 'RESTRICT', alActualizar: 'RESTRICT' }
        ]
      }
    ]
  }),
  '0240_crear_publicacion_y_causas_pol_ddns.sql': definir({
    tabla: 'intentos_publicacion_ddns',
    collation: 'utf8mb4_bin',
    columnas: {
      id: 'bigint(20) unsigned', concesion_interna_id: 'bigint(20) unsigned',
      intencion_interna_id: 'bigint(20) unsigned',
      version_ddns: 'bigint(20) unsigned',
      numero_intento: 'tinyint(3) unsigned',
      generacion_dns: 'bigint(20) unsigned',
      lease_token: 'binary(32)', fencing_token: 'bigint(20) unsigned'
    },
    indices: [
      { nombre: 'PRIMARY', unico: true, columnas: ['id'] },
      { nombre: 'uk_intentos_publicacion_ddns_version', unico: true, columnas: ['concesion_interna_id', 'version_ddns', 'numero_intento'] },
      { nombre: 'idx_intentos_publicacion_ddns_reclamacion', unico: false, columnas: ['estado', 'disponible_en_utc', 'creada_en_utc', 'id'] },
      { nombre: 'idx_intentos_publicacion_ddns_lease', unico: false, columnas: ['estado', 'lease_expira_utc', 'id'] },
      { nombre: 'idx_intentos_publicacion_ddns_intencion', unico: false, columnas: ['intencion_interna_id', 'id'] }
    ],
    checks: [
      'chk_intentos_publicacion_ddns_numero',
      'chk_intentos_publicacion_ddns_diagnostico',
      'chk_intentos_publicacion_ddns_lease',
      'chk_intentos_publicacion_ddns_terminal'
    ],
    foraneas: [
      { nombre: 'fk_intentos_publicacion_ddns_concesion', tablaReferenciada: 'concesiones_ddns_agentes', alBorrar: 'RESTRICT', alActualizar: 'RESTRICT' },
      { nombre: 'fk_intentos_publicacion_ddns_intencion', tablaReferenciada: 'intenciones_ddns_agentes', alBorrar: 'RESTRICT', alActualizar: 'RESTRICT' }
    ],
    tablasAdicionales: [{
      tabla: 'causas_pol_ddns',
      collation: 'utf8mb4_bin',
      columnas: {
        causa_id: 'binary(16)', agente_id_fotografia: 'bigint(20) unsigned',
        periodo_vida_pol_id: 'bigint(20) unsigned',
        secuencia: 'bigint(20) unsigned', direccion_remota: 'varchar(45)',
        lease_token: 'binary(32)', fencing_token: 'bigint(20) unsigned',
        intentos: 'int(10) unsigned'
      },
      indices: [
        { nombre: 'PRIMARY', unico: true, columnas: ['causa_id'] },
        { nombre: 'uk_causas_pol_ddns_periodo_secuencia', unico: true, columnas: ['periodo_vida_pol_id', 'secuencia'] },
        { nombre: 'idx_causas_pol_ddns_reclamacion', unico: false, columnas: ['estado', 'disponible_en_utc', 'aceptada_en_utc', 'causa_id'] },
        { nombre: 'idx_causas_pol_ddns_lease', unico: false, columnas: ['estado', 'lease_expira_utc', 'causa_id'] },
        { nombre: 'idx_causas_pol_ddns_agente', unico: false, columnas: ['agente_id_fotografia', 'aceptada_en_utc', 'causa_id'] }
      ],
      checks: [
        'chk_causas_pol_ddns_uuidv7', 'chk_causas_pol_ddns_identidad',
        'chk_causas_pol_ddns_diagnostico', 'chk_causas_pol_ddns_lease',
        'chk_causas_pol_ddns_terminal'
      ]
    }]
  }),
  '0243_coordinar_reintentos_publicacion_ddns.sql': definir({
    tipo: 'alteracion_tabla',
    tabla: 'operaciones_publicacion_dns',
    columnas: {
      causa: "enum('mutacion_catalogo','reconciliacion_inicial','reintento_reconciliacion','divergencia_proyeccion_recuperacion','reactivacion_manual','reintento_ddns')"
    },
    indices: [],
    checks: ['chk_operaciones_dns_causalidad'],
    triggersAdicionales: [{
      trigger: 'trg_operaciones_dns_validar_insert',
      tabla: 'operaciones_publicacion_dns',
      momento: 'BEFORE',
      evento: 'INSERT'
    }]
  }),
  '0244_permitir_causa_pol_ddns_sin_direccion.sql': definir({
    tipo: 'alteracion_tabla',
    tabla: 'causas_pol_ddns',
    columnas: {
      direccion_remota: 'varchar(45)',
      familia_direccion: "enum('ipv4','ipv6')"
    },
    atributosColumnas: {
      direccion_remota: { nullable: true },
      familia_direccion: { nullable: true }
    },
    indices: [],
    checks: ['chk_causas_pol_ddns_identidad']
  }),
  '0247_ordenar_catalogos_auditoria_ddns.sql': definir({
    tipo: 'alteracion_tabla',
    tabla: 'eventos_auditoria',
    columnas: {
      sujeto_tipo: "enum('usuario','sesion_usuario','agente','sesion_agente','regla_telemetria','monitor','alerta','trigger','destinatario_trigger_correo','binding_trigger','zona_dns','registro_dns','tenant','empresa','sitio','configuracion_portal','cadena_auditoria','incidente_integridad','instalacion_federada','relacion_federada','revision_concesion_federada','flujo_federado','lote_federado','proyeccion_federada','aviso_plataforma','frontera_internet','concesion_ddns','intencion_ddns')",
      causalidad_tipo: "enum('evento_auditoria','evento_monitor','ejecucion_trigger','operacion_sesion_agente','generacion_dns','relacion_federacion','ocurrencia_federacion','entrega_federacion','aviso_plataforma','solicitud_recuperacion_password','intencion_ddns')"
    },
    indices: [],
    tablasAdicionales: [{
      tabla: 'outbox_auditoria_runtime',
      columnas: {
        sujeto_tipo: "enum('usuario','sesion_usuario','agente','sesion_agente','regla_telemetria','monitor','alerta','trigger','destinatario_trigger_correo','binding_trigger','zona_dns','registro_dns','tenant','empresa','sitio','configuracion_portal','cadena_auditoria','incidente_integridad','instalacion_federada','relacion_federada','revision_concesion_federada','flujo_federado','lote_federado','proyeccion_federada','aviso_plataforma','frontera_internet','concesion_ddns','intencion_ddns')",
        causalidad_tipo: "enum('evento_auditoria','evento_monitor','ejecucion_trigger','operacion_sesion_agente','generacion_dns','relacion_federacion','ocurrencia_federacion','entrega_federacion','aviso_plataforma','solicitud_recuperacion_password','intencion_ddns')"
      },
      indices: []
    }]
  }),
  '0248_permitir_retencion_historico_ddns.sql': definir({
    tipo: 'alteracion_tabla',
    tabla: 'concesiones_ddns_agentes',
    columnas: {},
    indices: [],
    checks: ['chk_concesiones_ddns_decision']
  }),
  '0231_preparar_quietud_cola_correo.sql': definir({
    tipo: 'alteracion_tabla',
    tabla: 'estado_despliegue_trigger_correo',
    columnas: {
      quietud_iniciada_en_utc: 'datetime(3)',
      quietud_observada_en_utc: 'datetime(3)'
    },
    atributosColumnas: {
      quietud_iniciada_en_utc: { nullable: true },
      quietud_observada_en_utc: { nullable: true }
    },
    indices: [],
    checks: ['chk_estado_despliegue_correo_quietud'],
    triggersAdicionales: [
      {
        trigger: 'trg_cola_correos_guard_productor',
        tabla: 'cola_correos_salida',
        momento: 'BEFORE',
        evento: 'INSERT'
      },
      {
        trigger: 'trg_cola_correos_guard_mutacion',
        tabla: 'cola_correos_salida',
        momento: 'BEFORE',
        evento: 'UPDATE'
      }
    ]
  }),
  '0229_incorporar_destinatario_correo_auditoria.sql': definir({
    tipo: 'alteracion_tabla',
    tabla: 'eventos_auditoria',
    columnas: {
      sujeto_tipo: "enum('usuario','sesion_usuario','agente','sesion_agente','regla_telemetria','monitor','alerta','trigger','destinatario_trigger_correo','binding_trigger','zona_dns','registro_dns','tenant','empresa','sitio','configuracion_portal','cadena_auditoria','incidente_integridad','instalacion_federada','relacion_federada','revision_concesion_federada','flujo_federado','lote_federado','proyeccion_federada','aviso_plataforma')"
    },
    indices: [],
    tablasAdicionales: [{
      tabla: 'outbox_auditoria_runtime',
      columnas: {
        sujeto_tipo: "enum('usuario','sesion_usuario','agente','sesion_agente','regla_telemetria','monitor','alerta','trigger','destinatario_trigger_correo','binding_trigger','zona_dns','registro_dns','tenant','empresa','sitio','configuracion_portal','cadena_auditoria','incidente_integridad','instalacion_federada','relacion_federada','revision_concesion_federada','flujo_federado','lote_federado','proyeccion_federada','aviso_plataforma')"
      }
    }]
  }),
  '0230_indexar_retencion_trigger_correo.sql': definir({
    tipo: 'alteracion_tabla',
    tabla: 'ejecuciones_triggers',
    columnas: {},
    indices: [{
      nombre: 'idx_ejecuciones_trigger_retencion_correo',
      unico: false,
      columnas: [
        'tipo_trigger', 'estado_ejecucion', 'finalizado_en_utc', 'id'
      ]
    }],
    tablasAdicionales: [{
      tabla: 'cola_correos_salida',
      columnas: {},
      indices: [{
        nombre: 'idx_cola_correos_retencion',
        unico: false,
        columnas: [
          'origen_tipo', 'estado', 'fecha_terminal_utc',
          'ejecucion_trigger_id', 'id'
        ]
      }]
    }]
  })
});

export class VerificadorPostcondicionesMigraciones {
  tienePostcondicion(nombreArchivo) {
    return Object.hasOwn(POSTCONDICIONES_MIGRACIONES, nombreArchivo);
  }

  async verificar(migracion, conexion) {
    const definicion = POSTCONDICIONES_MIGRACIONES[migracion.nombreArchivo];
    if (!definicion) return { verificada: false, omitida: true };

    if (definicion.tipo === 'trigger') {
      const [[trigger]] = await conexion.query(
        `
          SELECT
            TRIGGER_NAME AS nombre,
            EVENT_OBJECT_TABLE AS tabla,
            ACTION_TIMING AS momento,
            EVENT_MANIPULATION AS evento
          FROM information_schema.TRIGGERS
          WHERE TRIGGER_SCHEMA = DATABASE() AND TRIGGER_NAME = ?
        `,
        [definicion.trigger]
      );
      exigir(trigger, `Falta el trigger ${definicion.trigger}.`);
      exigir(
        trigger.tabla === definicion.tabla &&
          trigger.momento === definicion.momento &&
          trigger.evento === definicion.evento,
        `${definicion.trigger} no conserva su frontera append-only.`
      );
      return { verificada: true, omitida: false, trigger: definicion.trigger };
    }

    const tablasAdmitidas = Array.isArray(definicion.tabla)
      ? definicion.tabla
      : [definicion.tabla];
    const [tablas] = await conexion.query(
      `
        SELECT TABLE_NAME AS nombre, ENGINE AS motor,
               TABLE_COLLATION AS collation
        FROM information_schema.TABLES
        WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME IN (?)
      `,
      [tablasAdmitidas]
    );
    const tablasCompatibles = tablasAdmitidas
      .map((nombre) => tablas.find((actual) => actual.nombre === nombre))
      .filter((actual) => actual?.motor === 'InnoDB');
    exigir(
      tablasCompatibles.length === 1,
      `${describirAlternativas(tablasAdmitidas)} debe resolver una sola tabla InnoDB.`
    );
    const [tabla] = tablasCompatibles;
    const nombreTabla = tabla.nombre;
    if (definicion.collation) {
      exigir(
        tabla.collation === definicion.collation,
        `${nombreTabla} no conserva la collation ${definicion.collation}.`
      );
    }

    const [filasColumnas] = await conexion.query(
      `
        SELECT
          COLUMN_NAME AS nombre,
          COLUMN_TYPE AS tipo,
          IS_NULLABLE AS nullable,
          COLUMN_DEFAULT AS valor_por_defecto,
          EXTRA AS extra, GENERATION_EXPRESSION AS expresion_generacion
        FROM information_schema.COLUMNS
        WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?
      `,
      [nombreTabla]
    );
    const columnas = new Map(filasColumnas.map((fila) => [fila.nombre, String(fila.tipo).toLowerCase()]));
    for (const [nombre, tipo] of Object.entries(definicion.columnas)) {
      exigir(
        coincideTipoColumna(columnas.get(nombre), tipo),
        `${nombreTabla}.${nombre} no cumple el tipo ${describirTipo(tipo)}.`
      );
    }
    const detallesColumnas = new Map(
      filasColumnas.map((fila) => [fila.nombre, fila])
    );
    for (const [nombre, atributos] of Object.entries(definicion.atributosColumnas)) {
      const actual = detallesColumnas.get(nombre);
      exigir(actual, `Falta la columna ${nombreTabla}.${nombre}.`);
      if (Object.hasOwn(atributos, 'nullable')) {
        exigir(
          (actual.nullable === 'YES') === atributos.nullable,
          `${nombreTabla}.${nombre} no conserva su nulabilidad.`
        );
      }
      if (Object.hasOwn(atributos, 'valorPorDefecto')) {
        exigir(
          coincideValorPorDefecto(actual.valor_por_defecto, atributos.valorPorDefecto),
          `${nombreTabla}.${nombre} no conserva DEFAULT ${atributos.valorPorDefecto}.`
        );
      }
      if (Object.hasOwn(atributos, 'generada')) {
        exigir(
          String(actual.extra || '').toUpperCase().includes(atributos.generada) &&
            String(actual.expresion_generacion || '').trim().length > 0,
          `${nombreTabla}.${nombre} no conserva su expresión generada ${atributos.generada}.`
        );
      }
    }

    for (const adicional of definicion.tablasAdicionales) {
      const [filasAdicionales] = await conexion.query(
        `
          SELECT COLUMN_NAME AS nombre, COLUMN_TYPE AS tipo,
                 IS_NULLABLE AS nullable,
                 COLUMN_DEFAULT AS valor_por_defecto,
                 COLLATION_NAME AS collation,
                 EXTRA AS extra, GENERATION_EXPRESSION AS expresion_generacion
          FROM information_schema.COLUMNS
          WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?
        `,
        [adicional.tabla]
      );
      const columnasAdicionales = new Map(
        filasAdicionales.map((fila) => [
          fila.nombre,
          String(fila.tipo).toLowerCase()
        ])
      );
      for (const [nombre, tipo] of Object.entries(adicional.columnas)) {
        exigir(
          coincideTipoColumna(columnasAdicionales.get(nombre), tipo),
          `${adicional.tabla}.${nombre} no cumple el tipo ${describirTipo(tipo)}.`
        );
      }

      const detallesColumnasAdicionales = new Map(
        filasAdicionales.map((fila) => [fila.nombre, fila])
      );
      for (const [nombre, atributos] of Object.entries(
        adicional.atributosColumnas
      )) {
        const actual = detallesColumnasAdicionales.get(nombre);
        exigir(actual, `Falta la columna ${adicional.tabla}.${nombre}.`);
        if (Object.hasOwn(atributos, 'nullable')) {
          exigir(
            (actual.nullable === 'YES') === atributos.nullable,
            `${adicional.tabla}.${nombre} no conserva su nulabilidad.`
          );
        }
        if (Object.hasOwn(atributos, 'valorPorDefecto')) {
          exigir(
            coincideValorPorDefecto(actual.valor_por_defecto, atributos.valorPorDefecto),
            `${adicional.tabla}.${nombre} no conserva DEFAULT ${atributos.valorPorDefecto}.`
          );
        }
        if (Object.hasOwn(atributos, 'collation')) {
          exigir(
            actual.collation === atributos.collation,
            `${adicional.tabla}.${nombre} no conserva la collation ${atributos.collation}.`
          );
        }
        if (Object.hasOwn(atributos, 'generada')) {
          exigir(
            String(actual.extra || '').toUpperCase().includes(atributos.generada) &&
              String(actual.expresion_generacion || '').trim().length > 0,
            `${adicional.tabla}.${nombre} no conserva su expresión generada ${atributos.generada}.`
          );
        }
      }

      if (
        adicional.indices.length === 0 &&
        adicional.checks.length === 0 &&
        adicional.foraneas.length === 0
      ) continue;

      const [[tablaAdicional]] = await conexion.query(
        `
          SELECT ENGINE AS motor, TABLE_COLLATION AS collation
          FROM information_schema.TABLES
          WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?
        `,
        [adicional.tabla]
      );
      exigir(
        tablaAdicional?.motor === 'InnoDB',
        `${adicional.tabla} no existe con motor InnoDB.`
      );
      if (adicional.collation) {
        exigir(
          tablaAdicional.collation === adicional.collation,
          `${adicional.tabla} no conserva la collation ${adicional.collation}.`
        );
      }

      const [filasIndicesAdicionales] = await conexion.query(
        `
          SELECT INDEX_NAME AS nombre, NON_UNIQUE AS no_unico,
                 COLUMN_NAME AS columna, SEQ_IN_INDEX AS posicion
          FROM information_schema.STATISTICS
          WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?
          ORDER BY INDEX_NAME, SEQ_IN_INDEX
        `,
        [adicional.tabla]
      );
      const indicesAdicionales = agruparIndices(filasIndicesAdicionales);
      for (const esperado of adicional.indices) {
        const actual = indicesAdicionales.get(esperado.nombre);
        exigir(actual, `Falta el índice ${esperado.nombre} en ${adicional.tabla}.`);
        exigir(actual.unico === esperado.unico, `${esperado.nombre} no conserva su unicidad.`);
        const ordenesAdmitidos = [
          esperado.columnas,
          ...(esperado.columnasAlternativas || [])
        ];
        exigir(
          ordenesAdmitidos.some((columnas) =>
            JSON.stringify(actual.columnas) === JSON.stringify(columnas)
          ),
          `${esperado.nombre} no conserva un orden de columnas admitido.`
        );
      }

      const [filasChecksAdicionales] = await conexion.query(
        `
          SELECT CONSTRAINT_NAME AS nombre
          FROM information_schema.TABLE_CONSTRAINTS
          WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?
            AND CONSTRAINT_TYPE = 'CHECK'
        `,
        [adicional.tabla]
      );
      const checksAdicionales = new Set(
        filasChecksAdicionales.map((fila) => fila.nombre)
      );
      for (const nombre of adicional.checks) {
        exigir(
          checksAdicionales.has(nombre),
          `Falta la restricción ${nombre} en ${adicional.tabla}.`
        );
      }

      const [filasForaneasAdicionales] = await conexion.query(
        `
          SELECT rc.CONSTRAINT_NAME AS nombre,
                 rc.REFERENCED_TABLE_NAME AS tabla_referenciada,
                 rc.DELETE_RULE AS al_borrar,
                 rc.UPDATE_RULE AS al_actualizar
          FROM information_schema.REFERENTIAL_CONSTRAINTS rc
          WHERE rc.CONSTRAINT_SCHEMA = DATABASE() AND rc.TABLE_NAME = ?
        `,
        [adicional.tabla]
      );
      const foraneasAdicionales = new Map(
        filasForaneasAdicionales.map((fila) => [fila.nombre, fila])
      );
      for (const esperada of adicional.foraneas) {
        const actual = foraneasAdicionales.get(esperada.nombre);
        exigir(actual, `Falta la FK ${esperada.nombre} en ${adicional.tabla}.`);
        exigir(
          actual.tabla_referenciada === esperada.tablaReferenciada,
          `${esperada.nombre} referencia otra tabla.`
        );
        exigir(
          actual.al_borrar === esperada.alBorrar &&
            actual.al_actualizar === esperada.alActualizar,
          `${esperada.nombre} admite una cascada destructiva.`
        );
      }
    }

    const [filasIndices] = await conexion.query(
      `
        SELECT INDEX_NAME AS nombre, NON_UNIQUE AS no_unico, COLUMN_NAME AS columna, SEQ_IN_INDEX AS posicion
        FROM information_schema.STATISTICS
        WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?
        ORDER BY INDEX_NAME, SEQ_IN_INDEX
      `,
      [nombreTabla]
    );
    const indices = agruparIndices(filasIndices);
    for (const esperado of definicion.indices) {
      const actual = indices.get(esperado.nombre);
      exigir(actual, `Falta el índice ${esperado.nombre} en ${nombreTabla}.`);
      exigir(actual.unico === esperado.unico, `${esperado.nombre} no conserva su unicidad.`);
      const ordenesAdmitidos = [
        esperado.columnas,
        ...(esperado.columnasAlternativas || [])
      ];
      exigir(
        ordenesAdmitidos.some((columnas) =>
          JSON.stringify(actual.columnas) === JSON.stringify(columnas)
        ),
        `${esperado.nombre} no conserva un orden de columnas admitido.`
      );
    }

    const [filasChecks] = await conexion.query(
      `
        SELECT CONSTRAINT_NAME AS nombre
        FROM information_schema.TABLE_CONSTRAINTS
        WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND CONSTRAINT_TYPE = 'CHECK'
      `,
      [nombreTabla]
    );
    const checks = new Set(filasChecks.map((fila) => fila.nombre));
    for (const nombre of definicion.checks) {
      exigir(checks.has(nombre), `Falta la restricción ${nombre} en ${nombreTabla}.`);
    }

    const [filasForaneas] = await conexion.query(
      `
        SELECT
          rc.CONSTRAINT_NAME AS nombre,
          rc.REFERENCED_TABLE_NAME AS tabla_referenciada,
          rc.DELETE_RULE AS al_borrar,
          rc.UPDATE_RULE AS al_actualizar
        FROM information_schema.REFERENTIAL_CONSTRAINTS rc
        WHERE rc.CONSTRAINT_SCHEMA = DATABASE() AND rc.TABLE_NAME = ?
      `,
      [nombreTabla]
    );
    const foraneas = new Map(filasForaneas.map((fila) => [fila.nombre, fila]));
    for (const esperada of definicion.foraneas) {
      const actual = foraneas.get(esperada.nombre);
      exigir(actual, `Falta la FK ${esperada.nombre} en ${nombreTabla}.`);
      exigir(actual.tabla_referenciada === esperada.tablaReferenciada, `${esperada.nombre} referencia otra tabla.`);
      exigir(actual.al_borrar === esperada.alBorrar && actual.al_actualizar === esperada.alActualizar, `${esperada.nombre} admite una cascada destructiva.`);
    }

    for (const esperado of definicion.triggersAdicionales) {
      const triggersAdmitidos = Array.isArray(esperado.trigger)
        ? esperado.trigger
        : [esperado.trigger];
      const tablasTriggerAdmitidas = Array.isArray(esperado.tabla)
        ? esperado.tabla
        : [esperado.tabla];
      const [triggers] = await conexion.query(
        `
          SELECT TRIGGER_NAME AS nombre, EVENT_OBJECT_TABLE AS tabla,
                 ACTION_TIMING AS momento,
                 EVENT_MANIPULATION AS evento
          FROM information_schema.TRIGGERS
          WHERE TRIGGER_SCHEMA = DATABASE() AND TRIGGER_NAME IN (?)
        `,
        [triggersAdmitidos]
      );
      const trigger = triggersAdmitidos
        .map((nombre) => triggers.find((actual) => actual.nombre === nombre))
        .filter(Boolean);
      exigir(
        trigger.length === 1,
        `Falta o está duplicado el trigger ${describirAlternativas(triggersAdmitidos)}.`
      );
      const [triggerEfectivo] = trigger;
      exigir(
        tablasTriggerAdmitidas.includes(triggerEfectivo.tabla) &&
          triggerEfectivo.momento === esperado.momento &&
          triggerEfectivo.evento === esperado.evento,
        `${triggerEfectivo.nombre} no conserva la protección esperada.`
      );
    }

    for (const validacion of definicion.validacionesDatos) {
      const [[resultado]] = await conexion.query(validacion.sql);
      exigir(
        Number(resultado?.incumplimientos) === 0,
        validacion.mensaje
      );
    }

    return { verificada: true, omitida: false, tabla: nombreTabla };
  }
}

function agruparIndices(filas) {
  const indices = new Map();
  for (const fila of filas) {
    if (!indices.has(fila.nombre)) {
      indices.set(fila.nombre, { unico: Number(fila.no_unico) === 0, columnas: [] });
    }
    indices.get(fila.nombre).columnas.push(fila.columna);
  }
  return indices;
}

function coincideTipoColumna(actual, esperado) {
  return Array.isArray(esperado)
    ? esperado.some((alternativa) => coincideTipoColumna(actual, alternativa))
    : actual === esperado || enumConservaValores(actual, esperado);
}

function enumConservaValores(actual, esperado) {
  const valoresActuales = extraerValoresEnum(actual);
  const valoresEsperados = extraerValoresEnum(esperado);
  if (!valoresActuales || !valoresEsperados) return false;
  let posicion = -1;
  return valoresEsperados.every((valor) => {
    posicion = valoresActuales.indexOf(valor, posicion + 1);
    return posicion !== -1;
  });
}

function extraerValoresEnum(tipo) {
  const coincidencia = /^enum\((.*)\)$/.exec(String(tipo || ''));
  if (!coincidencia) return null;
  return [...coincidencia[1].matchAll(/'((?:''|[^'])*)'(?:,|$)/g)]
    .map((resultado) => resultado[1].replaceAll("''", "'"));
}

function coincideValorPorDefecto(actual, esperado) {
  const literal = String(actual);
  return literal === esperado ||
    (literal.startsWith("'") && literal.endsWith("'") &&
      literal.slice(1, -1).replaceAll("''", "'") === esperado);
}

function describirTipo(esperado) {
  return Array.isArray(esperado) ? esperado.join(' o ') : esperado;
}

function describirAlternativas(valores) {
  return valores.join(' o ');
}

function exigir(condicion, mensaje) {
  if (!condicion) throw new Error(`Postcondición DDL incumplida: ${mensaje}`);
}

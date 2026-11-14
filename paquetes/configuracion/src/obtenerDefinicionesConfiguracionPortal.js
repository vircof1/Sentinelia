function booleanoComoTexto(valor) {
  return valor ? 'true' : 'false';
}

function listaComoTexto(valores) {
  return Array.isArray(valores) ? valores.join('\n') : String(valores || '');
}

export function obtenerDefinicionesConfiguracionPortal(configuracionEntorno) {
  return [
    {
      clave: 'portal.nombre_visible',
      tipoDato: 'texto',
      valorPorDefecto: configuracionEntorno.portal.nombreVisible,
      descripcion: 'Nombre visible principal del portal en cabecera, login y navegación.',
      requerido: true,
      participaAdmisionCorreo: true
    },
    {
      clave: 'portal.origen_publico',
      tipoDato: 'url',
      valorPorDefecto: configuracionEntorno.portal.origenPublico || '',
      descripcion: 'Origen público HTTPS canónico común para enlaces emitidos por el portal.',
      requerido: false,
      participaAdmisionCorreo: true,
      visibleEnListado: false,
      editable: false
    },
    {
      clave: 'federacion.activacion',
      tipoDato: 'booleano',
      valorPorDefecto: booleanoComoTexto(
        configuracionEntorno.federacion.activacionFederacion
      ),
      descripcion: 'Activa el plano federado únicamente cuando su configuración transversal es válida.',
      requerido: true
    },
    {
      clave: 'federacion.origen_publico',
      tipoDato: 'url',
      valorPorDefecto: configuracionEntorno.federacion.origenPublico || '',
      descripcion: 'Origen público HTTPS canónico; nunca se deriva de Host ni de cabeceras no confiables.',
      requerido: false
    },
    {
      clave: 'federacion.proxies_confiables',
      tipoDato: 'texto',
      tipoEntrada: 'textarea',
      valorPorDefecto: listaComoTexto(
        configuracionEntorno.federacion.proxiesConfiables
      ),
      descripcion: 'Direcciones o rangos de reverse proxies confiables, uno por línea o separados por comas.',
      requerido: false
    },
    ...definicionesEnterasFederacion(configuracionEntorno.federacion),
    {
      clave: 'federacion.keyring_referencia_despliegue',
      tipoDato: 'texto',
      valorPorDefecto:
        configuracionEntorno.federacion.keyringReferenciaDespliegue,
      descripcion: 'Referencia opaca al keyring del despliegue; nunca contiene material secreto.',
      requerido: true,
      editable: false
    },
    {
      clave: 'usuarios.password_longitud_minima',
      tipoDato: 'entero',
      valorPorDefecto: 8,
      minimo: 1,
      maximo: 72,
      descripcion:
        'Número mínimo de caracteres exigido a las contraseñas humanas del portal. Debe estar entre 1 y 72; bcrypt aplica además un máximo de 72 bytes UTF-8.',
      requerido: true
    },
    ...definicionesRecuperacionPasswordEmail(),
    {
      clave: 'dns.activo',
      tipoDato: 'booleano',
      valorPorDefecto: booleanoComoTexto(configuracionEntorno.dns.activo),
      descripcion: 'Activa el subsistema DNS gestionado por el portal.',
      requerido: true
    },
    {
      clave: 'dns.listen_on',
      tipoDato: 'texto',
      tipoEntrada: 'textarea',
      valorPorDefecto: configuracionEntorno.dns.listenOn,
      descripcion: 'Lista de direcciones IPv4 o tokens BIND para listen-on. Acepta comas o saltos de línea.',
      requerido: true
    },
    {
      clave: 'dns.listen_on_v6',
      tipoDato: 'texto',
      tipoEntrada: 'textarea',
      valorPorDefecto: configuracionEntorno.dns.listenOnV6,
      descripcion: 'Lista de direcciones IPv6 o tokens BIND para listen-on-v6. Acepta comas o saltos de línea.',
      requerido: true
    },
    {
      clave: 'dns.allow_query',
      tipoDato: 'texto',
      tipoEntrada: 'textarea',
      valorPorDefecto: configuracionEntorno.dns.allowQuery,
      descripcion: 'ACL global para allow-query. Acepta tokens, redes o direcciones separadas por comas o saltos de línea.',
      requerido: true
    },
    {
      clave: 'dns.recursion',
      tipoDato: 'booleano',
      valorPorDefecto: booleanoComoTexto(configuracionEntorno.dns.recursion),
      descripcion: 'Activa o desactiva recursion a nivel global del servidor DNS.',
      requerido: true
    },
    {
      clave: 'dns.forwarders_habilitados',
      tipoDato: 'booleano',
      valorPorDefecto: booleanoComoTexto(
        configuracionEntorno.dns.forwardersHabilitados
      ),
      descripcion: 'Activa el bloque global de forwarders del servidor DNS.',
      requerido: true
    },
    {
      clave: 'dns.forwarders',
      tipoDato: 'texto',
      tipoEntrada: 'textarea',
      valorPorDefecto: configuracionEntorno.dns.forwarders,
      descripcion: 'Lista global de forwarders DNS. Acepta IPs separadas por comas o saltos de línea.',
      requerido: false
    },
    {
      clave: 'monitores.compactacion_cerca_fallo_porcentaje',
      tipoDato: 'entero',
      valorPorDefecto:
        configuracionEntorno.monitores.compactacionCercaFalloPorcentaje,
      descripcion:
        'Porcentaje de margen cercano al fallo a partir del cual se evita compactar automáticamente un tramo histórico.',
      requerido: true
    },
    {
      clave: 'auditoria.retencion_dias',
      tipoDato: 'entero_nulable',
      valorPorDefecto: null,
      minimo: 1,
      maximo: 36500,
      descripcion:
        'Días de conservación uniforme de todas las series auditables. Vacío conserva indefinidamente; esta fase solo configura la política.',
      requerido: false
    },
    {
      clave: 'monitores.compactacion_serie_variacion_porcentaje',
      tipoDato: 'entero',
      valorPorDefecto:
        configuracionEntorno.monitores.compactacionSerieVariacionPorcentaje,
      descripcion:
        'Porcentaje de variación relativo sobre la métrica técnica a partir del cual una serie temporal compactada debe abrir un nuevo punto persistido.',
      requerido: true
    },
    {
      clave: 'monitores.retencion_eventos_dias',
      tipoDato: 'entero',
      valorPorDefecto: configuracionEntorno.monitores.retencionEventosDias,
      descripcion:
        'Número de días que el runtime conservará en SQL para eventos_monitores e historico_monitores antes de purgarlos automáticamente. Con 0 se desactiva la purga.',
      requerido: true
    },
    {
      clave: 'monitores.runtime_bloqueo_ttl_segundos',
      tipoDato: 'entero',
      valorPorDefecto: configuracionEntorno.monitores.runtimeBloqueoTtlSegundos,
      descripcion:
        'TTL en segundos del bloqueo Redis que evita ejecuciones concurrentes duplicadas del mismo monitor entre varias instancias runtime.',
      requerido: true
    },
    {
      clave: 'agentes.session_ttl_segundos',
      tipoDato: 'entero',
      valorPorDefecto: configuracionEntorno.agentes.sessionTtlSegundos,
      descripcion:
        'TTL en segundos de la sesión efímera Redis emitida a un agente Sentinelia.',
      requerido: true
    },
    {
      clave: 'agentes.heartbeat_interval_segundos',
      tipoDato: 'entero',
      valorPorDefecto: configuracionEntorno.agentes.heartbeatIntervalSegundos,
      descripcion:
        'Intervalo recomendado, en segundos, entre heartbeats POL enviados por un agente Sentinelia.',
      requerido: true
    },
    {
      clave: 'agentes.heartbeat_grace_segundos',
      tipoDato: 'entero',
      valorPorDefecto: configuracionEntorno.agentes.heartbeatGraceSegundos,
      descripcion:
        'Margen de silencio, en segundos, antes de considerar silencioso a un agente sin heartbeat reciente.',
      requerido: true
    },
    {
      clave: 'agentes.login_fallos_maximos',
      tipoDato: 'entero',
      valorPorDefecto: configuracionEntorno.agentes.loginFallosMaximos,
      descripcion:
        'Número de fallos de login técnico permitidos antes de activar cuarentena automática del agente.',
      requerido: true
    },
    {
      clave: 'agentes.cuarentena_segundos',
      tipoDato: 'entero',
      valorPorDefecto: configuracionEntorno.agentes.cuarentenaSegundos,
      descripcion:
        'Duración en segundos de la cuarentena automática aplicada tras fallos repetidos de login técnico.',
      requerido: true
    },
    {
      clave: 'correo.activo',
      tipoDato: 'booleano',
      valorPorDefecto: booleanoComoTexto(configuracionEntorno.correo.activo),
      descripcion: 'Activa el subsistema de correo del portal.',
      requerido: true,
      participaAdmisionCorreo: true,
      invalidaPruebaSmtp: true
    },
    {
      clave: 'correo.operativo_verificado',
      tipoDato: 'booleano',
      valorPorDefecto: 'false',
      descripcion:
        'Indica si la configuración de correo vigente superó una prueba empírica de envío.',
      requerido: true,
      visibleEnListado: false
    },
    {
      clave: 'correo.smtp_host',
      tipoDato: 'host',
      valorPorDefecto: configuracionEntorno.correo.smtpHost,
      descripcion: 'Host SMTP principal para envíos salientes.',
      requerido: false,
      participaAdmisionCorreo: true,
      invalidaPruebaSmtp: true
    },
    {
      clave: 'correo.smtp_puerto',
      tipoDato: 'puerto',
      valorPorDefecto: configuracionEntorno.correo.smtpPuerto,
      descripcion: 'Puerto del servidor SMTP.',
      requerido: true,
      participaAdmisionCorreo: true,
      invalidaPruebaSmtp: true
    },
    {
      clave: 'correo.smtp_secure',
      tipoDato: 'booleano',
      valorPorDefecto: booleanoComoTexto(configuracionEntorno.correo.smtpSecure),
      descripcion: 'Activa conexión SMTPS directa al abrir el socket.',
      requerido: true,
      participaAdmisionCorreo: true,
      invalidaPruebaSmtp: true
    },
    {
      clave: 'correo.smtp_usuario',
      tipoDato: 'texto',
      valorPorDefecto: configuracionEntorno.correo.smtpUsuario,
      descripcion: 'Usuario de autenticación SMTP.',
      requerido: false,
      participaAdmisionCorreo: true,
      invalidaPruebaSmtp: true
    },
    {
      clave: 'correo.smtp_password',
      tipoDato: 'password',
      valorPorDefecto: configuracionEntorno.correo.smtpPassword,
      descripcion: 'Secreto de autenticación SMTP.',
      requerido: false,
      participaAdmisionCorreo: true,
      invalidaPruebaSmtp: true
    },
    {
      clave: 'correo.smtp_auth_method',
      tipoDato: 'texto',
      valorPorDefecto: configuracionEntorno.correo.smtpAuthMethod,
      descripcion: 'Método preferido de autenticación SMTP, por ejemplo LOGIN o PLAIN.',
      requerido: false,
      participaAdmisionCorreo: true,
      invalidaPruebaSmtp: true,
      tipoEntrada: 'select',
      opciones: [
        { valor: '', etiqueta: 'auto' },
        { valor: 'LOGIN', etiqueta: 'LOGIN' },
        { valor: 'PLAIN', etiqueta: 'PLAIN' },
        { valor: 'CRAM-MD5', etiqueta: 'CRAM-MD5' },
        { valor: 'XOAUTH2', etiqueta: 'XOAUTH2' }
      ]
    },
    {
      clave: 'correo.smtp_timeout_conexion_ms',
      tipoDato: 'entero',
      valorPorDefecto: configuracionEntorno.correo.smtpTimeoutConexionMs,
      descripcion: 'Timeout máximo de apertura de conexión SMTP en milisegundos.',
      requerido: true,
      participaAdmisionCorreo: true,
      invalidaPruebaSmtp: true
    },
    {
      clave: 'correo.smtp_timeout_saludo_ms',
      tipoDato: 'entero',
      valorPorDefecto: configuracionEntorno.correo.smtpTimeoutSaludoMs,
      descripcion: 'Timeout máximo de saludo SMTP en milisegundos.',
      requerido: true,
      participaAdmisionCorreo: true,
      invalidaPruebaSmtp: true
    },
    {
      clave: 'correo.smtp_timeout_socket_ms',
      tipoDato: 'entero',
      valorPorDefecto: configuracionEntorno.correo.smtpTimeoutSocketMs,
      descripcion: 'Timeout máximo de inactividad del socket SMTP en milisegundos.',
      requerido: true,
      participaAdmisionCorreo: true,
      invalidaPruebaSmtp: true
    },
    {
      clave: 'correo.smtp_tls_permitir_inseguro',
      tipoDato: 'booleano',
      valorPorDefecto: booleanoComoTexto(
        configuracionEntorno.correo.smtpTlsPermitirInseguro
      ),
      descripcion: 'Permite certificados TLS no verificables en entornos controlados.',
      requerido: true,
      participaAdmisionCorreo: true,
      invalidaPruebaSmtp: true
    },
    {
      clave: 'correo.remitente_email',
      tipoDato: 'email',
      valorPorDefecto: configuracionEntorno.correo.remitenteEmail,
      descripcion: 'Dirección remitente por defecto para correos del portal.',
      requerido: false,
      participaAdmisionCorreo: true,
      invalidaPruebaSmtp: true
    },
    {
      clave: 'correo.remitente_nombre',
      tipoDato: 'texto',
      valorPorDefecto: configuracionEntorno.correo.remitenteNombre,
      descripcion: 'Nombre remitente por defecto para correos del portal.',
      requerido: true,
      participaAdmisionCorreo: true,
      invalidaPruebaSmtp: true
    },
    {
      clave: 'correo.max_reintentos',
      tipoDato: 'entero',
      valorPorDefecto: configuracionEntorno.correo.maxReintentos,
      descripcion: 'Número de reintentos automáticos permitidos tras un fallo transitorio.',
      requerido: true,
      participaAdmisionCorreo: true
    },
    {
      clave: 'correo.reintento_base_segundos',
      tipoDato: 'entero',
      valorPorDefecto: configuracionEntorno.correo.reintentoBaseSegundos,
      descripcion: 'Base en segundos para calcular el siguiente intento de envío.',
      requerido: true,
      participaAdmisionCorreo: true
    },
    {
      clave: 'correo.bloqueo_ttl_segundos',
      tipoDato: 'entero',
      valorPorDefecto: configuracionEntorno.correo.bloqueoTtlSegundos,
      descripcion: 'Duración del bloqueo efímero Redis usado al reclamar correos pendientes.',
      requerido: true
    },
    {
      clave: 'correo.runtime_lote_maximo',
      tipoDato: 'entero',
      valorPorDefecto: configuracionEntorno.correo.runtimeLoteMaximo,
      descripcion: 'Número máximo de correos que el runtime intentará despachar por ciclo.',
      requerido: true
    },
    {
      clave: 'correo.desuscripcion_ttl_dias',
      tipoDato: 'entero',
      valorPorDefecto: 30,
      minimo: 1,
      maximo: 3650,
      descripcion: 'Vigencia en días de la capacidad de desuscripción fotografiada al aceptar una entrega.',
      requerido: true,
      participaAdmisionCorreo: true
    },
    {
      clave: 'correo.destinatarios_trigger_maximos',
      tipoDato: 'entero',
      valorPorDefecto: 100,
      minimo: 1,
      maximo: 1000,
      descripcion: 'Máximo de relaciones destinatarias, incluidas restringidas y desuscritas, por trigger de correo.',
      requerido: true
    },
    {
      clave: 'correo.retencion_salidas_dias',
      tipoDato: 'entero',
      valorPorDefecto: 90,
      minimo: 1,
      maximo: 3650,
      descripcion: 'Retención especializada de salidas de correo terminales, sin alcanzar backlog ni capacidades vigentes.',
      requerido: true
    },
    {
      clave: 'pow.activo',
      tipoDato: 'booleano',
      valorPorDefecto: booleanoComoTexto(configuracionEntorno.pow.activo),
      descripcion: 'Activa o desactiva la prueba de trabajo previa al login.',
      requerido: true
    },
    {
      clave: 'pow.redis_prefijo',
      tipoDato: 'texto',
      valorPorDefecto: configuracionEntorno.pow.redisPrefijo,
      descripcion: 'Prefijo Redis usado por el módulo PoW.',
      requerido: true
    },
    {
      clave: 'pow.ttl_desafio_segundos',
      tipoDato: 'entero',
      valorPorDefecto: configuracionEntorno.pow.ttlDesafioSegundos,
      descripcion: 'Vida máxima de un desafío PoW emitido.',
      requerido: true
    },
    {
      clave: 'pow.tiempo_objetivo_ms',
      tipoDato: 'entero',
      valorPorDefecto: configuracionEntorno.pow.tiempoObjetivoMs,
      descripcion: 'Tiempo objetivo base para calcular el coste del PoW.',
      requerido: true
    },
    {
      clave: 'pow.tiempo_minimo_ms',
      tipoDato: 'entero',
      valorPorDefecto: configuracionEntorno.pow.tiempoMinimoMs,
      descripcion: 'Tiempo mínimo permitido para el PoW.',
      requerido: true
    },
    {
      clave: 'pow.tiempo_maximo_ms',
      tipoDato: 'entero',
      valorPorDefecto: configuracionEntorno.pow.tiempoMaximoMs,
      descripcion: 'Tiempo máximo permitido para el PoW.',
      requerido: true
    },
    {
      clave: 'pow.ventana_intentos_segundos',
      tipoDato: 'entero',
      valorPorDefecto: configuracionEntorno.pow.ventanaIntentosSegundos,
      descripcion: 'Ventana de observación por IP para intentos recientes.',
      requerido: true
    },
    {
      clave: 'pow.incremento_por_intento_ms',
      tipoDato: 'entero',
      valorPorDefecto: configuracionEntorno.pow.incrementoPorIntentoMs,
      descripcion: 'Aumento del tiempo objetivo por cada desafío emitido.',
      requerido: true
    },
    {
      clave: 'pow.incremento_por_fallo_ms',
      tipoDato: 'entero',
      valorPorDefecto: configuracionEntorno.pow.incrementoPorFalloMs,
      descripcion: 'Aumento adicional del tiempo objetivo por cada fallo observado.',
      requerido: true
    },
    {
      clave: 'pow.coste_minimo',
      tipoDato: 'entero',
      valorPorDefecto: configuracionEntorno.pow.costeMinimo,
      descripcion: 'Coste mínimo permitido para el PoW.',
      requerido: true
    },
    {
      clave: 'pow.coste_maximo',
      tipoDato: 'entero',
      valorPorDefecto: configuracionEntorno.pow.costeMaximo,
      descripcion: 'Coste máximo permitido para el PoW.',
      requerido: true
    },
    {
      clave: 'pow.hashrate_por_defecto',
      tipoDato: 'entero',
      valorPorDefecto: configuracionEntorno.pow.hashratePorDefecto,
      descripcion: 'Hashrate de referencia usado cuando no hay observación previa.',
      requerido: true
    },
    {
      clave: 'pow.hashrate_minimo',
      tipoDato: 'entero',
      valorPorDefecto: configuracionEntorno.pow.hashrateMinimo,
      descripcion: 'Hashrate mínimo aceptado para normalización.',
      requerido: true
    },
    {
      clave: 'pow.hashrate_maximo',
      tipoDato: 'entero',
      valorPorDefecto: configuracionEntorno.pow.hashrateMaximo,
      descripcion: 'Hashrate máximo aceptado para normalización.',
      requerido: true
    },
    {
      clave: 'pow.benchmark_cliente_ms',
      tipoDato: 'entero',
      valorPorDefecto: configuracionEntorno.pow.benchmarkClienteMs,
      descripcion: 'Duración del benchmark local usado por el cliente antes de pedir desafío.',
      requerido: true
    }
  ];
}

function definicionesEnterasFederacion(configuracion) {
  return [
    ['federacion.tolerancia_temporal_ms', configuracion.toleranciaTemporalMs, 0, 300000, 'Tolerancia máxima de desfase horario al iniciar una relación federada.'],
    ['federacion.lote_maximo_ocurrencias', configuracion.loteMaximoOcurrencias, 1, 5000, 'Máximo dinámico de ocurrencias aceptadas por lote.'],
    ['federacion.lote_maximo_bytes', configuracion.loteMaximoBytes, 1024, 16777216, 'Máximo dinámico de bytes canónicos aceptados por lote.'],
    ['federacion.ocurrencia_maxima_bytes', configuracion.ocurrenciaMaximaBytes, 512, 2097152, 'Máximo dinámico de bytes canónicos por ocurrencia.'],
    ['federacion.capacidad_receptora_ocurrencias', configuracion.capacidadReceptoraOcurrencias, 0, 100000, 'Capacidad temporal declarada por el receptor.'],
    ['federacion.ttl_estado_operativo_ms', configuracion.ttlEstadoOperativoMs, 1000, 86400000, 'Vigencia máxima por defecto del estado operativo remoto.'],
    ['federacion.silencio_relacion_ms', configuracion.silencioRelacionMs, 5000, 86400000, 'Margen sin actividad autenticada antes de declarar silenciosa una relación federada.'],
    ['federacion.consolidacion_reinicio_ms', configuracion.consolidacionReinicioMs, 0, 3600000, 'Margen de consolidación de estados remotos después de reiniciar.'],
    ['federacion.retencion_maxima_dias', configuracion.retencionMaximaDias, 1, 3650, 'Límite global máximo de retención de datos federados.']
  ].map(([clave, valorPorDefecto, minimo, maximo, descripcion]) => ({
    clave,
    tipoDato: 'entero',
    valorPorDefecto,
    minimo,
    maximo,
    descripcion,
    requerido: true
  }));
}

function definicionesRecuperacionPasswordEmail() {
  const enteras = [
    ['usuarios.recuperacion_email_vigencia_segundos', 1200, 300, 86400,
      'Vigencia absoluta fotografiada al emitir una solicitud de recuperación.'],
    ['usuarios.recuperacion_email_alegaciones_maximas', 5, 1, 20,
      'Nombres distintos que puede alegar una solicitud de recuperación.'],
    ['usuarios.recuperacion_email_origen_ventana_segundos', 900, 60, 86400,
      'Ventana deslizante de presión por origen de red.'],
    ['usuarios.recuperacion_email_origen_intentos_maximos', 10, 1, 1000,
      'Intentos iniciales máximos por origen dentro de su ventana.'],
    ['usuarios.recuperacion_email_par_ventana_segundos', 1200, 60, 86400,
      'Ventana deslizante de presión por pareja confidencial de buzón y origen.'],
    ['usuarios.recuperacion_email_par_intentos_maximos', 3, 1, 100,
      'Intentos iniciales máximos de una pareja buzón-origen.'],
    ['usuarios.recuperacion_email_global_ventana_segundos', 60, 1, 3600,
      'Ventana deslizante de protección global de la instancia.'],
    ['usuarios.recuperacion_email_global_intentos_maximos', 120, 1, 100000,
      'Intentos iniciales máximos de toda la instancia dentro de su ventana.'],
    ['usuarios.recuperacion_email_jitter_maximo_ms', 100, 0, 2000,
      'Variación temporal máxima de las respuestas públicas protegidas.'],
    ['usuarios.recuperacion_email_lease_preparacion_segundos', 60, 10, 600,
      'Duración fotografiada de una exclusión de preparación de emisión.'],
    ['usuarios.recuperacion_email_lease_alegacion_segundos', 30, 5, 300,
      'Duración fotografiada de una exclusión de alegación.'],
    ['usuarios.recuperacion_email_lease_consumo_segundos', 90, 10, 600,
      'Duración fotografiada de una exclusión de consumo y convergencia.']
  ].map(([clave, valorPorDefecto, minimo, maximo, descripcion]) => ({
    clave,
    tipoDato: 'entero',
    valorPorDefecto,
    minimo,
    maximo,
    descripcion,
    requerido: true
  }));
  return [{
    clave: 'usuarios.recuperacion_email_activa',
    tipoDato: 'booleano',
    valorPorDefecto: 'false',
    descripcion:
      'Permite emitir nuevas solicitudes de recuperación cuando todos sus prerrequisitos estén disponibles.',
    requerido: true
  }, ...enteras];
}

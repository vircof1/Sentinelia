import path from 'node:path';
import { fileURLToPath } from 'node:url';
import os from 'node:os';
import dotenv from 'dotenv';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const RUTA_RAIZ_NODEJS = path.resolve(__dirname, '../../../..');
const RUTA_ENTORNO_POR_DEFECTO = path.join(RUTA_RAIZ_NODEJS, '.env');

let entornoCargado = false;

function cargarEntorno() {
  if (entornoCargado) {
    return;
  }

  dotenv.config({ path: process.env.RUTA_ENTORNO || RUTA_ENTORNO_POR_DEFECTO });
  entornoCargado = true;
}

function obtenerBooleano(nombre, valorPorDefecto = false) {
  const valor = process.env[nombre];

  if (valor === undefined) {
    return valorPorDefecto;
  }

  return ['1', 'true', 'si', 'yes', 'on'].includes(valor.toLowerCase());
}

function obtenerEntero(nombre, valorPorDefecto) {
  const valor = process.env[nombre];

  if (valor === undefined || valor === '') {
    return valorPorDefecto;
  }

  const convertido = Number.parseInt(valor, 10);

  if (Number.isNaN(convertido)) {
    throw new Error(`La variable ${nombre} debe ser un entero valido.`);
  }

  return convertido;
}

function obtenerTexto(nombre, valorPorDefecto = '') {
  const valor = process.env[nombre];
  return valor === undefined ? valorPorDefecto : valor;
}

function obtenerListaTexto(nombre, valorPorDefecto = '') {
  return obtenerTexto(nombre, valorPorDefecto)
    .split(/[\n,]+/u)
    .map((valor) => valor.trim())
    .filter(Boolean);
}

export function obtenerConfiguracionAplicacion() {
  cargarEntorno();

  const sql = {
    host: process.env.SQL_HOST || '',
    puerto: obtenerEntero('SQL_PUERTO', 3306),
    usuario: process.env.SQL_USUARIO || '',
    password: process.env.SQL_PASSWORD || '',
    baseDatos: process.env.SQL_BASE_DATOS || '',
    bootstrapMigraciones: obtenerBooleano('SQL_BOOTSTRAP_MIGRACIONES', false)
  };

  sql.estaCompleta = Boolean(
    sql.host && sql.usuario && sql.baseDatos
  );

  return {
    entorno: process.env.NODE_ENV || 'development',
    web: {
      puerto: obtenerEntero('PUERTO_WEB', 3000)
    },
    runtime: {
      instanciaId: obtenerTexto(
        'RUNTIME_INSTANCIA_ID',
        `${os.hostname()}:pid-${process.pid}`
      ).trim() || `${os.hostname()}:pid-${process.pid}`,
      apagadoTimeoutMs: obtenerEntero('RUNTIME_APAGADO_TIMEOUT_MS', 10000),
      schedulerTickMs: obtenerEntero('RUNTIME_SCHEDULER_TICK_MS', 1000),
      redisPrefijo: obtenerTexto(
        'RUNTIME_REDIS_PREFIJO',
        'sentinelia:runtime:'
      ),
      latidoIntervaloMs: obtenerEntero('RUNTIME_LATIDO_INTERVALO_MS', 5000),
      presenciaTtlSegundos: obtenerEntero('RUNTIME_PRESENCIA_TTL_SEGUNDOS', 15),
      telemetriaEvaluacionLoteMaximo: obtenerEntero(
        'RUNTIME_TELEMETRIA_EVALUACION_LOTE_MAXIMO',
        25
      ),
      perfilServidorLoteMaximo: obtenerEntero(
        'RUNTIME_PERFIL_SERVIDOR_LOTE_MAXIMO',
        50
      ),
      telemetriaEvaluacionReclamoTtlSegundos: obtenerEntero(
        'RUNTIME_TELEMETRIA_EVALUACION_RECLAMO_TTL_SEGUNDOS',
        30
      ),
      telemetriaEvaluacionReintentoBaseSegundos: obtenerEntero(
        'RUNTIME_TELEMETRIA_EVALUACION_REINTENTO_BASE_SEGUNDOS',
        5
      ),
      telemetriaEvaluacionReintentoMaximoSegundos: obtenerEntero(
        'RUNTIME_TELEMETRIA_EVALUACION_REINTENTO_MAXIMO_SEGUNDOS',
        300
      ),
      telemetriaRelojLoteMaximo: obtenerEntero(
        'RUNTIME_TELEMETRIA_RELOJ_LOTE_MAXIMO',
        100
      ),
      telemetriaRelojMaximoLotesPorCiclo: obtenerEntero(
        'RUNTIME_TELEMETRIA_RELOJ_MAXIMO_LOTES_POR_CICLO',
        4
      ),
      telemetriaRelativaRetrasoAvisoSegundos: obtenerEntero(
        'RUNTIME_TELEMETRIA_RELATIVA_RETRASO_AVISO_SEGUNDOS',
        60
      ),
      auditoriaOutboxConcurrencia: obtenerEntero(
        'RUNTIME_AUDITORIA_OUTBOX_CONCURRENCIA',
        8
      ),
      auditoriaOutboxLeaseTtlSegundos: obtenerEntero(
        'RUNTIME_AUDITORIA_OUTBOX_LEASE_TTL_SEGUNDOS',
        30
      ),
      auditoriaOutboxReintentoBaseSegundos: obtenerEntero(
        'RUNTIME_AUDITORIA_OUTBOX_REINTENTO_BASE_SEGUNDOS',
        5
      ),
      auditoriaOutboxReintentoMaximoSegundos: obtenerEntero(
        'RUNTIME_AUDITORIA_OUTBOX_REINTENTO_MAXIMO_SEGUNDOS',
        3600
      )
    },
    sql,
    redis: {
      url: obtenerTexto('REDIS_URL', 'redis://127.0.0.1:6379'),
      prefijoSesiones: obtenerTexto(
        'REDIS_PREFIJO_SESIONES',
        'sentinelia:sesion:'
      ),
      prefijoPreautenticaciones: obtenerTexto(
        'REDIS_PREFIJO_PREAUTENTICACIONES',
        'sentinelia:preautenticacion:'
      ),
      prefijoSesionesWebDurables: obtenerTexto(
        'REDIS_PREFIJO_SESIONES_WEB_DURABLES',
        'sentinelia:sesiones:web:'
      ),
      canalInvalidacionesSesionesWeb: obtenerTexto(
        'REDIS_CANAL_INVALIDACIONES_SESIONES_WEB',
        'sentinelia:sesiones:web:invalidaciones'
      ),
      prefijoSesionesAgentes: obtenerTexto(
        'REDIS_PREFIJO_SESIONES_AGENTES',
        'sentinelia:agentes:sesiones:'
      ),
      prefijoVersionUsuario: obtenerTexto(
        'REDIS_PREFIJO_VERSION_USUARIO',
        'sentinelia:usuario:'
      ),
      claveVersionConfiguracionPortal: obtenerTexto(
        'REDIS_CLAVE_VERSION_CONFIGURACION_PORTAL',
        'sentinelia:configuracion_portal:version'
      ),
      claveVersionRuntimeMonitores: obtenerTexto(
        'REDIS_CLAVE_VERSION_RUNTIME_MONITORES',
        'sentinelia:runtime:monitores:version'
      ),
      claveVersionCatalogoMonitores: obtenerTexto(
        'REDIS_CLAVE_VERSION_CATALOGO_MONITORES',
        'sentinelia:catalogo:monitores:version'
      ),
      claveVersionDns: obtenerTexto(
        'REDIS_CLAVE_VERSION_DNS',
        'sentinelia:catalogo:dns:version'
      ),
      prefijoBloqueoCorreo: obtenerTexto(
        'REDIS_PREFIJO_BLOQUEO_CORREO',
        'sentinelia:correo:bloqueo:'
      ),
      prefijoVerificacionCorreoOperativo: obtenerTexto(
        'REDIS_PREFIJO_VERIFICACION_CORREO_OPERATIVO',
        'sentinelia:correo:verificacion_operativa:'
      ),
      prefijoAutorizacionPerfil: obtenerTexto(
        'REDIS_PREFIJO_AUTORIZACION_PERFIL',
        'sentinelia:perfil:autorizacion:'
      ),
      prefijoOperacionesEmailPerfil: obtenerTexto(
        'REDIS_PREFIJO_OPERACIONES_EMAIL_PERFIL',
        'sentinelia:perfil:email:'
      ),
      prefijoFederacion: obtenerTexto(
        'REDIS_PREFIJO_FEDERACION',
        'sentinelia:federacion'
      ),
      ttlArranqueFederacionSegundos: obtenerEntero(
        'REDIS_TTL_ARRANQUE_FEDERACION_SEGUNDOS',
        120
      )
    },
    sesion: {
      nombreCookie: obtenerTexto('SESION_COOKIE_NOMBRE', 'sentinelia.sid'),
      secreto: obtenerTexto(
        'SESION_SECRETO',
        'sentinelia-desarrollo-cambiar-antes-de-produccion'
      ),
      maxAgeMs: obtenerEntero('SESION_MAX_AGE_MS', 8 * 60 * 60 * 1000)
    },
    usuarioInicial: {
      usuario: obtenerTexto('USUARIO_ADMIN_INICIAL', ''),
      password: obtenerTexto('PASSWORD_ADMIN_INICIAL', ''),
      email: obtenerTexto('EMAIL_ADMIN_INICIAL', ''),
      nombreMostrar: obtenerTexto('NOMBRE_ADMIN_INICIAL', 'Administrador')
    },
    portal: {
      nombreVisible: obtenerTexto('PORTAL_NOMBRE_VISIBLE', 'Sentinelia'),
      origenPublico: obtenerTexto('PORTAL_ORIGEN_PUBLICO', '').trim() || null
    },
    federacion: {
      activacionFederacion: obtenerBooleano('FEDERACION_ACTIVA', false),
      origenPublico: obtenerTexto('PORTAL_ORIGEN_PUBLICO', '').trim() || null,
      proxiesConfiables: obtenerListaTexto(
        'PORTAL_PROXIES_REVERSOS_CONFIABLES',
        ''
      ),
      toleranciaTemporalMs: obtenerEntero(
        'FEDERACION_TOLERANCIA_TEMPORAL_MS',
        5000
      ),
      loteMaximoOcurrencias: obtenerEntero(
        'FEDERACION_LOTE_MAXIMO_OCURRENCIAS',
        200
      ),
      loteMaximoBytes: obtenerEntero(
        'FEDERACION_LOTE_MAXIMO_BYTES',
        1024 * 1024
      ),
      ocurrenciaMaximaBytes: obtenerEntero(
        'FEDERACION_OCURRENCIA_MAXIMA_BYTES',
        256 * 1024
      ),
      capacidadReceptoraOcurrencias: obtenerEntero(
        'FEDERACION_CAPACIDAD_RECEPTORA_OCURRENCIAS',
        1000
      ),
      ttlEstadoOperativoMs: obtenerEntero(
        'FEDERACION_TTL_ESTADO_OPERATIVO_MS',
        900000
      ),
      silencioRelacionMs: obtenerEntero(
        'FEDERACION_SILENCIO_RELACION_MS',
        120000
      ),
      consolidacionReinicioMs: obtenerEntero(
        'FEDERACION_CONSOLIDACION_REINICIO_MS',
        60000
      ),
      retencionMaximaDias: obtenerEntero(
        'FEDERACION_RETENCION_MAXIMA_DIAS',
        90
      ),
      keyringReferenciaDespliegue: obtenerTexto(
        'FEDERACION_KEYRING_REFERENCIA',
        'sentinelia/federacion/v1'
      )
    },
    dns: {
      activo: obtenerBooleano('DNS_ACTIVO', false),
      rutaIncludeGestionado: obtenerTexto(
        'DNS_RUTA_INCLUDE_GESTIONADO',
        '/etc/bind/sentinelia.named.conf'
      ),
      directorioZonas: obtenerTexto(
        'DNS_DIRECTORIO_ZONAS',
        '/etc/bind/sentinelia-zonas'
      ),
      comandoRecarga: obtenerTexto(
        'DNS_COMANDO_RECARGA',
        'rndc reload'
      ),
      comandoCheckconf: obtenerTexto(
        'DNS_COMANDO_CHECKCONF',
        'named-checkconf'
      ),
      comandoCheckzone: obtenerTexto(
        'DNS_COMANDO_CHECKZONE',
        'named-checkzone'
      ),
      listenOn: obtenerTexto('DNS_LISTEN_ON', '127.0.0.1'),
      listenOnV6: obtenerTexto('DNS_LISTEN_ON_V6', '::1'),
      allowQuery: obtenerTexto('DNS_ALLOW_QUERY', 'any'),
      recursion: obtenerBooleano('DNS_RECURSION', false),
      forwardersHabilitados: obtenerBooleano(
        'DNS_FORWARDERS_HABILITADOS',
        false
      ),
      forwarders: obtenerTexto('DNS_FORWARDERS', '')
    },
    monitores: {
      compactacionCercaFalloPorcentaje: obtenerEntero(
        'MONITORES_COMPACTACION_CERCA_FALLO_PORCENTAJE',
        10
      ),
      compactacionSerieVariacionPorcentaje: obtenerEntero(
        'MONITORES_COMPACTACION_SERIE_VARIACION_PORCENTAJE',
        10
      ),
      retencionEventosDias: obtenerEntero(
        'MONITORES_RETENCION_EVENTOS_DIAS',
        45
      ),
      runtimeBloqueoTtlSegundos: obtenerEntero(
        'MONITORES_RUNTIME_BLOQUEO_TTL_SEGUNDOS',
        30
      )
    },
    organizacion: {
      eliminacionAdministrativaEsperaCompatibilidadMs: obtenerEntero(
        'ORGANIZACION_ELIMINACION_ADMINISTRATIVA_ESPERA_COMPATIBILIDAD_MS',
        60000
      )
    },
    agentes: {
      ddnsHabilitado: obtenerBooleano('AGENTES_DDNS_HABILITADO', false),
      eliminacionAdministrativaHttpHabilitada: obtenerBooleano(
        'AGENTES_ELIMINACION_ADMINISTRATIVA_HTTP_HABILITADA',
        false
      ),
      eliminacionAdministrativaEsperaCompatibilidadMs: obtenerEntero(
        'AGENTES_ELIMINACION_ADMINISTRATIVA_ESPERA_COMPATIBILIDAD_MS',
        60000
      ),
      perfilServidorHabilitado: obtenerBooleano(
        'AGENTES_PERFIL_SERVIDOR_HABILITADO',
        true
      ),
      sessionTtlSegundos: obtenerEntero('AGENTES_SESSION_TTL_SEGUNDOS', 900),
      heartbeatIntervalSegundos: obtenerEntero(
        'AGENTES_HEARTBEAT_INTERVAL_SEGUNDOS',
        30
      ),
      heartbeatGraceSegundos: obtenerEntero(
        'AGENTES_HEARTBEAT_GRACE_SEGUNDOS',
        90
      ),
      loginFallosMaximos: obtenerEntero('AGENTES_LOGIN_FALLOS_MAXIMOS', 5),
      cuarentenaSegundos: obtenerEntero('AGENTES_CUARENTENA_SEGUNDOS', 900)
    },
    correo: {
      activo: obtenerBooleano('CORREO_ACTIVO', false),
      smtpHost: obtenerTexto('CORREO_SMTP_HOST', ''),
      smtpPuerto: obtenerEntero('CORREO_SMTP_PUERTO', 587),
      smtpSecure: obtenerBooleano('CORREO_SMTP_SECURE', false),
      smtpUsuario: obtenerTexto('CORREO_SMTP_USUARIO', ''),
      smtpPassword: obtenerTexto('CORREO_SMTP_PASSWORD', ''),
      smtpAuthMethod: obtenerTexto('CORREO_SMTP_AUTH_METHOD', ''),
      smtpTimeoutConexionMs: obtenerEntero(
        'CORREO_SMTP_TIMEOUT_CONEXION_MS',
        10000
      ),
      smtpTimeoutSaludoMs: obtenerEntero(
        'CORREO_SMTP_TIMEOUT_SALUDO_MS',
        10000
      ),
      smtpTimeoutSocketMs: obtenerEntero(
        'CORREO_SMTP_TIMEOUT_SOCKET_MS',
        30000
      ),
      smtpTlsPermitirInseguro: obtenerBooleano(
        'CORREO_SMTP_TLS_PERMITIR_INSEGURO',
        false
      ),
      remitenteEmail: obtenerTexto('CORREO_REMITENTE_EMAIL', ''),
      remitenteNombre: obtenerTexto(
        'CORREO_REMITENTE_NOMBRE',
        obtenerTexto('PORTAL_NOMBRE_VISIBLE', 'Sentinelia')
      ),
      maxReintentos: obtenerEntero('CORREO_MAX_REINTENTOS', 3),
      reintentoBaseSegundos: obtenerEntero(
        'CORREO_REINTENTO_BASE_SEGUNDOS',
        60
      ),
      bloqueoTtlSegundos: obtenerEntero('CORREO_BLOQUEO_TTL_SEGUNDOS', 90),
      runtimeLoteMaximo: obtenerEntero('CORREO_RUNTIME_LOTE_MAXIMO', 3)
    },
    pow: {
      activo: obtenerBooleano('POW_ACTIVO', true),
      redisPrefijo: obtenerTexto('POW_REDIS_PREFIJO', 'sentinelia:pow:'),
      ttlDesafioSegundos: obtenerEntero('POW_TTL_DESAFIO_SEGUNDOS', 300),
      tiempoObjetivoMs: obtenerEntero('POW_TIEMPO_OBJETIVO_MS', 1500),
      tiempoMinimoMs: obtenerEntero('POW_TIEMPO_MINIMO_MS', 750),
      tiempoMaximoMs: obtenerEntero('POW_TIEMPO_MAXIMO_MS', 8000),
      ventanaIntentosSegundos: obtenerEntero(
        'POW_VENTANA_INTENTOS_SEGUNDOS',
        900
      ),
      incrementoPorIntentoMs: obtenerEntero(
        'POW_INCREMENTO_POR_INTENTO_MS',
        250
      ),
      incrementoPorFalloMs: obtenerEntero(
        'POW_INCREMENTO_POR_FALLO_MS',
        700
      ),
      costeMinimo: obtenerEntero(
        'POW_COSTE_MINIMO',
        obtenerEntero('POW_DIFICULTAD_MIN_BITS', 16)
      ),
      costeMaximo: obtenerEntero(
        'POW_COSTE_MAXIMO',
        obtenerEntero('POW_DIFICULTAD_MAX_BITS', 24)
      ),
      hashratePorDefecto: obtenerEntero('POW_HASHRATE_POR_DEFECTO', 60000),
      hashrateMinimo: obtenerEntero('POW_HASHRATE_MINIMO', 25000),
      hashrateMaximo: obtenerEntero('POW_HASHRATE_MAXIMO', 1500000),
      benchmarkClienteMs: obtenerEntero('POW_BENCHMARK_CLIENTE_MS', 180)
    }
  };
}

export function obtenerRutaRaizNodejs() {
  cargarEntorno();
  return RUTA_RAIZ_NODEJS;
}

export function obtenerRutaMigraciones() {
  cargarEntorno();

  if (process.env.RUTA_MIGRACIONES) {
    return path.resolve(RUTA_RAIZ_NODEJS, process.env.RUTA_MIGRACIONES);
  }

  return path.join(RUTA_RAIZ_NODEJS, 'migraciones', 'sql');
}

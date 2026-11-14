import { isDeepStrictEqual } from 'node:util';
import { isIP } from 'node:net';
import { exigirBuzonCanonicoCorreo } from '../../correo/src/NormalizadorBuzonCorreo.js';
import {
  ENUMS_CERRADOS_POR_TIPO,
  FLUJOS_AUDITORIA,
  PERFILES_PAYLOAD_AUDITORIA,
  TRANSICIONES_ESTADO_POR_TIPO,
  construirClaveCadenaAuditoria,
  esClaveCadenaAuditoria,
  obtenerDefinicionTipoEventoAuditoria,
  resolverFlujoEventoAuditoria
} from './CatalogoAuditoria.js';
import {
  serializarPayloadAuditoriaV1,
  validarFechaUtcMilisegundos
} from './PerfilJcsAuditoria.js';

const MAX_BIGINT_UNSIGNED = 18446744073709551615n;
const PATRON_CODIGO = /^[a-z][a-z0-9_]{0,63}$/;
const PATRON_UUID_V7 = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const PATRON_HASH_SHA256 = /^[0-9a-f]{64}$/;
const PATRON_ID_DECIMAL_POSITIVO = /^[1-9][0-9]*$/;
const PATRON_CLAVE_DATO = /^[A-Za-z][A-Za-z0-9_.]{0,127}$/;
const MATERIAL_IDENTIDAD_FEDERADA = '[A-Za-z0-9_-]{21}[AQgw]';
const PATRON_ID_FEDERADA = new RegExp(
  `^sfid1\\.(instalacion|relacion|revision_concesion|flujo|generacion|lote|proyeccion)\\.${MATERIAL_IDENTIDAD_FEDERADA}$`
);
const PATRON_CODIGO_FEDERACION = /^[a-z][a-z0-9_]{0,63}$/;
const CATEGORIAS_IMPACTO_ELIMINACION_AGENTE = Object.freeze([
  'agente',
  'asignaciones_trigger',
  'causas_pol_ddns_pendientes',
  'concesiones_ddns',
  'correo_aceptado_preservadas',
  'ejecuciones_trigger',
  'estados_actuales',
  'eventos',
  'identidades_federadas',
  'intenciones_ddns_aceptadas',
  'monitores',
  'obligaciones_postcommit',
  'observaciones',
  'perfil_servidor',
  'pol',
  'referencias_compartidas',
  'reglas',
  'senales',
  'sesiones_tecnicas'
]);
const CATEGORIAS_IMPACTO_ELIMINACION_ORGANIZACION = Object.freeze([
  'agentes',
  'audiencia_correo_restringida',
  'audiencia_correo_visible',
  'causas_pol_ddns_pendientes',
  'concesiones_ddns',
  'correo_aceptado_preservadas',
  'ejecuciones_trigger',
  'empresas',
  'eventos',
  'identidades_federadas',
  'intenciones_ddns_aceptadas',
  'monitores',
  'obligaciones_postcommit',
  'observaciones',
  'pol',
  'raiz',
  'referencias_restrict',
  'reglas',
  'senales',
  'sesiones',
  'sitios',
  'triggers_correo_supervivientes_desactivados',
  'usuarios'
]);
const CATEGORIAS_HISTORICAS_ELIMINACION_ORGANIZACION = new Set([
  'correo_aceptado_preservadas', 'ejecuciones_trigger', 'eventos',
  'observaciones', 'pol', 'senales'
]);

export const CLASES_SCOPE_V1 = Object.freeze([
  'empresas',
  'sitios',
  'usuarios',
  'agentes',
  'reglas_telemetria',
  'monitores',
  'vinculos_monitores_telemetria',
  'alertas_activas',
  'estados_evaluacion_telemetria',
  'trabajos_evaluacion_telemetria',
  'eventos_monitores',
  'series_eventos_monitores',
  'historico_monitores',
  'eventos_derivados_telemetria',
  'triggers',
  'ejecuciones_triggers',
  'zonas_dns',
  'registros_dns'
]);

export const CLASES_SCOPE_POR_DIMENSION = Object.freeze({
  filasVivasActualizadasPorClase: Object.freeze([
    'empresas',
    'sitios',
    'usuarios',
    'agentes',
    'reglas_telemetria',
    'monitores',
    'vinculos_monitores_telemetria',
    'alertas_activas',
    'estados_evaluacion_telemetria',
    'trabajos_evaluacion_telemetria',
    'triggers',
    'zonas_dns',
    'registros_dns'
  ]),
  referenciasHistoricasActualizadasPorClase: Object.freeze([
    'eventos_monitores',
    'series_eventos_monitores',
    'historico_monitores',
    'eventos_derivados_telemetria',
    'ejecuciones_triggers'
  ]),
  descendientesPorClase: Object.freeze([
    'sitios',
    'usuarios',
    'agentes',
    'reglas_telemetria',
    'monitores',
    'alertas_activas',
    'triggers',
    'zonas_dns',
    'registros_dns'
  ])
});

const CAMPOS_DATOS_POR_SUJETO = Object.freeze({
  usuario: Object.freeze([
    'activo',
    'nivelScope',
    'tenantId',
    'empresaId',
    'sitioId',
    'nombreMostrar',
    'nombreCompleto',
    'email',
    'preferenciaMostrarAlertasRemotas'
  ]),
  tenant: Object.freeze(['nombre', 'alias', 'descripcion', 'activo', 'timezone', 'cif']),
  empresa: Object.freeze([
    'tenantId',
    'nombre',
    'alias',
    'descripcion',
    'activo',
    'timezone',
    'cif'
  ]),
  sitio: Object.freeze([
    'tenantId',
    'empresaId',
    'nombre',
    'alias',
    'descripcion',
    'activo',
    'timezone'
  ]),
  agente: Object.freeze([
    'nombre',
    'descripcion',
    'estadoAdministrativo',
    'estadoAcceso',
    'tenantId',
    'empresaId',
    'sitioId',
    'perfilOperativo',
    'generacionPerfilServidor',
    'estadoPerfilServidor',
    'histeresisSinPolSegundos',
    'duracionReinicioRecienteSegundos'
  ]),
  regla_telemetria: Object.freeze([
    'agenteId',
    'senalId',
    'estado',
    'generacionAutoridad',
    'revision',
    'condicion',
    'severidadCalculada',
    'mensajeOperativo',
    'metadatos',
    'confirmarFalloSegundos',
    'nombre',
    'descripcion'
  ]),
  monitor: Object.freeze([
    'nombre',
    'tipo',
    'descripcion',
    'activo',
    'intervaloSegundos',
    'inferenciasIndisponibleConsecutivas',
    'inferenciasDisponibleConsecutivas',
    'entradaComposicionBooleana',
    'timeoutMs',
    'reintentos',
    'interpretacionEstado',
    'motivoFallo',
    'causaProbable',
    'posibleSolucion',
    'dependencias',
    'configuracion',
    'tenantId',
    'empresaId',
    'sitioId'
  ]),
  trigger: Object.freeze([
    'nombre',
    'tipo',
    'descripcion',
    'activo',
    'eventosDisparo',
    'configuracion',
    'tenantId',
    'empresaId',
    'sitioId'
  ]),
  destinatario_trigger_correo: Object.freeze([
    'tipo',
    'estadoParticipacion',
    'buzonManual',
    'nombreManual'
  ]),
  binding_trigger: Object.freeze([
    'triggerId',
    'monitorId',
    'activo',
    'orden',
    'eventosDisparo',
    'configuracion'
  ]),
  zona_dns: Object.freeze([
    'nombreZona',
    'tipoZona',
    'categoriaOrigen',
    'descripcion',
    'activo',
    'publicarEnBind',
    'ttlDefectoSegundos',
    'soaMname',
    'soaRname',
    'soaRefreshSegundos',
    'soaRetrySegundos',
    'soaExpireSegundos',
    'soaMinimumSegundos',
    'tenantId',
    'empresaId',
    'sitioId'
  ]),
  registro_dns: Object.freeze([
    'zonaId',
    'hostRelativo',
    'tipoRegistro',
    'valorPrincipal',
    'ttlSegundos',
    'prioridad',
    'peso',
    'puerto',
    'flags',
    'tag',
    'categoriaOrigen',
    'publicarEnBind',
    'datosAuxiliares',
    'activo',
    'descripcion',
    'tenantId',
    'empresaId',
    'sitioId'
  ]),
  configuracion_portal: Object.freeze([])
});

const CAMPOS_PERSONALES_MINIMIZADOS = new Set([
  'nombreMostrar',
  'nombreCompleto',
  'email'
]);

const CLAVES_CONFIGURACION_DESPLIEGUE_PROHIBIDAS = new Set([
  'dns.ruta_include_gestionado',
  'dns.directorio_zonas'
]);

const CLAVES_CONFIGURACION_AUDITABLES = new Set([
  'portal.nombre_visible',
  'portal.origen_publico',
  'usuarios.password_longitud_minima',
  'usuarios.recuperacion_email_activa',
  'usuarios.recuperacion_email_vigencia_segundos',
  'usuarios.recuperacion_email_alegaciones_maximas',
  'usuarios.recuperacion_email_origen_ventana_segundos',
  'usuarios.recuperacion_email_origen_intentos_maximos',
  'usuarios.recuperacion_email_par_ventana_segundos',
  'usuarios.recuperacion_email_par_intentos_maximos',
  'usuarios.recuperacion_email_global_ventana_segundos',
  'usuarios.recuperacion_email_global_intentos_maximos',
  'usuarios.recuperacion_email_jitter_maximo_ms',
  'usuarios.recuperacion_email_lease_preparacion_segundos',
  'usuarios.recuperacion_email_lease_alegacion_segundos',
  'usuarios.recuperacion_email_lease_consumo_segundos',
  'dns.activo',
  'dns.listen_on',
  'dns.listen_on_v6',
  'dns.allow_query',
  'dns.recursion',
  'dns.forwarders_habilitados',
  'dns.forwarders',
  'monitores.compactacion_cerca_fallo_porcentaje',
  'monitores.compactacion_serie_variacion_porcentaje',
  'monitores.retencion_eventos_dias',
  'monitores.runtime_bloqueo_ttl_segundos',
  'agentes.session_ttl_segundos',
  'agentes.heartbeat_interval_segundos',
  'agentes.heartbeat_grace_segundos',
  'agentes.login_fallos_maximos',
  'agentes.cuarentena_segundos',
  'correo.activo',
  'correo.operativo_verificado',
  'correo.smtp_host',
  'correo.smtp_puerto',
  'correo.smtp_secure',
  'correo.smtp_auth_method',
  'correo.smtp_timeout_conexion_ms',
  'correo.smtp_timeout_saludo_ms',
  'correo.smtp_timeout_socket_ms',
  'correo.smtp_tls_permitir_inseguro',
  'correo.smtp_usuarioConfigurado',
  'correo.smtp_claveConfigurada',
  'correo.remitente_email',
  'correo.remitente_nombre',
  'correo.max_reintentos',
  'correo.reintento_base_segundos',
  'correo.bloqueo_ttl_segundos',
  'correo.runtime_lote_maximo',
  'correo.desuscripcion_ttl_dias',
  'correo.destinatarios_trigger_maximos',
  'correo.retencion_salidas_dias',
  'pow.activo',
  'pow.redis_prefijo',
  'pow.ttl_desafio_segundos',
  'pow.tiempo_objetivo_ms',
  'pow.tiempo_minimo_ms',
  'pow.tiempo_maximo_ms',
  'pow.ventana_intentos_segundos',
  'pow.incremento_por_intento_ms',
  'pow.incremento_por_fallo_ms',
  'pow.coste_minimo',
  'pow.coste_maximo',
  'pow.hashrate_por_defecto',
  'pow.hashrate_minimo',
  'pow.hashrate_maximo',
  'pow.benchmark_cliente_ms',
  'auditoria.retencion_dias',
  'federacion.activacion',
  'federacion.origen_publico',
  'federacion.proxies_confiables',
  'federacion.tolerancia_temporal_ms',
  'federacion.lote_maximo_ocurrencias',
  'federacion.lote_maximo_bytes',
  'federacion.ocurrencia_maxima_bytes',
  'federacion.capacidad_receptora_ocurrencias',
  'federacion.ttl_estado_operativo_ms',
  'federacion.silencio_relacion_ms',
  'federacion.consolidacion_reinicio_ms',
  'federacion.retencion_maxima_dias',
  'federacion.keyring_referencia_despliegue'
]);

const CLAVES_ANIDADAS_SEGURAS = new Set([
  'tipo',
  'version',
  'configuracion',
  'operador',
  'umbral',
  'valor',
  'valorMinimo',
  'valorMaximo',
  'incluirMinimo',
  'incluirMaximo',
  'patron',
  'opciones',
  'esperado',
  'estado',
  'condicion',
  'agenteId',
  'senalId',
  'reglaId',
  'generacionAutoridad',
  'numero',
  'nombre',
  'descripcion',
  'severidadCalculada',
  'mensajeOperativo',
  'metadatos',
  'unidad',
  'tipoDato',
  'origen',
  'causaProbable',
  'posibleSolucion',
  'impactoOperativo',
  'vigenteDesdeUtc',
  'vigenteHastaUtc',
  'forma',
  'limite',
  'limiteInferior',
  'limiteSuperior',
  'direccion',
  'segundos',
  'histeresisSegundos',
  'histeresisInferiorSegundos',
  'histeresisSuperiorSegundos',
  'monitorId',
  'referencia',
  'etiqueta',
  'triggerId',
  'variable',
  'invertir',
  'expresion',
  'variables',
  'dependencias',
  'mensajeFallo',
  'estadoInicial',
  'retardoSenalSegundos',
  'retardoFalloSegundos',
  'confirmarFalloSegundos',
  'politicaEntradasIncompletas',
  'fuente',
  'layoutVisual',
  'nodos',
  'conexiones',
  'grafoLogico',
  'id',
  'clase',
  'x',
  'y',
  'puertos',
  'entrada',
  'salida',
  'desde',
  'hasta',
  'puertoDesde',
  'puertoHasta',
  'salidaId',
  'expresionCompilada',
  'variablesUsadas',
  'valido',
  'errores',
  'host',
  'metodo',
  'permiteTlsInseguro',
  'parametroOpcional',
  'gobernadoPor',
  'modoControl',
  'rolAsignado',
  'ttlSugerido',
  'propietario',
  'criterioActualizacion',
  'politicaSobrescritura',
  'validacionOrigen',
  'puerto',
  'usarTls',
  'validarCertificadoTls',
  'timeoutMs',
  'reintentos',
  'tamanoPaqueteBytes',
  'payloadBytes',
  'ttl',
  'vigenciaMinimaCertDias',
  'minimo',
  'maximo',
  'valorEsperado',
  'zonaId',
  'registroId',
  'operacionDns',
  'valorPrincipal',
  'rolGobernanza',
  'asuntoPlantilla',
  'tieneTextoIntroduccion',
  'tieneTextoCierre',
  'activo',
  'orden',
  'eventosDisparo'
]);

const NOMBRES_SECRETOS_PROHIBIDOS = Object.freeze([
  /(^|[_.])(password|contrasena|contraseña)([_.]|$)/i,
  /(^|[_.])token([_.]|$)/i,
  /(^|[_.])bearer([_.]|$)/i,
  /(^|[_.])cookie([_.]|$)/i,
  /sessiontokenhash/i,
  /(^|[_.])secret(o)?([_.]|$)/i,
  /smtp([_.])?(usuario|user|username|clave|password)/i,
  /correo([_.])?(usuario|clave|password)/i,
  /(^|[_.])(hash|prefijo|sufijo|longitud)([_.]|$)/i,
  /^bind_/i,
  /^dns\.comando_/i
]);

export function validarEventoAuditableV1({
  tipo,
  versionContrato = null,
  actor,
  origen,
  sujeto,
  flujo = null,
  flujoCabecera = null,
  productor,
  rolEvento,
  payload
} = {}) {
  const definicion = obtenerDefinicionTipoEventoAuditoria(tipo);
  exigir(definicion, `Tipo de evento auditable desconocido: ${tipo}.`);
  exigir(
    versionContrato === null || versionContrato === definicion.versionContrato,
    `El tipo ${tipo} pertenece al contrato auditable v${definicion.versionContrato}.`
  );
  exigir(
    definicion.parejasActorOrigen.some(
      (pareja) => pareja.actor === actor && pareja.origen === origen
    ),
    `La pareja actor/origen ${actor}/${origen} no está permitida para ${tipo}.`
  );
  validarSujeto(sujeto, definicion.sujetos);
  exigir(
    definicion.productores.includes(productor),
    `El productor ${productor} no está permitido para ${tipo}.`
  );
  exigir(
    definicion.emisionesPermitidas.some(
      (emision) =>
        emision.actor === actor &&
        emision.origen === origen &&
        emision.productor === productor
    ),
    `La frontera ${actor}/${origen}/${productor} no está permitida para ${tipo}.`
  );
  exigir(
    definicion.roles.includes(rolEvento),
    `El rol ${rolEvento} no está permitido para ${tipo}.`
  );

  const flujoEsperado = resolverFlujoEventoAuditoria(
    tipo,
    sujeto.tipo,
    flujoCabecera || flujo
  );
  exigir(flujo === flujoEsperado, `El flujo de ${tipo} debe ser ${flujoEsperado}.`);
  const perfil = definicion.perfilesPorProductor?.[productor] || definicion.perfil;
  validarPayloadAuditoriaV1({ tipo, perfil, payload, actor, origen });
  if (tipo === 'cadena.iniciada') {
    exigir(
      sujeto.id === payload.claveCadena && flujoEsperado === payload.flujo,
      'La génesis debe coincidir con la cabecera y el sujeto de cadena.'
    );
  }
  assertSinSecretosAuditoria(payload);

  return Object.freeze({
    tipo: definicion.tipo,
    versionContrato: definicion.versionContrato,
    perfil,
    flujo: flujoEsperado,
    actor,
    origen,
    sujeto: Object.freeze({ ...sujeto }),
    productor,
    rolEvento,
    payload
  });
}

export function validarPayloadAuditoriaV1({ tipo, perfil, payload, actor, origen } = {}) {
  exigirObjetoPlano(payload, 'payload');
  const campos = PERFILES_PAYLOAD_AUDITORIA[perfil];
  exigir(campos, `Perfil de payload desconocido: ${perfil}.`);
  const conservaAutoridadRegla = tipo === 'regla_telemetria.estado_cambiado' &&
    Object.hasOwn(payload, 'generacionAutoridadAntes');
  exigirClavesExactas(
    payload,
    conservaAutoridadRegla
      ? [...campos, 'generacionAutoridadAntes', 'generacionAutoridadDespues',
        'revisionVigenteId']
      : campos,
    perfil
  );

  switch (perfil) {
    case 'recuperacion_password_emision_v1':
      validarEmisionRecuperacionPassword(payload);
      break;
    case 'alta_v1':
      validarAlta(tipo, payload);
      break;
    case 'cambio_v1':
      validarCambio(tipo, payload);
      break;
    case 'estado_v1':
      validarEstado(tipo, payload);
      break;
    case 'eliminacion_v1':
      validarEliminacion(tipo, payload);
      break;
    case 'eliminacion_agente_v1':
      validarEliminacionAgente(tipo, payload);
      break;
    case 'eliminacion_organizacion_v1':
      validarEliminacionOrganizacion(tipo, payload);
      break;
    case 'scope_v1':
      validarMovimiento(tipo, payload);
      break;
    case 'sesion_v1':
      validarSesion(tipo, payload);
      break;
    case 'credencial_v1':
      validarCredencial(tipo, payload);
      break;
    case 'ciclo_alerta_v1':
      validarCicloAlerta(tipo, payload, actor);
      break;
    case 'descarte_alerta_v1':
      validarDescarteAlerta(tipo, payload, actor, origen);
      break;
    case 'resultado_externo_v1':
      validarResultadoExterno(tipo, payload);
      break;
    case 'retencion_v1':
      validarRetencion(payload);
      break;
    case 'incidente_v1':
      validarIncidente(payload);
      break;
    case 'genesis_v1':
      validarGenesis(payload);
      break;
    case 'federacion_control_v1':
      validarControlFederacion(tipo, payload);
      break;
    case 'federacion_transporte_v1':
      validarTransporteFederacion(tipo, payload);
      break;
    case 'aviso_plataforma_v1':
      validarAvisoPlataforma(tipo, payload);
      break;
    case 'ddns_v1':
      validarDdns(tipo, payload);
      break;
    default:
      throw new Error(`No existe validador para el perfil ${perfil}.`);
  }
  assertSinSecretosAuditoria(payload);
  serializarPayloadAuditoriaV1(payload);
  return payload;
}

export function validarIdentidadesLoteAuditoria(eventos = []) {
  exigir(Array.isArray(eventos), 'El lote de identidades debe ser un array.');
  const identidades = new Set();
  const clavesPrincipalesPorCorrelacion = new Map();
  for (const evento of eventos) {
    for (const campo of ['productor', 'claveOperacion', 'rolEvento', 'correlacionId']) {
      exigir(typeof evento?.[campo] === 'string' && evento[campo].length > 0, `${campo} es obligatorio en el lote.`);
    }
    const identidad = `${evento.productor}\u0000${evento.claveOperacion}\u0000${evento.rolEvento}`;
    exigir(!identidades.has(identidad), 'Una clave de operación no puede producir dos eventos del mismo rol.');
    identidades.add(identidad);
    if (evento.rolEvento === 'principal') {
      const claves = clavesPrincipalesPorCorrelacion.get(evento.correlacionId) || new Set();
      exigir(!claves.has(evento.claveOperacion), 'Cada intención principal de una petición compuesta exige una clave propia.');
      claves.add(evento.claveOperacion);
      clavesPrincipalesPorCorrelacion.set(evento.correlacionId, claves);
    }
  }
  return Object.freeze({ total: eventos.length, identidades: identidades.size });
}

export function validarParMovimientoAuditoriaV1(salida, entrada) {
  exigir(salida?.tipo === 'scope.entidad_salida', 'Falta el evento de salida del movimiento.');
  exigir(entrada?.tipo === 'scope.entidad_entrada', 'Falta el evento de entrada del movimiento.');
  exigir(PATRON_UUID_V7.test(salida.eventoId) && PATRON_UUID_V7.test(entrada.eventoId), 'Los ids del movimiento deben ser UUIDv7 canónicos.');
  exigir(salida.eventoId !== entrada.eventoId, 'Los lados del movimiento requieren ids distintos.');
  exigir(salida.payload?.eventoContraparteId === entrada.eventoId, 'La salida no referencia a su entrada.');
  exigir(entrada.payload?.eventoContraparteId === salida.eventoId, 'La entrada no referencia a su salida.');
  for (const campo of [
    'versionContrato',
    'flujo',
    'origen',
    'productor',
    'claveOperacion',
    'correlacionId',
    'efectivoEnUtc',
    'versionCanonicalizador',
    'versionEncadenado'
  ]) {
    exigir(
      salida[campo] === entrada[campo],
      `Los lados del movimiento deben compartir ${campo}.`
    );
  }
  for (const campo of ['actorReal', 'actorEfectivo', 'sujeto', 'causalidad']) {
    exigir(
      isDeepStrictEqual(salida[campo], entrada[campo]),
      `Los lados del movimiento deben compartir ${campo}.`
    );
  }
  exigir(
    salida.modoActuacion === entrada.modoActuacion,
    'Los lados del movimiento deben compartir modoActuacion.'
  );
  exigir(isDeepStrictEqual(salida.payload?.impactoResumen, entrada.payload?.impactoResumen), 'Los lados del movimiento deben conservar el mismo impactoResumen.');
  exigir(!isDeepStrictEqual(salida.payload?.scopePropio, entrada.payload?.scopePropio), 'Un movimiento exige scopes de salida y entrada distintos.');
  return Object.freeze({
    correlacionId: salida.correlacionId,
    salidaId: salida.eventoId,
    entradaId: entrada.eventoId
  });
}

export function assertSinSecretosAuditoria(valor, ruta = 'payload') {
  if (Array.isArray(valor)) {
    valor.forEach((item, indice) => assertSinSecretosAuditoria(item, `${ruta}[${indice}]`));
    return;
  }
  if (!valor || typeof valor !== 'object') {
    return;
  }
  for (const [clave, hijo] of Object.entries(valor)) {
    const clavePermitida = CLAVES_CONFIGURACION_AUDITABLES.has(clave) || [
      'claveCadena',
      'claveConfiguracion',
      'clave',
      'hashAnteriorAlTramo',
      'hashHasta',
      'huella',
      'usuarioConfigurado',
      'claveConfigurada'
    ].includes(clave);
    if (!clavePermitida && NOMBRES_SECRETOS_PROHIBIDOS.some((patron) => patron.test(clave))) {
      throw new Error(`El campo ${ruta}.${clave} puede contener material secreto.`);
    }
    assertSinSecretosAuditoria(hijo, `${ruta}.${clave}`);
  }
}

function validarSujeto(sujeto, permitidos) {
  exigirObjetoPlano(sujeto, 'sujeto');
  exigirClavesExactas(sujeto, ['tipo', 'id'], 'sujeto');
  exigir(permitidos.includes(sujeto.tipo), `Sujeto ${sujeto.tipo} no permitido.`);
  exigir(typeof sujeto.id === 'string' && sujeto.id.length > 0, 'sujeto.id debe ser string.');

  const idsSql = [
    'usuario', 'agente', 'regla_telemetria', 'monitor', 'trigger',
    'destinatario_trigger_correo',
    'binding_trigger', 'zona_dns', 'registro_dns', 'tenant', 'empresa', 'sitio'
  ];
  if (idsSql.includes(sujeto.tipo)) {
    exigir(PATRON_ID_DECIMAL_POSITIVO.test(sujeto.id), 'El id SQL debe ser decimal canónico positivo.');
  } else if (['sesion_usuario', 'sesion_agente', 'alerta', 'incidente_integridad',
    'aviso_plataforma', 'concesion_ddns', 'intencion_ddns'].includes(sujeto.tipo)) {
    exigir(PATRON_UUID_V7.test(sujeto.id), `El id de ${sujeto.tipo} debe ser UUIDv7 canónico.`);
  } else if (sujeto.tipo.endsWith('_federada') || sujeto.tipo.endsWith('_federado')) {
    exigir(PATRON_ID_FEDERADA.test(sujeto.id), `El id de ${sujeto.tipo} no es una identidad federada canónica.`);
    const tipoEsperado = {
      instalacion_federada: 'instalacion',
      relacion_federada: 'relacion',
      revision_concesion_federada: 'revision_concesion',
      flujo_federado: 'flujo',
      lote_federado: 'lote',
      proyeccion_federada: 'proyeccion'
    }[sujeto.tipo];
    exigir(
      sujeto.id.startsWith(`sfid1.${tipoEsperado}.`),
      `El id de ${sujeto.tipo} mezcla tipos de identidad.`
    );
  } else if (sujeto.tipo === 'frontera_internet') {
    exigir(sujeto.id === 'portal', 'La frontera Internet usa el id literal portal.');
  } else if (sujeto.tipo === 'configuracion_portal') {
    exigir(sujeto.id === 'portal', 'La configuración del portal usa el id literal portal.');
  } else if (sujeto.tipo === 'cadena_auditoria') {
    exigir(esClaveCadenaAuditoria(sujeto.id), 'La clave de cadena no es válida.');
  }
}

function validarAlta(tipo, payload) {
  exigir(payload.resultado === 'creado', `${tipo} exige resultado=creado.`);
  exigir(payload.antes === null, `${tipo} exige antes=null.`);
  exigirObjetoPlano(payload.despues, 'despues');
  exigir(Object.keys(payload.despues).length > 0, `${tipo} exige despues informado.`);
  validarFotografia(tipo, payload.despues);
}

function validarCambio(tipo, payload) {
  exigir(payload.resultado === 'actualizado', `${tipo} exige resultado=actualizado.`);
  exigir(Array.isArray(payload.camposCambiados) && payload.camposCambiados.length > 0, 'camposCambiados debe ser un array no vacío.');
  const unicos = new Set(payload.camposCambiados);
  exigir(unicos.size === payload.camposCambiados.length, 'camposCambiados no admite duplicados.');
  const ordenados = [...payload.camposCambiados].sort(compararUtf8);
  exigir(ordenados.every((campo, indice) => campo === payload.camposCambiados[indice]), 'camposCambiados debe estar ordenado por bytes UTF-8.');
  exigirObjetoPlano(payload.antes, 'antes');
  exigirObjetoPlano(payload.despues, 'despues');
  const sujeto = obtenerDefinicionTipoEventoAuditoria(tipo).sujetos[0];
  for (const campo of payload.camposCambiados) {
    validarCampoDato(sujeto, campo);
    if (!CAMPOS_PERSONALES_MINIMIZADOS.has(campo)) {
      exigir(
        Object.hasOwn(payload.antes, campo) && Object.hasOwn(payload.despues, campo),
        `${campo} debe figurar en antes y despues.`
      );
    }
  }
  for (const fotografia of [payload.antes, payload.despues]) {
    for (const [campo, valor] of Object.entries(fotografia)) {
      exigir(unicos.has(campo), `${campo} no figura en camposCambiados.`);
      validarCampoDato(sujeto, campo);
      exigir(!CAMPOS_PERSONALES_MINIMIZADOS.has(campo), `${campo} debe omitirse por minimización.`);
      validarValorAnidadoSeguro(valor, campo);
    }
  }
}

function validarEstado(tipo, payload) {
  exigir(typeof payload.estadoAntes === 'string' && typeof payload.estadoDespues === 'string', 'Los estados deben ser strings.');
  exigir(payload.estadoAntes !== payload.estadoDespues, 'Una transición exige estados distintos.');
  const transiciones = TRANSICIONES_ESTADO_POR_TIPO[tipo] || [];
  exigir(transiciones.some(([antes, despues]) => antes === payload.estadoAntes && despues === payload.estadoDespues), `Transición de estado no permitida para ${tipo}.`);
  validarEnumCerrado(tipo, 'motivo', payload.motivo);
  if (tipo === 'regla_telemetria.estado_cambiado' &&
      Object.hasOwn(payload, 'generacionAutoridadAntes')) {
    validarEstadoAutoridadRegla(payload);
  }
}

function validarEstadoAutoridadRegla(payload) {
  const antes = normalizarEnteroDecimalAuditoria(
    payload.generacionAutoridadAntes,
    'La generación de autoridad anterior debe ser un entero positivo.'
  );
  const despues = normalizarEnteroDecimalAuditoria(
    payload.generacionAutoridadDespues,
    'La generación de autoridad posterior debe ser un entero positivo.'
  );
  exigir(BigInt(despues) === BigInt(antes) + 1n,
    'El cambio de estado debe avanzar exactamente una generación de autoridad.');
  normalizarEnteroDecimalAuditoria(
    payload.revisionVigenteId,
    'La revisión vigente auditada debe ser un entero positivo.'
  );
}

function normalizarEnteroDecimalAuditoria(valor, mensaje) {
  const texto = String(valor ?? '');
  exigir(/^[1-9][0-9]*$/.test(texto), mensaje);
  return texto;
}

function validarEliminacion(tipo, payload) {
  exigir(payload.resultado === 'eliminado', `${tipo} exige resultado=eliminado.`);
  exigirObjetoPlano(payload.antes, 'antes');
  exigir(Object.keys(payload.antes).length > 0, `${tipo} exige antes informado.`);
  exigir(payload.despues === null, `${tipo} exige despues=null.`);
  validarFotografia(tipo, payload.antes);
  if (payload.impactoResumen !== null) {
    exigirObjetoPlano(payload.impactoResumen, 'impactoResumen');
    exigirClavesExactas(payload.impactoResumen, ['dependenciasEliminadas', 'referenciasDesacopladas'], 'impactoResumen');
    validarContador(payload.impactoResumen.dependenciasEliminadas, 'dependenciasEliminadas', true);
    validarContador(payload.impactoResumen.referenciasDesacopladas, 'referenciasDesacopladas', true);
    exigir(
      BigInt(payload.impactoResumen.dependenciasEliminadas) > 0n ||
        BigInt(payload.impactoResumen.referenciasDesacopladas) > 0n,
      'Un impacto de eliminación vacío debe representarse como null.'
    );
  }
}

function validarEliminacionAgente(tipo, payload) {
  exigir(tipo === 'agente.eliminado', 'El perfil destructivo de agente no es reutilizable.');
  exigir(payload.resultado === 'eliminado', `${tipo} exige resultado=eliminado.`);
  validarFechaUtcMilisegundos(payload.aceptadaEnUtc, 'aceptadaEnUtc');
  exigir(payload.despues === null, `${tipo} exige despues=null.`);
  exigirObjetoPlano(payload.antes, 'antes');
  exigirClavesExactas(payload.antes, [
    'id', 'guid', 'nombre', 'descripcion', 'estadoAdministrativo',
    'estadoAcceso', 'versionAgente', 'scope'
  ], 'antes');
  exigir(PATRON_ID_DECIMAL_POSITIVO.test(payload.antes.id), 'antes.id debe ser decimal positivo.');
  exigir(typeof payload.antes.guid === 'string' && payload.antes.guid.length > 0,
    'antes.guid es obligatorio.');
  exigir(typeof payload.antes.nombre === 'string' && payload.antes.nombre.length > 0,
    'antes.nombre es obligatorio.');
  exigir(payload.antes.descripcion === null || typeof payload.antes.descripcion === 'string',
    'antes.descripcion debe ser string o null.');
  exigir(typeof payload.antes.estadoAdministrativo === 'string' &&
    typeof payload.antes.estadoAcceso === 'string', 'Los estados administrativos son obligatorios.');
  exigir(payload.antes.versionAgente === null || typeof payload.antes.versionAgente === 'string',
    'antes.versionAgente debe ser string o null.');
  exigirObjetoPlano(payload.antes.scope, 'antes.scope');
  exigirClavesExactas(payload.antes.scope,
    ['nivel', 'tenantId', 'empresaId', 'sitioId'], 'antes.scope');
  exigir(payload.antes.scope.nivel === 'sitio', 'La fotografía del agente exige scope de sitio.');
  for (const campo of ['tenantId', 'empresaId', 'sitioId']) {
    exigir(PATRON_ID_DECIMAL_POSITIVO.test(payload.antes.scope[campo]),
      `antes.scope.${campo} debe ser decimal positivo.`);
  }

  exigirObjetoPlano(payload.impactoResumen, 'impactoResumen');
  exigirClavesExactas(payload.impactoResumen, ['perfil', 'version', 'conteos'],
    'impactoResumen');
  exigir(payload.impactoResumen.perfil === 'sentinelia-eliminacion-agente-impacto-v1' &&
    payload.impactoResumen.version === 1, 'El resumen de impacto del agente no es compatible.');
  exigir(Array.isArray(payload.impactoResumen.conteos),
    'impactoResumen.conteos debe ser una lista.');
  exigir(payload.impactoResumen.conteos.length ===
    CATEGORIAS_IMPACTO_ELIMINACION_AGENTE.length,
  'El resumen de impacto debe cubrir todas las categorías.');
  const porCategoria = new Map();
  for (const [indice, item] of payload.impactoResumen.conteos.entries()) {
    exigirObjetoPlano(item, `impactoResumen.conteos[${indice}]`);
    exigirClavesExactas(item, ['categoria', 'cantidad', 'precision'],
      `impactoResumen.conteos[${indice}]`);
    exigir(item.categoria === CATEGORIAS_IMPACTO_ELIMINACION_AGENTE[indice],
      'Las categorías de impacto deben ser completas y mantener su orden contractual.');
    validarContador(item.cantidad, `impactoResumen.${item.categoria}`, true);
    exigir(['exacta', 'estimada'].includes(item.precision),
      `Precisión desconocida para ${item.categoria}.`);
    porCategoria.set(item.categoria, item.cantidad);
  }
  const destacados = [
    ['referenciasCompartidasConservadas', 'referencias_compartidas'],
    ['identidadesFederadasRetiradas', 'identidades_federadas'],
    ['obligacionesPostcommit', 'obligaciones_postcommit']
  ];
  for (const [campo, categoria] of destacados) {
    validarContador(payload[campo], campo, true);
    exigir(payload[campo] === porCategoria.get(categoria),
      `${campo} debe coincidir con el resumen categórico.`);
  }
}

function validarEliminacionOrganizacion(tipo, payload) {
  const tipoSujeto = {
    'organizacion.tenant_eliminado': 'tenant',
    'organizacion.empresa_eliminada': 'empresa',
    'organizacion.sitio_eliminado': 'sitio'
  }[tipo];
  exigir(tipoSujeto, 'El perfil destructivo organizativo no es reutilizable.');
  exigir(payload.resultado === 'eliminado', `${tipo} exige resultado=eliminado.`);
  validarFechaUtcMilisegundos(payload.aceptadaEnUtc, 'aceptadaEnUtc');
  exigir(payload.despues === null, `${tipo} exige despues=null.`);

  exigirObjetoPlano(payload.sujetoAceptado, 'sujetoAceptado');
  exigirClavesExactas(payload.sujetoAceptado, ['tipo', 'id', 'scope'], 'sujetoAceptado');
  exigir(payload.sujetoAceptado.tipo === tipoSujeto,
    'El sujeto aceptado no coincide con el tipo de evento.');
  exigir(PATRON_ID_DECIMAL_POSITIVO.test(payload.sujetoAceptado.id),
    'sujetoAceptado.id debe ser decimal positivo.');
  validarScopeJerarquicoOrganizacion(
    payload.sujetoAceptado.scope,
    'sujetoAceptado.scope'
  );
  exigirRaizOrganizacionEnScope(payload.sujetoAceptado, 'sujetoAceptado');

  exigirObjetoPlano(payload.autorizacionAceptada, 'autorizacionAceptada');
  exigirClavesExactas(
    payload.autorizacionAceptada,
    ['actorReal', 'actorEfectivo'],
    'autorizacionAceptada'
  );
  validarActorAceptadoOrganizacion(
    payload.autorizacionAceptada.actorReal,
    'autorizacionAceptada.actorReal'
  );
  validarActorAceptadoOrganizacion(
    payload.autorizacionAceptada.actorEfectivo,
    'autorizacionAceptada.actorEfectivo'
  );
  if (payload.autorizacionAceptada.actorReal.usuarioId ===
      payload.autorizacionAceptada.actorEfectivo.usuarioId) {
    exigir(isDeepStrictEqual(
      payload.autorizacionAceptada.actorReal,
      payload.autorizacionAceptada.actorEfectivo
    ), 'Una actuación directa exige fotografías de autorización idénticas.');
  }

  exigirObjetoPlano(payload.antes, 'antes');
  exigirClavesExactas(payload.antes, [
    'perfil', 'version', 'tipo', 'id', 'nombre', 'scopeFinal', 'capturadaEnUtc'
  ], 'antes');
  exigir(
    payload.antes.perfil ===
      'sentinelia-eliminacion-organizacion-fotografia-final-v1' &&
      payload.antes.version === 1,
    'La fotografía final organizativa no es compatible.'
  );
  exigir(payload.antes.tipo === tipoSujeto &&
    payload.antes.id === payload.sujetoAceptado.id,
  'La fotografía final pertenece a otra raíz.');
  exigir(typeof payload.antes.nombre === 'string' && payload.antes.nombre.trim().length > 0,
    'antes.nombre es obligatorio.');
  validarScopeJerarquicoOrganizacion(payload.antes.scopeFinal, 'antes.scopeFinal');
  exigirRaizOrganizacionEnScope({
    tipo: payload.antes.tipo,
    id: payload.antes.id,
    scope: payload.antes.scopeFinal
  }, 'antes');
  exigir(isDeepStrictEqual(
    payload.antes.scopeFinal,
    payload.sujetoAceptado.scope
  ), 'La fotografía final debe conservar exactamente el scope aceptado.');
  validarFechaUtcMilisegundos(payload.antes.capturadaEnUtc, 'antes.capturadaEnUtc');

  exigirObjetoPlano(payload.impactoResumen, 'impactoResumen');
  exigirClavesExactas(payload.impactoResumen, ['perfil', 'version', 'conteos'],
    'impactoResumen');
  exigir(
    payload.impactoResumen.perfil ===
      'sentinelia-eliminacion-organizacion-impacto-v1' &&
      payload.impactoResumen.version === 1,
    'El resumen de impacto organizativo no es compatible.'
  );
  exigir(Array.isArray(payload.impactoResumen.conteos) &&
    payload.impactoResumen.conteos.length > 0,
  'impactoResumen.conteos debe ser una lista no vacía.');
  const porCategoria = new Map();
  for (const [indice, item] of payload.impactoResumen.conteos.entries()) {
    exigirObjetoPlano(item, `impactoResumen.conteos[${indice}]`);
    exigirClavesExactas(item, ['categoria', 'cantidad', 'precision'],
      `impactoResumen.conteos[${indice}]`);
    exigir(CATEGORIAS_IMPACTO_ELIMINACION_ORGANIZACION.includes(item.categoria),
      `Categoría organizativa desconocida: ${item.categoria}.`);
    exigir(!porCategoria.has(item.categoria),
      `La categoría ${item.categoria} está duplicada.`);
    exigir(!CATEGORIAS_HISTORICAS_ELIMINACION_ORGANIZACION.has(item.categoria),
      `La fotografía final no puede conservar ${item.categoria}.`);
    validarContador(item.cantidad, `impactoResumen.${item.categoria}`, true);
    exigir(item.precision === 'exacta',
      `El conteo final ${item.categoria} debe ser exacto.`);
    porCategoria.set(item.categoria, item.cantidad);
  }
  exigir(porCategoria.get('raiz') === '1',
    'El impacto final debe declarar exactamente una raíz.');
  for (const [campo, categoria] of [
    ['identidadesFederadasRetiradas', 'identidades_federadas'],
    ['obligacionesPostcommit', 'obligaciones_postcommit']
  ]) {
    validarContador(payload[campo], campo, true);
    exigir(payload[campo] === porCategoria.get(categoria),
      `${campo} debe coincidir con el resumen categórico.`);
  }
}

function validarActorAceptadoOrganizacion(actor, ruta) {
  exigirObjetoPlano(actor, ruta);
  exigirClavesExactas(actor, ['usuarioId', 'estado', 'decision', 'scope'], ruta);
  exigir(PATRON_ID_DECIMAL_POSITIVO.test(actor.usuarioId),
    `${ruta}.usuarioId debe ser decimal positivo.`);
  exigir(actor.estado === 'activo' && actor.decision === 'autorizada',
    `${ruta} debe conservar una autorización activa.`);
  validarScopeJerarquicoOrganizacion(actor.scope, `${ruta}.scope`);
}

function validarScopeJerarquicoOrganizacion(scope, ruta) {
  exigirObjetoPlano(scope, ruta);
  exigirClavesExactas(scope, ['nivel', 'tenantId', 'empresaId', 'sitioId'], ruta);
  exigir(['portal', 'tenant', 'empresa', 'sitio'].includes(scope.nivel),
    `${ruta}.nivel no es válido.`);
  for (const campo of ['tenantId', 'empresaId', 'sitioId']) {
    exigir(scope[campo] === null ||
      (typeof scope[campo] === 'string' && PATRON_ID_DECIMAL_POSITIVO.test(scope[campo])),
    `${ruta}.${campo} debe ser null o id decimal canónico.`);
  }
  const valido =
    (scope.nivel === 'portal' && scope.tenantId === null && scope.empresaId === null && scope.sitioId === null) ||
    (scope.nivel === 'tenant' && scope.tenantId !== null && scope.empresaId === null && scope.sitioId === null) ||
    (scope.nivel === 'empresa' && scope.tenantId !== null && scope.empresaId !== null && scope.sitioId === null) ||
    (scope.nivel === 'sitio' && scope.tenantId !== null && scope.empresaId !== null && scope.sitioId !== null);
  exigir(valido, `${ruta} no respeta la jerarquía organizativa.`);
}

function exigirRaizOrganizacionEnScope(sujeto, ruta) {
  exigir(sujeto.scope.nivel === sujeto.tipo &&
    sujeto.scope[`${sujeto.tipo}Id`] === sujeto.id,
  `${ruta} no identifica su raíz dentro del scope.`);
}

function validarMovimiento(tipo, payload) {
  const direccion = tipo === 'scope.entidad_salida' ? 'salida' : 'entrada';
  exigir(payload.direccion === direccion, `${tipo} exige direccion=${direccion}.`);
  validarScope(payload.scopePropio);
  exigir(PATRON_UUID_V7.test(payload.eventoContraparteId), 'eventoContraparteId debe ser UUIDv7 canónico.');
  if (payload.impactoResumen !== null) {
    exigirObjetoPlano(payload.impactoResumen, 'impactoResumen');
    exigirClavesExactas(payload.impactoResumen, Object.keys(CLASES_SCOPE_POR_DIMENSION), 'impactoResumen');
    for (const [dimension, clases] of Object.entries(CLASES_SCOPE_POR_DIMENSION)) {
      validarContadoresPorClase(payload.impactoResumen[dimension], clases, dimension);
    }
    exigir(
      Object.values(payload.impactoResumen).some(
        (contadores) => Object.keys(contadores).length > 0
      ),
      'Un impacto de scope vacío debe representarse como null.'
    );
  }
}

function validarSesion(tipo, payload) {
  exigir(PATRON_UUID_V7.test(payload.sesionAuditoriaId), 'sesionAuditoriaId debe ser UUIDv7 canónico.');
  const resultados = {
    'usuario.sesion_iniciada': 'iniciada',
    'usuario.sesion_cerrada': 'cerrada',
    'usuario.sesion_invalidada': 'invalidada',
    'usuario.impersonacion_iniciada': 'impersonacion_iniciada',
    'usuario.impersonacion_finalizada': 'impersonacion_finalizada',
    'agente.sesion_iniciada': 'iniciada',
    'agente.sesion_reemplazada': 'reemplazada',
    'agente.sesion_invalidada': 'invalidada'
  };
  exigir(payload.resultado === resultados[tipo], `Resultado de sesión inválido para ${tipo}.`);
  validarEnumCerrado(tipo, 'causa', payload.causa);
}

function validarCredencial(tipo, payload) {
  const esperado = {
    'usuario.password_cambiado': ['cambio', 'actualizada'],
    'usuario.password_reiniciado': ['reinicio', 'reiniciada'],
    'usuario.password_recuperado': ['recuperacion', 'recuperada'],
    'agente.secreto_rotado': ['rotacion', 'rotada']
  }[tipo];
  exigir(payload.operacion === esperado?.[0] && payload.resultado === esperado?.[1], `Operación o resultado de credencial inválidos para ${tipo}.`);
  validarEnumCerrado(tipo, 'causa', payload.causa);
}

function validarEmisionRecuperacionPassword(payload) {
  exigir(payload.resultado === 'emitida', 'La emisión de recuperación exige resultado=emitida.');
  exigirBuzonCanonicoCorreo(payload.buzonCanonico);
  exigir(
    typeof payload.direccionIp === 'string' && isIP(payload.direccionIp) !== 0,
    'direccionIp debe ser una dirección IPv4 o IPv6 canónica.'
  );
}

function validarCicloAlerta(tipo, payload, actor) {
  const resultado = tipo === 'alerta.abierta' ? 'abierta' : 'cerrada';
  const causas = tipo === 'alerta.abierta'
    ? ['monitor_en_fallo']
    : actor === 'usuario'
      ? ['monitor_desactivado']
      : ['monitor_recuperado', 'monitor_desactivado'];
  exigir(payload.resultado === resultado && causas.includes(payload.causa), `Ciclo de alerta inválido para ${tipo}.`);
}

function validarDescarteAlerta(tipo, payload, actor, origen) {
  if (tipo === 'alerta.descarte_aplicado') {
    exigir(payload.resultado === 'aplicado' && payload.causa === 'operador', 'El descarte aplicado exige causa operador.');
    return;
  }
  const causa = actor === 'runtime' && origen === 'runtime' ? 'vencimiento' : 'operador';
  exigir(payload.resultado === 'revertido' && payload.causa === causa, `La reversión exige causa ${causa}.`);
}

function validarResultadoExterno(tipo, payload) {
  const esCorreo = tipo === 'configuracion.correo_operativo_verificado';
  exigir(payload.sistemaDestino === (esCorreo ? 'smtp' : 'bind'), 'sistemaDestino no coincide con el tipo.');
  const resultado = tipo === 'dns.publicacion_fallida' ? 'fallido' : esCorreo ? 'verificado' : 'aplicado';
  exigir(payload.resultado === resultado, `Resultado externo inválido para ${tipo}.`);
  validarEnumCerrado(tipo, 'codigo', payload.codigo);
  if (esCorreo) {
    exigir(payload.versionRecurso === null && payload.resumen === null, 'El resultado SMTP no admite versión ni resumen.');
    return;
  }
  validarContador(payload.versionRecurso, 'versionRecurso', false);
  exigirObjetoPlano(payload.resumen, 'resumen');
  exigirClavesExactas(payload.resumen, ['zonas', 'artefactos', 'cambios'], 'resumen');
  for (const campo of ['zonas', 'artefactos', 'cambios']) {
    validarContador(payload.resumen[campo], `resumen.${campo}`, true);
  }
}

function validarRetencion(payload) {
  exigir(esClaveCadenaAuditoria(payload.cadenaAfectada), 'cadenaAfectada no es válida.');
  validarContador(payload.secuenciaDesde, 'secuenciaDesde', false);
  validarContador(payload.secuenciaHasta, 'secuenciaHasta', false);
  exigir(BigInt(payload.secuenciaDesde) <= BigInt(payload.secuenciaHasta), 'El intervalo de retención está invertido.');
  exigir(PATRON_HASH_SHA256.test(payload.hashAnteriorAlTramo), 'hashAnteriorAlTramo no es SHA-256 hexadecimal canónico.');
  exigir(PATRON_HASH_SHA256.test(payload.hashHasta), 'hashHasta no es SHA-256 hexadecimal canónico.');
  if (payload.primeraSecuenciaConservada !== null) {
    validarContador(payload.primeraSecuenciaConservada, 'primeraSecuenciaConservada', false);
    exigir(BigInt(payload.primeraSecuenciaConservada) === BigInt(payload.secuenciaHasta) + 1n, 'primeraSecuenciaConservada debe seguir al tramo retirado.');
  }
  exigir(Number.isInteger(payload.dias) && payload.dias >= 1 && payload.dias <= 36500, 'dias debe estar entre 1 y 36500.');
}

function validarIncidente(payload) {
  exigir(PATRON_UUID_V7.test(payload.incidenteId), 'incidenteId debe ser UUIDv7 canónico.');
  exigir(PATRON_HASH_SHA256.test(payload.huella), 'huella debe ser SHA-256 hexadecimal canónico.');
  exigir(payload.estado === 'reconocido', 'incidente_v1 solo admite estado reconocido.');
  if (payload.comentario !== null) {
    exigir(typeof payload.comentario === 'string' && payload.comentario.length > 0, 'El comentario no puede estar vacío.');
    exigir([...payload.comentario].length <= 1000, 'El comentario supera 1000 puntos de código.');
    exigir(Buffer.byteLength(payload.comentario, 'utf8') <= 4096, 'El comentario supera 4096 bytes UTF-8.');
    exigir(!/[<>]/.test(payload.comentario), 'El comentario no admite HTML.');
  }
}

function validarGenesis(payload) {
  exigir(FLUJOS_AUDITORIA.includes(payload.flujo), 'El flujo de génesis no es válido.');
  validarScope(payload.scopeCadena);
  const tenantId = payload.scopeCadena.tenantId;
  exigir(payload.claveCadena === construirClaveCadenaAuditoria({ flujo: payload.flujo, tenantId }), 'La clave de cadena no coincide con flujo y scope.');
  exigirObjetoPlano(payload.versiones, 'versiones');
  exigirClavesExactas(payload.versiones, ['contrato', 'canonicalizador', 'encadenado'], 'versiones');
  exigir(payload.versiones.contrato === 1, 'La génesis v1 exige contrato=1.');
  exigir(typeof payload.versiones.canonicalizador === 'string' && payload.versiones.canonicalizador.length > 0, 'Falta versión del canonicalizador.');
  exigir(typeof payload.versiones.encadenado === 'string' && payload.versiones.encadenado.length > 0, 'Falta versión del encadenado.');
}

function validarControlFederacion(tipo, payload) {
  validarEnumCerrado(tipo, 'accion', payload.accion);
  validarEnumCerrado(tipo, 'resultado', payload.resultado);
  exigir(
    payload.motivoCodigo === null ||
      (typeof payload.motivoCodigo === 'string' &&
        PATRON_CODIGO_FEDERACION.test(payload.motivoCodigo)),
    'motivoCodigo debe ser null o un código cerrado saneado.'
  );
  exigir(
    payload.revisionConcesionId === null ||
      new RegExp(
        `^sfid1\\.revision_concesion\\.${MATERIAL_IDENTIDAD_FEDERADA}$`
      ).test(
        payload.revisionConcesionId
      ),
    'revisionConcesionId no es una identidad canónica.'
  );
  if (tipo === 'federacion.concesion_revisada') {
    exigir(
      payload.revisionConcesionId !== null,
      'La revisión de concesión exige su identidad durable.'
    );
  }
  validarResumenFederacion(payload.resumen);
}

function validarTransporteFederacion(tipo, payload) {
  validarEnumCerrado(tipo, 'direccion', payload.direccion);
  validarEnumCerrado(tipo, 'resultado', payload.resultado);
  validarEnumCerrado(tipo, 'codigo', payload.codigo);
  exigir(
    new RegExp(`^sfid1\\.generacion\\.${MATERIAL_IDENTIDAD_FEDERADA}$`).test(
      payload.generacionId
    ),
    'generacionId no es una identidad canónica.'
  );
  exigir(
    new RegExp(`^sfid1\\.lote\\.${MATERIAL_IDENTIDAD_FEDERADA}$`).test(
      payload.loteId
    ),
    'loteId no es una identidad canónica.'
  );
  exigirObjetoPlano(payload.rango, 'rango');
  exigirClavesExactas(payload.rango, ['desde', 'hasta'], 'rango');
  validarContador(payload.rango.desde, 'rango.desde', false);
  validarContador(payload.rango.hasta, 'rango.hasta', false);
  exigir(
    BigInt(payload.rango.desde) <= BigInt(payload.rango.hasta),
    'El rango auditable de transporte está invertido.'
  );
  exigirObjetoPlano(payload.conteos, 'conteos');
  exigirClavesExactas(
    payload.conteos,
    ['ocurrencias', 'aceptadas', 'rechazadas', 'bytes'],
    'conteos'
  );
  for (const campo of ['ocurrencias', 'aceptadas', 'rechazadas', 'bytes']) {
    validarContador(payload.conteos[campo], `conteos.${campo}`, true);
  }
  exigir(
    BigInt(payload.conteos.aceptadas) + BigInt(payload.conteos.rechazadas) <=
      BigInt(payload.conteos.ocurrencias),
    'Aceptadas y rechazadas no pueden superar las ocurrencias testimoniadas.'
  );
}

function validarAvisoPlataforma(tipo, payload) {
  const operacion = tipo.slice('plataforma.aviso_'.length);
  exigir(payload.operacion === operacion, 'La operación no coincide con el tipo de aviso.');
  for (const campo of ['estadoAntes', 'estadoDespues']) {
    exigir(
      payload[campo] === null ||
        ['pendiente', 'resuelto', 'obsoleto'].includes(payload[campo]),
      `${campo} no pertenece al ciclo cerrado de aviso.`
    );
  }
  for (const campo of ['gravedadAntes', 'gravedadDespues']) {
    exigir(
      payload[campo] === null ||
        ['informativa', 'advertencia', 'critica'].includes(payload[campo]),
      `${campo} no pertenece al catálogo de gravedad.`
    );
  }
  exigir(
    typeof payload.causaCodigo === 'string' &&
      PATRON_CODIGO_FEDERACION.test(payload.causaCodigo),
    'causaCodigo debe ser un código saneado.'
  );
  exigir(
    payload.cicloAnteriorId === null || PATRON_UUID_V7.test(payload.cicloAnteriorId),
    'cicloAnteriorId debe ser null o UUIDv7 canónico.'
  );
  const reglas = {
    abierto: [null, 'pendiente'],
    actualizado: ['pendiente', 'pendiente'],
    resuelto: ['pendiente', 'resuelto'],
    reabierto: ['resuelto', 'pendiente'],
    reconocido: ['pendiente', 'pendiente'],
    ocultado: ['pendiente', 'pendiente']
  };
  const [antes, despues] = reglas[operacion] || [];
  exigir(
    payload.estadoAntes === antes && payload.estadoDespues === despues,
    `La transición de aviso ${operacion} no es válida.`
  );
  if (operacion === 'reabierto') {
    exigir(payload.cicloAnteriorId !== null, 'La reapertura exige el ciclo anterior.');
  }
}

function validarResumenFederacion(resumen) {
  if (resumen === null) return;
  exigirObjetoPlano(resumen, 'resumen');
  exigirClavesExactas(
    resumen,
    ['relacionesAfectadas', 'flujosAfectados', 'proyeccionesAfectadas'],
    'resumen'
  );
  for (const campo of [
    'relacionesAfectadas',
    'flujosAfectados',
    'proyeccionesAfectadas'
  ]) {
    validarContador(resumen[campo], `resumen.${campo}`, true);
  }
}

function validarScope(scope) {
  exigirObjetoPlano(scope, 'scope');
  exigirClavesExactas(scope, ['tenantId', 'empresaId', 'sitioId'], 'scope');
  for (const campo of ['tenantId', 'empresaId', 'sitioId']) {
    exigir(scope[campo] === null || (typeof scope[campo] === 'string' && PATRON_ID_DECIMAL_POSITIVO.test(scope[campo])), `${campo} debe ser null o id decimal canónico.`);
  }
  exigir(scope.tenantId !== null || (scope.empresaId === null && scope.sitioId === null), 'Un scope portal no admite empresa ni sitio.');
  exigir(scope.empresaId !== null || scope.sitioId === null, 'Un sitio exige empresa.');
}

function validarFotografia(tipo, fotografia) {
  const sujeto = obtenerDefinicionTipoEventoAuditoria(tipo).sujetos[0];
  for (const [campo, valor] of Object.entries(fotografia)) {
    validarCampoDato(sujeto, campo);
    exigir(!CAMPOS_PERSONALES_MINIMIZADOS.has(campo), `${campo} no puede conservar su valor histórico.`);
    validarValorAnidadoSeguro(valor, campo);
  }
}

function validarValorAnidadoSeguro(valor, ruta) {
  if (
    valor === null ||
    typeof valor === 'string' ||
    typeof valor === 'boolean' ||
    (typeof valor === 'number' && Number.isFinite(valor))
  ) {
    return;
  }
  if (Array.isArray(valor)) {
    valor.forEach((item, indice) => validarValorAnidadoSeguro(item, `${ruta}[${indice}]`));
    return;
  }
  exigirObjetoPlano(valor, ruta);
  for (const [clave, hijo] of Object.entries(valor)) {
    exigir(CLAVES_ANIDADAS_SEGURAS.has(clave), `La propiedad anidada ${ruta}.${clave} no está permitida.`);
    validarValorAnidadoSeguro(hijo, `${ruta}.${clave}`);
  }
}

function validarCampoDato(sujeto, campo) {
  exigir(typeof campo === 'string' && PATRON_CLAVE_DATO.test(campo), `Clave de dato inválida: ${campo}.`);
  if (sujeto === 'usuario' && campo.startsWith('permiso')) {
    return;
  }
  if (sujeto === 'configuracion_portal') {
    exigir(!CLAVES_CONFIGURACION_DESPLIEGUE_PROHIBIDAS.has(campo), `La configuración ${campo} pertenece al despliegue.`);
    exigir(!campo.startsWith('dns.comando_') && !campo.startsWith('BIND_'), `La configuración ${campo} pertenece al despliegue BIND.`);
    exigir(
      CLAVES_CONFIGURACION_AUDITABLES.has(campo),
      `La configuración ${campo} no pertenece a la allowlist auditable o es sensible.`
    );
    return;
  }
  exigir(CAMPOS_DATOS_POR_SUJETO[sujeto]?.includes(campo), `${campo} no está permitido para ${sujeto}.`);
}

function validarEnumCerrado(tipo, campo, valor) {
  const permitidos = ENUMS_CERRADOS_POR_TIPO[tipo]?.[campo];
  exigir(permitidos && permitidos.includes(valor), `${campo} no pertenece al enum de ${tipo}.`);
  if (valor !== null) {
    exigir(PATRON_CODIGO.test(valor), `${campo} no usa el formato de código cerrado.`);
  }
}

function validarDdns(tipo, payload) {
  const resultados = {
    'ddns.concesion_creada': ['creada'],
    'ddns.concesion_revocada': ['revocada'],
    'ddns.concesion_scope_actualizado': ['scope_actualizado'],
    'ddns.intencion_aceptada': ['aceptada'],
    'ddns.contenido_deseado_persistido': ['persistido'],
    'ddns.publicacion_bloqueada': ['bloqueada'],
    'ddns.publicacion_fallida': ['fallida'],
    'ddns.contenido_publicado': ['publicado'],
    'ddns.intencion_terminada': [
      'publicada', 'sustituida', 'publicacion_fallida',
      'objetivo_incompatible', 'objetivo_eliminado'
    ]
  }[tipo];
  exigir(resultados?.includes(payload.resultado), `resultado no pertenece al catálogo de ${tipo}.`);
  exigir(
    payload.tipoRegistro === null || ['A', 'AAAA', 'CNAME', 'MX'].includes(payload.tipoRegistro),
    'tipoRegistro DDNS no válido.'
  );
  exigir(
    payload.modo === null || ['observada', 'declarada'].includes(payload.modo),
    'modo DDNS no válido.'
  );
  for (const campo of ['estadoAnterior', 'estadoPosterior']) {
    exigir(
      payload[campo] === null ||
        (typeof payload[campo] === 'string' && payload[campo].length <= 4096),
      `${campo} debe ser null o una fotografía canónica acotada.`
    );
  }
  validarContador(payload.versionDdns, 'versionDdns', true);
  exigir(
    payload.origenIntencion === null ||
      ['agente_explicita', 'pol_observada', 'usuario'].includes(payload.origenIntencion),
    'origenIntencion DDNS no válido.'
  );
  if (payload.generacionDns !== null) {
    validarContador(payload.generacionDns, 'generacionDns', false);
  }
  exigir(
    payload.causa === null ||
      (typeof payload.causa === 'string' && PATRON_CODIGO.test(payload.causa)),
    'causa DDNS no válida.'
  );
  for (const campo of ['agenteId', 'registroDnsId']) {
    exigir(
      payload[campo] === null || PATRON_ID_DECIMAL_POSITIVO.test(payload[campo]),
      `${campo} debe ser null o decimal canónico positivo.`
    );
  }
  exigir(
    payload.extremo === null || ['agente', 'registro'].includes(payload.extremo),
    'extremo DDNS no válido.'
  );
}

function validarContadoresPorClase(valor, clases, nombre) {
  exigirObjetoPlano(valor, nombre);
  for (const [clase, contador] of Object.entries(valor)) {
    exigir(clases.includes(clase), `La clase ${clase} no está permitida en ${nombre}.`);
    validarContador(contador, `${nombre}.${clase}`, false);
  }
}

function validarContador(valor, nombre, admiteCero) {
  exigir(typeof valor === 'string' && /^(0|[1-9][0-9]*)$/.test(valor), `${nombre} debe ser un string decimal canónico.`);
  const numero = BigInt(valor);
  exigir(numero <= MAX_BIGINT_UNSIGNED, `${nombre} supera BIGINT UNSIGNED.`);
  exigir(admiteCero || numero > 0n, `${nombre} debe ser positivo.`);
}

function exigirClavesExactas(objeto, esperadas, nombre) {
  const actuales = Object.keys(objeto).sort();
  const objetivo = [...esperadas].sort();
  exigir(actuales.length === objetivo.length && actuales.every((clave, indice) => clave === objetivo[indice]), `${nombre} contiene campos ausentes o desconocidos.`);
}

function exigirObjetoPlano(valor, nombre) {
  exigir(valor !== null && typeof valor === 'object' && !Array.isArray(valor) && Object.getPrototypeOf(valor) === Object.prototype, `${nombre} debe ser un objeto JSON plano.`);
}

function compararUtf8(a, b) {
  exigir(typeof a === 'string' && typeof b === 'string', 'Las claves deben ser strings.');
  return Buffer.compare(Buffer.from(a, 'utf8'), Buffer.from(b, 'utf8'));
}

function exigir(condicion, mensaje) {
  if (!condicion) {
    throw new Error(mensaje);
  }
}

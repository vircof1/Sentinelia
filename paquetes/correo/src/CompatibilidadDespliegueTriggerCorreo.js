import { PERFIL_CONTRATO_TRIGGER_CORREO }
  from './ContratoTriggerCorreo.js';

export const PERFIL_DESPLIEGUE_TRIGGER_CORREO =
  PERFIL_CONTRATO_TRIGGER_CORREO;

export const MIGRACIONES_TRIGGER_CORREO = Object.freeze([
  '0001_esquema_inicial.sql'
]);

export const CAPACIDADES_RUNTIME_TRIGGER_CORREO = Object.freeze([
  'tipo_configuracion_renderizador_correo_v1',
  'aceptacion_sql_atomica_v1',
  'cola_claim_intento_sql_v1',
  'reconciliacion_reclamaciones_ambiguas_v1',
  'retencion_especializada_correo_v1',
  'bajas_audiencia_conscientes_v1'
]);

export const CAPACIDADES_WEB_TRIGGER_CORREO = Object.freeze([
  'origen_publico_neutral_v1',
  'smtp_hmac_admision_v1',
  'audiencia_scope_redaccion_v1',
  'revision_declaracion_optimista_v1',
  'desuscripcion_publica_v1',
  'administracion_lectura_especializada_v1',
  'federacion_informativa_correo_v1'
]);

const CODIGOS_TRANSITORIOS = new Set([
  'runtime_compatible_ausente',
  'runtime_capacidad_ausente'
]);

export class ErrorCompatibilidadDespliegueTriggerCorreo extends Error {
  constructor(codigo, mensaje, detalle = null) {
    super(mensaje);
    this.name = 'ErrorCompatibilidadDespliegueTriggerCorreo';
    this.codigo = codigo;
    this.detalle = detalle;
  }
}

export class RepositorioPreparacionDespliegueTriggerCorreoSql {
  constructor(clienteSql) {
    if (typeof clienteSql?.consultar !== 'function') {
      throw new Error('La preparación del trigger de correo requiere SQL operativo.');
    }
    this.clienteSql = clienteSql;
  }

  async fotografiar() {
    const [estado] = await this.clienteSql.consultar(
      `SELECT * FROM estado_despliegue_trigger_correo WHERE id=1`
    );
    if (!estado) {
      throw new ErrorCompatibilidadDespliegueTriggerCorreo(
        'cabecera_despliegue_ausente',
        'No existe la cabecera de despliegue del trigger de correo.'
      );
    }
    const [conteos] = await this.clienteSql.consultar(
      `SELECT
         (SELECT COUNT(*) FROM triggers WHERE tipo='correo') AS triggers_correo,
         (SELECT COUNT(*) FROM notificaciones_triggers_correo) AS notificaciones,
         (SELECT COUNT(*) FROM resultados_destinatarios_triggers_correo) AS resultados,
         (SELECT COUNT(*) FROM cola_correos_salida WHERE origen_tipo='trigger') AS salidas_trigger,
         (SELECT COUNT(*) FROM intentos_correos_salida) AS intentos_smtp`
    );
    return Object.freeze({
      estado: Object.freeze({ ...estado }),
      conteos: Object.freeze(Object.fromEntries(
        Object.entries(conteos || {}).map(([clave, valor]) => [clave, Number(valor)])
      ))
    });
  }
}

export function evaluarPreparacionLocalTriggerCorreo({
  migracionesAplicadas = [],
  postcondicionesMigracionesVerificadas = false,
  fotografia
} = {}) {
  const aplicadas = new Set([...migracionesAplicadas].map(texto));
  const ausentes = MIGRACIONES_TRIGGER_CORREO.filter((nombre) => !aplicadas.has(nombre));
  exigir(ausentes.length === 0, 'migraciones_correo_ausentes',
    'No están aplicadas todas las migraciones del trigger de correo.', ausentes);
  exigir(postcondicionesMigracionesVerificadas === true,
    'postcondiciones_correo_no_verificadas',
    'Las postcondiciones de las migraciones de correo no están verificadas.');
  const estado = fotografia?.estado;
  exigir(estado && typeof estado === 'object', 'cabecera_despliegue_ausente',
    'No existe una fotografía de despliegue de correo.');
  exigir(texto(estado.perfil_objetivo) === PERFIL_DESPLIEGUE_TRIGGER_CORREO,
    'perfil_objetivo_correo_incompatible',
    'La cabecera SQL declara otro perfil objetivo de correo.');
  const etapa = texto(estado.estado);
  exigir([
    'preparacion', 'corte_origen', 'corte_verificacion', 'quietud_cola', 'activado'
  ].includes(etapa),
    'estado_despliegue_correo_incompatible',
    'La presencia no reconoce la etapa durable de despliegue de correo.');
  const gateTipo = Number(estado.tipo_correo_habilitado);
  exigir(gateTipo === 0 || (etapa === 'activado' && gateTipo === 1),
    'gate_correo_abierto_anticipadamente',
    'El tipo correo solo puede abrirse después de todos los cortes.');
  exigir(
    Number(estado.origen_portal_autoritativo) ===
      (etapa === 'preparacion' ? 0 : 1),
    'autoridad_origen_correo_incoherente',
    'La fuente autoritativa del origen no coincide con la etapa durable.'
  );
  exigir(Number(estado.cola_sql_autoritativa) === (etapa === 'activado' ? 1 : 0),
    'autoridad_cola_correo_incoherente',
    'La autoridad SQL de cola no coincide con la etapa durable.');
  const guardRevision = Number(estado.guard_revision_trigger_activo);
  exigir(
    (etapa === 'preparacion' && guardRevision === 0) ||
      (etapa === 'corte_origen' && [0, 1].includes(guardRevision)) ||
      (['corte_verificacion', 'quietud_cola', 'activado'].includes(etapa) &&
        guardRevision === 1),
    'guard_revision_correo_incoherente',
    'El guard de revisión no es coherente con el corte del origen.'
  );
  const smtpEsperado = ['corte_verificacion', 'quietud_cola', 'activado']
    .includes(etapa) ? 1 : 0;
  const gatesSmtpIncoherentes = [
    'guard_metadatos_activo',
    'verificacion_smtp_autoritativa',
    'guard_verificacion_legacy_activo'
  ].filter((clave) => Number(estado[clave]) !== smtpEsperado);
  exigir(gatesSmtpIncoherentes.length === 0,
    'autoridad_smtp_correo_incoherente',
    'Los gates SMTP no coinciden con la etapa durable.',
    gatesSmtpIncoherentes);
  const filasIncoherentes = Object.entries(fotografia?.conteos || {})
    .filter(([, total]) => Number(total) !== 0)
    .map(([tabla]) => tabla);
  exigir(etapa === 'activado' || filasIncoherentes.length === 0,
    'filas_correo_anticipadas',
    'Existen filas productivas de correo antes de abrir su autoridad.',
    filasIncoherentes);
  return Object.freeze({
    preparada: true,
    perfil: PERFIL_DESPLIEGUE_TRIGGER_CORREO,
    estado: etapa,
    gateAbierto: gateTipo === 1,
    migracionesVerificadas: MIGRACIONES_TRIGGER_CORREO.length,
    filasCorreoProductivas: Object.values(fotografia?.conteos || {})
      .reduce((total, valor) => total + Number(valor || 0), 0)
  });
}

export function crearDeclaracionCompatibilidadRuntimeTriggerCorreo({
  instanciaId,
  preparacionLocal
} = {}) {
  exigir(preparacionLocal?.preparada === true &&
      typeof preparacionLocal.gateAbierto === 'boolean',
    'preparacion_runtime_correo_incompleta',
    'El runtime no puede declarar correo sin preparación local coherente.');
  const id = texto(instanciaId);
  exigir(Boolean(id), 'instancia_runtime_correo_invalida',
    'La declaración runtime de correo requiere instanciaId.');
  return Object.freeze({
    familia: 'trigger_correo',
    perfil: PERFIL_DESPLIEGUE_TRIGGER_CORREO,
    instanciaId: id,
    estadoPreparacion: preparacionLocal.estado,
    gateAbierto: preparacionLocal.gateAbierto,
    capacidades: CAPACIDADES_RUNTIME_TRIGGER_CORREO,
    capacidadesWebEmpaquetadas: CAPACIDADES_WEB_TRIGGER_CORREO
  });
}

export function evaluarUnanimidadPreparacionTriggerCorreo({
  preparacionLocal,
  capacidadesWeb = [],
  instanciasRuntime = []
} = {}) {
  exigir(preparacionLocal?.preparada === true &&
      typeof preparacionLocal.gateAbierto === 'boolean',
    'preparacion_web_correo_incompleta',
    'La presencia web no ha demostrado un estado local coherente de correo.');
  exigirCapacidades(capacidadesWeb, CAPACIDADES_WEB_TRIGGER_CORREO,
    'web_capacidad_correo_ausente');
  exigir(Array.isArray(instanciasRuntime) && instanciasRuntime.length > 0,
    'runtime_compatible_ausente',
    'No existe una presencia runtime viva que declare el perfil de correo.');
  for (const instancia of instanciasRuntime) {
    const instanciaId = texto(instancia?.instanciaId) || null;
    const declaracion = instancia?.capacidadesDespliegue?.triggerCorreo;
    exigir(declaracion && typeof declaracion === 'object',
      'runtime_capacidad_ausente',
      'Una presencia runtime viva no declara el perfil de correo.', instanciaId);
    exigir(texto(declaracion.perfil) === PERFIL_DESPLIEGUE_TRIGGER_CORREO,
      'despliegue_mixto_correo_rechazado',
      'Una presencia runtime viva declara otro perfil de correo.', instanciaId);
    exigir([
      'preparacion', 'corte_origen', 'corte_verificacion', 'quietud_cola', 'activado'
    ]
      .includes(declaracion.estadoPreparacion) &&
      typeof declaracion.gateAbierto === 'boolean',
    'runtime_estado_correo_incompatible',
    'Una presencia runtime no conserva cerrado el gate de preparación.', instanciaId);
    exigirCapacidades(declaracion.capacidades,
      CAPACIDADES_RUNTIME_TRIGGER_CORREO,
      'runtime_capacidad_correo_incompleta', instanciaId);
    exigirCapacidades(declaracion.capacidadesWebEmpaquetadas,
      CAPACIDADES_WEB_TRIGGER_CORREO,
      'web_despliegue_mixto_correo_rechazado', instanciaId);
  }
  return Object.freeze({
    preparada: true,
    unanimidad: true,
    perfil: PERFIL_DESPLIEGUE_TRIGGER_CORREO,
    estado: preparacionLocal.estado,
    gateAbierto: preparacionLocal.gateAbierto,
    instanciasRuntimeCompatibles: instanciasRuntime.length,
    instanciasWebCompatibles: instanciasRuntime.length
  });
}

export async function resolverUnanimidadPreparacionTriggerCorreo({
  preparacionLocal,
  capacidadesWeb = [],
  clienteRedis,
  prefijoRuntime,
  entorno,
  esperaMaximaMs = 60_000,
  intervaloMs = 250
} = {}) {
  if (typeof clienteRedis?.get !== 'function') {
    throw new Error('La unanimidad del trigger de correo requiere Redis.');
  }
  const limite = Date.now() + enteroNoNegativo(esperaMaximaMs, 'esperaMaximaMs');
  const pausa = Math.max(10, enteroNoNegativo(intervaloMs, 'intervaloMs'));
  while (true) {
    const instanciasRuntime = await listarPresenciasRuntime({
      clienteRedis, prefijoRuntime, entorno
    });
    try {
      return evaluarUnanimidadPreparacionTriggerCorreo({
        preparacionLocal, capacidadesWeb, instanciasRuntime
      });
    } catch (error) {
      if (!(error instanceof ErrorCompatibilidadDespliegueTriggerCorreo) ||
          !CODIGOS_TRANSITORIOS.has(error.codigo) || Date.now() >= limite) {
        throw error;
      }
      await esperar(pausa);
    }
  }
}

async function listarPresenciasRuntime({ clienteRedis, prefijoRuntime, entorno }) {
  const patron = `${texto(prefijoRuntime)}instancias:*:presencia`;
  let claves = [];
  if (typeof clienteRedis.scanIterator === 'function') {
    for await (const entrada of clienteRedis.scanIterator({ MATCH: patron, COUNT: 100 })) {
      claves.push(...(Array.isArray(entrada) ? entrada : [entrada]));
    }
  } else if (typeof clienteRedis.keys === 'function') {
    claves = await clienteRedis.keys(patron);
  } else {
    throw new Error('Redis no permite enumerar presencias runtime.');
  }
  const presencias = [];
  for (const clave of [...new Set(claves.map(texto).filter(Boolean))].sort()) {
    const serializada = await clienteRedis.get(clave);
    if (!serializada) continue;
    try {
      const presencia = JSON.parse(serializada);
      if (texto(presencia?.entorno) === texto(entorno)) presencias.push(presencia);
    } catch {
      throw new ErrorCompatibilidadDespliegueTriggerCorreo(
        'presencia_runtime_invalida',
        'Una presencia runtime viva no contiene JSON válido.', clave);
    }
  }
  return presencias;
}

function exigirCapacidades(actuales, requeridas, codigo, detalle = null) {
  const catalogo = new Set(Array.isArray(actuales) ? actuales.map(texto) : []);
  const ausentes = requeridas.filter((capacidad) => !catalogo.has(capacidad));
  exigir(ausentes.length === 0, codigo,
    'La presencia no declara todas las capacidades requeridas.',
    detalle === null ? ausentes : { instanciaId: detalle, ausentes });
}

function exigir(condicion, codigo, mensaje, detalle = null) {
  if (!condicion) {
    throw new ErrorCompatibilidadDespliegueTriggerCorreo(codigo, mensaje, detalle);
  }
}

function texto(valor) {
  return String(valor ?? '').trim();
}

function enteroNoNegativo(valor, campo) {
  const numero = Number(valor);
  if (!Number.isSafeInteger(numero) || numero < 0) {
    throw new Error(`${campo} debe ser un entero no negativo.`);
  }
  return numero;
}

function esperar(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

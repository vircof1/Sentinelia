export const CAPACIDADES_WEB_RECUPERACION_PASSWORD_EMAIL = Object.freeze([
  'inicio_publico_uniforme_v1',
  'continuacion_bearer_pasiva_v1',
  'resolucion_agnostica_v1',
  'sustitucion_credencial_v1',
  'disponibilidad_derivada_v1'
]);

export const CAPACIDADES_RUNTIME_RECUPERACION_PASSWORD_EMAIL = Object.freeze([
  'activacion_emision_preparada_v1',
  'despacho_revalidado_v1',
  'retencion_salida_v1'
]);

export const MIGRACIONES_RECUPERACION_PASSWORD_EMAIL = Object.freeze([
  '0001_esquema_inicial.sql'
]);

const PARAMETROS_RECUPERACION = Object.freeze([
  'recuperacionEmailActiva',
  'recuperacionEmailVigenciaSegundos',
  'recuperacionEmailAlegacionesMaximas',
  'recuperacionEmailOrigenVentanaSegundos',
  'recuperacionEmailOrigenIntentosMaximos',
  'recuperacionEmailParVentanaSegundos',
  'recuperacionEmailParIntentosMaximos',
  'recuperacionEmailGlobalVentanaSegundos',
  'recuperacionEmailGlobalIntentosMaximos',
  'recuperacionEmailJitterMaximoMs',
  'recuperacionEmailLeasePreparacionSegundos',
  'recuperacionEmailLeaseAlegacionSegundos',
  'recuperacionEmailLeaseConsumoSegundos'
]);

export class ErrorCompatibilidadDespliegueRecuperacionPasswordEmail extends Error {
  constructor(codigo, mensaje, detalle = null) {
    super(mensaje);
    this.name = 'ErrorCompatibilidadDespliegueRecuperacionPasswordEmail';
    this.codigo = codigo;
    this.detalle = detalle;
  }
}

export function evaluarPreparacionLocalRecuperacionPasswordEmail({
  migracionesAplicadas = [],
  postcondicionesMigracionesVerificadas = false,
  configuracionUsuarios = {},
  colaCorreoPreparada = false,
  keyringTecnicoCorreo,
  capacidadesWeb = []
} = {}) {
  const aplicadas = new Set([...migracionesAplicadas].map(String));
  exigir(
    MIGRACIONES_RECUPERACION_PASSWORD_EMAIL.every((item) => aplicadas.has(item)),
    'migraciones_recuperacion_ausentes',
    'No están aplicadas todas las migraciones de recuperación.'
  );
  exigir(
    postcondicionesMigracionesVerificadas === true,
    'postcondiciones_migraciones_no_verificadas',
    'Las postcondiciones de migración no están verificadas.'
  );
  const parametrosAusentes = PARAMETROS_RECUPERACION.filter((clave) =>
    !Object.hasOwn(configuracionUsuarios, clave));
  exigir(
    parametrosAusentes.length === 0,
    'configuracion_recuperacion_incompleta',
    'La configuración durable de recuperación está incompleta.',
    parametrosAusentes
  );
  exigir(
    colaCorreoPreparada === true,
    'cola_correo_no_preparada',
    'La cola SQL de correo todavía no posee autoridad completa.'
  );
  const idsKeyring = typeof keyringTecnicoCorreo?.listarIds === 'function'
    ? keyringTecnicoCorreo.listarIds()
    : [];
  exigir(
    Boolean(keyringTecnicoCorreo?.keyIdActiva) &&
      idsKeyring.includes(keyringTecnicoCorreo.keyIdActiva),
    'keyring_correo_no_preparado',
    'El keyring técnico de correo no dispone de clave activa.'
  );
  exigirCapacidades(
    capacidadesWeb,
    CAPACIDADES_WEB_RECUPERACION_PASSWORD_EMAIL,
    'web_capacidad_recuperacion_ausente'
  );
  return Object.freeze({
    preparada: true,
    familia: 'recuperacion_password_email',
    versionContrato: 1,
    capacidadesWeb: CAPACIDADES_WEB_RECUPERACION_PASSWORD_EMAIL
  });
}

export function evaluarUnanimidadRecuperacionPasswordEmail({
  preparacionLocal,
  instanciasRuntime = []
} = {}) {
  exigir(
    preparacionLocal?.preparada === true,
    'preparacion_web_recuperacion_incompleta',
    'La web no declara preparación local de recuperación.'
  );
  exigir(
    Array.isArray(instanciasRuntime) && instanciasRuntime.length > 0,
    'runtime_compatible_ausente',
    'No existe ninguna presencia runtime viva compatible.'
  );
  for (const presencia of instanciasRuntime) {
    const instanciaId = String(presencia?.instanciaId ?? '').trim() || null;
    const declaracion = presencia?.capacidadesDespliegue
      ?.recuperacionPasswordEmail;
    exigir(
      declaracion?.familia === 'recuperacion_password_email' &&
        Number(declaracion?.versionContrato) === 1 &&
        declaracion?.rol === 'runtime' &&
        declaracion?.instanciaId === instanciaId,
      'runtime_capacidad_recuperacion_ausente',
      'Una presencia runtime viva no declara recuperación compatible.',
      instanciaId
    );
    exigirCapacidades(
      declaracion.capacidades,
      CAPACIDADES_RUNTIME_RECUPERACION_PASSWORD_EMAIL,
      'runtime_capacidad_recuperacion_incompleta',
      instanciaId
    );
    exigirCapacidades(
      declaracion.capacidadesWebEmpaquetadas,
      CAPACIDADES_WEB_RECUPERACION_PASSWORD_EMAIL,
      'web_despliegue_recuperacion_mixto',
      instanciaId
    );
  }
  return Object.freeze({
    unanimidad: true,
    familia: 'recuperacion_password_email',
    versionContrato: 1,
    instanciasRuntimeCompatibles: instanciasRuntime.length
  });
}

export async function resolverUnanimidadRecuperacionPasswordEmail({
  preparacionLocal,
  clienteRedis,
  prefijoRuntime,
  entorno
} = {}) {
  if (typeof clienteRedis?.get !== 'function') {
    throw new Error('La unanimidad de recuperación requiere Redis operativo.');
  }
  const patron = `${String(prefijoRuntime ?? '').trim()}instancias:*:presencia`;
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
  const instanciasRuntime = [];
  for (const clave of [...new Set(claves.map(String))].sort()) {
    const serializada = await clienteRedis.get(clave);
    if (!serializada) continue;
    let presencia;
    try {
      presencia = JSON.parse(serializada);
    } catch {
      throw new ErrorCompatibilidadDespliegueRecuperacionPasswordEmail(
        'presencia_runtime_invalida',
        'Una presencia runtime viva no contiene JSON válido.',
        clave
      );
    }
    if (String(presencia?.entorno ?? '').trim() === String(entorno ?? '').trim()) {
      instanciasRuntime.push(presencia);
    }
  }
  return evaluarUnanimidadRecuperacionPasswordEmail({
    preparacionLocal,
    instanciasRuntime
  });
}

export function crearDeclaracionCapacidadesWebRecuperacionPasswordEmail({
  instanciaId
} = {}) {
  return crearDeclaracion({
    instanciaId,
    rol: 'web',
    capacidades: CAPACIDADES_WEB_RECUPERACION_PASSWORD_EMAIL
  });
}

export function crearDeclaracionCapacidadesRuntimeRecuperacionPasswordEmail({
  instanciaId
} = {}) {
  return crearDeclaracion({
    instanciaId,
    rol: 'runtime',
    capacidades: CAPACIDADES_RUNTIME_RECUPERACION_PASSWORD_EMAIL,
    capacidadesWebEmpaquetadas: CAPACIDADES_WEB_RECUPERACION_PASSWORD_EMAIL
  });
}

function crearDeclaracion({
  instanciaId,
  rol,
  capacidades,
  capacidadesWebEmpaquetadas = null
}) {
  const id = String(instanciaId ?? '').trim();
  if (!id) {
    throw new Error(`La declaración ${rol} de recuperación requiere instanciaId.`);
  }
  return Object.freeze({
    familia: 'recuperacion_password_email',
    versionContrato: 1,
    rol,
    instanciaId: id,
    capacidades,
    ...(capacidadesWebEmpaquetadas
      ? { capacidadesWebEmpaquetadas }
      : {})
  });
}

function exigirCapacidades(actuales, requeridas, codigo, detalle = null) {
  const catalogo = new Set(Array.isArray(actuales) ? actuales.map(String) : []);
  const ausentes = requeridas.filter((capacidad) => !catalogo.has(capacidad));
  exigir(
    ausentes.length === 0,
    codigo,
    `Faltan capacidades requeridas: ${ausentes.join(', ')}.`,
    detalle
  );
}

function exigir(condicion, codigo, mensaje, detalle = null) {
  if (!condicion) {
    throw new ErrorCompatibilidadDespliegueRecuperacionPasswordEmail(
      codigo,
      mensaje,
      detalle
    );
  }
}

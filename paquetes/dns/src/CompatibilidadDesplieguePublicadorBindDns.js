export const PERFIL_DESPLIEGUE_PUBLICADOR_BIND_DNS = 'publicador_bind_coordinado@1';

export const CAPACIDADES_RUNTIME_PUBLICADOR_BIND_DNS = Object.freeze([
  'generacion_sql_autoritativa_v1',
  'lease_fencing_bind_v1',
  'recarga_confirmada_durable_v1',
  'recuperacion_efecto_incierto_v1',
  'legado_sin_autoridad_v1',
  'manifiesto_diagnostico_registros_v1',
  'consolidacion_ddns_publicada_v1',
  'presupuesto_ddns_atribuible_v1',
  'bloqueo_global_ddns_v1'
]);

export class ErrorCompatibilidadDesplieguePublicadorBindDns extends Error {
  constructor(codigo, mensaje, detalle = null) {
    super(mensaje);
    this.name = 'ErrorCompatibilidadDesplieguePublicadorBindDns';
    this.codigo = codigo;
    this.detalle = detalle;
  }
}

export function crearDeclaracionCompatibilidadRuntimePublicadorBindDns({
  instanciaId,
  coordinadoActivo
} = {}) {
  const id = texto(instanciaId);
  exigir(Boolean(id), 'instancia_runtime_bind_invalida',
    'La declaración del publicador BIND requiere instanciaId.');
  return Object.freeze({
    familia: 'publicador_bind_dns',
    perfil: PERFIL_DESPLIEGUE_PUBLICADOR_BIND_DNS,
    instanciaId: id,
    coordinadoActivo: coordinadoActivo === true,
    capacidades: CAPACIDADES_RUNTIME_PUBLICADOR_BIND_DNS
  });
}

export function evaluarUnanimidadPublicadorBindDns({ instanciasRuntime = [] } = {}) {
  exigir(Array.isArray(instanciasRuntime) && instanciasRuntime.length > 0,
    'runtime_bind_compatible_ausente',
    'No existe una presencia runtime viva compatible con el publicador BIND.');
  for (const instancia of instanciasRuntime) {
    const instanciaId = texto(instancia?.instanciaId) || null;
    const declaracion = instancia?.capacidadesDespliegue?.publicadorBindDns;
    exigir(declaracion && typeof declaracion === 'object',
      'despliegue_mixto_bind_rechazado',
      'Una presencia runtime viva no declara el perfil del publicador BIND.', instanciaId);
    exigir(texto(declaracion.perfil) === PERFIL_DESPLIEGUE_PUBLICADOR_BIND_DNS &&
      declaracion.coordinadoActivo === true,
    'despliegue_mixto_bind_rechazado',
    'Una presencia runtime viva conserva autoridad de publicación legado.', instanciaId);
    const capacidades = new Set(
      Array.isArray(declaracion.capacidades) ? declaracion.capacidades.map(texto) : []
    );
    const ausentes = CAPACIDADES_RUNTIME_PUBLICADOR_BIND_DNS
      .filter((capacidad) => !capacidades.has(capacidad));
    exigir(ausentes.length === 0, 'runtime_capacidad_bind_incompleta',
      'Una presencia runtime no declara todas las capacidades BIND coordinadas.',
      { instanciaId, ausentes });
  }
  return Object.freeze({
    unanimidad: true,
    perfil: PERFIL_DESPLIEGUE_PUBLICADOR_BIND_DNS,
    instanciasRuntimeCompatibles: instanciasRuntime.length
  });
}

export async function resolverUnanimidadPublicadorBindDns({
  clienteRedis,
  prefijoRuntime,
  entorno
} = {}) {
  if (typeof clienteRedis?.get !== 'function') {
    throw new Error('La unanimidad del publicador BIND requiere Redis.');
  }
  const patron = `${texto(prefijoRuntime)}instancias:*:presencia`;
  const claves = [];
  if (typeof clienteRedis.scanIterator === 'function') {
    for await (const entrada of clienteRedis.scanIterator({ MATCH: patron, COUNT: 100 })) {
      claves.push(...(Array.isArray(entrada) ? entrada : [entrada]));
    }
  } else if (typeof clienteRedis.keys === 'function') {
    claves.push(...await clienteRedis.keys(patron));
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
      throw new ErrorCompatibilidadDesplieguePublicadorBindDns(
        'presencia_runtime_bind_invalida',
        'Una presencia runtime viva no contiene JSON válido.',
        clave
      );
    }
  }
  return evaluarUnanimidadPublicadorBindDns({ instanciasRuntime: presencias });
}

function exigir(condicion, codigo, mensaje, detalle = null) {
  if (!condicion) {
    throw new ErrorCompatibilidadDesplieguePublicadorBindDns(codigo, mensaje, detalle);
  }
}

function texto(valor) {
  return String(valor ?? '').trim();
}

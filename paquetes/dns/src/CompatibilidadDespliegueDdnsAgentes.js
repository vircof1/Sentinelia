import { evaluarUnanimidadPublicadorBindDns }
  from './CompatibilidadDesplieguePublicadorBindDns.js';

export const PERFIL_DESPLIEGUE_DDNS_AGENTES = 'ddns_agentes@1';

export const MIGRACIONES_DDNS_AGENTES = Object.freeze([
  '0001_esquema_inicial.sql'
]);

export const CAPACIDADES_WEB_DDNS_AGENTES = Object.freeze([
  'contrato_ddns_agentes_v1',
  'api_ddns_agentes_v1',
  'administracion_ddns_agentes_v1',
  'direccion_remota_confiable_ddns_v1'
]);

export const CAPACIDADES_RUNTIME_DDNS_AGENTES = Object.freeze([
  'fanout_pol_ddns_v1',
  'trabajador_publicacion_ddns_v1',
  'publicador_bind_coordinado_ddns_v1',
  'consolidacion_resultados_ddns_v1'
]);

export class ErrorCompatibilidadDespliegueDdnsAgentes extends Error {
  constructor(codigo, mensaje, detalle = null) {
    super(mensaje);
    this.name = 'ErrorCompatibilidadDespliegueDdnsAgentes';
    this.codigo = codigo;
    this.detalle = detalle;
  }
}

export function evaluarPreparacionLocalDdnsAgentes({
  migracionesAplicadas = [],
  postcondicionesMigracionesVerificadas = false,
  capacidadesWeb = []
} = {}) {
  const aplicadas = new Set([...migracionesAplicadas].map(texto));
  const migracionesAusentes = MIGRACIONES_DDNS_AGENTES.filter(
    (migracion) => !aplicadas.has(migracion)
  );
  exigir(
    migracionesAusentes.length === 0,
    'migraciones_ddns_ausentes',
    'No están aplicadas todas las migraciones DDNS.',
    migracionesAusentes
  );
  exigir(
    postcondicionesMigracionesVerificadas === true,
    'postcondiciones_ddns_no_verificadas',
    'Las postcondiciones de las migraciones DDNS no están verificadas.'
  );
  exigirCapacidades(
    capacidadesWeb,
    CAPACIDADES_WEB_DDNS_AGENTES,
    'web_capacidad_ddns_ausente'
  );
  return Object.freeze({
    preparada: true,
    perfil: PERFIL_DESPLIEGUE_DDNS_AGENTES,
    capacidadesWeb: CAPACIDADES_WEB_DDNS_AGENTES,
    migracionesVerificadas: MIGRACIONES_DDNS_AGENTES.length
  });
}

export function crearDeclaracionCompatibilidadRuntimeDdnsAgentes({
  instanciaId
} = {}) {
  const id = texto(instanciaId);
  exigir(
    Boolean(id),
    'instancia_runtime_ddns_invalida',
    'La declaración runtime DDNS requiere instanciaId.'
  );
  return Object.freeze({
    familia: 'ddns_agentes',
    perfil: PERFIL_DESPLIEGUE_DDNS_AGENTES,
    instanciaId: id,
    capacidades: CAPACIDADES_RUNTIME_DDNS_AGENTES,
    capacidadesWebEmpaquetadas: CAPACIDADES_WEB_DDNS_AGENTES
  });
}

export function evaluarUnanimidadDdnsAgentes({
  preparacionLocal,
  instanciasRuntime = []
} = {}) {
  exigir(
    preparacionLocal?.preparada === true &&
      texto(preparacionLocal?.perfil) === PERFIL_DESPLIEGUE_DDNS_AGENTES,
    'preparacion_web_ddns_incompleta',
    'La web no ha demostrado preparación local DDNS compatible.'
  );
  exigir(
    Array.isArray(instanciasRuntime) && instanciasRuntime.length > 0,
    'runtime_ddns_compatible_ausente',
    'No existe ninguna presencia runtime viva compatible con DDNS.'
  );
  for (const presencia of instanciasRuntime) {
    const instanciaId = texto(presencia?.instanciaId) || null;
    const declaracion = presencia?.capacidadesDespliegue?.ddnsAgentes;
    exigir(
      declaracion && typeof declaracion === 'object' && !Array.isArray(declaracion),
      'runtime_capacidad_ddns_ausente',
      'Una presencia runtime viva no declara capacidad DDNS.',
      instanciaId
    );
    exigir(
      declaracion.familia === 'ddns_agentes' &&
        texto(declaracion.perfil) === PERFIL_DESPLIEGUE_DDNS_AGENTES &&
        texto(declaracion.instanciaId) === instanciaId,
      'despliegue_mixto_ddns_rechazado',
      'Una presencia runtime viva declara otro perfil DDNS.',
      instanciaId
    );
    exigirCapacidades(
      declaracion.capacidades,
      CAPACIDADES_RUNTIME_DDNS_AGENTES,
      'runtime_capacidad_ddns_incompleta',
      instanciaId
    );
    exigirCapacidades(
      declaracion.capacidadesWebEmpaquetadas,
      CAPACIDADES_WEB_DDNS_AGENTES,
      'web_despliegue_mixto_ddns_rechazado',
      instanciaId
    );
  }
  return Object.freeze({
    preparada: true,
    unanimidad: true,
    perfil: PERFIL_DESPLIEGUE_DDNS_AGENTES,
    instanciasRuntimeCompatibles: instanciasRuntime.length,
    instanciasWebCompatibles: instanciasRuntime.length
  });
}

export async function resolverUnanimidadDdnsAgentes({
  preparacionLocal,
  clienteRedis,
  prefijoRuntime,
  entorno
} = {}) {
  if (typeof clienteRedis?.get !== 'function') {
    throw new Error('La unanimidad DDNS requiere Redis operativo.');
  }
  const instanciasRuntime = await listarPresenciasRuntimeDdnsAgentes({
    clienteRedis,
    prefijoRuntime,
    entorno
  });
  return evaluarUnanimidadDdnsAgentes({ preparacionLocal, instanciasRuntime });
}

export function evaluarActivacionDdnsAgentes({
  solicitada = false,
  preparacionLocal = null,
  instanciasRuntime = [],
  reconciliacionInicial = null
} = {}) {
  if (solicitada !== true) {
    return cerrarGate('desactivada_por_configuracion');
  }
  const unanimidadDdns = evaluarUnanimidadDdnsAgentes({
    preparacionLocal,
    instanciasRuntime
  });
  const unanimidadBind = evaluarUnanimidadPublicadorBindDns({ instanciasRuntime });
  exigir(
    reconciliacionInicial?.estado === 'satisfecha',
    'reconciliacion_inicial_dns_no_satisfecha',
    'La reconciliación inicial DNS no está satisfecha.',
    reconciliacionInicial?.estado ?? null
  );
  return Object.freeze({
    habilitada: true,
    gateAbierto: true,
    solicitada: true,
    codigo: 'activada',
    perfil: PERFIL_DESPLIEGUE_DDNS_AGENTES,
    instanciasRuntimeCompatibles: unanimidadDdns.instanciasRuntimeCompatibles,
    instanciasWebCompatibles: unanimidadDdns.instanciasWebCompatibles,
    perfilPublicadorBind: unanimidadBind.perfil,
    reconciliacionInicial: 'satisfecha'
  });
}

export async function resolverActivacionDdnsAgentes({
  solicitada = false,
  preparacionLocal = null,
  clienteRedis,
  prefijoRuntime,
  entorno,
  repositorioCoordinacion,
  esperaMaximaMs = 0,
  intervaloMs = 250
} = {}) {
  if (solicitada !== true) return cerrarGate('desactivada_por_configuracion');
  const limite = Date.now() + enteroNoNegativo(esperaMaximaMs, 'esperaMaximaMs');
  const pausa = Math.max(10, enteroNoNegativo(intervaloMs, 'intervaloMs'));
  while (true) {
    try {
      const [instanciasRuntime, reconciliacionInicial] = await Promise.all([
        listarPresenciasRuntimeDdnsAgentes({ clienteRedis, prefijoRuntime, entorno }),
        repositorioCoordinacion?.obtenerReconciliacion?.()
      ]);
      return evaluarActivacionDdnsAgentes({
        solicitada,
        preparacionLocal,
        instanciasRuntime,
        reconciliacionInicial
      });
    } catch (error) {
      if (Date.now() >= limite) throw error;
      await new Promise((resolve) => setTimeout(resolve, pausa));
    }
  }
}

export async function listarPresenciasRuntimeDdnsAgentes({
  clienteRedis,
  prefijoRuntime,
  entorno
} = {}) {
  if (typeof clienteRedis?.get !== 'function') {
    throw new Error('La compatibilidad DDNS requiere Redis operativo.');
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
  const instanciasRuntime = [];
  for (const clave of [...new Set(claves.map(texto).filter(Boolean))].sort()) {
    const serializada = await clienteRedis.get(clave);
    if (!serializada) continue;
    let presencia;
    try {
      presencia = JSON.parse(serializada);
    } catch {
      throw new ErrorCompatibilidadDespliegueDdnsAgentes(
        'presencia_runtime_ddns_invalida',
        'Una presencia runtime viva no contiene JSON válido.',
        clave
      );
    }
    if (texto(presencia?.entorno) === texto(entorno)) {
      instanciasRuntime.push(presencia);
    }
  }
  return instanciasRuntime;
}

function cerrarGate(codigo) {
  return Object.freeze({
    habilitada: false,
    gateAbierto: false,
    solicitada: false,
    codigo,
    perfil: PERFIL_DESPLIEGUE_DDNS_AGENTES,
    instanciasRuntimeCompatibles: 0,
    instanciasWebCompatibles: 0,
    reconciliacionInicial: null
  });
}

function exigirCapacidades(actuales, requeridas, codigo, instanciaId = null) {
  const catalogo = new Set(Array.isArray(actuales) ? actuales.map(texto) : []);
  const ausentes = requeridas.filter((capacidad) => !catalogo.has(capacidad));
  exigir(
    ausentes.length === 0,
    codigo,
    'La declaración no contiene todas las capacidades DDNS requeridas.',
    instanciaId === null ? ausentes : { instanciaId, ausentes }
  );
}

function exigir(condicion, codigo, mensaje, detalle = null) {
  if (!condicion) {
    throw new ErrorCompatibilidadDespliegueDdnsAgentes(codigo, mensaje, detalle);
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

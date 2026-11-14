export const PERFIL_DESPLIEGUE_MOMENTO_UTC_RELATIVO =
  'momento_utc_relativo@1';

export const MIGRACIONES_MOMENTO_UTC_RELATIVO = Object.freeze([
  '0001_esquema_inicial.sql'
]);

export const CAPACIDADES_RUNTIME_MOMENTO_UTC_RELATIVO = Object.freeze([
  'procesador_obligaciones_relativas_v1',
  'planificador_fronteras_sql_v1',
  'reconciliacion_reloj_sql_v1',
  'federacion_momento_utc_relativo_v1'
]);

export const CAPACIDADES_WEB_MOMENTO_UTC_RELATIVO = Object.freeze([
  'administracion_momento_utc_relativo_v1',
  'ui_momento_utc_relativo_v1',
  'federacion_momento_utc_relativo_v1'
]);

const CODIGOS_TRANSITORIOS = new Set([
  'runtime_compatible_ausente',
  'runtime_capacidad_ausente'
]);

export class ErrorCompatibilidadDespliegueMomentoUtcRelativo extends Error {
  constructor(codigo, mensaje, detalle = null) {
    super(mensaje);
    this.name = 'ErrorCompatibilidadDespliegueMomentoUtcRelativo';
    this.codigo = codigo;
    this.detalle = detalle;
  }
}

export function evaluarPreparacionLocalMomentoUtcRelativo({
  migracionesAplicadas = [],
  postcondicionesMigracionesVerificadas = false
} = {}) {
  const aplicadas = new Set([...migracionesAplicadas].map(texto));
  const ausentes = MIGRACIONES_MOMENTO_UTC_RELATIVO.filter(
    (nombre) => !aplicadas.has(nombre)
  );
  exigir(ausentes.length === 0, 'migraciones_relativas_ausentes',
    'No están aplicadas todas las migraciones del momento UTC relativo.', ausentes);
  exigir(postcondicionesMigracionesVerificadas === true,
    'postcondiciones_relativas_no_verificadas',
    'Las postcondiciones del momento UTC relativo no están verificadas.');
  return Object.freeze({
    preparada: true,
    perfil: PERFIL_DESPLIEGUE_MOMENTO_UTC_RELATIVO,
    migracionesVerificadas: MIGRACIONES_MOMENTO_UTC_RELATIVO.length
  });
}

export function crearDeclaracionCompatibilidadRuntimeMomentoUtcRelativo({
  instanciaId,
  preparacionLocal
} = {}) {
  exigir(preparacionLocal?.preparada === true,
    'preparacion_runtime_relativa_incompleta',
    'El runtime no puede declarar momento UTC relativo sin preparación local.');
  const id = texto(instanciaId);
  exigir(Boolean(id), 'instancia_runtime_relativa_invalida',
    'La declaración runtime relativa requiere instanciaId.');
  return Object.freeze({
    familia: 'momento_utc_relativo',
    perfil: PERFIL_DESPLIEGUE_MOMENTO_UTC_RELATIVO,
    instanciaId: id,
    capacidades: CAPACIDADES_RUNTIME_MOMENTO_UTC_RELATIVO,
    capacidadesWebEmpaquetadas: CAPACIDADES_WEB_MOMENTO_UTC_RELATIVO
  });
}

export function evaluarUnanimidadMomentoUtcRelativo({
  preparacionLocal,
  capacidadesWeb = [],
  instanciasRuntime = []
} = {}) {
  exigir(preparacionLocal?.preparada === true,
    'preparacion_web_relativa_incompleta',
    'La presencia web no ha demostrado preparación local relativa.');
  exigirCapacidades(capacidadesWeb, CAPACIDADES_WEB_MOMENTO_UTC_RELATIVO,
    'web_capacidad_relativa_ausente');
  exigir(Array.isArray(instanciasRuntime) && instanciasRuntime.length > 0,
    'runtime_compatible_ausente',
    'No existe una presencia runtime viva compatible con momento UTC relativo.');
  for (const instancia of instanciasRuntime) {
    const instanciaId = texto(instancia?.instanciaId) || null;
    const declaracion = instancia?.capacidadesDespliegue?.momentoUtcRelativo;
    exigir(declaracion && typeof declaracion === 'object',
      'runtime_capacidad_ausente',
      'Una presencia runtime viva no declara momento UTC relativo.', instanciaId);
    exigir(texto(declaracion.perfil) === PERFIL_DESPLIEGUE_MOMENTO_UTC_RELATIVO,
      'despliegue_mixto_relativo_rechazado',
      'Una presencia runtime viva declara otro perfil temporal.', instanciaId);
    exigirCapacidades(declaracion.capacidades,
      CAPACIDADES_RUNTIME_MOMENTO_UTC_RELATIVO,
      'runtime_capacidad_relativa_incompleta', instanciaId);
    exigirCapacidades(declaracion.capacidadesWebEmpaquetadas,
      CAPACIDADES_WEB_MOMENTO_UTC_RELATIVO,
      'web_despliegue_mixto_relativo_rechazado', instanciaId);
  }
  return Object.freeze({
    preparada: true,
    unanimidad: true,
    gateAbierto: true,
    perfil: PERFIL_DESPLIEGUE_MOMENTO_UTC_RELATIVO,
    instanciasRuntimeCompatibles: instanciasRuntime.length,
    instanciasWebCompatibles: instanciasRuntime.length
  });
}

export async function resolverUnanimidadMomentoUtcRelativo({
  preparacionLocal,
  capacidadesWeb = [],
  clienteRedis,
  prefijoRuntime,
  entorno,
  esperaMaximaMs = 60_000,
  intervaloMs = 250
} = {}) {
  if (typeof clienteRedis?.get !== 'function') {
    throw new Error('La unanimidad relativa requiere Redis.');
  }
  const limite = Date.now() + enteroNoNegativo(esperaMaximaMs, 'esperaMaximaMs');
  const pausa = Math.max(10, enteroNoNegativo(intervaloMs, 'intervaloMs'));
  while (true) {
    const instanciasRuntime = await listarPresenciasRuntime({
      clienteRedis, prefijoRuntime, entorno
    });
    try {
      return evaluarUnanimidadMomentoUtcRelativo({
        preparacionLocal, capacidadesWeb, instanciasRuntime
      });
    } catch (error) {
      if (!(error instanceof ErrorCompatibilidadDespliegueMomentoUtcRelativo) ||
          !CODIGOS_TRANSITORIOS.has(error.codigo) || Date.now() >= limite) {
        throw error;
      }
      await new Promise((resolve) => setTimeout(resolve, pausa));
    }
  }
}

async function listarPresenciasRuntime({ clienteRedis, prefijoRuntime, entorno }) {
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
      throw new ErrorCompatibilidadDespliegueMomentoUtcRelativo(
        'presencia_runtime_invalida',
        'Una presencia runtime viva no contiene JSON válido.',
        clave
      );
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
    throw new ErrorCompatibilidadDespliegueMomentoUtcRelativo(
      codigo, mensaje, detalle
    );
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

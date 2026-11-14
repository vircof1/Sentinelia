export const PERFIL_DESPLIEGUE_ELIMINACION_ADMINISTRATIVA_AGENTES =
  'eliminacion_administrativa_agentes@1';

export const MIGRACIONES_ELIMINACION_ADMINISTRATIVA_AGENTES = Object.freeze([
  '0001_esquema_inicial.sql'
]);

export const CAPACIDADES_RUNTIME_ELIMINACION_ADMINISTRATIVA_AGENTES =
  Object.freeze([
    'reclamo_operaciones_v1',
    'ejecutor_eliminar_agente_v1',
    'postcommit_reintentable_v1',
    'reconciliacion_sesiones_v1',
    'reconciliacion_catalogo_monitores_v1'
  ]);

const CAPACIDADES_WEB_REQUERIDAS = Object.freeze([
  'http_operacion_desacoplada_v1',
  'reconciliador_sesiones_tecnicas_v1',
  'websocket_buzon_usuario_v1'
]);

const CODIGOS_TRANSITORIOS = new Set([
  'runtime_compatible_ausente',
  'runtime_capacidad_ausente'
]);

export class ErrorCompatibilidadEliminacionAdministrativaAgentes extends Error {
  constructor(codigo, mensaje, detalle = null) {
    super(mensaje);
    this.name = 'ErrorCompatibilidadEliminacionAdministrativaAgentes';
    this.codigo = codigo;
    this.detalle = detalle;
  }
}

export function crearDeclaracionCompatibilidadRuntimeEliminacionAgentes({
  instanciaId
} = {}) {
  const id = texto(instanciaId);
  if (!id) {
    throw new Error('La declaración runtime requiere instanciaId.');
  }
  return Object.freeze({
    familia: 'eliminacion_administrativa_agentes',
    perfil: PERFIL_DESPLIEGUE_ELIMINACION_ADMINISTRATIVA_AGENTES,
    instanciaId: id,
    capacidades: CAPACIDADES_RUNTIME_ELIMINACION_ADMINISTRATIVA_AGENTES
  });
}

export function evaluarActivacionEliminacionAdministrativaAgentes({
  solicitada = false,
  migracionesAplicadas = [],
  postcondicionesMigracionesVerificadas = false,
  capacidadesWeb = [],
  instanciasRuntime = []
} = {}) {
  if (solicitada !== true) {
    return Object.freeze({
      habilitada: false,
      solicitada: false,
      perfil: PERFIL_DESPLIEGUE_ELIMINACION_ADMINISTRATIVA_AGENTES,
      codigo: 'desactivada_por_configuracion',
      instanciasRuntimeCompatibles: 0
    });
  }

  const aplicadas = new Set([...migracionesAplicadas].map(texto));
  const ausentes = MIGRACIONES_ELIMINACION_ADMINISTRATIVA_AGENTES
    .filter((nombre) => !aplicadas.has(nombre));
  exigir(
    ausentes.length === 0,
    'migraciones_requeridas_ausentes',
    'No están aplicadas todas las migraciones de eliminación administrativa.',
    ausentes
  );
  exigir(
    postcondicionesMigracionesVerificadas === true,
    'postcondiciones_migraciones_no_verificadas',
    'Las postcondiciones de las migraciones no están verificadas.'
  );
  exigirCapacidades(
    capacidadesWeb,
    CAPACIDADES_WEB_REQUERIDAS,
    'web_capacidad_ausente'
  );
  exigir(
    Array.isArray(instanciasRuntime) && instanciasRuntime.length > 0,
    'runtime_compatible_ausente',
    'No existe ninguna instancia runtime viva que declare el protocolo requerido.'
  );

  for (const instancia of instanciasRuntime) {
    const declaracion = instancia?.capacidadesDespliegue
      ?.eliminacionAdministrativaAgentes;
    exigir(
      declaracion && typeof declaracion === 'object',
      'runtime_capacidad_ausente',
      'Una instancia runtime viva no declara la capacidad de eliminación.',
      texto(instancia?.instanciaId) || null
    );
    exigir(
      texto(declaracion.perfil) ===
        PERFIL_DESPLIEGUE_ELIMINACION_ADMINISTRATIVA_AGENTES,
      'despliegue_mixto_rechazado',
      'Una instancia runtime viva declara otro protocolo de eliminación.',
      texto(instancia?.instanciaId) || null
    );
    exigirCapacidades(
      declaracion.capacidades,
      CAPACIDADES_RUNTIME_ELIMINACION_ADMINISTRATIVA_AGENTES,
      'runtime_capacidad_incompleta',
      texto(instancia?.instanciaId) || null
    );
  }

  return Object.freeze({
    habilitada: true,
    solicitada: true,
    perfil: PERFIL_DESPLIEGUE_ELIMINACION_ADMINISTRATIVA_AGENTES,
    codigo: 'compatibilidad_verificada',
    instanciasRuntimeCompatibles: instanciasRuntime.length
  });
}

export async function resolverActivacionEliminacionAdministrativaAgentes({
  solicitada = false,
  repositorioMigraciones,
  resumenMigraciones,
  clienteRedis,
  prefijoRuntime,
  entorno,
  capacidadesWeb = [],
  esperaMaximaMs = 60_000,
  intervaloMs = 250
} = {}) {
  if (solicitada !== true) {
    return evaluarActivacionEliminacionAdministrativaAgentes({ solicitada });
  }
  if (typeof repositorioMigraciones?.listarNombresAplicados !== 'function' ||
      typeof clienteRedis?.get !== 'function') {
    throw new Error('La activación requiere los puertos de migraciones y Redis.');
  }
  const migracionesAplicadas = await repositorioMigraciones.listarNombresAplicados();
  const base = {
    solicitada,
    migracionesAplicadas,
    postcondicionesMigracionesVerificadas:
      resumenMigraciones?.integridad?.ok === true,
    capacidadesWeb
  };
  const limite = Date.now() + enteroNoNegativo(esperaMaximaMs, 'esperaMaximaMs');
  const pausa = Math.max(10, enteroNoNegativo(intervaloMs, 'intervaloMs'));

  while (true) {
    const instanciasRuntime = await listarPresenciasRuntime({
      clienteRedis,
      prefijoRuntime,
      entorno
    });
    try {
      return evaluarActivacionEliminacionAdministrativaAgentes({
        ...base,
        instanciasRuntime
      });
    } catch (error) {
      if (!(error instanceof ErrorCompatibilidadEliminacionAdministrativaAgentes) ||
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
    throw new Error('El cliente Redis no permite enumerar presencias runtime.');
  }
  const presencias = [];
  for (const clave of [...new Set(claves.map(texto).filter(Boolean))].sort()) {
    const serializada = await clienteRedis.get(clave);
    if (!serializada) continue;
    try {
      const presencia = JSON.parse(serializada);
      if (texto(presencia?.entorno) === texto(entorno)) presencias.push(presencia);
    } catch {
      throw new ErrorCompatibilidadEliminacionAdministrativaAgentes(
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
  exigir(
    ausentes.length === 0,
    codigo,
    `Faltan capacidades requeridas: ${ausentes.join(', ')}.`,
    detalle
  );
}

function exigir(condicion, codigo, mensaje, detalle = null) {
  if (!condicion) {
    throw new ErrorCompatibilidadEliminacionAdministrativaAgentes(
      codigo,
      mensaje,
      detalle
    );
  }
}

function texto(valor) {
  return String(valor ?? '').trim();
}

function enteroNoNegativo(valor, nombre) {
  const numero = Number(valor);
  if (!Number.isInteger(numero) || numero < 0 || numero > 120_000) {
    throw new Error(`${nombre} debe ser un entero entre 0 y 120000.`);
  }
  return numero;
}

function esperar(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

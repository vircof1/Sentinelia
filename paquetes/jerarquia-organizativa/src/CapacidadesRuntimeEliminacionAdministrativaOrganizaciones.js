export const MIGRACIONES_ELIMINACION_ADMINISTRATIVA_ORGANIZACIONES = Object.freeze([
  '0001_esquema_inicial.sql'
]);

export const CAPACIDADES_RUNTIME_ELIMINACION_ADMINISTRATIVA_ORGANIZACIONES =
  Object.freeze([
    'reservas_jerarquicas_v1',
    'ejecutor_eliminar_organizacion_v1',
    'preparador_dependencias_agente_compartido_v1',
    'postcommit_organizacion_v1'
  ]);

export const CAPACIDADES_WEB_ELIMINACION_ADMINISTRATIVA_ORGANIZACIONES =
  Object.freeze([
    'http_organizacion_desacoplada_v1',
    'consulta_operaciones_transversal_v1',
    'websocket_buzon_usuario_v1',
    'sin_camino_sincrono_organizacion_v1'
  ]);

const CODIGOS_TRANSITORIOS = new Set([
  'runtime_compatible_ausente',
  'runtime_capacidad_ausente'
]);

export class ErrorCompatibilidadEliminacionAdministrativaOrganizaciones extends Error {
  constructor(codigo, mensaje, detalle = null) {
    super(mensaje);
    this.name = 'ErrorCompatibilidadEliminacionAdministrativaOrganizaciones';
    this.codigo = codigo;
    this.detalle = detalle;
  }
}

export function crearDeclaracionCapacidadesRuntimeEliminacionOrganizaciones({
  instanciaId
} = {}) {
  const id = texto(instanciaId);
  if (!id) {
    throw new Error('La declaración organizativa runtime requiere instanciaId.');
  }
  return Object.freeze({
    familia: 'eliminacion_administrativa_organizaciones',
    estadoPublicacion: 'publica',
    versionContrato: 1,
    instanciaId: id,
    capacidades: CAPACIDADES_RUNTIME_ELIMINACION_ADMINISTRATIVA_ORGANIZACIONES,
    capacidadesWebEmpaquetadas:
      CAPACIDADES_WEB_ELIMINACION_ADMINISTRATIVA_ORGANIZACIONES
  });
}

export function evaluarActivacionEliminacionAdministrativaOrganizaciones({
  migracionesAplicadas = [],
  postcondicionesMigracionesVerificadas = false,
  capacidadesWeb = [],
  instanciasRuntime = []
} = {}) {
  const aplicadas = new Set([...migracionesAplicadas].map(texto));
  const ausentes = MIGRACIONES_ELIMINACION_ADMINISTRATIVA_ORGANIZACIONES
    .filter((nombre) => !aplicadas.has(nombre));
  exigir(
    ausentes.length === 0,
    'migraciones_requeridas_ausentes',
    'No están aplicadas todas las migraciones de eliminación organizativa.',
    ausentes
  );
  exigir(
    postcondicionesMigracionesVerificadas === true,
    'postcondiciones_migraciones_no_verificadas',
    'Las postcondiciones de las migraciones no están verificadas.'
  );
  exigirCapacidades(
    capacidadesWeb,
    CAPACIDADES_WEB_ELIMINACION_ADMINISTRATIVA_ORGANIZACIONES,
    'web_capacidad_ausente'
  );
  exigir(
    Array.isArray(instanciasRuntime) && instanciasRuntime.length > 0,
    'runtime_compatible_ausente',
    'No existe ninguna presencia viva del despliegue con el protocolo organizativo.'
  );
  for (const instancia of instanciasRuntime) {
    const instanciaId = texto(instancia?.instanciaId) || null;
    const declaracion = instancia?.capacidadesDespliegue
      ?.eliminacionAdministrativaOrganizaciones;
    exigir(
      declaracion && typeof declaracion === 'object',
      'runtime_capacidad_ausente',
      'Una presencia viva no declara la capacidad organizativa.',
      instanciaId
    );
    exigirCapacidades(
      declaracion.capacidades,
      CAPACIDADES_RUNTIME_ELIMINACION_ADMINISTRATIVA_ORGANIZACIONES,
      'runtime_capacidad_incompleta',
      instanciaId
    );
    exigirCapacidades(
      declaracion.capacidadesWebEmpaquetadas,
      CAPACIDADES_WEB_ELIMINACION_ADMINISTRATIVA_ORGANIZACIONES,
      'web_despliegue_mixto_rechazado',
      instanciaId
    );
  }
  return Object.freeze({
    habilitada: true,
    codigo: 'capacidades_verificadas',
    instanciasRuntimeCompatibles: instanciasRuntime.length,
    instanciasWebCompatibles: instanciasRuntime.length
  });
}

export async function resolverActivacionEliminacionAdministrativaOrganizaciones({
  repositorioMigraciones,
  resumenMigraciones,
  clienteRedis,
  prefijoRuntime,
  entorno,
  capacidadesWeb = [],
  esperaMaximaMs = 60_000,
  intervaloMs = 250
} = {}) {
  if (typeof repositorioMigraciones?.listarNombresAplicados !== 'function' ||
      typeof clienteRedis?.get !== 'function') {
    throw new Error('La activación organizativa requiere migraciones y Redis.');
  }
  const base = {
    migracionesAplicadas: await repositorioMigraciones.listarNombresAplicados(),
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
      return evaluarActivacionEliminacionAdministrativaOrganizaciones({
        ...base,
        instanciasRuntime
      });
    } catch (error) {
      if (!(error instanceof ErrorCompatibilidadEliminacionAdministrativaOrganizaciones) ||
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
      throw new ErrorCompatibilidadEliminacionAdministrativaOrganizaciones(
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
    throw new ErrorCompatibilidadEliminacionAdministrativaOrganizaciones(
      codigo,
      mensaje,
      detalle
    );
  }
}

function enteroNoNegativo(valor, nombre) {
  const numero = Number(valor);
  if (!Number.isInteger(numero) || numero < 0 || numero > 120_000) {
    throw new Error(`${nombre} debe ser un entero entre 0 y 120000.`);
  }
  return numero;
}

function texto(valor) {
  return String(valor ?? '').trim();
}

function esperar(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

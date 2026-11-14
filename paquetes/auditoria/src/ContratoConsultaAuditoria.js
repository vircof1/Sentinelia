import {
  ACTORES_AUDITORIA,
  CAUSALIDADES_AUDITORIA,
  FLUJOS_AUDITORIA,
  ORIGENES_AUDITORIA,
  SUJETOS_AUDITORIA,
  esClaveCadenaAuditoria,
  listarTiposEventoAuditoria
} from './CatalogoAuditoria.js';

const PATRON_UUID_V7 = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const PATRON_CURSOR = /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/;
const PATRON_FECHA_UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/;
const PATRON_ID_OPACO_ASCII = /^[\x21-\x7e]+$/;

export const VERSION_CONTRATO_CONSULTA_AUDITORIA = 2;
export const LIMITE_POR_DEFECTO_CONSULTA_AUDITORIA = 25;
export const LIMITE_MAXIMO_CONSULTA_AUDITORIA = 100;
export const LIMITES_UX_CONSULTA_AUDITORIA = Object.freeze([10, 25, 50]);
export const ORDENES_CONSULTA_AUDITORIA = Object.freeze(['asc', 'desc']);
export const ROLES_ACTOR_CONSULTA_AUDITORIA = Object.freeze(['real', 'efectivo']);
export const MODOS_ACTUACION_CONSULTA_AUDITORIA = Object.freeze(['directo', 'impersonado']);

export const CODIGOS_ERROR_CONSULTA_AUDITORIA = Object.freeze({
  FILTRO_INVALIDO: 'FILTRO_AUDITORIA_INVALIDO',
  FILTROS_INCOMPATIBLES: 'FILTROS_AUDITORIA_INCOMPATIBLES',
  PARAMETRO_NO_ADMITIDO: 'PARAMETRO_AUDITORIA_NO_ADMITIDO',
  CURSOR_INVALIDO: 'CURSOR_AUDITORIA_INVALIDO',
  CURSOR_INCOMPATIBLE: 'CURSOR_AUDITORIA_INCOMPATIBLE'
});

export const PARAMETROS_PROHIBIDOS_CONSULTA_AUDITORIA = Object.freeze([
  'resultado',
  'estado',
  'q',
  'texto',
  'busqueda',
  'payload'
]);

const tiposEvento = Object.freeze(listarTiposEventoAuditoria());

export const CONTRATO_PARAMETROS_CONSULTA_AUDITORIA = congelar({
  limite: parametro({
    tipo: 'entero_decimal_positivo',
    defecto: LIMITE_POR_DEFECTO_CONSULTA_AUDITORIA,
    maximo: LIMITE_MAXIMO_CONSULTA_AUDITORIA,
    ejemploValido: '50',
    ejemploInvalido: '25x',
    resultadoEsperado: 50,
    resultadoExceso: LIMITE_MAXIMO_CONSULTA_AUDITORIA,
    validar: (valor) => typeof valor === 'string' && /^[1-9][0-9]*$/.test(valor)
  }),
  orden: parametroEnum(ORDENES_CONSULTA_AUDITORIA, 'desc', 'asc', 'DESC'),
  desdeUtc: parametroFecha('2026-07-20T00:00:00.000Z', '2026-07-20'),
  hastaUtc: parametroFecha('2026-07-27T23:59:59.999Z', '2026-07-27 23:59:59'),
  flujo: parametroEnum(FLUJOS_AUDITORIA, null, 'usuarios', 'Usuarios'),
  tipoEvento: parametroEnum(tiposEvento, null, 'usuario.sesion_iniciada', 'usuario.desconocido'),
  sujetoTipo: parametroEnum(SUJETOS_AUDITORIA, null, 'usuario', 'recurso'),
  sujetoId: parametroId(191, '184', ' id '),
  actorRol: parametroEnum(ROLES_ACTOR_CONSULTA_AUDITORIA, null, 'real', 'principal'),
  actorTipo: parametroEnum(ACTORES_AUDITORIA, null, 'usuario', 'persona'),
  actorId: parametroId(128, '42', ''),
  modoActuacion: parametroEnum(MODOS_ACTUACION_CONSULTA_AUDITORIA, null, 'impersonado', 'delegado'),
  origen: parametroEnum(ORIGENES_AUDITORIA, null, 'web', 'consola'),
  claveCadena: parametro({
    tipo: 'clave_cadena_completa',
    ejemploValido: 'usuarios:tenant:9',
    ejemploInvalido: 'usuarios:tenant:',
    resultadoEsperado: 'usuarios:tenant:9',
    validar: (valor) => typeof valor === 'string' &&
      valor.length <= 128 && esClaveCadenaAuditoria(valor)
  }),
  correlacionId: parametroUuid('01984f5a-9b8c-7def-8123-456789abcdef', '01984f5a-9b8c-4def-8123-456789abcdef'),
  causalidadTipo: parametroEnum(CAUSALIDADES_AUDITORIA, null, 'evento_auditoria', 'evento'),
  causalidadId: parametroId(128, '01984f5a-9b8c-7def-8123-456789abcdef', 'causa con espacios'),
  cursor: parametro({
    tipo: 'cursor_firmado',
    maximo: 4096,
    ejemploValido: 'eyJ2IjoyfQ.c2lnbmF0dXJh',
    ejemploInvalido: 'cursor sin firma',
    resultadoEsperado: 'validar_firma_e_identidad_en_codec_v2',
    codigoError: CODIGOS_ERROR_CONSULTA_AUDITORIA.CURSOR_INVALIDO,
    validar: (valor) => typeof valor === 'string' && valor.length <= 4096 && PATRON_CURSOR.test(valor)
  }),
  incluirTotal: parametro({
    tipo: 'booleano_explicito',
    defecto: false,
    ejemploValido: 'true',
    ejemploInvalido: '1',
    resultadoEsperado: true,
    validar: (valor) => valor === 'true' || valor === 'false' || typeof valor === 'boolean'
  })
});

export const CONTRATO_RESPUESTA_CONSULTA_AUDITORIA = congelar({
  camposRaiz: ['eventos', 'paginacion', 'filtros', 'total'],
  paginacion: {
    campos: ['orden', 'limite', 'siguienteCursor', 'hayMas'],
    unidad: 'evento_visible',
    posicion: ['registradoEnUtc', 'eventoId'],
    estrategia: 'cursor_firmado_sin_offset'
  },
  total: 'null_salvo_incluirTotal_true',
  agrupacionImplicita: false
});

export class ErrorContratoConsultaAuditoria extends Error {
  constructor(mensaje, { codigo, campo = null } = {}) {
    super(mensaje);
    this.name = 'ErrorContratoConsultaAuditoria';
    this.statusCode = 400;
    this.codigo = codigo;
    this.campo = campo;
  }
}

export function validarConsultaAuditoriaSegunContrato(consulta = {}) {
  if (!esObjetoPlano(consulta)) {
    throw crearError('La consulta debe ser un objeto plano.', CODIGOS_ERROR_CONSULTA_AUDITORIA.FILTRO_INVALIDO);
  }

  for (const [nombre, valor] of Object.entries(consulta)) {
    const definicion = CONTRATO_PARAMETROS_CONSULTA_AUDITORIA[nombre];
    if (!definicion) {
      throw crearError(
        `El parámetro ${nombre} no forma parte del contrato de consulta.`,
        CODIGOS_ERROR_CONSULTA_AUDITORIA.PARAMETRO_NO_ADMITIDO,
        nombre
      );
    }
    if (Array.isArray(valor) || !definicion.validar(valor)) {
      throw crearError(
        `El parámetro ${nombre} no cumple el contrato de consulta.`,
        definicion.codigoError || CODIGOS_ERROR_CONSULTA_AUDITORIA.FILTRO_INVALIDO,
        nombre
      );
    }
  }

  exigirPareja(consulta, 'sujetoTipo', 'sujetoId');
  exigirPareja(consulta, 'causalidadTipo', 'causalidadId');
  exigirActorCompleto(consulta);
  exigirRangoFechas(consulta);
  exigirCoherenciaCadena(consulta);
  exigirCoherenciaActor(consulta);
  return true;
}

function parametro({ validar, codigoError = CODIGOS_ERROR_CONSULTA_AUDITORIA.FILTRO_INVALIDO, ...contrato }) {
  return { ...contrato, codigoError, validar };
}

function parametroEnum(valores, defecto, ejemploValido, ejemploInvalido) {
  return parametro({
    tipo: 'enum_cerrado',
    valores,
    defecto,
    ejemploValido,
    ejemploInvalido,
    resultadoEsperado: ejemploValido,
    validar: (valor) => typeof valor === 'string' && valores.includes(valor)
  });
}

function parametroFecha(ejemploValido, ejemploInvalido) {
  return parametro({
    tipo: 'fecha_iso_8601_utc',
    ejemploValido,
    ejemploInvalido,
    resultadoEsperado: ejemploValido,
    validar: esFechaUtcValida
  });
}

function parametroId(maximo, ejemploValido, ejemploInvalido) {
  return parametro({
    tipo: 'id_opaco_ascii_exacto',
    maximo,
    ejemploValido,
    ejemploInvalido,
    resultadoEsperado: ejemploValido,
    validar: (valor) => typeof valor === 'string' && valor.length <= maximo && PATRON_ID_OPACO_ASCII.test(valor)
  });
}

function parametroUuid(ejemploValido, ejemploInvalido) {
  return parametro({
    tipo: 'uuid_v7_canonico',
    ejemploValido,
    ejemploInvalido,
    resultadoEsperado: ejemploValido,
    validar: (valor) => typeof valor === 'string' && PATRON_UUID_V7.test(valor)
  });
}

function esFechaUtcValida(valor) {
  if (typeof valor !== 'string' || !PATRON_FECHA_UTC.test(valor)) return false;
  const coincidencia = PATRON_FECHA_UTC.exec(valor);
  const instante = new Date(valor);
  if (Number.isNaN(instante.getTime())) return false;
  const [fecha] = coincidencia;
  const [parteFecha, parteHora] = fecha.slice(0, -1).split('T');
  const [anio, mes, dia] = parteFecha.split('-').map(Number);
  const [hora, minuto, segundoConFraccion] = parteHora.split(':');
  const segundo = Number(segundoConFraccion.split('.')[0]);
  return instante.getUTCFullYear() === anio &&
    instante.getUTCMonth() + 1 === mes &&
    instante.getUTCDate() === dia &&
    instante.getUTCHours() === Number(hora) &&
    instante.getUTCMinutes() === Number(minuto) &&
    instante.getUTCSeconds() === segundo;
}

function exigirPareja(consulta, tipo, id) {
  if ((consulta[tipo] == null) !== (consulta[id] == null)) {
    throw crearError(
      `${tipo} y ${id} deben aparecer juntos.`,
      CODIGOS_ERROR_CONSULTA_AUDITORIA.FILTROS_INCOMPATIBLES,
      tipo
    );
  }
}

function exigirActorCompleto(consulta) {
  const presentes = ['actorRol', 'actorTipo', 'actorId'].filter((campo) => consulta[campo] != null);
  if (presentes.length !== 0 && presentes.length !== 3) {
    throw crearError(
      'actorRol, actorTipo y actorId deben aparecer juntos.',
      CODIGOS_ERROR_CONSULTA_AUDITORIA.FILTROS_INCOMPATIBLES,
      'actorRol'
    );
  }
}

function exigirRangoFechas(consulta) {
  if (consulta.desdeUtc && consulta.hastaUtc && Date.parse(consulta.desdeUtc) > Date.parse(consulta.hastaUtc)) {
    throw crearError(
      'desdeUtc no puede ser posterior a hastaUtc.',
      CODIGOS_ERROR_CONSULTA_AUDITORIA.FILTROS_INCOMPATIBLES,
      'desdeUtc'
    );
  }
}

function exigirCoherenciaCadena(consulta) {
  if (!consulta.claveCadena || !consulta.flujo) return;
  const flujoCadena = consulta.claveCadena.slice(0, consulta.claveCadena.indexOf(':'));
  if (flujoCadena !== consulta.flujo) {
    throw crearError(
      'claveCadena y flujo deben identificar el mismo flujo.',
      CODIGOS_ERROR_CONSULTA_AUDITORIA.FILTROS_INCOMPATIBLES,
      'claveCadena'
    );
  }
}

function exigirCoherenciaActor(consulta) {
  if (consulta.actorRol === 'efectivo' && consulta.actorTipo !== 'usuario') {
    throw crearError(
      'El actor efectivo del contrato auditable solo puede ser usuario.',
      CODIGOS_ERROR_CONSULTA_AUDITORIA.FILTROS_INCOMPATIBLES,
      'actorTipo'
    );
  }
  if (consulta.actorRol === 'efectivo' && consulta.modoActuacion === 'directo') {
    throw crearError(
      'Un actor efectivo no puede combinarse con actuación directa.',
      CODIGOS_ERROR_CONSULTA_AUDITORIA.FILTROS_INCOMPATIBLES,
      'modoActuacion'
    );
  }
}

function crearError(mensaje, codigo, campo = null) {
  return new ErrorContratoConsultaAuditoria(mensaje, { codigo, campo });
}

function esObjetoPlano(valor) {
  return valor != null && typeof valor === 'object' && !Array.isArray(valor) && Object.getPrototypeOf(valor) === Object.prototype;
}

function congelar(valor) {
  if (valor && typeof valor === 'object' && !Object.isFrozen(valor)) {
    Object.freeze(valor);
    for (const hijo of Object.values(valor)) congelar(hijo);
  }
  return valor;
}

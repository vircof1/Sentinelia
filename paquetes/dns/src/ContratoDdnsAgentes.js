import { validarUuidV7Auditoria } from '../../auditoria/src/UuidV7Auditoria.js';
import { canonicalizarEstadoDeseadoDdnsAgentes }
  from './ValidadorEstadoDdnsAgentes.js';

export const PERFIL_CONTRATO_DDNS_AGENTES = 'ddns_agentes@1';
export const VERSION_CONTRATO_DDNS_AGENTES = 1;

export const PERFILES_DDNS_AGENTES = congelarProfundo({
  CONCESION: 'ddns_agentes@1/concesion',
  SOLICITUD: 'ddns_agentes@1/solicitud',
  ESTADO_DESEADO: 'ddns_agentes@1/estado_deseado',
  RESULTADO: 'ddns_agentes@1/resultado'
});

export const TIPOS_REGISTRO_DDNS_AGENTES = Object.freeze([
  'A', 'AAAA', 'CNAME', 'MX'
]);

export const MODOS_DDNS_AGENTES = Object.freeze({
  OBSERVADA: 'observada',
  DECLARADA: 'declarada'
});

export const HITOS_DDNS_AGENTES = Object.freeze([
  'intencion_aceptada',
  'contenido_deseado_persistido',
  'contenido_publicado'
]);

export const CONDICIONES_OPERATIVAS_DDNS_AGENTES = Object.freeze([
  'pendiente_decision_agente',
  'operativa',
  'esperando_observacion',
  'publicacion_previa_desconocida',
  'registro_no_operable',
  'publicacion_bloqueada',
  'publicacion_fallida'
]);

export const TERMINALES_INTENCION_DDNS_AGENTES = Object.freeze([
  'publicada',
  'sustituida',
  'publicacion_fallida',
  'objetivo_incompatible',
  'objetivo_eliminado'
]);

export const RESULTADOS_INTENCION_DDNS_AGENTES = Object.freeze([
  'aceptada',
  'repetida',
  'convergente',
  'sin_cambios',
  'rechazada'
]);

export const ERRORES_DDNS_AGENTES = Object.freeze([
  'sin_autoridad',
  'valor_no_interpretable',
  'version_obsoleta',
  'idempotencia_conflictiva',
  'registro_no_operable'
]);

export const PROPIEDADES_CONTRATO_DDNS_AGENTES = congelarProfundo({
  CONCESION: ['perfil', 'versionContrato', 'concesionId'],
  SOLICITUD: [
    'perfil', 'versionContrato', 'solicitudId', 'versionEsperada',
    'estadoDeseado'
  ],
  ESTADO_DESEADO: ['perfil', 'versionContrato', 'tipo', 'modo', 'valor'],
  RESULTADO: [
    'perfil', 'versionContrato', 'resultado', 'version', 'hito',
    'condicion', 'terminal', 'error'
  ],
  VALOR_A: ['direccionIpv4'],
  VALOR_AAAA: ['direccionIpv6'],
  VALOR_CNAME: ['destino'],
  VALOR_MX: ['prioridad', 'destino']
});

const MAX_BIGINT_UNSIGNED = (1n << 64n) - 1n;
const PATRON_DECIMAL_CANONICO = /^(0|[1-9][0-9]*)$/u;
const TIPOS = new Set(TIPOS_REGISTRO_DDNS_AGENTES);
const MODOS = new Set(Object.values(MODOS_DDNS_AGENTES));
const HITOS = new Set(HITOS_DDNS_AGENTES);
const CONDICIONES = new Set(CONDICIONES_OPERATIVAS_DDNS_AGENTES);
const TERMINALES = new Set(TERMINALES_INTENCION_DDNS_AGENTES);
const RESULTADOS = new Set(RESULTADOS_INTENCION_DDNS_AGENTES);
const ERRORES = new Set(ERRORES_DDNS_AGENTES);

export class ErrorContratoDdnsAgentes extends Error {
  constructor(mensaje, { campo = null } = {}) {
    super(mensaje);
    this.name = 'ErrorContratoDdnsAgentes';
    this.codigo = 'contrato_ddns_agentes_invalido';
    this.campo = campo;
  }
}

export function crearIdentidadConcesionDdnsAgentes(entrada) {
  validarClavesExactas(entrada, propiedades('CONCESION'), 'concesion');
  exigirPerfil(entrada, 'CONCESION');
  validarUuidV7(entrada.concesionId, 'concesion.concesionId');
  return congelarProfundo({
    perfil: PERFILES_DDNS_AGENTES.CONCESION,
    versionContrato: VERSION_CONTRATO_DDNS_AGENTES,
    concesionId: entrada.concesionId
  });
}

export function crearSolicitudDdnsAgentes(entrada) {
  validarClavesExactas(entrada, propiedades('SOLICITUD'), 'solicitud');
  exigirPerfil(entrada, 'SOLICITUD');
  validarUuidV7(entrada.solicitudId, 'solicitud.solicitudId');
  const versionEsperada = exigirDecimalBigintUnsignedDdnsAgentes(
    entrada.versionEsperada,
    'solicitud.versionEsperada'
  );
  const estadoDeseado = crearEstadoDeseadoDdnsAgentes(entrada.estadoDeseado);
  return congelarProfundo({
    perfil: PERFILES_DDNS_AGENTES.SOLICITUD,
    versionContrato: VERSION_CONTRATO_DDNS_AGENTES,
    solicitudId: entrada.solicitudId,
    versionEsperada,
    estadoDeseado
  });
}

export function crearSolicitudHttpDdnsAgentes(entrada, tipoRegistro) {
  const solicitud = validarSolicitudHttpDdnsAgentes(entrada);
  const estadoDeseado = crearEstadoDeseadoDdnsAgentes({
    perfil: PERFILES_DDNS_AGENTES.ESTADO_DESEADO,
    versionContrato: VERSION_CONTRATO_DDNS_AGENTES,
    tipo: tipoRegistro,
    modo: solicitud.estadoDeseado.modo,
    valor: solicitud.estadoDeseado.modo === MODOS_DDNS_AGENTES.OBSERVADA
      ? null
      : solicitud.estadoDeseado.valor
  });
  return crearSolicitudDdnsAgentes({
    perfil: PERFILES_DDNS_AGENTES.SOLICITUD,
    versionContrato: VERSION_CONTRATO_DDNS_AGENTES,
    solicitudId: solicitud.solicitudId,
    versionEsperada: solicitud.versionEsperada,
    estadoDeseado
  });
}

export function validarSolicitudHttpDdnsAgentes(entrada) {
  validarClavesExactas(
    entrada,
    ['solicitudId', 'versionEsperada', 'estadoDeseado'],
    'solicitud'
  );
  validarUuidV7(entrada.solicitudId, 'solicitud.solicitudId');
  const versionEsperada = exigirDecimalBigintUnsignedDdnsAgentes(
    entrada.versionEsperada,
    'solicitud.versionEsperada'
  );
  validarClavesExactasSegunModo(entrada.estadoDeseado);
  return congelarProfundo({
    solicitudId: entrada.solicitudId,
    versionEsperada,
    estadoDeseado: entrada.estadoDeseado
  });
}

export function crearEstadoDeseadoDdnsAgentes(entrada) {
  validarClavesExactas(entrada, propiedades('ESTADO_DESEADO'), 'estadoDeseado');
  exigirPerfil(entrada, 'ESTADO_DESEADO');
  exigirEnum(entrada.tipo, TIPOS, 'estadoDeseado.tipo');
  exigirEnum(entrada.modo, MODOS, 'estadoDeseado.modo');

  let estadoCanonico;
  try {
    estadoCanonico = canonicalizarEstadoDeseadoDdnsAgentes({
      tipo: entrada.tipo,
      modo: entrada.modo,
      valor: entrada.valor
    });
  } catch (error) {
    fallar(error.message, error.campo ? `estadoDeseado.${error.campo}` : 'estadoDeseado');
  }
  return congelarProfundo({
    perfil: PERFILES_DDNS_AGENTES.ESTADO_DESEADO,
    versionContrato: VERSION_CONTRATO_DDNS_AGENTES,
    tipo: estadoCanonico.tipo,
    modo: estadoCanonico.modo,
    valor: estadoCanonico.valor
  });
}

export function crearResultadoDdnsAgentes(entrada) {
  validarClavesExactas(entrada, propiedades('RESULTADO'), 'resultadoDdns');
  exigirPerfil(entrada, 'RESULTADO');
  exigirEnum(entrada.resultado, RESULTADOS, 'resultadoDdns.resultado');
  const version = exigirDecimalBigintUnsignedDdnsAgentes(
    entrada.version,
    'resultadoDdns.version'
  );
  const hito = enumNullable(entrada.hito, HITOS, 'resultadoDdns.hito');
  const condicion = enumNullable(
    entrada.condicion,
    CONDICIONES,
    'resultadoDdns.condicion'
  );
  const terminal = enumNullable(
    entrada.terminal,
    TERMINALES,
    'resultadoDdns.terminal'
  );
  const error = enumNullable(entrada.error, ERRORES, 'resultadoDdns.error');
  exigir(
    (entrada.resultado === 'rechazada') === (error !== null),
    'Solo un resultado rechazado posee un error de dominio.',
    'resultadoDdns.error'
  );
  exigir(
    entrada.resultado !== 'rechazada' || (hito === null && terminal === null),
    'Un rechazo no alcanza hitos ni terminales de una intención.',
    'resultadoDdns.hito'
  );
  return congelarProfundo({
    perfil: PERFILES_DDNS_AGENTES.RESULTADO,
    versionContrato: VERSION_CONTRATO_DDNS_AGENTES,
    resultado: entrada.resultado,
    version,
    hito,
    condicion,
    terminal,
    error
  });
}

export function exigirDecimalBigintUnsignedDdnsAgentes(valor, nombre = 'valor') {
  const texto = typeof valor === 'bigint' ? valor.toString() : valor;
  exigir(
    typeof texto === 'string' && PATRON_DECIMAL_CANONICO.test(texto),
    `${nombre} debe ser un decimal canónico de BIGINT UNSIGNED.`,
    nombre
  );
  exigir(
    BigInt(texto) <= MAX_BIGINT_UNSIGNED,
    `${nombre} supera BIGINT UNSIGNED.`,
    nombre
  );
  return texto;
}

export function serializarCanonicoDdnsAgentes(valor) {
  exigir(esObjetoPlano(valor), 'El valor DDNS serializable debe ser un objeto plano.', 'valor');
  const perfil = valor.perfil;
  const constructores = new Map([
    [PERFILES_DDNS_AGENTES.CONCESION, crearIdentidadConcesionDdnsAgentes],
    [PERFILES_DDNS_AGENTES.SOLICITUD, crearSolicitudDdnsAgentes],
    [PERFILES_DDNS_AGENTES.ESTADO_DESEADO, crearEstadoDeseadoDdnsAgentes],
    [PERFILES_DDNS_AGENTES.RESULTADO, crearResultadoDdnsAgentes]
  ]);
  const constructor = constructores.get(perfil);
  exigir(constructor, 'El perfil DDNS no pertenece al contrato.', 'valor.perfil');
  return JSON.stringify(constructor(valor));
}

export function deserializarCanonicoDdnsAgentes(texto) {
  exigir(typeof texto === 'string', 'El contrato DDNS serializado debe ser texto.', 'texto');
  let valor;
  try {
    valor = JSON.parse(texto);
  } catch {
    fallar('El contrato DDNS serializado no contiene JSON válido.', 'texto');
  }
  const constructores = new Map([
    [PERFILES_DDNS_AGENTES.CONCESION, crearIdentidadConcesionDdnsAgentes],
    [PERFILES_DDNS_AGENTES.SOLICITUD, crearSolicitudDdnsAgentes],
    [PERFILES_DDNS_AGENTES.ESTADO_DESEADO, crearEstadoDeseadoDdnsAgentes],
    [PERFILES_DDNS_AGENTES.RESULTADO, crearResultadoDdnsAgentes]
  ]);
  const constructor = constructores.get(valor?.perfil);
  exigir(constructor, 'El perfil DDNS no pertenece al contrato.', 'valor.perfil');
  return constructor(valor);
}

function exigirPerfil(entrada, tipo) {
  exigir(entrada.perfil === PERFILES_DDNS_AGENTES[tipo], `El perfil ${tipo} no es válido.`, 'perfil');
  exigir(entrada.versionContrato === VERSION_CONTRATO_DDNS_AGENTES,
    `La versión del perfil ${tipo} no es válida.`, 'versionContrato');
}

function validarUuidV7(valor, campo) {
  try {
    validarUuidV7Auditoria(valor, campo);
  } catch {
    fallar(`${campo} debe ser un UUIDv7 textual canónico.`, campo);
  }
}

function validarClavesExactas(entrada, esperadas, nombre) {
  exigir(esObjetoPlano(entrada), `${nombre} debe ser un objeto plano.`, nombre);
  for (const clave of esperadas) {
    const descriptor = Object.getOwnPropertyDescriptor(entrada, clave);
    exigir(descriptor && 'value' in descriptor, `${nombre}.${clave} es obligatorio y no admite accessors.`, `${nombre}.${clave}`);
  }
  const recibidas = Object.keys(entrada).sort();
  const requeridas = [...esperadas].sort();
  exigir(JSON.stringify(recibidas) === JSON.stringify(requeridas),
    `${nombre} exige exactamente: ${esperadas.join(', ')}.`, nombre);
}

function validarClavesExactasSegunModo(estadoDeseado) {
  exigir(esObjetoPlano(estadoDeseado),
    'solicitud.estadoDeseado debe ser un objeto plano.',
    'solicitud.estadoDeseado');
  const modo = estadoDeseado.modo;
  exigirEnum(modo, MODOS, 'solicitud.estadoDeseado.modo');
  validarClavesExactas(
    estadoDeseado,
    modo === MODOS_DDNS_AGENTES.OBSERVADA ? ['modo'] : ['modo', 'valor'],
    'solicitud.estadoDeseado'
  );
}

function propiedades(tipo) {
  return PROPIEDADES_CONTRATO_DDNS_AGENTES[tipo];
}

function enumNullable(valor, catalogo, campo) {
  if (valor === null) return null;
  exigirEnum(valor, catalogo, campo);
  return valor;
}

function exigirEnum(valor, catalogo, campo) {
  exigir(catalogo.has(valor), `${campo} no pertenece al catálogo cerrado.`, campo);
  return valor;
}

function esObjetoPlano(valor) {
  if (valor === null || typeof valor !== 'object' || Array.isArray(valor)) return false;
  const prototipo = Object.getPrototypeOf(valor);
  return prototipo === Object.prototype || prototipo === null;
}

function congelarProfundo(valor) {
  if (valor && typeof valor === 'object' && !Object.isFrozen(valor)) {
    for (const contenido of Object.values(valor)) congelarProfundo(contenido);
    Object.freeze(valor);
  }
  return valor;
}

function exigir(condicion, mensaje, campo = null) {
  if (!condicion) fallar(mensaje, campo);
}

function fallar(mensaje, campo) {
  throw new ErrorContratoDdnsAgentes(mensaje, { campo });
}

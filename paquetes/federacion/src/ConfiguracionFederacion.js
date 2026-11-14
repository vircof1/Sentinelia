import {
  codificarUtf8CanonicoFederacion,
  normalizarJsonFederacion
} from './CanonicalizadorFederacion.js';
import {
  FAMILIAS_FEDERACION,
  VERSION_PROTOCOLO_FEDERACION,
  VERSIONES_FAMILIA_FEDERACION
} from './CatalogosFederacion.js';
import {
  TTL_ESTADO_OPERATIVO_FEDERADO_PREDETERMINADO_MS
} from './VigenciaEstadoOperativoFederado.js';

export const VERSION_CONFIGURACION_FEDERACION = 1;
export const PERFIL_CONFIGURACION_FEDERACION =
  'sentinelia-federacion-configuracion-v1';
export const VERSION_CAPACIDADES_CONFIGURACION_FEDERACION = 1;
export const PERFIL_CAPACIDADES_CONFIGURACION_FEDERACION =
  'sentinelia-federacion-capacidades-configuracion-v1';

export const BLOQUEOS_CAPACIDADES_CONFIGURACION_FEDERACION = congelarProfundo({
  FEDERACION_DESACTIVADA: 'federacionDesactivada',
  ORIGEN_PUBLICO_AUSENTE: 'origenPublicoAusente',
  PROXIES_CONFIABLES_AUSENTES: 'proxiesConfiablesAusentes'
});

export class ErrorConfiguracionFederacion extends Error {
  constructor(codigo, mensaje, { campo = null } = {}) {
    super(mensaje);
    this.name = 'ErrorConfiguracionFederacion';
    this.codigo = codigo;
    this.campo = campo;
  }
}

export const LIMITES_DUROS_RECURSOS_FEDERACION = congelarProfundo({
  loteMaximoOcurrencias: 5000,
  loteMaximoBytes: 16 * 1024 * 1024,
  ocurrenciaMaximaBytes: 2 * 1024 * 1024
});

export const CONFIGURACIONES_GLOBALES_FEDERACION = congelarProfundo({
  activacionFederacion: {
    clave: 'federacion.activacion',
    tipo: 'booleano',
    defecto: false,
    origenes: ['env', 'sql', 'configuracionPortal'],
    dinamica: true,
    sensible: false
  },
  origenPublico: {
    clave: 'federacion.origen_publico',
    tipo: 'urlHttpsPublica',
    defecto: null,
    origenes: ['env', 'sql', 'configuracionPortal'],
    dinamica: true,
    sensible: false
  },
  proxiesConfiables: {
    clave: 'federacion.proxies_confiables',
    tipo: 'listaIdentificadoresRed',
    defecto: [],
    origenes: ['env', 'sql', 'configuracionPortal'],
    dinamica: true,
    sensible: false
  },
  toleranciaTemporalMs: {
    clave: 'federacion.tolerancia_temporal_ms',
    tipo: 'enteroMs',
    defecto: 5000,
    minimo: 0,
    maximo: 300000,
    origenes: ['env', 'sql', 'configuracionPortal'],
    dinamica: true,
    sensible: false
  },
  loteMaximoOcurrencias: {
    clave: 'federacion.lote_maximo_ocurrencias',
    tipo: 'entero',
    defecto: 200,
    minimo: 1,
    maximo: LIMITES_DUROS_RECURSOS_FEDERACION.loteMaximoOcurrencias,
    origenes: ['env', 'sql', 'configuracionPortal'],
    dinamica: true,
    sensible: false
  },
  loteMaximoBytes: {
    clave: 'federacion.lote_maximo_bytes',
    tipo: 'enteroBytes',
    defecto: 1024 * 1024,
    minimo: 1024,
    maximo: LIMITES_DUROS_RECURSOS_FEDERACION.loteMaximoBytes,
    origenes: ['env', 'sql', 'configuracionPortal'],
    dinamica: true,
    sensible: false
  },
  ocurrenciaMaximaBytes: {
    clave: 'federacion.ocurrencia_maxima_bytes',
    tipo: 'enteroBytes',
    defecto: 256 * 1024,
    minimo: 512,
    maximo: LIMITES_DUROS_RECURSOS_FEDERACION.ocurrenciaMaximaBytes,
    origenes: ['env', 'sql', 'configuracionPortal'],
    dinamica: true,
    sensible: false
  },
  capacidadReceptoraOcurrencias: {
    clave: 'federacion.capacidad_receptora_ocurrencias',
    tipo: 'entero',
    defecto: 1000,
    minimo: 0,
    maximo: 100000,
    origenes: ['env', 'sql', 'configuracionPortal'],
    dinamica: true,
    sensible: false
  },
  ttlEstadoOperativoMs: {
    clave: 'federacion.ttl_estado_operativo_ms',
    tipo: 'enteroMs',
    defecto: TTL_ESTADO_OPERATIVO_FEDERADO_PREDETERMINADO_MS,
    minimo: 1000,
    maximo: 24 * 60 * 60 * 1000,
    origenes: ['env', 'sql', 'configuracionPortal'],
    dinamica: true,
    sensible: false
  },
  silencioRelacionMs: {
    clave: 'federacion.silencio_relacion_ms',
    tipo: 'enteroMs',
    defecto: 120000,
    minimo: 5000,
    maximo: 24 * 60 * 60 * 1000,
    origenes: ['env', 'sql', 'configuracionPortal'],
    dinamica: true,
    sensible: false
  },
  consolidacionReinicioMs: {
    clave: 'federacion.consolidacion_reinicio_ms',
    tipo: 'enteroMs',
    defecto: 60000,
    minimo: 0,
    maximo: 60 * 60 * 1000,
    origenes: ['env', 'sql', 'configuracionPortal'],
    dinamica: true,
    sensible: false
  },
  retencionMaximaDias: {
    clave: 'federacion.retencion_maxima_dias',
    tipo: 'enteroDias',
    defecto: 90,
    minimo: 1,
    maximo: 3650,
    origenes: ['env', 'sql', 'configuracionPortal'],
    dinamica: true,
    sensible: false
  },
  keyringReferenciaDespliegue: {
    clave: 'federacion.keyring_referencia_despliegue',
    tipo: 'referenciaKeyring',
    defecto: 'sentinelia/federacion/v1',
    origenes: ['env', 'sql'],
    dinamica: true,
    sensible: false
  }
});

export function normalizarConfiguracionFederacion(entrada = {}) {
  try {
    entrada = normalizarJsonFederacion(entrada);
  } catch {
    fallar(
      'configuracion_invalida',
      'La configuracion federada debe ser un objeto JSON de datos.',
      'configuracion'
    );
  }
  entrada = desenvolverConfiguracionNormalizada(entrada);
  if (!entrada || typeof entrada !== 'object' || Array.isArray(entrada)) {
    fallar(
      'configuracion_invalida',
      'La configuracion federada debe ser un objeto.',
      'configuracion'
    );
  }
  rechazarClavesDesconocidas(entrada, CONFIGURACIONES_GLOBALES_FEDERACION);
  const normalizada = {};
  for (const [nombre, definicion] of Object.entries(
    CONFIGURACIONES_GLOBALES_FEDERACION
  )) {
    const valor = Object.hasOwn(entrada, nombre)
      ? entrada[nombre]
      : definicion.defecto;
    normalizada[nombre] = normalizarValorConfiguracion(nombre, definicion, valor);
  }
  if (
    normalizada.ocurrenciaMaximaBytes > normalizada.loteMaximoBytes
  ) {
    fallar(
      'limites_recursos_incoherentes',
      'Una ocurrencia no puede admitir mas bytes que el lote completo.',
      'ocurrenciaMaximaBytes'
    );
  }
  return normalizarJsonFederacion({
    perfil: PERFIL_CONFIGURACION_FEDERACION,
    version: VERSION_CONFIGURACION_FEDERACION,
    ...normalizada
  });
}

export function proyectarCapacidadesConfiguracionFederacion(configuracion = {}) {
  const config = normalizarConfiguracionFederacion(configuracion);
  const bloqueosEmision = [];
  const bloqueosRecepcion = [];
  if (!config.activacionFederacion) {
    bloqueosEmision.push(
      BLOQUEOS_CAPACIDADES_CONFIGURACION_FEDERACION.FEDERACION_DESACTIVADA
    );
    bloqueosRecepcion.push(
      BLOQUEOS_CAPACIDADES_CONFIGURACION_FEDERACION.FEDERACION_DESACTIVADA
    );
  }
  if (config.origenPublico === null) {
    bloqueosRecepcion.push(
      BLOQUEOS_CAPACIDADES_CONFIGURACION_FEDERACION.ORIGEN_PUBLICO_AUSENTE
    );
  }
  if (config.proxiesConfiables.length === 0) {
    bloqueosRecepcion.push(
      BLOQUEOS_CAPACIDADES_CONFIGURACION_FEDERACION.PROXIES_CONFIABLES_AUSENTES
    );
  }
  return normalizarJsonFederacion({
    perfil: PERFIL_CAPACIDADES_CONFIGURACION_FEDERACION,
    version: VERSION_CAPACIDADES_CONFIGURACION_FEDERACION,
    activacionGlobal: config.activacionFederacion,
    emisionDisponible: bloqueosEmision.length === 0,
    recepcionPreparada: bloqueosRecepcion.length === 0,
    bloqueos: {
      emision: bloqueosEmision,
      recepcion: bloqueosRecepcion
    }
  });
}

export function crearDeclaracionCapacidadReceptoraFederacion({
  configuracion,
  familiasSoportadas,
  versionesFamilia,
  protocoloVersion,
  disponible = true,
  prioridadOperativaActual = true
} = {}) {
  const config = normalizarConfiguracionFederacion(configuracion);
  const capacidades = proyectarCapacidadesConfiguracionFederacion(config);
  const familias = normalizarFamiliasSoportadas(familiasSoportadas);
  const disponibilidadSolicitada = exigirBooleano(disponible, 'disponible');
  versionesFamilia = normalizarEntradaJsonConfiguracion(
    versionesFamilia,
    'versiones_familia_invalidas',
    'La capacidad receptora debe declarar versiones por familia.',
    'versionesFamilia'
  );
  if (!versionesFamilia || typeof versionesFamilia !== 'object' || Array.isArray(versionesFamilia)) {
    fallar(
      'versiones_familia_invalidas',
      'La capacidad receptora debe declarar versiones por familia.',
      'versionesFamilia'
    );
  }
  return normalizarJsonFederacion({
    perfil: 'sentinelia-federacion-capacidad-receptora-v1',
    protocoloVersion: exigirVersionProtocolo(protocoloVersion),
    disponible: capacidades.recepcionPreparada && disponibilidadSolicitada,
    prioridadOperativaActual: exigirBooleano(
      prioridadOperativaActual,
      'prioridadOperativaActual'
    ),
    maximoOcurrenciasPorLote: config.loteMaximoOcurrencias,
    maximoBytesPorLote: config.loteMaximoBytes,
    maximoBytesPorOcurrencia: config.ocurrenciaMaximaBytes,
    capacidadTemporalOcurrencias: config.capacidadReceptoraOcurrencias,
    toleranciaTemporalMs: config.toleranciaTemporalMs,
    familiasSoportadas: familias,
    versionesFamilia: normalizarVersionesFamilia(versionesFamilia, familias)
  });
}

export function medirRecursosCanonicosFederacion(valor) {
  return congelarProfundo({
    bytesCanonicos: codificarUtf8CanonicoFederacion(valor).byteLength
  });
}

export function validarRecursosLoteFederacion({
  ocurrencias,
  configuracion
} = {}) {
  exigirListaDensaDatos(
    ocurrencias,
    'lote_invalido',
    'El lote federado debe declarar una lista densa de ocurrencias o envolventes.',
    'ocurrencias'
  );
  const config = normalizarConfiguracionFederacion(configuracion);
  if (ocurrencias.length > config.loteMaximoOcurrencias) {
    fallar(
      'lote_excede_limites',
      'El lote supera el maximo de ocurrencias aceptado por el receptor.',
      'ocurrencias'
    );
  }
  const detalle = [];
  let bytesCanonicos = 2;
  for (let indice = 0; indice < ocurrencias.length; indice += 1) {
    const bytesOcurrencia = codificarUtf8CanonicoFederacion(
      materializarJson(ocurrencias[indice])
    ).byteLength;
    if (bytesOcurrencia > config.ocurrenciaMaximaBytes) {
      fallar(
        'ocurrencia_excede_limite',
        'Una ocurrencia supera el maximo de bytes aceptado por el receptor.',
        `ocurrencias[${indice}]`
      );
    }
    bytesCanonicos += bytesOcurrencia + (indice === 0 ? 0 : 1);
    if (bytesCanonicos > config.loteMaximoBytes) {
      fallar(
        'lote_excede_limites',
        'El lote supera el maximo de bytes aceptado por el receptor.',
        'ocurrencias'
      );
    }
    detalle.push({ indice, bytesCanonicos: bytesOcurrencia });
  }
  return congelarProfundo({
    ocurrencias: ocurrencias.length,
    bytesCanonicos,
    detalle
  });
}

function desenvolverConfiguracionNormalizada(entrada) {
  if (
    entrada &&
    typeof entrada === 'object' &&
    !Array.isArray(entrada) &&
    entrada.perfil === PERFIL_CONFIGURACION_FEDERACION &&
    entrada.version === VERSION_CONFIGURACION_FEDERACION
  ) {
    const { perfil, version, ...valores } = entrada;
    return valores;
  }
  return entrada;
}

function materializarJson(valor) {
  if (valor === null || (typeof valor !== 'object' && typeof valor !== 'function')) {
    return valor;
  }
  let propietario = valor;
  const visitados = new Set();
  while (propietario !== null) {
    if (visitados.has(propietario)) {
      fallar(
        'ocurrencia_invalida',
        'La materializacion JSON contiene una cadena de prototipos ciclica.',
        'ocurrencias[].toJSON'
      );
    }
    visitados.add(propietario);
    const descriptor = Object.getOwnPropertyDescriptor(propietario, 'toJSON');
    if (descriptor) {
      if (!('value' in descriptor)) {
        fallar(
          'ocurrencia_invalida',
          'La materializacion JSON no puede depender de un accessor.',
          'ocurrencias[].toJSON'
        );
      }
      return typeof descriptor.value === 'function'
        ? Reflect.apply(descriptor.value, valor, [])
        : valor;
    }
    propietario = Object.getPrototypeOf(propietario);
  }
  return valor;
}

function normalizarValorConfiguracion(nombre, definicion, valor) {
  if (definicion.tipo === 'booleano') {
    return exigirBooleano(valor, nombre);
  }
  if (definicion.tipo === 'urlHttpsPublica') {
    return valor === null ? null : normalizarUrlHttpsPublica(valor, nombre);
  }
  if (definicion.tipo === 'listaIdentificadoresRed') {
    return listaIdentificadoresRed(valor, nombre);
  }
  if (
    definicion.tipo === 'entero' ||
    definicion.tipo === 'enteroMs' ||
    definicion.tipo === 'enteroBytes' ||
    definicion.tipo === 'enteroDias'
  ) {
    return exigirEnteroRango(valor, definicion, nombre);
  }
  if (definicion.tipo === 'referenciaKeyring') {
    return normalizarReferenciaKeyring(valor, nombre);
  }
  fallar(
    'tipo_configuracion_desconocido',
    'La definicion de configuracion usa un tipo no soportado.',
    nombre
  );
}

function normalizarUrlHttpsPublica(valor, campo) {
  if (typeof valor !== 'string' || valor.length > 2048) {
    fallar(
      'origen_publico_invalido',
      'El origen publico debe ser una URL HTTPS canonica.',
      campo
    );
  }
  let url;
  try {
    url = new URL(valor);
  } catch {
    fallar(
      'origen_publico_invalido',
      'El origen publico debe ser una URL HTTPS canonica.',
      campo
    );
  }
  if (
    url.protocol !== 'https:' ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    (url.pathname !== '/' && url.pathname !== '')
  ) {
    fallar(
      'origen_publico_invalido',
      'El origen publico solo declara esquema, host y puerto HTTPS.',
      campo
    );
  }
  return url.origin;
}

function listaIdentificadoresRed(valor, campo) {
  if (!Array.isArray(valor)) {
    fallar(
      'proxies_confiables_invalidos',
      'Los proxies confiables deben formar una lista.',
      campo
    );
  }
  const vistos = new Set();
  const resultado = [];
  for (const [indice, entrada] of valor.entries()) {
    if (
      typeof entrada !== 'string' ||
      entrada.length === 0 ||
      entrada.length > 128 ||
      entrada === '*' ||
      /[\s"'\\]/.test(entrada) ||
      !/^[A-Za-z0-9._:/-]+$/.test(entrada)
    ) {
      fallar(
        'proxy_confiable_invalido',
        'Cada proxy confiable debe ser un identificador de red opaco, acotado y sin secretos.',
        `${campo}[${indice}]`
      );
    }
    if (!vistos.has(entrada)) {
      vistos.add(entrada);
      resultado.push(entrada);
    }
  }
  return Object.freeze(resultado.sort());
}

function normalizarReferenciaKeyring(valor, campo) {
  if (
    typeof valor !== 'string' ||
    valor.length === 0 ||
    valor.length > 200 ||
    /[\r\n]/.test(valor) ||
    /(?:secret|password|token|-----BEGIN|=)/i.test(valor)
  ) {
    fallar(
      'referencia_keyring_invalida',
      'La referencia al keyring debe ser un identificador opaco, no material secreto.',
      campo
    );
  }
  return valor;
}

function normalizarFamiliasSoportadas(familiasSoportadas) {
  familiasSoportadas = normalizarEntradaJsonConfiguracion(
    familiasSoportadas,
    'familias_soportadas_invalidas',
    'La capacidad receptora debe declarar al menos una familia soportada.',
    'familiasSoportadas'
  );
  if (!Array.isArray(familiasSoportadas) || familiasSoportadas.length === 0) {
    fallar(
      'familias_soportadas_invalidas',
      'La capacidad receptora debe declarar al menos una familia soportada.',
      'familiasSoportadas'
    );
  }
  if (new Set(familiasSoportadas).size !== familiasSoportadas.length) {
    fallar(
      'familias_soportadas_invalidas',
      'Las familias soportadas no pueden repetirse.',
      'familiasSoportadas'
    );
  }
  const familias = familiasSoportadas.map((familia) =>
    FAMILIAS_FEDERACION.exigir(familia, { campo: 'familiasSoportadas' }));
  const orden = new Map(
    FAMILIAS_FEDERACION.valores.map((familia, indice) => [familia, indice])
  );
  return Object.freeze([...familias].sort(
    (familiaA, familiaB) => orden.get(familiaA) - orden.get(familiaB)
  ));
}

function normalizarEntradaJsonConfiguracion(valor, codigo, mensaje, campo) {
  try {
    return normalizarJsonFederacion(valor);
  } catch {
    fallar(codigo, mensaje, campo);
  }
}

function exigirVersionProtocolo(version) {
  if (version !== VERSION_PROTOCOLO_FEDERACION) {
    fallar(
      'version_protocolo_incompatible',
      'La capacidad receptora debe declarar la version vigente del protocolo.',
      'protocoloVersion'
    );
  }
  return version;
}

function normalizarVersionesFamilia(versionesFamilia, familiasSoportadas) {
  const claves = Object.keys(versionesFamilia).sort();
  const esperadas = [...familiasSoportadas].sort();
  if (
    claves.length !== esperadas.length ||
    claves.some((familia, indice) => familia !== esperadas[indice])
  ) {
    fallar(
      'versiones_familia_incoherentes',
      'Las versiones deben corresponder exactamente con las familias soportadas.',
      'versionesFamilia'
    );
  }
  const resultado = {};
  for (const familia of familiasSoportadas) {
    const version = versionesFamilia[familia];
    FAMILIAS_FEDERACION.exigir(familia, { campo: 'versionesFamilia' });
    if (version !== VERSIONES_FAMILIA_FEDERACION[familia]) {
      fallar(
        'version_familia_incompatible',
        `La familia ${familia} debe declarar su version contractual vigente.`,
        `versionesFamilia.${familia}`
      );
    }
    resultado[familia] = version;
  }
  return normalizarJsonFederacion(resultado);
}

function exigirBooleano(valor, campo) {
  if (typeof valor !== 'boolean') {
    fallar('booleano_invalido', `${campo} debe ser booleano.`, campo);
  }
  return valor;
}

function exigirEnteroRango(valor, definicion, campo) {
  if (
    !Number.isSafeInteger(valor) ||
    valor < definicion.minimo ||
    valor > definicion.maximo
  ) {
    fallar(
      'entero_fuera_rango',
      `${campo} debe estar entre ${definicion.minimo} y ${definicion.maximo}.`,
      campo
    );
  }
  return valor;
}

function rechazarClavesDesconocidas(entrada, definiciones) {
  const admitidas = new Set(Object.keys(definiciones));
  const desconocidas = Object.keys(entrada).filter((clave) => !admitidas.has(clave));
  if (desconocidas.length > 0) {
    fallar(
      'configuracion_desconocida',
      `La configuracion federada contiene claves desconocidas: ${desconocidas.join(', ')}.`,
      desconocidas[0]
    );
  }
}

function exigirListaDensaDatos(valor, codigo, mensaje, campo) {
  if (!Array.isArray(valor)) fallar(codigo, mensaje, campo);
  const claves = Reflect.ownKeys(valor);
  if (claves.some((clave) =>
    clave !== 'length' &&
    !(
      typeof clave === 'string' &&
      /^(0|[1-9][0-9]*)$/.test(clave) &&
      Number(clave) < valor.length
    ))) {
    fallar(codigo, mensaje, campo);
  }
  for (let indice = 0; indice < valor.length; indice += 1) {
    const descriptor = Object.getOwnPropertyDescriptor(valor, String(indice));
    if (!descriptor || descriptor.enumerable !== true || !('value' in descriptor)) {
      fallar(codigo, mensaje, campo);
    }
  }
}

function congelarProfundo(valor) {
  if (valor === null || typeof valor !== 'object') return valor;
  for (const descendiente of Object.values(valor)) {
    congelarProfundo(descendiente);
  }
  return Object.freeze(valor);
}

function fallar(codigo, mensaje, campo) {
  throw new ErrorConfiguracionFederacion(codigo, mensaje, { campo });
}

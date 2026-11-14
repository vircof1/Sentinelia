import {
  CAPACIDADES_COMPLETITUD_FEDERACION,
  ESTADOS_AUTORIZACION_PROYECCION_FEDERACION,
  ESTADOS_COMPLETITUD_PROYECCION_FEDERACION,
  ESTADOS_MATERIALIZACION_PROYECCION_FEDERACION,
  ESTADOS_REQUISITO_COMPLETITUD_FEDERACION,
  ESTADOS_SOPORTE_PROYECCION_FEDERACION,
  ESTADOS_VIGENCIA_PROYECCION_FEDERACION
} from './CatalogosFederacion.js';
import { normalizarJsonFederacion } from './CanonicalizadorFederacion.js';
import {
  TIPOS_IDENTIDAD_FEDERADA,
  exigirIdentidadFederada
} from './IdentidadFederada.js';

const PATRON_ENTERO_DECIMAL = /^(0|[1-9][0-9]*)$/;

export class ErrorEstadoProyeccionFederacion extends Error {
  constructor(codigo, mensaje, { campo = null } = {}) {
    super(mensaje);
    this.name = 'ErrorEstadoProyeccionFederacion';
    this.codigo = codigo;
    this.campo = campo;
  }
}

export function evaluarCompletitudFederacion(requisitosPorCapacidad = {}) {
  const esperadas = [...CAPACIDADES_COMPLETITUD_FEDERACION.valores].sort();
  exigirObjetoDatosCerrado(
    requisitosPorCapacidad,
    esperadas,
    'capacidades_completitud_incompletas',
    'Deben evaluarse por separado interpretable, observable y reconstruible.',
    'requisitosPorCapacidad'
  );
  const resultado = {};
  for (const capacidad of CAPACIDADES_COMPLETITUD_FEDERACION.valores) {
    const requisitos = normalizarRequisitos(
      requisitosPorCapacidad[capacidad],
      capacidad
    );
    const fallidos = requisitos.filter((requisito) => requisito.estado === 'fallido');
    const faltantes = requisitos.filter((requisito) => requisito.estado === 'faltante');
    const estado = fallidos.length > 0
      ? 'degradada'
      : faltantes.length > 0
        ? 'parcial'
        : 'completa';
    ESTADOS_COMPLETITUD_PROYECCION_FEDERACION.exigir(estado);
    resultado[capacidad] = {
      estado,
      causas: [...fallidos, ...faltantes].map(({ id, estado: condicion, causa }) => ({
        requisitoId: id,
        condicion,
        causa
      }))
    };
  }
  return normalizarJsonFederacion(resultado);
}

export function calcularVigenciaEfectivaFederacion({
  vigenciaOrigenMs,
  vigenciasSaltosMs = [],
  limiteReceptorMs,
  transcurridoDesdeRecepcionMs = '0',
  retiradaExplicita = false
} = {}) {
  exigirBooleano(retiradaExplicita, 'retiradaExplicita');
  const origen = exigirEnteroDecimal(vigenciaOrigenMs, 'vigenciaOrigenMs');
  const limite = exigirEnteroDecimal(limiteReceptorMs, 'limiteReceptorMs');
  const transcurrido = exigirEnteroDecimal(
    transcurridoDesdeRecepcionMs,
    'transcurridoDesdeRecepcionMs'
  );
  exigirListaDensa(
    vigenciasSaltosMs,
    'vigencias_saltos_invalidas',
    'Las vigencias intermedias deben formar una lista densa.',
    'vigenciasSaltosMs'
  );
  const saltos = vigenciasSaltosMs.map((valor, indice) =>
    exigirEnteroDecimal(valor, `vigenciasSaltosMs[${indice}]`));
  const frontera = [origen, ...saltos, limite]
    .map(BigInt)
    .reduce((menor, actual) => actual < menor ? actual : menor);
  const restante = frontera > BigInt(transcurrido)
    ? frontera - BigInt(transcurrido)
    : 0n;
  const estado = retiradaExplicita
    ? 'retirada'
    : restante > 0n
      ? 'vigente'
      : 'vencida';
  ESTADOS_VIGENCIA_PROYECCION_FEDERACION.exigir(estado);
  return normalizarJsonFederacion({
    estado,
    vigenciaFronteraMs: frontera.toString(),
    vigenciaRestanteMs: retiradaExplicita ? '0' : restante.toString(),
    transcurridoDesdeRecepcionMs: transcurrido
  });
}

export function evaluarDimensionesProyeccionFederada({
  materializacion,
  autoridadActual,
  retiradaOrigen = false,
  contribuciones = []
} = {}) {
  const materializacionValidada =
    ESTADOS_MATERIALIZACION_PROYECCION_FEDERACION.exigir(materializacion);
  exigirBooleano(autoridadActual, 'autoridadActual');
  exigirBooleano(retiradaOrigen, 'retiradaOrigen');
  const contribucionesNormalizadas = normalizarContribuciones(contribuciones);
  const temporalmenteVigentes = contribucionesNormalizadas.filter(
    (contribucion) =>
      !retiradaOrigen && contribucion.vigente
  );
  const activas = contribucionesNormalizadas.filter(
    (contribucion) =>
      !retiradaOrigen &&
      contribucion.legitima && contribucion.vigente && !contribucion.retirada
  );
  const campos = [...new Set(
    contribucionesNormalizadas.flatMap((contribucion) => contribucion.campos)
  )].sort();
  const soporteCampos = Object.fromEntries(campos.map((campo) => [
    campo,
    activas.some((contribucion) => contribucion.campos.includes(campo))
      ? 'sostenida'
      : 'huerfana'
  ]));
  for (const estado of Object.values(soporteCampos)) {
    ESTADOS_SOPORTE_PROYECCION_FEDERACION.exigir(estado);
  }
  const soporte = activas.length > 0 ? 'sostenida' : 'huerfana';
  const vigencia = retiradaOrigen
    ? 'retirada'
    : temporalmenteVigentes.length > 0
      ? 'vigente'
      : 'vencida';
  const autorizacion = autoridadActual ? 'autorizada' : 'noAutorizada';
  ESTADOS_SOPORTE_PROYECCION_FEDERACION.exigir(soporte);
  ESTADOS_VIGENCIA_PROYECCION_FEDERACION.exigir(vigencia);
  ESTADOS_AUTORIZACION_PROYECCION_FEDERACION.exigir(autorizacion);
  return normalizarJsonFederacion({
    materializacion: materializacionValidada,
    vigencia,
    soporte,
    autorizacion,
    soporteCampos
  });
}

function normalizarRequisitos(requisitos, capacidad) {
  exigirListaDensa(
    requisitos,
    'requisitos_completitud_invalidos',
    `${capacidad} debe declarar una lista densa de requisitos.`,
    capacidad
  );
  const ids = new Set();
  return requisitos.map((requisito, indice) => {
    const campo = `${capacidad}[${indice}]`;
    exigirObjetoDatosCerrado(
      requisito,
      ['causa', 'estado', 'id'],
      'requisito_invalido',
      `${campo} no usa la forma cerrada.`,
      campo
    );
    exigirTexto(requisito.id, `${campo}.id`);
    if (ids.has(requisito.id)) {
      fallar('requisito_duplicado', `${campo} repite un requisito.`, campo);
    }
    ids.add(requisito.id);
    const estado = ESTADOS_REQUISITO_COMPLETITUD_FEDERACION.exigir(requisito.estado);
    const exigeCausa = estado === 'faltante' || estado === 'fallido';
    if (
      (exigeCausa && (typeof requisito.causa !== 'string' || requisito.causa.length === 0)) ||
      (!exigeCausa && requisito.causa !== null)
    ) {
      fallar(
        'causa_requisito_incoherente',
        `${campo} no declara una causa coherente con su estado.`,
        `${campo}.causa`
      );
    }
    return { id: requisito.id, estado, causa: requisito.causa };
  }).sort((requisitoA, requisitoB) => {
    if (requisitoA.id < requisitoB.id) return -1;
    if (requisitoA.id > requisitoB.id) return 1;
    return 0;
  });
}

function normalizarContribuciones(contribuciones) {
  exigirListaDensa(
    contribuciones,
    'contribuciones_invalidas',
    'Las contribuciones deben formar una lista densa.',
    'contribuciones'
  );
  const ids = new Set();
  return contribuciones.map((contribucion, indice) => {
    const campo = `contribuciones[${indice}]`;
    exigirObjetoDatosCerrado(
      contribucion,
      ['campos', 'contribucionId', 'legitima', 'retirada', 'vigente'],
      'contribucion_invalida',
      `${campo} no usa la forma cerrada.`,
      campo
    );
    const contribucionId = exigirIdentidadFederada(
      contribucion.contribucionId,
      {
        tipo: TIPOS_IDENTIDAD_FEDERADA.CONTRIBUCION,
        campo: `${campo}.contribucionId`
      }
    ).serializar();
    if (ids.has(contribucionId)) {
      fallar('contribucion_duplicada', `${campo} repite una contribución.`, campo);
    }
    ids.add(contribucionId);
    exigirBooleano(contribucion.legitima, `${campo}.legitima`);
    exigirBooleano(contribucion.vigente, `${campo}.vigente`);
    exigirBooleano(contribucion.retirada, `${campo}.retirada`);
    exigirListaDensa(
      contribucion.campos,
      'campos_contribucion_invalidos',
      `${campo}.campos debe ser una lista densa de textos unicos.`,
      `${campo}.campos`
    );
    if (
      contribucion.campos.some((valor) => typeof valor !== 'string' || valor.length === 0) ||
      new Set(contribucion.campos).size !== contribucion.campos.length
    ) {
      fallar('campos_contribucion_invalidos', `${campo}.campos no es válido.`, `${campo}.campos`);
    }
    return {
      contribucionId,
      legitima: contribucion.legitima,
      vigente: contribucion.vigente,
      retirada: contribucion.retirada,
      campos: [...contribucion.campos].sort()
    };
  });
}

function exigirEnteroDecimal(valor, campo) {
  if (typeof valor !== 'string' || !PATRON_ENTERO_DECIMAL.test(valor)) {
    fallar(
      'entero_decimal_invalido',
      `${campo} debe ser un entero decimal canónico no negativo.`,
      campo
    );
  }
  return valor;
}

function exigirTexto(valor, campo) {
  if (typeof valor !== 'string' || valor.length === 0) {
    fallar('texto_invalido', `${campo} debe ser un texto no vacío.`, campo);
  }
}

function exigirBooleano(valor, campo) {
  if (typeof valor !== 'boolean') {
    fallar('booleano_invalido', `${campo} debe ser booleano.`, campo);
  }
}

function exigirObjetoDatosCerrado(
  valor,
  esperadas,
  codigo,
  mensaje,
  campo
) {
  if (
    valor === null ||
    typeof valor !== 'object' ||
    Array.isArray(valor) ||
    Object.getPrototypeOf(valor) !== Object.prototype
  ) {
    fallar(codigo, mensaje, campo);
  }
  const claves = Reflect.ownKeys(valor);
  if (claves.some((clave) => typeof clave !== 'string')) {
    fallar(codigo, mensaje, campo);
  }
  for (const clave of claves) {
    const descriptor = Object.getOwnPropertyDescriptor(valor, clave);
    if (!descriptor || descriptor.enumerable !== true || !('value' in descriptor)) {
      fallar(codigo, mensaje, campo);
    }
  }
  const observadas = [...claves].sort();
  const requeridas = [...esperadas].sort();
  if (
    observadas.length !== requeridas.length ||
    observadas.some((clave, indice) => clave !== requeridas[indice])
  ) {
    fallar(codigo, mensaje, campo);
  }
}

function exigirListaDensa(valor, codigo, mensaje, campo) {
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

function fallar(codigo, mensaje, campo) {
  throw new ErrorEstadoProyeccionFederacion(codigo, mensaje, { campo });
}

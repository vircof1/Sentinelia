import {
  canonicalizarJsonFederacion,
  normalizarJsonFederacion
} from './CanonicalizadorFederacion.js';
import {
  FAMILIAS_FEDERACION,
  PRIORIDADES_FLUJO_FEDERACION,
  VERSIONES_FAMILIA_FEDERACION
} from './CatalogosFederacion.js';
import {
  TIPOS_IDENTIDAD_FEDERADA,
  crearIdentidadFederada
} from './IdentidadFederada.js';

const PERFIL_FRAGMENTO = 'sentinelia-federacion-fragmento-tipado-v1';
const encoder = new TextEncoder();

export class ErrorPlanificacionLotesFederacion extends Error {
  constructor(codigo, mensaje) {
    super(mensaje);
    this.name = 'ErrorPlanificacionLotesFederacion';
    this.codigo = codigo;
  }
}

export function crearContratoFragmentacionTipadaFederacion({
  familia,
  versionFamilia,
  tipo,
  maximoFragmentos = 10000,
  maximoBytesReagrupados = 16 * 1024 * 1024
} = {}) {
  const familiaValidada = FAMILIAS_FEDERACION.exigir(familia, { campo: 'familia' });
  if (versionFamilia !== VERSIONES_FAMILIA_FEDERACION[familiaValidada]) {
    throw new ErrorPlanificacionLotesFederacion(
      'version_fragmentacion_incompatible',
      'El contrato de fragmentación no corresponde a la versión de la familia.'
    );
  }
  if (typeof tipo !== 'string' || !/^[A-Za-z][A-Za-z0-9._-]{0,63}$/u.test(tipo)) {
    throw new ErrorPlanificacionLotesFederacion(
      'tipo_fragmentacion_invalido',
      'La fragmentación exige un tipo contractual estable y acotado.'
    );
  }
  const limite = enteroAcotado(maximoFragmentos, 2, 100000, 'maximoFragmentos');
  const limiteBytes = enteroAcotado(
    maximoBytesReagrupados,
    2,
    16 * 1024 * 1024,
    'maximoBytesReagrupados'
  );
  return Object.freeze({
    familia: familiaValidada,
    versionFamilia,
    tipo,
    maximoFragmentos: limite,
    maximoBytesReagrupados: limiteBytes
  });
}

export function fragmentarOcurrenciaTipadaFederacion({
  ocurrencia,
  entregaId,
  contrato,
  maximoBytesFragmento,
  calcularHuella
} = {}) {
  exigirCalculadorHuella(calcularHuella);
  const contratoAplicado = normalizarContratoFragmentacion(contrato);
  const entrega = identidad(entregaId, TIPOS_IDENTIDAD_FEDERADA.ENTREGA, 'entregaId');
  const contenido = materializarJson(ocurrencia);
  const canonico = canonicalizarJsonFederacion(contenido);
  exigirContratoOcurrencia(contratoAplicado, contenido);
  if (encoder.encode(canonico).byteLength > contratoAplicado.maximoBytesReagrupados) {
    throw new ErrorPlanificacionLotesFederacion(
      'fragmentacion_excede_limite',
      'La ocurrencia supera el máximo contractual que puede reagruparse.'
    );
  }
  const maximo = enteroAcotado(maximoBytesFragmento, 1, 2 * 1024 * 1024, 'maximoBytesFragmento');
  const partes = dividirUtf8(canonico, maximo);
  if (partes.length < 2 || partes.length > contratoAplicado.maximoFragmentos) {
    throw new ErrorPlanificacionLotesFederacion(
      'cantidad_fragmentos_invalida',
      'El contenido no produce una fragmentación admitida por su contrato.'
    );
  }
  const huellaOcurrencia = huella(calcularHuella, canonico);
  const identidadOcurrencia = extraerIdentidadOcurrencia(contenido);
  const fragmentos = partes.map((parte, indice) => Object.freeze({
    perfil: PERFIL_FRAGMENTO,
    tipo: contratoAplicado.tipo,
    familia: contratoAplicado.familia,
    familiaVersion: contratoAplicado.versionFamilia,
    entregaId: entrega,
    fragmentoId: `${entrega}#${contratoAplicado.tipo}#${indice + 1}`,
    ordinal: indice + 1,
    total: partes.length,
    identidadOcurrencia,
    huellaOcurrencia,
    huellaContenido: huella(calcularHuella, parte),
    contenido: parte
  }));
  return Object.freeze({
    contrato: contratoAplicado,
    identidadOcurrencia,
    huellaOcurrencia,
    fragmentos: Object.freeze(fragmentos)
  });
}

export function reagruparFragmentosTipadosFederacion({
  fragmentos,
  contrato,
  calcularHuella
} = {}) {
  exigirCalculadorHuella(calcularHuella);
  const contratoAplicado = normalizarContratoFragmentacion(contrato);
  if (!Array.isArray(fragmentos) || fragmentos.length < 2) {
    throw new ErrorPlanificacionLotesFederacion(
      'fragmentos_incompletos',
      'La reagrupación exige un conjunto fragmentado completo.'
    );
  }
  if (fragmentos.length > contratoAplicado.maximoFragmentos) {
    throw new ErrorPlanificacionLotesFederacion(
      'fragmentos_incompletos',
      'La colección supera el máximo de fragmentos antes de poder ordenarse.'
    );
  }
  let bytesReagrupados = 0;
  for (const fragmento of fragmentos) {
    if (typeof fragmento?.contenido !== 'string') {
      throw new ErrorPlanificacionLotesFederacion(
        'fragmentacion_divergente',
        'Cada fragmento debe contener texto UTF-8 explícito.'
      );
    }
    bytesReagrupados += encoder.encode(fragmento.contenido).byteLength;
    if (bytesReagrupados > contratoAplicado.maximoBytesReagrupados) {
      throw new ErrorPlanificacionLotesFederacion(
        'fragmentacion_excede_limite',
        'La reagrupación supera su máximo contractual antes de concatenarse.'
      );
    }
  }
  const ordenados = [...fragmentos].sort((a, b) => a.ordinal - b.ordinal);
  const primero = ordenados[0];
  if (ordenados.length !== primero.total ||
      ordenados.length > contratoAplicado.maximoFragmentos) {
    throw new ErrorPlanificacionLotesFederacion(
      'fragmentos_incompletos',
      'La cantidad recibida no coincide con el cierre declarado.'
    );
  }
  for (let indice = 0; indice < ordenados.length; indice += 1) {
    const fragmento = ordenados[indice];
    if (fragmento.perfil !== PERFIL_FRAGMENTO ||
        fragmento.tipo !== contratoAplicado.tipo ||
        fragmento.familia !== contratoAplicado.familia ||
        fragmento.familiaVersion !== contratoAplicado.versionFamilia ||
        fragmento.ordinal !== indice + 1 || fragmento.total !== ordenados.length ||
        fragmento.entregaId !== primero.entregaId ||
        fragmento.huellaOcurrencia !== primero.huellaOcurrencia ||
        canonicalizarJsonFederacion(fragmento.identidadOcurrencia) !==
          canonicalizarJsonFederacion(primero.identidadOcurrencia) ||
        huella(calcularHuella, fragmento.contenido) !== fragmento.huellaContenido) {
      throw new ErrorPlanificacionLotesFederacion(
        'fragmentacion_divergente',
        'Los fragmentos no forman una serie tipada, íntegra y coherente.'
      );
    }
  }
  const canonico = ordenados.map((fragmento) => fragmento.contenido).join('');
  if (huella(calcularHuella, canonico) !== primero.huellaOcurrencia) {
    throw new ErrorPlanificacionLotesFederacion(
      'fragmentacion_divergente',
      'La huella del contenido reagrupado no coincide con la ocurrencia.'
    );
  }
  let contenido;
  try {
    contenido = JSON.parse(canonico);
  } catch {
    throw new ErrorPlanificacionLotesFederacion(
      'fragmentacion_no_representable',
      'El contenido reagrupado no es una ocurrencia JSON.'
    );
  }
  exigirContratoOcurrencia(contratoAplicado, contenido);
  if (canonicalizarJsonFederacion(contenido) !== canonico ||
      canonicalizarJsonFederacion(extraerIdentidadOcurrencia(contenido)) !==
        canonicalizarJsonFederacion(primero.identidadOcurrencia)) {
    throw new ErrorPlanificacionLotesFederacion(
      'fragmentacion_divergente',
      'La reagrupación intenta reinterpretar la ocurrencia original.'
    );
  }
  return normalizarJsonFederacion(contenido);
}

function normalizarContratoFragmentacion(contrato) {
  if (!contrato || typeof contrato !== 'object' || Array.isArray(contrato)) {
    throw new ErrorPlanificacionLotesFederacion(
      'contrato_fragmentacion_incompatible',
      'La fragmentación exige un contrato tipado aplicable.'
    );
  }
  return crearContratoFragmentacionTipadaFederacion({
    familia: contrato.familia,
    versionFamilia: contrato.versionFamilia,
    tipo: contrato.tipo,
    maximoFragmentos: contrato.maximoFragmentos,
    maximoBytesReagrupados: contrato.maximoBytesReagrupados
  });
}

export function planificarLotesFederacion({
  relacionId,
  flujoId,
  generacionId,
  revisionConcesionEfectiva = null,
  candidatos,
  capacidad,
  generarLoteId
} = {}) {
  const relacion = identidad(relacionId, TIPOS_IDENTIDAD_FEDERADA.RELACION, 'relacionId');
  const flujo = identidad(flujoId, TIPOS_IDENTIDAD_FEDERADA.FLUJO, 'flujoId');
  const generacion = identidad(
    generacionId,
    TIPOS_IDENTIDAD_FEDERADA.GENERACION,
    'generacionId'
  );
  const revision = revisionConcesionEfectiva === null
    ? null
    : identidad(
      revisionConcesionEfectiva,
      TIPOS_IDENTIDAD_FEDERADA.REVISION_CONCESION,
      'revisionConcesionEfectiva'
    );
  if (!Array.isArray(candidatos) || typeof generarLoteId !== 'function') {
    throw new ErrorPlanificacionLotesFederacion(
      'planificacion_invalida',
      'La planificación exige candidatos y un generador de lote.'
    );
  }
  const limites = normalizarLimites(capacidad);
  const normalizados = candidatos.map(normalizarCandidato).sort(compararCandidatos);
  if (new Set(normalizados.map((candidato) => candidato.entregaId)).size !==
        normalizados.length ||
      new Set(normalizados.map((candidato) => candidato.posicionFlujo)).size !==
        normalizados.length) {
    throw new ErrorPlanificacionLotesFederacion(
      'candidatos_duplicados',
      'La planificación no admite entregas ni posiciones repetidas.'
    );
  }
  const lotes = [];
  const excedidas = [];
  let actual = null;
  for (const candidato of normalizados) {
    if (candidato.bytes > limites.maximoBytesPorOcurrencia ||
        candidato.bytes + 2 > limites.maximoBytesPorLote) {
      excedidas.push(Object.freeze({
        entregaId: candidato.entregaId,
        posicionFlujo: candidato.posicionFlujo,
        ocurrencia: candidato.ocurrencia,
        errorTerminal: 'ocurrenciaExcedeLimite'
      }));
      continue;
    }
    const bytesAdicionales = candidato.bytes + (actual?.entregas.length ? 1 : 0);
    if (!actual || actual.prioridad !== candidato.prioridad ||
        actual.entregas.length >= limites.maximoOcurrenciasPorLote ||
        actual.bytes + bytesAdicionales > limites.maximoBytesPorLote) {
      if (actual) lotes.push(cerrarLote(actual));
      actual = {
        loteId: identidad(
          generarLoteId(),
          TIPOS_IDENTIDAD_FEDERADA.LOTE,
          'generarLoteId()'
        ),
        relacionId: relacion,
        flujoId: flujo,
        generacionId: generacion,
        revisionConcesionEfectiva: revision,
        prioridad: candidato.prioridad,
        bytes: 2,
        entregas: []
      };
    }
    actual.entregas.push(Object.freeze({
      entregaId: candidato.entregaId,
      posicionFlujo: candidato.posicionFlujo,
      intentos: candidato.intentos,
      ocurrencia: candidato.ocurrencia,
      procedencia: candidato.procedencia
    }));
    actual.bytes += candidato.bytes + (actual.entregas.length === 1 ? 0 : 1);
  }
  if (actual) lotes.push(cerrarLote(actual));
  return Object.freeze({
    lotes: Object.freeze(lotes),
    excedidas: Object.freeze(excedidas)
  });
}

function normalizarCandidato(candidato = {}) {
  const ocurrencia = materializarJson(candidato.ocurrencia);
  const canonico = canonicalizarJsonFederacion(ocurrencia);
  const procedencia = candidato.procedencia == null
    ? null
    : materializarJson(candidato.procedencia);
  return Object.freeze({
    entregaId: identidad(candidato.entregaId, TIPOS_IDENTIDAD_FEDERADA.ENTREGA, 'entregaId'),
    posicionFlujo: decimalPositivo(candidato.posicionFlujo, 'posicionFlujo'),
    prioridad: PRIORIDADES_FLUJO_FEDERACION.exigir(
      candidato.prioridad,
      { campo: 'prioridad' }
    ),
    intentos: enteroAcotado(candidato.intentos ?? 0, 0, 1000000, 'intentos'),
    ocurrencia,
    procedencia,
    bytes: encoder.encode(canonico).byteLength + (procedencia === null
      ? 0
      : encoder.encode(canonicalizarJsonFederacion(procedencia)).byteLength)
  });
}

function compararCandidatos(a, b) {
  const prioridadA = a.prioridad === 'operativaActual' ? 0 : 1;
  const prioridadB = b.prioridad === 'operativaActual' ? 0 : 1;
  if (prioridadA !== prioridadB) return prioridadA - prioridadB;
  const posicionA = BigInt(a.posicionFlujo);
  const posicionB = BigInt(b.posicionFlujo);
  return posicionA < posicionB ? -1 : posicionA > posicionB ? 1 : 0;
}

function cerrarLote(lote) {
  return Object.freeze({
    loteId: lote.loteId,
    relacionId: lote.relacionId,
    flujoId: lote.flujoId,
    generacionId: lote.generacionId,
    revisionConcesionEfectiva: lote.revisionConcesionEfectiva,
    prioridad: lote.prioridad,
    bytesCanonicosOcurrencias: lote.bytes,
    entregas: Object.freeze(lote.entregas)
  });
}

function normalizarLimites(capacidad = {}) {
  return Object.freeze({
    maximoOcurrenciasPorLote: enteroAcotado(
      capacidad.maximoOcurrenciasPorLote,
      1,
      5000,
      'maximoOcurrenciasPorLote'
    ),
    maximoBytesPorLote: enteroAcotado(
      capacidad.maximoBytesPorLote,
      1,
      16 * 1024 * 1024,
      'maximoBytesPorLote'
    ),
    maximoBytesPorOcurrencia: enteroAcotado(
      capacidad.maximoBytesPorOcurrencia,
      1,
      2 * 1024 * 1024,
      'maximoBytesPorOcurrencia'
    )
  });
}

function exigirContratoOcurrencia(contrato, ocurrencia) {
  if (!contrato || ocurrencia?.familia !== contrato.familia ||
      ocurrencia?.familiaVersion !== contrato.versionFamilia) {
    throw new ErrorPlanificacionLotesFederacion(
      'contrato_fragmentacion_incompatible',
      'La ocurrencia no pertenece al contrato tipado de fragmentación.'
    );
  }
}

function extraerIdentidadOcurrencia(ocurrencia) {
  return Object.freeze({
    installationOrigenId: ocurrencia.installationOrigenId,
    familia: ocurrencia.familia,
    elementoOrigenId: ocurrencia.elementoOrigenId,
    ocurrenciaOrigenId: ocurrencia.ocurrenciaOrigenId,
    secuenciaElemento: ocurrencia.secuenciaElemento
  });
}

function dividirUtf8(texto, maximoBytes) {
  const partes = [];
  let actual = '';
  let bytes = 0;
  for (const caracter of texto) {
    const bytesCaracter = encoder.encode(caracter).byteLength;
    if (bytesCaracter > maximoBytes) {
      throw new ErrorPlanificacionLotesFederacion(
        'fragmento_minimo_excede_limite',
        'El límite no permite transportar ni un carácter UTF-8 completo.'
      );
    }
    if (bytes > 0 && bytes + bytesCaracter > maximoBytes) {
      partes.push(actual);
      actual = '';
      bytes = 0;
    }
    actual += caracter;
    bytes += bytesCaracter;
  }
  if (actual) partes.push(actual);
  return partes;
}

function materializarJson(valor) {
  let serializado;
  try {
    serializado = JSON.stringify(valor);
  } catch {
    throw new ErrorPlanificacionLotesFederacion(
      'ocurrencia_no_representable',
      'La ocurrencia no posee una fotografía JSON transportable.'
    );
  }
  if (serializado === undefined) {
    throw new ErrorPlanificacionLotesFederacion(
      'ocurrencia_no_representable',
      'La ocurrencia no posee una fotografía JSON transportable.'
    );
  }
  return normalizarJsonFederacion(JSON.parse(serializado));
}

function huella(calcularHuella, texto) {
  const valor = calcularHuella(texto);
  if (typeof valor !== 'string' || !/^[a-f0-9]{64}$/u.test(valor)) {
    throw new ErrorPlanificacionLotesFederacion(
      'huella_fragmentacion_invalida',
      'El calculador debe producir una huella SHA-256 hexadecimal canónica.'
    );
  }
  return valor;
}

function exigirCalculadorHuella(calcularHuella) {
  if (typeof calcularHuella !== 'function') {
    throw new ErrorPlanificacionLotesFederacion(
      'calculador_huella_ausente',
      'La fragmentación exige un calculador de integridad explícito.'
    );
  }
}

function identidad(valor, tipo, campo) {
  try {
    return String(crearIdentidadFederada({ tipo, valor: String(valor ?? '') }));
  } catch (error) {
    throw new ErrorPlanificacionLotesFederacion(
      'identidad_invalida',
      `${campo} no es una identidad federada canónica: ${error.message}`
    );
  }
}

function decimalPositivo(valor, campo) {
  const texto = String(valor ?? '');
  if (!/^[1-9][0-9]*$/u.test(texto)) {
    throw new ErrorPlanificacionLotesFederacion(
      'decimal_invalido',
      `${campo} debe ser un entero decimal positivo.`
    );
  }
  return texto;
}

function enteroAcotado(valor, minimo, maximo, campo) {
  if (!Number.isSafeInteger(valor) || valor < minimo || valor > maximo) {
    throw new ErrorPlanificacionLotesFederacion(
      'limite_invalido',
      `${campo} debe estar entre ${minimo} y ${maximo}.`
    );
  }
  return valor;
}

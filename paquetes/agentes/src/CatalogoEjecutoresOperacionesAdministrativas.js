export class ErrorContratoEjecutorOperacionAdministrativa extends Error {
  constructor(codigo, mensaje) {
    super(mensaje);
    this.name = 'ErrorContratoEjecutorOperacionAdministrativa';
    this.codigo = codigo;
    this.permanente = true;
  }
}

export const MODOS_CONSOLIDACION_OPERACION_ADMINISTRATIVA = Object.freeze({
  MOTOR: 'motor',
  EJECUTOR_TRANSACCIONAL: 'ejecutor_transaccional'
});

export class CatalogoEjecutoresOperacionesAdministrativas {
  #contratos;
  #ejecutores;

  constructor({ contratos = [], ejecutores = [] } = {}) {
    if (!Array.isArray(contratos) || !Array.isArray(ejecutores)) {
      throw new Error('El catálogo debe construirse con listas de contratos y ejecutores.');
    }
    this.#contratos = new Map();
    this.#ejecutores = new Map();
    for (const contrato of contratos) this.#incorporarContrato(contrato);
    for (const ejecutor of ejecutores) this.#incorporarEjecutor(ejecutor);
    Object.freeze(this);
  }

  resolver(tipo, version) {
    const clave = claveContrato(tipo, version);
    const registro = this.#ejecutores.get(clave);
    if (!registro) {
      throw new ErrorContratoEjecutorOperacionAdministrativa(
        'contrato_operacion_administrativa_no_registrado',
        `No existe ejecutor registrado para ${clave}.`
      );
    }
    return registro;
  }

  resolverContrato(tipo, version) {
    const clave = claveContrato(tipo, version);
    const registro = this.#contratos.get(clave);
    if (!registro) {
      throw new ErrorContratoEjecutorOperacionAdministrativa(
        'contrato_operacion_administrativa_no_registrado',
        `No existe contrato registrado para ${clave}.`
      );
    }
    return registro;
  }

  validarComando(tipo, version, entrada) {
    return this.resolverContrato(tipo, version).validarComando(entrada);
  }

  validarResultado(tipo, version, entrada) {
    return this.resolverContrato(tipo, version).validarResultado(entrada);
  }

  resolverRecursos(tipo, version, comando) {
    const contrato = this.resolverContrato(tipo, version);
    return normalizarRecursos(contrato.resolverRecursos(comando));
  }

  listarContratos() {
    return Object.freeze([...this.#contratos.keys()].sort());
  }

  listarEjecutores() {
    return Object.freeze([...this.#ejecutores.keys()].sort());
  }

  #incorporarContrato(contrato) {
    const registro = normalizarContrato(contrato, 'contrato');
    const clave = claveContrato(registro.tipo, registro.version);
    if (this.#contratos.has(clave)) {
      throw new Error(`El contrato ${clave} está registrado más de una vez.`);
    }
    this.#contratos.set(clave, registro);
  }

  #incorporarEjecutor(ejecutor) {
    if (!ejecutor || typeof ejecutor !== 'object' || Array.isArray(ejecutor)) {
      throw new Error('Cada ejecutor debe ser un objeto explícito de código.');
    }
    const contrato = normalizarContrato(ejecutor, 'ejecutor');
    if (typeof ejecutor.ejecutar !== 'function') {
      throw new Error(
        `El ejecutor ${contrato.tipo}@${contrato.version} no implementa ejecutar().`
      );
    }
    const clave = claveContrato(contrato.tipo, contrato.version);
    if (this.#ejecutores.has(clave)) {
      throw new Error(`El ejecutor ${clave} está registrado más de una vez.`);
    }
    if (!this.#contratos.has(clave)) this.#contratos.set(clave, contrato);
    const registro = Object.freeze({
      ...this.#contratos.get(clave),
      modoConsolidacion: normalizarModoConsolidacion(ejecutor.modoConsolidacion),
      ejecutar: ejecutor.ejecutar.bind(ejecutor)
    });
    this.#ejecutores.set(clave, registro);
  }
}

function normalizarModoConsolidacion(valor) {
  const modo = valor ?? MODOS_CONSOLIDACION_OPERACION_ADMINISTRATIVA.MOTOR;
  if (!Object.values(MODOS_CONSOLIDACION_OPERACION_ADMINISTRATIVA).includes(modo)) {
    throw new Error(`El modo de consolidación ${String(modo)} no está soportado.`);
  }
  return modo;
}

function normalizarContrato(contrato, prefijo) {
  if (!contrato || typeof contrato !== 'object' || Array.isArray(contrato)) {
    throw new Error(`Cada ${prefijo} debe ser un objeto explícito de código.`);
  }
  const tipo = codigo(contrato.tipo, `${prefijo}.tipo`);
  const version = entero(contrato.version, `${prefijo}.version`);
  for (const metodo of ['validarComando', 'validarResultado', 'resolverRecursos']) {
    if (typeof contrato[metodo] !== 'function') {
      throw new Error(`El ${prefijo} ${tipo}@${version} no implementa ${metodo}().`);
    }
  }
  return Object.freeze({
    tipo,
    version,
    validarComando: contrato.validarComando.bind(contrato),
    validarResultado: contrato.validarResultado.bind(contrato),
    resolverRecursos: contrato.resolverRecursos.bind(contrato)
  });
}

function normalizarRecursos(entrada) {
  if (!Array.isArray(entrada) || entrada.length === 0) {
    throw new Error('El contrato debe aportar recursos reclamados.');
  }
  const permitidos = new Set(['agente', 'tenant', 'empresa', 'sitio']);
  const identidades = new Set();
  const recursos = entrada.map((recurso, indice) => {
    if (
      !recurso || typeof recurso !== 'object' || Array.isArray(recurso) ||
      Object.getPrototypeOf(recurso) !== Object.prototype ||
      Reflect.ownKeys(recurso).length !== 2 ||
      !Object.hasOwn(recurso, 'tipoRecurso') ||
      !Object.hasOwn(recurso, 'recursoId')
    ) {
      throw new Error(`El recurso ${indice} no posee la forma cerrada esperada.`);
    }
    const tipoRecurso = String(recurso.tipoRecurso || '');
    const recursoId = String(recurso.recursoId ?? '');
    if (!permitidos.has(tipoRecurso) || !/^[1-9][0-9]*$/u.test(recursoId)) {
      throw new Error(`El recurso ${indice} no posee una identidad soportada.`);
    }
    const clave = `${tipoRecurso}:${recursoId}`;
    if (identidades.has(clave)) {
      throw new Error(`El contrato repite el recurso ${clave}.`);
    }
    identidades.add(clave);
    return Object.freeze({ tipoRecurso, recursoId });
  });
  return Object.freeze(recursos);
}

function claveContrato(tipo, version) {
  return `${codigo(tipo, 'tipo')}@${entero(version, 'version')}`;
}

function codigo(valor, campo) {
  const texto = String(valor || '');
  if (!/^[a-z][a-z0-9_]{0,63}$/u.test(texto)) {
    throw new Error(`${campo} debe ser un código ASCII cerrado.`);
  }
  return texto;
}

function entero(valor, campo) {
  const numero = Number(valor);
  if (!Number.isSafeInteger(numero) || numero < 1 || numero > 65_535) {
    throw new Error(`${campo} debe ser un entero positivo soportado.`);
  }
  return numero;
}

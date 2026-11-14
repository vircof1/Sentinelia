const ESTADOS = new Set([
  'encolada',
  'ejecutando',
  'completada',
  'completada_con_advertencias',
  'fallida'
]);

const FASES = Object.freeze([
  'preparacion',
  'validacion',
  'eliminacion',
  'commit',
  'limpieza'
]);

const TERMINALES = new Set([
  'completada',
  'completada_con_advertencias',
  'fallida'
]);

export class OperacionAdministrativa {
  constructor({
    operacionId,
    claveOperacion,
    tipo,
    version,
    sujeto,
    comando,
    estado,
    fase,
    intentos,
    maxIntentos,
    disponibleDesdeUtc,
    instanciaId,
    leaseExpiraUtc,
    fencingToken,
    ultimoError,
    resultado,
    creadaEnUtc,
    actualizadaEnUtc,
    terminadaEnUtc
  } = {}) {
    this.operacionId = texto(operacionId, 'operacionId');
    this.claveOperacion = texto(claveOperacion, 'claveOperacion');
    this.tipo = codigo(tipo, 'tipo');
    this.version = entero(version, 1, 65_535, 'version');
    this.sujeto = objetoCongelado(sujeto, 'sujeto');
    this.comando = objetoCongelado(comando, 'comando');
    if (!ESTADOS.has(estado) || !FASES.includes(fase)) {
      throw new Error('La operación administrativa posee estado o fase desconocidos.');
    }
    this.estado = estado;
    this.fase = fase;
    this.intentos = entero(intentos, 0, 100, 'intentos');
    this.maxIntentos = entero(maxIntentos, 1, 100, 'maxIntentos');
    if (this.intentos > this.maxIntentos) {
      throw new Error('La operación administrativa excede su máximo de intentos.');
    }
    this.disponibleDesdeUtc = fecha(disponibleDesdeUtc, 'disponibleDesdeUtc');
    this.instanciaId = opcional(instanciaId);
    this.leaseExpiraUtc = fechaOpcional(leaseExpiraUtc, 'leaseExpiraUtc');
    this.fencingToken = decimalNoNegativo(fencingToken, 'fencingToken');
    this.ultimoError = ultimoError === null
      ? null
      : objetoCongelado(ultimoError, 'ultimoError');
    this.resultado = resultado === null
      ? null
      : objetoCongelado(resultado, 'resultado');
    this.creadaEnUtc = fecha(creadaEnUtc, 'creadaEnUtc');
    this.actualizadaEnUtc = fecha(actualizadaEnUtc, 'actualizadaEnUtc');
    this.terminadaEnUtc = fechaOpcional(terminadaEnUtc, 'terminadaEnUtc');
    if (TERMINALES.has(this.estado) !== (this.terminadaEnUtc !== null)) {
      throw new Error('La terminalidad de la operación administrativa es incoherente.');
    }
    validarFormaEstado(this);
    Object.freeze(this);
  }

  get terminal() {
    return TERMINALES.has(this.estado);
  }

  siguienteFase(candidata) {
    const posicion = FASES.indexOf(this.fase);
    if (
      this.estado !== 'ejecutando' ||
      posicion < 0 ||
      FASES[posicion + 1] !== candidata ||
      candidata === 'limpieza'
    ) {
      throw new Error('La fase solicitada no es el siguiente avance ejecutable.');
    }
    return candidata;
  }

  serializar() {
    return Object.freeze({
      operacionId: this.operacionId,
      claveOperacion: this.claveOperacion,
      tipo: this.tipo,
      version: this.version,
      sujeto: this.sujeto,
      comando: this.comando,
      estado: this.estado,
      fase: this.fase,
      intentos: this.intentos,
      maxIntentos: this.maxIntentos,
      disponibleDesdeUtc: this.disponibleDesdeUtc,
      instanciaId: this.instanciaId,
      leaseExpiraUtc: this.leaseExpiraUtc,
      fencingToken: this.fencingToken,
      ultimoError: this.ultimoError,
      resultado: this.resultado,
      creadaEnUtc: this.creadaEnUtc,
      actualizadaEnUtc: this.actualizadaEnUtc,
      terminadaEnUtc: this.terminadaEnUtc,
      terminal: this.terminal
    });
  }
}

function objetoCongelado(valor, campo) {
  if (!valor || typeof valor !== 'object' || Array.isArray(valor)) {
    throw new Error(`${campo} debe ser un objeto.`);
  }
  return congelarProfundo(structuredClone(valor));
}

function texto(valor, campo) {
  const normalizado = String(valor || '');
  if (!normalizado) throw new Error(`${campo} es obligatorio.`);
  return normalizado;
}

function codigo(valor, campo) {
  const normalizado = texto(valor, campo);
  if (!/^[a-z][a-z0-9_]{0,63}$/u.test(normalizado)) {
    throw new Error(`${campo} no es un código válido.`);
  }
  return normalizado;
}

function entero(valor, minimo, maximo, campo) {
  const numero = Number(valor);
  if (!Number.isInteger(numero) || numero < minimo || numero > maximo) {
    throw new Error(`${campo} no es un entero válido.`);
  }
  return numero;
}

function decimalNoNegativo(valor, campo) {
  const texto = String(valor ?? '');
  if (!/^(0|[1-9][0-9]*)$/u.test(texto)) {
    throw new Error(`${campo} no es un decimal no negativo.`);
  }
  return texto;
}

function fecha(valor, campo) {
  const fecha = new Date(valor);
  if (!valor || Number.isNaN(fecha.getTime())) {
    throw new Error(`${campo} no es una fecha válida.`);
  }
  return fecha.toISOString();
}

function fechaOpcional(valor, campo) {
  return valor === null || valor === undefined ? null : fecha(valor, campo);
}

function opcional(valor) {
  return valor === null || valor === undefined ? null : String(valor);
}

function congelarProfundo(valor) {
  for (const descendiente of Object.values(valor)) {
    if (descendiente && typeof descendiente === 'object') {
      congelarProfundo(descendiente);
    }
  }
  return Object.freeze(valor);
}

function validarFormaEstado(operacion) {
  const poseeLease = operacion.instanciaId !== null && operacion.leaseExpiraUtc !== null;
  const sinLease = operacion.instanciaId === null && operacion.leaseExpiraUtc === null;
  if (operacion.estado === 'encolada') {
    if (
      operacion.fase !== 'preparacion' || !sinLease ||
      operacion.resultado !== null || operacion.terminadaEnUtc !== null
    ) {
      throw new Error('La operación encolada no posee una forma coherente.');
    }
    return;
  }
  if (operacion.estado === 'ejecutando') {
    if (
      !poseeLease || operacion.fase === 'limpieza' ||
      operacion.ultimoError !== null || operacion.resultado !== null
    ) {
      throw new Error('La operación en ejecución no posee una forma coherente.');
    }
    return;
  }
  if (['completada', 'completada_con_advertencias'].includes(operacion.estado)) {
    if (
      !sinLease || operacion.fase !== 'limpieza' ||
      operacion.ultimoError !== null || operacion.resultado === null
    ) {
      throw new Error('La operación satisfactoria no posee una forma coherente.');
    }
    return;
  }
  if (
    !sinLease || operacion.fase === 'limpieza' ||
    operacion.ultimoError === null || operacion.resultado === null
  ) {
    throw new Error('La operación fallida no posee una forma coherente.');
  }
}

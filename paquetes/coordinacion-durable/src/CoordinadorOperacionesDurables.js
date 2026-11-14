import { randomBytes } from 'node:crypto';

const MAX_BIGINT_UNSIGNED = 18_446_744_073_709_551_615n;
const METODOS_REPOSITORIO = Object.freeze([
  'reclamarSiguiente',
  'renovarLease',
  'avanzarConLease',
  'consolidarConLease',
  'registrarFalloConLease'
]);

export class LeaseOperacionDurablePerdido extends Error {
  constructor(mensaje = 'La operación ya no conserva el lease presentado.') {
    super(mensaje);
    this.name = 'LeaseOperacionDurablePerdido';
    this.codigo = 'lease_operacion_durable_perdido';
  }
}

export class CoordinadorOperacionesDurables {
  constructor({
    repositorio,
    instanciaId,
    ttlSegundos = 30
  } = {}) {
    for (const metodo of METODOS_REPOSITORIO) {
      if (typeof repositorio?.[metodo] !== 'function') {
        throw new Error(`El repositorio durable no proporciona ${metodo}().`);
      }
    }
    this.repositorio = repositorio;
    this.instanciaId = normalizarAscii(instanciaId, 128, 'instanciaId');
    this.ttlSegundos = normalizarEntero(
      ttlSegundos,
      1,
      3600,
      'ttlSegundos'
    );
  }

  async reclamarSiguiente() {
    const leaseToken = randomBytes(32);
    const reclamada = await this.repositorio.reclamarSiguiente({
      instanciaId: this.instanciaId,
      leaseToken,
      ttlSegundos: this.ttlSegundos
    });
    if (reclamada === null) return null;

    const lease = construirLease({
      operacionId: reclamada.operacionId,
      instanciaId: this.instanciaId,
      leaseToken,
      fencingToken: reclamada.fencingToken
    });
    const intentos = normalizarEntero(
      reclamada.intentos,
      1,
      1_000_000,
      'intentos'
    );
    return Object.freeze({
      lease,
      intentos,
      operacion: congelarOperacion(reclamada.operacion)
    });
  }

  async renovar(leaseEntrada) {
    const lease = this.#normalizarLeasePropio(leaseEntrada);
    return this.#exigirActualizacion(
      await this.repositorio.renovarLease({
        ...leaseParaRepositorio(lease),
        ttlSegundos: this.ttlSegundos
      }),
      lease
    );
  }

  async avanzar(leaseEntrada, { transicion, datos = null } = {}) {
    const lease = this.#normalizarLeasePropio(leaseEntrada);
    const codigoTransicion = normalizarCodigo(
      transicion,
      'transicion_operacion_durable'
    );
    return this.#exigirActualizacion(
      await this.repositorio.avanzarConLease({
        ...leaseParaRepositorio(lease),
        transicion: codigoTransicion,
        datos
      }),
      lease
    );
  }

  async consolidar(leaseEntrada, { resultado = null } = {}) {
    const lease = this.#normalizarLeasePropio(leaseEntrada);
    return this.#exigirActualizacion(
      await this.repositorio.consolidarConLease({
        ...leaseParaRepositorio(lease),
        resultado
      }),
      lease
    );
  }

  async registrarFallo(
    leaseEntrada,
    {
      codigo = 'error_operacion_durable',
      mensaje = 'No se pudo completar la operación durable.',
      permanente = false,
      demoraReintentoSegundos = 5,
      resumen = null
    } = {}
  ) {
    const lease = this.#normalizarLeasePropio(leaseEntrada);
    const diagnostico = sanearDiagnosticoOperacionDurable({ codigo, mensaje });
    const demora = normalizarEntero(
      demoraReintentoSegundos,
      1,
      86_400,
      'demoraReintentoSegundos'
    );
    return this.#exigirActualizacion(
      await this.repositorio.registrarFalloConLease({
        ...leaseParaRepositorio(lease),
        diagnostico,
        permanente: Boolean(permanente),
        demoraReintentoSegundos: demora,
        resumen
      }),
      lease
    );
  }

  #normalizarLeasePropio(entrada) {
    const lease = construirLease(entrada);
    if (lease.instanciaId !== this.instanciaId) {
      throw new LeaseOperacionDurablePerdido(
        'El lease pertenece a otra instancia de coordinación.'
      );
    }
    return lease;
  }

  #exigirActualizacion(resultado, lease) {
    if (resultado?.actualizada !== true) {
      throw new LeaseOperacionDurablePerdido(
        `La operación ${lease.operacionId} perdió lease o fencing antes de avanzar.`
      );
    }
    return Object.freeze({ ...resultado, lease });
  }
}

export function sanearDiagnosticoOperacionDurable({ codigo, mensaje } = {}) {
  const codigoSeguro = String(codigo || 'error_operacion_durable')
    .toLowerCase()
    .replace(/[^a-z0-9_.-]+/g, '_')
    .slice(0, 64) || 'error_operacion_durable';
  const mensajeSeguro = String(mensaje || 'Error técnico durable.')
    .replace(/[\u0000-\u001f\u007f]+/g, ' ')
    .replace(/\bbearer\s+[a-z0-9._~+/=-]+/gi, '[dato_sensible]')
    .replace(
      /\b(authorization|password|contraseña|cookie|csrf|secret|token)\b\s*[:=]?\s*[^,;\s]+/gi,
      '[dato_sensible]'
    )
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 512) || 'Error técnico durable.';
  return Object.freeze({ codigo: codigoSeguro, mensaje: mensajeSeguro });
}

function construirLease({
  operacionId,
  instanciaId,
  leaseToken,
  fencingToken
} = {}) {
  const token = Buffer.isBuffer(leaseToken)
    ? Buffer.from(leaseToken)
    : Buffer.from(String(leaseToken || ''), 'hex');
  if (token.length !== 32 || !/^[0-9a-f]{64}$/.test(token.toString('hex'))) {
    throw new Error('leaseToken debe contener 32 bytes impredecibles.');
  }
  const fencing = normalizarFencing(fencingToken);
  return Object.freeze({
    operacionId: normalizarAscii(operacionId, 128, 'operacionId'),
    instanciaId: normalizarAscii(instanciaId, 128, 'instanciaId'),
    leaseToken: token.toString('hex'),
    fencingToken: fencing
  });
}

function congelarOperacion(operacion) {
  if (operacion === null || operacion === undefined) return null;
  if (
    typeof operacion !== 'object' ||
    Array.isArray(operacion) ||
    Object.getPrototypeOf(operacion) !== Object.prototype
  ) {
    throw new Error('La operación reclamada debe ser un objeto plano.');
  }
  return Object.freeze({ ...operacion });
}

function leaseParaRepositorio(lease) {
  return {
    operacionId: lease.operacionId,
    instanciaId: lease.instanciaId,
    leaseToken: Buffer.from(lease.leaseToken, 'hex'),
    fencingToken: lease.fencingToken
  };
}

function normalizarFencing(valor) {
  const texto = String(valor ?? '');
  if (!/^[1-9][0-9]*$/.test(texto)) {
    throw new Error('fencingToken debe ser un entero decimal positivo.');
  }
  const fencing = BigInt(texto);
  if (fencing > MAX_BIGINT_UNSIGNED) {
    throw new Error('fencingToken agotó el rango BIGINT UNSIGNED.');
  }
  return texto;
}

function normalizarCodigo(valor, nombre) {
  const texto = String(valor || '');
  if (!/^[a-z][a-z0-9_]{0,63}$/.test(texto)) {
    throw new Error(`${nombre} debe ser un código cerrado ASCII.`);
  }
  return texto;
}

function normalizarAscii(valor, maximo, nombre) {
  const texto = String(valor || '').trim();
  if (
    texto.length === 0 ||
    texto.length > maximo ||
    !/^[\x20-\x7e]+$/.test(texto)
  ) {
    throw new Error(`${nombre} debe ser texto ASCII válido.`);
  }
  return texto;
}

function normalizarEntero(valor, minimo, maximo, nombre) {
  const numero = Number(valor);
  if (!Number.isInteger(numero) || numero < minimo || numero > maximo) {
    throw new Error(`${nombre} debe estar entre ${minimo} y ${maximo}.`);
  }
  return numero;
}

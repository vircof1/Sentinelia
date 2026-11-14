import {
  TIPOS_IDENTIDAD_FEDERADA,
  crearIdentidadFederada
} from '../src/IdentidadFederada.js';

export class ErrorCapturaProductorRuntime extends Error {
  constructor(codigo, mensaje) {
    super(mensaje);
    this.name = 'ErrorCapturaProductorRuntime';
    this.codigo = codigo;
  }
}

export class ServicioCapturaFederadaProductorRuntime {
  constructor({ clienteSql, puertoCaptura, repositorioAutoridadRuntime } = {}) {
    exigirMetodo(clienteSql, 'obtenerConexion', 'clienteSql');
    exigirMetodo(puertoCaptura, 'capturarEnTransaccion', 'puertoCaptura');
    exigirMetodo(
      repositorioAutoridadRuntime,
      'bloquearLeaseVigenteEnTransaccion',
      'repositorioAutoridadRuntime'
    );
    exigirMetodo(
      repositorioAutoridadRuntime,
      'revalidarLeaseVigenteEnTransaccion',
      'repositorioAutoridadRuntime'
    );
    this.clienteSql = clienteSql;
    this.puertoCaptura = puertoCaptura;
    this.repositorioAutoridadRuntime = repositorioAutoridadRuntime;
    Object.freeze(this);
  }

  async ejecutar({ lease, captura, persistirEnTransaccion } = {}) {
    const autoridadEsperada = normalizarLease(lease);
    const ocurrenciaOrigenId = exigirCausalidadPreasignada(captura);
    if (typeof persistirEnTransaccion !== 'function') {
      throw new ErrorCapturaProductorRuntime(
        'mutacion_runtime_ausente',
        'El runtime debe aportar la mutación que origina la ocurrencia.'
      );
    }
    const conexion = await this.clienteSql.obtenerConexion();
    try {
      await conexion.beginTransaction();
      const autoridad = await this.repositorioAutoridadRuntime
        .bloquearLeaseVigenteEnTransaccion(autoridadEsperada, { conexion });
      exigirMismaAutoridad(autoridadEsperada, autoridad);
      const resultadoRuntime = await persistirEnTransaccion({
        conexion,
        lease: autoridadEsperada,
        autoridad,
        ocurrenciaOrigenId
      });
      const resultadoCaptura = await this.puertoCaptura.capturarEnTransaccion(
        captura,
        { conexion }
      );
      const autoridadFinal = await this.repositorioAutoridadRuntime
        .revalidarLeaseVigenteEnTransaccion(autoridadEsperada, { conexion });
      exigirMismaAutoridad(autoridadEsperada, autoridadFinal);
      await conexion.commit();
      return Object.freeze({
        runtime: resultadoRuntime,
        captura: resultadoCaptura,
        autoridad: Object.freeze({
          operacionId: autoridadEsperada.operacionId,
          instanciaId: autoridadEsperada.instanciaId,
          fencingToken: autoridadEsperada.fencingToken
        })
      });
    } catch (error) {
      try {
        await conexion.rollback();
      } catch {}
      throw error;
    } finally {
      conexion.release();
    }
  }
}

function exigirCausalidadPreasignada(captura) {
  const valor = String(captura?.definicion?.ocurrenciaOrigenId || '');
  try {
    return String(crearIdentidadFederada({
      tipo: TIPOS_IDENTIDAD_FEDERADA.OCURRENCIA_ORIGEN,
      valor
    }));
  } catch (causa) {
    throw new ErrorCapturaProductorRuntime(
      'causalidad_no_preasignada',
      `El runtime debe preasignar ocurrenciaOrigenId antes de mutar: ${causa.message}`
    );
  }
}

function normalizarLease(lease = {}) {
  const operacionId = ascii(lease.operacionId, 128, 'operacionId');
  const instanciaId = ascii(lease.instanciaId, 128, 'instanciaId');
  const leaseToken = normalizarToken(lease.leaseToken);
  const fencingToken = decimalPositivo(lease.fencingToken, 'fencingToken');
  return Object.freeze({ operacionId, instanciaId, leaseToken, fencingToken });
}

function exigirMismaAutoridad(esperada, observada = {}) {
  const normalizada = normalizarLease(observada);
  if (
    normalizada.operacionId !== esperada.operacionId ||
    normalizada.instanciaId !== esperada.instanciaId ||
    normalizada.leaseToken !== esperada.leaseToken ||
    normalizada.fencingToken !== esperada.fencingToken
  ) {
    throw new ErrorCapturaProductorRuntime(
      'autoridad_runtime_divergente',
      'La autoridad bloqueada no coincide con el lease y fencing presentados.'
    );
  }
}

function normalizarToken(valor) {
  const texto = Buffer.isBuffer(valor)
    ? valor.toString('hex')
    : String(valor || '').toLowerCase();
  if (!/^[a-f0-9]{64}$/u.test(texto)) {
    throw new ErrorCapturaProductorRuntime(
      'lease_token_invalido',
      'leaseToken debe contener exactamente 32 bytes.'
    );
  }
  return texto;
}

function decimalPositivo(valor, campo) {
  const texto = String(valor ?? '');
  if (
    !/^[1-9][0-9]*$/u.test(texto) ||
    BigInt(texto) > 18_446_744_073_709_551_615n
  ) {
    throw new ErrorCapturaProductorRuntime(
      'fencing_invalido',
      `${campo} debe ser un decimal positivo sin pérdida de precisión.`
    );
  }
  return texto;
}

function ascii(valor, maximo, campo) {
  const texto = String(valor || '').trim();
  if (!texto || texto.length > maximo || !/^[\x21-\x7e]+$/u.test(texto)) {
    throw new ErrorCapturaProductorRuntime(
      'lease_invalido',
      `${campo} no es un identificador ASCII válido.`
    );
  }
  return texto;
}

function exigirMetodo(valor, metodo, nombre) {
  if (typeof valor?.[metodo] !== 'function') {
    throw new Error(`${nombre} debe implementar ${metodo}().`);
  }
}

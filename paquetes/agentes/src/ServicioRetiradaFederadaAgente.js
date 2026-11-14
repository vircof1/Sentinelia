export class ServicioRetiradaFederadaAgente {
  constructor({
    capturadorFederacion,
    repositorioContextoAgentes,
    repositorioTelemetria,
    repositorioMonitores
  } = {}) {
    if (typeof capturadorFederacion?.capturarPreparadasEnTransaccion !== 'function') {
      throw new Error('La retirada federada exige distribución transaccional preparada.');
    }
    if (typeof repositorioContextoAgentes?.prepararRetiradaPublicadaEnTransaccion !== 'function') {
      throw new Error('La retirada federada exige el contexto local de agentes.');
    }
    if (typeof repositorioTelemetria?.prepararRetiradaAgenteEnTransaccion !== 'function') {
      throw new Error('La retirada federada exige la telemetría local atribuida.');
    }
    if (typeof repositorioMonitores?.prepararRetiradaPublicadaEnTransaccion !== 'function') {
      throw new Error('La retirada federada exige los monitores locales publicados.');
    }
    this.capturadorFederacion = capturadorFederacion;
    this.repositorioContextoAgentes = repositorioContextoAgentes;
    this.repositorioTelemetria = repositorioTelemetria;
    this.repositorioMonitores = repositorioMonitores;
    Object.freeze(this);
  }

  async prepararEnTransaccion({ agenteId } = {}, { conexion } = {}) {
    await exigirTransaccion(conexion);
    const id = idPositivo(agenteId, 'agenteId');
    const [agentes] = await conexion.execute(
      'SELECT id FROM agentes_sentinelia WHERE id=? FOR UPDATE',
      [id]
    );
    if (!agentes[0]) {
      throw new ErrorRetiradaFederadaAgente(
        'agente_retirada_federada_inexistente',
        'El agente debe conservar su raíz mientras se preparan las retiradas.'
      );
    }
    const [monitores] = await conexion.execute(
      `SELECT v.monitor_id
         FROM vinculos_monitores_telemetria v
         JOIN monitores m ON m.id=v.monitor_id
        WHERE v.agente_id=? ORDER BY v.monitor_id FOR UPDATE`,
      [id]
    );
    const capturasMonitores = [];
    for (const { monitor_id: monitorId } of monitores) {
      capturasMonitores.push(
        ...await this.repositorioMonitores.prepararRetiradaPublicadaEnTransaccion(
          { monitorId }, { conexion }
        )
      );
    }
    const salidaMonitores = await this.#distribuir(
      'monitores', capturasMonitores, conexion
    );
    const telemetria = await this.repositorioTelemetria
      .prepararRetiradaAgenteEnTransaccion({ agenteId: id }, { conexion });
    const salidaTelemetria = await this.#distribuir(
      'telemetria', telemetria.capturas, conexion
    );
    const contexto = await this.repositorioContextoAgentes
      .prepararRetiradaPublicadaEnTransaccion({ agenteId: id }, { conexion });
    const salidaContexto = await this.#distribuir(
      'contextoOperativoAgentesSesiones', contexto ? [contexto] : [], conexion
    );
    return congelar({
      agenteId: id,
      identidadesRetiradas:
        capturasMonitores.length + telemetria.identidadesRetiradas + (contexto ? 1 : 0),
      tombstones:
        capturasMonitores.length + telemetria.tombstones + (contexto ? 1 : 0),
      identidadesHistoricasCerradas: telemetria.identidadesHistoricasCerradas,
      familias: {
        monitores: resumirSalida(capturasMonitores, salidaMonitores),
        telemetria: resumirSalida(telemetria.capturas, salidaTelemetria),
        contextoOperativoAgentesSesiones:
          resumirSalida(contexto ? [contexto] : [], salidaContexto)
      }
    });
  }

  #distribuir(familia, capturas, conexion) {
    return this.capturadorFederacion.capturarPreparadasEnTransaccion({
      familia,
      capturas
    }, { conexion });
  }
}

export class ErrorRetiradaFederadaAgente extends Error {
  constructor(codigo, mensaje) {
    super(mensaje);
    this.name = 'ErrorRetiradaFederadaAgente';
    this.codigo = codigo;
  }
}

function resumirSalida(capturas, salida) {
  return {
    identidades: capturas.length,
    estado: salida.estado,
    ocurrencias: salida.ocurrencias.length,
    posiciones: salida.posiciones.length
  };
}

async function exigirTransaccion(conexion) {
  if (typeof conexion?.execute !== 'function' || typeof conexion?.query !== 'function') {
    throw new ErrorRetiradaFederadaAgente(
      'conexion_retirada_federada_ausente',
      'La retirada federada exige una conexión SQL prestada.'
    );
  }
  const [filas] = await conexion.query('SELECT @@session.in_transaction AS activa');
  if (!Boolean(filas[0]?.activa)) {
    throw new ErrorRetiradaFederadaAgente(
      'transaccion_retirada_federada_ausente',
      'La retirada federada debe prepararse dentro de la transacción destructiva.'
    );
  }
}

function idPositivo(valor, campo) {
  const texto = String(valor ?? '');
  if (!/^[1-9][0-9]*$/u.test(texto)) {
    throw new TypeError(`${campo} debe ser una identidad decimal positiva.`);
  }
  return texto;
}

function congelar(valor) {
  if (valor && typeof valor === 'object' && !Object.isFrozen(valor)) {
    for (const hijo of Object.values(valor)) congelar(hijo);
    Object.freeze(valor);
  }
  return valor;
}

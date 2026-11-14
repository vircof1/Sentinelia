import {
  TIPOS_IDENTIDAD_FEDERADA,
  crearIdentidadFederada
} from '../src/IdentidadFederada.js';
import { PRIORIDADES_FLUJO_FEDERACION } from '../src/CatalogosFederacion.js';

export class ErrorOutboxFederacion extends Error {
  constructor(codigo, mensaje) {
    super(mensaje);
    this.name = 'ErrorOutboxFederacion';
    this.codigo = codigo;
  }
}

export class RepositorioOutboxFederacionSql {
  constructor(clienteSql) {
    if (!clienteSql?.obtenerConexion) {
      throw new Error('La outbox federada requiere SQL operativo.');
    }
    this.clienteSql = clienteSql;
  }

  async encolarPosicionesEnTransaccion(posiciones, { conexion } = {}) {
    exigirConexion(conexion);
    await exigirTransaccionActiva(conexion);
    const normalizadas = normalizarPosiciones(posiciones);
    const ahora = await ahoraSql(conexion);
    const resultados = [];
    for (const posicion of normalizadas) {
      const referencia = await obtenerPosicionBloqueada(conexion, posicion);
      if (!referencia) {
        throw new ErrorOutboxFederacion(
          'posicion_inexistente',
          'La outbox no puede inventar una posición que no fue capturada.'
        );
      }
      let resultadoAlta = 'creada';
      try {
        await conexion.execute(
          `INSERT INTO outbox_federacion (
             flujo_id,generacion_id,posicion_flujo,prioridad,estado,intentos,
             disponible_desde_utc,capturada_en_utc,actualizada_en_utc
           ) VALUES (?, ?, ?, ?, 'pendiente', 0, ?, ?, ?)`,
          [
            posicion.flujoId,
            posicion.generacionId,
            posicion.posicionFlujo,
            posicion.prioridad,
            ahora,
            ahora,
            ahora
          ]
        );
      } catch (error) {
        if (error?.code !== 'ER_DUP_ENTRY') throw error;
        resultadoAlta = 'yaEncolada';
      }
      const fila = await obtenerObligacionBloqueada(conexion, posicion);
      if (!fila) {
        throw new ErrorOutboxFederacion(
          'obligacion_inconsistente',
          'La posición no quedó representada durablemente en la outbox.'
        );
      }
      if (fila.prioridad !== posicion.prioridad) {
        throw new ErrorOutboxFederacion(
          'prioridad_obligacion_divergente',
          'El replay intenta reinterpretar la prioridad durable de la obligación.'
        );
      }
      resultados.push(serializarObligacion(fila, resultadoAlta));
    }
    return Object.freeze(resultados);
  }

  async listarPendientes({ limite = 100 } = {}) {
    const maximo = enteroAcotado(limite, 1, 1000, 'limite');
    const filas = await this.clienteSql.consultar(
      `SELECT o.id,o.flujo_id,o.generacion_id,o.posicion_flujo,o.estado,
              o.prioridad,o.intentos,o.disponible_desde_utc,o.capturada_en_utc,
              p.installation_origen_id,p.familia,p.elemento_origen_id,
              p.ocurrencia_origen_id
         FROM outbox_federacion o
         JOIN posiciones_ocurrencias_flujos_federacion p
           ON p.flujo_id=o.flujo_id AND p.generacion_id=o.generacion_id
          AND p.posicion_flujo=o.posicion_flujo
        WHERE o.estado IN ('pendiente','reintentable')
          AND o.disponible_desde_utc<=UTC_TIMESTAMP(3)
        ORDER BY FIELD(o.prioridad,'operativaActual','reconstruccion'),
                 o.flujo_id,o.generacion_id,o.posicion_flujo
        LIMIT ?`,
      [maximo]
    );
    return Object.freeze(filas.map((fila) => Object.freeze({
      ...serializarObligacion(fila, null),
      ocurrencia: Object.freeze({
        installationOrigenId: fila.installation_origen_id,
        familia: fila.familia,
        elementoOrigenId: fila.elemento_origen_id,
        ocurrenciaOrigenId: fila.ocurrencia_origen_id
      })
    })));
  }
}

async function obtenerPosicionBloqueada(conexion, posicion) {
  const [filas] = await conexion.execute(
    `SELECT flujo_id FROM posiciones_ocurrencias_flujos_federacion
      WHERE flujo_id=? AND generacion_id=? AND posicion_flujo=? FOR UPDATE`,
    [posicion.flujoId, posicion.generacionId, posicion.posicionFlujo]
  );
  return filas[0] || null;
}

async function obtenerObligacionBloqueada(conexion, posicion) {
  const [filas] = await conexion.execute(
    `SELECT id,flujo_id,generacion_id,posicion_flujo,prioridad,estado,intentos,
            disponible_desde_utc,capturada_en_utc
       FROM outbox_federacion
      WHERE flujo_id=? AND generacion_id=? AND posicion_flujo=? FOR UPDATE`,
    [posicion.flujoId, posicion.generacionId, posicion.posicionFlujo]
  );
  return filas[0] || null;
}

function normalizarPosiciones(posiciones) {
  if (!Array.isArray(posiciones) || posiciones.length === 0) {
    throw new ErrorOutboxFederacion(
      'posiciones_ausentes',
      'La captura federada debe producir al menos una posición durable.'
    );
  }
  const unicas = new Map();
  for (const posicion of posiciones) {
    const flujoId = identidad(
      posicion?.flujoId,
      TIPOS_IDENTIDAD_FEDERADA.FLUJO,
      'flujoId'
    );
    const generacionId = identidad(
      posicion?.generacionId,
      TIPOS_IDENTIDAD_FEDERADA.GENERACION,
      'generacionId'
    );
    const posicionFlujo = decimalPositivo(posicion?.posicionFlujo, 'posicionFlujo');
    const prioridad = PRIORIDADES_FLUJO_FEDERACION.exigir(
      posicion?.prioridad ?? 'reconstruccion',
      { campo: 'prioridad' }
    );
    unicas.set(
      `${flujoId}\u0000${generacionId}\u0000${posicionFlujo}`,
      { flujoId, generacionId, posicionFlujo, prioridad }
    );
  }
  return [...unicas.values()].sort((a, b) =>
    a.flujoId.localeCompare(b.flujoId, 'en') ||
    a.generacionId.localeCompare(b.generacionId, 'en') ||
    compararDecimal(a.posicionFlujo, b.posicionFlujo)
  );
}

function serializarObligacion(fila, resultadoAlta) {
  return {
    id: String(fila.id),
    flujoId: fila.flujo_id,
    generacionId: fila.generacion_id,
    posicionFlujo: String(fila.posicion_flujo),
    prioridad: fila.prioridad,
    estado: fila.estado,
    intentos: Number(fila.intentos),
    disponibleDesdeUtc: fechaIso(fila.disponible_desde_utc),
    capturadaEnUtc: fechaIso(fila.capturada_en_utc),
    resultadoAlta
  };
}

function identidad(valor, tipo, campo) {
  try {
    return String(crearIdentidadFederada({ tipo, valor: String(valor || '') }));
  } catch (error) {
    throw new ErrorOutboxFederacion(
      'identidad_invalida',
      `${campo} no es canónica: ${error.message}`
    );
  }
}

function decimalPositivo(valor, campo) {
  const texto = String(valor ?? '');
  if (!/^[1-9][0-9]*$/u.test(texto)) {
    throw new ErrorOutboxFederacion('posicion_invalida', `${campo} no es positiva.`);
  }
  return texto;
}

function compararDecimal(a, b) {
  const primero = BigInt(a);
  const segundo = BigInt(b);
  return primero < segundo ? -1 : primero > segundo ? 1 : 0;
}

function enteroAcotado(valor, minimo, maximo, campo) {
  const numero = Number(valor);
  if (!Number.isSafeInteger(numero) || numero < minimo || numero > maximo) {
    throw new ErrorOutboxFederacion(
      'limite_invalido',
      `${campo} debe estar entre ${minimo} y ${maximo}.`
    );
  }
  return numero;
}

function exigirConexion(conexion) {
  if (!conexion?.execute || !conexion?.query) {
    throw new ErrorOutboxFederacion(
      'transaccion_prestada_ausente',
      'La outbox exige la conexión SQL prestada por el productor.'
    );
  }
}

async function exigirTransaccionActiva(conexion) {
  const [filas] = await conexion.query('SELECT @@in_transaction AS activa');
  if (!Boolean(filas[0]?.activa)) {
    throw new ErrorOutboxFederacion(
      'transaccion_prestada_inactiva',
      'La outbox solo puede encolarse dentro de la transacción productora activa.'
    );
  }
}

async function ahoraSql(conexion) {
  const [filas] = await conexion.query('SELECT UTC_TIMESTAMP(3) AS ahora');
  return filas[0].ahora;
}

function fechaIso(valor) {
  if (valor instanceof Date) return valor.toISOString();
  return `${String(valor).replace(' ', 'T')}Z`;
}

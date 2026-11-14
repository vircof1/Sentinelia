import {
  TIPOS_IDENTIDAD_FEDERADA,
  crearIdentidadFederada
} from '../src/IdentidadFederada.js';

const PERFIL_DISPONIBILIDAD_OUTBOX =
  'sentinelia-federacion-outbox-disponible-v1';

export class PublicadorDisponibilidadOutboxFederacionRedis {
  constructor({
    clienteRedis,
    canal = 'sentinelia:federacion:datos:disponibles:v1',
    reloj = () => new Date()
  } = {}) {
    if (typeof clienteRedis?.publish !== 'function') {
      throw new Error('La disponibilidad de la outbox exige Redis operativo.');
    }
    const canalNormalizado = String(canal || '').trim();
    if (!canalNormalizado) {
      throw new Error('El canal Redis de disponibilidad no puede estar vacío.');
    }
    if (typeof reloj !== 'function') {
      throw new Error('El reloj del publicador de disponibilidad no es válido.');
    }
    this.clienteRedis = clienteRedis;
    this.canal = canalNormalizado;
    this.reloj = reloj;
    Object.freeze(this);
  }

  async publicar({ posiciones = [] } = {}) {
    const prefijos = agruparPosiciones(posiciones);
    if (prefijos.length === 0) {
      return Object.freeze({ publicado: false, receptores: 0, prefijos });
    }
    const mensaje = Object.freeze({
      perfil: PERFIL_DISPONIBILIDAD_OUTBOX,
      version: 1,
      publicadoEnUtc: fechaIso(this.reloj()),
      prefijos
    });
    const receptores = await this.clienteRedis.publish(
      this.canal,
      JSON.stringify(mensaje)
    );
    return Object.freeze({
      publicado: true,
      receptores: Number(receptores || 0),
      prefijos,
      mensaje
    });
  }
}

function agruparPosiciones(posiciones) {
  if (!Array.isArray(posiciones)) {
    throw new Error('Las posiciones disponibles deben formar una colección.');
  }
  const grupos = new Map();
  for (const posicion of posiciones) {
    const flujoId = identidad(posicion?.flujoId, TIPOS_IDENTIDAD_FEDERADA.FLUJO);
    const generacionId = identidad(
      posicion?.generacionId,
      TIPOS_IDENTIDAD_FEDERADA.GENERACION
    );
    const numero = decimalPositivo(posicion?.posicionFlujo);
    const clave = `${flujoId}\u0000${generacionId}`;
    const grupo = grupos.get(clave) ?? {
      flujoId,
      generacionId,
      posiciones: new Set()
    };
    grupo.posiciones.add(numero);
    grupos.set(clave, grupo);
  }
  return Object.freeze([...grupos.values()]
    .sort((a, b) =>
      a.flujoId.localeCompare(b.flujoId, 'en') ||
      a.generacionId.localeCompare(b.generacionId, 'en')
    )
    .map((grupo) => {
      const ordenadas = [...grupo.posiciones].sort(compararDecimal);
      return Object.freeze({
        flujoId: grupo.flujoId,
        generacionId: grupo.generacionId,
        posicionMinimaObservada: ordenadas[0],
        posicionMaximaObservada: ordenadas.at(-1),
        totalPosiciones: ordenadas.length
      });
    }));
}

function identidad(valor, tipo) {
  return String(crearIdentidadFederada({ tipo, valor: String(valor || '') }));
}

function decimalPositivo(valor) {
  const texto = String(valor ?? '');
  if (!/^[1-9][0-9]*$/u.test(texto)) {
    throw new Error('La posición disponible debe ser un decimal positivo.');
  }
  return texto;
}

function compararDecimal(a, b) {
  const primero = BigInt(a);
  const segundo = BigInt(b);
  return primero < segundo ? -1 : primero > segundo ? 1 : 0;
}

function fechaIso(valor) {
  const fecha = valor instanceof Date ? valor : new Date(valor);
  if (Number.isNaN(fecha.getTime())) {
    throw new Error('El reloj produjo una fecha inválida.');
  }
  return fecha.toISOString();
}

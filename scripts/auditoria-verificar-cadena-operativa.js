import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  construirIntencionGenesisAuditoriaV1
} from '../paquetes/auditoria/src/HuellaIntencionAuditoria.js';
import {
  PERFIL_JCS_AUDITORIA_V1
} from '../paquetes/auditoria/src/PerfilJcsAuditoria.js';
import {
  VERSION_ENCADENADO_AUDITORIA_V1,
  obtenerHashGenesisAuditoriaV1,
  prepararEventoEncadenadoAuditoriaV1,
  hashAuditoriaAHex
} from '../paquetes/auditoria/src/SobreCanonicoAuditoria.js';
import {
  ESTADOS_VERIFICACION_CADENA_AUDITORIA,
  VerificadorCadenaAuditoria
} from '../paquetes/auditoria/src/VerificadorCadenaAuditoria.js';
import { generarUuidV7Auditoria } from '../paquetes/auditoria/src/UuidV7Auditoria.js';

async function main() {
  await verificarCadenaCompletaPorLotes();
  await verificarCheckpointYRangoHistorico();
  await verificarRoturaYHuecoSinReparacion();
  await verificarConcurrenciaDetectada();
  await verificarContratoSql();
  console.log('[auditoria] OK 5.21.12a: verificacion=cadena_operativa lotes=cursor checkpoint=rango estados=sin_reparacion lectura=consistente');
}

async function verificarCadenaCompletaPorLotes() {
  const eventos = construirCadena({ totalEventosNegocio: 7 });
  const repositorio = new RepositorioFixture(eventos);
  const verificador = new VerificadorCadenaAuditoria({ repositorio, tamanoLote: 3 });
  const resultado = await verificador.verificarCadena({ claveCadena: CLAVE_CADENA });

  assert.equal(resultado.estado, ESTADOS_VERIFICACION_CADENA_AUDITORIA.INTEGRA);
  assert.equal(resultado.paginas, 3);
  assert.equal(resultado.eventosVerificados, 8);
  assert.equal(repositorio.maximoEventosPorPagina <= 3, true);
  assert.equal(resultado.intervalo.desdeSecuencia, '1');
  assert.equal(resultado.intervalo.hastaSecuencia, '8');
  assert.deepEqual(
    new Set(resultado.estadosOperativos),
    new Set(Object.values(ESTADOS_VERIFICACION_CADENA_AUDITORIA))
  );
}

async function verificarCheckpointYRangoHistorico() {
  const eventos = construirCadena({ totalEventosNegocio: 6 });
  const checkpoint = {
    ultimaSecuenciaRetirada: 3n,
    hashUltimaSecuenciaRetirada: eventos[2].hashActual,
    primeraSecuenciaConservada: 4n
  };
  const repositorioCheckpoint = new RepositorioFixture(eventos, { checkpoint });
  const desdeCheckpoint = await new VerificadorCadenaAuditoria({
    repositorio: repositorioCheckpoint,
    tamanoLote: 2
  }).verificarCadena({ claveCadena: CLAVE_CADENA, usarCheckpoint: true });

  assert.equal(desdeCheckpoint.estado, ESTADOS_VERIFICACION_CADENA_AUDITORIA.INTEGRA);
  assert.equal(desdeCheckpoint.intervalo.desdeSecuencia, '4');
  assert.equal(desdeCheckpoint.eventosVerificados, 4);
  assert.equal(desdeCheckpoint.ultimoHashVerificado, hashAuditoriaAHex(eventos.at(-1).hashActual));

  const repositorioRango = new RepositorioFixture(eventos);
  const rango = await new VerificadorCadenaAuditoria({
    repositorio: repositorioRango,
    tamanoLote: 2
  }).verificarCadena({
    claveCadena: CLAVE_CADENA,
    desdeSecuencia: '3',
    hastaSecuencia: '5'
  });

  assert.equal(rango.estado, ESTADOS_VERIFICACION_CADENA_AUDITORIA.INTEGRA);
  assert.equal(rango.intervalo.desdeSecuencia, '3');
  assert.equal(rango.intervalo.hastaSecuencia, '5');
  assert.equal(rango.eventosVerificados, 3);
  assert.equal(rango.ultimoHashVerificado, hashAuditoriaAHex(eventos[4].hashActual));
}

async function verificarRoturaYHuecoSinReparacion() {
  const eventosRotos = construirCadena({ totalEventosNegocio: 4 });
  eventosRotos[3] = Object.freeze({
    ...eventosRotos[3],
    hashAnterior: Buffer.from('ab'.repeat(32), 'hex')
  });
  const roto = await new VerificadorCadenaAuditoria({
    repositorio: new RepositorioFixture(eventosRotos),
    tamanoLote: 10
  }).verificarCadena({ claveCadena: CLAVE_CADENA });
  assert.equal(roto.estado, ESTADOS_VERIFICACION_CADENA_AUDITORIA.ROTA);
  assert.equal(roto.incidencias[0].codigo, 'hash_anterior_incoherente');

  const eventosConHueco = construirCadena({ totalEventosNegocio: 4 })
    .filter((evento) => evento.secuencia !== '3');
  const incompleta = await new VerificadorCadenaAuditoria({
    repositorio: new RepositorioFixture(eventosConHueco),
    tamanoLote: 10
  }).verificarCadena({ claveCadena: CLAVE_CADENA });
  assert.equal(incompleta.estado, ESTADOS_VERIFICACION_CADENA_AUDITORIA.INCOMPLETA);
  assert.equal(incompleta.incidencias[0].codigo, 'hueco_secuencia');
}

async function verificarConcurrenciaDetectada() {
  const eventos = construirCadena({ totalEventosNegocio: 3 });
  const repositorio = new RepositorioFixture(eventos, { cabeceraInestable: true });
  const resultado = await new VerificadorCadenaAuditoria({
    repositorio,
    tamanoLote: 2
  }).verificarCadena({ claveCadena: CLAVE_CADENA });

  assert.equal(resultado.estado, ESTADOS_VERIFICACION_CADENA_AUDITORIA.CONCURRENTE);
  assert.equal(resultado.incidencias[0].codigo, 'cabecera_modificada');
  assert.equal(resultado.intervalo.ultimaSecuenciaVerificada, '4');
}

async function verificarContratoSql() {
  const fuente = await readFile(
    new URL('../paquetes/auditoria/src/RepositorioVerificacionAuditoriaSql.js', import.meta.url),
    'utf8'
  );
  assert.match(fuente, /SET TRANSACTION ISOLATION LEVEL REPEATABLE READ/);
  assert.match(fuente, /beginTransaction\(\)/);
  assert.match(fuente, /secuencia > \?/);
  assert.match(fuente, /ORDER BY secuencia ASC/);
  assert.doesNotMatch(fuente, /\bOFFSET\b/i);
  assert.doesNotMatch(fuente, /\bUPDATE\b|\bDELETE\b|\bINSERT\b/i);
}

class RepositorioFixture {
  constructor(eventos, { checkpoint = null, cabeceraInestable = false } = {}) {
    this.eventos = eventos;
    this.checkpoint = checkpoint;
    this.cabeceraInestable = cabeceraInestable;
    this.maximoEventosPorPagina = 0;
  }

  async fijarAnclas({ claveCadena, desdeSecuencia = null, hastaSecuencia = null, usarCheckpoint = false }) {
    assert.equal(claveCadena, CLAVE_CADENA);
    const ultimo = this.eventos.at(-1);
    const desde = usarCheckpoint && this.checkpoint
      ? this.checkpoint.primeraSecuenciaConservada
      : BigInt(desdeSecuencia ?? '1');
    const hasta = BigInt(hastaSecuencia ?? ultimo.secuencia);
    const hashAnterior = usarCheckpoint && this.checkpoint
      ? this.checkpoint.hashUltimaSecuenciaRetirada
      : this.#hashAnterior(desde);
    const hashFinalEsperado = this.#hashActual(hasta);
    return Object.freeze({
      estadoInicial: ESTADOS_VERIFICACION_CADENA_AUDITORIA.INTEGRA,
      claveCadena,
      desdeSecuencia: String(desde),
      hastaSecuencia: String(hasta),
      hashAnterior,
      hashAnteriorHex: hashAuditoriaAHex(hashAnterior),
      hashFinalEsperado,
      hashFinalEsperadoHex: hashAuditoriaAHex(hashFinalEsperado),
      cabeceraInicial: Object.freeze({
        ultimaSecuencia: BigInt(ultimo.secuencia),
        ultimoHash: ultimo.hashActual
      }),
      checkpointInicial: this.checkpoint
    });
  }

  async leerPaginaEventos({ desdeExclusiva, hastaInclusiva, limite }) {
    const desde = BigInt(desdeExclusiva);
    const hasta = BigInt(hastaInclusiva);
    const pagina = this.eventos
      .filter((evento) => {
        const secuencia = BigInt(evento.secuencia);
        return secuencia > desde && secuencia <= hasta;
      })
      .slice(0, limite);
    this.maximoEventosPorPagina = Math.max(this.maximoEventosPorPagina, pagina.length);
    return pagina;
  }

  async confirmarAnclas() {
    if (this.cabeceraInestable) {
      return Object.freeze({
        estable: false,
        codigo: 'cabecera_modificada',
        mensaje: 'La cabecera avanzó durante la verificación.'
      });
    }
    return Object.freeze({ estable: true });
  }

  #hashAnterior(secuencia) {
    if (secuencia === 1n) return obtenerHashGenesisAuditoriaV1();
    return this.#hashActual(secuencia - 1n);
  }

  #hashActual(secuencia) {
    const evento = this.eventos.find((actual) => BigInt(actual.secuencia) === secuencia);
    if (!evento) throw new Error(`Fixture sin hash para secuencia ${secuencia}.`);
    return evento.hashActual;
  }
}

const CLAVE_CADENA = 'monitores:tenant:9';
const FECHA_BASE = '2026-07-25T10:00:00.000Z';

function construirCadena({ totalEventosNegocio }) {
  const eventos = [];
  let hashAnterior = obtenerHashGenesisAuditoriaV1();
  const genesis = construirEvento({
    secuencia: '1',
    hashAnterior,
    entrada: construirIntencionGenesisAuditoriaV1({
      eventoId: generarUuidV7Auditoria(),
      flujo: 'monitores',
      claveCadena: CLAVE_CADENA,
      tenantId: '9',
      origen: 'bootstrap',
      correlacionId: generarUuidV7Auditoria(),
      efectivoEnUtc: FECHA_BASE
    })
  });
  eventos.push(genesis);
  hashAnterior = genesis.hashActual;

  for (let indice = 0; indice < totalEventosNegocio; indice += 1) {
    const secuencia = String(indice + 2);
    const evento = construirEvento({
      secuencia,
      hashAnterior,
      entrada: construirCambioMonitor(indice)
    });
    eventos.push(evento);
    hashAnterior = evento.hashActual;
  }
  return eventos;
}

function construirEvento({ entrada, secuencia, hashAnterior }) {
  const preparado = prepararEventoEncadenadoAuditoriaV1({
    ...entrada,
    secuencia,
    registradoEnUtc: entrada.efectivoEnUtc
  }, { hashAnterior });
  return Object.freeze({
    sobre: preparado.sobre,
    secuencia,
    hashPayload: preparado.hashPayload,
    hashAnterior: preparado.hashAnterior,
    hashActual: preparado.hashActual
  });
}

function construirCambioMonitor(indice) {
  return {
    eventoId: generarUuidV7Auditoria(),
    tipo: 'monitor.actualizado',
    versionContrato: 1,
    flujo: 'monitores',
    claveCadena: CLAVE_CADENA,
    actorReal: { tipo: 'usuario', id: '1' },
    actorEfectivo: null,
    modoActuacion: 'directo',
    sujeto: { tipo: 'monitor', id: '4' },
    origen: 'web',
    scope: { tenantId: '9', empresaId: null, sitioId: null },
    correlacionId: generarUuidV7Auditoria(),
    causalidad: null,
    productor: 'portal_web',
    claveOperacion: `smoke-5-21-12a-${indice}`,
    rolEvento: 'principal',
    efectivoEnUtc: FECHA_BASE,
    versionCanonicalizador: PERFIL_JCS_AUDITORIA_V1,
    versionEncadenado: VERSION_ENCADENADO_AUDITORIA_V1,
    payload: {
      resultado: 'actualizado',
      camposCambiados: ['nombre'],
      antes: { nombre: `Monitor ${indice}` },
      despues: { nombre: `Monitor ${indice + 1}` }
    }
  };
}

main().catch((error) => {
  console.error('[auditoria] Falló la verificación 5.21.12a');
  console.error(error);
  process.exitCode = 1;
});

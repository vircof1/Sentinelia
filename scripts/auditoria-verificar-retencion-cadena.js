import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  ServicioRetencionCadenaAuditoria,
  __testablesServicioRetencionCadenaAuditoria
} from '../paquetes/auditoria/src/ServicioRetencionCadenaAuditoria.js';
import { prepararIntencionAuditoriaV1 } from '../paquetes/auditoria/src/HuellaIntencionAuditoria.js';
import { generarUuidV7Auditoria } from '../paquetes/auditoria/src/UuidV7Auditoria.js';
import {
  IncoherenciaCadenaAuditoria,
  __testablesRepositorioAuditoria
} from '../paquetes/auditoria/src/RepositorioAuditoria.js';

async function main() {
  await verificarRecorteYCheckpoint();
  await verificarRollbackAtomico();
  await verificarSinCambios();
  await verificarContinuacionTrasRecorteCompleto();
  await verificarContratoSql();
  console.log('[auditoria] OK 5.21.13a: retencion=prefijo_transaccional checkpoint=continuidad continuacion_post_recorte=si rollback=integro orden=identidades_antes_cabeceras');
}

async function verificarContinuacionTrasRecorteCompleto() {
  const cabecera = {
    id: 9,
    claveCadena: CLAVE_CADENA,
    ultimaSecuencia: 3n,
    ultimoHash: Buffer.from(HASH_3, 'hex')
  };
  const checkpointCoherente = {
    ultima_secuencia_retirada: '3',
    hash_ultima_secuencia_retirada: Buffer.from(HASH_3, 'hex'),
    primera_secuencia_conservada: null
  };

  const conexionConEvento = crearConexionPunta({
    evento: { hash_actual: Buffer.from(HASH_3, 'hex') }
  });
  await __testablesRepositorioAuditoria.verificarPuntaCadena(conexionConEvento, cabecera);
  assert.equal(conexionConEvento.consultas.length, 1);

  const conexion = crearConexionPunta({ checkpoint: checkpointCoherente });
  await __testablesRepositorioAuditoria.verificarPuntaCadena(conexion, cabecera);
  assert.equal(conexion.consultas.length, 2);
  assert.match(conexion.consultas[1], /FROM checkpoints_auditoria/);
  assert.match(conexion.consultas[1], /FOR UPDATE/);

  await assert.rejects(
    () => __testablesRepositorioAuditoria.verificarPuntaCadena(
      crearConexionPunta({
        checkpoint: {
          ...checkpointCoherente,
          hash_ultima_secuencia_retirada: Buffer.from(HASH_2, 'hex')
        }
      }),
      cabecera
    ),
    IncoherenciaCadenaAuditoria
  );
  await assert.rejects(
    () => __testablesRepositorioAuditoria.verificarPuntaCadena(
      crearConexionPunta({
        checkpoint: {
          ...checkpointCoherente,
          primera_secuencia_conservada: '4'
        }
      }),
      cabecera
    ),
    IncoherenciaCadenaAuditoria
  );
  await assert.rejects(
    () => __testablesRepositorioAuditoria.verificarPuntaCadena(
      crearConexionPunta(),
      cabecera
    ),
    IncoherenciaCadenaAuditoria
  );
}

function crearConexionPunta({ evento = null, checkpoint = null } = {}) {
  return {
    consultas: [],
    async execute(sql) {
      this.consultas.push(sql);
      if (/FROM eventos_auditoria/.test(sql)) return [[evento].filter(Boolean)];
      if (/FROM checkpoints_auditoria/.test(sql)) return [[checkpoint].filter(Boolean)];
      throw new Error('Consulta inesperada en la prueba de punta retenida.');
    }
  };
}

async function verificarRecorteYCheckpoint() {
  const entorno = crearEntorno();
  const resultado = await entorno.servicio.recortarPrefijo({
    claveCadena: CLAVE_CADENA,
    dias: 30,
    limiteEventos: 2,
    eventoId: generarUuidV7Auditoria(),
    correlacionId: generarUuidV7Auditoria(),
    efectivoEnUtc: '2026-07-25T12:00:00.000Z'
  });
  assert.equal(resultado.estado, 'aplicado');
  assert.equal(resultado.secuenciaDesde, '1');
  assert.equal(resultado.secuenciaHasta, '2');
  assert.equal(resultado.primeraSecuenciaConservada, '3');
  assert.deepEqual(entorno.repositorio.eventos.map(({ secuencia }) => secuencia), ['3']);
  assert.equal(entorno.repositorio.identidades.every(({ estado }) => estado === 'retenido'), true);
  assert.equal(entorno.repositorio.checkpoint.ultimaSecuenciaRetirada, '2');
  assert.equal(entorno.repositorio.checkpoint.primeraSecuenciaConservada, '3');
  assert.equal(entorno.auditoria.intenciones[0].tipo, 'auditoria.retencion_aplicada');
  assert.equal(entorno.auditoria.intenciones[0].payload.hashHasta, HASH_2);
  const preparada = prepararIntencionAuditoriaV1(entorno.auditoria.intenciones[0]);
  assert.equal(preparada.intencion.sujeto.id, CLAVE_CADENA);
  assert.equal(preparada.intencion.payload.cadenaAfectada, CLAVE_CADENA);
  assert.deepEqual(
    entorno.repositorio.traza.slice(0, 6),
    ['preflight', 'begin', 'bloquear_identidades', 'registrar_gobierno', 'bloquear_cabeceras', 'revalidar']
  );
  assert.equal(entorno.repositorio.traza.includes('commit'), true);
}

async function verificarRollbackAtomico() {
  const entorno = crearEntorno({ auditoriaFalla: true });
  await assert.rejects(
    () => entorno.servicio.recortarPrefijo({
      claveCadena: CLAVE_CADENA,
      dias: 30,
      limiteEventos: 2,
      eventoId: generarUuidV7Auditoria(),
      correlacionId: generarUuidV7Auditoria(),
      efectivoEnUtc: '2026-07-25T12:00:00.000Z'
    }),
    /gobierno bloqueado/
  );
  assert.deepEqual(entorno.repositorio.eventos.map(({ secuencia }) => secuencia), ['1', '2', '3']);
  assert.equal(entorno.repositorio.checkpoint, null);
  assert.equal(entorno.repositorio.traza.at(-1), 'rollback');
}

async function verificarSinCambios() {
  const entorno = crearEntorno({ sinPrefijo: true });
  const resultado = await entorno.servicio.recortarPrefijo({
    claveCadena: CLAVE_CADENA,
    dias: 30,
    limiteEventos: 2,
    efectivoEnUtc: '2026-07-25T12:00:00.000Z'
  });
  assert.equal(resultado.estado, 'sin_cambios');
  assert.equal(entorno.repositorio.traza.includes('begin'), false);

  const corte = __testablesServicioRetencionCadenaAuditoria.calcularCorteUtc(
    '2026-07-25T12:00:00.000Z',
    30
  );
  assert.equal(corte, '2026-06-25T12:00:00.000Z');
}

async function verificarContratoSql() {
  const fuente = await readFile(
    new URL('../paquetes/auditoria/src/RepositorioRetencionCadenaAuditoriaSql.js', import.meta.url),
    'utf8'
  );
  assert.match(fuente, /CAST\(secuencia AS CHAR\) AS secuencia/);
  assert.match(fuente, /ORDER BY eventos_auditoria\.secuencia ASC/);
  assert.doesNotMatch(fuente, /ORDER BY secuencia ASC/,
    'El alias textual ordenaría 1,10,100 antes que 2 al superar nueve eventos.');
  assert.match(fuente, /FOR UPDATE/);
  assert.match(fuente, /UPDATE identidades_idempotentes_auditoria/);
  assert.match(fuente, /DELETE FROM eventos_auditoria/);
  assert.match(fuente, /INSERT INTO checkpoints_auditoria/);
  assert.match(fuente, /ON DUPLICATE KEY UPDATE/);
  assert.doesNotMatch(fuente, /\bOFFSET\b/i);
  assert.ok(
    fuente.indexOf('bloquearIdentidadesPrefijo') < fuente.indexOf('bloquearCabeceras'),
    'El adaptador debe declarar identidades antes que cabeceras.'
  );
}

function crearEntorno({ auditoriaFalla = false, sinPrefijo = false } = {}) {
  const repositorio = new RepositorioRetencionFixture({ sinPrefijo });
  const auditoria = new AuditoriaFixture({ fallar: auditoriaFalla, traza: repositorio.traza });
  const servicio = new ServicioRetencionCadenaAuditoria({
    repositorioRetencion: repositorio,
    servicioAuditoria: auditoria,
    ahora: () => '2026-07-25T12:00:00.000Z'
  });
  return { servicio, repositorio, auditoria };
}

class RepositorioRetencionFixture {
  constructor({ sinPrefijo }) {
    this.sinPrefijo = sinPrefijo;
    this.traza = [];
    this.eventos = [
      { eventoId: 'e1', secuencia: '1', hashAnterior: HASH_0, hashActual: HASH_1 },
      { eventoId: 'e2', secuencia: '2', hashAnterior: HASH_1, hashActual: HASH_2 },
      { eventoId: 'e3', secuencia: '3', hashAnterior: HASH_2, hashActual: HASH_3 }
    ];
    this.identidades = [
      { productor: 'portal_web', claveOperacion: 'a', rolEvento: 'principal', eventoId: 'e1', estado: 'vigente' },
      { productor: 'portal_web', claveOperacion: 'b', rolEvento: 'principal', eventoId: 'e2', estado: 'vigente' }
    ];
    this.checkpoint = null;
  }

  async preflightPrefijo() {
    this.traza.push('preflight');
    if (this.sinPrefijo) return { aplicable: false, motivo: 'sin_prefijo_vencido' };
    return this.plan();
  }

  async enTransaccion(tarea) {
    this.traza.push('begin');
    const snapshot = JSON.stringify({
      eventos: this.eventos,
      identidades: this.identidades,
      checkpoint: this.checkpoint
    });
    try {
      const resultado = await tarea({ repositorio: this, conexion: { id: 'fixture' } });
      this.traza.push('commit');
      return resultado;
    } catch (error) {
      Object.assign(this, JSON.parse(snapshot));
      this.traza.push('rollback');
      throw error;
    }
  }

  async bloquearIdentidadesPrefijo(plan) {
    this.traza.push('bloquear_identidades');
    const identidades = [...plan.identidades].map((i) =>
      `${i.productor}/${i.claveOperacion}/${i.rolEvento}`
    );
    assert.deepEqual(identidades, [...identidades].sort());
  }

  async bloquearCabeceras() {
    this.traza.push('bloquear_cabeceras');
  }

  async revalidarPrefijo(plan) {
    this.traza.push('revalidar');
    assert.equal(plan.hashHasta, HASH_2);
    return plan;
  }

  async aplicarRecorte(plan, { eventoRetencionId, dias, aplicadoEnUtc }) {
    this.traza.push('aplicar');
    const retirados = new Set(['e1', 'e2']);
    this.eventos = this.eventos.filter((evento) => !retirados.has(evento.eventoId));
    this.identidades = this.identidades.map((identidad) =>
      retirados.has(identidad.eventoId)
        ? { ...identidad, estado: 'retenido', retenidoEnUtc: aplicadoEnUtc }
        : identidad
    );
    this.checkpoint = {
      ultimaSecuenciaRetirada: plan.secuenciaHasta,
      hashUltimaSecuenciaRetirada: plan.hashHasta,
      primeraSecuenciaConservada: plan.primeraSecuenciaConservada,
      dias,
      eventoRetencionId
    };
  }

  plan() {
    return {
      aplicable: true,
      cadenaId: 1,
      claveCadena: CLAVE_CADENA,
      secuenciaDesde: '1',
      secuenciaHasta: '2',
      hashAnteriorAlTramo: HASH_0,
      hashHasta: HASH_2,
      primeraSecuenciaConservada: '3',
      eventoIds: ['e1', 'e2'],
      corteUtc: '2026-06-25T12:00:00.000Z',
      identidades: this.identidades.map(({ productor, claveOperacion, rolEvento }) => ({
        productor,
        claveOperacion,
        rolEvento
      }))
    };
  }
}

class AuditoriaFixture {
  constructor({ fallar, traza }) {
    this.fallar = fallar;
    this.traza = traza;
    this.intenciones = [];
  }

  async registrarEnTransaccion({ intencion }, { conexion }) {
    assert.equal(conexion.id, 'fixture');
    this.traza.push('registrar_gobierno');
    if (this.fallar) throw new Error('gobierno bloqueado');
    this.intenciones.push(intencion);
    return {
      evento: {
        estado: 'incorporado',
        eventoId: intencion.eventoId
      }
    };
  }
}

const CLAVE_CADENA = 'monitores:tenant:9';
const HASH_0 = '0'.repeat(64);
const HASH_1 = '1'.repeat(64);
const HASH_2 = '2'.repeat(64);
const HASH_3 = '3'.repeat(64);

main().catch((error) => {
  console.error('[auditoria] Falló la verificación 5.21.13a');
  console.error(error);
  process.exitCode = 1;
});

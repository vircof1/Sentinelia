import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { ServicioRetencionAuditoriaGlobal } from '../paquetes/auditoria/src/ServicioRetencionAuditoriaGlobal.js';
import {
  __testablesRepositorioCoordinacionRetencionAuditoriaSql
} from '../paquetes/auditoria/src/RepositorioCoordinacionRetencionAuditoriaSql.js';

async function main() {
  await verificarDesactivada();
  await verificarBloqueoGlobalOcupado();
  await verificarBacklogPresupuestado();
  await verificarFalloParcialNoFatal();
  await verificarBootstrapNoFatal();
  await verificarTareaDiariaIdempotente();
  await verificarContratoSqlYRuntime();
  console.log('[auditoria] OK 5.21.13b: retencion_global=coordinada bootstrap=no_fatal tarea_diaria=idempotente backlog=presupuestado');
}

async function verificarDesactivada() {
  const entorno = crearEntorno({ retencionDias: null });
  const resultado = await entorno.servicio.ejecutarBootstrap({
    fechaReferenciaUtc: FECHA
  });
  assert.equal(resultado.activa, false);
  assert.equal(resultado.omitida, true);
  assert.equal(resultado.motivo, 'retencion_auditoria_desactivada');
  assert.deepEqual(entorno.repositorioCoordinacion.traza, []);
}

async function verificarBloqueoGlobalOcupado() {
  const entorno = crearEntorno({ bloqueoOcupado: true });
  const resultado = await entorno.servicio.ejecutar({
    fechaReferenciaUtc: FECHA,
    presupuestoCadenas: 2
  });
  assert.equal(resultado.activa, true);
  assert.equal(resultado.omitida, true);
  assert.equal(resultado.bloqueada, true);
  assert.equal(resultado.motivo, 'bloqueo_global_ocupado');
}

async function verificarBacklogPresupuestado() {
  const entorno = crearEntorno({
    cadenas: ['alertas:tenant:2', 'monitores:tenant:9', 'sistema:portal']
  });
  const resultado = await entorno.servicio.ejecutarBootstrap({
    fechaReferenciaUtc: FECHA,
    presupuestoCadenas: 2,
    limiteEventosPorCadena: 3
  });
  assert.equal(resultado.activa, true);
  assert.equal(resultado.omitida, false);
  assert.equal(resultado.cadenasProcesadas, 2);
  assert.equal(resultado.recortesAplicados, 2);
  assert.equal(resultado.backlogPosible, true);
  assert.deepEqual(
    entorno.retencionCadena.llamadas.map((llamada) => llamada.claveCadena),
    ['alertas:tenant:2', 'monitores:tenant:9']
  );
  assert.equal(entorno.retencionCadena.llamadas[0].dias, 30);
  assert.equal(entorno.retencionCadena.llamadas[0].limiteEventos, 3);
}

async function verificarFalloParcialNoFatal() {
  const entorno = crearEntorno({
    cadenas: ['alertas:tenant:2', 'monitores:tenant:9'],
    fallarCadena: 'alertas:tenant:2'
  });
  const resultado = await entorno.servicio.ejecutarBootstrap({
    fechaReferenciaUtc: FECHA,
    presupuestoCadenas: 2
  });
  assert.equal(resultado.errores, 1);
  assert.equal(resultado.recortesAplicados, 1);
  assert.equal(resultado.detalles[0].estado, 'error');
  assert.equal(resultado.detalles[1].estado, 'aplicado');
}

async function verificarBootstrapNoFatal() {
  const entorno = crearEntorno({ configuracionFalla: true });
  const resultado = await entorno.servicio.ejecutarBootstrap({
    fechaReferenciaUtc: FECHA
  });
  assert.equal(resultado.motivo, 'retencion_auditoria_error_bootstrap');
  assert.equal(resultado.errores, 1);
  assert.match(resultado.detalles[0].mensaje, /configuración no disponible/);
}

async function verificarTareaDiariaIdempotente() {
  const entorno = crearEntorno({ cadenas: ['sistema:portal'] });
  const primero = await entorno.servicio.ejecutarTareaDiaria({
    fechaReferenciaUtc: FECHA
  });
  const segundo = await entorno.servicio.ejecutarTareaDiaria({
    fechaReferenciaUtc: FECHA
  });
  assert.equal(primero.claveDiaria, '2026-07-25');
  assert.equal(primero.recortesAplicados, 1);
  assert.equal(segundo.omitida, true);
  assert.equal(segundo.motivo, 'retencion_global_ya_ejecutada_para_dia');
  assert.equal(entorno.retencionCadena.llamadas.length, 1);
}

async function verificarContratoSqlYRuntime() {
  assert.equal(
    __testablesRepositorioCoordinacionRetencionAuditoriaSql
      .NOMBRE_BLOQUEO_RETENCION_AUDITORIA,
    'sentinelia:auditoria:retencion-global'
  );
  const fuenteRepositorio = await readFile(
    new URL('../paquetes/auditoria/src/RepositorioCoordinacionRetencionAuditoriaSql.js', import.meta.url),
    'utf8'
  );
  assert.match(fuenteRepositorio, /GET_LOCK/);
  assert.match(fuenteRepositorio, /RELEASE_LOCK/);
  assert.match(fuenteRepositorio, /ORDER BY clave_cadena ASC/);
  assert.match(fuenteRepositorio, /LIMIT\s+\?/);

  const fuenteBootstrap = await readFile(
    new URL('../apps/sentinelia-runtime/src/BootstrapRuntime.js', import.meta.url),
    'utf8'
  );
  assert.match(fuenteBootstrap, /ejecutarBootstrap/);
  assert.match(fuenteBootstrap, /servicioRetencionAuditoriaGlobal/);

  const fuenteRuntime = await readFile(
    new URL('../apps/sentinelia-runtime/src/RuntimeSentinelia.js', import.meta.url),
    'utf8'
  );
  assert.match(fuenteRuntime, /ejecutarTareaDiaria/);
  assert.match(fuenteRuntime, /Retención auditable tick/);
}

function crearEntorno({
  retencionDias = 30,
  cadenas = ['sistema:portal'],
  bloqueoOcupado = false,
  fallarCadena = null,
  configuracionFalla = false
} = {}) {
  const configuracion = new ConfiguracionFixture({
    retencionDias,
    fallar: configuracionFalla
  });
  const repositorioCoordinacion = new CoordinacionFixture({
    cadenas,
    bloqueoOcupado
  });
  const retencionCadena = new RetencionCadenaFixture({ fallarCadena });
  const servicio = new ServicioRetencionAuditoriaGlobal({
    servicioConfiguracionPortal: configuracion,
    repositorioCoordinacion,
    servicioRetencionCadena: retencionCadena,
    ahora: () => FECHA
  });
  return { servicio, configuracion, repositorioCoordinacion, retencionCadena };
}

class ConfiguracionFixture {
  constructor({ retencionDias, fallar }) {
    this.retencionDias = retencionDias;
    this.fallar = fallar;
  }

  async asegurarActualizada() {
    if (this.fallar) throw new Error('configuración no disponible');
    return {
      obtenerConfiguracionAuditoria: () => ({
        retencionDias: this.retencionDias
      })
    };
  }
}

class CoordinacionFixture {
  constructor({ cadenas, bloqueoOcupado }) {
    this.cadenas = cadenas;
    this.bloqueoOcupado = bloqueoOcupado;
    this.traza = [];
  }

  async ejecutarConBloqueoGlobal(_opciones, tarea) {
    this.traza.push('bloqueo_global');
    if (this.bloqueoOcupado) {
      return { adquirido: false, motivo: 'bloqueo_global_ocupado' };
    }
    return { adquirido: true, resultado: await tarea() };
  }

  async listarClavesCadenas({ limite }) {
    this.traza.push('listar_cadenas');
    return this.cadenas
      .slice()
      .sort()
      .slice(0, limite)
      .map((claveCadena) => ({ claveCadena }));
  }
}

class RetencionCadenaFixture {
  constructor({ fallarCadena }) {
    this.fallarCadena = fallarCadena;
    this.llamadas = [];
  }

  async recortarPrefijo(entrada) {
    this.llamadas.push(entrada);
    if (entrada.claveCadena === this.fallarCadena) {
      throw new Error('fallo parcial simulado');
    }
    return {
      estado: 'aplicado',
      claveCadena: entrada.claveCadena,
      secuenciaHasta: '7',
      primeraSecuenciaConservada: '8'
    };
  }
}

const FECHA = '2026-07-25T12:00:00.000Z';

main().catch((error) => {
  console.error('[auditoria] Falló la verificación 5.21.13b');
  console.error(error);
  process.exitCode = 1;
});

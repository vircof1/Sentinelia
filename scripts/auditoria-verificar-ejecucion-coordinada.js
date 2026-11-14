import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { ServicioEjecucionVerificacionAuditoria } from '../paquetes/auditoria/src/ServicioEjecucionVerificacionAuditoria.js';

async function main() {
  await verificarBootstrapNoBloqueante();
  await verificarDiariaConLeasePresupuestoYRotacion();
  await verificarLeaseOcupado();
  await verificarCliHumanoYJson();
  await verificarContratoSqlYCli();
  console.log('[auditoria] OK 5.21.12c: ejecucion=coordinada bootstrap=no_bloqueante diaria=lease_presupuesto_rotacion cli=humano_json');
}

async function verificarBootstrapNoBloqueante() {
  const entorno = crearEntorno();
  const resultado = await entorno.servicio.comprobarBootstrap({ limite: 10 });
  assert.equal(resultado.bloqueante, false);
  assert.equal(resultado.estado, 'pendiente');
  assert.equal(resultado.totalCabecerasObservadas, 3);
  assert.equal(resultado.pendientes, 2);
}

async function verificarDiariaConLeasePresupuestoYRotacion() {
  const entorno = crearEntorno({
    ahoraMs: relojMs([0, 1, 99, 101])
  });
  const resultado = await entorno.servicio.ejecutarDiaria({
    instanciaId: 'instancia-a',
    limiteCadenas: 3,
    presupuestoMs: 100
  });
  assert.equal(resultado.estado, 'ejecutada');
  assert.equal(resultado.cadenasProcesadas, 2);
  assert.equal(resultado.cursorClaveCadena, 'dns:portal');
  assert.equal(entorno.coordinacion.reclamaciones, 1);
  assert.equal(entorno.coordinacion.renovaciones, 2);
  assert.equal(entorno.coordinacion.liberaciones.at(-1).cursorClaveCadena, 'dns:portal');
  assert.deepEqual(
    entorno.verificador.verificadas,
    ['alertas:tenant:9', 'dns:portal']
  );
  assert.equal(entorno.diagnosticos.registrados.length, 2);
}

async function verificarLeaseOcupado() {
  const entorno = crearEntorno({ leaseDisponible: false });
  const resultado = await entorno.servicio.ejecutarDiaria({
    instanciaId: 'instancia-b'
  });
  assert.equal(resultado.estado, 'omitida_por_lease');
  assert.equal(resultado.cadenasProcesadas, 0);
  assert.equal(entorno.verificador.verificadas.length, 0);
}

async function verificarCliHumanoYJson() {
  const entorno = crearEntorno();
  const resultado = await entorno.servicio.verificarCadena({ claveCadena: 'monitores:tenant:9' });
  const humano = entorno.servicio.formatearSalida(resultado, { json: false });
  const json = entorno.servicio.formatearSalida(resultado, { json: true });
  assert.match(humano, /cadena monitores:tenant:9: integra/);
  assert.equal(JSON.parse(json).claveCadena, 'monitores:tenant:9');
  assert.equal(entorno.diagnosticos.registrados.at(-1).claveCadena, 'monitores:tenant:9');
}

async function verificarContratoSqlYCli() {
  const coordinacion = await readFile(
    new URL('../paquetes/auditoria/src/RepositorioCoordinacionVerificacionAuditoriaSql.js', import.meta.url),
    'utf8'
  );
  const cli = await readFile(
    new URL('./auditoria-integridad-operar.js', import.meta.url),
    'utf8'
  );
  assert.match(coordinacion, /FOR UPDATE/);
  assert.match(coordinacion, /lease_expira_utc > UTC_TIMESTAMP\(3\)/);
  assert.match(coordinacion, /cursor_clave_cadena/);
  assert.match(coordinacion, /ORDER BY clave_cadena ASC/);
  assert.doesNotMatch(coordinacion, /\bOFFSET\b/i);
  assert.match(cli, /bootstrap\|diaria\|cadena/);
  assert.match(cli, /--json/);
  assert.match(cli, /ServicioEjecucionVerificacionAuditoria/);
}

function crearEntorno({ leaseDisponible = true, ahoraMs = (() => 0) } = {}) {
  const coordinacion = new CoordinacionFixture({ leaseDisponible });
  const verificador = new VerificadorFixture();
  const diagnosticos = new DiagnosticosFixture();
  const servicio = new ServicioEjecucionVerificacionAuditoria({
    repositorioCoordinacion: coordinacion,
    verificadorCadena: verificador,
    servicioDiagnosticos: diagnosticos,
    ahoraMs
  });
  return { servicio, coordinacion, verificador, diagnosticos };
}

class CoordinacionFixture {
  constructor({ leaseDisponible }) {
    this.leaseDisponible = leaseDisponible;
    this.reclamaciones = 0;
    this.renovaciones = 0;
    this.liberaciones = [];
  }

  async comprobarCabecerasRapido() {
    return [
      { claveCadena: 'alertas:tenant:9', ultimaSecuencia: '8', diagnosticoHastaSecuencia: '8', pendienteRevision: false, diagnosticoEstado: 'integra' },
      { claveCadena: 'dns:portal', ultimaSecuencia: '5', diagnosticoHastaSecuencia: '3', pendienteRevision: false, diagnosticoEstado: 'integra' },
      { claveCadena: 'monitores:tenant:9', ultimaSecuencia: '2', diagnosticoHastaSecuencia: null, pendienteRevision: false, diagnosticoEstado: null }
    ];
  }

  async reclamarLease({ instanciaId }) {
    this.reclamaciones += 1;
    if (!this.leaseDisponible) return null;
    return { instanciaId, leaseToken: Buffer.alloc(32, 1), fencingToken: '2' };
  }

  async seleccionarCadenasRotacion() {
    return [
      { claveCadena: 'alertas:tenant:9' },
      { claveCadena: 'dns:portal' },
      { claveCadena: 'monitores:tenant:9' }
    ];
  }

  async renovarLease() {
    this.renovaciones += 1;
    return true;
  }

  async liberarLease(_lease, datos) {
    this.liberaciones.push(datos);
    return true;
  }
}

class VerificadorFixture {
  constructor() {
    this.verificadas = [];
  }

  async verificarCadena({ claveCadena }) {
    this.verificadas.push(claveCadena);
    return {
      estado: 'integra',
      claveCadena,
      intervalo: { desdeSecuencia: '1', hastaSecuencia: '8', ultimaSecuenciaVerificada: '8' },
      paginas: 1,
      eventosVerificados: 8,
      ultimoHashVerificado: 'a'.repeat(64),
      hashFinalEsperado: 'a'.repeat(64),
      anclas: { cabecera: { ultimaSecuencia: '8', ultimoHash: 'a'.repeat(64) } },
      incidencias: []
    };
  }
}

class DiagnosticosFixture {
  constructor() {
    this.registrados = [];
  }

  async registrarResultadoVerificacion(resultado) {
    this.registrados.push(resultado);
    return { pendienteRevision: false };
  }
}

function relojMs(valores) {
  let indice = 0;
  return () => valores[Math.min(indice++, valores.length - 1)];
}

main().catch((error) => {
  console.error('[auditoria] Falló la verificación 5.21.12c');
  console.error(error);
  process.exitCode = 1;
});

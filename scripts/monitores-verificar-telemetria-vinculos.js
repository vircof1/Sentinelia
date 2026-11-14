import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import {
  CODIGOS_ERROR_VINCULO_MONITOR_TELEMETRIA,
  ErrorVinculoMonitorTelemetria,
  RepositorioVinculosMonitoresTelemetria,
  VinculoMonitorTelemetriaPersistido
} from '../paquetes/monitores/src/RepositorioVinculosMonitoresTelemetria.js';

const rutaMigracion = new URL(
  '../migraciones/sql/0001_esquema_inicial.sql',
  import.meta.url
);
const rutaRepositorio = new URL(
  '../paquetes/monitores/src/RepositorioVinculosMonitoresTelemetria.js',
  import.meta.url
);

async function verificarTopologiaSql() {
  const esquema = await readFile(rutaMigracion, 'utf8');
  const tabla = esquema.match(/CREATE TABLE `vinculos_monitores_telemetria` \([\s\S]*?\) ENGINE=/u)?.[0];
  assert.ok(tabla, 'El esquema inicial debe definir los vínculos de telemetría.');
  const normalizar = (texto) => texto.replaceAll('`', '').replace(/\s+/gu, '').toLowerCase();
  const migracion = tabla.replaceAll('`', '');
  for (const fragmento of [
    'CREATE TABLE vinculos_monitores_telemetria',
    'PRIMARY KEY (monitor_id)',
    'CHECK (monitor_tipo = \'telemetria\')',
    "tipo_fuente = 'senal_directa'",
    "tipo_fuente = 'regla_derivacion'",
    "tipo_fuente = 'senal_federada'",
    'FOREIGN KEY (\n      monitor_id,',
    'REFERENCES monitores (',
    'FOREIGN KEY (agente_id, tenant_id, empresa_id, sitio_id)',
    'REFERENCES agentes_sentinelia (id, tenant_id, empresa_id, sitio_id)',
    'FOREIGN KEY (senal_id, agente_id)',
    'REFERENCES senales_telemetria_agentes (id, agente_id)',
    'REFERENCES reglas_derivacion_telemetria (',
    'idx_vinculos_monitores_telemetria_senal',
    'idx_vinculos_monitores_telemetria_regla'
  ]) {
    assert.ok(normalizar(migracion).includes(normalizar(fragmento)), `El esquema debe contener: ${fragmento}`);
  }
  assert.equal((migracion.match(/ON DELETE CASCADE/g) || []).length, 4);
  assert.equal(
    /UNIQUE KEY[^\n]*(senal_id|regla_id)/.test(migracion),
    false,
    'Una fuente debe admitir varios monitores independientes.'
  );
}

async function verificarVinculoDirecto() {
  const cliente = new ClienteVinculosFalso();
  cliente.filas = [crearFilaDirecta({ monitorId: 101 })];
  const repositorio = new RepositorioVinculosMonitoresTelemetria(cliente);
  const vinculo = await repositorio.vincularSenalDirecta({
    monitorId: 101,
    agenteId: 31,
    senalId: 47
  });

  assert.ok(vinculo instanceof VinculoMonitorTelemetriaPersistido);
  assert.equal(vinculo.esSenalDirecta(), true);
  assert.equal(vinculo.monitor.tipo, 'telemetria');
  assert.equal(vinculo.senalOrigen.tipoDato, 'numero');
  assert.equal(vinculo.senalOrigen.unidad, 'ºC');
  assert.deepEqual(cliente.ultimaEjecucion.parametros, [101, 31, 47]);
  assert.match(
    cliente.ultimaEjecucion.sql,
    /st\.tipo_dato IN \('numero', 'booleano', 'estado', 'texto'\)/
  );
  assert.match(cliente.ultimaEjecucion.sql, /a\.sitio_id = m\.sitio_id/);
}

async function verificarVinculoDerivado() {
  const cliente = new ClienteVinculosFalso();
  cliente.filas = [crearFilaDerivada({ monitorId: 102 })];
  const repositorio = new RepositorioVinculosMonitoresTelemetria(cliente);
  const vinculo = await repositorio.vincularReglaDerivacion({
    monitorId: 102,
    reglaId: 73
  });

  assert.equal(vinculo.esReglaDerivacion(), true);
  assert.equal(vinculo.fuente.reglaId, 73);
  assert.equal(vinculo.fuente.agenteId, null);
  assert.equal(vinculo.agenteId, 31);
  assert.equal(vinculo.estadoRegla, 'activa');
  assert.deepEqual(cliente.ultimaEjecucion.parametros, [102, 73]);
  assert.match(cliente.ultimaEjecucion.sql, /r\.tenant_id = m\.tenant_id/);
  assert.doesNotMatch(cliente.ultimaEjecucion.sql, /r\.estado = 'activa'/);
}

async function verificarConsultasIndexablesYMultiplicidad() {
  const cliente = new ClienteVinculosFalso();
  cliente.filas = [
    crearFilaDirecta({ monitorId: 101 }),
    crearFilaDirecta({ monitorId: 103 })
  ];
  const repositorio = new RepositorioVinculosMonitoresTelemetria(cliente);
  const porSenal = await repositorio.listarPorSenalDirecta({
    agenteId: 31,
    senalId: 47
  });
  assert.deepEqual(porSenal.map(({ monitorId }) => monitorId), [101, 103]);
  assert.deepEqual(cliente.ultimaConsulta.parametros, [31, 47]);
  assert.match(cliente.ultimaConsulta.sql, /v\.senal_id = \?/);

  cliente.filas = [crearFilaDerivada({ monitorId: 102 })];
  const porRegla = await repositorio.listarPorReglaDerivacion(73);
  assert.deepEqual(porRegla.map(({ monitorId }) => monitorId), [102]);
  assert.deepEqual(cliente.ultimaConsulta.parametros, [73]);
  assert.match(cliente.ultimaConsulta.sql, /v\.regla_id = \?/);
}

async function verificarRechazos() {
  const incompatible = new ClienteVinculosFalso();
  incompatible.affectedRows = 0;
  const repositorio = new RepositorioVinculosMonitoresTelemetria(incompatible);
  await assert.rejects(
    () => repositorio.vincularSenalDirecta({
      monitorId: 101,
      agenteId: 31,
      senalId: 47
    }),
    (error) =>
      error instanceof ErrorVinculoMonitorTelemetria &&
      error.code ===
        CODIGOS_ERROR_VINCULO_MONITOR_TELEMETRIA.OBJETIVO_INCOMPATIBLE
  );

  const duplicado = new ClienteVinculosFalso();
  duplicado.errorEjecucion = Object.assign(new Error('duplicate'), {
    code: 'ER_DUP_ENTRY',
    errno: 1062
  });
  const repositorioDuplicado = new RepositorioVinculosMonitoresTelemetria(
    duplicado
  );
  await assert.rejects(
    () => repositorioDuplicado.vincularReglaDerivacion({
      monitorId: 102,
      reglaId: 73
    }),
    (error) =>
      error instanceof ErrorVinculoMonitorTelemetria &&
      error.code ===
        CODIGOS_ERROR_VINCULO_MONITOR_TELEMETRIA.MONITOR_YA_VINCULADO
  );
}

async function verificarFronteras() {
  const repositorio = await readFile(rutaRepositorio, 'utf8');
  assert.equal(/DELETE\s+FROM\s+vinculos_monitores_telemetria/i.test(repositorio), true);
  assert.ok(repositorio.includes('eliminarPorMonitorId'));
  assert.equal(repositorio.includes('estado_actual_telemetria_agentes'), false);
  assert.equal(repositorio.includes('observaciones_telemetria_agentes'), false);
  assert.equal(repositorio.includes('periodos_vida_pol_agentes'), false);
  assert.equal(repositorio.includes('alertas_activas_monitores'), false);
  assert.equal(repositorio.includes('triggers'), false);
}

class ClienteVinculosFalso {
  constructor() {
    this.affectedRows = 1;
    this.filas = [];
    this.errorEjecucion = null;
    this.ultimaEjecucion = null;
    this.ultimaConsulta = null;
  }

  async ejecutar(sql, parametros) {
    this.ultimaEjecucion = { sql, parametros };
    if (this.errorEjecucion) {
      throw this.errorEjecucion;
    }
    return [{ affectedRows: this.affectedRows }];
  }

  async consultar(sql, parametros) {
    this.ultimaConsulta = { sql, parametros };
    return this.filas;
  }
}

function crearFilaDirecta({ monitorId }) {
  return crearFilaBase({
    monitorId,
    tipoFuente: 'senal_directa',
    senalId: 47,
    reglaId: null,
    reglaEstado: null
  });
}

function crearFilaDerivada({ monitorId }) {
  return crearFilaBase({
    monitorId,
    tipoFuente: 'regla_derivacion',
    senalId: null,
    reglaId: 73,
    reglaEstado: 'activa'
  });
}

function crearFilaBase({
  monitorId,
  tipoFuente,
  senalId,
  reglaId,
  reglaEstado
}) {
  return {
    monitor_id: monitorId,
    tipo_fuente: tipoFuente,
    tenant_id: 1,
    empresa_id: 2,
    sitio_id: 3,
    agente_id: 31,
    senal_id: senalId,
    regla_id: reglaId,
    senal_origen_id: 47,
    senal_origen_tipo_dato: 'numero',
    senal_origen_unidad: 'ºC',
    regla_estado: reglaEstado,
    fecha_creacion: new Date('2026-07-20T10:00:00Z'),
    fecha_actualizacion: new Date('2026-07-20T10:00:00Z')
  };
}

async function main() {
  await verificarTopologiaSql();
  await verificarVinculoDirecto();
  await verificarVinculoDerivado();
  await verificarConsultasIndexablesYMultiplicidad();
  await verificarRechazos();
  await verificarFronteras();

  console.log('OK: vinculación persistente de monitores de telemetría verificada.');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';

import { ClienteSql } from '../paquetes/persistencia-sql/src/ClienteSql.js';
import { obtenerConfiguracionAplicacion } from '../paquetes/utilidades/src/configuracion/obtenerConfiguracionAplicacion.js';
import {
  resolverTransicionEntradaFederadaMonitorLogico
} from '../paquetes/monitores/src/ResolucionEntradaFederadaMonitorLogico.js';
import { EjecutorMonitorBooleano } from '../apps/sentinelia-runtime/src/ejecucion/EjecutorMonitorBooleano.js';
import { RepositorioEntradasFederadasMonitoresLogicosSql } from '../paquetes/monitores/src/RepositorioEntradasFederadasMonitoresLogicosSql.js';
import { TIPOS_IDENTIDAD_FEDERADA } from '../paquetes/federacion/src/IdentidadFederada.js';
import { id, migrar } from './federacion-verificar-5-22-15g.js';

await main();

async function main() {
  verificarMaquinaCandidatos();
  await verificarObservacionCompleta();
  await verificarPersistenciaSql();
  console.log('[federacion] OK 5.22.16f: estado durable, candidato estable, revisión y observación completa');
}

function verificarMaquinaCandidatos() {
  const objetivo = objetivoFixture({ valor: false, revision: 1, retardo: 10 });
  const inicio = resolverTransicionEntradaFederadaMonitorLogico({
    objetivo, observadoEnUtc: '2026-01-01T00:00:00.000Z'
  });
  assert.equal(inicio.valorBinarioEfectivo, true, 'El estado inicial crea la línea de base.');
  assert.equal(inicio.candidatoPendiente, true);
  assert.equal(inicio.candidatoIniciadoEnUtc, '2026-01-01T00:00:00.000Z');

  const repetida = resolverTransicionEntradaFederadaMonitorLogico({
    objetivo, estadoPersistido: inicio, observadoEnUtc: '2026-01-01T00:00:05.000Z'
  });
  assert.equal(repetida.candidatoIniciadoEnUtc, inicio.candidatoIniciadoEnUtc,
    'Una observación equivalente no reinicia el reloj.');

  const aplicada = resolverTransicionEntradaFederadaMonitorLogico({
    objetivo, estadoPersistido: repetida, observadoEnUtc: '2026-01-01T00:00:10.000Z'
  });
  assert.equal(aplicada.valorBinarioEfectivo, false);
  assert.equal(aplicada.candidatoPendiente, false);
  assert.equal(aplicada.transicionAplicada, true);

  const opuesta = resolverTransicionEntradaFederadaMonitorLogico({
    objetivo: objetivoFixture({ valor: true, revision: 1, retardo: 10 }),
    estadoPersistido: aplicada, observadoEnUtc: '2026-01-01T00:00:11.000Z'
  });
  const reemplazada = resolverTransicionEntradaFederadaMonitorLogico({
    objetivo, estadoPersistido: opuesta, observadoEnUtc: '2026-01-01T00:00:12.000Z'
  });
  assert.equal(reemplazada.candidatoValor, null,
    'Volver al valor estable cancela el candidato opuesto.');

  const candidata = resolverTransicionEntradaFederadaMonitorLogico({
    objetivo: objetivoFixture({ valor: true, revision: 1, retardo: 10 }),
    estadoPersistido: aplicada, observadoEnUtc: '2026-01-01T00:00:20.000Z'
  });
  const revisada = resolverTransicionEntradaFederadaMonitorLogico({
    objetivo: objetivoFixture({ valor: true, revision: 2, retardo: 10 }),
    estadoPersistido: candidata, observadoEnUtc: '2026-01-01T00:00:25.000Z'
  });
  assert.equal(revisada.candidatoIniciadoEnUtc, '2026-01-01T00:00:25.000Z');
  assert.equal(revisada.candidatoRevisionConfiguracion, 2);

  const sinAutoridad = resolverTransicionEntradaFederadaMonitorLogico({
    objetivo: objetivoFixture({ valor: true, revision: 2, retardo: 10,
      condicion: 'noAutorizada', bloquea: true }),
    estadoPersistido: revisada, observadoEnUtc: '2026-01-01T00:00:26.000Z'
  });
  assert.equal(sinAutoridad.valorBinarioEfectivo, false);
  assert.equal(sinAutoridad.candidatoPendiente, false);

  const antesReinicio = resolverTransicionEntradaFederadaMonitorLogico({
    objetivo: objetivoFixture({ valor: true, revision: 2, retardo: 10 }),
    estadoPersistido: aplicada,
    observadoEnUtc: '2026-01-01T00:00:30.000Z',
    epocaObservacion: 'boot-a'
  });
  const trasReinicio = resolverTransicionEntradaFederadaMonitorLogico({
    objetivo: objetivoFixture({ valor: true, revision: 2, retardo: 10 }),
    estadoPersistido: antesReinicio,
    observadoEnUtc: '2026-01-01T00:00:35.000Z',
    epocaObservacion: 'boot-b'
  });
  assert.equal(trasReinicio.candidatoPendiente, false,
    'Un arranque distinto invalida el tiempo parcial anterior.');
  assert.equal(trasReinicio.valorBinarioEfectivo, true,
    'La observación completa posterior al arranque establece la nueva línea de base.');
  assert.equal(trasReinicio.observacionCompletaPostArranque, true);

  const consolidando = resolverTransicionEntradaFederadaMonitorLogico({
    objetivo: objetivoFixture({ valor: false, revision: 2, retardo: 10,
      condicion: 'consolidando' }),
    estadoPersistido: aplicada,
    observadoEnUtc: '2026-01-01T00:01:00.000Z',
    epocaObservacion: 'boot-c'
  });
  assert.equal(consolidando.requiereObservacionCompleta, true);
  const consolidada = resolverTransicionEntradaFederadaMonitorLogico({
    objetivo: objetivoFixture({ valor: true, revision: 2, retardo: 10 }),
    estadoPersistido: consolidando,
    observadoEnUtc: '2026-01-01T00:01:05.000Z',
    epocaObservacion: 'boot-c'
  });
  assert.equal(consolidada.valorBinarioEfectivo, true);
  assert.equal(consolidada.candidatoPendiente, false);
  assert.equal(consolidada.requiereObservacionCompleta, false);
}

async function verificarObservacionCompleta() {
  let llamadas = 0;
  const proyecciones = {
    A: id(TIPOS_IDENTIDAD_FEDERADA.PROYECCION),
    B: id(TIPOS_IDENTIDAD_FEDERADA.PROYECCION)
  };
  const repositorio = {
    observarEntradasOperativasPorMonitorId: async (_monitorId, { observadoEnUtc }) => {
      llamadas += 1;
      assert.equal(observadoEnUtc, '2026-01-01T00:00:00.000Z');
      return ['A', 'B'].map((variable) => ({
        variable, fuente: 'monitor_federado', proyeccionId: proyecciones[variable],
        interpretacionDurable: true, valorBinarioEfectivo: true,
        condicionFuente: 'vigente', bloqueaEvaluacion: false
      }));
    }
  };
  const resultado = await new EjecutorMonitorBooleano({
    repositorioEntradasFederadas: repositorio
  }).ejecutar({
    id: 7, nombre: 'Completo', tipo: 'booleano', configuracion: {
      version: 4, expresion: 'A AND B', estadoInicial: 'disponible',
      dependencias: ['A', 'B'].map((variable) => ({
        variable, fuente: 'monitor_federado', proyeccionId: proyecciones[variable]
      }))
    }
  }, { ejecutadoEnUtc: '2026-01-01T00:00:00.000Z' });
  assert.equal(llamadas, 1, 'Todas las entradas se materializan como una observación completa.');
  assert.equal(resultado.metricaPrincipal.resultadoLogico, true);
}

async function verificarPersistenciaSql() {
  const configuracion = obtenerConfiguracionAplicacion();
  assert.equal(configuracion.sql.estaCompleta, true);
  const base = `sentinelia_fixture_52216f_${randomBytes(6).toString('hex')}`;
  const administrador = new ClienteSql(configuracion.sql);
  let sql;
  try {
    await administrador.ejecutar(
      `CREATE DATABASE ${administrador.escaparIdentificador(base)} CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`
    );
    sql = new ClienteSql({ ...configuracion.sql, baseDatos: base });
    await migrar(sql);
    const columnas = await sql.consultar(
      `SELECT column_name,character_maximum_length FROM information_schema.columns
        WHERE table_schema=? AND table_name='estados_entradas_federadas_monitores_logicos'`,
      [base]
    );
    const nombres = new Set(columnas.map((fila) => fila.column_name));
    for (const nombre of ['valor_binario_efectivo', 'condicion_fuente',
      'candidato_iniciado_en_utc', 'candidato_vence_en_utc',
      'revision_configuracion_aplicada', 'epoca_observacion',
      'requiere_observacion_completa']) assert.ok(nombres.has(nombre));
    const epoca = columnas.find((fila) => fila.column_name === 'epoca_observacion');
    assert.ok(Number(epoca.character_maximum_length) >= 64,
      'La época durable debe admitir la identidad canónica de arranque completa.');
    const bootCanonico = id(TIPOS_IDENTIDAD_FEDERADA.ARRANQUE);
    assert.ok(bootCanonico.length > 36);
    assert.doesNotThrow(() => new RepositorioEntradasFederadasMonitoresLogicosSql(
      sql,
      { epocaObservacion: bootCanonico }
    ));
    assert.throws(() => new RepositorioEntradasFederadasMonitoresLogicosSql(
      sql,
      { epocaObservacion: 'x'.repeat(65) }
    ), /hasta 64 caracteres/u);
  } finally {
    await sql?.cerrar().catch(() => {});
    await administrador.ejecutar(
      `DROP DATABASE IF EXISTS ${administrador.escaparIdentificador(base)}`
    ).catch(() => {});
    await administrador.cerrar();
  }
}

function objetivoFixture({ valor, revision, retardo, condicion = 'vigente', bloquea = false }) {
  return {
    entradaId: 1, variable: 'A', proyeccionId: 'projection_fixture',
    revisionConfiguracion: revision, estadoInicial: 'correcto',
    retardoCambioSegundos: retardo, valorBinarioEfectivo: valor,
    condicionFuente: condicion, bloqueaEvaluacion: bloquea,
    ultimoEstadoRemotoEstable: valor ? 'correcto' : 'fallo'
  };
}

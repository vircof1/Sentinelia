import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import { RuntimeSentinelia } from '../apps/sentinelia-runtime/src/RuntimeSentinelia.js';
import { enlazarRepositorioAConexion } from '../apps/sentinelia-runtime/src/persistencia/RepositorioEnTransaccion.js';

await main();

async function main() {
  const [runtime, estado, eventos, alertas, historico, repositorio] =
    await Promise.all([
      leer('../apps/sentinelia-runtime/src/RuntimeSentinelia.js'),
      leer('../apps/sentinelia-runtime/src/estado/AplicadorResultadosEstadoActual.js'),
      leer('../apps/sentinelia-runtime/src/eventos/PersistidorEventosMonitores.js'),
      leer('../apps/sentinelia-runtime/src/alertas/GestorAlertasActivasMonitor.js'),
      leer('../apps/sentinelia-runtime/src/historico/GestorHistoricoMonitores.js'),
      leer('../paquetes/federacion/adaptadores/RepositorioMonitoresLocalSql.js')
    ]);
  assert.match(runtime, /persistirNucleoCicloMonitores/u);
  assert.match(runtime, /fronteraTransaccionalMonitores\.ejecutar\(persistir\)/u);
  assert.match(estado, /capturarRuntimeEnTransaccion/u);
  assert.match(eventos, /eventoIds/u);
  assert.match(historico, /historicoMonitorIds/u);
  assert.ok(
    alertas.indexOf('capturasFederadasCierre') <
      alertas.indexOf('repositorio.eliminarPorMonitorIds'),
    'El cierre federado debe prepararse antes del borrado de la alerta activa.'
  );
  assert.match(alertas, /encolarEnTransaccion/u);
  assert.match(repositorio, /estadoAlerta: 'cerrada'/u);
  assert.match(repositorio, /alertaAuditoriaId: clave/u);
  await verificarFronteraUnica();
  await verificarRepositorioLigado();
  console.log(
    '[federacion] OK 5.22.15j: nucleo_runtime=transaccion_unica ' +
    'estado_evento_alerta_historico=misma_conexion cierre=antes_del_borrado ' +
    'auditoria=atomica redis=postcommit'
  );
}

async function verificarFronteraUnica() {
  const runtime = new RuntimeSentinelia({
    configuracion: { runtime: { instanciaId: 'fixture-15j' } },
    bootstrapRuntime: {}
  });
  const conexion = { execute() {} };
  const orden = [];
  runtime.fronteraTransaccionalMonitores = {
    async ejecutar(trabajo) {
      orden.push('begin');
      const resultado = await trabajo(conexion);
      orden.push('commit');
      return resultado;
    }
  };
  runtime.estadoVivo = {};
  runtime.catalogoOperativo = {};
  runtime.aplicadorResultadosEstadoActual = {
    async aplicar(_entrada, opciones) {
      assert.equal(opciones.conexion, conexion);
      orden.push('estado');
      return { totalPersistidos: 1, resultadosEstabilizados: [] };
    }
  };
  runtime.persistidorEventosMonitores = {
    async persistirDesdeLote(_entrada, opciones) {
      assert.equal(opciones.conexion, conexion);
      orden.push('eventos');
      return { eventosPersistidos: [] };
    }
  };
  runtime.gestorAlertasActivasMonitor = {
    async aplicarResultados(_entrada, opciones) {
      assert.equal(opciones.conexion, conexion);
      orden.push('alertas');
      return { totalPersistidas: 0 };
    }
  };
  runtime.gestorHistoricoMonitores = {
    async aplicarResultados(entrada, opciones) {
      assert.equal(opciones.conexion, conexion);
      assert.deepEqual(entrada.persistenciaEventos, { eventosPersistidos: [] });
      orden.push('historico');
      return { totalPersistidos: 0 };
    }
  };
  await runtime.persistirNucleoCicloMonitores({ loteEjecucion: { resultados: [] } });
  assert.deepEqual(orden, [
    'begin', 'estado', 'eventos', 'alertas', 'historico', 'commit'
  ]);
}

async function verificarRepositorioLigado() {
  const llamadas = [];
  const conexion = {
    async execute(sql, parametros) {
      llamadas.push({ sql, parametros });
      return [[{ id: 1 }], []];
    }
  };
  class RepositorioFalso {
    constructor() {
      this.clienteSql = { obtenerConexion() {} };
    }
    consultar() {
      return this.clienteSql.consultar('SELECT id FROM prueba WHERE id=?', [1]);
    }
  }
  const ligado = enlazarRepositorioAConexion(new RepositorioFalso(), conexion);
  assert.deepEqual(await ligado.consultar(), [{ id: 1 }]);
  assert.equal(llamadas.length, 1);
}

function leer(ruta) {
  return readFile(new URL(ruta, import.meta.url), 'utf8');
}

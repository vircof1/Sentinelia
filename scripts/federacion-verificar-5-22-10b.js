import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import { CoordinadorArranqueLogicoFederacion } from
  '../paquetes/federacion/aplicacion/CoordinadorArranqueLogicoFederacion.js';
import { SupervisorArranqueLogicoFederacion } from
  '../paquetes/federacion/aplicacion/SupervisorArranqueLogicoFederacion.js';
import { FuenteEntropiaCriptograficaNode } from
  '../paquetes/federacion/adaptadores/FuenteEntropiaCriptograficaNode.js';
import { PublicadorArranqueFederacionRedis } from
  '../paquetes/federacion/adaptadores/PublicadorArranqueFederacionRedis.js';
import { RepositorioIdentidadFederacionSql } from
  '../paquetes/federacion/adaptadores/RepositorioIdentidadFederacionSql.js';
import { GeneradorIdentidadesFederadas } from
  '../paquetes/federacion/src/index.js';
import { FronteraTransaccionalLocal } from
  '../paquetes/persistencia-sql/src/FronteraTransaccionalLocal.js';

async function verificarCarreraYOrdenDeLlegada() {
  for (const orden of [['web', 'runtime'], ['runtime', 'web']]) {
    const entorno = crearEntorno();
    const coordinadores = Object.fromEntries(
      orden.map((proceso) => [proceso, entorno.crearCoordinador()])
    );
    const resultados = await Promise.all(
      orden.map((proceso) => coordinadores[proceso].asegurarActual())
    );
    assert.equal(
      resultados[0].installationId.serializar(),
      resultados[1].installationId.serializar()
    );
    assert.equal(resultados[0].bootId.serializar(), resultados[1].bootId.serializar());
    assert.deepEqual(new Set(resultados.map(({ origen }) => origen)),
      new Set(['creado', 'existente']));
    assert.equal(entorno.sql.identidadesInsertadas, 1);
    assert.equal(entorno.sql.arranquesInsertados, 1);
    assert.equal(entorno.sql.arranques.length, 1);
    assert.equal(entorno.redis.ttl, 120);
  }
}

async function verificarReinicioYPerdidaRedis() {
  const entorno = crearEntorno();
  const inicial = await entorno.crearCoordinador().asegurarActual();
  const procesoRecreado = await entorno.crearCoordinador().asegurarActual();
  assert.equal(procesoRecreado.bootId.serializar(), inicial.bootId.serializar());
  assert.equal(procesoRecreado.origen, 'existente');

  entorno.redis.perderTodo();
  const reconstruido = await entorno.crearCoordinador().asegurarActual({
    bootIdConocido: inicial.bootId
  });
  assert.equal(reconstruido.bootId.serializar(), inicial.bootId.serializar());
  assert.equal(reconstruido.origen, 'reconstruido');
  assert.equal(entorno.sql.arranques.length, 1);

  const renovado = await entorno.crearCoordinador().iniciarNuevoArranque({
    bootIdActualEsperado: inicial.bootId
  });
  assert.notEqual(renovado.bootId.serializar(), inicial.bootId.serializar());
  assert.equal(renovado.origen, 'renovado');
  assert.equal(entorno.sql.arranques.length, 2);
  await assert.rejects(
    entorno.crearCoordinador().iniciarNuevoArranque({
      bootIdActualEsperado: inicial.bootId
    }),
    (error) => error.codigo === 'arranque_cambio'
  );
  assert.equal(entorno.sql.arranques.length, 2);
}

async function verificarConflictosYSinAutoridadSqlViva() {
  const entorno = crearEntorno();
  const inicial = await entorno.crearCoordinador().asegurarActual();
  const otraInstalacion = crearEntorno({ redis: entorno.redis });
  await assert.rejects(
    otraInstalacion.publicador.asegurar({
      installationId: otraInstalacion.generarInstalacion(),
      bootIdCandidato: otraInstalacion.generarArranque()
    }),
    (error) => error.codigo === 'conflicto_instalacion'
  );
  assert.equal(entorno.redis.valor.bootId, inicial.bootId.serializar());
  assert.ok(entorno.sql.consultas.every((sql) =>
    !sql.includes('coordinacion_arranque_federacion')));
}

async function verificarRenovacionYComposicionReal() {
  const fuente = new FuenteEntropiaCriptograficaNode();
  assert.equal(fuente.entropiaBitsPorIdentidad, 128);
  assert.equal(fuente.generarBytes({ cantidadBytes: 16 }).byteLength, 16);

  const entorno = crearEntorno();
  let callbackIntervalo = null;
  let intervaloCancelado = false;
  const supervisor = new SupervisorArranqueLogicoFederacion({
    coordinador: entorno.crearCoordinador(),
    intervaloRenovacionMs: 40000,
    programarIntervalo(callback) {
      callbackIntervalo = callback;
      return { unref() {} };
    },
    cancelarIntervalo() { intervaloCancelado = true; }
  });
  const inicial = await supervisor.arrancar();
  assert.equal(typeof callbackIntervalo, 'function');
  const primeraRenovacion = supervisor.renovar();
  const renovacionConcurrente = supervisor.renovar();
  assert.equal(primeraRenovacion, renovacionConcurrente,
    'Las renovaciones solapadas deben compartir una sola operación.');
  const renovado = await primeraRenovacion;
  assert.equal(renovado.bootId.serializar(), inicial.bootId.serializar());
  assert.equal(renovado.origen, 'existente');
  assert.equal(entorno.sql.arranques.length, 1);
  await supervisor.detener();
  assert.equal(intervaloCancelado, true);

  const [web, runtime, composicion] = await Promise.all([
    readFile(new URL('../apps/sentinelia-web/src/index.js', import.meta.url), 'utf8'),
    readFile(new URL('../apps/sentinelia-runtime/src/BootstrapRuntime.js', import.meta.url), 'utf8'),
    readFile(new URL(
      '../paquetes/federacion/aplicacion/crearPlanoControlFederacionLocal.js',
      import.meta.url
    ), 'utf8')
  ]);
  for (const fuenteAplicacion of [web, runtime]) {
    assert.match(fuenteAplicacion, /crearPlanoControlFederacionLocal\s*\(\s*\{/,
      'Web y runtime deben ejecutar el mismo bootstrap federado real.');
  }
  assert.match(composicion, /FuenteEntropiaCriptograficaNode/);
  assert.match(composicion, /SupervisorArranqueLogicoFederacion/);
}

let siguienteSemillaEntorno = 0;

function crearEntorno({ redis = new ClienteRedisPresenciaFalso() } = {}) {
  const sql = new ClienteSqlIdentidadFalso();
  siguienteSemillaEntorno += 1;
  const generador = new GeneradorIdentidadesFederadas({
    fuenteEntropia: new FuenteEntropiaDeterminista(siguienteSemillaEntorno)
  });
  const repositorioIdentidad = new RepositorioIdentidadFederacionSql(sql);
  const publicador = new PublicadorArranqueFederacionRedis({ clienteRedis: redis });
  return {
    sql,
    redis,
    publicador,
    generarInstalacion: () => generador.generar('instalacion'),
    generarArranque: () => generador.generar('arranque'),
    crearCoordinador() {
      return new CoordinadorArranqueLogicoFederacion({
        fronteraTransaccional: new FronteraTransaccionalLocal(sql),
        repositorioIdentidad,
        generadorIdentidades: generador,
        publicadorArranque: publicador
      });
    }
  };
}

class FuenteEntropiaDeterminista {
  entropiaBitsPorIdentidad = 128;
  contador = 0;
  constructor(semilla) { this.semilla = semilla; }
  generarBytes({ cantidadBytes }) {
    this.contador += 1;
    return Uint8Array.from({ length: cantidadBytes },
      (_valor, indice) =>
        (this.semilla * 61 + this.contador * 43 + indice * 19) & 255);
  }
}

class ClienteRedisPresenciaFalso {
  valor = null;
  ttl = null;

  async eval(script, { arguments: args }) {
    const [installationId, segundo, tercero, ttl] = args;
    if (script.includes("if not actual then return {'ausente'}")) {
      if (!this.valor) return ['ausente'];
      if (this.valor.installationId !== installationId) return ['conflicto_instalacion'];
      if (this.valor.bootId !== segundo) return ['arranque_cambio'];
      this.valor = { versionContrato: 1, installationId, bootId: tercero, ttlSegundos: Number(ttl) };
      this.ttl = Number(ttl);
      return ['renovado', JSON.stringify(this.valor)];
    }
    if (this.valor) {
      if (this.valor.installationId !== installationId) return ['conflicto_instalacion'];
      if (tercero && this.valor.bootId !== tercero) {
        return ['conflicto_arranque', JSON.stringify(this.valor)];
      }
      this.ttl = Number(ttl);
      return ['existente', JSON.stringify(this.valor)];
    }
    this.valor = {
      versionContrato: 1,
      installationId,
      bootId: tercero || segundo,
      ttlSegundos: Number(ttl)
    };
    this.ttl = Number(ttl);
    return [tercero ? 'reconstruido' : 'creado', JSON.stringify(this.valor)];
  }

  perderTodo() {
    this.valor = null;
    this.ttl = null;
  }
}

class ClienteSqlIdentidadFalso {
  constructor() {
    this.identidad = null;
    this.arranques = [];
    this.consultas = [];
    this.identidadesInsertadas = 0;
    this.arranquesInsertados = 0;
    this.siguienteId = 1;
    this.siguienteInstante = 0;
    this.bloqueo = Promise.resolve();
  }
  async obtenerConexion() { return new ConexionSqlIdentidadFalsa(this); }
  async consultar(sql, parametros = []) { return this.procesar(sql, parametros); }
  procesar(sql, parametros = []) {
    this.consultas.push(sql);
    if (sql.includes('INSERT INTO identidad_instalacion_federacion')) {
      if (!this.identidad) {
        this.identidad = { installation_id: parametros[0], version_contrato: 1, creada_en_utc: this.instante() };
        this.identidadesInsertadas += 1;
      }
      return [{ affectedRows: 1 }];
    }
    if (sql.includes('FROM identidad_instalacion_federacion')) {
      return this.identidad ? [{ ...this.identidad }] : [];
    }
    if (sql.includes('INSERT INTO arranques_instalacion_federacion')) {
      const [bootId, installationId] = parametros;
      if (!this.arranques.some((fila) => fila.boot_id === bootId)) {
        const instante = this.instante();
        this.arranques.push({ id: this.siguienteId++, boot_id: bootId, installation_id: installationId,
          version_contrato: 1, iniciado_en_utc: instante, registrado_en_utc: instante });
        this.arranquesInsertados += 1;
      }
      return [{ affectedRows: 1 }];
    }
    if (sql.includes('FROM arranques_instalacion_federacion')) {
      return this.arranques.filter((fila) =>
        !sql.includes('WHERE boot_id = ?') || fila.boot_id === parametros[0]).map((fila) => ({ ...fila }));
    }
    throw new Error(`SQL no soportado por fixture 5.22.10b: ${sql}`);
  }
  instante() {
    const valor = new Date(Date.UTC(2026, 7, 1, 12, 0, 0, this.siguienteInstante));
    this.siguienteInstante += 1;
    return valor;
  }
}

class ConexionSqlIdentidadFalsa {
  constructor(base) { this.base = base; this.liberar = null; }
  async beginTransaction() {
    const anterior = this.base.bloqueo;
    this.base.bloqueo = new Promise((resolve) => { this.liberar = resolve; });
    await anterior;
  }
  async execute(sql, parametros = []) { return [this.base.procesar(sql, parametros)]; }
  async commit() { this.liberar?.(); this.liberar = null; }
  async rollback() { this.liberar?.(); this.liberar = null; }
  async release() {}
}

await verificarCarreraYOrdenDeLlegada();
await verificarReinicioYPerdidaRedis();
await verificarConflictosYSinAutoridadSqlViva();
await verificarRenovacionYComposicionReal();

console.log('[federacion] OK 5.22.10b: boot_logico=redis_ttl_renovable composicion=web_runtime sql=solo_historico carrera=atomica recuperacion=boot_conocido');

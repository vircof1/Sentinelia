import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import { BootstrapIdentidadInstalacionFederacion } from
  '../paquetes/federacion/aplicacion/BootstrapIdentidadInstalacionFederacion.js';
import { RepositorioIdentidadFederacionSql } from
  '../paquetes/federacion/adaptadores/RepositorioIdentidadFederacionSql.js';
import {
  GeneradorIdentidadesFederadas,
  TIPOS_IDENTIDAD_FEDERADA,
  crearFachadaPuertoFederacion
} from '../paquetes/federacion/src/index.js';
import { FronteraTransaccionalLocal } from
  '../paquetes/persistencia-sql/src/FronteraTransaccionalLocal.js';
import { DENYLIST_TABLAS_SCOPE_ORGANIZATIVO } from
  '../paquetes/jerarquia-organizativa/src/CatalogoScopeOrganizativo.js';
const MIGRACION_ESQUEMA = '0001_esquema_inicial.sql';

async function verificarMigracionesYPostcondiciones() {
  const esquema = (await leerMigracion(MIGRACION_ESQUEMA)).replaceAll('`', '');
  assert.match(esquema, /ENGINE=InnoDB/i);
  assert.match(esquema, /DATETIME\(3\)/i);
  assert.match(esquema, /id TINYINT(?:\(\d+\))? UNSIGNED NOT NULL/i);
  assert.match(esquema, /installation_id CHAR\(40\).*ascii_bin/i);
  assert.match(esquema, /UNIQUE KEY uk_identidad_instalacion_federacion_identidad/i);
  assert.match(esquema, /CHECK \(id = 1\)/i);
  assert.match(esquema, /boot_id CHAR\(37\).*ascii_bin/i);
  assert.match(esquema, /UNIQUE KEY uk_arranques_federacion_boot/i);
  assert.match(esquema, /idx_arranques_federacion_instalacion_cronologia/i);
  assert.match(esquema, /registrado_en_utc >= iniciado_en_utc/i);
  assert.match(esquema, /FOREIGN KEY \(installation_id\).*identidad_instalacion_federacion/i);
  assert.ok(DENYLIST_TABLAS_SCOPE_ORGANIZATIVO.includes('identidad_instalacion_federacion'));
  assert.ok(DENYLIST_TABLAS_SCOPE_ORGANIZATIVO.includes('arranques_instalacion_federacion'));
}

async function verificarBootstrapRepetible() {
  const sql = new ClienteSqlIdentidadFalso();
  const repositorio = new RepositorioIdentidadFederacionSql(sql);
  const fachada = crearFachadaPuertoFederacion(
    'repositorioIdentidad',
    repositorio
  );
  assert.deepEqual(Object.keys(fachada), [
    'obtenerIdentidadInstalacion',
    'registrarArranqueEnTransaccion',
    'listarArranquesConocidos'
  ]);
  const fuente = new FuenteEntropiaDeterminista();
  const generador = new GeneradorIdentidadesFederadas({ fuenteEntropia: fuente });
  const bootA = generador.generar(TIPOS_IDENTIDAD_FEDERADA.ARRANQUE);
  const bootstrap = new BootstrapIdentidadInstalacionFederacion({
    fronteraTransaccional: new FronteraTransaccionalLocal(sql),
    repositorioIdentidad: repositorio,
    generadorIdentidades: generador
  });

  const primera = await bootstrap.asegurar({ bootId: bootA });
  const segunda = await bootstrap.asegurar({ bootId: bootA });
  assert.equal(primera.identidadCreada, true);
  assert.equal(segunda.identidadCreada, false);
  assert.equal(
    primera.installationId.serializar(),
    segunda.installationId.serializar()
  );
  assert.equal(primera.bootId.serializar(), segunda.bootId.serializar());
  assert.equal(sql.identidadesInsertadas, 1);
  assert.equal(sql.arranquesInsertados, 1);
  assert.equal(
    fuente.solicitudes.filter(({ tipo }) =>
      tipo === TIPOS_IDENTIDAD_FEDERADA.INSTALACION).length,
    1
  );

  const bootB = generador.generar(TIPOS_IDENTIDAD_FEDERADA.ARRANQUE);
  const tercera = await bootstrap.asegurar({ bootId: bootB });
  assert.equal(tercera.identidadCreada, false);
  assert.equal(
    tercera.installationId.serializar(),
    primera.installationId.serializar()
  );
  const historico = await repositorio.listarArranquesConocidos();
  assert.equal(historico.length, 2);
  assert.deepEqual(
    historico.map(({ bootId }) => bootId.serializar()),
    [bootA.serializar(), bootB.serializar()]
  );
  assert.ok(historico.every(({ installationId }) =>
    installationId.esIgual(primera.installationId)));
  assert.ok(historico.every(({ iniciadoEnUtc, registradoEnUtc }) =>
    iniciadoEnUtc.endsWith('Z') && registradoEnUtc.endsWith('Z')));

  assert.equal(sql.commits, 3);
  assert.equal(sql.rollbacks, 0);
  assert.equal(sql.liberaciones, 3);
  assert.ok(sql.consultas.some(({ sql: consulta }) =>
    consulta.includes('FROM identidad_instalacion_federacion') &&
    consulta.includes('FOR UPDATE')));
  assert.ok(sql.consultas.some(({ sql: consulta }) =>
    consulta.includes('INSERT INTO arranques_instalacion_federacion') &&
    consulta.includes('UTC_TIMESTAMP(3)')));
  assert.ok(sql.consultas.every(({ sql: consulta }) =>
    !/Date\.now|NOW\(\)/.test(consulta)));

  await assert.rejects(
    bootstrap.asegurar({ bootId: primera.installationId }),
    (error) => error.codigo === 'tipo_mezclado'
  );
  assert.equal(sql.commits, 3);
}

function leerMigracion(nombre) {
  return readFile(new URL(`../migraciones/sql/${nombre}`, import.meta.url), 'utf8');
}

class FuenteEntropiaDeterminista {
  entropiaBitsPorIdentidad = 128;
  solicitudes = [];
  contador = 0;

  generarBytes({ cantidadBytes, tipo }) {
    this.solicitudes.push({ cantidadBytes, tipo });
    this.contador += 1;
    return Uint8Array.from(
      { length: cantidadBytes },
      (_valor, indice) => (this.contador * 31 + indice * 17) & 255
    );
  }
}

class ClienteSqlIdentidadFalso {
  constructor() {
    this.identidad = null;
    this.arranques = [];
    this.consultas = [];
    this.commits = 0;
    this.rollbacks = 0;
    this.liberaciones = 0;
    this.identidadesInsertadas = 0;
    this.arranquesInsertados = 0;
    this.siguienteId = 1;
    this.siguienteInstante = 0;
  }

  async obtenerConexion() {
    return new ConexionSqlIdentidadFalsa(this);
  }

  async consultar(sql, parametros = []) {
    return this.procesar(sql, parametros);
  }

  procesar(sql, parametros = []) {
    this.consultas.push({ sql, parametros: [...parametros] });
    if (sql.includes('INSERT INTO identidad_instalacion_federacion')) {
      if (!this.identidad) {
        this.identidad = {
          installation_id: parametros[0],
          version_contrato: 1,
          creada_en_utc: this.crearInstante()
        };
        this.identidadesInsertadas += 1;
      }
      return [{ affectedRows: this.identidad.installation_id === parametros[0] ? 1 : 0 }];
    }
    if (sql.includes('FROM identidad_instalacion_federacion')) {
      return this.identidad ? [{ ...this.identidad }] : [];
    }
    if (sql.includes('INSERT INTO arranques_instalacion_federacion')) {
      const [bootId, installationId] = parametros;
      if (!this.arranques.some((fila) => fila.boot_id === bootId)) {
        const instante = this.crearInstante();
        this.arranques.push({
          id: this.siguienteId++,
          boot_id: bootId,
          installation_id: installationId,
          version_contrato: 1,
          iniciado_en_utc: instante,
          registrado_en_utc: instante
        });
        this.arranquesInsertados += 1;
      }
      return [{ affectedRows: 1 }];
    }
    if (sql.includes('FROM arranques_instalacion_federacion')) {
      if (sql.includes('WHERE boot_id = ?')) {
        return this.arranques
          .filter((fila) => fila.boot_id === parametros[0])
          .map((fila) => ({ ...fila }));
      }
      return this.arranques.map((fila) => ({ ...fila }));
    }
    throw new Error(`SQL no soportado por el fixture 5.22.10a: ${sql}`);
  }

  crearInstante() {
    const fecha = new Date(Date.UTC(2026, 7, 1, 10, 0, 0, this.siguienteInstante));
    this.siguienteInstante += 1;
    return fecha;
  }
}

class ConexionSqlIdentidadFalsa {
  constructor(base) {
    this.base = base;
  }

  async beginTransaction() {}

  async execute(sql, parametros = []) {
    return [this.base.procesar(sql, parametros)];
  }

  async commit() {
    this.base.commits += 1;
  }

  async rollback() {
    this.base.rollbacks += 1;
  }

  async release() {
    this.base.liberaciones += 1;
  }
}

await verificarMigracionesYPostcondiciones();
await verificarBootstrapRepetible();

console.log(
  '[federacion] OK 5.22.10a: installation_id=singleton_durable ' +
    'boot_id=historico_utc bootstrap=repetible sql=transaccional'
);

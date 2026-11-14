import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  crearCondicionTipadaDerivacionTelemetria
} from '../paquetes/agentes/src/EvaluadorCondicionesDerivacionTelemetria.js';
import {
  RepositorioReglasDerivacionTelemetria
} from '../paquetes/agentes/src/RepositorioReglasDerivacionTelemetria.js';

const rutaMigracion = new URL(
  '../migraciones/sql/0001_esquema_inicial.sql',
  import.meta.url
);
const rutaRepositorio = new URL(
  '../paquetes/agentes/src/RepositorioReglasDerivacionTelemetria.js',
  import.meta.url
);

async function main() {
  await verificarEstructuraSql();
  await verificarRepositorioTransaccional();
  await verificarGuardarrailesDeScopeYUnidad();
  await verificarConsultasTemporales();

  console.log(
    '[agentes-telemetria] OK persistencia de reglas y revisiones verificada hasta 5.20a.4'
  );
}

async function verificarEstructuraSql() {
  const [migracion, repositorio] = await Promise.all([
    readFile(rutaMigracion, 'utf8').then(normalizarSqlConsolidado),
    readFile(rutaRepositorio, 'utf8')
  ]);

  for (const fragmento of [
    'CREATE TABLE IF NOT EXISTS reglas_derivacion_telemetria',
    'CREATE TABLE IF NOT EXISTS revisiones_reglas_derivacion_telemetria',
    'FOREIGN KEY (agente_id, tenant_id, empresa_id, sitio_id)',
    'REFERENCES agentes_sentinelia (id, tenant_id, empresa_id, sitio_id)',
    'FOREIGN KEY (senal_id, agente_id)',
    'REFERENCES senales_telemetria_agentes (id, agente_id)',
    'UNIQUE KEY uk_revisiones_derivacion_regla_numero (regla_id, numero)',
    'UNIQUE KEY uk_revisiones_derivacion_una_abierta (regla_abierta_id)',
    'vigente_hasta_utc > vigente_desde_utc',
    'ON DELETE CASCADE'
  ]) {
    assert.ok(migracion.includes(fragmento), `La migración debe contener: ${fragmento}`);
  }

  assert.equal(
    (migracion.match(/ON DELETE CASCADE/g) || []).length >= 3,
    true,
    'Agente, señal y regla deben propagar sus borrados mediante cascadas.'
  );
  assert.doesNotMatch(
    extraerDefinicionTabla(migracion, 'reglas_derivacion_telemetria'),
    /FOREIGN KEY \(revision_vigente_id\)/,
    'revision_vigente_id debe permanecer sin FK circular.'
  );
  assert.ok(repositorio.includes('await conexion.beginTransaction()'));
  assert.ok(repositorio.includes('FOR UPDATE'));
  assert.ok(repositorio.includes('SELECT UTC_TIMESTAMP(6) AS ahora_utc'));
  assert.ok(repositorio.includes('SET vigente_hasta_utc = ?'));
  assert.ok(repositorio.includes('SET revision_vigente_id = ?'));
  assert.equal(
    /DELETE\s+FROM\s+(reglas|revisiones)_reglas_derivacion/i.test(repositorio),
    false,
    'El repositorio no debe ofrecer borrado administrativo de reglas o revisiones.'
  );
  assert.equal(
    /UPDATE revisiones_reglas_derivacion_telemetria[\s\S]*SET\s+(condicion|severidad|mensaje|nombre)/i.test(
      repositorio
    ),
    false,
    'Una revisión persistida no debe modificar su configuración inmutable.'
  );
}

async function verificarRepositorioTransaccional() {
  const cliente = new ClienteSqlReglasFalso();
  const repositorio = new RepositorioReglasDerivacionTelemetria(cliente);
  const creada = await repositorio.crearConRevisionInicial({
    agenteId: 7,
    senalId: 23,
    tenantId: 1,
    empresaId: 2,
    sitioId: 3,
    revision: crearDatosRevision({ umbral: 80, nombre: 'Temperatura elevada' })
  });

  assert.equal(creada.regla.id, 31);
  assert.equal(creada.regla.revisionVigenteId, 101);
  assert.equal(creada.revisionVigente.numero, 1);
  assert.equal(creada.revisionVigente.condicion.configuracion.umbral, 80);
  assert.equal(cliente.conexion.commits, 1);
  assert.equal(cliente.conexion.rollbacks, 0);
  assert.equal(cliente.conexion.liberada, true);

  cliente.relojUtc = '2026-07-20T11:00:00Z';
  const nueva = await repositorio.crearNuevaRevision({
    reglaId: 31,
    revision: crearDatosRevision({ umbral: 90, nombre: 'Temperatura crítica' })
  });

  assert.equal(nueva.id, 102);
  assert.equal(nueva.numero, 2);
  assert.equal(nueva.condicion.configuracion.umbral, 90);
  assert.equal(cliente.regla.revision_vigente_id, 102);
  assert.equal(
    cliente.revisiones.get(101).vigente_hasta_utc.toISOString(),
    nueva.vigenteDesdeUtc
  );
  assert.equal(cliente.revisiones.get(102).vigente_hasta_utc, null);
  assert.equal(cliente.conexion.commits, 2);

  const historico = await repositorio.listarRevisionesPorRegla(31);
  assert.deepEqual(historico.map((revision) => revision.numero), [2, 1]);
}

async function verificarGuardarrailesDeScopeYUnidad() {
  const clienteScope = new ClienteSqlReglasFalso();
  const repositorioScope = new RepositorioReglasDerivacionTelemetria(clienteScope);
  await assert.rejects(
    () => repositorioScope.crearConRevisionInicial({
      agenteId: 7,
      senalId: 23,
      tenantId: 1,
      empresaId: 2,
      sitioId: 99,
      revision: crearDatosRevision({ umbral: 80 })
    }),
    /scope.*coincidir exactamente/i
  );
  assert.equal(clienteScope.conexion.rollbacks, 1);
  assert.equal(clienteScope.regla, null);

  const clienteUnidad = new ClienteSqlReglasFalso();
  const repositorioUnidad = new RepositorioReglasDerivacionTelemetria(
    clienteUnidad
  );
  await assert.rejects(
    () => repositorioUnidad.crearConRevisionInicial({
      agenteId: 7,
      senalId: 23,
      tenantId: 1,
      empresaId: 2,
      sitioId: 3,
      revision: {
        ...crearDatosRevision({ umbral: 80 }),
        condicion: crearCondicionTipadaDerivacionTelemetria({
          senal: { id: 23, agenteId: 7, tipoDato: 'numero', unidad: 'C' },
          tipo: 'numero',
          operador: '>',
          umbral: 80
        })
      }
    }),
    /unidad catalogada/
  );
  assert.equal(clienteUnidad.conexion.rollbacks, 1);
  assert.equal(clienteUnidad.regla, null);
}

async function verificarConsultasTemporales() {
  const cliente = new ClienteSqlReglasFalso();
  const repositorio = new RepositorioReglasDerivacionTelemetria(cliente);
  await repositorio.crearConRevisionInicial({
    agenteId: 7,
    senalId: 23,
    tenantId: 1,
    empresaId: 2,
    sitioId: 3,
    revision: crearDatosRevision({ umbral: 80 })
  });
  cliente.relojUtc = '2026-07-20T11:00:00Z';
  await repositorio.crearNuevaRevision({
    reglaId: 31,
    revision: crearDatosRevision({ umbral: 90 })
  });

  const anterior = await repositorio.buscarRevisionAplicable({
    reglaId: 31,
    recibidoEnUtc: '2026-07-20T10:30:00Z'
  });
  const limite = await repositorio.buscarRevisionAplicable({
    reglaId: 31,
    recibidoEnUtc: '2026-07-20T11:00:00Z'
  });
  assert.equal(anterior.id, 101);
  assert.equal(limite.id, 102);

  const activas = await repositorio.listarActivasPorSenalEn({
    senalId: 23,
    recibidoEnUtc: '2026-07-20T10:30:00Z'
  });
  assert.equal(activas.length, 1);
  assert.equal(activas[0].revisionAplicable.id, 101);
  assert.equal(activas[0].regla.revisionVigenteId, 102);
}

function crearDatosRevision({ umbral, nombre = 'Temperatura fuera de tolerancia' }) {
  return {
    condicion: crearCondicionTipadaDerivacionTelemetria({
      senal: { id: 23, agenteId: 7, tipoDato: 'numero', unidad: 'ºC' },
      tipo: 'numero',
      operador: '>',
      umbral
    }),
    severidadCalculada: 'advertencia',
    mensajeOperativo: 'Temperatura fuera del rango configurado.',
    nombre,
    descripcion: 'Regla de prueba.',
    metadatos: { causaProbable: 'Refrigeración insuficiente.' }
  };
}

class ClienteSqlReglasFalso {
  constructor() {
    this.relojUtc = '2026-07-20T10:00:00Z';
    this.regla = null;
    this.revisiones = new Map();
    this.siguienteReglaId = 31;
    this.siguienteRevisionId = 101;
    this.conexion = new ConexionReglasFalsa(this);
  }

  async obtenerConexion() {
    this.conexion.liberada = false;
    return this.conexion;
  }

  async consultar(sql, parametros = []) {
    const sentencia = normalizarSql(sql);
    if (sentencia.includes('FROM reglas_derivacion_telemetria r LEFT JOIN')) {
      if (!this.regla || this.regla.id !== Number(parametros[0])) {
        return [];
      }
      const revision = this.revisiones.get(this.regla.revision_vigente_id);
      return [crearFilaAgregada(this.regla, revision)];
    }
    if (
      sentencia.includes('FROM revisiones_reglas_derivacion_telemetria rv') &&
      sentencia.includes('WHERE rv.id = ?')
    ) {
      const revision = this.revisiones.get(Number(parametros[0]));
      return revision ? [crearFilaRevision(revision)] : [];
    }
    if (sentencia.includes('rv.vigente_desde_utc <= ?')) {
      return this.resolverConsultaTemporal(sentencia, parametros);
    }
    if (sentencia.includes('WHERE rv.regla_id = ?') && sentencia.includes('ORDER BY rv.numero DESC')) {
      return [...this.revisiones.values()]
        .filter((revision) => revision.regla_id === Number(parametros[0]))
        .sort((a, b) => b.numero - a.numero)
        .map(crearFilaRevision);
    }
    throw new Error(`Consulta falsa no contemplada: ${sentencia}`);
  }

  resolverConsultaTemporal(sentencia, parametros) {
    const esPorSenal = sentencia.includes('FROM reglas_derivacion_telemetria r INNER JOIN');
    const fecha = new Date(parametros[1]);
    const revision = [...this.revisiones.values()].find((candidata) =>
      (!esPorSenal || this.regla?.senal_id === Number(parametros[0])) &&
      (esPorSenal || candidata.regla_id === Number(parametros[0])) &&
      candidata.vigente_desde_utc <= fecha &&
      (candidata.vigente_hasta_utc === null || fecha < candidata.vigente_hasta_utc)
    );
    if (!revision) {
      return [];
    }
    return esPorSenal
      ? [crearFilaAgregada(this.regla, revision)]
      : [crearFilaRevision(revision)];
  }
}

class ConexionReglasFalsa {
  constructor(cliente) {
    this.cliente = cliente;
    this.commits = 0;
    this.rollbacks = 0;
    this.liberada = false;
  }

  async beginTransaction() {
    this.copia = structuredClone({
      regla: this.cliente.regla,
      revisiones: this.cliente.revisiones,
      siguienteReglaId: this.cliente.siguienteReglaId,
      siguienteRevisionId: this.cliente.siguienteRevisionId
    });
  }

  async commit() {
    this.commits += 1;
    this.copia = null;
  }

  async rollback() {
    this.rollbacks += 1;
    if (this.copia) {
      this.cliente.regla = this.copia.regla;
      this.cliente.revisiones = this.copia.revisiones;
      this.cliente.siguienteReglaId = this.copia.siguienteReglaId;
      this.cliente.siguienteRevisionId = this.copia.siguienteRevisionId;
    }
    this.copia = null;
  }

  release() {
    this.liberada = true;
  }

  async execute(sql, parametros = []) {
    const sentencia = normalizarSql(sql);
    if (sentencia.includes('FROM reglas_derivacion_telemetria r LEFT JOIN')) {
      return [await this.cliente.consultar(sql, parametros)];
    }
    if (
      sentencia.includes('FROM revisiones_reglas_derivacion_telemetria rv') &&
      sentencia.includes('WHERE rv.id = ?') &&
      !sentencia.includes('vigente_hasta_utc IS NULL')
    ) {
      return [await this.cliente.consultar(sql, parametros)];
    }
    if (sentencia.includes('FROM agentes_sentinelia a INNER JOIN')) {
      return [[{
        agente_id: 7,
        tenant_id: 1,
        empresa_id: 2,
        sitio_id: 3,
        senal_id: 23,
        senal_agente_id: 7,
        tipo_dato: 'numero',
        unidad: 'ºC'
      }]];
    }
    if (sentencia === 'SELECT UTC_TIMESTAMP(6) AS ahora_utc') {
      return [[{ ahora_utc: new Date(this.cliente.relojUtc) }]];
    }
    if (sentencia.startsWith('INSERT INTO reglas_derivacion_telemetria')) {
      const id = this.cliente.siguienteReglaId++;
      this.cliente.regla = {
        id,
        agente_id: parametros[0],
        senal_id: parametros[1],
        tenant_id: parametros[2],
        empresa_id: parametros[3],
        sitio_id: parametros[4],
        estado: parametros[5],
        revision_vigente_id: null,
        fecha_creacion: new Date(this.cliente.relojUtc),
        fecha_actualizacion: new Date(this.cliente.relojUtc)
      };
      return [{ insertId: id, affectedRows: 1 }];
    }
    if (sentencia.startsWith('INSERT INTO revisiones_reglas_derivacion_telemetria')) {
      const id = this.cliente.siguienteRevisionId++;
      this.cliente.revisiones.set(id, {
        id,
        regla_id: parametros[0],
        numero: parametros[1],
        condicion_tipo: parametros[2],
        condicion_version: parametros[3],
        condicion_canonica: parametros[4],
        severidad_calculada: parametros[5],
        mensaje_operativo: parametros[6],
        nombre: parametros[7],
        descripcion: parametros[8],
        metadatos_descriptivos: parametros[9],
        vigente_desde_utc: parametros[10],
        vigente_hasta_utc: parametros[11]
      });
      return [{ insertId: id, affectedRows: 1 }];
    }
    if (sentencia.includes('SET revision_vigente_id = ?')) {
      this.cliente.regla.revision_vigente_id = Number(parametros[0]);
      return [{ affectedRows: 1 }];
    }
    if (sentencia.includes('FROM reglas_derivacion_telemetria r INNER JOIN')) {
      return [[{
        ...crearFilaRegla(this.cliente.regla),
        tipo_dato: 'numero',
        unidad: 'ºC'
      }]];
    }
    if (
      sentencia.includes('FROM revisiones_reglas_derivacion_telemetria rv') &&
      sentencia.includes('vigente_hasta_utc IS NULL')
    ) {
      const revision = this.cliente.revisiones.get(Number(parametros[0]));
      return revision && revision.vigente_hasta_utc === null
        ? [[crearFilaRevision(revision)]]
        : [[]];
    }
    if (sentencia.includes('SET vigente_hasta_utc = ?')) {
      const revision = this.cliente.revisiones.get(Number(parametros[1]));
      if (!revision || revision.vigente_hasta_utc !== null) {
        return [{ affectedRows: 0 }];
      }
      revision.vigente_hasta_utc = parametros[0];
      return [{ affectedRows: 1 }];
    }
    throw new Error(`Ejecución falsa no contemplada: ${sentencia}`);
  }
}

function crearFilaAgregada(regla, revision) {
  return {
    ...crearFilaRegla(regla),
    ...crearFilaRevision(revision)
  };
}

function crearFilaRegla(regla) {
  return {
    regla_id: regla.id,
    regla_agente_id: regla.agente_id,
    regla_senal_id: regla.senal_id,
    regla_tenant_id: regla.tenant_id,
    regla_empresa_id: regla.empresa_id,
    regla_sitio_id: regla.sitio_id,
    regla_estado: regla.estado,
    regla_revision_vigente_id: regla.revision_vigente_id,
    regla_fecha_creacion: regla.fecha_creacion,
    regla_fecha_actualizacion: regla.fecha_actualizacion
  };
}

function crearFilaRevision(revision) {
  return {
    revision_id: revision.id,
    revision_regla_id: revision.regla_id,
    revision_numero: revision.numero,
    condicion_tipo: revision.condicion_tipo,
    condicion_version: revision.condicion_version,
    condicion_canonica: revision.condicion_canonica,
    severidad_calculada: revision.severidad_calculada,
    mensaje_operativo: revision.mensaje_operativo,
    revision_nombre: revision.nombre,
    revision_descripcion: revision.descripcion,
    metadatos_descriptivos: revision.metadatos_descriptivos,
    vigente_desde_utc: revision.vigente_desde_utc,
    vigente_hasta_utc: revision.vigente_hasta_utc
  };
}

function normalizarSql(sql) {
  return String(sql).replace(/\s+/g, ' ').trim();
}

main().catch((error) => {
  console.error('[agentes-telemetria] Error verificando persistencia 5.20a.4');
  console.error(error);
  process.exit(1);
});

function normalizarSqlConsolidado(contenido) {
  return contenido
    .replaceAll('`', '')
    .replace(/^CREATE TABLE /gm, 'CREATE TABLE IF NOT EXISTS ')
    .replace(/,(?!\s)/g, ', ')
    .replace(/\benum\(/g, 'ENUM(')
    .replace(/bigint\(20\) unsigned/g, 'BIGINT UNSIGNED');
}

function extraerDefinicionTabla(sql, tabla) {
  const inicio = sql.indexOf(`CREATE TABLE IF NOT EXISTS ${tabla}`);
  const fin = sql.indexOf(';', sql.indexOf('\n) ENGINE=', inicio));
  assert.notEqual(inicio, -1, `No se encontró la tabla ${tabla}.`);
  assert.notEqual(fin, -1, `No se encontró el final de la tabla ${tabla}.`);
  return sql.slice(inicio, fin + 1);
}

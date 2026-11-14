import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { readFile } from 'node:fs/promises';

import { FuenteEntropiaCriptograficaNode } from '../paquetes/federacion/adaptadores/FuenteEntropiaCriptograficaNode.js';
import { RepositorioInboxFederacionSql } from '../paquetes/federacion/adaptadores/RepositorioInboxFederacionSql.js';
import { TransporteLocalRecepcionFederacion } from '../paquetes/federacion/aplicacion/TransporteLocalRecepcionFederacion.js';
import { crearCampoPresenteFederado } from '../paquetes/federacion/src/EnvolventeFederacion.js';
import {
  GeneradorIdentidadesFederadas,
  TIPOS_IDENTIDAD_FEDERADA
} from '../paquetes/federacion/src/IdentidadFederada.js';
import { ClienteSql } from '../paquetes/persistencia-sql/src/ClienteSql.js';
import { EjecutorMigraciones } from '../paquetes/persistencia-sql/src/EjecutorMigraciones.js';
import { RepositorioMigraciones } from '../paquetes/persistencia-sql/src/RepositorioMigraciones.js';
import {
  obtenerConfiguracionAplicacion,
  obtenerRutaMigraciones
} from '../paquetes/utilidades/src/configuracion/obtenerConfiguracionAplicacion.js';

const generador = new GeneradorIdentidadesFederadas({
  fuenteEntropia: new FuenteEntropiaCriptograficaNode()
});

async function main() {
  await verificarRegistro();
  const configuracion = obtenerConfiguracionAplicacion();
  assert.equal(configuracion.sql.estaCompleta, true);
  const baseDatos = `sentinelia_fixture_52212g_${randomBytes(6).toString('hex')}`;
  const administrador = new ClienteSql(configuracion.sql);
  await administrador.ejecutar(`CREATE DATABASE ${administrador.escaparIdentificador(baseDatos)} CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
  const sql = new ClienteSql({ ...configuracion.sql, baseDatos });
  const ids = crearIdentidades();
  try {
    await new EjecutorMigraciones({
      clienteSql: sql,
      repositorioMigraciones: new RepositorioMigraciones(sql),
      rutaMigraciones: obtenerRutaMigraciones()
    }).ejecutarPendientes();
    await limpiar(sql, ids);
    await verificarIndices(sql);
    const auditoriaAntes = await contar(sql, 'outbox_auditoria_runtime');
    const outboxAntes = await contar(sql, 'outbox_federacion');
    await verificarConfirmacionPosteriorAlCommit(sql, ids);
    await limpiar(sql, ids);
    await verificarReplayConcurrente(sql, ids);
    await verificarReintentoDeadlock(sql, ids);
    await verificarDivergenciaDurable(sql, ids);
    await verificarSecuenciaConflictiva(sql, ids);
    await verificarRollbackSinConfirmacion(sql, ids);
    await verificarInmutabilidad(sql, ids);
    await verificarEntradaInvalida(sql, ids);
    assert.equal(await contar(sql, 'outbox_auditoria_runtime'), auditoriaAntes);
    assert.equal(await contar(sql, 'outbox_federacion'), outboxAntes);
  } finally {
    await limpiar(sql, ids);
    await sql.cerrar();
    await administrador.ejecutar(`DROP DATABASE IF EXISTS ${administrador.escaparIdentificador(baseDatos)}`).catch(() => {});
    await administrador.cerrar();
  }
  console.log(
    '[federacion] OK 5.22.12g: inbox=durable identidad=global ' +
    'replay=deduplicado deadlock=reintentado divergencia=persistida ' +
    'ack=postcommit transporte=local'
  );
}

async function verificarRegistro() {
  const [repositorio, transporte] = await Promise.all([
    leer('../paquetes/federacion/adaptadores/RepositorioInboxFederacionSql.js'),
    leer('../paquetes/federacion/aplicacion/TransporteLocalRecepcionFederacion.js')
  ]);
  assert.match(repositorio, /divergenciaContenido/u);
  assert.doesNotMatch(
    `${repositorio}\n${transporte}`,
    /(?:outbox_auditoria_runtime|outbox_federacion|redis|https?:|node:http)/iu
  );
}

async function verificarIndices(sql) {
  const filas = await sql.consultar(
    `SELECT index_name,seq_in_index,column_name
       FROM information_schema.statistics
      WHERE table_schema=DATABASE() AND table_name='inbox_ocurrencias_federacion'
        AND index_name IN (
          'uk_inbox_ocurrencias_identidad',
          'uk_inbox_ocurrencias_secuencia',
          'idx_inbox_ocurrencias_pendientes',
          'idx_inbox_ocurrencias_elemento'
        ) ORDER BY index_name,seq_in_index`
  );
  const columnas = (indice) => filas
    .filter((fila) => fila.index_name === indice)
    .map((fila) => fila.column_name);
  assert.deepEqual(columnas('uk_inbox_ocurrencias_identidad'), [
    'installation_origen_id', 'familia', 'elemento_origen_id',
    'ocurrencia_origen_id'
  ]);
  assert.deepEqual(columnas('uk_inbox_ocurrencias_secuencia'), [
    'installation_origen_id', 'familia', 'elemento_origen_id',
    'secuencia_elemento'
  ]);
  assert.deepEqual(columnas('idx_inbox_ocurrencias_pendientes'), [
    'estado_integridad', 'estado_procesamiento', 'recibida_en_utc', 'id'
  ]);
  assert.deepEqual(columnas('idx_inbox_ocurrencias_elemento'), [
    'installation_origen_id', 'familia', 'elemento_origen_id',
    'secuencia_elemento'
  ]);
}

async function verificarConfirmacionPosteriorAlCommit(sql, ids) {
  const orden = [];
  const repositorio = new RepositorioInboxFederacionSql(
    clienteSqlObservado(sql, orden)
  );
  const transporte = new TransporteLocalRecepcionFederacion({ repositorioInbox: repositorio });
  const respuesta = await transporte.entregar({ ocurrencia: ocurrencia(ids, 'original') });
  orden.push('respuesta');
  assert.deepEqual(orden, ['begin', 'commit', 'release', 'respuesta']);
  assert.deepEqual({
    codigo: respuesta.codigo,
    confirmada: respuesta.confirmada,
    persistida: respuesta.persistidaDurablemente,
    integridad: respuesta.estadoIntegridad
  }, {
    codigo: 'aceptada',
    confirmada: true,
    persistida: true,
    integridad: 'valida'
  });
  const filas = await sql.consultar(
    `SELECT COUNT(*) AS total FROM inbox_ocurrencias_federacion
      WHERE ocurrencia_origen_id=?`,
    [String(ids.ocurrenciaId)]
  );
  assert.equal(Number(filas[0].total), 1);
}

async function verificarReplayConcurrente(sql, ids) {
  const transporte = new TransporteLocalRecepcionFederacion({
    repositorioInbox: new RepositorioInboxFederacionSql(sql)
  });
  const resultados = await Promise.all([
    transporte.entregar({ ocurrencia: ocurrencia(ids, 'original') }),
    transporte.entregar({ ocurrencia: ocurrencia(ids, 'original') })
  ]);
  assert.deepEqual(
    resultados.map((resultado) => resultado.codigo).sort(),
    ['aceptada', 'yaConocida']
  );
  assert.ok(resultados.every((resultado) => resultado.confirmada));
  const filas = await sql.consultar(
    `SELECT estado_integridad,veces_observada,COUNT(*) OVER () AS total
       FROM inbox_ocurrencias_federacion WHERE ocurrencia_origen_id=?`,
    [String(ids.ocurrenciaId)]
  );
  assert.equal(filas[0].estado_integridad, 'valida');
  assert.equal(String(filas[0].veces_observada), '2');
  assert.equal(Number(filas[0].total), 1);
}

async function verificarReintentoDeadlock(sql, ids) {
  let inyectado = false;
  const cliente = {
    async obtenerConexion() {
      const real = await sql.obtenerConexion();
      return {
        query: real.query.bind(real),
        beginTransaction: real.beginTransaction.bind(real),
        commit: real.commit.bind(real),
        rollback: real.rollback.bind(real),
        release: real.release.bind(real),
        async execute(sentencia, parametros) {
          if (!inyectado && sentencia.includes('INSERT INTO inbox_ocurrencias_federacion')) {
            inyectado = true;
            const error = new Error('Deadlock fixture reintentable.');
            error.code = 'ER_LOCK_DEADLOCK';
            error.sqlState = '40001';
            throw error;
          }
          return real.execute(sentencia, parametros);
        }
      };
    }
  };
  const repositorio = new RepositorioInboxFederacionSql(cliente);
  const resultado = await repositorio.recibir(ocurrencia(
    ids,
    'deadlock-recuperado',
    ids.ocurrenciaDeadlockId,
    ids.elementoDeadlockId,
    '1'
  ));
  assert.equal(inyectado, true);
  assert.equal(resultado.codigo, 'aceptada');
  const filas = await sql.consultar(
    `SELECT COUNT(*) AS total FROM inbox_ocurrencias_federacion
      WHERE ocurrencia_origen_id=?`,
    [String(ids.ocurrenciaDeadlockId)]
  );
  assert.equal(Number(filas[0].total), 1);
}

async function verificarDivergenciaDurable(sql, ids) {
  const transporte = new TransporteLocalRecepcionFederacion({
    repositorioInbox: new RepositorioInboxFederacionSql(sql)
  });
  const primera = await transporte.entregar({
    ocurrencia: ocurrencia(ids, 'contenido-incompatible')
  });
  assert.deepEqual({
    codigo: primera.codigo,
    confirmada: primera.confirmada,
    persistida: primera.persistidaDurablemente,
    integridad: primera.estadoIntegridad
  }, {
    codigo: 'divergenciaContenido',
    confirmada: false,
    persistida: true,
    integridad: 'conflictiva'
  });
  let variantes = await sql.consultar(
    `SELECT c.veces_observado,c.payload_observado_canonico
       FROM conflictos_contenido_inbox_federacion c
       JOIN inbox_ocurrencias_federacion i ON i.id=c.inbox_ocurrencia_id
      WHERE i.ocurrencia_origen_id=?`,
    [String(ids.ocurrenciaId)]
  );
  assert.equal(variantes.length, 1);
  assert.match(variantes[0].payload_observado_canonico, /contenido-incompatible/u);
  assert.equal(String(variantes[0].veces_observado), '1');

  const repetida = await transporte.entregar({
    ocurrencia: ocurrencia(ids, 'contenido-incompatible')
  });
  assert.equal(repetida.codigo, 'divergenciaContenido');
  assert.equal(repetida.confirmada, false);
  variantes = await sql.consultar(
    `SELECT c.veces_observado
       FROM conflictos_contenido_inbox_federacion c
       JOIN inbox_ocurrencias_federacion i ON i.id=c.inbox_ocurrencia_id
      WHERE i.ocurrencia_origen_id=?`,
    [String(ids.ocurrenciaId)]
  );
  assert.equal(variantes.length, 1);
  assert.equal(String(variantes[0].veces_observado), '2');

  const original = await transporte.entregar({ ocurrencia: ocurrencia(ids, 'original') });
  assert.equal(original.codigo, 'yaConocida');
  assert.equal(original.confirmada, true);
  assert.equal(original.estadoIntegridad, 'conflictiva');
}

async function verificarRollbackSinConfirmacion(sql, ids) {
  const repositorio = new RepositorioInboxFederacionSql(sql);
  const conexion = await sql.obtenerConexion();
  try {
    await conexion.beginTransaction();
    const resultado = await repositorio.recibirEnTransaccion(
      ocurrencia(
        ids,
        'rollback',
        ids.ocurrenciaRollbackId,
        ids.elementoOrigenId,
        '8'
      ),
      { conexion }
    );
    assert.equal(resultado.codigo, 'aceptada');
    assert.equal(resultado.confirmable, true);
    assert.equal(resultado.confirmada, false);
    assert.equal(resultado.persistidaDurablemente, false);
  } finally {
    await conexion.rollback();
    conexion.release();
  }
  const filas = await sql.consultar(
    'SELECT COUNT(*) AS total FROM inbox_ocurrencias_federacion WHERE ocurrencia_origen_id=?',
    [String(ids.ocurrenciaRollbackId)]
  );
  assert.equal(Number(filas[0].total), 0);
}

async function verificarSecuenciaConflictiva(sql, ids) {
  const transporte = new TransporteLocalRecepcionFederacion({
    repositorioInbox: new RepositorioInboxFederacionSql(sql)
  });
  const base = ocurrencia(
    ids,
    'secuencia-original',
    ids.ocurrenciaSecuenciaPrimeraId,
    ids.elementoSecuenciaId
  );
  const aceptada = await transporte.entregar({ ocurrencia: base });
  assert.equal(aceptada.codigo, 'aceptada');
  const conflictiva = await transporte.entregar({
    ocurrencia: ocurrencia(
      ids,
      'secuencia-reutilizada',
      ids.ocurrenciaSecuenciaSegundaId,
      ids.elementoSecuenciaId
    )
  });
  assert.equal(conflictiva.codigo, 'divergenciaContenido');
  assert.equal(conflictiva.confirmada, false);
  assert.equal(
    conflictiva.identidad.ocurrenciaOrigenId,
    String(ids.ocurrenciaSecuenciaSegundaId)
  );
  const [inbox, conflictos] = await Promise.all([
    sql.consultar(
      `SELECT estado_integridad,veces_observada,COUNT(*) OVER () AS total
         FROM inbox_ocurrencias_federacion
        WHERE elemento_origen_id=?`,
      [String(ids.elementoSecuenciaId)]
    ),
    sql.consultar(
      `SELECT COUNT(*) AS total
         FROM conflictos_contenido_inbox_federacion c
         JOIN inbox_ocurrencias_federacion i ON i.id=c.inbox_ocurrencia_id
        WHERE i.elemento_origen_id=?`,
      [String(ids.elementoSecuenciaId)]
    )
  ]);
  assert.equal(inbox.length, 1);
  assert.equal(inbox[0].estado_integridad, 'conflictiva');
  assert.equal(String(inbox[0].veces_observada), '1');
  assert.equal(Number(inbox[0].total), 1);
  assert.equal(Number(conflictos[0].total), 1);
}

async function verificarInmutabilidad(sql, ids) {
  const filas = await sql.consultar(
    'SELECT id FROM inbox_ocurrencias_federacion WHERE ocurrencia_origen_id=?',
    [String(ids.ocurrenciaId)]
  );
  await assert.rejects(
    sql.ejecutar(
      `UPDATE inbox_ocurrencias_federacion
          SET payload_canonico='{}' WHERE id=?`,
      [filas[0].id]
    ),
    (error) => error.sqlState === '45000'
  );
  const conflictos = await sql.consultar(
    `SELECT c.id FROM conflictos_contenido_inbox_federacion c
      JOIN inbox_ocurrencias_federacion i ON i.id=c.inbox_ocurrencia_id
     WHERE i.ocurrencia_origen_id=?`,
    [String(ids.ocurrenciaId)]
  );
  await assert.rejects(
    sql.ejecutar(
      `UPDATE conflictos_contenido_inbox_federacion
          SET payload_observado_canonico='{}' WHERE id=?`,
      [conflictos[0].id]
    ),
    (error) => error.sqlState === '45000'
  );
}

async function verificarEntradaInvalida(sql, ids) {
  const transporte = new TransporteLocalRecepcionFederacion({
    repositorioInbox: new RepositorioInboxFederacionSql(sql)
  });
  await assert.rejects(
    transporte.entregar({
      ocurrencia: {
        ...ocurrencia(ids, 'invalida', ids.ocurrenciaInvalidaId),
        secuenciaElemento: '0'
      }
    })
  );
  const filas = await sql.consultar(
    'SELECT COUNT(*) AS total FROM inbox_ocurrencias_federacion WHERE ocurrencia_origen_id=?',
    [String(ids.ocurrenciaInvalidaId)]
  );
  assert.equal(Number(filas[0].total), 0);
}

function ocurrencia(
  ids,
  estado,
  ocurrenciaId = ids.ocurrenciaId,
  elementoOrigenId = ids.elementoOrigenId,
  secuenciaElemento = '7'
) {
  return {
    familia: 'monitores',
    familiaVersion: 1,
    installationOrigenId: ids.installationOrigenId,
    elementoOrigenId,
    ocurrenciaOrigenId: ocurrenciaId,
    secuenciaElemento,
    operacion: 'actualizacion',
    tiempoOrigenUtc: '2030-01-01T00:00:00.000Z',
    scopeOrigenDeclarado: {
      nivel: 'portal',
      tenantId: null,
      empresaId: null,
      sitioId: null
    },
    vigenciaRestanteMs: '300000',
    campos: {
      estadoOperativo: crearCampoPresenteFederado({
        valor: { estado, contexto: 'inbox fixture 5.22.12g' }
      })
    },
    evidenciaIntegridad: []
  };
}

function clienteSqlObservado(sql, orden) {
  return {
    async obtenerConexion() {
      const real = await sql.obtenerConexion();
      return {
        execute: real.execute.bind(real),
        query: real.query.bind(real),
        async beginTransaction() {
          orden.push('begin');
          return real.beginTransaction();
        },
        async commit() {
          orden.push('commit');
          return real.commit();
        },
        async rollback() {
          orden.push('rollback');
          return real.rollback();
        },
        release() {
          orden.push('release');
          real.release();
        }
      };
    }
  };
}

async function limpiar(sql, ids) {
  await sql.ejecutar(
    `DELETE c FROM conflictos_contenido_inbox_federacion c
      JOIN inbox_ocurrencias_federacion i ON i.id=c.inbox_ocurrencia_id
     WHERE i.installation_origen_id=?`,
    [String(ids.installationOrigenId)]
  ).catch(() => {});
  await sql.ejecutar(
    'DELETE FROM inbox_ocurrencias_federacion WHERE installation_origen_id=?',
    [String(ids.installationOrigenId)]
  ).catch(() => {});
}

async function contar(sql, tabla) {
  const filas = await sql.consultar(`SELECT COUNT(*) AS total FROM ${tabla}`);
  return Number(filas[0].total);
}

function crearIdentidades() {
  const generar = (tipo) => generador.generar(tipo);
  return {
    installationOrigenId: generar(TIPOS_IDENTIDAD_FEDERADA.INSTALACION),
    elementoOrigenId: generar(TIPOS_IDENTIDAD_FEDERADA.ELEMENTO_ORIGEN),
    ocurrenciaId: generar(TIPOS_IDENTIDAD_FEDERADA.OCURRENCIA_ORIGEN),
    ocurrenciaRollbackId: generar(TIPOS_IDENTIDAD_FEDERADA.OCURRENCIA_ORIGEN),
    ocurrenciaInvalidaId: generar(TIPOS_IDENTIDAD_FEDERADA.OCURRENCIA_ORIGEN),
    elementoDeadlockId: generar(TIPOS_IDENTIDAD_FEDERADA.ELEMENTO_ORIGEN),
    ocurrenciaDeadlockId: generar(TIPOS_IDENTIDAD_FEDERADA.OCURRENCIA_ORIGEN),
    elementoSecuenciaId: generar(TIPOS_IDENTIDAD_FEDERADA.ELEMENTO_ORIGEN),
    ocurrenciaSecuenciaPrimeraId: generar(TIPOS_IDENTIDAD_FEDERADA.OCURRENCIA_ORIGEN),
    ocurrenciaSecuenciaSegundaId: generar(TIPOS_IDENTIDAD_FEDERADA.OCURRENCIA_ORIGEN)
  };
}

function leer(ruta) {
  return readFile(new URL(ruta, import.meta.url), 'utf8');
}

await main();

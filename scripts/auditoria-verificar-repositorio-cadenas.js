import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import {
  ConflictoIdempotenciaAuditoria,
  RepositorioAuditoria
} from '../paquetes/auditoria/src/RepositorioAuditoria.js';
import {
  PERFIL_JCS_AUDITORIA_V1
} from '../paquetes/auditoria/src/PerfilJcsAuditoria.js';
import {
  VERSION_ENCADENADO_AUDITORIA_V1
} from '../paquetes/auditoria/src/SobreCanonicoAuditoria.js';
import {
  generarUuidV7Auditoria,
  uuidV7AuditoriaABytes
} from '../paquetes/auditoria/src/UuidV7Auditoria.js';
import { ClienteSql } from '../paquetes/persistencia-sql/src/ClienteSql.js';
import { EjecutorMigraciones } from '../paquetes/persistencia-sql/src/EjecutorMigraciones.js';
import { RepositorioMigraciones } from '../paquetes/persistencia-sql/src/RepositorioMigraciones.js';
import {
  obtenerConfiguracionAplicacion,
  obtenerRutaMigraciones
} from '../paquetes/utilidades/src/configuracion/obtenerConfiguracionAplicacion.js';

const baseTenant = BigInt(Date.now()) * 100n;
const tenants = Array.from({ length: 8 }, (_, indice) =>
  String(baseTenant + BigInt(indice + 1))
);
const clavesPrueba = new Set();

async function main() {
  const configuracion = obtenerConfiguracionAplicacion();
  assert.equal(configuracion.sql.estaCompleta, true, 'La verificación 5.21.4b requiere SQL local.');
  const clienteSql = new ClienteSql(configuracion.sql);
  const repositorio = new RepositorioAuditoria(clienteSql, { maxReintentos: 10 });
  let errorPrincipal = null;
  try {
    await asegurarMigraciones(clienteSql);
    await verificarGenesisConcurrenciaEIdempotencia(clienteSql, repositorio);
    await verificarMovimientos(repositorio);
    await verificarParalelismoEntreCadenas(clienteSql, repositorio);
    await verificarSerializacionMismaCadena(clienteSql, repositorio);
    await verificarReintentoConMismaGenesis(clienteSql);
    await verificarReintentoConMismaGenesis(clienteSql, 'ER_CHECKREAD', String(baseTenant + 99n));
    await verificarOrdenDeBloqueos(clienteSql, repositorio);
    await verificarProhibicionesEstructurales();
  } catch (error) {
    errorPrincipal = error;
  } finally {
    try {
      await limpiarPruebas(clienteSql);
    } catch (errorLimpieza) {
      if (!errorPrincipal) throw errorLimpieza;
      console.error('[auditoria] Error adicional limpiando los datos de prueba');
      console.error(errorLimpieza);
    }
    await clienteSql.cerrar();
  }
  if (errorPrincipal) throw errorPrincipal;
  console.log('[auditoria] OK 5.21.4b: genesis=1 idempotencia=estable secuencias=sin_duplicados movimientos=atomicos paralelismo=entre_cadenas');
}

async function asegurarMigraciones(clienteSql) {
  const ejecutor = new EjecutorMigraciones({
    clienteSql,
    repositorioMigraciones: new RepositorioMigraciones(clienteSql),
    rutaMigraciones: obtenerRutaMigraciones()
  });
  await ejecutor.ejecutarPendientes();
}

async function verificarGenesisConcurrenciaEIdempotencia(clienteSql, repositorio) {
  const tenantId = tenants[0];
  const claveCadena = registrarClave(`monitores:tenant:${tenantId}`);
  const intenciones = Array.from({ length: 8 }, (_, indice) =>
    crearAltaMonitor({
      tenantId,
      claveOperacion: generarUuidV7Auditoria(),
      sujetoId: String(900_000 + indice)
    })
  );
  const ejecuciones = await Promise.allSettled(
    intenciones.map((intencion) => repositorio.incorporarAtomico([intencion]))
  );
  const fallida = ejecuciones.find(({ status }) => status === 'rejected');
  if (fallida) throw fallida.reason;
  const resultados = ejecuciones.map(({ value }) => value);
  const secuencias = resultados
    .map((resultado) => Number(resultado.eventos[0].secuencia))
    .sort((a, b) => a - b);
  assert.deepEqual(secuencias, [2, 3, 4, 5, 6, 7, 8, 9]);
  assert.equal(resultados.flatMap((resultado) => resultado.genesis).filter(({ estado }) => estado === 'incorporado').length, 1);

  const filas = await clienteSql.consultar(
    `
      SELECT tipo_evento, CAST(secuencia AS CHAR) AS secuencia
      FROM eventos_auditoria
      WHERE clave_cadena = ?
      ORDER BY secuencia
    `,
    [claveCadena]
  );
  assert.equal(filas.length, 9);
  assert.equal(filas[0].tipo_evento, 'cadena.iniciada');
  assert.equal(filas[0].secuencia, '1');
  assert.equal(new Set(filas.map(({ secuencia }) => secuencia)).size, 9);

  const repeticion = await repositorio.incorporarAtomico([intenciones[0]]);
  assert.equal(repeticion.eventos[0].estado, 'existente');
  assert.equal(
    repeticion.eventos[0].secuencia,
    resultados[0].eventos[0].secuencia
  );
  assert.equal(repeticion.registradoEnUtc, null);

  await assert.rejects(
    () => repositorio.incorporarAtomico([{
      ...intenciones[0],
      sujeto: { tipo: 'monitor', id: '999999' },
      payload: {
        ...intenciones[0].payload,
        despues: { ...intenciones[0].payload.despues, nombre: 'Otra intención' }
      }
    }]),
    ConflictoIdempotenciaAuditoria
  );

  await assert.rejects(
    () => repositorio.incorporarAtomico([crearAltaMonitor({
      tenantId,
      eventoId: intenciones[0].eventoId,
      claveOperacion: generarUuidV7Auditoria(),
      sujetoId: '999998'
    })]),
    ConflictoIdempotenciaAuditoria
  );

  const huellaEsperada = createHash('sha256')
    .update(Buffer.from('sentinelia-auditoria-evento-id-v1', 'utf8'))
    .update(Buffer.from([0]))
    .update(uuidV7AuditoriaABytes(intenciones[0].eventoId))
    .digest('hex');
  const tombstone = await clienteSql.consultar(
    'SELECT HEX(huella_evento_id) AS huella FROM tombstones_identidad_auditoria WHERE huella_evento_id = UNHEX(?)',
    [huellaEsperada]
  );
  assert.equal(tombstone[0]?.huella.toLowerCase(), huellaEsperada);

  const conexion = await clienteSql.obtenerConexion();
  try {
    await conexion.beginTransaction();
    await conexion.execute(
      `
        UPDATE identidades_idempotentes_auditoria
        SET estado = 'retenido', retenido_en_utc = UTC_TIMESTAMP(3)
        WHERE productor = ? AND clave_operacion = ? AND rol_evento = ?
      `,
      [
        intenciones[0].productor,
        Buffer.from(intenciones[0].claveOperacion, 'ascii'),
        intenciones[0].rolEvento
      ]
    );
    await conexion.execute(
      'DELETE FROM eventos_auditoria WHERE evento_id = ?',
      [uuidV7AuditoriaABytes(intenciones[0].eventoId)]
    );
    const retenido = await repositorio.incorporarEnTransaccion(
      [intenciones[0]],
      { conexion }
    );
    assert.equal(retenido.eventos[0].estado, 'retenido');
    assert.equal(retenido.eventos[0].eventoId, intenciones[0].eventoId);
    assert.equal(retenido.eventos[0].secuencia, null);
    await conexion.rollback();

    await conexion.beginTransaction();
    await conexion.execute(
      'DELETE FROM identidades_idempotentes_auditoria WHERE evento_id = ?',
      [uuidV7AuditoriaABytes(intenciones[0].eventoId)]
    );
    await conexion.execute(
      'DELETE FROM eventos_auditoria WHERE evento_id = ?',
      [uuidV7AuditoriaABytes(intenciones[0].eventoId)]
    );
    await assert.rejects(
      () => repositorio.incorporarEnTransaccion([crearAltaMonitor({
        tenantId,
        eventoId: intenciones[0].eventoId,
        claveOperacion: generarUuidV7Auditoria(),
        sujetoId: '999997'
      })], { conexion }),
      ConflictoIdempotenciaAuditoria
    );
    await conexion.rollback();
  } finally {
    await rollbackSeguro(conexion);
    conexion.release();
  }
}

async function verificarMovimientos(repositorio) {
  const tenantOrigen = tenants[0];
  const claveOrigen = registrarClave(`monitores:tenant:${tenantOrigen}`);
  const mismo = crearMovimiento({
    tenantOrigen,
    empresaOrigen: '81',
    sitioOrigen: null,
    tenantDestino: tenantOrigen,
    empresaDestino: '82',
    sitioDestino: null,
    sujetoId: '900000'
  });
  const resultadoMismo = await repositorio.incorporarAtomico(mismo);
  assert.equal(resultadoMismo.eventos[0].claveCadena, claveOrigen);
  assert.equal(resultadoMismo.eventos[1].claveCadena, claveOrigen);
  assert.equal(
    Number(resultadoMismo.eventos[1].secuencia),
    Number(resultadoMismo.eventos[0].secuencia) + 1
  );
  assert.equal(resultadoMismo.eventos[0].estado, 'incorporado');
  assert.equal(resultadoMismo.eventos[1].estado, 'incorporado');

  const contraparte = await repositorio.clienteSql.consultar(
    `
      SELECT HEX(evento_contraparte_id) AS contraparte
      FROM eventos_auditoria
      WHERE evento_id = ?
    `,
    [uuidV7AuditoriaABytes(mismo[0].eventoId)]
  );
  assert.equal(
    contraparte[0].contraparte.toLowerCase(),
    uuidV7AuditoriaABytes(mismo[1].eventoId).toString('hex')
  );

  const repeticion = await repositorio.incorporarAtomico(mismo);
  assert.deepEqual(
    repeticion.eventos.map(({ estado }) => estado),
    ['existente', 'existente']
  );

  const tenantDestino = tenants[1];
  const claveDestino = registrarClave(`monitores:tenant:${tenantDestino}`);
  const distinto = crearMovimiento({
    tenantOrigen,
    empresaOrigen: '82',
    sitioOrigen: null,
    tenantDestino,
    empresaDestino: '91',
    sitioDestino: null,
    sujetoId: '900000'
  });
  const resultadoDistinto = await repositorio.incorporarAtomico(distinto);
  assert.deepEqual(
    resultadoDistinto.eventos.map(({ claveCadena }) => claveCadena),
    [claveOrigen, claveDestino]
  );
  assert.equal(resultadoDistinto.genesis.length, 1);
  assert.equal(resultadoDistinto.genesis[0].claveCadena, claveDestino);
  assert.equal(resultadoDistinto.genesis[0].secuencia, '1');
  assert.equal(resultadoDistinto.eventos[1].secuencia, '2');
}

async function verificarParalelismoEntreCadenas(clienteSql, repositorio) {
  const tenantA = tenants[2];
  const tenantB = tenants[3];
  await repositorio.incorporarAtomico([crearAltaMonitor({
    tenantId: tenantA,
    claveOperacion: generarUuidV7Auditoria(),
    sujetoId: '910001'
  })]);
  await repositorio.incorporarAtomico([crearAltaMonitor({
    tenantId: tenantB,
    claveOperacion: generarUuidV7Auditoria(),
    sujetoId: '910002'
  })]);
  registrarClave(`monitores:tenant:${tenantA}`);
  registrarClave(`monitores:tenant:${tenantB}`);

  const conexionA = await clienteSql.obtenerConexion();
  const conexionB = await clienteSql.obtenerConexion();
  try {
    await conexionA.beginTransaction();
    await conexionB.beginTransaction();
    await repositorio.incorporarEnTransaccion([crearAltaMonitor({
      tenantId: tenantA,
      claveOperacion: generarUuidV7Auditoria(),
      sujetoId: '910003'
    })], { conexion: conexionA });
    const operacionB = repositorio.incorporarEnTransaccion([crearAltaMonitor({
      tenantId: tenantB,
      claveOperacion: generarUuidV7Auditoria(),
      sujetoId: '910004'
    })], { conexion: conexionB });
    const resultado = await Promise.race([
      operacionB.then(() => 'completada'),
      esperar(750).then(() => 'bloqueada')
    ]);
    assert.equal(resultado, 'completada', 'Una cadena independiente quedó serializada por otra.');
    await conexionA.rollback();
    await conexionB.rollback();
  } finally {
    await rollbackSeguro(conexionA);
    await rollbackSeguro(conexionB);
    conexionA.release();
    conexionB.release();
  }
}

async function verificarSerializacionMismaCadena(clienteSql, repositorio) {
  const tenantId = tenants[4];
  registrarClave(`monitores:tenant:${tenantId}`);
  await repositorio.incorporarAtomico([crearAltaMonitor({
    tenantId,
    claveOperacion: generarUuidV7Auditoria(),
    sujetoId: '920001'
  })]);
  const conexionA = await clienteSql.obtenerConexion();
  const conexionB = await clienteSql.obtenerConexion();
  try {
    await conexionA.beginTransaction();
    await conexionB.beginTransaction();
    await repositorio.incorporarEnTransaccion([crearAltaMonitor({
      tenantId,
      claveOperacion: generarUuidV7Auditoria(),
      sujetoId: '920002'
    })], { conexion: conexionA });
    let finalizada = false;
    const operacionB = repositorio.incorporarEnTransaccion([crearAltaMonitor({
      tenantId,
      claveOperacion: generarUuidV7Auditoria(),
      sujetoId: '920003'
    })], { conexion: conexionB }).then((resultado) => {
      finalizada = true;
      return resultado;
    });
    await esperar(150);
    assert.equal(finalizada, false, 'Dos escritores avanzaron simultáneamente la misma cabecera.');
    await conexionA.rollback();
    const resultadoB = await operacionB;
    assert.equal(resultadoB.eventos[0].secuencia, '3');
    await conexionB.rollback();
  } finally {
    await rollbackSeguro(conexionA);
    await rollbackSeguro(conexionB);
    conexionA.release();
    conexionB.release();
  }
}

async function verificarOrdenDeBloqueos(clienteSql, repositorio) {
  const tenantId = tenants[5];
  registrarClave(`monitores:tenant:${tenantId}`);
  const conexion = await clienteSql.obtenerConexion();
  const executeOriginal = conexion.execute.bind(conexion);
  const traza = [];
  conexion.execute = async (sql, parametros = []) => {
    traza.push({ sql: String(sql).replace(/\s+/g, ' ').trim(), parametros });
    return executeOriginal(sql, parametros);
  };
  try {
    await conexion.beginTransaction();
    await repositorio.incorporarEnTransaccion([crearAltaMonitor({
      tenantId,
      claveOperacion: generarUuidV7Auditoria(),
      sujetoId: '930001'
    })], { conexion });
    const reservas = traza
      .map((entrada, indice) => ({ ...entrada, indice }))
      .filter(({ sql }) => sql.startsWith('INSERT IGNORE INTO identidades_idempotentes_auditoria'));
    const primerBloqueoCabecera = traza.findIndex(({ sql }) =>
      sql.includes('FROM cadenas_auditoria') && sql.includes('FOR UPDATE')
    );
    assert.ok(reservas.length >= 2, 'La cadena nueva no reservó negocio y génesis.');
    assert.ok(reservas.every(({ indice }) => indice < primerBloqueoCabecera));
    const tuplas = reservas.map(({ parametros }) => [
      parametros[0], Buffer.from(parametros[1]).toString('ascii'), parametros[2]
    ]);
    assert.deepEqual(tuplas, [...tuplas].sort(compararTuplaBinaria));
    await conexion.rollback();
  } finally {
    await rollbackSeguro(conexion);
    conexion.execute = executeOriginal;
    conexion.release();
  }
}

async function verificarReintentoConMismaGenesis(clienteSql, codigo = 'ER_LOCK_DEADLOCK', tenantId = tenants[6]) {
  registrarClave(`monitores:tenant:${tenantId}`);
  let falloInyectado = false;
  const idsGenesis = [];
  const clienteInstrumentado = {
    async obtenerConexion() {
      const conexion = await clienteSql.obtenerConexion();
      const executeOriginal = conexion.execute.bind(conexion);
      conexion.execute = async (sql, parametros = []) => {
        const normalizada = String(sql).replace(/\s+/g, ' ').trim();
        if (
          normalizada.startsWith('INSERT IGNORE INTO identidades_idempotentes_auditoria') &&
          parametros[0] === 'auditoria_nucleo'
        ) {
          idsGenesis.push(Buffer.from(parametros[4]).toString('hex'));
        }
        if (
          !falloInyectado &&
          normalizada.includes('FROM cadenas_auditoria') &&
          normalizada.includes('FOR UPDATE')
        ) {
          falloInyectado = true;
          const error = new Error('deadlock inyectado');
          error.code = codigo;
          throw error;
        }
        return executeOriginal(sql, parametros);
      };
      return conexion;
    }
  };
  const repositorio = new RepositorioAuditoria(clienteInstrumentado, {
    maxReintentos: 1
  });
  const resultado = await repositorio.incorporarAtomico([crearAltaMonitor({
    tenantId,
    claveOperacion: generarUuidV7Auditoria(),
    sujetoId: '940001'
  })]);
  assert.equal(resultado.reintentos, 1);
  assert.equal(idsGenesis.length, 2);
  assert.equal(idsGenesis[0], idsGenesis[1], 'El reintento generó otra identidad global para la génesis.');
}

async function verificarProhibicionesEstructurales() {
  const fuente = await readFile(
    new URL('../paquetes/auditoria/src/RepositorioAuditoria.js', import.meta.url),
    'utf8'
  );
  assert.match(fuente, /SELECT[\s\S]*FOR UPDATE/);
  assert.doesNotMatch(fuente, /MAX\s*\(\s*secuencia\s*\)\s*\+\s*1/i);
  assert.doesNotMatch(fuente, /redis/i);
}

function crearAltaMonitor({
  tenantId,
  eventoId = generarUuidV7Auditoria(),
  claveOperacion,
  sujetoId
}) {
  return {
    eventoId,
    tipo: 'monitor.creado',
    versionContrato: 1,
    flujo: 'monitores',
    claveCadena: `monitores:tenant:${tenantId}`,
    actorReal: { tipo: 'usuario', id: '1' },
    actorEfectivo: null,
    modoActuacion: 'directo',
    sujeto: { tipo: 'monitor', id: sujetoId },
    origen: 'web',
    scope: { tenantId, empresaId: null, sitioId: null },
    correlacionId: generarUuidV7Auditoria(),
    causalidad: null,
    productor: 'portal_web',
    claveOperacion,
    rolEvento: 'principal',
    efectivoEnUtc: new Date().toISOString(),
    versionCanonicalizador: PERFIL_JCS_AUDITORIA_V1,
    versionEncadenado: VERSION_ENCADENADO_AUDITORIA_V1,
    payload: {
      resultado: 'creado',
      antes: null,
      despues: { nombre: `Monitor ${sujetoId}`, tipo: 'ping', activo: true }
    }
  };
}

function crearMovimiento({
  tenantOrigen,
  empresaOrigen,
  sitioOrigen,
  tenantDestino,
  empresaDestino,
  sitioDestino,
  sujetoId
}) {
  const salidaId = generarUuidV7Auditoria();
  const entradaId = generarUuidV7Auditoria();
  const correlacionId = generarUuidV7Auditoria();
  const claveOperacion = generarUuidV7Auditoria();
  const efectivoEnUtc = new Date().toISOString();
  const comun = {
    versionContrato: 1,
    flujo: 'monitores',
    actorReal: { tipo: 'usuario', id: '1' },
    actorEfectivo: null,
    modoActuacion: 'directo',
    sujeto: { tipo: 'monitor', id: sujetoId },
    origen: 'web',
    correlacionId,
    causalidad: null,
    productor: 'portal_web',
    claveOperacion,
    efectivoEnUtc,
    versionCanonicalizador: PERFIL_JCS_AUDITORIA_V1,
    versionEncadenado: VERSION_ENCADENADO_AUDITORIA_V1
  };
  return [
    {
      ...comun,
      eventoId: salidaId,
      tipo: 'scope.entidad_salida',
      claveCadena: `monitores:tenant:${tenantOrigen}`,
      scope: { tenantId: tenantOrigen, empresaId: empresaOrigen, sitioId: sitioOrigen },
      rolEvento: 'salida',
      payload: {
        direccion: 'salida',
        scopePropio: { tenantId: tenantOrigen, empresaId: empresaOrigen, sitioId: sitioOrigen },
        eventoContraparteId: entradaId,
        impactoResumen: null
      }
    },
    {
      ...comun,
      eventoId: entradaId,
      tipo: 'scope.entidad_entrada',
      claveCadena: `monitores:tenant:${tenantDestino}`,
      scope: { tenantId: tenantDestino, empresaId: empresaDestino, sitioId: sitioDestino },
      rolEvento: 'entrada',
      payload: {
        direccion: 'entrada',
        scopePropio: { tenantId: tenantDestino, empresaId: empresaDestino, sitioId: sitioDestino },
        eventoContraparteId: salidaId,
        impactoResumen: null
      }
    }
  ];
}

async function limpiarPruebas(clienteSql) {
  if (clavesPrueba.size === 0) return;
  const claves = [...clavesPrueba];
  const conexion = await clienteSql.obtenerConexion();
  try {
    await conexion.beginTransaction();
    const [eventos] = await conexion.execute(
      `SELECT evento_id FROM eventos_auditoria WHERE clave_cadena IN (${claves.map(() => '?').join(', ')})`,
      claves
    );
    if (eventos.length > 0) {
      const ids = eventos.map(({ evento_id }) => evento_id);
      const marcadores = ids.map(() => '?').join(', ');
      await conexion.execute(`DELETE FROM identidades_idempotentes_auditoria WHERE evento_id IN (${marcadores})`, ids);
      await conexion.execute(`DELETE FROM eventos_auditoria WHERE evento_id IN (${marcadores})`, ids);
      for (const eventoId of ids) {
        const huella = createHash('sha256')
          .update(Buffer.from('sentinelia-auditoria-evento-id-v1', 'utf8'))
          .update(Buffer.from([0]))
          .update(eventoId)
          .digest();
        await conexion.execute('DELETE FROM tombstones_identidad_auditoria WHERE huella_evento_id = ?', [huella]);
      }
    }
    await conexion.execute(
      `DELETE FROM cadenas_auditoria WHERE clave_cadena IN (${claves.map(() => '?').join(', ')})`,
      claves
    );
    await conexion.commit();
  } catch (error) {
    await conexion.rollback();
    throw error;
  } finally {
    conexion.release();
  }
}

function compararTuplaBinaria(a, b) {
  for (let indice = 0; indice < 3; indice += 1) {
    const comparacion = Buffer.compare(
      Buffer.from(a[indice], 'ascii'),
      Buffer.from(b[indice], 'ascii')
    );
    if (comparacion !== 0) return comparacion;
  }
  return 0;
}

function registrarClave(clave) {
  clavesPrueba.add(clave);
  return clave;
}

function esperar(ms) {
  return new Promise((resolver) => setTimeout(resolver, ms));
}

async function rollbackSeguro(conexion) {
  try {
    await conexion.rollback();
  } catch {
    // La prueba principal conserva la autoridad diagnóstica.
  }
}

main().catch((error) => {
  console.error('[auditoria] Error verificando 5.21.4b');
  console.error(error);
  process.exit(1);
});

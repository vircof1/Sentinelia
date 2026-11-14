import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { ClienteSql } from '../paquetes/persistencia-sql/src/ClienteSql.js';
import { EjecutorMigraciones } from '../paquetes/persistencia-sql/src/EjecutorMigraciones.js';
import { RepositorioMigraciones } from '../paquetes/persistencia-sql/src/RepositorioMigraciones.js';
import {
  obtenerConfiguracionAplicacion,
  obtenerRutaMigraciones
} from '../paquetes/utilidades/src/configuracion/obtenerConfiguracionAplicacion.js';

const configuracion = obtenerConfiguracionAplicacion();
const nombreBase = `sentinelia_dns521_${Date.now()}_${process.pid}`;
const PERFIL = 'sentinelia-bind-proyeccion-v1';

async function main() {
  assert.equal(
    configuracion.sql.estaCompleta,
    true,
    'La verificación 5.21.4h requiere SQL local.'
  );
  let clienteSql = null;
  let errorPrincipal = null;
  try {
    clienteSql = await prepararBaseTemporal();
    await verificarEsquema(clienteSql);
    await verificarCabeceraYReconciliacion(clienteSql);
    await verificarOperacionYRecuperacion(clienteSql);
  } catch (error) {
    errorPrincipal = error;
  } finally {
    try {
      await clienteSql?.cerrar();
      await eliminarBaseTemporal();
    } catch (errorLimpieza) {
      if (!errorPrincipal) throw errorLimpieza;
      console.error('[dns] Error adicional limpiando la verificación 5.21.4h');
      console.error(errorLimpieza);
    }
  }
  if (errorPrincipal) throw errorPrincipal;
  console.log(
    '[dns] OK 5.21.4h: generacion=monotonica operacion=inmutable ' +
    'reconciliacion=trasladable recuperacion=acotada proyeccion=congelada'
  );
}

async function prepararBaseTemporal() {
  validarNombreBase(nombreBase);
  const clienteSql = new ClienteSql({
    ...configuracion.sql,
    baseDatos: nombreBase
  });
  await clienteSql.crearBaseDatosSiNoExiste();
  const ejecutor = new EjecutorMigraciones({
    clienteSql,
    repositorioMigraciones: new RepositorioMigraciones(clienteSql),
    rutaMigraciones: obtenerRutaMigraciones()
  });
  await ejecutor.ejecutarPendientes();
  const segunda = await ejecutor.ejecutarPendientes();
  assert.equal(segunda.pendientesAplicadas, 0, 'El historial DDL debe ser reanudable.');
  return clienteSql;
}

async function verificarEsquema(clienteSql) {
  const tablas = await clienteSql.consultar(
    `SELECT TABLE_NAME AS nombre
     FROM information_schema.TABLES
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME IN (
       'cabecera_generacion_dns',
       'reconciliacion_inicial_dns',
       'operaciones_publicacion_dns'
     )`
  );
  assert.equal(tablas.length, 3);

  const [perfil] = await clienteSql.consultar(
    `SELECT COLUMN_TYPE AS tipo, CHARACTER_SET_NAME AS juego,
            COLLATION_NAME AS colacion
     FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE()
       AND TABLE_NAME = 'operaciones_publicacion_dns'
       AND COLUMN_NAME = 'perfil_proyeccion'`
  );
  assert.equal(String(perfil.tipo).toLowerCase(), 'varchar(64)');
  assert.equal(perfil.juego, 'ascii');
  assert.equal(perfil.colacion, 'ascii_bin');

  const [hash] = await clienteSql.consultar(
    `SELECT COLUMN_TYPE AS tipo
     FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE()
       AND TABLE_NAME = 'operaciones_publicacion_dns'
       AND COLUMN_NAME = 'hash_proyeccion'`
  );
  assert.equal(String(hash.tipo).toLowerCase(), 'binary(32)');

  const triggers = await clienteSql.consultar(
    `SELECT TRIGGER_NAME AS nombre
     FROM information_schema.TRIGGERS
     WHERE TRIGGER_SCHEMA = DATABASE() AND TRIGGER_NAME IN (
       'trg_operaciones_dns_validar_insert',
       'trg_operaciones_dns_proteger_update',
       'trg_operaciones_dns_proteger_delete',
       'trg_cabecera_generacion_dns_proteger_update',
       'trg_cabecera_generacion_dns_proteger_delete',
       'trg_reconciliacion_inicial_dns_validar_insert',
       'trg_reconciliacion_inicial_dns_proteger_update',
       'trg_reconciliacion_inicial_dns_proteger_delete'
     )`
  );
  assert.equal(triggers.length, 8);

  const foraneas = await clienteSql.consultar(
    `SELECT CONSTRAINT_NAME
     FROM information_schema.REFERENTIAL_CONSTRAINTS
     WHERE CONSTRAINT_SCHEMA = DATABASE()
       AND TABLE_NAME IN (
         'cabecera_generacion_dns',
         'reconciliacion_inicial_dns',
         'operaciones_publicacion_dns'
       )`
  );
  assert.equal(foraneas.length, 0, 'La coordinación conserva referencias escalares sin cascadas.');

  const prohibidas = await clienteSql.consultar(
    `SELECT COLUMN_NAME AS nombre
     FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE()
       AND TABLE_NAME = 'operaciones_publicacion_dns'
       AND COLUMN_NAME IN (
         'credenciales', 'secreto', 'archivo', 'contenido_archivo',
         'respuesta_externa', 'stdout', 'stderr'
       )`
  );
  assert.equal(prohibidas.length, 0);
}

async function verificarCabeceraYReconciliacion(clienteSql) {
  const [cabecera] = await clienteSql.consultar(
    'SELECT * FROM cabecera_generacion_dns WHERE id = 1'
  );
  assert.equal(String(cabecera.ultima_generacion_dns), '0');
  assert.equal(cabecera.generacion_observada, null);
  assert.equal((await clienteSql.consultar('SELECT * FROM reconciliacion_inicial_dns')).length, 0);

  await avanzarGeneracion(clienteSql, 1);
  await clienteSql.ejecutar(
    `INSERT INTO reconciliacion_inicial_dns (
       id, estado, generacion_objetivo, intentos, max_intentos,
       proximo_intento_utc, creada_en_utc, actualizada_en_utc
     ) VALUES (
       1, 'activa', 1, 0, 3, UTC_TIMESTAMP(3), UTC_TIMESTAMP(3), UTC_TIMESTAMP(3)
     )`
  );
  await assert.rejects(
    () => clienteSql.ejecutar(
      `UPDATE cabecera_generacion_dns
       SET ultima_generacion_dns = 3, actualizada_en_utc = UTC_TIMESTAMP(3)
       WHERE id = 1`
    ),
    /generacionDns solo puede avanzar/
  );
  await assert.rejects(
    () => clienteSql.ejecutar('DELETE FROM cabecera_generacion_dns WHERE id = 1'),
    /no puede eliminarse/
  );
}

async function verificarOperacionYRecuperacion(clienteSql) {
  await insertarOperacion(clienteSql, {
    generacion: 1,
    causa: 'reconciliacion_inicial',
    raiz: 1
  });
  await assert.rejects(
    () => insertarOperacion(clienteSql, {
      generacion: 2,
      causa: 'mutacion_catalogo',
      raiz: 2
    }),
    /generación global vigente/
  );

  await reclamar(clienteSql, 1, 1);
  await iniciarEfecto(clienteSql, 1, randomBytes(32));
  await assert.rejects(
    () => clienteSql.ejecutar(
      `UPDATE operaciones_publicacion_dns
       SET perfil_proyeccion = 'otro-perfil', actualizada_en_utc = UTC_TIMESTAMP(3)
       WHERE generacion_dns = 1`
    ),
    /proyección DNS|fotografía de proyección/
  );
  await clienteSql.ejecutar(
    `UPDATE operaciones_publicacion_dns
     SET estado = 'recuperacion_pendiente', actualizada_en_utc = UTC_TIMESTAMP(3)
     WHERE generacion_dns = 1`
  );

  await clienteSql.ejecutar(
    `UPDATE reconciliacion_inicial_dns
     SET estado = 'bloqueada', intentos = max_intentos,
         proximo_intento_utc = NULL,
         ultimo_codigo_error = 'bind_no_disponible',
         ultimo_mensaje_error = 'BIND no está disponible.',
         actualizada_en_utc = UTC_TIMESTAMP(3)
     WHERE id = 1`
  );
  await avanzarGeneracion(clienteSql, 2);
  await assert.rejects(
    () => clienteSql.ejecutar(
      `UPDATE reconciliacion_inicial_dns
       SET generacion_objetivo = 2, estado = 'activa', intentos = 0,
           proximo_intento_utc = UTC_TIMESTAMP(3),
           ultimo_codigo_error = NULL, ultimo_mensaje_error = NULL,
           actualizada_en_utc = UTC_TIMESTAMP(3)
       WHERE id = 1`
    ),
    /no reactiva ni reinicia/
  );
  await clienteSql.ejecutar(
    `UPDATE reconciliacion_inicial_dns
     SET generacion_objetivo = 2, actualizada_en_utc = UTC_TIMESTAMP(3)
     WHERE id = 1`
  );
  await clienteSql.ejecutar(
    `UPDATE reconciliacion_inicial_dns
     SET estado = 'activa', intentos = 0,
         proximo_intento_utc = UTC_TIMESTAMP(3),
         ultimo_codigo_error = NULL, ultimo_mensaje_error = NULL,
         actualizada_en_utc = UTC_TIMESTAMP(3)
     WHERE id = 1`
  );

  await insertarOperacion(clienteSql, {
    generacion: 2,
    causa: 'divergencia_proyeccion_recuperacion',
    predecesora: 1,
    raiz: 1,
    raizAutomatica: 1
  });
  await verificarUnicaSucesoraAutomatica(clienteSql);
  await reclamar(clienteSql, 2, 2);
  await iniciarEfecto(clienteSql, 2, randomBytes(32));
  await clienteSql.ejecutar(
    `UPDATE operaciones_publicacion_dns
     SET estado = 'recarga_confirmada', generacion_observada = 2,
         recarga_confirmada_en_utc = UTC_TIMESTAMP(3),
         actualizada_en_utc = UTC_TIMESTAMP(3)
     WHERE generacion_dns = 2`
  );
  await clienteSql.ejecutar(
    `UPDATE cabecera_generacion_dns
     SET generacion_observada = 2, actualizada_en_utc = UTC_TIMESTAMP(3)
     WHERE id = 1`
  );
  await clienteSql.ejecutar(
    `UPDATE operaciones_publicacion_dns
     SET estado = 'consolidada', proximo_intento_utc = NULL,
         resultado_zonas = 2, resultado_artefactos = 3, resultado_cambios = 1,
         obligacion_outbox_id = 101, terminada_en_utc = UTC_TIMESTAMP(3),
         actualizada_en_utc = UTC_TIMESTAMP(3)
     WHERE generacion_dns = 2`
  );
  await clienteSql.ejecutar(
    `UPDATE reconciliacion_inicial_dns
     SET estado = 'satisfecha', proximo_intento_utc = NULL,
         satisfecha_en_utc = UTC_TIMESTAMP(3), actualizada_en_utc = UTC_TIMESTAMP(3)
     WHERE id = 1`
  );
  await clienteSql.ejecutar(
    `UPDATE operaciones_publicacion_dns
     SET estado = 'superada_tras_recuperacion', proximo_intento_utc = NULL,
         generacion_convergente = 2, terminada_en_utc = UTC_TIMESTAMP(3),
         actualizada_en_utc = UTC_TIMESTAMP(3)
     WHERE generacion_dns = 1`
  );

  await assert.rejects(
    () => clienteSql.ejecutar(
      `UPDATE operaciones_publicacion_dns
       SET generacion_convergente = 3, actualizada_en_utc = UTC_TIMESTAMP(3)
       WHERE generacion_dns = 1`
    ),
    /inmutable|terminal/
  );
  await assert.rejects(
    () => clienteSql.ejecutar('DELETE FROM operaciones_publicacion_dns WHERE generacion_dns = 2'),
    /incorporarse antes de limpiar/
  );
  const eventoId = randomBytes(16);
  await clienteSql.ejecutar(
    `UPDATE operaciones_publicacion_dns
     SET evento_resultado_id = ?, actualizada_en_utc = UTC_TIMESTAMP(3)
     WHERE generacion_dns = 2`,
    [eventoId]
  );
  await assert.rejects(
    () => clienteSql.ejecutar(
      `UPDATE operaciones_publicacion_dns
       SET evento_resultado_id = ?, actualizada_en_utc = UTC_TIMESTAMP(3)
       WHERE generacion_dns = 2`,
      [randomBytes(16)]
    ),
    /inmutable/
  );
  await verificarLimpiezaReversible(clienteSql, 2);
  await assert.rejects(
    () => clienteSql.ejecutar(
      `UPDATE reconciliacion_inicial_dns
       SET generacion_objetivo = 3, actualizada_en_utc = UTC_TIMESTAMP(3)
       WHERE id = 1`
    ),
    /inmutable|generación vigente/
  );
  await assert.rejects(
    () => clienteSql.ejecutar('DELETE FROM reconciliacion_inicial_dns WHERE id = 1'),
    /retención independiente/
  );

  await verificarReintentoUnico(clienteSql);
}

async function verificarUnicaSucesoraAutomatica(clienteSql) {
  const conexion = await clienteSql.obtenerConexion();
  try {
    await conexion.beginTransaction();
    await conexion.execute(
      `UPDATE cabecera_generacion_dns
       SET ultima_generacion_dns = 3, actualizada_en_utc = UTC_TIMESTAMP(3)
       WHERE id = 1`
    );
    await assert.rejects(
      () => insertarOperacion({ ejecutar: (...args) => conexion.execute(...args) }, {
        generacion: 3,
        causa: 'divergencia_proyeccion_recuperacion',
        predecesora: 1,
        raiz: 1,
        raizAutomatica: 1
      }),
      /Duplicate entry/
    );
    await conexion.rollback();
  } catch (error) {
    await rollbackSeguro(conexion);
    throw error;
  } finally {
    conexion.release();
  }
}

async function verificarReintentoUnico(clienteSql) {
  await avanzarGeneracion(clienteSql, 3);
  await insertarOperacion(clienteSql, {
    generacion: 3,
    causa: 'mutacion_catalogo',
    raiz: 3
  });
  await clienteSql.ejecutar(
    `UPDATE operaciones_publicacion_dns
     SET estado = 'fallida', proximo_intento_utc = NULL,
         ultimo_codigo_error = 'validacion_bind',
         ultimo_mensaje_error = 'La validación BIND no fue satisfactoria.',
         resultado_zonas = 2, resultado_artefactos = 0, resultado_cambios = 0,
         obligacion_outbox_id = 102, terminada_en_utc = UTC_TIMESTAMP(3),
         actualizada_en_utc = UTC_TIMESTAMP(3)
     WHERE generacion_dns = 3`
  );
  await avanzarGeneracion(clienteSql, 4);
  await insertarOperacion(clienteSql, {
    generacion: 4,
    causa: 'reintento_reconciliacion',
    predecesora: 3,
    predecesoraFallida: 3,
    raiz: 3
  });

  const conexion = await clienteSql.obtenerConexion();
  try {
    await conexion.beginTransaction();
    await conexion.execute(
      `UPDATE cabecera_generacion_dns
       SET ultima_generacion_dns = 5, actualizada_en_utc = UTC_TIMESTAMP(3)
       WHERE id = 1`
    );
    await assert.rejects(
      () => insertarOperacion({ ejecutar: (...args) => conexion.execute(...args) }, {
        generacion: 5,
        causa: 'reintento_reconciliacion',
        predecesora: 3,
        predecesoraFallida: 3,
        raiz: 3
      }),
      /Duplicate entry/
    );
    await conexion.rollback();
  } catch (error) {
    await rollbackSeguro(conexion);
    throw error;
  } finally {
    conexion.release();
  }
}

async function avanzarGeneracion(clienteSql, generacion) {
  await clienteSql.ejecutar(
    `UPDATE cabecera_generacion_dns
     SET ultima_generacion_dns = ?, actualizada_en_utc = UTC_TIMESTAMP(3)
     WHERE id = 1`,
    [generacion]
  );
}

async function insertarOperacion(clienteSql, {
  generacion,
  causa,
  predecesora = null,
  predecesoraFallida = null,
  raiz,
  raizAutomatica = null
}) {
  await clienteSql.ejecutar(
    `INSERT INTO operaciones_publicacion_dns (
       generacion_dns, causa, generacion_predecesora,
       generacion_predecesora_fallida, generacion_raiz_recuperacion,
       raiz_sucesion_automatica, estado, proximo_intento_utc,
       creada_en_utc, actualizada_en_utc
     ) VALUES (?, ?, ?, ?, ?, ?, 'pendiente', UTC_TIMESTAMP(3),
       UTC_TIMESTAMP(3), UTC_TIMESTAMP(3))`,
    [generacion, causa, predecesora, predecesoraFallida, raiz, raizAutomatica]
  );
}

async function reclamar(clienteSql, generacion, fencingToken) {
  await clienteSql.ejecutar(
    `UPDATE cabecera_generacion_dns
     SET fencing_token = ?, actualizada_en_utc = UTC_TIMESTAMP(3)
     WHERE id = 1`,
    [fencingToken]
  );
  await clienteSql.ejecutar(
    `UPDATE operaciones_publicacion_dns
     SET instancia_id = 'dns-test', lease_token = ?,
         lease_expira_utc = TIMESTAMPADD(SECOND, 30, UTC_TIMESTAMP(3)),
         fencing_token = ?, intentos = intentos + 1,
         actualizada_en_utc = UTC_TIMESTAMP(3)
     WHERE generacion_dns = ?`,
    [randomBytes(32), fencingToken, generacion]
  );
}

async function iniciarEfecto(clienteSql, generacion, hash) {
  await clienteSql.ejecutar(
    `UPDATE operaciones_publicacion_dns
     SET estado = 'efecto_iniciado', efecto_posible = TRUE,
         generacion_leida = ?, perfil_proyeccion = ?, hash_proyeccion = ?,
         efecto_iniciado_en_utc = UTC_TIMESTAMP(3),
         instancia_id = NULL, lease_token = NULL, lease_expira_utc = NULL,
         actualizada_en_utc = UTC_TIMESTAMP(3)
     WHERE generacion_dns = ?`,
    [generacion, PERFIL, hash, generacion]
  );
}

async function verificarLimpiezaReversible(clienteSql, generacion) {
  const conexion = await clienteSql.obtenerConexion();
  try {
    await conexion.beginTransaction();
    const [resultado] = await conexion.execute(
      'DELETE FROM operaciones_publicacion_dns WHERE generacion_dns = ?',
      [generacion]
    );
    assert.equal(resultado.affectedRows, 1);
    await conexion.rollback();
  } catch (error) {
    await rollbackSeguro(conexion);
    throw error;
  } finally {
    conexion.release();
  }
}

async function eliminarBaseTemporal() {
  validarNombreBase(nombreBase);
  const clienteSql = new ClienteSql(configuracion.sql);
  try {
    await clienteSql.ejecutar(`DROP DATABASE IF EXISTS \`${nombreBase}\``);
  } finally {
    await clienteSql.cerrar();
  }
}

function validarNombreBase(nombre) {
  if (!/^sentinelia_dns521_[0-9_]{1,40}$/.test(nombre)) {
    throw new Error('El nombre de base temporal DNS 5.21 no es seguro.');
  }
}

async function rollbackSeguro(conexion) {
  try {
    await conexion.rollback();
  } catch {
    // La excepción original conserva prioridad.
  }
}

main().catch((error) => {
  console.error('[dns] Falló la verificación de coordinación durable 5.21.4h');
  console.error(error);
  process.exitCode = 1;
});

import assert from 'node:assert/strict';
import { generarUuidV7Auditoria } from '../paquetes/auditoria/src/UuidV7Auditoria.js';
import {
  CoordinadorOperacionesDurables,
  LeaseOperacionDurablePerdido
} from '../paquetes/coordinacion-durable/src/CoordinadorOperacionesDurables.js';
import { ProyectorFencingAgentesRedis } from '../paquetes/coordinacion-durable/src/ProyectorFencingAgentesRedis.js';
import { ClienteSql } from '../paquetes/persistencia-sql/src/ClienteSql.js';
import { ServicioConexionRedis } from '../paquetes/sesiones/src/ServicioConexionRedis.js';
import { obtenerConfiguracionAplicacion } from '../paquetes/utilidades/src/configuracion/obtenerConfiguracionAplicacion.js';

const configuracion = obtenerConfiguracionAplicacion();
const sufijo = `${Date.now()}_${process.pid}`;
const nombreBaseDatos = `sentinelia_coord_5215d_${sufijo}`;
const prefijoRedis = `sentinelia:test:coord:5215d:${sufijo}:`;

async function main() {
  assert.equal(
    configuracion.sql.estaCompleta,
    true,
    'La verificación 5.21.5d requiere MariaDB local.'
  );
  const clienteSql = new ClienteSql({
    ...configuracion.sql,
    baseDatos: nombreBaseDatos
  });
  const conexionRedis = new ServicioConexionRedis(configuracion.redis);
  let clienteRedis;
  let errorPrincipal = null;
  try {
    await clienteSql.crearBaseDatosSiNoExiste();
    await crearEsquema(clienteSql);
    clienteRedis = await conexionRedis.conectar();
    await verificarReclamacionConcurrente(clienteSql);
    await verificarRecuperacionLeaseVencido(clienteSql);
    await verificarDiagnosticoYReintento(clienteSql);
    await verificarFencingRedis(clienteRedis);
  } catch (error) {
    errorPrincipal = error;
  } finally {
    try {
      if (clienteRedis) await limpiarRedis(clienteRedis);
      await clienteSql.cerrar();
      await eliminarBaseTemporal();
    } catch (errorLimpieza) {
      if (!errorPrincipal) throw errorLimpieza;
      console.error('[coordinacion] Error adicional durante la limpieza 5.21.5d');
      console.error(errorLimpieza);
    }
    await conexionRedis.cerrar();
  }
  if (errorPrincipal) throw errorPrincipal;
  console.log(
    '[coordinacion] OK 5.21.5d: skip_locked=si lease_recuperado=si doble_consolidacion=no redis_tardio=rechazado'
  );
}

async function verificarReclamacionConcurrente(clienteSql) {
  await insertarOperacion(clienteSql, 'primera');
  await insertarOperacion(clienteSql, 'segunda');
  const barrera = crearBarrera();
  const repositorioA = new RepositorioFixtureDurable(clienteSql, {
    despuesDeBloquear: barrera.bloquear
  });
  const repositorioB = new RepositorioFixtureDurable(clienteSql);
  const coordinadorA = crearCoordinador(repositorioA, 'instancia-a');
  const coordinadorB = crearCoordinador(repositorioB, 'instancia-b');

  const reclamacionA = coordinadorA.reclamarSiguiente();
  await barrera.esperarBloqueo;
  const leaseB = await coordinadorB.reclamarSiguiente();
  barrera.liberar();
  const leaseA = await reclamacionA;

  assert.notEqual(leaseA.lease.operacionId, leaseB.lease.operacionId);
  assert.notEqual(leaseA.lease.leaseToken, leaseB.lease.leaseToken);
  assert.equal(leaseA.lease.fencingToken, '1');
  assert.equal(leaseB.lease.fencingToken, '1');
  await coordinadorA.avanzar(leaseA.lease, { transicion: 'efecto_observado' });
  await coordinadorB.avanzar(leaseB.lease, { transicion: 'efecto_observado' });
  await coordinadorA.consolidar(leaseA.lease, { resultado: 'aplicada' });
  await coordinadorB.consolidar(leaseB.lease, { resultado: 'aplicada' });
  await assert.rejects(
    () => coordinadorA.consolidar(leaseA.lease, { resultado: 'duplicada' }),
    LeaseOperacionDurablePerdido
  );

  const filas = await clienteSql.consultar(
    "SELECT estado, resultado FROM operaciones_durables ORDER BY id LIMIT 2"
  );
  assert.deepEqual(
    filas.map(({ estado, resultado }) => [estado, resultado]),
    [['completada', 'aplicada'], ['completada', 'aplicada']]
  );
}

async function verificarRecuperacionLeaseVencido(clienteSql) {
  const operacionId = await insertarOperacion(clienteSql, 'recuperable');
  const coordinadorA = crearCoordinador(
    new RepositorioFixtureDurable(clienteSql),
    'instancia-antigua'
  );
  const coordinadorB = crearCoordinador(
    new RepositorioFixtureDurable(clienteSql),
    'instancia-recuperadora'
  );
  const antigua = await coordinadorA.reclamarSiguiente();
  assert.equal(antigua.lease.operacionId, operacionId);
  await clienteSql.ejecutar(
    "UPDATE operaciones_durables SET lease_expira_utc = TIMESTAMPADD(SECOND, -1, UTC_TIMESTAMP(3)) WHERE id = ?",
    [operacionId]
  );
  const recuperada = await coordinadorB.reclamarSiguiente();
  assert.equal(recuperada.lease.operacionId, operacionId);
  assert.equal(recuperada.lease.fencingToken, '2');
  assert.notEqual(recuperada.lease.leaseToken, antigua.lease.leaseToken);

  await assert.rejects(
    () => coordinadorA.avanzar(antigua.lease, { transicion: 'escritura_tardia' }),
    LeaseOperacionDurablePerdido
  );
  await assert.rejects(
    () => coordinadorA.consolidar(antigua.lease, { resultado: 'incorrecta' }),
    LeaseOperacionDurablePerdido
  );
  await coordinadorB.renovar(recuperada.lease);
  await coordinadorB.avanzar(recuperada.lease, { transicion: 'efecto_observado' });
  await coordinadorB.consolidar(recuperada.lease, { resultado: 'recuperada' });
  const [fila] = await clienteSql.consultar(
    'SELECT estado, resultado, fencing_token FROM operaciones_durables WHERE id = ?',
    [operacionId]
  );
  assert.equal(fila.estado, 'completada');
  assert.equal(fila.resultado, 'recuperada');
  assert.equal(String(fila.fencing_token), '2');
}

async function verificarDiagnosticoYReintento(clienteSql) {
  const operacionId = await insertarOperacion(clienteSql, 'fallida');
  const coordinador = crearCoordinador(
    new RepositorioFixtureDurable(clienteSql),
    'instancia-reintento'
  );
  const primera = await coordinador.reclamarSiguiente();
  await coordinador.registrarFallo(primera.lease, {
    codigo: 'Redis temporal!',
    mensaje: 'Authorization: Bearer abc.def password=secreto\u0000 fallo transitorio',
    demoraReintentoSegundos: 1
  });
  const [fallida] = await clienteSql.consultar(
    `SELECT estado, intentos, proximo_intento_utc, ultimo_codigo_error,
            ultimo_mensaje_error, lease_token
       FROM operaciones_durables WHERE id = ?`,
    [operacionId]
  );
  assert.equal(fallida.estado, 'reintentable');
  assert.equal(Number(fallida.intentos), 1);
  assert.equal(fallida.ultimo_codigo_error, 'redis_temporal_');
  assert.equal(/abc|secreto|bearer|password/i.test(fallida.ultimo_mensaje_error), false);
  assert.equal(fallida.lease_token, null);

  await clienteSql.ejecutar(
    'UPDATE operaciones_durables SET proximo_intento_utc = UTC_TIMESTAMP(3) WHERE id = ?',
    [operacionId]
  );
  const segunda = await coordinador.reclamarSiguiente();
  assert.equal(segunda.lease.operacionId, operacionId);
  assert.equal(segunda.intentos, 2);
  assert.equal(segunda.lease.fencingToken, '2');
  await coordinador.consolidar(segunda.lease, { resultado: 'reintentada' });
}

async function verificarFencingRedis(clienteRedis) {
  const proyector = new ProyectorFencingAgentesRedis({
    clienteRedis,
    prefijo: prefijoRedis
  });
  const agenteId = '18446744073709551614';
  const operacionAntigua = generarUuidV7Auditoria();
  const operacionVigente = generarUuidV7Auditoria();
  const operacionNueva = generarUuidV7Auditoria();

  const vigente = await proyector.aplicar({
    agenteId,
    operacionId: operacionVigente,
    fencingToken: '2',
    proyeccion: { sesion: 'vigente', version: 2 },
    ttlSegundos: 60
  });
  assert.equal(vigente.estado, 'aplicada');
  const tardia = await proyector.aplicar({
    agenteId,
    operacionId: operacionAntigua,
    fencingToken: '1',
    proyeccion: { sesion: 'antigua' },
    ttlSegundos: 60
  });
  assert.equal(tardia.estado, 'fencing_antiguo');
  assert.deepEqual(await proyector.obtenerProyeccion(agenteId), {
    sesion: 'vigente',
    version: 2
  });
  const conflicto = await proyector.aplicar({
    agenteId,
    operacionId: operacionNueva,
    fencingToken: '2',
    proyeccion: { sesion: 'conflictiva' },
    ttlSegundos: 60
  });
  assert.equal(conflicto.estado, 'conflicto_mismo_fencing');
  const repetida = await proyector.aplicar({
    agenteId,
    operacionId: operacionVigente,
    fencingToken: '2',
    proyeccion: { sesion: 'vigente', version: 2 },
    ttlSegundos: 60
  });
  assert.equal(repetida.estado, 'repetida');

  await proyector.aplicar({
    agenteId,
    operacionId: operacionNueva,
    fencingToken: '18446744073709551614',
    proyeccion: null
  });
  assert.equal(await proyector.obtenerProyeccion(agenteId), null);
  assert.deepEqual(await proyector.obtenerAutoridad(agenteId), {
    fencingToken: '18446744073709551614',
    operacionId: operacionNueva
  });
  const resurreccionTardia = await proyector.aplicar({
    agenteId,
    operacionId: operacionVigente,
    fencingToken: '9999999999999999999',
    proyeccion: { sesion: 'resucitada' },
    ttlSegundos: 60
  });
  assert.equal(resurreccionTardia.estado, 'fencing_antiguo');
  assert.equal(await proyector.obtenerProyeccion(agenteId), null);
}

function crearCoordinador(repositorio, instanciaId) {
  return new CoordinadorOperacionesDurables({
    repositorio,
    instanciaId,
    ttlSegundos: 30
  });
}

class RepositorioFixtureDurable {
  constructor(clienteSql, { despuesDeBloquear = null } = {}) {
    this.clienteSql = clienteSql;
    this.despuesDeBloquear = despuesDeBloquear;
  }

  async reclamarSiguiente({ instanciaId, leaseToken, ttlSegundos }) {
    const conexion = await this.clienteSql.obtenerConexion();
    try {
      await conexion.query('SET TRANSACTION ISOLATION LEVEL READ COMMITTED');
      await conexion.beginTransaction();
      const [filas] = await conexion.execute(`
        SELECT id, fencing_token, intentos, max_intentos, nombre
          FROM operaciones_durables FORCE INDEX (PRIMARY)
         WHERE intentos < max_intentos
           AND (
             (estado IN ('pendiente', 'reintentable') AND proximo_intento_utc <= UTC_TIMESTAMP(3))
             OR
             (estado IN ('procesando', 'intermedio') AND lease_expira_utc <= UTC_TIMESTAMP(3))
           )
         ORDER BY id ASC
         LIMIT 1
         FOR UPDATE SKIP LOCKED
      `);
      if (!filas[0]) {
        await conexion.commit();
        return null;
      }
      if (this.despuesDeBloquear) await this.despuesDeBloquear(filas[0]);
      const fencingToken = (BigInt(filas[0].fencing_token) + 1n).toString();
      const [resultado] = await conexion.execute(`
        UPDATE operaciones_durables
           SET estado = 'procesando', instancia_id = ?, lease_token = ?,
               lease_expira_utc = TIMESTAMPADD(SECOND, ?, UTC_TIMESTAMP(3)),
               fencing_token = ?, intentos = intentos + 1,
               ultimo_codigo_error = NULL, ultimo_mensaje_error = NULL,
               actualizado_en_utc = UTC_TIMESTAMP(3)
         WHERE id = ?
      `, [instanciaId, leaseToken, ttlSegundos, fencingToken, filas[0].id]);
      assert.equal(resultado.affectedRows, 1);
      await conexion.commit();
      return {
        operacionId: String(filas[0].id),
        fencingToken,
        intentos: Number(filas[0].intentos) + 1,
        operacion: { nombre: filas[0].nombre }
      };
    } catch (error) {
      await conexion.rollback();
      throw error;
    } finally {
      conexion.release();
    }
  }

  renovarLease(parametros) {
    return this.#actualizarConLease(parametros, `
      UPDATE operaciones_durables
         SET lease_expira_utc = TIMESTAMPADD(SECOND, ?, UTC_TIMESTAMP(3)),
             actualizado_en_utc = UTC_TIMESTAMP(3)
       WHERE id = ? AND instancia_id = ? AND lease_token = ?
         AND fencing_token = ? AND lease_expira_utc > UTC_TIMESTAMP(3)
         AND estado IN ('procesando', 'intermedio')
    `, [parametros.ttlSegundos]);
  }

  avanzarConLease(parametros) {
    return this.#actualizarConLease(parametros, `
      UPDATE operaciones_durables
         SET estado = 'intermedio', transicion = ?, actualizado_en_utc = UTC_TIMESTAMP(3)
       WHERE id = ? AND instancia_id = ? AND lease_token = ?
         AND fencing_token = ? AND lease_expira_utc > UTC_TIMESTAMP(3)
         AND estado IN ('procesando', 'intermedio')
    `, [parametros.transicion]);
  }

  consolidarConLease(parametros) {
    return this.#actualizarConLease(parametros, `
      UPDATE operaciones_durables
         SET estado = 'completada', resultado = ?, instancia_id = NULL,
             lease_token = NULL, lease_expira_utc = NULL,
             actualizado_en_utc = UTC_TIMESTAMP(3)
       WHERE id = ? AND instancia_id = ? AND lease_token = ?
         AND fencing_token = ? AND lease_expira_utc > UTC_TIMESTAMP(3)
         AND estado IN ('procesando', 'intermedio')
    `, [parametros.resultado]);
  }

  registrarFalloConLease(parametros) {
    const estado = parametros.permanente ? 'bloqueada' : 'reintentable';
    return this.#actualizarConLease(parametros, `
      UPDATE operaciones_durables
         SET estado = ?, proximo_intento_utc = TIMESTAMPADD(SECOND, ?, UTC_TIMESTAMP(3)),
             ultimo_codigo_error = ?, ultimo_mensaje_error = ?,
             instancia_id = NULL, lease_token = NULL, lease_expira_utc = NULL,
             actualizado_en_utc = UTC_TIMESTAMP(3)
       WHERE id = ? AND instancia_id = ? AND lease_token = ?
         AND fencing_token = ? AND lease_expira_utc > UTC_TIMESTAMP(3)
         AND estado IN ('procesando', 'intermedio')
    `, [
      estado,
      parametros.demoraReintentoSegundos,
      parametros.diagnostico.codigo,
      parametros.diagnostico.mensaje
    ]);
  }

  async #actualizarConLease(parametros, sql, prefijo) {
    const [resultado] = await this.clienteSql.ejecutar(sql, [
      ...prefijo,
      parametros.operacionId,
      parametros.instanciaId,
      parametros.leaseToken,
      parametros.fencingToken
    ]);
    return { actualizada: resultado.affectedRows === 1 };
  }
}

async function crearEsquema(clienteSql) {
  await clienteSql.ejecutar(`
    CREATE TABLE operaciones_durables (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
      nombre VARCHAR(64) NOT NULL,
      estado ENUM('pendiente','procesando','intermedio','reintentable','completada','bloqueada') NOT NULL,
      proximo_intento_utc DATETIME(3) NOT NULL,
      instancia_id VARCHAR(128) CHARACTER SET ascii COLLATE ascii_bin NULL,
      lease_token BINARY(32) NULL,
      lease_expira_utc DATETIME(3) NULL,
      fencing_token BIGINT UNSIGNED NOT NULL DEFAULT 0,
      intentos INT UNSIGNED NOT NULL DEFAULT 0,
      max_intentos INT UNSIGNED NOT NULL DEFAULT 5,
      transicion VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NULL,
      resultado VARCHAR(64) NULL,
      ultimo_codigo_error VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NULL,
      ultimo_mensaje_error VARCHAR(512) NULL,
      actualizado_en_utc DATETIME(3) NOT NULL,
      PRIMARY KEY (id),
      KEY idx_operaciones_elegibles (estado, proximo_intento_utc, lease_expira_utc, id)
    ) ENGINE=InnoDB
  `);
}

async function insertarOperacion(clienteSql, nombre) {
  const [resultado] = await clienteSql.ejecutar(`
    INSERT INTO operaciones_durables (
      nombre, estado, proximo_intento_utc, actualizado_en_utc
    ) VALUES (?, 'pendiente', UTC_TIMESTAMP(3), UTC_TIMESTAMP(3))
  `, [nombre]);
  return String(resultado.insertId);
}

function crearBarrera() {
  let notificarBloqueo;
  let liberarBloqueo;
  const esperarBloqueo = new Promise((resolver) => { notificarBloqueo = resolver; });
  const esperarLiberacion = new Promise((resolver) => { liberarBloqueo = resolver; });
  return {
    esperarBloqueo,
    bloquear: async () => {
      notificarBloqueo();
      await esperarLiberacion;
    },
    liberar: liberarBloqueo
  };
}

async function limpiarRedis(clienteRedis) {
  const claves = [];
  for await (const clave of clienteRedis.scanIterator({
    MATCH: `${prefijoRedis}*`,
    COUNT: 100
  })) claves.push(clave);
  if (claves.length > 0) await clienteRedis.del(claves);
}

async function eliminarBaseTemporal() {
  if (!/^sentinelia_coord_5215d_[0-9]+_[0-9]+$/.test(nombreBaseDatos)) {
    throw new Error('Nombre de base temporal no seguro.');
  }
  const clienteAdministrativo = new ClienteSql({
    ...configuracion.sql,
    baseDatos: 'information_schema'
  });
  try {
    await clienteAdministrativo.ejecutar(`DROP DATABASE IF EXISTS \`${nombreBaseDatos}\``);
  } finally {
    await clienteAdministrativo.cerrar();
  }
}

main().catch((error) => {
  console.error('[coordinacion] Fallo verificando leases y fencing 5.21.5d');
  console.error(error);
  process.exitCode = 1;
});

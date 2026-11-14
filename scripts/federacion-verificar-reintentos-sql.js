import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { setTimeout as esperar } from 'node:timers/promises';
import { ClienteSql } from '../paquetes/persistencia-sql/src/ClienteSql.js';
import { obtenerConfiguracionAplicacion } from '../paquetes/utilidades/src/configuracion/obtenerConfiguracionAplicacion.js';
import {
  FronteraTransaccionalFederacion, MENSAJE_CONCURRENCIA_FEDERACION
} from '../paquetes/federacion/adaptadores/FronteraTransaccionalFederacion.js';
import { ServicioCorteInicialGeneracionFederacion }
  from '../paquetes/federacion/aplicacion/ServicioCorteInicialGeneracionFederacion.js';
import { ControladorFederacion } from '../apps/sentinelia-web/src/controladores/ControladorFederacion.js';

const configuracion = obtenerConfiguracionAplicacion().sql;
const administrador = new ClienteSql(configuracion);
const base = `sentinelia_fixture_fed04_retry_${randomBytes(6).toString('hex')}`;
let sql;
try {
  await administrador.ejecutar(`CREATE DATABASE ${administrador.escaparIdentificador(base)}`);
  sql = new ClienteSql({ ...configuracion, baseDatos: base });
  for (const sentencia of `CREATE TABLE relacion (
    id INT PRIMARY KEY, identidad VARCHAR(32) NOT NULL UNIQUE
  ) ENGINE=InnoDB;
  INSERT INTO relacion VALUES (1,'relacion');
  CREATE TABLE efectos (id INT PRIMARY KEY) ENGINE=InnoDB;
  CREATE TABLE corte (id INT PRIMARY KEY, estado VARCHAR(16)) ENGINE=InnoDB;
  INSERT INTO corte VALUES (1,'abierto');`.split(';').filter(s => s.trim())) {
    await sql.ejecutar(sentencia);
  }
  await verificarDeadlockReal();
  await verificarAgotamientoYErrores();
  await verificarCorteCompleto();
  await verificarPortal();
  console.log('FED04_REINTENTOS_OK: deadlock MariaDB real; rollback íntegro; escritura única; corte repetido; límite de intentos; mensaje del portal');
} finally {
  await sql?.cerrar();
  await administrador.ejecutar(`DROP DATABASE IF EXISTS ${administrador.escaparIdentificador(base)}`);
  await administrador.cerrar();
}

async function verificarDeadlockReal() {
  const a = await sql.obtenerConexion();
  let intentos = 0;
  let pausas = 0;
  let conexionB;
  const clienteB = { async obtenerConexion() {
    const conexion = await sql.obtenerConexion();
    conexionB = conexion.threadId;
    await conexion.query('SET innodb_lock_wait_timeout=5');
    return conexion;
  } };
  const frontera = new FronteraTransaccionalFederacion(clienteB, {
    pausa: async () => { pausas += 1; await esperar(30); }
  });
  let pendiente;
  try {
    await a.query('SET innodb_lock_wait_timeout=5');
    await a.beginTransaction();
    await a.query('SELECT * FROM relacion FORCE INDEX(PRIMARY) FOR UPDATE');
    // Dar más peso a A para que InnoDB aborte B y pruebe su recuperación.
    for (let id = 1; id <= 20; id += 1) {
      await a.execute('INSERT INTO efectos VALUES (?)', [id]);
    }
    pendiente = frontera.ejecutar(async conexion => {
      intentos += 1;
      // Una escritura previa al deadlock debe desaparecer antes del reintento.
      await conexion.execute('INSERT INTO efectos VALUES (999)');
      await conexion.execute('SELECT * FROM relacion WHERE identidad=? FOR UPDATE', ['relacion']);
      return 'confirmado';
    });
    // Evitar rechazos no atendidos mientras se coordina la otra conexión.
    pendiente.catch(() => {});
    let esperando = false;
    for (let i = 0; i < 80; i += 1) {
      if (conexionB) {
        const filas = await administrador.consultar(`SELECT COUNT(*) AS total
          FROM information_schema.INNODB_LOCK_WAITS w
          JOIN information_schema.INNODB_TRX t ON t.trx_id=w.requesting_trx_id
          WHERE t.trx_mysql_thread_id=?`, [conexionB]);
        if (Number(filas[0].total) > 0) { esperando = true; break; }
      }
      await esperar(25);
    }
    assert.ok(esperando, 'B debe estar esperando PRIMARY antes de cerrar el ciclo');
    await a.execute('SELECT * FROM relacion WHERE identidad=? FOR UPDATE', ['relacion']);
    await a.rollback();
    assert.equal(await pendiente, 'confirmado');
    assert.equal(intentos, 2, 'El motor aborta una vez; se repite toda la transacción');
    assert.equal(pausas, 1);
    assert.deepEqual((await sql.consultar('SELECT id FROM efectos')).map(f => f.id), [999]);
  } finally {
    await a.rollback();
    a.release();
    await pendiente?.catch(() => {});
  }
  await sql.ejecutar('DELETE FROM efectos');
}

async function verificarAgotamientoYErrores() {
  const original = Object.assign(new Error('detalle SQL privado'), { code: 'ER_LOCK_DEADLOCK' });
  let intentos = 0;
  let pausas = 0;
  const frontera = new FronteraTransaccionalFederacion(sql, {
    pausa: async () => { pausas += 1; }
  });
  await assert.rejects(() => frontera.ejecutar(async conexion => {
    intentos += 1;
    await conexion.execute('INSERT INTO efectos VALUES (1000)');
    throw original;
  }), error => error.codigo === 'CONCURRENCIA_FEDERACION_AGOTADA' &&
    error.statusCode === 409 && error.cause === original &&
    error.message === MENSAJE_CONCURRENCIA_FEDERACION);
  assert.equal(intentos, 3);
  assert.equal(pausas, 2);
  assert.equal((await sql.consultar('SELECT * FROM efectos')).length, 0);
  for (const code of ['ER_DUP_ENTRY', 'ER_LOCK_WAIT_TIMEOUT', 'DOMINIO_NO_AUTORIZADO']) {
    let llamadas = 0;
    const error = Object.assign(new Error(code), { code });
    await assert.rejects(() => frontera.ejecutar(async conexion => {
      llamadas += 1;
      await conexion.execute('INSERT INTO efectos VALUES (1001)');
      throw error;
    }), e => e === error);
    assert.equal(llamadas, 1, 'No repetir errores de contrato ni otros fallos SQL');
    assert.equal((await sql.consultar('SELECT * FROM efectos')).length, 0);
  }
}

async function verificarCorteCompleto() {
  let intentos = 0;
  let fallar = true;
  const servicio = new ServicioCorteInicialGeneracionFederacion({
    clienteSql: sql,
    repositorioFlujos: { crearFlujoInicial() {} },
    repositorioOcurrencias: {
      async bloquearCorteInicialEnTransaccion(_, { conexion }) {
        intentos += 1;
        const [[fila]] = await conexion.execute('SELECT estado FROM corte WHERE id=1 FOR UPDATE');
        return { flujoId: 'flujo', generacionId: 'generacion', estado: fila.estado, fronteraInicial: '2' };
      },
      async cerrarCorteInicialEnTransaccion(_, { conexion }) {
        await conexion.execute("UPDATE corte SET estado='cerrado' WHERE id=1");
        return { fronteraInicial: '2' };
      }
    },
    fuenteFotografia: {
      async listarCapturasEnTransaccion() {
        return [1, 2].map(id => ({ definicion: { id } }));
      }
    },
    adaptadorCaptura: {
      async capturarEnTransaccion({ definicion }, { conexion }) {
        await conexion.execute('INSERT INTO efectos VALUES (?)', [definicion.id]);
        if (fallar) {
          fallar = false;
          throw Object.assign(new Error('deadlock simulado tras escritura parcial'), { code: 'ER_LOCK_DEADLOCK' });
        }
      }
    }
  });
  assert.equal((await servicio.cerrar({ flujoId: 'flujo', generacionId: 'generacion' })).estadoEjecucion, 'cerrado');
  assert.equal(intentos, 2);
  assert.deepEqual((await sql.consultar('SELECT id FROM efectos ORDER BY id')).map(f => f.id), [1, 2]);
  assert.equal((await servicio.cerrar({ flujoId: 'flujo', generacionId: 'generacion' })).estadoEjecucion, 'yaCerrado');
  assert.equal((await sql.consultar('SELECT * FROM efectos')).length, 2);
}

async function verificarPortal() {
  for (const error of [
    Object.assign(new Error('Deadlock found when trying to get lock'), { code: 'ER_LOCK_DEADLOCK' }),
    Object.assign(new Error('detalle privado'), { codigo: 'CONCURRENCIA_FEDERACION_AGOTADA' })
  ]) {
    let llamadas = 0;
    const controlador = new ControladorFederacion({ servicioAdministracionFederacion: {
      obtenerPanel() {},
      async sincronizarConcesion() { llamadas += 1; throw error; }
    } });
    const requisicion = { session: {}, params: { relacionId: 'relacion' } };
    await controlador.sincronizarConcesion(requisicion, {
      redirect(url) { assert.equal(url, '/federacion'); }
    });
    assert.equal(llamadas, 1, 'El controlador no repite toda la sincronización de red');
    assert.deepEqual(requisicion.session.flashFederacion, {
      tipo: 'error', mensaje: MENSAJE_CONCURRENCIA_FEDERACION
    });
  }
}

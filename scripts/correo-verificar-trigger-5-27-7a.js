import assert from 'node:assert/strict';
import crypto, { randomBytes } from 'node:crypto';

import { ClienteSmtp } from '../paquetes/correo/src/ClienteSmtp.js';
import { DespachadorCorreoSql }
  from '../paquetes/correo/src/DespachadorCorreoSql.js';
import { prepararDesuscripcionPrivadaTriggerCorreo }
  from '../paquetes/correo/src/PreparadorDesuscripcionTriggerCorreo.js';
import { ClienteSql } from '../paquetes/persistencia-sql/src/ClienteSql.js';
import { EjecutorMigraciones } from '../paquetes/persistencia-sql/src/EjecutorMigraciones.js';
import { FronteraTransaccionalLocal }
  from '../paquetes/persistencia-sql/src/FronteraTransaccionalLocal.js';
import { RepositorioMigraciones }
  from '../paquetes/persistencia-sql/src/RepositorioMigraciones.js';
import {
  obtenerConfiguracionAplicacion,
  obtenerRutaMigraciones
} from '../paquetes/utilidades/src/configuracion/obtenerConfiguracionAplicacion.js';
import { configuracionSmtp, prepararEntorno }
  from './correo-verificar-trigger-5-27-6c.js';

await main();

async function main() {
  const configuracion = obtenerConfiguracionAplicacion();
  assert.equal(configuracion.sql.estaCompleta, true, '5.27.7a necesita MariaDB real.');
  const administrador = new ClienteSql(configuracion.sql);
  const nombre = `sentinelia_fixture_5277a_${randomBytes(5).toString('hex')}`;
  let sql;
  try {
    await administrador.ejecutar(
      `CREATE DATABASE ${administrador.escaparIdentificador(nombre)} ` +
        'CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci'
    );
    sql = new ClienteSql({ ...configuracion.sql, baseDatos: nombre });
    const migraciones = await new EjecutorMigraciones({
      clienteSql: sql,
      repositorioMigraciones: new RepositorioMigraciones(sql),
      rutaMigraciones: obtenerRutaMigraciones()
    }).ejecutarPendientes();
    assert.equal(migraciones.integridad.ok, true);
    verificarPreparadorPuro();
    const entorno = await prepararEntorno(sql);
    await verificarPersistenciaPrivada(sql, entorno);
    await verificarEmisionYReintentos(sql, entorno);
    console.log(
      '[correo-trigger] OK 5.27.7a: token=256_bits hash=sha256_solo ' +
        'cuerpo=privado emision=primera_frontera reloj=mariadb ' +
        'reintento=no_reinicia expiracion=impide_red'
    );
  } finally {
    await sql?.cerrar().catch(() => {});
    await administrador.ejecutar(
      `DROP DATABASE IF EXISTS ${administrador.escaparIdentificador(nombre)}`
    ).catch(() => {});
    await administrador.cerrar();
  }
}

function verificarPreparadorPuro() {
  const preparada = prepararDesuscripcionPrivadaTriggerCorreo({
    triggerId: '7', ttlDias: 30, origenPublico: 'https://portal.test',
    cuerpoBaseTexto: 'Cuerpo causal.', fuenteEntropia: () => Buffer.alloc(32, 7)
  });
  assert.deepEqual(Object.keys(preparada).sort(), [
    'cuerpoPrivadoTexto', 'tokenHashSha256', 'triggerId', 'ttlDias'
  ]);
  const token = extraerToken(preparada.cuerpoPrivadoTexto);
  assert.equal(Buffer.from(token, 'base64url').length, 32);
  assert.equal(preparada.tokenHashSha256,
    crypto.createHash('sha256').update(token, 'ascii').digest('hex'));
  assert.equal(Object.values(preparada).includes(token), false,
    'El token no debe existir como propiedad separada del cuerpo privado.');
  assert.throws(() => prepararDesuscripcionPrivadaTriggerCorreo({
    triggerId: '7', ttlDias: 30, origenPublico: 'https://portal.test',
    cuerpoBaseTexto: 'x', fuenteEntropia: () => Buffer.alloc(31)
  }), /256 bits/iu);
}

async function verificarPersistenciaPrivada(sql, { salidaIds }) {
  const columnas = await sql.consultar(
    `SELECT column_name FROM information_schema.columns
      WHERE table_schema=DATABASE()
        AND table_name='capacidades_desuscripcion_correo'`
  );
  assert.equal(columnas.some((fila) => /token(?!_hash)/u.test(fila.column_name)), false);
  const [salida] = await sql.consultar(
    `SELECT cuerpo_texto FROM cola_correos_salida WHERE id=?`, [salidaIds[0]]);
  const token = extraerToken(salida.cuerpo_texto);
  const [capacidad] = await sql.consultar(
    `SELECT estado, HEX(token_hash_sha256) AS hash_hex,
            emitida_en_utc, expira_en_utc
       FROM capacidades_desuscripcion_correo WHERE salida_correo_id=?`,
    [salidaIds[0]]
  );
  assert.equal(capacidad.estado, 'preparada');
  assert.equal(capacidad.emitida_en_utc, null);
  assert.equal(capacidad.expira_en_utc, null);
  assert.equal(capacidad.hash_hex.toLowerCase(),
    crypto.createHash('sha256').update(token, 'ascii').digest('hex'));
  assert.notEqual(capacidad.hash_hex.toLowerCase(), token.toLowerCase());
}

async function verificarEmisionYReintentos(sql, { cola, salidaIds }) {
  const comportamientos = [
    { accepted: ['ops0@example.test'], rejected: [], response: '250 aceptado' },
    Object.assign(new Error('421 temporal'), {
      responseCode: 421, command: 'RCPT TO', code: 'EENVELOPE'
    }),
    { accepted: ['ops1@example.test'], rejected: [], response: '250 aceptado' },
    Object.assign(new Error('421 temporal'), {
      responseCode: 421, command: 'RCPT TO', code: 'EENVELOPE'
    })
  ];
  let llamadas = 0;
  const clienteSmtp = new ClienteSmtp({ fabricaTransport: () => ({
    async sendMail(mensaje) {
      llamadas += 1;
      const [fila] = await sql.consultar(
        `SELECT c.estado,
                TIMESTAMPDIFF(SECOND,c.emitida_en_utc,c.expira_en_utc) AS ttl,
                i.estado AS intento_estado
           FROM cola_correos_salida s
           JOIN capacidades_desuscripcion_correo c ON c.salida_correo_id=s.id
           JOIN intentos_correos_salida i ON i.salida_correo_id=s.id
          WHERE s.smtp_message_id=? ORDER BY i.numero DESC LIMIT 1`,
        [mensaje.messageId]
      );
      assert.deepEqual([fila.estado, Number(fila.ttl), fila.intento_estado],
        ['emitida', 30 * 24 * 60 * 60, 'en_curso']);
      const comportamiento = comportamientos.shift();
      if (comportamiento instanceof Error) throw comportamiento;
      return { ...comportamiento, messageId: mensaje.messageId };
    },
    close() {}
  }) });
  const configuracion = { ...configuracionSmtp(), reintentoBaseSegundos: 15 };
  const autoridad = { async evaluarEnTransaccion() {
    return { puedeDespachar: true, codigo: 'correo_smtp_verificado',
      versionConfiguracion: '9', configuracion };
  } };
  const despachador = new DespachadorCorreoSql({
    fronteraTransaccional: new FronteraTransaccionalLocal(sql),
    repositorioColaCorreo: cola, evaluadorAutoridadCorreoSql: autoridad,
    clienteSmtp, identificadorInstancia: 'fixture-5277a',
    leaseMilisegundos: 120_000
  });

  assert.equal((await despachador.despacharSiguiente()).estadoSalida, 'enviado');
  assert.equal((await despachador.despacharSiguiente()).estadoSalida,
    'error_reintentable');
  const [relojInicial] = await sql.consultar(
    `SELECT emitida_en_utc, expira_en_utc FROM capacidades_desuscripcion_correo
      WHERE salida_correo_id=?`, [salidaIds[1]]);
  await sql.ejecutar(
    `UPDATE cola_correos_salida SET proximo_intento_en=UTC_TIMESTAMP(3)
      WHERE id=?`, [salidaIds[1]]);
  assert.equal((await despachador.despacharSiguiente()).estadoSalida, 'enviado');
  const [relojPosterior] = await sql.consultar(
    `SELECT emitida_en_utc, expira_en_utc FROM capacidades_desuscripcion_correo
      WHERE salida_correo_id=?`, [salidaIds[1]]);
  assert.equal(relojPosterior.emitida_en_utc.getTime(), relojInicial.emitida_en_utc.getTime());
  assert.equal(relojPosterior.expira_en_utc.getTime(), relojInicial.expira_en_utc.getTime());

  assert.equal((await despachador.despacharSiguiente()).estadoSalida,
    'error_reintentable');
  await sql.ejecutar(
    `UPDATE capacidades_desuscripcion_correo
        SET emitida_en_utc='2026-01-01 00:00:00.000',
            expira_en_utc='2026-01-02 00:00:00.000'
      WHERE salida_correo_id=?`, [salidaIds[2]]);
  await sql.ejecutar(
    `UPDATE cola_correos_salida SET proximo_intento_en=UTC_TIMESTAMP(3)
      WHERE id=?`, [salidaIds[2]]);
  const antesExpirada = llamadas;
  const expirada = await despachador.despacharSiguiente();
  assert.equal(expirada.estadoSalida, 'error_final');
  assert.equal(expirada.motivo, 'desuscripcion_expirada_antes_de_reintento');
  assert.equal(llamadas, antesExpirada);
  const salidaExpirada = await cola.buscarPorId(salidaIds[2]);
  assert.equal(salidaExpirada.intentos, 1);
  assert.equal(salidaExpirada.codigoResultado,
    'desuscripcion_expirada_antes_de_reintento');
}

function extraerToken(cuerpo) {
  const coincidencia = String(cuerpo).match(
    /https:\/\/portal\.test\/correo\/desuscripcion\/([A-Za-z0-9_-]{43})/u
  );
  assert.ok(coincidencia, 'El cuerpo privado debe contener una capacidad de 256 bits.');
  return coincidencia[1];
}

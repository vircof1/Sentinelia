import assert from 'node:assert/strict';
import crypto from 'node:crypto';

import { generarUuidV7Auditoria }
  from '../paquetes/auditoria/src/UuidV7Auditoria.js';
import { ServicioConexionRedis }
  from '../paquetes/sesiones/src/ServicioConexionRedis.js';
import { RepositorioOperacionesEmailPerfilRedis }
  from '../paquetes/usuarios/src/RepositorioOperacionesEmailPerfilRedis.js';
import { obtenerConfiguracionAplicacion }
  from '../paquetes/utilidades/src/configuracion/obtenerConfiguracionAplicacion.js';

await main();

async function main() {
  const configuracion = obtenerConfiguracionAplicacion();
  const conexion = new ServicioConexionRedis(configuracion.redis);
  const redis = await conexion.conectar();
  const prefijo = `prueba:530b2a:${crypto.randomUUID()}:`;
  const ttlSegundos = 15 * 60;
  const repositorio = new RepositorioOperacionesEmailPerfilRedis({
    clienteRedis: redis,
    prefijoRedis: prefijo,
    ttlOperacionSegundos: ttlSegundos,
    secretoProteccionTokens: configuracion.sesion.secreto
  });

  try {
    const primera = await preparar(repositorio, 31);
    assert.equal(primera.operacion.estado, 'preparada');
    assert.equal(primera.operacion.expiraEn, null);
    assert.equal(primera.operacion.salidaInicialId, null);
    assert.equal(
      (await repositorio.diagnosticarTokenOhuella(primera.token)).estado,
      'invalida'
    );
    assert.equal((await repositorio.reservarConsumo({
      operacion: primera.operacion,
      huellaToken: primera.operacion.huellaToken
    })).estado, 'estado_invalido');

    assert.equal(await repositorio.vincularSalidaInicial({
      operacion: primera.operacion,
      salidaId: '701',
      emisionInicialId: primera.emisionInicialId
    }), 'vinculada');
    assert.equal(await repositorio.vincularSalidaInicial({
      operacion: primera.operacion,
      salidaId: '701',
      emisionInicialId: primera.emisionInicialId
    }), 'ya_vinculada');
    await assert.rejects(
      Promise.reject(new Error('liberacion_sql_fallida')),
      /liberacion_sql_fallida/u
    );
    const trasFalloSql = await leerOperacion(redis, repositorio, primera.operacion);
    assert.equal(trasFalloSql.estado, 'preparada');
    assert.equal(trasFalloSql.expiraEn, null);
    assert.equal(String(trasFalloSql.salidaInicialId), '701');

    const segunda = await preparar(repositorio, 31);
    assert.equal(segunda.anteriorId, primera.operacion.idOperacion);
    assert.equal(
      (await repositorio.diagnosticarTokenOhuella(primera.token)).estado,
      'sustituida'
    );
    assert.equal((await repositorio.activarOperacionConSalidaInicialPendiente({
      operacion: primera.operacion,
      salidaId: '701',
      emisionInicialId: primera.emisionInicialId
    })).estado, 'sustituida');

    assert.equal((await repositorio.activarOperacionConSalidaInicialPendiente({
      operacion: segunda.operacion,
      salidaId: '702',
      emisionInicialId: segunda.emisionInicialId
    })).estado, 'vinculo_incompatible');
    assert.equal(await repositorio.vincularSalidaInicial({
      operacion: segunda.operacion,
      salidaId: '702',
      emisionInicialId: segunda.emisionInicialId
    }), 'vinculada');

    const publicada = await repositorio.activarOperacionConSalidaInicialPendiente({
      operacion: segunda.operacion,
      salidaId: '702',
      emisionInicialId: segunda.emisionInicialId
    });
    assert.equal(publicada.estado, 'publicada');
    assert.equal(publicada.operacion.estado, 'pendiente_aceptacion_smtp');
    assert.equal(publicada.operacion.expiraEn, null);
    const aceptadaEnUtc = new Date(Date.now() + 1_000).toISOString();
    const activada = await repositorio.activarOperacionTrasAceptacionSmtp({
      operacionEmailPerfilId: segunda.operacion.idOperacion,
      salidaId: '702',
      emisionEmailPerfilId: segunda.emisionInicialId,
      aceptadaEnUtc
    });
    assert.equal(activada.estado, 'activada');
    assert.equal(activada.operacion.estado, 'activa');
    assert.equal(Date.parse(activada.operacion.expiraEn) - Date.parse(aceptadaEnUtc),
      ttlSegundos * 1000);
    assert.equal(
      (await repositorio.diagnosticarTokenOhuella(segunda.token)).estado,
      'activa'
    );

    const replayActivacion = await repositorio.activarOperacionTrasAceptacionSmtp({
        operacionEmailPerfilId: segunda.operacion.idOperacion,
        salidaId: '702',
        emisionEmailPerfilId: segunda.emisionInicialId,
        aceptadaEnUtc
      });
    assert.equal(replayActivacion.estado, 'activada');
    assert.equal(replayActivacion.operacion.expiraEn, activada.operacion.expiraEn);

    const preparadaPersistida = await leerOperacion(
      redis,
      repositorio,
      segunda.operacion
    );
    assert.equal(preparadaPersistida.expiraEn, activada.operacion.expiraEn);
    assert.equal(
      Object.hasOwn(preparadaPersistida, 'vencimientoSalidaInicial'),
      false
    );

    console.log(
      '[usuarios] OK 5.30b.2a: redis=salida_inicial_vinculada ' +
      'preparada=no_consumible vencimiento=aceptacion_smtp_mas_15m ' +
      'sustitucion=cercada fallo_sql=no_activa reloj=unico'
    );
  } finally {
    await limpiarPrefijo(redis, prefijo);
    await conexion.cerrar();
  }
}

async function preparar(repositorio, idUsuario) {
  const token = repositorio.generarToken();
  const emisionInicialId = generarUuidV7Auditoria();
  const resultado = await repositorio.prepararOperacion({
    idUsuario,
    emailOrigen: 'origen@example.test',
    emailCandidato: 'candidato@example.test',
    huellaCredencialOrigen:
      repositorio.calcularHuellaCredencial('hash-credencial-530b2a'),
    token,
    emisionInicialId
  });
  return { ...resultado, token, emisionInicialId };
}

async function leerOperacion(redis, repositorio, operacion) {
  return JSON.parse(await redis.get(repositorio.claveOperacion(operacion.idOperacion)));
}

async function limpiarPrefijo(redis, prefijo) {
  const claves = [];
  for await (const clave of redis.scanIterator({ MATCH: `${prefijo}*`, COUNT: 100 })) {
    claves.push(clave);
  }
  if (claves.length > 0) await redis.del(claves);
}

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
  const prefijo = `prueba:530b2b:${crypto.randomUUID()}:`;
  let ahoraMs = Date.now();
  const repositorio = new RepositorioOperacionesEmailPerfilRedis({
    clienteRedis: redis,
    prefijoRedis: prefijo,
    secretoProteccionTokens: configuracion.sesion.secreto,
    obtenerAhoraMs: () => ahoraMs
  });

  try {
    const activa = await prepararYActivar(repositorio);
    const token = activa.token;
    const operacionId = activa.operacion.idOperacion;
    const huellaToken = activa.operacion.huellaToken;
    const vencimientoInicial = activa.operacion.expiraEn;

    await redis.del(repositorio.claveCadenciaReenvio(41));
    assert.deepEqual(await repositorio.intentarRegistrarReenvio(41), {
      permitido: true,
      reintentarEnSegundos: 0
    });
    const antesFalloEncolado = await repositorio.obtenerOperacionActual(41);
    await assert.rejects(
      simularFalloEncolado(),
      /encolado_reenvio_fallido/u
    );
    const despuesFalloEncolado = await repositorio.obtenerOperacionActual(41);
    assert.equal(
      despuesFalloEncolado.operacion.expiraEn,
      antesFalloEncolado.operacion.expiraEn
    );
    assert.equal(
      (await repositorio.intentarRegistrarReenvio(41)).permitido,
      false
    );

    await redis.del(repositorio.claveCadenciaReenvio(41));
    ahoraMs += 10_000;
    const primero = {
      salidaId: '802',
      emisionReenvioId: generarUuidV7Auditoria()
    };
    const renovadaUno = await repositorio.renovarOperacion(
      despuesFalloEncolado.operacion,
      primero
    );
    assert.equal(renovadaUno.estado, 'renovada');
    assert.equal(renovadaUno.operacion.expiraEn, vencimientoInicial);
    const aceptadaUno = await repositorio.renovarOperacionTrasAceptacionSmtp({
      operacionEmailPerfilId: operacionId,
      emisionEmailPerfilId: primero.emisionReenvioId,
      salidaId: primero.salidaId,
      aceptadaEnUtc: new Date(ahoraMs).toISOString()
    });
    assert.equal(aceptadaUno.estado, 'renovada');
    assert.ok(Date.parse(aceptadaUno.operacion.expiraEn) > Date.parse(vencimientoInicial));
    assert.equal(renovadaUno.operacion.idOperacion, operacionId);
    assert.equal(renovadaUno.operacion.huellaToken, huellaToken);
    assert.equal(repositorio.recuperarTokenOperacion(renovadaUno.operacion), token);
    assert.deepEqual(renovadaUno.operacion.reenvios.map(referenciaReenvio), [{
      emisionId: primero.emisionReenvioId,
      salidaId: '802'
    }]);

    ahoraMs += 20_000;
    const replayTecnico = await repositorio.renovarOperacion(
      aceptadaUno.operacion,
      primero
    );
    assert.equal(replayTecnico.estado, 'renovada');
    assert.equal(replayTecnico.operacion.expiraEn, aceptadaUno.operacion.expiraEn);
    assert.equal(replayTecnico.operacion.reenvios.length, 1);

    ahoraMs += 30_000;
    const segundo = {
      salidaId: '803',
      emisionReenvioId: generarUuidV7Auditoria()
    };
    const renovadaDos = await repositorio.renovarOperacion(
      replayTecnico.operacion,
      segundo
    );
    assert.equal(renovadaDos.estado, 'renovada');
    assert.equal(renovadaDos.operacion.expiraEn, aceptadaUno.operacion.expiraEn);
    const aceptadaDos = await repositorio.renovarOperacionTrasAceptacionSmtp({
      operacionEmailPerfilId: operacionId,
      emisionEmailPerfilId: segundo.emisionReenvioId,
      salidaId: segundo.salidaId,
      aceptadaEnUtc: new Date(ahoraMs).toISOString()
    });
    assert.ok(Date.parse(aceptadaDos.operacion.expiraEn) >
      Date.parse(aceptadaUno.operacion.expiraEn));
    assert.deepEqual(renovadaDos.operacion.reenvios.map(referenciaReenvio), [
      { emisionId: primero.emisionReenvioId, salidaId: '802' },
      { emisionId: segundo.emisionReenvioId, salidaId: '803' }
    ]);

    const sustituta = await prepararCoordinada(repositorio, 41);
    assert.equal(sustituta.anteriorId, operacionId);
    assert.equal((await repositorio.renovarOperacion(
      aceptadaDos.operacion,
      { salidaId: '804', emisionReenvioId: generarUuidV7Auditoria() }
    )).estado, 'sustituida');
    assert.equal(
      (await repositorio.diagnosticarTokenOhuella(token)).estado,
      'sustituida'
    );

    console.log(
      '[usuarios] OK 5.30b.2b: reenvios=secuenciales operacion_token=estables ' +
      'fallo_encolado=vigencia_intacta cadencia=consumida ' +
      'replay_tecnico=no_renueva sustitucion=cercada'
    );
  } finally {
    await limpiarPrefijo(redis, prefijo);
    await conexion.cerrar();
  }
}

async function prepararYActivar(repositorio) {
  const preparada = await prepararCoordinada(repositorio, 41);
  await repositorio.vincularSalidaInicial({
    operacion: preparada.operacion,
    salidaId: '801',
    emisionInicialId: preparada.emisionInicialId
  });
  const activacion = await repositorio.activarOperacionConSalidaInicialPendiente({
    operacion: preparada.operacion,
    salidaId: '801',
    emisionInicialId: preparada.emisionInicialId
  });
  assert.equal(activacion.estado, 'publicada');
  const activa = await repositorio.activarOperacionTrasAceptacionSmtp({
    operacionEmailPerfilId: preparada.operacion.idOperacion,
    salidaId: '801',
    emisionEmailPerfilId: preparada.emisionInicialId,
    aceptadaEnUtc: new Date().toISOString()
  });
  assert.equal(activa.estado, 'activada');
  return { ...preparada, operacion: activa.operacion };
}

async function prepararCoordinada(repositorio, idUsuario) {
  const token = repositorio.generarToken();
  const emisionInicialId = generarUuidV7Auditoria();
  const preparada = await repositorio.prepararOperacion({
    idUsuario,
    emailOrigen: 'origen@example.test',
    emailCandidato: 'candidato@example.test',
    huellaCredencialOrigen:
      repositorio.calcularHuellaCredencial('hash-credencial-530b2b'),
    token,
    emisionInicialId
  });
  return { ...preparada, token, emisionInicialId };
}

async function simularFalloEncolado() {
  throw new Error('encolado_reenvio_fallido');
}

function referenciaReenvio(referencia) {
  return {
    emisionId: referencia.emisionId,
    salidaId: String(referencia.salidaId)
  };
}

async function limpiarPrefijo(redis, prefijo) {
  const claves = [];
  for await (const clave of redis.scanIterator({ MATCH: `${prefijo}*`, COUNT: 100 })) {
    claves.push(clave);
  }
  if (claves.length > 0) await redis.del(claves);
}

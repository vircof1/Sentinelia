import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';

import {
  RepositorioAdmisionRecuperacionPasswordRedis,
  RETENCION_MAXIMA_ADMISION_RECUPERACION_PASSWORD_SEGUNDOS
} from '../paquetes/usuarios/src/RepositorioAdmisionRecuperacionPasswordRedis.js';
import { ServicioAdmisionRecuperacionPasswordEmail }
  from '../paquetes/usuarios/src/ServicioAdmisionRecuperacionPasswordEmail.js';
import { ServicioConexionRedis }
  from '../paquetes/sesiones/src/ServicioConexionRedis.js';
import { obtenerConfiguracionAplicacion }
  from '../paquetes/utilidades/src/configuracion/obtenerConfiguracionAplicacion.js';

await main();

async function main() {
  const conexion = new ServicioConexionRedis(obtenerConfiguracionAplicacion().redis);
  const redis = await conexion.conectar();
  const prefijo = `sentinelia:fixture:5304b:${randomBytes(6).toString('hex')}:`;
  const repositorio = new RepositorioAdmisionRecuperacionPasswordRedis({
    clienteRedis: redis,
    prefijo,
    retencionMaximaSegundos: 60
  });
  try {
    await verificarParalelismoYPoliticaViva({ repositorio, redis, prefijo });
    await verificarServicioPowYResultadoPublico({ repositorio });
    await verificarFalloCerrado();
    assert.equal(RETENCION_MAXIMA_ADMISION_RECUPERACION_PASSWORD_SEGUNDOS, 86_400);
    console.log('[usuarios] OK 5.30.4b: ventanas=atomicas reloj=redis pow=comun politica=viva claves=opacas fallo=cerrado');
  } finally {
    const claves = await redis.keys(`${prefijo}*`);
    if (claves.length) await redis.del(claves);
    await conexion.cerrar();
  }
}

async function verificarParalelismoYPoliticaViva({ repositorio, redis, prefijo }) {
  const politica = crearPolitica({ origenMaximo: 2, parMaximo: 20, globalMaximo: 20 });
  const resultados = await Promise.all(Array.from({ length: 5 }, () =>
    repositorio.registrarIntento({
      buzonCanonico: 'persona@example.test',
      origenRed: '198.51.100.9',
      configuracion: politica
    })));
  assert.equal(resultados.filter((resultado) => resultado.admitida).length, 2);
  assert.deepEqual(resultados.map((resultado) => resultado.conteos.origen)
    .sort((a, b) => a - b), [1, 2, 3, 4, 5]);

  const ampliada = crearPolitica({ origenMaximo: 6, parMaximo: 20, globalMaximo: 20 });
  const sexta = await repositorio.registrarIntento({
    buzonCanonico: 'persona@example.test', origenRed: '198.51.100.9',
    configuracion: ampliada
  });
  assert.equal(sexta.admitida, true);
  assert.equal(sexta.conteos.origen, 6);
  const reducida = crearPolitica({ origenMaximo: 5, parMaximo: 20, globalMaximo: 20 });
  assert.equal((await repositorio.registrarIntento({
    buzonCanonico: 'otra@example.test', origenRed: '198.51.100.9',
    configuracion: reducida
  })).admitida, false);

  const claves = await redis.keys(`${prefijo}*`);
  assert.equal(claves.length, 4);
  assert.ok(claves.every((clave) => !clave.includes('persona@example.test')));
  assert.ok(claves.every((clave) => !clave.includes('198.51.100.9')));
  const ttls = await Promise.all(claves.map((clave) => redis.ttl(clave)));
  assert.ok(ttls.every((ttl) => ttl > 0 && ttl <= 60));
}

async function verificarServicioPowYResultadoPublico({ repositorio }) {
  const llamadas = [];
  const servicioPow = {
    emitirDesafio: async (entrada) => ({ activo: true, entrada }),
    validarEntrega: async (entrada) => {
      llamadas.push(entrada);
      return entrada.idDesafio === 'valido'
        ? { exito: true }
        : { exito: false, codigo: 'pow_invalido', mensaje: 'PoW inválido' };
    }
  };
  let politica = crearPolitica({ origenMaximo: 100, parMaximo: 1, globalMaximo: 100 });
  const configuracionPortal = {
    obtenerConfiguracionUsuarios: () => politica
  };
  const servicio = new ServicioAdmisionRecuperacionPasswordEmail({
    servicioPow,
    repositorioAdmision: repositorio,
    servicioConfiguracionPortal: {
      asegurarActualizada: async () => configuracionPortal,
      obtenerConfiguracionActual: () => configuracionPortal
    }
  });
  const desafio = await servicio.emitirDesafio({
    origenRed: '::ffff:203.0.113.8', hashrateCliente: 123
  });
  assert.equal(desafio.entrada.ip, '203.0.113.8');

  const rechazoPow = await servicio.admitir({
    buzonCanonico: 'pow@example.test', origenRed: '203.0.113.8',
    entregaPow: { idDesafio: 'invalido' }
  });
  assert.equal(rechazoPow.alcanzoAdmision, false);

  // El resultado puede abandonarse: la observación ya quedó incorporada en Redis.
  await servicio.admitir({
    buzonCanonico: 'pow@example.test', origenRed: '203.0.113.8',
    entregaPow: { idDesafio: 'valido', nonce: 1 }
  });
  const saturadaA = await servicio.admitir({
    buzonCanonico: 'pow@example.test', origenRed: '203.0.113.8',
    entregaPow: { idDesafio: 'valido', nonce: 2 }
  });
  const saturadaB = await servicio.admitir({
    buzonCanonico: 'pow@example.test', origenRed: '203.0.113.8',
    entregaPow: { idDesafio: 'valido', nonce: 3 }
  });
  assert.equal(saturadaA.resultadoPublico.estadoHttp, 429);
  assert.deepEqual(saturadaA.resultadoPublico, saturadaB.resultadoPublico);
  assert.ok(llamadas.every((entrada) => entrada.ip === '203.0.113.8'));

  politica = crearPolitica({ origenMaximo: 100, parMaximo: 100, globalMaximo: 100 });
  assert.equal((await servicio.admitir({
    buzonCanonico: 'pow@example.test', origenRed: '203.0.113.8',
    entregaPow: { idDesafio: 'valido', nonce: 4 }
  })).admitida, true);
}

async function verificarFalloCerrado() {
  const repositorio = new RepositorioAdmisionRecuperacionPasswordRedis({
    clienteRedis: { eval: async () => { throw new Error('redis caído'); } }
  });
  await assert.rejects(() => repositorio.registrarIntento({
    buzonCanonico: 'fallo@example.test',
    origenRed: '192.0.2.4',
    configuracion: crearPolitica({})
  }), /redis caído/u);
}

function crearPolitica({ origenMaximo = 10, parMaximo = 10, globalMaximo = 10 } = {}) {
  return {
    recuperacionEmailOrigenVentanaSegundos: 30,
    recuperacionEmailOrigenIntentosMaximos: origenMaximo,
    recuperacionEmailParVentanaSegundos: 30,
    recuperacionEmailParIntentosMaximos: parMaximo,
    recuperacionEmailGlobalVentanaSegundos: 30,
    recuperacionEmailGlobalIntentosMaximos: globalMaximo
  };
}

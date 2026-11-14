import assert from 'node:assert/strict';

import { ServicioPreparacionEmisionRecuperacionPasswordEmail }
  from '../paquetes/usuarios/src/ServicioPreparacionEmisionRecuperacionPasswordEmail.js';

await main();

async function main() {
  await verificarPreparacionCompleta();
  await verificarAusenciaDeIdentidades();
  await verificarFallosCerrados();
  console.log('[usuarios] OK 5.30.5a: fotografia=sql frontera=completa bearer=redis salida=preparada enlace=canonico tiempos=no_inventados fallos=cerrados');
}

async function verificarPreparacionCompleta() {
  const fixture = crearFixture();
  const resultado = await fixture.servicio.preparar({
    buzon: ' Persona@EXAMPLE.TEST ',
    direccionIp: '::ffff:203.0.113.17'
  });
  assert.equal(resultado.preparada, true);
  assert.equal(resultado.resultado, 'preparada');
  assert.equal(resultado.buzonCanonico, 'Persona@example.test');
  assert.deepEqual(resultado.frontera.miembros.map((miembro) => miembro.usuarioId),
    ['2', '11']);
  assert.ok(Object.isFrozen(resultado.frontera));
  assert.equal(fixture.redis.preparaciones.length, 1);
  assert.equal(fixture.correo.salidas.length, 1);
  const redis = fixture.redis.preparaciones[0];
  const salida = fixture.correo.salidas[0];
  assert.equal(redis.token, resultado.token);
  assert.equal(redis.eventoConsumoId, resultado.eventoConsumoId);
  assert.equal(redis.presupuestoMaximo, 5);
  assert.equal(redis.leaseSegundos, 60);
  assert.equal(salida.direccionIpOrigen, '203.0.113.17');
  assert.deepEqual(salida.usuariosJustificantesIds, ['2', '11']);
  assert.match(salida.smtpMessageId, /^<[0-9a-f]{64}@sentinelia\.example>$/u);
  assert.match(salida.asunto, /^\[Sentinelia Test\]/u);
  assert.match(salida.materialPreparacion.enlaceRecuperacion,
    /^https:\/\/sentinelia\.example\/recuperacion-password\?token=/u);
  assert.ok(salida.materialPreparacion.enlaceRecuperacion.includes(
    encodeURIComponent(resultado.token)
  ));
  assert.match(salida.materialPreparacion.cuerpoPlantilla, /\{\{emitidaEnUtc\}\}/u);
  assert.match(salida.materialPreparacion.cuerpoPlantilla, /\{\{expiraEnUtc\}\}/u);
  assert.ok(!salida.asunto.includes(resultado.token));
  assert.equal(fixture.redis.descartes.length, 0);
}

async function verificarAusenciaDeIdentidades() {
  const fixture = crearFixture({ miembros: [] });
  const resultado = await fixture.servicio.preparar({
    buzon: 'nadie@example.test', direccionIp: '192.0.2.7'
  });
  assert.equal(resultado.preparada, false);
  assert.equal(resultado.resultado, 'sin_identidades');
  assert.equal(fixture.redis.preparaciones.length, 0);
  assert.equal(fixture.correo.salidas.length, 0);
}

async function verificarFallosCerrados() {
  const redisCaido = crearFixture({ falloRedis: true });
  await assert.rejects(() => redisCaido.servicio.preparar({
    buzon: 'persona@example.test', direccionIp: '198.51.100.4'
  }), /redis no disponible/u);
  assert.equal(redisCaido.correo.salidas.length, 0);

  const sqlCaido = crearFixture({ falloCorreo: true });
  await assert.rejects(() => sqlCaido.servicio.preparar({
    buzon: 'persona@example.test', direccionIp: '198.51.100.5'
  }), /sql no disponible/u);
  assert.equal(sqlCaido.redis.preparaciones.length, 1);
  assert.equal(sqlCaido.redis.descartes.length, 1);
  assert.equal(sqlCaido.redis.descartes[0].token,
    sqlCaido.redis.preparaciones[0].token);

  const lecturaCaida = crearFixture({ falloFotografia: true });
  await assert.rejects(() => lecturaCaida.servicio.preparar({
    buzon: 'persona@example.test', direccionIp: '198.51.100.6'
  }), /fotografía no disponible/u);
  assert.equal(lecturaCaida.redis.preparaciones.length, 0);

  await assert.rejects(() => crearFixture().servicio.preparar({
    buzon: 'persona@example.test', direccionIp: 'no-es-ip'
  }), /direccionIp/u);
}

function crearFixture({
  miembros = [
    { usuarioId: '11', generacionRecuperacion: '8' },
    { usuarioId: '2', generacionRecuperacion: '3' }
  ],
  falloRedis = false,
  falloCorreo = false,
  falloFotografia = false
} = {}) {
  const redis = {
    preparaciones: [],
    descartes: [],
    generarToken: () => 'bearer_ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789abcd',
    async preparar(entrada) {
      if (falloRedis) throw new Error('redis no disponible');
      this.preparaciones.push(entrada);
      return { estado: 'preparada' };
    },
    async descartarPreparacion(entrada) {
      this.descartes.push(entrada);
      return true;
    }
  };
  const correo = {
    salidas: [],
    async crearSalidaPreparadaEnTransaccion(entrada) {
      if (falloCorreo) throw new Error('sql no disponible');
      this.salidas.push(entrada);
      return { salida: { id: '91' }, creada: true };
    }
  };
  const configuracion = {
    obtenerConfiguracionUsuarios: () => ({
      recuperacionEmailAlegacionesMaximas: 5,
      recuperacionEmailLeasePreparacionSegundos: 60,
      recuperacionEmailVigenciaSegundos: 1200
    }),
    obtenerOrigenPublicoPortal: () => 'https://sentinelia.example',
    obtenerNombreVisiblePortal: () => 'Sentinelia Test'
  };
  const servicio = new ServicioPreparacionEmisionRecuperacionPasswordEmail({
    repositorioUsuarios: {
      async listarFronteraElegibleRecuperacionPorBuzonEnTransaccion() {
        if (falloFotografia) throw new Error('fotografía no disponible');
        return miembros;
      }
    },
    repositorioSolicitudes: redis,
    repositorioCoordinacionCorreo: correo,
    fronteraTransaccional: {
      async ejecutar(trabajo) {
        return trabajo({
          query: async () => [[{ ahora_utc: new Date('2026-09-06T10:00:00.123Z') }]]
        });
      }
    },
    servicioConfiguracionPortal: {
      asegurarActualizada: async () => configuracion,
      obtenerConfiguracionActual: () => configuracion
    },
    propietarioProceso: 'fixture-5.30.5a'
  });
  return { servicio, redis, correo };
}

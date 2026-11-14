import assert from 'node:assert/strict';

import { CoordinadorEmisionesRecuperacionPasswordRuntime }
  from '../apps/sentinelia-runtime/src/correo/CoordinadorEmisionesRecuperacionPasswordRuntime.js';
import { generarUuidV7Auditoria }
  from '../paquetes/auditoria/src/UuidV7Auditoria.js';
import { PERFIL_PREPARACION_CORREO_RECUPERACION_PASSWORD }
  from '../paquetes/usuarios/src/ServicioPreparacionEmisionRecuperacionPasswordEmail.js';

await main();

async function main() {
  await verificarConvergenciaAcotada();
  await verificarDescarteSinRedis();
  await verificarFalloCerrado();
  console.log('[usuarios] OK 5.30.5c: runtime=lote_sql lease=redis concurrencia=skip-locked convergencia=liberar|descartar fallo=cerrado');
}

async function verificarConvergenciaAcotada() {
  const fixture = crearFixture({ cantidad: 3, loteMaximo: 2 });
  const resultado = await fixture.coordinador.procesarPendientes({
    origen: 'prueba', numeroTick: 7
  });
  assert.equal(resultado.totalProcesadas, 2);
  assert.equal(resultado.totalLiberadas, 2);
  assert.equal(resultado.totalDescartadas, 0);
  assert.equal(fixture.repositorio.pendientes.length, 1,
    'el lote de correo limita también la convergencia');
  assert.equal(fixture.activacion.entradas[0].materialPreparacion.vigenciaSegundos,
    1200, 'se usa la vigencia fotografiada, no la configuración viva');
  assert.equal(fixture.configuracion.recargas, 1);
}

async function verificarDescarteSinRedis() {
  const fixture = crearFixture({ cantidad: 1, estadoRedis: 'ausente' });
  const resultado = await fixture.coordinador.procesarPendientes();
  assert.equal(resultado.totalDescartadas, 1);
  assert.equal(fixture.repositorio.eliminadas.length, 1);
  assert.equal(fixture.repositorio.pendientes.length, 0);
}

async function verificarFalloCerrado() {
  const fixture = crearFixture({ cantidad: 1, estadoRedis: 'caido' });
  await assert.rejects(() => fixture.coordinador.procesarPendientes(),
    /redis no disponible/u);
  assert.equal(fixture.repositorio.eliminadas.length, 0,
    'una avería no demuestra extinción y no permite destruir SQL');
  assert.equal(fixture.repositorio.pendientes.length, 1);
}

function crearFixture({ cantidad = 1, loteMaximo = 3,
  estadoRedis = 'activada' } = {}) {
  const pendientes = Array.from({ length: cantidad }, (_, indice) =>
    crearPreparacion(indice + 1));
  const repositorio = {
    pendientes,
    eliminadas: [],
    async seleccionarSiguientePreparacionEnTransaccion() {
      return this.pendientes[0] || null;
    },
    async eliminarPreparacionHuerfanaEnTransaccion(entrada) {
      this.eliminadas.push(entrada);
      this.pendientes.shift();
      return { eliminada: true };
    }
  };
  const activacion = {
    entradas: [],
    async activarYLiberarEnTransaccion(entrada) {
      this.entradas.push(entrada);
      if (estadoRedis === 'caido') throw new Error('redis no disponible');
      if (estadoRedis !== 'activada') {
        const error = new Error(`Redis no pudo activar: ${estadoRedis}`);
        error.codigo = 'activacion_redis_no_disponible';
        error.estadoRedis = estadoRedis;
        throw error;
      }
      repositorio.pendientes.shift();
      return {
        emitidaEnUtc: '2026-09-06T12:00:00.000Z',
        expiraEnUtc: '2026-09-06T12:20:00.000Z'
      };
    }
  };
  const configuracion = {
    recargas: 0,
    async asegurarActualizada() { this.recargas += 1; }
  };
  return {
    repositorio,
    activacion,
    configuracion,
    coordinador: new CoordinadorEmisionesRecuperacionPasswordRuntime({
      servicioConfiguracionPortal: configuracion,
      servicioCorreoPortal: {
        obtenerConfiguracionCorreoActual: () => ({ runtimeLoteMaximo: loteMaximo })
      },
      repositorioCoordinacionCorreo: repositorio,
      servicioActivacion: activacion,
      fronteraTransaccional: { ejecutar: (trabajo) => trabajo({ execute() {} }) }
    })
  };
}

function crearPreparacion(indice) {
  const ids = Array.from({ length: 4 }, () => generarUuidV7Auditoria());
  const token = `bearer_${String(indice).padStart(2, '0')}_ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789`;
  return Object.freeze({
    salidaId: String(100 + indice),
    solicitudId: ids[0],
    eventoEmisionId: ids[1],
    buzonCanonico: `persona${indice}@example.test`,
    direccionIp: '203.0.113.17',
    asunto: '[Sentinelia] Recuperación de contraseña',
    materialPreparacion: {
      perfil: PERFIL_PREPARACION_CORREO_RECUPERACION_PASSWORD,
      version: 1,
      token,
      cuerpoPlantilla:
        'Emitida {{emitidaEnUtc}}. Expira {{expiraEnUtc}}. ' +
        `https://sentinelia.example/recuperacion-password?token=${token}`,
      operacionId: ids[3],
      propietario: 'fixture-5.30.5c',
      eventoConsumoId: ids[2],
      vigenciaSegundos: 1200
    }
  });
}

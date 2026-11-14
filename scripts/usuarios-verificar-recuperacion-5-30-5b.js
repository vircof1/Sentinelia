import assert from 'node:assert/strict';

import { generarUuidV7Auditoria }
  from '../paquetes/auditoria/src/UuidV7Auditoria.js';
import { ServicioActivacionEmisionRecuperacionPasswordEmail }
  from '../paquetes/usuarios/src/ServicioActivacionEmisionRecuperacionPasswordEmail.js';
import { PERFIL_PREPARACION_CORREO_RECUPERACION_PASSWORD }
  from '../paquetes/usuarios/src/ServicioPreparacionEmisionRecuperacionPasswordEmail.js';

const EMITIDA = '2026-09-06T10:00:00.123Z';
const EXPIRA = '2026-09-06T10:20:00.123Z';

await main();

async function main() {
  await verificarActivacionYLiberacion();
  await verificarRepeticionEstable();
  await verificarFronterasDeFallo();
  console.log('[usuarios] OK 5.30.5b: reloj=redis cuerpo=fechado sql=salida+auditoria atomico replay=estable fallo=convergente');
}

async function verificarActivacionYLiberacion() {
  const fixture = crearFixture();
  const resultado = await fixture.servicio.activarYLiberar(fixture.preparacion);
  assert.equal(resultado.estado, 'emitida');
  assert.equal(resultado.emitidaEnUtc, EMITIDA);
  assert.equal(resultado.expiraEnUtc, EXPIRA);
  assert.equal(fixture.redis.llamadas.length, 1);
  assert.equal(fixture.sql.llamadas.length, 1);
  const llamada = fixture.sql.llamadas[0];
  assert.match(llamada.cuerpoTexto, new RegExp(EMITIDA.replaceAll('.', '\\.')));
  assert.match(llamada.cuerpoTexto, new RegExp(EXPIRA.replaceAll('.', '\\.')));
  assert.match(llamada.cuerpoTexto, /token=bearer_/u);
  assert.ok(!llamada.cuerpoTexto.includes('{{'));
  assert.equal(llamada.intencionAuditoria.eventoId,
    fixture.preparacion.eventoEmisionId);
  assert.equal(llamada.intencionAuditoria.efectivoEnUtc, EMITIDA);
  assert.equal(llamada.intencionAuditoria.payload.direccionIp, '203.0.113.17');
  assert.equal(llamada.intencionAuditoria.payload.buzonCanonico,
    'persona@example.test');
}

async function verificarRepeticionEstable() {
  const fixture = crearFixture({ estadoActivacion: 'repetida' });
  const primera = await fixture.servicio.activarYLiberar(fixture.preparacion);
  const segunda = await fixture.servicio.activarYLiberar(fixture.preparacion);
  assert.equal(primera.emitidaEnUtc, segunda.emitidaEnUtc);
  assert.equal(fixture.sql.llamadas[0].cuerpoTexto,
    fixture.sql.llamadas[1].cuerpoTexto);
  assert.equal(fixture.sql.llamadas[0].intencionAuditoria.eventoId,
    fixture.sql.llamadas[1].intencionAuditoria.eventoId);
}

async function verificarFronterasDeFallo() {
  const redisFalla = crearFixture({ estadoActivacion: 'ausente' });
  await assert.rejects(() => redisFalla.servicio.activarYLiberar(
    redisFalla.preparacion
  ), /Redis no pudo activar/u);
  assert.equal(redisFalla.sql.llamadas.length, 0);

  const sqlFalla = crearFixture({ falloSql: true });
  await assert.rejects(() => sqlFalla.servicio.activarYLiberar(
    sqlFalla.preparacion
  ), /commit sql desconocido/u);
  assert.equal(sqlFalla.redis.llamadas.length, 1);
  assert.equal(sqlFalla.redis.descartes, 0,
    'una activación autoritativa no se compensa ni mueve su reloj');

  const plantillaRota = crearFixture();
  plantillaRota.preparacion.materialPreparacion.cuerpoPlantilla = 'sin tiempos';
  await assert.rejects(() => plantillaRota.servicio.activarYLiberar(
    plantillaRota.preparacion
  ), /fronteras temporales/u);
  assert.equal(plantillaRota.sql.llamadas.length, 0);
}

function crearFixture({ estadoActivacion = 'activada', falloSql = false } = {}) {
  const ids = Array.from({ length: 4 }, () => generarUuidV7Auditoria());
  const materialPreparacion = {
    perfil: PERFIL_PREPARACION_CORREO_RECUPERACION_PASSWORD,
    version: 1,
    token: 'bearer_ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789abcd',
    enlaceRecuperacion:
      'https://sentinelia.example/recuperacion-password?token=bearer_ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789abcd',
    cuerpoPlantilla:
      'Se solicitó recuperar una contraseña el {{emitidaEnUtc}}.\n' +
      'La solicitud caduca el {{expiraEnUtc}} (UTC).\n\n' +
      'Continúa: https://sentinelia.example/recuperacion-password?token=bearer_ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789abcd',
    operacionId: ids[3],
    propietario: 'fixture-5.30.5b',
    eventoConsumoId: ids[2],
    vigenciaSegundos: 1200
  };
  const preparacion = {
    resultado: 'preparada',
    preparada: true,
    solicitudId: ids[0],
    eventoEmisionId: ids[1],
    eventoConsumoId: ids[2],
    operacionId: ids[3],
    token: materialPreparacion.token,
    salidaId: '91',
    buzonCanonico: 'persona@example.test',
    direccionIp: '203.0.113.17',
    asunto: '[Sentinelia] Recuperación de contraseña',
    materialPreparacion
  };
  const redis = {
    llamadas: [],
    descartes: 0,
    async activar(entrada) {
      this.llamadas.push(entrada);
      return estadoActivacion === 'ausente'
        ? { estado: 'ausente' }
        : { estado: estadoActivacion, emitidaEnUtc: EMITIDA, expiraEnUtc: EXPIRA };
    }
  };
  const sql = {
    llamadas: [],
    async completarSalidaPreparadaEnTransaccion(entrada) {
      this.llamadas.push(entrada);
      if (falloSql) throw new Error('commit sql desconocido');
      return { salida: { id: '91', estado: 'pendiente' },
        auditoria: { incorporados: 1 } };
    }
  };
  return {
    preparacion,
    redis,
    sql,
    servicio: new ServicioActivacionEmisionRecuperacionPasswordEmail({
      repositorioSolicitudes: redis,
      repositorioCoordinacionCorreo: sql,
      fronteraTransaccional: { ejecutar: (trabajo) => trabajo({}) }
    })
  };
}

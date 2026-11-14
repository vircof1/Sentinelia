import assert from 'node:assert/strict';

import { ServicioConvergenciaConsumoRecuperacionPasswordEmail }
  from '../paquetes/usuarios/src/ServicioConvergenciaConsumoRecuperacionPasswordEmail.js';
import { generarUuidV7Auditoria }
  from '../paquetes/auditoria/src/UuidV7Auditoria.js';
import { obtenerCausaAvisoPlataforma }
  from '../paquetes/avisos-plataforma/src/CatalogoAvisosPlataforma.js';

await main();

async function main() {
  assert.deepEqual(obtenerCausaAvisoPlataforma({
    tipoCodigo: 'consistencia',
    causaCodigo: 'recuperacion_password_convergencia_redis'
  }), {
    versionCatalogo: 1,
    tipoCodigo: 'consistencia',
    causaCodigo: 'recuperacion_password_convergencia_redis',
    gravedadInicial: 'advertencia',
    admiteResolucionAdministrativa: false
  });
  await verificarConvergenciaCompleta();
  await verificarFalloEfimeroConAviso();
  await verificarResultadoSqlIndeterminado();
  console.log('[usuarios] OK 5.30.6c: consumo=terminal sesiones=sincronizadas sql_indeterminado=testigo aviso=agregado credencial=exito_durable');
}

async function verificarConvergenciaCompleta() {
  const fixture = crearFixture();
  const resultado = await fixture.servicio.sustituirYConverger({
    token: 'bearer_fixture'
  });
  assert.equal(resultado.estado, 'sustituida');
  assert.equal(resultado.convergencia, 'completa');
  assert.equal(fixture.solicitudes.consumos, 1);
  assert.deepEqual(fixture.sesiones.llamadas, [['7', '8']]);
  assert.equal(fixture.avisos.resoluciones.length, 1);
}

async function verificarFalloEfimeroConAviso() {
  const fixture = crearFixture({ falloConsumo: true, falloSesiones: true });
  const resultado = await fixture.servicio.sustituirYConverger({
    token: 'bearer_fixture'
  });
  assert.equal(resultado.estado, 'sustituida',
    'una caída postcommit no desmiente el cambio durable');
  assert.equal(resultado.convergencia, 'pendiente');
  assert.deepEqual(resultado.fallos.map(({ componente }) => componente),
    ['autoridad_recuperacion', 'sesiones']);
  assert.equal(fixture.avisos.detecciones.length, 1);
  assert.equal(fixture.avisos.detecciones[0].claveCausal.causaCodigo,
    'recuperacion_password_convergencia_redis');
  assert.equal('token' in fixture.avisos.detecciones[0].contextoHumano, false);
}

async function verificarResultadoSqlIndeterminado() {
  const confirmado = crearFixture({ errorSql: true, testigoConfirma: true });
  const resultado = await confirmado.servicio.sustituirYConverger({
    token: 'bearer_fixture'
  });
  assert.equal(resultado.convergencia, 'completa');
  assert.equal(confirmado.sustitucion.consultasTestigo, 1);

  const noConfirmado = crearFixture({ errorSql: true, testigoConfirma: false });
  await assert.rejects(() => noConfirmado.servicio.sustituirYConverger({
    token: 'bearer_fixture'
  }), /commit sql desconocido/u);
  assert.equal(noConfirmado.solicitudes.consumos, 0);
}

function crearFixture({ falloConsumo = false, falloSesiones = false,
  errorSql = false, testigoConfirma = true } = {}) {
  const eventoConsumoId = generarUuidV7Auditoria();
  const resultado = {
    estado: 'sustituida', sustituida: true, usuarioId: '7',
    versionSesion: '8', generacionRecuperacion: '4',
    eventoConsumoId, reservaId: generarUuidV7Auditoria(),
    propietario: 'fixture-5.30.6c',
    scope: { tenantId: '2', empresaId: null, sitioId: null }
  };
  const error = new Error('commit sql desconocido');
  const sustitucion = {
    consultasTestigo: 0,
    async sustituir() { if (errorSql) throw error; return resultado; },
    async resolverResultadoIndeterminado(recibido) {
      assert.equal(recibido, error);
      this.consultasTestigo += 1;
      return testigoConfirma ? { ...resultado, estado: 'ya_sustituida' }
        : { estado: 'no_confirmada', sustituida: false };
    }
  };
  const solicitudes = {
    consumos: 0,
    async consumir() {
      this.consumos += 1;
      if (falloConsumo) throw new Error('redis caído');
      return { estado: 'consumida' };
    }
  };
  const sesiones = {
    llamadas: [],
    async invalidarSesionesUsuario(usuarioId, versionSesion) {
      this.llamadas.push([usuarioId, versionSesion]);
      if (falloSesiones) throw new Error('proyección redis caída');
      return { sesionesEliminadas: 2, versionSesion: Number(versionSesion) };
    }
  };
  const avisos = {
    detecciones: [], resoluciones: [],
    async detectar(entrada) { this.detecciones.push(entrada); return {}; },
    async resolver(entrada) { this.resoluciones.push(entrada); return {}; }
  };
  return {
    sustitucion, solicitudes, sesiones, avisos,
    servicio: new ServicioConvergenciaConsumoRecuperacionPasswordEmail({
      servicioSustitucion: sustitucion,
      repositorioSolicitudes: solicitudes,
      servicioSesion: sesiones,
      servicioAvisosPlataforma: avisos,
      actorRuntimeId: 'fixture-5.30.6c'
    })
  };
}

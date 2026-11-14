import assert from 'node:assert/strict';

import { ConfiguracionPortal } from '../paquetes/configuracion/src/ConfiguracionPortal.js';
import { ServicioConfiguracionPortal }
  from '../paquetes/configuracion/src/ServicioConfiguracionPortal.js';
import { obtenerDefinicionesConfiguracionPortal }
  from '../paquetes/configuracion/src/obtenerDefinicionesConfiguracionPortal.js';
import {
  ErrorCompatibilidadRecuperacionPasswordEmail
} from '../paquetes/usuarios/src/ProveedorCompatibilidadRecuperacionPasswordEmail.js';
import { obtenerConfiguracionAplicacion }
  from '../paquetes/utilidades/src/configuracion/obtenerConfiguracionAplicacion.js';

const CLAVES = Object.freeze([
  ['usuarios.recuperacion_email_activa', 'false', null, null],
  ['usuarios.recuperacion_email_vigencia_segundos', 1200, 300, 86400],
  ['usuarios.recuperacion_email_alegaciones_maximas', 5, 1, 20],
  ['usuarios.recuperacion_email_origen_ventana_segundos', 900, 60, 86400],
  ['usuarios.recuperacion_email_origen_intentos_maximos', 10, 1, 1000],
  ['usuarios.recuperacion_email_par_ventana_segundos', 1200, 60, 86400],
  ['usuarios.recuperacion_email_par_intentos_maximos', 3, 1, 100],
  ['usuarios.recuperacion_email_global_ventana_segundos', 60, 1, 3600],
  ['usuarios.recuperacion_email_global_intentos_maximos', 120, 1, 100000],
  ['usuarios.recuperacion_email_jitter_maximo_ms', 100, 0, 2000],
  ['usuarios.recuperacion_email_lease_preparacion_segundos', 60, 10, 600],
  ['usuarios.recuperacion_email_lease_alegacion_segundos', 30, 5, 300],
  ['usuarios.recuperacion_email_lease_consumo_segundos', 90, 10, 600]
]);

await main();

async function main() {
  const todas = obtenerDefinicionesConfiguracionPortal(
    obtenerConfiguracionAplicacion()
  );
  const definiciones = todas.filter(({ clave }) =>
    clave === 'usuarios.password_longitud_minima' ||
    clave.startsWith('usuarios.recuperacion_email_')
  );
  verificarCatalogo(definiciones);
  verificarProyeccionYFotografias(definiciones);
  await verificarServicioCerradoYVersionado(definiciones);
  console.log(
    '[usuarios] OK 5.30.1c: claves=13 defaults=prudentes ' +
    'intencion=deshabilitada compatibilidad=cerrada version=sql_redis ' +
    'fotografias=solicitud_lease_peticion_runtime disponibilidad=no_persistida'
  );
}

function verificarCatalogo(definiciones) {
  const recuperacion = definiciones.filter(({ clave }) =>
    clave.startsWith('usuarios.recuperacion_email_')
  );
  assert.equal(recuperacion.length, 13);
  for (const [clave, valorPorDefecto, minimo, maximo] of CLAVES) {
    const definicion = recuperacion.find((item) => item.clave === clave);
    assert.ok(definicion, clave);
    assert.equal(definicion.valorPorDefecto, valorPorDefecto);
    assert.equal(definicion.minimo ?? null, minimo);
    assert.equal(definicion.maximo ?? null, maximo);
    assert.equal(definicion.requerido, true);
  }
}

function verificarProyeccionYFotografias(definiciones) {
  const valores = new Map(definiciones.map(({ clave, valorPorDefecto }) => [
    clave, String(valorPorDefecto)
  ]));
  const portal = new ConfiguracionPortal({ definiciones, valoresPersistidos: valores, version: 1 });
  const configuracion = portal.obtenerConfiguracionUsuarios();
  assert.equal(configuracion.recuperacionEmailActiva, false);
  assert.equal(configuracion.recuperacionEmailVigenciaSegundos, 1200);
  assert.equal(configuracion.recuperacionEmailAlegacionesMaximas, 5);
  assert.equal(configuracion.recuperacionEmailLeasePreparacionSegundos, 60);
  assert.equal(configuracion.recuperacionEmailLeaseAlegacionSegundos, 30);
  assert.equal(configuracion.recuperacionEmailLeaseConsumoSegundos, 90);

  const fotografias = Object.freeze({
    solicitud: Object.freeze({
      vigenciaSegundos: configuracion.recuperacionEmailVigenciaSegundos,
      alegacionesMaximas: configuracion.recuperacionEmailAlegacionesMaximas
    }),
    lease: Object.freeze({
      preparacionSegundos: configuracion.recuperacionEmailLeasePreparacionSegundos,
      alegacionSegundos: configuracion.recuperacionEmailLeaseAlegacionSegundos,
      consumoSegundos: configuracion.recuperacionEmailLeaseConsumoSegundos
    }),
    peticion: Object.freeze({ jitterMaximoMs: configuracion.recuperacionEmailJitterMaximoMs }),
    runtime: Object.freeze({
      ventanaGlobalSegundos: configuracion.recuperacionEmailGlobalVentanaSegundos
    })
  });
  valores.set('usuarios.recuperacion_email_vigencia_segundos', '1800');
  valores.set('usuarios.recuperacion_email_lease_consumo_segundos', '120');
  assert.equal(fotografias.solicitud.vigenciaSegundos, 1200);
  assert.equal(fotografias.lease.consumoSegundos, 90);
}

async function verificarServicioCerradoYVersionado(definiciones) {
  const fixture = crearFixture(definiciones);
  const bootstrap = await fixture.servicio.bootstrapYcargar();
  assert.equal(bootstrap.clavesCreadas.length, definiciones.length);
  assert.equal(
    bootstrap.configuracionPortal.obtenerConfiguracionUsuarios()
      .recuperacionEmailActiva,
    false
  );
  const versionAntes = fixture.estado.version;
  await assert.rejects(
    () => fixture.servicio.actualizarValor({
      clave: 'usuarios.recuperacion_email_activa',
      valor: 'true',
      contextoUsuarioActual: contexto()
    }),
    (error) =>
      error instanceof ErrorCompatibilidadRecuperacionPasswordEmail &&
      error.estadoHttp === 409 &&
      error.codigo === 'recuperacion_password_email_no_compatible'
  );
  assert.equal(fixture.estado.version, versionAntes);
  assert.equal(fixture.estado.valores.get('usuarios.recuperacion_email_activa'), 'false');

  const cambio = await fixture.servicio.actualizarValor({
    clave: 'usuarios.recuperacion_email_vigencia_segundos',
    valor: '1800',
    contextoUsuarioActual: contexto()
  });
  assert.equal(cambio.cambioEfectivo, true);
  assert.equal(cambio.version, versionAntes + 1);
  assert.equal(fixture.estado.versionRedis, versionAntes + 1);
  assert.equal(
    fixture.servicio.obtenerConfiguracionActual().obtenerConfiguracionUsuarios()
      .recuperacionEmailVigenciaSegundos,
    1800
  );
  assert.equal(fixture.estado.eventos.at(-1).tipo, 'configuracion.portal_actualizada');

  await assert.rejects(
    () => fixture.servicio.actualizarValor({
      clave: 'usuarios.recuperacion_email_alegaciones_maximas',
      valor: '21',
      contextoUsuarioActual: contexto()
    }),
    /menor o igual a 20/iu
  );
}

function crearFixture(definiciones) {
  const estado = {
    valores: new Map(),
    version: 1,
    versionRedis: null,
    eventos: []
  };
  const repositorio = {
    async sincronizarDefinicionesEnTransaccion(catalogo) {
      const creadas = [];
      for (const definicion of catalogo) {
        if (estado.valores.has(definicion.clave)) continue;
        const valor = String(definicion.valorPorDefecto ?? '');
        estado.valores.set(definicion.clave, valor);
        creadas.push({ clave: definicion.clave, valor });
      }
      return creadas;
    },
    async bloquearValorEnTransaccion(clave) {
      return estado.valores.has(clave)
        ? { clave, valor: estado.valores.get(clave) }
        : null;
    },
    async actualizarValorEnTransaccion(clave, valor) {
      estado.valores.set(clave, valor);
    },
    async obtenerVersionEnTransaccion() { return estado.version; },
    async incrementarVersionEnTransaccion() { estado.version += 1; return estado.version; },
    async cargarValores() { return new Map(estado.valores); }
  };
  const versionador = {
    async obtenerVersionActual() { return estado.versionRedis; },
    async publicarVersion(version) { estado.versionRedis = Number(version); return Number(version); }
  };
  const servicio = new ServicioConfiguracionPortal({
    repositorioConfiguracion: repositorio,
    versionadorConfiguracionRedis: versionador,
    definiciones,
    fronteraTransaccional: { async ejecutar(trabajo) { return trabajo({ execute() {} }); } },
    servicioAuditoria: {
      async registrarEnTransaccion({ intencion }) { estado.eventos.push(intencion); }
    },
    ahora: () => new Date('2026-09-06T12:00:00.000Z')
  });
  return { servicio, estado };
}

function contexto() {
  return {
    idUsuario: 7,
    idUsuarioReal: 7,
    nivelScope: 'portal',
    permisos: { administrarConfiguracion: true }
  };
}

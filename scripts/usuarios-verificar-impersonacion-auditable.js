import assert from 'node:assert/strict';
import { ServicioSesion } from '../paquetes/sesiones/src/ServicioSesion.js';
import { validarEventoAuditableV1 } from '../paquetes/auditoria/src/ValidadorContratoAuditoria.js';

async function main() {
  await verificarInicioDurableAuditable();
  await verificarFinalDurableAuditable();
  await verificarFallbackLegacySinDurable();

  console.log(
    '[usuarios] OK 5.21.8f: impersonacion=durable eventos=contrato causalidad=final_a_inicio scope=efectivo save=posterior'
  );
}

async function verificarInicioDurableAuditable() {
  const llamadas = [];
  const durable = new DurableFake({
    llamadas,
    sesion: sesionDurableDirecta()
  });
  const servicio = crearServicio(durable);
  const requisicion = requisicionFixture();
  const usuarioReal = usuarioFixture({ id: 1, tenantId: null, versionSesion: 4 });
  const usuarioEfectivo = usuarioFixture({
    id: 2,
    usuario: 'operador.impersonado',
    nombre: 'Operador Impersonado',
    tenantId: 9,
    empresaId: 10,
    sitioId: 11,
    versionSesion: 7
  });

  await servicio.iniciarImpersonacionUsuario(requisicion, {
    usuarioReal,
    usuarioEfectivo
  });

  assert.deepEqual(llamadas, ['validar', 'iniciar']);
  assert.deepEqual(requisicion._llamadas, ['save']);
  assert.equal(requisicion.session.usuarioAutenticado.idUsuarioReal, 1);
  assert.equal(requisicion.session.usuarioAutenticado.idUsuarioEfectivo, 2);
  assert.equal(requisicion.session.usuarioAutenticado.impersonacionActiva, true);
  assert.deepEqual(durable.inicio.scopeEfectivoActual, {
    tenantId: '9',
    empresaId: '10',
    sitioId: '11'
  });
  const intencion = durable.inicio.intencionAuditoria;
  assert.equal(intencion.tipo, 'usuario.impersonacion_iniciada');
  assert.equal(intencion.actorReal.id, '1');
  assert.equal(intencion.actorEfectivo.id, '2');
  assert.equal(intencion.modoActuacion, 'impersonado');
  assert.equal(intencion.scope.tenantId, '9');
  validarEventoAuditableV1({
    tipo: intencion.tipo,
    actor: intencion.actorReal.tipo,
    origen: intencion.origen,
    sujeto: intencion.sujeto,
    flujo: intencion.flujo,
    productor: intencion.productor,
    rolEvento: intencion.rolEvento,
    payload: intencion.payload
  });
}

async function verificarFinalDurableAuditable() {
  const llamadas = [];
  const durable = new DurableFake({
    llamadas,
    sesion: sesionDurableImpersonada()
  });
  const servicio = crearServicio(durable);
  const requisicion = requisicionFixture({
    usuarioAutenticado: {
      idUsuario: 2,
      idUsuarioEfectivo: 2,
      usuario: 'operador.impersonado',
      usuarioEfectivo: 'operador.impersonado',
      nombreVisible: 'Operador Impersonado',
      nombreVisibleEfectivo: 'Operador Impersonado',
      versionSesion: 7,
      versionSesionEfectiva: 7,
      idUsuarioReal: 1,
      usuarioReal: 'admin',
      nombreVisibleReal: 'Admin',
      versionSesionReal: 4,
      impersonacionActiva: true,
      tenantId: 9,
      empresaId: 10,
      sitioId: 11,
      tokenCSRF: 'csrf'
    }
  });
  const usuarioReal = usuarioFixture({ id: 1, versionSesion: 4 });

  await servicio.revertirImpersonacionUsuario(requisicion, usuarioReal);

  assert.deepEqual(llamadas, ['validar', 'finalizar']);
  assert.deepEqual(requisicion._llamadas, ['save']);
  assert.equal(requisicion.session.usuarioAutenticado.idUsuarioReal, 1);
  assert.equal(requisicion.session.usuarioAutenticado.idUsuarioEfectivo, 1);
  assert.equal(requisicion.session.usuarioAutenticado.impersonacionActiva, false);
  const intencion = durable.fin.intencionAuditoria;
  assert.equal(intencion.tipo, 'usuario.impersonacion_finalizada');
  assert.equal(intencion.actorReal.id, '1');
  assert.equal(intencion.actorEfectivo.id, '2');
  assert.equal(intencion.scope.tenantId, '9');
  assert.deepEqual(intencion.causalidad, {
    tipo: 'evento_auditoria',
    id: '01980000-0000-7000-8000-0000000000aa'
  });
  assert.deepEqual(durable.fin.scopeEfectivoActual, {
    tenantId: null,
    empresaId: null,
    sitioId: null
  });
  validarEventoAuditableV1({
    tipo: intencion.tipo,
    actor: intencion.actorReal.tipo,
    origen: intencion.origen,
    sujeto: intencion.sujeto,
    flujo: intencion.flujo,
    productor: intencion.productor,
    rolEvento: intencion.rolEvento,
    payload: intencion.payload
  });
}

async function verificarFallbackLegacySinDurable() {
  const servicio = crearServicio(null);
  const requisicion = requisicionFixture();
  await servicio.iniciarImpersonacionUsuario(requisicion, {
    usuarioReal: usuarioFixture({ id: 1, versionSesion: 4 }),
    usuarioEfectivo: usuarioFixture({ id: 3, versionSesion: 5 })
  });
  assert.equal(requisicion.session.usuarioAutenticado.idUsuarioEfectivo, 3);
  assert.equal(requisicion.session.usuarioAutenticado.impersonacionActiva, true);
}

function crearServicio(servicioSesionesWebDurables) {
  const valoresRedis = new Map();
  const servicio = new ServicioSesion({
    clienteRedis: {
      async set(clave, valor, opciones = {}) {
        if (opciones?.NX && valoresRedis.has(clave)) return null;
        valoresRedis.set(clave, String(valor));
        return 'OK';
      },
      async get(clave) {
        return valoresRedis.get(clave) ?? null;
      },
      async del() {}
    },
    configuracionSesion: {},
    configuracionRedis: {},
    servicioSesionesWebDurables
  });
  servicio.guardarSesionExpress = async (requisicion) => {
    requisicion._llamadas.push('save');
  };
  return servicio;
}

class DurableFake {
  constructor({ llamadas, sesion }) {
    this.llamadas = llamadas;
    this.sesion = sesion;
  }

  async validar(storeId) {
    assert.equal(storeId, 'store-auditable');
    this.llamadas.push('validar');
    return { storeId, sesion: this.sesion, datosStore: {} };
  }

  async iniciarImpersonacion(storeId, datos) {
    assert.equal(storeId, 'store-auditable');
    this.llamadas.push('iniciar');
    this.inicio = datos;
    return { storeId, proyeccion: { sesionAuditoriaId: this.sesion.sesionAuditoriaId } };
  }

  async finalizarImpersonacion(storeId, datos) {
    assert.equal(storeId, 'store-auditable');
    this.llamadas.push('finalizar');
    this.fin = datos;
    return { storeId, proyeccion: { sesionAuditoriaId: this.sesion.sesionAuditoriaId } };
  }

  async cerrar() {
    this.llamadas.push('cerrar');
  }
}

function requisicionFixture({
  usuarioAutenticado = {
    idUsuario: 1,
    idUsuarioEfectivo: 1,
    usuario: 'admin',
    usuarioEfectivo: 'admin',
    nombreVisible: 'Admin',
    nombreVisibleEfectivo: 'Admin',
    versionSesion: 4,
    versionSesionEfectiva: 4,
    idUsuarioReal: 1,
    usuarioReal: 'admin',
    nombreVisibleReal: 'Admin',
    versionSesionReal: 4,
    impersonacionActiva: false,
    tenantId: null,
    empresaId: null,
    sitioId: null,
    tokenCSRF: 'csrf'
  }
} = {}) {
  return {
    _llamadas: [],
    session: {
      sesionWebAuditable: { storeId: 'store-auditable' },
      usuarioAutenticado,
      tokenCSRF: usuarioAutenticado.tokenCSRF,
      save(callback) {
        this._guardada = true;
        callback();
      }
    }
  };
}

function usuarioFixture({
  id,
  usuario = 'admin',
  nombre = 'Admin',
  versionSesion = 1,
  tenantId = null,
  empresaId = null,
  sitioId = null
}) {
  return {
    id,
    usuario,
    versionSesion,
    tenantId,
    empresaId,
    sitioId,
    obtenerNombreVisible: () => nombre
  };
}

function sesionDurableDirecta() {
  return {
    sesionAuditoriaId: '01980000-0000-7000-8000-000000000001',
    usuarioRealId: '1',
    usuarioEfectivoId: '1',
    versionSesionReal: 4,
    versionSesionEfectiva: 4,
    scopeApertura: { tenantId: null, empresaId: null, sitioId: null },
    scopeEfectivoActual: { tenantId: null, empresaId: null, sitioId: null },
    eventoImpersonacionIniciadaId: null
  };
}

function sesionDurableImpersonada() {
  return {
    sesionAuditoriaId: '01980000-0000-7000-8000-000000000001',
    usuarioRealId: '1',
    usuarioEfectivoId: '2',
    versionSesionReal: 4,
    versionSesionEfectiva: 7,
    scopeApertura: { tenantId: null, empresaId: null, sitioId: null },
    scopeEfectivoActual: { tenantId: '9', empresaId: '10', sitioId: '11' },
    eventoImpersonacionIniciadaId: '01980000-0000-7000-8000-0000000000aa'
  };
}

main().catch((error) => {
  console.error('[usuarios] Falló la verificación de impersonación auditable.');
  console.error(error);
  process.exit(1);
});

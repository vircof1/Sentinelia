import assert from 'node:assert/strict';
import { ServicioTriggers } from '../paquetes/triggers/src/ServicioTriggers.js';
import { ValidadorTrigger } from '../paquetes/triggers/src/ValidadorTrigger.js';
import { Trigger } from '../paquetes/triggers/src/Trigger.js';
import { AsignacionTriggerMonitor } from '../paquetes/triggers/src/AsignacionTriggerMonitor.js';
import {
  validarEventoAuditableV1,
  validarParMovimientoAuditoriaV1
} from '../paquetes/auditoria/src/ValidadorContratoAuditoria.js';
import { prepararIntencionAuditoriaV1 } from '../paquetes/auditoria/src/HuellaIntencionAuditoria.js';

async function main() {
  await verificarCrudTriggerAuditable();
  await verificarAltaTriggerDnsAuditable();
  await verificarMovimientoScopeTriggerAuditable();
  await verificarCrudBindingAuditable();
  await verificarImpersonacionTriggerAuditable();

  console.log(
    '[triggers] OK 5.21.11a: triggers=crud_auditable bindings=crud_auditable noop=sin_ruido scope=movimiento ejecuciones=excluidas impersonacion=contrato'
  );
}

async function verificarAltaTriggerDnsAuditable() {
  const entorno = crearEntorno();

  await entorno.servicio.crearTrigger(datosTriggerDns(), {
    contextoUsuarioActual: contextoPortal()
  });

  assert.deepEqual(entorno.traza, [
    'begin',
    'sql:crear-trigger:dns',
    'audit:trigger.creado:principal',
    'commit'
  ]);
  assert.deepEqual(entorno.auditoria.eventos[0].payload.despues.configuracion, {
    zonaId: 30,
    registroId: 40,
    operacionDns: 'seguir_estado_monitor',
    valorPrincipal: null,
    rolGobernanza: 'operaciones:dns'
  });
}

async function verificarCrudTriggerAuditable() {
  const entorno = crearEntorno();

  await entorno.servicio.crearTrigger(datosTriggerApi(), {
    contextoUsuarioActual: contextoPortal()
  });

  assert.deepEqual(entorno.traza, [
    'begin',
    'sql:crear-trigger:api',
    'audit:trigger.creado:principal',
    'commit'
  ]);
  assert.equal(entorno.auditoria.eventos[0].tipo, 'trigger.creado');
  assert.deepEqual(entorno.auditoria.eventos[0].payload.despues.configuracion, {
    metodo: 'POST',
    timeoutMs: 1000,
    reintentos: 1,
    permiteTlsInseguro: false,
    parametroOpcional: null
  });
  assertSinEjecuciones(entorno.auditoria.eventos[0].payload);

  entorno.traza.length = 0;
  entorno.auditoria.eventos.length = 0;
  await entorno.servicio.actualizarTrigger(100, datosTriggerApi({
    nombre: 'Webhook operaciones crítico',
    activo: '0',
    revisionDeclaracion: 1
  }), { contextoUsuarioActual: contextoPortal() });

  assert.deepEqual(entorno.traza, [
    'begin',
    'sql:actualizar-trigger:api',
    'audit:trigger.actualizado:principal',
    'commit'
  ]);
  const actualizacion = entorno.auditoria.eventos[0];
  assert.equal(actualizacion.tipo, 'trigger.actualizado');
  assert.deepEqual(actualizacion.payload.camposCambiados, ['activo', 'nombre']);

  entorno.traza.length = 0;
  entorno.auditoria.eventos.length = 0;
  await entorno.servicio.actualizarTrigger(100, datosTriggerApi({
    nombre: 'Webhook operaciones crítico',
    activo: '0',
    revisionDeclaracion: 2
  }), { contextoUsuarioActual: contextoPortal() });
  assert.deepEqual(entorno.traza, []);
  assert.equal(entorno.auditoria.eventos.length, 0);

  entorno.traza.length = 0;
  await entorno.servicio.eliminarTrigger(100, {
    contextoUsuarioActual: contextoPortal(),
    revisionDeclaracion: 2
  });
  assert.deepEqual(entorno.traza, [
    'begin',
    'sql:eliminar-trigger',
    'audit:trigger.eliminado:principal',
    'commit'
  ]);
  assert.equal(entorno.auditoria.eventos.at(-1).tipo, 'trigger.eliminado');
}

async function verificarMovimientoScopeTriggerAuditable() {
  const entorno = crearEntorno();
  entorno.triggers.set(100, triggerFixture({ id: 100, sitioId: null }));

  await entorno.servicio.actualizarTrigger(100, datosTriggerApi({
    sitioId: 3,
    nombre: 'Webhook operaciones',
    revisionDeclaracion: 1
  }), { contextoUsuarioActual: contextoPortal() });

  assert.deepEqual(entorno.traza, [
    'begin',
    'sql:actualizar-trigger:api',
    'audit:trigger.actualizado:principal',
    'audit-mov:scope.entidad_salida/scope.entidad_entrada',
    'commit'
  ]);
  const [actualizacion, salida, entrada] = entorno.auditoria.eventos;
  assert.equal(actualizacion.tipo, 'trigger.actualizado');
  assert.deepEqual(actualizacion.payload.camposCambiados, ['sitioId']);
  assert.equal(salida.tipo, 'scope.entidad_salida');
  assert.equal(entrada.tipo, 'scope.entidad_entrada');
  assert.deepEqual(salida.payload.scopePropio, {
    tenantId: '1',
    empresaId: '2',
    sitioId: null
  });
  assert.deepEqual(entrada.payload.scopePropio, {
    tenantId: '1',
    empresaId: '2',
    sitioId: '3'
  });
}

async function verificarCrudBindingAuditable() {
  const entorno = crearEntorno();
  entorno.triggers.set(100, triggerFixture({ id: 100 }));

  await entorno.servicio.crearAsignacionMonitorTrigger(datosBinding(), {
    contextoUsuarioActual: contextoPortal()
  });

  assert.deepEqual(entorno.traza, [
    'begin',
    'sql:crear-binding',
    'audit:trigger.binding_creado:principal',
    'commit'
  ]);
  assert.equal(entorno.auditoria.eventos[0].tipo, 'trigger.binding_creado');
  assert.deepEqual(entorno.auditoria.eventos[0].payload.despues, {
    triggerId: '100',
    monitorId: '200',
    activo: true,
    orden: 10,
    eventosDisparo: ['apertura_alerta'],
    configuracion: {}
  });
  assertSinEjecuciones(entorno.auditoria.eventos[0].payload);

  entorno.traza.length = 0;
  entorno.auditoria.eventos.length = 0;
  await entorno.servicio.actualizarAsignacionMonitorTrigger(500, datosBinding({
    ordenEjecucion: 20,
    eventosDisparo: ['apertura_alerta', 'cierre_alerta']
  }), { contextoUsuarioActual: contextoPortal() });

  assert.deepEqual(entorno.traza, [
    'begin',
    'sql:actualizar-binding',
    'audit:trigger.binding_actualizado:principal',
    'commit'
  ]);
  const actualizacion = entorno.auditoria.eventos[0];
  assert.equal(actualizacion.tipo, 'trigger.binding_actualizado');
  assert.deepEqual(actualizacion.payload.camposCambiados, [
    'eventosDisparo',
    'orden'
  ]);

  entorno.traza.length = 0;
  await entorno.servicio.eliminarAsignacionMonitorTrigger(500, {
    contextoUsuarioActual: contextoPortal()
  });
  assert.deepEqual(entorno.traza, [
    'begin',
    'sql:eliminar-binding',
    'audit:trigger.binding_eliminado:principal',
    'commit'
  ]);
  assert.equal(entorno.auditoria.eventos.at(-1).tipo, 'trigger.binding_eliminado');
}

async function verificarImpersonacionTriggerAuditable() {
  const entorno = crearEntorno();

  await entorno.servicio.crearTrigger(datosTriggerApi({
    nombre: 'Webhook impersonado'
  }), {
    contextoUsuarioActual: contextoPortalImpersonado()
  });

  const evento = entorno.auditoria.eventos[0];
  assert.equal(evento.tipo, 'trigger.creado');
  assert.equal(evento.modoActuacion, 'impersonado');
  assert.deepEqual(evento.actorReal, { tipo: 'usuario', id: '7' });
  assert.deepEqual(evento.actorEfectivo, { tipo: 'usuario', id: '11' });
}

function crearEntorno() {
  const traza = [];
  const auditoria = {
    eventos: [],
    async registrarEnTransaccion({ intencion }, { conexion } = {}) {
      assert.ok(conexion);
      validarEventoAuditableV1(intencion);
      prepararIntencionAuditoriaV1(intencion);
      traza.push(`audit:${intencion.tipo}:${intencion.rolEvento}`);
      this.eventos.push(intencion);
      return { evento: intencion, estado: 'incorporado' };
    },
    async registrarMovimientoEnTransaccion({ salida, entrada }, { conexion } = {}) {
      assert.ok(conexion);
      validarParMovimientoAuditoriaV1(salida, entrada);
      prepararIntencionAuditoriaV1(salida);
      prepararIntencionAuditoriaV1(entrada);
      traza.push(`audit-mov:${salida.tipo}/${entrada.tipo}`);
      this.eventos.push(salida, entrada);
      return { eventos: [salida, entrada], estado: 'incorporado' };
    }
  };
  const entorno = {
    traza,
    auditoria,
    triggers: new Map(),
    bindings: new Map()
  };
  const repositorioTriggers = {
    async buscarPorId(id) {
      return entorno.triggers.get(Number(id)) || null;
    },
    async buscarPorNombreEnScope({ nombre, tenantId, empresaId, sitioId }) {
      return [...entorno.triggers.values()].find((trigger) =>
        trigger.nombre === nombre &&
        Number(trigger.tenantId) === Number(tenantId) &&
        Number(trigger.empresaId) === Number(empresaId) &&
        normalizarNulo(trigger.sitioId) === normalizarNulo(sitioId)
      ) || null;
    },
    async crear(definicion, { conexion } = {}) {
      assert.ok(conexion);
      traza.push(`sql:crear-trigger:${definicion.tipo}`);
      const trigger = triggerFixture({ id: 100, ...definicion });
      entorno.triggers.set(100, trigger);
      return trigger;
    },
    async actualizar({ idTrigger, revisionDeclaracion, ...definicion }, { conexion } = {}) {
      assert.ok(conexion);
      traza.push(`sql:actualizar-trigger:${definicion.tipo}`);
      const trigger = triggerFixture({
        id: idTrigger,
        ...definicion,
        revisionDeclaracion: revisionDeclaracion + 1
      });
      entorno.triggers.set(Number(idTrigger), trigger);
      return trigger;
    },
    async eliminar(idTrigger, { conexion } = {}) {
      assert.ok(conexion);
      traza.push('sql:eliminar-trigger');
      return entorno.triggers.delete(Number(idTrigger));
    }
  };
  const repositorioAsignacionesTriggerMonitor = {
    async listarPorMonitorId(monitorId) {
      return [...entorno.bindings.values()]
        .filter((binding) => Number(binding.monitorId) === Number(monitorId));
    },
    async buscarPorId(id) {
      return entorno.bindings.get(Number(id)) || null;
    },
    async crear(definicion, { conexion } = {}) {
      assert.ok(conexion);
      traza.push('sql:crear-binding');
      const binding = bindingFixture({ id: 500, ...definicion });
      entorno.bindings.set(500, binding);
      return binding;
    },
    async actualizar({ idAsignacion, ...definicion }, { conexion } = {}) {
      assert.ok(conexion);
      traza.push('sql:actualizar-binding');
      const binding = bindingFixture({ id: idAsignacion, ...definicion });
      entorno.bindings.set(Number(idAsignacion), binding);
      return binding;
    },
    async eliminar(idAsignacion, { conexion } = {}) {
      assert.ok(conexion);
      traza.push('sql:eliminar-binding');
      return entorno.bindings.delete(Number(idAsignacion));
    }
  };
  const fronteraTransaccional = {
    async ejecutar(trabajo) {
      traza.push('begin');
      const resultado = await trabajo({ id: 'conexion-fake' });
      traza.push('commit');
      return resultado;
    }
  };
  entorno.servicio = new ServicioTriggers({
    repositorioTriggers,
    repositorioAsignacionesTriggerMonitor,
    repositorioMonitores: {
      async buscarPorId(id) {
        assert.equal(Number(id), 200);
        return monitorFixture();
      }
    },
    validadorTrigger: new ValidadorTrigger(),
    fronteraTransaccional,
    servicioAuditoria: auditoria,
    ahora: () => new Date('2026-07-25T10:00:00.000Z')
  });
  return entorno;
}

function datosTriggerApi({
  nombre = 'Webhook operaciones',
  activo = '1',
  sitioId = null,
  revisionDeclaracion = undefined
} = {}) {
  return {
    tenantId: 1,
    empresaId: 2,
    sitioId,
    nombre,
    tipo: 'api',
    descripcion: 'Notifica a operaciones',
    activo,
    ...(revisionDeclaracion === undefined ? {} : { revisionDeclaracion }),
    url: 'https://hooks.example.test/incidente',
    metodo: 'POST',
    timeoutMs: 1000,
    reintentos: 1,
    permiteTlsInseguro: false
  };
}

function datosTriggerDns() {
  return {
    tenantId: 1,
    empresaId: 2,
    sitioId: null,
    nombre: 'Oscilador DNS gobernado',
    tipo: 'dns',
    descripcion: 'Sigue el estado consolidado del monitor',
    activo: '1',
    zonaId: 30,
    registroId: 40,
    operacion: 'seguir_estado_monitor',
    valorPrincipal: null,
    rolGobernanza: 'operaciones:dns'
  };
}

function datosBinding({
  ordenEjecucion = 10,
  eventosDisparo = ['apertura_alerta']
} = {}) {
  return {
    monitorId: 200,
    triggerId: 100,
    activo: true,
    ordenEjecucion,
    eventosDisparo,
    configuracionOverride: null
  };
}

function triggerFixture(datos = {}) {
  const configuracion = datos.configuracion?.serializar
    ? datos.configuracion.serializar()
    : datos.configuracion;
  return new Trigger({
    id: 100,
    tenant_id: 1,
    empresa_id: 2,
    sitio_id: null,
    nombre: 'Webhook operaciones',
    tipo: 'api',
    descripcion: 'Notifica a operaciones',
    activo: 1,
    configuracion: configuracion || {
      url: 'https://hooks.example.test/incidente',
      metodo: 'POST',
      timeoutMs: 1000,
      reintentos: 1,
      permiteTlsInseguro: false
    },
    ...aFilaTrigger(datos)
  });
}

function bindingFixture(datos = {}) {
  return new AsignacionTriggerMonitor({
    id: 500,
    monitor_id: 200,
    trigger_id: 100,
    activo: 1,
    orden_ejecucion: 10,
    eventos_disparo: JSON.stringify(['apertura_alerta']),
    configuracion_override: null,
    monitor_nombre: 'Ping API',
    monitor_tipo: 'ping',
    monitor_activo: 1,
    tenant_id: 1,
    empresa_id: 2,
    sitio_id: null,
    trigger_nombre: 'Webhook operaciones',
    trigger_tipo: 'api',
    trigger_activo: 1,
    ...aFilaBinding(datos)
  });
}

function monitorFixture() {
  return {
    id: 200,
    serializarResumen() {
      return { id: 200, nombre: 'Ping API' };
    }
  };
}

function contextoPortal() {
  return {
    idUsuario: 7,
    idUsuarioReal: 7,
    nivelScope: 'portal',
    tenantId: 1,
    empresaId: 2,
    sitioId: null
  };
}

function contextoPortalImpersonado() {
  return {
    ...contextoPortal(),
    idUsuario: 11,
    idUsuarioReal: 7,
    impersonacionActiva: true
  };
}

function aFilaTrigger(datos) {
  const fila = {};
  for (const [origen, destino] of [
    ['id', 'id'],
    ['tenantId', 'tenant_id'],
    ['empresaId', 'empresa_id'],
    ['sitioId', 'sitio_id'],
    ['nombre', 'nombre'],
    ['tipo', 'tipo'],
    ['descripcion', 'descripcion'],
    ['activo', 'activo'],
    ['revisionDeclaracion', 'revision_declaracion']
  ]) {
    if (Object.hasOwn(datos, origen)) {
      fila[destino] = datos[origen];
    }
  }
  if (Object.hasOwn(datos, 'configuracion')) {
    fila.configuracion = datos.configuracion?.serializar
      ? datos.configuracion.serializar()
      : datos.configuracion;
  }
  return fila;
}

function aFilaBinding(datos) {
  const fila = {};
  for (const [origen, destino] of [
    ['id', 'id'],
    ['monitorId', 'monitor_id'],
    ['triggerId', 'trigger_id'],
    ['activo', 'activo'],
    ['ordenEjecucion', 'orden_ejecucion']
  ]) {
    if (Object.hasOwn(datos, origen)) {
      fila[destino] = datos[origen];
    }
  }
  if (Object.hasOwn(datos, 'eventosDisparo')) {
    fila.eventos_disparo = JSON.stringify(datos.eventosDisparo);
  }
  if (Object.hasOwn(datos, 'configuracionOverride')) {
    fila.configuracion_override = datos.configuracionOverride == null
      ? null
      : JSON.stringify(datos.configuracionOverride);
  }
  return fila;
}

function normalizarNulo(valor) {
  return valor == null ? null : Number(valor);
}

function assertSinEjecuciones(payload) {
  const serializado = JSON.stringify(payload);
  for (const prohibido of [
    'payloadSolicitud',
    'payloadRespuesta',
    'payloadError',
    'codigoResultado',
    'mensajeResultado',
    'ejecucion'
  ]) {
    assert.equal(
      serializado.includes(prohibido),
      false,
      `El payload auditable no debe contener ${prohibido}.`
    );
  }
}

main().catch((error) => {
  console.error('[triggers] Error verificando administración auditable 5.21.11a');
  console.error(error);
  process.exit(1);
});

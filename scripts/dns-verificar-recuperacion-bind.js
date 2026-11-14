import assert from 'node:assert/strict';
import { ServicioRecuperacionBindDns } from '../paquetes/dns/src/ServicioRecuperacionBindDns.js';

async function verificarReintentos() {
  const trazas = [];
  const repositorio = new RepositorioRecuperacionFixture({ trazas });
  const servicio = new ServicioRecuperacionBindDns({ repositorioCoordinacion: repositorio });
  assert.deepEqual(await servicio.planificarReintentoReconciliacion(), {
    accion: 'reintento_creado',
    creada: true,
    operacion: { generacionDns: '2', causa: 'reintento_reconciliacion' }
  });
  repositorio.reintento = { creada: false, motivo: 'backoff_vigente' };
  assert.deepEqual(await servicio.planificarReintentoReconciliacion(), {
    accion: 'sin_reintento',
    creada: false,
    motivo: 'backoff_vigente'
  });
  assert.deepEqual(trazas, ['reintento', 'reintento']);
}

async function verificarDivergenciaYSucesoras() {
  const repositorio = new RepositorioRecuperacionFixture({ trazas: [] });
  const servicio = new ServicioRecuperacionBindDns({ repositorioCoordinacion: repositorio });
  const primera = await servicio.derivarSucesoraPorDivergencia({
    generacionPredecesora: '7',
    diagnostico: { codigo: 'proyeccion_divergente', mensaje: 'hash distinto' },
    lease: { generacionDns: '7', instanciaId: 'i', leaseToken: Buffer.alloc(32), fencingToken: '3' }
  });
  assert.equal(primera.accion, 'sucesora_creada');
  assert.equal(primera.operacion.generacionDns, '8');
  assert.equal(repositorio.divergencias[0].opciones.lease.generacionDns, '7');

  repositorio.divergencia = { creada: false, bloqueada: false, operacion: { generacionDns: '8' } };
  assert.equal((await servicio.derivarSucesoraPorDivergencia({
    generacionPredecesora: '7',
    diagnostico: { codigo: 'proyeccion_divergente', mensaje: 'repetida' }
  })).accion, 'sucesora_existente');

  repositorio.divergencia = { creada: false, bloqueada: true, operacion: { generacionDns: '8', estado: 'recuperacion_bloqueada' } };
  assert.equal((await servicio.derivarSucesoraPorDivergencia({
    generacionPredecesora: '8',
    diagnostico: { codigo: 'segunda_divergencia', mensaje: 'segunda' }
  })).accion, 'recuperacion_bloqueada');

  assert.deepEqual(await servicio.reactivarRecuperacionManual({ generacionPredecesora: '8' }), {
    accion: 'sucesora_manual',
    operacion: { generacionDns: '9', causa: 'reactivacion_manual' }
  });
}

async function verificarResolucionOperacionReclamada() {
  const trazas = [];
  const repositorio = new RepositorioRecuperacionFixture({ trazas });
  const coordinador = new CoordinadorFixture({ trazas });
  const servicio = new ServicioRecuperacionBindDns({
    repositorioCoordinacion: repositorio,
    coordinador
  });
  const lease = { operacionId: '1', instanciaId: 'i', leaseToken: Buffer.alloc(32), fencingToken: '4' };

  const pendienteSinEfecto = await servicio.resolverOperacionReclamada({
    lease,
    operacion: { generacionDns: '10', estado: 'pendiente', efectoPosible: false }
  });
  assert.equal(pendienteSinEfecto.accion, 'sin_cambios');
  assert.equal(trazas.at(-1), 'sin_cambios');

  repositorio.reconciliacion = { estado: 'activa', generacionObjetivo: '11' };
  const inicial = await servicio.resolverOperacionReclamada({
    lease,
    operacion: { generacionDns: '11', estado: 'pendiente', efectoPosible: false }
  });
  assert.equal(inicial.accion, 'requiere_recarga_forzada');

  const efecto = await servicio.resolverOperacionReclamada({
    lease,
    operacion: { generacionDns: '12', estado: 'recuperacion_pendiente', efectoPosible: true }
  });
  assert.equal(efecto.accion, 'requiere_recarga_forzada');

  const confirmada = await servicio.resolverOperacionReclamada({
    lease,
    operacion: { generacionDns: '13', estado: 'recarga_confirmada', efectoPosible: true },
    resultado: { zonas: '2', artefactos: '4', cambios: '1' }
  });
  assert.equal(confirmada.accion, 'consolidada');
  assert.deepEqual(coordinador.resultados.at(-1), { zonas: '2', artefactos: '4', cambios: '1' });
}

async function verificarEstadoRecuperacion() {
  const repositorio = new RepositorioRecuperacionFixture({ trazas: [] });
  repositorio.operacion = { generacionDns: '21', estado: 'efecto_iniciado', efectoPosible: true };
  const servicio = new ServicioRecuperacionBindDns({ repositorioCoordinacion: repositorio });
  const estado = await servicio.obtenerEstadoRecuperacion('21');
  assert.equal(estado.operacion.generacionDns, '21');
  assert.equal(estado.requiereRecargaForzada, true);
}

class RepositorioRecuperacionFixture {
  constructor({ trazas }) {
    this.trazas = trazas;
    this.reintento = { creada: true, operacion: { generacionDns: '2', causa: 'reintento_reconciliacion' } };
    this.divergencia = { creada: true, bloqueada: false, operacion: { generacionDns: '8' } };
    this.reconciliacion = null;
    this.operacion = null;
    this.divergencias = [];
  }

  async crearReintentoReconciliacion() {
    this.trazas.push('reintento');
    return this.reintento;
  }

  async crearSucesoraPorDivergencia(generacion, diagnostico, opciones) {
    this.divergencias.push({ generacion, diagnostico, opciones });
    return this.divergencia;
  }

  async crearSucesoraManual() {
    return { generacionDns: '9', causa: 'reactivacion_manual' };
  }

  async obtenerReconciliacion() {
    return this.reconciliacion;
  }

  async obtenerOperacion(generacionDns) {
    return this.operacion || { generacionDns, estado: 'pendiente', efectoPosible: false };
  }
}

class CoordinadorFixture {
  constructor({ trazas }) {
    this.trazas = trazas;
    this.resultados = [];
  }

  async avanzar(_lease, { transicion }) {
    this.trazas.push(transicion);
    return { operacion: { estado: transicion } };
  }

  async consolidar(_lease, { resultado }) {
    this.trazas.push('consolidar');
    this.resultados.push(resultado);
    return { operacion: { estado: 'consolidada' } };
  }
}

await verificarReintentos();
await verificarDivergenciaYSucesoras();
await verificarResolucionOperacionReclamada();
await verificarEstadoRecuperacion();

console.log('[dns] OK 5.21.11h: recuperacion=reintento_acotado divergencia=sucesora_unica bloqueo=segunda manual=cli recarga=forzada neutralizacion=convergente sin_cambios=antes_efecto');

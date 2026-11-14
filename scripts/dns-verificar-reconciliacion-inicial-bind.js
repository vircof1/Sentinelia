import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { PreparadorArranqueBindDns } from '../paquetes/dns/src/PreparadorArranqueBindDns.js';
import { ServicioReconciliacionInicialBindDns } from '../paquetes/dns/src/ServicioReconciliacionInicialBindDns.js';

async function verificarDnsDesactivado() {
  let llamadas = 0;
  const servicio = new ServicioReconciliacionInicialBindDns({
    configuracion: { activo: false },
    repositorioCoordinacion: {
      async asegurarReconciliacionInicial() { llamadas += 1; }
    },
    publicadorCoordinado: {
      async publicarSiguiente() { llamadas += 1; }
    }
  });
  const resultado = await servicio.prepararSelectorDurable();
  assert.equal(resultado.dnsActivo, false);
  assert.equal(resultado.motivo, 'dns_desactivado');
  assert.equal(llamadas, 0);
}

async function verificarCreacionYPublicacionInicial() {
  const trazas = [];
  const servicio = new ServicioReconciliacionInicialBindDns({
    configuracion: { activo: true },
    repositorioCoordinacion: new RepositorioReconciliacionFixture({ trazas }),
    publicadorCoordinado: new PublicadorInicialFixture({ trazas })
  });
  const primera = await servicio.prepararSelectorDurable({ estadoAnterior: 'legacy' });
  assert.equal(primera.creada, true);
  assert.equal(primera.publicada, true);
  assert.equal(primera.operacion.estado, 'efecto_iniciado');
  assert.deepEqual(trazas, ['asegurar:creada', 'publicar']);

  const segunda = await servicio.prepararSelectorDurable({ estadoAnterior: 'v1' });
  assert.equal(segunda.creada, false);
  assert.equal(segunda.publicada, true);
  assert.deepEqual(trazas, [
    'asegurar:creada', 'publicar', 'asegurar:existente', 'publicar'
  ]);
}

async function verificarSelectorV1TambienAseguraObligacion() {
  const trazas = [];
  const preparador = new PreparadorArranqueBindDns({
    configuracion: configuracionActiva(trazas),
    diagnosticoAlmacenamiento: { verificar: async () => trazas.push('almacenamiento') },
    activador: {
      clasificarSelectorActivo: async () => 'v1',
      leerSelectorActivo: async () => ({ generacionDns: '11', hashProyeccion: 'aa'.repeat(32) })
    },
    validadorGrafo: { validar: async () => trazas.push('grafo') },
    comandos: { validarConfiguracionActiva: async () => trazas.push('checkconf') },
    supervisor: supervisorFixture(trazas),
    prepararSelectorDurable: async ({ estadoAnterior }) => {
      trazas.push(`preparar:${estadoAnterior}`);
      return { publicada: true };
    }
  });
  const arranque = await preparador.prepararEIniciar();
  assert.equal(arranque.estadoAnterior, 'v1');
  assert.equal(arranque.salud.readinessDns, false);
  assert.deepEqual(trazas, [
    'sistema', 'almacenamiento', 'preparar:v1', 'grafo', 'checkconf', 'named'
  ]);
}

async function verificarArranqueMantieneReadinessPendiente() {
  const trazas = [];
  const preparador = new PreparadorArranqueBindDns({
    configuracion: configuracionActiva(trazas),
    diagnosticoAlmacenamiento: { verificar: async () => trazas.push('almacenamiento') },
    activador: {
      clasificarSelectorActivo: async () => 'ausente',
      leerSelectorActivo: async () => ({ generacionDns: '1', hashProyeccion: 'bb'.repeat(32) })
    },
    validadorGrafo: { validar: async () => trazas.push('grafo') },
    comandos: { validarConfiguracionActiva: async () => trazas.push('checkconf') },
    supervisor: supervisorFixture(trazas),
    prepararSelectorDurable: async ({ estadoAnterior }) => {
      trazas.push(`preparar:${estadoAnterior}`);
      return { publicada: true, operacion: { generacionDns: '1' } };
    }
  });
  await preparador.prepararEIniciar();
  assert.equal(preparador.salud.obtener().publicador, 'recarga_pendiente');
  assert.equal(preparador.salud.obtener().readinessDns, false);
  preparador.marcarPortalDisponible();
  assert.equal(preparador.salud.obtener().readinessDns, false);
  preparador.marcarRecargaObservada();
  assert.equal(preparador.salud.obtener().readinessDns, true);
}

async function verificarNoSeSatisfacePorOmitirPublicacion() {
  const servicio = new ServicioReconciliacionInicialBindDns({
    configuracion: { activo: true },
    repositorioCoordinacion: new RepositorioReconciliacionFixture({ trazas: [] }),
    publicadorCoordinado: {
      async publicarSiguiente() {
        return { ok: true, omitida: true, motivo: 'sin_operaciones_dns' };
      }
    }
  });
  await assert.rejects(
    () => servicio.prepararSelectorDurable({ estadoAnterior: 'v1' }),
    /no produjo una proyección activada/
  );
}

class RepositorioReconciliacionFixture {
  constructor({ trazas }) {
    this.trazas = trazas;
    this.creada = false;
  }

  async asegurarReconciliacionInicial({ maxIntentos }) {
    assert.equal(maxIntentos, 3);
    const creadaAhora = !this.creada;
    this.creada = true;
    this.trazas.push(creadaAhora ? 'asegurar:creada' : 'asegurar:existente');
    return {
      creada: creadaAhora,
      reconciliacion: { estado: 'activa', generacionObjetivo: '1' },
      operacion: { generacionDns: '1', estado: 'pendiente' }
    };
  }
}

class PublicadorInicialFixture {
  constructor({ trazas }) {
    this.trazas = trazas;
  }

  async publicarSiguiente({ limpiar }) {
    assert.equal(limpiar, false);
    this.trazas.push('publicar');
    return {
      ok: true,
      omitida: false,
      operacion: {
        generacionDns: '1',
        estado: 'efecto_iniciado',
        efectoPosible: true
      },
      activacion: {
        selector: { generacionDns: '1', hashProyeccion: '11'.repeat(32) }
      }
    };
  }
}

function configuracionActiva(trazas) {
  return {
    activo: true,
    validarSistema: async () => trazas.push('sistema')
  };
}

function supervisorFixture(trazas) {
  const supervisor = new EventEmitter();
  supervisor.iniciar = () => {
    trazas.push('named');
    return { pid: 777 };
  };
  return supervisor;
}

await verificarDnsDesactivado();
await verificarCreacionYPublicacionInicial();
await verificarSelectorV1TambienAseguraObligacion();
await verificarArranqueMantieneReadinessPendiente();
await verificarNoSeSatisfacePorOmitirPublicacion();

console.log('[dns] OK 5.21.11g: reconciliacion_inicial=idempotente dns_off=sin_singleton selector_v1=no_satisface legacy=proyecta readiness=recarga_pendiente igualdad=no');

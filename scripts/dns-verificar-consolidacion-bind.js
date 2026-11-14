import assert from 'node:assert/strict';
import { CoordinadorOperacionesDurables } from '../paquetes/coordinacion-durable/src/CoordinadorOperacionesDurables.js';
import { ServicioConsolidacionPublicacionBindDns } from '../paquetes/dns/src/ServicioConsolidacionPublicacionBindDns.js';

async function verificarAplicadaSoloConRecargaConfirmada() {
  const coordinador = new CoordinadorConsolidacionFixture();
  const servicio = new ServicioConsolidacionPublicacionBindDns({ coordinador });
  const lease = leaseGeneracion('5');
  await assert.rejects(
    () => servicio.confirmarAplicada({
      lease,
      operacion: { generacionDns: '5', estado: 'efecto_iniciado', efectoPosible: true },
      resultado: { zonas: '1' }
    }),
    /recarga observada/
  );
  const aplicada = await servicio.confirmarAplicada({
    lease,
    operacion: {
      generacionDns: '5',
      estado: 'recarga_confirmada',
      efectoPosible: true,
      recargaConfirmadaEnUtc: new Date()
    },
    resultado: { zonas: 2, artefactos: '4', cambios: '1' }
  });
  assert.equal(aplicada.accion, 'publicacion_aplicada');
  assert.deepEqual(coordinador.consolidadas, [
    { zonas: '2', artefactos: '4', cambios: '1', diagnostico: null }
  ]);
}

async function verificarFallidaSoloAntesDeEfecto() {
  const coordinador = new CoordinadorConsolidacionFixture();
  const servicio = new ServicioConsolidacionPublicacionBindDns({ coordinador });
  const lease = leaseGeneracion('6');
  await assert.rejects(
    () => servicio.confirmarFalloEstablePrevioEfecto({
      lease,
      operacion: { generacionDns: '6', estado: 'efecto_iniciado', efectoPosible: true },
      diagnostico: { codigo: 'named_checkconf', mensaje: 'falló después del selector' }
    }),
    /anterior al efecto/
  );
  const fallida = await servicio.confirmarFalloEstablePrevioEfecto({
    lease,
    operacion: { generacionDns: '6', estado: 'pendiente', efectoPosible: false },
    diagnostico: { codigo: 'named_checkconf', mensaje: 'secret=oculto' },
    resultado: { zonas: '0', artefactos: '0', cambios: '0' },
    demoraReintentoSegundos: 30
  });
  assert.equal(fallida.accion, 'publicacion_fallida');
  assert.equal(coordinador.fallos[0].permanente, true);
  assert.equal(coordinador.fallos[0].codigo, 'named_checkconf');
  assert.equal(coordinador.fallos[0].mensaje.includes('oculto'), false);
  assert.deepEqual(coordinador.fallos[0].resumen, { zonas: '0', artefactos: '0', cambios: '0', diagnostico: null });
}

async function verificarRecargaInciertaEsRecuperable() {
  const coordinador = new CoordinadorConsolidacionFixture();
  const servicio = new ServicioConsolidacionPublicacionBindDns({ coordinador });
  const recuperable = await servicio.dejarRecargaRecuperable({
    lease: leaseGeneracion('7'),
    operacion: { generacionDns: '7', estado: 'efecto_iniciado', efectoPosible: true },
    diagnostico: { codigo: 'bind_resultado_incierto', mensaje: 'timeout token=secreto' }
  });
  assert.equal(recuperable.accion, 'recarga_recuperable');
  assert.equal(coordinador.transiciones[0].transicion, 'recuperacion_pendiente');
  assert.equal(coordinador.transiciones[0].datos.diagnostico.codigo, 'bind_resultado_incierto');
  assert.equal(coordinador.transiciones[0].datos.diagnostico.mensaje.includes('secreto'), false);
}

async function verificarNoOutboxEstadosTecnicos() {
  const coordinador = new CoordinadorConsolidacionFixture();
  const servicio = new ServicioConsolidacionPublicacionBindDns({ coordinador });
  for (const estado of ['sin_cambios', 'superada', 'superada_tras_recuperacion']) {
    await assert.rejects(
      () => servicio.confirmarAplicada({
        lease: leaseGeneracion('8'),
        operacion: { generacionDns: '8', estado, efectoPosible: false },
        resultado: {}
      }),
      /recarga observada/
    );
  }
  assert.equal(coordinador.consolidadas.length, 0);
  assert.equal(coordinador.fallos.length, 0);
}

async function verificarIdempotenciaDelegadaAlRepositorio() {
  const coordinador = new CoordinadorConsolidacionFixture({ fallarSegundaConsolidacion: true });
  const servicio = new ServicioConsolidacionPublicacionBindDns({ coordinador });
  const lease = leaseGeneracion('9');
  const operacion = {
    generacionDns: '9',
    estado: 'recarga_confirmada',
    efectoPosible: true,
    recargaConfirmadaEnUtc: new Date()
  };
  await servicio.confirmarAplicada({ lease, operacion, resultado: { zonas: '1' } });
  await assert.rejects(
    () => servicio.confirmarAplicada({ lease, operacion, resultado: { zonas: '1' } }),
    /duplicada/
  );
  assert.equal(coordinador.consolidadas.length, 1);
}

async function verificarTransporteResumenFalloPorCoordinador() {
  let parametrosRecibidos = null;
  const coordinador = new CoordinadorOperacionesDurables({
    instanciaId: 'dns-consolidacion-fixture',
    repositorio: {
      reclamarSiguiente: async () => null,
      renovarLease: async () => ({ actualizada: true }),
      avanzarConLease: async () => ({ actualizada: true, operacion: {} }),
      consolidarConLease: async () => ({ actualizada: true, operacion: {} }),
      registrarFalloConLease: async (parametros) => {
        parametrosRecibidos = parametros;
        return { actualizada: true, operacion: { estado: 'fallida' } };
      }
    }
  });
  await coordinador.registrarFallo(leaseGeneracion('31', 'dns-consolidacion-fixture'), {
    codigo: 'named_checkconf',
    mensaje: 'fallo estable',
    permanente: true,
    demoraReintentoSegundos: 5,
    resumen: { zonas: '3', artefactos: '5', cambios: '2' }
  });
  assert.deepEqual(parametrosRecibidos.resumen, {
    zonas: '3',
    artefactos: '5',
    cambios: '2'
  });
}

class CoordinadorConsolidacionFixture {
  constructor({ fallarSegundaConsolidacion = false } = {}) {
    this.consolidadas = [];
    this.fallos = [];
    this.transiciones = [];
    this.fallarSegundaConsolidacion = fallarSegundaConsolidacion;
  }

  async consolidar(_lease, { resultado }) {
    if (this.fallarSegundaConsolidacion && this.consolidadas.length > 0) {
      throw new Error('obligacion duplicada');
    }
    this.consolidadas.push(resultado);
    return { operacion: { estado: 'consolidada' } };
  }

  async registrarFallo(_lease, datos) {
    this.fallos.push(datos);
    return { operacion: { estado: 'fallida' } };
  }

  async avanzar(_lease, peticion) {
    this.transiciones.push(peticion);
    return { operacion: { estado: peticion.transicion } };
  }
}

function leaseGeneracion(generacion, instanciaId = 'fixture') {
  return {
    operacionId: generacion,
    instanciaId,
    leaseToken: Buffer.alloc(32),
    fencingToken: '3'
  };
}

await verificarAplicadaSoloConRecargaConfirmada();
await verificarFallidaSoloAntesDeEfecto();
await verificarRecargaInciertaEsRecuperable();
await verificarNoOutboxEstadosTecnicos();
await verificarIdempotenciaDelegadaAlRepositorio();
await verificarTransporteResumenFalloPorCoordinador();

console.log('[dns] OK 5.21.11i: consolidacion=recarga_observada aplicada=unica fallida=pre_selector incierta=recuperable tecnicos=sin_outbox resultado=saneado');

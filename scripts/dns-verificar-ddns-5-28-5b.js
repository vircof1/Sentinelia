import assert from 'node:assert/strict';
import {
  crearDeclaracionCompatibilidadRuntimePublicadorBindDns,
  ErrorCompatibilidadDesplieguePublicadorBindDns,
  evaluarUnanimidadPublicadorBindDns
} from '../paquetes/dns/src/CompatibilidadDesplieguePublicadorBindDns.js';
import { ConfiguracionDespliegueBindDns }
  from '../paquetes/dns/src/ConfiguracionDespliegueBindDns.js';
import { PublicadorProductivoBindDns }
  from '../paquetes/dns/src/PublicadorProductivoBindDns.js';

verificarInstalacionAnterior();
verificarCompatibilidad();
await verificarAdopcionRecargaConfirmada();
console.log('[dns] OK 5.28.5b: legado=compatible mixto=rechazado recarga_confirmada=adoptada resumen=durable');

function verificarInstalacionAnterior() {
  const configuracion = new ConfiguracionDespliegueBindDns({
    DNS_ACTIVO: 'false'
  });
  assert.equal(configuracion.activo, false);
}

function verificarCompatibilidad() {
  const declaracion = crearDeclaracionCompatibilidadRuntimePublicadorBindDns({
    instanciaId: 'runtime-a',
    coordinadoActivo: true
  });
  const compatible = (instanciaId) => ({
    instanciaId,
    capacidadesDespliegue: {
      publicadorBindDns: { ...declaracion, instanciaId }
    }
  });
  assert.equal(evaluarUnanimidadPublicadorBindDns({
    instanciasRuntime: [compatible('runtime-a'), compatible('runtime-b')]
  }).instanciasRuntimeCompatibles, 2);

  for (const presencia of [
    { instanciaId: 'runtime-antiguo', capacidadesDespliegue: {} },
    {
      instanciaId: 'runtime-legado',
      capacidadesDespliegue: {
        publicadorBindDns: crearDeclaracionCompatibilidadRuntimePublicadorBindDns({
          instanciaId: 'runtime-legado', coordinadoActivo: false
        })
      }
    }
  ]) {
    assert.throws(
      () => evaluarUnanimidadPublicadorBindDns({
        instanciasRuntime: [compatible('runtime-a'), presencia]
      }),
      (error) => error instanceof ErrorCompatibilidadDesplieguePublicadorBindDns &&
        error.codigo === 'despliegue_mixto_bind_rechazado'
    );
  }
}

async function verificarAdopcionRecargaConfirmada() {
  const lease = Object.freeze({ operacionId: '42' });
  const resultado = Object.freeze({ zonas: '2', artefactos: '3', cambios: '1' });
  const operacion = Object.freeze({
    generacionDns: '42',
    estado: 'recarga_confirmada',
    recargaConfirmadaEnUtc: '2026-09-09T12:00:00.000Z',
    resultado
  });
  let recargas = 0;
  let consolidaciones = 0;
  const publicador = new PublicadorProductivoBindDns({
    publicadorCoordinado: {
      async publicarSiguiente() {
        return {
          ok: true,
          omitida: true,
          motivo: 'recarga_ya_confirmada',
          lease,
          operacion
        };
      }
    },
    servicioRecarga: {
      async observarRecarga() { recargas += 1; }
    },
    servicioConsolidacion: {
      async confirmarAplicada() { throw new Error('No debe repetir la recarga.'); }
    },
    servicioRecuperacion: {
      async resolverOperacionReclamada(entrada) {
        consolidaciones += 1;
        assert.equal(entrada.resultado, resultado);
        return {
          accion: 'consolidada',
          operacion: { ...operacion, estado: 'consolidada' }
        };
      }
    }
  });
  const adoptada = await publicador.publicarSiguiente();
  assert.equal(adoptada.ok, true);
  assert.equal(adoptada.omitida, false);
  assert.equal(adoptada.adoptada, true);
  assert.equal(adoptada.operacion.estado, 'consolidada');
  assert.equal(recargas, 0);
  assert.equal(consolidaciones, 1);
}

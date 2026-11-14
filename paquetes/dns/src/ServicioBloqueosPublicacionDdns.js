import { LeaseOperacionDurablePerdido }
  from '../../coordinacion-durable/src/CoordinadorOperacionesDurables.js';
import { ErrorActivacionArtefactosBind }
  from './ActivadorArtefactosBindDns.js';

export class ServicioBloqueosPublicacionDdns {
  constructor({ repositorioCoordinacion } = {}) {
    if (typeof repositorioCoordinacion?.registrarBloqueoGlobalDdnsConLease !== 'function') {
      throw new Error('El bloqueo DDNS requiere coordinación SQL durable.');
    }
    this.repositorioCoordinacion = repositorioCoordinacion;
  }

  async resolver({ lease, operacion, error, efectoIncierto = false } = {}) {
    if (esPerdidaAisladaAutoridad(error)) return null;
    const resultado = await this.repositorioCoordinacion
      .registrarBloqueoGlobalDdnsConLease({
        generacionDns: operacion?.generacionDns,
        instanciaId: lease?.instanciaId,
        leaseToken: lease?.leaseToken,
        fencingToken: lease?.fencingToken,
        efectoIncierto: efectoIncierto || Boolean(
          error instanceof ErrorActivacionArtefactosBind && error.selectorReemplazado
        ),
        diagnostico: {
          codigo: error?.codigo || 'bind_publicacion_bloqueada',
          mensaje: error?.message || 'La infraestructura BIND impide publicar.'
        }
      });
    return resultado?.bloqueado ? resultado : null;
  }
}

function esPerdidaAisladaAutoridad(error) {
  let actual = error;
  const visitados = new Set();
  while (actual && !visitados.has(actual)) {
    if (actual instanceof LeaseOperacionDurablePerdido ||
        actual?.codigo === 'bind_autoridad_perdida' ||
        actual?.codigo === 'lease_operacion_durable_perdido') return true;
    visitados.add(actual);
    actual = actual.cause;
  }
  return false;
}

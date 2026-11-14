import { ErrorComandoBindDns } from './AdaptadoresProcesoBindDns.js';
import { ErrorActivacionArtefactosBind } from './ActivadorArtefactosBindDns.js';
import { RechazoZonaCandidataBindDns } from './ValidadorCandidataBindDns.js';

export class ServicioRechazosAtribuiblesDdns {
  constructor({ repositorioCoordinacion } = {}) {
    if (typeof repositorioCoordinacion?.registrarRechazoAtribuibleDdnsConLease !== 'function') {
      throw new Error('La atribución DDNS requiere coordinación SQL con presupuesto durable.');
    }
    this.repositorioCoordinacion = repositorioCoordinacion;
  }

  async resolver({ lease, operacion, fotografia, error } = {}) {
    if (!(error instanceof ErrorActivacionArtefactosBind) || error.selectorReemplazado) {
      return null;
    }
    const rechazo = buscarCausa(error, RechazoZonaCandidataBindDns);
    const comando = rechazo && buscarCausa(rechazo, ErrorComandoBindDns);
    if (!rechazo || !comando || rechazo.resultadoIncierto || rechazo.lineas.length !== 1) {
      return null;
    }
    const manifiesto = fotografia?.proyeccion?.manifiesto?.diagnostico;
    if (manifiesto?.perfil !== 'sentinelia-bind-diagnostico-v1' ||
        !Array.isArray(manifiesto.entradas)) {
      return null;
    }
    const candidatas = manifiesto.entradas.filter((entrada) =>
      entrada.rutaZona === rechazo.rutaZona &&
      Number(entrada.linea) === rechazo.lineas[0] &&
      entrada.concesionId !== null && entrada.versionDdns !== null &&
      String(entrada.versionDdns) !== '0'
    );
    if (candidatas.length !== 1) return null;
    const diagnostico = {
      codigo: 'bind_zona_rechazo_atribuible',
      mensaje: comando.stderr || comando.stdout || rechazo.message
    };
    return this.repositorioCoordinacion.registrarRechazoAtribuibleDdnsConLease({
      generacionDns: operacion?.generacionDns,
      instanciaId: lease?.instanciaId,
      leaseToken: lease?.leaseToken,
      fencingToken: lease?.fencingToken,
      entrada: candidatas[0],
      diagnostico
    });
  }
}

function buscarCausa(error, Clase) {
  let actual = error;
  const visitados = new Set();
  while (actual && !visitados.has(actual)) {
    if (actual instanceof Clase) return actual;
    visitados.add(actual);
    actual = actual.cause;
  }
  return null;
}

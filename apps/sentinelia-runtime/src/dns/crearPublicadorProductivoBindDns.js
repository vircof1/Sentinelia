import { CoordinadorOperacionesDurables }
  from '../../../../paquetes/coordinacion-durable/src/CoordinadorOperacionesDurables.js';
import { ActivadorArtefactosBindDns }
  from '../../../../paquetes/dns/src/ActivadorArtefactosBindDns.js';
import { AdaptadorCoordinacionGeneracionesDns }
  from '../../../../paquetes/dns/src/AdaptadorCoordinacionGeneracionesDns.js';
import { AdaptadorComandosBindDns }
  from '../../../../paquetes/dns/src/AdaptadoresProcesoBindDns.js';
import {
  BloqueoAsesorMariaDbBindDns,
  BloqueoFilesystemFlockBindDns,
  SeccionCriticaPublicacionBindDns
} from '../../../../paquetes/dns/src/BloqueosPublicacionBindDns.js';
import { ConfiguracionDespliegueBindDns }
  from '../../../../paquetes/dns/src/ConfiguracionDespliegueBindDns.js';
import { ProyeccionBindDeterministaDns }
  from '../../../../paquetes/dns/src/ProyeccionBindDeterministaDns.js';
import { PublicadorCoordinadoBindDns }
  from '../../../../paquetes/dns/src/PublicadorCoordinadoBindDns.js';
import { PublicadorProductivoBindDns }
  from '../../../../paquetes/dns/src/PublicadorProductivoBindDns.js';
import { RepositorioFotografiaCatalogoDns }
  from '../../../../paquetes/dns/src/RepositorioFotografiaCatalogoDns.js';
import { RenderizadorCatalogoBindDnsV1 }
  from '../../../../paquetes/dns/src/RenderizadorCatalogoBindDnsV1.js';
import { ServicioConsolidacionPublicacionBindDns }
  from '../../../../paquetes/dns/src/ServicioConsolidacionPublicacionBindDns.js';
import { ServicioControlRecargaBindDns }
  from '../../../../paquetes/dns/src/ServicioControlRecargaBindDns.js';
import { ServicioFotografiaProyeccionDns }
  from '../../../../paquetes/dns/src/ServicioFotografiaProyeccionDns.js';
import { ServicioRecuperacionBindDns }
  from '../../../../paquetes/dns/src/ServicioRecuperacionBindDns.js';
import { ServicioRechazosAtribuiblesDdns }
  from '../../../../paquetes/dns/src/ServicioRechazosAtribuiblesDdns.js';
import { ServicioBloqueosPublicacionDdns }
  from '../../../../paquetes/dns/src/ServicioBloqueosPublicacionDdns.js';
import { ValidadorCandidataBindDns }
  from '../../../../paquetes/dns/src/ValidadorCandidataBindDns.js';
import { ValidadorGrafoIncludesBindDns }
  from '../../../../paquetes/dns/src/ValidadorGrafoIncludesBindDns.js';

export function crearPublicadorProductivoBindDns({
  clienteSql,
  repositorioCoordinacion,
  instanciaId,
  entorno = process.env,
  estadoNamed = null
} = {}) {
  const configuracion = new ConfiguracionDespliegueBindDns(entorno);
  if (!configuracion.activo) {
    return Object.freeze({ activo: false, configuracion, publicador: null });
  }
  if (!clienteSql?.obtenerConexion || !repositorioCoordinacion || !instanciaId) {
    throw new Error('La composición productiva BIND requiere SQL, coordinación e instancia.');
  }

  const adaptador = new AdaptadorCoordinacionGeneracionesDns({
    repositorio: repositorioCoordinacion
  });
  const coordinador = new CoordinadorOperacionesDurables({
    repositorio: adaptador,
    instanciaId,
    ttlSegundos: 30
  });
  const comandos = new AdaptadorComandosBindDns({ configuracion });
  const validadorCandidata = new ValidadorCandidataBindDns({ comandos });
  const activador = new ActivadorArtefactosBindDns({
    raizArtefactos: configuracion.raizArtefactos,
    rutaSelectorActivo: configuracion.selectorActivo,
    rutaLock: configuracion.lockFile,
    validarAutoridad: async () => true,
    validarCandidata: (entrada) => validadorCandidata.validar(entrada)
  });
  const materializador = new ProyeccionBindDeterministaDns({
    validarDestino: (entrada) => activador.validarDestinoFotografia(entrada)
  });
  const repositorioFotografia = new RepositorioFotografiaCatalogoDns({
    clienteSql,
    renderizador: new RenderizadorCatalogoBindDnsV1({
      resolverDirectorioGeneracion: (generacionDns) =>
        activador.rutaDirectorioGeneracion(generacionDns)
    }),
    materializador
  });
  const servicioFotografia = new ServicioFotografiaProyeccionDns({
    repositorioFotografia,
    repositorioCoordinacion,
    coordinador
  });
  const seccionCritica = new SeccionCriticaPublicacionBindDns({
    bloqueoAsesor: new BloqueoAsesorMariaDbBindDns({ clienteSql }),
    bloqueoFilesystem: new BloqueoFilesystemFlockBindDns({
      rutaLock: configuracion.lockFile
    })
  });
  const servicioBloqueosDdns = new ServicioBloqueosPublicacionDdns({
    repositorioCoordinacion
  });
  const publicadorCoordinado = new PublicadorCoordinadoBindDns({
    coordinador,
    servicioFotografia,
    seccionCritica,
    activador,
    repositorioCoordinacion,
    servicioRechazosDdns: new ServicioRechazosAtribuiblesDdns({
      repositorioCoordinacion
    }),
    servicioBloqueosDdns
  });
  const supervisor = estadoNamed || new EstadoNamedSupervisadoExternamenteBindDns({
    configuracion
  });
  const servicioRecarga = new ServicioControlRecargaBindDns({
    configuracion,
    comandos,
    supervisor,
    validadorGrafo: new ValidadorGrafoIncludesBindDns({
      rutaRaiz: configuracion.namedConfActivo,
      rutaSelector: configuracion.selectorActivo
    }),
    validadorCandidata,
    activador,
    repositorioCoordinacion,
    coordinador,
    servicioBloqueosDdns
  });
  const servicioConsolidacion = new ServicioConsolidacionPublicacionBindDns({
    coordinador
  });
  const servicioRecuperacion = new ServicioRecuperacionBindDns({
    repositorioCoordinacion,
    coordinador
  });

  return Object.freeze({
    activo: true,
    configuracion,
    repositorioCoordinacion,
    coordinador,
    publicador: new PublicadorProductivoBindDns({
      publicadorCoordinado,
      servicioRecarga,
      servicioConsolidacion,
      servicioRecuperacion
    })
  });
}

export class EstadoNamedSupervisadoExternamenteBindDns {
  constructor({ configuracion } = {}) {
    if (!configuracion?.activo) {
      throw new Error('El estado externo de named requiere BIND activo.');
    }
    this.configuracion = configuracion;
  }

  estaVivo() {
    // El supervisor del contenedor finaliza runtime si named termina. RNDC es
    // la observación autoritativa del estrecho intervalo anterior a ese cierre.
    return true;
  }

  usaConfiguracion(ruta) {
    return ruta === this.configuracion.namedConfActivo;
  }
}

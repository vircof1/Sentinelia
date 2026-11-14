import path from 'node:path';
import { GeneradorNamedConfBindDns } from './GeneradorNamedConfBindDns.js';
import { GeneradorZonefileBindDns } from './GeneradorZonefileBindDns.js';
import { compararAsciiBinario } from './ProyeccionBindDeterministaDns.js';

const CONFIGURACION_FIJA = Object.freeze({
  rutaIncludeGestionado: 'sentinelia-named.conf',
  directorioZonas: 'zonas'
});

export class RenderizadorCatalogoBindDnsV1 {
  constructor({
    generadorNamedConf = new GeneradorNamedConfBindDns(),
    generadorZonefile = new GeneradorZonefileBindDns(),
    resolverDirectorioGeneracion = null
  } = {}) {
    this.generadorNamedConf = generadorNamedConf;
    this.generadorZonefile = generadorZonefile;
    this.resolverDirectorioGeneracion = resolverDirectorioGeneracion;
  }

  renderizar({ zonas = [], registros = [] } = {}, { generacionDns = null } = {}) {
    return this.renderizarFotografia({ zonas, registros }, { generacionDns }).artefactos;
  }

  renderizarFotografia({
    zonas = [],
    registros = [],
    concesionesDdns = []
  } = {}, { generacionDns = null } = {}) {
    const registrosPorZona = new Map();
    for (const registro of registros) {
      const lista = registrosPorZona.get(registro.zonaId) || [];
      lista.push(registro);
      registrosPorZona.set(registro.zonaId, lista);
    }

    const directorioGeneracion = this.resolverDirectorioGeneracion
      ? this.resolverDirectorioGeneracion(generacionDns)
      : null;
    const zonasGeneradas = zonas
      .filter((zona) => zona?.estaActivaPublicableEnBind?.())
      .map((zona) => {
        const generada = this.generadorZonefile.generar({
          zona,
          registros: registrosPorZona.get(zona.id) || [],
          configuracionDns: CONFIGURACION_FIJA
        });
        return directorioGeneracion
          ? { ...generada, rutaRuntime: path.posix.join(directorioGeneracion, generada.rutaArchivo) }
          : generada;
      })
      .sort((a, b) => compararAsciiBinario(a.rutaArchivo, b.rutaArchivo));
    const includes = this.generadorNamedConf.generar({
      configuracionDns: directorioGeneracion
        ? {
            ...CONFIGURACION_FIJA,
            rutaZonesConfRuntime: path.posix.join(
              directorioGeneracion,
              CONFIGURACION_FIJA.directorioZonas,
              'sentinelia-zones.conf'
            )
          }
        : CONFIGURACION_FIJA,
      zonas: zonasGeneradas
    });

    const artefactos = [
      { ruta: includes.namedConf.rutaArchivo, contenido: bytes(includes.namedConf.contenido) },
      { ruta: includes.zonesConf.rutaArchivo, contenido: bytes(includes.zonesConf.contenido) },
      ...zonasGeneradas.map(({ rutaArchivo, contenido }) => ({
        ruta: rutaArchivo,
        contenido: bytes(contenido)
      }))
    ];
    const concesionPorRegistro = new Map(
      concesionesDdns.map((concesion) => [String(concesion.registroDnsId), concesion])
    );
    const entradas = zonasGeneradas.flatMap((zonaGenerada) =>
      zonaGenerada.referenciasRegistros.map(({ registro, linea }) => {
        const concesion = concesionPorRegistro.get(String(registro.id)) || null;
        return Object.freeze({
          zonaDnsId: String(zonaGenerada.zona.id),
          rutaZona: zonaGenerada.rutaArchivo,
          linea,
          registroDnsId: String(registro.id),
          concesionId: concesion?.concesionId || null,
          versionDdns: concesion?.versionDdns || null
        });
      })
    );
    return Object.freeze({
      zonasPublicacion: Object.freeze(zonasGeneradas.map(({ zona, contenido }) => ({
        id: zona.id, contenido: bytes(contenido)
      }))),
      artefactos: Object.freeze(artefactos),
      diagnostico: Object.freeze({
        perfil: 'sentinelia-bind-diagnostico-v1',
        entradas: Object.freeze(entradas)
      })
    });
  }
}

function bytes(contenido) {
  return Buffer.from(String(contenido), 'utf8');
}

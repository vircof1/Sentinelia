import { GeneradorNamedConfBindDns } from './GeneradorNamedConfBindDns.js';
import { GeneradorZonefileBindDns } from './GeneradorZonefileBindDns.js';

export class GeneradorProyeccionBindDns {
  constructor({
    generadorNamedConfBindDns = new GeneradorNamedConfBindDns(),
    generadorZonefileBindDns = new GeneradorZonefileBindDns()
  } = {}) {
    this.generadorNamedConfBindDns = generadorNamedConfBindDns;
    this.generadorZonefileBindDns = generadorZonefileBindDns;
  }

  generar({
    configuracionDns = {},
    catalogoZonas = []
  }) {
    const zonasActivas = (Array.isArray(catalogoZonas) ? catalogoZonas : [])
      .filter((item) => this.esZonaActivaPublicable(item?.zona))
      .map((item) => this.generadorZonefileBindDns.generar({
        zona: item.zona,
        registros: item.registros || [],
        configuracionDns
      }))
      .sort((a, b) => (
        a.zona.nombreZona.localeCompare(b.zona.nombreZona) ||
        a.zona.id - b.zona.id
      ));
    const includes = this.generadorNamedConfBindDns.generar({
      configuracionDns,
      zonas: zonasActivas
    });

    return {
      ...includes,
      archivosZona: zonasActivas.map((zonaGenerada) => ({
        nombreZona: zonaGenerada.zona.nombreZona,
        rutaArchivo: zonaGenerada.rutaArchivo,
        nombreArchivo: zonaGenerada.nombreArchivo,
        contenido: zonaGenerada.contenido,
        totalPublicables: zonaGenerada.totalPublicables
      })),
      resumen: {
        totalZonas: zonasActivas.length,
        totalRegistrosPublicables: zonasActivas.reduce(
          (acumulado, zonaGenerada) => acumulado + zonaGenerada.totalPublicables,
          0
        )
      }
    };
  }

  esZonaActivaPublicable(zona) {
    if (!zona) {
      return false;
    }

    if (typeof zona?.estaActivaPublicableEnBind === 'function') {
      return zona.estaActivaPublicableEnBind();
    }

    return Boolean(zona.activo) && Boolean(zona.publicarEnBind ?? true);
  }
}

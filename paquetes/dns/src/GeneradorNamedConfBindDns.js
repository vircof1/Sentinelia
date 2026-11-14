import path from 'node:path';

export class GeneradorNamedConfBindDns {
  generar({
    configuracionDns = {},
    zonas = []
  }) {
    const rutaIncludeGestionado = String(
      configuracionDns.rutaIncludeGestionado || '/etc/bind/sentinelia.named.conf'
    );
    const rutaZonesConf = this.resolverRutaZonesConf({
      rutaIncludeGestionado,
      configuracionDns
    });
    const zonesConf = this.renderizarZonesConf({
      configuracionDns,
      zonas,
      rutaZonesConf
    });
    const namedConf = this.renderizarNamedConf({
      configuracionDns,
      rutaZonesConf: configuracionDns.rutaZonesConfRuntime || rutaZonesConf
    });

    return {
      namedConf: {
        rutaArchivo: rutaIncludeGestionado,
        contenido: namedConf
      },
      zonesConf: {
        rutaArchivo: rutaZonesConf,
        contenido: zonesConf
      }
    };
  }

  renderizarNamedConf({ configuracionDns, rutaZonesConf }) {
    const lineas = [
      '// Archivo gestionado por Sentinelia. No editar manualmente.',
      '// Este include se monta desde named.conf.local y solo debe declarar zonas.',
      '// La configuración global de options de BIND se integrará en una fase específica.',
      '',
      `include "${rutaZonesConf}";`,
      ''
    ];

    return lineas.join('\n');
  }

  renderizarZonesConf({ zonas = [] }) {
    const lineas = [
      '// Archivo gestionado por Sentinelia. No editar manualmente.',
      ''
    ];

    zonas.forEach((zonaGenerada, indice) => {
      const zona = zonaGenerada.zona;
      lineas.push(
        `zone "${zona.nombreZona}" IN {`,
        `  type ${zona.tipoZona};`,
        `  file "${zonaGenerada.rutaRuntime || zonaGenerada.rutaArchivo}";`,
        '};'
      );

      if (indice < zonas.length - 1) {
        lineas.push('');
      }
    });

    lineas.push('');

    return lineas.join('\n');
  }

  resolverRutaZonesConf({ rutaIncludeGestionado, configuracionDns = {} }) {
    const directorioZonas = String(configuracionDns.directorioZonas || '').trim();

    if (directorioZonas) {
      return path.join(directorioZonas, 'sentinelia-zones.conf');
    }

    const directorio = path.dirname(rutaIncludeGestionado);
    return path.join(directorio, 'sentinelia-zones.conf');
  }

  renderizarListaBind(valores = []) {
    const lista = (Array.isArray(valores) ? valores : [])
      .map((valor) => String(valor || '').trim())
      .filter(Boolean);

    if (lista.length === 0) {
      return 'none';
    }

    return lista.map((valor) => `${valor};`).join(' ');
  }
}

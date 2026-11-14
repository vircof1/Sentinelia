import path from 'node:path';
import { ValidadorCoherenciaBindDns } from './ValidadorCoherenciaBindDns.js';

export class GeneradorZonefileBindDns {
  constructor({
    validadorCoherenciaBindDns = new ValidadorCoherenciaBindDns()
  } = {}) {
    this.validadorCoherenciaBindDns = validadorCoherenciaBindDns;
  }

  generar({ zona, registros = [], configuracionDns = {} }) {
    const coherencia = this.validadorCoherenciaBindDns.validarCoherenciaZona({
      zona,
      registros
    });
    const nombreArchivo = this.construirNombreArchivoZona(coherencia.zona.nombreZona);
    const rutaArchivo = path.join(
      String(configuracionDns.directorioZonas || '.'),
      nombreArchivo
    );

    return {
      zona: coherencia.zona,
      nombreArchivo,
      rutaArchivo,
      contenido: this.renderizarZonefile(coherencia),
      registrosPublicables: coherencia.registrosPublicables,
      referenciasRegistros: coherencia.registrosPublicables.map((registro, indice) =>
        Object.freeze({ registro, linea: 14 + indice })
      ),
      totalPublicables: coherencia.totalPublicables
    };
  }

  renderizarZonefile({ zona, registrosPublicables }) {
    const cabecera = [
      '; Archivo gestionado por Sentinelia. No editar manualmente.',
      `; Zona: ${zona.nombreZona}`,
      `; Scope: ${zona.resolverNivelPertenencia()}`,
      '$TTL ' + zona.ttlDefectoSegundos,
      ''
    ];

    const bloqueSoa = [
      `@ IN SOA ${this.formatearNombreDnsAbsoluto(zona.soaMname)} ${this.formatearNombreDnsAbsoluto(zona.soaRname)} (`,
      `    ${zona.soaSerial} ; serial`,
      `    ${zona.soaRefreshSegundos} ; refresh`,
      `    ${zona.soaRetrySegundos} ; retry`,
      `    ${zona.soaExpireSegundos} ; expire`,
      `    ${zona.soaMinimumSegundos} ; minimum`,
      ')',
      ''
    ];

    const lineasRegistros = registrosPublicables.map((registro) => (
      this.renderizarRegistro(registro)
    ));

    return [...cabecera, ...bloqueSoa, ...lineasRegistros, ''].join('\n');
  }

  renderizarRegistro(registro) {
    const owner = registro.hostRelativo === '@'
      ? '@'
      : registro.hostRelativo;
    const ttl = registro.ttlEfectivoSegundos;
    const tipo = registro.tipoRegistro;
    const rdata = this.renderizarRdata(registro);

    return `${owner} ${ttl} IN ${tipo} ${rdata}`;
  }

  renderizarRdata(registro) {
    if (registro.tipoRegistro === 'A' || registro.tipoRegistro === 'AAAA') {
      return registro.valorPrincipal;
    }

    if (['CNAME', 'NS', 'MX', 'SRV', 'PTR'].includes(registro.tipoRegistro)) {
      return this.renderizarRdataConNombre(registro);
    }

    if (registro.tipoRegistro === 'TXT') {
      return this.escaparTextoBind(registro.valorPrincipal);
    }

    if (registro.tipoRegistro === 'CAA') {
      return `${registro.flags || '0'} ${registro.tag} ${this.escaparTextoBind(registro.valorPrincipal)}`;
    }

    throw new Error(`No existe render BIND para el tipo ${registro.tipoRegistro}.`);
  }

  renderizarRdataConNombre(registro) {
    if (registro.tipoRegistro === 'CNAME' || registro.tipoRegistro === 'NS' || registro.tipoRegistro === 'PTR') {
      return this.formatearNombreDnsAbsoluto(registro.valorPrincipal);
    }

    if (registro.tipoRegistro === 'MX') {
      return `${registro.prioridad} ${this.formatearNombreDnsAbsoluto(registro.valorPrincipal)}`;
    }

    if (registro.tipoRegistro === 'SRV') {
      return `${registro.prioridad} ${registro.peso} ${registro.puerto} ${this.formatearNombreDnsAbsoluto(registro.valorPrincipal)}`;
    }

    throw new Error(`No existe render de nombre DNS para el tipo ${registro.tipoRegistro}.`);
  }

  formatearNombreDnsAbsoluto(valor) {
    return `${String(valor || '').replace(/\.+$/, '')}.`;
  }

  escaparTextoBind(valor) {
    const texto = String(valor ?? '');
      return `"${texto
        .replaceAll('\\', '\\\\')
        .replaceAll('"', '\\"')}"`;
  }

  construirNombreArchivoZona(nombreZona) {
    const base = String(nombreZona || '')
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9.-]+/g, '_')
      .replace(/\.+/g, '.')
      .replace(/^-+|-+$/g, '');

    return `db.${base || 'zona'}.zone`;
  }
}

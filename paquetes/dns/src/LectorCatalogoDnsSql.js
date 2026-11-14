import { RepositorioRegistrosDns } from './RepositorioRegistrosDns.js';
import { RepositorioZonasDns } from './RepositorioZonasDns.js';
import { bytesAUuidV7Auditoria } from '../../auditoria/src/UuidV7Auditoria.js';

export class LectorCatalogoDnsSql {
  constructor({ clienteSql } = {}) {
    this.repositorioZonas = new RepositorioZonasDns(clienteSql);
    this.repositorioRegistros = new RepositorioRegistrosDns(clienteSql);
  }

  async leerEnContexto(conexion) {
    const zonas = await this.repositorioZonas.listarEnContexto(conexion);
    const registros = await this.repositorioRegistros.listarPorZonaIdsEnContexto(
      zonas.map(({ id }) => id),
      conexion
    );
    const [configuracion] = await conexion.execute(
      `SELECT clave, valor
         FROM configuracion_portal
        WHERE clave LIKE 'dns.%'
        ORDER BY clave COLLATE utf8mb4_bin ASC`
    );
    const [concesionesDdns] = await conexion.execute(
      `SELECT registro_dns_id, concesion_id,
              CAST(version_ddns AS CHAR) AS version_ddns
         FROM concesiones_ddns_agentes
        WHERE estado='vigente' AND registro_dns_id IS NOT NULL
        ORDER BY registro_dns_id ASC`
    );
    return Object.freeze({
      zonas: Object.freeze(zonas),
      registros: Object.freeze(registros),
      concesionesDdns: Object.freeze(concesionesDdns.map((fila) => Object.freeze({
        registroDnsId: String(fila.registro_dns_id),
        concesionId: bytesAUuidV7Auditoria(fila.concesion_id, 'concesionId'),
        versionDdns: String(fila.version_ddns)
      }))),
      configuracion: Object.freeze(configuracion.map((fila) => Object.freeze({
        clave: String(fila.clave),
        valor: String(fila.valor)
      })))
    });
  }
}

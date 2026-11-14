import { normalizarEndpointFederacion } from '../src/RelacionFederacion.js';
import {
  TIPOS_IDENTIDAD_FEDERADA,
  crearIdentidadFederada
} from '../src/IdentidadFederada.js';

export class ErrorDestinoEmisionFederacion extends Error {
  constructor(codigo, mensaje) {
    super(mensaje);
    this.name = 'ErrorDestinoEmisionFederacion';
    this.codigo = codigo;
  }
}

export class RepositorioDestinosEmisionFederacionSql {
  constructor(clienteSql) {
    if (typeof clienteSql?.consultar !== 'function') {
      throw new Error('Los destinos emisores federados requieren SQL operativo.');
    }
    this.clienteSql = clienteSql;
  }

  async obtenerAprobadoOperativo({ relacionId } = {}) {
    return this.#obtener({ relacionId, filtroCompatibilidad:
      "AND r.estado_compatibilidad IN ('compatible','compatibleParcial')" });
  }

  async obtenerVinculadoAutenticable({ relacionId } = {}) {
    return this.#obtener({ relacionId, filtroCompatibilidad: '' });
  }

  async #obtener({ relacionId, filtroCompatibilidad }) {
    const relacion = identidad(relacionId, TIPOS_IDENTIDAD_FEDERADA.RELACION);
    const filtroEstado = filtroCompatibilidad
      ? "AND r.estado_ciclo='vinculada'"
      : "AND r.estado_ciclo IN ('pendienteAutenticacion','vinculada')";
    const filas = await this.clienteSql.consultar(
      `SELECT r.relacion_id,r.installation_remota_id,r.version_autoridad,
              r.estado_compatibilidad,l.endpoint_https
         FROM relaciones_federacion r
         JOIN localizaciones_relaciones_federacion l
           ON l.relacion_localizacion_activa=r.relacion_id
          AND l.relacion_id=r.relacion_id AND l.estado='activa'
         LEFT JOIN actividad_emision_relaciones_federacion a
           ON a.relacion_id=r.relacion_id
        WHERE r.relacion_id=? AND r.direccion='emision'
          ${filtroEstado}
          AND r.estado_autoridad='autorizada'
          AND r.estado_identidad='valida'
          ${filtroCompatibilidad}
          ${filtroCompatibilidad ? "AND COALESCE(a.compatibilidad_remota,'pendiente')<>'incompatible'" : ''}
        LIMIT 1`,
      [relacion]
    );
    const fila = filas[0];
    if (!fila) {
      throw new ErrorDestinoEmisionFederacion(
        'destino_emision_no_operativo',
        'La relación emisora no posee una localización aprobada y operativa.'
      );
    }
    return Object.freeze({
      relacionId: relacion,
      installationRemotaId: identidad(
        fila.installation_remota_id,
        TIPOS_IDENTIDAD_FEDERADA.INSTALACION
      ),
      endpoint: normalizarEndpointFederacion(fila.endpoint_https),
      versionAutoridad: String(fila.version_autoridad),
      estadoCompatibilidad: fila.estado_compatibilidad
    });
  }

  async listarAprobadosOperativos() {
    return this.#listar("AND r.estado_compatibilidad IN ('compatible','compatibleParcial')");
  }

  async listarVinculadosAutenticables() {
    return this.#listar('');
  }

  async #listar(filtroCompatibilidad) {
    const filtroEstado = filtroCompatibilidad
      ? "AND r.estado_ciclo='vinculada'"
      : "AND r.estado_ciclo IN ('pendienteAutenticacion','vinculada')";
    const filas = await this.clienteSql.consultar(
      `SELECT r.relacion_id
         FROM relaciones_federacion r
         JOIN localizaciones_relaciones_federacion l
           ON l.relacion_localizacion_activa=r.relacion_id
          AND l.relacion_id=r.relacion_id AND l.estado='activa'
         LEFT JOIN actividad_emision_relaciones_federacion a
           ON a.relacion_id=r.relacion_id
        WHERE r.direccion='emision' ${filtroEstado}
          AND r.estado_autoridad='autorizada' AND r.estado_identidad='valida'
          ${filtroCompatibilidad}
          ${filtroCompatibilidad ? "AND COALESCE(a.compatibilidad_remota,'pendiente')<>'incompatible'" : ''}
        ORDER BY r.relacion_id`
    );
    return Object.freeze(filas.map((fila) => Object.freeze({
      relacionId: identidad(fila.relacion_id, TIPOS_IDENTIDAD_FEDERADA.RELACION)
    })));
  }
}

function identidad(valor, tipo) {
  try {
    return String(crearIdentidadFederada({ tipo, valor: String(valor || '') }));
  } catch {
    throw new ErrorDestinoEmisionFederacion(
      'identidad_destino_invalida',
      'El destino federado no contiene identidades canónicas.'
    );
  }
}

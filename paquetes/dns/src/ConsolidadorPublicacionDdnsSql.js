import {
  bytesAUuidV7Auditoria,
  generarUuidV7Auditoria,
  uuidV7AuditoriaABytes
} from '../../auditoria/src/UuidV7Auditoria.js';
import { construirIntencionAuditoriaDdns } from './EventosAuditoriaDdnsAgentes.js';

export class ConsolidadorPublicacionDdnsSql {
  constructor({ repositorioOutbox = null, generarEventoId = generarUuidV7Auditoria } = {}) {
    if (repositorioOutbox !== null &&
        typeof repositorioOutbox?.encolarEnTransaccion !== 'function') {
      throw new TypeError('La consolidación DDNS requiere una outbox válida.');
    }
    this.repositorioOutbox = repositorioOutbox;
    this.generarEventoId = generarEventoId;
  }

  async consolidarEnTransaccion({ conexion, generacionDns, diagnostico } = {}) {
    if (typeof conexion?.execute !== 'function') {
      throw new Error('La consolidación DDNS requiere una conexión SQL prestada.');
    }
    if (!diagnostico) return Object.freeze({ versionesPublicadas: 0 });
    let versionesPublicadas = 0;
    for (const entrada of diagnostico.entradas) {
      if (!entrada.concesionId || entrada.versionDdns === '0') continue;
      const [filas] = await conexion.execute(
        `SELECT c.id AS concesion_id_interno,c.concesion_id,
                c.agente_id_fotografia,c.registro_dns_id_fotografia,
                c.registro_scope_tenant_id,c.registro_scope_empresa_id,
                c.registro_scope_sitio_id,
                i.id AS intencion_id_interno,
                i.intencion_id,i.origen,i.modo,i.hito,i.terminal,
                i.estado_deseado_canonico,
                i.estado_deseado_sha256
           FROM concesiones_ddns_agentes c
           INNER JOIN intenciones_ddns_agentes i
             ON i.concesion_interna_id=c.id AND i.version_ddns=?
          WHERE c.concesion_id=?
          LIMIT 1
          FOR UPDATE`,
        [entrada.versionDdns, uuidV7AuditoriaABytes(
          entrada.concesionId,
          'diagnostico.concesionId'
        )]
      );
      const fila = filas[0];
      if (!fila || String(fila.registro_dns_id_fotografia) !== entrada.registroDnsId) {
        throw new Error('El manifiesto DNS no corresponde a una intención DDNS histórica.');
      }
      const yaPublicada = fila.hito === 'contenido_publicado' &&
        fila.terminal === 'publicada';
      await conexion.execute(
        `UPDATE concesiones_ddns_agentes
            SET contenido_publicado_canonico=?, contenido_publicado_sha256=?,
                generacion_dns_publicada=?,
                condicion_operativa=CASE
                  WHEN intencion_gobernante_id=? AND version_ddns=?
                    AND estado='vigente' THEN 'operativa'
                  ELSE condicion_operativa
                END
          WHERE id=?`,
        [fila.estado_deseado_canonico, fila.estado_deseado_sha256,
          generacionDns, fila.intencion_id_interno, entrada.versionDdns,
          fila.concesion_id_interno]
      );
      await conexion.execute(
        `UPDATE intenciones_ddns_agentes
            SET hito='contenido_publicado',
                publicada_en_utc=COALESCE(publicada_en_utc,UTC_TIMESTAMP(3)),
                terminal=COALESCE(terminal,'publicada'),
                terminada_en_utc=COALESCE(terminada_en_utc,UTC_TIMESTAMP(3))
          WHERE id=?`,
        [fila.intencion_id_interno]
      );
      await conexion.execute(
        `UPDATE intentos_publicacion_ddns
            SET estado='publicada', generacion_dns=?, disponible_en_utc=NULL,
                instancia_id=NULL, lease_token=NULL, lease_expira_utc=NULL,
                codigo_diagnostico=NULL, mensaje_diagnostico=NULL,
                terminada_en_utc=COALESCE(terminada_en_utc,UTC_TIMESTAMP(3))
          WHERE concesion_interna_id=? AND version_ddns=?
          ORDER BY numero_intento DESC
          LIMIT 1`,
        [generacionDns, fila.concesion_id_interno, entrada.versionDdns]
      );
      if (this.repositorioOutbox && !yaPublicada) {
        const intencionId = bytesAUuidV7Auditoria(fila.intencion_id, 'intencionId');
        const concesionId = bytesAUuidV7Auditoria(fila.concesion_id, 'concesionId');
        const estado = jsonCanonico(fila.estado_deseado_canonico);
        const scope = {
          tenantId: nullable(fila.registro_scope_tenant_id),
          empresaId: nullable(fila.registro_scope_empresa_id),
          sitioId: nullable(fila.registro_scope_sitio_id)
        };
        const base = {
          actorReal: { tipo: 'runtime', id: 'sentinelia-runtime' },
          sujetoId: intencionId,
          scope,
          correlacionId: intencionId,
          causalidadIntencionId: intencionId,
          productor: 'runtime_dns',
          rolEvento: 'resultado'
        };
        const payloadBase = {
          tipoRegistro: estado.tipo,
          modo: fila.modo,
          estadoPosterior: estado,
          versionDdns: entrada.versionDdns,
          origenIntencion: fila.origen,
          generacionDns: String(generacionDns),
          agenteId: String(fila.agente_id_fotografia),
          registroDnsId: String(fila.registro_dns_id_fotografia)
        };
        await this.repositorioOutbox.encolarEnTransaccion([
          construirIntencionAuditoriaDdns({
            ...base,
            eventoId: this.generarEventoId(),
            tipo: 'ddns.contenido_publicado',
            claveOperacion: `ddns:publicada:${concesionId}:${entrada.versionDdns}`,
            payload: { ...payloadBase, resultado: 'publicado' }
          }),
          construirIntencionAuditoriaDdns({
            ...base,
            eventoId: this.generarEventoId(),
            tipo: 'ddns.intencion_terminada',
            claveOperacion: `ddns:terminal:${concesionId}:${entrada.versionDdns}:publicada`,
            payload: { ...payloadBase, resultado: 'publicada' }
          })
        ], { conexion });
      }
      versionesPublicadas += 1;
    }
    return Object.freeze({ versionesPublicadas });
  }
}

function nullable(valor) {
  return valor === null ? null : String(valor);
}

function jsonCanonico(valor) {
  if (typeof valor === 'string') return JSON.parse(valor);
  if (Buffer.isBuffer(valor)) return JSON.parse(valor.toString('utf8'));
  return valor;
}

import { createHash } from 'node:crypto';

import {
  bytesAUuidV7Auditoria,
  uuidV7AuditoriaABytes
} from '../../auditoria/src/UuidV7Auditoria.js';
import { canonicalizarJsonFederacion } from '../src/CanonicalizadorFederacion.js';

export class RepositorioHeartbeatFederacionSql {
  constructor(clienteSql, { adaptadorAuditoria = null } = {}) {
    if (!clienteSql?.obtenerConexion) {
      throw new Error('El heartbeat federado requiere SQL operativo.');
    }
    this.clienteSql = clienteSql;
    this.adaptadorAuditoria = adaptadorAuditoria;
  }

  async registrar(entrada) {
    const conexion = await this.clienteSql.obtenerConexion();
    try {
      await conexion.beginTransaction();
      const relacion = await bloquearRelacion(conexion, entrada.relacionId);
      exigirRelacionViva(relacion, entrada);
      const salud = await bloquearSalud(conexion, entrada.relacionId);
      const huella = huellaHeartbeat(entrada);
      const mismaSesion = salud?.ultima_sesion_id &&
        bytesAUuidV7Auditoria(salud.ultima_sesion_id) === entrada.sesionId;
      if (salud?.ultimo_heartbeat_request_id) {
        const requestAnterior = bytesAUuidV7Auditoria(salud.ultimo_heartbeat_request_id);
        if (requestAnterior === entrada.heartbeatRequestId) {
          if (!Buffer.from(salud.huella_ultimo_heartbeat).equals(huella)) {
            throw conflicto('heartbeatRequestId ya pertenece a otra intención.');
          }
          await conexion.commit();
          return resultadoPersistido(salud, relacion, true);
        }
        if (mismaSesion && BigInt(entrada.seq) <= BigInt(salud.ultimo_seq)) {
          throw conflicto('La secuencia del heartbeat no avanza monotónicamente.');
        }
      }
      if (!mismaSesion && entrada.muestraTemporalAnterior !== null) {
        throw conflicto('Una sesión nueva no puede cerrar la muestra temporal de otra sesión.');
      }

      const servidorRecibeSql = await ahoraSql(conexion);
      const temporal = evaluarMuestraTemporal(
        entrada.muestraTemporalAnterior,
        mismaSesion ? salud : null,
        entrada.toleranciaTemporalMs
      );
      const estadoCompatibilidad = entrada.compatible ? 'compatible' : 'incompatible';
      const puedeVincular = entrada.compatible && temporal.estado === 'tolerable';
      const estadoCicloNuevo = relacion.estado_ciclo === 'pendienteAutenticacion' && puedeVincular
        ? 'vinculada' : relacion.estado_ciclo;
      const cambiaRelacion = relacion.estado_compatibilidad !== estadoCompatibilidad ||
        estadoCicloNuevo !== relacion.estado_ciclo;

      if (cambiaRelacion) {
        await actualizarRelacion(conexion, relacion, {
          estadoCompatibilidad, estadoCicloNuevo, ahora: servidorRecibeSql
        });
        await registrarCambioRelacion(conexion, relacion, {
          entrada, estadoCompatibilidad, estadoCicloNuevo,
          ahora: servidorRecibeSql,
          adaptadorAuditoria: this.adaptadorAuditoria
        });
      }
      const servidorEnviaSql = await ahoraSql(conexion);
      const respuesta = construirRespuesta({
        entrada, temporal, estadoCompatibilidad, estadoCicloNuevo,
        servidorRecibeSql, servidorEnviaSql
      });
      await upsertSalud(conexion, {
        entrada, huella, temporal, estadoCompatibilidad,
        servidorRecibeSql, servidorEnviaSql, respuesta
      });
      await upsertArranque(conexion, entrada, servidorRecibeSql);
      await conexion.commit();
      return Object.freeze({
        respuesta: Object.freeze(respuesta),
        avisoEventoId: entrada.avisoEventoId,
        scope: Object.freeze(scopeRelacion(relacion)),
        installationRemotaId: relacion.installation_remota_id,
        repetida: false
      });
    } catch (error) {
      try { await conexion.rollback(); } catch { /* conserva causa */ }
      throw error;
    } finally {
      conexion.release();
    }
  }
}

async function bloquearRelacion(conexion, relacionId) {
  const [filas] = await conexion.execute(
    'SELECT * FROM relaciones_federacion WHERE relacion_id=? FOR UPDATE', [relacionId]
  );
  if (!filas[0]) throw new Error('La relación federada no existe.');
  return filas[0];
}

async function bloquearSalud(conexion, relacionId) {
  const [filas] = await conexion.execute(
    'SELECT * FROM estado_salud_relaciones_federacion WHERE relacion_id=? FOR UPDATE',
    [relacionId]
  );
  return filas[0] || null;
}

function exigirRelacionViva(relacion, entrada) {
  if (relacion.direccion !== 'recepcion' ||
      !['pendienteAutenticacion', 'vinculada'].includes(relacion.estado_ciclo) ||
      relacion.estado_autoridad !== 'autorizada' ||
      relacion.estado_identidad !== 'valida' ||
      relacion.installation_remota_id !== entrada.installationRemotaId) {
    const error = new Error('La relación no admite heartbeat técnico.');
    error.codigo = 'HEARTBEAT_FEDERADO_RECHAZADO';
    error.statusCode = 403;
    throw error;
  }
}

function evaluarMuestraTemporal(muestra, salud, toleranciaTemporalMs) {
  if (muestra == null) return { estado: 'pendiente', desfaseMs: null, rttMs: null };
  if (!salud?.muestra_id) throw conflicto('No existe una muestra temporal previa que cerrar.');
  const esperada = {
    muestraId: bytesAUuidV7Auditoria(salud.muestra_id),
    clienteEnviaEnUtc: fechaIso(salud.muestra_cliente_envia_utc),
    servidorRecibeEnUtc: fechaIso(salud.muestra_servidor_recibe_utc),
    servidorEnviaEnUtc: fechaIso(salud.muestra_servidor_envia_utc)
  };
  for (const campo of Object.keys(esperada)) {
    if (muestra[campo] !== esperada[campo]) {
      throw conflicto('La muestra temporal no coincide con el desafío anterior.');
    }
  }
  const t0 = Date.parse(muestra.clienteEnviaEnUtc);
  const t1 = Date.parse(muestra.servidorRecibeEnUtc);
  const t2 = Date.parse(muestra.servidorEnviaEnUtc);
  const t3 = Date.parse(muestra.clienteRecibeEnUtc);
  const rttMs = (t3 - t0) - (t2 - t1);
  if (rttMs < 0) throw conflicto('La muestra temporal declara un RTT imposible.');
  const desfaseMs = Math.round(((t1 - t0) + (t2 - t3)) / 2);
  return {
    estado: Math.abs(desfaseMs) <= toleranciaTemporalMs
      ? 'tolerable' : 'noTolerable',
    desfaseMs,
    rttMs
  };
}

function construirRespuesta({ entrada, temporal, estadoCompatibilidad,
  estadoCicloNuevo, servidorRecibeSql, servidorEnviaSql }) {
  return {
    ok: true,
    heartbeatRequestId: entrada.heartbeatRequestId,
    seq: entrada.seq,
    presenciaTtlSeconds: entrada.presenciaTtlSegundos,
    relacion: {
      relacionId: entrada.relacionId,
      estado: estadoCicloNuevo,
      compatibilidad: estadoCompatibilidad,
      temporal: {
        estado: temporal.estado,
        desfaseEstimadoMs: temporal.desfaseMs,
        rttEstimadoMs: temporal.rttMs,
        toleranciaTemporalMs: entrada.toleranciaTemporalMs
      }
    },
    muestraTemporal: {
      muestraId: entrada.muestraId,
      clienteEnviaEnUtc: entrada.clienteEnviaEnUtc,
      servidorRecibeEnUtc: fechaIso(servidorRecibeSql),
      servidorEnviaEnUtc: fechaIso(servidorEnviaSql)
    }
  };
}

async function actualizarRelacion(conexion, relacion, cambio) {
  const [resultado] = await conexion.execute(
    `UPDATE relaciones_federacion
        SET estado_ciclo=?,estado_compatibilidad=?,revision=revision+1,actualizada_en_utc=?
      WHERE relacion_id=? AND revision=?`,
    [cambio.estadoCicloNuevo, cambio.estadoCompatibilidad, cambio.ahora,
      relacion.relacion_id, relacion.revision]
  );
  if (Number(resultado.affectedRows) !== 1) throw conflicto('La relación cambió concurrentemente.');
}

async function registrarCambioRelacion(conexion, relacion, cambio) {
  const adaptador = cambio.adaptadorAuditoria;
  if (typeof adaptador?.registrarCompatibilidadEnTransaccion !== 'function') {
    throw new Error('El cambio de compatibilidad exige auditoría transaccional.');
  }
  const [filas] = await conexion.execute(
    `SELECT COALESCE(MAX(ordinal),0)+1 AS ordinal
       FROM historico_estados_relaciones_federacion WHERE relacion_id=?`,
    [relacion.relacion_id]
  );
  await conexion.execute(
    `INSERT INTO historico_estados_relaciones_federacion (
       relacion_id,ordinal,cambio_tipo,estado_ciclo_anterior,estado_ciclo_nuevo,
       estado_autoridad_anterior,estado_autoridad_nuevo,
       estado_identidad_anterior,estado_identidad_nuevo,
       estado_compatibilidad_anterior,estado_compatibilidad_nuevo,
       version_autoridad,responsable_usuario_id,scope_tenant_id,scope_empresa_id,
       scope_sitio_id,efectivo_en_utc,registrado_en_utc,
       evento_auditoria_id,correlacion_id,detalle
     ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    [
      relacion.relacion_id, filas[0].ordinal,
      cambio.estadoCicloNuevo === relacion.estado_ciclo
        ? 'compatibilidadCambiada' : 'estadoCambiado',
      relacion.estado_ciclo, cambio.estadoCicloNuevo,
      relacion.estado_autoridad, relacion.estado_autoridad,
      relacion.estado_identidad, relacion.estado_identidad,
      relacion.estado_compatibilidad, cambio.estadoCompatibilidad,
      String(relacion.version_autoridad), relacion.responsable_usuario_id,
      relacion.scope_tenant_id, relacion.scope_empresa_id, relacion.scope_sitio_id,
      cambio.ahora, cambio.ahora,
      uuidV7AuditoriaABytes(cambio.entrada.heartbeatRequestId, 'heartbeatRequestId'),
      uuidV7AuditoriaABytes(cambio.entrada.heartbeatRequestId, 'heartbeatRequestId'),
      JSON.stringify({ causa: 'heartbeat', compatibilidad: cambio.estadoCompatibilidad })
    ]
  );
  await adaptador.registrarCompatibilidadEnTransaccion({
    eventoId: cambio.entrada.heartbeatRequestId,
    relacionId: relacion.relacion_id,
    installationRemotaId: relacion.installation_remota_id,
    scope: scopeRelacion(relacion),
    compatible: cambio.estadoCompatibilidad === 'compatible',
    estadoCicloNuevo: cambio.estadoCicloNuevo,
    efectivoEnUtc: fechaIso(cambio.ahora)
  }, { conexion });
}

async function upsertSalud(conexion, datos) {
  const { entrada, temporal, servidorRecibeSql, servidorEnviaSql } = datos;
  await conexion.execute(
    `INSERT INTO estado_salud_relaciones_federacion (
       relacion_id,ultimo_heartbeat_request_id,ultima_sesion_id,ultimo_seq,
       huella_ultimo_heartbeat,evento_aviso_id,boot_remoto_id,producto_version,protocolo_version,
       familias_soportadas,versiones_familia,estado_compatibilidad,estado_temporal,
       desfase_estimado_ms,rtt_estimado_ms,muestra_id,muestra_cliente_envia_utc,
       muestra_servidor_recibe_utc,muestra_servidor_envia_utc,ultimo_heartbeat_utc,
       respuesta_ultimo_heartbeat,actualizada_en_utc
     ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
     ON DUPLICATE KEY UPDATE
       ultimo_heartbeat_request_id=VALUES(ultimo_heartbeat_request_id),
       ultima_sesion_id=VALUES(ultima_sesion_id),ultimo_seq=VALUES(ultimo_seq),
       huella_ultimo_heartbeat=VALUES(huella_ultimo_heartbeat),
       evento_aviso_id=VALUES(evento_aviso_id),
       boot_remoto_id=VALUES(boot_remoto_id),producto_version=VALUES(producto_version),
       protocolo_version=VALUES(protocolo_version),familias_soportadas=VALUES(familias_soportadas),
       versiones_familia=VALUES(versiones_familia),
       estado_compatibilidad=VALUES(estado_compatibilidad),estado_temporal=VALUES(estado_temporal),
       desfase_estimado_ms=VALUES(desfase_estimado_ms),rtt_estimado_ms=VALUES(rtt_estimado_ms),
       muestra_id=VALUES(muestra_id),muestra_cliente_envia_utc=VALUES(muestra_cliente_envia_utc),
       muestra_servidor_recibe_utc=VALUES(muestra_servidor_recibe_utc),
       muestra_servidor_envia_utc=VALUES(muestra_servidor_envia_utc),
       ultimo_heartbeat_utc=VALUES(ultimo_heartbeat_utc),
       respuesta_ultimo_heartbeat=VALUES(respuesta_ultimo_heartbeat),
       actualizada_en_utc=VALUES(actualizada_en_utc)`,
    [
      entrada.relacionId, uuidV7AuditoriaABytes(entrada.heartbeatRequestId),
      uuidV7AuditoriaABytes(entrada.sesionId), entrada.seq, datos.huella,
      uuidV7AuditoriaABytes(entrada.avisoEventoId), entrada.bootRemotoId,
      entrada.compatibilidad.productoVersion,
      entrada.compatibilidad.protocoloVersion,
      JSON.stringify(entrada.compatibilidad.familiasSoportadas),
      JSON.stringify(entrada.compatibilidad.versionesFamilia), datos.estadoCompatibilidad,
      temporal.estado, temporal.desfaseMs, temporal.rttMs,
      uuidV7AuditoriaABytes(entrada.muestraId), sqlDesdeIso(entrada.clienteEnviaEnUtc),
      servidorRecibeSql, servidorEnviaSql, servidorRecibeSql,
      JSON.stringify(datos.respuesta), servidorEnviaSql
    ]
  );
}

async function upsertArranque(conexion, entrada, ahora) {
  await conexion.execute(
    `INSERT INTO arranques_remotos_federacion (
       relacion_id,boot_remoto_id,primera_observacion_utc,ultima_observacion_utc,contador_heartbeats
     ) VALUES (?,?,?,?,1)
     ON DUPLICATE KEY UPDATE ultima_observacion_utc=VALUES(ultima_observacion_utc),
       contador_heartbeats=contador_heartbeats+1`,
    [entrada.relacionId, entrada.bootRemotoId, ahora, ahora]
  );
}

function resultadoPersistido(salud, relacion, repetida) {
  return Object.freeze({
    respuesta: Object.freeze(typeof salud.respuesta_ultimo_heartbeat === 'string'
      ? JSON.parse(salud.respuesta_ultimo_heartbeat) : salud.respuesta_ultimo_heartbeat),
    avisoEventoId: bytesAUuidV7Auditoria(salud.evento_aviso_id),
    scope: Object.freeze(scopeRelacion(relacion)),
    installationRemotaId: relacion.installation_remota_id,
    repetida
  });
}

function huellaHeartbeat(entrada) {
  return createHash('sha256').update(canonicalizarJsonFederacion({
    heartbeatRequestId: entrada.heartbeatRequestId,
    relacionId: entrada.relacionId,
    sesionId: entrada.sesionId,
    bootRemotoId: entrada.bootRemotoId,
    seq: entrada.seq,
    clienteEnviaEnUtc: entrada.clienteEnviaEnUtc,
    compatibilidad: entrada.compatibilidad,
    muestraTemporalAnterior: entrada.muestraTemporalAnterior
  }), 'utf8').digest();
}

function scopeRelacion(relacion) {
  return {
    tenantId: relacion.scope_tenant_id == null ? null : String(relacion.scope_tenant_id),
    empresaId: relacion.scope_empresa_id == null ? null : String(relacion.scope_empresa_id),
    sitioId: relacion.scope_sitio_id == null ? null : String(relacion.scope_sitio_id)
  };
}

async function ahoraSql(conexion) {
  const [filas] = await conexion.execute(
    "SELECT DATE_FORMAT(UTC_TIMESTAMP(3), '%Y-%m-%d %H:%i:%s.%f') AS ahora"
  );
  return filas[0].ahora;
}

function sqlDesdeIso(valor) {
  return String(valor).replace('T', ' ').replace(/Z$/u, '');
}

function fechaIso(valor) {
  if (valor instanceof Date) return valor.toISOString();
  const texto = String(valor);
  const sql = texto.match(/^(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2}:\d{2})\.(\d{3})/u);
  return sql ? `${sql[1]}T${sql[2]}.${sql[3]}Z` : texto;
}

function conflicto(mensaje) {
  const error = new Error(mensaje);
  error.codigo = 'HEARTBEAT_FEDERADO_CONFLICTO';
  error.statusCode = 409;
  return error;
}

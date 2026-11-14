import { normalizarMarcaUtc } from '../../utilidades/src/fechas/normalizarMarcaUtc.js';
import { bytesAUuidV7Auditoria } from '../../auditoria/src/UuidV7Auditoria.js';
import {
  calcularEstadoEfectivoAgente,
  calcularEstadoVidaPolAgente,
  normalizarEstadoAccesoAgente,
  normalizarEstadoAdministrativoAgente
} from './EstadosAgenteSentinelia.js';

function normalizarEntero(valor, porDefecto = null) {
  const convertido = Number.parseInt(String(valor ?? ''), 10);
  return Number.isInteger(convertido) ? convertido : porDefecto;
}

export class AgenteSentinelia {
  constructor(fila, { silencioPolSegundos = 120, ahoraUtc = new Date() } = {}) {
    this.id = fila.id;
    this.guid = fila.guid;
    this.tenantId = fila.tenant_id;
    this.empresaId = fila.empresa_id;
    this.sitioId = fila.sitio_id;
    this.nombre = fila.nombre;
    this.descripcion = fila.descripcion || null;
    this.versionSecreto = normalizarEntero(fila.version_secreto, 1);
    this.versionScopeAgente = String(fila.version_scope_agente ?? '1');
    this.versionAutorizacionAgente = String(
      fila.version_autorizacion_agente ?? '1'
    );
    this.estadoAdministrativo = normalizarEstadoAdministrativoAgente(
      fila.estado_administrativo
    );
    this.estadoAcceso = normalizarEstadoAccesoAgente(fila.estado_acceso);
    this.cuarentenaHastaUtc = normalizarMarcaUtc(fila.cuarentena_hasta_utc);
    this.contadorLoginFallidos = normalizarEntero(
      fila.contador_login_fallidos,
      0
    );
    this.ultimoLoginUtc = normalizarMarcaUtc(fila.ultimo_login_utc);
    this.ultimoLoginFallidoUtc = normalizarMarcaUtc(
      fila.ultimo_login_fallido_utc
    );
    this.ultimoHeartbeatUtc = normalizarMarcaUtc(fila.ultimo_heartbeat_utc);
    this.ultimoBootId = fila.ultimo_boot_id || null;
    this.ultimaVersionAgente = fila.ultima_version_agente || null;
    this.ultimoHostname = fila.ultimo_hostname || null;
    this.ultimoSeq = normalizarEntero(fila.ultimo_seq, null);
    this.ultimaSesionIdDiagnostico =
      fila.ultima_sesion_id_diagnostico || null;
    this.ultimaSesionHuellaSha256 =
      fila.ultima_sesion_huella_sha256 || null;
    this.sesionAuditoriaId = fila.sesion_auditoria_id
      ? bytesAUuidV7Auditoria(fila.sesion_auditoria_id, 'sesionAuditoriaId')
      : null;
    this.tenantNombre = fila.tenant_nombre || null;
    this.empresaNombre = fila.empresa_nombre || null;
    this.sitioNombre = fila.sitio_nombre || null;
    this.fechaCreacion = normalizarMarcaUtc(fila.fecha_creacion);
    this.fechaActualizacion = normalizarMarcaUtc(fila.fecha_actualizacion);
    this.estadoVidaPol = calcularEstadoVidaPolAgente({
      ultimoHeartbeatUtc: seleccionarUltimaActividadPol({
        ultimoHeartbeatUtc: this.ultimoHeartbeatUtc,
        ultimoLoginUtc: this.ultimoLoginUtc
      }),
      ahoraUtc,
      silencioSegundos: silencioPolSegundos,
      requiereRelogin: Boolean(fila.requiere_relogin)
    });
    this.estadoEfectivo = calcularEstadoEfectivoAgente({
      estadoAdministrativo: this.estadoAdministrativo,
      estadoAcceso: this.estadoAcceso,
      estadoVidaPol: this.estadoVidaPol
    });
  }

  tieneSesionDiagnostica() {
    return Boolean(
      this.sesionAuditoriaId ||
      this.ultimaSesionIdDiagnostico ||
      this.ultimaSesionHuellaSha256
    );
  }

  obtenerResumenAdministrativo() {
    return {
      id: this.id,
      guid: this.guid,
      nombre: this.nombre,
      descripcion: this.descripcion,
      tenantId: this.tenantId,
      tenantNombre: this.tenantNombre,
      empresaId: this.empresaId,
      empresaNombre: this.empresaNombre,
      sitioId: this.sitioId,
      sitioNombre: this.sitioNombre,
      estadoAdministrativo: this.estadoAdministrativo,
      estadoAcceso: this.estadoAcceso,
      estadoVidaPol: this.estadoVidaPol,
      estadoEfectivo: this.estadoEfectivo,
      versionScopeAgente: this.versionScopeAgente,
      versionAutorizacionAgente: this.versionAutorizacionAgente,
      cuarentenaHastaUtc: this.cuarentenaHastaUtc,
      ultimoLoginUtc: this.ultimoLoginUtc,
      ultimoHeartbeatUtc: this.ultimoHeartbeatUtc,
      ultimoBootId: this.ultimoBootId,
      ultimaVersionAgente: this.ultimaVersionAgente,
      ultimoHostname: this.ultimoHostname,
      ultimoSeq: this.ultimoSeq,
      tieneSesionDiagnostica: this.tieneSesionDiagnostica(),
      sesionAuditoriaId: this.sesionAuditoriaId,
      fechaCreacion: this.fechaCreacion,
      fechaActualizacion: this.fechaActualizacion
    };
  }
}

export function crearAgenteSentineliaDesdeFila(fila, opciones = {}) {
  return fila ? new AgenteSentinelia(fila, opciones) : null;
}

function seleccionarUltimaActividadPol({ ultimoHeartbeatUtc, ultimoLoginUtc }) {
  const heartbeat = convertirFechaSegura(ultimoHeartbeatUtc);
  const login = convertirFechaSegura(ultimoLoginUtc);

  if (heartbeat && login) {
    return heartbeat.getTime() >= login.getTime() ? ultimoHeartbeatUtc : ultimoLoginUtc;
  }

  return ultimoHeartbeatUtc || ultimoLoginUtc || null;
}

function convertirFechaSegura(valor) {
  if (!valor) {
    return null;
  }

  const fecha = new Date(valor);
  return Number.isNaN(fecha.getTime()) ? null : fecha;
}

import { calcularHuellaSesionAgente } from './GeneradorSesionAgenteSentinelia.js';
import { bytesAUuidV7Auditoria } from '../../auditoria/src/UuidV7Auditoria.js';

export class SesionTecnicaAgenteNoViva extends Error {
  constructor(mensaje = 'La sesión técnica del agente no está viva.') {
    super(mensaje);
    this.name = 'SesionTecnicaAgenteNoViva';
    this.codigo = 'SessionNotLive';
    this.statusCode = 403;
    this.accion = 'login_required';
  }
}

export class ServicioVigenciaSesionesTecnicasAgentes {
  constructor({
    clienteSql,
    repositorioRedis,
    programadorInvalidacion = null,
    registrarDiagnostico = async () => {}
  } = {}) {
    if (!clienteSql?.consultar || !repositorioRedis?.obtenerPorTokenHash) {
      throw new Error('La vigencia técnica requiere SQL y Redis operativos.');
    }
    this.clienteSql = clienteSql;
    this.repositorioRedis = repositorioRedis;
    this.programadorInvalidacion = programadorInvalidacion;
    this.registrarDiagnostico = registrarDiagnostico;
  }

  async validarBearer(sessionToken) {
    let huella;
    try {
      huella = calcularHuellaSesionAgente(sessionToken);
    } catch {
      throw new SesionTecnicaAgenteNoViva();
    }
    const proyeccion = await this.repositorioRedis.obtenerPorTokenHash(huella);
    if (!proyeccion || proyeccion.estadoToken !== 'actual') {
      throw new SesionTecnicaAgenteNoViva();
    }
    const actualRedis = await this.repositorioRedis.obtenerActual(proyeccion.agenteId);
    if (!mismaProyeccion(actualRedis, proyeccion)) {
      await this.#retirarObsoleta(proyeccion, 'indice_redis_no_coincide');
      throw new SesionTecnicaAgenteNoViva();
    }
    const filas = await this.clienteSql.consultar(
      `SELECT CAST(version_scope_agente AS CHAR) AS version_scope_agente,
              CAST(version_autorizacion_agente AS CHAR) AS version_autorizacion_agente,
              CAST(tenant_id AS CHAR) AS tenant_id,
              CAST(empresa_id AS CHAR) AS empresa_id,
              CAST(sitio_id AS CHAR) AS sitio_id,
              estado_administrativo, estado_acceso, sesion_auditoria_id
         FROM agentes_sentinelia WHERE id = ? LIMIT 1`,
      [proyeccion.agenteId]
    );
    const agente = filas[0] ?? null;
    if (!agente || !autoridadCoincide(agente, proyeccion)) {
      await this.#retirarObsoleta(
        proyeccion,
        agente ? 'version_o_scope_no_coincide' : 'agente_ausente'
      );
      throw new SesionTecnicaAgenteNoViva();
    }
    return Object.freeze({
      agenteId: proyeccion.agenteId,
      sesionAuditoriaId: proyeccion.sesionAuditoriaId,
      sessionId: proyeccion.sessionId,
      scope: Object.freeze({ ...proyeccion.scope }),
      versionScopeAgente: proyeccion.versionScopeAgente,
      versionAutorizacionAgente: proyeccion.versionAutorizacionAgente,
      proyeccion
    });
  }

  async #retirarObsoleta(proyeccion, motivo) {
    let invalidacion = null;
    if (typeof this.programadorInvalidacion?.programar === 'function') {
      invalidacion = await this.programadorInvalidacion.programar({
        agenteId: proyeccion.agenteId,
        sesionAuditoriaId: proyeccion.sesionAuditoriaId,
        operacionProyectadaId: proyeccion.operacionId,
        fencingProyectado: proyeccion.fencingToken,
        motivo
      });
    }
    if (invalidacion?.operacionId && invalidacion?.fencingToken) {
      await this.repositorioRedis.aplicar({
        agenteId: proyeccion.agenteId,
        operacionId: invalidacion.operacionId,
        sesionAuditoriaId: proyeccion.sesionAuditoriaId,
        fencingToken: invalidacion.fencingToken,
        proyeccion: null
      });
      return;
    }
    await this.repositorioRedis.retirarSiCoincide({
      agenteId: proyeccion.agenteId,
      operacionId: proyeccion.operacionId,
      fencingToken: proyeccion.fencingToken
    });
    await this.registrarDiagnostico(Object.freeze({
      codigo: 'sesion_tecnica_huerfana_sin_invalidacion',
      agenteId: proyeccion.agenteId,
      sesionAuditoriaId: proyeccion.sesionAuditoriaId,
      motivo
    }));
  }
}

function mismaProyeccion(a, b) {
  return a?.operacionId === b.operacionId &&
    a?.fencingToken === b.fencingToken &&
    a?.sessionTokenHash === b.sessionTokenHash &&
    a?.sesionAuditoriaId === b.sesionAuditoriaId;
}

function autoridadCoincide(agente, proyeccion) {
  const sesionAuditoriaId = agente.sesion_auditoria_id
    ? bytesAUuidV7Auditoria(agente.sesion_auditoria_id)
    : null;
  return agente.estado_administrativo === 'activo' &&
    agente.estado_acceso === 'normal' &&
    String(agente.version_scope_agente) === proyeccion.versionScopeAgente &&
    String(agente.version_autorizacion_agente) === proyeccion.versionAutorizacionAgente &&
    String(agente.tenant_id) === String(proyeccion.scope.tenantId) &&
    String(agente.empresa_id) === String(proyeccion.scope.empresaId) &&
    String(agente.sitio_id) === String(proyeccion.scope.sitioId) &&
    sesionAuditoriaId === proyeccion.sesionAuditoriaId;
}

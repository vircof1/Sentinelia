import { bytesAUuidV7Auditoria }
  from '../../auditoria/src/UuidV7Auditoria.js';

export class AutoridadRuntimeAgenteNoVigente extends Error {
  constructor(motivo = 'autoridad_superada') {
    super('La autoridad runtime del agente ya no está vigente.');
    this.name = 'AutoridadRuntimeAgenteNoVigente';
    this.codigo = 'sesion_no_vigente';
    this.statusCode = 403;
    this.accion = 'login_required';
    this.motivo = motivo;
  }
}

export class RepositorioFronteraRuntimeAgentesSql {
  constructor(clienteSql) {
    if (!clienteSql?.obtenerConexion) {
      throw new Error('La frontera runtime de agentes requiere SQL operativo.');
    }
    this.clienteSql = clienteSql;
  }

  async bloquearYValidarEnTransaccion(
    autoridad = {},
    { conexion } = {}
  ) {
    if (!conexion?.execute) {
      throw new Error('La frontera runtime exige una conexión SQL prestada.');
    }
    const agenteId = normalizarId(autoridad.agenteId);
    const [filas] = await conexion.execute(
      `SELECT guid, tenant_id, empresa_id, sitio_id, version_secreto,
              CAST(version_scope_agente AS CHAR) AS version_scope_agente,
              CAST(version_autorizacion_agente AS CHAR)
                AS version_autorizacion_agente,
              estado_administrativo, estado_acceso,
              ultima_sesion_id_diagnostico,
              ultima_sesion_huella_sha256,
              sesion_auditoria_id
         FROM agentes_sentinelia
        WHERE id = ?
        LIMIT 1 FOR UPDATE`,
      [agenteId]
    );
    const fila = filas[0] ?? null;
    if (!fila) throw new AutoridadRuntimeAgenteNoVigente('agente_eliminado');

    comprobarOpcional(
      autoridad.guid,
      fila.guid,
      'identidad_agente_cambiada'
    );
    comprobarOpcional(
      autoridad.versionSecreto,
      fila.version_secreto,
      'secreto_rotado'
    );
    comprobarOpcional(
      autoridad.tenantId,
      fila.tenant_id,
      'scope_agente_cambiado'
    );
    comprobarOpcional(
      autoridad.empresaId,
      fila.empresa_id,
      'scope_agente_cambiado'
    );
    comprobarOpcional(
      autoridad.sitioId,
      fila.sitio_id,
      'scope_agente_cambiado'
    );
    comprobarOpcional(
      autoridad.versionScopeAgente,
      fila.version_scope_agente,
      'scope_agente_cambiado'
    );
    comprobarOpcional(
      autoridad.versionAutorizacionAgente,
      fila.version_autorizacion_agente,
      'autorizacion_agente_cambiada'
    );
    comprobarOpcional(
      autoridad.sesionAuditoriaId,
      fila.sesion_auditoria_id
        ? bytesAUuidV7Auditoria(fila.sesion_auditoria_id)
        : null,
      'sesion_agente_cambiada'
    );
    comprobarOpcional(
      autoridad.sesionIdDiagnostico,
      fila.ultima_sesion_id_diagnostico,
      'sesion_agente_cambiada'
    );
    comprobarOpcional(
      autoridad.sesionHuellaSha256,
      fila.ultima_sesion_huella_sha256,
      'sesion_agente_cambiada'
    );
    if (fila.estado_administrativo !== 'activo') {
      throw new AutoridadRuntimeAgenteNoVigente('agente_deshabilitado');
    }
    if (fila.estado_acceso !== 'normal') {
      throw new AutoridadRuntimeAgenteNoVigente('acceso_agente_bloqueado');
    }
    return Object.freeze({
      agenteId,
      guid: fila.guid,
      tenantId: String(fila.tenant_id),
      empresaId: String(fila.empresa_id),
      sitioId: String(fila.sitio_id),
      versionSecreto: Number(fila.version_secreto),
      versionScopeAgente: String(fila.version_scope_agente),
      versionAutorizacionAgente: String(fila.version_autorizacion_agente),
      sesionAuditoriaId: fila.sesion_auditoria_id
        ? bytesAUuidV7Auditoria(fila.sesion_auditoria_id)
        : null,
      sesionIdDiagnostico: fila.ultima_sesion_id_diagnostico ?? null,
      sesionHuellaSha256: fila.ultima_sesion_huella_sha256 ?? null
    });
  }
}

function comprobarOpcional(esperado, actual, motivo) {
  if (esperado === undefined) return;
  if (String(esperado ?? '') !== String(actual ?? '')) {
    throw new AutoridadRuntimeAgenteNoVigente(motivo);
  }
}

function normalizarId(valor) {
  const id = String(valor ?? '').trim();
  if (!/^[1-9]\d*$/u.test(id)) {
    throw new TypeError('agenteId debe ser un entero positivo.');
  }
  return id;
}

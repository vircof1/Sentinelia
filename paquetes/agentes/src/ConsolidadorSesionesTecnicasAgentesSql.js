import { uuidV7AuditoriaABytes } from '../../auditoria/src/UuidV7Auditoria.js';

export class ConsolidadorSesionesTecnicasAgentesSql {
  constructor({ registradorObligaciones = null } = {}) {
    this.registradorObligaciones = registradorObligaciones;
  }

  async consolidarEnTransaccion(operacion, { conexion } = {}) {
    if (!conexion?.execute) throw new Error('La consolidación técnica exige conexión SQL.');
    if (operacion.tipo === 'invalidacion') {
      return Object.freeze({ tipo: 'invalidacion', fotografiaActualizada: false });
    }
    const sesionId = uuidV7AuditoriaABytes(
      operacion.sesionAuditoriaId,
      'sesionAuditoriaId'
    );
    const [fotografias] = await conexion.execute(
      `SELECT sesion_auditoria_id
         FROM agentes_sentinelia WHERE id = ? FOR UPDATE`,
      [operacion.agenteId]
    );
    if (fotografias.length !== 1) throw new Error('El agente desapareció al consolidar sesión.');
    const reemplazo = operacion.tipo === 'login' &&
      fotografias[0].sesion_auditoria_id !== null;

    if (operacion.tipo === 'login') {
      await conexion.execute(
        `UPDATE periodos_vida_pol_agentes
            SET fin_utc = UTC_TIMESTAMP(3), motivo_cierre = 'sesion_reemplazada'
          WHERE agente_id = ? AND fin_utc IS NULL
          ORDER BY inicio_utc DESC, id DESC LIMIT 1`,
        [operacion.agenteId]
      );
      await conexion.execute(
        `UPDATE agentes_sentinelia
            SET ultimo_login_utc = UTC_TIMESTAMP(3), contador_login_fallidos = 0,
                estado_acceso = 'normal', cuarentena_hasta_utc = NULL,
                ultimo_heartbeat_utc = NULL, ultimo_seq = NULL,
                sesion_auditoria_id = ?, ultima_sesion_id_diagnostico = NULL,
                ultima_sesion_huella_sha256 = NULL
          WHERE id = ?`,
        [sesionId, operacion.agenteId]
      );
      await conexion.execute(
        `INSERT INTO periodos_vida_pol_agentes (
           agente_id, sesion_id_diagnostico, sesion_huella_sha256,
           sesion_auditoria_id, boot_id, inicio_utc
         ) VALUES (?, NULL, NULL, ?, NULL, UTC_TIMESTAMP(3))`,
        [operacion.agenteId, sesionId]
      );
    } else {
      const [resultado] = await conexion.execute(
        `UPDATE agentes_sentinelia
            SET sesion_auditoria_id = ?, ultima_sesion_id_diagnostico = NULL,
                ultima_sesion_huella_sha256 = NULL
          WHERE id = ? AND sesion_auditoria_id = ?`,
        [sesionId, operacion.agenteId, sesionId]
      );
      if (Number(resultado.affectedRows) !== 1) {
        throw new Error('Refresh no corresponde a la sesión lógica consolidada.');
      }
    }

    if (typeof this.registradorObligaciones?.registrarEnTransaccion === 'function') {
      await this.registradorObligaciones.registrarEnTransaccion(
        { operacion, reemplazo },
        { conexion }
      );
    }
    return Object.freeze({
      tipo: operacion.tipo,
      fotografiaActualizada: true,
      reemplazoSesionAnterior: reemplazo
    });
  }
}

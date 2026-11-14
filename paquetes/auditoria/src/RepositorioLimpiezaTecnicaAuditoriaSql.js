const NOMBRE_BLOQUEO_LIMPIEZA_TECNICA = 'sentinelia:auditoria:limpieza-tecnica';

export class RepositorioLimpiezaTecnicaAuditoriaSql {
  constructor({ clienteSql } = {}) {
    if (!clienteSql?.obtenerConexion) {
      throw new Error('RepositorioLimpiezaTecnicaAuditoriaSql requiere cliente SQL.');
    }
    this.clienteSql = clienteSql;
  }

  async ejecutarConBloqueoGlobal({ timeoutSegundos = 0 } = {}, tarea) {
    if (typeof tarea !== 'function') {
      throw new Error('La limpieza técnica requiere una tarea ejecutable.');
    }
    const conexion = await this.clienteSql.obtenerConexion();
    let adquirido = false;
    try {
      const [filas] = await conexion.execute('SELECT GET_LOCK(?, ?) AS adquirido', [
        NOMBRE_BLOQUEO_LIMPIEZA_TECNICA,
        Math.max(0, Number(timeoutSegundos) || 0)
      ]);
      adquirido = Number(filas[0]?.adquirido) === 1;
      if (!adquirido) {
        return Object.freeze({
          adquirido: false,
          motivo: 'bloqueo_limpieza_tecnica_ocupado'
        });
      }
      return Object.freeze({
        adquirido: true,
        resultado: await tarea()
      });
    } finally {
      try {
        if (adquirido) await conexion.execute('SELECT RELEASE_LOCK(?)', [NOMBRE_BLOQUEO_LIMPIEZA_TECNICA]);
      } finally {
        conexion.release();
      }
    }
  }

  async limpiarSesionesWeb({ graciaSegundos, limite }) {
    return this.#eliminarPorSubconsulta({
      tabla: 'sesiones_web_auditoria',
      columnaId: 'sesion_auditoria_id',
      condicion: `
        (
          estado = 'abierta'
          AND expira_en_utc <= UTC_TIMESTAMP(3)
        )
        OR
        (
          estado IN ('cerrada', 'invalidada')
          AND cerrada_en_utc <= TIMESTAMPADD(SECOND, -?, UTC_TIMESTAMP(3))
        )
      `,
      orden: 'COALESCE(cerrada_en_utc, expira_en_utc), sesion_auditoria_id',
      parametros: [graciaSegundos],
      limite
    });
  }

  async limpiarOutboxAuditoriaCompletada({ graciaSegundos, limite }) {
    return this.#eliminarPorSubconsulta({
      tabla: 'outbox_auditoria_runtime',
      columnaId: 'id',
      condicion: `
        estado = 'completada'
        AND completada_en_utc <= TIMESTAMPADD(SECOND, -?, UTC_TIMESTAMP(3))
        AND evento_incorporado_id = evento_id
        AND NOT EXISTS (
          SELECT 1
          FROM operaciones_publicacion_dns opd
          WHERE opd.obligacion_outbox_id = outbox_auditoria_runtime.id
        )
      `,
      orden: 'completada_en_utc, id',
      parametros: [graciaSegundos],
      limite
    });
  }

  async limpiarEjecucionesVerificacionHistoricas({ graciaSegundos, limite }) {
    return this.#eliminarPorSubconsulta({
      tabla: 'ejecuciones_verificacion_auditoria',
      columnaId: 'id',
      condicion: `
        verificado_en_utc <= TIMESTAMPADD(SECOND, -?, UTC_TIMESTAMP(3))
        AND NOT EXISTS (
          SELECT 1
          FROM diagnosticos_integridad_auditoria d
          WHERE d.ultima_ejecucion_id = ejecuciones_verificacion_auditoria.ejecucion_id
        )
        AND NOT EXISTS (
          SELECT 1
          FROM incidentes_integridad_auditoria i
          WHERE i.primera_ejecucion_id = ejecuciones_verificacion_auditoria.ejecucion_id
             OR i.ultima_ejecucion_id = ejecuciones_verificacion_auditoria.ejecucion_id
        )
      `,
      orden: 'verificado_en_utc, id',
      parametros: [graciaSegundos],
      limite
    });
  }

  async limpiarIncidentesIntegridadResueltos({ graciaSegundos, limite }) {
    return this.#eliminarPorSubconsulta({
      tabla: 'incidentes_integridad_auditoria',
      columnaId: 'id',
      condicion: `
        estado_deteccion = 'resuelto'
        AND resuelto_en_utc <= TIMESTAMPADD(SECOND, -?, UTC_TIMESTAMP(3))
      `,
      orden: 'resuelto_en_utc, id',
      parametros: [graciaSegundos],
      limite
    });
  }

  async #eliminarPorSubconsulta({
    tabla,
    columnaId,
    condicion,
    orden,
    parametros,
    limite
  }) {
    const maximo = enteroAcotado(limite, 1, 5000, 'limite');
    const conexion = await this.clienteSql.obtenerConexion();
    try {
      await conexion.beginTransaction();
      const [filas] = await conexion.execute(
        `
          SELECT ${columnaId} AS id
          FROM ${tabla}
          WHERE ${condicion}
          ORDER BY ${orden}
          LIMIT ?
          FOR UPDATE SKIP LOCKED
        `,
        [...parametros, maximo]
      );
      if (filas.length === 0) {
        await conexion.commit();
        return Object.freeze({ eliminadas: 0 });
      }
      const ids = filas.map((fila) => fila.id);
      const [resultado] = await conexion.execute(
        `
          DELETE FROM ${tabla}
          WHERE ${columnaId} IN (${ids.map(() => '?').join(', ')})
        `,
        ids
      );
      await conexion.commit();
      return Object.freeze({ eliminadas: Number(resultado.affectedRows) || 0 });
    } catch (error) {
      await rollbackSeguro(conexion);
      throw error;
    } finally {
      conexion.release();
    }
  }
}

function enteroAcotado(valor, minimo, maximo, nombre) {
  const numero = Number(valor);
  if (!Number.isInteger(numero) || numero < minimo || numero > maximo) {
    throw new Error(`${nombre} debe estar entre ${minimo} y ${maximo}.`);
  }
  return numero;
}

async function rollbackSeguro(conexion) {
  try {
    await conexion.rollback();
  } catch {
    // La excepción original conserva la autoridad diagnóstica.
  }
}

export const __testablesRepositorioLimpiezaTecnicaAuditoriaSql = Object.freeze({
  NOMBRE_BLOQUEO_LIMPIEZA_TECNICA
});

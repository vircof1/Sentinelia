const NOMBRE_BLOQUEO_RETENCION_AUDITORIA = 'sentinelia:auditoria:retencion-global';

export class RepositorioCoordinacionRetencionAuditoriaSql {
  constructor({ clienteSql } = {}) {
    if (!clienteSql?.obtenerConexion) {
      throw new Error('RepositorioCoordinacionRetencionAuditoriaSql requiere cliente SQL.');
    }
    this.clienteSql = clienteSql;
  }

  async ejecutarConBloqueoGlobal({ timeoutSegundos = 0 } = {}, tarea) {
    if (typeof tarea !== 'function') {
      throw new Error('La retención global requiere una tarea ejecutable.');
    }
    const conexion = await this.clienteSql.obtenerConexion();
    let adquirido = false;
    try {
      const [filas] = await conexion.execute('SELECT GET_LOCK(?, ?) AS adquirido', [
        NOMBRE_BLOQUEO_RETENCION_AUDITORIA,
        Math.max(0, Number(timeoutSegundos) || 0)
      ]);
      adquirido = Number(filas[0]?.adquirido) === 1;
      if (!adquirido) {
        return Object.freeze({
          adquirido: false,
          motivo: 'bloqueo_global_ocupado'
        });
      }
      const resultado = await tarea();
      return Object.freeze({
        adquirido: true,
        resultado
      });
    } finally {
      try {
        if (adquirido) await conexion.execute('SELECT RELEASE_LOCK(?)', [NOMBRE_BLOQUEO_RETENCION_AUDITORIA]);
      } finally {
        conexion.release();
      }
    }
  }

  async listarClavesCadenas({ limite, cursorClaveCadena = null } = {}) {
    const conexion = await this.clienteSql.obtenerConexion();
    try {
      const [filas] = await conexion.execute(
        `
          SELECT clave_cadena
          FROM cadenas_auditoria
          WHERE (? IS NULL OR clave_cadena > ?)
          ORDER BY clave_cadena ASC
          LIMIT ?
        `,
        [
          cursorClaveCadena,
          cursorClaveCadena,
          Math.max(1, Number(limite) || 1)
        ]
      );
      return Object.freeze(
        filas.map((fila) => Object.freeze({ claveCadena: fila.clave_cadena }))
      );
    } finally {
      conexion.release();
    }
  }
}

export const __testablesRepositorioCoordinacionRetencionAuditoriaSql = Object.freeze({
  NOMBRE_BLOQUEO_RETENCION_AUDITORIA
});

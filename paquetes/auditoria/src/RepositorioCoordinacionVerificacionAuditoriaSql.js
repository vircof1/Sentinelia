import { randomBytes } from 'node:crypto';

const MAX_BIGINT_UNSIGNED = 18_446_744_073_709_551_615n;

export class RepositorioCoordinacionVerificacionAuditoriaSql {
  constructor({ clienteSql = null, conexion = null } = {}) {
    if (!clienteSql && !conexion?.execute) {
      throw new Error('RepositorioCoordinacionVerificacionAuditoriaSql requiere clienteSql o conexión SQL.');
    }
    this.clienteSql = clienteSql;
    this.conexion = conexion;
  }

  async comprobarCabecerasRapido({ limite = 50 } = {}) {
    return this.#usarConexion(async (conexion) => {
      const [filas] = await conexion.execute(
        `
          SELECT
            c.clave_cadena,
            CAST(c.ultima_secuencia AS CHAR) AS ultima_secuencia,
            HEX(c.ultimo_hash) AS ultimo_hash,
            d.estado_verificacion,
            CAST(d.hasta_secuencia AS CHAR) AS hasta_secuencia,
            d.pendiente_revision
          FROM cadenas_auditoria c
          LEFT JOIN diagnosticos_integridad_auditoria d
            ON d.clave_cadena = c.clave_cadena
          ORDER BY c.clave_cadena ASC
          LIMIT ?
        `,
        [Number(limite)]
      );
      return Object.freeze(filas.map((fila) => Object.freeze({
        claveCadena: fila.clave_cadena,
        ultimaSecuencia: String(fila.ultima_secuencia),
        ultimoHash: String(fila.ultimo_hash || '').toLowerCase(),
        diagnosticoEstado: fila.estado_verificacion ?? null,
        diagnosticoHastaSecuencia: fila.hasta_secuencia == null ? null : String(fila.hasta_secuencia),
        pendienteRevision: Boolean(fila.pendiente_revision)
      })));
    });
  }

  async reclamarLease({ instanciaId, ttlSegundos = 300, leaseToken = randomBytes(32) } = {}) {
    const instancia = validarInstancia(instanciaId);
    const token = bufferExacto(leaseToken, 32, 'leaseToken');
    return this.#usarConexion(async (conexion) => {
      await conexion.beginTransaction();
      try {
        const cabecera = await bloquearCabecera(conexion);
        if (cabecera.leaseVigente) {
          await conexion.rollback();
          return null;
        }
        const fencingToken = siguienteFencing(cabecera.fencingToken);
        await conexion.execute(
          `
            UPDATE cabecera_verificacion_auditoria
            SET instancia_id = ?,
                lease_token = ?,
                lease_expira_utc = TIMESTAMPADD(SECOND, ?, UTC_TIMESTAMP(3)),
                fencing_token = ?
            WHERE id = 1
          `,
          [instancia, token, Number(ttlSegundos), fencingToken]
        );
        await conexion.commit();
        return Object.freeze({
          instanciaId: instancia,
          leaseToken: token,
          fencingToken
        });
      } catch (error) {
        await rollbackSeguro(conexion);
        throw error;
      }
    });
  }

  async renovarLease(lease, { ttlSegundos = 300 } = {}) {
    return this.#usarConexion(async (conexion) => {
      const [resultado] = await conexion.execute(
        `
          UPDATE cabecera_verificacion_auditoria
          SET lease_expira_utc = TIMESTAMPADD(SECOND, ?, UTC_TIMESTAMP(3))
          WHERE id = 1
            AND instancia_id = ?
            AND lease_token = ?
            AND fencing_token = ?
            AND lease_expira_utc > UTC_TIMESTAMP(3)
        `,
        [
          Number(ttlSegundos),
          lease.instanciaId,
          bufferExacto(lease.leaseToken, 32, 'leaseToken'),
          String(lease.fencingToken)
        ]
      );
      return Number(resultado.affectedRows) === 1;
    });
  }

  async liberarLease(lease, { cursorClaveCadena = null } = {}) {
    return this.#usarConexion(async (conexion) => {
      const [resultado] = await conexion.execute(
        `
          UPDATE cabecera_verificacion_auditoria
          SET instancia_id = NULL,
              lease_token = NULL,
              lease_expira_utc = NULL,
              cursor_clave_cadena = ?,
              ultima_ejecucion_utc = UTC_TIMESTAMP(3)
          WHERE id = 1
            AND instancia_id = ?
            AND lease_token = ?
            AND fencing_token = ?
        `,
        [
          cursorClaveCadena,
          lease.instanciaId,
          bufferExacto(lease.leaseToken, 32, 'leaseToken'),
          String(lease.fencingToken)
        ]
      );
      return Number(resultado.affectedRows) === 1;
    });
  }

  async seleccionarCadenasRotacion({ limite = 10 } = {}) {
    return this.#usarConexion(async (conexion) => {
      const cabecera = await leerCabecera(conexion);
      const cursor = cabecera.cursorClaveCadena;
      const [posteriores] = await conexion.execute(
        `
          SELECT clave_cadena
          FROM cadenas_auditoria
          WHERE (? IS NULL OR clave_cadena > ?)
          ORDER BY clave_cadena ASC
          LIMIT ?
        `,
        [cursor, cursor, Number(limite)]
      );
      if (posteriores.length >= Number(limite)) return posteriores.map(mapearClave);
      const restantes = Number(limite) - posteriores.length;
      const [iniciales] = await conexion.execute(
        `
          SELECT clave_cadena
          FROM cadenas_auditoria
          WHERE (? IS NULL OR clave_cadena <= ?)
          ORDER BY clave_cadena ASC
          LIMIT ?
        `,
        [cursor, cursor, restantes]
      );
      return Object.freeze([...posteriores, ...iniciales].map(mapearClave));
    });
  }

  async #usarConexion(tarea) {
    if (this.conexion) return tarea(this.conexion);
    const conexion = await this.clienteSql.obtenerConexion();
    try {
      return await tarea(conexion);
    } finally {
      conexion.release();
    }
  }
}

async function bloquearCabecera(conexion) {
  const [filas] = await conexion.execute(
    `
      SELECT
        instancia_id,
        lease_token,
        lease_expira_utc,
        CAST(fencing_token AS CHAR) AS fencing_token,
        cursor_clave_cadena,
        lease_expira_utc IS NOT NULL AND lease_expira_utc > UTC_TIMESTAMP(3) AS lease_vigente
      FROM cabecera_verificacion_auditoria
      WHERE id = 1
      LIMIT 1
      FOR UPDATE
    `
  );
  if (filas.length !== 1) throw new Error('Falta cabecera de verificación de auditoría.');
  return mapearCabecera(filas[0]);
}

async function leerCabecera(conexion) {
  const [filas] = await conexion.execute(
    `
      SELECT
        CAST(fencing_token AS CHAR) AS fencing_token,
        cursor_clave_cadena,
        lease_expira_utc IS NOT NULL AND lease_expira_utc > UTC_TIMESTAMP(3) AS lease_vigente
      FROM cabecera_verificacion_auditoria
      WHERE id = 1
      LIMIT 1
    `
  );
  if (filas.length !== 1) throw new Error('Falta cabecera de verificación de auditoría.');
  return mapearCabecera(filas[0]);
}

function mapearCabecera(fila) {
  return Object.freeze({
    fencingToken: String(fila.fencing_token),
    cursorClaveCadena: fila.cursor_clave_cadena ?? null,
    leaseVigente: Boolean(fila.lease_vigente)
  });
}

function mapearClave(fila) {
  return Object.freeze({ claveCadena: fila.clave_cadena });
}

function siguienteFencing(actual) {
  const valor = BigInt(actual);
  if (valor >= MAX_BIGINT_UNSIGNED) {
    throw new Error('El fencing de verificación de auditoría agotó BIGINT UNSIGNED.');
  }
  return String(valor + 1n);
}

function validarInstancia(valor) {
  if (typeof valor !== 'string' || !/^[a-zA-Z0-9_.:-]{1,128}$/.test(valor)) {
    throw new Error('instanciaId de verificación no válido.');
  }
  return valor;
}

function bufferExacto(valor, bytes, nombre) {
  const buffer = Buffer.from(valor);
  if (buffer.length !== bytes) throw new Error(`${nombre} debe tener ${bytes} bytes.`);
  return buffer;
}

async function rollbackSeguro(conexion) {
  try {
    await conexion.rollback();
  } catch {
    // La excepción original conserva la autoridad diagnóstica.
  }
}

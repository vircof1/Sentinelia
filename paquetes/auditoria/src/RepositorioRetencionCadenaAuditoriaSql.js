import { uuidV7AuditoriaABytes } from './UuidV7Auditoria.js';

export class RepositorioRetencionCadenaAuditoriaSql {
  constructor({ clienteSql = null, conexion = null } = {}) {
    if (!clienteSql && !conexion?.execute) {
      throw new Error('RepositorioRetencionCadenaAuditoriaSql requiere clienteSql o conexión SQL.');
    }
    this.clienteSql = clienteSql;
    this.conexion = conexion;
  }

  async preflightPrefijo({ claveCadena, corteUtc, limiteEventos }) {
    return this.#usarConexion(async (conexion) => {
      const cabecera = await leerCabecera(conexion, claveCadena, false);
      if (!cabecera) return Object.freeze({ aplicable: false, motivo: 'cadena_ausente' });
      const [filas] = await conexion.execute(
        `
          SELECT
            evento_id,
            productor,
            clave_operacion,
            rol_evento,
            CAST(secuencia AS CHAR) AS secuencia,
            HEX(hash_anterior) AS hash_anterior,
            HEX(hash_actual) AS hash_actual,
            DATE_FORMAT(registrado_en_utc, '%Y-%m-%dT%H:%i:%s.%fZ') AS registrado_en_utc
          FROM eventos_auditoria
          WHERE cadena_id = ?
            AND registrado_en_utc < ?
          ORDER BY eventos_auditoria.secuencia ASC
          LIMIT ?
        `,
        [cabecera.id, fechaUtcASql(corteUtc), Number(limiteEventos)]
      );
      if (filas.length === 0) return Object.freeze({ aplicable: false, motivo: 'sin_prefijo_vencido' });
      validarPrefijo(filas);
      const ultima = filas.at(-1);
      return Object.freeze({
        aplicable: true,
        cadenaId: cabecera.id,
        claveCadena,
        corteUtc,
        secuenciaDesde: filas[0].secuencia,
        secuenciaHasta: ultima.secuencia,
        hashAnteriorAlTramo: filas[0].hash_anterior.toLowerCase(),
        hashHasta: ultima.hash_actual.toLowerCase(),
        primeraSecuenciaConservada: BigInt(ultima.secuencia) < cabecera.ultimaSecuencia
          ? String(BigInt(ultima.secuencia) + 1n)
          : null,
        eventoIds: Object.freeze(filas.map((fila) => Buffer.from(fila.evento_id))),
        identidades: Object.freeze(filas.map((fila) => Object.freeze({
          productor: fila.productor,
          claveOperacion: Buffer.from(fila.clave_operacion).toString('ascii'),
          rolEvento: fila.rol_evento
        }))),
        cabecera: Object.freeze({
          ultimaSecuencia: String(cabecera.ultimaSecuencia),
          ultimoHash: cabecera.ultimoHash.toString('hex')
        })
      });
    });
  }

  async enTransaccion(tarea) {
    if (this.conexion) return tarea({ repositorio: this, conexion: this.conexion });
    const conexion = await this.clienteSql.obtenerConexion();
    try {
      await conexion.beginTransaction();
      const repositorio = new RepositorioRetencionCadenaAuditoriaSql({ conexion });
      const resultado = await tarea({ repositorio, conexion });
      await conexion.commit();
      return resultado;
    } catch (error) {
      await rollbackSeguro(conexion);
      throw error;
    } finally {
      conexion.release();
    }
  }

  async bloquearIdentidadesPrefijo(plan) {
    const identidades = [...plan.identidades].sort(compararIdentidad);
    for (const identidad of identidades) {
      await this.conexion.execute(
        `
          SELECT id
          FROM identidades_idempotentes_auditoria
          WHERE productor = ? AND clave_operacion = ? AND rol_evento = ?
          LIMIT 1
          FOR UPDATE
        `,
        [
          identidad.productor,
          Buffer.from(identidad.claveOperacion, 'ascii'),
          identidad.rolEvento
        ]
      );
    }
  }

  async bloquearCabeceras(plan) {
    await leerCabecera(this.conexion, plan.claveCadena, true);
  }

  async revalidarPrefijo(plan) {
    const actual = await this.preflightPrefijo({
      claveCadena: plan.claveCadena,
      corteUtc: plan.corteUtc,
      limiteEventos: plan.eventoIds.length
    });
    if (!actual.aplicable ||
        actual.secuenciaDesde !== plan.secuenciaDesde ||
        actual.secuenciaHasta !== plan.secuenciaHasta ||
        actual.hashAnteriorAlTramo !== plan.hashAnteriorAlTramo ||
        actual.hashHasta !== plan.hashHasta) {
      throw new Error('El prefijo auditable cambió durante la retención.');
    }
    return plan;
  }

  async aplicarRecorte(plan, { eventoRetencionId, dias, aplicadoEnUtc }) {
    const lugares = plan.eventoIds.map(() => '?').join(', ');
    await this.conexion.execute(
      `
        UPDATE identidades_idempotentes_auditoria
        SET estado = 'retenido', retenido_en_utc = ?
        WHERE evento_id IN (${lugares})
      `,
      [fechaUtcASql(aplicadoEnUtc), ...plan.eventoIds]
    );
    await this.conexion.execute(
      `DELETE FROM eventos_auditoria WHERE evento_id IN (${lugares})`,
      plan.eventoIds
    );
    await this.conexion.execute(
      `
        INSERT INTO checkpoints_auditoria (
          cadena_id, ultima_secuencia_retirada, hash_ultima_secuencia_retirada,
          primera_secuencia_conservada, politica_dias, aplicado_en_utc,
          evento_retencion_id
        ) VALUES (?, ?, ?, ?, ?, ?, ?)
        ON DUPLICATE KEY UPDATE
          ultima_secuencia_retirada = VALUES(ultima_secuencia_retirada),
          hash_ultima_secuencia_retirada = VALUES(hash_ultima_secuencia_retirada),
          primera_secuencia_conservada = VALUES(primera_secuencia_conservada),
          politica_dias = VALUES(politica_dias),
          aplicado_en_utc = VALUES(aplicado_en_utc),
          evento_retencion_id = VALUES(evento_retencion_id)
      `,
      [
        plan.cadenaId,
        plan.secuenciaHasta,
        Buffer.from(plan.hashHasta, 'hex'),
        plan.primeraSecuenciaConservada,
        dias,
        fechaUtcASql(aplicadoEnUtc),
        uuidV7AuditoriaABytes(eventoRetencionId)
      ]
    );
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

async function leerCabecera(conexion, claveCadena, bloquear) {
  const [filas] = await conexion.execute(
    `
      SELECT
        id,
        CAST(ultima_secuencia AS CHAR) AS ultima_secuencia,
        ultimo_hash
      FROM cadenas_auditoria
      WHERE clave_cadena = ?
      LIMIT 1
      ${bloquear ? 'FOR UPDATE' : ''}
    `,
    [claveCadena]
  );
  if (filas.length === 0) return null;
  return Object.freeze({
    id: Number(filas[0].id),
    ultimaSecuencia: BigInt(filas[0].ultima_secuencia),
    ultimoHash: Buffer.from(filas[0].ultimo_hash)
  });
}

function validarPrefijo(filas) {
  for (let indice = 0; indice < filas.length; indice += 1) {
    const esperado = BigInt(filas[0].secuencia) + BigInt(indice);
    if (BigInt(filas[indice].secuencia) !== esperado) {
      throw new Error('La retención solo puede retirar un prefijo consecutivo.');
    }
  }
}

function compararIdentidad(a, b) {
  for (const campo of ['productor', 'claveOperacion', 'rolEvento']) {
    const comparacion = Buffer.compare(
      Buffer.from(a[campo], 'ascii'),
      Buffer.from(b[campo], 'ascii')
    );
    if (comparacion !== 0) return comparacion;
  }
  return 0;
}

function fechaUtcASql(fecha) {
  return String(fecha).slice(0, -1).replace('T', ' ');
}

async function rollbackSeguro(conexion) {
  try {
    await conexion.rollback();
  } catch {
    // La excepción original conserva la autoridad diagnóstica.
  }
}

import { uuidV7AuditoriaABytes, bytesAUuidV7Auditoria } from './UuidV7Auditoria.js';

export class RepositorioDiagnosticosIntegridadAuditoriaSql {
  constructor({ clienteSql = null, conexion = null } = {}) {
    if (!clienteSql && !conexion?.execute) {
      throw new Error('RepositorioDiagnosticosIntegridadAuditoriaSql requiere clienteSql o conexión SQL.');
    }
    this.clienteSql = clienteSql;
    this.conexion = conexion;
  }

  conConexion(conexion) {
    return new RepositorioDiagnosticosIntegridadAuditoriaSql({ conexion });
  }

  async enTransaccion(tarea) {
    if (this.conexion) return tarea({ repositorio: this, conexion: this.conexion });
    const conexion = await this.clienteSql.obtenerConexion();
    try {
      await conexion.beginTransaction();
      const repositorio = this.conConexion(conexion);
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

  async guardarEjecucion(ejecucion) {
    return this.#usarConexion((conexion) => conexion.execute(
      `
        INSERT INTO ejecuciones_verificacion_auditoria (
          ejecucion_id, clave_cadena, estado_verificacion,
          desde_secuencia, hasta_secuencia, ultima_secuencia_verificada,
          hash_final_verificado, hash_final_esperado,
          cabecera_ultima_secuencia, cabecera_ultimo_hash,
          paginas, eventos_verificados, verificado_en_utc, diagnostico
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
      [
        uuidV7AuditoriaABytes(ejecucion.ejecucionId),
        ejecucion.claveCadena,
        ejecucion.estadoVerificacion,
        ejecucion.desdeSecuencia,
        ejecucion.hastaSecuencia,
        ejecucion.ultimaSecuenciaVerificada,
        hashONull(ejecucion.hashFinalVerificado),
        hashONull(ejecucion.hashFinalEsperado),
        ejecucion.cabeceraUltimaSecuencia,
        hashONull(ejecucion.cabeceraUltimoHash),
        ejecucion.paginas,
        ejecucion.eventosVerificados,
        fechaUtcASql(ejecucion.verificadoEnUtc),
        JSON.stringify(ejecucion.detalle)
      ]
    ));
  }

  async actualizarDiagnosticoVigente(diagnostico) {
    return this.#usarConexion((conexion) => conexion.execute(
      `
        INSERT INTO diagnosticos_integridad_auditoria (
          clave_cadena, estado_verificacion, pendiente_revision,
          desde_secuencia, hasta_secuencia, ultima_secuencia_verificada,
          hash_final_verificado, hash_final_esperado,
          cabecera_ultima_secuencia, cabecera_ultimo_hash,
          ultima_ejecucion_id, actualizado_en_utc, diagnostico
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON DUPLICATE KEY UPDATE
          estado_verificacion = VALUES(estado_verificacion),
          pendiente_revision = VALUES(pendiente_revision),
          desde_secuencia = VALUES(desde_secuencia),
          hasta_secuencia = VALUES(hasta_secuencia),
          ultima_secuencia_verificada = VALUES(ultima_secuencia_verificada),
          hash_final_verificado = VALUES(hash_final_verificado),
          hash_final_esperado = VALUES(hash_final_esperado),
          cabecera_ultima_secuencia = VALUES(cabecera_ultima_secuencia),
          cabecera_ultimo_hash = VALUES(cabecera_ultimo_hash),
          ultima_ejecucion_id = VALUES(ultima_ejecucion_id),
          actualizado_en_utc = VALUES(actualizado_en_utc),
          diagnostico = VALUES(diagnostico)
      `,
      [
        diagnostico.claveCadena,
        diagnostico.estadoVerificacion,
        diagnostico.pendienteRevision ? 1 : 0,
        diagnostico.desdeSecuencia,
        diagnostico.hastaSecuencia,
        diagnostico.ultimaSecuenciaVerificada,
        hashONull(diagnostico.hashFinalVerificado),
        hashONull(diagnostico.hashFinalEsperado),
        diagnostico.cabeceraUltimaSecuencia,
        hashONull(diagnostico.cabeceraUltimoHash),
        uuidV7AuditoriaABytes(diagnostico.ejecucionId),
        fechaUtcASql(diagnostico.verificadoEnUtc),
        JSON.stringify(diagnostico.detalle)
      ]
    ));
  }

  async abrirOActualizarIncidente(incidente) {
    return this.#usarConexion(async (conexion) => {
      const [existentes] = await conexion.execute(
      `
        SELECT episodio_id, primera_deteccion_utc
        FROM incidentes_integridad_auditoria
        WHERE huella_activa = ?
        LIMIT 1
        FOR UPDATE
      `,
        [Buffer.from(incidente.huella, 'hex')]
      );
      if (existentes.length > 0) {
        await conexion.execute(
        `
          UPDATE incidentes_integridad_auditoria
          SET ultima_deteccion_utc = ?,
              ultima_ejecucion_id = ?,
              detalle = ?
          WHERE huella_activa = ?
        `,
        [
          fechaUtcASql(incidente.ultimaDeteccionUtc),
          uuidV7AuditoriaABytes(incidente.ultimaEjecucionId),
          JSON.stringify(incidente.detalle),
          Buffer.from(incidente.huella, 'hex')
          ]
        );
        return Object.freeze({
          ...incidente,
          episodioId: bytesAUuidV7Auditoria(existentes[0].episodio_id),
          repetido: true
        });
      }
      await conexion.execute(
      `
        INSERT INTO incidentes_integridad_auditoria (
          episodio_id, huella, clave_cadena, codigo, estado_verificacion,
          estado_deteccion, primera_deteccion_utc, ultima_deteccion_utc,
          primera_ejecucion_id, ultima_ejecucion_id, detalle
        ) VALUES (?, ?, ?, ?, ?, 'activo', ?, ?, ?, ?, ?)
      `,
      [
        uuidV7AuditoriaABytes(incidente.episodioId),
        Buffer.from(incidente.huella, 'hex'),
        incidente.claveCadena,
        incidente.codigo,
        incidente.estadoVerificacion,
        fechaUtcASql(incidente.primeraDeteccionUtc),
        fechaUtcASql(incidente.ultimaDeteccionUtc),
        uuidV7AuditoriaABytes(incidente.primeraEjecucionId),
        uuidV7AuditoriaABytes(incidente.ultimaEjecucionId),
        JSON.stringify(incidente.detalle)
        ]
      );
      return Object.freeze({ ...incidente, repetido: false });
    });
  }

  async resolverIncidentesCadena({ claveCadena, fecha, ejecucionId }) {
    return this.#usarConexion((conexion) => conexion.execute(
      `
        UPDATE incidentes_integridad_auditoria
        SET estado_deteccion = 'resuelto',
            resuelto_en_utc = ?,
            ultima_ejecucion_id = ?
        WHERE clave_cadena = ? AND estado_deteccion = 'activo'
      `,
      [fechaUtcASql(fecha), uuidV7AuditoriaABytes(ejecucionId), claveCadena]
    ));
  }

  async bloquearIncidenteActivo({ episodioId }) {
    return this.#usarConexion(async (conexion) => {
      const [filas] = await conexion.execute(
      `
        SELECT episodio_id, HEX(huella) AS huella, clave_cadena, estado_deteccion
        FROM incidentes_integridad_auditoria
        WHERE episodio_id = ?
        LIMIT 1
        FOR UPDATE
      `,
        [uuidV7AuditoriaABytes(episodioId)]
      );
      if (filas.length !== 1 || filas[0].estado_deteccion !== 'activo') {
        throw new Error('El incidente no está activo o no existe.');
      }
      return Object.freeze({
        episodioId: bytesAUuidV7Auditoria(filas[0].episodio_id),
        huella: filas[0].huella.toLowerCase(),
        claveCadena: filas[0].clave_cadena
      });
    });
  }

  async confirmarReconocimiento({ episodioId, usuarioId, comentario, eventoReconocimientoId, fecha }) {
    return this.#usarConexion(async (conexion) => {
      const [resultado] = await conexion.execute(
      `
        UPDATE incidentes_integridad_auditoria
        SET reconocido_en_utc = ?,
            reconocido_por_usuario_id = ?,
            comentario_reconocimiento = ?,
            evento_reconocimiento_id = ?
        WHERE episodio_id = ? AND estado_deteccion = 'activo'
      `,
      [
        fechaUtcASql(fecha),
        usuarioId,
        comentario,
        uuidV7AuditoriaABytes(eventoReconocimientoId),
        uuidV7AuditoriaABytes(episodioId)
        ]
      );
      if (Number(resultado.affectedRows) !== 1) {
        throw new Error('No se pudo confirmar el reconocimiento del incidente.');
      }
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

function hashONull(valor) {
  if (valor == null) return null;
  if (!/^[0-9a-f]{64}$/.test(String(valor))) {
    throw new Error('Hash de diagnóstico no canónico.');
  }
  return Buffer.from(valor, 'hex');
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

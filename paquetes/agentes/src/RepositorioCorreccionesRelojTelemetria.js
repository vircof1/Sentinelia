import { normalizarMarcaUtc } from '../../utilidades/src/fechas/normalizarMarcaUtc.js';

const CHECKPOINT_ID = 1;
const MAX_BIGINT_UNSIGNED = (1n << 64n) - 1n;

export class RepositorioCorreccionesRelojTelemetria {
  constructor(clienteSql, { lectorRelojSql = leerRelojSql } = {}) {
    if (typeof clienteSql?.obtenerConexion !== 'function') {
      throw new Error('El checkpoint de reloj relativo exige SQL transaccional.');
    }
    if (typeof lectorRelojSql !== 'function') {
      throw new Error('El lector del reloj SQL relativo debe ser una función.');
    }
    this.clienteSql = clienteSql;
    this.lectorRelojSql = lectorRelojSql;
  }

  async observarReloj() {
    const conexion = await this.clienteSql.obtenerConexion();
    try {
      await conexion.beginTransaction();
      const checkpoint = await bloquearCheckpoint(conexion);
      const relojActualUtc = normalizarSegundoUtc(
        await this.lectorRelojSql(conexion),
        'El reloj SQL relativo no devolvió un instante válido.'
      );
      const relojAnteriorUtc = normalizarSegundoUtcOpcional(
        checkpoint.ultimo_reloj_aceptado_utc
      );
      let resultado;
      if (!relojAnteriorUtc) {
        await actualizarCheckpoint(conexion, {
          relojActualUtc,
          generacionCorreccion: checkpoint.generacion_correccion
        });
        resultado = construirResultadoObservacion({
          clasificacion: 'inicializado',
          relojAnteriorUtc: null,
          relojActualUtc,
          generacionCorreccion: checkpoint.generacion_correccion,
          leasesCercados: 0,
          reconciliacionCreada: false
        });
      } else {
        const diferenciaSegundos = segundosEntre(relojAnteriorUtc, relojActualUtc);
        if (diferenciaSegundos >= 0n) {
          if (diferenciaSegundos > 0n) {
            await actualizarCheckpoint(conexion, {
              relojActualUtc,
              generacionCorreccion: checkpoint.generacion_correccion
            });
          }
          resultado = construirResultadoObservacion({
            clasificacion: diferenciaSegundos === 0n ? 'repeticion' : 'avance',
            relojAnteriorUtc,
            relojActualUtc,
            generacionCorreccion: checkpoint.generacion_correccion,
            leasesCercados: 0,
            reconciliacionCreada: false
          });
        } else {
          const generacionCorreccion = siguienteGeneracion(
            checkpoint.generacion_correccion
          );
          await actualizarCheckpoint(conexion, {
            relojActualUtc,
            generacionCorreccion
          });
          await conexion.execute(
            `INSERT INTO reconciliaciones_reloj_relativo_telemetria (
               generacion_correccion,reloj_anterior_utc,reloj_corregido_utc
             ) VALUES (?,?,?)`,
            [generacionCorreccion.toString(), new Date(relojAnteriorUtc),
              new Date(relojActualUtc)]
          );
          const leasesCercados = await devolverLeasesRelativosAReclamacion(
            conexion,
            relojActualUtc
          );
          resultado = construirResultadoObservacion({
            clasificacion: 'retroceso',
            relojAnteriorUtc,
            relojActualUtc,
            generacionCorreccion,
            leasesCercados,
            reconciliacionCreada: true
          });
        }
      }
      await conexion.commit();
      return resultado;
    } catch (error) {
      await rollbackSeguro(conexion);
      throw error;
    } finally {
      conexion.release();
    }
  }

  async procesarSiguienteLote({
    limite = 100,
    aplicarReglaEnTransaccion
  } = {}) {
    const limiteNormalizado = normalizarLimite(limite);
    if (typeof aplicarReglaEnTransaccion !== 'function') {
      throw new Error('El barrido de reloj exige un aplicador transaccional.');
    }
    const conexion = await this.clienteSql.obtenerConexion();
    try {
      await conexion.query('SET TRANSACTION ISOLATION LEVEL READ COMMITTED');
      await conexion.beginTransaction();
      const reconciliacion = await bloquearSiguienteReconciliacion(conexion);
      if (!reconciliacion) {
        await conexion.commit();
        return null;
      }
      const candidatas = await bloquearReglasDelLote(conexion, {
        cursorReglaId: reconciliacion.cursor_regla_id,
        limite: limiteNormalizado + 1
      });
      const hayMas = candidatas.length > limiteNormalizado;
      const lote = candidatas.slice(0, limiteNormalizado);
      for (const candidata of lote) {
        const fotografia = await bloquearFotografia(conexion, candidata);
        await aplicarReglaEnTransaccion({
          reconciliacion: serializarReconciliacion(reconciliacion),
          regla: serializarRegla(candidata),
          revision: serializarRevision(candidata),
          fotografia
        }, { conexion });
      }
      const cursorReglaId = lote.length > 0
        ? BigInt(lote.at(-1).regla_id)
        : BigInt(reconciliacion.cursor_regla_id);
      const completada = !hayMas;
      const [actualizacion] = await conexion.execute(
        `UPDATE reconciliaciones_reloj_relativo_telemetria
            SET cursor_regla_id=?,
                reglas_procesadas=reglas_procesadas+?,
                estado=?,
                completada_en_utc=IF(?,UTC_TIMESTAMP(6),NULL)
          WHERE generacion_correccion=? AND estado='pendiente'`,
        [cursorReglaId.toString(), lote.length,
          completada ? 'completada' : 'pendiente', completada ? 1 : 0,
          String(reconciliacion.generacion_correccion)]
      );
      if (Number(actualizacion.affectedRows) !== 1) {
        throw new Error('La reconciliación de reloj perdió su autoridad.');
      }
      await conexion.commit();
      return Object.freeze({
        generacionCorreccion: String(reconciliacion.generacion_correccion),
        relojAnteriorUtc: normalizarMarcaUtc(reconciliacion.reloj_anterior_utc),
        relojCorregidoUtc: normalizarMarcaUtc(reconciliacion.reloj_corregido_utc),
        procesadas: lote.length,
        cursorReglaId: cursorReglaId.toString(),
        completada
      });
    } catch (error) {
      await rollbackSeguro(conexion);
      throw error;
    } finally {
      conexion.release();
    }
  }

  async obtenerCheckpoint() {
    const filas = await this.clienteSql.consultar(
      `SELECT id,ultimo_reloj_aceptado_utc,generacion_correccion
         FROM checkpoint_reloj_relativo_telemetria WHERE id=?`,
      [CHECKPOINT_ID]
    );
    return filas[0] ? serializarCheckpoint(filas[0]) : null;
  }

  async listarReconciliaciones() {
    const filas = await this.clienteSql.consultar(
      `SELECT generacion_correccion,reloj_anterior_utc,reloj_corregido_utc,
              cursor_regla_id,reglas_procesadas,estado,completada_en_utc
         FROM reconciliaciones_reloj_relativo_telemetria
        ORDER BY generacion_correccion`,
      []
    );
    return filas.map(serializarReconciliacion);
  }

  async obtenerDiagnostico() {
    const conexion = await this.clienteSql.obtenerConexion();
    try {
      await conexion.beginTransaction();
      const [reloj] = await conexion.execute(
        'SELECT UTC_TIMESTAMP(0) AS ahora_utc'
      );
      const ahoraUtc = reloj[0].ahora_utc;
      const [trabajos] = await conexion.execute(
        `SELECT
           COALESCE(SUM(t.estado IN ('pendiente','procesando','error')),0)
             AS pendientes,
           COALESCE(SUM(
             (t.estado IN ('pendiente','error') AND t.siguiente_intento_utc<=?)
             OR (t.estado='procesando' AND t.reclamo_expira_en_utc<=?)
           ),0) AS vencidos,
           COALESCE(MAX(CASE
             WHEN (t.estado IN ('pendiente','error') AND t.siguiente_intento_utc<=?)
               OR (t.estado='procesando' AND t.reclamo_expira_en_utc<=?)
             THEN GREATEST(TIMESTAMPDIFF(
               SECOND,COALESCE(t.programado_para_utc,t.siguiente_intento_utc),?
             ),0)
             ELSE 0
           END),0) AS retraso_maximo_segundos,
           COALESCE(SUM(t.estado='neutralizado'),0) AS neutralizados,
           COALESCE(SUM(t.intentos>1),0) AS reintentados,
           COALESCE(SUM(IF(t.intentos>0,t.intentos-1,0)),0) AS total_reintentos,
           COALESCE(SUM(
             t.estado='procesando' AND t.reclamo_expira_en_utc<=?
           ),0) AS leases_vencidos
         FROM trabajos_evaluacion_telemetria t
         INNER JOIN revisiones_reglas_derivacion_telemetria rv
           ON rv.id=t.regla_revision_id
        WHERE rv.condicion_tipo='momento_utc_relativo'`,
        [ahoraUtc, ahoraUtc, ahoraUtc, ahoraUtc, ahoraUtc, ahoraUtc]
      );
      const [fronteras] = await conexion.execute(
        `SELECT COUNT(*) AS total,
                COALESCE(MAX(GREATEST(
                  TIMESTAMPDIFF(SECOND,e.proxima_reevaluacion_utc,?),0
                )),0) AS retraso_maximo_segundos
           FROM estado_actual_evaluacion_reglas_telemetria e
           INNER JOIN reglas_derivacion_telemetria r ON r.id=e.regla_id
           INNER JOIN revisiones_reglas_derivacion_telemetria rv
             ON rv.id=r.revision_vigente_id AND rv.regla_id=r.id
          WHERE r.estado='activa'
            AND rv.condicion_tipo='momento_utc_relativo'
            AND e.generacion_autoridad=r.generacion_autoridad
            AND e.regla_revision_id=r.revision_vigente_id
            AND e.proxima_reevaluacion_utc IS NOT NULL
            AND e.proxima_reevaluacion_utc<=?`,
        [ahoraUtc, ahoraUtc]
      );
      const [correcciones] = await conexion.execute(
        `SELECT COUNT(*) AS total,
                COALESCE(SUM(estado='pendiente'),0) AS pendientes,
                MAX(generacion_correccion) AS ultima_generacion
           FROM reconciliaciones_reloj_relativo_telemetria`
      );
      const [checkpoint] = await conexion.execute(
        `SELECT ultimo_reloj_aceptado_utc,generacion_correccion
           FROM checkpoint_reloj_relativo_telemetria WHERE id=?`,
        [CHECKPOINT_ID]
      );
      await conexion.commit();
      const t = trabajos[0] || {};
      const c = correcciones[0] || {};
      return Object.freeze({
        observadoEnUtc: normalizarMarcaUtc(ahoraUtc),
        ultimoRelojAceptadoUtc:
          normalizarMarcaUtc(checkpoint[0]?.ultimo_reloj_aceptado_utc),
        generacionCorreccion: String(checkpoint[0]?.generacion_correccion || 0),
        trabajosRelativosPendientes: Number(t.pendientes || 0),
        trabajosRelativosVencidos: Number(t.vencidos || 0),
        retrasoMaximoSegundos: Math.max(
          Number(t.retraso_maximo_segundos || 0),
          Number(fronteras[0]?.retraso_maximo_segundos || 0)
        ),
        trabajosRelativosNeutralizados: Number(t.neutralizados || 0),
        trabajosRelativosReintentados: Number(t.reintentados || 0),
        totalReintentosRelativos: Number(t.total_reintentos || 0),
        leasesRelativosVencidos: Number(t.leases_vencidos || 0),
        fronterasNoEvaluadas: Number(fronteras[0]?.total || 0),
        correccionesTotales: Number(c.total || 0),
        correccionesPendientes: Number(c.pendientes || 0),
        ultimaGeneracionCorreccion:
          c.ultima_generacion == null ? null : String(c.ultima_generacion)
      });
    } catch (error) {
      await rollbackSeguro(conexion);
      throw error;
    } finally {
      conexion.release();
    }
  }
}

async function bloquearCheckpoint(conexion) {
  const [filas] = await conexion.execute(
    `SELECT id,ultimo_reloj_aceptado_utc,generacion_correccion
       FROM checkpoint_reloj_relativo_telemetria
      WHERE id=? FOR UPDATE`,
    [CHECKPOINT_ID]
  );
  if (filas.length !== 1) {
    throw new Error('El checkpoint singleton del reloj relativo no existe.');
  }
  return filas[0];
}

async function actualizarCheckpoint(conexion, {
  relojActualUtc,
  generacionCorreccion
}) {
  const [resultado] = await conexion.execute(
    `UPDATE checkpoint_reloj_relativo_telemetria
        SET ultimo_reloj_aceptado_utc=?,generacion_correccion=?
      WHERE id=?`,
    [new Date(relojActualUtc), String(generacionCorreccion), CHECKPOINT_ID]
  );
  if (Number(resultado.affectedRows) !== 1) {
    throw new Error('No se pudo avanzar el checkpoint del reloj relativo.');
  }
}

async function devolverLeasesRelativosAReclamacion(conexion, relojActualUtc) {
  const [resultado] = await conexion.execute(
    `UPDATE trabajos_evaluacion_telemetria t
       INNER JOIN revisiones_reglas_derivacion_telemetria rv
         ON rv.id=t.regla_revision_id
        SET t.estado='pendiente',
            t.siguiente_intento_utc=LEAST(t.siguiente_intento_utc,?),
            t.reclamado_por=NULL,
            t.reclamado_en_utc=NULL,
            t.reclamo_expira_en_utc=NULL,
            t.ultimo_codigo_error=NULL,
            t.ultimo_mensaje_error=NULL,
            t.completado_en_utc=NULL
      WHERE t.estado='procesando'
        AND rv.condicion_tipo='momento_utc_relativo'`,
    [new Date(relojActualUtc)]
  );
  return Number(resultado.affectedRows || 0);
}

async function bloquearSiguienteReconciliacion(conexion) {
  const [filas] = await conexion.execute(
    `SELECT generacion_correccion,reloj_anterior_utc,reloj_corregido_utc,
            cursor_regla_id,reglas_procesadas,estado,completada_en_utc
       FROM reconciliaciones_reloj_relativo_telemetria
      WHERE estado='pendiente'
      ORDER BY generacion_correccion
      LIMIT 1
      FOR UPDATE SKIP LOCKED`
  );
  return filas[0] || null;
}

async function bloquearReglasDelLote(conexion, { cursorReglaId, limite }) {
  const [filas] = await conexion.execute(
    `SELECT r.id AS regla_id,r.agente_id,r.senal_id,r.tenant_id,r.empresa_id,
            r.sitio_id,r.estado,r.revision_vigente_id,r.generacion_autoridad,
            rv.id AS revision_id,rv.regla_id AS revision_regla_id,
            rv.numero AS revision_numero,rv.condicion_tipo,rv.condicion_version,
            rv.vigente_desde_utc,rv.vigente_hasta_utc
       FROM reglas_derivacion_telemetria r
       INNER JOIN revisiones_reglas_derivacion_telemetria rv
         ON rv.id=r.revision_vigente_id AND rv.regla_id=r.id
      WHERE r.estado='activa'
        AND r.id>?
        AND rv.condicion_tipo='momento_utc_relativo'
        AND rv.condicion_version=1
      ORDER BY r.id
      LIMIT ${limite}
      FOR UPDATE`,
    [String(cursorReglaId)]
  );
  return filas;
}

async function bloquearFotografia(conexion, regla) {
  const [filas] = await conexion.execute(
    `SELECT id,agente_id,senal_id,ultima_observacion_id,recibido_en_utc
       FROM estado_actual_telemetria_agentes
      WHERE agente_id=? AND senal_id=?
      LIMIT 1 FOR UPDATE`,
    [regla.agente_id, regla.senal_id]
  );
  if (!filas[0]) return null;
  return Object.freeze({
    id: Number(filas[0].id),
    agenteId: Number(filas[0].agente_id),
    senalId: Number(filas[0].senal_id),
    ultimaObservacionId: Number(filas[0].ultima_observacion_id),
    recibidoEnUtc: normalizarMarcaUtc(filas[0].recibido_en_utc)
  });
}

function serializarCheckpoint(fila) {
  return Object.freeze({
    ultimoRelojAceptadoUtc: normalizarMarcaUtc(fila.ultimo_reloj_aceptado_utc),
    generacionCorreccion: String(fila.generacion_correccion)
  });
}

function serializarReconciliacion(fila) {
  return Object.freeze({
    generacionCorreccion: String(fila.generacion_correccion),
    relojAnteriorUtc: normalizarMarcaUtc(fila.reloj_anterior_utc),
    relojCorregidoUtc: normalizarMarcaUtc(fila.reloj_corregido_utc),
    cursorReglaId: String(fila.cursor_regla_id),
    reglasProcesadas: String(fila.reglas_procesadas),
    estado: fila.estado,
    completadaEnUtc: normalizarMarcaUtc(fila.completada_en_utc)
  });
}

function serializarRegla(fila) {
  return Object.freeze({
    id: Number(fila.regla_id),
    agenteId: Number(fila.agente_id),
    senalId: Number(fila.senal_id),
    tenantId: Number(fila.tenant_id),
    empresaId: Number(fila.empresa_id),
    sitioId: Number(fila.sitio_id),
    estado: fila.estado,
    revisionVigenteId: Number(fila.revision_vigente_id),
    generacionAutoridad: Number(fila.generacion_autoridad)
  });
}

function serializarRevision(fila) {
  return Object.freeze({
    id: Number(fila.revision_id),
    reglaId: Number(fila.revision_regla_id),
    numero: Number(fila.revision_numero),
    tipo: fila.condicion_tipo,
    version: Number(fila.condicion_version),
    vigenteDesdeUtc: normalizarMarcaUtc(fila.vigente_desde_utc),
    vigenteHastaUtc: normalizarMarcaUtc(fila.vigente_hasta_utc)
  });
}

function construirResultadoObservacion({
  clasificacion,
  relojAnteriorUtc,
  relojActualUtc,
  generacionCorreccion,
  leasesCercados,
  reconciliacionCreada
}) {
  return Object.freeze({
    clasificacion,
    relojAnteriorUtc,
    relojActualUtc,
    generacionCorreccion: String(generacionCorreccion),
    leasesCercados,
    reconciliacionCreada
  });
}

async function leerRelojSql(conexion) {
  const [filas] = await conexion.execute('SELECT UTC_TIMESTAMP(0) AS ahora_utc');
  return filas[0]?.ahora_utc;
}

function normalizarSegundoUtc(valor, mensaje) {
  const fecha = new Date(valor);
  if (Number.isNaN(fecha.getTime())) throw new Error(mensaje);
  fecha.setUTCMilliseconds(0);
  return fecha.toISOString();
}

function normalizarSegundoUtcOpcional(valor) {
  return valor == null
    ? null
    : normalizarSegundoUtc(valor, 'El checkpoint contiene un reloj inválido.');
}

function segundosEntre(anterior, actual) {
  return BigInt(Date.parse(actual) / 1000) - BigInt(Date.parse(anterior) / 1000);
}

function siguienteGeneracion(valor) {
  const actual = BigInt(valor);
  if (actual >= MAX_BIGINT_UNSIGNED) {
    throw new Error('La generación de corrección del reloj se agotó.');
  }
  return actual + 1n;
}

function normalizarLimite(valor) {
  const numero = Number(valor);
  if (!Number.isInteger(numero) || numero < 1 || numero > 1000) {
    throw new Error('El lote de reconciliación debe estar entre 1 y 1000 reglas.');
  }
  return numero;
}

async function rollbackSeguro(conexion) {
  try {
    await conexion.rollback();
  } catch {
    // El error causal conserva prioridad.
  }
}

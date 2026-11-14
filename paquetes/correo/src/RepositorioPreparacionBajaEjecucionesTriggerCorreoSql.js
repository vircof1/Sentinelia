import { CODIGOS_RESULTADO_ACEPTACION_TRIGGER_CORREO }
  from './ContratoTriggerCorreo.js';

const CODIGOS_ACEPTADOS = Object.freeze([
  CODIGOS_RESULTADO_ACEPTACION_TRIGGER_CORREO.ACEPTADA_COMPLETA,
  CODIGOS_RESULTADO_ACEPTACION_TRIGGER_CORREO.ACEPTADA_PARCIAL
]);

export class RepositorioPreparacionBajaEjecucionesTriggerCorreoSql {
  prepararPorTriggerEnTransaccion(triggerId, opciones = {}) {
    return this.#preparar({
      campo: 'trigger_id',
      ids: [triggerId],
      eliminarNoCorreo: false
    }, opciones);
  }

  prepararPorAsignacionEnTransaccion(asignacionId, opciones = {}) {
    return this.#preparar({
      campo: 'asignacion_trigger_monitor_id',
      ids: [asignacionId],
      eliminarNoCorreo: false
    }, opciones);
  }

  prepararPorMonitorEnTransaccion(monitorId, opciones = {}) {
    return this.prepararPorMonitoresEnTransaccion([monitorId], opciones);
  }

  prepararPorMonitoresEnTransaccion(monitorIds, {
    conexion,
    eliminarNoCorreo = false,
    cantidadEsperada = null,
    cantidadCorreoAceptadoEsperada = null
  } = {}) {
    return this.#preparar({
      campo: 'monitor_id',
      ids: monitorIds,
      eliminarNoCorreo
    }, { conexion, cantidadEsperada, cantidadCorreoAceptadoEsperada });
  }

  async #preparar({ campo, ids, eliminarNoCorreo }, {
    conexion,
    cantidadEsperada = null,
    cantidadCorreoAceptadoEsperada = null
  } = {}) {
    exigirConexion(conexion);
    const identidades = idsDecimales(ids);
    if (identidades.length === 0) {
      exigirCantidadEsperada(cantidadEsperada, 0);
      exigirCantidadEsperada(cantidadCorreoAceptadoEsperada, 0);
      return resultadoVacio();
    }
    const marcadores = identidades.map(() => '?').join(',');
    const [ejecuciones] = await conexion.execute(`
      SELECT id,tipo_trigger,codigo_resultado,payload_respuesta
        FROM ejecuciones_triggers
       WHERE ${campo} IN (${marcadores})
       ORDER BY id ASC
       FOR UPDATE
    `, identidades);
    const idsEjecucion = ejecuciones.map((fila) => Number(fila.id));
    const notificaciones = await bloquearNotificaciones(conexion, idsEjecucion);
    const conIntencion = new Set(notificaciones.map((fila) => Number(fila.ejecucion_trigger_id)));
    const preservadas = [];
    const eliminables = [];
    let rechazosCorreo = 0;
    for (const ejecucion of ejecuciones) {
      const correo = ejecucion.tipo_trigger === 'correo';
      const aceptada = correo && (
        conIntencion.has(Number(ejecucion.id)) || detallePurgado(ejecucion)
      );
      if (correo && CODIGOS_ACEPTADOS.includes(ejecucion.codigo_resultado) &&
          !aceptada) {
        throw errorIntegridad(ejecucion.id);
      }
      if (aceptada) preservadas.push(Number(ejecucion.id));
      else if (correo || eliminarNoCorreo) {
        eliminables.push(Number(ejecucion.id));
        if (correo) rechazosCorreo += 1;
      }
    }
    exigirCantidadEsperada(cantidadEsperada, eliminables.length);
    exigirCantidadEsperada(
      cantidadCorreoAceptadoEsperada,
      preservadas.length
    );
    await bloquearResultados(conexion, eliminables);
    if (eliminables.length > 0) {
      const candidatos = eliminables.map(() => '?').join(',');
      await conexion.execute(`
        DELETE FROM resultados_destinatarios_triggers_correo
         WHERE ejecucion_trigger_id IN (${candidatos})
      `, eliminables);
      const [resultado] = await conexion.execute(`
        DELETE FROM ejecuciones_triggers
         WHERE id IN (${candidatos})
      `, eliminables);
      if (Number(resultado.affectedRows || 0) !== eliminables.length) {
        throw errorConjuntoCambio();
      }
    }
    return Object.freeze({
      eliminadas: String(eliminables.length),
      correoRechazadoEliminadas: String(rechazosCorreo),
      correoAceptadoPreservadas: String(preservadas.length),
      idsCorreoAceptadoPreservadas: Object.freeze(preservadas.map(String))
    });
  }
}

async function bloquearNotificaciones(conexion, ids) {
  if (ids.length === 0) return [];
  const marcadores = ids.map(() => '?').join(',');
  const [filas] = await conexion.execute(`
    SELECT id,ejecucion_trigger_id
      FROM notificaciones_triggers_correo
     WHERE ejecucion_trigger_id IN (${marcadores})
     ORDER BY ejecucion_trigger_id ASC
     FOR UPDATE
  `, ids);
  return filas;
}

async function bloquearResultados(conexion, ids) {
  if (ids.length === 0) return;
  const marcadores = ids.map(() => '?').join(',');
  await conexion.execute(`
    SELECT id
      FROM resultados_destinatarios_triggers_correo
     WHERE ejecucion_trigger_id IN (${marcadores})
     ORDER BY ejecucion_trigger_id ASC,id ASC
     FOR UPDATE
  `, ids);
}

function detallePurgado(ejecucion) {
  try {
    const payload = typeof ejecucion.payload_respuesta === 'string'
      ? JSON.parse(ejecucion.payload_respuesta)
      : ejecucion.payload_respuesta;
    return payload?.detalle_correo_estado === 'purgado';
  } catch {
    return false;
  }
}

function idsDecimales(valores) {
  const ids = [...new Set((valores || []).map(Number))].sort((a, b) => a - b);
  if (ids.some((id) => !Number.isSafeInteger(id) || id < 1)) {
    throw new TypeError('La preparación destructiva exige ids positivos.');
  }
  return ids;
}

function exigirCantidadEsperada(esperada, actual) {
  if (esperada == null) return;
  if (String(esperada) !== String(actual)) throw errorConjuntoCambio();
}

function exigirConexion(conexion) {
  if (typeof conexion?.execute !== 'function') {
    throw new TypeError('La preparación destructiva exige conexión SQL prestada.');
  }
}

function resultadoVacio() {
  return Object.freeze({
    eliminadas: '0',
    correoRechazadoEliminadas: '0',
    correoAceptadoPreservadas: '0',
    idsCorreoAceptadoPreservadas: Object.freeze([])
  });
}

function errorIntegridad(id) {
  return Object.assign(
    new Error(`La ejecución de correo aceptada #${id} no conserva intención ni marca de purga.`),
    { codigo: 'ejecucion_correo_aceptada_sin_arbol' }
  );
}

function errorConjuntoCambio() {
  return Object.assign(
    new Error('Cambió el conjunto de ejecuciones durante la preparación destructiva.'),
    { codigo: 'agente_eliminacion_impacto_no_seguro' }
  );
}

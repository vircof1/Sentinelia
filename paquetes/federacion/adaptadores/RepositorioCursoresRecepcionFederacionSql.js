import {
  promoverProgresoGeneracionFederacionEnTransaccion
} from './promoverProgresoGeneracionFederacionSql.js';

export class ErrorCursorRecepcionFederacion extends Error {
  constructor(codigo, mensaje) {
    super(mensaje);
    this.name = 'ErrorCursorRecepcionFederacion';
    this.codigo = codigo;
  }
}

export class RepositorioCursoresRecepcionFederacionSql {
  constructor(clienteSql) {
    if (!clienteSql?.obtenerConexion) {
      throw new Error('Los cursores receptores federados requieren SQL operativo.');
    }
    this.clienteSql = clienteSql;
  }

  async aplicarResultadosEnTransaccion({
    flujoId,
    generacionId,
    resultados
  } = {}, { conexion } = {}) {
    exigirConexion(conexion);
    await exigirTransaccionActiva(conexion);
    if (!Array.isArray(resultados) || resultados.length === 0) {
      throw new ErrorCursorRecepcionFederacion(
        'resultados_cursor_ausentes',
        'El cursor necesita los resultados individuales del intento.'
      );
    }
    const ahora = await ahoraSql(conexion);
    const cursorNuevo = await asegurarCursor(
      conexion,
      { flujoId, generacionId, ahora }
    );
    let cursor = await bloquearCursor(conexion, generacionId);
    if (!cursor || cursor.flujo_id !== flujoId) {
      throw new ErrorCursorRecepcionFederacion(
        'cursor_generacion_incompatible',
        'El cursor no pertenece al flujo y generación recibidos.'
      );
    }
    let cambiado = false;
    if (cursorNuevo) {
      const terminalesHistoricos = await obtenerPosicionesTerminalesHistoricas(
        conexion,
        generacionId
      );
      for (const terminal of terminalesHistoricos) {
        cambiado = await incorporarPosicion(conexion, {
          generacionId,
          posicion: BigInt(terminal.posicion_flujo),
          degradante: Number(terminal.degradante) === 1,
          ahora
        }) || cambiado;
      }
    }
    for (const resultado of resultados) {
      if (resultado.clasificacion !== 'terminal') continue;
      const terminal = await exigirResultadoTerminal(conexion, {
        resultadoId: resultado.resultadoId,
        flujoId,
        generacionId,
        posicionFlujo: resultado.posicionFlujo
      });
      const posicion = BigInt(terminal.posicion_flujo);
      if (posicion <= BigInt(cursor.posicion_terminal_contigua)) continue;
      const incorporado = await incorporarPosicion(conexion, {
        generacionId,
        posicion,
        degradante: esDegradante(terminal.resultado),
        ahora
      });
      cambiado = cambiado || incorporado;
    }
    const absorcion = await absorberPrefijo(conexion, { cursor, ahora });
    cambiado = cambiado || absorcion.cambiado;
    if (cambiado) {
      const posicion = absorcion.posicion;
      const prefijoDegradado = Boolean(cursor.prefijo_degradado) ||
        absorcion.degradado;
      const frontera = BigInt(cursor.frontera_inicial);
      const fronteraRecorrida = posicion >= frontera;
      const degradacionInicialNueva = await existeDegradacionEnFrontera(
        conexion,
        { generacionId, frontera }
      );
      const fronteraDegradada = Boolean(cursor.frontera_inicial_degradada) ||
        degradacionInicialNueva;
      const [actualizacion] = await conexion.execute(
        `UPDATE cursores_generaciones_recepcion_federacion
            SET posicion_terminal_contigua=?,frontera_inicial_recorrida=?,
                frontera_inicial_degradada=?,prefijo_degradado=?,
                version_cursor=version_cursor+1,actualizado_en_utc=?
          WHERE generacion_id=? AND version_cursor=?`,
        [
          posicion.toString(),
          fronteraRecorrida,
          fronteraDegradada,
          prefijoDegradado,
          ahora,
          generacionId,
          String(cursor.version_cursor)
        ]
      );
      if (actualizacion.affectedRows !== 1) {
        throw new ErrorCursorRecepcionFederacion(
          'cursor_concurrente',
          'El cursor cambió fuera del bloqueo exclusivo esperado.'
        );
      }
      cursor = await bloquearCursor(conexion, generacionId);
    }
    const progreso = hidratarProgreso(
      cursor,
      await obtenerRangos(conexion, generacionId)
    );
    await promoverProgresoGeneracionFederacionEnTransaccion({
      conexion,
      flujoId,
      generacionId,
      posicionTerminalContigua: progreso.posicionTerminalContigua,
      fronteraInicialRecorrida: progreso.fronteraInicialRecorrida,
      fronteraInicialDegradada: progreso.fronteraInicialDegradada,
      prefijoDegradado: progreso.prefijoDegradado
    });
    return progreso;
  }

  async obtenerProgreso({ flujoId, generacionId } = {}) {
    const conexion = await this.clienteSql.obtenerConexion();
    try {
      await conexion.beginTransaction();
      const [filas] = await conexion.execute(
        `SELECT * FROM cursores_generaciones_recepcion_federacion
          WHERE generacion_id=? AND flujo_id=?`,
        [generacionId, flujoId]
      );
      if (!filas[0]) {
        await conexion.commit();
        return null;
      }
      const progreso = hidratarProgreso(
        filas[0],
        await obtenerRangos(conexion, generacionId)
      );
      await conexion.commit();
      return progreso;
    } catch (error) {
      try {
        await conexion.rollback();
      } catch {}
      throw error;
    } finally {
      conexion.release();
    }
  }

  async obtenerProgresoParaRelacion({ relacionId, flujoId, generacionId } = {}) {
    const conexion = await this.clienteSql.obtenerConexion();
    try {
      await conexion.beginTransaction();
      const [filas] = await conexion.execute(
        `SELECT c.* FROM cursores_generaciones_recepcion_federacion c
          JOIN flujos_federacion f ON f.flujo_id=c.flujo_id
          WHERE c.generacion_id=? AND c.flujo_id=?
            AND f.relacion_id=? AND f.direccion='recepcion'`,
        [generacionId, flujoId, relacionId]
      );
      if (!filas[0]) {
        await conexion.commit();
        return null;
      }
      const progreso = hidratarProgreso(
        filas[0],
        await obtenerRangos(conexion, generacionId)
      );
      await conexion.commit();
      return progreso;
    } catch (error) {
      try {
        await conexion.rollback();
      } catch {}
      throw error;
    } finally {
      conexion.release();
    }
  }

  async aplicarHuecoIrrecuperableEnTransaccion({ declaracionId } = {}, {
    conexion
  } = {}) {
    exigirConexion(conexion);
    await exigirTransaccionActiva(conexion);
    const declaracion = await bloquearHuecoIrrecuperable(conexion, declaracionId);
    if (declaracion.aplicada_cursor_en_utc !== null) {
      const cursorExistente = await bloquearCursor(
        conexion,
        declaracion.generacion_id
      );
      return hidratarProgreso(
        cursorExistente,
        await obtenerRangos(conexion, declaracion.generacion_id)
      );
    }
    await exigirRangoRealmenteAusente(conexion, declaracion);
    const ahora = await ahoraSql(conexion);
    await asegurarCursor(conexion, {
      flujoId: declaracion.flujo_id,
      generacionId: declaracion.generacion_id,
      ahora
    });
    let cursor = await bloquearCursor(conexion, declaracion.generacion_id);
    if (!cursor || cursor.flujo_id !== declaracion.flujo_id) {
      throw new ErrorCursorRecepcionFederacion(
        'cursor_hueco_incompatible',
        'El hueco no pertenece al cursor receptor indicado.'
      );
    }
    const inicioDeclarado = BigInt(declaracion.inicio_posicion);
    const finDeclarado = BigInt(declaracion.fin_posicion);
    const primeraPendiente = BigInt(cursor.posicion_terminal_contigua) + 1n;
    const inicioAplicable = maximo(inicioDeclarado, primeraPendiente);
    if (inicioAplicable <= finDeclarado) {
      await incorporarRangoTerminal(conexion, {
        generacionId: declaracion.generacion_id,
        inicio: inicioAplicable,
        fin: finDeclarado,
        degradante: true,
        ahora
      });
    }
    const absorcion = await absorberPrefijo(conexion, { cursor, ahora });
    if (absorcion.cambiado) {
      const posicion = absorcion.posicion;
      const frontera = BigInt(cursor.frontera_inicial);
      const [actualizacion] = await conexion.execute(
        `UPDATE cursores_generaciones_recepcion_federacion
            SET posicion_terminal_contigua=?,frontera_inicial_recorrida=?,
                frontera_inicial_degradada=?,prefijo_degradado=TRUE,
                version_cursor=version_cursor+1,actualizado_en_utc=?
          WHERE generacion_id=? AND version_cursor=?`,
        [
          posicion.toString(),posicion>=frontera,
          Boolean(cursor.frontera_inicial_degradada) ||
            (inicioDeclarado<=frontera && posicion>=frontera),
          ahora,declaracion.generacion_id,String(cursor.version_cursor)
        ]
      );
      if (actualizacion.affectedRows !== 1) {
        throw new ErrorCursorRecepcionFederacion(
          'cursor_hueco_concurrente',
          'El cursor cambió durante la aplicación del hueco.'
        );
      }
    }
    await conexion.execute(
      `UPDATE fronteras_generaciones_federacion
          SET historicamente_completa=FALSE,degradada=TRUE,
              version_frontera=version_frontera+1,actualizada_en_utc=?
        WHERE generacion_id=?`,
      [ahora,declaracion.generacion_id]
    );
    await conexion.execute(
      `UPDATE versiones_proyecciones_federacion
          SET completitud_reconstruible='degradada',
              version_estado=version_estado+1,actualizada_en_utc=?
        WHERE generacion_id=? AND completitud_reconstruible<>'degradada'`,
      [ahora,declaracion.generacion_id]
    );
    await conexion.execute(
      `UPDATE declaraciones_disponibilidad_federacion
          SET aplicada_cursor_en_utc=?
        WHERE declaracion_id=? AND aplicada_cursor_en_utc IS NULL`,
      [ahora,declaracion.declaracion_id]
    );
    cursor = await bloquearCursor(conexion, declaracion.generacion_id);
    return hidratarProgreso(
      cursor,
      await obtenerRangos(conexion, declaracion.generacion_id)
    );
  }
}

const POSICION_MAXIMA = 18446744073709551615n;

async function asegurarCursor(conexion, { flujoId, generacionId, ahora }) {
  const [resultado] = await conexion.execute(
    `INSERT IGNORE INTO cursores_generaciones_recepcion_federacion (
       generacion_id,flujo_id,posicion_terminal_contigua,frontera_inicial,
       frontera_inicial_recorrida,frontera_inicial_degradada,prefijo_degradado,
       version_cursor,creado_en_utc,actualizado_en_utc
     )
     SELECT g.generacion_id,g.flujo_id,0,f.posicion_inicial_comprometida,
            f.posicion_inicial_comprometida=0,FALSE,FALSE,1,?,?
       FROM generaciones_flujos_federacion g
       JOIN fronteras_generaciones_federacion f
         ON f.generacion_id=g.generacion_id
       JOIN flujos_federacion fl ON fl.flujo_id=g.flujo_id
      WHERE g.generacion_id=? AND g.flujo_id=? AND fl.direccion='recepcion'`,
    [ahora, ahora, generacionId, flujoId]
  );
  return resultado.affectedRows === 1;
}

async function obtenerPosicionesTerminalesHistoricas(conexion, generacionId) {
  const [filas] = await conexion.execute(
    `SELECT e.posicion_flujo,
            MAX(r.resultado IN ('rechazadaDefinitiva','divergente')) AS degradante
       FROM resultados_entregas_recepcion_federacion r
       JOIN entregas_recepcion_federacion e ON e.entrega_id=r.entrega_id
      WHERE e.generacion_id=? AND r.clasificacion='terminal'
      GROUP BY e.posicion_flujo
      ORDER BY e.posicion_flujo`,
    [generacionId]
  );
  return filas;
}

async function bloquearCursor(conexion, generacionId) {
  const [filas] = await conexion.execute(
    `SELECT * FROM cursores_generaciones_recepcion_federacion
      WHERE generacion_id=? FOR UPDATE`,
    [generacionId]
  );
  return filas[0] || null;
}

async function exigirResultadoTerminal(conexion, {
  resultadoId,
  flujoId,
  generacionId,
  posicionFlujo
}) {
  const [filas] = await conexion.execute(
    `SELECT r.clasificacion,r.resultado,e.flujo_id,e.generacion_id,
            e.posicion_flujo
       FROM resultados_entregas_recepcion_federacion r
       JOIN entregas_recepcion_federacion e ON e.entrega_id=r.entrega_id
      WHERE r.id=? FOR UPDATE`,
    [resultadoId]
  );
  const fila = filas[0];
  if (!fila || fila.clasificacion !== 'terminal' ||
      fila.flujo_id !== flujoId || fila.generacion_id !== generacionId ||
      String(fila.posicion_flujo) !== String(posicionFlujo)) {
    throw new ErrorCursorRecepcionFederacion(
      'resultado_terminal_incompatible',
      'El resultado no acredita la posición terminal declarada para este cursor.'
    );
  }
  return fila;
}

async function incorporarPosicion(conexion, {
  generacionId,
  posicion,
  degradante,
  ahora
}) {
  return incorporarRangoTerminal(conexion, {
    generacionId,
    inicio: posicion,
    fin: posicion,
    degradante,
    ahora
  });
}

async function incorporarRangoTerminal(conexion, {
  generacionId,
  inicio,
  fin,
  degradante,
  ahora
}) {
  const anterior = inicio - 1n;
  const siguiente = fin === POSICION_MAXIMA ? fin : fin + 1n;
  const [filas] = await conexion.execute(
    `SELECT * FROM rangos_terminales_recepcion_federacion
      WHERE generacion_id=?
        AND inicio_posicion<=? AND fin_posicion>=?
      ORDER BY inicio_posicion FOR UPDATE`,
    [generacionId, siguiente.toString(), anterior < 0n ? '0' : anterior.toString()]
  );
  const contenido = filas.find((fila) =>
    BigInt(fila.inicio_posicion) <= inicio && BigInt(fila.fin_posicion) >= fin &&
      (!degradante || Boolean(fila.contiene_degradacion))
  );
  if (contenido) return false;
  let inicioConsolidado = inicio;
  let finConsolidado = fin;
  let rangoDegradado = degradante;
  for (const fila of filas) {
    inicioConsolidado = minimo(inicioConsolidado, BigInt(fila.inicio_posicion));
    finConsolidado = maximo(finConsolidado, BigInt(fila.fin_posicion));
    rangoDegradado = rangoDegradado || Boolean(fila.contiene_degradacion);
    await conexion.execute(
      `DELETE FROM rangos_terminales_recepcion_federacion
        WHERE generacion_id=? AND inicio_posicion=?`,
      [generacionId, String(fila.inicio_posicion)]
    );
  }
  await conexion.execute(
    `INSERT INTO rangos_terminales_recepcion_federacion (
       generacion_id,inicio_posicion,fin_posicion,contiene_degradacion,
       creado_en_utc,actualizado_en_utc
     ) VALUES (?,?,?,?,?,?)`,
    [generacionId, inicioConsolidado.toString(), finConsolidado.toString(),
      rangoDegradado, ahora, ahora]
  );
  return true;
}

async function bloquearHuecoIrrecuperable(conexion, declaracionId) {
  const [filas] = await conexion.execute(
    `SELECT d.*
       FROM declaraciones_disponibilidad_federacion d
       JOIN flujos_federacion f ON f.flujo_id=d.flujo_id
      WHERE d.declaracion_id=? AND d.tipo='huecoIrrecuperable'
        AND d.rutas_alternativas_agotadas=TRUE
        AND f.relacion_id=d.relacion_id AND f.direccion='recepcion'
      FOR UPDATE`,
    [String(declaracionId || '')]
  );
  if (!filas[0]) {
    throw new ErrorCursorRecepcionFederacion(
      'hueco_irrecuperable_no_validado',
      'No existe una declaración irrecuperable validada para aplicar.'
    );
  }
  return filas[0];
}

async function exigirRangoRealmenteAusente(conexion, declaracion) {
  const [filas] = await conexion.execute(
    `SELECT 1 AS existe
       FROM entregas_recepcion_federacion
      WHERE flujo_id=? AND generacion_id=?
        AND posicion_flujo BETWEEN ? AND ?
      LIMIT 1 FOR UPDATE`,
    [declaracion.flujo_id,declaracion.generacion_id,
      String(declaracion.inicio_posicion),String(declaracion.fin_posicion)]
  );
  if (filas[0]) {
    throw new ErrorCursorRecepcionFederacion(
      'hueco_solapa_entrega_recibida',
      'Un hueco no puede sustituir posiciones que el receptor ya recibió.'
    );
  }
}

async function absorberPrefijo(conexion, { cursor, ahora }) {
  let posicion = BigInt(cursor.posicion_terminal_contigua);
  let degradado = false;
  let cambiado = false;
  while (true) {
    if (posicion === POSICION_MAXIMA) break;
    const [filas] = await conexion.execute(
      `SELECT * FROM rangos_terminales_recepcion_federacion
        WHERE generacion_id=? AND inicio_posicion=? FOR UPDATE`,
      [cursor.generacion_id, (posicion + 1n).toString()]
    );
    const rango = filas[0];
    if (!rango) break;
    posicion = BigInt(rango.fin_posicion);
    degradado = degradado || Boolean(rango.contiene_degradacion);
    cambiado = true;
    await conexion.execute(
      `DELETE FROM rangos_terminales_recepcion_federacion
        WHERE generacion_id=? AND inicio_posicion=?`,
      [cursor.generacion_id, String(rango.inicio_posicion)]
    );
  }
  return { cambiado, posicion, degradado, ahora };
}

async function existeDegradacionEnFrontera(conexion, {
  generacionId,
  frontera
}) {
  if (frontera === 0n) return false;
  const [filas] = await conexion.execute(
    `SELECT 1 AS existe
       FROM resultados_entregas_recepcion_federacion r
       JOIN entregas_recepcion_federacion e ON e.entrega_id=r.entrega_id
      WHERE e.generacion_id=? AND e.posicion_flujo<=?
        AND r.clasificacion='terminal'
        AND r.resultado IN ('rechazadaDefinitiva','divergente')
      LIMIT 1`,
    [generacionId, frontera.toString()]
  );
  return Boolean(filas[0]);
}

async function obtenerRangos(conexion, generacionId) {
  const [filas] = await conexion.execute(
    `SELECT inicio_posicion,fin_posicion,contiene_degradacion
       FROM rangos_terminales_recepcion_federacion
      WHERE generacion_id=? ORDER BY inicio_posicion`,
    [generacionId]
  );
  return filas;
}

function hidratarProgreso(cursor, rangos) {
  return Object.freeze({
    flujoId: cursor.flujo_id,
    generacionId: cursor.generacion_id,
    posicionTerminalContigua: String(cursor.posicion_terminal_contigua),
    fronteraInicial: String(cursor.frontera_inicial),
    fronteraInicialRecorrida: Boolean(cursor.frontera_inicial_recorrida),
    fronteraInicialDegradada: Boolean(cursor.frontera_inicial_degradada),
    prefijoDegradado: Boolean(cursor.prefijo_degradado),
    version: String(cursor.version_cursor),
    rangosTerminalesDispersos: Object.freeze(rangos.map((rango) => Object.freeze({
      inicio: String(rango.inicio_posicion),
      fin: String(rango.fin_posicion),
      contieneDegradacion: Boolean(rango.contiene_degradacion)
    })))
  });
}

function esDegradante(resultado) {
  return ['rechazadaDefinitiva', 'divergente'].includes(resultado);
}

function minimo(a, b) {
  return a < b ? a : b;
}

function maximo(a, b) {
  return a > b ? a : b;
}

function exigirConexion(conexion) {
  if (!conexion?.execute || !conexion?.query) {
    throw new ErrorCursorRecepcionFederacion(
      'transaccion_prestada_ausente',
      'El cursor exige una conexión SQL prestada.'
    );
  }
}

async function exigirTransaccionActiva(conexion) {
  const [filas] = await conexion.query('SELECT @@in_transaction AS activa');
  if (!Boolean(filas[0]?.activa)) {
    throw new ErrorCursorRecepcionFederacion(
      'transaccion_prestada_inactiva',
      'El cursor solo puede avanzar dentro de una transacción activa.'
    );
  }
}

async function ahoraSql(conexion) {
  const [filas] = await conexion.query('SELECT UTC_TIMESTAMP(3) AS ahora');
  return filas[0].ahora;
}

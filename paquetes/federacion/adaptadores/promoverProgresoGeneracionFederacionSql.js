export async function promoverProgresoGeneracionFederacionEnTransaccion({
  conexion,
  flujoId,
  generacionId,
  posicionTerminalContigua,
  fronteraInicialRecorrida,
  fronteraInicialDegradada = false,
  prefijoDegradado = false
} = {}) {
  if (typeof conexion?.execute !== 'function') {
    throw new Error('La promoción de generación exige una conexión prestada.');
  }
  const posicion = decimalNoNegativo(
    posicionTerminalContigua,
    'posicionTerminalContigua'
  );
  for (const [nombre, valor] of [
    ['fronteraInicialRecorrida', fronteraInicialRecorrida],
    ['fronteraInicialDegradada', fronteraInicialDegradada],
    ['prefijoDegradado', prefijoDegradado]
  ]) {
    if (typeof valor !== 'boolean') throw new Error(`${nombre} debe ser booleano.`);
  }
  const [filas] = await conexion.execute(
    `SELECT f.estado AS estado_flujo,f.generacion_activa_id,
            g.estado AS estado_generacion,g.version_estado,
            b.posicion_inicial_comprometida,b.version_frontera
       FROM flujos_federacion f
       JOIN generaciones_flujos_federacion g
         ON g.flujo_id=f.flujo_id AND g.generacion_id=?
       JOIN fronteras_generaciones_federacion b
         ON b.generacion_id=g.generacion_id
      WHERE f.flujo_id=? FOR UPDATE`,
    [generacionId, flujoId]
  );
  const actual = filas[0];
  if (!actual || actual.generacion_activa_id !== generacionId) {
    return Object.freeze({ promovida: false, causa: 'generacion_no_activa' });
  }
  const frontera = String(actual.posicion_inicial_comprometida);
  const recorrida = fronteraInicialRecorrida && BigInt(posicion) >= BigInt(frontera);
  let estadoGeneracion = actual.estado_generacion;
  let estadoFlujo = actual.estado_flujo;
  if (!recorrida) {
    if (estadoGeneracion !== 'preparada') {
      return Object.freeze({ promovida: false, causa: 'frontera_pendiente' });
    }
    await transicionarEstados(conexion, {
      flujoId,
      generacionId,
      estadoGeneracion: 'transfiriendo',
      estadoFlujo: 'sincronizando'
    });
    return Object.freeze({
      promovida: true,
      estadoGeneracion: 'transfiriendo',
      estadoFlujo: 'sincronizando'
    });
  }
  const degradada = fronteraInicialDegradada || prefijoDegradado;
  const destinoGeneracion = degradada ? 'degradada' : 'completa';
  const destinoFlujo = degradada ? 'degradado' : 'operativoCompleto';
  if (estadoGeneracion === 'preparada') {
    await transicionarEstados(conexion, {
      flujoId,
      generacionId,
      estadoGeneracion: 'transfiriendo',
      estadoFlujo: 'sincronizando'
    });
    estadoGeneracion = 'transfiriendo';
    estadoFlujo = 'sincronizando';
  }
  if (estadoGeneracion !== destinoGeneracion || estadoFlujo !== destinoFlujo) {
    await transicionarEstados(conexion, {
      flujoId,
      generacionId,
      estadoGeneracion: destinoGeneracion,
      estadoFlujo: destinoFlujo
    });
  }
  await conexion.execute(
    `UPDATE fronteras_generaciones_federacion
        SET posicion_operativa_validada=?,posicion_historica_validada=?,
            sincronizando=FALSE,operativamente_completa=TRUE,
            historicamente_completa=?,degradada=?,
            version_frontera=version_frontera+1,
            actualizada_en_utc=UTC_TIMESTAMP(3)
      WHERE generacion_id=?`,
    [frontera, degradada ? null : frontera, !degradada, degradada, generacionId]
  );
  return Object.freeze({
    promovida: estadoGeneracion !== destinoGeneracion || estadoFlujo !== destinoFlujo,
    estadoGeneracion: destinoGeneracion,
    estadoFlujo: destinoFlujo,
    fronteraInicial: frontera,
    degradada
  });
}

async function transicionarEstados(conexion, {
  flujoId,
  generacionId,
  estadoGeneracion,
  estadoFlujo
}) {
  const [generacion] = await conexion.execute(
    `UPDATE generaciones_flujos_federacion
        SET estado=?,version_estado=version_estado+1,
            version_registro=version_registro+1,
            actualizada_en_utc=UTC_TIMESTAMP(3)
      WHERE generacion_id=? AND flujo_id=?`,
    [estadoGeneracion, generacionId, flujoId]
  );
  const [flujo] = await conexion.execute(
    `UPDATE flujos_federacion
        SET estado=?,version_estado=version_estado+1,
            version_registro=version_registro+1,
            actualizada_en_utc=UTC_TIMESTAMP(3)
      WHERE flujo_id=? AND generacion_activa_id=?`,
    [estadoFlujo, flujoId, generacionId]
  );
  if (Number(generacion.affectedRows) !== 1 || Number(flujo.affectedRows) !== 1) {
    throw new Error('La generación cambió durante la promoción de su progreso.');
  }
}

function decimalNoNegativo(valor, campo) {
  const texto = String(valor ?? '');
  if (!/^(0|[1-9][0-9]*)$/u.test(texto)) {
    throw new Error(`${campo} debe ser un entero decimal no negativo.`);
  }
  return texto;
}

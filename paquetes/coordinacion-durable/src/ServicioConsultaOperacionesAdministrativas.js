const UUID_V7 = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;

export class ServicioConsultaOperacionesAdministrativas {
  constructor({
    repositorioOperaciones,
    repositorioObligaciones,
    catalogoProyectores
  } = {}) {
    if (
      typeof repositorioOperaciones?.buscarPorId !== 'function' ||
      typeof repositorioObligaciones?.obtenerSituacionPorOperacion !== 'function' ||
      typeof catalogoProyectores?.proyectarSujeto !== 'function'
    ) {
      throw new Error('La consulta de operaciones exige persistencia y proyección cerrada.');
    }
    this.repositorioOperaciones = repositorioOperaciones;
    this.repositorioObligaciones = repositorioObligaciones;
    this.catalogoProyectores = catalogoProyectores;
  }

  async obtener(contextoUsuarioActual, operacionId) {
    const id = String(operacionId || '').trim().toLowerCase();
    if (!UUID_V7.test(id)) throw noEncontrada();
    const operacion = await this.repositorioOperaciones.buscarPorId(id);
    if (!operacion) throw noEncontrada();
    const sujeto = await this.catalogoProyectores.proyectarSujeto(
      contextoUsuarioActual,
      operacion
    );
    if (!sujeto) throw noEncontrada();
    const situacionPostcommit = operacion.estado ===
        'completada' && operacion.resultado
      ? await this.repositorioObligaciones.obtenerSituacionPorOperacion(id)
      : null;
    return presentarOperacion(operacion, sujeto, situacionPostcommit);
  }
}

function presentarOperacion(operacion, sujeto, situacionPostcommit) {
  const resultado = operacion.resultado;
  const limpiezaPostcommit = presentarLimpiezaPostcommit(
    resultado,
    situacionPostcommit
  );
  return Object.freeze({
    operacionId: operacion.operacionId,
    tipo: operacion.tipo,
    version: operacion.version,
    estado: operacion.estado,
    fase: operacion.fase,
    terminal: operacion.terminal,
    cancelable: false,
    intentos: operacion.intentos,
    maxIntentos: operacion.maxIntentos,
    sujeto,
    resultado: resultado
      ? Object.freeze({
          resultado: resultado.resultado ?? null,
          estado: resultado.estado ?? operacion.estado,
          obligacionesPendientes: limpiezaPostcommit?.pendientes ?? 0,
          obligacionesBloqueadas: limpiezaPostcommit?.bloqueadas ?? 0
        })
      : null,
    limpiezaPostcommit,
    ultimoError: operacion.ultimoError
      ? Object.freeze({
          codigo: 'operacion_administrativa_fallida',
          mensaje: 'La operación no pudo completarse.'
        })
      : null,
    creadaEnUtc: operacion.creadaEnUtc,
    actualizadaEnUtc: operacion.actualizadaEnUtc,
    terminadaEnUtc: operacion.terminadaEnUtc
  });
}

function presentarLimpiezaPostcommit(resultado, situacion) {
  if (!resultado || resultado.estado !== 'completada') {
    return null;
  }
  const referencias = Array.isArray(resultado.obligaciones)
    ? resultado.obligaciones.length
    : 0;
  if (referencias === 0) {
    return Object.freeze({
      estado: 'no_requerida',
      total: 0,
      completadas: 0,
      pendientes: 0,
      bloqueadas: 0
    });
  }
  const totalPersistido = Number(situacion?.total ?? 0);
  if (totalPersistido === 0) {
    return Object.freeze({
      estado: 'convergida',
      total: referencias,
      completadas: referencias,
      pendientes: 0,
      bloqueadas: 0
    });
  }
  const bloqueadas = Number(situacion?.bloqueadas ?? 0);
  const pendientes = Number(situacion?.pendientes ?? 0);
  const completadas = Number(situacion?.completadas ?? 0);
  const estado = bloqueadas > 0
    ? 'bloqueada'
    : situacion?.convergida === true
      ? 'convergida'
      : 'pendiente';
  return Object.freeze({
    estado,
    total: totalPersistido,
    completadas,
    pendientes,
    bloqueadas
  });
}

function noEncontrada() {
  return Object.assign(
    new Error('La operación no existe dentro del alcance actual.'),
    {
      statusCode: 404,
      codigo: 'operacion_administrativa_no_encontrada'
    }
  );
}

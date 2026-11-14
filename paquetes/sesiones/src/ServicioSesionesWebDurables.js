import { generarUuidV7Auditoria } from '../../auditoria/src/UuidV7Auditoria.js';

export class LimiteSesionesWebVigentes extends Error {
  constructor() {
    super('El usuario alcanzó el límite de sesiones web vigentes.');
    this.name = 'LimiteSesionesWebVigentes';
    this.codigo = 'LIMITE_SESIONES_WEB_VIGENTES';
  }
}

export class SesionWebNoVigente extends Error {
  constructor() {
    super('La sesión web no está vigente.');
    this.name = 'SesionWebNoVigente';
    this.codigo = 'SESION_WEB_NO_VIGENTE';
  }
}

export class ServicioSesionesWebDurables {
  constructor({
    clienteSql,
    repositorioSesiones,
    repositorioProyecciones,
    servicioAuditoria = null,
    canalInvalidaciones = null,
    ttlSegundos = 28_800,
    maximoSesionesPorUsuario = 32
  } = {}) {
    if (!clienteSql?.obtenerConexion || !repositorioSesiones || !repositorioProyecciones) {
      throw new Error('El servicio durable requiere SQL y ambos repositorios.');
    }
    this.clienteSql = clienteSql;
    this.repositorioSesiones = repositorioSesiones;
    this.repositorioProyecciones = repositorioProyecciones;
    this.servicioAuditoria = servicioAuditoria;
    this.canalInvalidaciones = canalInvalidaciones;
    this.ttlSegundos = entero(ttlSegundos, 1, 2_592_000, 'ttlSegundos');
    this.maximoSesionesPorUsuario = entero(
      maximoSesionesPorUsuario,
      1,
      32,
      'maximoSesionesPorUsuario'
    );
  }

  async abrir({ usuarioId, versionSesion, scope, datosStore = {} } = {}) {
    const sesionAuditoriaId = generarUuidV7Auditoria();
    const sesion = await this.#transaccion(async (conexion) => {
      await this.repositorioSesiones.bloquearUsuariosExistentes([usuarioId], { conexion });
      const vigentes = await this.repositorioSesiones.bloquearVigentesPorUsuarios(
        [usuarioId],
        { conexion }
      );
      exigirCapacidad(vigentes, usuarioId, this.maximoSesionesPorUsuario);
      return this.repositorioSesiones.abrirEnTransaccion({
        sesionAuditoriaId,
        usuarioRealId: usuarioId,
        usuarioEfectivoId: usuarioId,
        versionSesionReal: versionSesion,
        versionSesionEfectiva: versionSesion,
        scopeApertura: scope,
        scopeEfectivoActual: scope
      }, { conexion, ttlSegundos: this.ttlSegundos });
    });
    return this.#proyectarOInvalidar({ sesion, datosStore });
  }

  async validar(storeId, { validarEstadoActual = async () => true } = {}) {
    const proyeccion = await this.repositorioProyecciones.obtenerPorStoreId(storeId);
    if (!proyeccion) throw new SesionWebNoVigente();
    const durable = await this.repositorioSesiones.buscarVigentePorId(
      proyeccion.sesionAuditoriaId
    );
    const autorizada = durable && fotografiasIguales(durable, proyeccion)
      ? await validarEstadoActual(durable)
      : false;
    if (!autorizada) {
      await this.#invalidarUnaSiVigente(proyeccion.sesionAuditoriaId);
      await this.#retirarYPublicar(storeId, proyeccion.sesionAuditoriaId);
      throw new SesionWebNoVigente();
    }
    return Object.freeze({ storeId, sesion: durable, datosStore: proyeccion.datosStore });
  }

  async renovarExplicita(storeId, opciones = {}) {
    const actual = await this.validar(storeId, opciones);
    const sesion = await this.#transaccion((conexion) =>
      this.repositorioSesiones.renovarEnTransaccion(
        actual.sesion.sesionAuditoriaId,
        { conexion, ttlSegundos: this.ttlSegundos }
      )
    );
    return this.#proyectarOInvalidar({
      storeId,
      sesion,
      datosStore: actual.datosStore
    });
  }

  async cerrar(storeId) {
    const actual = await this.validar(storeId);
    await this.#transaccion((conexion) =>
      this.repositorioSesiones.transicionarTerminalEnTransaccion(
        actual.sesion.sesionAuditoriaId,
        'cerrada',
        { conexion }
      )
    );
    await this.#retirarYPublicar(storeId, actual.sesion.sesionAuditoriaId);
  }

  async invalidarPorUsuarios(idsUsuario) {
    const sesiones = await this.#transaccion(async (conexion) => {
      await this.repositorioSesiones.bloquearUsuariosExistentes(idsUsuario, { conexion });
      return this.repositorioSesiones.invalidarVigentesPorUsuariosEnTransaccion(
        idsUsuario,
        { conexion }
      );
    });
    const limpiezas = await Promise.allSettled(sesiones.map((sesion) =>
      this.repositorioProyecciones.eliminarPorSesionAuditoriaId(sesion.sesionAuditoriaId)
    ));
    await this.#publicar(sesiones.map(({ sesionAuditoriaId }) => sesionAuditoriaId));
    const fallo = limpiezas.find(({ status }) => status === 'rejected');
    if (fallo) throw new Error('Las sesiones SQL se invalidaron, pero falló una limpieza Redis.', {
      cause: fallo.reason
    });
    return sesiones;
  }

  async iniciarImpersonacion(storeId, {
    usuarioEfectivoId,
    versionSesionReal,
    versionSesionEfectiva,
    scopeEfectivoActual,
    intencionAuditoria
  } = {}) {
    this.#exigirAuditoria();
    const actual = await this.validar(storeId);
    validarIntencionImpersonacion(
      intencionAuditoria,
      'usuario.impersonacion_iniciada',
      actual.sesion,
      usuarioEfectivoId,
      null
    );
    const sesion = await this.#transaccion(async (conexion) => {
      await this.repositorioSesiones.bloquearUsuariosExistentes(
        [actual.sesion.usuarioRealId, usuarioEfectivoId],
        { conexion }
      );
      const vigentes = await this.repositorioSesiones.bloquearVigentesPorUsuarios(
        [actual.sesion.usuarioRealId, usuarioEfectivoId],
        { conexion }
      );
      exigirCapacidad(vigentes, usuarioEfectivoId, this.maximoSesionesPorUsuario);
      const modificada = await this.repositorioSesiones.iniciarImpersonacionEnTransaccion({
        sesionAuditoriaId: actual.sesion.sesionAuditoriaId,
        usuarioEfectivoId,
        versionSesionReal,
        versionSesionEfectiva,
        scopeEfectivoActual,
        eventoImpersonacionIniciadaId: intencionAuditoria.eventoId
      }, { conexion });
      await this.servicioAuditoria.registrarEnTransaccion(
        { cambioEfectivo: true, intencion: intencionAuditoria },
        { conexion }
      );
      return modificada;
    });
    return this.#proyectarOInvalidar({
      storeId,
      sesion,
      datosStore: {
        ...actual.datosStore,
        correlacionImpersonacionInicioId: intencionAuditoria.correlacionId
      }
    });
  }

  async finalizarImpersonacion(storeId, {
    versionSesionReal,
    scopeEfectivoActual,
    intencionAuditoria
  } = {}) {
    this.#exigirAuditoria();
    const actual = await this.validar(storeId);
    const eventoInicioId = actual.sesion.eventoImpersonacionIniciadaId;
    validarIntencionImpersonacion(
      intencionAuditoria,
      'usuario.impersonacion_finalizada',
      actual.sesion,
      actual.sesion.usuarioEfectivoId,
      eventoInicioId
    );
    if (intencionAuditoria.correlacionId === actual.datosStore.correlacionImpersonacionInicioId) {
      throw new Error('El fin de impersonación exige una correlación distinta al inicio.');
    }
    const sesion = await this.#transaccion(async (conexion) => {
      await this.repositorioSesiones.bloquearUsuariosExistentes(
        [actual.sesion.usuarioRealId, actual.sesion.usuarioEfectivoId],
        { conexion }
      );
      await this.repositorioSesiones.bloquearVigentesPorUsuarios(
        [actual.sesion.usuarioRealId, actual.sesion.usuarioEfectivoId],
        { conexion }
      );
      const modificada = await this.repositorioSesiones.finalizarImpersonacionEnTransaccion({
        sesionAuditoriaId: actual.sesion.sesionAuditoriaId,
        eventoImpersonacionIniciadaId: eventoInicioId,
        versionSesionReal,
        scopeEfectivoActual
      }, { conexion });
      await this.servicioAuditoria.registrarEnTransaccion(
        { cambioEfectivo: true, intencion: intencionAuditoria },
        { conexion }
      );
      return modificada;
    });
    const datosStore = { ...actual.datosStore };
    delete datosStore.correlacionImpersonacionInicioId;
    return this.#proyectarOInvalidar({ storeId, sesion, datosStore });
  }

  async #proyectarOInvalidar({ storeId, sesion, datosStore }) {
    const idStore = storeId ?? this.repositorioProyecciones.generarStoreId();
    try {
      return await this.repositorioProyecciones.guardar({
        storeId: idStore,
        sesion,
        datosStore
      });
    } catch (causa) {
      await this.#invalidarUnaSiVigente(sesion.sesionAuditoriaId);
      await this.repositorioProyecciones.eliminarPorStoreId(
        idStore,
        sesion.sesionAuditoriaId
      ).catch(() => {});
      await this.#publicar([sesion.sesionAuditoriaId]);
      throw new Error('Falló la proyección; la sesión SQL fue invalidada.', {
        cause: causa
      });
    }
  }

  async #invalidarUnaSiVigente(sesionAuditoriaId) {
    if (!await this.repositorioSesiones.buscarVigentePorId(sesionAuditoriaId)) return;
    await this.#transaccion((conexion) =>
      this.repositorioSesiones.transicionarTerminalEnTransaccion(
        sesionAuditoriaId,
        'invalidada',
        { conexion }
      )
    );
  }

  async #retirarYPublicar(storeId, sesionAuditoriaId) {
    let errorLimpieza = null;
    try {
      await this.repositorioProyecciones.eliminarPorStoreId(storeId, sesionAuditoriaId);
    } catch (error) {
      errorLimpieza = error;
    }
    await this.#publicar([sesionAuditoriaId]);
    if (errorLimpieza) {
      throw new Error('La sesión SQL terminó, pero falló su limpieza Redis.', {
        cause: errorLimpieza
      });
    }
  }

  async #publicar(ids) {
    if (ids.length && this.canalInvalidaciones?.publicar) {
      await this.canalInvalidaciones.publicar(ids);
    }
  }

  #exigirAuditoria() {
    if (typeof this.servicioAuditoria?.registrarEnTransaccion !== 'function') {
      throw new Error('La impersonación exige auditoría transaccional.');
    }
  }

  async #transaccion(operacion) {
    const conexion = await this.clienteSql.obtenerConexion();
    try {
      await conexion.beginTransaction();
      const resultado = await operacion(conexion);
      await conexion.commit();
      return resultado;
    } catch (error) {
      try { await conexion.rollback(); } catch {}
      throw error;
    } finally {
      conexion.release();
    }
  }
}

function exigirCapacidad(sesiones, usuarioId, maximo) {
  const id = String(usuarioId);
  const total = sesiones.filter(
    (sesion) => sesion.usuarioRealId === id || sesion.usuarioEfectivoId === id
  ).length;
  if (total >= maximo) throw new LimiteSesionesWebVigentes();
}

function fotografiasIguales(a, b) {
  return [
    'sesionAuditoriaId', 'usuarioRealId', 'usuarioEfectivoId',
    'versionSesionReal', 'versionSesionEfectiva'
  ].every((campo) => a[campo] === b[campo]) &&
    JSON.stringify(a.scopeApertura) === JSON.stringify(b.scopeApertura) &&
    JSON.stringify(a.scopeEfectivoActual) === JSON.stringify(b.scopeEfectivoActual) &&
    Date.parse(a.expiraEnUtc) === Date.parse(b.expiraEnUtc);
}

function validarIntencionImpersonacion(intencion, tipo, sesion, efectivoId, causalidadId) {
  if (!intencion || intencion.tipo !== tipo) throw new Error(`Se exige el evento ${tipo}.`);
  if (intencion.sujeto?.tipo !== 'sesion_usuario' || intencion.sujeto.id !== sesion.sesionAuditoriaId) {
    throw new Error('La intención no identifica esta sesión auditable.');
  }
  if (
    intencion.actorReal?.tipo !== 'usuario' ||
    String(intencion.actorReal.id) !== sesion.usuarioRealId ||
    intencion.actorEfectivo?.tipo !== 'usuario' ||
    String(intencion.actorEfectivo.id) !== String(efectivoId) ||
    intencion.modoActuacion !== 'impersonado'
  ) {
    throw new Error('Los actores de impersonación no representan la fotografía efectiva.');
  }
  if (intencion.payload?.sesionAuditoriaId !== sesion.sesionAuditoriaId) {
    throw new Error('El payload de impersonación no identifica la sesión.');
  }
  if (causalidadId !== null && (
    intencion.causalidad?.tipo !== 'evento_auditoria' ||
    intencion.causalidad.id !== causalidadId
  )) {
    throw new Error('El fin de impersonación debe enlazar causalmente su inicio.');
  }
}

function entero(valor, minimo, maximo, nombre) {
  if (!Number.isSafeInteger(valor) || valor < minimo || valor > maximo) {
    throw new Error(`${nombre} debe estar entre ${minimo} y ${maximo}.`);
  }
  return valor;
}

const TIPOS = new Set([
  'retirar_sesion_redis',
  'retirar_perfil_servidor_redis',
  'retirar_agenda_servidor_redis',
  'invalidar_catalogo_monitores',
  'publicar_invalidacion_portal'
]);

export class ErrorEjecucionObligacionPostcommitEliminacionAgente extends Error {
  constructor(codigo, mensaje, { permanente = false, causa = null } = {}) {
    super(mensaje, causa ? { cause: causa } : undefined);
    this.name = 'ErrorEjecucionObligacionPostcommitEliminacionAgente';
    this.codigo = codigo;
    this.permanente = Boolean(permanente);
    this.esErrorObligacionPostcommit = true;
  }
}

export class EjecutorObligacionesPostcommitEliminacionAgentes {
  constructor({
    repositorioSesionesRedis,
    coordinadorPerfilServidorRedis,
    versionadorCatalogoMonitoresRedis,
    repositorioNotificaciones,
    publicadorInvalidacionesPortal
  } = {}) {
    if (
      typeof repositorioSesionesRedis?.obtenerAutoridad !== 'function' ||
      typeof repositorioSesionesRedis?.obtenerActual !== 'function' ||
      typeof repositorioSesionesRedis?.retirarSiCoincide !== 'function' ||
      typeof coordinadorPerfilServidorRedis?.retirarProyecciones !== 'function' ||
      typeof versionadorCatalogoMonitoresRedis?.incrementarVersion !== 'function' ||
      typeof repositorioNotificaciones?.obtenerFirma !== 'function' ||
      typeof publicadorInvalidacionesPortal?.publicar !== 'function'
    ) {
      throw new Error('El ejecutor postcommit exige todos sus puertos de convergencia.');
    }
    this.repositorioSesionesRedis = repositorioSesionesRedis;
    this.coordinadorPerfilServidorRedis = coordinadorPerfilServidorRedis;
    this.versionadorCatalogoMonitoresRedis = versionadorCatalogoMonitoresRedis;
    this.repositorioNotificaciones = repositorioNotificaciones;
    this.publicadorInvalidacionesPortal = publicadorInvalidacionesPortal;
  }

  async ejecutar(obligacion) {
    const tipo = String(obligacion?.tipo || '');
    if (!TIPOS.has(tipo) || Number(obligacion?.version) !== 1) {
      throw new ErrorEjecucionObligacionPostcommitEliminacionAgente(
        'obligacion_postcommit_contrato_incompatible',
        'La obligación postcommit no pertenece al contrato ejecutable.',
        { permanente: true }
      );
    }
    try {
      if (tipo === 'retirar_sesion_redis') {
        return await this.#retirarSesion(obligacion.objetivo);
      }
      if (['retirar_perfil_servidor_redis', 'retirar_agenda_servidor_redis']
        .includes(tipo)) {
        return await this.#retirarPerfilYAgenda(obligacion.objetivo, tipo);
      }
      if (tipo === 'invalidar_catalogo_monitores') {
        const versionCatalogo = await this.versionadorCatalogoMonitoresRedis
          .incrementarVersion();
        return Object.freeze({ tipo, aplicada: true, versionCatalogo });
      }
      return await this.publicarInvalidacionDestinatario(
        obligacion.objetivo.destinatarioUsuarioId
      );
    } catch (error) {
      if (error instanceof ErrorEjecucionObligacionPostcommitEliminacionAgente) {
        throw error;
      }
      throw new ErrorEjecucionObligacionPostcommitEliminacionAgente(
        'obligacion_postcommit_dependencia_no_disponible',
        'Una dependencia efímera no permitió completar la obligación postcommit.',
        { causa: error }
      );
    }
  }

  async publicarInvalidacionDestinatario(destinatarioUsuarioId) {
    if (typeof this.repositorioNotificaciones.existeDestinatario === 'function' &&
        !await this.repositorioNotificaciones.existeDestinatario(
          destinatarioUsuarioId
        )) {
      return Object.freeze({
        tipo: 'publicar_invalidacion_portal',
        aplicada: true,
        publicada: false,
        motivo: 'destinatario_eliminado'
      });
    }
    const firma = await this.repositorioNotificaciones.obtenerFirma(
      destinatarioUsuarioId
    );
    const receptores = await this.publicadorInvalidacionesPortal.publicar({
      destinatarioUsuarioId,
      firmaBuzon: firma.firma
    });
    return Object.freeze({
      tipo: 'publicar_invalidacion_portal',
      aplicada: true,
      publicada: true,
      receptores: Number(receptores || 0)
    });
  }

  async #retirarSesion({ agenteId, operacionSesionId }) {
    const autoridad = await this.repositorioSesionesRedis.obtenerAutoridad(agenteId);
    if (!autoridad || autoridad.operacionId !== operacionSesionId) {
      return Object.freeze({
        tipo: 'retirar_sesion_redis',
        aplicada: true,
        retirada: false,
        motivo: autoridad ? 'sesion_sucesora' : 'sesion_ausente'
      });
    }
    const retirada = await this.repositorioSesionesRedis.retirarSiCoincide({
      agenteId,
      operacionId: operacionSesionId,
      fencingToken: autoridad.fencingToken
    });
    if (!retirada) {
      const actual = await this.repositorioSesionesRedis.obtenerActual(agenteId);
      if (actual === null) {
        return Object.freeze({
          tipo: 'retirar_sesion_redis',
          aplicada: true,
          retirada: false,
          motivo: 'sesion_ya_retirada'
        });
      }
      const vigente = await this.repositorioSesionesRedis.obtenerAutoridad(agenteId);
      if (vigente?.operacionId === operacionSesionId) {
        throw new ErrorEjecucionObligacionPostcommitEliminacionAgente(
          'obligacion_postcommit_sesion_no_retirada',
          'La sesión objetivo conserva autoridad después del intento de retirada.'
        );
      }
    }
    return Object.freeze({
      tipo: 'retirar_sesion_redis',
      aplicada: true,
      retirada
    });
  }

  async #retirarPerfilYAgenda({ agenteId, generacionPerfil }, tipo) {
    await this.coordinadorPerfilServidorRedis.retirarProyecciones({
      perfiles: [{ agenteId, generacion: generacionPerfil }],
      motivo: 'agente_eliminado'
    });
    return Object.freeze({ tipo, aplicada: true, retirada: true });
  }
}

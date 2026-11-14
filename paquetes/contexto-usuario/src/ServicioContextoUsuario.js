import { ContextoUsuarioActual } from './ContextoUsuarioActual.js';

export class ServicioContextoUsuario {
  constructor({ repositorioUsuarios, resolutorScopeUsuario }) {
    this.repositorioUsuarios = repositorioUsuarios;
    this.resolutorScopeUsuario = resolutorScopeUsuario;
  }

  async cargarDesdeSesion(requisicion) {
    const sesionAutenticada = this.normalizarSesionAutenticada(
      requisicion.session?.usuarioAutenticado
    );

    if (!sesionAutenticada?.idUsuarioEfectivo || !sesionAutenticada?.idUsuarioReal) {
      return null;
    }

    const usuarioReal = await this.repositorioUsuarios.buscarPorId(
      sesionAutenticada.idUsuarioReal
    );
    const usuarioEfectivo =
      Number(sesionAutenticada.idUsuarioReal) ===
      Number(sesionAutenticada.idUsuarioEfectivo)
        ? usuarioReal
        : await this.repositorioUsuarios.buscarPorId(
            sesionAutenticada.idUsuarioEfectivo
          );

    if (!usuarioReal || !usuarioReal.activo) {
      return null;
    }

    if (!usuarioEfectivo) {
      return null;
    }

    if (!usuarioEfectivo.activo && !sesionAutenticada.impersonacionActiva) {
      return null;
    }

    const nivelScope = this.resolutorScopeUsuario.resolverNivelScope({
      tenantId: usuarioEfectivo.tenantId,
      empresaId: usuarioEfectivo.empresaId,
      sitioId: usuarioEfectivo.sitioId
    });

    const contexto = new ContextoUsuarioActual({
      idUsuario: usuarioEfectivo.id,
      usuario: usuarioEfectivo.usuario,
      nombreVisible: usuarioEfectivo.obtenerNombreVisible(),
      idUsuarioReal: usuarioReal.id,
      usuarioReal: usuarioReal.usuario,
      nombreVisibleReal: usuarioReal.obtenerNombreVisible(),
      impersonacionActiva:
        Number(usuarioReal.id) !== Number(usuarioEfectivo.id),
      permiteImpersonacionReal: Boolean(usuarioReal.permisos?.impersonacion),
      usuarioActivo: usuarioEfectivo.activo,
      tenantId: usuarioEfectivo.tenantId,
      empresaId: usuarioEfectivo.empresaId,
      sitioId: usuarioEfectivo.sitioId,
      nivelScope,
      esOperadorSistema: nivelScope === 'portal',
      permisos: usuarioEfectivo.permisos,
      preferenciaMostrarAlertasRemotas:
        usuarioEfectivo.preferenciaMostrarAlertasRemotas
    });

    requisicion.session.usuarioAutenticado = {
      ...sesionAutenticada,
      idUsuario: usuarioEfectivo.id,
      usuario: contexto.usuario,
      nombreVisible: contexto.nombreVisible,
      versionSesion: usuarioEfectivo.versionSesion,
      idUsuarioEfectivo: usuarioEfectivo.id,
      usuarioEfectivo: contexto.usuario,
      nombreVisibleEfectivo: contexto.nombreVisible,
      versionSesionEfectiva: usuarioEfectivo.versionSesion,
      idUsuarioReal: usuarioReal.id,
      usuarioReal: usuarioReal.usuario,
      nombreVisibleReal: usuarioReal.obtenerNombreVisible(),
      versionSesionReal: usuarioReal.versionSesion,
      impersonacionActiva: contexto.impersonacionActiva,
      puedeImpersonar: contexto.permiteImpersonacionReal,
      usuarioActivo: contexto.usuarioActivo,
      tenantId: contexto.tenantId,
      empresaId: contexto.empresaId,
      sitioId: contexto.sitioId,
      nivelScope: contexto.nivelScope,
      esOperadorSistema: contexto.esOperadorSistema,
      permisos: contexto.permisos.serializar(),
      preferenciaMostrarAlertasRemotas:
        contexto.preferenciaMostrarAlertasRemotas
    };

    return contexto;
  }

  normalizarSesionAutenticada(sesionAutenticada) {
    if (!sesionAutenticada) {
      return null;
    }

    const idUsuarioEfectivo =
      sesionAutenticada.idUsuarioEfectivo ?? sesionAutenticada.idUsuario ?? null;
    const idUsuarioReal =
      sesionAutenticada.idUsuarioReal ?? idUsuarioEfectivo;
    const versionSesionEfectiva =
      sesionAutenticada.versionSesionEfectiva ?? sesionAutenticada.versionSesion ?? null;
    const versionSesionReal =
      sesionAutenticada.versionSesionReal ?? versionSesionEfectiva;

    if (!idUsuarioEfectivo || !idUsuarioReal || !versionSesionEfectiva || !versionSesionReal) {
      return null;
    }

    return {
      ...sesionAutenticada,
      idUsuario: idUsuarioEfectivo,
      versionSesion: versionSesionEfectiva,
      idUsuarioEfectivo,
      idUsuarioReal,
      versionSesionEfectiva,
      versionSesionReal,
      impersonacionActiva: Boolean(
        sesionAutenticada.impersonacionActiva ||
        Number(idUsuarioReal) !== Number(idUsuarioEfectivo)
      )
    };
  }
}

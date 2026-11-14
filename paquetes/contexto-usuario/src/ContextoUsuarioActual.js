export class ContextoUsuarioActual {
  constructor({
    idUsuario,
    usuario,
    nombreVisible,
    idUsuarioReal = null,
    usuarioReal = null,
    nombreVisibleReal = null,
    impersonacionActiva = false,
    permiteImpersonacionReal = false,
    usuarioActivo = true,
    tenantId,
    empresaId,
    sitioId,
    nivelScope,
    esOperadorSistema,
    permisos,
    preferenciaMostrarAlertasRemotas = false
  }) {
    this.idUsuario = idUsuario;
    this.usuario = usuario;
    this.nombreVisible = nombreVisible;
    this.idUsuarioReal = idUsuarioReal ?? idUsuario;
    this.usuarioReal = usuarioReal ?? usuario;
    this.nombreVisibleReal = nombreVisibleReal ?? nombreVisible;
    this.impersonacionActiva = Boolean(impersonacionActiva);
    this.permiteImpersonacionReal = Boolean(permiteImpersonacionReal);
    this.usuarioActivo = Boolean(usuarioActivo);
    this.tenantId = tenantId;
    this.empresaId = empresaId;
    this.sitioId = sitioId;
    this.nivelScope = nivelScope;
    this.esOperadorSistema = esOperadorSistema;
    this.permisos = permisos;
    this.preferenciaMostrarAlertasRemotas = Boolean(
      preferenciaMostrarAlertasRemotas
    );
  }

  serializar() {
    return {
      idUsuario: this.idUsuario,
      usuario: this.usuario,
      nombreVisible: this.nombreVisible,
      idUsuarioReal: this.idUsuarioReal,
      usuarioReal: this.usuarioReal,
      nombreVisibleReal: this.nombreVisibleReal,
      impersonacionActiva: this.impersonacionActiva,
      permiteImpersonacionReal: this.permiteImpersonacionReal,
      usuarioActivo: this.usuarioActivo,
      tenantId: this.tenantId,
      empresaId: this.empresaId,
      sitioId: this.sitioId,
      nivelScope: this.nivelScope,
      esOperadorSistema: this.esOperadorSistema,
      permisos: this.permisos?.serializar?.() ?? {},
      preferenciaMostrarAlertasRemotas: this.preferenciaMostrarAlertasRemotas
    };
  }
}

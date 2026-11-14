export function construirAutoridadUsuarioEliminacionAdministrativa({
  usuario,
  resolutorScopeUsuario,
  autorizar,
  crearError
} = {}) {
  if (!usuario?.activo || typeof resolutorScopeUsuario?.resolverNivelScope !== 'function' ||
      typeof autorizar !== 'function' || typeof crearError !== 'function') {
    throw crearError?.() ?? new Error('No se puede construir la autoridad del usuario.');
  }
  const scope = construirScopeUsuario(usuario, resolutorScopeUsuario, crearError);
  const contexto = Object.freeze({
    idUsuario: usuario.id,
    nivelScope: scope.nivel,
    esOperadorSistema: scope.nivel === 'portal',
    tenantId: usuario.tenantId,
    empresaId: usuario.empresaId,
    sitioId: usuario.sitioId,
    permisos: usuario.permisos
  });
  if (autorizar(contexto) !== true) throw crearError();
  return Object.freeze({
    contexto,
    fotografia: Object.freeze({
      usuarioId: normalizarId(usuario.id, 'usuario.id'),
      estado: 'activo',
      decision: 'autorizada',
      scope
    })
  });
}

function construirScopeUsuario(usuario, resolutorScopeUsuario, crearError) {
  const nivel = resolutorScopeUsuario.resolverNivelScope({
    tenantId: usuario.tenantId,
    empresaId: usuario.empresaId,
    sitioId: usuario.sitioId
  });
  if (!['portal', 'tenant', 'empresa', 'sitio'].includes(nivel)) {
    throw crearError();
  }
  return Object.freeze({
    nivel,
    tenantId: normalizarIdOpcional(usuario.tenantId, 'usuario.tenantId'),
    empresaId: normalizarIdOpcional(usuario.empresaId, 'usuario.empresaId'),
    sitioId: normalizarIdOpcional(usuario.sitioId, 'usuario.sitioId')
  });
}

function normalizarId(valor, campo) {
  const texto = String(valor ?? '').trim();
  if (!/^[1-9][0-9]*$/u.test(texto)) {
    throw new TypeError(`${campo} debe ser una identidad decimal positiva.`);
  }
  return texto;
}

function normalizarIdOpcional(valor, campo) {
  return valor === null || valor === undefined
    ? null
    : normalizarId(valor, campo);
}

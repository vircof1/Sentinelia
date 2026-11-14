export class PoliticaPermisosAgentes {
  puedeVer(contextoUsuarioActual) {
    return Boolean(contextoUsuarioActual?.permisos?.verAgentes);
  }

  puedeModificar(contextoUsuarioActual) {
    return Boolean(contextoUsuarioActual?.permisos?.modificarAgentes);
  }

  puedeEliminar(contextoUsuarioActual) {
    return Boolean(contextoUsuarioActual?.permisos?.eliminarAgentes);
  }

  assertPuedeVer(contextoUsuarioActual) {
    if (!this.puedeVer(contextoUsuarioActual)) {
      throw new Error('No tienes permiso para ver agentes.');
    }
  }

  assertPuedeModificar(contextoUsuarioActual) {
    if (!this.puedeModificar(contextoUsuarioActual)) {
      throw new Error('No tienes permiso para modificar agentes.');
    }
  }

  assertPuedeEliminar(contextoUsuarioActual) {
    if (!this.puedeEliminar(contextoUsuarioActual)) {
      throw new Error('No tienes permiso para eliminar agentes.');
    }
  }

  puedeAlcanzarAgente(contextoUsuarioActual, agente) {
    if (!agente || !contextoUsuarioActual) {
      return false;
    }

    if (contextoUsuarioActual.esOperadorSistema) {
      return true;
    }

    if (
      contextoUsuarioActual.tenantId != null &&
      Number(contextoUsuarioActual.tenantId) !== Number(agente.tenantId)
    ) {
      return false;
    }

    if (
      ['empresa', 'sitio'].includes(contextoUsuarioActual.nivelScope) &&
      Number(contextoUsuarioActual.empresaId) !== Number(agente.empresaId)
    ) {
      return false;
    }

    if (
      contextoUsuarioActual.nivelScope === 'sitio' &&
      Number(contextoUsuarioActual.sitioId) !== Number(agente.sitioId)
    ) {
      return false;
    }

    return ['portal', 'tenant', 'empresa', 'sitio'].includes(
      contextoUsuarioActual.nivelScope
    );
  }
}

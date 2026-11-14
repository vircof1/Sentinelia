export class ResolutorScopeUsuario {
  resolverNivelScope({ tenantId, empresaId, sitioId }) {
    if (tenantId == null && empresaId == null && sitioId == null) {
      return 'portal';
    }

    if (tenantId != null && empresaId == null && sitioId == null) {
      return 'tenant';
    }

    if (tenantId != null && empresaId != null && sitioId == null) {
      return 'empresa';
    }

    if (tenantId != null && empresaId != null && sitioId != null) {
      return 'sitio';
    }

    return 'invalido';
  }

  esJerarquiaValida({ tenantId, empresaId, sitioId }) {
    return this.resolverNivelScope({ tenantId, empresaId, sitioId }) !== 'invalido';
  }

  describirScope({ tenantId, empresaId, sitioId }) {
    const nivel = this.resolverNivelScope({ tenantId, empresaId, sitioId });

    if (nivel === 'portal') {
      return 'Operador de sistema con alcance total.';
    }

    if (nivel === 'tenant') {
      return `Alcance acotado al tenant ${tenantId}.`;
    }

    if (nivel === 'empresa') {
      return `Alcance acotado a la empresa ${empresaId} dentro del tenant ${tenantId}.`;
    }

    if (nivel === 'sitio') {
      return `Alcance acotado al sitio ${sitioId} dentro de la empresa ${empresaId}.`;
    }

    return 'La combinación de scope no es válida.';
  }

  puedeAlcanzarTenant(contexto, tenantId) {
    if (contexto.esOperadorSistema) {
      return true;
    }

    return contexto.tenantId === tenantId;
  }

  puedeAlcanzarEmpresa(contexto, empresaId, tenantId = null) {
    if (contexto.esOperadorSistema) {
      return true;
    }

    if (tenantId != null && contexto.tenantId !== tenantId) {
      return false;
    }

    if (contexto.nivelScope === 'tenant') {
      return true;
    }

    return contexto.empresaId === empresaId;
  }

  puedeAlcanzarSitio(contexto, sitioId, empresaId = null, tenantId = null) {
    if (contexto.esOperadorSistema) {
      return true;
    }

    if (tenantId != null && contexto.tenantId !== tenantId) {
      return false;
    }

    if (empresaId != null && contexto.nivelScope !== 'tenant' && contexto.empresaId !== empresaId) {
      return false;
    }

    if (contexto.nivelScope === 'tenant' || contexto.nivelScope === 'empresa') {
      return true;
    }

    return contexto.sitioId === sitioId;
  }
}

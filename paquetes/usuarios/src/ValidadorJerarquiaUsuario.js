import { normalizarBuzonCorreo } from '../../correo/src/NormalizadorBuzonCorreo.js';

const EXPRESION_USUARIO = /^[a-zA-Z0-9._-]{3,80}$/;
const NIVELES_SCOPE_VALIDOS = ['portal', 'tenant', 'empresa', 'sitio'];

export class ValidadorJerarquiaUsuario {
  validarAltaBase({
    usuario,
    email
  }) {
    this.validarUsuario(usuario);
    this.validarEmail(email);
  }

  validarEdicionBase({ email }) {
    this.validarEmail(email);
  }

  resolverScopeInicialDesdeEditor(contextoUsuarioActual) {
    return {
      tenantId: contextoUsuarioActual?.tenantId ?? null,
      empresaId: contextoUsuarioActual?.empresaId ?? null,
      sitioId: contextoUsuarioActual?.sitioId ?? null
    };
  }

  assertNoAutoEliminacion({ idEditor, idObjetivo }) {
    if (Number(idEditor) === Number(idObjetivo)) {
      throw new Error('No puedes eliminar tu propio usuario desde esta pantalla.');
    }
  }

  resolverScopeObjetivoDesdeFormulario(datos) {
    const nivelScope = this.normalizarNivelScope(datos.nivel_scope);
    const tenantId = this.normalizarIdOpcional(datos.tenant_id);
    const empresaId = this.normalizarIdOpcional(datos.empresa_id);
    const sitioId = this.normalizarIdOpcional(datos.sitio_id);

    if (nivelScope === 'portal') {
      if (tenantId != null || empresaId != null || sitioId != null) {
        throw new Error('Un usuario de portal no debe llevar tenant, empresa ni sitio.');
      }
    }

    if (nivelScope === 'tenant') {
      if (tenantId == null || empresaId != null || sitioId != null) {
        throw new Error('El alcance tenant requiere tenant y no admite empresa ni sitio.');
      }
    }

    if (nivelScope === 'empresa') {
      if (tenantId == null || empresaId == null || sitioId != null) {
        throw new Error('El alcance empresa requiere tenant y empresa, sin sitio.');
      }
    }

    if (nivelScope === 'sitio') {
      if (tenantId == null || empresaId == null || sitioId == null) {
        throw new Error('El alcance sitio requiere tenant, empresa y sitio.');
      }
    }

    return {
      nivelScope,
      tenantId,
      empresaId,
      sitioId
    };
  }

  normalizarNivelScope(valor) {
    const normalizado = String(valor || '').trim().toLowerCase();

    if (!NIVELES_SCOPE_VALIDOS.includes(normalizado)) {
      throw new Error('Debes elegir un nivel de scope válido.');
    }

    return normalizado;
  }

  normalizarIdOpcional(valor) {
    if (valor === undefined || valor === null || String(valor).trim() === '') {
      return null;
    }

    const convertido = Number.parseInt(String(valor), 10);

    if (!Number.isInteger(convertido) || convertido <= 0) {
      throw new Error('Debes indicar identificadores positivos en la jerarquía.');
    }

    return convertido;
  }

  validarUsuario(usuario) {
    const normalizado = String(usuario || '').trim();

    if (!EXPRESION_USUARIO.test(normalizado)) {
      throw new Error(
        'El identificador de usuario debe tener entre 3 y 80 caracteres válidos.'
      );
    }
  }

  validarEmail(email) {
    return this.normalizarEmail(email);
  }

  normalizarEmail(email) {
    try {
      return normalizarBuzonCorreo(email).canonico;
    } catch {
      throw new Error('El email no tiene un formato válido.');
    }
  }

}

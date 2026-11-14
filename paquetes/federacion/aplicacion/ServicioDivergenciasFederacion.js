import {
  generarUuidV7Auditoria
} from '../../auditoria/src/UuidV7Auditoria.js';

export class ServicioDivergenciasFederacion {
  constructor({ repositorioDivergencias, servicioAutorizacion } = {}) {
    if (typeof repositorioDivergencias?.excluirRuta !== 'function') {
      throw new Error('La gestión de divergencias requiere un repositorio durable.');
    }
    if (typeof servicioAutorizacion?.puedeResolverConflictosFederacion !== 'function') {
      throw new Error('La gestión de divergencias requiere autorización actual.');
    }
    this.repositorioDivergencias = repositorioDivergencias;
    this.servicioAutorizacion = servicioAutorizacion;
  }

  excluirRuta({
    contextoUsuarioActual,
    divergenciaId,
    varianteRutaId,
    motivo
  } = {}) {
    if (!this.servicioAutorizacion.puedeResolverConflictosFederacion(
      contextoUsuarioActual
    )) {
      const error = new Error(
        'No tienes autoridad actual para excluir una ruta federada divergente.'
      );
      error.codigo = 'FEDERACION_PERMISO_DENEGADO';
      error.statusCode = 403;
      throw error;
    }
    return this.repositorioDivergencias.excluirRuta({
      divergenciaId: decimal(divergenciaId, 'divergenciaId'),
      varianteRutaId: decimal(varianteRutaId, 'varianteRutaId'),
      motivo: textoMotivo(motivo),
      eventoId: generarUuidV7Auditoria(),
      correlacionId: generarUuidV7Auditoria(),
      actor: actorDirecto(contextoUsuarioActual),
      scopeActor: scopeContexto(contextoUsuarioActual)
    });
  }
}

function actorDirecto(contexto) {
  if (!contexto || contexto.impersonacionActiva) {
    throw new Error('La exclusión de ruta exige una sesión humana directa.');
  }
  return Object.freeze({
    modo: 'directo',
    real: Object.freeze({ tipo: 'usuario', id: decimal(contexto.idUsuario, 'idUsuario') }),
    efectivo: null
  });
}

function scopeContexto(contexto) {
  return Object.freeze({
    tenantId: decimalNullable(contexto?.tenantId, 'tenantId'),
    empresaId: decimalNullable(contexto?.empresaId, 'empresaId'),
    sitioId: decimalNullable(contexto?.sitioId, 'sitioId')
  });
}

function decimal(valor, campo) {
  const texto = String(valor ?? '');
  if (!/^[1-9][0-9]*$/u.test(texto)) throw new Error(`${campo} no es canónico.`);
  return texto;
}

function decimalNullable(valor, campo) {
  return valor == null ? null : decimal(valor, campo);
}

function textoMotivo(valor) {
  const texto = String(valor ?? '').trim();
  if (texto.length < 1 || texto.length > 191) {
    throw new Error('El motivo de exclusión debe contener entre 1 y 191 caracteres.');
  }
  return texto;
}

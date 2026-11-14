export const CODIGOS_ERROR_ELIMINACION_ORGANIZATIVA = Object.freeze({
  CONTIENE_AGENTES_REQUIERE_MOTOR_DURABLE:
    'organizacion_eliminacion_contiene_agentes_requiere_motor_durable',
  INVENTARIO_AGENTES_NO_VERIFICABLE:
    'organizacion_eliminacion_inventario_agentes_no_verificable',
  SERVICIO_TRANSACCIONAL_REQUERIDO:
    'organizacion_eliminacion_servicio_transaccional_requerido'
});

const DEFINICIONES = Object.freeze({
  [CODIGOS_ERROR_ELIMINACION_ORGANIZATIVA.CONTIENE_AGENTES_REQUIERE_MOTOR_DURABLE]:
    Object.freeze({
      statusCode: 409,
      mensaje:
        'Esta organización contiene agentes y todavía no puede eliminarse. ' +
        'La eliminación organizativa durable debe estar disponible para ' +
        'garantizar su limpieza completa.'
    }),
  [CODIGOS_ERROR_ELIMINACION_ORGANIZATIVA.INVENTARIO_AGENTES_NO_VERIFICABLE]:
    Object.freeze({
      statusCode: 503,
      mensaje:
        'No se pudo verificar de forma segura si la organización contiene ' +
        'agentes. No se ha eliminado nada.'
    }),
  [CODIGOS_ERROR_ELIMINACION_ORGANIZATIVA.SERVICIO_TRANSACCIONAL_REQUERIDO]:
    Object.freeze({
      statusCode: 503,
      mensaje:
        'La eliminación organizativa transaccional no está disponible. ' +
        'No se ha eliminado nada.'
    })
});

export class ErrorEliminacionOrganizativaNoDisponible extends Error {
  constructor(codigo, { entidad = null, id = null, cantidadAgentes = null } = {}) {
    const definicion = DEFINICIONES[codigo];
    if (!definicion) {
      throw new TypeError('Código de bloqueo de eliminación organizativa desconocido.');
    }
    super(definicion.mensaje);
    this.name = 'ErrorEliminacionOrganizativaNoDisponible';
    this.codigo = codigo;
    this.statusCode = definicion.statusCode;
    this.entidad = normalizarEntidadOpcional(entidad);
    this.id = normalizarIdOpcional(id);
    this.cantidadAgentes = normalizarCantidadOpcional(cantidadAgentes);
  }
}

export function crearErrorOrganizacionConAgentes({ entidad, id, cantidadAgentes }) {
  return new ErrorEliminacionOrganizativaNoDisponible(
    CODIGOS_ERROR_ELIMINACION_ORGANIZATIVA.CONTIENE_AGENTES_REQUIERE_MOTOR_DURABLE,
    { entidad, id, cantidadAgentes }
  );
}

export function crearErrorInventarioAgentesNoVerificable({ entidad, id }) {
  return new ErrorEliminacionOrganizativaNoDisponible(
    CODIGOS_ERROR_ELIMINACION_ORGANIZATIVA.INVENTARIO_AGENTES_NO_VERIFICABLE,
    { entidad, id }
  );
}

export function crearErrorServicioEliminacionOrganizativaNoDisponible({
  entidad,
  id
}) {
  return new ErrorEliminacionOrganizativaNoDisponible(
    CODIGOS_ERROR_ELIMINACION_ORGANIZATIVA.SERVICIO_TRANSACCIONAL_REQUERIDO,
    { entidad, id }
  );
}

function normalizarEntidadOpcional(valor) {
  if (valor === null) return null;
  const entidad = String(valor || '');
  if (!['tenant', 'empresa', 'sitio'].includes(entidad)) {
    throw new TypeError('La entidad del bloqueo organizativo no es válida.');
  }
  return entidad;
}

function normalizarIdOpcional(valor) {
  if (valor === null) return null;
  const id = String(valor ?? '');
  if (!/^[1-9][0-9]*$/u.test(id)) {
    throw new TypeError('El id del bloqueo organizativo no es válido.');
  }
  return id;
}

function normalizarCantidadOpcional(valor) {
  if (valor === null) return null;
  if (!Number.isSafeInteger(valor) || valor < 1) {
    throw new TypeError('La cantidad de agentes bloqueados no es válida.');
  }
  return valor;
}

export const CODIGO_COMPATIBILIDAD_RECUPERACION_PASSWORD_EMAIL_CERRADA =
  'recuperacion_password_email_no_compatible';

export class ErrorCompatibilidadRecuperacionPasswordEmail extends Error {
  constructor({ codigo, mensaje, dependencias = [] }) {
    super(mensaje);
    this.name = 'ErrorCompatibilidadRecuperacionPasswordEmail';
    this.codigo = codigo;
    this.estadoHttp = 409;
    this.dependencias = Object.freeze([...dependencias]);
  }
}

export function crearProveedorCompatibilidadRecuperacionPasswordEmailCerrado() {
  return Object.freeze({
    async evaluarActivacion() {
      return Object.freeze({
        compatible: false,
        codigo: CODIGO_COMPATIBILIDAD_RECUPERACION_PASSWORD_EMAIL_CERRADA,
        mensaje:
          'La recuperación de contraseña por correo todavía no está disponible en este despliegue.',
        dependencias: Object.freeze(['implementacion_5_30_incompleta'])
      });
    }
  });
}

export function crearProveedorCompatibilidadRecuperacionPasswordEmail({
  obtenerEstado
} = {}) {
  if (typeof obtenerEstado !== 'function') {
    throw new Error('El proveedor de compatibilidad requiere obtenerEstado.');
  }
  return Object.freeze({
    async evaluarActivacion() {
      const estado = await obtenerEstado();
      if (estado?.intencionHabilitada === true ||
          estado?.puedeHabilitar === true) {
        return Object.freeze({ compatible: true });
      }
      const dependencias = Array.isArray(estado?.dependencias)
        ? estado.dependencias
          .filter(({ satisfecha }) => satisfecha !== true)
          .map(({ codigo }) => String(codigo))
        : ['despliegue_no_evaluable'];
      return Object.freeze({
        compatible: false,
        codigo: CODIGO_COMPATIBILIDAD_RECUPERACION_PASSWORD_EMAIL_CERRADA,
        mensaje:
          'La recuperación no satisface sus dependencias actuales de despliegue.',
        dependencias: Object.freeze(dependencias)
      });
    }
  });
}

export async function exigirCompatibilidadRecuperacionPasswordEmail(proveedor) {
  if (typeof proveedor?.evaluarActivacion !== 'function') {
    throw new Error('Falta el proveedor de compatibilidad de recuperación por correo.');
  }
  const resultado = await proveedor.evaluarActivacion();
  if (resultado?.compatible === true) return Object.freeze({ compatible: true });
  throw new ErrorCompatibilidadRecuperacionPasswordEmail({
    codigo: String(
      resultado?.codigo ||
      CODIGO_COMPATIBILIDAD_RECUPERACION_PASSWORD_EMAIL_CERRADA
    ),
    mensaje: String(
      resultado?.mensaje ||
      'La recuperación de contraseña por correo no es compatible.'
    ),
    dependencias: Array.isArray(resultado?.dependencias)
      ? resultado.dependencias.map(String)
      : []
  });
}

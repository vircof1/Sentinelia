import {
  CODIGOS_RESULTADO_DESTINATARIO_TRIGGER_CORREO,
  ESTADOS_PARTICIPACION_DESTINATARIO_TRIGGER_CORREO,
  TIPOS_DESTINATARIO_TRIGGER_CORREO
} from './ContratoTriggerCorreo.js';
import { normalizarBuzonCorreo } from './NormalizadorBuzonCorreo.js';

export class ProyectorAudienciaEfectivaTriggerCorreo {
  proyectar(filas = []) {
    const procedencias = filas.map((fila) => proyectarProcedencia(fila));
    const destinosPorBuzon = new Map();
    for (const procedencia of procedencias) {
      if (!procedencia.entregable) continue;
      const existente = destinosPorBuzon.get(procedencia.emailCanonico);
      if (existente) {
        existente.relaciones.push(procedencia);
      } else {
        destinosPorBuzon.set(procedencia.emailCanonico, {
          emailCanonico: procedencia.emailCanonico,
          versionNormalizacion: procedencia.versionNormalizacion,
          relaciones: [procedencia]
        });
      }
    }
    const destinos = [...destinosPorBuzon.values()].map((destino) =>
      Object.freeze({
        ...destino,
        relaciones: Object.freeze(destino.relaciones)
      }));
    return Object.freeze({
      procedencias: Object.freeze(procedencias),
      destinos: Object.freeze(destinos),
      totalRelaciones: procedencias.length,
      totalActivas: procedencias.filter((item) => item.estado === 'activa').length,
      totalEntregables: procedencias.filter((item) => item.entregable).length,
      totalBuzones: destinos.length
    });
  }
}

function proyectarProcedencia(fila) {
  const base = {
    relacionId: String(fila.id),
    tipo: fila.tipo,
    usuarioId: fila.usuario_id == null ? null : String(fila.usuario_id),
    estado: fila.estado_participacion,
    versionNormalizacion: fila.normalizacion_buzon_version,
    emailPresentacion: null,
    emailCanonico: null,
    entregable: false,
    codigo: null
  };
  if (fila.estado_participacion !==
      ESTADOS_PARTICIPACION_DESTINATARIO_TRIGGER_CORREO.ACTIVA) {
    return Object.freeze({ ...base, codigo: 'relacion_desuscrita' });
  }
  if (fila.tipo === TIPOS_DESTINATARIO_TRIGGER_CORREO.MANUAL) {
    return Object.freeze({
      ...base,
      emailPresentacion: fila.email_manual,
      emailCanonico: fila.email_manual_canonico,
      entregable: true,
      codigo: CODIGOS_RESULTADO_DESTINATARIO_TRIGGER_CORREO.ACEPTADO
    });
  }
  if (fila.tipo !== TIPOS_DESTINATARIO_TRIGGER_CORREO.USUARIO) {
    throw new Error('La audiencia contiene un tipo de procedencia desconocido.');
  }
  if (!Boolean(fila.usuario_activo)) {
    return Object.freeze({
      ...base,
      codigo: CODIGOS_RESULTADO_DESTINATARIO_TRIGGER_CORREO.USUARIO_INACTIVO
    });
  }
  if (!fila.usuario_email) {
    return Object.freeze({
      ...base,
      codigo: CODIGOS_RESULTADO_DESTINATARIO_TRIGGER_CORREO.EMAIL_AUSENTE
    });
  }
  if (!Boolean(fila.usuario_email_validado)) {
    return Object.freeze({
      ...base,
      codigo: CODIGOS_RESULTADO_DESTINATARIO_TRIGGER_CORREO.EMAIL_NO_VALIDADO
    });
  }
  try {
    const buzon = normalizarBuzonCorreo(fila.usuario_email);
    return Object.freeze({
      ...base,
      versionNormalizacion: buzon.version,
      emailPresentacion: buzon.presentacion,
      emailCanonico: buzon.canonico,
      entregable: true,
      codigo: CODIGOS_RESULTADO_DESTINATARIO_TRIGGER_CORREO.ACEPTADO
    });
  } catch {
    return Object.freeze({
      ...base,
      codigo: CODIGOS_RESULTADO_DESTINATARIO_TRIGGER_CORREO.EMAIL_INVALIDO
    });
  }
}

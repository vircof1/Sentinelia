export const OPERACIONES_CAPTURA_FEDERACION = Object.freeze({
  ESTRUCTURA_MOVIMIENTO: 'estructuraOrganizativa.movimiento',
  ESTRUCTURA_RETIRADA: 'estructuraOrganizativa.retirada',
  MONITORES_ADMINISTRACION: 'monitores.administracion',
  MONITORES_RETIRADA: 'monitores.retirada',
  MONITORES_RUNTIME: 'monitores.runtime',
  TELEMETRIA_INGESTA: 'telemetria.ingesta',
  TRIGGERS_ADMINISTRACION: 'triggersInformativos.administracion',
  TRIGGERS_RETIRADA: 'triggersInformativos.retirada',
  TRIGGERS_EJECUCION: 'triggersInformativos.ejecucion'
});

export const OPERACIONES_CAPTURA_TECNICA_FEDERACION = OPERACIONES_CAPTURA_FEDERACION;

export function crearSolicitudCapturaFederacion(operacion, solicitud = {}) {
  if (!Object.values(OPERACIONES_CAPTURA_FEDERACION).includes(operacion)) {
    throw new Error('La operación de captura federada no pertenece al contrato.');
  }
  if (!solicitud || typeof solicitud !== 'object' || Array.isArray(solicitud)) {
    throw new Error('La captura técnica federada requiere una solicitud estructurada.');
  }
  return Object.freeze({
    operacionCapturaTecnica: operacion,
    solicitud
  });
}

export const crearSolicitudCapturaTecnicaFederacion = crearSolicitudCapturaFederacion;

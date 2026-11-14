export function construirSolicitudCapturaFederadaTelemetria({
  agenteId,
  resultado,
  senalIdsAdicionales = [],
  incluirFotografiaPol = true
} = {}) {
  const senalIds = [
    ...senalIdsAdicionales,
    ...(resultado?.senalesModificadas || []).map((senal) => senal?.id)
  ].filter((id) => id !== null && id !== undefined);
  const observaciones = resultado?.persistencia?.observaciones || [];
  const fotografias = resultado?.persistencia?.fotografiaActual?.fotografias || [];

  return Object.freeze({
    agenteId,
    senalIds: Object.freeze([...new Set(senalIds.map(String))]),
    observacionIds: Object.freeze(observaciones
      .map((observacion) => observacion?.id)
      .filter((id) => id !== null && id !== undefined)
      .map(String)),
    fotografiaSenalIds: Object.freeze(fotografias
      .filter((fotografia) => fotografia?.ultimaObservacionId !== null)
      .map((fotografia) => String(fotografia.id))),
    incluirFotografiaPol: incluirFotografiaPol === true
  });
}

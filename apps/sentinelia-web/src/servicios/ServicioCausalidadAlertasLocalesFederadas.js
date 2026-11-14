export class ServicioCausalidadAlertasLocalesFederadas {
  constructor({ repositorioEntradasFederadas, servicioAutorizacion } = {}) {
    if (typeof repositorioEntradasFederadas?.listarPorMonitorIds !== 'function' ||
        typeof repositorioEntradasFederadas?.listarProyeccionesPublicadasVisibles !== 'function') {
      throw new Error('La causalidad federada requiere el repositorio de entradas lógicas.');
    }
    this.repositorio = repositorioEntradasFederadas;
    this.autorizacion = servicioAutorizacion;
  }

  async enriquecer(contextoUsuarioActual, alertas = []) {
    const lista = Array.isArray(alertas) ? alertas : [];
    const monitorIds = [...new Set(lista
      .filter((alerta) => alerta?.tipoMonitor === 'booleano')
      .map((alerta) => Number(alerta.monitorId))
      .filter((id) => Number.isSafeInteger(id) && id > 0))];
    if (monitorIds.length === 0) return lista.map(limpiarEvidenciaInterna);
    const entradas = await this.repositorio.listarPorMonitorIds(monitorIds);
    const porMonitor = agrupar(entradas, (entrada) => entrada.monitorId);
    const referenciasHistoricas = lista.flatMap(causasEvidenciadas);
    const historial = typeof this.repositorio.listarHistorialPorReferencias === 'function'
      ? await this.repositorio.listarHistorialPorReferencias(referenciasHistoricas)
      : [];
    const historialPorRevision = new Map(historial.map((entrada) => [
      claveRevision(entrada.entradaId, entrada.revisionConfiguracion),
      entrada
    ]));
    const puedeResolver = Boolean(
      this.autorizacion?.puedeVerMonitores?.(contextoUsuarioActual) &&
      this.autorizacion?.puedeExplorarDatosRemotosFederacion?.(
        contextoUsuarioActual
      )
    );
    const proyeccionesReferenciadas = [...entradas, ...historial,
      ...lista.flatMap(causasEvidenciadas)]
      .map((entrada) => entrada.proyeccionId)
      .filter(Boolean);
    const visibles = puedeResolver
      ? new Set(await this.repositorio.listarProyeccionesPublicadasVisibles(
          contextoUsuarioActual,
          proyeccionesReferenciadas
        ))
      : new Set();
    return lista.map((alerta) => {
      const { _evidenciaCausalFederada: evidencia, ...alertaPublica } = alerta;
      const causasDurables = causasEvidenciadas(alerta);
      const entradasPorId = new Map((evidencia?.entradas || []).map((entrada) => [
        Number(entrada.entradaId), entrada
      ]));
      const causas = causasDurables.length > 0
        ? causasDurables.map((causa) => ({
            ...causa,
            ...historialPorRevision.get(claveRevision(
              causa.entradaId,
              causa.revisionConfiguracion
            )),
            variable: historialPorRevision.get(claveRevision(
              causa.entradaId,
              causa.revisionConfiguracion
            ))?.variable || entradasPorId.get(Number(causa.entradaId))?.variable || null
          }))
        : (porMonitor.get(Number(alerta.monitorId)) || []);
      if (causas.length === 0) return alertaPublica;
      return {
        ...alertaPublica,
        causalidadFederada: {
          naturalezaAlerta: 'local',
          contieneEntradasFederadas: true,
          fuenteCausal: causasDurables.length > 0
            ? 'evidenciaTransicion' : 'configuracionActual',
          totalEntradas: causas.length,
          entradas: causas.map((entrada) => presentarEntrada(
            entrada,
            visibles.has(entrada.proyeccionId)
          ))
        }
      };
    });
  }
}

function presentarEntrada(entrada, visible) {
  const base = {
    entradaId: entrada.entradaId,
    variable: entrada.variable || 'entrada federada',
    visibilidad: visible ? 'visible' : 'referenciaNoVisible'
  };
  if (!visible) return Object.freeze(base);
  const parametros = new URLSearchParams({
    familia: 'monitores',
    proyeccion: entrada.proyeccionId
  });
  return Object.freeze({
    ...base,
    proyeccionId: entrada.proyeccionId,
    installationOrigenId: entrada.installationOrigenId,
    elementoOrigenId: entrada.elementoOrigenId,
    urlProyeccionRemota: `/federacion/datos-remotos?${parametros.toString()}`
  });
}

function causasEvidenciadas(alerta) {
  const causas = alerta?._evidenciaCausalFederada?.causalidad?.causas;
  if (!Array.isArray(causas)) return [];
  return causas.filter((causa) =>
    Number.isSafeInteger(Number(causa?.entradaId)) && Number(causa.entradaId) > 0 &&
    Number.isSafeInteger(Number(causa?.revisionConfiguracion)) &&
    Number(causa.revisionConfiguracion) > 0 && causa?.proyeccionId
  );
}

function claveRevision(entradaId, revision) {
  return `${Number(entradaId)}:${Number(revision)}`;
}

function limpiarEvidenciaInterna(alerta) {
  const { _evidenciaCausalFederada: _omitida, ...publica } = alerta;
  return publica;
}

function agrupar(elementos, clave) {
  const resultado = new Map();
  for (const elemento of elementos) {
    const valor = clave(elemento);
    if (!resultado.has(valor)) resultado.set(valor, []);
    resultado.get(valor).push(elemento);
  }
  return resultado;
}

import {
  CONDICION_FUENTE_FEDERADA_RETIRADA,
  MENSAJE_FUENTE_FEDERADA_RETIRADA
} from './CondicionFuenteFederada.js';

export function interpretarEntradaFederadaMonitorLogico(dependencia, entrada) {
  if (!entrada || entrada.proyeccionId !== dependencia.proyeccionId) {
    return incompleta(dependencia, 'inicial',
      'La incorporación federada no posee un vínculo runtime coherente con su configuración.');
  }
  const base = {
    ...entrada,
    variable: dependencia.variable,
    fuente: dependencia.fuente,
    referencia: dependencia.proyeccionId,
    proyeccionId: dependencia.proyeccionId
  };
  if (entrada.estadoVigencia === 'retirada') {
    return resultado(
      base,
      valorInicial(entrada),
      CONDICION_FUENTE_FEDERADA_RETIRADA,
      'ninguna',
      true,
      MENSAJE_FUENTE_FEDERADA_RETIRADA
    );
  }
  if (entrada.estadoAutorizacion === 'noAutorizada' ||
      entrada.condicionTemporal === 'noAutorizada') {
    return resultado(base, valorConservado(entrada), 'noAutorizada', 'ninguna', true,
      'La entrada perdió la autoridad local necesaria y no puede participar en nuevas evaluaciones.');
  }
  if (!entrada.generacionId || !entrada.condicionTemporal) {
    return resultado(base, valorInicial(entrada), 'inicial', 'estado_inicial');
  }
  if (entrada.condicionTemporal === 'consolidando') {
    return resultado(base, valorConservado(entrada), 'consolidando',
      entrada.ultimoEstadoRemotoEstable ? 'conservar_ultimo_estado_estable' : 'estado_inicial');
  }
  const estableActual = entrada.remotoEjecutadoTodavia
    ? normalizarEstadoRemotoEstable(entrada.estadoOperativoRemoto)
    : null;
  const incompatible = entrada.condicionTemporal === 'incompatible' ||
    (entrada.estadoCoherencia !== null && entrada.estadoCoherencia !== 'coherente') ||
    entrada.estadoSoporte === 'huerfana';
  if (entrada.condicionTemporal === 'vencida' || incompatible) {
    return perdida(base, entrada, incompatible ? 'incompatible' : 'vigencia_agotada');
  }
  if (entrada.condicionTemporal === 'vigente' && estableActual) {
    return resultado(base, valorDesdeEstado(estableActual, entrada.inversion), 'vigente',
      entrada.inversion ? 'estado_remoto_invertido' : 'estado_remoto');
  }
  if (entrada.ultimoEstadoRemotoEstable) {
    return perdida(base, entrada, 'sin_estado_operativo', 'sinEstadoOperativo');
  }
  return resultado(base, valorInicial(entrada), 'sinEstadoOperativo', 'estado_inicial');
}

export function resolverTransicionEntradaFederadaMonitorLogico({
  objetivo, estadoPersistido = null, observadoEnUtc,
  epocaObservacion = 'epoca_no_declarada'
}) {
  const ahora = fechaIso(observadoEnUtc);
  const inicial = objetivo.estadoInicial !== 'fallo';
  let estado = estadoPersistido ? { ...estadoPersistido } : {
    valorBinarioEfectivo: inicial,
    condicionFuente: 'inicial',
    ultimoEstadoRemotoEstable: null,
    revisionConfiguracionAplicada: objetivo.revisionConfiguracion,
    candidatoValor: null,
    candidatoCondicion: null,
    candidatoIniciadoEnUtc: null,
    candidatoVenceEnUtc: null,
    candidatoRevisionConfiguracion: null,
    evidenciaEfectiva: null,
    evidenciaCandidata: null,
    epocaObservacion,
    requiereObservacionCompleta: false,
    versionEstado: 0
  };
  const cambiaEpoca = Boolean(estadoPersistido) &&
    estado.epocaObservacion !== epocaObservacion;
  if (cambiaEpoca) {
    estado = cancelarCandidato(estado);
    estado.epocaObservacion = epocaObservacion;
    estado.requiereObservacionCompleta = true;
  }
  if (estado.revisionConfiguracionAplicada !== objetivo.revisionConfiguracion) {
    estado = cancelarCandidato(estado);
    estado.revisionConfiguracionAplicada = objetivo.revisionConfiguracion;
  }
  const evidencia = construirEvidencia(objetivo, ahora);
  if (objetivo.bloqueaEvaluacion || objetivo.condicionFuente === 'consolidando') {
    estado = cancelarCandidato(estado);
    estado.condicionFuente = objetivo.condicionFuente;
    estado.evidenciaEfectiva = evidencia;
    return finalizar(estado, objetivo, ahora, false);
  }
  if (objetivo.ultimoEstadoRemotoEstable) {
    estado.ultimoEstadoRemotoEstable = objetivo.ultimoEstadoRemotoEstable;
  }
  if (estado.requiereObservacionCompleta) {
    const cambiaValor = objetivo.valorBinarioEfectivo !== estado.valorBinarioEfectivo;
    estado.valorBinarioEfectivo = objetivo.valorBinarioEfectivo;
    estado.condicionFuente = objetivo.condicionFuente;
    estado.evidenciaEfectiva = evidencia;
    estado.requiereObservacionCompleta = false;
    return finalizar(estado, objetivo, ahora, cambiaValor, true);
  }
  if (objetivo.valorBinarioEfectivo === estado.valorBinarioEfectivo) {
    estado = cancelarCandidato(estado);
    estado.condicionFuente = objetivo.condicionFuente;
    estado.evidenciaEfectiva = evidencia;
    return finalizar(estado, objetivo, ahora, false);
  }
  const retardo = Number(objetivo.retardoCambioSegundos || 0);
  if (retardo === 0) {
    estado = cancelarCandidato(estado);
    estado.valorBinarioEfectivo = objetivo.valorBinarioEfectivo;
    estado.condicionFuente = objetivo.condicionFuente;
    estado.evidenciaEfectiva = evidencia;
    return finalizar(estado, objetivo, ahora, true);
  }
  const mismo = estado.candidatoValor === objetivo.valorBinarioEfectivo &&
    estado.candidatoRevisionConfiguracion === objetivo.revisionConfiguracion;
  if (!mismo) {
    estado.candidatoValor = objetivo.valorBinarioEfectivo;
    estado.candidatoCondicion = objetivo.condicionFuente;
    estado.candidatoIniciadoEnUtc = ahora;
    estado.candidatoVenceEnUtc = new Date(Date.parse(ahora) + retardo * 1000).toISOString();
    estado.candidatoRevisionConfiguracion = objetivo.revisionConfiguracion;
  }
  estado.evidenciaCandidata = evidencia;
  estado.candidatoCondicion = objetivo.condicionFuente;
  estado.condicionFuente = objetivo.condicionFuente;
  if (Date.parse(ahora) >= Date.parse(estado.candidatoVenceEnUtc)) {
    estado.valorBinarioEfectivo = estado.candidatoValor;
    estado.condicionFuente = estado.candidatoCondicion;
    estado.evidenciaEfectiva = estado.evidenciaCandidata;
    estado = cancelarCandidato(estado);
    return finalizar(estado, objetivo, ahora, true);
  }
  return finalizar(estado, objetivo, ahora, false);
}

function perdida(base, entrada, causa, condicion = 'perdidaTemporal') {
  if (!entrada.ultimoEstadoRemotoEstable) {
    return resultado(base, valorInicial(entrada), condicion, 'estado_inicial', false, null, causa);
  }
  const politica = entrada.ultimoEstadoRemotoEstable === 'fallo'
    ? entrada.politicaPerdidaEnFallo : entrada.politicaPerdidaEnCorrecto;
  const valor = politica === 'forzar_fallo' ? false
    : politica === 'forzar_correcto' ? true
      : valorDesdeEstado(entrada.ultimoEstadoRemotoEstable, entrada.inversion);
  return resultado(base, valor, condicion, politica, false, null, causa);
}

function resultado(base, valor, condicionFuente, accionAplicada,
  bloqueaEvaluacion = false, motivoBloqueo = null, causa = null) {
  return { ...base, valor, valorBinarioEfectivo: valor, condicionFuente,
    accionAplicada, causa, estado: condicionFuente, bloqueaEvaluacion, motivoBloqueo };
}

function incompleta(dependencia, condicionFuente, motivoBloqueo) {
  return resultado({ variable: dependencia.variable, fuente: dependencia.fuente,
    referencia: dependencia.proyeccionId, proyeccionId: dependencia.proyeccionId },
  null, condicionFuente, 'ninguna', true, motivoBloqueo);
}

function cancelarCandidato(estado) {
  return { ...estado, candidatoValor: null, candidatoCondicion: null,
    candidatoIniciadoEnUtc: null, candidatoVenceEnUtc: null,
    candidatoRevisionConfiguracion: null, evidenciaCandidata: null };
}

function finalizar(
  estado,
  _objetivo,
  observadoEnUtc,
  transicionAplicada,
  observacionCompletaPostArranque = false
) {
  return { ...estado, versionEstado: Number(estado.versionEstado || 0) + 1,
    observadoEnUtc, transicionAplicada,
    observacionCompletaPostArranque,
    candidatoPendiente: estado.candidatoValor !== null };
}

function construirEvidencia(objetivo, observadoEnUtc) {
  return { proyeccionId: objetivo.proyeccionId, generacionId: objetivo.generacionId,
    secuenciaElemento: objetivo.secuenciaElemento,
    ocurrenciaOrigenId: objetivo.ocurrenciaOrigenId,
    transicionTemporalId: objetivo.transicionTemporalId,
    observadoEnUtc };
}

function normalizarEstadoRemotoEstable(valor) {
  const estado = String(valor || '').trim().toLowerCase();
  if (['vivo', 'correcto', 'normal', 'disponible'].includes(estado)) return 'correcto';
  if (['fallo', 'indisponible'].includes(estado)) return 'fallo';
  return null;
}

function valorDesdeEstado(estado, inversion) {
  const valor = estado === 'correcto';
  return inversion ? !valor : valor;
}
function valorInicial(entrada) { return entrada?.estadoInicial !== 'fallo'; }
function valorConservado(entrada) {
  return entrada?.ultimoEstadoRemotoEstable
    ? valorDesdeEstado(entrada.ultimoEstadoRemotoEstable, entrada.inversion)
    : valorInicial(entrada);
}
function fechaIso(valor) {
  const fecha = valor instanceof Date ? valor : new Date(valor);
  if (Number.isNaN(fecha.getTime())) throw new Error('La observación requiere una fecha UTC válida.');
  return fecha.toISOString();
}

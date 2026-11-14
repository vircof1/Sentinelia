import {
  crearIdentidadFederada,
  TIPOS_IDENTIDAD_FEDERADA
} from '../src/IdentidadFederada.js';

const MARGEN_COBERTURA_POL_GRAFICO_SEGUNDOS = 120;

export class ServicioTelemetriaRemotaFederacionPortal {
  constructor({ repositorio, servicioAutorizacion } = {}) {
    if (typeof repositorio?.listarResumen !== 'function') {
      throw new Error('La telemetría remota requiere un repositorio de lectura portal.');
    }
    if (typeof servicioAutorizacion?.puedeVerAgentes !== 'function') {
      throw new Error('La telemetría remota requiere autorización explícita.');
    }
    this.repositorio = repositorio;
    this.autorizacion = servicioAutorizacion;
  }

  async obtener(contextoUsuarioActual, { installationOrigenId, vista = 'resumen',
    senalOrigenId = null, desdeUtc = null, hastaUtc = null, limite = null } = {}) {
    if (!this.autorizacion.puedeVerAgentes(contextoUsuarioActual)) {
      throw errorHttp(403, 'telemetria_remota_no_autorizada',
        'La telemetría remota no es visible.');
    }
    const procedencia = validarInstalacion(installationOrigenId);
    const metodo = {
      resumen: 'listarResumen',
      actividad: 'listarActividad',
      historico: 'listarHistorico'
    }[vista];
    if (!metodo || typeof this.repositorio[metodo] !== 'function') {
      throw errorHttp(400, 'vista_telemetria_remota_invalida',
        'La vista de telemetría remota solicitada no existe.');
    }
    const scope = scopeEfectivo(contextoUsuarioActual);
    if (vista === 'actividad') {
      const filtros = normalizarFiltrosActividad({
        senalOrigenId, desdeUtc, hastaUtc, limite
      });
      const [registros, catalogo] = await Promise.all([
        this.repositorio.listarActividad({
          installationOrigenId: procedencia,
          scope,
          ...filtros
        }),
        this.repositorio.listarResumen({
          installationOrigenId: procedencia,
          scope,
          limite: 1000
        })
      ]);
      return presentarActividad(procedencia, registros, { catalogo, filtros });
    }
    const limites = { resumen: 1000, actividad: 150, historico: 500 };
    const registros = await this.repositorio[metodo]({
      installationOrigenId: procedencia,
      scope,
      limite: limites[vista]
    });
    if (vista === 'historico') return presentarHistorico(procedencia, registros);
    return presentarResumen(procedencia, registros);
  }
}

function presentarActividad(installationOrigenId, registros, { catalogo, filtros }) {
  const senalesCatalogadas = catalogo.filter(esTipo('senal')).map(presentarSenal);
  const fuentesCatalogadas = catalogo.filter(esTipo('fuente')).map(presentarFuente);
  const nombresSenales = new Map(senalesCatalogadas.map((senal) =>
    [senal.elementoOrigenId, senal.nombre]));
  const entradas = registros.map((registro) => {
    if (registro.tipoRegistro === 'observacion') {
      const observacion = presentarObservacion(registro);
      return Object.freeze({
        ...observacion,
        nombre: nombresSenales.get(observacion.senalOrigenId) || observacion.nombre
      });
    }
    if (registro.tipoRegistro === 'eventoDerivado') return presentarEventoDerivado(registro);
    return presentarActividadPol(registro);
  });
  return Object.freeze({
    installationOrigenId,
    entradas: Object.freeze(entradas),
    grafico: presentarGraficoActividadTelemetriaRemota(
      entradas,
      fuentesCatalogadas
    ),
    filtros: Object.freeze({
      ...filtros,
      senales: Object.freeze(senalesCatalogadas.filter((senal) =>
        ['numero', 'duracion', 'momento_utc'].includes(senal.tipoDato)))
    }),
    resumen: Object.freeze({
      total: entradas.length,
      observaciones: contarTipo(registros, 'observacion'),
      eventosDerivados: contarTipo(registros, 'eventoDerivado'),
      estadosPol: contarTipo(registros, 'fotografiaPol'),
      limiteAlcanzado: registros.filter((registro) =>
        registro.tipoRegistro !== 'fotografiaPol').length === filtros.limite
    })
  });
}

export function presentarGraficoActividadTelemetriaRemota(
  entradas,
  fuentesCatalogadas = []
) {
  const grupos = new Map();
  const observaciones = entradas.filter((entrada) =>
    entrada.tipo === 'observacion' &&
    ['numero', 'duracion', 'momento_utc'].includes(entrada.tipoDato) &&
    (entrada.tipoDato === 'momento_utc'
      ? Number.isFinite(Date.parse(entrada.valor))
      : Number.isFinite(Number(entrada.valor))) &&
    Number.isFinite(Date.parse(entrada.fechaUtc))
  );

  for (const observacion of observaciones) {
    const tipoDato = observacion.tipoDato;
    const unidad = observacion.unidad || '';
    const claveGrupo = `${tipoDato}::${unidad || '__sin_unidad__'}`;
    const claveSenal = observacion.senalOrigenId || observacion.elementoOrigenId;
    if (!grupos.has(claveGrupo)) {
      grupos.set(claveGrupo, { tipoDato, unidad, series: new Map() });
    }
    const series = grupos.get(claveGrupo).series;
    if (!series.has(claveSenal)) {
      series.set(claveSenal, {
        senalOrigenId: observacion.senalOrigenId,
        nombre: observacion.nombre,
        tipoDato,
        unidad,
        puntos: []
      });
    }
    series.get(claveSenal).puntos.push(Object.freeze({
      fechaUtc: observacion.fechaUtc,
      valor: tipoDato === 'momento_utc'
        ? observacion.valor
        : Number(observacion.valor),
      calidad: observacion.calidad,
      severidad: observacion.severidad,
      origen: observacion.origen,
      detalle: observacion.detalle,
      recibidoEnUtc: observacion.recibidoEnUtc
    }));
  }

  const unidades = [...grupos.entries()].map(([clave, grupo]) => {
    const lista = [...grupo.series.values()].map((serie) => Object.freeze({
      ...serie,
      puntos: Object.freeze(serie.puntos.sort((a, b) =>
        Date.parse(a.fechaUtc) - Date.parse(b.fechaUtc)))
    }));
    return Object.freeze({
      clave,
      tipoDato: grupo.tipoDato,
      unidad: grupo.unidad,
      etiqueta: grupo.tipoDato === 'duracion'
        ? 'Duración · segundos'
        : grupo.tipoDato === 'momento_utc'
          ? 'Momento UTC'
          : `Número · ${grupo.unidad || 'sin unidad'}`,
      totalPuntos: lista.reduce((total, serie) => total + serie.puntos.length, 0),
      series: Object.freeze(lista)
    });
  }).sort((a, b) => b.totalPuntos - a.totalPuntos || a.etiqueta.localeCompare(b.etiqueta, 'es'));

  const nombresFuentes = new Map(fuentesCatalogadas.map((fuente) =>
    [fuente.elementoOrigenId, fuente.nombre]));
  const generadoEnUtc = new Date().toISOString();
  const periodosPol = entradas.filter((entrada) => entrada.tipo === 'pol')
    .map((entrada) => {
      const cobertura = calcularCoberturaEfectivaPolRemoto(entrada, generadoEnUtc);
      return Object.freeze({
        fuenteOrigenId: entrada.fuenteOrigenId,
        fuenteNombre: nombresFuentes.get(entrada.fuenteOrigenId) || 'Agente remoto',
        inicioUtc: entrada.inicioUtc,
        finUtc: entrada.finUtc,
        ultimoHeartbeatUtc: entrada.ultimoHeartbeatUtc,
        finEfectivoUtc: cobertura.finEfectivoUtc,
        ultimaEvidenciaVidaUtc: cobertura.ultimaEvidenciaVidaUtc,
        silencioDetectado: cobertura.silencioDetectado,
        abierto: entrada.estado === 'abierto',
        estado: entrada.estado
      });
    });
  return Object.freeze({
    unidades: Object.freeze(unidades),
    totalPuntos: observaciones.length,
    totalSenales: new Set(observaciones.map((entrada) =>
      entrada.senalOrigenId || entrada.elementoOrigenId)).size,
    pol: Object.freeze({ periodos: Object.freeze(periodosPol) })
  });
}

function calcularCoberturaEfectivaPolRemoto(periodo, generadoEnUtc) {
  const inicioMs = instanteValido(periodo.inicioUtc);
  const finRegistradoMs = instanteValido(periodo.finUtc);
  const ultimoHeartbeatMs = instanteValido(periodo.ultimoHeartbeatUtc);
  if (inicioMs === null) {
    return Object.freeze({
      finEfectivoUtc: fechaIsoOpcional(finRegistradoMs),
      ultimaEvidenciaVidaUtc: fechaIsoOpcional(finRegistradoMs),
      silencioDetectado: false
    });
  }
  const limiteMs = finRegistradoMs ?? instanteValido(generadoEnUtc) ?? Date.now();
  const ultimaEvidenciaMs = Math.max(inicioMs, ultimoHeartbeatMs ?? inicioMs);
  const finEfectivoMs = Math.max(
    inicioMs,
    Math.min(
      ultimaEvidenciaMs + MARGEN_COBERTURA_POL_GRAFICO_SEGUNDOS * 1000,
      limiteMs
    )
  );
  return Object.freeze({
    finEfectivoUtc: new Date(finEfectivoMs).toISOString(),
    ultimaEvidenciaVidaUtc: new Date(ultimaEvidenciaMs).toISOString(),
    silencioDetectado: finEfectivoMs < limiteMs
  });
}

function instanteValido(valor) {
  if (!valor) return null;
  const instante = Date.parse(valor);
  return Number.isFinite(instante) ? instante : null;
}

function fechaIsoOpcional(instante) {
  return instante === null ? null : new Date(instante).toISOString();
}

function normalizarFiltrosActividad({ senalOrigenId, desdeUtc, hastaUtc, limite }) {
  const senal = senalOrigenId
    ? validarElementoOrigen(senalOrigenId, 'senalOrigenId')
    : null;
  const desde = normalizarFechaOpcional(desdeUtc, 'desdeUtc');
  const hasta = normalizarFechaOpcional(hastaUtc, 'hastaUtc');
  if (desde && hasta && Date.parse(hasta) <= Date.parse(desde)) {
    throw errorHttp(400, 'rango_actividad_telemetria_invalido',
      'La fecha final debe ser posterior a la fecha inicial.');
  }
  return Object.freeze({
    senalOrigenId: senal,
    desdeUtc: desde,
    hastaUtc: hasta,
    limite: normalizarLimiteActividad(limite)
  });
}

function presentarHistorico(installationOrigenId, registros) {
  const entradas = registros.map((registro) => registro.tipoRegistro === 'observacion'
    ? presentarObservacion(registro)
    : presentarRangoHistorico(registro));
  const fechas = entradas.flatMap((entrada) => [entrada.fechaUtc, entrada.desdeUtc, entrada.hastaUtc])
    .filter(Boolean).sort();
  return Object.freeze({
    installationOrigenId,
    entradas: Object.freeze(entradas),
    resumen: Object.freeze({
      total: entradas.length,
      observaciones: contarTipo(registros, 'observacion'),
      huecos: contarTipo(registros, 'rangoHistorico'),
      desdeUtc: fechas[0] ?? null,
      hastaUtc: fechas.at(-1) ?? null,
      limiteAlcanzado: registros.length === 500
    })
  });
}

function presentarObservacion(registro) {
  const payload = registro.payload;
  return Object.freeze({
    tipo: 'observacion',
    elementoOrigenId: registro.elementoOrigenId,
    fuenteOrigenId: payload.fuenteOrigenId || registro.fuenteOrigenId,
    senalOrigenId: payload.senalOrigenId || registro.senalOrigenId,
    nombre: payload.codigoSenal || payload.clave || 'Señal remota',
    categoria: payload.categoria || null,
    clave: payload.clave || null,
    tag: payload.tag || null,
    tipoDato: payload.tipoDato || null,
    unidad: payload.unidad || null,
    valor: payload.valor,
    calidad: payload.calidad || null,
    severidad: payload.severidadDeclarada || null,
    origen: payload.origen || null,
    detalle: payload.detalleHumano || null,
    fechaUtc: payload.observadoEnUtc || registro.tiempoDatoUtc,
    recibidoEnUtc: payload.recibidoEnUtc || null,
    vigenteHastaUtc: payload.vigenteHastaUtc || registro.vigenteHastaOrigenUtc,
    condicion: condicionRegistro(registro, payload.vigenteHastaUtc || null)
  });
}

function presentarEventoDerivado(registro) {
  const payload = registro.payload;
  return Object.freeze({
    tipo: 'eventoDerivado',
    elementoOrigenId: registro.elementoOrigenId,
    fuenteOrigenId: payload.fuenteOrigenId || registro.fuenteOrigenId,
    senalOrigenId: payload.senalOrigenId || registro.senalOrigenId,
    nombre: payload.mensajeOperativo || 'Evento derivado',
    detalle: payload.explicacion || null,
    codigo: payload.codigoMotivo || null,
    severidad: payload.severidadCalculada || null,
    calidad: payload.calidad || null,
    valor: payload.valorEvaluado,
    unidad: payload.unidad || null,
    fechaUtc: payload.observadoEnUtc || registro.tiempoDatoUtc,
    evaluadoEnUtc: payload.evaluadoEnUtc || null
  });
}

function presentarActividadPol(registro) {
  const pol = presentarPol(registro);
  return Object.freeze({
    tipo: 'pol',
    elementoOrigenId: registro.elementoOrigenId,
    fuenteOrigenId: registro.payload.fuenteOrigenId || registro.fuenteOrigenId,
    nombre: `Prueba de vida ${pol.estado}`,
    detalle: pol.motivoCierre,
    fechaUtc: pol.ultimoHeartbeatUtc || pol.finUtc || pol.inicioUtc,
    ...pol
  });
}

function presentarRangoHistorico(registro) {
  const payload = registro.payload;
  return Object.freeze({
    tipo: 'rangoHistorico',
    elementoOrigenId: registro.elementoOrigenId,
    fuenteOrigenId: payload.fuenteOrigenId || registro.fuenteOrigenId,
    senalOrigenId: payload.senalOrigenId || registro.senalOrigenId,
    causa: payload.causa || 'desconocidaOrigen',
    desdeUtc: payload.desdeUtc || null,
    hastaUtc: payload.hastaUtc || null,
    fechaUtc: payload.desdeUtc || registro.tiempoDatoUtc
  });
}

function contarTipo(registros, tipo) {
  return registros.filter((registro) => registro.tipoRegistro === tipo).length;
}

function presentarResumen(installationOrigenId, registros) {
  const fuentes = registros.filter(esTipo('fuente')).map(presentarFuente);
  const senales = registros.filter(esTipo('senal')).map(presentarSenal);
  const estadosPorSenal = new Map(registros.filter(esTipo('fotografiaSenal'))
    .map((registro) => [registro.senalOrigenId, presentarEstadoSenal(registro)]));
  const polPorFuente = new Map(registros.filter(esTipo('fotografiaPol'))
    .map((registro) => [registro.fuenteOrigenId, presentarPol(registro)]));
  const fuentesPorId = new Map(fuentes.map((fuente) => [fuente.elementoOrigenId, fuente]));
  const senalesPresentadas = senales.map((senal) => Object.freeze({
    ...senal,
    estadoActual: estadosPorSenal.get(senal.elementoOrigenId) ?? null
  }));
  const grupos = fuentes.map((fuente) => Object.freeze({
    ...fuente,
    pol: polPorFuente.get(fuente.elementoOrigenId) ?? null,
    senales: Object.freeze(senalesPresentadas.filter(
      (senal) => senal.fuenteOrigenId === fuente.elementoOrigenId
    ))
  }));
  const senalesSinFuente = senalesPresentadas.filter(
    (senal) => !fuentesPorId.has(senal.fuenteOrigenId)
  );
  return Object.freeze({
    installationOrigenId,
    fuentes: Object.freeze(grupos),
    senalesSinFuente: Object.freeze(senalesSinFuente),
    resumen: Object.freeze({
      fuentes: fuentes.length,
      senales: senales.length,
      senalesConEstado: senalesPresentadas.filter((senal) => senal.estadoActual).length,
      fuentesConPol: fuentes.filter((fuente) => polPorFuente.has(fuente.elementoOrigenId)).length,
      polAbiertos: [...polPorFuente.values()].filter((pol) => pol.estado === 'abierto').length,
      registrosLeidos: registros.length,
      limiteAlcanzado: registros.length === 1000
    })
  });
}

function presentarFuente(registro) {
  return Object.freeze({
    elementoOrigenId: registro.elementoOrigenId,
    nombre: registro.payload.nombre || 'Fuente remota',
    guid: registro.payload.guid || null,
    agenteContextoOrigenId: registro.payload.agenteContextoOrigenId || null,
    scopeOrganizativo: registro.payload.scopeOrganizativo || null,
    completitud: registro.completitud
  });
}

function presentarSenal(registro) {
  return Object.freeze({
    elementoOrigenId: registro.elementoOrigenId,
    fuenteOrigenId: registro.payload.fuenteOrigenId || registro.fuenteOrigenId,
    nombre: registro.payload.nombreHumano || registro.payload.clave || 'Señal remota',
    codigo: registro.payload.codigoSenal || null,
    categoria: registro.payload.categoria || null,
    clave: registro.payload.clave || null,
    tag: registro.payload.tag || null,
    tipoDato: registro.payload.tipoDato || null,
    unidad: registro.payload.unidad || null,
    descripcion: registro.payload.descripcion || null,
    ultimaDeclaracionUtc: registro.payload.ultimaDeclaracionUtc || null,
    completitud: registro.completitud
  });
}

function presentarEstadoSenal(registro) {
  const observacion = registro.payload.observacion || {};
  return Object.freeze({
    valor: observacion.valor,
    calidad: observacion.calidad || null,
    severidad: observacion.severidadDeclarada || null,
    origen: observacion.origen || null,
    detalleHumano: observacion.detalleHumano || null,
    observadoEnUtc: observacion.observadoEnUtc || registro.tiempoDatoUtc,
    vigenteHastaUtc: observacion.vigenteHastaUtc || registro.vigenteHastaOrigenUtc,
    condicion: condicionRegistro(
      registro,
      observacion.vigenteHastaUtc || registro.vigenteHastaOrigenUtc
    )
  });
}

function presentarPol(registro) {
  return Object.freeze({
    estado: registro.payload.estado || 'nuncaObservado',
    bootId: registro.payload.bootId || null,
    inicioUtc: registro.payload.inicioUtc || null,
    finUtc: registro.payload.finUtc || null,
    ultimoHeartbeatUtc: registro.payload.ultimoHeartbeatUtc || null,
    motivoCierre: registro.payload.motivoCierre || null,
    utilizable: condicionRegistro(registro, null) === 'vigente'
  });
}

function condicionRegistro(registro, vigenteHastaUtc) {
  if (registro.estadoPublicacion.autorizacion !== 'autorizada') return 'noAutorizada';
  if (registro.estadoPublicacion.soporte !== 'sostenida') return 'sinSoporte';
  if (registro.estadoPublicacion.vigencia !== 'vigente') return 'vencida';
  if (!vigenteHastaUtc) return 'vigente';
  return Date.parse(vigenteHastaUtc) > Date.now() ? 'vigente' : 'vencida';
}

function esTipo(tipo) {
  return (registro) => registro.tipoRegistro === tipo;
}

function scopeEfectivo(contexto) {
  return Object.freeze({
    nivel: contexto?.nivelScope,
    tenantId: contexto?.tenantId ?? null,
    empresaId: contexto?.empresaId ?? null,
    sitioId: contexto?.sitioId ?? null
  });
}

function validarInstalacion(valor) {
  try {
    return String(crearIdentidadFederada({
      valor: String(valor || ''),
      tipo: TIPOS_IDENTIDAD_FEDERADA.INSTALACION
    }));
  } catch {
    throw errorHttp(400, 'installation_telemetria_remota_invalida',
      'Selecciona una instalación remota válida.');
  }
}

function validarElementoOrigen(valor, campo) {
  try {
    return String(crearIdentidadFederada({
      valor: String(valor || ''),
      tipo: TIPOS_IDENTIDAD_FEDERADA.ELEMENTO_ORIGEN
    }));
  } catch {
    throw errorHttp(400, `${campo}_invalido`, 'Selecciona una señal remota válida.');
  }
}

function normalizarFechaOpcional(valor, campo) {
  const texto = String(valor ?? '').trim();
  if (!texto) return null;
  const tiempo = Date.parse(texto);
  if (!Number.isFinite(tiempo)) {
    throw errorHttp(400, `${campo}_invalido`, 'El rango temporal solicitado no es válido.');
  }
  return new Date(tiempo).toISOString();
}

function normalizarLimiteActividad(valor) {
  if (valor === null || valor === undefined || valor === '') return 150;
  const numero = Number(valor);
  if (!Number.isSafeInteger(numero) || numero < 25 || numero > 500) {
    throw errorHttp(400, 'limite_actividad_telemetria_invalido',
      'El límite de actividad debe estar entre 25 y 500 registros.');
  }
  return numero;
}

function errorHttp(statusCode, codigo, mensaje) {
  return Object.assign(new Error(mensaje), { statusCode, codigo });
}

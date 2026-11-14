import {
  construirPresentacionTelemetriaAgente
} from './PresentacionTelemetriaAgentes.js';

const LIMITE_HISTORICO_DEFECTO = 200;
const LIMITE_HISTORICO_MAXIMO = 500;
const ORDEN_HISTORICO_DEFECTO = 'desc';
const LIMITE_SENALES_COMPARADAS = 3;
const LIMITE_MUESTRA_TARJETA = 32;

export class ServicioLecturaTelemetriaAgentes {
  constructor({
    servicioProvisionamientoAgentes,
    repositorioCatalogoSenales,
    repositorioEstadoActual,
    repositorioObservaciones
  } = {}) {
    if (!servicioProvisionamientoAgentes) {
      throw new Error('El servicio de provisionamiento de agentes es obligatorio.');
    }

    if (!repositorioCatalogoSenales) {
      throw new Error('El repositorio de catálogo de telemetría es obligatorio.');
    }

    if (!repositorioEstadoActual) {
      throw new Error('El repositorio de fotografía actual de telemetría es obligatorio.');
    }

    if (!repositorioObservaciones) {
      throw new Error('El repositorio de observaciones de telemetría es obligatorio.');
    }

    this.servicioProvisionamientoAgentes = servicioProvisionamientoAgentes;
    this.repositorioCatalogoSenales = repositorioCatalogoSenales;
    this.repositorioEstadoActual = repositorioEstadoActual;
    this.repositorioObservaciones = repositorioObservaciones;
  }

  async construirLecturaAgente(
    contextoUsuarioActual,
    idAgente,
    filtrosEntrada = {}
  ) {
    const agente = await this.obtenerAgenteVisible(
      contextoUsuarioActual,
      idAgente
    );
    const filtros = normalizarFiltrosLectura(filtrosEntrada);
    const [catalogoSenales, fotografiaActual] = await Promise.all([
      this.repositorioCatalogoSenales.listarPorAgente(agente.id),
      this.repositorioEstadoActual.listarPorAgente(agente.id)
    ]);
    const catalogoSerializado = serializarLista(catalogoSenales);
    const comparacion = this.construirComparacionSenales({
      catalogoSenales: catalogoSerializado,
      filtros
    });
    const [historico, historicosComparacion] = await Promise.all([
      this.consultarHistorico({ agenteId: agente.id, filtros }),
      Promise.all(
        comparacion.senalesAceptadas.map((senal) =>
          this.consultarHistorico({
            agenteId: agente.id,
            filtros: {
              ...filtros,
              senalId: senal.id
            }
          })
        )
      )
    ]);
    const fotografiaSerializada = serializarLista(fotografiaActual)
      .map(redactarLecturaTelemetria);
    const observacionesHistoricas = serializarLista(historico)
      .map(redactarLecturaTelemetria);
    const comparacionSerializada = {
      ...comparacion,
      historicos: comparacion.senalesAceptadas.map((senal, indice) => {
        const observaciones = serializarLista(historicosComparacion[indice])
          .map(redactarLecturaTelemetria);

        return {
          senal,
          observaciones,
          paginacion: {
            limite: filtros.limite,
            orden: filtros.orden,
            totalDevuelto: observaciones.length,
            hayMas: observaciones.length >= filtros.limite
          }
        };
      })
    };

    return {
      agente: serializarAgente(agente),
      alcance: construirAlcance(contextoUsuarioActual),
      resumen: construirResumenTelemetria({
        catalogoSenales: catalogoSerializado,
        fotografiaActual: fotografiaSerializada,
        observacionesHistoricas
      }),
      catalogoSenales: catalogoSerializado,
      fotografiaActual: fotografiaSerializada,
      historico: {
        observaciones: observacionesHistoricas,
        paginacion: {
          limite: filtros.limite,
          orden: filtros.orden,
          totalDevuelto: observacionesHistoricas.length,
          hayMas: observacionesHistoricas.length >= filtros.limite
        }
      },
      comparacion: comparacionSerializada,
      presentacion: construirPresentacionTelemetriaAgente({
        catalogoSenales: catalogoSerializado,
        fotografiaActual: fotografiaSerializada,
        historico: observacionesHistoricas
      }),
      filtros
    };
  }

  async obtenerAgenteVisible(contextoUsuarioActual, idAgente) {
    const idNormalizado = normalizarIdAgente(idAgente);
    const agentes =
      await this.servicioProvisionamientoAgentes
        .listarAgentesVisibles(contextoUsuarioActual);
    const agente = agentes.find((item) => Number(item.id) === idNormalizado);

    if (!agente) {
      throw new Error('No existe el agente solicitado dentro de tu alcance.');
    }

    return agente;
  }

  async consultarMuestraSenal(
    contextoUsuarioActual,
    idAgente,
    { senalId } = {}
  ) {
    const agente = await this.obtenerAgenteVisible(
      contextoUsuarioActual,
      idAgente
    );
    const idSenal = normalizarIdOpcional(senalId);

    if (!idSenal) {
      throw crearErrorMuestra(
        'La señal solicitada para la miniatura no es válida.',
        400,
        'senal_miniatura_invalida'
      );
    }

    const senal = typeof this.repositorioCatalogoSenales.buscarPorId === 'function'
      ? await this.repositorioCatalogoSenales.buscarPorId(idSenal)
      : (await this.repositorioCatalogoSenales.listarPorAgente(agente.id))
          .find((item) => Number(item.id) === idSenal) || null;

    if (!senal || Number(senal.agenteId) !== Number(agente.id)) {
      throw crearErrorMuestra(
        'La señal no existe dentro del agente visible.',
        404,
        'senal_miniatura_no_encontrada'
      );
    }

    if (![
      'numero',
      'booleano',
      'duracion',
      'momento_utc'
    ].includes(senal.tipoDato)) {
      throw crearErrorMuestra(
        'La señal no admite una miniatura temporal.',
        422,
        'senal_miniatura_no_graficable'
      );
    }

    const observaciones = await this.repositorioObservaciones.listarPorSenalYRango({
      agenteId: agente.id,
      senalId: idSenal,
      limite: LIMITE_MUESTRA_TARJETA,
      orden: 'desc'
    });

    return {
      agente: serializarAgente(agente),
      senal: serializarSenalComparacion(
        typeof senal.serializar === 'function' ? senal.serializar() : senal
      ),
      observaciones: serializarLista(observaciones)
        .map(redactarLecturaTelemetria)
        .reverse(),
      limite: LIMITE_MUESTRA_TARJETA
    };
  }

  async consultarHistorico({ agenteId, filtros }) {
    if (filtros.senalId || (filtros.categoria && filtros.clave)) {
      return this.repositorioObservaciones.listarPorSenalYRango({
        agenteId,
        senalId: filtros.senalId,
        categoria: filtros.categoria,
        clave: filtros.clave,
        tag: filtros.tag,
        desdeUtc: filtros.desdeUtc,
        hastaUtc: filtros.hastaUtc,
        limite: filtros.limite,
        orden: filtros.orden
      });
    }

    return [];
  }

  construirComparacionSenales({ catalogoSenales, filtros }) {
    const principal = catalogoSenales.find((senal) =>
      Number(senal.id) === Number(filtros.senalId)
    ) || null;
    const idsSolicitados = filtros.senalIdsComparadas.filter((id) =>
      Number(id) !== Number(filtros.senalId)
    );
    const senalesAceptadas = [];
    const senalesRechazadas = [];

    for (const idSenal of idsSolicitados) {
      const senal = catalogoSenales.find((item) =>
        Number(item.id) === Number(idSenal)
      );

      if (!senal) {
        senalesRechazadas.push({
          id: idSenal,
          motivo: 'La señal comparada no existe dentro del agente visible.'
        });
        continue;
      }

      if (!principal) {
        senalesRechazadas.push({
          ...serializarSenalComparacion(senal),
          motivo: 'Selecciona una señal principal antes de comparar.'
        });
        continue;
      }

      if (![
        'numero',
        'booleano',
        'duracion',
        'momento_utc'
      ].includes(principal.tipoDato)) {
        senalesRechazadas.push({
          ...serializarSenalComparacion(senal),
          motivo: 'La señal principal no admite comparación temporal.'
        });
        continue;
      }

      if (senal.tipoDato !== principal.tipoDato) {
        senalesRechazadas.push({
          ...serializarSenalComparacion(senal),
          motivo: 'El tipo de dato no coincide con la señal principal.'
        });
        continue;
      }

      if (
        !['duracion', 'momento_utc'].includes(principal.tipoDato) &&
        (senal.unidad || '') !== (principal.unidad || '')
      ) {
        senalesRechazadas.push({
          ...serializarSenalComparacion(senal),
          motivo: 'La unidad de medida no coincide con la señal principal.'
        });
        continue;
      }

      senalesAceptadas.push(serializarSenalComparacion(senal));
    }

    return {
      habilitada: Boolean(principal && senalesAceptadas.length > 0),
      tipoDatoReferencia: principal?.tipoDato || null,
      unidadReferencia: principal?.unidad || '',
      senalPrincipal: principal ? serializarSenalComparacion(principal) : null,
      senalesAceptadas,
      senalesRechazadas
    };
  }
}

export function normalizarFiltrosLectura(filtrosEntrada = {}) {
  return {
    senalId: normalizarIdOpcional(
      filtrosEntrada.senalId ?? filtrosEntrada.senal_id
    ),
    categoria: normalizarTextoOpcional(filtrosEntrada.categoria),
    clave: normalizarTextoOpcional(filtrosEntrada.clave),
    tag: normalizarTextoOpcional(filtrosEntrada.tag),
    senalIdsComparadas: normalizarIdsComparacion(
      filtrosEntrada.senalIdsComparadas ??
        filtrosEntrada.compararSenalIds ??
        filtrosEntrada.comparar_senal_ids
    ),
    desdeUtc: normalizarFechaUtcOpcional(
      filtrosEntrada.desdeUtc ?? filtrosEntrada.desde_utc
    ),
    hastaUtc: normalizarFechaUtcOpcional(
      filtrosEntrada.hastaUtc ?? filtrosEntrada.hasta_utc
    ),
    limite: normalizarLimite(filtrosEntrada.limite),
    orden: normalizarOrden(filtrosEntrada.orden)
  };
}

function normalizarIdAgente(valor) {
  const normalizado = normalizarIdOpcional(valor);

  if (!normalizado) {
    throw new Error('El agente de telemetría es obligatorio.');
  }

  return normalizado;
}

function normalizarIdOpcional(valor) {
  if (valor == null || valor === '') {
    return null;
  }

  const normalizado = Number.parseInt(String(valor), 10);
  return Number.isInteger(normalizado) && normalizado > 0
    ? normalizado
    : null;
}

function normalizarTextoOpcional(valor) {
  const normalizado = String(valor ?? '').trim();
  return normalizado || null;
}

function normalizarIdsComparacion(valor) {
  const valores = Array.isArray(valor)
    ? valor
    : String(valor ?? '')
      .split(',')
      .map((item) => item.trim());
  const ids = [];

  for (const item of valores) {
    const id = normalizarIdOpcional(item);

    if (!id || ids.includes(id)) {
      continue;
    }

    ids.push(id);

    if (ids.length >= LIMITE_SENALES_COMPARADAS) {
      break;
    }
  }

  return ids;
}

function serializarSenalComparacion(senal) {
  return {
    id: senal.id,
    codigoSenal: senal.codigoSenal,
    nombreHumano: senal.nombreHumano || senal.codigoSenal,
    tipoDato: senal.tipoDato,
    unidad: senal.unidad || ''
  };
}

function normalizarFechaUtcOpcional(valor) {
  if (!valor) {
    return null;
  }

  const fecha = valor instanceof Date ? valor : new Date(valor);

  if (Number.isNaN(fecha.getTime())) {
    throw new Error('La fecha de filtro de telemetría no es válida.');
  }

  return fecha.toISOString();
}

function normalizarLimite(valor) {
  const normalizado = Number.parseInt(String(valor ?? ''), 10);

  if (!Number.isInteger(normalizado) || normalizado <= 0) {
    return LIMITE_HISTORICO_DEFECTO;
  }

  return Math.min(normalizado, LIMITE_HISTORICO_MAXIMO);
}

function normalizarOrden(valor) {
  const normalizado = String(valor ?? '').trim().toLowerCase();
  return ['asc', 'desc'].includes(normalizado)
    ? normalizado
    : ORDEN_HISTORICO_DEFECTO;
}

function serializarLista(lista = []) {
  return lista.map((item) =>
    typeof item?.serializar === 'function' ? item.serializar() : { ...item }
  );
}

function serializarAgente(agente) {
  if (typeof agente?.obtenerResumenAdministrativo === 'function') {
    return agente.obtenerResumenAdministrativo();
  }

  return {
    id: agente.id,
    guid: agente.guid,
    nombre: agente.nombre,
    descripcion: agente.descripcion || '',
    tenantId: agente.tenantId,
    tenantNombre: agente.tenantNombre || null,
    empresaId: agente.empresaId,
    empresaNombre: agente.empresaNombre || null,
    sitioId: agente.sitioId,
    sitioNombre: agente.sitioNombre || null,
    estadoAdministrativo: agente.estadoAdministrativo,
    estadoAcceso: agente.estadoAcceso,
    estadoVidaPol: agente.estadoVidaPol,
    estadoEfectivo: agente.estadoEfectivo,
    ultimoHeartbeatUtc: agente.ultimoHeartbeatUtc || null,
    ultimoBootId: agente.ultimoBootId || null,
    ultimaVersionAgente: agente.ultimaVersionAgente || null,
    ultimoHostname: agente.ultimoHostname || null,
    ultimoSeq: agente.ultimoSeq ?? null
  };
}

function construirAlcance(contextoUsuarioActual = {}) {
  return {
    nivelScope: contextoUsuarioActual.nivelScope || null,
    tenantId: contextoUsuarioActual.tenantId ?? null,
    empresaId: contextoUsuarioActual.empresaId ?? null,
    sitioId: contextoUsuarioActual.sitioId ?? null,
    esOperadorSistema: Boolean(contextoUsuarioActual.esOperadorSistema)
  };
}

function redactarLecturaTelemetria(lectura) {
  const serializada = { ...lectura };
  delete serializada.sesionHuellaSha256;
  return serializada;
}

function crearErrorMuestra(mensaje, statusCode, codigo) {
  const error = new Error(mensaje);
  error.statusCode = statusCode;
  error.codigo = codigo;
  return error;
}

function construirResumenTelemetria({
  catalogoSenales,
  fotografiaActual,
  observacionesHistoricas
}) {
  const ultimaObservacionVisibleUtc = calcularUltimaObservacionVisibleUtc([
    ...fotografiaActual,
    ...observacionesHistoricas
  ]);

  return {
    totalSenalesCatalogadas: catalogoSenales.length,
    totalSenalesActuales: fotografiaActual.length,
    totalObservacionesHistorico: observacionesHistoricas.length,
    ultimaObservacionVisibleUtc,
    tieneTelemetria:
      catalogoSenales.length > 0 ||
      fotografiaActual.length > 0 ||
      observacionesHistoricas.length > 0
  };
}

function calcularUltimaObservacionVisibleUtc(lecturas) {
  const marcas = lecturas
    .map((lectura) => lectura.observadoEnUtc)
    .filter(Boolean)
    .map((valor) => new Date(valor))
    .filter((fecha) => !Number.isNaN(fecha.getTime()));

  if (marcas.length === 0) {
    return null;
  }

  return new Date(Math.max(...marcas.map((fecha) => fecha.getTime())))
    .toISOString();
}

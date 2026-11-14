function normalizarId(valor) {
  const numero = Number(valor);
  return Number.isInteger(numero) && numero > 0 ? numero : null;
}

function crearSetIds(valores = []) {
  return new Set(
    (Array.isArray(valores) ? valores : [])
      .map((valor) =>
        typeof valor === 'object' && valor !== null
          ? normalizarId(valor.monitorId ?? valor.id)
          : normalizarId(valor)
      )
      .filter((valor) => valor != null)
  );
}

function dependeDelMonitor(monitor, monitorIdsOrigen) {
  const dependencias = Array.isArray(monitor?.configuracion?.dependencias)
    ? monitor.configuracion.dependencias
    : [];

  return dependencias.some((dependencia) =>
    String(dependencia?.fuente || 'monitor').trim().toLowerCase() === 'monitor' &&
    monitorIdsOrigen.has(normalizarId(dependencia?.monitorId))
  );
}

function serializarCandidatoReactivo({
  monitor,
  fechaReferenciaUtc,
  profundidad
}) {
  return {
    monitorId: monitor.id,
    nombre: monitor.nombre,
    tipo: monitor.tipo,
    versionCatalogo: monitor.version,
    scope: {
      tenantId: monitor.scope?.tenantId ?? null,
      empresaId: monitor.scope?.empresaId ?? null,
      sitioId: monitor.scope?.sitioId ?? null,
      nivelPertenencia: monitor.scope?.nivelPertenencia ?? null
    },
    proximoIntentoEn: fechaReferenciaUtc,
    retrasoSegundos: 0,
    motivoProgramacion: 'dependencia_logica_actualizada',
    origenReactivo: {
      tipo: 'monitor_logico_dependiente',
      profundidad
    }
  };
}

export class PlanificadorMonitoresLogicosReactivos {
  constructor({ profundidadMaxima = 8 } = {}) {
    this.profundidadMaxima = Math.max(1, Number(profundidadMaxima || 8));
  }

  seleccionarDependientes({
    catalogoOperativo,
    monitorIdsOrigen = [],
    monitoresYaEjecutados = [],
    fechaReferenciaUtc = new Date().toISOString(),
    profundidad = 1
  }) {
    const idsOrigen = crearSetIds(monitorIdsOrigen);
    const idsYaEjecutados = crearSetIds(monitoresYaEjecutados);

    if (
      !catalogoOperativo?.monitores ||
      idsOrigen.size === 0 ||
      profundidad > this.profundidadMaxima
    ) {
      return {
        profundidad,
        totalOrigenes: idsOrigen.size,
        totalCandidatos: 0,
        candidatos: []
      };
    }

    const candidatos = [];
    const idsSeleccionados = new Set();

    for (const monitor of catalogoOperativo.monitores) {
      if (
        !monitor?.activo ||
        monitor.tipo !== 'booleano' ||
        idsOrigen.has(monitor.id) ||
        idsYaEjecutados.has(monitor.id) ||
        idsSeleccionados.has(monitor.id) ||
        !dependeDelMonitor(monitor, idsOrigen)
      ) {
        continue;
      }

      idsSeleccionados.add(monitor.id);
      candidatos.push(
        serializarCandidatoReactivo({
          monitor,
          fechaReferenciaUtc,
          profundidad
        })
      );
    }

    return {
      profundidad,
      totalOrigenes: idsOrigen.size,
      totalCandidatos: candidatos.length,
      candidatos
    };
  }
}

export class SelectorMonitoresTelemetriaReactivos {
  constructor({ repositorioVinculos } = {}) {
    if (
      !repositorioVinculos?.listarPorSenalDirecta ||
      !repositorioVinculos?.listarPorReglaDerivacion
    ) {
      throw new Error('El selector reactivo requiere el repositorio de vínculos.');
    }
    this.repositorioVinculos = repositorioVinculos;
  }

  async seleccionar({ catalogoOperativo, aviso, fechaEvaluacionUtc = new Date() } = {}) {
    const senales = normalizarSenales(aviso?.senales);
    const reglas = normalizarReglas(aviso?.reglas);
    const lotesVinculosDirectos = await Promise.all(
      senales.map((senal) => this.repositorioVinculos.listarPorSenalDirecta(senal))
    );
    const lotesVinculosReglas = await Promise.all(
      reglas.map((regla) =>
        this.repositorioVinculos.listarPorReglaDerivacion(regla.reglaId)
      )
    );
    const monitoresVinculados = new Map();
    registrarVinculos(
      monitoresVinculados,
      lotesVinculosDirectos,
      'invalidacion_telemetria_directa'
    );
    registrarVinculos(
      monitoresVinculados,
      lotesVinculosReglas,
      'invalidacion_telemetria_regla'
    );
    const candidatos = [];
    const descartados = [];
    const evaluadoEn = normalizarFecha(fechaEvaluacionUtc);

    for (const [monitorId, motivoProgramacion] of monitoresVinculados) {
      const monitor = catalogoOperativo?.buscarPorId?.(monitorId) || null;
      if (!monitor || !monitor.activo || monitor.tipo !== 'telemetria') {
        descartados.push({
          monitorId,
          motivo: !monitor
            ? 'monitor_fuera_catalogo'
            : !monitor.activo
              ? 'monitor_inactivo'
              : 'tipo_monitor_incompatible'
        });
        continue;
      }
      candidatos.push({
        monitorId: monitor.id,
        nombre: monitor.nombre,
        tipo: monitor.tipo,
        versionCatalogo: monitor.version,
        scope: { ...monitor.scope },
        proximoIntentoEn: evaluadoEn,
        retrasoSegundos: 0,
        motivoProgramacion
      });
    }

    return {
      evaluadoEnUtc: evaluadoEn,
      totalSenales: senales.length,
      totalReglas: reglas.length,
      totalVinculos: monitoresVinculados.size,
      totalCandidatos: candidatos.length,
      totalDescartados: descartados.length,
      senales,
      reglas,
      candidatos,
      descartados
    };
  }
}

function registrarVinculos(destino, lotes, motivoProgramacion) {
  for (const vinculo of lotes.flat()) {
    const monitorId = normalizarId(vinculo?.monitorId);
    if (monitorId && !destino.has(monitorId)) {
      destino.set(monitorId, motivoProgramacion);
    }
  }
}

function normalizarSenales(senales) {
  const unicas = new Map();
  for (const senal of Array.isArray(senales) ? senales : []) {
    const agenteId = normalizarId(senal?.agenteId);
    const senalId = normalizarId(senal?.senalId);
    if (agenteId && senalId) {
      unicas.set(`${agenteId}:${senalId}`, { agenteId, senalId });
    }
  }
  return [...unicas.values()];
}

function normalizarReglas(reglas) {
  const unicas = new Map();
  for (const regla of Array.isArray(reglas) ? reglas : []) {
    const reglaId = normalizarId(regla?.reglaId);
    if (reglaId) {
      unicas.set(reglaId, { reglaId });
    }
  }
  return [...unicas.values()];
}

function normalizarId(valor) {
  const id = Number(valor);
  return Number.isInteger(id) && id > 0 ? id : null;
}

function normalizarFecha(valor) {
  const fecha = valor instanceof Date ? valor : new Date(valor);
  return Number.isNaN(fecha.getTime()) ? new Date().toISOString() : fecha.toISOString();
}

import { generarUuidV7Auditoria, validarUuidV7Auditoria } from '../../auditoria/src/UuidV7Auditoria.js';

export class ServicioConflictosIdentidadFederacion {
  constructor({ repositorio, repositorioSesionesRedis, reloj = () => Date.now() } = {}) {
    exigirMetodo(repositorio, 'observar', 'repositorio');
    exigirMetodo(repositorio, 'resolver', 'repositorio');
    exigirMetodo(repositorioSesionesRedis, 'revocar', 'repositorioSesionesRedis');
    if (typeof reloj !== 'function') throw new Error('El detector de clones exige reloj.');
    this.repositorio = repositorio;
    this.repositorioSesionesRedis = repositorioSesionesRedis;
    this.reloj = reloj;
  }

  async observar({ installationRemotaId, presencias, consolidacionReinicioMs } = {}) {
    exigirIdentidad(installationRemotaId, 'instalacion', 'installationRemotaId');
    if (!Array.isArray(presencias) || !Number.isSafeInteger(consolidacionReinicioMs) ||
        consolidacionReinicioMs < 0 || consolidacionReinicioMs > 3600000) {
      throw new Error('La observación de identidad no es válida.');
    }
    const observadas = presencias.map(normalizarPresencia);
    const porRelacion = new Map();
    for (const presencia of observadas) {
      const actual = porRelacion.get(presencia.relacionId);
      if (!actual || BigInt(presencia.fencingToken) > BigInt(actual.fencingToken)) {
        porRelacion.set(presencia.relacionId, presencia);
      }
    }
    const normalizadas = [...porRelacion.values()];
    const porBoot = new Map();
    for (const presencia of normalizadas) {
      const instante = Date.parse(presencia.primeroObservadoEnUtc);
      const actual = porBoot.get(presencia.bootRemotoId);
      if (actual === undefined || instante < actual) porBoot.set(presencia.bootRemotoId, instante);
    }
    if (porBoot.size < 2) return Object.freeze({ estado: 'sin_conflicto' });
    const bootIds = [...porBoot.keys()].sort();
    const inicioCoexistencia = Math.max(...porBoot.values());
    const coexistenciaMs = Math.max(0, this.reloj() - inicioCoexistencia);
    const confirmar = coexistenciaMs >= consolidacionReinicioMs;
    const resultado = await this.repositorio.observar({
      incidenteId: generarUuidV7Auditoria(),
      eventoDeteccionId: generarUuidV7Auditoria(),
      installationRemotaId,
      bootIds,
      presencias: normalizadas,
      confirmar,
      evidencia: {
        tipo: 'boot_ids_concurrentes',
        coexistenciaMs: String(coexistenciaMs),
        consolidacionReinicioMs: String(consolidacionReinicioMs)
      }
    });
    for (const relacionId of resultado.relacionesCuarentena) {
      await this.repositorioSesionesRedis.revocar(relacionId);
    }
    return resultado;
  }

  listarAbiertos() {
    exigirMetodo(this.repositorio, 'listarAbiertos', 'repositorio');
    return this.repositorio.listarAbiertos();
  }

  async resolver(entrada = {}) {
    validarUuidV7Auditoria(entrada.incidenteId, 'incidenteId');
    validarUuidV7Auditoria(entrada.eventoId, 'eventoId');
    validarUuidV7Auditoria(entrada.correlacionId, 'correlacionId');
    exigirIdentidad(entrada.installationClonNuevaId, 'instalacion', 'installationClonNuevaId');
    for (const campo of ['relacionesLegitimas', 'relacionesClon', 'relacionesNuevasClon']) {
      if (!Array.isArray(entrada[campo])) throw new Error(`${campo} debe ser una lista.`);
      entrada[campo].forEach((id) => exigirIdentidad(id, 'relacion', campo));
    }
    validarActorDirecto(entrada.actor);
    const resultado = await this.repositorio.resolver(entrada);
    for (const relacionId of resultado.relacionesClon || []) {
      await this.repositorioSesionesRedis.revocar(relacionId);
    }
    return resultado;
  }
}

function normalizarPresencia(presencia) {
  exigirIdentidad(presencia?.relacionId, 'relacion', 'presencia.relacionId');
  exigirIdentidad(presencia?.bootRemotoId, 'arranque', 'presencia.bootRemotoId');
  exigirFecha(presencia?.primeroObservadoEnUtc, 'presencia.primeroObservadoEnUtc');
  if (typeof presencia?.fencingToken !== 'string' ||
      !/^[1-9][0-9]*$/u.test(presencia.fencingToken)) {
    throw new Error('presencia.fencingToken no es un contador decimal positivo.');
  }
  return Object.freeze({
    relacionId: presencia.relacionId,
    bootRemotoId: presencia.bootRemotoId,
    primeroObservadoEnUtc: presencia.primeroObservadoEnUtc,
    fencingToken: presencia.fencingToken
  });
}
function validarActorDirecto(actor) {
  if (actor?.modo !== 'directo' || actor?.real?.tipo !== 'usuario' ||
      actor.efectivo != null || !/^[1-9][0-9]*$/u.test(String(actor.real.id))) {
    throw new Error('Resolver un conflicto exige una sesión humana directa.');
  }
}
function exigirFecha(valor, campo) {
  if (typeof valor !== 'string' || !Number.isFinite(Date.parse(valor))) {
    throw new Error(`${campo} no es un instante válido.`);
  }
}
function exigirIdentidad(valor, tipo, campo) {
  if (typeof valor !== 'string' ||
      !new RegExp(`^sfid1\\.${tipo}\\.[A-Za-z0-9_-]{21}[AQgw]$`, 'u').test(valor)) {
    throw new Error(`${campo} no es canónica.`);
  }
}
function exigirMetodo(valor, metodo, campo) {
  if (typeof valor?.[metodo] !== 'function') throw new Error(`${campo} exige ${metodo}().`);
}

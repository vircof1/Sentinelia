import { generarUuidV7Auditoria } from './UuidV7Auditoria.js';
import { esClaveCadenaAuditoria } from './CatalogoAuditoria.js';

export class ServicioRetencionCadenaAuditoria {
  constructor({
    repositorioRetencion,
    servicioAuditoria,
    ahora = () => new Date().toISOString()
  } = {}) {
    if (!repositorioRetencion?.preflightPrefijo || !repositorioRetencion?.enTransaccion) {
      throw new Error('ServicioRetencionCadenaAuditoria requiere repositorio de retención completo.');
    }
    if (!servicioAuditoria?.registrarEnTransaccion) {
      throw new Error('ServicioRetencionCadenaAuditoria requiere servicio de auditoría transaccional.');
    }
    if (typeof ahora !== 'function') {
      throw new Error('ServicioRetencionCadenaAuditoria requiere reloj inyectable.');
    }
    this.repositorioRetencion = repositorioRetencion;
    this.servicioAuditoria = servicioAuditoria;
    this.ahora = ahora;
  }

  async recortarPrefijo({ claveCadena, dias, limiteEventos = 500, eventoId = generarUuidV7Auditoria(), correlacionId = generarUuidV7Auditoria(), efectivoEnUtc = this.ahora() } = {}) {
    validarEntrada({ claveCadena, dias, limiteEventos, efectivoEnUtc });
    const corteUtc = calcularCorteUtc(efectivoEnUtc, dias);
    const preflight = await this.repositorioRetencion.preflightPrefijo({
      claveCadena,
      corteUtc,
      limiteEventos
    });
    if (!preflight?.aplicable) {
      return Object.freeze({
        estado: 'sin_cambios',
        claveCadena,
        corteUtc,
        motivo: preflight?.motivo ?? 'sin_prefijo_vencido'
      });
    }

    const intencionGobierno = construirIntencionGobierno({
      plan: preflight,
      dias,
      eventoId,
      correlacionId,
      efectivoEnUtc
    });

    return this.repositorioRetencion.enTransaccion(async ({ repositorio, conexion }) => {
      await repositorio.bloquearIdentidadesPrefijo(preflight);
      const registro = await this.servicioAuditoria.registrarEnTransaccion({
        cambioEfectivo: true,
        intencion: intencionGobierno
      }, { conexion });
      await repositorio.bloquearCabeceras(preflight);
      const plan = await repositorio.revalidarPrefijo(preflight);
      await repositorio.aplicarRecorte(plan, {
        eventoRetencionId: registro.evento.eventoId,
        dias,
        aplicadoEnUtc: efectivoEnUtc
      });
      return Object.freeze({
        estado: 'aplicado',
        claveCadena,
        secuenciaDesde: plan.secuenciaDesde,
        secuenciaHasta: plan.secuenciaHasta,
        primeraSecuenciaConservada: plan.primeraSecuenciaConservada,
        hashHasta: plan.hashHasta,
        eventoRetencionId: registro.evento.eventoId
      });
    });
  }
}

function construirIntencionGobierno({ plan, dias, eventoId, correlacionId, efectivoEnUtc }) {
  return {
    eventoId,
    tipo: 'auditoria.retencion_aplicada',
    versionContrato: 1,
    flujo: 'sistema',
    claveCadena: 'sistema:portal',
    actorReal: { tipo: 'sistema', id: 'sentinelia-system' },
    actorEfectivo: null,
    modoActuacion: 'directo',
    sujeto: { tipo: 'cadena_auditoria', id: plan.claveCadena },
    origen: 'tarea_sistema',
    scope: { tenantId: null, empresaId: null, sitioId: null },
    correlacionId,
    causalidad: null,
    productor: 'tarea_retencion',
    claveOperacion: `retencion:v1:${plan.claveCadena}:${plan.secuenciaHasta}:${plan.hashHasta}`,
    rolEvento: 'principal',
    efectivoEnUtc,
    versionCanonicalizador: 'sentinelia-auditoria-jcs-v1',
    versionEncadenado: 'sentinelia-auditoria-sha256-v1',
    payload: {
      cadenaAfectada: plan.claveCadena,
      secuenciaDesde: plan.secuenciaDesde,
      secuenciaHasta: plan.secuenciaHasta,
      hashAnteriorAlTramo: plan.hashAnteriorAlTramo,
      hashHasta: plan.hashHasta,
      primeraSecuenciaConservada: plan.primeraSecuenciaConservada,
      dias
    }
  };
}

function calcularCorteUtc(efectivoEnUtc, dias) {
  const fecha = new Date(efectivoEnUtc);
  if (Number.isNaN(fecha.getTime())) throw new Error('efectivoEnUtc no es una fecha UTC válida.');
  fecha.setUTCDate(fecha.getUTCDate() - dias);
  return fecha.toISOString().replace(/\.\d{3}Z$/, '.000Z');
}

function validarEntrada({ claveCadena, dias, limiteEventos, efectivoEnUtc }) {
  if (!esClaveCadenaAuditoria(String(claveCadena))) {
    throw new Error('claveCadena de retención no válida.');
  }
  if (!Number.isInteger(dias) || dias < 1 || dias > 36500) {
    throw new Error('dias de retención debe estar entre 1 y 36500.');
  }
  if (!Number.isInteger(limiteEventos) || limiteEventos < 1 || limiteEventos > 5000) {
    throw new Error('limiteEventos debe estar entre 1 y 5000.');
  }
  if (typeof efectivoEnUtc !== 'string' || !/Z$/.test(efectivoEnUtc)) {
    throw new Error('efectivoEnUtc debe ser fecha UTC textual.');
  }
}

export const __testablesServicioRetencionCadenaAuditoria = Object.freeze({
  construirIntencionGobierno,
  calcularCorteUtc
});

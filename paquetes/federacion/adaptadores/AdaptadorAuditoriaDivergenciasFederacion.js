import { construirClaveCadenaAuditoria } from '../../auditoria/src/CatalogoAuditoria.js';
import { PERFIL_JCS_AUDITORIA_V1 } from '../../auditoria/src/PerfilJcsAuditoria.js';
import { VERSION_ENCADENADO_AUDITORIA_V1 } from '../../auditoria/src/SobreCanonicoAuditoria.js';

export class AdaptadorAuditoriaDivergenciasFederacion {
  constructor({ repositorioAuditoria } = {}) {
    if (typeof repositorioAuditoria?.incorporarEnTransaccion !== 'function') {
      throw new Error('La exclusión de rutas exige auditoría transaccional.');
    }
    this.repositorioAuditoria = repositorioAuditoria;
  }

  async registrarExclusionEnTransaccion(entrada, { conexion } = {}) {
    if (!conexion?.execute) {
      throw new Error('La auditoría de divergencia exige una conexión prestada.');
    }
    const resultado = await this.repositorioAuditoria.incorporarEnTransaccion(
      [construirIntencion(entrada)],
      { conexion }
    );
    if (resultado?.eventos?.length !== 1 ||
        resultado.eventos[0]?.estado !== 'incorporado') {
      throw new Error('La exclusión de ruta no quedó incorporada en auditoría.');
    }
    return Object.freeze({ ...resultado.eventos[0] });
  }

  async registrarDeteccionEnTransaccion(entrada, { conexion } = {}) {
    if (!conexion?.execute) {
      throw new Error('La detección de divergencia exige una conexión prestada.');
    }
    const resultado = await this.repositorioAuditoria.incorporarEnTransaccion(
      [construirDeteccion(entrada)],
      { conexion }
    );
    if (resultado?.eventos?.length !== 1 ||
        resultado.eventos[0]?.estado !== 'incorporado') {
      throw new Error('La divergencia no quedó incorporada en auditoría.');
    }
    return Object.freeze({ ...resultado.eventos[0] });
  }
}

function construirIntencion(entrada) {
  return {
    eventoId: entrada.eventoId,
    tipo: 'federacion.ruta_excluida',
    versionContrato: 2,
    flujo: 'federacion',
    claveCadena: construirClaveCadenaAuditoria({
      flujo: 'federacion',
      tenantId: entrada.scope.tenantId
    }),
    actorReal: entrada.actor.real,
    actorEfectivo: entrada.actor.efectivo ?? null,
    modoActuacion: entrada.actor.modo,
    sujeto: { tipo: 'proyeccion_federada', id: entrada.proyeccionId },
    origen: 'web',
    scope: entrada.scope,
    correlacionId: entrada.correlacionId,
    causalidad: null,
    productor: 'portal_federacion',
    claveOperacion: `divergencia-federacion:v1:${entrada.eventoId}`,
    rolEvento: 'principal',
    efectivoEnUtc: normalizarFecha(entrada.efectivoEnUtc),
    versionCanonicalizador: PERFIL_JCS_AUDITORIA_V1,
    versionEncadenado: VERSION_ENCADENADO_AUDITORIA_V1,
    payload: {
      accion: 'excluir_ruta',
      resultado: 'excluida',
      motivoCodigo: 'divergencia_contenido',
      revisionConcesionId: entrada.revisionConcesionId,
      resumen: {
        relacionesAfectadas: '1',
        flujosAfectados: '0',
        proyeccionesAfectadas: '1'
      }
    }
  };
}

function construirDeteccion(entrada) {
  return {
    eventoId: entrada.eventoId,
    tipo: 'federacion.divergencia_detectada',
    versionContrato: 2,
    flujo: 'federacion',
    claveCadena: construirClaveCadenaAuditoria({
      flujo: 'federacion', tenantId: entrada.scope.tenantId
    }),
    actorReal: { tipo: 'runtime', id: 'sentinelia-runtime' },
    actorEfectivo: null,
    modoActuacion: 'directo',
    sujeto: { tipo: 'proyeccion_federada', id: entrada.proyeccionId },
    origen: 'runtime',
    scope: entrada.scope,
    correlacionId: entrada.correlacionId,
    causalidad: null,
    productor: 'runtime_federacion',
    claveOperacion: `divergencia-detectada:v1:${entrada.eventoId}`,
    rolEvento: 'principal',
    efectivoEnUtc: normalizarFecha(entrada.efectivoEnUtc),
    versionCanonicalizador: PERFIL_JCS_AUDITORIA_V1,
    versionEncadenado: VERSION_ENCADENADO_AUDITORIA_V1,
    payload: {
      direccion: 'recepcion',
      resultado: 'divergente',
      generacionId: entrada.generacionId,
      loteId: entrada.loteId,
      rango: {
        desde: entrada.posicionFlujo,
        hasta: entrada.posicionFlujo
      },
      conteos: {
        ocurrencias: '1',
        aceptadas: '0',
        rechazadas: '1',
        bytes: entrada.bytes
      },
      codigo: 'divergencia'
    }
  };
}

function normalizarFecha(valor) {
  if (valor instanceof Date) return valor.toISOString();
  const texto = String(valor || '');
  const sql = texto.match(
    /^(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2}:\d{2})\.(\d{3})\d{0,3}$/u
  );
  return sql ? `${sql[1]}T${sql[2]}.${sql[3]}Z` : texto;
}

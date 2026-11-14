import { construirClaveCadenaAuditoria } from '../../auditoria/src/CatalogoAuditoria.js';
import { PERFIL_JCS_AUDITORIA_V1 } from '../../auditoria/src/PerfilJcsAuditoria.js';
import { VERSION_ENCADENADO_AUDITORIA_V1 } from '../../auditoria/src/SobreCanonicoAuditoria.js';

export class AdaptadorAuditoriaTiempoEstadosRemotos {
  constructor({ repositorioAuditoria, installationLocalId } = {}) {
    if (typeof repositorioAuditoria?.incorporarEnTransaccion !== 'function') {
      throw new Error('La auditoría temporal remota exige un repositorio transaccional.');
    }
    if (!installationLocalId) {
      throw new Error('La auditoría temporal remota exige la instalación local.');
    }
    this.repositorioAuditoria = repositorioAuditoria;
    this.installationLocalId = String(installationLocalId);
  }

  registrarCicloEnTransaccion({ eventoId, operacion, bootId, efectivoEnUtc }, opciones) {
    const iniciada = operacion === 'iniciada';
    return this.#registrar({
      eventoId,
      tipo: iniciada
        ? 'federacion.consolidacion_estados_remotos_iniciada'
        : 'federacion.consolidacion_estados_remotos_finalizada',
      sujeto: { tipo: 'instalacion_federada', id: this.installationLocalId },
      scope: scopePortal(),
      efectivoEnUtc,
      accion: iniciada
        ? 'iniciar_consolidacion_estados_remotos'
        : 'finalizar_consolidacion_estados_remotos',
      resultado: iniciada ? 'iniciada' : 'finalizada',
      motivoCodigo: 'arranque_runtime',
      resumen: { relacionesAfectadas: '0', flujosAfectados: '0', proyeccionesAfectadas: '0' }
    }, opciones);
  }

  registrarEstadoEnTransaccion({
    eventoId,
    proyeccionId,
    scope,
    efectivoEnUtc,
    causa
  }, opciones) {
    return this.#registrar({
      eventoId,
      tipo: 'federacion.estado_temporal_remoto_cambiado',
      sujeto: { tipo: 'proyeccion_federada', id: proyeccionId },
      scope,
      efectivoEnUtc,
      accion: 'cambiar_estado_temporal_remoto',
      resultado: 'actualizado',
      motivoCodigo: causa,
      resumen: { relacionesAfectadas: '0', flujosAfectados: '0', proyeccionesAfectadas: '1' }
    }, opciones);
  }

  async #registrar(entrada, { conexion } = {}) {
    if (typeof conexion?.execute !== 'function') {
      throw new Error('La auditoría temporal exige una conexión prestada.');
    }
    const intencion = {
      eventoId: entrada.eventoId,
      tipo: entrada.tipo,
      versionContrato: 2,
      flujo: 'federacion',
      claveCadena: construirClaveCadenaAuditoria({
        flujo: 'federacion',
        tenantId: entrada.scope.tenantId
      }),
      actorReal: { tipo: 'runtime', id: 'sentinelia-runtime' },
      actorEfectivo: null,
      modoActuacion: 'directo',
      sujeto: entrada.sujeto,
      origen: 'runtime',
      scope: entrada.scope,
      correlacionId: entrada.eventoId,
      causalidad: null,
      productor: 'runtime_federacion',
      claveOperacion: `tiempo-remoto:v1:${entrada.eventoId}`,
      rolEvento: 'principal',
      efectivoEnUtc: entrada.efectivoEnUtc,
      versionCanonicalizador: PERFIL_JCS_AUDITORIA_V1,
      versionEncadenado: VERSION_ENCADENADO_AUDITORIA_V1,
      payload: {
        accion: entrada.accion,
        resultado: entrada.resultado,
        motivoCodigo: entrada.motivoCodigo,
        revisionConcesionId: null,
        resumen: entrada.resumen
      }
    };
    const resultado = await this.repositorioAuditoria.incorporarEnTransaccion(
      [intencion],
      { conexion }
    );
    if (resultado?.eventos?.[0]?.estado !== 'incorporado') {
      throw new Error('La auditoría temporal no incorporó su evento único.');
    }
    return resultado.eventos[0];
  }
}

function scopePortal() {
  return { tenantId: null, empresaId: null, sitioId: null };
}

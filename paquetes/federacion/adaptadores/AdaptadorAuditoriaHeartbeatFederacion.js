import { construirClaveCadenaAuditoria } from '../../auditoria/src/CatalogoAuditoria.js';
import { PERFIL_JCS_AUDITORIA_V1 } from '../../auditoria/src/PerfilJcsAuditoria.js';
import { VERSION_ENCADENADO_AUDITORIA_V1 } from '../../auditoria/src/SobreCanonicoAuditoria.js';

export class AdaptadorAuditoriaHeartbeatFederacion {
  constructor({ repositorioAuditoria } = {}) {
    if (typeof repositorioAuditoria?.incorporarEnTransaccion !== 'function') {
      throw new Error('La consolidación federada requiere auditoría transaccional.');
    }
    this.repositorioAuditoria = repositorioAuditoria;
  }

  async registrarCompatibilidadEnTransaccion(entrada, { conexion } = {}) {
    if (!conexion?.execute) throw new Error('La auditoría exige conexión prestada.');
    const resultado = await this.repositorioAuditoria.incorporarEnTransaccion([{
      eventoId: entrada.eventoId,
      tipo: 'federacion.compatibilidad_comprobada',
      versionContrato: 2,
      flujo: 'federacion',
      claveCadena: construirClaveCadenaAuditoria({
        flujo: 'federacion', tenantId: entrada.scope.tenantId
      }),
      actorReal: { tipo: 'instancia_remota', id: entrada.installationRemotaId },
      actorEfectivo: null,
      modoActuacion: 'directo',
      sujeto: { tipo: 'relacion_federada', id: entrada.relacionId },
      origen: 'api_federacion',
      scope: entrada.scope,
      correlacionId: entrada.eventoId,
      causalidad: { tipo: 'relacion_federacion', id: entrada.relacionId },
      productor: 'api_federacion',
      claveOperacion: `compatibilidad-federacion:v1:${entrada.eventoId}`,
      rolEvento: 'principal',
      efectivoEnUtc: entrada.efectivoEnUtc,
      versionCanonicalizador: PERFIL_JCS_AUDITORIA_V1,
      versionEncadenado: VERSION_ENCADENADO_AUDITORIA_V1,
      payload: {
        accion: 'comprobar_compatibilidad',
        resultado: entrada.compatible ? 'compatible' : 'incompatible',
        motivoCodigo: entrada.estadoCicloNuevo === 'vinculada'
          ? 'autenticacion_consolidada' : 'contrato_comprobado',
        revisionConcesionId: null,
        resumen: {
          relacionesAfectadas: '1', flujosAfectados: '0', proyeccionesAfectadas: '0'
        }
      }
    }], { conexion });
    if (resultado?.eventos?.[0]?.estado !== 'incorporado') {
      throw new Error('La auditoría no incorporó la comprobación federada.');
    }
    return Object.freeze({ ...resultado.eventos[0] });
  }
}

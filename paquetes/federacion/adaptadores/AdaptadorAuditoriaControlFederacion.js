import { construirClaveCadenaAuditoria } from '../../auditoria/src/CatalogoAuditoria.js';
import { PERFIL_JCS_AUDITORIA_V1 } from '../../auditoria/src/PerfilJcsAuditoria.js';
import { VERSION_ENCADENADO_AUDITORIA_V1 } from '../../auditoria/src/SobreCanonicoAuditoria.js';

export class AdaptadorAuditoriaControlFederacion {
  constructor({ repositorioAuditoria } = {}) {
    if (typeof repositorioAuditoria?.incorporarEnTransaccion !== 'function') {
      throw new Error('La auditoría de control federado requiere repositorio transaccional.');
    }
    this.repositorioAuditoria = repositorioAuditoria;
  }

  async registrarEnTransaccion(entrada, { conexion } = {}) {
    if (!conexion?.execute) throw new Error('La auditoría federada exige conexión prestada.');
    const intencion = construirIntencion(entrada);
    const resultado = await this.repositorioAuditoria.incorporarEnTransaccion(
      [intencion], { conexion }
    );
    if (resultado?.eventos?.length !== 1 || resultado.eventos[0]?.estado !== 'incorporado') {
      throw new Error('La auditoría no incorporó la transición federada.');
    }
    return Object.freeze({ ...resultado.eventos[0] });
  }
}

function construirIntencion(entrada) {
  const esRevision = entrada.tipo === 'federacion.concesion_revisada';
  const esVinculacion = entrada.tipo === 'federacion.vinculacion_solicitada';
  const esConfirmacion = entrada.tipo === 'federacion.vinculacion_confirmada';
  const esRevocacionInvitacion = entrada.tipo === 'federacion.invitacion_revocada';
  const esTransferencia = entrada.tipo === 'federacion.responsabilidad_transferida';
  const procedeDeApiFederada = entrada.actor?.real?.tipo === 'instancia_remota';
  return {
    eventoId: entrada.eventoId,
    tipo: entrada.tipo,
    versionContrato: 2,
    flujo: 'federacion',
    claveCadena: construirClaveCadenaAuditoria({
      flujo: 'federacion', tenantId: entrada.scope.tenantId
    }),
    actorReal: entrada.actor.real,
    actorEfectivo: entrada.actor.efectivo ?? null,
    modoActuacion: entrada.actor.modo,
    sujeto: {
      tipo: esRevision ? 'revision_concesion_federada' : 'relacion_federada',
      id: esRevision ? entrada.revisionConcesionId : entrada.relacionId
    },
    origen: procedeDeApiFederada ? 'api_federacion' : 'web',
    scope: entrada.scope,
    correlacionId: entrada.correlacionId,
    causalidad: { tipo: 'relacion_federacion', id: entrada.relacionId },
    productor: procedeDeApiFederada ? 'api_federacion' : 'portal_federacion',
    claveOperacion: `control-federacion:v1:${entrada.eventoId}`,
    rolEvento: 'principal',
    efectivoEnUtc: normalizarFechaAuditoria(entrada.efectivoEnUtc),
    versionCanonicalizador: PERFIL_JCS_AUDITORIA_V1,
    versionEncadenado: VERSION_ENCADENADO_AUDITORIA_V1,
    payload: {
      accion: esRevision ? 'revisar_concesion'
        : esVinculacion ? 'solicitar_vinculacion'
          : esConfirmacion ? 'confirmar_vinculacion'
          : esRevocacionInvitacion ? 'revocar_invitacion'
            : esTransferencia ? 'transferir_responsabilidad'
              : 'cambiar_estado_relacion',
      resultado: esRevision ? 'revisada'
        : esVinculacion ? 'solicitada'
          : esConfirmacion ? 'confirmada'
          : esRevocacionInvitacion ? 'revocada'
            : esTransferencia ? 'transferida'
              : 'actualizada',
      motivoCodigo: entrada.motivoCodigo
        ? String(entrada.motivoCodigo).replace(/[A-Z]/g, (letra) => `_${letra.toLowerCase()}`)
        : null,
      revisionConcesionId: entrada.revisionConcesionId ?? null,
      resumen: {
        relacionesAfectadas: '1', flujosAfectados: '0', proyeccionesAfectadas: '0'
      }
    }
  };
}

function normalizarFechaAuditoria(valor) {
  const texto = String(valor || '');
  const sql = texto.match(
    /^(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2}:\d{2})\.(\d{3})\d{0,3}$/u
  );
  if (sql) {
    return `${sql[1]}T${sql[2]}.${sql[3]}Z`;
  }
  return texto;
}

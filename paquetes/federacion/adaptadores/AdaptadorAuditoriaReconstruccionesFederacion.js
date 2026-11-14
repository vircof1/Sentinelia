import { construirClaveCadenaAuditoria } from '../../auditoria/src/CatalogoAuditoria.js';
import { PERFIL_JCS_AUDITORIA_V1 } from '../../auditoria/src/PerfilJcsAuditoria.js';
import { VERSION_ENCADENADO_AUDITORIA_V1 } from '../../auditoria/src/SobreCanonicoAuditoria.js';

const ACCIONES = Object.freeze({
  iniciarReconstruccion: ['iniciar_reconstruccion', 'creada'],
  esperarCandidata: ['esperar_candidata', 'espera'],
  ampliarCandidata: ['ampliar_candidata', 'ampliada'],
  sustituirCandidatas: ['sustituir_candidatas', 'sustituida'],
  cancelarCandidata: ['cancelar_candidata', 'cancelada'],
  promoverCandidata: ['promover_candidata', 'promovida'],
  revalidarCandidata: ['revalidar_candidata', 'revalidada']
});

export class AdaptadorAuditoriaReconstruccionesFederacion {
  constructor({ repositorioAuditoria } = {}) {
    if (typeof repositorioAuditoria?.incorporarEnTransaccion !== 'function') {
      throw new Error('Las reconstrucciones manuales exigen auditoría transaccional.');
    }
    this.repositorioAuditoria = repositorioAuditoria;
  }

  async registrarEnTransaccion(entrada, { conexion } = {}) {
    if (!conexion?.execute || !ACCIONES[entrada.accion]) {
      throw new Error('La decisión de reconstrucción no es auditable.');
    }
    const [accion, resultado] = ACCIONES[entrada.accion];
    const incorporacion = await this.repositorioAuditoria.incorporarEnTransaccion([{
      eventoId: entrada.eventoId,
      tipo: 'federacion.reconstruccion_decidida',
      versionContrato: 2,
      flujo: 'federacion',
      claveCadena: construirClaveCadenaAuditoria({
        flujo: 'federacion',
        tenantId: entrada.scope.tenantId
      }),
      actorReal: entrada.actor.real,
      actorEfectivo: null,
      modoActuacion: 'directo',
      sujeto: { tipo: 'flujo_federado', id: entrada.flujoId },
      origen: 'web',
      scope: entrada.scope,
      correlacionId: entrada.correlacionId,
      causalidad: null,
      productor: 'portal_federacion',
      claveOperacion: `reconstruccion-federacion:v1:${entrada.eventoId}`,
      rolEvento: 'principal',
      efectivoEnUtc: normalizarFecha(entrada.efectivoEnUtc),
      versionCanonicalizador: PERFIL_JCS_AUDITORIA_V1,
      versionEncadenado: VERSION_ENCADENADO_AUDITORIA_V1,
      payload: {
        accion,
        resultado,
        motivoCodigo: 'decision_operador',
        revisionConcesionId: null,
        resumen: {
          relacionesAfectadas: '0',
          flujosAfectados: '1',
          proyeccionesAfectadas: '0'
        }
      }
    }], { conexion });
    if (incorporacion?.eventos?.length !== 1 ||
        incorporacion.eventos[0]?.estado !== 'incorporado') {
      throw new Error('La decisión de reconstrucción no quedó auditada.');
    }
    return Object.freeze({ ...incorporacion.eventos[0] });
  }
}

function normalizarFecha(valor) {
  if (valor instanceof Date) return valor.toISOString();
  const texto = String(valor || '');
  const sql = texto.match(
    /^(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2}:\d{2})\.(\d{3})\d{0,3}$/u
  );
  return sql ? `${sql[1]}T${sql[2]}.${sql[3]}Z` : texto;
}

import { construirClaveCadenaAuditoria } from '../../auditoria/src/CatalogoAuditoria.js';
import { PERFIL_JCS_AUDITORIA_V1 } from '../../auditoria/src/PerfilJcsAuditoria.js';
import { VERSION_ENCADENADO_AUDITORIA_V1 } from '../../auditoria/src/SobreCanonicoAuditoria.js';

export class AdaptadorAuditoriaSesionesFederacion {
  constructor({ repositorioAuditoria } = {}) {
    if (typeof repositorioAuditoria?.incorporarEnTransaccion !== 'function') {
      throw new Error('Las sesiones federadas requieren auditoría transaccional.');
    }
    this.repositorioAuditoria = repositorioAuditoria;
  }

  registrarLoginEnTransaccion(entrada, opciones) {
    return this.#registrar({
      ...entrada,
      tipo: 'federacion.sesion_iniciada',
      actor: {
        real: { tipo: 'instancia_remota', id: entrada.installationRemotaId },
        efectivo: null,
        modo: 'directo'
      },
      origen: 'api_federacion',
      productor: 'api_federacion',
      accion: 'iniciar_sesion',
      resultado: 'iniciada'
    }, opciones);
  }

  registrarRevocacionEnTransaccion(entrada, opciones) {
    return this.#registrar({
      ...entrada,
      tipo: 'federacion.sesion_revocada',
      origen: 'web',
      productor: 'portal_federacion',
      accion: 'revocar_sesion',
      resultado: 'revocada'
    }, opciones);
  }

  async #registrar(entrada, { conexion } = {}) {
    if (!conexion?.execute) throw new Error('La auditoría exige conexión prestada.');
    const resultado = await this.repositorioAuditoria.incorporarEnTransaccion([{
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
      sujeto: { tipo: 'relacion_federada', id: entrada.relacionId },
      origen: entrada.origen,
      scope: entrada.scope,
      correlacionId: entrada.requestId,
      causalidad: { tipo: 'relacion_federacion', id: entrada.relacionId },
      productor: entrada.productor,
      claveOperacion: `sesion-federacion:v1:${entrada.eventoId}`,
      rolEvento: 'principal',
      efectivoEnUtc: normalizarFecha(entrada.efectivoEnUtc),
      versionCanonicalizador: PERFIL_JCS_AUDITORIA_V1,
      versionEncadenado: VERSION_ENCADENADO_AUDITORIA_V1,
      payload: {
        accion: entrada.accion,
        resultado: entrada.resultado,
        motivoCodigo: null,
        revisionConcesionId: null,
        resumen: {
          relacionesAfectadas: '1', flujosAfectados: '0', proyeccionesAfectadas: '0'
        }
      }
    }], { conexion });
    if (resultado?.eventos?.length !== 1 || resultado.eventos[0]?.estado !== 'incorporado') {
      throw new Error('La auditoría no incorporó la sesión federada.');
    }
    return Object.freeze({ ...resultado.eventos[0] });
  }
}

function normalizarFecha(valor) {
  const texto = String(valor || '');
  const sql = texto.match(
    /^(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2}:\d{2})\.(\d{3})\d{0,3}$/u
  );
  return sql ? `${sql[1]}T${sql[2]}.${sql[3]}Z` : texto;
}

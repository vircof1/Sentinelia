import {
  PERFIL_JCS_AUDITORIA_V1
} from '../../auditoria/src/PerfilJcsAuditoria.js';
import {
  VERSION_ENCADENADO_AUDITORIA_V1
} from '../../auditoria/src/SobreCanonicoAuditoria.js';
import {
  construirClaveCadenaAuditoria
} from '../../auditoria/src/CatalogoAuditoria.js';

export class AdaptadorAuditoriaAvisosPlataforma {
  constructor({ repositorioAuditoria } = {}) {
    if (typeof repositorioAuditoria?.incorporarEnTransaccion !== 'function') {
      throw new Error(
        'AdaptadorAuditoriaAvisosPlataforma requiere repositorio de auditoría transaccional.'
      );
    }
    this.repositorioAuditoria = repositorioAuditoria;
  }

  async registrarTransicionEnTransaccion(transicion, { conexion } = {}) {
    if (!conexion?.execute) {
      throw new Error('La transición de aviso exige una conexión SQL prestada.');
    }
    const intencion = construirIntencion(transicion);
    const resultado = await this.repositorioAuditoria.incorporarEnTransaccion(
      [intencion],
      { conexion }
    );
    if (
      resultado?.eventos?.length !== 1 ||
      resultado.eventos[0]?.estado !== 'incorporado'
    ) {
      throw new Error('La auditoría no devolvió exactamente un evento de aviso.');
    }
    return Object.freeze({ ...resultado.eventos[0] });
  }

  async registrarOverlayEnTransaccion(entrada, { conexion } = {}) {
    if (!conexion?.execute) throw new Error('El overlay exige conexión SQL prestada.');
    const eventoPorEstado = {
      reconocido: {
        tipo: 'plataforma.aviso_reconocido',
        operacion: 'reconocido'
      },
      oculto: {
        tipo: 'plataforma.aviso_ocultado',
        operacion: 'ocultado'
      }
    };
    const evento = eventoPorEstado[entrada.estado];
    if (!evento) throw new Error('El estado personal del aviso no es auditable.');
    const contexto = entrada.contextoUsuarioActual;
    const intencion = {
      eventoId: entrada.eventoId,
      tipo: evento.tipo,
      versionContrato: 2,
      flujo: 'sistema',
      claveCadena: construirClaveCadenaAuditoria({
        flujo: 'sistema', tenantId: entrada.scope.tenantId
      }),
      actorReal: { tipo: 'usuario', id: String(contexto.idUsuarioReal ?? contexto.idUsuario) },
      actorEfectivo: null,
      modoActuacion: 'directo',
      sujeto: { tipo: 'aviso_plataforma', id: entrada.avisoId },
      origen: 'web',
      scope: entrada.scope,
      correlacionId: entrada.eventoId,
      causalidad: null,
      productor: 'portal_federacion',
      claveOperacion: `aviso-plataforma-overlay:v1:${entrada.eventoId}`,
      rolEvento: 'principal',
      efectivoEnUtc: new Date().toISOString(),
      versionCanonicalizador: PERFIL_JCS_AUDITORIA_V1,
      versionEncadenado: VERSION_ENCADENADO_AUDITORIA_V1,
      payload: {
        operacion: evento.operacion,
        estadoAntes: 'pendiente',
        estadoDespues: 'pendiente',
        gravedadAntes: null,
        gravedadDespues: null,
        causaCodigo: entrada.causaCodigo,
        cicloAnteriorId: null
      }
    };
    const resultado = await this.repositorioAuditoria.incorporarEnTransaccion(
      [intencion], { conexion }
    );
    if (resultado?.eventos?.[0]?.estado !== 'incorporado') {
      throw new Error('No se pudo incorporar la auditoría del overlay de aviso.');
    }
    return resultado.eventos[0];
  }
}

function construirIntencion(transicion) {
  const esAdministrativa = transicion.actor?.tipo === 'usuario';
  const operacion = {
    'plataforma.aviso_abierto': 'abierto',
    'plataforma.aviso_actualizado': 'actualizado',
    'plataforma.aviso_resuelto': 'resuelto',
    'plataforma.aviso_reabierto': 'reabierto'
  }[transicion.tipoEvento];
  if (!operacion) throw new Error('La transición no posee un tipo auditable de aviso.');
  return {
    eventoId: transicion.eventoId,
    tipo: transicion.tipoEvento,
    versionContrato: 2,
    flujo: 'sistema',
    claveCadena: construirClaveCadenaAuditoria({
      flujo: 'sistema',
      tenantId: transicion.scope.tenantId
    }),
    actorReal: esAdministrativa
      ? transicion.actor.real
      : { tipo: 'runtime', id: transicion.actor.id },
    actorEfectivo: esAdministrativa ? transicion.actor.efectivo : null,
    modoActuacion: esAdministrativa ? transicion.actor.modo : 'directo',
    sujeto: { tipo: 'aviso_plataforma', id: transicion.avisoId },
    origen: esAdministrativa ? 'web' : 'runtime',
    scope: transicion.scope,
    correlacionId: transicion.correlacionId,
    causalidad: transicion.causalidad,
    productor: esAdministrativa ? 'portal_federacion' : 'runtime_federacion',
    claveOperacion: `aviso-plataforma:v1:${transicion.eventoId}`,
    rolEvento: 'principal',
    efectivoEnUtc: transicion.efectivoEnUtc,
    versionCanonicalizador: PERFIL_JCS_AUDITORIA_V1,
    versionEncadenado: VERSION_ENCADENADO_AUDITORIA_V1,
    payload: {
      operacion,
      estadoAntes: transicion.estadoAntes,
      estadoDespues: transicion.estadoDespues,
      gravedadAntes: transicion.gravedadAntes,
      gravedadDespues: transicion.gravedadDespues,
      causaCodigo: transicion.causaCodigo,
      cicloAnteriorId: transicion.cicloAnteriorId
    }
  };
}

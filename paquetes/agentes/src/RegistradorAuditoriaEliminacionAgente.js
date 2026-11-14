import {
  PERFIL_JCS_AUDITORIA_V1,
  validarFechaUtcMilisegundos
} from '../../auditoria/src/PerfilJcsAuditoria.js';
import { VERSION_ENCADENADO_AUDITORIA_V1 }
  from '../../auditoria/src/SobreCanonicoAuditoria.js';

const PRODUCTOR = 'runtime_operaciones_administrativas';

export class RegistradorAuditoriaEliminacionAgente {
  constructor({ servicioAuditoria } = {}) {
    if (typeof servicioAuditoria?.registrarEnTransaccion !== 'function') {
      throw new Error('La eliminación exige el servicio transaccional de auditoría.');
    }
    this.servicioAuditoria = servicioAuditoria;
  }

  async recuperarEnTransaccion({ preparacion } = {}, { conexion } = {}) {
    if (typeof this.servicioAuditoria.recuperarPorIdentidadEnTransaccion !== 'function') {
      throw new Error('El servicio auditable no permite recuperar reentradas.');
    }
    const comando = preparacion?.comando;
    const evento = await this.servicioAuditoria.recuperarPorIdentidadEnTransaccion({
      productor: PRODUCTOR,
      claveOperacion: comando?.identidades?.claveOperacion,
      rolEvento: 'principal'
    }, { conexion });
    if (!evento) return null;
    if (
      evento.tipo !== 'agente.eliminado' ||
      evento.eventoId !== comando.identidades.eventoId ||
      evento.correlacionId !== comando.identidades.correlacionId ||
      evento.sujeto.tipo !== 'agente' ||
      evento.sujeto.id !== comando.sujeto.id ||
      evento.payload?.aceptadaEnUtc !==
        comando.fotografiaAutorizacion.aceptadaEnUtc
    ) {
      throw new Error('La evidencia recuperada pertenece a otra eliminación.');
    }
    return Object.freeze({
      estado: 'existente',
      evento,
      genesis: Object.freeze([]),
      registradoEnUtc: evento.registradoEnUtc,
      esNoOp: false
    });
  }

  // auditoria-productor: runtime.agentes.eliminacion_administrativa
  async registrarEnTransaccion(
    { preparacion, eliminacionRaiz } = {},
    { conexion } = {}
  ) {
    if (eliminacionRaiz?.eliminadas !== '1') {
      throw new Error('agente.eliminado exige un único DELETE raíz efectivo.');
    }
    const comando = preparacion?.comando;
    const autorizacion = comando?.fotografiaAutorizacion;
    const identidades = comando?.identidades;
    if (!comando || !autorizacion || !identidades || !preparacion.fotografiaAdministrativa) {
      throw new Error('La preparación no conserva la intención auditable de eliminación.');
    }
    const actorRealId = String(autorizacion.actorReal.usuarioId);
    const actorEfectivoId = String(autorizacion.actorEfectivo.usuarioId);
    const impersonado = actorRealId !== actorEfectivoId;
    const scope = comando.sujeto.scope;
    const efectivoEnUtc = validarFechaUtcMilisegundos(
      eliminacionRaiz.efectivoEnUtc,
      'eliminacionRaiz.efectivoEnUtc'
    );
    if (Date.parse(autorizacion.aceptadaEnUtc) > Date.parse(efectivoEnUtc)) {
      throw new Error('El efecto destructivo no puede preceder a su aceptación.');
    }
    const payload = construirPayload(preparacion);
    const registro = await this.servicioAuditoria.registrarEnTransaccion({
      cambioEfectivo: true,
      intencion: {
        versionContrato: 1,
        eventoId: identidades.eventoId,
        tipo: 'agente.eliminado',
        flujo: 'agentes',
        claveCadena: `agentes:tenant:${scope.tenantId}`,
        actor: 'usuario',
        actorReal: { tipo: 'usuario', id: actorRealId },
        actorEfectivo: impersonado
          ? { tipo: 'usuario', id: actorEfectivoId }
          : null,
        modoActuacion: impersonado ? 'impersonado' : 'directo',
        sujeto: { tipo: 'agente', id: comando.sujeto.id },
        origen: 'web',
        scope: {
          tenantId: scope.tenantId,
          empresaId: scope.empresaId,
          sitioId: scope.sitioId
        },
        correlacionId: identidades.correlacionId,
        causalidad: null,
        productor: PRODUCTOR,
        claveOperacion: identidades.claveOperacion,
        rolEvento: 'principal',
        efectivoEnUtc,
        versionCanonicalizador: PERFIL_JCS_AUDITORIA_V1,
        versionEncadenado: VERSION_ENCADENADO_AUDITORIA_V1,
        payload
      }
    }, { conexion });
    return Object.freeze({
      ...registro,
      evento: Object.freeze({
        ...registro.evento,
        efectivoEnUtc,
        registradoEnUtc: registro.registradoEnUtc
      })
    });
  }
}

function construirPayload(preparacion) {
  const impactoResumen = {
    perfil: preparacion.comando.resumenImpacto.perfil,
    version: preparacion.comando.resumenImpacto.version,
    conteos: preparacion.conteosFinales.map((item) => ({ ...item }))
  };
  return {
    resultado: 'eliminado',
    aceptadaEnUtc: preparacion.comando.fotografiaAutorizacion.aceptadaEnUtc,
    antes: copiarFotografia(preparacion.fotografiaAdministrativa),
    despues: null,
    impactoResumen,
    referenciasCompartidasConservadas:
      conteo(preparacion.conteosFinales, 'referencias_compartidas'),
    identidadesFederadasRetiradas:
      String(preparacion.retiradasFederadas.identidadesRetiradas),
    obligacionesPostcommit: String(preparacion.obligacionesPostcommit.length)
  };
}

function copiarFotografia(fotografia) {
  return {
    id: fotografia.id,
    guid: fotografia.guid,
    nombre: fotografia.nombre,
    descripcion: fotografia.descripcion,
    estadoAdministrativo: fotografia.estadoAdministrativo,
    estadoAcceso: fotografia.estadoAcceso,
    versionAgente: fotografia.versionAgente,
    scope: { ...fotografia.scope }
  };
}

function conteo(conteos, categoria) {
  const item = conteos.find((actual) => actual.categoria === categoria);
  if (!item) throw new Error(`Falta la categoría de impacto ${categoria}.`);
  return item.cantidad;
}

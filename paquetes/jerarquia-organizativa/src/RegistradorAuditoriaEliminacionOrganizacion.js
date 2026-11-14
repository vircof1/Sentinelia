import { isDeepStrictEqual } from 'node:util';

import {
  PERFIL_JCS_AUDITORIA_V1,
  validarFechaUtcMilisegundos
} from '../../auditoria/src/PerfilJcsAuditoria.js';
import { VERSION_ENCADENADO_AUDITORIA_V1 }
  from '../../auditoria/src/SobreCanonicoAuditoria.js';
import {
  crearCronologiaEliminacionOrganizacion,
  crearFotografiaFinalEliminacionOrganizacion,
  PERFIL_FOTOGRAFIA_FINAL_ELIMINACION_ORGANIZACION
} from './ContratoEliminacionAdministrativaOrganizacion.js';

const PRODUCTOR = 'runtime_operaciones_administrativas';
const TIPO_EVENTO = Object.freeze({
  tenant: 'organizacion.tenant_eliminado',
  empresa: 'organizacion.empresa_eliminada',
  sitio: 'organizacion.sitio_eliminado'
});

export class RegistradorAuditoriaEliminacionOrganizacion {
  constructor({ servicioAuditoria } = {}) {
    if (typeof servicioAuditoria?.registrarEnTransaccion !== 'function') {
      throw new Error('La eliminación organizativa exige auditoría transaccional.');
    }
    this.servicioAuditoria = servicioAuditoria;
  }

  async recuperarEnTransaccion({ ejecucion } = {}, { conexion } = {}) {
    if (typeof this.servicioAuditoria.recuperarPorIdentidadEnTransaccion !== 'function') {
      throw new Error('El servicio auditable no permite recuperar reentradas.');
    }
    const contexto = normalizarEjecucion(ejecucion);
    const evento = await this.servicioAuditoria.recuperarPorIdentidadEnTransaccion({
      productor: PRODUCTOR,
      claveOperacion: contexto.comando.identidades.claveOperacion,
      rolEvento: 'principal'
    }, { conexion });
    if (!evento) return null;
    validarEventoRecuperado(evento, contexto);
    return construirResultadoRecuperado(evento, contexto);
  }

  // auditoria-productor: runtime.organizacion.eliminacion_administrativa
  async registrarEnTransaccion({ ejecucion } = {}, { conexion } = {}) {
    const contexto = normalizarEjecucion(ejecucion);
    const { comando, raiz, impactoFinal, efectivoEnUtc, fotografiaFinal } = contexto;
    const autorizacion = comando.fotografiaAutorizacion;
    if (Date.parse(autorizacion.aceptadaEnUtc) >
          Date.parse(fotografiaFinal.capturadaEnUtc) ||
        Date.parse(autorizacion.aceptadaEnUtc) > Date.parse(efectivoEnUtc) ||
        Date.parse(fotografiaFinal.capturadaEnUtc) > Date.parse(efectivoEnUtc)) {
      throw new Error('La fotografía y la aceptación deben preceder al efecto destructivo.');
    }
    const actorRealId = String(autorizacion.actorReal.usuarioId);
    const actorEfectivoId = String(autorizacion.actorEfectivo.usuarioId);
    const impersonado = actorRealId !== actorEfectivoId;
    const payload = construirPayload({ comando, fotografiaFinal, impactoFinal });
    const intencion = {
      versionContrato: 1,
      eventoId: comando.identidades.eventoId,
      tipo: TIPO_EVENTO[raiz.tipo],
      flujo: 'organizacion',
      claveCadena: `organizacion:tenant:${raiz.scope.tenantId}`,
      actorReal: { tipo: 'usuario', id: actorRealId },
      actorEfectivo: impersonado
        ? { tipo: 'usuario', id: actorEfectivoId }
        : null,
      modoActuacion: impersonado ? 'impersonado' : 'directo',
      sujeto: { tipo: raiz.tipo, id: raiz.id },
      origen: 'web',
      scope: scopeAuditoria(raiz.scope),
      correlacionId: comando.identidades.correlacionId,
      causalidad: null,
      productor: PRODUCTOR,
      claveOperacion: comando.identidades.claveOperacion,
      rolEvento: 'principal',
      efectivoEnUtc,
      versionCanonicalizador: PERFIL_JCS_AUDITORIA_V1,
      versionEncadenado: VERSION_ENCADENADO_AUDITORIA_V1,
      payload
    };
    const registro = await this.servicioAuditoria.registrarEnTransaccion({
      cambioEfectivo: true,
      intencion
    }, { conexion });
    const cronologia = crearCronologiaEliminacionOrganizacion({
      aceptadaEnUtc: autorizacion.aceptadaEnUtc,
      efectivoEnUtc,
      registradoEnUtc: registro.registradoEnUtc
    });
    return congelar({
      ...registro,
      evento: {
        ...intencion,
        ...registro.evento,
        registradoEnUtc: registro.registradoEnUtc
      },
      fotografiaFinal,
      cronologia
    });
  }
}

function normalizarEjecucion(ejecucion) {
  if (ejecucion?.eliminacionRaiz?.eliminadas !== '1') {
    throw new Error('La auditoría organizativa exige un único DELETE raíz efectivo.');
  }
  if (ejecucion?.postcondiciones?.verificadas !== true) {
    throw new Error('La auditoría organizativa exige postcondiciones verificadas.');
  }
  const preparacion = ejecucion?.preparacion;
  const inventario = preparacion?.inventario;
  const comando = inventario?.comando;
  const raiz = inventario?.raiz;
  const impactoFinal = preparacion?.impactoFinal;
  if (!comando || !raiz || !impactoFinal || !TIPO_EVENTO[raiz.tipo]) {
    throw new Error('La ejecución no conserva la evidencia final organizativa.');
  }
  if (comando.sujeto.tipo !== raiz.tipo || comando.sujeto.id !== raiz.id) {
    throw new Error('El inventario final pertenece a otra raíz organizativa.');
  }
  const efectivoEnUtc = validarFechaUtcMilisegundos(
    ejecucion.eliminacionRaiz.efectivoEnUtc,
    'eliminacionRaiz.efectivoEnUtc'
  );
  const fotografiaFinal = crearFotografiaFinalEliminacionOrganizacion({
    perfil: PERFIL_FOTOGRAFIA_FINAL_ELIMINACION_ORGANIZACION,
    version: 1,
    tipo: raiz.tipo,
    id: raiz.id,
    nombre: raiz.nombre,
    scopeFinal: raiz.scope,
    capturadaEnUtc: raiz.capturadaEnUtc
  });
  return { comando, raiz, impactoFinal, efectivoEnUtc, fotografiaFinal };
}

function construirPayload({ comando, fotografiaFinal, impactoFinal }) {
  const autorizacion = comando.fotografiaAutorizacion;
  return {
    resultado: 'eliminado',
    aceptadaEnUtc: autorizacion.aceptadaEnUtc,
    sujetoAceptado: copiarSujeto(comando.sujeto),
    autorizacionAceptada: {
      actorReal: copiarActor(autorizacion.actorReal),
      actorEfectivo: copiarActor(autorizacion.actorEfectivo)
    },
    antes: copiarFotografia(fotografiaFinal),
    despues: null,
    impactoResumen: {
      perfil: impactoFinal.perfil,
      version: impactoFinal.version,
      conteos: impactoFinal.conteos.map((item) => ({ ...item }))
    },
    identidadesFederadasRetiradas: conteo(impactoFinal, 'identidades_federadas'),
    obligacionesPostcommit: conteo(impactoFinal, 'obligaciones_postcommit')
  };
}

function validarEventoRecuperado(evento, contexto) {
  const { comando, raiz, efectivoEnUtc, fotografiaFinal } = contexto;
  const payloadEsperado = construirPayload({
    comando,
    fotografiaFinal,
    impactoFinal: contexto.impactoFinal
  });
  if (evento.tipo !== TIPO_EVENTO[raiz.tipo] ||
      evento.eventoId !== comando.identidades.eventoId ||
      evento.correlacionId !== comando.identidades.correlacionId ||
      evento.sujeto?.tipo !== raiz.tipo || evento.sujeto?.id !== raiz.id ||
      evento.productor !== PRODUCTOR ||
      evento.claveOperacion !== comando.identidades.claveOperacion ||
      evento.rolEvento !== 'principal' ||
      evento.efectivoEnUtc !== efectivoEnUtc ||
      !isDeepStrictEqual(evento.payload, payloadEsperado)) {
    throw new Error('La evidencia recuperada pertenece a otra eliminación organizativa.');
  }
}

function construirResultadoRecuperado(evento, contexto) {
  const cronologia = crearCronologiaEliminacionOrganizacion({
    aceptadaEnUtc: contexto.comando.fotografiaAutorizacion.aceptadaEnUtc,
    efectivoEnUtc: contexto.efectivoEnUtc,
    registradoEnUtc: evento.registradoEnUtc
  });
  return congelar({
    estado: 'existente',
    evento,
    genesis: [],
    registradoEnUtc: evento.registradoEnUtc,
    esNoOp: false,
    fotografiaFinal: contexto.fotografiaFinal,
    cronologia
  });
}

function copiarSujeto(sujeto) {
  return { tipo: sujeto.tipo, id: sujeto.id, scope: { ...sujeto.scope } };
}

function copiarActor(actor) {
  return {
    usuarioId: actor.usuarioId,
    estado: actor.estado,
    decision: actor.decision,
    scope: { ...actor.scope }
  };
}

function copiarFotografia(fotografia) {
  return { ...fotografia, scopeFinal: { ...fotografia.scopeFinal } };
}

function scopeAuditoria(scope) {
  return {
    tenantId: scope.tenantId,
    empresaId: scope.empresaId,
    sitioId: scope.sitioId
  };
}

function conteo(impacto, categoria) {
  const item = impacto.conteos.find((actual) => actual.categoria === categoria);
  if (!item) throw new Error(`Falta la categoría final ${categoria}.`);
  return item.cantidad;
}

function congelar(valor) {
  if (valor && typeof valor === 'object' && !Object.isFrozen(valor)) {
    for (const hijo of Object.values(valor)) congelar(hijo);
    Object.freeze(valor);
  }
  return valor;
}

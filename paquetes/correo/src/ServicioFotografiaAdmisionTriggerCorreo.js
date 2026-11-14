import {
  CODIGOS_RESULTADO_ACEPTACION_TRIGGER_CORREO,
  crearDefinicionMensajeTriggerCorreo
} from './ContratoTriggerCorreo.js';
import { ProyectorAudienciaEfectivaTriggerCorreo }
  from './ProyectorAudienciaEfectivaTriggerCorreo.js';
import { proyectarFotografiaCausalTriggerCorreo }
  from './ProyectorCausalTriggerCorreo.js';
import {
  normalizarEventosDisparoTrigger,
  tieneEventoDisparoTrigger
}
  from '../../triggers/src/eventosDisparoTrigger.js';
import { ValidadorTrigger } from '../../triggers/src/ValidadorTrigger.js';

const ID_FICTICIO = '1';
const HASH_FICTICIO = '0'.repeat(64);

export class ServicioFotografiaAdmisionTriggerCorreo {
  constructor({
    repositorio,
    evaluadorAutoridadCorreoSql,
    proyectorAudiencia = new ProyectorAudienciaEfectivaTriggerCorreo(),
    validadorTrigger = new ValidadorTrigger()
  } = {}) {
    if (typeof repositorio?.descubrirUsuarios !== 'function' ||
        typeof evaluadorAutoridadCorreoSql?.evaluarEnTransaccion !== 'function') {
      throw new Error('La fotografía de admisión requiere sus puertos SQL.');
    }
    this.repositorio = repositorio;
    this.evaluadorAutoridad = evaluadorAutoridadCorreoSql;
    this.proyectorAudiencia = proyectorAudiencia;
    this.validadorTrigger = validadorTrigger;
  }

  async fotografiarEnTransaccion({ planDisparo, conexion } = {}) {
    exigirPlan(planDisparo);
    exigirConexion(conexion);
    const usuariosDescubiertos = await this.repositorio.descubrirUsuarios(
      planDisparo.triggerId,
      { conexion }
    );
    const autoridad = await this.evaluadorAutoridad.evaluarEnTransaccion({
      conexion
    });
    if (!autoridad.puedeDespachar) {
      return rechazar(
        CODIGOS_RESULTADO_ACEPTACION_TRIGGER_CORREO.CANAL_NO_OPERATIVO,
        autoridad.codigo
      );
    }
    const usuarios = await this.repositorio.bloquearUsuarios(
      usuariosDescubiertos,
      { conexion }
    );
    const trigger = await this.repositorio.bloquearTrigger(
      planDisparo.triggerId,
      { conexion }
    );
    if (!esTriggerAplicable(trigger, planDisparo)) {
      return rechazar(
        CODIGOS_RESULTADO_ACEPTACION_TRIGGER_CORREO.DECLARACION_INVALIDA,
        'trigger_no_aplicable'
      );
    }
    const asignacion = await this.repositorio.bloquearAsignacion(
      planDisparo.asignacionId,
      { conexion }
    );
    if (!esAsignacionAplicable(asignacion, trigger, planDisparo)) {
      return rechazar(
        CODIGOS_RESULTADO_ACEPTACION_TRIGGER_CORREO.DECLARACION_INVALIDA,
        'vinculo_no_aplicable'
      );
    }
    const audiencia = await this.repositorio.bloquearAudiencia(
      trigger.id,
      { conexion }
    );
    const usuariosPorId = new Map(usuarios.map((usuario) => [
      Number(usuario.id),
      usuario
    ]));
    const usuarioNoDescubierto = audiencia.find((relacion) =>
      relacion.usuario_id != null && !usuariosPorId.has(Number(relacion.usuario_id))
    );
    if (usuarioNoDescubierto) {
      throw Object.assign(
        new Error('La audiencia cambió durante su descubrimiento; debe reintentarse.'),
        { codigo: 'fotografia_admision_correo_reintentar', reintentable: true }
      );
    }

    let definicionMensaje;
    let planCoherente;
    let origenPublico;
    try {
      definicionMensaje = crearDefinicionMensajeTriggerCorreo(
        this.validadorTrigger.construirConfiguracionEfectiva({
          tipo: 'correo',
          configuracionBase: parsearJson(trigger.configuracion),
          configuracionOverride: parsearJson(asignacion.configuracion_override)
        })
      );
      planCoherente = construirPlanCoherente({ planDisparo, trigger, asignacion });
      const origenPublicoConfigurado = String(
        autoridad.lectura.valores.get('portal.origen_publico')
      );
      const fotografiaValidada = proyectarFotografiaCausalTriggerCorreo({
        planDisparo: planCoherente,
        ejecucionTriggerId: ID_FICTICIO,
        claveIdempotencia: HASH_FICTICIO,
        origenPublico: origenPublicoConfigurado
      });
      origenPublico = new URL(origenPublicoConfigurado).origin;
      planCoherente = sanearPlanCoherente(planCoherente, fotografiaValidada);
    } catch (error) {
      return rechazar(
        error?.codigo ||
          CODIGOS_RESULTADO_ACEPTACION_TRIGGER_CORREO.DECLARACION_INVALIDA,
        error?.causaCodigo || error?.codigo || 'declaracion_no_renderizable'
      );
    }
    const filasResolucion = audiencia.map((relacion) => ({
      ...relacion,
      ...prefijarUsuario(usuariosPorId.get(Number(relacion.usuario_id)))
    }));
    const audienciaEfectiva = this.proyectorAudiencia.proyectar(filasResolucion);
    if (audienciaEfectiva.totalBuzones === 0) {
      return rechazar(
        CODIGOS_RESULTADO_ACEPTACION_TRIGGER_CORREO.SIN_DESTINATARIOS_ADMITIDOS,
        'audiencia_sin_buzones_entregables',
        { audiencia: audienciaEfectiva }
      );
    }
    return congelar({
      aceptada: true,
      codigoResultado: audienciaEfectiva.totalEntregables ===
          audienciaEfectiva.totalActivas
        ? CODIGOS_RESULTADO_ACEPTACION_TRIGGER_CORREO.ACEPTADA_COMPLETA
        : CODIGOS_RESULTADO_ACEPTACION_TRIGGER_CORREO.ACEPTADA_PARCIAL,
      detalleCodigo: null,
      versionConfiguracion: String(autoridad.versionConfiguracion),
      origenPublico,
      nombrePortal: String(
        autoridad.lectura.valores.get('portal.nombre_visible')
      ),
      ttlDesuscripcionDias: Number(autoridad.configuracion.desuscripcionTtlDias),
      remitenteEmailCanonico: autoridad.remitenteEmailCanonico,
      definicionMensaje,
      trigger: fotografiarTrigger(trigger),
      asignacion: fotografiarAsignacion(asignacion),
      planDisparo: planCoherente,
      audiencia: audienciaEfectiva
    });
  }
}

function rechazar(codigoResultado, detalleCodigo, detalle = {}) {
  return congelar({ aceptada: false, codigoResultado, detalleCodigo, ...detalle });
}

function esTriggerAplicable(trigger, plan) {
  return Boolean(trigger?.activo) && trigger.tipo === 'correo' &&
    Number(trigger.id) === Number(plan.triggerId);
}

function esAsignacionAplicable(asignacion, trigger, plan) {
  return Boolean(asignacion?.activo) &&
    Number(asignacion.trigger_id) === Number(trigger.id) &&
    Number(asignacion.monitor_id) === Number(plan.monitorId) &&
    Number(asignacion.id) === Number(plan.asignacionId) &&
    tieneEventoDisparoTrigger(
      parsearJson(asignacion.eventos_disparo),
      plan.eventoDisparo
    );
}

function construirPlanCoherente({ planDisparo, trigger, asignacion }) {
  return congelar({
    ...structuredClone(planDisparo),
    triggerId: Number(trigger.id),
    nombreTrigger: trigger.nombre,
    asignacionId: Number(asignacion.id),
    monitorId: Number(asignacion.monitor_id),
    trigger: fotografiarTrigger(trigger),
    asignacion: fotografiarAsignacion(asignacion)
  });
}

function sanearPlanCoherente(plan, fotografia) {
  return congelar({
    ...plan,
    transicion: {
      tipoEventoDisparo: fotografia.eventoDisparo,
      alertaAuditoriaId: fotografia.alertaAuditoriaId,
      monitorId: Number(fotografia.monitorId),
      tenantId: nullableId(fotografia.scopeMonitor.tenantId),
      empresaId: nullableId(fotografia.scopeMonitor.empresaId),
      sitioId: nullableId(fotografia.scopeMonitor.sitioId),
      tipoMonitor: fotografia.tipoMonitor,
      nombreMonitor: fotografia.nombreMonitor,
      fechaOcurrenciaUtc: fotografia.fechaOcurrenciaUtc,
      validoDesdeUtc: fotografia.validoDesdeUtc,
      codigoResultado: fotografia.codigoResultado,
      mensajeResultado: fotografia.mensajeResultado,
      payloadAlerta: {
        descripcionFallo: fotografia.contextoHumano.descripcionFallo,
        posibleSolucion: fotografia.contextoHumano.posibleSolucion
      }
    }
  });
}

function fotografiarTrigger(trigger) {
  return congelar({
    id: Number(trigger.id),
    nombre: trigger.nombre,
    tipo: trigger.tipo,
    activo: Boolean(trigger.activo),
    revisionDeclaracion: Number(trigger.revision_declaracion),
    tenantId: nullableId(trigger.tenant_id),
    empresaId: nullableId(trigger.empresa_id),
    sitioId: nullableId(trigger.sitio_id)
  });
}

function fotografiarAsignacion(asignacion) {
  return congelar({
    id: Number(asignacion.id),
    monitorId: Number(asignacion.monitor_id),
    triggerId: Number(asignacion.trigger_id),
    activo: Boolean(asignacion.activo),
    ordenEjecucion: Number(asignacion.orden_ejecucion),
    eventosDisparo: Object.freeze(eventosAsignacion(asignacion.eventos_disparo)),
    configuracionOverride: parsearJson(asignacion.configuracion_override)
  });
}

function prefijarUsuario(usuario) {
  return {
    usuario_activo: usuario?.activo ?? null,
    usuario_email: usuario?.email ?? null,
    usuario_email_validado: usuario?.email_validado ?? null,
    usuario_nombre_cuenta: usuario?.usuario ?? null,
    usuario_nombre_mostrar: usuario?.nombre_mostrar ?? null,
    usuario_nombre_completo: usuario?.nombre_completo ?? null,
    usuario_tenant_id: usuario?.tenant_id ?? null,
    usuario_empresa_id: usuario?.empresa_id ?? null,
    usuario_sitio_id: usuario?.sitio_id ?? null
  };
}

function parsearJson(valor) {
  if (valor == null || valor === '') return null;
  if (typeof valor === 'object') return structuredClone(valor);
  return JSON.parse(valor);
}

function eventosAsignacion(valor) {
  return normalizarEventosDisparoTrigger(parsearJson(valor), {
    porDefecto: ['apertura_alerta']
  });
}

function nullableId(valor) {
  return valor == null ? null : Number(valor);
}

function exigirPlan(plan) {
  if (!plan || !plan.triggerId || !plan.asignacionId || !plan.monitorId ||
      !plan.eventoDisparo || !plan.transicion) {
    throw new Error('El plan causal de admisión no está completo.');
  }
}

function exigirConexion(conexion) {
  if (typeof conexion?.execute !== 'function') {
    throw new Error('La admisión exige una conexión SQL prestada.');
  }
}

function congelar(valor) {
  if (valor && typeof valor === 'object' && !Object.isFrozen(valor)) {
    Object.freeze(valor);
    for (const hijo of Object.values(valor)) congelar(hijo);
  }
  return valor;
}

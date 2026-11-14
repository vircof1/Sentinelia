import { ValidadorRegistroDns } from '../../dns/src/ValidadorRegistroDns.js';
import { RegistroDns } from '../../dns/src/RegistroDns.js';
import { ValidadorCoherenciaBindDns } from '../../dns/src/ValidadorCoherenciaBindDns.js';
import { generarUuidV7Auditoria } from '../../auditoria/src/UuidV7Auditoria.js';
import { PERFIL_JCS_AUDITORIA_V1 } from '../../auditoria/src/PerfilJcsAuditoria.js';
import { VERSION_ENCADENADO_AUDITORIA_V1 } from '../../auditoria/src/SobreCanonicoAuditoria.js';
import { ESTRATEGIAS_EJECUCION_TRIGGER } from './CatalogoTiposTrigger.js';

function clonarJsonSeguro(valor) {
  if (!valor || typeof valor !== 'object') {
    return null;
  }

  return JSON.parse(JSON.stringify(valor));
}

function normalizarId(valor) {
  const convertido = Number.parseInt(String(valor ?? ''), 10);
  return Number.isInteger(convertido) && convertido > 0 ? convertido : null;
}

function resolverNivelScope({ tenantId = null, empresaId = null, sitioId = null }) {
  if (tenantId == null && empresaId == null && sitioId == null) {
    return 'portal';
  }

  if (tenantId != null && empresaId == null && sitioId == null) {
    return 'tenant';
  }

  if (tenantId != null && empresaId != null && sitioId == null) {
    return 'empresa';
  }

  if (tenantId != null && empresaId != null && sitioId != null) {
    return 'sitio';
  }

  return 'invalido';
}

export class EjecutorTriggerDns {
  constructor({
    repositorioRegistrosDns,
    repositorioZonasDns,
    servicioDns = null,
    servicioAuditoria = null,
    repositorioCoordinacionGeneracionesDns = null,
    ahora = () => new Date(),
    validadorRegistroDns = new ValidadorRegistroDns(),
    validadorCoherenciaBindDns = new ValidadorCoherenciaBindDns()
  }) {
    this.tipoTrigger = 'dns';
    this.estrategiaEjecucion =
      ESTRATEGIAS_EJECUCION_TRIGGER.EFECTO_EXTERNO_DIFERIDO;
    this.repositorioRegistrosDns = repositorioRegistrosDns;
    this.repositorioZonasDns = repositorioZonasDns;
    this.servicioDns = servicioDns;
    this.servicioAuditoria = servicioAuditoria;
    this.repositorioCoordinacionGeneracionesDns =
      repositorioCoordinacionGeneracionesDns;
    this.ahora = ahora;
    this.validadorRegistroDns = validadorRegistroDns;
    this.validadorCoherenciaBindDns = validadorCoherenciaBindDns;
  }

  // auditoria-productor: runtime.triggers.mutacion_dns
  async ejecutar(contexto = {}) {
    const configuracion = this.normalizarConfiguracion(
      contexto.configuracionEfectiva || {}
    );
    const registro = await this.repositorioRegistrosDns.buscarPorId(
      configuracion.registroId
    );

    if (!registro || Number(registro.zonaId) !== Number(configuracion.zonaId)) {
      throw new Error(
        'El registro DNS objetivo del trigger no existe dentro de la zona indicada.'
      );
    }

    this.validarAutorizacionTrigger({
      trigger: contexto.planDisparo?.trigger,
      registro,
      configuracion
    });

    const definicionSiguiente = this.construirDefinicionSiguiente({
      registro,
      configuracion,
      eventoDisparo: contexto.eventoDisparo,
      transicion: contexto.transicion
    });
    const cambios = this.resolverCambiosEfectivos(registro, definicionSiguiente);

    if (!cambios.hayCambios) {
      return {
        estadoEjecucion: 'ok',
        codigoResultado: 'dns_sin_cambios',
        mensajeResultado: 'El trigger DNS no necesitó modificar el registro.',
        payloadRespuesta: this.construirPayloadRespuesta({
          registroAntes: registro,
          registroDespues: registro,
          configuracion,
          cambios,
          zonaMarcadaPendiente: false
        }),
        payloadError: null
      };
    }

    const zona = await this.validarCoherenciaZonaConCambio({
      registro,
      definicionSiguiente
    });

    const conexion =
      await this.repositorioRegistrosDns.clienteSql.obtenerConexion();

    let respuesta = null;
    try {
      await conexion.beginTransaction();
      await this.crearGeneracionDnsSiAfectaPublicacion({
        conexion,
        zona,
        registroAntes: registro,
        registroDespues: definicionSiguiente
      });
      const actualizado = await this.repositorioRegistrosDns.actualizar(
        {
          idRegistro: registro.id,
          ...definicionSiguiente
        },
        { conexion }
      );

      await this.repositorioZonasDns.marcarPendientePublicacion(
        registro.zonaId,
        { conexion }
      );
      await this.registrarMutacionDnsAuditable({
        conexion,
        contexto,
        registroAntes: registro,
        registroDespues: actualizado,
        cambios
      });
      await conexion.commit();
      respuesta = {
        estadoEjecucion: 'ok',
        codigoResultado: 'dns_ok',
        mensajeResultado: `Trigger DNS aplicado sobre ${registro.construirNombreVisible()}.`,
        payloadRespuesta: this.construirPayloadRespuesta({
          registroAntes: registro,
          registroDespues: actualizado,
          configuracion,
          cambios,
          zonaMarcadaPendiente: true
        }),
        payloadError: null
      };
    } catch (error) {
      await conexion.rollback();
      throw error;
    } finally {
      conexion.release();
    }

    await this.invalidarCatalogoDns();
    return respuesta;
  }

  normalizarConfiguracion(configuracion = {}) {
    const zonaId = normalizarId(configuracion.zonaId);
    const registroId = normalizarId(configuracion.registroId);
    const operacion = String(configuracion.operacion || '').trim().toLowerCase();

    if (!zonaId) {
      throw new Error('La acción DNS del trigger requiere zonaId.');
    }

    if (!registroId) {
      throw new Error('La acción DNS del trigger requiere registroId.');
    }

    if (
      ![
        'editar_valor',
        'activar',
        'desactivar',
        'seguir_estado_monitor'
      ].includes(operacion)
    ) {
      throw new Error(
        'La acción DNS del trigger solo permite editar_valor, activar, desactivar o seguir_estado_monitor.'
      );
    }

    const valorPrincipal =
      configuracion.valorPrincipal == null
        ? null
        : String(configuracion.valorPrincipal).trim();

    if (operacion === 'editar_valor' && !valorPrincipal) {
      throw new Error(
        'La acción DNS editar_valor requiere un nuevo valor principal.'
      );
    }

    return {
      zonaId,
      registroId,
      operacion,
      valorPrincipal: operacion === 'editar_valor' ? valorPrincipal : null,
      rolGobernanza:
        configuracion.rolGobernanza == null ||
        String(configuracion.rolGobernanza).trim() === ''
          ? null
          : String(configuracion.rolGobernanza).trim()
    };
  }

  validarAutorizacionTrigger({ trigger, registro, configuracion }) {
    if (!trigger?.id) {
      throw new Error(
        'El plan de disparo no contiene un trigger válido para gobernar DNS.'
      );
    }

    if (!this.scopeTriggerContieneRegistro(trigger, registro)) {
      throw new Error(
        'El trigger no tiene alcance suficiente para modificar el registro DNS objetivo.'
      );
    }

    const gobernanza = registro.resolverGobernanzaAutomatica?.() || null;

    if (gobernanza?.gobernadoPor !== 'trigger') {
      throw new Error(
        'El registro DNS objetivo no está gobernado por triggers.'
      );
    }

    if (
      gobernanza.rolAsignado &&
      gobernanza.rolAsignado !== configuracion.rolGobernanza
    ) {
      throw new Error(
        'El rol de gobernanza del trigger no coincide con el rol asignado al registro DNS.'
      );
    }

    if (gobernanza.modoControl !== 'valor_y_activo') {
      throw new Error(
        'El modo de control DNS del registro no está soportado por este ejecutor.'
      );
    }
  }

  async validarCoherenciaZonaConCambio({ registro, definicionSiguiente }) {
    const [zona, registrosZona] = await Promise.all([
      this.repositorioZonasDns.buscarPorId(registro.zonaId),
      this.repositorioRegistrosDns.listarPorZonaId(registro.zonaId)
    ]);

    if (!zona) {
      throw new Error('La zona DNS del registro objetivo ya no existe.');
    }

    const registroSimulado = new RegistroDns({
      ...registro.serializarResumen(),
      zona_id: registro.zonaId,
      tenant_id: registro.tenantId,
      empresa_id: registro.empresaId,
      sitio_id: registro.sitioId,
      nombre_zona: registro.nombreZona,
      host_relativo: definicionSiguiente.hostRelativo,
      tipo_registro: definicionSiguiente.tipoRegistro,
      valor_principal: definicionSiguiente.valorPrincipal,
      ttl_segundos: definicionSiguiente.ttlSegundos,
      prioridad: definicionSiguiente.prioridad,
      peso: definicionSiguiente.peso,
      puerto: definicionSiguiente.puerto,
      flags: definicionSiguiente.flags,
      tag: definicionSiguiente.tag,
      categoria_origen: definicionSiguiente.categoriaOrigen,
      publicar_en_bind: definicionSiguiente.publicarEnBind,
      datos_auxiliares: definicionSiguiente.datosAuxiliares,
      descripcion: definicionSiguiente.descripcion,
      activo: definicionSiguiente.activo
    });
    const registrosSimulados = registrosZona.map((registroZona) =>
      Number(registroZona.id) === Number(registro.id)
        ? registroSimulado
        : registroZona
    );

    this.validadorCoherenciaBindDns.validarCoherenciaZona({
      zona,
      registros: registrosSimulados
    });
    return zona;
  }

  scopeTriggerContieneRegistro(trigger = {}, registro) {
    const nivel = trigger?.nivelPertenencia || resolverNivelScope({
      tenantId: trigger?.tenantId,
      empresaId: trigger?.empresaId,
      sitioId: trigger?.sitioId
    });

    if (nivel === 'portal') {
      return true;
    }

    if (nivel === 'tenant') {
      return Number(trigger.tenantId) === Number(registro.tenantId);
    }

    if (nivel === 'empresa') {
      return (
        Number(trigger.tenantId) === Number(registro.tenantId) &&
        Number(trigger.empresaId) === Number(registro.empresaId)
      );
    }

    if (nivel === 'sitio') {
      return (
        Number(trigger.tenantId) === Number(registro.tenantId) &&
        Number(trigger.empresaId) === Number(registro.empresaId) &&
        Number(trigger.sitioId) === Number(registro.sitioId)
      );
    }

    return false;
  }

  construirDefinicionSiguiente({
    registro,
    configuracion,
    eventoDisparo = null,
    transicion = null
  }) {
    const valorPrincipal =
      configuracion.operacion === 'editar_valor'
        ? configuracion.valorPrincipal
        : registro.valorPrincipal;
    const activo = this.resolverActivoSiguiente({
      activoActual: registro.activo,
      configuracion,
      eventoDisparo,
      transicion
    });

    return this.validadorRegistroDns.normalizarDefinicionBase({
      zonaId: registro.zonaId,
      hostRelativo: registro.hostRelativo,
      tipoRegistro: registro.tipoRegistro,
      valorPrincipal,
      ttlSegundos: registro.ttlSegundos,
      prioridad: registro.prioridad,
      peso: registro.peso,
      puerto: registro.puerto,
      flags: registro.flags,
      tag: registro.tag,
      categoriaOrigen: registro.categoriaOrigen,
      publicarEnBind: registro.publicarEnBind,
      datosAuxiliares: clonarJsonSeguro(registro.datosAuxiliares),
      descripcion: registro.descripcion,
      activo
    });
  }

  resolverActivoSiguiente({
    activoActual,
    configuracion,
    eventoDisparo = null,
    transicion = null
  }) {
    if (configuracion.operacion === 'activar') {
      return true;
    }

    if (configuracion.operacion === 'desactivar') {
      return false;
    }

    if (configuracion.operacion === 'seguir_estado_monitor') {
      return this.resolverActivoDesdeEstadoMonitor({
        eventoDisparo,
        transicion
      });
    }

    return activoActual;
  }

  resolverActivoDesdeEstadoMonitor({ eventoDisparo = null, transicion = null }) {
    const evento = String(
      eventoDisparo ||
        transicion?.eventoDisparo ||
        transicion?.tipoEvento ||
        transicion?.tipo ||
        ''
    )
      .trim()
      .toLowerCase();

    if (evento === 'apertura_alerta') {
      return false;
    }

    if (evento === 'cierre_alerta') {
      return true;
    }

    throw new Error(
      'La operación DNS seguir_estado_monitor requiere una transición de apertura o cierre de alerta.'
    );
  }

  resolverCambiosEfectivos(registro, definicionSiguiente) {
    const cambios = [];

    if (
      String(registro.valorPrincipal ?? '') !==
      String(definicionSiguiente.valorPrincipal ?? '')
    ) {
      cambios.push('valorPrincipal');
    }

    if (Boolean(registro.activo) !== Boolean(definicionSiguiente.activo)) {
      cambios.push('activo');
    }

    return {
      hayCambios: cambios.length > 0,
      campos: cambios.sort(compararUtf8)
    };
  }

  registrarMutacionDnsAuditable({
    conexion,
    contexto,
    registroAntes,
    registroDespues,
    cambios
  }) {
    if (typeof this.servicioAuditoria?.registrarEnTransaccion !== 'function') {
      return null;
    }

    const eventoId = generarUuidV7Auditoria();
    const scope = scopeDesdeRegistroDns(registroDespues || registroAntes);
    const ejecucionTriggerId = normalizarId(
      contexto.ejecucionTriggerId ?? contexto.idEjecucionTrigger
    );
    if (!ejecucionTriggerId) {
      throw new Error(
        'La mutación DNS auditable requiere la ejecución de trigger causante.'
      );
    }
    const claveOperacion = [
      'ejecucion-trigger',
      ejecucionTriggerId,
      'dns-registro',
      registroAntes.id
    ].join(':');
    return this.servicioAuditoria.registrarEnTransaccion({
      cambioEfectivo: true,
      intencion: {
        versionContrato: 1,
        eventoId,
        tipo: 'dns.registro_actualizado',
        flujo: 'dns',
        claveCadena: claveCadenaDns(scope),
        actor: 'runtime',
        actorReal: { tipo: 'runtime', id: 'sentinelia-runtime' },
        actorEfectivo: null,
        modoActuacion: 'directo',
        sujeto: { tipo: 'registro_dns', id: String(registroAntes.id) },
        origen: 'runtime',
        correlacionId: eventoId,
        causalidad: { tipo: 'ejecucion_trigger', id: String(ejecucionTriggerId) },
        productor: 'runtime_automatizacion',
        claveOperacion,
        scope,
        efectivoEnUtc: this.ahora().toISOString(),
        rolEvento: 'principal',
        payload: {
          resultado: 'actualizado',
          camposCambiados: cambios.campos,
          antes: filtrarFotografiaPorCampos(
            fotografiaRegistroDnsRuntimeAuditable(registroAntes),
            cambios.campos
          ),
          despues: filtrarFotografiaPorCampos(
            fotografiaRegistroDnsRuntimeAuditable(registroDespues),
            cambios.campos
          )
        },
        versionCanonicalizador: PERFIL_JCS_AUDITORIA_V1,
        versionEncadenado: VERSION_ENCADENADO_AUDITORIA_V1
      }
    }, { conexion });
  }

  async crearGeneracionDnsSiAfectaPublicacion({
    conexion,
    zona,
    registroAntes,
    registroDespues
  }) {
    if (!registroAfectaPublicacion(zona, registroAntes, registroDespues)) {
      return null;
    }

    if (
      typeof this.repositorioCoordinacionGeneracionesDns
        ?.crearGeneracionPorMutacionEnTransaccion !== 'function'
    ) {
      return null;
    }

    return this.repositorioCoordinacionGeneracionesDns
      .crearGeneracionPorMutacionEnTransaccion({ conexion });
  }

  construirPayloadRespuesta({
    registroAntes,
    registroDespues,
    configuracion,
    cambios,
    zonaMarcadaPendiente
  }) {
    return {
      zonaId: registroAntes.zonaId,
      registroId: registroAntes.id,
      nombreVisible: registroAntes.construirNombreVisible(),
      operacion: configuracion.operacion,
      rolGobernanza: configuracion.rolGobernanza,
      cambios,
      zonaMarcadaPendiente,
      antes: {
        valorPrincipal: registroAntes.valorPrincipal,
        activo: registroAntes.activo
      },
      despues: {
        valorPrincipal: registroDespues?.valorPrincipal ?? registroAntes.valorPrincipal,
        activo: registroDespues?.activo ?? registroAntes.activo
      }
    };
  }

  async invalidarCatalogoDns() {
    if (typeof this.servicioDns?.invalidarCatalogoDns !== 'function') {
      return null;
    }

    return this.servicioDns.invalidarCatalogoDns();
  }
}

function fotografiaRegistroDnsRuntimeAuditable(registro) {
  return {
    valorPrincipal: registro.valorPrincipal ?? null,
    activo: Boolean(registro.activo)
  };
}

function filtrarFotografiaPorCampos(fotografia, campos) {
  return Object.fromEntries(campos.map((campo) => [campo, fotografia[campo]]));
}

function scopeDesdeRegistroDns(registro) {
  return {
    tenantId: registro.tenantId == null ? null : String(registro.tenantId),
    empresaId: registro.empresaId == null ? null : String(registro.empresaId),
    sitioId: registro.sitioId == null ? null : String(registro.sitioId)
  };
}

function claveCadenaDns(scope) {
  return scope.tenantId == null
    ? 'dns:portal'
    : `dns:tenant:${scope.tenantId}`;
}

function registroAfectaPublicacion(zona, antes, despues) {
  if (!entidadPublicableBind(zona)) {
    return false;
  }

  return entidadPublicableBind(antes) || entidadPublicableBind(despues);
}

function entidadPublicableBind(entidad) {
  return Boolean(entidad?.activo) && Boolean(entidad?.publicarEnBind);
}

function compararUtf8(a, b) {
  return Buffer.from(a).compare(Buffer.from(b));
}

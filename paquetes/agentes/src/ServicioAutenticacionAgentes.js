import { randomBytes } from 'node:crypto';
import bcrypt from 'bcrypt';
import {
  ESTADOS_ACCESO_AGENTE,
  ESTADOS_ADMINISTRATIVOS_AGENTE
} from './EstadosAgenteSentinelia.js';
import {
  CODIGOS_ERROR_AUTENTICACION_AGENTE,
  ErrorAutenticacionAgente,
  errorBootIdIncoherente,
  errorCredencialesInvalidas,
  errorEstadoInconsistenteAgente,
  errorHeartbeatSeqAntiguo,
  errorLoginAgenteEnProgreso,
  errorRefreshConcurrente,
  errorSessionIdActualNoCoincide,
  errorSesionNoViva
} from './ErroresAutenticacionAgente.js';
import {
  GeneradorSesionAgenteSentinelia
} from './GeneradorSesionAgenteSentinelia.js';
import { SesionAgenteSentinelia } from './SesionAgenteSentinelia.js';
import {
  crearSolicitudRefreshSesionAgente
} from './SolicitudRefreshSesionAgente.js';
import {
  crearSolicitudHeartbeatAgente
} from './SolicitudHeartbeatAgente.js';
import {
  ResultadoRefreshSesionAgente
} from './ResultadoRefreshSesionAgente.js';
import {
  ResultadoHeartbeatAgente
} from './ResultadoHeartbeatAgente.js';
import {
  ResultadoConfiguracionEfectivaAgente
} from './ResultadoConfiguracionEfectivaAgente.js';
import {
  CAPACIDADES_AGENTES,
  CONFIGURACION_EFECTIVA_AGENTE_POR_DEFECTO,
  construirCapacidadesAgentePorDefecto
} from './ConfiguracionEfectivaAgente.js';
import {
  generarUuidV7Auditoria,
  validarUuidV7Auditoria
} from '../../auditoria/src/UuidV7Auditoria.js';
import {
  PERFIL_JCS_AUDITORIA_V1
} from '../../auditoria/src/PerfilJcsAuditoria.js';
import {
  VERSION_ENCADENADO_AUDITORIA_V1
} from '../../auditoria/src/SobreCanonicoAuditoria.js';

const CONFIGURACION_AGENTES_POR_DEFECTO = Object.freeze({
  sessionTtlSegundos: 900,
  heartbeatIntervalSegundos:
    CONFIGURACION_EFECTIVA_AGENTE_POR_DEFECTO.heartbeatIntervalSeconds,
  heartbeatGraceSegundos:
    CONFIGURACION_EFECTIVA_AGENTE_POR_DEFECTO.heartbeatGraceSeconds,
  loginFallosMaximos: 5,
  cuarentenaSegundos: 900
});
const TTL_BLOQUEO_LOGIN_SEGUNDOS = 15;

export class ServicioAutenticacionAgentes {
  constructor({
    repositorioAgentes,
    repositorioSesionesAgentesRedis,
    servicioConfiguracionPortal = null,
    configuracionAgentes = CONFIGURACION_AGENTES_POR_DEFECTO,
    generadorSesiones = new GeneradorSesionAgenteSentinelia(),
    compararSecreto = bcrypt.compare,
    fronteraTransaccional = null,
    repositorioFronteraRuntime = null,
    servicioAuditoria = null,
    publicadorAvisosPerfilServidor = null,
    registradorCausaPolDdns = null,
    ddnsAgentesHabilitado = false,
    perfilServidorHabilitado = false,
    ahora = () => new Date()
  }) {
    this.repositorioAgentes = repositorioAgentes;
    this.repositorioSesionesAgentesRedis = repositorioSesionesAgentesRedis;
    this.servicioConfiguracionPortal = servicioConfiguracionPortal;
    this.configuracionAgentes = configuracionAgentes;
    this.generadorSesiones = generadorSesiones;
    this.compararSecreto = compararSecreto;
    this.fronteraTransaccional = fronteraTransaccional;
    this.repositorioFronteraRuntime = repositorioFronteraRuntime;
    this.servicioAuditoria = servicioAuditoria;
    this.publicadorAvisosPerfilServidor = publicadorAvisosPerfilServidor;
    this.registradorCausaPolDdns = registradorCausaPolDdns;
    this.ddnsAgentesHabilitado = ddnsAgentesHabilitado === true;
    this.perfilServidorHabilitado = perfilServidorHabilitado === true;
    this.ahora = ahora;
  }

  async autenticar({
    guid,
    secreto,
    loginRequestId = null,
    requerirRequestIdSesion = false,
    sessionIdAnterior = null,
    bootId = null,
    hostname = null,
    versionAgente = null
  }) {
    const configuracion = await this.obtenerConfiguracionAgentes();
    let credenciales = await this.buscarCredencialesSeguras(guid);

    if (!credenciales) {
      throw errorCredencialesInvalidas();
    }

    await this.liberarCuarentenaExpiradaSiProcede(credenciales);
    credenciales = await this.buscarCredencialesSeguras(guid);

    if (!credenciales) {
      throw errorCredencialesInvalidas();
    }

    this.validarEstadosQueBloqueanLogin(credenciales);

    const secretoValido = await this.compararSecreto(
      String(secreto || '').trim(),
      credenciales.secretoHash
    );

    if (!secretoValido) {
      await this.registrarLoginFallido({
        credenciales,
        idAgente: credenciales.id,
        loginFallosMaximos: configuracion.loginFallosMaximos,
        cuarentenaSegundos: configuracion.cuarentenaSegundos
      });
      throw errorCredencialesInvalidas();
    }

    const requestIdSesion = requerirRequestIdSesion
      ? validarRequestIdSesionTecnica(loginRequestId, 'loginRequestId')
      : null;
    const identificadorBloqueo = this.generarIdentificadorBloqueoLogin();
    const bloqueoAdquirido =
      await this.repositorioSesionesAgentesRedis.intentarBloquearLoginAgente({
        idAgente: credenciales.id,
        identificadorBloqueo,
        ttlSegundos: TTL_BLOQUEO_LOGIN_SEGUNDOS
      });

    if (!bloqueoAdquirido) {
      throw errorLoginAgenteEnProgreso();
    }

    try {
      return await this.consolidarLoginConBloqueo({
        credenciales,
        configuracion,
        sessionIdAnterior,
        bootId,
        versionAgente,
        hostname,
        loginRequestId: requestIdSesion
      });
    } finally {
      await this.liberarBloqueoLoginBestEffort({
        idAgente: credenciales.id,
        identificadorBloqueo
      });
    }
  }

  async consolidarLoginConBloqueo({
    credenciales,
    configuracion,
    sessionIdAnterior = null,
    bootId = null,
    versionAgente = null,
    hostname = null,
    loginRequestId = null
  }) {
    const parSesion = this.generadorSesiones.generarParSesion();
    const sospechas = this.detectarSospechas({
      credenciales,
      sessionIdAnterior,
      bootId,
      hostname
    });
    const sesion = new SesionAgenteSentinelia({
      agenteId: credenciales.id,
      guid: credenciales.guid,
      tenantId: credenciales.tenantId,
      empresaId: credenciales.empresaId,
      sitioId: credenciales.sitioId,
      sessionId: parSesion.sessionId,
      sessionTokenHash: parSesion.sessionTokenHash,
      versionSecreto: credenciales.versionSecreto,
      bootId,
      hostname,
      versionAgente,
      sessionIdAnterior,
      sospechas,
      ttlSegundos: configuracion.sessionTtlSegundos
    });
    let reemplazo = null;
    let agente = null;
    let periodoVidaPol = null;

    try {
      await this.ejecutarConAutoridadRuntime({
        agenteId: credenciales.id,
        guid: credenciales.guid,
        tenantId: credenciales.tenantId,
        empresaId: credenciales.empresaId,
        sitioId: credenciales.sitioId,
        versionSecreto: credenciales.versionSecreto,
        versionScopeAgente: credenciales.versionScopeAgente,
        versionAutorizacionAgente: credenciales.versionAutorizacionAgente
      }, async (conexion) => {
        reemplazo =
          await this.repositorioSesionesAgentesRedis.reemplazarSesionActual({
            sesion,
            ttlSegundos: configuracion.sessionTtlSegundos
          });
        agente = await this.repositorioAgentes.actualizarSnapshotLoginExitoso({
          idAgente: credenciales.id,
          sesionIdDiagnostico: sesion.sessionId,
          sesionHuellaSha256: sesion.sessionTokenHash,
          bootId,
          versionAgente,
          hostname
        }, { conexion });
        await this.repositorioAgentes.cerrarPeriodoVidaPolAbierto({
          agenteId: credenciales.id,
          motivoCierre: this.resolverMotivoCierrePolLogin({
            reemplazoSesionAnterior: reemplazo.reemplazoSesionAnterior,
            sessionIdAnterior
          })
        }, { conexion });
        periodoVidaPol = await this.repositorioAgentes.abrirPeriodoVidaPol({
          agenteId: credenciales.id,
          sesionIdDiagnostico: sesion.sessionId,
          sesionHuellaSha256: sesion.sessionTokenHash,
          bootId
        }, { conexion });
      });
      await this.publicarAvisoPolPerfilServidorBestEffort({
        agenteId: credenciales.id,
        periodoVidaPolId: periodoVidaPol?.id,
        tipoPol: 'login',
        seq: null,
        recibidoEnUtc: periodoVidaPol?.inicioUtc || this.ahora()
      });
    } catch (error) {
      await this.repositorioSesionesAgentesRedis.invalidarSesionSiCoincide({
        idAgente: credenciales.id,
        sessionTokenHash: sesion.sessionTokenHash
      });
      throw error;
    }

    return {
      agente,
      periodoVidaPol,
      sesion: sesion.obtenerRespuestaPublica(),
      sessionToken: parSesion.sessionToken,
      ttlSegundos: configuracion.sessionTtlSegundos,
      sospechas,
      loginRequestId,
      sesionAnteriorId: reemplazo.sesionAnteriorId,
      reemplazoSesionAnterior: reemplazo.reemplazoSesionAnterior
    };
  }

  async validarSesionViva(sessionToken) {
    const inspeccion = await this.inspeccionarSesionViva(sessionToken);
    return inspeccion.sesion;
  }

  async inspeccionarSesionViva(sessionToken) {
    const diagnostico =
      await this.repositorioSesionesAgentesRedis.diagnosticarSesionPorToken(
        sessionToken
      );

    if (diagnostico.estado !== 'viva') {
      await this.cerrarPeriodoPolPorSesionNoVigente(diagnostico);
      throw errorSesionNoViva(
        diagnostico.estado === 'reemplazada'
          ? 'La sesión técnica del agente fue reemplazada.'
          : 'La sesión técnica del agente ya no está viva.'
      );
    }

    const agente = await this.repositorioAgentes.buscarPorId(
      diagnostico.sesion.agenteId
    );

    if (!agente) {
      throw errorEstadoInconsistenteAgente(
        'La sesión técnica apunta a un agente que ya no existe.'
      );
    }

    if (
      agente.estadoAdministrativo ===
        ESTADOS_ADMINISTRATIVOS_AGENTE.DESHABILITADO
    ) {
      throw new ErrorAutenticacionAgente('El agente está deshabilitado.', {
        codigo: CODIGOS_ERROR_AUTENTICACION_AGENTE.AGENTE_DESHABILITADO,
        statusCode: 403,
        accion: 'login_required'
      });
    }

    return {
      agente,
      sesion: diagnostico.sesion,
      ttlRestanteSegundos: diagnostico.ttlRestanteSegundos
    };
  }

  async obtenerContextoIngestaTelemetria({
    sessionToken,
    revisionConfiguracionConocida = null,
    revisionPoliticaConocida = null
  } = {}) {
    const inspeccion = await this.inspeccionarSesionViva(sessionToken);
    const configuracion = await this.obtenerConfiguracionAgentes();
    const revisiones = await this.obtenerRevisionesActualesAgente();
    const periodoVidaPol =
      await this.repositorioAgentes.buscarPeriodoVidaPolAbierto(
        inspeccion.sesion.agenteId
      );

    return {
      ...inspeccion,
      periodoVidaPol: periodoPerteneceASesion({
        periodoVidaPol,
        sesion: inspeccion.sesion
      })
        ? periodoVidaPol
        : null,
      coordinacion: construirCoordinacionIngestaTelemetria({
        ttlRestanteSegundos: inspeccion.ttlRestanteSegundos,
        renewBeforeSeconds: calcularRenewBefore(
          configuracion.sessionTtlSegundos
        ),
        revisionConfiguracionActual: revisiones.revisionConfiguracionActual,
        revisionConfiguracionConocida,
        revisionPoliticaActual: revisiones.revisionPoliticaActual,
        revisionPoliticaConocida
      })
    };
  }

  async cerrarPeriodoPolPorSesionNoVigente(diagnostico) {
    if (!diagnostico?.sesion) {
      return false;
    }

    const motivoCierre = this.resolverMotivoCierrePolSesionNoVigente(
      diagnostico.estado
    );

    if (!motivoCierre) {
      return false;
    }

    return this.repositorioAgentes.cerrarPeriodoVidaPolAbiertoSiCoincide({
      agenteId: diagnostico.sesion.agenteId,
      sesionIdDiagnostico: diagnostico.sesion.sessionId,
      sesionHuellaSha256: diagnostico.sesion.sessionTokenHash,
      motivoCierre
    });
  }

  async registrarLoginFallido({
    credenciales,
    idAgente,
    loginFallosMaximos,
    cuarentenaSegundos
  }) {
    const registrar = async (conexion = null) => {
      const metodo = conexion &&
        this.repositorioAgentes.registrarLoginFallidoEnTransaccion
        ? 'registrarLoginFallidoEnTransaccion'
        : 'registrarLoginFallido';
      const resultado = await this.repositorioAgentes[metodo]({
        idAgente,
        loginFallosMaximos,
        cuarentenaSegundos
      }, { conexion });
      const normalizado = resultado?.agente
        ? resultado
        : {
            agente: resultado,
            cuarentenaActivada:
              credenciales?.estadoAcceso === 'normal' &&
              resultado?.estadoAcceso === 'cuarentena',
            estadoAntes: credenciales?.estadoAcceso || null,
            estadoDespues: resultado?.estadoAcceso || null
          };

      if (conexion && normalizado.cuarentenaActivada) {
        await this.registrarEventoCuarentena({
          conexion,
          agente: normalizado.agente,
          tipo: 'agente.cuarentena_activada',
          estadoAntes: 'normal',
          estadoDespues: 'cuarentena',
          motivo: 'umbral_fallos_login'
        });
      }

      return normalizado.agente;
    };

    if (this.auditoriaCuarentenaActiva()) {
      return this.fronteraTransaccional.ejecutar(registrar);
    }

    return registrar();
  }

  async liberarCuarentenaExpiradaSiProcede(credenciales) {
    const idAgente = credenciales?.id;
    if (!idAgente) return false;

    const liberar = async (conexion = null) => {
      const metodo = conexion &&
        this.repositorioAgentes.liberarCuarentenaExpiradaEnTransaccion
        ? 'liberarCuarentenaExpiradaEnTransaccion'
        : 'liberarCuarentenaExpirada';
      const resultado = await this.repositorioAgentes[metodo](
        idAgente,
        { conexion }
      );
      const normalizado = typeof resultado === 'boolean'
        ? {
            liberada: resultado,
            agente: null,
            estadoAntes: credenciales.estadoAcceso,
            estadoDespues: resultado ? 'normal' : credenciales.estadoAcceso
          }
        : resultado;

      if (conexion && normalizado?.liberada) {
        await this.registrarEventoCuarentena({
          conexion,
          agente: normalizado.agente || {
            id: idAgente,
            tenantId: credenciales.tenantId,
            empresaId: credenciales.empresaId,
            sitioId: credenciales.sitioId
          },
          tipo: 'agente.cuarentena_desactivada',
          estadoAntes: 'cuarentena',
          estadoDespues: 'normal',
          motivo: 'plazo_cuarentena_cumplido'
        });
      }

      return Boolean(normalizado?.liberada);
    };

    if (this.auditoriaCuarentenaActiva()) {
      return this.fronteraTransaccional.ejecutar(liberar);
    }

    return liberar();
  }

  auditoriaCuarentenaActiva() {
    return Boolean(
      this.fronteraTransaccional?.ejecutar &&
      this.servicioAuditoria?.registrarEnTransaccion
    );
  }

  registrarEventoCuarentena({
    conexion,
    agente,
    tipo,
    estadoAntes,
    estadoDespues,
    motivo
  }) {
    const eventoId = generarUuidV7Auditoria();
    return this.servicioAuditoria.registrarEnTransaccion({
      cambioEfectivo: true,
      intencion: {
        versionContrato: 1,
        eventoId,
        tipo,
        flujo: 'agentes',
        actor: 'sistema',
        actorReal: { tipo: 'sistema', id: 'sentinelia' },
        actorEfectivo: null,
        modoActuacion: 'directo',
        sujeto: { tipo: 'agente', id: String(agente.id) },
        origen: 'api_agentes',
        correlacionId: eventoId,
        causalidad: null,
        productor: 'api_agentes',
        claveOperacion: eventoId,
        claveCadena: claveCadenaAgente(agente),
        scope: scopeAgente(agente),
        efectivoEnUtc: this.ahora().toISOString(),
        rolEvento: 'principal',
        payload: { estadoAntes, estadoDespues, motivo },
        versionCanonicalizador: PERFIL_JCS_AUDITORIA_V1,
        versionEncadenado: VERSION_ENCADENADO_AUDITORIA_V1
      }
    }, { conexion });
  }

  async renovarSesion({
    sessionToken,
    refreshRequestId = null,
    requerirRequestIdSesion = false,
    sessionIdActual,
    bootId,
    revisionConfiguracionConocida = null,
    revisionPoliticaConocida = null,
    timestampClienteUtc = null
  }) {
    const solicitud = crearSolicitudRefreshSesionAgente({
      sessionIdActual,
      bootId,
      revisionConfiguracionConocida,
      revisionPoliticaConocida,
      timestampClienteUtc
    });
    const configuracion = await this.obtenerConfiguracionAgentes();
    const inspeccion = await this.inspeccionarSesionViva(sessionToken);
    const errorCoherencia = solicitud.comprobarCoherenciaConSesion(
      inspeccion.sesion
    );

    if (errorCoherencia) {
      this.lanzarErrorCoherenciaRefresh(errorCoherencia);
    }

    const requestIdSesion = requerirRequestIdSesion
      ? validarRequestIdSesionTecnica(refreshRequestId, 'refreshRequestId')
      : null;
    const parSesion = this.generadorSesiones.generarParSesion();
    const sesionRenovada = new SesionAgenteSentinelia({
      agenteId: inspeccion.sesion.agenteId,
      guid: inspeccion.sesion.guid,
      tenantId: inspeccion.sesion.tenantId,
      empresaId: inspeccion.sesion.empresaId,
      sitioId: inspeccion.sesion.sitioId,
      sessionId: parSesion.sessionId,
      sessionTokenHash: parSesion.sessionTokenHash,
      versionSecreto: inspeccion.sesion.versionSecreto,
      bootId: inspeccion.sesion.bootId,
      hostname: inspeccion.sesion.hostname,
      versionAgente: inspeccion.sesion.versionAgente,
      sessionIdAnterior: inspeccion.sesion.sessionId,
      sospechas: inspeccion.sesion.sospechas,
      ttlSegundos: configuracion.sessionTtlSegundos
    });
    let refresh = null;
    let agente = null;
    let periodoVidaPol = null;

    try {
      await this.ejecutarConAutoridadRuntime({
        agenteId: inspeccion.sesion.agenteId,
        guid: inspeccion.sesion.guid,
        tenantId: inspeccion.sesion.tenantId,
        empresaId: inspeccion.sesion.empresaId,
        sitioId: inspeccion.sesion.sitioId,
        versionSecreto: inspeccion.sesion.versionSecreto,
        versionScopeAgente: inspeccion.agente.versionScopeAgente,
        versionAutorizacionAgente:
          inspeccion.agente.versionAutorizacionAgente,
        sesionIdDiagnostico: inspeccion.sesion.sessionId,
        sesionHuellaSha256: inspeccion.sesion.sessionTokenHash
      }, async (conexion) => {
        refresh =
          await this.repositorioSesionesAgentesRedis.refrescarSesionSiCoincide({
            sesion: sesionRenovada,
            ttlSegundos: configuracion.sessionTtlSegundos,
            sessionIdActual: inspeccion.sesion.sessionId,
            sessionTokenHashActual: inspeccion.sesion.sessionTokenHash
          });
        if (!refresh.refrescada) {
          this.lanzarErrorEstadoRedisRefresh(refresh.estado);
        }
        agente = await this.repositorioAgentes.actualizarSnapshotRefreshSesion({
          idAgente: inspeccion.sesion.agenteId,
          sesionIdDiagnostico: sesionRenovada.sessionId,
          sesionHuellaSha256: sesionRenovada.sessionTokenHash
        }, { conexion });
        periodoVidaPol =
          await this.repositorioAgentes.actualizarSesionPeriodoVidaPolAbiertoSiCoincide(
            {
              agenteId: inspeccion.sesion.agenteId,
              sesionIdActual: inspeccion.sesion.sessionId,
              sesionHuellaActual: inspeccion.sesion.sessionTokenHash,
              sesionIdNueva: sesionRenovada.sessionId,
              sesionHuellaNueva: sesionRenovada.sessionTokenHash
            },
            { conexion }
          );

        if (!periodoVidaPol) {
          periodoVidaPol =
            await this.repositorioAgentes.buscarPeriodoVidaPolAbierto(
              inspeccion.sesion.agenteId,
              { conexion }
            );
        }
      });
    } catch (error) {
      await this.repositorioSesionesAgentesRedis.invalidarSesionSiCoincide({
        idAgente: inspeccion.sesion.agenteId,
        sessionTokenHash: sesionRenovada.sessionTokenHash
      });
      throw error;
    }

    const coordinacion = solicitud.obtenerCoordinacion(
      await this.obtenerRevisionesActualesAgente()
    );

    return new ResultadoRefreshSesionAgente({
      agente,
      sesion: sesionRenovada,
      sessionToken: parSesion.sessionToken,
      previousSessionId: refresh.previousSessionId || inspeccion.sesion.sessionId,
      ttlSegundos: configuracion.sessionTtlSegundos,
      renewBeforeSeconds: calcularRenewBefore(configuracion.sessionTtlSegundos),
      coordinacion,
      periodoVidaPol,
      refreshRequestId: requestIdSesion
    });
  }

  async registrarHeartbeat({
    sessionToken,
    seq,
    bootId,
    timestampClienteUtc = null,
    uptimeSeconds = null,
    revisionConfiguracionConocida = null,
    revisionPoliticaConocida = null,
    direccionRemota = null
  }) {
    const solicitud = crearSolicitudHeartbeatAgente({
      seq,
      bootId,
      timestampClienteUtc,
      uptimeSeconds
    });
    const configuracion = await this.obtenerConfiguracionAgentes();
    const inspeccion = await this.inspeccionarSesionViva(sessionToken);
    const errorCoherencia = solicitud.comprobarCoherenciaConSesion(
      inspeccion.sesion
    );

    if (errorCoherencia) {
      this.lanzarErrorCoherenciaHeartbeat(errorCoherencia);
    }

    const heartbeat = solicitud.obtenerHeartbeatAceptado();
    let registroRedis = null;
    let periodoActualizado = null;
    let agente = null;
    await this.ejecutarConAutoridadRuntime({
      agenteId: inspeccion.sesion.agenteId,
      guid: inspeccion.sesion.guid,
      tenantId: inspeccion.sesion.tenantId,
      empresaId: inspeccion.sesion.empresaId,
      sitioId: inspeccion.sesion.sitioId,
      versionSecreto: inspeccion.sesion.versionSecreto,
      versionScopeAgente: inspeccion.agente.versionScopeAgente,
      versionAutorizacionAgente: inspeccion.agente.versionAutorizacionAgente,
      sesionIdDiagnostico: inspeccion.sesion.sessionId,
      sesionHuellaSha256: inspeccion.sesion.sessionTokenHash
    }, async (conexion) => {
      let periodoVidaPol =
        await this.repositorioAgentes.buscarPeriodoVidaPolAbierto(
          inspeccion.sesion.agenteId,
          { conexion }
        );
      if (!periodoVidaPol) {
        periodoVidaPol = await this.repositorioAgentes.abrirPeriodoVidaPol({
          agenteId: inspeccion.sesion.agenteId,
          sesionIdDiagnostico: inspeccion.sesion.sessionId,
          sesionHuellaSha256: inspeccion.sesion.sessionTokenHash,
          bootId: inspeccion.sesion.bootId
        }, { conexion });
      }
      const errorSecuencia = solicitud.comprobarSecuencia({
        ultimoSeq: periodoVidaPol?.ultimoSeq
      });
      if (errorSecuencia) this.lanzarErrorCoherenciaHeartbeat(errorSecuencia);
      registroRedis =
        await this.repositorioSesionesAgentesRedis.registrarHeartbeatSesionActualSiCoincide({
          idAgente: inspeccion.sesion.agenteId,
          sessionId: inspeccion.sesion.sessionId,
          sessionTokenHash: inspeccion.sesion.sessionTokenHash,
          recibidoEnUtc: heartbeat.recibidoEnUtc,
          seq: solicitud.seq,
          uptimeSeconds: solicitud.uptimeSeconds
        });
      if (!registroRedis.registrado) {
        this.lanzarErrorEstadoRedisHeartbeat(registroRedis.estado);
      }
      periodoActualizado =
        await this.repositorioAgentes.registrarHeartbeatPeriodoAbierto({
          agenteId: inspeccion.sesion.agenteId,
          sesionIdDiagnostico: inspeccion.sesion.sessionId,
          seq: solicitud.seq,
          recibidoEnUtc: heartbeat.recibidoEnUtc
        }, { conexion });
      if (!periodoActualizado) {
        await this.lanzarErrorFalloRegistroPeriodoHeartbeat({
          agenteId: inspeccion.sesion.agenteId,
          sessionId: inspeccion.sesion.sessionId,
          seq: solicitud.seq,
          conexion
        });
      }
      if (typeof this.registradorCausaPolDdns?.registrarEnTransaccion === 'function') {
        await this.registradorCausaPolDdns.registrarEnTransaccion({
          agenteId: inspeccion.sesion.agenteId,
          periodoVidaPolId: periodoActualizado.id,
          sesionId: inspeccion.sesion.sessionId,
          secuencia: solicitud.seq,
          aceptadaEnUtc: heartbeat.recibidoEnUtc,
          direccionRemota
        }, { conexion });
      }
      agente = await this.repositorioAgentes.actualizarSnapshotHeartbeat({
        idAgente: inspeccion.sesion.agenteId,
        bootId: inspeccion.sesion.bootId,
        versionAgente: inspeccion.sesion.versionAgente,
        hostname: inspeccion.sesion.hostname,
        seq: solicitud.seq
      }, { conexion });
    });
    await this.publicarAvisoPolPerfilServidorBestEffort({
      agenteId: inspeccion.sesion.agenteId,
      periodoVidaPolId: periodoActualizado?.id,
      tipoPol: 'heartbeat',
      seq: solicitud.seq,
      recibidoEnUtc: heartbeat.recibidoEnUtc
    });

    const coordinacion = solicitud.obtenerCoordinacion({
      ttlRestanteSegundos:
        registroRedis.ttlRestanteSegundos || inspeccion.ttlRestanteSegundos,
      renewBeforeSeconds: calcularRenewBefore(configuracion.sessionTtlSegundos),
      revisionConfiguracionConocida,
      revisionPoliticaConocida,
      ...(await this.obtenerRevisionesActualesAgente())
    });

    return new ResultadoHeartbeatAgente({
      agente,
      sesion: inspeccion.sesion,
      ttlRestanteSegundos:
        registroRedis.ttlRestanteSegundos || inspeccion.ttlRestanteSegundos,
      renewBeforeSeconds: calcularRenewBefore(configuracion.sessionTtlSegundos),
      heartbeat,
      periodoVidaPol: periodoActualizado,
      estadoVidaPol: 'vivo',
      coordinacion
    });
  }

  async obtenerConfiguracionEfectiva({ sessionToken }) {
    const configuracion = await this.obtenerConfiguracionAgentes();
    const inspeccion = await this.inspeccionarSesionViva(sessionToken);
    const revisiones = await this.obtenerRevisionesActualesAgente();
    const renewBeforeSeconds = calcularRenewBefore(
      configuracion.sessionTtlSegundos
    );

    return new ResultadoConfiguracionEfectivaAgente({
      agente: inspeccion.agente,
      sesion: inspeccion.sesion,
      ttlRestanteSegundos: inspeccion.ttlRestanteSegundos,
      renewBeforeSeconds,
      configuracion: {
        revisionConfiguracion: revisiones.revisionConfiguracionActual,
        revisionPolitica: revisiones.revisionPoliticaActual,
        politicaVida: {
          sessionTtlSegundos: configuracion.sessionTtlSegundos,
          refreshBeforeSegundos: renewBeforeSeconds,
          heartbeatIntervalSegundos: configuracion.heartbeatIntervalSegundos,
          heartbeatGraceSegundos: configuracion.heartbeatGraceSegundos
        },
        capacidades: construirCapacidadesAgentePorDefecto().map((capacidad) =>
          capacidad.codigo === CAPACIDADES_AGENTES.DYNAMIC_DNS
            ? {
                ...capacidad,
                habilitada: this.ddnsAgentesHabilitado,
                descripcion: this.ddnsAgentesHabilitado
                  ? 'Gestión DDNS concedida por registro.'
                  : capacidad.descripcion
              }
            : capacidad
        )
      }
    });
  }

  async ejecutarConAutoridadRuntime(autoridad, trabajo) {
    if (
      !this.fronteraTransaccional ||
      typeof this.repositorioFronteraRuntime
        ?.bloquearYValidarEnTransaccion !== 'function'
    ) {
      return trabajo(null);
    }
    return this.fronteraTransaccional.ejecutar(async (conexion) => {
      await this.repositorioFronteraRuntime.bloquearYValidarEnTransaccion(
        autoridad,
        { conexion }
      );
      return trabajo(conexion);
    });
  }

  async buscarCredencialesSeguras(guid) {
    try {
      return await this.repositorioAgentes.buscarCredencialesPorGuid(guid);
    } catch (_error) {
      return null;
    }
  }

  validarEstadosQueBloqueanLogin(credenciales) {
    if (
      credenciales.estadoAdministrativo ===
        ESTADOS_ADMINISTRATIVOS_AGENTE.DESHABILITADO
    ) {
      throw new ErrorAutenticacionAgente('El agente está deshabilitado.', {
        codigo: CODIGOS_ERROR_AUTENTICACION_AGENTE.AGENTE_DESHABILITADO,
        statusCode: 403
      });
    }

    if (credenciales.estadoAcceso === ESTADOS_ACCESO_AGENTE.CUARENTENA) {
      throw new ErrorAutenticacionAgente(
        'El agente está en cuarentena temporal por fallos de login.',
        {
          codigo: CODIGOS_ERROR_AUTENTICACION_AGENTE.AGENTE_EN_CUARENTENA,
          statusCode: 403,
          detalles: {
            cuarentenaHastaUtc: credenciales.cuarentenaHastaUtc || null
          }
        }
      );
    }
  }

  detectarSospechas({
    credenciales,
    sessionIdAnterior = null,
    bootId = null,
    hostname = null
  }) {
    const sospechas = [];
    const bootNormalizado = normalizarTextoOpcional(bootId);
    const bootAnterior = normalizarTextoOpcional(credenciales.ultimoBootId);
    const hostnameNormalizado = normalizarTextoOpcional(hostname)?.toLowerCase();
    const hostnameAnterior =
      normalizarTextoOpcional(credenciales.ultimoHostname)?.toLowerCase();
    const sesionAnteriorInformada = normalizarTextoOpcional(sessionIdAnterior);
    const ultimaSesion = normalizarTextoOpcional(
      credenciales.ultimaSesionIdDiagnostico
    );

    if (bootNormalizado && bootAnterior && bootNormalizado !== bootAnterior) {
      sospechas.push('boot_id_cambiado');
    }

    if (
      hostnameNormalizado &&
      hostnameAnterior &&
      hostnameNormalizado !== hostnameAnterior
    ) {
      sospechas.push('hostname_cambiado');
    }

    if (
      sesionAnteriorInformada &&
      ultimaSesion &&
      sesionAnteriorInformada !== ultimaSesion
    ) {
      sospechas.push('session_id_anterior_no_coincide');
    }

    return sospechas;
  }

  resolverMotivoCierrePolLogin({
    reemplazoSesionAnterior = false,
    sessionIdAnterior = null
  }) {
    if (reemplazoSesionAnterior) {
      return 'sesion_reemplazada';
    }

    if (sessionIdAnterior) {
      return 'relogin_agente';
    }

    return 'nuevo_login';
  }

  resolverMotivoCierrePolSesionNoVigente(estadoRedis) {
    if (estadoRedis === 'reemplazada') {
      return 'sesion_reemplazada';
    }

    if (estadoRedis === 'sin_indice_actual') {
      return 'sesion_redis_no_vigente';
    }

    if (estadoRedis === 'token_sin_ttl') {
      return 'sesion_redis_expirada';
    }

    return null;
  }

  generarIdentificadorBloqueoLogin() {
    return `login_${randomBytes(16).toString('hex')}`;
  }

  lanzarErrorCoherenciaRefresh(codigo) {
    if (codigo === CODIGOS_ERROR_AUTENTICACION_AGENTE.SESSION_ID_ACTUAL_NO_COINCIDE) {
      throw errorSessionIdActualNoCoincide();
    }

    if (codigo === CODIGOS_ERROR_AUTENTICACION_AGENTE.BOOT_ID_INCOHERENTE) {
      throw errorBootIdIncoherente();
    }

    throw errorSesionNoViva();
  }

  lanzarErrorCoherenciaHeartbeat(codigo) {
    if (codigo === CODIGOS_ERROR_AUTENTICACION_AGENTE.BOOT_ID_INCOHERENTE) {
      throw errorBootIdIncoherente();
    }

    if (codigo === CODIGOS_ERROR_AUTENTICACION_AGENTE.HEARTBEAT_SEQ_ANTIGUO) {
      throw errorHeartbeatSeqAntiguo();
    }

    throw errorSesionNoViva();
  }

  lanzarErrorEstadoRedisRefresh(estado) {
    if (estado === 'no_coincide') {
      throw errorRefreshConcurrente();
    }

    if (estado === 'indice_invalido') {
      throw errorEstadoInconsistenteAgente(
        'El índice Redis de sesión del agente no es válido.'
      );
    }

    throw errorSesionNoViva();
  }

  lanzarErrorEstadoRedisHeartbeat(estado) {
    if (estado === 'no_coincide') {
      throw errorSesionNoViva(
        'La sesión técnica del agente fue reemplazada durante el heartbeat.'
      );
    }

    if (estado === 'indice_invalido' || estado === 'payload_invalido') {
      throw errorEstadoInconsistenteAgente(
        'El estado Redis de sesión del agente no es válido para heartbeat.'
      );
    }

    throw errorSesionNoViva();
  }

  async lanzarErrorFalloRegistroPeriodoHeartbeat({
    agenteId,
    sessionId,
    seq,
    conexion = null
  }) {
    const periodoActual =
      await this.repositorioAgentes.buscarPeriodoVidaPolAbierto(
        agenteId,
        { conexion }
      );

    if (!periodoActual) {
      throw errorSesionNoViva(
        'El periodo POL de la sesión técnica ya no está vigente.'
      );
    }

    if (periodoActual.sesionIdDiagnostico !== sessionId) {
      throw errorSesionNoViva(
        'El periodo POL abierto pertenece a otra sesión técnica.'
      );
    }

    const ultimoSeq = Number.parseInt(String(periodoActual.ultimoSeq ?? ''), 10);

    if (Number.isInteger(ultimoSeq) && seq <= ultimoSeq) {
      throw errorHeartbeatSeqAntiguo();
    }

    throw errorEstadoInconsistenteAgente(
      'No se pudo registrar el heartbeat en el periodo POL vigente.'
    );
  }

  async publicarAvisoPolPerfilServidorBestEffort(datos) {
    if (
      !this.perfilServidorHabilitado ||
      typeof this.publicadorAvisosPerfilServidor?.publicarPolAceptado !== 'function'
    ) {
      return { publicado: false, motivo: 'perfil_servidor_no_habilitado' };
    }
    try {
      return await this.publicadorAvisosPerfilServidor.publicarPolAceptado(datos);
    } catch (error) {
      console.warn(
        '[agentes] El POL quedó durable, pero no se pudo despertar el perfil servidor.'
      );
      console.warn(error);
      return { publicado: false, motivo: 'redis_no_disponible' };
    }
  }

  async liberarBloqueoLoginBestEffort({ idAgente, identificadorBloqueo }) {
    try {
      await this.repositorioSesionesAgentesRedis.liberarBloqueoLoginAgente({
        idAgente,
        identificadorBloqueo
      });
    } catch (error) {
      console.warn('[agentes] No se pudo liberar el candado de login; expirará por TTL.');
      console.warn(error);
    }
  }

  async obtenerConfiguracionAgentes() {
    if (this.servicioConfiguracionPortal) {
      const configuracionPortal =
        await this.servicioConfiguracionPortal.asegurarActualizada();
      return normalizarConfiguracionAgentes(
        configuracionPortal.obtenerConfiguracionAgentes()
      );
    }

    return normalizarConfiguracionAgentes(this.configuracionAgentes);
  }

  async obtenerRevisionesActualesAgente() {
    if (!this.servicioConfiguracionPortal) {
      return {
        revisionConfiguracionActual: null,
        revisionPoliticaActual: null
      };
    }

    await this.servicioConfiguracionPortal.asegurarActualizada();

    return {
      revisionConfiguracionActual:
        normalizarRevision(this.servicioConfiguracionPortal.obtenerVersionActual()),
      revisionPoliticaActual: null
    };
  }
}

function normalizarConfiguracionAgentes(configuracion = {}) {
  return {
    sessionTtlSegundos: normalizarEnteroPositivo(
      configuracion.sessionTtlSegundos,
      CONFIGURACION_AGENTES_POR_DEFECTO.sessionTtlSegundos
    ),
    heartbeatIntervalSegundos: normalizarEnteroPositivo(
      configuracion.heartbeatIntervalSegundos,
      CONFIGURACION_AGENTES_POR_DEFECTO.heartbeatIntervalSegundos
    ),
    heartbeatGraceSegundos: normalizarEnteroPositivo(
      configuracion.heartbeatGraceSegundos,
      CONFIGURACION_AGENTES_POR_DEFECTO.heartbeatGraceSegundos
    ),
    loginFallosMaximos: normalizarEnteroPositivo(
      configuracion.loginFallosMaximos,
      CONFIGURACION_AGENTES_POR_DEFECTO.loginFallosMaximos
    ),
    cuarentenaSegundos: normalizarEnteroPositivo(
      configuracion.cuarentenaSegundos,
      CONFIGURACION_AGENTES_POR_DEFECTO.cuarentenaSegundos
    )
  };
}

function normalizarEnteroPositivo(valor, porDefecto) {
  const convertido = Number.parseInt(String(valor ?? ''), 10);
  return Number.isInteger(convertido) && convertido > 0 ? convertido : porDefecto;
}

function normalizarTextoOpcional(valor) {
  const normalizado = String(valor || '').trim();
  return normalizado || null;
}

function normalizarRevision(valor) {
  const normalizado = String(valor || '').trim();
  return normalizado || null;
}

function periodoPerteneceASesion({ periodoVidaPol, sesion }) {
  if (!periodoVidaPol || !sesion) {
    return false;
  }

  return (
    periodoVidaPol.sesionIdDiagnostico === sesion.sessionId &&
    periodoVidaPol.sesionHuellaSha256 === sesion.sessionTokenHash
  );
}

function construirCoordinacionIngestaTelemetria({
  ttlRestanteSegundos = null,
  renewBeforeSeconds = 120,
  revisionConfiguracionActual = null,
  revisionConfiguracionConocida = null,
  revisionPoliticaActual = null,
  revisionPoliticaConocida = null
} = {}) {
  const ttl = Number.parseInt(String(ttlRestanteSegundos ?? ''), 10);
  const margenRefresh = Number.parseInt(String(renewBeforeSeconds ?? ''), 10);
  const requiereRefreshSesion =
    Number.isInteger(ttl) &&
    ttl >= 0 &&
    ttl <= (Number.isInteger(margenRefresh) && margenRefresh > 0
      ? margenRefresh
      : 120);
  const revisionConfiguracion = normalizarRevision(revisionConfiguracionActual);
  const revisionPolitica = normalizarRevision(revisionPoliticaActual);
  const requiereConfiguracion =
    Boolean(revisionConfiguracion) &&
    revisionConfiguracion !== normalizarRevision(revisionConfiguracionConocida);
  const requierePolitica =
    Boolean(revisionPolitica) &&
    revisionPolitica !== normalizarRevision(revisionPoliticaConocida);

  return {
    accion: resolverAccionCoordinacionIngesta({
      requiereRefreshSesion,
      requiereConfiguracion,
      requierePolitica
    }),
    requiereRefreshSesion,
    requiereConfiguracion,
    revisionConfiguracionActual: revisionConfiguracion,
    requierePolitica,
    revisionPoliticaActual: revisionPolitica
  };
}

function resolverAccionCoordinacionIngesta({
  requiereRefreshSesion,
  requiereConfiguracion,
  requierePolitica
}) {
  if (requiereRefreshSesion) {
    return 'refresh_session';
  }

  if (requiereConfiguracion || requierePolitica) {
    return 'refresh_config';
  }

  return 'continue';
}

function calcularRenewBefore(ttlSegundos) {
  const ttl = Number.parseInt(String(ttlSegundos ?? ''), 10);
  return Math.max(1, Math.min(120, ttl || 120));
}

function validarRequestIdSesionTecnica(valor, nombre) {
  try {
    return validarUuidV7Auditoria(valor, nombre);
  } catch {
    throw new ErrorAutenticacionAgente(
      `${nombre} es obligatorio y debe ser un UUIDv7 de auditoría.`,
      {
        codigo: 'REQUEST_ID_SESION_REQUERIDO',
        statusCode: 400
      }
    );
  }
}

function scopeAgente(agente) {
  return {
    tenantId: String(agente.tenantId),
    empresaId: String(agente.empresaId),
    sitioId: String(agente.sitioId)
  };
}

function claveCadenaAgente(agente) {
  return `agentes:tenant:${String(agente.tenantId)}`;
}

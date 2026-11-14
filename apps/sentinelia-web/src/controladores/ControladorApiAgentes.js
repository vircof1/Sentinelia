import { randomBytes } from 'node:crypto';
import {
  ESTADOS_VIDA_POL_AGENTE
} from '../../../../paquetes/agentes/src/EstadosAgenteSentinelia.js';
import {
  ErrorAutenticacionAgente
} from '../../../../paquetes/agentes/src/ErroresAutenticacionAgente.js';
import {
  crearLoteTelemetriaAgente
} from '../../../../paquetes/agentes/src/TelemetriaAgente.js';
import {
  calcularHuellaLoteTelemetriaSha256,
  validarTelemetriaRequestId
} from '../../../../paquetes/agentes/src/ContratoTelemetriaTemporalAgente.js';

const RENEW_BEFORE_SEGUNDOS = 120;
const CAMPOS_LOGIN = Object.freeze([
  'guid',
  'secreto',
  'loginRequestId',
  'sessionIdAnterior',
  'bootId',
  'hostname',
  'versionAgente',
  'timestampClienteUtc'
]);
const CAMPOS_REFRESH = Object.freeze([
  'refreshRequestId',
  'sessionIdActual',
  'bootId',
  'revisionConfiguracionConocida',
  'revisionPoliticaConocida',
  'timestampClienteUtc'
]);
const CAMPOS_HEARTBEAT = Object.freeze([
  'seq',
  'bootId',
  'revisionConfiguracionConocida',
  'revisionPoliticaConocida',
  'timestampClienteUtc',
  'uptimeSeconds'
]);

export class ControladorApiAgentes {
  constructor({
    servicioAutenticacionAgentes,
    servicioIngestaTelemetriaAgentes = null,
    servicioConsultaDdnsAgentes = null,
    servicioAplicacionDdnsAgentes = null
  }) {
    this.servicioAutenticacionAgentes = servicioAutenticacionAgentes;
    this.servicioIngestaTelemetriaAgentes = servicioIngestaTelemetriaAgentes;
    this.servicioConsultaDdnsAgentes = servicioConsultaDdnsAgentes;
    this.servicioAplicacionDdnsAgentes = servicioAplicacionDdnsAgentes;
  }

  async login(requisicion, respuesta) {
    let requestId = this.generarRequestId();

    try {
      this.validarPeticionLogin(requisicion.body);

      const resultado = await this.servicioAutenticacionAgentes.autenticar({
        guid: requisicion.body?.guid,
        secreto: requisicion.body?.secreto,
        loginRequestId: requisicion.body?.loginRequestId,
        requerirRequestIdSesion: true,
        sessionIdAnterior: requisicion.body?.sessionIdAnterior || null,
        bootId: requisicion.body?.bootId,
        hostname: requisicion.body?.hostname || null,
        versionAgente: requisicion.body?.versionAgente || null
      });
      requestId = resultado.loginRequestId || requestId;

      respuesta.json({
        ok: true,
        requestId,
        serverTimeUtc: new Date().toISOString(),
        agente: this.serializarIdentidadAgente(resultado.agente),
        sesion: {
          sessionId: resultado.sesion.sessionId,
          sessionToken: resultado.sessionToken,
          expiresInSeconds: resultado.ttlSegundos,
          renewBeforeSeconds: this.calcularRenewBefore(resultado.ttlSegundos)
        },
        pol: {
          estadoVidaPol: ESTADOS_VIDA_POL_AGENTE.VIVO,
          periodoId: resultado.periodoVidaPol?.id || null
        }
      });
    } catch (error) {
      this.responderError(respuesta, error, requestId);
    }
  }

  async me(requisicion, respuesta) {
    const requestId = this.generarRequestId();
    const sessionToken = this.extraerBearer(requisicion);

    if (!sessionToken) {
      respuesta.status(401).json({
        ok: false,
        requestId,
        code: 'bearer_requerido',
        message: 'Authorization Bearer token is required.',
        action: 'login_required'
      });
      return;
    }

    try {
      const resultado =
        await this.servicioAutenticacionAgentes.inspeccionarSesionViva(
          sessionToken
        );

      respuesta.json({
        ok: true,
        requestId,
        serverTimeUtc: new Date().toISOString(),
        agente: this.serializarIdentidadAgente(resultado.agente),
        sesion: {
          sessionId: resultado.sesion.sessionId,
          expiresInSeconds: Math.max(0, resultado.ttlRestanteSegundos || 0),
          renewBeforeSeconds: this.calcularRenewBefore(
            resultado.ttlRestanteSegundos
          )
        },
        pol: {
          estadoVidaPol: ESTADOS_VIDA_POL_AGENTE.VIVO,
          ultimoHeartbeatUtc: resultado.agente.ultimoHeartbeatUtc,
          ultimoBootId: resultado.agente.ultimoBootId,
          ultimoSeq: resultado.agente.ultimoSeq
        }
      });
    } catch (error) {
      this.responderError(respuesta, error, requestId);
    }
  }

  async refresh(requisicion, respuesta) {
    let requestId = this.generarRequestId();
    const sessionToken = this.extraerBearer(requisicion);

    if (!sessionToken) {
      respuesta.status(401).json({
        ok: false,
        requestId,
        code: 'bearer_requerido',
        message: 'Authorization Bearer token is required.',
        action: 'login_required'
      });
      return;
    }

    try {
      this.validarPeticionRefresh(requisicion.body);

      const resultado = await this.servicioAutenticacionAgentes.renovarSesion({
        sessionToken,
        refreshRequestId: requisicion.body?.refreshRequestId,
        requerirRequestIdSesion: true,
        sessionIdActual: requisicion.body?.sessionIdActual,
        bootId: requisicion.body?.bootId,
        revisionConfiguracionConocida:
          requisicion.body?.revisionConfiguracionConocida || null,
        revisionPoliticaConocida:
          requisicion.body?.revisionPoliticaConocida || null,
        timestampClienteUtc: requisicion.body?.timestampClienteUtc || null
      });
      const publico = resultado.obtenerRespuestaPublica();
      requestId = requisicion.body?.refreshRequestId || requestId;

      respuesta.json({
        ok: true,
        requestId,
        serverTimeUtc: new Date().toISOString(),
        agente: this.serializarIdentidadAgente(publico.agente),
        sesion: publico.sesion,
        coordinacion: publico.coordinacion,
        pol: publico.pol
      });
    } catch (error) {
      this.responderError(respuesta, error, requestId);
    }
  }

  async heartbeat(requisicion, respuesta) {
    const requestId = this.generarRequestId();
    const sessionToken = this.extraerBearer(requisicion);

    if (!sessionToken) {
      respuesta.status(401).json({
        ok: false,
        requestId,
        code: 'bearer_requerido',
        message: 'Authorization Bearer token is required.',
        action: 'login_required'
      });
      return;
    }

    try {
      this.validarPeticionHeartbeat(requisicion.body);

      const resultado =
        await this.servicioAutenticacionAgentes.registrarHeartbeat({
          sessionToken,
          seq: requisicion.body?.seq,
          bootId: requisicion.body?.bootId,
          timestampClienteUtc: requisicion.body?.timestampClienteUtc || null,
          uptimeSeconds: requisicion.body?.uptimeSeconds ?? null,
          revisionConfiguracionConocida:
            requisicion.body?.revisionConfiguracionConocida || null,
          revisionPoliticaConocida:
            requisicion.body?.revisionPoliticaConocida || null,
          direccionRemota:
            requisicion.redPublicaFederacion?.direccionCliente || null
        });
      const publico = resultado.obtenerRespuestaPublica();

      respuesta.json({
        ok: true,
        requestId,
        serverTimeUtc: new Date().toISOString(),
        agente: this.serializarIdentidadAgente(publico.agente),
        sesion: publico.sesion,
        heartbeat: publico.heartbeat,
        pol: publico.pol,
        coordinacion: publico.coordinacion
      });
    } catch (error) {
      this.responderError(respuesta, error, requestId);
    }
  }

  async configuracion(requisicion, respuesta) {
    const requestId = this.generarRequestId();
    const sessionToken = this.extraerBearer(requisicion);

    if (!sessionToken) {
      respuesta.status(401).json({
        ok: false,
        requestId,
        code: 'bearer_requerido',
        message: 'Authorization Bearer token is required.',
        action: 'login_required'
      });
      return;
    }

    try {
      const resultado =
        await this.servicioAutenticacionAgentes.obtenerConfiguracionEfectiva({
          sessionToken
        });
      const publico = resultado.obtenerRespuestaPublica();

      respuesta.json({
        ok: true,
        requestId,
        serverTimeUtc: new Date().toISOString(),
        agente: this.serializarIdentidadAgente(publico.agente),
        sesion: publico.sesion,
        configuracion: publico.configuracion
      });
    } catch (error) {
      this.responderError(respuesta, error, requestId);
    }
  }

  async ddns(requisicion, respuesta) {
    const requestId = this.generarRequestId();
    const sessionToken = this.extraerBearer(requisicion);
    if (!sessionToken) {
      respuesta.status(401).set('Cache-Control', 'no-store').json({
        ok: false,
        requestId,
        code: 'bearer_requerido',
        message: 'Authorization Bearer token is required.',
        action: 'login_required'
      });
      return;
    }
    try {
      if (typeof this.servicioConsultaDdnsAgentes?.listar !== 'function') {
        throw Object.assign(new Error('La consulta DDNS no está configurada.'), {
          statusCode: 500,
          codigo: 'servicio_ddns_no_configurado'
        });
      }
      const sesion = await this.servicioAutenticacionAgentes
        .inspeccionarSesionViva(sessionToken);
      const fotografia = await this.servicioConsultaDdnsAgentes.listar({
        agenteId: sesion.sesion?.agenteId ?? sesion.agente?.id,
        limite: requisicion.query?.limit,
        cursor: requisicion.query?.cursor || null
      });
      respuesta
        .set('Cache-Control', 'no-store')
        .json({
          ok: true,
          requestId,
          serverTimeUtc: new Date().toISOString(),
          ...fotografia
        });
    } catch (error) {
      respuesta.set('Cache-Control', 'no-store');
      this.responderError(respuesta, error, requestId);
    }
  }

  async crearIntencionDdns(requisicion, respuesta) {
    const requestId = this.generarRequestId();
    const sessionToken = this.extraerBearer(requisicion);
    if (!sessionToken) {
      respuesta.status(401).set('Cache-Control', 'no-store').json({
        ok: false,
        requestId,
        code: 'bearer_requerido',
        message: 'Authorization Bearer token is required.',
        action: 'login_required'
      });
      return;
    }
    try {
      if (typeof this.servicioAplicacionDdnsAgentes
        ?.aceptarIntencionPublica !== 'function') {
        throw Object.assign(new Error('La modificación DDNS no está configurada.'), {
          statusCode: 500,
          codigo: 'servicio_ddns_no_configurado'
        });
      }
      const contextoSesionTecnica = await this.servicioAutenticacionAgentes
        .inspeccionarSesionViva(sessionToken);
      const aplicacion = await this.servicioAplicacionDdnsAgentes
        .aceptarIntencionPublica({
          contextoSesionTecnica,
          concesionId: requisicion.params?.concesionId,
          solicitud: requisicion.body
        });
      const resultado = aplicacion.resultado;
      if (resultado.error) {
        const error = errorHttpDdns(resultado);
        respuesta.status(error.statusCode).set('Cache-Control', 'no-store').json({
          ok: false,
          requestId,
          code: error.codigo,
          message: error.message,
          ...(error.currentVersion === null
            ? {}
            : { currentVersion: error.currentVersion })
        });
        return;
      }
      respuesta
        .status(resultado.resultado === 'aceptada' ? 202 : 200)
        .set('Cache-Control', 'no-store')
        .json({
          ok: true,
          requestId,
          serverTimeUtc: new Date().toISOString(),
          ...resultado,
          estadoDeseado: proyectarEstadoDeseadoDdns(aplicacion.estadoDeseado)
        });
    } catch (error) {
      respuesta.set('Cache-Control', 'no-store');
      this.responderError(respuesta, error, requestId);
    }
  }

  async telemetria(requisicion, respuesta) {
    const requestId = this.generarRequestId();
    const sessionToken = this.extraerBearer(requisicion);

    if (!sessionToken) {
      respuesta.status(401).json({
        ok: false,
        requestId,
        code: 'bearer_requerido',
        message: 'Authorization Bearer token is required.',
        action: 'login_required'
      });
      return;
    }

    try {
      const contrato = this.validarPeticionTelemetria(requisicion.body);

      if (!this.servicioIngestaTelemetriaAgentes) {
        const error = new Error('El servicio de ingesta de telemetría no está configurado.');
        error.statusCode = 500;
        error.codigo = 'servicio_telemetria_no_configurado';
        throw error;
      }

      const inspeccion =
        await this.servicioAutenticacionAgentes.obtenerContextoIngestaTelemetria(
          {
            sessionToken,
            revisionConfiguracionConocida:
              requisicion.body?.revisionConfiguracionConocida || null,
            revisionPoliticaConocida:
              requisicion.body?.revisionPoliticaConocida || null
          }
        );
      const recibidoEnUtc = new Date();
      const resultado = await this.servicioIngestaTelemetriaAgentes.ingestarLote({
        agenteId: inspeccion.sesion.agenteId,
        lote: requisicion.body,
        requestId,
        telemetriaRequestId: contrato.telemetriaRequestId,
        huellaLoteSha256: contrato.huellaLoteSha256,
        recibidoEnUtc,
        periodoVidaPolId: inspeccion.periodoVidaPol?.id || null,
        sesionIdDiagnostico: inspeccion.sesion.sessionId,
        sesionHuellaSha256: inspeccion.sesion.sessionTokenHash,
        autoridadRuntime: {
          guid: inspeccion.sesion.guid,
          tenantId: inspeccion.sesion.tenantId,
          empresaId: inspeccion.sesion.empresaId,
          sitioId: inspeccion.sesion.sitioId,
          versionSecreto: inspeccion.sesion.versionSecreto,
          versionScopeAgente: inspeccion.agente?.versionScopeAgente,
          versionAutorizacionAgente:
            inspeccion.agente?.versionAutorizacionAgente,
          sesionAuditoriaId: inspeccion.agente?.sesionAuditoriaId,
          sesionIdDiagnostico: inspeccion.sesion.sessionId,
          sesionHuellaSha256: inspeccion.sesion.sessionTokenHash
        }
      });

      respuesta.json({
        ...resultado.resultado,
        telemetriaRequestId: contrato.telemetriaRequestId,
        coordinacion: inspeccion.coordinacion
      });
    } catch (error) {
      this.responderErrorTelemetria(respuesta, error, requestId);
    }
  }

  serializarIdentidadAgente(agente) {
    return {
      id: agente.id,
      guid: agente.guid,
      nombre: agente.nombre,
      tenantId: agente.tenantId,
      empresaId: agente.empresaId,
      sitioId: agente.sitioId,
      estadoAdministrativo: agente.estadoAdministrativo,
      estadoAcceso: agente.estadoAcceso
    };
  }

  responderError(respuesta, error, requestId) {
    const statusCode = error instanceof ErrorAutenticacionAgente
      ? error.statusCode
      : error.statusCode || 400;
    const cuerpo = {
      ok: false,
      requestId,
      code: error.codigo || 'peticion_invalida',
      message: error.message || 'La petición del agente no es válida.'
    };

    if (error.accion) {
      cuerpo.action = error.accion;
    }

    if (error.detalles?.cuarentenaHastaUtc) {
      cuerpo.cuarentenaHastaUtc = error.detalles.cuarentenaHastaUtc;
    }

    if (Array.isArray(error.validation)) {
      cuerpo.validation = error.validation;
    }

    respuesta.status(statusCode).json(cuerpo);
  }

  responderErrorTelemetria(respuesta, error, requestId) {
    const statusCode = error instanceof ErrorAutenticacionAgente
      ? error.statusCode
      : error.statusCode;

    if (Number.isInteger(statusCode) && statusCode < 500) {
      this.responderError(respuesta, error, requestId);
      return;
    }

    respuesta.status(500).json({
      ok: false,
      requestId,
      code: 'error_interno_telemetria',
      message: 'No se pudo completar la ingesta de telemetría.'
    });
  }

  validarPeticionLogin(body) {
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      this.lanzarErrorValidacion('body', 'La petición de login debe ser JSON.');
    }

    this.validarPropiedadesPermitidas(body, CAMPOS_LOGIN);
    this.validarTexto(body.guid, 'guid', { minimo: 1 });
    this.validarTexto(body.secreto, 'secreto', { minimo: 32, maximo: 256 });
    this.validarTexto(body.bootId, 'bootId', { minimo: 1, maximo: 120 });
    this.validarTextoOpcional(body.sessionIdAnterior, 'sessionIdAnterior', {
      minimo: 1,
      maximo: 96
    });
    this.validarTextoOpcional(body.hostname, 'hostname', { maximo: 255 });
    this.validarTextoOpcional(body.versionAgente, 'versionAgente', { maximo: 80 });
    this.validarFechaOpcional(body.timestampClienteUtc, 'timestampClienteUtc');
  }

  validarPeticionRefresh(body) {
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      this.lanzarErrorValidacion('body', 'La petición de refresh debe ser JSON.');
    }

    this.validarPropiedadesPermitidas(body, CAMPOS_REFRESH);
    this.validarTexto(body.sessionIdActual, 'sessionIdActual', {
      minimo: 1,
      maximo: 96
    });
    this.validarTexto(body.bootId, 'bootId', { minimo: 1, maximo: 120 });
    this.validarTextoOpcional(
      body.revisionConfiguracionConocida,
      'revisionConfiguracionConocida',
      { maximo: 120 }
    );
    this.validarTextoOpcional(
      body.revisionPoliticaConocida,
      'revisionPoliticaConocida',
      { maximo: 120 }
    );
    this.validarFechaOpcional(body.timestampClienteUtc, 'timestampClienteUtc');
  }

  validarPeticionHeartbeat(body) {
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      this.lanzarErrorValidacion(
        'body',
        'La petición de heartbeat debe ser JSON.'
      );
    }

    this.validarPropiedadesPermitidas(body, CAMPOS_HEARTBEAT);

    if (body.seq == null) {
      this.lanzarErrorValidacion('seq', 'El campo seq es obligatorio.');
    }

    if (typeof body.seq !== 'number' || !Number.isInteger(body.seq) || body.seq < 0) {
      this.lanzarErrorValidacion(
        'seq',
        'El campo seq debe ser un entero mayor o igual a 0.'
      );
    }

    this.validarTexto(body.bootId, 'bootId', { minimo: 1, maximo: 120 });
    this.validarTextoOpcional(
      body.revisionConfiguracionConocida,
      'revisionConfiguracionConocida',
      { maximo: 120 }
    );
    this.validarTextoOpcional(
      body.revisionPoliticaConocida,
      'revisionPoliticaConocida',
      { maximo: 120 }
    );
    this.validarFechaOpcional(body.timestampClienteUtc, 'timestampClienteUtc');

    if (body.uptimeSeconds != null) {
      if (
        typeof body.uptimeSeconds !== 'number' ||
        !Number.isInteger(body.uptimeSeconds) ||
        body.uptimeSeconds < 0
      ) {
        this.lanzarErrorValidacion(
          'uptimeSeconds',
          'El campo uptimeSeconds debe ser un entero mayor o igual a 0.'
        );
      }
    }
  }

  validarPropiedadesPermitidas(body, permitidas) {
    const catalogo = new Set(permitidas);
    const desconocida = Object.keys(body).find((campo) => !catalogo.has(campo));

    if (desconocida) {
      this.lanzarErrorValidacion(
        `body.${desconocida}`,
        `El campo ${desconocida} no pertenece al contrato de esta petición.`
      );
    }
  }

  validarTexto(valor, campo, { minimo = 0, maximo = null } = {}) {
    if (
      typeof valor !== 'string' ||
      valor.length < minimo ||
      (maximo != null && valor.length > maximo) ||
      (minimo > 0 && !valor.trim())
    ) {
      const limite = maximo == null
        ? `al menos ${minimo}`
        : `entre ${minimo} y ${maximo}`;
      this.lanzarErrorValidacion(
        campo,
        `El campo ${campo} debe ser texto de ${limite} caracteres.`
      );
    }
  }

  validarTextoOpcional(valor, campo, limites = {}) {
    if (valor == null) return;
    this.validarTexto(valor, campo, limites);
  }

  validarFechaOpcional(valor, campo) {
    if (valor == null) return;

    if (!esFechaRfc3339Valida(valor)) {
      this.lanzarErrorValidacion(
        campo,
        `El campo ${campo} debe ser una fecha RFC 3339 válida.`
      );
    }
  }

  validarPeticionTelemetria(body) {
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      const error = new Error('La petición de telemetría debe ser un objeto JSON.');
      error.statusCode = 400;
      error.codigo = 'lote_telemetria_invalido';
      throw error;
    }

    if (!String(body.telemetriaRequestId || '').trim()) {
      this.lanzarErrorValidacion(
        'telemetriaRequestId',
        'El campo telemetriaRequestId es obligatorio.'
      );
    }

    try {
      const telemetriaRequestId = validarTelemetriaRequestId(
        body.telemetriaRequestId
      );
      const huellaLoteSha256 = calcularHuellaLoteTelemetriaSha256(body);
      crearLoteTelemetriaAgente(body);

      return {
        telemetriaRequestId,
        huellaLoteSha256
      };
    } catch (error) {
      error.statusCode = 400;
      error.codigo ||= 'lote_telemetria_invalido';
      if (error.campo && !Array.isArray(error.validation)) {
        error.validation = [{ field: error.campo, message: error.message }];
      }
      throw error;
    }
  }

  lanzarErrorValidacion(campo, mensaje) {
    const error = new Error(mensaje);
    error.statusCode = 422;
    error.codigo = 'validacion_dominio';
    error.validation = [{ field: campo, message: mensaje }];
    throw error;
  }

  extraerBearer(requisicion) {
    const cabecera = String(requisicion.get('authorization') || '').trim();
    const partes = cabecera.split(/\s+/);

    if (partes.length !== 2 || partes[0].toLowerCase() !== 'bearer') {
      return null;
    }

    return partes[1] || null;
  }

  calcularRenewBefore(ttlSegundos) {
    const ttl = Number.parseInt(String(ttlSegundos ?? ''), 10);
    return Math.max(1, Math.min(RENEW_BEFORE_SEGUNDOS, ttl || RENEW_BEFORE_SEGUNDOS));
  }

  generarRequestId() {
    return `req_${randomBytes(12).toString('hex')}`;
  }
}

function errorHttpDdns(resultado) {
  const errores = {
    sin_autoridad: [404, 'La concesión DDNS no está disponible.'],
    valor_no_interpretable: [422, 'El estado DDNS deseado no es interpretable.'],
    version_obsoleta: [409, 'La versión DDNS esperada ya no gobierna.'],
    idempotencia_conflictiva: [409, 'La solicitud DDNS ya identifica otro contenido.'],
    registro_no_operable: [409, 'El registro DDNS no admite ahora esta modificación.']
  };
  const [statusCode, message] = errores[resultado.error] || [400,
    'La petición DDNS no es válida.'];
  return Object.freeze({
    statusCode,
    codigo: resultado.error,
    message,
    currentVersion: resultado.error === 'version_obsoleta'
      ? resultado.version
      : null
  });
}

function proyectarEstadoDeseadoDdns(estado) {
  if (!estado) return null;
  return Object.freeze({ tipo: estado.tipo, modo: estado.modo, valor: estado.valor });
}

function esFechaRfc3339Valida(valor) {
  if (typeof valor !== 'string') return false;
  const coincidencia = /^(\d{4})-(\d{2})-(\d{2})[Tt](\d{2}):(\d{2}):(\d{2})(?:\.\d+)?(?:[Zz]|([+-])(\d{2}):(\d{2}))$/u.exec(valor);
  if (!coincidencia) return false;

  const [, anio, mes, dia, hora, minuto, segundo, , horaOffset, minutoOffset] =
    coincidencia;
  const componentes = [anio, mes, dia, hora, minuto, segundo].map(Number);
  const [anioNumero, mesNumero, diaNumero, horaNumero, minutoNumero, segundoNumero] =
    componentes;
  const calendario = new Date(Date.UTC(anioNumero, mesNumero - 1, diaNumero));
  const fechaCalendarioValida =
    calendario.getUTCFullYear() === anioNumero &&
    calendario.getUTCMonth() === mesNumero - 1 &&
    calendario.getUTCDate() === diaNumero;
  const horaValida =
    horaNumero <= 23 && minutoNumero <= 59 && segundoNumero <= 59;
  const offsetValido =
    horaOffset == null || (Number(horaOffset) <= 23 && Number(minutoOffset) <= 59);

  return fechaCalendarioValida && horaValida && offsetValido &&
    Number.isFinite(Date.parse(valor));
}

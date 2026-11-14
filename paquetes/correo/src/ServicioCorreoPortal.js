import crypto from 'node:crypto';
import { ConfiguracionCorreo } from './ConfiguracionCorreo.js';
import { construirContenidoVerificacionEmailPerfil }
  from './ContenidoVerificacionEmailPerfil.js';
import { normalizarNombrePresentacionCorreo } from './NormalizadorBuzonCorreo.js';

export class ServicioCorreoPortal {
  constructor({
    servicioConfiguracionPortal,
    validadorConfiguracionCorreo,
    repositorioColaCorreo,
    bloqueadorEnvioCorreoRedis,
    clienteSmtp,
    evaluadorAutoridadCorreoSql = null,
    fronteraTransaccional = null
  }) {
    this.servicioConfiguracionPortal = servicioConfiguracionPortal;
    this.validadorConfiguracionCorreo = validadorConfiguracionCorreo;
    this.repositorioColaCorreo = repositorioColaCorreo;
    this.bloqueadorEnvioCorreoRedis = bloqueadorEnvioCorreoRedis;
    this.clienteSmtp = clienteSmtp;
    this.evaluadorAutoridadCorreoSql = evaluadorAutoridadCorreoSql;
    this.fronteraTransaccional = fronteraTransaccional;
    this.identificadorInstancia = crypto.randomUUID();
  }

  obtenerConfiguracionCorreoActual() {
    return new ConfiguracionCorreo(
      this.servicioConfiguracionPortal
        .obtenerConfiguracionActual()
        .obtenerConfiguracionCorreo()
    );
  }

  obtenerEstadoConfiguracion() {
    return this.validadorConfiguracionCorreo.evaluar(
      this.obtenerConfiguracionCorreoActual()
    );
  }

  async obtenerEstadoConfiguracionAutoritativo() {
    await this.servicioConfiguracionPortal.asegurarActualizada?.();
    const despliegue = this.servicioConfiguracionPortal
      .obtenerEstadoDespliegueCorreoActual?.();
    const smtpAutoritativo =
      Number(despliegue?.verificacion_smtp_autoritativa) === 1 &&
      Number(despliegue?.guard_verificacion_legacy_activo) === 1;
    if (!smtpAutoritativo) return this.obtenerEstadoConfiguracion();
    if (typeof this.evaluadorAutoridadCorreoSql?.evaluarEnTransaccion !== 'function' ||
        typeof this.fronteraTransaccional?.ejecutar !== 'function') {
      throw new Error('La proyección smtp@1 requiere su autoridad SQL completa.');
    }
    const autoridad = await this.fronteraTransaccional.ejecutar((conexion) =>
      this.evaluadorAutoridadCorreoSql.evaluarEnTransaccion({ conexion }));
    return proyectarEstadoAutoritativo(autoridad);
  }

  async encolarCorreoPrueba({
    destinatarioEmail,
    destinatarioNombre,
    asunto,
    cuerpoTexto,
    creadoPorUsuarioId
  }) {
    await this.servicioConfiguracionPortal.asegurarActualizada?.();
    const configuracionCorreo = this.obtenerConfiguracionCorreoActual();
    const despliegue = this.servicioConfiguracionPortal
      .obtenerEstadoDespliegueCorreoActual?.();
    const usaAutoridadSql = Number(despliegue?.cola_sql_autoritativa) === 1;
    if (!usaAutoridadSql &&
        Number(despliegue?.verificacion_smtp_autoritativa) === 1) {
      throw new Error('La cola de correo todavía no está preparada para pruebas.');
    }

    let destinatarioCanonico;
    try {
      destinatarioCanonico =
        this.validadorConfiguracionCorreo.normalizarCorreo(destinatarioEmail);
    } catch {
      throw new Error('El destinatario debe ser un correo válido.');
    }

    if (!String(asunto || '').trim()) {
      throw new Error('Debes indicar un asunto.');
    }

    if (!String(cuerpoTexto || '').trim()) {
      throw new Error('Debes indicar un cuerpo de mensaje.');
    }

    if (usaAutoridadSql) {
      return this.fronteraTransaccional.ejecutar(async (conexion) => {
        const autoridad = await this.evaluadorAutoridadCorreoSql
          .evaluarEnTransaccion({ conexion });
        if (!autoridad.puedeDespachar) {
          throw new Error(`El correo de prueba no puede enviarse: ${autoridad.codigo}.`);
        }
        return this.repositorioColaCorreo.crearPruebaEnTransaccion({
          destinatarioEmail: destinatarioCanonico,
          destinatarioNombre: normalizarNombrePresentacionCorreo(
            String(destinatarioNombre || '')
          ),
          asunto: String(asunto).trim(),
          cuerpoTexto: String(cuerpoTexto).trim(),
          creadoPorUsuarioId
        }, { conexion });
      });
    }
    const estado = this.validadorConfiguracionCorreo.evaluar(configuracionCorreo);
    if (!estado.puedeDespachar) {
      throw new Error(
        `La configuración de correo no está lista para operar. ${estado.errores.join(' ')}`
      );
    }
    return this.repositorioColaCorreo.crearPendienteLegacy({
      destinatarioEmail: destinatarioCanonico,
      destinatarioNombre: normalizarNombrePresentacionCorreo(
        String(destinatarioNombre || '')
      ),
      remitenteEmail: estado.remitenteEmailCanonico,
      remitenteNombre: configuracionCorreo.remitenteNombre,
      asunto: String(asunto).trim(),
      cuerpoTexto: String(cuerpoTexto).trim(),
      creadoPorUsuarioId
    });
  }

  async enviarCorreoVerificacionOperativa({
    destinatarioEmail,
    destinatarioNombre,
    enlaceVerificacion,
    ttlMinutos
  }) {
    const configuracionCorreo = this.obtenerConfiguracionCorreoActual();
    const estado = this.validadorConfiguracionCorreo.evaluar(configuracionCorreo);

    if (!estado.configurado) {
      throw new Error(
        `La configuración de correo no está lista para probar. ${estado.errores.join(' ')}`
      );
    }

    const destinatarioCanonico =
      this.validadorConfiguracionCorreo.normalizarCorreo(destinatarioEmail);

    return this.clienteSmtp.enviar(configuracionCorreo, {
      destinatarioEmail: destinatarioCanonico,
      destinatarioNombre: normalizarNombrePresentacionCorreo(
        String(destinatarioNombre || '')
      ),
      remitenteEmail: estado.remitenteEmailCanonico,
      remitenteNombre: configuracionCorreo.remitenteNombre,
      asunto: 'Verificación de correo operativo en Sentinelia',
      cuerpoTexto: [
        'Se ha solicitado verificar la configuración de correo de Sentinelia.',
        '',
        'Para confirmar que esta configuración funciona, abre este enlace con tu sesión activa:',
        enlaceVerificacion,
        '',
        `El enlace caduca en ${ttlMinutos} minutos.`,
        '',
        'Si no has iniciado esta prueba desde Configuración, ignora este mensaje.'
      ].join('\n')
    });
  }

  async enviarCorreoVerificacionEmailPerfil({
    destinatarioEmail,
    destinatarioNombre,
    enlaceVerificacion,
    ttlMinutos,
    esValidacionEmailActual = false
  }) {
    const configuracionCorreo = this.obtenerConfiguracionCorreoActual();
    const estado = this.validadorConfiguracionCorreo.evaluar(configuracionCorreo);

    if (!estado.puedeDespachar) {
      throw new Error(
        `El correo del portal no está operativo. ${estado.errores.join(' ')}`
      );
    }

    const destinatarioCanonico =
      this.validadorConfiguracionCorreo.normalizarCorreo(destinatarioEmail);

    const contenido = construirContenidoVerificacionEmailPerfil({
      nombrePortal: 'Sentinelia',
      enlace: enlaceVerificacion,
      ttlMinutos,
      emailOrigen: esValidacionEmailActual ? destinatarioCanonico : null,
      emailCandidato: destinatarioCanonico
    });

    return this.clienteSmtp.enviar(configuracionCorreo, {
      destinatarioEmail: destinatarioCanonico,
      destinatarioNombre: normalizarNombrePresentacionCorreo(
        String(destinatarioNombre || '')
      ),
      remitenteEmail: estado.remitenteEmailCanonico,
      remitenteNombre: configuracionCorreo.remitenteNombre,
      asunto: contenido.asunto,
      cuerpoTexto: contenido.cuerpoTexto
    });
  }

  async listarSalidasRecientes(limit = 20) {
    const salidas = await this.repositorioColaCorreo.listarRecientes(limit);
    return salidas.map((salida) => salida.serializarResumen());
  }

  async resumirBacklogDetenido() {
    if (typeof this.repositorioColaCorreo?.resumirBacklogDetenido !== 'function') {
      throw new Error('El repositorio de correo no puede resumir el backlog detenido.');
    }
    return this.repositorioColaCorreo.resumirBacklogDetenido();
  }

  async reclamarSiguientePendiente() {
    const configuracionCorreo = this.obtenerConfiguracionCorreoActual();
    const candidatos = await this.repositorioColaCorreo.listarReclamablesLegacy(10);

    for (const candidato of candidatos) {
      const bloqueado =
        await this.bloqueadorEnvioCorreoRedis.intentarBloquear({
          idCorreo: candidato.id,
          ttlSegundos: configuracionCorreo.bloqueoTtlSegundos,
          identificadorInstancia: this.identificadorInstancia
        });

      if (bloqueado) {
        return {
          reclamado: true,
          correo: candidato.serializarResumen(),
          identificadorInstancia: this.identificadorInstancia
        };
      }
    }

    return {
      reclamado: false,
      correo: null,
      identificadorInstancia: this.identificadorInstancia
    };
  }

  async despacharSiguientePendiente() {
    const configuracionCorreo = this.obtenerConfiguracionCorreoActual();
    const estado = this.validadorConfiguracionCorreo.evaluar(configuracionCorreo);

    if (!estado.puedeDespachar) {
      throw new Error(
        `La configuración de correo no está lista para enviar. ${estado.errores.join(' ')}`
      );
    }

    return this.despacharSiguientePendienteConAutoridad();
  }

  async despacharSiguientePendienteConAutoridad() {
    const configuracionCorreo = this.obtenerConfiguracionCorreoActual();

    const reclamacion = await this.reclamarSiguientePendiente();

    if (!reclamacion.reclamado) {
      return {
        despachado: false,
        correo: null,
        mensaje: 'No había correos pendientes reclamables.'
      };
    }

    const correoPendiente = await this.repositorioColaCorreo.buscarPorId(
      reclamacion.correo.id
    );

    try {
      const resultado = await this.clienteSmtp.enviar(
        configuracionCorreo,
        correoPendiente
      );

      await this.repositorioColaCorreo.registrarEnvioExitoso({
        idCorreo: correoPendiente.id,
        mensajeId: resultado.messageId,
        respuestaProveedor: resultado.response
      });

      return {
        despachado: true,
        correo: {
          ...correoPendiente.serializarResumen(),
          estado: 'enviado'
        },
        mensajeId: resultado.messageId,
        respuestaProveedor: resultado.response
      };
    } catch (error) {
      const errorNormalizado = this.normalizarErrorEnvio(error);
      const reintentar = this.debeReintentar({
        correoPendiente,
        configuracionCorreo,
        error: errorNormalizado
      });

      if (reintentar) {
        const proximoIntentoEn = this.calcularProximoIntento({
          correoPendiente,
          configuracionCorreo
        });
        await this.repositorioColaCorreo.registrarErrorReintentable({
          idCorreo: correoPendiente.id,
          error: errorNormalizado.mensaje,
          proximoIntentoEn
        });

        return {
          despachado: false,
          correo: {
            ...correoPendiente.serializarResumen(),
            estado: 'error_reintentable'
          },
          reintentable: true,
          mensaje: errorNormalizado.mensaje,
          proximoIntentoEn
        };
      }

      await this.repositorioColaCorreo.registrarErrorFinal({
        idCorreo: correoPendiente.id,
        error: errorNormalizado.mensaje
      });

      return {
        despachado: false,
        correo: {
          ...correoPendiente.serializarResumen(),
          estado: 'error_final'
        },
        reintentable: false,
        mensaje: errorNormalizado.mensaje
      };
    } finally {
      await this.bloqueadorEnvioCorreoRedis.liberar(correoPendiente.id);
    }
  }

  normalizarErrorEnvio(error) {
    return {
      mensaje: String(error?.message || 'Error desconocido de envío SMTP.'),
      codigo: String(error?.code || ''),
      respuestaCodigo: Number(error?.responseCode || 0)
    };
  }

  debeReintentar({ correoPendiente, configuracionCorreo, error }) {
    if (correoPendiente.intentos >= configuracionCorreo.maxReintentos) {
      return false;
    }

    if (error.respuestaCodigo >= 500) {
      return false;
    }

    return true;
  }

  calcularProximoIntento({ correoPendiente, configuracionCorreo }) {
    const segundosEspera =
      configuracionCorreo.reintentoBaseSegundos *
      Math.max(1, correoPendiente.intentos + 1);
    const proximoIntento = new Date(Date.now() + (segundosEspera * 1000));

    return this.formatearFechaMysqlUtc(proximoIntento);
  }

  formatearFechaMysqlUtc(fecha) {
    const valor = fecha instanceof Date ? fecha : new Date(fecha);

    if (Number.isNaN(valor.getTime())) {
      throw new Error('No se pudo calcular una fecha UTC válida para el próximo intento.');
    }

    return valor.toISOString().slice(0, 19).replace('T', ' ');
  }
}

function proyectarEstadoAutoritativo(autoridad) {
  const avisoNoVerificado =
    'La configuración de correo aún no tiene prueba empírica vigente.';
  const operativo = autoridad?.puedeDespachar === true;
  const advertencias = [...(autoridad?.advertencias || [])]
    .filter((aviso) => !operativo || aviso !== avisoNoVerificado);
  return {
    activa: Boolean(autoridad?.configuracion?.activo),
    valida: (autoridad?.errores || []).length === 0,
    configurado: autoridad?.configurado === true,
    operativo,
    operativoVerificado: operativo,
    puedeDespachar: operativo,
    remitenteEmailCanonico: autoridad?.remitenteEmailCanonico || null,
    errores: [...(autoridad?.errores || [])],
    advertencias,
    perfil: autoridad?.perfil || 'smtp@1',
    codigo: autoridad?.codigo || 'correo_estado_smtp_desconocido'
  };
}

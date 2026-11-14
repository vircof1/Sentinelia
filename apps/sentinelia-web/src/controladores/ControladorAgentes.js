import { normalizarRetornoGestionAgente } from './normalizarRetornoGestionAgente.js';

export class ControladorAgentes {
  constructor({
    servicioAdministracionAgentesPortal,
    servicioAutorizacion,
    servicioAplicacionDdnsAgentes = null,
    eliminacionAdministrativaAgentesHttpHabilitada = false
  }) {
    this.servicioAdministracionAgentesPortal =
      servicioAdministracionAgentesPortal;
    this.servicioAutorizacion = servicioAutorizacion;
    this.servicioAplicacionDdnsAgentes = servicioAplicacionDdnsAgentes;
    this.eliminacionAdministrativaAgentesHttpHabilitada =
      eliminacionAdministrativaAgentesHttpHabilitada === true;
  }

  async mostrarListado(requisicion, respuesta, next) {
    try {
      const vista =
        await this.servicioAdministracionAgentesPortal.construirVistaListadoShell(
          requisicion.contextoUsuarioActual,
          requisicion.query
        );

      respuesta.render('portal/agentes', {
        titulo: 'Agentes',
        usuarioActual: requisicion.session?.usuarioAutenticado ?? null,
        flashAgentes: this.consumirFlash(requisicion),
        ...vista,
        puedeEliminarAgentes: this.#puedeEliminar(requisicion)
      });
    } catch (error) {
      next(error);
    }
  }

  async mostrarContratoOpenApi(requisicion, respuesta, next) {
    try {
      respuesta.render('portal/agentes-openapi', {
        titulo: 'Swagger OpenAPI de agentes',
        usuarioActual: requisicion.session?.usuarioAutenticado ?? null
      });
    } catch (error) {
      next(error);
    }
  }

  async apiListarAgentes(requisicion, respuesta, next) {
    try {
      const vista =
        await this.servicioAdministracionAgentesPortal.listarAgentesAdministracion(
          requisicion.contextoUsuarioActual,
          requisicion.query
        );

      respuesta.json({
        ok: true,
        ...vista,
        puedeEliminarAgentes: this.#puedeEliminar(requisicion)
      });
    } catch (error) {
      next(error);
    }
  }

  #puedeEliminar(requisicion) {
    return this.eliminacionAdministrativaAgentesHttpHabilitada &&
      this.servicioAutorizacion?.puedeEliminarAgentes?.(
        requisicion.contextoUsuarioActual
      ) === true;
  }

  async mostrarTelemetria(requisicion, respuesta, next) {
    try {
      const idAgente = this.normalizarId(requisicion.params.id);
      const vista =
        await this.servicioAdministracionAgentesPortal.construirVistaTelemetria(
          requisicion.contextoUsuarioActual,
          idAgente,
          requisicion.query
        );

      respuesta.render('portal/agente-telemetria', {
        titulo: `Telemetría · ${vista.agente.nombre}`,
        usuarioActual: requisicion.session?.usuarioAutenticado ?? null,
        retornoGestionAgente: normalizarRetornoGestionAgente(
          requisicion.query.return_to,
          idAgente
        ),
        ...vista
      });
    } catch (error) {
      next(error);
    }
  }

  async apiHistoricoTelemetria(requisicion, respuesta, next) {
    try {
      const idAgente = this.normalizarId(requisicion.params.id);
      const historico =
        await this.servicioAdministracionAgentesPortal
          .consultarHistoricoTelemetria(
            requisicion.contextoUsuarioActual,
            idAgente,
            requisicion.query
          );

      respuesta.json({
        ok: true,
        ...historico
      });
    } catch (error) {
      next(error);
    }
  }

  async apiMiniaturaTelemetria(requisicion, respuesta, next) {
    try {
      const idAgente = this.normalizarId(requisicion.params.id);
      const miniatura = await this.servicioAdministracionAgentesPortal
        .consultarMiniaturaTelemetria(
          requisicion.contextoUsuarioActual,
          idAgente,
          requisicion.query
        );

      respuesta.json({ ok: true, miniatura });
    } catch (error) {
      next(error);
    }
  }

  async servirContratoOpenApiYaml(_requisicion, respuesta, next) {
    try {
      const yaml = await this.servicioAdministracionAgentesPortal
        .leerContratoOpenApiYaml();

      respuesta
        .type('application/yaml')
        .set('Cache-Control', 'no-store')
        .send(yaml);
    } catch (error) {
      next(error);
    }
  }

  async mostrarNuevo(requisicion, respuesta, next) {
    await this.renderizarFormulario(requisicion, respuesta, next, {
      titulo: 'Nuevo agente'
    });
  }

  async mostrarEditar(requisicion, respuesta, next) {
    const idAgente = this.normalizarId(requisicion.params.id);

    await this.renderizarFormulario(requisicion, respuesta, next, {
      titulo: 'Gestionar agente',
      idAgente
    });
  }

  async crearConcesionDdns(requisicion, respuesta, next) {
    const agenteId = this.normalizarId(requisicion.params.id);
    try {
      const concesion = await this.servicioAplicacionDdnsAgentes.crearConcesion({
        contextoUsuarioActual: requisicion.contextoUsuarioActual,
        agenteId,
        registroDnsId: requisicion.body.registro_dns_id
      });
      this.guardarFlash(requisicion, {
        tipo: 'exito',
        mensaje: `Concesión DDNS ${concesion.concesionId} creada.`
      });
      respuesta.redirect(`/agentes/${agenteId}/editar`);
    } catch (error) {
      if (error?.codigo === 'registro_ya_concedido') {
        this.guardarFlash(requisicion, {
          tipo: 'advertencia',
          mensaje: 'El registro ya posee una concesión DDNS vigente.'
        });
        respuesta.redirect(`/agentes/${agenteId}/editar`);
        return;
      }
      next(error);
    }
  }

  async revocarConcesionDdns(requisicion, respuesta, next) {
    const agenteId = this.normalizarId(requisicion.params.id);
    try {
      const resultado = await this.servicioAplicacionDdnsAgentes
        .revocarDesdeAgente({
          contextoUsuarioActual: requisicion.contextoUsuarioActual,
          agenteId,
          concesionId: requisicion.params.concesionId
        });
      this.guardarFlash(requisicion, {
        tipo: resultado.efectuada ? 'exito' : 'informacion',
        mensaje: resultado.efectuada
          ? 'Concesión DDNS revocada desde el agente.'
          : 'La concesión DDNS ya estaba revocada.'
      });
      respuesta.redirect(`/agentes/${agenteId}/editar`);
    } catch (error) {
      next(error);
    }
  }

  async crearAgente(requisicion, respuesta, next) {
    try {
      const resultado =
        await this.servicioAdministracionAgentesPortal.crearAgente(
          requisicion.contextoUsuarioActual,
          requisicion.body
        );

      this.guardarFlash(requisicion, {
        tipo: 'exito',
        mensaje: `Agente ${resultado.agente.nombre} provisionado.`,
        credenciales: resultado.credenciales
      });
      respuesta.redirect('/agentes');
    } catch (error) {
      await this.renderizarFormulario(requisicion, respuesta, next, {
        titulo: 'Nuevo agente',
        formularioBase: {
          nombre: requisicion.body?.nombre || '',
          descripcion: requisicion.body?.descripcion || '',
          sitioId: requisicion.body?.sitio_id || ''
        },
        errorFormulario: error.message,
        statusCode: 400
      });
    }
  }

  async actualizarAgente(requisicion, respuesta, next) {
    const idAgente = this.normalizarId(requisicion.params.id);
    const retornoAgente = this.normalizarRetornoAgente(requisicion.body?.return_to);

    try {
      const agente =
        await this.servicioAdministracionAgentesPortal.actualizarAgente(
          requisicion.contextoUsuarioActual,
          idAgente,
          requisicion.body
        );

      if (retornoAgente === '/agentes' || retornoAgente.startsWith('/agentes?')) {
        this.guardarFlash(requisicion, {
          tipo: 'exito',
          mensaje: `Agente ${agente.nombre} actualizado.`
        });
      }
      respuesta.redirect(retornoAgente);
    } catch (error) {
      await this.renderizarFormulario(requisicion, respuesta, next, {
        titulo: 'Gestionar agente',
        idAgente,
        formularioBase: {
          nombre: requisicion.body?.nombre || '',
          descripcion: requisicion.body?.descripcion || '',
          sitioId: requisicion.body?.sitio_id || ''
        },
        errorFormulario: error.message,
        statusCode: 400
      });
    }
  }

  async rotarSecreto(requisicion, respuesta, next) {
    try {
      const idAgente = this.normalizarId(requisicion.params.id);
      const resultado =
        await this.servicioAdministracionAgentesPortal.rotarSecreto(
          requisicion.contextoUsuarioActual,
          idAgente
        );

      this.guardarFlash(requisicion, {
        tipo: 'exito',
        mensaje: `Secreto del agente ${resultado.agente.nombre} rotado.`,
        credenciales: resultado.credenciales
      });
      respuesta.redirect('/agentes');
    } catch (error) {
      next(error);
    }
  }

  async deshabilitarAgente(requisicion, respuesta, next) {
    try {
      const idAgente = this.normalizarId(requisicion.params.id);
      const agente =
        await this.servicioAdministracionAgentesPortal.deshabilitarAgente(
          requisicion.contextoUsuarioActual,
          idAgente
        );

      this.guardarFlash(requisicion, {
        tipo: 'exito',
        mensaje: `Agente ${agente.nombre} deshabilitado.`
      });
      respuesta.redirect('/agentes');
    } catch (error) {
      next(error);
    }
  }

  async habilitarAgente(requisicion, respuesta, next) {
    try {
      const idAgente = this.normalizarId(requisicion.params.id);
      const agente =
        await this.servicioAdministracionAgentesPortal.habilitarAgente(
          requisicion.contextoUsuarioActual,
          idAgente
        );

      this.guardarFlash(requisicion, {
        tipo: 'exito',
        mensaje: `Agente ${agente.nombre} habilitado.`
      });
      respuesta.redirect('/agentes');
    } catch (error) {
      next(error);
    }
  }

  async solicitarPerfilServidor(requisicion, respuesta, next) {
    const idAgente = this.normalizarId(requisicion.params.id);

    try {
      const resultado = await this.servicioAdministracionAgentesPortal
        .solicitarPerfilServidor(
          requisicion.contextoUsuarioActual,
          idAgente,
          requisicion.body
        );

      this.guardarFlash(requisicion, {
        tipo: 'exito',
        mensaje:
          `Perfil servidor solicitado para ${resultado.agente.nombre}; ` +
          `generación #${resultado.perfil.generacion} pendiente de evidencia nueva.`
      });
      respuesta.redirect('/agentes');
    } catch (error) {
      await this.renderizarFormulario(requisicion, respuesta, next, {
        titulo: 'Editar agente',
        idAgente,
        perfilServidorBase: {
          histeresisSinPolSegundos:
            requisicion.body?.histeresis_sin_pol_segundos || '',
          duracionReinicioRecienteSegundos:
            requisicion.body?.duracion_reinicio_reciente_segundos || ''
        },
        errorFormulario: error.message,
        statusCode: 400
      });
    }
  }

  async actualizarConfiguracionPerfilServidor(
    requisicion,
    respuesta,
    next
  ) {
    const idAgente = this.normalizarId(requisicion.params.id);
    try {
      const resultado = await this.servicioAdministracionAgentesPortal
        .actualizarConfiguracionPerfilServidor(
          requisicion.contextoUsuarioActual,
          idAgente,
          requisicion.body
        );
      this.guardarFlash(requisicion, {
        tipo: 'exito',
        mensaje:
          `Configuración de la generación #${resultado.perfil.generacion} ` +
          'actualizada; los ciclos ya abiertos conservan sus tiempos capturados.'
      });
      respuesta.redirect(`/agentes/${idAgente}/editar`);
    } catch (error) {
      await this.renderizarFormulario(requisicion, respuesta, next, {
        titulo: 'Editar agente',
        idAgente,
        perfilServidorBase: {
          histeresisSinPolSegundos:
            requisicion.body?.histeresis_sin_pol_segundos || '',
          duracionReinicioRecienteSegundos:
            requisicion.body?.duracion_reinicio_reciente_segundos || ''
        },
        errorFormulario: error.message,
        statusCode: 400
      });
    }
  }

  async retirarPerfilServidor(requisicion, respuesta, next) {
    const idAgente = this.normalizarId(requisicion.params.id);
    try {
      const resultado = await this.servicioAdministracionAgentesPortal
        .retirarPerfilServidor(
          requisicion.contextoUsuarioActual,
          idAgente,
          requisicion.body
        );
      this.guardarFlash(requisicion, {
        tipo: 'exito',
        mensaje:
          `Perfil servidor retirado de ${resultado.agente.nombre}; ` +
          'el agente continúa provisionado como genérico.'
      });
      respuesta.redirect(`/agentes/${idAgente}/editar`);
    } catch (error) {
      await this.renderizarFormulario(requisicion, respuesta, next, {
        titulo: 'Editar agente',
        idAgente,
        errorFormulario: error.message,
        statusCode: 400
      });
    }
  }

  async renderizarFormulario(
    requisicion,
    respuesta,
    next,
    {
      titulo,
      idAgente = null,
      formularioBase = null,
      perfilServidorBase = null,
      errorFormulario = null,
      statusCode = 200
    }
  ) {
    try {
      const vista =
        await this.servicioAdministracionAgentesPortal.construirVistaFormulario(
          requisicion.contextoUsuarioActual,
          { idAgente }
        );

      respuesta.status(statusCode).render('portal/agente-formulario', {
        titulo,
        usuarioActual: requisicion.session?.usuarioAutenticado ?? null,
        flashAgentes: this.consumirFlash(requisicion),
        errorFormulario,
        retornoAgente: idAgente
          ? this.normalizarRetornoAgente(
            requisicion.body?.return_to || requisicion.query?.return_to
          )
          : '/agentes',
        ...vista,
        formulario: {
          ...vista.formulario,
          ...(formularioBase || {})
        },
        perfilServidorFormulario: {
          ...(vista.perfilServidor?.configuracionSugerida || {}),
          ...(perfilServidorBase || {})
        }
      });
    } catch (error) {
      next(error);
    }
  }

  normalizarId(valor) {
    const id = Number.parseInt(String(valor || ''), 10);

    if (!Number.isInteger(id) || id <= 0) {
      throw new Error('El agente solicitado no es válido.');
    }

    return id;
  }

  normalizarRetornoAgente(valor) {
    if (typeof valor !== 'string') return '/agentes';
    const retorno = valor.trim();
    if (!/^\/(?:agentes|monitores)(?:\/|\?|#|$)/u.test(retorno) ||
        retorno.startsWith('//') || /[\\\r\n]/u.test(retorno)) {
      return '/agentes';
    }
    const url = new URL(retorno, 'http://sentinelia.local');
    return url.origin === 'http://sentinelia.local'
      ? `${url.pathname}${url.search}${url.hash}`
      : '/agentes';
  }

  guardarFlash(requisicion, flash) {
    requisicion.session.flashAgentes = flash;
  }

  consumirFlash(requisicion) {
    const flash = requisicion.session.flashAgentes || null;
    delete requisicion.session.flashAgentes;
    return flash;
  }
}

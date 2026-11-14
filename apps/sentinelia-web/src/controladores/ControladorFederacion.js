import { mensajeErrorOperacionFederacion }
  from '../../../../paquetes/federacion/adaptadores/FronteraTransaccionalFederacion.js';

export class ControladorFederacion {
  constructor({ servicioAdministracionFederacion, servicioExploradorDatosRemotos = null,
    servicioOrganizacionRemota = null,
    servicioMonitoresRemotos = null,
    servicioTriggersRemotos = null,
    servicioTelemetriaRemota = null,
    servicioAlertasRemotasPortal = null,
    servicioAvisosFederadosRemotos = null,
    servicioAuditoriaRemota = null,
    servicioDiagnosticoFederacion = null, servicioBorradoresFederacion = null,
    servicioReconstruccionesFederacion = null } = {}) {
    if (typeof servicioAdministracionFederacion?.obtenerPanel !== 'function') {
      throw new Error('ControladorFederacion requiere administración federada.');
    }
    this.servicio = servicioAdministracionFederacion;
    this.servicioExploradorDatosRemotos = servicioExploradorDatosRemotos;
    this.servicioOrganizacionRemota = servicioOrganizacionRemota;
    this.servicioMonitoresRemotos = servicioMonitoresRemotos;
    this.servicioTriggersRemotos = servicioTriggersRemotos;
    this.servicioTelemetriaRemota = servicioTelemetriaRemota;
    this.servicioAlertasRemotasPortal = servicioAlertasRemotasPortal;
    this.servicioAvisosFederadosRemotos = servicioAvisosFederadosRemotos;
    this.servicioAuditoriaRemota = servicioAuditoriaRemota;
    this.servicioDiagnosticoFederacion = servicioDiagnosticoFederacion;
    this.servicioBorradoresFederacion = servicioBorradoresFederacion;
    this.servicioReconstruccionesFederacion = servicioReconstruccionesFederacion;
  }

  async mostrar(requisicion, respuesta, next) {
    try {
      await this.#renderizar(requisicion, respuesta);
    } catch (error) {
      next(error);
    }
  }

  async mostrarDatosRemotos(requisicion, respuesta, next) {
    try {
      if (typeof this.servicioExploradorDatosRemotos?.obtener !== 'function') {
        throw new Error('El explorador de datos remotos no está disponible.');
      }
      const navegacionRemota = resolverNavegacionRemota(requisicion.query);
      const explorador = await this.servicioExploradorDatosRemotos.obtener(
        requisicion.contextoUsuarioActual,
        {
          familia: navegacionRemota.familia,
          installationOrigenId: requisicion.query.procedencia,
          proyeccionId: requisicion.query.proyeccion,
          pagina: requisicion.query.pagina,
          limite: requisicion.query.limite ?? 100
        }
      );
      if (
        navegacionRemota.vista === 'organizacion' &&
        typeof this.servicioOrganizacionRemota?.obtener !== 'function'
      ) {
        throw new Error('La vista de organización remota no está disponible.');
      }
      const organizacionRemota = navegacionRemota.vista === 'organizacion'
        ? await this.servicioOrganizacionRemota.obtener(
          requisicion.contextoUsuarioActual,
          { installationOrigenId: navegacionRemota.installationOrigenId }
        )
        : null;
      if (
        navegacionRemota.vista === 'monitores' &&
        typeof this.servicioMonitoresRemotos?.obtener !== 'function'
      ) {
        throw new Error('La vista de monitores remotos no está disponible.');
      }
      const monitoresRemotos = navegacionRemota.vista === 'monitores'
        ? await this.servicioMonitoresRemotos.obtener(
          requisicion.contextoUsuarioActual,
          {
            installationOrigenId: navegacionRemota.installationOrigenId,
            monitorOrigenId: navegacionRemota.monitorOrigenId,
            vista: navegacionRemota.subvista
          }
        )
        : null;
      if (
        navegacionRemota.vista === 'triggers' &&
        typeof this.servicioTriggersRemotos?.obtener !== 'function'
      ) {
        throw new Error('La vista de triggers remotos no está disponible.');
      }
      const triggersRemotos = navegacionRemota.vista === 'triggers'
        ? await this.servicioTriggersRemotos.obtener(
          requisicion.contextoUsuarioActual,
          {
            installationOrigenId: navegacionRemota.installationOrigenId,
            triggerOrigenId: navegacionRemota.triggerOrigenId,
            vista: navegacionRemota.subvista
          }
        )
        : null;
      if (
        navegacionRemota.vista === 'agentes' &&
        typeof this.servicioTelemetriaRemota?.obtener !== 'function'
      ) {
        throw new Error('La vista de telemetría remota no está disponible.');
      }
      const telemetriaRemota = navegacionRemota.vista === 'agentes'
        ? await this.servicioTelemetriaRemota.obtener(
          requisicion.contextoUsuarioActual,
          {
            installationOrigenId: navegacionRemota.installationOrigenId,
            vista: navegacionRemota.subvista,
            senalOrigenId: requisicion.query.senal,
            desdeUtc: requisicion.query.desdeUtc,
            hastaUtc: requisicion.query.hastaUtc,
            limite: requisicion.query.limiteActividad
          }
        )
        : null;
      if (
        navegacionRemota.vista === 'alertas' &&
        typeof this.servicioAlertasRemotasPortal?.consultar !== 'function'
      ) {
        throw new Error('La vista de alertas remotas no está disponible.');
      }
      const alertasRemotas = navegacionRemota.vista === 'alertas'
        ? await this.servicioAlertasRemotasPortal.consultar(
          requisicion.contextoUsuarioActual,
          {
            installationOrigenId: navegacionRemota.installationOrigenId,
            incluirCerradas: true
          }
        )
        : null;
      if (
        navegacionRemota.vista === 'avisos' &&
        typeof this.servicioAvisosFederadosRemotos?.obtener !== 'function'
      ) {
        throw new Error('La vista de avisos remotos no está disponible.');
      }
      const avisosFederadosRemotos = navegacionRemota.vista === 'avisos'
        ? await this.servicioAvisosFederadosRemotos.obtener(
          requisicion.contextoUsuarioActual,
          {
            installationOrigenId: navegacionRemota.installationOrigenId,
            vista: navegacionRemota.subvista,
            desdeUtc: requisicion.query.desdeUtc,
            hastaUtc: requisicion.query.hastaUtc
          }
        )
        : null;
      if (
        navegacionRemota.vista === 'auditoria' &&
        typeof this.servicioAuditoriaRemota?.obtener !== 'function'
      ) {
        throw new Error('La vista de auditoría remota no está disponible.');
      }
      const auditoriaRemota = navegacionRemota.vista === 'auditoria'
        ? await this.servicioAuditoriaRemota.obtener(
          requisicion.contextoUsuarioActual,
          {
            installationOrigenId: navegacionRemota.installationOrigenId,
            vista: navegacionRemota.subvista,
            resultadoValidacion: requisicion.query.resultado,
            claveCadenaOrigen: requisicion.query.cadena,
            desdeUtc: requisicion.query.desdeUtc,
            hastaUtc: requisicion.query.hastaUtc,
            limite: requisicion.query.limiteActividad
          }
        )
        : null;
      respuesta.set('Cache-Control', 'private, no-store');
      respuesta.render('portal/federacion-datos-remotos', {
        titulo: 'Datos remotos federados',
        usuarioActual: requisicion.session?.usuarioAutenticado ?? null,
        explorador,
        organizacionRemota,
        monitoresRemotos,
        triggersRemotos,
        telemetriaRemota,
        alertasRemotas,
        avisosFederadosRemotos,
        auditoriaRemota,
        navegacionRemota,
        errorFiltros: null,
        flashFederacion: this.#consumirFlash(requisicion)
      });
    } catch (error) {
      if (error?.statusCode === 403) {
        respuesta.status(403).render('portal/forbidden', {
          titulo: 'Acceso denegado',
          permisoSolicitado: 'explorar_datos_remotos_federacion',
          usuarioActual: requisicion.session?.usuarioAutenticado ?? null
        });
        return;
      }
      if (error?.statusCode === 400) {
        try {
          const explorador = await this.servicioExploradorDatosRemotos.obtener(
            requisicion.contextoUsuarioActual,
            {}
          );
          respuesta.set('Cache-Control', 'private, no-store');
          respuesta.status(400).render('portal/federacion-datos-remotos', {
            titulo: 'Datos remotos federados',
            usuarioActual: requisicion.session?.usuarioAutenticado ?? null,
            explorador,
            organizacionRemota: null,
            monitoresRemotos: null,
            triggersRemotos: null,
            telemetriaRemota: null,
            alertasRemotas: null,
            avisosFederadosRemotos: null,
            auditoriaRemota: null,
            navegacionRemota: resolverNavegacionRemota({}),
            errorFiltros: error.message,
            flashFederacion: this.#consumirFlash(requisicion)
          });
        } catch (errorRecuperacion) {
          next(errorRecuperacion);
        }
        return;
      }
      next(error);
    }
  }

  async mostrarDiagnostico(requisicion, respuesta, next) {
    try {
      if (typeof this.servicioDiagnosticoFederacion?.obtener !== 'function') {
        throw new Error('El diagnóstico federado no está disponible.');
      }
      const diagnostico = await this.servicioDiagnosticoFederacion.obtener(
        requisicion.contextoUsuarioActual,
        { relacionId: requisicion.query.relacion }
      );
      respuesta.set('Cache-Control', 'private, no-store');
      respuesta.render('portal/federacion-diagnostico', {
        titulo: 'Diagnóstico de federación',
        usuarioActual: requisicion.session?.usuarioAutenticado ?? null,
        diagnostico,
        errorSeleccion: null
      });
    } catch (error) {
      if (error?.statusCode === 403) {
        respuesta.status(403).render('portal/forbidden', {
          titulo: 'Acceso denegado',
          permisoSolicitado: 'ver_diagnostico_federacion',
          usuarioActual: requisicion.session?.usuarioAutenticado ?? null
        });
        return;
      }
      if ([400, 404].includes(error?.statusCode)) {
        try {
          const diagnostico = await this.servicioDiagnosticoFederacion.obtener(
            requisicion.contextoUsuarioActual,
            {}
          );
          respuesta.set('Cache-Control', 'private, no-store');
          respuesta.status(error.statusCode).render('portal/federacion-diagnostico', {
            titulo: 'Diagnóstico de federación',
            usuarioActual: requisicion.session?.usuarioAutenticado ?? null,
            diagnostico,
            errorSeleccion: error.message
          });
        } catch (errorRecuperacion) {
          next(errorRecuperacion);
        }
        return;
      }
      next(error);
    }
  }

  async crearBorradorMonitor(requisicion, respuesta) {
    await this.#operacionConDestino(requisicion, respuesta, async () => {
      if (!requisicion.session ||
          typeof this.servicioBorradoresFederacion?.crearFormularioMonitor !== 'function') {
        throw new Error('El editor no puede conservar el borrador federado en esta sesión.');
      }
      requisicion.session.borradorMonitorFederado =
        await this.servicioBorradoresFederacion.crearFormularioMonitor(
          requisicion.contextoUsuarioActual,
          requisicion.body.proyeccion_id
        );
      return '/monitores/nuevo?tipo=booleano&borrador_federado=1';
    });
  }

  async crearBorradorTrigger(requisicion, respuesta) {
    await this.#operacionConDestino(requisicion, respuesta, async () => {
      if (!requisicion.session ||
          typeof this.servicioBorradoresFederacion?.crearFormularioTrigger !== 'function') {
        throw new Error('El editor no puede conservar el borrador federado en esta sesión.');
      }
      requisicion.session.borradorTriggerFederado =
        await this.servicioBorradoresFederacion.crearFormularioTrigger(
          requisicion.contextoUsuarioActual,
          requisicion.body.proyeccion_id
        );
      return '/monitores/triggers/nuevo?borrador_federado=1';
    });
  }

  async mostrarReconstrucciones(requisicion, respuesta, next) {
    try {
      const reconstrucciones = await this.servicioReconstruccionesFederacion.obtener(
        requisicion.contextoUsuarioActual
      );
      respuesta.set('Cache-Control', 'private, no-store');
      respuesta.render('portal/federacion-reconstrucciones', {
        titulo: 'Reconstrucciones federadas',
        usuarioActual: requisicion.session?.usuarioAutenticado ?? null,
        reconstrucciones,
        flashFederacion: this.#consumirFlash(requisicion)
      });
    } catch (error) {
      next(error);
    }
  }

  async decidirReconstruccion(requisicion, respuesta) {
    await this.#operacionReconstruccion(requisicion, respuesta, () =>
      this.servicioReconstruccionesFederacion.decidir(
        requisicion.contextoUsuarioActual,
        {
          flujoId: requisicion.params.flujoId,
          estrategia: requisicion.body.estrategia,
          generacionObjetivoId: requisicion.body.generacion_objetivo_id,
          motivo: requisicion.body.motivo
        }
      ),
    'La decisión de reconstrucción ha quedado aplicada y auditada.');
  }

  async cancelarCandidata(requisicion, respuesta) {
    await this.#operacionCandidata(requisicion, respuesta, 'cancelar',
      'La generación candidata ha quedado cancelada.');
  }

  async promoverCandidata(requisicion, respuesta) {
    await this.#operacionCandidata(requisicion, respuesta, 'promover',
      'La generación candidata ha sido promovida como verdad activa.');
  }

  async revalidarCandidata(requisicion, respuesta) {
    await this.#operacionCandidata(requisicion, respuesta, 'revalidar',
      'La generación candidata ha quedado revalidada frente a la activa actual.');
  }

  async crearRecepcion(requisicion, respuesta) {
    await this.#operacionConRedireccion(requisicion, respuesta, async () => {
      const creada = await this.servicio.crearRecepcion(
        requisicion.contextoUsuarioActual
      );
      return `Relación receptora ${creada.relacionId} creada para tu scope actual.`;
    });
  }

  async importarInvitacion(requisicion, respuesta) {
    await this.#operacionConRedireccion(requisicion, respuesta, async () => {
      const resultado = await this.servicio.importarInvitacion({
        contextoUsuarioActual: requisicion.contextoUsuarioActual,
        representacion: parsearRepresentacion(
          requisicion.body.invitacion,
          'invitación'
        )
      });
      return `La relación emisora ${resultado.relacionId} espera autenticación técnica.`;
    });
  }

  async importarRecuperacion(requisicion, respuesta) {
    await this.#operacionConRedireccion(requisicion, respuesta, async () => {
      await this.servicio.importarRecuperacion({
        contextoUsuarioActual: requisicion.contextoUsuarioActual,
        representacion: parsearRepresentacion(
          requisicion.body.recuperacion,
          'recuperación'
        )
      });
      return 'La recuperación se ha canjeado y la nueva credencial quedó bajo custodia.';
    });
  }

  async emitirInvitacion(requisicion, respuesta, next) {
    try {
      const resultado = await this.servicio.emitirInvitacion({
        contextoUsuarioActual: requisicion.contextoUsuarioActual,
        relacionId: requisicion.params.relacionId,
        ttlSegundos: enteroOpcional(requisicion.body.ttl_segundos, 900)
      });
      respuesta.set('Cache-Control', 'no-store');
      await this.#renderizar(requisicion, respuesta, {
        entregaTemporal: {
          tipo: 'invitacion',
          titulo: 'Invitación temporal emitida',
          advertencia:
            'Cópiala ahora en la instancia emisora. Esta representación no volverá a mostrarse.',
          valor: resultado.representacionTransportable
        }
      });
    } catch (error) {
      if (error?.statusCode === 403) {
        respuesta.status(403).render('portal/forbidden', {
          titulo: 'Acceso denegado',
          permisoSolicitado: 'gestionar_credenciales_federacion',
          usuarioActual: requisicion.session?.usuarioAutenticado ?? null
        });
        return;
      }
      this.#guardarFlash(requisicion, 'error', error.message);
      respuesta.redirect('/federacion');
    }
  }

  async revocarInvitacion(requisicion, respuesta) {
    await this.#operacionConRedireccion(requisicion, respuesta, async () => {
      const resultado = await this.servicio.revocarInvitacion({
        contextoUsuarioActual: requisicion.contextoUsuarioActual,
        relacionId: requisicion.params.relacionId,
        invitacionId: requisicion.body.invitacion_id
      });
      return resultado.cambioEfectivo
        ? 'La invitación temporal ha sido revocada.'
        : `La invitación ya estaba ${resultado.estado}.`;
    });
  }

  async confirmarIdentidad(requisicion, respuesta) {
    await this.#operacionConRedireccion(requisicion, respuesta, async () => {
      await this.servicio.confirmarIdentidad({
        contextoUsuarioActual: requisicion.contextoUsuarioActual,
        relacionId: requisicion.params.relacionId,
        installationRemotaId: requisicion.body.installation_remota_id,
        nombreRemotoDeclarado: requisicion.body.nombre_remoto_declarado
      });
      return 'Identidad remota confirmada. La relación espera autenticación técnica.';
    });
  }

  async emitirRecuperacion(requisicion, respuesta) {
    try {
      const resultado = await this.servicio.emitirRecuperacion({
        contextoUsuarioActual: requisicion.contextoUsuarioActual,
        relacionId: requisicion.params.relacionId,
        ttlSegundos: enteroOpcional(requisicion.body.ttl_segundos, 900)
      });
      respuesta.set('Cache-Control', 'no-store');
      await this.#renderizar(requisicion, respuesta, {
        entregaTemporal: {
          tipo: 'recuperacion',
          titulo: 'Recuperación temporal emitida',
          advertencia:
            'Transfiérela por el canal acordado. Solo se entrega una vez y caduca.',
          valor: resultado.representacionTransportable
        }
      });
    } catch (error) {
      this.#guardarFlash(requisicion, 'error', error.message);
      respuesta.redirect('/federacion');
    }
  }

  async aprobarLocalizacion(requisicion, respuesta) {
    await this.#operacionConRedireccion(requisicion, respuesta, async () => {
      await this.servicio.aprobarLocalizacion({
        contextoUsuarioActual: requisicion.contextoUsuarioActual,
        relacionId: requisicion.params.relacionId,
        localizacionId: requisicion.body.localizacion_id
      });
      return 'La nueva localización HTTPS ha sido aprobada explícitamente.';
    });
  }

  async transferirResponsabilidad(requisicion, respuesta) {
    await this.#operacionConRedireccion(requisicion, respuesta, async () => {
      await this.servicio.transferirResponsabilidad({
        contextoUsuarioActual: requisicion.contextoUsuarioActual,
        relacionId: requisicion.params.relacionId,
        nuevoResponsableUsuarioId: requisicion.body.nuevo_responsable_usuario_id
      });
      return 'La responsabilidad federada se ha transferido y su autoridad ha sido reevaluada.';
    });
  }

  async deshabilitarRelacion(requisicion, respuesta) {
    await this.#operacionConRedireccion(requisicion, respuesta, async () => {
      await this.servicio.deshabilitarRelacion({
        contextoUsuarioActual: requisicion.contextoUsuarioActual,
        relacionId: requisicion.params.relacionId
      });
      return 'La relación federada ha quedado deshabilitada.';
    });
  }

  async eliminarRelacion(requisicion, respuesta) {
    await this.#operacionConRedireccion(requisicion, respuesta, async () => {
      if (String(requisicion.body.confirmacion || '').trim() !== 'ELIMINAR') {
        throw new Error('Escribe ELIMINAR para confirmar la retirada terminal.');
      }
      await this.servicio.eliminarRelacion({
        contextoUsuarioActual: requisicion.contextoUsuarioActual,
        relacionId: requisicion.params.relacionId
      });
      return 'La relación federada ha sido eliminada de forma terminal.';
    });
  }

  async previsualizarRevisionConcesion(requisicion, respuesta) {
    try {
      const previsualizacion = await this.servicio.previsualizarRevisionConcesion({
        contextoUsuarioActual: requisicion.contextoUsuarioActual,
        relacionId: requisicion.params.relacionId,
        seleccion: extraerSeleccionConcesion(requisicion.body)
      });
      if (!requisicion.session) {
        throw new Error('La previsualización exige una sesión durable.');
      }
      requisicion.session.previsualizacionConcesionFederacion = previsualizacion;
      respuesta.set('Cache-Control', 'no-store');
      await this.#renderizar(requisicion, respuesta, { previsualizacionConcesion: previsualizacion });
    } catch (error) {
      this.#guardarFlash(requisicion, 'error', error.message);
      respuesta.redirect('/federacion');
    }
  }

  async confirmarRevisionConcesion(requisicion, respuesta) {
    await this.#operacionConRedireccion(requisicion, respuesta, async () => {
      const previsualizacion = requisicion.session?.previsualizacionConcesionFederacion ?? null;
      if (requisicion.session) {
        delete requisicion.session.previsualizacionConcesionFederacion;
      }
      const resultado = await this.servicio.confirmarRevisionConcesion({
        contextoUsuarioActual: requisicion.contextoUsuarioActual,
        relacionId: requisicion.params.relacionId,
        token: String(requisicion.body.token_previsualizacion || ''),
        previsualizacion
      });
      return `Revisión local registrada como ordinal ${resultado.ordinal}. ` +
        'La concesión efectiva seguirá las reglas de reducción inmediata y aprobación bilateral.';
    });
  }

  async sincronizarConcesion(requisicion, respuesta) {
    await this.#operacionConRedireccion(requisicion, respuesta, async () => {
      const resultado = await this.servicio.sincronizarConcesion({
        contextoUsuarioActual: requisicion.contextoUsuarioActual,
        relacionId: requisicion.params.relacionId
      });
      return resultado.revisionContraparteId
        ? 'La oferta y la aceptación remota han quedado sincronizadas; la concesión efectiva y sus flujos se han reconciliado.'
        : 'La oferta quedó confirmada por la contraparte. Aún no existe una aceptación remota que consolidar.';
    });
  }

  async resolverConflicto(requisicion, respuesta) {
    await this.#operacionConRedireccion(requisicion, respuesta, async () => {
      const total = enteroAcotado(requisicion.body.total_relaciones, 1, 100);
      const relacionesLegitimas = [];
      const relacionesClon = [];
      const relacionesNuevasClon = [];
      for (let indice = 0; indice < total; indice += 1) {
        const relacionId = String(requisicion.body[`relacion_${indice}`] || '');
        const papel = requisicion.body[`papel_${indice}`];
        if (papel === 'legitima') relacionesLegitimas.push(relacionId);
        if (papel === 'clon') {
          relacionesClon.push(relacionId);
          relacionesNuevasClon.push(
            String(requisicion.body[`relacion_nueva_${indice}`] || '')
          );
        }
      }
      await this.servicio.resolverConflicto({
        contextoUsuarioActual: requisicion.contextoUsuarioActual,
        incidenteId: requisicion.params.incidenteId,
        installationClonNuevaId: requisicion.body.installation_clon_nueva_id,
        relacionesLegitimas,
        relacionesClon,
        relacionesNuevasClon
      });
      return 'El conflicto de identidad ha sido resuelto; la resincronización queda requerida.';
    });
  }

  async #renderizar(requisicion, respuesta, {
    entregaTemporal = null,
    previsualizacionConcesion = null
  } = {}) {
    const panel = await this.servicio.obtenerPanel(
      requisicion.contextoUsuarioActual
    );
    respuesta.render('portal/federacion', {
      titulo: 'Federación',
      usuarioActual: requisicion.session?.usuarioAutenticado ?? null,
      panel,
      entregaTemporal,
      previsualizacionConcesion,
      flashFederacion: this.#consumirFlash(requisicion)
    });
  }

  async #operacionConRedireccion(requisicion, respuesta, operacion) {
    try {
      this.#guardarFlash(requisicion, 'exito', await operacion());
    } catch (error) {
      this.#guardarFlash(requisicion, 'error', mensajeErrorOperacionFederacion(error));
    }
    respuesta.redirect('/federacion');
  }

  async #operacionConDestino(requisicion, respuesta, operacion) {
    try {
      respuesta.redirect(await operacion());
    } catch (error) {
      this.#guardarFlash(requisicion, 'error', error.message);
      respuesta.redirect('/federacion/datos-remotos');
    }
  }

  async #operacionReconstruccion(requisicion, respuesta, operacion, mensaje) {
    try {
      await operacion();
      this.#guardarFlash(requisicion, 'exito', mensaje);
    } catch (error) {
      this.#guardarFlash(requisicion, 'error', error.message);
    }
    respuesta.redirect('/federacion/reconstrucciones');
  }

  async #operacionCandidata(requisicion, respuesta, accion, mensaje) {
    return this.#operacionReconstruccion(requisicion, respuesta, () =>
      this.servicioReconstruccionesFederacion[accion](
        requisicion.contextoUsuarioActual,
        {
          flujoId: requisicion.params.flujoId,
          generacionId: requisicion.params.generacionId,
          motivo: requisicion.body.motivo
        }
      ), mensaje);
  }

  #consumirFlash(requisicion) {
    const flash = requisicion.session?.flashFederacion ?? null;
    if (requisicion.session) delete requisicion.session.flashFederacion;
    return flash;
  }

  #guardarFlash(requisicion, tipo, mensaje) {
    if (requisicion.session) {
      requisicion.session.flashFederacion = { tipo, mensaje };
    }
  }
}

const FAMILIA_POR_VISTA_REMOTA = Object.freeze({
  organizacion: 'estructuraOrganizativa',
  monitores: 'monitores',
  triggers: 'triggersInformativos',
  alertas: 'monitores',
  avisos: 'avisosFederados',
  auditoria: 'auditoria'
});

function resolverNavegacionRemota(query = {}) {
  const installationOrigenId = String(query.procedencia ?? '').trim() || null;
  const solicitada = String(query.vista ?? '').trim();
  const vistas = new Set([
    'instalaciones', 'resumen', 'organizacion', 'monitores', 'triggers',
    'alertas', 'avisos', 'auditoria', 'agentes', 'tecnica'
  ]);
  const porDefecto = installationOrigenId ? 'resumen' : 'instalaciones';
  // Compatibilidad con enlaces previos: telemetría ya no es un área humana
  // independiente, sino una lectura del espacio remoto de agentes.
  const vistaNormalizada = solicitada === 'telemetria' ? 'agentes' : solicitada;
  const vista = vistas.has(vistaNormalizada) ? vistaNormalizada : porDefecto;
  const subviews = {
    organizacion: ['jerarquia', 'tenants', 'empresas', 'sitios'],
    monitores: ['inventario', 'estado', 'historico', 'alertas', 'triggers'],
    triggers: ['inventario', 'resumen', 'asignaciones', 'ejecuciones'],
    alertas: ['activas', 'sin-vigencia', 'historico'],
    avisos: ['actuales', 'actividad', 'historico'],
    auditoria: ['resumen', 'actividad', 'historico'],
    agentes: ['resumen', 'actividad', 'historico']
  }[vista] ?? [];
  const subvistaSolicitada = String(query.subvista ?? '').trim();
  const subvista = subviews.includes(subvistaSolicitada)
    ? subvistaSolicitada
    : subviews[0] ?? null;
  return Object.freeze({
    vista,
    subvista,
    installationOrigenId,
    monitorOrigenId: String(query.monitor ?? '').trim() || null,
    triggerOrigenId: String(query.trigger ?? '').trim() || null,
    familia: vista === 'tecnica'
      ? String(query.familia ?? '').trim() || null
      : FAMILIA_POR_VISTA_REMOTA[vista] ?? null
  });
}

function extraerSeleccionConcesion(cuerpo = {}) {
  const nivelesScope = listaFormulario(cuerpo.niveles_scope);
  const familias = {};
  for (const [clave, valor] of Object.entries(cuerpo)) {
    if (!clave.startsWith('familia_') || valor !== '1') continue;
    const familia = clave.slice('familia_'.length);
    const camposSensibles = listaFormulario(cuerpo[`sensibles_${familia}`]);
    familias[familia] = {
      campos: [String(cuerpo[`campo_base_${familia}`] || ''), ...camposSensibles],
      permiteContenidoSensible: camposSensibles.length > 0,
      permiteRefederacion: cuerpo[`refederacion_${familia}`] === '1'
    };
  }
  return { activa: true, nivelesScope, familias };
}

function listaFormulario(valor) {
  if (valor == null) return [];
  return (Array.isArray(valor) ? valor : [valor]).map(String);
}

function enteroOpcional(valor, porDefecto) {
  const texto = String(valor ?? '').trim();
  if (!texto) return porDefecto;
  if (!/^[0-9]+$/u.test(texto)) throw new Error('La vigencia no es un entero válido.');
  return Number(texto);
}

function enteroAcotado(valor, minimo, maximo) {
  const texto = String(valor ?? '').trim();
  if (!/^[0-9]+$/u.test(texto)) throw new Error('El contador no es válido.');
  const numero = Number(texto);
  if (!Number.isSafeInteger(numero) || numero < minimo || numero > maximo) {
    throw new Error('El contador queda fuera del límite permitido.');
  }
  return numero;
}

function parsearRepresentacion(valor, campo) {
  const texto = String(valor ?? '').trim();
  if (!texto || Buffer.byteLength(texto, 'utf8') > 16 * 1024) {
    throw new Error(`La ${campo} no es válida o supera el límite permitido.`);
  }
  try {
    return JSON.parse(texto);
  } catch {
    throw new Error(`La ${campo} no contiene JSON válido.`);
  }
}

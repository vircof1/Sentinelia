import { generarUuidV7Auditoria } from '../../../../paquetes/auditoria/src/UuidV7Auditoria.js';
import { PERFIL_JCS_AUDITORIA_V1 } from '../../../../paquetes/auditoria/src/PerfilJcsAuditoria.js';
import { VERSION_ENCADENADO_AUDITORIA_V1 } from '../../../../paquetes/auditoria/src/SobreCanonicoAuditoria.js';
import { construirClaveCadenaAuditoria } from '../../../../paquetes/auditoria/src/CatalogoAuditoria.js';

const LONGITUD_MAXIMA_MOTIVO_DESCARTE = 512;

function normalizarIdPositivo(valor) {
  const convertido = Number.parseInt(String(valor ?? ''), 10);
  return Number.isInteger(convertido) && convertido > 0 ? convertido : null;
}

function normalizarTexto(valor) {
  return String(valor ?? '').trim();
}

function normalizarFechaHastaUtc(valor) {
  const texto = normalizarTexto(valor);

  if (!texto) {
    return null;
  }

  const fecha = new Date(texto);

  if (Number.isNaN(fecha.getTime())) {
    throw new Error('La fecha de reactivación no tiene un formato válido.');
  }

  if (fecha.getTime() <= Date.now()) {
    throw new Error('La fecha de reactivación debe estar en el futuro.');
  }

  return fecha.toISOString();
}

export class ServicioGestionAlertasActivasPortal {
  constructor({
    repositorioMonitores,
    repositorioAlertasActivasMonitor,
    servicioAutorizacion,
    difusorWebSocketPortal = null,
    fronteraTransaccional = null,
    servicioAuditoria = null,
    ahora = () => new Date()
  }) {
    this.repositorioMonitores = repositorioMonitores;
    this.repositorioAlertasActivasMonitor = repositorioAlertasActivasMonitor;
    this.servicioAutorizacion = servicioAutorizacion;
    this.difusorWebSocketPortal = difusorWebSocketPortal;
    this.fronteraTransaccional = fronteraTransaccional;
    this.servicioAuditoria = servicioAuditoria;
    this.ahora = ahora;
  }

  async descartarAlertaActiva(
    contextoUsuarioActual,
    { monitorId, motivo, hastaUtc }
  ) {
    this.asegurarGestionPermitida(contextoUsuarioActual);

    const monitorIdNormalizado = normalizarIdPositivo(monitorId);
    const motivoNormalizado = this.normalizarMotivoDescarte(motivo);
    const descartadaHastaUtc = normalizarFechaHastaUtc(hastaUtc);
    const usuarioId = normalizarIdPositivo(contextoUsuarioActual?.idUsuario);

    if (monitorIdNormalizado == null) {
      throw new Error('El monitor indicado no es válido.');
    }

    if (usuarioId == null) {
      throw new Error('La sesión no tiene usuario operativo válido.');
    }

    const alertaActiva = await this.asegurarAlertaActivaVisible({
      contextoUsuarioActual,
      monitorId: monitorIdNormalizado
    });
    const descarteActual = this.obtenerDescarteOperativo(alertaActiva);

    if (descarteActual?.vigente) {
      throw new Error(
        'La alerta ya está inhibida. Reactívala antes de crear otra inhibición.'
      );
    }

    const alertaActualizada = await this.ejecutarCambioDescarteAuditable(
      contextoUsuarioActual,
      {
        tipo: 'alerta.descarte_aplicado',
        monitorId: monitorIdNormalizado,
        mutacion: ({ conexion } = {}) =>
          this.repositorioAlertasActivasMonitor.descartarDashboard({
            monitorId: monitorIdNormalizado,
            motivo: motivoNormalizado,
            usuarioId,
            descartadaHastaUtc
          }, { conexion })
      }
    );

    if (!alertaActualizada) {
      throw new Error(
        'La alerta activa ya no existe o ya está inhibida. Actualiza el panel; si quieres cambiar la inhibición, reactívala antes.'
      );
    }

    this.programarVencimientoDescarteTemporal(alertaActualizada);
    this.notificarDashboardActualizado({
      motivoPublicacion: 'descarte_alerta_activa',
      monitorId: monitorIdNormalizado
    });

    return {
      mensaje: 'Alerta inhibida. Sigue activa, pero queda fuera del foco principal.',
      alerta: alertaActualizada.serializarResumen()
    };
  }

  async revertirDescarteAlertaActiva(contextoUsuarioActual, { monitorId }) {
    this.asegurarGestionPermitida(contextoUsuarioActual);

    const monitorIdNormalizado = normalizarIdPositivo(monitorId);

    if (monitorIdNormalizado == null) {
      throw new Error('El monitor indicado no es válido.');
    }

    await this.asegurarAlertaActivaVisible({
      contextoUsuarioActual,
      monitorId: monitorIdNormalizado
    });

    const alertaActualizada = await this.ejecutarCambioDescarteAuditable(
      contextoUsuarioActual,
      {
        tipo: 'alerta.descarte_revertido',
        monitorId: monitorIdNormalizado,
        mutacion: ({ conexion } = {}) =>
          this.repositorioAlertasActivasMonitor.revertirDescarteDashboard({
            monitorId: monitorIdNormalizado
          }, { conexion })
      }
    );

    if (!alertaActualizada) {
      throw new Error('La alerta activa ya no existe o no se pudo reactivar.');
    }

    this.notificarDashboardActualizado({
      motivoPublicacion: 'reversion_descarte_alerta_activa',
      monitorId: monitorIdNormalizado
    });

    return {
      mensaje: 'Alerta reactivada. Vuelve a ser visible en el foco principal.',
      alerta: alertaActualizada.serializarResumen()
    };
  }

  asegurarGestionPermitida(contextoUsuarioActual) {
    if (
      !this.servicioAutorizacion.puedeGestionarDescartesAlertasActivas(
        contextoUsuarioActual
      )
    ) {
      throw new Error('No tienes permiso para inhibir o reactivar alertas.');
    }
  }

  async asegurarAlertaActivaVisible({ contextoUsuarioActual, monitorId }) {
    const alerta =
      await this.repositorioAlertasActivasMonitor.buscarPorMonitorId(monitorId);

    if (!alerta) {
      throw new Error('No existe una alerta activa para ese monitor.');
    }

    const monitoresVisibles = await this.repositorioMonitores.listarVisibles(
      contextoUsuarioActual
    );
    const visible = monitoresVisibles.some(
      (monitor) => Number(monitor?.id) === Number(monitorId)
    );

    if (!visible) {
      throw new Error('La alerta activa no está dentro de tu alcance operativo.');
    }

    return alerta;
  }

  obtenerDescarteOperativo(alerta) {
    if (!alerta) {
      return null;
    }

    if (typeof alerta.obtenerDescarteOperativo === 'function') {
      return alerta.obtenerDescarteOperativo();
    }

    return alerta.descarteOperativo || null;
  }

  normalizarMotivoDescarte(motivo) {
    const motivoNormalizado = normalizarTexto(motivo);

    if (!motivoNormalizado) {
      throw new Error('El motivo de la inhibición es obligatorio.');
    }

    if (motivoNormalizado.length > LONGITUD_MAXIMA_MOTIVO_DESCARTE) {
      throw new Error(
        `El motivo de la inhibición no puede superar ${LONGITUD_MAXIMA_MOTIVO_DESCARTE} caracteres.`
      );
    }

    return motivoNormalizado;
  }

  auditoriaActiva() {
    return Boolean(
      this.fronteraTransaccional?.ejecutar &&
      this.servicioAuditoria?.registrarEnTransaccion
    );
  }

  async ejecutarCambioDescarteAuditable(
    contextoUsuarioActual,
    { tipo, monitorId, mutacion }
  ) {
    if (!this.auditoriaActiva()) {
      return mutacion();
    }

    return this.fronteraTransaccional.ejecutar(async (conexion) => {
      const alertaActualizada = await mutacion({ conexion });

      if (!alertaActualizada) {
        return null;
      }

      await this.registrarEventoDescarteAlerta({
        conexion,
        contextoUsuarioActual,
        tipo,
        alerta: alertaActualizada,
        monitorId
      });

      return alertaActualizada;
    });
  }

  registrarEventoDescarteAlerta({
    conexion,
    contextoUsuarioActual,
    tipo,
    alerta,
    monitorId
  }) {
    const alertaAuditoriaId = alerta?.alertaAuditoriaId;

    if (!alertaAuditoriaId) {
      throw new Error('La alerta no tiene alertaAuditoriaId auditable.');
    }

    const eventoId = generarUuidV7Auditoria();
    const scope = scopeDesdeAlerta(alerta);
    const resultado = tipo === 'alerta.descarte_aplicado'
      ? 'aplicado'
      : 'revertido';

    return this.servicioAuditoria.registrarEnTransaccion({
      cambioEfectivo: true,
      intencion: {
        versionContrato: 1,
        eventoId,
        tipo,
        flujo: 'alertas',
        claveCadena: construirClaveCadenaAuditoria({
          flujo: 'alertas', tenantId: scope.tenantId
        }),
        actor: 'usuario',
        actorReal: actorReal(contextoUsuarioActual),
        actorEfectivo: actorEfectivo(contextoUsuarioActual),
        modoActuacion: contextoUsuarioActual?.impersonacionActiva
          ? 'impersonado'
          : 'directo',
        sujeto: { tipo: 'alerta', id: alertaAuditoriaId },
        origen: 'web',
        correlacionId: eventoId,
        causalidad: null,
        productor: 'portal_web',
        claveOperacion: eventoId,
        scope,
        efectivoEnUtc: this.ahora().toISOString(),
        rolEvento: 'principal',
        payload: {
          resultado,
          causa: 'operador'
        },
        versionCanonicalizador: PERFIL_JCS_AUDITORIA_V1,
        versionEncadenado: VERSION_ENCADENADO_AUDITORIA_V1
      }
    }, { conexion });
  }

  notificarDashboardActualizado({ motivoPublicacion, monitorId }) {
    if (
      !this.difusorWebSocketPortal ||
      typeof this.difusorWebSocketPortal.emitirDashboardActualizado !== 'function'
    ) {
      return;
    }

    try {
      this.difusorWebSocketPortal.emitirDashboardActualizado({
        motivoPublicacion,
        monitorId,
        sincronizadoEn: new Date().toISOString()
      });
    } catch (error) {
      console.error('[sentinelia-web] No se pudo notificar el dashboard.');
      console.error(error);
    }
  }

  programarVencimientoDescarteTemporal(alertaActiva) {
    if (
      !this.difusorWebSocketPortal ||
      typeof this.difusorWebSocketPortal.programarVencimientoDescarteTemporal !==
        'function'
    ) {
      return;
    }

    const descarte = this.obtenerDescarteOperativo(alertaActiva);

    if (!descarte?.vigente || !descarte.descartadaHastaUtc) {
      return;
    }

    try {
      this.difusorWebSocketPortal.programarVencimientoDescarteTemporal(
        descarte.descartadaHastaUtc,
        { monitorId: alertaActiva.monitorId }
      );
    } catch (error) {
      console.error(
        '[sentinelia-web] No se pudo programar vencimiento de descarte.'
      );
      console.error(error);
    }
  }
}

function scopeDesdeAlerta(alerta) {
  return {
    tenantId: String(alerta.tenantId),
    empresaId: String(alerta.empresaId),
    sitioId: alerta.sitioId == null ? null : String(alerta.sitioId)
  };
}

function actorReal(contextoUsuarioActual) {
  return {
    tipo: 'usuario',
    id: String(
      contextoUsuarioActual?.idUsuarioReal ??
      contextoUsuarioActual?.idUsuario
    )
  };
}

function actorEfectivo(contextoUsuarioActual) {
  const idReal = contextoUsuarioActual?.idUsuarioReal ?? contextoUsuarioActual?.idUsuario;
  const idEfectivo = contextoUsuarioActual?.idUsuario ?? idReal;
  return String(idReal) === String(idEfectivo)
    ? null
    : { tipo: 'usuario', id: String(idEfectivo) };
}

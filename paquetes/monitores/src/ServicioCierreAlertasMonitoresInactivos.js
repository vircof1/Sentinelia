import { generarUuidV7Auditoria } from '../../auditoria/src/UuidV7Auditoria.js';
import { PERFIL_JCS_AUDITORIA_V1 } from '../../auditoria/src/PerfilJcsAuditoria.js';
import { VERSION_ENCADENADO_AUDITORIA_V1 } from '../../auditoria/src/SobreCanonicoAuditoria.js';
import { normalizarMarcaUtc } from '../../utilidades/src/fechas/normalizarMarcaUtc.js';

export class ServicioCierreAlertasMonitoresInactivos {
  constructor({
    repositorioMonitores,
    repositorioAlertasActivasMonitor,
    fronteraTransaccional,
    registrarAuditoriaEnTransaccion,
    capturadorFederacionMonitores = null,
    runtimeActorId = 'sentinelia-runtime',
    ahora = () => new Date()
  }) {
    this.repositorioMonitores = repositorioMonitores;
    this.repositorioAlertas = repositorioAlertasActivasMonitor;
    this.fronteraTransaccional = fronteraTransaccional;
    this.registrarAuditoriaEnTransaccion = registrarAuditoriaEnTransaccion;
    this.capturadorFederacionMonitores = capturadorFederacionMonitores;
    this.runtimeActorId = runtimeActorId;
    this.ahora = ahora;
  }

  async cerrarEnTransaccion({ monitorId, contextoUsuarioActual = null }, { conexion }) {
    const [fila] = await this.repositorioMonitores.bloquearPorIds(
      [monitorId], { conexion }
    );
    if (!fila || Boolean(fila.activo)) return null;

    const alerta = await this.repositorioAlertas.buscarPorMonitorId(
      monitorId, { conexion, bloquear: true }
    );
    if (!alerta) return null;

    const efectivoEnUtc = normalizarMarcaUtc(this.ahora());
    const cierre = {
      monitorId: alerta.monitorId,
      alertaAuditoriaId: alerta.alertaAuditoriaId,
      versionCatalogo: alerta.versionCatalogo,
      tipoMonitor: alerta.tipoMonitor,
      estadoDetectado: alerta.estadoDetectado,
      codigoResultado: 'monitor_desactivado',
      mensajeResultado: 'Alerta cerrada al desactivar el monitor.',
      fechaOcurrenciaUtc: efectivoEnUtc,
      validoDesdeUtc: normalizarMarcaUtc(alerta.validoDesdeUtc),
      ultimaConfirmacionUtc: normalizarMarcaUtc(alerta.ultimaConfirmacionUtc),
      ultimaEjecucionUtc: normalizarMarcaUtc(alerta.ultimaEjecucionUtc),
      contadorRepeticiones: alerta.contadorRepeticiones,
      payloadAlerta: alerta.payloadAlerta,
      descarteOperativo: alerta.obtenerDescarteOperativo()
    };
    if (this.capturadorFederacionMonitores) {
      await this.capturadorFederacionMonitores.capturarRuntimeEnTransaccion(
        { cierresAlerta: [cierre] }, { conexion }
      );
    }
    await this.repositorioAlertas.eliminarPorMonitorIds([monitorId], { conexion });
    await this.registrarAuditoriaEnTransaccion(
      this.construirIntencionCierre({ alerta, efectivoEnUtc, contextoUsuarioActual }),
      { conexion }
    );
    return cierre;
  }

  async reconciliar() {
    const monitorIds = await this.repositorioAlertas.listarMonitorIdsInactivos();
    let totalCierres = 0;
    for (const monitorId of monitorIds) {
      const cierre = await this.fronteraTransaccional.ejecutar((conexion) =>
        this.cerrarEnTransaccion({ monitorId }, { conexion })
      );
      if (cierre) totalCierres += 1;
    }
    return { totalCierres };
  }

  // auditoria-productor: monitores.alertas.inactivacion
  construirIntencionCierre({ alerta, efectivoEnUtc, contextoUsuarioActual }) {
    const eventoId = generarUuidV7Auditoria();
    const scope = {
      tenantId: String(alerta.tenantId),
      empresaId: alerta.empresaId == null ? null : String(alerta.empresaId),
      sitioId: alerta.sitioId == null ? null : String(alerta.sitioId)
    };
    const esWeb = Boolean(contextoUsuarioActual);
    const idReal = contextoUsuarioActual?.idUsuarioReal ?? contextoUsuarioActual?.idUsuario;
    const idEfectivo = contextoUsuarioActual?.idUsuario ?? idReal;
    return {
      versionContrato: 1,
      eventoId,
      tipo: 'alerta.cerrada',
      flujo: 'alertas',
      claveCadena: `alertas:tenant:${scope.tenantId}`,
      actor: esWeb ? 'usuario' : 'runtime',
      actorReal: esWeb
        ? { tipo: 'usuario', id: String(idReal) }
        : { tipo: 'runtime', id: this.runtimeActorId },
      actorEfectivo: esWeb && String(idReal) !== String(idEfectivo)
        ? { tipo: 'usuario', id: String(idEfectivo) } : null,
      modoActuacion: contextoUsuarioActual?.impersonacionActiva ? 'impersonado' : 'directo',
      sujeto: { tipo: 'alerta', id: alerta.alertaAuditoriaId },
      origen: esWeb ? 'web' : 'runtime',
      correlacionId: alerta.alertaAuditoriaId,
      causalidad: null,
      productor: esWeb ? 'portal_web' : 'runtime_alertas',
      claveOperacion: `ciclo:${alerta.alertaAuditoriaId}:cerrada`,
      scope,
      efectivoEnUtc,
      rolEvento: 'principal',
      payload: { resultado: 'cerrada', causa: 'monitor_desactivado' },
      versionCanonicalizador: PERFIL_JCS_AUDITORIA_V1,
      versionEncadenado: VERSION_ENCADENADO_AUDITORIA_V1
    };
  }
}

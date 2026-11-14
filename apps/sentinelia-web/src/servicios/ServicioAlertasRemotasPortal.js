import { generarUuidV7Auditoria } from '../../../../paquetes/auditoria/src/UuidV7Auditoria.js';
import { PERFIL_JCS_AUDITORIA_V1 } from '../../../../paquetes/auditoria/src/PerfilJcsAuditoria.js';
import { VERSION_ENCADENADO_AUDITORIA_V1 } from '../../../../paquetes/auditoria/src/SobreCanonicoAuditoria.js';
import { construirClaveCadenaAuditoria } from '../../../../paquetes/auditoria/src/CatalogoAuditoria.js';

export class ServicioAlertasRemotasPortal {
  constructor({ repositorio, servicioAutorizacion, fronteraTransaccional,
    servicioAuditoria, difusorWebSocketPortal = null, ahora = () => new Date() }) {
    this.repositorio = repositorio; this.autorizacion = servicioAutorizacion;
    this.frontera = fronteraTransaccional; this.auditoria = servicioAuditoria;
    this.difusor = difusorWebSocketPortal; this.ahora = ahora;
  }

  async consultar(contexto, { exigirPreferencia = false,
    installationOrigenId = null, incluirCerradas = false } = {}) {
    this.exigirPermiso(contexto);
    const puedeGestionarDescartes = !contexto?.impersonacionActiva;
    if (exigirPreferencia && !contexto.preferenciaMostrarAlertasRemotas) {
      return vacio({
        permiso: true,
        preferencia: false,
        puedeGestionarDescartes,
        incluirCerradas
      });
    }
    const alertas = (await this.repositorio.listar({
      contextoUsuarioActual: contexto,
      installationOrigenId,
      incluirCerradas
    }))
      .map(sanearAlerta);
    const actuales = alertas.filter((a) => a.estadoPresentacion === 'activaEnOrigen');
    const sinVigencia = alertas.filter((a) => a.estadoPresentacion === 'vigenciaAgotada');
    const cerradas = incluirCerradas
      ? alertas.filter((a) => a.estadoPresentacion === 'cerradaEnOrigen')
      : [];
    this.programarProximoVencimiento(actuales);
    const descartadas = actuales.filter((a) => a.descarteLocal.vigente);
    const visibles = actuales.filter((a) => !a.descarteLocal.vigente);
    return Object.freeze({
      permiso: true,
      preferencia: Boolean(contexto.preferenciaMostrarAlertasRemotas),
      puedeGestionarDescartes,
      totalActuales: actuales.length,
      totalVisibles: visibles.length,
      totalDescartadas: descartadas.length,
      totalSinVigencia: sinVigencia.length,
      alertasVisibles: Object.freeze(visibles),
      alertasDescartadas: Object.freeze(descartadas),
      alertasSinVigencia: Object.freeze(sinVigencia),
      ...(incluirCerradas ? {
        totalCerradas: cerradas.length,
        alertasCerradas: Object.freeze(cerradas)
      } : {})
    });
  }

  async descartar(contexto, { proyeccionId, alertaAuditoriaId, motivo, hastaUtc = null }) {
    this.exigirMutacion(contexto);
    const motivoNormalizado = String(motivo || '').trim();
    if (!motivoNormalizado || [...motivoNormalizado].length > 512) {
      throw errorDominio('MOTIVO_INVALIDO', 'El motivo de la inhibición debe contener entre 1 y 512 caracteres.', 400);
    }
    const hasta = normalizarHasta(hastaUtc, this.ahora());
    const eventoId = generarUuidV7Auditoria();
    const resultado = await this.frontera.ejecutar(async (conexion) => {
      const alerta = await this.repositorio.obtenerVisibleParaActualizar({
        conexion, contextoUsuarioActual: contexto, proyeccionId, alertaAuditoriaId
      });
      if (!alerta) throw errorDominio('ALERTA_NO_VISIBLE', 'La alerta no existe o queda fuera de tu alcance.', 404);
      const payload = JSON.parse(alerta.representacion_canonica);
      if (payload.estadoAlerta === 'cerrada') {
        throw errorDominio('ALERTA_CERRADA', 'Una alerta cerrada en origen no puede inhibirse.', 409);
      }
      await this.repositorio.guardarDescarte({ conexion,
        usuarioId: contexto.idUsuario, proyeccionId, alertaAuditoriaId,
        motivo: motivoNormalizado, hastaUtc: hasta, eventoId });
      await this.registrarAuditoria({ conexion, contexto, alerta, eventoId,
        alertaAuditoriaId, resultado: 'aplicado' });
      return { estado: 'descartada', hastaUtc: hasta };
    });
    this.notificar(hasta, { proyeccionId, alertaAuditoriaId });
    return resultado;
  }

  async revertir(contexto, { proyeccionId, alertaAuditoriaId }) {
    this.exigirMutacion(contexto);
    const eventoId = generarUuidV7Auditoria();
    const resultado = await this.frontera.ejecutar(async (conexion) => {
      const alerta = await this.repositorio.obtenerVisibleParaActualizar({
        conexion, contextoUsuarioActual: contexto, proyeccionId, alertaAuditoriaId
      });
      if (!alerta) throw errorDominio('ALERTA_NO_VISIBLE', 'La alerta no existe o queda fuera de tu alcance.', 404);
      const cambiado = await this.repositorio.revertirDescarte({ conexion,
        usuarioId: contexto.idUsuario, proyeccionId, alertaAuditoriaId, eventoId });
      if (!cambiado) throw errorDominio('DESCARTE_NO_VIGENTE', 'La alerta no posee una inhibición local vigente.', 409);
      await this.registrarAuditoria({ conexion, contexto, alerta, eventoId,
        alertaAuditoriaId, resultado: 'revertido' });
      return { estado: 'visible' };
    });
    this.difusor?.emitirAlertasRemotasActualizadas?.();
    return resultado;
  }

  exigirPermiso(contexto) {
    if (!this.autorizacion.puedeVerAlertasRemotas(contexto)) {
      throw errorDominio('PERMISO_DENEGADO', 'No tienes permiso para consultar alertas remotas.', 403);
    }
  }
  exigirMutacion(contexto) {
    this.exigirPermiso(contexto);
    if (contexto?.impersonacionActiva) {
      throw errorDominio('MUTACION_IMPERSONADA', 'La sesión impersonada solo puede consultar alertas remotas.', 403);
    }
  }

  registrarAuditoria({ conexion, contexto, alerta, eventoId, alertaAuditoriaId, resultado }) {
    const scope = { tenantId: decimal(alerta.scope_tenant_id),
      empresaId: decimal(alerta.scope_empresa_id), sitioId: decimal(alerta.scope_sitio_id) };
    return this.auditoria.registrarEnTransaccion({ cambioEfectivo: true, intencion: {
      versionContrato: 1, eventoId,
      tipo: resultado === 'aplicado' ? 'alerta.descarte_aplicado' : 'alerta.descarte_revertido',
      flujo: 'alertas', claveCadena: construirClaveCadenaAuditoria({
        flujo: 'alertas', tenantId: scope.tenantId
      }),
      actor: 'usuario', actorReal: { tipo: 'usuario', id: String(contexto.idUsuarioReal ?? contexto.idUsuario) },
      actorEfectivo: null, modoActuacion: 'directo',
      sujeto: { tipo: 'alerta', id: alertaAuditoriaId }, origen: 'web', scope,
      correlacionId: eventoId, causalidad: null, productor: 'portal_web',
      claveOperacion: `alerta-remota-descarte:v1:${eventoId}`, rolEvento: 'principal',
      efectivoEnUtc: this.ahora().toISOString(),
      payload: { resultado, causa: 'operador' },
      versionCanonicalizador: PERFIL_JCS_AUDITORIA_V1,
      versionEncadenado: VERSION_ENCADENADO_AUDITORIA_V1
    } }, { conexion });
  }

  notificar(hastaUtc, referencia) {
    this.difusor?.emitirAlertasRemotasActualizadas?.();
    if (hastaUtc) this.difusor?.programarVencimientoAlertaRemota?.(
      hastaUtc, referencia
    );
  }

  programarProximoVencimiento(alertas) {
    if (!this.difusor?.programarVencimientoAlertaRemota) return;
    const ahoraMs = this.ahora().getTime();
    const candidatos = alertas.flatMap((alerta) => [
      alerta.estadoPresentacion === 'activaEnOrigen'
        ? alerta.frescura?.vigenteHastaOrigenUtc : null,
      alerta.descarteLocal?.vigente
        ? alerta.descarteLocal?.descartadaHastaUtc : null
    ]).filter((valor) => Number.isFinite(Date.parse(String(valor || ''))) &&
      Date.parse(String(valor)) > ahoraMs);
    candidatos.sort((a, b) => Date.parse(a) - Date.parse(b));
    if (candidatos[0]) {
      this.difusor.programarVencimientoAlertaRemota(candidatos[0]);
    }
  }
}

function vacio({ permiso, preferencia, puedeGestionarDescartes = false,
  incluirCerradas = false }) {
  return Object.freeze({ permiso, preferencia, puedeGestionarDescartes,
    totalActuales: 0, totalVisibles: 0,
    totalDescartadas: 0, totalSinVigencia: 0,
    alertasVisibles: Object.freeze([]), alertasDescartadas: Object.freeze([]),
    alertasSinVigencia: Object.freeze([]),
    ...(incluirCerradas ? {
      totalCerradas: 0,
      alertasCerradas: Object.freeze([])
    } : {})
  });
}
function normalizarHasta(v, ahora) {
  if (v == null || String(v).trim() === '') return null;
  const f = new Date(v);
  if (Number.isNaN(f.getTime()) || f <= ahora) throw errorDominio('VIGENCIA_INVALIDA', 'La fecha de reactivación debe estar en el futuro.', 400);
  return f.toISOString();
}
function sanearAlerta(a) {
  return Object.freeze({ ...a, payload: sanear(a.payload) });
}
function sanear(v, profundidad = 0) {
  if (v == null || typeof v === 'boolean' || typeof v === 'number') return v;
  if (typeof v === 'string') return v.slice(0, 1000);
  if (profundidad >= 5) return '[contenido acotado]';
  if (Array.isArray(v)) return v.slice(0, 30).map((x) => sanear(x, profundidad + 1));
  return Object.fromEntries(Object.entries(v).filter(([k]) => !/(?:secret|token|password|credencial|cookie|authorization)/iu.test(k))
    .slice(0, 60).map(([k,x]) => [k, sanear(x, profundidad + 1)]));
}
function errorDominio(codigo, mensaje, statusCode) { return Object.assign(new Error(mensaje), { codigo, statusCode }); }
function decimal(v) { return v == null ? null : String(v); }

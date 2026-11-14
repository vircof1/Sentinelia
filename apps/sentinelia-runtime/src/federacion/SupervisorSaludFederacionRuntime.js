import { generarUuidV7Auditoria } from '../../../../paquetes/auditoria/src/UuidV7Auditoria.js';

const DIAGNOSTICOS = Object.freeze([
  Object.freeze({
    versionCatalogo: 1,
    tipoCodigo: 'comunicacion',
    causaCodigo: 'relacion_silenciosa',
    estaActivo: (relacion) => relacion.comunicacion === 'silenciosa'
  }),
  Object.freeze({
    versionCatalogo: 2,
    tipoCodigo: 'compatibilidad',
    causaCodigo: 'version_federada_incompatible',
    estaActivo: (relacion) => relacion.compatibilidad === 'incompatible'
  })
]);

export class SupervisorSaludFederacionRuntime {
  constructor({ repositorioSalud, servicioAvisos, resolverConfiguracion,
    procesadorTiempoEstadosRemotos = null,
    generarEventoId = generarUuidV7Auditoria, reloj = () => Date.now() } = {}) {
    exigirMetodo(repositorioSalud, 'obtenerFotografia', 'repositorioSalud');
    exigirMetodo(repositorioSalud, 'prepararTransicionDiagnostico', 'repositorioSalud');
    exigirMetodo(repositorioSalud, 'confirmarTransicionDiagnostico', 'repositorioSalud');
    exigirMetodo(servicioAvisos, 'detectar', 'servicioAvisos');
    exigirMetodo(servicioAvisos, 'resolver', 'servicioAvisos');
    if (typeof resolverConfiguracion !== 'function') {
      throw new Error('La supervisión de salud requiere configuración dinámica.');
    }
    if (procesadorTiempoEstadosRemotos !== null) {
      for (const metodo of [
        'iniciarTrasRehidratacion','procesar','listarAvisosPendientes','confirmarAviso'
      ]) {
        exigirMetodo(procesadorTiempoEstadosRemotos, metodo, 'procesadorTiempoEstadosRemotos');
      }
    }
    this.repositorioSalud = repositorioSalud;
    this.servicioAvisos = servicioAvisos;
    this.resolverConfiguracion = resolverConfiguracion;
    this.generarEventoId = generarEventoId;
    this.reloj = reloj;
    this.iniciadoEnMs = reloj();
    this.procesadorTiempoEstadosRemotos = procesadorTiempoEstadosRemotos;
    this.consolidacionRemota = null;
  }

  async marcarRehidratacionCompleta({ bootId } = {}) {
    this.iniciadoEnMs = this.reloj();
    if (!this.procesadorTiempoEstadosRemotos) return null;
    const configuracion = await this.resolverConfiguracion();
    this.consolidacionRemota = await this.procesadorTiempoEstadosRemotos
      .iniciarTrasRehidratacion({
        bootId,
        consolidacionReinicioMs: configuracion.consolidacionReinicioMs
      });
    return this.consolidacionRemota;
  }

  async evaluar() {
    const configuracion = await this.resolverConfiguracion();
    const tiempoEstadosRemotos = this.procesadorTiempoEstadosRemotos &&
      this.consolidacionRemota
      ? await this.procesadorTiempoEstadosRemotos.procesar()
      : null;
    const avisosEstadosRemotos = tiempoEstadosRemotos
      ? await this.#sincronizarAvisosEstadosRemotos()
      : Object.freeze([]);
    const fotografia = await this.repositorioSalud.obtenerFotografia({
      silencioRelacionMs: configuracion.silencioRelacionMs
    });
    const consolidandoReinicio = tiempoEstadosRemotos
      ? tiempoEstadosRemotos.ciclo.estado === 'abierto'
      : this.reloj() - this.iniciadoEnMs <
        validarConsolidacion(configuracion.consolidacionReinicioMs);
    const federacionActivada = configuracion.activacionFederacion !== false;
    const resultados = [];
    for (const relacion of fotografia.relaciones) {
      for (const diagnostico of DIAGNOSTICOS) {
        if (diagnostico.tipoCodigo === 'comunicacion') {
          const comunicadaTrasRehidratacion = this.consolidacionRemota !== null &&
            relacion.ultimaComunicacionUtc !== null &&
            Date.parse(relacion.ultimaComunicacionUtc) >=
              Date.parse(this.consolidacionRemota.iniciadoEnUtc);
          if (consolidandoReinicio) {
            if (this.consolidacionRemota && !comunicadaTrasRehidratacion) {
              continue;
            }
            const resultado = await this.#sincronizar(
              relacion,
              diagnostico,
              federacionActivada,
              false
            );
            if (resultado) resultados.push(resultado);
            continue;
          }
          if (this.consolidacionRemota) {
            const resultado = await this.#sincronizar(
              relacion,
              diagnostico,
              federacionActivada,
              relacion.supervisable && !comunicadaTrasRehidratacion
            );
            if (resultado) resultados.push(resultado);
            continue;
          }
        }
        const resultado = await this.#sincronizar(
          relacion,
          diagnostico,
          federacionActivada
        );
        if (resultado) resultados.push(resultado);
      }
    }
    return Object.freeze({
      fotografia,
      totalTransiciones: resultados.length,
      totalAperturas: resultados.filter((r) => r.activa).length,
      totalResoluciones: resultados.filter((r) => !r.activa).length,
      resultados: Object.freeze(resultados),
      tiempoEstadosRemotos,
      avisosEstadosRemotos,
      consolidandoReinicio,
      federacionActivada
    });
  }

  async #sincronizarAvisosEstadosRemotos() {
    const pendientes = await this.procesadorTiempoEstadosRemotos
      .listarAvisosPendientes({ limite: 100 });
    const resultados = [];
    for (const pendiente of pendientes) {
      const base = {
        eventoId: pendiente.eventoAvisoId,
        correlacionId: pendiente.eventoAvisoId,
        efectivoEnUtc: pendiente.efectivoEnUtc,
        causalidad: null,
        actor: { tipo: 'runtime', id: 'sentinelia-runtime' },
        claveCausal: {
          versionCatalogo: 3,
          tipoCodigo: 'tiempo',
          causaCodigo: 'estado_remoto_vencido',
          objetoTipo: 'monitor_remoto',
          objetoId: pendiente.proyeccionId,
          relacionId: pendiente.relacionId,
          flujoId: pendiente.flujoId,
          scope: pendiente.scope
        }
      };
      const resultado = pendiente.operacion === 'detectar'
        ? await this.servicioAvisos.detectar({
            ...base,
            contextoHumano: {
              installationOrigenId: pendiente.installationOrigenId,
              monitorOrigenId: pendiente.monitorOrigenId,
              elementoOrigenId: pendiente.elementoOrigenId
            },
            resumen: {
              condicion: pendiente.condicionNueva,
              estadoOperativo: pendiente.estadoOperativo,
              vigenteHastaEfectivaUtc: pendiente.vigenteHastaEfectivaUtc
            }
          })
        : await this.servicioAvisos.resolver({
            ...base,
            viaResolucion: 'causa_desaparecida'
          });
      await this.procesadorTiempoEstadosRemotos.confirmarAviso({
        transicionId: pendiente.transicionId
      });
      resultados.push(Object.freeze({
        transicionId: pendiente.transicionId,
        operacion: pendiente.operacion,
        estado: resultado?.estado ?? null
      }));
    }
    return Object.freeze(resultados);
  }

  async #sincronizar(
    relacion,
    diagnostico,
    federacionActivada,
    condicionForzada = null
  ) {
    const transicion = await this.repositorioSalud.prepararTransicionDiagnostico({
      relacionId: relacion.relacionId,
      versionCatalogo: diagnostico.versionCatalogo,
      tipoCodigo: diagnostico.tipoCodigo,
      causaCodigo: diagnostico.causaCodigo,
      activa: federacionActivada && (condicionForzada ?? diagnostico.estaActivo(relacion)),
      generarEventoId: this.generarEventoId
    });
    if (!transicion) return null;
    const base = {
      eventoId: transicion.eventoId,
      correlacionId: transicion.eventoId,
      efectivoEnUtc: transicion.efectivoEnUtc,
      causalidad: null,
      actor: { tipo: 'runtime', id: 'sentinelia-runtime' },
      claveCausal: {
        versionCatalogo: diagnostico.versionCatalogo,
        tipoCodigo: diagnostico.tipoCodigo,
        causaCodigo: diagnostico.causaCodigo,
        objetoTipo: 'relacion_federada',
        objetoId: relacion.relacionId,
        relacionId: relacion.relacionId,
        flujoId: null,
        scope: relacion.scope
      }
    };
    if (transicion.activa) {
      await this.servicioAvisos.detectar({
        ...base,
        contextoHumano: {
          relacionId: relacion.relacionId,
          installationRemotaId: relacion.installationRemotaId,
          nombreRemoto: relacion.nombreRemoto
        },
        resumen: diagnostico.tipoCodigo === 'comunicacion'
          ? { estado: relacion.comunicacion, silencioMs: String(relacion.silencioMs) }
          : { estado: relacion.compatibilidad }
      });
    } else {
      await this.servicioAvisos.resolver({ ...base, viaResolucion: 'causa_desaparecida' });
    }
    await this.repositorioSalud.confirmarTransicionDiagnostico({
      relacionId: relacion.relacionId,
      versionCatalogo: diagnostico.versionCatalogo,
      tipoCodigo: diagnostico.tipoCodigo,
      causaCodigo: diagnostico.causaCodigo,
      eventoId: transicion.eventoId
    });
    return Object.freeze({
      relacionId: relacion.relacionId,
      causaCodigo: diagnostico.causaCodigo,
      activa: transicion.activa,
      repetida: transicion.repetida
    });
  }
}

function validarConsolidacion(valor) {
  if (!Number.isSafeInteger(valor) || valor < 0 || valor > 3_600_000) {
    throw new Error('consolidacionReinicioMs no es válido.');
  }
  return valor;
}

function exigirMetodo(valor, metodo, campo) {
  if (typeof valor?.[metodo] !== 'function') throw new Error(`${campo} requiere ${metodo}().`);
}

import { createHash } from 'node:crypto';

import {
  ESTADOS_PERFIL_SERVIDOR_AGENTE
} from '../../../../paquetes/agentes/src/ContratoPerfilServidorAgente.js';
import { generarUuidV7Auditoria }
  from '../../../../paquetes/auditoria/src/UuidV7Auditoria.js';
import { PERFIL_JCS_AUDITORIA_V1 }
  from '../../../../paquetes/auditoria/src/PerfilJcsAuditoria.js';
import { VERSION_ENCADENADO_AUDITORIA_V1 }
  from '../../../../paquetes/auditoria/src/SobreCanonicoAuditoria.js';

const SENAL_SIN_POL = 'runtime.servidor.sin_pol';
const SENAL_REINICIO = 'runtime.servidor.reinicio_reciente';

export class ProcesadorSenalesServidorRuntime {
  constructor({
    repositorioEstadoRuntime,
    publicadorTelemetriaRuntime,
    fronteraTransaccional,
    coordinadorRedis = null,
    publicadorAvisosEvaluacion = null,
    publicadorInvalidacionesMonitores = null,
    servicioRetiradaPerfilServidor = null,
    repositorioOutboxAuditoriaRuntime = null,
    runtimeActorId = 'sentinelia-runtime',
    loteMaximo = 50,
    reloj = () => new Date()
  } = {}) {
    if (
      typeof repositorioEstadoRuntime?.bloquearCandidatosEnTransaccion !==
      'function'
    ) {
      throw new Error('El procesador servidor requiere su proyección SQL.');
    }
    if (
      typeof repositorioEstadoRuntime?.bloquearCandidatosPolEnTransaccion !==
      'function'
    ) {
      throw new Error('El procesador servidor requiere reconciliación POL durable.');
    }
    if (
      typeof publicadorTelemetriaRuntime?.publicarTransicionesEnTransaccion !==
      'function'
    ) {
      throw new Error('El procesador servidor requiere el publicador de telemetría runtime.');
    }
    if (typeof fronteraTransaccional?.ejecutar !== 'function') {
      throw new Error('El procesador servidor requiere una frontera transaccional.');
    }
    const repositorioDetectaIncompatibles = typeof repositorioEstadoRuntime
      ?.bloquearCandidatosIncompatiblesEnTransaccion === 'function';
    const servicioRetiraIncompatibles = typeof servicioRetiradaPerfilServidor
      ?.retirarEnTransaccion === 'function';
    const auditaIncompatibles = typeof repositorioOutboxAuditoriaRuntime
      ?.encolarEnTransaccion === 'function';
    if (repositorioDetectaIncompatibles !== servicioRetiraIncompatibles) {
      throw new Error(
        'La desactivación incompatible exige detector y retirada transaccional juntos.'
      );
    }
    if (servicioRetiraIncompatibles !== auditaIncompatibles) {
      throw new Error(
        'La desactivación incompatible exige retirada y outbox auditable juntas.'
      );
    }
    this.repositorio = repositorioEstadoRuntime;
    this.publicador = publicadorTelemetriaRuntime;
    this.fronteraTransaccional = fronteraTransaccional;
    this.coordinadorRedis = coordinadorRedis;
    this.publicadorAvisosEvaluacion = publicadorAvisosEvaluacion;
    this.publicadorInvalidacionesMonitores = publicadorInvalidacionesMonitores;
    this.servicioRetiradaPerfilServidor = servicioRetiradaPerfilServidor;
    this.repositorioOutboxAuditoriaRuntime =
      repositorioOutboxAuditoriaRuntime;
    this.runtimeActorId = String(runtimeActorId || '').trim() ||
      'sentinelia-runtime';
    this.loteMaximo = enteroAcotado(loteMaximo, 1, 250, 'loteMaximo');
    this.reloj = reloj;
    this.ejecucionEnCurso = null;
  }

  async procesarPendientes({ origen = 'tick', numeroTick = null } = {}) {
    if (this.ejecucionEnCurso) return this.ejecucionEnCurso;
    this.ejecucionEnCurso = this.procesarPendientesInterno({
      origen,
      numeroTick
    }).finally(() => {
      this.ejecucionEnCurso = null;
    });
    return this.ejecucionEnCurso;
  }

  // auditoria-productor: runtime.agentes.perfil_servidor
  async procesarPendientesInterno({ origen, numeroTick }) {
    const ahora = this.reloj();
    const transaccion = await this.fronteraTransaccional.ejecutar(
      async (conexion) => {
        const estados = [];
        const observaciones = [];
        const trabajosEvaluacionIds = [];
        const fotografiasActualizadas = [];
        let proyeccionesCreadas = 0;
        let transicionesReutilizadas = 0;
        let perfilesArmados = 0;
        let evidenciasPolReducidas = 0;
        let reiniciosDetectados = 0;
        let ventanasReinicioDescartadas = 0;
        const retiradasPerfilServidor = [];
        let polAgotado = false;
        const perfilesConPolReducido = new Set();

        if (this.servicioRetiradaPerfilServidor) {
          const incompatibles = await this.repositorio
            .bloquearCandidatosIncompatiblesEnTransaccion({
              limite: this.loteMaximo
            }, { conexion });
          for (const candidato of incompatibles) {
            const retirada = await this.servicioRetiradaPerfilServidor
              .retirarEnTransaccion({
                agenteId: candidato.perfil.agenteId,
                generacion: candidato.perfil.generacion,
                estadoFinal:
                  ESTADOS_PERFIL_SERVIDOR_AGENTE.DESACTIVADO_INCOMPATIBLE,
                codigoCierre: candidato.evidencia.codigo,
                detalleCierre: construirDetalleIncompatibilidad(
                  candidato.evidencia
                ),
                cerradaEnUtc: ahora
              }, { conexion });
            if (retirada.retirada) {
              await this.repositorioOutboxAuditoriaRuntime
                .encolarEnTransaccion([
                  construirIntencionAuditoriaDesactivacion({
                    candidato,
                    retirada,
                    runtimeActorId: this.runtimeActorId,
                    efectivaEnUtc: ahora
                  })
                ], { conexion });
              retiradasPerfilServidor.push(retirada);
            }
          }
        }

        while (evidenciasPolReducidas < this.loteMaximo) {
          const candidatosPol = await this.repositorio
            .bloquearCandidatosPolEnTransaccion({
              limite: this.loteMaximo - evidenciasPolReducidas
            }, { conexion });
          if (candidatosPol.length === 0) {
            polAgotado = true;
            break;
          }

          for (const candidato of candidatosPol) {
            let estado = candidato.estado;
            if (!estado) {
              estado = await this.repositorio.crearParaPerfilEnTransaccion(
                { perfil: candidato.perfil },
                { conexion }
              );
              proyeccionesCreadas += 1;
            }

            const reduccion = construirReduccionPol({
              perfil: candidato.perfil,
              estado,
              evidencia: candidato.evidencia,
              ahora
            });
            if (!reduccion) {
              throw new Error(
                'La evidencia POL bloqueada no produjo un avance causal.'
              );
            }

            const materializacion = await this.materializarDecisiones({
              perfil: candidato.perfil,
              decisiones: reduccion.transiciones,
              checkpointBase: reduccion.checkpointBase,
              ahora,
              conexion,
              observaciones,
              trabajosEvaluacionIds,
              fotografiasActualizadas
            });
            transicionesReutilizadas +=
              materializacion.transicionesReutilizadas;
            estado = await this.repositorio.aplicarPolEnTransaccion({
              agenteId: candidato.perfil.agenteId,
              generacion: candidato.perfil.generacion,
              armarPerfil: reduccion.armarPerfil,
              armadaEnUtc: reduccion.armadaEnUtc,
              bootIdReferencia: reduccion.bootIdReferencia,
              reemplazarBootIdReferencia:
                reduccion.reemplazarBootIdReferencia,
              periodoVidaPolId: candidato.evidencia.periodoVidaPolId,
              ultimoSeq: reduccion.ultimaPresencia.seq,
              ultimoPolUtc: reduccion.ultimaPresencia.observadoEnUtc,
              tipoUltimoPol: reduccion.ultimaPresencia.tipo,
              valorSinPol: reduccion.valorSinPol,
              venceSinPolUtc: reduccion.venceSinPolUtc,
              histeresisSinPolCapturadaSegundos:
                reduccion.histeresisSinPolCapturadaSegundos,
              valorReinicioReciente: reduccion.valorReinicioReciente,
              venceReinicioRecienteUtc:
                reduccion.venceReinicioRecienteUtc,
              duracionReinicioCapturadaSegundos:
                reduccion.duracionReinicioCapturadaSegundos,
              ultimoCambioBootIdUtc: reduccion.ultimoCambioBootIdUtc,
              checkpointCausal:
                materializacion.ultimaClaveCausal || reduccion.checkpointBase
            }, { conexion });
            evidenciasPolReducidas += 1;
            reiniciosDetectados += reduccion.reinicioDetectado ? 1 : 0;
            ventanasReinicioDescartadas +=
              reduccion.ventanaReinicioDescartada ? 1 : 0;
            if (reduccion.armarPerfil) perfilesArmados += 1;
            perfilesConPolReducido.add(clavePerfil(candidato.perfil));
            estados.push(serializar(estado));
          }
        }

        const candidatos = await this.repositorio
          .bloquearCandidatosEnTransaccion({
            ahoraUtc: ahora,
            limite: this.loteMaximo
          }, { conexion });

        for (const candidato of candidatos) {
          let estado = candidato.estado;
          if (!estado) {
            estado = await this.repositorio.crearParaPerfilEnTransaccion(
              { perfil: candidato.perfil },
              { conexion }
            );
            proyeccionesCreadas += 1;
          }

          if (
            !polAgotado &&
            perfilesConPolReducido.has(clavePerfil(candidato.perfil))
          ) {
            estados.push(serializar(estado));
            continue;
          }

          if (candidato.perfil.estado !== ESTADOS_PERFIL_SERVIDOR_AGENTE.ACTIVO) {
            estados.push(serializar(estado));
            continue;
          }

          const decisiones = construirDecisionesVencidas({ estado, ahora });
          if (!decisiones.resolverSinPol && !decisiones.resolverReinicioReciente) {
            estados.push(serializar(estado));
            continue;
          }

          const checkpointBase = construirCheckpointBase(estado);
          const materializacion = await this.materializarDecisiones({
            perfil: candidato.perfil,
            decisiones: decisiones.transiciones,
            checkpointBase,
            ahora,
            conexion,
            observaciones,
            trabajosEvaluacionIds,
            fotografiasActualizadas
          });
          transicionesReutilizadas += materializacion.transicionesReutilizadas;

          const checkpointFinal = materializacion.ultimaClaveCausal ||
            construirCheckpointVencimiento({ estado, decisiones });
          estado = await this.repositorio.resolverVencimientosEnTransaccion({
            agenteId: candidato.perfil.agenteId,
            generacion: candidato.perfil.generacion,
            resolverSinPol: decisiones.resolverSinPol,
            resolverReinicioReciente: decisiones.resolverReinicioReciente,
            checkpointCausal: checkpointFinal
          }, { conexion });
          estados.push(serializar(estado));
        }

        return {
          totalCandidatos:
            retiradasPerfilServidor.length + evidenciasPolReducidas +
            candidatos.length,
          totalCandidatosPol: evidenciasPolReducidas,
          totalCandidatosVencimiento: candidatos.length,
          proyeccionesCreadas,
          transicionesReutilizadas,
          perfilesArmados,
          evidenciasPolReducidas,
          reiniciosDetectados,
          ventanasReinicioDescartadas,
          retiradasPerfilServidor,
          estados: deduplicarEstados(estados),
          observaciones,
          trabajosEvaluacionIds: [...new Set(trabajosEvaluacionIds.map(String))],
          fotografiasActualizadas: deduplicarFotografias(fotografiasActualizadas)
        };
      }
    );

    const efectosPostCommit = await this.publicarEfectosPostCommit(transaccion);
    return Object.freeze({
      origen,
      numeroTick,
      procesadoEnUtc: ahora.toISOString(),
      loteMaximo: this.loteMaximo,
      totalCandidatos: transaccion.totalCandidatos,
      totalCandidatosPol: transaccion.totalCandidatosPol,
      totalCandidatosVencimiento: transaccion.totalCandidatosVencimiento,
      totalPerfilesDesactivadosIncompatibles:
        transaccion.retiradasPerfilServidor.length,
      totalProyeccionesCreadas: transaccion.proyeccionesCreadas,
      totalPerfilesArmados: transaccion.perfilesArmados,
      totalEvidenciasPolReducidas: transaccion.evidenciasPolReducidas,
      totalReiniciosDetectados: transaccion.reiniciosDetectados,
      totalVentanasReinicioDescartadas:
        transaccion.ventanasReinicioDescartadas,
      totalTransiciones: transaccion.observaciones.length,
      totalTransicionesReutilizadas: transaccion.transicionesReutilizadas,
      estados: Object.freeze(transaccion.estados),
      observaciones: Object.freeze(transaccion.observaciones),
      efectosPostCommit
    });
  }

  async materializarDecisiones({
    perfil,
    decisiones,
    checkpointBase,
    ahora,
    conexion,
    observaciones,
    trabajosEvaluacionIds,
    fotografiasActualizadas
  }) {
    const pendientes = [];
    let ultimaClaveCausal = null;
    let transicionesReutilizadas = 0;
    for (const decision of decisiones) {
      const claveCausal = construirClaveCausal({
        agenteId: perfil.agenteId,
        generacion: perfil.generacion,
        checkpointBase,
        ...decision
      });
      ultimaClaveCausal = claveCausal;
      const registro = await this.repositorio.registrarTransicionEnTransaccion({
        agenteId: perfil.agenteId,
        generacion: perfil.generacion,
        claveCausal,
        codigoSenal: decision.codigoSenal,
        valor: decision.valor,
        causa: decision.causa,
        efectivaEnUtc: decision.efectivaEnUtc,
        checkpointCausal: checkpointBase
      }, { conexion });
      if (estaMaterializada(registro.transicion)) {
        transicionesReutilizadas += 1;
        continue;
      }
      pendientes.push({ decision, claveCausal, transicion: registro.transicion });
    }

    if (pendientes.length > 0) {
      const publicacion = await this.publicador.publicarTransicionesEnTransaccion({
        agenteId: perfil.agenteId,
        emitidoEnUtc: ahora,
        recibidoEnUtc: ahora,
        requestId: `perfil-servidor:${pendientes[0].claveCausal}`,
        transiciones: pendientes.map(({ decision, claveCausal }) => ({
          codigoSenal: decision.codigoSenal,
          valor: decision.valor,
          observadoEnUtc: decision.efectivaEnUtc,
          vigenteHastaUtc: decision.vigenteHastaUtc || null,
          detalleHumano: decision.detalleHumano,
          metadatos: {
            productor: 'sentinelia-runtime',
            contrato: 'perfil-servidor-v1',
            generacion: perfil.generacion,
            causa: decision.causa,
            claveCausal,
            checkpoint: checkpointBase,
            ...(decision.metadatos || {})
          }
        }))
      }, { conexion });
      const insertadas = publicacion.persistencia?.observaciones || [];
      if (insertadas.length !== pendientes.length) {
        throw new Error(
          'La publicación runtime no devolvió todas las observaciones causales.'
        );
      }
      for (const [indice, pendiente] of pendientes.entries()) {
        await this.repositorio.confirmarTransicionEnTransaccion({
          transicionId: pendiente.transicion.id,
          observacionTelemetriaId: insertadas[indice].id,
          materializadaEnUtc: ahora
        }, { conexion });
        observaciones.push(insertadas[indice]);
      }
      trabajosEvaluacionIds.push(
        ...(publicacion.efectosPostCommit?.trabajosEvaluacionIds || [])
      );
      fotografiasActualizadas.push(
        ...(publicacion.efectosPostCommit?.fotografiasActualizadas || [])
      );
    }

    return { ultimaClaveCausal, transicionesReutilizadas };
  }

  async rehidratarCoordinacion({ limite = 250 } = {}) {
    if (!this.coordinadorRedis) {
      return Object.freeze({ activa: false, totalProyecciones: 0, paginas: 0 });
    }
    let despuesAgenteId = 0;
    let despuesGeneracion = 0;
    let totalProyecciones = 0;
    let paginas = 0;

    while (true) {
      const estados = await this.repositorio.listarProyeccionesVigentes({
        despuesAgenteId,
        despuesGeneracion,
        limite
      });
      if (estados.length === 0) break;
      try {
        await this.coordinadorRedis.sincronizarProyecciones({
          estados,
          motivo: 'rehidratacion_sql'
        });
      } catch (error) {
        return Object.freeze({
          activa: false,
          degradada: true,
          totalProyecciones,
          paginas,
          error: String(error?.message || 'Redis no pudo rehidratar la agenda.')
        });
      }
      totalProyecciones += estados.length;
      paginas += 1;
      const ultimo = estados.at(-1);
      despuesAgenteId = ultimo.agenteId;
      despuesGeneracion = ultimo.generacion;
      if (estados.length < limite) break;
    }

    return Object.freeze({ activa: true, totalProyecciones, paginas });
  }

  async publicarEfectosPostCommit(resultado) {
    const efectos = {
      coordinacionRedis: await ejecutarEfectoSeguro(
        () => this.coordinadorRedis?.sincronizarProyecciones({
          estados: resultado.estados,
          motivo: 'reduccion_vencimientos'
        }),
        'coordinador_no_configurado'
      ),
      avisoEvaluaciones: await ejecutarEfectoSeguro(
        () => resultado.trabajosEvaluacionIds.length > 0
          ? this.publicadorAvisosEvaluacion?.publicarTrabajosPendientes({
              totalTrabajos: resultado.trabajosEvaluacionIds.length
            })
          : null,
        resultado.trabajosEvaluacionIds.length === 0
          ? 'sin_trabajos'
          : 'publicador_no_configurado'
      ),
      invalidacionMonitores: await ejecutarEfectoSeguro(
        () => resultado.fotografiasActualizadas.length > 0
          ? this.publicadorInvalidacionesMonitores
              ?.publicarFotografiasActualizadas({
                fotografias: resultado.fotografiasActualizadas
              })
          : null,
        resultado.fotografiasActualizadas.length === 0
          ? 'sin_fotografias'
          : 'publicador_no_configurado'
      ),
      retiradaCoordinacionRedis: await ejecutarEfectoSeguro(
        () => resultado.retiradasPerfilServidor.length > 0
          ? this.coordinadorRedis?.retirarProyecciones({
              perfiles: resultado.retiradasPerfilServidor.map((retirada) => ({
                agenteId: retirada.agenteId,
                generacion: retirada.generacion
              })),
              motivo: 'perfil_desactivado_incompatible'
            })
          : null,
        resultado.retiradasPerfilServidor.length === 0
          ? 'sin_retiradas'
          : 'coordinador_no_configurado'
      ),
      invalidacionMonitoresRetiradaDirecta: await ejecutarEfectoSeguro(
        () => {
          const fotografias = resultado.retiradasPerfilServidor.flatMap(
            ({ fotografiasRetiradas }) => fotografiasRetiradas
          );
          return fotografias.length > 0
            ? this.publicadorInvalidacionesMonitores
                ?.publicarFotografiasActualizadas({ fotografias })
            : null;
        },
        resultado.retiradasPerfilServidor.some(
          ({ fotografiasRetiradas }) => fotografiasRetiradas.length > 0
        ) ? 'publicador_no_configurado' : 'sin_fotografias_retiradas'
      ),
      invalidacionMonitoresRetiradaReglas: await ejecutarEfectoSeguro(
        () => {
          const estados = resultado.retiradasPerfilServidor.flatMap(
            ({ estadosReglasRetirados }) => estadosReglasRetirados
          );
          return estados.length > 0
            ? this.publicadorInvalidacionesMonitores
                ?.publicarEstadosReglasActualizados({ estados })
            : null;
        },
        resultado.retiradasPerfilServidor.some(
          ({ estadosReglasRetirados }) => estadosReglasRetirados.length > 0
        ) ? 'publicador_no_configurado' : 'sin_estados_reglas_retirados'
      )
    };
    return Object.freeze(efectos);
  }
}

function construirDetalleIncompatibilidad(evidencia) {
  const explicaciones = {
    pol_boot_id_ausente:
      'La evidencia durable posterior a la promoción no contiene bootId.',
    pol_heartbeat_incompleto:
      'La evidencia durable declara heartbeats sin fecha o secuencia completa.',
    pol_login_incoherente:
      'La evidencia durable de login contiene datos de heartbeat incoherentes.',
    pol_cronologia_incompatible:
      'La evidencia durable sitúa el último heartbeat antes del login.'
  };
  const explicacion = explicaciones[evidencia.codigo] ||
    'La evidencia durable posterior a la promoción viola el contrato POL.';
  return `${explicacion} Periodo POL #${evidencia.periodoVidaPolId}.`;
}

function construirIntencionAuditoriaDesactivacion({
  candidato,
  retirada,
  runtimeActorId,
  efectivaEnUtc
}) {
  const eventoId = generarUuidV7Auditoria();
  const agente = candidato.agente;
  if (!agente?.tenantId || !agente?.empresaId || !agente?.sitioId) {
    throw new Error(
      'La desactivación incompatible exige el scope durable del agente.'
    );
  }
  const tenantId = String(agente.tenantId);
  return {
    versionContrato: 1,
    eventoId,
    tipo: 'agente.perfil_servidor_desactivado',
    flujo: 'agentes',
    claveCadena: `agentes:tenant:${tenantId}`,
    actor: 'runtime',
    actorReal: { tipo: 'runtime', id: runtimeActorId },
    actorEfectivo: null,
    modoActuacion: 'directo',
    sujeto: { tipo: 'agente', id: String(retirada.agenteId) },
    origen: 'runtime',
    correlacionId: eventoId,
    causalidad: null,
    productor: 'runtime_agentes',
    claveOperacion:
      `perfil-servidor:${retirada.agenteId}:${retirada.generacion}:desactivado`,
    scope: {
      tenantId,
      empresaId: String(agente.empresaId),
      sitioId: String(agente.sitioId)
    },
    efectivoEnUtc: efectivaEnUtc.toISOString(),
    rolEvento: 'principal',
    payload: {
      estadoAntes: candidato.perfil.estado,
      estadoDespues: ESTADOS_PERFIL_SERVIDOR_AGENTE.DESACTIVADO_INCOMPATIBLE,
      motivo: candidato.evidencia.codigo
    },
    versionCanonicalizador: PERFIL_JCS_AUDITORIA_V1,
    versionEncadenado: VERSION_ENCADENADO_AUDITORIA_V1
  };
}

function construirDecisionesVencidas({ estado, ahora }) {
  const venceSinPol = haVencido(estado.venceSinPolUtc, ahora);
  const venceReinicio = haVencido(estado.venceReinicioRecienteUtc, ahora);
  const transiciones = [];
  if (venceSinPol && estado.valorSinPol === false) {
    transiciones.push({
      codigoSenal: SENAL_SIN_POL,
      valor: true,
      causa: 'histeresis_vencida',
      efectivaEnUtc: estado.venceSinPolUtc,
      detalleHumano: 'Venció la histéresis sin una nueva prueba de vida.'
    });
  }
  if (venceReinicio && estado.valorReinicioReciente === true) {
    transiciones.push({
      codigoSenal: SENAL_REINICIO,
      valor: false,
      causa: 'ventana_reinicio_vencida',
      efectivaEnUtc: estado.venceReinicioRecienteUtc,
      detalleHumano: 'Terminó la ventana configurada de reinicio reciente.'
    });
  }
  return {
    resolverSinPol: venceSinPol,
    resolverReinicioReciente: venceReinicio,
    transiciones
  };
}

function construirReduccionPol({ perfil, estado, evidencia, ahora }) {
  const pendiente =
    perfil.estado === ESTADOS_PERFIL_SERVIDOR_AGENTE.PENDIENTE_PRIMERA_EVIDENCIA;
  const primeraPosterior = evidencia.obtenerPrimeraPresenciaPosterior(
    perfil.generadaEnUtc
  );
  if (pendiente && !primeraPosterior) return null;

  const ultimaPresencia = evidencia.obtenerUltimaPresencia();
  const primeraNueva = pendiente
    ? primeraPosterior
    : obtenerPrimeraPresenciaNoProcesada({ estado, evidencia });
  const establecerReferencia = !estado.bootIdReferencia;
  const cambioBootId = Boolean(estado.bootIdReferencia) &&
    estado.bootIdReferencia !== evidencia.bootId;
  if (!primeraNueva && !establecerReferencia && !cambioBootId) return null;

  const checkpointBase = [
    `pol:${evidencia.periodoVidaPolId}`,
    `seq:${ultimaPresencia.seq ?? 'login'}`,
    `tipo:${ultimaPresencia.tipo}`,
    `utc:${ultimaPresencia.observadoEnUtc}`,
    cambioBootId ? 'boot:cambio' : 'boot:estable',
    `estado:${estado.versionEstado}`
  ].join('|').slice(0, 190);
  const metadatosPol = {
    periodoVidaPolId: evidencia.periodoVidaPolId,
    tipoPol: primeraNueva?.tipo || ultimaPresencia.tipo,
    seq: primeraNueva ? primeraNueva.seq : ultimaPresencia.seq
  };
  const metadatosReinicio = {
    periodoVidaPolId: evidencia.periodoVidaPolId,
    tipoPol: 'login',
    seq: null
  };
  const transiciones = [];
  let valorSinPol = estado.valorSinPol;
  let venceSinPolUtc = estado.venceSinPolUtc;
  let histeresisSinPolCapturadaSegundos =
    estado.histeresisSinPolCapturadaSegundos;
  let valorReinicioReciente = estado.valorReinicioReciente;
  let venceReinicioRecienteUtc = estado.venceReinicioRecienteUtc;
  let duracionReinicioCapturadaSegundos =
    estado.duracionReinicioCapturadaSegundos;
  let ultimoCambioBootIdUtc = estado.ultimoCambioBootIdUtc;
  let reinicioDetectado = false;
  let ventanaReinicioDescartada = false;

  if (pendiente) {
    valorSinPol = false;
    valorReinicioReciente = false;
    venceSinPolUtc = sumarSegundos(
      ultimaPresencia.observadoEnUtc,
      perfil.histeresisSinPolSegundos
    );
    histeresisSinPolCapturadaSegundos =
      perfil.histeresisSinPolSegundos;
    transiciones.push(
      {
        codigoSenal: SENAL_SIN_POL,
        valor: false,
        causa: 'armado_inicial',
        efectivaEnUtc: primeraNueva.observadoEnUtc,
        detalleHumano:
          'El perfil servidor quedó armado con una prueba de vida posterior a su promoción.',
        metadatos: metadatosPol
      },
      {
        codigoSenal: SENAL_REINICIO,
        valor: false,
        causa: 'armado_inicial',
        efectivaEnUtc: primeraNueva.observadoEnUtc,
        detalleHumano:
          'El primer bootId válido estableció la referencia inicial del servidor.',
        metadatos: metadatosReinicio
      }
    );
  } else if (primeraNueva) {
    const nuevoVencimientoSinPol = sumarSegundos(
      ultimaPresencia.observadoEnUtc,
      perfil.histeresisSinPolSegundos
    );
    histeresisSinPolCapturadaSegundos =
      perfil.histeresisSinPolSegundos;
    if (
      estado.valorSinPol === true &&
      Date.parse(nuevoVencimientoSinPol) > ahora.getTime()
    ) {
      transiciones.push({
        codigoSenal: SENAL_SIN_POL,
        valor: false,
        causa: 'pol_recuperado',
        efectivaEnUtc: primeraNueva.observadoEnUtc,
        detalleHumano: 'Una nueva prueba de vida terminó la ausencia declarada.',
        metadatos: metadatosPol
      });
      valorSinPol = false;
      venceSinPolUtc = nuevoVencimientoSinPol;
    } else if (estado.valorSinPol === true) {
      valorSinPol = true;
      venceSinPolUtc = null;
    } else {
      valorSinPol = false;
      venceSinPolUtc = nuevoVencimientoSinPol;
    }
  }

  if (!pendiente && cambioBootId) {
    const cambioBootIdUtc = evidencia.inicioUtc;
    const nuevoVencimientoReinicio = sumarSegundos(
      cambioBootIdUtc,
      perfil.duracionReinicioRecienteSegundos
    );
    ultimoCambioBootIdUtc = cambioBootIdUtc;
    if (Date.parse(nuevoVencimientoReinicio) > ahora.getTime()) {
      transiciones.push({
        codigoSenal: SENAL_REINICIO,
        valor: true,
        causa: 'boot_id_cambiado',
        efectivaEnUtc: cambioBootIdUtc,
        vigenteHastaUtc: nuevoVencimientoReinicio,
        detalleHumano:
          'Sentinelia observó un cambio de identidad de arranque del servidor.',
        metadatos: metadatosReinicio
      });
      valorReinicioReciente = true;
      venceReinicioRecienteUtc = nuevoVencimientoReinicio;
      duracionReinicioCapturadaSegundos =
        perfil.duracionReinicioRecienteSegundos;
      reinicioDetectado = true;
    } else {
      ventanaReinicioDescartada = true;
    }
  }

  return {
    armarPerfil: pendiente,
    armadaEnUtc: pendiente ? primeraNueva.observadoEnUtc : null,
    bootIdReferencia: establecerReferencia || cambioBootId
      ? evidencia.bootId
      : estado.bootIdReferencia,
    reemplazarBootIdReferencia: establecerReferencia || cambioBootId,
    ultimaPresencia,
    valorSinPol,
    venceSinPolUtc,
    histeresisSinPolCapturadaSegundos,
    valorReinicioReciente,
    venceReinicioRecienteUtc,
    duracionReinicioCapturadaSegundos,
    ultimoCambioBootIdUtc,
    reinicioDetectado,
    ventanaReinicioDescartada,
    checkpointBase,
    transiciones
  };
}

function obtenerPrimeraPresenciaNoProcesada({ estado, evidencia }) {
  const periodoAnterior = Number(estado.ultimoPeriodoPolId || 0);
  if (evidencia.periodoVidaPolId > periodoAnterior) {
    return Object.freeze({
      tipo: 'login',
      observadoEnUtc: evidencia.inicioUtc,
      seq: null
    });
  }
  if (evidencia.periodoVidaPolId === periodoAnterior) {
    const ultima = evidencia.obtenerUltimaPresencia();
    const seqAnterior = estado.ultimoSeq;
    if (
      ultima.tipo === 'heartbeat' &&
      (seqAnterior === null || ultima.seq > seqAnterior)
    ) {
      return ultima;
    }
  }
  return null;
}

function sumarSegundos(marcaUtc, segundos) {
  const inicio = Date.parse(String(marcaUtc || ''));
  const duracion = Number(segundos);
  if (!Number.isFinite(inicio) || !Number.isSafeInteger(duracion) || duracion <= 0) {
    throw new Error('No se puede programar la histéresis del POL recibido.');
  }
  return new Date(inicio + duracion * 1000).toISOString();
}

function construirCheckpointBase(estado) {
  return [
    `estado:${estado.versionEstado}`,
    `periodo:${estado.ultimoPeriodoPolId || 'ninguno'}`,
    `seq:${estado.ultimoSeq ?? 'ninguna'}`,
    `anterior:${estado.checkpointCausal || 'inicio'}`
  ].join('|').slice(0, 190);
}

function construirClaveCausal(datos) {
  return createHash('sha256').update(JSON.stringify([
    Number(datos.agenteId),
    Number(datos.generacion),
    datos.codigoSenal,
    datos.valor,
    datos.causa,
    new Date(datos.efectivaEnUtc).toISOString(),
    datos.checkpointBase
  ])).digest('hex');
}

function construirCheckpointVencimiento({ estado, decisiones }) {
  return [
    `vencimiento:${estado.versionEstado}`,
    decisiones.resolverSinPol ? `sin_pol:${estado.venceSinPolUtc}` : null,
    decisiones.resolverReinicioReciente
      ? `reinicio:${estado.venceReinicioRecienteUtc}`
      : null
  ].filter(Boolean).join('|').slice(0, 190);
}

function haVencido(valor, ahora) {
  return Boolean(valor) && Date.parse(valor) <= ahora.getTime();
}

function estaMaterializada(transicion) {
  return typeof transicion?.estaMaterializada === 'function'
    ? transicion.estaMaterializada()
    : Boolean(
        transicion?.materializadaEnUtc &&
        transicion?.observacionTelemetriaId
      );
}

function deduplicarFotografias(fotografias) {
  const unicas = new Map();
  for (const fotografia of fotografias) {
    unicas.set(`${fotografia.agenteId}:${fotografia.senalId}`, fotografia);
  }
  return [...unicas.values()];
}

function deduplicarEstados(estados) {
  const unicos = new Map();
  for (const estado of estados) {
    unicos.set(`${estado.agenteId}:${estado.generacion}`, estado);
  }
  return [...unicos.values()];
}

function clavePerfil(perfil) {
  return `${perfil.agenteId}:${perfil.generacion}`;
}

async function ejecutarEfectoSeguro(operacion, motivoOmitido) {
  try {
    const resultado = await operacion();
    return resultado || { ejecutado: false, motivo: motivoOmitido };
  } catch (error) {
    return {
      ejecutado: false,
      motivo: 'error_postcommit',
      error: String(error?.message || 'Falló un efecto postcommit.')
    };
  }
}

function serializar(valor) {
  return typeof valor?.serializar === 'function' ? valor.serializar() : { ...valor };
}

function enteroAcotado(valor, minimo, maximo, campo) {
  const numero = Number(valor);
  if (!Number.isInteger(numero) || numero < minimo || numero > maximo) {
    throw new Error(`${campo} debe estar entre ${minimo} y ${maximo}.`);
  }
  return numero;
}

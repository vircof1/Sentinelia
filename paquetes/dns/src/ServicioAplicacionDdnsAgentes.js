import { createHash, timingSafeEqual } from 'node:crypto';

import { canonicalizarJcsAuditoriaV1 } from '../../auditoria/src/PerfilJcsAuditoria.js';
import {
  bytesAUuidV7Auditoria,
  generarUuidV7Auditoria,
  validarUuidV7Auditoria,
  uuidV7AuditoriaABytes
} from '../../auditoria/src/UuidV7Auditoria.js';
import { PoliticaPermisosAgentes } from '../../agentes/src/PoliticaPermisosAgentes.js';
import { ResolutorScopeUsuario } from '../../contexto-usuario/src/ResolutorScopeUsuario.js';
import { FronteraTransaccionalLocal } from '../../persistencia-sql/src/FronteraTransaccionalLocal.js';
import { RegistroDns } from './RegistroDns.js';
import { ZonaDns } from './ZonaDns.js';
import { RepositorioConcesionesDdnsAgentes } from './RepositorioConcesionesDdnsAgentes.js';
import {
  ErrorRepositorioCausalDdns,
  RepositorioCausalDdnsAgentes
} from './RepositorioCausalDdnsAgentes.js';
import {
  PERFILES_DDNS_AGENTES,
  VERSION_CONTRATO_DDNS_AGENTES,
  crearResultadoDdnsAgentes,
  crearSolicitudHttpDdnsAgentes,
  crearSolicitudDdnsAgentes,
  serializarCanonicoDdnsAgentes,
  validarSolicitudHttpDdnsAgentes
} from './ContratoDdnsAgentes.js';
import { evaluarElegibilidadConcesionDdnsAgentes } from './PoliticaElegibilidadDdnsAgentes.js';
import { canonicalizarEstadoDeseadoDdnsAgentes } from './ValidadorEstadoDdnsAgentes.js';
import {
  construirIntencionAuditoriaDdns
} from './EventosAuditoriaDdnsAgentes.js';

export class ErrorAplicacionDdnsAgentes extends Error {
  constructor(mensaje, codigo) {
    super(mensaje);
    this.name = 'ErrorAplicacionDdnsAgentes';
    this.codigo = codigo;
  }
}

export class ServicioAplicacionDdnsAgentes {
  constructor({
    clienteSql,
    repositorioUsuarios,
    repositorioConcesiones = new RepositorioConcesionesDdnsAgentes(clienteSql),
    repositorioCausal = new RepositorioCausalDdnsAgentes(clienteSql),
    resolutorScopeUsuario = new ResolutorScopeUsuario(),
    politicaPermisosAgentes = new PoliticaPermisosAgentes(),
    repositorioCoordinacionGeneracionesDns = null,
    servicioDns = null,
    servicioAuditoria = null,
    repositorioOutboxAuditoria = null,
    generarConcesionId = generarUuidV7Auditoria,
    generarIntencionId = generarUuidV7Auditoria,
    generarEventoAuditoriaId = generarUuidV7Auditoria
  } = {}) {
    if (
      typeof clienteSql?.obtenerConexion !== 'function' ||
      typeof repositorioUsuarios?.buscarPorIdEnTransaccion !== 'function' ||
      typeof repositorioConcesiones?.crearConcesionEnTransaccion !== 'function' ||
      typeof repositorioConcesiones?.cerrarConcesionEnTransaccion !== 'function' ||
      typeof repositorioConcesiones?.buscarPorConcesionIdEnTransaccion !== 'function' ||
      typeof repositorioConcesiones?.buscarVigentePorRegistroIdEnTransaccion !== 'function' ||
      typeof repositorioCausal?.ejecutarConFotografiaBloqueada !== 'function' ||
      typeof repositorioCausal?.crearIntencionAceptadaEnTransaccion !== 'function' ||
      typeof repositorioCausal?.buscarIntencionPolPorCausaEnTransaccion !== 'function' ||
      typeof repositorioCausal?.crearIntencionPolAceptadaEnTransaccion !== 'function' ||
      typeof repositorioCausal?.establecerIntencionGobernanteEnTransaccion !== 'function' ||
      typeof repositorioCausal?.registrarSolicitudEnTransaccion !== 'function' ||
      typeof repositorioCausal?.sustituirIntencionGobernanteEnTransaccion !== 'function' ||
      typeof resolutorScopeUsuario?.resolverNivelScope !== 'function' ||
      typeof politicaPermisosAgentes?.puedeAlcanzarAgente !== 'function' ||
      typeof generarConcesionId !== 'function' ||
      typeof generarIntencionId !== 'function' ||
      typeof generarEventoAuditoriaId !== 'function' ||
      (servicioAuditoria !== null &&
        typeof servicioAuditoria?.registrarEnTransaccion !== 'function') ||
      (repositorioOutboxAuditoria !== null &&
        typeof repositorioOutboxAuditoria?.encolarEnTransaccion !== 'function')
    ) {
      throw new TypeError('La aplicación DDNS requiere sus puertos autoritativos completos.');
    }
    this.clienteSql = clienteSql;
    this.frontera = new FronteraTransaccionalLocal(clienteSql);
    this.repositorioUsuarios = repositorioUsuarios;
    this.repositorioConcesiones = repositorioConcesiones;
    this.repositorioCausal = repositorioCausal;
    this.resolutorScopeUsuario = resolutorScopeUsuario;
    this.politicaPermisosAgentes = politicaPermisosAgentes;
    this.repositorioCoordinacionGeneracionesDns =
      repositorioCoordinacionGeneracionesDns;
    this.servicioDns = servicioDns;
    this.servicioAuditoria = servicioAuditoria;
    this.repositorioOutboxAuditoria = repositorioOutboxAuditoria;
    this.generarConcesionId = generarConcesionId;
    this.generarIntencionId = generarIntencionId;
    this.generarEventoAuditoriaId = generarEventoAuditoriaId;
  }

  async aceptarIntencionExplicita({
    contextoSesionTecnica,
    concesionId,
    solicitud: solicitudEntrada
  } = {}) {
    const agenteId = idPositivo(
      contextoSesionTecnica?.sesion?.agenteId,
      'contextoSesionTecnica.sesion.agenteId'
    );
    let solicitud;
    try {
      solicitud = crearSolicitudDdnsAgentes(solicitudEntrada);
    } catch {
      return resultadoDdns({ resultado: 'rechazada', error: 'valor_no_interpretable' });
    }

    const aplicacion = await this.#aceptarIntencionPreparada({
      agenteId,
      concesionId,
      solicitudId: solicitud.solicitudId,
      prepararSolicitud: () => solicitud
    });
    return aplicacion.resultado;
  }

  async aceptarIntencionPublica({
    contextoSesionTecnica,
    concesionId,
    solicitud: solicitudEntrada
  } = {}) {
    const agenteId = idPositivo(
      contextoSesionTecnica?.sesion?.agenteId,
      'contextoSesionTecnica.sesion.agenteId'
    );
    if (!esUuidV7(concesionId)) {
      return resultadoAplicacionPublica(
        resultadoDdns({ resultado: 'rechazada', error: 'sin_autoridad' })
      );
    }
    let solicitudId;
    try {
      solicitudId = validarSolicitudPublicaBasica(solicitudEntrada);
    } catch {
      return resultadoAplicacionPublica(
        resultadoDdns({ resultado: 'rechazada', error: 'valor_no_interpretable' })
      );
    }
    return this.#aceptarIntencionPreparada({
      agenteId,
      concesionId,
      solicitudId,
      prepararSolicitud: (registro) =>
        crearSolicitudHttpDdnsAgentes(solicitudEntrada, registro?.tipo)
    });
  }

  async #aceptarIntencionPreparada({
    agenteId,
    concesionId,
    solicitudId,
    prepararSolicitud
  }) {

    try {
      let debeInvalidarCatalogo = false;
      const resultado = await this.repositorioCausal.ejecutarConFotografiaBloqueada({
        concesionId,
        agenteId,
        solicitudId
      }, async ({ conexion, fotografia }) => {
        const {
          concesion,
          registro,
          intencionGobernante,
          intencionSolicitud,
          solicitud: previa
        } = fotografia;
        if (!previa && concesion.estado !== 'vigente') {
          return resultadoAplicacionPublica(
            resultadoDdns({ resultado: 'rechazada', error: 'sin_autoridad' })
          );
        }
        let solicitud;
        try {
          solicitud = prepararSolicitud(registro);
        } catch {
          return resultadoAplicacionPublica(resultadoDdns({
            resultado: 'rechazada', version: concesion.version,
            condicion: concesion.condicionOperativa,
            error: 'valor_no_interpretable'
          }));
        }
        const cuerpoCanonico = serializarCanonicoDdnsAgentes(solicitud);
        const cuerpoSha256 = createHash('sha256')
          .update(cuerpoCanonico, 'utf8').digest();
        const responder = (entrada) => resultadoAplicacionPublica(
          resultadoDdns(entrada),
          solicitud.estadoDeseado
        );
        if (previa) {
          if (!huellasIguales(previa.cuerpoCanonicoSha256, cuerpoSha256) ||
              previa.concesionInternaId !== concesion.idInterno) {
            return responder({
              resultado: 'rechazada', version: concesion.version,
              condicion: concesion.condicionOperativa,
              error: 'idempotencia_conflictiva'
            });
          }
          return responder({
            resultado: 'repetida', version: concesion.version,
            hito: intencionSolicitud?.hito ?? 'intencion_aceptada',
            condicion: concesion.condicionOperativa,
            terminal: intencionSolicitud?.terminal ?? null
          });
        }
        if (!concesionVigenteYOperable(concesion, registro)) {
          return responder({
            resultado: 'rechazada', version: concesion.version,
            condicion: concesion.condicionOperativa,
            error: 'registro_no_operable'
          });
        }
        if (solicitud.estadoDeseado.tipo !== registro.tipo) {
          return responder({
            resultado: 'rechazada', version: concesion.version,
            condicion: concesion.condicionOperativa,
            error: 'valor_no_interpretable'
          });
        }

        const estadoCanonico = serializarCanonicoDdnsAgentes(solicitud.estadoDeseado);
        const estadoSha256 = createHash('sha256').update(estadoCanonico, 'utf8').digest();
        if (intencionGobernante &&
            huellasIguales(intencionGobernante.estadoDeseadoSha256, estadoSha256)) {
          const resultado = intencionGobernante.terminal === null
            ? 'convergente'
            : 'sin_cambios';
          await this.repositorioCausal.registrarSolicitudEnTransaccion({
            solicitudId: solicitud.solicitudId,
            agenteId,
            concesionInternaId: concesion.idInterno,
            cuerpoCanonicoSha256: cuerpoSha256,
            intencionInternaId: intencionGobernante.idInterno,
            resultado,
            estadoHttp: 200
          }, { conexion });
          return responder({
            resultado, version: concesion.version,
            hito: intencionGobernante.hito,
            condicion: concesion.condicionOperativa,
            terminal: intencionGobernante.terminal
          });
        }
        if (solicitud.versionEsperada !== concesion.version) {
          return responder({
            resultado: 'rechazada', version: concesion.version,
            condicion: concesion.condicionOperativa,
            error: 'version_obsoleta'
          });
        }

        const version = incrementarVersionDdns(concesion.version);
        await this.#encolarTerminalSustituida({
          conexion,
          concesion,
          registro,
          intencion: intencionGobernante
        });
        await this.repositorioCausal.sustituirIntencionGobernanteEnTransaccion({
          intencionInternaId: intencionGobernante?.idInterno ?? null
        }, { conexion });
        const intencionId = this.generarIntencionId();
        const intencionInternaId = await this.repositorioCausal
          .crearIntencionAceptadaEnTransaccion({
            intencionId,
            concesion,
            solicitudId: solicitud.solicitudId,
            version,
            estadoDeseadoCanonico: solicitud.estadoDeseado,
            estadoDeseadoSha256: estadoSha256
          }, { conexion });
        const condicion = solicitud.estadoDeseado.modo === 'observada'
          ? 'esperando_observacion'
          : 'operativa';
        await this.repositorioCausal.establecerIntencionGobernanteEnTransaccion({
          concesionInternaId: concesion.idInterno,
          versionEsperada: concesion.version,
          version,
          modo: solicitud.estadoDeseado.modo,
          intencionInternaId,
          condicionOperativa: condicion
        }, { conexion });
        let hito = 'intencion_aceptada';
        let persistencia = null;
        if (solicitud.estadoDeseado.modo === 'declarada') {
          persistencia = await persistirContenidoDeseadoDeclarado({
            conexion,
            repositorioCoordinacionGeneracionesDns:
              this.repositorioCoordinacionGeneracionesDns,
            concesion,
            registro,
            intencionInternaId,
            version,
            estadoDeseado: solicitud.estadoDeseado,
            estadoCanonico,
            estadoSha256,
            // Una intención nueva necesita confirmación causal propia también
            // al volver de observada a declarada con el mismo valor DNS.
            // Los replays y las intenciones equivalentes retornan antes.
            forzarPublicacion: true
          });
          debeInvalidarCatalogo ||= persistencia.generacionCreada;
          hito = 'contenido_deseado_persistido';
        }
        await this.#registrarAceptacionYResultado({
          conexion,
          actorReal: { tipo: 'agente', id: agenteId },
          productorAceptacion: 'api_agentes',
          claveAceptacion: `ddns:solicitud:${solicitud.solicitudId}`,
          concesion,
          registro,
          intencionId,
          version,
          estadoAnterior: concesion.contenidoDeseado,
          estadoPosterior: solicitud.estadoDeseado,
          origenIntencion: 'agente_explicita',
          generacionDns: persistencia?.generacionDns ?? null,
          contenidoPersistido: persistencia !== null
        });
        await this.repositorioCausal.registrarSolicitudEnTransaccion({
          solicitudId: solicitud.solicitudId,
          agenteId,
          concesionInternaId: concesion.idInterno,
          cuerpoCanonicoSha256: cuerpoSha256,
          intencionInternaId,
          resultado: 'aceptada',
          estadoHttp: 202
        }, { conexion });
        return responder({
          resultado: 'aceptada', version,
          hito, condicion
        });
      });
      if (debeInvalidarCatalogo &&
          typeof this.servicioDns?.invalidarCatalogoDns === 'function') {
        await this.servicioDns.invalidarCatalogoDns().catch(() => {});
      }
      return resultado;
    } catch (error) {
      if (error instanceof ErrorRepositorioCausalDdns &&
          ['concesion_no_encontrada', 'concesion_ajena'].includes(error.codigo)) {
        return resultadoAplicacionPublica(
          resultadoDdns({ resultado: 'rechazada', error: 'sin_autoridad' })
        );
      }
      throw error;
    }
  }

  async aplicarObservacionPol({ causa, concesion: candidata } = {}) {
    const causaPol = normalizarCausaPol(causa);
    const concesionId = candidata?.concesionId;
    if (typeof concesionId !== 'string' || !concesionId) {
      throw new TypeError('La aplicación POL DDNS requiere una concesión candidata.');
    }
    let debeInvalidarCatalogo = false;
    let resultado;
    try {
      resultado = await this.repositorioCausal.ejecutarConFotografiaBloqueada({
        concesionId,
        agenteId: causaPol.agenteId
      }, async ({ conexion, fotografia }) => {
      const { concesion, registro, intencionGobernante } = fotografia;
      const repetida = await this.repositorioCausal
        .buscarIntencionPolPorCausaEnTransaccion({
          concesionInternaId: concesion.idInterno,
          causaId: causaPol.causaId
        }, { conexion });
      if (repetida) {
        return resultadoObservacionPol('repetida', repetida.version, repetida.intencionId);
      }
      if (!mismaFotografiaCandidata(candidata, concesion) ||
          !concesionVigenteYOperable(concesion, registro) ||
          concesion.decision !== 'operativa' ||
          concesion.modo !== 'observada' ||
          !intencionGobernante ||
          ![null, 'publicada'].includes(intencionGobernante.terminal) ||
          intencionGobernante.modo !== 'observada' ||
          intencionGobernante.version !== concesion.version) {
        return resultadoObservacionPol('descartada', concesion.version, null,
          'fotografia_obsoleta');
      }
      if (!precedePol(intencionGobernante.aceptadaEnUtc, causaPol.aceptadaEnUtc)) {
        return resultadoObservacionPol('descartada', concesion.version, null,
          'modo_posterior_al_pol');
      }
      const familiaRegistro = registro.tipo === 'A' ? 'ipv4'
        : registro.tipo === 'AAAA' ? 'ipv6' : null;
      if (familiaRegistro === null || familiaRegistro !== causaPol.familiaDireccion) {
        return resultadoObservacionPol('descartada', concesion.version, null,
          'familia_no_aplicable');
      }

      const estadoDeseado = canonicalizarEstadoDeseadoDdnsAgentes({
        tipo: registro.tipo,
        modo: 'observada',
        valor: registro.tipo === 'A'
          ? { direccionIpv4: causaPol.direccionRemota }
          : { direccionIpv6: causaPol.direccionRemota }
      }, { admitirContenidoObservado: true });
      const estadoCanonico = canonicalizarJcsAuditoriaV1(estadoDeseado);
      const estadoSha256 = createHash('sha256').update(estadoCanonico, 'utf8').digest();
      const esperaObservacion = intencionGobernante.hito === 'intencion_aceptada';
      if (!esperaObservacion &&
          huellasIguales(concesion.contenidoDeseadoSha256, estadoSha256)) {
        return resultadoObservacionPol('sin_cambios', concesion.version);
      }

      const version = incrementarVersionDdns(concesion.version);
      if (intencionGobernante.terminal === null) {
        await this.#encolarTerminalSustituida({
          conexion,
          concesion,
          registro,
          intencion: intencionGobernante
        });
        await this.repositorioCausal.sustituirIntencionGobernanteEnTransaccion({
          intencionInternaId: intencionGobernante.idInterno
        }, { conexion });
      }
      const intencionId = this.generarIntencionId();
      const intencionInternaId = await this.repositorioCausal
        .crearIntencionPolAceptadaEnTransaccion({
          intencionId,
          concesion,
          causaId: causaPol.causaId,
          version,
          estadoDeseadoCanonico: estadoDeseado,
          estadoDeseadoSha256: estadoSha256
        }, { conexion });
      await this.repositorioCausal.establecerIntencionGobernanteEnTransaccion({
        concesionInternaId: concesion.idInterno,
        versionEsperada: concesion.version,
        version,
        modo: 'observada',
        intencionInternaId,
        condicionOperativa: 'operativa'
      }, { conexion });
      const persistencia = await persistirContenidoDeseadoDeclarado({
        conexion,
        repositorioCoordinacionGeneracionesDns:
          this.repositorioCoordinacionGeneracionesDns,
        concesion,
        registro,
        intencionInternaId,
        version,
        estadoDeseado,
        estadoCanonico,
        estadoSha256,
        // La nueva decisión observada necesita evidencia de publicación propia,
        // aunque este POL posterior confirme la misma dirección que la anterior.
        forzarPublicacion: esperaObservacion
      });
      debeInvalidarCatalogo ||= persistencia.generacionCreada;
      await this.#registrarAceptacionYResultado({
        conexion,
        actorReal: { tipo: 'runtime', id: 'sentinelia-runtime' },
        productorAceptacion: 'runtime_automatizacion',
        claveAceptacion: `ddns:pol:${causaPol.causaId}:${concesion.concesionId}`,
        concesion,
        registro,
        intencionId,
        version,
        estadoAnterior: concesion.contenidoDeseado,
        estadoPosterior: estadoDeseado,
        origenIntencion: 'pol_observada',
        generacionDns: persistencia.generacionDns ?? null,
        contenidoPersistido: true,
        forzarOutboxAceptacion: true
      });
        return resultadoObservacionPol('aceptada', version, intencionId);
      });
    } catch (error) {
      if (error instanceof ErrorRepositorioCausalDdns &&
          ['concesion_no_encontrada', 'concesion_ajena'].includes(error.codigo)) {
        return resultadoObservacionPol('descartada', candidata?.version ?? '0', null,
          'sin_autoridad');
      }
      throw error;
    }
    if (debeInvalidarCatalogo &&
        typeof this.servicioDns?.invalidarCatalogoDns === 'function') {
      await this.servicioDns.invalidarCatalogoDns().catch(() => {});
    }
    return resultado;
  }

  async crearConcesion({ contextoUsuarioActual, agenteId, registroDnsId } = {}) {
    exigirPermisos(contextoUsuarioActual);
    const actorRealId = idPositivo(
      contextoUsuarioActual?.idUsuarioReal ?? contextoUsuarioActual?.idUsuario,
      'contextoUsuarioActual.idUsuarioReal'
    );
    const actorEfectivoId = idPositivo(
      contextoUsuarioActual?.idUsuario,
      'contextoUsuarioActual.idUsuario'
    );
    const agente = idPositivo(agenteId, 'agenteId');
    const registro = idPositivo(registroDnsId, 'registroDnsId');
    const concesionId = this.generarConcesionId();

    return this.frontera.ejecutar((conexion) =>
      this.crearConcesionEnTransaccion({
        actorRealId,
        actorEfectivoId,
        agenteId: agente,
        registroDnsId: registro,
        concesionId
      }, { conexion })
    );
  }

  async actualizarScopeAgenteEnTransaccion({
    contextoUsuarioActual,
    agenteId,
    scopePosterior
  } = {}, { conexion } = {}) {
    return this.#actualizarScopeConcesionesEnTransaccion({
      contextoUsuarioActual,
      extremo: 'agente',
      identidad: agenteId,
      scopePosterior
    }, conexion);
  }

  async actualizarScopeRegistrosZonaEnTransaccion({
    contextoUsuarioActual,
    zonaId,
    scopePosterior
  } = {}, { conexion } = {}) {
    return this.#actualizarScopeConcesionesEnTransaccion({
      contextoUsuarioActual,
      extremo: 'registro',
      identidad: zonaId,
      scopePosterior
    }, conexion);
  }

  async cerrarObjetivoRegistroEnTransaccion({
    contextoUsuarioActual,
    registroDnsId,
    terminal,
    desacoplar = false
  } = {}, { conexion } = {}) {
    exigirConexion(conexion);
    const registroId = idPositivo(registroDnsId, 'registroDnsId');
    const concesion = await this.repositorioConcesiones
      .buscarVigentePorRegistroIdEnTransaccion(registroId, {
        conexion,
        forUpdate: true
      });
    if (!concesion) {
      if (desacoplar) {
        await this.repositorioConcesiones
          .desacoplarRegistrosCerradosPorObjetivoEnTransaccion({
            registroDnsId: registroId
          }, { conexion });
      }
      return Object.freeze({ cerrada: false, concesion: null });
    }
    const resultadoTerminal = await this.repositorioCausal
      .terminarObjetivoEnTransaccion({
        intencionInternaId: concesion.intencionGobernanteId,
        terminal
      }, { conexion });
    const causa = terminal === 'objetivo_eliminado'
      ? 'registro_eliminado'
      : 'objetivo_incompatible';
    const cerrada = await this.repositorioConcesiones.cerrarConcesionEnTransaccion({
      concesionId: concesion.concesionId,
      causa
    }, { conexion });
    const actorRealId = idPositivo(
      contextoUsuarioActual?.idUsuarioReal ?? contextoUsuarioActual?.idUsuario,
      'contextoUsuarioActual.idUsuarioReal'
    );
    const actorEfectivoId = idPositivo(
      contextoUsuarioActual?.idUsuario,
      'contextoUsuarioActual.idUsuario'
    );
    await this.#registrarAuditoriaDirecta({
      conexion,
      tipo: 'ddns.concesion_revocada',
      actorRealId,
      actorEfectivoId,
      sujetoId: cerrada.concesionId,
      scope: cerrada.scopeRegistro,
      correlacionId: cerrada.concesionId,
      claveOperacion: `ddns:objetivo:${cerrada.concesionId}:${terminal}`,
      payload: payloadDdns({
        resultado: 'revocada',
        modo: cerrada.modo,
        estadoAnterior: cerrada.contenidoDeseado,
        versionDdns: cerrada.version,
        causa,
        agenteId: cerrada.agenteIdFotografia,
        registroDnsId: cerrada.registroDnsIdFotografia,
        extremo: 'registro'
      })
    });
    if (resultadoTerminal.terminada) {
      const intencion = resultadoTerminal.intencion;
      await this.#encolarAuditoriaRuntime([
        construirIntencionAuditoriaDdns({
          eventoId: this.generarEventoAuditoriaId(),
          tipo: 'ddns.intencion_terminada',
          actorReal: { tipo: 'runtime', id: 'sentinelia-runtime' },
          sujetoId: intencion.intencionId,
          scope: cerrada.scopeRegistro,
          correlacionId: intencion.intencionId,
          causalidadIntencionId: intencion.intencionId,
          productor: 'runtime_dns',
          claveOperacion:
            `ddns:terminal:${cerrada.concesionId}:${intencion.version}:${terminal}`,
          rolEvento: 'resultado',
          payload: payloadDdns({
            resultado: terminal,
            modo: intencion.modo,
            estadoPosterior: intencion.estadoDeseado,
            versionDdns: intencion.version,
            origenIntencion: intencion.origen,
            causa,
            agenteId: intencion.agenteIdFotografia,
            registroDnsId: intencion.registroDnsIdFotografia
          })
        })
      ], conexion);
    }
    if (desacoplar) {
      await this.repositorioConcesiones
        .desacoplarRegistrosCerradosPorObjetivoEnTransaccion({
          registroDnsId: registroId
        }, { conexion });
    }
    return Object.freeze({
      cerrada: true,
      concesion: cerrada,
      intencionTerminada: resultadoTerminal.terminada
    });
  }

  async cerrarObjetivosZonaEnTransaccion({
    contextoUsuarioActual,
    zonaId
  } = {}, { conexion } = {}) {
    exigirConexion(conexion);
    const concesiones = await this.repositorioConcesiones
      .listarVigentesPorZonaEnTransaccion(zonaId, { conexion });
    const resultados = [];
    for (const concesion of concesiones) {
      resultados.push(await this.cerrarObjetivoRegistroEnTransaccion({
        contextoUsuarioActual,
        registroDnsId: concesion.registroDnsId,
        terminal: 'objetivo_eliminado',
        desacoplar: true
      }, { conexion }));
    }
    await this.repositorioConcesiones
      .desacoplarRegistrosCerradosPorObjetivoEnTransaccion({ zonaId }, {
        conexion
      });
    return Object.freeze(resultados);
  }

  async crearConcesionEnTransaccion({
    actorRealId,
    actorEfectivoId = actorRealId,
    agenteId,
    registroDnsId,
    concesionId
  } = {}, { conexion } = {}) {
    exigirConexion(conexion);
    const realId = idPositivo(actorRealId, 'actorRealId');
    const efectivoId = idPositivo(actorEfectivoId, 'actorEfectivoId');
    const agenteObjetivoId = idPositivo(agenteId, 'agenteId');
    const registroObjetivoId = idPositivo(registroDnsId, 'registroDnsId');
    const autoridades = await this.#bloquearAutoridades(
      [realId, efectivoId],
      conexion
    );

    const agente = await bloquearAgente(conexion, agenteObjetivoId);
    if (!agente) fallarAutoridad();
    const zonaIdObservada = await observarZonaRegistro(conexion, registroObjetivoId);
    if (zonaIdObservada === null) fallarAutoridad();
    const zona = await bloquearZona(conexion, zonaIdObservada);
    const registro = await bloquearRegistro(conexion, registroObjetivoId);
    if (!zona || !registro || String(registro.zonaId) !== zonaIdObservada) {
      throw new ErrorAplicacionDdnsAgentes(
        'El objetivo DNS cambió durante la creación de la concesión.',
        'objetivo_dns_concurrente'
      );
    }

    for (const autoridad of autoridades.values()) {
      exigirPermisos(autoridad);
      if (!this.politicaPermisosAgentes.puedeAlcanzarAgente(autoridad, agente) ||
          !puedeAlcanzarScope(autoridad, registro)) {
        fallarAutoridad();
      }
    }

    const [vigentes] = await conexion.execute(
      `SELECT id FROM concesiones_ddns_agentes
        WHERE registro_dns_id=? AND estado='vigente' FOR UPDATE`,
      [registroObjetivoId]
    );
    const elegibilidad = evaluarElegibilidadConcesionDdnsAgentes({
      registro,
      zona,
      existeConcesionVigente: vigentes.length > 0
    });
    if (!elegibilidad.elegible) {
      throw new ErrorAplicacionDdnsAgentes(
        `El registro no admite la concesión DDNS: ${elegibilidad.causas.join(', ')}.`,
        'registro_no_elegible'
      );
    }

    const contenido = fotografiarContenidoRegistro(registro);
    const publicacion = await resolverPublicacionPrevia({ conexion, zona });
    const concesion = await this.repositorioConcesiones.crearConcesionEnTransaccion({
      concesionId,
      agenteId: agenteObjetivoId,
      registroDnsId: registroObjetivoId,
      contenidoDeseadoCanonico: contenido.canonico,
      contenidoDeseadoSha256: contenido.huella,
      contenidoPublicadoCanonico: publicacion.confirmada ? contenido.canonico : null,
      contenidoPublicadoSha256: publicacion.confirmada ? contenido.huella : null,
      generacionDnsPublicada: publicacion.generacion,
      condicionOperativa: publicacion.confirmada
        ? 'pendiente_decision_agente'
        : 'publicacion_previa_desconocida'
    }, { conexion });
    await this.#registrarAuditoriaDirecta({
      conexion,
      tipo: 'ddns.concesion_creada',
      actorRealId: realId,
      actorEfectivoId: efectivoId,
      sujetoId: concesion.concesionId,
      scope: concesion.scopeRegistro,
      correlacionId: concesion.concesionId,
      claveOperacion: `ddns:concesion:crear:${concesion.concesionId}`,
      payload: payloadDdns({
        resultado: 'creada',
        tipoRegistro: registro.tipoRegistro,
        estadoPosterior: contenido.estado,
        agenteId: concesion.agenteIdFotografia,
        registroDnsId: concesion.registroDnsIdFotografia
      })
    });
    return concesion;
  }

  async revocarDesdeAgente({
    contextoUsuarioActual,
    agenteId,
    concesionId
  } = {}) {
    exigirPermisoAgente(contextoUsuarioActual);
    return this.#revocar({
      contextoUsuarioActual,
      concesionId,
      extremo: 'agente',
      extremoId: idPositivo(agenteId, 'agenteId'),
      causa: 'revocada_desde_agente'
    });
  }

  async revocarDesdeRegistro({
    contextoUsuarioActual,
    registroDnsId,
    concesionId
  } = {}) {
    exigirPermisoRegistro(contextoUsuarioActual);
    return this.#revocar({
      contextoUsuarioActual,
      concesionId,
      extremo: 'registro',
      extremoId: idPositivo(registroDnsId, 'registroDnsId'),
      causa: 'revocada_desde_registro'
    });
  }

  async editarValorGobernado({
    contextoUsuarioActual,
    registroDnsId,
    valorPrincipal,
    prioridad = null
  } = {}) {
    exigirPermisoRegistro(contextoUsuarioActual);
    const actorRealId = idPositivo(
      contextoUsuarioActual?.idUsuarioReal ?? contextoUsuarioActual?.idUsuario,
      'contextoUsuarioActual.idUsuarioReal'
    );
    const actorEfectivoId = idPositivo(
      contextoUsuarioActual?.idUsuario,
      'contextoUsuarioActual.idUsuario'
    );
    return this.frontera.ejecutar((conexion) =>
      this.editarValorGobernadoEnTransaccion({
        actorRealId,
        actorEfectivoId,
        registroDnsId,
        valorPrincipal,
        prioridad
      }, { conexion })
    );
  }

  async editarValorGobernadoEnTransaccion({
    actorRealId,
    actorEfectivoId = actorRealId,
    registroDnsId,
    valorPrincipal,
    prioridad = null
  } = {}, { conexion } = {}) {
    exigirConexion(conexion);
    const realId = idPositivo(actorRealId, 'actorRealId');
    const efectivoId = idPositivo(actorEfectivoId, 'actorEfectivoId');
    const registroId = idPositivo(registroDnsId, 'registroDnsId');
    const autoridades = await this.#bloquearAutoridades(
      [realId, efectivoId],
      conexion
    );
    const concesion = await this.repositorioConcesiones
      .buscarVigentePorRegistroIdEnTransaccion(registroId, {
        conexion,
        forUpdate: true
      });
    if (!concesion) {
      return Object.freeze({ gobernado: false, cambioEfectivo: false });
    }

    const registro = await bloquearRegistro(conexion, registroId);
    if (!registro) fallarAutoridad();
    for (const autoridad of autoridades.values()) {
      exigirPermisoRegistro(autoridad);
      if (!puedeAlcanzarScope(autoridad, registro)) fallarAutoridad();
    }
    if (!registro.activo || !registro.publicarEnBind ||
        registro.categoriaOrigen !== 'ddns' ||
        concesion.decision !== 'operativa' ||
        concesion.modo === null || concesion.intencionGobernanteId === null) {
      throw new ErrorAplicacionDdnsAgentes(
        'El registro concedido todavía no admite una edición humana del valor.',
        'registro_no_operable'
      );
    }

    const estado = canonicalizarContenidoHumano({
      tipo: registro.tipoRegistro,
      modo: concesion.modo,
      valorPrincipal,
      prioridad
    });
    const canonico = canonicalizarJcsAuditoriaV1(estado);
    const huella = createHash('sha256').update(canonico, 'utf8').digest();
    if (concesion.contenidoDeseadoSha256?.equals(huella)) {
      return Object.freeze({
        gobernado: true,
        cambioEfectivo: false,
        version: concesion.version,
        modo: concesion.modo,
        origen: 'usuario'
      });
    }

    const version = incrementarVersionDdns(concesion.version);
    const intencionId = this.generarIntencionId();
    const intencionIdBytes = uuidV7AuditoriaABytes(intencionId, 'intencionId');
    const intencionAnterior = await cargarIntencionAuditable(
      conexion,
      concesion.intencionGobernanteId
    );
    await this.#encolarTerminalSustituida({
      conexion,
      concesion,
      registro: { ...registro, tipo: registro.tipoRegistro },
      intencion: intencionAnterior
    });
    await this.repositorioCausal.sustituirIntencionGobernanteEnTransaccion({
      intencionInternaId: concesion.intencionGobernanteId
    }, { conexion });
    const [insercion] = await conexion.execute(
      `INSERT INTO intenciones_ddns_agentes (
         intencion_id,concesion_interna_id,agente_id_fotografia,
         registro_dns_id_fotografia,origen,version_ddns,modo,
         estado_deseado_canonico,estado_deseado_sha256,causa_tipo,
         causa_id,hito,persistida_en_utc
       ) VALUES (?,?,?,?,?,?,?,?,?,'usuario',NULL,
                 'contenido_deseado_persistido',UTC_TIMESTAMP(3))`,
      [
        intencionIdBytes,
        concesion.idInterno,
        concesion.agenteIdFotografia,
        concesion.registroDnsIdFotografia,
        'usuario',
        version,
        concesion.modo,
        canonico,
        huella
      ]
    );

    const proyeccion = proyectarContenidoDns(estado);
    await conexion.execute(
      `UPDATE registros_dns
          SET valor_principal=?,prioridad=?
        WHERE id=?`,
      [
        proyeccion.valorPrincipal,
        registro.tipoRegistro === 'MX' ? proyeccion.prioridad : registro.prioridad,
        registroId
      ]
    );
    let generacionDns = null;
    if (registro.activo && registro.publicarEnBind &&
        typeof this.repositorioCoordinacionGeneracionesDns
          ?.crearGeneracionPorMutacionEnTransaccion === 'function') {
      const operacion = await this.repositorioCoordinacionGeneracionesDns
        .crearGeneracionPorMutacionEnTransaccion({ conexion });
      generacionDns = String(operacion.generacionDns);
      await conexion.execute(
        `INSERT INTO intentos_publicacion_ddns (
           concesion_interna_id,intencion_interna_id,version_ddns,
           numero_intento,generacion_dns,estado,disponible_en_utc
         ) VALUES (?,?,?,1,?,'pendiente',UTC_TIMESTAMP(3))`,
        [concesion.idInterno, insercion.insertId, version, generacionDns]
      );
    }
    await conexion.execute(
      `UPDATE concesiones_ddns_agentes
          SET version_ddns=?,decision='operativa',modo=?,
              intencion_gobernante_id=?,contenido_deseado_canonico=?,
              contenido_deseado_sha256=?,condicion_operativa='operativa'
        WHERE id=? AND estado='vigente'`,
      [
        version,
        concesion.modo,
        insercion.insertId,
        canonico,
        huella,
        concesion.idInterno
      ]
    );
    await conexion.execute(
      `UPDATE zonas_dns
          SET version_modelo=version_modelo+1,
              estado_publicacion='pendiente',
              fecha_ultimo_error_publicacion=NULL,
              detalle_ultimo_error_publicacion=NULL
        WHERE id=?`,
      [registro.zonaId]
    );
    await this.#registrarAceptacionYResultado({
      conexion,
      actorReal: { tipo: 'usuario', id: realId },
      actorEfectivo: { tipo: 'usuario', id: efectivoId },
      productorAceptacion: 'portal_web',
      claveAceptacion: `ddns:usuario:${concesion.concesionId}:${version}`,
      concesion,
      registro: { ...registro, tipo: registro.tipoRegistro },
      intencionId,
      version,
      estadoAnterior: concesion.contenidoDeseado,
      estadoPosterior: estado,
      origenIntencion: 'usuario',
      generacionDns,
      contenidoPersistido: true
    });
    return Object.freeze({
      gobernado: true,
      cambioEfectivo: true,
      version,
      modo: concesion.modo,
      origen: 'usuario',
      intencionId,
      generacionDns,
      zonaMarcadaPendiente: true
    });
  }

  async sincronizarOperabilidadRegistroEnTransaccion({
    registroDnsId,
    operable,
    generacionDns = null
  } = {}, { conexion } = {}) {
    exigirConexion(conexion);
    const registroId = idPositivo(registroDnsId, 'registroDnsId');
    if (typeof operable !== 'boolean') {
      throw new TypeError('La operabilidad DDNS debe ser booleana.');
    }
    const [filas] = await conexion.execute(
      `SELECT c.id,c.intencion_gobernante_id,
              CAST(c.version_ddns AS CHAR) AS version_ddns,c.modo,
              c.condicion_operativa,
              i.hito,i.terminal
         FROM concesiones_ddns_agentes c
         LEFT JOIN intenciones_ddns_agentes i ON i.id=c.intencion_gobernante_id
        WHERE c.registro_dns_id=? AND c.estado='vigente' FOR UPDATE`,
      [registroId]
    );
    const concesion = filas[0];
    if (!concesion) return Object.freeze({ gobernado: false, generacionDns });

    let generacion = generacionDns === null ? null : String(generacionDns);
    if (generacion === null &&
        typeof this.repositorioCoordinacionGeneracionesDns
          ?.crearGeneracionPorMutacionEnTransaccion === 'function') {
      const operacion = await this.repositorioCoordinacionGeneracionesDns
        .crearGeneracionPorMutacionEnTransaccion({ conexion });
      generacion = String(operacion.generacionDns);
    }
    if (!operable) {
      await conexion.execute(
        `UPDATE concesiones_ddns_agentes
            SET condicion_operativa='registro_no_operable'
          WHERE id=?`,
        [concesion.id]
      );
      await conexion.execute(
        `UPDATE intentos_publicacion_ddns
            SET estado='bloqueada',atribucion='global',disponible_en_utc=NULL,
                instancia_id=NULL,lease_token=NULL,lease_expira_utc=NULL,
                codigo_diagnostico='registro_no_operable',
                mensaje_diagnostico='El registro DDNS está deshabilitado.'
          WHERE intencion_interna_id=?
            AND estado IN ('pendiente','procesando','bloqueada')`,
        [concesion.intencion_gobernante_id]
      );
      return Object.freeze({ gobernado: true, pausado: true, generacionDns: generacion });
    }

    const condicion = condicionAlReanudar(concesion);
    await conexion.execute(
      'UPDATE concesiones_ddns_agentes SET condicion_operativa=? WHERE id=?',
      [condicion, concesion.id]
    );
    if (generacion && concesion.intencion_gobernante_id &&
        concesion.hito === 'contenido_deseado_persistido' &&
        concesion.terminal === null) {
      const [intentos] = await conexion.execute(
        `SELECT id,estado FROM intentos_publicacion_ddns
          WHERE intencion_interna_id=? ORDER BY numero_intento DESC LIMIT 1
          FOR UPDATE`,
        [concesion.intencion_gobernante_id]
      );
      if (intentos[0] && ['pendiente', 'bloqueada'].includes(intentos[0].estado)) {
        await conexion.execute(
          `UPDATE intentos_publicacion_ddns
              SET generacion_dns=?,estado='pendiente',atribucion=NULL,
                  disponible_en_utc=UTC_TIMESTAMP(3),codigo_diagnostico=NULL,
                  mensaje_diagnostico=NULL
            WHERE id=?`,
          [generacion, intentos[0].id]
        );
      }
    }
    return Object.freeze({ gobernado: true, pausado: false, generacionDns: generacion });
  }

  async proyectarConcesion(contextoUsuarioActual, concesionId) {
    const filas = await this.clienteSql.consultar(
      `SELECT c.concesion_id,c.estado,c.causa_cierre,c.version_ddns,c.decision,
              c.modo,c.condicion_operativa,c.creada_en_utc,c.cerrada_en_utc,
              a.id AS agente_id,a.nombre AS agente_nombre,
              a.tenant_id AS agente_tenant_id,
              a.empresa_id AS agente_empresa_id,a.sitio_id AS agente_sitio_id,
              r.id AS registro_id,r.host_relativo,r.tipo_registro,
              r.valor_principal,r.prioridad,
              r.tenant_id AS registro_tenant_id,
              r.empresa_id AS registro_empresa_id,
              r.sitio_id AS registro_sitio_id,z.nombre_zona
         FROM concesiones_ddns_agentes c
         LEFT JOIN agentes_sentinelia a ON a.id=c.agente_id
         LEFT JOIN registros_dns r ON r.id=c.registro_dns_id
         LEFT JOIN zonas_dns z ON z.id=r.zona_id
        WHERE c.concesion_id=? LIMIT 1`,
      [uuidConcesionABytes(concesionId)]
    );
    if (!filas[0]) return null;
    const fila = filas[0];
    const agenteVisible = Boolean(
      contextoUsuarioActual?.permisos?.verAgentes && fila.agente_id !== null &&
      this.politicaPermisosAgentes.puedeAlcanzarAgente(
        contextoUsuarioActual,
        scopeAgenteDesdeFila(fila)
      )
    );
    const registroVisible = Boolean(
      contextoUsuarioActual?.permisos?.verDns && fila.registro_id !== null &&
      puedeAlcanzarScope(contextoUsuarioActual, scopeRegistroDesdeFila(fila))
    );
    if (!agenteVisible && !registroVisible) return null;
    return Object.freeze({
      concesionId,
      estado: fila.estado,
      causaCierre: fila.causa_cierre,
      version: String(fila.version_ddns),
      decision: fila.decision,
      modo: fila.modo,
      condicion: fila.condicion_operativa,
      agente: agenteVisible
        ? proyectarAgente(fila)
        : Object.freeze({ restringido: true, tipo: 'agente' }),
      registro: registroVisible
        ? proyectarRegistro(fila)
        : Object.freeze({ restringido: true, tipo: 'registro_dns' }),
      creadaEnUtc: fila.creada_en_utc,
      cerradaEnUtc: fila.cerrada_en_utc
    });
  }

  async #revocar({
    contextoUsuarioActual,
    concesionId,
    extremo,
    extremoId,
    causa
  }) {
    const actorRealId = idPositivo(
      contextoUsuarioActual?.idUsuarioReal ?? contextoUsuarioActual?.idUsuario,
      'contextoUsuarioActual.idUsuarioReal'
    );
    const actorEfectivoId = idPositivo(
      contextoUsuarioActual?.idUsuario,
      'contextoUsuarioActual.idUsuario'
    );
    return this.frontera.ejecutar(async (conexion) => {
      const autoridades = await this.#bloquearAutoridades(
        [actorRealId, actorEfectivoId],
        conexion
      );
      const concesion = await this.repositorioConcesiones
        .buscarPorConcesionIdEnTransaccion(concesionId, {
          conexion,
          forUpdate: true
        });
      if (!concesion) fallarAutoridad();
      const idVinculado = extremo === 'agente'
        ? concesion.agenteId
        : concesion.registroDnsId;
      if (idVinculado !== extremoId) fallarAutoridad();
      const objetivo = extremo === 'agente'
        ? await bloquearAgente(conexion, extremoId)
        : await bloquearRegistro(conexion, extremoId);
      if (!objetivo) fallarAutoridad();
      for (const autoridad of autoridades.values()) {
        if (extremo === 'agente') {
          exigirPermisoAgente(autoridad);
          if (!this.politicaPermisosAgentes.puedeAlcanzarAgente(
            autoridad,
            objetivo
          )) fallarAutoridad();
        } else {
          exigirPermisoRegistro(autoridad);
          if (!puedeAlcanzarScope(autoridad, objetivo)) fallarAutoridad();
        }
      }
      const efectuada = concesion.estado === 'vigente';
      const revocada = await this.repositorioConcesiones
        .cerrarConcesionEnTransaccion({ concesionId, causa }, { conexion });
      if (efectuada) {
        await this.#registrarAuditoriaDirecta({
          conexion,
          tipo: 'ddns.concesion_revocada',
          actorRealId,
          actorEfectivoId,
          sujetoId: revocada.concesionId,
          scope: revocada.scopeRegistro,
          correlacionId: revocada.concesionId,
          claveOperacion: `ddns:concesion:revocar:${revocada.concesionId}`,
          payload: payloadDdns({
            resultado: 'revocada',
            modo: revocada.modo,
            estadoAnterior: revocada.contenidoDeseado,
            versionDdns: revocada.version,
            causa,
            agenteId: revocada.agenteIdFotografia,
            registroDnsId: revocada.registroDnsIdFotografia,
            extremo
          })
        });
      }
      return Object.freeze({
        concesion: revocada,
        efectuada,
        revocadaDesde: revocada.causaCierre === 'revocada_desde_agente'
          ? 'agente'
          : 'registro',
        actorRealId: efectuada ? actorRealId : null,
        actorEfectivoId: efectuada ? actorEfectivoId : null
      });
    });
  }

  async #registrarAceptacionYResultado({
    conexion,
    actorReal,
    actorEfectivo = null,
    productorAceptacion,
    claveAceptacion,
    concesion,
    registro,
    intencionId,
    version,
    estadoAnterior,
    estadoPosterior,
    origenIntencion,
    generacionDns,
    contenidoPersistido,
    forzarOutboxAceptacion = false
  }) {
    const comun = {
      sujetoId: intencionId,
      scope: concesion.scopeRegistro,
      correlacionId: intencionId,
      payload: payloadDdns({
        resultado: 'aceptada',
        tipoRegistro: registro.tipo ?? registro.tipoRegistro,
        modo: estadoPosterior.modo,
        estadoAnterior,
        estadoPosterior,
        versionDdns: version,
        origenIntencion,
        generacionDns,
        agenteId: concesion.agenteIdFotografia,
        registroDnsId: concesion.registroDnsIdFotografia
      })
    };
    const aceptacion = construirIntencionAuditoriaDdns({
      eventoId: this.generarEventoAuditoriaId(),
      tipo: 'ddns.intencion_aceptada',
      actorReal,
      actorEfectivo,
      productor: productorAceptacion,
      claveOperacion: claveAceptacion,
      ...comun
    });
    if (forzarOutboxAceptacion) {
      await this.#encolarAuditoriaRuntime([aceptacion], conexion);
    } else if (this.servicioAuditoria) {
      await this.servicioAuditoria.registrarEnTransaccion({
        cambioEfectivo: true,
        intencion: aceptacion
      }, { conexion });
    }
    if (!contenidoPersistido) return;
    const resultado = construirIntencionAuditoriaDdns({
      eventoId: this.generarEventoAuditoriaId(),
      tipo: 'ddns.contenido_deseado_persistido',
      actorReal: { tipo: 'runtime', id: 'sentinelia-runtime' },
      sujetoId: intencionId,
      scope: concesion.scopeRegistro,
      correlacionId: intencionId,
      causalidadIntencionId: intencionId,
      productor: 'runtime_automatizacion',
      claveOperacion: `ddns:persistida:${concesion.concesionId}:${version}`,
      rolEvento: 'resultado',
      payload: payloadDdns({
        resultado: 'persistido',
        tipoRegistro: registro.tipo ?? registro.tipoRegistro,
        modo: estadoPosterior.modo,
        estadoAnterior,
        estadoPosterior,
        versionDdns: version,
        origenIntencion,
        generacionDns,
        agenteId: concesion.agenteIdFotografia,
        registroDnsId: concesion.registroDnsIdFotografia
      })
    });
    await this.#encolarAuditoriaRuntime([resultado], conexion);
  }

  async #actualizarScopeConcesionesEnTransaccion({
    contextoUsuarioActual,
    extremo,
    identidad,
    scopePosterior
  }, conexion) {
    exigirConexion(conexion);
    const actorRealId = idPositivo(
      contextoUsuarioActual?.idUsuarioReal ?? contextoUsuarioActual?.idUsuario,
      'contextoUsuarioActual.idUsuarioReal'
    );
    const actorEfectivoId = idPositivo(
      contextoUsuarioActual?.idUsuario,
      'contextoUsuarioActual.idUsuario'
    );
    const metodo = extremo === 'agente'
      ? 'actualizarScopeVigentePorAgenteEnTransaccion'
      : 'actualizarScopeVigentePorZonaEnTransaccion';
    const campoIdentidad = extremo === 'agente' ? 'agenteId' : 'zonaId';
    const cambios = await this.repositorioConcesiones[metodo]({
      [campoIdentidad]: identidad,
      scope: scopePosterior
    }, { conexion });

    for (const { antes, despues } of cambios) {
      const scopeAnterior = extremo === 'agente'
        ? antes.scopeAgente
        : antes.scopeRegistro;
      const scopeActual = extremo === 'agente'
        ? despues.scopeAgente
        : despues.scopeRegistro;
      if (scopesDdnsIguales(scopeAnterior, scopeActual)) continue;
      const correlacionId = this.generarEventoAuditoriaId();
      const payload = payloadDdns({
        resultado: 'scope_actualizado',
        modo: despues.modo,
        estadoAnterior: { scope: scopeAnterior },
        estadoPosterior: { scope: scopeActual },
        versionDdns: despues.version,
        causa: extremo === 'agente' ? 'movimiento_agente' : 'movimiento_zona',
        agenteId: despues.agenteIdFotografia,
        registroDnsId: despues.registroDnsIdFotografia,
        extremo
      });
      for (const [direccion, scope] of [
        ['salida', scopeAnterior],
        ['entrada', scopeActual]
      ]) {
        await this.#registrarAuditoriaDirecta({
          conexion,
          tipo: 'ddns.concesion_scope_actualizado',
          actorRealId,
          actorEfectivoId,
          sujetoId: despues.concesionId,
          scope,
          correlacionId,
          claveOperacion:
            `ddns:scope:${despues.concesionId}:${extremo}:${correlacionId}:${direccion}`,
          payload
        });
      }
    }
    return cambios;
  }

  async #encolarTerminalSustituida({ conexion, concesion, registro, intencion }) {
    if (!intencion || intencion.terminal !== null) return;
    const evento = construirIntencionAuditoriaDdns({
      eventoId: this.generarEventoAuditoriaId(),
      tipo: 'ddns.intencion_terminada',
      actorReal: { tipo: 'runtime', id: 'sentinelia-runtime' },
      sujetoId: intencion.intencionId,
      scope: concesion.scopeRegistro,
      correlacionId: intencion.intencionId,
      causalidadIntencionId: intencion.intencionId,
      productor: 'runtime_dns',
      claveOperacion:
        `ddns:terminal:${concesion.concesionId}:${intencion.version}:sustituida`,
      rolEvento: 'resultado',
      payload: payloadDdns({
        resultado: 'sustituida',
        tipoRegistro: registro.tipo ?? registro.tipoRegistro,
        modo: intencion.modo,
        estadoPosterior: intencion.estadoDeseado,
        versionDdns: intencion.version,
        origenIntencion: intencion.origen,
        agenteId: intencion.agenteIdFotografia,
        registroDnsId: intencion.registroDnsIdFotografia,
        causa: 'intencion_posterior'
      })
    });
    await this.#encolarAuditoriaRuntime([evento], conexion);
  }

  async #registrarAuditoriaDirecta(datos) {
    if (!this.servicioAuditoria) return;
    const actorReal = { tipo: 'usuario', id: datos.actorRealId };
    const actorEfectivo = datos.actorEfectivoId === datos.actorRealId
      ? null
      : { tipo: 'usuario', id: datos.actorEfectivoId };
    const intencion = construirIntencionAuditoriaDdns({
      eventoId: this.generarEventoAuditoriaId(),
      actorReal,
      actorEfectivo,
      productor: 'portal_web',
      ...datos
    });
    await this.servicioAuditoria.registrarEnTransaccion({
      cambioEfectivo: true,
      intencion
    }, { conexion: datos.conexion });
  }

  async #encolarAuditoriaRuntime(intenciones, conexion) {
    if (!this.repositorioOutboxAuditoria) return;
    await this.repositorioOutboxAuditoria.encolarEnTransaccion(
      intenciones,
      { conexion }
    );
  }

  async #bloquearAutoridades(ids, conexion) {
    const autoridades = new Map();
    for (const id of [...new Set(ids)].sort(compararIds)) {
      const usuario = await this.repositorioUsuarios.buscarPorIdEnTransaccion(
        id,
        { conexion, forUpdate: true }
      );
      if (!usuario?.activo) fallarAutoridad();
      const nivelScope = this.resolutorScopeUsuario.resolverNivelScope(usuario);
      if (!['portal', 'tenant', 'empresa', 'sitio'].includes(nivelScope)) {
        fallarAutoridad();
      }
      autoridades.set(id, Object.freeze({
        idUsuario: usuario.id,
        nivelScope,
        esOperadorSistema: nivelScope === 'portal',
        tenantId: usuario.tenantId,
        empresaId: usuario.empresaId,
        sitioId: usuario.sitioId,
        permisos: usuario.permisos
      }));
    }
    return autoridades;
  }
}

function validarSolicitudPublicaBasica(entrada) {
  const provisional = validarSolicitudHttpDdnsAgentes(entrada);
  return provisional.solicitudId;
}

function scopesDdnsIguales(izquierdo, derecho) {
  return ['tenantId', 'empresaId', 'sitioId'].every(
    (campo) => izquierdo?.[campo] === derecho?.[campo]
  );
}

function esUuidV7(valor) {
  try {
    validarUuidV7Auditoria(valor, 'concesionId');
    return true;
  } catch {
    return false;
  }
}

function resultadoAplicacionPublica(resultado, estadoDeseado = null) {
  return Object.freeze({ resultado, estadoDeseado });
}

async function observarZonaRegistro(conexion, registroId) {
  const [filas] = await conexion.execute(
    'SELECT CAST(zona_id AS CHAR) AS zona_id FROM registros_dns WHERE id=? LIMIT 1',
    [registroId]
  );
  return filas[0] ? String(filas[0].zona_id) : null;
}

async function bloquearAgente(conexion, agenteId) {
  const [filas] = await conexion.execute(
    `SELECT id,tenant_id,empresa_id,sitio_id,estado_administrativo
       FROM agentes_sentinelia WHERE id=? LIMIT 1 FOR UPDATE`,
    [agenteId]
  );
  if (!filas[0]) return null;
  return Object.freeze({
    id: String(filas[0].id),
    tenantId: filas[0].tenant_id,
    empresaId: filas[0].empresa_id,
    sitioId: filas[0].sitio_id,
    estadoAdministrativo: filas[0].estado_administrativo
  });
}

async function bloquearRegistro(conexion, registroId) {
  const [filas] = await conexion.execute(
    'SELECT * FROM registros_dns WHERE id=? LIMIT 1 FOR UPDATE',
    [registroId]
  );
  return filas[0] ? new RegistroDns(filas[0]) : null;
}

async function bloquearZona(conexion, zonaId) {
  const [filas] = await conexion.execute(
    'SELECT * FROM zonas_dns WHERE id=? LIMIT 1 FOR UPDATE',
    [zonaId]
  );
  return filas[0] ? new ZonaDns(filas[0]) : null;
}

async function resolverPublicacionPrevia({ conexion, zona }) {
  const [cabeceras] = await conexion.execute(
    `SELECT CAST(ultima_generacion_dns AS CHAR) AS ultima_generacion_dns,
            CAST(generacion_observada AS CHAR) AS generacion_observada
       FROM cabecera_generacion_dns WHERE id=1 FOR UPDATE`
  );
  const cabecera = cabeceras[0];
  if (!cabecera || zona.estadoPublicacion !== 'publicado') {
    return Object.freeze({ confirmada: false, generacion: null });
  }
  const ultima = String(cabecera.ultima_generacion_dns);
  const observada = cabecera.generacion_observada === null
    ? null
    : String(cabecera.generacion_observada);
  if (ultima === '0' || observada !== ultima) {
    return Object.freeze({ confirmada: false, generacion: null });
  }
  const [operaciones] = await conexion.execute(
    `SELECT estado,CAST(generacion_observada AS CHAR) AS generacion_observada,
            recarga_confirmada_en_utc
       FROM operaciones_publicacion_dns
      WHERE generacion_dns=? LIMIT 1 FOR UPDATE`,
    [ultima]
  );
  const operacion = operaciones[0];
  const confirmada = Boolean(
    operacion && ['recarga_confirmada', 'consolidada'].includes(operacion.estado) &&
    String(operacion.generacion_observada) === ultima &&
    operacion.recarga_confirmada_en_utc
  );
  return Object.freeze({ confirmada, generacion: confirmada ? ultima : null });
}

function fotografiarContenidoRegistro(registro) {
  const tipo = registro.tipoRegistro;
  let valor;
  if (tipo === 'A') valor = { direccionIpv4: registro.valorPrincipal };
  else if (tipo === 'AAAA') valor = { direccionIpv6: registro.valorPrincipal };
  else if (tipo === 'CNAME') valor = { destino: registro.valorPrincipal };
  else valor = { prioridad: registro.prioridad, destino: registro.valorPrincipal };
  const estado = canonicalizarEstadoDeseadoDdnsAgentes({
    tipo,
    modo: 'declarada',
    valor
  });
  const canonico = canonicalizarJcsAuditoriaV1(estado);
  return Object.freeze({
    estado,
    canonico,
    huella: createHash('sha256').update(canonico, 'utf8').digest()
  });
}

function canonicalizarContenidoHumano({
  tipo,
  modo,
  valorPrincipal,
  prioridad
}) {
  let valor;
  if (tipo === 'A') valor = { direccionIpv4: valorPrincipal };
  else if (tipo === 'AAAA') valor = { direccionIpv6: valorPrincipal };
  else if (tipo === 'CNAME') valor = { destino: valorPrincipal };
  else if (tipo === 'MX') valor = { prioridad: Number(prioridad), destino: valorPrincipal };
  else {
    throw new ErrorAplicacionDdnsAgentes(
      'El tipo real del registro no pertenece al contrato DDNS.',
      'valor_no_interpretable'
    );
  }
  try {
    return canonicalizarEstadoDeseadoDdnsAgentes(
      { tipo, modo, valor },
      { admitirContenidoObservado: true }
    );
  } catch (error) {
    throw new ErrorAplicacionDdnsAgentes(error.message, 'valor_no_interpretable');
  }
}

function proyectarContenidoDns(estado) {
  if (estado.tipo === 'A') {
    return Object.freeze({
      valorPrincipal: estado.valor.direccionIpv4,
      prioridad: null
    });
  }
  if (estado.tipo === 'AAAA') {
    return Object.freeze({
      valorPrincipal: estado.valor.direccionIpv6,
      prioridad: null
    });
  }
  return Object.freeze({
    valorPrincipal: estado.valor.destino,
    prioridad: estado.tipo === 'MX' ? estado.valor.prioridad : null
  });
}

async function cargarIntencionAuditable(conexion, intencionId) {
  const [filas] = await conexion.execute(
    `SELECT id,intencion_id,agente_id_fotografia,
            registro_dns_id_fotografia,origen,version_ddns,modo,
            estado_deseado_canonico,terminal
       FROM intenciones_ddns_agentes
      WHERE id=? FOR UPDATE`,
    [intencionId]
  );
  const fila = filas[0];
  if (!fila) {
    throw new ErrorAplicacionDdnsAgentes(
      'La fotografía causal DDNS no conserva su intención gobernante.',
      'estado_inconsistente'
    );
  }
  return Object.freeze({
    idInterno: String(fila.id),
    intencionId: bytesAUuidV7Auditoria(fila.intencion_id, 'intencionId'),
    agenteIdFotografia: String(fila.agente_id_fotografia),
    registroDnsIdFotografia: String(fila.registro_dns_id_fotografia),
    origen: String(fila.origen),
    version: String(fila.version_ddns),
    modo: String(fila.modo),
    estadoDeseado: jsonDesdeSql(fila.estado_deseado_canonico),
    terminal: fila.terminal === null ? null : String(fila.terminal)
  });
}

function jsonDesdeSql(valor) {
  if (typeof valor === 'string') return JSON.parse(valor);
  if (Buffer.isBuffer(valor)) return JSON.parse(valor.toString('utf8'));
  return valor;
}

function incrementarVersionDdns(versionActual) {
  const actual = BigInt(String(versionActual));
  const siguiente = actual + 1n;
  if (siguiente > ((1n << 64n) - 1n)) {
    throw new ErrorAplicacionDdnsAgentes(
      'La versión causal DDNS ha agotado su representación.',
      'estado_inconsistente'
    );
  }
  return siguiente.toString();
}

function exigirPermisos(contexto) {
  if (!contexto?.permisos?.modificarAgentes ||
      !contexto?.permisos?.administrarDnsAvanzado) {
    fallarAutoridad();
  }
}

function exigirPermisoAgente(contexto) {
  if (!contexto?.permisos?.modificarAgentes) fallarAutoridad();
}

function exigirPermisoRegistro(contexto) {
  if (!contexto?.permisos?.administrarDnsAvanzado) fallarAutoridad();
}

function scopeAgenteDesdeFila(fila) {
  return Object.freeze({
    tenantId: fila.agente_tenant_id,
    empresaId: fila.agente_empresa_id,
    sitioId: fila.agente_sitio_id
  });
}

function scopeRegistroDesdeFila(fila) {
  return Object.freeze({
    tenantId: fila.registro_tenant_id,
    empresaId: fila.registro_empresa_id,
    sitioId: fila.registro_sitio_id
  });
}

function proyectarAgente(fila) {
  return Object.freeze({
    restringido: false,
    tipo: 'agente',
    id: String(fila.agente_id),
    nombre: fila.agente_nombre,
    scope: scopeSerializable(scopeAgenteDesdeFila(fila))
  });
}

function proyectarRegistro(fila) {
  const nombre = fila.host_relativo === '@'
    ? fila.nombre_zona
    : `${fila.host_relativo}.${fila.nombre_zona}`;
  return Object.freeze({
    restringido: false,
    tipo: 'registro_dns',
    id: String(fila.registro_id),
    nombre,
    tipoRegistro: fila.tipo_registro,
    valorPrincipal: fila.valor_principal,
    prioridad: fila.prioridad === null ? null : Number(fila.prioridad),
    scope: scopeSerializable(scopeRegistroDesdeFila(fila))
  });
}

function scopeSerializable(scope) {
  return Object.freeze({
    tenantId: scope.tenantId === null ? null : String(scope.tenantId),
    empresaId: scope.empresaId === null ? null : String(scope.empresaId),
    sitioId: scope.sitioId === null ? null : String(scope.sitioId)
  });
}

function uuidConcesionABytes(valor) {
  return uuidV7AuditoriaABytes(valor, 'concesionId');
}

function puedeAlcanzarScope(contexto, entidad) {
  if (contexto.esOperadorSistema) return true;
  if (contexto.tenantId == null ||
      Number(contexto.tenantId) !== Number(entidad.tenantId)) return false;
  if (['empresa', 'sitio'].includes(contexto.nivelScope) &&
      Number(contexto.empresaId) !== Number(entidad.empresaId)) return false;
  if (contexto.nivelScope === 'sitio' &&
      Number(contexto.sitioId) !== Number(entidad.sitioId)) return false;
  return ['tenant', 'empresa', 'sitio'].includes(contexto.nivelScope);
}

function fallarAutoridad() {
  throw new ErrorAplicacionDdnsAgentes(
    'La autoridad actual no permite realizar la operación DDNS.',
    'autoridad_insuficiente'
  );
}

function idPositivo(valor, nombre) {
  const texto = String(valor ?? '');
  if (!/^[1-9][0-9]*$/u.test(texto)) {
    throw new TypeError(`${nombre} debe ser una identidad decimal positiva.`);
  }
  return texto;
}

function compararIds(a, b) {
  if (a.length !== b.length) return a.length - b.length;
  return a.localeCompare(b);
}

function resultadoDdns({
  resultado,
  version = '0',
  hito = null,
  condicion = null,
  terminal = null,
  error = null
}) {
  return crearResultadoDdnsAgentes({
    perfil: PERFILES_DDNS_AGENTES.RESULTADO,
    versionContrato: VERSION_CONTRATO_DDNS_AGENTES,
    resultado,
    version,
    hito,
    condicion,
    terminal,
    error
  });
}

function payloadDdns(entrada) {
  return entrada;
}

function huellasIguales(izquierda, derecha) {
  return Buffer.isBuffer(izquierda) && Buffer.isBuffer(derecha) &&
    izquierda.length === derecha.length && timingSafeEqual(izquierda, derecha);
}

function concesionVigenteYOperable(concesion, registro) {
  return concesion.estado === 'vigente' && registro !== null &&
    registro.activo && registro.publicarEnBind &&
    registro.categoriaOrigen === 'ddns' &&
    concesion.registroDnsId === registro.id;
}

function normalizarCausaPol(causa) {
  const causaId = String(causa?.causaId || '').trim();
  const agenteId = idPositivo(causa?.agenteId, 'causa.agenteId');
  const familiaDireccion = causa?.familiaDireccion;
  if (!causaId || !['ipv4', 'ipv6'].includes(familiaDireccion)) {
    throw new TypeError('La causa POL DDNS no identifica una familia aplicable.');
  }
  const aceptadaEnUtc = causa?.aceptadaEnUtc instanceof Date
    ? causa.aceptadaEnUtc
    : new Date(causa?.aceptadaEnUtc);
  if (Number.isNaN(aceptadaEnUtc.getTime())) {
    throw new TypeError('La causa POL DDNS no conserva un instante válido.');
  }
  return Object.freeze({
    causaId,
    agenteId,
    familiaDireccion,
    direccionRemota: String(causa?.direccionRemota || ''),
    aceptadaEnUtc
  });
}

function mismaFotografiaCandidata(candidata, concesion) {
  return String(candidata?.idInterno || '') === concesion.idInterno &&
    String(candidata?.version || '') === concesion.version &&
    String(candidata?.intencionGobernanteId || '') ===
      String(concesion.intencionGobernanteId || '');
}

function precedePol(instanteModo, instantePol) {
  const modo = instanteModo instanceof Date ? instanteModo : new Date(instanteModo);
  return !Number.isNaN(modo.getTime()) && modo.getTime() < instantePol.getTime();
}

function resultadoObservacionPol(resultado, version, intencionId = null, causa = null) {
  return Object.freeze({
    resultado,
    version: String(version),
    intencionId,
    causa
  });
}

function condicionAlReanudar(concesion) {
  if (concesion.terminal === 'publicacion_fallida') return 'publicacion_fallida';
  if (!concesion.intencion_gobernante_id) {
    return concesion.condicion_operativa === 'publicacion_previa_desconocida'
      ? 'publicacion_previa_desconocida'
      : 'pendiente_decision_agente';
  }
  if (concesion.modo === 'observada' && concesion.hito === 'intencion_aceptada') {
    return 'esperando_observacion';
  }
  return 'operativa';
}

async function persistirContenidoDeseadoDeclarado({
  conexion,
  repositorioCoordinacionGeneracionesDns,
  concesion,
  registro,
  intencionInternaId,
  version,
  estadoDeseado,
  estadoCanonico,
  estadoSha256,
  forzarPublicacion = false
}) {
  const proyeccion = proyectarContenidoDns(estadoDeseado);
  const cambioEfectivo = registro.valorPrincipal !== proyeccion.valorPrincipal ||
    String(registro.prioridad ?? '') !== String(proyeccion.prioridad ?? '');
  await conexion.execute(
    `UPDATE concesiones_ddns_agentes
        SET contenido_deseado_canonico=?,contenido_deseado_sha256=?
      WHERE id=? AND intencion_gobernante_id=?`,
    [estadoCanonico, estadoSha256, concesion.idInterno, intencionInternaId]
  );
  await conexion.execute(
    `UPDATE intenciones_ddns_agentes
        SET hito='contenido_deseado_persistido',persistida_en_utc=UTC_TIMESTAMP(3)
      WHERE id=? AND hito='intencion_aceptada' AND terminal IS NULL`,
    [intencionInternaId]
  );
  if (!cambioEfectivo && !forzarPublicacion) {
    return Object.freeze({ cambioEfectivo: false, generacionCreada: false });
  }
  if (typeof repositorioCoordinacionGeneracionesDns
    ?.crearGeneracionPorMutacionEnTransaccion !== 'function') {
    throw new ErrorAplicacionDdnsAgentes(
      'La proyección DDNS no dispone de coordinación de generaciones DNS.',
      'estado_inconsistente'
    );
  }
  await conexion.execute(
    `UPDATE registros_dns SET valor_principal=?,prioridad=? WHERE id=?`,
    [proyeccion.valorPrincipal, proyeccion.prioridad, registro.id]
  );
  const operacion = await repositorioCoordinacionGeneracionesDns
    .crearGeneracionPorMutacionEnTransaccion({ conexion });
  const generacionDns = String(operacion.generacionDns);
  await conexion.execute(
    `INSERT INTO intentos_publicacion_ddns (
       concesion_interna_id,intencion_interna_id,version_ddns,
       numero_intento,generacion_dns,estado,disponible_en_utc
     ) VALUES (?,?,?,1,?,'pendiente',UTC_TIMESTAMP(3))`,
    [concesion.idInterno, intencionInternaId, version, generacionDns]
  );
  await conexion.execute(
    `UPDATE zonas_dns
        SET version_modelo=version_modelo+1,
            estado_publicacion='pendiente',
            fecha_ultimo_error_publicacion=NULL,
            detalle_ultimo_error_publicacion=NULL
      WHERE id=?`,
    [registro.zonaId]
  );
  return Object.freeze({
    cambioEfectivo,
    generacionCreada: true,
    generacionDns
  });
}

function exigirConexion(conexion) {
  if (typeof conexion?.execute !== 'function') {
    throw new TypeError('La aplicación DDNS exige una conexión prestada.');
  }
}

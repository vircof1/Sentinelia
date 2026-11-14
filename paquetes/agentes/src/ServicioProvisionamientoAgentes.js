import {
  ESTADOS_ADMINISTRATIVOS_AGENTE
} from './EstadosAgenteSentinelia.js';
import { createHash } from 'node:crypto';
import {
  GeneradorCredencialesAgenteSentinelia
} from './GeneradorCredencialesAgenteSentinelia.js';
import { PoliticaPermisosAgentes } from './PoliticaPermisosAgentes.js';
import { generarUuidV7Auditoria } from '../../auditoria/src/UuidV7Auditoria.js';
import { PERFIL_JCS_AUDITORIA_V1 } from '../../auditoria/src/PerfilJcsAuditoria.js';
import { VERSION_ENCADENADO_AUDITORIA_V1 } from '../../auditoria/src/SobreCanonicoAuditoria.js';
import {
  ContratoPerfilServidorAgente,
  PERFILES_OPERATIVOS_AGENTE
} from './ContratoPerfilServidorAgente.js';

export class ServicioProvisionamientoAgentes {
  constructor({
    repositorioAgentes,
    repositorioSitios,
    politicaPermisosAgentes = new PoliticaPermisosAgentes(),
    generadorCredenciales = new GeneradorCredencialesAgenteSentinelia(),
    invalidarSesionesAgente = async () => {},
    fronteraTransaccional = null,
    servicioAutoridadMovimientoAgente = null,
    servicioAutoridadMutacionesEstructurales = null,
    servicioAplicacionDdnsAgentes = null,
    servicioAuditoria = null,
    repositorioOperacionesSesionAgentes = null,
    repositorioPerfilesServidor = null,
    contratoPerfilServidor = new ContratoPerfilServidorAgente(),
    publicadorTelemetriaRuntimeEnTransaccion = null,
    repositorioEstadoRuntimeServidor = null,
    servicioRetiradaPerfilServidor = null,
    coordinadorPerfilServidorRedis = null,
    publicadorInvalidacionesMonitores = null,
    perfilServidorHabilitado = false,
    histeresisSinPolSugeridaSegundos = 120,
    capturadorFederacion = null,
    ahora = () => new Date()
  }) {
    this.repositorioAgentes = repositorioAgentes;
    this.repositorioSitios = repositorioSitios;
    this.politicaPermisosAgentes = politicaPermisosAgentes;
    this.generadorCredenciales = generadorCredenciales;
    this.invalidarSesionesAgente = invalidarSesionesAgente;
    this.fronteraTransaccional = fronteraTransaccional;
    this.servicioAutoridadMovimientoAgente = servicioAutoridadMovimientoAgente;
    this.servicioAutoridadMutacionesEstructurales =
      servicioAutoridadMutacionesEstructurales;
    this.servicioAplicacionDdnsAgentes = servicioAplicacionDdnsAgentes;
    this.servicioAuditoria = servicioAuditoria;
    this.repositorioOperacionesSesionAgentes = repositorioOperacionesSesionAgentes;
    this.repositorioPerfilesServidor = repositorioPerfilesServidor;
    this.contratoPerfilServidor = contratoPerfilServidor;
    this.publicadorTelemetriaRuntimeEnTransaccion =
      publicadorTelemetriaRuntimeEnTransaccion;
    this.repositorioEstadoRuntimeServidor = repositorioEstadoRuntimeServidor;
    this.servicioRetiradaPerfilServidor = servicioRetiradaPerfilServidor;
    this.coordinadorPerfilServidorRedis = coordinadorPerfilServidorRedis;
    this.publicadorInvalidacionesMonitores =
      publicadorInvalidacionesMonitores;
    this.perfilServidorHabilitado = perfilServidorHabilitado === true;
    this.histeresisSinPolSugeridaSegundos = this.normalizarEnteroPositivo(
      histeresisSinPolSugeridaSegundos,
      'histeresisSinPolSugeridaSegundos'
    );
    if (capturadorFederacion !== null &&
        typeof capturadorFederacion?.capturarEnTransaccion !== 'function') {
      throw new Error('El capturador federado de agentes no es transaccional.');
    }
    this.capturadorFederacion = capturadorFederacion;
    this.ahora = ahora;
  }

  async listarAgentesVisibles(contextoUsuarioActual) {
    this.politicaPermisosAgentes.assertPuedeVer(contextoUsuarioActual);

    return this.repositorioAgentes.listarVisibles(contextoUsuarioActual);
  }

  async listarAgentesVisiblesPaginado(contextoUsuarioActual, filtros = {}) {
    this.politicaPermisosAgentes.assertPuedeVer(contextoUsuarioActual);

    return this.repositorioAgentes.listarPaginadoVisible(
      contextoUsuarioActual,
      filtros
    );
  }

  async provisionarAgente(contextoUsuarioActual, datos) {
    this.politicaPermisosAgentes.assertPuedeModificar(contextoUsuarioActual);

    const sitio = await this.resolverSitioAlcanzable(
      contextoUsuarioActual,
      datos.sitioId
    );
    const credenciales =
      await this.generadorCredenciales.generarParCredenciales();
    if (!this.auditoriaActiva() ||
        typeof this.servicioAutoridadMutacionesEstructurales
          ?.serializarAltaEnTransaccion !== 'function') {
      throw new Error(
        'El alta de agente exige autoridad jerárquica transaccional.'
      );
    }
    const agente = await this.fronteraTransaccional.ejecutar(async (conexion) => {
      await this.servicioAutoridadMutacionesEstructurales
        .serializarAltaEnTransaccion({
          scopePadre: this.scopeSitio(sitio)
        }, { conexion });
      const creado = await this.repositorioAgentes.crearEnTransaccion({
        guid: credenciales.guid,
        tenantId: sitio.tenantId,
        empresaId: sitio.empresaId,
        sitioId: sitio.id,
        nombre: datos.nombre,
        descripcion: datos.descripcion || '',
        secretoHash: credenciales.secretoHash
      }, { conexion });
      await this.registrarEventoAgente({
        conexion,
        contextoUsuarioActual,
        tipo: 'agente.provisionado',
        agente: creado,
        payload: {
          resultado: 'creado',
          antes: null,
          despues: this.fotografiaAgente(creado)
        }
      });
      await this.capturarAgente(creado.id, conexion);
      return creado;
    });

    return this.construirResultadoProvisionamiento({
      agente,
      guid: credenciales.guid,
      secreto: credenciales.secreto
    });
  }

  async editarMetadatosAgente(contextoUsuarioActual, idAgente, datos) {
    const agente = await this.obtenerAgenteModificable(
      contextoUsuarioActual,
      idAgente
    );
    const actualizar = (conexion = null) => {
      const metodo = conexion ? 'actualizarMetadatosEnTransaccion' : 'actualizarMetadatos';
      return this.repositorioAgentes[metodo]({
        idAgente: agente.id,
        nombre: datos.nombre,
        descripcion: datos.descripcion || ''
      }, conexion ? { conexion } : undefined);
    };
    const actualizado = this.auditoriaActiva() || this.capturadorFederacion
      ? await this.fronteraTransaccional.ejecutar(async (conexion) => {
          const despues = await actualizar(conexion);
          const campos = this.camposMetadatosCambiados(agente, despues);
          if (campos.length > 0) {
            await this.registrarEventoAgente({
              conexion,
              contextoUsuarioActual,
              tipo: 'agente.metadatos_cambiados',
              agente: despues,
              payload: {
                resultado: 'actualizado',
                camposCambiados: campos,
                antes: this.seleccionarCampos(this.fotografiaAgente(agente), campos),
                despues: this.seleccionarCampos(this.fotografiaAgente(despues), campos)
              }
            });
            await this.capturarAgente(despues.id, conexion);
          }
          return despues;
        })
      : await actualizar();

    return { agente: actualizado };
  }

  async moverAgenteASitio(contextoUsuarioActual, idAgente, sitioId) {
    const agente = await this.obtenerAgenteModificable(
      contextoUsuarioActual,
      idAgente
    );
    const sitio = await this.resolverSitioAlcanzable(
      contextoUsuarioActual,
      sitioId
    );
    const scopeAnterior = this.scopeAgente(agente);
    const scopePosterior = this.scopeSitio(sitio);
    const cambioScope = !this.scopesIguales(scopeAnterior, scopePosterior);
    if (!cambioScope) return { agente };
    if (!this.auditoriaActiva() ||
        typeof this.servicioAutoridadMovimientoAgente?.autorizarEnTransaccion !==
          'function') {
      throw new Error(
        'El movimiento de agente exige auditoría y autoridad jerárquica transaccionales.'
      );
    }
    const actualizado = await this.fronteraTransaccional.ejecutar(async (conexion) => {
      await this.servicioAutoridadMovimientoAgente.autorizarEnTransaccion({
        agenteId: agente.id,
        scopeOrigen: scopeAnterior,
        scopeDestino: scopePosterior
      }, { conexion });
      const despues =
        await this.repositorioAgentes.actualizarPertenenciaEnTransaccion({
          idAgente: agente.id,
          tenantId: sitio.tenantId,
          empresaId: sitio.empresaId,
          sitioId: sitio.id
        }, { conexion });
      const movimiento = await this.registrarMovimientoScopeAgente({
        conexion,
        contextoUsuarioActual,
        agente: despues,
        scopeAnterior,
        scopePosterior
      });
      if (typeof this.servicioAplicacionDdnsAgentes
        ?.actualizarScopeAgenteEnTransaccion === 'function') {
        await this.servicioAplicacionDdnsAgentes.actualizarScopeAgenteEnTransaccion({
          contextoUsuarioActual,
          agenteId: agente.id,
          scopePosterior
        }, { conexion });
      }
      await this.registrarInvalidacionTecnicaSiProcede({
        conexion,
        contextoUsuarioActual,
        agente: despues,
        causalidadId: movimiento.salida.eventoId
      });
      await this.capturarAgente(despues.id, conexion);
      return despues;
    });

    await this.invalidarSesionesAgente({
      agenteId: agente.id,
      motivo: 'scope_cambiado'
    });

    return { agente: actualizado };
  }

  async rotarSecretoAgente(contextoUsuarioActual, idAgente) {
    const agente = await this.obtenerAgenteModificable(
      contextoUsuarioActual,
      idAgente
    );
    const secreto = this.generadorCredenciales.generarSecretoPersistente();
    const secretoHash = await this.generadorCredenciales.crearHashSecreto(secreto);
    const { actualizado } = this.auditoriaActiva() || this.capturadorFederacion
      ? await this.fronteraTransaccional.ejecutar(async (conexion) => {
        const resultado =
          await this.repositorioAgentes.rotarSecretoEnTransaccion({
            idAgente: agente.id,
            secretoHash
          }, { conexion });
        const eventoId = generarUuidV7Auditoria();
        await this.registrarEventoAgente({
          conexion,
          contextoUsuarioActual,
          eventoId,
          tipo: 'agente.secreto_rotado',
          agente: resultado.agente,
          payload: {
            operacion: 'rotacion',
            resultado: 'rotada',
            causa: 'administrador'
          }
        });
        await this.registrarInvalidacionTecnicaSiProcede({
          conexion,
          contextoUsuarioActual,
          agente,
          causalidadId: eventoId,
          causa: 'secreto_rotado',
          dominioHuella: 'secreto'
        });
        return { actualizado: resultado.agente };
      })
      : {
          actualizado: await this.repositorioAgentes.rotarSecreto({
            idAgente: agente.id,
            secretoHash
          })
        };

    await this.invalidarSesionesAgente({
      agenteId: agente.id,
      motivo: 'rotacion_secreto'
    });

    return this.construirResultadoProvisionamiento({
      agente: actualizado,
      guid: actualizado.guid,
      secreto
    });
  }

  async cambiarEstadoAdministrativoAgente(
    contextoUsuarioActual,
    idAgente,
    estadoAdministrativo
  ) {
    const agente = await this.obtenerAgenteModificable(
      contextoUsuarioActual,
      idAgente
    );
    const { actualizado, cambioEfectivo } = this.auditoriaActiva() ||
        this.capturadorFederacion
      ? await this.fronteraTransaccional.ejecutar(async (conexion) => {
        const resultado =
          await this.repositorioAgentes.actualizarEstadoAdministrativoEnTransaccion({
            idAgente: agente.id,
            estadoAdministrativo
          }, { conexion });
        if (!resultado.cambioEfectivo) {
          return {
            actualizado: resultado.agente,
            cambioEfectivo: false
          };
        }
        const eventoId = generarUuidV7Auditoria();
        await this.registrarEventoAgente({
          conexion,
          contextoUsuarioActual,
          eventoId,
          tipo: 'agente.estado_administrativo_cambiado',
          agente: resultado.agente,
          payload: {
            estadoAntes: resultado.estadoAntes,
            estadoDespues: resultado.estadoDespues,
            motivo: 'operador'
          }
        });
        if (
          resultado.estadoDespues ===
          ESTADOS_ADMINISTRATIVOS_AGENTE.DESHABILITADO
        ) {
          await this.registrarInvalidacionTecnicaSiProcede({
            conexion,
            contextoUsuarioActual,
            agente,
            causalidadId: eventoId,
            causa: 'estado_administrativo_cambiado',
            dominioHuella: 'estado_administrativo'
          });
        }
        await this.capturarAgente(resultado.agente.id, conexion);
        return {
          actualizado: resultado.agente,
          cambioEfectivo: true
        };
      })
      : {
          actualizado:
            await this.repositorioAgentes.actualizarEstadoAdministrativo({
              idAgente: agente.id,
              estadoAdministrativo
            }),
          cambioEfectivo:
            agente.estadoAdministrativo !== estadoAdministrativo
        };

    if (
      cambioEfectivo &&
      actualizado.estadoAdministrativo ===
      ESTADOS_ADMINISTRATIVOS_AGENTE.DESHABILITADO
    ) {
      await this.invalidarSesionesAgente({
        agenteId: agente.id,
        motivo: 'agente_deshabilitado'
      });
    }

    return { agente: actualizado };
  }

  async deshabilitarAgente(contextoUsuarioActual, idAgente) {
    return this.cambiarEstadoAdministrativoAgente(
      contextoUsuarioActual,
      idAgente,
      ESTADOS_ADMINISTRATIVOS_AGENTE.DESHABILITADO
    );
  }

  async habilitarAgente(contextoUsuarioActual, idAgente) {
    return this.cambiarEstadoAdministrativoAgente(
      contextoUsuarioActual,
      idAgente,
      ESTADOS_ADMINISTRATIVOS_AGENTE.ACTIVO
    );
  }

  async consultarPerfilServidorAgente(contextoUsuarioActual, idAgente) {
    const agente = await this.obtenerAgenteVisible(
      contextoUsuarioActual,
      idAgente
    );
    this.assertRepositorioPerfilesServidorDisponible();
    const [perfil, evidencia] = await Promise.all([
      this.repositorioPerfilesServidor.buscarPorAgenteId(agente.id),
      this.repositorioPerfilesServidor.buscarEvidenciaElegibilidad(agente.id)
    ]);
    const elegibilidad = this.contratoPerfilServidor.evaluarElegibilidad(
      evidencia
    );
    const estadoRuntime = perfil
      ? await this.repositorioEstadoRuntimeServidor?.buscarPorPerfil?.({
          agenteId: agente.id,
          generacion: perfil.generacion
        })
      : null;
    const puedeModificar = this.politicaPermisosAgentes.puedeModificar(
      contextoUsuarioActual
    );
    const puedePromover = this.perfilServidorHabilitado &&
      puedeModificar &&
      elegibilidad.elegible &&
      !perfil?.estaVigente();
    const perfilVigente = Boolean(perfil?.estaVigente());
    const runtime = estadoRuntime?.serializar?.() || estadoRuntime || null;

    return Object.freeze({
      funcionalidadHabilitada: this.perfilServidorHabilitado,
      perfilEfectivo: perfilVigente
        ? PERFILES_OPERATIVOS_AGENTE.SERVIDOR
        : PERFILES_OPERATIVOS_AGENTE.GENERICO,
      perfil: perfil?.serializar() || null,
      estadoRuntime: runtime,
      fotografia: construirFotografiaAdministrativaPerfilServidor({
        perfil,
        estadoRuntime: runtime
      }),
      elegibilidad: Object.freeze({
        ...elegibilidad,
        evidencia
      }),
      puedePromover,
      puedeEditarConfiguracion:
        this.perfilServidorHabilitado && puedeModificar && perfilVigente,
      puedeRetirar:
        this.perfilServidorHabilitado && puedeModificar && perfilVigente,
      configuracionSugerida: Object.freeze({
        histeresisSinPolSegundos:
          perfil?.histeresisSinPolSegundos ||
          this.histeresisSinPolSugeridaSegundos,
        duracionReinicioRecienteSegundos:
          perfil?.duracionReinicioRecienteSegundos || null
      }),
      motivoNoDisponible: this.resolverMotivoPerfilServidorNoDisponible({
        perfil,
        elegibilidad
      })
    });
  }

  async consultarResumenPerfilesServidorAgentes(
    contextoUsuarioActual,
    agentes = []
  ) {
    this.politicaPermisosAgentes.assertPuedeVer(contextoUsuarioActual);
    if (!Array.isArray(agentes)) {
      throw new Error('Los agentes del resumen de perfil deben ser una lista.');
    }
    for (const agente of agentes) {
      if (
        !agente ||
        !this.politicaPermisosAgentes.puedeAlcanzarAgente(
          contextoUsuarioActual,
          agente
        )
      ) {
        throw new Error('Existe un agente fuera del alcance solicitado.');
      }
    }
    if (
      this.repositorioPerfilesServidor === null &&
      this.repositorioEstadoRuntimeServidor === null
    ) {
      return agentes.map(() => Object.freeze({
        perfilEfectivo: PERFILES_OPERATIVOS_AGENTE.GENERICO,
        estado: null,
        generacion: null,
        ultimoPolUtc: null,
        fotografiaDisponible: false,
        codigoCierre: null
      }));
    }
    this.assertRepositorioPerfilesServidorDisponible();
    if (
      typeof this.repositorioPerfilesServidor
        ?.listarUltimosPorAgentesIds !== 'function' ||
      typeof this.repositorioEstadoRuntimeServidor
        ?.listarPorPerfiles !== 'function'
    ) {
      throw new Error('La lectura masiva de perfiles servidor no está configurada.');
    }
    const perfiles = await this.repositorioPerfilesServidor
      .listarUltimosPorAgentesIds(agentes.map(({ id }) => id));
    const estados = await this.repositorioEstadoRuntimeServidor
      .listarPorPerfiles(perfiles);
    const perfilesPorAgente = new Map(
      perfiles.map((perfil) => [String(perfil.agenteId), perfil])
    );
    const estadosPorPerfil = new Map(estados.map((estado) => [
      `${estado.agenteId}:${estado.generacion}`,
      estado
    ]));

    return agentes.map((agente) => {
      const perfil = perfilesPorAgente.get(String(agente.id)) || null;
      const estado = perfil
        ? estadosPorPerfil.get(`${perfil.agenteId}:${perfil.generacion}`) || null
        : null;
      const runtime = estado?.serializar?.() || estado || null;
      const vigente = Boolean(perfil?.estaVigente());
      const fotografia = construirFotografiaAdministrativaPerfilServidor({
        perfil,
        estadoRuntime: runtime
      });
      return Object.freeze({
        perfilEfectivo: vigente
          ? PERFILES_OPERATIVOS_AGENTE.SERVIDOR
          : PERFILES_OPERATIVOS_AGENTE.GENERICO,
        estado: perfil?.estado || null,
        generacion: perfil?.generacion || null,
        ultimoPolUtc: runtime?.ultimoPolUtc || null,
        fotografiaDisponible: fotografia.disponible,
        codigoCierre: perfil?.codigoCierre || null
      });
    });
  }

  async actualizarConfiguracionPerfilServidorAgente(
    contextoUsuarioActual,
    idAgente,
    configuracion
  ) {
    const agente = await this.obtenerAgenteModificable(
      contextoUsuarioActual,
      idAgente
    );
    this.assertMutacionPerfilServidorDisponible();
    const generacion = this.normalizarEnteroPositivo(
      configuracion?.generacion,
      'generacion'
    );
    const versionEsperada = this.normalizarEnteroPositivo(
      configuracion?.versionEsperada,
      'versionEsperada'
    );
    const histeresisSinPolSegundos = this.normalizarEnteroPositivo(
      configuracion?.histeresisSinPolSegundos,
      'histeresisSinPolSegundos'
    );
    const duracionReinicioRecienteSegundos = this.normalizarEnteroPositivo(
      configuracion?.duracionReinicioRecienteSegundos,
      'duracionReinicioRecienteSegundos'
    );

    const perfil = await this.fronteraTransaccional.ejecutar(
      async (conexion) => {
        const anterior = await this.repositorioPerfilesServidor
          .buscarPorAgenteId(agente.id, { conexion, bloquear: true });
        exigirPerfilVigenteEsperado(anterior, { generacion, versionEsperada });
        const cambios = camposConfiguracionCambiados(anterior, {
          histeresisSinPolSegundos,
          duracionReinicioRecienteSegundos
        });
        if (cambios.length === 0) return anterior;
        const actualizado = await this.repositorioPerfilesServidor
          .actualizarConfiguracionEnTransaccion({
            agenteId: agente.id,
            generacion,
            versionEsperada,
            histeresisSinPolSegundos,
            duracionReinicioRecienteSegundos
          }, { conexion });
        await this.registrarEventoAgente({
          conexion,
          contextoUsuarioActual,
          tipo: 'agente.configuracion_servidor_cambiada',
          agente,
          payload: {
            resultado: 'actualizado',
            camposCambiados: cambios,
            antes: seleccionarCamposConfiguracion(anterior, cambios),
            despues: seleccionarCamposConfiguracion(actualizado, cambios)
          }
        });
        return actualizado;
      }
    );
    return Object.freeze({ agente, perfil: perfil.serializar() });
  }

  async retirarPerfilServidorAgente(
    contextoUsuarioActual,
    idAgente,
    { generacion, versionEsperada } = {}
  ) {
    const agente = await this.obtenerAgenteModificable(
      contextoUsuarioActual,
      idAgente
    );
    this.assertMutacionPerfilServidorDisponible();
    if (typeof this.servicioRetiradaPerfilServidor?.retirarEnTransaccion !== 'function') {
      throw new Error('La retirada coherente del perfil servidor no está configurada.');
    }
    const generacionNormalizada = this.normalizarEnteroPositivo(
      generacion,
      'generacion'
    );
    const version = this.normalizarEnteroPositivo(
      versionEsperada,
      'versionEsperada'
    );
    const operacion = await this.fronteraTransaccional.ejecutar(
      async (conexion) => {
        const anterior = await this.repositorioPerfilesServidor
          .buscarPorAgenteId(agente.id, { conexion, bloquear: true });
        exigirPerfilVigenteEsperado(anterior, {
          generacion: generacionNormalizada,
          versionEsperada: version
        });
        const retirada = await this.servicioRetiradaPerfilServidor
          .retirarEnTransaccion({
            agenteId: agente.id,
            generacion: generacionNormalizada,
            versionEsperada: version,
            cerradaEnUtc: this.ahora()
          }, { conexion });
        if (!retirada.retirada) {
          throw new Error('El perfil servidor ya no admite su retirada.');
        }
        await this.registrarEventoAgente({
          conexion,
          contextoUsuarioActual,
          tipo: 'agente.perfil_servidor_retirado',
          agente,
          payload: {
            estadoAntes: anterior.estado,
            estadoDespues: 'retirado',
            motivo: 'operador'
          }
        });
        return retirada;
      }
    );
    const efectosPostcommit = await this.publicarRetiradaPerfilServidorPostcommit(
      operacion
    );
    return Object.freeze({
      agente,
      perfil: operacion.perfil,
      retirada: operacion,
      efectosPostcommit
    });
  }

  async solicitarPerfilServidorAgente(
    contextoUsuarioActual,
    idAgente,
    configuracion
  ) {
    const agente = await this.obtenerAgenteModificable(
      contextoUsuarioActual,
      idAgente
    );
    this.assertRepositorioPerfilesServidorDisponible();

    if (!this.perfilServidorHabilitado) {
      throw new Error(
        'La promoción a perfil servidor todavía no está habilitada.'
      );
    }
    if (!this.auditoriaActiva()) {
      throw new Error(
        'La promoción a perfil servidor exige auditoría transaccional activa.'
      );
    }
    this.assertPublicadorTelemetriaRuntimeDisponible();
    this.assertRepositorioEstadoRuntimeServidorDisponible();

    const histeresisSinPolSegundos = this.normalizarEnteroPositivo(
      configuracion?.histeresisSinPolSegundos,
      'histeresisSinPolSegundos'
    );
    const duracionReinicioRecienteSegundos = this.normalizarEnteroPositivo(
      configuracion?.duracionReinicioRecienteSegundos,
      'duracionReinicioRecienteSegundos'
    );
    const generadaEnUtc = this.ahora();

    const perfil = await this.fronteraTransaccional.ejecutar(
      async (conexion) => {
        const evidencia = await this.repositorioPerfilesServidor
          .buscarEvidenciaElegibilidad(agente.id, { conexion });
        const elegibilidad = this.contratoPerfilServidor
          .evaluarElegibilidad(evidencia);

        if (!elegibilidad.elegible) {
          throw new Error(
            'El agente todavía no ha demostrado login con bootId y heartbeat explícito.'
          );
        }

        const promovido = await this.repositorioPerfilesServidor
          .promoverEnTransaccion({
            agenteId: agente.id,
            histeresisSinPolSegundos,
            duracionReinicioRecienteSegundos,
            generadaEnUtc
          }, { conexion });
        await this.repositorioEstadoRuntimeServidor
          .crearParaPerfilEnTransaccion({ perfil: promovido }, { conexion });
        await this.publicadorTelemetriaRuntimeEnTransaccion
          .asegurarCatalogoServidorEnTransaccion({
            agenteId: agente.id,
            declaradaEnUtc: generadaEnUtc
          }, { conexion });
        await this.registrarEventoAgente({
          conexion,
          contextoUsuarioActual,
          tipo: 'agente.perfil_servidor_solicitado',
          agente,
          payload: {
            resultado: 'creado',
            antes: null,
            despues: this.fotografiaPerfilServidor(promovido)
          }
        });

        return promovido;
      }
    );

    return Object.freeze({
      agente,
      perfil: perfil.serializar()
    });
  }

  capturarAgente(agenteId, conexion) {
    if (!this.capturadorFederacion) return null;
    return this.capturadorFederacion.capturarEnTransaccion({
      familia: 'contextoOperativoAgentesSesiones',
      prepararCapturas: ({ interfazCaptura }) =>
        interfazCaptura.prepararCapturaEnTransaccion({ agenteId }, { conexion })
    }, { conexion });
  }

  async obtenerAgenteModificable(contextoUsuarioActual, idAgente) {
    this.politicaPermisosAgentes.assertPuedeModificar(contextoUsuarioActual);

    const agente = await this.repositorioAgentes.buscarPorId(idAgente);

    if (
      !agente ||
      !this.politicaPermisosAgentes.puedeAlcanzarAgente(
        contextoUsuarioActual,
        agente
      )
    ) {
      throw new Error('No existe el agente solicitado dentro de tu alcance.');
    }

    return agente;
  }

  async obtenerAgenteVisible(contextoUsuarioActual, idAgente) {
    this.politicaPermisosAgentes.assertPuedeVer(contextoUsuarioActual);
    const agente = await this.repositorioAgentes.buscarPorId(idAgente);
    if (
      !agente ||
      !this.politicaPermisosAgentes.puedeAlcanzarAgente(
        contextoUsuarioActual,
        agente
      )
    ) {
      throw new Error('No existe el agente solicitado dentro de tu alcance.');
    }
    return agente;
  }

  async resolverSitioAlcanzable(contextoUsuarioActual, sitioId) {
    const sitio = await this.repositorioSitios.buscarPorId(sitioId);

    if (!sitio) {
      throw new Error('No existe el sitio indicado para el agente.');
    }

    if (
      !this.politicaPermisosAgentes.puedeAlcanzarAgente(
        contextoUsuarioActual,
        {
          tenantId: sitio.tenantId,
          empresaId: sitio.empresaId,
          sitioId: sitio.id
        }
      )
    ) {
      throw new Error('El sitio indicado queda fuera de tu alcance.');
    }

    return sitio;
  }

  construirResultadoProvisionamiento({ agente, guid, secreto }) {
    return {
      agente,
      credenciales: {
        guid,
        secreto,
        versionSecreto: agente.versionSecreto,
        mostrarUnaSolaVez: true
      }
    };
  }

  auditoriaActiva() {
    return Boolean(
      this.fronteraTransaccional?.ejecutar &&
      this.servicioAuditoria?.registrarEnTransaccion &&
      this.servicioAuditoria?.registrarMovimientoEnTransaccion
    );
  }

  async registrarEventoAgente({
    conexion,
    contextoUsuarioActual,
    eventoId = null,
    tipo,
    agente,
    payload,
    rolEvento = 'principal',
    causalidadId = null,
    sujetoTipo = 'agente',
    sujetoId = agente.id
  }) {
    return this.servicioAuditoria.registrarEnTransaccion({
      cambioEfectivo: true,
      intencion: this.crearIntencionAgente({
        contextoUsuarioActual,
        eventoId,
        tipo,
        agente,
        payload,
        rolEvento,
        causalidadId,
        sujetoTipo,
        sujetoId
      })
    }, { conexion });
  }

  async registrarMovimientoScopeAgente({
    conexion,
    contextoUsuarioActual,
    agente,
    scopeAnterior,
    scopePosterior
  }) {
    const salidaId = generarUuidV7Auditoria();
    const entradaId = generarUuidV7Auditoria();
    const correlacionId = generarUuidV7Auditoria();
    const claveOperacion = generarUuidV7Auditoria();
    const comun = {
      versionContrato: 1,
      flujo: 'agentes',
      actorReal: this.actorReal(contextoUsuarioActual),
      actorEfectivo: this.actorEfectivo(contextoUsuarioActual),
      modoActuacion: contextoUsuarioActual?.impersonacionActiva
        ? 'impersonado'
        : 'directo',
      sujeto: { tipo: 'agente', id: String(agente.id) },
      origen: 'web',
      correlacionId,
      causalidad: null,
      productor: 'portal_web',
      claveOperacion,
      efectivoEnUtc: this.ahora().toISOString(),
      versionCanonicalizador: PERFIL_JCS_AUDITORIA_V1,
      versionEncadenado: VERSION_ENCADENADO_AUDITORIA_V1
    };
    const salida = {
      ...comun,
      eventoId: salidaId,
      tipo: 'scope.entidad_salida',
      claveCadena: this.claveCadenaAgentes(scopeAnterior),
      scope: scopeAnterior,
      rolEvento: 'salida',
      payload: {
        direccion: 'salida',
        scopePropio: scopeAnterior,
        eventoContraparteId: entradaId,
        impactoResumen: null
      }
    };
    const entrada = {
      ...comun,
      eventoId: entradaId,
      tipo: 'scope.entidad_entrada',
      claveCadena: this.claveCadenaAgentes(scopePosterior),
      scope: scopePosterior,
      rolEvento: 'entrada',
      payload: {
        direccion: 'entrada',
        scopePropio: scopePosterior,
        eventoContraparteId: salidaId,
        impactoResumen: null
      }
    };
    return this.servicioAuditoria.registrarMovimientoEnTransaccion({
      cambioEfectivo: true,
      salida,
      entrada
    }, { conexion });
  }

  async registrarInvalidacionTecnicaSiProcede({
    conexion,
    contextoUsuarioActual,
    agente,
    causalidadId,
    causa = 'scope_cambiado',
    dominioHuella = 'scope'
  }) {
    if (!agente.sesionAuditoriaId) return null;
    if (!this.repositorioOperacionesSesionAgentes?.crearInvalidacionEnTransaccion) {
      return null;
    }
    const operacionId = generarUuidV7Auditoria();
    await this.repositorioOperacionesSesionAgentes.crearInvalidacionEnTransaccion({
      operacionId,
      causaOperacionId: causalidadId,
      agenteId: agente.id,
      sesionAuditoriaId: agente.sesionAuditoriaId,
      huellaIntencion: this.calcularHuellaInvalidacionTecnica({
        agente,
        causalidadId,
        operacionId,
        causa,
        dominioHuella
      }),
      actor: this.actorReal(contextoUsuarioActual),
      actorEfectivo: this.actorEfectivo(contextoUsuarioActual),
      origen: 'web',
      scope: this.scopeAgente(agente)
    }, { conexion });
    return this.registrarEventoAgente({
      conexion,
      contextoUsuarioActual,
      tipo: 'agente.sesion_invalidada',
      agente,
      sujetoTipo: 'sesion_agente',
      sujetoId: agente.sesionAuditoriaId,
      rolEvento: 'resultado',
      causalidadId,
      payload: {
        sesionAuditoriaId: agente.sesionAuditoriaId,
        resultado: 'invalidada',
        causa
      }
    });
  }

  crearIntencionAgente({
    contextoUsuarioActual,
    eventoId = null,
    tipo,
    agente,
    payload,
    rolEvento,
    causalidadId,
    sujetoTipo,
    sujetoId
  }) {
    const scope = this.scopeAgente(agente);
    return {
      eventoId: eventoId || generarUuidV7Auditoria(),
      tipo,
      versionContrato: 1,
      flujo: 'agentes',
      claveCadena: this.claveCadenaAgentes(scope),
      actor: 'usuario',
      actorReal: this.actorReal(contextoUsuarioActual),
      actorEfectivo: this.actorEfectivo(contextoUsuarioActual),
      modoActuacion: contextoUsuarioActual?.impersonacionActiva
        ? 'impersonado'
        : 'directo',
      sujeto: { tipo: sujetoTipo, id: String(sujetoId) },
      origen: 'web',
      scope,
      correlacionId: generarUuidV7Auditoria(),
      causalidad: causalidadId
        ? { tipo: 'evento_auditoria', id: causalidadId }
        : null,
      productor: 'portal_web',
      claveOperacion: generarUuidV7Auditoria(),
      rolEvento,
      efectivoEnUtc: this.ahora().toISOString(),
      versionCanonicalizador: PERFIL_JCS_AUDITORIA_V1,
      versionEncadenado: VERSION_ENCADENADO_AUDITORIA_V1,
      payload
    };
  }

  fotografiaAgente(agente) {
    return {
      nombre: agente.nombre,
      descripcion: agente.descripcion,
      estadoAdministrativo: agente.estadoAdministrativo,
      estadoAcceso: agente.estadoAcceso,
      tenantId: String(agente.tenantId),
      empresaId: String(agente.empresaId),
      sitioId: String(agente.sitioId)
    };
  }

  fotografiaPerfilServidor(perfil) {
    return {
      perfilOperativo: PERFILES_OPERATIVOS_AGENTE.SERVIDOR,
      generacionPerfilServidor: perfil.generacion,
      estadoPerfilServidor: perfil.estado,
      histeresisSinPolSegundos: perfil.histeresisSinPolSegundos,
      duracionReinicioRecienteSegundos:
        perfil.duracionReinicioRecienteSegundos
    };
  }

  resolverMotivoPerfilServidorNoDisponible({ perfil, elegibilidad }) {
    if (!this.perfilServidorHabilitado) {
      return 'La promoción está cerrada por bandera hasta completar el runtime.';
    }
    if (perfil?.estaVigente()) {
      return 'El agente ya tiene una generación de perfil servidor vigente.';
    }
    if (!elegibilidad.elegible) {
      return 'Faltan pruebas empíricas de login con bootId o heartbeat explícito.';
    }
    return null;
  }

  assertMutacionPerfilServidorDisponible() {
    this.assertRepositorioPerfilesServidorDisponible();
    if (!this.perfilServidorHabilitado) {
      throw new Error('La gestión del perfil servidor está cerrada por bandera.');
    }
    if (!this.auditoriaActiva()) {
      throw new Error('La gestión del perfil servidor exige auditoría activa.');
    }
    if (
      typeof this.repositorioPerfilesServidor
        ?.actualizarConfiguracionEnTransaccion !== 'function'
    ) {
      throw new Error('La configuración del perfil servidor no está disponible.');
    }
  }

  async publicarRetiradaPerfilServidorPostcommit(retirada) {
    const efectos = await Promise.allSettled([
      this.coordinadorPerfilServidorRedis?.retirarProyecciones?.({
        perfiles: [{
          agenteId: retirada.agenteId,
          generacion: retirada.generacion
        }],
        motivo: 'perfil_retirado_administrativamente'
      }),
      retirada.fotografiasRetiradas.length > 0
        ? this.publicadorInvalidacionesMonitores
            ?.publicarFotografiasActualizadas?.({
              fotografias: retirada.fotografiasRetiradas
            })
        : null,
      retirada.estadosReglasRetirados.length > 0
        ? this.publicadorInvalidacionesMonitores
            ?.publicarEstadosReglasActualizados?.({
              estados: retirada.estadosReglasRetirados
            })
        : null
    ]);
    return Object.freeze({
      completados: efectos.filter(({ status }) => status === 'fulfilled').length,
      fallidos: efectos.filter(({ status }) => status === 'rejected').length
    });
  }

  assertRepositorioPerfilesServidorDisponible() {
    if (
      !this.repositorioPerfilesServidor?.buscarPorAgenteId ||
      !this.repositorioPerfilesServidor?.buscarEvidenciaElegibilidad ||
      !this.repositorioPerfilesServidor?.promoverEnTransaccion
    ) {
      throw new Error('El repositorio de perfiles servidor no está configurado.');
    }
  }

  assertPublicadorTelemetriaRuntimeDisponible() {
    if (
      typeof this.publicadorTelemetriaRuntimeEnTransaccion
        ?.asegurarCatalogoServidorEnTransaccion !== 'function'
    ) {
      throw new Error(
        'La promoción a perfil servidor exige el publicador transaccional de telemetría runtime.'
      );
    }
  }

  assertRepositorioEstadoRuntimeServidorDisponible() {
    if (
      typeof this.repositorioEstadoRuntimeServidor
        ?.crearParaPerfilEnTransaccion !== 'function'
    ) {
      throw new Error(
        'La promoción a perfil servidor exige su proyección runtime transaccional.'
      );
    }
  }

  normalizarEnteroPositivo(valor, campo) {
    const numero = Number(valor);

    if (!Number.isSafeInteger(numero) || numero <= 0) {
      throw new Error(`${campo} debe ser un entero positivo.`);
    }

    return numero;
  }

  camposMetadatosCambiados(antes, despues) {
    return ['descripcion', 'nombre']
      .filter((campo) => this.fotografiaAgente(antes)[campo] !== this.fotografiaAgente(despues)[campo]);
  }

  seleccionarCampos(objeto, campos) {
    return Object.fromEntries(campos.map((campo) => [campo, objeto[campo] ?? null]));
  }

  scopeAgente(agente) {
    return {
      tenantId: String(agente.tenantId),
      empresaId: String(agente.empresaId),
      sitioId: String(agente.sitioId)
    };
  }

  scopeSitio(sitio) {
    return {
      tenantId: String(sitio.tenantId),
      empresaId: String(sitio.empresaId),
      sitioId: String(sitio.id)
    };
  }

  scopesIguales(a, b) {
    return (
      String(a.tenantId) === String(b.tenantId) &&
      String(a.empresaId) === String(b.empresaId) &&
      String(a.sitioId) === String(b.sitioId)
    );
  }

  claveCadenaAgentes(scope) {
    return `agentes:tenant:${String(scope.tenantId)}`;
  }

  actorReal(contextoUsuarioActual) {
    return {
      tipo: 'usuario',
      id: String(
        contextoUsuarioActual?.idUsuarioReal ??
        contextoUsuarioActual?.idUsuario
      )
    };
  }

  actorEfectivo(contextoUsuarioActual) {
    const idReal = contextoUsuarioActual?.idUsuarioReal ?? contextoUsuarioActual?.idUsuario;
    const idEfectivo = contextoUsuarioActual?.idUsuario ?? idReal;
    return String(idReal) === String(idEfectivo)
      ? null
      : { tipo: 'usuario', id: String(idEfectivo) };
  }

  calcularHuellaInvalidacionTecnica({
    agente,
    causalidadId,
    operacionId,
    causa,
    dominioHuella
  }) {
    return createHash('sha256')
      .update(`sentinelia:agente:${dominioHuella}:invalidacion:v1`)
      .update('\0')
      .update(String(agente.id))
      .update('\0')
      .update(String(agente.sesionAuditoriaId))
      .update('\0')
      .update(String(causa))
      .update('\0')
      .update(String(causalidadId))
      .update('\0')
      .update(String(operacionId))
      .digest('hex');
  }
}

function construirFotografiaAdministrativaPerfilServidor({
  perfil,
  estadoRuntime
}) {
  if (!perfil) {
    return Object.freeze({
      disponible: false,
      motivo: 'agente_generico',
      sinPol: null,
      reinicioReciente: null
    });
  }
  if (!perfil.estaVigente()) {
    return Object.freeze({
      disponible: false,
      motivo: 'perfil_cerrado',
      sinPol: null,
      reinicioReciente: null
    });
  }
  const disponible = typeof estadoRuntime?.valorSinPol === 'boolean' &&
    typeof estadoRuntime?.valorReinicioReciente === 'boolean';
  return Object.freeze({
    disponible,
    motivo: disponible ? null : 'pendiente_primera_evidencia',
    sinPol: disponible ? estadoRuntime.valorSinPol : null,
    reinicioReciente: disponible
      ? estadoRuntime.valorReinicioReciente
      : null
  });
}

function exigirPerfilVigenteEsperado(perfil, {
  generacion,
  versionEsperada
}) {
  if (!perfil?.estaVigente()) {
    throw new Error('El agente no tiene un perfil servidor vigente.');
  }
  if (
    perfil.generacion !== generacion ||
    perfil.versionEstado !== versionEsperada
  ) {
    throw new Error(
      'El perfil servidor cambió mientras se editaba; recarga antes de continuar.'
    );
  }
}

function camposConfiguracionCambiados(perfil, configuracion) {
  return [
    'duracionReinicioRecienteSegundos',
    'histeresisSinPolSegundos'
  ].filter((campo) => perfil[campo] !== configuracion[campo]);
}

function seleccionarCamposConfiguracion(perfil, campos) {
  return Object.fromEntries(campos.map((campo) => [campo, perfil[campo]]));
}

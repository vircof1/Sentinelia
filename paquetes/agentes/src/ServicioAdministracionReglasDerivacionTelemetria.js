import {
  ESTADOS_REGLA_DERIVACION_TELEMETRIA,
  TIPOS_CONDICION_DERIVACION_TELEMETRIA
} from './EventosDerivadosTelemetriaAgentes.js';
import {
  crearCondicionTipadaDerivacionTelemetria,
  evaluarCondicionRegexTelemetria
} from './EvaluadorCondicionesDerivacionTelemetria.js';
import {
  crearCondicionMomentoUtcRelativo,
  evaluarMomentoUtcRelativo,
  CAUSAS_EVALUACION_MOMENTO_UTC_RELATIVO,
  TIPO_CONDICION_MOMENTO_UTC_RELATIVO
} from './EvaluadorMomentoUtcRelativoTelemetria.js';
import {
  CAUSAS_TRABAJO_EVALUACION_TELEMETRIA
} from './RepositorioTrabajosEvaluacionTelemetria.js';
import { PoliticaPermisosAgentes } from './PoliticaPermisosAgentes.js';
import { generarUuidV7Auditoria } from '../../auditoria/src/UuidV7Auditoria.js';
import {
  PERFIL_JCS_AUDITORIA_V1
} from '../../auditoria/src/PerfilJcsAuditoria.js';
import {
  VERSION_ENCADENADO_AUDITORIA_V1
} from '../../auditoria/src/SobreCanonicoAuditoria.js';
import { normalizarMarcaUtc } from '../../utilidades/src/fechas/normalizarMarcaUtc.js';

const CLAVES_CREACION = new Set(['agenteId', 'senalId', 'revision']);
const CLAVES_REVISION = new Set([
  'nombre',
  'descripcion',
  'severidadCalculada',
  'mensajeOperativo',
  'metadatos',
  'condicion'
]);
const CLAVES_CONDICION_ADMINISTRATIVA = new Set([
  'tipo',
  'version',
  'operador',
  'umbral',
  'umbralUtc',
  'modo',
  'patron',
  'opciones',
  'valorEsperado',
  'calidadEsperada',
  'configuracion'
]);
const CLAVES_METADATOS_AUDITABLES_REGLA = new Set([
  'origen',
  'causaProbable',
  'posibleSolucion',
  'impactoOperativo'
]);

export class ServicioAdministracionReglasDerivacionTelemetria {
  constructor({
    repositorioAgentes,
    repositorioCatalogoSenales,
    repositorioReglas,
    repositorioEstadoActualEvaluacion = null,
    repositorioEventosDerivados = null,
    repositorioTrabajosEvaluacion = null,
    repositorioEstadoActualTelemetria = null,
    politicaPermisosAgentes = new PoliticaPermisosAgentes(),
    fronteraTransaccional = null,
    servicioAuditoria = null,
    capturadorFederacionTelemetria = null,
    permitirMomentoUtcRelativo = false,
    permitirPrevisualizacionMomentoUtcRelativo = false,
    leerAhoraUtcSql = null,
    ahora = () => new Date()
  } = {}) {
    for (const [nombre, dependencia] of Object.entries({
      repositorioAgentes,
      repositorioCatalogoSenales,
      repositorioReglas,
      politicaPermisosAgentes
    })) {
      if (!dependencia) {
        throw new Error(`La dependencia ${nombre} del servicio es obligatoria.`);
      }
    }

    this.repositorioAgentes = repositorioAgentes;
    this.repositorioCatalogoSenales = repositorioCatalogoSenales;
    this.repositorioReglas = repositorioReglas;
    this.repositorioEstadoActualEvaluacion = repositorioEstadoActualEvaluacion;
    this.repositorioEventosDerivados = repositorioEventosDerivados;
    this.repositorioTrabajosEvaluacion = repositorioTrabajosEvaluacion;
    this.repositorioEstadoActualTelemetria = repositorioEstadoActualTelemetria;
    this.politicaPermisosAgentes = politicaPermisosAgentes;
    this.fronteraTransaccional = fronteraTransaccional;
    this.servicioAuditoria = servicioAuditoria;
    if (capturadorFederacionTelemetria !== null &&
        typeof capturadorFederacionTelemetria?.capturarReglaEnTransaccion !==
          'function') {
      throw new Error('La administración de reglas requiere captura federada transaccional.');
    }
    if (capturadorFederacionTelemetria &&
        typeof fronteraTransaccional?.ejecutar !== 'function') {
      throw new Error('Las reglas federables requieren frontera transaccional.');
    }
    this.capturadorFederacionTelemetria = capturadorFederacionTelemetria;
    this.permitirMomentoUtcRelativo = Boolean(permitirMomentoUtcRelativo);
    this.permitirPrevisualizacionMomentoUtcRelativo = Boolean(
      permitirPrevisualizacionMomentoUtcRelativo
    );
    if (this.permitirMomentoUtcRelativo) {
      for (const [nombre, dependencia] of Object.entries({
        fronteraTransaccional,
        repositorioTrabajosEvaluacion,
        repositorioEstadoActualTelemetria
      })) {
        if (!dependencia) {
          throw new Error(`La autoridad relativa requiere ${nombre}.`);
        }
      }
    }
    if (this.permitirPrevisualizacionMomentoUtcRelativo) {
      if (!repositorioEstadoActualTelemetria) {
        throw new Error('La previsualización relativa requiere fotografías vigentes.');
      }
      if (typeof leerAhoraUtcSql !== 'function') {
        throw new Error('La previsualización relativa requiere el reloj SQL.');
      }
    }
    this.leerAhoraUtcSql = leerAhoraUtcSql;
    this.ahora = ahora;
  }

  async construirVistaOperativaReglasAgente(
    contextoUsuarioActual,
    agenteId,
    { eventosPorRegla = 5, senalId = null } = {}
  ) {
    this.asegurarRepositoriosOperativos();
    const lectura = await this.listarReglasPorAgente(
      contextoUsuarioActual,
      agenteId,
      { senalId }
    );
    const limiteEventos = normalizarLimite(eventosPorRegla, 1, 25);
    const reglas = await Promise.all(
      lectura.reglas.map((regla) => this.enriquecerReglaOperativa(
        regla,
        limiteEventos
      ))
    );

    return congelarContrato({
      agente: lectura.agente,
      reglas,
      resumen: construirResumenOperativo(reglas),
      filtroSenal: lectura.filtroSenal,
      mostrarMomentoUtcRelativo: this.permitirMomentoUtcRelativo
    });
  }

  async construirDetalleOperativo(
    contextoUsuarioActual,
    reglaId,
    { limiteEventos = 50 } = {}
  ) {
    this.asegurarRepositoriosOperativos();
    const [regla, revisiones] = await Promise.all([
      this.obtenerRegla(contextoUsuarioActual, reglaId),
      this.listarRevisiones(contextoUsuarioActual, reglaId)
    ]);
    const agente = await this.resolverAgenteVisible(
      contextoUsuarioActual,
      regla.agenteId
    );
    const operativa = await this.enriquecerReglaOperativa(
      regla,
      normalizarLimite(limiteEventos, 1, 250)
    );

    return congelarContrato({
      agente: serializarEntidad(agente),
      regla: operativa,
      revisiones: revisiones.revisiones,
      mostrarMomentoUtcRelativo: this.permitirMomentoUtcRelativo
    });
  }

  async enriquecerReglaOperativa(regla, limiteEventos) {
    const [estadoActual, eventos, ultimoTrabajo, ultimoError] = await Promise.all([
      this.repositorioEstadoActualEvaluacion.buscarPorRegla(regla.id),
      this.repositorioEventosDerivados.listarPorRegla(
        regla.id,
        { limite: limiteEventos }
      ),
      this.repositorioTrabajosEvaluacion.buscarUltimoPorRegla(regla.id),
      this.repositorioTrabajosEvaluacion.buscarUltimoErrorPorRegla(regla.id)
    ]);

    const estadoSerializado = serializarEntidad(estadoActual);
    return {
      ...regla,
      estadoActual: estadoSerializado,
      interpretacionTemporalRelativa: construirLecturaTemporalRelativa(
        regla,
        estadoSerializado
      ),
      ultimoTrabajo: serializarEntidad(ultimoTrabajo),
      ultimoErrorTecnico: serializarEntidad(ultimoError),
      eventosRecientes: eventos.map(serializarEntidad)
    };
  }

  asegurarRepositoriosOperativos() {
    for (const [nombre, dependencia] of Object.entries({
      repositorioEstadoActualEvaluacion: this.repositorioEstadoActualEvaluacion,
      repositorioEventosDerivados: this.repositorioEventosDerivados,
      repositorioTrabajosEvaluacion: this.repositorioTrabajosEvaluacion
    })) {
      if (!dependencia) {
        throw new Error(`La dependencia operativa ${nombre} es obligatoria.`);
      }
    }
  }

  async listarSenalesCatalogadas(contextoUsuarioActual, agenteId) {
    const agente = await this.resolverAgenteVisible(
      contextoUsuarioActual,
      agenteId
    );
    const senales = await this.repositorioCatalogoSenales.listarPorAgente(
      agente.id
    );

    return congelarContrato({
      agente: serializarEntidad(agente),
      senales: senales.map(serializarSenalAdministrativa)
    });
  }

  async listarReglasPorAgente(
    contextoUsuarioActual,
    agenteId,
    { senalId = null } = {}
  ) {
    const agente = await this.resolverAgenteVisible(
      contextoUsuarioActual,
      agenteId
    );
    const [reglas, senales] = await Promise.all([
      this.repositorioReglas.listarPorAgente(agente.id),
      this.repositorioCatalogoSenales.listarPorAgente(agente.id)
    ]);
    const senalesPorId = new Map(
      senales.map((senal) => [Number(senal.id), senal])
    );
    const idSenal = senalId == null ? null : Number(senalId);
    if (idSenal !== null &&
        (!Number.isInteger(idSenal) || idSenal <= 0 || !senalesPorId.has(idSenal))) {
      throw new Error('La señal no existe dentro del agente visible.');
    }
    const reglasVisibles = idSenal === null
      ? reglas
      : reglas.filter((regla) => Number(regla.regla.senalId) === idSenal);

    return congelarContrato({
      agente: serializarEntidad(agente),
      filtroSenal: idSenal === null
        ? null
        : serializarSenalAdministrativa(senalesPorId.get(idSenal)),
      reglas: reglasVisibles.map((regla) => serializarReglaAdministrativa(
        regla,
        senalesPorId.get(Number(regla.regla.senalId)) || null
      ))
    });
  }

  async obtenerRegla(contextoUsuarioActual, reglaId) {
    const regla = await this.resolverReglaVisible(
      contextoUsuarioActual,
      reglaId
    );
    const senal = await this.resolverSenalDeRegla(regla);

    return congelarContrato(serializarReglaAdministrativa(regla, senal));
  }

  async listarRevisiones(contextoUsuarioActual, reglaId) {
    const regla = await this.resolverReglaVisible(
      contextoUsuarioActual,
      reglaId
    );
    const revisiones = await this.repositorioReglas.listarRevisionesPorRegla(
      regla.regla.id
    );

    return congelarContrato({
      regla: regla.serializar(),
      revisiones: revisiones.map((revision) => revision.serializar())
    });
  }

  async previsualizarCondicion(contextoUsuarioActual, datos = {}) {
    this.politicaPermisosAgentes.assertPuedeModificar(contextoUsuarioActual);
    asegurarObjetoPlano(datos, 'La previsualización de la condición no es válida.');
    datos = Object.hasOwn(datos, 'muestraTexto')
      ? datos
      : { ...datos, muestraTexto: null };
    asegurarClavesExactas(
      datos,
      new Set(['agenteId', 'senalId', 'condicion', 'muestraTexto']),
      'La previsualización contiene campos no admitidos.'
    );
    const agente = await this.resolverAgenteAlcanzable(
      contextoUsuarioActual,
      datos.agenteId
    );
    const senal = await this.resolverSenalCatalogada(agente, datos.senalId);
    const condicion = construirCondicionAdministrativa(datos.condicion, senal, {
      permitirMomentoUtcRelativo: this.permitirPrevisualizacionMomentoUtcRelativo
    });
    const resultadoMuestra = construirResultadoMuestraRegex(
      condicion,
      datos.muestraTexto
    );
    const previsualizacionTemporalRelativa =
      await this.construirPrevisualizacionTemporalRelativa({
        agente,
        senal,
        condicion
      });

    return congelarContrato({
      agente: serializarEntidad(agente),
      senal: serializarSenalAdministrativa(senal),
      condicion: condicion.serializar(),
      condicionCanonica: condicion.obtenerCanonica(),
      resultadoMuestra,
      previsualizacionTemporalRelativa
    });
  }

  async construirPrevisualizacionTemporalRelativa({ agente, senal, condicion }) {
    if (condicion.tipo !== TIPO_CONDICION_MOMENTO_UTC_RELATIVO) return null;
    const fotografia = await this.repositorioEstadoActualTelemetria.buscarPorSenalId({
      agenteId: agente.id,
      senalId: senal.id
    });
    if (!fotografia) {
      return {
        disponible: false,
        motivo: 'sin_fotografia_vigente',
        familia: 'relativa',
        resumenHumano: describirCondicionTemporalRelativa(
          condicion.configuracion
        )
      };
    }
    const observacion = serializarEntidad(fotografia);
    const ahoraUtc = normalizarMarcaUtc(await this.leerAhoraUtcSql())
      ?.replace(/\.000Z$/u, 'Z');
    const evaluacion = evaluarMomentoUtcRelativo({
      condicion,
      momentoUtc: observacion.valorMomentoUtc,
      ahoraUtc,
      causa: CAUSAS_EVALUACION_MOMENTO_UTC_RELATIVO.RECONCILIACION_ADMINISTRATIVA
    });
    return construirPrevisualizacionTemporalRelativa({
      evaluacion,
      observacion,
      condicion
    });
  }

  async crearRegla(contextoUsuarioActual, datos = {}) {
    this.politicaPermisosAgentes.assertPuedeModificar(contextoUsuarioActual);
    asegurarObjetoPlano(datos, 'La creación de la regla no es válida.');
    asegurarClavesExactas(
      datos,
      CLAVES_CREACION,
      'La creación de la regla contiene campos no admitidos.'
    );
    const agente = await this.resolverAgenteAlcanzable(
      contextoUsuarioActual,
      datos.agenteId
    );
    const senal = await this.resolverSenalCatalogada(agente, datos.senalId);
    const revision = construirRevisionAdministrativa(datos.revision, senal, {
      permitirMomentoUtcRelativo: this.permitirMomentoUtcRelativo
    });
    const crear = async (conexion = null) => {
      const metodo = conexion &&
        this.repositorioReglas.crearConRevisionInicialEnTransaccion
        ? 'crearConRevisionInicialEnTransaccion'
        : 'crearConRevisionInicial';
      const regla = await this.repositorioReglas[metodo]({
        agenteId: agente.id,
        senalId: senal.id,
        tenantId: agente.tenantId,
        empresaId: agente.empresaId,
        sitioId: agente.sitioId,
        estado: ESTADOS_REGLA_DERIVACION_TELEMETRIA.ACTIVA,
        revision
      }, { conexion });
      await this.reconciliarAutoridadRelativa({ conexion, regla });
      if (conexion && this.auditoriaActiva()) {
        await this.registrarEventoRegla({
          conexion,
          contextoUsuarioActual,
          tipo: 'regla_telemetria.creada',
          agente,
          regla,
          payload: {
            resultado: 'creado',
            antes: null,
            despues: fotografiaRegla(regla, senal)
          }
        });
      }
      if (conexion) await this.capturarRegla(regla.regla?.id ?? regla.id, conexion);
      return regla;
    };
    const regla = this.requiereTransaccion()
      ? await this.fronteraTransaccional.ejecutar(crear)
      : await crear();

    return congelarContrato(serializarReglaAdministrativa(regla, senal));
  }

  async crearNuevaRevision(contextoUsuarioActual, datos = {}) {
    this.politicaPermisosAgentes.assertPuedeModificar(contextoUsuarioActual);
    asegurarObjetoPlano(datos, 'La edición de la regla no es válida.');
    asegurarClavesExactas(
      datos,
      new Set(['reglaId', 'revision']),
      'La edición de la regla contiene campos no admitidos.'
    );
    const regla = await this.resolverReglaAlcanzable(
      contextoUsuarioActual,
      datos.reglaId
    );
    const senal = await this.resolverSenalDeRegla(regla);
    const revision = construirRevisionAdministrativa(datos.revision, senal, {
      permitirMomentoUtcRelativo: this.permitirMomentoUtcRelativo
    });
    const crear = async (conexion = null) => {
      const metodo = conexion && this.repositorioReglas.crearNuevaRevisionEnTransaccion
        ? 'crearNuevaRevisionEnTransaccion'
        : 'crearNuevaRevision';
      const creada = await this.repositorioReglas[metodo]({
        reglaId: regla.regla.id,
        revision
      }, { conexion });
      const reglaActual = conexion
        ? await this.repositorioReglas.buscarPorId(regla.regla.id, { conexion })
        : null;
      if (reglaActual) {
        await this.reconciliarAutoridadRelativa({
          conexion,
          regla: reglaActual,
          revision: creada
        });
      }
      if (conexion && this.auditoriaActiva()) {
        const fotografia = fotografiaRevision(
          creada,
          reglaActual?.regla ?? regla.regla,
          senal
        );
        await this.registrarEventoRegla({
          conexion,
          contextoUsuarioActual,
          tipo: 'regla_telemetria.revision_creada',
          agente: regla.regla,
          regla,
          payload: {
            resultado: 'creado',
            antes: null,
            despues: {
              agenteId: fotografia.agenteId,
              senalId: fotografia.senalId,
              generacionAutoridad: String(reglaActual?.regla.generacionAutoridad ??
                regla.regla.generacionAutoridad),
              nombre: fotografia.nombre,
              descripcion: fotografia.descripcion,
              condicion: fotografia.condicion,
              severidadCalculada: fotografia.severidadCalculada,
              mensajeOperativo: fotografia.mensajeOperativo,
              metadatos: fotografia.metadatos,
              revision: fotografia
            }
          }
        });
      }
      if (conexion) await this.capturarRegla(regla.regla.id, conexion);
      return creada;
    };
    const creada = this.requiereTransaccion()
      ? await this.fronteraTransaccional.ejecutar(crear)
      : await crear();

    return congelarContrato({
      reglaId: regla.regla.id,
      agenteId: regla.regla.agenteId,
      senalId: regla.regla.senalId,
      revision: creada.serializar()
    });
  }

  async asegurarReglaPerteneceAgenteParaModificar(
    contextoUsuarioActual,
    reglaId,
    agenteId
  ) {
    this.politicaPermisosAgentes.assertPuedeModificar(contextoUsuarioActual);
    const regla = await this.resolverReglaAlcanzable(
      contextoUsuarioActual,
      reglaId
    );
    if (Number(regla.regla.agenteId) !== Number(agenteId)) {
      throw new Error('La regla no pertenece al agente indicado.');
    }
    return congelarContrato(regla.serializar());
  }

  async activarRegla(contextoUsuarioActual, reglaId) {
    return this.cambiarEstado(
      contextoUsuarioActual,
      reglaId,
      ESTADOS_REGLA_DERIVACION_TELEMETRIA.ACTIVA
    );
  }

  async desactivarRegla(contextoUsuarioActual, reglaId) {
    return this.cambiarEstado(
      contextoUsuarioActual,
      reglaId,
      ESTADOS_REGLA_DERIVACION_TELEMETRIA.DESHABILITADA
    );
  }

  async cambiarEstado(contextoUsuarioActual, reglaId, estado) {
    this.politicaPermisosAgentes.assertPuedeModificar(contextoUsuarioActual);
    const regla = await this.resolverReglaAlcanzable(
      contextoUsuarioActual,
      reglaId
    );
    const senal = await this.resolverSenalDeRegla(regla);
    if (regla.regla.estado === estado) {
      return congelarContrato(serializarReglaAdministrativa(regla, senal));
    }
    const cambiar = async (conexion = null) => {
      const metodo = conexion && this.repositorioReglas.cambiarEstadoEnTransaccion
        ? 'cambiarEstadoEnTransaccion'
        : 'cambiarEstado';
      const actualizada = await this.repositorioReglas[metodo](
        regla.regla.id,
        estado,
        { conexion }
      );
      if (estado === ESTADOS_REGLA_DERIVACION_TELEMETRIA.ACTIVA) {
        await this.reconciliarAutoridadRelativa({
          conexion,
          regla: actualizada
        });
      }
      if (conexion && this.auditoriaActiva()) {
        await this.registrarEventoRegla({
          conexion,
          contextoUsuarioActual,
          tipo: 'regla_telemetria.estado_cambiado',
          agente: regla.regla,
          regla: actualizada,
          payload: {
            estadoAntes: regla.regla.estado,
            estadoDespues: actualizada.regla.estado,
            motivo: 'operador',
            generacionAutoridadAntes: String(regla.regla.generacionAutoridad),
            generacionAutoridadDespues: String(
              actualizada.regla.generacionAutoridad
            ),
            revisionVigenteId: String(actualizada.regla.revisionVigenteId)
          }
        });
      }
      if (conexion) await this.capturarRegla(actualizada.regla.id, conexion);
      return actualizada;
    };
    const actualizada = this.requiereTransaccion()
      ? await this.fronteraTransaccional.ejecutar(cambiar)
      : await cambiar();

    return congelarContrato(serializarReglaAdministrativa(actualizada, senal));
  }

  async resolverAgenteVisible(contextoUsuarioActual, agenteId) {
    this.politicaPermisosAgentes.assertPuedeVer(contextoUsuarioActual);
    return this.resolverAgenteAlcanzable(contextoUsuarioActual, agenteId);
  }

  async resolverAgenteAlcanzable(contextoUsuarioActual, agenteId) {
    const agente = await this.repositorioAgentes.buscarPorId(agenteId);
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

  async resolverReglaVisible(contextoUsuarioActual, reglaId) {
    this.politicaPermisosAgentes.assertPuedeVer(contextoUsuarioActual);
    return this.resolverReglaAlcanzable(contextoUsuarioActual, reglaId);
  }

  async resolverReglaAlcanzable(contextoUsuarioActual, reglaId) {
    const regla = await this.repositorioReglas.buscarPorId(reglaId);
    if (
      !regla ||
      !this.politicaPermisosAgentes.puedeAlcanzarAgente(
        contextoUsuarioActual,
        regla.regla
      )
    ) {
      throw new Error('No existe la regla solicitada dentro de tu alcance.');
    }
    return regla;
  }

  async resolverSenalCatalogada(agente, senalId) {
    const senal = await this.repositorioCatalogoSenales.buscarPorId(senalId);
    if (!senal || Number(senal.agenteId) !== Number(agente.id)) {
      throw new Error('La señal seleccionada no pertenece al agente indicado.');
    }
    return senal;
  }

  async resolverSenalDeRegla(regla) {
    return this.resolverSenalCatalogada(
      { id: regla.regla.agenteId },
      regla.regla.senalId
    );
  }

  auditoriaActiva() {
    return Boolean(
      this.fronteraTransaccional?.ejecutar &&
      this.servicioAuditoria?.registrarEnTransaccion
    );
  }

  requiereTransaccion() {
    return this.auditoriaActiva() || Boolean(this.capturadorFederacionTelemetria) ||
      this.permitirMomentoUtcRelativo;
  }

  async reconciliarAutoridadRelativa({ conexion, regla, revision = null }) {
    const reglaDominio = regla?.regla ?? regla;
    const revisionDominio = revision ?? regla?.revisionVigente ?? null;
    if (
      !conexion ||
      !this.permitirMomentoUtcRelativo ||
      reglaDominio?.estado !== ESTADOS_REGLA_DERIVACION_TELEMETRIA.ACTIVA ||
      revisionDominio?.condicion?.tipo !== TIPO_CONDICION_MOMENTO_UTC_RELATIVO
    ) {
      return null;
    }
    const fotografia = await this.repositorioEstadoActualTelemetria
      .bloquearPorSenalEnTransaccion({
        agenteId: reglaDominio.agenteId,
        senalId: reglaDominio.senalId
      }, { conexion });
    if (!fotografia) return null;
    const observacion = serializarEntidad(fotografia);
    return this.repositorioTrabajosEvaluacion
      .encolarAutoridadActualEnTransaccion({
        observacion: {
          ...observacion,
          id: observacion.ultimaObservacionId
        },
        regla: reglaDominio,
        revision: revisionDominio,
        causa: CAUSAS_TRABAJO_EVALUACION_TELEMETRIA.RECONCILIACION_ADMINISTRATIVA,
        generacionAutoridad: reglaDominio.generacionAutoridad
      }, { conexion });
  }

  capturarRegla(reglaId, conexion) {
    if (!this.capturadorFederacionTelemetria) return null;
    return this.capturadorFederacionTelemetria.capturarReglaEnTransaccion(
      { reglaId },
      { conexion }
    );
  }

  registrarEventoRegla({
    conexion,
    contextoUsuarioActual,
    tipo,
    agente,
    regla,
    payload
  }) {
    const eventoId = generarUuidV7Auditoria();
    const scope = scopeDesdeAgenteORegla(agente);
    return this.servicioAuditoria.registrarEnTransaccion({
      cambioEfectivo: true,
      intencion: {
        versionContrato: 1,
        eventoId,
        tipo,
        flujo: 'agentes',
        claveCadena: `agentes:tenant:${scope.tenantId}`,
        actor: 'usuario',
        actorReal: actorReal(contextoUsuarioActual),
        actorEfectivo: actorEfectivo(contextoUsuarioActual),
        modoActuacion: contextoUsuarioActual?.impersonacionActiva
          ? 'impersonado'
          : 'directo',
        sujeto: { tipo: 'regla_telemetria', id: String(regla.regla?.id ?? regla.id) },
        origen: 'web',
        correlacionId: eventoId,
        causalidad: null,
        productor: 'portal_web',
        claveOperacion: eventoId,
        scope,
        efectivoEnUtc: this.ahora().toISOString(),
        rolEvento: 'principal',
        payload,
        versionCanonicalizador: PERFIL_JCS_AUDITORIA_V1,
        versionEncadenado: VERSION_ENCADENADO_AUDITORIA_V1
      }
    }, { conexion });
  }
}

function construirResultadoMuestraRegex(condicion, muestraTexto) {
  if (condicion.tipo !== TIPOS_CONDICION_DERIVACION_TELEMETRIA.TEXTO_REGEX) {
    if (muestraTexto !== null) {
      throw new Error('Solo una condición regex admite una muestra textual.');
    }
    return null;
  }
  if (typeof muestraTexto !== 'string') {
    throw new Error('La muestra textual de previsualización es obligatoria.');
  }
  const evaluacion = evaluarCondicionRegexTelemetria({
    configuracion: condicion.configuracion,
    texto: muestraTexto
  });
  return {
    resultado: evaluacion.cumple ? 'coincide' : 'no_coincide',
    modo: evaluacion.evidencia.modo,
    conteo: evaluacion.evidencia.conteo,
    coincidenciaEncontrada: evaluacion.evidencia.coincidenciaEncontrada,
    operador: evaluacion.evidencia.operador,
    umbral: evaluacion.evidencia.umbral,
    valorEvidencia: evaluacion.valorEvidencia
  };
}

function construirRevisionAdministrativa(
  datos,
  senal,
  { permitirMomentoUtcRelativo = false } = {}
) {
  asegurarObjetoPlano(datos, 'La configuración de la revisión es obligatoria.');
  asegurarClavesExactas(
    datos,
    CLAVES_REVISION,
    'La revisión contiene campos no admitidos.'
  );

  return {
    nombre: datos.nombre,
    descripcion: datos.descripcion,
    severidadCalculada: datos.severidadCalculada,
    mensajeOperativo: datos.mensajeOperativo,
    metadatos: datos.metadatos,
    condicion: construirCondicionAdministrativa(datos.condicion, senal, {
      permitirMomentoUtcRelativo
    })
  };
}

function construirCondicionAdministrativa(
  datos,
  senal,
  { permitirMomentoUtcRelativo = false } = {}
) {
  asegurarObjetoPlano(datos, 'La condición administrativa es obligatoria.');
  asegurarClavesExactas(
    datos,
    CLAVES_CONDICION_ADMINISTRATIVA,
    'La condición contiene campos no admitidos.'
  );

  if (datos.tipo === TIPO_CONDICION_MOMENTO_UTC_RELATIVO) {
    if (!permitirMomentoUtcRelativo) {
      throw new Error('La condición temporal relativa todavía no está habilitada.');
    }
    if (senal?.tipoDato !== 'momento_utc') {
      throw new Error('La condición temporal relativa exige una señal momento_utc.');
    }
    return crearCondicionMomentoUtcRelativo(datos.configuracion);
  }

  return crearCondicionTipadaDerivacionTelemetria({
    senal,
    tipo: datos.tipo,
    version: datos.version,
    operador: datos.operador,
    umbral: datos.umbral,
    umbralUtc: datos.umbralUtc,
    modo: datos.modo,
    patron: datos.patron,
    opciones: datos.opciones,
    valorEsperado: datos.valorEsperado,
    calidadEsperada: datos.calidadEsperada
  });
}

function construirLecturaTemporalRelativa(regla, estadoActual) {
  const condicion = regla?.revisionVigente?.condicion;
  if (condicion?.tipo !== TIPO_CONDICION_MOMENTO_UTC_RELATIVO) return null;
  const temporal = estadoActual?.evidenciaContextual?.temporal ?? null;
  const proximaFronteraUtc = estadoActual?.proximaReevaluacionUtc ?? null;
  return {
    familia: 'relativa',
    condicion: clonarJson(condicion),
    resumenHumano: describirCondicionTemporalRelativa(condicion.configuracion),
    momentoUtc: temporal?.momentoUtc ?? null,
    ahoraUtc: temporal?.ahoraUtc ?? estadoActual?.evaluadoEnUtc ?? null,
    desviacionSegundos: temporal?.desviacionSegundos ?? null,
    ladoAtencion: estadoActual?.ladoAtencion ?? null,
    resultado: estadoActual?.resultado ?? null,
    proximaFronteraUtc,
    programacion: {
      estado: !estadoActual
        ? 'sin_evaluacion'
        : (proximaFronteraUtc ? 'programada' : 'sin_proxima_frontera'),
      motivo: temporal?.motivoProgramacion ?? null,
      proximaFronteraUtc
    }
  };
}

function construirPrevisualizacionTemporalRelativa({
  evaluacion,
  observacion,
  condicion
}) {
  return {
    disponible: true,
    familia: 'relativa',
    resumenHumano: describirCondicionTemporalRelativa(condicion.configuracion),
    momentoUtc: evaluacion.temporal.momentoUtc,
    ahoraUtc: evaluacion.temporal.ahoraUtc,
    desviacionSegundos: evaluacion.temporal.desviacionSegundos,
    ladoAtencion: evaluacion.ladoAtencion,
    resultado: evaluacion.resultado,
    proximaFronteraUtc: evaluacion.proximaReevaluacionUtc,
    programacion: {
      estado: evaluacion.proximaReevaluacionUtc
        ? 'programada'
        : 'sin_proxima_frontera',
      motivo: evaluacion.motivoProgramacion,
      proximaFronteraUtc: evaluacion.proximaReevaluacionUtc
    },
    fotografia: {
      observacionId: observacion.ultimaObservacionId,
      calidad: observacion.calidad,
      observadoEnUtc: observacion.observadoEnUtc,
      recibidoEnUtc: observacion.recibidoEnUtc
    }
  };
}

function describirCondicionTemporalRelativa(configuracion) {
  if (configuracion.forma === 'limite_inferior') {
    return `Requiere atención si la fecha está ${describirDesplazamiento(
      configuracion.limite
    )} o antes; margen ${formatearSegundos(configuracion.histeresisSegundos)}.`;
  }
  if (configuracion.forma === 'limite_superior') {
    return `Requiere atención si la fecha está ${describirDesplazamiento(
      configuracion.limite
    )} o después; margen ${formatearSegundos(configuracion.histeresisSegundos)}.`;
  }
  return `Requiere atención fuera del intervalo entre ${describirDesplazamiento(
    configuracion.limiteInferior
  )} y ${describirDesplazamiento(configuracion.limiteSuperior)}; márgenes ` +
    `${formatearSegundos(configuracion.histeresisInferiorSegundos)} y ` +
    `${formatearSegundos(configuracion.histeresisSuperiorSegundos)}.`;
}

function describirDesplazamiento(desplazamiento) {
  if (desplazamiento.direccion === 'ahora') return 'ahora';
  const magnitud = formatearSegundos(desplazamiento.segundos);
  return desplazamiento.direccion === 'pasado'
    ? `hace ${magnitud}`
    : `dentro de ${magnitud}`;
}

function formatearSegundos(valor) {
  const segundos = BigInt(valor);
  for (const [divisor, singular, plural] of [
    [86400n, 'día', 'días'],
    [3600n, 'hora', 'horas'],
    [60n, 'minuto', 'minutos']
  ]) {
    if (segundos > 0n && segundos % divisor === 0n) {
      const cantidad = segundos / divisor;
      return `${cantidad} ${cantidad === 1n ? singular : plural}`;
    }
  }
  return `${segundos} ${segundos === 1n ? 'segundo' : 'segundos'}`;
}

function serializarReglaAdministrativa(regla, senal) {
  if (
    !senal ||
    Number(senal.id) !== Number(regla.regla.senalId) ||
    Number(senal.agenteId) !== Number(regla.regla.agenteId)
  ) {
    throw new Error('La regla apunta a una señal catalogada inconsistente.');
  }
  return {
    ...regla.serializar(),
    senal: serializarSenalAdministrativa(senal)
  };
}

function serializarSenalAdministrativa(senal) {
  const serializada = serializarEntidad(senal);
  return {
    ...serializada,
    unidadSoloLectura: true,
    admiteCondicionValor: [
      'numero',
      'duracion',
      'momento_utc',
      'booleano',
      'texto',
      'estado'
    ].includes(serializada.tipoDato),
    admiteCondicionCalidad: true
  };
}

function serializarEntidad(entidad) {
  return typeof entidad?.serializar === 'function'
    ? entidad.serializar()
    : clonarJson(entidad);
}

function fotografiaRegla(regla, senal) {
  const serializada = regla.serializar();
  const reglaSerializada = serializarEntidad(regla.regla ?? serializada.regla ?? serializada);
  const revisionVigente = regla.revisionVigente ?? serializada.revisionVigente;
  const revision = revisionVigente
    ? fotografiaRevision(revisionVigente, reglaSerializada, senal)
    : null;
  return {
    agenteId: String(reglaSerializada.agenteId),
    senalId: String(reglaSerializada.senalId),
    estado: reglaSerializada.estado,
    generacionAutoridad: String(reglaSerializada.generacionAutoridad),
    nombre: revision?.nombre ?? null,
    descripcion: revision?.descripcion ?? null,
    condicion: revision?.condicion ?? null,
    revision
  };
}

function fotografiaRevision(revision, regla, senal) {
  const serializada = serializarEntidad(revision);
  return {
    id: String(serializada.id),
    reglaId: String(serializada.reglaId ?? regla.id),
    agenteId: String(regla.agenteId),
    senalId: String(regla.senalId),
    generacionAutoridad: String(regla.generacionAutoridad),
    numero: Number(serializada.numero),
    nombre: serializada.nombre,
    descripcion: serializada.descripcion,
    severidadCalculada: serializada.severidadCalculada,
    mensajeOperativo: serializada.mensajeOperativo,
    metadatos: filtrarMetadatosAuditablesRegla(serializada.metadatos),
    condicion: serializada.condicion,
    vigenteDesdeUtc: serializada.vigenteDesdeUtc,
    vigenteHastaUtc: serializada.vigenteHastaUtc ?? null
  };
}

function filtrarMetadatosAuditablesRegla(metadatos) {
  if (!metadatos || typeof metadatos !== 'object' || Array.isArray(metadatos)) {
    return null;
  }
  const filtrados = {};
  for (const [clave, valor] of Object.entries(metadatos)) {
    if (
      CLAVES_METADATOS_AUDITABLES_REGLA.has(clave) &&
      esValorEscalarAuditable(valor)
    ) {
      filtrados[clave] = valor;
    }
  }
  return Object.keys(filtrados).length > 0 ? filtrados : null;
}

function esValorEscalarAuditable(valor) {
  return valor === null ||
    typeof valor === 'string' ||
    typeof valor === 'boolean' ||
    (typeof valor === 'number' && Number.isFinite(valor));
}

function scopeDesdeAgenteORegla(entidad) {
  return {
    tenantId: String(entidad.tenantId),
    empresaId: String(entidad.empresaId),
    sitioId: String(entidad.sitioId)
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

function asegurarClavesExactas(datos, permitidas, mensaje) {
  const inesperadas = Object.keys(datos).filter((clave) => !permitidas.has(clave));
  if (inesperadas.length > 0) {
    throw new Error(`${mensaje} Campos: ${inesperadas.join(', ')}.`);
  }
}

function asegurarObjetoPlano(valor, mensaje) {
  if (
    !valor ||
    typeof valor !== 'object' ||
    Array.isArray(valor) ||
    Object.getPrototypeOf(valor) !== Object.prototype
  ) {
    throw new Error(mensaje);
  }
}

function congelarContrato(valor) {
  if (Array.isArray(valor)) {
    valor.forEach(congelarContrato);
    return Object.freeze(valor);
  }
  if (valor && typeof valor === 'object') {
    Object.values(valor).forEach(congelarContrato);
    return Object.freeze(valor);
  }
  return valor;
}

function clonarJson(valor) {
  return valor == null ? valor : JSON.parse(JSON.stringify(valor));
}

function normalizarLimite(valor, minimo, maximo) {
  const numero = Number(valor);
  if (!Number.isInteger(numero) || numero < minimo || numero > maximo) {
    throw new Error(`El límite debe estar entre ${minimo} y ${maximo}.`);
  }
  return numero;
}

function construirResumenOperativo(reglas) {
  return {
    totalReglas: reglas.length,
    activas: reglas.filter((regla) => regla.estado === 'activa').length,
    coincidentes: reglas.filter(
      (regla) => regla.estadoActual?.resultado === 'coincide'
    ).length,
    conErrorTecnico: reglas.filter((regla) => regla.ultimoErrorTecnico).length,
    totalEventosRecientes: reglas.reduce(
      (total, regla) => total + regla.eventosRecientes.length,
      0
    )
  };
}

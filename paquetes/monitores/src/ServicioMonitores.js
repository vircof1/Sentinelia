import {
  agruparMonitoresPorTipo,
  existeTipoMonitor,
  listarDefinicionesTiposMonitor,
  normalizarTipoMonitor
} from './CatalogoTiposMonitor.js';
import {
  crearConfiguracionMonitorLogicoBase
} from './ConfiguracionMonitorLogico.js';
import {
  extraerIdsMonitoresDependenciasMonitorLogico,
  FUENTE_MONITOR_FEDERADO
} from './DependenciasMonitorLogico.js';
import {
  normalizarInterpretacionEstadoMonitorPorTipo
} from './SemanticaEstadoMonitor.js';
import {
  OPERADORES_VALOR_ESPERADO_TELEMETRIA,
  TIPOS_CONDICION_MONITOR_TELEMETRIA,
  crearConfiguracionMonitorTelemetria,
  crearConfiguracionTemporalMonitorTelemetria
} from './ConfiguracionMonitorTelemetria.js';
import {
  TIPOS_FUENTE_MONITOR_TELEMETRIA,
  asegurarTipoDatoDirectamenteMonitorizable,
  esTipoDatoDirectamenteMonitorizable
} from './MonitorTelemetriaAgente.js';
import { generarUuidV7Auditoria } from '../../auditoria/src/UuidV7Auditoria.js';
import {
  PERFIL_JCS_AUDITORIA_V1
} from '../../auditoria/src/PerfilJcsAuditoria.js';
import {
  VERSION_ENCADENADO_AUDITORIA_V1
} from '../../auditoria/src/SobreCanonicoAuditoria.js';
import {
  crearSolicitudCapturaFederacion,
  OPERACIONES_CAPTURA_FEDERACION
} from '../../federacion/src/OperacionesCapturaTecnicaFederacion.js';

const CONFIGURACION_TIPO_FORMULARIO = {
  ping: {
    host: '',
    intervaloEjecucionSegundos: '60',
    desfaseInicialSegundos: '0',
    timeoutMs: '1200',
    reintentos: '1',
    tamanoPaqueteBytes: '56',
    ttl: '64',
    puerto: '',
    usarTls: false,
    vigenciaMinimaCertDias: ''
  },
  tcp: {
    host: '',
    intervaloEjecucionSegundos: '60',
    desfaseInicialSegundos: '0',
    timeoutMs: '1500',
    reintentos: '1',
    tamanoPaqueteBytes: '',
    ttl: '',
    puerto: '443',
    usarTls: false,
    vigenciaMinimaCertDias: '0'
  },
  booleano: {
    host: '',
    intervaloEjecucionSegundos: '60',
    desfaseInicialSegundos: '0',
    timeoutMs: '',
    reintentos: '',
    tamanoPaqueteBytes: '',
    ttl: '',
    puerto: '',
    usarTls: false,
    vigenciaMinimaCertDias: '',
    configuracionLogica: crearConfiguracionMonitorLogicoBase()
  },
  telemetria: {
    host: '',
    intervaloEjecucionSegundos: '60',
    desfaseInicialSegundos: '0',
    timeoutMs: '',
    reintentos: '',
    tamanoPaqueteBytes: '',
    ttl: '',
    puerto: '',
    usarTls: false,
    vigenciaMinimaCertDias: '',
    agenteId: '',
    tipoFuente: TIPOS_FUENTE_MONITOR_TELEMETRIA.SENAL_DIRECTA,
    senalId: '',
    reglaId: '',
    proyeccionId: '',
    tipoDato: '',
    unidad: '',
    minimo: '',
    maximo: '',
    operador: OPERADORES_VALOR_ESPERADO_TELEMETRIA.IGUAL,
    valorEsperado: '',
    retardoFalloSegundos: '0'
  }
};
const OPCIONES_PERTENENCIA = [
  {
    valor: 'empresa',
    etiqueta: 'Monitor de empresa',
    descripcion: 'Visible a nivel de empresa dentro del alcance permitido.'
  },
  {
    valor: 'sitio',
    etiqueta: 'Monitor de sitio',
    descripcion: 'Acotado a un sitio concreto dentro de la empresa.'
  }
];

export class ServicioMonitores {
  constructor({
    repositorioMonitores,
    repositorioTenants,
    repositorioEmpresas,
    repositorioSitios,
    repositorioEventosMonitor = null,
    repositorioAlertasActivasMonitor = null,
    repositorioHistoricoMonitores = null,
    repositorioVinculosMonitoresTelemetria = null,
    repositorioEntradasFederadasMonitoresLogicos = null,
    repositorioAgentes = null,
    repositorioCatalogoSenalesTelemetria = null,
    repositorioEstadoActualTelemetria = null,
    repositorioReglasDerivacionTelemetria = null,
    versionadorCatalogoMonitoresRedis = null,
    resolutorScopeUsuario,
    validadorMonitor,
    fronteraTransaccional = null,
    servicioAuditoria = null,
    capturadorFederacion = null,
    repositorioPreparacionBajaEjecucionesCorreo = null,
    servicioCierreAlertasMonitoresInactivos = null,
    ahora = () => new Date()
  }) {
    this.repositorioMonitores = repositorioMonitores;
    this.repositorioTenants = repositorioTenants;
    this.repositorioEmpresas = repositorioEmpresas;
    this.repositorioSitios = repositorioSitios;
    this.repositorioEventosMonitor = repositorioEventosMonitor;
    this.repositorioAlertasActivasMonitor = repositorioAlertasActivasMonitor;
    this.repositorioHistoricoMonitores = repositorioHistoricoMonitores;
    this.repositorioVinculosMonitoresTelemetria =
      repositorioVinculosMonitoresTelemetria;
    this.repositorioEntradasFederadasMonitoresLogicos =
      repositorioEntradasFederadasMonitoresLogicos;
    this.repositorioAgentes = repositorioAgentes;
    this.repositorioCatalogoSenalesTelemetria =
      repositorioCatalogoSenalesTelemetria;
    this.repositorioEstadoActualTelemetria = repositorioEstadoActualTelemetria;
    this.repositorioReglasDerivacionTelemetria =
      repositorioReglasDerivacionTelemetria;
    this.versionadorCatalogoMonitoresRedis = versionadorCatalogoMonitoresRedis;
    this.resolutorScopeUsuario = resolutorScopeUsuario;
    this.validadorMonitor = validadorMonitor;
    this.fronteraTransaccional = fronteraTransaccional;
    this.servicioAuditoria = servicioAuditoria;
    if (capturadorFederacion !== null &&
        typeof capturadorFederacion?.capturarEnTransaccion !== 'function') {
      throw new Error('El capturador federado de monitores no es transaccional.');
    }
    this.capturadorFederacion = capturadorFederacion;
    this.repositorioPreparacionBajaEjecucionesCorreo =
      repositorioPreparacionBajaEjecucionesCorreo;
    this.ahora = ahora;
    this.servicioCierreAlertasMonitoresInactivos = servicioCierreAlertasMonitoresInactivos;
  }

  async construirVistaListado(contextoUsuarioActual) {
    const monitores = await this.repositorioMonitores.listarVisibles(
      contextoUsuarioActual
    );
    const serializados = monitores.map((monitor) =>
      this.serializarMonitor(monitor)
    );
    const porTipo = agruparMonitoresPorTipo(serializados);

    return {
      alcanceActual: this.construirAlcanceActual(contextoUsuarioActual),
      resumen: {
        total: serializados.length,
        porTipo,
        totalPing: Number(porTipo.ping || 0),
        totalTcp: Number(porTipo.tcp || 0),
        totalEmpresa: serializados.filter(
          (item) => item.nivelPertenencia === 'empresa'
        ).length,
        totalSitio: serializados.filter(
          (item) => item.nivelPertenencia === 'sitio'
        ).length
      },
      monitores: serializados
    };
  }

  async construirVistaListadoAjaxShell(
    contextoUsuarioActual,
    {
      textoBusqueda = '',
      tipo = null,
      tenantId = null,
      empresaId = null,
      sitioId = null,
      nivelPertenencia = null,
      activo = 'todos',
      entradaMonitorId = null,
      agenteTelemetriaId = null,
      senalTelemetriaId = null,
      reglaTelemetriaId = null,
      pagina = 1,
      tamanoPagina = 10,
      ordenarPor = 'nombre',
      direccionOrden = 'asc'
    } = {}
  ) {
    const opcionesSelector = await this.construirOpcionesSelectorMonitores(
      contextoUsuarioActual
    );
    const contextoHero = await this.construirContextoHeroListado(
      contextoUsuarioActual,
      { tenantId, empresaId, sitioId },
      opcionesSelector
    );

    return {
      alcanceActual: this.construirAlcanceActual(contextoUsuarioActual),
      contextoHero,
      catalogoTiposMonitor: this.construirCatalogoTiposMonitorPortal(),
      filtros: {
        textoBusqueda,
        tipo: this.normalizarTipoFiltro(tipo) || '',
        tenantId: this.normalizarIdOpcional(tenantId) ?? '',
        empresaId: this.normalizarIdOpcional(empresaId) ?? '',
        sitioId: this.normalizarIdOpcional(sitioId) ?? '',
        nivelPertenencia:
          this.normalizarNivelPertenenciaFiltro(nivelPertenencia) || '',
        activo: this.normalizarFiltroActivo(activo),
        entradaMonitorId: this.normalizarIdOpcional(entradaMonitorId) ?? '',
        agenteTelemetriaId: this.normalizarIdOpcional(agenteTelemetriaId) ?? '',
        senalTelemetriaId: this.normalizarIdOpcional(senalTelemetriaId) ?? '',
        reglaTelemetriaId: this.normalizarIdOpcional(reglaTelemetriaId) ?? '',
        pagina: this.normalizarIdOpcional(pagina) ?? 1,
        tamanoPagina: this.normalizarTamanoPaginaListado(tamanoPagina),
        ordenarPor: this.normalizarOrdenListado(ordenarPor),
        direccionOrden: this.normalizarDireccionListado(direccionOrden)
      },
      ...opcionesSelector
    };
  }

  async listarMonitoresAdministracion(
    contextoUsuarioActual,
    {
      textoBusqueda = '',
      tipo = null,
      tenantId = null,
      empresaId = null,
      sitioId = null,
      nivelPertenencia = null,
      activo = 'todos',
      entradaMonitorId = null,
      agenteTelemetriaId = null,
      senalTelemetriaId = null,
      reglaTelemetriaId = null,
      pagina = 1,
      tamanoPagina = 10,
      ordenarPor = 'nombre',
      direccionOrden = 'asc'
    } = {}
  ) {
    const resultado = await this.repositorioMonitores.listarPaginadoVisible(
      contextoUsuarioActual,
      {
        textoBusqueda,
        tipo,
        tenantId,
        empresaId,
        sitioId,
        nivelPertenencia,
        activo,
        entradaMonitorId,
        agenteTelemetriaId,
        senalTelemetriaId,
        reglaTelemetriaId,
        pagina,
        tamanoPagina,
        ordenarPor,
        direccionOrden
      }
    );
    const monitoresSerializados = resultado.monitores.map((monitor) =>
      this.serializarMonitor(monitor)
    );

    return {
      resumen: resultado.resumen,
      resumenProtocolo: this.construirResumenProtocolo(
        this.normalizarTipoFiltro(tipo),
        resultado.resumen
      ),
      catalogoTiposMonitor: this.construirCatalogoTiposMonitorPortal(),
      filtros: {
        textoBusqueda,
        tipo: this.normalizarTipoFiltro(tipo) || '',
        tenantId: this.normalizarIdOpcional(tenantId) ?? '',
        empresaId: this.normalizarIdOpcional(empresaId) ?? '',
        sitioId: this.normalizarIdOpcional(sitioId) ?? '',
        nivelPertenencia:
          this.normalizarNivelPertenenciaFiltro(nivelPertenencia) || '',
        activo: this.normalizarFiltroActivo(activo),
        entradaMonitorId: this.normalizarIdOpcional(entradaMonitorId) ?? '',
        agenteTelemetriaId: this.normalizarIdOpcional(agenteTelemetriaId) ?? '',
        senalTelemetriaId: this.normalizarIdOpcional(senalTelemetriaId) ?? '',
        reglaTelemetriaId: this.normalizarIdOpcional(reglaTelemetriaId) ?? '',
        pagina: resultado.paginacion.pagina,
        tamanoPagina: resultado.paginacion.tamanoPagina,
        ordenarPor,
        direccionOrden
      },
      alcanceActual: this.construirAlcanceActual(contextoUsuarioActual),
      monitores: monitoresSerializados,
      paginacion: {
        ...resultado.paginacion,
        desde:
          resultado.paginacion.totalFiltrado === 0
            ? 0
            : ((resultado.paginacion.pagina - 1) *
                resultado.paginacion.tamanoPagina) + 1,
        hasta: Math.min(
          resultado.paginacion.totalFiltrado,
          resultado.paginacion.pagina * resultado.paginacion.tamanoPagina
        )
      }
    };
  }

  async contarMonitoresVisiblesPorRegla(
    contextoUsuarioActual,
    { agenteId, senalId, reglaId } = {}
  ) {
    const agenteTelemetriaId = this.normalizarIdOpcional(agenteId);
    const senalTelemetriaId = this.normalizarIdOpcional(senalId);
    const reglaTelemetriaId = this.normalizarIdOpcional(reglaId);
    if (agenteTelemetriaId == null ||
        senalTelemetriaId == null ||
        reglaTelemetriaId == null) {
      throw new Error('El contexto de la interpretación de telemetría no es válido.');
    }

    return this.repositorioMonitores.contarFiltradoVisible(
      contextoUsuarioActual,
      {
        tipo: 'telemetria',
        agenteTelemetriaId,
        senalTelemetriaId,
        reglaTelemetriaId
      }
    );
  }

  construirResumenProtocolo(tipo, resumen) {
    if (tipo === 'ping') {
      return {
        tipo: 'ping',
        titulo: 'Resumen ICMP',
        descripcion:
          'Métricas agregadas del catálogo filtrado para payload y TTL sin abrir consultas adicionales.',
        metricas: [
          {
            etiqueta: 'Payload medio',
            valor: this.formatearNumeroDecimal(resumen?.ping?.payloadMedio, '0.0'),
            sufijo: 'bytes',
            detalle: this.formatearDetalleRango(
              resumen?.ping?.payloadMinimo,
              resumen?.ping?.payloadMaximo,
              'bytes'
            )
          },
          {
            etiqueta: 'TTL medio',
            valor: this.formatearNumeroDecimal(resumen?.ping?.ttlMedio, '0.0'),
            sufijo: '',
            detalle: this.formatearDetalleRango(
              resumen?.ping?.ttlMinimo,
              resumen?.ping?.ttlMaximo
            )
          }
        ]
      };
    }

    if (tipo === 'tcp') {
      const totalTlsConVigenciaMinima = Number(
        resumen?.tcp?.totalTlsConVigenciaMinima ?? 0
      );
      const detalleVigenciaMinima = totalTlsConVigenciaMinima > 0
        ? this.formatearDetalleRango(
            resumen?.tcp?.vigenciaMinimaMinima,
            resumen?.tcp?.vigenciaMinimaMaxima,
            'días'
          )
        : 'Sin umbrales de vigencia configurados';

      return {
        tipo: 'tcp',
        titulo: 'Resumen TCP',
        descripcion:
          'Métricas agregadas del catálogo filtrado para puertos y validación TLS sin repetir lecturas.',
        metricas: [
          {
            etiqueta: 'Puertos distintos',
            valor: String(resumen?.tcp?.puertosDistintos ?? 0),
            sufijo: '',
            detalle: this.formatearDetalleRango(
              resumen?.tcp?.puertoMinimo,
              resumen?.tcp?.puertoMaximo
            )
          },
          {
            etiqueta: 'TLS exigido',
            valor: String(resumen?.tcp?.totalTlsSi ?? 0),
            sufijo: '',
            detalle: `${String(resumen?.tcp?.totalTlsNo ?? 0)} sin TLS`
          },
          {
            etiqueta: 'Margen cert. TLS',
            valor: String(totalTlsConVigenciaMinima),
            sufijo: '',
            detalle: detalleVigenciaMinima
          }
        ]
      };
    }

    return null;
  }

  async exportarDefinicionesRuntime() {
    const monitores = await this.repositorioMonitores.listarActivosParaRuntime();

    return {
      total: monitores.length,
      generadoEn: new Date().toISOString(),
      monitores: monitores.map((monitor) => monitor.serializarDefinicionRuntime())
    };
  }

  async construirVistaFormulario(
    contextoUsuarioActual,
    { idMonitor = null, formularioBase = null } = {}
  ) {
    const contextoScope = await this.completarContextoScopeOrganizativo(
      contextoUsuarioActual
    );
    const monitorObjetivo = idMonitor == null
      ? null
      : await this.buscarMonitorVisible(contextoScope, idMonitor);
    const vinculoTelemetria = monitorObjetivo?.tipo === 'telemetria'
      ? await this.repositorioVinculosMonitoresTelemetria?.buscarPorMonitorId?.(
          monitorObjetivo.id
        ) || null
      : null;

    const formulario = formularioBase
      ? this.construirFormularioDesdeEntrada(contextoScope, formularioBase)
      : monitorObjetivo
        ? this.construirFormularioDesdeMonitor(
            monitorObjetivo,
            vinculoTelemetria
          )
        : this.construirFormularioAltaPorDefecto(contextoScope);

    const opcionesTenants = await this.repositorioTenants.listarVisibles(
      contextoScope
    );
    const opcionesEmpresas = await this.repositorioEmpresas.listarVisibles(
      contextoScope
    );
    const opcionesSitios = await this.repositorioSitios.listarVisibles(
      contextoScope
    );

    const opcionesTenantsFormulario = opcionesTenants.map((tenant) => ({
      valor: tenant.id,
      etiqueta: `${tenant.nombre} (#${tenant.id})`
    }));
    const opcionesEmpresasFormulario = opcionesEmpresas.map((empresa) => ({
      valor: empresa.id,
      tenantId: empresa.tenantId,
      etiqueta: `${empresa.nombre} (#${empresa.id})`
    }));
    const opcionesSitiosFormulario = opcionesSitios.map((sitio) => ({
      valor: sitio.id,
      tenantId: sitio.tenantId,
      empresaId: sitio.empresaId,
      etiqueta: `${sitio.nombre} (#${sitio.id})`
    }));
    const restriccionesScope = this.construirRestriccionesScope(
      contextoScope,
      formulario
    );

    await this.asegurarOpcionesAlcanceFormulario({
      contextoUsuarioActual: contextoScope,
      formulario,
      restriccionesScope,
      opcionesTenants: opcionesTenantsFormulario,
      opcionesEmpresas: opcionesEmpresasFormulario,
      opcionesSitios: opcionesSitiosFormulario
    });
    const opcionesAgentesTelemetria =
      await this.construirOpcionesAgentesTelemetria(contextoScope);
    const monitoresLogicosDependientes = monitorObjetivo
      ? await this.listarMonitoresLogicosDependientes(
          contextoScope,
          monitorObjetivo.id
        )
      : [];
    let fuentesTelemetriaIniciales = { agente: null, senales: [], reglas: [] };
    if (formulario.tipo === 'telemetria' && formulario.agenteId) {
      try {
        fuentesTelemetriaIniciales =
          await this.listarFuentesTelemetriaFormulario(
            contextoScope,
            formulario.agenteId
          );
      } catch (_errorFuenteFormulario) {
        // La validación principal conserva el error humano; el re-render no
        // debe convertir una selección inválida en un fallo 500 secundario.
      }
    }

    return {
      modo: monitorObjetivo ? 'editar' : 'nuevo',
      monitorObjetivo: monitorObjetivo
        ? this.serializarMonitor(monitorObjetivo)
        : null,
      alcanceActual: this.construirAlcanceActual(contextoScope),
      restriccionesScope,
      formulario,
      opcionesTipo: this.construirOpcionesTipoMonitorFormulario(),
      opcionesPertenencia: this.construirOpcionesPertenencia(
        contextoScope
      ),
      opcionesTenants: opcionesTenantsFormulario,
      opcionesEmpresas: opcionesEmpresasFormulario,
      opcionesSitios: opcionesSitiosFormulario,
      opcionesAgentesTelemetria,
      fuentesTelemetriaIniciales,
      relacionesCruzadas: {
        monitoresLogicosDependientes
      }
    };
  }

  async listarMonitoresLogicosDependientes(
    contextoUsuarioActual,
    idMonitorEntrada
  ) {
    const idEntrada = Number(idMonitorEntrada);
    if (!Number.isInteger(idEntrada) || idEntrada <= 0) return [];

    const monitores = await this.repositorioMonitores.listarVisibles(
      contextoUsuarioActual
    );
    return monitores
      .filter((monitor) => monitor.tipo === 'booleano')
      .filter((monitor) =>
        (monitor.configuracion?.dependencias || []).some(
          (dependencia) =>
            dependencia?.fuente === 'monitor' &&
            Number(dependencia.monitorId) === idEntrada
        )
      )
      .map((monitor) => this.serializarMonitor(monitor));
  }

  async completarContextoScopeOrganizativo(contextoUsuarioActual) {
    const contexto = { ...(contextoUsuarioActual || {}) };
    const sitioId = this.normalizarIdScope(contexto.sitioId);
    const empresaId = this.normalizarIdScope(contexto.empresaId);
    const tenantId = this.normalizarIdScope(contexto.tenantId);

    if (
      contexto.nivelScope === 'sitio' &&
      sitioId != null &&
      (empresaId == null || tenantId == null) &&
      typeof this.repositorioSitios?.buscarPorId === 'function'
    ) {
      const sitio = await this.repositorioSitios.buscarPorId(sitioId);

      if (sitio) {
        contexto.sitioId = sitio.id;
        if (empresaId == null) {
          contexto.empresaId = sitio.empresaId;
        }
        if (tenantId == null) {
          contexto.tenantId = sitio.tenantId;
        }
      }
    }

    if (
      ['empresa', 'sitio'].includes(contexto.nivelScope) &&
      this.normalizarIdScope(contexto.empresaId) != null &&
      this.normalizarIdScope(contexto.tenantId) == null &&
      typeof this.repositorioEmpresas?.buscarPorId === 'function'
    ) {
      const empresa = await this.repositorioEmpresas.buscarPorId(
        this.normalizarIdScope(contexto.empresaId)
      );

      if (empresa) {
        contexto.empresaId = empresa.id;
        contexto.tenantId = empresa.tenantId;
      }
    }

    return contexto;
  }

  async construirOpcionesAgentesTelemetria(contextoUsuarioActual) {
    if (typeof this.repositorioAgentes?.listarVisibles !== 'function') {
      return [];
    }
    const agentes = await this.repositorioAgentes.listarVisibles(
      contextoUsuarioActual
    );
    return agentes.map((agente) => ({
      valor: agente.id,
      etiqueta: `${agente.nombre} (#${agente.id}) · ${agente.sitioNombre || `Sitio #${agente.sitioId}`}`,
      tenantId: agente.tenantId,
      empresaId: agente.empresaId,
      sitioId: agente.sitioId,
      estadoAdministrativo: agente.estadoAdministrativo,
      estadoVidaPol: agente.estadoVidaPol
    }));
  }

  async listarFuentesTelemetriaFormulario(contextoUsuarioActual, agenteId) {
    this.asegurarDependenciasAdministracionTelemetria();
    const agente = await this.buscarAgenteTelemetriaVisible(
      contextoUsuarioActual,
      agenteId
    );
    const [senales, fotografias, reglas] = await Promise.all([
      this.repositorioCatalogoSenalesTelemetria.listarPorAgente(agente.id),
      this.repositorioEstadoActualTelemetria.listarPorAgente(agente.id),
      this.repositorioReglasDerivacionTelemetria.listarPorAgente(agente.id)
    ]);
    const fotografiasPorSenal = new Map(
      fotografias.map((fotografia) => [
        Number(fotografia.senalId),
        this.serializarEntidad(fotografia)
      ])
    );
    const senalesConContexto = senales
      .map((senal) => this.serializarEntidad(senal))
      .map((senal) => this.construirFuenteSenalFormulario(
        senal,
        fotografiasPorSenal.get(Number(senal.id)) || null
      ));
    const senalesSerializadas = senalesConContexto
      .filter((senal) => esTipoDatoDirectamenteMonitorizable(senal.tipoDato));
    const senalesPorId = new Map(
      senalesConContexto.map((senal) => [Number(senal.id), senal])
    );

    return {
      agente: {
        id: agente.id,
        nombre: agente.nombre,
        tenantId: agente.tenantId,
        empresaId: agente.empresaId,
        sitioId: agente.sitioId,
        sitioNombre: agente.sitioNombre || null,
        estadoAdministrativo: agente.estadoAdministrativo,
        estadoVidaPol: agente.estadoVidaPol
      },
      senales: senalesSerializadas,
      reglas: reglas.map((reglaPersistida) => {
        const regla = this.serializarEntidad(reglaPersistida);
        const senal = senalesPorId.get(Number(regla.senalId)) || null;
        return {
          id: regla.id,
          agenteId: regla.agenteId,
          senalId: regla.senalId,
          estado: regla.estado,
          nombre: regla.revisionVigente?.nombre || `Regla #${regla.id}`,
          mensajeOperativo:
            regla.revisionVigente?.mensajeOperativo || 'Sin mensaje operativo',
          condicion: regla.revisionVigente?.condicion || null,
          senal
        };
      }).filter((regla) => regla.senal)
    };
  }

  async buscarAgenteTelemetriaVisible(contextoUsuarioActual, agenteId) {
    const id = this.normalizarIdOpcional(agenteId);
    const agente = id == null
      ? null
      : await this.repositorioAgentes.buscarPorId(id);
    if (!agente || !this.puedeAlcanzarMonitor(contextoUsuarioActual, agente)) {
      throw new Error('No existe el agente solicitado dentro de tu alcance.');
    }
    return agente;
  }

  construirFuenteSenalFormulario(senal, fotografia) {
    return {
      ...senal,
      ultimaObservacion: fotografia
        ? {
            id: fotografia.ultimaObservacionId,
            valor: this.extraerValorTelemetriaFormulario(fotografia),
            observadoEnUtc: fotografia.observadoEnUtc || null,
            recibidoEnUtc: fotografia.recibidoEnUtc || null,
            calidad: fotografia.calidad || null
          }
        : null
    };
  }

  extraerValorTelemetriaFormulario(fotografia) {
    if (fotografia.tipoDato === 'numero') {
      return fotografia.valorNumero;
    }
    if (fotografia.tipoDato === 'booleano') {
      return fotografia.valorBooleano;
    }
    if (fotografia.tipoDato === 'estado') {
      return fotografia.valorEstado;
    }
    return fotografia.valorTexto;
  }

  serializarEntidad(entidad) {
    return typeof entidad?.serializar === 'function'
      ? entidad.serializar()
      : { ...(entidad || {}) };
  }

  normalizarIdScope(valor) {
    const texto = String(valor ?? '').trim();

    if (!texto) {
      return null;
    }

    const numero = Number(texto);
    return Number.isFinite(numero) ? numero : null;
  }

  async asegurarOpcionesAlcanceFormulario({
    contextoUsuarioActual,
    formulario,
    restriccionesScope,
    opcionesTenants,
    opcionesEmpresas,
    opcionesSitios
  }) {
    await Promise.all([
      this.asegurarOpcionTenantFormulario({
        contextoUsuarioActual,
        formulario,
        restriccionesScope,
        opcionesTenants
      }),
      this.asegurarOpcionEmpresaFormulario({
        contextoUsuarioActual,
        formulario,
        restriccionesScope,
        opcionesEmpresas
      }),
      this.asegurarOpcionSitioFormulario({
        contextoUsuarioActual,
        formulario,
        restriccionesScope,
        opcionesSitios
      })
    ]);
  }

  async asegurarOpcionTenantFormulario({
    contextoUsuarioActual,
    formulario,
    restriccionesScope,
    opcionesTenants
  }) {
    const tenantId = String(formulario?.tenantId || '').trim();
    const tenantSesionId = String(contextoUsuarioActual?.tenantId || '').trim();

    if (
      !tenantId ||
      !restriccionesScope?.tenantBloqueado ||
      tenantId !== tenantSesionId ||
      this.opcionesIncluyenValor(opcionesTenants, tenantId)
    ) {
      return;
    }

    const tenant = typeof this.repositorioTenants.buscarPorId === 'function'
      ? await this.repositorioTenants.buscarPorId(tenantId)
      : null;
    opcionesTenants.push({
      valor: tenant?.id ?? tenantId,
      etiqueta: tenant ? `${tenant.nombre} (#${tenant.id})` : `Tenant #${tenantId}`
    });
  }

  async asegurarOpcionEmpresaFormulario({
    contextoUsuarioActual,
    formulario,
    restriccionesScope,
    opcionesEmpresas
  }) {
    const empresaId = String(formulario?.empresaId || '').trim();
    const empresaSesionId = String(contextoUsuarioActual?.empresaId || '').trim();

    if (
      !empresaId ||
      !restriccionesScope?.empresaBloqueada ||
      empresaId !== empresaSesionId ||
      this.opcionesIncluyenValor(opcionesEmpresas, empresaId)
    ) {
      return;
    }

    const empresa = typeof this.repositorioEmpresas.buscarPorId === 'function'
      ? await this.repositorioEmpresas.buscarPorId(empresaId)
      : null;
    opcionesEmpresas.push({
      valor: empresa?.id ?? empresaId,
      tenantId: empresa?.tenantId ?? formulario?.tenantId ?? '',
      etiqueta: empresa ? `${empresa.nombre} (#${empresa.id})` : `Empresa #${empresaId}`
    });
  }

  async asegurarOpcionSitioFormulario({
    contextoUsuarioActual,
    formulario,
    restriccionesScope,
    opcionesSitios
  }) {
    const sitioId = String(formulario?.sitioId || '').trim();
    const sitioSesionId = String(contextoUsuarioActual?.sitioId || '').trim();

    if (
      !sitioId ||
      !restriccionesScope?.sitioBloqueadoPorScope ||
      sitioId !== sitioSesionId ||
      this.opcionesIncluyenValor(opcionesSitios, sitioId)
    ) {
      return;
    }

    const sitio = typeof this.repositorioSitios.buscarPorId === 'function'
      ? await this.repositorioSitios.buscarPorId(sitioId)
      : null;
    opcionesSitios.push({
      valor: sitio?.id ?? sitioId,
      tenantId: sitio?.tenantId ?? formulario?.tenantId ?? '',
      empresaId: sitio?.empresaId ?? formulario?.empresaId ?? '',
      etiqueta: sitio ? `${sitio.nombre} (#${sitio.id})` : `Sitio #${sitioId}`
    });
  }

  opcionesIncluyenValor(opciones, valor) {
    return opciones.some((opcion) => String(opcion.valor) === String(valor));
  }

  async construirVistaMonitorOperativo(
    contextoUsuarioActual,
    idMonitor
  ) {
    const monitor = await this.buscarMonitorVisible(contextoUsuarioActual, idMonitor);
    const alertaActiva = this.repositorioAlertasActivasMonitor
      ? await this.repositorioAlertasActivasMonitor.buscarPorMonitorId(monitor.id)
      : null;
    const monitorSerializado = this.serializarMonitor(monitor);

    return {
      alcanceActual: this.construirAlcanceActual(contextoUsuarioActual),
      monitor: monitorSerializado,
      alertaActiva: alertaActiva
        ? this.serializarAlertaActivaOperativa(alertaActiva)
        : null
    };
  }

  async listarEventosHistoricos(
    contextoUsuarioActual,
    {
      desde = null,
      hasta = null,
      monitorId = null,
      tipo = null,
      estadoDetectado = null,
      codigoResultado = null,
      limite = 1000,
      orden = 'asc',
      resumenGrafico = false,
      intervalosGrafico = 48
    } = {}
  ) {
    if (!this.repositorioEventosMonitor) {
      throw new Error('El repositorio de eventos no está disponible.');
    }

    const rango = this.normalizarRangoEventos({
      desde,
      hasta
    });
    const monitorIdNormalizado = this.normalizarIdOpcional(monitorId);
    const tipoNormalizado = this.normalizarTipoFiltro(tipo);
    const estadoNormalizado = this.normalizarEstadoEvento(estadoDetectado);
    const codigoNormalizado = this.normalizarTextoFiltro(
      codigoResultado,
      80
    );
    const limiteNormalizado = this.normalizarLimiteActividad(
      limite,
      1000,
      5000
    );
    const ordenNormalizado = this.normalizarOrdenTemporal(orden);

    if (monitorIdNormalizado != null) {
      await this.buscarMonitorVisible(contextoUsuarioActual, monitorIdNormalizado);
    }

    const [total, eventos] = await Promise.all([
      this.repositorioEventosMonitor.contarVisiblesFiltrados(
        contextoUsuarioActual,
        {
          monitorId: monitorIdNormalizado,
          tipo: tipoNormalizado,
          estadoDetectado: estadoNormalizado,
          codigoResultado: codigoNormalizado,
          desdeUtc: rango.desdeUtc,
          hastaUtc: rango.hastaUtc
        }
      ),
      this.repositorioEventosMonitor.listarVisiblesFiltrados(
        contextoUsuarioActual,
        {
          monitorId: monitorIdNormalizado,
          tipo: tipoNormalizado,
          estadoDetectado: estadoNormalizado,
          codigoResultado: codigoNormalizado,
          desdeUtc: rango.desdeUtc,
          hastaUtc: rango.hastaUtc,
          limite: limiteNormalizado,
          orden: ordenNormalizado
        }
      )
    ]);
    const serializados = eventos.map((evento) =>
      this.serializarEventoOperativo(evento)
    );
    const usarVelas = Boolean(resumenGrafico && monitorIdNormalizado != null && (
      total > 150 || total > serializados.length
    ));
    const serieAgregada = usarVelas
      ? await this.repositorioEventosMonitor.resumirIntervalosVisibles(
        contextoUsuarioActual,
        {
          monitorId: monitorIdNormalizado,
          tipo: tipoNormalizado,
          estadoDetectado: estadoNormalizado,
          codigoResultado: codigoNormalizado,
          desdeUtc: rango.desdeUtc,
          hastaUtc: rango.hastaUtc,
          intervalos: intervalosGrafico
        }
      )
      : null;
    const totalFallidosRango = serieAgregada
      ? serieAgregada.puntos.reduce((suma, punto) => suma + punto.fallos, 0)
      : total === serializados.length
        ? serializados.filter((evento) => !evento.exito).length
        : null;

    return {
      alcanceActual: this.construirAlcanceActual(contextoUsuarioActual),
      rangoAplicado: rango,
      filtros: {
        monitorId: monitorIdNormalizado,
        tipo: tipoNormalizado || '',
        estadoDetectado: estadoNormalizado || '',
        codigoResultado: codigoNormalizado || '',
        limite: limiteNormalizado,
        orden: ordenNormalizado
      },
      resumen: {
        total,
        devueltos: serializados.length,
        truncado: total > serializados.length,
        totalExitosos: serializados.filter((evento) => evento.exito).length,
        totalFallidos: serializados.filter((evento) => !evento.exito).length,
        totalExitososRango: totalFallidosRango == null ? null : total - totalFallidosRango,
        totalFallidosRango,
        origenDatos: 'eventos_monitores',
        etiquetaOrigenDatos: 'Eventos operativos',
        descripcionOrigenDatos:
          'La tabla se persiste con la compactación configurada por el portal; con valor 0 se guarda cada ejecución.'
      },
      eventos: serializados,
      serieAgregada
    };
  }

  async obtenerHitosEventosMonitor(contextoUsuarioActual, { monitorId = null } = {}) {
    if (!this.repositorioEventosMonitor) {
      throw new Error('El repositorio de eventos no está disponible.');
    }

    const monitorIdNormalizado = this.normalizarIdOpcional(monitorId);

    if (monitorIdNormalizado == null) {
      throw new Error('Debes indicar un monitor válido.');
    }

    await this.buscarMonitorVisible(contextoUsuarioActual, monitorIdNormalizado);

    const hitos = await this.repositorioEventosMonitor.resolverHitosVisiblesPorMonitorId(
      contextoUsuarioActual,
      monitorIdNormalizado
    );
    const ultimoFallo = hitos.ultimoFallo
      ? this.serializarEventoOperativo(hitos.ultimoFallo)
      : null;
    const ultimaRecuperacion = hitos.ultimaRecuperacion
      ? this.serializarEventoOperativo(hitos.ultimaRecuperacion)
      : null;
    const inicioIncidencia = Date.parse(ultimoFallo?.ejecutadoEnUtc || '');
    const finIncidencia = Date.parse(ultimaRecuperacion?.ejecutadoEnUtc || '');

    return {
      monitorId: monitorIdNormalizado,
      ultimoFallo,
      ultimaRecuperacion,
      incidencia: ultimoFallo
        ? {
            activa: !ultimaRecuperacion,
            inicioUtc: ultimoFallo.ejecutadoEnUtc,
            finUtc: ultimaRecuperacion?.ejecutadoEnUtc || null,
            duracionMs: Number.isFinite(inicioIncidencia) && Number.isFinite(finIncidencia)
              ? Math.max(0, finIncidencia - inicioIncidencia)
              : null
          }
        : null
    };
  }

  async construirVistaVisorEventos(contextoUsuarioActual) {
    const rango = this.normalizarRangoEventos({});

    return {
      alcanceActual: this.construirAlcanceActual(contextoUsuarioActual),
      filtros: {
        desde: this.formatearFechaInput(rango.desdeUtc),
        hasta: this.formatearFechaInput(rango.hastaUtc),
        monitorId: '',
        tipo: '',
        estado: '',
        codigoResultado: '',
        limite: 500,
        orden: 'asc'
      },
      opcionesTipo: this.construirOpcionesTipoMonitorFiltro(),
      opcionesEstado: [
        { valor: '', etiqueta: 'Todos' },
        { valor: 'disponible', etiqueta: 'Disponible' },
        { valor: 'indisponible', etiqueta: 'Indisponible' },
        { valor: 'degradado', etiqueta: 'Degradado' },
        { valor: 'desconocido', etiqueta: 'Desconocido' }
      ],
      opcionesLimite: [100, 250, 500, 1000],
      preselecciones: [
        { valor: '1d', etiqueta: 'Hoy' },
        { valor: '7d', etiqueta: '7 días' },
        { valor: '30d', etiqueta: '30 días' }
      ]
    };
  }

  async construirVistaComparadorEventos(contextoUsuarioActual) {
    const rango = this.normalizarRangoEventos({});
    const opcionesSelector = await this.construirOpcionesSelectorMonitores(
      contextoUsuarioActual
    );

    return {
      alcanceActual: this.construirAlcanceActual(contextoUsuarioActual),
      filtros: {
        desde: this.formatearFechaHoraInput(rango.desdeUtc),
        hasta: this.formatearFechaHoraInput(rango.hastaUtc),
        monitorIds: [],
        limite: 500,
        orden: 'asc'
      },
      opcionesLimite: [100, 250, 500, 1000],
      preselecciones: [
        { valor: '1d', etiqueta: '24 h' },
        { valor: '7d', etiqueta: '7 días' },
        { valor: '30d', etiqueta: '30 días' }
      ],
      ...opcionesSelector
    };
  }

  async construirVistaHistoricoAdministrativoShell(
    contextoUsuarioActual,
    {
      desde = null,
      hasta = null,
      monitorId = null,
      tipo = null,
      estadoTramo = null,
      codigoResultado = null,
      pagina = 1,
      tamanoPagina = 25,
      ordenarPor = 'valido_hasta',
      direccionOrden = 'desc'
    } = {}
  ) {
    const rango = this.normalizarRangoEventos({ desde, hasta });
    const opcionesSelector = await this.construirOpcionesSelectorMonitores(
      contextoUsuarioActual
    );

    return {
      alcanceActual: this.construirAlcanceActual(contextoUsuarioActual),
      filtros: {
        desde: this.formatearFechaInput(rango.desdeUtc),
        hasta: this.formatearFechaInput(rango.hastaUtc),
        monitorId: this.normalizarIdOpcional(monitorId) ?? '',
        tipo: this.normalizarTipoFiltro(tipo) || '',
        estadoTramo: this.normalizarEstadoEvento(estadoTramo) || '',
        codigoResultado: this.normalizarTextoFiltro(codigoResultado, 80) || '',
        pagina: this.normalizarIdOpcional(pagina) ?? 1,
        tamanoPagina: this.normalizarTamanoPaginaListado(tamanoPagina),
        ordenarPor: this.normalizarOrdenHistorico(ordenarPor),
        direccionOrden: this.normalizarDireccionListado(direccionOrden)
      },
      opcionesTipo: this.construirOpcionesTipoMonitorFiltro(),
      opcionesEstado: [
        { valor: '', etiqueta: 'Todos' },
        { valor: 'disponible', etiqueta: 'Disponible' },
        { valor: 'indisponible', etiqueta: 'Indisponible' },
        { valor: 'degradado', etiqueta: 'Degradado' },
        { valor: 'desconocido', etiqueta: 'Desconocido' }
      ],
      opcionesTamanoPagina: [10, 25, 50, 100],
      opcionesOrden: [
        { valor: 'valido_hasta', etiqueta: 'Válido hasta' },
        { valor: 'valido_desde', etiqueta: 'Válido desde' },
        { valor: 'monitor', etiqueta: 'Monitor' },
        { valor: 'tipo', etiqueta: 'Tipo' },
        { valor: 'estado', etiqueta: 'Estado' },
        { valor: 'codigo', etiqueta: 'Código resultado' },
        { valor: 'repeticiones', etiqueta: 'Repeticiones' },
        { valor: 'actualizado', etiqueta: 'Actualizado' }
      ],
      ...opcionesSelector
    };
  }

  async listarEventosComparados(
    contextoUsuarioActual,
    {
      desde = null,
      hasta = null,
      monitorIds = [],
      limite = 1000,
      intervalos = 48,
      detalle = false,
      orden = 'asc'
    } = {}
  ) {
    if (!this.repositorioEventosMonitor) {
      throw new Error('El repositorio de eventos no está disponible.');
    }

    const rango = this.normalizarRangoEventos({ desde, hasta });
    const monitorIdsNormalizados = this.normalizarIdsComparacion(monitorIds);
    if (detalle && monitorIdsNormalizados.length !== 1) {
      throw new Error('El detalle del intervalo exige un solo monitor.');
    }
    const limiteNormalizado = this.normalizarLimiteActividad(
      limite,
      1000,
      5000
    );
    const ordenNormalizado = this.normalizarOrdenTemporal(orden);
    const monitoresSeleccionados = [];

    for (const monitorId of monitorIdsNormalizados) {
      monitoresSeleccionados.push(
        await this.buscarMonitorVisible(contextoUsuarioActual, monitorId)
      );
    }

    if (monitorIdsNormalizados.length === 0) {
      return {
        alcanceActual: this.construirAlcanceActual(contextoUsuarioActual),
        rangoAplicado: rango,
        filtros: {
          monitorIds: [],
          limite: limiteNormalizado,
          orden: ordenNormalizado
        },
        resumen: {
          total: 0,
          devueltos: 0,
          truncado: false,
          totalMonitoresSeleccionados: 0,
          origenDatos: 'eventos_monitores',
          etiquetaOrigenDatos: 'Eventos operativos',
          descripcionOrigenDatos:
            'Selecciona entre uno y tres monitores para superponerlos sobre la misma serie temporal.'
        },
        monitoresSeleccionados: [],
        eventos: []
      };
    }

    const total = await this.repositorioEventosMonitor.contarVisiblesFiltrados(
      contextoUsuarioActual,
      {
        monitorIds: monitorIdsNormalizados,
        desdeUtc: rango.desdeUtc,
        hastaUtc: rango.hastaUtc
      }
    );
    const modoAgregado = !detalle && total > 150;
    const agregado = modoAgregado
      ? await this.repositorioEventosMonitor.resumirIntervalosComparados(
        contextoUsuarioActual,
        {
          monitorIds: monitorIdsNormalizados,
          desdeUtc: rango.desdeUtc,
          hastaUtc: rango.hastaUtc,
          intervalos
        }
      )
      : null;
    const eventos = modoAgregado ? [] : await this.repositorioEventosMonitor.listarVisiblesFiltrados(
      contextoUsuarioActual,
      {
        monitorIds: monitorIdsNormalizados,
        desdeUtc: rango.desdeUtc,
        hastaUtc: rango.hastaUtc,
        limite: detalle ? 5000 : 150,
        orden: 'asc'
      }
    );
    const serializados = eventos.map((evento) => this.serializarEventoOperativo(evento));
    const puntosAgregados = agregado?.puntos || [];
    const totalRespuesta = modoAgregado
      ? puntosAgregados.reduce((suma, punto) => suma + punto.cantidad, 0)
      : total;
    const monitoresSerializados = monitoresSeleccionados.map((monitor) => {
      const resumenEventos = serializados.filter(
        (evento) => Number(evento.monitorId) === Number(monitor.id)
      );
      const resumenIntervalos = puntosAgregados.filter(
        (punto) => Number(punto.monitorId) === Number(monitor.id)
      );

      return {
        id: monitor.id,
        nombre: monitor.nombre,
        tipo: monitor.tipo,
        activo: monitor.activo,
        interpretacionEstado: monitor.interpretacionEstado,
        descripcionFallo: monitor.descripcionFallo,
        posibleSolucion: monitor.posibleSolucion,
        alcanceDescripcion: monitor.sitioId == null
          ? `${monitor.empresaNombre || 'Empresa'} #${monitor.empresaId}`
          : `${monitor.sitioNombre || 'Sitio'} #${monitor.sitioId} · ${monitor.empresaNombre || 'Empresa'} #${monitor.empresaId}`,
        totalEventosVisibles: modoAgregado
          ? resumenIntervalos.reduce((suma, punto) => suma + punto.cantidad, 0)
          : resumenEventos.length,
        totalExitososVisibles: modoAgregado
          ? resumenIntervalos.reduce((suma, punto) => suma + punto.cantidad - punto.fallos, 0)
          : resumenEventos.filter((evento) => evento.exito).length,
        totalFallidosVisibles: modoAgregado
          ? resumenIntervalos.reduce((suma, punto) => suma + punto.fallos, 0)
          : resumenEventos.filter((evento) => !evento.exito).length
      };
    });

    return {
      alcanceActual: this.construirAlcanceActual(contextoUsuarioActual),
      rangoAplicado: rango,
      filtros: {
        monitorIds: monitorIdsNormalizados,
        limite: limiteNormalizado,
        orden: ordenNormalizado
      },
      resumen: {
        total: totalRespuesta,
        devueltos: modoAgregado ? puntosAgregados.length : serializados.length,
        truncado: totalRespuesta > (modoAgregado ? totalRespuesta : serializados.length),
        modo: modoAgregado ? 'intervalos' : detalle ? 'detalle' : 'individual',
        totalMonitoresSeleccionados: monitoresSerializados.length,
        origenDatos: 'eventos_monitores',
        etiquetaOrigenDatos: 'Eventos comparados',
        descripcionOrigenDatos:
          'La serie se lee de eventos_monitores ya compactada según la configuración operativa del portal.'
      },
      monitoresSeleccionados: monitoresSerializados,
      eventos: serializados,
      intervalos: agregado ? {
        cantidad: agregado.intervalos,
        puntos: puntosAgregados
      } : null
    };
  }

  async listarHistoricoAdministrativo(
    contextoUsuarioActual,
    {
      desde = null,
      hasta = null,
      monitorId = null,
      tipo = null,
      estadoTramo = null,
      codigoResultado = null,
      pagina = 1,
      tamanoPagina = 25,
      ordenarPor = 'valido_hasta',
      direccionOrden = 'desc'
    } = {}
  ) {
    if (!this.repositorioHistoricoMonitores) {
      throw new Error('El repositorio de histórico no está disponible.');
    }

    const rango = this.normalizarRangoEventos({ desde, hasta });
    const monitorIdNormalizado = this.normalizarIdOpcional(monitorId);
    const tipoNormalizado = this.normalizarTipoFiltro(tipo);
    const estadoNormalizado = this.normalizarEstadoEvento(estadoTramo);
    const codigoNormalizado = this.normalizarTextoFiltro(codigoResultado, 80);
    const paginaNormalizada = this.normalizarIdOpcional(pagina) ?? 1;
    const tamanoNormalizado = this.normalizarTamanoPaginaListado(tamanoPagina);
    const ordenarPorNormalizado = this.normalizarOrdenHistorico(ordenarPor);
    const direccionOrdenNormalizada =
      this.normalizarDireccionListado(direccionOrden);

    if (monitorIdNormalizado != null) {
      await this.buscarMonitorVisible(contextoUsuarioActual, monitorIdNormalizado);
    }

    const resultado =
      await this.repositorioHistoricoMonitores.listarPaginadoVisible(
        contextoUsuarioActual,
        {
          monitorId: monitorIdNormalizado,
          tipo: tipoNormalizado,
          estadoTramo: estadoNormalizado,
          codigoResultado: codigoNormalizado,
          desdeUtc: rango.desdeUtc,
          hastaUtc: rango.hastaUtc,
          pagina: paginaNormalizada,
          tamanoPagina: tamanoNormalizado,
          ordenarPor: ordenarPorNormalizado,
          direccionOrden: direccionOrdenNormalizada
        }
      );
    const tramos = resultado.tramos.map((tramo) =>
      this.serializarTramoHistoricoOperativo(tramo)
    );

    return {
      alcanceActual: this.construirAlcanceActual(contextoUsuarioActual),
      rangoAplicado: rango,
      filtros: {
        monitorId: monitorIdNormalizado,
        tipo: tipoNormalizado || '',
        estadoTramo: estadoNormalizado || '',
        codigoResultado: codigoNormalizado || '',
        pagina: resultado.paginacion.pagina,
        tamanoPagina: resultado.paginacion.tamanoPagina,
        ordenarPor: ordenarPorNormalizado,
        direccionOrden: direccionOrdenNormalizada
      },
      resumen: resultado.resumen,
      tramos,
      paginacion: {
        ...resultado.paginacion,
        desde:
          resultado.paginacion.totalFiltrado === 0
            ? 0
            : ((resultado.paginacion.pagina - 1) *
                resultado.paginacion.tamanoPagina) + 1,
        hasta: Math.min(
          resultado.paginacion.totalFiltrado,
          resultado.paginacion.pagina * resultado.paginacion.tamanoPagina
        )
      }
    };
  }

  async obtenerOpcionesMonitoresEventos(
    contextoUsuarioActual,
    {
      tipo = null,
      soloActivos = false
    } = {}
  ) {
    const tipoNormalizado = this.normalizarTipoFiltro(tipo);
    const visibles = await this.repositorioMonitores.listarVisibles(
      contextoUsuarioActual
    );

    return visibles
      .filter((monitor) => {
        if (tipoNormalizado && monitor.tipo !== tipoNormalizado) {
          return false;
        }

        if (soloActivos && !monitor.activo) {
          return false;
        }

        return true;
      })
      .map((monitor) => ({
        valor: monitor.id,
        etiqueta: `${monitor.nombre} (#${monitor.id})`,
        tipo: monitor.tipo,
        tenantId: monitor.tenantId,
        empresaId: monitor.empresaId,
        sitioId: monitor.sitioId,
        interpretacionEstado: monitor.interpretacionEstado,
        descripcionFallo: monitor.descripcionFallo,
        posibleSolucion: monitor.posibleSolucion,
        alcance: monitor.sitioId == null
          ? `${monitor.empresaNombre || 'Empresa'} #${monitor.empresaId}`
          : `${monitor.sitioNombre || 'Sitio'} #${monitor.sitioId}`,
        activo: monitor.activo
      }));
  }

  async crearMonitor(contextoUsuarioActual, datos) {
    const operacion = await this.resolverOperacionMonitorValida(
      contextoUsuarioActual,
      datos
    );

    const crear = async (conexion = null) => {
      const monitor = operacion.fuenteTelemetria
        ? await this.crearMonitorTelemetriaConConexion(operacion, conexion)
        : await this.repositorioMonitores.crear(
            operacion.definicion,
            { conexion }
          );
      await this.sincronizarEntradasFederadasMonitorLogico({
        monitor,
        entradas: operacion.entradasFederadas,
        conexion
      });
      if (conexion && this.auditoriaActiva()) {
        await this.registrarEventoMonitor({
          conexion,
          contextoUsuarioActual,
          tipo: 'monitor.creado',
          monitor,
          payload: {
            resultado: 'creado',
            antes: null,
            despues: fotografiaMonitorAuditable(monitor)
          }
        });
      }
      if (conexion) await this.capturarAdministracionMonitor(monitor.id, conexion);
      return monitor;
    };
    const requiereTransaccionFederada = operacion.entradasFederadas.length > 0;
    this.asegurarAdministracionEntradasFederadas(requiereTransaccionFederada);
    const monitor = this.auditoriaActiva() || requiereTransaccionFederada ||
        this.capturadorFederacion
      ? await this.fronteraTransaccional.ejecutar(crear)
      : operacion.fuenteTelemetria
        ? await this.crearMonitorTelemetriaTransaccional(operacion)
        : await crear();
    await this.incrementarVersionCatalogoMonitores();
    return monitor;
  }

  async actualizarMonitor(contextoUsuarioActual, idMonitor, datos) {
    const monitorAnterior = await this.buscarMonitorVisible(
      contextoUsuarioActual,
      idMonitor
    );
    const operacion = await this.resolverOperacionMonitorValida(
      contextoUsuarioActual,
      datos,
      { idMonitorActual: idMonitor }
    );

    const requiereTransaccionTelemetria =
      monitorAnterior.tipo === 'telemetria' ||
      operacion.definicion.tipo === 'telemetria';
    const teniaEntradasFederadas = monitorAnterior.tipo === 'booleano' &&
      (monitorAnterior.configuracion?.dependencias || []).some(
        (dependencia) => dependencia.fuente === FUENTE_MONITOR_FEDERADO
      );
    const requiereTransaccionFederada = teniaEntradasFederadas ||
      operacion.entradasFederadas.length > 0;
    this.asegurarAdministracionEntradasFederadas(requiereTransaccionFederada);
    const fotografiaAnterior = fotografiaMonitorAuditable(monitorAnterior);
    const fotografiaObjetivo = fotografiaDefinicionMonitorAuditable(
      operacion.definicion
    );
    const camposCambiados = calcularCamposCambiadosMonitor(
      fotografiaAnterior,
      fotografiaObjetivo
    );
    if (camposCambiados.length === 0) {
      return monitorAnterior;
    }

    const actualizar = async (conexion = null) => {
      if (teniaEntradasFederadas && operacion.definicion.tipo !== 'booleano') {
        await this.repositorioEntradasFederadasMonitoresLogicos
          .eliminarPorMonitorId(idMonitor, {
            conexion,
            causaCierre: 'monitor_convertido'
          });
      }
      const monitor = requiereTransaccionTelemetria
        ? await this.actualizarMonitorTelemetriaConConexion({
            idMonitor,
            ...operacion
          }, conexion)
        : await this.repositorioMonitores.actualizarCompleto(
            { idMonitor, ...operacion.definicion },
            { conexion }
          );
      await this.sincronizarEntradasFederadasMonitorLogico({
        monitor,
        entradas: operacion.entradasFederadas,
        conexion
      });
      if (conexion && this.auditoriaActiva()) {
        await this.registrarEventoMonitor({
          conexion,
          contextoUsuarioActual,
          tipo: 'monitor.actualizado',
          monitor,
          payload: {
            resultado: 'actualizado',
            camposCambiados,
            antes: filtrarFotografiaPorCampos(fotografiaAnterior, camposCambiados),
            despues: filtrarFotografiaPorCampos(
              fotografiaMonitorAuditable(monitor),
              camposCambiados
            )
          }
        });
        if (scopeMonitorCambio(fotografiaAnterior, fotografiaMonitorAuditable(monitor))) {
          await this.registrarMovimientoScopeMonitor({
            conexion,
            contextoUsuarioActual,
            monitorAnterior,
            monitorActual: monitor
          });
        }
      }
      if (!monitor.activo && this.servicioCierreAlertasMonitoresInactivos) {
        await this.servicioCierreAlertasMonitoresInactivos.cerrarEnTransaccion(
          { monitorId: monitor.id, contextoUsuarioActual }, { conexion }
        );
      }
      if (conexion) await this.capturarAdministracionMonitor(monitor.id, conexion);
      return monitor;
    };
    const monitor = this.auditoriaActiva() || requiereTransaccionFederada ||
        this.capturadorFederacion || this.servicioCierreAlertasMonitoresInactivos
      ? await this.fronteraTransaccional.ejecutar(actualizar)
      : requiereTransaccionTelemetria
        ? await this.actualizarMonitorTelemetriaTransaccional({
            idMonitor,
            ...operacion
          })
        : await actualizar();
    await this.incrementarVersionCatalogoMonitores();
    return monitor;
  }

  async obtenerImpactoEliminacionMonitor(contextoUsuarioActual, idMonitor) {
    const monitor = await this.buscarMonitorVisible(contextoUsuarioActual, idMonitor);
    const impacto = await this.repositorioMonitores.resumirImpactoEliminacion(idMonitor);

    return {
      monitor: {
        id: monitor.id,
        nombre: monitor.nombre,
        tipo: monitor.tipo
      },
      impacto
    };
  }

  async eliminarMonitor(contextoUsuarioActual, idMonitor) {
    const monitorAnterior = await this.buscarMonitorVisible(
      contextoUsuarioActual,
      idMonitor
    );
    const teniaEntradasFederadas = monitorAnterior.tipo === 'booleano' &&
      (monitorAnterior.configuracion?.dependencias || []).some(
        (dependencia) => dependencia.fuente === FUENTE_MONITOR_FEDERADO
      );
    this.asegurarAdministracionEntradasFederadas(teniaEntradasFederadas);
    const eliminar = async (conexion = null) => {
      if (conexion) {
        await this.repositorioPreparacionBajaEjecucionesCorreo
          ?.prepararPorMonitorEnTransaccion(idMonitor, { conexion });
      }
      if (conexion && this.capturadorFederacion) {
        await this.capturadorFederacion.capturarEnTransaccion({
          familia: 'monitores',
          prepararCapturas: ({ interfazCaptura }) =>
            interfazCaptura.prepararCapturaEnTransaccion(
              crearSolicitudCapturaFederacion(
                OPERACIONES_CAPTURA_FEDERACION.MONITORES_RETIRADA,
                { monitorId: idMonitor }
              ),
              { conexion }
            )
        }, { conexion });
      }
      if (teniaEntradasFederadas) {
        await this.repositorioEntradasFederadasMonitoresLogicos
          .eliminarPorMonitorId(idMonitor, {
            conexion,
            causaCierre: 'monitor_eliminado'
          });
      }
      const eliminado = await this.repositorioMonitores.eliminar(
        idMonitor,
        { conexion }
      );
      if (eliminado && conexion && this.auditoriaActiva()) {
        await this.registrarEventoMonitor({
          conexion,
          contextoUsuarioActual,
          tipo: 'monitor.eliminado',
          monitor: monitorAnterior,
          payload: {
            resultado: 'eliminado',
            antes: fotografiaMonitorAuditable(monitorAnterior),
            despues: null,
            impactoResumen: null
          }
        });
      }
      return eliminado;
    };
    const eliminado = this.auditoriaActiva() || teniaEntradasFederadas ||
        this.capturadorFederacion ||
        this.repositorioPreparacionBajaEjecucionesCorreo
      ? await this.fronteraTransaccional.ejecutar(eliminar)
      : await eliminar();

    if (eliminado) {
      await this.incrementarVersionCatalogoMonitores();
    }

    return eliminado;
  }

  capturarAdministracionMonitor(monitorId, conexion) {
    if (!this.capturadorFederacion) return null;
    return this.capturadorFederacion.capturarEnTransaccion({
      familia: 'monitores',
      prepararCapturas: ({ selector, interfazCaptura }) => {
        const incluirCredencialPropia = selector.permiteContenidoSensible &&
          selector.campos.includes('credencialPropia');
        return interfazCaptura.prepararCapturaEnTransaccion(
          crearSolicitudCapturaFederacion(
            OPERACIONES_CAPTURA_FEDERACION.MONITORES_ADMINISTRACION,
            {
              monitorIds: [monitorId],
              incluirCredencialPropia,
              puedeFederarCredencialPropia: incluirCredencialPropia
            }
          ),
          { conexion }
        );
      }
    }, { conexion });
  }

  async incrementarVersionCatalogoMonitores() {
    if (!this.versionadorCatalogoMonitoresRedis) {
      return null;
    }

    return this.versionadorCatalogoMonitoresRedis.incrementarVersion();
  }

  async buscarMonitorVisible(contextoUsuarioActual, idMonitor) {
    const monitor = await this.repositorioMonitores.buscarPorId(idMonitor);

    if (!monitor) {
      throw Object.assign(new Error('No existe el monitor solicitado en tu alcance visible.'), {
        codigo: 'monitor_no_encontrado', statusCode: 404
      });
    }
    if (!this.puedeAlcanzarMonitor(contextoUsuarioActual, monitor)) {
      throw Object.assign(new Error('No existe el monitor solicitado en tu alcance visible.'), {
        codigo: 'monitor_fuera_de_alcance', statusCode: 403
      });
    }

    return monitor;
  }

  auditoriaActiva() {
    return Boolean(
      this.fronteraTransaccional?.ejecutar &&
      this.servicioAuditoria?.registrarEnTransaccion &&
      this.servicioAuditoria?.registrarMovimientoEnTransaccion
    );
  }

  registrarEventoMonitor({
    conexion,
    contextoUsuarioActual,
    tipo,
    monitor,
    payload
  }) {
    const eventoId = generarUuidV7Auditoria();
    const scope = scopeDesdeMonitor(monitor);
    return this.servicioAuditoria.registrarEnTransaccion({
      cambioEfectivo: true,
      intencion: {
        versionContrato: 1,
        eventoId,
        tipo,
        flujo: 'monitores',
        claveCadena: `monitores:tenant:${scope.tenantId}`,
        actor: 'usuario',
        actorReal: actorReal(contextoUsuarioActual),
        actorEfectivo: actorEfectivo(contextoUsuarioActual),
        modoActuacion: contextoUsuarioActual?.impersonacionActiva
          ? 'impersonado'
          : 'directo',
        sujeto: { tipo: 'monitor', id: String(monitor.id) },
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

  registrarMovimientoScopeMonitor({
    conexion,
    contextoUsuarioActual,
    monitorAnterior,
    monitorActual
  }) {
    const salidaId = generarUuidV7Auditoria();
    const entradaId = generarUuidV7Auditoria();
    const actor = actorReal(contextoUsuarioActual);
    const actorEfectivoMovimiento = actorEfectivo(contextoUsuarioActual);
    const comun = {
      versionContrato: 1,
      flujo: 'monitores',
      actor: 'usuario',
      actorReal: actor,
      actorEfectivo: actorEfectivoMovimiento,
      modoActuacion: contextoUsuarioActual?.impersonacionActiva
        ? 'impersonado'
        : 'directo',
      sujeto: { tipo: 'monitor', id: String(monitorActual.id) },
      origen: 'web',
      correlacionId: salidaId,
      causalidad: null,
      productor: 'portal_web',
      claveOperacion: salidaId,
      efectivoEnUtc: this.ahora().toISOString(),
      versionCanonicalizador: PERFIL_JCS_AUDITORIA_V1,
      versionEncadenado: VERSION_ENCADENADO_AUDITORIA_V1
    };
    const salida = {
      ...comun,
      eventoId: salidaId,
      tipo: 'scope.entidad_salida',
      claveCadena: `monitores:tenant:${monitorAnterior.tenantId}`,
      scope: scopeDesdeMonitor(monitorAnterior),
      rolEvento: 'salida',
      payload: {
        direccion: 'salida',
        scopePropio: scopeDesdeMonitor(monitorAnterior),
        eventoContraparteId: entradaId,
        impactoResumen: null
      }
    };
    const entrada = {
      ...comun,
      eventoId: entradaId,
      tipo: 'scope.entidad_entrada',
      claveCadena: `monitores:tenant:${monitorActual.tenantId}`,
      scope: scopeDesdeMonitor(monitorActual),
      rolEvento: 'entrada',
      payload: {
        direccion: 'entrada',
        scopePropio: scopeDesdeMonitor(monitorActual),
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

  async resolverOperacionMonitorValida(
    contextoUsuarioActual,
    datos,
    { idMonitorActual = null } = {}
  ) {
    const tipo = normalizarTipoMonitor(datos?.tipo);
    const seleccionTelemetria = tipo === 'telemetria'
      ? await this.resolverSeleccionTelemetria(contextoUsuarioActual, datos)
      : null;
    const datosDefinicion = seleccionTelemetria
      ? {
          ...datos,
          nivel_pertenencia: 'sitio',
          tenant_id: seleccionTelemetria.agente.tenantId,
          empresa_id: seleccionTelemetria.agente.empresaId,
          sitio_id: seleccionTelemetria.agente.sitioId,
          configuracion_telemetria: seleccionTelemetria.configuracion
        }
      : datos;
    const definicion = await this.resolverDefinicionBaseValida(
      contextoUsuarioActual,
      datosDefinicion,
      { idMonitorActual }
    );
    const entradasFederadas = definicion.tipo === 'booleano'
      ? (definicion.configuracion?.dependencias || [])
          .filter((dependencia) => dependencia.fuente === FUENTE_MONITOR_FEDERADO)
      : [];
    await this.validarVisibilidadEntradasFederadas(
      contextoUsuarioActual,
      entradasFederadas
    );

    return {
      definicion,
      fuenteTelemetria: seleccionTelemetria?.fuente || null,
      entradasFederadas
    };
  }

  async validarVisibilidadEntradasFederadas(contextoUsuarioActual, entradas) {
    if (entradas.length === 0) return;
    this.asegurarAdministracionEntradasFederadas(true);
    const contextoScope = await this.completarContextoScopeOrganizativo(
      contextoUsuarioActual
    );
    const solicitadas = entradas.map((entrada) => entrada.proyeccionId);
    const visibles = await this.repositorioEntradasFederadasMonitoresLogicos
      .listarProyeccionesVisibles(contextoScope, solicitadas);
    const conjunto = new Set(visibles);
    const noVisibles = solicitadas.filter(
      (proyeccionId) => !conjunto.has(proyeccionId)
    );
    if (noVisibles.length > 0) {
      throw new Error(
        `Las proyecciones federadas no existen, no son monitores o quedan fuera del alcance visible: ${noVisibles.join(', ')}.`
      );
    }
  }

  asegurarAdministracionEntradasFederadas(requerida) {
    if (!requerida) return;
    if (!this.repositorioEntradasFederadasMonitoresLogicos ||
        typeof this.fronteraTransaccional?.ejecutar !== 'function') {
      throw new Error(
        'Las entradas federadas requieren repositorio y frontera transaccional explícitos.'
      );
    }
  }

  async sincronizarEntradasFederadasMonitorLogico({ monitor, entradas, conexion }) {
    if (!this.repositorioEntradasFederadasMonitoresLogicos) return;
    if (typeof this.repositorioEntradasFederadasMonitoresLogicos
      .reemplazarPorMonitor === 'function') {
      await this.repositorioEntradasFederadasMonitoresLogicos.reemplazarPorMonitor(
        monitor.id,
        entradas || [],
        { conexion }
      );
      return;
    }
    await this.repositorioEntradasFederadasMonitoresLogicos.eliminarPorMonitorId(
      monitor.id,
      { conexion }
    );
    for (const entrada of entradas || []) {
      await this.repositorioEntradasFederadasMonitoresLogicos.vincular({
        monitorId: monitor.id,
        variable: entrada.variable,
        proyeccionId: entrada.proyeccionId
      }, { conexion });
    }
  }

  async resolverSeleccionTelemetria(contextoUsuarioActual, datos) {
    this.asegurarDependenciasAdministracionTelemetria();
    const agente = await this.buscarAgenteTelemetriaVisible(
      contextoUsuarioActual,
      datos.telemetria_agente_id
    );
    const tipoFuente = String(datos.telemetria_tipo_fuente || '')
      .trim()
      .toLowerCase();
    const retardoFalloSegundos = datos.telemetria_retardo_fallo_segundos;

    if (tipoFuente === TIPOS_FUENTE_MONITOR_TELEMETRIA.SENAL_DIRECTA) {
      const senal = await this.repositorioCatalogoSenalesTelemetria.buscarPorId(
        datos.telemetria_senal_id
      );
      if (!senal || Number(senal.agenteId) !== Number(agente.id)) {
        throw new Error('La señal seleccionada no pertenece al agente indicado.');
      }
      const tipoDato = asegurarTipoDatoDirectamenteMonitorizable(senal.tipoDato);
      const condicion = this.construirCondicionDirectaTelemetriaDesdeEntrada(
        tipoDato,
        datos
      );
      const configuracion = crearConfiguracionMonitorTelemetria(
        {
          version: 1,
          retardoFalloSegundos,
          condicion
        },
        { senal: this.serializarEntidad(senal) }
      ).serializar();

      return {
        agente,
        configuracion,
        fuente: {
          tipo: tipoFuente,
          agenteId: agente.id,
          senalId: senal.id
        }
      };
    }

    if (tipoFuente === TIPOS_FUENTE_MONITOR_TELEMETRIA.REGLA_DERIVACION) {
      const regla = await this.repositorioReglasDerivacionTelemetria.buscarPorId(
        datos.telemetria_regla_id
      );
      if (!regla || Number(regla.regla.agenteId) !== Number(agente.id)) {
        throw new Error('La regla seleccionada no pertenece al agente indicado.');
      }
      const configuracion = crearConfiguracionTemporalMonitorTelemetria({
        version: 1,
        retardoFalloSegundos
      });

      return {
        agente,
        configuracion,
        fuente: {
          tipo: tipoFuente,
          reglaId: regla.regla.id
        }
      };
    }

    throw new Error(
      'Selecciona una señal directa o una regla de derivación como fuente.'
    );
  }

  construirCondicionDirectaTelemetriaDesdeEntrada(tipoDato, datos) {
    if (tipoDato === 'numero') {
      return {
        tipo: TIPOS_CONDICION_MONITOR_TELEMETRIA.RANGO_NUMERICO,
        tipoDato,
        version: 1,
        minimo: this.normalizarDecimalOpcional(datos.telemetria_minimo),
        maximo: this.normalizarDecimalOpcional(datos.telemetria_maximo)
      };
    }

    const operador = tipoDato === 'booleano'
      ? OPERADORES_VALOR_ESPERADO_TELEMETRIA.IGUAL
      : String(datos.telemetria_operador || '').trim().toLowerCase();
    const valorEsperado = tipoDato === 'booleano'
      ? this.normalizarBooleanoTelemetria(datos.telemetria_valor_esperado)
      : String(datos.telemetria_valor_esperado || '').trim();

    return {
      tipo: TIPOS_CONDICION_MONITOR_TELEMETRIA.VALOR_ESPERADO,
      tipoDato,
      version: 1,
      operador,
      valorEsperado
    };
  }

  normalizarDecimalOpcional(valor) {
    const texto = String(valor ?? '').trim().replace(',', '.');
    if (!texto) {
      return null;
    }
    const numero = Number(texto);
    if (!Number.isFinite(numero)) {
      throw new Error('Los límites de telemetría deben ser números finitos.');
    }
    return numero;
  }

  normalizarBooleanoTelemetria(valor) {
    const texto = String(valor ?? '').trim().toLowerCase();
    if (!['true', 'false'].includes(texto)) {
      throw new Error('El valor esperado debe ser verdadero o falso.');
    }
    return texto === 'true';
  }

  async crearMonitorTelemetriaTransaccional({ definicion, fuenteTelemetria }) {
    const conexion = await this.obtenerConexionAdministracionTelemetria();
    try {
      await conexion.beginTransaction();
      const monitor = await this.crearMonitorTelemetriaConConexion(
        { definicion, fuenteTelemetria },
        conexion
      );
      await conexion.commit();
      return monitor;
    } catch (error) {
      await conexion.rollback();
      throw error;
    } finally {
      conexion.release();
    }
  }

  async crearMonitorTelemetriaConConexion(
    { definicion, fuenteTelemetria },
    conexion
  ) {
    const monitor = await this.repositorioMonitores.crear(
      definicion,
      { conexion }
    );
    await this.vincularFuenteTelemetria(
      monitor.id,
      fuenteTelemetria,
      conexion
    );
    return monitor;
  }

  async actualizarMonitorTelemetriaTransaccional({
    idMonitor,
    definicion,
    fuenteTelemetria
  }) {
    const conexion = await this.obtenerConexionAdministracionTelemetria();
    try {
      await conexion.beginTransaction();
      const monitor = await this.actualizarMonitorTelemetriaConConexion(
        { idMonitor, definicion, fuenteTelemetria },
        conexion
      );
      await conexion.commit();
      return monitor;
    } catch (error) {
      await conexion.rollback();
      throw error;
    } finally {
      conexion.release();
    }
  }

  async actualizarMonitorTelemetriaConConexion({
    idMonitor,
    definicion,
    fuenteTelemetria
  }, conexion) {
    await this.repositorioVinculosMonitoresTelemetria.eliminarPorMonitorId(
      idMonitor,
      { conexion }
    );
    const monitor = await this.repositorioMonitores.actualizarCompleto(
      { idMonitor, ...definicion },
      { conexion }
    );
    if (fuenteTelemetria) {
      await this.vincularFuenteTelemetria(
        monitor.id,
        fuenteTelemetria,
        conexion
      );
    }
    return monitor;
  }

  async vincularFuenteTelemetria(monitorId, fuente, conexion) {
    if (fuente.tipo === TIPOS_FUENTE_MONITOR_TELEMETRIA.SENAL_DIRECTA) {
      return this.repositorioVinculosMonitoresTelemetria.vincularSenalDirecta(
        {
          monitorId,
          agenteId: fuente.agenteId,
          senalId: fuente.senalId
        },
        { conexion }
      );
    }

    if (fuente.tipo === TIPOS_FUENTE_MONITOR_TELEMETRIA.SENAL_FEDERADA) {
      return this.repositorioVinculosMonitoresTelemetria.vincularSenalFederada(
        { monitorId, proyeccionId: fuente.proyeccionId },
        { conexion }
      );
    }

    return this.repositorioVinculosMonitoresTelemetria.vincularReglaDerivacion(
      { monitorId, reglaId: fuente.reglaId },
      { conexion }
    );
  }

  async obtenerConexionAdministracionTelemetria() {
    this.asegurarDependenciasAdministracionTelemetria();
    const clienteSql = this.repositorioMonitores?.clienteSql;
    if (typeof clienteSql?.obtenerConexion !== 'function') {
      throw new Error(
        'El CRUD de telemetría requiere una conexión SQL transaccional.'
      );
    }
    return clienteSql.obtenerConexion();
  }

  asegurarDependenciasAdministracionTelemetria() {
    for (const [nombre, dependencia] of Object.entries({
      repositorioVinculosMonitoresTelemetria:
        this.repositorioVinculosMonitoresTelemetria,
      repositorioAgentes: this.repositorioAgentes,
      repositorioCatalogoSenalesTelemetria:
        this.repositorioCatalogoSenalesTelemetria,
      repositorioEstadoActualTelemetria:
        this.repositorioEstadoActualTelemetria,
      repositorioReglasDerivacionTelemetria:
        this.repositorioReglasDerivacionTelemetria
    })) {
      if (!dependencia) {
        throw new Error(`La dependencia ${nombre} del CRUD es obligatoria.`);
      }
    }
  }

  async resolverDefinicionBaseValida(
    contextoUsuarioActual,
    datos,
    { idMonitorActual = null } = {}
  ) {
    const contextoScope = await this.completarContextoScopeOrganizativo(
      contextoUsuarioActual
    );
    const datosNormalizadosScope = {
      ...datos,
      nivel_pertenencia: contextoScope?.nivelScope === 'sitio'
        ? 'sitio'
        : datos.nivel_pertenencia,
      tenant_id: String(
        datos.tenant_id || contextoScope?.tenantId || ''
      ).trim(),
      empresa_id: String(
        datos.empresa_id || contextoScope?.empresaId || ''
      ).trim(),
      sitio_id: String(datos.sitio_id || contextoScope?.sitioId || '').trim()
    };
    const nivelPertenencia = this.resolverNivelPertenenciaSolicitada(
      datosNormalizadosScope.nivel_pertenencia,
      datosNormalizadosScope.sitio_id
    );
    const definicion = this.validadorMonitor.normalizarDefinicionBase({
      tenantId: datosNormalizadosScope.tenant_id,
      empresaId: datosNormalizadosScope.empresa_id,
      sitioId: nivelPertenencia === 'empresa'
        ? null
        : datosNormalizadosScope.sitio_id,
      nombre: datosNormalizadosScope.nombre,
      tipo: datosNormalizadosScope.tipo,
      descripcion: datosNormalizadosScope.descripcion,
      interpretacionEstado:
        datosNormalizadosScope.interpretacion_estado ??
        datosNormalizadosScope.interpretacionEstado,
      descripcionFallo:
        datosNormalizadosScope.descripcion_fallo ??
        datosNormalizadosScope.descripcionFallo,
      posibleSolucion:
        datosNormalizadosScope.posible_solucion ??
        datosNormalizadosScope.posibleSolucion,
      activo: datosNormalizadosScope.activo,
      intervaloEjecucionSegundos: datosNormalizadosScope.intervalo_ejecucion_segundos,
      desfaseInicialSegundos: datosNormalizadosScope.desfase_inicial_segundos,
      inferenciasIndisponibleConsecutivas:
        datosNormalizadosScope.inferencias_indisponible_consecutivas ??
        datosNormalizadosScope.inferenciasIndisponibleConsecutivas,
      inferenciasDisponibleConsecutivas:
        datosNormalizadosScope.inferencias_disponible_consecutivas ??
        datosNormalizadosScope.inferenciasDisponibleConsecutivas,
      entradaComposicionBooleana:
        datosNormalizadosScope.entrada_composicion_booleana ??
        datosNormalizadosScope.entradaComposicionBooleana,
      configuracion: datosNormalizadosScope.configuracion,
      host: datosNormalizadosScope.host,
      timeoutMs: datosNormalizadosScope.timeout_ms,
      reintentos: datosNormalizadosScope.reintentos,
      tamanoPaqueteBytes: datosNormalizadosScope.tamano_paquete_bytes,
      ttl: datosNormalizadosScope.ttl,
      puerto: datosNormalizadosScope.puerto,
      usarTls: datosNormalizadosScope.usar_tls,
      vigenciaMinimaCertDias: datosNormalizadosScope.vigencia_minima_cert_dias,
      configuracionLogica: this.construirConfiguracionLogicaDesdeEntrada(
        datosNormalizadosScope
      ),
      configuracionTelemetria:
        datosNormalizadosScope.configuracion_telemetria || null
    });
    this.validarPertenenciaSegunScope(
      contextoScope,
      definicion,
      nivelPertenencia
    );

    const tenant = await this.repositorioTenants.buscarPorId(definicion.tenantId);
    const empresa = await this.repositorioEmpresas.buscarPorId(definicion.empresaId);
    const sitio = definicion.sitioId == null
      ? null
      : await this.repositorioSitios.buscarPorId(definicion.sitioId);

    if (!tenant) {
      throw new Error('El tenant seleccionado no existe.');
    }

    if (!empresa) {
      throw new Error('La empresa seleccionada no existe.');
    }

    if (empresa.tenantId !== definicion.tenantId) {
      throw new Error('La empresa seleccionada no pertenece al tenant indicado.');
    }

    if (sitio) {
      if (
        Number(sitio.tenantId) !== Number(definicion.tenantId) ||
        Number(sitio.empresaId) !== Number(definicion.empresaId)
      ) {
        throw new Error(
          'El sitio seleccionado no pertenece a la empresa y tenant indicados.'
        );
      }
    }

    if (!this.puedeAlcanzarEmpresa(contextoScope, empresa.id, tenant.id)) {
      throw new Error(
        'No puedes trabajar con monitores de una empresa fuera de tu alcance.'
      );
    }

    if (
      sitio &&
      !this.resolutorScopeUsuario.puedeAlcanzarSitio(
        contextoScope,
        sitio.id,
        empresa.id,
        tenant.id
      )
    ) {
      throw new Error(
        'No puedes trabajar con monitores de un sitio fuera de tu alcance.'
      );
    }

    await this.validarDependenciasMonitorLogicoSegunScope(
      contextoScope,
      definicion,
      { idMonitorActual }
    );

    return definicion;
  }

  async validarDependenciasMonitorLogicoSegunScope(
    contextoUsuarioActual,
    definicion,
    { idMonitorActual = null } = {}
  ) {
    if (definicion.tipo !== 'booleano') {
      return;
    }

    const idsDependencias = extraerIdsMonitoresDependenciasMonitorLogico(
      definicion.configuracion?.dependencias
    );

    if (idsDependencias.length === 0) {
      return;
    }

    if (
      idMonitorActual != null &&
      idsDependencias.includes(Number(idMonitorActual))
    ) {
      throw new Error('Un monitor lógico no puede depender de sí mismo.');
    }

    const monitores = await this.repositorioMonitores.listarPorIds(idsDependencias);
    const monitoresPorId = new Map(
      monitores.map((monitor) => [Number(monitor.id), monitor])
    );

    for (const idDependencia of idsDependencias) {
      const monitor = monitoresPorId.get(Number(idDependencia));

      if (!monitor) {
        throw new Error(
          `La dependencia de monitor #${idDependencia} no existe.`
        );
      }

      if (!this.puedeAlcanzarMonitor(contextoUsuarioActual, monitor)) {
        throw new Error(
          `La dependencia de monitor #${idDependencia} queda fuera de tu alcance visible.`
        );
      }
    }

    await this.validarCiclosDependenciasMonitorLogico({
      idMonitorActual,
      idsDependenciasIniciales: idsDependencias
    });
  }

  async validarCiclosDependenciasMonitorLogico({
    idMonitorActual = null,
    idsDependenciasIniciales = []
  } = {}) {
    const idActual = this.normalizarIdOpcional(idMonitorActual);

    if (idActual == null) {
      return;
    }

    const visitados = new Set();
    const ruta = [];

    for (const idDependencia of idsDependenciasIniciales) {
      await this.explorarDependenciaMonitorLogico({
        idActual,
        idDependencia,
        visitados,
        ruta
      });
    }
  }

  async explorarDependenciaMonitorLogico({
    idActual,
    idDependencia,
    visitados,
    ruta
  }) {
    const idNormalizado = this.normalizarIdOpcional(idDependencia);

    if (idNormalizado == null) {
      return;
    }

    if (idNormalizado === idActual) {
      const rutaCompleta = [...ruta, idNormalizado].join(' -> ');
      throw new Error(
        `El monitor lógico no puede crear un ciclo de dependencias (${rutaCompleta}).`
      );
    }

    if (visitados.has(idNormalizado)) {
      return;
    }

    visitados.add(idNormalizado);

    const dependencias = await this.repositorioMonitores.listarPorIds([
      idNormalizado
    ]);
    const monitor = dependencias[0] || null;

    if (!monitor || monitor.tipo !== 'booleano') {
      return;
    }

    const siguientesDependencias = extraerIdsMonitoresDependenciasMonitorLogico(
      monitor.configuracion?.dependencias
    );

    for (const siguienteId of siguientesDependencias) {
      await this.explorarDependenciaMonitorLogico({
        idActual,
        idDependencia: siguienteId,
        visitados,
        ruta: [...ruta, idNormalizado]
      });
    }
  }

  serializarMonitor(monitor) {
    return {
      ...monitor.serializarResumen(),
      alcanceDescripcion: monitor.sitioId == null
        ? `${monitor.empresaNombre || 'Empresa'} #${monitor.empresaId}`
        : `${monitor.sitioNombre || 'Sitio'} #${monitor.sitioId} · ${monitor.empresaNombre || 'Empresa'} #${monitor.empresaId}`,
      urls: {
        ver: `/monitores/${monitor.id}`,
        editar: `/monitores/editar/${monitor.id}`
      }
    };
  }

  serializarAlertaActivaOperativa(alerta) {
    const serializada = alerta.serializarResumen();
    const payload = serializada.payloadAlerta || {};

    return {
      ...serializada,
      nombreMonitor: payload.nombreMonitor || null,
      scope: payload.scope || null,
      metricaPrincipal: payload.metricaPrincipal || null,
      protocolo: payload.protocolo || null,
      resultadoTecnico: this.construirResultadoTecnicoSerializado(serializada),
      interpretacionResultado: serializada.interpretacionResultado || null,
      resumen: this.construirResumenResultadoTecnico({
        estadoDetectado: serializada.estadoDetectado,
        codigoResultado: serializada.codigoUltimoResultado,
        mensajeResultado: serializada.mensajeUltimoResultado,
        interpretacionEstado: serializada.interpretacionEstado,
        estadoTecnicoDetectado: serializada.estadoTecnicoDetectado,
        codigoResultadoTecnico: serializada.codigoResultadoTecnico,
        mensajeResultadoTecnico: serializada.mensajeResultadoTecnico,
        interpretacionResultado: serializada.interpretacionResultado,
        metricaPrincipal: payload.metricaPrincipal || null
      })
    };
  }

  serializarEventoOperativo(evento) {
    const serializada = evento.serializarResumen();
    const payload = serializada.payloadEvento || {};

    return {
      ...serializada,
      nombreMonitor: payload.nombreMonitor || null,
      scope: payload.scope || null,
      metricaPrincipal: payload.metricaPrincipal || null,
      protocolo: payload.protocolo || null,
      programacion: payload.programacion || null,
      intentosRealizados: payload.intentosRealizados ?? null,
      intentoExitoso: payload.intentoExitoso ?? null,
      resultadoTecnico: this.construirResultadoTecnicoSerializado(serializada),
      interpretacionResultado: serializada.interpretacionResultado || null,
      resumen: this.construirResumenResultadoTecnico({
        estadoDetectado: serializada.estadoDetectado,
        codigoResultado: serializada.codigoResultado,
        mensajeResultado: serializada.mensajeResultado,
        interpretacionEstado: serializada.interpretacionEstado,
        estadoTecnicoDetectado: serializada.estadoTecnicoDetectado,
        codigoResultadoTecnico: serializada.codigoResultadoTecnico,
        mensajeResultadoTecnico: serializada.mensajeResultadoTecnico,
        interpretacionResultado: serializada.interpretacionResultado,
        metricaPrincipal: payload.metricaPrincipal || null
      })
    };
  }

  serializarTramoHistoricoOperativo(tramo) {
    const serializada = tramo.serializarResumen();
    const payload = serializada.payloadTramo || {};
    const compactacion = payload.compactacion || null;

    return {
      ...serializada,
      nombreMonitor:
        serializada.monitorNombre || payload.nombreMonitor || null,
      alcanceDescripcion: serializada.sitioId == null
        ? `${serializada.empresaNombre || 'Empresa'} #${serializada.empresaId}`
        : `${serializada.sitioNombre || 'Sitio'} #${serializada.sitioId} · ${serializada.empresaNombre || 'Empresa'} #${serializada.empresaId}`,
      compactacion,
      protocolo: payload.protocolo || null,
      metricaPrincipal: payload.metricaPrincipal || null,
      duracionTexto: this.formatearDuracionEntreFechas(
        serializada.validoDesdeUtc,
        serializada.validoHastaUtc
      ),
      resultadoTecnico: this.construirResultadoTecnicoSerializado(serializada),
      interpretacionResultado: serializada.interpretacionResultado || null,
      resumen: this.construirResumenResultadoTecnico({
        estadoDetectado: serializada.estadoTramo,
        codigoResultado: serializada.codigoUltimoResultado,
        mensajeResultado: serializada.mensajeUltimoResultado,
        interpretacionEstado: serializada.interpretacionEstado,
        estadoTecnicoDetectado: serializada.estadoTecnicoDetectado,
        codigoResultadoTecnico: serializada.codigoResultadoTecnico,
        mensajeResultadoTecnico: serializada.mensajeResultadoTecnico,
        interpretacionResultado: serializada.interpretacionResultado,
        metricaPrincipal: payload.metricaPrincipal || null
      })
    };
  }

  construirResultadoTecnicoSerializado(serializada = {}) {
    return {
      interpretacionEstado: serializada.interpretacionEstado || 'normal',
      exito: serializada.exitoTecnico == null
        ? null
        : Boolean(serializada.exitoTecnico),
      estadoDetectado: serializada.estadoTecnicoDetectado || null,
      codigoResultado: serializada.codigoResultadoTecnico || null,
      mensajeResultado: serializada.mensajeResultadoTecnico || null,
      detalleError: serializada.detalleErrorTecnico || null
    };
  }

  async construirOpcionesSelectorMonitores(contextoUsuarioActual) {
    const [tenants, empresas, sitios] = await Promise.all([
      this.repositorioTenants.listarVisibles(contextoUsuarioActual),
      this.repositorioEmpresas.listarVisibles(contextoUsuarioActual),
      this.repositorioSitios.listarVisibles(contextoUsuarioActual)
    ]);

    return {
      opcionesTipo: this.construirOpcionesTipoMonitorFiltro(),
      opcionesTenants: tenants.map((tenant) => ({
        valor: tenant.id,
        nombre: tenant.nombre,
        etiqueta: `${tenant.nombre} (#${tenant.id})`
      })),
      opcionesEmpresas: empresas.map((empresa) => ({
        valor: empresa.id,
        tenantId: empresa.tenantId,
        nombre: empresa.nombre,
        etiqueta: `${empresa.nombre} (#${empresa.id})`
      })),
      opcionesSitios: sitios.map((sitio) => ({
        valor: sitio.id,
        tenantId: sitio.tenantId,
        empresaId: sitio.empresaId,
        nombre: sitio.nombre,
        etiqueta: `${sitio.nombre} (#${sitio.id})`
      })),
      opcionesPertenencia: [
        { valor: '', etiqueta: 'Todas' },
        { valor: 'empresa', etiqueta: 'Empresa' },
        { valor: 'sitio', etiqueta: 'Sitio' }
      ],
      opcionesEstadoListado: [
        { valor: 'todos', etiqueta: 'Todos' },
        { valor: 'solo_activos', etiqueta: 'Solo activos' },
        { valor: 'solo_inactivos', etiqueta: 'Solo inactivos' }
      ],
      opcionesTamanoPaginaListado: [10, 25, 50, 100],
      opcionesOrdenListado: [
        { valor: 'nombre', etiqueta: 'Nombre' },
        { valor: 'tipo', etiqueta: 'Tipo' },
        { valor: 'tenant', etiqueta: 'Tenant' },
        { valor: 'empresa', etiqueta: 'Empresa' },
        { valor: 'ubicacion', etiqueta: 'Ubicación' },
        { valor: 'activo', etiqueta: 'Activo' },
        { valor: 'intervalo', etiqueta: 'Intervalo' },
        { valor: 'creado', etiqueta: 'Creado' },
        { valor: 'actualizado', etiqueta: 'Actualizado' }
      ]
    };
  }

  async construirContextoHeroListado(
    contextoUsuarioActual,
    { tenantId, empresaId, sitioId },
    { opcionesTenants, opcionesEmpresas }
  ) {
    const tenantSolicitado = this.normalizarIdOpcional(tenantId);
    const empresaSolicitada = this.normalizarIdOpcional(empresaId);
    const sitioSolicitado = this.normalizarIdOpcional(sitioId);
    const buscarTenant = (id) => opcionesTenants.find(
      (opcion) => Number(opcion.valor) === Number(id)
    );
    const buscarEmpresa = (id) => opcionesEmpresas.find(
      (opcion) => Number(opcion.valor) === Number(id)
    );

    let tenant = buscarTenant(tenantSolicitado || contextoUsuarioActual.tenantId);
    let empresa = buscarEmpresa(empresaSolicitada || contextoUsuarioActual.empresaId);
    let sitio = null;
    const idSitio = sitioSolicitado || contextoUsuarioActual.sitioId;

    if (idSitio) {
      const candidato = await this.repositorioSitios.buscarPorId(idSitio);
      if (
        candidato &&
        this.resolutorScopeUsuario.puedeAlcanzarSitio(
          contextoUsuarioActual,
          candidato.id,
          candidato.empresaId,
          candidato.tenantId
        ) &&
        (!empresaSolicitada || Number(empresaSolicitada) === Number(candidato.empresaId)) &&
        (!tenantSolicitado || Number(tenantSolicitado) === Number(candidato.tenantId))
      ) {
        sitio = candidato;
        empresa = buscarEmpresa(candidato.empresaId);
        tenant = buscarTenant(candidato.tenantId);
      }
    }

    if (!sitio && empresa) {
      tenant = buscarTenant(empresa.tenantId);
    }

    const filtrosNavegacion = {};
    if (tenantSolicitado && tenant && Number(tenant.valor) === Number(tenantSolicitado)) {
      filtrosNavegacion.tenant_id = tenantSolicitado;
    }
    if (empresaSolicitada && empresa && Number(empresa.valor) === Number(empresaSolicitada)) {
      filtrosNavegacion.empresa_id = empresaSolicitada;
    }
    if (sitioSolicitado && sitio && Number(sitio.id) === Number(sitioSolicitado)) {
      filtrosNavegacion.sitio_id = sitioSolicitado;
    }

    const etiquetasAlcance = {
      portal: 'Portal completo',
      tenant: 'Tenant acotado',
      empresa: 'Empresa acotada',
      sitio: 'Sitio acotado'
    };

    return {
      tenant: tenant?.nombre || null,
      empresa: empresa?.nombre || null,
      sitio: sitio?.nombre || null,
      alcance: etiquetasAlcance[contextoUsuarioActual.nivelScope] || 'Alcance actual',
      filtrosNavegacion,
      tieneFiltroOrganizativo: Object.keys(filtrosNavegacion).length > 0
    };
  }


  construirOpcionesTipoMonitorFormulario() {
    return listarDefinicionesTiposMonitor()
      .filter((definicion) => definicion.capacidades?.creableDesdePortal !== false)
      .map((definicion) => ({
        valor: definicion.valor,
        etiqueta: definicion.etiqueta,
        descripcion: definicion.descripcion,
        icono: definicion.icono,
        claseCss: definicion.claseCss || definicion.valor,
        familiaOperativa: definicion.familiaOperativa,
        capacidades: definicion.capacidades
      }));
  }

  construirOpcionesTipoMonitorFiltro() {
    return [
      { valor: '', etiqueta: 'Todos' },
      ...listarDefinicionesTiposMonitor().map((definicion) => ({
        valor: definicion.valor,
        etiqueta: definicion.etiqueta,
        descripcion: definicion.descripcion,
        icono: definicion.icono,
        claseCss: definicion.claseCss || definicion.valor,
        familiaOperativa: definicion.familiaOperativa
      }))
    ];
  }

  construirCatalogoTiposMonitorPortal() {
    return {
      fallback: {
        valor: 'base',
        etiqueta: 'Monitor',
        descripcion: 'Tipo de monitor persistido sin visual específica.',
        icono: 'hdd-network',
        claseCss: 'base'
      },
      tipos: listarDefinicionesTiposMonitor().map((definicion) => ({
        valor: definicion.valor,
        etiqueta: definicion.etiqueta,
        descripcion: definicion.descripcion,
        icono: definicion.icono,
        familiaOperativa: definicion.familiaOperativa,
        claseCss: definicion.claseCss || definicion.valor
      }))
    };
  }

  construirAlcanceActual(contextoUsuarioActual) {
    return {
      nivelScope: contextoUsuarioActual.nivelScope,
      descripcion: this.resolutorScopeUsuario.describirScope({
        tenantId: contextoUsuarioActual.tenantId,
        empresaId: contextoUsuarioActual.empresaId,
        sitioId: contextoUsuarioActual.sitioId
      })
    };
  }

  construirFormularioAltaPorDefecto(contextoUsuarioActual) {
    return this.enriquecerFormularioTecnico({
      id: null,
      nombre: '',
      tipo: 'ping',
      descripcion: '',
      interpretacionEstado: 'normal',
      descripcionFallo: '',
      posibleSolucion: '',
      activo: true,
      intervaloEjecucionSegundos: '60',
      desfaseInicialSegundos: '0',
      inferenciasIndisponibleConsecutivas: '1',
      inferenciasDisponibleConsecutivas: '1',
      entradaComposicionBooleana: false,
      tenantId: contextoUsuarioActual.tenantId ?? '',
      empresaId: contextoUsuarioActual.empresaId ?? '',
      sitioId: contextoUsuarioActual.sitioId ?? '',
      nivelPertenencia: contextoUsuarioActual.sitioId != null ? 'sitio' : 'empresa'
    });
  }

  construirFormularioDesdeMonitor(monitor, vinculoTelemetria = null) {
    const configuracionLogica = crearConfiguracionMonitorLogicoBase(
      monitor.configuracion || {}
    );
    const dependenciaPrincipal = configuracionLogica.dependencias
      .find((dependencia) => dependencia?.fuente === 'monitor') || null;

    return this.enriquecerFormularioTecnico({
      id: monitor.id,
      nombre: monitor.nombre,
      tipo: monitor.tipo,
      descripcion: monitor.descripcion || '',
      interpretacionEstado: monitor.interpretacionEstado || 'normal',
      descripcionFallo: monitor.descripcionFallo || '',
      posibleSolucion: monitor.posibleSolucion || '',
      activo: monitor.activo,
      intervaloEjecucionSegundos: monitor.intervaloEjecucionSegundos,
      desfaseInicialSegundos: monitor.desfaseInicialSegundos,
      inferenciasIndisponibleConsecutivas: monitor.inferenciasIndisponibleConsecutivas,
      inferenciasDisponibleConsecutivas: monitor.inferenciasDisponibleConsecutivas,
      entradaComposicionBooleana: monitor.entradaComposicionBooleana,
      tenantId: monitor.tenantId,
      empresaId: monitor.empresaId,
      sitioId: monitor.sitioId ?? '',
      nivelPertenencia: monitor.sitioId == null ? 'empresa' : 'sitio',
      host: monitor.configuracion?.host || '',
      timeoutMs: monitor.configuracion?.timeoutMs,
      reintentos: monitor.configuracion?.reintentos,
      tamanoPaqueteBytes: monitor.configuracion?.tamanoPaqueteBytes,
      ttl: monitor.configuracion?.ttl,
      puerto: monitor.configuracion?.puerto,
      usarTls: monitor.configuracion?.usarTls,
      vigenciaMinimaCertDias: monitor.configuracion?.vigenciaMinimaCertDias,
      expresionLogica: configuracionLogica.expresion,
      mensajeFalloLogico: configuracionLogica.mensajeFallo,
      estadoInicialLogico: configuracionLogica.estadoInicial,
      retardoSenalSegundosLogico: configuracionLogica.retardoSenalSegundos,
      dependenciaMonitorIdLogica: dependenciaPrincipal?.monitorId || '',
      dependenciasLogicas: JSON.stringify(
        configuracionLogica.dependencias || [],
        null,
        0
      ),
      layoutVisualLogico: JSON.stringify(
        configuracionLogica.layoutVisual || {},
        null,
        0
      ),
      agenteId: vinculoTelemetria?.agenteId || '',
      tipoFuente: vinculoTelemetria?.tipoFuente ||
        TIPOS_FUENTE_MONITOR_TELEMETRIA.SENAL_DIRECTA,
      senalId: vinculoTelemetria?.fuente?.senalId || '',
      reglaId: vinculoTelemetria?.fuente?.reglaId || '',
      proyeccionId: vinculoTelemetria?.fuente?.proyeccionId || '',
      tipoDato: vinculoTelemetria?.senalOrigen?.tipoDato || '',
      unidad: vinculoTelemetria?.senalOrigen?.unidad || '',
      minimo: monitor.configuracion?.condicion?.minimo ?? '',
      maximo: monitor.configuracion?.condicion?.maximo ?? '',
      operador: monitor.configuracion?.condicion?.operador ||
        OPERADORES_VALOR_ESPERADO_TELEMETRIA.IGUAL,
      valorEsperado:
        monitor.configuracion?.condicion?.valorEsperado == null
          ? ''
          : String(monitor.configuracion.condicion.valorEsperado),
      retardoFalloSegundos:
        monitor.configuracion?.retardoFalloSegundos ?? 0
    });
  }

  construirFormularioDesdeEntrada(contextoUsuarioActual, datos) {
    const formulario = {
      ...this.construirFormularioAltaPorDefecto(contextoUsuarioActual),
      id: datos.id ?? null,
      nombre: String(datos.nombre || '').trim(),
      tipo: String(datos.tipo || 'ping').trim().toLowerCase(),
      descripcion: String(datos.descripcion || '').trim(),
      interpretacionEstado: String(
        datos.interpretacion_estado ?? datos.interpretacionEstado ?? 'normal'
      ).trim(),
      descripcionFallo: String(
        datos.descripcion_fallo ?? datos.descripcionFallo ?? ''
      ).trim(),
      posibleSolucion: String(
        datos.posible_solucion ?? datos.posibleSolucion ?? ''
      ).trim(),
      activo:
        datos.activo == null || String(datos.activo).trim() === ''
          ? true
          : ['1', 'true', 'si', 'yes', 'on'].includes(
              String(datos.activo || '').toLowerCase()
            ),
      intervaloEjecucionSegundos: String(
        datos.intervalo_ejecucion_segundos || ''
      ).trim(),
      desfaseInicialSegundos: String(
        datos.desfase_inicial_segundos || ''
      ).trim(),
      inferenciasIndisponibleConsecutivas: String(
        datos.inferencias_indisponible_consecutivas ?? '1'
      ).trim(),
      inferenciasDisponibleConsecutivas: String(
        datos.inferencias_disponible_consecutivas ?? '1'
      ).trim(),
      entradaComposicionBooleana:
        String(datos.entrada_composicion_booleana ?? '0') === '1',
      tenantId: String(
        datos.tenant_id || contextoUsuarioActual?.tenantId || ''
      ).trim(),
      empresaId: String(
        datos.empresa_id || contextoUsuarioActual?.empresaId || ''
      ).trim(),
      sitioId: String(
        datos.sitio_id || contextoUsuarioActual?.sitioId || ''
      ).trim(),
      nivelPertenencia: this.resolverNivelPertenenciaSolicitada(
        contextoUsuarioActual?.nivelScope === 'sitio'
          ? 'sitio'
          : datos.nivel_pertenencia,
        datos.sitio_id || contextoUsuarioActual?.sitioId
      ),
      host: String(datos.host || '').trim(),
      timeoutMs: String(datos.timeout_ms || '').trim(),
      reintentos: String(datos.reintentos || '').trim(),
      tamanoPaqueteBytes: String(datos.tamano_paquete_bytes || '').trim(),
      ttl: String(datos.ttl || '').trim(),
      puerto: String(datos.puerto || '').trim(),
      usarTls: ['1', 'true', 'si', 'yes', 'on'].includes(
        String(datos.usar_tls || '').toLowerCase()
      ),
      vigenciaMinimaCertDias: String(
        datos.vigencia_minima_cert_dias || ''
      ).trim(),
      expresionLogica: String(datos.expresion_logica || '').trim(),
      mensajeFalloLogico: String(datos.mensaje_fallo_logico || '').trim(),
      estadoInicialLogico: String(datos.estado_inicial_logico || '').trim(),
      retardoSenalSegundosLogico: String(
        datos.retardo_senal_segundos_logico || ''
      ).trim(),
      dependenciaMonitorIdLogica: String(
        datos.dependencia_monitor_id_logica || ''
      ).trim(),
      dependenciasLogicas: String(datos.dependencias_logicas || '').trim(),
      layoutVisualLogico: String(datos.layout_visual_logico || '').trim(),
      agenteId: String(datos.telemetria_agente_id || '').trim(),
      tipoFuente: String(
        datos.telemetria_tipo_fuente ||
          TIPOS_FUENTE_MONITOR_TELEMETRIA.SENAL_DIRECTA
      ).trim().toLowerCase(),
      senalId: String(datos.telemetria_senal_id || '').trim(),
      reglaId: String(datos.telemetria_regla_id || '').trim(),
      proyeccionId: String(datos.telemetria_proyeccion_id || '').trim(),
      tipoDato: String(datos.telemetria_tipo_dato || '').trim().toLowerCase(),
      unidad: String(datos.telemetria_unidad || '').trim(),
      minimo: String(datos.telemetria_minimo || '').trim(),
      maximo: String(datos.telemetria_maximo || '').trim(),
      operador: String(datos.telemetria_operador || '').trim().toLowerCase(),
      valorEsperado: String(datos.telemetria_valor_esperado ?? '').trim(),
      retardoFalloSegundos: String(
        datos.telemetria_retardo_fallo_segundos || '0'
      ).trim()
    };

    return this.enriquecerFormularioTecnico(formulario);
  }

  enriquecerFormularioTecnico(formulario) {
    const tipoNormalizado = normalizarTipoMonitor(formulario.tipo);
    const tipo = existeTipoMonitor(tipoNormalizado) ? tipoNormalizado : 'ping';
    const defaults =
      CONFIGURACION_TIPO_FORMULARIO[tipo] || CONFIGURACION_TIPO_FORMULARIO.ping;

    return {
      ...formulario,
      tipo,
      nivelPertenencia: formulario.nivelPertenencia === 'sitio' ? 'sitio' : 'empresa',
      interpretacionEstado: normalizarInterpretacionEstadoMonitorPorTipo({
        tipo,
        valor: formulario.interpretacionEstado
      }),
      descripcionFallo: String(formulario.descripcionFallo || '').trim(),
      posibleSolucion: String(formulario.posibleSolucion || '').trim(),
      intervaloEjecucionSegundos: this.formatearValorFormularioNumero(
        formulario.intervaloEjecucionSegundos,
        defaults.intervaloEjecucionSegundos
      ),
      desfaseInicialSegundos: this.formatearValorFormularioNumero(
        formulario.desfaseInicialSegundos,
        defaults.desfaseInicialSegundos
      ),
      inferenciasIndisponibleConsecutivas: this.formatearValorFormularioNumero(
        formulario.inferenciasIndisponibleConsecutivas, '1'
      ),
      inferenciasDisponibleConsecutivas: this.formatearValorFormularioNumero(
        formulario.inferenciasDisponibleConsecutivas, '1'
      ),
      host: String(formulario.host ?? defaults.host).trim(),
      timeoutMs: this.formatearValorFormularioNumero(
        formulario.timeoutMs,
        defaults.timeoutMs
      ),
      reintentos: this.formatearValorFormularioNumero(
        formulario.reintentos,
        defaults.reintentos
      ),
      tamanoPaqueteBytes: this.formatearValorFormularioNumero(
        formulario.tamanoPaqueteBytes,
        defaults.tamanoPaqueteBytes
      ),
      ttl: this.formatearValorFormularioNumero(formulario.ttl, defaults.ttl),
      puerto: this.formatearValorFormularioNumero(
        formulario.puerto,
        defaults.puerto
      ),
      usarTls: Boolean(formulario.usarTls),
      vigenciaMinimaCertDias: this.formatearValorFormularioNumero(
        formulario.vigenciaMinimaCertDias,
        defaults.vigenciaMinimaCertDias
      ),
      expresionLogica: String(
        formulario.expresionLogica ??
          defaults.configuracionLogica?.expresion ??
          ''
      ).trim(),
      mensajeFalloLogico: String(
        formulario.mensajeFalloLogico ??
          defaults.configuracionLogica?.mensajeFallo ??
          ''
      ).trim(),
      estadoInicialLogico: String(
        formulario.estadoInicialLogico ||
          defaults.configuracionLogica?.estadoInicial ||
          'disponible'
      ).trim().toLowerCase(),
      retardoSenalSegundosLogico: this.formatearValorFormularioNumero(
        formulario.retardoSenalSegundosLogico,
        defaults.configuracionLogica?.retardoSenalSegundos ?? 0
      ),
      dependenciaMonitorIdLogica: this.formatearValorFormularioNumero(
        formulario.dependenciaMonitorIdLogica,
        ''
      ),
      dependenciasLogicas: String(
        formulario.dependenciasLogicas ??
          JSON.stringify(defaults.configuracionLogica?.dependencias || [], null, 0)
      ).trim(),
      layoutVisualLogico: String(
        formulario.layoutVisualLogico ??
          JSON.stringify(
            defaults.configuracionLogica?.layoutVisual || {},
            null,
            0
          )
      ).trim(),
      agenteId: this.formatearValorFormularioNumero(
        formulario.agenteId,
        defaults.agenteId ?? ''
      ),
      tipoFuente: String(
        formulario.tipoFuente || defaults.tipoFuente ||
          TIPOS_FUENTE_MONITOR_TELEMETRIA.SENAL_DIRECTA
      ).trim().toLowerCase(),
      senalId: this.formatearValorFormularioNumero(
        formulario.senalId,
        defaults.senalId ?? ''
      ),
      reglaId: this.formatearValorFormularioNumero(
        formulario.reglaId,
        defaults.reglaId ?? ''
      ),
      proyeccionId: String(
        formulario.proyeccionId ?? defaults.proyeccionId ?? ''
      ).trim(),
      tipoDato: String(formulario.tipoDato || defaults.tipoDato || '')
        .trim()
        .toLowerCase(),
      unidad: String(formulario.unidad ?? defaults.unidad ?? '').trim(),
      minimo: String(formulario.minimo ?? defaults.minimo ?? '').trim(),
      maximo: String(formulario.maximo ?? defaults.maximo ?? '').trim(),
      operador: String(
        formulario.operador || defaults.operador ||
          OPERADORES_VALOR_ESPERADO_TELEMETRIA.IGUAL
      ).trim().toLowerCase(),
      valorEsperado: String(
        formulario.valorEsperado ?? defaults.valorEsperado ?? ''
      ).trim(),
      retardoFalloSegundos: this.formatearValorFormularioNumero(
        formulario.retardoFalloSegundos,
        defaults.retardoFalloSegundos ?? 0
      )
    };
  }

  construirConfiguracionLogicaDesdeEntrada(datos) {
    const dependenciaMonitorId = String(
      datos.dependencia_monitor_id_logica || ''
    ).trim();
    const dependencias = this.parsearDependenciasLogicasDesdeEntrada(
      datos.dependencias_logicas,
      dependenciaMonitorId
    );

    return {
      expresion: String(datos.expresion_logica || '').trim(),
      mensajeFallo: String(datos.mensaje_fallo_logico || '').trim(),
      estadoInicial: String(datos.estado_inicial_logico || '').trim(),
      retardoSenalSegundos: String(
        datos.retardo_senal_segundos_logico || ''
      ).trim(),
      layoutVisual: this.parsearLayoutVisualMonitorLogico(
        datos.layout_visual_logico
      ),
      dependencias
    };
  }

  parsearDependenciasLogicasDesdeEntrada(valor, dependenciaMonitorIdLegacy = '') {
    const texto = String(valor || '').trim();

    if (!texto) {
      return dependenciaMonitorIdLegacy
        ? [
            {
              variable: 'A',
              fuente: 'monitor',
              monitorId: dependenciaMonitorIdLegacy,
              etiqueta: 'Entrada A'
            }
          ]
        : [];
    }

    try {
      const dependencias = JSON.parse(texto);

      if (!Array.isArray(dependencias)) {
        throw new Error('no_array');
      }

      return dependencias
        .map((dependencia, indice) => {
          const variable = String(
            dependencia?.variable || String.fromCharCode(65 + indice)
          ).trim().toUpperCase();
          const fuente = String(dependencia?.fuente || 'monitor')
            .trim().toLowerCase();
          const monitorId = String(
            dependencia?.monitorId ?? dependencia?.monitor_id ?? ''
          ).trim();
          const proyeccionId = String(
            dependencia?.proyeccionId ?? dependencia?.proyeccion_id ?? ''
          ).trim();
          if (fuente === FUENTE_MONITOR_FEDERADO) {
            return {
              variable,
              fuente,
              proyeccionId,
              estadoInicial: dependencia?.estadoInicial,
              inversion: dependencia?.inversion,
              politicaPerdidaEnFallo: dependencia?.politicaPerdidaEnFallo,
              politicaPerdidaEnCorrecto: dependencia?.politicaPerdidaEnCorrecto,
              etiqueta: String(
                dependencia?.etiqueta || dependencia?.nombre || `Entrada ${variable}`
              ).trim()
            };
          }
          return {
            variable,
            fuente,
            monitorId,
            etiqueta: String(
              dependencia?.etiqueta || dependencia?.nombre || `Entrada ${variable}`
            ).trim()
          };
        })
        .filter(Boolean);
    } catch (_error) {
      throw new Error(
        'Las dependencias lógicas deben enviarse como JSON válido.'
      );
    }
  }

  parsearLayoutVisualMonitorLogico(valor) {
    const texto = String(valor || '').trim();

    if (!texto) {
      return {};
    }

    try {
      const layout = JSON.parse(texto);
      return layout && typeof layout === 'object' ? layout : {};
    } catch (_error) {
      return {};
    }
  }

  construirOpcionesPertenencia(contextoUsuarioActual) {
    const restricciones = this.construirRestriccionesScope(contextoUsuarioActual);
    return OPCIONES_PERTENENCIA.filter((opcion) => {
      if (!restricciones.nivelPertenenciaFijo) {
        return true;
      }

      return opcion.valor === restricciones.nivelPertenenciaFijo;
    });
  }

  construirRestriccionesScope(contextoUsuarioActual, formulario = null) {
    const contexto = contextoUsuarioActual || {};
    const nivelPertenencia = formulario?.nivelPertenencia === 'sitio'
      ? 'sitio'
      : 'empresa';

    if (contexto.nivelScope === 'portal') {
      return {
        tenantBloqueado: false,
        empresaBloqueada: false,
        sitioBloqueadoPorScope: false,
        sitioBloqueadoPorPertenencia: nivelPertenencia !== 'sitio',
        nivelPertenenciaFijo: null
      };
    }

    if (contexto.nivelScope === 'tenant') {
      return {
        tenantBloqueado: true,
        empresaBloqueada: false,
        sitioBloqueadoPorScope: false,
        sitioBloqueadoPorPertenencia: nivelPertenencia !== 'sitio',
        nivelPertenenciaFijo: null
      };
    }

    if (contexto.nivelScope === 'empresa') {
      return {
        tenantBloqueado: true,
        empresaBloqueada: true,
        sitioBloqueadoPorScope: false,
        sitioBloqueadoPorPertenencia: nivelPertenencia !== 'sitio',
        nivelPertenenciaFijo: null
      };
    }

    if (contexto.nivelScope === 'sitio') {
      return {
        tenantBloqueado: true,
        empresaBloqueada: true,
        sitioBloqueadoPorScope: true,
        sitioBloqueadoPorPertenencia: false,
        nivelPertenenciaFijo: 'sitio'
      };
    }

    return {
      tenantBloqueado: false,
      empresaBloqueada: false,
      sitioBloqueadoPorScope: false,
      sitioBloqueadoPorPertenencia: nivelPertenencia !== 'sitio',
      nivelPertenenciaFijo: null
    };
  }

  resolverNivelPertenenciaSolicitada(nivelPertenencia, sitioId) {
    const normalizado = String(nivelPertenencia || '').trim().toLowerCase();

    if (normalizado === 'sitio') {
      return 'sitio';
    }

    if (normalizado === 'empresa') {
      return 'empresa';
    }

    return String(sitioId || '').trim() === '' ? 'empresa' : 'sitio';
  }

  validarPertenenciaSegunScope(
    contextoUsuarioActual,
    definicion,
    nivelPertenencia
  ) {
    if (nivelPertenencia === 'sitio' && definicion.sitioId == null) {
      throw new Error('Debes seleccionar un sitio cuando la pertenencia sea de sitio.');
    }

    if (nivelPertenencia === 'empresa') {
      definicion.sitioId = null;
    }

    if (contextoUsuarioActual?.nivelScope === 'tenant') {
      if (Number(definicion.tenantId) !== Number(contextoUsuarioActual.tenantId)) {
        throw new Error('Tu alcance solo permite trabajar con monitores de tu tenant.');
      }
    }

    if (contextoUsuarioActual?.nivelScope === 'empresa') {
      if (Number(definicion.tenantId) !== Number(contextoUsuarioActual.tenantId)) {
        throw new Error('Tu alcance solo permite trabajar con monitores de tu tenant.');
      }

      if (Number(definicion.empresaId) !== Number(contextoUsuarioActual.empresaId)) {
        throw new Error('Tu alcance solo permite trabajar con monitores de tu empresa.');
      }
    }

    if (contextoUsuarioActual?.nivelScope === 'sitio') {
      if (nivelPertenencia !== 'sitio') {
        throw new Error('Un usuario acotado a sitio solo puede crear o editar monitores de su propio sitio.');
      }

      if (Number(definicion.tenantId) !== Number(contextoUsuarioActual.tenantId)) {
        throw new Error('Tu alcance solo permite trabajar con monitores de tu tenant.');
      }

      if (Number(definicion.empresaId) !== Number(contextoUsuarioActual.empresaId)) {
        throw new Error('Tu alcance solo permite trabajar con monitores de tu empresa.');
      }

      if (Number(definicion.sitioId) !== Number(contextoUsuarioActual.sitioId)) {
        throw new Error('Tu alcance solo permite trabajar con monitores de tu sitio.');
      }
    }
  }

  formatearValorFormularioNumero(valor, porDefecto) {
    const normalizado = String(valor ?? '').trim();
    return normalizado || String(porDefecto ?? '');
  }

  formatearNumeroDecimal(valor, porDefecto = '0.0') {
    if (valor == null || !Number.isFinite(Number(valor))) {
      return porDefecto;
    }

    return Number(valor).toFixed(1);
  }

  formatearRango(minimo, maximo, sufijo = '') {
    if (minimo == null && maximo == null) {
      return 'Sin datos';
    }

    const unidad = sufijo ? ` ${sufijo}` : '';

    if (minimo != null && maximo != null) {
      if (Number(minimo) === Number(maximo)) {
        return `${minimo}${unidad}`;
      }

      return `${minimo}-${maximo}${unidad}`;
    }

    if (minimo != null) {
      return `Desde ${minimo}${unidad}`;
    }

    return `Hasta ${maximo}${unidad}`;
  }

  formatearDetalleRango(minimo, maximo, sufijo = '') {
    const rango = this.formatearRango(minimo, maximo, sufijo);
    return rango === 'Sin datos' ? rango : `Rango ${rango}`;
  }

  formatearDuracionEntreFechas(desdeUtc, hastaUtc) {
    const desdeMs = Date.parse(String(desdeUtc || ''));
    const hastaMs = Date.parse(String(hastaUtc || ''));

    if (Number.isNaN(desdeMs) || Number.isNaN(hastaMs) || hastaMs < desdeMs) {
      return 'Sin duración calculable';
    }

    const totalSegundos = Math.floor((hastaMs - desdeMs) / 1000);

    if (totalSegundos < 60) {
      return `${totalSegundos} s`;
    }

    const totalMinutos = Math.floor(totalSegundos / 60);

    if (totalMinutos < 60) {
      const segundosResto = totalSegundos % 60;
      return segundosResto > 0
        ? `${totalMinutos} min ${segundosResto} s`
        : `${totalMinutos} min`;
    }

    const totalHoras = Math.floor(totalMinutos / 60);
    const minutosResto = totalMinutos % 60;

    if (totalHoras < 24) {
      return minutosResto > 0
        ? `${totalHoras} h ${minutosResto} min`
        : `${totalHoras} h`;
    }

    const totalDias = Math.floor(totalHoras / 24);
    const horasResto = totalHoras % 24;

    return horasResto > 0
      ? `${totalDias} d ${horasResto} h`
      : `${totalDias} d`;
  }

  formatearFechaInput(valorUtc) {
    const fecha = new Date(String(valorUtc || ''));

    if (Number.isNaN(fecha.getTime())) {
      return '';
    }

    return fecha.toISOString().slice(0, 10);
  }

  formatearFechaHoraInput(valorUtc) {
    const fecha = new Date(String(valorUtc || ''));

    if (Number.isNaN(fecha.getTime())) {
      return '';
    }

    const ano = fecha.getFullYear();
    const mes = String(fecha.getMonth() + 1).padStart(2, '0');
    const dia = String(fecha.getDate()).padStart(2, '0');
    const hora = String(fecha.getHours()).padStart(2, '0');
    const minuto = String(fecha.getMinutes()).padStart(2, '0');

    return `${ano}-${mes}-${dia}T${hora}:${minuto}`;
  }

  construirResumenResultadoTecnico({
    estadoDetectado,
    codigoResultado,
    mensajeResultado,
    interpretacionEstado = 'normal',
    estadoTecnicoDetectado = null,
    codigoResultadoTecnico = null,
    mensajeResultadoTecnico = null,
    interpretacionResultado = null,
    metricaPrincipal = null
  }) {
    const estado = String(estadoDetectado || 'desconocido').trim().toLowerCase();
    const codigo = String(codigoResultado || 'sin_resultado').trim().toLowerCase();
    const diasRestantes = Number.isFinite(
      Number(metricaPrincipal?.certificadoDiasRestantes)
    )
      ? Number(metricaPrincipal.certificadoDiasRestantes)
      : null;
    const minimoDias = Number.isFinite(
      Number(metricaPrincipal?.certificadoVigenciaMinimaDias)
    )
      ? Number(metricaPrincipal.certificadoVigenciaMinimaDias)
      : null;
    const interpretacion = {
      aplicada: Boolean(interpretacionResultado?.aplicada),
      interpretacionEstado,
      estadoTecnicoDetectado,
      codigoResultadoTecnico,
      mensajeResultadoTecnico,
      mensajeInterpretacion: interpretacionResultado?.mensajeInterpretacion || null
    };

    if (codigo === 'fallo_por_respuesta') {
      return {
        tono: 'error',
        etiquetaEstado: 'Indisponible',
        etiquetaTecnica: 'Falló porque respondió',
        detalle:
          interpretacion.mensajeInterpretacion ||
          mensajeResultado ||
          'Falló porque respondió.',
        interpretacion
      };
    }

    if (codigo === 'ausencia_respuesta_esperada') {
      return {
        tono: 'ok',
        etiquetaEstado: 'Disponible',
        etiquetaTecnica: 'Ausencia esperada',
        detalle:
          interpretacion.mensajeInterpretacion ||
          mensajeResultado ||
          'La ausencia de respuesta cumple la condición esperada.',
        interpretacion
      };
    }

    if (codigo === 'tls_vigencia_insuficiente') {
      return {
        tono: 'alerta',
        etiquetaEstado: 'Vigencia insuficiente',
        etiquetaTecnica:
          diasRestantes == null ? 'TLS con margen insuficiente' : `Caduca en ${diasRestantes} días`,
        detalle:
          mensajeResultado || 'El certificado no cumple la vigencia mínima exigida.',
        interpretacion
      };
    }

    if (codigo === 'tls_vigencia_indeterminada') {
      return {
        tono: 'advertencia',
        etiquetaEstado: 'Vigencia indeterminada',
        etiquetaTecnica: 'TLS sin fecha usable',
        detalle:
          mensajeResultado || 'No se pudo calcular la vigencia restante del certificado.',
        interpretacion
      };
    }

    if (codigo === 'tls_no_autorizado') {
      return {
        tono: 'error',
        etiquetaEstado: 'TLS no autorizado',
        etiquetaTecnica: 'Certificado no confiable',
        detalle:
          mensajeResultado || 'El endpoint respondió por TLS, pero no superó la validación.',
        interpretacion
      };
    }

    if (codigo === 'conexion_tls_ok' && diasRestantes != null) {
      const detalleMargen = minimoDias != null && minimoDias > 0
        ? ` · mínimo ${minimoDias} días`
        : '';

      return {
        tono: estado === 'disponible' ? 'ok' : 'advertencia',
        etiquetaEstado: estado === 'disponible' ? 'TLS válido' : 'TLS revisado',
        etiquetaTecnica: `Caduca en ${diasRestantes} días`,
        detalle: `Certificado confiable${detalleMargen}.`,
        interpretacion
      };
    }

    return {
      tono:
        estado === 'disponible'
          ? 'ok'
          : (codigo.includes('timeout') ? 'advertencia' : 'error'),
      etiquetaEstado: estado === 'disponible' ? 'Disponible' : 'Indisponible',
      etiquetaTecnica: codigo || 'sin_resultado',
      detalle: mensajeResultado || 'Sin detalle operativo adicional.',
      interpretacion
    };
  }

  puedeAlcanzarMonitor(contextoUsuarioActual, monitor) {
    // El catálogo de una sesión de sitio contiene solo monitores de ese sitio.
    if (contextoUsuarioActual?.nivelScope === 'sitio' && monitor.sitioId == null) {
      return false;
    }
    if (monitor.sitioId != null) {
      return this.resolutorScopeUsuario.puedeAlcanzarSitio(
        contextoUsuarioActual,
        monitor.sitioId,
        monitor.empresaId,
        monitor.tenantId
      );
    }

    return this.puedeAlcanzarEmpresa(
      contextoUsuarioActual,
      monitor.empresaId,
      monitor.tenantId
    );
  }

  puedeAlcanzarEmpresa(contextoUsuarioActual, empresaId, tenantId) {
    return this.resolutorScopeUsuario.puedeAlcanzarEmpresa(
      contextoUsuarioActual,
      empresaId,
      tenantId
    );
  }

  normalizarIdOpcional(valor) {
    if (valor === undefined || valor === null || String(valor).trim() === '') {
      return null;
    }

    const convertido = Number.parseInt(String(valor), 10);
    return Number.isInteger(convertido) && convertido > 0 ? convertido : null;
  }

  normalizarIdsComparacion(valores) {
    const lista = Array.isArray(valores) ? valores : [valores];
    const ids = [];

    for (const valor of lista) {
      const fragmentos = String(valor || '')
        .split(',')
        .map((fragmento) => fragmento.trim())
        .filter(Boolean);

      for (const fragmento of fragmentos) {
        const id = this.normalizarIdOpcional(fragmento);

        if (id == null || ids.includes(id)) {
          continue;
        }

        ids.push(id);

        if (ids.length >= 3) {
          return ids;
        }
      }
    }

    return ids;
  }

  normalizarTipoFiltro(valor) {
    const normalizado = normalizarTipoMonitor(valor);
    return existeTipoMonitor(normalizado) ? normalizado : null;
  }

  normalizarNivelPertenenciaFiltro(valor) {
    const normalizado = String(valor || '').trim().toLowerCase();
    return ['empresa', 'sitio'].includes(normalizado) ? normalizado : null;
  }

  normalizarFiltroActivo(valor) {
    const normalizado = String(valor || '').trim().toLowerCase();
    return ['solo_activos', 'solo_inactivos', 'todos'].includes(normalizado)
      ? normalizado
      : 'todos';
  }

  normalizarTamanoPaginaListado(valor) {
    const tamano = Number.parseInt(String(valor), 10);

    if (!Number.isInteger(tamano) || tamano <= 0) {
      return 10;
    }

    return Math.min(tamano, 100);
  }

  normalizarOrdenListado(valor) {
    const normalizado = String(valor || '').trim().toLowerCase();
    return [
      'id',
      'nombre',
      'tipo',
      'tenant',
      'empresa',
      'sitio',
      'ubicacion',
      'activo',
      'intervalo',
      'desfase',
      'creado',
      'actualizado'
    ].includes(normalizado)
      ? normalizado
      : 'nombre';
  }

  normalizarOrdenHistorico(valor) {
    const normalizado = String(valor || '').trim().toLowerCase();
    return [
      'id',
      'monitor',
      'tipo',
      'estado',
      'codigo',
      'valido_desde',
      'valido_hasta',
      'repeticiones',
      'creado',
      'actualizado'
    ].includes(normalizado)
      ? normalizado
      : 'valido_hasta';
  }

  normalizarDireccionListado(valor) {
    return String(valor || '').trim().toLowerCase() === 'desc'
      ? 'desc'
      : 'asc';
  }

  normalizarRangoEventos({ desde = null, hasta = null } = {}) {
    const ahora = new Date();
    const hastaNormalizada = this.normalizarFechaFiltroEvento(hasta, {
      finDelDia: true
    }) || ahora.toISOString();
    const desdeNormalizada = this.normalizarFechaFiltroEvento(desde, {
      finDelDia: false
    }) || new Date(Date.parse(hastaNormalizada) - (7 * 86400000)).toISOString();

    if (Date.parse(desdeNormalizada) > Date.parse(hastaNormalizada)) {
      throw new Error('La fecha inicial no puede ser posterior a la final.');
    }

    return {
      desdeUtc: desdeNormalizada,
      hastaUtc: hastaNormalizada
    };
  }

  normalizarFechaFiltroEvento(valor, { finDelDia = false } = {}) {
    const texto = String(valor || '').trim();

    if (!texto) {
      return null;
    }

    if (/^\d{4}-\d{2}-\d{2}$/.test(texto)) {
      return finDelDia
        ? `${texto}T23:59:59.999Z`
        : `${texto}T00:00:00.000Z`;
    }

    const fecha = new Date(texto);

    if (Number.isNaN(fecha.getTime())) {
      throw new Error(`Fecha inválida: ${texto}.`);
    }

    return fecha.toISOString();
  }

  normalizarEstadoEvento(valor) {
    const normalizado = String(valor || '').trim().toLowerCase();
    return ['disponible', 'indisponible', 'degradado', 'desconocido'].includes(
      normalizado
    )
      ? normalizado
      : null;
  }

  normalizarTextoFiltro(valor, maxLongitud = 80) {
    const normalizado = String(valor || '').trim();
    return normalizado ? normalizado.slice(0, maxLongitud) : null;
  }

  normalizarOrdenTemporal(valor) {
    return String(valor || '').trim().toLowerCase() === 'desc'
      ? 'desc'
      : 'asc';
  }

  normalizarLimiteActividad(valor, porDefecto = 15, maximo = 50) {
    const convertido = Number.parseInt(String(valor ?? ''), 10);

    if (!Number.isInteger(convertido) || convertido <= 0) {
      return porDefecto;
    }

    return Math.min(maximo, convertido);
  }
}

function fotografiaMonitorAuditable(monitor) {
  return {
    nombre: monitor.nombre,
    tipo: monitor.tipo,
    descripcion: monitor.descripcion ?? null,
    activo: Boolean(monitor.activo),
    intervaloSegundos: Number(monitor.intervaloEjecucionSegundos),
    inferenciasIndisponibleConsecutivas: Number(monitor.inferenciasIndisponibleConsecutivas || 1),
    inferenciasDisponibleConsecutivas: Number(monitor.inferenciasDisponibleConsecutivas || 1),
    entradaComposicionBooleana: Boolean(monitor.entradaComposicionBooleana),
    interpretacionEstado: monitor.interpretacionEstado,
    motivoFallo: monitor.descripcionFallo || '',
    posibleSolucion: monitor.posibleSolucion || '',
    configuracion: configuracionMonitorAuditable(monitor),
    tenantId: String(monitor.tenantId),
    empresaId: String(monitor.empresaId),
    sitioId: monitor.sitioId == null ? null : String(monitor.sitioId)
  };
}

function fotografiaDefinicionMonitorAuditable(definicion) {
  return {
    nombre: definicion.nombre,
    tipo: definicion.tipo,
    descripcion: definicion.descripcion ?? null,
    activo: Boolean(definicion.activo),
    intervaloSegundos: Number(definicion.intervaloEjecucionSegundos),
    inferenciasIndisponibleConsecutivas: Number(definicion.inferenciasIndisponibleConsecutivas || 1),
    inferenciasDisponibleConsecutivas: Number(definicion.inferenciasDisponibleConsecutivas || 1),
    entradaComposicionBooleana: Boolean(definicion.entradaComposicionBooleana),
    interpretacionEstado: definicion.interpretacionEstado,
    motivoFallo: definicion.descripcionFallo || '',
    posibleSolucion: definicion.posibleSolucion || '',
    configuracion: configuracionMonitorAuditable(definicion),
    tenantId: String(definicion.tenantId),
    empresaId: String(definicion.empresaId),
    sitioId: definicion.sitioId == null ? null : String(definicion.sitioId)
  };
}

function configuracionMonitorAuditable(monitorODefinicion) {
  const configuracion = clonarJson(monitorODefinicion.configuracion || {});
  const segura = {};
  const clavesBase = [
    'host',
    'puerto',
    'timeoutMs',
    'reintentos',
    'tamanoPaqueteBytes',
    'ttl',
    'usarTls',
    'vigenciaMinimaCertDias',
    'version',
    'retardoFalloSegundos',
    'condicion'
  ];
  const clavesLogicas = [
    'expresion',
    'variables',
    'variablesUsadas',
    'dependencias',
    'mensajeFallo',
    'estadoInicial',
    'retardoSenalSegundos',
    'politicaEntradasIncompletas',
    'layoutVisual'
  ];
  const clavesAuditables = monitorODefinicion.tipo === 'booleano'
    ? [...clavesBase, ...clavesLogicas]
    : clavesBase;

  for (const clave of clavesAuditables) {
    if (Object.hasOwn(configuracion, clave)) {
      segura[clave] = normalizarValorConfiguracionMonitorAuditable(
        clave,
        configuracion[clave]
      );
    }
  }
  return segura;
}

function normalizarValorConfiguracionMonitorAuditable(clave, valor) {
  if (clave === 'dependencias') {
    return dependenciasLogicasAuditables(valor);
  }

  if (clave === 'layoutVisual') {
    return layoutVisualLogicoAuditable(valor);
  }

  return valor;
}

function dependenciasLogicasAuditables(dependencias) {
  return Array.isArray(dependencias)
    ? dependencias.map((dependencia) => dependenciaLogicaAuditable(dependencia))
    : [];
}

function dependenciaLogicaAuditable(dependencia) {
  const segura = {};
  for (const clave of [
    'variable','fuente','monitorId','proyeccionId','referencia','etiqueta',
    'estadoInicial','inversion','politicaPerdidaEnFallo',
    'politicaPerdidaEnCorrecto'
  ]) {
    if (Object.hasOwn(dependencia || {}, clave)) {
      segura[clave] = dependencia[clave];
    }
  }
  return segura;
}

function layoutVisualLogicoAuditable(layout) {
  if (!layout || typeof layout !== 'object') {
    return {
      version: 1,
      nodos: [],
      conexiones: [],
      grafoLogico: null
    };
  }

  return {
    version: Number(layout.version || 1),
    nodos: nodosLogicosAuditables(layout.nodos),
    conexiones: conexionesLogicasAuditables(layout.conexiones),
    grafoLogico: grafoLogicoAuditable(layout.grafoLogico)
  };
}

function grafoLogicoAuditable(grafo) {
  if (!grafo || typeof grafo !== 'object') {
    return null;
  }

  return {
    version: Number(grafo.version || 1),
    nodos: nodosLogicosAuditables(grafo.nodos),
    conexiones: conexionesLogicasAuditables(grafo.conexiones),
    salidaId: grafo.salidaId == null ? null : String(grafo.salidaId),
    expresionCompilada: grafo.expresionCompilada == null
      ? null
      : String(grafo.expresionCompilada),
    variablesUsadas: Array.isArray(grafo.variablesUsadas)
      ? grafo.variablesUsadas.map((variable) => String(variable))
      : [],
    valido: Boolean(grafo.valido),
    errores: Array.isArray(grafo.errores)
      ? grafo.errores.map((error) => String(error))
      : []
  };
}

function nodosLogicosAuditables(nodos) {
  return Array.isArray(nodos)
    ? nodos.map((nodo) => nodoLogicoAuditable(nodo))
    : [];
}

function nodoLogicoAuditable(nodo) {
  const segura = {};
  for (const clave of ['id', 'tipo', 'etiqueta', 'variable', 'x', 'y', 'puertos']) {
    if (Object.hasOwn(nodo || {}, clave)) {
      if (clave === 'puertos') {
        segura[clave] = puertosNodoLogicoAuditables(nodo[clave]);
      } else if (clave === 'x' || clave === 'y') {
        segura[clave] = coordenadaNodoLogicoAuditable(nodo[clave]);
      } else {
        segura[clave] = nodo[clave];
      }
    }
  }
  return segura;
}

function coordenadaNodoLogicoAuditable(valor) {
  const numero = Number(valor);
  if (!Number.isFinite(numero)) {
    return null;
  }
  return Number.isSafeInteger(numero) ? numero : String(numero);
}

function puertosNodoLogicoAuditables(puertos) {
  if (!puertos || typeof puertos !== 'object') {
    return { entrada: [], salida: [] };
  }

  return {
    entrada: Array.isArray(puertos.entrada)
      ? puertos.entrada.map((puerto) => String(puerto))
      : [],
    salida: Array.isArray(puertos.salida)
      ? puertos.salida.map((puerto) => String(puerto))
      : []
  };
}

function conexionesLogicasAuditables(conexiones) {
  return Array.isArray(conexiones)
    ? conexiones.map((conexion) => conexionLogicaAuditable(conexion))
    : [];
}

function conexionLogicaAuditable(conexion) {
  const segura = {};
  for (const clave of ['desde', 'hasta', 'puertoDesde', 'puertoHasta']) {
    if (Object.hasOwn(conexion || {}, clave)) {
      segura[clave] = conexion[clave];
    }
  }
  return segura;
}

function calcularCamposCambiadosMonitor(antes, despues) {
  return Object.keys(despues)
    .filter((campo) => !jsonEquivalente(antes[campo], despues[campo]))
    .sort(compararUtf8);
}

function filtrarFotografiaPorCampos(fotografia, campos) {
  return Object.fromEntries(campos.map((campo) => [campo, fotografia[campo]]));
}

function scopeMonitorCambio(antes, despues) {
  return ['tenantId', 'empresaId', 'sitioId'].some(
    (campo) => antes[campo] !== despues[campo]
  );
}

function scopeDesdeMonitor(monitor) {
  return {
    tenantId: String(monitor.tenantId),
    empresaId: String(monitor.empresaId),
    sitioId: monitor.sitioId == null ? null : String(monitor.sitioId)
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

function jsonEquivalente(a, b) {
  return JSON.stringify(normalizarJson(a)) === JSON.stringify(normalizarJson(b));
}

function normalizarJson(valor) {
  if (Array.isArray(valor)) {
    return valor.map(normalizarJson);
  }
  if (valor && typeof valor === 'object') {
    return Object.fromEntries(
      Object.entries(valor)
        .sort(([a], [b]) => compararUtf8(a, b))
        .map(([clave, hijo]) => [clave, normalizarJson(hijo)])
    );
  }
  return valor;
}

function clonarJson(valor) {
  return valor == null ? valor : JSON.parse(JSON.stringify(valor));
}

function compararUtf8(a, b) {
  return Buffer.compare(Buffer.from(a, 'utf8'), Buffer.from(b, 'utf8'));
}

import { TIPOS_TRIGGER } from '../../../../paquetes/triggers/src/CatalogoTiposTrigger.js';
import {
  ASUNTO_PLANTILLA_TRIGGER_CORREO_POR_DEFECTO,
  VERSION_CONFIGURACION_TRIGGER_CORREO
} from '../../../../paquetes/triggers/src/ConfiguracionTriggerCorreo.js';
import { previsualizarTriggerCorreo }
  from '../../../../paquetes/correo/src/PrevisualizadorTriggerCorreo.js';
import { ValidadorRegistroDns }
  from '../../../../paquetes/dns/src/ValidadorRegistroDns.js';

const validadorRegistroDns = new ValidadorRegistroDns();

const PRESENTACION_TIPO_TRIGGER = {
  api: {
    valor: 'api',
    etiqueta: 'API saliente',
    etiquetaTipo: 'API',
    descripcion:
      'Envía una solicitud HTTP/HTTPS a un servicio externo cuando la activa un monitor vinculado.',
    ayudaFormulario:
      'El bloque técnico cambia por tipo. `API` define URL, método, timeout, reintentos, parámetro opcional y payload opcional.',
    metodosHttp: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE']
  },
  dns: {
    valor: 'dns',
    etiqueta: 'DNS gobernado',
    etiquetaTipo: 'DNS',
    descripcion:
      'Cambia el valor o el estado de un registro DNS cuando se activa desde un monitor.',
    ayudaFormulario:
      'El bloque DNS apunta a zona y registro concretos. Solo puede tocar valor principal y activo; nunca tipo, TTL, zona ni scope.'
  },
  correo: {
    valor: 'correo',
    etiqueta: 'Correo electrónico',
    etiquetaTipo: 'Correo',
    descripcion:
      'Envía avisos a los destinatarios de esta acción cuando cambia el estado de un monitor vinculado.',
    ayudaFormulario:
      'Configura el mensaje y sus destinatarios; podrás revisar un ejemplo antes de guardar.'
  }
};

const DEFINICIONES_TIPO_TRIGGER = Object.freeze(Object.fromEntries(
  TIPOS_TRIGGER.map((tipo) => [
    tipo,
    Object.freeze(PRESENTACION_TIPO_TRIGGER[tipo])
  ])
));

const EVENTOS_DISPARO_VINCULO = Object.freeze([
  {
    valor: 'apertura_alerta',
    etiqueta: 'Apertura de alerta',
    descripcion: 'Dispara el trigger cuando el monitor entra en alerta activa.'
  },
  {
    valor: 'cierre_alerta',
    etiqueta: 'Cierre de alerta',
    descripcion: 'Dispara el trigger cuando la alerta activa se resuelve.'
  }
]);

const PROFUNDIDAD_SCOPE = Object.freeze({
  portal: 0,
  tenant: 1,
  empresa: 2,
  sitio: 3
});

function normalizarBooleano(valor, porDefecto = false) {
  if (valor === undefined || valor === null || valor === '') {
    return porDefecto;
  }

  if (typeof valor === 'boolean') {
    return valor;
  }

  return ['1', 'true', 'si', 'yes', 'on'].includes(
    String(valor).trim().toLowerCase()
  );
}

function serializarJsonBonito(valor) {
  if (!valor || typeof valor !== 'object' || Array.isArray(valor)) {
    return '';
  }

  const claves = Object.keys(valor);
  return claves.length > 0 ? JSON.stringify(valor, null, 2) : '';
}

export class ServicioAdministracionTriggersPortal {
  constructor({
    repositorioTriggers = null,
    repositorioAsignacionesTriggerMonitor = null,
    repositorioMonitores = null,
    repositorioZonasDns = null,
    repositorioRegistrosDns = null,
    repositorioTenants = null,
    repositorioEmpresas = null,
    repositorioSitios = null,
    resolutorScopeUsuario = null,
    servicioTriggers,
    servicioMonitores,
    servicioLecturaTriggersPortal = null,
    apiPrivadaAudienciaTriggerCorreo = null,
    apiPrivadaLecturaTriggerCorreo = null,
    repositorioAdministracionTriggerCorreo = null,
    servicioConfiguracionPortal = null,
    servicioCorreoPortal = null,
    fronteraTransaccional = null
  }) {
    this.repositorioTriggers = repositorioTriggers;
    this.repositorioAsignacionesTriggerMonitor =
      repositorioAsignacionesTriggerMonitor;
    this.repositorioMonitores = repositorioMonitores;
    this.repositorioZonasDns = repositorioZonasDns;
    this.repositorioRegistrosDns = repositorioRegistrosDns;
    this.repositorioTenants = repositorioTenants;
    this.repositorioEmpresas = repositorioEmpresas;
    this.repositorioSitios = repositorioSitios;
    this.resolutorScopeUsuario = resolutorScopeUsuario;
    this.servicioTriggers = servicioTriggers;
    this.servicioMonitores = servicioMonitores;
    this.servicioLecturaTriggersPortal = servicioLecturaTriggersPortal;
    this.apiPrivadaAudienciaTriggerCorreo = apiPrivadaAudienciaTriggerCorreo;
    this.apiPrivadaLecturaTriggerCorreo = apiPrivadaLecturaTriggerCorreo;
    this.repositorioAdministracionTriggerCorreo =
      repositorioAdministracionTriggerCorreo;
    this.servicioConfiguracionPortal = servicioConfiguracionPortal;
    this.servicioCorreoPortal = servicioCorreoPortal;
    this.fronteraTransaccional = fronteraTransaccional;
  }

  async construirVistaListado(
    contextoUsuarioActual,
    { incluirLecturaOperativa = true } = {}
  ) {
    const [triggers, lecturaOperativa] = await Promise.all([
      this.servicioTriggers.listarTriggersVisibles(contextoUsuarioActual),
      this.servicioLecturaTriggersPortal && incluirLecturaOperativa
        ? this.servicioLecturaTriggersPortal
          .construirVistaLecturaAdministrativa(contextoUsuarioActual)
        : Promise.resolve(null)
    ]);

    const triggersCatalogo = triggers.map((trigger) =>
      this.serializarTriggerCatalogo(trigger)
    );
    const resumen = {
      totalTriggers: triggersCatalogo.length,
      totalActivos: triggersCatalogo.filter((trigger) => trigger.activo).length,
      totalTipos: new Set(triggersCatalogo.map((trigger) => trigger.tipo)).size,
      totalAsignacionesVisibles:
        lecturaOperativa?.resumen?.totalAsignaciones ?? 0,
      totalEjecucionesRecientes:
        lecturaOperativa?.resumen?.totalEjecucionesRecientes ?? 0,
      totalErroresRecientes:
        lecturaOperativa?.resumen?.totalErroresRecientes ?? 0
    };

    return {
      alcanceActual: this.construirAlcanceActual(contextoUsuarioActual),
      resumen,
      triggers: triggersCatalogo,
      incluyeLecturaOperativa: Boolean(incluirLecturaOperativa),
      lecturaOperativa: lecturaOperativa || {
        resumen: {
          totalMonitoresVisibles: 0,
          totalMonitoresConTriggers: 0,
          totalTriggers: 0,
          totalTriggersActivos: 0,
          totalAsignaciones: 0,
          totalAsignacionesActivas: 0,
          totalEjecucionesRecientes: 0,
          totalErroresRecientes: 0
        },
        monitoresConAsignaciones: [],
        ejecucionesRecientes: []
      }
    };
  }

  async construirVistaListadoAjaxShell(contextoUsuarioActual) {
    const [opcionesTenants, opcionesEmpresas, sitioActual, correoHabilitado] =
      await Promise.all([
        this.repositorioTenants?.listarVisibles?.(contextoUsuarioActual) ||
          Promise.resolve([]),
        this.repositorioEmpresas?.listarVisibles?.(contextoUsuarioActual) ||
          Promise.resolve([]),
        contextoUsuarioActual?.nivelScope === 'sitio' &&
          contextoUsuarioActual?.sitioId &&
          this.repositorioSitios?.buscarPorId
          ? this.repositorioSitios.buscarPorId(contextoUsuarioActual.sitioId)
          : Promise.resolve(null),
        this.estaSuperficieCorreoHabilitada()
      ]);
    const contextoNombrado = {
      ...contextoUsuarioActual,
      tenantNombre:
        contextoUsuarioActual?.tenantNombre ||
        opcionesTenants.find((tenant) =>
          String(tenant.id) === String(contextoUsuarioActual?.tenantId)
        )?.nombre ||
        null,
      empresaNombre:
        contextoUsuarioActual?.empresaNombre ||
        opcionesEmpresas.find((empresa) =>
          String(empresa.id) === String(contextoUsuarioActual?.empresaId)
        )?.nombre ||
        null,
      sitioNombre: contextoUsuarioActual?.sitioNombre || sitioActual?.nombre || null
    };

    return {
      alcanceActual: this.construirAlcanceActual(contextoNombrado),
      resumenTriggers: {
        totalTriggers: 0,
        totalActivos: 0,
        totalInactivos: 0,
        totalApi: 0,
        totalDns: 0,
        totalCorreo: 0
      },
      resumenVinculos: {
        totalAsignaciones: 0,
        totalActivas: 0,
        totalInactivas: 0,
        totalMonitores: 0,
        totalTriggers: 0
      },
      filtrosTriggers: {
        textoBusqueda: '',
        tenantId: '',
        empresaId: '',
        sitioId: '',
        tipo: '',
        activo: 'todos',
        pagina: 1,
        tamanoPagina: 10,
        ordenarPor: 'nombre',
        direccionOrden: 'asc'
      },
      filtrosVinculos: {
        textoBusqueda: '',
        triggerId: '',
        monitorId: '',
        tenantId: '',
        empresaId: '',
        tipo: '',
        activo: 'todos',
        eventoDisparo: '',
        pagina: 1,
        tamanoPagina: 10,
        ordenarPor: 'actualizado',
        direccionOrden: 'desc'
      },
      opcionesTipoTrigger: [
        { valor: '', etiqueta: 'Todos' },
        ...this.listarDefinicionesTipo()
          .filter((definicion) => definicion.valor !== 'correo' || correoHabilitado)
          .map((definicion) => ({
          valor: definicion.valor,
          etiqueta: definicion.etiquetaTipo
        }))
      ],
      opcionesEventosDisparo: [
        { valor: '', etiqueta: 'Todos' },
        ...this.listarEventosDisparoVinculo().map((evento) => ({
          valor: evento.valor,
          etiqueta: evento.etiqueta
        }))
      ],
      opcionesTenants: opcionesTenants.map((tenant) => ({
        valor: tenant.id,
        etiqueta: `${tenant.nombre} (#${tenant.id})`
      })),
      opcionesEmpresas: opcionesEmpresas.map((empresa) => ({
        valor: empresa.id,
        tenantId: empresa.tenantId,
        etiqueta: `${empresa.nombre} (#${empresa.id})`
      }))
    };
  }

  async listarTriggersAdministracion(
    contextoUsuarioActual,
    {
      textoBusqueda = '',
      tenantId = null,
      empresaId = null,
      sitioId = null,
      tipo = null,
      activo = 'todos',
      salud = '',
      pagina = 1,
      tamanoPagina = 10,
      ordenarPor = 'nombre',
      direccionOrden = 'asc'
    } = {}
  ) {
    const filtroSalud = this.normalizarFiltroSaludTrigger(salud);

    if (filtroSalud) {
      return this.listarTriggersAdministracionPorSalud(
        contextoUsuarioActual,
        {
          textoBusqueda,
          tenantId,
          empresaId,
          sitioId,
          tipo,
          activo,
          salud: filtroSalud,
          pagina,
          tamanoPagina,
          ordenarPor,
          direccionOrden
        }
      );
    }

    const correoHabilitado = await this.estaSuperficieCorreoHabilitada();
    const resultadoVisible = await this.repositorioTriggers.listarPaginadoVisible(
      contextoUsuarioActual,
      {
        textoBusqueda,
        tenantId,
        empresaId,
        sitioId,
        tipo,
        activo,
        pagina,
        tamanoPagina,
        ordenarPor,
        direccionOrden,
        excluirCorreo: !correoHabilitado
      }
    );
    const triggersVisiblesPorGate = resultadoVisible.triggers.filter(
      (trigger) => trigger.tipo !== 'correo' || correoHabilitado
    );
    const diagnosticosDns = await this.diagnosticarObjetivosDnsTriggers(
      triggersVisiblesPorGate
    );
    const usoOperativo = await this.cargarUsoOperativoTriggers(
      contextoUsuarioActual,
      triggersVisiblesPorGate
    );
    const triggersBase = triggersVisiblesPorGate.map((trigger) =>
      this.serializarTriggerAdministracion(trigger, diagnosticosDns, usoOperativo)
    );
    const triggers = await this.enriquecerEstadosCorreo(triggersBase);

    return {
      resumen: resultadoVisible.resumen,
      filtros: {
        textoBusqueda,
        tenantId: this.normalizarFiltroId(tenantId) || '',
        empresaId: this.normalizarFiltroId(empresaId) || '',
        sitioId: this.normalizarFiltroId(sitioId) || '',
        tipo: this.normalizarFiltroTipo(tipo),
        activo: this.normalizarFiltroActivo(activo),
        salud: filtroSalud,
        pagina: resultadoVisible.paginacion.pagina,
        tamanoPagina: resultadoVisible.paginacion.tamanoPagina,
        ordenarPor,
        direccionOrden
      },
      alcanceActual: this.construirAlcanceActual(contextoUsuarioActual),
      triggers,
      paginacion: {
        ...resultadoVisible.paginacion,
        desde:
          resultadoVisible.paginacion.totalFiltrado === 0
            ? 0
            : ((resultadoVisible.paginacion.pagina - 1) *
                resultadoVisible.paginacion.tamanoPagina) + 1,
        hasta: Math.min(
          resultadoVisible.paginacion.totalFiltrado,
          resultadoVisible.paginacion.pagina *
            resultadoVisible.paginacion.tamanoPagina
        )
      }
    };
  }

  async listarTriggersAdministracionPorSalud(
    contextoUsuarioActual,
    {
      textoBusqueda = '',
      tenantId = null,
      empresaId = null,
      sitioId = null,
      tipo = null,
      activo = 'todos',
      salud = '',
      pagina = 1,
      tamanoPagina = 10,
      ordenarPor = 'nombre',
      direccionOrden = 'asc'
    } = {}
  ) {
    const todosVisiblesSinGate = await this.repositorioTriggers.listarVisibles(
      contextoUsuarioActual
    );
    const correoHabilitado = await this.estaSuperficieCorreoHabilitada();
    const todosVisibles = todosVisiblesSinGate.filter(
      (trigger) => trigger.tipo !== 'correo' || correoHabilitado
    );
    const diagnosticosDns = await this.diagnosticarObjetivosDnsTriggers(
      todosVisibles
    );
    const usoOperativo = await this.cargarUsoOperativoTriggers(
      contextoUsuarioActual,
      todosVisibles
    );
    const texto = String(textoBusqueda || '').trim().toLowerCase();
    const tenantNormalizado = this.normalizarFiltroId(tenantId);
    const empresaNormalizada = this.normalizarFiltroId(empresaId);
    const sitioNormalizado = this.normalizarFiltroId(sitioId);
    const tipoNormalizado = this.normalizarFiltroTipo(tipo);
    const activoNormalizado = this.normalizarFiltroActivo(activo);
    const saludNormalizada = this.normalizarFiltroSaludTrigger(salud);
    const tamanoNormalizado = this.normalizarTamanoPaginaListado(tamanoPagina);
    const paginaSolicitada = this.normalizarPaginaListado(pagina);
    const serializados = todosVisibles.map((trigger) =>
        this.serializarTriggerAdministracion(
          trigger,
          diagnosticosDns,
          usoOperativo
        )
      );
    const ordenados = (await this.enriquecerEstadosCorreo(serializados))
      .filter((trigger) =>
        this.triggerAdministracionCumpleFiltros(trigger, {
          texto,
          tenantId: tenantNormalizado,
          empresaId: empresaNormalizada,
          sitioId: sitioNormalizado,
          tipo: tipoNormalizado,
          activo: activoNormalizado,
          salud: saludNormalizada
        })
      )
      .sort((a, b) =>
        this.compararTriggersAdministracion(
          a,
          b,
          ordenarPor,
          direccionOrden
        )
      );
    const totalFiltrado = ordenados.length;
    const totalPaginas = Math.max(1, Math.ceil(totalFiltrado / tamanoNormalizado));
    const paginaEfectiva = Math.min(paginaSolicitada, totalPaginas);
    const inicio = (paginaEfectiva - 1) * tamanoNormalizado;
    const triggers = ordenados.slice(inicio, inicio + tamanoNormalizado);

    return {
      resumen: this.resumirTriggersAdministracion(ordenados),
      filtros: {
        textoBusqueda,
        tenantId: tenantNormalizado || '',
        empresaId: empresaNormalizada || '',
        sitioId: sitioNormalizado || '',
        tipo: tipoNormalizado,
        activo: activoNormalizado,
        salud: saludNormalizada,
        pagina: paginaEfectiva,
        tamanoPagina: tamanoNormalizado,
        ordenarPor,
        direccionOrden
      },
      alcanceActual: this.construirAlcanceActual(contextoUsuarioActual),
      triggers,
      paginacion: {
        pagina: paginaEfectiva,
        tamanoPagina: tamanoNormalizado,
        totalVisible: todosVisibles.length,
        totalFiltrado,
        totalPaginas,
        desde: totalFiltrado === 0 ? 0 : inicio + 1,
        hasta: Math.min(totalFiltrado, inicio + tamanoNormalizado)
      }
    };
  }

  async listarVinculosAdministracion(
    contextoUsuarioActual,
    {
      textoBusqueda = '',
      triggerId = null,
      monitorId = null,
      tenantId = null,
      empresaId = null,
      tipo = null,
      activo = 'todos',
      eventoDisparo = null,
      pagina = 1,
      tamanoPagina = 10,
      ordenarPor = 'actualizado',
      direccionOrden = 'desc'
    } = {}
  ) {
    const resultado =
      await this.repositorioAsignacionesTriggerMonitor.listarPaginadoVisible(
        contextoUsuarioActual,
        {
          textoBusqueda,
          triggerId,
          monitorId,
          tenantId,
          empresaId,
          tipo,
          activo,
          eventoDisparo,
          pagina,
          tamanoPagina,
          ordenarPor,
          direccionOrden
        }
      );
    const triggerIds = Array.from(
      new Set(
        resultado.asignaciones
          .map((asignacion) => Number(asignacion.triggerId))
          .filter((id) => Number.isInteger(id) && id > 0)
      )
    );
    const triggersVisibles = await this.servicioTriggers.listarTriggersVisiblesPorIds(
      contextoUsuarioActual,
      triggerIds
    );
    const triggersVisiblesPorId = new Map(
      triggersVisibles.map((trigger) => [trigger.id, trigger])
    );
    const asignaciones = resultado.asignaciones.map((asignacion) => {
      const resumen = asignacion.serializarResumen();
      const triggerVisible = triggersVisiblesPorId.get(resumen.triggerId) || null;

      return {
        ...this.serializarAsignacionVisible({
          ...resumen,
          trigger: triggerVisible
        }),
        urls: {
          editarVinculo: triggerVisible
            ? `/monitores/triggers/vinculos/editar/${resumen.id}?return_to=${encodeURIComponent('/automatizacion/enlaces')}`
            : null,
          detalleMonitor:
            `/monitores/${resumen.monitorId}?return_to=${encodeURIComponent('/automatizacion/enlaces')}`,
          editarTrigger: triggerVisible
            ? `/monitores/triggers/editar/${resumen.triggerId}`
            : null
        }
      };
    });

    return {
      resumen: resultado.resumen,
      filtros: {
        textoBusqueda,
        triggerId: this.normalizarFiltroId(triggerId),
        monitorId: this.normalizarFiltroId(monitorId),
        tenantId: this.normalizarFiltroId(tenantId),
        empresaId: this.normalizarFiltroId(empresaId),
        tipo: this.normalizarFiltroTipo(tipo),
        activo: this.normalizarFiltroActivo(activo),
        eventoDisparo: this.normalizarFiltroEvento(eventoDisparo),
        pagina: resultado.paginacion.pagina,
        tamanoPagina: resultado.paginacion.tamanoPagina,
        ordenarPor,
        direccionOrden
      },
      alcanceActual: this.construirAlcanceActual(contextoUsuarioActual),
      asignaciones,
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

  async construirVistaFormulario(
    contextoUsuarioActual,
    {
      idTrigger = null,
      formularioBase = null,
      tipoNuevo = null
    } = {}
  ) {
    const triggerObjetivo =
      idTrigger == null
        ? null
        : await this.servicioTriggers.buscarTriggerVisiblePorId(
          contextoUsuarioActual,
          idTrigger
        );

    if (idTrigger != null && !triggerObjetivo) {
      throw new Error('El trigger indicado no existe.');
    }

    const vistaRelacionesCruzadas = triggerObjetivo
      ? await this.listarVinculosAdministracion(contextoUsuarioActual, {
        triggerId: triggerObjetivo.id,
        tamanoPagina: 12,
        ordenarPor: 'monitor',
        direccionOrden: 'asc'
      })
      : null;

    const [opcionesTenants, opcionesEmpresas, opcionesSitios] = await Promise.all([
      this.repositorioTenants?.listarVisibles?.(contextoUsuarioActual) ||
        Promise.resolve([]),
      this.repositorioEmpresas?.listarVisibles?.(contextoUsuarioActual) ||
        Promise.resolve([]),
      this.repositorioSitios?.listarVisibles?.(contextoUsuarioActual) ||
        Promise.resolve([])
    ]);
    const tipoFormulario = this.resolverTipoFormulario(
      formularioBase?.tipo,
      triggerObjetivo?.tipo,
      tipoNuevo
    );
    const correoHabilitado = await this.estaSuperficieCorreoHabilitada();
    if (tipoFormulario === 'correo' && !correoHabilitado) {
      lanzarSuperficieCorreoCerrada();
    }
    const definicionTipo = this.obtenerDefinicionTipo(tipoFormulario);
    const formulario = formularioBase
      ? this.construirFormularioDesdeEntrada(formularioBase, tipoFormulario)
      : triggerObjetivo
        ? this.construirFormularioDesdeTrigger(triggerObjetivo)
        : this.construirFormularioNuevo(tipoFormulario, contextoUsuarioActual);
    const nivelPertenencia = this.resolverNivelPertenenciaFormulario(formulario);
    const restriccionesScope = this.resolverRestriccionesScopeTrigger(
      contextoUsuarioActual,
      nivelPertenencia
    );
    const opcionesPertenencia = this.listarOpcionesPertenenciaDisponibles(
      contextoUsuarioActual
    );
    const objetivoDnsTrigger =
      triggerObjetivo?.tipo === 'dns'
        ? await this.diagnosticarObjetivoDnsTrigger({
          ...triggerObjetivo,
          configuracion: formulario
        })
        : null;
    const experienciaCorreo = tipoFormulario === 'correo'
      ? await this.construirExperienciaCorreo(
        contextoUsuarioActual,
        triggerObjetivo,
        formulario
      )
      : null;

    return {
      modo: triggerObjetivo ? 'editar' : 'nuevo',
      alcanceActual: this.construirAlcanceActual(contextoUsuarioActual),
      triggerObjetivo,
      relacionesCruzadas: vistaRelacionesCruzadas
        ? {
          total: vistaRelacionesCruzadas.paginacion.totalFiltrado,
          vinculaciones: vistaRelacionesCruzadas.asignaciones
        }
        : null,
      objetivoDnsTrigger,
      experienciaCorreo,
      formulario,
      definicionTipo,
      restriccionesScope,
      opcionesPertenencia,
      opcionesTipo: this.listarDefinicionesTipo().filter(
        (definicion) => definicion.valor !== 'correo' || correoHabilitado
      ),
      opcionesMetodoHttp: definicionTipo.metodosHttp || [],
      opcionesTenants: opcionesTenants.map((tenant) => ({
        valor: tenant.id,
        etiqueta: `${tenant.nombre} (#${tenant.id})`
      })),
      opcionesEmpresas: opcionesEmpresas.map((empresa) => ({
        valor: empresa.id,
        tenantId: empresa.tenantId,
        etiqueta: `${empresa.nombre} (#${empresa.id})`
      })),
      opcionesSitios: opcionesSitios.map((sitio) => ({
        valor: sitio.id,
        tenantId: sitio.tenantId,
        empresaId: sitio.empresaId,
        etiqueta: `${sitio.nombre} (#${sitio.id})`
      }))
    };
  }

  async crearTrigger(contextoUsuarioActual, datos) {
    const formulario = this.construirFormularioDesdeEntrada(datos);
    const scopeObjetivo = await this.resolverScopeTriggerObjetivoValido(
      contextoUsuarioActual,
      formulario
    );
    const definicion = {
      ...formulario,
      tenantId: scopeObjetivo.tenantId,
      empresaId: scopeObjetivo.empresaId,
      sitioId: scopeObjetivo.sitioId
    };

    await this.exigirObjetivoDnsTriggerValidoParaEditor(
      contextoUsuarioActual,
      definicion
    );

    if (definicion.tipo === 'correo') {
      await this.exigirSuperficieCorreoHabilitada();
      await this.exigirCanalYOrigenCorreo();
      return this.crearTriggerCorreoAtomico(
        contextoUsuarioActual,
        definicion,
        datos
      );
    }

    return this.servicioTriggers.crearTrigger(definicion, {
      contextoUsuarioActual
    });
  }

  async buscarObjetivosDnsTrigger(contextoUsuarioActual, filtros = {}) {
    if (!this.repositorioRegistrosDns) {
      throw new Error(
        'No se puede consultar objetivos DNS desde esta instancia del portal.'
      );
    }

    const registros =
      await this.repositorioRegistrosDns.listarGobernablesPorTriggerVisibles(
        contextoUsuarioActual,
        {
          textoBusqueda: filtros.textoBusqueda,
          zonaId: filtros.zonaId,
          limite: filtros.limite
        }
      );
    const triggerScope = this.construirTriggerDnsParaValidacion({
      tenantId: filtros.tenantId,
      empresaId: filtros.empresaId,
      sitioId: filtros.sitioId
    });
    const resultados = registros
      .filter((registro) => this.scopeTriggerContieneRegistro(triggerScope, registro))
      .map((registro) => this.serializarObjetivoDnsTrigger(registro));

    return {
      resultados,
      total: resultados.length
    };
  }

  async construirExperienciaCorreo(contextoUsuarioActual, trigger, formulario) {
    await this.servicioConfiguracionPortal?.asegurarActualizada?.();
    const configuracionPortal = this.servicioConfiguracionPortal
      ?.obtenerConfiguracionActual?.();
    const estadoCanal = await obtenerEstadoCorreo(
      this.servicioCorreoPortal
    ) || {
      puedeDespachar: false,
      errores: ['El canal SMTP no está disponible en esta instancia.']
    };
    const origenPublico = normalizarOrigenPublicoHttps(
      configuracionPortal?.obtenerOrigenPublicoPortal?.()
    );
    const nombrePortal = configuracionPortal?.obtenerNombreVisiblePortal?.() ||
      'Sentinelia';
    const origenValido = origenPublico !== null;
    const previa = previsualizarTriggerCorreo({
      definicionMensaje: {
        version: Number(formulario.versionCorreo || 1),
        asuntoPlantilla: formulario.asuntoPlantilla,
        textoIntroduccion: formulario.textoIntroduccion || null,
        textoCierre: formulario.textoCierre || null
      },
      origenPublico: origenPublico || 'https://sentinelia.invalid',
      nombrePortal
    });
    if (!trigger) {
      const usuariosElegibles = await this.apiPrivadaAudienciaTriggerCorreo
        .buscarUsuariosElegibles(contextoUsuarioActual, { limite: 25 });
      return {
        audiencia: { relaciones: [], total: 0, restringidas: 0 },
        estado: derivarEstadoCorreo({
          activo: Boolean(formulario.activo),
          resumen: resumenCorreoVacio(),
          estadoCanal,
          origenValido,
          limite: this.obtenerLimiteAudienciaCorreo(configuracionPortal)
        }),
        resumen: resumenCorreoVacio(),
        historico: { total: 0, elementos: [] },
        previa,
        usuariosElegibles: usuariosElegibles.resultados
      };
    }
    const [audiencia, resumenBase, historico, usoVisible] = await Promise.all([
      this.apiPrivadaAudienciaTriggerCorreo.leer(
        contextoUsuarioActual,
        trigger.id
      ),
      this.repositorioAdministracionTriggerCorreo.resumir(trigger.id),
      this.apiPrivadaLecturaTriggerCorreo.listarPorTrigger(
        contextoUsuarioActual,
        trigger.id,
        { limite: 20 }
      ),
      this.servicioTriggers.resumirUsoOperativoPorTriggerIdsVisible(
        contextoUsuarioActual,
        [trigger.id]
      )
    ]);
    const vinculosVisibles = Number(
      usoVisible.get(Number(trigger.id))?.totalVinculos || 0
    );
    const resumen = {
      ...resumenBase,
      vinculosVisibles,
      vinculosRestringidos: Math.max(
        0,
        resumenBase.vinculosTotal - vinculosVisibles
      )
    };
    return {
      audiencia,
      resumen,
      historico,
      estado: derivarEstadoCorreo({
        activo: Boolean(trigger.activo),
        resumen,
        estadoCanal,
        origenValido,
        limite: this.obtenerLimiteAudienciaCorreo(configuracionPortal)
      }),
      previa
    };
  }

  async enriquecerEstadosCorreo(triggers) {
    if (!triggers.some((trigger) => trigger.tipo === 'correo') ||
        !await this.estaSuperficieCorreoHabilitada()) return triggers;
    await this.servicioConfiguracionPortal?.asegurarActualizada?.();
    const configuracion = this.servicioConfiguracionPortal
      ?.obtenerConfiguracionActual?.();
    const estadoCanal = await obtenerEstadoCorreo(this.servicioCorreoPortal) ||
      { puedeDespachar: false, errores: [] };
    const origenValido = normalizarOrigenPublicoHttps(
      configuracion?.obtenerOrigenPublicoPortal?.()
    ) !== null;
    const limite = this.obtenerLimiteAudienciaCorreo(configuracion);
    return Promise.all(triggers.map(async (trigger) => {
      if (trigger.tipo !== 'correo') return trigger;
      const resumenCorreo = await this.repositorioAdministracionTriggerCorreo
        .resumir(trigger.id);
      return {
        ...trigger,
        resumenCorreo,
        estadoCorreo: derivarEstadoCorreo({
          activo: trigger.activo,
          resumen: resumenCorreo,
          estadoCanal,
          origenValido,
          limite
        })
      };
    }));
  }

  async buscarUsuariosAudienciaCorreo(contextoUsuarioActual, entrada = {}) {
    await this.exigirSuperficieCorreoHabilitada();
    return this.apiPrivadaAudienciaTriggerCorreo.buscarUsuariosElegibles(
      contextoUsuarioActual,
      {
        triggerId: entrada.triggerId,
        texto: entrada.texto,
        limite: entrada.limite
      }
    );
  }

  async mutarAudienciaCorreo(contextoUsuarioActual, entrada = {}) {
    await this.exigirSuperficieCorreoHabilitada();
    return this.apiPrivadaAudienciaTriggerCorreo.mutar(
      contextoUsuarioActual,
      normalizarComandoAudiencia(entrada, { exigirOperacion: true })
    );
  }

  async previsualizarCorreo(contextoUsuarioActual, triggerId, entrada = {}) {
    await this.exigirSuperficieCorreoHabilitada();
    const trigger = triggerId == null
      ? null
      : await this.servicioTriggers.buscarTriggerVisiblePorId(
        contextoUsuarioActual,
        triggerId
      );
    if (triggerId != null && (!trigger || trigger.tipo !== 'correo')) {
      lanzarTriggerNoDisponible();
    }
    const formulario = this.construirFormularioDesdeEntrada(entrada, 'correo');
    return (await this.construirExperienciaCorreo(
      contextoUsuarioActual,
      trigger,
      formulario
    )).previa;
  }

  async probarCorreo(contextoUsuarioActual, triggerId, entrada = {}) {
    await this.exigirCanalYOrigenCorreo();
    const previa = await this.previsualizarCorreo(
      contextoUsuarioActual,
      triggerId,
      entrada
    );
    const salida = await this.servicioCorreoPortal.encolarCorreoPrueba({
      destinatarioEmail: entrada.destinatarioEmail,
      destinatarioNombre: entrada.destinatarioNombre || null,
      asunto: `[PRUEBA] ${previa.mensajeMaterializado.asunto}`,
      cuerpoTexto: [
        'PRUEBA ADMINISTRATIVA: no representa una transición real.',
        '',
        previa.mensajeMaterializado.cuerpoBaseTexto
      ].join('\n'),
      creadoPorUsuarioId: contextoUsuarioActual?.idUsuario
    });
    return {
      salidaId: String(salida.id),
      origenTipo: salida.origenTipo || 'prueba',
      estado: salida.estado
    };
  }

  async leerDetalleCorreo(contextoUsuarioActual, ejecucionId) {
    await this.exigirSuperficieCorreoHabilitada();
    return this.apiPrivadaLecturaTriggerCorreo.leerDetalle(
      contextoUsuarioActual,
      ejecucionId
    );
  }

  async crearTriggerCorreoAtomico(contextoUsuarioActual, definicion, datos) {
    this.exigirComposicionCorreoDisponible();
    const comando = normalizarComandoAudiencia(datos);
    if (!tieneOperacionAudiencia(comando)) {
      throw Object.assign(
        new Error('Un trigger de correo debe crearse con audiencia explícita.'),
        { codigo: 'audiencia_trigger_correo_requerida', statusCode: 400 }
      );
    }
    return this.fronteraTransaccional.ejecutar(async (conexion) => {
      const activoSolicitado = Boolean(definicion.activo);
      let trigger = await this.servicioTriggers.crearTrigger(
        { ...definicion, activo: false },
        { contextoUsuarioActual, conexion }
      );
      const audiencia = await this.apiPrivadaAudienciaTriggerCorreo.mutar(
        contextoUsuarioActual,
        {
          ...comando,
          triggerId: trigger.id,
          revisionDeclaracion: trigger.revisionDeclaracion
        },
        { conexion }
      );
      trigger = (await this.repositorioTriggers.buscarPorId(trigger.id, { conexion }))
        .serializarResumen();
      if (activoSolicitado) {
        trigger = await this.servicioTriggers.actualizarTrigger(
          trigger.id,
          { ...definicion, activo: true, revisionDeclaracion: trigger.revisionDeclaracion },
          { contextoUsuarioActual, conexion }
        );
        await this.exigirCapacidadCompletaCorreo(trigger.id, { conexion });
      }
      return { ...trigger, audienciaResultado: audiencia };
    });
  }

  async actualizarTriggerCorreoAtomico(
    contextoUsuarioActual,
    triggerId,
    definicion,
    datos,
    { eraActivo = false } = {}
  ) {
    this.exigirComposicionCorreoDisponible();
    const comando = normalizarComandoAudiencia(datos);
    return this.fronteraTransaccional.ejecutar(async (conexion) => {
      let trigger = await this.servicioTriggers.actualizarTrigger(
        triggerId,
        definicion,
        { contextoUsuarioActual, conexion }
      );
      let audienciaResultado = null;
      if (tieneOperacionAudiencia(comando)) {
        audienciaResultado = await this.apiPrivadaAudienciaTriggerCorreo.mutar(
          contextoUsuarioActual,
          {
            ...comando,
            triggerId,
            revisionDeclaracion: trigger.revisionDeclaracion
          },
          { conexion }
        );
        trigger = (await this.repositorioTriggers.buscarPorId(triggerId, { conexion }))
          .serializarResumen();
      }
      if (!eraActivo && trigger.activo) {
        await this.exigirCapacidadCompletaCorreo(trigger.id, { conexion });
      }
      return { ...trigger, audienciaResultado };
    });
  }

  async exigirSuperficieCorreoHabilitada() {
    if (!await this.estaSuperficieCorreoHabilitada()) {
      lanzarSuperficieCorreoCerrada();
    }
  }

  async estaSuperficieCorreoHabilitada() {
    await this.servicioConfiguracionPortal?.asegurarActualizada?.();
    return !this.servicioConfiguracionPortal ||
      Number(this.servicioConfiguracionPortal
        .obtenerEstadoDespliegueCorreoActual?.()?.tipo_correo_habilitado) === 1;
  }

  async exigirCapacidadCompletaCorreo(triggerId, { conexion = null } = {}) {
    await this.exigirCanalYOrigenCorreo();
    const resumen = await this.repositorioAdministracionTriggerCorreo
      .resumir(triggerId, { conexion });
    if (!resumen || resumen.relacionesEntregables < 1) {
      throw Object.assign(
        new Error(
          'La pareja operativa de correo exige SMTP verificado, origen HTTPS y al menos un destinatario entregable.'
        ),
        { codigo: 'vinculo_trigger_correo_sin_capacidad', statusCode: 409 }
      );
    }
  }

  async exigirCanalYOrigenCorreo() {
    await this.exigirSuperficieCorreoHabilitada();
    await this.servicioConfiguracionPortal?.asegurarActualizada?.();
    const configuracion = this.servicioConfiguracionPortal
      ?.obtenerConfiguracionActual?.();
    const estado = await obtenerEstadoCorreo(this.servicioCorreoPortal);
    if (!estado?.puedeDespachar ||
        normalizarOrigenPublicoHttps(
          configuracion?.obtenerOrigenPublicoPortal?.()
        ) === null) {
      throw Object.assign(
        new Error('El trigger de correo exige SMTP verificado y origen público HTTPS.'),
        { codigo: 'trigger_correo_sin_capacidad', statusCode: 409 }
      );
    }
  }

  exigirComposicionCorreoDisponible() {
    if (!this.fronteraTransaccional || !this.apiPrivadaAudienciaTriggerCorreo) {
      throw new Error('La composición transaccional del trigger de correo no está disponible.');
    }
  }

  obtenerLimiteAudienciaCorreo(configuracionPortal) {
    return Number(
      configuracionPortal?.obtenerConfiguracionCorreo?.()
        ?.destinatariosTriggerMaximos || 0
    );
  }

  async actualizarTrigger(contextoUsuarioActual, idTrigger, datos) {
    const triggerActual = await this.servicioTriggers.buscarTriggerVisiblePorId(
      contextoUsuarioActual,
      idTrigger
    );

    if (!triggerActual) {
      throw new Error('El trigger indicado no existe o no está dentro de tu alcance.');
    }

    const formulario = this.construirFormularioDesdeEntrada(
      datos,
      triggerActual.tipo
    );
    const scopeObjetivo = await this.resolverScopeTriggerObjetivoValido(
      contextoUsuarioActual,
      formulario
    );
    const definicion = {
      ...formulario,
      tenantId: scopeObjetivo.tenantId,
      empresaId: scopeObjetivo.empresaId,
      sitioId: scopeObjetivo.sitioId
    };

    await this.exigirObjetivoDnsTriggerValidoParaEditor(
      contextoUsuarioActual,
      definicion
    );

    if (definicion.tipo === 'correo') {
      await this.exigirSuperficieCorreoHabilitada();
      return this.actualizarTriggerCorreoAtomico(
        contextoUsuarioActual,
        idTrigger,
        definicion,
        datos,
        { eraActivo: Boolean(triggerActual.activo) }
      );
    }

    return this.servicioTriggers.actualizarTrigger(idTrigger, definicion, {
      contextoUsuarioActual
    });
  }

  async eliminarTrigger(
    contextoUsuarioActual,
    idTrigger,
    revisionDeclaracion
  ) {
    const trigger = await this.servicioTriggers.buscarTriggerVisiblePorId(
      contextoUsuarioActual,
      idTrigger
    );

    if (!trigger) {
      throw new Error('El trigger indicado no existe o no está dentro de tu alcance.');
    }

    await this.servicioTriggers.eliminarTrigger(idTrigger, {
      contextoUsuarioActual,
      revisionDeclaracion
    });
    return trigger;
  }

  async construirVistaFormularioVinculo(
    contextoUsuarioActual,
    {
      formularioBase = null,
      idAsignacion = null,
      triggerPreseleccionadoId = null,
      monitorPreseleccionadoId = null
    } = {}
  ) {
    const nombresAlcance = await this.resolverNombresVisiblesVinculo(
      contextoUsuarioActual
    );
    const [triggersSinGate, opcionesMonitores, correoHabilitado] = await Promise.all([
      this.servicioTriggers.listarTriggersVisibles(contextoUsuarioActual),
      this.servicioMonitores.obtenerOpcionesMonitoresEventos(
        contextoUsuarioActual,
        {}
      ),
      this.estaSuperficieCorreoHabilitada()
    ]);
    const triggers = triggersSinGate.filter(
      (trigger) => trigger.tipo !== 'correo' || correoHabilitado
    );
    const triggersOrdenados = [...triggers].sort((a, b) =>
      String(a?.nombre || '').localeCompare(String(b?.nombre || ''), 'es')
    );
    const opcionesTriggers = triggersOrdenados.map((trigger) => ({
      valor: trigger.id,
      etiqueta: `${trigger.nombre} (#${trigger.id})`,
      tipo: trigger.tipo,
      activo: Boolean(trigger.activo),
      tenantId: trigger.tenantId,
      empresaId: trigger.empresaId,
      sitioId: trigger.sitioId,
      nivelPertenencia: trigger.nivelPertenencia,
      alcance: nombresAlcance.describir(trigger),
      scopeValido: this.esScopeTriggerValido(trigger),
      puedeVincular: this.esTriggerVinculableEnModeloActual(trigger)
    }));
    const triggerPreseleccionado =
      triggerPreseleccionadoId == null
        ? null
        : triggersOrdenados.find(
          (trigger) => Number(trigger.id) === Number(triggerPreseleccionadoId)
        ) || null;
    const asignacionObjetivo =
      idAsignacion == null
        ? null
        : await this.buscarAsignacionVisible(
          contextoUsuarioActual,
          idAsignacion
        );

    if (triggerPreseleccionadoId != null && !triggerPreseleccionado) {
      throw new Error('El trigger indicado no existe.');
    }
    const formulario = formularioBase
      ? this.construirFormularioVinculoDesdeEntrada(formularioBase)
      : asignacionObjetivo
        ? this.construirFormularioVinculoDesdeAsignacion(asignacionObjetivo)
        : this.construirFormularioVinculoNuevo(
          triggerPreseleccionado,
          monitorPreseleccionadoId
        );
    const triggerSeleccionado = triggersOrdenados.find((trigger) =>
      Number(trigger.id) === Number(formulario.triggerId)) || null;
    const estadoCorreoVinculo = triggerSeleccionado?.tipo === 'correo'
      ? (await this.enriquecerEstadosCorreo([triggerSeleccionado]))[0]
        ?.estadoCorreo || null
      : null;

    return {
      modo: asignacionObjetivo ? 'editar' : 'nuevo',
      alcanceActual: this.construirAlcanceActual(nombresAlcance.contexto),
      asignacionObjetivo,
      triggerPreseleccionado,
      formulario,
      opcionesTriggers,
      opcionesMonitores: opcionesMonitores
        .map((monitor) => ({
          ...monitor,
          alcance: nombresAlcance.describir(monitor)
        }))
        .sort((a, b) =>
          String(a?.etiqueta || '').localeCompare(String(b?.etiqueta || ''), 'es')
        ),
      opcionesEventosDisparo: this.listarEventosDisparoVinculo(),
      estadoCorreoVinculo,
      reglaCompatibilidad:
        'El vínculo operativo nace del binding explícito monitor -> trigger. El alcance del trigger gobierna visibilidad y edición administrativa, pero no se vuelve a deducir desde el monitor.'
    };
  }

  async resolverNombresVisiblesVinculo(contextoUsuarioActual) {
    const [tenants, empresas, sitios] = await Promise.all([
      this.repositorioTenants?.listarVisibles?.(contextoUsuarioActual) || [],
      this.repositorioEmpresas?.listarVisibles?.(contextoUsuarioActual) || [],
      this.repositorioSitios?.listarVisibles?.(contextoUsuarioActual) || []
    ]);
    const nombresTenants = new Map(tenants.map(({ id, nombre }) => [String(id), nombre]));
    const nombresEmpresas = new Map(empresas.map(({ id, nombre }) => [String(id), nombre]));
    const nombresSitios = new Map(sitios.map(({ id, nombre }) => [String(id), nombre]));
    const nombrar = (mapa, tipo, id) =>
      `${mapa.get(String(id)) || tipo} #${id}`;

    return {
      contexto: {
        ...contextoUsuarioActual,
        tenantNombre: contextoUsuarioActual?.tenantNombre ||
          nombresTenants.get(String(contextoUsuarioActual?.tenantId)),
        empresaNombre: contextoUsuarioActual?.empresaNombre ||
          nombresEmpresas.get(String(contextoUsuarioActual?.empresaId)),
        sitioNombre: contextoUsuarioActual?.sitioNombre ||
          nombresSitios.get(String(contextoUsuarioActual?.sitioId))
      },
      describir: ({ tenantId, empresaId, sitioId }) => {
        if (sitioId != null) return nombrar(nombresSitios, 'Sitio', sitioId);
        if (empresaId != null) return nombrar(nombresEmpresas, 'Empresa', empresaId);
        if (tenantId != null) return nombrar(nombresTenants, 'Tenant', tenantId);
        return 'Portal completo';
      }
    };
  }

  async buscarMonitoresParaVinculoTrigger(
    contextoUsuarioActual,
    {
      textoBusqueda = '',
      tipo = null,
      soloActivos = false,
      pagina = 1,
      tamanoPagina = 10
    } = {}
  ) {
    const texto = String(textoBusqueda || '').trim().toLowerCase();
    const tamanoNormalizado = Math.min(
      Math.max(Number.parseInt(String(tamanoPagina || 10), 10) || 10, 1),
      25
    );
    const paginaSolicitada = Math.max(
      Number.parseInt(String(pagina || 1), 10) || 1,
      1
    );
    const [opcionesBase, nombresAlcance] = await Promise.all([
      this.servicioMonitores.obtenerOpcionesMonitoresEventos(
        contextoUsuarioActual,
        { tipo, soloActivos: Boolean(soloActivos) }
      ),
      this.resolverNombresVisiblesVinculo(contextoUsuarioActual)
    ]);
    const opciones = opcionesBase.map((monitor) => ({
      ...monitor,
      alcance: nombresAlcance.describir(monitor)
    }));
    const filtrados = opciones
      .filter((monitor) => {
        if (!texto) {
          return true;
        }

        return [
          monitor.valor,
          monitor.etiqueta,
          monitor.tipo,
          monitor.alcance,
          monitor.tenantId,
          monitor.empresaId,
          monitor.sitioId
        ]
          .filter((valor) => valor != null)
          .some((valor) => String(valor).toLowerCase().includes(texto));
      });
    const totalFiltrado = filtrados.length;
    const totalPaginas = Math.max(1, Math.ceil(totalFiltrado / tamanoNormalizado));
    const paginaEfectiva = Math.min(paginaSolicitada, totalPaginas);
    const inicio = (paginaEfectiva - 1) * tamanoNormalizado;
    const resultados = filtrados
      .slice(inicio, inicio + tamanoNormalizado)
      .map((monitor) => ({
        id: monitor.valor,
        nombre: monitor.etiqueta,
        tipo: monitor.tipo,
        tenantId: monitor.tenantId,
        empresaId: monitor.empresaId,
        sitioId: monitor.sitioId,
        alcance: monitor.alcance,
        activo: Boolean(monitor.activo)
      }));

    return {
      resultados,
      total: totalFiltrado,
      paginacion: {
        pagina: paginaEfectiva,
        tamanoPagina: tamanoNormalizado,
        totalFiltrado,
        totalPaginas,
        desde: totalFiltrado === 0 ? 0 : inicio + 1,
        hasta: Math.min(totalFiltrado, inicio + tamanoNormalizado)
      }
    };
  }

  async buscarTriggersParaVinculoMonitor(
    contextoUsuarioActual,
    {
      textoBusqueda = '',
      tipo = null,
      soloActivos = false,
      pagina = 1,
      tamanoPagina = 10
    } = {}
  ) {
    const texto = String(textoBusqueda || '').trim().toLowerCase();
    const tipoNormalizado = this.normalizarFiltroTipo(tipo);
    const tamanoNormalizado = Math.min(
      Math.max(Number.parseInt(String(tamanoPagina || 10), 10) || 10, 1),
      25
    );
    const paginaSolicitada = Math.max(
      Number.parseInt(String(pagina || 1), 10) || 1,
      1
    );
    const [triggers, nombresAlcance] = await Promise.all([
      this.servicioTriggers.listarTriggersVisibles(contextoUsuarioActual),
      this.resolverNombresVisiblesVinculo(contextoUsuarioActual)
    ]);
    const filtrados = triggers
      .filter((trigger) => {
        if (!this.esScopeTriggerValido(trigger) || !this.esTriggerVinculableEnModeloActual(trigger)) {
          return false;
        }

        if (tipoNormalizado && trigger.tipo !== tipoNormalizado) {
          return false;
        }

        if (soloActivos && !trigger.activo) {
          return false;
        }

        if (!texto) {
          return true;
        }

        return [
          trigger.id,
          trigger.nombre,
          trigger.descripcion,
          trigger.tipo,
          trigger.tenantNombre,
          trigger.empresaNombre,
          trigger.sitioNombre,
          trigger.alcanceDescripcion
        ]
          .filter((valor) => valor != null)
          .some((valor) => String(valor).toLowerCase().includes(texto));
      })
      .sort((a, b) =>
        String(a?.nombre || '').localeCompare(String(b?.nombre || ''), 'es')
      );
    const totalFiltrado = filtrados.length;
    const totalPaginas = Math.max(1, Math.ceil(totalFiltrado / tamanoNormalizado));
    const paginaEfectiva = Math.min(paginaSolicitada, totalPaginas);
    const inicio = (paginaEfectiva - 1) * tamanoNormalizado;
    const resultados = filtrados
      .slice(inicio, inicio + tamanoNormalizado)
      .map((trigger) => ({
        id: trigger.id,
        nombre: `${trigger.nombre} (#${trigger.id})`,
        descripcion: trigger.descripcion || '',
        tipo: trigger.tipo,
        tenantId: trigger.tenantId,
        empresaId: trigger.empresaId,
        sitioId: trigger.sitioId,
        nivelPertenencia: trigger.nivelPertenencia,
        alcance: nombresAlcance.describir(trigger),
        activo: Boolean(trigger.activo),
        scopeValido: true,
        puedeVincular: true
      }));

    return {
      resultados,
      total: totalFiltrado,
      paginacion: {
        pagina: paginaEfectiva,
        tamanoPagina: tamanoNormalizado,
        totalFiltrado,
        totalPaginas,
        desde: totalFiltrado === 0 ? 0 : inicio + 1,
        hasta: Math.min(totalFiltrado, inicio + tamanoNormalizado)
      }
    };
  }

  async crearVinculoMonitorTrigger(contextoUsuarioActual, datos) {
    const formulario = this.construirFormularioVinculoDesdeEntrada(datos);
    const monitor = await this.servicioMonitores.buscarMonitorVisible(
      contextoUsuarioActual,
      formulario.monitorId
    );
    const triggerVisible = await this.servicioTriggers.buscarTriggerVisiblePorId(
      contextoUsuarioActual,
      formulario.triggerId
    );

    if (!triggerVisible) {
      throw new Error('El trigger seleccionado no existe.');
    }
    if (triggerVisible.tipo === 'correo' && formulario.activo) {
      await this.exigirCapacidadCompletaCorreo(triggerVisible.id);
    }

    return this.servicioTriggers.crearAsignacionMonitorTrigger({
      monitorId: monitor.id,
      triggerId: triggerVisible.id,
      activo: formulario.activo,
      ordenEjecucion: formulario.ordenEjecucion,
      eventosDisparo: formulario.eventosDisparo,
      configuracionOverride: formulario.configuracionOverride
    }, { contextoUsuarioActual });
  }

  async actualizarVinculoMonitorTrigger(
    contextoUsuarioActual,
    idAsignacion,
    datos
  ) {
    const asignacionActual = await this.buscarAsignacionVisible(
      contextoUsuarioActual,
      idAsignacion
    );
    const formulario = this.construirFormularioVinculoDesdeEntrada(datos);
    const monitor = await this.servicioMonitores.buscarMonitorVisible(
      contextoUsuarioActual,
      formulario.monitorId
    );
    const triggerVisible = await this.servicioTriggers.buscarTriggerVisiblePorId(
      contextoUsuarioActual,
      formulario.triggerId
    );

    if (!triggerVisible) {
      throw new Error('El trigger seleccionado no existe.');
    }
    const parejaNueva = Number(asignacionActual.monitorId) !== Number(monitor.id) ||
      Number(asignacionActual.triggerId) !== Number(triggerVisible.id);
    const activacion = !asignacionActual.activo && formulario.activo;
    if (triggerVisible.tipo === 'correo' && formulario.activo &&
        (parejaNueva || activacion)) {
      await this.exigirCapacidadCompletaCorreo(triggerVisible.id);
    }

    return this.servicioTriggers.actualizarAsignacionMonitorTrigger(
      idAsignacion,
      {
        monitorId: monitor.id,
        triggerId: triggerVisible.id,
        activo: formulario.activo,
        ordenEjecucion: formulario.ordenEjecucion,
        eventosDisparo: formulario.eventosDisparo,
        configuracionOverride: formulario.configuracionOverride
      },
      { contextoUsuarioActual }
    );
  }

  async eliminarVinculoMonitorTrigger(contextoUsuarioActual, idAsignacion) {
    const asignacion = await this.buscarAsignacionVisible(
      contextoUsuarioActual,
      idAsignacion
    );
    await this.servicioTriggers.eliminarAsignacionMonitorTrigger(idAsignacion, {
      contextoUsuarioActual
    });
    return asignacion;
  }

  async resolverScopeTriggerObjetivoValido(contextoUsuarioActual, datos) {
    const nivelPertenencia = this.resolverNivelPertenenciaSolicitada(
      datos?.nivelPertenencia ?? datos?.nivel_pertenencia,
      datos?.tenantId ?? datos?.tenant_id,
      datos?.empresaId ?? datos?.empresa_id,
      datos?.sitioId ?? datos?.sitio_id
    );
    const tenantId = this.normalizarIdFormulario(
      datos?.tenantId ?? datos?.tenant_id
    );
    const empresaId = this.normalizarIdFormulario(
      datos?.empresaId ?? datos?.empresa_id
    );
    const sitioId = this.normalizarIdFormulario(
      datos?.sitioId ?? datos?.sitio_id
    );

    if (nivelPertenencia === 'portal') {
      this.assertDelegacionScopeTriggerValida(
        contextoUsuarioActual,
        'portal',
        {}
      );

      return {
        tenantId: null,
        empresaId: null,
        sitioId: null,
        nivelPertenencia: 'portal'
      };
    }

    if (nivelPertenencia === 'tenant') {
      if (tenantId == null) {
        throw new Error('Debes seleccionar un tenant para el trigger.');
      }

      const tenant =
        await this.repositorioTenants?.buscarPorId?.(tenantId) ||
        null;

      if (!tenant) {
        throw new Error('El tenant seleccionado no existe.');
      }

      this.assertDelegacionScopeTriggerValida(
        contextoUsuarioActual,
        'tenant',
        { tenant }
      );

      return {
        tenantId,
        empresaId: null,
        sitioId: null,
        nivelPertenencia: 'tenant'
      };
    }

    if (tenantId == null) {
      throw new Error('Debes seleccionar un tenant para el trigger.');
    }

    if (empresaId == null) {
      throw new Error('Debes seleccionar una empresa para el trigger.');
    }

    const [tenant, empresa, sitio] = await Promise.all([
      this.repositorioTenants?.buscarPorId?.(tenantId) || Promise.resolve(null),
      this.repositorioEmpresas?.buscarPorId?.(empresaId) || Promise.resolve(null),
      sitioId == null
        ? Promise.resolve(null)
        : this.repositorioSitios?.buscarPorId?.(sitioId) || Promise.resolve(null)
    ]);

    if (!tenant) {
      throw new Error('El tenant seleccionado no existe.');
    }

    if (!empresa) {
      throw new Error('La empresa seleccionada no existe.');
    }

    if (sitioId != null && !sitio) {
      throw new Error('El sitio seleccionado no existe.');
    }

    if (Number(empresa.tenantId) !== Number(tenantId)) {
      throw new Error('La empresa seleccionada no pertenece al tenant indicado.');
    }

    if (
      sitio &&
      (
        Number(sitio.tenantId) !== Number(tenantId) ||
        Number(sitio.empresaId) !== Number(empresaId)
      )
    ) {
      throw new Error(
        'El sitio seleccionado no pertenece a la empresa y tenant indicados.'
      );
    }

    this.assertDelegacionScopeTriggerValida(
      contextoUsuarioActual,
      nivelPertenencia,
      { tenant, empresa, sitio }
    );

    return {
      tenantId,
      empresaId,
      sitioId,
      nivelPertenencia
    };
  }

  assertDelegacionScopeTriggerValida(
    contextoUsuarioActual,
    nivelPertenenciaObjetivo,
    { tenant, empresa, sitio }
  ) {
    const profundidadEditor =
      PROFUNDIDAD_SCOPE[contextoUsuarioActual?.nivelScope] ?? Number.MAX_SAFE_INTEGER;
    const profundidadObjetivo =
      PROFUNDIDAD_SCOPE[nivelPertenenciaObjetivo] ?? Number.MAX_SAFE_INTEGER;

    if (profundidadObjetivo < profundidadEditor) {
      throw new Error(
        'Solo puedes crear o mover triggers en tu mismo alcance o en uno inferior.'
      );
    }

    if (nivelPertenenciaObjetivo === 'portal') {
      if (!contextoUsuarioActual?.esOperadorSistema) {
        throw new Error(
          'Solo un operador de sistema puede crear o mover triggers al ámbito portal.'
        );
      }

      return;
    }

    if (
      nivelPertenenciaObjetivo === 'tenant' &&
      !this.resolutorScopeUsuario?.puedeAlcanzarTenant?.(
        contextoUsuarioActual,
        tenant.id
      )
    ) {
      throw new Error(
        'No puedes trabajar con un trigger en un tenant fuera de tu alcance.'
      );
    }

    if (
      nivelPertenenciaObjetivo === 'empresa' &&
      !this.resolutorScopeUsuario?.puedeAlcanzarEmpresa?.(
        contextoUsuarioActual,
        empresa.id,
        tenant.id
      )
    ) {
      throw new Error(
        'No puedes trabajar con un trigger en una empresa fuera de tu alcance.'
      );
    }

    if (
      nivelPertenenciaObjetivo === 'sitio' &&
      !this.resolutorScopeUsuario?.puedeAlcanzarSitio?.(
        contextoUsuarioActual,
        sitio.id,
        empresa.id,
        tenant.id
      )
    ) {
      throw new Error(
        'No puedes trabajar con un trigger en un sitio fuera de tu alcance.'
      );
    }
  }

  normalizarIdFormulario(valor) {
    const normalizado = Number.parseInt(String(valor ?? '').trim(), 10);
    return Number.isInteger(normalizado) && normalizado > 0 ? normalizado : null;
  }

  esScopeTriggerValido(trigger) {
    if (!trigger) {
      return false;
    }

    const tenantId = this.normalizarIdFormulario(trigger.tenantId);
    const empresaId = this.normalizarIdFormulario(trigger.empresaId);
    const sitioId = this.normalizarIdFormulario(trigger.sitioId);
    const nivel = this.resolverNivelScopeTrigger({
      tenantId,
      empresaId,
      sitioId
    });

    return nivel !== 'invalido';
  }

  esTriggerVinculableEnModeloActual(trigger) {
    return this.esScopeTriggerValido(trigger);
  }

  async diagnosticarObjetivosDnsTriggers(triggers = []) {
    const resultado = new Map();
    const entradasDns = (Array.isArray(triggers) ? triggers : [])
      .map((trigger) => {
        const resumen = trigger?.serializarResumen?.() || trigger;
        return resumen?.tipo === 'dns' ? resumen : null;
      })
      .filter(Boolean);

    if (entradasDns.length === 0) {
      return resultado;
    }

    await Promise.all(
      entradasDns.map(async (trigger) => {
        resultado.set(
          Number(trigger.id),
          await this.diagnosticarObjetivoDnsTrigger(trigger)
        );
      })
    );

    return resultado;
  }

  async exigirObjetivoDnsTriggerValidoParaEditor(
    contextoUsuarioActual,
    definicion = {}
  ) {
    if (definicion?.tipo !== 'dns') {
      return true;
    }

    if (!this.repositorioZonasDns || !this.repositorioRegistrosDns) {
      throw new Error(
        'No se puede validar el objetivo DNS del trigger desde esta instancia del portal.'
      );
    }

    const trigger = this.construirTriggerDnsParaValidacion(definicion);
    const zonaId = this.normalizarIdFormulario(trigger.configuracion.zonaId);
    const registroId = this.normalizarIdFormulario(
      trigger.configuracion.registroId
    );

    if (zonaId == null || registroId == null) {
      throw new Error(
        'Debes indicar una zona y un registro DNS válidos para el trigger.'
      );
    }

    const zonaVisible =
      await this.repositorioZonasDns.buscarVisiblePorId?.(
        contextoUsuarioActual,
        zonaId
      );

    if (!zonaVisible) {
      throw new Error(
        'No puedes usar una zona DNS fuera de tu alcance como objetivo del trigger.'
      );
    }

    const diagnostico = await this.diagnosticarObjetivoDnsTrigger(trigger);

    if (diagnostico?.valido !== true) {
      throw new Error(
        diagnostico?.mensaje ||
          'El objetivo DNS del trigger no es válido. Revisa zona, registro, gobernanza y rol.'
      );
    }

    const registro = await this.repositorioRegistrosDns.buscarPorId(registroId);

    if (!this.scopeTriggerContieneRegistro(trigger, registro)) {
      throw new Error(
        'El alcance administrativo del trigger no contiene el registro DNS objetivo.'
      );
    }

    if (trigger.configuracion.operacion === 'editar_valor') {
      try {
        validadorRegistroDns.normalizarValorPrincipalConPrioridad(
          registro.tipoRegistro,
          trigger.configuracion.valorPrincipal,
          registro.prioridad
        );
      } catch (error) {
        throw new Error(
          `El nuevo valor no es válido para un registro ${registro.tipoRegistro}: ${error.message}`
        );
      }
    }

    return true;
  }

  construirTriggerDnsParaValidacion(definicion = {}) {
    const tenantId = this.normalizarIdFormulario(definicion.tenantId);
    const empresaId = this.normalizarIdFormulario(definicion.empresaId);
    const sitioId = this.normalizarIdFormulario(definicion.sitioId);

    return {
      id: definicion.id ?? null,
      tipo: 'dns',
      tenantId,
      empresaId,
      sitioId,
      nivelPertenencia: this.resolverNivelScopeTrigger({
        tenantId,
        empresaId,
        sitioId
      }),
      configuracion: {
        zonaId: definicion.zonaId,
        registroId: definicion.registroId,
        operacion: definicion.operacion,
        valorPrincipal: definicion.valorPrincipal,
        rolGobernanza: definicion.rolGobernanza
      }
    };
  }

  scopeTriggerContieneRegistro(trigger = {}, registro) {
    if (!registro) {
      return false;
    }

    const nivel = trigger?.nivelPertenencia || this.resolverNivelScopeTrigger({
      tenantId: trigger?.tenantId,
      empresaId: trigger?.empresaId,
      sitioId: trigger?.sitioId
    });

    if (nivel === 'portal') {
      return true;
    }

    if (nivel === 'tenant') {
      return Number(trigger.tenantId) === Number(registro.tenantId);
    }

    if (nivel === 'empresa') {
      return (
        Number(trigger.tenantId) === Number(registro.tenantId) &&
        Number(trigger.empresaId) === Number(registro.empresaId)
      );
    }

    if (nivel === 'sitio') {
      return (
        Number(trigger.tenantId) === Number(registro.tenantId) &&
        Number(trigger.empresaId) === Number(registro.empresaId) &&
        Number(trigger.sitioId) === Number(registro.sitioId)
      );
    }

    return false;
  }

  async diagnosticarObjetivoDnsTrigger(trigger = {}) {
    const configuracion = trigger.configuracion || {};
    const zonaId = this.normalizarIdFormulario(configuracion.zonaId);
    const registroId = this.normalizarIdFormulario(configuracion.registroId);

    if (trigger.tipo !== 'dns') {
      return null;
    }

    if (zonaId == null || registroId == null) {
      return {
        valido: false,
        estado: 'incompleto',
        mensaje:
          'La acción DNS no tiene zona o registro objetivo configurado.'
      };
    }

    if (!this.repositorioZonasDns || !this.repositorioRegistrosDns) {
      return {
        valido: null,
        estado: 'sin_verificacion',
        mensaje:
          'No se pudo verificar el objetivo DNS desde esta instancia del portal.'
      };
    }

    const [zona, registro] = await Promise.all([
      this.repositorioZonasDns.buscarPorId(zonaId),
      this.repositorioRegistrosDns.buscarPorId(registroId)
    ]);

    if (!zona) {
      return {
        valido: false,
        estado: 'zona_huerfana',
        mensaje:
          `La zona DNS #${zonaId} ya no existe. Revisa el objetivo del trigger.`
      };
    }

    if (!registro) {
      return {
        valido: false,
        estado: 'registro_huerfano',
        mensaje:
          `El registro DNS #${registroId} ya no existe. Reasigna o elimina este trigger.`
      };
    }

    if (Number(registro.zonaId) !== Number(zona.id)) {
      return {
        valido: false,
        estado: 'zona_registro_incoherentes',
        mensaje:
          `El registro #${registroId} pertenece a la zona #${registro.zonaId}, no a la zona #${zonaId}.`
      };
    }

    const gobernanza = registro.resolverGobernanzaAutomatica?.() || null;

    if (gobernanza?.gobernadoPor !== 'trigger') {
      return {
        valido: false,
        estado: 'registro_no_gobernado_por_trigger',
        mensaje:
          'El registro objetivo ya no está gobernado por triggers.'
      };
    }

    if (
      gobernanza.rolAsignado &&
      gobernanza.rolAsignado !== configuracion.rolGobernanza
    ) {
      return {
        valido: false,
        estado: 'rol_incompatible',
        mensaje:
          `El registro exige rol ${gobernanza.rolAsignado}, pero el trigger declara ${configuracion.rolGobernanza || 'ninguno'}.`
      };
    }

    return {
      valido: true,
      estado: 'ok',
      mensaje:
        `Objetivo DNS verificado: ${registro.construirNombreVisible?.() || `registro #${registroId}`}.`,
      zona: {
        id: zona.id,
        nombre: zona.nombreZona || null
      },
      registro: {
        id: registro.id,
        nombreVisible: registro.construirNombreVisible?.() || null,
        tipoRegistro: registro.tipoRegistro,
        valorPrincipal: registro.valorPrincipal,
        prioridad: registro.prioridad,
        activo: Boolean(registro.activo),
        publicarEnBind: Boolean(registro.publicarEnBind),
        gobernadoPor: gobernanza.gobernadoPor,
        rolAsignado: gobernanza.rolAsignado
      }
    };
  }

  serializarObjetivoDnsTrigger(registro) {
    const gobernanza = registro.resolverGobernanzaAutomatica?.() || null;

    return {
      zonaId: registro.zonaId,
      zonaNombre: registro.nombreZona,
      registroId: registro.id,
      nombreVisible: registro.construirNombreVisible?.() || null,
      ownerBind: registro.construirOwnerBind?.() || null,
      tipoRegistro: registro.tipoRegistro,
      valorPrincipal: registro.valorPrincipal,
      prioridad: registro.prioridad,
      activo: Boolean(registro.activo),
      publicarEnBind: Boolean(registro.publicarEnBind),
      ttlSegundos: registro.ttlSegundos,
      nivelPertenencia: registro.resolverNivelPertenencia?.() || null,
      alcanceDescripcion: this.construirDescripcionScopeBasica({
        tenantNombre: registro.tenantNombre,
        empresaNombre: registro.empresaNombre,
        sitioNombre: registro.sitioNombre
      }),
      gobernanza: {
        gobernadoPor: gobernanza?.gobernadoPor || null,
        rolAsignado: gobernanza?.rolAsignado || null,
        modoControl: gobernanza?.modoControl || null
      }
    };
  }

  construirDescripcionScopeBasica({
    tenantNombre = null,
    empresaNombre = null,
    sitioNombre = null
  } = {}) {
    return [tenantNombre, empresaNombre, sitioNombre]
      .filter(Boolean)
      .join(' · ') || 'Portal completo';
  }

  async construirVistaVinculosMonitorDetalle(
    contextoUsuarioActual,
    idMonitor,
    {
      permitirDetalleTrigger = true
    } = {}
  ) {
    const monitor = await this.servicioMonitores.buscarMonitorVisible(
      contextoUsuarioActual,
      idMonitor
    );
    const [asignaciones, ejecuciones] = await Promise.all([
      this.servicioTriggers.listarAsignacionesPorMonitor(idMonitor, {
        soloActivas: false
      }),
      this.servicioTriggers.listarEjecucionesPorMonitor(idMonitor, {
        limit: 20
      })
    ]);
    const triggerIds = Array.from(
      new Set(
        asignaciones
          .map((asignacion) => Number(asignacion.triggerId))
          .filter((id) => Number.isInteger(id) && id > 0)
      )
    );
    const triggers = permitirDetalleTrigger
      ? await this.servicioTriggers.listarTriggersVisiblesPorIds(
        contextoUsuarioActual,
        triggerIds
      )
      : [];
    const triggersPorId = new Map(triggers.map((trigger) => [trigger.id, trigger]));
    const ejecucionRecientePorAsignacion = new Map();

    for (const ejecucion of ejecuciones) {
      const asignacionId = Number(ejecucion.asignacionTriggerMonitorId || 0);

      if (
        Number.isInteger(asignacionId) &&
        asignacionId > 0 &&
        !ejecucionRecientePorAsignacion.has(asignacionId)
      ) {
        ejecucionRecientePorAsignacion.set(asignacionId, ejecucion);
      }
    }

    const asignacionesDetalladas = asignaciones
      .map((asignacion) =>
        this.serializarAsignacionVisible({
          ...asignacion,
          trigger: triggersPorId.get(asignacion.triggerId) || null,
          ultimaEjecucion:
            ejecucionRecientePorAsignacion.get(Number(asignacion.id)) || null
        })
      )
      .sort((a, b) =>
        Number(a.ordenEjecucion || 0) - Number(b.ordenEjecucion || 0) ||
        Number(a.id || 0) - Number(b.id || 0)
      );

    return {
      monitor: monitor.serializarResumen?.() || monitor,
      totalAsignaciones: asignacionesDetalladas.length,
      asignacionesActivas: asignacionesDetalladas.filter((item) => item.activo).length,
      asignaciones: asignacionesDetalladas
    };
  }

  async buscarAsignacionVisible(contextoUsuarioActual, idAsignacion) {
    const asignacion =
      await this.servicioTriggers.buscarAsignacionMonitorTriggerPorId(
        idAsignacion
      );

    if (!asignacion) {
      throw new Error('La asignación monitor-trigger no existe.');
    }

    await this.servicioMonitores.buscarMonitorVisible(
      contextoUsuarioActual,
      asignacion.monitorId
    );
    const triggerVisible = await this.servicioTriggers.buscarTriggerVisiblePorId(
      contextoUsuarioActual,
      asignacion.triggerId
    );

    if (!triggerVisible) {
      throw new Error('La asignación monitor-trigger no está visible con tu alcance actual.');
    }

    return asignacion;
  }

  serializarAsignacionVisible(asignacion) {
    if (asignacion?.trigger) {
      return {
        ...asignacion,
        triggerVisible: true,
        puedeGestionarVinculo: true
      };
    }

    return {
      ...asignacion,
      triggerVisible: false,
      puedeGestionarVinculo: false,
      triggerNombre: `Trigger #${asignacion?.triggerId || '?'}`,
      triggerTipo: '',
      triggerDescripcion: 'Detalle oculto por alcance.'
    };
  }

  construirFormularioVinculoDesdeAsignacion(asignacion) {
    return {
      id: asignacion.id,
      triggerId: String(asignacion.triggerId ?? ''),
      monitorId: String(asignacion.monitorId ?? ''),
      activo: Boolean(asignacion.activo),
      ordenEjecucion: String(asignacion.ordenEjecucion ?? 100),
      eventosDisparo: Array.isArray(asignacion.eventosDisparo)
        ? [...asignacion.eventosDisparo]
        : ['apertura_alerta'],
      configuracionOverride: serializarJsonBonito(asignacion.configuracionOverride)
    };
  }

  listarDefinicionesTipo() {
    return Object.values(DEFINICIONES_TIPO_TRIGGER);
  }

  listarEventosDisparoVinculo() {
    return [...EVENTOS_DISPARO_VINCULO];
  }

  obtenerDefinicionTipo(tipo) {
    const tipoNormalizado = String(tipo || '').trim().toLowerCase();
    const definicion = DEFINICIONES_TIPO_TRIGGER[tipoNormalizado];

    if (!definicion) {
      throw new Error(`El tipo de trigger ${tipoNormalizado || '(vacío)'} no está soportado en portal.`);
    }

    return definicion;
  }

  resolverTipoFormulario(...candidatos) {
    for (const candidato of candidatos) {
      const tipo = String(candidato || '').trim().toLowerCase();

      if (tipo && DEFINICIONES_TIPO_TRIGGER[tipo]) {
        return tipo;
      }
    }

    return 'api';
  }

  construirFormularioNuevo(tipo, contextoUsuarioActual = null) {
    const tipoNormalizado = this.resolverTipoFormulario(tipo);
    const tenantId =
      contextoUsuarioActual?.tenantId == null
        ? ''
        : String(contextoUsuarioActual.tenantId);
    const empresaId =
      contextoUsuarioActual?.empresaId == null
        ? ''
        : String(contextoUsuarioActual.empresaId);
    const sitioId =
      contextoUsuarioActual?.sitioId == null
        ? ''
        : String(contextoUsuarioActual.sitioId);
    const nivelPertenencia =
      contextoUsuarioActual?.nivelScope === 'sitio'
        ? 'sitio'
        : contextoUsuarioActual?.nivelScope === 'empresa'
          ? 'empresa'
          : contextoUsuarioActual?.nivelScope === 'tenant'
            ? 'tenant'
            : 'portal';

    if (tipoNormalizado === 'api') {
      return {
        id: null,
        tenantId,
        empresaId,
        sitioId,
        nivelPertenencia,
        nombre: '',
        tipo: 'api',
        descripcion: '',
        activo: true,
        url: '',
        metodo: 'POST',
        timeoutMs: '5000',
        reintentos: '0',
        permiteTlsInseguro: false,
        cabeceras: '',
        plantillaCuerpo: '',
        parametroOpcional: ''
      };
    }

    if (tipoNormalizado === 'dns') {
      return {
        id: null,
        tenantId,
        empresaId,
        sitioId,
        nivelPertenencia,
        nombre: '',
        tipo: 'dns',
        descripcion: '',
        activo: true,
        zonaId: '',
        registroId: '',
        operacion: 'editar_valor',
        valorPrincipal: '',
        rolGobernanza: ''
      };
    }

    if (tipoNormalizado === 'correo') {
      return {
        id: null,
        tenantId,
        empresaId,
        sitioId,
        nivelPertenencia,
        nombre: '',
        tipo: 'correo',
        descripcion: '',
        activo: false,
        versionCorreo: String(VERSION_CONFIGURACION_TRIGGER_CORREO),
        asuntoPlantilla: ASUNTO_PLANTILLA_TRIGGER_CORREO_POR_DEFECTO,
        textoIntroduccion: '',
        textoCierre: ''
      };
    }

    throw new Error(`El tipo de trigger ${tipoNormalizado} no está soportado en portal.`);
  }

  construirFormularioDesdeTrigger(trigger) {
    const configuracion = trigger?.configuracion || {};
    const tipo = this.resolverTipoFormulario(trigger?.tipo);

    if (tipo === 'api') {
      return {
        id: trigger.id,
        revisionDeclaracion: trigger.revisionDeclaracion,
        tenantId: trigger.tenantId ?? '',
        empresaId: trigger.empresaId ?? '',
        sitioId: trigger.sitioId ?? '',
        nivelPertenencia: this.resolverNivelScopeTrigger({
          tenantId: this.normalizarIdFormulario(trigger.tenantId),
          empresaId: this.normalizarIdFormulario(trigger.empresaId),
          sitioId: this.normalizarIdFormulario(trigger.sitioId)
        }),
        nombre: trigger.nombre || '',
        tipo,
        descripcion: trigger.descripcion || '',
        activo: Boolean(trigger.activo),
        url: configuracion.url || '',
        metodo: configuracion.metodo || 'POST',
        timeoutMs: String(configuracion.timeoutMs ?? 5000),
        reintentos: String(configuracion.reintentos ?? 0),
        permiteTlsInseguro: Boolean(configuracion.permiteTlsInseguro),
        cabeceras: serializarJsonBonito(configuracion.cabeceras),
        plantillaCuerpo: configuracion.plantillaCuerpo || '',
        parametroOpcional: configuracion.parametroOpcional || ''
      };
    }

    if (tipo === 'dns') {
      return {
        id: trigger.id,
        revisionDeclaracion: trigger.revisionDeclaracion,
        tenantId: trigger.tenantId ?? '',
        empresaId: trigger.empresaId ?? '',
        sitioId: trigger.sitioId ?? '',
        nivelPertenencia: this.resolverNivelScopeTrigger({
          tenantId: this.normalizarIdFormulario(trigger.tenantId),
          empresaId: this.normalizarIdFormulario(trigger.empresaId),
          sitioId: this.normalizarIdFormulario(trigger.sitioId)
        }),
        nombre: trigger.nombre || '',
        tipo,
        descripcion: trigger.descripcion || '',
        activo: Boolean(trigger.activo),
        zonaId: String(configuracion.zonaId ?? ''),
        registroId: String(configuracion.registroId ?? ''),
        operacion: configuracion.operacion || 'editar_valor',
        valorPrincipal: configuracion.valorPrincipal || '',
        rolGobernanza: configuracion.rolGobernanza || ''
      };
    }

    if (tipo === 'correo') {
      return {
        id: trigger.id,
        revisionDeclaracion: trigger.revisionDeclaracion,
        tenantId: trigger.tenantId ?? '',
        empresaId: trigger.empresaId ?? '',
        sitioId: trigger.sitioId ?? '',
        nivelPertenencia: this.resolverNivelScopeTrigger({
          tenantId: this.normalizarIdFormulario(trigger.tenantId),
          empresaId: this.normalizarIdFormulario(trigger.empresaId),
          sitioId: this.normalizarIdFormulario(trigger.sitioId)
        }),
        nombre: trigger.nombre || '',
        tipo,
        descripcion: trigger.descripcion || '',
        activo: Boolean(trigger.activo),
        versionCorreo: String(configuracion.version ?? VERSION_CONFIGURACION_TRIGGER_CORREO),
        asuntoPlantilla:
          configuracion.asuntoPlantilla || ASUNTO_PLANTILLA_TRIGGER_CORREO_POR_DEFECTO,
        textoIntroduccion: configuracion.textoIntroduccion || '',
        textoCierre: configuracion.textoCierre || ''
      };
    }

    throw new Error(`El tipo de trigger ${tipo} no está soportado en portal.`);
  }

  construirFormularioDesdeEntrada(datos, tipoSugerido = null) {
    const tipo = this.resolverTipoFormulario(datos?.tipo, tipoSugerido);

    if (tipo === 'api') {
      return {
        id: datos?.id ?? null,
        revisionDeclaracion: datos?.revisionDeclaracion ??
          datos?.revision_declaracion ?? null,
        tenantId: String(datos?.tenantId ?? datos?.tenant_id ?? '').trim(),
        empresaId: String(datos?.empresaId ?? datos?.empresa_id ?? '').trim(),
        sitioId: String(datos?.sitioId ?? datos?.sitio_id ?? '').trim(),
        nivelPertenencia: this.resolverNivelPertenenciaSolicitada(
          datos?.nivelPertenencia ?? datos?.nivel_pertenencia,
          datos?.tenantId ?? datos?.tenant_id,
          datos?.empresaId ?? datos?.empresa_id,
          datos?.sitioId ?? datos?.sitio_id
        ),
        nombre: String(datos?.nombre || '').trim(),
        tipo,
        descripcion: String(datos?.descripcion || ''),
        activo: normalizarBooleano(datos?.activo, true),
        url: String(datos?.url || '').trim(),
        metodo: String(datos?.metodo || 'POST').trim().toUpperCase(),
        timeoutMs: String(datos?.timeoutMs ?? datos?.timeout_ms ?? '5000').trim(),
        reintentos: String(datos?.reintentos ?? '0').trim(),
        permiteTlsInseguro: normalizarBooleano(
          datos?.permiteTlsInseguro ?? datos?.permite_tls_inseguro,
          false
        ),
        cabeceras: String(datos?.cabeceras || '').trim(),
        plantillaCuerpo: String(
          datos?.plantillaCuerpo ?? datos?.plantilla_cuerpo ?? ''
        ),
        parametroOpcional: String(
          datos?.parametroOpcional ?? datos?.parametro_opcional ?? ''
        ).trim()
      };
    }

    if (tipo === 'dns') {
      return {
        id: datos?.id ?? null,
        revisionDeclaracion: datos?.revisionDeclaracion ??
          datos?.revision_declaracion ?? null,
        tenantId: String(datos?.tenantId ?? datos?.tenant_id ?? '').trim(),
        empresaId: String(datos?.empresaId ?? datos?.empresa_id ?? '').trim(),
        sitioId: String(datos?.sitioId ?? datos?.sitio_id ?? '').trim(),
        nivelPertenencia: this.resolverNivelPertenenciaSolicitada(
          datos?.nivelPertenencia ?? datos?.nivel_pertenencia,
          datos?.tenantId ?? datos?.tenant_id,
          datos?.empresaId ?? datos?.empresa_id,
          datos?.sitioId ?? datos?.sitio_id
        ),
        nombre: String(datos?.nombre || '').trim(),
        tipo,
        descripcion: String(datos?.descripcion || ''),
        activo: normalizarBooleano(datos?.activo, true),
        zonaId: String(datos?.zonaId ?? datos?.zona_id ?? '').trim(),
        registroId: String(datos?.registroId ?? datos?.registro_id ?? '').trim(),
        operacion: String(datos?.operacion ?? 'editar_valor').trim().toLowerCase(),
        valorPrincipal: String(
          datos?.valorPrincipal ?? datos?.valor_principal ?? ''
        ).trim(),
        rolGobernanza: String(
          datos?.rolGobernanza ?? datos?.rol_gobernanza ?? ''
        ).trim()
      };
    }

    if (tipo === 'correo') {
      return {
        id: datos?.id ?? null,
        revisionDeclaracion: datos?.revisionDeclaracion ??
          datos?.revision_declaracion ?? null,
        tenantId: String(datos?.tenantId ?? datos?.tenant_id ?? '').trim(),
        empresaId: String(datos?.empresaId ?? datos?.empresa_id ?? '').trim(),
        sitioId: String(datos?.sitioId ?? datos?.sitio_id ?? '').trim(),
        nivelPertenencia: this.resolverNivelPertenenciaSolicitada(
          datos?.nivelPertenencia ?? datos?.nivel_pertenencia,
          datos?.tenantId ?? datos?.tenant_id,
          datos?.empresaId ?? datos?.empresa_id,
          datos?.sitioId ?? datos?.sitio_id
        ),
        nombre: String(datos?.nombre || '').trim(),
        tipo,
        descripcion: String(datos?.descripcion || ''),
        activo: normalizarBooleano(datos?.activo, false),
        versionCorreo: String(
          datos?.versionCorreo ?? datos?.version_correo ?? VERSION_CONFIGURACION_TRIGGER_CORREO
        ).trim(),
        asuntoPlantilla: String(
          datos?.asuntoPlantilla ?? datos?.asunto_plantilla ??
            ASUNTO_PLANTILLA_TRIGGER_CORREO_POR_DEFECTO
        ),
        textoIntroduccion: String(
          datos?.textoIntroduccion ?? datos?.texto_introduccion ?? ''
        ),
        textoCierre: String(datos?.textoCierre ?? datos?.texto_cierre ?? '')
      };
    }

    throw new Error(`El tipo de trigger ${tipo} no está soportado en portal.`);
  }

  resolverNivelPertenenciaSolicitada(
    nivelPertenencia,
    tenantId = null,
    empresaId = null,
    sitioId = null
  ) {
    const normalizado = String(nivelPertenencia || '').trim().toLowerCase();

    if (normalizado === 'portal') {
      return 'portal';
    }

    if (normalizado === 'tenant') {
      return 'tenant';
    }

    if (normalizado === 'sitio') {
      return 'sitio';
    }

    if (normalizado === 'empresa') {
      return 'empresa';
    }

    return this.resolverNivelScopeTrigger({
      tenantId: this.normalizarIdFormulario(tenantId),
      empresaId: this.normalizarIdFormulario(empresaId),
      sitioId: this.normalizarIdFormulario(sitioId)
    });
  }

  resolverNivelPertenenciaFormulario(formulario = {}) {
    return this.resolverNivelPertenenciaSolicitada(
      formulario?.nivelPertenencia,
      formulario?.tenantId,
      formulario?.empresaId,
      formulario?.sitioId
    );
  }

  resolverRestriccionesScopeTrigger(contextoUsuarioActual, nivelPertenencia) {
    const contexto = contextoUsuarioActual || {};

    if (contexto.nivelScope === 'tenant') {
      return {
        tenantBloqueado: true,
        empresaBloqueada: false,
        sitioBloqueadoPorScope: false,
        nivelPertenenciaFijo: null,
        mensajeScope:
          'El tenant de tu sesión ya está seleccionado. Puedes ubicar la acción en ese tenant, una empresa o uno de sus sitios.'
      };
    }

    if (contexto.nivelScope === 'empresa') {
      return {
        tenantBloqueado: true,
        empresaBloqueada: true,
        sitioBloqueadoPorScope: false,
        nivelPertenenciaFijo: null,
        mensajeScope:
          'El tenant y la empresa de tu sesión ya están seleccionados. Puedes ubicar la acción en esa empresa o en uno de sus sitios.'
      };
    }

    if (contexto.nivelScope === 'sitio') {
      return {
        tenantBloqueado: true,
        empresaBloqueada: true,
        sitioBloqueadoPorScope: true,
        nivelPertenenciaFijo: 'sitio',
        mensajeScope:
          'La acción quedará en el sitio de tu sesión; no puedes cambiar su ubicación.'
      };
    }

    return {
      tenantBloqueado: false,
      empresaBloqueada: false,
      sitioBloqueadoPorScope: false,
      nivelPertenenciaFijo: null,
      mensajeScope:
        'Elige portal, tenant, empresa o sitio. Los campos se habilitan según la opción.'
    };
  }

  listarOpcionesPertenenciaDisponibles(contextoUsuarioActual = {}) {
    if (contextoUsuarioActual.nivelScope === 'sitio') {
      return [
        { valor: 'sitio', etiqueta: 'Acción de sitio' }
      ];
    }

    if (contextoUsuarioActual.nivelScope === 'empresa') {
      return [
        { valor: 'empresa', etiqueta: 'Acción de empresa' },
        { valor: 'sitio', etiqueta: 'Acción de sitio' }
      ];
    }

    if (contextoUsuarioActual.nivelScope === 'tenant') {
      return [
        { valor: 'tenant', etiqueta: 'Acción de tenant' },
        { valor: 'empresa', etiqueta: 'Acción de empresa' },
        { valor: 'sitio', etiqueta: 'Acción de sitio' }
      ];
    }

    return [
      { valor: 'portal', etiqueta: 'Acción de portal' },
      { valor: 'tenant', etiqueta: 'Acción de tenant' },
      { valor: 'empresa', etiqueta: 'Acción de empresa' },
      { valor: 'sitio', etiqueta: 'Acción de sitio' }
    ];
  }

  resolverNivelScopeTrigger({
    tenantId = null,
    empresaId = null,
    sitioId = null
  } = {}) {
    if (tenantId == null && empresaId == null && sitioId == null) {
      return 'portal';
    }

    if (tenantId != null && empresaId == null && sitioId == null) {
      return 'tenant';
    }

    if (tenantId != null && empresaId != null && sitioId == null) {
      return 'empresa';
    }

    if (tenantId != null && empresaId != null && sitioId != null) {
      return 'sitio';
    }

    return 'invalido';
  }

  construirFormularioVinculoNuevo(
    triggerPreseleccionado = null,
    monitorPreseleccionadoId = null
  ) {
    return {
      triggerId: triggerPreseleccionado?.id ?? '',
      monitorId:
        monitorPreseleccionadoId == null ? '' : String(monitorPreseleccionadoId),
      activo: true,
      ordenEjecucion: '100',
      eventosDisparo: ['apertura_alerta'],
      configuracionOverride: ''
    };
  }

  construirFormularioVinculoDesdeEntrada(datos) {
    const eventosDisparoEntrada = Array.isArray(datos?.eventosDisparo)
      ? datos.eventosDisparo
      : Array.isArray(datos?.eventos_disparo)
        ? datos.eventos_disparo
        : (datos?.eventosDisparo ?? datos?.eventos_disparo ?? null);

    return {
      triggerId: String(datos?.triggerId ?? datos?.trigger_id ?? '').trim(),
      monitorId: String(datos?.monitorId ?? datos?.monitor_id ?? '').trim(),
      activo: normalizarBooleano(datos?.activo, true),
      ordenEjecucion: String(
        datos?.ordenEjecucion ?? datos?.orden_ejecucion ?? '100'
      ).trim(),
      eventosDisparo: this.normalizarFormularioEventosDisparo(
        eventosDisparoEntrada
      ),
      configuracionOverride: String(
        datos?.configuracionOverride ?? datos?.configuracion_override ?? ''
      ).trim()
    };
  }

  normalizarFormularioEventosDisparo(valor) {
    if (Array.isArray(valor)) {
      return valor.map((item) => String(item || '').trim()).filter(Boolean);
    }

    if (valor == null || valor === '') {
      return ['apertura_alerta'];
    }

    return [String(valor).trim()].filter(Boolean);
  }

  normalizarFiltroActivo(valor) {
    const normalizado = String(valor || '').trim().toLowerCase();
    return ['solo_activos', 'solo_inactivos', 'todos'].includes(normalizado)
      ? normalizado
      : 'todos';
  }

  normalizarFiltroId(valor) {
    const normalizado = String(valor ?? '').trim();
    return normalizado || '';
  }

  normalizarFiltroTipo(valor) {
    const normalizado = String(valor || '').trim().toLowerCase();
    return TIPOS_TRIGGER.includes(normalizado) ? normalizado : '';
  }

  normalizarFiltroSaludTrigger(valor) {
    const normalizado = String(valor || '').trim().toLowerCase();
    return normalizado === 'requieren_revision' ? normalizado : '';
  }

  normalizarFiltroEvento(valor) {
    const normalizado = String(valor || '').trim().toLowerCase();
    return ['apertura_alerta', 'cierre_alerta'].includes(normalizado)
      ? normalizado
      : '';
  }

  normalizarPaginaListado(valor) {
    const numero = Number.parseInt(valor, 10);
    return Number.isFinite(numero) && numero > 0 ? numero : 1;
  }

  normalizarTamanoPaginaListado(valor) {
    const numero = Number.parseInt(valor, 10);
    return [10, 25, 50, 100].includes(numero) ? numero : 10;
  }

  async cargarUsoOperativoTriggers(contextoUsuarioActual, triggers = []) {
    const idsTrigger = [
      ...new Set(
        (triggers || [])
          .map((trigger) => Number(trigger?.id))
          .filter((id) => Number.isInteger(id) && id > 0)
      )
    ];

    if (!idsTrigger.length || !this.servicioTriggers) {
      return new Map();
    }

    const [resumenUso, ultimasEjecuciones] = await Promise.all([
      this.servicioTriggers.resumirUsoOperativoPorTriggerIdsVisible(
        contextoUsuarioActual,
        idsTrigger
      ),
      this.servicioTriggers.listarUltimasEjecucionesPorTriggerIdsVisible(
        contextoUsuarioActual,
        idsTrigger
      )
    ]);

    return new Map(
      idsTrigger.map((idTrigger) => [
        idTrigger,
        {
          resumen: resumenUso.get(idTrigger) || null,
          ultimaEjecucion: ultimasEjecuciones.get(idTrigger) || null
        }
      ])
    );
  }

  construirUsoOperativoTrigger(idTrigger, usosOperativos = new Map()) {
    const uso = usosOperativos.get(Number(idTrigger)) || {};
    const resumen = uso.resumen || {};
    const ultimaEjecucion = uso.ultimaEjecucion || null;
    const totalVinculos = Number(resumen.totalVinculos || 0);
    const totalVinculosActivos = Number(resumen.totalVinculosActivos || 0);
    const totalVinculosInactivos = Number(resumen.totalVinculosInactivos || 0);
    const totalMonitores = Number(resumen.totalMonitores || 0);
    const totalMonitoresActivos = Number(resumen.totalMonitoresActivos || 0);

    return {
      totalVinculos,
      totalVinculosActivos,
      totalVinculosInactivos,
      totalMonitores,
      totalMonitoresActivos,
      tieneUso: totalVinculos > 0,
      tieneUsoActivo: totalVinculosActivos > 0,
      hayEjecucion: Boolean(ultimaEjecucion),
      hayErrorReciente: ultimaEjecucion?.estadoEjecucion === 'error',
      ultimaEjecucion
    };
  }

  serializarTriggerAdministracion(
    trigger,
    diagnosticosDns = new Map(),
    usosOperativos = new Map()
  ) {
    const resumen = trigger.serializarResumen();
    const scopeValido = this.esScopeTriggerValido(resumen);
    const objetivoDns = diagnosticosDns.get(Number(resumen.id)) || null;
    const usoOperativo = this.construirUsoOperativoTrigger(
      resumen.id,
      usosOperativos
    );
    const puedeVincular =
      this.esTriggerVinculableEnModeloActual(resumen) &&
      objetivoDns?.valido !== false;

    return {
      ...resumen,
      objetivoDns,
      scopeValido,
      puedeVincular,
      usoOperativo,
      totalVinculos: usoOperativo.totalVinculos,
      definicionTipo: this.obtenerDefinicionTipo(resumen.tipo),
      resumenConfiguracion: this.construirResumenConfiguracion(
        resumen.tipo,
        resumen.configuracion
      ),
      urls: {
        editar: `/monitores/triggers/editar/${resumen.id}`,
        nuevoVinculo:
          `/monitores/triggers/vinculos/nuevo?trigger_id=${encodeURIComponent(resumen.id)}&return_to=${encodeURIComponent('/automatizacion/acciones')}`
      }
    };
  }

  triggerAdministracionCumpleFiltros(
    trigger,
    {
      texto = '',
      tenantId = null,
      empresaId = null,
      sitioId = null,
      tipo = '',
      activo = 'todos',
      salud = ''
    } = {}
  ) {
    if (tenantId != null && Number(trigger.tenantId) !== Number(tenantId)) {
      return false;
    }

    if (empresaId != null && Number(trigger.empresaId) !== Number(empresaId)) {
      return false;
    }

    if (sitioId != null && Number(trigger.sitioId) !== Number(sitioId)) {
      return false;
    }

    if (tipo && trigger.tipo !== tipo) {
      return false;
    }

    if (activo === 'solo_activos' && !trigger.activo) {
      return false;
    }

    if (activo === 'solo_inactivos' && trigger.activo) {
      return false;
    }

    if (salud === 'requieren_revision' && this.esTriggerAdministracionSano(trigger)) {
      return false;
    }

    if (!texto) {
      return true;
    }

    const camposBusqueda = [
      trigger.id,
      trigger.nombre,
      trigger.descripcion,
      trigger.tipo,
      trigger.tenantNombre,
      trigger.empresaNombre,
      trigger.sitioNombre,
      trigger.resumenConfiguracion?.principal,
      ...(trigger.resumenConfiguracion?.secundaria || []),
      trigger.resumenConfiguracion?.detalle
    ];

    return camposBusqueda
      .filter((item) => item != null)
      .some((item) => String(item).toLowerCase().includes(texto));
  }

  esTriggerAdministracionSano(trigger) {
    return trigger.scopeValido && trigger.objetivoDns?.valido !== false &&
      trigger.estadoCorreo?.requiereRevision !== true;
  }

  compararTriggersAdministracion(a, b, ordenarPor, direccionOrden) {
    const direccion = String(direccionOrden || '').toLowerCase() === 'desc'
      ? -1
      : 1;
    const campo = {
      tipo: 'tipo',
      activo: 'activo',
      creado: 'fechaCreacion',
      actualizado: 'fechaActualizacion'
    }[String(ordenarPor || '').toLowerCase()] || 'nombre';
    const resultado = this.compararValoresListado(a[campo], b[campo]);

    if (resultado !== 0) {
      return resultado * direccion;
    }

    return this.compararValoresListado(a.id, b.id) * direccion;
  }

  compararValoresListado(a, b) {
    if (typeof a === 'boolean' || typeof b === 'boolean') {
      return Number(Boolean(a)) - Number(Boolean(b));
    }

    const textoA = String(a ?? '').toLowerCase();
    const textoB = String(b ?? '').toLowerCase();
    return textoA.localeCompare(textoB, 'es', { numeric: true });
  }

  resumirTriggersAdministracion(triggers = []) {
    return triggers.reduce(
      (resumen, trigger) => {
        resumen.totalTriggers += 1;

        if (trigger.activo) {
          resumen.totalActivos += 1;
        } else {
          resumen.totalInactivos += 1;
        }

        if (trigger.tipo === 'api') {
          resumen.totalApi += 1;
        } else if (trigger.tipo === 'dns') {
          resumen.totalDns += 1;
        } else if (trigger.tipo === 'correo') {
          resumen.totalCorreo += 1;
        }

        return resumen;
      },
      {
        totalTriggers: 0,
        totalActivos: 0,
        totalInactivos: 0,
        totalApi: 0,
        totalDns: 0,
        totalCorreo: 0
      }
    );
  }

  serializarTriggerCatalogo(trigger) {
    const definicionTipo = this.obtenerDefinicionTipo(trigger.tipo);
    const configuracion = trigger.configuracion || {};

    return {
      ...trigger,
      definicionTipo,
      resumenConfiguracion: this.construirResumenConfiguracion(
        trigger.tipo,
        configuracion
      )
    };
  }

  construirResumenConfiguracion(tipo, configuracion = {}) {
    if (tipo === 'api') {
      return {
        principal: configuracion.url || '-',
        secundaria: [
          configuracion.metodo || 'POST',
          `${configuracion.timeoutMs ?? 0} ms`,
          `${configuracion.reintentos ?? 0} reintentos`,
          configuracion.permiteTlsInseguro ? 'TLS inseguro permitido' : 'TLS estricto'
        ].concat(
          configuracion.parametroOpcional
            ? [`Parámetro: ${configuracion.parametroOpcional}`]
            : []
        ),
        detalle: [
          configuracion.plantillaCuerpo ? 'Con plantilla de cuerpo' : 'Sin cuerpo configurado',
          configuracion.parametroOpcional
            ? 'Parámetro opcional disponible en plantillas'
            : null
        ]
          .filter(Boolean)
          .join(' · ')
      };
    }

    if (tipo === 'dns') {
      const operacion = String(configuracion.operacion || '').trim();
      const etiquetaOperacion =
        operacion === 'editar_valor'
          ? 'Editar valor'
          : operacion === 'activar'
            ? 'Activar registro'
            : operacion === 'desactivar'
              ? 'Desactivar registro'
              : operacion === 'seguir_estado_monitor'
                ? 'Seguir monitor'
                : 'Operación DNS';

      return {
        principal: `${etiquetaOperacion} #${configuracion.registroId || '-'}`,
        secundaria: [
          `Zona #${configuracion.zonaId || '-'}`,
          `Registro #${configuracion.registroId || '-'}`,
          configuracion.rolGobernanza
            ? `Rol ${configuracion.rolGobernanza}`
            : 'Sin rol explícito'
        ],
        detalle:
          operacion === 'editar_valor'
            ? `Nuevo valor: ${configuracion.valorPrincipal || '-'}`
            : operacion === 'seguir_estado_monitor'
              ? 'Apertura de alerta desactiva el registro; cierre de alerta lo activa.'
              : 'Solo cambia el estado activo del registro.'
      };
    }

    if (tipo === 'correo') {
      return {
        principal:
          `Mensaje v${configuracion.version ?? VERSION_CONFIGURACION_TRIGGER_CORREO}`,
        secundaria: [
          configuracion.textoIntroduccion ? 'Con introducción' : 'Sin introducción',
          configuracion.textoCierre ? 'Con cierre' : 'Sin cierre'
        ],
        detalle: 'La audiencia y el estado de entrega pertenecen al dominio especializado.'
      };
    }

    return {
      principal: '-',
      secundaria: [],
      detalle: 'Sin resumen disponible para este tipo.'
    };
  }

  construirAlcanceActual(contextoUsuarioActual) {
    const nivel = contextoUsuarioActual?.nivelScope || 'desconocido';
    const descripciones = {
      portal: 'Portal completo',
      tenant: contextoUsuarioActual?.tenantNombre
        ? `Tenant: ${contextoUsuarioActual.tenantNombre}`
        : `Tenant #${contextoUsuarioActual?.tenantId || '?'}`,
      empresa: contextoUsuarioActual?.empresaNombre
        ? `Empresa: ${contextoUsuarioActual.empresaNombre}`
        : `Empresa #${contextoUsuarioActual?.empresaId || '?'}`,
      sitio: contextoUsuarioActual?.sitioNombre
        ? `Sitio: ${contextoUsuarioActual.sitioNombre}`
        : `Sitio #${contextoUsuarioActual?.sitioId || '?'}`
    };

    return {
      nivelScope: nivel,
      descripcion: descripciones[nivel] || 'Alcance no disponible'
    };
  }
}

function normalizarComandoAudiencia(datos = {}, { exigirOperacion = false } = {}) {
  const manualesBrutos = datos.altasManuales ?? datos.audienciaManuales ??
    datos.audiencia_manuales ?? '';
  const altasManuales = Array.isArray(manualesBrutos)
    ? manualesBrutos
    : String(manualesBrutos || '').split(/\r?\n/u)
      .map((email) => email.trim()).filter(Boolean).map((email) => ({ email }));
  const comando = {
    triggerId: datos.triggerId ?? datos.trigger_id,
    revisionDeclaracion: datos.revisionDeclaracion ?? datos.revision_declaracion,
    altasManuales: altasManuales.map((entrada) => typeof entrada === 'string'
      ? { email: entrada }
      : entrada),
    altasUsuarios: listaIds(datos.altasUsuarios ?? datos.audienciaUsuarios ??
      datos.audiencia_usuarios),
    retiradasIds: listaIds(datos.retiradasIds ?? datos.retirarRelacionesIds ??
      datos.retirar_relaciones_ids),
    reincorporacionesIds: listaIds(datos.reincorporacionesIds ??
      datos.reincorporarRelacionesIds ?? datos.reincorporar_relaciones_ids)
  };
  if (exigirOperacion && !tieneOperacionAudiencia(comando)) {
    throw Object.assign(
      new Error('La operación de audiencia está vacía.'),
      { codigo: 'mutacion_audiencia_correo_vacia', statusCode: 400 }
    );
  }
  return comando;
}

function listaIds(valor) {
  if (valor == null || valor === '') return [];
  const valores = Array.isArray(valor) ? valor : String(valor).split(',');
  return [...new Set(valores.map(Number).filter((id) =>
    Number.isSafeInteger(id) && id > 0))];
}

function tieneOperacionAudiencia(comando) {
  return ['altasManuales', 'altasUsuarios', 'retiradasIds',
    'reincorporacionesIds'].some((campo) => comando[campo]?.length > 0);
}

function resumenCorreoVacio() {
  return {
    relacionesTotal: 0,
    relacionesActivas: 0,
    relacionesDormidas: 0,
    relacionesEntregables: 0,
    vinculosTotal: 0,
    vinculosActivos: 0,
    backlogAceptado: 0,
    ultimaEntregaEstado: null
  };
}

function derivarEstadoCorreo({ activo, resumen, estadoCanal, origenValido, limite }) {
  const diagnosticos = [];
  if (activo && !estadoCanal.puedeDespachar) diagnosticos.push('bloqueado_correo');
  if (activo && estadoCanal.puedeDespachar && !origenValido) {
    diagnosticos.push('bloqueado_origen_publico');
  }
  if (resumen.relacionesActivas > 0 && resumen.relacionesEntregables === 0) {
    diagnosticos.push('sin_destinatarios_entregables');
  }
  if (limite > 0 && resumen.relacionesTotal > limite) {
    diagnosticos.push('audiencia_sobre_limite');
  }
  if (resumen.ultimaEntregaEstado === 'error_final') {
    diagnosticos.push('ultima_entrega_fallida');
  }
  if (resumen.ultimaEntregaEstado === 'resultado_ambiguo') {
    diagnosticos.push('ultima_entrega_ambigua');
  }
  const operativo = activo && estadoCanal.puedeDespachar && origenValido &&
    resumen.relacionesEntregables > 0;
  const estadoAdministrativo = operativo
    ? 'operativo'
    : activo
      ? 'activo_bloqueado'
      : resumen.relacionesActivas === 0
        ? 'inactivo_sin_audiencia'
        : 'inactivo_manual';
  return Object.freeze({
    administrativo: estadoAdministrativo,
    operativo,
    requiereRevision: !operativo && (activo || diagnosticos.length > 0),
    diagnosticos: Object.freeze(diagnosticos),
    canal: Object.freeze({
      puedeDespachar: Boolean(estadoCanal.puedeDespachar),
      errores: Object.freeze([...(estadoCanal.errores || [])])
    }),
    origenPublicoValido: origenValido,
    limiteAudiencia: limite
  });
}

function obtenerEstadoCorreo(servicioCorreoPortal) {
  if (typeof servicioCorreoPortal?.obtenerEstadoConfiguracionAutoritativo ===
      'function') {
    return servicioCorreoPortal.obtenerEstadoConfiguracionAutoritativo();
  }
  return servicioCorreoPortal?.obtenerEstadoConfiguracion?.() || null;
}

function normalizarOrigenPublicoHttps(valor) {
  try {
    const entrada = String(valor || '');
    const url = new URL(entrada);
    if (url.protocol !== 'https:' || url.username || url.password ||
        url.pathname !== '/' || url.search || url.hash ||
        ![url.origin, `${url.origin}/`].includes(entrada)) return null;
    return url.origin;
  } catch {
    return null;
  }
}

function lanzarTriggerNoDisponible() {
  throw Object.assign(
    new Error('El trigger no existe o queda fuera de tu alcance.'),
    { codigo: 'trigger_no_disponible', statusCode: 404 }
  );
}

function lanzarSuperficieCorreoCerrada() {
  throw Object.assign(
    new Error('La administración de triggers de correo permanece cerrada.'),
    { codigo: 'trigger_correo_no_habilitado', statusCode: 404 }
  );
}

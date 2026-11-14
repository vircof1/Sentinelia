import { resolverEtiquetaTablaScopeOrganizativo } from './CatalogoScopeOrganizativo.js';
import { crearErrorServicioEliminacionOrganizativaNoDisponible } from './ErroresEliminacionOrganizativa.js';

const ESTADOS_VALIDOS = ['activo', 'inactivo'];

export class ServicioJerarquiaOrganizativa {
  constructor({
    repositorioTenants,
    repositorioEmpresas,
    repositorioSitios,
    repositorioUsuarios,
    servicioImpactoEliminacion = null,
    servicioCrudOrganizacionAuditable = null,
    servicioMovimientosOrganizativosAuditable = null,
    servicioEliminacionesOrganizativasAuditable = null
  }) {
    this.repositorioTenants = repositorioTenants;
    this.repositorioEmpresas = repositorioEmpresas;
    this.repositorioSitios = repositorioSitios;
    this.repositorioUsuarios = repositorioUsuarios;
    this.servicioImpactoEliminacion = servicioImpactoEliminacion;
    this.servicioCrudOrganizacionAuditable = servicioCrudOrganizacionAuditable;
    this.servicioMovimientosOrganizativosAuditable =
      servicioMovimientosOrganizativosAuditable;
    this.servicioEliminacionesOrganizativasAuditable =
      servicioEliminacionesOrganizativasAuditable;
  }

  async construirVistaOrganizacion(contextoUsuarioActual) {
    const [tenants, empresas, sitios] = await Promise.all([
      this.repositorioTenants.listarVisibles(contextoUsuarioActual),
      this.repositorioEmpresas.listarVisibles(contextoUsuarioActual),
      this.repositorioSitios.listarVisibles(contextoUsuarioActual)
    ]);

    return {
      resumen: {
        tenantsVisibles: tenants.length,
        tenantsRepresentados: new Set(empresas.map((empresa) => empresa.tenantId)).size,
        empresasVisibles: empresas.length,
        sitiosVisibles: sitios.length
      },
      capacidades: this.resolverCapacidadesGenerales(contextoUsuarioActual),
      tenants: tenants.map((tenant) => ({
        ...tenant.serializarResumen(),
        puedeEditar: this.puedeEditarTenant(contextoUsuarioActual, tenant),
        puedeEliminar: this.puedeEliminarTenant(contextoUsuarioActual)
      })),
      empresas: empresas.map((empresa) => ({
        ...empresa.serializarResumen(),
        puedeEditar: this.puedeEditarEmpresa(contextoUsuarioActual, empresa),
        puedeEliminar: this.puedeEliminarEmpresa(contextoUsuarioActual, empresa)
      })),
      sitios: sitios.map((sitio) => ({
        ...sitio.serializarResumen(),
        puedeEditar: this.puedeEditarSitio(contextoUsuarioActual, sitio),
        puedeEliminar: this.puedeEliminarSitio(contextoUsuarioActual, sitio)
      })),
      opcionesCrearEmpresa: tenants.map((tenant) => ({
        valor: tenant.id,
        etiqueta: `${tenant.nombre} (#${tenant.id})`
      })),
      opcionesCrearSitio: empresas.map((empresa) => ({
        valor: empresa.id,
        etiqueta: `${empresa.nombre} (#${empresa.id})`
      }))
    };
  }

  async listarTenantsAdministracion(
    contextoUsuarioActual,
    {
      textoBusqueda = '',
      pagina = 1,
      tamanoPagina = 25,
      ordenarPor = 'nombre',
      direccionOrden = 'asc'
    } = {}
  ) {
    this.assertPuedeAdministrarTenants(contextoUsuarioActual);

    const listado = await this.repositorioTenants.listarVisiblesPaginado(
      contextoUsuarioActual,
      {
        textoBusqueda,
        pagina,
        tamanoPagina,
        ordenarPor,
        direccionOrden
      }
    );

    return {
      filtros: {
        textoBusqueda: String(textoBusqueda || '').trim(),
        pagina: listado.paginacion.pagina,
        tamanoPagina: listado.paginacion.tamanoPagina,
        ordenarPor: this.normalizarOrdenTenant(ordenarPor),
        direccionOrden: this.normalizarDireccionOrden(direccionOrden)
      },
      filas: listado.tenants.map((tenant) => ({
        ...tenant.serializarResumen(),
        puedeEditar: this.puedeEditarTenant(contextoUsuarioActual, tenant),
        puedeEliminar: this.puedeEliminarTenant(contextoUsuarioActual)
      })),
      paginacion: listado.paginacion
    };
  }

  async construirVistaFormularioTenant(
    contextoUsuarioActual,
    {
      idTenant = null,
      formularioBase = null,
      errorFormulario = null
    } = {}
  ) {
    this.assertPuedeAdministrarTenants(contextoUsuarioActual);

    const vistaOrganizacion = await this.construirVistaOrganizacion(
      contextoUsuarioActual
    );

    let tenantObjetivo = null;
    let modo = 'nuevo';

    if (idTenant != null) {
      tenantObjetivo = await this.repositorioTenants.buscarPorId(idTenant);
      this.assertExiste(tenantObjetivo, 'tenant');

      if (!this.puedeEditarTenant(contextoUsuarioActual, tenantObjetivo)) {
        throw crearErrorAlcance('No puedes editar este tenant con tu scope actual.');
      }

      modo = 'editar';
    } else {
      this.assertPuedeCrearTenant(contextoUsuarioActual);
    }

    const formulario = this.normalizarFormularioTenant({
      tenantObjetivo,
      formularioBase
    });

    return {
      modo,
      tenantObjetivo: tenantObjetivo
        ? {
            ...tenantObjetivo.serializarResumen(),
            puedeEditar: this.puedeEditarTenant(
              contextoUsuarioActual,
              tenantObjetivo
            ),
            puedeEliminar: this.puedeEliminarTenant(contextoUsuarioActual)
          }
        : null,
      formulario,
      errorFormulario,
      opcionesEstado: ESTADOS_VALIDOS.map((estado) => ({
        valor: estado,
        etiqueta: estado === 'activo' ? 'Activo' : 'Inactivo'
      })),
      alcanceActual: {
        nivelScope: contextoUsuarioActual?.nivelScope || 'desconocido',
        descripcion: this.describirAlcanceTenantFormulario(
          contextoUsuarioActual
        )
      },
      resumen: vistaOrganizacion.resumen,
      capacidades: vistaOrganizacion.capacidades,
      subnavegacionOrganizacion: {
        algunAcceso: true,
        tenants: {
          visible: Boolean(vistaOrganizacion.capacidades.puedeVerTenants),
          activa: true,
          href: '/organizacion/tenants'
        },
        empresas: {
          visible: Boolean(vistaOrganizacion.capacidades.puedeVerEmpresas),
          activa: false,
          href: '/organizacion/empresas'
        },
        sitios: {
          visible: Boolean(vistaOrganizacion.capacidades.puedeVerSitios),
          activa: false,
          href: '/organizacion/sitios'
        }
      }
    };
  }

  async listarEmpresasAdministracion(
    contextoUsuarioActual,
    {
      textoBusqueda = '',
      tenantId = null,
      pagina = 1,
      tamanoPagina = 25,
      ordenarPor = 'nombre',
      direccionOrden = 'asc'
    } = {}
  ) {
    this.assertPuedeAdministrarEmpresas(contextoUsuarioActual);
    const tenantFiltro = await this.resolverTenantFiltroEmpresas(
      contextoUsuarioActual,
      tenantId
    );

    const listado = await this.repositorioEmpresas.listarVisiblesPaginado(
      contextoUsuarioActual,
      {
        textoBusqueda,
        tenantId: tenantFiltro?.id ?? null,
        pagina,
        tamanoPagina,
        ordenarPor,
        direccionOrden
      }
    );

    return {
      filtros: {
        textoBusqueda: String(textoBusqueda || '').trim(),
        tenantId: tenantFiltro?.id ?? null,
        pagina: listado.paginacion.pagina,
        tamanoPagina: listado.paginacion.tamanoPagina,
        ordenarPor: this.normalizarOrdenEmpresa(ordenarPor),
        direccionOrden: this.normalizarDireccionOrden(direccionOrden)
      },
      tenantFiltro: tenantFiltro
        ? tenantFiltro.serializarResumen()
        : null,
      filas: listado.empresas.map((empresa) => ({
        ...empresa.serializarResumen(),
        puedeEditar: this.puedeEditarEmpresa(contextoUsuarioActual, empresa),
        puedeEliminar: this.puedeEliminarEmpresa(contextoUsuarioActual, empresa)
      })),
      paginacion: listado.paginacion
    };
  }

  async resolverTenantFiltroEmpresas(contextoUsuarioActual, tenantId) {
    if (tenantId == null || String(tenantId).trim() === '') {
      return null;
    }

    const idNormalizado = this.normalizarId(
      tenantId,
      'Debes indicar un tenant válido para filtrar empresas.'
    );
    const tenant = await this.repositorioTenants.buscarPorId(idNormalizado);
    this.assertExiste(tenant, 'tenant');

    if (this.esOperadorSistema(contextoUsuarioActual)) {
      return tenant;
    }

    if (
      ['tenant', 'empresa', 'sitio'].includes(contextoUsuarioActual?.nivelScope) &&
      Number(contextoUsuarioActual.tenantId) === Number(tenant.id)
    ) {
      return tenant;
    }

    throw new Error('No puedes filtrar empresas por un tenant fuera de tu alcance.');
  }

  async construirVistaFormularioEmpresa(
    contextoUsuarioActual,
    {
      idEmpresa = null,
      formularioBase = null,
      errorFormulario = null
    } = {}
  ) {
    this.assertPuedeAdministrarEmpresas(contextoUsuarioActual);

    const vistaOrganizacion = await this.construirVistaOrganizacion(
      contextoUsuarioActual
    );

    let empresaObjetivo = null;
    let modo = 'nuevo';

    if (idEmpresa != null) {
      empresaObjetivo = await this.repositorioEmpresas.buscarPorId(idEmpresa);
      this.assertExiste(empresaObjetivo, 'empresa');

      if (!this.puedeEditarEmpresa(contextoUsuarioActual, empresaObjetivo)) {
        throw crearErrorAlcance('No puedes editar esta empresa con tu alcance actual.');
      }

      modo = 'editar';
    } else {
      if (!vistaOrganizacion.capacidades.puedeCrearEmpresa) {
        throw crearErrorAlcance('No puedes crear empresas con tu alcance actual.');
      }
    }

    const tenantSeleccionadoFormulario =
      await this.resolverTenantSeleccionadoFormularioEmpresa(
        contextoUsuarioActual,
        {
          empresaObjetivo,
          formularioBase
        }
      );

    const formulario = this.normalizarFormularioEmpresa({
      empresaObjetivo,
      formularioBase,
      tenantIdPorDefecto:
        tenantSeleccionadoFormulario?.id != null
          ? String(tenantSeleccionadoFormulario.id)
          : '',
      tenantTextoPorDefecto:
        tenantSeleccionadoFormulario
          ? this.formatearTenantTextoSeleccion(tenantSeleccionadoFormulario)
          : ''
    });

    const tenantFiltroFormulario = empresaObjetivo
      ? {
          id: empresaObjetivo.tenantId,
          nombre: empresaObjetivo.tenantNombre,
          alias: null
        }
      : tenantSeleccionadoFormulario
        ? {
            id: tenantSeleccionadoFormulario.id,
            nombre: tenantSeleccionadoFormulario.nombre,
            alias: tenantSeleccionadoFormulario.alias || null
          }
        : null;

    return {
      modo,
      empresaObjetivo: empresaObjetivo
        ? {
            ...empresaObjetivo.serializarResumen(),
            puedeEditar: this.puedeEditarEmpresa(
              contextoUsuarioActual,
              empresaObjetivo
            ),
            puedeEliminar: this.puedeEliminarEmpresa(
              contextoUsuarioActual,
              empresaObjetivo
            )
          }
        : null,
      formulario,
      errorFormulario,
      opcionesEstado: ESTADOS_VALIDOS.map((estado) => ({
        valor: estado,
        etiqueta: estado === 'activo' ? 'Activo' : 'Inactivo'
      })),
      tenantFiltro: tenantFiltroFormulario
        ? {
            id: tenantFiltroFormulario.id,
            nombre: tenantFiltroFormulario.nombre,
            alias: tenantFiltroFormulario.alias || null
          }
        : null,
      puedeElegirTenantEnFormulario:
        this.esOperadorSistema(contextoUsuarioActual),
      puedeCambiarTenantEmpresa:
        modo === 'editar' && this.puedeCambiarTenantEmpresa(contextoUsuarioActual),
      alcanceActual: {
        nivelScope: contextoUsuarioActual?.nivelScope || 'desconocido',
        descripcion: this.describirAlcanceEmpresaFormulario(
          contextoUsuarioActual,
          empresaObjetivo
        )
      },
      selectorTenant: {
        textoActual: formulario.tenantTexto,
        urlSugerencias: '/organizacion/empresas/api/opciones/tenants'
      },
      resumen: vistaOrganizacion.resumen,
      capacidades: vistaOrganizacion.capacidades,
      subnavegacionOrganizacion: {
        algunAcceso: true,
        tenants: {
          visible: Boolean(vistaOrganizacion.capacidades.puedeVerTenants),
          activa: false,
          href: '/organizacion/tenants'
        },
        empresas: {
          visible: Boolean(vistaOrganizacion.capacidades.puedeVerEmpresas),
          activa: true,
          href: '/organizacion/empresas'
        },
        sitios: {
          visible: Boolean(vistaOrganizacion.capacidades.puedeVerSitios),
          activa: false,
          href: '/organizacion/sitios'
        }
      }
    };
  }

  async listarSitiosAdministracion(
    contextoUsuarioActual,
    {
      textoBusqueda = '',
      tenantId = null,
      empresaId = null,
      pagina = 1,
      tamanoPagina = 25,
      ordenarPor = 'nombre',
      direccionOrden = 'asc'
    } = {}
  ) {
    this.assertPuedeAdministrarSitios(contextoUsuarioActual);
    const contextoFiltro = await this.resolverContextoFiltrosSitios(
      contextoUsuarioActual,
      {
        tenantId,
        empresaId
      }
    );

    const listado = await this.repositorioSitios.listarVisiblesPaginado(
      contextoUsuarioActual,
      {
        textoBusqueda,
        tenantId: contextoFiltro.tenantFiltro?.id ?? null,
        empresaId: contextoFiltro.empresaFiltro?.id ?? null,
        pagina,
        tamanoPagina,
        ordenarPor,
        direccionOrden
      }
    );

    return {
      filtros: {
        textoBusqueda: String(textoBusqueda || '').trim(),
        tenantId: contextoFiltro.tenantFiltro?.id ?? null,
        empresaId: contextoFiltro.empresaFiltro?.id ?? null,
        pagina: listado.paginacion.pagina,
        tamanoPagina: listado.paginacion.tamanoPagina,
        ordenarPor: this.normalizarOrdenSitio(ordenarPor),
        direccionOrden: this.normalizarDireccionOrden(direccionOrden)
      },
      tenantFiltro: contextoFiltro.tenantFiltro
        ? {
            id: contextoFiltro.tenantFiltro.id,
            nombre: contextoFiltro.tenantFiltro.nombre,
            alias: contextoFiltro.tenantFiltro.alias
          }
        : null,
      empresaFiltro: contextoFiltro.empresaFiltro
        ? {
            id: contextoFiltro.empresaFiltro.id,
            tenantId: contextoFiltro.empresaFiltro.tenantId,
            tenantNombre: contextoFiltro.empresaFiltro.tenantNombre,
            nombre: contextoFiltro.empresaFiltro.nombre,
            alias: contextoFiltro.empresaFiltro.alias
          }
        : null,
      filas: listado.sitios.map((sitio) => ({
        ...sitio.serializarResumen(),
        puedeEditar: this.puedeEditarSitio(contextoUsuarioActual, sitio),
        puedeEliminar: this.puedeEliminarSitio(contextoUsuarioActual, sitio)
      })),
      paginacion: listado.paginacion
    };
  }

  async construirVistaFormularioSitio(
    contextoUsuarioActual,
    {
      idSitio = null,
      formularioBase = null,
      errorFormulario = null
    } = {}
  ) {
    this.assertPuedeAdministrarSitios(contextoUsuarioActual);

    const vistaOrganizacion = await this.construirVistaOrganizacion(
      contextoUsuarioActual
    );

    const empresasDisponibles = await this.repositorioEmpresas.listarVisibles(
      contextoUsuarioActual
    );

    let sitioObjetivo = null;
    let modo = 'nuevo';

    if (idSitio != null) {
      sitioObjetivo = await this.repositorioSitios.buscarPorId(idSitio);
      this.assertExiste(sitioObjetivo, 'sitio');

      if (!this.puedeEditarSitio(contextoUsuarioActual, sitioObjetivo)) {
        throw crearErrorAlcance('No puedes editar este sitio con tu alcance actual.');
      }

      modo = 'editar';
    } else if (!vistaOrganizacion.capacidades.puedeCrearSitio) {
      throw crearErrorAlcance('No puedes crear sitios con tu alcance actual.');
    }

    const formulario = this.normalizarFormularioSitio({
      sitioObjetivo,
      formularioBase,
      empresaIdPorDefecto:
        empresasDisponibles[0]?.id != null ? String(empresasDisponibles[0].id) : ''
    });

    const opcionesEmpresa = empresasDisponibles.map((empresa) => ({
      valor: String(empresa.id),
      etiqueta: `${empresa.nombre} (#${empresa.id}) · Tenant ${empresa.tenantNombre}`
    }));

    const empresaSeleccionadaFormulario = formulario.empresaId
      ? (
          empresasDisponibles.find(
            (empresa) => String(empresa.id) === String(formulario.empresaId)
          ) || null
        )
      : null;

    const empresaFiltroFormulario = sitioObjetivo
      ? {
          id: sitioObjetivo.empresaId,
          tenantId: sitioObjetivo.tenantId,
          tenantNombre: sitioObjetivo.tenantNombre,
          nombre: sitioObjetivo.empresaNombre,
          alias: null
        }
      : empresaSeleccionadaFormulario;

    const tenantFiltroFormulario = empresaFiltroFormulario
      ? {
          id: empresaFiltroFormulario.tenantId,
          nombre: empresaFiltroFormulario.tenantNombre,
          alias: null
        }
      : null;

    return {
      modo,
      sitioObjetivo: sitioObjetivo
        ? {
            ...sitioObjetivo.serializarResumen(),
            puedeEditar: this.puedeEditarSitio(
              contextoUsuarioActual,
              sitioObjetivo
            ),
            puedeEliminar: this.puedeEliminarSitio(
              contextoUsuarioActual,
              sitioObjetivo
            )
          }
        : null,
      formulario,
      errorFormulario,
      opcionesEstado: ESTADOS_VALIDOS.map((estado) => ({
        valor: estado,
        etiqueta: estado === 'activo' ? 'Activo' : 'Inactivo'
      })),
      opcionesEmpresa,
      selectorEmpresa: {
        textoActual: this.formatearEmpresaTextoSeleccion(
          empresaSeleccionadaFormulario ||
          (
            sitioObjetivo
              ? {
                  id: sitioObjetivo.empresaId,
                  nombre: sitioObjetivo.empresaNombre,
                  alias: null,
                  tenantNombre: sitioObjetivo.tenantNombre
                }
              : null
          ),
          { incluirTenant: contextoUsuarioActual?.nivelScope === 'portal' }
        ),
        urlSugerencias: '/organizacion/sitios/api/opciones/empresas'
      },
      tenantFiltro: tenantFiltroFormulario,
      empresaFiltro: empresaFiltroFormulario
        ? {
            id: empresaFiltroFormulario.id,
            tenantId: empresaFiltroFormulario.tenantId,
            tenantNombre: empresaFiltroFormulario.tenantNombre,
            nombre: empresaFiltroFormulario.nombre,
            alias: empresaFiltroFormulario.alias || null
          }
        : null,
      puedeElegirEmpresaEnFormulario: empresasDisponibles.length > 0,
      puedeCambiarEmpresaSitio: modo === 'editar',
      alcanceActual: {
        nivelScope: contextoUsuarioActual?.nivelScope || 'desconocido',
        descripcion: this.describirAlcanceSitioFormulario(
          contextoUsuarioActual,
          sitioObjetivo
        )
      },
      resumen: vistaOrganizacion.resumen,
      capacidades: vistaOrganizacion.capacidades,
      subnavegacionOrganizacion: {
        algunAcceso: true,
        tenants: {
          visible: Boolean(vistaOrganizacion.capacidades.puedeVerTenants),
          activa: false,
          href: '/organizacion/tenants'
        },
        empresas: {
          visible: Boolean(vistaOrganizacion.capacidades.puedeVerEmpresas),
          activa: false,
          href: '/organizacion/empresas'
        },
        sitios: {
          visible: Boolean(vistaOrganizacion.capacidades.puedeVerSitios),
          activa: true,
          href: '/organizacion/sitios'
        }
      }
    };
  }

  async crearTenant(contextoUsuarioActual, datos) {
    this.assertPuedeAdministrarTenants(contextoUsuarioActual);
    this.assertPuedeCrearTenant(contextoUsuarioActual);

    try {
      const normalizado = this.normalizarTenant(datos);
      if (this.servicioCrudOrganizacionAuditable) {
        return await this.servicioCrudOrganizacionAuditable.crear({
          entidad: 'tenant', datos: normalizado, contextoUsuarioActual
        });
      }
      return await this.repositorioTenants.crear(normalizado);
    } catch (error) {
      throw this.traducirErrorPersistencia(error, 'tenant');
    }
  }

  async actualizarTenant(contextoUsuarioActual, idTenant, datos) {
    this.assertPuedeAdministrarTenants(contextoUsuarioActual);
    const tenant = await this.repositorioTenants.buscarPorId(idTenant);
    this.assertExiste(tenant, 'tenant');

    if (!this.puedeEditarTenant(contextoUsuarioActual, tenant)) {
      throw new Error('No puedes editar este tenant con tu scope actual.');
    }

    try {
      const normalizado = this.normalizarTenant(datos);
      if (this.servicioCrudOrganizacionAuditable) {
        return await this.servicioCrudOrganizacionAuditable.actualizar({
          entidad: 'tenant', id: Number(idTenant), datos: normalizado,
          contextoUsuarioActual,
          autorizar: (actual) => this.puedeEditarTenant(contextoUsuarioActual, actual)
        });
      }
      return await this.repositorioTenants.actualizar({
        idTenant: Number(idTenant),
        ...normalizado
      });
    } catch (error) {
      throw this.traducirErrorPersistencia(error, 'tenant');
    }
  }

  async eliminarTenant(contextoUsuarioActual, idTenant) {
    this.assertPuedeAdministrarTenants(contextoUsuarioActual);
    const tenant = await this.repositorioTenants.buscarPorId(idTenant);
    this.assertExiste(tenant, 'tenant');

    if (!this.puedeEliminarTenant(contextoUsuarioActual)) {
      throw new Error('No puedes eliminar tenants con tu scope actual.');
    }

    if (this.servicioEliminacionesOrganizativasAuditable) {
      return this.servicioEliminacionesOrganizativasAuditable.eliminar({
        entidad: 'tenant',
        id: Number(idTenant),
        contextoUsuarioActual,
        autorizar: () => this.puedeEliminarTenant(contextoUsuarioActual)
      });
    }
    throw crearErrorServicioEliminacionOrganizativaNoDisponible({
      entidad: 'tenant',
      id: idTenant
    });
  }

  async evaluarImpactoEliminarTenant(contextoUsuarioActual, idTenant) {
    this.assertPuedeAdministrarTenants(contextoUsuarioActual);
    const tenant = await this.repositorioTenants.buscarPorId(idTenant);
    this.assertExiste(tenant, 'tenant');

    if (!this.puedeEliminarTenant(contextoUsuarioActual)) {
      throw new Error('No puedes eliminar tenants con tu alcance actual.');
    }

    this.assertServicioImpactoDisponible();

    return this.servicioImpactoEliminacion.evaluar({
      tablaRaiz: 'tenants',
      idRaiz: Number(idTenant),
      origen: {
        descripcion: `Tenant ${tenant.nombre} (#${tenant.id})`
      }
    });
  }

  async crearEmpresa(contextoUsuarioActual, datos) {
    this.assertPuedeAdministrarEmpresas(contextoUsuarioActual);
    const payload = this.normalizarEmpresa(datos);
    const tenant = await this.repositorioTenants.buscarPorId(payload.tenantId);
    this.assertExiste(tenant, 'tenant');
    this.assertPuedeCrearEmpresa(contextoUsuarioActual, tenant.id);

    try {
      if (this.servicioCrudOrganizacionAuditable) {
        return await this.servicioCrudOrganizacionAuditable.crear({
          entidad: 'empresa', datos: payload, contextoUsuarioActual
        });
      }
      return await this.repositorioEmpresas.crear(payload);
    } catch (error) {
      throw this.traducirErrorPersistencia(error, 'empresa');
    }
  }

  async actualizarEmpresa(contextoUsuarioActual, idEmpresa, datos) {
    this.assertPuedeAdministrarEmpresas(contextoUsuarioActual);
    const empresa = await this.repositorioEmpresas.buscarPorId(idEmpresa);
    this.assertExiste(empresa, 'empresa');

    if (!this.puedeEditarEmpresa(contextoUsuarioActual, empresa)) {
      throw new Error('No puedes editar esta empresa con tu scope actual.');
    }

    const payload = this.normalizarEmpresa(datos, { requiereTenant: false });
    const tenantDestinoId = this.resolverTenantDestinoEmpresa(datos, empresa);
    const hayCambioTenant =
      Number(tenantDestinoId) !== Number(empresa.tenantId);
    let tenantDestino = null;

    if (hayCambioTenant) {
      this.assertPuedeCambiarTenantEmpresa(contextoUsuarioActual);
      tenantDestino = await this.repositorioTenants.buscarPorId(tenantDestinoId);
      this.assertExiste(tenantDestino, 'tenant');

      if (!this.normalizarConfirmacionCambio(datos.confirmar_cambio_tenant)) {
        throw new Error(
          'Debes revisar y confirmar el impacto antes de mover la empresa a otro tenant.'
        );
      }
    }

    try {
      if (hayCambioTenant) {
        if (this.servicioMovimientosOrganizativosAuditable) {
          return await this.servicioMovimientosOrganizativosAuditable.moverEmpresa({
            datos: {
              idEmpresa: Number(idEmpresa),
              tenantOrigenId: Number(empresa.tenantId),
              tenantDestinoId,
              ...payload
            },
            contextoUsuarioActual,
            autorizar: (actual) =>
              this.puedeEditarEmpresa(contextoUsuarioActual, actual) &&
              this.puedeCambiarTenantEmpresa(contextoUsuarioActual)
          });
        }
        throw new Error(
          'El movimiento de empresa exige la frontera auditable con reservas.'
        );
      }

      if (this.servicioCrudOrganizacionAuditable) {
        return await this.servicioCrudOrganizacionAuditable.actualizar({
          entidad: 'empresa', id: Number(idEmpresa), datos: payload,
          contextoUsuarioActual,
          autorizar: (actual) => this.puedeEditarEmpresa(contextoUsuarioActual, actual)
        });
      }

      const empresaActualizada = await this.repositorioEmpresas.actualizar({
        idEmpresa: Number(idEmpresa),
        ...payload
      });

      empresaActualizada.metaActualizacion = {
        cambioTenant: false,
        tenantAnteriorId: empresa.tenantId,
        tenantAnteriorNombre: empresa.tenantNombre,
        tenantNuevoId: empresa.tenantId,
        tenantNuevoNombre: empresa.tenantNombre
      };

      return empresaActualizada;
    } catch (error) {
      throw this.traducirErrorPersistencia(error, 'empresa');
    }
  }

  async eliminarEmpresa(contextoUsuarioActual, idEmpresa) {
    this.assertPuedeAdministrarEmpresas(contextoUsuarioActual);
    const empresa = await this.repositorioEmpresas.buscarPorId(idEmpresa);
    this.assertExiste(empresa, 'empresa');

    if (!this.puedeEliminarEmpresa(contextoUsuarioActual, empresa)) {
      throw new Error('No puedes eliminar esta empresa con tu scope actual.');
    }

    if (this.servicioEliminacionesOrganizativasAuditable) {
      return this.servicioEliminacionesOrganizativasAuditable.eliminar({
        entidad: 'empresa',
        id: Number(idEmpresa),
        contextoUsuarioActual,
        autorizar: (actual) =>
          this.puedeEliminarEmpresa(contextoUsuarioActual, actual)
      });
    }
    throw crearErrorServicioEliminacionOrganizativaNoDisponible({
      entidad: 'empresa',
      id: idEmpresa
    });
  }

  async evaluarImpactoEliminarEmpresa(contextoUsuarioActual, idEmpresa) {
    this.assertPuedeAdministrarEmpresas(contextoUsuarioActual);
    const empresa = await this.repositorioEmpresas.buscarPorId(idEmpresa);
    this.assertExiste(empresa, 'empresa');

    if (!this.puedeEliminarEmpresa(contextoUsuarioActual, empresa)) {
      throw new Error('No puedes eliminar esta empresa con tu alcance actual.');
    }

    this.assertServicioImpactoDisponible();

    return this.servicioImpactoEliminacion.evaluar({
      tablaRaiz: 'empresas',
      idRaiz: Number(idEmpresa),
      origen: {
        descripcion: `Empresa ${empresa.nombre} (#${empresa.id})`
      }
    });
  }

  async obtenerOpcionesTenantEmpresa(
    contextoUsuarioActual,
    { textoBusqueda = '', limite = 12 } = {}
  ) {
    this.assertPuedeAdministrarEmpresas(contextoUsuarioActual);

    const tamanoPaginaNormalizado = Math.min(
      Math.max(this.normalizarIdOpcional(limite) || 12, 1),
      20
    );
    const listado = await this.repositorioTenants.listarVisiblesPaginado(
      contextoUsuarioActual,
      {
        textoBusqueda: String(textoBusqueda || '').trim(),
        pagina: 1,
        tamanoPagina: tamanoPaginaNormalizado,
        ordenarPor: 'nombre',
        direccionOrden: 'asc'
      }
    );

    return listado.tenants.map((tenant) => ({
      valor: String(tenant.id),
      texto: this.formatearTenantTextoSeleccion(tenant),
      nombre: tenant.nombre,
      alias: tenant.alias
    }));
  }

  async obtenerOpcionesEmpresaSitio(
    contextoUsuarioActual,
    { textoBusqueda = '', limite = 12 } = {}
  ) {
    this.assertPuedeAdministrarSitios(contextoUsuarioActual);

    const tamanoPaginaNormalizado = Math.min(
      Math.max(this.normalizarIdOpcional(limite) || 12, 1),
      20
    );
    const listado = await this.repositorioEmpresas.listarVisiblesPaginado(
      contextoUsuarioActual,
      {
        textoBusqueda: String(textoBusqueda || '').trim(),
        pagina: 1,
        tamanoPagina: tamanoPaginaNormalizado,
        ordenarPor: 'nombre',
        direccionOrden: 'asc'
      }
    );

    return listado.empresas.map((empresa) => ({
      valor: String(empresa.id),
      texto: this.formatearEmpresaTextoSeleccion(empresa, {
        incluirTenant: contextoUsuarioActual?.nivelScope === 'portal'
      }),
      nombre: empresa.nombre,
      alias: empresa.alias,
      tenantNombre: empresa.tenantNombre
    }));
  }

  async evaluarImpactoCambioTenantEmpresa(
    contextoUsuarioActual,
    idEmpresa,
    tenantDestinoId
  ) {
    this.assertPuedeAdministrarEmpresas(contextoUsuarioActual);
    const empresa = await this.repositorioEmpresas.buscarPorId(idEmpresa);
    this.assertExiste(empresa, 'empresa');

    if (!this.puedeEditarEmpresa(contextoUsuarioActual, empresa)) {
      throw new Error('No puedes editar esta empresa con tu alcance actual.');
    }

    this.assertPuedeCambiarTenantEmpresa(contextoUsuarioActual);

    const idTenantDestino = this.normalizarId(
      tenantDestinoId,
      'Debes indicar un tenant de destino válido.'
    );
    const tenantDestino =
      await this.repositorioTenants.buscarPorId(idTenantDestino);
    this.assertExiste(tenantDestino, 'tenant');

    const esCambioReal =
      Number(empresa.tenantId) !== Number(idTenantDestino);

    if (!esCambioReal) {
      return {
        origen: {
          empresaId: empresa.id,
          empresaNombre: empresa.nombre,
          tenantActualId: empresa.tenantId,
          tenantActualNombre: empresa.tenantNombre,
          tenantDestinoId: tenantDestino.id,
          tenantDestinoNombre: tenantDestino.nombre
        },
        resumen: {
          totalActualizacionesVivas: 0,
          totalReferenciasHistoricas: 0,
          totalBloqueosPotenciales: 0
        },
        actualizacionesVivas: [],
        referenciasHistoricas: [],
        bloqueosPotenciales: [],
        esCambioReal: false
      };
    }

    const impactoBase =
      await this.repositorioEmpresas.calcularImpactoCambioTenant({
        idEmpresa: Number(idEmpresa),
        tenantDestinoId: Number(idTenantDestino),
        aliasActual: empresa.alias
      });

    const actualizacionesVivas = this.enriquecerItemsImpactoCambioTenant(
      impactoBase.actualizacionesVivas || []
    );
    const referenciasHistoricas = this.enriquecerItemsImpactoCambioTenant(
      impactoBase.referenciasHistoricas || []
    );
    const bloqueosPotenciales = this.enriquecerItemsImpactoCambioTenant(
      impactoBase.bloqueosPotenciales || []
    );

    return {
      origen: {
        empresaId: empresa.id,
        empresaNombre: empresa.nombre,
        tenantActualId: empresa.tenantId,
        tenantActualNombre: empresa.tenantNombre,
        tenantDestinoId: tenantDestino.id,
        tenantDestinoNombre: tenantDestino.nombre
      },
      resumen: {
        totalActualizacionesVivas: actualizacionesVivas.reduce(
          (total, item) => total + item.total,
          0
        ),
        totalReferenciasHistoricas: referenciasHistoricas.reduce(
          (total, item) => total + item.total,
          0
        ),
        totalBloqueosPotenciales: bloqueosPotenciales.reduce(
          (total, item) => total + item.total,
          0
        )
      },
      actualizacionesVivas,
      referenciasHistoricas,
      bloqueosPotenciales,
      esCambioReal: true
    };
  }

  async crearSitio(contextoUsuarioActual, datos) {
    this.assertPuedeAdministrarSitios(contextoUsuarioActual);
    const payload = this.normalizarSitio(datos);
    const empresa = await this.repositorioEmpresas.buscarPorId(payload.empresaId);
    this.assertExiste(empresa, 'empresa');
    this.assertPuedeCrearSitio(contextoUsuarioActual, empresa);

    try {
      const datosCreacion = { ...payload, tenantId: empresa.tenantId };
      if (this.servicioCrudOrganizacionAuditable) {
        return await this.servicioCrudOrganizacionAuditable.crear({
          entidad: 'sitio', datos: datosCreacion, contextoUsuarioActual
        });
      }
      return await this.repositorioSitios.crear({
        ...datosCreacion
      });
    } catch (error) {
      throw this.traducirErrorPersistencia(error, 'sitio');
    }
  }

  async actualizarSitio(contextoUsuarioActual, idSitio, datos) {
    this.assertPuedeAdministrarSitios(contextoUsuarioActual);
    const sitio = await this.repositorioSitios.buscarPorId(idSitio);
    this.assertExiste(sitio, 'sitio');

    if (!this.puedeEditarSitio(contextoUsuarioActual, sitio)) {
      throw new Error('No puedes editar este sitio con tu scope actual.');
    }

    const payload = this.normalizarSitio(datos, { requiereEmpresa: false });
    const empresaDestinoId = this.resolverEmpresaDestinoSitio(datos, sitio);
    const hayCambioEmpresa =
      Number(empresaDestinoId) !== Number(sitio.empresaId);
    let empresaDestino = null;

    if (hayCambioEmpresa) {
      empresaDestino = await this.repositorioEmpresas.buscarPorId(
        empresaDestinoId
      );
      this.assertExiste(empresaDestino, 'empresa');
      this.assertPuedeCrearSitio(contextoUsuarioActual, empresaDestino);

      if (!this.normalizarConfirmacionCambio(datos.confirmar_cambio_empresa)) {
        throw new Error(
          'Debes revisar y confirmar el impacto antes de mover el sitio a otra empresa.'
        );
      }
    }

    try {
      if (hayCambioEmpresa) {
        if (this.servicioMovimientosOrganizativosAuditable) {
          return await this.servicioMovimientosOrganizativosAuditable.moverSitio({
            datos: {
              idSitio: Number(idSitio),
              tenantOrigenId: Number(sitio.tenantId),
              empresaOrigenId: Number(sitio.empresaId),
              tenantDestinoId: Number(empresaDestino.tenantId),
              empresaDestinoId,
              ...payload
            },
            contextoUsuarioActual,
            autorizar: (actual) =>
              this.puedeEditarSitio(contextoUsuarioActual, actual) &&
              this.puedeCrearSitio(contextoUsuarioActual, empresaDestino)
          });
        }
        throw new Error(
          'El movimiento de sitio exige la frontera auditable con reservas.'
        );
      }

      if (this.servicioCrudOrganizacionAuditable) {
        return await this.servicioCrudOrganizacionAuditable.actualizar({
          entidad: 'sitio', id: Number(idSitio), datos: payload,
          contextoUsuarioActual,
          autorizar: (actual) => this.puedeEditarSitio(contextoUsuarioActual, actual)
        });
      }

      const sitioActualizado = await this.repositorioSitios.actualizar({
        idSitio: Number(idSitio),
        ...payload
      });

      sitioActualizado.metaActualizacion = {
        cambioEmpresa: false,
        empresaAnteriorId: sitio.empresaId,
        empresaAnteriorNombre: sitio.empresaNombre,
        empresaNuevaId: sitio.empresaId,
        empresaNuevaNombre: sitio.empresaNombre,
        tenantAnteriorId: sitio.tenantId,
        tenantAnteriorNombre: sitio.tenantNombre,
        tenantNuevoId: sitio.tenantId,
        tenantNuevoNombre: sitio.tenantNombre
      };

      return sitioActualizado;
    } catch (error) {
      throw this.traducirErrorPersistencia(error, 'sitio');
    }
  }

  async eliminarSitio(contextoUsuarioActual, idSitio) {
    this.assertPuedeAdministrarSitios(contextoUsuarioActual);
    const sitio = await this.repositorioSitios.buscarPorId(idSitio);
    this.assertExiste(sitio, 'sitio');

    if (!this.puedeEliminarSitio(contextoUsuarioActual, sitio)) {
      throw new Error('No puedes eliminar este sitio con tu scope actual.');
    }

    if (this.servicioEliminacionesOrganizativasAuditable) {
      return this.servicioEliminacionesOrganizativasAuditable.eliminar({
        entidad: 'sitio',
        id: Number(idSitio),
        contextoUsuarioActual,
        autorizar: (actual) =>
          this.puedeEliminarSitio(contextoUsuarioActual, actual)
      });
    }
    throw crearErrorServicioEliminacionOrganizativaNoDisponible({
      entidad: 'sitio',
      id: idSitio
    });
  }

  async evaluarImpactoEliminarSitio(contextoUsuarioActual, idSitio) {
    this.assertPuedeAdministrarSitios(contextoUsuarioActual);
    const sitio = await this.repositorioSitios.buscarPorId(idSitio);
    this.assertExiste(sitio, 'sitio');

    if (!this.puedeEliminarSitio(contextoUsuarioActual, sitio)) {
      throw new Error('No puedes eliminar este sitio con tu alcance actual.');
    }

    this.assertServicioImpactoDisponible();

    return this.servicioImpactoEliminacion.evaluar({
      tablaRaiz: 'sitios',
      idRaiz: Number(idSitio),
      origen: {
        descripcion: `Sitio ${sitio.nombre} (#${sitio.id})`
      }
    });
  }

  async evaluarImpactoCambioEmpresaSitio(
    contextoUsuarioActual,
    idSitio,
    empresaDestinoId
  ) {
    this.assertPuedeAdministrarSitios(contextoUsuarioActual);
    const sitio = await this.repositorioSitios.buscarPorId(idSitio);
    this.assertExiste(sitio, 'sitio');

    if (!this.puedeEditarSitio(contextoUsuarioActual, sitio)) {
      throw new Error('No puedes editar este sitio con tu alcance actual.');
    }

    const idEmpresaDestino = this.normalizarId(
      empresaDestinoId,
      'Debes indicar una empresa de destino válida.'
    );
    const empresaDestino =
      await this.repositorioEmpresas.buscarPorId(idEmpresaDestino);
    this.assertExiste(empresaDestino, 'empresa');
    this.assertPuedeCrearSitio(contextoUsuarioActual, empresaDestino);

    const esCambioReal =
      Number(sitio.empresaId) !== Number(idEmpresaDestino);

    if (!esCambioReal) {
      return {
        origen: {
          sitioId: sitio.id,
          sitioNombre: sitio.nombre,
          empresaActualId: sitio.empresaId,
          empresaActualNombre: sitio.empresaNombre,
          empresaDestinoId: empresaDestino.id,
          empresaDestinoNombre: empresaDestino.nombre,
          tenantActualId: sitio.tenantId,
          tenantActualNombre: sitio.tenantNombre,
          tenantDestinoId: empresaDestino.tenantId,
          tenantDestinoNombre: empresaDestino.tenantNombre
        },
        resumen: {
          totalActualizacionesVivas: 0,
          totalReferenciasHistoricas: 0,
          totalBloqueosPotenciales: 0
        },
        actualizacionesVivas: [],
        referenciasHistoricas: [],
        bloqueosPotenciales: [],
        esCambioReal: false
      };
    }

    const impactoBase =
      await this.repositorioSitios.calcularImpactoCambioEmpresa({
        idSitio: Number(idSitio),
        empresaDestinoId: Number(idEmpresaDestino),
        aliasActual: sitio.alias
      });

    const actualizacionesVivas = this.enriquecerItemsImpactoCambioTenant(
      impactoBase.actualizacionesVivas || []
    );
    const referenciasHistoricas = this.enriquecerItemsImpactoCambioTenant(
      impactoBase.referenciasHistoricas || []
    );
    const bloqueosPotenciales = this.enriquecerItemsImpactoCambioTenant(
      impactoBase.bloqueosPotenciales || []
    );

    return {
      origen: {
        sitioId: sitio.id,
        sitioNombre: sitio.nombre,
        empresaActualId: sitio.empresaId,
        empresaActualNombre: sitio.empresaNombre,
        empresaDestinoId: empresaDestino.id,
        empresaDestinoNombre: empresaDestino.nombre,
        tenantActualId: sitio.tenantId,
        tenantActualNombre: sitio.tenantNombre,
        tenantDestinoId: empresaDestino.tenantId,
        tenantDestinoNombre: empresaDestino.tenantNombre
      },
      resumen: {
        totalActualizacionesVivas: actualizacionesVivas.reduce(
          (total, item) => total + item.total,
          0
        ),
        totalReferenciasHistoricas: referenciasHistoricas.reduce(
          (total, item) => total + item.total,
          0
        ),
        totalBloqueosPotenciales: bloqueosPotenciales.reduce(
          (total, item) => total + item.total,
          0
        )
      },
      actualizacionesVivas,
      referenciasHistoricas,
      bloqueosPotenciales,
      esCambioReal: true
    };
  }

  async resolverContextoFiltrosSitios(
    contextoUsuarioActual,
    { tenantId = null, empresaId = null } = {}
  ) {
    let tenantFiltro = null;
    let empresaFiltro = null;

    if (tenantId != null && String(tenantId).trim() !== '') {
      const idTenant = this.normalizarId(
        tenantId,
        'Debes indicar un tenant válido para filtrar sitios.'
      );
      tenantFiltro = await this.repositorioTenants.buscarPorId(idTenant);
      this.assertExiste(tenantFiltro, 'tenant');

      if (
        !this.esOperadorSistema(contextoUsuarioActual) &&
        Number(contextoUsuarioActual?.tenantId) !== Number(tenantFiltro.id)
      ) {
        throw new Error('No puedes filtrar sitios por un tenant fuera de tu alcance.');
      }
    }

    if (empresaId != null && String(empresaId).trim() !== '') {
      const idEmpresa = this.normalizarId(
        empresaId,
        'Debes indicar una empresa válida para filtrar sitios.'
      );
      empresaFiltro = await this.repositorioEmpresas.buscarPorId(idEmpresa);
      this.assertExiste(empresaFiltro, 'empresa');

      if (
        !this.esOperadorSistema(contextoUsuarioActual) &&
        contextoUsuarioActual?.nivelScope === 'tenant' &&
        Number(contextoUsuarioActual.tenantId) !== Number(empresaFiltro.tenantId)
      ) {
        throw new Error('No puedes filtrar sitios por una empresa fuera de tu tenant.');
      }

      if (
        contextoUsuarioActual?.nivelScope === 'empresa' &&
        Number(contextoUsuarioActual.empresaId) !== Number(empresaFiltro.id)
      ) {
        throw new Error('No puedes filtrar sitios por una empresa fuera de tu alcance.');
      }

      if (
        contextoUsuarioActual?.nivelScope === 'sitio' &&
        Number(contextoUsuarioActual.empresaId) !== Number(empresaFiltro.id)
      ) {
        throw new Error('No puedes filtrar sitios por una empresa fuera de tu alcance.');
      }
    }

    if (
      tenantFiltro &&
      empresaFiltro &&
      Number(tenantFiltro.id) !== Number(empresaFiltro.tenantId)
    ) {
      throw new Error('La empresa indicada no pertenece al tenant seleccionado.');
    }

    if (!tenantFiltro && empresaFiltro) {
      tenantFiltro = await this.repositorioTenants.buscarPorId(
        empresaFiltro.tenantId
      );
    }

    return {
      tenantFiltro,
      empresaFiltro
    };
  }

  resolverCapacidadesGenerales(contextoUsuarioActual) {
    const puedeAdministrarTenants =
      this.tienePermisoAdministrarTenants(contextoUsuarioActual);
    const puedeAdministrarEmpresas =
      this.tienePermisoAdministrarEmpresas(contextoUsuarioActual);
    const puedeAdministrarSitios =
      this.tienePermisoAdministrarSitios(contextoUsuarioActual);

    return {
      puedeVerTenants: puedeAdministrarTenants,
      puedeVerEmpresas: puedeAdministrarEmpresas,
      puedeVerSitios: puedeAdministrarSitios,
      puedeCrearTenant:
        puedeAdministrarTenants &&
        this.esOperadorSistema(contextoUsuarioActual),
      puedeCrearEmpresa:
        puedeAdministrarEmpresas &&
        ['portal', 'tenant'].includes(contextoUsuarioActual?.nivelScope),
      puedeCrearSitio:
        ['portal', 'tenant', 'empresa'].includes(
          contextoUsuarioActual?.nivelScope
        ) && puedeAdministrarSitios
    };
  }

  puedeEditarTenant(contextoUsuarioActual, tenant) {
    return (
      this.esOperadorSistema(contextoUsuarioActual) ||
      (
        contextoUsuarioActual?.nivelScope === 'tenant' &&
        Number(contextoUsuarioActual.tenantId) === Number(tenant.id)
      )
    );
  }

  puedeEliminarTenant(contextoUsuarioActual) {
    return this.esOperadorSistema(contextoUsuarioActual);
  }

  puedeEditarEmpresa(contextoUsuarioActual, empresa) {
    return (
      this.esOperadorSistema(contextoUsuarioActual) ||
      (
        contextoUsuarioActual?.nivelScope === 'tenant' &&
        Number(contextoUsuarioActual.tenantId) === Number(empresa.tenantId)
      ) ||
      (
        contextoUsuarioActual?.nivelScope === 'empresa' &&
        Number(contextoUsuarioActual.empresaId) === Number(empresa.id)
      )
    );
  }

  puedeEliminarEmpresa(contextoUsuarioActual, empresa) {
    return (
      this.esOperadorSistema(contextoUsuarioActual) ||
      (
        contextoUsuarioActual?.nivelScope === 'tenant' &&
        Number(contextoUsuarioActual.tenantId) === Number(empresa.tenantId)
      )
    );
  }

  puedeCambiarTenantEmpresa(contextoUsuarioActual) {
    return this.esOperadorSistema(contextoUsuarioActual);
  }

  puedeEditarSitio(contextoUsuarioActual, sitio) {
    return (
      this.esOperadorSistema(contextoUsuarioActual) ||
      (
        contextoUsuarioActual?.nivelScope === 'tenant' &&
        Number(contextoUsuarioActual.tenantId) === Number(sitio.tenantId)
      ) ||
      (
        contextoUsuarioActual?.nivelScope === 'empresa' &&
        Number(contextoUsuarioActual.empresaId) === Number(sitio.empresaId)
      ) ||
      (
        contextoUsuarioActual?.nivelScope === 'sitio' &&
        Number(contextoUsuarioActual.sitioId) === Number(sitio.id)
      )
    );
  }

  puedeEliminarSitio(contextoUsuarioActual, sitio) {
    return (
      this.esOperadorSistema(contextoUsuarioActual) ||
      (
        contextoUsuarioActual?.nivelScope === 'tenant' &&
        Number(contextoUsuarioActual.tenantId) === Number(sitio.tenantId)
      ) ||
      (
        contextoUsuarioActual?.nivelScope === 'empresa' &&
        Number(contextoUsuarioActual.empresaId) === Number(sitio.empresaId)
      )
    );
  }

  puedeCrearSitio(contextoUsuarioActual, empresa) {
    return (
      this.esOperadorSistema(contextoUsuarioActual) ||
      (
        contextoUsuarioActual?.nivelScope === 'tenant' &&
        Number(contextoUsuarioActual.tenantId) === Number(empresa.tenantId)
      ) ||
      (
        contextoUsuarioActual?.nivelScope === 'empresa' &&
        Number(contextoUsuarioActual.empresaId) === Number(empresa.id)
      )
    );
  }

  assertPuedeCrearTenant(contextoUsuarioActual) {
    if (!this.esOperadorSistema(contextoUsuarioActual)) {
      throw crearErrorAlcance(
        'Solo un operador global puede crear tenants nuevos.',
        'SCOPE_CREAR_TENANT'
      );
    }
  }

  assertPuedeCrearEmpresa(contextoUsuarioActual, tenantId) {
    if (
      this.esOperadorSistema(contextoUsuarioActual) ||
      (
        contextoUsuarioActual?.nivelScope === 'tenant' &&
        Number(contextoUsuarioActual.tenantId) === Number(tenantId)
      )
    ) {
      return;
    }

    throw crearErrorAlcance(
      'Solo un operador global o un usuario de tenant puede crear empresas dentro de su tenant.'
    );
  }

  assertPuedeCrearSitio(contextoUsuarioActual, empresa) {
    if (this.puedeCrearSitio(contextoUsuarioActual, empresa)) {
      return;
    }

    throw crearErrorAlcance(
      'Solo un operador global, un usuario de tenant o un usuario de empresa pueden crear sitios dentro de su jerarquía.'
    );
  }

  assertPuedeCambiarTenantEmpresa(contextoUsuarioActual) {
    if (this.puedeCambiarTenantEmpresa(contextoUsuarioActual)) {
      return;
    }

    throw new Error(
      'Solo un operador global puede mover una empresa entre tenants.'
    );
  }

  esOperadorSistema(contextoUsuarioActual) {
    return contextoUsuarioActual?.nivelScope === 'portal';
  }

  tienePermisoAdministrarOrganizacion(contextoUsuarioActual) {
    return Boolean(
      contextoUsuarioActual?.permisos?.administrarOrganizacion
    );
  }

  tienePermisoAdministrarTenants(contextoUsuarioActual) {
    return Boolean(
      contextoUsuarioActual?.permisos?.administrarTenants ||
      contextoUsuarioActual?.permisos?.administrarOrganizacion
    );
  }

  tienePermisoAdministrarEmpresas(contextoUsuarioActual) {
    return Boolean(
      contextoUsuarioActual?.permisos?.administrarEmpresas ||
      contextoUsuarioActual?.permisos?.administrarOrganizacion
    );
  }

  tienePermisoAdministrarSitios(contextoUsuarioActual) {
    return Boolean(
      contextoUsuarioActual?.permisos?.administrarSitios ||
      contextoUsuarioActual?.permisos?.administrarOrganizacion
    );
  }

  assertPuedeAdministrarOrganizacion(contextoUsuarioActual) {
    if (!this.tienePermisoAdministrarOrganizacion(contextoUsuarioActual)) {
      throw new Error(
        'Necesitas permiso específico para administrar la organización.'
      );
    }
  }

  assertPuedeAdministrarTenants(contextoUsuarioActual) {
    if (!this.tienePermisoAdministrarTenants(contextoUsuarioActual)) {
      throw new Error(
        'Necesitas permiso específico para administrar tenants.'
      );
    }
  }

  assertPuedeAdministrarEmpresas(contextoUsuarioActual) {
    if (!this.tienePermisoAdministrarEmpresas(contextoUsuarioActual)) {
      throw new Error(
        'Necesitas permiso específico para administrar empresas.'
      );
    }
  }

  assertPuedeAdministrarSitios(contextoUsuarioActual) {
    if (!this.tienePermisoAdministrarSitios(contextoUsuarioActual)) {
      throw new Error(
        'Necesitas permiso específico para administrar sitios.'
      );
    }
  }

  normalizarTenant(datos) {
    return {
      nombre: this.normalizarTextoRequerido(datos.nombre, 'Debes indicar un nombre de tenant.'),
      alias: this.normalizarAlias(datos.alias, 'Debes indicar un alias de tenant.'),
      descripcion: this.normalizarTextoOpcional(datos.descripcion),
      estado: this.normalizarEstado(datos.estado)
    };
  }

  normalizarFormularioTenant({ tenantObjetivo = null, formularioBase = null }) {
    const base = formularioBase || {};

    return {
      id:
        base.id != null
          ? String(base.id)
          : (tenantObjetivo?.id != null ? String(tenantObjetivo.id) : ''),
      nombre: String(base.nombre ?? tenantObjetivo?.nombre ?? '').trim(),
      alias: String(base.alias ?? tenantObjetivo?.alias ?? '').trim(),
      descripcion: String(
        base.descripcion ?? tenantObjetivo?.descripcion ?? ''
      ).trim(),
      estado: this.normalizarEstadoFormulario(
        base.estado ?? tenantObjetivo?.estado ?? 'activo'
      )
    };
  }

  normalizarEstadoFormulario(valor) {
    const normalizado = String(valor || '').trim().toLowerCase();
    return ESTADOS_VALIDOS.includes(normalizado) ? normalizado : 'activo';
  }

  describirAlcanceTenantFormulario(contextoUsuarioActual) {
    if (this.esOperadorSistema(contextoUsuarioActual)) {
      return 'Operador global con capacidad total sobre tenants.';
    }

    if (contextoUsuarioActual?.nivelScope === 'tenant') {
      return `Sesión anclada al tenant #${contextoUsuarioActual.tenantId}; solo puedes editar ese tenant.`;
    }

    return 'El formulario respeta el alcance actual de la sesión.';
  }

  normalizarFormularioEmpresa({
    empresaObjetivo = null,
    formularioBase = null,
    tenantIdPorDefecto = '',
    tenantTextoPorDefecto = ''
  }) {
    const base = formularioBase || {};

    return {
      id:
        base.id != null
          ? String(base.id)
          : (empresaObjetivo?.id != null ? String(empresaObjetivo.id) : ''),
      tenantId: String(
        base.tenant_id ??
        empresaObjetivo?.tenantId ??
        tenantIdPorDefecto
      ).trim(),
      tenantTexto: String(
        base.tenant_texto ?? tenantTextoPorDefecto
      ).trim(),
      nombre: String(base.nombre ?? empresaObjetivo?.nombre ?? '').trim(),
      alias: String(base.alias ?? empresaObjetivo?.alias ?? '').trim(),
      cif: String(base.cif ?? empresaObjetivo?.cif ?? '').trim(),
      descripcion: String(
        base.descripcion ?? empresaObjetivo?.descripcion ?? ''
      ).trim(),
      confirmarCambioTenant: String(
        base.confirmar_cambio_tenant ?? ''
      ).trim(),
      estado: this.normalizarEstadoFormulario(
        base.estado ?? empresaObjetivo?.estado ?? 'activo'
      )
    };
  }

  describirAlcanceEmpresaFormulario(contextoUsuarioActual, empresaObjetivo) {
    if (this.esOperadorSistema(contextoUsuarioActual)) {
      return 'Operador global con capacidad total sobre empresas visibles, incluido el cambio de tenant con advertencia previa.';
    }

    if (contextoUsuarioActual?.nivelScope === 'tenant') {
      return `Sesión anclada al tenant #${contextoUsuarioActual.tenantId}; solo puedes operar dentro de ese tenant.`;
    }

    if (
      contextoUsuarioActual?.nivelScope === 'empresa' &&
      empresaObjetivo?.id != null
    ) {
      return `Sesión anclada a la empresa #${empresaObjetivo.id}; solo puedes ajustar esta entidad.`;
    }

    return 'El formulario respeta el alcance actual de la sesión.';
  }

  normalizarFormularioSitio({
    sitioObjetivo = null,
    formularioBase = null,
    empresaIdPorDefecto = ''
  }) {
    const base = formularioBase || {};

    return {
      id:
        base.id != null
          ? String(base.id)
          : (sitioObjetivo?.id != null ? String(sitioObjetivo.id) : ''),
      empresaId: String(
        base.empresa_id ??
        sitioObjetivo?.empresaId ??
        empresaIdPorDefecto
      ).trim(),
      nombre: String(base.nombre ?? sitioObjetivo?.nombre ?? '').trim(),
      alias: String(base.alias ?? sitioObjetivo?.alias ?? '').trim(),
      timezone: String(base.timezone ?? sitioObjetivo?.timezone ?? 'UTC').trim(),
      descripcion: String(
        base.descripcion ?? sitioObjetivo?.descripcion ?? ''
      ).trim(),
      estado: this.normalizarEstadoFormulario(
        base.estado ?? sitioObjetivo?.estado ?? 'activo'
      ),
      confirmarCambioEmpresa: String(base.confirmar_cambio_empresa || '').trim()
    };
  }

  describirAlcanceSitioFormulario(contextoUsuarioActual, sitioObjetivo) {
    if (this.esOperadorSistema(contextoUsuarioActual)) {
      return 'Operador global con capacidad total sobre sitios visibles.';
    }

    if (contextoUsuarioActual?.nivelScope === 'tenant') {
      return `Sesión anclada al tenant #${contextoUsuarioActual.tenantId}; solo puedes operar dentro de ese tenant.`;
    }

    if (contextoUsuarioActual?.nivelScope === 'empresa') {
      return `Sesión anclada a la empresa #${contextoUsuarioActual.empresaId}; solo puedes operar dentro de esa empresa.`;
    }

    if (
      contextoUsuarioActual?.nivelScope === 'sitio' &&
      sitioObjetivo?.id != null
    ) {
      return `Sesión anclada al sitio #${sitioObjetivo.id}; solo puedes ajustar esta entidad.`;
    }

    return 'El formulario respeta el alcance actual de la sesión.';
  }

  normalizarEmpresa(datos, opciones = { requiereTenant: true }) {
    const normalizado = {
      nombre: this.normalizarTextoRequerido(datos.nombre, 'Debes indicar un nombre de empresa.'),
      alias: this.normalizarAlias(datos.alias, 'Debes indicar un alias de empresa.'),
      cif: this.normalizarTextoOpcional(datos.cif, 40),
      descripcion: this.normalizarTextoOpcional(datos.descripcion),
      estado: this.normalizarEstado(datos.estado)
    };

    if (opciones.requiereTenant !== false) {
      normalizado.tenantId = this.normalizarId(
        datos.tenant_id,
        'Debes indicar un tenant válido.'
      );
    }

    return normalizado;
  }

  resolverTenantDestinoEmpresa(datos, empresaActual) {
    const valorFormulario = String(datos?.tenant_id ?? '').trim();

    if (!valorFormulario) {
      return Number(empresaActual.tenantId);
    }

    return this.normalizarId(
      valorFormulario,
      'Debes indicar un tenant válido.'
    );
  }

  async resolverTenantSeleccionadoFormularioEmpresa(
    contextoUsuarioActual,
    {
      empresaObjetivo = null,
      formularioBase = null
    } = {}
  ) {
    const base = formularioBase || {};
    const tenantIdCandidato =
      base.tenant_id ??
      empresaObjetivo?.tenantId ??
      (
        ['tenant', 'empresa', 'sitio'].includes(contextoUsuarioActual?.nivelScope)
          ? contextoUsuarioActual?.tenantId
          : null
      );

    const idNormalizado = this.normalizarIdOpcional(tenantIdCandidato);

    if (idNormalizado == null) {
      return null;
    }

    return this.resolverTenantFiltroEmpresas(
      contextoUsuarioActual,
      idNormalizado
    );
  }

  formatearTenantTextoSeleccion(tenant) {
    if (!tenant) {
      return '';
    }

    const nombre = String(tenant.nombre || '').trim();
    const alias = String(tenant.alias || '').trim();

    if (nombre && alias) {
      return `${nombre} · ${alias}`;
    }

    return nombre || alias || `Tenant #${tenant.id}`;
  }

  formatearEmpresaTextoSeleccion(empresa, { incluirTenant = true } = {}) {
    if (!empresa) {
      return '';
    }

    const nombre = String(empresa.nombre || '').trim();
    const alias = String(empresa.alias || '').trim();
    const tenantNombre = String(empresa.tenantNombre || '').trim();
    const partes = [nombre || `Empresa #${empresa.id}`];

    if (alias) {
      partes.push(alias);
    }

    if (incluirTenant && tenantNombre) {
      partes.push(`Tenant ${tenantNombre}`);
    }

    return partes.join(' · ');
  }

  resolverEmpresaDestinoSitio(datos, sitioActual) {
    const valorFormulario = String(datos?.empresa_id ?? '').trim();

    if (!valorFormulario) {
      return Number(sitioActual.empresaId);
    }

    return this.normalizarId(
      valorFormulario,
      'Debes indicar una empresa válida.'
    );
  }

  normalizarConfirmacionCambio(valor) {
    return ['1', 'true', 'on', 'si', 'sí'].includes(
      String(valor || '').trim().toLowerCase()
    );
  }

  normalizarConfirmacionCambioTenant(valor) {
    return this.normalizarConfirmacionCambio(valor);
  }

  enriquecerItemsImpactoCambioTenant(items = []) {
    return items
      .filter((item) => Number(item?.total || 0) > 0)
      .map((item) => ({
        ...item,
        etiquetaTabla: resolverEtiquetaTablaScopeOrganizativo(item.tabla)
      }));
  }

  normalizarSitio(datos, opciones = { requiereEmpresa: true }) {
    const normalizado = {
      nombre: this.normalizarTextoRequerido(datos.nombre, 'Debes indicar un nombre de sitio.'),
      alias: this.normalizarAlias(datos.alias, 'Debes indicar un alias de sitio.'),
      timezone: this.normalizarTextoRequerido(
        datos.timezone || 'UTC',
        'Debes indicar una timezone de sitio.',
        80
      ),
      descripcion: this.normalizarTextoOpcional(datos.descripcion),
      estado: this.normalizarEstado(datos.estado)
    };

    if (opciones.requiereEmpresa !== false) {
      normalizado.empresaId = this.normalizarId(
        datos.empresa_id,
        'Debes indicar una empresa válida.'
      );
    }

    return normalizado;
  }

  normalizarTextoRequerido(valor, mensajeError, longitudMaxima = 160) {
    const texto = String(valor || '').trim();

    if (!texto) {
      throw new Error(mensajeError);
    }

    return texto.slice(0, longitudMaxima);
  }

  normalizarTextoOpcional(valor, longitudMaxima = 255) {
    const texto = String(valor || '').trim();
    return texto ? texto.slice(0, longitudMaxima) : null;
  }

  normalizarAlias(valor, mensajeError) {
    const alias = String(valor || '').trim();

    if (!alias) {
      throw new Error(mensajeError);
    }

    if (!/^[a-zA-Z0-9._-]+$/.test(alias)) {
      throw new Error(
        'El alias solo puede contener letras, números, punto, guion y guion bajo.'
      );
    }

    return alias.slice(0, 120);
  }

  normalizarEstado(valor) {
    const estado = String(valor || 'activo').trim().toLowerCase();

    if (!ESTADOS_VALIDOS.includes(estado)) {
      throw new Error('El estado debe ser activo o inactivo.');
    }

    return estado;
  }

  normalizarId(valor, mensajeError) {
    const convertido = Number.parseInt(String(valor || ''), 10);

    if (!Number.isFinite(convertido) || convertido < 1) {
      throw new Error(mensajeError);
    }

    return convertido;
  }

  normalizarIdOpcional(valor) {
    const texto = String(valor ?? '').trim();

    if (!texto) {
      return null;
    }

    const convertido = Number.parseInt(texto, 10);
    return Number.isFinite(convertido) && convertido > 0
      ? convertido
      : null;
  }

  traducirErrorPersistencia(error, entidad) {
    if (error?.code === 'ER_DUP_ENTRY') {
      return new Error(
        `Ya existe otra ${entidad} con ese alias en el alcance permitido.`
      );
    }

    return error;
  }

  assertExiste(entidad, nombreEntidad) {
    if (!entidad) {
      throw new Error(`No existe ${nombreEntidad} solicitado.`);
    }
  }

  assertServicioImpactoDisponible() {
    if (!this.servicioImpactoEliminacion) {
      throw new Error('El evaluador de impacto no está disponible.');
    }
  }

  normalizarOrdenTenant(valor) {
    const columnas = new Set([
      'id',
      'nombre',
      'alias',
      'descripcion',
      'estado',
      'empresas',
      'sitios',
      'creado',
      'actualizado'
    ]);
    const normalizado = String(valor || '').trim().toLowerCase();
    return columnas.has(normalizado) ? normalizado : 'nombre';
  }

  normalizarOrdenEmpresa(valor) {
    const columnas = new Set([
      'id',
      'tenant',
      'nombre',
      'alias',
      'cif',
      'descripcion',
      'estado',
      'sitios',
      'creado',
      'actualizado'
    ]);
    const normalizado = String(valor || '').trim().toLowerCase();
    return columnas.has(normalizado) ? normalizado : 'nombre';
  }

  normalizarOrdenSitio(valor) {
    const columnas = new Set([
      'id',
      'tenant',
      'empresa',
      'nombre',
      'alias',
      'timezone',
      'descripcion',
      'estado',
      'creado',
      'actualizado'
    ]);
    const normalizado = String(valor || '').trim().toLowerCase();
    return columnas.has(normalizado) ? normalizado : 'nombre';
  }

  normalizarDireccionOrden(valor) {
    return String(valor || '').trim().toLowerCase() === 'desc'
      ? 'desc'
      : 'asc';
  }
}

function crearErrorAlcance(mensaje, codigo = 'SCOPE_ORGANIZACION') {
  const error = new Error(mensaje);
  error.statusCode = 403;
  error.codigo = codigo;
  return error;
}

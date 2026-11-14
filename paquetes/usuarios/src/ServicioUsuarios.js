import { ContextoUsuarioActual } from '../../contexto-usuario/src/ContextoUsuarioActual.js';
import { generarUuidV7Auditoria } from '../../auditoria/src/UuidV7Auditoria.js';
import { PERFIL_JCS_AUDITORIA_V1 } from '../../auditoria/src/PerfilJcsAuditoria.js';
import { VERSION_ENCADENADO_AUDITORIA_V1 } from '../../auditoria/src/SobreCanonicoAuditoria.js';

const PROFUNDIDAD_SCOPE = {
  portal: 0,
  tenant: 1,
  empresa: 2,
  sitio: 3
};

export class ServicioUsuarios {
  constructor({
    repositorioUsuarios,
    repositorioTenants,
    repositorioEmpresas,
    repositorioSitios,
    servicioAutenticacion,
    servicioAutorizacion,
    servicioSesion,
    resolutorScopeUsuario,
    validadorJerarquiaUsuario,
    asignadorPermisosUsuario,
    servicioEstadoSensibleUsuario = null,
    repositorioSesionesWebAuditoria = null,
    fronteraTransaccional = null,
    servicioAuditoria = null,
    repositorioControlFederacion = null,
    servicioAutoridadMutacionesEstructurales = null,
    servicioReconciliacionBajaUsuarioTriggerCorreo = null,
    ahora = () => new Date()
  }) {
    this.repositorioUsuarios = repositorioUsuarios;
    this.repositorioTenants = repositorioTenants;
    this.repositorioEmpresas = repositorioEmpresas;
    this.repositorioSitios = repositorioSitios;
    this.servicioAutenticacion = servicioAutenticacion;
    this.servicioAutorizacion = servicioAutorizacion;
    this.servicioSesion = servicioSesion;
    this.resolutorScopeUsuario = resolutorScopeUsuario;
    this.validadorJerarquiaUsuario = validadorJerarquiaUsuario;
    this.asignadorPermisosUsuario = asignadorPermisosUsuario;
    this.servicioEstadoSensibleUsuario = servicioEstadoSensibleUsuario;
    this.repositorioSesionesWebAuditoria = repositorioSesionesWebAuditoria;
    this.fronteraTransaccional = fronteraTransaccional;
    this.servicioAuditoria = servicioAuditoria;
    this.repositorioControlFederacion = repositorioControlFederacion;
    this.servicioAutoridadMutacionesEstructurales =
      servicioAutoridadMutacionesEstructurales;
    this.servicioReconciliacionBajaUsuarioTriggerCorreo =
      servicioReconciliacionBajaUsuarioTriggerCorreo;
    this.ahora = ahora;
  }

  async construirVistaListado(contextoUsuarioActual, filtrosEntrada = {}) {
    const tenants = await this.repositorioTenants.listarVisibles(
      contextoUsuarioActual
    );
    const tenantSolicitado = this.normalizarIdOpcional(filtrosEntrada.tenantId);
    const tenantId = tenants.some(
      (tenant) => Number(tenant.id) === Number(tenantSolicitado)
    )
      ? tenantSolicitado
      : null;
    const listado = await this.listarUsuariosAdministracion(contextoUsuarioActual, {
      tenantId,
      empresaId: filtrosEntrada.empresaId,
      sitioId: filtrosEntrada.sitioId
    });

    return {
      resumen: listado.resumen,
      alcanceActual: listado.alcanceActual,
      filtros: listado.filtros,
      opcionesTenants: tenants.map((tenant) => ({
        valor: tenant.id,
        etiqueta: `${tenant.nombre} (#${tenant.id})`
      }))
    };
  }

  async construirVistaPerfilActual(contextoUsuarioActual) {
    const usuario = await this.repositorioUsuarios.buscarPorIdParaAdministracion(
      contextoUsuarioActual,
      contextoUsuarioActual.idUsuario
    );

    if (!usuario) {
      throw new Error('No se pudo cargar el perfil del usuario actual.');
    }

    const resumen = usuario.obtenerResumenAdministracion({
      resolutorScopeUsuario: this.resolutorScopeUsuario
    });
    const permisosDetalle = this.construirDetallePermisosUsuario(
      resumen.permisos
    );
    const permisosActivosDetalle = permisosDetalle.filter(
      (permiso) => permiso.activo && !permiso.oculto
    );

    return {
      perfil: {
        ...resumen,
        inicial:
          String(
            resumen.nombreMostrar ||
            resumen.nombreCompleto ||
            resumen.usuario ||
            '?'
          )
            .trim()
            .charAt(0)
            .toUpperCase() || '?',
        permisosDetalle,
        permisosActivosDetalle,
        totalPermisosActivos: permisosActivosDetalle.length,
        contextoActual: contextoUsuarioActual.serializar()
      }
    };
  }

  async listarUsuariosAdministracion(
    contextoUsuarioActual,
    {
      textoBusqueda = '',
      tenantId = null,
      empresaId = null,
      sitioId = null,
      activo = 'solo_activos',
      pagina = 1,
      tamanoPagina = 10,
      ordenarPor = 'creado',
      direccionOrden = 'desc'
    } = {}
  ) {
    const resultado =
      await this.repositorioUsuarios.listarPaginadoParaAdministracion(
        contextoUsuarioActual,
        {
          textoBusqueda,
          tenantId,
          empresaId,
          sitioId,
          soloActivos: activo,
          pagina,
          tamanoPagina,
          ordenarPor,
          direccionOrden
        }
      );
    const usuariosSerializados = resultado.usuarios.map((usuario) => ({
      ...usuario.obtenerResumenAdministracion({
        resolutorScopeUsuario: this.resolutorScopeUsuario
      }),
      permisosDetalle: this.construirDetallePermisosUsuario(
        usuario.permisos.serializar()
      ),
      esUsuarioActual:
        Number(usuario.id) === Number(contextoUsuarioActual.idUsuario),
      urls: {
        editar: `/usuarios/editar/${usuario.id}`
      }
    }));

    return {
      resumen: {
        totalUsuarios: resultado.paginacion.totalFiltrado,
        totalPortal: usuariosSerializados.filter(
          (usuario) => usuario.nivelScope === 'portal'
        ).length,
        totalTenant: usuariosSerializados.filter(
          (usuario) => usuario.nivelScope === 'tenant'
        ).length,
        totalEmpresa: usuariosSerializados.filter(
          (usuario) => usuario.nivelScope === 'empresa'
        ).length,
        totalSitio: usuariosSerializados.filter(
          (usuario) => usuario.nivelScope === 'sitio'
        ).length
      },
      filtros: {
        textoBusqueda,
        tenantId: this.normalizarIdOpcional(tenantId) ?? '',
        empresaId: this.normalizarIdOpcional(empresaId) ?? '',
        sitioId: this.normalizarIdOpcional(sitioId) ?? '',
        activo,
        pagina: resultado.paginacion.pagina,
        tamanoPagina: resultado.paginacion.tamanoPagina,
        ordenarPor,
        direccionOrden
      },
      alcanceActual: this.construirAlcanceActual(contextoUsuarioActual),
      usuarios: usuariosSerializados,
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

  async listarUsuariosImpersonables(
    contextoUsuarioActual,
    sesionAutenticada,
    {
      textoBusqueda = '',
      tenantId = null,
      empresaId = null,
      sitioId = null,
      activo = 'todos',
      pagina = 1,
      tamanoPagina = 10,
      ordenarPor = 'usuario',
      direccionOrden = 'asc'
    } = {}
  ) {
    const resolucionActor =
      await this.resolverActorRealImpersonacion(
        contextoUsuarioActual,
        sesionAutenticada
      );
    const resultado =
      await this.repositorioUsuarios.listarPaginadoParaAdministracion(
        resolucionActor.contextoActorReal,
        {
          textoBusqueda,
          tenantId,
          empresaId,
          sitioId,
          soloActivos: activo,
          pagina,
          tamanoPagina,
          ordenarPor,
          direccionOrden,
          excluirIds: [
            resolucionActor.usuarioReal.id,
            contextoUsuarioActual.idUsuario
          ]
        }
      );

    const usuarios = resultado.usuarios.map((usuario) => ({
      ...usuario.obtenerResumenAdministracion({
        resolutorScopeUsuario: this.resolutorScopeUsuario
      }),
      esUsuarioReal: Number(usuario.id) === Number(resolucionActor.usuarioReal.id),
      esUsuarioEfectivo:
        Number(usuario.id) === Number(contextoUsuarioActual.idUsuario),
      sePuedeImpersonar: true
    }));

    return {
      actorReal: {
        id: resolucionActor.usuarioReal.id,
        usuario: resolucionActor.usuarioReal.usuario,
        nombreVisible: resolucionActor.usuarioReal.obtenerNombreVisible(),
        nivelScope: resolucionActor.contextoActorReal.nivelScope,
        descripcionScope: this.resolutorScopeUsuario.describirScope({
          tenantId: resolucionActor.contextoActorReal.tenantId,
          empresaId: resolucionActor.contextoActorReal.empresaId,
          sitioId: resolucionActor.contextoActorReal.sitioId
        })
      },
      impersonacionActiva: Boolean(
        resolucionActor.sesionNormalizada?.impersonacionActiva
      ),
      resumen: {
        totalUsuarios: resultado.paginacion.totalFiltrado,
        activos: usuarios.filter((usuario) => usuario.activo).length,
        inactivos: usuarios.filter((usuario) => !usuario.activo).length
      },
      filtros: {
        textoBusqueda,
        tenantId: this.normalizarIdOpcional(tenantId) ?? '',
        empresaId: this.normalizarIdOpcional(empresaId) ?? '',
        sitioId: this.normalizarIdOpcional(sitioId) ?? '',
        activo,
        pagina: resultado.paginacion.pagina,
        tamanoPagina: resultado.paginacion.tamanoPagina,
        ordenarPor,
        direccionOrden
      },
      usuarios,
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

  async iniciarImpersonacion(
    contextoUsuarioActual,
    sesionAutenticada,
    idUsuarioObjetivo
  ) {
    const resolucionActor =
      await this.resolverActorRealImpersonacion(
        contextoUsuarioActual,
        sesionAutenticada
      );
    const idObjetivo = this.normalizarIdOpcional(idUsuarioObjetivo);

    if (idObjetivo == null) {
      throw this.crearErrorHttp(400, 'Debes indicar un usuario objetivo válido.');
    }

    if (resolucionActor.sesionNormalizada?.impersonacionActiva) {
      throw this.crearErrorHttp(
        400,
        'La sesión ya está impersonada. Debes revertir antes de cambiar otra vez.'
      );
    }

    if (Number(idObjetivo) === Number(resolucionActor.usuarioReal.id)) {
      throw this.crearErrorHttp(
        400,
        'La identidad real no puede impersonarse a sí misma.'
      );
    }

    const usuarioObjetivo = await this.repositorioUsuarios.buscarPorId(idObjetivo);

    if (!usuarioObjetivo) {
      throw this.crearErrorHttp(
        404,
        'El usuario objetivo ya no existe o quedó fuera del alcance visible.'
      );
    }

    this.assertUsuarioConJerarquiaValida(usuarioObjetivo);

    const contextoObjetivo = this.construirContextoDesdeUsuario(usuarioObjetivo);

    if (
      !this.puedeContextoCubrirScope(
        resolucionActor.contextoActorReal,
        contextoObjetivo
      )
    ) {
      throw this.crearErrorHttp(
        403,
        'No puedes impersonar un usuario fuera del scope alcanzable por tu identidad real.'
      );
    }

    return {
      usuarioReal: resolucionActor.usuarioReal,
      usuarioObjetivo
    };
  }

  async revertirImpersonacion(contextoUsuarioActual, sesionAutenticada) {
    const resolucionActor =
      await this.resolverActorRealImpersonacion(
        contextoUsuarioActual,
        sesionAutenticada,
        { requerirPermiso: false }
      );

    if (!resolucionActor.sesionNormalizada?.impersonacionActiva) {
      throw this.crearErrorHttp(
        400,
        'La sesión actual no está impersonada.'
      );
    }

    return {
      usuarioReal: resolucionActor.usuarioReal
    };
  }

  async construirVistaFormulario(contextoUsuarioActual, { idUsuario = null } = {}) {
    const objetivo = idUsuario == null
      ? null
      : await this.repositorioUsuarios.buscarPorIdParaAdministracion(
          contextoUsuarioActual,
          idUsuario
        );

    if (idUsuario != null && !objetivo) {
      throw new Error('No existe el usuario solicitado en tu alcance visible.');
    }

    if (objetivo) {
      this.assertUsuarioConJerarquiaValida(objetivo);
    }

    const formulario = objetivo
      ? this.construirFormularioDesdeUsuario(objetivo)
      : this.construirFormularioAltaPorDefecto(contextoUsuarioActual);
    const opcionesTenants = await this.repositorioTenants.listarVisibles(
      contextoUsuarioActual
    );
    const opcionesEmpresas = await this.obtenerOpcionesEmpresas(
      contextoUsuarioActual,
      formulario.tenantId || null
    );
    const opcionesSitios = await this.obtenerOpcionesSitios(
      contextoUsuarioActual,
      formulario.tenantId || null,
      formulario.empresaId || null
    );
    const permisosFormulario =
      this.construirPermisosFormulario(
        contextoUsuarioActual,
        formulario.permisos,
        formulario.nivelScope
      );

    return {
      modo: objetivo ? 'editar' : 'nuevo',
      usuarioObjetivo: objetivo
        ? {
            ...objetivo.obtenerResumenAdministracion({
              resolutorScopeUsuario: this.resolutorScopeUsuario
            }),
            esUsuarioActual:
              Number(objetivo.id) === Number(contextoUsuarioActual.idUsuario)
          }
        : null,
      alcanceActual: this.construirAlcanceActual(contextoUsuarioActual),
      formulario,
      opcionesNivelScope:
        this.construirOpcionesNivelScope(contextoUsuarioActual),
      opcionesTenants: opcionesTenants.map((tenant) => ({
        valor: tenant.id,
        etiqueta: `${tenant.nombre} (#${tenant.id})`
      })),
      opcionesEmpresas,
      opcionesSitios,
      permisosFormulario,
      permisosSoloLecturaActivos: permisosFormulario.filter(
        (permiso) => !permiso.editable && permiso.activo
      )
    };
  }

  async obtenerOpcionesEmpresas(contextoUsuarioActual, tenantId) {
    const tenantNormalizado = this.normalizarIdOpcional(tenantId);

    if (tenantNormalizado == null) {
      return [];
    }

    const empresas = await this.repositorioEmpresas.listarVisibles(
      contextoUsuarioActual
    );

    return empresas
      .filter((empresa) => Number(empresa.tenantId) === Number(tenantNormalizado))
      .map((empresa) => ({
        valor: empresa.id,
        tenantId: empresa.tenantId,
        etiqueta: `${empresa.nombre} (#${empresa.id})`
      }));
  }

  async obtenerOpcionesTenantsImpersonacion(
    contextoUsuarioActual,
    sesionAutenticada
  ) {
    const resolucionActor =
      await this.resolverActorRealImpersonacion(
        contextoUsuarioActual,
        sesionAutenticada
      );
    const tenants = await this.repositorioTenants.listarVisibles(
      resolucionActor.contextoActorReal
    );

    return tenants.map((tenant) => ({
      valor: tenant.id,
      etiqueta: `${tenant.nombre} (#${tenant.id})`
    }));
  }

  async obtenerOpcionesEmpresasImpersonacion(
    contextoUsuarioActual,
    sesionAutenticada,
    tenantId
  ) {
    const resolucionActor =
      await this.resolverActorRealImpersonacion(
        contextoUsuarioActual,
        sesionAutenticada
      );

    return this.obtenerOpcionesEmpresas(
      resolucionActor.contextoActorReal,
      tenantId
    );
  }

  async obtenerOpcionesSitios(contextoUsuarioActual, tenantId, empresaId) {
    const tenantNormalizado = this.normalizarIdOpcional(tenantId);
    const empresaNormalizada = this.normalizarIdOpcional(empresaId);

    if (tenantNormalizado == null || empresaNormalizada == null) {
      return [];
    }

    const sitios = await this.repositorioSitios.listarVisibles(
      contextoUsuarioActual
    );

    return sitios
      .filter(
        (sitio) =>
          Number(sitio.tenantId) === Number(tenantNormalizado) &&
          Number(sitio.empresaId) === Number(empresaNormalizada)
      )
      .map((sitio) => ({
        valor: sitio.id,
        tenantId: sitio.tenantId,
        empresaId: sitio.empresaId,
        etiqueta: `${sitio.nombre} (#${sitio.id})`
      }));
  }

  async obtenerOpcionesSitiosImpersonacion(
    contextoUsuarioActual,
    sesionAutenticada,
    tenantId,
    empresaId
  ) {
    const resolucionActor =
      await this.resolverActorRealImpersonacion(
        contextoUsuarioActual,
        sesionAutenticada
      );

    return this.obtenerOpcionesSitios(
      resolucionActor.contextoActorReal,
      tenantId,
      empresaId
    );
  }

  async crearUsuarioAdministrativo(contextoUsuarioActual, datos) {
    const usuario = String(datos.usuario || '').trim();
    const emailEntrada = String(datos.email || '').trim();
    const email = this.validadorJerarquiaUsuario.normalizarEmail
      ? this.validadorJerarquiaUsuario.normalizarEmail(emailEntrada)
      : emailEntrada;
    const password = String(datos.password || '');
    const passwordConfirmacion = String(datos.password_confirmacion || '');
    const nombreMostrar = String(datos.nombre_mostrar || '').trim();
    const nombreCompleto = String(datos.nombre_completo || '').trim();

    this.validadorJerarquiaUsuario.validarAltaBase({
      usuario,
      email
    });
    this.servicioAutenticacion.validarPasswordNueva(
      password,
      passwordConfirmacion
    );

    const scopeObjetivo = await this.resolverScopeObjetivoValido(
      contextoUsuarioActual,
      datos
    );
    const permisosSolicitados =
      this.construirPermisosObjetivoDesdeFormulario({
        contextoUsuarioActual,
        datos,
        nivelScopeObjetivo: scopeObjetivo.nivelScope
      });
    const hashPassword =
      await this.servicioAutenticacion.crearHashPassword(password);
    const altaEstructural = scopeObjetivo.tenantId != null;
    if (altaEstructural &&
        (!this.auditoriaAdministrativaActiva() ||
         typeof this.servicioAutoridadMutacionesEstructurales
           ?.serializarAltaEnTransaccion !== 'function')) {
      throw new Error(
        'El alta de usuario con scope exige autoridad jerárquica transaccional.'
      );
    }

    try {
      if (this.auditoriaAdministrativaActiva()) {
        return await this.fronteraTransaccional.ejecutar(async (conexion) => {
          if (altaEstructural) {
            await this.servicioAutoridadMutacionesEstructurales
              .serializarAltaEnTransaccion({
                scopePadre: this.normalizarScopeAuditoria(scopeObjetivo)
              }, { conexion });
          }
          const creado =
            await this.repositorioUsuarios.crearUsuarioAdministrativoEnTransaccion({
              usuario,
              email,
              hashPassword,
              nombreMostrar,
              nombreCompleto,
              tenantId: scopeObjetivo.tenantId,
              empresaId: scopeObjetivo.empresaId,
              sitioId: scopeObjetivo.sitioId,
              permisos: permisosSolicitados,
              requiereCambioPassword: true
            }, { conexion });

          await this.registrarEventoUsuarioAdministrativo({
            conexion,
            contextoUsuarioActual,
            tipo: 'usuario.creado',
            sujetoId: creado.id,
            scope: this.scopeUsuario(creado),
            payload: {
              resultado: 'creado',
              antes: null,
              despues: this.fotografiaUsuarioSegura(creado)
            }
          });

          return creado;
        });
      }

      return await this.repositorioUsuarios.crearUsuarioAdministrativo({
        usuario,
        email,
        hashPassword,
        nombreMostrar,
        nombreCompleto,
        tenantId: scopeObjetivo.tenantId,
        empresaId: scopeObjetivo.empresaId,
        sitioId: scopeObjetivo.sitioId,
        permisos: permisosSolicitados,
        requiereCambioPassword: true
      });
    } catch (error) {
      if (error?.code === 'ER_DUP_ENTRY') {
        throw new Error('Ya existe un usuario con ese identificador.');
      }

      throw error;
    }
  }

  async actualizarUsuarioAdministrativo(contextoUsuarioActual, idUsuario, datos) {
    const objetivo =
      await this.repositorioUsuarios.buscarPorIdParaAdministracion(
        contextoUsuarioActual,
        idUsuario
      );

    if (!objetivo) {
      throw new Error('No existe el usuario solicitado en tu alcance visible.');
    }

    this.assertUsuarioConJerarquiaValida(objetivo);

    const emailEntrada = String(datos.email || '').trim();
    const email = this.validadorJerarquiaUsuario.normalizarEmail
      ? this.validadorJerarquiaUsuario.normalizarEmail(emailEntrada)
      : emailEntrada;
    const nombreMostrar = String(datos.nombre_mostrar || '').trim();
    const nombreCompleto = String(datos.nombre_completo || '').trim();

    this.validadorJerarquiaUsuario.validarEdicionBase({
      email
    });

    const scopeObjetivo = await this.resolverScopeObjetivoValido(
      contextoUsuarioActual,
      datos
    );
    const permisosObjetivo = this.construirPermisosObjetivoDesdeFormulario({
      contextoUsuarioActual,
      datos,
      permisosBase: objetivo.permisos.serializar(),
      nivelScopeObjetivo: scopeObjetivo.nivelScope
    });
    const cambioScope =
      Number(objetivo.tenantId) !== Number(scopeObjetivo.tenantId) ||
      Number(objetivo.empresaId) !== Number(scopeObjetivo.empresaId) ||
      Number(objetivo.sitioId) !== Number(scopeObjetivo.sitioId);
    const cambioPermisos = this.hayCambioPermisos(
      objetivo.permisos.serializar(),
      permisosObjetivo
    );
    const cambioAutorizacion = cambioScope || cambioPermisos;
    const cambioEmail = objetivo.email !== email;

    if (
      cambioAutorizacion &&
      Number(objetivo.id) === Number(contextoUsuarioActual.idUsuario)
    ) {
      throw new Error(
        'No puedes cambiar tu propio scope ni tus permisos desde esta pantalla.'
      );
    }

    if (cambioAutorizacion) {
      await this.assertCoberturaAdministrativaCritica({
        usuarioActual: objetivo,
        scopeObjetivo,
        permisosObjetivo
      });
    }
    if (cambioScope &&
        (!this.auditoriaAdministrativaActiva() ||
         typeof this.servicioAutoridadMutacionesEstructurales
           ?.autorizarMovimientoUsuarioEnTransaccion !== 'function')) {
      throw new Error(
        'El movimiento de usuario exige autoridad jerárquica transaccional.'
      );
    }

    const actualizar = (conexion = null) => {
      const metodo = conexion
        ? 'actualizarUsuarioAdministrativoEnTransaccion'
        : 'actualizarUsuarioAdministrativo';
      return this.repositorioUsuarios[metodo]({
        idUsuario,
        email,
        nombreMostrar,
        nombreCompleto,
        tenantId: scopeObjetivo.tenantId,
        empresaId: scopeObjetivo.empresaId,
        sitioId: scopeObjetivo.sitioId,
        permisos: permisosObjetivo,
        incrementarVersionSesion: cambioAutorizacion
      }, conexion ? { conexion } : undefined);
    };

    const ejecutarCambio = this.auditoriaAdministrativaActiva()
      ? async () => this.fronteraTransaccional.ejecutar(async (conexion) => {
          if (cambioScope) {
            await this.servicioAutoridadMutacionesEstructurales
              .autorizarMovimientoUsuarioEnTransaccion({
                usuarioId: objetivo.id,
                scopeOrigen: this.scopeUsuario(objetivo),
                scopeDestino: this.normalizarScopeAuditoria(scopeObjetivo)
              }, { conexion });
          }
          const actualizado = await actualizar(conexion);
          if (cambioAutorizacion && this.repositorioControlFederacion) {
            await this.repositorioControlFederacion.reevaluarAutoridadUsuarioEnTransaccion({
              usuarioId: String(idUsuario),
              actor: this.actorControlFederacion(contextoUsuarioActual)
            }, { conexion });
          }
          const eventos = await this.registrarEventosActualizacionAdministrativa({
            conexion,
            contextoUsuarioActual,
            antes: objetivo,
            despues: actualizado,
            cambioEmail,
            cambioScope,
            cambioPermisos,
            permisosObjetivo,
            scopeObjetivo
          });
          const eventoCausal = eventos.find(
            (evento) => evento?.tipo === 'scope.entidad_salida'
          ) || eventos.find(
            (evento) => evento?.tipo === 'usuario.permisos_cambiados'
          ) || eventos[0] || null;

          return {
            usuario: actualizado,
            eventos,
            sesionesSql: await this.invalidarSesionesSqlPorCambioAdministrativo({
              conexion,
              contextoUsuarioActual,
              idUsuario,
              versionSesion: actualizado.versionSesion,
              causa: cambioScope ? 'scope_cambiado' : 'permisos_cambiados',
              habilitada: cambioAutorizacion,
              causalidadId: eventoCausal?.eventoId ?? eventoCausal?.evento?.eventoId
            })
          };
        })
      : async () => ({ usuario: await actualizar(), eventos: [], sesionesSql: [] });

    const ejecucionSensible = cambioEmail && this.servicioEstadoSensibleUsuario
      ? await this.servicioEstadoSensibleUsuario.ejecutarConExclusion(
          idUsuario,
          ejecutarCambio
        )
      : null;
    const resultadoCambio = ejecucionSensible
      ? ejecucionSensible.resultado
      : await ejecutarCambio();
    const actualizado = resultadoCambio.usuario;

    if (cambioAutorizacion) {
      await this.servicioSesion.sincronizarVersionUsuario(
        actualizado.id,
        actualizado.versionSesion
      );
    }

    this.exigirLimpiezaSensibleCompleta(ejecucionSensible, {
      operacion: 'actualizar el email administrativo'
    });

    return {
      usuario: actualizado,
      cambioAutorizacion,
      cambioEmail,
      eventosAuditoria: resultadoCambio.eventos,
      sesionesSql: resultadoCambio.sesionesSql,
      limpiezaEstadoSensible: ejecucionSensible?.limpieza ?? null
    };
  }

  async reiniciarPasswordAdministrativo(
    contextoUsuarioActual,
    idUsuario,
    { password, passwordConfirmacion }
  ) {
    const objetivo = await this.repositorioUsuarios.buscarPorIdParaAdministracion(
      contextoUsuarioActual,
      idUsuario
    );
    if (!objetivo) {
      throw new Error('No existe el usuario solicitado en tu alcance visible.');
    }
    if (Number(objetivo.id) === Number(contextoUsuarioActual.idUsuario)) {
      throw new Error('Utiliza Mi perfil para cambiar tu propia contraseña.');
    }
    this.servicioAutenticacion.validarPasswordNueva(
      password,
      passwordConfirmacion
    );
    const hashPasswordNuevo =
      await this.servicioAutenticacion.crearHashPassword(password);
    const ejecucion = await this.exigirServicioEstadoSensible()
      .ejecutarConExclusion(idUsuario, () =>
        this.auditoriaAdministrativaActiva()
          ? this.fronteraTransaccional.ejecutar(async (conexion) => {
              const actualizado =
                await this.repositorioUsuarios
                  .reiniciarPasswordAdministrativaEnTransaccion({
                    idUsuario,
                    hashPasswordNuevo
                  }, { conexion });
              if (!actualizado) return null;

              const eventoPassword =
                await this.registrarEventoUsuarioAdministrativo({
                  conexion,
                  contextoUsuarioActual,
                  tipo: 'usuario.password_reiniciado',
                  sujetoId: idUsuario,
                  scope: this.scopeUsuario(actualizado),
                  payload: {
                    operacion: 'reinicio',
                    resultado: 'reiniciada',
                    causa: 'administrador'
                  }
                });
              const sesionesSql =
                await this.invalidarSesionesSqlPorCambioAdministrativo({
                  conexion,
                  contextoUsuarioActual,
                  idUsuario,
                  versionSesion: actualizado.versionSesion,
                  causa: 'password_reiniciado',
                  habilitada: true,
                  causalidadId: eventoPassword?.evento?.eventoId
                });

              return {
                usuario: actualizado,
                eventos: [eventoPassword],
                sesionesSql
              };
            })
          : this.repositorioUsuarios.reiniciarPasswordAdministrativa({
              idUsuario,
              hashPasswordNuevo
            })
      );
    const usuarioReiniciado = this.auditoriaAdministrativaActiva()
      ? ejecucion.resultado?.usuario
      : ejecucion.resultado;
    if (!usuarioReiniciado) {
      throw new Error('El usuario ya no está activo o no pudo actualizarse.');
    }
    const sesiones = await this.servicioSesion.invalidarSesionesUsuario(
      idUsuario,
      usuarioReiniciado.versionSesion
    );
    this.exigirLimpiezaSensibleCompleta(ejecucion, {
      operacion: 'reiniciar la contraseña administrativa'
    });
    return {
      usuario: usuarioReiniciado,
      sesiones,
      sesionesSql: ejecucion.resultado?.sesionesSql ?? [],
      eventosAuditoria: ejecucion.resultado?.eventos ?? [],
      limpiezaEstadoSensible: ejecucion.limpieza
    };
  }

  async establecerEstadoUsuarioAdministrativo(
    contextoUsuarioActual,
    idUsuario,
    activo
  ) {
    const objetivo = await this.repositorioUsuarios.buscarPorIdParaAdministracion(
      contextoUsuarioActual,
      idUsuario
    );
    if (!objetivo) {
      throw new Error('No existe el usuario solicitado en tu alcance visible.');
    }
    if (
      !activo &&
      Number(objetivo.id) === Number(contextoUsuarioActual.idUsuario)
    ) {
      throw new Error('No puedes desactivar tu propio usuario.');
    }
    if (!activo) {
      await this.assertCoberturaAdministrativaCritica({ usuarioActual: objetivo });
    }
    const ejecucion = await this.exigirServicioEstadoSensible()
      .ejecutarConExclusion(idUsuario, () =>
        this.auditoriaAdministrativaActiva()
          ? this.fronteraTransaccional.ejecutar(async (conexion) => {
              const actualizado =
                await this.repositorioUsuarios
                  .establecerActivoAdministrativoEnTransaccion({
                    idUsuario,
                    activo: Boolean(activo)
                  }, { conexion });
              if (!actualizado) return null;

              const huboCambio =
                Boolean(objetivo.activo) !== Boolean(actualizado.activo);
              if (huboCambio && !actualizado.activo && this.repositorioControlFederacion) {
                await this.repositorioControlFederacion.cortarDependenciasEnTransaccion({
                  usuarioIds: [String(idUsuario)], causa: 'usuarioInactivo',
                  actor: this.actorControlFederacion(contextoUsuarioActual)
                }, { conexion });
              }
              const eventoEstado = huboCambio
                ? await this.registrarEventoUsuarioAdministrativo({
                    conexion,
                    contextoUsuarioActual,
                    tipo: 'usuario.estado_cambiado',
                    sujetoId: idUsuario,
                    scope: this.scopeUsuario(actualizado),
                    payload: {
                      estadoAntes: objetivo.activo ? 'activo' : 'inactivo',
                      estadoDespues: actualizado.activo ? 'activo' : 'inactivo',
                      motivo: 'operador'
                    }
                  })
                : null;
              const sesionesSql =
                await this.invalidarSesionesSqlPorCambioAdministrativo({
                  conexion,
                  contextoUsuarioActual,
                  idUsuario,
                  versionSesion: actualizado.versionSesion,
                  causa: 'estado_cambiado',
                  habilitada: huboCambio,
                  causalidadId: eventoEstado?.evento?.eventoId
                });

              return {
                usuario: actualizado,
                eventos: eventoEstado ? [eventoEstado] : [],
                sesionesSql
              };
            })
          : this.repositorioUsuarios.establecerActivoAdministrativo({
              idUsuario,
              activo: Boolean(activo)
            })
      );
    const usuarioEstado = this.auditoriaAdministrativaActiva()
      ? ejecucion.resultado?.usuario
      : ejecucion.resultado;
    if (!usuarioEstado) {
      throw new Error('El usuario ya no existe o no pudo actualizarse.');
    }
    const sesiones = await this.servicioSesion.invalidarSesionesUsuario(
      idUsuario,
      usuarioEstado.versionSesion
    );
    this.exigirLimpiezaSensibleCompleta(ejecucion, {
      operacion: activo ? 'reactivar el usuario' : 'desactivar el usuario'
    });
    return {
      usuario: usuarioEstado,
      sesiones,
      sesionesSql: ejecucion.resultado?.sesionesSql ?? [],
      eventosAuditoria: ejecucion.resultado?.eventos ?? [],
      limpiezaEstadoSensible: ejecucion.limpieza
    };
  }

  async eliminarUsuario(contextoUsuarioActual, idUsuario) {
    const objetivo =
      await this.repositorioUsuarios.buscarPorIdParaAdministracion(
        contextoUsuarioActual,
        idUsuario
      );

    if (!objetivo) {
      throw new Error('No existe el usuario solicitado en tu alcance visible.');
    }

    this.assertUsuarioConJerarquiaValida(objetivo);

    this.validadorJerarquiaUsuario.assertNoAutoEliminacion({
      idEditor: contextoUsuarioActual.idUsuario,
      idObjetivo: idUsuario
    });

    await this.assertCoberturaAdministrativaCritica({
      usuarioActual: objetivo
    });

    const eliminar = () => this.auditoriaAdministrativaActiva()
      ? this.fronteraTransaccional.ejecutar(async (conexion) => {
          const objetivoBloqueado =
            this.servicioReconciliacionBajaUsuarioTriggerCorreo
              ? await this.repositorioUsuarios.buscarPorIdEnTransaccion(
                  idUsuario,
                  { conexion, forUpdate: true }
                )
              : objetivo;
          if (!objetivoBloqueado) {
            throw new Error('El usuario ya no existe o no pudo eliminarse.');
          }
          const preparacionCorreo =
            this.servicioReconciliacionBajaUsuarioTriggerCorreo
              ? await this.servicioReconciliacionBajaUsuarioTriggerCorreo
                .prepararEnTransaccion(idUsuario, { conexion })
              : null;
          const sesionesSql =
            await this.invalidarSesionesSqlPorCambioAdministrativo({
              conexion,
              contextoUsuarioActual,
              idUsuario,
              versionSesion: objetivo.versionSesion + 1,
              causa: 'usuario_eliminado',
              habilitada: true
            });
          if (this.repositorioControlFederacion) {
            await this.repositorioControlFederacion.cortarDependenciasEnTransaccion({
              usuarioIds: [String(idUsuario)], causa: 'usuarioEliminado',
              actor: this.actorControlFederacion(contextoUsuarioActual)
            }, { conexion });
          }
          const eliminado =
            await this.repositorioUsuarios.eliminarPorIdEnTransaccion(
              idUsuario,
              { conexion }
            );
          const reconciliacionCorreo = eliminado && preparacionCorreo
            ? await this.servicioReconciliacionBajaUsuarioTriggerCorreo
              .reconciliarEnTransaccion(
                preparacionCorreo,
                contextoUsuarioActual,
                { conexion }
              )
            : null;
          const impactoResumen = {
            dependenciasEliminadas: String(sesionesSql.length),
            referenciasDesacopladas: String(
              reconciliacionCorreo?.totalRelacionesRetiradas || 0
            )
          };
          const eventoEliminacion =
            await this.registrarEventoUsuarioAdministrativo({
              conexion,
              contextoUsuarioActual,
              tipo: 'usuario.eliminado',
              sujetoId: idUsuario,
              scope: this.scopeUsuario(objetivoBloqueado),
              payload: {
                resultado: 'eliminado',
                antes: this.fotografiaUsuarioSegura(objetivoBloqueado),
                despues: null,
                impactoResumen: Object.values(impactoResumen).some(
                  (valor) => valor !== '0'
                ) ? impactoResumen : null
              }
            });
          return {
            eliminado,
            eventos: [
              ...(reconciliacionCorreo?.eventos || []),
              eventoEliminacion
            ],
            sesionesSql,
            reconciliacionCorreo
          };
        })
      : this.repositorioUsuarios.eliminarPorId(idUsuario);

    const ejecucionSensible = this.servicioEstadoSensibleUsuario
      ? await this.servicioEstadoSensibleUsuario.ejecutarConExclusion(
          idUsuario,
          eliminar,
          {
            debeInvalidar: (resultado) => this.auditoriaAdministrativaActiva()
              ? Boolean(resultado?.eliminado)
              : Boolean(resultado)
          }
        )
      : null;
    const resultadoEliminacion = ejecucionSensible
      ? ejecucionSensible.resultado
      : await eliminar();
    const eliminado = this.auditoriaAdministrativaActiva()
      ? resultadoEliminacion?.eliminado
      : resultadoEliminacion;

    if (!eliminado) {
      throw new Error('El usuario ya no existe o no pudo eliminarse.');
    }

    try {
      const limpiezaRedis = await this.servicioSesion.limpiarEstadoUsuario(
        idUsuario
      );

      return {
        eliminado: true,
        limpiezaRedis,
        sesionesSql: resultadoEliminacion?.sesionesSql ?? [],
        eventosAuditoria: resultadoEliminacion?.eventos ?? [],
        reconciliacionCorreo: resultadoEliminacion?.reconciliacionCorreo ?? null,
        limpiezaEstadoSensible: ejecucionSensible?.limpieza ?? null
      };
    } catch (error) {
      console.error(
        `[usuarios] El usuario ${idUsuario} se eliminó en SQL pero falló la limpieza Redis.`
      );
      console.error(error);

      return {
        eliminado: true,
        limpiezaRedis: {
          error: true,
          mensaje: 'El usuario se eliminó, pero no se pudo limpiar Redis.'
        }
      };
    }
  }

  exigirServicioEstadoSensible() {
    if (!this.servicioEstadoSensibleUsuario) {
      throw new Error('El servicio de estado sensible no está disponible.');
    }
    return this.servicioEstadoSensibleUsuario;
  }

  exigirLimpiezaSensibleCompleta(ejecucion, { operacion }) {
    if (ejecucion && !ejecucion.limpieza.completa) {
      throw new Error(
        `La operación durable terminó al ${operacion}, pero no pudo invalidarse todo el estado sensible.`
      );
    }
  }

  auditoriaAdministrativaActiva() {
    return Boolean(
      this.fronteraTransaccional?.ejecutar &&
      this.servicioAuditoria?.registrarEnTransaccion &&
      this.servicioAuditoria?.registrarMovimientoEnTransaccion
    );
  }

  async registrarEventosActualizacionAdministrativa({
    conexion,
    contextoUsuarioActual,
    antes,
    despues,
    cambioEmail,
    cambioScope,
    cambioPermisos,
    permisosObjetivo,
    scopeObjetivo
  }) {
    if (!this.auditoriaAdministrativaActiva()) return [];
    const eventos = [];
    const camposPerfil = this.camposPerfilAdministrativoCambiados({
      antes,
      despues,
      cambioEmail
    });
    if (camposPerfil.length > 0) {
      eventos.push(await this.registrarEventoUsuarioAdministrativo({
        conexion,
        contextoUsuarioActual,
        tipo: 'usuario.perfil_cambiado',
        sujetoId: despues.id,
        scope: this.scopeUsuario(despues),
        payload: {
          resultado: 'actualizado',
          camposCambiados: camposPerfil,
          antes: {},
          despues: {}
        }
      }));
    }
    if (cambioPermisos) {
      const permisosAntes = this.fotografiaPermisos(antes.permisos?.serializar());
      const permisosDespues = this.fotografiaPermisos(permisosObjetivo);
      const camposCambiados = Object.keys({
        ...permisosAntes,
        ...permisosDespues
      })
        .filter((campo) => permisosAntes[campo] !== permisosDespues[campo])
        .sort((a, b) => Buffer.compare(Buffer.from(a), Buffer.from(b)));
      eventos.push(await this.registrarEventoUsuarioAdministrativo({
        conexion,
        contextoUsuarioActual,
        tipo: 'usuario.permisos_cambiados',
        sujetoId: despues.id,
        scope: this.scopeUsuario(despues),
        payload: {
          resultado: 'actualizado',
          camposCambiados,
          antes: this.seleccionarCampos(permisosAntes, camposCambiados),
          despues: this.seleccionarCampos(permisosDespues, camposCambiados)
        }
      }));
    }
    if (cambioScope) {
      const movimiento = await this.registrarMovimientoScopeUsuarioAdministrativo({
        conexion,
        contextoUsuarioActual,
        idUsuario: despues.id,
        scopeAnterior: this.scopeUsuario(antes),
        scopePosterior: this.normalizarScopeAuditoria(scopeObjetivo)
      });
      eventos.push(movimiento.salida, movimiento.entrada);
    }
    return eventos;
  }

  async registrarMovimientoScopeUsuarioAdministrativo({
    conexion,
    contextoUsuarioActual,
    idUsuario,
    scopeAnterior,
    scopePosterior
  }) {
    const salidaId = generarUuidV7Auditoria();
    const entradaId = generarUuidV7Auditoria();
    const correlacionId = generarUuidV7Auditoria();
    const claveOperacion = generarUuidV7Auditoria();
    const comun = {
      versionContrato: 1,
      flujo: 'usuarios',
      actorReal: this.actorRealAuditoria(contextoUsuarioActual),
      actorEfectivo: this.actorEfectivoAuditoria(contextoUsuarioActual),
      modoActuacion: contextoUsuarioActual?.impersonacionActiva
        ? 'impersonado'
        : 'directo',
      sujeto: { tipo: 'usuario', id: String(idUsuario) },
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
      claveCadena: this.claveCadenaUsuarios(scopeAnterior),
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
      claveCadena: this.claveCadenaUsuarios(scopePosterior),
      scope: scopePosterior,
      rolEvento: 'entrada',
      payload: {
        direccion: 'entrada',
        scopePropio: scopePosterior,
        eventoContraparteId: salidaId,
        impactoResumen: null
      }
    };
    const resultado = await this.servicioAuditoria.registrarMovimientoEnTransaccion({
      cambioEfectivo: true,
      salida,
      entrada
    }, { conexion });
    return resultado;
  }

  async invalidarSesionesSqlPorCambioAdministrativo({
    conexion,
    contextoUsuarioActual,
    idUsuario,
    causa,
    habilitada,
    causalidadId = null
  }) {
    if (
      !habilitada ||
      !this.repositorioSesionesWebAuditoria
        ?.invalidarVigentesPorUsuariosEnTransaccion
    ) {
      return [];
    }
    const sesiones =
      await this.repositorioSesionesWebAuditoria
        .invalidarVigentesPorUsuariosEnTransaccion([idUsuario], { conexion });
    for (const sesion of sesiones) {
      await this.registrarEventoUsuarioAdministrativo({
        conexion,
        contextoUsuarioActual,
        tipo: 'usuario.sesion_invalidada',
        sujetoId: sesion.sesionAuditoriaId,
        sujetoTipo: 'sesion_usuario',
        scope: this.normalizarScopeAuditoria(
          sesion.scopeEfectivoActual || {
            tenantId: sesion.efectivoTenantId,
            empresaId: sesion.efectivoEmpresaId,
            sitioId: sesion.efectivoSitioId
          }
        ),
        rolEvento: 'resultado',
        causalidadId,
        payload: {
          sesionAuditoriaId: sesion.sesionAuditoriaId,
          resultado: 'invalidada',
          causa
        }
      });
    }
    return sesiones;
  }

  async registrarEventoUsuarioAdministrativo({
    conexion,
    contextoUsuarioActual,
    tipo,
    sujetoId,
    sujetoTipo = 'usuario',
    scope,
    payload,
    rolEvento = 'principal',
    causalidadId = null
  }) {
    return this.servicioAuditoria.registrarEnTransaccion({
      cambioEfectivo: true,
      intencion: {
        eventoId: generarUuidV7Auditoria(),
        tipo,
        versionContrato: 1,
        flujo: 'usuarios',
        claveCadena: this.claveCadenaUsuarios(scope),
        actorReal: this.actorRealAuditoria(contextoUsuarioActual),
        actorEfectivo: this.actorEfectivoAuditoria(contextoUsuarioActual),
        modoActuacion: contextoUsuarioActual?.impersonacionActiva
          ? 'impersonado'
          : 'directo',
        sujeto: { tipo: sujetoTipo, id: String(sujetoId) },
        origen: 'web',
        scope: this.normalizarScopeAuditoria(scope),
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
      }
    }, { conexion });
  }

  camposPerfilAdministrativoCambiados({ antes, despues, cambioEmail }) {
    const campos = [];
    if (cambioEmail) campos.push('email');
    if ((antes.nombreMostrar || null) !== (despues.nombreMostrar || null)) {
      campos.push('nombreMostrar');
    }
    if ((antes.nombreCompleto || null) !== (despues.nombreCompleto || null)) {
      campos.push('nombreCompleto');
    }
    return campos.sort((a, b) => Buffer.compare(Buffer.from(a), Buffer.from(b)));
  }

  fotografiaUsuarioSegura(usuario) {
    return {
      activo: Boolean(usuario.activo),
      nivelScope: this.resolutorScopeUsuario?.resolverNivelScope
        ? this.resolutorScopeUsuario.resolverNivelScope(this.scopeUsuario(usuario))
        : this.resolverNivelScopeAuditoria(this.scopeUsuario(usuario)),
      tenantId: this.scopeUsuario(usuario).tenantId,
      empresaId: this.scopeUsuario(usuario).empresaId,
      sitioId: this.scopeUsuario(usuario).sitioId,
      ...this.fotografiaPermisos(usuario.permisos?.serializar())
    };
  }

  fotografiaPermisos(permisos = {}) {
    return Object.fromEntries(
      Object.entries(permisos || {})
        .map(([clave, valor]) => [this.nombreCampoPermisoAuditoria(clave), Boolean(valor)])
        .sort(([a], [b]) => Buffer.compare(Buffer.from(a), Buffer.from(b)))
    );
  }

  nombreCampoPermisoAuditoria(clave) {
    const texto = String(clave || '').trim();
    if (texto.startsWith('permiso')) return texto;
    return `permiso${texto.charAt(0).toUpperCase()}${texto.slice(1)}`;
  }

  seleccionarCampos(objeto, campos) {
    return Object.fromEntries(campos.map((campo) => [campo, objeto[campo] ?? false]));
  }

  resolverNivelScopeAuditoria(scope) {
    if (scope.sitioId) return 'sitio';
    if (scope.empresaId) return 'empresa';
    if (scope.tenantId) return 'tenant';
    return 'portal';
  }

  actorRealAuditoria(contextoUsuarioActual) {
    return {
      tipo: 'usuario',
      id: String(
        contextoUsuarioActual?.idUsuarioReal ??
        contextoUsuarioActual?.idUsuario
      )
    };
  }

  actorControlFederacion(contextoUsuarioActual) {
    return {
      real: this.actorRealAuditoria(contextoUsuarioActual),
      efectivo: this.actorEfectivoAuditoria(contextoUsuarioActual),
      modo: contextoUsuarioActual?.impersonacionActiva ? 'impersonado' : 'directo'
    };
  }

  actorEfectivoAuditoria(contextoUsuarioActual) {
    if (!contextoUsuarioActual?.impersonacionActiva) {
      return null;
    }
    return {
      tipo: 'usuario',
      id: String(contextoUsuarioActual?.idUsuario)
    };
  }

  scopeUsuario(usuario) {
    return this.normalizarScopeAuditoria({
      tenantId: usuario?.tenantId,
      empresaId: usuario?.empresaId,
      sitioId: usuario?.sitioId
    });
  }

  normalizarScopeAuditoria(scope = {}) {
    return {
      tenantId: scope?.tenantId == null ? null : String(scope.tenantId),
      empresaId: scope?.empresaId == null ? null : String(scope.empresaId),
      sitioId: scope?.sitioId == null ? null : String(scope.sitioId)
    };
  }

  claveCadenaUsuarios(scope = {}) {
    const normalizado = this.normalizarScopeAuditoria(scope);
    return normalizado.tenantId
      ? `usuarios:tenant:${normalizado.tenantId}`
      : 'usuarios:portal';
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
    const scopeInicial =
      this.validadorJerarquiaUsuario.resolverScopeInicialDesdeEditor(
        contextoUsuarioActual
      );

    return {
      id: null,
      usuario: '',
      email: '',
      nombreMostrar: '',
      nombreCompleto: '',
      nivelScope:
        this.resolutorScopeUsuario.resolverNivelScope(scopeInicial),
      tenantId: scopeInicial.tenantId ?? '',
      empresaId: scopeInicial.empresaId ?? '',
      sitioId: scopeInicial.sitioId ?? '',
      permisos: this.asignadorPermisosUsuario.construirPermisosIniciales()
    };
  }

  construirFormularioDesdeUsuario(usuario) {
    const permisos = this.normalizarPermisosComoModelo(
      usuario.permisos.serializar()
    );

    return {
      id: usuario.id,
      usuario: usuario.usuario,
      email: usuario.email,
      nombreMostrar: usuario.nombreMostrar || '',
      nombreCompleto: usuario.nombreCompleto || '',
      nivelScope: this.resolutorScopeUsuario.resolverNivelScope({
        tenantId: usuario.tenantId,
        empresaId: usuario.empresaId,
        sitioId: usuario.sitioId
      }),
      tenantId: usuario.tenantId ?? '',
      empresaId: usuario.empresaId ?? '',
      sitioId: usuario.sitioId ?? '',
      permisos
    };
  }

  construirOpcionesNivelScope(contextoUsuarioActual) {
    const nivel = contextoUsuarioActual?.nivelScope;

    if (nivel === 'portal') {
      return [
        { valor: 'portal', etiqueta: 'Portal' },
        { valor: 'tenant', etiqueta: 'Tenant' },
        { valor: 'empresa', etiqueta: 'Empresa' },
        { valor: 'sitio', etiqueta: 'Sitio' }
      ];
    }

    if (nivel === 'tenant') {
      return [
        { valor: 'tenant', etiqueta: 'Tenant' },
        { valor: 'empresa', etiqueta: 'Empresa' },
        { valor: 'sitio', etiqueta: 'Sitio' }
      ];
    }

    if (nivel === 'empresa') {
      return [
        { valor: 'empresa', etiqueta: 'Empresa' },
        { valor: 'sitio', etiqueta: 'Sitio' }
      ];
    }

    return [
      { valor: 'sitio', etiqueta: 'Sitio' }
    ];
  }

  construirPermisosFormulario(
    contextoUsuarioActual,
    permisosActuales,
    nivelScopeObjetivo = 'portal'
  ) {
    const permisosNormalizados = this.normalizarPermisosComoModelo(
      permisosActuales
    );
    this.asignadorPermisosUsuario.aplicarRestriccionesPermisosPorScope(
      permisosNormalizados,
      nivelScopeObjetivo
    );

    return this.asignadorPermisosUsuario
      .obtenerDefinicionesPermisos()
      .map((definicion) => ({
        ...definicion,
        activo: Boolean(permisosNormalizados?.[definicion.claveModelo]),
        editable: this.puedeOtorgarClavePermiso(
          contextoUsuarioActual,
          definicion.claveFormulario
        )
      }));
  }

  construirDetallePermisosUsuario(permisosActuales) {
    const iconosPorPermiso = {
      ver: 'layout-text-window-reverse',
      verMonitores: 'broadcast-pin',
      verTriggers: 'lightning-charge',
      verDns: 'globe2',
      verAuditoria: 'journal-check',
      editar: 'pencil-square',
      editarTriggers: 'gear-wide-connected',
      editarDns: 'globe-americas',
      gestionarVinculosTriggers: 'link-45deg',
      administrarUsuarios: 'people',
      administrarConfiguracion: 'sliders',
      publicarDns: 'send-check',
      administrarDnsAvanzado: 'shield-lock',
      verAgentes: 'hdd-network',
      modificarAgentes: 'terminal-plus',
      eliminarAgentes: 'trash3',
      administrarOrganizacion: 'diagram-3',
      administrarTenants: 'building',
      administrarEmpresas: 'buildings',
      administrarSitios: 'geo-alt',
      impersonacion: 'person-badge',
      configurarEmisionesFederacion: 'box-arrow-up-right',
      configurarRecepcionesFederacion: 'box-arrow-in-down-left',
      activarRelacionesFederacion: 'diagram-2',
      gestionarCredencialesFederacion: 'key',
      transferirResponsabilidadFederacion: 'person-gear',
      resolverConflictosFederacion: 'signpost-split',
      verDiagnosticoFederacion: 'activity',
      verAvisosPlataforma: 'exclamation-diamond',
      verAlertasRemotas: 'bell'
    };

    return this.asignadorPermisosUsuario
      .obtenerDefinicionesPermisosModelo()
      .map((definicion) => ({
        claveModelo: definicion.claveModelo,
        etiqueta: definicion.etiqueta,
        descripcion: definicion.descripcion,
        icono: iconosPorPermiso[definicion.claveModelo] || 'shield-check',
        activo: Boolean(permisosActuales?.[definicion.claveModelo]),
        oculto:
          !this.asignadorPermisosUsuario
            .obtenerDefinicionesPermisos()
            .some((permiso) => permiso.claveModelo === definicion.claveModelo)
      }));
  }

  construirPermisosObjetivoDesdeFormulario({
    contextoUsuarioActual,
    datos,
    permisosBase = null,
    nivelScopeObjetivo = null
  }) {
    const permisos = permisosBase
      ? this.normalizarPermisosComoModelo(permisosBase)
      : this.asignadorPermisosUsuario.construirPermisosIniciales();

    for (const definicion of this.asignadorPermisosUsuario.obtenerDefinicionesPermisos()) {
      if (
        !this.puedeOtorgarClavePermiso(
          contextoUsuarioActual,
          definicion.claveFormulario
        )
      ) {
        continue;
      }

      permisos[definicion.claveModelo] = this.normalizarBooleano(
        datos[definicion.claveFormulario]
      )
        ? 1
        : 0;
    }

    this.asignadorPermisosUsuario.aplicarDependenciasPermisos(permisos);
    this.asignadorPermisosUsuario.aplicarRestriccionesPermisosPorScope(
      permisos,
      nivelScopeObjetivo ?? datos?.nivelScope ?? datos?.nivel_scope
    );
    this.asignadorPermisosUsuario.aplicarDependenciasPermisos(permisos);

    return permisos;
  }

  async resolverScopeObjetivoValido(contextoUsuarioActual, datos) {
    const scopeObjetivo =
      this.validadorJerarquiaUsuario.resolverScopeObjetivoDesdeFormulario(datos);
    const { tenantId, empresaId, sitioId, nivelScope } = scopeObjetivo;

    const tenant = tenantId == null
      ? null
      : await this.repositorioTenants.buscarPorId(tenantId);
    const empresa = empresaId == null
      ? null
      : await this.repositorioEmpresas.buscarPorId(empresaId);
    const sitio = sitioId == null
      ? null
      : await this.repositorioSitios.buscarPorId(sitioId);

    if (tenantId != null && !tenant) {
      throw new Error('El tenant seleccionado no existe.');
    }

    if (empresaId != null && !empresa) {
      throw new Error('La empresa seleccionada no existe.');
    }

    if (sitioId != null && !sitio) {
      throw new Error('El sitio seleccionado no existe.');
    }

    if (empresa && Number(empresa.tenantId) !== Number(tenantId)) {
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

    this.assertDelegacionScopeValida(
      contextoUsuarioActual,
      nivelScope,
      { tenant, empresa, sitio }
    );

    return scopeObjetivo;
  }

  assertDelegacionScopeValida(
    contextoUsuarioActual,
    nivelScopeObjetivo,
    { tenant, empresa, sitio }
  ) {
    const profundidadEditor = PROFUNDIDAD_SCOPE[contextoUsuarioActual.nivelScope];
    const profundidadObjetivo = PROFUNDIDAD_SCOPE[nivelScopeObjetivo];

    if (profundidadObjetivo < profundidadEditor) {
      throw new Error(
        'Solo puedes crear o mover usuarios en tu mismo scope o en uno inferior.'
      );
    }

    if (nivelScopeObjetivo === 'portal') {
      if (contextoUsuarioActual.nivelScope !== 'portal') {
        throw new Error(
          'Solo un operador de portal puede trabajar con otro usuario de portal.'
        );
      }

      return;
    }

    if (
      nivelScopeObjetivo === 'tenant' &&
      !this.resolutorScopeUsuario.puedeAlcanzarTenant(
        contextoUsuarioActual,
        tenant.id
      )
    ) {
      throw new Error(
        'No puedes trabajar con un usuario en un tenant fuera de tu alcance.'
      );
    }

    if (
      nivelScopeObjetivo === 'empresa' &&
      !this.resolutorScopeUsuario.puedeAlcanzarEmpresa(
        contextoUsuarioActual,
        empresa.id,
        tenant.id
      )
    ) {
      throw new Error(
        'No puedes trabajar con un usuario en una empresa fuera de tu alcance.'
      );
    }

    if (
      nivelScopeObjetivo === 'sitio' &&
      !this.resolutorScopeUsuario.puedeAlcanzarSitio(
        contextoUsuarioActual,
        sitio.id,
        empresa.id,
        tenant.id
      )
    ) {
      throw new Error(
        'No puedes trabajar con un usuario en un sitio fuera de tu alcance.'
      );
    }
  }

  hayCambioPermisos(permisosActuales, permisosObjetivo) {
    for (const definicion of this.asignadorPermisosUsuario.obtenerDefinicionesPermisosModelo()) {
      const actual = Boolean(permisosActuales?.[definicion.claveModelo]);
      const objetivo = Boolean(permisosObjetivo?.[definicion.claveModelo]);

      if (actual !== objetivo) {
        return true;
      }
    }

    return false;
  }

  async assertCoberturaAdministrativaCritica({
    usuarioActual,
    scopeObjetivo = null,
    permisosObjetivo = null
  }) {
    if (!usuarioActual?.activo) {
      return;
    }

    const contextoActual = this.construirContextoDesdeUsuario(usuarioActual);
    const contextoFuturo = scopeObjetivo && permisosObjetivo
      ? this.construirContextoDesdeDatos({
          idUsuario: usuarioActual.id,
          usuario: usuarioActual.usuario,
          nombreVisible: usuarioActual.obtenerNombreVisible(),
          tenantId: scopeObjetivo.tenantId,
          empresaId: scopeObjetivo.empresaId,
          sitioId: scopeObjetivo.sitioId,
          permisos: permisosObjetivo
        })
      : null;
    const permisosPerdidos = this.obtenerPermisosCriticosPerdidos({
      contextoActual,
      contextoFuturo
    });

    if (permisosPerdidos.length === 0) {
      return;
    }

    const candidatos = await this.repositorioUsuarios.listarActivosParaCobertura({
      excluirIdUsuario: usuarioActual.id
    });
    const contextosCandidatos = candidatos
      .map((usuario) => {
        try {
          return this.construirContextoDesdeUsuario(usuario);
        } catch (_error) {
          return null;
        }
      })
      .filter(Boolean);

    for (const clavePermiso of permisosPerdidos) {
      const existeCobertura = contextosCandidatos.some((contextoCandidato) => (
        this.servicioAutorizacion.resolverPermiso(
          clavePermiso,
          contextoCandidato
        ) &&
        this.puedeContextoCubrirScope(contextoCandidato, contextoActual)
      ));

      if (!existeCobertura) {
        throw new Error(
          `No puedes retirar el último control de ${this.obtenerEtiquetaPermisoCritico(clavePermiso)} en el alcance ${this.resolutorScopeUsuario.describirScope({
            tenantId: contextoActual.tenantId,
            empresaId: contextoActual.empresaId,
            sitioId: contextoActual.sitioId
          })}`
        );
      }
    }
  }

  obtenerPermisosCriticosPerdidos({ contextoActual, contextoFuturo }) {
    return this.obtenerClavesPermisoCritico().filter((clavePermiso) => {
      const controlActual = this.servicioAutorizacion.resolverPermiso(
        clavePermiso,
        contextoActual
      );
      const controlFuturo = contextoFuturo
        ? (
            this.servicioAutorizacion.resolverPermiso(
              clavePermiso,
              contextoFuturo
            ) &&
            this.puedeContextoCubrirScope(contextoFuturo, contextoActual)
          )
        : false;

      return controlActual && !controlFuturo;
    });
  }

  obtenerClavesPermisoCritico() {
    return [
      'administrar_usuarios',
      'administrar_configuracion',
      'publicar_dns',
      'administrar_dns_avanzado',
      'administrar_organizacion',
      'administrar_tenants',
      'administrar_empresas',
      'administrar_sitios'
    ];
  }

  obtenerEtiquetaPermisoCritico(clavePermiso) {
    const etiquetas = {
      administrar_usuarios: 'administrar usuarios',
      administrar_configuracion: 'administrar configuración',
      publicar_dns: 'publicar DNS',
      administrar_dns_avanzado: 'administrar DNS avanzado',
      administrar_organizacion: 'administrar organización',
      administrar_tenants: 'administrar tenants',
      administrar_empresas: 'administrar empresas',
      administrar_sitios: 'administrar sitios'
    };

    return etiquetas[clavePermiso] || clavePermiso;
  }

  construirContextoDesdeUsuario(usuario) {
    this.assertUsuarioConJerarquiaValida(usuario);

    return this.construirContextoDesdeDatos({
      idUsuario: usuario.id,
      usuario: usuario.usuario,
      nombreVisible: usuario.obtenerNombreVisible(),
      tenantId: usuario.tenantId,
      empresaId: usuario.empresaId,
      sitioId: usuario.sitioId,
      permisos: usuario.permisos.serializar(),
      preferenciaMostrarAlertasRemotas:
        usuario.preferenciaMostrarAlertasRemotas
    });
  }

  construirContextoDesdeDatos({
    idUsuario,
    usuario,
    nombreVisible,
    tenantId,
    empresaId,
    sitioId,
    permisos,
    preferenciaMostrarAlertasRemotas = false
  }) {
    const nivelScope = this.resolutorScopeUsuario.resolverNivelScope({
      tenantId,
      empresaId,
      sitioId
    });

    if (nivelScope === 'invalido') {
      throw new Error('La combinación actual de tenant, empresa y sitio no es válida.');
    }

    return new ContextoUsuarioActual({
      idUsuario,
      usuario,
      nombreVisible,
      tenantId,
      empresaId,
      sitioId,
      nivelScope,
      esOperadorSistema: nivelScope === 'portal',
      preferenciaMostrarAlertasRemotas,
      permisos: {
        serializar() {
          return permisos;
        },
        ...permisos
      }
    });
  }

  puedeContextoCubrirScope(contextoCandidato, contextoObjetivo) {
    if (contextoObjetivo.nivelScope === 'portal') {
      return contextoCandidato.nivelScope === 'portal';
    }

    if (contextoObjetivo.nivelScope === 'tenant') {
      return this.resolutorScopeUsuario.puedeAlcanzarTenant(
        contextoCandidato,
        contextoObjetivo.tenantId
      );
    }

    if (contextoObjetivo.nivelScope === 'empresa') {
      return this.resolutorScopeUsuario.puedeAlcanzarEmpresa(
        contextoCandidato,
        contextoObjetivo.empresaId,
        contextoObjetivo.tenantId
      );
    }

    return this.resolutorScopeUsuario.puedeAlcanzarSitio(
      contextoCandidato,
      contextoObjetivo.sitioId,
      contextoObjetivo.empresaId,
      contextoObjetivo.tenantId
    );
  }

  assertUsuarioConJerarquiaValida(usuario) {
    if (!this.resolutorScopeUsuario.esJerarquiaValida({
      tenantId: usuario.tenantId,
      empresaId: usuario.empresaId,
      sitioId: usuario.sitioId
    })) {
      throw new Error(
        `El usuario ${usuario.usuario} tiene una combinación inválida de tenant, empresa y sitio.`
      );
    }
  }

  async resolverActorRealImpersonacion(
    contextoUsuarioActual,
    sesionAutenticada,
    { requerirPermiso = true } = {}
  ) {
    const sesionNormalizada =
      this.servicioSesion.normalizarSesionAutenticada(sesionAutenticada);
    const idUsuarioReal = sesionNormalizada?.idUsuarioReal ??
      contextoUsuarioActual?.idUsuarioReal ??
      contextoUsuarioActual?.idUsuario;
    const usuarioReal = await this.repositorioUsuarios.buscarPorId(idUsuarioReal);

    if (!usuarioReal || !usuarioReal.activo) {
      throw this.crearErrorHttp(
        403,
        'La identidad real ya no está disponible para impersonación.'
      );
    }

    this.assertUsuarioConJerarquiaValida(usuarioReal);

    const contextoActorReal = this.construirContextoDesdeUsuario(usuarioReal);

    if (
      requerirPermiso &&
      !this.servicioAutorizacion.puedeImpersonacion(contextoActorReal)
    ) {
      throw this.crearErrorHttp(
        403,
        'No dispones del permiso interno de impersonación.'
      );
    }

    return {
      sesionNormalizada,
      usuarioReal,
      contextoActorReal
    };
  }

  puedeOtorgarClavePermiso(contextoUsuarioActual, claveFormulario) {
    const clavePermiso = claveFormulario.replace('permiso_', '');
    if (
      contextoUsuarioActual?.impersonacionActiva &&
      PERMISOS_FEDERACION_Y_AVISOS.has(clavePermiso)
    ) {
      return false;
    }
    return this.servicioAutorizacion.resolverPermiso(
      clavePermiso,
      contextoUsuarioActual
    );
  }

  normalizarPermisosComoModelo(permisos) {
    const resultado = this.asignadorPermisosUsuario.construirPermisosIniciales();

    for (const definicion of this.asignadorPermisosUsuario.obtenerDefinicionesPermisosModelo()) {
      resultado[definicion.claveModelo] = Boolean(
        permisos?.[definicion.claveModelo]
      )
        ? 1
        : 0;
    }

    return this.asignadorPermisosUsuario.aplicarDependenciasPermisos(resultado);
  }

  normalizarBooleano(valor) {
    return ['1', 'true', 'si', 'yes', 'on'].includes(
      String(valor || '').toLowerCase()
    );
  }

  normalizarIdOpcional(valor) {
    if (valor === undefined || valor === null || String(valor).trim() === '') {
      return null;
    }

    const convertido = Number.parseInt(String(valor), 10);
    return Number.isInteger(convertido) && convertido > 0
      ? convertido
      : null;
  }

  crearErrorHttp(codigoHttp, mensaje) {
    const error = new Error(mensaje);
    error.codigoHttp = codigoHttp;
    return error;
  }
}

const PERMISOS_FEDERACION_Y_AVISOS = new Set([
  'configurar_emisiones_federacion',
  'configurar_recepciones_federacion',
  'activar_relaciones_federacion',
  'gestionar_credenciales_federacion',
  'transferir_responsabilidad_federacion',
  'resolver_conflictos_federacion',
  'ver_diagnostico_federacion',
  'ver_avisos_plataforma',
  'ver_alertas_remotas'
]);

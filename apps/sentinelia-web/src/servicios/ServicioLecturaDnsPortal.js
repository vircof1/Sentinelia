export class ServicioLecturaDnsPortal {
  constructor({
    repositorioZonasDns,
    repositorioRegistrosDns
  }) {
    this.repositorioZonasDns = repositorioZonasDns;
    this.repositorioRegistrosDns = repositorioRegistrosDns;
  }

  async construirVistaListado(contextoUsuarioActual, filtros = {}) {
    const filtrosNormalizados = this.normalizarFiltrosListado(filtros);
    const zonas = await this.repositorioZonasDns.listarVisibles(
      contextoUsuarioActual,
      filtrosNormalizados
    );
    const zonasSerializadas = zonas.map((zona) => zona.serializarResumen());
    const totalFiltrado = zonasSerializadas.length;
    const pagina = filtrosNormalizados.pagina;
    const tamanoPagina = filtrosNormalizados.tamanoPagina;
    const totalPaginas = Math.max(
      1,
      Math.ceil(totalFiltrado / tamanoPagina) || 1
    );
    const paginaAjustada = Math.min(Math.max(pagina, 1), totalPaginas);
    const inicio = (paginaAjustada - 1) * tamanoPagina;
    const fin = inicio + tamanoPagina;
    const zonasPaginadas = zonasSerializadas.slice(inicio, fin);

    return {
      alcanceActual: this.construirAlcanceActual(contextoUsuarioActual),
      filtros: filtrosNormalizados,
      opcionesTipoZona: [
        { valor: '', etiqueta: 'Todas' },
        { valor: 'master', etiqueta: 'Master' }
      ],
      opcionesCategoriaOrigen: [
        { valor: '', etiqueta: 'Todas' },
        { valor: 'normal', etiqueta: 'Normal' },
        { valor: 'sistema', etiqueta: 'Sistema' },
        { valor: 'ddns', etiqueta: 'DDNS' },
        { valor: 'trigger', etiqueta: 'Trigger' }
      ],
      opcionesEstadoPublicacion: [
        { valor: '', etiqueta: 'Todos' },
        { valor: 'pendiente', etiqueta: 'Pendiente de aplicar' },
        { valor: 'publicado', etiqueta: 'Publicada' },
        { valor: 'error', etiqueta: 'Error al aplicar' },
        { valor: 'excluida', etiqueta: 'Sin publicación BIND' }
      ],
      opcionesActivo: [
        { valor: 'todos', etiqueta: 'Todas' },
        { valor: 'solo_activas', etiqueta: 'Solo activas' },
        { valor: 'solo_inactivas', etiqueta: 'Solo inactivas' }
      ],
      resumen: {
        totalZonas: zonasSerializadas.length,
        totalActivas: zonasSerializadas.filter((zona) => zona.activo).length,
        totalEspeciales: zonasSerializadas.filter(
          (zona) => zona.categoriaOrigen !== 'normal'
        ).length,
        totalNoPublicables: zonasSerializadas.filter(
          (zona) => !zona.publicarEnBind
        ).length,
        totalPublicadas: zonasSerializadas.filter(
          (zona) => zona.estadoPublicacion === 'publicado'
        ).length,
        totalPendientes: zonasSerializadas.filter(
          (zona) => zona.estadoPublicacion === 'pendiente'
        ).length,
        totalErrores: zonasSerializadas.filter(
          (zona) => zona.estadoPublicacion === 'error'
        ).length
      },
      paginacion: {
        pagina: paginaAjustada,
        tamanoPagina,
        totalPaginas,
        totalFiltrado,
        desde: totalFiltrado === 0 ? 0 : inicio + 1,
        hasta: totalFiltrado === 0 ? 0 : Math.min(fin, totalFiltrado)
      },
      zonas: zonasPaginadas
    };
  }

  async construirVistaDetalle(contextoUsuarioActual, idZona, filtros = {}) {
    const zona = await this.repositorioZonasDns.buscarVisiblePorId(
      contextoUsuarioActual,
      idZona
    );

    if (!zona) {
      throw new Error(
        'La zona DNS indicada no existe o no está dentro de tu alcance.'
      );
    }

    const filtrosNormalizados = this.normalizarFiltrosRegistros(filtros);
    const registros = await this.repositorioRegistrosDns.listarPorZonaIdFiltrado(
      zona.id,
      filtrosNormalizados
    );
    const registrosSerializados = registros.map((registro) => ({
      ...registro.serializarResumen(),
      ttlEfectivoSegundos: registro.resolverTtlEfectivo(
        zona.ttlDefectoSegundos
      )
    }));
    const totalFiltrado = registrosSerializados.length;
    const pagina = filtrosNormalizados.pagina;
    const tamanoPagina = filtrosNormalizados.tamanoPagina;
    const totalPaginas = Math.max(
      1,
      Math.ceil(totalFiltrado / tamanoPagina) || 1
    );
    const paginaAjustada = Math.min(Math.max(pagina, 1), totalPaginas);
    const inicio = (paginaAjustada - 1) * tamanoPagina;
    const fin = inicio + tamanoPagina;
    const registrosPaginados = registrosSerializados.slice(inicio, fin);

    return {
      alcanceActual: this.construirAlcanceActual(contextoUsuarioActual),
      zona: zona.serializarResumen(),
      filtrosRegistros: {
        ...filtrosNormalizados,
        pagina: paginaAjustada
      },
      opcionesTipoRegistro: [
        { valor: '', etiqueta: 'Todos' },
        { valor: 'A', etiqueta: 'A' },
        { valor: 'AAAA', etiqueta: 'AAAA' },
        { valor: 'CNAME', etiqueta: 'CNAME' },
        { valor: 'NS', etiqueta: 'NS' },
        { valor: 'TXT', etiqueta: 'TXT' },
        { valor: 'MX', etiqueta: 'MX' },
        { valor: 'SRV', etiqueta: 'SRV' },
        { valor: 'CAA', etiqueta: 'CAA' },
        { valor: 'PTR', etiqueta: 'PTR' }
      ],
      opcionesActivoRegistros: [
        { valor: 'todos', etiqueta: 'Todos' },
        { valor: 'solo_activos', etiqueta: 'Solo activos' },
        { valor: 'solo_inactivos', etiqueta: 'Solo inactivos' }
      ],
      resumenRegistros: {
        totalRegistros: registrosSerializados.length,
        totalActivos: registrosSerializados.filter((registro) => registro.activo)
          .length,
        totalPublicables: registrosSerializados.filter(
          (registro) => registro.publicarEnBind
        ).length,
        totalEspeciales: registrosSerializados.filter(
          (registro) => registro.categoriaOrigen !== 'normal'
        ).length,
        totalGobernados: registrosSerializados.filter(
          (registro) => registro.estaGobernadoAutomaticamente
        ).length
      },
      paginacionRegistros: {
        pagina: paginaAjustada,
        tamanoPagina,
        totalPaginas,
        totalFiltrado,
        desde: totalFiltrado === 0 ? 0 : inicio + 1,
        hasta: totalFiltrado === 0 ? 0 : Math.min(fin, totalFiltrado)
      },
      registros: registrosPaginados
    };
  }

  normalizarFiltrosListado(filtros = {}) {
    const pagina = Number.parseInt(String(filtros.pagina || filtros.page || '1'), 10);
    const tamanoPagina = Number.parseInt(
      String(filtros.tamanoPagina || filtros.page_size || '10'),
      10
    );

    return {
      sitioId: /^\d+$/.test(String(filtros.sitioId ?? filtros.sitio_id ?? ''))
        ? Number(filtros.sitioId ?? filtros.sitio_id)
        : null,
      textoBusqueda: String(filtros.textoBusqueda || filtros.q || '').trim(),
      tipoZona: String(filtros.tipoZona || filtros.tipo || '').trim().toLowerCase(),
      categoriaOrigen: String(
        filtros.categoriaOrigen || filtros.categoria_origen || ''
      )
        .trim()
        .toLowerCase(),
      estadoPublicacion: String(
        filtros.estadoPublicacion || filtros.estado_publicacion || ''
      )
        .trim()
        .toLowerCase(),
      activo: String(filtros.activo || 'todos').trim().toLowerCase(),
      pagina: Number.isFinite(pagina) && pagina > 0 ? pagina : 1,
      tamanoPagina:
        Number.isFinite(tamanoPagina) && tamanoPagina > 0
          ? Math.min(tamanoPagina, 100)
          : 10
    };
  }

  normalizarFiltrosRegistros(filtros = {}) {
    const pagina = Number.parseInt(
      String(filtros.pagina || filtros.page || '1'),
      10
    );
    const tamanoPagina = Number.parseInt(
      String(filtros.tamanoPagina || filtros.page_size || '10'),
      10
    );

    return {
      textoBusqueda: String(filtros.textoBusqueda || filtros.q || '').trim(),
      tipoRegistro: String(
        filtros.tipoRegistro || filtros.tipo_registro || ''
      )
        .trim()
        .toUpperCase(),
      activo: String(filtros.activo || 'todos').trim().toLowerCase(),
      pagina: Number.isFinite(pagina) && pagina > 0 ? pagina : 1,
      tamanoPagina:
        Number.isFinite(tamanoPagina) && tamanoPagina > 0
          ? Math.min(tamanoPagina, 100)
          : 10
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

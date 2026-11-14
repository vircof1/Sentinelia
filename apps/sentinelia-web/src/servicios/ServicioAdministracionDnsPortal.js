import { isDeepStrictEqual } from 'node:util';
import { ValidadorZonaDns } from '../../../../paquetes/dns/src/ValidadorZonaDns.js';
import { ValidadorRegistroDns } from '../../../../paquetes/dns/src/ValidadorRegistroDns.js';
import { generarUuidV7Auditoria } from '../../../../paquetes/auditoria/src/UuidV7Auditoria.js';
import { PERFIL_JCS_AUDITORIA_V1 } from '../../../../paquetes/auditoria/src/PerfilJcsAuditoria.js';
import { VERSION_ENCADENADO_AUDITORIA_V1 } from '../../../../paquetes/auditoria/src/SobreCanonicoAuditoria.js';

function normalizarBooleano(valor, porDefecto = false) {
  const valorNormalizado = Array.isArray(valor)
    ? valor[valor.length - 1]
    : valor;

  if (
    valorNormalizado === undefined ||
    valorNormalizado === null ||
    valorNormalizado === ''
  ) {
    return porDefecto;
  }

  if (typeof valorNormalizado === 'boolean') {
    return valorNormalizado;
  }

  return ['1', 'true', 'si', 'yes', 'on'].includes(
    String(valorNormalizado).trim().toLowerCase()
  );
}

export class ServicioAdministracionDnsPortal {
  constructor({
    repositorioZonasDns,
    repositorioRegistrosDns = null,
    repositorioTenants,
    repositorioEmpresas,
    repositorioSitios,
    resolutorScopeUsuario,
    servicioLecturaDnsPortal,
    servicioDns = null,
    servicioTriggers = null,
    fronteraTransaccional = null,
    servicioAuditoria = null,
    repositorioCoordinacionGeneracionesDns = null,
    servicioAplicacionDdnsAgentes = null,
    servicioLecturaAdministrativaDdnsAgentes = null,
    ahora = () => new Date(),
    validadorZonaDns = new ValidadorZonaDns(),
    validadorRegistroDns = new ValidadorRegistroDns()
  }) {
    this.repositorioZonasDns = repositorioZonasDns;
    this.repositorioRegistrosDns = repositorioRegistrosDns;
    this.repositorioTenants = repositorioTenants;
    this.repositorioEmpresas = repositorioEmpresas;
    this.repositorioSitios = repositorioSitios;
    this.resolutorScopeUsuario = resolutorScopeUsuario;
    this.servicioLecturaDnsPortal = servicioLecturaDnsPortal;
    this.servicioDns = servicioDns;
    this.servicioTriggers = servicioTriggers;
    this.fronteraTransaccional = fronteraTransaccional;
    this.servicioAuditoria = servicioAuditoria;
    this.repositorioCoordinacionGeneracionesDns =
      repositorioCoordinacionGeneracionesDns;
    this.servicioAplicacionDdnsAgentes = servicioAplicacionDdnsAgentes;
    this.servicioLecturaAdministrativaDdnsAgentes =
      servicioLecturaAdministrativaDdnsAgentes;
    this.ahora = ahora;
    this.validadorZonaDns = validadorZonaDns;
    this.validadorRegistroDns = validadorRegistroDns;
  }

  async construirVistaListado(contextoUsuarioActual, filtros = {}) {
    const vista = await this.servicioLecturaDnsPortal.construirVistaListado(
      contextoUsuarioActual,
      filtros
    );
    const puedeEditarDns = Boolean(contextoUsuarioActual?.permisos?.editarDns);
    const puedeAdministrarDnsAvanzado =
      this.puedeAdministrarDnsAvanzado(contextoUsuarioActual);

    return {
      ...vista,
      puedeEditarDns,
      puedeAdministrarDnsAvanzado,
      zonas: (vista.zonas || []).map((zona) => ({
        ...zona,
        editable: puedeEditarDns &&
          this.esEditableConModoActual(zona, contextoUsuarioActual)
      }))
    };
  }

  async construirVistaDetalle(contextoUsuarioActual, idZona, filtros = {}) {
    const vista = await this.servicioLecturaDnsPortal.construirVistaDetalle(
      contextoUsuarioActual,
      idZona,
      filtros
    );
    const zonaVisible = await this.repositorioZonasDns.buscarVisiblePorId(
      contextoUsuarioActual,
      idZona
    );

    const puedeEditarDns = Boolean(contextoUsuarioActual?.permisos?.editarDns);
    const puedeAdministrarDnsAvanzado =
      this.puedeAdministrarDnsAvanzado(contextoUsuarioActual);
    const puedeGestionarPublicacionDns =
      this.puedeGestionarPublicacionDns(contextoUsuarioActual);
    const puedeEditarZona = Boolean(zonaVisible) && puedeEditarDns &&
      this.esEditableConModoActual(zonaVisible, contextoUsuarioActual);
    const puedeEditarCatalogoRegistros = Boolean(zonaVisible) && puedeEditarDns &&
      this.esZonaOperableParaCatalogoRegistros(
        zonaVisible,
        contextoUsuarioActual
      );

    return {
      ...vista,
      zonaEditable: zonaVisible?.serializarResumen?.() || null,
      puedeEditarDns,
      puedeEditarZona,
      puedeAdministrarDnsAvanzado,
      puedeGestionarPublicacionDns,
      puedeGestionarRegistrosDns: puedeEditarCatalogoRegistros,
      retornoDetalle: this.construirRutaDetalleZona(
        idZona,
        filtros,
        '/dns'
      ),
      registros: (vista.registros || []).map((registro) => ({
        ...registro,
        editable: puedeEditarDns && this.esEditableConModoActual(
          {
            categoriaOrigen: registro.categoriaOrigen,
            publicarEnBind: registro.publicarEnBind
          },
          contextoUsuarioActual
        ) && puedeEditarCatalogoRegistros,
        eliminable: puedeEditarZona && puedeGestionarPublicacionDns
      }))
    };
  }

  async construirVistaFormulario(
    contextoUsuarioActual,
    {
      idZona = null,
      formularioBase = null,
      errorFormulario = null,
      retornoListado = '/dns'
    } = {}
  ) {
    const modo = idZona == null ? 'crear' : 'editar';
    const [tenants, empresas, sitios] = await this.cargarEntidadesScopeVisibles(
      contextoUsuarioActual
    );
    let zona = null;

    if (modo === 'editar') {
      zona = await this.repositorioZonasDns.buscarVisiblePorId(
        contextoUsuarioActual,
        idZona
      );

      if (!zona) {
        throw new Error(
          'La zona DNS indicada no existe o no está dentro de tu alcance.'
        );
      }

      this.verificarEdicionZonaAvanzadaPermitida(contextoUsuarioActual, zona);
    }

    const formulario = formularioBase
      ? this.construirFormularioDesdeEntrada(formularioBase, zona)
      : this.construirFormularioDesdeZona(zona, contextoUsuarioActual);
    const restriccionesScope = this.resolverRestriccionesScope(
      contextoUsuarioActual
    );
    const puedeAdministrarDnsAvanzado =
      this.puedeAdministrarDnsAvanzado(contextoUsuarioActual);
    const puedeGestionarPublicacionDns =
      this.puedeGestionarPublicacionDns(contextoUsuarioActual);

    if (!puedeAdministrarDnsAvanzado) {
      formulario.categoriaOrigen = 'normal';
    }

    if (!puedeGestionarPublicacionDns) {
      formulario.publicarEnBind = zona?.publicarEnBind ?? false;
    }

    return {
      modo,
      errorFormulario,
      retornoListado: this.normalizarRetorno(retornoListado),
      alcanceActual: this.construirAlcanceActual(contextoUsuarioActual),
      zonaObjetivo: zona?.serializarResumen?.() || null,
      formulario,
      restriccionesScope,
      opcionesPertenencia: this.listarOpcionesPertenenciaDisponibles(
        contextoUsuarioActual
      ),
      opcionesTenants: tenants.map((tenant) => ({
        valor: tenant.id,
        etiqueta: `${tenant.nombre} (#${tenant.id})`
      })),
      opcionesEmpresas: empresas.map((empresa) => ({
        valor: empresa.id,
        tenantId: empresa.tenantId,
        etiqueta: `${empresa.nombre} (#${empresa.id})`
      })),
      opcionesSitios: sitios.map((sitio) => ({
        valor: sitio.id,
        tenantId: sitio.tenantId,
        empresaId: sitio.empresaId,
        etiqueta: `${sitio.nombre} (#${sitio.id})`
      })),
      opcionesTipoZona: [
        { valor: 'master', etiqueta: 'Master' }
      ],
      opcionesCategoriaOrigen: puedeAdministrarDnsAvanzado
        ? [
            { valor: 'normal', etiqueta: 'Normal' },
            { valor: 'sistema', etiqueta: 'Sistema' }
          ]
        : [
            { valor: 'normal', etiqueta: 'Normal' }
          ],
      puedeAdministrarDnsAvanzado,
      puedeGestionarPublicacionDns
    };
  }

  async crearZona(contextoUsuarioActual, datos) {
    const definicion = await this.normalizarDefinicionFormulario(
      contextoUsuarioActual,
      datos
    );

    await this.validarNombreZonaUnico(definicion.nombreZona);

    let debeInvalidarCatalogo = false;
    try {
      const zona = await this.ejecutarMutacionDns(async (conexion) => {
        await this.crearGeneracionDnsSiAfectaPublicacion({
          conexion,
          afectaPublicacion: definicionPublicableBind(definicion)
        });
        const zona = await this.repositorioZonasDns.crear(definicion, {
          conexion
        });
        await this.crearRegistrosMinimosZona(zona, { conexion });
        await this.registrarEventoDns({
          conexion,
          contextoUsuarioActual,
          tipo: 'dns.zona_creada',
          sujeto: { tipo: 'zona_dns', id: String(zona.id) },
          scope: scopeDesdeEntidadDns(zona),
          payload: {
            resultado: 'creado',
            antes: null,
            despues: fotografiaZonaDnsAuditable(zona)
          }
        });
        debeInvalidarCatalogo = true;
        return zona;
      });
      if (debeInvalidarCatalogo) {
        await this.invalidarCatalogoDns();
      }
      return zona;
    } catch (error) {
      throw this.normalizarErrorPersistencia(error);
    }
  }

  async actualizarZona(contextoUsuarioActual, idZona, datos) {
    const zonaActual = await this.repositorioZonasDns.buscarVisiblePorId(
      contextoUsuarioActual,
      idZona
    );

    if (!zonaActual) {
      throw new Error(
        'La zona DNS indicada no existe o no está dentro de tu alcance.'
      );
    }

    this.verificarEdicionZonaAvanzadaPermitida(contextoUsuarioActual, zonaActual);

    const definicion = await this.normalizarDefinicionFormulario(
      contextoUsuarioActual,
      datos,
      zonaActual
    );

    await this.validarNombreZonaUnico(definicion.nombreZona, zonaActual.id);
    const fotografiaAntes = fotografiaZonaDnsAuditable(zonaActual);
    const fotografiaDespuesPrevista = fotografiaZonaDefinicionAuditable(definicion);
    const camposCambiados = calcularCamposCambiados(
      fotografiaAntes,
      fotografiaDespuesPrevista
    );

    if (camposCambiados.length === 0) {
      return zonaActual;
    }

    let debeInvalidarCatalogo = false;
    try {
      const zona = await this.ejecutarMutacionDns(async (conexion) => {
        await this.crearGeneracionDnsSiAfectaPublicacion({
          conexion,
          afectaPublicacion: zonaAfectaPublicacion(
            fotografiaAntes,
            fotografiaDespuesPrevista
          )
        });
        const zona = await this.repositorioZonasDns.actualizar({
          idZona: zonaActual.id,
          ...definicion
        }, { conexion });

        if (!zona) {
          throw new Error('No se pudo actualizar la zona DNS indicada.');
        }

        if (scopeCambio(fotografiaAntes, fotografiaZonaDnsAuditable(zona))) {
          await this.repositorioRegistrosDns.sincronizarScopeDesdeZona(
            {
              zonaId: zona.id,
              tenantId: zona.tenantId,
              empresaId: zona.empresaId,
              sitioId: zona.sitioId
            },
            { conexion }
          );
          if (typeof this.servicioAplicacionDdnsAgentes
            ?.actualizarScopeRegistrosZonaEnTransaccion === 'function') {
            await this.servicioAplicacionDdnsAgentes
              .actualizarScopeRegistrosZonaEnTransaccion({
                contextoUsuarioActual,
                zonaId: zona.id,
                scopePosterior: scopeDesdeEntidadDns(zona)
              }, { conexion });
          }
        }
        await this.registrarEventoDns({
          conexion,
          contextoUsuarioActual,
          tipo: 'dns.zona_actualizada',
          sujeto: { tipo: 'zona_dns', id: String(zona.id) },
          scope: scopeDesdeEntidadDns(zona),
          payload: {
            resultado: 'actualizado',
            camposCambiados,
            antes: filtrarFotografiaPorCampos(fotografiaAntes, camposCambiados),
            despues: filtrarFotografiaPorCampos(
              fotografiaZonaDnsAuditable(zona),
              camposCambiados
            )
          }
        });
        if (scopeCambio(fotografiaAntes, fotografiaZonaDnsAuditable(zona))) {
          await this.registrarMovimientoScopeDns({
            conexion,
            contextoUsuarioActual,
            sujeto: { tipo: 'zona_dns', id: String(zona.id) },
            scopeAnterior: scopeDesdeFotografia(fotografiaAntes),
            scopeActual: scopeDesdeEntidadDns(zona)
          });
        }
        debeInvalidarCatalogo = true;
        return zona;
      });
      if (debeInvalidarCatalogo) {
        await this.invalidarCatalogoDns();
      }
      return zona;
    } catch (error) {
      throw this.normalizarErrorPersistencia(error);
    }
  }

  async eliminarZona(contextoUsuarioActual, idZona) {
    const zona = await this.repositorioZonasDns.buscarVisiblePorId(
      contextoUsuarioActual,
      idZona
    );

    if (!zona) {
      throw new Error(
        'La zona DNS indicada no existe o no está dentro de tu alcance.'
      );
    }

    this.verificarEdicionZonaAvanzadaPermitida(contextoUsuarioActual, zona);

    if (typeof this.servicioTriggers?.revocarObjetivosDnsZonaEnTransaccion !== 'function') {
      throw new Error('No se puede eliminar la zona sin revocar sus acciones DNS.');
    }
    let debeInvalidarCatalogo = false;
    await this.ejecutarMutacionDns(async (conexion) => {
      if (typeof this.servicioAplicacionDdnsAgentes
        ?.cerrarObjetivosZonaEnTransaccion === 'function') {
        await this.servicioAplicacionDdnsAgentes.cerrarObjetivosZonaEnTransaccion({
          contextoUsuarioActual,
          zonaId: zona.id
        }, { conexion });
      }
      await this.servicioTriggers.revocarObjetivosDnsZonaEnTransaccion({
        contextoUsuarioActual,
        zonaId: zona.id
      }, { conexion });
      await this.crearGeneracionDnsSiAfectaPublicacion({
        conexion,
        afectaPublicacion: zonaAfectaPublicacion(zona, null)
      });
      const dependenciasEliminadas =
        await this.repositorioRegistrosDns.contarPorZonaId?.(zona.id, {
          conexion
        }) || 0;
      const eliminada = await this.repositorioZonasDns.eliminar(zona.id, {
        conexion
      });
      if (!eliminada) {
        // También revierte DDNS, acciones y planes; no basta con lanzar el
        // error después de que ejecutarMutacionDns haya confirmado la unidad.
        throw new Error('No se pudo eliminar la zona DNS indicada.');
      }
      await this.registrarEventoDns({
        conexion,
        contextoUsuarioActual,
        tipo: 'dns.zona_eliminada',
        sujeto: { tipo: 'zona_dns', id: String(zona.id) },
        scope: scopeDesdeEntidadDns(zona),
        payload: {
          resultado: 'eliminado',
          antes: fotografiaZonaDnsAuditable(zona),
          despues: null,
          impactoResumen: impactoEliminacionDns(dependenciasEliminadas)
        }
      });
      debeInvalidarCatalogo = true;
    });

    if (debeInvalidarCatalogo) {
      await this.invalidarCatalogoDns();
    }
    return zona;
  }

  async obtenerImpactoEliminacionZona(contextoUsuarioActual, idZona) {
    const zona = await this.repositorioZonasDns.buscarVisiblePorId(
      contextoUsuarioActual,
      idZona
    );
    if (!zona) {
      throw Object.assign(new Error('La zona DNS no existe o no está dentro de tu alcance.'), {
        statusCode: 404
      });
    }
    try {
      this.verificarEdicionZonaAvanzadaPermitida(contextoUsuarioActual, zona);
    } catch (error) {
      error.statusCode = 403;
      throw error;
    }

    const [conteos] = await this.repositorioZonasDns.clienteSql.consultar(`
      SELECT
        (SELECT COUNT(*) FROM registros_dns r WHERE r.zona_id = ?) AS registros,
        (SELECT COUNT(*) FROM concesiones_ddns_agentes c
          INNER JOIN registros_dns r ON r.id = c.registro_dns_id
          WHERE r.zona_id = ? AND c.estado = 'vigente') AS concesionesDdns,
        (SELECT COUNT(*) FROM triggers t
          WHERE t.tipo = 'dns' AND t.activo = 1 AND (
            JSON_UNQUOTE(JSON_EXTRACT(t.configuracion, '$.zonaId')) = ?
            OR EXISTS (SELECT 1 FROM registros_dns r WHERE r.zona_id = ?
              AND JSON_UNQUOTE(JSON_EXTRACT(t.configuracion, '$.registroId')) = CAST(r.id AS CHAR))
          )) AS accionesDns,
        (SELECT COUNT(*) FROM ejecuciones_triggers et
          WHERE et.tipo_trigger = 'dns' AND et.estado_ejecucion = 'pendiente' AND (
            JSON_UNQUOTE(JSON_EXTRACT(et.payload_solicitud, '$.configuracionEfectiva.zonaId')) = ?
            OR EXISTS (SELECT 1 FROM registros_dns r WHERE r.zona_id = ?
              AND JSON_UNQUOTE(JSON_EXTRACT(et.payload_solicitud, '$.configuracionEfectiva.registroId')) = CAST(r.id AS CHAR))
          )) AS ejecucionesPendientes,
        (SELECT COUNT(*) FROM ejecuciones_triggers et
          WHERE et.tipo_trigger = 'dns' AND et.estado_ejecucion = 'ejecutando' AND (
            JSON_UNQUOTE(JSON_EXTRACT(et.payload_solicitud, '$.configuracionEfectiva.zonaId')) = ?
            OR EXISTS (SELECT 1 FROM registros_dns r WHERE r.zona_id = ?
              AND JSON_UNQUOTE(JSON_EXTRACT(et.payload_solicitud, '$.configuracionEfectiva.registroId')) = CAST(r.id AS CHAR))
          )) AS ejecucionesEnCurso
    `, [zona.id, zona.id, String(zona.id), zona.id, String(zona.id), zona.id,
      String(zona.id), zona.id]);

    return {
      id: String(zona.id),
      nombre: zona.nombreZona,
      publicadaEnBind: Boolean(zona.activo && zona.publicarEnBind),
      registros: Number(conteos.registros),
      concesionesDdns: Number(conteos.concesionesDdns),
      accionesDns: Number(conteos.accionesDns),
      ejecucionesPendientes: Number(conteos.ejecucionesPendientes),
      ejecucionesEnCurso: Number(conteos.ejecucionesEnCurso)
    };
  }

  async obtenerImpactoEliminacionRegistro(contextoUsuarioActual, idZona, idRegistro) {
    const zona = await this.repositorioZonasDns.buscarVisiblePorId(
      contextoUsuarioActual, idZona
    );
    if (!zona) {
      throw Object.assign(new Error('La zona DNS no existe o no está dentro de tu alcance.'), {
        statusCode: 404
      });
    }
    try {
      this.verificarEdicionZonaAvanzadaPermitida(contextoUsuarioActual, zona);
      this.verificarGestionRegistrosPermitida(contextoUsuarioActual);
    } catch (error) {
      error.statusCode = 403;
      throw error;
    }
    const registro = await this.repositorioRegistrosDns.buscarPorId(idRegistro);
    if (!registro || Number(registro.zonaId) !== Number(zona.id)) {
      throw Object.assign(new Error('El registro DNS no existe o no pertenece a la zona visible.'), {
        statusCode: 404
      });
    }
    try {
      this.verificarEdicionRegistroAvanzadaPermitida(contextoUsuarioActual, registro);
    } catch (error) {
      error.statusCode = 403;
      throw error;
    }

    // Mismos destinos que la revocación: la configuración actual para las
    // acciones y la fotografía aceptada para las ejecuciones, sin afectar
    // otros registros de la zona ni depender de la configuración de hoy.
    const [conteos] = await this.repositorioZonasDns.clienteSql.consultar(`
      SELECT
        (SELECT COUNT(*) FROM concesiones_ddns_agentes c
          WHERE c.registro_dns_id = ? AND c.estado = 'vigente') AS concesionesDdns,
        (SELECT COUNT(*) FROM triggers t
          WHERE t.tipo = 'dns' AND t.activo = 1
            AND JSON_UNQUOTE(JSON_EXTRACT(t.configuracion, '$.registroId')) = ?) AS accionesDns,
        (SELECT COUNT(*) FROM ejecuciones_triggers et
          WHERE et.tipo_trigger = 'dns' AND et.estado_ejecucion = 'pendiente'
            AND JSON_UNQUOTE(JSON_EXTRACT(et.payload_solicitud, '$.configuracionEfectiva.registroId')) = ?) AS ejecucionesPendientes,
        (SELECT COUNT(*) FROM ejecuciones_triggers et
          WHERE et.tipo_trigger = 'dns' AND et.estado_ejecucion = 'ejecutando'
            AND JSON_UNQUOTE(JSON_EXTRACT(et.payload_solicitud, '$.configuracionEfectiva.registroId')) = ?) AS ejecucionesEnCurso
    `, [registro.id, String(registro.id), String(registro.id), String(registro.id)]);

    return {
      id: String(registro.id),
      zonaId: String(zona.id),
      nombre: registro.nombreVisible,
      tipo: registro.tipoRegistro,
      esSistema: registro.categoriaOrigen === 'sistema',
      afectaPublicacion: registroAfectaPublicacion(zona, registro, null),
      concesionesDdns: Number(conteos.concesionesDdns),
      accionesDns: Number(conteos.accionesDns),
      ejecucionesPendientes: Number(conteos.ejecucionesPendientes),
      ejecucionesEnCurso: Number(conteos.ejecucionesEnCurso)
    };
  }

  async construirVistaFormularioRegistro(
    contextoUsuarioActual,
    idZona,
    {
      idRegistro = null,
      formularioBase = null,
      errorFormulario = null,
      retornoDetalle = null
    } = {}
  ) {
    const zona = await this.repositorioZonasDns.buscarVisiblePorId(
      contextoUsuarioActual,
      idZona
    );

    if (!zona) {
      throw new Error(
        'La zona DNS indicada no existe o no está dentro de tu alcance.'
      );
    }

    this.verificarOperacionRegistrosEnZonaPermitida(
      contextoUsuarioActual,
      zona
    );

    let registro = null;

    if (idRegistro != null) {
      registro = await this.repositorioRegistrosDns.buscarPorId(idRegistro);

      if (!registro || Number(registro.zonaId) !== Number(zona.id)) {
        throw new Error(
          'El registro DNS indicado no existe o no pertenece a la zona visible.'
        );
      }

      this.verificarEdicionRegistroAvanzadaPermitida(
        contextoUsuarioActual,
        registro
      );
    }

    const concesionesDdns = registro &&
        this.servicioLecturaAdministrativaDdnsAgentes
      ? await this.servicioLecturaAdministrativaDdnsAgentes.listarPorRegistro({
          contextoUsuarioActual,
          registroDnsId: registro.id
        })
      : [];

    const formulario = formularioBase
      ? this.construirFormularioRegistroDesdeEntrada(formularioBase, registro)
      : this.construirFormularioRegistroDesdeRegistro(registro);
    const retornoNormalizado = this.normalizarRetorno(
      retornoDetalle || `/dns/${zona.id}`
    );

    const puedeAdministrarDnsAvanzado =
      this.puedeAdministrarDnsAvanzado(contextoUsuarioActual);
    const puedeGestionarPublicacionDns =
      this.puedeGestionarPublicacionDns(contextoUsuarioActual);

    if (!puedeAdministrarDnsAvanzado) {
      formulario.categoriaOrigen = 'normal';
    }

    if (!puedeGestionarPublicacionDns) {
      formulario.publicarEnBind = registro?.publicarEnBind ?? false;
    }

    return {
      modo: registro ? 'editar' : 'crear',
      errorFormulario,
      alcanceActual: this.construirAlcanceActual(contextoUsuarioActual),
      retornoDetalle: retornoNormalizado,
      zona: zona.serializarResumen(),
      registroObjetivo: registro?.serializarResumen?.() || null,
      gobernanzaRegistro: this.resolverGobernanzaRegistro(registro),
      concesionesDdns,
      bloquearEdicionHumanaValorPrincipal:
        this.debeBloquearEdicionHumanaValorPrincipal(registro),
      formulario,
      opcionesTipoRegistro: this.listarOpcionesTipoRegistro(),
      opcionesCategoriaOrigen: puedeAdministrarDnsAvanzado
        ? this.listarOpcionesCategoriaRegistro()
        : [{ valor: 'normal', etiqueta: 'Normal' }],
      puedeAdministrarDnsAvanzado,
      puedeGestionarPublicacionDns
    };
  }

  async crearRegistro(contextoUsuarioActual, idZona, datos) {
    const zona = await this.repositorioZonasDns.buscarVisiblePorId(
      contextoUsuarioActual,
      idZona
    );

    if (!zona) {
      throw new Error(
        'La zona DNS indicada no existe o no está dentro de tu alcance.'
      );
    }

    this.verificarOperacionRegistrosEnZonaPermitida(
      contextoUsuarioActual,
      zona
    );

    const definicion = this.normalizarDefinicionRegistroFormulario(
      contextoUsuarioActual,
      zona,
      datos
    );

    try {
      let debeInvalidarCatalogo = false;
      const registro = await this.ejecutarMutacionDns(async (conexion) => {
        await this.crearGeneracionDnsSiAfectaPublicacion({
          conexion,
          afectaPublicacion: registroAfectaPublicacion(
            zona,
            null,
            definicion
          )
        });
        const registro = await this.repositorioRegistrosDns.crear(definicion, {
          conexion
        });
        await this.repositorioZonasDns.marcarPendientePublicacion(zona.id, {
          conexion
        });
        await this.registrarEventoDns({
          conexion,
          contextoUsuarioActual,
          tipo: 'dns.registro_creado',
          sujeto: { tipo: 'registro_dns', id: String(registro.id) },
          scope: scopeDesdeEntidadDns(registro),
          payload: {
            resultado: 'creado',
            antes: null,
            despues: fotografiaRegistroDnsAuditable(registro)
          }
        });
        debeInvalidarCatalogo = true;
        return registro;
      });
      if (debeInvalidarCatalogo) {
        await this.invalidarCatalogoDns();
      }
      return registro;
    } catch (error) {
      throw this.normalizarErrorPersistenciaRegistro(error);
    }
  }

  async actualizarRegistro(contextoUsuarioActual, idZona, idRegistro, datos) {
    const zona = await this.repositorioZonasDns.buscarVisiblePorId(
      contextoUsuarioActual,
      idZona
    );

    if (!zona) {
      throw new Error(
        'La zona DNS indicada no existe o no está dentro de tu alcance.'
      );
    }

    this.verificarEdicionZonaAvanzadaPermitida(contextoUsuarioActual, zona);

    const registroActual = await this.repositorioRegistrosDns.buscarPorId(idRegistro);

    if (!registroActual || Number(registroActual.zonaId) !== Number(zona.id)) {
      throw new Error(
        'El registro DNS indicado no existe o no pertenece a la zona visible.'
      );
    }

    this.verificarEdicionRegistroAvanzadaPermitida(
      contextoUsuarioActual,
      registroActual
    );

    const definicion = this.normalizarDefinicionRegistroFormulario(
      contextoUsuarioActual,
      zona,
      datos,
      registroActual
    );
    const fotografiaAntes = fotografiaRegistroDnsAuditable(registroActual);
    const fotografiaDespuesPrevista =
      fotografiaRegistroDefinicionAuditable(definicion, registroActual);
    const camposCambiados = calcularCamposCambiados(
      fotografiaAntes,
      fotografiaDespuesPrevista
    );

    if (camposCambiados.length === 0) {
      return registroActual;
    }

    try {
      let debeInvalidarCatalogo = false;
      const registro = await this.ejecutarMutacionDns(async (conexion) => {
        const incompatibilizaDdns =
          registroActual.categoriaOrigen === 'ddns' &&
          (definicion.categoriaOrigen !== 'ddns' ||
            definicion.tipoRegistro !== registroActual.tipoRegistro);
        if (incompatibilizaDdns &&
            typeof this.servicioAplicacionDdnsAgentes
              ?.cerrarObjetivoRegistroEnTransaccion === 'function') {
          await this.servicioAplicacionDdnsAgentes
            .cerrarObjetivoRegistroEnTransaccion({
              contextoUsuarioActual,
              registroDnsId: registroActual.id,
              terminal: 'objetivo_incompatible'
            }, { conexion });
        }
        let resultadoDdns = await this.aplicarEdicionHumanaDdnsSiProcede({
          conexion,
          contextoUsuarioActual,
          registroActual,
          definicion,
          camposCambiados
        });
        if (entidadPublicableBind(registroActual) !==
            definicionPublicableBind(definicion) &&
            typeof this.servicioAplicacionDdnsAgentes
              ?.sincronizarOperabilidadRegistroEnTransaccion === 'function') {
          const operabilidad = await this.servicioAplicacionDdnsAgentes
            .sincronizarOperabilidadRegistroEnTransaccion({
              registroDnsId: registroActual.id,
              operable: definicionPublicableBind(definicion),
              generacionDns: resultadoDdns?.generacionDns ?? null
            }, { conexion });
          if (operabilidad?.gobernado) {
            resultadoDdns = {
              ...(resultadoDdns || {}),
              ...operabilidad,
              zonaMarcadaPendiente:
                Boolean(resultadoDdns?.zonaMarcadaPendiente)
            };
          }
        }
        if (!resultadoDdns?.generacionDns) {
          await this.crearGeneracionDnsSiAfectaPublicacion({
            conexion,
            afectaPublicacion: registroAfectaPublicacion(
              zona,
              registroActual,
              fotografiaDespuesPrevista
            )
          });
        }
        const registro = await this.repositorioRegistrosDns.actualizar({
          idRegistro: registroActual.id,
          ...definicion
        }, { conexion });

        if (!registro) {
          throw new Error('No se pudo actualizar el registro DNS indicado.');
        }

        if (!resultadoDdns?.zonaMarcadaPendiente) {
          await this.repositorioZonasDns.marcarPendientePublicacion(zona.id, {
            conexion
          });
        }
        await this.registrarEventoDns({
          conexion,
          contextoUsuarioActual,
          tipo: 'dns.registro_actualizado',
          sujeto: { tipo: 'registro_dns', id: String(registro.id) },
          scope: scopeDesdeEntidadDns(registro),
          payload: {
            resultado: 'actualizado',
            camposCambiados,
            antes: filtrarFotografiaPorCampos(fotografiaAntes, camposCambiados),
            despues: filtrarFotografiaPorCampos(
              fotografiaRegistroDnsAuditable(registro),
              camposCambiados
            )
          }
        });
        debeInvalidarCatalogo = true;
        return registro;
      });
      if (debeInvalidarCatalogo) {
        await this.invalidarCatalogoDns();
      }
      return registro;
    } catch (error) {
      throw this.normalizarErrorPersistenciaRegistro(error);
    }
  }

  async eliminarRegistro(contextoUsuarioActual, idZona, idRegistro) {
    const zona = await this.repositorioZonasDns.buscarVisiblePorId(
      contextoUsuarioActual,
      idZona
    );

    if (!zona) {
      throw new Error(
        'La zona DNS indicada no existe o no está dentro de tu alcance.'
      );
    }

    this.verificarEdicionZonaAvanzadaPermitida(contextoUsuarioActual, zona);
    this.verificarGestionRegistrosPermitida(contextoUsuarioActual);

    const registro = await this.repositorioRegistrosDns.buscarPorId(idRegistro);

    if (!registro || Number(registro.zonaId) !== Number(zona.id)) {
      throw new Error(
        'El registro DNS indicado no existe o no pertenece a la zona visible.'
      );
    }

    this.verificarEdicionRegistroAvanzadaPermitida(
      contextoUsuarioActual,
      registro
    );

    if (typeof this.servicioTriggers?.revocarObjetivosDnsRegistroEnTransaccion !== 'function') {
      throw new Error('No se puede eliminar el registro sin revocar sus acciones DNS.');
    }
    let debeInvalidarCatalogo = false;
    await this.ejecutarMutacionDns(async (conexion) => {
      if (typeof this.servicioAplicacionDdnsAgentes
        ?.cerrarObjetivoRegistroEnTransaccion === 'function') {
        await this.servicioAplicacionDdnsAgentes
          .cerrarObjetivoRegistroEnTransaccion({
            contextoUsuarioActual,
            registroDnsId: registro.id,
            terminal: 'objetivo_eliminado',
            desacoplar: true
          }, { conexion });
      }
      await this.servicioTriggers.revocarObjetivosDnsRegistroEnTransaccion({
        contextoUsuarioActual,
        registroId: registro.id
      }, { conexion });
      await this.crearGeneracionDnsSiAfectaPublicacion({
        conexion,
        afectaPublicacion: registroAfectaPublicacion(zona, registro, null)
      });
      const eliminado = await this.repositorioRegistrosDns.eliminar(registro.id, {
        conexion
      });
      if (!eliminado) {
        // Revierte también las concesiones, acciones y planes ya tratados.
        throw new Error('No se pudo eliminar el registro DNS indicado.');
      }
      await this.repositorioZonasDns.marcarPendientePublicacion(zona.id, {
        conexion
      });
      await this.registrarEventoDns({
        conexion,
        contextoUsuarioActual,
        tipo: 'dns.registro_eliminado',
        sujeto: { tipo: 'registro_dns', id: String(registro.id) },
        scope: scopeDesdeEntidadDns(registro),
        payload: {
          resultado: 'eliminado',
          antes: fotografiaRegistroDnsAuditable(registro),
          despues: null,
          impactoResumen: null
        }
      });
      debeInvalidarCatalogo = true;
    });

    if (debeInvalidarCatalogo) {
      await this.invalidarCatalogoDns();
    }
    return registro;
  }

  async normalizarDefinicionFormulario(
    contextoUsuarioActual,
    datos,
    zonaActual = null
  ) {
    const puedeAdministrarDnsAvanzado =
      this.puedeAdministrarDnsAvanzado(contextoUsuarioActual);
    const puedeGestionarPublicacionDns =
      this.puedeGestionarPublicacionDns(contextoUsuarioActual);
    const scope = await this.normalizarScopeSolicitado(contextoUsuarioActual, datos);
    const tipoZona = 'master';
    const categoriaOrigen = puedeAdministrarDnsAvanzado
      ? datos?.categoriaOrigen ?? datos?.categoria_origen ?? 'normal'
      : (zonaActual?.categoriaOrigen || 'normal');
    if (!['normal', 'sistema'].includes(String(categoriaOrigen).trim().toLowerCase())) {
      throw new Error('La categoría de la zona DNS debe ser Normal o Sistema.');
    }
    const publicarEnBind = puedeGestionarPublicacionDns
      ? normalizarBooleano(
          datos?.publicarEnBind ?? datos?.publicar_en_bind,
          true
        )
      : (zonaActual?.publicarEnBind ?? false);

    return this.validadorZonaDns.normalizarDefinicionBase({
      tenantId: scope.tenantId,
      empresaId: scope.empresaId,
      sitioId: scope.sitioId,
      nombreZona: datos?.nombreZona ?? datos?.nombre_zona,
      tipoZona,
      categoriaOrigen,
      publicarEnBind,
      descripcion: datos?.descripcion,
      ttlDefectoSegundos: datos?.ttlDefectoSegundos ?? datos?.ttl_defecto_segundos,
      soaMname: datos?.soaMname ?? datos?.soa_mname,
      soaRname: datos?.soaRname ?? datos?.soa_rname,
      soaSerial: zonaActual?.soaSerial ?? 1,
      soaRefreshSegundos: datos?.soaRefreshSegundos ?? datos?.soa_refresh_segundos,
      soaRetrySegundos: datos?.soaRetrySegundos ?? datos?.soa_retry_segundos,
      soaExpireSegundos: datos?.soaExpireSegundos ?? datos?.soa_expire_segundos,
      soaMinimumSegundos: datos?.soaMinimumSegundos ?? datos?.soa_minimum_segundos,
      versionModelo: zonaActual?.versionModelo ?? 1,
      estadoPublicacion: 'pendiente',
      activo: normalizarBooleano(datos?.activo, true)
    });
  }

  async crearRegistrosMinimosZona(zona, { conexion = null } = {}) {
    const registrosMinimos = this.construirRegistrosMinimosZona(zona);

    for (const definicionRegistro of registrosMinimos) {
      await this.repositorioRegistrosDns.crear(definicionRegistro, { conexion });
    }
  }

  construirRegistrosMinimosZona(zona) {
    const hostRelativoNameserver = this.resolverHostRelativoEnZona(
      zona.soaMname,
      zona.nombreZona
    );

    return [
      this.validadorRegistroDns.normalizarDefinicionBase({
        zonaId: zona.id,
        hostRelativo: '@',
        tipoRegistro: 'NS',
        valorPrincipal: zona.soaMname,
        categoriaOrigen: 'sistema',
        publicarEnBind: true,
        activo: true
      }),
      this.validadorRegistroDns.normalizarDefinicionBase({
        zonaId: zona.id,
        hostRelativo: hostRelativoNameserver,
        tipoRegistro: 'A',
        valorPrincipal: '127.0.0.1',
        categoriaOrigen: 'sistema',
        publicarEnBind: true,
        activo: true
      })
    ];
  }

  resolverHostRelativoEnZona(nombreAbsoluto, nombreZona) {
    const nombreNormalizado = String(nombreAbsoluto || '')
      .trim()
      .toLowerCase()
      .replace(/\.+$/, '');
    const zonaNormalizada = String(nombreZona || '')
      .trim()
      .toLowerCase()
      .replace(/\.+$/, '');

    if (!nombreNormalizado || !zonaNormalizada) {
      throw new Error(
        'No se pudieron generar los registros mínimos de la zona DNS.'
      );
    }

    if (nombreNormalizado === zonaNormalizada) {
      return '@';
    }

    const sufijoZona = `.${zonaNormalizada}`;

    if (!nombreNormalizado.endsWith(sufijoZona)) {
      throw new Error(
        'El SOA mname debe pertenecer a la propia zona para poder crear el NS y su registro A mínimo.'
      );
    }

    return nombreNormalizado.slice(0, -sufijoZona.length);
  }

  async normalizarScopeSolicitado(contextoUsuarioActual, datos) {
    const [tenants, empresas, sitios] = await this.cargarEntidadesScopeVisibles(
      contextoUsuarioActual
    );
    const tenantsPorId = new Map(tenants.map((tenant) => [Number(tenant.id), tenant]));
    const empresasPorId = new Map(
      empresas.map((empresa) => [Number(empresa.id), empresa])
    );
    const sitiosPorId = new Map(sitios.map((sitio) => [Number(sitio.id), sitio]));
    const nivelSolicitado = this.resolverNivelPertenenciaSolicitada(
      datos?.nivelPertenencia ?? datos?.nivel_pertenencia,
      datos?.tenantId ?? datos?.tenant_id,
      datos?.empresaId ?? datos?.empresa_id,
      datos?.sitioId ?? datos?.sitio_id
    );

    if (contextoUsuarioActual?.nivelScope === 'portal') {
      return this.resolverScopePortal(
        nivelSolicitado,
        datos,
        tenantsPorId,
        empresasPorId,
        sitiosPorId
      );
    }

    if (contextoUsuarioActual?.nivelScope === 'tenant') {
      return this.resolverScopeTenant(
        contextoUsuarioActual,
        nivelSolicitado,
        datos,
        empresasPorId,
        sitiosPorId
      );
    }

    if (contextoUsuarioActual?.nivelScope === 'empresa') {
      return this.resolverScopeEmpresa(
        contextoUsuarioActual,
        nivelSolicitado,
        datos,
        sitiosPorId
      );
    }

    if (contextoUsuarioActual?.nivelScope === 'sitio') {
      return {
        tenantId: contextoUsuarioActual.tenantId,
        empresaId: contextoUsuarioActual.empresaId,
        sitioId: contextoUsuarioActual.sitioId
      };
    }

    throw new Error('Tu contexto actual no permite administrar zonas DNS.');
  }

  resolverScopePortal(
    nivelSolicitado,
    datos,
    tenantsPorId,
    empresasPorId,
    sitiosPorId
  ) {
    const tenantId = this.normalizarIdFormulario(datos?.tenantId ?? datos?.tenant_id);
    const empresaId = this.normalizarIdFormulario(
      datos?.empresaId ?? datos?.empresa_id
    );
    const sitioId = this.normalizarIdFormulario(datos?.sitioId ?? datos?.sitio_id);

    if (nivelSolicitado === 'portal') {
      return { tenantId: null, empresaId: null, sitioId: null };
    }

    if (nivelSolicitado === 'tenant') {
      if (tenantId == null || !tenantsPorId.has(tenantId)) {
        throw new Error('Debes seleccionar un tenant visible para la zona DNS.');
      }

      return { tenantId, empresaId: null, sitioId: null };
    }

    if (nivelSolicitado === 'empresa') {
      const empresa = empresasPorId.get(empresaId);

      if (tenantId == null || !tenantsPorId.has(tenantId) || !empresa) {
        throw new Error('Debes seleccionar tenant y empresa válidos para la zona DNS.');
      }

      if (Number(empresa.tenantId) !== tenantId) {
        throw new Error('La empresa DNS seleccionada no pertenece al tenant indicado.');
      }

      return { tenantId, empresaId, sitioId: null };
    }

    if (nivelSolicitado === 'sitio') {
      const empresa = empresasPorId.get(empresaId);
      const sitio = sitiosPorId.get(sitioId);

      if (
        tenantId == null ||
        !tenantsPorId.has(tenantId) ||
        !empresa ||
        !sitio
      ) {
        throw new Error('Debes seleccionar tenant, empresa y sitio válidos para la zona DNS.');
      }

      if (Number(empresa.tenantId) !== tenantId) {
        throw new Error('La empresa DNS seleccionada no pertenece al tenant indicado.');
      }

      if (
        Number(sitio.tenantId) !== tenantId ||
        Number(sitio.empresaId) !== empresaId
      ) {
        throw new Error('El sitio DNS seleccionado no pertenece a la empresa indicada.');
      }

      return { tenantId, empresaId, sitioId };
    }

    throw new Error('El alcance solicitado para la zona DNS no es válido.');
  }

  resolverScopeTenant(
    contextoUsuarioActual,
    nivelSolicitado,
    datos,
    empresasPorId,
    sitiosPorId
  ) {
    const tenantId = Number(contextoUsuarioActual.tenantId);
    const empresaId = this.normalizarIdFormulario(
      datos?.empresaId ?? datos?.empresa_id
    );
    const sitioId = this.normalizarIdFormulario(datos?.sitioId ?? datos?.sitio_id);

    if (nivelSolicitado === 'tenant') {
      return { tenantId, empresaId: null, sitioId: null };
    }

    if (nivelSolicitado === 'empresa') {
      const empresa = empresasPorId.get(empresaId);

      if (!empresa || Number(empresa.tenantId) !== tenantId) {
        throw new Error('Debes seleccionar una empresa visible de tu tenant.');
      }

      return { tenantId, empresaId, sitioId: null };
    }

    if (nivelSolicitado === 'sitio') {
      const empresa = empresasPorId.get(empresaId);
      const sitio = sitiosPorId.get(sitioId);

      if (!empresa || !sitio || Number(empresa.tenantId) !== tenantId) {
        throw new Error('Debes seleccionar una empresa visible de tu tenant.');
      }

      if (
        Number(sitio.tenantId) !== tenantId ||
        Number(sitio.empresaId) !== empresaId
      ) {
        throw new Error('Debes seleccionar un sitio visible dentro de la empresa elegida.');
      }

      return { tenantId, empresaId, sitioId };
    }

    throw new Error(
      'Solo puedes crear o mover zonas DNS en tu mismo alcance o en uno inferior.'
    );
  }

  resolverScopeEmpresa(
    contextoUsuarioActual,
    nivelSolicitado,
    datos,
    sitiosPorId
  ) {
    const tenantId = Number(contextoUsuarioActual.tenantId);
    const empresaId = Number(contextoUsuarioActual.empresaId);
    const sitioId = this.normalizarIdFormulario(datos?.sitioId ?? datos?.sitio_id);

    if (nivelSolicitado === 'empresa') {
      return { tenantId, empresaId, sitioId: null };
    }

    if (nivelSolicitado === 'sitio') {
      const sitio = sitiosPorId.get(sitioId);

      if (
        !sitio ||
        Number(sitio.tenantId) !== tenantId ||
        Number(sitio.empresaId) !== empresaId
      ) {
        throw new Error('Debes seleccionar un sitio visible dentro de tu empresa.');
      }

      return { tenantId, empresaId, sitioId };
    }

    throw new Error(
      'Solo puedes crear o mover zonas DNS en tu mismo alcance o en uno inferior.'
    );
  }

  async validarNombreZonaUnico(nombreZona, idActual = null) {
    const zonaExistente = await this.repositorioZonasDns.buscarPorNombreZona(
      nombreZona
    );

    if (zonaExistente && Number(zonaExistente.id) !== Number(idActual || 0)) {
      throw new Error('Ya existe otra zona DNS con ese nombre.');
    }
  }

  verificarEdicionZonaAvanzadaPermitida(contextoUsuarioActual, zona) {
    if (this.esEditableConModoActual(zona, contextoUsuarioActual)) {
      return;
    }

    throw new Error(
      'Necesitas Publicar DNS para editar zonas publicables y Administración DNS avanzada para zonas reservadas.'
    );
  }

  verificarEdicionRegistroAvanzadaPermitida(contextoUsuarioActual, registro) {
    if (this.esEditableConModoActual(registro, contextoUsuarioActual)) {
      return;
    }

    throw new Error(
      'Necesitas Publicar DNS para editar registros publicables y Administración DNS avanzada para registros reservados.'
    );
  }

  verificarGestionRegistrosPermitida(contextoUsuarioActual) {
    if (this.puedeGestionarPublicacionDns(contextoUsuarioActual)) {
      return;
    }

    throw new Error(
      'Necesitas permiso Publicar DNS para eliminar registros DNS.'
    );
  }

  verificarOperacionRegistrosEnZonaPermitida(contextoUsuarioActual, zona) {
    if (this.esZonaOperableParaCatalogoRegistros(zona, contextoUsuarioActual)) {
      return;
    }

    throw new Error(
      'Solo la Administración DNS avanzada puede crear o editar registros dentro de zonas reservadas.'
    );
  }

  construirFormularioDesdeZona(zona, contextoUsuarioActual) {
    if (!zona) {
      const tenantId = contextoUsuarioActual?.nivelScope !== 'portal'
        ? String(contextoUsuarioActual?.tenantId || '')
        : '';
      const empresaId = ['empresa', 'sitio'].includes(contextoUsuarioActual?.nivelScope)
        ? String(contextoUsuarioActual?.empresaId || '')
        : '';
      const sitioId = contextoUsuarioActual?.nivelScope === 'sitio'
        ? String(contextoUsuarioActual?.sitioId || '')
        : '';
      const nivelPertenencia = contextoUsuarioActual?.nivelScope === 'portal'
        ? 'portal'
        : contextoUsuarioActual?.nivelScope || 'portal';

      return {
        tenantId,
        empresaId,
        sitioId,
        nivelPertenencia,
        nombreZona: '',
        tipoZona: 'master',
        categoriaOrigen: 'normal',
        publicarEnBind: true,
        descripcion: '',
        ttlDefectoSegundos: '3600',
        soaMname: '',
        soaRname: '',
        soaRefreshSegundos: '3600',
        soaRetrySegundos: '600',
        soaExpireSegundos: '1209600',
        soaMinimumSegundos: '300',
        activo: true
      };
    }

    return {
      tenantId: zona.tenantId == null ? '' : String(zona.tenantId),
      empresaId: zona.empresaId == null ? '' : String(zona.empresaId),
      sitioId: zona.sitioId == null ? '' : String(zona.sitioId),
      nivelPertenencia: zona.resolverNivelPertenencia(),
      nombreZona: zona.nombreZona,
      tipoZona: zona.tipoZona,
      categoriaOrigen: zona.categoriaOrigen,
      publicarEnBind: zona.publicarEnBind,
      descripcion: zona.descripcion || '',
      ttlDefectoSegundos: String(zona.ttlDefectoSegundos),
      soaMname: zona.soaMname,
      soaRname: zona.soaRname,
      soaRefreshSegundos: String(zona.soaRefreshSegundos),
      soaRetrySegundos: String(zona.soaRetrySegundos),
      soaExpireSegundos: String(zona.soaExpireSegundos),
      soaMinimumSegundos: String(zona.soaMinimumSegundos),
      activo: Boolean(zona.activo)
    };
  }

  construirFormularioRegistroDesdeRegistro(registro) {
    if (!registro) {
      return {
        hostRelativo: '@',
        tipoRegistro: 'A',
        valorPrincipal: '',
        ttlSegundos: '',
        prioridad: '',
        peso: '',
        puerto: '',
        flags: '',
        tag: '',
        categoriaOrigen: 'normal',
        publicarEnBind: true,
        datosAuxiliares: '',
        gobernanzaModoControl: 'valor_y_activo',
        gobernanzaRolAsignado: '',
        gobernanzaTtlSugerido: '',
        descripcion: '',
        activo: true
      };
    }

    const gobernanza = this.resolverGobernanzaRegistro(registro);

    return {
      hostRelativo: registro.hostRelativo,
      tipoRegistro: registro.tipoRegistro,
      valorPrincipal: registro.valorPrincipal || '',
      ttlSegundos: registro.ttlSegundos == null ? '' : String(registro.ttlSegundos),
      prioridad: registro.prioridad == null ? '' : String(registro.prioridad),
      peso: registro.peso == null ? '' : String(registro.peso),
      puerto: registro.puerto == null ? '' : String(registro.puerto),
      flags: registro.flags || '',
      tag: registro.tag || '',
      categoriaOrigen: registro.categoriaOrigen,
      publicarEnBind: registro.publicarEnBind,
      datosAuxiliares: this.serializarJsonBonito(
        registro.datosAuxiliares || gobernanza
      ),
      gobernanzaModoControl: gobernanza?.modoControl || 'valor_y_activo',
      gobernanzaRolAsignado: gobernanza?.rolAsignado || '',
      gobernanzaTtlSugerido: gobernanza?.ttlSugerido == null
        ? ''
        : String(gobernanza.ttlSugerido),
      descripcion: registro.descripcion || '',
      activo: Boolean(registro.activo)
    };
  }

  construirFormularioRegistroDesdeEntrada(datos, registroBase = null) {
    return {
      hostRelativo: String(
        datos?.hostRelativo ?? datos?.host_relativo ?? '@'
      ).trim(),
      tipoRegistro: String(
        datos?.tipoRegistro ?? datos?.tipo_registro ?? 'A'
      ).trim().toUpperCase(),
      valorPrincipal: String(
        datos?.valorPrincipal ?? datos?.valor_principal ?? ''
      ).trim(),
      ttlSegundos: String(
        datos?.ttlSegundos ?? datos?.ttl_segundos ?? ''
      ).trim(),
      prioridad: String(datos?.prioridad ?? '').trim(),
      peso: String(datos?.peso ?? '').trim(),
      puerto: String(datos?.puerto ?? '').trim(),
      flags: String(datos?.flags ?? '').trim(),
      tag: String(datos?.tag ?? '').trim(),
      categoriaOrigen: String(
        datos?.categoriaOrigen ??
        datos?.categoria_origen ??
        registroBase?.categoriaOrigen ??
        'normal'
      ).trim().toLowerCase(),
      publicarEnBind: normalizarBooleano(
        datos?.publicarEnBind ?? datos?.publicar_en_bind,
        registroBase?.publicarEnBind ?? true
      ),
      datosAuxiliares: String(
        datos?.datosAuxiliares ?? datos?.datos_auxiliares ?? ''
      ).trim(),
      gobernanzaModoControl: String(
        datos?.gobernanzaModoControl ??
        datos?.gobernanza_modo_control ??
        'valor_y_activo'
      ).trim(),
      gobernanzaRolAsignado: String(
        datos?.gobernanzaRolAsignado ??
        datos?.gobernanza_rol_asignado ??
        ''
      ).trim(),
      gobernanzaTtlSugerido: String(
        datos?.gobernanzaTtlSugerido ??
        datos?.gobernanza_ttl_sugerido ??
        ''
      ).trim(),
      descripcion: String(datos?.descripcion ?? '').trim(),
      activo: normalizarBooleano(datos?.activo, true)
    };
  }

  normalizarDefinicionRegistroFormulario(
    contextoUsuarioActual,
    zona,
    datos,
    registroActual = null
  ) {
    const puedeAdministrarDnsAvanzado =
      this.puedeAdministrarDnsAvanzado(contextoUsuarioActual);
    const puedeGestionarPublicacionDns =
      this.puedeGestionarPublicacionDns(contextoUsuarioActual);
    const categoriaOrigen = puedeAdministrarDnsAvanzado
      ? datos?.categoriaOrigen ?? datos?.categoria_origen ?? 'normal'
      : (registroActual?.categoriaOrigen || 'normal');
    const publicarEnBind = puedeGestionarPublicacionDns
      ? normalizarBooleano(
          datos?.publicarEnBind ?? datos?.publicar_en_bind,
          true
        )
      : false;
    const bloquearValorPrincipal =
      this.debeBloquearEdicionHumanaValorPrincipal(registroActual);
    const valorPrincipalSolicitado =
      datos?.valorPrincipal ?? datos?.valor_principal;

    if (
      bloquearValorPrincipal &&
      String(valorPrincipalSolicitado ?? '').trim() !==
        String(registroActual?.valorPrincipal ?? '').trim()
    ) {
      throw new Error(
        'El valor principal de este registro DNS está gobernado por automatización. Puedes revisar su estado, pero no cambiarlo manualmente desde esta pantalla.'
      );
    }

    return this.validadorRegistroDns.normalizarDefinicionBase({
      zonaId: zona.id,
      hostRelativo: datos?.hostRelativo ?? datos?.host_relativo,
      tipoRegistro: datos?.tipoRegistro ?? datos?.tipo_registro,
      valorPrincipal: bloquearValorPrincipal
        ? registroActual?.valorPrincipal
        : valorPrincipalSolicitado,
      ttlSegundos: datos?.ttlSegundos ?? datos?.ttl_segundos,
      prioridad: datos?.prioridad,
      peso: datos?.peso,
      puerto: datos?.puerto,
      flags: datos?.flags,
      tag: datos?.tag,
      categoriaOrigen,
      publicarEnBind,
      datosAuxiliares: this.construirDatosAuxiliaresRegistroFormulario(
        categoriaOrigen,
        datos
      ),
      descripcion: datos?.descripcion,
      activo: normalizarBooleano(datos?.activo, true)
    });
  }

  construirFormularioDesdeEntrada(datos, zonaBase = null) {
    return {
      tenantId: String(datos?.tenantId ?? datos?.tenant_id ?? '').trim(),
      empresaId: String(datos?.empresaId ?? datos?.empresa_id ?? '').trim(),
      sitioId: String(datos?.sitioId ?? datos?.sitio_id ?? '').trim(),
      nivelPertenencia: this.resolverNivelPertenenciaSolicitada(
        datos?.nivelPertenencia ?? datos?.nivel_pertenencia,
        datos?.tenantId ?? datos?.tenant_id,
        datos?.empresaId ?? datos?.empresa_id,
        datos?.sitioId ?? datos?.sitio_id
      ),
      nombreZona: String(datos?.nombreZona ?? datos?.nombre_zona ?? '').trim(),
      tipoZona: 'master',
      categoriaOrigen: String(
        datos?.categoriaOrigen ??
        datos?.categoria_origen ??
        zonaBase?.categoriaOrigen ??
        'normal'
      ).trim().toLowerCase(),
      publicarEnBind: normalizarBooleano(
        datos?.publicarEnBind ?? datos?.publicar_en_bind,
        zonaBase?.publicarEnBind ?? true
      ),
      descripcion: String(datos?.descripcion ?? '').trim(),
      ttlDefectoSegundos: String(
        datos?.ttlDefectoSegundos ?? datos?.ttl_defecto_segundos ?? '3600'
      ).trim(),
      soaMname: String(datos?.soaMname ?? datos?.soa_mname ?? '').trim(),
      soaRname: String(datos?.soaRname ?? datos?.soa_rname ?? '').trim(),
      soaRefreshSegundos: String(
        datos?.soaRefreshSegundos ?? datos?.soa_refresh_segundos ?? '3600'
      ).trim(),
      soaRetrySegundos: String(
        datos?.soaRetrySegundos ?? datos?.soa_retry_segundos ?? '600'
      ).trim(),
      soaExpireSegundos: String(
        datos?.soaExpireSegundos ?? datos?.soa_expire_segundos ?? '1209600'
      ).trim(),
      soaMinimumSegundos: String(
        datos?.soaMinimumSegundos ?? datos?.soa_minimum_segundos ?? '300'
      ).trim(),
      activo: normalizarBooleano(datos?.activo, true)
    };
  }

  resolverNivelPertenenciaSolicitada(
    nivelPertenencia,
    tenantId = null,
    empresaId = null,
    sitioId = null
  ) {
    const normalizado = String(nivelPertenencia || '').trim().toLowerCase();

    if (['portal', 'tenant', 'empresa', 'sitio'].includes(normalizado)) {
      return normalizado;
    }

    if (!tenantId && !empresaId && !sitioId) {
      return 'portal';
    }

    if (tenantId && !empresaId && !sitioId) {
      return 'tenant';
    }

    if (tenantId && empresaId && !sitioId) {
      return 'empresa';
    }

    if (tenantId && empresaId && sitioId) {
      return 'sitio';
    }

    return 'portal';
  }

  resolverRestriccionesScope(contextoUsuarioActual) {
    if (contextoUsuarioActual?.nivelScope === 'tenant') {
      return {
        tenantBloqueado: true,
        empresaBloqueada: false,
        sitioBloqueadoPorScope: false,
        nivelPertenenciaFijo: null,
        mensajeScope:
          'Tu tenant queda fijado por alcance. Puedes crear zonas de tenant, empresa o sitio dentro de tu jerarquía.'
      };
    }

    if (contextoUsuarioActual?.nivelScope === 'empresa') {
      return {
        tenantBloqueado: true,
        empresaBloqueada: true,
        sitioBloqueadoPorScope: false,
        nivelPertenenciaFijo: null,
        mensajeScope:
          'Tu tenant y empresa quedan fijados por alcance. Puedes crear zonas de empresa o acotarlas a un sitio propio.'
      };
    }

    if (contextoUsuarioActual?.nivelScope === 'sitio') {
      return {
        tenantBloqueado: true,
        empresaBloqueada: true,
        sitioBloqueadoPorScope: true,
        nivelPertenenciaFijo: 'sitio',
        mensajeScope:
          'Tu alcance está fijado al sitio actual. La zona DNS solo puede pertenecer a ese sitio.'
      };
    }

    return {
      tenantBloqueado: false,
      empresaBloqueada: false,
      sitioBloqueadoPorScope: false,
      nivelPertenenciaFijo: null,
      mensajeScope:
        'Puedes elegir alcance portal, tenant, empresa o sitio. Los campos inferiores solo se exigen cuando el ámbito los necesita.'
    };
  }

  listarOpcionesPertenenciaDisponibles(contextoUsuarioActual = {}) {
    if (contextoUsuarioActual.nivelScope === 'sitio') {
      return [
        { valor: 'sitio', etiqueta: 'Zona de sitio' }
      ];
    }

    if (contextoUsuarioActual.nivelScope === 'empresa') {
      return [
        { valor: 'empresa', etiqueta: 'Zona de empresa' },
        { valor: 'sitio', etiqueta: 'Zona de sitio' }
      ];
    }

    if (contextoUsuarioActual.nivelScope === 'tenant') {
      return [
        { valor: 'tenant', etiqueta: 'Zona de tenant' },
        { valor: 'empresa', etiqueta: 'Zona de empresa' },
        { valor: 'sitio', etiqueta: 'Zona de sitio' }
      ];
    }

    return [
      { valor: 'portal', etiqueta: 'Zona de portal' },
      { valor: 'tenant', etiqueta: 'Zona de tenant' },
      { valor: 'empresa', etiqueta: 'Zona de empresa' },
      { valor: 'sitio', etiqueta: 'Zona de sitio' }
    ];
  }

  listarOpcionesTipoRegistro() {
    return [
      { valor: 'A', etiqueta: 'A' },
      { valor: 'AAAA', etiqueta: 'AAAA' },
      { valor: 'CNAME', etiqueta: 'CNAME' },
      { valor: 'NS', etiqueta: 'NS' },
      { valor: 'TXT', etiqueta: 'TXT' },
      { valor: 'MX', etiqueta: 'MX' },
      { valor: 'SRV', etiqueta: 'SRV' },
      { valor: 'CAA', etiqueta: 'CAA' },
      { valor: 'PTR', etiqueta: 'PTR' }
    ];
  }

  listarOpcionesCategoriaRegistro() {
    return [
      { valor: 'normal', etiqueta: 'Normal' },
      { valor: 'sistema', etiqueta: 'Sistema' },
      { valor: 'ddns', etiqueta: 'DDNS' },
      { valor: 'trigger', etiqueta: 'Trigger' }
    ];
  }

  async cargarEntidadesScopeVisibles(contextoUsuarioActual) {
    return Promise.all([
      this.repositorioTenants?.listarVisibles?.(contextoUsuarioActual) ||
        Promise.resolve([]),
      this.repositorioEmpresas?.listarVisibles?.(contextoUsuarioActual) ||
        Promise.resolve([]),
      this.repositorioSitios?.listarVisibles?.(contextoUsuarioActual) ||
        Promise.resolve([])
    ]);
  }

  construirAlcanceActual(contextoUsuarioActual) {
    if (
      this.servicioLecturaDnsPortal &&
      typeof this.servicioLecturaDnsPortal.construirAlcanceActual === 'function'
    ) {
      return this.servicioLecturaDnsPortal.construirAlcanceActual(
        contextoUsuarioActual
      );
    }

    return {
      nivelScope: this.resolutorScopeUsuario?.resolverNivelScope?.(
        contextoUsuarioActual || {}
      ) || 'desconocido',
      descripcion: this.resolutorScopeUsuario?.describirScope?.(
        contextoUsuarioActual || {}
      ) || 'Alcance no disponible'
    };
  }

  normalizarIdFormulario(valor) {
    const normalizado = Number.parseInt(String(valor ?? '').trim(), 10);
    return Number.isInteger(normalizado) && normalizado > 0
      ? normalizado
      : null;
  }

  normalizarRetorno(retorno) {
    const retornoNormalizado = String(retorno || '').trim();
    return retornoNormalizado.startsWith('/dns') ||
      /^\/monitores\/triggers\/editar\/\d+(?:\?[^#]*)?$/.test(retornoNormalizado)
      ? retornoNormalizado
      : '/dns';
  }

  normalizarErrorPersistencia(error) {
    if (error?.code === 'ER_DUP_ENTRY') {
      return new Error('Ya existe otra zona DNS con ese nombre.');
    }

    return error;
  }

  normalizarErrorPersistenciaRegistro(error) {
    return error;
  }

  serializarJsonBonito(valor) {
    if (!valor || typeof valor !== 'object' || Array.isArray(valor)) {
      return '';
    }

    const claves = Object.keys(valor);
    return claves.length > 0 ? JSON.stringify(valor, null, 2) : '';
  }

  construirDatosAuxiliaresRegistroFormulario(categoriaOrigen, datos = {}) {
    const categoria = String(categoriaOrigen || 'normal').trim().toLowerCase();
    const bruto = datos?.datosAuxiliares ?? datos?.datos_auxiliares;

    if (!['trigger', 'ddns'].includes(categoria)) {
      return bruto;
    }

    const base = this.parsearJsonObjetoOpcional(bruto);

    if (base === false) {
      return bruto;
    }

    const modoControl = String(
      datos?.gobernanzaModoControl ??
      datos?.gobernanza_modo_control ??
      base?.modoControl ??
      'valor_y_activo'
    ).trim();
    const rolAsignado = String(
      datos?.gobernanzaRolAsignado ??
      datos?.gobernanza_rol_asignado ??
      base?.rolAsignado ??
      ''
    ).trim();
    const ttlSugerido = String(
      datos?.gobernanzaTtlSugerido ??
      datos?.gobernanza_ttl_sugerido ??
      base?.ttlSugerido ??
      ''
    ).trim();
    const resultado = {
      ...(base || {}),
      gobernadoPor: categoria,
      modoControl: modoControl || 'valor_y_activo'
    };

    if (rolAsignado) {
      resultado.rolAsignado = rolAsignado;
    } else {
      delete resultado.rolAsignado;
    }

    if (categoria === 'ddns' && ttlSugerido) {
      resultado.ttlSugerido = ttlSugerido;
    } else if (categoria === 'ddns' && resultado.ttlSugerido == null) {
      resultado.ttlSugerido = 300;
    } else if (categoria !== 'ddns') {
      delete resultado.ttlSugerido;
    }

    if (categoria === 'ddns') {
      resultado.propietario = String(
        base?.propietario || 'agente'
      ).trim() || 'agente';
      resultado.criterioActualizacion = String(
        base?.criterioActualizacion || 'direccion_agente'
      ).trim() || 'direccion_agente';
      resultado.politicaSobrescritura = String(
        base?.politicaSobrescritura || 'solo_si_cambia'
      ).trim() || 'solo_si_cambia';
      resultado.validacionOrigen = String(
        base?.validacionOrigen || 'agente_autenticado_y_scope'
      ).trim() || 'agente_autenticado_y_scope';
    } else {
      delete resultado.propietario;
      delete resultado.criterioActualizacion;
      delete resultado.politicaSobrescritura;
      delete resultado.validacionOrigen;
    }

    return resultado;
  }

  parsearJsonObjetoOpcional(valor) {
    if (valor == null || String(valor).trim() === '') {
      return null;
    }

    if (typeof valor === 'object' && !Array.isArray(valor)) {
      return { ...valor };
    }

    try {
      const parseado = JSON.parse(String(valor));
      return parseado && typeof parseado === 'object' && !Array.isArray(parseado)
        ? parseado
        : false;
    } catch (_error) {
      return false;
    }
  }

  puedeAdministrarDnsAvanzado(contextoUsuarioActual) {
    return Boolean(contextoUsuarioActual?.permisos?.administrarDnsAvanzado);
  }

  puedePublicarDns(contextoUsuarioActual) {
    return Boolean(contextoUsuarioActual?.permisos?.publicarDns);
  }

  puedeGestionarPublicacionDns(contextoUsuarioActual) {
    return (
      this.puedeAdministrarDnsAvanzado(contextoUsuarioActual) ||
      this.puedePublicarDns(contextoUsuarioActual)
    );
  }

  esEditableConModoActual(entidad, contextoUsuarioActual) {
    if (this.puedeAdministrarDnsAvanzado(contextoUsuarioActual)) {
      return true;
    }

    if (entidad?.categoriaOrigen !== 'normal') {
      return false;
    }

    return (
      !Boolean(entidad?.publicarEnBind) ||
      this.puedePublicarDns(contextoUsuarioActual)
    );
  }

  esZonaOperableParaCatalogoRegistros(zona, contextoUsuarioActual) {
    return (
      this.puedeAdministrarDnsAvanzado(contextoUsuarioActual) ||
      zona?.categoriaOrigen === 'normal'
    );
  }

  resolverGobernanzaRegistro(registro) {
    if (!registro) {
      return null;
    }

    if (typeof registro.resolverGobernanzaAutomatica === 'function') {
      return registro.resolverGobernanzaAutomatica();
    }

    return registro?.gobernanzaAutomatica || null;
  }

  debeBloquearEdicionHumanaValorPrincipal(registro) {
    const gobernanza = this.resolverGobernanzaRegistro(registro);
    return gobernanza != null && gobernanza.gobernadoPor !== 'ddns';
  }

  async aplicarEdicionHumanaDdnsSiProcede({
    conexion,
    contextoUsuarioActual,
    registroActual,
    definicion,
    camposCambiados
  }) {
    const cambiaValorDelegado = camposCambiados.includes('valorPrincipal') ||
      (registroActual.tipoRegistro === 'MX' && camposCambiados.includes('prioridad'));
    if (!cambiaValorDelegado || registroActual.categoriaOrigen !== 'ddns' ||
        typeof this.servicioAplicacionDdnsAgentes
          ?.editarValorGobernadoEnTransaccion !== 'function') {
      return null;
    }
    return this.servicioAplicacionDdnsAgentes.editarValorGobernadoEnTransaccion({
      actorRealId:
        contextoUsuarioActual?.idUsuarioReal ?? contextoUsuarioActual?.idUsuario,
      actorEfectivoId: contextoUsuarioActual?.idUsuario,
      registroDnsId: registroActual.id,
      valorPrincipal: definicion.valorPrincipal,
      prioridad: definicion.prioridad
    }, { conexion });
  }

  construirRutaDetalleZona(idZona, filtrosRegistros = {}, retornoListado = '/dns') {
    const parametros = new URLSearchParams();
    const retorno = this.normalizarRetorno(retornoListado);

    if (retorno) {
      parametros.set('return_to', retorno);
    }

    const q = String(filtrosRegistros?.q ?? filtrosRegistros?.textoBusqueda ?? '').trim();
    const tipoRegistro = String(
      filtrosRegistros?.tipo_registro ?? filtrosRegistros?.tipoRegistro ?? ''
    ).trim();
    const activo = String(filtrosRegistros?.activo ?? '').trim();
    const pagina = String(
      filtrosRegistros?.page ?? filtrosRegistros?.pagina ?? ''
    ).trim();
    const tamanoPagina = String(
      filtrosRegistros?.page_size ?? filtrosRegistros?.tamanoPagina ?? ''
    ).trim();

    if (q) {
      parametros.set('q', q);
    }

    if (tipoRegistro) {
      parametros.set('tipo_registro', tipoRegistro);
    }

    if (activo) {
      parametros.set('activo', activo);
    }

    if (pagina) {
      parametros.set('page', pagina);
    }

    if (tamanoPagina) {
      parametros.set('page_size', tamanoPagina);
    }

    const consulta = parametros.toString();
    return consulta ? `/dns/${idZona}?${consulta}` : `/dns/${idZona}`;
  }

  async invalidarCatalogoDns() {
    if (!this.servicioDns?.invalidarCatalogoDns) {
      return;
    }

    await this.servicioDns.invalidarCatalogoDns();
  }

  ejecutarMutacionDns(trabajo) {
    if (this.fronteraTransaccional?.ejecutar) {
      return this.fronteraTransaccional.ejecutar(trabajo);
    }

    return this.ejecutarMutacionDnsLocal(trabajo);
  }

  async ejecutarMutacionDnsLocal(trabajo) {
    const conexion = await this.repositorioZonasDns.clienteSql.obtenerConexion();

    try {
      await conexion.beginTransaction();
      const resultado = await trabajo(conexion);
      await conexion.commit();
      return resultado;
    } catch (error) {
      await conexion.rollback();
      throw error;
    } finally {
      conexion.release();
    }
  }

  auditoriaActiva(contextoUsuarioActual) {
    return Boolean(
      contextoUsuarioActual &&
      this.servicioAuditoria?.registrarEnTransaccion
    );
  }

  registrarEventoDns({
    conexion,
    contextoUsuarioActual,
    tipo,
    sujeto,
    scope,
    payload
  }) {
    if (!this.auditoriaActiva(contextoUsuarioActual)) {
      return null;
    }

    const eventoId = generarUuidV7Auditoria();
    return this.servicioAuditoria.registrarEnTransaccion({
      cambioEfectivo: true,
      intencion: {
        versionContrato: 1,
        eventoId,
        tipo,
        flujo: 'dns',
        claveCadena: claveCadenaDns(scope),
        actor: 'usuario',
        actorReal: actorReal(contextoUsuarioActual),
        actorEfectivo: actorEfectivo(contextoUsuarioActual),
        modoActuacion: contextoUsuarioActual?.impersonacionActiva
          ? 'impersonado'
          : 'directo',
        sujeto,
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

  registrarMovimientoScopeDns({
    conexion,
    contextoUsuarioActual,
    sujeto,
    scopeAnterior,
    scopeActual
  }) {
    if (!this.auditoriaActiva(contextoUsuarioActual)) {
      return null;
    }

    const salidaId = generarUuidV7Auditoria();
    const entradaId = generarUuidV7Auditoria();
    const comun = {
      versionContrato: 1,
      flujo: 'dns',
      actor: 'usuario',
      actorReal: actorReal(contextoUsuarioActual),
      actorEfectivo: actorEfectivo(contextoUsuarioActual),
      modoActuacion: contextoUsuarioActual?.impersonacionActiva
        ? 'impersonado'
        : 'directo',
      sujeto,
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
      claveCadena: claveCadenaDns(scopeAnterior),
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
      claveCadena: claveCadenaDns(scopeActual),
      scope: scopeActual,
      rolEvento: 'entrada',
      payload: {
        direccion: 'entrada',
        scopePropio: scopeActual,
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

  async crearGeneracionDnsSiAfectaPublicacion({
    conexion,
    afectaPublicacion
  }) {
    if (!afectaPublicacion) {
      return null;
    }

    if (
      typeof this.repositorioCoordinacionGeneracionesDns
        ?.crearGeneracionPorMutacionEnTransaccion !== 'function'
    ) {
      return null;
    }

    return this.repositorioCoordinacionGeneracionesDns
      .crearGeneracionPorMutacionEnTransaccion({ conexion });
  }
}

function fotografiaZonaDnsAuditable(zona) {
  return {
    nombreZona: zona.nombreZona,
    tipoZona: zona.tipoZona,
    categoriaOrigen: zona.categoriaOrigen,
    descripcion: zona.descripcion ?? null,
    activo: Boolean(zona.activo),
    publicarEnBind: Boolean(zona.publicarEnBind),
    ttlDefectoSegundos: Number(zona.ttlDefectoSegundos),
    soaMname: zona.soaMname,
    soaRname: zona.soaRname,
    soaRefreshSegundos: Number(zona.soaRefreshSegundos),
    soaRetrySegundos: Number(zona.soaRetrySegundos),
    soaExpireSegundos: Number(zona.soaExpireSegundos),
    soaMinimumSegundos: Number(zona.soaMinimumSegundos),
    tenantId: idAuditable(zona.tenantId),
    empresaId: idAuditable(zona.empresaId),
    sitioId: idAuditable(zona.sitioId)
  };
}

function fotografiaZonaDefinicionAuditable(definicion) {
  return {
    nombreZona: definicion.nombreZona,
    tipoZona: definicion.tipoZona,
    categoriaOrigen: definicion.categoriaOrigen,
    descripcion: definicion.descripcion ?? null,
    activo: Boolean(definicion.activo),
    publicarEnBind: Boolean(definicion.publicarEnBind),
    ttlDefectoSegundos: Number(definicion.ttlDefectoSegundos),
    soaMname: definicion.soaMname,
    soaRname: definicion.soaRname,
    soaRefreshSegundos: Number(definicion.soaRefreshSegundos),
    soaRetrySegundos: Number(definicion.soaRetrySegundos),
    soaExpireSegundos: Number(definicion.soaExpireSegundos),
    soaMinimumSegundos: Number(definicion.soaMinimumSegundos),
    tenantId: idAuditable(definicion.tenantId),
    empresaId: idAuditable(definicion.empresaId),
    sitioId: idAuditable(definicion.sitioId)
  };
}

function fotografiaRegistroDnsAuditable(registro) {
  return {
    zonaId: String(registro.zonaId),
    hostRelativo: registro.hostRelativo,
    tipoRegistro: registro.tipoRegistro,
    valorPrincipal: registro.valorPrincipal ?? null,
    ttlSegundos: registro.ttlSegundos == null ? null : Number(registro.ttlSegundos),
    prioridad: registro.prioridad == null ? null : Number(registro.prioridad),
    peso: registro.peso == null ? null : Number(registro.peso),
    puerto: registro.puerto == null ? null : Number(registro.puerto),
    flags: registro.flags ?? null,
    tag: registro.tag ?? null,
    categoriaOrigen: registro.categoriaOrigen,
    publicarEnBind: Boolean(registro.publicarEnBind),
    datosAuxiliares: datosAuxiliaresAuditables(registro.datosAuxiliares),
    activo: Boolean(registro.activo),
    descripcion: registro.descripcion ?? null,
    tenantId: idAuditable(registro.tenantId),
    empresaId: idAuditable(registro.empresaId),
    sitioId: idAuditable(registro.sitioId)
  };
}

function fotografiaRegistroDefinicionAuditable(definicion, registroActual) {
  return {
    zonaId: String(registroActual.zonaId),
    hostRelativo: definicion.hostRelativo,
    tipoRegistro: definicion.tipoRegistro,
    valorPrincipal: definicion.valorPrincipal ?? null,
    ttlSegundos: definicion.ttlSegundos == null ? null : Number(definicion.ttlSegundos),
    prioridad: definicion.prioridad == null ? null : Number(definicion.prioridad),
    peso: definicion.peso == null ? null : Number(definicion.peso),
    puerto: definicion.puerto == null ? null : Number(definicion.puerto),
    flags: definicion.flags ?? null,
    tag: definicion.tag ?? null,
    categoriaOrigen: definicion.categoriaOrigen,
    publicarEnBind: Boolean(definicion.publicarEnBind),
    datosAuxiliares: datosAuxiliaresAuditables(definicion.datosAuxiliares),
    activo: Boolean(definicion.activo),
    descripcion: definicion.descripcion ?? null,
    tenantId: idAuditable(registroActual.tenantId),
    empresaId: idAuditable(registroActual.empresaId),
    sitioId: idAuditable(registroActual.sitioId)
  };
}

function datosAuxiliaresAuditables(datosAuxiliares) {
  if (!datosAuxiliares || typeof datosAuxiliares !== 'object') {
    return null;
  }

  const seguro = {};
  for (const clave of [
    'gobernadoPor',
    'modoControl',
    'rolAsignado',
    'ttlSugerido',
    'propietario',
    'criterioActualizacion',
    'politicaSobrescritura',
    'validacionOrigen'
  ]) {
    if (Object.hasOwn(datosAuxiliares, clave)) {
      seguro[clave] = datosAuxiliares[clave];
    }
  }

  return Object.keys(seguro).length > 0 ? seguro : null;
}

function impactoEliminacionDns(dependenciasEliminadas) {
  const total = Number(dependenciasEliminadas || 0);

  if (!Number.isFinite(total) || total <= 0) {
    return null;
  }

  return {
    dependenciasEliminadas: String(Math.trunc(total)),
    referenciasDesacopladas: '0'
  };
}

function zonaAfectaPublicacion(antes, despues) {
  return entidadPublicableBind(antes) || entidadPublicableBind(despues);
}

function registroAfectaPublicacion(zona, antes, despues) {
  if (!entidadPublicableBind(zona)) {
    return false;
  }

  return entidadPublicableBind(antes) || entidadPublicableBind(despues);
}

function entidadPublicableBind(entidad) {
  return Boolean(entidad?.activo) && Boolean(entidad?.publicarEnBind);
}

function definicionPublicableBind(definicion) {
  return Boolean(definicion?.activo) && Boolean(definicion?.publicarEnBind);
}

function calcularCamposCambiados(antes, despues) {
  return Object.keys(despues)
    .filter((campo) => !isDeepStrictEqual(antes[campo], despues[campo]))
    .sort(compararUtf8);
}

function filtrarFotografiaPorCampos(fotografia, campos) {
  return Object.fromEntries(campos.map((campo) => [campo, fotografia[campo]]));
}

function scopeCambio(antes, despues) {
  return ['tenantId', 'empresaId', 'sitioId'].some(
    (campo) => antes[campo] !== despues[campo]
  );
}

function scopeDesdeEntidadDns(entidad) {
  return {
    tenantId: idAuditable(entidad.tenantId),
    empresaId: idAuditable(entidad.empresaId),
    sitioId: idAuditable(entidad.sitioId)
  };
}

function scopeDesdeFotografia(fotografia) {
  return {
    tenantId: fotografia.tenantId,
    empresaId: fotografia.empresaId,
    sitioId: fotografia.sitioId
  };
}

function claveCadenaDns(scope) {
  return scope.tenantId == null
    ? 'dns:portal'
    : `dns:tenant:${scope.tenantId}`;
}

function idAuditable(valor) {
  return valor == null ? null : String(valor);
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

function compararUtf8(a, b) {
  return Buffer.from(a).compare(Buffer.from(b));
}

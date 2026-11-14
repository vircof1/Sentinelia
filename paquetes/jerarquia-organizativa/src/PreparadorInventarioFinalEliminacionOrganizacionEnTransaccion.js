import {
  crearComandoEliminacionAdministrativaOrganizacion,
  crearResumenImpactoEliminacionOrganizacion,
  CLASES_IMPACTO_ELIMINACION_ORGANIZACION,
  PERFIL_RESUMEN_IMPACTO_ELIMINACION_ORGANIZACION,
  VERSION_CONTRATO_ELIMINACION_ADMINISTRATIVA_ORGANIZACION
} from './ContratoEliminacionAdministrativaOrganizacion.js';
import { ORDEN_BLOQUEO_INVENTARIO_ELIMINACION_ORGANIZACION }
  from './RepositorioInventarioFinalEliminacionOrganizacionSql.js';

export class ErrorInventarioFinalEliminacionOrganizacion extends Error {
  constructor(codigo, mensaje) {
    super(mensaje);
    this.name = 'ErrorInventarioFinalEliminacionOrganizacion';
    this.codigo = codigo;
    this.permanente = true;
    this.esErrorOperacionAdministrativa = true;
  }
}

export class PreparadorInventarioFinalEliminacionOrganizacionEnTransaccion {
  constructor({
    autoridadReservasJerarquicas,
    repositorioInventario,
    servicioReconciliacionBajaUsuarioTriggerCorreo = null
  } = {}) {
    exigirPuerto(
      autoridadReservasJerarquicas,
      'exigirDisponibilidadEnTransaccion'
    );
    for (const metodo of [
      'cargarRaizBloqueadaEnTransaccion',
      'bloquearActoresYUsuariosEnTransaccion',
      'bloquearAgentesEnTransaccion',
      'cargarConteosFinalesEnTransaccion'
    ]) exigirPuerto(repositorioInventario, metodo);
    if (servicioReconciliacionBajaUsuarioTriggerCorreo &&
        typeof servicioReconciliacionBajaUsuarioTriggerCorreo
          .prepararUsuariosEnTransaccion !== 'function') {
      throw new Error('El inventario recibió un reconciliador de correo inválido.');
    }
    Object.assign(this, {
      autoridadReservasJerarquicas,
      repositorioInventario,
      servicioReconciliacionBajaUsuarioTriggerCorreo
    });
  }

  async prepararEnTransaccion(
    { lease, operacion } = {},
    { conexion } = {}
  ) {
    if (!conexion || typeof conexion !== 'object') {
      throw new TypeError('El inventario exige una conexión SQL prestada.');
    }
    const comando = crearComandoEliminacionAdministrativaOrganizacion(operacion);
    if (String(lease?.operacionId || '') !== comando.identidades.operacionId) {
      throw new TypeError('El lease no corresponde al comando organizativo.');
    }
    const recurso = {
      tipoRecurso: comando.sujeto.tipo,
      recursoId: comando.sujeto.id
    };
    let autoridad;
    try {
      autoridad = await this.autoridadReservasJerarquicas
        .exigirDisponibilidadEnTransaccion({
          recursos: [recurso],
          operacionPropietariaId: comando.identidades.operacionId,
          leaseOperacionPropietaria: lease
        }, { conexion });
    } catch (error) {
      if (error?.codigo === 'recurso_reserva_jerarquica_ausente') {
        throw new ErrorInventarioFinalEliminacionOrganizacion(
          'organizacion_eliminacion_sujeto_ausente',
          'La raíz organizativa ya no existe al iniciar el efecto destructivo.'
        );
      }
      throw error;
    }
    exigirAutoridadExacta(autoridad, comando);

    const raiz = await this.repositorioInventario
      .cargarRaizBloqueadaEnTransaccion(
        { sujeto: comando.sujeto },
        { conexion }
      );
    if (!raiz) {
      throw new ErrorInventarioFinalEliminacionOrganizacion(
        'organizacion_eliminacion_sujeto_ausente',
        'La raíz organizativa desapareció tras adquirir su bloqueo.'
      );
    }
    const actorIds = [
      comando.fotografiaAutorizacion.actorReal.usuarioId,
      comando.fotografiaAutorizacion.actorEfectivo.usuarioId
    ];
    const usuarios = await this.repositorioInventario
      .bloquearActoresYUsuariosEnTransaccion(
        { sujeto: raiz, actorIds },
        { conexion }
      );
    const actores = new Set(actorIds);
    if (usuarios.some((usuario) =>
      actores.has(usuario.id) && pertenece(usuario.scope, raiz)
    )) {
      throw new ErrorInventarioFinalEliminacionOrganizacion(
        'organizacion_eliminacion_actor_incluido',
        'Un actor pertenece ahora al agregado que ordenó eliminar.'
      );
    }
    const agentes = await this.repositorioInventario
      .bloquearAgentesEnTransaccion({ sujeto: raiz }, { conexion });
    const inventarioDdns = typeof this.repositorioInventario
      .bloquearDdnsEnTransaccion === 'function'
      ? await this.repositorioInventario.bloquearDdnsEnTransaccion({
          sujeto: raiz,
          agenteIds: agentes.map(({ id }) => id)
        }, { conexion })
      : { concesionesIds: [] };
    const usuariosAfectados = usuarios
      .filter((usuario) => pertenece(usuario.scope, raiz))
      .map((usuario) => usuario.id);
    const preparacionAudienciaCorreo =
      this.servicioReconciliacionBajaUsuarioTriggerCorreo
        ? await this.servicioReconciliacionBajaUsuarioTriggerCorreo
          .prepararUsuariosEnTransaccion(usuariosAfectados, { conexion })
        : null;
    const conteos = await this.repositorioInventario
      .cargarConteosFinalesEnTransaccion({
        sujeto: raiz,
        operacionId: comando.identidades.operacionId,
        actorEfectivoId:
          comando.fotografiaAutorizacion.actorEfectivo.usuarioId
      }, { conexion });
    const impactoFinal = crearResumenImpactoEliminacionOrganizacion({
      perfil: PERFIL_RESUMEN_IMPACTO_ELIMINACION_ORGANIZACION,
      version: VERSION_CONTRATO_ELIMINACION_ADMINISTRATIVA_ORGANIZACION,
      clase: CLASES_IMPACTO_ELIMINACION_ORGANIZACION.FINAL,
      conteos
    });
    return congelar({
      comando,
      raiz,
      usuarios,
      agentes,
      inventarioDdns,
      preparacionAudienciaCorreo,
      impactoFinal,
      ordenBloqueo: ORDEN_BLOQUEO_INVENTARIO_ELIMINACION_ORGANIZACION
    });
  }
}

function exigirAutoridadExacta(autoridad, comando) {
  const propios = autoridad?.reclamosPropios;
  const rutas = autoridad?.rutas;
  const coincide = (entrada) =>
    entrada?.recurso?.tipoRecurso === comando.sujeto.tipo &&
    entrada?.recurso?.recursoId === comando.sujeto.id;
  if (!Array.isArray(propios) || propios.length !== 1 || !coincide(propios[0]) ||
      !Array.isArray(rutas) || rutas.length !== 1 || !coincide(rutas[0])) {
    throw new ErrorInventarioFinalEliminacionOrganizacion(
      'organizacion_eliminacion_impacto_no_seguro',
      'La operación no conserva una reserva propia y exacta sobre su raíz.'
    );
  }
}

function pertenece(scope, raiz) {
  if (raiz.tipo === 'tenant') return scope.tenantId === raiz.id;
  if (raiz.tipo === 'empresa') return scope.empresaId === raiz.id;
  return scope.sitioId === raiz.id;
}

function exigirPuerto(puerto, metodo) {
  if (typeof puerto?.[metodo] !== 'function') {
    throw new Error(`El inventario final exige el puerto ${metodo}().`);
  }
}

function congelar(entrada) {
  if (entrada && typeof entrada === 'object' && !Object.isFrozen(entrada)) {
    for (const valor of Object.values(entrada)) congelar(valor);
  }
  return Object.freeze(entrada);
}

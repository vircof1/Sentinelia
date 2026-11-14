import { ServicioAutorizacion } from '../../autorizacion/src/ServicioAutorizacion.js';
import { ResolutorScopeUsuario } from '../../contexto-usuario/src/ResolutorScopeUsuario.js';
import {
  construirAutoridadUsuarioEliminacionAdministrativa
} from '../../agentes/src/AutoridadUsuarioEliminacionAdministrativa.js';
import {
  PERFIL_FOTOGRAFIA_AUTORIZACION_ELIMINACION_ORGANIZACION,
  TIPOS_SUJETO_ELIMINACION_ORGANIZACION,
  crearFotografiaAutorizacionEliminacionOrganizacion,
  crearSujetoEliminacionAdministrativaOrganizacion
} from './ContratoEliminacionAdministrativaOrganizacion.js';

const TIPOS = new Set(Object.values(TIPOS_SUJETO_ELIMINACION_ORGANIZACION));
const PERMISOS_POR_TIPO = Object.freeze({
  tenant: 'puedeAdministrarTenants',
  empresa: 'puedeAdministrarEmpresas',
  sitio: 'puedeAdministrarSitios'
});

export class ErrorAutorizacionEliminacionAdministrativaOrganizacion extends Error {
  constructor(codigo = 'organizacion_eliminacion_no_autorizada', mensaje = null) {
    const mensajes = {
      organizacion_eliminacion_no_autorizada:
        'No existe una organización eliminable dentro del alcance autorizado.',
      organizacion_eliminacion_actor_incluido:
        'Un actor de la operación pertenece a la organización que pretende eliminar.',
      organizacion_eliminacion_operacion_en_curso:
        'La organización ya está cubierta por otra operación administrativa.'
    };
    super(mensaje || mensajes[codigo] || mensajes.organizacion_eliminacion_no_autorizada);
    this.name = 'ErrorAutorizacionEliminacionAdministrativaOrganizacion';
    this.codigo = codigo;
    this.codigoHttp = codigo === 'organizacion_eliminacion_no_autorizada' ? 404 : 409;
  }
}

export class ServicioAutorizacionEliminacionAdministrativaOrganizacion {
  constructor({
    repositorioUsuarios,
    autoridadReservasJerarquicas,
    fronteraTransaccional = null,
    resolutorScopeUsuario = new ResolutorScopeUsuario(),
    servicioAutorizacion = new ServicioAutorizacion(),
    ahora = () => new Date()
  } = {}) {
    if (typeof repositorioUsuarios?.buscarPorIdEnTransaccion !== 'function' ||
        typeof autoridadReservasJerarquicas?.exigirDisponibilidadEnTransaccion !==
          'function' ||
        typeof resolutorScopeUsuario?.resolverNivelScope !== 'function' ||
        typeof servicioAutorizacion?.puedeEliminarAgentes !== 'function' ||
        Object.values(PERMISOS_POR_TIPO).some((metodo) =>
          typeof servicioAutorizacion?.[metodo] !== 'function') ||
        typeof ahora !== 'function') {
      throw new Error(
        'La autorización organizativa requiere jerarquía, usuarios y permisos.'
      );
    }
    Object.assign(this, {
      repositorioUsuarios,
      autoridadReservasJerarquicas,
      fronteraTransaccional,
      resolutorScopeUsuario,
      servicioAutorizacion,
      ahora
    });
  }

  autorizar({ actorRealId, actorEfectivoId = actorRealId, sujeto } = {}) {
    if (typeof this.fronteraTransaccional?.ejecutar !== 'function') {
      throw new Error(
        'La autorización organizativa definitiva exige frontera transaccional.'
      );
    }
    return this.fronteraTransaccional.ejecutar((conexion) =>
      this.autorizarEnTransaccion(
        { actorRealId, actorEfectivoId, sujeto },
        { conexion }
      )
    );
  }

  async comprobarVistaPrevia({
    actorRealId,
    actorEfectivoId = actorRealId,
    sujeto
  } = {}) {
    if (typeof this.repositorioUsuarios?.buscarPorId !== 'function') {
      throw new Error('La vista previa exige lectura no bloqueante de usuarios.');
    }
    const realId = idPositivo(actorRealId, 'actorRealId');
    const efectivoId = idPositivo(actorEfectivoId, 'actorEfectivoId');
    const raiz = crearSujetoEliminacionAdministrativaOrganizacion({
      tipo: sujeto?.tipo,
      id: sujeto?.id,
      scope: sujeto?.scope
    });
    for (const usuarioId of ordenarIdsUnicos([realId, efectivoId])) {
      const usuario = await this.repositorioUsuarios.buscarPorId(usuarioId);
      const autoridad = construirAutoridadUsuarioEliminacionAdministrativa({
        usuario,
        resolutorScopeUsuario: this.resolutorScopeUsuario,
        autorizar: (contexto) => this.#puedeEliminarRaiz(contexto, raiz.tipo),
        crearError: () => noAutorizada()
      });
      if (!scopeCubre(autoridad.fotografia.scope, raiz.scope) ||
          perteneceARaiz(usuario, raiz)) {
        throw noAutorizada();
      }
    }
    return raiz;
  }

  async autorizarEnTransaccion(
    { actorRealId, actorEfectivoId = actorRealId, sujeto } = {},
    { conexion } = {}
  ) {
    const aceptacion = await this.autorizarAceptacionEnTransaccion(
      { actorRealId, actorEfectivoId, sujeto },
      { conexion }
    );
    return aceptacion.fotografiaAutorizacion;
  }

  async autorizarAceptacionEnTransaccion(
    {
      actorRealId,
      actorEfectivoId = actorRealId,
      sujeto,
      operacionPropietariaId = null
    } = {},
    { conexion } = {}
  ) {
    const raiz = await this.adquirirRaizEnTransaccion(
      { sujeto, operacionPropietariaId },
      { conexion }
    );
    const fotografiaAutorizacion = await this.autorizarActoresEnTransaccion(
      { actorRealId, actorEfectivoId, sujeto: raiz },
      { conexion }
    );
    return Object.freeze({ sujeto: raiz, fotografiaAutorizacion });
  }

  async adquirirRaizEnTransaccion(
    { sujeto, operacionPropietariaId = null } = {},
    { conexion } = {}
  ) {
    exigirConexion(conexion);
    const raiz = normalizarRaiz(sujeto);
    const resolucion = await adquirirAutoridad(
      this.autoridadReservasJerarquicas,
      raiz,
      conexion,
      operacionPropietariaId
    );
    const scopeRaiz = scopeDesdeResolucion(resolucion, raiz);
    return crearSujetoEliminacionAdministrativaOrganizacion({
      tipo: raiz.tipo,
      id: raiz.id,
      scope: scopeRaiz
    });
  }

  async autorizarActoresEnTransaccion(
    { actorRealId, actorEfectivoId = actorRealId, sujeto } = {},
    { conexion } = {}
  ) {
    exigirConexion(conexion);
    const realId = idPositivo(actorRealId, 'actorRealId');
    const efectivoId = idPositivo(actorEfectivoId, 'actorEfectivoId');
    const raiz = crearSujetoEliminacionAdministrativaOrganizacion(sujeto);
    const autoridades = new Map();
    for (const usuarioId of ordenarIdsUnicos([realId, efectivoId])) {
      const usuario = await this.repositorioUsuarios.buscarPorIdEnTransaccion(
        usuarioId,
        { conexion, forUpdate: true }
      );
      const autoridad = construirAutoridadUsuarioEliminacionAdministrativa({
        usuario,
        resolutorScopeUsuario: this.resolutorScopeUsuario,
        autorizar: (contexto) => this.#puedeEliminarRaiz(contexto, raiz.tipo),
        crearError: () => noAutorizada()
      });
      if (!scopeCubre(autoridad.fotografia.scope, raiz.scope)) throw noAutorizada();
      if (perteneceARaiz(usuario, raiz)) {
        throw new ErrorAutorizacionEliminacionAdministrativaOrganizacion(
          'organizacion_eliminacion_actor_incluido'
        );
      }
      autoridades.set(usuarioId, autoridad);
    }
    return crearFotografiaAutorizacionEliminacionOrganizacion({
      perfil: PERFIL_FOTOGRAFIA_AUTORIZACION_ELIMINACION_ORGANIZACION,
      version: 1,
      decision: 'autorizada',
      aceptadaEnUtc: instanteUtc(this.ahora()),
      actorReal: autoridades.get(realId).fotografia,
      actorEfectivo: autoridades.get(efectivoId).fotografia,
      destinatarioUsuarioId: realId
    });
  }

  #puedeEliminarRaiz(contexto, tipo) {
    return this.servicioAutorizacion.puedeEliminarAgentes(contexto) &&
      this.servicioAutorizacion[PERMISOS_POR_TIPO[tipo]](contexto);
  }
}

async function adquirirAutoridad(
  autoridad,
  raiz,
  conexion,
  operacionPropietariaId = null
) {
  const entrada = {
    recursos: [{ tipoRecurso: raiz.tipo, recursoId: raiz.id }],
    ...(operacionPropietariaId
      ? { operacionPropietariaId: String(operacionPropietariaId) }
      : {})
  };
  for (let intento = 0; intento < 2; intento += 1) {
    try {
      return await autoridad.exigirDisponibilidadEnTransaccion(entrada, { conexion });
    } catch (error) {
      if (error?.codigo === 'ruta_reserva_jerarquica_modificada' && intento === 0) {
        continue;
      }
      if (error?.codigo === 'operacion_en_curso') {
        throw new ErrorAutorizacionEliminacionAdministrativaOrganizacion(
          'organizacion_eliminacion_operacion_en_curso'
        );
      }
      if (error?.codigo === 'recurso_reserva_jerarquica_ausente') {
        throw noAutorizada();
      }
      throw error;
    }
  }
  throw noAutorizada();
}

function scopeDesdeResolucion(resolucion, raiz) {
  const ruta = resolucion?.rutas?.find(({ recurso }) =>
    recurso.tipoRecurso === raiz.tipo && recurso.recursoId === raiz.id
  );
  if (!ruta) throw noAutorizada();
  const scope = Object.freeze({
    nivel: raiz.tipo,
    tenantId: idOpcional(ruta.tenantId, 'ruta.tenantId'),
    empresaId: idOpcional(ruta.empresaId, 'ruta.empresaId'),
    sitioId: idOpcional(ruta.sitioId, 'ruta.sitioId')
  });
  const identidad = { tenant: scope.tenantId, empresa: scope.empresaId, sitio: scope.sitioId };
  if (identidad[raiz.tipo] !== raiz.id) throw noAutorizada();
  return scope;
}

function scopeCubre(superior, objetivo) {
  const profundidad = { portal: 0, tenant: 1, empresa: 2, sitio: 3 };
  if (!(superior?.nivel in profundidad) ||
      profundidad[superior.nivel] > profundidad[objetivo.nivel]) return false;
  return ['tenantId', 'empresaId', 'sitioId'].every((campo) =>
    superior[campo] === null || superior[campo] === objetivo[campo]
  );
}

function perteneceARaiz(usuario, raiz) {
  const campos = { tenant: 'tenantId', empresa: 'empresaId', sitio: 'sitioId' };
  return String(usuario?.[campos[raiz.tipo]] ?? '') === raiz.id;
}

function normalizarRaiz(sujeto) {
  const tipo = String(sujeto?.tipo ?? '');
  if (!TIPOS.has(tipo)) throw new TypeError('sujeto.tipo no es una raíz organizativa.');
  return Object.freeze({ tipo, id: idPositivo(sujeto?.id, 'sujeto.id') });
}

function ordenarIdsUnicos(ids) {
  return [...new Set(ids)].sort((a, b) => {
    const izquierda = BigInt(a);
    const derecha = BigInt(b);
    return izquierda < derecha ? -1 : izquierda > derecha ? 1 : 0;
  });
}

function exigirConexion(conexion) {
  if (typeof conexion?.execute !== 'function') {
    throw new Error('La autorización organizativa exige conexión transaccional.');
  }
}

function idPositivo(valor, campo) {
  const texto = String(valor ?? '').trim();
  if (!/^[1-9][0-9]*$/u.test(texto)) {
    throw new TypeError(`${campo} debe ser una identidad decimal positiva.`);
  }
  return texto;
}

function idOpcional(valor, campo) {
  return valor == null ? null : idPositivo(valor, campo);
}

function instanteUtc(valor) {
  const fecha = valor instanceof Date ? valor : new Date(valor);
  if (Number.isNaN(fecha.getTime())) {
    throw new TypeError('El reloj de aceptación no devolvió un instante válido.');
  }
  return fecha.toISOString();
}

function noAutorizada() {
  return new ErrorAutorizacionEliminacionAdministrativaOrganizacion();
}

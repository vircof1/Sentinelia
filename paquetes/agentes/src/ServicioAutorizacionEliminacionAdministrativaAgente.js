import { ResolutorScopeUsuario } from '../../contexto-usuario/src/ResolutorScopeUsuario.js';
import {
  PERFIL_FOTOGRAFIA_AUTORIZACION_ELIMINACION_AGENTE,
  crearFotografiaAutorizacionEliminacionAgente
} from './ContratoEliminacionAdministrativaAgente.js';
import { PoliticaPermisosAgentes } from './PoliticaPermisosAgentes.js';
import {
  construirAutoridadUsuarioEliminacionAdministrativa
} from './AutoridadUsuarioEliminacionAdministrativa.js';

export class ErrorAutorizacionEliminacionAdministrativaAgente extends Error {
  constructor() {
    super('No existe un agente eliminable dentro del alcance autorizado.');
    this.name = 'ErrorAutorizacionEliminacionAdministrativaAgente';
    this.codigo = 'agente_eliminacion_no_autorizada';
    this.codigoHttp = 404;
  }
}

export class ServicioAutorizacionEliminacionAdministrativaAgente {
  constructor({
    repositorioUsuarios,
    repositorioAgentes,
    fronteraTransaccional = null,
    resolutorScopeUsuario = new ResolutorScopeUsuario(),
    politicaPermisosAgentes = new PoliticaPermisosAgentes(),
    ahora = () => new Date()
  } = {}) {
    if (
      typeof repositorioUsuarios?.buscarPorIdEnTransaccion !== 'function' ||
      typeof repositorioAgentes?.buscarPorIdConConexion !== 'function' ||
      typeof resolutorScopeUsuario?.resolverNivelScope !== 'function' ||
      typeof politicaPermisosAgentes?.puedeEliminar !== 'function' ||
      typeof politicaPermisosAgentes?.puedeAlcanzarAgente !== 'function' ||
      typeof ahora !== 'function'
    ) {
      throw new Error(
        'La autorización de eliminación de agentes requiere todos sus puertos.'
      );
    }

    this.repositorioUsuarios = repositorioUsuarios;
    this.repositorioAgentes = repositorioAgentes;
    this.fronteraTransaccional = fronteraTransaccional;
    this.resolutorScopeUsuario = resolutorScopeUsuario;
    this.politicaPermisosAgentes = politicaPermisosAgentes;
    this.ahora = ahora;
  }

  async autorizar({ actorRealId, actorEfectivoId = actorRealId, agenteId } = {}) {
    if (typeof this.fronteraTransaccional?.ejecutar !== 'function') {
      throw new Error(
        'La autorización definitiva de eliminación exige una frontera transaccional.'
      );
    }

    return this.fronteraTransaccional.ejecutar((conexion) =>
      this.autorizarEnTransaccion(
        { actorRealId, actorEfectivoId, agenteId },
        { conexion }
      )
    );
  }

  async autorizarEnTransaccion(
    { actorRealId, actorEfectivoId = actorRealId, agenteId } = {},
    { conexion } = {}
  ) {
    exigirConexionTransaccional(conexion);
    const realId = normalizarId(actorRealId, 'actorRealId');
    const efectivoId = normalizarId(actorEfectivoId, 'actorEfectivoId');
    const sujetoId = normalizarId(agenteId, 'agenteId');
    const usuarios = new Map();

    for (const usuarioId of ordenarIdsUnicos([realId, efectivoId])) {
      const usuario = await this.repositorioUsuarios.buscarPorIdEnTransaccion(
        usuarioId,
        { conexion, forUpdate: true }
      );
      if (!usuario) {
        throw new ErrorAutorizacionEliminacionAdministrativaAgente();
      }
      usuarios.set(usuarioId, usuario);
    }

    const autoridades = new Map();
    for (const usuarioId of ordenarIdsUnicos([realId, efectivoId])) {
      autoridades.set(
        usuarioId,
        this.construirAutoridadUsuario(usuarios.get(usuarioId))
      );
    }

    const agente = await this.repositorioAgentes.buscarPorIdConConexion(
      sujetoId,
      { conexion }
    );
    if (!agente) {
      throw new ErrorAutorizacionEliminacionAdministrativaAgente();
    }

    for (const usuarioId of ordenarIdsUnicos([realId, efectivoId])) {
      if (!this.politicaPermisosAgentes.puedeAlcanzarAgente(
        autoridades.get(usuarioId).contexto,
        agente
      )) {
        throw new ErrorAutorizacionEliminacionAdministrativaAgente();
      }
    }

    return crearFotografiaAutorizacionEliminacionAgente({
      perfil: PERFIL_FOTOGRAFIA_AUTORIZACION_ELIMINACION_AGENTE,
      version: 1,
      decision: 'autorizada',
      aceptadaEnUtc: normalizarInstanteUtc(this.ahora()),
      actorReal: autoridades.get(realId).fotografia,
      actorEfectivo: autoridades.get(efectivoId).fotografia,
      destinatarioUsuarioId: realId
    });
  }

  construirAutoridadUsuario(usuario) {
    return construirAutoridadUsuarioEliminacionAdministrativa({
      usuario,
      resolutorScopeUsuario: this.resolutorScopeUsuario,
      autorizar: (contexto) => this.politicaPermisosAgentes.puedeEliminar(contexto),
      crearError: () => new ErrorAutorizacionEliminacionAdministrativaAgente()
    });
  }
}

function exigirConexionTransaccional(conexion) {
  if (typeof conexion?.execute !== 'function') {
    throw new Error(
      'La autorización definitiva de eliminación exige una conexión transaccional.'
    );
  }
}

function normalizarId(valor, campo) {
  const texto = String(valor ?? '').trim();
  if (!/^[1-9][0-9]*$/u.test(texto)) {
    throw new TypeError(`${campo} debe ser una identidad decimal positiva.`);
  }
  return texto;
}


function ordenarIdsUnicos(ids) {
  return [...new Set(ids)].sort((a, b) => {
    const izquierda = BigInt(a);
    const derecha = BigInt(b);
    return izquierda < derecha ? -1 : izquierda > derecha ? 1 : 0;
  });
}

function normalizarInstanteUtc(valor) {
  const fecha = valor instanceof Date ? valor : new Date(valor);
  if (Number.isNaN(fecha.getTime())) {
    throw new TypeError('El reloj de aceptación no devolvió un instante válido.');
  }
  return fecha.toISOString();
}

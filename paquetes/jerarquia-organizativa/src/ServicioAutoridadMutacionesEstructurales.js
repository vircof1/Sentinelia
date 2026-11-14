import { uuidV7AuditoriaABytes } from '../../auditoria/src/UuidV7Auditoria.js';
import {
  crearComandoEliminacionAdministrativaOrganizacion
} from './ContratoEliminacionAdministrativaOrganizacion.js';

export class ErrorAutoridadMutacionEstructural extends Error {
  constructor(codigo, mensaje, { causa = null } = {}) {
    super(mensaje, causa ? { cause: causa } : undefined);
    this.name = 'ErrorAutoridadMutacionEstructural';
    this.codigo = codigo;
  }
}

export class ServicioAutoridadMutacionesEstructurales {
  constructor({ autoridadReservasJerarquicas } = {}) {
    if (typeof autoridadReservasJerarquicas?.bloquearYResolverEnTransaccion !==
        'function') {
      throw new Error('Las mutaciones estructurales exigen autoridad jerárquica.');
    }
    this.autoridadReservasJerarquicas = autoridadReservasJerarquicas;
  }

  async serializarAltaEnTransaccion({ scopePadre } = {}, { conexion } = {}) {
    const scope = normalizarScope(scopePadre, 'scopePadre');
    const padre = recursoDeScope(scope);
    if (!padre) return Object.freeze({ rutas: [], reclamos: [] });
    const resolucion = await resolverAutoridadEstable(
      this.autoridadReservasJerarquicas,
      [padre],
      conexion
    );
    exigirRutaEsperada(resolucion.rutas, padre, scope, 'padre');
    return resolucion;
  }

  async autorizarMovimientoUsuarioEnTransaccion(
    { usuarioId, scopeOrigen, scopeDestino } = {},
    { conexion } = {}
  ) {
    const id = idPositivo(usuarioId, 'usuarioId');
    const origen = normalizarScope(scopeOrigen, 'scopeOrigen');
    const destino = normalizarScope(scopeDestino, 'scopeDestino');
    const objetivos = [
      { recurso: recursoDeScope(origen), scope: origen },
      { recurso: recursoDeScope(destino), scope: destino }
    ].filter(({ recurso }) => Boolean(recurso));
    const recursos = recursosUnicos(objetivos.map(({ recurso }) => recurso));
    const resolucion = recursos.length === 0
      ? Object.freeze({ rutas: [], reclamos: [] })
      : await resolverAutoridadEstable(
          this.autoridadReservasJerarquicas,
          recursos,
          conexion
        );
    for (const { recurso, scope } of objetivos) {
      exigirRutaEsperada(resolucion.rutas, recurso, scope, 'movimiento');
    }
    await exigirActorNoIntroducido({ conexion, resolucion, id, origen, destino });
    const usuario = await bloquearUsuario(conexion, id);
    if (!usuario || !scopeFilaIgual(usuario, origen)) {
      throw new ErrorAutoridadMutacionEstructural(
        'movimiento_usuario_origen_modificado',
        'El usuario cambió de scope antes de completar el movimiento.'
      );
    }
    return Object.freeze({ resolucion, usuario: Object.freeze({ ...usuario }) });
  }
}

async function exigirActorNoIntroducido({ conexion, resolucion, id, origen, destino }) {
  const origenClaves = clavesAncestros(origen);
  const destinoNuevos = clavesAncestros(destino);
  for (const clave of origenClaves) destinoNuevos.delete(clave);
  const operaciones = [...new Set(
    resolucion.reclamos
      .filter(({ recurso }) => destinoNuevos.has(claveRecurso(recurso)))
      .map(({ operacionId }) => operacionId)
  )];
  for (const operacionId of operaciones) {
    const comando = await cargarComandoOrganizativo(conexion, operacionId);
    const actores = [
      comando.fotografiaAutorizacion.actorReal.usuarioId,
      comando.fotografiaAutorizacion.actorEfectivo.usuarioId
    ].map(String);
    if (actores.includes(id)) {
      throw new ErrorAutoridadMutacionEstructural(
        'operacion_en_curso',
        'El usuario es actor de una eliminación que reserva el scope de destino.'
      );
    }
  }
}

async function cargarComandoOrganizativo(conexion, operacionId) {
  const [filas] = await conexion.execute(
    `SELECT comando_canonico
       FROM operaciones_administrativas
      WHERE operacion_id=? AND tipo='eliminar_organizacion'`,
    [uuidV7AuditoriaABytes(operacionId)]
  );
  if (!filas[0]) throw conflicto('La reserva pertenece a una operación incompatible.');
  try {
    return crearComandoEliminacionAdministrativaOrganizacion(
      json(filas[0].comando_canonico)
    );
  } catch (error) {
    throw new ErrorAutoridadMutacionEstructural(
      'operacion_en_curso',
      'La reserva no conserva una intención organizativa válida.',
      { causa: error }
    );
  }
}

async function bloquearUsuario(conexion, usuarioId) {
  const [filas] = await conexion.execute(
    `SELECT CAST(id AS CHAR) id,CAST(tenant_id AS CHAR) tenant_id,
            CAST(empresa_id AS CHAR) empresa_id,CAST(sitio_id AS CHAR) sitio_id
       FROM usuarios WHERE id=? FOR UPDATE`,
    [usuarioId]
  );
  return filas[0] || null;
}

async function resolverAutoridadEstable(autoridad, recursos, conexion) {
  try {
    return await autoridad.bloquearYResolverEnTransaccion(
      { recursos },
      { conexion }
    );
  } catch (error) {
    if (error?.codigo !== 'ruta_reserva_jerarquica_modificada') throw error;
    return autoridad.bloquearYResolverEnTransaccion({ recursos }, { conexion });
  }
}

function exigirRutaEsperada(rutas, recurso, scope, contexto) {
  const ruta = rutas.find(({ recurso: actual }) =>
    claveRecurso(actual) === claveRecurso(recurso)
  );
  if (!ruta || !rutaIgual(ruta, scope)) {
    throw new ErrorAutoridadMutacionEstructural(
      `ruta_${contexto}_modificada`,
      'La jerarquía estructural cambió durante la adquisición de autoridad.'
    );
  }
}

function normalizarScope(scope, campo) {
  const tenantId = idOpcional(scope?.tenantId, `${campo}.tenantId`);
  const empresaId = idOpcional(scope?.empresaId, `${campo}.empresaId`);
  const sitioId = idOpcional(scope?.sitioId, `${campo}.sitioId`);
  if ((empresaId && !tenantId) || (sitioId && !empresaId)) {
    throw new TypeError(`${campo} no forma una jerarquía completa.`);
  }
  return Object.freeze({ tenantId, empresaId, sitioId });
}

function recursoDeScope(scope) {
  if (!scope) return null;
  if (scope.sitioId) return recurso('sitio', scope.sitioId);
  if (scope.empresaId) return recurso('empresa', scope.empresaId);
  if (scope.tenantId) return recurso('tenant', scope.tenantId);
  return null;
}

function clavesAncestros(scope) {
  return new Set([
    scope.tenantId && `tenant:${scope.tenantId}`,
    scope.empresaId && `empresa:${scope.empresaId}`,
    scope.sitioId && `sitio:${scope.sitioId}`
  ].filter(Boolean));
}

function rutaIgual(ruta, scope) {
  return ruta.tenantId === scope.tenantId &&
    ruta.empresaId === scope.empresaId && ruta.sitioId === scope.sitioId;
}

function scopeFilaIgual(fila, scope) {
  return nuloOTexto(fila.tenant_id) === scope.tenantId &&
    nuloOTexto(fila.empresa_id) === scope.empresaId &&
    nuloOTexto(fila.sitio_id) === scope.sitioId;
}

function recursosUnicos(recursos) {
  return [...new Map(recursos.map((actual) => [claveRecurso(actual), actual])).values()];
}

function recurso(tipoRecurso, recursoId) {
  return Object.freeze({ tipoRecurso, recursoId: String(recursoId) });
}

function claveRecurso(actual) {
  if (!actual) return '';
  return `${actual.tipoRecurso}:${actual.recursoId}`;
}

function idOpcional(valor, campo) {
  return valor == null || String(valor).trim() === ''
    ? null
    : idPositivo(valor, campo);
}

function idPositivo(valor, campo) {
  const texto = String(valor ?? '');
  if (!/^[1-9][0-9]*$/u.test(texto)) {
    throw new TypeError(`${campo} debe ser una identidad decimal positiva.`);
  }
  return texto;
}

function nuloOTexto(valor) {
  return valor == null ? null : String(valor);
}

function json(valor) {
  if (Buffer.isBuffer(valor)) return JSON.parse(valor.toString('utf8'));
  if (typeof valor === 'string') return JSON.parse(valor);
  return valor;
}

function conflicto(mensaje) {
  return new ErrorAutoridadMutacionEstructural('operacion_en_curso', mensaje);
}

import { uuidV7AuditoriaABytes } from '../../auditoria/src/UuidV7Auditoria.js';
import {
  crearComandoEliminacionAdministrativaAgente
} from './ContratoEliminacionAdministrativaAgente.js';

export class ErrorAutoridadMovimientoAgente extends Error {
  constructor(codigo, mensaje, { causa = null } = {}) {
    super(mensaje, causa ? { cause: causa } : undefined);
    this.name = 'ErrorAutoridadMovimientoAgente';
    this.codigo = codigo;
  }
}

export class ServicioAutoridadMovimientoAgente {
  constructor({ autoridadReservasJerarquicas } = {}) {
    if (typeof autoridadReservasJerarquicas?.bloquearYResolverEnTransaccion !==
        'function') {
      throw new Error('El movimiento de agente exige autoridad jerárquica.');
    }
    this.autoridadReservasJerarquicas = autoridadReservasJerarquicas;
  }

  async autorizarEnTransaccion(
    { agenteId, scopeOrigen, scopeDestino } = {},
    { conexion } = {}
  ) {
    const movimiento = normalizarMovimiento({ agenteId, scopeOrigen, scopeDestino });
    const resolucion = await resolverAutoridadEstable(
      this.autoridadReservasJerarquicas,
      [movimiento.raiz, recurso('sitio', movimiento.destino.sitioId)],
      conexion
    );
    exigirRutasEsperadas(resolucion.rutas, movimiento);
    exigirSinSolapeNuevo(resolucion.reclamos, movimiento);

    const reclamoAgente = resolucion.reclamos.find(({ recurso: reclamado }) =>
      reclamado.tipoRecurso === 'agente' &&
      reclamado.recursoId === movimiento.raiz.recursoId
    );
    if (reclamoAgente) {
      const comando = await cargarComandoPropietario(
        conexion,
        reclamoAgente.operacionId
      );
      if (comando.sujeto.id !== movimiento.raiz.recursoId) {
        throw conflicto('La reserva exacta no identifica el agente movido.');
      }
      for (const actor of [
        comando.fotografiaAutorizacion.actorReal,
        comando.fotografiaAutorizacion.actorEfectivo
      ]) {
        if (!scopeCubre(actor.scope, { nivel: 'sitio', ...movimiento.destino })) {
          throw conflicto(
            'La autoridad aceptada para eliminar el agente no cubre su destino.'
          );
        }
      }
    }

    const agente = await bloquearAgente(conexion, movimiento.raiz.recursoId);
    if (!agente || !scopeFilaIgual(agente, movimiento.origen)) {
      throw new ErrorAutoridadMovimientoAgente(
        'movimiento_agente_origen_modificado',
        'El agente cambió de scope antes de completar el movimiento.'
      );
    }
    return Object.freeze({ resolucion, agente: Object.freeze({ ...agente }) });
  }
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

function exigirRutasEsperadas(rutas, movimiento) {
  const rutaAgente = buscarRuta(rutas, movimiento.raiz);
  const rutaDestino = buscarRuta(rutas, recurso('sitio', movimiento.destino.sitioId));
  if (!rutaAgente || !rutaIgual(rutaAgente, movimiento.origen)) {
    throw new ErrorAutoridadMovimientoAgente(
      'movimiento_agente_origen_modificado',
      'La ascendencia actual del agente ya no coincide con la observada.'
    );
  }
  if (!rutaDestino || !rutaIgual(rutaDestino, movimiento.destino)) {
    throw new ErrorAutoridadMovimientoAgente(
      'movimiento_agente_destino_modificado',
      'El sitio de destino cambió de ascendencia durante el movimiento.'
    );
  }
}

function exigirSinSolapeNuevo(reclamos, movimiento) {
  const origen = clavesAncestros(movimiento.origen);
  const destino = clavesAncestros(movimiento.destino);
  const propietariosDestino = new Set();
  const propietariosAgente = new Set();
  for (const reclamo of reclamos) {
    const clave = claveRecurso(reclamo.recurso);
    if (destino.has(clave)) propietariosDestino.add(reclamo.operacionId);
    else if (!origen.has(clave)) propietariosAgente.add(reclamo.operacionId);
  }
  if (propietariosDestino.size > 1) {
    throw conflicto('El destino conserva reservas destructivas incompatibles.');
  }
  for (const propietarioDestino of propietariosDestino) {
    if ([...propietariosAgente].some((propietario) =>
      propietario !== propietarioDestino
    )) {
      throw conflicto(
        'El destino cubriría una reserva de agente perteneciente a otra operación.'
      );
    }
  }
}

async function cargarComandoPropietario(conexion, operacionId) {
  const [filas] = await conexion.execute(
    `SELECT comando_canonico
       FROM operaciones_administrativas
      WHERE operacion_id=? AND tipo='eliminar_agente'`,
    [uuidV7AuditoriaABytes(operacionId)]
  );
  if (!filas[0]) throw conflicto('La reserva exacta pertenece a otra operación.');
  try {
    return crearComandoEliminacionAdministrativaAgente(
      json(filas[0].comando_canonico)
    );
  } catch (error) {
    throw new ErrorAutoridadMovimientoAgente(
      'operacion_en_curso',
      'La reserva no conserva una intención de agente válida.',
      { causa: error }
    );
  }
}

async function bloquearAgente(conexion, agenteId) {
  const [filas] = await conexion.execute(
    `SELECT CAST(id AS CHAR) id,CAST(tenant_id AS CHAR) tenant_id,
            CAST(empresa_id AS CHAR) empresa_id,CAST(sitio_id AS CHAR) sitio_id
       FROM agentes_sentinelia WHERE id=? FOR UPDATE`,
    [agenteId]
  );
  return filas[0] || null;
}

function normalizarMovimiento({ agenteId, scopeOrigen, scopeDestino }) {
  return Object.freeze({
    raiz: recurso('agente', idPositivo(agenteId, 'agenteId')),
    origen: normalizarScope(scopeOrigen, 'scopeOrigen'),
    destino: normalizarScope(scopeDestino, 'scopeDestino')
  });
}

function normalizarScope(scope, campo) {
  return Object.freeze({
    tenantId: idPositivo(scope?.tenantId, `${campo}.tenantId`),
    empresaId: idPositivo(scope?.empresaId, `${campo}.empresaId`),
    sitioId: idPositivo(scope?.sitioId, `${campo}.sitioId`)
  });
}

function clavesAncestros(scope) {
  return new Set([
    `tenant:${scope.tenantId}`,
    `empresa:${scope.empresaId}`,
    `sitio:${scope.sitioId}`
  ]);
}

function buscarRuta(rutas, buscado) {
  return rutas.find(({ recurso: actual }) =>
    actual.tipoRecurso === buscado.tipoRecurso &&
    actual.recursoId === buscado.recursoId
  );
}

function rutaIgual(ruta, scope) {
  return ruta.tenantId === scope.tenantId &&
    ruta.empresaId === scope.empresaId && ruta.sitioId === scope.sitioId;
}

function scopeFilaIgual(fila, scope) {
  return String(fila.tenant_id) === scope.tenantId &&
    String(fila.empresa_id) === scope.empresaId &&
    String(fila.sitio_id) === scope.sitioId;
}

function scopeCubre(superior, objetivo) {
  const profundidad = { portal: 0, tenant: 1, empresa: 2, sitio: 3 };
  if (!(superior?.nivel in profundidad) ||
      profundidad[superior.nivel] > profundidad[objetivo.nivel]) return false;
  return ['tenantId', 'empresaId', 'sitioId'].every((campo) =>
    superior[campo] === null || superior[campo] === objetivo[campo]
  );
}

function recurso(tipoRecurso, recursoId) {
  return Object.freeze({ tipoRecurso, recursoId: String(recursoId) });
}

function claveRecurso(actual) {
  return `${actual.tipoRecurso}:${actual.recursoId}`;
}

function idPositivo(valor, campo) {
  const texto = String(valor ?? '');
  if (!/^[1-9][0-9]*$/u.test(texto)) {
    throw new TypeError(`${campo} debe ser una identidad decimal positiva.`);
  }
  return texto;
}

function json(valor) {
  if (Buffer.isBuffer(valor)) return JSON.parse(valor.toString('utf8'));
  if (typeof valor === 'string') return JSON.parse(valor);
  return valor;
}

function conflicto(mensaje) {
  return new ErrorAutoridadMovimientoAgente('operacion_en_curso', mensaje);
}

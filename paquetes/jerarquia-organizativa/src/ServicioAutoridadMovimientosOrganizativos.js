import { uuidV7AuditoriaABytes } from '../../auditoria/src/UuidV7Auditoria.js';
import {
  crearComandoEliminacionAdministrativaOrganizacion
} from './ContratoEliminacionAdministrativaOrganizacion.js';

export class ErrorAutoridadMovimientoOrganizativo extends Error {
  constructor(codigo, mensaje, { causa = null } = {}) {
    super(mensaje, causa ? { cause: causa } : undefined);
    this.name = 'ErrorAutoridadMovimientoOrganizativo';
    this.codigo = codigo;
  }
}

export class ServicioAutoridadMovimientosOrganizativos {
  constructor({ autoridadReservasJerarquicas } = {}) {
    if (typeof autoridadReservasJerarquicas?.bloquearYResolverEnTransaccion !==
        'function') {
      throw new Error('Los movimientos exigen la autoridad común de reservas.');
    }
    this.autoridadReservasJerarquicas = autoridadReservasJerarquicas;
  }

  async autorizarEnTransaccion(
    { entidad, datos } = {},
    { conexion } = {}
  ) {
    const movimiento = normalizarMovimiento(entidad, datos);
    const resolucion = await resolverAutoridadEstable(
      this.autoridadReservasJerarquicas,
      movimiento.recursos,
      conexion
    );
    exigirSinSolapeNuevo(movimiento, resolucion.reclamos);
    if (resolucion.reclamos.length === 0) return resolucion;

    const reclamoRaiz = resolucion.reclamos.find(({ recurso }) =>
      recurso.tipoRecurso === movimiento.raiz.tipoRecurso &&
      recurso.recursoId === movimiento.raiz.recursoId
    );
    if (!reclamoRaiz) return resolucion;

    const comando = await cargarComandoPropietario(
      conexion,
      reclamoRaiz.operacionId
    );
    if (
      comando.sujeto.tipo !== movimiento.raiz.tipoRecurso ||
      comando.sujeto.id !== movimiento.raiz.recursoId
    ) {
      throw conflicto('La reserva exacta no identifica la raíz que pretende moverse.');
    }
    for (const actor of [
      comando.fotografiaAutorizacion.actorReal,
      comando.fotografiaAutorizacion.actorEfectivo
    ]) {
      if (!scopeCubre(actor.scope, movimiento.scopeDestino)) {
        throw conflicto(
          'La autoridad aceptada de la reserva no cubre el destino del movimiento.'
        );
      }
    }

    const actores = await bloquearActores(
      conexion,
      [
        comando.fotografiaAutorizacion.actorReal.usuarioId,
        comando.fotografiaAutorizacion.actorEfectivo.usuarioId
      ]
    );
    if (actores.some((actor) => perteneceARaiz(actor, movimiento.raiz))) {
      throw conflicto(
        'El movimiento no puede introducir a uno de sus actores en la raíz reservada.'
      );
    }
    return resolucion;
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

async function cargarComandoPropietario(conexion, operacionId) {
  const [filas] = await conexion.execute(
    `SELECT comando_canonico
       FROM operaciones_administrativas
      WHERE operacion_id=? AND tipo='eliminar_organizacion'`,
    [uuidV7AuditoriaABytes(operacionId)]
  );
  if (!filas[0]) {
    throw conflicto('La reserva pertenece a una operación incompatible.');
  }
  try {
    return crearComandoEliminacionAdministrativaOrganizacion(
      json(filas[0].comando_canonico)
    );
  } catch (error) {
    throw new ErrorAutoridadMovimientoOrganizativo(
      'operacion_en_curso',
      'La reserva no conserva una intención organizativa válida.',
      { causa: error }
    );
  }
}

async function bloquearActores(conexion, entrada) {
  const ids = ordenarIds(entrada.map((id) => idPositivo(id, 'actorId')));
  const [filas] = await conexion.execute(
    `SELECT CAST(id AS CHAR) id,CAST(tenant_id AS CHAR) tenant_id,
            CAST(empresa_id AS CHAR) empresa_id,CAST(sitio_id AS CHAR) sitio_id
       FROM usuarios WHERE id IN (${ids.map(() => '?').join(',')})
      ORDER BY id FOR UPDATE`,
    ids
  );
  return filas;
}

function normalizarMovimiento(entidad, datos = {}) {
  if (entidad === 'empresa') {
    const id = idPositivo(datos.idEmpresa, 'idEmpresa');
    const tenantOrigenId = idPositivo(datos.tenantOrigenId, 'tenantOrigenId');
    const tenantDestinoId = idPositivo(datos.tenantDestinoId, 'tenantDestinoId');
    return {
      raiz: recurso('empresa', id),
      recursos: [recurso('empresa', id), recurso('tenant', tenantDestinoId)],
      ancestrosOrigen: [recurso('tenant', tenantOrigenId)],
      ancestrosDestino: [recurso('tenant', tenantDestinoId)],
      scopeDestino: {
        nivel: 'empresa', tenantId: tenantDestinoId, empresaId: id, sitioId: null
      }
    };
  }
  if (entidad === 'sitio') {
    const id = idPositivo(datos.idSitio, 'idSitio');
    const tenantOrigenId = idPositivo(datos.tenantOrigenId, 'tenantOrigenId');
    const empresaOrigenId = idPositivo(datos.empresaOrigenId, 'empresaOrigenId');
    const tenantDestinoId = idPositivo(datos.tenantDestinoId, 'tenantDestinoId');
    const empresaDestinoId = idPositivo(datos.empresaDestinoId, 'empresaDestinoId');
    return {
      raiz: recurso('sitio', id),
      recursos: [recurso('sitio', id), recurso('empresa', empresaDestinoId)],
      ancestrosOrigen: [
        recurso('tenant', tenantOrigenId),
        recurso('empresa', empresaOrigenId)
      ],
      ancestrosDestino: [
        recurso('tenant', tenantDestinoId),
        recurso('empresa', empresaDestinoId)
      ],
      scopeDestino: {
        nivel: 'sitio', tenantId: tenantDestinoId,
        empresaId: empresaDestinoId, sitioId: id
      }
    };
  }
  throw new TypeError('El movimiento solo admite empresa o sitio.');
}

function exigirSinSolapeNuevo(movimiento, reclamos) {
  const clavesDestino = new Set(
    movimiento.ancestrosDestino.map(({ tipoRecurso, recursoId }) =>
      `${tipoRecurso}:${recursoId}`
    )
  );
  const clavesOrigen = new Set(
    movimiento.ancestrosOrigen.map(({ tipoRecurso, recursoId }) =>
      `${tipoRecurso}:${recursoId}`
    )
  );
  const propietariosDestino = new Set();
  const propietariosAgregado = new Set();
  for (const reclamo of reclamos) {
    const clave = `${reclamo.recurso.tipoRecurso}:${reclamo.recurso.recursoId}`;
    if (clavesDestino.has(clave)) propietariosDestino.add(reclamo.operacionId);
    else if (!clavesOrigen.has(clave)) propietariosAgregado.add(reclamo.operacionId);
  }
  if (propietariosDestino.size > 1) {
    throw conflicto('El destino conserva reservas destructivas incompatibles.');
  }
  for (const propietarioDestino of propietariosDestino) {
    if ([...propietariosAgregado].some((propietario) =>
      propietario !== propietarioDestino
    )) {
      throw conflicto(
        'El movimiento uniría reservas destructivas de propietarios distintos.'
      );
    }
  }
}

function scopeCubre(superior, objetivo) {
  const profundidad = { portal: 0, tenant: 1, empresa: 2, sitio: 3 };
  if (!(superior?.nivel in profundidad) ||
      profundidad[superior.nivel] > profundidad[objetivo.nivel]) return false;
  return ['tenantId', 'empresaId', 'sitioId'].every((campo) =>
    superior[campo] === null || superior[campo] === objetivo[campo]
  );
}

function perteneceARaiz(actor, raiz) {
  if (raiz.tipoRecurso === 'empresa') {
    return String(actor.empresa_id ?? '') === raiz.recursoId;
  }
  return String(actor.sitio_id ?? '') === raiz.recursoId;
}

function recurso(tipoRecurso, recursoId) {
  return Object.freeze({ tipoRecurso, recursoId: String(recursoId) });
}

function ordenarIds(ids) {
  return [...new Set(ids)].sort((a, b) => {
    const izquierda = BigInt(a);
    const derecha = BigInt(b);
    return izquierda < derecha ? -1 : izquierda > derecha ? 1 : 0;
  });
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
  return new ErrorAutoridadMovimientoOrganizativo('operacion_en_curso', mensaje);
}

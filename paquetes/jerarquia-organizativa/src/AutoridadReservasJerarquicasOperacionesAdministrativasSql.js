import {
  bytesAUuidV7Auditoria,
  uuidV7AuditoriaABytes
} from '../../auditoria/src/UuidV7Auditoria.js';
import { LeaseOperacionDurablePerdido }
  from '../../coordinacion-durable/src/CoordinadorOperacionesDurables.js';

export const ORDEN_BLOQUEO_RESERVAS_JERARQUICAS = Object.freeze([
  'tenant',
  'empresa',
  'sitio',
  'operacion',
  'reclamo'
]);

const TIPOS_RECURSO = new Set(['agente', 'tenant', 'empresa', 'sitio']);

export class ErrorAutoridadReservasJerarquicas extends Error {
  constructor(codigo, mensaje, { reintentable = false, solapes = [] } = {}) {
    super(mensaje);
    this.name = 'ErrorAutoridadReservasJerarquicas';
    this.codigo = codigo;
    this.reintentable = Boolean(reintentable);
    this.solapes = Object.freeze([...solapes]);
  }
}

export class AutoridadReservasJerarquicasOperacionesAdministrativasSql {
  constructor(clienteSql) {
    if (typeof clienteSql?.obtenerConexion !== 'function') {
      throw new Error('La autoridad de reservas jerárquicas exige ClienteSql.');
    }
    this.clienteSql = clienteSql;
  }

  async bloquearYResolverEnTransaccion(
    {
      recursos = [],
      operacionPropietariaId = null,
      leaseOperacionPropietaria = null
    } = {},
    { conexion } = {}
  ) {
    exigirConexion(conexion);
    await exigirTransaccionActiva(conexion);
    const candidatos = normalizarRecursos(recursos);
    const operacionPropietaria = operacionPropietariaId === null
      ? null
      : String(operacionPropietariaId);
    if (operacionPropietaria !== null) {
      uuidV7AuditoriaABytes(operacionPropietaria);
    }
    const leasePropietaria = leaseOperacionPropietaria === null
      ? null
      : normalizarLeasePropietaria(
          leaseOperacionPropietaria,
          operacionPropietaria
        );

    const rutasPreliminares = await resolverRutas(conexion, candidatos);
    const reclamosPreliminares = await buscarSolapes(
      conexion,
      rutasPreliminares
    );
    const reclamosOperacion = await buscarReclamosPorOperaciones(
      conexion,
      reclamosPreliminares.map(({ operacionId }) => operacionId)
    );
    const recursosReclamados = reclamosOperacion.map(({ recurso }) => recurso);
    const rutasReclamos = recursosReclamados.length === 0
      ? []
      : await resolverRutas(conexion, recursosReclamados);
    const rutasABloquear = unirRutas(rutasPreliminares, rutasReclamos);

    await bloquearJerarquia(conexion, rutasABloquear);
    await exigirRutasEstables(conexion, rutasABloquear);

    const reclamosTrasJerarquia = await buscarSolapes(
      conexion,
      rutasPreliminares
    );
    exigirReclamosContenidos(
      reclamosTrasJerarquia,
      reclamosPreliminares,
      'Apareció un reclamo solapado fuera de la ruta jerárquica bloqueada.'
    );
    await bloquearOperacionesYReclamos(
      conexion,
      reclamosTrasJerarquia,
      leasePropietaria
    );
    const reclamosFinales = await buscarSolapes(conexion, rutasPreliminares);
    exigirMismoConjuntoReclamos(reclamosFinales, reclamosTrasJerarquia);

    const propios = [];
    const ajenos = [];
    for (const reclamo of reclamosFinales) {
      (reclamo.operacionId === operacionPropietaria ? propios : ajenos)
        .push(reclamo);
    }
    return Object.freeze({
      disponible: ajenos.length === 0,
      rutas: congelarLista(rutasPreliminares),
      reclamos: congelarLista(reclamosFinales),
      reclamosPropios: congelarLista(propios),
      reclamosAjenos: congelarLista(ajenos),
      ordenBloqueo: ORDEN_BLOQUEO_RESERVAS_JERARQUICAS
    });
  }

  async exigirDisponibilidadEnTransaccion(entrada, opciones) {
    const resolucion = await this.bloquearYResolverEnTransaccion(
      entrada,
      opciones
    );
    if (!resolucion.disponible) {
      throw new ErrorAutoridadReservasJerarquicas(
        'operacion_en_curso',
        'Otro proceso administrativo conserva una reserva destructiva solapada.',
        { solapes: resolucion.reclamosAjenos }
      );
    }
    return resolucion;
  }
}

async function resolverRutas(conexion, recursos) {
  const rutas = [];
  for (const recurso of recursos) {
    const ruta = await resolverRuta(conexion, recurso);
    if (!ruta) {
      throw new ErrorAutoridadReservasJerarquicas(
        'recurso_reserva_jerarquica_ausente',
        `No existe el recurso ${recurso.tipoRecurso}:${recurso.recursoId}.`
      );
    }
    rutas.push(ruta);
  }
  return rutas;
}

async function resolverRuta(conexion, recurso) {
  const { tipoRecurso: tipo, recursoId: id } = recurso;
  const consultas = {
    tenant: `SELECT CAST(id AS CHAR) tenant_id,NULL empresa_id,
                    NULL sitio_id,NULL agente_id
               FROM tenants WHERE id=?`,
    empresa: `SELECT CAST(tenant_id AS CHAR) tenant_id,
                     CAST(id AS CHAR) empresa_id,NULL sitio_id,NULL agente_id
                FROM empresas WHERE id=?`,
    sitio: `SELECT CAST(tenant_id AS CHAR) tenant_id,
                   CAST(empresa_id AS CHAR) empresa_id,
                   CAST(id AS CHAR) sitio_id,NULL agente_id
              FROM sitios WHERE id=?`,
    agente: `SELECT CAST(tenant_id AS CHAR) tenant_id,
                    CAST(empresa_id AS CHAR) empresa_id,
                    CAST(sitio_id AS CHAR) sitio_id,
                    CAST(id AS CHAR) agente_id
               FROM agentes_sentinelia WHERE id=?`
  };
  const [filas] = await conexion.execute(consultas[tipo], [id]);
  if (!filas[0]) return null;
  return congelar({
    recurso,
    tenantId: String(filas[0].tenant_id),
    empresaId: nuloOTexto(filas[0].empresa_id),
    sitioId: nuloOTexto(filas[0].sitio_id),
    agenteId: nuloOTexto(filas[0].agente_id)
  });
}

async function bloquearJerarquia(conexion, rutas) {
  await bloquearIds(
    conexion,
    'tenants',
    rutas.map(({ tenantId }) => tenantId)
  );
  await bloquearIds(
    conexion,
    'empresas',
    rutas.map(({ empresaId }) => empresaId).filter(Boolean)
  );
  await bloquearIds(
    conexion,
    'sitios',
    rutas.map(({ sitioId }) => sitioId).filter(Boolean)
  );
}

async function bloquearIds(conexion, tabla, entrada) {
  const ids = ordenarIds(entrada);
  if (ids.length === 0) return;
  const [filas] = await conexion.execute(
    `SELECT CAST(id AS CHAR) id FROM ${tabla}
      WHERE id IN (${marcadores(ids)}) ORDER BY id FOR UPDATE`,
    ids
  );
  if (filas.length !== ids.length) {
    throw rutaModificada('Una fila de jerarquía desapareció durante el bloqueo.');
  }
}

async function exigirRutasEstables(conexion, esperadas) {
  const actuales = await resolverRutas(
    conexion,
    esperadas.map(({ recurso }) => recurso)
  );
  const porRecurso = new Map(actuales.map((ruta) => [claveRecurso(ruta.recurso), ruta]));
  for (const esperada of esperadas) {
    const actual = porRecurso.get(claveRecurso(esperada.recurso));
    if (!actual || claveRuta(actual) !== claveRuta(esperada)) {
      throw rutaModificada('El recurso cambió de ruta durante la adquisición de autoridad.');
    }
  }
}

async function buscarSolapes(conexion, rutas) {
  const { clausula, parametros } = construirFiltroSolapes(rutas);
  const [filas] = await conexion.execute(
    `SELECT r.operacion_id,r.tipo_recurso,CAST(r.recurso_id AS CHAR) recurso_id,
            o.tipo operacion_tipo,o.estado operacion_estado
       FROM recursos_operaciones_administrativas r
       INNER JOIN operaciones_administrativas o
         ON o.operacion_id=r.operacion_id
       LEFT JOIN empresas e
         ON r.tipo_recurso='empresa' AND e.id=r.recurso_id
       LEFT JOIN sitios s
         ON r.tipo_recurso='sitio' AND s.id=r.recurso_id
       LEFT JOIN agentes_sentinelia a
         ON r.tipo_recurso='agente' AND a.id=r.recurso_id
      WHERE r.estado_reclamo='activo' AND (${clausula})
      ORDER BY r.operacion_id,r.tipo_recurso,r.recurso_id`,
    parametros
  );
  return filas.map((fila) => congelar({
    operacionId: bytesAUuidV7Auditoria(fila.operacion_id),
    operacionTipo: String(fila.operacion_tipo),
    operacionEstado: String(fila.operacion_estado),
    recurso: normalizarRecurso({
      tipoRecurso: fila.tipo_recurso,
      recursoId: fila.recurso_id
    })
  }));
}

async function buscarReclamosPorOperaciones(conexion, entrada) {
  const operacionIds = [...new Set(entrada)].sort();
  if (operacionIds.length === 0) return [];
  const idsBinarios = operacionIds.map((id) => uuidV7AuditoriaABytes(id));
  const [filas] = await conexion.execute(
    `SELECT r.operacion_id,r.tipo_recurso,
            CAST(r.recurso_id AS CHAR) recurso_id,
            o.tipo operacion_tipo,o.estado operacion_estado
       FROM recursos_operaciones_administrativas r
       INNER JOIN operaciones_administrativas o
         ON o.operacion_id=r.operacion_id
      WHERE r.operacion_id IN (${marcadores(idsBinarios)})
        AND r.estado_reclamo='activo'
      ORDER BY r.operacion_id,r.tipo_recurso,r.recurso_id`,
    idsBinarios
  );
  return filas.map((fila) => congelar({
    operacionId: bytesAUuidV7Auditoria(fila.operacion_id),
    operacionTipo: String(fila.operacion_tipo),
    operacionEstado: String(fila.operacion_estado),
    recurso: normalizarRecurso({
      tipoRecurso: fila.tipo_recurso,
      recursoId: fila.recurso_id
    })
  }));
}

function construirFiltroSolapes(rutas) {
  const raices = {
    tenant: idsPorTipo(rutas, 'tenant'),
    empresa: idsPorTipo(rutas, 'empresa'),
    sitio: idsPorTipo(rutas, 'sitio'),
    agente: idsPorTipo(rutas, 'agente')
  };
  const ancestros = {
    tenant: ordenarIds(rutas.map(({ tenantId }) => tenantId)),
    empresa: ordenarIds(rutas.map(({ empresaId }) => empresaId).filter(Boolean)),
    sitio: ordenarIds(rutas.map(({ sitioId }) => sitioId).filter(Boolean))
  };
  const partes = [];
  const parametros = [];
  agregarIn(partes, parametros, "r.tipo_recurso='tenant' AND r.recurso_id", ancestros.tenant);
  agregarCompuesto(partes, parametros, "r.tipo_recurso='empresa'", [
    ['r.recurso_id', ancestros.empresa],
    ['e.tenant_id', raices.tenant]
  ]);
  agregarCompuesto(partes, parametros, "r.tipo_recurso='sitio'", [
    ['r.recurso_id', ancestros.sitio],
    ['s.empresa_id', raices.empresa],
    ['s.tenant_id', raices.tenant]
  ]);
  agregarCompuesto(partes, parametros, "r.tipo_recurso='agente'", [
    ['r.recurso_id', raices.agente],
    ['a.sitio_id', raices.sitio],
    ['a.empresa_id', raices.empresa],
    ['a.tenant_id', raices.tenant]
  ]);
  return {
    clausula: partes.length ? partes.join(' OR ') : 'FALSE',
    parametros
  };
}

function agregarIn(partes, parametros, prefijo, ids) {
  if (ids.length === 0) return;
  partes.push(`(${prefijo} IN (${marcadores(ids)}))`);
  parametros.push(...ids);
}

function agregarCompuesto(partes, parametros, tipo, filtros) {
  const condiciones = [];
  for (const [columna, ids] of filtros) {
    if (ids.length === 0) continue;
    condiciones.push(`${columna} IN (${marcadores(ids)})`);
    parametros.push(...ids);
  }
  if (condiciones.length) partes.push(`(${tipo} AND (${condiciones.join(' OR ')}))`);
}

async function bloquearOperacionesYReclamos(conexion, reclamos, leasePropietaria) {
  const operacionIds = [...new Set(reclamos.map(({ operacionId }) => operacionId))]
    .sort();
  if (operacionIds.length === 0) return;
  const idsBinarios = operacionIds.map((id) => uuidV7AuditoriaABytes(id));
  const [operaciones] = await conexion.execute(
    `SELECT operacion_id,estado,instancia_id,lease_token,
            CAST(fencing_token AS CHAR) fencing_token,
            lease_expira_utc>UTC_TIMESTAMP(3) lease_vigente
       FROM operaciones_administrativas
      WHERE operacion_id IN (${marcadores(idsBinarios)})
      ORDER BY operacion_id FOR UPDATE`,
    idsBinarios
  );
  if (operaciones.length !== operacionIds.length) {
    throw rutaModificada('Una operación desapareció antes de bloquear sus reclamos.');
  }
  if (leasePropietaria !== null) {
    const operacion = operaciones.find(({ operacion_id: id }) =>
      bytesAUuidV7Auditoria(id) === leasePropietaria.operacionId
    );
    if (!conservaLeasePropietaria(operacion, leasePropietaria)) {
      throw new LeaseOperacionDurablePerdido(
        'La operación perdió lease o fencing al adquirir la frontera jerárquica.'
      );
    }
  }
  const [recursos] = await conexion.execute(
    `SELECT operacion_id,tipo_recurso,recurso_id
       FROM recursos_operaciones_administrativas
      WHERE operacion_id IN (${marcadores(idsBinarios)})
        AND estado_reclamo='activo'
      ORDER BY operacion_id,tipo_recurso,recurso_id FOR UPDATE`,
    idsBinarios
  );
  if (recursos.length < reclamos.length) {
    throw rutaModificada('Un reclamo se liberó durante la adquisición de autoridad.');
  }
}

function normalizarLeasePropietaria(entrada, operacionPropietariaId) {
  if (operacionPropietariaId === null) {
    throw new TypeError('Un lease propietario exige operacionPropietariaId.');
  }
  const operacionId = String(entrada?.operacionId || '');
  if (operacionId !== operacionPropietariaId) {
    throw new TypeError('El lease no pertenece a la operación propietaria.');
  }
  uuidV7AuditoriaABytes(operacionId);
  const instanciaId = String(entrada?.instanciaId || '');
  if (!instanciaId || Buffer.byteLength(instanciaId, 'ascii') > 128 ||
      !/^[\x20-\x7e]+$/u.test(instanciaId)) {
    throw new TypeError('instanciaId del lease no es ASCII válido.');
  }
  const leaseToken = Buffer.isBuffer(entrada?.leaseToken)
    ? Buffer.from(entrada.leaseToken)
    : Buffer.from(String(entrada?.leaseToken || ''), 'hex');
  if (leaseToken.length !== 32) {
    throw new TypeError('leaseToken debe contener 32 bytes.');
  }
  const fencingToken = String(entrada?.fencingToken || '');
  if (!/^[1-9][0-9]*$/u.test(fencingToken) ||
      BigInt(fencingToken) > 18_446_744_073_709_551_615n) {
    throw new TypeError('fencingToken debe ser un decimal positivo.');
  }
  return Object.freeze({ operacionId, instanciaId, leaseToken, fencingToken });
}

function conservaLeasePropietaria(operacion, lease) {
  return Boolean(
    operacion &&
    String(operacion.estado) === 'ejecutando' &&
    String(operacion.instancia_id) === lease.instanciaId &&
    Buffer.isBuffer(operacion.lease_token) &&
    operacion.lease_token.equals(lease.leaseToken) &&
    String(operacion.fencing_token) === lease.fencingToken &&
    Boolean(operacion.lease_vigente)
  );
}

function exigirReclamosContenidos(actuales, preliminares, mensaje) {
  const admitidos = new Set(preliminares.map(claveReclamo));
  if (actuales.some((reclamo) => !admitidos.has(claveReclamo(reclamo)))) {
    throw rutaModificada(mensaje);
  }
}

function exigirMismoConjuntoReclamos(actuales, esperados) {
  const a = actuales.map(claveReclamo).sort();
  const b = esperados.map(claveReclamo).sort();
  if (JSON.stringify(a) !== JSON.stringify(b)) {
    throw rutaModificada('Los reclamos cambiaron después de adquirir sus bloqueos.');
  }
}

function normalizarRecursos(entrada) {
  if (!Array.isArray(entrada) || entrada.length === 0) {
    throw new TypeError('La autoridad requiere al menos un recurso candidato.');
  }
  const vistos = new Set();
  return entrada.map((recurso) => {
    const normalizado = normalizarRecurso(recurso);
    const clave = claveRecurso(normalizado);
    if (vistos.has(clave)) throw new TypeError(`El recurso ${clave} está repetido.`);
    vistos.add(clave);
    return normalizado;
  }).sort(compararRecursos);
}

function normalizarRecurso(entrada) {
  if (
    !entrada || typeof entrada !== 'object' || Array.isArray(entrada) ||
    Reflect.ownKeys(entrada).length !== 2 ||
    !Object.hasOwn(entrada, 'tipoRecurso') ||
    !Object.hasOwn(entrada, 'recursoId')
  ) {
    throw new TypeError('Cada recurso debe contener solo tipoRecurso y recursoId.');
  }
  const tipoRecurso = String(entrada.tipoRecurso || '');
  const recursoId = String(entrada.recursoId ?? '');
  if (!TIPOS_RECURSO.has(tipoRecurso) || !/^[1-9][0-9]*$/u.test(recursoId)) {
    throw new TypeError('La identidad del recurso jerárquico no es válida.');
  }
  return congelar({ tipoRecurso, recursoId });
}

function unirRutas(...colecciones) {
  const rutas = new Map();
  for (const ruta of colecciones.flat()) rutas.set(claveRecurso(ruta.recurso), ruta);
  return [...rutas.values()].sort((a, b) => compararRecursos(a.recurso, b.recurso));
}

function idsPorTipo(rutas, tipo) {
  return ordenarIds(rutas
    .filter(({ recurso }) => recurso.tipoRecurso === tipo)
    .map(({ recurso }) => recurso.recursoId));
}

function ordenarIds(entrada) {
  return [...new Set(entrada.map(String))]
    .sort((a, b) => a === b ? 0 : (BigInt(a) < BigInt(b) ? -1 : 1));
}

function compararRecursos(a, b) {
  const tipos = { tenant: 0, empresa: 1, sitio: 2, agente: 3 };
  const porTipo = tipos[a.tipoRecurso] - tipos[b.tipoRecurso];
  if (porTipo !== 0) return porTipo;
  if (a.recursoId === b.recursoId) return 0;
  return BigInt(a.recursoId) < BigInt(b.recursoId) ? -1 : 1;
}

function marcadores(valores) {
  return valores.map(() => '?').join(',');
}

function claveRuta(ruta) {
  return [ruta.tenantId, ruta.empresaId, ruta.sitioId, ruta.agenteId].join('/');
}

function claveRecurso({ tipoRecurso, recursoId }) {
  return `${tipoRecurso}:${recursoId}`;
}

function claveReclamo({ operacionId, recurso }) {
  return `${operacionId}/${claveRecurso(recurso)}`;
}

function rutaModificada(mensaje) {
  return new ErrorAutoridadReservasJerarquicas(
    'ruta_reserva_jerarquica_modificada',
    mensaje,
    { reintentable: true }
  );
}

function congelarLista(entrada) {
  return Object.freeze([...entrada]);
}

function congelar(entrada) {
  return Object.freeze(entrada);
}

function nuloOTexto(valor) {
  return valor === null || valor === undefined ? null : String(valor);
}

function exigirConexion(conexion) {
  if (typeof conexion?.execute !== 'function' || typeof conexion?.query !== 'function') {
    throw new Error('La autoridad jerárquica exige una conexión SQL prestada.');
  }
}

async function exigirTransaccionActiva(conexion) {
  const [filas] = await conexion.query('SELECT @@session.in_transaction AS activa');
  if (!Boolean(filas[0]?.activa)) {
    throw new Error('La autoridad jerárquica exige una transacción activa.');
  }
}

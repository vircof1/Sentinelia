import { uuidV7AuditoriaABytes }
  from '../../auditoria/src/UuidV7Auditoria.js';

export const ORDEN_BLOQUEO_INVENTARIO_ELIMINACION_ORGANIZACION =
  Object.freeze([
    'tenant',
    'empresa',
    'sitio',
    'operacion',
    'reclamo',
    'actores_y_usuarios',
    'agentes',
    'concesiones_ddns',
    'intenciones_ddns',
    'intentos_publicacion_ddns',
    'causas_pol_ddns',
    'triggers_correo',
    'audiencia_correo'
  ]);

const RAICES = Object.freeze({
  tenant: Object.freeze({
    seleccion: 'SELECT id,nombre,UTC_TIMESTAMP(3) capturada_en_utc FROM tenants WHERE id=?'
  }),
  empresa: Object.freeze({
    seleccion: 'SELECT id,nombre,tenant_id,UTC_TIMESTAMP(3) capturada_en_utc FROM empresas WHERE id=?'
  }),
  sitio: Object.freeze({
    seleccion: 'SELECT id,nombre,tenant_id,empresa_id,UTC_TIMESTAMP(3) capturada_en_utc FROM sitios WHERE id=?'
  })
});
const TAMANO_LOTE_BLOQUEO = 500;

export class RepositorioInventarioFinalEliminacionOrganizacionSql {
  async cargarRaizBloqueadaEnTransaccion({ sujeto } = {}, { conexion } = {}) {
    exigirConexion(conexion);
    const raiz = normalizarRaiz(sujeto);
    const [filas] = await conexion.execute(
      RAICES[raiz.tipo].seleccion,
      [raiz.id]
    );
    if (!filas[0]) return null;
    return congelar({
      tipo: raiz.tipo,
      id: raiz.id,
      nombre: String(filas[0].nombre ?? ''),
      scope: scopeRaiz(raiz, filas[0]),
      capturadaEnUtc: fechaUtcSql(filas[0].capturada_en_utc)
    });
  }

  async bloquearActoresYUsuariosEnTransaccion(
    { sujeto, actorIds = [] } = {},
    { conexion } = {}
  ) {
    exigirConexion(conexion);
    const raiz = normalizarRaiz(sujeto);
    const actores = ordenarIds(actorIds);
    const filtro = filtroScope(raiz, 'u');
    const [preliminares] = await conexion.execute(
      `SELECT CAST(u.id AS CHAR) id
         FROM usuarios u
        WHERE ${filtro.sql}
        ORDER BY u.id`,
      [raiz.id]
    );
    const ids = ordenarIds([
      ...preliminares.map(({ id }) => id),
      ...actores
    ]);
    const filas = await bloquearIdsEnLotes(
      conexion,
      `SELECT CAST(u.id AS CHAR) id,
              CAST(u.tenant_id AS CHAR) tenant_id,
              CAST(u.empresa_id AS CHAR) empresa_id,
              CAST(u.sitio_id AS CHAR) sitio_id
         FROM usuarios u`,
      ids,
      { permitirAusentes: true }
    );
    await exigirPertenenciasEstables(conexion, 'usuarios', raiz, preliminares);
    return congelarLista(filas.map(usuarioActual));
  }

  async bloquearAgentesEnTransaccion(
    { sujeto } = {},
    { conexion } = {}
  ) {
    exigirConexion(conexion);
    const raiz = normalizarRaiz(sujeto);
    const filtro = filtroScope(raiz, 'a');
    const [preliminares] = await conexion.execute(
      `SELECT CAST(a.id AS CHAR) id
         FROM agentes_sentinelia a
        WHERE ${filtro.sql}
        ORDER BY a.id`,
      [raiz.id]
    );
    const ids = ordenarIds(preliminares.map(({ id }) => id));
    const filas = await bloquearIdsEnLotes(
      conexion,
      `SELECT CAST(a.id AS CHAR) id,a.guid,a.nombre,a.descripcion,
              a.estado_administrativo,a.estado_acceso,a.ultima_version_agente,
              CAST(a.tenant_id AS CHAR) tenant_id,
              CAST(a.empresa_id AS CHAR) empresa_id,
              CAST(a.sitio_id AS CHAR) sitio_id
         FROM agentes_sentinelia a`,
      ids
    );
    await exigirPertenenciasEstables(
      conexion,
      'agentes_sentinelia',
      raiz,
      preliminares
    );
    return congelarLista(filas.map(agenteActual));
  }

  async bloquearDdnsEnTransaccion(
    { sujeto, agenteIds = [] } = {},
    { conexion } = {}
  ) {
    exigirConexion(conexion);
    const raiz = normalizarRaiz(sujeto);
    const agentes = ordenarIds(agenteIds);
    const condiciones = [
      `c.registro_dns_id IN (
        SELECT r.id FROM registros_dns r WHERE r.${raiz.tipo}_id=?
      )`
    ];
    const parametros = [raiz.id];
    if (agentes.length > 0) {
      condiciones.unshift(`c.agente_id IN (${agentes.map(() => '?').join(',')})`);
      parametros.unshift(...agentes);
    }
    const [concesiones] = await conexion.execute(
      `SELECT CAST(c.id AS CHAR) id
         FROM concesiones_ddns_agentes c
        WHERE ${condiciones.join(' OR ')}
        ORDER BY c.id FOR UPDATE`,
      parametros
    );
    const ids = concesiones.map(({ id }) => String(id));
    await bloquearPorColumnaEnLotes(
      conexion,
      'SELECT CAST(id AS CHAR) id FROM intenciones_ddns_agentes',
      'concesion_interna_id',
      ids,
    );
    await bloquearPorColumnaEnLotes(
      conexion,
      'SELECT CAST(id AS CHAR) id FROM intentos_publicacion_ddns',
      'concesion_interna_id',
      ids,
    );
    if (agentes.length > 0) {
      await bloquearPorColumnaEnLotes(
        conexion,
        'SELECT HEX(causa_id) id FROM causas_pol_ddns',
        'agente_id_fotografia',
        agentes,
      );
    }
    return congelar({ concesionesIds: ids });
  }

  async cargarConteosFinalesEnTransaccion(
    { sujeto, operacionId, actorEfectivoId } = {},
    { conexion } = {}
  ) {
    exigirConexion(conexion);
    const raiz = normalizarRaiz(sujeto);
    const conteos = [];
    const agregar = (categoria, cantidad) => conteos.push(congelar({
      categoria,
      cantidad: decimalNoNegativo(cantidad),
      precision: 'exacta'
    }));
    agregar('raiz', '1');
    agregar('empresas', raiz.tipo === 'tenant'
      ? await contarScope(conexion, 'empresas', raiz)
      : '0');
    agregar('sitios', raiz.tipo === 'sitio'
      ? '0'
      : await contarScope(conexion, 'sitios', raiz));
    for (const [categoria, tabla] of [
      ['usuarios', 'usuarios'],
      ['agentes', 'agentes_sentinelia'],
      ['reglas', 'reglas_derivacion_telemetria'],
      ['monitores', 'monitores']
    ]) {
      agregar(categoria, await contarScope(conexion, tabla, raiz));
    }
    agregar('sesiones', await contarPorAgentes(
      conexion,
      'operaciones_sesion_agentes',
      raiz
    ));
    let identidades = 0n;
    for (const tabla of [
      'identidades_contexto_operativo_agentes_federacion',
      'identidades_elementos_telemetria_federacion',
      'identidades_elementos_monitores_federacion'
    ]) {
      identidades += BigInt(await contarScope(
        conexion,
        tabla,
        raiz,
        'scope_'
      ));
    }
    agregar('identidades_federadas', identidades.toString());
    const ddns = await cargarConteosDdnsEnTransaccion(conexion, raiz);
    agregar('concesiones_ddns', ddns.concesiones);
    agregar('intenciones_ddns_aceptadas', ddns.intenciones);
    agregar('causas_pol_ddns_pendientes', ddns.causasPol);
    agregar('referencias_restrict', '0');
    const audiencia = await cargarConteosAudienciaCorreoEnTransaccion(
      conexion,
      raiz,
      actorEfectivoId
    );
    agregar('audiencia_correo_visible', audiencia.visibles);
    agregar('audiencia_correo_restringida', audiencia.restringidas);
    agregar(
      'triggers_correo_supervivientes_desactivados',
      audiencia.triggersSupervivientesDesactivados
    );
    const [[obligaciones]] = await conexion.execute(
      `SELECT COUNT(*) total
         FROM obligaciones_postcommit_operaciones_administrativas
        WHERE operacion_id=?`,
      [uuidV7AuditoriaABytes(operacionId)]
    );
    agregar('obligaciones_postcommit', obligaciones?.total ?? 0);
    return congelarLista(conteos);
  }
}

async function cargarConteosAudienciaCorreoEnTransaccion(
  conexion,
  raiz,
  actorEfectivoId
) {
  if (actorEfectivoId == null) {
    return {
      visibles: '0',
      restringidas: '0',
      triggersSupervivientesDesactivados: '0'
    };
  }
  const [[actor]] = await conexion.execute(`
    SELECT tenant_id,empresa_id,sitio_id,permiso_ver_triggers
      FROM usuarios
     WHERE id=?
     LIMIT 1
  `, [actorEfectivoId]);
  if (!actor) throw estructuraModificada('El actor efectivo dejó de existir.');
  const [filas] = await conexion.execute(`
    SELECT t.tenant_id,t.empresa_id,t.sitio_id,COUNT(*) total
      FROM destinatarios_triggers_correo d
      INNER JOIN usuarios u ON u.id=d.usuario_id
      INNER JOIN triggers t ON t.id=d.trigger_id AND t.tipo='correo'
     WHERE u.${raiz.tipo}_id=?
     GROUP BY t.tenant_id,t.empresa_id,t.sitio_id
  `, [raiz.id]);
  let visibles = 0n;
  let restringidas = 0n;
  for (const fila of filas) {
    const cantidad = BigInt(fila.total || 0);
    if (scopeCubre(actor, fila)) visibles += cantidad;
    else restringidas += cantidad;
  }
  const [[supervivientes]] = await conexion.execute(`
    SELECT COUNT(*) total
      FROM triggers t
     WHERE t.tipo='correo' AND t.activo=1
       AND (t.${raiz.tipo}_id IS NULL OR t.${raiz.tipo}_id<>?)
       AND EXISTS (
         SELECT 1
           FROM destinatarios_triggers_correo d
           INNER JOIN usuarios u ON u.id=d.usuario_id
          WHERE d.trigger_id=t.id AND u.${raiz.tipo}_id=?
       )
       AND NOT EXISTS (
         SELECT 1
           FROM destinatarios_triggers_correo d2
           LEFT JOIN usuarios u2 ON u2.id=d2.usuario_id
          WHERE d2.trigger_id=t.id AND d2.estado_participacion='activa'
            AND (d2.tipo='manual' OR u2.${raiz.tipo}_id IS NULL
              OR u2.${raiz.tipo}_id<>?)
       )
  `, [raiz.id, raiz.id, raiz.id]);
  return {
    visibles: visibles.toString(),
    restringidas: restringidas.toString(),
    triggersSupervivientesDesactivados:
      decimalNoNegativo(supervivientes?.total ?? 0)
  };
}

async function cargarConteosDdnsEnTransaccion(conexion, raiz) {
  const columna = `${raiz.tipo}_id`;
  const [[fila]] = await conexion.execute(
    `SELECT
       (SELECT COUNT(*) FROM concesiones_ddns_agentes c
         WHERE c.agente_id IN (
           SELECT a.id FROM agentes_sentinelia a WHERE a.${columna}=?
         ) OR c.registro_dns_id IN (
           SELECT r.id FROM registros_dns r WHERE r.${columna}=?
         )) concesiones,
       (SELECT COUNT(*) FROM intenciones_ddns_agentes i
          INNER JOIN concesiones_ddns_agentes c ON c.id=i.concesion_interna_id
         WHERE i.terminal IS NULL AND (
           c.agente_id IN (
             SELECT a.id FROM agentes_sentinelia a WHERE a.${columna}=?
           ) OR c.registro_dns_id IN (
             SELECT r.id FROM registros_dns r WHERE r.${columna}=?
           )
         )) intenciones,
       (SELECT COUNT(*) FROM causas_pol_ddns p
         WHERE p.agente_id_fotografia IN (
           SELECT a.id FROM agentes_sentinelia a WHERE a.${columna}=?
         ) AND p.estado IN ('pendiente','procesando','reintentable')
         AND NOT EXISTS (
           SELECT 1 FROM intenciones_ddns_agentes i
            WHERE i.causa_tipo='pol' AND i.causa_id=p.causa_id
         )) causas_pol`,
    [raiz.id, raiz.id, raiz.id, raiz.id, raiz.id]
  );
  return {
    concesiones: decimalNoNegativo(fila?.concesiones ?? 0),
    intenciones: decimalNoNegativo(fila?.intenciones ?? 0),
    causasPol: decimalNoNegativo(fila?.causas_pol ?? 0)
  };
}

function scopeCubre(actor, entidad) {
  if (Number(actor.permiso_ver_triggers) !== 1) return false;
  if (actor.sitio_id != null) {
    return String(actor.sitio_id) === String(entidad.sitio_id);
  }
  if (actor.empresa_id != null) {
    return String(actor.empresa_id) === String(entidad.empresa_id);
  }
  if (actor.tenant_id != null) {
    return String(actor.tenant_id) === String(entidad.tenant_id);
  }
  return true;
}

async function contarScope(conexion, tabla, raiz, prefijo = '') {
  const columna = `${prefijo}${raiz.tipo}_id`;
  const [[fila]] = await conexion.execute(
    `SELECT COUNT(*) total FROM ${tabla} WHERE ${columna}=?`,
    [raiz.id]
  );
  return decimalNoNegativo(fila?.total ?? 0);
}

async function contarPorAgentes(conexion, tabla, raiz) {
  const filtro = filtroScope(raiz, 'a');
  const [[fila]] = await conexion.execute(
    `SELECT COUNT(*) total
       FROM ${tabla} d
       INNER JOIN agentes_sentinelia a ON a.id=d.agente_id
      WHERE ${filtro.sql}`,
    [raiz.id]
  );
  return decimalNoNegativo(fila?.total ?? 0);
}

async function bloquearIdsEnLotes(
  conexion,
  seleccion,
  ids,
  { permitirAusentes = false } = {}
) {
  const filas = [];
  for (let inicio = 0; inicio < ids.length; inicio += TAMANO_LOTE_BLOQUEO) {
    const lote = ids.slice(inicio, inicio + TAMANO_LOTE_BLOQUEO);
    const [bloqueadas] = await conexion.execute(
      `${seleccion}
        WHERE id IN (${marcadores(lote)})
        ORDER BY id FOR UPDATE`,
      lote
    );
    if (!permitirAusentes && bloqueadas.length !== lote.length) {
      throw estructuraModificada(
        'Una identidad desapareció durante el bloqueo del agregado.'
      );
    }
    filas.push(...bloqueadas);
  }
  return filas;
}

async function bloquearPorColumnaEnLotes(conexion, seleccion, columna, ids) {
  for (let inicio = 0; inicio < ids.length; inicio += TAMANO_LOTE_BLOQUEO) {
    const lote = ids.slice(inicio, inicio + TAMANO_LOTE_BLOQUEO);
    await conexion.execute(
      `${seleccion}
        WHERE ${columna} IN (${marcadores(lote)})
        ORDER BY id FOR UPDATE`,
      lote
    );
  }
}

async function exigirPertenenciasEstables(conexion, tabla, raiz, esperadas) {
  const filtro = filtroScope(raiz, 'r');
  const [actuales] = await conexion.execute(
    `SELECT CAST(r.id AS CHAR) id FROM ${tabla} r
      WHERE ${filtro.sql} ORDER BY r.id`,
    [raiz.id]
  );
  const izquierda = ordenarIds(esperadas.map(({ id }) => id));
  const derecha = ordenarIds(actuales.map(({ id }) => id));
  if (izquierda.length !== derecha.length ||
      izquierda.some((id, indice) => id !== derecha[indice])) {
    throw estructuraModificada(
      'La pertenencia al agregado cambió durante su adquisición.'
    );
  }
}

function filtroScope(raiz, alias) {
  return Object.freeze({ sql: `${alias}.${raiz.tipo}_id=?` });
}

function normalizarRaiz(sujeto) {
  const tipo = String(sujeto?.tipo || '');
  if (!RAICES[tipo]) throw new TypeError('El sujeto no es una raíz organizativa.');
  return Object.freeze({ tipo, id: decimalPositivo(sujeto?.id, 'sujeto.id') });
}

function scopeRaiz(raiz, fila) {
  return congelar({
    nivel: raiz.tipo,
    tenantId: raiz.tipo === 'tenant'
      ? raiz.id
      : decimalPositivo(fila.tenant_id, 'tenant_id'),
    empresaId: raiz.tipo === 'tenant'
      ? null
      : raiz.tipo === 'empresa'
        ? raiz.id
        : decimalPositivo(fila.empresa_id, 'empresa_id'),
    sitioId: raiz.tipo === 'sitio' ? raiz.id : null
  });
}

function usuarioActual(fila) {
  return congelar({
    id: decimalPositivo(fila.id, 'usuario.id'),
    scope: congelar({
      tenantId: nuloODecimal(fila.tenant_id),
      empresaId: nuloODecimal(fila.empresa_id),
      sitioId: nuloODecimal(fila.sitio_id)
    })
  });
}

function agenteActual(fila) {
  return congelar({
    id: decimalPositivo(fila.id, 'agente.id'),
    guid: String(fila.guid),
    nombre: String(fila.nombre),
    descripcion: fila.descripcion === null ? null : String(fila.descripcion),
    estadoAdministrativo: String(fila.estado_administrativo),
    estadoAcceso: String(fila.estado_acceso),
    versionAgente: fila.ultima_version_agente === null
      ? null
      : String(fila.ultima_version_agente),
    scope: congelar({
      tenantId: decimalPositivo(fila.tenant_id, 'agente.tenant_id'),
      empresaId: decimalPositivo(fila.empresa_id, 'agente.empresa_id'),
      sitioId: decimalPositivo(fila.sitio_id, 'agente.sitio_id')
    })
  });
}

function ordenarIds(entrada) {
  return [...new Set(entrada.map((id) => decimalPositivo(id, 'actorId')))]
    .sort((a, b) => BigInt(a) < BigInt(b) ? -1 : BigInt(a) > BigInt(b) ? 1 : 0);
}

function marcadores(entrada) {
  return entrada.map(() => '?').join(',');
}

function decimalPositivo(valor, campo) {
  const texto = String(valor ?? '');
  if (!/^[1-9][0-9]*$/u.test(texto)) throw new TypeError(`${campo} no es válido.`);
  return texto;
}

function decimalNoNegativo(valor) {
  const texto = String(valor ?? '0');
  if (!/^(0|[1-9][0-9]*)$/u.test(texto)) {
    throw new Error('MariaDB devolvió un conteo no entero.');
  }
  return texto;
}

function nuloODecimal(valor) {
  return valor === null || valor === undefined
    ? null
    : decimalPositivo(valor, 'scope');
}

function fechaUtcSql(valor) {
  const fecha = valor instanceof Date
    ? valor
    : new Date(`${String(valor ?? '').replace(/Z$/u, '')}Z`);
  if (Number.isNaN(fecha.getTime())) {
    throw new Error('MariaDB no devolvió el instante UTC de la fotografía final.');
  }
  return fecha.toISOString();
}

function exigirConexion(conexion) {
  if (typeof conexion?.execute !== 'function') {
    throw new TypeError('El inventario final exige una conexión SQL prestada.');
  }
}

function estructuraModificada(mensaje) {
  const error = new Error(mensaje);
  error.name = 'ErrorInventarioFinalEliminacionOrganizacionSql';
  error.codigo = 'organizacion_eliminacion_impacto_no_seguro';
  error.permanente = true;
  error.esErrorOperacionAdministrativa = true;
  return error;
}

function congelarLista(entrada) {
  return Object.freeze([...entrada]);
}

function congelar(entrada) {
  return Object.freeze(entrada);
}

import {
  bytesAUuidV7Auditoria,
  uuidV7AuditoriaABytes
} from '../../auditoria/src/UuidV7Auditoria.js';

const DEFINICIONES = Object.freeze({
  tenant: Object.freeze({ tabla: 'tenants', filtro: 'tenant_id = ?' }),
  empresa: Object.freeze({ tabla: 'empresas', filtro: 'empresa_id = ?' }),
  sitio: Object.freeze({ tabla: 'sitios', filtro: 'sitio_id = ?' })
});

const TABLAS_SCOPE_CRITICAS = Object.freeze([
  Object.freeze({ categoria: 'usuarios', tabla: 'usuarios' }),
  Object.freeze({ categoria: 'agentes', tabla: 'agentes_sentinelia' }),
  Object.freeze({ categoria: 'reglas', tabla: 'reglas_derivacion_telemetria' }),
  Object.freeze({ categoria: 'monitores', tabla: 'monitores' }),
  Object.freeze({ categoria: 'triggers', tabla: 'triggers' })
]);

const TABLAS_IDENTIDADES_FEDERADAS = Object.freeze([
  'identidades_contexto_operativo_agentes_federacion',
  'identidades_elementos_telemetria_federacion',
  'identidades_elementos_monitores_federacion'
]);

export class RepositorioEliminacionesOrganizativas {
  async listarDescendientesEnTransaccion(entidad, id, { conexion } = {}) {
    const definicion = validar(entidad, conexion);
    const [usuarios] = await conexion.execute(
      `SELECT CAST(id AS CHAR) AS id
         FROM usuarios
        WHERE ${definicion.filtro}
        ORDER BY id ASC
        FOR UPDATE`,
      [id]
    );
    const [agentes] = await conexion.execute(
      `SELECT CAST(id AS CHAR) AS agente_id,
              sesion_auditoria_id,
              CAST(tenant_id AS CHAR) AS tenant_id,
              CAST(empresa_id AS CHAR) AS empresa_id,
              CAST(sitio_id AS CHAR) AS sitio_id
         FROM agentes_sentinelia
        WHERE ${definicion.filtro}
        ORDER BY id ASC
        FOR UPDATE`,
      [id]
    );
    return Object.freeze({
      usuarios: Object.freeze(usuarios.map(({ id: usuarioId }) => String(usuarioId))),
      agentes: Object.freeze(agentes.map((fila) => Object.freeze({
        agenteId: String(fila.agente_id),
        sesionAuditoriaId: fila.sesion_auditoria_id
          ? bytesAUuidV7Auditoria(fila.sesion_auditoria_id)
          : null,
        scope: Object.freeze({
          tenantId: String(fila.tenant_id),
          empresaId: String(fila.empresa_id),
          sitioId: String(fila.sitio_id)
        })
      })))
    });
  }

  async eliminarEnTransaccion(entidad, id, { conexion } = {}) {
    const definicion = validar(entidad, conexion);
    const [resultado] = await conexion.execute(
      `DELETE FROM ${definicion.tabla} WHERE id = ?`,
      [id]
    );
    if (Number(resultado.affectedRows) !== 1) {
      throw new Error(`La raíz ${entidad} cambió durante su eliminación.`);
    }
  }

  async eliminarRaizEnTransaccion({ raiz } = {}, { conexion } = {}) {
    const entrada = normalizarRaiz(raiz, conexion);
    await exigirTransaccionActiva(conexion);
    const [resultado] = await conexion.execute(
      `DELETE FROM ${entrada.definicion.tabla} WHERE id = ?`,
      [entrada.id]
    );
    if (Number(resultado.affectedRows) !== 1) {
      throw impactoNoSeguro(
        `El DELETE raíz no afectó exactamente al ${entrada.tipo} inventariado.`
      );
    }
    const [filasInstante] = await conexion.execute(
      'SELECT UTC_TIMESTAMP(3) AS efectivo_en_utc'
    );
    return Object.freeze({
      raiz: Object.freeze({ tipo: entrada.tipo, id: entrada.id }),
      eliminadas: '1',
      efectivoEnUtc: fechaUtcSql(filasInstante[0]?.efectivo_en_utc)
    });
  }

  async verificarPostcondicionesEliminacionEnTransaccion(
    {
      raiz,
      agenteIds = [],
      usuarioIds = [],
      operacionId,
      obligacionesEsperadas,
      invalidacionesTecnicasEsperadas,
      triggersCorreoReconciliados = [],
      ejecucionesCorreoAceptadasPreservadas = [],
      registrosDdnsEliminados = []
    } = {},
    { conexion } = {}
  ) {
    const entrada = normalizarRaiz(raiz, conexion);
    await exigirTransaccionActiva(conexion);
    const agentes = idsDecimales(agenteIds, 'agenteIds');
    const usuarios = idsDecimales(usuarioIds, 'usuarioIds');
    const ejecucionesPreservadas = idsDecimales(
      ejecucionesCorreoAceptadasPreservadas,
      'ejecucionesCorreoAceptadasPreservadas'
    );
    const registrosDdns = idsDecimales(
      registrosDdnsEliminados,
      'registrosDdnsEliminados'
    );
    const operacion = uuidV7AuditoriaABytes(operacionId, 'operacionId');
    const esperadas = cantidad(obligacionesEsperadas, 'obligacionesEsperadas');
    const invalidacionesEsperadas = cantidad(
      invalidacionesTecnicasEsperadas,
      'invalidacionesTecnicasEsperadas'
    );
    const conteos = {
      raiz: await contar(
        conexion,
        entrada.definicion.tabla,
        'id',
        entrada.id
      ),
      empresas: entrada.tipo === 'tenant'
        ? await contar(conexion, 'empresas', 'tenant_id', entrada.id)
        : '0',
      sitios: entrada.tipo === 'sitio'
        ? '0'
        : await contar(
          conexion,
          'sitios',
          `${entrada.tipo}_id`,
          entrada.id
        )
    };
    for (const { categoria, tabla } of TABLAS_SCOPE_CRITICAS) {
      conteos[categoria] = await contar(
        conexion,
        tabla,
        `${entrada.tipo}_id`,
        entrada.id
      );
    }
    conteos.ejecucionesTrigger = await contarExceptoIds(
      conexion,
      'ejecuciones_triggers',
      `monitor_${entrada.tipo}_id`,
      entrada.id,
      ejecucionesPreservadas
    );
    conteos.correoAceptadoPreservadas = await contarPreservadasDesvinculadas(
      conexion,
      ejecucionesPreservadas
    );
    conteos.identidadesFederadasVigentes = '0';
    for (const tabla of TABLAS_IDENTIDADES_FEDERADAS) {
      conteos.identidadesFederadasVigentes = sumarCantidades(
        conteos.identidadesFederadasVigentes,
        await contar(
          conexion,
          tabla,
          `scope_${entrada.tipo}_id`,
          entrada.id,
          "estado='vigente'"
        )
      );
    }
    conteos.sesionesWebAbiertas = await contarPorIds(
      conexion,
      'sesiones_web_auditoria',
      ['usuario_real_id', 'usuario_efectivo_id'],
      usuarios,
      "estado='abierta'"
    );
    conteos.audienciaCorreoUsuarios = await contarPorIds(
      conexion,
      'destinatarios_triggers_correo',
      ['usuario_id'],
      usuarios
    );
    conteos.sesionesTecnicasNoTerminales = await contarPorIds(
      conexion,
      'operaciones_sesion_agentes',
      ['agente_id'],
      agentes,
      "tipo IN ('login','refresh') AND estado NOT IN ('consolidada','reemplazada','fallida')"
    );
    conteos.invalidacionesTecnicas = await contar(
      conexion,
      'operaciones_sesion_agentes',
      'causa_operacion_id',
      operacion,
      "tipo='invalidacion'"
    );
    conteos.obligacionesPostcommit = await contar(
      conexion,
      'obligaciones_postcommit_operaciones_administrativas',
      'operacion_id',
      operacion
    );
    conteos.concesionesDdnsAgente = await contarPorIds(
      conexion,
      'concesiones_ddns_agentes',
      ['agente_id'],
      agentes,
      'estado IN (\'vigente\',\'revocada\')'
    );
    conteos.concesionesDdnsRegistro = await contarPorIds(
      conexion,
      'concesiones_ddns_agentes',
      ['registro_dns_id'],
      registrosDdns,
      'estado IN (\'vigente\',\'revocada\')'
    );
    conteos.intencionesDdnsObjetivoNoTerminales = await contarPorIds(
      conexion,
      'intenciones_ddns_agentes',
      ['registro_dns_id_fotografia'],
      registrosDdns,
      'terminal IS NULL'
    );
    conteos.causasPolDdnsNoConvertidas = await contarCausasPolDdnsNoConvertidas(
      conexion,
      agentes
    );

    for (const [categoria, total] of Object.entries(conteos)) {
      if (categoria === 'invalidacionesTecnicas' ||
          categoria === 'correoAceptadoPreservadas' ||
          categoria === 'obligacionesPostcommit') continue;
      exigirIgual(total, '0', categoria);
    }
    exigirIgual(
      conteos.correoAceptadoPreservadas,
      String(ejecucionesPreservadas.length),
      'ejecuciones de correo aceptadas preservadas y desvinculadas'
    );
    exigirIgual(
      conteos.invalidacionesTecnicas,
      invalidacionesEsperadas,
      'invalidaciones técnicas durables'
    );
    exigirIgual(
      conteos.obligacionesPostcommit,
      esperadas,
      'obligaciones postcommit'
    );
    for (const trigger of triggersCorreoReconciliados) {
      const [[fila]] = await conexion.execute(`
        SELECT COUNT(*) total
          FROM triggers
         WHERE id=? AND activo=0 AND revision_declaracion=?
      `, [trigger.id, trigger.revisionNueva]);
      exigirIgual(
        String(fila?.total ?? 0),
        '1',
        'trigger de correo reconciliado'
      );
    }
    return congelar({
      verificadas: true,
      raiz: { tipo: entrada.tipo, id: entrada.id },
      conteos
    });
  }
}

async function contarExceptoIds(conexion, tabla, columna, valor, idsExcluidos) {
  if (idsExcluidos.length === 0) {
    return contar(conexion, tabla, columna, valor);
  }
  const placeholders = idsExcluidos.map(() => '?').join(',');
  const [[fila]] = await conexion.execute(
    `SELECT COUNT(*) total FROM ${tabla}
      WHERE ${columna}=? AND id NOT IN (${placeholders})`,
    [valor, ...idsExcluidos]
  );
  return cantidad(fila.total);
}

async function contarPreservadasDesvinculadas(conexion, ids) {
  if (ids.length === 0) return '0';
  const placeholders = ids.map(() => '?').join(',');
  const [[fila]] = await conexion.execute(`
    SELECT COUNT(*) total FROM ejecuciones_triggers
     WHERE id IN (${placeholders})
       AND monitor_id IS NULL
       AND asignacion_trigger_monitor_id IS NULL
  `, ids);
  return cantidad(fila.total);
}

function validar(entidad, conexion) {
  const definicion = DEFINICIONES[entidad];
  if (!definicion) throw new Error('Entidad organizativa no eliminable.');
  if (typeof conexion?.execute !== 'function') {
    throw new Error('La eliminación organizativa exige una conexión prestada.');
  }
  return definicion;
}

function normalizarRaiz(raiz, conexion) {
  const tipo = String(raiz?.tipo || '');
  const definicion = validar(tipo, conexion);
  return Object.freeze({
    tipo,
    id: decimalPositivo(raiz?.id, 'raiz.id'),
    definicion
  });
}

async function contar(conexion, tabla, columna, valor, condicion = null) {
  const [[fila]] = await conexion.execute(
    `SELECT COUNT(*) total FROM ${tabla} WHERE ${columna}=?${
      condicion ? ` AND ${condicion}` : ''
    }`,
    [valor]
  );
  return cantidad(fila?.total ?? 0, `conteo ${tabla}`);
}

async function contarPorIds(conexion, tabla, columnas, ids, condicion) {
  if (ids.length === 0) return '0';
  const marcadores = ids.map(() => '?').join(',');
  const pertenencia = columnas
    .map((columna) => `${columna} IN (${marcadores})`)
    .join(' OR ');
  const parametros = columnas.flatMap(() => ids);
  const [[fila]] = await conexion.execute(
    `SELECT COUNT(*) total FROM ${tabla} WHERE (${pertenencia}) AND ${condicion}`,
    parametros
  );
  return cantidad(fila?.total ?? 0, `conteo ${tabla}`);
}

async function contarCausasPolDdnsNoConvertidas(conexion, agenteIds) {
  if (agenteIds.length === 0) return '0';
  const marcadoresIds = agenteIds.map(() => '?').join(',');
  const [[fila]] = await conexion.execute(
    `SELECT COUNT(*) total FROM causas_pol_ddns p
      WHERE p.agente_id_fotografia IN (${marcadoresIds})
        AND p.estado IN ('pendiente','procesando','reintentable')
        AND NOT EXISTS (
          SELECT 1 FROM intenciones_ddns_agentes i
           WHERE i.causa_tipo='pol' AND i.causa_id=p.causa_id
        )`,
    agenteIds
  );
  return cantidad(fila?.total ?? 0, 'causas POL DDNS');
}

function idsDecimales(entrada, campo) {
  if (!Array.isArray(entrada)) throw new TypeError(`${campo} debe ser una colección.`);
  const salida = entrada.map((id, indice) =>
    decimalPositivo(id, `${campo}[${indice}]`)
  );
  if (new Set(salida).size !== salida.length) {
    throw new TypeError(`${campo} contiene identidades duplicadas.`);
  }
  return salida.sort(compararDecimales);
}

function decimalPositivo(valor, campo) {
  const texto = String(valor ?? '');
  if (!/^[1-9][0-9]*$/u.test(texto)) throw new TypeError(`${campo} no es válido.`);
  return texto;
}

function cantidad(valor, campo) {
  const texto = String(valor ?? '');
  if (!/^(0|[1-9][0-9]*)$/u.test(texto)) {
    throw new TypeError(`${campo} no es una cantidad válida.`);
  }
  return texto;
}

function sumarCantidades(a, b) {
  return (BigInt(a) + BigInt(b)).toString();
}

function compararDecimales(a, b) {
  return BigInt(a) < BigInt(b) ? -1 : BigInt(a) > BigInt(b) ? 1 : 0;
}

function fechaUtcSql(valor) {
  const candidato = valor instanceof Date
    ? valor
    : new Date(`${String(valor || '').replace(/Z$/u, '')}Z`);
  if (Number.isNaN(candidato.getTime())) {
    throw new Error('MariaDB no devolvió el instante efectivo del DELETE raíz.');
  }
  return candidato.toISOString();
}

async function exigirTransaccionActiva(conexion) {
  if (typeof conexion?.query !== 'function') {
    throw new Error('La eliminación organizativa exige una conexión transaccional.');
  }
  const [filas] = await conexion.query('SELECT @@session.in_transaction AS activa');
  if (!Boolean(filas[0]?.activa)) {
    throw new Error('La eliminación organizativa exige una transacción activa.');
  }
}

function exigirIgual(actual, esperado, categoria) {
  if (actual !== esperado) {
    throw impactoNoSeguro(
      `La postcondición ${categoria} esperaba ${esperado} y encontró ${actual}.`
    );
  }
}

function impactoNoSeguro(mensaje) {
  const error = new Error(mensaje);
  error.name = 'ErrorRepositorioEliminacionOrganizativa';
  error.codigo = 'organizacion_eliminacion_impacto_no_seguro';
  error.permanente = true;
  error.esErrorOperacionAdministrativa = true;
  return error;
}

function congelar(valor) {
  if (valor && typeof valor === 'object' && !Object.isFrozen(valor)) {
    for (const hijo of Object.values(valor)) congelar(hijo);
    Object.freeze(valor);
  }
  return valor;
}

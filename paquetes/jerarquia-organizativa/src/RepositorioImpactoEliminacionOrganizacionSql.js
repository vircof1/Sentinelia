const RAICES = Object.freeze({
  tenant: Object.freeze({
    tabla: 'tenants',
    seleccionar: 'SELECT id, nombre FROM tenants WHERE id=? LIMIT 1'
  }),
  empresa: Object.freeze({
    tabla: 'empresas',
    seleccionar: 'SELECT id, nombre, tenant_id FROM empresas WHERE id=? LIMIT 1'
  }),
  sitio: Object.freeze({
    tabla: 'sitios',
    seleccionar:
      'SELECT id, nombre, tenant_id, empresa_id FROM sitios WHERE id=? LIMIT 1'
  })
});

const TABLAS_HISTORICAS = Object.freeze({
  senales: ['senales_telemetria_agentes'],
  observaciones: ['observaciones_telemetria_agentes'],
  pol: ['periodos_vida_pol_agentes'],
  eventos: [
    'eventos_derivados_telemetria',
    'transiciones_runtime_servidor_agentes',
    'eventos_monitores'
  ]
});

const LIMITE_CONTEO_HISTORICO = 10_000n;
const LIMITE_LECTURA_HISTORICO = LIMITE_CONTEO_HISTORICO + 1n;

export class ErrorRepositorioImpactoEliminacionOrganizacion extends Error {
  constructor(codigo, mensaje) {
    super(mensaje);
    this.name = 'ErrorRepositorioImpactoEliminacionOrganizacion';
    this.codigo = codigo;
  }
}

export class RepositorioImpactoEliminacionOrganizacionSql {
  constructor(clienteSql) {
    if (typeof clienteSql?.consultar !== 'function') {
      throw new Error('La vista previa organizativa requiere ClienteSql.');
    }
    this.clienteSql = clienteSql;
  }

  async cargarSujeto({ tipo, id } = {}) {
    const raiz = normalizarRaiz(tipo, id);
    const filas = await this.clienteSql.consultar(
      RAICES[raiz.tipo].seleccionar,
      [raiz.id]
    );
    if (!filas[0]) {
      throw new ErrorRepositorioImpactoEliminacionOrganizacion(
        'organizacion_eliminacion_no_encontrada',
        'No existe una organización eliminable dentro del alcance autorizado.'
      );
    }
    return congelar({
      tipo: raiz.tipo,
      id: raiz.id,
      nombre: String(filas[0].nombre ?? ''),
      scope: scopeRaiz(raiz, filas[0])
    });
  }

  async cargarConteos({ sujeto, actorEfectivoId } = {}) {
    const raiz = normalizarRaiz(sujeto?.tipo, sujeto?.id);
    const filtro = filtroScope(raiz);
    const exactos = await this.#cargarConteosExactos(filtro, raiz);
    const audiencia = await cargarConteosAudienciaCorreo(
      this.clienteSql,
      raiz,
      actorEfectivoId
    );
    const historicos = [];
    for (const [categoria, tablas] of Object.entries(TABLAS_HISTORICAS)) {
      historicos.push({
        categoria,
        ...await this.#contarTablasAcotadas(tablas, filtro)
      });
    }
    historicos.push({
      categoria: 'ejecuciones_trigger',
      ...acotarConteo(await this.#contarEjecucionesAcotadas(filtro, false))
    });
    historicos.push({
      categoria: 'correo_aceptado_preservadas',
      ...acotarConteo(await this.#contarEjecucionesAcotadas(filtro, true))
    });
    return congelar([
      { categoria: 'raiz', cantidad: '1', precision: 'exacta' },
      ...Object.entries({ ...exactos, ...audiencia }).map(([categoria, cantidad]) => ({
        categoria,
        cantidad: enteroDecimal(cantidad),
        precision: 'exacta'
      })),
      ...historicos
    ]);
  }

  async #cargarConteosExactos(filtro, raiz) {
    const empresas = raiz.tipo === 'tenant'
      ? subconsulta('empresas', 'tenant_id', raiz.id)
      : literalCero();
    const sitios = raiz.tipo === 'sitio'
      ? literalCero()
      : subconsulta('sitios', filtro.columna, filtro.valor);
    const scoped = (tabla) => subconsulta(tabla, filtro.columna, filtro.valor);
    const agentes = `SELECT id FROM agentes_sentinelia WHERE ${filtro.columna}=?`;
    const sql = `SELECT
      (${empresas.sql}) empresas,
      (${sitios.sql}) sitios,
      (${scoped('usuarios').sql}) usuarios,
      (${scoped('agentes_sentinelia').sql}) agentes,
      (${scoped('reglas_derivacion_telemetria').sql}) reglas,
      (${scoped('monitores').sql}) monitores,
      (SELECT COUNT(*) FROM operaciones_sesion_agentes
        WHERE agente_id IN (${agentes})) sesiones,
      ((SELECT COUNT(*) FROM identidades_contexto_operativo_agentes_federacion
          WHERE ${columnaScopeFederada(filtro.columna)}=?) +
       (SELECT COUNT(*) FROM identidades_elementos_telemetria_federacion
          WHERE ${columnaScopeFederada(filtro.columna)}=?) +
       (SELECT COUNT(*) FROM identidades_elementos_monitores_federacion
          WHERE ${columnaScopeFederada(filtro.columna)}=?)) identidades_federadas,
      0 referencias_restrict`;
    const parametros = [
      ...empresas.parametros,
      ...sitios.parametros,
      filtro.valor,
      filtro.valor,
      filtro.valor,
      filtro.valor,
      filtro.valor,
      filtro.valor,
      filtro.valor,
      filtro.valor
    ];
    const filas = await this.clienteSql.consultar(sql, parametros);
    const fila = filas[0] || {};
    const ddns = await cargarConteosDdns(this.clienteSql, raiz);
    return {
      empresas: fila.empresas ?? 0,
      sitios: fila.sitios ?? 0,
      usuarios: fila.usuarios ?? 0,
      agentes: fila.agentes ?? 0,
      reglas: fila.reglas ?? 0,
      monitores: fila.monitores ?? 0,
      sesiones: fila.sesiones ?? 0,
      identidades_federadas: fila.identidades_federadas ?? 0,
      referencias_restrict: fila.referencias_restrict ?? 0,
      ...ddns
    };
  }

  async #contarTablasAcotadas(tablas, filtro) {
    let cantidad = 0n;
    for (const tabla of tablas) {
      const limiteRestante = LIMITE_LECTURA_HISTORICO - cantidad;
      if (limiteRestante <= 0n) break;
      cantidad += await this.#contarTablaAcotada(tabla, filtro, limiteRestante);
    }
    return acotarConteo(cantidad);
  }

  async #contarTablaAcotada(tabla, filtro, limite) {
    const directa = [
      'eventos_derivados_telemetria',
      'eventos_monitores',
      'ejecuciones_triggers'
    ].includes(tabla);
    const columna = directa ? filtro.columna : `a.${filtro.columna}`;
    const seleccion = directa
      ? `SELECT 1 FROM ${tabla} WHERE ${columna}=?`
      : `SELECT 1 FROM ${tabla} h
           INNER JOIN agentes_sentinelia a ON a.id=h.agente_id
         WHERE ${columna}=?`;
    return this.#contarSeleccionAcotada(seleccion, [filtro.valor], limite);
  }

  async #contarEjecucionesAcotadas(filtro, preservadas) {
    const condicionPreservada = `tipo_trigger='correo' AND (
      EXISTS (
        SELECT 1 FROM notificaciones_triggers_correo n
         WHERE n.ejecucion_trigger_id=ejecuciones_triggers.id
      ) OR JSON_UNQUOTE(JSON_EXTRACT(
        payload_respuesta,
        '$.detalle_correo_estado'
      ))='purgado'
    )`;
    const condicion = preservadas
      ? condicionPreservada
      : `NOT (${condicionPreservada})`;
    return this.#contarSeleccionAcotada(
      `SELECT 1 FROM ejecuciones_triggers
        WHERE ${filtro.columna}=? AND ${condicion}`,
      [filtro.valor],
      LIMITE_LECTURA_HISTORICO
    );
  }

  async #contarSeleccionAcotada(seleccion, parametros, limite) {
    const limiteSeguro = limiteConteo(limite);
    const filas = await this.clienteSql.consultar(
      `SELECT COUNT(*) cantidad
         FROM (${seleccion} LIMIT ${limiteSeguro}) impacto_acotado`,
      parametros
    );
    return BigInt(enteroDecimal(filas[0]?.cantidad ?? 0));
  }
}

async function cargarConteosDdns(clienteSql, raiz) {
  const columna = `${raiz.tipo}_id`;
  const [fila = {}] = await clienteSql.consultar(
    `SELECT
       (SELECT COUNT(*) FROM concesiones_ddns_agentes c
         WHERE c.agente_id IN (
           SELECT a.id FROM agentes_sentinelia a WHERE a.${columna}=?
         ) OR c.registro_dns_id IN (
           SELECT r.id FROM registros_dns r WHERE r.${columna}=?
         )) concesiones_ddns,
       (SELECT COUNT(*) FROM intenciones_ddns_agentes i
          INNER JOIN concesiones_ddns_agentes c ON c.id=i.concesion_interna_id
         WHERE i.terminal IS NULL AND (
           c.agente_id IN (
             SELECT a.id FROM agentes_sentinelia a WHERE a.${columna}=?
           ) OR c.registro_dns_id IN (
             SELECT r.id FROM registros_dns r WHERE r.${columna}=?
           )
         )) intenciones_ddns_aceptadas,
       (SELECT COUNT(*) FROM causas_pol_ddns p
         WHERE p.agente_id_fotografia IN (
           SELECT a.id FROM agentes_sentinelia a WHERE a.${columna}=?
         ) AND p.estado IN ('pendiente','procesando','reintentable')
         AND NOT EXISTS (
           SELECT 1 FROM intenciones_ddns_agentes i
            WHERE i.causa_tipo='pol' AND i.causa_id=p.causa_id
         )) causas_pol_ddns_pendientes`,
    [raiz.id, raiz.id, raiz.id, raiz.id, raiz.id]
  );
  return {
    concesiones_ddns: fila.concesiones_ddns ?? 0,
    intenciones_ddns_aceptadas: fila.intenciones_ddns_aceptadas ?? 0,
    causas_pol_ddns_pendientes: fila.causas_pol_ddns_pendientes ?? 0
  };
}

async function cargarConteosAudienciaCorreo(ejecutor, raiz, actorEfectivoId) {
  if (actorEfectivoId == null) {
    return {
      audiencia_correo_visible: 0,
      audiencia_correo_restringida: 0,
      triggers_correo_supervivientes_desactivados: 0
    };
  }
  const actores = await ejecutor.consultar(`
    SELECT tenant_id,empresa_id,sitio_id,permiso_ver_triggers
      FROM usuarios
     WHERE id=?
     LIMIT 1
  `, [actorEfectivoId]);
  if (!actores[0]) {
    throw new ErrorRepositorioImpactoEliminacionOrganizacion(
      'organizacion_eliminacion_actor_ausente',
      'El actor efectivo ya no existe al calcular el impacto.'
    );
  }
  const filas = await ejecutor.consultar(`
    SELECT t.tenant_id,t.empresa_id,t.sitio_id,COUNT(*) total
      FROM destinatarios_triggers_correo d
      INNER JOIN usuarios u ON u.id=d.usuario_id
      INNER JOIN triggers t ON t.id=d.trigger_id AND t.tipo='correo'
     WHERE u.${raiz.tipo}_id=?
     GROUP BY t.tenant_id,t.empresa_id,t.sitio_id
  `, [raiz.id]);
  const particion = particionarVisibilidadAudiencia(filas, actores[0]);
  const supervivientes = await contarTriggersCorreoQueQuedarianDesactivados(
    (consulta, parametros) => ejecutor.consultar(consulta, parametros),
    raiz
  );
  return {
    ...particion,
    triggers_correo_supervivientes_desactivados: supervivientes
  };
}

async function contarTriggersCorreoQueQuedarianDesactivados(consultar, raiz) {
  const filas = await consultar(`
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
  return enteroDecimal(filas[0]?.total ?? 0);
}

function particionarVisibilidadAudiencia(filas, actor) {
  let visibles = 0n;
  let restringidas = 0n;
  for (const fila of filas) {
    const cantidad = BigInt(fila.total || 0);
    if (scopeCubre(actor, fila)) visibles += cantidad;
    else restringidas += cantidad;
  }
  return {
    audiencia_correo_visible: visibles.toString(),
    audiencia_correo_restringida: restringidas.toString()
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

function normalizarRaiz(tipo, id) {
  const tipoNormalizado = String(tipo ?? '');
  if (!RAICES[tipoNormalizado]) throw new TypeError('tipo no es una raíz organizativa.');
  return Object.freeze({ tipo: tipoNormalizado, id: idDecimal(id, 'id') });
}

function scopeRaiz(raiz, fila) {
  return Object.freeze({
    nivel: raiz.tipo,
    tenantId: raiz.tipo === 'tenant' ? raiz.id : idDecimal(fila.tenant_id, 'tenant_id'),
    empresaId: raiz.tipo === 'empresa'
      ? raiz.id
      : raiz.tipo === 'sitio' ? idDecimal(fila.empresa_id, 'empresa_id') : null,
    sitioId: raiz.tipo === 'sitio' ? raiz.id : null
  });
}

function filtroScope(raiz) {
  return Object.freeze({ columna: `${raiz.tipo}_id`, valor: raiz.id });
}

function subconsulta(tabla, columna, valor) {
  return { sql: `SELECT COUNT(*) FROM ${tabla} WHERE ${columna}=?`, parametros: [valor] };
}

function literalCero() {
  return { sql: 'SELECT 0', parametros: [] };
}

function columnaScopeFederada(columna) {
  return `scope_${columna}`;
}

function acotarConteo(cantidad) {
  const superaLimite = cantidad > LIMITE_CONTEO_HISTORICO;
  return {
    cantidad: String(superaLimite ? LIMITE_CONTEO_HISTORICO : cantidad),
    precision: superaLimite ? 'minima' : 'exacta'
  };
}

function limiteConteo(valor) {
  const limite = BigInt(valor);
  if (limite < 1n || limite > LIMITE_LECTURA_HISTORICO) {
    throw new RangeError('El límite del conteo histórico no es válido.');
  }
  return limite.toString();
}

function enteroDecimal(valor) {
  const texto = String(valor ?? '0');
  if (!/^(0|[1-9][0-9]*)$/u.test(texto)) {
    throw new Error('El repositorio devolvió un conteo no entero.');
  }
  return texto;
}

function idDecimal(valor, campo) {
  const texto = String(valor ?? '').trim();
  if (!/^[1-9][0-9]*$/u.test(texto)) throw new TypeError(`${campo} no es válido.`);
  return texto;
}

function congelar(valor) {
  if (valor && typeof valor === 'object' && !Object.isFrozen(valor)) {
    for (const hijo of Object.values(valor)) congelar(hijo);
    Object.freeze(valor);
  }
  return valor;
}

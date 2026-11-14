const DEFINICIONES = Object.freeze({
  usuario: definicion({
    tabla: 'usuarios',
    alias: 'u',
    etiqueta: "COALESCE(NULLIF(u.nombre_mostrar, ''), NULLIF(u.nombre_completo, ''), u.usuario)",
    busqueda: ['u.usuario', 'u.nombre_mostrar', 'u.nombre_completo', 'u.email'],
    scope: { tenant: 'u.tenant_id', empresa: 'u.empresa_id', sitio: 'u.sitio_id' }
  }),
  agente: definicion({
    tabla: 'agentes_sentinelia',
    alias: 'a',
    etiqueta: 'a.nombre',
    busqueda: ['a.nombre', 'a.guid', 'a.descripcion'],
    scope: { tenant: 'a.tenant_id', empresa: 'a.empresa_id', sitio: 'a.sitio_id' }
  }),
  monitor: definicion({
    tabla: 'monitores',
    alias: 'm',
    etiqueta: 'm.nombre',
    busqueda: ['m.nombre', 'm.tipo', 'm.descripcion'],
    scope: { tenant: 'm.tenant_id', empresa: 'm.empresa_id', sitio: 'm.sitio_id' }
  }),
  alerta: definicion({
    tabla: 'alertas_activas_monitores',
    alias: 'aa',
    id: "LOWER(CONCAT(SUBSTRING(HEX(aa.alerta_auditoria_id), 1, 8), '-', SUBSTRING(HEX(aa.alerta_auditoria_id), 9, 4), '-', SUBSTRING(HEX(aa.alerta_auditoria_id), 13, 4), '-', SUBSTRING(HEX(aa.alerta_auditoria_id), 17, 4), '-', SUBSTRING(HEX(aa.alerta_auditoria_id), 21, 12)))",
    joins: 'INNER JOIN monitores m ON m.id = aa.monitor_id',
    etiqueta: "CONCAT('Alerta de ', m.nombre)",
    busqueda: ['m.nombre', 'aa.tipo_monitor', 'aa.estado_detectado', 'aa.mensaje_ultimo_resultado'],
    scope: { tenant: 'aa.tenant_id', empresa: 'aa.empresa_id', sitio: 'aa.sitio_id' }
  }),
  trigger: definicion({
    tabla: 'triggers',
    alias: 'tr',
    etiqueta: 'tr.nombre',
    busqueda: ['tr.nombre', 'tr.tipo', 'tr.descripcion'],
    scope: { tenant: 'tr.tenant_id', empresa: 'tr.empresa_id', sitio: 'tr.sitio_id' }
  }),
  zona_dns: definicion({
    tabla: 'zonas_dns',
    alias: 'z',
    etiqueta: 'z.nombre_zona',
    busqueda: ['z.nombre_zona', 'z.tipo_zona', 'z.descripcion'],
    scope: { tenant: 'z.tenant_id', empresa: 'z.empresa_id', sitio: 'z.sitio_id' }
  }),
  registro_dns: definicion({
    tabla: 'registros_dns',
    alias: 'r',
    joins: 'INNER JOIN zonas_dns z ON z.id = r.zona_id',
    etiqueta: "CONCAT(r.tipo_registro, ' ', CASE WHEN r.host_relativo = '@' THEN z.nombre_zona ELSE CONCAT(r.host_relativo, '.', z.nombre_zona) END)",
    busqueda: ['r.host_relativo', 'z.nombre_zona', 'r.tipo_registro', 'r.valor_principal', 'r.descripcion'],
    scope: { tenant: 'r.tenant_id', empresa: 'r.empresa_id', sitio: 'r.sitio_id' }
  }),
  concesion_ddns: definicion({
    tabla: 'concesiones_ddns_agentes',
    alias: 'cd',
    id: uuidBinarioComoTexto('cd.concesion_id'),
    etiqueta: "CONCAT('Concesión DDNS · versión ', CAST(cd.version_ddns AS CHAR))",
    busqueda: [uuidBinarioComoTexto('cd.concesion_id')],
    scope: {
      tenant: 'cd.registro_scope_tenant_id',
      empresa: 'cd.registro_scope_empresa_id',
      sitio: 'cd.registro_scope_sitio_id'
    }
  }),
  intencion_ddns: definicion({
    tabla: 'intenciones_ddns_agentes',
    alias: 'idd',
    id: uuidBinarioComoTexto('idd.intencion_id'),
    joins: 'INNER JOIN concesiones_ddns_agentes cd ON cd.id=idd.concesion_interna_id',
    etiqueta: "CONCAT('Intención DDNS · versión ', CAST(idd.version_ddns AS CHAR))",
    busqueda: [uuidBinarioComoTexto('idd.intencion_id')],
    scope: {
      tenant: 'cd.registro_scope_tenant_id',
      empresa: 'cd.registro_scope_empresa_id',
      sitio: 'cd.registro_scope_sitio_id'
    }
  }),
  tenant: definicion({
    tabla: 'tenants',
    alias: 't',
    etiqueta: 't.nombre',
    busqueda: ['t.nombre', 't.alias', 't.descripcion'],
    scope: { tenant: 't.id' }
  }),
  empresa: definicion({
    tabla: 'empresas',
    alias: 'e',
    etiqueta: 'e.nombre',
    busqueda: ['e.nombre', 'e.alias', 'e.cif', 'e.descripcion'],
    scope: { tenant: 'e.tenant_id', empresa: 'e.id' }
  }),
  sitio: definicion({
    tabla: 'sitios',
    alias: 's',
    etiqueta: 's.nombre',
    busqueda: ['s.nombre', 's.alias', 's.timezone', 's.descripcion'],
    scope: { tenant: 's.tenant_id', empresa: 's.empresa_id', sitio: 's.id' }
  })
});

export class RepositorioResolutoresAuditoriaSql {
  constructor({ clienteSql } = {}) {
    if (!clienteSql?.consultar) {
      throw new Error('RepositorioResolutoresAuditoriaSql requiere cliente SQL.');
    }
    this.clienteSql = clienteSql;
  }

  admiteTipo(tipo) {
    return Boolean(DEFINICIONES[tipo]);
  }

  async buscarOpciones({ tipo, texto, pagina, limite, contextoUsuarioActual } = {}) {
    const configuracion = DEFINICIONES[tipo];
    if (!configuracion) return Object.freeze({ opciones: Object.freeze([]), hayMas: false });
    const condiciones = [];
    const parametros = [];
    agregarScope({ condiciones, parametros, configuracion, contextoUsuarioActual });
    agregarBusqueda({ condiciones, parametros, configuracion, texto });
    const offset = (pagina - 1) * limite;
    const filas = await this.clienteSql.consultar(
      `
        SELECT
          CAST(${configuracion.id} AS CHAR) AS id,
          ${configuracion.etiqueta} AS etiqueta,
          ${columnaContexto(configuracion.scope.tenant)} AS tenant_id,
          ${columnaContexto(configuracion.scope.empresa)} AS empresa_id,
          ${columnaContexto(configuracion.scope.sitio)} AS sitio_id
        FROM ${configuracion.tabla} ${configuracion.alias}
        ${configuracion.joins}
        ${condiciones.length ? `WHERE ${condiciones.join(' AND ')}` : ''}
        ORDER BY etiqueta ASC, ${configuracion.id} ASC
        LIMIT ? OFFSET ?
      `,
      [...parametros, limite + 1, offset]
    );
    const hayMas = filas.length > limite;
    const opciones = filas.slice(0, limite).map((fila) => Object.freeze({
      id: String(fila.id),
      etiqueta: String(fila.etiqueta),
      contexto: Object.freeze({
        tenantId: idNullable(fila.tenant_id),
        empresaId: idNullable(fila.empresa_id),
        sitioId: idNullable(fila.sitio_id)
      })
    }));
    return Object.freeze({ opciones: Object.freeze(opciones), hayMas });
  }

  async buscarOpcionesPorIds({ tipo, ids = [], contextoUsuarioActual } = {}) {
    const configuracion = DEFINICIONES[tipo];
    const idsNormalizados = [...new Set(ids.map((id) => String(id)).filter(Boolean))];
    if (!configuracion || idsNormalizados.length === 0) return Object.freeze([]);
    const condiciones = [];
    const parametros = [];
    agregarScope({ condiciones, parametros, configuracion, contextoUsuarioActual });
    condiciones.push(`${configuracion.id} IN (${idsNormalizados.map(() => '?').join(', ')})`);
    parametros.push(...idsNormalizados);
    const filas = await this.clienteSql.consultar(
      `
        SELECT
          CAST(${configuracion.id} AS CHAR) AS id,
          ${configuracion.etiqueta} AS etiqueta,
          ${columnaContexto(configuracion.scope.tenant)} AS tenant_id,
          ${columnaContexto(configuracion.scope.empresa)} AS empresa_id,
          ${columnaContexto(configuracion.scope.sitio)} AS sitio_id
        FROM ${configuracion.tabla} ${configuracion.alias}
        ${configuracion.joins}
        WHERE ${condiciones.join(' AND ')}
      `,
      parametros
    );
    return Object.freeze(filas.map(construirOpcion));
  }
}

function definicion(valor) {
  return Object.freeze({
    joins: '',
    ...valor,
    id: valor.id || `${valor.alias}.id`,
    busqueda: Object.freeze(valor.busqueda),
    scope: Object.freeze(valor.scope)
  });
}

function construirOpcion(fila) {
  return Object.freeze({
    id: String(fila.id),
    etiqueta: String(fila.etiqueta),
    contexto: Object.freeze({
      tenantId: idNullable(fila.tenant_id),
      empresaId: idNullable(fila.empresa_id),
      sitioId: idNullable(fila.sitio_id)
    })
  });
}

function agregarScope({ condiciones, parametros, configuracion, contextoUsuarioActual }) {
  const nivel = contextoUsuarioActual?.nivelScope;
  if (nivel === 'portal') return;
  const prioridades = nivel === 'sitio'
    ? [['sitio', 'sitioId'], ['empresa', 'empresaId'], ['tenant', 'tenantId']]
    : nivel === 'empresa'
      ? [['empresa', 'empresaId'], ['tenant', 'tenantId']]
      : nivel === 'tenant'
        ? [['tenant', 'tenantId']]
        : [];
  if (prioridades.length === 0) {
    condiciones.push('1 = 0');
    return;
  }
  const seleccion = prioridades.find(([campo]) => configuracion.scope[campo]);
  if (!seleccion) {
    condiciones.push('1 = 0');
    return;
  }
  condiciones.push(`${configuracion.scope[seleccion[0]]} = ?`);
  parametros.push(String(contextoUsuarioActual?.[seleccion[1]] ?? ''));
}

function agregarBusqueda({ condiciones, parametros, configuracion, texto }) {
  if (!texto) return;
  const patron = `%${texto}%`;
  condiciones.push(`(${configuracion.busqueda.map((columna) =>
    `COALESCE(${columna}, '') LIKE ?`
  ).join(' OR ')})`);
  parametros.push(...configuracion.busqueda.map(() => patron));
}

function columnaContexto(columna) {
  return columna || 'NULL';
}

function uuidBinarioComoTexto(columna) {
  return `LOWER(CONCAT(SUBSTRING(HEX(${columna}),1,8),'-',` +
    `SUBSTRING(HEX(${columna}),9,4),'-',SUBSTRING(HEX(${columna}),13,4),'-',` +
    `SUBSTRING(HEX(${columna}),17,4),'-',SUBSTRING(HEX(${columna}),21,12)))`;
}

function idNullable(valor) {
  return valor == null ? null : String(valor);
}

export const __testablesRepositorioResolutoresAuditoriaSql = Object.freeze({
  DEFINICIONES
});

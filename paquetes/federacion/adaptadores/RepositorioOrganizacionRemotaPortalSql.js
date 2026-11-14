export class RepositorioOrganizacionRemotaPortalSql {
  constructor(clienteSql) {
    if (typeof clienteSql?.consultar !== 'function') {
      throw new Error('La lectura organizativa remota requiere SQL operativo.');
    }
    this.clienteSql = clienteSql;
  }

  async listar({ installationOrigenId, scope } = {}) {
    const condiciones = [
      'p.installation_origen_id=?',
      "p.estado_autorizacion='autorizada'"
    ];
    const parametros = [installationOrigenId];
    agregarScope(condiciones, parametros, scope);
    const filas = await this.clienteSql.consultar(
      `WITH nodos_actuales AS (
         SELECT p.proyeccion_id,p.installation_origen_id,p.elemento_origen_id,
                p.scope_nivel,p.scope_tenant_id,p.scope_empresa_id,p.scope_sitio_id,
                a.generacion_actual_id,v.ultima_secuencia_evaluada,
                v.estado_autorizacion,
                (
                  SELECT MAX(n2.secuencia_elemento)
                    FROM versiones_nodos_organizativos_remotos n2
                   WHERE n2.proyeccion_id=p.proyeccion_id
                     AND n2.generacion_id=a.generacion_actual_id
                     AND n2.secuencia_elemento<=v.ultima_secuencia_evaluada
                ) AS secuencia_organizativa
           FROM proyecciones_federacion p
           JOIN estados_actuales_proyecciones_federacion a
             ON a.proyeccion_id=p.proyeccion_id
           JOIN versiones_proyecciones_federacion v
             ON v.proyeccion_id=a.proyeccion_id
            AND v.generacion_id=a.generacion_actual_id
            AND v.estado_publicacion='actual'
          WHERE p.familia='estructuraOrganizativa'
       )
       SELECT p.proyeccion_id,p.installation_origen_id,p.elemento_origen_id,
              p.scope_nivel,p.scope_tenant_id,p.scope_empresa_id,p.scope_sitio_id,
              p.generacion_actual_id,n.secuencia_elemento,n.estado_registro,
              n.causa_retirada,
              COALESCE(n.tipo_nodo,anterior.tipo_nodo) AS tipo_nodo,
              COALESCE(n.nombre,anterior.nombre) AS nombre,
              COALESCE(n.alias,anterior.alias) AS alias,
              COALESCE(n.estado_origen,anterior.estado_origen) AS estado_origen,
              COALESCE(n.descripcion,anterior.descripcion) AS descripcion,
              COALESCE(n.timezone,anterior.timezone) AS timezone,
              l.ordinal,l.tipo_ancestro,l.elemento_origen_id AS ancestro_origen_id,
              l.nombre AS ancestro_nombre,l.visibilidad
         FROM nodos_actuales p
         JOIN versiones_nodos_organizativos_remotos n
           ON n.proyeccion_id=p.proyeccion_id
          AND n.generacion_id=p.generacion_actual_id
          AND n.secuencia_elemento=p.secuencia_organizativa
         LEFT JOIN versiones_nodos_organizativos_remotos anterior
           ON anterior.proyeccion_id=n.proyeccion_id
          AND anterior.generacion_id=n.generacion_id
          AND anterior.estado_registro='presente'
          AND anterior.secuencia_elemento=(
            SELECT MAX(n3.secuencia_elemento)
              FROM versiones_nodos_organizativos_remotos n3
             WHERE n3.proyeccion_id=n.proyeccion_id
               AND n3.generacion_id=n.generacion_id
               AND n3.estado_registro='presente'
               AND n3.secuencia_elemento<n.secuencia_elemento
          )
         LEFT JOIN linaje_versiones_nodos_organizativos_remotos l
           ON l.proyeccion_id=n.proyeccion_id
          AND l.generacion_id=n.generacion_id
          AND l.secuencia_elemento=IF(
            n.estado_registro='presente',n.secuencia_elemento,anterior.secuencia_elemento
          )
        WHERE ${condiciones.join(' AND ')}
        ORDER BY p.proyeccion_id,l.ordinal`,
      parametros
    );
    return agrupar(filas);
  }
}

function agregarScope(condiciones, parametros, scope) {
  if (!scope || !['portal', 'tenant', 'empresa', 'sitio'].includes(scope.nivel)) {
    throw errorAcceso('scope_organizacion_remota_invalido');
  }
  if (scope.nivel !== 'portal') {
    exigirIdScope(scope.tenantId, 'tenantId');
    condiciones.push('p.scope_tenant_id=?');
    parametros.push(scope.tenantId);
  }
  if (['empresa', 'sitio'].includes(scope.nivel)) {
    exigirIdScope(scope.empresaId, 'empresaId');
    condiciones.push('p.scope_empresa_id=?');
    parametros.push(scope.empresaId);
  }
  if (scope.nivel === 'sitio') {
    exigirIdScope(scope.sitioId, 'sitioId');
    condiciones.push('p.scope_sitio_id=?');
    parametros.push(scope.sitioId);
  }
}

function agrupar(filas) {
  const nodos = new Map();
  for (const fila of filas) {
    let nodo = nodos.get(fila.proyeccion_id);
    if (!nodo) {
      nodo = {
        proyeccionId: fila.proyeccion_id,
        installationOrigenId: fila.installation_origen_id,
        elementoOrigenId: fila.elemento_origen_id,
        generacionId: fila.generacion_actual_id,
        secuenciaElemento: String(fila.secuencia_elemento),
        estadoRegistro: fila.estado_registro,
        causaRetirada: fila.causa_retirada ?? null,
        tipo: fila.tipo_nodo,
        nombre: fila.nombre,
        alias: fila.alias,
        estado: fila.estado_origen,
        descripcion: fila.descripcion,
        timezone: fila.timezone,
        scopeRecepcion: {
          nivel: fila.scope_nivel,
          tenantId: opcional(fila.scope_tenant_id),
          empresaId: opcional(fila.scope_empresa_id),
          sitioId: opcional(fila.scope_sitio_id)
        },
        linaje: []
      };
      nodos.set(fila.proyeccion_id, nodo);
    }
    if (fila.ordinal !== null) {
      nodo.linaje.push({
        tipo: fila.tipo_ancestro,
        elementoOrigenId: fila.ancestro_origen_id,
        nombre: fila.ancestro_nombre,
        visibilidad: fila.visibilidad
      });
    }
  }
  return Object.freeze([...nodos.values()].map((nodo) => Object.freeze({
    ...nodo,
    scopeRecepcion: Object.freeze(nodo.scopeRecepcion),
    linaje: Object.freeze(nodo.linaje.map(Object.freeze))
  })));
}

function exigirIdScope(valor, campo) {
  if (!Number.isSafeInteger(Number(valor)) || Number(valor) < 1) {
    throw errorAcceso(`scope_${campo}_invalido`);
  }
}

function opcional(valor) {
  return valor === null || valor === undefined ? null : String(valor);
}

function errorAcceso(codigo) {
  const error = new Error('El scope efectivo no permite consultar la organización remota.');
  error.codigo = codigo;
  error.statusCode = 403;
  return error;
}

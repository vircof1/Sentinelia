export class RepositorioTriggersRemotosPortalSql {
  constructor(clienteSql) {
    if (typeof clienteSql?.consultar !== 'function') {
      throw new Error('El visor remoto de triggers requiere SQL operativo.');
    }
    this.clienteSql = clienteSql;
  }

  listarDefiniciones(filtros = {}) {
    return this.#listarTipo('definicion', filtros, {
      limite: filtros.limite ?? 200,
      orden: "JSON_UNQUOTE(JSON_EXTRACT(r.representacion_canonica,'$.nombre')),p.elemento_origen_id"
    });
  }

  listarAsignaciones(filtros = {}) {
    return this.#listarTipo('asignacionMonitor', filtros, {
      limite: filtros.limite ?? 500,
      orden: "r.trigger_origen_id,JSON_EXTRACT(r.representacion_canonica,'$.ordenEjecucion'),p.proyeccion_id"
    });
  }

  listarEjecucionesTerminadas(filtros = {}) {
    return this.#listarTipo('ejecucionTerminada', filtros, {
      limite: filtros.limite ?? 200,
      orden: 'r.tiempo_dato_utc DESC,p.proyeccion_id'
    });
  }

  async #listarTipo(tipoRegistro, {
    installationOrigenId,
    triggerOrigenId = null,
    triggerOrigenIds = null,
    monitorOrigenId = null,
    scope,
    limite
  } = {}, { orden, limite: limitePorDefecto }) {
    const filtro = filtroScope(scope, 'p');
    const filtrosReferencias = [];
    const parametrosReferencias = [];
    if (triggerOrigenId !== null) {
      filtrosReferencias.push('r.trigger_origen_id=?');
      parametrosReferencias.push(triggerOrigenId);
    }
    const triggers = identidadesOpcionales(triggerOrigenIds, 'triggers');
    if (triggers !== null) {
      if (triggers.length === 0) return Object.freeze([]);
      filtrosReferencias.push(
        `r.trigger_origen_id IN (${triggers.map(() => '?').join(',')})`
      );
      parametrosReferencias.push(...triggers);
    }
    if (monitorOrigenId !== null) {
      filtrosReferencias.push('r.monitor_origen_id=?');
      parametrosReferencias.push(monitorOrigenId);
    }
    const filtroReferencias = filtrosReferencias.length > 0
      ? `AND ${filtrosReferencias.join(' AND ')}`
      : '';
    const filas = await this.clienteSql.consultar(
      `WITH registros_actuales AS (
         SELECT p.proyeccion_id,a.generacion_actual_id,v.ultima_secuencia_evaluada,
                (SELECT MAX(r0.secuencia_elemento)
                   FROM registros_triggers_informativos_remotos r0
                  WHERE r0.proyeccion_id=p.proyeccion_id
                    AND r0.generacion_id=a.generacion_actual_id
                    AND r0.secuencia_elemento<=v.ultima_secuencia_evaluada
                    AND (r0.tipo_registro=? OR r0.estado_registro='retirado')
                ) AS secuencia_registro
           FROM proyecciones_federacion p
           JOIN estados_actuales_proyecciones_federacion a
             ON a.proyeccion_id=p.proyeccion_id
           JOIN versiones_proyecciones_federacion v
             ON v.proyeccion_id=a.proyeccion_id
            AND v.generacion_id=a.generacion_actual_id
            AND v.estado_publicacion='actual'
          WHERE p.familia='triggersInformativos'
            AND p.installation_origen_id=?
            AND v.estado_autorizacion='autorizada'
            AND ${filtro.clausula}
       )
       SELECT p.proyeccion_id,p.installation_origen_id,p.elemento_origen_id,
              p.scope_nivel,p.scope_tenant_id,p.scope_empresa_id,p.scope_sitio_id,
              x.generacion_actual_id,r.secuencia_elemento,r.ocurrencia_origen_id,
              r.tipo_registro,r.trigger_origen_id,r.monitor_origen_id,
              r.referencia_origen_id,r.estado_ejecucion,r.tiempo_dato_utc,
              r.representacion_canonica,
              v.completitud_interpretable,v.completitud_observable,
              v.completitud_reconstruible,v.estado_vigencia,v.estado_soporte,
              v.estado_autorizacion
         FROM registros_actuales x
         JOIN proyecciones_federacion p ON p.proyeccion_id=x.proyeccion_id
         JOIN versiones_proyecciones_federacion v
           ON v.proyeccion_id=x.proyeccion_id
          AND v.generacion_id=x.generacion_actual_id
         JOIN registros_triggers_informativos_remotos r
           ON r.proyeccion_id=x.proyeccion_id
          AND r.generacion_id=x.generacion_actual_id
          AND r.secuencia_elemento=x.secuencia_registro
          AND r.estado_registro='presente'
          AND r.tipo_registro=?
        WHERE 1=1 ${filtroReferencias}
        ORDER BY ${orden}
        LIMIT ?`,
      [
        tipoRegistro,
        installationOrigenId,
        ...filtro.parametros,
        tipoRegistro,
        ...parametrosReferencias,
        normalizarLimite(limite ?? limitePorDefecto)
      ]
    );
    return Object.freeze(filas.map(mapear));
  }
}

function identidadesOpcionales(valores, campo) {
  if (valores === null || valores === undefined) return null;
  if (!Array.isArray(valores)) throw errorAcceso(`filtro_${campo}_invalido`);
  const identidades = [...new Set(valores.map((valor) => String(valor || '').trim()))]
    .filter(Boolean);
  if (identidades.length > 500) throw errorAcceso(`filtro_${campo}_excesivo`);
  return identidades;
}

function filtroScope(scope, alias) {
  if (scope?.nivel === 'portal') return { clausula: '1=1', parametros: [] };
  if (!scope || !['tenant', 'empresa', 'sitio'].includes(scope.nivel)) {
    throw errorAcceso('scope_triggers_remotos_invalido');
  }
  const partes = [`${alias}.scope_tenant_id=?`];
  const parametros = [idScope(scope.tenantId, 'tenantId')];
  if (['empresa', 'sitio'].includes(scope.nivel)) {
    partes.push(`${alias}.scope_empresa_id=?`);
    parametros.push(idScope(scope.empresaId, 'empresaId'));
  }
  if (scope.nivel === 'sitio') {
    partes.push(`${alias}.scope_sitio_id=?`);
    parametros.push(idScope(scope.sitioId, 'sitioId'));
  }
  return { clausula: partes.join(' AND '), parametros };
}

function mapear(fila) {
  return Object.freeze({
    proyeccionId: fila.proyeccion_id,
    installationOrigenId: fila.installation_origen_id,
    elementoOrigenId: fila.elemento_origen_id,
    generacionId: fila.generacion_actual_id,
    secuenciaElemento: String(fila.secuencia_elemento),
    ocurrenciaOrigenId: fila.ocurrencia_origen_id,
    tipoRegistro: fila.tipo_registro,
    triggerOrigenId: fila.trigger_origen_id,
    monitorOrigenId: fila.monitor_origen_id,
    referenciaOrigenId: fila.referencia_origen_id,
    estadoEjecucion: fila.estado_ejecucion,
    tiempoDatoUtc: iso(fila.tiempo_dato_utc),
    scopeRecepcion: Object.freeze({
      nivel: fila.scope_nivel,
      tenantId: opcional(fila.scope_tenant_id),
      empresaId: opcional(fila.scope_empresa_id),
      sitioId: opcional(fila.scope_sitio_id)
    }),
    completitud: Object.freeze({
      interpretable: fila.completitud_interpretable,
      observable: fila.completitud_observable,
      reconstruible: fila.completitud_reconstruible
    }),
    estadoProyeccion: Object.freeze({
      vigencia: fila.estado_vigencia,
      soporte: fila.estado_soporte,
      autorizacion: fila.estado_autorizacion
    }),
    payload: JSON.parse(fila.representacion_canonica)
  });
}

function idScope(valor, campo) {
  const numero = Number(valor);
  if (!Number.isSafeInteger(numero) || numero < 1) {
    throw errorAcceso(`scope_${campo}_invalido`);
  }
  return numero;
}

function normalizarLimite(valor) {
  const numero = Number(valor);
  if (!Number.isSafeInteger(numero) || numero < 1) return 200;
  return Math.min(numero, 500);
}

function opcional(valor) {
  return valor === null || valor === undefined ? null : String(valor);
}

function iso(valor) {
  if (valor === null || valor === undefined || valor === '') return null;
  if (valor instanceof Date) return valor.toISOString();
  const texto = String(valor);
  return new Date(`${texto.replace(' ', 'T').replace(/Z$/u, '')}Z`).toISOString();
}

function errorAcceso(codigo) {
  return Object.assign(new Error('El scope no permite listar triggers remotos.'), {
    codigo,
    statusCode: 403
  });
}

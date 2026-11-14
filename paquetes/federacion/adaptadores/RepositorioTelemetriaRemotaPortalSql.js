export class RepositorioTelemetriaRemotaPortalSql {
  constructor(clienteSql) {
    if (typeof clienteSql?.consultar !== 'function') {
      throw new Error('El resumen remoto de telemetría requiere SQL operativo.');
    }
    this.clienteSql = clienteSql;
  }

  async listarResumen({ installationOrigenId, scope, limite = 1000 } = {}) {
    return this.#listarTipos({
      installationOrigenId,
      scope,
      limite,
      tipos: ['fuente', 'senal', 'fotografiaSenal', 'fotografiaPol'],
      orden: `FIELD(r.tipo_registro,'fuente','senal','fotografiaPol','fotografiaSenal'),
              p.elemento_origen_id`
    });
  }

  async listarActividad({ installationOrigenId, scope, limite = 150,
    senalOrigenId = null, desdeUtc = null, hastaUtc = null } = {}) {
    const registros = await this.#listarTipos({
      installationOrigenId,
      scope,
      limite,
      tipos: ['observacion', 'eventoDerivado'],
      orden: 'r.tiempo_dato_utc DESC,p.proyeccion_id',
      senalOrigenId,
      desdeUtc,
      hastaUtc
    });
    const periodosPol = await this.#listarPeriodosPolActividad({
      installationOrigenId,
      scope,
      desdeUtc,
      hastaUtc
    });
    return Object.freeze([...registros, ...periodosPol]);
  }

  async listarHistorico({ installationOrigenId, scope, limite = 500 } = {}) {
    return this.#listarTipos({
      installationOrigenId,
      scope,
      limite,
      tipos: ['observacion', 'rangoHistorico'],
      orden: 'r.tiempo_dato_utc DESC,p.proyeccion_id'
    });
  }

  async #listarPeriodosPolActividad({ installationOrigenId, scope,
    desdeUtc = null, hastaUtc = null } = {}) {
    const filtro = filtroScope(scope, 'p');
    const filas = await this.clienteSql.consultar(
      `WITH proyecciones_pol AS (
         SELECT p.proyeccion_id,a.generacion_actual_id,
                v.ultima_secuencia_evaluada,
                (SELECT MAX(r0.secuencia_elemento)
                   FROM registros_telemetria_remotos r0
                  WHERE r0.proyeccion_id=p.proyeccion_id
                    AND r0.generacion_id=a.generacion_actual_id
                    AND r0.secuencia_elemento<=v.ultima_secuencia_evaluada
                    AND (r0.tipo_registro='fotografiaPol' OR r0.estado_registro='retirado')
                ) AS secuencia_actual
           FROM proyecciones_federacion p
           JOIN estados_actuales_proyecciones_federacion a
             ON a.proyeccion_id=p.proyeccion_id
           JOIN versiones_proyecciones_federacion v
             ON v.proyeccion_id=a.proyeccion_id
            AND v.generacion_id=a.generacion_actual_id
            AND v.estado_publicacion='actual'
          WHERE p.familia='telemetria' AND p.installation_origen_id=?
            AND v.estado_autorizacion='autorizada' AND ${filtro.clausula}
       ), periodos_pol AS (
         SELECT x.proyeccion_id,vh.generacion_id,
                r.referencia_origen_id,MAX(r.secuencia_elemento) AS secuencia_registro
           FROM proyecciones_pol x
           JOIN registros_telemetria_remotos actual
             ON actual.proyeccion_id=x.proyeccion_id
            AND actual.generacion_id=x.generacion_actual_id
            AND actual.secuencia_elemento=x.secuencia_actual
            AND actual.tipo_registro='fotografiaPol'
            AND actual.estado_registro='presente'
           JOIN versiones_proyecciones_federacion vh
             ON vh.proyeccion_id=x.proyeccion_id
            AND vh.estado_publicacion IN ('actual','historica')
            AND vh.estado_autorizacion='autorizada'
            AND vh.ultima_secuencia_evaluada IS NOT NULL
           JOIN registros_telemetria_remotos r
             ON r.proyeccion_id=x.proyeccion_id
            AND r.generacion_id=vh.generacion_id
            AND r.secuencia_elemento<=vh.ultima_secuencia_evaluada
            AND r.tipo_registro='fotografiaPol'
            AND r.estado_registro='presente'
            AND r.referencia_origen_id IS NOT NULL
          GROUP BY x.proyeccion_id,vh.generacion_id,r.referencia_origen_id
       )
       SELECT p.proyeccion_id,p.installation_origen_id,p.elemento_origen_id,
              p.scope_nivel,p.scope_tenant_id,p.scope_empresa_id,p.scope_sitio_id,
              x.generacion_id AS generacion_actual_id,
              r.secuencia_elemento,r.tipo_registro,
              r.fuente_origen_id,r.senal_origen_id,r.tiempo_dato_utc,
              r.vigente_hasta_origen_utc,r.representacion_canonica,
              v.completitud_interpretable,v.completitud_observable,
              v.completitud_reconstruible,v.estado_vigencia,v.estado_soporte,
              v.estado_autorizacion
         FROM periodos_pol x
         JOIN proyecciones_federacion p ON p.proyeccion_id=x.proyeccion_id
         JOIN versiones_proyecciones_federacion v
           ON v.proyeccion_id=x.proyeccion_id AND v.generacion_id=x.generacion_id
         JOIN registros_telemetria_remotos r
           ON r.proyeccion_id=x.proyeccion_id
          AND r.generacion_id=x.generacion_id
          AND r.secuencia_elemento=x.secuencia_registro
        ORDER BY r.tiempo_dato_utc DESC,p.proyeccion_id
        LIMIT 500`,
      [installationOrigenId, ...filtro.parametros]
    );
    return Object.freeze(deduplicarPeriodosPol(filas.map(mapearRegistro))
      .filter((registro) => periodoPolSolapa(registro, desdeUtc, hastaUtc)));
  }

  async #listarTipos({ installationOrigenId, scope, limite, tipos, orden,
    senalOrigenId = null, desdeUtc = null, hastaUtc = null,
    tiposExentosFiltro = [] }) {
    const filtro = filtroScope(scope, 'p');
    const tiposValidados = validarTipos(tipos);
    const cteTipos = tiposValidados
      .map((tipo, indice) => `${indice === 0 ? 'SELECT' : 'UNION ALL SELECT'} '${tipo}' AS tipo_registro`)
      .join('\n         ');
    const filtrosDatos = construirFiltrosDatos({
      senalOrigenId, desdeUtc, hastaUtc, tiposExentosFiltro,
      alias: 'r0', preservarRetiradas: true
    });
    const filas = await this.clienteSql.consultar(
      `WITH tipos_resumen AS (
         ${cteTipos}
       ), registros_actuales AS (
         SELECT p.proyeccion_id,a.generacion_actual_id,t.tipo_registro,
                (SELECT MAX(r0.secuencia_elemento)
                   FROM registros_telemetria_remotos r0
                  WHERE r0.proyeccion_id=p.proyeccion_id
                    AND r0.generacion_id=a.generacion_actual_id
                    AND r0.secuencia_elemento<=v.ultima_secuencia_evaluada
                    AND (r0.tipo_registro=t.tipo_registro OR r0.estado_registro='retirado')
                    ${filtrosDatos.clausula}
                ) AS secuencia_registro
           FROM proyecciones_federacion p
           JOIN estados_actuales_proyecciones_federacion a
             ON a.proyeccion_id=p.proyeccion_id
           JOIN versiones_proyecciones_federacion v
             ON v.proyeccion_id=a.proyeccion_id
            AND v.generacion_id=a.generacion_actual_id
            AND v.estado_publicacion='actual'
           CROSS JOIN tipos_resumen t
          WHERE p.familia='telemetria' AND p.installation_origen_id=?
            AND v.estado_autorizacion='autorizada' AND ${filtro.clausula}
       )
       SELECT p.proyeccion_id,p.installation_origen_id,p.elemento_origen_id,
              p.scope_nivel,p.scope_tenant_id,p.scope_empresa_id,p.scope_sitio_id,
              x.generacion_actual_id,r.secuencia_elemento,r.tipo_registro,
              r.fuente_origen_id,r.senal_origen_id,r.tiempo_dato_utc,
              r.vigente_hasta_origen_utc,r.representacion_canonica,
              v.completitud_interpretable,v.completitud_observable,
              v.completitud_reconstruible,v.estado_vigencia,v.estado_soporte,
              v.estado_autorizacion
         FROM registros_actuales x
         JOIN proyecciones_federacion p ON p.proyeccion_id=x.proyeccion_id
         JOIN versiones_proyecciones_federacion v
           ON v.proyeccion_id=x.proyeccion_id AND v.generacion_id=x.generacion_actual_id
         JOIN registros_telemetria_remotos r
           ON r.proyeccion_id=x.proyeccion_id
          AND r.generacion_id=x.generacion_actual_id
          AND r.secuencia_elemento=x.secuencia_registro
          AND r.tipo_registro=x.tipo_registro
          AND r.estado_registro='presente'
        ORDER BY ${orden}
        LIMIT ?`,
      [...filtrosDatos.parametros, installationOrigenId, ...filtro.parametros,
        normalizarLimite(limite)]
    );
    return Object.freeze(filas.map(mapearRegistro));
  }
}

function construirFiltrosDatos({ senalOrigenId, desdeUtc, hastaUtc, tiposExentosFiltro,
  alias = 'r', preservarRetiradas = false }) {
  const condiciones = [];
  const parametros = [];
  const exentos = validarTiposExentos(tiposExentosFiltro);
  const envolver = (condicion) => {
    const filtrada = exentos.length === 0
      ? condicion
      : `(${alias}.tipo_registro IN (${exentos.map(() => '?').join(',')}) OR ${condicion})`;
    return preservarRetiradas
      ? `(${alias}.estado_registro='retirado' OR ${filtrada})`
      : filtrada;
  };
  const agregar = (condicion, valor) => {
    condiciones.push(envolver(condicion));
    parametros.push(...exentos, valor);
  };
  if (senalOrigenId) agregar(`${alias}.senal_origen_id=?`, senalOrigenId);
  if (desdeUtc) agregar(`${alias}.tiempo_dato_utc>=?`, fechaFiltro(desdeUtc));
  if (hastaUtc) agregar(`${alias}.tiempo_dato_utc<?`, fechaFiltro(hastaUtc));
  return {
    clausula: condiciones.length ? `\n          AND ${condiciones.join('\n          AND ')}` : '',
    parametros
  };
}

function fechaFiltro(valor) {
  const fecha = new Date(valor);
  if (Number.isNaN(fecha.getTime())) {
    throw new Error('La consulta portal contiene una fecha de telemetría inválida.');
  }
  return fecha;
}

function periodoPolSolapa(registro, desdeUtc, hastaUtc) {
  const inicio = Date.parse(registro.payload?.inicioUtc);
  const fin = Date.parse(registro.payload?.finUtc ||
    registro.payload?.ultimoHeartbeatUtc || registro.tiempoDatoUtc);
  if (!Number.isFinite(inicio) || !Number.isFinite(fin)) return false;
  if (desdeUtc && fin < Date.parse(desdeUtc)) return false;
  if (hastaUtc && inicio >= Date.parse(hastaUtc)) return false;
  return true;
}

function deduplicarPeriodosPol(registros) {
  const porPeriodo = new Map();
  for (const registro of registros) {
    const periodoOrigenId = registro.payload?.periodoPolOrigenId;
    if (!periodoOrigenId) continue;
    const existente = porPeriodo.get(periodoOrigenId);
    if (!existente || instanteFinalPol(registro) > instanteFinalPol(existente)) {
      porPeriodo.set(periodoOrigenId, registro);
    }
  }
  return [...porPeriodo.values()].sort((a, b) => instanteFinalPol(b) - instanteFinalPol(a));
}

function instanteFinalPol(registro) {
  const instante = Date.parse(registro.payload?.finUtc ||
    registro.payload?.ultimoHeartbeatUtc || registro.tiempoDatoUtc);
  return Number.isFinite(instante) ? instante : Number.NEGATIVE_INFINITY;
}

const TIPOS_PORTAL = new Set([
  'fuente', 'senal', 'observacion', 'fotografiaSenal', 'fotografiaPol',
  'eventoDerivado', 'rangoHistorico'
]);

function validarTipos(tipos) {
  if (!Array.isArray(tipos) || tipos.length === 0 || tipos.some((tipo) => !TIPOS_PORTAL.has(tipo))) {
    throw new Error('La consulta portal contiene tipos de telemetría no admitidos.');
  }
  return tipos;
}

function validarTiposExentos(tipos) {
  if (!Array.isArray(tipos) || tipos.some((tipo) => !TIPOS_PORTAL.has(tipo))) {
    throw new Error('La consulta portal contiene excepciones de filtro no admitidas.');
  }
  return tipos;
}

function filtroScope(scope, alias) {
  if (scope?.nivel === 'portal') return { clausula: '1=1', parametros: [] };
  if (!scope || !['tenant', 'empresa', 'sitio'].includes(scope.nivel)) {
    throw errorAcceso('scope_telemetria_remota_invalido');
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

function mapearRegistro(fila) {
  const payload = typeof fila.representacion_canonica === 'string'
    ? JSON.parse(fila.representacion_canonica)
    : fila.representacion_canonica;
  return Object.freeze({
    proyeccionId: fila.proyeccion_id,
    installationOrigenId: fila.installation_origen_id,
    elementoOrigenId: fila.elemento_origen_id,
    generacionId: fila.generacion_actual_id,
    secuenciaElemento: String(fila.secuencia_elemento),
    tipoRegistro: fila.tipo_registro,
    fuenteOrigenId: fila.fuente_origen_id,
    senalOrigenId: fila.senal_origen_id,
    tiempoDatoUtc: serializarFecha(fila.tiempo_dato_utc),
    vigenteHastaOrigenUtc: serializarFecha(fila.vigente_hasta_origen_utc),
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
    estadoPublicacion: Object.freeze({
      vigencia: fila.estado_vigencia,
      soporte: fila.estado_soporte,
      autorizacion: fila.estado_autorizacion
    }),
    payload: Object.freeze(payload)
  });
}

function normalizarLimite(valor) {
  const numero = Number(valor);
  return Number.isSafeInteger(numero) && numero >= 1 && numero <= 1000 ? numero : 1000;
}

function idScope(valor, campo) {
  const numero = Number(valor);
  if (!Number.isSafeInteger(numero) || numero < 1) throw errorAcceso(`scope_${campo}_invalido`);
  return numero;
}

function opcional(valor) {
  return valor === null || valor === undefined ? null : String(valor);
}

function serializarFecha(valor) {
  return valor === null || valor === undefined ? null : new Date(valor).toISOString();
}

function errorAcceso(codigo) {
  return Object.assign(new Error('El scope efectivo no permite consultar telemetría remota.'), {
    statusCode: 403,
    codigo
  });
}

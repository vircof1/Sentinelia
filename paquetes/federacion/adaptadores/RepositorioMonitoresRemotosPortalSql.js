export class RepositorioMonitoresRemotosPortalSql {
  constructor(clienteSql) {
    if (typeof clienteSql?.consultar !== 'function') {
      throw new Error('El inventario remoto de monitores requiere SQL operativo.');
    }
    this.clienteSql = clienteSql;
  }

  async listar({
    installationOrigenId,
    scope,
    limite = 200,
    monitorOrigenIds = null
  } = {}) {
    const filtroMonitores = filtroIdentidadesMonitores(monitorOrigenIds, 'p');
    if (filtroMonitores.vacio) return Object.freeze([]);
    const filtroDefiniciones = filtroScope(scope, 'p');
    const filtroEstados = filtroScope(scope, 'p');
    const filas = await this.clienteSql.consultar(
      `WITH definiciones_actuales AS (
         SELECT p.proyeccion_id,a.generacion_actual_id,v.ultima_secuencia_evaluada,
                (SELECT MAX(r0.secuencia_elemento)
                   FROM registros_monitores_remotos r0
                  WHERE r0.proyeccion_id=p.proyeccion_id
                    AND r0.generacion_id=a.generacion_actual_id
                    AND r0.secuencia_elemento<=v.ultima_secuencia_evaluada
                    AND (r0.tipo_registro='definicion' OR r0.estado_registro='retirado')
                ) AS secuencia_definicion
           FROM proyecciones_federacion p
           JOIN estados_actuales_proyecciones_federacion a
             ON a.proyeccion_id=p.proyeccion_id
           JOIN versiones_proyecciones_federacion v
             ON v.proyeccion_id=a.proyeccion_id
            AND v.generacion_id=a.generacion_actual_id
            AND v.estado_publicacion='actual'
          WHERE p.familia='monitores' AND p.installation_origen_id=?
            AND v.estado_autorizacion='autorizada' AND ${filtroDefiniciones.clausula}
       ), estados_actuales AS (
         SELECT p.proyeccion_id,a.generacion_actual_id,
                (SELECT MAX(r1.secuencia_elemento)
                   FROM registros_monitores_remotos r1
                  WHERE r1.proyeccion_id=p.proyeccion_id
                    AND r1.generacion_id=a.generacion_actual_id
                    AND r1.secuencia_elemento<=v.ultima_secuencia_evaluada
                    AND (r1.tipo_registro='estadoActual' OR r1.estado_registro='retirado')
                ) AS secuencia_estado
           FROM proyecciones_federacion p
           JOIN estados_actuales_proyecciones_federacion a
             ON a.proyeccion_id=p.proyeccion_id
           JOIN versiones_proyecciones_federacion v
             ON v.proyeccion_id=a.proyeccion_id
            AND v.generacion_id=a.generacion_actual_id
            AND v.estado_publicacion='actual'
          WHERE p.familia='monitores' AND p.installation_origen_id=?
            AND v.estado_autorizacion='autorizada' AND ${filtroEstados.clausula}
       ), estados_presentados AS (
         SELECT y.proyeccion_id,y.generacion_actual_id,s.secuencia_elemento,
                s.monitor_origen_id,s.estado_operativo,s.tiempo_dato_utc,
                s.vigente_hasta_origen_utc,s.representacion_canonica
           FROM estados_actuales y
           JOIN registros_monitores_remotos s
             ON s.proyeccion_id=y.proyeccion_id
            AND s.generacion_id=y.generacion_actual_id
            AND s.secuencia_elemento=y.secuencia_estado
            AND s.estado_registro='presente' AND s.tipo_registro='estadoActual'
       )
       SELECT p.proyeccion_id,p.installation_origen_id,p.elemento_origen_id,
              p.scope_nivel,p.scope_tenant_id,p.scope_empresa_id,p.scope_sitio_id,
              d.secuencia_elemento,
              JSON_UNQUOTE(JSON_EXTRACT(d.representacion_canonica,'$.nombre')) AS nombre,
              JSON_UNQUOTE(JSON_EXTRACT(d.representacion_canonica,'$.tipo')) AS tipo_monitor,
              NULLIF(JSON_UNQUOTE(JSON_EXTRACT(
                d.representacion_canonica,'$.descripcion'
              )),'null') AS descripcion,
              JSON_EXTRACT(d.representacion_canonica,'$.activo') AS activo,
              JSON_EXTRACT(d.representacion_canonica,'$.intervaloEjecucionSegundos') AS intervalo_segundos,
              JSON_UNQUOTE(JSON_EXTRACT(d.representacion_canonica,'$.interpretacionEstado')) AS interpretacion_estado,
              JSON_UNQUOTE(JSON_EXTRACT(d.representacion_canonica,'$.contextoHumano.descripcionFallo')) AS descripcion_fallo,
              JSON_UNQUOTE(JSON_EXTRACT(d.representacion_canonica,'$.contextoHumano.posibleSolucion')) AS posible_solucion,
              s.proyeccion_id AS estado_proyeccion_id,s.secuencia_elemento AS estado_secuencia,
              s.estado_operativo,s.tiempo_dato_utc,s.vigente_hasta_origen_utc,
              JSON_EXTRACT(s.representacion_canonica,'$.ejecutadoTodavia') AS ejecutado_todavia,
              NULLIF(JSON_UNQUOTE(JSON_EXTRACT(
                s.representacion_canonica,'$.versionCatalogo'
              )),'null') AS version_catalogo,
              NULLIF(JSON_UNQUOTE(JSON_EXTRACT(
                s.representacion_canonica,'$.motivoInicial'
              )),'null') AS motivo_inicial,
              NULLIF(JSON_UNQUOTE(JSON_EXTRACT(
                s.representacion_canonica,'$.fechaUltimaEjecucionUtc'
              )),'null') AS ultima_ejecucion_utc,
              NULLIF(JSON_UNQUOTE(JSON_EXTRACT(
                s.representacion_canonica,'$.fechaUltimoCambioUtc'
              )),'null') AS ultimo_cambio_utc,
              NULLIF(JSON_UNQUOTE(JSON_EXTRACT(
                s.representacion_canonica,'$.contextoHumano.descripcionFallo'
              )),'null') AS estado_descripcion_fallo,
              NULLIF(JSON_UNQUOTE(JSON_EXTRACT(
                s.representacion_canonica,'$.contextoHumano.posibleSolucion'
              )),'null') AS estado_posible_solucion,
              t.condicion AS condicion_temporal,t.vigente_hasta_efectiva_utc,
              v.completitud_interpretable,v.completitud_observable,
              v.completitud_reconstruible
         FROM definiciones_actuales x
         JOIN proyecciones_federacion p ON p.proyeccion_id=x.proyeccion_id
         JOIN versiones_proyecciones_federacion v
           ON v.proyeccion_id=x.proyeccion_id AND v.generacion_id=x.generacion_actual_id
         JOIN registros_monitores_remotos d
           ON d.proyeccion_id=x.proyeccion_id AND d.generacion_id=x.generacion_actual_id
          AND d.secuencia_elemento=x.secuencia_definicion
          AND d.estado_registro='presente' AND d.tipo_registro='definicion'
         LEFT JOIN estados_presentados s
           ON s.monitor_origen_id=p.elemento_origen_id
         LEFT JOIN estados_temporales_fotografias_remotas t
          ON t.proyeccion_id=s.proyeccion_id
          AND t.generacion_id=s.generacion_actual_id
          AND t.secuencia_estado=s.secuencia_elemento
        WHERE ${filtroMonitores.clausula}
        ORDER BY nombre,p.elemento_origen_id
        LIMIT ?`,
      [
        installationOrigenId, ...filtroDefiniciones.parametros,
        installationOrigenId, ...filtroEstados.parametros,
        ...filtroMonitores.parametros,
        normalizarLimite(limite)
      ]
    );
    return Object.freeze(filas.map(mapear));
  }

  async listarHistorico({ installationOrigenId, monitorOrigenId, scope, limite = 100 } = {}) {
    const filtro = filtroScope(scope, 'p');
    const filas = await this.clienteSql.consultar(
      `WITH registros_publicados AS (
         SELECT p.proyeccion_id,a.generacion_actual_id,v.ultima_secuencia_evaluada,
                (SELECT MAX(r0.secuencia_elemento)
                   FROM registros_monitores_remotos r0
                  WHERE r0.proyeccion_id=p.proyeccion_id
                    AND r0.generacion_id=a.generacion_actual_id
                    AND r0.secuencia_elemento<=v.ultima_secuencia_evaluada
                    AND (r0.tipo_registro IN ('evento','tramoHistorico','rangoHistorico')
                         OR r0.estado_registro='retirado')) AS secuencia_registro
           FROM proyecciones_federacion p
           JOIN estados_actuales_proyecciones_federacion a
             ON a.proyeccion_id=p.proyeccion_id
           JOIN versiones_proyecciones_federacion v
             ON v.proyeccion_id=a.proyeccion_id
            AND v.generacion_id=a.generacion_actual_id
            AND v.estado_publicacion='actual'
          WHERE p.familia='monitores' AND p.installation_origen_id=?
            AND v.estado_autorizacion='autorizada' AND ${filtro.clausula}
       )
       SELECT r.tipo_registro,r.estado_operativo,r.tiempo_dato_utc,
              NULLIF(JSON_UNQUOTE(JSON_EXTRACT(r.representacion_canonica,'$.estadoDetectado')),'null') AS estado_detectado,
              NULLIF(JSON_UNQUOTE(JSON_EXTRACT(r.representacion_canonica,'$.codigoResultado')),'null') AS codigo_resultado,
              NULLIF(JSON_UNQUOTE(JSON_EXTRACT(r.representacion_canonica,'$.mensajeResultado')),'null') AS mensaje_resultado,
              JSON_EXTRACT(r.representacion_canonica,'$.exito') AS exito,
              JSON_EXTRACT(r.representacion_canonica,'$.duracionTotalMs') AS duracion_total_ms,
              NULLIF(JSON_UNQUOTE(JSON_EXTRACT(r.representacion_canonica,'$.ejecutadoEnUtc')),'null') AS ejecutado_en_utc,
              NULLIF(JSON_UNQUOTE(JSON_EXTRACT(r.representacion_canonica,'$.estadoTramo')),'null') AS estado_tramo,
              NULLIF(JSON_UNQUOTE(JSON_EXTRACT(r.representacion_canonica,'$.codigoUltimoResultado')),'null') AS codigo_ultimo_resultado,
              NULLIF(JSON_UNQUOTE(JSON_EXTRACT(r.representacion_canonica,'$.mensajeUltimoResultado')),'null') AS mensaje_ultimo_resultado,
              NULLIF(JSON_UNQUOTE(JSON_EXTRACT(r.representacion_canonica,'$.validoDesdeUtc')),'null') AS valido_desde_utc,
              NULLIF(JSON_UNQUOTE(JSON_EXTRACT(r.representacion_canonica,'$.validoHastaUtc')),'null') AS valido_hasta_utc,
              JSON_EXTRACT(r.representacion_canonica,'$.contadorRepeticiones') AS contador_repeticiones,
              NULLIF(JSON_UNQUOTE(JSON_EXTRACT(r.representacion_canonica,'$.desdeUtc')),'null') AS rango_desde_utc,
              NULLIF(JSON_UNQUOTE(JSON_EXTRACT(r.representacion_canonica,'$.hastaUtc')),'null') AS rango_hasta_utc,
              NULLIF(JSON_UNQUOTE(JSON_EXTRACT(r.representacion_canonica,'$.causa')),'null') AS causa_rango,
              NULLIF(JSON_UNQUOTE(JSON_EXTRACT(r.representacion_canonica,'$.contextoHumano.descripcionFallo')),'null') AS descripcion_fallo,
              NULLIF(JSON_UNQUOTE(JSON_EXTRACT(r.representacion_canonica,'$.contextoHumano.posibleSolucion')),'null') AS posible_solucion
         FROM registros_publicados x
         JOIN proyecciones_federacion p ON p.proyeccion_id=x.proyeccion_id
         JOIN registros_monitores_remotos r
           ON r.proyeccion_id=x.proyeccion_id
          AND r.generacion_id=x.generacion_actual_id
          AND r.secuencia_elemento=x.secuencia_registro
          AND r.estado_registro='presente'
        WHERE r.monitor_origen_id=?
          AND r.tipo_registro IN ('evento','tramoHistorico','rangoHistorico')
        ORDER BY COALESCE(
          NULLIF(JSON_UNQUOTE(JSON_EXTRACT(r.representacion_canonica,'$.ejecutadoEnUtc')),'null'),
          NULLIF(JSON_UNQUOTE(JSON_EXTRACT(r.representacion_canonica,'$.validoDesdeUtc')),'null'),
          NULLIF(JSON_UNQUOTE(JSON_EXTRACT(r.representacion_canonica,'$.desdeUtc')),'null'),
          r.tiempo_dato_utc
        ) DESC,r.proyeccion_id
        LIMIT ?`,
      [installationOrigenId, ...filtro.parametros, monitorOrigenId, normalizarLimite(limite)]
    );
    return Object.freeze(filas.map(mapearHistorico));
  }

  async listarAlertas({ installationOrigenId, monitorOrigenId, scope, limite = 100 } = {}) {
    const filtro = filtroScope(scope, 'p');
    const filas = await this.clienteSql.consultar(
      `WITH alertas_publicadas AS (
         SELECT p.proyeccion_id,a.generacion_actual_id,
                (SELECT MAX(r0.secuencia_elemento)
                   FROM registros_monitores_remotos r0
                  WHERE r0.proyeccion_id=p.proyeccion_id
                    AND r0.generacion_id=a.generacion_actual_id
                    AND r0.secuencia_elemento<=v.ultima_secuencia_evaluada
                    AND (r0.tipo_registro='alerta' OR r0.estado_registro='retirado')
                ) AS secuencia_alerta
           FROM proyecciones_federacion p
           JOIN estados_actuales_proyecciones_federacion a
             ON a.proyeccion_id=p.proyeccion_id
           JOIN versiones_proyecciones_federacion v
             ON v.proyeccion_id=a.proyeccion_id
            AND v.generacion_id=a.generacion_actual_id
            AND v.estado_publicacion='actual'
          WHERE p.familia='monitores' AND p.installation_origen_id=?
            AND v.estado_autorizacion='autorizada' AND ${filtro.clausula}
       )
       SELECT p.proyeccion_id,r.alerta_auditoria_id,r.estado_operativo,
              r.tiempo_dato_utc,r.vigente_hasta_origen_utc,
              JSON_UNQUOTE(JSON_EXTRACT(r.representacion_canonica,'$.estadoDetectado')) AS estado_detectado,
              JSON_UNQUOTE(JSON_EXTRACT(r.representacion_canonica,'$.codigoUltimoResultado')) AS codigo_resultado,
              JSON_UNQUOTE(JSON_EXTRACT(r.representacion_canonica,'$.mensajeUltimoResultado')) AS mensaje_resultado,
              JSON_UNQUOTE(JSON_EXTRACT(r.representacion_canonica,'$.validoDesdeUtc')) AS valido_desde_utc,
              JSON_UNQUOTE(JSON_EXTRACT(r.representacion_canonica,'$.ultimaConfirmacionUtc')) AS ultima_confirmacion_utc,
              JSON_UNQUOTE(JSON_EXTRACT(r.representacion_canonica,'$.ultimaEjecucionUtc')) AS ultima_ejecucion_utc,
              NULLIF(JSON_UNQUOTE(JSON_EXTRACT(
                r.representacion_canonica,'$.cerradaEnUtc'
              )),'null') AS cerrada_en_utc,
              JSON_EXTRACT(r.representacion_canonica,'$.contadorRepeticiones') AS contador_repeticiones,
              JSON_EXTRACT(r.representacion_canonica,'$.descarteOrigen.descartada') AS descartada_origen,
              NULLIF(JSON_UNQUOTE(JSON_EXTRACT(
                r.representacion_canonica,'$.descarteOrigen.motivo'
              )),'null') AS motivo_descarte_origen,
              NULLIF(JSON_UNQUOTE(JSON_EXTRACT(
                r.representacion_canonica,'$.descarteOrigen.descartadaEnUtc'
              )),'null') AS descartada_en_origen_utc,
              NULLIF(JSON_UNQUOTE(JSON_EXTRACT(
                r.representacion_canonica,'$.descarteOrigen.descartadaHastaUtc'
              )),'null') AS descartada_hasta_origen_utc,
              NULLIF(JSON_UNQUOTE(JSON_EXTRACT(
                r.representacion_canonica,'$.contextoHumano.descripcionFallo'
              )),'null') AS descripcion_fallo,
              NULLIF(JSON_UNQUOTE(JSON_EXTRACT(
                r.representacion_canonica,'$.contextoHumano.posibleSolucion'
              )),'null') AS posible_solucion,
              v.completitud_interpretable,v.completitud_observable,
              v.completitud_reconstruible
         FROM alertas_publicadas x
         JOIN proyecciones_federacion p ON p.proyeccion_id=x.proyeccion_id
         JOIN versiones_proyecciones_federacion v
           ON v.proyeccion_id=x.proyeccion_id AND v.generacion_id=x.generacion_actual_id
         JOIN registros_monitores_remotos r
           ON r.proyeccion_id=x.proyeccion_id
          AND r.generacion_id=x.generacion_actual_id
          AND r.secuencia_elemento=x.secuencia_alerta
          AND r.estado_registro='presente' AND r.tipo_registro='alerta'
        WHERE r.monitor_origen_id=?
        ORDER BY COALESCE(
          NULLIF(JSON_UNQUOTE(JSON_EXTRACT(r.representacion_canonica,'$.cerradaEnUtc')),'null'),
          JSON_UNQUOTE(JSON_EXTRACT(r.representacion_canonica,'$.ultimaConfirmacionUtc')),
          r.tiempo_dato_utc
        ) DESC,r.proyeccion_id
        LIMIT ?`,
      [installationOrigenId, ...filtro.parametros, monitorOrigenId, normalizarLimite(limite)]
    );
    return Object.freeze(filas.map(mapearAlerta));
  }

  async listarReferenciasTriggers({
    installationOrigenId, monitorOrigenId, scope, limite = 100
  } = {}) {
    const filtro = filtroScope(scope, 'p');
    const filas = await this.clienteSql.consultar(
      `WITH referencias_publicadas AS (
         SELECT p.proyeccion_id,a.generacion_actual_id,
                (SELECT MAX(r0.secuencia_elemento)
                   FROM registros_monitores_remotos r0
                  WHERE r0.proyeccion_id=p.proyeccion_id
                    AND r0.generacion_id=a.generacion_actual_id
                    AND r0.secuencia_elemento<=v.ultima_secuencia_evaluada
                    AND (r0.tipo_registro='referenciaTrigger' OR r0.estado_registro='retirado')
                ) AS secuencia_referencia
           FROM proyecciones_federacion p
           JOIN estados_actuales_proyecciones_federacion a
             ON a.proyeccion_id=p.proyeccion_id
           JOIN versiones_proyecciones_federacion v
             ON v.proyeccion_id=a.proyeccion_id
            AND v.generacion_id=a.generacion_actual_id
            AND v.estado_publicacion='actual'
          WHERE p.familia='monitores' AND p.installation_origen_id=?
            AND v.estado_autorizacion='autorizada' AND ${filtro.clausula}
       )
       SELECT p.proyeccion_id,p.elemento_origen_id,r.referencia_origen_id,
              JSON_UNQUOTE(JSON_EXTRACT(r.representacion_canonica,'$.visibilidad')) AS visibilidad,
              JSON_EXTRACT(r.representacion_canonica,'$.activo') AS activo,
              JSON_EXTRACT(r.representacion_canonica,'$.ordenEjecucion') AS orden_ejecucion,
              JSON_EXTRACT(r.representacion_canonica,'$.eventosDisparo') AS eventos_disparo,
              v.completitud_interpretable,v.completitud_observable,
              v.completitud_reconstruible
         FROM referencias_publicadas x
         JOIN proyecciones_federacion p ON p.proyeccion_id=x.proyeccion_id
         JOIN versiones_proyecciones_federacion v
           ON v.proyeccion_id=x.proyeccion_id AND v.generacion_id=x.generacion_actual_id
         JOIN registros_monitores_remotos r
           ON r.proyeccion_id=x.proyeccion_id
          AND r.generacion_id=x.generacion_actual_id
          AND r.secuencia_elemento=x.secuencia_referencia
          AND r.estado_registro='presente' AND r.tipo_registro='referenciaTrigger'
        WHERE r.monitor_origen_id=?
        ORDER BY orden_ejecucion,r.referencia_origen_id,p.proyeccion_id
        LIMIT ?`,
      [installationOrigenId, ...filtro.parametros, monitorOrigenId, normalizarLimite(limite)]
    );
    return Object.freeze(filas.map(mapearReferenciaTrigger));
  }
}

function filtroIdentidadesMonitores(valores, alias) {
  if (valores === null || valores === undefined) {
    return { clausula: '1=1', parametros: [], vacio: false };
  }
  if (!Array.isArray(valores)) throw errorAcceso('filtro_monitores_remotos_invalido');
  const identidades = [...new Set(valores.map((valor) => String(valor || '').trim()))]
    .filter(Boolean);
  if (identidades.length === 0) {
    return { clausula: '1=0', parametros: [], vacio: true };
  }
  if (identidades.length > 500) throw errorAcceso('filtro_monitores_remotos_excesivo');
  return {
    clausula: `${alias}.elemento_origen_id IN (${identidades.map(() => '?').join(',')})`,
    parametros: identidades,
    vacio: false
  };
}

function filtroScope(scope, alias) {
  if (scope?.nivel === 'portal') return { clausula: '1=1', parametros: [] };
  if (!scope || !['tenant', 'empresa', 'sitio'].includes(scope.nivel)) {
    throw errorAcceso('scope_monitores_remotos_invalido');
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
  const tieneEstado = fila.estado_proyeccion_id !== null;
  return Object.freeze({
    proyeccionId: fila.proyeccion_id,
    installationOrigenId: fila.installation_origen_id,
    elementoOrigenId: fila.elemento_origen_id,
    nombre: fila.nombre || 'Monitor remoto',
    tipo: fila.tipo_monitor || 'desconocido',
    descripcion: fila.descripcion || null,
    activo: booleanoJson(fila.activo),
    intervaloSegundos: Number(fila.intervalo_segundos || 0),
    interpretacionEstado: fila.interpretacion_estado || null,
    contextoHumano: Object.freeze({
      descripcionFallo: fila.descripcion_fallo || null,
      posibleSolucion: fila.posible_solucion || null
    }),
    scopeRecepcion: Object.freeze({
      nivel: fila.scope_nivel,
      tenantId: opcional(fila.scope_tenant_id),
      empresaId: opcional(fila.scope_empresa_id),
      sitioId: opcional(fila.scope_sitio_id)
    }),
    estadoActual: tieneEstado ? Object.freeze({
      proyeccionId: fila.estado_proyeccion_id,
      estado: fila.estado_operativo,
      ejecutadoTodavia: booleanoJson(fila.ejecutado_todavia),
      versionCatalogo: fila.version_catalogo || null,
      motivoInicial: fila.motivo_inicial || null,
      ultimaEjecucionUtc: iso(fila.ultima_ejecucion_utc || fila.tiempo_dato_utc),
      ultimoCambioUtc: iso(fila.ultimo_cambio_utc),
      vigenteHastaOrigenUtc: iso(fila.vigente_hasta_origen_utc),
      vigenteHastaEfectivaUtc: iso(fila.vigente_hasta_efectiva_utc),
      condicion: fila.condicion_temporal || 'sinConsolidar',
      contextoHumano: Object.freeze({
        descripcionFallo: fila.estado_descripcion_fallo || null,
        posibleSolucion: fila.estado_posible_solucion || null
      })
    }) : null,
    completitud: Object.freeze({
      interpretable: fila.completitud_interpretable,
      observable: fila.completitud_observable,
      reconstruible: fila.completitud_reconstruible
    })
  });
}

function mapearHistorico(fila) {
  const comun = {
    tipoRegistro: fila.tipo_registro,
    estado: fila.estado_detectado || fila.estado_tramo || fila.estado_operativo || null,
    codigo: fila.codigo_resultado || fila.codigo_ultimo_resultado || null,
    mensaje: fila.mensaje_resultado || fila.mensaje_ultimo_resultado || null,
    contextoHumano: Object.freeze({
      descripcionFallo: fila.descripcion_fallo || null,
      posibleSolucion: fila.posible_solucion || null
    })
  };
  if (fila.tipo_registro === 'evento') {
    return Object.freeze({
      ...comun,
      fechaUtc: iso(fila.ejecutado_en_utc || fila.tiempo_dato_utc),
      exito: booleanoJson(fila.exito),
      duracionTotalMs: numeroOpcional(fila.duracion_total_ms)
    });
  }
  if (fila.tipo_registro === 'tramoHistorico') {
    return Object.freeze({
      ...comun,
      fechaUtc: iso(fila.valido_desde_utc || fila.tiempo_dato_utc),
      desdeUtc: iso(fila.valido_desde_utc),
      hastaUtc: iso(fila.valido_hasta_utc),
      repeticiones: numeroOpcional(fila.contador_repeticiones)
    });
  }
  return Object.freeze({
    ...comun,
    fechaUtc: iso(fila.rango_desde_utc || fila.tiempo_dato_utc),
    desdeUtc: iso(fila.rango_desde_utc),
    hastaUtc: iso(fila.rango_hasta_utc),
    causa: fila.causa_rango || null
  });
}

function mapearAlerta(fila) {
  const estado = fila.estado_operativo;
  const vigenteHastaOrigenUtc = iso(fila.vigente_hasta_origen_utc);
  const condicion = estado === 'cerrada'
    ? 'cerrada'
    : vigenteHastaOrigenUtc !== null && Date.parse(vigenteHastaOrigenUtc) > Date.now()
      ? 'vigente'
      : 'vencida';
  return Object.freeze({
    proyeccionId: fila.proyeccion_id,
    alertaAuditoriaId: fila.alerta_auditoria_id,
    estado,
    condicion,
    estadoDetectado: fila.estado_detectado || null,
    codigo: fila.codigo_resultado || null,
    mensaje: fila.mensaje_resultado || null,
    validoDesdeUtc: iso(fila.valido_desde_utc),
    ultimaConfirmacionUtc: iso(fila.ultima_confirmacion_utc || fila.tiempo_dato_utc),
    ultimaEjecucionUtc: iso(fila.ultima_ejecucion_utc),
    cerradaEnUtc: iso(fila.cerrada_en_utc),
    vigenteHastaOrigenUtc,
    repeticiones: numeroOpcional(fila.contador_repeticiones),
    descarteOrigen: Object.freeze({
      descartada: booleanoJson(fila.descartada_origen),
      motivo: fila.motivo_descarte_origen || null,
      descartadaEnUtc: iso(fila.descartada_en_origen_utc),
      descartadaHastaUtc: iso(fila.descartada_hasta_origen_utc)
    }),
    contextoHumano: Object.freeze({
      descripcionFallo: fila.descripcion_fallo || null,
      posibleSolucion: fila.posible_solucion || null
    }),
    completitud: Object.freeze({
      interpretable: fila.completitud_interpretable,
      observable: fila.completitud_observable,
      reconstruible: fila.completitud_reconstruible
    })
  });
}

function mapearReferenciaTrigger(fila) {
  return Object.freeze({
    proyeccionId: fila.proyeccion_id,
    elementoOrigenId: fila.elemento_origen_id,
    triggerOrigenId: fila.referencia_origen_id,
    visibilidad: fila.visibilidad || 'opaca',
    activo: booleanoJson(fila.activo),
    ordenEjecucion: numeroOpcional(fila.orden_ejecucion) ?? 0,
    eventosDisparo: Object.freeze(jsonLista(fila.eventos_disparo)),
    completitud: Object.freeze({
      interpretable: fila.completitud_interpretable,
      observable: fila.completitud_observable,
      reconstruible: fila.completitud_reconstruible
    })
  });
}

function idScope(valor, campo) {
  const numero = Number(valor);
  if (!Number.isSafeInteger(numero) || numero < 1) throw errorAcceso(`scope_${campo}_invalido`);
  return numero;
}

function normalizarLimite(valor) {
  const numero = Number(valor);
  return Number.isSafeInteger(numero) && numero > 0 ? Math.min(numero, 200) : 200;
}

function booleanoJson(valor) {
  return valor === true || valor === 1 || valor === '1' || valor === 'true';
}

function opcional(valor) {
  return valor === null || valor === undefined ? null : String(valor);
}

function numeroOpcional(valor) {
  if (valor === null || valor === undefined || valor === '') return null;
  const numero = Number(valor);
  return Number.isFinite(numero) ? numero : null;
}

function jsonLista(valor) {
  if (Array.isArray(valor)) return [...valor];
  if (typeof valor !== 'string' || valor === '') return [];
  try {
    const lista = JSON.parse(valor);
    return Array.isArray(lista) ? lista : [];
  } catch {
    return [];
  }
}

function iso(valor) {
  if (valor === null || valor === undefined || valor === '') return null;
  if (valor instanceof Date) return valor.toISOString();
  const texto = String(valor);
  return new Date(`${texto.replace(' ', 'T').replace(/Z$/u, '')}Z`).toISOString();
}

function errorAcceso(codigo) {
  return Object.assign(new Error('El scope no permite listar monitores remotos.'), {
    codigo,
    statusCode: 403
  });
}

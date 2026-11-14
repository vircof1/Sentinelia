import {
  crearIdentidadFederada,
  TIPOS_IDENTIDAD_FEDERADA
} from '../src/IdentidadFederada.js';

export class RepositorioDiagnosticoFederacionPortalSql {
  constructor(clienteSql) {
    if (typeof clienteSql?.consultar !== 'function') {
      throw new Error('El diagnóstico federado requiere SQL de lectura.');
    }
    this.clienteSql = clienteSql;
  }

  async obtener({ scope, relacionId = null } = {}) {
    const { sql: filtroScope, parametros: parametrosScope } = filtroScopeRelacion(scope);
    const relacion = relacionId === null
      ? null
      : String(crearIdentidadFederada(relacionId, TIPOS_IDENTIDAD_FEDERADA.RELACION));
    const consultaRelaciones = `SELECT r.relacion_id,r.direccion,r.estado_ciclo,r.estado_autoridad,
              r.estado_identidad,r.estado_compatibilidad,
              r.installation_remota_id,r.nombre_remoto_declarado,
              r.scope_tenant_id,r.scope_empresa_id,r.scope_sitio_id,
              r.actualizada_en_utc,
              h.ultimo_heartbeat_utc AS ultima_recepcion_utc,
              a.ultimo_intento_utc,a.ultima_actividad_autenticada_utc,
              a.ultimo_error_codigo,a.fallos_consecutivos,
              (SELECT COUNT(*) FROM flujos_federacion f
                WHERE f.relacion_id=r.relacion_id) AS total_flujos,
              (SELECT COUNT(*) FROM estados_diagnostico_relaciones_federacion d
                WHERE d.relacion_id=r.relacion_id AND d.condicion_activa=TRUE)
                AS total_diagnosticos_activos
         FROM relaciones_federacion r
         LEFT JOIN estado_salud_relaciones_federacion h
           ON h.relacion_id=r.relacion_id AND r.direccion='recepcion'
         LEFT JOIN actividad_emision_relaciones_federacion a
           ON a.relacion_id=r.relacion_id AND r.direccion='emision'
        WHERE ${filtroScope}`;
    const relaciones = await this.clienteSql.consultar(
      `${consultaRelaciones}
       ORDER BY r.actualizada_en_utc DESC,r.relacion_id LIMIT 100`,
      parametrosScope
    );
    let listaMutable = relaciones.map(mapearRelacion);
    let seleccionada = relacion === null
      ? listaMutable[0] ?? null
      : listaMutable.find((item) => item.relacionId === relacion) ?? null;
    if (relacion !== null && seleccionada === null) {
      const exactas = await this.clienteSql.consultar(
        `${consultaRelaciones} AND r.relacion_id=? LIMIT 1`,
        [...parametrosScope, relacion]
      );
      if (exactas[0]) {
        seleccionada = mapearRelacion(exactas[0]);
        listaMutable = [seleccionada, ...listaMutable];
      }
    }
    const lista = Object.freeze(listaMutable);
    if (!seleccionada) {
      return Object.freeze({ relaciones: lista, detalle: null });
    }
    return Object.freeze({
      relaciones: lista,
      detalle: await this.#obtenerDetalle(seleccionada)
    });
  }

  async #obtenerDetalle(relacion) {
    const relacionId = relacion.relacionId;
    const [flujosFilas, diagnosticos] = await Promise.all([
      this.clienteSql.consultar(
        `SELECT f.flujo_id,f.direccion,f.familia,f.version_familia,
                f.scope_nivel,f.scope_tenant_id,f.scope_empresa_id,
                f.scope_sitio_id,f.estado,f.generacion_activa_id,
                f.version_estado,f.actualizada_en_utc,
                COALESCE(SUM(o.estado IN ('pendiente','procesando','reintentable')),0)
                  AS pendientes,
                COALESCE(SUM(o.estado='bloqueada'),0) AS bloqueadas
           FROM flujos_federacion f
           LEFT JOIN outbox_federacion o
             ON o.flujo_id=f.flujo_id
            AND o.generacion_id=f.generacion_activa_id
            AND f.direccion='emision'
          WHERE f.relacion_id=?
          GROUP BY f.flujo_id,f.direccion,f.familia,f.version_familia,
                   f.scope_nivel,f.scope_tenant_id,f.scope_empresa_id,
                   f.scope_sitio_id,f.estado,f.generacion_activa_id,
                   f.version_estado,f.actualizada_en_utc
          ORDER BY f.familia,f.flujo_id LIMIT 100`,
        [relacionId]
      ),
      this.clienteSql.consultar(
        `SELECT version_catalogo,tipo_codigo,causa_codigo,condicion_activa,
                efectivo_en_utc,aplicado_en_utc,actualizado_en_utc
           FROM estados_diagnostico_relaciones_federacion
          WHERE relacion_id=?
          ORDER BY condicion_activa DESC,actualizado_en_utc DESC LIMIT 500`,
        [relacionId]
      )
    ]);
    const flujos = Object.freeze(flujosFilas.map(mapearFlujo));
    const flujoIds = flujos.map((flujo) => flujo.flujoId);
    if (flujoIds.length === 0) {
      return Object.freeze({
        relacion,
        flujos,
        generaciones: Object.freeze([]),
        huecos: Object.freeze([]),
        recorridos: Object.freeze([]),
        divergencias: Object.freeze([]),
        diagnosticos: Object.freeze(diagnosticos.map(mapearDiagnostico)),
        limitesLectura: limitesLectura()
      });
    }
    const marcadores = flujoIds.map(() => '?').join(',');
    const [generacionesFilas, rangosFilas, huecosFilas, contribucionesFilas,
      divergenciasFilas] = await Promise.all([
      this.clienteSql.consultar(
        `SELECT g.flujo_id,g.generacion_id,g.ordinal,g.clase,g.estado,
                g.installation_propietaria_id,g.boot_propietario_id,
                g.version_propietario,g.creada_en_utc,g.actualizada_en_utc,
                g.finalizada_en_utc,
                fr.posicion_inicial_comprometida,
                fr.posicion_operativa_validada,fr.posicion_historica_validada,
                fr.sincronizando,fr.operativamente_completa,
                fr.historicamente_completa,fr.parcial_por_scope,fr.degradada,
                cr.posicion_terminal_contigua AS cursor_receptor_posicion,
                cr.frontera_inicial AS cursor_receptor_frontera,
                cr.frontera_inicial_recorrida,
                cr.frontera_inicial_degradada,cr.prefijo_degradado,
                cr.version_cursor AS cursor_receptor_version,
                ce.posicion_terminal_contigua AS cursor_emisor_local,
                ce.posicion_terminal_remota AS cursor_emisor_remoto,
                ce.version_cursor_remoto,ce.pausa_hasta_utc,ce.causa_pausa,
                ra.generacion_predecesora_id,ra.causa AS resincronizacion_causa,
                ra.estado AS resincronizacion_estado,
                ra.intentos_solicitud AS resincronizacion_intentos
           FROM generaciones_flujos_federacion g
           LEFT JOIN fronteras_generaciones_federacion fr
             ON fr.generacion_id=g.generacion_id
           LEFT JOIN cursores_generaciones_recepcion_federacion cr
             ON cr.generacion_id=g.generacion_id
           LEFT JOIN control_generaciones_emision_federacion ce
             ON ce.generacion_id=g.generacion_id
           LEFT JOIN resincronizaciones_automaticas_federacion ra
             ON ra.generacion_id=g.generacion_id
          WHERE g.flujo_id IN (${marcadores})
          ORDER BY g.flujo_id,g.ordinal DESC LIMIT 500`,
        flujoIds
      ),
      this.clienteSql.consultar(
        `SELECT c.flujo_id,r.generacion_id,r.inicio_posicion,r.fin_posicion,
                r.contiene_degradacion,r.actualizado_en_utc
           FROM rangos_terminales_recepcion_federacion r
           JOIN cursores_generaciones_recepcion_federacion c
             ON c.generacion_id=r.generacion_id
          WHERE c.flujo_id IN (${marcadores})
          ORDER BY c.flujo_id,r.generacion_id,r.inicio_posicion LIMIT 1000`,
        flujoIds
      ),
      this.clienteSql.consultar(
        `SELECT declaracion_id,flujo_id,generacion_id,
                installation_declarante_id,familia,tipo,inicio_posicion,
                fin_posicion,causa,rutas_alternativas_agotadas,
                declarada_en_origen_utc,recibida_en_utc,aplicada_cursor_en_utc
           FROM declaraciones_disponibilidad_federacion
          WHERE relacion_id=? AND tipo IN ('huecoRecuperable','huecoIrrecuperable')
          ORDER BY recibida_en_utc DESC LIMIT 200`,
        [relacionId]
      ),
      this.clienteSql.consultar(
        `SELECT c.contribucion_id,c.proyeccion_id,c.installation_emisora_id,
                c.boot_emisor_ultimo_id,c.longitud_recorrido,
                c.estado_autoridad,c.estado_identidad,c.estado_compatibilidad,
                c.estado_integridad,c.veces_observada,
                c.ultima_comunicacion_valida_utc,p.familia,p.elemento_origen_id
           FROM contribuciones_proyecciones_federacion c
           JOIN proyecciones_federacion p ON p.proyeccion_id=c.proyeccion_id
          WHERE c.relacion_id=?
          ORDER BY c.ultima_comunicacion_valida_utc DESC,c.contribucion_id
          LIMIT 200`,
        [relacionId]
      ),
      this.clienteSql.consultar(
        `SELECT d.id,d.proyeccion_id,d.generacion_detectada_id,
                d.secuencia_ambigua,d.estado,d.generacion_frontera_coherente_id,
                d.secuencia_frontera_coherente,d.estado_vigencia_frontera,
                d.veces_observada,d.primera_deteccion_utc,
                d.ultima_deteccion_utc,d.resuelta_en_utc,
                p.familia,p.elemento_origen_id,
                (SELECT COUNT(*) FROM variantes_divergencias_proyecciones_federacion v
                  WHERE v.divergencia_id=d.id) AS total_variantes
           FROM divergencias_proyecciones_federacion d
           JOIN proyecciones_federacion p ON p.proyeccion_id=d.proyeccion_id
          WHERE EXISTS (
            SELECT 1 FROM contribuciones_proyecciones_federacion c
             WHERE c.proyeccion_id=d.proyeccion_id AND c.relacion_id=?
          )
          ORDER BY FIELD(d.estado,'abierta','esperandoResincronizacion',
                                  'resueltaEvidencia','resueltaExclusionResincronizada'),
                   d.ultima_deteccion_utc DESC
          LIMIT 200`,
        [relacionId]
      )
    ]);
    const recorridos = await cargarRecorridos(
      this.clienteSql,
      contribucionesFilas
    );
    const rangosPorGeneracion = agrupar(rangosFilas, 'generacion_id');
    return Object.freeze({
      relacion,
      flujos,
      generaciones: Object.freeze(generacionesFilas.map((fila) =>
        mapearGeneracion(fila, rangosPorGeneracion.get(fila.generacion_id) || [])
      )),
      huecos: Object.freeze(huecosFilas.map((fila) => mapearHueco(
        fila,
        flujos.find((flujo) => flujo.flujoId === fila.flujo_id)
      ))),
      recorridos,
      divergencias: Object.freeze(divergenciasFilas.map(mapearDivergencia)),
      diagnosticos: Object.freeze(diagnosticos.map(mapearDiagnostico)),
      limitesLectura: limitesLectura()
    });
  }
}

async function cargarRecorridos(clienteSql, contribuciones) {
  if (contribuciones.length === 0) return Object.freeze([]);
  const ids = contribuciones.map((fila) => fila.contribucion_id);
  const saltos = await clienteSql.consultar(
    `SELECT contribucion_id,ordinal,installation_id
       FROM recorrido_contribuciones_federacion
      WHERE contribucion_id IN (${ids.map(() => '?').join(',')})
      ORDER BY contribucion_id,ordinal`,
    ids
  );
  const porContribucion = agrupar(saltos, 'contribucion_id');
  return Object.freeze(contribuciones.map((fila) => Object.freeze({
    contribucionId: fila.contribucion_id,
    proyeccionId: fila.proyeccion_id,
    familia: fila.familia,
    elementoOrigenId: fila.elemento_origen_id,
    installationEmisoraId: fila.installation_emisora_id,
    bootEmisorUltimoId: fila.boot_emisor_ultimo_id,
    longitudDeclarada: String(fila.longitud_recorrido),
    estados: Object.freeze({
      autoridad: fila.estado_autoridad,
      identidad: fila.estado_identidad,
      compatibilidad: fila.estado_compatibilidad,
      integridad: fila.estado_integridad
    }),
    vecesObservada: String(fila.veces_observada),
    ultimaComunicacionValidaUtc: fechaIso(fila.ultima_comunicacion_valida_utc),
    saltos: Object.freeze((porContribucion.get(fila.contribucion_id) || []).map(
      (salto) => Object.freeze({
        ordinal: String(salto.ordinal),
        installationId: salto.installation_id
      })
    ))
  })));
}

function mapearRelacion(fila) {
  const ultimaComunicacion = fila.direccion === 'recepcion'
    ? fila.ultima_recepcion_utc
    : fila.ultima_actividad_autenticada_utc;
  return Object.freeze({
    relacionId: fila.relacion_id,
    direccion: fila.direccion,
    installationRemotaId: fila.installation_remota_id,
    nombreRemoto: fila.nombre_remoto_declarado ?? null,
    estados: Object.freeze({
      ciclo: fila.estado_ciclo,
      autoridad: fila.estado_autoridad,
      identidad: fila.estado_identidad,
      compatibilidad: fila.estado_compatibilidad ?? 'pendiente'
    }),
    scope: scope(fila),
    ultimaComunicacionUtc: fechaIso(ultimaComunicacion),
    ultimoIntentoUtc: fechaIso(fila.ultimo_intento_utc),
    ultimoErrorCodigo: fila.ultimo_error_codigo ?? null,
    fallosConsecutivos: Number(fila.fallos_consecutivos || 0),
    totalFlujos: Number(fila.total_flujos || 0),
    totalDiagnosticosActivos: Number(fila.total_diagnosticos_activos || 0),
    actualizadaEnUtc: fechaIso(fila.actualizada_en_utc)
  });
}

function mapearFlujo(fila) {
  return Object.freeze({
    flujoId: fila.flujo_id,
    direccion: fila.direccion,
    familia: fila.familia,
    versionFamilia: Number(fila.version_familia),
    scope: Object.freeze({ nivel: fila.scope_nivel, ...scope(fila) }),
    estado: fila.estado,
    generacionActivaId: fila.generacion_activa_id ?? null,
    versionEstado: String(fila.version_estado),
    pendientes: Number(fila.pendientes || 0),
    bloqueadas: Number(fila.bloqueadas || 0),
    actualizadaEnUtc: fechaIso(fila.actualizada_en_utc)
  });
}

function mapearGeneracion(fila, rangos) {
  return Object.freeze({
    flujoId: fila.flujo_id,
    generacionId: fila.generacion_id,
    ordinal: String(fila.ordinal),
    clase: fila.clase,
    estado: fila.estado,
    installationPropietariaId: fila.installation_propietaria_id,
    bootPropietarioId: fila.boot_propietario_id,
    versionPropietario: String(fila.version_propietario),
    frontera: fila.posicion_inicial_comprometida == null ? null : Object.freeze({
      inicial: String(fila.posicion_inicial_comprometida),
      operativa: opcional(fila.posicion_operativa_validada),
      historica: opcional(fila.posicion_historica_validada),
      sincronizando: Boolean(fila.sincronizando),
      operativamenteCompleta: Boolean(fila.operativamente_completa),
      historicamenteCompleta: Boolean(fila.historicamente_completa),
      parcialPorScope: Boolean(fila.parcial_por_scope),
      degradada: Boolean(fila.degradada)
    }),
    cursorReceptor: fila.cursor_receptor_posicion == null ? null : Object.freeze({
      posicionTerminalContigua: String(fila.cursor_receptor_posicion),
      fronteraInicial: String(fila.cursor_receptor_frontera),
      fronteraInicialRecorrida: Boolean(fila.frontera_inicial_recorrida),
      fronteraInicialDegradada: Boolean(fila.frontera_inicial_degradada),
      prefijoDegradado: Boolean(fila.prefijo_degradado),
      version: String(fila.cursor_receptor_version),
      rangosDispersos: Object.freeze(rangos.map((rango) => Object.freeze({
        inicio: String(rango.inicio_posicion),
        fin: String(rango.fin_posicion),
        contieneDegradacion: Boolean(rango.contiene_degradacion)
      })))
    }),
    cursorEmisor: fila.cursor_emisor_local == null ? null : Object.freeze({
      posicionTerminalLocal: String(fila.cursor_emisor_local),
      posicionTerminalRemota: String(fila.cursor_emisor_remoto),
      versionRemota: String(fila.version_cursor_remoto),
      pausaHastaUtc: fechaIso(fila.pausa_hasta_utc),
      causaPausa: fila.causa_pausa ?? null
    }),
    resincronizacion: fila.resincronizacion_estado == null ? null : Object.freeze({
      generacionPredecesoraId: fila.generacion_predecesora_id,
      causa: fila.resincronizacion_causa,
      estado: fila.resincronizacion_estado,
      intentos: Number(fila.resincronizacion_intentos)
    }),
    creadaEnUtc: fechaIso(fila.creada_en_utc),
    actualizadaEnUtc: fechaIso(fila.actualizada_en_utc),
    finalizadaEnUtc: fechaIso(fila.finalizada_en_utc)
  });
}

function mapearHueco(fila, flujo) {
  return Object.freeze({
    declaracionId: fila.declaracion_id,
    flujoId: fila.flujo_id,
    generacionId: fila.generacion_id,
    familia: fila.familia,
    installationDeclaranteId: fila.installation_declarante_id,
    tipo: fila.tipo,
    inicio: String(fila.inicio_posicion),
    fin: String(fila.fin_posicion),
    causa: fila.causa,
    rutasAlternativasAgotadas: Boolean(fila.rutas_alternativas_agotadas),
    aplicadaAlCursor: fila.aplicada_cursor_en_utc !== null,
    restauracionDetenida: fila.causa === 'restauracionIncoherente' &&
      flujo?.estado === 'detenido',
    declaradaEnOrigenUtc: fechaIso(fila.declarada_en_origen_utc),
    recibidaEnUtc: fechaIso(fila.recibida_en_utc)
  });
}

function mapearDivergencia(fila) {
  return Object.freeze({
    divergenciaId: String(fila.id),
    proyeccionId: fila.proyeccion_id,
    familia: fila.familia,
    elementoOrigenId: fila.elemento_origen_id,
    generacionDetectadaId: fila.generacion_detectada_id,
    secuenciaAmbigua: String(fila.secuencia_ambigua),
    estado: fila.estado,
    fronteraCoherente: fila.generacion_frontera_coherente_id === null
      ? null
      : Object.freeze({
          generacionId: fila.generacion_frontera_coherente_id,
          secuencia: String(fila.secuencia_frontera_coherente),
          vigencia: fila.estado_vigencia_frontera
        }),
    totalVariantes: Number(fila.total_variantes || 0),
    vecesObservada: String(fila.veces_observada),
    primeraDeteccionUtc: fechaIso(fila.primera_deteccion_utc),
    ultimaDeteccionUtc: fechaIso(fila.ultima_deteccion_utc),
    resueltaEnUtc: fechaIso(fila.resuelta_en_utc)
  });
}

function mapearDiagnostico(fila) {
  return Object.freeze({
    versionCatalogo: Number(fila.version_catalogo),
    tipo: fila.tipo_codigo,
    causa: fila.causa_codigo,
    activa: Boolean(fila.condicion_activa),
    efectivoEnUtc: fechaIso(fila.efectivo_en_utc),
    aplicadoEnUtc: fechaIso(fila.aplicado_en_utc),
    actualizadoEnUtc: fechaIso(fila.actualizado_en_utc)
  });
}

function limitesLectura() {
  return Object.freeze({
    relacionesSugeridas: 100,
    flujos: 100,
    generaciones: 500,
    rangosDispersos: 1000,
    huecos: 200,
    recorridos: 200,
    divergencias: 200,
    transicionesDiagnosticas: 500
  });
}

function filtroScopeRelacion(scopeActual) {
  if (!scopeActual || !['portal', 'tenant', 'empresa', 'sitio'].includes(scopeActual.nivel)) {
    throw prohibido('scope_diagnostico_invalido', 'El scope diagnóstico no es válido.');
  }
  const condiciones = [];
  const parametros = [];
  if (scopeActual.nivel !== 'portal') {
    condiciones.push('r.scope_tenant_id=?');
    parametros.push(exigirId(scopeActual.tenantId, 'tenantId'));
  }
  if (['empresa', 'sitio'].includes(scopeActual.nivel)) {
    condiciones.push('r.scope_empresa_id=?');
    parametros.push(exigirId(scopeActual.empresaId, 'empresaId'));
  }
  if (scopeActual.nivel === 'sitio') {
    condiciones.push('r.scope_sitio_id=?');
    parametros.push(exigirId(scopeActual.sitioId, 'sitioId'));
  }
  return {
    sql: condiciones.length ? condiciones.join(' AND ') : '1=1',
    parametros
  };
}

function exigirId(valor, campo) {
  if (!/^[1-9][0-9]*$/u.test(String(valor ?? ''))) {
    throw prohibido('scope_diagnostico_incompleto', `El ${campo} efectivo no es válido.`);
  }
  return valor;
}

function scope(fila) {
  return Object.freeze({
    tenantId: opcional(fila.scope_tenant_id),
    empresaId: opcional(fila.scope_empresa_id),
    sitioId: opcional(fila.scope_sitio_id)
  });
}

function agrupar(filas, campo) {
  const mapa = new Map();
  for (const fila of filas) {
    const clave = fila[campo];
    if (!mapa.has(clave)) mapa.set(clave, []);
    mapa.get(clave).push(fila);
  }
  return mapa;
}

function opcional(valor) {
  return valor === null || valor === undefined ? null : String(valor);
}

function fechaIso(valor) {
  if (valor === null || valor === undefined) return null;
  const fecha = valor instanceof Date ? valor : new Date(valor);
  return Number.isNaN(fecha.getTime()) ? null : fecha.toISOString();
}

function prohibido(codigo, mensaje) {
  const error = new Error(mensaje);
  error.codigo = codigo;
  error.statusCode = 403;
  return error;
}

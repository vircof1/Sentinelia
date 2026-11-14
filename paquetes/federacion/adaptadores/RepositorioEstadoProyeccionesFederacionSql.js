import { canonicalizarJsonFederacion } from '../src/CanonicalizadorFederacion.js';
import {
  evaluarCompletitudFederacion,
  evaluarDimensionesProyeccionFederada
} from '../src/EstadoProyeccionFederacion.js';
import {
  crearIdentidadFederada,
  TIPOS_IDENTIDAD_FEDERADA
} from '../src/IdentidadFederada.js';

const ESTADOS_MATERIALIZACION = new Set(['pendiente', 'materializada', 'fallida']);

export class ErrorEstadoProyeccionFederacionSql extends Error {
  constructor(codigo, mensaje) {
    super(mensaje);
    this.name = 'ErrorEstadoProyeccionFederacionSql';
    this.codigo = codigo;
  }
}

export class RepositorioEstadoProyeccionesFederacionSql {
  constructor(clienteSql, { repositorioDivergencias = null } = {}) {
    if (!clienteSql?.obtenerConexion) {
      throw new Error('El estado de proyecciones federadas requiere SQL operativo.');
    }
    if (repositorioDivergencias !== null &&
        typeof repositorioDivergencias?.autorizarContinuidadEnTransaccion !== 'function') {
      throw new Error('El estado requiere un puerto válido de divergencias.');
    }
    this.clienteSql = clienteSql;
    this.repositorioDivergencias = repositorioDivergencias;
  }

  async prepararEnTransaccion({ proyeccionId, generacionId } = {}, { conexion } = {}) {
    exigirConexion(conexion);
    await exigirTransaccionActiva(conexion);
    const proyeccion = identidad(proyeccionId, TIPOS_IDENTIDAD_FEDERADA.PROYECCION);
    const generacion = identidad(generacionId, TIPOS_IDENTIDAD_FEDERADA.GENERACION);
    const existente = await obtenerVersionOpcional(
      conexion,
      proyeccion,
      generacion,
      true
    );
    if (existente) return existente;
    const ahora = await ahoraSql(conexion);
    await conexion.execute(
      `INSERT INTO versiones_proyecciones_federacion (
         proyeccion_id,generacion_id,estado_publicacion,
         estado_materializacion,completitud_interpretable,
         completitud_observable,completitud_reconstruible,estado_vigencia,
         estado_soporte,estado_autorizacion,cierre_operativo_validado,
         recepcion_confirmada,ultima_secuencia_evaluada,
         ultima_evaluacion_id,version_estado,creada_en_utc,
         actualizada_en_utc,publicada_en_utc,finalizada_en_utc
       ) VALUES (
         ?,?,'preparando','pendiente','parcial','parcial','parcial',
         'vencida','huerfana','noAutorizada',FALSE,FALSE,NULL,NULL,1,?,?,NULL,NULL
       )`,
      [proyeccion, generacion, ahora, ahora]
    );
    return obtenerVersion(conexion, proyeccion, generacion, true);
  }

  async registrarResultadoEnTransaccion({
    entregaId,
    estadoMaterializacion,
    requisitosPorCapacidad = null,
    cierreOperativoValidado = false
  } = {}, { conexion } = {}) {
    exigirConexion(conexion);
    await exigirTransaccionActiva(conexion);
    const entrega = identidad(entregaId, TIPOS_IDENTIDAD_FEDERADA.ENTREGA);
    if (!ESTADOS_MATERIALIZACION.has(estadoMaterializacion)) {
      fallar('estado_materializacion_invalido', 'El resultado materializado no es contractual.');
    }
    if (typeof cierreOperativoValidado !== 'boolean') {
      fallar(
        'cierre_operativo_invalido',
        'El cierre operativo validado debe declararse como booleano estricto.'
      );
    }
    const trabajo = await obtenerContextoTrabajo(conexion, entrega);
    if (!trabajo) {
      fallar('trabajo_proyeccion_inexistente', 'No existe el trabajo que evalúa la proyección.');
    }
    const version = await this.prepararEnTransaccion({
      proyeccionId: trabajo.proyeccion_id,
      generacionId: trabajo.generacion_id
    }, { conexion });
    const confirmada = await recepcionConfirmada(conexion, entrega);
    if (!confirmada) {
      fallar(
        'recepcion_no_confirmada',
        'Una proyección no puede evaluarse antes de su confirmación durable.'
      );
    }
    const ahora = await ahoraSql(conexion);
    const actualAntes = await obtenerEstadoActualBloqueado(
      conexion,
      trabajo.proyeccion_id
    );
    const ultimaSecuenciaGlobal = maximaSecuencia(
      version.ultima_secuencia_evaluada,
      actualAntes?.ultima_secuencia_evaluada
    );
    const secuenciaObsoleta = ultimaSecuenciaGlobal !== null &&
      BigInt(trabajo.secuencia_elemento) < BigInt(ultimaSecuenciaGlobal);
    const consolidacionTardia = trabajo.clase_trabajo === 'consolidacion' &&
      secuenciaObsoleta && actualAntes !== null;
    const versionCompletitud = consolidacionTardia ? actualAntes : version;
    const fronteraEvaluacion = consolidacionTardia
      ? String(actualAntes.ultima_secuencia_evaluada)
      : trabajo.secuencia_elemento;
    const completitud = requisitosPorCapacidad === null || consolidacionTardia
      ? completitudDesdeVersion(versionCompletitud)
      : evaluarCompletitudFederacion(requisitosPorCapacidad);
    const contribuciones = await obtenerContribuciones(
      conexion,
      trabajo.proyeccion_id,
      fronteraEvaluacion,
      ahora
    );
    const retiradaOrigen = await existeRetiradaOrigen(
      conexion,
      trabajo.proyeccion_id
    );
    const dimensiones = evaluarDimensionesProyeccionFederada({
      materializacion: estadoMaterializacion,
      autoridadActual: contribuciones.some((item) => item.legitima),
      retiradaOrigen,
      contribuciones
    });
    const cierre = consolidacionTardia
      ? Boolean(actualAntes.cierre_operativo_validado)
      : Boolean(cierreOperativoValidado);
    const causas = Object.fromEntries(Object.entries(completitud).map(
      ([capacidad, valor]) => [capacidad, valor.causas]
    ));
    const requisitosCanonicos = requisitosPorCapacidad === null || consolidacionTardia
      ? canonicalizarJsonFederacion({
        heredados: true,
        causa: consolidacionTardia ? 'consolidacionTardia' : 'solicitudExplicita'
      })
      : canonicalizarJsonFederacion(requisitosPorCapacidad);
    const [evaluacion] = await conexion.execute(
      `INSERT INTO evaluaciones_dimensiones_proyecciones_federacion (
         proyeccion_id,generacion_id,trabajo_entrega_id,
         estado_materializacion,completitud_interpretable,
         completitud_observable,completitud_reconstruible,estado_vigencia,
         estado_soporte,estado_autorizacion,cierre_operativo_validado,
         recepcion_confirmada,requisitos_canonicos,causas_canonicas,
         evaluada_en_utc
       ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [
        trabajo.proyeccion_id,
        trabajo.generacion_id,
        entrega,
        dimensiones.materializacion,
        completitud.interpretable.estado,
        completitud.observable.estado,
        completitud.reconstruible.estado,
        dimensiones.vigencia,
        dimensiones.soporte,
        dimensiones.autorizacion,
        cierre,
        true,
        requisitosCanonicos,
        canonicalizarJsonFederacion(causas),
        ahora
      ]
    );
    const cierreTardio = version.estado_publicacion === 'historica' ||
      trabajo.rol_generacion === 'historica';
    if (cierreTardio || (secuenciaObsoleta && !consolidacionTardia)) {
      return Object.freeze({
        proyeccionId: trabajo.proyeccion_id,
        generacionId: trabajo.generacion_id,
        evaluacionId: String(evaluacion.insertId),
        dimensiones: Object.freeze({
          materializacion: dimensiones.materializacion,
          completitud,
          vigencia: dimensiones.vigencia,
          soporte: dimensiones.soporte,
          autorizacion: dimensiones.autorizacion
        }),
        publicada: false,
        sustituyoGeneracionId: null,
        cierreTardio,
        secuenciaObsoleta
      });
    }
    const publicable = esPublicable({ dimensiones, completitud, cierre });
    const retiraPublicacion = debeRetirarPublicacion({
      dimensiones,
      cierre,
      estadoMaterializacion
    });
    if (estadoMaterializacion !== 'materializada' ||
        (!publicable && !retiraPublicacion)) {
      if (version.estado_publicacion === 'preparando') {
        await actualizarVersionPreparando(conexion, {
          version,
          dimensiones,
          completitud,
          cierre,
          evaluacionId: String(evaluacion.insertId),
          secuenciaElemento: trabajo.secuencia_elemento,
          avanzarSecuencia: estadoMaterializacion === 'materializada',
          ahora
        });
      }
      return Object.freeze({
        proyeccionId: trabajo.proyeccion_id,
        generacionId: trabajo.generacion_id,
        evaluacionId: String(evaluacion.insertId),
        dimensiones: Object.freeze({
          materializacion: dimensiones.materializacion,
          completitud,
          vigencia: dimensiones.vigencia,
          soporte: dimensiones.soporte,
          autorizacion: dimensiones.autorizacion
        }),
        publicada: false,
        sustituyoGeneracionId: null,
        preservoPublicacionActual: version.estado_publicacion === 'actual'
      });
    }
    const continuidad = this.repositorioDivergencias
      ? await this.repositorioDivergencias.autorizarContinuidadEnTransaccion({
        proyeccionId: trabajo.proyeccion_id,
        generacionId: trabajo.generacion_id,
        inboxId: trabajo.inbox_ocurrencia_id,
        secuenciaElemento: trabajo.secuencia_elemento
      }, { conexion })
      : { autorizada: true, resueltas: [] };
    if (!continuidad.autorizada) {
      return Object.freeze({
        proyeccionId: trabajo.proyeccion_id,
        generacionId: trabajo.generacion_id,
        evaluacionId: String(evaluacion.insertId),
        dimensiones: Object.freeze({
          materializacion: dimensiones.materializacion,
          completitud,
          vigencia: dimensiones.vigencia,
          soporte: dimensiones.soporte,
          autorizacion: dimensiones.autorizacion
        }),
        publicada: false,
        sustituyoGeneracionId: null,
        bloqueadaPorDivergencia: true
      });
    }
    const fronteraActualPreservada = version.estado_publicacion === 'actual' &&
        version.estado_coherencia === 'coherente' &&
        version.ultima_secuencia_evaluada !== null;
    if (fronteraActualPreservada) {
      await preservarFronteraCoherente(conexion, version, ahora);
    }
    const [actualizacionVersion] = await conexion.execute(
      `UPDATE versiones_proyecciones_federacion
          SET estado_materializacion=?,completitud_interpretable=?,
              completitud_observable=?,completitud_reconstruible=?,
              estado_vigencia=?,estado_soporte=?,estado_autorizacion=?,
              estado_coherencia='coherente',
              cierre_operativo_validado=?,recepcion_confirmada=TRUE,
              ultima_secuencia_evaluada=GREATEST(
                COALESCE(ultima_secuencia_evaluada,0),?
              ),
              ultima_evaluacion_id=?,version_estado=version_estado+1,
              actualizada_en_utc=?
        WHERE proyeccion_id=? AND generacion_id=?
          AND estado_publicacion<>'historica'`,
      [
        dimensiones.materializacion,
        completitud.interpretable.estado,
        completitud.observable.estado,
        completitud.reconstruible.estado,
        dimensiones.vigencia,
        dimensiones.soporte,
        dimensiones.autorizacion,
        cierre,
        trabajo.secuencia_elemento,
        String(evaluacion.insertId),
        ahora,
        trabajo.proyeccion_id,
        trabajo.generacion_id
      ]
    );
    if (actualizacionVersion.affectedRows !== 1) {
      fallar('version_no_actualizable', 'La versión dejó de admitir evaluaciones actuales.');
    }
    const publicacion = publicable
      ? await publicarVersion(conexion, {
        proyeccionId: trabajo.proyeccion_id,
        generacionId: trabajo.generacion_id,
        secuenciaMaxima: fronteraEvaluacion,
        ahora
      })
      : retiraPublicacion
        ? await retirarPublicacionActual(conexion, {
          proyeccionId: trabajo.proyeccion_id,
          generacionId: trabajo.generacion_id,
          secuenciaMaxima: fronteraEvaluacion,
          ahora,
          preservarFrontera: !fronteraActualPreservada
        })
        : { publicada: false, sustituyoGeneracionId: null };
    return Object.freeze({
      proyeccionId: trabajo.proyeccion_id,
      generacionId: trabajo.generacion_id,
      evaluacionId: String(evaluacion.insertId),
      dimensiones: Object.freeze({
        materializacion: dimensiones.materializacion,
        completitud,
        vigencia: dimensiones.vigencia,
        soporte: dimensiones.soporte,
        autorizacion: dimensiones.autorizacion
      }),
      ...publicacion
    });
  }

  async obtenerActual(proyeccionId) {
    const proyeccion = identidad(proyeccionId, TIPOS_IDENTIDAD_FEDERADA.PROYECCION);
    const filas = await this.clienteSql.consultar(
      `SELECT v.*,e.version_publicacion
         FROM estados_actuales_proyecciones_federacion e
         JOIN versiones_proyecciones_federacion v
           ON v.proyeccion_id=e.proyeccion_id
          AND v.generacion_id=e.generacion_actual_id
        WHERE e.proyeccion_id=?`,
      [proyeccion]
    );
    return filas[0] ? mapearVersion(filas[0]) : null;
  }
}

async function obtenerContextoTrabajo(conexion, entregaId) {
  const [filas] = await conexion.execute(
    `SELECT t.entrega_id,t.inbox_ocurrencia_id,t.generacion_id,
            t.secuencia_elemento,t.operacion,t.proyeccion_id,
            t.clase_trabajo,g.rol_generacion
       FROM trabajos_materializacion_federacion t
       JOIN generaciones_flujos_federacion g
         ON g.flujo_id=t.flujo_id AND g.generacion_id=t.generacion_id
      WHERE t.entrega_id=? FOR UPDATE`,
    [entregaId]
  );
  return filas[0] || null;
}

async function recepcionConfirmada(conexion, entregaId) {
  const [filas] = await conexion.execute(
    `SELECT COUNT(*) AS total
       FROM resultados_entregas_recepcion_federacion r
       JOIN intentos_lotes_recepcion_federacion i ON i.id=r.intento_id
      WHERE r.entrega_id=? AND r.clasificacion='terminal'
        AND r.confirmada=TRUE`,
    [entregaId]
  );
  return Number(filas[0].total) > 0;
}

async function obtenerContribuciones(
  conexion,
  proyeccionId,
  secuenciaMaxima,
  ahora
) {
  const [filas] = await conexion.execute(
    `WITH aportes_activos AS (
       SELECT c.contribucion_id,c.estado_soporte,
              c.estado_autoridad AS autoridad_observada,
              c.estado_identidad AS identidad_observada,
              c.estado_compatibilidad AS compatibilidad_observada,
              r.estado_ciclo,r.estado_autoridad,r.estado_identidad,
              r.estado_compatibilidad,v.estado AS estado_revision,
              a.vigencia_restante_recepcion_ms,a.primera_observacion_utc,
              i.secuencia_elemento,
              ROW_NUMBER() OVER (
                PARTITION BY c.contribucion_id
                ORDER BY i.secuencia_elemento DESC,
                         a.primera_observacion_utc DESC,
                         a.inbox_ocurrencia_id DESC
              ) AS ordinal_vigencia
         FROM contribuciones_proyecciones_federacion c
         JOIN relaciones_federacion r ON r.relacion_id=c.relacion_id
         JOIN revisiones_concesion_federacion v
           ON v.relacion_id=c.relacion_id
          AND v.revision_id=c.revision_concesion_id
         JOIN aportes_ocurrencias_contribuciones_federacion a
           ON a.contribucion_id=c.contribucion_id
         JOIN inbox_ocurrencias_federacion i
           ON i.id=a.inbox_ocurrencia_id
         JOIN flujos_federacion f
           ON f.flujo_id=a.flujo_id
          AND f.generacion_activa_id=a.generacion_id
        WHERE c.proyeccion_id=? AND i.secuencia_elemento<=?
     )
     SELECT contribucion_id,estado_soporte,
            autoridad_observada,identidad_observada,
            compatibilidad_observada,
            estado_ciclo,estado_autoridad,estado_identidad,
            estado_compatibilidad,estado_revision,
            (
              vigencia_restante_recepcion_ms IS NULL
              OR vigencia_restante_recepcion_ms>
                  FLOOR(GREATEST(
                    TIMESTAMPDIFF(MICROSECOND,primera_observacion_utc,?),0
                  )/1000)
            ) AS vigente
       FROM aportes_activos c
      WHERE ordinal_vigencia=1`,
    [proyeccionId, secuenciaMaxima, ahora]
  );
  const campos = await obtenerCamposPorContribucion(
    conexion,
    proyeccionId,
    secuenciaMaxima
  );
  return filas.map((fila) => ({
    contribucionId: crearIdentidadFederada({
      tipo: TIPOS_IDENTIDAD_FEDERADA.CONTRIBUCION,
      valor: fila.contribucion_id
    }),
    legitima: fila.estado_soporte === 'activa' &&
      fila.autoridad_observada === 'autorizada' &&
      fila.identidad_observada === 'valida' &&
      ['compatible', 'compatibleParcial'].includes(fila.compatibilidad_observada) &&
      fila.estado_ciclo === 'vinculada' &&
      fila.estado_autoridad === 'autorizada' &&
      fila.estado_identidad === 'valida' &&
      fila.estado_compatibilidad !== 'incompatible' &&
      fila.estado_revision === 'vigente',
    vigente: Boolean(fila.vigente),
    retirada: fila.estado_soporte === 'retirada',
    campos: campos.get(fila.contribucion_id) || []
  }));
}

async function obtenerCamposPorContribucion(
  conexion,
  proyeccionId,
  secuenciaMaxima
) {
  const [filas] = await conexion.execute(
    `WITH eventos_hasta_frontera AS (
       SELECT e.contribucion_id,e.generacion_id,e.nombre_sha256,
              e.nombre_campo,e.tipo,
              ROW_NUMBER() OVER (
                PARTITION BY e.contribucion_id,e.generacion_id,e.nombre_sha256
                ORDER BY e.secuencia_elemento DESC,e.id DESC
              ) AS ordinal_campo
         FROM eventos_soporte_campos_federacion e
        WHERE e.proyeccion_id=? AND e.secuencia_elemento IS NOT NULL
          AND e.secuencia_elemento<=?
     )
     SELECT s.contribucion_id,s.nombre_campo
       FROM eventos_hasta_frontera s
       JOIN contribuciones_proyecciones_federacion c
         ON c.contribucion_id=s.contribucion_id
       JOIN generaciones_flujos_federacion g
         ON g.generacion_id=s.generacion_id
       JOIN flujos_federacion f
         ON f.flujo_id=g.flujo_id
        AND f.generacion_activa_id=g.generacion_id
      WHERE c.proyeccion_id=? AND s.ordinal_campo=1
        AND s.tipo IN ('aportado','actualizado')`,
    [proyeccionId, secuenciaMaxima, proyeccionId]
  );
  const resultado = new Map();
  for (const fila of filas) {
    const camposContribucion = resultado.get(fila.contribucion_id) || new Set();
    camposContribucion.add(fila.nombre_campo);
    resultado.set(fila.contribucion_id, camposContribucion);
  }
  return new Map([...resultado].map(([contribucionId, nombres]) => [
    contribucionId,
    [...nombres]
  ]));
}

async function existeRetiradaOrigen(conexion, proyeccionId) {
  const [filas] = await conexion.execute(
    `SELECT COUNT(*) AS total
       FROM retiradas_origen_proyecciones_federacion
      WHERE proyeccion_id=?`,
    [proyeccionId]
  );
  return Number(filas[0].total) > 0;
}

async function actualizarVersionPreparando(conexion, {
  version,
  dimensiones,
  completitud,
  cierre,
  evaluacionId,
  secuenciaElemento,
  avanzarSecuencia,
  ahora
}) {
  const [resultado] = await conexion.execute(
    `UPDATE versiones_proyecciones_federacion
        SET estado_materializacion=?,completitud_interpretable=?,
            completitud_observable=?,completitud_reconstruible=?,
            estado_vigencia=?,estado_soporte=?,estado_autorizacion=?,
            cierre_operativo_validado=?,recepcion_confirmada=TRUE,
            ultima_secuencia_evaluada=IF(?,GREATEST(
              COALESCE(ultima_secuencia_evaluada,0),?
            ),ultima_secuencia_evaluada),
            ultima_evaluacion_id=?,version_estado=version_estado+1,
            actualizada_en_utc=?
      WHERE proyeccion_id=? AND generacion_id=?
        AND estado_publicacion='preparando' AND version_estado=?`,
    [
      dimensiones.materializacion,
      completitud.interpretable.estado,
      completitud.observable.estado,
      completitud.reconstruible.estado,
      dimensiones.vigencia,
      dimensiones.soporte,
      dimensiones.autorizacion,
      cierre,
      avanzarSecuencia,
      secuenciaElemento,
      evaluacionId,
      ahora,
      version.proyeccion_id,
      version.generacion_id,
      String(version.version_estado)
    ]
  );
  if (resultado.affectedRows !== 1) {
    fallar(
      'version_preparando_concurrente',
      'La versión en preparación cambió antes de registrar su diagnóstico.'
    );
  }
}

async function publicarVersion(conexion, {
  proyeccionId,
  generacionId,
  secuenciaMaxima,
  ahora
}) {
  const [punteros] = await conexion.execute(
    `SELECT * FROM estados_actuales_proyecciones_federacion
      WHERE proyeccion_id=? FOR UPDATE`,
    [proyeccionId]
  );
  const anterior = punteros[0]?.generacion_actual_id || null;
  let secuenciaAnterior = null;
  if (anterior && anterior !== generacionId) {
    const versionAnterior = await obtenerVersion(
      conexion,
      proyeccionId,
      anterior,
      true
    );
    if (versionAnterior.ultima_secuencia_evaluada !== null &&
        BigInt(versionAnterior.ultima_secuencia_evaluada) > BigInt(secuenciaMaxima)) {
      return Object.freeze({
        publicada: false,
        sustituyoGeneracionId: null,
        retrocesoEvitado: true
      });
    }
    if (versionAnterior.estado_coherencia === 'coherente' &&
        versionAnterior.ultima_secuencia_evaluada !== null) {
      await preservarFronteraCoherente(conexion, versionAnterior, ahora);
    }
    secuenciaAnterior = versionAnterior.ultima_secuencia_evaluada;
    await desactivarVersionActual(conexion, {
      version: versionAnterior,
      ahora
    });
  }
  await reemplazarFotografiaCampos(conexion, {
    proyeccionId,
    generacionId,
    secuenciaMaxima,
    ahora
  });
  await reemplazarConsolidadoActual(conexion, { proyeccionId, generacionId, ahora });
  const [promocion] = await conexion.execute(
    `UPDATE versiones_proyecciones_federacion
        SET estado_publicacion='actual',publicada_en_utc=COALESCE(publicada_en_utc,?),
            ultima_secuencia_evaluada=GREATEST(
              COALESCE(ultima_secuencia_evaluada,0),?
            ),
            version_estado=version_estado+1,actualizada_en_utc=?
      WHERE proyeccion_id=? AND generacion_id=?
        AND estado_publicacion IN ('preparando','actual')`,
    [
      ahora,
      secuenciaAnterior ?? '0',
      ahora,
      proyeccionId,
      generacionId
    ]
  );
  if (promocion.affectedRows !== 1) {
    fallar('version_no_publicable', 'La versión dejó de ser publicable durante el cierre.');
  }
  const versionPublicacion = await avanzarVersionPublicacion(
    conexion,
    proyeccionId,
    ahora
  );
  if (!punteros[0]) {
    await conexion.execute(
      `INSERT INTO estados_actuales_proyecciones_federacion (
         proyeccion_id,generacion_actual_id,version_publicacion,
         publicada_en_utc,actualizada_en_utc
       ) VALUES (?,?,?,?,?)`,
      [proyeccionId, generacionId, versionPublicacion, ahora, ahora]
    );
  } else if (anterior !== generacionId) {
    const [sustitucion] = await conexion.execute(
      `UPDATE estados_actuales_proyecciones_federacion
          SET generacion_actual_id=?,version_publicacion=?,
              publicada_en_utc=?,actualizada_en_utc=?
        WHERE proyeccion_id=? AND generacion_actual_id=?`,
      [generacionId, versionPublicacion, ahora, ahora, proyeccionId, anterior]
    );
    if (sustitucion.affectedRows !== 1) {
      fallar('sustitucion_proyeccion_concurrente', 'Otro cierre sustituyó la proyección.');
    }
  } else {
    const [republicacion] = await conexion.execute(
      `UPDATE estados_actuales_proyecciones_federacion
          SET version_publicacion=?,
              publicada_en_utc=?,actualizada_en_utc=?
        WHERE proyeccion_id=? AND generacion_actual_id=?`,
      [versionPublicacion, ahora, ahora, proyeccionId, generacionId]
    );
    if (republicacion.affectedRows !== 1) {
      fallar('republicacion_proyeccion_concurrente', 'Otro cierre republicó la proyección.');
    }
  }
  return Object.freeze({
    publicada: true,
    sustituyoGeneracionId: anterior && anterior !== generacionId ? anterior : null
  });
}

async function retirarPublicacionActual(conexion, {
  proyeccionId,
  generacionId,
  secuenciaMaxima,
  ahora,
  preservarFrontera
}) {
  const [punteros] = await conexion.execute(
    `SELECT * FROM estados_actuales_proyecciones_federacion
      WHERE proyeccion_id=? FOR UPDATE`,
    [proyeccionId]
  );
  if (!punteros[0]) {
    return Object.freeze({
      publicada: false,
      despublicada: false,
      sustituyoGeneracionId: null
    });
  }
  const anterior = punteros[0].generacion_actual_id;
  const versionAnterior = await obtenerVersion(
    conexion,
    proyeccionId,
    anterior,
    true
  );
  if (anterior !== generacionId &&
      versionAnterior.ultima_secuencia_evaluada !== null &&
      BigInt(versionAnterior.ultima_secuencia_evaluada) > BigInt(secuenciaMaxima)) {
    return Object.freeze({
      publicada: false,
      despublicada: false,
      sustituyoGeneracionId: null,
      retrocesoEvitado: true
    });
  }
  if (preservarFrontera && versionAnterior.estado_coherencia === 'coherente' &&
      versionAnterior.ultima_secuencia_evaluada !== null) {
    await preservarFronteraCoherente(conexion, versionAnterior, ahora);
  }
  const [eliminacion] = await conexion.execute(
    `DELETE FROM estados_actuales_proyecciones_federacion
      WHERE proyeccion_id=? AND generacion_actual_id=?`,
    [proyeccionId, anterior]
  );
  if (eliminacion.affectedRows !== 1) {
    fallar('despublicacion_proyeccion_concurrente', 'Otro cierre retiró la proyección actual.');
  }
  await conexion.execute(
    `DELETE FROM campos_consolidados_proyecciones_federacion
      WHERE proyeccion_id=?`,
    [proyeccionId]
  );
  await desactivarVersionActual(conexion, { version: versionAnterior, ahora });
  await avanzarVersionPublicacion(conexion, proyeccionId, ahora);
  return Object.freeze({
    publicada: false,
    despublicada: true,
    sustituyoGeneracionId: anterior
  });
}

async function desactivarVersionActual(conexion, { version, ahora }) {
  const [generaciones] = await conexion.execute(
    `SELECT rol_generacion FROM generaciones_flujos_federacion
      WHERE generacion_id=? FOR UPDATE`,
    [version.generacion_id]
  );
  if (!generaciones[0]) {
    fallar('generacion_version_inexistente', 'La versión perdió su generación causal.');
  }
  const historica = generaciones[0].rol_generacion === 'historica';
  const [resultado] = await conexion.execute(
    `UPDATE versiones_proyecciones_federacion
        SET estado_publicacion=?,publicada_en_utc=?,finalizada_en_utc=?,
            version_estado=version_estado+1,actualizada_en_utc=?
      WHERE proyeccion_id=? AND generacion_id=?
        AND estado_publicacion='actual'`,
    [
      historica ? 'historica' : 'preparando',
      historica ? version.publicada_en_utc : null,
      historica ? ahora : null,
      ahora,
      version.proyeccion_id,
      version.generacion_id
    ]
  );
  if (resultado.affectedRows !== 1) {
    fallar('puntero_actual_inconsistente', 'La versión gobernante no coincide con su puntero.');
  }
}

async function avanzarVersionPublicacion(conexion, proyeccionId, ahora) {
  await conexion.execute(
    `INSERT IGNORE INTO contadores_publicacion_proyecciones_federacion (
       proyeccion_id,ultima_version_publicacion,actualizada_en_utc
     ) VALUES (?,0,?)`,
    [proyeccionId, ahora]
  );
  const [filas] = await conexion.execute(
    `SELECT ultima_version_publicacion
       FROM contadores_publicacion_proyecciones_federacion
      WHERE proyeccion_id=? FOR UPDATE`,
    [proyeccionId]
  );
  if (!filas[0]) {
    fallar('contador_publicacion_inexistente', 'No existe el contador de la proyección.');
  }
  const siguiente = (BigInt(filas[0].ultima_version_publicacion) + 1n).toString();
  const [actualizacion] = await conexion.execute(
    `UPDATE contadores_publicacion_proyecciones_federacion
        SET ultima_version_publicacion=?,actualizada_en_utc=?
      WHERE proyeccion_id=? AND ultima_version_publicacion=?`,
    [
      siguiente,
      ahora,
      proyeccionId,
      String(filas[0].ultima_version_publicacion)
    ]
  );
  if (actualizacion.affectedRows !== 1) {
    fallar('contador_publicacion_concurrente', 'La publicación avanzó concurrentemente.');
  }
  return siguiente;
}

async function reemplazarFotografiaCampos(conexion, {
  proyeccionId,
  generacionId,
  secuenciaMaxima,
  ahora
}) {
  const [filas] = await conexion.execute(
    `WITH vigencias_activas AS (
       SELECT c.contribucion_id,a.vigencia_restante_recepcion_ms,
              a.primera_observacion_utc,
              ROW_NUMBER() OVER (
                PARTITION BY c.contribucion_id
                ORDER BY i.secuencia_elemento DESC,
                         a.primera_observacion_utc DESC,
                         a.inbox_ocurrencia_id DESC
              ) AS ordinal_vigencia
         FROM contribuciones_proyecciones_federacion c
         JOIN aportes_ocurrencias_contribuciones_federacion a
           ON a.contribucion_id=c.contribucion_id
         JOIN inbox_ocurrencias_federacion i
           ON i.id=a.inbox_ocurrencia_id
         JOIN flujos_federacion f
          ON f.flujo_id=a.flujo_id
          AND f.generacion_activa_id=a.generacion_id
        WHERE c.proyeccion_id=? AND i.secuencia_elemento<=?
     ),
     eventos_hasta_frontera AS (
       SELECT e.*,
              ROW_NUMBER() OVER (
                PARTITION BY e.contribucion_id,e.generacion_id,e.nombre_sha256
                ORDER BY e.secuencia_elemento DESC,e.id DESC
              ) AS ordinal_campo
         FROM eventos_soporte_campos_federacion e
        WHERE e.proyeccion_id=? AND e.secuencia_elemento IS NOT NULL
          AND e.secuencia_elemento<=?
     )
     SELECT s.nombre_sha256,s.nombre_campo,s.declaracion_campo_id,
            s.inbox_ocurrencia_id,s.secuencia_elemento,s.contribucion_id
       FROM eventos_hasta_frontera s
       JOIN contribuciones_proyecciones_federacion c
         ON c.contribucion_id=s.contribucion_id
       JOIN vigencias_activas x
         ON x.contribucion_id=c.contribucion_id
        AND x.ordinal_vigencia=1
        AND (
          x.vigencia_restante_recepcion_ms IS NULL
          OR x.vigencia_restante_recepcion_ms>
             FLOOR(GREATEST(
               TIMESTAMPDIFF(MICROSECOND,x.primera_observacion_utc,?),0
             )/1000)
        )
       JOIN relaciones_federacion r ON r.relacion_id=c.relacion_id
       JOIN revisiones_concesion_federacion v
         ON v.relacion_id=c.relacion_id
        AND v.revision_id=c.revision_concesion_id
       JOIN aportes_ocurrencias_contribuciones_federacion a
         ON a.contribucion_id=s.contribucion_id
        AND a.inbox_ocurrencia_id=s.inbox_ocurrencia_id
        AND a.generacion_id=s.generacion_id
       JOIN generaciones_flujos_federacion g
         ON g.generacion_id=s.generacion_id
       JOIN flujos_federacion f
         ON f.flujo_id=g.flujo_id
        AND f.generacion_activa_id=g.generacion_id
      WHERE c.proyeccion_id=? AND c.estado_soporte='activa'
        AND c.estado_autoridad='autorizada' AND c.estado_identidad='valida'
        AND c.estado_compatibilidad IN ('compatible','compatibleParcial')
        AND r.estado_ciclo='vinculada' AND r.estado_autoridad='autorizada'
        AND r.estado_identidad='valida' AND r.estado_compatibilidad<>'incompatible'
        AND v.estado='vigente' AND s.ordinal_campo=1
        AND s.tipo IN ('aportado','actualizado')
      ORDER BY s.nombre_sha256,s.secuencia_elemento DESC,s.contribucion_id`,
    [
      proyeccionId,
      secuenciaMaxima,
      proyeccionId,
      secuenciaMaxima,
      ahora,
      proyeccionId
    ]
  );
  const elegidas = new Map();
  const soportesPorCampo = new Map();
  for (const fila of filas) {
    const clave = Buffer.from(fila.nombre_sha256).toString('hex');
    const elegida = elegidas.get(clave);
    if (elegida && elegida.nombre_campo !== fila.nombre_campo) {
      fallar(
        'colision_nombre_campo',
        'La fotografía contiene nombres distintos bajo una misma huella física.'
      );
    }
    const soportes = soportesPorCampo.get(clave) || new Set();
    soportes.add(fila.contribucion_id);
    soportesPorCampo.set(clave, soportes);
    if (!elegida) elegidas.set(clave, fila);
  }
  await conexion.execute(
    `DELETE FROM campos_versiones_proyecciones_federacion
      WHERE proyeccion_id=? AND generacion_id=?`,
    [proyeccionId, generacionId]
  );
  for (const [clave, fila] of elegidas) {
    await conexion.execute(
      `INSERT INTO campos_versiones_proyecciones_federacion (
         proyeccion_id,generacion_id,nombre_sha256,nombre_campo,
         declaracion_campo_id,inbox_ocurrencia_id,secuencia_elemento,
         total_soportes_activos,consolidado_en_utc
       ) VALUES (?,?,?,?,?,?,?,?,?)`,
      [
        proyeccionId,
        generacionId,
        fila.nombre_sha256,
        fila.nombre_campo,
        fila.declaracion_campo_id,
        fila.inbox_ocurrencia_id,
        String(fila.secuencia_elemento),
        soportesPorCampo.get(clave).size,
        ahora
      ]
    );
  }
}

async function reemplazarConsolidadoActual(conexion, {
  proyeccionId,
  generacionId,
  ahora
}) {
  await conexion.execute(
    `DELETE FROM campos_consolidados_proyecciones_federacion
      WHERE proyeccion_id=?`,
    [proyeccionId]
  );
  await conexion.execute(
    `INSERT INTO campos_consolidados_proyecciones_federacion (
       proyeccion_id,nombre_sha256,nombre_campo,declaracion_campo_id,
       inbox_ocurrencia_id,secuencia_elemento,total_soportes_activos,
       consolidado_en_utc
     )
     SELECT proyeccion_id,nombre_sha256,nombre_campo,declaracion_campo_id,
            inbox_ocurrencia_id,secuencia_elemento,total_soportes_activos,?
       FROM campos_versiones_proyecciones_federacion
      WHERE proyeccion_id=? AND generacion_id=?`,
    [ahora, proyeccionId, generacionId]
  );
}

function esPublicable({ dimensiones, completitud, cierre }) {
  return cierre &&
    dimensiones.materializacion === 'materializada' &&
    dimensiones.vigencia === 'vigente' &&
    dimensiones.soporte === 'sostenida' &&
    dimensiones.autorizacion === 'autorizada' &&
    completitud.interpretable.estado === 'completa' &&
    completitud.observable.estado === 'completa';
}

function debeRetirarPublicacion({ dimensiones, cierre, estadoMaterializacion }) {
  return cierre && estadoMaterializacion === 'materializada' && (
    dimensiones.vigencia !== 'vigente' ||
    dimensiones.soporte !== 'sostenida' ||
    dimensiones.autorizacion !== 'autorizada'
  );
}

function maximaSecuencia(...valores) {
  const presentes = valores.filter((valor) => valor !== null && valor !== undefined);
  if (presentes.length === 0) return null;
  return presentes.map((valor) => BigInt(valor)).reduce(
    (mayor, actual) => actual > mayor ? actual : mayor
  ).toString();
}

function completitudDesdeVersion(version) {
  return {
    interpretable: { estado: version.completitud_interpretable, causas: [] },
    observable: { estado: version.completitud_observable, causas: [] },
    reconstruible: { estado: version.completitud_reconstruible, causas: [] }
  };
}

async function obtenerVersion(conexion, proyeccionId, generacionId, bloquear) {
  const fila = await obtenerVersionOpcional(
    conexion,
    proyeccionId,
    generacionId,
    bloquear
  );
  if (!fila) fallar('version_proyeccion_inexistente', 'La versión no quedó persistida.');
  return fila;
}

async function obtenerEstadoActualBloqueado(conexion, proyeccionId) {
  const [filas] = await conexion.execute(
    `SELECT v.*,e.version_publicacion
       FROM estados_actuales_proyecciones_federacion e
       JOIN versiones_proyecciones_federacion v
         ON v.proyeccion_id=e.proyeccion_id
        AND v.generacion_id=e.generacion_actual_id
      WHERE e.proyeccion_id=? FOR UPDATE`,
    [proyeccionId]
  );
  return filas[0] || null;
}

async function obtenerVersionOpcional(conexion, proyeccionId, generacionId, bloquear) {
  const [filas] = await conexion.execute(
    `SELECT * FROM versiones_proyecciones_federacion
      WHERE proyeccion_id=? AND generacion_id=?${bloquear ? ' FOR UPDATE' : ''}`,
    [proyeccionId, generacionId]
  );
  return filas[0] || null;
}

function mapearVersion(fila) {
  return Object.freeze({
    proyeccionId: fila.proyeccion_id,
    generacionId: fila.generacion_id,
    publicacion: fila.estado_publicacion,
    materializacion: fila.estado_materializacion,
    completitud: Object.freeze({
      interpretable: fila.completitud_interpretable,
      observable: fila.completitud_observable,
      reconstruible: fila.completitud_reconstruible
    }),
    vigencia: fila.estado_vigencia,
    soporte: fila.estado_soporte,
    autorizacion: fila.estado_autorizacion,
    coherencia: fila.estado_coherencia,
    ultimaSecuenciaCoherente: fila.ultima_secuencia_evaluada === null
      ? null
      : String(fila.ultima_secuencia_evaluada),
    cierreOperativoValidado: Boolean(fila.cierre_operativo_validado),
    recepcionConfirmada: Boolean(fila.recepcion_confirmada),
    versionPublicacion: fila.version_publicacion == null
      ? null
      : String(fila.version_publicacion)
  });
}

async function preservarFronteraCoherente(conexion, version, ahora) {
  const [insercion] = await conexion.execute(
    `INSERT INTO fronteras_coherentes_proyecciones_federacion (
       proyeccion_id,generacion_id,secuencia_elemento,
       completitud_interpretable,completitud_observable,
       completitud_reconstruible,estado_vigencia,estado_soporte,
       estado_autorizacion,cierre_operativo_validado,capturada_en_utc
     ) VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
    [
      version.proyeccion_id,
      version.generacion_id,
      version.ultima_secuencia_evaluada,
      version.completitud_interpretable,
      version.completitud_observable,
      version.completitud_reconstruible,
      version.estado_vigencia,
      version.estado_soporte,
      version.estado_autorizacion,
      version.cierre_operativo_validado,
      ahora
    ]
  );
  const fronteraId = String(insercion.insertId);
  await conexion.execute(
    `INSERT IGNORE INTO campos_fronteras_coherentes_proyecciones_federacion (
       frontera_id,nombre_sha256,nombre_campo,declaracion_campo_id,
       inbox_ocurrencia_id,secuencia_elemento,total_soportes_activos
     )
     SELECT ?,nombre_sha256,nombre_campo,declaracion_campo_id,
            inbox_ocurrencia_id,secuencia_elemento,total_soportes_activos
       FROM campos_versiones_proyecciones_federacion
      WHERE proyeccion_id=? AND generacion_id=?`,
    [fronteraId, version.proyeccion_id, version.generacion_id]
  );
  await conexion.execute(
    `UPDATE fronteras_coherentes_proyecciones_federacion
        SET sellada=TRUE WHERE id=? AND sellada=FALSE`,
    [fronteraId]
  );
}

function identidad(valor, tipo) {
  try {
    return crearIdentidadFederada({ tipo, valor: String(valor || '') }).serializar();
  } catch {
    fallar('identidad_estado_proyeccion_invalida', `Se esperaba una identidad ${tipo}.`);
  }
}

function exigirConexion(conexion) {
  if (!conexion?.execute || !conexion?.query) {
    fallar('transaccion_estado_proyeccion_ausente', 'El estado exige SQL prestado.');
  }
}

async function exigirTransaccionActiva(conexion) {
  const [filas] = await conexion.query('SELECT @@in_transaction AS activa');
  if (!Boolean(filas[0]?.activa)) {
    fallar('transaccion_estado_proyeccion_inactiva', 'El estado exige una transacción activa.');
  }
}

async function ahoraSql(conexion) {
  const [filas] = await conexion.query('SELECT UTC_TIMESTAMP(3) AS ahora');
  return filas[0].ahora;
}

function fallar(codigo, mensaje) {
  throw new ErrorEstadoProyeccionFederacionSql(codigo, mensaje);
}

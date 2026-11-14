import { createHash } from 'node:crypto';

import {
  generarUuidV7Auditoria,
  uuidV7AuditoriaABytes
} from '../../auditoria/src/UuidV7Auditoria.js';
import { canonicalizarJsonFederacion } from '../src/CanonicalizadorFederacion.js';

const ESTADOS_ACTIVOS = ['abierta', 'esperandoResincronizacion'];

export class ErrorDivergenciaFederacionSql extends Error {
  constructor(codigo, mensaje) {
    super(mensaje);
    this.name = 'ErrorDivergenciaFederacionSql';
    this.codigo = codigo;
  }
}

export class RepositorioDivergenciasFederacionSql {
  constructor(clienteSql, {
    servicioAvisos,
    adaptadorAuditoria = null,
    repositorioSoporteCampos = null
  } = {}) {
    if (!clienteSql?.obtenerConexion) {
      throw new Error('Las divergencias federadas requieren SQL operativo.');
    }
    if (typeof servicioAvisos?.detectar !== 'function' ||
        typeof servicioAvisos?.resolver !== 'function') {
      throw new Error('Las divergencias federadas requieren avisos de plataforma.');
    }
    if (typeof adaptadorAuditoria?.registrarExclusionEnTransaccion !== 'function' ||
        typeof adaptadorAuditoria?.registrarDeteccionEnTransaccion !== 'function') {
      throw new Error('Las divergencias requieren auditoría transaccional completa.');
    }
    if (repositorioSoporteCampos !== null &&
        typeof repositorioSoporteCampos?.retirarContribucionEnTransaccion !== 'function') {
      throw new Error('El soporte de rutas divergentes no es transaccional.');
    }
    this.clienteSql = clienteSql;
    this.servicioAvisos = servicioAvisos;
    this.adaptadorAuditoria = adaptadorAuditoria;
    this.repositorioSoporteCampos = repositorioSoporteCampos;
  }

  async registrarEnTransaccion({
    lote,
    entrega,
    inboxId,
    conflictoId
  } = {}, { conexion } = {}) {
    exigirConexion(conexion);
    await exigirTransaccionActiva(conexion);
    const contexto = await resolverContexto(conexion, { lote, entrega, inboxId });
    const conflicto = await obtenerConflicto(conexion, conflictoId, inboxId);
    const ahora = await ahoraSql(conexion);
    const estadoActual = await obtenerEstadoActual(
      conexion,
      contexto.proyeccion_id,
      true
    );
    const posicionYaSuperada = estadoActual?.estado_coherencia === 'coherente' &&
      estadoActual.ultima_secuencia_evaluada !== null &&
      BigInt(estadoActual.ultima_secuencia_evaluada) >
        BigInt(contexto.secuencia_ambigua);
    const frontera = await resolverFronteraAnterior(
      conexion,
      contexto.proyeccion_id,
      contexto.secuencia_ambigua,
      ahora
    );
    let divergencia = await obtenerDivergencia(conexion, {
      proyeccionId: contexto.proyeccion_id,
      inboxId,
      secuencia: contexto.secuencia_ambigua
    }, true);
    if (!divergencia) {
      const estadoInicial = posicionYaSuperada ? 'resueltaEvidencia' : 'abierta';
      const [insercion] = await conexion.execute(
        `INSERT INTO divergencias_proyecciones_federacion (
           proyeccion_id,generacion_detectada_id,inbox_ocurrencia_id,
           secuencia_ambigua,estado,generacion_frontera_coherente_id,
           secuencia_frontera_coherente,estado_vigencia_frontera,
           veces_observada,aviso_id,primera_deteccion_utc,
           ultima_deteccion_utc,resuelta_en_utc
         ) VALUES (?,?,?,?,?,?,?,?,1,NULL,?,?,?)`,
        [
          contexto.proyeccion_id,
          contexto.generacion_id,
          inboxId,
          contexto.secuencia_ambigua,
          estadoInicial,
          frontera?.generacion_id ?? null,
          frontera?.secuencia_elemento ?? null,
          frontera?.estado_vigencia ?? null,
          ahora,
          ahora,
          posicionYaSuperada ? ahora : null
        ]
      );
      divergencia = await obtenerDivergenciaPorId(
        conexion,
        String(insercion.insertId),
        true
      );
    } else if (posicionYaSuperada) {
      await conexion.execute(
        `UPDATE divergencias_proyecciones_federacion
            SET veces_observada=veces_observada+1,
                ultima_deteccion_utc=GREATEST(ultima_deteccion_utc,?)
          WHERE id=?`,
        [ahora, divergencia.id]
      );
    } else {
      await conexion.execute(
        `UPDATE divergencias_proyecciones_federacion
            SET estado='abierta',resuelta_en_utc=NULL,
                veces_observada=veces_observada+1,
                ultima_deteccion_utc=GREATEST(ultima_deteccion_utc,?)
          WHERE id=?`,
        [ahora, divergencia.id]
      );
    }

    const rutasConsolidadas = await registrarVariantesConsolidadas(
      conexion,
      {
        divergenciaId: divergencia.id,
        proyeccionId: contexto.proyeccion_id,
        inboxId,
        ahora
      }
    );
    const rutaConflictiva = await registrarVarianteConflictiva(conexion, {
      divergenciaId: divergencia.id,
      inboxId,
      conflictoId: conflicto.id,
      conflictoHash: conflicto.contenido_observado_sha256 ??
        conflicto.payload_observado_sha256,
      lote,
      entrega,
      ahora
    });
    const correlacionId = generarUuidV7Auditoria();
    await this.adaptadorAuditoria.registrarDeteccionEnTransaccion({
      eventoId: generarUuidV7Auditoria(),
      correlacionId,
      efectivoEnUtc: ahora,
      proyeccionId: contexto.proyeccion_id,
      scope: scopeFila(contexto),
      generacionId: lote.generacionId,
      loteId: lote.loteId,
      posicionFlujo: String(entrega.posicionFlujo),
      bytes: String(Buffer.byteLength(
        canonicalizarJsonFederacion(entrega.ocurrencia),
        'utf8'
      ))
    }, { conexion });
    if (posicionYaSuperada) {
      return Object.freeze({
        divergenciaId: String(divergencia.id),
        proyeccionId: contexto.proyeccion_id,
        varianteConflictivaId: rutaConflictiva,
        secuenciaFronteraCoherente: String(
          estadoActual.ultima_secuencia_evaluada
        ),
        bloqueada: false,
        historicaSuperada: true
      });
    }
    await degradarProyeccion(conexion, {
      proyeccionId: contexto.proyeccion_id,
      secuenciaAmbigua: contexto.secuencia_ambigua,
      frontera,
      ahora
    });
    const aviso = await this.servicioAvisos.detectar({
      eventoId: generarUuidV7Auditoria(),
      correlacionId,
      efectivoEnUtc: fechaIso(ahora),
      causalidad: null,
      actor: { tipo: 'runtime', id: 'sentinelia-runtime' },
      claveCausal: claveAviso(contexto, divergencia.id),
      contextoHumano: {
        proyeccionId: contexto.proyeccion_id,
        secuenciaAmbigua: contexto.secuencia_ambigua,
        ultimaFronteraCoherente: frontera?.secuencia_elemento ?? null
      },
      resumen: {
        variantesConsolidadas: rutasConsolidadas,
        varianteConflictivaId: rutaConflictiva
      }
    }, { conexion });
    if (aviso?.aviso?.avisoId) {
      await conexion.execute(
        `UPDATE divergencias_proyecciones_federacion
            SET aviso_id=COALESCE(aviso_id,?) WHERE id=?`,
        [aviso.aviso.avisoId, divergencia.id]
      );
    }
    return Object.freeze({
      divergenciaId: String(divergencia.id),
      proyeccionId: contexto.proyeccion_id,
      varianteConflictivaId: rutaConflictiva,
      secuenciaFronteraCoherente: frontera?.secuencia_elemento ?? null,
      bloqueada: true
    });
  }

  async excluirRuta(entrada = {}) {
    if (!this.adaptadorAuditoria) {
      fallar(
        'auditoria_exclusion_ausente',
        'No puede excluirse una ruta sin auditoría transaccional.'
      );
    }
    if (entrada.actor?.modo !== 'directo' ||
        entrada.actor?.real?.tipo !== 'usuario' ||
        entrada.actor?.efectivo != null ||
        !/^[1-9][0-9]*$/u.test(String(entrada.actor?.real?.id || ''))) {
      fallar(
        'actor_exclusion_invalido',
        'La exclusión de ruta exige una sesión humana directa identificable.'
      );
    }
    return this.#transaccion(async (conexion) => {
      const divergencia = await obtenerDivergenciaPorId(
        conexion,
        entrada.divergenciaId,
        true
      );
      if (!divergencia || !ESTADOS_ACTIVOS.includes(divergencia.estado)) {
        fallar('divergencia_no_excluible', 'La divergencia no admite excluir rutas.');
      }
      const variante = await obtenerVarianteRuta(
        conexion,
        entrada.varianteRutaId,
        divergencia.id
      );
      if (!variante?.relacion_id || !variante?.recorrido_sha256) {
        fallar('variante_sin_ruta', 'La variante no conserva una ruta excluible.');
      }
      const scope = scopeFila(divergencia);
      if (!scopeCubre(entrada.scopeActor, scope)) {
        fallar(
          'scope_exclusion_insuficiente',
          'El scope actual del actor no cubre la proyección divergente.'
        );
      }
      const ahora = await ahoraSql(conexion);
      const recorridoHex = Buffer.from(variante.recorrido_sha256).toString('hex');
      const evento = await this.adaptadorAuditoria.registrarExclusionEnTransaccion({
        ...entrada,
        proyeccionId: divergencia.proyeccion_id,
        relacionId: variante.relacion_id,
        revisionConcesionId: variante.revision_concesion_id,
        recorridoSha256: recorridoHex,
        scope,
        efectivoEnUtc: ahora
      }, { conexion });
      try {
        await conexion.execute(
          `INSERT INTO exclusiones_rutas_divergentes_federacion (
             divergencia_id,variante_ruta_id,proyeccion_id,relacion_id,
             revision_concesion_id,recorrido_sha256,estado,motivo,
             actor_usuario_id,scope_tenant_id,scope_empresa_id,scope_sitio_id,
             evento_auditoria_id,correlacion_id,excluida_en_utc,revalidada_en_utc
           ) VALUES (?,?,?,?,?,?,'pendienteResincronizacion',?,?,?,?,?,?,?, ?,NULL)`,
          [
            divergencia.id,
            variante.id,
            divergencia.proyeccion_id,
            variante.relacion_id,
            variante.revision_concesion_id,
            variante.recorrido_sha256,
            entrada.motivo,
            entrada.actor.real.id,
            scope.tenantId,
            scope.empresaId,
            scope.sitioId,
            uuidV7AuditoriaABytes(entrada.eventoId),
            uuidV7AuditoriaABytes(entrada.correlacionId),
            ahora
          ]
        );
      } catch (error) {
        if (error?.code !== 'ER_DUP_ENTRY') throw error;
        fallar(
          'ruta_ya_excluida',
          'La ruta ya fue excluida para esta divergencia; no se reescribe su decisión.'
        );
      }
      if (this.repositorioSoporteCampos) {
        const contribuciones = await contribucionesDeRuta(conexion, {
          proyeccionId: divergencia.proyeccion_id,
          relacionId: variante.relacion_id,
          revisionConcesionId: variante.revision_concesion_id,
          recorridoSha256: variante.recorrido_sha256
        });
        for (const contribucionId of contribuciones) {
          await this.repositorioSoporteCampos.retirarContribucionEnTransaccion({
            contribucionId,
            causa: 'rutaDivergenteExcluida'
          }, { conexion });
        }
      }
      await conexion.execute(
        `UPDATE divergencias_proyecciones_federacion
            SET estado='esperandoResincronizacion',
                ultima_deteccion_utc=GREATEST(ultima_deteccion_utc,?)
          WHERE id=?`,
        [ahora, divergencia.id]
      );
      return Object.freeze({
        estado: 'pendienteResincronizacion',
        divergenciaId: String(divergencia.id),
        varianteRutaId: String(variante.id),
        eventoAuditoria: evento
      });
    });
  }

  async autorizarContinuidadEnTransaccion({
    proyeccionId,
    generacionId,
    inboxId,
    secuenciaElemento
  } = {}, { conexion } = {}) {
    exigirConexion(conexion);
    await exigirTransaccionActiva(conexion);
    const [activas] = await conexion.execute(
      `SELECT d.*,p.scope_tenant_id,p.scope_empresa_id,p.scope_sitio_id
         FROM divergencias_proyecciones_federacion d
         JOIN proyecciones_federacion p ON p.proyeccion_id=d.proyeccion_id
        WHERE d.proyeccion_id=?
          AND d.estado IN ('abierta','esperandoResincronizacion')
          AND d.secuencia_ambigua<=?
        ORDER BY d.secuencia_ambigua,d.id FOR UPDATE`,
      [proyeccionId, secuenciaElemento]
    );
    if (activas.length === 0) return Object.freeze({ autorizada: true, resueltas: [] });
    const secuencia = BigInt(String(secuenciaElemento));
    const resoluciones = [];
    for (const divergencia of activas) {
      if (secuencia <= BigInt(divergencia.secuencia_ambigua)) {
        return Object.freeze({ autorizada: false, resueltas: [] });
      }
      const via = divergencia.estado === 'esperandoResincronizacion'
        ? await validaResincronizacionTrasExclusion(conexion, {
          divergencia,
          generacionId,
          inboxId
        })
        : await existeConvergenciaDeRutas(conexion, {
          divergencia,
          generacionId,
          inboxId
        });
      if (!via) return Object.freeze({ autorizada: false, resueltas: [] });
      resoluciones.push({ divergencia, via });
    }
    const resueltas = [];
    for (const { divergencia, via } of resoluciones) {
      const ahora = await ahoraSql(conexion);
      const estado = via === 'exclusion'
        ? 'resueltaExclusionResincronizada'
        : 'resueltaEvidencia';
      await conexion.execute(
        `UPDATE divergencias_proyecciones_federacion
            SET estado=?,resuelta_en_utc=? WHERE id=?`,
        [estado, ahora, divergencia.id]
      );
      if (via === 'exclusion') {
        await conexion.execute(
          `UPDATE exclusiones_rutas_divergentes_federacion
              SET estado='revalidada',revalidada_en_utc=?
            WHERE divergencia_id=? AND estado='pendienteResincronizacion'`,
          [ahora, divergencia.id]
        );
      }
      await this.servicioAvisos.resolver({
        eventoId: generarUuidV7Auditoria(),
        correlacionId: generarUuidV7Auditoria(),
        efectivoEnUtc: fechaIso(ahora),
        causalidad: null,
        actor: { tipo: 'runtime', id: 'sentinelia-runtime' },
        claveCausal: claveAviso(divergencia, divergencia.id),
        viaResolucion: 'causa_desaparecida'
      }, { conexion });
      resueltas.push(String(divergencia.id));
    }
    return Object.freeze({ autorizada: true, resueltas: Object.freeze(resueltas) });
  }

  async #transaccion(operacion) {
    const conexion = await this.clienteSql.obtenerConexion();
    try {
      await conexion.beginTransaction();
      const resultado = await operacion(conexion);
      await conexion.commit();
      return resultado;
    } catch (error) {
      await conexion.rollback().catch(() => {});
      throw error;
    } finally {
      conexion.release();
    }
  }
}

async function resolverContexto(conexion, { lote, entrega, inboxId }) {
  const ocurrencia = entrega?.ocurrencia;
  if (!ocurrencia || !lote || !/^[1-9][0-9]*$/u.test(String(inboxId || ''))) {
    fallar('divergencia_incompleta', 'La divergencia exige lote, entrega e inbox.');
  }
  const [filas] = await conexion.execute(
    `SELECT p.proyeccion_id,p.scope_tenant_id,p.scope_empresa_id,p.scope_sitio_id,
            ? AS generacion_id,? AS flujo_id,? AS relacion_id,
            i.secuencia_elemento AS secuencia_ambigua
       FROM proyecciones_federacion p
       JOIN flujos_federacion f ON f.flujo_id=?
       JOIN inbox_ocurrencias_federacion i ON i.id=?
      WHERE p.installation_origen_id=? AND p.familia=?
        AND p.elemento_origen_id=?
        AND p.scope_nivel=f.scope_nivel
        AND p.scope_tenant_id<=>f.scope_tenant_id
        AND p.scope_empresa_id<=>f.scope_empresa_id
        AND p.scope_sitio_id<=>f.scope_sitio_id
      LIMIT 1 FOR UPDATE`,
    [
      lote.generacionId,
      lote.flujoId,
      lote.relacionId,
      lote.flujoId,
      inboxId,
      ocurrencia.installationOrigenId,
      ocurrencia.familia,
      ocurrencia.elementoOrigenId
    ]
  );
  if (!filas[0]) {
    fallar(
      'proyeccion_divergente_inexistente',
      'La ocurrencia conflictiva no posee una proyección contextual previa.'
    );
  }
  return filas[0];
}

async function obtenerConflicto(conexion, conflictoId, inboxId) {
  const [filas] = await conexion.execute(
    `SELECT * FROM conflictos_contenido_inbox_federacion
      WHERE id=? AND inbox_ocurrencia_id=? FOR UPDATE`,
    [conflictoId, inboxId]
  );
  if (!filas[0]) fallar('variante_conflictiva_inexistente', 'No existe la variante conflictiva.');
  return filas[0];
}

async function resolverFronteraAnterior(conexion, proyeccionId, secuencia, ahora) {
  const [actuales] = await conexion.execute(
    `SELECT v.* FROM estados_actuales_proyecciones_federacion e
       JOIN versiones_proyecciones_federacion v
         ON v.proyeccion_id=e.proyeccion_id
        AND v.generacion_id=e.generacion_actual_id
      WHERE e.proyeccion_id=? FOR UPDATE`,
    [proyeccionId]
  );
  const actual = actuales[0];
  if (actual?.estado_coherencia === 'coherente' &&
      actual.ultima_secuencia_evaluada !== null) {
    await preservarFrontera(conexion, actual, ahora);
  }
  const [fronteras] = await conexion.execute(
    `SELECT * FROM fronteras_coherentes_proyecciones_federacion
      WHERE proyeccion_id=? AND secuencia_elemento<?
      ORDER BY secuencia_elemento DESC,id DESC LIMIT 1 FOR UPDATE`,
    [proyeccionId, secuencia]
  );
  return fronteras[0] || null;
}

async function preservarFrontera(conexion, version, ahora) {
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

async function registrarVariantesConsolidadas(conexion, {
  divergenciaId,
  proyeccionId,
  inboxId,
  ahora
}) {
  const [rutas] = await conexion.execute(
    `SELECT c.relacion_id,c.revision_concesion_id,c.recorrido_sha256,
            a.ultima_entrega_id,e.flujo_id,e.generacion_id,i.payload_sha256,
            s.contenido_sha256,c.contribucion_id
       FROM inbox_ocurrencias_federacion i
       LEFT JOIN secretos_inbox_federacion s ON s.inbox_ocurrencia_id=i.id
       LEFT JOIN aportes_ocurrencias_contribuciones_federacion a
         ON a.inbox_ocurrencia_id=i.id
       LEFT JOIN contribuciones_proyecciones_federacion c
         ON c.contribucion_id=a.contribucion_id
       LEFT JOIN entregas_recepcion_federacion e
         ON e.entrega_id=a.ultima_entrega_id
      WHERE i.id=? AND (c.proyeccion_id=? OR c.proyeccion_id IS NULL)`,
    [inboxId, proyeccionId]
  );
  let total = 0;
  for (const ruta of rutas) {
    const recorrido = ruta.contribucion_id
      ? await leerRecorrido(conexion, ruta.contribucion_id)
      : null;
    await insertarVariante(conexion, {
      divergenciaId,
      clase: 'consolidada',
      inboxId,
      conflictoId: null,
      entregaId: ruta.ultima_entrega_id,
      relacionId: ruta.relacion_id,
      flujoId: ruta.flujo_id,
      generacionId: ruta.generacion_id,
      revisionConcesionId: ruta.revision_concesion_id,
      recorrido,
      payloadHash: ruta.contenido_sha256 ?? ruta.payload_sha256,
      ahora
    });
    total += 1;
  }
  return total;
}

async function registrarVarianteConflictiva(conexion, entrada) {
  const recorrido = entrada.entrega.procedencia.recorridoInstalaciones;
  return insertarVariante(conexion, {
    divergenciaId: entrada.divergenciaId,
    clase: 'conflictiva',
    inboxId: entrada.inboxId,
    conflictoId: entrada.conflictoId,
    entregaId: entrada.entrega.entregaId,
    relacionId: entrada.lote.relacionId,
    flujoId: entrada.lote.flujoId,
    generacionId: entrada.lote.generacionId,
    revisionConcesionId: entrada.lote.revisionConcesionEfectiva,
    recorrido,
    payloadHash: entrada.conflictoHash,
    ahora: entrada.ahora
  });
}

async function insertarVariante(conexion, entrada) {
  const recorridoCanonico = entrada.recorrido === null
    ? null
    : canonicalizarJsonFederacion(entrada.recorrido);
  const recorridoHash = recorridoCanonico === null ? null : sha256(recorridoCanonico);
  try {
    const [insercion] = await conexion.execute(
      `INSERT INTO variantes_divergencias_proyecciones_federacion (
         divergencia_id,clase,inbox_ocurrencia_id,conflicto_inbox_id,
         entrega_id,relacion_id,flujo_id,generacion_id,revision_concesion_id,
         recorrido_canonico,recorrido_sha256,payload_sha256,veces_observada,
         primera_observacion_utc,ultima_observacion_utc
       ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,1,?,?)`,
      [
        entrada.divergenciaId,
        entrada.clase,
        entrada.inboxId,
        entrada.conflictoId,
        entrada.entregaId,
        entrada.relacionId,
        entrada.flujoId,
        entrada.generacionId,
        entrada.revisionConcesionId,
        recorridoCanonico,
        recorridoHash,
        entrada.payloadHash,
        entrada.ahora,
        entrada.ahora
      ]
    );
    return String(insercion.insertId);
  } catch (error) {
    if (error?.code !== 'ER_DUP_ENTRY') throw error;
    const [filas] = await conexion.execute(
      `SELECT id FROM variantes_divergencias_proyecciones_federacion
        WHERE divergencia_id=? AND payload_sha256=?
          AND relacion_id<=>? AND revision_concesion_id<=>?
          AND recorrido_sha256<=>? FOR UPDATE`,
      [
        entrada.divergenciaId,
        entrada.payloadHash,
        entrada.relacionId,
        entrada.revisionConcesionId,
        recorridoHash
      ]
    );
    if (!filas[0]) throw error;
    await conexion.execute(
      `UPDATE variantes_divergencias_proyecciones_federacion
          SET veces_observada=veces_observada+1,
              ultima_observacion_utc=GREATEST(ultima_observacion_utc,?)
        WHERE id=?`,
      [entrada.ahora, filas[0].id]
    );
    return String(filas[0].id);
  }
}

async function degradarProyeccion(conexion, {
  proyeccionId,
  secuenciaAmbigua,
  frontera,
  ahora
}) {
  const [actuales] = await conexion.execute(
    `SELECT v.* FROM estados_actuales_proyecciones_federacion e
       JOIN versiones_proyecciones_federacion v
         ON v.proyeccion_id=e.proyeccion_id
        AND v.generacion_id=e.generacion_actual_id
      WHERE e.proyeccion_id=? FOR UPDATE`,
    [proyeccionId]
  );
  const actual = actuales[0];
  if (!actual) {
    await conexion.execute(
      `UPDATE versiones_proyecciones_federacion
          SET estado_coherencia='divergente',
              completitud_interpretable='degradada',
              completitud_observable='degradada',
              completitud_reconstruible='degradada',
              version_estado=version_estado+1,actualizada_en_utc=?
        WHERE proyeccion_id=? AND estado_publicacion='preparando'`,
      [ahora, proyeccionId]
    );
    return;
  }
  if (frontera && BigInt(actual.ultima_secuencia_evaluada ?? 0) >=
      BigInt(secuenciaAmbigua)) {
    await restaurarCamposFrontera(conexion, actual, frontera, ahora);
  } else if (!frontera && BigInt(actual.ultima_secuencia_evaluada ?? 0) >=
      BigInt(secuenciaAmbigua)) {
    await conexion.execute(
      `DELETE FROM campos_versiones_proyecciones_federacion
        WHERE proyeccion_id=? AND generacion_id=?`,
      [actual.proyeccion_id, actual.generacion_id]
    );
    await conexion.execute(
      `DELETE FROM campos_consolidados_proyecciones_federacion
        WHERE proyeccion_id=?`,
      [actual.proyeccion_id]
    );
    await conexion.execute(
      `DELETE FROM estados_actuales_proyecciones_federacion
        WHERE proyeccion_id=? AND generacion_actual_id=?`,
      [actual.proyeccion_id, actual.generacion_id]
    );
    await conexion.execute(
      `UPDATE versiones_proyecciones_federacion
          SET estado_publicacion='preparando',estado_coherencia='divergente',
              estado_materializacion='materializada',
              completitud_interpretable='degradada',
              completitud_observable='degradada',
              completitud_reconstruible='degradada',
              estado_vigencia='vencida',estado_soporte='huerfana',
              cierre_operativo_validado=FALSE,
              ultima_secuencia_evaluada=NULL,
              publicada_en_utc=NULL,finalizada_en_utc=NULL,
              version_estado=version_estado+1,actualizada_en_utc=?
        WHERE proyeccion_id=? AND generacion_id=?
          AND estado_publicacion='actual'`,
      [ahora, actual.proyeccion_id, actual.generacion_id]
    );
    await avanzarContadorPublicacion(conexion, actual.proyeccion_id, ahora);
    return;
  }
  await conexion.execute(
    `UPDATE versiones_proyecciones_federacion
        SET estado_coherencia='divergente',
            completitud_interpretable='degradada',
            completitud_observable='degradada',
            completitud_reconstruible='degradada',
            ultima_secuencia_evaluada=?,estado_vigencia=?,
            estado_soporte=?,estado_autorizacion=?,
            cierre_operativo_validado=?,
            version_estado=version_estado+1,actualizada_en_utc=?
      WHERE proyeccion_id=? AND generacion_id=?
        AND estado_publicacion='actual'`,
    [
      frontera?.secuencia_elemento ?? null,
      frontera?.estado_vigencia ?? 'vencida',
      frontera?.estado_soporte ?? 'huerfana',
      frontera?.estado_autorizacion ?? 'noAutorizada',
      Boolean(frontera?.cierre_operativo_validado),
      ahora,
      actual.proyeccion_id,
      actual.generacion_id
    ]
  );
}

async function restaurarCamposFrontera(conexion, version, frontera, ahora) {
  await conexion.execute(
    `DELETE FROM campos_versiones_proyecciones_federacion
      WHERE proyeccion_id=? AND generacion_id=?`,
    [version.proyeccion_id, version.generacion_id]
  );
  await conexion.execute(
    `INSERT INTO campos_versiones_proyecciones_federacion (
       proyeccion_id,generacion_id,nombre_sha256,nombre_campo,
       declaracion_campo_id,inbox_ocurrencia_id,secuencia_elemento,
       total_soportes_activos,consolidado_en_utc
     )
     SELECT ?,?,nombre_sha256,nombre_campo,declaracion_campo_id,
            inbox_ocurrencia_id,secuencia_elemento,total_soportes_activos,?
       FROM campos_fronteras_coherentes_proyecciones_federacion
      WHERE frontera_id=?`,
    [version.proyeccion_id, version.generacion_id, ahora, frontera.id]
  );
  await conexion.execute(
    `DELETE FROM campos_consolidados_proyecciones_federacion
      WHERE proyeccion_id=?`,
    [version.proyeccion_id]
  );
  await conexion.execute(
    `INSERT INTO campos_consolidados_proyecciones_federacion (
       proyeccion_id,nombre_sha256,nombre_campo,declaracion_campo_id,
       inbox_ocurrencia_id,secuencia_elemento,total_soportes_activos,
       consolidado_en_utc
     )
     SELECT ?,nombre_sha256,nombre_campo,declaracion_campo_id,
            inbox_ocurrencia_id,secuencia_elemento,total_soportes_activos,?
       FROM campos_fronteras_coherentes_proyecciones_federacion
      WHERE frontera_id=?`,
    [version.proyeccion_id, ahora, frontera.id]
  );
}

async function avanzarContadorPublicacion(conexion, proyeccionId, ahora) {
  const [filas] = await conexion.execute(
    `SELECT ultima_version_publicacion
       FROM contadores_publicacion_proyecciones_federacion
      WHERE proyeccion_id=? FOR UPDATE`,
    [proyeccionId]
  );
  if (!filas[0]) {
    fallar(
      'contador_publicacion_inexistente',
      'La divergencia no encontró el contador de la proyección publicada.'
    );
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
    fallar(
      'contador_publicacion_concurrente',
      'La publicación cambió mientras se cerraba la divergencia.'
    );
  }
}

async function existeConvergenciaDeRutas(conexion, { divergencia, inboxId }) {
  const [rutas] = await conexion.execute(
    `SELECT DISTINCT relacion_id,revision_concesion_id,recorrido_sha256
       FROM variantes_divergencias_proyecciones_federacion
      WHERE divergencia_id=? AND relacion_id IS NOT NULL`,
    [divergencia.id]
  );
  if (rutas.length < 2) return false;
  for (const ruta of rutas) {
    const [coincidencias] = await conexion.execute(
      `SELECT COUNT(*) AS total
         FROM contribuciones_proyecciones_federacion c
         JOIN aportes_ocurrencias_contribuciones_federacion a
           ON a.contribucion_id=c.contribucion_id
         JOIN generaciones_flujos_federacion g
           ON g.flujo_id=a.flujo_id AND g.generacion_id=a.generacion_id
         JOIN flujos_federacion f
           ON f.flujo_id=g.flujo_id AND f.generacion_activa_id=g.generacion_id
         JOIN relaciones_federacion r ON r.relacion_id=c.relacion_id
         JOIN revisiones_concesion_federacion v
           ON v.relacion_id=c.relacion_id
          AND v.revision_id=c.revision_concesion_id
        WHERE c.proyeccion_id=? AND c.relacion_id=?
          AND c.revision_concesion_id=? AND c.recorrido_sha256=?
          AND c.estado_soporte='activa'
          AND c.estado_autoridad='autorizada' AND c.estado_identidad='valida'
          AND c.estado_compatibilidad IN ('compatible','compatibleParcial')
          AND r.estado_ciclo='vinculada' AND r.estado_autoridad='autorizada'
          AND r.estado_identidad='valida' AND r.estado_compatibilidad<>'incompatible'
          AND v.estado='vigente' AND a.inbox_ocurrencia_id=?`,
      [
        divergencia.proyeccion_id,
        ruta.relacion_id,
        ruta.revision_concesion_id,
        ruta.recorrido_sha256,
        inboxId
      ]
    );
    if (Number(coincidencias[0].total) === 0) return false;
  }
  return 'evidencia';
}

async function validaResincronizacionTrasExclusion(conexion, {
  divergencia,
  generacionId,
  inboxId
}) {
  if (generacionId === divergencia.generacion_detectada_id) return false;
  const [filas] = await conexion.execute(
    `SELECT COUNT(*) AS total
       FROM contribuciones_proyecciones_federacion c
       JOIN aportes_ocurrencias_contribuciones_federacion a
         ON a.contribucion_id=c.contribucion_id
       JOIN entregas_recepcion_federacion e
         ON e.entrega_id=a.ultima_entrega_id
       JOIN generaciones_flujos_federacion g
         ON g.generacion_id=e.generacion_id
       JOIN flujos_federacion f
         ON f.flujo_id=e.flujo_id AND f.generacion_activa_id=e.generacion_id
       JOIN relaciones_federacion r ON r.relacion_id=c.relacion_id
       JOIN revisiones_concesion_federacion v
         ON v.relacion_id=c.relacion_id
        AND v.revision_id=c.revision_concesion_id
      WHERE c.proyeccion_id=? AND c.estado_soporte='activa'
        AND c.estado_autoridad='autorizada' AND c.estado_identidad='valida'
        AND c.estado_compatibilidad IN ('compatible','compatibleParcial')
        AND r.estado_ciclo='vinculada' AND r.estado_autoridad='autorizada'
        AND r.estado_identidad='valida' AND r.estado_compatibilidad<>'incompatible'
        AND v.estado='vigente'
        AND a.inbox_ocurrencia_id=? AND e.generacion_id=?
        AND g.clase='resincronizacion'
        AND g.creada_en_utc>(
          SELECT MAX(x.excluida_en_utc)
            FROM exclusiones_rutas_divergentes_federacion x
           WHERE x.divergencia_id=?
        )
        AND e.creada_en_utc>(
          SELECT MAX(x.excluida_en_utc)
            FROM exclusiones_rutas_divergentes_federacion x
           WHERE x.divergencia_id=?
        )
        AND NOT EXISTS (
          SELECT 1 FROM exclusiones_rutas_divergentes_federacion x
           WHERE x.divergencia_id=? AND x.relacion_id=c.relacion_id
             AND x.revision_concesion_id=c.revision_concesion_id
             AND x.recorrido_sha256=c.recorrido_sha256
             AND x.estado='pendienteResincronizacion'
        )`,
    [
      divergencia.proyeccion_id,
      inboxId,
      generacionId,
      divergencia.id,
      divergencia.id,
      divergencia.id
    ]
  );
  return Number(filas[0].total) > 0 ? 'exclusion' : false;
}

async function contribucionesDeRuta(conexion, entrada) {
  const [filas] = await conexion.execute(
    `SELECT contribucion_id FROM contribuciones_proyecciones_federacion
      WHERE proyeccion_id=? AND relacion_id=? AND revision_concesion_id=?
        AND recorrido_sha256=? AND estado_soporte='activa' FOR UPDATE`,
    [
      entrada.proyeccionId,
      entrada.relacionId,
      entrada.revisionConcesionId,
      entrada.recorridoSha256
    ]
  );
  return filas.map((fila) => fila.contribucion_id);
}

async function leerRecorrido(conexion, contribucionId) {
  const [filas] = await conexion.execute(
    `SELECT installation_id FROM recorrido_contribuciones_federacion
      WHERE contribucion_id=? ORDER BY ordinal`,
    [contribucionId]
  );
  return filas.map((fila) => fila.installation_id);
}

async function obtenerDivergencia(conexion, entrada, bloquear) {
  const [filas] = await conexion.execute(
    `SELECT d.*,p.scope_tenant_id,p.scope_empresa_id,p.scope_sitio_id
       FROM divergencias_proyecciones_federacion d
       JOIN proyecciones_federacion p ON p.proyeccion_id=d.proyeccion_id
      WHERE d.proyeccion_id=? AND d.inbox_ocurrencia_id=?
        AND d.secuencia_ambigua=?${bloquear ? ' FOR UPDATE' : ''}`,
    [entrada.proyeccionId, entrada.inboxId, entrada.secuencia]
  );
  return filas[0] || null;
}

async function obtenerEstadoActual(conexion, proyeccionId, bloquear) {
  const [filas] = await conexion.execute(
    `SELECT v.* FROM estados_actuales_proyecciones_federacion e
       JOIN versiones_proyecciones_federacion v
         ON v.proyeccion_id=e.proyeccion_id
        AND v.generacion_id=e.generacion_actual_id
      WHERE e.proyeccion_id=?${bloquear ? ' FOR UPDATE' : ''}`,
    [proyeccionId]
  );
  return filas[0] || null;
}

async function obtenerDivergenciaPorId(conexion, id, bloquear) {
  const [filas] = await conexion.execute(
    `SELECT d.*,p.scope_tenant_id,p.scope_empresa_id,p.scope_sitio_id
       FROM divergencias_proyecciones_federacion d
       JOIN proyecciones_federacion p ON p.proyeccion_id=d.proyeccion_id
      WHERE d.id=?${bloquear ? ' FOR UPDATE' : ''}`,
    [id]
  );
  return filas[0] || null;
}

async function obtenerVarianteRuta(conexion, id, divergenciaId) {
  const [filas] = await conexion.execute(
    `SELECT * FROM variantes_divergencias_proyecciones_federacion
      WHERE id=? AND divergencia_id=? FOR UPDATE`,
    [id, divergenciaId]
  );
  return filas[0] || null;
}

function claveAviso(contexto, divergenciaId) {
  return {
    versionCatalogo: 1,
    tipoCodigo: 'consistencia',
    causaCodigo: 'divergencia_ocurrencia',
    objetoTipo: 'proyeccion_federada',
    objetoId: `${contexto.proyeccion_id}:divergencia:${divergenciaId}`,
    relacionId: null,
    flujoId: null,
    scope: scopeFila(contexto)
  };
}

function scopeFila(fila) {
  return {
    tenantId: decimalNullable(fila.scope_tenant_id),
    empresaId: decimalNullable(fila.scope_empresa_id),
    sitioId: decimalNullable(fila.scope_sitio_id)
  };
}

function scopeCubre(actor, afectado) {
  if (!actor || actor.tenantId === null) {
    return actor?.empresaId === null && actor?.sitioId === null;
  }
  if (actor.tenantId !== afectado.tenantId) return false;
  if (actor.empresaId === null) return actor.sitioId === null;
  if (actor.empresaId !== afectado.empresaId) return false;
  return actor.sitioId === null || actor.sitioId === afectado.sitioId;
}

function decimalNullable(valor) {
  return valor == null ? null : String(valor);
}

function sha256(texto) {
  return createHash('sha256').update(texto, 'utf8').digest();
}

function fechaIso(valor) {
  if (valor instanceof Date) return valor.toISOString();
  const texto = String(valor);
  return texto.includes('T') ? texto : `${texto.replace(' ', 'T')}Z`;
}

function exigirConexion(conexion) {
  if (!conexion?.execute || !conexion?.query) {
    fallar('transaccion_divergencia_ausente', 'La divergencia exige SQL prestado.');
  }
}

async function exigirTransaccionActiva(conexion) {
  const [filas] = await conexion.query('SELECT @@in_transaction AS activa');
  if (!Boolean(filas[0]?.activa)) {
    fallar('transaccion_divergencia_inactiva', 'La divergencia exige transacción activa.');
  }
}

async function ahoraSql(conexion) {
  const [filas] = await conexion.query('SELECT UTC_TIMESTAMP(3) AS ahora');
  return filas[0].ahora;
}

function fallar(codigo, mensaje) {
  throw new ErrorDivergenciaFederacionSql(codigo, mensaje);
}

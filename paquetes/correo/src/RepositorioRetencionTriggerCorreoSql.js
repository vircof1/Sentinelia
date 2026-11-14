import { normalizarMarcaUtc }
  from '../../utilidades/src/fechas/normalizarMarcaUtc.js';

const ESTADOS_TERMINALES_EJECUCION = new Set(['ok', 'error']);
const ESTADOS_TERMINALES_SALIDA = new Set([
  'enviado',
  'error_final',
  'resultado_ambiguo',
  'descartada'
]);

export class RepositorioRetencionTriggerCorreoSql {
  constructor(clienteSql) {
    if (typeof clienteSql?.consultar !== 'function') {
      throw new Error('La retención de correo requiere un cliente SQL operativo.');
    }
    this.clienteSql = clienteSql;
  }

  async listarCandidatosTerminales({ retencionDias, limite = 100 } = {}) {
    const dias = diasRetencion(retencionDias);
    const maximo = limiteLote(limite);
    const ejecuciones = await this.clienteSql.consultar(`
      SELECT e.id, e.finalizado_en_utc AS referencia_utc
        FROM ejecuciones_triggers e
       WHERE e.tipo_trigger='correo'
         AND e.estado_ejecucion IN ('ok','error')
         AND e.finalizado_en_utc IS NOT NULL
         AND NOT (JSON_UNQUOTE(JSON_EXTRACT(
               e.payload_respuesta, '$.detalle_correo_estado'
             )) <=> 'purgado')
         AND (
           (
             EXISTS (
               SELECT 1 FROM notificaciones_triggers_correo n
                WHERE n.ejecucion_trigger_id=e.id
             )
             AND NOT EXISTS (
               SELECT 1
                 FROM cola_correos_salida s
                 LEFT JOIN capacidades_desuscripcion_correo c
                   ON c.salida_correo_id=s.id
                WHERE s.ejecucion_trigger_id=e.id
                  AND (
                    s.estado NOT IN ('enviado','error_final','resultado_ambiguo')
                    OR s.fecha_terminal_utc IS NULL
                    OR TIMESTAMPADD(DAY, ?, s.fecha_terminal_utc) > UTC_TIMESTAMP(3)
                    OR c.id IS NULL
                    OR c.estado <> 'emitida'
                    OR c.expira_en_utc IS NULL
                    OR c.expira_en_utc > UTC_TIMESTAMP(3)
                  )
             )
           )
           OR
           (
             NOT EXISTS (
               SELECT 1 FROM notificaciones_triggers_correo n
                WHERE n.ejecucion_trigger_id=e.id
             )
             AND e.codigo_resultado NOT IN (
               'correo_notificacion_aceptada_completa',
               'correo_notificacion_aceptada_parcial'
             )
             AND TIMESTAMPADD(DAY, ?, e.finalizado_en_utc) <= UTC_TIMESTAMP(3)
           )
         )
       ORDER BY e.id ASC
       LIMIT ?
    `, [dias, dias, maximo]);
    const pruebas = await this.clienteSql.consultar(`
      SELECT s.id,
             COALESCE(s.fecha_terminal_utc, s.fecha_envio,
                      s.fecha_ultimo_intento, s.fecha_actualizacion) AS referencia_utc
        FROM cola_correos_salida s
       WHERE s.origen_tipo='prueba'
         AND s.estado IN ('enviado','error_final','resultado_ambiguo')
         AND TIMESTAMPADD(
               DAY, ?,
               COALESCE(s.fecha_terminal_utc, s.fecha_envio,
                        s.fecha_ultimo_intento, s.fecha_actualizacion)
             ) <= UTC_TIMESTAMP(3)
       ORDER BY s.id ASC
       LIMIT ?
    `, [dias, maximo]);
    const recuperaciones = await this.clienteSql.consultar(`
        SELECT s.id,
               s.proposito_recuperacion_password,
               s.estado,
               s.causa_descarte,
               COALESCE(s.fecha_terminal_utc, s.fecha_envio,
                        s.fecha_ultimo_intento, s.fecha_actualizacion)
                 AS referencia_utc
          FROM cola_correos_salida s
         WHERE s.origen_tipo='recuperacion_password'
           AND s.estado IN ('enviado','error_final','resultado_ambiguo','descartada')
           AND s.fecha_terminal_utc IS NOT NULL
           AND TIMESTAMPADD(DAY, ?, s.fecha_terminal_utc) <= UTC_TIMESTAMP(3)
         ORDER BY s.id ASC
         LIMIT ?
      `, [dias, maximo]);
    const reiniciosAdministrativos = await this.clienteSql.consultar(`
      SELECT s.id,s.estado,
             COALESCE(s.fecha_terminal_utc,s.fecha_envio,
                      s.fecha_ultimo_intento,s.fecha_actualizacion)
               AS referencia_utc
        FROM cola_correos_salida s
       WHERE s.origen_tipo='reinicio_password_administrativo'
         AND s.estado IN ('enviado','error_final','resultado_ambiguo','descartada')
         AND s.fecha_terminal_utc IS NOT NULL
         AND TIMESTAMPADD(DAY, ?, s.fecha_terminal_utc) <= UTC_TIMESTAMP(3)
       ORDER BY s.id ASC
       LIMIT ?
    `, [dias, maximo]);
    const seleccion = [
      ...ejecuciones.map((fila) => ({ tipo: 'ejecucion', fila })),
      ...pruebas.map((fila) => ({ tipo: 'prueba', fila })),
      ...recuperaciones.map((fila) => ({ tipo: 'recuperacion_password', fila })),
      ...reiniciosAdministrativos.map((fila) => ({
        tipo: 'reinicio_password_administrativo', fila
      }))
    ].sort(compararCandidatos).slice(0, maximo);
    const seleccionadas = (tipo) => seleccion
      .filter((item) => item.tipo === tipo)
      .map((item) => item.fila);
    return Object.freeze({
      ejecuciones: Object.freeze(seleccionadas('ejecucion').map((fila) => Object.freeze({
        tipo: 'ejecucion',
        id: String(fila.id),
        referenciaUtc: normalizarMarcaUtc(fila.referencia_utc)
      }))),
      pruebas: Object.freeze(seleccionadas('prueba').map((fila) => Object.freeze({
        tipo: 'prueba',
        id: String(fila.id),
        referenciaUtc: normalizarMarcaUtc(fila.referencia_utc)
      }))),
      recuperaciones: Object.freeze(seleccionadas('recuperacion_password')
        .map((fila) => Object.freeze({
          tipo: 'recuperacion_password',
          id: String(fila.id),
          proposito: fila.proposito_recuperacion_password,
          estado: fila.estado,
          causaDescarte: fila.causa_descarte,
          referenciaUtc: normalizarMarcaUtc(fila.referencia_utc)
        }))),
      reiniciosAdministrativos: Object.freeze(
        seleccionadas('reinicio_password_administrativo')
          .map((fila) => Object.freeze({
            tipo: 'reinicio_password_administrativo',
            id: String(fila.id),
            estado: fila.estado,
            referenciaUtc: normalizarMarcaUtc(fila.referencia_utc)
          }))
      )
    });
  }

  async purgarCandidatoEnTransaccion(candidato, {
    conexion,
    retencionDias
  } = {}) {
    await exigirConexionTransaccional(conexion);
    const dias = diasRetencion(retencionDias);
    if (candidato?.tipo === 'ejecucion') {
      return this.purgarEjecucionEnTransaccion(candidato.id, dias, conexion);
    }
    if (candidato?.tipo === 'prueba') {
      return this.purgarPruebaEnTransaccion(candidato.id, dias, conexion);
    }
    if (candidato?.tipo === 'recuperacion_password') {
      return this.purgarRecuperacionEnTransaccion(candidato.id, dias, conexion);
    }
    if (candidato?.tipo === 'reinicio_password_administrativo') {
      return this.purgarReinicioAdministrativoEnTransaccion(
        candidato.id, dias, conexion
      );
    }
    throw new Error('El candidato de retención de correo no pertenece al contrato.');
  }

  async purgarEjecucionEnTransaccion(id, dias, conexion) {
    const ejecucionId = idDecimal(id, 'ejecucionId');
    const [ejecuciones] = await conexion.execute(`
      SELECT * FROM ejecuciones_triggers
       WHERE id=? AND tipo_trigger='correo'
       FOR UPDATE
    `, [ejecucionId]);
    const ejecucion = ejecuciones[0];
    if (!ejecucion) return resultado('ausente', 'ejecucion', ejecucionId);
    if (!ESTADOS_TERMINALES_EJECUCION.has(ejecucion.estado_ejecucion) ||
        !ejecucion.finalizado_en_utc) {
      return resultado('protegido', 'ejecucion', ejecucionId, 'ejecucion_no_terminal');
    }

    const [notificaciones] = await conexion.execute(`
      SELECT * FROM notificaciones_triggers_correo
       WHERE ejecucion_trigger_id=? ORDER BY id ASC FOR UPDATE
    `, [ejecucionId]);
    const [salidas] = await conexion.execute(`
      SELECT * FROM cola_correos_salida
       WHERE ejecucion_trigger_id=? ORDER BY id ASC FOR UPDATE
    `, [ejecucionId]);
    const idsSalida = salidas.map((fila) => String(fila.id));
    const capacidades = await bloquearPorSalidas(
      conexion,
      'capacidades_desuscripcion_correo',
      idsSalida
    );
    const intentos = await bloquearPorSalidas(
      conexion,
      'intentos_correos_salida',
      idsSalida
    );
    const reclamaciones = await bloquearPorSalidas(
      conexion,
      'reclamaciones_correos_salida',
      idsSalida
    );
    const [resultados] = await conexion.execute(`
      SELECT * FROM resultados_destinatarios_triggers_correo
       WHERE ejecucion_trigger_id=? ORDER BY id ASC FOR UPDATE
    `, [ejecucionId]);

    const payload = parsearJson(ejecucion.payload_respuesta);
    if (payload.detalle_correo_estado === 'purgado') {
      if (notificaciones.length || salidas.length || resultados.length) {
        throw errorInvariante(
          'Una ejecución marcada como purgada todavía conserva detalle de correo.'
        );
      }
      return resultado('ya_purgado', 'ejecucion', ejecucionId);
    }

    const aceptada = esAceptacion(ejecucion.codigo_resultado);
    if (aceptada && notificaciones.length !== 1) {
      throw errorInvariante(
        'Una ejecución aceptada no conserva exactamente una intención de correo.'
      );
    }
    if (!aceptada && notificaciones.length > 0) {
      throw errorInvariante(
        'Una intención de correo no corresponde a una aceptación genérica.'
      );
    }
    if (aceptada && salidas.length === 0) {
      throw errorInvariante('Una intención aceptada no conserva salidas físicas.');
    }

    const [reloj] = await conexion.execute(
      'SELECT UTC_TIMESTAMP(3) AS ahora_utc'
    );
    const ahora = reloj[0].ahora_utc;
    const proteccion = aceptada
      ? causaProteccionSalidas(salidas, capacidades, dias, ahora)
      : causaProteccionRechazo(ejecucion.finalizado_en_utc, dias, ahora);
    if (proteccion) {
      return resultado('protegido', 'ejecucion', ejecucionId, proteccion);
    }

    const resumen = construirResumen({
      resultados,
      salidas,
      capacidades,
      intentos,
      reclamaciones,
      intenciones: notificaciones.length
    });
    const fechaPurga = normalizarMarcaUtc(ahora);
    const payloadPurgado = {
      ...payload,
      detalle_correo_estado: 'purgado',
      detalle_correo_purgado_en_utc: fechaPurga,
      detalle_correo_resumen: resumen
    };
    await conexion.execute(
      'UPDATE ejecuciones_triggers SET payload_respuesta=? WHERE id=?',
      [JSON.stringify(payloadPurgado), ejecucionId]
    );

    await borrarPorSalidas(conexion, 'capacidades_desuscripcion_correo', idsSalida);
    await borrarPorSalidas(conexion, 'intentos_correos_salida', idsSalida);
    await borrarPorSalidas(conexion, 'reclamaciones_correos_salida', idsSalida);
    await conexion.execute(
      'DELETE FROM resultados_destinatarios_triggers_correo WHERE ejecucion_trigger_id=?',
      [ejecucionId]
    );
    await borrarSalidas(conexion, idsSalida);
    await conexion.execute(
      'DELETE FROM notificaciones_triggers_correo WHERE ejecucion_trigger_id=?',
      [ejecucionId]
    );
    return Object.freeze({
      ...resultado('purgado', 'ejecucion', ejecucionId),
      fechaPurgaUtc: fechaPurga,
      resumen
    });
  }

  async purgarPruebaEnTransaccion(id, dias, conexion) {
    const salidaId = idDecimal(id, 'salidaPruebaId');
    const [filas] = await conexion.execute(`
      SELECT * FROM cola_correos_salida
       WHERE id=? AND origen_tipo='prueba'
       FOR UPDATE
    `, [salidaId]);
    const salida = filas[0];
    if (!salida) return resultado('ausente', 'prueba', salidaId);
    const referencia = salida.fecha_terminal_utc || salida.fecha_envio ||
      salida.fecha_ultimo_intento || salida.fecha_actualizacion;
    const [reloj] = await conexion.execute(
      'SELECT UTC_TIMESTAMP(3) AS ahora_utc'
    );
    if (!ESTADOS_TERMINALES_SALIDA.has(salida.estado) ||
        !referencia || !plazoCumplido(referencia, dias, reloj[0].ahora_utc)) {
      return resultado('protegido', 'prueba', salidaId, 'salida_no_elegible');
    }
    const idsSalida = [salidaId];
    await bloquearPorSalidas(conexion, 'capacidades_desuscripcion_correo', idsSalida);
    await bloquearPorSalidas(conexion, 'intentos_correos_salida', idsSalida);
    await bloquearPorSalidas(conexion, 'reclamaciones_correos_salida', idsSalida);
    await borrarPorSalidas(conexion, 'capacidades_desuscripcion_correo', idsSalida);
    await borrarPorSalidas(conexion, 'intentos_correos_salida', idsSalida);
    await borrarPorSalidas(conexion, 'reclamaciones_correos_salida', idsSalida);
    await borrarSalidas(conexion, idsSalida);
    return resultado('purgado', 'prueba', salidaId);
  }

  async purgarRecuperacionEnTransaccion(id, dias, conexion) {
    const salidaId = idDecimal(id, 'salidaRecuperacionPasswordId');
    const [filas] = await conexion.execute(`
      SELECT * FROM cola_correos_salida
       WHERE id=? AND origen_tipo='recuperacion_password'
       FOR UPDATE
    `, [salidaId]);
    const salida = filas[0];
    if (!salida) return resultado('ausente', 'recuperacion_password', salidaId);
    const [reloj] = await conexion.execute('SELECT UTC_TIMESTAMP(3) AS ahora_utc');
    if (!ESTADOS_TERMINALES_SALIDA.has(salida.estado) ||
        !salida.fecha_terminal_utc ||
        !plazoCumplido(salida.fecha_terminal_utc, dias, reloj[0].ahora_utc)) {
      return resultado(
        'protegido', 'recuperacion_password', salidaId, 'salida_no_elegible'
      );
    }
    const idsSalida = [salidaId];
    await bloquearPorSalidas(conexion, 'intentos_correos_salida', idsSalida);
    await bloquearPorSalidas(conexion, 'reclamaciones_correos_salida', idsSalida);
    const [proyeccion] = await conexion.execute(`
      SELECT usuario_id
        FROM identidades_justificantes_correos_recuperacion_password
       WHERE salida_correo_id=? ORDER BY usuario_id ASC FOR UPDATE
    `, [salidaId]);
    await borrarPorSalidas(conexion, 'intentos_correos_salida', idsSalida);
    await borrarPorSalidas(conexion, 'reclamaciones_correos_salida', idsSalida);
    await borrarSalidas(conexion, idsSalida);
    return Object.freeze({
      ...resultado('purgado', 'recuperacion_password', salidaId),
      resumen: Object.freeze({
        perfil: 'retencion-correo-recuperacion-password@1',
        estado: salida.estado,
        proposito: salida.proposito_recuperacion_password,
        causaDescarte: salida.causa_descarte,
        identidadesJustificantes: proyeccion.length
      })
    });
  }

  async diagnosticarIntegridadRecuperacionPassword({ limite = 100 } = {}) {
    const maximo = limiteLote(limite);
    const filas = await this.clienteSql.consultar(`
      SELECT s.id,s.estado,s.proposito_recuperacion_password,
             s.fecha_terminal_utc,s.causa_descarte,
             COUNT(p.usuario_id) AS identidades_justificantes
        FROM cola_correos_salida s
        LEFT JOIN identidades_justificantes_correos_recuperacion_password p
          ON p.salida_correo_id=s.id
       WHERE s.origen_tipo='recuperacion_password'
       GROUP BY s.id
      HAVING (s.proposito_recuperacion_password IS NULL)
          OR (s.estado IN ('enviado','error_final','resultado_ambiguo','descartada')
              AND s.fecha_terminal_utc IS NULL)
          OR (s.estado='descartada' AND s.causa_descarte IS NULL)
          OR (s.estado<>'descartada' AND s.causa_descarte IS NOT NULL)
          OR COUNT(p.usuario_id)=0
       ORDER BY s.id ASC
       LIMIT ?
    `, [maximo]);
    return Object.freeze({
      ok: filas.length === 0,
      limite: maximo,
      totalIncompatibles: filas.length,
      salidas: Object.freeze(filas.map((fila) => Object.freeze({
        salidaId: String(fila.id),
        estado: fila.estado,
        proposito: fila.proposito_recuperacion_password,
        causaDescarte: fila.causa_descarte,
        identidadesJustificantes: Number(fila.identidades_justificantes || 0)
      })))
    });
  }

  async purgarReinicioAdministrativoEnTransaccion(id, dias, conexion) {
    const salidaId = idDecimal(id, 'salidaReinicioPasswordAdministrativoId');
    // La coordinación de esta procedencia bloquea operación -> salida. La
    // retención conserva el mismo orden para no crear un ciclo de locks.
    const [operaciones] = await conexion.execute(`
      SELECT reinicio_id,via,estado,salida_correo_id,evento_auditoria_id
        FROM reinicios_password_administrativos
       WHERE salida_correo_id=? LIMIT 1 FOR UPDATE
    `, [salidaId]);
    const [filas] = await conexion.execute(`
      SELECT * FROM cola_correos_salida
       WHERE id=? AND origen_tipo='reinicio_password_administrativo'
       FOR UPDATE
    `, [salidaId]);
    const salida = filas[0];
    if (!salida) {
      return resultado('ausente', 'reinicio_password_administrativo', salidaId);
    }
    const operacion = operaciones[0];
    if (!operacion || operacion.estado !== 'confirmado' ||
        operacion.via !== 'correo' ||
        String(operacion.salida_correo_id) !== salidaId ||
        !operacion.evento_auditoria_id) {
      throw errorInvariante(
        'Una salida administrativa no conserva su operación confirmada y auditable.'
      );
    }
    const [reloj] = await conexion.execute('SELECT UTC_TIMESTAMP(3) AS ahora_utc');
    if (!ESTADOS_TERMINALES_SALIDA.has(salida.estado) ||
        !salida.fecha_terminal_utc ||
        !plazoCumplido(salida.fecha_terminal_utc, dias, reloj[0].ahora_utc)) {
      return resultado(
        'protegido', 'reinicio_password_administrativo', salidaId,
        'salida_no_elegible'
      );
    }
    const idsSalida = [salidaId];
    const intentos = await bloquearPorSalidas(
      conexion, 'intentos_correos_salida', idsSalida
    );
    const reclamaciones = await bloquearPorSalidas(
      conexion, 'reclamaciones_correos_salida', idsSalida
    );
    await borrarPorSalidas(conexion, 'intentos_correos_salida', idsSalida);
    await borrarPorSalidas(conexion, 'reclamaciones_correos_salida', idsSalida);
    await borrarSalidas(conexion, idsSalida);
    return Object.freeze({
      ...resultado('purgado', 'reinicio_password_administrativo', salidaId),
      resumen: Object.freeze({
        perfil: 'retencion-correo-reinicio-password-administrativo@1',
        estado: salida.estado,
        intentos: intentos.length,
        reclamaciones: reclamaciones.length,
        auditoriaConservada: true
      })
    });
  }

  async diagnosticarIntegridadReinicioPasswordAdministrativo({ limite = 100 } = {}) {
    const maximo = limiteLote(limite);
    const filas = await this.clienteSql.consultar(`
      SELECT s.id,s.estado,s.fecha_terminal_utc,r.estado AS estado_operacion,
             r.via,r.salida_correo_id,r.evento_auditoria_id
        FROM cola_correos_salida s
        LEFT JOIN reinicios_password_administrativos r
          ON r.reinicio_id=s.reinicio_password_administrativo_id
       WHERE s.origen_tipo='reinicio_password_administrativo'
         AND (
           r.reinicio_id IS NULL OR r.estado<>'confirmado' OR r.via<>'correo'
           OR NOT (r.salida_correo_id <=> s.id)
           OR r.evento_auditoria_id IS NULL
           OR s.proposito_recuperacion_password IS NOT NULL
           OR s.solicitud_recuperacion_password_id IS NOT NULL
           OR s.evento_emision_recuperacion_password_id IS NOT NULL
           OR s.material_preparacion_recuperacion_password IS NOT NULL
           OR (s.estado IN ('enviado','error_final','resultado_ambiguo','descartada')
               AND s.fecha_terminal_utc IS NULL)
           OR (s.estado='descartada' AND s.causa_descarte IS NULL)
           OR (s.estado<>'descartada' AND s.causa_descarte IS NOT NULL)
         )
       ORDER BY s.id ASC LIMIT ?
    `, [maximo]);
    return Object.freeze({
      ok: filas.length === 0,
      limite: maximo,
      totalIncompatibles: filas.length,
      salidas: Object.freeze(filas.map((fila) => Object.freeze({
        salidaId: String(fila.id),
        estado: fila.estado,
        estadoOperacion: fila.estado_operacion || null,
        via: fila.via || null
      })))
    });
  }
}

function compararCandidatos(a, b) {
  const fechaA = new Date(a.fila.referencia_utc).getTime();
  const fechaB = new Date(b.fila.referencia_utc).getTime();
  if (fechaA !== fechaB) return fechaA - fechaB;
  const idA = BigInt(a.fila.id);
  const idB = BigInt(b.fila.id);
  if (idA !== idB) return idA < idB ? -1 : 1;
  return a.tipo.localeCompare(b.tipo);
}

function causaProteccionSalidas(salidas, capacidades, dias, ahora) {
  const porSalida = new Map(capacidades.map((fila) => [String(fila.salida_correo_id), fila]));
  for (const salida of salidas) {
    if (!ESTADOS_TERMINALES_SALIDA.has(salida.estado) || !salida.fecha_terminal_utc) {
      return 'backlog_no_terminal';
    }
    if (!plazoCumplido(salida.fecha_terminal_utc, dias, ahora)) {
      return 'retencion_no_cumplida';
    }
    const capacidad = porSalida.get(String(salida.id));
    if (!capacidad || capacidad.estado !== 'emitida' ||
        !capacidad.expira_en_utc ||
        new Date(capacidad.expira_en_utc).getTime() > new Date(ahora).getTime()) {
      return 'capacidad_vigente_o_no_emitida';
    }
  }
  return null;
}

function causaProteccionRechazo(finalizado, dias, ahora) {
  return plazoCumplido(finalizado, dias, ahora) ? null : 'retencion_no_cumplida';
}

function plazoCumplido(referencia, dias, ahora) {
  const inicioMs = new Date(referencia).getTime();
  const ahoraMs = new Date(ahora).getTime();
  return Number.isFinite(inicioMs) && Number.isFinite(ahoraMs) &&
    inicioMs + dias * 86_400_000 <= ahoraMs;
}

function construirResumen({
  resultados,
  salidas,
  capacidades,
  intentos,
  reclamaciones,
  intenciones
}) {
  return Object.freeze({
    perfil: 'retencion-correo@1',
    intenciones: Number(intenciones),
    resultados: Object.freeze({
      total: resultados.length,
      porCodigoInicial: contarPor(resultados, 'codigo_inicial')
    }),
    salidas: Object.freeze({
      total: salidas.length,
      porEstado: contarPor(salidas, 'estado')
    }),
    capacidades: capacidades.length,
    intentos: intentos.length,
    reclamaciones: reclamaciones.length
  });
}

function contarPor(filas, campo) {
  const conteos = {};
  for (const fila of filas) {
    const clave = String(fila[campo] || 'desconocido');
    conteos[clave] = (conteos[clave] || 0) + 1;
  }
  return Object.freeze(Object.fromEntries(
    Object.entries(conteos).sort(([a], [b]) => a.localeCompare(b))
  ));
}

async function bloquearPorSalidas(conexion, tabla, ids) {
  if (ids.length === 0) return [];
  const [filas] = await conexion.execute(
    `SELECT * FROM ${tabla} WHERE salida_correo_id IN (${marcadores(ids)}) ` +
      'ORDER BY id ASC FOR UPDATE',
    ids
  );
  return filas;
}

async function borrarPorSalidas(conexion, tabla, ids) {
  if (ids.length === 0) return;
  await conexion.execute(
    `DELETE FROM ${tabla} WHERE salida_correo_id IN (${marcadores(ids)})`,
    ids
  );
}

async function borrarSalidas(conexion, ids) {
  if (ids.length === 0) return;
  await conexion.execute(
    `DELETE FROM cola_correos_salida WHERE id IN (${marcadores(ids)})`,
    ids
  );
}

function marcadores(ids) {
  return ids.map(() => '?').join(',');
}

function esAceptacion(codigo) {
  return codigo === 'correo_notificacion_aceptada_completa' ||
    codigo === 'correo_notificacion_aceptada_parcial';
}

function parsearJson(valor) {
  if (valor == null) return {};
  if (typeof valor === 'object' && !Buffer.isBuffer(valor)) {
    return structuredClone(valor);
  }
  try {
    const resultado = JSON.parse(String(valor));
    return resultado && typeof resultado === 'object' && !Array.isArray(resultado)
      ? resultado
      : {};
  } catch {
    throw errorInvariante('El resultado genérico de correo no contiene JSON válido.');
  }
}

function resultado(estado, tipo, id, causa = null) {
  return Object.freeze({ estado, tipo, id: String(id), causa });
}

function errorInvariante(mensaje) {
  return Object.assign(new Error(mensaje), {
    codigo: 'invariante_retencion_trigger_correo_rota'
  });
}

function idDecimal(valor, campo) {
  const texto = String(valor ?? '');
  if (!/^[1-9][0-9]*$/u.test(texto)) {
    throw new Error(`${campo} no es una identidad decimal positiva.`);
  }
  return texto;
}

function diasRetencion(valor) {
  const numero = Number(valor);
  if (!Number.isSafeInteger(numero) || numero < 1 || numero > 3650) {
    throw new Error('retencionDias debe estar entre 1 y 3650.');
  }
  return numero;
}

function limiteLote(valor) {
  const numero = Number(valor);
  if (!Number.isSafeInteger(numero) || numero < 1 || numero > 500) {
    throw new Error('limite debe estar entre 1 y 500.');
  }
  return numero;
}

async function exigirConexionTransaccional(conexion) {
  if (!conexion?.execute || !conexion?.query) {
    throw new Error('La retención de correo exige una conexión SQL prestada.');
  }
  const [filas] = await conexion.query('SELECT @@in_transaction AS activa');
  if (!Boolean(filas[0]?.activa)) {
    throw new Error('La retención de correo exige una transacción SQL activa.');
  }
}

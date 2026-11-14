import {
  bytesAUuidV7Auditoria,
  generarUuidV7Auditoria,
  uuidV7AuditoriaABytes
} from '../../auditoria/src/UuidV7Auditoria.js';
import {
  TIPOS_IDENTIDAD_FEDERADA,
  crearIdentidadFederada
} from '../src/IdentidadFederada.js';

const MAX_BIGINT_UNSIGNED = 18_446_744_073_709_551_615n;

export class RepositorioSaludFederacionSql {
  constructor(clienteSql, { adaptadorAuditoria = null } = {}) {
    if (typeof clienteSql?.obtenerConexion !== 'function') {
      throw new Error('La salud federada requiere SQL operativo.');
    }
    this.clienteSql = clienteSql;
    this.adaptadorAuditoria = adaptadorAuditoria;
  }

  async registrarHeartbeatEmisor({
    relacionId,
    sesionId = null,
    seq = null,
    compatibilidad = 'pendiente',
    estadoRemoto = null,
    exito,
    codigoError = null
  } = {}) {
    const relacion = identidad(relacionId, TIPOS_IDENTIDAD_FEDERADA.RELACION);
    if (typeof exito !== 'boolean') throw new Error('exito debe ser booleano.');
    const sesionBytes = exito
      ? uuidV7AuditoriaABytes(sesionId, 'sesionId')
      : null;
    const secuencia = exito ? secuenciaBigint(seq) : 0n;
    if (!['pendiente', 'compatible', 'incompatible'].includes(compatibilidad)) {
      throw new Error('La compatibilidad emisora no es válida.');
    }
    if (estadoRemoto !== null &&
        !['pendienteAutenticacion', 'vinculada'].includes(estadoRemoto)) {
      throw new Error('El estado remoto de la relación no es válido.');
    }
    const errorNormalizado = exito ? null : normalizarCodigoError(codigoError);
    const conexion = await this.clienteSql.obtenerConexion();
    try {
      await conexion.beginTransaction();
      await conexion.execute(
        `INSERT INTO actividad_emision_relaciones_federacion (
         relacion_id,ultimo_intento_utc,ultima_actividad_autenticada_utc,
         ultimo_error_codigo,fallos_consecutivos,compatibilidad_remota,
         ultimo_heartbeat_seq,ultima_sesion_id,actualizado_en_utc
       ) VALUES (?,UTC_TIMESTAMP(3),IF(?,UTC_TIMESTAMP(3),NULL),?,IF(?,0,1),?,?,?,UTC_TIMESTAMP(3))
       ON DUPLICATE KEY UPDATE
         ultimo_intento_utc=UTC_TIMESTAMP(3),
         ultima_actividad_autenticada_utc=IF(
           VALUES(ultima_actividad_autenticada_utc) IS NULL,
           ultima_actividad_autenticada_utc,
           VALUES(ultima_actividad_autenticada_utc)
         ),
         ultimo_error_codigo=VALUES(ultimo_error_codigo),
         fallos_consecutivos=IF(?,0,LEAST(fallos_consecutivos+1,4294967295)),
         compatibilidad_remota=IF(?,VALUES(compatibilidad_remota),compatibilidad_remota),
         ultimo_heartbeat_seq=IF(?,VALUES(ultimo_heartbeat_seq),ultimo_heartbeat_seq),
         ultima_sesion_id=IF(?,VALUES(ultima_sesion_id),ultima_sesion_id),
         actualizado_en_utc=UTC_TIMESTAMP(3)`,
        [relacion, exito, errorNormalizado, exito, compatibilidad,
          secuencia.toString(), sesionBytes, exito, exito, exito, exito]
      );
      if (exito) {
        await this.#consolidarRelacionEmisora(
          conexion,
          relacion,
          compatibilidad,
          estadoRemoto
        );
      }
      await conexion.commit();
    } catch (error) {
      try { await conexion.rollback(); } catch { /* conserva la causa */ }
      throw error;
    } finally { conexion.release(); }
  }

  async #consolidarRelacionEmisora(
    conexion,
    relacionId,
    compatibilidad,
    estadoRemoto
  ) {
    const [filas] = await conexion.execute(
      'SELECT * FROM relaciones_federacion WHERE relacion_id=? FOR UPDATE',
      [relacionId]
    );
    const relacion = filas[0];
    if (!relacion || relacion.direccion !== 'emision' ||
        !['pendienteAutenticacion', 'vinculada'].includes(relacion.estado_ciclo)) {
      throw new Error('La actividad autenticada no pertenece a una relación emisora viva.');
    }
    const estadoCompatibilidad = compatibilidad === 'pendiente'
      ? null
      : compatibilidad === 'compatible'
        ? 'compatible'
        : 'incompatible';
    if (relacion.estado_ciclo === 'pendienteAutenticacion' &&
        estadoRemoto === 'vinculada') {
      if (!estadoCompatibilidad || !this.adaptadorAuditoria) {
        throw new Error(
          'La primera autenticación exige compatibilidad y auditoría transaccional.'
        );
      }
      const ahora = await ahoraSql(conexion);
      const eventoId = generarUuidV7Auditoria();
      await conexion.execute(
        `UPDATE relaciones_federacion
            SET estado_ciclo='vinculada',estado_compatibilidad=?,
                revision=revision+1,actualizada_en_utc=?
          WHERE relacion_id=? AND revision=?`,
        [estadoCompatibilidad, ahora, relacionId, relacion.revision]
      );
      await insertarHistoricoVinculacionEmisora(
        conexion,
        relacion,
        estadoCompatibilidad,
        eventoId,
        ahora
      );
      await this.adaptadorAuditoria.registrarCompatibilidadEnTransaccion({
        eventoId,
        relacionId,
        installationRemotaId: relacion.installation_remota_id,
        scope: scopeRelacion(relacion),
        compatible: estadoCompatibilidad === 'compatible',
        estadoCicloNuevo: 'vinculada',
        efectivoEnUtc: fechaIso(ahora)
      }, { conexion });
    }
  }

  async obtenerFotografia({ silencioRelacionMs } = {}) {
    const margen = entero(silencioRelacionMs, 5_000, 86_400_000, 'silencioRelacionMs');
    const relaciones = await this.clienteSql.consultar(
      `SELECT r.relacion_id,r.direccion,r.installation_remota_id,
              r.nombre_remoto_declarado,r.estado_compatibilidad,
              r.estado_ciclo,r.estado_autoridad,r.estado_identidad,
              r.scope_tenant_id,r.scope_empresa_id,r.scope_sitio_id,
              r.actualizada_en_utc,
              h.ultimo_heartbeat_utc AS ultima_recepcion_utc,
              h.estado_compatibilidad AS compatibilidad_recepcion,
              a.ultimo_intento_utc,a.ultima_actividad_autenticada_utc,
              a.ultimo_error_codigo,a.fallos_consecutivos,
              a.compatibilidad_remota,
              IF(r.direccion='recepcion',h.ultimo_heartbeat_utc,
                 a.ultima_actividad_autenticada_utc) AS ultima_comunicacion_utc,
              TIMESTAMPDIFF(MICROSECOND,
                COALESCE(
                  IF(r.direccion='recepcion',h.ultimo_heartbeat_utc,
                     a.ultima_actividad_autenticada_utc),
                  r.actualizada_en_utc
                ),UTC_TIMESTAMP(3)) AS silencio_microsegundos
         FROM relaciones_federacion r
         LEFT JOIN estado_salud_relaciones_federacion h
           ON h.relacion_id=r.relacion_id AND r.direccion='recepcion'
         LEFT JOIN actividad_emision_relaciones_federacion a
           ON a.relacion_id=r.relacion_id AND r.direccion='emision'
        ORDER BY r.relacion_id`
    );
    const flujos = await this.clienteSql.consultar(
      `SELECT f.flujo_id,f.relacion_id,f.direccion,f.familia,f.estado,
              f.generacion_activa_id,c.posicion_terminal_contigua,
              c.posicion_terminal_remota,c.version_cursor_remoto,c.pausa_hasta_utc,
              c.causa_pausa,
              COALESCE(SUM(o.estado IN ('pendiente','procesando','reintentable')),0)
                AS total_pendientes,
              COALESCE(SUM(o.estado='bloqueada'),0) AS total_bloqueadas
         FROM flujos_federacion f
         JOIN relaciones_federacion r ON r.relacion_id=f.relacion_id
         LEFT JOIN control_generaciones_emision_federacion c
           ON c.flujo_id=f.flujo_id AND c.generacion_id=f.generacion_activa_id
              AND f.direccion='emision'
         LEFT JOIN outbox_federacion o
           ON o.flujo_id=f.flujo_id AND o.generacion_id=f.generacion_activa_id
              AND f.direccion='emision'
        WHERE r.estado_ciclo='vinculada' AND r.estado_autoridad='autorizada'
          AND r.estado_identidad='valida'
        GROUP BY f.flujo_id,f.relacion_id,f.direccion,f.familia,f.estado,
                 f.generacion_activa_id,c.posicion_terminal_contigua,
                 c.posicion_terminal_remota,c.version_cursor_remoto,
                 c.pausa_hasta_utc,c.causa_pausa
        ORDER BY f.relacion_id,f.flujo_id`
    );
    const estadosRemotos = await this.clienteSql.consultar(
      `SELECT e.proyeccion_id,e.generacion_id,e.secuencia_estado,e.condicion,
              e.vigente_hasta_efectiva_utc,e.efectivo_en_utc,
              e.materializado_en_utc,e.aviso_vencimiento_activo,e.version_estado,
              p.installation_origen_id,p.elemento_origen_id,
              p.scope_tenant_id,p.scope_empresa_id,p.scope_sitio_id,
              r.monitor_origen_id,r.estado_operativo
         FROM estados_temporales_fotografias_remotas e
         JOIN proyecciones_federacion p ON p.proyeccion_id=e.proyeccion_id
         LEFT JOIN registros_monitores_remotos r
           ON r.proyeccion_id=e.proyeccion_id
          AND r.generacion_id=e.generacion_id
          AND r.secuencia_elemento=e.secuencia_estado
        ORDER BY e.proyeccion_id`
    );
    return Object.freeze({
      relaciones: Object.freeze(relaciones.map((fila) => proyectarRelacion(fila, margen))),
      flujos: Object.freeze(flujos.map(proyectarFlujo)),
      estadosRemotos: Object.freeze(estadosRemotos.map(proyectarEstadoRemoto)),
      materializacionEstadoRemotoDisponible: true
    });
  }

  async prepararTransicionDiagnostico({
    relacionId,
    versionCatalogo,
    tipoCodigo,
    causaCodigo,
    activa,
    generarEventoId
  } = {}) {
    const relacion = identidad(relacionId, TIPOS_IDENTIDAD_FEDERADA.RELACION);
    const version = entero(versionCatalogo, 1, 65535, 'versionCatalogo');
    const tipo = codigo(tipoCodigo, 'tipoCodigo');
    const causa = codigo(causaCodigo, 'causaCodigo');
    if (typeof activa !== 'boolean' || typeof generarEventoId !== 'function') {
      throw new Error('La transición diagnóstica no es válida.');
    }
    const conexion = await this.clienteSql.obtenerConexion();
    try {
      await conexion.beginTransaction();
      const [filas] = await conexion.execute(
        `SELECT condicion_activa,evento_transicion_id,efectivo_en_utc,aplicado_en_utc
           FROM estados_diagnostico_relaciones_federacion
          WHERE relacion_id=? AND version_catalogo=? AND tipo_codigo=? AND causa_codigo=?
          FOR UPDATE`,
        [relacion, version, tipo, causa]
      );
      const anterior = filas[0] || null;
      if (anterior && anterior.aplicado_en_utc === null) {
        await conexion.commit();
        return proyectarTransicion(anterior, true);
      }
      if (!anterior && !activa) {
        await conexion.commit();
        return null;
      }
      if (anterior && Boolean(anterior.condicion_activa) === activa) {
        await conexion.commit();
        return null;
      }
      const eventoId = generarEventoId();
      const eventoBytes = uuidV7AuditoriaABytes(eventoId, 'eventoId');
      await conexion.execute(
        `INSERT INTO estados_diagnostico_relaciones_federacion (
           relacion_id,version_catalogo,tipo_codigo,causa_codigo,
           condicion_activa,evento_transicion_id,efectivo_en_utc,
           aplicado_en_utc,actualizado_en_utc
         ) VALUES (?,?,?,?,?,?,UTC_TIMESTAMP(3),NULL,UTC_TIMESTAMP(3))
         ON DUPLICATE KEY UPDATE condicion_activa=VALUES(condicion_activa),
           evento_transicion_id=VALUES(evento_transicion_id),
           efectivo_en_utc=VALUES(efectivo_en_utc),aplicado_en_utc=NULL,
           actualizado_en_utc=VALUES(actualizado_en_utc)`,
        [relacion, version, tipo, causa, activa, eventoBytes]
      );
      const [creadas] = await conexion.execute(
        `SELECT condicion_activa,evento_transicion_id,efectivo_en_utc,aplicado_en_utc
           FROM estados_diagnostico_relaciones_federacion
          WHERE relacion_id=? AND version_catalogo=? AND tipo_codigo=? AND causa_codigo=?`,
        [relacion, version, tipo, causa]
      );
      await conexion.commit();
      return proyectarTransicion(creadas[0], false);
    } catch (error) {
      try { await conexion.rollback(); } catch { /* conserva causa */ }
      throw error;
    } finally {
      conexion.release();
    }
  }

  async confirmarTransicionDiagnostico({ relacionId, versionCatalogo,
    tipoCodigo, causaCodigo, eventoId } = {}) {
    const [resultado] = await this.clienteSql.ejecutar(
      `UPDATE estados_diagnostico_relaciones_federacion
          SET aplicado_en_utc=COALESCE(aplicado_en_utc,UTC_TIMESTAMP(3)),
              actualizado_en_utc=UTC_TIMESTAMP(3)
        WHERE relacion_id=? AND version_catalogo=? AND tipo_codigo=?
          AND causa_codigo=? AND evento_transicion_id=?`,
      [identidad(relacionId, TIPOS_IDENTIDAD_FEDERADA.RELACION),
        entero(versionCatalogo, 1, 65535, 'versionCatalogo'),
        codigo(tipoCodigo, 'tipoCodigo'), codigo(causaCodigo, 'causaCodigo'),
        uuidV7AuditoriaABytes(eventoId, 'eventoId')]
    );
    if (Number(resultado.affectedRows) !== 1) {
      throw new Error('La transición diagnóstica cambió antes de confirmarse.');
    }
  }
}

function proyectarEstadoRemoto(fila) {
  return Object.freeze({
    proyeccionId: fila.proyeccion_id,
    generacionId: fila.generacion_id,
    secuenciaElemento: fila.secuencia_estado === null
      ? null
      : String(fila.secuencia_estado),
    installationOrigenId: fila.installation_origen_id,
    elementoOrigenId: fila.elemento_origen_id,
    monitorOrigenId: fila.monitor_origen_id,
    estadoOperativo: fila.estado_operativo,
    condicion: fila.condicion,
    vigenteHastaEfectivaUtc: new Date(fila.vigente_hasta_efectiva_utc).toISOString(),
    efectivoEnUtc: new Date(fila.efectivo_en_utc).toISOString(),
    materializadoEnUtc: new Date(fila.materializado_en_utc).toISOString(),
    avisoVencimientoActivo: Boolean(fila.aviso_vencimiento_activo),
    version: String(fila.version_estado),
    scope: Object.freeze(scope(fila))
  });
}

function proyectarRelacion(fila, margenMs) {
  const silencioMs = Math.max(0, Math.floor(Number(fila.silencio_microsegundos || 0) / 1000));
  const supervisable = fila.estado_ciclo === 'vinculada' &&
    fila.estado_autoridad === 'autorizada' && fila.estado_identidad === 'valida';
  const compatibilidadTecnica = fila.direccion === 'emision'
    ? fila.compatibilidad_remota || 'pendiente'
    : fila.compatibilidad_recepcion || fila.estado_compatibilidad;
  return Object.freeze({
    relacionId: fila.relacion_id,
    direccion: fila.direccion,
    installationRemotaId: fila.installation_remota_id,
    nombreRemoto: fila.nombre_remoto_declarado || null,
    ultimaComunicacionUtc: fila.ultima_comunicacion_utc
      ? new Date(fila.ultima_comunicacion_utc).toISOString()
      : null,
    scope: Object.freeze(scope(fila)),
    supervisable,
    comunicacion: supervisable
      ? (silencioMs > margenMs ? 'silenciosa' : 'activa')
      : 'no_aplicable',
    silencioMs,
    compatibilidad: supervisable
      ? (compatibilidadTecnica === 'incompatible'
          ? 'incompatible' : compatibilidadTecnica)
      : 'no_aplicable',
    ultimoErrorCodigo: fila.ultimo_error_codigo || null,
    fallosConsecutivos: Number(fila.fallos_consecutivos || 0)
  });
}

function proyectarFlujo(fila) {
  const pendientes = Number(fila.total_pendientes || 0);
  const bloqueadas = Number(fila.total_bloqueadas || 0);
  const pausado = fila.pausa_hasta_utc && new Date(fila.pausa_hasta_utc).getTime() > Date.now();
  return Object.freeze({
    flujoId: fila.flujo_id,
    relacionId: fila.relacion_id,
    direccion: fila.direccion,
    familia: fila.familia,
    estadoDominio: fila.estado,
    salud: resolverSaludFlujo({ fila, pendientes, bloqueadas, pausado }),
    generacionId: fila.generacion_activa_id || null,
    pendientes,
    bloqueadas,
    posicionTerminalContigua: fila.posicion_terminal_contigua == null
      ? null : String(fila.posicion_terminal_contigua),
    posicionTerminalRemota: fila.posicion_terminal_remota == null
      ? null : String(fila.posicion_terminal_remota),
    versionCursorRemoto: fila.version_cursor_remoto == null
      ? null : String(fila.version_cursor_remoto),
    causaPausa: fila.causa_pausa || null
  });
}

function resolverSaludFlujo({ fila, pendientes, bloqueadas, pausado }) {
  if (fila.estado === 'detenido') return 'detenido';
  if (fila.estado === 'degradado') return 'degradado';
  if (fila.estado === 'saturado') return 'saturado';
  if (fila.direccion === 'emision') {
    if (bloqueadas > 0) return 'bloqueado';
    if (pausado) return 'pausado';
    if (pendientes > 0) return 'conBacklog';
  }
  if (fila.estado === 'operativoCompleto') return 'alDia';
  if (fila.estado === 'operativoParcial') return 'operativoParcial';
  return 'enProgreso';
}

function proyectarTransicion(fila, repetida) {
  return Object.freeze({
    activa: Boolean(fila.condicion_activa),
    eventoId: bytesAUuidV7Auditoria(fila.evento_transicion_id),
    efectivoEnUtc: fechaIso(fila.efectivo_en_utc),
    repetida
  });
}

function scope(fila) {
  return {
    tenantId: fila.scope_tenant_id == null ? null : String(fila.scope_tenant_id),
    empresaId: fila.scope_empresa_id == null ? null : String(fila.scope_empresa_id),
    sitioId: fila.scope_sitio_id == null ? null : String(fila.scope_sitio_id)
  };
}

function fechaIso(valor) {
  return valor instanceof Date
    ? valor.toISOString()
    : `${String(valor).replace(' ', 'T').replace(/Z$/u, '')}Z`;
}

function secuenciaBigint(valor) {
  if (typeof valor !== 'string' || !/^[1-9][0-9]*$/u.test(valor)) {
    throw new Error('seq debe ser un entero decimal positivo.');
  }
  const numero = BigInt(valor);
  if (numero > MAX_BIGINT_UNSIGNED) throw new Error('seq excede 64 bits.');
  return numero;
}

function normalizarCodigoError(valor) {
  const normalizado = String(valor || 'error_heartbeat_desconocido').toLowerCase()
    .replace(/[^a-z0-9_.-]/gu, '_').slice(0, 64);
  return /^[a-z][a-z0-9_.-]{0,63}$/u.test(normalizado)
    ? normalizado : 'error_heartbeat_desconocido';
}

function codigo(valor, campo) {
  if (typeof valor !== 'string' || !/^[a-z][a-z0-9_]{0,63}$/u.test(valor)) {
    throw new Error(`${campo} no es canónico.`);
  }
  return valor;
}

function entero(valor, minimo, maximo, campo) {
  if (!Number.isSafeInteger(valor) || valor < minimo || valor > maximo) {
    throw new Error(`${campo} está fuera de rango.`);
  }
  return valor;
}

function identidad(valor, tipo) {
  return String(crearIdentidadFederada({ tipo, valor: String(valor || '') }));
}

async function insertarHistoricoVinculacionEmisora(
  conexion,
  relacion,
  compatibilidad,
  eventoId,
  ahora
) {
  const [ordinal] = await conexion.execute(
    `SELECT COALESCE(MAX(ordinal),0)+1 AS ordinal
       FROM historico_estados_relaciones_federacion WHERE relacion_id=?`,
    [relacion.relacion_id]
  );
  await conexion.execute(
    `INSERT INTO historico_estados_relaciones_federacion (
      relacion_id,ordinal,cambio_tipo,estado_ciclo_anterior,estado_ciclo_nuevo,
      estado_autoridad_anterior,estado_autoridad_nuevo,
      estado_identidad_anterior,estado_identidad_nuevo,
      estado_compatibilidad_anterior,estado_compatibilidad_nuevo,
      version_autoridad,responsable_usuario_id,scope_tenant_id,
      scope_empresa_id,scope_sitio_id,efectivo_en_utc,registrado_en_utc,
      evento_auditoria_id,correlacion_id,detalle
    ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    [relacion.relacion_id, ordinal[0].ordinal, 'estadoCambiado',
      relacion.estado_ciclo, 'vinculada', relacion.estado_autoridad,
      relacion.estado_autoridad, relacion.estado_identidad,
      relacion.estado_identidad, relacion.estado_compatibilidad,
      compatibilidad, String(relacion.version_autoridad),
      relacion.responsable_usuario_id, relacion.scope_tenant_id,
      relacion.scope_empresa_id, relacion.scope_sitio_id, ahora, ahora,
      uuidV7AuditoriaABytes(eventoId), uuidV7AuditoriaABytes(eventoId),
      JSON.stringify({ causa: 'autenticacion_emisora_consolidada' })]
  );
}

function scopeRelacion(relacion) {
  return scope(relacion);
}

async function ahoraSql(conexion) {
  const [filas] = await conexion.execute(
    "SELECT DATE_FORMAT(UTC_TIMESTAMP(3), '%Y-%m-%d %H:%i:%s.%f') AS ahora"
  );
  return String(filas[0].ahora).slice(0, 23);
}

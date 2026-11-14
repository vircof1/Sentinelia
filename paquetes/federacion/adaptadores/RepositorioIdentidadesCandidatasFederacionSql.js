import {
  bytesAUuidV7Auditoria,
  uuidV7AuditoriaABytes
} from '../../auditoria/src/UuidV7Auditoria.js';

const ESTADOS_CANJEABLES = new Set([
  'pendienteVinculacion',
  'pendienteConfirmacionIdentidad'
]);

export class RepositorioIdentidadesCandidatasFederacionSql {
  constructor(clienteSql, { adaptadorAuditoria = null } = {}) {
    if (!clienteSql?.obtenerConexion) {
      throw new Error('Las candidaturas federadas requieren SQL operativo.');
    }
    this.clienteSql = clienteSql;
    this.adaptadorAuditoria = adaptadorAuditoria;
  }

  async registrarDesdeCanjeEnTransaccion(entrada = {}, { conexion } = {}) {
    validarCandidatura(entrada);
    if (!conexion?.execute) throw new Error('La candidatura exige conexión prestada.');
    const relacion = await bloquearRelacion(conexion, entrada.relacionId);
    exigirCanjeable(relacion);
    const ahora = entrada.efectivoEnUtc;
    const anterior = await bloquearCandidaturaPendiente(conexion, entrada.relacionId);
    if (anterior) {
      await conexion.execute(
        `UPDATE candidaturas_identidad_federacion
            SET estado='sustituida', relacion_pendiente_id=NULL,
                finalizada_en_utc=?
          WHERE solicitud_canje_id=? AND estado='pendiente'`,
        [ahora, anterior.solicitud_canje_id]
      );
    }
    const ordinal = anterior
      ? Number(anterior.ordinal) + 1
      : await siguienteOrdinalCandidatura(conexion, entrada.relacionId);
    await conexion.execute(
      `INSERT INTO candidaturas_identidad_federacion (
         solicitud_canje_id,relacion_id,ordinal,
         installation_remota_candidata_id,boot_remoto_candidato_id,
         nombre_remoto_declarado,protocolo_version,producto_version,estado,
         relacion_pendiente_id,registrada_en_utc,finalizada_en_utc,
         evento_canje_id,evento_confirmacion_id,correlacion_confirmacion_id,
         confirmada_por_usuario_id
       ) VALUES (?,?,?,?,?,?,?,?,'pendiente',?,?,NULL,?,NULL,NULL,NULL)`,
      [
        uuidV7AuditoriaABytes(entrada.solicitudCanjeId, 'solicitudCanjeId'),
        entrada.relacionId,
        ordinal,
        entrada.installationEmisoraId,
        entrada.bootEmisorId,
        entrada.nombreEmisorDeclarado,
        entrada.compatibilidad.protocoloVersion,
        entrada.compatibilidad.productoVersion,
        entrada.relacionId,
        ahora,
        uuidV7AuditoriaABytes(entrada.eventoId, 'eventoId')
      ]
    );
    const [actualizada] = await conexion.execute(
      `UPDATE relaciones_federacion
          SET estado_ciclo='pendienteConfirmacionIdentidad',
              installation_remota_candidata_id=?,
              installation_remota_id=NULL,
              nombre_remoto_declarado=?,
              estado_compatibilidad=NULL,
              revision=revision+1,
              actualizada_en_utc=?
        WHERE relacion_id=? AND revision=?`,
      [
        entrada.installationEmisoraId,
        entrada.nombreEmisorDeclarado,
        ahora,
        entrada.relacionId,
        relacion.revision
      ]
    );
    if (Number(actualizada.affectedRows) !== 1) throw conflictoConcurrente();
    await insertarHistorico(conexion, relacion, {
      tipo: 'identidadCandidata',
      estadoCiclo: 'pendienteConfirmacionIdentidad',
      eventoId: entrada.eventoId,
      correlacionId: entrada.solicitudCanjeId,
      ahora,
      detalle: {
        installationRemotaCandidataId: entrada.installationEmisoraId,
        bootRemotoCandidatoId: entrada.bootEmisorId,
        nombreRemotoDeclarado: entrada.nombreEmisorDeclarado,
        protocoloVersion: entrada.compatibilidad.protocoloVersion,
        productoVersion: entrada.compatibilidad.productoVersion,
        solicitudCanjeId: entrada.solicitudCanjeId
      }
    });
    return Object.freeze({
      identidadCandidataPersistida: true,
      ordinal
    });
  }

  async confirmar(entrada = {}) {
    validarConfirmacion(entrada);
    if (typeof this.adaptadorAuditoria?.registrarEnTransaccion !== 'function') {
      throw new Error('La confirmación de identidad exige auditoría transaccional.');
    }
    return this.#transaccion(async (conexion) => {
      const relacion = await bloquearRelacion(conexion, entrada.relacionId);
      const repetida = await buscarConfirmacionPorEvento(conexion, entrada.eventoId);
      if (repetida) {
        validarReplayConfirmacion(repetida, entrada);
        return Object.freeze({ estado: 'ya_confirmada', cambioEfectivo: false });
      }
      exigirConfirmable(relacion, entrada);
      await exigirAutoridadHumanaActual(conexion, relacion, entrada.actor.real.id);
      const candidatura = await bloquearCandidaturaPendiente(
        conexion,
        entrada.relacionId
      );
      if (!candidatura) throw new Error('La relación no tiene candidatura pendiente.');
      if (
        candidatura.installation_remota_candidata_id !==
          entrada.installationRemotaId ||
        candidatura.nombre_remoto_declarado !== entrada.nombreRemotoDeclarado
      ) {
        throw new Error('La confirmación no coincide con nombre e identidad mostrados.');
      }
      const ahora = await ahoraSql(conexion);
      const [candidaturaActualizada] = await conexion.execute(
        `UPDATE candidaturas_identidad_federacion
            SET estado='confirmada', relacion_pendiente_id=NULL,
                finalizada_en_utc=?, evento_confirmacion_id=?,
                correlacion_confirmacion_id=?, confirmada_por_usuario_id=?
          WHERE solicitud_canje_id=? AND estado='pendiente'`,
        [
          ahora,
          uuidV7AuditoriaABytes(entrada.eventoId, 'eventoId'),
          uuidV7AuditoriaABytes(entrada.correlacionId, 'correlacionId'),
          entrada.actor.real.id,
          candidatura.solicitud_canje_id
        ]
      );
      if (Number(candidaturaActualizada.affectedRows) !== 1) {
        throw conflictoConcurrente();
      }
      const [relacionActualizada] = await conexion.execute(
        `UPDATE relaciones_federacion
            SET estado_ciclo='pendienteAutenticacion',
                installation_remota_id=installation_remota_candidata_id,
                revision=revision+1,
                actualizada_en_utc=?
          WHERE relacion_id=? AND revision=?
            AND estado_ciclo='pendienteConfirmacionIdentidad'`,
        [ahora, entrada.relacionId, relacion.revision]
      );
      if (Number(relacionActualizada.affectedRows) !== 1) {
        throw conflictoConcurrente();
      }
      await insertarHistorico(conexion, relacion, {
        tipo: 'identidadConfirmada',
        estadoCiclo: 'pendienteAutenticacion',
        eventoId: entrada.eventoId,
        correlacionId: entrada.correlacionId,
        ahora,
        detalle: {
          installationRemotaId: entrada.installationRemotaId,
          nombreRemotoDeclarado: entrada.nombreRemotoDeclarado,
          confirmadaPorUsuarioId: entrada.actor.real.id
        }
      });
      const eventoAuditoria = await this.adaptadorAuditoria.registrarEnTransaccion({
        eventoId: entrada.eventoId,
        correlacionId: entrada.correlacionId,
        actor: entrada.actor,
        tipo: 'federacion.vinculacion_confirmada',
        relacionId: entrada.relacionId,
        revisionConcesionId: null,
        motivoCodigo: null,
        scope: scopeRelacion(relacion),
        efectivoEnUtc: ahora
      }, { conexion });
      return Object.freeze({
        estado: 'pendienteAutenticacion',
        cambioEfectivo: true,
        installationRemotaId: entrada.installationRemotaId,
        eventoAuditoria
      });
    });
  }

  async buscarPendienteSaneada(relacionId) {
    const filas = await this.clienteSql.consultar(
      `SELECT relacion_id,ordinal,installation_remota_candidata_id,
              boot_remoto_candidato_id,nombre_remoto_declarado,
              protocolo_version,producto_version,
              DATE_FORMAT(registrada_en_utc, '%Y-%m-%dT%H:%i:%s.%fZ')
                AS registrada_en_utc
         FROM candidaturas_identidad_federacion
        WHERE relacion_id=? AND estado='pendiente' LIMIT 1`,
      [relacionId]
    );
    return filas[0] ? sanearCandidatura(filas[0]) : null;
  }

  async #transaccion(operacion) {
    const conexion = await this.clienteSql.obtenerConexion();
    try {
      await conexion.beginTransaction();
      const resultado = await operacion(conexion);
      await conexion.commit();
      return resultado;
    } catch (error) {
      try { await conexion.rollback(); } catch { /* conserva la causa original */ }
      throw error;
    } finally {
      conexion.release();
    }
  }
}

export class ProvisionadorCanjePendienteFederacion {
  constructor({ persistidorVerificador, repositorioCandidaturas } = {}) {
    exigirMetodo(persistidorVerificador, 'registrarEnTransaccion', 'persistidorVerificador');
    exigirMetodo(
      repositorioCandidaturas,
      'registrarDesdeCanjeEnTransaccion',
      'repositorioCandidaturas'
    );
    this.persistidorVerificador = persistidorVerificador;
    this.repositorioCandidaturas = repositorioCandidaturas;
  }

  async registrarEnTransaccion(entrada, { conexion } = {}) {
    const credencial = await this.persistidorVerificador.registrarEnTransaccion(
      entrada,
      { conexion }
    );
    const identidad = await this.repositorioCandidaturas
      .registrarDesdeCanjeEnTransaccion(entrada, { conexion });
    return Object.freeze({ ...credencial, ...identidad });
  }
}

async function bloquearRelacion(conexion, relacionId) {
  const [filas] = await conexion.execute(
    'SELECT * FROM relaciones_federacion WHERE relacion_id=? FOR UPDATE',
    [relacionId]
  );
  if (!filas[0]) throw new Error('La relación federada no existe.');
  return filas[0];
}

async function bloquearCandidaturaPendiente(conexion, relacionId) {
  const [filas] = await conexion.execute(
    `SELECT * FROM candidaturas_identidad_federacion
      WHERE relacion_id=? AND estado='pendiente' FOR UPDATE`,
    [relacionId]
  );
  return filas[0] || null;
}

async function buscarConfirmacionPorEvento(conexion, eventoId) {
  const [filas] = await conexion.execute(
    `SELECT * FROM candidaturas_identidad_federacion
      WHERE evento_confirmacion_id=? LIMIT 1 FOR UPDATE`,
    [uuidV7AuditoriaABytes(eventoId, 'eventoId')]
  );
  return filas[0] || null;
}

async function siguienteOrdinalCandidatura(conexion, relacionId) {
  const [filas] = await conexion.execute(
    `SELECT COALESCE(MAX(ordinal),0)+1 AS ordinal
       FROM candidaturas_identidad_federacion WHERE relacion_id=?`,
    [relacionId]
  );
  return Number(filas[0].ordinal);
}

async function insertarHistorico(conexion, relacion, cambio) {
  const [filas] = await conexion.execute(
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
    [
      relacion.relacion_id,
      filas[0].ordinal,
      cambio.tipo,
      relacion.estado_ciclo,
      cambio.estadoCiclo,
      relacion.estado_autoridad,
      relacion.estado_autoridad,
      relacion.estado_identidad,
      relacion.estado_identidad,
      relacion.estado_compatibilidad,
      relacion.estado_compatibilidad,
      String(relacion.version_autoridad),
      relacion.responsable_usuario_id,
      relacion.scope_tenant_id,
      relacion.scope_empresa_id,
      relacion.scope_sitio_id,
      cambio.ahora,
      cambio.ahora,
      uuidV7AuditoriaABytes(cambio.eventoId, 'eventoId'),
      uuidV7AuditoriaABytes(cambio.correlacionId, 'correlacionId'),
      JSON.stringify(cambio.detalle)
    ]
  );
}

async function exigirAutoridadHumanaActual(conexion, relacion, usuarioId) {
  if (
    relacion.estado_autoridad !== 'autorizada' ||
    String(relacion.responsable_usuario_id) !== String(usuarioId)
  ) throw new Error('Solo el responsable actual puede confirmar la identidad.');
  const [filas] = await conexion.execute(
    `SELECT activo,tenant_id,empresa_id,sitio_id,
            permiso_configurar_emisiones_federacion,
            permiso_configurar_recepciones_federacion,
            permiso_gestionar_credenciales_federacion
       FROM usuarios WHERE id=? FOR UPDATE`,
    [usuarioId]
  );
  const usuario = filas[0];
  const permiso = relacion.direccion === 'emision'
    ? usuario?.permiso_configurar_emisiones_federacion
    : usuario?.permiso_configurar_recepciones_federacion;
  if (!usuario || !Boolean(usuario.activo) || !Boolean(permiso) ||
      !Boolean(usuario.permiso_gestionar_credenciales_federacion) ||
      !scopeUsuarioCubreRelacion(usuario, relacion)) {
    throw new Error('El responsable ya no conserva autoridad actual para confirmar.');
  }
}

function scopeUsuarioCubreRelacion(usuario, relacion) {
  const tenant = decimalNullable(usuario.tenant_id);
  const empresa = decimalNullable(usuario.empresa_id);
  const sitio = decimalNullable(usuario.sitio_id);
  if (tenant === null) return empresa === null && sitio === null;
  if (tenant !== decimalNullable(relacion.scope_tenant_id)) return false;
  if (empresa === null) return sitio === null;
  if (empresa !== decimalNullable(relacion.scope_empresa_id)) return false;
  return sitio === null || sitio === decimalNullable(relacion.scope_sitio_id);
}

function exigirCanjeable(relacion) {
  if (
    relacion.direccion !== 'recepcion' ||
    relacion.estado_autoridad !== 'autorizada' ||
    !ESTADOS_CANJEABLES.has(relacion.estado_ciclo)
  ) throw new Error('La relación receptora ya no admite una candidatura.');
}

function exigirConfirmable(relacion, entrada) {
  if (relacion.estado_ciclo !== 'pendienteConfirmacionIdentidad') {
    throw new Error('La relación no espera confirmación de identidad.');
  }
  if (
    relacion.installation_remota_candidata_id !== entrada.installationRemotaId ||
    relacion.nombre_remoto_declarado !== entrada.nombreRemotoDeclarado
  ) throw new Error('La relación cambió desde que se mostró la candidatura.');
}

function validarCandidatura(entrada) {
  exigirIdentidad(entrada.relacionId, 'relacion', 'relacionId');
  exigirIdentidad(entrada.installationEmisoraId, 'instalacion', 'installationEmisoraId');
  exigirIdentidad(entrada.bootEmisorId, 'arranque', 'bootEmisorId');
  if (!entrada.compatibilidad ||
      !Number.isSafeInteger(entrada.compatibilidad.protocoloVersion) ||
      entrada.compatibilidad.protocoloVersion < 1 ||
      entrada.compatibilidad.protocoloVersion > 0xffffffff ||
      typeof entrada.compatibilidad.productoVersion !== 'string' ||
      entrada.compatibilidad.productoVersion.length < 1 ||
      entrada.compatibilidad.productoVersion.length > 64 ||
      entrada.compatibilidad.productoVersion !==
        entrada.compatibilidad.productoVersion.trim()) {
    throw new Error('La compatibilidad candidata no es válida.');
  }
  if (
    typeof entrada.nombreEmisorDeclarado !== 'string' ||
    entrada.nombreEmisorDeclarado.length < 1 ||
    entrada.nombreEmisorDeclarado.length > 191 ||
    entrada.nombreEmisorDeclarado !== entrada.nombreEmisorDeclarado.trim() ||
    /[\u0000-\u001f\u007f]/u.test(entrada.nombreEmisorDeclarado) ||
    !entrada.efectivoEnUtc
  ) {
    throw new Error('La candidatura exige nombre y tiempo efectivo.');
  }
  uuidV7AuditoriaABytes(entrada.solicitudCanjeId, 'solicitudCanjeId');
  uuidV7AuditoriaABytes(entrada.eventoId, 'eventoId');
}

function validarConfirmacion(entrada) {
  exigirIdentidad(entrada.relacionId, 'relacion', 'relacionId');
  exigirIdentidad(entrada.installationRemotaId, 'instalacion', 'installationRemotaId');
  if (
    typeof entrada.nombreRemotoDeclarado !== 'string' ||
    entrada.nombreRemotoDeclarado !== entrada.nombreRemotoDeclarado.trim() ||
    entrada.nombreRemotoDeclarado.length < 1 ||
    entrada.nombreRemotoDeclarado.length > 191 ||
    /[\u0000-\u001f\u007f]/u.test(entrada.nombreRemotoDeclarado)
  ) throw new Error('nombreRemotoDeclarado no es válido.');
  uuidV7AuditoriaABytes(entrada.eventoId, 'eventoId');
  uuidV7AuditoriaABytes(entrada.correlacionId, 'correlacionId');
  if (
    entrada.actor?.modo !== 'directo' ||
    entrada.actor?.real?.tipo !== 'usuario' ||
    entrada.actor?.efectivo != null ||
    !/^[1-9][0-9]*$/u.test(String(entrada.actor.real.id || ''))
  ) throw new Error('La confirmación exige una sesión humana directa.');
}

function validarReplayConfirmacion(fila, entrada) {
  const coincide = fila.relacion_id === entrada.relacionId &&
    fila.installation_remota_candidata_id === entrada.installationRemotaId &&
    fila.nombre_remoto_declarado === entrada.nombreRemotoDeclarado &&
    String(fila.confirmada_por_usuario_id) === String(entrada.actor.real.id) &&
    bytesAUuidV7Auditoria(fila.correlacion_confirmacion_id) === entrada.correlacionId;
  if (!coincide) throw new Error('eventoId ya pertenece a otra confirmación.');
}

function sanearCandidatura(fila) {
  return Object.freeze({
    relacionId: fila.relacion_id,
    ordinal: Number(fila.ordinal),
    installationRemotaCandidataId: fila.installation_remota_candidata_id,
    bootRemotoCandidatoId: fila.boot_remoto_candidato_id,
    nombreRemotoDeclarado: fila.nombre_remoto_declarado,
    compatibilidadDeclarada: Object.freeze({
      protocoloVersion: Number(fila.protocolo_version),
      productoVersion: fila.producto_version
    }),
    registradaEnUtc: fila.registrada_en_utc
  });
}

function exigirIdentidad(valor, tipo, campo) {
  if (typeof valor !== 'string' ||
      !new RegExp(`^sfid1\\.${tipo}\\.[A-Za-z0-9_-]{21}[AQgw]$`, 'u').test(valor)) {
    throw new Error(`${campo} no es canónica.`);
  }
}

function scopeRelacion(relacion) {
  return Object.freeze({
    tenantId: decimalNullable(relacion.scope_tenant_id),
    empresaId: decimalNullable(relacion.scope_empresa_id),
    sitioId: decimalNullable(relacion.scope_sitio_id)
  });
}

function decimalNullable(valor) {
  return valor == null ? null : String(valor);
}

async function ahoraSql(conexion) {
  const [filas] = await conexion.execute(
    "SELECT DATE_FORMAT(UTC_TIMESTAMP(3), '%Y-%m-%d %H:%i:%s.%f') AS ahora"
  );
  return filas[0].ahora;
}

function conflictoConcurrente() {
  const error = new Error('La relación cambió concurrentemente.');
  error.code = 'FEDERACION_REVISION_CONFLICTO';
  return error;
}

function exigirMetodo(valor, metodo, campo) {
  if (typeof valor?.[metodo] !== 'function') {
    throw new Error(`${campo} debe implementar ${metodo}().`);
  }
}

import { isIP } from 'node:net';

import { canonicalizarJcsAuditoriaV1 }
  from '../../auditoria/src/PerfilJcsAuditoria.js';
import {
  bytesAUuidV7Auditoria,
  uuidV7AuditoriaABytes,
  validarUuidV7Auditoria
} from '../../auditoria/src/UuidV7Auditoria.js';
import { exigirBuzonCanonicoCorreo, VERSION_NORMALIZACION_BUZON_CORREO }
  from './NormalizadorBuzonCorreo.js';
import { CorreoPendiente } from './CorreoPendiente.js';
import {
  ORIGENES_SALIDA_CORREO,
  PROPOSITOS_SALIDA_CORREO_RECUPERACION_PASSWORD
} from './ContratoSalidaCorreo.js';
import { VERSION_PRODUCTOR_SQL_CORREO } from './RepositorioColaCorreo.js';

const ORIGEN = ORIGENES_SALIDA_CORREO.RECUPERACION_PASSWORD;
const PROPOSITO_TRANSPORTE =
  PROPOSITOS_SALIDA_CORREO_RECUPERACION_PASSWORD.TRANSPORTAR_SOLICITUD;
const PROPOSITO_SEGURIDAD =
  PROPOSITOS_SALIDA_CORREO_RECUPERACION_PASSWORD.NOTIFICAR_CAMBIO;

export class RepositorioCoordinacionCorreoRecuperacionPasswordSql {
  constructor(clienteSql, { repositorioAuditoria = null } = {}) {
    if (!clienteSql?.consultar) {
      throw new Error('La coordinación de correo de recuperación requiere SQL.');
    }
    if (repositorioAuditoria !== null &&
        typeof repositorioAuditoria?.incorporarEnTransaccion !== 'function') {
      throw new Error('El repositorio de auditoría transaccional no es válido.');
    }
    this.clienteSql = clienteSql;
    this.repositorioAuditoria = repositorioAuditoria;
  }

  async crearSalidaPreparadaEnTransaccion(entrada = {}, { conexion } = {}) {
    await exigirTransaccion(conexion);
    const intencion = validarSalida({
      ...entrada,
      proposito: PROPOSITO_TRANSPORTE,
      estado: 'preparada'
    });
    const existente = await buscarPorIdentidad(conexion, intencion);
    if (existente) {
      await exigirReplayCompatible(conexion, existente, intencion);
      return resultadoCreacion(existente, false);
    }

    try {
      const salidaId = await insertarSalida(conexion, intencion);
      await insertarProyeccion(conexion, salidaId, intencion.usuariosJustificantesIds);
      return resultadoCreacion(await bloquearSalida(conexion, salidaId), true);
    } catch (error) {
      if (error?.code !== 'ER_DUP_ENTRY') throw error;
      const concurrente = await buscarPorIdentidad(conexion, intencion);
      if (!concurrente) throw error;
      await exigirReplayCompatible(conexion, concurrente, intencion);
      return resultadoCreacion(concurrente, false);
    }
  }

  async completarSalidaPreparadaEnTransaccion({
    salidaId,
    solicitudId,
    eventoEmisionId,
    cuerpoTexto,
    intencionAuditoria
  } = {}, { conexion } = {}) {
    await exigirTransaccion(conexion);
    if (!this.repositorioAuditoria) {
      throw new Error('Liberar una emisión exige auditoría transaccional.');
    }
    const id = idDecimal(salidaId, 'salidaId');
    const solicitud = validarUuidV7Auditoria(solicitudId, 'solicitudId');
    const evento = validarUuidV7Auditoria(eventoEmisionId, 'eventoEmisionId');
    const cuerpo = textoCuerpo(cuerpoTexto);
    const fila = await bloquearSalida(conexion, id);
    exigirSalidaTransporte(fila, { solicitudId: solicitud, eventoEmisionId: evento });
    exigirIntencionAuditoriaEmision(intencionAuditoria, fila, {
      solicitudId: solicitud,
      eventoEmisionId: evento
    });

    if (fila.estado === 'preparada') {
      const [actualizacion] = await conexion.execute(
        `UPDATE cola_correos_salida
            SET estado='pendiente', cuerpo_texto=?,
                material_preparacion_recuperacion_password=NULL
          WHERE id=? AND origen_tipo=? AND estado='preparada'`,
        [cuerpo, id, ORIGEN]
      );
      exigirUnaFila(actualizacion, 'La preparación perdió su autoridad SQL.');
    } else if (fila.estado !== 'pendiente' || fila.cuerpo_texto !== cuerpo) {
      throw conflicto('La salida ya no admite completar esta preparación.');
    }

    const auditoria = await this.repositorioAuditoria.incorporarEnTransaccion(
      [intencionAuditoria],
      { conexion }
    );
    return Object.freeze({
      salida: new CorreoPendiente(await bloquearSalida(conexion, id)),
      auditoria
    });
  }

  async crearNotificacionSeguridadEnTransaccion(entrada = {}, { conexion } = {}) {
    await exigirTransaccion(conexion);
    const intencion = validarSalida({
      ...entrada,
      proposito: PROPOSITO_SEGURIDAD,
      estado: 'pendiente',
      eventoEmisionId: null,
      direccionIpOrigen: null,
      materialPreparacion: null
    });
    if (intencion.usuariosJustificantesIds.length !== 1) {
      throw new Error('La notificación de seguridad exige una sola identidad.');
    }
    const existente = await buscarPorIdentidad(conexion, intencion);
    if (existente) {
      await exigirReplayCompatible(conexion, existente, intencion);
      return resultadoCreacion(existente, false);
    }
    try {
      const salidaId = await insertarSalida(conexion, intencion);
      await insertarProyeccion(conexion, salidaId, intencion.usuariosJustificantesIds);
      return resultadoCreacion(await bloquearSalida(conexion, salidaId), true);
    } catch (error) {
      if (error?.code !== 'ER_DUP_ENTRY') throw error;
      const concurrente = await buscarPorIdentidad(conexion, intencion);
      if (!concurrente) throw error;
      await exigirReplayCompatible(conexion, concurrente, intencion);
      return resultadoCreacion(concurrente, false);
    }
  }

  async eliminarPreparacionHuerfanaEnTransaccion({ salidaId, solicitudId } = {}, {
    conexion
  } = {}) {
    await exigirTransaccion(conexion);
    const id = idDecimal(salidaId, 'salidaId');
    const solicitud = validarUuidV7Auditoria(solicitudId, 'solicitudId');
    const fila = await bloquearSalida(conexion, id);
    if (!fila) return Object.freeze({ eliminada: false, causa: 'ausente' });
    exigirSalidaTransporte(fila, { solicitudId: solicitud });
    if (fila.estado !== 'preparada') {
      return Object.freeze({ eliminada: false, causa: 'ya_liberada' });
    }
    const [resultado] = await conexion.execute(
      `DELETE FROM cola_correos_salida
        WHERE id=? AND origen_tipo=? AND estado='preparada'`,
      [id, ORIGEN]
    );
    exigirUnaFila(resultado, 'La preparación huérfana perdió su bloqueo SQL.');
    return Object.freeze({ eliminada: true, causa: 'preparacion_huerfana' });
  }

  async seleccionarSiguientePreparacionEnTransaccion({ conexion } = {}) {
    await exigirTransaccion(conexion);
    const [filas] = await conexion.execute(
      `SELECT * FROM cola_correos_salida
        WHERE origen_tipo=? AND estado='preparada'
        ORDER BY fecha_creacion ASC,id ASC
        LIMIT 1 FOR UPDATE SKIP LOCKED`,
      [ORIGEN]
    );
    const fila = filas[0] || null;
    if (!fila) return null;
    exigirSalidaTransporte(fila, {
      solicitudId: uuidDesdeFila(fila.solicitud_recuperacion_password_id),
      eventoEmisionId: uuidDesdeFila(
        fila.evento_emision_recuperacion_password_id
      )
    });
    let materialPreparacion;
    try {
      materialPreparacion = JSON.parse(
        String(fila.material_preparacion_recuperacion_password)
      );
    } catch {
      throw new Error('La preparación SQL contiene material privado inválido.');
    }
    return Object.freeze({
      salidaId: String(fila.id),
      solicitudId: uuidDesdeFila(fila.solicitud_recuperacion_password_id),
      eventoEmisionId: uuidDesdeFila(
        fila.evento_emision_recuperacion_password_id
      ),
      buzonCanonico: fila.destinatario_email,
      direccionIp: fila.direccion_ip_origen,
      asunto: fila.asunto,
      materialPreparacion
    });
  }

  async iniciarIntentoEnTransaccion({
    reclamacionId,
    salidaId,
    claimId,
    leaseToken,
    propietarioClaim,
    fencingToken,
    configuracionVersion,
    maxReintentos,
    margenMinimoLeaseMs
  } = {}, { conexion } = {}) {
    await exigirTransaccion(conexion);
    const identidad = validarClaim({
      reclamacionId,
      salidaId,
      claimId,
      leaseToken,
      propietarioClaim,
      fencingToken
    });
    const version = idDecimal(configuracionVersion, 'configuracionVersion');
    const reintentos = enteroEnRango(maxReintentos, 0, 1000, 'maxReintentos');
    const margenMs = enteroEnRango(
      margenMinimoLeaseMs, 0, 86_400_000, 'margenMinimoLeaseMs'
    );
    const fila = await bloquearSalida(conexion, identidad.salidaId);
    exigirClaimVigente(fila, identidad);
    if (fila.origen_tipo !== ORIGEN || fila.cuerpo_texto == null) {
      throw new Error('El claim no pertenece a una salida de recuperación liberada.');
    }

    const [justificantes] = await conexion.execute(
      `SELECT p.usuario_id,u.activo,u.email_validado,u.email
         FROM identidades_justificantes_correos_recuperacion_password p
         LEFT JOIN usuarios u ON u.id=p.usuario_id
        WHERE p.salida_correo_id=?
        ORDER BY p.usuario_id ASC
        FOR UPDATE`,
      [identidad.salidaId]
    );
    if (justificantes.length === 0) {
      throw new Error('La salida de recuperación perdió su proyección justificante.');
    }
    const conservaAutoridad = justificantes.some((actual) =>
      actual.email != null && Boolean(actual.activo) &&
      Boolean(actual.email_validado) && actual.email === fila.destinatario_email
    );
    if (!conservaAutoridad) {
      await cerrarClaimSinIntento(conexion, identidad, {
        estadoSalida: 'descartada',
        codigo: 'autoridad_buzon_retirada',
        causaDescarte: 'autoridad_buzon_retirada',
        respuesta: 'Ninguna identidad original conserva autoridad sobre el buzón.'
      });
      return Object.freeze({
        iniciado: false,
        estadoSalida: 'descartada',
        codigo: 'autoridad_buzon_retirada'
      });
    }
    if (Number(fila.intentos) >= 1 + reintentos) {
      await cerrarClaimSinIntento(conexion, identidad, {
        estadoSalida: 'error_final',
        codigo: 'smtp_reintentos_agotados',
        causaDescarte: null,
        respuesta: 'La política vigente no permite iniciar otro intento SMTP.'
      });
      return Object.freeze({
        iniciado: false,
        estadoSalida: 'error_final',
        codigo: 'smtp_reintentos_agotados'
      });
    }
    const [vigencia] = await conexion.execute(
      `SELECT lease_expira_utc > UTC_TIMESTAMP(3) AS vigente,
              TIMESTAMPDIFF(MICROSECOND,UTC_TIMESTAMP(3),lease_expira_utc)
                AS restante_microsegundos
         FROM cola_correos_salida WHERE id=?`,
      [identidad.salidaId]
    );
    if (!Boolean(vigencia[0]?.vigente) ||
        Number(vigencia[0]?.restante_microsegundos || 0) < margenMs * 1000) {
      throw new Error('La lease SQL no cubre el intento SMTP de recuperación.');
    }

    const numero = Number(fila.intentos) + 1;
    const [actualizada] = await conexion.execute(
      `UPDATE cola_correos_salida
          SET estado='enviando',intentos=?,enviando_en_utc=UTC_TIMESTAMP(3),
              fecha_ultimo_intento=UTC_TIMESTAMP(3),
              configuracion_version_ultimo_intento=?
        WHERE id=? AND origen_tipo=? AND estado='reclamada'
          AND claim_id=UNHEX(?) AND lease_token=UNHEX(?)
          AND propietario_claim=? AND fencing_token=?
          AND lease_expira_utc>UTC_TIMESTAMP(3)`,
      [numero, version, identidad.salidaId, ORIGEN, identidad.claimId,
        identidad.leaseToken, identidad.propietarioClaim, identidad.fencingToken]
    );
    exigirUnaFila(actualizada, 'El claim perdió autoridad antes de enviar.');
    const [intento] = await conexion.execute(
      `INSERT INTO intentos_correos_salida (
         salida_correo_id,reclamacion_correo_id,perfil_version,numero,
         configuracion_version,smtp_message_id,estado,iniciado_en_utc
       ) SELECT id,?,1,?,?,smtp_message_id,'en_curso',UTC_TIMESTAMP(3)
           FROM cola_correos_salida WHERE id=?`,
      [identidad.reclamacionId, numero, version, identidad.salidaId]
    );
    const [reclamacion] = await conexion.execute(
      `UPDATE reclamaciones_correos_salida
          SET estado='enviando',enviando_en_utc=UTC_TIMESTAMP(3)
        WHERE id=? AND salida_correo_id=? AND claim_id=UNHEX(?)
          AND fencing_token=? AND estado='reclamada'`,
      [identidad.reclamacionId, identidad.salidaId, identidad.claimId,
        identidad.fencingToken]
    );
    exigirUnaFila(reclamacion, 'La reclamación no pudo cruzar la frontera SMTP.');
    return Object.freeze({
      iniciado: true,
      salida: new CorreoPendiente(await bloquearSalida(conexion, identidad.salidaId)),
      intento: Object.freeze({
        intentoId: String(intento.insertId),
        salidaId: identidad.salidaId,
        numero,
        versionConfiguracion: version,
        estado: 'en_curso'
      })
    });
  }
}

async function cerrarClaimSinIntento(conexion, identidad, {
  estadoSalida,
  codigo,
  causaDescarte,
  respuesta
}) {
  const [salida] = await conexion.execute(
    `UPDATE cola_correos_salida
        SET estado=?,causa_descarte=?,codigo_resultado=?,respuesta_saneada=?,
            error_ultimo=CASE WHEN ?='error_final' THEN ? ELSE NULL END,
            proximo_intento_en=NULL,fecha_terminal_utc=UTC_TIMESTAMP(3),
            estado_previo_reclamacion=NULL,claim_id=NULL,propietario_claim=NULL,
            lease_token=NULL,lease_expira_utc=NULL,reclamada_en_utc=NULL,
            enviando_en_utc=NULL
      WHERE id=? AND estado='reclamada' AND claim_id=UNHEX(?)
        AND lease_token=UNHEX(?) AND propietario_claim=? AND fencing_token=?
        AND lease_expira_utc>UTC_TIMESTAMP(3)`,
    [estadoSalida, causaDescarte, codigo, respuesta, estadoSalida, respuesta,
      identidad.salidaId, identidad.claimId, identidad.leaseToken,
      identidad.propietarioClaim, identidad.fencingToken]
  );
  exigirUnaFila(salida, 'El claim perdió autoridad antes de su cierre.');
  const [reclamacion] = await conexion.execute(
    `UPDATE reclamaciones_correos_salida
        SET estado='finalizada',codigo_resultado=?,finalizada_en_utc=UTC_TIMESTAMP(3)
      WHERE id=? AND salida_correo_id=? AND claim_id=UNHEX(?)
        AND fencing_token=? AND estado='reclamada'`,
    [codigo, identidad.reclamacionId, identidad.salidaId, identidad.claimId,
      identidad.fencingToken]
  );
  exigirUnaFila(reclamacion, 'La reclamación no pudo consolidar su cierre.');
}

async function insertarSalida(conexion, intencion) {
  const preparada = intencion.estado === 'preparada';
  const [resultado] = await conexion.execute(
    `INSERT INTO cola_correos_salida (
       origen_tipo,productor_version,proposito_recuperacion_password,
       solicitud_recuperacion_password_id,
       evento_emision_recuperacion_password_id,
       clave_operacion_recuperacion_password_sha256,direccion_ip_origen,
       material_preparacion_recuperacion_password,
       destinatario_email,destinatario_nombre,normalizacion_buzon_version,
       clave_buzon_sha256,modo_remitente,remitente_email,remitente_nombre,
       asunto,cuerpo_texto,smtp_message_id,estado,intentos,
       proximo_intento_en,fecha_creacion
     ) VALUES (
       ?,?,?,?,?,UNHEX(?),?,?,?,NULL,?,UNHEX(?),
       'configuracion_actual',NULL,NULL,?,?,?, ?,0,NULL,?
     )`,
    [
      ORIGEN,
      VERSION_PRODUCTOR_SQL_CORREO,
      intencion.proposito,
      uuidV7AuditoriaABytes(intencion.solicitudId),
      intencion.eventoEmisionId
        ? uuidV7AuditoriaABytes(intencion.eventoEmisionId)
        : null,
      intencion.claveOperacionSha256,
      intencion.direccionIpOrigen,
      preparada ? intencion.materialPreparacionCanonico : null,
      intencion.buzonCanonico,
      VERSION_NORMALIZACION_BUZON_CORREO,
      intencion.claveBuzonSha256,
      intencion.asunto,
      preparada ? null : intencion.cuerpoTexto,
      intencion.smtpMessageId,
      intencion.estado,
      fechaSql(intencion.creadaEnUtc)
    ]
  );
  return String(resultado.insertId);
}

async function insertarProyeccion(conexion, salidaId, usuariosIds) {
  for (const usuarioId of usuariosIds) {
    await conexion.execute(
      `INSERT INTO identidades_justificantes_correos_recuperacion_password (
         salida_correo_id,usuario_id
       ) VALUES (?,?)`,
      [salidaId, usuarioId]
    );
  }
}

async function buscarPorIdentidad(conexion, intencion) {
  const [filas] = await conexion.execute(
    `SELECT * FROM cola_correos_salida
      WHERE clave_operacion_recuperacion_password_sha256=UNHEX(?)
         OR (solicitud_recuperacion_password_id=?
           AND proposito_recuperacion_password=?)
      ORDER BY id ASC FOR UPDATE`,
    [intencion.claveOperacionSha256,
      uuidV7AuditoriaABytes(intencion.solicitudId), intencion.proposito]
  );
  if (filas.length > 1) {
    throw conflicto('Las identidades idempotentes resuelven salidas distintas.');
  }
  return filas[0] || null;
}

async function bloquearSalida(conexion, salidaId) {
  const [filas] = await conexion.execute(
    'SELECT * FROM cola_correos_salida WHERE id=? FOR UPDATE',
    [salidaId]
  );
  return filas[0] || null;
}

async function exigirReplayCompatible(conexion, fila, intencion) {
  const camposCompatibles =
    fila.origen_tipo === ORIGEN &&
    fila.productor_version === VERSION_PRODUCTOR_SQL_CORREO &&
    fila.proposito_recuperacion_password === intencion.proposito &&
    uuidDesdeFila(fila.solicitud_recuperacion_password_id) === intencion.solicitudId &&
    uuidDesdeFila(fila.evento_emision_recuperacion_password_id) ===
      intencion.eventoEmisionId &&
    hashDesdeFila(fila.clave_operacion_recuperacion_password_sha256) ===
      intencion.claveOperacionSha256 &&
    fila.direccion_ip_origen === intencion.direccionIpOrigen &&
    fila.destinatario_email === intencion.buzonCanonico &&
    fila.normalizacion_buzon_version === VERSION_NORMALIZACION_BUZON_CORREO &&
    hashDesdeFila(fila.clave_buzon_sha256) === intencion.claveBuzonSha256 &&
    fila.asunto === intencion.asunto &&
    fila.smtp_message_id === intencion.smtpMessageId;
  if (!camposCompatibles) throw conflicto('La identidad idempotente ya posee otra intención.');
  if (fila.estado === 'preparada' &&
      String(fila.material_preparacion_recuperacion_password) !==
        intencion.materialPreparacionCanonico) {
    throw conflicto('La preparación repetida contiene otro material privado.');
  }
  if (intencion.estado === 'pendiente' && fila.cuerpo_texto !== intencion.cuerpoTexto) {
    throw conflicto('La salida repetida contiene otro cuerpo de correo.');
  }
  const [proyeccion] = await conexion.execute(
    `SELECT usuario_id FROM identidades_justificantes_correos_recuperacion_password
      WHERE salida_correo_id=? ORDER BY usuario_id ASC FOR UPDATE`,
    [String(fila.id)]
  );
  const ids = proyeccion.map(({ usuario_id: usuarioId }) => String(usuarioId));
  if (ids.join(',') !== intencion.usuariosJustificantesIds.join(',')) {
    throw conflicto('La salida repetida posee otra proyección justificante.');
  }
}

function validarSalida(entrada) {
  const proposito = entrada.proposito;
  if (![PROPOSITO_TRANSPORTE, PROPOSITO_SEGURIDAD].includes(proposito)) {
    throw new Error('El propósito de recuperación no es válido.');
  }
  const preparada = entrada.estado === 'preparada';
  if (!preparada && entrada.estado !== 'pendiente') {
    throw new Error('La salida de recuperación nace preparada o pendiente.');
  }
  if (preparada !== (proposito === PROPOSITO_TRANSPORTE)) {
    throw new Error('Solo el transporte inicial puede nacer preparado.');
  }
  const solicitudId = validarUuidV7Auditoria(entrada.solicitudId, 'solicitudId');
  const eventoEmisionId = entrada.eventoEmisionId === null
    ? null
    : validarUuidV7Auditoria(entrada.eventoEmisionId, 'eventoEmisionId');
  if (preparada !== (eventoEmisionId !== null)) {
    throw new Error('La preparación exige la identidad de su evento de emisión.');
  }
  const direccionIpOrigen = entrada.direccionIpOrigen === null
    ? null
    : String(entrada.direccionIpOrigen);
  if (preparada !== Boolean(direccionIpOrigen && isIP(direccionIpOrigen))) {
    throw new Error('La preparación exige una dirección IP canónica válida.');
  }
  const buzonCanonico = exigirBuzonCanonicoCorreo(entrada.buzonCanonico);
  const usuariosJustificantesIds = idsOrdenados(entrada.usuariosJustificantesIds);
  const materialPreparacionCanonico = preparada
    ? canonicalizarJcsAuditoriaV1(objetoPlano(entrada.materialPreparacion))
    : null;
  const cuerpoTexto = preparada ? null : textoCuerpo(entrada.cuerpoTexto);
  return Object.freeze({
    proposito,
    estado: entrada.estado,
    solicitudId,
    eventoEmisionId,
    claveOperacionSha256: hash(entrada.claveOperacionSha256, 'claveOperacionSha256'),
    direccionIpOrigen,
    materialPreparacionCanonico,
    buzonCanonico,
    claveBuzonSha256: hash(entrada.claveBuzonSha256, 'claveBuzonSha256'),
    smtpMessageId: messageId(entrada.smtpMessageId),
    asunto: asunto(entrada.asunto),
    cuerpoTexto,
    usuariosJustificantesIds,
    creadaEnUtc: fechaUtc(entrada.creadaEnUtc)
  });
}

function exigirSalidaTransporte(fila, { solicitudId, eventoEmisionId = null }) {
  if (!fila || fila.origen_tipo !== ORIGEN ||
      fila.proposito_recuperacion_password !== PROPOSITO_TRANSPORTE ||
      uuidDesdeFila(fila.solicitud_recuperacion_password_id) !== solicitudId ||
      (eventoEmisionId !== null &&
        uuidDesdeFila(fila.evento_emision_recuperacion_password_id) !== eventoEmisionId)) {
    throw conflicto('La salida no pertenece a la preparación indicada.');
  }
}

function exigirIntencionAuditoriaEmision(intencion, fila, {
  solicitudId,
  eventoEmisionId
}) {
  if (!intencion || intencion.eventoId !== eventoEmisionId ||
      intencion.tipo !== 'recuperacion_password.solicitud_emitida' ||
      intencion.correlacionId !== solicitudId ||
      intencion.productor !== 'recuperacion_password' ||
      intencion.flujo !== 'internet' ||
      intencion.sujeto?.tipo !== 'frontera_internet' ||
      intencion.payload?.buzonCanonico !== fila.destinatario_email ||
      intencion.payload?.direccionIp !== fila.direccion_ip_origen) {
    throw conflicto('La intención auditable no corresponde a la salida preparada.');
  }
}

function resultadoCreacion(fila, creada) {
  return Object.freeze({ salida: new CorreoPendiente(fila), creada });
}

function idsOrdenados(valores) {
  if (!Array.isArray(valores) || valores.length === 0) {
    throw new Error('La salida exige identidades justificantes.');
  }
  const ids = valores.map((valor) => idDecimal(valor, 'usuarioJustificanteId'));
  const unicos = [...new Set(ids)];
  if (unicos.length !== ids.length) throw new Error('La proyección repite identidades.');
  return unicos.sort((a, b) => BigInt(a) < BigInt(b) ? -1 : 1);
}

function objetoPlano(valor) {
  if (!valor || typeof valor !== 'object' || Array.isArray(valor) ||
      Object.getPrototypeOf(valor) !== Object.prototype) {
    throw new Error('El material de preparación debe ser un objeto JSON plano.');
  }
  return valor;
}

function idDecimal(valor, campo) {
  const texto = String(valor ?? '');
  if (!/^[1-9][0-9]*$/u.test(texto)) throw new Error(`${campo} no es un id válido.`);
  return texto;
}

function hash(valor, campo) {
  const texto = String(valor ?? '').toLowerCase();
  if (!/^[0-9a-f]{64}$/u.test(texto)) throw new Error(`${campo} no es SHA-256.`);
  return texto;
}

function asunto(valor) {
  const texto = String(valor ?? '');
  if (!texto || /[\r\n]/u.test(texto) || texto.length > 255) {
    throw new Error('El asunto no es una cabecera de correo válida.');
  }
  return texto;
}

function textoCuerpo(valor) {
  const texto = String(valor ?? '');
  if (!texto || Buffer.byteLength(texto, 'utf8') > 60 * 1024) {
    throw new Error('El cuerpo de correo está vacío o excede el contrato.');
  }
  return texto;
}

function messageId(valor) {
  const texto = String(valor ?? '');
  if (!/^<[^\s<>@]+@[^\s<>@]+>$/u.test(texto) || texto.length > 998) {
    throw new Error('smtpMessageId no es una identidad de mensaje válida.');
  }
  return texto;
}

function fechaUtc(valor) {
  const texto = String(valor ?? '');
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u.test(texto) ||
      Number.isNaN(Date.parse(texto))) {
    throw new Error('creadaEnUtc debe ser una fecha UTC canónica.');
  }
  return texto;
}

function fechaSql(valor) {
  return valor.slice(0, -1).replace('T', ' ');
}

function uuidDesdeFila(valor) {
  return valor == null ? null : bytesAUuidV7Auditoria(Buffer.from(valor));
}

function hashDesdeFila(valor) {
  return valor == null ? null : Buffer.from(valor).toString('hex');
}

function validarClaim({
  reclamacionId,
  salidaId,
  claimId,
  leaseToken,
  propietarioClaim,
  fencingToken
}) {
  const propietario = String(propietarioClaim ?? '');
  if (!/^[\x21-\x7e]{1,190}$/u.test(propietario)) {
    throw new Error('propietarioClaim no es una identidad ASCII válida.');
  }
  return Object.freeze({
    reclamacionId: idDecimal(reclamacionId, 'reclamacionId'),
    salidaId: idDecimal(salidaId, 'salidaId'),
    claimId: hash(claimId, 'claimId'),
    leaseToken: hash(leaseToken, 'leaseToken'),
    propietarioClaim: propietario,
    fencingToken: idDecimal(fencingToken, 'fencingToken')
  });
}

function exigirClaimVigente(fila, identidad) {
  if (!fila || fila.estado !== 'reclamada' ||
      hashDesdeFila(fila.claim_id) !== identidad.claimId ||
      hashDesdeFila(fila.lease_token) !== identidad.leaseToken ||
      fila.propietario_claim !== identidad.propietarioClaim ||
      String(fila.fencing_token) !== identidad.fencingToken) {
    throw new Error('La autoridad SQL del claim ya no está vigente.');
  }
}

function enteroEnRango(valor, minimo, maximo, campo) {
  const numero = Number(valor);
  if (!Number.isSafeInteger(numero) || numero < minimo || numero > maximo) {
    throw new Error(`${campo} está fuera de rango.`);
  }
  return numero;
}

async function exigirTransaccion(conexion) {
  if (!conexion?.execute || !conexion?.query) {
    throw new Error('La coordinación exige una conexión SQL prestada.');
  }
  const [filas] = await conexion.query('SELECT @@in_transaction AS activa');
  if (!Boolean(filas[0]?.activa)) {
    throw new Error('La coordinación exige una transacción SQL activa.');
  }
}

function exigirUnaFila(resultado, mensaje) {
  if (Number(resultado?.affectedRows || 0) !== 1) throw new Error(mensaje);
}

function conflicto(mensaje) {
  return Object.assign(new Error(mensaje), {
    codigo: 'conflicto_idempotencia_correo_recuperacion_password'
  });
}

import {
  bytesAUuidV7Auditoria,
  uuidV7AuditoriaABytes,
  validarUuidV7Auditoria
} from '../../auditoria/src/UuidV7Auditoria.js';
import { normalizarMarcaUtc }
  from '../../utilidades/src/fechas/normalizarMarcaUtc.js';
import {
  extraerPasswordProvisionalMensajeReinicioAdministrativo
} from './CodecMensajeReinicioPasswordAdministrativo.js';
import { CorreoPendiente } from './CorreoPendiente.js';
import {
  exigirBuzonCanonicoCorreo,
  normalizarNombrePresentacionCorreo,
  VERSION_NORMALIZACION_BUZON_CORREO
} from './NormalizadorBuzonCorreo.js';
import { ORIGENES_SALIDA_CORREO } from './ContratoSalidaCorreo.js';
import { VERSION_PRODUCTOR_SQL_CORREO } from './RepositorioColaCorreo.js';

const ORIGEN = ORIGENES_SALIDA_CORREO.REINICIO_PASSWORD_ADMINISTRATIVO;

export class ErrorConflictoCorreoReinicioPasswordAdministrativo extends Error {
  constructor(mensaje = 'El reinicio administrativo ya posee otra salida de correo.') {
    super(mensaje);
    this.name = 'ErrorConflictoCorreoReinicioPasswordAdministrativo';
    this.codigo = 'CONFLICTO_CORREO_REINICIO_PASSWORD_ADMINISTRATIVO';
  }
}

export class RepositorioCoordinacionCorreoReinicioPasswordAdministrativoSql {
  constructor(clienteSql) {
    if (typeof clienteSql?.consultar !== 'function') {
      throw new Error('La coordinación del correo administrativo requiere SQL.');
    }
    this.clienteSql = clienteSql;
  }

  async crearSalidaEnTransaccion(entrada = {}, { conexion } = {}) {
    await exigirTransaccion(conexion);
    const intencion = validarSalida(entrada);
    const operacion = await bloquearOperacion(conexion, intencion.reinicioId);
    exigirOperacionCorreo(operacion, { permitirReservada: true });

    let existente = await buscarSalidaPorReinicio(conexion, intencion.reinicioId);
    if (existente) {
      exigirReplayCompatible(existente, intencion);
      exigirEnlaceCompatible(operacion, existente.id);
      return resultadoCreacion(existente, false);
    }
    if (operacion.estado !== 'reservado') {
      throw conflicto('El reinicio confirmado perdió su salida de correo retenida.');
    }

    try {
      const [resultado] = await conexion.execute(
        `INSERT INTO cola_correos_salida (
           origen_tipo,productor_version,reinicio_password_administrativo_id,
           destinatario_email,destinatario_nombre,normalizacion_buzon_version,
           clave_buzon_sha256,modo_remitente,remitente_email,remitente_nombre,
           asunto,cuerpo_texto,smtp_message_id,estado,intentos,
           proximo_intento_en,creado_por_usuario_id,fecha_creacion
         ) VALUES (
           ?,?,?, ?,?,?,UNHEX(?),'configuracion_actual',NULL,NULL,
           ?,?,?,'pendiente',0,NULL,?,?
         )`,
        [
          ORIGEN,
          VERSION_PRODUCTOR_SQL_CORREO,
          uuidV7AuditoriaABytes(intencion.reinicioId),
          intencion.buzonCanonico,
          intencion.destinatarioNombre,
          VERSION_NORMALIZACION_BUZON_CORREO,
          intencion.claveBuzonSha256,
          intencion.asunto,
          intencion.cuerpoTexto,
          intencion.smtpMessageId,
          intencion.creadoPorUsuarioId,
          fechaSql(intencion.creadaEnUtc)
        ]
      );
      existente = await bloquearSalida(conexion, String(resultado.insertId));
      return resultadoCreacion(existente, true);
    } catch (error) {
      if (error?.code !== 'ER_DUP_ENTRY') throw error;
      existente = await buscarSalidaPorReinicio(conexion, intencion.reinicioId);
      if (!existente) throw error;
      exigirReplayCompatible(existente, intencion);
      return resultadoCreacion(existente, false);
    }
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
    const version = decimalPositivo(configuracionVersion, 'configuracionVersion');
    const reintentos = enteroEnRango(maxReintentos, 0, 1000, 'maxReintentos');
    const margenMs = enteroEnRango(
      margenMinimoLeaseMs, 0, 86_400_000, 'margenMinimoLeaseMs'
    );

    const referencia = await leerIdentidadSalida(conexion, identidad.salidaId);
    const reinicioId = uuidDesdeFila(referencia?.reinicio_password_administrativo_id);
    if (!reinicioId) {
      throw new Error('La salida reclamada no posee identidad administrativa.');
    }
    const operacion = await bloquearOperacion(conexion, reinicioId);
    exigirOperacionCorreo(operacion, { permitirReservada: false });
    const fila = await bloquearSalida(conexion, identidad.salidaId);
    exigirClaimVigente(fila, identidad);
    exigirContratoAdministrativo(fila, reinicioId);
    exigirEnlaceCompatible(operacion, identidad.salidaId);

    const passwordProvisional =
      extraerPasswordProvisionalMensajeReinicioAdministrativo({
        asunto: fila.asunto,
        cuerpoTexto: fila.cuerpo_texto
      });
    if (Number(fila.intentos) >= 1 + reintentos) {
      await cerrarSinNuevoIntento(conexion, identidad, {
        codigo: 'smtp_reintentos_agotados',
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
      throw new Error('La lease SQL no cubre el intento SMTP administrativo.');
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
      }),
      passwordProvisional
    });
  }
}

async function bloquearOperacion(conexion, reinicioId) {
  const [filas] = await conexion.execute(
    `SELECT reinicio_id,via,estado,salida_correo_id
       FROM reinicios_password_administrativos
      WHERE reinicio_id=? LIMIT 1 FOR UPDATE`,
    [uuidV7AuditoriaABytes(reinicioId)]
  );
  return filas[0] || null;
}

async function leerIdentidadSalida(conexion, salidaId) {
  const [filas] = await conexion.execute(
    `SELECT reinicio_password_administrativo_id
       FROM cola_correos_salida WHERE id=? LIMIT 1`,
    [salidaId]
  );
  return filas[0] || null;
}

async function buscarSalidaPorReinicio(conexion, reinicioId) {
  const [filas] = await conexion.execute(
    `SELECT * FROM cola_correos_salida
      WHERE reinicio_password_administrativo_id=? LIMIT 1 FOR UPDATE`,
    [uuidV7AuditoriaABytes(reinicioId)]
  );
  return filas[0] || null;
}

async function bloquearSalida(conexion, salidaId) {
  const [filas] = await conexion.execute(
    'SELECT * FROM cola_correos_salida WHERE id=? FOR UPDATE',
    [salidaId]
  );
  return filas[0] || null;
}

function exigirOperacionCorreo(fila, { permitirReservada }) {
  if (!fila || fila.via !== 'correo' ||
      !['reservado', 'confirmado'].includes(fila.estado) ||
      (!permitirReservada && fila.estado !== 'confirmado')) {
    throw conflicto('La identidad no pertenece a un reinicio por correo utilizable.');
  }
}

function exigirEnlaceCompatible(operacion, salidaId) {
  if (operacion.salida_correo_id !== null &&
      String(operacion.salida_correo_id) !== String(salidaId)) {
    throw conflicto('El reinicio administrativo ya referencia otra salida.');
  }
}

function exigirReplayCompatible(fila, intencion) {
  const compatible =
    fila.origen_tipo === ORIGEN &&
    fila.productor_version === VERSION_PRODUCTOR_SQL_CORREO &&
    uuidDesdeFila(fila.reinicio_password_administrativo_id) === intencion.reinicioId &&
    fila.destinatario_email === intencion.buzonCanonico &&
    (fila.destinatario_nombre ?? null) === intencion.destinatarioNombre &&
    fila.normalizacion_buzon_version === VERSION_NORMALIZACION_BUZON_CORREO &&
    hashDesdeFila(fila.clave_buzon_sha256) === intencion.claveBuzonSha256 &&
    fila.modo_remitente === 'configuracion_actual' &&
    fila.remitente_email === null && fila.remitente_nombre === null &&
    fila.asunto === intencion.asunto && fila.cuerpo_texto === intencion.cuerpoTexto &&
    fila.smtp_message_id === intencion.smtpMessageId &&
    (fila.creado_por_usuario_id === null ||
      String(fila.creado_por_usuario_id) === intencion.creadoPorUsuarioId) &&
    normalizarMarcaUtc(fila.fecha_creacion) === intencion.creadaEnUtc;
  if (!compatible) throw conflicto('El reinicio administrativo ya posee otra intención.');
}

function validarSalida(entrada) {
  const reinicioId = validarUuidV7Auditoria(entrada.reinicioId, 'reinicioId');
  const buzonCanonico = exigirBuzonCanonicoCorreo(entrada.buzonCanonico);
  const destinatarioNombre = entrada.destinatarioNombre == null
    ? null
    : normalizarNombrePresentacionCorreo(entrada.destinatarioNombre) || null;
  const mensaje = {
    asunto: asunto(entrada.asunto),
    cuerpoTexto: textoCuerpo(entrada.cuerpoTexto)
  };
  extraerPasswordProvisionalMensajeReinicioAdministrativo(mensaje);
  return Object.freeze({
    reinicioId,
    buzonCanonico,
    destinatarioNombre,
    claveBuzonSha256: hash(entrada.claveBuzonSha256, 'claveBuzonSha256'),
    smtpMessageId: messageId(entrada.smtpMessageId),
    ...mensaje,
    creadoPorUsuarioId: decimalPositivo(
      entrada.creadoPorUsuarioId,
      'creadoPorUsuarioId'
    ),
    creadaEnUtc: fechaUtc(entrada.creadaEnUtc)
  });
}

function exigirContratoAdministrativo(fila, reinicioId) {
  if (!fila || fila.origen_tipo !== ORIGEN ||
      fila.productor_version !== VERSION_PRODUCTOR_SQL_CORREO ||
      uuidDesdeFila(fila.reinicio_password_administrativo_id) !== reinicioId ||
      fila.proposito_recuperacion_password !== null ||
      fila.solicitud_recuperacion_password_id !== null ||
      fila.notificacion_trigger_correo_id !== null ||
      fila.ejecucion_trigger_id !== null ||
      fila.normalizacion_buzon_version !== VERSION_NORMALIZACION_BUZON_CORREO ||
      fila.modo_remitente !== 'configuracion_actual') {
    throw new Error('El claim no pertenece a una salida administrativa válida.');
  }
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
    reclamacionId: decimalPositivo(reclamacionId, 'reclamacionId'),
    salidaId: decimalPositivo(salidaId, 'salidaId'),
    claimId: hash(claimId, 'claimId'),
    leaseToken: hash(leaseToken, 'leaseToken'),
    propietarioClaim: propietario,
    fencingToken: decimalPositivo(fencingToken, 'fencingToken')
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

async function cerrarSinNuevoIntento(conexion, identidad, { codigo, respuesta }) {
  const [salida] = await conexion.execute(
    `UPDATE cola_correos_salida
        SET estado='error_final',error_ultimo=?,codigo_resultado=?,
            respuesta_saneada=?,proximo_intento_en=NULL,
            fecha_terminal_utc=UTC_TIMESTAMP(3),estado_previo_reclamacion=NULL,
            claim_id=NULL,propietario_claim=NULL,lease_token=NULL,
            lease_expira_utc=NULL,reclamada_en_utc=NULL
      WHERE id=? AND origen_tipo=? AND estado='reclamada'
        AND claim_id=UNHEX(?) AND lease_token=UNHEX(?)
        AND propietario_claim=? AND fencing_token=?
        AND lease_expira_utc>UTC_TIMESTAMP(3)`,
    [respuesta, codigo, respuesta, identidad.salidaId, ORIGEN, identidad.claimId,
      identidad.leaseToken, identidad.propietarioClaim, identidad.fencingToken]
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

function resultadoCreacion(fila, creada) {
  return Object.freeze({ salida: new CorreoPendiente(fila), creada });
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

function hash(valor, campo) {
  const texto = String(valor ?? '').toLowerCase();
  if (!/^[0-9a-f]{64}$/u.test(texto)) throw new Error(`${campo} no es SHA-256.`);
  return texto;
}

function hashDesdeFila(valor) {
  return valor == null ? null : Buffer.from(valor).toString('hex');
}

function uuidDesdeFila(valor) {
  return valor == null
    ? null
    : bytesAUuidV7Auditoria(Buffer.from(valor), 'reinicioId');
}

function decimalPositivo(valor, campo) {
  const texto = String(valor ?? '');
  if (!/^[1-9][0-9]*$/u.test(texto)) throw new Error(`${campo} no es un id válido.`);
  return texto;
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
  return new ErrorConflictoCorreoReinicioPasswordAdministrativo(mensaje);
}

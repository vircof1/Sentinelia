import { createHash } from 'node:crypto';

import { uuidV7AuditoriaABytes, validarUuidV7Auditoria }
  from '../../auditoria/src/UuidV7Auditoria.js';
import { normalizarMarcaUtc }
  from '../../utilidades/src/fechas/normalizarMarcaUtc.js';
import {
  CLASES_EMISION_VERIFICACION_EMAIL_PERFIL,
  crearEmisionVerificacionEmailPerfil
} from '../../usuarios/src/ContratoVerificacionEmailPerfil.js';
import { CorreoPendiente } from './CorreoPendiente.js';
import { ORIGENES_SALIDA_CORREO } from './ContratoSalidaCorreo.js';
import { validarCausaDescarteSalidaCorreo } from './ContratoSalidaCorreo.js';
import {
  normalizarNombrePresentacionCorreo,
  VERSION_NORMALIZACION_BUZON_CORREO
} from './NormalizadorBuzonCorreo.js';
import { VERSION_PRODUCTOR_SQL_CORREO } from './RepositorioColaCorreo.js';

const ORIGEN = ORIGENES_SALIDA_CORREO.VERIFICACION_EMAIL_PERFIL;
const CLASES_EMISION = new Set(
  Object.values(CLASES_EMISION_VERIFICACION_EMAIL_PERFIL)
);

export class ErrorConflictoCorreoVerificacionEmailPerfil extends Error {
  constructor(mensaje = 'La emisión de verificación ya posee otra salida.') {
    super(mensaje);
    this.name = 'ErrorConflictoCorreoVerificacionEmailPerfil';
    this.codigo = 'CONFLICTO_CORREO_VERIFICACION_EMAIL_PERFIL';
  }
}

export class RepositorioCoordinacionCorreoVerificacionEmailPerfilSql {
  constructor(clienteSql) {
    if (typeof clienteSql?.consultar !== 'function') {
      throw new Error('La coordinación de verificación de email requiere SQL.');
    }
    this.clienteSql = clienteSql;
  }

  async crearSalidaPreparadaEnTransaccion(entrada = {}, { conexion } = {}) {
    await exigirTransaccion(conexion);
    const intencion = validarSalida(entrada);
    const filasOperacion = await bloquearSalidasOperacion(
      conexion,
      intencion.emision.operacionEmailPerfilId
    );
    const existente = filasOperacion.find((fila) =>
      uuidV7DesdeFila(fila.emision_email_perfil_id) ===
        intencion.emision.emisionEmailPerfilId
    );
    if (existente) {
      exigirReplayCompatible(existente, intencion);
      return resultadoCreacion(existente, false);
    }
    if (intencion.emision.clase === CLASES_EMISION_VERIFICACION_EMAIL_PERFIL.INICIAL &&
        filasOperacion.some((fila) =>
          fila.clase_emision_email_perfil ===
            CLASES_EMISION_VERIFICACION_EMAIL_PERFIL.INICIAL)) {
      throw conflicto('La operación ya posee una salida inicial distinta.');
    }

    try {
      const [resultado] = await conexion.execute(
        `INSERT INTO cola_correos_salida (
           origen_tipo,productor_version,operacion_email_perfil_id,
           emision_email_perfil_id,clase_emision_email_perfil,
           destinatario_email,destinatario_nombre,normalizacion_buzon_version,
           clave_buzon_sha256,modo_remitente,remitente_email,remitente_nombre,
           asunto,cuerpo_texto,smtp_message_id,estado,intentos,
           proximo_intento_en,creado_por_usuario_id,fecha_creacion
         ) VALUES (
           ?,?,?,?,?, ?,?,?,UNHEX(?),'configuracion_actual',NULL,NULL,
           ?,?,?,'preparada',0,NULL,?,?
         )`,
        [
          ORIGEN,
          VERSION_PRODUCTOR_SQL_CORREO,
          uuidCanonicoABytes(intencion.emision.operacionEmailPerfilId),
          uuidV7AuditoriaABytes(intencion.emision.emisionEmailPerfilId),
          intencion.emision.clase,
          intencion.emision.emailCandidato,
          intencion.destinatarioNombre,
          VERSION_NORMALIZACION_BUZON_CORREO,
          sha256(intencion.emision.emailCandidato),
          intencion.asunto,
          intencion.cuerpoTexto,
          intencion.smtpMessageId,
          intencion.emision.usuarioId,
          fechaSql(intencion.creadaEnUtc)
        ]
      );
      const fila = await bloquearSalida(conexion, String(resultado.insertId));
      return resultadoCreacion(fila, true);
    } catch (error) {
      if (error?.code !== 'ER_DUP_ENTRY') throw error;
      const colision = await buscarFilaPorEmision(
        conexion,
        intencion.emision.emisionEmailPerfilId,
        { bloquear: true }
      );
      if (!colision) throw error;
      exigirReplayCompatible(colision, intencion);
      return resultadoCreacion(colision, false);
    }
  }

  async buscarPorEmisionId(emisionEmailPerfilId, { conexion = null } = {}) {
    const emisionId = validarUuidV7Auditoria(
      emisionEmailPerfilId,
      'emisionEmailPerfilId'
    );
    const fila = await buscarFilaPorEmision(conexion || this.clienteSql, emisionId);
    return fila ? new CorreoPendiente(fila) : null;
  }

  async liberarSalidaPreparadaEnTransaccion({
    salidaId,
    operacionEmailPerfilId,
    emisionEmailPerfilId,
    claseEmision = CLASES_EMISION_VERIFICACION_EMAIL_PERFIL.INICIAL
  } = {}, { conexion } = {}) {
    await exigirTransaccion(conexion);
    const id = decimalPositivo(salidaId, 'salidaId');
    const operacionId = uuidCanonico(
      operacionEmailPerfilId,
      'operacionEmailPerfilId'
    );
    const emisionId = validarUuidV7Auditoria(
      emisionEmailPerfilId,
      'emisionEmailPerfilId'
    );
    if (!CLASES_EMISION.has(claseEmision)) {
      throw new Error('La clase de emisión no pertenece al contrato.');
    }
    let fila = await bloquearSalida(conexion, id);
    exigirIdentidadSalida(fila, { operacionId, emisionId, claseEmision });
    if (fila.estado === 'preparada') {
      const [resultado] = await conexion.execute(
        `UPDATE cola_correos_salida
            SET estado='pendiente',proximo_intento_en=UTC_TIMESTAMP(3)
          WHERE id=? AND origen_tipo=? AND estado='preparada'`,
        [id, ORIGEN]
      );
      if (Number(resultado?.affectedRows || 0) !== 1) {
        throw new Error('La preparación perdió su autoridad SQL.');
      }
      fila = await bloquearSalida(conexion, id);
    } else if (fila.estado !== 'pendiente') {
      throw conflicto('La salida ya no admite ser liberada.');
    }
    return Object.freeze({ salida: new CorreoPendiente(fila) });
  }

  async eliminarPreparacionPorEmisionEnTransaccion({
    emisionEmailPerfilId
  } = {}, { conexion } = {}) {
    await exigirTransaccion(conexion);
    const emisionId = validarUuidV7Auditoria(
      emisionEmailPerfilId,
      'emisionEmailPerfilId'
    );
    const fila = await buscarFilaPorEmision(conexion, emisionId, { bloquear: true });
    if (!fila) return Object.freeze({ eliminada: false, causa: 'ausente' });
    if (fila.estado !== 'preparada') {
      return Object.freeze({ eliminada: false, causa: 'ya_liberada' });
    }
    const [resultado] = await conexion.execute(
      `DELETE FROM cola_correos_salida
        WHERE id=? AND origen_tipo=? AND estado='preparada'`,
      [fila.id, ORIGEN]
    );
    if (Number(resultado?.affectedRows || 0) !== 1) {
      throw new Error('La preparación huérfana perdió su bloqueo SQL.');
    }
    return Object.freeze({ eliminada: true, causa: 'preparacion_huerfana' });
  }

  async listarReferenciasPorOperacionId(
    operacionEmailPerfilId,
    { conexion = null } = {}
  ) {
    const operacionId = uuidCanonico(operacionEmailPerfilId, 'operacionEmailPerfilId');
    const filas = await consultar(conexion || this.clienteSql,
      `SELECT id,operacion_email_perfil_id,emision_email_perfil_id,
              clase_emision_email_perfil,creado_por_usuario_id,
              destinatario_email,estado,fecha_creacion
         FROM cola_correos_salida
        WHERE origen_tipo=? AND operacion_email_perfil_id=?
        ORDER BY id ASC`,
      [ORIGEN, uuidCanonicoABytes(operacionId)]
    );
    return Object.freeze(filas.map(proyectarReferencia));
  }

  async leerReferenciaParaRevalidacionPorSalidaId(
    salidaId,
    { conexion = null, bloquear = false } = {}
  ) {
    const id = decimalPositivo(salidaId, 'salidaId');
    if (bloquear && !conexion) {
      throw new Error('Bloquear una referencia exige una conexión prestada.');
    }
    const filas = await consultar(conexion || this.clienteSql,
      `SELECT id,operacion_email_perfil_id,emision_email_perfil_id,
              clase_emision_email_perfil,creado_por_usuario_id,
              destinatario_email,estado,fecha_creacion
         FROM cola_correos_salida
        WHERE id=? AND origen_tipo=? LIMIT 1${bloquear ? ' FOR UPDATE' : ''}`,
      [id, ORIGEN]
    );
    return filas[0] ? proyectarReferencia(filas[0]) : null;
  }

  async descartarReclamacionEnTransaccion({
    reclamacionId,
    salidaId,
    claimId,
    leaseToken,
    propietarioClaim,
    fencingToken,
    causa
  } = {}, { conexion } = {}) {
    await exigirTransaccion(conexion);
    const identidad = validarClaim({
      reclamacionId, salidaId, claimId, leaseToken,
      propietarioClaim, fencingToken
    });
    const causaTipada = validarCausaDescarteSalidaCorreo(causa);
    const [resultado] = await conexion.execute(
      `UPDATE cola_correos_salida
          SET estado='descartada',causa_descarte=?,codigo_resultado=?,
              proximo_intento_en=NULL,fecha_terminal_utc=UTC_TIMESTAMP(3),
              estado_previo_reclamacion=NULL,claim_id=NULL,
              propietario_claim=NULL,lease_token=NULL,
              lease_expira_utc=NULL,reclamada_en_utc=NULL
        WHERE id=? AND origen_tipo=? AND estado='reclamada'
          AND claim_id=UNHEX(?) AND lease_token=UNHEX(?)
          AND propietario_claim=? AND fencing_token=?
          AND lease_expira_utc>UTC_TIMESTAMP(3)`,
      [causaTipada, causaTipada, identidad.salidaId, ORIGEN,
        identidad.claimId, identidad.leaseToken, identidad.propietarioClaim,
        identidad.fencingToken]
    );
    exigirUnaFila(resultado, 'La reclamación perdió autoridad al descartarse.');
    await finalizarReclamacion(conexion, identidad, {
      estado: 'finalizada', codigo: causaTipada
    });
    return Object.freeze({
      iniciado: false,
      estadoSalida: 'descartada',
      codigo: causaTipada
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
      reclamacionId, salidaId, claimId, leaseToken,
      propietarioClaim, fencingToken
    });
    const version = decimalPositivo(configuracionVersion, 'configuracionVersion');
    const reintentos = enteroEnRango(maxReintentos, 0, 1000, 'maxReintentos');
    const margenMs = enteroEnRango(
      margenMinimoLeaseMs, 0, 86_400_000, 'margenMinimoLeaseMs'
    );
    const fila = await bloquearSalida(conexion, identidad.salidaId);
    exigirClaimVigente(fila, identidad);
    exigirIdentidadSalida(fila, {
      operacionId: uuidDesdeFila(fila.operacion_email_perfil_id),
      emisionId: uuidV7DesdeFila(fila.emision_email_perfil_id),
      claseEmision: fila.clase_emision_email_perfil
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
      throw new Error('La lease SQL no cubre el intento SMTP de verificación.');
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

  async descartarSalidaReintentableEnTransaccion({
    salidaId,
    causa
  } = {}, { conexion } = {}) {
    await exigirTransaccion(conexion);
    const id = decimalPositivo(salidaId, 'salidaId');
    const causaTipada = validarCausaDescarteSalidaCorreo(causa);
    const [resultado] = await conexion.execute(
      `UPDATE cola_correos_salida
          SET estado='descartada',causa_descarte=?,codigo_resultado=?,
              proximo_intento_en=NULL,fecha_terminal_utc=UTC_TIMESTAMP(3)
        WHERE id=? AND origen_tipo=? AND estado='error_reintentable'`,
      [causaTipada, causaTipada, id, ORIGEN]
    );
    exigirUnaFila(resultado, 'La salida reintentable no pudo descartarse.');
    return Object.freeze({ estadoSalida: 'descartada', codigo: causaTipada });
  }
}

function validarSalida(entrada) {
  const emision = crearEmisionVerificacionEmailPerfil(entrada.emision);
  const destinatarioNombre = entrada.destinatarioNombre == null
    ? null
    : normalizarNombrePresentacionCorreo(entrada.destinatarioNombre) || null;
  return Object.freeze({
    emision,
    destinatarioNombre,
    asunto: asunto(entrada.asunto),
    cuerpoTexto: cuerpo(entrada.cuerpoTexto),
    smtpMessageId: messageId(entrada.smtpMessageId),
    creadaEnUtc: fechaUtc(entrada.creadaEnUtc)
  });
}

async function bloquearSalidasOperacion(conexion, operacionId) {
  const [filas] = await conexion.execute(
    `SELECT * FROM cola_correos_salida
      WHERE origen_tipo=? AND operacion_email_perfil_id=?
      ORDER BY clase_emision_email_perfil ASC,id ASC FOR UPDATE`,
    [ORIGEN, uuidCanonicoABytes(operacionId)]
  );
  return filas;
}

async function buscarFilaPorEmision(origenConsulta, emisionId, { bloquear = false } = {}) {
  const filas = await consultar(origenConsulta,
    `SELECT * FROM cola_correos_salida
      WHERE origen_tipo=? AND emision_email_perfil_id=?
      LIMIT 1${bloquear ? ' FOR UPDATE' : ''}`,
    [ORIGEN, uuidV7AuditoriaABytes(emisionId)]
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

async function consultar(origen, sentencia, parametros) {
  if (typeof origen?.consultar === 'function') {
    return origen.consultar(sentencia, parametros);
  }
  const [filas] = await origen.execute(sentencia, parametros);
  return filas;
}

function exigirReplayCompatible(fila, intencion) {
  const compatible = fila.origen_tipo === ORIGEN &&
    fila.productor_version === VERSION_PRODUCTOR_SQL_CORREO &&
    uuidDesdeFila(fila.operacion_email_perfil_id) ===
      intencion.emision.operacionEmailPerfilId &&
    uuidV7DesdeFila(fila.emision_email_perfil_id) ===
      intencion.emision.emisionEmailPerfilId &&
    fila.clase_emision_email_perfil === intencion.emision.clase &&
    String(fila.creado_por_usuario_id) === intencion.emision.usuarioId &&
    fila.destinatario_email === intencion.emision.emailCandidato &&
    (fila.destinatario_nombre ?? null) === intencion.destinatarioNombre &&
    fila.normalizacion_buzon_version === VERSION_NORMALIZACION_BUZON_CORREO &&
    hashDesdeFila(fila.clave_buzon_sha256) ===
      sha256(intencion.emision.emailCandidato) &&
    fila.modo_remitente === 'configuracion_actual' &&
    fila.remitente_email === null && fila.remitente_nombre === null &&
    fila.asunto === intencion.asunto && fila.cuerpo_texto === intencion.cuerpoTexto &&
    fila.smtp_message_id === intencion.smtpMessageId &&
    fila.estado === 'preparada' && fila.proximo_intento_en === null &&
    normalizarMarcaUtc(fila.fecha_creacion) === intencion.creadaEnUtc;
  if (!compatible) throw conflicto('La emisión ya posee otra intención de salida.');
}

function exigirIdentidadSalida(fila, { operacionId, emisionId, claseEmision }) {
  if (!fila || fila.origen_tipo !== ORIGEN ||
      fila.productor_version !== VERSION_PRODUCTOR_SQL_CORREO ||
      uuidDesdeFila(fila.operacion_email_perfil_id) !== operacionId ||
      uuidV7DesdeFila(fila.emision_email_perfil_id) !== emisionId ||
      fila.clase_emision_email_perfil !== claseEmision) {
    throw conflicto('La salida no conserva su identidad coordinada.');
  }
}

function proyectarReferencia(fila) {
  return Object.freeze({
    salidaId: String(fila.id),
    operacionEmailPerfilId: uuidDesdeFila(fila.operacion_email_perfil_id),
    emisionEmailPerfilId: uuidV7DesdeFila(fila.emision_email_perfil_id),
    clase: fila.clase_emision_email_perfil,
    usuarioId: String(fila.creado_por_usuario_id),
    emailCandidato: fila.destinatario_email,
    estadoSalida: fila.estado,
    creadaEnUtc: normalizarMarcaUtc(fila.fecha_creacion)
  });
}

function resultadoCreacion(fila, creada) {
  return Object.freeze({ salida: new CorreoPendiente(fila), creada });
}

function uuidCanonico(valor, campo) {
  const texto = String(valor ?? '');
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u
    .test(texto)) {
    throw new Error(`${campo} no es un UUID canónico.`);
  }
  return texto;
}

function uuidCanonicoABytes(valor) {
  return Buffer.from(uuidCanonico(valor, 'operacionEmailPerfilId').replaceAll('-', ''), 'hex');
}

function uuidDesdeFila(valor) {
  if (valor == null) return null;
  const hex = Buffer.from(valor).toString('hex');
  return uuidCanonico([
    hex.slice(0, 8), hex.slice(8, 12), hex.slice(12, 16),
    hex.slice(16, 20), hex.slice(20)
  ].join('-'), 'operacionEmailPerfilId');
}

function uuidV7DesdeFila(valor) {
  if (valor == null) return null;
  const hex = Buffer.from(valor).toString('hex');
  return validarUuidV7Auditoria([
    hex.slice(0, 8), hex.slice(8, 12), hex.slice(12, 16),
    hex.slice(16, 20), hex.slice(20)
  ].join('-'), 'emisionEmailPerfilId');
}

function sha256(valor) {
  return createHash('sha256').update(valor, 'utf8').digest('hex');
}

function hashDesdeFila(valor) {
  return valor == null ? null : Buffer.from(valor).toString('hex');
}

function asunto(valor) {
  const texto = String(valor ?? '');
  if (!texto || /[\r\n]/u.test(texto) || texto.length > 255) {
    throw new Error('El asunto no es una cabecera de correo válida.');
  }
  return texto;
}

function cuerpo(valor) {
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

function validarClaim({
  reclamacionId, salidaId, claimId, leaseToken, propietarioClaim, fencingToken
}) {
  const hex = (valor, campo) => {
    const texto = String(valor ?? '');
    if (!/^[0-9a-f]{64}$/u.test(texto)) throw new Error(`${campo} no es válido.`);
    return texto;
  };
  const propietario = String(propietarioClaim ?? '');
  if (!/^[\x21-\x7e]{1,190}$/u.test(propietario)) {
    throw new Error('propietarioClaim no es válido.');
  }
  return Object.freeze({
    reclamacionId: decimalPositivo(reclamacionId, 'reclamacionId'),
    salidaId: decimalPositivo(salidaId, 'salidaId'),
    claimId: hex(claimId, 'claimId'),
    leaseToken: hex(leaseToken, 'leaseToken'),
    propietarioClaim: propietario,
    fencingToken: decimalPositivo(fencingToken, 'fencingToken')
  });
}

function exigirClaimVigente(fila, identidad) {
  if (!fila || fila.estado !== 'reclamada' ||
      Buffer.from(fila.claim_id || []).toString('hex') !== identidad.claimId ||
      Buffer.from(fila.lease_token || []).toString('hex') !== identidad.leaseToken ||
      fila.propietario_claim !== identidad.propietarioClaim ||
      String(fila.fencing_token) !== identidad.fencingToken) {
    throw new Error('La autoridad SQL del claim ya no está vigente.');
  }
}

function exigirUnaFila(resultado, mensaje) {
  if (Number(resultado?.affectedRows || 0) !== 1) throw new Error(mensaje);
}

async function finalizarReclamacion(conexion, identidad, { estado, codigo }) {
  const [resultado] = await conexion.execute(
    `UPDATE reclamaciones_correos_salida
        SET estado=?,finalizada_en_utc=UTC_TIMESTAMP(3),codigo_resultado=?
      WHERE id=? AND salida_correo_id=? AND claim_id=UNHEX(?)
        AND fencing_token=? AND estado='reclamada'`,
    [estado, codigo, identidad.reclamacionId, identidad.salidaId,
      identidad.claimId, identidad.fencingToken]
  );
  exigirUnaFila(resultado, 'La reclamación no pudo alcanzar su terminalidad.');
}

async function cerrarSinNuevoIntento(conexion, identidad, { codigo, respuesta }) {
  const [resultado] = await conexion.execute(
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
    [respuesta, codigo, respuesta, identidad.salidaId, ORIGEN,
      identidad.claimId, identidad.leaseToken, identidad.propietarioClaim,
      identidad.fencingToken]
  );
  exigirUnaFila(resultado, 'La salida no pudo cerrar sus reintentos.');
  await finalizarReclamacion(conexion, identidad, {
    estado: 'finalizada', codigo
  });
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

function conflicto(mensaje) {
  return new ErrorConflictoCorreoVerificacionEmailPerfil(mensaje);
}

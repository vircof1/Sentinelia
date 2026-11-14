import { createHash } from 'node:crypto';

import { canonicalizarRfc8785 } from '../../auditoria/src/PerfilJcsAuditoria.js';
import {
  bytesAUuidV7Auditoria,
  uuidV7AuditoriaABytes
} from '../../auditoria/src/UuidV7Auditoria.js';

export class ErrorRepositorioNotificacionesUsuario extends Error {
  constructor(codigo, mensaje, { causa = null } = {}) {
    super(mensaje, causa ? { cause: causa } : undefined);
    this.name = 'ErrorRepositorioNotificacionesUsuario';
    this.codigo = codigo;
  }
}

export class RepositorioNotificacionesUsuarioSql {
  constructor(clienteSql, { catalogoContratos } = {}) {
    if (typeof clienteSql?.consultar !== 'function' ||
        typeof clienteSql?.obtenerConexion !== 'function') {
      throw new Error('El buzón personal requiere ClienteSql.');
    }
    this.clienteSql = clienteSql;
    this.catalogoContratos = catalogoContratos;
    if (
      typeof this.catalogoContratos?.validar !== 'function' ||
      typeof this.catalogoContratos?.canonicalizarPayload !== 'function'
    ) {
      throw new Error('El buzón requiere un catálogo cerrado de notificaciones.');
    }
  }

  async crearORecuperar({ notificacion, retenerHastaUtc, conexion = null } = {}) {
    const normalizada = this.catalogoContratos.validar(notificacion);
    if (normalizada.leida || normalizada.leidaEnUtc !== null) {
      throw new ErrorRepositorioNotificacionesUsuario(
        'notificacion_nueva_ya_leida',
        'Una notificación nueva debe incorporarse sin leer.'
      );
    }
    const retencion = fechaUtc(retenerHastaUtc, 'retenerHastaUtc');
    if (Date.parse(retencion) <= Date.parse(normalizada.emitidaEnUtc)) {
      throw new ErrorRepositorioNotificacionesUsuario(
        'retencion_notificacion_invalida',
        'La retención debe terminar después de la emisión.'
      );
    }
    const payloadCanonico = this.catalogoContratos.canonicalizarPayload(normalizada);
    const huella = createHash('sha256').update(payloadCanonico, 'utf8').digest();
    const ejecutar = conexion?.execute
      ? (sql, parametros) => conexion.execute(sql, parametros)
      : (sql, parametros) => this.clienteSql.ejecutar(sql, parametros);
    try {
      await ejecutar(
        `INSERT INTO notificaciones_usuarios (
           notificacion_id,destinatario_usuario_id,tipo,version_contrato,
           operacion_id,emisor_tipo,actor_real_usuario_id,actor_efectivo_usuario_id,
           estado_operacion,sujeto_tipo,sujeto_id,sujeto_guid,
           titulo_codigo,resumen_codigo,payload_canonico,huella_payload,
           emitida_en_utc,actualizada_en_utc,retener_hasta_utc
         ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        parametrosInsercion(normalizada, payloadCanonico, huella, retencion)
      );
      return Object.freeze({ creada: true, notificacion: normalizada });
    } catch (error) {
      if (error?.code !== 'ER_DUP_ENTRY') throw error;
      if (String(error.message || '').includes('PRIMARY')) {
        const existentePorId = await this.buscarPorId({
          destinatarioUsuarioId: normalizada.destinatarioUsuarioId,
          notificacionId: normalizada.notificacionId,
          conexion
        });
        if (existentePorId &&
            this.#mismaIntencion(existentePorId, normalizada, payloadCanonico)) {
          return Object.freeze({ creada: false, notificacion: existentePorId });
        }
        throw new ErrorRepositorioNotificacionesUsuario(
          'identidad_notificacion_reutilizada',
          'La identidad de notificación ya pertenece a otro mensaje.',
          { causa: error }
        );
      }
      const existente = await this.buscarPorOperacionYTipo({
        destinatarioUsuarioId: normalizada.destinatarioUsuarioId,
        operacionId: normalizada.operacionId,
        tipo: normalizada.tipo,
        conexion
      });
      if (!existente || !this.#mismaIntencion(existente, normalizada, payloadCanonico)) {
        throw new ErrorRepositorioNotificacionesUsuario(
          'intencion_notificacion_reutilizada',
          'La notificación durable existente protege otro contenido.',
          { causa: error }
        );
      }
      return Object.freeze({ creada: false, notificacion: existente });
    }
  }

  async listarPagina({ destinatarioUsuarioId, limite = 25, cursor = null } = {}) {
    const destinatario = idDecimal(destinatarioUsuarioId, 'destinatarioUsuarioId');
    const maximo = entero(limite, 1, 100, 'limite');
    const parametros = [destinatario];
    let posicion = '';
    if (cursor) {
      const emitidaEnUtc = fechaUtc(cursor.emitidaEnUtc, 'cursor.emitidaEnUtc');
      posicion = `AND (
        emitida_en_utc<? OR (emitida_en_utc=? AND notificacion_id<?)
      )`;
      parametros.push(
        isoASql(emitidaEnUtc),
        isoASql(emitidaEnUtc),
        uuidV7AuditoriaABytes(cursor.notificacionId)
      );
    }
    parametros.push(maximo + 1);
    const filas = await this.clienteSql.consultar(
      `${SELECCION_NOTIFICACION}
        WHERE destinatario_usuario_id=? ${posicion}
        ORDER BY emitida_en_utc DESC,notificacion_id DESC LIMIT ?`,
      parametros
    );
    const hayMas = filas.length > maximo;
    const pagina = filas.slice(0, maximo).map((fila) => this.#rehidratar(fila));
    const ultima = pagina.at(-1) || null;
    return Object.freeze({
      notificaciones: Object.freeze(pagina),
      hayMas,
      siguientePosicion: hayMas && ultima ? Object.freeze({
        emitidaEnUtc: ultima.emitidaEnUtc,
        notificacionId: ultima.notificacionId
      }) : null
    });
  }

  async contarNoLeidas(destinatarioUsuarioId) {
    const filas = await this.clienteSql.consultar(
      `SELECT COUNT(*) AS total FROM notificaciones_usuarios
        WHERE destinatario_usuario_id=? AND leida=0`,
      [idDecimal(destinatarioUsuarioId, 'destinatarioUsuarioId')]
    );
    return Number(filas[0]?.total || 0);
  }

  async marcarLeida({ destinatarioUsuarioId, notificacionId } = {}) {
    const destinatario = idDecimal(destinatarioUsuarioId, 'destinatarioUsuarioId');
    const conexion = await this.clienteSql.obtenerConexion();
    try {
      await conexion.beginTransaction();
      const [filas] = await conexion.execute(
        `${SELECCION_NOTIFICACION}
          WHERE destinatario_usuario_id=? AND notificacion_id=? FOR UPDATE`,
        [destinatario, uuidV7AuditoriaABytes(notificacionId)]
      );
      if (!filas[0]) {
        await conexion.rollback();
        return null;
      }
      const actual = this.#rehidratar(filas[0]);
      if (actual.leida) {
        await conexion.commit();
        return Object.freeze({ cambioEfectivo: false, notificacion: actual });
      }
      await conexion.execute(
        `UPDATE notificaciones_usuarios
            SET leida=1,
                leida_en_utc=GREATEST(UTC_TIMESTAMP(3),emitida_en_utc),
                actualizada_en_utc=GREATEST(UTC_TIMESTAMP(3),emitida_en_utc)
          WHERE destinatario_usuario_id=? AND notificacion_id=? AND leida=0`,
        [destinatario, uuidV7AuditoriaABytes(notificacionId)]
      );
      const [actualizadas] = await conexion.execute(
        `${SELECCION_NOTIFICACION}
          WHERE destinatario_usuario_id=? AND notificacion_id=?`,
        [destinatario, uuidV7AuditoriaABytes(notificacionId)]
      );
      await conexion.commit();
      return Object.freeze({
        cambioEfectivo: true,
        notificacion: this.#rehidratar(actualizadas[0])
      });
    } catch (error) {
      await conexion.rollback().catch(() => {});
      throw error;
    } finally {
      conexion.release();
    }
  }

  async obtenerFirma(destinatarioUsuarioId) {
    const destinatario = idDecimal(destinatarioUsuarioId, 'destinatarioUsuarioId');
    const filas = await this.clienteSql.consultar(
      `SELECT COUNT(*) AS total,
              SUM(CASE WHEN leida=0 THEN 1 ELSE 0 END) AS no_leidas,
              DATE_FORMAT(MAX(actualizada_en_utc),'%Y-%m-%dT%H:%i:%s.%fZ') AS ultima
         FROM notificaciones_usuarios WHERE destinatario_usuario_id=?`,
      [destinatario]
    );
    const fotografia = Object.freeze({
      destinatarioUsuarioId: destinatario,
      total: String(filas[0]?.total || 0),
      noLeidas: String(filas[0]?.no_leidas || 0),
      actualizadaEnUtc: filas[0]?.ultima || null
    });
    return Object.freeze({
      ...fotografia,
      firma: createHash('sha256')
        .update(canonicalizarRfc8785(fotografia), 'utf8')
        .digest('hex')
    });
  }

  async existeDestinatario(destinatarioUsuarioId, { conexion = null } = {}) {
    const ejecutar = conexion?.execute
      ? (sql, parametros) => conexion.execute(sql, parametros)
      : async (sql, parametros) => [await this.clienteSql.consultar(sql, parametros)];
    const [filas] = await ejecutar(
      'SELECT id FROM usuarios WHERE id=? LIMIT 1',
      [idDecimal(destinatarioUsuarioId, 'destinatarioUsuarioId')]
    );
    return Boolean(filas[0]);
  }

  async buscarPorOperacionYTipo({
    destinatarioUsuarioId,
    operacionId,
    tipo,
    conexion = null
  }) {
    const ejecutar = conexion?.execute
      ? (sql, parametros) => conexion.execute(sql, parametros)
      : async (sql, parametros) => [await this.clienteSql.consultar(sql, parametros)];
    const [filas] = await ejecutar(
      `${SELECCION_NOTIFICACION}
        WHERE destinatario_usuario_id=? AND operacion_id=? AND tipo=? LIMIT 1`,
      [
        idDecimal(destinatarioUsuarioId, 'destinatarioUsuarioId'),
        uuidV7AuditoriaABytes(operacionId),
        String(tipo || '')
      ]
    );
    return filas[0] ? this.#rehidratar(filas[0]) : null;
  }

  async buscarPorId({ destinatarioUsuarioId, notificacionId, conexion = null }) {
    const ejecutar = conexion?.execute
      ? (sql, parametros) => conexion.execute(sql, parametros)
      : async (sql, parametros) => [await this.clienteSql.consultar(sql, parametros)];
    const [filas] = await ejecutar(
      `${SELECCION_NOTIFICACION}
        WHERE destinatario_usuario_id=? AND notificacion_id=? LIMIT 1`,
      [
        idDecimal(destinatarioUsuarioId, 'destinatarioUsuarioId'),
        uuidV7AuditoriaABytes(notificacionId)
      ]
    );
    return filas[0] ? this.#rehidratar(filas[0]) : null;
  }

  #rehidratar(fila) {
    const payload = JSON.parse(fila.payload_canonico);
    return this.catalogoContratos.validar({
      perfil: 'sentinelia-notificacion-operacion-administrativa-v1',
      version: Number(fila.version_contrato),
      notificacionId: bytesAUuidV7Auditoria(fila.notificacion_id),
      tipo: fila.tipo,
      operacionId: bytesAUuidV7Auditoria(fila.operacion_id),
      destinatarioUsuarioId: String(fila.destinatario_usuario_id),
      emisor: {
        tipo: fila.emisor_tipo,
        actorRealId: fila.actor_real_usuario_id === null
          ? null
          : String(fila.actor_real_usuario_id),
        actorEfectivoId: fila.actor_efectivo_usuario_id === null
          ? null
          : String(fila.actor_efectivo_usuario_id)
      },
      emitidaEnUtc: fechaUtc(fila.emitida_en_utc, 'emitidaEnUtc'),
      estadoOperacion: fila.estado_operacion,
      referenciaSujeto: payload.referenciaSujeto,
      leida: Boolean(fila.leida),
      leidaEnUtc: fila.leida_en_utc === null
        ? null
        : fechaUtc(fila.leida_en_utc, 'leidaEnUtc'),
      tituloCodigo: fila.titulo_codigo,
      resumenCodigo: fila.resumen_codigo
    });
  }

  #mismaIntencion(existente, candidata, payloadCanonico) {
    return existente.destinatarioUsuarioId === candidata.destinatarioUsuarioId &&
      existente.tipo === candidata.tipo &&
      existente.operacionId === candidata.operacionId &&
      existente.estadoOperacion === candidata.estadoOperacion &&
      existente.emitidaEnUtc === candidata.emitidaEnUtc &&
      existente.emisor.tipo === candidata.emisor.tipo &&
      existente.emisor.actorRealId === candidata.emisor.actorRealId &&
      existente.emisor.actorEfectivoId === candidata.emisor.actorEfectivoId &&
      existente.tituloCodigo === candidata.tituloCodigo &&
      existente.resumenCodigo === candidata.resumenCodigo &&
      this.catalogoContratos.canonicalizarPayload(existente) === payloadCanonico;
  }
}

const SELECCION_NOTIFICACION = `SELECT
  notificacion_id,destinatario_usuario_id,tipo,version_contrato,operacion_id,
  emisor_tipo,actor_real_usuario_id,actor_efectivo_usuario_id,
  estado_operacion,sujeto_tipo,sujeto_id,sujeto_guid,
  titulo_codigo,resumen_codigo,payload_canonico,leida,leida_en_utc,
  emitida_en_utc,actualizada_en_utc,retener_hasta_utc
FROM notificaciones_usuarios`;

function parametrosInsercion(notificacion, payload, huella, retencion) {
  return [
    uuidV7AuditoriaABytes(notificacion.notificacionId),
    notificacion.destinatarioUsuarioId,
    notificacion.tipo,
    notificacion.version,
    uuidV7AuditoriaABytes(notificacion.operacionId),
    notificacion.emisor.tipo,
    notificacion.emisor.actorRealId,
    notificacion.emisor.actorEfectivoId,
    notificacion.estadoOperacion,
    notificacion.referenciaSujeto.tipo,
    notificacion.referenciaSujeto.id,
    notificacion.referenciaSujeto.guid ?? null,
    notificacion.tituloCodigo,
    notificacion.resumenCodigo,
    payload,
    huella,
    isoASql(notificacion.emitidaEnUtc),
    isoASql(notificacion.emitidaEnUtc),
    isoASql(retencion)
  ];
}

function fechaUtc(valor, campo) {
  const fecha = new Date(valor);
  if (!valor || Number.isNaN(fecha.getTime())) {
    throw new Error(`${campo} no es una fecha UTC válida.`);
  }
  return fecha.toISOString();
}

function isoASql(valor) {
  return fechaUtc(valor, 'fecha').replace('T', ' ').replace(/Z$/u, '');
}

function idDecimal(valor, campo) {
  const texto = String(valor ?? '');
  if (!/^[1-9][0-9]*$/u.test(texto)) throw new Error(`${campo} no es un id válido.`);
  return texto;
}

function entero(valor, minimo, maximo, campo) {
  const numero = Number(valor);
  if (!Number.isInteger(numero) || numero < minimo || numero > maximo) {
    throw new Error(`${campo} debe estar entre ${minimo} y ${maximo}.`);
  }
  return numero;
}

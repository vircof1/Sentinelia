import {
  bytesAUuidV7Auditoria,
  uuidV7AuditoriaABytes,
  validarUuidV7Auditoria
} from '../../auditoria/src/UuidV7Auditoria.js';
import {
  normalizarMarcaUtc
} from '../../utilidades/src/fechas/normalizarMarcaUtc.js';
import {
  PERFILES_REINICIO_PASSWORD_ADMINISTRATIVO,
  VERSION_CONTRATO_REINICIO_PASSWORD_ADMINISTRATIVO,
  VIAS_REINICIO_PASSWORD_ADMINISTRATIVO,
  proyectarReinicioPasswordAdministrativo
} from './ContratoReinicioPasswordAdministrativo.js';

const VIAS = new Set(Object.values(VIAS_REINICIO_PASSWORD_ADMINISTRATIVO));

export class ErrorConflictoReinicioPasswordAdministrativo extends Error {
  constructor(mensaje = 'El reinicioId ya pertenece a otra intención.') {
    super(mensaje);
    this.name = 'ErrorConflictoReinicioPasswordAdministrativo';
    this.codigo = 'CONFLICTO_REINICIO_PASSWORD_ADMINISTRATIVO';
  }
}

export class RepositorioReiniciosPasswordAdministrativosSql {
  constructor(clienteSql) {
    if (
      typeof clienteSql?.obtenerConexion !== 'function' ||
      typeof clienteSql?.consultar !== 'function'
    ) {
      throw new Error('Los reinicios administrativos requieren SQL operativo.');
    }
    this.clienteSql = clienteSql;
  }

  async reservarEnTransaccion(
    { reinicioId, usuarioId, via } = {},
    { conexion } = {}
  ) {
    exigirConexion(conexion);
    const intencion = {
      reinicioId: validarUuidV7Auditoria(reinicioId, 'reinicioId'),
      usuarioId: decimalPositivo(usuarioId, 'usuarioId'),
      via: viaValida(via)
    };
    let existente = await this.buscarPorIdEnTransaccion(intencion.reinicioId, {
      conexion,
      forUpdate: true
    });
    if (existente) {
      exigirIntencionCompatible(existente, intencion);
      return resultadoReserva(existente, false);
    }

    try {
      await conexion.execute(
        `INSERT INTO reinicios_password_administrativos (
           reinicio_id,usuario_id,via,estado
         ) VALUES (?,? ,?,'reservado')`,
        [
          uuidV7AuditoriaABytes(intencion.reinicioId),
          intencion.usuarioId,
          intencion.via
        ]
      );
    } catch (error) {
      if (error?.code !== 'ER_DUP_ENTRY') throw error;
      existente = await this.buscarPorIdEnTransaccion(intencion.reinicioId, {
        conexion,
        forUpdate: true
      });
      if (!existente) throw error;
      exigirIntencionCompatible(existente, intencion);
      return resultadoReserva(existente, false);
    }

    const creada = await this.buscarPorIdEnTransaccion(intencion.reinicioId, {
      conexion,
      forUpdate: true
    });
    return resultadoReserva(creada, true);
  }

  async confirmarEnTransaccion(
    {
      reinicioId,
      eventoAuditoriaId,
      salidaCorreoId,
      versionSesionResultante,
      generacionRecuperacionResultante
    } = {},
    { conexion } = {}
  ) {
    exigirConexion(conexion);
    const id = validarUuidV7Auditoria(reinicioId, 'reinicioId');
    const resultado = {
      eventoAuditoriaId: validarUuidV7Auditoria(
        eventoAuditoriaId,
        'eventoAuditoriaId'
      ),
      salidaCorreoId: salidaCorreoId === null
        ? null
        : decimalPositivo(salidaCorreoId, 'salidaCorreoId'),
      versionSesionResultante: decimalPositivo(
        versionSesionResultante,
        'versionSesionResultante'
      ),
      generacionRecuperacionResultante: decimalPositivo(
        generacionRecuperacionResultante,
        'generacionRecuperacionResultante'
      )
    };
    const existente = await this.buscarPorIdEnTransaccion(id, {
      conexion,
      forUpdate: true
    });
    if (!existente) {
      throw new Error('El reinicio administrativo no está reservado.');
    }
    exigirSalidaCompatible(existente.via, resultado.salidaCorreoId);
    if (existente.estado === 'confirmado') {
      exigirResultadoCompatible(existente, resultado);
      return Object.freeze({ confirmado: false, operacion: existente });
    }

    const [actualizacion] = await conexion.execute(
      `UPDATE reinicios_password_administrativos
          SET estado='confirmado', evento_auditoria_id=?, salida_correo_id=?,
              version_sesion_resultante=?, generacion_recuperacion_resultante=?,
              aplicado_en_utc=UTC_TIMESTAMP(3)
        WHERE reinicio_id=? AND estado='reservado'`,
      [
        uuidV7AuditoriaABytes(resultado.eventoAuditoriaId),
        resultado.salidaCorreoId,
        resultado.versionSesionResultante,
        resultado.generacionRecuperacionResultante,
        uuidV7AuditoriaABytes(id)
      ]
    );
    if (Number(actualizacion.affectedRows || 0) !== 1) {
      throw new Error('La reserva del reinicio perdió su autoridad SQL.');
    }
    const confirmada = await this.buscarPorIdEnTransaccion(id, {
      conexion,
      forUpdate: true
    });
    return Object.freeze({ confirmado: true, operacion: confirmada });
  }

  async buscarPorId(reinicioId) {
    const filas = await this.clienteSql.consultar(
      'SELECT * FROM reinicios_password_administrativos WHERE reinicio_id=? LIMIT 1',
      [uuidV7AuditoriaABytes(validarUuidV7Auditoria(reinicioId, 'reinicioId'))]
    );
    return filas[0] ? proyectarFila(filas[0]) : null;
  }

  async buscarPorIdEnTransaccion(
    reinicioId,
    { conexion, forUpdate = false } = {}
  ) {
    exigirConexion(conexion);
    const [filas] = await conexion.execute(
      `SELECT * FROM reinicios_password_administrativos
        WHERE reinicio_id=? LIMIT 1 ${forUpdate ? 'FOR UPDATE' : ''}`,
      [uuidV7AuditoriaABytes(validarUuidV7Auditoria(reinicioId, 'reinicioId'))]
    );
    return filas[0] ? proyectarFila(filas[0]) : null;
  }

  async buscarUltimoPorUsuario(usuarioId) {
    const filas = await this.clienteSql.consultar(
      `SELECT * FROM reinicios_password_administrativos
        WHERE usuario_id=? AND estado='confirmado'
        ORDER BY aplicado_en_utc DESC,reinicio_id DESC LIMIT 1`,
      [decimalPositivo(usuarioId, 'usuarioId')]
    );
    return filas[0] ? proyectarFila(filas[0]) : null;
  }

  async buscarUltimoProyectadoPorUsuario(usuarioId) {
    const filas = await this.clienteSql.consultar(
      `SELECT r.*,s.estado AS estado_salida_correo
         FROM reinicios_password_administrativos r
         LEFT JOIN cola_correos_salida s ON s.id=r.salida_correo_id
        WHERE r.usuario_id=? AND r.estado='confirmado'
        ORDER BY r.aplicado_en_utc DESC,r.reinicio_id DESC LIMIT 1`,
      [decimalPositivo(usuarioId, 'usuarioId')]
    );
    if (!filas[0]) return null;
    const resultado = proyectarFila(filas[0]);
    return proyectarReinicioPasswordAdministrativo({
      resultado: {
        perfil: PERFILES_REINICIO_PASSWORD_ADMINISTRATIVO.RESULTADO_DURABLE,
        version: VERSION_CONTRATO_REINICIO_PASSWORD_ADMINISTRATIVO,
        reinicioId: resultado.reinicioId,
        usuarioId: resultado.usuarioId,
        via: resultado.via,
        salidaCorreoId: resultado.salidaCorreoId,
        eventoAuditoriaId: resultado.eventoAuditoriaId,
        versionSesionResultante: resultado.versionSesionResultante,
        generacionRecuperacionResultante:
          resultado.generacionRecuperacionResultante,
        aplicadoEnUtc: resultado.aplicadoEnUtc
      },
      estadoSalidaCorreo: resultado.via ===
        VIAS_REINICIO_PASSWORD_ADMINISTRATIVO.CORREO
        ? filas[0].estado_salida_correo
        : null,
      detalleRetenido: resultado.via ===
        VIAS_REINICIO_PASSWORD_ADMINISTRATIVO.CORREO &&
        resultado.salidaCorreoId === null
    });
  }
}

function proyectarFila(fila) {
  return Object.freeze({
    reinicioId: bytesAUuidV7Auditoria(Buffer.from(fila.reinicio_id), 'reinicioId'),
    usuarioId: String(fila.usuario_id),
    via: fila.via,
    estado: fila.estado,
    eventoAuditoriaId: fila.evento_auditoria_id
      ? bytesAUuidV7Auditoria(
          Buffer.from(fila.evento_auditoria_id),
          'eventoAuditoriaId'
        )
      : null,
    salidaCorreoId: fila.salida_correo_id == null
      ? null
      : String(fila.salida_correo_id),
    versionSesionResultante: fila.version_sesion_resultante == null
      ? null
      : String(fila.version_sesion_resultante),
    generacionRecuperacionResultante:
      fila.generacion_recuperacion_resultante == null
        ? null
        : String(fila.generacion_recuperacion_resultante),
    creadoEnUtc: normalizarMarcaUtc(fila.creado_en_utc),
    aplicadoEnUtc: normalizarMarcaUtc(fila.aplicado_en_utc)
  });
}

function exigirIntencionCompatible(existente, intencion) {
  if (
    existente.usuarioId !== intencion.usuarioId ||
    existente.via !== intencion.via
  ) {
    throw new ErrorConflictoReinicioPasswordAdministrativo();
  }
}

function exigirResultadoCompatible(existente, resultado) {
  const pares = [
    ['eventoAuditoriaId', resultado.eventoAuditoriaId],
    ['versionSesionResultante', resultado.versionSesionResultante],
    [
      'generacionRecuperacionResultante',
      resultado.generacionRecuperacionResultante
    ]
  ];
  if (pares.some(([campo, valor]) => existente[campo] !== valor)) {
    throw new ErrorConflictoReinicioPasswordAdministrativo(
      'El reinicioId confirmado no admite otro resultado.'
    );
  }
  if (
    existente.salidaCorreoId !== null &&
    existente.salidaCorreoId !== resultado.salidaCorreoId
  ) {
    throw new ErrorConflictoReinicioPasswordAdministrativo(
      'El reinicioId confirmado no admite otra salida de correo.'
    );
  }
}

function exigirSalidaCompatible(via, salidaCorreoId) {
  const esperaSalida = via === VIAS_REINICIO_PASSWORD_ADMINISTRATIVO.CORREO;
  if (esperaSalida !== (salidaCorreoId !== null)) {
    throw new Error('La salida de correo no corresponde a la vía reservada.');
  }
}

function resultadoReserva(operacion, creada) {
  return Object.freeze({ creada, operacion });
}

function viaValida(via) {
  if (!VIAS.has(via)) throw new Error('La vía del reinicio no es válida.');
  return via;
}

function decimalPositivo(valor, campo) {
  const texto = String(valor ?? '');
  if (!/^[1-9][0-9]*$/u.test(texto)) {
    throw new Error(`${campo} debe ser decimal positivo.`);
  }
  return texto;
}

function exigirConexion(conexion) {
  if (typeof conexion?.execute !== 'function') {
    throw new Error('La operación exige una conexión SQL prestada.');
  }
}

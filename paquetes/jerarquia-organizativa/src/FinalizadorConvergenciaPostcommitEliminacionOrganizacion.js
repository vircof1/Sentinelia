import { createHash, timingSafeEqual } from 'node:crypto';

import {
  bytesAUuidV7Auditoria,
  uuidV7AuditoriaABytes
} from '../../auditoria/src/UuidV7Auditoria.js';
import {
  CONTRATOS_NOTIFICACION_ELIMINACION_ORGANIZACION,
  EMISORES_NOTIFICACION_OPERACION_ADMINISTRATIVA,
  ESTADOS_OPERACION_ADMINISTRATIVA_ORGANIZACION,
  PERFIL_NOTIFICACION_OPERACION_ADMINISTRATIVA,
  TIPOS_NOTIFICACION_ELIMINACION_ORGANIZACION,
  VERSION_CONTRATO_ELIMINACION_ADMINISTRATIVA_ORGANIZACION,
  crearNotificacionEliminacionAdministrativaOrganizacion
} from './ContratoEliminacionAdministrativaOrganizacion.js';

const RETENCION_NOTIFICACIONES_DIAS = 365;

export class FinalizadorConvergenciaPostcommitEliminacionOrganizacion {
  constructor({
    repositorioNotificaciones,
    ahora = () => new Date(),
    retencionNotificacionesDias = RETENCION_NOTIFICACIONES_DIAS
  } = {}) {
    if (typeof repositorioNotificaciones?.crearORecuperar !== 'function') {
      throw new Error('La convergencia organizativa exige el buzón durable.');
    }
    if (typeof ahora !== 'function' || !Number.isInteger(retencionNotificacionesDias) ||
        retencionNotificacionesDias < 1 || retencionNotificacionesDias > 3650) {
      throw new Error('La configuración de convergencia organizativa no es válida.');
    }
    Object.assign(this, {
      repositorioNotificaciones,
      ahora,
      retencionNotificacionesDias
    });
  }

  async finalizarEnTransaccion({ operacionId } = {}, { conexion } = {}) {
    if (typeof conexion?.execute !== 'function') {
      throw new Error('La convergencia organizativa exige conexión prestada.');
    }
    const [filas] = await conexion.execute(
      `SELECT estado,comando_canonico,resultado_canonico
         FROM operaciones_administrativas
        WHERE operacion_id=? FOR UPDATE`,
      [uuidV7AuditoriaABytes(operacionId)]
    );
    const fila = filas[0];
    if (!fila) return sinNotificacion('operacion_compactada');
    if (fila.estado !== ESTADOS_OPERACION_ADMINISTRATIVA_ORGANIZACION.COMPLETADA) {
      return sinNotificacion('operacion_sin_limpieza_pendiente');
    }
    const comando = JSON.parse(String(fila.comando_canonico));
    const resultado = JSON.parse(String(fila.resultado_canonico));
    const destinatarioUsuarioId = String(
      comando.fotografiaAutorizacion.destinatarioUsuarioId
    );
    const [destinatarios] = await conexion.execute(
      'SELECT id FROM usuarios WHERE id=? FOR UPDATE',
      [destinatarioUsuarioId]
    );
    if (!destinatarios[0]) return sinNotificacion('destinatario_eliminado');

    const emitidaEnUtc = fechaValida(this.ahora()).toISOString();
    const tipo = TIPOS_NOTIFICACION_ELIMINACION_ORGANIZACION.LIMPIEZA_COMPLETADA;
    const contratoNotificacion =
      CONTRATOS_NOTIFICACION_ELIMINACION_ORGANIZACION[tipo];
    const notificacion = crearNotificacionEliminacionAdministrativaOrganizacion({
      perfil: PERFIL_NOTIFICACION_OPERACION_ADMINISTRATIVA,
      version: VERSION_CONTRATO_ELIMINACION_ADMINISTRATIVA_ORGANIZACION,
      notificacionId: derivarUuidV7(operacionId, `notificacion:${tipo}`),
      tipo,
      operacionId,
      destinatarioUsuarioId,
      emisor: {
        tipo: EMISORES_NOTIFICACION_OPERACION_ADMINISTRATIVA.PROCESO,
        actorRealId: null,
        actorEfectivoId: null
      },
      emitidaEnUtc,
      estadoOperacion: ESTADOS_OPERACION_ADMINISTRATIVA_ORGANIZACION.COMPLETADA,
      referenciaSujeto: {
        tipo: comando.sujeto.tipo,
        id: comando.sujeto.id,
        fotografiaFinal: resultado.fotografiaFinal
      },
      leida: false,
      leidaEnUtc: null,
      tituloCodigo: contratoNotificacion.tituloCodigo,
      resumenCodigo: contratoNotificacion.resumenCodigo
    });
    const retenerHastaUtc = new Date(
      Date.parse(emitidaEnUtc) + this.retencionNotificacionesDias * 86_400_000
    ).toISOString();
    const registro = await this.repositorioNotificaciones.crearORecuperar({
      notificacion,
      retenerHastaUtc,
      conexion
    });
    return Object.freeze({
      completada: true,
      notificacion: registro.notificacion,
      notificacionCreada: registro.creada,
      destinatarioUsuarioId,
      motivo: registro.creada ? 'limpieza_notificada' : 'limpieza_ya_notificada'
    });
  }
}

function sinNotificacion(motivo) {
  return Object.freeze({
    completada: true,
    notificacion: null,
    destinatarioUsuarioId: null,
    motivo
  });
}

function derivarUuidV7(padre, etiqueta) {
  const padreBytes = uuidV7AuditoriaABytes(padre, 'operacionId');
  const salida = createHash('sha256')
    .update(padreBytes).update('\0', 'utf8').update(etiqueta, 'utf8')
    .digest().subarray(0, 16);
  padreBytes.copy(salida, 0, 0, 6);
  salida[6] = 0x70 | (salida[6] & 0x0f);
  salida[8] = 0x80 | (salida[8] & 0x3f);
  if (timingSafeEqual(salida, padreBytes)) salida[15] ^= 0x01;
  return bytesAUuidV7Auditoria(salida);
}

function fechaValida(valor) {
  const fecha = valor instanceof Date ? new Date(valor) : new Date(valor);
  if (Number.isNaN(fecha.getTime())) throw new TypeError('ahora no devolvió fecha válida.');
  return fecha;
}

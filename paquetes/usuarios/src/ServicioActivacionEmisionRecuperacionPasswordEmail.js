import {
  PERFILES_RECUPERACION_PASSWORD_EMAIL,
  PROPOSITOS_CORREO_RECUPERACION_PASSWORD_EMAIL,
  VERSION_CONTRATO_RECUPERACION_PASSWORD_EMAIL,
  crearMensajeRecuperacionPasswordEmail
} from './ContratoRecuperacionPasswordEmail.js';
import { construirIntencionAuditoriaEmisionRecuperacionPassword }
  from './EventosAuditoriaRecuperacionPassword.js';
import { PERFIL_PREPARACION_CORREO_RECUPERACION_PASSWORD }
  from './ServicioPreparacionEmisionRecuperacionPasswordEmail.js';

export class ServicioActivacionEmisionRecuperacionPasswordEmail {
  constructor({
    repositorioSolicitudes,
    repositorioCoordinacionCorreo,
    fronteraTransaccional
  } = {}) {
    exigirMetodo(repositorioSolicitudes, 'activar', 'repositorioSolicitudes');
    exigirMetodo(repositorioCoordinacionCorreo,
      'completarSalidaPreparadaEnTransaccion', 'repositorioCoordinacionCorreo');
    exigirMetodo(fronteraTransaccional, 'ejecutar', 'fronteraTransaccional');
    this.repositorioSolicitudes = repositorioSolicitudes;
    this.repositorioCoordinacionCorreo = repositorioCoordinacionCorreo;
    this.frontera = fronteraTransaccional;
  }

  async activarYLiberar(preparacion = {}) {
    const entrada = validarPreparacion(preparacion);
    return this.#activarYLiberar(entrada, null);
  }

  async activarYLiberarEnTransaccion(preparacion = {}, { conexion } = {}) {
    if (!conexion?.execute) {
      throw new Error('La convergencia exige una transacción SQL activa.');
    }
    const entrada = validarPreparacion(preparacion);
    return this.#activarYLiberar(entrada, conexion);
  }

  async #activarYLiberar(entrada, conexion) {
    const activacion = await this.repositorioSolicitudes.activar({
      solicitudId: entrada.solicitudId,
      token: entrada.material.token,
      operacionId: entrada.operacionId,
      propietario: entrada.material.propietario,
      vigenciaSegundos: entrada.material.vigenciaSegundos
    });
    if (!['activada', 'repetida'].includes(activacion.estado) ||
        !activacion.emitidaEnUtc || !activacion.expiraEnUtc) {
      const error = new Error(
        `Redis no pudo activar la solicitud: ${activacion.estado}.`
      );
      error.codigo = 'activacion_redis_no_disponible';
      error.estadoRedis = activacion.estado;
      throw error;
    }
    validarVigenciaRedis(activacion);

    const cuerpoTexto = renderizarCuerpo(entrada.material.cuerpoPlantilla, {
      emitidaEnUtc: activacion.emitidaEnUtc,
      expiraEnUtc: activacion.expiraEnUtc
    });
    const mensaje = crearMensajeRecuperacionPasswordEmail({
      perfil: PERFILES_RECUPERACION_PASSWORD_EMAIL.MENSAJE,
      version: VERSION_CONTRATO_RECUPERACION_PASSWORD_EMAIL,
      proposito:
        PROPOSITOS_CORREO_RECUPERACION_PASSWORD_EMAIL.TRANSPORTAR_SOLICITUD,
      solicitudId: entrada.solicitudId,
      buzonCanonico: entrada.buzonCanonico,
      asunto: entrada.asunto,
      cuerpoTexto
    });
    const intencionAuditoria =
      construirIntencionAuditoriaEmisionRecuperacionPassword({
        solicitudId: entrada.solicitudId,
        eventoEmisionId: entrada.eventoEmisionId,
        eventoConsumoId: entrada.material.eventoConsumoId,
        efectivoEnUtc: activacion.emitidaEnUtc,
        buzonCanonico: entrada.buzonCanonico,
        direccionIp: entrada.direccionIp
      });
    const completar = (conexionActiva) =>
      this.repositorioCoordinacionCorreo.completarSalidaPreparadaEnTransaccion({
        salidaId: entrada.salidaId,
        solicitudId: entrada.solicitudId,
        eventoEmisionId: entrada.eventoEmisionId,
        cuerpoTexto: mensaje.cuerpoTexto,
        intencionAuditoria
      }, { conexion: conexionActiva });
    const completada = conexion
      ? await completar(conexion)
      : await this.frontera.ejecutar(completar);
    return Object.freeze({
      estado: 'emitida',
      solicitudId: entrada.solicitudId,
      salidaId: entrada.salidaId,
      emitidaEnUtc: activacion.emitidaEnUtc,
      expiraEnUtc: activacion.expiraEnUtc,
      salida: completada.salida,
      auditoria: completada.auditoria
    });
  }
}

function validarPreparacion(entrada) {
  const material = entrada?.materialPreparacion;
  if (!entrada?.preparada || entrada.resultado !== 'preparada' ||
      !material || material.perfil !==
        PERFIL_PREPARACION_CORREO_RECUPERACION_PASSWORD ||
      Number(material.version) !== VERSION_CONTRATO_RECUPERACION_PASSWORD_EMAIL) {
    throw new Error('La activación exige una preparación interna válida.');
  }
  for (const campo of ['solicitudId', 'eventoEmisionId', 'operacionId',
    'salidaId', 'buzonCanonico', 'direccionIp', 'asunto']) {
    if (entrada[campo] == null || String(entrada[campo]).length === 0) {
      throw new Error(`La preparación no contiene ${campo}.`);
    }
  }
  if (material.operacionId !== entrada.operacionId ||
      material.eventoConsumoId !== entrada.eventoConsumoId ||
      material.token !== entrada.token || !material.token ||
      !material.propietario || !material.eventoConsumoId ||
      !Number.isSafeInteger(Number(material.vigenciaSegundos)) ||
      Number(material.vigenciaSegundos) < 1 ||
      Number(material.vigenciaSegundos) > 86_400 ||
      typeof material.cuerpoPlantilla !== 'string') {
    throw new Error('El material privado de preparación es incoherente.');
  }
  return Object.freeze({ ...entrada, material });
}

function validarVigenciaRedis({ emitidaEnUtc, expiraEnUtc }) {
  const emision = Date.parse(emitidaEnUtc);
  const expiracion = Date.parse(expiraEnUtc);
  if (!Number.isFinite(emision) || !Number.isFinite(expiracion) ||
      new Date(emision).toISOString() !== emitidaEnUtc ||
      new Date(expiracion).toISOString() !== expiraEnUtc ||
      expiracion <= emision) {
    throw new Error('Redis devolvió una vigencia temporal incoherente.');
  }
}

function renderizarCuerpo(plantilla, { emitidaEnUtc, expiraEnUtc }) {
  if (!plantilla.includes('{{emitidaEnUtc}}') ||
      !plantilla.includes('{{expiraEnUtc}}')) {
    throw new Error('La plantilla preparada perdió sus fronteras temporales.');
  }
  const cuerpo = plantilla
    .replaceAll('{{emitidaEnUtc}}', emitidaEnUtc)
    .replaceAll('{{expiraEnUtc}}', expiraEnUtc);
  if (/\{\{[^{}]+\}\}/u.test(cuerpo)) {
    throw new Error('La plantilla de recuperación conserva tokens sin resolver.');
  }
  return cuerpo;
}

function exigirMetodo(objeto, metodo, nombre) {
  if (typeof objeto?.[metodo] !== 'function') {
    throw new Error(`${nombre}.${metodo} es obligatorio.`);
  }
}

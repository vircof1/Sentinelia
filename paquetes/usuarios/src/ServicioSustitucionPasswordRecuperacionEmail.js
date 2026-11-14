import { createHash } from 'node:crypto';

import {
  PLANTILLAS_CORREO_RECUPERACION_PASSWORD_EMAIL,
  PROPOSITOS_CORREO_RECUPERACION_PASSWORD_EMAIL,
  crearMensajeRecuperacionPasswordEmail,
  PERFILES_RECUPERACION_PASSWORD_EMAIL,
  VERSION_CONTRATO_RECUPERACION_PASSWORD_EMAIL
} from './ContratoRecuperacionPasswordEmail.js';
import { construirIntencionAuditoriaConsumoRecuperacionPassword }
  from './EventosAuditoriaRecuperacionPassword.js';
import { generarUuidV7Auditoria }
  from '../../auditoria/src/UuidV7Auditoria.js';
import { normalizarBuzonCorreo }
  from '../../correo/src/NormalizadorBuzonCorreo.js';
import { ErrorValidacionPassword } from './ServicioAutenticacion.js';

export class ErrorPoliticaPasswordRecuperacion extends Error {
  constructor(mensaje, opciones = {}) {
    super(mensaje, opciones);
    this.name = 'ErrorPoliticaPasswordRecuperacion';
    this.codigo = 'POLITICA_PASSWORD_RECUPERACION';
  }
}

export class ServicioSustitucionPasswordRecuperacionEmail {
  constructor({
    repositorioSolicitudes,
    repositorioUsuarios,
    repositorioSesionesWeb,
    repositorioAuditoria,
    repositorioCoordinacionCorreo,
    servicioAutenticacion,
    servicioConfiguracionPortal,
    fronteraTransaccional,
    propietario,
    generarId = generarUuidV7Auditoria
  } = {}) {
    for (const metodo of ['reservarConsumo', 'inspeccionar',
      'restaurarConsumo', 'retirarIdentidad']) {
      exigirMetodo(repositorioSolicitudes, metodo, 'repositorioSolicitudes');
    }
    exigirMetodo(repositorioUsuarios,
      'bloquearIdentidadElegibleRecuperacionEnTransaccion',
      'repositorioUsuarios');
    exigirMetodo(repositorioUsuarios,
      'sustituirPasswordPorRecuperacionEnTransaccion', 'repositorioUsuarios');
    exigirMetodo(repositorioUsuarios, 'buscarPorIdEnTransaccion',
      'repositorioUsuarios');
    exigirMetodo(repositorioSesionesWeb,
      'invalidarVigentesPorUsuariosEnTransaccion', 'repositorioSesionesWeb');
    exigirMetodo(repositorioAuditoria, 'existeTestigoEventoEnTransaccion',
      'repositorioAuditoria');
    exigirMetodo(repositorioAuditoria, 'incorporarEnTransaccion',
      'repositorioAuditoria');
    exigirMetodo(repositorioCoordinacionCorreo,
      'crearNotificacionSeguridadEnTransaccion',
      'repositorioCoordinacionCorreo');
    exigirMetodo(servicioAutenticacion, 'validarPasswordNueva',
      'servicioAutenticacion');
    exigirMetodo(servicioAutenticacion, 'crearHashPassword',
      'servicioAutenticacion');
    exigirMetodo(servicioConfiguracionPortal, 'asegurarActualizada',
      'servicioConfiguracionPortal');
    exigirMetodo(servicioConfiguracionPortal, 'obtenerConfiguracionActual',
      'servicioConfiguracionPortal');
    exigirMetodo(fronteraTransaccional, 'ejecutar', 'fronteraTransaccional');
    this.solicitudes = repositorioSolicitudes;
    this.usuarios = repositorioUsuarios;
    this.sesiones = repositorioSesionesWeb;
    this.auditoria = repositorioAuditoria;
    this.correo = repositorioCoordinacionCorreo;
    this.autenticacion = servicioAutenticacion;
    this.configuracion = servicioConfiguracionPortal;
    this.frontera = fronteraTransaccional;
    this.propietario = texto(propietario, 190, 'propietario');
    this.generarId = generarId;
  }

  async sustituir({ token, passwordNuevo, passwordConfirmacion,
    leaseSegundos } = {}) {
    await this.configuracion.asegurarActualizada();
    try {
      this.autenticacion.validarPasswordNueva(passwordNuevo, passwordConfirmacion);
    } catch (error) {
      if (error instanceof ErrorValidacionPassword) {
        throw new ErrorPoliticaPasswordRecuperacion(error.message, { cause: error });
      }
      throw error;
    }
    const reservaId = this.generarId();
    const reserva = await this.solicitudes.reservarConsumo({
      token,
      reservaId,
      propietario: this.propietario,
      leaseSegundos
    });
    if (!['reservada', 'repetida'].includes(reserva.estado)) {
      return Object.freeze({ estado: reserva.estado, sustituida: false });
    }

    let inspeccion;
    let fronteraSqlIniciada = false;
    let contextoCierre = null;
    try {
      inspeccion = await this.solicitudes.inspeccionar(token);
      if (inspeccion.estado !== 'consumiendo' || !inspeccion.solicitud) {
        await this.#restaurar(token, reservaId);
        return Object.freeze({ estado: inspeccion.estado, sustituida: false });
      }
      const coordinacion = inspeccion.coordinacion;
      const usuarioId = String(inspeccion.solicitud.usuarioIdVinculado || '');
      const miembro = inspeccion.solicitud.frontera.miembros.find(
        ({ usuarioId: id }) => String(id) === usuarioId
      );
      if (!miembro || !coordinacion?.eventoEmisionId ||
          !coordinacion?.eventoConsumoId) {
        throw new Error('La reserva de consumo perdió su autoridad vinculada.');
      }
      const generacion = String(miembro.generacionRecuperacionObservada);
      const eventoConsumoId = coordinacion.eventoConsumoId;
      contextoCierre = { token, reservaId, usuarioId, eventoConsumoId };
      const hashPasswordNuevo = await this.autenticacion
        .crearHashPassword(passwordNuevo);
      fronteraSqlIniciada = true;
      const resultado = await this.frontera.ejecutar(async (conexion) => {
        if (await this.auditoria.existeTestigoEventoEnTransaccion(
          eventoConsumoId, { conexion }
        )) {
          const actual = await this.usuarios.buscarPorIdEnTransaccion(
            usuarioId, { conexion, forUpdate: true }
          );
          if (!actual) {
            throw new Error('El testigo de consumo perdió su identidad durable.');
          }
          return Object.freeze({ estado: 'ya_sustituida', sustituida: true,
            usuarioId, eventoConsumoId,
            versionSesion: String(actual.versionSesion),
            generacionRecuperacion: String(actual.generacionRecuperacion),
            scope: scopeDeUsuario(actual) });
        }
        const usuario = await this.usuarios
          .bloquearIdentidadElegibleRecuperacionEnTransaccion({
            idUsuario: usuarioId,
            generacionRecuperacionObservada: generacion,
            buzonCanonico: inspeccion.solicitud.buzonCanonico
          }, { conexion });
        if (!usuario) return Object.freeze({ estado: 'autoridad_retirada',
          sustituida: false });

        const ahoraUtc = await obtenerAhoraSqlUtc(conexion);
        const actualizado = await this.usuarios
          .sustituirPasswordPorRecuperacionEnTransaccion({
            idUsuario: usuarioId,
            generacionRecuperacionObservada: generacion,
            buzonCanonico: inspeccion.solicitud.buzonCanonico,
            hashPasswordNuevo
          }, { conexion });
        if (!actualizado) {
          throw new Error('La autoridad cambió bajo el bloqueo de recuperación.');
        }
        const sesionesInvalidadas = await this.sesiones
          .invalidarVigentesPorUsuariosEnTransaccion([usuarioId], { conexion });
        const intencion = construirIntencionAuditoriaConsumoRecuperacionPassword({
          solicitudId: inspeccion.solicitud.solicitudId,
          eventoEmisionId: coordinacion.eventoEmisionId,
          eventoConsumoId,
          usuarioId,
          scope: scopeDeUsuario(usuario),
          efectivoEnUtc: ahoraUtc
        });
        await this.auditoria.incorporarEnTransaccion([intencion], { conexion });
        const notificacion = await this.#crearNotificacion({
          conexion,
          usuario,
          solicitudId: inspeccion.solicitud.solicitudId,
          eventoConsumoId,
          ahoraUtc
        });
        return Object.freeze({
          estado: 'sustituida',
          sustituida: true,
          usuarioId,
          eventoConsumoId,
          versionSesion: String(actualizado.versionSesion),
          generacionRecuperacion: String(actualizado.generacionRecuperacion),
          sesionesInvalidadas: sesionesInvalidadas.length,
          salidaSeguridadId: String(notificacion.salida.id),
          scope: scopeDeUsuario(usuario)
        });
      });

      if (resultado.estado === 'autoridad_retirada') {
        await this.#restaurar(token, reservaId);
        await this.solicitudes.retirarIdentidad({
          token,
          usuarioId,
          generacionRecuperacionObservada: generacion
        });
      }
      return Object.freeze({ ...resultado, reservaId,
        propietario: this.propietario });
    } catch (error) {
      if (!fronteraSqlIniciada) await this.#restaurar(token, reservaId);
      if (fronteraSqlIniciada && contextoCierre) {
        error.contextoRecuperacionPassword = Object.freeze({
          ...contextoCierre,
          propietario: this.propietario
        });
      }
      throw error;
    }
  }

  async resolverResultadoIndeterminado(error) {
    const contexto = error?.contextoRecuperacionPassword;
    if (!contexto) throw error;
    const resultado = await this.frontera.ejecutar(async (conexion) => {
      const confirmado = await this.auditoria.existeTestigoEventoEnTransaccion(
        contexto.eventoConsumoId, { conexion }
      );
      if (!confirmado) return null;
      const usuario = await this.usuarios.buscarPorIdEnTransaccion(
        contexto.usuarioId, { conexion, forUpdate: true }
      );
      if (!usuario) {
        throw new Error('El consumo confirmado perdió su identidad durable.');
      }
      return Object.freeze({
        estado: 'ya_sustituida',
        sustituida: true,
        usuarioId: contexto.usuarioId,
        eventoConsumoId: contexto.eventoConsumoId,
        versionSesion: String(usuario.versionSesion),
        generacionRecuperacion: String(usuario.generacionRecuperacion),
        scope: scopeDeUsuario(usuario),
        reservaId: contexto.reservaId,
        propietario: contexto.propietario
      });
    });
    if (resultado) return resultado;
    await this.#restaurar(contexto.token, contexto.reservaId);
    return Object.freeze({ estado: 'no_confirmada', sustituida: false });
  }

  async #crearNotificacion({ conexion, usuario, solicitudId,
    eventoConsumoId, ahoraUtc }) {
    const portal = this.configuracion.obtenerConfiguracionActual();
    const nombrePortal = String(portal.obtenerNombreVisiblePortal()).trim();
    const plantilla = PLANTILLAS_CORREO_RECUPERACION_PASSWORD_EMAIL[
      PROPOSITOS_CORREO_RECUPERACION_PASSWORD_EMAIL.NOTIFICAR_CAMBIO
    ];
    const asunto = plantilla.asunto.replaceAll('{{portal}}', nombrePortal);
    const cuerpoTexto = plantilla.cuerpo
      .replaceAll('{{usuario}}', usuario.usuario)
      .replaceAll('{{cambiadaEnUtc}}', ahoraUtc);
    const mensaje = crearMensajeRecuperacionPasswordEmail({
      perfil: PERFILES_RECUPERACION_PASSWORD_EMAIL.MENSAJE,
      version: VERSION_CONTRATO_RECUPERACION_PASSWORD_EMAIL,
      proposito:
        PROPOSITOS_CORREO_RECUPERACION_PASSWORD_EMAIL.NOTIFICAR_CAMBIO,
      solicitudId,
      buzonCanonico: normalizarBuzonCorreo(usuario.email).canonico,
      asunto,
      cuerpoTexto
    });
    return this.correo.crearNotificacionSeguridadEnTransaccion({
      solicitudId,
      claveOperacionSha256: sha(
        `recuperacion-password\0seguridad\0${eventoConsumoId}`
      ),
      buzonCanonico: mensaje.buzonCanonico,
      claveBuzonSha256: sha(mensaje.buzonCanonico),
      smtpMessageId:
        `<${sha(`smtp\0seguridad\0${eventoConsumoId}`)}@correo.sentinelia>`,
      asunto: mensaje.asunto,
      cuerpoTexto: mensaje.cuerpoTexto,
      usuariosJustificantesIds: [String(usuario.id)],
      creadaEnUtc: ahoraUtc
    }, { conexion });
  }

  async #restaurar(token, reservaId) {
    try {
      await this.solicitudes.restaurarConsumo({
        token, reservaId, propietario: this.propietario
      });
    } catch {
      // La lease limita el cierre incierto; 5.30.6c resolverá el postcommit.
    }
  }
}

async function obtenerAhoraSqlUtc(conexion) {
  const [filas] = await conexion.execute(
    "SELECT DATE_FORMAT(UTC_TIMESTAMP(3),'%Y-%m-%dT%H:%i:%s.%fZ') AS ahora_utc"
  );
  const valor = String(filas[0]?.ahora_utc || '').replace(/([0-9]{3})[0-9]{3}Z$/u,
    '$1Z');
  if (!valor || new Date(valor).toISOString() !== valor) {
    throw new Error('SQL no devolvió un instante UTC canónico.');
  }
  return valor;
}

function scopeDeUsuario(usuario) {
  return Object.freeze({
    tenantId: usuario.tenantId == null ? null : String(usuario.tenantId),
    empresaId: usuario.empresaId == null ? null : String(usuario.empresaId),
    sitioId: usuario.sitioId == null ? null : String(usuario.sitioId)
  });
}

function sha(valor) {
  return createHash('sha256').update(String(valor), 'utf8').digest('hex');
}

function texto(valor, maximo, campo) {
  const normalizado = String(valor ?? '').trim();
  if (!normalizado || Buffer.byteLength(normalizado, 'utf8') > maximo) {
    throw new Error(`${campo} no es válido.`);
  }
  return normalizado;
}

function exigirMetodo(objeto, metodo, nombre) {
  if (typeof objeto?.[metodo] !== 'function') {
    throw new Error(`${nombre}.${metodo} es obligatorio.`);
  }
}

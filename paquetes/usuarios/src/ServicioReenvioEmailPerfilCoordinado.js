import { createHash } from 'node:crypto';

import { generarUuidV7Auditoria }
  from '../../auditoria/src/UuidV7Auditoria.js';
import { construirContenidoVerificacionEmailPerfil }
  from '../../correo/src/ContenidoVerificacionEmailPerfil.js';
import {
  CLASES_EMISION_VERIFICACION_EMAIL_PERFIL,
  PERFILES_VERIFICACION_EMAIL_PERFIL,
  VERSION_CONTRATO_VERIFICACION_EMAIL_PERFIL
} from './ContratoVerificacionEmailPerfil.js';
export class ServicioReenvioEmailPerfilCoordinado {
  constructor({
    repositorioUsuarios,
    repositorioOperacionesEmail,
    repositorioCoordinacionCorreo,
    servicioCorreoPortal,
    servicioConfiguracionPortal,
    fronteraTransaccional,
    generarEmisionId = generarUuidV7Auditoria
  } = {}) {
    exigirMetodo(repositorioUsuarios, 'buscarPorId', 'repositorioUsuarios');
    for (const metodo of ['adquirirBloqueoUsuario', 'liberarBloqueoUsuario',
      'obtenerOperacionActual', 'coincideHuellaCredencial',
      'recuperarTokenOperacion', 'intentarRegistrarReenvio',
      'renovarOperacion', 'invalidarOperacionUsuario']) {
      exigirMetodo(repositorioOperacionesEmail, metodo, 'repositorioOperacionesEmail');
    }
    for (const metodo of ['crearSalidaPreparadaEnTransaccion',
      'liberarSalidaPreparadaEnTransaccion',
      'eliminarPreparacionPorEmisionEnTransaccion', 'buscarPorEmisionId']) {
      exigirMetodo(repositorioCoordinacionCorreo, metodo,
        'repositorioCoordinacionCorreo');
    }
    exigirMetodo(servicioCorreoPortal, 'obtenerEstadoConfiguracionAutoritativo',
      'servicioCorreoPortal');
    exigirMetodo(servicioConfiguracionPortal, 'asegurarActualizada',
      'servicioConfiguracionPortal');
    exigirMetodo(servicioConfiguracionPortal, 'obtenerConfiguracionActual',
      'servicioConfiguracionPortal');
    exigirMetodo(fronteraTransaccional, 'ejecutar', 'fronteraTransaccional');
    this.usuarios = repositorioUsuarios;
    this.operaciones = repositorioOperacionesEmail;
    this.correo = repositorioCoordinacionCorreo;
    this.estadoCorreo = servicioCorreoPortal;
    this.configuracion = servicioConfiguracionPortal;
    this.frontera = fronteraTransaccional;
    this.generarEmisionId = generarEmisionId;
  }

  async encolarReenvio({ idUsuario } = {}) {
    const usuarioId = idDecimal(idUsuario, 'idUsuario');
    const bloqueo = await this.operaciones.adquirirBloqueoUsuario(usuarioId);
    if (!bloqueo) throw errorConCodigo(
      'operacion_email_en_conflicto',
      'Ya existe otra operación de email en curso.'
    );
    try {
      const usuario = await this.usuarios.buscarPorId(usuarioId);
      if (!usuario?.activo || !usuario.email || !usuario.hashPassword) {
        throw errorConCodigo('sesion_no_vigente', 'La cuenta ya no está disponible.');
      }
      const diagnostico = await this.operaciones.obtenerOperacionActual(usuarioId);
      if (diagnostico.estado !== 'activa' || !diagnostico.operacion) {
        throw errorConCodigo(
          'token_email_invalido',
          'No existe una verificación activa que se pueda reenviar.'
        );
      }
      const operacion = diagnostico.operacion;
      if (usuario.email !== operacion.emailOrigen ||
          !this.operaciones.coincideHuellaCredencial(
            operacion,
            usuario.hashPassword
          )) {
        await this.operaciones.invalidarOperacionUsuario(usuarioId, {
          idOperacion: operacion.idOperacion,
          estado: 'sustituida'
        });
        throw errorConCodigo(
          'operacion_email_en_conflicto',
          'La identidad sensible cambió desde que se emitió la verificación.'
        );
      }
      const token = this.operaciones.recuperarTokenOperacion(operacion);
      if (!token) throw errorConCodigo(
        'token_email_invalido',
        'No se pudo recuperar el enlace de la operación.'
      );
      const cadencia = await this.operaciones.intentarRegistrarReenvio(usuarioId);
      if (!cadencia.permitido) {
        const error = errorConCodigo(
          'reenvio_limitado',
          'Espera antes de volver a enviar la verificación.'
        );
        error.datos = { reintentar_en_segundos: cadencia.reintentarEnSegundos };
        throw error;
      }
      const autoridad = await this.estadoCorreo.obtenerEstadoConfiguracionAutoritativo();
      if (autoridad?.puedeDespachar !== true && autoridad?.operativo !== true) {
        throw errorConCodigo(
          'correo_no_operativo',
          'El correo del portal no está operativo.'
        );
      }
      return this.#coordinar({ usuario, operacion, token });
    } finally {
      await this.operaciones.liberarBloqueoUsuario(usuarioId, bloqueo).catch(() => {});
    }
  }

  async #coordinar({ usuario, operacion, token }) {
    await this.configuracion.asegurarActualizada();
    const portal = this.configuracion.obtenerConfiguracionActual();
    const origen = origenHttps(portal.obtenerOrigenPublicoPortal());
    const nombrePortal = String(portal.obtenerNombreVisiblePortal?.() || 'Sentinelia').trim();
    const emisionReenvioId = this.generarEmisionId();
    const enlace = `${origen}/mi-perfil/email/confirmar/${encodeURIComponent(token)}`;
    const { asunto, cuerpoTexto } = construirContenidoVerificacionEmailPerfil({
      nombrePortal,
      enlace,
      emailOrigen: operacion.emailOrigen,
      emailCandidato: operacion.emailCandidato
    });
    const smtpMessageId = construirMessageId(emisionReenvioId, origen);
    try {
      const completada = await this.frontera.ejecutar(async (conexion) => {
        const salida = await this.correo.crearSalidaPreparadaEnTransaccion({
          emision: {
            perfil: PERFILES_VERIFICACION_EMAIL_PERFIL.EMISION,
            version: VERSION_CONTRATO_VERIFICACION_EMAIL_PERFIL,
            operacionEmailPerfilId: operacion.idOperacion,
            emisionEmailPerfilId: emisionReenvioId,
            clase: CLASES_EMISION_VERIFICACION_EMAIL_PERFIL.REENVIO,
            usuarioId: String(usuario.id),
            emailOrigen: operacion.emailOrigen,
            emailCandidato: operacion.emailCandidato,
            huellaCredencialOrigen: operacion.huellaCredencialOrigen
          },
          destinatarioNombre: usuario.obtenerNombreVisible?.() || null,
          asunto,
          cuerpoTexto,
          smtpMessageId,
          creadaEnUtc: await ahoraSql(conexion)
        }, { conexion });
        const salidaId = String(salida.salida.id);
        const liberada = await this.correo.liberarSalidaPreparadaEnTransaccion({
          salidaId,
          operacionEmailPerfilId: operacion.idOperacion,
          emisionEmailPerfilId: emisionReenvioId,
          claseEmision: CLASES_EMISION_VERIFICACION_EMAIL_PERFIL.REENVIO
        }, { conexion });
        const renovacion = await this.operaciones.renovarOperacion(operacion, {
          salidaId,
          emisionReenvioId
        });
        if (renovacion.estado !== 'renovada') {
          throw errorConCodigo(
            'coordinacion_email_perfil_fallida',
            `Redis rechazó el reenvío (${renovacion.estado}).`
          );
        }
        return { salida: liberada.salida, renovacion };
      });
      exigirConvergencia(completada, { operacion, emisionReenvioId });
      return resultadoEncolado();
    } catch (error) {
      const recuperada = await this.#resolverCorte({ operacion, emisionReenvioId })
        .catch(() => false);
      if (recuperada) return resultadoEncolado();
      await this.frontera.ejecutar((conexion) =>
        this.correo.eliminarPreparacionPorEmisionEnTransaccion({
          emisionEmailPerfilId: emisionReenvioId
        }, { conexion })
      ).catch(() => {});
      throw error;
    }
  }

  async #resolverCorte({ operacion, emisionReenvioId }) {
    const salida = await this.correo.buscarPorEmisionId(emisionReenvioId);
    if (!salida || salida.estado !== 'pendiente') return false;
    const renovacion = await this.operaciones.renovarOperacion(operacion, {
      salidaId: String(salida.id),
      emisionReenvioId
    });
    return renovacion.estado === 'renovada';
  }
}

function resultadoEncolado() {
  return Object.freeze({
    codigo: 'email_verificacion_reenvio_encolado',
    mensaje: 'Verificación encolada de nuevo.'
  });
}

function exigirConvergencia({ salida, renovacion }, { operacion, emisionReenvioId }) {
  const referencia = renovacion.operacion?.reenvios?.find(
    (actual) => actual.emisionId === emisionReenvioId
  );
  if (salida.estado !== 'pendiente' ||
      salida.operacionEmailPerfilId !== operacion.idOperacion ||
      salida.emisionEmailPerfilId !== emisionReenvioId ||
      String(referencia?.salidaId) !== String(salida.id)) {
    throw errorConCodigo(
      'coordinacion_email_perfil_fallida',
      'El reenvío no convergió entre Redis y SQL.'
    );
  }
}

function construirMessageId(emisionId, origen) {
  const host = new URL(origen).hostname.replaceAll(':', '-');
  return `<${createHash('sha256').update(`smtp\0${emisionId}`).digest('hex')}@${host}>`;
}

async function ahoraSql(conexion) {
  const [filas] = await conexion.query('SELECT UTC_TIMESTAMP(3) AS ahora_utc');
  const valor = filas[0]?.ahora_utc;
  const fecha = valor instanceof Date ? valor : new Date(`${valor}Z`);
  if (Number.isNaN(fecha.getTime())) throw new Error('SQL no devolvió su reloj UTC.');
  return fecha.toISOString();
}

function origenHttps(valor) {
  let url;
  try { url = new URL(String(valor || '')); } catch {
    throw new Error('El reenvío exige un origen público HTTPS válido.');
  }
  if (url.protocol !== 'https:' || url.username || url.password ||
      url.pathname !== '/' || url.search || url.hash) {
    throw new Error('El reenvío exige un origen público HTTPS canónico.');
  }
  return url.origin;
}

function idDecimal(valor, campo) {
  const texto = String(valor ?? '');
  if (!/^[1-9][0-9]*$/u.test(texto)) throw new Error(`${campo} no es un id válido.`);
  return texto;
}

function errorConCodigo(codigo, mensaje) {
  const error = new Error(mensaje);
  error.codigo = codigo;
  return error;
}

function exigirMetodo(objeto, metodo, nombre) {
  if (typeof objeto?.[metodo] !== 'function') {
    throw new Error(`${nombre}.${metodo} es obligatorio.`);
  }
}

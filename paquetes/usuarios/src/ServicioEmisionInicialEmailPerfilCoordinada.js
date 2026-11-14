import { createHash } from 'node:crypto';

import { generarUuidV7Auditoria }
  from '../../auditoria/src/UuidV7Auditoria.js';
import { exigirBuzonCanonicoCorreo }
  from '../../correo/src/NormalizadorBuzonCorreo.js';
import { construirContenidoVerificacionEmailPerfil }
  from '../../correo/src/ContenidoVerificacionEmailPerfil.js';
import {
  CLASES_EMISION_VERIFICACION_EMAIL_PERFIL,
  PERFILES_VERIFICACION_EMAIL_PERFIL,
  VERSION_CONTRATO_VERIFICACION_EMAIL_PERFIL
} from './ContratoVerificacionEmailPerfil.js';
export class ServicioEmisionInicialEmailPerfilCoordinada {
  constructor({
    repositorioUsuarios,
    repositorioOperacionesEmail,
    repositorioCoordinacionCorreo,
    servicioCorreoPortal,
    servicioConfiguracionPortal,
    servicioEmailPerfil,
    fronteraTransaccional,
    generarEmisionId = generarUuidV7Auditoria
  } = {}) {
    exigirMetodo(repositorioUsuarios, 'buscarPorId', 'repositorioUsuarios');
    for (const metodo of ['adquirirBloqueoUsuario', 'liberarBloqueoUsuario',
      'generarToken', 'calcularHuellaCredencial', 'prepararOperacion',
      'vincularSalidaInicial', 'activarOperacionConSalidaInicialPendiente',
      'invalidarOperacionUsuario']) {
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
    exigirMetodo(servicioEmailPerfil, 'establecerEmailNoValidado',
      'servicioEmailPerfil');
    exigirMetodo(fronteraTransaccional, 'ejecutar', 'fronteraTransaccional');
    if (typeof generarEmisionId !== 'function') {
      throw new Error('generarEmisionId es obligatorio.');
    }
    this.usuarios = repositorioUsuarios;
    this.operaciones = repositorioOperacionesEmail;
    this.correo = repositorioCoordinacionCorreo;
    this.estadoCorreo = servicioCorreoPortal;
    this.configuracion = servicioConfiguracionPortal;
    this.emailPerfil = servicioEmailPerfil;
    this.frontera = fronteraTransaccional;
    this.generarEmisionId = generarEmisionId;
  }

  async encolarInicial({ idUsuario, emailCandidato } = {}) {
    const usuarioId = idDecimal(idUsuario, 'idUsuario');
    const candidato = exigirBuzonCanonicoCorreo(emailCandidato);
    const bloqueo = await this.operaciones.adquirirBloqueoUsuario(usuarioId);
    if (!bloqueo) {
      const error = new Error('Ya existe otra operación de email en curso.');
      error.codigo = 'operacion_email_en_conflicto';
      throw error;
    }
    try {
      const usuario = await this.usuarios.buscarPorId(usuarioId);
      if (!usuario?.activo || !usuario.email || !usuario.hashPassword) {
        const error = new Error('La cuenta ya no está disponible.');
        error.codigo = 'sesion_no_vigente';
        throw error;
      }
      const autoridad = await this.estadoCorreo.obtenerEstadoConfiguracionAutoritativo();
      if (autoridad?.puedeDespachar !== true && autoridad?.operativo !== true) {
        await this.operaciones.invalidarOperacionUsuario(usuarioId);
        return this.emailPerfil.establecerEmailNoValidado({
          idUsuario: usuarioId,
          email: candidato
        });
      }
      return await this.#coordinar({ usuario, candidato });
    } finally {
      await this.operaciones.liberarBloqueoUsuario(usuarioId, bloqueo).catch(() => {});
    }
  }

  async #coordinar({ usuario, candidato }) {
    await this.configuracion.asegurarActualizada();
    const portal = this.configuracion.obtenerConfiguracionActual();
    const origenPublico = origenHttps(portal.obtenerOrigenPublicoPortal());
    const nombrePortal = String(portal.obtenerNombreVisiblePortal?.() || 'Sentinelia').trim();
    const token = this.operaciones.generarToken();
    const emisionInicialId = this.generarEmisionId();
    const preparada = await this.operaciones.prepararOperacion({
      idUsuario: usuario.id,
      emailOrigen: exigirBuzonCanonicoCorreo(usuario.email),
      emailCandidato: candidato,
      huellaCredencialOrigen:
        this.operaciones.calcularHuellaCredencial(usuario.hashPassword),
      token,
      emisionInicialId
    });
    const operacion = preparada.operacion;
    const enlace = construirEnlace(origenPublico, token);
    const { asunto, cuerpoTexto } = construirContenidoVerificacionEmailPerfil({
      nombrePortal,
      enlace,
      emailOrigen: operacion.emailOrigen,
      emailCandidato: operacion.emailCandidato
    });
    const smtpMessageId = construirMessageId(emisionInicialId, origenPublico);

    try {
      const completada = await this.frontera.ejecutar(async (conexion) => {
        const creadaEnUtc = await ahoraSql(conexion);
        const salida = await this.correo.crearSalidaPreparadaEnTransaccion({
          emision: {
            perfil: PERFILES_VERIFICACION_EMAIL_PERFIL.EMISION,
            version: VERSION_CONTRATO_VERIFICACION_EMAIL_PERFIL,
            operacionEmailPerfilId: operacion.idOperacion,
            emisionEmailPerfilId: emisionInicialId,
            clase: CLASES_EMISION_VERIFICACION_EMAIL_PERFIL.INICIAL,
            usuarioId: String(usuario.id),
            emailOrigen: operacion.emailOrigen,
            emailCandidato: operacion.emailCandidato,
            huellaCredencialOrigen: operacion.huellaCredencialOrigen
          },
          destinatarioNombre: usuario.obtenerNombreVisible?.() || null,
          asunto,
          cuerpoTexto,
          smtpMessageId,
          creadaEnUtc
        }, { conexion });
        const salidaId = String(salida.salida.id);
        const vinculacion = await this.operaciones.vincularSalidaInicial({
          operacion,
          salidaId,
          emisionInicialId
        });
        if (!['vinculada', 'ya_vinculada'].includes(vinculacion)) {
          throw errorCoordinacion(`Redis rechazó el vínculo inicial (${vinculacion}).`);
        }
        const liberada = await this.correo.liberarSalidaPreparadaEnTransaccion({
          salidaId,
          operacionEmailPerfilId: operacion.idOperacion,
          emisionEmailPerfilId: emisionInicialId
        }, { conexion });
        const activacion =
          await this.operaciones.activarOperacionConSalidaInicialPendiente({
            operacion,
            salidaId,
            emisionInicialId
          });
        if (activacion.estado !== 'publicada') {
          throw errorCoordinacion(
            `Redis rechazó la publicación inicial (${activacion.estado}).`
          );
        }
        return { salida: liberada.salida, activacion };
      });
      exigirConvergencia(completada, { operacion, emisionInicialId });
      return resultadoEncolado();
    } catch (error) {
      const recuperada = await this.#resolverCorte({ operacion, emisionInicialId })
        .catch(() => null);
      if (recuperada) return resultadoEncolado();
      await this.#sanearPreparacion({ operacion, emisionInicialId });
      throw error;
    }
  }

  async #resolverCorte({ operacion, emisionInicialId }) {
    const salida = await this.correo.buscarPorEmisionId(emisionInicialId);
    if (!salida || salida.estado !== 'pendiente') return false;
    const activacion =
      await this.operaciones.activarOperacionConSalidaInicialPendiente({
        operacion,
        salidaId: String(salida.id),
        emisionInicialId
      });
    return activacion.estado === 'publicada';
  }

  async #sanearPreparacion({ operacion, emisionInicialId }) {
    await this.frontera.ejecutar((conexion) =>
      this.correo.eliminarPreparacionPorEmisionEnTransaccion({
        emisionEmailPerfilId: emisionInicialId
      }, { conexion })
    ).catch(() => {});
    await this.operaciones.invalidarOperacionUsuario(operacion.idUsuario, {
      idOperacion: operacion.idOperacion,
      estado: 'invalidada'
    }).catch(() => {});
  }
}

function resultadoEncolado() {
  return Object.freeze({
    codigo: 'email_verificacion_encolada',
    mensaje: 'Correo de verificación encolado.'
  });
}

function exigirConvergencia({ salida, activacion }, { operacion, emisionInicialId }) {
  if (salida.estado !== 'pendiente' ||
      salida.operacionEmailPerfilId !== operacion.idOperacion ||
      salida.emisionEmailPerfilId !== emisionInicialId ||
      activacion.operacion?.salidaInicialId !== String(salida.id)) {
    throw errorCoordinacion('La emisión inicial no convergió entre Redis y SQL.');
  }
}

function construirEnlace(origen, token) {
  return `${origen}/mi-perfil/email/confirmar/${encodeURIComponent(token)}`;
}

function construirMessageId(emisionId, origen) {
  const host = new URL(origen).hostname.replaceAll(':', '-');
  return `<${sha(`smtp\0${emisionId}`)}@${host}>`;
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
    throw new Error('La emisión exige un origen público HTTPS válido.');
  }
  if (url.protocol !== 'https:' || url.username || url.password ||
      url.pathname !== '/' || url.search || url.hash) {
    throw new Error('La emisión exige un origen público HTTPS canónico.');
  }
  return url.origin;
}

function idDecimal(valor, campo) {
  const texto = String(valor ?? '');
  if (!/^[1-9][0-9]*$/u.test(texto)) throw new Error(`${campo} no es un id válido.`);
  return texto;
}

function sha(valor) {
  return createHash('sha256').update(valor, 'utf8').digest('hex');
}

function errorCoordinacion(mensaje) {
  const error = new Error(mensaje);
  error.codigo = 'coordinacion_email_perfil_fallida';
  return error;
}

function exigirMetodo(objeto, metodo, nombre) {
  if (typeof objeto?.[metodo] !== 'function') {
    throw new Error(`${nombre}.${metodo} es obligatorio.`);
  }
}

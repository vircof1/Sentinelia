import {
  CLASES_EMISION_VERIFICACION_EMAIL_PERFIL,
  DECISIONES_INICIO_VERIFICACION_EMAIL_PERFIL,
  EFECTOS_OPERACION_VERIFICACION_EMAIL_PERFIL,
  EFECTOS_USUARIO_VERIFICACION_EMAIL_PERFIL,
  ESTADOS_AUTORIDAD_VERIFICACION_EMAIL_PERFIL,
  decidirInicioDespachoVerificacionEmailPerfil,
  decidirResultadoSmtpVerificacionEmailPerfil
} from './ContratoVerificacionEmailPerfil.js';
import { CAUSAS_DESCARTE_SALIDA_CORREO }
  from '../../correo/src/ContratoSalidaCorreo.js';

const A = ESTADOS_AUTORIDAD_VERIFICACION_EMAIL_PERFIL;
const D = DECISIONES_INICIO_VERIFICACION_EMAIL_PERFIL;

const CAUSA_DESCARTE = Object.freeze({
  [A.OPERACION_SUSTITUIDA]:
    CAUSAS_DESCARTE_SALIDA_CORREO.OPERACION_EMAIL_PERFIL_SUSTITUIDA,
  [A.OPERACION_CONSUMIDA]:
    CAUSAS_DESCARTE_SALIDA_CORREO.OPERACION_EMAIL_PERFIL_CONSUMIDA,
  [A.OPERACION_EXPIRADA]:
    CAUSAS_DESCARTE_SALIDA_CORREO.OPERACION_EMAIL_PERFIL_EXPIRADA,
  [A.IDENTIDAD_NO_VIGENTE]:
    CAUSAS_DESCARTE_SALIDA_CORREO.IDENTIDAD_EMAIL_PERFIL_NO_VIGENTE,
  [A.IDENTIDAD_DISTINTA]:
    CAUSAS_DESCARTE_SALIDA_CORREO.IDENTIDAD_EMAIL_PERFIL_DISTINTA,
  [A.CREDENCIAL_CAMBIADA]:
    CAUSAS_DESCARTE_SALIDA_CORREO.CREDENCIAL_EMAIL_PERFIL_CAMBIADA,
  [A.CORREO_ORIGEN_CAMBIADO]:
    CAUSAS_DESCARTE_SALIDA_CORREO.CORREO_ORIGEN_EMAIL_PERFIL_CAMBIADO,
  [A.PROPOSITO_AGOTADO]:
    CAUSAS_DESCARTE_SALIDA_CORREO.PROPOSITO_EMAIL_PERFIL_AGOTADO
});

export class ServicioInicioDespachoVerificacionEmailPerfil {
  constructor({
    repositorioUsuarios,
    repositorioOperacionesEmail,
    repositorioCoordinacionCorreo,
    repositorioColaCorreo
  } = {}) {
    exigirMetodo(repositorioUsuarios, 'buscarPorIdEnTransaccion');
    exigirMetodo(repositorioUsuarios, 'actualizarEmailNoValidadoEnTransaccion');
    for (const metodo of ['adquirirBloqueoUsuario', 'liberarBloqueoUsuario',
      'obtenerOperacionPorId', 'obtenerOperacionActual',
      'coincideHuellaCredencial', 'invalidarOperacionUsuario',
      'activarOperacionTrasAceptacionSmtp',
      'renovarOperacionTrasAceptacionSmtp']) {
      exigirMetodo(repositorioOperacionesEmail, metodo);
    }
    for (const metodo of ['leerReferenciaParaRevalidacionPorSalidaId',
      'descartarReclamacionEnTransaccion', 'iniciarIntentoEnTransaccion']) {
      exigirMetodo(repositorioCoordinacionCorreo, metodo);
    }
    exigirMetodo(repositorioColaCorreo, 'liberarReclamacionSql');
    exigirMetodo(repositorioColaCorreo, 'finalizarIntentoSql');
    this.usuarios = repositorioUsuarios;
    this.operaciones = repositorioOperacionesEmail;
    this.correo = repositorioCoordinacionCorreo;
    this.cola = repositorioColaCorreo;
  }

  async iniciarIntentoEnTransaccion(entrada = {}, { conexion } = {}) {
    const referencia = await this.correo.leerReferenciaParaRevalidacionPorSalidaId(
      entrada.salidaId,
      { conexion, bloquear: true }
    );
    if (!referencia) throw new Error('La salida no conserva su identidad de perfil.');

    let bloqueo;
    try {
      bloqueo = await this.operaciones.adquirirBloqueoUsuario(referencia.usuarioId);
    } catch (_errorRedis) {
      return this.#reintentar(entrada, A.REDIS_NO_DISPONIBLE, conexion);
    }
    if (!bloqueo) {
      return this.#reintentar(entrada, A.REDIS_NO_DISPONIBLE, conexion);
    }

    try {
      let autoridad;
      try {
        autoridad = await this.#evaluarAutoridad(referencia, conexion);
      } catch (error) {
        if (!(error instanceof ErrorConsultaRedisEmailPerfil)) throw error;
        return this.#reintentar(entrada, A.REDIS_NO_DISPONIBLE, conexion);
      }
      const decision = decidirInicioDespachoVerificacionEmailPerfil({
        estadoAutoridad: autoridad
      });
      if (decision.decision === D.DESCARTAR) {
        const descarte = await this.correo.descartarReclamacionEnTransaccion({
          ...identidad(entrada),
          causa: CAUSA_DESCARTE[decision.causa]
        }, { conexion });
        return Object.freeze({
          ...descarte,
          postcommit: postcommitInvalidacion(referencia)
        });
      }
      if (decision.decision === D.REINTENTAR) {
        return this.#reintentar(entrada, decision.causa, conexion);
      }
      const inicio = await this.correo.iniciarIntentoEnTransaccion(
        entrada,
        { conexion }
      );
      if (!inicio.iniciado && inicio.estadoSalida === 'error_final') {
        const fotografia = await this.#fotografiarCompatibilidad(
          referencia,
          conexion
        );
        if (referencia.clase ===
            CLASES_EMISION_VERIFICACION_EMAIL_PERFIL.INICIAL &&
            fotografia.compatible &&
            fotografia.operacion.emailCandidato !==
              fotografia.operacion.emailOrigen) {
          await this.usuarios.actualizarEmailNoValidadoEnTransaccion({
            idUsuario: referencia.usuarioId,
            emailActual: fotografia.operacion.emailOrigen,
            emailNuevo: fotografia.operacion.emailCandidato,
            hashPasswordActual: fotografia.usuario.hashPassword
          }, { conexion });
        }
        return Object.freeze({
          ...inicio,
          postcommit: postcommitInvalidacion(referencia)
        });
      }
      return inicio;
    } finally {
      await this.operaciones.liberarBloqueoUsuario(
        referencia.usuarioId,
        bloqueo
      ).catch(() => {});
    }
  }

  async finalizarIntentoEnTransaccion(entrada = {}, { conexion } = {}) {
    const referencia = await this.correo.leerReferenciaParaRevalidacionPorSalidaId(
      entrada.salidaId,
      { conexion, bloquear: true }
    );
    if (!referencia) throw new Error('El intento no conserva su identidad de perfil.');
    const candidatoDistinto = await this.#esCandidatoDistinto(referencia);
    const decision = decidirResultadoSmtpVerificacionEmailPerfil({
      claseEmision: referencia.clase,
      clasificacionSmtp: entrada.resultadoIntento?.clasificacion,
      candidatoDistinto
    });

    let fotografia = null;
    let bloqueo = null;
    try {
      bloqueo = await this.operaciones.adquirirBloqueoUsuario(referencia.usuarioId);
      if (bloqueo) fotografia = await this.#fotografiarCompatibilidad(
        referencia,
        conexion
      );
    } catch (_errorRedis) {
      fotografia = null;
    }

    try {
      const cierre = await this.cola.finalizarIntentoSql(entrada, { conexion });
      if (decision.reintentar && fotografia?.estadoAutoridad !== A.VIGENTE) {
        const causa = CAUSA_DESCARTE[fotografia?.estadoAutoridad];
        if (causa) {
          await this.correo.descartarSalidaReintentableEnTransaccion({
            salidaId: referencia.salidaId,
            causa
          }, { conexion });
          return Object.freeze({
            ...cierre,
            estadoSalida: 'descartada',
            postcommit: referencia.clase ===
              CLASES_EMISION_VERIFICACION_EMAIL_PERFIL.INICIAL
              ? postcommitInvalidacion(referencia)
              : null
          });
        }
      }
      if (decision.efectoUsuario ===
          EFECTOS_USUARIO_VERIFICACION_EMAIL_PERFIL
            .ESTABLECER_CANDIDATO_NO_VALIDADO && fotografia?.compatible) {
        await this.usuarios.actualizarEmailNoValidadoEnTransaccion({
          idUsuario: referencia.usuarioId,
          emailActual: fotografia.operacion.emailOrigen,
          emailNuevo: fotografia.operacion.emailCandidato,
          hashPasswordActual: fotografia.usuario.hashPassword
        }, { conexion });
      }
      const invalida = decision.efectoOperacion ===
        EFECTOS_OPERACION_VERIFICACION_EMAIL_PERFIL.INVALIDAR;
      const aceptada = cierre.estadoSalida === 'enviado' &&
        fotografia?.compatible && entrada.aceptadaEnUtc;
      return Object.freeze({
        ...cierre,
        postcommit: invalida
          ? postcommitInvalidacion(referencia)
          : aceptada ? postcommitAceptacion(referencia, entrada.aceptadaEnUtc) : null
      });
    } finally {
      if (bloqueo) {
        await this.operaciones.liberarBloqueoUsuario(
          referencia.usuarioId,
          bloqueo
        ).catch(() => {});
      }
    }
  }

  async aplicarPostcommit(postcommit) {
    if (!postcommit) return Object.freeze({ aplicado: true, omitido: true });
    for (let intento = 0; intento < 2; intento += 1) {
      try {
        if (postcommit.tipo === 'activar_operacion_email_perfil') {
          const activacion = await this.operaciones.activarOperacionTrasAceptacionSmtp(
            postcommit
          );
          if (activacion.estado !== 'activada') throw new Error(activacion.estado);
        } else if (postcommit.tipo === 'renovar_operacion_email_perfil') {
          const renovacion = await this.operaciones.renovarOperacionTrasAceptacionSmtp(
            postcommit
          );
          if (renovacion.estado !== 'renovada') throw new Error(renovacion.estado);
        } else if (postcommit.tipo === 'invalidar_operacion_email_perfil') {
          await this.operaciones.invalidarOperacionUsuario(postcommit.usuarioId, {
            idOperacion: postcommit.operacionEmailPerfilId,
            estado: 'invalidada'
          });
        } else {
          throw new Error('Efecto postcommit de email desconocido.');
        }
        return Object.freeze({ aplicado: true, omitido: false });
      } catch (_errorRedis) {}
    }
    return Object.freeze({
      aplicado: false,
      omitido: false,
      codigo: postcommit.tipo === 'invalidar_operacion_email_perfil'
        ? 'invalidacion_redis_postcommit_pendiente'
        : 'aceptacion_redis_postcommit_pendiente'
    });
  }

  async #esCandidatoDistinto(referencia) {
    try {
      const localizada = await this.operaciones.obtenerOperacionPorId(
        referencia.operacionEmailPerfilId
      );
      return Boolean(localizada.operacion &&
        localizada.operacion.emailCandidato !== localizada.operacion.emailOrigen);
    } catch (_errorRedis) {
      return false;
    }
  }

  async #fotografiarCompatibilidad(referencia, conexion) {
    const estadoAutoridad = await this.#evaluarAutoridad(referencia, conexion);
    if (estadoAutoridad !== A.VIGENTE) return Object.freeze({
      compatible: false,
      estadoAutoridad
    });
    const localizada = await this.operaciones.obtenerOperacionPorId(
      referencia.operacionEmailPerfilId
    );
    const usuario = await this.usuarios.buscarPorIdEnTransaccion(
      referencia.usuarioId,
      { conexion, forUpdate: true }
    );
    return Object.freeze({
      compatible: Boolean(localizada.operacion && usuario),
      estadoAutoridad,
      operacion: localizada.operacion,
      usuario
    });
  }

  async #evaluarAutoridad(referencia, conexion) {
    const localizada = await consultarRedis(() =>
      this.operaciones.obtenerOperacionPorId(referencia.operacionEmailPerfilId)
    );
    if (localizada.estado === 'expirada') return A.OPERACION_EXPIRADA;
    if (!localizada.operacion) {
      const actual = await consultarRedis(() =>
        this.operaciones.obtenerOperacionActual(referencia.usuarioId)
      );
      if (actual.operacion &&
          actual.operacion.idOperacion !== referencia.operacionEmailPerfilId) {
        return A.OPERACION_SUSTITUIDA;
      }
      if (actual.estado === 'expirada') return A.OPERACION_EXPIRADA;
      if (['consumida', 'consumiendo'].includes(actual.estado)) {
        return A.OPERACION_CONSUMIDA;
      }
      return A.PROPOSITO_AGOTADO;
    }
    const operacion = localizada.operacion;
    if (operacion.estado === 'consumiendo') return A.OPERACION_CONSUMIDA;
    const pendienteInicial = referencia.clase ===
      CLASES_EMISION_VERIFICACION_EMAIL_PERFIL.INICIAL &&
      operacion.estado === 'pendiente_aceptacion_smtp';
    if (operacion.estado !== 'activa' && !pendienteInicial) {
      return A.OPERACION_SUSTITUIDA;
    }
    if (String(operacion.idUsuario) !== referencia.usuarioId) {
      return A.IDENTIDAD_DISTINTA;
    }
    if (!vinculoVigente(operacion, referencia)) return A.PROPOSITO_AGOTADO;

    const usuario = await this.usuarios.buscarPorIdEnTransaccion(
      referencia.usuarioId,
      { conexion, forUpdate: true }
    );
    if (!usuario?.activo || !usuario.hashPassword || !usuario.email) {
      return A.IDENTIDAD_NO_VIGENTE;
    }
    if (String(usuario.id) !== referencia.usuarioId) return A.IDENTIDAD_DISTINTA;
    if (usuario.email !== operacion.emailOrigen) return A.CORREO_ORIGEN_CAMBIADO;
    if (!this.operaciones.coincideHuellaCredencial(
      operacion,
      usuario.hashPassword
    )) return A.CREDENCIAL_CAMBIADA;
    if (operacion.emailCandidato !== referencia.emailCandidato) {
      return A.PROPOSITO_AGOTADO;
    }
    if (operacion.emailCandidato === operacion.emailOrigen &&
        usuario.emailValidado) {
      return A.PROPOSITO_AGOTADO;
    }
    return A.VIGENTE;
  }

  async #reintentar(entrada, causa, conexion) {
    await this.cola.liberarReclamacionSql({
      ...identidad(entrada),
      codigo: causa
    }, { conexion });
    return Object.freeze({
      iniciado: false,
      estadoSalida: 'pendiente',
      motivo: causa,
      codigo: causa
    });
  }
}

function vinculoVigente(operacion, referencia) {
  if (referencia.clase === CLASES_EMISION_VERIFICACION_EMAIL_PERFIL.INICIAL) {
    return operacion.emisionInicialId === referencia.emisionEmailPerfilId &&
      String(operacion.salidaInicialId) === referencia.salidaId;
  }
  return Array.isArray(operacion.reenvios) && operacion.reenvios.some(
    (reenvio) => reenvio.emisionId === referencia.emisionEmailPerfilId &&
      String(reenvio.salidaId) === referencia.salidaId
  );
}

function identidad(entrada) {
  return {
    reclamacionId: entrada.reclamacionId,
    salidaId: entrada.salidaId,
    claimId: entrada.claimId,
    leaseToken: entrada.leaseToken,
    propietarioClaim: entrada.propietarioClaim,
    fencingToken: entrada.fencingToken
  };
}

function postcommitInvalidacion(referencia) {
  if (referencia.clase !==
      CLASES_EMISION_VERIFICACION_EMAIL_PERFIL.INICIAL) return null;
  return Object.freeze({
    tipo: 'invalidar_operacion_email_perfil',
    usuarioId: referencia.usuarioId,
    operacionEmailPerfilId: referencia.operacionEmailPerfilId
  });
}

function postcommitAceptacion(referencia, aceptadaEnUtc) {
  return Object.freeze({
    tipo: referencia.clase === CLASES_EMISION_VERIFICACION_EMAIL_PERFIL.INICIAL
      ? 'activar_operacion_email_perfil'
      : 'renovar_operacion_email_perfil',
    usuarioId: referencia.usuarioId,
    operacionEmailPerfilId: referencia.operacionEmailPerfilId,
    emisionEmailPerfilId: referencia.emisionEmailPerfilId,
    salidaId: referencia.salidaId,
    aceptadaEnUtc
  });
}

function exigirMetodo(objeto, metodo) {
  if (typeof objeto?.[metodo] !== 'function') {
    throw new Error(`La coordinación de despacho requiere ${metodo}.`);
  }
}

class ErrorConsultaRedisEmailPerfil extends Error {}

async function consultarRedis(consulta) {
  try {
    return await consulta();
  } catch (error) {
    throw new ErrorConsultaRedisEmailPerfil('Redis no está disponible.', {
      cause: error
    });
  }
}

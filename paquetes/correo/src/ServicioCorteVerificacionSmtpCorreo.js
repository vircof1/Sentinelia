import { CLAVE_LEGACY_VERIFICACION_CORREO }
  from './CatalogoConfiguracionCorreo.js';

export class ServicioCorteVerificacionSmtpCorreo {
  constructor({
    repositorioConfiguracion,
    fronteraTransaccional,
    versionadorConfiguracionRedis
  } = {}) {
    if (!repositorioConfiguracion?.bloquearAutoridadCorreoEnTransaccion ||
        !repositorioConfiguracion?.actualizarValorEnTransaccion ||
        !repositorioConfiguracion?.invalidarEstadoVerificacionCorreoEnTransaccion ||
        !repositorioConfiguracion?.cortarAutoridadVerificacionCorreoEnTransaccion ||
        !repositorioConfiguracion?.incrementarVersionEnTransaccion ||
        !fronteraTransaccional?.ejecutar ||
        !versionadorConfiguracionRedis?.publicarVersion) {
      throw new Error('El corte SMTP requiere autoridad SQL y versión Redis.');
    }
    this.repositorioConfiguracion = repositorioConfiguracion;
    this.fronteraTransaccional = fronteraTransaccional;
    this.versionadorConfiguracionRedis = versionadorConfiguracionRedis;
  }

  async ejecutar({ preparacionUnanime } = {}) {
    if (preparacionUnanime?.unanimidad !== true ||
        typeof preparacionUnanime?.gateAbierto !== 'boolean') {
      throw new Error('La verificación SMTP no puede cortarse sin unanimidad compatible.');
    }
    const resultado = await this.fronteraTransaccional.ejecutar(async (conexion) => {
      const autoridad = await this.repositorioConfiguracion
        .bloquearAutoridadCorreoEnTransaccion({ conexion, modo: 'exclusivo' });
      const estado = autoridad.estadoDespliegue;
      if (String(estado.perfil_objetivo) !== String(preparacionUnanime.perfil)) {
        throw new Error('El perfil unánime no coincide con la cabecera de despliegue.');
      }
      if (['corte_verificacion', 'quietud_cola', 'activado'].includes(estado.estado)) {
        exigirPostcondiciones(estado, autoridad);
        return Object.freeze({
          cambioEfectivo: false,
          versionDurable: autoridad.versionConfiguracion,
          estado: estado.estado,
          requiereReverificacion: Number(autoridad.estadoVerificacion.verificado) !== 1
        });
      }
      exigirPrecondiciones(estado);
      if (esVerdadero(
        autoridad.valores.get(CLAVE_LEGACY_VERIFICACION_CORREO)
      )) {
        await this.repositorioConfiguracion.actualizarValorEnTransaccion(
          CLAVE_LEGACY_VERIFICACION_CORREO,
          'false',
          { conexion }
        );
      }
      await this.repositorioConfiguracion
        .invalidarEstadoVerificacionCorreoEnTransaccion({
          codigo: 'corte_smtp_reverificacion_requerida',
          conexion
        });
      await this.repositorioConfiguracion
        .cortarAutoridadVerificacionCorreoEnTransaccion({ conexion });
      const versionDurable = await this.repositorioConfiguracion
        .incrementarVersionEnTransaccion({ conexion });
      return Object.freeze({
        cambioEfectivo: true,
        versionDurable,
        estado: 'corte_verificacion',
        requiereReverificacion: true
      });
    });
    const versionPublicada = await this.versionadorConfiguracionRedis
      .publicarVersion(resultado.versionDurable);
    return Object.freeze({ ...resultado, versionPublicada });
  }
}

function exigirPrecondiciones(estado) {
  if (estado.estado !== 'corte_origen' ||
      Number(estado.origen_portal_autoritativo) !== 1 ||
      Number(estado.guard_revision_trigger_activo) !== 1 ||
      Number(estado.guard_metadatos_activo) !== 0 ||
      Number(estado.verificacion_smtp_autoritativa) !== 0 ||
      Number(estado.guard_verificacion_legacy_activo) !== 0 ||
      Number(estado.cola_sql_autoritativa) !==
        (estado.estado === 'activado' ? 1 : 0) ||
      Number(estado.tipo_correo_habilitado) !== 0) {
    throw new Error('El corte SMTP exige origen y revisiones ya autoritativos.');
  }
}

function exigirPostcondiciones(estado, autoridad) {
  if (Number(estado.origen_portal_autoritativo) !== 1 ||
      Number(estado.guard_revision_trigger_activo) !== 1 ||
      Number(estado.guard_metadatos_activo) !== 1 ||
      Number(estado.verificacion_smtp_autoritativa) !== 1 ||
      Number(estado.guard_verificacion_legacy_activo) !== 1 ||
      Number(estado.cola_sql_autoritativa) !==
        (estado.estado === 'activado' ? 1 : 0) ||
      !tipoCoherente(estado) ||
      esVerdadero(autoridad.valores.get(CLAVE_LEGACY_VERIFICACION_CORREO))) {
    throw new Error('La autoridad durable de verificación SMTP es incoherente.');
  }
}

function tipoCoherente(estado) {
  return [0, 1].includes(Number(estado.tipo_correo_habilitado)) &&
    (estado.estado === 'activado' || Number(estado.tipo_correo_habilitado) === 0);
}

function esVerdadero(valor) {
  return ['1', 'true', 'si', 'yes', 'on'].includes(
    String(valor ?? '').trim().toLowerCase()
  );
}

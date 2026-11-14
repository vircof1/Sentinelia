export class RepositorioActivacionTriggerCorreoSql {
  async activarTipoEnTransaccion({ conexion } = {}) {
    exigirConexion(conexion);
    const [resultado] = await conexion.execute(
      `UPDATE estado_despliegue_trigger_correo
          SET tipo_correo_habilitado=1, revision=revision+1
        WHERE id=1 AND estado='activado'
          AND guard_metadatos_activo=1 AND origen_portal_autoritativo=1
          AND verificacion_smtp_autoritativa=1
          AND guard_verificacion_legacy_activo=1
          AND guard_revision_trigger_activo=1
          AND cola_sql_autoritativa=1 AND tipo_correo_habilitado=0
          AND quietud_iniciada_en_utc IS NOT NULL
          AND quietud_observada_en_utc IS NOT NULL
          AND activado_en_utc IS NOT NULL`
    );
    if (Number(resultado.affectedRows) !== 1) {
      throw new Error('No se pudo abrir conjuntamente el tipo trigger correo.');
    }
  }
}

export class ServicioActivacionTriggerCorreo {
  constructor({
    repositorioConfiguracion,
    repositorioActivacion = new RepositorioActivacionTriggerCorreoSql(),
    evaluadorAutoridadCorreoSql,
    fronteraTransaccional,
    versionadorConfiguracionRedis
  } = {}) {
    if (!repositorioConfiguracion?.bloquearAutoridadCorreoEnTransaccion ||
        !repositorioConfiguracion?.incrementarVersionEnTransaccion ||
        !repositorioActivacion?.activarTipoEnTransaccion ||
        !evaluadorAutoridadCorreoSql?.evaluarEnTransaccion ||
        !fronteraTransaccional?.ejecutar ||
        !versionadorConfiguracionRedis?.publicarVersion) {
      throw new Error('La activación del trigger correo requiere autoridad SQL completa.');
    }
    this.repositorioConfiguracion = repositorioConfiguracion;
    this.repositorioActivacion = repositorioActivacion;
    this.evaluador = evaluadorAutoridadCorreoSql;
    this.frontera = fronteraTransaccional;
    this.versionador = versionadorConfiguracionRedis;
    this.enCurso = null;
  }

  activar({ preparacionUnanime } = {}) {
    if (this.enCurso) return this.enCurso;
    this.enCurso = this.#activar({ preparacionUnanime })
      .finally(() => { this.enCurso = null; });
    return this.enCurso;
  }

  async #activar({ preparacionUnanime }) {
    if (preparacionUnanime?.unanimidad !== true) {
      throw new Error('El tipo correo no puede abrirse sin unanimidad compatible.');
    }
    const resultado = await this.frontera.ejecutar(async (conexion) => {
      const autoridad = await this.repositorioConfiguracion
        .bloquearAutoridadCorreoEnTransaccion({ conexion, modo: 'exclusivo' });
      const estado = autoridad.estadoDespliegue;
      if (String(estado.perfil_objetivo) !== String(preparacionUnanime.perfil)) {
        throw new Error('El perfil unánime no coincide con la activación de correo.');
      }
      exigirBaseActiva(estado);
      if (Number(estado.tipo_correo_habilitado) === 1) {
        return respuesta(false, 'publicada', autoridad.versionConfiguracion);
      }
      const smtp = await this.evaluador.evaluarEnTransaccion({ conexion });
      if (!smtp.puedeDespachar) {
        return respuesta(false, 'smtp_no_verificado', autoridad.versionConfiguracion, {
          codigo: smtp.codigo
        });
      }
      await this.repositorioActivacion.activarTipoEnTransaccion({ conexion });
      const version = await this.repositorioConfiguracion
        .incrementarVersionEnTransaccion({ conexion });
      return respuesta(true, 'publicada', version);
    });
    if (!resultado.cambioEfectivo) return resultado;
    const publicada = await this.versionador.publicarVersion(resultado.versionDurable);
    return Object.freeze({ ...resultado, versionPublicada: publicada });
  }
}

function exigirBaseActiva(estado) {
  const flags = [
    'guard_metadatos_activo',
    'origen_portal_autoritativo',
    'verificacion_smtp_autoritativa',
    'guard_verificacion_legacy_activo',
    'guard_revision_trigger_activo',
    'cola_sql_autoritativa'
  ];
  if (estado.estado !== 'activado' ||
      flags.some((clave) => Number(estado[clave]) !== 1) ||
      ![0, 1].includes(Number(estado.tipo_correo_habilitado)) ||
      !estado.quietud_iniciada_en_utc || !estado.quietud_observada_en_utc ||
      !estado.activado_en_utc) {
    throw new Error('La activación exige todos los cortes de autoridad demostrados.');
  }
}

function respuesta(cambioEfectivo, fase, versionDurable, detalle = {}) {
  return Object.freeze({ cambioEfectivo, fase, versionDurable, ...detalle });
}

function exigirConexion(conexion) {
  if (typeof conexion?.execute !== 'function') {
    throw new Error('La activación del trigger correo exige una conexión prestada.');
  }
}

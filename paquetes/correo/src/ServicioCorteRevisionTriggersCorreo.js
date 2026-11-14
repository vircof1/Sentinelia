export class RepositorioCorteRevisionTriggersCorreoSql {
  async bloquearDeclaracionesEnTransaccion({ conexion } = {}) {
    exigirConexion(conexion);
    const [filas] = await conexion.execute(
      `SELECT id, revision_declaracion
         FROM triggers
        ORDER BY id ASC
        FOR UPDATE`
    );
    return Object.freeze(filas.map((fila) => Object.freeze({
      id: Number(fila.id),
      revisionDeclaracion: Number(fila.revision_declaracion)
    })));
  }

  async incrementarTodasLasRevisionesEnTransaccion({ conexion } = {}) {
    exigirConexion(conexion);
    const [resultado] = await conexion.execute(
      `UPDATE triggers
          SET revision_declaracion = revision_declaracion + 1`
    );
    return Number(resultado.affectedRows || 0);
  }

  async activarGuardRevisionEnTransaccion({ conexion } = {}) {
    exigirConexion(conexion);
    const [resultado] = await conexion.execute(
      `UPDATE estado_despliegue_trigger_correo
          SET guard_revision_trigger_activo = 1,
              revision = revision + 1
        WHERE id = 1
          AND estado = 'corte_origen'
          AND origen_portal_autoritativo = 1
          AND guard_revision_trigger_activo = 0
          AND guard_metadatos_activo = 0
          AND verificacion_smtp_autoritativa = 0
          AND guard_verificacion_legacy_activo = 0
          AND cola_sql_autoritativa = 0
          AND tipo_correo_habilitado = 0`
    );
    if (Number(resultado.affectedRows) !== 1) {
      throw new Error('No se pudo activar el guard de revisión de triggers.');
    }
  }
}

export class ServicioCorteRevisionTriggersCorreo {
  constructor({
    repositorioConfiguracion,
    repositorioCorte = new RepositorioCorteRevisionTriggersCorreoSql(),
    fronteraTransaccional
  } = {}) {
    if (!repositorioConfiguracion?.bloquearAutoridadCorreoEnTransaccion ||
        !repositorioCorte?.bloquearDeclaracionesEnTransaccion ||
        !repositorioCorte?.incrementarTodasLasRevisionesEnTransaccion ||
        !repositorioCorte?.activarGuardRevisionEnTransaccion ||
        !fronteraTransaccional?.ejecutar) {
      throw new Error('El corte de revisión requiere autoridad SQL transaccional.');
    }
    this.repositorioConfiguracion = repositorioConfiguracion;
    this.repositorioCorte = repositorioCorte;
    this.fronteraTransaccional = fronteraTransaccional;
  }

  ejecutar({ preparacionUnanime } = {}) {
    if (preparacionUnanime?.unanimidad !== true ||
        typeof preparacionUnanime?.gateAbierto !== 'boolean') {
      throw new Error('La revisión no puede cortarse sin unanimidad compatible.');
    }
    return this.fronteraTransaccional.ejecutar(async (conexion) => {
      const autoridad = await this.repositorioConfiguracion
        .bloquearAutoridadCorreoEnTransaccion({ conexion, modo: 'exclusivo' });
      const estado = autoridad.estadoDespliegue;
      if (String(estado.perfil_objetivo) !== String(preparacionUnanime.perfil)) {
        throw new Error('El perfil unánime no coincide con la cabecera de despliegue.');
      }
      exigirOrigenCortado(estado);
      if (Number(estado.guard_revision_trigger_activo) === 1) {
        return Object.freeze({
          cambioEfectivo: false,
          declaracionesInvalidadas: 0,
          estado: 'corte_revision'
        });
      }
      const anteriores = await this.repositorioCorte
        .bloquearDeclaracionesEnTransaccion({ conexion });
      const total = await this.repositorioCorte
        .incrementarTodasLasRevisionesEnTransaccion({ conexion });
      if (total !== anteriores.length) {
        throw new Error('No se invalidaron todas las declaraciones de trigger bloqueadas.');
      }
      await this.repositorioCorte.activarGuardRevisionEnTransaccion({ conexion });
      return Object.freeze({
        cambioEfectivo: true,
        declaracionesInvalidadas: total,
        estado: 'corte_revision'
      });
    });
  }
}

function exigirOrigenCortado(estado) {
  const smtpCortado = ['corte_verificacion', 'quietud_cola', 'activado']
    .includes(estado.estado);
  if (!['corte_origen', 'corte_verificacion', 'quietud_cola', 'activado']
    .includes(estado.estado) ||
      Number(estado.origen_portal_autoritativo) !== 1 ||
      ![0, 1].includes(Number(estado.guard_revision_trigger_activo)) ||
      Number(estado.guard_metadatos_activo) !== (smtpCortado ? 1 : 0) ||
      Number(estado.verificacion_smtp_autoritativa) !== (smtpCortado ? 1 : 0) ||
      Number(estado.guard_verificacion_legacy_activo) !== (smtpCortado ? 1 : 0) ||
      Number(estado.cola_sql_autoritativa) !==
        (estado.estado === 'activado' ? 1 : 0) ||
      !tipoCoherente(estado)) {
    throw new Error('El corte de revisión exige el origen autoritativo y los demás gates cerrados.');
  }
}

function tipoCoherente(estado) {
  return [0, 1].includes(Number(estado.tipo_correo_habilitado)) &&
    (estado.estado === 'activado' || Number(estado.tipo_correo_habilitado) === 0);
}

function exigirConexion(conexion) {
  if (typeof conexion?.execute !== 'function') {
    throw new Error('El corte de revisión exige una conexión prestada.');
  }
}

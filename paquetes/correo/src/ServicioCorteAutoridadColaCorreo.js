export class RepositorioCorteAutoridadColaCorreoSql {
  async fotografiarEnTransaccion({ conexion } = {}) {
    exigirConexion(conexion);
    const [filas] = await conexion.execute(
      `SELECT productor_version, estado, claim_id, propietario_claim, lease_token
         FROM cola_correos_salida
        WHERE (productor_version='legacy'
               AND estado IN ('pendiente','error_reintentable','reclamada','enviando'))
           OR (origen_tipo='trigger' AND productor_version='sql@1'
               AND estado IN ('pendiente','error_reintentable','reclamada','enviando'))
           OR (origen_tipo='trigger' AND (
             estado IN ('reclamada','enviando')
             OR claim_id IS NOT NULL OR propietario_claim IS NOT NULL
             OR lease_token IS NOT NULL
           ))
        ORDER BY id ASC
        FOR UPDATE`
    );
    const [reclamaciones] = await conexion.execute(
      `SELECT r.id FROM reclamaciones_correos_salida r
        INNER JOIN cola_correos_salida s ON s.id=r.salida_correo_id
        WHERE s.origen_tipo='trigger' AND r.estado IN ('reclamada','enviando')
        ORDER BY r.id ASC FOR UPDATE`
    );
    return Object.freeze({
      legacyActivas: filas.filter((fila) => fila.productor_version === 'legacy' &&
        ['pendiente', 'error_reintentable', 'reclamada', 'enviando']
          .includes(fila.estado)).length,
      sqlAnticipadas: filas.filter((fila) => fila.productor_version === 'sql@1' &&
        ['pendiente', 'error_reintentable', 'reclamada', 'enviando']
          .includes(fila.estado)).length,
      propietariosCola: filas.filter((fila) =>
        ['reclamada', 'enviando'].includes(fila.estado) || fila.claim_id ||
        fila.propietario_claim || fila.lease_token).length,
      reclamacionesActivas: reclamaciones.length
    });
  }

  async entrarQuietudEnTransaccion({ fechaUtc, conexion } = {}) {
    exigirConexion(conexion);
    const [resultado] = await conexion.execute(
      `UPDATE estado_despliegue_trigger_correo
          SET estado='quietud_cola', quietud_iniciada_en_utc=?,
              quietud_observada_en_utc=NULL, revision=revision+1
        WHERE id=1 AND estado='corte_verificacion'
          AND guard_metadatos_activo=1 AND origen_portal_autoritativo=1
          AND verificacion_smtp_autoritativa=1
          AND guard_verificacion_legacy_activo=1
          AND guard_revision_trigger_activo=1
          AND cola_sql_autoritativa=0 AND tipo_correo_habilitado=0`,
      [fechaSql(fechaUtc)]
    );
    exigirUna(resultado, 'No se pudo iniciar la quietud de la cola de correo.');
  }

  async marcarQuietudObservadaEnTransaccion({ fechaUtc, conexion } = {}) {
    exigirConexion(conexion);
    const [resultado] = await conexion.execute(
      `UPDATE estado_despliegue_trigger_correo
          SET quietud_observada_en_utc=?, revision=revision+1
        WHERE id=1 AND estado='quietud_cola'
          AND quietud_observada_en_utc IS NULL`,
      [fechaSql(fechaUtc)]
    );
    exigirUna(resultado, 'No se pudo fotografiar el inicio de la ventana de quietud.');
  }

  async reiniciarQuietudObservadaEnTransaccion({ conexion } = {}) {
    exigirConexion(conexion);
    await conexion.execute(
      `UPDATE estado_despliegue_trigger_correo
          SET quietud_observada_en_utc=NULL, revision=revision+1
        WHERE id=1 AND estado='quietud_cola'
          AND quietud_observada_en_utc IS NOT NULL`
    );
  }

  async activarAutoridadSqlEnTransaccion({ fechaUtc, conexion } = {}) {
    exigirConexion(conexion);
    const [resultado] = await conexion.execute(
      `UPDATE estado_despliegue_trigger_correo
          SET estado='activado', cola_sql_autoritativa=1,
              activado_en_utc=?, revision=revision+1
        WHERE id=1 AND estado='quietud_cola'
          AND quietud_observada_en_utc IS NOT NULL
          AND cola_sql_autoritativa=0 AND tipo_correo_habilitado=0`,
      [fechaSql(fechaUtc)]
    );
    exigirUna(resultado, 'No se pudo activar la autoridad SQL de la cola.');
  }
}

export class ServicioCorteAutoridadColaCorreo {
  constructor({
    repositorioConfiguracion,
    repositorioCorte = new RepositorioCorteAutoridadColaCorreoSql(),
    evaluadorAutoridadCorreoSql,
    fronteraTransaccional,
    versionadorConfiguracionRedis,
    ahora = () => new Date()
  } = {}) {
    if (!repositorioConfiguracion?.bloquearAutoridadCorreoEnTransaccion ||
        !repositorioConfiguracion?.incrementarVersionEnTransaccion ||
        !repositorioCorte?.fotografiarEnTransaccion ||
        !evaluadorAutoridadCorreoSql?.evaluarEnTransaccion ||
        !fronteraTransaccional?.ejecutar ||
        !versionadorConfiguracionRedis?.publicarVersion ||
        typeof ahora !== 'function') {
      throw new Error('El corte de cola requiere autoridad, evaluación y tiempo durables.');
    }
    this.repositorioConfiguracion = repositorioConfiguracion;
    this.repositorioCorte = repositorioCorte;
    this.evaluador = evaluadorAutoridadCorreoSql;
    this.frontera = fronteraTransaccional;
    this.versionador = versionadorConfiguracionRedis;
    this.ahora = ahora;
    this.enCurso = null;
  }

  avanzar({ preparacionUnanime } = {}) {
    if (this.enCurso) return this.enCurso;
    this.enCurso = this.#avanzar({ preparacionUnanime })
      .finally(() => { this.enCurso = null; });
    return this.enCurso;
  }

  async #avanzar({ preparacionUnanime }) {
    exigirUnanimidad(preparacionUnanime);
    const ahora = fecha(this.ahora());
    const resultado = await this.frontera.ejecutar(async (conexion) => {
      const autoridad = await this.repositorioConfiguracion
        .bloquearAutoridadCorreoEnTransaccion({ conexion, modo: 'exclusivo' });
      exigirPerfil(autoridad.estadoDespliegue, preparacionUnanime.perfil);
      const estado = autoridad.estadoDespliegue;
      if (estado.estado === 'activado') {
        exigirActivado(estado);
        return respuesta(false, 'activada', autoridad.versionConfiguracion);
      }
      if (estado.estado === 'corte_verificacion') {
        const smtp = await this.evaluador.evaluarEnTransaccion({ conexion });
        if (!smtp.puedeDespachar) {
          return respuesta(false, 'smtp_no_verificado', autoridad.versionConfiguracion);
        }
        await this.repositorioCorte.entrarQuietudEnTransaccion({
          fechaUtc: ahora, conexion
        });
        const version = await this.repositorioConfiguracion
          .incrementarVersionEnTransaccion({ conexion });
        return respuesta(true, 'drenando', version, { quietudIniciadaEnUtc: ahora });
      }
      if (estado.estado !== 'quietud_cola') {
        throw new Error(`La cola no admite el estado de despliegue ${estado.estado}.`);
      }
      const smtp = await this.evaluador.evaluarEnTransaccion({ conexion });
      if (!smtp.puedeDespachar) {
        return respuesta(false, 'smtp_no_verificado', autoridad.versionConfiguracion);
      }
      const fotografia = await this.repositorioCorte
        .fotografiarEnTransaccion({ conexion });
      if (fotografia.sqlAnticipadas > 0) {
        throw new Error('Aparecieron salidas sql@1 antes del corte autoritativo de cola.');
      }
      if (!estaQuieta(fotografia)) {
        await this.repositorioCorte.reiniciarQuietudObservadaEnTransaccion({ conexion });
        const version = estado.quietud_observada_en_utc
          ? await this.repositorioConfiguracion
            .incrementarVersionEnTransaccion({ conexion })
          : autoridad.versionConfiguracion;
        return respuesta(Boolean(estado.quietud_observada_en_utc), 'drenando', version, {
          fotografia
        });
      }
      if (!estado.quietud_observada_en_utc) {
        await this.repositorioCorte.marcarQuietudObservadaEnTransaccion({
          fechaUtc: ahora, conexion
        });
        const version = await this.repositorioConfiguracion
          .incrementarVersionEnTransaccion({ conexion });
        return respuesta(true, 'esperando_quietud', version, {
          fotografia,
          quietudRestanteMs: calcularVentanaMs(autoridad.valores)
        });
      }
      const ventanaMs = calcularVentanaMs(autoridad.valores);
      const transcurrido = ahora.getTime() -
        new Date(estado.quietud_observada_en_utc).getTime();
      if (transcurrido <= ventanaMs) {
        return respuesta(false, 'esperando_quietud', autoridad.versionConfiguracion, {
          fotografia,
          quietudRestanteMs: ventanaMs - transcurrido + 1
        });
      }
      await this.repositorioCorte.activarAutoridadSqlEnTransaccion({
        fechaUtc: ahora, conexion
      });
      const version = await this.repositorioConfiguracion
        .incrementarVersionEnTransaccion({ conexion });
      return respuesta(true, 'activada', version, { fotografia });
    });
    if (resultado.cambioEfectivo) {
      const publicada = await this.versionador.publicarVersion(resultado.versionDurable);
      return Object.freeze({ ...resultado, versionPublicada: publicada });
    }
    return resultado;
  }
}

function calcularVentanaMs(valores) {
  const entero = (clave, defecto = 0) => {
    const valor = Number.parseInt(String(valores.get(clave) ?? defecto), 10);
    return Number.isSafeInteger(valor) && valor >= 0 ? valor : defecto;
  };
  const lock = entero('correo.bloqueo_ttl_segundos', 120) * 1000;
  const smtp = entero('correo.smtp_timeout_conexion_ms') +
    entero('correo.smtp_timeout_saludo_ms') +
    entero('correo.smtp_timeout_socket_ms');
  return Math.max(lock, smtp) + 1000;
}

function estaQuieta(fotografia) {
  return fotografia.legacyActivas === 0 && fotografia.sqlAnticipadas === 0 &&
    fotografia.propietariosCola === 0 &&
    fotografia.reclamacionesActivas === 0;
}

function respuesta(cambioEfectivo, fase, versionDurable, detalle = {}) {
  return Object.freeze({ cambioEfectivo, fase, versionDurable, ...detalle });
}

function exigirUnanimidad(valor) {
  if (valor?.unanimidad !== true || typeof valor?.gateAbierto !== 'boolean') {
    throw new Error('La cola no puede cortarse sin unanimidad compatible.');
  }
}

function exigirPerfil(estado, perfil) {
  if (String(estado.perfil_objetivo) !== String(perfil)) {
    throw new Error('El perfil unánime no coincide con la cabecera de despliegue.');
  }
}

function exigirActivado(estado) {
  if (Number(estado.cola_sql_autoritativa) !== 1 ||
      ![0, 1].includes(Number(estado.tipo_correo_habilitado)) ||
      !estado.quietud_iniciada_en_utc || !estado.quietud_observada_en_utc ||
      !estado.activado_en_utc) {
    throw new Error('La autoridad SQL durable de la cola es incoherente.');
  }
}

function fecha(valor) {
  const resultado = valor instanceof Date ? valor : new Date(valor);
  if (Number.isNaN(resultado.getTime())) throw new Error('El reloj de quietud no es válido.');
  return resultado;
}

function fechaSql(valor) {
  return valor.toISOString().slice(0, 23).replace('T', ' ');
}

function exigirConexion(conexion) {
  if (typeof conexion?.execute !== 'function') {
    throw new Error('El corte de cola exige una conexión prestada.');
  }
}

function exigirUna(resultado, mensaje) {
  if (Number(resultado.affectedRows) !== 1) throw new Error(mensaje);
}

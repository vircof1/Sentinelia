import crypto from 'node:crypto';

export class DespachadorCorreoSql {
  constructor({
    fronteraTransaccional,
    repositorioColaCorreo,
    repositorioRecuperacionPassword = null,
    repositorioReinicioPasswordAdministrativo = null,
    iniciadorVerificacionEmailPerfil = null,
    evaluadorAutoridadCorreoSql,
    clienteSmtp,
    identificadorInstancia = crypto.randomUUID(),
    leaseMilisegundos = 120_000,
    margenConsolidacionMs = 5_000,
    ahora = () => new Date()
  } = {}) {
    if (typeof fronteraTransaccional?.ejecutar !== 'function' ||
        typeof repositorioColaCorreo?.reclamarSiguienteTrigger !== 'function' ||
        typeof evaluadorAutoridadCorreoSql?.evaluarEnTransaccion !== 'function' ||
        typeof clienteSmtp?.enviarIntentoTrigger !== 'function') {
      throw new Error('El despachador SQL de correo requiere sus cuatro fronteras.');
    }
    this.frontera = fronteraTransaccional;
    this.repositorio = repositorioColaCorreo;
    if (repositorioRecuperacionPassword !== null &&
        typeof repositorioRecuperacionPassword?.iniciarIntentoEnTransaccion !==
          'function') {
      throw new Error('El despacho de recuperación no posee revalidación SQL.');
    }
    this.repositorioRecuperacion = repositorioRecuperacionPassword;
    if (repositorioReinicioPasswordAdministrativo !== null &&
        typeof repositorioReinicioPasswordAdministrativo
          ?.iniciarIntentoEnTransaccion !== 'function') {
      throw new Error('El despacho administrativo no posee iniciador SQL.');
    }
    this.repositorioReinicioAdministrativo =
      repositorioReinicioPasswordAdministrativo;
    if (iniciadorVerificacionEmailPerfil !== null &&
        ['iniciarIntentoEnTransaccion', 'finalizarIntentoEnTransaccion',
          'aplicarPostcommit'].some((metodo) =>
          typeof iniciadorVerificacionEmailPerfil?.[metodo] !== 'function')) {
      throw new Error('La verificación de email no posee iniciador coordinado.');
    }
    this.iniciadorVerificacionEmailPerfil = iniciadorVerificacionEmailPerfil;
    this.evaluador = evaluadorAutoridadCorreoSql;
    this.clienteSmtp = clienteSmtp;
    this.identificadorInstancia = propietario(identificadorInstancia);
    this.leaseMilisegundos = enteroPositivo(leaseMilisegundos, 'leaseMilisegundos');
    this.margenConsolidacionMs = enteroNoNegativo(
      margenConsolidacionMs, 'margenConsolidacionMs'
    );
    if (typeof ahora !== 'function') {
      throw new Error('El reloj del despachador no es válido.');
    }
    this.ahora = ahora;
  }

  async despacharSiguiente({ leaseMilisegundos = this.leaseMilisegundos } = {}) {
    const leaseMs = enteroPositivo(leaseMilisegundos, 'leaseMilisegundos');
    const preflight = await this.frontera.ejecutar((conexion) =>
      this.evaluador.evaluarEnTransaccion({ conexion })
    );
    if (!preflight.puedeDespachar) {
      return Object.freeze({ despachado: false, motivo: preflight.codigo });
    }
    const iniciadores = this.#resolverIniciadores();
    const origenesTipo = [...iniciadores.keys()];
    const reclamar = origenesTipo.length > 1 &&
      typeof this.repositorio.reclamarSiguienteSql === 'function'
      ? 'reclamarSiguienteSql'
      : 'reclamarSiguienteTrigger';
    const reclamacion = await this.frontera.ejecutar((conexion) =>
      this.repositorio[reclamar]({
        propietarioClaim: this.identificadorInstancia,
        leaseMilisegundos: leaseMs,
        ...(reclamar === 'reclamarSiguienteSql' ? { origenesTipo } : {})
      }, { conexion })
    );
    if (!reclamacion) {
      return Object.freeze({ despachado: false, motivo: 'sin_salidas_reclamables' });
    }

    const preparacion = await this.frontera.ejecutar(async (conexion) => {
      const autoridad = await this.evaluador.evaluarEnTransaccion({ conexion });
      if (!autoridad.puedeDespachar) {
        await this.#liberarReclamacion({
          ...identidad(reclamacion),
          codigo: autoridad.codigo
        }, { conexion });
        return Object.freeze({ iniciado: false, motivo: autoridad.codigo });
      }
      const margenMinimoLeaseMs = duracionMaximaSmtp(autoridad.configuracion) +
        this.margenConsolidacionMs;
      if (leaseMs <= margenMinimoLeaseMs) {
        await this.#liberarReclamacion({
          ...identidad(reclamacion),
          codigo: 'smtp_lease_insuficiente'
        }, { conexion });
        return Object.freeze({ iniciado: false, motivo: 'smtp_lease_insuficiente' });
      }
      const iniciador = iniciadores.get(reclamacion.salida.origenTipo);
      if (!iniciador) {
        throw new Error('La procedencia reclamada no posee contrato de despacho.');
      }
      const inicio = await iniciador.repositorio[iniciador.metodo]({
        ...identidad(reclamacion),
        configuracionVersion: String(autoridad.versionConfiguracion),
        maxReintentos: autoridad.configuracion.maxReintentos,
        margenMinimoLeaseMs
      }, { conexion });
      return Object.freeze({ ...inicio, autoridad });
    });
    if (!preparacion.iniciado) {
      const convergenciaPostcommit = await this.#aplicarPostcommit(
        reclamacion.salida.origenTipo,
        preparacion.postcommit
      );
      return Object.freeze({
        despachado: false,
        origenTipo: reclamacion.salida.origenTipo,
        motivo: preparacion.motivo || preparacion.codigo,
        codigo: preparacion.codigo || preparacion.motivo || null,
        estadoSalida: preparacion.estadoSalida || reclamacion.salida.estado,
        salidaId: reclamacion.salida.id,
        ...(convergenciaPostcommit ? { convergenciaPostcommit } : {})
      });
    }

    const enviar = typeof this.clienteSmtp.enviarIntentoSql === 'function'
      ? this.clienteSmtp.enviarIntentoSql.bind(this.clienteSmtp)
      : this.clienteSmtp.enviarIntentoTrigger.bind(this.clienteSmtp);
    const resultadoIntento = await enviar(
      {
        ...preparacion.autoridad.configuracion,
        remitenteEmail: preparacion.autoridad.remitenteEmailCanonico ||
          preparacion.autoridad.configuracion.remitenteEmail
      },
      preparacion.salida,
      {
        origenEsperado: reclamacion.salida.origenTipo,
        secretosAdicionales: preparacion.passwordProvisional
          ? [preparacion.passwordProvisional]
          : []
      }
    );
    const aceptadaEnUtc = resultadoIntento?.clasificacion ===
      'aceptacion_demostrada' ? fechaIso(this.ahora()) : null;
    const cierre = await this.frontera.ejecutar((conexion) => {
      const entradaCierre = {
        ...identidad(reclamacion),
        intentoId: preparacion.intento.intentoId,
        resultadoIntento,
        aceptadaEnUtc,
        reintentoBaseSegundos:
          preparacion.autoridad.configuracion.reintentoBaseSegundos
      };
      if (reclamacion.salida.origenTipo === 'verificacion_email_perfil' &&
          typeof this.iniciadorVerificacionEmailPerfil
            ?.finalizarIntentoEnTransaccion === 'function') {
        return this.iniciadorVerificacionEmailPerfil
          .finalizarIntentoEnTransaccion(entradaCierre, { conexion });
      }
      return this.#finalizarIntento(entradaCierre, { conexion });
    });
    const convergenciaPostcommit = await this.#aplicarPostcommit(
      reclamacion.salida.origenTipo,
      cierre.postcommit
    );
    return Object.freeze({
      despachado: cierre.estadoSalida === 'enviado',
      origenTipo: reclamacion.salida.origenTipo,
      estadoSalida: cierre.estadoSalida,
      codigo: cierre.intento.codigo,
      respuestaSaneada: cierre.intento.respuestaSaneada,
      salidaId: reclamacion.salida.id,
      intentoId: preparacion.intento.intentoId,
      ...(convergenciaPostcommit ? { convergenciaPostcommit } : {})
    });
  }

  reconciliarLeasesExpiradas({ limite = 50 } = {}) {
    const metodo = this.repositorioRecuperacion &&
      typeof this.repositorio.reconciliarLeasesExpiradasSql === 'function'
      ? 'reconciliarLeasesExpiradasSql'
      : 'reconciliarLeasesExpiradasTrigger';
    return this.frontera.ejecutar((conexion) =>
      this.repositorio[metodo]({ limite }, { conexion })
    );
  }

  #liberarReclamacion(entrada, { conexion }) {
    const metodo = typeof this.repositorio.liberarReclamacionSql === 'function'
      ? 'liberarReclamacionSql'
      : 'liberarReclamacionTrigger';
    return this.repositorio[metodo](entrada, { conexion });
  }

  #finalizarIntento(entrada, { conexion }) {
    const metodo = typeof this.repositorio.finalizarIntentoSql === 'function'
      ? 'finalizarIntentoSql'
      : 'finalizarIntentoTrigger';
    return this.repositorio[metodo](entrada, { conexion });
  }

  async #aplicarPostcommit(origenTipo, postcommit) {
    if (!postcommit || origenTipo !== 'verificacion_email_perfil') return null;
    return this.iniciadorVerificacionEmailPerfil.aplicarPostcommit(postcommit);
  }

  #resolverIniciadores() {
    const iniciadores = new Map([
      ['trigger', Object.freeze({
        repositorio: this.repositorio,
        metodo: 'iniciarIntentoTrigger'
      })]
    ]);
    if (typeof this.repositorio.iniciarIntentoPrueba === 'function') {
      iniciadores.set('prueba', Object.freeze({
        repositorio: this.repositorio,
        metodo: 'iniciarIntentoPrueba'
      }));
    }
    if (this.repositorioRecuperacion) {
      iniciadores.set('recuperacion_password', Object.freeze({
        repositorio: this.repositorioRecuperacion,
        metodo: 'iniciarIntentoEnTransaccion'
      }));
    }
    if (this.repositorioReinicioAdministrativo) {
      iniciadores.set('reinicio_password_administrativo', Object.freeze({
        repositorio: this.repositorioReinicioAdministrativo,
        metodo: 'iniciarIntentoEnTransaccion'
      }));
    }
    if (this.iniciadorVerificacionEmailPerfil) {
      iniciadores.set('verificacion_email_perfil', Object.freeze({
        repositorio: this.iniciadorVerificacionEmailPerfil,
        metodo: 'iniciarIntentoEnTransaccion'
      }));
    }
    return iniciadores;
  }
}

function identidad(reclamacion) {
  return {
    reclamacionId: reclamacion.reclamacionId,
    salidaId: String(reclamacion.salida.id),
    claimId: reclamacion.claimId,
    leaseToken: reclamacion.leaseToken,
    propietarioClaim: reclamacion.propietarioClaim,
    fencingToken: reclamacion.fencingToken
  };
}

function duracionMaximaSmtp(configuracion) {
  return ['smtpTimeoutConexionMs', 'smtpTimeoutSaludoMs', 'smtpTimeoutSocketMs']
    .reduce((total, clave) => total + enteroNoNegativo(configuracion?.[clave], clave), 0);
}

function propietario(valor) {
  const texto = String(valor ?? '');
  if (!/^[\x21-\x7e]{1,190}$/u.test(texto)) {
    throw new Error('La identidad de instancia SMTP debe ser ASCII visible.');
  }
  return texto;
}

function enteroPositivo(valor, campo) {
  const numero = Number(valor);
  if (!Number.isSafeInteger(numero) || numero < 1) {
    throw new Error(`${campo} debe ser un entero positivo.`);
  }
  return numero;
}

function enteroNoNegativo(valor, campo) {
  const numero = Number(valor);
  if (!Number.isSafeInteger(numero) || numero < 0) {
    throw new Error(`${campo} debe ser un entero no negativo.`);
  }
  return numero;
}

function fechaIso(valor) {
  const fecha = valor instanceof Date ? valor : new Date(valor);
  if (Number.isNaN(fecha.getTime())) {
    throw new Error('El reloj SMTP no devolvió una fecha válida.');
  }
  return fecha.toISOString();
}

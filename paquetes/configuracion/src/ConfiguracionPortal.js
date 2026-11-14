import {
  convertirValorConfiguracion,
  normalizarDefinicionConfiguracion
} from './tiposDatoConfiguracion.js';
import { normalizarConfiguracionFederacion } from '../../federacion/src/index.js';

export class ConfiguracionPortal {
  constructor({
    definiciones,
    valoresPersistidos,
    version,
    origenPublicoPortalAutoritativo = false
  }) {
    this.definiciones = definiciones.map(normalizarDefinicionConfiguracion);
    this.definicionesPorClave = new Map(
      this.definiciones.map((definicion) => [definicion.clave, definicion])
    );
    this.valoresPersistidos = valoresPersistidos;
    this.version = version;
    this.origenPublicoPortalAutoritativo =
      origenPublicoPortalAutoritativo === true;
  }

  obtenerValor(clave) {
    const definicion = this.obtenerDefinicion(clave);

    const valorPersistido = this.valoresPersistidos.get(clave);

    if (valorPersistido === undefined) {
      return this.convertirValor(definicion.valorPorDefecto, definicion);
    }

    return this.convertirValor(valorPersistido, definicion);
  }

  obtenerConfiguracionPow() {
    return {
      activo: this.obtenerValor('pow.activo'),
      redisPrefijo: this.obtenerValor('pow.redis_prefijo'),
      ttlDesafioSegundos: this.obtenerValor('pow.ttl_desafio_segundos'),
      tiempoObjetivoMs: this.obtenerValor('pow.tiempo_objetivo_ms'),
      tiempoMinimoMs: this.obtenerValor('pow.tiempo_minimo_ms'),
      tiempoMaximoMs: this.obtenerValor('pow.tiempo_maximo_ms'),
      ventanaIntentosSegundos: this.obtenerValor('pow.ventana_intentos_segundos'),
      incrementoPorIntentoMs: this.obtenerValor('pow.incremento_por_intento_ms'),
      incrementoPorFalloMs: this.obtenerValor('pow.incremento_por_fallo_ms'),
      costeMinimo: this.obtenerValor('pow.coste_minimo'),
      costeMaximo: this.obtenerValor('pow.coste_maximo'),
      hashratePorDefecto: this.obtenerValor('pow.hashrate_por_defecto'),
      hashrateMinimo: this.obtenerValor('pow.hashrate_minimo'),
      hashrateMaximo: this.obtenerValor('pow.hashrate_maximo'),
      benchmarkClienteMs: this.obtenerValor('pow.benchmark_cliente_ms')
    };
  }

  obtenerNombreVisiblePortal() {
    return this.obtenerValor('portal.nombre_visible');
  }

  obtenerOrigenPublicoPortal() {
    const clave = this.obtenerClaveOrigenPublicoEfectiva();
    return String(this.obtenerValor(clave) || '').trim() || null;
  }

  obtenerClaveOrigenPublicoEfectiva() {
    return this.origenPublicoPortalAutoritativo
      ? 'portal.origen_publico'
      : 'federacion.origen_publico';
  }

  obtenerConfiguracionFederacion() {
    const origenPublico = this.obtenerOrigenPublicoPortal();
    return normalizarConfiguracionFederacion({
      activacionFederacion: this.obtenerValor('federacion.activacion'),
      origenPublico: String(origenPublico || '').trim() || null,
      proxiesConfiables: this.parsearListaTextoConfiguracion(
        this.obtenerValor('federacion.proxies_confiables')
      ),
      toleranciaTemporalMs: this.obtenerValor('federacion.tolerancia_temporal_ms'),
      loteMaximoOcurrencias: this.obtenerValor('federacion.lote_maximo_ocurrencias'),
      loteMaximoBytes: this.obtenerValor('federacion.lote_maximo_bytes'),
      ocurrenciaMaximaBytes: this.obtenerValor('federacion.ocurrencia_maxima_bytes'),
      capacidadReceptoraOcurrencias: this.obtenerValor(
        'federacion.capacidad_receptora_ocurrencias'
      ),
      ttlEstadoOperativoMs: this.obtenerValor('federacion.ttl_estado_operativo_ms'),
      silencioRelacionMs: this.obtenerValor('federacion.silencio_relacion_ms'),
      consolidacionReinicioMs: this.obtenerValor(
        'federacion.consolidacion_reinicio_ms'
      ),
      retencionMaximaDias: this.obtenerValor('federacion.retencion_maxima_dias'),
      keyringReferenciaDespliegue: this.obtenerValor(
        'federacion.keyring_referencia_despliegue'
      )
    });
  }

  tieneDefinicion(clave) {
    return this.definicionesPorClave.has(clave);
  }

  obtenerConfiguracionUsuarios() {
    return {
      passwordLongitudMinima: this.obtenerValor(
        'usuarios.password_longitud_minima'
      ),
      recuperacionEmailActiva: this.obtenerValor(
        'usuarios.recuperacion_email_activa'
      ),
      recuperacionEmailVigenciaSegundos: this.obtenerValor(
        'usuarios.recuperacion_email_vigencia_segundos'
      ),
      recuperacionEmailAlegacionesMaximas: this.obtenerValor(
        'usuarios.recuperacion_email_alegaciones_maximas'
      ),
      recuperacionEmailOrigenVentanaSegundos: this.obtenerValor(
        'usuarios.recuperacion_email_origen_ventana_segundos'
      ),
      recuperacionEmailOrigenIntentosMaximos: this.obtenerValor(
        'usuarios.recuperacion_email_origen_intentos_maximos'
      ),
      recuperacionEmailParVentanaSegundos: this.obtenerValor(
        'usuarios.recuperacion_email_par_ventana_segundos'
      ),
      recuperacionEmailParIntentosMaximos: this.obtenerValor(
        'usuarios.recuperacion_email_par_intentos_maximos'
      ),
      recuperacionEmailGlobalVentanaSegundos: this.obtenerValor(
        'usuarios.recuperacion_email_global_ventana_segundos'
      ),
      recuperacionEmailGlobalIntentosMaximos: this.obtenerValor(
        'usuarios.recuperacion_email_global_intentos_maximos'
      ),
      recuperacionEmailJitterMaximoMs: this.obtenerValor(
        'usuarios.recuperacion_email_jitter_maximo_ms'
      ),
      recuperacionEmailLeasePreparacionSegundos: this.obtenerValor(
        'usuarios.recuperacion_email_lease_preparacion_segundos'
      ),
      recuperacionEmailLeaseAlegacionSegundos: this.obtenerValor(
        'usuarios.recuperacion_email_lease_alegacion_segundos'
      ),
      recuperacionEmailLeaseConsumoSegundos: this.obtenerValor(
        'usuarios.recuperacion_email_lease_consumo_segundos'
      )
    };
  }

  obtenerConfiguracionDns() {
    return {
      activo: this.obtenerValor('dns.activo'),
      listenOn: this.parsearListaTextoConfiguracion(
        this.obtenerValor('dns.listen_on')
      ),
      listenOnV6: this.parsearListaTextoConfiguracion(
        this.obtenerValor('dns.listen_on_v6')
      ),
      allowQuery: this.parsearListaTextoConfiguracion(
        this.obtenerValor('dns.allow_query')
      ),
      recursion: this.obtenerValor('dns.recursion'),
      forwardersHabilitados: this.obtenerValor('dns.forwarders_habilitados'),
      forwarders: this.parsearListaTextoConfiguracion(
        this.obtenerValor('dns.forwarders')
      )
    };
  }

  obtenerConfiguracionAuditoria() {
    return {
      retencionDias: this.obtenerValor('auditoria.retencion_dias')
    };
  }

  obtenerConfiguracionMonitores() {
    return {
      compactacionCercaFalloPorcentaje: this.obtenerValor(
        'monitores.compactacion_cerca_fallo_porcentaje'
      ),
      compactacionSerieVariacionPorcentaje: this.obtenerValor(
        'monitores.compactacion_serie_variacion_porcentaje'
      ),
      retencionEventosDias: this.obtenerValor(
        'monitores.retencion_eventos_dias'
      ),
      runtimeBloqueoTtlSegundos: this.obtenerValor(
        'monitores.runtime_bloqueo_ttl_segundos'
      )
    };
  }

  obtenerConfiguracionAgentes() {
    return {
      sessionTtlSegundos: this.obtenerValor('agentes.session_ttl_segundos'),
      heartbeatIntervalSegundos: this.obtenerValor(
        'agentes.heartbeat_interval_segundos'
      ),
      heartbeatGraceSegundos: this.obtenerValor(
        'agentes.heartbeat_grace_segundos'
      ),
      loginFallosMaximos: this.obtenerValor('agentes.login_fallos_maximos'),
      cuarentenaSegundos: this.obtenerValor('agentes.cuarentena_segundos')
    };
  }

  obtenerConfiguracionCorreo() {
    return {
      activo: this.obtenerValor('correo.activo'),
      operativoVerificado: this.obtenerValor('correo.operativo_verificado'),
      smtpHost: this.obtenerValor('correo.smtp_host'),
      smtpPuerto: this.obtenerValor('correo.smtp_puerto'),
      smtpSecure: this.obtenerValor('correo.smtp_secure'),
      smtpUsuario: this.obtenerValor('correo.smtp_usuario'),
      smtpPassword: this.obtenerValor('correo.smtp_password'),
      smtpAuthMethod: this.obtenerValor('correo.smtp_auth_method'),
      smtpTimeoutConexionMs: this.obtenerValor('correo.smtp_timeout_conexion_ms'),
      smtpTimeoutSaludoMs: this.obtenerValor('correo.smtp_timeout_saludo_ms'),
      smtpTimeoutSocketMs: this.obtenerValor('correo.smtp_timeout_socket_ms'),
      smtpTlsPermitirInseguro: this.obtenerValor(
        'correo.smtp_tls_permitir_inseguro'
      ),
      remitenteEmail: this.obtenerValor('correo.remitente_email'),
      remitenteNombre: this.obtenerValor('correo.remitente_nombre'),
      maxReintentos: this.obtenerValor('correo.max_reintentos'),
      reintentoBaseSegundos: this.obtenerValor('correo.reintento_base_segundos'),
      bloqueoTtlSegundos: this.obtenerValor('correo.bloqueo_ttl_segundos'),
      runtimeLoteMaximo: this.obtenerValor('correo.runtime_lote_maximo'),
      desuscripcionTtlDias: this.obtenerValor('correo.desuscripcion_ttl_dias'),
      destinatariosTriggerMaximos: this.obtenerValor(
        'correo.destinatarios_trigger_maximos'
      ),
      retencionSalidasDias: this.obtenerValor('correo.retencion_salidas_dias')
    };
  }

  obtenerDefinicion(clave) {
    const definicion = this.definicionesPorClave.get(clave);

    if (!definicion) {
      throw new Error(`No existe definición de configuración para ${clave}.`);
    }

    return definicion;
  }

  listarEntradas() {
    return this.definiciones.map((definicion) => {
      const valorPersistido = this.valoresPersistidos.get(definicion.clave);
      const usaValorPorDefecto = valorPersistido === undefined;
      const valorReal = usaValorPorDefecto
        ? definicion.valorPorDefecto
        : valorPersistido;
      const valorBrutoReal = valorReal == null ? '' : String(valorReal);
      const valorBruto = definicion.esSecreto ? '' : valorBrutoReal;

      return {
        clave: definicion.clave,
        tipoDato: definicion.tipoDato,
        tipoEntrada: definicion.tipoEntrada,
        opciones: definicion.opciones,
        minimo: definicion.minimo ?? null,
        maximo: definicion.maximo ?? null,
        placeholder: definicion.placeholder,
        esSecreto: definicion.esSecreto,
        editable: this.esDefinicionEditable(definicion),
        visibleEnListado: this.esDefinicionVisible(definicion),
        requerido: definicion.requerido,
        descripcion: definicion.descripcion,
        valorBruto,
        valorInterpretado: definicion.esSecreto
          ? null
          : this.convertirValor(valorReal, definicion),
        valorPorDefecto: definicion.esSecreto
          ? null
          : this.convertirValor(definicion.valorPorDefecto, definicion),
        valorPorDefectoBruto: definicion.esSecreto
          ? ''
          : definicion.valorPorDefecto == null
            ? ''
            : String(definicion.valorPorDefecto),
        valorVisible: this.obtenerValorVisible(definicion, valorBrutoReal),
        valorPorDefectoVisible: this.obtenerValorVisible(
          definicion,
          definicion.valorPorDefecto
        ),
        mensajeOculto: definicion.mensajeOculto,
        tieneValor: valorBrutoReal.length > 0,
        usaValorPorDefecto
      };
    }).filter((definicion) => definicion.visibleEnListado);
  }

  esDefinicionEditable(definicion) {
    if (definicion.clave === 'portal.origen_publico') {
      return this.origenPublicoPortalAutoritativo;
    }
    if (definicion.clave === 'federacion.origen_publico') {
      return !this.origenPublicoPortalAutoritativo;
    }
    return definicion.editable;
  }

  esDefinicionVisible(definicion) {
    if (definicion.clave === 'portal.origen_publico') {
      return this.origenPublicoPortalAutoritativo;
    }
    if (definicion.clave === 'federacion.origen_publico') {
      return !this.origenPublicoPortalAutoritativo;
    }
    return definicion.visibleEnListado;
  }

  obtenerValorVisible(definicion, valor) {
    if (definicion.esSecreto) {
      return String(valor ?? '').length > 0
        ? definicion.mensajeOculto
        : 'No definido';
    }

    return String(valor ?? '');
  }

  convertirValor(valor, definicion) {
    return convertirValorConfiguracion(valor, definicion);
  }

  parsearListaTextoConfiguracion(valor) {
    return String(valor ?? '')
      .split(/[\n,]+/g)
      .map((item) => item.trim())
      .filter(Boolean);
  }
}

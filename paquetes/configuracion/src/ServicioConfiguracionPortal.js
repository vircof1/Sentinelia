import crypto from 'node:crypto';

import { ConfiguracionPortal } from './ConfiguracionPortal.js';
import {
  normalizarDefinicionConfiguracion,
  normalizarValorConfiguracionPersistible
} from './tiposDatoConfiguracion.js';
import { generarUuidV7Auditoria } from '../../auditoria/src/UuidV7Auditoria.js';
import { PERFIL_JCS_AUDITORIA_V1 } from '../../auditoria/src/PerfilJcsAuditoria.js';
import { VERSION_ENCADENADO_AUDITORIA_V1 } from '../../auditoria/src/SobreCanonicoAuditoria.js';
import {
  CLAVE_LEGACY_VERIFICACION_CORREO,
  validarCatalogosConfiguracionCorreo
} from '../../correo/src/CatalogoConfiguracionCorreo.js';
import {
  crearProveedorCompatibilidadRecuperacionPasswordEmailCerrado,
  exigirCompatibilidadRecuperacionPasswordEmail
} from '../../usuarios/src/ProveedorCompatibilidadRecuperacionPasswordEmail.js';

const CLAVE_CORREO_OPERATIVO_VERIFICADO = CLAVE_LEGACY_VERIFICACION_CORREO;
const CLAVE_RETENCION_AUDITORIA = 'auditoria.retencion_dias';
const CLAVE_RECUPERACION_PASSWORD_EMAIL_ACTIVA =
  'usuarios.recuperacion_email_activa';
const CLAVES_BIND_DESPLIEGUE = new Set([
  'dns.ruta_include_gestionado',
  'dns.directorio_zonas',
  'dns.comando_recarga',
  'dns.comando_checkconf',
  'dns.comando_checkzone'
]);

export class ServicioConfiguracionPortal {
  constructor({
    repositorioConfiguracion,
    versionadorConfiguracionRedis,
    definiciones,
    fronteraTransaccional,
    servicioAuditoria,
    perfilSmtpCorreo = null,
    proveedorCompatibilidadRecuperacionPasswordEmail =
      crearProveedorCompatibilidadRecuperacionPasswordEmailCerrado(),
    ahora = () => new Date()
  }) {
    if (!repositorioConfiguracion?.bloquearValorEnTransaccion ||
        !repositorioConfiguracion?.actualizarValorEnTransaccion ||
        !repositorioConfiguracion?.sincronizarDefinicionesEnTransaccion ||
        !repositorioConfiguracion?.obtenerVersionEnTransaccion ||
        !repositorioConfiguracion?.incrementarVersionEnTransaccion ||
        !versionadorConfiguracionRedis?.obtenerVersionActual ||
        !versionadorConfiguracionRedis?.publicarVersion ||
        !fronteraTransaccional?.ejecutar ||
        !servicioAuditoria?.registrarEnTransaccion || typeof ahora !== 'function') {
      throw new Error('La configuración auditable requiere todos sus puertos.');
    }
    this.repositorioConfiguracion = repositorioConfiguracion;
    this.perfilSmtpCorreo = perfilSmtpCorreo;
    this.versionadorConfiguracionRedis = versionadorConfiguracionRedis;
    this.proveedorCompatibilidadRecuperacionPasswordEmail =
      proveedorCompatibilidadRecuperacionPasswordEmail;
    this.definiciones = definiciones.map(normalizarDefinicionConfiguracion);
    this.catalogoCorreoPreparado = this.definiciones.some(
      (definicion) => definicion.participaAdmisionCorreo || definicion.invalidaPruebaSmtp
    );
    if (this.catalogoCorreoPreparado) {
      validarCatalogosConfiguracionCorreo(this.definiciones);
      if (!repositorioConfiguracion?.bloquearAutoridadCorreoEnTransaccion ||
          !repositorioConfiguracion?.cargarEstadoDespliegueCorreo ||
          !repositorioConfiguracion?.cargarMetadatosCorreoEnTransaccion ||
          !repositorioConfiguracion?.invalidarEstadoVerificacionCorreoEnTransaccion ||
          !repositorioConfiguracion?.promoverEstadoVerificacionCorreoEnTransaccion) {
        throw new Error('La configuración de correo preparada requiere autoridad SQL coherente.');
      }
    }
    if (this.definiciones.some(({ clave }) => clave === 'federacion.activacion')) {
      new ConfiguracionPortal({
        definiciones: this.definiciones,
        valoresPersistidos: new Map(this.definiciones.map((definicion) => [
          definicion.clave,
          definicion.valorPorDefecto
        ])),
        version: 0
      }).obtenerConfiguracionFederacion();
    }
    const definicionBind = this.definiciones.find(({ clave }) =>
      CLAVES_BIND_DESPLIEGUE.has(clave) || clave.startsWith('BIND_')
    );
    if (definicionBind) {
      throw new Error(
        `La clave ${definicionBind.clave} pertenece al despliegue BIND y no al portal.`
      );
    }
    this.fronteraTransaccional = fronteraTransaccional;
    this.servicioAuditoria = servicioAuditoria;
    this.ahora = ahora;
    this.configuracionActual = null;
    this.versionActual = null;
    this.clavesCreadasBootstrap = [];
    this.estadoDespliegueCorreoActual = null;
  }

  // auditoria-productor: bootstrap.configuracion_portal
  async bootstrapYcargar() {
    const resultado = await this.#sincronizar({ bootstrap: true });
    this.clavesCreadasBootstrap = resultado.clavesCreadas;
    const version = await this.#publicarVersion(resultado.versionDurable);
    const configuracionPortal = await this.cargarDesdePersistencia(version);
    return {
      configuracionPortal,
      version: this.versionActual,
      clavesCreadas: resultado.clavesCreadas
    };
  }

  obtenerConfiguracionActual() {
    if (!this.configuracionActual) {
      throw new Error('La configuración del portal aún no está cargada.');
    }
    return this.configuracionActual;
  }

  obtenerVersionActual() {
    return this.versionActual;
  }

  obtenerEstadoDespliegueCorreoActual() {
    return this.estadoDespliegueCorreoActual;
  }

  async asegurarActualizada() {
    const versionRedis =
      await this.versionadorConfiguracionRedis.obtenerVersionActual();
    if (!versionRedis) {
      const versionDurable = await this.fronteraTransaccional.ejecutar(
        (conexion) => this.repositorioConfiguracion
          .obtenerVersionEnTransaccion({ conexion })
      );
      const publicada = await this.#publicarVersion(versionDurable);
      return this.cargarDesdePersistencia(publicada);
    }
    if (Number(versionRedis) !== Number(this.versionActual)) {
      return this.cargarDesdePersistencia(versionRedis);
    }
    return this.configuracionActual;
  }

  async listarConfiguraciones() {
    await this.asegurarActualizada();
    return this.obtenerConfiguracionActual().listarEntradas();
  }

  actualizarValor({ clave, valor, contextoUsuarioActual } = {}) {
    return this.#cambiarValor({
      clave,
      valor,
      contextoUsuarioActual,
      tipo: 'configuracion.portal_actualizada'
    });
  }

  restablecerValorPorDefecto(clave, contextoUsuarioActual) {
    const definicion = this.obtenerDefinicion(clave);
    return this.#cambiarValor({
      clave,
      valor: definicion.valorPorDefecto,
      contextoUsuarioActual,
      tipo: 'configuracion.portal_restablecida'
    });
  }

  async marcarCorreoOperativoVerificado(contextoUsuarioActual) {
    autorizarClave(CLAVE_CORREO_OPERATIVO_VERIFICADO, contextoUsuarioActual);
    const identidad = crearIdentidad(this.ahora());
    const actor = crearActorUsuario(contextoUsuarioActual);
    const resultado = await this.fronteraTransaccional.ejecutar(async (conexion) => {
      const autoridadCorreo = this.catalogoCorreoPreparado
        ? await this.repositorioConfiguracion
          .bloquearAutoridadCorreoEnTransaccion({ conexion, modo: 'exclusivo' })
        : null;
      const fila = autoridadCorreo?.valores.has(CLAVE_CORREO_OPERATIVO_VERIFICADO)
        ? { valor: autoridadCorreo.valores.get(CLAVE_CORREO_OPERATIVO_VERIFICADO) }
        : await this.repositorioConfiguracion.bloquearValorEnTransaccion(
          CLAVE_CORREO_OPERATIVO_VERIFICADO,
          { conexion }
        );
      if (!fila) throw new Error('No existe el estado de correo operativo.');
      if (normalizarBooleano(fila.valor) === true) {
        const versionDurable = autoridadCorreo?.versionConfiguracion ??
          await this.repositorioConfiguracion.obtenerVersionEnTransaccion({ conexion });
        return Object.freeze({ cambioEfectivo: false, versionDurable });
      }
      await this.repositorioConfiguracion.actualizarValorEnTransaccion(
        CLAVE_CORREO_OPERATIVO_VERIFICADO,
        'true',
        { conexion }
      );
      await this.servicioAuditoria.registrarEnTransaccion({
        cambioEfectivo: true,
        intencion: crearEventoBase({
          tipo: 'configuracion.correo_operativo_verificado',
          identidad,
          actor,
          origen: 'web',
          productor: 'portal_web',
          rolEvento: 'resultado',
          payload: {
            sistemaDestino: 'smtp',
            resultado: 'verificado',
            codigo: null,
            versionRecurso: null,
            resumen: null
          }
        })
      }, { conexion });
      const versionDurable = await this.repositorioConfiguracion
        .incrementarVersionEnTransaccion({ conexion });
      return Object.freeze({ cambioEfectivo: true, versionDurable });
    });
    const version = await this.#publicarVersion(resultado.versionDurable);
    await this.cargarDesdePersistencia(version);
    return resultado;
  }

  async promoverCorreoSmtpVerificado({ pruebaToken, contextoUsuarioActual } = {}) {
    autorizarClave(CLAVE_CORREO_OPERATIVO_VERIFICADO, contextoUsuarioActual);
    if (!this.catalogoCorreoPreparado || !this.perfilSmtpCorreo) {
      throw errorCorreo(
        'La promoción smtp@1 no está disponible en esta presencia.',
        'correo_perfil_smtp_no_disponible',
        409
      );
    }
    const esperada = normalizarPruebaTokenSmtp(pruebaToken);
    const identidad = crearIdentidad(this.ahora());
    const actor = crearActorUsuario(contextoUsuarioActual);
    const resultado = await this.fronteraTransaccional.ejecutar(async (conexion) => {
      const autoridad = await this.repositorioConfiguracion
        .bloquearAutoridadCorreoEnTransaccion({ conexion, modo: 'exclusivo' });
      if (Number(autoridad.estadoDespliegue.verificacion_smtp_autoritativa) !== 1 ||
          Number(autoridad.estadoDespliegue.guard_verificacion_legacy_activo) !== 1) {
        throw errorCorreo(
          'La verificación smtp@1 permanece cerrada por el perfil de despliegue.',
          'correo_verificacion_smtp_no_autoritativa',
          409
        );
      }
      if (normalizarBooleano(
        autoridad.valores.get(CLAVE_CORREO_OPERATIVO_VERIFICADO)
      )) {
        throw errorCorreo(
          'El corte SMTP no retiró la autoridad legacy antes de habilitar smtp@1.',
          'correo_verificacion_legacy_aun_activa',
          409
        );
      }
      let actual;
      try {
        actual = this.perfilSmtpCorreo.crearPruebaConKeyId(
          autoridad.valores,
          esperada.keyId
        );
      } catch {
        throw errorCorreo(
          'La clave de la prueba SMTP ya no está disponible.',
          'correo_clave_hmac_ausente',
          409
        );
      }
      if (actual.perfilVersion !== esperada.perfilSmtp ||
          actual.perfilBuzon !== esperada.perfilBuzon ||
          !crypto.timingSafeEqual(actual.huellaHmac, esperada.huellaHmac)) {
        throw errorCorreo(
          'La configuración de correo cambió después de emitir la prueba.',
          'correo_prueba_smtp_obsoleta',
          409
        );
      }
      const estadoAnterior = autoridad.estadoVerificacion;
      const yaPromovida = Number(estadoAnterior.verificado) === 1 &&
        estadoAnterior.perfil_version === actual.perfilVersion &&
        estadoAnterior.key_id === actual.keyId &&
        huellasIguales(estadoAnterior.huella_hmac, actual.huellaHmac);
      if (yaPromovida) {
        return Object.freeze({
          cambioEfectivo: false,
          versionDurable: autoridad.versionConfiguracion,
          perfilVersion: actual.perfilVersion,
          keyId: actual.keyId
        });
      }
      await this.repositorioConfiguracion
        .promoverEstadoVerificacionCorreoEnTransaccion({
          perfilVersion: actual.perfilVersion,
          huellaHmac: actual.huellaHmac,
          keyId: actual.keyId,
          configuracionVersion: autoridad.versionConfiguracion,
          usuarioId: contextoUsuarioActual.idUsuarioReal,
          conexion
        });
      await this.servicioAuditoria.registrarEnTransaccion({
        cambioEfectivo: true,
        intencion: crearEventoBase({
          tipo: 'configuracion.correo_operativo_verificado',
          identidad,
          actor,
          origen: 'web',
          productor: 'portal_web',
          rolEvento: 'resultado',
          payload: {
            sistemaDestino: 'smtp',
            resultado: 'verificado',
            codigo: null,
            versionRecurso: null,
            resumen: null
          }
        })
      }, { conexion });
      const versionDurable = await this.repositorioConfiguracion
        .incrementarVersionEnTransaccion({ conexion });
      return Object.freeze({
        cambioEfectivo: true,
        versionDurable,
        perfilVersion: actual.perfilVersion,
        keyId: actual.keyId
      });
    });
    const version = await this.#publicarVersion(resultado.versionDurable);
    await this.cargarDesdePersistencia(version);
    return resultado;
  }

  async sincronizarDefiniciones(contextoUsuarioActual) {
    const resultado = await this.#sincronizar({ contextoUsuarioActual });
    this.clavesCreadasBootstrap = [
      ...new Set([...this.clavesCreadasBootstrap, ...resultado.clavesCreadas])
    ];
    const version = await this.#publicarVersion(resultado.versionDurable);
    await this.cargarDesdePersistencia(version);
    return {
      clavesCreadas: resultado.clavesCreadas,
      version: this.versionActual
    };
  }

  construirResumenEstado() {
    return {
      version: this.versionActual,
      totalClaves: this.obtenerConfiguracionActual().listarEntradas().length,
      clavesCreadas: [...this.clavesCreadasBootstrap]
    };
  }

  async cargarDesdePersistencia(version) {
    const [valoresPersistidos, estadoDespliegueCorreo] = await Promise.all([
      this.repositorioConfiguracion.cargarValores(),
      this.catalogoCorreoPreparado
        ? this.repositorioConfiguracion.cargarEstadoDespliegueCorreo()
        : Promise.resolve(null)
    ]);
    const configuracion = new ConfiguracionPortal({
      definiciones: this.definiciones,
      valoresPersistidos,
      version,
      origenPublicoPortalAutoritativo:
        Number(estadoDespliegueCorreo?.origen_portal_autoritativo) === 1
    });
    if (configuracion.tieneDefinicion('federacion.activacion')) {
      configuracion.obtenerConfiguracionFederacion();
    }
    this.configuracionActual = configuracion;
    this.versionActual = Number(version);
    this.estadoDespliegueCorreoActual = estadoDespliegueCorreo;
    return this.configuracionActual;
  }

  obtenerDefinicion(clave) {
    const definicion = this.definiciones.find((item) => item.clave === clave);
    if (!definicion) {
      throw new Error(`No existe definición de configuración para ${clave}.`);
    }
    return definicion;
  }

  normalizarValorPersistible(definicion, valor) {
    return normalizarValorConfiguracionPersistible(valor, definicion);
  }

  async #cambiarValor({ clave, valor, contextoUsuarioActual, tipo }) {
    const definicion = this.obtenerDefinicion(clave);
    if (!this.esDefinicionEditable(definicion)) {
      throw new Error(`La clave ${definicion.clave} pertenece al despliegue y no es editable.`);
    }
    autorizarClave(definicion.clave, contextoUsuarioActual);
    const valorNormalizado = this.normalizarValorPersistible(definicion, valor);
    if (
      definicion.clave === CLAVE_RECUPERACION_PASSWORD_EMAIL_ACTIVA &&
      normalizarBooleano(valorNormalizado)
    ) {
      await exigirCompatibilidadRecuperacionPasswordEmail(
        this.proveedorCompatibilidadRecuperacionPasswordEmail
      );
    }
    const identidad = crearIdentidad(this.ahora());
    const actor = crearActorUsuario(contextoUsuarioActual);
    const resultado = await this.fronteraTransaccional.ejecutar(async (conexion) => {
      const participaAutoridadCorreo =
        definicion.participaAdmisionCorreo || definicion.invalidaPruebaSmtp;
      const autoridadCorreo = participaAutoridadCorreo
        ? await this.repositorioConfiguracion
          .bloquearAutoridadCorreoEnTransaccion({ conexion, modo: 'exclusivo' })
        : null;
      const valoresFederacion = !autoridadCorreo && definicion.clave.startsWith('federacion.')
        ? await cargarValoresFederacionBloqueados({
            repositorioConfiguracion: this.repositorioConfiguracion,
            conexion
          })
        : null;
      const actual = autoridadCorreo
        ? autoridadCorreo.valores.has(definicion.clave) ? {
            clave: definicion.clave,
            valor: autoridadCorreo.valores.get(definicion.clave),
            tipo_dato: definicion.tipoDato
          } : null
        : valoresFederacion
        ? valoresFederacion.has(definicion.clave) ? {
            clave: definicion.clave,
            valor: valoresFederacion.get(definicion.clave),
            tipo_dato: definicion.tipoDato
          } : null
        : await this.repositorioConfiguracion
          .bloquearValorEnTransaccion(definicion.clave, { conexion });
      if (!actual) {
        throw new Error(`No existe la clave de configuración ${definicion.clave}.`);
      }
      if (valoresPersistidosIguales(actual.valor, valorNormalizado)) {
        const versionDurable = autoridadCorreo?.versionConfiguracion ??
          await this.repositorioConfiguracion.obtenerVersionEnTransaccion({ conexion });
        return Object.freeze({ cambioEfectivo: false, versionDurable });
      }
      if (valoresFederacion) {
        valoresFederacion.set(definicion.clave, valorNormalizado);
        new ConfiguracionPortal({
          definiciones: this.definiciones,
          valoresPersistidos: valoresFederacion,
          version: this.versionActual
        }).obtenerConfiguracionFederacion();
      }
      const cambios = [{
        definicion,
        antes: actual.valor,
        despues: valorNormalizado
      }];
      await this.repositorioConfiguracion.actualizarValorEnTransaccion(
        definicion.clave,
        valorNormalizado,
        { conexion }
      );
      const invalidaPruebaSmtp = definicion.invalidaPruebaSmtp ||
        (!this.catalogoCorreoPreparado &&
          definicion.clave.startsWith('correo.') &&
          definicion.clave !== CLAVE_CORREO_OPERATIVO_VERIFICADO);
      if (invalidaPruebaSmtp) {
        const correoValor = autoridadCorreo
          ? autoridadCorreo.valores.get(CLAVE_CORREO_OPERATIVO_VERIFICADO)
          : (await this.repositorioConfiguracion.bloquearValorEnTransaccion(
            CLAVE_CORREO_OPERATIVO_VERIFICADO,
            { conexion }
          ))?.valor;
        if (normalizarBooleano(correoValor)) {
          const definicionCorreo = this.obtenerDefinicion(
            CLAVE_CORREO_OPERATIVO_VERIFICADO
          );
          await this.repositorioConfiguracion.actualizarValorEnTransaccion(
            CLAVE_CORREO_OPERATIVO_VERIFICADO,
            'false',
            { conexion }
          );
          cambios.push({
            definicion: definicionCorreo,
            antes: correoValor,
            despues: 'false'
          });
        }
        if (autoridadCorreo) {
          await this.repositorioConfiguracion
            .invalidarEstadoVerificacionCorreoEnTransaccion({
              codigo: 'configuracion_smtp_modificada',
              usuarioId: contextoUsuarioActual.idUsuarioReal,
              conexion
            });
        }
      }
      await this.servicioAuditoria.registrarEnTransaccion({
        cambioEfectivo: true,
        intencion: crearEventoCambio({
          tipo,
          cambios,
          identidad,
          actor,
          origen: 'web',
          productor: 'portal_web'
        })
      }, { conexion });
      const versionDurable = await this.repositorioConfiguracion
        .incrementarVersionEnTransaccion({ conexion });
      return Object.freeze({ cambioEfectivo: true, versionDurable });
    });
    const version = await this.#publicarVersion(resultado.versionDurable);
    await this.cargarDesdePersistencia(version);
    return {
      clave: definicion.clave,
      valor: definicion.esSecreto ? null : valorNormalizado,
      version: this.versionActual,
      cambioEfectivo: resultado.cambioEfectivo
    };
  }

  async #sincronizar({ contextoUsuarioActual = null, bootstrap = false } = {}) {
    if (!bootstrap) autorizarClave('portal.nombre_visible', contextoUsuarioActual);
    const identidad = crearIdentidad(this.ahora());
    const actor = bootstrap
      ? crearActorSistema()
      : crearActorUsuario(contextoUsuarioActual);
    return this.fronteraTransaccional.ejecutar(async (conexion) => {
      const creadas = await this.repositorioConfiguracion
        .sincronizarDefinicionesEnTransaccion(this.definiciones, { conexion });
      if (this.catalogoCorreoPreparado) {
        await this.repositorioConfiguracion
          .cargarMetadatosCorreoEnTransaccion({ conexion });
      }
      if (creadas.length === 0) {
        const versionDurable = await this.repositorioConfiguracion
          .obtenerVersionEnTransaccion({ conexion });
        return Object.freeze({
          cambioEfectivo: false,
          clavesCreadas: [],
          versionDurable
        });
      }
      const cambios = creadas.map(({ clave, valor }) => ({
        definicion: this.obtenerDefinicion(clave),
        antes: null,
        despues: valor
      }));
      await this.servicioAuditoria.registrarEnTransaccion({
        cambioEfectivo: true,
        intencion: crearEventoCambio({
          tipo: 'configuracion.portal_sincronizada',
          cambios,
          identidad,
          actor,
          origen: bootstrap ? 'bootstrap' : 'web',
          productor: bootstrap ? 'bootstrap' : 'portal_web'
        })
      }, { conexion });
      const versionDurable = await this.repositorioConfiguracion
        .incrementarVersionEnTransaccion({ conexion });
      return Object.freeze({
        cambioEfectivo: true,
        clavesCreadas: Object.freeze(creadas.map(({ clave }) => clave)),
        versionDurable
      });
    });
  }

  async #publicarVersion(versionDurable) {
    return this.versionadorConfiguracionRedis.publicarVersion(versionDurable);
  }

  esDefinicionEditable(definicion) {
    if (!this.configuracionActual) return definicion.editable !== false;
    return this.configuracionActual.esDefinicionEditable(definicion);
  }
}

function crearEventoCambio({ tipo, cambios, identidad, actor, origen, productor }) {
  const proyecciones = cambios.map(proyectarCambioSeguro);
  const porCampo = new Map();
  for (const cambio of proyecciones) porCampo.set(cambio.campo, cambio);
  const camposCambiados = [...porCampo.keys()].sort(compararUtf8);
  const antes = {};
  const despues = {};
  for (const campo of camposCambiados) {
    const cambio = porCampo.get(campo);
    antes[campo] = cambio.antes;
    despues[campo] = cambio.despues;
  }
  return crearEventoBase({
    tipo,
    identidad,
    actor,
    origen,
    productor,
    rolEvento: 'principal',
    payload: { resultado: 'actualizado', camposCambiados, antes, despues }
  });
}

function crearEventoBase({ tipo, identidad, actor, origen, productor, rolEvento, payload }) {
  return {
    eventoId: identidad.eventoId,
    tipo,
    versionContrato: 1,
    flujo: 'sistema',
    claveCadena: 'sistema:portal',
    actorReal: actor.real,
    actorEfectivo: actor.efectivo,
    modoActuacion: actor.modo,
    sujeto: { tipo: 'configuracion_portal', id: 'portal' },
    origen,
    scope: { tenantId: null, empresaId: null, sitioId: null },
    correlacionId: identidad.correlacionId,
    causalidad: null,
    productor,
    claveOperacion: identidad.claveOperacion,
    rolEvento,
    efectivoEnUtc: identidad.efectivoEnUtc,
    versionCanonicalizador: PERFIL_JCS_AUDITORIA_V1,
    versionEncadenado: VERSION_ENCADENADO_AUDITORIA_V1,
    payload
  };
}

function proyectarCambioSeguro({ definicion, antes, despues }) {
  if (definicion.clave === 'correo.smtp_usuario') {
    return {
      campo: 'correo.smtp_usuarioConfigurado',
      antes: valorConfigurado(antes),
      despues: valorConfigurado(despues)
    };
  }
  if (definicion.clave === 'correo.smtp_password') {
    return {
      campo: 'correo.smtp_claveConfigurada',
      antes: valorConfigurado(antes),
      despues: valorConfigurado(despues)
    };
  }
  if (definicion.esSecreto) {
    throw new Error(`La clave secreta ${definicion.clave} no tiene proyección auditable.`);
  }
  return {
    campo: definicion.clave,
    antes: convertirAuditable(antes, definicion),
    despues: convertirAuditable(despues, definicion)
  };
}

function convertirAuditable(valor, definicion) {
  if (valor === null || valor === undefined) return null;
  if (definicion.tipoDato === 'booleano') return normalizarBooleano(valor);
  if (['entero', 'entero_nulable', 'puerto'].includes(definicion.tipoDato)) {
    return Number(valor);
  }
  return String(valor);
}

function crearIdentidad(valorFecha) {
  const fecha = valorFecha instanceof Date ? valorFecha : new Date(valorFecha);
  if (Number.isNaN(fecha.getTime())) throw new Error('El reloj de configuración no es válido.');
  return Object.freeze({
    eventoId: generarUuidV7Auditoria(),
    correlacionId: generarUuidV7Auditoria(),
    claveOperacion: generarUuidV7Auditoria(),
    efectivoEnUtc: fecha.toISOString()
  });
}

function crearActorUsuario(contexto) {
  const real = { tipo: 'usuario', id: idDecimal(contexto?.idUsuarioReal, 'actor real') };
  const efectivoId = idDecimal(contexto?.idUsuario, 'actor efectivo');
  const efectivo = real.id === efectivoId ? null : { tipo: 'usuario', id: efectivoId };
  return Object.freeze({
    real: Object.freeze(real),
    efectivo: efectivo ? Object.freeze(efectivo) : null,
    modo: efectivo ? 'impersonado' : 'directo'
  });
}

function crearActorSistema() {
  return Object.freeze({
    real: Object.freeze({ tipo: 'sistema', id: 'sentinelia-system' }),
    efectivo: null,
    modo: 'directo'
  });
}

function autorizarClave(clave, contexto) {
  if (!contexto || contexto.nivelScope !== 'portal') {
    throw new Error('La configuración global exige alcance portal.');
  }
  if (!contexto.permisos?.administrarConfiguracion) {
    throw new Error('La configuración global exige administrarConfiguracion.');
  }
  if (clave === CLAVE_RETENCION_AUDITORIA && !contexto.permisos?.verAuditoria) {
    throw new Error('La política de retención exige el permiso verAuditoria.');
  }
}

function valoresPersistidosIguales(a, b) {
  if (a == null || b == null) return a == null && b == null;
  return String(a) === String(b);
}

function valorConfigurado(valor) {
  return String(valor ?? '').length > 0;
}

function normalizarBooleano(valor) {
  return ['1', 'true', 'si', 'yes', 'on'].includes(String(valor).toLowerCase());
}

function normalizarPruebaTokenSmtp(prueba) {
  const perfilSmtp = String(prueba?.perfilSmtp || '');
  const perfilBuzon = String(prueba?.perfilBuzon || '');
  const keyId = String(prueba?.keyId || '');
  const huellaHex = String(prueba?.huellaConfiguracion || '');
  if (perfilSmtp !== 'smtp@1' || perfilBuzon !== 'buzon@1' ||
      !/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/u.test(keyId) ||
      !/^[0-9a-f]{64}$/u.test(huellaHex)) {
    throw errorCorreo(
      'La prueba SMTP no pertenece al perfil vigente.',
      'correo_prueba_smtp_invalida',
      400
    );
  }
  return Object.freeze({
    perfilSmtp,
    perfilBuzon,
    keyId,
    huellaHmac: Buffer.from(huellaHex, 'hex')
  });
}

function huellasIguales(a, b) {
  const izquierda = Buffer.isBuffer(a) ? Buffer.from(a) : null;
  return izquierda?.length === 32 && Buffer.isBuffer(b) && b.length === 32 &&
    crypto.timingSafeEqual(izquierda, b);
}

function errorCorreo(mensaje, codigo, statusCode) {
  return Object.assign(new Error(mensaje), { codigo, statusCode });
}

function idDecimal(valor, nombre) {
  const texto = String(valor ?? '');
  if (!/^[1-9][0-9]*$/.test(texto)) throw new Error(`${nombre} debe ser un id decimal positivo.`);
  return texto;
}

function compararUtf8(a, b) {
  return Buffer.compare(Buffer.from(a, 'utf8'), Buffer.from(b, 'utf8'));
}

async function cargarValoresFederacionBloqueados({
  repositorioConfiguracion,
  conexion
}) {
  if (typeof repositorioConfiguracion.cargarValoresEnTransaccion !== 'function') {
    throw new Error(
      'La configuración federada exige bloquear su conjunto completo antes de cambiarlo.'
    );
  }
  return repositorioConfiguracion.cargarValoresEnTransaccion({ conexion });
}

import session from 'express-session';
import RedisStore from 'connect-redis';
import { randomBytes } from 'node:crypto';
import { SesionWebNoVigente } from './ServicioSesionesWebDurables.js';
import { generarUuidV7Auditoria } from '../../auditoria/src/UuidV7Auditoria.js';
import { PERFIL_JCS_AUDITORIA_V1 } from '../../auditoria/src/PerfilJcsAuditoria.js';
import { VERSION_ENCADENADO_AUDITORIA_V1 } from '../../auditoria/src/SobreCanonicoAuditoria.js';

const DESTINO_CONFIRMACION_EMAIL = '/mi-perfil/email/confirmar';
const DESTINO_RECUPERACION_PASSWORD = '/recuperacion-password/continuar';
const SCRIPT_SINCRONIZAR_VERSION_MONOTONICA = `
local nueva = ARGV[1]
local actual = redis.call('GET', KEYS[1])
if not actual or string.len(nueva) > string.len(actual) or
   (string.len(nueva) == string.len(actual) and nueva > actual) then
  redis.call('SET', KEYS[1], nueva)
  return nueva
end
return actual
`;

export class ServicioSesion {
  constructor({
    clienteRedis,
    configuracionSesion,
    configuracionRedis,
    servicioSesionesWebDurables = null,
    repositorioPreautenticaciones = null
  }) {
    this.clienteRedis = clienteRedis;
    this.configuracionSesion = configuracionSesion;
    this.configuracionRedis = configuracionRedis;
    this.servicioSesionesWebDurables = servicioSesionesWebDurables;
    this.repositorioPreautenticaciones = repositorioPreautenticaciones;
  }

  crearMiddlewareSesion() {
    const store = new RedisStore({
      client: this.clienteRedis,
      prefix: this.configuracionRedis.prefijoSesiones
    });

    return session({
      store,
      name: this.configuracionSesion.nombreCookie,
      secret: this.configuracionSesion.secreto,
      resave: false,
      saveUninitialized: false,
      rolling: false,
      cookie: {
        httpOnly: true,
        sameSite: 'lax',
        secure: false,
        maxAge: this.configuracionSesion.maxAgeMs
      }
    });
  }

  async crearSesionUsuario(requisicion, usuario) {
    const tokenCSRF = this.generarTokenCSRF();

    return this.guardarSesionAutenticada(
      requisicion,
      this.construirSesionAutenticada({
        usuarioReal: usuario,
        usuarioEfectivo: usuario,
        impersonacionActiva: false,
        tokenCSRF
      }),
      { regenerar: true }
    );
  }

  async crearSesionCambioPasswordPendiente(requisicion, usuario) {
    await this.sincronizarVersionUsuario(usuario.id, usuario.versionSesion);
    const continuacionEmailPerfil = this.normalizarContinuacionEmailPerfil(
      requisicion.session?.continuacionEmailPerfil
    );
    const preautenticacion = this.repositorioPreautenticaciones
      ? await this.repositorioPreautenticaciones.crear({
          usuarioId: usuario.id,
          datos: {
            usuarioCambioPassword: {
              idUsuario: Number(usuario.id),
              usuario: usuario.usuario,
              nombreVisible: usuario.obtenerNombreVisible(),
              versionSesion: Number(usuario.versionSesion)
            },
            continuacionEmailPerfil
          }
        })
      : null;

    return new Promise((resolve, reject) => {
      requisicion.session.regenerate((error) => {
        if (error) {
          reject(error);
          return;
        }

        requisicion.session.tokenCSRF = this.generarTokenCSRF();
        requisicion.session.usuarioCambioPassword = preautenticacion
          ? {
              preautenticacionId: preautenticacion.preautenticacionId,
              idUsuario: Number(usuario.id),
              usuario: usuario.usuario,
              nombreVisible: usuario.obtenerNombreVisible(),
              versionSesion: Number(usuario.versionSesion),
              expiraEnUtc: preautenticacion.expiraEnUtc
            }
          : {
              idUsuario: usuario.id,
              usuario: usuario.usuario,
              nombreVisible: usuario.obtenerNombreVisible(),
              versionSesion: usuario.versionSesion
            };
        if (continuacionEmailPerfil) {
          requisicion.session.continuacionEmailPerfil = continuacionEmailPerfil;
        }

        requisicion.session.save((errorGuardado) => {
          if (errorGuardado) {
            reject(errorGuardado);
            return;
          }

          resolve();
        });
      });
    });
  }

  async destruirSesion(requisicion) {
    if (!requisicion.session) {
      return;
    }

    const storeId = this.obtenerStoreIdAuditable(requisicion);
    const preautenticacionId =
      requisicion.session.usuarioCambioPassword?.preautenticacionId ?? null;

    if (storeId && this.servicioSesionesWebDurables) {
      try {
        await this.servicioSesionesWebDurables.cerrar(storeId);
      } catch (error) {
        if (!(error instanceof SesionWebNoVigente)) {
          throw error;
        }
      }
    }

    if (preautenticacionId && this.repositorioPreautenticaciones) {
      await this.repositorioPreautenticaciones.eliminar(preautenticacionId);
    }

    return new Promise((resolve, reject) => {
      requisicion.session.destroy((error) => {
        if (error) {
          reject(error);
          return;
        }

        resolve();
      });
    }).catch(async (error) => {
      if (preautenticacion?.preautenticacionId && this.repositorioPreautenticaciones) {
        await this.repositorioPreautenticaciones.eliminar(
          preautenticacion.preautenticacionId
        ).catch(() => {});
      }
      throw error;
    });
  }

  async validarVersionSesion(requisicion) {
    if (this.servicioSesionesWebDurables) {
      return this.validarSesionDurable(requisicion);
    }

    return this.validarVersionContraRedis(
      requisicion.session?.usuarioAutenticado ?? null
    );
  }

  async validarVersionSesionCambioPassword(requisicion) {
    const pendiente = requisicion.session?.usuarioCambioPassword ?? null;
    const preautenticacionId = pendiente?.preautenticacionId ?? null;
    if (preautenticacionId && this.repositorioPreautenticaciones) {
      const estado =
        await this.repositorioPreautenticaciones.obtener(preautenticacionId);
      const usuarioPendiente =
        estado?.datos?.usuarioCambioPassword ?? null;
      if (!usuarioPendiente) {
        return false;
      }
      requisicion.session.usuarioCambioPassword = {
        ...pendiente,
        ...usuarioPendiente,
        preautenticacionId,
        expiraEnUtc: estado.expiraEnUtc
      };
      return this.validarVersionContraRedis(usuarioPendiente);
    }

    return this.validarVersionContraRedis(
      pendiente
    );
  }

  async consumirSesionCambioPasswordPendiente(requisicion, idUsuarioEsperado) {
    const preautenticacionId =
      requisicion.session?.usuarioCambioPassword?.preautenticacionId ?? null;
    if (!preautenticacionId || !this.repositorioPreautenticaciones) {
      return requisicion.session?.usuarioCambioPassword ?? null;
    }
    const estado =
      await this.repositorioPreautenticaciones.consumir(preautenticacionId);
    const usuarioPendiente =
      estado?.datos?.usuarioCambioPassword ?? null;
    if (
      !usuarioPendiente ||
      Number(usuarioPendiente.idUsuario) !== Number(idUsuarioEsperado)
    ) {
      throw new Error('La preautenticación de cambio obligatorio ya no es válida.');
    }
    return usuarioPendiente;
  }

  async sincronizarVersionUsuario(idUsuario, versionSesion) {
    const version = versionSesionDecimal(versionSesion);
    const clave = this.obtenerClaveVersionUsuario(idUsuario);
    if (typeof this.clienteRedis.eval !== 'function') {
      if (typeof this.clienteRedis.get !== 'function') {
        // Adaptadores mínimos de pruebas históricas; el cliente productivo usa Lua.
        await this.clienteRedis.set(clave, version);
        return version;
      }
      const actual = await this.clienteRedis.get(clave);
      if (!actual || compararVersionesDecimales(version, actual) > 0) {
        await this.clienteRedis.set(clave, version);
        return version;
      }
      return String(actual);
    }
    return String(await this.clienteRedis.eval(
      SCRIPT_SINCRONIZAR_VERSION_MONOTONICA,
      {
        keys: [clave],
        arguments: [version]
      }
    ));
  }

  async asegurarVersionUsuarioDisponible(idUsuario, versionSesion) {
    const clave = this.obtenerClaveVersionUsuario(idUsuario);
    const esperada = String(versionSesion);
    await this.clienteRedis.set(clave, esperada, { NX: true });
    const vigente = await this.clienteRedis.get(clave);

    if (vigente !== esperada) {
      const error = new Error(
        'La versión de sesión del usuario objetivo cambió; vuelve a cargarlo antes de impersonar.'
      );
      error.codigo = 'VERSION_SESION_USUARIO_OBJETIVO_CAMBIADA';
      error.codigoHttp = 409;
      throw error;
    }

    return true;
  }

  construirSesionAutenticada({
    usuarioReal,
    usuarioEfectivo = usuarioReal,
    impersonacionActiva = false,
    tokenCSRF = null
  }) {
    const identidadReal = usuarioReal || usuarioEfectivo;
    const identidadEfectiva = usuarioEfectivo || usuarioReal;
    const activa = Boolean(
      impersonacionActiva ||
      Number(identidadReal?.id) !== Number(identidadEfectiva?.id)
    );

    return {
      idUsuario: identidadEfectiva.id,
      usuario: identidadEfectiva.usuario,
      nombreVisible: identidadEfectiva.obtenerNombreVisible(),
      versionSesion: identidadEfectiva.versionSesion,
      idUsuarioEfectivo: identidadEfectiva.id,
      usuarioEfectivo: identidadEfectiva.usuario,
      nombreVisibleEfectivo: identidadEfectiva.obtenerNombreVisible(),
      versionSesionEfectiva: identidadEfectiva.versionSesion,
      idUsuarioReal: identidadReal.id,
      usuarioReal: identidadReal.usuario,
      nombreVisibleReal: identidadReal.obtenerNombreVisible(),
      versionSesionReal: identidadReal.versionSesion,
      impersonacionActiva: activa,
      tenantId: identidadEfectiva.tenantId ?? null,
      empresaId: identidadEfectiva.empresaId ?? null,
      sitioId: identidadEfectiva.sitioId ?? null,
      tokenCSRF: this.normalizarTokenCSRF(tokenCSRF)
    };
  }

  normalizarSesionAutenticada(usuarioSesion) {
    if (!usuarioSesion) {
      return null;
    }

    const idUsuarioEfectivo =
      usuarioSesion.idUsuarioEfectivo ?? usuarioSesion.idUsuario ?? null;
    const versionSesionEfectiva =
      usuarioSesion.versionSesionEfectiva ?? usuarioSesion.versionSesion ?? null;
    const idUsuarioReal =
      usuarioSesion.idUsuarioReal ?? idUsuarioEfectivo;
    const versionSesionReal =
      usuarioSesion.versionSesionReal ?? versionSesionEfectiva;
    const usuarioEfectivo =
      usuarioSesion.usuarioEfectivo ?? usuarioSesion.usuario ?? null;
    const nombreVisibleEfectivo =
      usuarioSesion.nombreVisibleEfectivo ?? usuarioSesion.nombreVisible ?? null;
    const usuarioReal =
      usuarioSesion.usuarioReal ?? usuarioEfectivo;
    const nombreVisibleReal =
      usuarioSesion.nombreVisibleReal ?? nombreVisibleEfectivo;
    const impersonacionActiva = Boolean(
      usuarioSesion.impersonacionActiva ||
      Number(idUsuarioReal) !== Number(idUsuarioEfectivo)
    );
    const tokenCSRF = this.normalizarTokenCSRF(usuarioSesion.tokenCSRF);

    if (!idUsuarioEfectivo || !versionSesionEfectiva || !idUsuarioReal || !versionSesionReal) {
      return null;
    }

    return {
      ...usuarioSesion,
      idUsuario: idUsuarioEfectivo,
      usuario: usuarioEfectivo,
      nombreVisible: nombreVisibleEfectivo,
      versionSesion: versionSesionEfectiva,
      idUsuarioEfectivo,
      usuarioEfectivo,
      nombreVisibleEfectivo,
      versionSesionEfectiva,
      idUsuarioReal,
      usuarioReal,
      nombreVisibleReal,
      versionSesionReal,
      impersonacionActiva,
      tokenCSRF
    };
  }

  async guardarSesionAutenticada(
    requisicion,
    sesionAutenticada,
    { regenerar = false } = {}
  ) {
    const continuacionEmailPerfil = this.normalizarContinuacionEmailPerfil(
      requisicion.session?.continuacionEmailPerfil
    );
    const tokenSesionActual = this.normalizarTokenCSRF(
      requisicion.session?.usuarioAutenticado?.tokenCSRF
    );
    const tokenCSRF =
      this.normalizarTokenCSRF(sesionAutenticada?.tokenCSRF) ||
      tokenSesionActual ||
      this.generarTokenCSRF();
    const sesionNormalizada = this.normalizarSesionAutenticada({
      ...sesionAutenticada,
      tokenCSRF
    });

    if (!sesionNormalizada) {
      throw new Error('No se pudo construir la sesión autenticada.');
    }

    const versiones = [
      {
        idUsuario: sesionNormalizada.idUsuarioReal,
        versionSesion: sesionNormalizada.versionSesionReal
      },
      {
        idUsuario: sesionNormalizada.idUsuarioEfectivo,
        versionSesion: sesionNormalizada.versionSesionEfectiva
      }
    ];

    for (const version of this.deduplicarVersionesSesion(versiones)) {
      await this.sincronizarVersionUsuario(
        version.idUsuario,
        version.versionSesion
      );
    }

    if (!this.servicioSesionesWebDurables) {
      const asignarYSalvar = () => new Promise((resolve, reject) => {
        requisicion.session.tokenCSRF = sesionNormalizada.tokenCSRF;
        requisicion.session.usuarioAutenticado = sesionNormalizada;
        if (continuacionEmailPerfil) {
          requisicion.session.continuacionEmailPerfil = continuacionEmailPerfil;
        }
        requisicion.session.save((errorGuardado) => {
          if (errorGuardado) {
            reject(errorGuardado);
            return;
          }

          resolve();
        });
      });

      if (!regenerar) {
        await asignarYSalvar();
        return;
      }

      await new Promise((resolve, reject) => {
        requisicion.session.regenerate((error) => {
          if (error) {
            reject(error);
            return;
          }

          resolve();
        });
      });

      await asignarYSalvar();
      return;
    }

    const abrirYSalvar = async () => {
      const resultado = await this.servicioSesionesWebDurables.abrir({
        usuarioId: sesionNormalizada.idUsuarioReal,
        versionSesion: sesionNormalizada.versionSesionReal,
        scope: scopeDesdeSesion(sesionNormalizada),
        datosStore: {
          tokenCSRF: sesionNormalizada.tokenCSRF
        }
      });
      requisicion.session.sesionWebAuditable = {
        storeId: resultado.storeId
      };
      requisicion.session.tokenCSRF = sesionNormalizada.tokenCSRF;
      requisicion.session.usuarioAutenticado = sesionNormalizada;
      delete requisicion.session.usuarioCambioPassword;
      if (continuacionEmailPerfil) {
        requisicion.session.continuacionEmailPerfil = continuacionEmailPerfil;
      }
      try {
        await this.guardarSesionExpress(requisicion);
      } catch (errorGuardado) {
        try {
          await this.servicioSesionesWebDurables.cerrar(resultado.storeId);
        } catch {}
        throw errorGuardado;
      }
    };

    if (!regenerar) {
      const storeAnterior = this.obtenerStoreIdAuditable(requisicion);
      if (storeAnterior) {
        const sesionActual = await this.servicioSesionesWebDurables.validar(
          storeAnterior
        );
        const sesionDurable = sesionActual.sesion;
        const mismaReal =
          sesionDurable.usuarioRealId === String(sesionNormalizada.idUsuarioReal);
        if (mismaReal) {
          const resultado = await this.servicioSesionesWebDurables.renovarExplicita(
            storeAnterior,
            { validarEstadoActual: () => true }
          );
          requisicion.session.sesionWebAuditable = {
            storeId: resultado.storeId
          };
          requisicion.session.tokenCSRF = sesionNormalizada.tokenCSRF;
          requisicion.session.usuarioAutenticado = sesionNormalizada;
          if (continuacionEmailPerfil) {
            requisicion.session.continuacionEmailPerfil = continuacionEmailPerfil;
          }
          await this.guardarSesionExpress(requisicion);
          return;
        }
        await this.servicioSesionesWebDurables.cerrar(storeAnterior);
      }
      await abrirYSalvar();
      return;
    }

    await new Promise((resolve, reject) => {
      requisicion.session.regenerate((error) => {
        if (error) {
          reject(error);
          return;
        }

        resolve();
      });
    });

    await abrirYSalvar();
  }

  async validarSesionDurable(requisicion) {
    const storeId = this.obtenerStoreIdAuditable(requisicion);
    if (!storeId || !requisicion.session?.usuarioAutenticado) {
      return false;
    }

    try {
      const actual = await this.servicioSesionesWebDurables.validar(storeId, {
        validarEstadoActual: async (sesion) => {
          if (!fotografiaSesionCoincide(requisicion.session.usuarioAutenticado, sesion)) {
            return false;
          }
          return this.validarVersionContraRedis(
            requisicion.session.usuarioAutenticado
          );
        }
      });
      requisicion.sesionWebAuditoria = actual.sesion;
      return true;
    } catch (error) {
      if (!(error instanceof SesionWebNoVigente)) {
        throw error;
      }
      return false;
    }
  }

  async renovarSesionExplicita(requisicion) {
    const storeId = this.obtenerStoreIdAuditable(requisicion);
    if (!storeId || !this.servicioSesionesWebDurables) {
      return false;
    }
    const resultado = await this.servicioSesionesWebDurables.renovarExplicita(
      storeId,
      {
        validarEstadoActual: async () =>
          this.validarVersionContraRedis(
            requisicion.session?.usuarioAutenticado ?? null
          )
      }
    );
    requisicion.session.sesionWebAuditable = { storeId: resultado.storeId };
    await this.guardarSesionExpress(requisicion);
    return true;
  }

  obtenerStoreIdAuditable(requisicion) {
    const valor = requisicion.session?.sesionWebAuditable?.storeId;
    return typeof valor === 'string' && valor.trim() ? valor.trim() : null;
  }

  async iniciarImpersonacionUsuario(requisicion, { usuarioReal, usuarioEfectivo }) {
    const sesionActual = this.normalizarSesionAutenticada(
      requisicion.session?.usuarioAutenticado
    );

    if (sesionActual?.impersonacionActiva) {
      throw new Error(
        'No se permite encadenar impersonaciones sobre una sesión ya impersonada.'
      );
    }

    if (
      sesionActual?.idUsuarioReal != null &&
      Number(sesionActual.idUsuarioReal) !== Number(usuarioReal.id)
    ) {
      throw new Error('La identidad real de la sesión no coincide con la solicitada.');
    }

    const storeId = this.obtenerStoreIdAuditable(requisicion);
    if (this.servicioSesionesWebDurables && storeId) {
      const actual = await this.servicioSesionesWebDurables.validar(storeId);
      await this.asegurarVersionUsuarioDisponible(
        usuarioEfectivo.id,
        usuarioEfectivo.versionSesion
      );
      const sesionNueva = this.construirSesionAutenticada({
        usuarioReal,
        usuarioEfectivo,
        impersonacionActiva: true,
        tokenCSRF: sesionActual?.tokenCSRF
      });
      const intencionAuditoria = this.construirIntencionImpersonacion({
        tipo: 'usuario.impersonacion_iniciada',
        sesion: actual.sesion,
        usuarioEfectivo,
        scope: scopeDesdeUsuario(usuarioEfectivo),
        causalidad: null
      });
      const resultado = await this.servicioSesionesWebDurables.iniciarImpersonacion(
        storeId,
        {
          usuarioEfectivoId: usuarioEfectivo.id,
          versionSesionReal: usuarioReal.versionSesion,
          versionSesionEfectiva: usuarioEfectivo.versionSesion,
          scopeEfectivoActual: scopeDesdeUsuario(usuarioEfectivo),
          intencionAuditoria
        }
      );
      requisicion.session.sesionWebAuditable = { storeId: resultado.storeId };
      requisicion.session.usuarioAutenticado = sesionNueva;
      requisicion.session.tokenCSRF = sesionNueva.tokenCSRF;
      try {
        await this.guardarSesionExpress(requisicion);
      } catch (errorGuardado) {
        try {
          await this.servicioSesionesWebDurables.cerrar(resultado.storeId);
        } catch {}
        throw errorGuardado;
      }
      return;
    }

    return this.guardarSesionAutenticada(
      requisicion,
      this.construirSesionAutenticada({
        usuarioReal,
        usuarioEfectivo,
        impersonacionActiva: true,
        tokenCSRF: sesionActual?.tokenCSRF
      })
    );
  }

  async revertirImpersonacionUsuario(requisicion, usuarioReal) {
    const sesionActual = this.normalizarSesionAutenticada(
      requisicion.session?.usuarioAutenticado
    );

    if (
      sesionActual?.idUsuarioReal != null &&
      Number(sesionActual.idUsuarioReal) !== Number(usuarioReal.id)
    ) {
      throw new Error('La identidad real de la sesión no coincide con la solicitada.');
    }

    const storeId = this.obtenerStoreIdAuditable(requisicion);
    if (this.servicioSesionesWebDurables && storeId) {
      const actual = await this.servicioSesionesWebDurables.validar(storeId);
      const sesionNueva = this.construirSesionAutenticada({
        usuarioReal,
        usuarioEfectivo: usuarioReal,
        impersonacionActiva: false,
        tokenCSRF: sesionActual?.tokenCSRF
      });
      const intencionAuditoria = this.construirIntencionImpersonacion({
        tipo: 'usuario.impersonacion_finalizada',
        sesion: actual.sesion,
        usuarioEfectivo: {
          id: actual.sesion.usuarioEfectivoId
        },
        scope: actual.sesion.scopeEfectivoActual,
        causalidad: {
          tipo: 'evento_auditoria',
          id: actual.sesion.eventoImpersonacionIniciadaId
        }
      });
      const resultado = await this.servicioSesionesWebDurables.finalizarImpersonacion(
        storeId,
        {
          versionSesionReal: usuarioReal.versionSesion,
          scopeEfectivoActual: scopeDesdeUsuario(usuarioReal),
          intencionAuditoria
        }
      );
      requisicion.session.sesionWebAuditable = { storeId: resultado.storeId };
      requisicion.session.usuarioAutenticado = sesionNueva;
      requisicion.session.tokenCSRF = sesionNueva.tokenCSRF;
      try {
        await this.guardarSesionExpress(requisicion);
      } catch (errorGuardado) {
        try {
          await this.servicioSesionesWebDurables.cerrar(resultado.storeId);
        } catch {}
        throw errorGuardado;
      }
      return;
    }

    return this.guardarSesionAutenticada(
      requisicion,
      this.construirSesionAutenticada({
        usuarioReal,
        usuarioEfectivo: usuarioReal,
        impersonacionActiva: false,
        tokenCSRF: sesionActual?.tokenCSRF
      })
    );
  }

  construirIntencionImpersonacion({
    tipo,
    sesion,
    usuarioEfectivo,
    scope,
    causalidad
  }) {
    const scopeAuditoria = normalizarScopeAuditoria(scope);
    const eventoId = generarUuidV7Auditoria();
    return {
      eventoId,
      tipo,
      versionContrato: 1,
      flujo: 'usuarios',
      claveCadena: claveCadenaUsuarios(scopeAuditoria),
      actorReal: {
        tipo: 'usuario',
        id: String(sesion.usuarioRealId)
      },
      actorEfectivo: {
        tipo: 'usuario',
        id: String(usuarioEfectivo.id)
      },
      modoActuacion: 'impersonado',
      sujeto: {
        tipo: 'sesion_usuario',
        id: sesion.sesionAuditoriaId
      },
      origen: 'web',
      scope: scopeAuditoria,
      correlacionId: generarUuidV7Auditoria(),
      causalidad,
      productor: 'portal_web',
      claveOperacion: generarUuidV7Auditoria(),
      rolEvento: 'principal',
      efectivoEnUtc: new Date().toISOString(),
      versionCanonicalizador: PERFIL_JCS_AUDITORIA_V1,
      versionEncadenado: VERSION_ENCADENADO_AUDITORIA_V1,
      payload: {
        sesionAuditoriaId: sesion.sesionAuditoriaId,
        resultado: tipo === 'usuario.impersonacion_iniciada'
          ? 'impersonacion_iniciada'
          : 'impersonacion_finalizada',
        causa: 'operador'
      }
    };
  }

  async asegurarTokenCsrfPublico(requisicion) {
    const tokenExistente = this.normalizarTokenCSRF(
      requisicion.session?.tokenCSRF
    );

    if (tokenExistente) {
      return tokenExistente;
    }

    const tokenCSRF = this.generarTokenCSRF();
    requisicion.session.tokenCSRF = tokenCSRF;

    await new Promise((resolve, reject) => {
      requisicion.session.save((error) => {
        if (error) {
          reject(error);
          return;
        }

        resolve();
      });
    });

    return tokenCSRF;
  }

  async guardarContinuacionEmailPerfil(requisicion, huellaToken) {
    const huella = String(huellaToken || '').trim().toLowerCase();
    if (!/^[a-f0-9]{64}$/u.test(huella)) {
      throw new Error('La continuación de email no contiene una huella válida.');
    }

    requisicion.session.continuacionEmailPerfil = {
      destino: DESTINO_CONFIRMACION_EMAIL,
      huellaToken: huella
    };
    await this.guardarSesionExpress(requisicion);
    return requisicion.session.continuacionEmailPerfil;
  }

  async guardarContinuacionRecuperacionPassword(requisicion, {
    token,
    expiraEnUtc
  } = {}) {
    const bearer = String(token || '');
    const expiracion = String(expiraEnUtc || '');
    if (!/^[A-Za-z0-9_-]{43}$/u.test(bearer) ||
        !Number.isFinite(Date.parse(expiracion))) {
      throw new Error('La continuación de recuperación no es válida.');
    }
    requisicion.session.continuacionRecuperacionPassword = {
      destino: DESTINO_RECUPERACION_PASSWORD,
      token: bearer,
      expiraEnUtc: expiracion,
      identidadResuelta: false
    };
    await this.guardarSesionExpress(requisicion);
    return this.obtenerContinuacionRecuperacionPassword(requisicion);
  }

  obtenerContinuacionRecuperacionPassword(requisicion) {
    const continuacion = requisicion.session?.continuacionRecuperacionPassword;
    const token = String(continuacion?.token || '');
    const expiraEnUtc = String(continuacion?.expiraEnUtc || '');
    if (continuacion?.destino !== DESTINO_RECUPERACION_PASSWORD ||
        !/^[A-Za-z0-9_-]{43}$/u.test(token) ||
        !Number.isFinite(Date.parse(expiraEnUtc)) ||
        Date.parse(expiraEnUtc) <= Date.now()) {
      return null;
    }
    return {
      destino: DESTINO_RECUPERACION_PASSWORD,
      token,
      expiraEnUtc,
      identidadResuelta: continuacion.identidadResuelta === true
    };
  }

  async marcarIdentidadResueltaRecuperacionPassword(requisicion) {
    const continuacion = this.obtenerContinuacionRecuperacionPassword(requisicion);
    if (!continuacion) return false;
    requisicion.session.continuacionRecuperacionPassword = {
      ...continuacion,
      identidadResuelta: true
    };
    await this.guardarSesionExpress(requisicion);
    return true;
  }

  async limpiarContinuacionRecuperacionPassword(requisicion) {
    if (!requisicion.session?.continuacionRecuperacionPassword) return false;
    delete requisicion.session.continuacionRecuperacionPassword;
    await this.guardarSesionExpress(requisicion);
    return true;
  }

  obtenerContinuacionEmailPerfil(requisicion) {
    return this.normalizarContinuacionEmailPerfil(
      requisicion.session?.continuacionEmailPerfil
    );
  }

  obtenerDestinoTrasAutenticacion(requisicion) {
    return this.obtenerContinuacionEmailPerfil(requisicion)?.destino || '/panel';
  }

  async limpiarContinuacionEmailPerfil(requisicion) {
    if (!requisicion.session?.continuacionEmailPerfil) return false;
    delete requisicion.session.continuacionEmailPerfil;
    await this.guardarSesionExpress(requisicion);
    return true;
  }

  normalizarContinuacionEmailPerfil(continuacion) {
    const huella = String(continuacion?.huellaToken || '').trim().toLowerCase();
    if (
      continuacion?.destino !== DESTINO_CONFIRMACION_EMAIL ||
      !/^[a-f0-9]{64}$/u.test(huella)
    ) {
      return null;
    }
    return { destino: DESTINO_CONFIRMACION_EMAIL, huellaToken: huella };
  }

  async guardarSesionExpress(requisicion) {
    return new Promise((resolve, reject) => {
      requisicion.session.save((error) => {
        if (error) reject(error);
        else resolve();
      });
    });
  }

  generarTokenCSRF() {
    return randomBytes(32).toString('base64url');
  }

  normalizarTokenCSRF(tokenCSRF) {
    if (typeof tokenCSRF !== 'string') {
      return null;
    }

    const tokenNormalizado = tokenCSRF.trim();
    return tokenNormalizado.length > 0 ? tokenNormalizado : null;
  }

  async limpiarEstadoUsuario(idUsuario) {
    let sesionesDurables = 0;
    if (this.servicioSesionesWebDurables) {
      sesionesDurables =
        (await this.servicioSesionesWebDurables.invalidarPorUsuarios([idUsuario]))
          .length;
    }
    const clavesSesion = await this.buscarClavesSesionPorUsuario(idUsuario);

    const totalEliminadas = clavesSesion.length > 0
      ? await this.clienteRedis.del(clavesSesion)
      : 0;
    const versionEliminada = await this.clienteRedis.del(
      this.obtenerClaveVersionUsuario(idUsuario)
    );

    return {
      sesionesEliminadas: Number(totalEliminadas || 0) + sesionesDurables,
      claveVersionEliminada: Number(versionEliminada || 0) > 0
    };
  }

  async invalidarSesionesUsuario(idUsuario, versionSesionNueva) {
    const versionSesion = await this.sincronizarVersionUsuario(
      idUsuario, versionSesionNueva
    );
    let sesionesDurables = 0;
    if (this.servicioSesionesWebDurables) {
      sesionesDurables =
        (await this.servicioSesionesWebDurables.invalidarPorUsuarios([idUsuario]))
          .length;
    }
    const clavesSesion = await this.buscarClavesSesionPorUsuario(idUsuario);
    const totalEliminadas = clavesSesion.length > 0
      ? await this.clienteRedis.del(clavesSesion)
      : 0;

    return {
      sesionesEliminadas: Number(totalEliminadas || 0) + sesionesDurables,
      versionSesion: Number(versionSesion)
    };
  }

  obtenerClaveVersionUsuario(idUsuario) {
    return `${this.configuracionRedis.prefijoVersionUsuario}${idUsuario}:version_sesion`;
  }

  async validarVersionContraRedis(usuarioSesion) {
    const sesionNormalizada = this.normalizarSesionAutenticada(usuarioSesion);

    if (!sesionNormalizada) {
      return false;
    }

    const versiones = this.deduplicarVersionesSesion([
      {
        idUsuario: sesionNormalizada.idUsuarioReal,
        versionSesion: sesionNormalizada.versionSesionReal
      },
      {
        idUsuario: sesionNormalizada.idUsuarioEfectivo,
        versionSesion: sesionNormalizada.versionSesionEfectiva
      }
    ]);

    for (const version of versiones) {
      const versionVigente = await this.clienteRedis.get(
        this.obtenerClaveVersionUsuario(version.idUsuario)
      );

      if (!versionVigente) {
        return false;
      }

      if (Number(versionVigente) !== Number(version.versionSesion)) {
        return false;
      }
    }

    return true;
  }

  async buscarClavesSesionPorUsuario(idUsuario) {
    const claves = [];

    for await (const clave of this.clienteRedis.scanIterator({
      MATCH: `${this.configuracionRedis.prefijoSesiones}*`,
      COUNT: 100
    })) {
      const payload = await this.clienteRedis.get(clave);

      if (!payload) {
        continue;
      }

      try {
        const sesion = JSON.parse(payload);
        const autenticado =
          this.normalizarSesionAutenticada(sesion?.usuarioAutenticado);
        const pendiente = sesion?.usuarioCambioPassword?.idUsuario;
        const idsAutenticados = autenticado
          ? [
              autenticado.idUsuarioReal,
              autenticado.idUsuarioEfectivo
            ]
          : [];

        if (
          idsAutenticados.some(
            (idAutenticado) => Number(idAutenticado) === Number(idUsuario)
          ) ||
          Number(pendiente) === Number(idUsuario)
        ) {
          claves.push(clave);
        }
      } catch (_error) {
        continue;
      }
    }

    return claves;
  }

  deduplicarVersionesSesion(versiones) {
    const versionesMap = new Map();

    for (const version of versiones) {
      if (!version?.idUsuario) {
        continue;
      }

      versionesMap.set(Number(version.idUsuario), {
        idUsuario: Number(version.idUsuario),
        versionSesion: Number(version.versionSesion)
      });
    }

    return Array.from(versionesMap.values());
  }
}

function versionSesionDecimal(valor) {
  const texto = String(valor ?? '');
  if (!/^[1-9][0-9]*$/u.test(texto)) {
    throw new Error('La versión de sesión debe ser decimal positiva.');
  }
  return texto;
}

function compararVersionesDecimales(a, b) {
  const izquierda = versionSesionDecimal(a);
  const derecha = versionSesionDecimal(b);
  return izquierda.length !== derecha.length
    ? izquierda.length - derecha.length
    : izquierda.localeCompare(derecha);
}

function scopeDesdeSesion(sesion) {
  return {
    tenantId: sesion.tenantId == null ? null : String(sesion.tenantId),
    empresaId: sesion.empresaId == null ? null : String(sesion.empresaId),
    sitioId: sesion.sitioId == null ? null : String(sesion.sitioId)
  };
}

function scopeDesdeUsuario(usuario) {
  return normalizarScopeAuditoria({
    tenantId: usuario?.tenantId,
    empresaId: usuario?.empresaId,
    sitioId: usuario?.sitioId
  });
}

function normalizarScopeAuditoria(scope = {}) {
  return {
    tenantId: scope?.tenantId == null ? null : String(scope.tenantId),
    empresaId: scope?.empresaId == null ? null : String(scope.empresaId),
    sitioId: scope?.sitioId == null ? null : String(scope.sitioId)
  };
}

function claveCadenaUsuarios(scope = {}) {
  const normalizado = normalizarScopeAuditoria(scope);
  return normalizado.tenantId
    ? `usuarios:tenant:${normalizado.tenantId}`
    : 'usuarios:portal';
}

function fotografiaSesionCoincide(usuarioSesion, sesionDurable) {
  const sesion = normalizarFotografiaLocal(usuarioSesion);
  if (!sesion) return false;
  return (
    String(sesion.idUsuarioReal) === sesionDurable.usuarioRealId &&
    String(sesion.idUsuarioEfectivo) === sesionDurable.usuarioEfectivoId &&
    Number(sesion.versionSesionReal) === Number(sesionDurable.versionSesionReal) &&
    Number(sesion.versionSesionEfectiva) === Number(sesionDurable.versionSesionEfectiva)
  );
}

function normalizarFotografiaLocal(usuarioSesion) {
  if (!usuarioSesion) return null;
  const idUsuarioEfectivo =
    usuarioSesion.idUsuarioEfectivo ?? usuarioSesion.idUsuario ?? null;
  const idUsuarioReal =
    usuarioSesion.idUsuarioReal ?? idUsuarioEfectivo;
  const versionSesionEfectiva =
    usuarioSesion.versionSesionEfectiva ?? usuarioSesion.versionSesion ?? null;
  const versionSesionReal =
    usuarioSesion.versionSesionReal ?? versionSesionEfectiva;
  if (!idUsuarioReal || !idUsuarioEfectivo || !versionSesionReal || !versionSesionEfectiva) {
    return null;
  }
  return {
    idUsuarioReal,
    idUsuarioEfectivo,
    versionSesionReal,
    versionSesionEfectiva
  };
}

import { generarUuidV7Auditoria } from '../../auditoria/src/UuidV7Auditoria.js';
import { PERFIL_JCS_AUDITORIA_V1 } from '../../auditoria/src/PerfilJcsAuditoria.js';
import { VERSION_ENCADENADO_AUDITORIA_V1 } from '../../auditoria/src/SobreCanonicoAuditoria.js';

export class ControladorBootstrapUsuarioInicial {
  constructor({
    repositorioUsuarios,
    servicioAutenticacion,
    configuracionUsuarioInicial,
    fronteraTransaccional,
    servicioAuditoria,
    ahora = () => new Date()
  }) {
    if (!repositorioUsuarios?.contarUsuarios ||
        !repositorioUsuarios?.crearUsuarioInicialEnTransaccion ||
        !servicioAutenticacion?.validarPasswordNueva ||
        !servicioAutenticacion?.crearHashPassword ||
        !fronteraTransaccional?.ejecutar ||
        !servicioAuditoria?.registrarEnTransaccion ||
        typeof ahora !== 'function') {
      throw new Error('El bootstrap auditable de usuario requiere todos sus puertos.');
    }
    this.repositorioUsuarios = repositorioUsuarios;
    this.servicioAutenticacion = servicioAutenticacion;
    this.configuracionUsuarioInicial = configuracionUsuarioInicial;
    this.fronteraTransaccional = fronteraTransaccional;
    this.servicioAuditoria = servicioAuditoria;
    this.ahora = ahora;
  }

  // auditoria-productor: bootstrap.usuario_inicial
  async arrancarSiProcede() {
    const datosUsuario = this.normalizarDatosUsuario();

    if (!datosUsuario.estaCompleto) {
      return {
        ejecutado: false,
        creado: false,
        usuario: null,
        mensaje:
          'Usuario inicial no creado: faltan USUARIO_ADMIN_INICIAL, PASSWORD_ADMIN_INICIAL o EMAIL_ADMIN_INICIAL.'
      };
    }

    const totalUsuarios = await this.repositorioUsuarios.contarUsuarios();

    if (totalUsuarios > 0) {
      return {
        ejecutado: false,
        creado: false,
        usuario: null,
        totalUsuarios,
        mensaje:
          `Usuario inicial no creado: ya existen ${totalUsuarios} usuario(s).`
      };
    }

    this.servicioAutenticacion.validarPasswordNueva(
      datosUsuario.password,
      datosUsuario.password
    );
    const hashPassword = await this.servicioAutenticacion.crearHashPassword(
      datosUsuario.password
    );

    const resultado = await this.fronteraTransaccional.ejecutar(
      async (conexion) => {
        const creacion = await this.repositorioUsuarios
          .crearUsuarioInicialEnTransaccion({
            usuario: datosUsuario.usuario,
            email: datosUsuario.email,
            hashPassword,
            nombreMostrar: datosUsuario.nombreMostrar
          }, { conexion });
        if (!creacion.creado) return creacion;
        await this.servicioAuditoria.registrarEnTransaccion({
          cambioEfectivo: true,
          intencion: this.crearIntencionUsuarioCreado(creacion.usuarioId)
        }, { conexion });
        return creacion;
      }
    );
    if (!resultado.creado) {
      return {
        ejecutado: false,
        creado: false,
        usuario: null,
        totalUsuarios: resultado.totalUsuarios,
        mensaje:
          'Usuario inicial no creado: otra instancia lo creó durante el arranque.'
      };
    }

    return {
      ejecutado: true,
      creado: true,
      usuario: datosUsuario.usuario,
      totalUsuarios: 1,
      mensaje: `Usuario inicial creado automáticamente: ${datosUsuario.usuario}.`
    };
  }

  crearIntencionUsuarioCreado(usuarioId) {
    const fecha = this.ahora();
    const efectivoEnUtc = fecha instanceof Date
      ? fecha.toISOString()
      : new Date(fecha).toISOString();
    const eventoId = generarUuidV7Auditoria();
    return {
      eventoId,
      tipo: 'usuario.creado',
      versionContrato: 1,
      flujo: 'usuarios',
      claveCadena: 'usuarios:portal',
      actorReal: { tipo: 'sistema', id: 'sentinelia-system' },
      actorEfectivo: null,
      modoActuacion: 'directo',
      sujeto: { tipo: 'usuario', id: this.normalizarId(usuarioId) },
      origen: 'bootstrap',
      scope: { tenantId: null, empresaId: null, sitioId: null },
      correlacionId: generarUuidV7Auditoria(),
      causalidad: null,
      productor: 'bootstrap',
      claveOperacion: `bootstrap:usuario_inicial:${this.normalizarId(usuarioId)}`,
      rolEvento: 'principal',
      efectivoEnUtc,
      versionCanonicalizador: PERFIL_JCS_AUDITORIA_V1,
      versionEncadenado: VERSION_ENCADENADO_AUDITORIA_V1,
      payload: {
        resultado: 'creado',
        antes: null,
        despues: {
          activo: true,
          nivelScope: 'portal',
          tenantId: null,
          empresaId: null,
          sitioId: null,
          permisoVerAuditoria: true
        }
      }
    };
  }

  normalizarDatosUsuario() {
    const usuario = this.normalizarTexto(
      this.configuracionUsuarioInicial?.usuario
    );
    const password = String(this.configuracionUsuarioInicial?.password ?? '');
    const email = this.normalizarTexto(this.configuracionUsuarioInicial?.email);
    const nombreMostrar =
      this.normalizarTexto(this.configuracionUsuarioInicial?.nombreMostrar) ||
      'Administrador';

    return {
      usuario,
      password,
      email,
      nombreMostrar,
      estaCompleto: Boolean(usuario && password.trim() && email)
    };
  }

  normalizarTexto(valor) {
    return String(valor ?? '').trim();
  }

  normalizarId(valor) {
    const texto = String(valor ?? '');
    if (!/^[1-9][0-9]*$/.test(texto)) {
      throw new Error('El bootstrap no obtuvo un id de usuario válido.');
    }
    return texto;
  }
}

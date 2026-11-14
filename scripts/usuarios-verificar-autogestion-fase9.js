import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import ejs from 'ejs';
import { ControladorUsuarios } from '../apps/sentinelia-web/src/controladores/ControladorUsuarios.js';
import { AsignadorPermisosUsuario } from '../paquetes/usuarios/src/AsignadorPermisosUsuario.js';
import { ServicioCambioEmailPerfil } from '../paquetes/usuarios/src/ServicioCambioEmailPerfil.js';
import { construirContenidoVerificacionEmailPerfil }
  from '../paquetes/correo/src/ContenidoVerificacionEmailPerfil.js';

async function main() {
  await verificarLecturaEstadoEmail();
  await verificarComposicionVista();
  await verificarComposicionConfirmacionEmail();
  await verificarRenderizadoEstados();
  await verificarContratoInterfaz();
  verificarContenidoConfirmacionEmail();
  verificarPermisosOrganizativosIndependientes();

  console.log(
    '[usuarios] Fase 9 verificada: Mi perfil integra edición temporal y operaciones independientes.'
  );
}

function verificarContenidoConfirmacionEmail() {
  const base = {
    nombrePortal: 'Sentinelia',
    enlace: 'https://sentinelia.example.test/mi-perfil/email/confirmar/token',
    emailOrigen: 'actual@example.test'
  };
  const validacion = construirContenidoVerificacionEmailPerfil({
    ...base,
    emailCandidato: 'actual@example.test'
  });
  assert.equal(validacion.esValidacionEmailActual, true);
  assert.equal(validacion.asunto, 'Valida tu correo electrónico en Sentinelia');
  assert.match(validacion.cuerpoTexto, /si es necesario/u);
  assert.match(validacion.cuerpoTexto, /Abrirlo no valida el correo/u);
  assert.doesNotMatch(validacion.cuerpoTexto, /nuevo email/iu);

  const cambio = construirContenidoVerificacionEmailPerfil({
    ...base,
    emailCandidato: 'nuevo@example.test'
  });
  assert.equal(cambio.esValidacionEmailActual, false);
  assert.equal(cambio.asunto, 'Confirma el cambio de correo en Sentinelia');
  assert.match(cambio.cuerpoTexto, /confirmar expresamente el cambio/u);
  assert.match(cambio.cuerpoTexto, /Abrirlo no aplica el cambio/u);
  assert.doesNotMatch(cambio.cuerpoTexto, /nuevo email/iu);
}

function verificarPermisosOrganizativosIndependientes() {
  const asignador = new AsignadorPermisosUsuario();
  const granular = asignador.construirPermisosDesdeFormulario({
    permiso_administrar_sitios: 'on'
  });

  assert.equal(granular.administrarOrganizacion, 0);
  assert.equal(granular.administrarTenants, 0);
  assert.equal(granular.administrarEmpresas, 0);
  assert.equal(granular.administrarSitios, 1);

  const paraguas = asignador.construirPermisosDesdeFormulario({
    permiso_administrar_organizacion: 'on'
  });

  assert.equal(paraguas.administrarOrganizacion, 1);
  assert.equal(paraguas.administrarTenants, 0);
  assert.equal(paraguas.administrarEmpresas, 0);
  assert.equal(paraguas.administrarSitios, 0);
}

async function verificarLecturaEstadoEmail() {
  const estado = {
    diagnostico: {
      estado: 'activa',
      operacion: {
        emailOrigen: 'actual@example.test',
        emailCandidato: 'nuevo@example.test',
        expiraEn: '2026-07-19T15:15:00.000Z'
      }
    },
    credencialCoincide: true,
    correoOperativo: true
  };
  const servicio = new ServicioCambioEmailPerfil({
    repositorioUsuarios: {
      async buscarPorId() {
        return {
          id: 9,
          activo: true,
          email: 'actual@example.test',
          emailValidado: false,
          hashPassword: 'hash-vigente'
        };
      }
    },
    repositorioOperacionesEmail: {
      async obtenerOperacionActual() {
        return estado.diagnostico;
      },
      coincideHuellaCredencial() {
        return estado.credencialCoincide;
      }
    },
    servicioEmailPerfil: {},
    servicioAutorizacionPerfil: {},
    servicioConfiguracionPortal: {
      obtenerConfiguracionActual: () => ({
        obtenerOrigenPublicoPortal: () => 'https://sentinelia.example.test'
      })
    },
    servicioCorreoPortal: {
      obtenerEstadoConfiguracion() {
        return { operativo: estado.correoOperativo };
      }
    },
    coordinadorEmisionEmailPerfil: {
      async encolarInicial() {},
      async encolarReenvio() {}
    }
  });
  const contexto = {
    idUsuario: 9,
    idUsuarioReal: 9,
    impersonacionActiva: false
  };

  const pendiente = await servicio.obtenerEstadoPerfil({
    contextoUsuarioActual: contexto
  });
  assert.equal(pendiente.emailValidado, false);
  assert.equal(pendiente.correoOperativo, true);
  assert.equal(
    pendiente.operacionPendiente.emailCandidato,
    'nuevo@example.test'
  );
  assert.equal(pendiente.operacionPendiente.reenviable, true);
  assert.equal(pendiente.operacionPendiente.esValidacionEmailActual, false);

  estado.diagnostico = { estado: 'ausente', operacion: null };
  const sinPendiente = await servicio.obtenerEstadoPerfil({
    contextoUsuarioActual: contexto
  });
  assert.equal(sinPendiente.operacionPendiente, null);

  estado.diagnostico = {
    estado: 'activa',
    operacion: {
      emailOrigen: 'actual@example.test',
      emailCandidato: 'actual@example.test',
      expiraEn: '2026-07-19T15:15:00.000Z'
    }
  };
  estado.credencialCoincide = false;
  const credencialSustituida = await servicio.obtenerEstadoPerfil({
    contextoUsuarioActual: contexto
  });
  assert.equal(credencialSustituida.operacionPendiente, null);

  await assert.rejects(
    servicio.obtenerEstadoPerfil({
      contextoUsuarioActual: {
        idUsuario: 10,
        idUsuarioReal: 9,
        impersonacionActiva: true
      }
    }),
    (error) => error.codigo === 'impersonacion_no_permitida'
  );
}

async function verificarComposicionVista() {
  const llamadas = { autorizacion: 0, email: 0 };
  const controlador = new ControladorUsuarios({
    servicioUsuarios: {
      async construirVistaPerfilActual() {
        return {
          perfil: {
            email: 'actual@example.test',
            emailValidado: false
          }
        };
      }
    },
    servicioAutorizacionPerfil: {
      async obtenerEstado() {
        llamadas.autorizacion += 1;
        return {
          autorizada: true,
          expiraEn: '2026-07-19T15:15:00.000Z'
        };
      }
    },
    servicioCambioEmailPerfil: {
      async obtenerEstadoPerfil() {
        llamadas.email += 1;
        return {
          email: 'actual@example.test',
          emailValidado: false,
          correoOperativo: true,
          operacionPendiente: null
        };
      }
    }
  });
  const ordinaria = crearRespuestaRender();
  await controlador.mostrarMiPerfil(
    crearRequisicion({
      idUsuario: 9,
      idUsuarioReal: 9,
      impersonacionActiva: false
    }),
    ordinaria,
    assert.fail
  );
  assert.equal(ordinaria.vista, 'portal/mi-perfil');
  assert.equal(ordinaria.datos.autogestionPerfil.disponible, true);
  assert.equal(ordinaria.datos.autogestionPerfil.autorizada, true);
  assert.equal(llamadas.autorizacion, 1);
  assert.equal(llamadas.email, 1);

  const impersonada = crearRespuestaRender();
  await controlador.mostrarMiPerfil(
    crearRequisicion({
      idUsuario: 10,
      idUsuarioReal: 9,
      impersonacionActiva: true
    }),
    impersonada,
    assert.fail
  );
  assert.equal(impersonada.datos.autogestionPerfil.disponible, false);
  assert.equal(impersonada.datos.autogestionPerfil.motivo, 'impersonacion');
  assert.equal(llamadas.autorizacion, 1);
  assert.equal(llamadas.email, 1);
}

async function verificarComposicionConfirmacionEmail() {
  const estado = { esValidacionEmailActual: true };
  const controlador = new ControladorUsuarios({
    servicioUsuarios: {},
    servicioCambioEmailPerfil: {
      async obtenerConfirmacion() {
        return {
          emailCandidato: 'actual@example.test',
          expiraEn: '2026-09-13T15:09:59.000Z',
          esValidacionEmailActual: estado.esValidacionEmailActual
        };
      }
    },
    servicioSesion: {
      obtenerContinuacionEmailPerfil() {
        return { huellaToken: 'huella-fase9' };
      }
    }
  });
  const requisicion = crearRequisicion({
    idUsuario: 9,
    idUsuarioReal: 9,
    impersonacionActiva: false
  });

  const validacion = crearRespuestaRender();
  await controlador.mostrarConfirmacionEmail(requisicion, validacion);
  assert.equal(validacion.vista, 'portal/email-confirmar');
  assert.equal(validacion.datos.titulo, 'Validar correo electrónico');

  estado.esValidacionEmailActual = false;
  const cambio = crearRespuestaRender();
  await controlador.mostrarConfirmacionEmail(requisicion, cambio);
  assert.equal(cambio.datos.titulo, 'Confirmar cambio de correo');
}

async function verificarContratoInterfaz() {
  const rutaVista = new URL(
    '../apps/sentinelia-web/src/views/portal/mi-perfil.ejs',
    import.meta.url
  );
  const rutaJavascript = new URL(
    '../apps/sentinelia-web/src/public/js/mi-perfil.js',
    import.meta.url
  );
  const rutaCss = new URL(
    '../apps/sentinelia-web/src/public/css/portal.css',
    import.meta.url
  );
  const rutaVistaFormularioUsuario = new URL(
    '../apps/sentinelia-web/src/views/portal/usuario-formulario.ejs',
    import.meta.url
  );
  const rutaVistaConfirmacionEmail = new URL(
    '../apps/sentinelia-web/src/views/portal/email-confirmar.ejs',
    import.meta.url
  );
  const rutaJavascriptUsuarios = new URL(
    '../apps/sentinelia-web/src/public/js/usuarios.js',
    import.meta.url
  );
  const rutaJavascriptConfirmacionEmail = new URL(
    '../apps/sentinelia-web/src/public/js/email-confirmar.js',
    import.meta.url
  );
  const [
    vista,
    javascript,
    css,
    vistaFormularioUsuario,
    javascriptUsuarios,
    vistaConfirmacionEmail,
    javascriptConfirmacionEmail
  ] = await Promise.all([
    readFile(rutaVista, 'utf8'),
    readFile(rutaJavascript, 'utf8'),
    readFile(rutaCss, 'utf8'),
    readFile(rutaVistaFormularioUsuario, 'utf8'),
    readFile(rutaJavascriptUsuarios, 'utf8'),
    readFile(rutaVistaConfirmacionEmail, 'utf8'),
    readFile(rutaJavascriptConfirmacionEmail, 'utf8')
  ]);
  ejs.compile(vista, { filename: rutaVista.pathname });
  ejs.compile(vistaFormularioUsuario, {
    filename: rutaVistaFormularioUsuario.pathname
  });
  ejs.compile(vistaConfirmacionEmail, {
    filename: rutaVistaConfirmacionEmail.pathname
  });

  for (const operacion of [
    'nombre_visible',
    'nombre_completo',
    'email',
    'password'
  ]) {
    assert.match(vista, new RegExp(`data-perfil-formulario="${operacion}"`));
  }
  assert.match(vista, /data-perfil-desbloquear/);
  assert.match(vista, /data-perfil-cerrar-edicion/);
  assert.match(vista, /data-perfil-validar-email/);
  assert.match(vista, /data-perfil-reenviar-email/);
  assert.match(vista, /todas las demás sesiones/);
  assert.match(vista, /estaImpersonado/);

  for (const ruta of [
    '/mi-perfil/desbloquear',
    '/mi-perfil/cerrar-edicion',
    '/mi-perfil/nombre-visible',
    '/mi-perfil/nombre-completo',
    '/mi-perfil/password',
    '/mi-perfil/email',
    '/mi-perfil/email/validar',
    '/mi-perfil/email/reenviar'
  ]) {
    assert.ok(javascript.includes(ruta));
  }
  assert.match(javascript, /peticionEnCurso/);
  assert.match(javascript, /window\.confirm/);
  assert.match(javascript, /window\.setInterval\(actualizarVigencia, 1000\)/);
  assert.match(javascript, /perfil_edicion_requerida/);
  assert.doesNotMatch(javascript, /expiraEnMs\s*\+=/);
  assert.match(css, /html\[data-theme="dark"\] \.perfil-usuario__aviso-impersonacion/);
  assert.match(css, /@media \(max-width: 520px\)/);
  assert.match(vistaFormularioUsuario, /usuarioObjetivo\.emailValidado/);
  assert.match(vistaFormularioUsuario, /Estado del email actualmente guardado/);
  assert.doesNotMatch(vistaFormularioUsuario, /name="email_validado"/);
  assert.match(javascriptUsuarios, /item\.emailValidado/);
  assert.match(javascriptUsuarios, /Email no validado/);
  assert.doesNotMatch(
    javascriptUsuarios,
    /permiso_administrar_(?:tenants|empresas|sitios): \['permiso_administrar_organizacion'\]/
  );
  assert.doesNotMatch(javascriptUsuarios, /const activacionesPermisos =/);
  assert.match(
    javascriptUsuarios,
    /permiso_administrar_tenants: \['portal', 'tenant'\]/
  );
  assert.match(css, /\.estado-badge--compacto/);
  assert.match(css, /\.usuario-email-estado/);
  assert.match(css, /\.email-confirmacion/);
  assert.match(vistaConfirmacionEmail, /Validar correo electrónico/);
  assert.match(vistaConfirmacionEmail, /Confirmar cambio de correo/);
  assert.match(vistaConfirmacionEmail, /Volver a mi perfil/);
  assert.match(vistaConfirmacionEmail, /data-expira-en/);
  assert.match(vistaConfirmacionEmail, /data-cuenta-atras/);
  assert.doesNotMatch(vistaConfirmacionEmail, /Identidad de la cuenta/);
  assert.doesNotMatch(vistaConfirmacionEmail, />Ahora no</);
  assert.match(javascriptConfirmacionEmail, /Date\.parse/);
  assert.match(javascriptConfirmacionEmail, /window\.setInterval/);
  assert.match(javascriptConfirmacionEmail, /milisegundosRestantes <= 0/);
  assert.match(javascriptConfirmacionEmail, /Enlace caducado/);
  assert.match(javascriptConfirmacionEmail, /boton\.disabled = true/);
}

async function verificarRenderizadoEstados() {
  const rutaVista = new URL(
    '../apps/sentinelia-web/src/views/portal/mi-perfil.ejs',
    import.meta.url
  );
  const bloqueada = await ejs.renderFile(
    rutaVista.pathname,
    crearLocalesVista({ autorizada: false })
  );
  assert.match(bloqueada, /data-autorizada="false"/);
  assert.match(bloqueada, /data-perfil-password-card/);
  assert.match(
    bloqueada,
    /Para cambiarla, desbloquea primero la edición de tu perfil\./
  );
  assert.match(bloqueada, /id="modal-desbloquear-perfil"/);
  assert.match(bloqueada, /data-perfil-abrir-edicion/);

  const autorizada = await ejs.renderFile(
    rutaVista.pathname,
    crearLocalesVista({
      autorizada: true,
      expiraEn: '2026-07-19T15:15:00.000Z',
      operacionPendiente: {
        emailCandidato: 'nuevo@example.test',
        expiraEn: '2026-07-19T15:15:00.000Z',
        esValidacionEmailActual: false,
        reenviable: true
      }
    })
  );
  assert.match(autorizada, /data-autorizada="true"/);
  assert.match(autorizada, /nuevo@example\.test/);
  assert.match(autorizada, /data-perfil-reenviar-email/);
  assert.match(autorizada, /data-perfil-cerrar-edicion/);

  const impersonada = await ejs.renderFile(
    rutaVista.pathname,
    crearLocalesVista({ impersonacionActiva: true })
  );
  assert.match(impersonada, /data-disponible="false"/);
  assert.match(impersonada, /no está disponible durante una impersonación/);
  assert.doesNotMatch(impersonada, /id="modal-desbloquear-perfil"/);
  assert.doesNotMatch(impersonada, /data-perfil-abrir-edicion/);
}

function crearRequisicion(contextoUsuarioActual) {
  return {
    contextoUsuarioActual,
    sessionID: 'sesion-fase9',
    session: {
      usuarioAutenticado: { id: contextoUsuarioActual.idUsuarioReal }
    }
  };
}

function crearRespuestaRender() {
  return {
    vista: null,
    datos: null,
    cabeceras: {},
    set(nombre, valor) {
      this.cabeceras[nombre] = valor;
      return this;
    },
    render(vista, datos) {
      this.vista = vista;
      this.datos = datos;
    }
  };
}

function crearLocalesVista({
  autorizada = false,
  expiraEn = null,
  operacionPendiente = null,
  impersonacionActiva = false
} = {}) {
  const contexto = {
    idUsuario: impersonacionActiva ? 10 : 9,
    idUsuarioReal: 9,
    impersonacionActiva,
    nombreVisible: impersonacionActiva ? 'Usuario efectivo' : 'Operador',
    nombreVisibleReal: 'Operador real',
    permisos: {}
  };
  const perfil = {
    contextoActual: contexto,
    inicial: 'O',
    nombreMostrar: 'Operador',
    nombreCompleto: 'Operador de prueba',
    usuario: 'operador',
    email: 'actual@example.test',
    emailValidado: false,
    totalPermisosActivos: 0,
    activo: true,
    requiereCambioPassword: false,
    ultimoAcceso: null,
    contadorAccesos: 1,
    nivelScope: 'portal',
    descripcionScope: 'Portal completo',
    tenantId: null,
    empresaId: null,
    sitioId: null,
    permisosActivosDetalle: []
  };
  return {
    titulo: 'Mi perfil',
    nombrePortalVisible: 'Sentinelia',
    tokenCSRFPortal: 'csrf-fase9',
    usuarioActual: {
      nombreVisible: 'Operador',
      usuario: 'operador',
      tokenCSRF: 'csrf-fase9'
    },
    contextoUsuarioActual: contexto,
    rutaActual: '/mi-perfil',
    queryActual: {},
    tiposMonitorNavegacion: [],
    capacidadesPortal: {},
    perfil,
    autogestionPerfil: {
      disponible: !impersonacionActiva,
      motivo: impersonacionActiva ? 'impersonacion' : null,
      autorizada: !impersonacionActiva && autorizada,
      expiraEn,
      email: {
        email: perfil.email,
        emailValidado: false,
        correoOperativo: true,
        operacionPendiente
      }
    }
  };
}

main().catch((error) => {
  console.error('[usuarios] Falló la verificación de la fase 9.');
  console.error(error);
  process.exit(1);
});

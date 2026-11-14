import assert from 'node:assert/strict';
import { ServicioAuditoriaOperativa } from '../paquetes/auditoria/src/ServicioAuditoriaOperativa.js';
import { ServicioAutogestionPerfil } from '../paquetes/usuarios/src/ServicioAutogestionPerfil.js';
import { ServicioCambioEmailPerfil } from '../paquetes/usuarios/src/ServicioCambioEmailPerfil.js';

async function main() {
  await verificarNombreAuditable();
  await verificarPasswordAuditable();
  await verificarEmailValidadoAuditable();
  await verificarRollbackAuditoria();
  console.log(
    '[usuarios] OK 5.21.8d: autogestion=auditable payload=minimizado ' +
    'noop=sin_evento credenciales=sin_secretos rollback=propagado'
  );
}

async function verificarNombreAuditable() {
  const auditoria = auditoriaRealFixture();
  const servicio = new ServicioAutogestionPerfil({
    repositorioUsuarios: new RepositorioUsuariosFixture(),
    servicioAutorizacionPerfil: autorizacionFixture(),
    fronteraTransaccional: fronteraFixture(),
    servicioAuditoria: auditoria.servicio,
    ahora: fechaFija
  });

  const resultado = await servicio.actualizarNombreVisible({
    contextoUsuarioActual: contextoFixture(),
    idSesion: 'store-opaco',
    nombreVisible: 'Nombre Nuevo'
  });
  assert.equal(resultado.datos.modificado, true);
  assert.equal(auditoria.eventos.length, 1);
  assert.equal(auditoria.eventos[0].tipo, 'usuario.perfil_cambiado');
  assert.deepEqual(auditoria.eventos[0].payload, {
    resultado: 'actualizado',
    camposCambiados: ['nombreMostrar'],
    antes: {},
    despues: {}
  });

  const sinCambios = new ServicioAutogestionPerfil({
    repositorioUsuarios: new RepositorioUsuariosFixture({ modificadoNombre: false }),
    servicioAutorizacionPerfil: autorizacionFixture(),
    fronteraTransaccional: fronteraFixture(),
    servicioAuditoria: auditoria.servicio,
    ahora: fechaFija
  });
  await sinCambios.actualizarNombreVisible({
    contextoUsuarioActual: contextoFixture(),
    idSesion: 'store-opaco',
    nombreVisible: 'Nombre Nuevo'
  });
  assert.equal(auditoria.eventos.length, 1, 'Un no-op de perfil no emite evento.');
}

async function verificarPasswordAuditable() {
  const auditoria = auditoriaRealFixture();
  const invalidaciones = [];
  const servicio = new ServicioAutogestionPerfil({
    repositorioUsuarios: new RepositorioUsuariosFixture(),
    servicioAutenticacion: {
      obtenerLongitudMinimaPassword: () => 8,
      async verificarPasswordActual() {
        return {
          usuarioVigente: true,
          passwordValida: false,
          usuario: { hashPassword: 'hash-anterior', versionSesion: 4 }
        };
      },
      async crearHashPassword() {
        return 'hash-nuevo-no-auditable';
      }
    },
    servicioSesion: {
      async invalidarSesionesUsuario(idUsuario, versionSesion) {
        invalidaciones.push({ idUsuario, versionSesion });
        return { sesionesEliminadas: 2 };
      }
    },
    servicioAutorizacionPerfil: {
      async exigirAutorizacion() {},
      async revocarTodasLasAutorizaciones() {
        return { autorizacionesRevocadas: 1 };
      }
    },
    fronteraTransaccional: fronteraFixture(),
    servicioAuditoria: auditoria.servicio,
    ahora: fechaFija
  });

  const resultado = await servicio.cambiarPassword({
    contextoUsuarioActual: contextoFixture(),
    idSesion: 'store-opaco',
    passwordNuevo: 'ClaveNueva123!',
    passwordConfirmacion: 'ClaveNueva123!'
  });
  assert.equal(resultado.codigo, 'password_actualizado_sesion_cerrada');
  assert.deepEqual(invalidaciones, [{ idUsuario: 7, versionSesion: 5 }]);
  assert.equal(auditoria.eventos.length, 1);
  assert.equal(auditoria.eventos[0].tipo, 'usuario.password_cambiado');
  assert.deepEqual(auditoria.eventos[0].payload, {
    operacion: 'cambio',
    resultado: 'actualizada',
    causa: 'voluntario'
  });
  assert.equal(JSON.stringify(auditoria.eventos).includes('ClaveNueva'), false);
  assert.equal(JSON.stringify(auditoria.eventos).includes('hash-'), false);
}

async function verificarEmailValidadoAuditable() {
  const auditoria = auditoriaRealFixture();
  const servicio = new ServicioCambioEmailPerfil({
    repositorioUsuarios: new RepositorioUsuariosFixture(),
    repositorioOperacionesEmail: {},
    servicioEmailPerfil: {},
    servicioAutorizacionPerfil: autorizacionFixture(),
    servicioCorreoPortal: {},
    servicioConfiguracionPortal: configuracionPortalFixture(),
    coordinadorEmisionEmailPerfil: {
      async encolarInicial() {},
      async encolarReenvio() {}
    },
    fronteraTransaccional: fronteraFixture(),
    servicioAuditoria: auditoria.servicio,
    ahora: fechaFija
  });

  const persistencia = await servicio.confirmarEmailAuditable({
    operacion: {
      idUsuario: 7,
      emailOrigen: 'anterior@example.test',
      emailCandidato: 'nuevo@example.test'
    },
    contextoUsuarioActual: contextoFixture()
  });
  assert.equal(persistencia.estado, 'actualizado');
  assert.equal(auditoria.eventos.length, 1);
  assert.equal(auditoria.eventos[0].tipo, 'usuario.email_validado');
  assert.deepEqual(auditoria.eventos[0].payload, {
    estadoAntes: 'no_validado',
    estadoDespues: 'validado',
    motivo: 'confirmacion_email'
  });
  assert.equal(JSON.stringify(auditoria.eventos).includes('@example'), false);
}

function configuracionPortalFixture() {
  return {
    obtenerConfiguracionActual: () => ({
      obtenerOrigenPublicoPortal: () => 'https://sentinelia.example.test'
    })
  };
}

async function verificarRollbackAuditoria() {
  const frontera = fronteraFixture();
  const servicio = new ServicioAutogestionPerfil({
    repositorioUsuarios: new RepositorioUsuariosFixture(),
    servicioAutorizacionPerfil: autorizacionFixture(),
    fronteraTransaccional: frontera,
    servicioAuditoria: {
      async registrarEnTransaccion() {
        throw new Error('auditoria caída fixture');
      }
    },
    ahora: fechaFija
  });

  await assert.rejects(
    () => servicio.actualizarNombreCompleto({
      contextoUsuarioActual: contextoFixture(),
      idSesion: 'store-opaco',
      nombreCompleto: 'Nombre Completo'
    }),
    /auditoria caída fixture/
  );
  assert.equal(frontera.rollbacks, 1);
  assert.equal(frontera.commits, 0);
}

class RepositorioUsuariosFixture {
  constructor({ modificadoNombre = true } = {}) {
    this.modificadoNombre = modificadoNombre;
  }

  async buscarPorId() {
    return usuarioFixture();
  }

  async buscarPorIdEnTransaccion() {
    return usuarioFixture();
  }

  async actualizarNombrePropioEnTransaccion() {
    return { usuarioActivo: true, modificado: this.modificadoNombre };
  }

  async actualizarPasswordPropioEnTransaccion() {
    return { estado: 'actualizado', versionSesion: 5 };
  }

  async confirmarEmailValidadoPendienteEnTransaccion() {
    return { estado: 'actualizado' };
  }
}

function auditoriaRealFixture() {
  const eventos = [];
  const servicio = new ServicioAuditoriaOperativa({
    repositorioAuditoria: {
      async incorporarEnTransaccion(intenciones) {
        eventos.push(...structuredClone(intenciones));
        return {
          eventos: intenciones.map((intencion) => ({
            estado: 'incorporado',
            eventoId: intencion.eventoId
          })),
          genesis: [],
          registradoEnUtc: fechaFija().toISOString()
        };
      }
    }
  });
  return { eventos, servicio };
}

function fronteraFixture() {
  return {
    commits: 0,
    rollbacks: 0,
    async ejecutar(trabajo) {
      try {
        const resultado = await trabajo({ execute: async () => [[], {}] });
        this.commits += 1;
        return resultado;
      } catch (error) {
        this.rollbacks += 1;
        throw error;
      }
    }
  };
}

function autorizacionFixture() {
  return {
    async exigirAutorizacion() {},
    async revocarTodasLasAutorizaciones() {
      return { autorizacionesRevocadas: 0 };
    }
  };
}

function contextoFixture() {
  return {
    idUsuario: 7,
    idUsuarioReal: 7,
    impersonacionActiva: false
  };
}

function usuarioFixture() {
  return {
    id: 7,
    activo: true,
    tenantId: null,
    empresaId: null,
    sitioId: null
  };
}

function fechaFija() {
  return new Date('2026-07-25T10:00:00.000Z');
}

main().catch((error) => {
  console.error('[usuarios] Falló la verificación 5.21.8d');
  console.error(error);
  process.exitCode = 1;
});

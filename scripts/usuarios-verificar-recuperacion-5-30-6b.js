import assert from 'node:assert/strict';

import { generarUuidV7Auditoria }
  from '../paquetes/auditoria/src/UuidV7Auditoria.js';
import { ServicioSustitucionPasswordRecuperacionEmail }
  from '../paquetes/usuarios/src/ServicioSustitucionPasswordRecuperacionEmail.js';

await main();

async function main() {
  await verificarSustitucionAtomica();
  await verificarReplayPorTestigo();
  await verificarRetiradaYFallos();
  console.log('[usuarios] OK 5.30.6b: password+versiones+sesiones+auditoria+correo=transaccion_unica replay=testigo reserva=redis fallo_commit=cerrado');
}

async function verificarSustitucionAtomica() {
  const fixture = crearFixture();
  const resultado = await fixture.servicio.sustituir({
    token: 'bearer_fixture',
    passwordNuevo: 'NuevaClaveSegura530!',
    passwordConfirmacion: 'NuevaClaveSegura530!',
    leaseSegundos: 90
  });
  assert.equal(resultado.estado, 'sustituida');
  assert.equal(resultado.versionSesion, '8');
  assert.equal(resultado.generacionRecuperacion, '4');
  assert.equal(resultado.sesionesInvalidadas, 2);
  assert.equal(fixture.usuarios.sustituciones.length, 1);
  assert.equal(fixture.sesiones.llamadas.length, 1);
  assert.equal(fixture.auditoria.intenciones.length, 1);
  assert.equal(fixture.auditoria.intenciones[0].tipo,
    'usuario.password_recuperado');
  assert.equal(fixture.correo.llamadas.length, 1);
  assert.equal(fixture.correo.llamadas[0].usuariosJustificantesIds[0], '7');
  assert.match(fixture.correo.llamadas[0].cuerpoTexto,
    /Javier.*2026-09-06T13:00:00.123Z/su);
  assert.equal(fixture.solicitudes.consumos, 0,
    '6b conserva la reserva hasta la convergencia postcommit');
}

async function verificarReplayPorTestigo() {
  const fixture = crearFixture({ testigo: true });
  const resultado = await fixture.servicio.sustituir({
    token: 'bearer_fixture', passwordNuevo: 'NuevaClaveSegura530!',
    passwordConfirmacion: 'NuevaClaveSegura530!', leaseSegundos: 90
  });
  assert.equal(resultado.estado, 'ya_sustituida');
  assert.equal(resultado.versionSesion, '8');
  assert.equal(fixture.usuarios.sustituciones.length, 0);
  assert.equal(fixture.correo.llamadas.length, 0);
}

async function verificarRetiradaYFallos() {
  const retirada = crearFixture({ elegible: false });
  const resultado = await retirada.servicio.sustituir({
    token: 'bearer_fixture', passwordNuevo: 'NuevaClaveSegura530!',
    passwordConfirmacion: 'NuevaClaveSegura530!', leaseSegundos: 90
  });
  assert.equal(resultado.estado, 'autoridad_retirada');
  assert.equal(retirada.solicitudes.restauraciones, 1);
  assert.equal(retirada.solicitudes.retiradas, 1);

  const antesSql = crearFixture({ falloInspeccion: true });
  await assert.rejects(() => antesSql.servicio.sustituir({
    token: 'bearer_fixture', passwordNuevo: 'NuevaClaveSegura530!',
    passwordConfirmacion: 'NuevaClaveSegura530!', leaseSegundos: 90
  }), /redis temporal/u);
  assert.equal(antesSql.solicitudes.restauraciones, 1);

  const commitDudoso = crearFixture({ falloTransaccion: true });
  await assert.rejects(() => commitDudoso.servicio.sustituir({
    token: 'bearer_fixture', passwordNuevo: 'NuevaClaveSegura530!',
    passwordConfirmacion: 'NuevaClaveSegura530!', leaseSegundos: 90
  }), /commit desconocido/u);
  assert.equal(commitDudoso.solicitudes.restauraciones, 0,
    'tras entrar en SQL no se reabre autoridad sin consultar el testigo');
}

function crearFixture({ testigo = false, elegible = true,
  falloInspeccion = false, falloTransaccion = false } = {}) {
  const ids = Array.from({ length: 4 }, () => generarUuidV7Auditoria());
  const usuarioAntes = {
    id: '7', usuario: 'Javier', email: 'compartido@example.test',
    activo: true, emailValidado: true, versionSesion: 7,
    generacionRecuperacion: '3', requiereCambioPassword: true,
    tenantId: '2', empresaId: '3', sitioId: null
  };
  const usuarioDespues = { ...usuarioAntes, versionSesion: 8,
    generacionRecuperacion: '4', requiereCambioPassword: false };
  const solicitudes = {
    restauraciones: 0, retiradas: 0, consumos: 0,
    async reservarConsumo() { return { estado: 'reservada' }; },
    async inspeccionar() {
      if (falloInspeccion) throw new Error('redis temporal');
      return {
        estado: 'consumiendo',
        solicitud: {
          solicitudId: ids[0], buzonCanonico: 'compartido@example.test',
          usuarioIdVinculado: '7',
          frontera: { miembros: [{ usuarioId: '7',
            generacionRecuperacionObservada: '3', estado: 'utilizable' }] }
        },
        coordinacion: { eventoEmisionId: ids[1], eventoConsumoId: ids[2] }
      };
    },
    async restaurarConsumo() { this.restauraciones += 1; return true; },
    async retirarIdentidad() { this.retiradas += 1; return { estado: 'retirada' }; }
  };
  const usuarios = {
    sustituciones: [],
    async bloquearIdentidadElegibleRecuperacionEnTransaccion() {
      return elegible ? usuarioAntes : null;
    },
    async sustituirPasswordPorRecuperacionEnTransaccion(entrada) {
      this.sustituciones.push(entrada);
      return usuarioDespues;
    },
    async buscarPorIdEnTransaccion() { return usuarioDespues; }
  };
  const sesiones = {
    llamadas: [],
    async invalidarVigentesPorUsuariosEnTransaccion(idsUsuario) {
      this.llamadas.push(idsUsuario);
      return [{}, {}];
    }
  };
  const auditoria = {
    intenciones: [],
    async existeTestigoEventoEnTransaccion() { return testigo; },
    async incorporarEnTransaccion(intenciones) {
      this.intenciones.push(...intenciones);
      return { eventos: [{ estado: 'incorporado' }] };
    }
  };
  const correo = {
    llamadas: [],
    async crearNotificacionSeguridadEnTransaccion(entrada) {
      this.llamadas.push(entrada);
      return { salida: { id: '81' }, creada: true };
    }
  };
  return {
    solicitudes, usuarios, sesiones, auditoria, correo,
    servicio: new ServicioSustitucionPasswordRecuperacionEmail({
      repositorioSolicitudes: solicitudes,
      repositorioUsuarios: usuarios,
      repositorioSesionesWeb: sesiones,
      repositorioAuditoria: auditoria,
      repositorioCoordinacionCorreo: correo,
      servicioAutenticacion: {
        validarPasswordNueva(password, confirmacion) {
          assert.equal(password, confirmacion);
        },
        async crearHashPassword() { return '$2b$fixture'; }
      },
      servicioConfiguracionPortal: {
        async asegurarActualizada() {},
        obtenerConfiguracionActual() {
          return {
            obtenerNombreVisiblePortal: () => 'Sentinelia',
            obtenerOrigenPublicoPortal: () => ''
          };
        }
      },
      fronteraTransaccional: {
        async ejecutar(trabajo) {
          if (falloTransaccion) throw new Error('commit desconocido');
          return trabajo({ execute: async () => [[{
            ahora_utc: '2026-09-06T13:00:00.123000Z'
          }]] });
        }
      },
      propietario: 'fixture-5.30.6b',
      generarId: () => ids[3]
    })
  };
}

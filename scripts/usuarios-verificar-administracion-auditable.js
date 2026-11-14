import assert from 'node:assert/strict';
import { ServicioUsuarios } from '../paquetes/usuarios/src/ServicioUsuarios.js';
import {
  construirSobreCanonicoAuditoriaV1,
  VERSION_ENCADENADO_AUDITORIA_V1
} from '../paquetes/auditoria/src/SobreCanonicoAuditoria.js';
import {
  validarEventoAuditableV1,
  validarParMovimientoAuditoriaV1
} from '../paquetes/auditoria/src/ValidadorContratoAuditoria.js';
import { PERFIL_JCS_AUDITORIA_V1 } from '../paquetes/auditoria/src/PerfilJcsAuditoria.js';

async function main() {
  await verificarAltaAdministrativaAuditable();
  await verificarAltaEstructuralSerializada();
  await verificarActualizacionScopePermisosSesiones();
  await verificarPermisosSinAutoridadEstructural();
  await verificarReinicioEstadoYEliminacion();

  console.log(
    '[usuarios] OK 5.21.8e: administracion=auditable scope=movimiento sesiones=invalidacion_sql payload=minimizado orden=estable'
  );
}

async function verificarAltaEstructuralSerializada() {
  const entorno = crearEntorno();
  entorno.scopeObjetivo = {
    nivelScope: 'tenant', tenantId: 2, empresaId: null, sitioId: null
  };
  await entorno.servicio.crearUsuarioAdministrativo(contextoAdmin(), {
    usuario: 'nuevo.tenant',
    email: 'nuevo-tenant@example.test',
    password: 'Temporal456!',
    password_confirmacion: 'Temporal456!',
    nombre_mostrar: 'Nuevo tenant',
    nombre_completo: 'Nuevo tenant',
    nivel_scope: 'tenant',
    tenant_id: 2,
    permisos: {}
  });
  assert.deepEqual(entorno.traza, [
    'begin', 'autoridad:alta', 'sql:crear',
    'audit:usuario.creado:principal', 'commit'
  ]);
}

async function verificarAltaAdministrativaAuditable() {
  const entorno = crearEntorno();
  const creado = await entorno.servicio.crearUsuarioAdministrativo(
    contextoAdmin(),
    {
      usuario: 'nuevo.operador',
      email: 'nuevo@example.test',
      password: 'Temporal456!',
      password_confirmacion: 'Temporal456!',
      nombre_mostrar: 'Nuevo',
      nombre_completo: 'Nuevo Operador',
      nivel_scope: 'portal',
      permisos: {}
    }
  );

  assert.equal(creado.id, 41);
  assert.deepEqual(entorno.traza, ['begin', 'sql:crear', 'audit:usuario.creado:principal', 'commit']);
  const evento = entorno.auditoria.eventos[0];
  assert.equal(evento.tipo, 'usuario.creado');
  assert.equal(evento.payload.antes, null);
  assert.equal(evento.payload.despues.activo, true);
  assert.equal(JSON.stringify(evento.payload).includes('Temporal456'), false);
  assert.equal(JSON.stringify(evento.payload).includes('nuevo@example.test'), false);
}

async function verificarActualizacionScopePermisosSesiones() {
  const entorno = crearEntorno();
  entorno.usuario = usuarioFixture({
    id: 42,
    tenantId: 1,
    empresaId: null,
    sitioId: null,
    permisos: { ver: true, administrarUsuarios: true },
    versionSesion: 3
  });
  entorno.scopeObjetivo = {
    nivelScope: 'tenant',
    tenantId: 2,
    empresaId: null,
    sitioId: null
  };
  entorno.permisosObjetivo = { ver: true, verAuditoria: true };
  entorno.cambioPermisos = true;

  const resultado = await entorno.servicio.actualizarUsuarioAdministrativo(
    contextoAdmin(),
    42,
    {
      email: 'operador@example.test',
      nombre_mostrar: 'Operador',
      nombre_completo: 'Operador',
      nivel_scope: 'tenant',
      tenant_id: 2,
      permisos: {}
    }
  );

  assert.equal(resultado.cambioAutorizacion, true);
  assert.deepEqual(entorno.traza, [
    'begin',
    'autoridad:movimiento',
    'sql:actualizar',
    'audit:usuario.permisos_cambiados:principal',
    'audit-mov:scope.entidad_salida/scope.entidad_entrada',
    'sql:invalidar-sesiones',
    'audit:usuario.sesion_invalidada:resultado',
    'commit',
    'redis:sync-version'
  ]);
  const indiceSalida = entorno.auditoria.eventos.findIndex(
    (evento) => evento.tipo === 'scope.entidad_salida'
  );
  assert.equal(entorno.auditoria.eventos[indiceSalida + 1].tipo, 'scope.entidad_entrada');
  assert.equal(
    entorno.auditoria.eventos.at(-1).payload.causa,
    'scope_cambiado'
  );
  assert.equal(
    entorno.auditoria.eventos.at(-1).scope.tenantId,
    '1',
    'La invalidación conserva el scope efectivo anterior de la sesión.'
  );
}

async function verificarReinicioEstadoYEliminacion() {
  const entorno = crearEntorno();
  entorno.usuario = usuarioFixture({ id: 43, versionSesion: 6 });

  const reinicio = await entorno.servicio.reiniciarPasswordAdministrativo(
    contextoAdmin(),
    43,
    { password: 'Temporal456!', passwordConfirmacion: 'Temporal456!' }
  );
  assert.equal(reinicio.usuario.requiereCambioPassword, true);

  const estado = await entorno.servicio.establecerEstadoUsuarioAdministrativo(
    contextoAdmin(),
    43,
    false
  );
  assert.equal(estado.usuario.activo, false);

  entorno.usuario = usuarioFixture({ id: 43, versionSesion: 8 });
  const eliminacion = await entorno.servicio.eliminarUsuario(contextoAdmin(), 43);
  assert.equal(eliminacion.eliminado, true);

  const tipos = entorno.auditoria.eventos.map((evento) => evento.tipo);
  assert.ok(tipos.includes('usuario.password_reiniciado'));
  assert.ok(tipos.includes('usuario.estado_cambiado'));
  assert.ok(tipos.includes('usuario.eliminado'));
  assert.equal(
    entorno.traza.indexOf('sql:invalidar-sesiones') <
      entorno.traza.indexOf('sql:eliminar'),
    true,
    'La eliminación invalida sesiones durables antes de borrar el usuario.'
  );
  assert.equal(JSON.stringify(entorno.auditoria.eventos).includes('hash'), false);
}

async function verificarPermisosSinAutoridadEstructural() {
  const entorno = crearEntorno();
  entorno.usuario = usuarioFixture({
    id: 44,
    tenantId: 1,
    permisos: { ver: true },
    versionSesion: 2
  });
  entorno.scopeObjetivo = {
    nivelScope: 'tenant', tenantId: 1, empresaId: null, sitioId: null
  };
  entorno.permisosObjetivo = { ver: true, verAuditoria: true };
  entorno.cambioPermisos = true;
  await entorno.servicio.actualizarUsuarioAdministrativo(
    contextoAdmin(),
    44,
    {
      email: 'operador@example.test',
      nombre_mostrar: 'Operador',
      nombre_completo: 'Operador',
      nivel_scope: 'tenant',
      tenant_id: 1,
      permisos: {}
    }
  );
  assert.equal(entorno.traza.includes('autoridad:movimiento'), false);
  assert.equal(entorno.traza.includes('sql:actualizar'), true);
}

function crearEntorno() {
  const traza = [];
  const auditoria = new AuditoriaFake(traza);
  const entorno = {
    traza,
    auditoria,
    usuario: usuarioFixture({ id: 41 }),
    scopeObjetivo: { nivelScope: 'portal', tenantId: null, empresaId: null, sitioId: null },
    permisosObjetivo: {},
    cambioPermisos: false
  };
  const repositorioUsuarios = {
    async crearUsuarioAdministrativoEnTransaccion(datos) {
      traza.push('sql:crear');
      entorno.usuario = usuarioFixture({
        id: 41,
        usuario: datos.usuario,
        tenantId: datos.tenantId,
        empresaId: datos.empresaId,
        sitioId: datos.sitioId,
        permisos: datos.permisos,
        requiereCambioPassword: datos.requiereCambioPassword
      });
      return entorno.usuario;
    },
    async buscarPorIdParaAdministracion() {
      return entorno.usuario;
    },
    async actualizarUsuarioAdministrativoEnTransaccion(datos) {
      traza.push('sql:actualizar');
      entorno.usuario = usuarioFixture({
        ...entorno.usuario,
        email: datos.email,
        nombreMostrar: datos.nombreMostrar,
        nombreCompleto: datos.nombreCompleto,
        tenantId: datos.tenantId,
        empresaId: datos.empresaId,
        sitioId: datos.sitioId,
        permisos: datos.permisos,
        versionSesion: entorno.usuario.versionSesion + (datos.incrementarVersionSesion ? 1 : 0)
      });
      return entorno.usuario;
    },
    async reiniciarPasswordAdministrativaEnTransaccion() {
      traza.push('sql:password');
      entorno.usuario = usuarioFixture({
        ...entorno.usuario,
        requiereCambioPassword: true,
        versionSesion: entorno.usuario.versionSesion + 1
      });
      return entorno.usuario;
    },
    async establecerActivoAdministrativoEnTransaccion({ activo }) {
      traza.push(activo ? 'sql:reactivar' : 'sql:desactivar');
      entorno.usuario = usuarioFixture({
        ...entorno.usuario,
        activo,
        versionSesion: entorno.usuario.versionSesion + 1
      });
      return entorno.usuario;
    },
    async eliminarPorIdEnTransaccion() {
      traza.push('sql:eliminar');
      entorno.usuario = null;
      return true;
    }
  };

  const servicio = new ServicioUsuarios({
    repositorioUsuarios,
    repositorioTenants: {},
    repositorioEmpresas: {},
    repositorioSitios: {},
    servicioAutenticacion: {
      validarPasswordNueva(password, confirmacion) {
        assert.equal(password, confirmacion);
      },
      async crearHashPassword() {
        return 'hash-no-debe-salir';
      }
    },
    servicioAutorizacion: {},
    servicioSesion: {
      async sincronizarVersionUsuario() {
        traza.push('redis:sync-version');
      },
      async invalidarSesionesUsuario() {
        traza.push('redis:invalidar-sesiones');
        return { sesionesEliminadas: 1 };
      },
      async limpiarEstadoUsuario() {
        traza.push('redis:limpiar-usuario');
        return { limpio: true };
      }
    },
    resolutorScopeUsuario: {},
    validadorJerarquiaUsuario: {
      validarAltaBase() {},
      validarEdicionBase() {},
      assertNoAutoEliminacion() {}
    },
    asignadorPermisosUsuario: {},
    servicioEstadoSensibleUsuario: {
      async ejecutarConExclusion(_idUsuario, operacion) {
        const resultado = await operacion();
        return { resultado, limpieza: { completa: true } };
      }
    },
    repositorioSesionesWebAuditoria: {
      async invalidarVigentesPorUsuariosEnTransaccion() {
        traza.push('sql:invalidar-sesiones');
        return [
          {
            sesionAuditoriaId: '01980000-0000-7000-8000-000000000001',
            scopeEfectivoActual: { tenantId: 1, empresaId: null, sitioId: null }
          }
        ];
      }
    },
    fronteraTransaccional: {
      async ejecutar(operacion) {
        traza.push('begin');
        try {
          const resultado = await operacion({});
          traza.push('commit');
          return resultado;
        } catch (error) {
          traza.push('rollback');
          throw error;
        }
      }
    },
    servicioAuditoria: auditoria,
    servicioAutoridadMutacionesEstructurales: {
      async serializarAltaEnTransaccion() {
        traza.push('autoridad:alta');
      },
      async autorizarMovimientoUsuarioEnTransaccion({
        usuarioId, scopeOrigen, scopeDestino
      }) {
        traza.push('autoridad:movimiento');
        assert.equal(usuarioId, entorno.usuario.id);
        assert.deepEqual(scopeOrigen, {
          tenantId: String(entorno.usuario.tenantId),
          empresaId: null,
          sitioId: null
        });
        assert.deepEqual(scopeDestino, {
          tenantId: String(entorno.scopeObjetivo.tenantId),
          empresaId: null,
          sitioId: null
        });
      }
    },
    ahora: () => new Date('2026-01-01T00:00:00.000Z')
  });

  servicio.resolverScopeObjetivoValido = async () => entorno.scopeObjetivo;
  servicio.construirPermisosObjetivoDesdeFormulario = () => entorno.permisosObjetivo;
  servicio.hayCambioPermisos = () => entorno.cambioPermisos;
  servicio.assertUsuarioConJerarquiaValida = () => {};
  servicio.assertCoberturaAdministrativaCritica = async () => {};

  entorno.servicio = servicio;
  return entorno;
}

class AuditoriaFake {
  constructor(traza) {
    this.traza = traza;
    this.eventos = [];
  }

  async registrarEnTransaccion({ intencion }) {
    this.traza.push(`audit:${intencion.tipo}:${intencion.rolEvento}`);
    validarEventoAuditableV1({
      tipo: intencion.tipo,
      actor: intencion.actorReal.tipo,
      origen: intencion.origen,
      sujeto: intencion.sujeto,
      flujo: intencion.flujo,
      productor: intencion.productor,
      rolEvento: intencion.rolEvento,
      payload: intencion.payload
    });
    const evento = Object.freeze({
      ...intencion,
      secuencia: String(this.eventos.length + 1),
      registradoEnUtc: intencion.efectivoEnUtc,
      estado: 'incorporado'
    });
    validarSobreCanonicoFixture(evento);
    this.eventos.push(evento);
    return { evento, estado: 'incorporado', genesis: [], esNoOp: false };
  }

  async registrarMovimientoEnTransaccion({ salida, entrada }) {
    this.traza.push(`audit-mov:${salida.tipo}/${entrada.tipo}`);
    validarEventoAuditableV1({
      tipo: salida.tipo,
      actor: salida.actorReal.tipo,
      origen: salida.origen,
      sujeto: salida.sujeto,
      flujo: salida.flujo,
      productor: salida.productor,
      rolEvento: salida.rolEvento,
      payload: salida.payload
    });
    validarEventoAuditableV1({
      tipo: entrada.tipo,
      actor: entrada.actorReal.tipo,
      origen: entrada.origen,
      sujeto: entrada.sujeto,
      flujo: entrada.flujo,
      productor: entrada.productor,
      rolEvento: entrada.rolEvento,
      payload: entrada.payload
    });
    validarParMovimientoAuditoriaV1(salida, entrada);
    const eventos = [
      Object.freeze({
        ...salida,
        secuencia: String(this.eventos.length + 1),
        registradoEnUtc: salida.efectivoEnUtc,
        estado: 'incorporado'
      }),
      Object.freeze({
        ...entrada,
        secuencia: String(this.eventos.length + 2),
        registradoEnUtc: entrada.efectivoEnUtc,
        estado: 'incorporado'
      })
    ];
    validarSobreCanonicoFixture(eventos[0]);
    validarSobreCanonicoFixture(eventos[1]);
    this.eventos.push(...eventos);
    return {
      estado: 'incorporado',
      salida: eventos[0],
      entrada: eventos[1],
      genesis: [],
      esNoOp: false
    };
  }
}

function contextoAdmin() {
  return {
    idUsuario: 1,
    idUsuarioReal: 1,
    impersonacionActiva: false,
    nivelScope: 'portal'
  };
}

function usuarioFixture({
  id,
  usuario = 'operador',
  email = 'operador@example.test',
  activo = true,
  esSuperusuario = false,
  requiereCambioPassword = false,
  tenantId = null,
  empresaId = null,
  sitioId = null,
  versionSesion = 1,
  nombreMostrar = 'Operador',
  nombreCompleto = 'Operador',
  permisos = {}
}) {
  return {
    id,
    usuario,
    email,
    activo,
    esSuperusuario,
    requiereCambioPassword,
    tenantId,
    empresaId,
    sitioId,
    versionSesion,
    nombreMostrar,
    nombreCompleto,
    permisos: {
      serializar: () => ({ ...permisos })
    }
  };
}

function validarSobreCanonicoFixture(evento) {
  construirSobreCanonicoAuditoriaV1({
    eventoId: evento.eventoId,
    tipo: evento.tipo,
    versionContrato: evento.versionContrato,
    flujo: evento.flujo,
    claveCadena: evento.claveCadena,
    secuencia: evento.secuencia,
    actorReal: evento.actorReal,
    actorEfectivo: evento.actorEfectivo,
    modoActuacion: evento.modoActuacion,
    sujeto: evento.sujeto,
    origen: evento.origen,
    scope: evento.scope,
    correlacionId: evento.correlacionId,
    causalidad: evento.causalidad,
    productor: evento.productor,
    claveOperacion: evento.claveOperacion,
    rolEvento: evento.rolEvento,
    efectivoEnUtc: evento.efectivoEnUtc,
    registradoEnUtc: evento.registradoEnUtc,
    versionCanonicalizador: evento.versionCanonicalizador || PERFIL_JCS_AUDITORIA_V1,
    versionEncadenado: evento.versionEncadenado || VERSION_ENCADENADO_AUDITORIA_V1,
    payload: evento.payload
  });
}

main().catch((error) => {
  console.error('[usuarios] Falló la verificación de administración auditable.');
  console.error(error);
  process.exit(1);
});

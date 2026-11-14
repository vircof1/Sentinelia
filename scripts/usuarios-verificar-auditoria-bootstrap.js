import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { ServicioAutorizacion } from '../paquetes/autorizacion/src/ServicioAutorizacion.js';
import { PermisosUsuario } from '../paquetes/autorizacion/src/PermisosUsuario.js';
import { validarEventoAuditableV1 } from '../paquetes/auditoria/src/ValidadorContratoAuditoria.js';
import { prepararIntencionAuditoriaV1 } from '../paquetes/auditoria/src/HuellaIntencionAuditoria.js';
import { AsignadorPermisosUsuario } from '../paquetes/usuarios/src/AsignadorPermisosUsuario.js';
import { ControladorBootstrapUsuarioInicial } from '../paquetes/usuarios/src/ControladorBootstrapUsuarioInicial.js';
import { RepositorioUsuarios } from '../paquetes/usuarios/src/RepositorioUsuarios.js';
import { ServicioUsuarios } from '../paquetes/usuarios/src/ServicioUsuarios.js';

async function verificarEsquemaInicial() {
  const esquemaInicial = await readFile(new URL(
    '../migraciones/sql/0001_esquema_inicial.sql',
    import.meta.url
  ), 'utf8');
  assert.match(
    esquemaInicial,
    /`permiso_ver_auditoria`\s+tinyint\(1\)\s+NOT NULL\s+DEFAULT\s+0/i
  );
  assert.match(esquemaInicial, /CREATE TABLE `cabecera_bootstrap_usuario_inicial`/i);
  assert.match(esquemaInicial, /CHECK \(`id` = 1\)/i);
  assert.match(esquemaInicial, /INSERT INTO `cabecera_bootstrap_usuario_inicial` VALUES/i);
  await verificarCableadoProductivo();
}

async function verificarCableadoProductivo() {
  for (const ruta of [
    '../apps/sentinelia-web/src/index.js',
    '../apps/sentinelia-runtime/src/BootstrapRuntime.js',
    './crear-usuario-inicial.js'
  ]) {
    const fuente = await readFile(new URL(ruta, import.meta.url), 'utf8');
    const inicio = fuente.indexOf('new ControladorBootstrapUsuarioInicial({');
    assert.notEqual(inicio, -1, `Falta el bootstrap productivo en ${ruta}.`);
    const cableado = fuente.slice(inicio, inicio + 500);
    assert.match(cableado, /fronteraTransaccional/);
    assert.match(cableado, /servicioAuditoria/);
  }
}

async function verificarRepositorioSerializado() {
  const repositorio = new RepositorioUsuarios({});
  await assert.rejects(
    repositorio.crearUsuarioInicialEnTransaccion({
      usuario: 'sin-conexion', email: 'sin-conexion@example.invalid',
      hashPassword: 'hash'
    }),
    /conexión SQL prestada/
  );
  const conexion = new ConexionBootstrapEspia();
  const creada = await repositorio.crearUsuarioInicialEnTransaccion({
    usuario: 'primero',
    email: 'primero@example.invalid',
    hashPassword: 'hash-opaco',
    nombreMostrar: 'Primer administrador'
  }, { conexion });
  assert.deepEqual(creada, {
    creado: true,
    usuarioId: '71',
    totalUsuarios: 1
  });
  assert.equal(conexion.inserciones, 1);
  assert.match(conexion.sqlInsercion, /permiso_ver_auditoria/i);
  assert.match(conexion.sqlInsercion, /VALUES\s*\([\s\S]*1,\s*1,\s*1,\s*1,\s*1,/i);
  assert.ok(
    conexion.traza.indexOf('lock:cabecera') < conexion.traza.indexOf('lock:usuarios')
  );
  assert.ok(
    conexion.traza.indexOf('lock:usuarios') < conexion.traza.indexOf('insert:usuario')
  );
  conexion.existeUsuario = true;
  const repetida = await repositorio.crearUsuarioInicialEnTransaccion({
    usuario: 'segundo',
    email: 'segundo@example.invalid',
    hashPassword: 'hash-opaco-2'
  }, { conexion });
  assert.equal(repetida.creado, false);
  assert.equal(repetida.totalUsuarios, 1);
  assert.equal(conexion.inserciones, 1);
  const sinCabecera = new ConexionBootstrapEspia();
  sinCabecera.tieneCabecera = false;
  await assert.rejects(
    repositorio.crearUsuarioInicialEnTransaccion({
      usuario: 'sin-cabecera', email: 'sin@example.invalid', hashPassword: 'hash'
    }, { conexion: sinCabecera }),
    /cabecera de coordinación/
  );
}

async function verificarBootstrapAuditableAtomico() {
  const fixture = crearFixtureControlador();
  const resultado = await fixture.controlador.arrancarSiProcede();
  assert.equal(resultado.creado, true);
  assert.equal(fixture.estado.usuarios.length, 1);
  assert.equal(fixture.estado.usuarios[0].permisoVerAuditoria, true);
  assert.deepEqual(fixture.estado.usuarios[0].scope, {
    tenantId: null,
    empresaId: null,
    sitioId: null
  });
  assert.equal(fixture.estado.eventos.length, 1);
  const evento = fixture.estado.eventos[0];
  const validado = validarEventoAuditableV1({
    tipo: evento.tipo,
    actor: evento.actorReal.tipo,
    origen: evento.origen,
    sujeto: evento.sujeto,
    flujo: evento.flujo,
    productor: evento.productor,
    rolEvento: evento.rolEvento,
    payload: evento.payload
  });
  assert.equal(validado.perfil, 'alta_v1');
  assert.deepEqual(evento.actorReal, {
    tipo: 'sistema',
    id: 'sentinelia-system'
  });
  assert.equal(evento.actorEfectivo, null);
  assert.equal(evento.modoActuacion, 'directo');
  assert.equal(evento.claveCadena, 'usuarios:portal');
  assert.deepEqual(evento.scope, {
    tenantId: null,
    empresaId: null,
    sitioId: null
  });
  assert.equal(evento.payload.despues.permisoVerAuditoria, true);
  assert.equal(JSON.stringify(evento).includes('hash-opaco'), false);
  const preparada = prepararIntencionAuditoriaV1(evento);
  assert.equal(preparada.intencion.claveOperacion, 'bootstrap:usuario_inicial:1');
  assert.equal(preparada.huella.length, 32);
  assert.deepEqual(fixture.estado.traza, [
    'contar', 'hash', 'begin', 'crear', 'auditar', 'commit'
  ]);
}

async function verificarCompetenciaYUsuariosExistentes() {
  const fixture = crearFixtureControlador();
  await fixture.controlador.arrancarSiProcede();
  fixture.estado.traza.length = 0;
  const segunda = await fixture.controlador.arrancarSiProcede();
  assert.equal(segunda.creado, false);
  assert.equal(fixture.estado.usuarios.length, 1);
  assert.equal(fixture.estado.eventos.length, 1);
  assert.deepEqual(fixture.estado.traza, ['contar']);

  const carrera = crearFixtureControlador({ ocultarConteoInicial: true });
  carrera.estado.usuarios.push({ id: '99' });
  const perdida = await carrera.controlador.arrancarSiProcede();
  assert.equal(perdida.creado, false);
  assert.equal(carrera.estado.eventos.length, 0);
  assert.deepEqual(carrera.estado.traza, [
    'contar', 'hash', 'begin', 'crear', 'commit'
  ]);
}

async function verificarRollbackAuditoria() {
  const fixture = crearFixtureControlador({ fallarAuditoria: true });
  await assert.rejects(
    fixture.controlador.arrancarSiProcede(),
    /auditoría indisponible/
  );
  assert.equal(fixture.estado.usuarios.length, 0);
  assert.equal(fixture.estado.eventos.length, 0);
  assert.equal(fixture.estado.traza.at(-1), 'rollback');
}

function verificarDelegacionYScope() {
  const asignador = new AsignadorPermisosUsuario();
  assert.equal(asignador.construirPermisosIniciales().verAuditoria, 0);
  const servicio = Object.create(ServicioUsuarios.prototype);
  servicio.asignadorPermisosUsuario = asignador;
  servicio.servicioAutorizacion = new ServicioAutorizacion();
  const sinPermiso = {
    nivelScope: 'portal',
    permisos: new PermisosUsuario({ administrarUsuarios: true })
  };
  const conPermiso = {
    nivelScope: 'portal',
    permisos: new PermisosUsuario({
      administrarUsuarios: true,
      verAuditoria: true
    })
  };
  assert.equal(
    servicio.puedeOtorgarClavePermiso(sinPermiso, 'permiso_ver_auditoria'),
    false
  );
  assert.equal(
    servicio.puedeOtorgarClavePermiso(conPermiso, 'permiso_ver_auditoria'),
    true
  );
  assert.equal(
    servicio.construirPermisosObjetivoDesdeFormulario({
      contextoUsuarioActual: sinPermiso,
      datos: { permiso_ver_auditoria: '1', nivelScope: 'portal' }
    }).verAuditoria,
    0
  );
  assert.equal(
    servicio.construirPermisosObjetivoDesdeFormulario({
      contextoUsuarioActual: conPermiso,
      datos: { permiso_ver_auditoria: '1', nivelScope: 'tenant' }
    }).verAuditoria,
    1,
    'La capacidad delegada conserva después el filtrado por scope histórico.'
  );
}

function crearFixtureControlador({
  fallarAuditoria = false,
  ocultarConteoInicial = false
} = {}) {
  const estado = {
    usuarios: [],
    eventos: [],
    traza: [],
    siguienteId: 1
  };
  let primeraConsulta = true;
  const repositorioUsuarios = {
    async contarUsuarios() {
      estado.traza.push('contar');
      if (ocultarConteoInicial && primeraConsulta) {
        primeraConsulta = false;
        return 0;
      }
      return estado.usuarios.length;
    },
    async crearUsuarioInicialEnTransaccion(datos, { conexion }) {
      estado.traza.push('crear');
      if (conexion.usuarios.length > 0) {
        return {
          creado: false,
          usuarioId: null,
          totalUsuarios: conexion.usuarios.length
        };
      }
      const usuarioId = String(estado.siguienteId++);
      conexion.usuarios.push({
        id: usuarioId,
        usuario: datos.usuario,
        hashPassword: datos.hashPassword,
        permisoVerAuditoria: true,
        scope: { tenantId: null, empresaId: null, sitioId: null }
      });
      return { creado: true, usuarioId, totalUsuarios: 1 };
    }
  };
  const fronteraTransaccional = {
    async ejecutar(trabajo) {
      estado.traza.push('begin');
      const conexion = {
        execute() {},
        usuarios: structuredClone(estado.usuarios),
        eventos: structuredClone(estado.eventos)
      };
      try {
        const resultado = await trabajo(conexion);
        estado.usuarios = conexion.usuarios;
        estado.eventos = conexion.eventos;
        estado.traza.push('commit');
        return resultado;
      } catch (error) {
        estado.traza.push('rollback');
        throw error;
      }
    }
  };
  const servicioAuditoria = {
    async registrarEnTransaccion({ intencion }, { conexion }) {
      estado.traza.push('auditar');
      if (fallarAuditoria) throw new Error('auditoría indisponible');
      conexion.eventos.push(structuredClone(intencion));
    }
  };
  const controlador = new ControladorBootstrapUsuarioInicial({
    repositorioUsuarios,
    servicioAutenticacion: {
      validarPasswordNueva() {},
      async crearHashPassword() {
        estado.traza.push('hash');
        return 'hash-opaco';
      }
    },
    configuracionUsuarioInicial: {
      usuario: 'admin',
      password: 'Password-segura-1',
      email: 'admin@example.invalid',
      nombreMostrar: 'Administrador'
    },
    fronteraTransaccional,
    servicioAuditoria,
    ahora: () => new Date('2026-07-25T08:00:00.000Z')
  });
  return { controlador, estado };
}

class ConexionBootstrapEspia {
  constructor() {
    this.tieneCabecera = true;
    this.existeUsuario = false;
    this.inserciones = 0;
    this.sqlInsercion = '';
    this.traza = [];
  }

  async execute(sql) {
    const normalizada = String(sql).replace(/\s+/g, ' ').trim();
    if (/FROM cabecera_bootstrap_usuario_inicial/i.test(normalizada) &&
        /FOR UPDATE/i.test(normalizada)) {
      this.traza.push('lock:cabecera');
      return [this.tieneCabecera ? [{ id: 1 }] : []];
    }
    if (/FROM usuarios/i.test(normalizada) && /LIMIT 1 FOR UPDATE/i.test(normalizada)) {
      this.traza.push('lock:usuarios');
      return [this.existeUsuario ? [{ id: '71' }] : []];
    }
    if (/SELECT COUNT\(\*\) AS total FROM usuarios/i.test(normalizada)) {
      return [[{ total: this.existeUsuario ? 1 : 0 }]];
    }
    if (/^INSERT INTO usuarios/i.test(normalizada)) {
      this.traza.push('insert:usuario');
      this.inserciones += 1;
      this.sqlInsercion = normalizada;
      this.existeUsuario = true;
      return [{ insertId: 71, affectedRows: 1 }];
    }
    if (/^UPDATE cabecera_bootstrap_usuario_inicial/i.test(normalizada)) {
      this.traza.push('update:cabecera');
      return [{ affectedRows: 1 }];
    }
    throw new Error(`SQL no contemplado por el fixture: ${normalizada}`);
  }
}

await verificarEsquemaInicial();
await verificarRepositorioSerializado();
await verificarBootstrapAuditableAtomico();
await verificarCompetenciaYUsuariosExistentes();
await verificarRollbackAuditoria();
verificarDelegacionYScope();

console.log(
  '[gate:bootstrap-usuario] OK: permiso=default_0 bootstrap=primero_y_portal ' +
  'alta=SQL_auditable_atomica concurrencia=serializada ' +
  'delegacion=no_escalable ordinarios=denegados rollback=completo'
);

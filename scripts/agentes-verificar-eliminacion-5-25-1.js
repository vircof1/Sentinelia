import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { readFile } from 'node:fs/promises';

import { PermisosUsuario } from '../paquetes/autorizacion/src/PermisosUsuario.js';
import { ServicioAutorizacion } from '../paquetes/autorizacion/src/ServicioAutorizacion.js';
import { PoliticaPermisosAgentes } from '../paquetes/agentes/src/PoliticaPermisosAgentes.js';
import {
  ErrorAutorizacionEliminacionAdministrativaAgente,
  ServicioAutorizacionEliminacionAdministrativaAgente
} from '../paquetes/agentes/src/ServicioAutorizacionEliminacionAdministrativaAgente.js';
import { AsignadorPermisosUsuario } from '../paquetes/usuarios/src/AsignadorPermisosUsuario.js';
import { RepositorioUsuarios } from '../paquetes/usuarios/src/RepositorioUsuarios.js';
import { ServicioUsuarios } from '../paquetes/usuarios/src/ServicioUsuarios.js';
import { Usuario } from '../paquetes/usuarios/src/Usuario.js';
import { ClienteSql } from '../paquetes/persistencia-sql/src/ClienteSql.js';
import { EjecutorMigraciones } from '../paquetes/persistencia-sql/src/EjecutorMigraciones.js';
import { RepositorioMigraciones } from '../paquetes/persistencia-sql/src/RepositorioMigraciones.js';
import {
  obtenerConfiguracionAplicacion,
  obtenerRutaMigraciones
} from '../paquetes/utilidades/src/configuracion/obtenerConfiguracionAplicacion.js';

const RAIZ_NODE = new URL('../', import.meta.url);
const INSTANTE_ACEPTACION = '2026-08-30T12:34:56.789Z';

await verificarMigracionDenegadaPorDefecto();
await verificarPersistenciaSqlReal();
verificarModeloDependenciasYDelegacion();
await verificarPropagacionExhaustiva();
await verificarActuacionDirectaYOrdenDeLocks();
await verificarMatrizImpersonacion();
await verificarScopesYActividad();
await verificarFotografiaNoRevocable();
await verificarAusenciaDeSuperficiePublica();

console.log(
  '[agentes] OK 5.25.1: permiso=default_falso dependencia=solo_ver ' +
  'delegacion=no_escalable autoridad=real_y_efectiva locks=orden_estable ' +
  'scope=independiente fotografia=inmutable ruta_publica=0'
);

async function verificarMigracionDenegadaPorDefecto() {
  const sql = await leer('migraciones/sql/0001_esquema_inicial.sql');
  assert.match(
    sql,
    /permiso_eliminar_agentes. tinyint\(1\) NOT NULL DEFAULT 0/i
  );
}

async function verificarPersistenciaSqlReal() {
  const configuracion = obtenerConfiguracionAplicacion();
  assert.equal(
    configuracion.sql.estaCompleta,
    true,
    '5.25.1 necesita SQL real para verificar el permiso y sus consultas.'
  );
  const baseDatos = `sentinelia_fixture_5251_${randomBytes(6).toString('hex')}`;
  const administrador = new ClienteSql(configuracion.sql);
  await administrador.ejecutar(
    `CREATE DATABASE ${administrador.escaparIdentificador(baseDatos)} ` +
    'CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci'
  );
  const sql = new ClienteSql({ ...configuracion.sql, baseDatos });
  try {
    await new EjecutorMigraciones({
      clienteSql: sql,
      repositorioMigraciones: new RepositorioMigraciones(sql),
      rutaMigraciones: obtenerRutaMigraciones()
    }).ejecutarPendientes();
    await sql.verificarUsoHorarioUtc();

    const [columna] = await sql.consultar(
      `SELECT COLUMN_TYPE AS tipo, IS_NULLABLE AS nullable,
              COLUMN_DEFAULT AS valor_por_defecto
         FROM information_schema.COLUMNS
        WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='usuarios'
          AND COLUMN_NAME='permiso_eliminar_agentes'`
    );
    assert.equal(columna.tipo.toLowerCase(), 'tinyint(1)');
    assert.equal(columna.nullable, 'NO');
    assert.equal(String(columna.valor_por_defecto), '0');

    const repositorio = new RepositorioUsuarios(sql);
    const conexion = await sql.obtenerConexion();
    try {
      await conexion.beginTransaction();
      const bootstrap = await repositorio.crearUsuarioInicialEnTransaccion({
        usuario: 'permiso-bootstrap',
        email: 'permiso-bootstrap@example.invalid',
        hashPassword: 'hash-no-utilizable',
        nombreMostrar: 'Bootstrap'
      }, { conexion });
      assert.equal(bootstrap.creado, true);
      await conexion.commit();
    } catch (error) {
      await conexion.rollback().catch(() => {});
      throw error;
    } finally {
      await conexion.release();
    }
    assert.equal(
      (await repositorio.buscarPorUsuario('permiso-bootstrap'))
        .permisos.eliminarAgentes,
      true,
      'El primer administrador de una instalación nueva debe recibir la capacidad explícita.'
    );

    await sql.ejecutar(
      'INSERT INTO usuarios (usuario,email,hash_password) VALUES (?,?,?)',
      ['permiso-default', 'permiso-default@example.invalid', 'hash-no-utilizable']
    );
    const porDefecto = await repositorio.buscarPorUsuario('permiso-default');
    assert.equal(porDefecto.permisos.eliminarAgentes, false);

    const permisos = new AsignadorPermisosUsuario().construirPermisosIniciales();
    const administrativo = await repositorio.crearUsuarioAdministrativo({
      usuario: 'permiso-administrativo',
      email: 'permiso-administrativo@example.invalid',
      hashPassword: 'hash-no-utilizable',
      nombreMostrar: 'Permiso administrativo',
      nombreCompleto: null,
      tenantId: null,
      empresaId: null,
      sitioId: null,
      permisos
    });
    assert.equal(administrativo.permisos.eliminarAgentes, false);
    permisos.eliminarAgentes = 1;
    permisos.verAgentes = 1;
    const actualizado = await repositorio.actualizarUsuarioAdministrativo({
      idUsuario: administrativo.id,
      email: administrativo.email,
      nombreMostrar: administrativo.nombreMostrar,
      nombreCompleto: administrativo.nombreCompleto,
      tenantId: null,
      empresaId: null,
      sitioId: null,
      permisos,
      incrementarVersionSesion: true
    });
    assert.equal(actualizado.permisos.eliminarAgentes, true);
  } finally {
    await sql.cerrar();
    await administrador.ejecutar(
      `DROP DATABASE IF EXISTS ${administrador.escaparIdentificador(baseDatos)}`
    ).catch(() => {});
    await administrador.cerrar();
  }
}

function verificarModeloDependenciasYDelegacion() {
  const asignador = new AsignadorPermisosUsuario();
  const autorizacion = new ServicioAutorizacion();
  const politica = new PoliticaPermisosAgentes();
  assert.equal(new PermisosUsuario({}).eliminarAgentes, false);
  assert.equal(asignador.construirPermisosIniciales().eliminarAgentes, 0);
  assert.equal(
    asignador.obtenerDefinicionesPermisos().some(
      ({ claveFormulario }) => claveFormulario === 'permiso_eliminar_agentes'
    ),
    true
  );

  const eliminar = asignador.construirPermisosDesdeFormulario({
    permiso_eliminar_agentes: '1'
  });
  assert.equal(eliminar.eliminarAgentes, 1);
  assert.equal(eliminar.verAgentes, 1);
  assert.equal(eliminar.modificarAgentes, 0);

  const modificar = asignador.construirPermisosDesdeFormulario({
    permiso_modificar_agentes: '1'
  });
  assert.equal(modificar.modificarAgentes, 1);
  assert.equal(modificar.verAgentes, 1);
  assert.equal(modificar.eliminarAgentes, 0);

  const contextoConPermiso = {
    permisos: new PermisosUsuario({ eliminarAgentes: true })
  };
  assert.equal(autorizacion.puedeEliminarAgentes(contextoConPermiso), true);
  assert.equal(
    autorizacion.resolverPermiso('eliminar_agentes', contextoConPermiso),
    true
  );
  assert.equal(politica.puedeEliminar(contextoConPermiso), true);

  const servicio = Object.create(ServicioUsuarios.prototype);
  servicio.asignadorPermisosUsuario = asignador;
  servicio.servicioAutorizacion = autorizacion;
  const sinPermiso = {
    permisos: new PermisosUsuario({ modificarAgentes: true })
  };
  assert.equal(
    servicio.puedeOtorgarClavePermiso(sinPermiso, 'permiso_eliminar_agentes'),
    false
  );
  assert.equal(
    servicio.puedeOtorgarClavePermiso(
      contextoConPermiso,
      'permiso_eliminar_agentes'
    ),
    true
  );
  assert.equal(
    servicio.construirPermisosObjetivoDesdeFormulario({
      contextoUsuarioActual: sinPermiso,
      datos: { permiso_eliminar_agentes: '1', nivelScope: 'portal' }
    }).eliminarAgentes,
    0,
    'Modificar agentes no puede escalar hacia eliminación.'
  );
  assert.equal(
    servicio.construirPermisosObjetivoDesdeFormulario({
      contextoUsuarioActual: contextoConPermiso,
      datos: { permiso_eliminar_agentes: '1', nivelScope: 'portal' }
    }).eliminarAgentes,
    1
  );
}

async function verificarPropagacionExhaustiva() {
  const archivos = {
    permisos: await leer('paquetes/autorizacion/src/PermisosUsuario.js'),
    usuario: await leer('paquetes/usuarios/src/Usuario.js'),
    repositorio: await leer('paquetes/usuarios/src/RepositorioUsuarios.js'),
    asignador: await leer('paquetes/usuarios/src/AsignadorPermisosUsuario.js'),
    servicio: await leer('paquetes/autorizacion/src/ServicioAutorizacion.js'),
    politica: await leer('paquetes/agentes/src/PoliticaPermisosAgentes.js'),
    ui: await leer('apps/sentinelia-web/src/public/js/usuarios.js'),
    script: await leer('scripts/asignar-permisos-usuario.js'),
    semilla: await leer('scripts/sembrar-datos-ejemplo.js')
  };
  for (const [nombre, contenido] of Object.entries(archivos)) {
    assert.equal(
      /eliminar[_A-Z]?agentes|ELIMINAR_AGENTES|eliminarAgentes/i.test(contenido),
      true,
      `${nombre} no propaga el permiso destructivo.`
    );
  }
  assert.ok(
    contar(archivos.repositorio, 'permiso_eliminar_agentes') >= 4,
    'El repositorio debe propagar lectura, bootstrap, alta y actualización.'
  );
  verificarAridadInsertUsuarios(archivos.repositorio);
  verificarAridadInsertUsuarios(archivos.semilla);

  const usuario = new Usuario(filaUsuario({ permiso_eliminar_agentes: 1 }));
  assert.equal(usuario.permisos.eliminarAgentes, true);
  assert.equal(usuario.obtenerResumenAdministracion({
    resolutorScopeUsuario: {
      resolverNivelScope() { return 'portal'; }
    }
  }).permisos.eliminarAgentes, true);
}

async function verificarActuacionDirectaYOrdenDeLocks() {
  const entorno = crearEntorno({
    usuarios: [usuario({ id: '10', nivel: 'portal' })]
  });
  const fotografia = await entorno.servicio.autorizar({
    actorRealId: '10',
    agenteId: '900'
  });
  assert.deepEqual(entorno.llamadas, [
    'transaccion:inicio',
    'usuario:10:for_update',
    'agente:900',
    'transaccion:fin'
  ]);
  assert.equal(fotografia.actorReal.usuarioId, '10');
  assert.deepEqual(fotografia.actorReal, fotografia.actorEfectivo);
  assert.equal(fotografia.destinatarioUsuarioId, '10');
  assert.equal(fotografia.aceptadaEnUtc, INSTANTE_ACEPTACION);
  assert.equal(Object.isFrozen(fotografia), true);

  const ordenado = crearEntorno({
    usuarios: [
      usuario({ id: '20', nivel: 'tenant', tenantId: '1' }),
      usuario({ id: '3', nivel: 'sitio', tenantId: '1', empresaId: '2', sitioId: '3' })
    ]
  });
  await ordenado.servicio.autorizar({
    actorRealId: '20',
    actorEfectivoId: '3',
    agenteId: '900'
  });
  assert.deepEqual(ordenado.llamadas.slice(1, 3), [
    'usuario:3:for_update',
    'usuario:20:for_update'
  ]);
}

async function verificarMatrizImpersonacion() {
  for (const caso of [
    { real: true, efectivo: true, autorizada: true },
    { real: true, efectivo: false, autorizada: false },
    { real: false, efectivo: true, autorizada: false },
    { real: false, efectivo: false, autorizada: false }
  ]) {
    const entorno = crearEntorno({
      usuarios: [
        usuario({ id: '5', nivel: 'portal', eliminarAgentes: caso.real }),
        usuario({
          id: '8',
          nivel: 'sitio',
          tenantId: '1',
          empresaId: '2',
          sitioId: '3',
          eliminarAgentes: caso.efectivo
        })
      ]
    });
    const ejecutar = () => entorno.servicio.autorizar({
      actorRealId: '5',
      actorEfectivoId: '8',
      agenteId: '900'
    });
    if (caso.autorizada) {
      const fotografia = await ejecutar();
      assert.equal(fotografia.actorReal.usuarioId, '5');
      assert.equal(fotografia.actorEfectivo.usuarioId, '8');
      assert.equal(fotografia.destinatarioUsuarioId, '5');
    } else {
      await assertDenegada(ejecutar);
      assert.equal(
        entorno.llamadas.some((llamada) => llamada.startsWith('agente:')),
        false,
        'Un actor sin permiso no debe provocar ni siquiera la lectura del agente.'
      );
    }
  }
}

async function verificarScopesYActividad() {
  const autorizada = crearEntorno({
    usuarios: [
      usuario({ id: '5', nivel: 'tenant', tenantId: '1' }),
      usuario({ id: '8', nivel: 'sitio', tenantId: '1', empresaId: '2', sitioId: '3' })
    ]
  });
  await autorizada.servicio.autorizar({
    actorRealId: '5', actorEfectivoId: '8', agenteId: '900'
  });

  for (const usuarios of [
    [
      usuario({ id: '5', nivel: 'tenant', tenantId: '99' }),
      usuario({ id: '8', nivel: 'sitio', tenantId: '1', empresaId: '2', sitioId: '3' })
    ],
    [
      usuario({ id: '5', nivel: 'tenant', tenantId: '1' }),
      usuario({ id: '8', nivel: 'sitio', tenantId: '1', empresaId: '2', sitioId: '99' })
    ],
    [
      usuario({ id: '5', nivel: 'portal', activo: false }),
      usuario({ id: '8', nivel: 'portal' })
    ],
    [
      usuario({ id: '5', nivel: 'portal' }),
      usuario({ id: '8', nivel: 'portal', activo: false })
    ]
  ]) {
    const entorno = crearEntorno({ usuarios });
    await assertDenegada(() => entorno.servicio.autorizar({
      actorRealId: '5', actorEfectivoId: '8', agenteId: '900'
    }));
  }
}

async function verificarFotografiaNoRevocable() {
  const real = usuario({ id: '5', nivel: 'portal' });
  const efectivo = usuario({
    id: '8', nivel: 'sitio', tenantId: '1', empresaId: '2', sitioId: '3'
  });
  const entorno = crearEntorno({ usuarios: [real, efectivo] });
  const fotografia = await entorno.servicio.autorizar({
    actorRealId: '5', actorEfectivoId: '8', agenteId: '900'
  });
  real.activo = false;
  efectivo.activo = false;
  real.permisos = new PermisosUsuario({});
  efectivo.permisos = new PermisosUsuario({});
  efectivo.sitioId = '99';
  assert.equal(fotografia.decision, 'autorizada');
  assert.equal(fotografia.actorReal.estado, 'activo');
  assert.equal(fotografia.actorEfectivo.scope.sitioId, '3');
  assert.throws(() => {
    fotografia.actorEfectivo.scope.sitioId = '99';
  }, TypeError);
}

async function verificarAusenciaDeSuperficiePublica() {
  const rutas = await readFile(
    new URL('apps/sentinelia-web/src/rutas/crearRutasPortal.js', RAIZ_NODE),
    'utf8'
  );
  assert.match(
    rutas,
    /'\/agentes\/:id\/eliminar',[\s\S]{0,120}requerirEliminacionAdministrativaAgentesHttp/u,
    'La ruta incorporada después debe seguir fuera de la superficie pública.'
  );
}

function crearEntorno({ usuarios, agente = agenteObjetivo() }) {
  const llamadas = [];
  const conexion = { async execute() { return [[], []]; } };
  const porId = new Map(usuarios.map((entrada) => [String(entrada.id), entrada]));
  const servicio = new ServicioAutorizacionEliminacionAdministrativaAgente({
    repositorioUsuarios: {
      async buscarPorIdEnTransaccion(id, { conexion: prestada, forUpdate }) {
        assert.equal(prestada, conexion);
        llamadas.push(`usuario:${id}:${forUpdate ? 'for_update' : 'sin_lock'}`);
        return porId.get(String(id)) || null;
      }
    },
    repositorioAgentes: {
      async buscarPorIdConConexion(id, { conexion: prestada }) {
        assert.equal(prestada, conexion);
        llamadas.push(`agente:${id}`);
        return String(id) === String(agente.id) ? agente : null;
      }
    },
    fronteraTransaccional: {
      async ejecutar(trabajo) {
        llamadas.push('transaccion:inicio');
        const resultado = await trabajo(conexion);
        llamadas.push('transaccion:fin');
        return resultado;
      }
    },
    ahora: () => new Date(INSTANTE_ACEPTACION)
  });
  return { servicio, llamadas };
}

function usuario({
  id,
  nivel,
  tenantId = null,
  empresaId = null,
  sitioId = null,
  activo = true,
  eliminarAgentes = true
}) {
  const scopes = {
    portal: [null, null, null],
    tenant: [tenantId, null, null],
    empresa: [tenantId, empresaId, null],
    sitio: [tenantId, empresaId, sitioId]
  };
  const [tenant, empresa, sitio] = scopes[nivel];
  return {
    id: String(id),
    activo,
    tenantId: tenant,
    empresaId: empresa,
    sitioId: sitio,
    permisos: new PermisosUsuario({ eliminarAgentes })
  };
}

function agenteObjetivo() {
  return {
    id: '900',
    guid: '01991d7a-5678-7abc-8def-0123456789ab',
    tenantId: '1',
    empresaId: '2',
    sitioId: '3'
  };
}

async function assertDenegada(trabajo) {
  await assert.rejects(trabajo, (error) => {
    assert.equal(
      error instanceof ErrorAutorizacionEliminacionAdministrativaAgente,
      true
    );
    assert.equal(error.codigo, 'agente_eliminacion_no_autorizada');
    assert.equal(error.codigoHttp, 404);
    return true;
  });
}

function filaUsuario(sobrescrituras = {}) {
  return {
    id: 1,
    usuario: 'operador',
    email: 'operador@example.invalid',
    email_validado: 1,
    hash_password: 'hash-no-utilizable',
    activo: 1,
    es_superusuario: 0,
    requiere_cambio_password: 0,
    version_sesion: 1,
    ultimo_acceso: null,
    contador_accesos: 0,
    nombre_mostrar: 'Operador',
    nombre_completo: null,
    tenant_id: null,
    empresa_id: null,
    sitio_id: null,
    fecha_creacion: null,
    fecha_actualizacion: null,
    preferencia_mostrar_alertas_remotas: 0,
    ...sobrescrituras
  };
}

function verificarAridadInsertUsuarios(contenido) {
  const patron = /INSERT INTO usuarios\s*\(([\s\S]*?)\)\s*VALUES\s*\(([^)]*)\)/giu;
  const sentencias = [...contenido.matchAll(patron)];
  assert.ok(sentencias.length > 0);
  for (const sentencia of sentencias) {
    const columnas = sentencia[1].split(',').map((valor) => valor.trim()).filter(Boolean);
    const valores = sentencia[2].split(',').map((valor) => valor.trim()).filter(Boolean);
    assert.equal(
      valores.length,
      columnas.length,
      'Cada INSERT de usuarios debe conservar la misma aridad entre columnas y valores.'
    );
  }
}

function contar(texto, fragmento) {
  return texto.split(fragmento).length - 1;
}

function leer(ruta) {
  return readFile(new URL(ruta, RAIZ_NODE), 'utf8');
}

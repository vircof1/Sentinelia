import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import { PermisosUsuario } from
  '../paquetes/autorizacion/src/PermisosUsuario.js';
import { ServicioAutorizacion } from
  '../paquetes/autorizacion/src/ServicioAutorizacion.js';
import { ServicioContextoUsuario } from
  '../paquetes/contexto-usuario/src/ServicioContextoUsuario.js';
import { AsignadorPermisosUsuario } from
  '../paquetes/usuarios/src/AsignadorPermisosUsuario.js';
import { ServicioUsuarios } from
  '../paquetes/usuarios/src/ServicioUsuarios.js';
import { Usuario } from '../paquetes/usuarios/src/Usuario.js';

const MIGRACION = '0001_esquema_inicial.sql';
const PERMISOS = Object.freeze([
  ['configurarEmisionesFederacion', 'configurar_emisiones_federacion'],
  ['configurarRecepcionesFederacion', 'configurar_recepciones_federacion'],
  ['activarRelacionesFederacion', 'activar_relaciones_federacion'],
  ['gestionarCredencialesFederacion', 'gestionar_credenciales_federacion'],
  ['transferirResponsabilidadFederacion', 'transferir_responsabilidad_federacion'],
  ['resolverConflictosFederacion', 'resolver_conflictos_federacion'],
  ['verDiagnosticoFederacion', 'ver_diagnostico_federacion'],
  ['verAvisosPlataforma', 'ver_avisos_plataforma'],
  ['verAlertasRemotas', 'ver_alertas_remotas']
]);

async function verificarPersistencia() {
  const [migracion, repositorio] = await Promise.all([
    leer(`../migraciones/sql/${MIGRACION}`).then((sql) => sql.replaceAll('`', '')),
    leer('../paquetes/usuarios/src/RepositorioUsuarios.js')
  ]);
  for (const [, clave] of PERMISOS) {
    const columna = `permiso_${clave}`;
    assert.match(
      migracion,
      new RegExp(`${columna}\\s+TINYINT\\(1\\) NOT NULL DEFAULT 0`, 'i')
    );
    assert.ok(repositorio.includes(columna), `Falta ${columna} en el repositorio.`);
  }
  assert.match(
    migracion,
    /preferencia_mostrar_alertas_remotas\s+TINYINT\(1\) NOT NULL DEFAULT 0/i
  );
  assert.ok(repositorio.includes('preferencia_mostrar_alertas_remotas'));
}

function verificarModeloAsignacionYScope() {
  const asignador = new AsignadorPermisosUsuario();
  const definiciones = asignador.obtenerDefinicionesPermisos();
  const clavesModelo = new Set(definiciones.map(({ claveModelo }) => claveModelo));
  const formulario = Object.fromEntries(
    PERMISOS.map(([, clave]) => [`permiso_${clave}`, 'on'])
  );
  const asignados = asignador.construirPermisosDesdeFormulario(formulario);

  for (const [modelo] of PERMISOS) {
    assert.ok(clavesModelo.has(modelo));
    assert.equal(asignados[modelo], 1);
  }
  asignador.aplicarRestriccionesPermisosPorScope(asignados, 'sitio');
  for (const [modelo] of PERMISOS) assert.equal(asignados[modelo], 1);

  const serializados = new PermisosUsuario(asignados).serializar();
  for (const [modelo] of PERMISOS) assert.equal(serializados[modelo], true);
  assert.equal('preferenciaMostrarAlertasRemotas' in serializados, false);
}

function verificarAutorizacionEImpersonacion() {
  const servicioAutorizacion = new ServicioAutorizacion();
  const permisos = new PermisosUsuario(Object.fromEntries(
    PERMISOS.map(([modelo]) => [modelo, true])
  ));
  const directo = { impersonacionActiva: false, permisos };
  const impersonado = { impersonacionActiva: true, permisos };

  for (const metodo of [
    'puedeConfigurarEmisionesFederacion',
    'puedeConfigurarRecepcionesFederacion',
    'puedeActivarRelacionesFederacion',
    'puedeGestionarCredencialesFederacion',
    'puedeTransferirResponsabilidadFederacion',
    'puedeResolverConflictosFederacion'
  ]) {
    assert.equal(servicioAutorizacion[metodo](directo), true);
    assert.equal(servicioAutorizacion[metodo](impersonado), false);
  }
  for (const metodo of [
    'puedeVerDiagnosticoFederacion',
    'puedeVerAvisosPlataforma',
    'puedeVerAlertasRemotas'
  ]) {
    assert.equal(servicioAutorizacion[metodo](directo), true);
    assert.equal(servicioAutorizacion[metodo](impersonado), true);
  }

  const servicioUsuarios = new ServicioUsuarios({
    servicioAutorizacion,
    asignadorPermisosUsuario: new AsignadorPermisosUsuario()
  });
  for (const [, clave] of PERMISOS) {
    assert.equal(
      servicioUsuarios.puedeOtorgarClavePermiso(directo, `permiso_${clave}`),
      true
    );
    assert.equal(
      servicioUsuarios.puedeOtorgarClavePermiso(impersonado, `permiso_${clave}`),
      false
    );
  }
  const datos = Object.fromEntries(
    PERMISOS.map(([, clave]) => [`permiso_${clave}`, 'on'])
  );
  const concedidos = servicioUsuarios.construirPermisosObjetivoDesdeFormulario({
    contextoUsuarioActual: directo,
    datos: { ...datos, nivelScope: 'sitio' },
    nivelScopeObjetivo: 'sitio'
  });
  const bloqueados = servicioUsuarios.construirPermisosObjetivoDesdeFormulario({
    contextoUsuarioActual: impersonado,
    datos: { ...datos, nivelScope: 'sitio' },
    nivelScopeObjetivo: 'sitio'
  });
  for (const [modelo] of PERMISOS) {
    assert.equal(concedidos[modelo], 1);
    assert.equal(bloqueados[modelo], 0);
  }
  assert.equal(
    servicioUsuarios.hayCambioPermisos(
      new AsignadorPermisosUsuario().construirPermisosIniciales(),
      concedidos
    ),
    true
  );
}

async function verificarContextoSesionYPreferencia() {
  const permisos = new PermisosUsuario({
    verDiagnosticoFederacion: true,
    verAvisosPlataforma: true,
    verAlertasRemotas: true
  });
  const real = crearUsuarioFalso({ id: 1, permisos });
  const efectivo = crearUsuarioFalso({
    id: 2,
    permisos,
    preferenciaMostrarAlertasRemotas: true
  });
  const usuarios = new Map([[1, real], [2, efectivo]]);
  const servicio = new ServicioContextoUsuario({
    repositorioUsuarios: {
      async buscarPorId(id) { return usuarios.get(Number(id)) || null; }
    },
    resolutorScopeUsuario: {
      resolverNivelScope() { return 'portal'; }
    }
  });
  const requisicion = {
    session: {
      usuarioAutenticado: {
        idUsuarioReal: 1,
        idUsuarioEfectivo: 2,
        versionSesionReal: 1,
        versionSesionEfectiva: 1,
        impersonacionActiva: true
      }
    }
  };
  const contexto = await servicio.cargarDesdeSesion(requisicion);
  assert.equal(contexto.impersonacionActiva, true);
  assert.equal(contexto.preferenciaMostrarAlertasRemotas, true);
  assert.equal(contexto.permisos.verAlertasRemotas, true);
  assert.equal(
    requisicion.session.usuarioAutenticado.preferenciaMostrarAlertasRemotas,
    true
  );
  assert.equal(
    requisicion.session.usuarioAutenticado.permisos.verAvisosPlataforma,
    true
  );

  const fila = crearFilaUsuario({
    preferencia_mostrar_alertas_remotas: 1,
    permiso_ver_alertas_remotas: 1
  });
  const usuario = new Usuario(fila);
  assert.equal(usuario.preferenciaMostrarAlertasRemotas, true);
  assert.equal(usuario.permisos.verAlertasRemotas, true);
}

function crearUsuarioFalso({
  id,
  permisos,
  preferenciaMostrarAlertasRemotas = false
}) {
  return {
    id,
    usuario: `usuario-${id}`,
    activo: true,
    versionSesion: 1,
    tenantId: null,
    empresaId: null,
    sitioId: null,
    permisos,
    preferenciaMostrarAlertasRemotas,
    obtenerNombreVisible() { return this.usuario; }
  };
}

function crearFilaUsuario(sobrescrituras = {}) {
  return {
    id: 1,
    usuario: 'federado',
    email: 'federado@example.invalid',
    email_validado: 1,
    hash_password: 'hash',
    activo: 1,
    es_superusuario: 0,
    requiere_cambio_password: 0,
    version_sesion: 1,
    ultimo_acceso: null,
    contador_accesos: 0,
    nombre_mostrar: 'Federado',
    nombre_completo: null,
    tenant_id: null,
    empresa_id: null,
    sitio_id: null,
    fecha_creacion: null,
    fecha_actualizacion: null,
    ...sobrescrituras
  };
}

async function leer(ruta) {
  return readFile(new URL(ruta, import.meta.url), 'utf8');
}

await verificarPersistencia();
verificarModeloAsignacionYScope();
verificarAutorizacionEImpersonacion();
await verificarContextoSesionYPreferencia();

console.log('[federacion] OK 5.22.10d: permisos=9 scope=actual sesion=viva impersonacion=solo_lectura preferencia=no_autoridad');

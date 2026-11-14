import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import {
  calcularConcesionEfectivaFederacion,
  compararSeleccionesConcesionFederacion,
  crearDeclaracionConcesionFederacion,
  crearLimitesAutoridadActualFederacion,
  crearResponsabilidadFederada,
  crearRevisionConcesionFederacion,
  crearScopeFederacion
} from '../paquetes/federacion/src/index.js';
import { ServicioControlFederacion } from '../paquetes/federacion/aplicacion/ServicioControlFederacion.js';
import { RepositorioControlFederacionSql } from '../paquetes/federacion/adaptadores/RepositorioControlFederacionSql.js';
import { AdaptadorAuditoriaControlFederacion } from '../paquetes/federacion/adaptadores/AdaptadorAuditoriaControlFederacion.js';
import { RepositorioAuditoria } from '../paquetes/auditoria/src/RepositorioAuditoria.js';
import { ServicioAvisosPlataforma } from '../paquetes/avisos-plataforma/src/ServicioAvisosPlataforma.js';
import { RepositorioAvisosPlataformaSql } from '../paquetes/avisos-plataforma/src/RepositorioAvisosPlataformaSql.js';
import { AdaptadorAuditoriaAvisosPlataforma } from '../paquetes/avisos-plataforma/src/AdaptadorAuditoriaAvisosPlataforma.js';
import { generarUuidV7Auditoria, uuidV7AuditoriaABytes } from '../paquetes/auditoria/src/UuidV7Auditoria.js';
import { ClienteSql } from '../paquetes/persistencia-sql/src/ClienteSql.js';
import { EjecutorMigraciones } from '../paquetes/persistencia-sql/src/EjecutorMigraciones.js';
import { RepositorioMigraciones } from '../paquetes/persistencia-sql/src/RepositorioMigraciones.js';
import { obtenerConfiguracionAplicacion, obtenerRutaMigraciones } from '../paquetes/utilidades/src/configuracion/obtenerConfiguracionAplicacion.js';

const RELACION = `sfid1.relacion.${'I'.repeat(21)}A`;
const INSTALACION = `sfid1.instalacion.${'J'.repeat(21)}Q`;
const REVISIONES = ['K', 'L', 'M', 'N', 'O'].map((c) =>
  `sfid1.revision_concesion.${c.repeat(21)}A`);
const MIGRACION_ESQUEMA = '0001_esquema_inicial.sql';

await main();

async function main() {
  verificarDominio();
  await verificarEstructura();
  const configuracion = obtenerConfiguracionAplicacion();
  assert.equal(configuracion.sql.estaCompleta, true);
  const sql = new ClienteSql(configuracion.sql);
  try {
    await migrar(sql);
    await limpiar(sql);
    await insertarUsuariosResponsables(sql);
    await insertarRelacion(sql);
    await verificarControl(sql);
  } finally {
    await limpiar(sql);
    await sql.cerrar();
  }
  console.log('[federacion] OK 5.22.10i: concesiones=inmutables replay=idempotente autoridad=reevaluada selectores=tipados reducciones=inmediatas ampliaciones=bilaterales cortes=versionados transferencias=sin-reactivacion tombstones=durables concurrencia=serializada');
}

function verificarDominio() {
  const base = declaracion(['estado']);
  const amplia = declaracion(['estado', 'historico']);
  assert.equal(compararSeleccionesConcesionFederacion(base.toJSON(), amplia.toJSON()), 'ampliacion');
  assert.equal(compararSeleccionesConcesionFederacion(amplia.toJSON(), base.toJSON()), 'reduccion');
  assert.equal(crearRevisionConcesionFederacion({ revisionId: REVISIONES[0], papel: 'oferta', seleccion: base }).papel, 'oferta');
  assert.throws(() => crearRevisionConcesionFederacion({ revisionId: REVISIONES[0], papel: 'efectiva', seleccion: base }), /efectiva nominal/);
}

async function verificarEstructura() {
  const ddl = await readFile(
    new URL(`../migraciones/sql/${MIGRACION_ESQUEMA}`, import.meta.url),
    'utf8'
  );
  assert.match(ddl, /CREATE TABLE `revisiones_concesion_federacion`/i);
  assert.match(ddl, /CREATE TABLE `cortes_autoridad_federacion`/i);
  assert.match(ddl, /CREATE TABLE `tombstones_relaciones_federacion`/i);
  assert.match(ddl, /trg_revisiones_concesion_inmutables/i);
  const integraciones = await Promise.all([
    '../paquetes/usuarios/src/ServicioUsuarios.js',
    '../paquetes/jerarquia-organizativa/src/ServicioMovimientosOrganizativosAuditable.js',
    '../paquetes/jerarquia-organizativa/src/ServicioEliminacionesOrganizativasAuditable.js',
    '../apps/sentinelia-web/src/index.js'
  ].map((ruta) => readFile(new URL(ruta, import.meta.url), 'utf8')));
  for (const fuente of integraciones.slice(0, 3)) {
    assert.match(fuente, /cortarDependenciasEnTransaccion/,
      'Una frontera de usuario u organización no incorpora el corte federado.');
  }
  assert.match(integraciones[0], /reevaluarAutoridadUsuarioEnTransaccion/,
    'Los cambios de usuario deben reevaluar autoridad, no cortar a ciegas.');
  assert.match(integraciones[3], /repositorioControlFederacion/,
    'La composición web no activa el corte federado transversal.');
}

async function migrar(sql) {
  const repo = new RepositorioMigraciones(sql);
  const ejecutor = new EjecutorMigraciones({ clienteSql: sql, repositorioMigraciones: repo, rutaMigraciones: obtenerRutaMigraciones() });
  await ejecutor.ejecutarPendientes();
  assert.equal((await ejecutor.ejecutarPendientes()).pendientesAplicadas, 0);
}

async function verificarControl(sql) {
  const auditoria = new AdaptadorAuditoriaControlFederacion({ repositorioAuditoria: new RepositorioAuditoria(sql) });
  const servicioAvisos = new ServicioAvisosPlataforma({
    repositorioAvisos: new RepositorioAvisosPlataformaSql(sql, {
      adaptadorAuditoria: new AdaptadorAuditoriaAvisosPlataforma({
        repositorioAuditoria: new RepositorioAuditoria(sql)
      })
    })
  });
  const repositorio = new RepositorioControlFederacionSql(sql, {
    adaptadorAuditoria: auditoria, servicioAvisos
  });
  const servicio = new ServicioControlFederacion({ repositorioControl: repositorio });
  const actor = { real: { tipo: 'usuario', id: '901' }, efectivo: null, modo: 'directo' };
  const base = declaracion(['estado']);
  const amplia = declaracion(['estado', 'historico']);
  const autoridad = limites(amplia);
  assert.throws(
    () => servicio.revisarDeclaracion({
      ...solicitud({ actor, revisionId: REVISIONES[0], papel: 'oferta', declaracion: amplia }),
      autoridadActualLocal: limites(base)
    }),
    /excede la autoridad/
  );
  const solicitudOferta = {
    ...solicitud({ actor, revisionId: REVISIONES[0], papel: 'oferta', declaracion: amplia }),
    autoridadActualLocal: autoridad
  };
  await servicio.revisarDeclaracion(solicitudOferta);
  const replayOferta = await servicio.revisarDeclaracion(solicitudOferta);
  assert.equal(replayOferta.estado, 'ya_procesada');
  assert.equal(replayOferta.eventoAuditoria, null);
  await assert.rejects(
    () => servicio.revisarDeclaracion({
      ...solicitudOferta,
      declaracion: base
    }),
    /otro contenido o autoridad/
  );
  await servicio.revisarDeclaracion({
    ...solicitud({ actor, revisionId: REVISIONES[1], papel: 'aceptacion', declaracion: amplia }),
    autoridadActualLocal: autoridad
  });
  await assert.rejects(
    () => servicio.consolidarRevisionEfectiva({
      ...solicitud({ actor, revisionId: REVISIONES[2] }),
      ofertaEmisora: base, aceptacionReceptora: amplia,
      autoridadActualEmisora: limites(base), autoridadActualReceptora: autoridad,
      revisionOfertaId: REVISIONES[0], revisionAceptacionId: REVISIONES[1]
    }),
    /no corresponde/
  );
  await servicio.consolidarRevisionEfectiva({
    ...solicitud({ actor, revisionId: REVISIONES[2] }),
    ofertaEmisora: amplia, aceptacionReceptora: amplia,
    autoridadActualEmisora: autoridad, autoridadActualReceptora: autoridad,
    revisionOfertaId: REVISIONES[0], revisionAceptacionId: REVISIONES[1]
  });
  let [estado] = await sql.consultar('SELECT revision_efectiva_actual_id AS efectiva FROM estado_concesion_relaciones_federacion WHERE relacion_id=?', [RELACION]);
  assert.equal(estado.efectiva, REVISIONES[2]);

  await servicio.revisarDeclaracion({
    ...solicitud({ actor, revisionId: REVISIONES[3], papel: 'oferta', declaracion: base }),
    autoridadActualLocal: autoridad
  });
  [estado] = await sql.consultar('SELECT revision_efectiva_actual_id AS efectiva FROM estado_concesion_relaciones_federacion WHERE relacion_id=?', [RELACION]);
  assert.equal(estado.efectiva, null, 'Una reducción local debe retirar inmediatamente la efectiva anterior.');

  assert.equal(typeof repositorio.reevaluarAutoridadUsuarioEnTransaccion, 'function');
  await sql.ejecutar(
    'UPDATE usuarios SET permiso_ver=1 WHERE id=901'
  );
  let conexionReevaluacion = await sql.obtenerConexion();
  try {
    await conexionReevaluacion.beginTransaction();
    const estables = await repositorio.reevaluarAutoridadUsuarioEnTransaccion({
      usuarioId: '901', actor
    }, { conexion: conexionReevaluacion });
    await conexionReevaluacion.commit();
    assert.equal(estables.length, 0,
      'Un permiso ajeno a federación no debe cortar autoridad.');
  } catch (error) {
    await conexionReevaluacion.rollback();
    throw error;
  } finally {
    conexionReevaluacion.release();
  }
  await sql.ejecutar(
    'UPDATE usuarios SET permiso_configurar_emisiones_federacion=0 WHERE id=901'
  );
  conexionReevaluacion = await sql.obtenerConexion();
  let cortes;
  try {
    await conexionReevaluacion.beginTransaction();
    cortes = await repositorio.reevaluarAutoridadUsuarioEnTransaccion({
      usuarioId: '901', actor
    }, { conexion: conexionReevaluacion });
    await conexionReevaluacion.commit();
  } catch (error) {
    await conexionReevaluacion.rollback();
    throw error;
  } finally {
    conexionReevaluacion.release();
  }
  assert.equal(cortes.length, 1);
  assert.equal(cortes[0].estado, 'autoridad_cortada');
  let [relacion] = await sql.consultar('SELECT estado_autoridad, responsable_usuario_id, version_autoridad FROM relaciones_federacion WHERE relacion_id=?', [RELACION]);
  assert.equal(relacion.estado_autoridad, 'sinAutoridad');
  assert.equal(relacion.responsable_usuario_id, null);
  const [aviso] = await sql.consultar("SELECT COUNT(*) AS total FROM avisos_plataforma WHERE relacion_id=? AND causa_codigo='perdida_autoridad_responsable' AND estado_ciclo='pendiente'", [RELACION]);
  assert.equal(Number(aviso.total), 1, 'El corte debe abrir o consolidar un aviso de plataforma.');

  const autoridadNueva = limites(base, '902');
  const solicitudTransferencia = {
    relacionId: RELACION, nuevoResponsableUsuarioId: '902',
    scope: { tenantId: '90', empresaId: null, sitioId: null },
    autoridadActualNueva: autoridadNueva, actor,
    eventoId: generarUuidV7Auditoria(), correlacionId: generarUuidV7Auditoria()
  };
  await servicio.transferirResponsabilidad(solicitudTransferencia);
  const replayTransferencia = await servicio.transferirResponsabilidad(
    solicitudTransferencia
  );
  assert.equal(replayTransferencia.estado, 'ya_procesada');
  assert.equal(replayTransferencia.eventoAuditoria, null);
  [relacion] = await sql.consultar('SELECT estado_autoridad, responsable_usuario_id, version_autoridad FROM relaciones_federacion WHERE relacion_id=?', [RELACION]);
  assert.equal(relacion.estado_autoridad, 'autorizada');
  assert.equal(String(relacion.responsable_usuario_id), '902');
  [estado] = await sql.consultar('SELECT revision_oferta_actual_id AS oferta, revision_efectiva_actual_id AS efectiva FROM estado_concesion_relaciones_federacion WHERE relacion_id=?', [RELACION]);
  assert.equal(estado.oferta, null);
  assert.equal(estado.efectiva, null, 'Transferir no puede reactivar la concesión anterior.');

  const conexion = await sql.obtenerConexion();
  try {
    await conexion.beginTransaction();
    const cascada = await repositorio.cortarDependenciasEnTransaccion({
      usuarioIds: [],
      scopeAfectado: { entidad: 'tenant', id: '90' },
      causa: 'organizacionMovida',
      actor
    }, { conexion });
    await conexion.commit();
    assert.equal(cascada.length, 1, 'El movimiento organizativo debe cortar la relación protegida.');
  } catch (error) {
    await conexion.rollback();
    throw error;
  } finally {
    conexion.release();
  }
  await servicio.transferirResponsabilidad({
    relacionId: RELACION, nuevoResponsableUsuarioId: '903',
    scope: { tenantId: '90', empresaId: null, sitioId: null },
    autoridadActualNueva: limites(base, '903'), actor,
    eventoId: generarUuidV7Auditoria(), correlacionId: generarUuidV7Auditoria()
  });

  await servicio.deshabilitarRelacion({ relacionId: RELACION, actor, eventoId: generarUuidV7Auditoria(), correlacionId: generarUuidV7Auditoria() });
  await servicio.eliminarRelacion({ relacionId: RELACION, eliminadaPorUsuarioId: '901', actor, eventoId: generarUuidV7Auditoria(), correlacionId: generarUuidV7Auditoria() });
  const [tombstone] = await sql.consultar('SELECT COUNT(*) AS total FROM tombstones_relaciones_federacion WHERE relacion_id=?', [RELACION]);
  assert.equal(Number(tombstone.total), 1);
  await assert.rejects(() => sql.ejecutar("UPDATE tombstones_relaciones_federacion SET direccion='recepcion' WHERE relacion_id=?", [RELACION]), /inmutable/);
  await assert.rejects(() => sql.ejecutar(
    "UPDATE relaciones_federacion SET estado_ciclo='vinculada' WHERE relacion_id=?",
    [RELACION]
  ), /terminal/);
  const [auditoriaTotal] = await sql.consultar("SELECT COUNT(*) AS total FROM eventos_auditoria WHERE sujeto_id IN (?, ?, ?, ?, ?)", [RELACION, ...REVISIONES.slice(0, 4)]);
  assert.ok(Number(auditoriaTotal.total) >= 8);
}

function declaracion(campos) {
  return crearDeclaracionConcesionFederacion({ activa: true, nivelesScope: ['empresa', 'sitio'], familias: { monitores: { campos, permiteContenidoSensible: false, permiteRefederacion: false } } });
}
function limites(declaracion, usuarioId = '901') {
  const scope = crearScopeFederacion({ nivel: 'tenant', tenantId: '90', empresaId: null, sitioId: null });
  return crearLimitesAutoridadActualFederacion({
    responsabilidad: crearResponsabilidadFederada({ usuarioId, activa: true, scopeActual: scope, permisos: ['federar'] }),
    permisoRequerido: 'federar', scopeLocalConfiguracion: scope,
    nivelesScope: declaracion.toJSON().nivelesScope, familias: declaracion.toJSON().familias
  });
}
function solicitud({ actor, revisionId, papel, declaracion }) { return { relacionId: RELACION, revisionId, papel, declaracion, responsableUsuarioId: '901', versionAutoridad: 1, actor, eventoId: generarUuidV7Auditoria(), correlacionId: generarUuidV7Auditoria() }; }

async function insertarRelacion(sql) {
  const ahora = '2020-01-01 00:00:00.000';
  const evento = generarUuidV7Auditoria();
  const correlacion = generarUuidV7Auditoria();
  await sql.ejecutar(`INSERT INTO relaciones_federacion (
    relacion_id,direccion,estado_ciclo,estado_autoridad,estado_identidad,estado_compatibilidad,
    installation_remota_candidata_id,installation_remota_id,nombre_remoto_declarado,
    responsable_usuario_id,responsable_original_usuario_id,scope_tenant_id,scope_empresa_id,
    scope_sitio_id,version_autoridad,corte_autoridad_utc,creada_por_usuario_id,
    creada_en_utc,actualizada_en_utc,revision
  ) VALUES (?,'emision','vinculada','autorizada','valida','compatible',?,?,?,901,901,90,NULL,NULL,1,NULL,901,?,?,1)`, [RELACION, INSTALACION, INSTALACION, 'Nodo 10i', ahora, ahora]);
  await sql.ejecutar(`INSERT INTO historico_estados_relaciones_federacion (
    relacion_id,ordinal,cambio_tipo,estado_ciclo_anterior,estado_ciclo_nuevo,
    estado_autoridad_anterior,estado_autoridad_nuevo,estado_identidad_anterior,
    estado_identidad_nuevo,estado_compatibilidad_anterior,estado_compatibilidad_nuevo,
    version_autoridad,responsable_usuario_id,scope_tenant_id,scope_empresa_id,scope_sitio_id,
    efectivo_en_utc,registrado_en_utc,evento_auditoria_id,correlacion_id,detalle
  ) VALUES (?,1,'creacion',NULL,'vinculada',NULL,'autorizada',NULL,'valida',NULL,'compatible',1,901,90,NULL,NULL,?,?,?,?,JSON_OBJECT())`, [RELACION, ahora, ahora, uuidV7AuditoriaABytes(evento), uuidV7AuditoriaABytes(correlacion)]);
}

async function insertarUsuariosResponsables(sql) {
  for (const id of [901, 902, 903]) {
    await sql.ejecutar(
      `INSERT INTO usuarios (
         id, usuario, email, hash_password, activo,
         permiso_configurar_emisiones_federacion,
         permiso_configurar_recepciones_federacion,
         permiso_activar_relaciones_federacion,
         permiso_transferir_responsabilidad_federacion
       ) VALUES (?, ?, ?, 'fixture-no-login', 1, 1, 1, 1, 1)`,
      [id, `fixture-fed-${id}`, `fixture-fed-${id}@invalid.local`]
    );
  }
}

async function limpiar(sql) {
  const avisos = await sql.consultar('SELECT aviso_id FROM avisos_plataforma WHERE relacion_id=?', [RELACION]);
  for (const aviso of avisos) {
    await sql.ejecutar('DELETE FROM historico_avisos_plataforma WHERE aviso_id=?', [aviso.aviso_id]);
  }
  await sql.ejecutar('DELETE FROM avisos_plataforma WHERE relacion_id=?', [RELACION]);
  await sql.ejecutar('DELETE FROM tombstones_relaciones_federacion WHERE relacion_id=?', [RELACION]);
  await sql.ejecutar('DELETE FROM cortes_autoridad_federacion WHERE relacion_id=?', [RELACION]);
  await sql.ejecutar('DELETE FROM estado_concesion_relaciones_federacion WHERE relacion_id=?', [RELACION]);
  await sql.ejecutar(
    'DELETE FROM selectores_revision_concesion_federacion WHERE revision_id IN (SELECT revision_id FROM revisiones_concesion_federacion WHERE relacion_id=?)',
    [RELACION]
  );
  await sql.ejecutar("DELETE FROM revisiones_concesion_federacion WHERE relacion_id=? AND papel='efectiva'", [RELACION]);
  await sql.ejecutar('DELETE FROM revisiones_concesion_federacion WHERE relacion_id=?', [RELACION]);
  await sql.ejecutar('DELETE FROM historico_estados_relaciones_federacion WHERE relacion_id=?', [RELACION]);
  await sql.ejecutar('DELETE FROM localizaciones_relaciones_federacion WHERE relacion_id=?', [RELACION]);
  await sql.ejecutar('DELETE FROM relaciones_federacion WHERE relacion_id=?', [RELACION]);
  await sql.ejecutar('DELETE FROM usuarios WHERE id IN (901,902,903)');
}

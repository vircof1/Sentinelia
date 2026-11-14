import assert from 'node:assert/strict';
import { createHash, randomBytes } from 'node:crypto';
import { readFile } from 'node:fs/promises';

import { AdaptadorAuditoriaControlFederacion }
  from '../paquetes/federacion/adaptadores/AdaptadorAuditoriaControlFederacion.js';
import { FuenteEntropiaCriptograficaNode }
  from '../paquetes/federacion/adaptadores/FuenteEntropiaCriptograficaNode.js';
import { RepositorioConsolidacionConcesionFederacionSql }
  from '../paquetes/federacion/adaptadores/RepositorioConsolidacionConcesionFederacionSql.js';
import { RepositorioIntercambioConcesionFederacionSql }
  from '../paquetes/federacion/adaptadores/RepositorioIntercambioConcesionFederacionSql.js';
import { ServicioConsolidacionConcesionFederacion }
  from '../paquetes/federacion/aplicacion/ServicioConsolidacionConcesionFederacion.js';
import { RepositorioAuditoria } from '../paquetes/auditoria/src/RepositorioAuditoria.js';
import {
  generarUuidV7Auditoria,
  uuidV7AuditoriaABytes
} from '../paquetes/auditoria/src/UuidV7Auditoria.js';
import { canonicalizarJsonFederacion }
  from '../paquetes/federacion/src/CanonicalizadorFederacion.js';
import {
  PERFIL_INTERCAMBIO_DECLARACION_CONCESION_FEDERACION,
  validarIntercambioDeclaracionConcesionFederacion
} from '../paquetes/federacion/src/IntercambioDeclaracionConcesionFederacion.js';
import {
  GeneradorIdentidadesFederadas,
  TIPOS_IDENTIDAD_FEDERADA
} from '../paquetes/federacion/src/IdentidadFederada.js';
import { ClienteSql } from '../paquetes/persistencia-sql/src/ClienteSql.js';
import { EjecutorMigraciones }
  from '../paquetes/persistencia-sql/src/EjecutorMigraciones.js';
import { RepositorioMigraciones }
  from '../paquetes/persistencia-sql/src/RepositorioMigraciones.js';
import {
  obtenerConfiguracionAplicacion,
  obtenerRutaMigraciones
} from '../paquetes/utilidades/src/configuracion/obtenerConfiguracionAplicacion.js';

const generador = new GeneradorIdentidadesFederadas({
  fuenteEntropia: new FuenteEntropiaCriptograficaNode()
});
const USUARIO = '5222104';

await main();

async function main() {
  await verificarRegistro();
  const configuracion = obtenerConfiguracionAplicacion();
  assert.equal(configuracion.sql.estaCompleta, true,
    '5.22.21d necesita SQL para demostrar convergencia durable.');
  const baseDatos = `sentinelia_fixture_52221d_${randomBytes(6).toString('hex')}`;
  const administrador = new ClienteSql(configuracion.sql);
  let sql;
  try {
    await administrador.ejecutar(
      `CREATE DATABASE ${administrador.escaparIdentificador(baseDatos)} ` +
      'CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci'
    );
    sql = new ClienteSql({ ...configuracion.sql, baseDatos });
    await migrar(sql);
    await verificarConvergencia(sql);
  } finally {
    await sql?.cerrar().catch(() => {});
    await administrador.ejecutar(
      `DROP DATABASE IF EXISTS ${administrador.escaparIdentificador(baseDatos)}`
    ).catch(() => {});
    await administrador.cerrar();
  }
  console.log(
    '[federacion] OK 5.22.21d: declaraciones=local-y-remota ' +
    'concesion=interseccion-bilateral convergencia=demostrada replay=inmutable ' +
    'conflicto=rechazado ' +
    'autoridad_actual=reevaluada auditoria=causal'
  );
}

async function verificarConvergencia(sql) {
  const ids = {
    instalacionA: id(TIPOS_IDENTIDAD_FEDERADA.INSTALACION),
    instalacionB: id(TIPOS_IDENTIDAD_FEDERADA.INSTALACION),
    relacionA: id(TIPOS_IDENTIDAD_FEDERADA.RELACION),
    relacionB: id(TIPOS_IDENTIDAD_FEDERADA.RELACION),
    ofertaA: id(TIPOS_IDENTIDAD_FEDERADA.REVISION_CONCESION),
    ofertaRemotaEnB: id(TIPOS_IDENTIDAD_FEDERADA.REVISION_CONCESION),
    aceptacionB: id(TIPOS_IDENTIDAD_FEDERADA.REVISION_CONCESION),
    aceptacionRemotaEnA: id(TIPOS_IDENTIDAD_FEDERADA.REVISION_CONCESION)
  };
  const oferta = seleccion({
    nivelesScope: ['empresa', 'sitio'],
    campos: ['monitores', 'credencialPropia'],
    permiteContenidoSensible: true
  });
  const aceptacion = seleccion({
    nivelesScope: ['empresa'],
    campos: ['monitores'],
    permiteContenidoSensible: false
  });
  await crearUsuario(sql);
  await crearRelacion(sql, {
    relacionId: ids.relacionA,
    direccion: 'emision',
    installationRemotaId: ids.instalacionB,
    nombre: 'Instancia B'
  });
  await crearRelacion(sql, {
    relacionId: ids.relacionB,
    direccion: 'recepcion',
    installationRemotaId: ids.instalacionA,
    nombre: 'Instancia A'
  });
  await insertarRevisionLocal(sql, {
    relacionId: ids.relacionA,
    papel: 'oferta',
    revisionId: ids.ofertaA,
    seleccion: oferta
  });
  await insertarRevisionLocal(sql, {
    relacionId: ids.relacionB,
    papel: 'aceptacion',
    revisionId: ids.aceptacionB,
    seleccion: aceptacion
  });
  const repositorioIntercambio =
    new RepositorioIntercambioConcesionFederacionSql(sql);
  await recibirDeclaracion(repositorioIntercambio, {
    relacionId: ids.relacionA,
    installationEmisoraId: ids.instalacionB,
    installationReceptoraId: ids.instalacionA,
    papel: 'aceptacion',
    revisionId: ids.aceptacionRemotaEnA,
    seleccion: aceptacion
  });
  await recibirDeclaracion(repositorioIntercambio, {
    relacionId: ids.relacionB,
    installationEmisoraId: ids.instalacionA,
    installationReceptoraId: ids.instalacionB,
    papel: 'oferta',
    revisionId: ids.ofertaRemotaEnB,
    seleccion: oferta
  });
  await assert.rejects(
    recibirDeclaracion(repositorioIntercambio, {
      relacionId: ids.relacionB,
      installationEmisoraId: ids.instalacionA,
      installationReceptoraId: ids.instalacionB,
      papel: 'oferta',
      revisionId: id(TIPOS_IDENTIDAD_FEDERADA.REVISION_CONCESION),
      seleccion: oferta
    }),
    (error) => error.codigo === 'REPLAY_DECLARACION_FEDERACION_DIVERGENTE',
    'La misma posición remota no puede declarar dos identidades distintas.'
  );

  const servicio = new ServicioConsolidacionConcesionFederacion({
    repositorio: new RepositorioConsolidacionConcesionFederacionSql(sql, {
      adaptadorAuditoria: new AdaptadorAuditoriaControlFederacion({
        repositorioAuditoria: new RepositorioAuditoria(sql)
      })
    }),
    generadorIdentidades: generador
  });
  const resultadoA = await servicio.consolidarRelacion({
    relacionId: ids.relacionA,
    actor: actorRemoto(ids.instalacionB)
  });
  const resultadoB = await servicio.consolidarRelacion({
    relacionId: ids.relacionB,
    actor: actorRemoto(ids.instalacionA)
  });
  assert.equal(resultadoA.estado, 'consolidada');
  assert.equal(resultadoB.estado, 'consolidada');
  assert.deepEqual(resultadoA.seleccion, resultadoB.seleccion,
    'Oferta y aceptación deben producir la misma intersección en ambos extremos.');
  assert.deepEqual(resultadoA.seleccion, { ...aceptacion, vacia: false },
    'La efectiva debe quedar limitada por la declaración más restrictiva.');

  const antesReplay = await fotografia(sql, ids.relacionA);
  const repetida = await servicio.consolidarRelacion({
    relacionId: ids.relacionA,
    actor: actorRemoto(ids.instalacionB)
  });
  const despuesReplay = await fotografia(sql, ids.relacionA);
  assert.equal(repetida.estado, 'yaConocida');
  assert.deepEqual(despuesReplay, antesReplay,
    'Recalcular las mismas fuentes no puede crear auditoría ni mover revisiones.');

  const remotas = await sql.consultar(
    `SELECT procedencia,autorizada_por_usuario_id,installation_declarante_id,
            intercambio_origen_id
       FROM revisiones_concesion_federacion
      WHERE relacion_id IN (?,?) AND procedencia='remota'`,
    [ids.relacionA, ids.relacionB]
  );
  assert.equal(remotas.length, 2);
  assert.ok(remotas.every((fila) => fila.autorizada_por_usuario_id === null &&
    fila.installation_declarante_id && fila.intercambio_origen_id),
  'La declaración remota debe conservar procedencia sin inventar un usuario local.');

  await sql.ejecutar(
    'UPDATE usuarios SET permiso_configurar_emisiones_federacion=0 WHERE id=?',
    [USUARIO]
  );
  await assert.rejects(
    servicio.consolidarRelacion({
      relacionId: ids.relacionA,
      actor: actorRemoto(ids.instalacionB)
    }),
    (error) => error.codigo === 'AUTORIDAD_LOCAL_CAMBIO_DURANTE_NEGOCIACION',
    'Una intersección conocida tampoco puede soslayar la autoridad local actual.'
  );
}

async function recibirDeclaracion(repositorio, entrada) {
  const declaracion = validarIntercambioDeclaracionConcesionFederacion({
    perfil: PERFIL_INTERCAMBIO_DECLARACION_CONCESION_FEDERACION,
    protocoloVersion: 1,
    intercambioId: generarUuidV7Auditoria(),
    relacionId: entrada.relacionId,
    installationEmisoraId: entrada.installationEmisoraId,
    installationReceptoraId: entrada.installationReceptoraId,
    papel: entrada.papel,
    revisionId: entrada.revisionId,
    revisionOrdinal: '1',
    versionAutoridad: '1',
    seleccion: entrada.seleccion,
    emitidaEnUtc: new Date().toISOString()
  });
  return repositorio.recibir({
    declaracion,
    confirmacionId: generarUuidV7Auditoria()
  });
}

async function crearUsuario(sql) {
  await sql.ejecutar(
    `INSERT INTO usuarios (
       id,usuario,email,hash_password,activo,
       permiso_configurar_emisiones_federacion,
       permiso_configurar_recepciones_federacion
     ) VALUES (?,? ,?,'fixture-no-login',1,1,1)`,
    [USUARIO, 'fixture-fed-21d', 'fixture-fed-21d@invalid.local']
  );
}

async function crearRelacion(sql, entrada) {
  const ahora = new Date();
  await sql.ejecutar(
    `INSERT INTO relaciones_federacion (
       relacion_id,direccion,estado_ciclo,estado_autoridad,estado_identidad,
       estado_compatibilidad,installation_remota_candidata_id,
       installation_remota_id,nombre_remoto_declarado,responsable_usuario_id,
       responsable_original_usuario_id,scope_tenant_id,scope_empresa_id,
       scope_sitio_id,version_autoridad,corte_autoridad_utc,
       creada_por_usuario_id,creada_en_utc,actualizada_en_utc,revision
     ) VALUES (?,?,'vinculada','autorizada','valida','compatible',?,?,?,
       ?,?,NULL,NULL,NULL,1,NULL,?,?,?,1)`,
    [entrada.relacionId, entrada.direccion, entrada.installationRemotaId,
      entrada.installationRemotaId, entrada.nombre, USUARIO, USUARIO,
      USUARIO, ahora, ahora]
  );
}

async function insertarRevisionLocal(sql, entrada) {
  const canonico = canonicalizarJsonFederacion(entrada.seleccion);
  const eventoId = generarUuidV7Auditoria();
  const correlacionId = generarUuidV7Auditoria();
  await sql.ejecutar(
    `INSERT INTO revisiones_concesion_federacion (
       revision_id,relacion_id,papel,procedencia,ordinal,estado,
       revision_oferta_id,revision_aceptacion_id,seleccion,huella_seleccion,
       autorizada_por_usuario_id,version_autoridad,version_autoridad_remota,
       creada_en_utc,vigente_desde_utc,evento_auditoria_id,correlacion_id
     ) VALUES (?, ?, ?, 'local', 1, 'vigente', NULL, NULL, ?, ?, ?, 1,
       NULL, UTC_TIMESTAMP(3), UTC_TIMESTAMP(3), ?, ?)`,
    [entrada.revisionId, entrada.relacionId, entrada.papel, canonico,
      createHash('sha256').update(canonico).digest(), USUARIO,
      uuidV7AuditoriaABytes(eventoId), uuidV7AuditoriaABytes(correlacionId)]
  );
  const columna = entrada.papel === 'oferta'
    ? 'revision_oferta_actual_id'
    : 'revision_aceptacion_actual_id';
  await sql.ejecutar(
    `INSERT INTO estado_concesion_relaciones_federacion (
       relacion_id,${columna},revision,actualizada_en_utc
     ) VALUES (?, ?, 1, UTC_TIMESTAMP(3))`,
    [entrada.relacionId, entrada.revisionId]
  );
}

async function fotografia(sql, relacionId) {
  const [estado] = await sql.consultar(
    `SELECT revision_efectiva_actual_id,revision
       FROM estado_concesion_relaciones_federacion WHERE relacion_id=?`,
    [relacionId]
  );
  const [revisiones] = await sql.consultar(
    'SELECT COUNT(*) AS total FROM revisiones_concesion_federacion WHERE relacion_id=?',
    [relacionId]
  );
  const [auditoria] = await sql.consultar(
    `SELECT COUNT(*) AS total FROM eventos_auditoria
      WHERE sujeto_tipo='revision_concesion_federada'`,
    []
  );
  return {
    efectiva: estado.revision_efectiva_actual_id,
    revisionEstado: String(estado.revision),
    revisiones: Number(revisiones.total),
    auditorias: Number(auditoria.total)
  };
}

function seleccion({ nivelesScope, campos, permiteContenidoSensible }) {
  return {
    activa: true,
    nivelesScope,
    familias: {
      monitores: {
        campos,
        permiteContenidoSensible,
        permiteRefederacion: true
      }
    }
  };
}

function actorRemoto(installationId) {
  return {
    modo: 'directo',
    real: { tipo: 'instancia_remota', id: installationId },
    efectivo: null
  };
}

async function migrar(sql) {
  await new EjecutorMigraciones({
    clienteSql: sql,
    repositorioMigraciones: new RepositorioMigraciones(sql),
    rutaMigraciones: obtenerRutaMigraciones()
  }).ejecutarPendientes();
}

async function verificarRegistro() {
  const web = await leer('../apps/sentinelia-web/src/index.js');
  assert.match(web, /servicioConsolidacionConcesionFederacion/u);
}

function id(tipo) {
  return String(generador.generar(tipo));
}

function leer(ruta) {
  return readFile(new URL(ruta, import.meta.url), 'utf8');
}

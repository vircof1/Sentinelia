import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { readFile } from 'node:fs/promises';

import {
  crearRelacionFederacion,
  normalizarEndpointFederacion
} from '../paquetes/federacion/src/index.js';
import {
  generarUuidV7Auditoria,
  uuidV7AuditoriaABytes
} from '../paquetes/auditoria/src/UuidV7Auditoria.js';
import { ClienteSql } from '../paquetes/persistencia-sql/src/ClienteSql.js';
import { EjecutorMigraciones } from '../paquetes/persistencia-sql/src/EjecutorMigraciones.js';
import { RepositorioMigraciones } from '../paquetes/persistencia-sql/src/RepositorioMigraciones.js';
import {
  obtenerConfiguracionAplicacion,
  obtenerRutaMigraciones
} from '../paquetes/utilidades/src/configuracion/obtenerConfiguracionAplicacion.js';

const RELACION_EMISION = `sfid1.relacion.${'A'.repeat(22)}`;
const RELACION_RECEPCION = `sfid1.relacion.${'B'.repeat(21)}Q`;
const INSTALACION_REMOTA = `sfid1.instalacion.${'C'.repeat(21)}g`;
const MIGRACION_ESQUEMA = '0001_esquema_inicial.sql';

await main();

async function main() {
  verificarContratoPuro();
  await verificarEstructura();
  const configuracion = obtenerConfiguracionAplicacion();
  assert.equal(configuracion.sql.estaCompleta, true, '5.22.10h requiere SQL local.');
  const baseDatos = `sentinelia_fixture_52210h_${randomBytes(6).toString('hex')}`;
  const administrador = new ClienteSql(configuracion.sql);
  await administrador.ejecutar(
    `CREATE DATABASE ${administrador.escaparIdentificador(baseDatos)} ` +
    'CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci'
  );
  const clienteSql = new ClienteSql({ ...configuracion.sql, baseDatos });
  try {
    await asegurarMigraciones(clienteSql);
    await limpiar(clienteSql);
    await verificarIndependenciaDireccional(clienteSql);
    await verificarProtecciones(clienteSql);
  } finally {
    await limpiar(clienteSql);
    await clienteSql.cerrar();
    await administrador.ejecutar(
      `DROP DATABASE IF EXISTS ${administrador.escaparIdentificador(baseDatos)}`
    ).catch(() => {});
    await administrador.cerrar();
  }
  console.log(
    '[federacion] OK 5.22.10h: relaciones=direccionales sentidos=independientes ' +
    'responsabilidad=historica localizaciones=https-sin-secretos estados=durables'
  );
}

function verificarContratoPuro() {
  const emision = relacion({
    relacionId: RELACION_EMISION,
    direccion: 'emision',
    responsableUsuarioId: '101',
    scope: { tenantId: '10', empresaId: null, sitioId: null }
  });
  const recepcion = relacion({
    relacionId: RELACION_RECEPCION,
    direccion: 'recepcion',
    responsableUsuarioId: '202',
    scope: { tenantId: '20', empresaId: '21', sitioId: null }
  });
  assert.equal(emision.installationRemotaId, INSTALACION_REMOTA);
  assert.equal(recepcion.installationRemotaId, INSTALACION_REMOTA);
  assert.notEqual(emision.relacionId, recepcion.relacionId);
  assert.notDeepEqual(emision.scope, recepcion.scope);
  assert.equal(normalizarEndpointFederacion('https://Nodo.Example:8443/api/'),
    'https://nodo.example:8443/api');
  assert.throws(() => normalizarEndpointFederacion('http://nodo.example/api'), /HTTPS/);
  assert.throws(() => normalizarEndpointFederacion('https://u:p@nodo.example'), /credenciales/);
  assert.throws(() => normalizarEndpointFederacion('https://nodo.example?token=x'), /query/);
  assert.throws(
    () => crearRelacionFederacion({
      ...emision,
      estadoCiclo: 'pendienteVinculacion'
    }),
    /aún no puede fijar/
  );
}

async function verificarEstructura() {
  const esquema = (await readFile(
    new URL(`../migraciones/sql/${MIGRACION_ESQUEMA}`, import.meta.url),
    'utf8'
  )).replaceAll('`', '');
  assert.doesNotMatch(
    esquema,
    /FOREIGN KEY \((?:responsable|scope|creada_por)/i
  );
  assert.match(esquema, /uk_localizaciones_relaciones_activa/i);
  assert.match(esquema, /installationId remota confirmada no puede reasignarse/i);
}

async function asegurarMigraciones(clienteSql) {
  const repositorio = new RepositorioMigraciones(clienteSql);
  const ejecutor = new EjecutorMigraciones({
    clienteSql,
    repositorioMigraciones: repositorio,
    rutaMigraciones: obtenerRutaMigraciones()
  });
  await ejecutor.ejecutarPendientes();
  const segunda = await ejecutor.ejecutarPendientes();
  assert.equal(segunda.pendientesAplicadas, 0);
  const aplicadas = await repositorio.listarAplicadas();
  assert.ok(aplicadas.has(MIGRACION_ESQUEMA));
}

async function verificarIndependenciaDireccional(clienteSql) {
  const emision = relacion({
    relacionId: RELACION_EMISION,
    direccion: 'emision',
    responsableUsuarioId: '101',
    scope: { tenantId: '10', empresaId: null, sitioId: null }
  });
  const recepcion = relacion({
    relacionId: RELACION_RECEPCION,
    direccion: 'recepcion',
    responsableUsuarioId: '202',
    scope: { tenantId: '20', empresaId: '21', sitioId: null }
  });
  await insertarRelacion(clienteSql, emision, '2026-08-02 10:00:00.000');
  await insertarRelacion(clienteSql, recepcion, '2026-08-02 10:00:01.000');
  await insertarLocalizacion(
    clienteSql,
    emision.relacionId,
    'https://b.example/api/federacion',
    '2026-08-02 10:00:02.000'
  );
  await insertarLocalizacion(
    clienteSql,
    recepcion.relacionId,
    'https://a.example/api/federacion',
    '2026-08-02 10:00:03.000'
  );

  await clienteSql.ejecutar(
    `UPDATE relaciones_federacion
     SET estado_ciclo = 'deshabilitada', revision = revision + 1,
         actualizada_en_utc = '2026-08-02 10:01:00.000'
     WHERE relacion_id = ?`,
    [RELACION_EMISION]
  );
  await insertarHistorico(clienteSql, {
    relacion: emision,
    ordinal: 2,
    cambioTipo: 'estadoCambiado',
    estadoAnterior: 'vinculada',
    estadoNuevo: 'deshabilitada',
    instante: '2026-08-02 10:01:00.000'
  });
  const filas = await clienteSql.consultar(
    `SELECT relacion_id, direccion, estado_ciclo,
            CAST(responsable_usuario_id AS CHAR) AS responsable,
            CAST(scope_tenant_id AS CHAR) AS tenant
     FROM relaciones_federacion
     WHERE installation_remota_id = ?
     ORDER BY direccion`,
    [INSTALACION_REMOTA]
  );
  assert.equal(filas.length, 2);
  const porDireccion = new Map(filas.map((fila) => [fila.direccion, fila]));
  assert.equal(porDireccion.get('emision').estado_ciclo, 'deshabilitada');
  assert.equal(porDireccion.get('recepcion').estado_ciclo, 'vinculada');
  assert.equal(porDireccion.get('emision').responsable, '101');
  assert.equal(porDireccion.get('recepcion').responsable, '202');
  assert.equal(porDireccion.get('emision').tenant, '10');
  assert.equal(porDireccion.get('recepcion').tenant, '20');
  const [localizaciones] = await clienteSql.consultar(
    `SELECT COUNT(*) AS total, COUNT(DISTINCT endpoint_https) AS endpoints
     FROM localizaciones_relaciones_federacion
     WHERE estado = 'activa'`
  );
  assert.equal(Number(localizaciones.total), 2);
  assert.equal(Number(localizaciones.endpoints), 2);
}

async function verificarProtecciones(clienteSql) {
  await assert.rejects(
    () => clienteSql.ejecutar(
      'UPDATE relaciones_federacion SET direccion = ? WHERE relacion_id = ?',
      ['recepcion', RELACION_EMISION]
    ),
    /identidad y direccion/
  );
  await assert.rejects(
    () => clienteSql.ejecutar(
      'UPDATE relaciones_federacion SET installation_remota_id = ? WHERE relacion_id = ?',
      [`sfid1.instalacion.${'D'.repeat(21)}w`, RELACION_EMISION]
    ),
    /no puede reasignarse/
  );
  await assert.rejects(
    () => insertarLocalizacion(
      clienteSql,
      RELACION_EMISION,
      'https://alternativa.example/api',
      '2026-08-02 10:02:00.000'
    ),
    /Duplicate entry|uk_localizaciones_relaciones_activa/
  );
  await assert.rejects(
    () => clienteSql.ejecutar(
      `UPDATE localizaciones_relaciones_federacion
       SET endpoint_https = 'https://mutada.example'
       WHERE relacion_id = ?`,
      [RELACION_EMISION]
    ),
    /propuesta de localizacion federada es inmutable/
  );
  await assert.rejects(
    () => clienteSql.ejecutar(
      `UPDATE historico_estados_relaciones_federacion
       SET detalle = JSON_OBJECT('mutado', true)
       WHERE relacion_id = ?`,
      [RELACION_EMISION]
    ),
    /append-only/
  );
  await assert.rejects(
    () => clienteSql.ejecutar(
      `INSERT INTO relaciones_federacion (
         relacion_id, direccion, estado_ciclo, estado_autoridad,
         estado_identidad, estado_compatibilidad,
         installation_remota_candidata_id, installation_remota_id,
         nombre_remoto_declarado, responsable_usuario_id,
         responsable_original_usuario_id, scope_tenant_id, scope_empresa_id,
         scope_sitio_id, version_autoridad, corte_autoridad_utc,
         creada_por_usuario_id, creada_en_utc, actualizada_en_utc, revision
       ) VALUES (?, 'emision', 'vinculada', 'autorizada', 'valida',
         'compatible', ?, ?, 'No canónica', 9, 9, NULL, NULL, NULL,
         1, NULL, 9, UTC_TIMESTAMP(3), UTC_TIMESTAMP(3), 1)`,
      [
        `sfid1.relacion.${'E'.repeat(21)}A`,
        `sfid1.instalacion.${'F'.repeat(21)}B`,
        `sfid1.instalacion.${'F'.repeat(21)}B`
      ]
    ),
    /CONSTRAINT|constraint|chk_relaciones_federacion_identidades/
  );
  const columnas = await clienteSql.consultar(
    `SELECT COLUMN_NAME AS nombre
     FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE()
       AND TABLE_NAME IN (
         'relaciones_federacion',
         'historico_estados_relaciones_federacion',
         'localizaciones_relaciones_federacion'
       )`
  );
  assert.doesNotMatch(
    columnas.map(({ nombre }) => nombre).join(' '),
    /(?:password|secreto|token|credencial|keyring)/i
  );
  const foraneas = await clienteSql.consultar(
    `SELECT TABLE_NAME AS tabla, REFERENCED_TABLE_NAME AS referenciada
     FROM information_schema.KEY_COLUMN_USAGE
     WHERE TABLE_SCHEMA = DATABASE()
       AND TABLE_NAME IN (
         'relaciones_federacion',
         'historico_estados_relaciones_federacion',
         'localizaciones_relaciones_federacion'
       )
       AND REFERENCED_TABLE_NAME IS NOT NULL`
  );
  assert.deepEqual(
    foraneas.map(({ tabla, referenciada }) => `${tabla}->${referenciada}`).sort(),
    [
      'historico_estados_relaciones_federacion->relaciones_federacion',
      'localizaciones_relaciones_federacion->relaciones_federacion'
    ]
  );
}

function relacion({ relacionId, direccion, responsableUsuarioId, scope }) {
  return crearRelacionFederacion({
    relacionId,
    direccion,
    estadoCiclo: 'vinculada',
    estadoAutoridad: 'autorizada',
    estadoIdentidad: 'valida',
    estadoCompatibilidad: 'compatible',
    installationRemotaCandidataId: INSTALACION_REMOTA,
    installationRemotaId: INSTALACION_REMOTA,
    nombreRemotoDeclarado: 'Instalación remota de prueba',
    responsableUsuarioId,
    scope,
    versionAutoridad: 1
  });
}

async function insertarRelacion(clienteSql, relacion, instante) {
  await clienteSql.ejecutar(
    `INSERT INTO relaciones_federacion (
       relacion_id, direccion, estado_ciclo, estado_autoridad, estado_identidad,
       estado_compatibilidad, installation_remota_candidata_id,
       installation_remota_id, nombre_remoto_declarado,
       responsable_usuario_id, responsable_original_usuario_id,
       scope_tenant_id, scope_empresa_id, scope_sitio_id,
       version_autoridad, corte_autoridad_utc, creada_por_usuario_id,
       creada_en_utc, actualizada_en_utc, revision
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, NULL, ?, ?, ?, 1)`,
    [
      relacion.relacionId,
      relacion.direccion,
      relacion.estadoCiclo,
      relacion.estadoAutoridad,
      relacion.estadoIdentidad,
      relacion.estadoCompatibilidad,
      relacion.installationRemotaCandidataId,
      relacion.installationRemotaId,
      relacion.nombreRemotoDeclarado,
      relacion.responsableUsuarioId,
      relacion.responsableUsuarioId,
      relacion.scope.tenantId,
      relacion.scope.empresaId,
      relacion.scope.sitioId,
      relacion.responsableUsuarioId,
      instante,
      instante
    ]
  );
  await insertarHistorico(clienteSql, {
    relacion,
    ordinal: 1,
    cambioTipo: 'creacion',
    estadoAnterior: null,
    estadoNuevo: relacion.estadoCiclo,
    instante
  });
}

async function insertarHistorico(clienteSql, {
  relacion,
  ordinal,
  cambioTipo,
  estadoAnterior,
  estadoNuevo,
  instante
}) {
  await clienteSql.ejecutar(
    `INSERT INTO historico_estados_relaciones_federacion (
       relacion_id, ordinal, cambio_tipo, estado_ciclo_anterior,
       estado_ciclo_nuevo, estado_autoridad_anterior, estado_autoridad_nuevo,
       estado_identidad_anterior, estado_identidad_nuevo,
       estado_compatibilidad_anterior, estado_compatibilidad_nuevo,
       version_autoridad, responsable_usuario_id,
       scope_tenant_id, scope_empresa_id, scope_sitio_id,
       efectivo_en_utc, registrado_en_utc, evento_auditoria_id,
       correlacion_id, detalle
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      relacion.relacionId,
      ordinal,
      cambioTipo,
      estadoAnterior,
      estadoNuevo,
      estadoAnterior === null ? null : relacion.estadoAutoridad,
      relacion.estadoAutoridad,
      estadoAnterior === null ? null : relacion.estadoIdentidad,
      relacion.estadoIdentidad,
      estadoAnterior === null ? null : relacion.estadoCompatibilidad,
      relacion.estadoCompatibilidad,
      relacion.responsableUsuarioId,
      relacion.scope.tenantId,
      relacion.scope.empresaId,
      relacion.scope.sitioId,
      instante,
      instante,
      uuidV7AuditoriaABytes(generarUuidV7Auditoria()),
      uuidV7AuditoriaABytes(generarUuidV7Auditoria()),
      JSON.stringify({ fixture: true, cambioTipo })
    ]
  );
}

async function insertarLocalizacion(clienteSql, relacionId, endpoint, instante) {
  const eventoId = generarUuidV7Auditoria();
  return clienteSql.ejecutar(
    `INSERT INTO localizaciones_relaciones_federacion (
       localizacion_id, relacion_id, endpoint_https, estado,
       relacion_localizacion_activa, origen_propuesta,
       propuesta_por_usuario_id, aprobada_por_usuario_id,
       propuesta_en_utc, aprobada_en_utc, finalizada_en_utc,
       evento_auditoria_id, correlacion_id
     ) VALUES (?, ?, ?, 'activa', ?, 'configuracionLocal', 1, 1,
       ?, ?, NULL, ?, ?)`,
    [
      uuidV7AuditoriaABytes(generarUuidV7Auditoria()),
      relacionId,
      normalizarEndpointFederacion(endpoint),
      relacionId,
      instante,
      instante,
      uuidV7AuditoriaABytes(eventoId),
      uuidV7AuditoriaABytes(generarUuidV7Auditoria())
    ]
  );
}

async function limpiar(clienteSql) {
  const ids = [RELACION_EMISION, RELACION_RECEPCION];
  for (const relacionId of ids) {
    await clienteSql.ejecutar(
      'DELETE FROM localizaciones_relaciones_federacion WHERE relacion_id = ?',
      [relacionId]
    );
    await clienteSql.ejecutar(
      'DELETE FROM historico_estados_relaciones_federacion WHERE relacion_id = ?',
      [relacionId]
    );
    await clienteSql.ejecutar(
      'DELETE FROM relaciones_federacion WHERE relacion_id = ?',
      [relacionId]
    );
  }
}

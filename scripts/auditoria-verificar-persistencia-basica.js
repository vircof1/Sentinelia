import assert from 'node:assert/strict';
import { createHash, randomBytes } from 'node:crypto';
import { ClienteSql } from '../paquetes/persistencia-sql/src/ClienteSql.js';
import { EjecutorMigraciones } from '../paquetes/persistencia-sql/src/EjecutorMigraciones.js';
import { MigracionSql } from '../paquetes/persistencia-sql/src/MigracionSql.js';
import { RepositorioMigraciones } from '../paquetes/persistencia-sql/src/RepositorioMigraciones.js';
import { TABLAS_PROTEGIDAS_SCOPE_AUDITORIA } from '../paquetes/auditoria/src/CatalogoScopeAuditoria.js';
import {
  PERFIL_JCS_AUDITORIA_V1
} from '../paquetes/auditoria/src/PerfilJcsAuditoria.js';
import {
  VERSION_ENCADENADO_AUDITORIA_V1,
  obtenerHashGenesisAuditoriaV1,
  prepararEventoEncadenadoAuditoriaV1
} from '../paquetes/auditoria/src/SobreCanonicoAuditoria.js';
import {
  generarUuidV7Auditoria,
  uuidV7AuditoriaABytes
} from '../paquetes/auditoria/src/UuidV7Auditoria.js';
import {
  obtenerConfiguracionAplicacion,
  obtenerRutaMigraciones
} from '../paquetes/utilidades/src/configuracion/obtenerConfiguracionAplicacion.js';

const tablasAuditoria = [
  'cadenas_auditoria', 'eventos_auditoria', 'identidades_idempotentes_auditoria',
  'tombstones_identidad_auditoria', 'checkpoints_auditoria'
];

async function main() {
  await verificarRecuperacionDdlSimulada();
  const configuracion = obtenerConfiguracionAplicacion();
  assert.equal(configuracion.sql.estaCompleta, true, 'La verificación 5.21.4a requiere SQL local configurado.');
  const administrador = new ClienteSql(configuracion.sql);
  const baseDatos = `sentinelia_persistencia_auditoria_${randomBytes(8).toString('hex')}`;
  const clienteSql = new ClienteSql({ ...configuracion.sql, baseDatos });
  try {
    await administrador.ejecutar(`CREATE DATABASE ${administrador.escaparIdentificador(baseDatos)} CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
    await verificarInstalacionYReejecucion(clienteSql);
    await verificarDenylistYForaneas(clienteSql);
    await verificarRoundTripYRestricciones(clienteSql);
  } finally {
    await clienteSql.cerrar();
    try {
      await administrador.ejecutar(`DROP DATABASE IF EXISTS ${administrador.escaparIdentificador(baseDatos)}`);
    } finally {
      await administrador.cerrar();
    }
  }
  console.log('[auditoria] OK 5.21.4a: tablas=5 ddl_recuperable=si roundtrip_binario=si cascadas_negocio=0');
}

async function verificarRecuperacionDdlSimulada() {
  const estado = { ddlAplicado: false, registrada: false, intentosRegistro: 0 };
  const conexion = {
    async beginTransaction() {},
    async query() { estado.ddlAplicado = true; },
    async commit() {},
    async rollback() {},
    release() {}
  };
  const clienteSql = { async obtenerConexion() { return conexion; } };
  const repositorio = {
    async registrarAplicada() {
      estado.intentosRegistro += 1;
      if (estado.intentosRegistro === 1) throw new Error('caída simulada antes de control_migraciones');
      estado.registrada = true;
    }
  };
  const verificador = {
    tienePostcondicion() { return true; },
    async verificar() {
      assert.equal(estado.ddlAplicado, true);
      return { verificada: true };
    }
  };
  const ejecutor = new EjecutorMigraciones({
    clienteSql,
    repositorioMigraciones: repositorio,
    rutaMigraciones: '.',
    verificadorPostcondiciones: verificador
  });
  const migracion = new MigracionSql({
    nombreArchivo: 'prueba_ddl_recuperable.sql',
    rutaAbsoluta: 'prueba_ddl_recuperable.sql',
    contenido: 'CREATE TABLE IF NOT EXISTS prueba_ddl_recuperable (id INT)'
  });
  await assert.rejects(() => ejecutor.ejecutarMigracion(migracion), /caída simulada/);
  assert.deepEqual(estado, { ddlAplicado: true, registrada: false, intentosRegistro: 1 });
  await ejecutor.ejecutarMigracion(migracion);
  assert.deepEqual(estado, { ddlAplicado: true, registrada: true, intentosRegistro: 2 });
}

async function verificarInstalacionYReejecucion(clienteSql) {
  const repositorio = new RepositorioMigraciones(clienteSql);
  const ejecutor = new EjecutorMigraciones({
    clienteSql,
    repositorioMigraciones: repositorio,
    rutaMigraciones: obtenerRutaMigraciones()
  });
  const primera = await ejecutor.ejecutarPendientes();
  const segunda = await ejecutor.ejecutarPendientes();
  const disponibles = await ejecutor.cargarMigracionesDisponibles();
  assert.ok(disponibles.length > 0, 'Debe instalarse al menos una migración.');
  assert.equal(primera.pendientesAplicadas, disponibles.length);
  assert.equal(segunda.pendientesAplicadas, 0);
  const aplicadas = await repositorio.listarAplicadas();
  for (const { nombreArchivo } of disponibles) {
    assert.ok(aplicadas.has(nombreArchivo), `${nombreArchivo} no consta aplicada.`);
  }
}

async function verificarDenylistYForaneas(clienteSql) {
  const tablas = tablasAuditoria;
  for (const tabla of tablas) {
    assert.ok(TABLAS_PROTEGIDAS_SCOPE_AUDITORIA.includes(tabla), `${tabla} no está en la denylist protegida.`);
    const columnas = await clienteSql.consultar(
      'SELECT COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=?', [tabla]
    );
    assert.ok(columnas.length > 0, `${tabla} debe existir en el esquema instalado.`);
  }
  const placeholders = tablas.map(() => '?').join(', ');
  const foraneas = await clienteSql.consultar(
    `
      SELECT
        kcu.TABLE_NAME AS tabla,
        kcu.REFERENCED_TABLE_NAME AS referenciada,
        rc.DELETE_RULE AS al_borrar,
        rc.UPDATE_RULE AS al_actualizar
      FROM information_schema.KEY_COLUMN_USAGE kcu
      INNER JOIN information_schema.REFERENTIAL_CONSTRAINTS rc
        ON rc.CONSTRAINT_SCHEMA = kcu.CONSTRAINT_SCHEMA
       AND rc.CONSTRAINT_NAME = kcu.CONSTRAINT_NAME
       AND rc.TABLE_NAME = kcu.TABLE_NAME
      WHERE kcu.CONSTRAINT_SCHEMA = DATABASE()
        AND (
          kcu.TABLE_NAME IN (${placeholders})
          OR kcu.REFERENCED_TABLE_NAME IN (${placeholders})
        )
        AND kcu.REFERENCED_TABLE_NAME IS NOT NULL
    `,
    [...tablas, ...tablas]
  );
  const protegidas = new Set(TABLAS_PROTEGIDAS_SCOPE_AUDITORIA);
  for (const foranea of foraneas) {
    assert.ok(protegidas.has(foranea.tabla), `${foranea.tabla} crea una FK desde negocio hacia persistencia protegida.`);
    assert.ok(protegidas.has(foranea.referenciada), `${foranea.tabla} referencia destructivamente al dominio ${foranea.referenciada}.`);
    assert.equal(foranea.al_borrar, 'RESTRICT');
    assert.equal(foranea.al_actualizar, 'RESTRICT');
  }
}

async function verificarRoundTripYRestricciones(clienteSql) {
  const conexion = await clienteSql.obtenerConexion();
  const sufijo = String(Date.now());
  const tenantId = sufijo;
  const claveCadena = `usuarios:tenant:${tenantId}`;
  try {
    await conexion.beginTransaction();
    const eventoId = generarUuidV7Auditoria();
    const correlacionId = generarUuidV7Auditoria();
    const sobre = {
      eventoId,
      tipo: 'cadena.iniciada',
      versionContrato: 1,
      flujo: 'usuarios',
      claveCadena,
      secuencia: '1',
      actorReal: { tipo: 'sistema', id: 'sentinelia-system' },
      actorEfectivo: null,
      modoActuacion: 'directo',
      sujeto: { tipo: 'cadena_auditoria', id: claveCadena },
      origen: 'tarea_sistema',
      scope: { tenantId, empresaId: null, sitioId: null },
      correlacionId,
      causalidad: null,
      productor: 'auditoria_nucleo',
      claveOperacion: `genesis:${claveCadena}`,
      rolEvento: 'principal',
      efectivoEnUtc: '2026-07-24T16:00:00.123Z',
      registradoEnUtc: '2026-07-24T16:00:00.456Z',
      versionCanonicalizador: PERFIL_JCS_AUDITORIA_V1,
      versionEncadenado: VERSION_ENCADENADO_AUDITORIA_V1,
      payload: {
        flujo: 'usuarios',
        claveCadena,
        scopeCadena: { tenantId, empresaId: null, sitioId: null },
        versiones: {
          contrato: 1,
          canonicalizador: PERFIL_JCS_AUDITORIA_V1,
          encadenado: VERSION_ENCADENADO_AUDITORIA_V1
        }
      }
    };
    const preparado = prepararEventoEncadenadoAuditoriaV1(sobre, {
      hashAnterior: obtenerHashGenesisAuditoriaV1()
    });
    const [cadena] = await conexion.execute(
      `
        INSERT INTO cadenas_auditoria (
          clave_cadena, flujo, tenant_id, ultima_secuencia, ultimo_hash,
          fecha_creacion_utc, fecha_actualizacion_utc
        ) VALUES (?, ?, ?, ?, ?, ?, ?)
      `,
      [claveCadena, sobre.flujo, tenantId, 1, preparado.hashActual, '2026-07-24 16:00:00.456', '2026-07-24 16:00:00.456']
    );
    const cadenaId = cadena.insertId;
    await insertarEvento(conexion, cadenaId, sobre, preparado);
    const huellaIntencion = createHash('sha256').update('intencion-prueba').digest();
    await conexion.execute(
      `
        INSERT INTO identidades_idempotentes_auditoria (
          productor, clave_operacion, rol_evento, huella_intencion, evento_id,
          estado, primera_observacion_utc, retenido_en_utc
        ) VALUES (?, ?, ?, ?, ?, 'vigente', ?, NULL)
      `,
      [sobre.productor, sobre.claveOperacion, sobre.rolEvento, huellaIntencion, uuidV7AuditoriaABytes(eventoId), '2026-07-24 16:00:00.456']
    );
    const huellaEvento = createHash('sha256').update(uuidV7AuditoriaABytes(eventoId)).digest();
    await conexion.execute(
      'INSERT INTO tombstones_identidad_auditoria (huella_evento_id) VALUES (?)',
      [huellaEvento]
    );
    const eventoRetencionId = generarUuidV7Auditoria();
    await conexion.execute(
      `
        INSERT INTO checkpoints_auditoria (
          cadena_id, ultima_secuencia_retirada, hash_ultima_secuencia_retirada,
          primera_secuencia_conservada, politica_dias, aplicado_en_utc,
          evento_retencion_id
        ) VALUES (?, 1, ?, 2, 365, ?, ?)
      `,
      [cadenaId, preparado.hashActual, '2026-07-24 16:00:01.000', uuidV7AuditoriaABytes(eventoRetencionId)]
    );

    const [filas] = await conexion.execute(
      `
        SELECT
          HEX(evento_id) AS evento_hex,
          HEX(hash_payload) AS payload_hex,
          HEX(hash_anterior) AS anterior_hex,
          HEX(hash_actual) AS actual_hex,
          DATE_FORMAT(efectivo_en_utc, '%Y-%m-%dT%H:%i:%s.%fZ') AS efectivo,
          DATE_FORMAT(registrado_en_utc, '%Y-%m-%dT%H:%i:%s.%fZ') AS registrado,
          JSON_COMPACT(payload) AS payload
        FROM eventos_auditoria
        WHERE cadena_id = ? AND secuencia = 1
      `,
      [cadenaId]
    );
    assert.equal(filas.length, 1);
    assert.equal(filas[0].evento_hex.toLowerCase(), uuidV7AuditoriaABytes(eventoId).toString('hex'));
    assert.equal(filas[0].payload_hex.toLowerCase(), preparado.hashPayload.toString('hex'));
    assert.equal(filas[0].anterior_hex.toLowerCase(), preparado.hashAnterior.toString('hex'));
    assert.equal(filas[0].actual_hex.toLowerCase(), preparado.hashActual.toString('hex'));
    assert.equal(filas[0].efectivo, '2026-07-24T16:00:00.123000Z');
    assert.equal(filas[0].registrado, '2026-07-24T16:00:00.456000Z');
    const payload = filas[0].payload;
    assert.deepEqual(typeof payload === 'string' ? JSON.parse(payload) : payload, sobre.payload);

    await assert.rejects(
      () => conexion.execute(
        `INSERT INTO cadenas_auditoria (
          clave_cadena, flujo, tenant_id, ultima_secuencia, ultimo_hash,
          fecha_creacion_utc, fecha_actualizacion_utc
        ) VALUES (?, 'usuarios', ?, 1, ?, ?, ?)`,
        [`usuarios:portal`, tenantId, preparado.hashActual, '2026-07-24 16:00:00.000', '2026-07-24 16:00:00.000']
      ),
      /CONSTRAINT|constraint/i
    );
    await assert.rejects(
      () => conexion.execute('UPDATE checkpoints_auditoria SET politica_dias = 0 WHERE cadena_id = ?', [cadenaId]),
      /CONSTRAINT|constraint/i
    );
    await assert.rejects(
      () => conexion.execute('UPDATE eventos_auditoria SET tipo_evento = tipo_evento WHERE cadena_id = ?', [cadenaId]),
      /append-only/i
    );
  } finally {
    await conexion.rollback();
    conexion.release();
  }
  const residuo = await clienteSql.consultar('SELECT COUNT(*) AS total FROM cadenas_auditoria WHERE clave_cadena = ?', [claveCadena]);
  assert.equal(Number(residuo[0].total), 0);
}

async function insertarEvento(conexion, cadenaId, sobre, preparado) {
  await conexion.execute(
    `
      INSERT INTO eventos_auditoria (
        evento_id, cadena_id, tipo_evento, version_contrato, flujo, clave_cadena,
        secuencia, actor_real_tipo, actor_real_id, actor_efectivo_tipo,
        actor_efectivo_id, modo_actuacion, sujeto_tipo, sujeto_id, origen,
        scope_tenant_id, scope_empresa_id, scope_sitio_id, correlacion_id,
        causalidad_tipo, causalidad_id, productor, clave_operacion, rol_evento,
        efectivo_en_utc, registrado_en_utc, version_canonicalizador,
        version_encadenado, payload, hash_payload, hash_anterior, hash_actual
      ) VALUES (
        ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, ?, ?, ?, ?, ?, NULL, NULL, ?,
        NULL, NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
      )
    `,
    [
      uuidV7AuditoriaABytes(sobre.eventoId), cadenaId, sobre.tipo,
      sobre.versionContrato, sobre.flujo, sobre.claveCadena, sobre.secuencia,
      sobre.actorReal.tipo, sobre.actorReal.id, sobre.modoActuacion,
      sobre.sujeto.tipo, sobre.sujeto.id, sobre.origen, sobre.scope.tenantId,
      uuidV7AuditoriaABytes(sobre.correlacionId), sobre.productor,
      Buffer.from(sobre.claveOperacion, 'ascii'), sobre.rolEvento,
      '2026-07-24 16:00:00.123', '2026-07-24 16:00:00.456',
      sobre.versionCanonicalizador, sobre.versionEncadenado,
      JSON.stringify(sobre.payload), preparado.hashPayload,
      preparado.hashAnterior, preparado.hashActual
    ]
  );
}

main().catch((error) => {
  console.error('[auditoria] Error verificando 5.21.4a');
  console.error(error);
  process.exit(1);
});

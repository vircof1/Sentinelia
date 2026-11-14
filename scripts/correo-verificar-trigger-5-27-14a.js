import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { randomBytes } from 'node:crypto';
import {
  MIGRACIONES_TRIGGER_CORREO,
  RepositorioPreparacionDespliegueTriggerCorreoSql,
  evaluarPreparacionLocalTriggerCorreo
} from '../paquetes/correo/src/CompatibilidadDespliegueTriggerCorreo.js';
import { RepositorioColaCorreo }
  from '../paquetes/correo/src/RepositorioColaCorreo.js';
import { ClienteSql } from '../paquetes/persistencia-sql/src/ClienteSql.js';
import { EjecutorMigraciones }
  from '../paquetes/persistencia-sql/src/EjecutorMigraciones.js';
import { RepositorioMigraciones }
  from '../paquetes/persistencia-sql/src/RepositorioMigraciones.js';
import {
  obtenerConfiguracionAplicacion,
  obtenerRutaMigraciones
} from '../paquetes/utilidades/src/configuracion/obtenerConfiguracionAplicacion.js';

const ejecutarArchivo = promisify(execFile);
const raizProyecto = fileURLToPath(new URL('../', import.meta.url));

const EVIDENCIAS = Object.freeze([
  '1a', '1b', '1c', '1d', '2a', '2b', '3a', '3b', '3c', '4a', '4b',
  '6a', '6b', '6c', '6d', '7a', '7b', '8a', '8b', '8c', '9a', '9b',
  '10a', '10b', '11a', '11b', '11c', '12a', '12b', '13a', '13b', '13c',
  '13d', '13e'
]);

const MATRIZ = Object.freeze([
  fila('contrato_catalogo_transiciones_y_renderizado',
    ['2a', '3a', '3b', '4a', '4b', '8a']),
  fila('carreras_revision_scope_y_desuscripcion', ['2b', '7b', '8b', '9a']),
  fila('smtp_autoridad_huella_y_backlog', ['1b', '1c', '1d', '6d', '13d']),
  fila('audiencia_deduplicacion_limites_y_redaccion', ['2b', '3a', '3c', '9a']),
  fila('buzon_idna_cabeceras_y_limites_utf8', ['1a', '3a', '4a', '4b']),
  fila('previsualizacion_y_prueba_sin_efectos', ['4b', '9b']),
  fila('aceptacion_atomica_rollback_y_replay', ['6b', '8a', '8b', '8c']),
  fila('claims_fencing_caidas_y_ambiguedad', ['6a', '6c', '6d', '7a']),
  fila('retencion_backlog_y_arbol_aceptado', ['10a', '10b']),
  fila('bajas_usuario_agente_y_organizacion', ['11a', '11b', '11c']),
  fila('auditoria_federacion_y_ausencia_sensibles', ['9a', '12a', '12b']),
  fila('compatibilidad_unanimidad_y_cortes', ['13a', '13b', '13c', '13d', '13e'])
]);

await main();

async function main() {
  verificarMatriz();
  const soloDespliegue = process.argv.includes('--solo-despliegue');
  if (!soloDespliegue) {
    for (const sufijo of EVIDENCIAS) await ejecutarEvidencia(sufijo);
  }
  await verificarInstalacionInicialYAutoridad();
  console.log(
    `[correo-trigger] OK 5.27.14a: matriz=12_filas evidencias=${
      soloDespliegue ? 'diagnostico_despliegue' : `${EVIDENCIAS.length}/${EVIDENCIAS.length}`} ` +
      'migracion=esquema_inicial gate=0 esquema=verificado ' +
      'autoridad=productor_writer_consumidor_sin_autoridad_rechazados'
  );
}

function verificarMatriz() {
  assert.equal(EVIDENCIAS.length, 34);
  assert.equal(new Set(EVIDENCIAS).size, EVIDENCIAS.length);
  assert.equal(MATRIZ.length, 12);
  const conocidas = new Set(EVIDENCIAS);
  for (const entrada of MATRIZ) {
    assert.ok(entrada.evidencias.length > 0, `La fila ${entrada.riesgo} está vacía.`);
    for (const evidencia of entrada.evidencias) {
      assert.ok(conocidas.has(evidencia),
        `La fila ${entrada.riesgo} refiere una evidencia desconocida.`);
    }
  }
  const cubiertas = new Set(MATRIZ.flatMap((entrada) => entrada.evidencias));
  for (const obligatoria of EVIDENCIAS) {
    assert.ok(cubiertas.has(obligatoria), `Falta cobertura vertical ${obligatoria}.`);
  }
}

async function ejecutarEvidencia(sufijo) {
  const unidad = `5.27.${sufijo}`;
  try {
    const { stdout = '', stderr = '' } = await ejecutarArchivo(
      process.execPath,
      [`scripts/correo-verificar-trigger-5-27-${sufijo}.js`],
      {
        cwd: raizProyecto,
        env: process.env,
        encoding: 'utf8',
        timeout: 300_000,
        maxBuffer: 12 * 1024 * 1024,
        windowsHide: true
      }
    );
    assert.match(stdout, new RegExp(`OK ${escaparRegExp(unidad)}`, 'u'));
    assert.equal(stderr.trim(), '', `${unidad} escribió en stderr.`);
    console.log(`[correo-trigger] matriz 5.27.14a · ${unidad}=OK`);
  } catch (error) {
    const diagnostico = sanearDiagnostico(error);
    if (diagnostico) console.error(`[correo-trigger] ${diagnostico}`);
    throw new Error(`La matriz 5.27.14a se detuvo en ${unidad}.`);
  }
}

async function verificarInstalacionInicialYAutoridad() {
  const configuracion = obtenerConfiguracionAplicacion();
  assert.equal(configuracion.sql.estaCompleta, true,
    '5.27.14a necesita MariaDB real.');
  const administrador = new ClienteSql(configuracion.sql);
  const nombre = `sentinelia_fixture_52714a_${randomBytes(5).toString('hex')}`;
  let sql;
  try {
    await administrador.ejecutar(
      `CREATE DATABASE ${administrador.escaparIdentificador(nombre)} ` +
        'CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci'
    );
    sql = new ClienteSql({ ...configuracion.sql, baseDatos: nombre });
    const repositorioMigraciones = new RepositorioMigraciones(sql);
    const ejecutor = new EjecutorMigraciones({
      clienteSql: sql,
      repositorioMigraciones,
      rutaMigraciones: obtenerRutaMigraciones()
    });
    const actual = await ejecutor.ejecutarPendientes();
    assert.equal(actual.integridad.ok, true);
    const repetida = await ejecutor.ejecutarPendientes();
    assert.equal(repetida.integridad.ok, true);
    assert.equal(repetida.pendientesAplicadas, 0);
    const aplicadas = await repositorioMigraciones.listarNombresAplicados();
    for (const migracion of MIGRACIONES_TRIGGER_CORREO) {
      assert.equal(aplicadas.has(migracion), true, `No se aplicó ${migracion}.`);
    }
    const fotoPreparada = await new RepositorioPreparacionDespliegueTriggerCorreoSql(sql)
      .fotografiar();
    assert.equal(evaluarPreparacionLocalTriggerCorreo({
      migracionesAplicadas: aplicadas,
      postcondicionesMigracionesVerificadas: actual.integridad.ok,
      fotografia: fotoPreparada
    }).gateAbierto, false);

    await sql.ejecutar(
      `INSERT INTO triggers (nombre, tipo, descripcion, activo, configuracion)
       VALUES ('Trigger legacy de ensayo', 'api', NULL, 0, NULL)`
    );
    const cola = new RepositorioColaCorreo(sql);
    const legado = await cola.crearPendienteLegacy({
      destinatarioEmail: 'legacy@example.test',
      destinatarioNombre: null,
      remitenteEmail: 'sender@example.test',
      remitenteNombre: null,
      asunto: 'Fila anterior al corte',
      cuerpoTexto: 'Debe quedar vedada al consumidor antiguo.',
      creadoPorUsuarioId: null
    });
    await sql.ejecutar(
      `INSERT INTO configuracion_portal (
         clave, valor, tipo_dato, descripcion, creado_automaticamente
       ) VALUES
         ('federacion.origen_publico', 'https://legacy.example.test', 'url',
          'Origen legacy de ensayo.', 1),
         ('correo.operativo_verificado', 'false', 'booleano',
          'Booleano SMTP legacy de ensayo.', 1)
       ON DUPLICATE KEY UPDATE valor=VALUES(valor)`
    );
    await sql.ejecutar(
      `UPDATE estado_despliegue_trigger_correo
          SET estado='activado', guard_metadatos_activo=1,
              origen_portal_autoritativo=1, verificacion_smtp_autoritativa=1,
              guard_verificacion_legacy_activo=1,
              guard_revision_trigger_activo=1, cola_sql_autoritativa=1,
              tipo_correo_habilitado=0, cortado_en_utc=UTC_TIMESTAMP(3),
              quietud_iniciada_en_utc=UTC_TIMESTAMP(3),
              quietud_observada_en_utc=UTC_TIMESTAMP(3),
              activado_en_utc=UTC_TIMESTAMP(3), revision=revision+1
        WHERE id=1`
    );
    await verificarDowngradeRechazado(sql, cola, legado.id);
    await sql.ejecutar('DELETE FROM cola_correos_salida WHERE id=?', [legado.id]);
    const [estadoFinal] = await sql.consultar(
      `SELECT estado, cola_sql_autoritativa, tipo_correo_habilitado
         FROM estado_despliegue_trigger_correo WHERE id=1`
    );
    assert.deepEqual({
      estado: estadoFinal.estado,
      cola: Number(estadoFinal.cola_sql_autoritativa),
      gate: Number(estadoFinal.tipo_correo_habilitado)
    }, { estado: 'activado', cola: 1, gate: 0 });
  } finally {
    await sql?.cerrar().catch(() => {});
    await administrador.ejecutar(
      `DROP DATABASE IF EXISTS ${administrador.escaparIdentificador(nombre)}`
    ).catch(() => {});
    await administrador.cerrar();
  }
}

async function verificarDowngradeRechazado(sql, cola, legadoId) {
  await assert.rejects(
    sql.ejecutar(
      `UPDATE configuracion_portal SET valor='https://legacy.invalid'
        WHERE clave='federacion.origen_publico'`
    ),
    /origen federado legacy ya no es autoridad/iu
  );
  await assert.rejects(
    sql.ejecutar(
      `UPDATE configuracion_portal SET valor='true'
        WHERE clave='correo.operativo_verificado'`
    ),
    /verificación legacy de correo ya no es autoridad/iu
  );
  const [trigger] = await sql.consultar('SELECT id FROM triggers ORDER BY id LIMIT 1');
  assert.ok(trigger, 'El escenario necesita un trigger para probar su autoridad de escritura.');
  await assert.rejects(
    sql.ejecutar('UPDATE triggers SET activo=activo WHERE id=?', [trigger.id]),
    /avanzar exactamente una revisión declarativa/iu
  );
  await assert.rejects(
    cola.crearPendienteLegacy({
      destinatarioEmail: 'nuevo@example.test',
      remitenteEmail: 'sender@example.test',
      asunto: 'Productor antiguo',
      cuerpoTexto: 'No debe recuperar autoridad.'
    }),
    /rechaza productores legacy/iu
  );
  await assert.rejects(
    cola.registrarErrorFinal({ idCorreo: legadoId, error: 'consumidor antiguo' }),
    /rechaza despachadores legacy/iu
  );
}

function fila(riesgo, evidencias) {
  return Object.freeze({ riesgo, evidencias: Object.freeze([...evidencias]) });
}

function escaparRegExp(valor) {
  return valor.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
}

function sanearDiagnostico(error) {
  return [error?.stderr, error?.stdout, error?.message]
    .filter(Boolean).join(' ')
    .replace(/[\u0000-\u001f\u007f]+/gu, ' ')
    .replace(/\b(?:authorization|password|cookie|secret|token)\b\s*[:=]?\s*[^,;\s]+/giu,
      '[dato_sensible]')
    .replace(/\s+/gu, ' ').trim().slice(-1800);
}

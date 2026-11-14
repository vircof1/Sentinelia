import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import {
  CAUSAS_AVISO_PLATAFORMA,
  ESTADOS_CICLO_AVISO_PLATAFORMA,
  GRAVEDADES_AVISO_PLATAFORMA,
  TRANSICIONES_AVISO_PLATAFORMA,
  VERSION_CATALOGO_AVISOS_PLATAFORMA,
  construirClaveCausalAvisoPlataforma
} from '../paquetes/avisos-plataforma/src/index.js';
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

const MIGRACION_ESQUEMA = '0001_esquema_inicial.sql';
const RELACION_ID = `sfid1.relacion.${'R'.repeat(21)}A`;
const FLUJO_ID = `sfid1.flujo.${'F'.repeat(21)}A`;
const ENTRADA_CAUSAL = Object.freeze({
  versionCatalogo: VERSION_CATALOGO_AVISOS_PLATAFORMA,
  tipoCodigo: 'comunicacion',
  causaCodigo: 'relacion_silenciosa',
  objetoTipo: 'relacion_federada',
  objetoId: RELACION_ID,
  relacionId: RELACION_ID,
  flujoId: FLUJO_ID,
  scope: Object.freeze({ tenantId: '7', empresaId: '11', sitioId: null })
});

await main();

async function main() {
  verificarCatalogoYClaveCausal();
  await verificarEstructura();
  const configuracion = obtenerConfiguracionAplicacion();
  assert.equal(
    configuracion.sql.estaCompleta,
    true,
    'La verificación 5.22.10f requiere SQL local configurado.'
  );
  const clienteSql = new ClienteSql(configuracion.sql);
  try {
    await verificarMigracionesReejecutables(clienteSql);
    await verificarPersistencia(clienteSql);
  } finally {
    await clienteSql.cerrar();
  }
  console.log(
    '[federacion] OK 5.22.10f: avisos=transversales clave-causal=unica ' +
    'ciclos=durables historico=append-only scope=jerarquico'
  );
}

function verificarCatalogoYClaveCausal() {
  assert.equal(VERSION_CATALOGO_AVISOS_PLATAFORMA, 1);
  assert.deepEqual(ESTADOS_CICLO_AVISO_PLATAFORMA, [
    'pendiente',
    'resuelto',
    'obsoleto'
  ]);
  assert.deepEqual(GRAVEDADES_AVISO_PLATAFORMA, [
    'informativa',
    'advertencia',
    'critica'
  ]);
  assert.equal(TRANSICIONES_AVISO_PLATAFORMA.length, 8);
  assert.equal(CAUSAS_AVISO_PLATAFORMA.length, 14);
  assert.equal(
    new Set(CAUSAS_AVISO_PLATAFORMA.map(({ tipoCodigo, causaCodigo }) =>
      `${tipoCodigo}:${causaCodigo}`
    )).size,
    CAUSAS_AVISO_PLATAFORMA.length
  );
  assert.ok(Object.isFrozen(CAUSAS_AVISO_PLATAFORMA));
  assert.ok(CAUSAS_AVISO_PLATAFORMA.every((causa) => Object.isFrozen(causa)));

  const primera = construirClaveCausalAvisoPlataforma(ENTRADA_CAUSAL);
  const reordenada = construirClaveCausalAvisoPlataforma({
    scope: { sitioId: null, empresaId: '11', tenantId: '7' },
    flujoId: FLUJO_ID,
    relacionId: RELACION_ID,
    objetoId: RELACION_ID,
    objetoTipo: 'relacion_federada',
    causaCodigo: 'relacion_silenciosa',
    tipoCodigo: 'comunicacion',
    versionCatalogo: 1
  });
  assert.equal(primera.hashHex, reordenada.hashHex);
  assert.equal(primera.hashHex.length, 64);
  assert.notEqual(
    primera.hashHex,
    construirClaveCausalAvisoPlataforma({
      ...ENTRADA_CAUSAL,
      scope: { tenantId: '7', empresaId: '12', sitioId: null }
    }).hashHex
  );
  assert.throws(
    () => construirClaveCausalAvisoPlataforma({
      ...ENTRADA_CAUSAL,
      inesperado: true
    }),
    /campos ausentes o desconocidos/
  );
  assert.throws(
    () => construirClaveCausalAvisoPlataforma({
      ...ENTRADA_CAUSAL,
      causaCodigo: 'no_catalogada'
    }),
    /no pertenece al catálogo/
  );
  assert.throws(
    () => construirClaveCausalAvisoPlataforma({
      ...ENTRADA_CAUSAL,
      scope: { tenantId: null, empresaId: '12', sitioId: null }
    }),
    /scope portal/
  );
}

async function verificarEstructura() {
  const [esquemaOriginal, claveFuente] =
    await Promise.all([
      leer(`../migraciones/sql/${MIGRACION_ESQUEMA}`),
      leer('../paquetes/avisos-plataforma/src/ClaveCausalAvisoPlataforma.js')
    ]);
  const esquema = esquemaOriginal.replaceAll('`', '');
  assert.match(esquema, /UNIQUE KEY uk_avisos_plataforma_causa_activa/i);
  assert.match(esquema, /GENERATED ALWAYS AS/i);
  assert.match(esquema, /UNIQUE KEY uk_avisos_plataforma_ciclo_anterior/i);
  assert.doesNotMatch(esquema, /FOREIGN KEY \(scope_(?:tenant|empresa|sitio)_id\)/i);
  assert.match(esquema, /chk_historico_avisos_plataforma_transicion/i);
  assert.match(esquema, /append-only/i);
  assert.match(esquema, /causas versionadas de avisos no se eliminan/i);
  assert.doesNotMatch(claveFuente, /paquetes\/(?:federacion|auditoria)/);
}

async function verificarMigracionesReejecutables(clienteSql) {
  const repositorio = new RepositorioMigraciones(clienteSql);
  const ejecutor = new EjecutorMigraciones({
    clienteSql,
    repositorioMigraciones: repositorio,
    rutaMigraciones: obtenerRutaMigraciones()
  });
  const primera = await ejecutor.ejecutarPendientes();
  const segunda = await ejecutor.ejecutarPendientes();
  assert.equal(primera.pendientesAplicadas, 0);
  assert.equal(segunda.pendientesAplicadas, 0);
  const aplicadas = await repositorio.listarAplicadas();
  assert.ok(aplicadas.has(MIGRACION_ESQUEMA));
}

async function verificarPersistencia(clienteSql) {
  await verificarCatalogoSql(clienteSql);
  const avisoPrimero = generarUuidV7Auditoria();
  const avisoSegundo = generarUuidV7Auditoria();
  const avisoDuplicado = generarUuidV7Auditoria();
  const clave = construirClaveCausalAvisoPlataforma(ENTRADA_CAUSAL);
  const ids = [avisoPrimero, avisoSegundo, avisoDuplicado];

  try {
    await insertarAviso(clienteSql, {
      avisoId: avisoPrimero,
      clave,
      cicloAnteriorId: null,
      instante: '2026-08-02 12:00:00.000'
    });
    await insertarHistorico(clienteSql, {
      avisoId: avisoPrimero,
      transicion: 'apertura',
      instante: '2026-08-02 12:00:00.000'
    });

    await assert.rejects(
      () => insertarAviso(clienteSql, {
        avisoId: avisoDuplicado,
        clave,
        cicloAnteriorId: null,
        instante: '2026-08-02 12:00:01.000'
      }),
      /Duplicate entry|uk_avisos_plataforma_causa_activa/
    );
    await assert.rejects(
      () => clienteSql.ejecutar(
        `UPDATE avisos_plataforma SET objeto_id = 'mutado' WHERE aviso_id = ?`,
        [uuidV7AuditoriaABytes(avisoPrimero)]
      ),
      /identidad, causalidad y responsabilidad/
    );
    await assert.rejects(
      () => clienteSql.ejecutar(
        `UPDATE historico_avisos_plataforma SET detalle = JSON_OBJECT('x', 1) WHERE aviso_id = ?`,
        [uuidV7AuditoriaABytes(avisoPrimero)]
      ),
      /append-only/
    );
    await assert.rejects(
      () => insertarHistorico(clienteSql, {
        avisoId: avisoPrimero,
        ordinal: 2,
        transicion: 'escalado',
        estadoAnterior: 'pendiente',
        estadoNuevo: 'pendiente',
        gravedadAnterior: 'critica',
        gravedadNueva: 'advertencia',
        instante: '2026-08-02 12:00:01.000'
      }),
      /CONSTRAINT|constraint|chk_historico_avisos_plataforma_transicion/
    );

    const eventoResolucion = generarUuidV7Auditoria();
    await clienteSql.ejecutar(
      `UPDATE avisos_plataforma
       SET estado_ciclo = 'resuelto', resuelto_en_utc = ?,
           evento_ultima_transicion_id = ?
       WHERE aviso_id = ?`,
      [
        '2026-08-02 12:00:02.000',
        uuidV7AuditoriaABytes(eventoResolucion),
        uuidV7AuditoriaABytes(avisoPrimero)
      ]
    );
    await insertarHistorico(clienteSql, {
      avisoId: avisoPrimero,
      ordinal: 2,
      transicion: 'resolucion',
      estadoAnterior: 'pendiente',
      estadoNuevo: 'resuelto',
      gravedadAnterior: 'advertencia',
      gravedadNueva: 'advertencia',
      instante: '2026-08-02 12:00:02.000',
      eventoId: eventoResolucion
    });
    await insertarAviso(clienteSql, {
      avisoId: avisoSegundo,
      clave,
      cicloAnteriorId: avisoPrimero,
      instante: '2026-08-02 12:00:03.000'
    });
    await insertarHistorico(clienteSql, {
      avisoId: avisoSegundo,
      transicion: 'reapertura',
      instante: '2026-08-02 12:00:03.000'
    });

    const filas = await clienteSql.consultar(
      `SELECT estado_ciclo, clave_causal_activa IS NULL AS clave_activa_nula,
              HEX(ciclo_anterior_aviso_id) AS ciclo_anterior_hex
       FROM avisos_plataforma
       WHERE aviso_id IN (?, ?)
       ORDER BY primera_deteccion_utc ASC`,
      [uuidV7AuditoriaABytes(avisoPrimero), uuidV7AuditoriaABytes(avisoSegundo)]
    );
    assert.deepEqual(filas.map(({ estado_ciclo }) => estado_ciclo), ['resuelto', 'pendiente']);
    assert.deepEqual(filas.map(({ clave_activa_nula }) => Number(clave_activa_nula)), [1, 0]);
    assert.equal(
      filas[1].ciclo_anterior_hex.toLowerCase(),
      uuidV7AuditoriaABytes(avisoPrimero).toString('hex')
    );

    const triggers = await clienteSql.consultar(
      `SELECT TRIGGER_NAME AS nombre
       FROM information_schema.TRIGGERS
       WHERE TRIGGER_SCHEMA = DATABASE()
         AND TRIGGER_NAME IN (
           'trg_avisos_plataforma_proteger_causalidad',
           'trg_historico_avisos_plataforma_impedir_update',
           'trg_catalogo_causas_avisos_impedir_update',
           'trg_catalogo_causas_avisos_impedir_delete'
         )`
    );
    assert.equal(triggers.length, 4);
  } finally {
    await limpiar(clienteSql, ids);
  }
}

async function verificarCatalogoSql(clienteSql) {
  const filas = await clienteSql.consultar(
    `SELECT version_catalogo, tipo_codigo, causa_codigo, gravedad_inicial,
            admite_resolucion_administrativa
     FROM catalogo_causas_avisos_plataforma
     WHERE version_catalogo = 1
     ORDER BY tipo_codigo, causa_codigo`
  );
  const esperado = CAUSAS_AVISO_PLATAFORMA
    .filter((causa) => causa.versionCatalogo === 1)
    .map((causa) => ({
    version_catalogo: causa.versionCatalogo,
    tipo_codigo: causa.tipoCodigo,
    causa_codigo: causa.causaCodigo,
    gravedad_inicial: causa.gravedadInicial,
    admite_resolucion_administrativa: Number(causa.admiteResolucionAdministrativa)
  })).sort((a, b) =>
    `${a.tipo_codigo}:${a.causa_codigo}`.localeCompare(`${b.tipo_codigo}:${b.causa_codigo}`)
  );
  assert.deepEqual(filas.map((fila) => ({ ...fila })), esperado);
}

async function insertarAviso(clienteSql, {
  avisoId,
  clave,
  cicloAnteriorId,
  instante
}) {
  const correlacionId = generarUuidV7Auditoria();
  const eventoId = generarUuidV7Auditoria();
  return clienteSql.ejecutar(
    `INSERT INTO avisos_plataforma (
       aviso_id, version_catalogo, tipo_codigo, causa_codigo, clave_causal,
       estado_ciclo, gravedad, scope_tenant_id, scope_empresa_id, scope_sitio_id,
       objeto_tipo, objeto_id, relacion_id, flujo_id, ciclo_anterior_aviso_id,
       primera_deteccion_utc, ultima_deteccion_utc, contador_detecciones,
       contexto_humano, resumen, correlacion_apertura_id, evento_apertura_id,
       evento_ultima_transicion_id
     ) VALUES (?, 1, 'comunicacion', 'relacion_silenciosa', ?,
       'pendiente', 'advertencia', 7, 11, NULL,
       'relacion_federada', ?, ?, ?, ?, ?, ?, 1,
       JSON_OBJECT('nombreInstalacion', 'remota'), JSON_OBJECT('silencio', true),
       ?, ?, ?)`,
    [
      uuidV7AuditoriaABytes(avisoId),
      Buffer.from(clave.hashHex, 'hex'),
      RELACION_ID,
      RELACION_ID,
      FLUJO_ID,
      cicloAnteriorId ? uuidV7AuditoriaABytes(cicloAnteriorId) : null,
      instante,
      instante,
      uuidV7AuditoriaABytes(correlacionId),
      uuidV7AuditoriaABytes(eventoId),
      uuidV7AuditoriaABytes(eventoId)
    ]
  );
}

async function insertarHistorico(clienteSql, {
  avisoId,
  ordinal = 1,
  transicion,
  estadoAnterior = null,
  estadoNuevo = 'pendiente',
  gravedadAnterior = null,
  gravedadNueva = 'advertencia',
  instante,
  eventoId = generarUuidV7Auditoria()
}) {
  return clienteSql.ejecutar(
    `INSERT INTO historico_avisos_plataforma (
       aviso_id, ordinal, transicion_tipo, estado_anterior, estado_nuevo,
       gravedad_anterior, gravedad_nueva, contador_detecciones,
       efectivo_en_utc, registrado_en_utc, evento_auditoria_id,
       correlacion_id, detalle
     ) VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?, JSON_OBJECT('prueba', true))`,
    [
      uuidV7AuditoriaABytes(avisoId),
      ordinal,
      transicion,
      estadoAnterior,
      estadoNuevo,
      gravedadAnterior,
      gravedadNueva,
      instante,
      instante,
      uuidV7AuditoriaABytes(eventoId),
      uuidV7AuditoriaABytes(generarUuidV7Auditoria())
    ]
  );
}

async function limpiar(clienteSql, ids) {
  const bytes = ids.map((id) => uuidV7AuditoriaABytes(id));
  const marcadores = bytes.map(() => '?').join(', ');
  await clienteSql.ejecutar(
    `DELETE FROM historico_avisos_plataforma WHERE aviso_id IN (${marcadores})`,
    bytes
  );
  for (const id of [ids[1], ids[2], ids[0]]) {
    await clienteSql.ejecutar(
      'DELETE FROM avisos_plataforma WHERE aviso_id = ?',
      [uuidV7AuditoriaABytes(id)]
    );
  }
}

function leer(ruta) {
  return readFile(new URL(ruta, import.meta.url), 'utf8');
}

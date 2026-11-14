import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import {
  CAPACIDADES_RUNTIME_TRIGGER_CORREO,
  CAPACIDADES_WEB_TRIGGER_CORREO,
  crearDeclaracionCompatibilidadRuntimeTriggerCorreo,
  evaluarPreparacionLocalTriggerCorreo,
  evaluarUnanimidadPreparacionTriggerCorreo,
  MIGRACIONES_TRIGGER_CORREO,
  PERFIL_DESPLIEGUE_TRIGGER_CORREO,
  RepositorioPreparacionDespliegueTriggerCorreoSql,
  resolverUnanimidadPreparacionTriggerCorreo
} from '../paquetes/correo/src/CompatibilidadDespliegueTriggerCorreo.js';
import { ClienteSql } from '../paquetes/persistencia-sql/src/ClienteSql.js';
import { EjecutorMigraciones }
  from '../paquetes/persistencia-sql/src/EjecutorMigraciones.js';
import { RepositorioMigraciones }
  from '../paquetes/persistencia-sql/src/RepositorioMigraciones.js';
import {
  obtenerConfiguracionAplicacion,
  obtenerRutaMigraciones
} from '../paquetes/utilidades/src/configuracion/obtenerConfiguracionAplicacion.js';

await main();

async function main() {
  verificarContratoPuro();
  const configuracion = obtenerConfiguracionAplicacion();
  assert.equal(configuracion.sql.estaCompleta, true,
    '5.27.13a necesita MariaDB real.');
  const administrador = new ClienteSql(configuracion.sql);
  const nombre = `sentinelia_fixture_52713a_${randomBytes(5).toString('hex')}`;
  let sql;
  try {
    await administrador.ejecutar(
      `CREATE DATABASE ${administrador.escaparIdentificador(nombre)} ` +
        'CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci'
    );
    sql = new ClienteSql({ ...configuracion.sql, baseDatos: nombre });
    const repositorioMigraciones = new RepositorioMigraciones(sql);
    const migraciones = await new EjecutorMigraciones({
      clienteSql: sql,
      repositorioMigraciones,
      rutaMigraciones: obtenerRutaMigraciones()
    }).ejecutarPendientes();
    assert.equal(migraciones.integridad.ok, true);
    const preparacion = evaluarPreparacionLocalTriggerCorreo({
      migracionesAplicadas: await repositorioMigraciones.listarNombresAplicados(),
      postcondicionesMigracionesVerificadas: migraciones.integridad.ok,
      fotografia: await new RepositorioPreparacionDespliegueTriggerCorreoSql(sql)
        .fotografiar()
    });
    assert.deepEqual(preparacion, {
      preparada: true,
      perfil: PERFIL_DESPLIEGUE_TRIGGER_CORREO,
      estado: 'preparacion',
      gateAbierto: false,
      migracionesVerificadas: MIGRACIONES_TRIGGER_CORREO.length,
      filasCorreoProductivas: 0
    });
    await verificarResolucionRedis(preparacion);
    await verificarComposicion();
    console.log(
      '[correo-trigger] OK 5.27.13a: perfil=web+runtime unanimidad=total ' +
      'migraciones=esquema_inicial postcondiciones=verificadas filas=coherentes gate=cerrado'
    );
  } finally {
    await sql?.cerrar().catch(() => {});
    await administrador.ejecutar(
      `DROP DATABASE IF EXISTS ${administrador.escaparIdentificador(nombre)}`
    ).catch(() => {});
    await administrador.cerrar();
  }
}

function verificarContratoPuro() {
  const fotografia = fotografiaPreparada();
  const base = {
    migracionesAplicadas: MIGRACIONES_TRIGGER_CORREO,
    postcondicionesMigracionesVerificadas: true,
    fotografia
  };
  const preparacion = evaluarPreparacionLocalTriggerCorreo(base);
  const declaracion = crearDeclaracionCompatibilidadRuntimeTriggerCorreo({
    instanciaId: 'runtime-13a', preparacionLocal: preparacion
  });
  assert.deepEqual(declaracion.capacidades, CAPACIDADES_RUNTIME_TRIGGER_CORREO);
  assert.deepEqual(declaracion.capacidadesWebEmpaquetadas,
    CAPACIDADES_WEB_TRIGGER_CORREO);
  const presencia = {
    instanciaId: 'runtime-13a',
    capacidadesDespliegue: { triggerCorreo: declaracion }
  };
  assert.equal(evaluarUnanimidadPreparacionTriggerCorreo({
    preparacionLocal: preparacion,
    capacidadesWeb: CAPACIDADES_WEB_TRIGGER_CORREO,
    instanciasRuntime: [presencia]
  }).unanimidad, true);
  assertCodigo(() => evaluarPreparacionLocalTriggerCorreo({
    ...base,
    migracionesAplicadas: MIGRACIONES_TRIGGER_CORREO.slice(1)
  }), 'migraciones_correo_ausentes');
  assertCodigo(() => evaluarPreparacionLocalTriggerCorreo({
    ...base,
    postcondicionesMigracionesVerificadas: false
  }), 'postcondiciones_correo_no_verificadas');
  assertCodigo(() => evaluarPreparacionLocalTriggerCorreo({
    ...base,
    fotografia: fotografiaPreparada({ tipo_correo_habilitado: 1 })
  }), 'gate_correo_abierto_anticipadamente');
  assertCodigo(() => evaluarPreparacionLocalTriggerCorreo({
    ...base,
    fotografia: {
      ...fotografia,
      conteos: { ...fotografia.conteos, triggers_correo: 1 }
    }
  }), 'filas_correo_anticipadas');
  assertCodigo(() => evaluarUnanimidadPreparacionTriggerCorreo({
    preparacionLocal: preparacion,
    capacidadesWeb: CAPACIDADES_WEB_TRIGGER_CORREO,
    instanciasRuntime: [{ instanciaId: 'antigua', capacidadesDespliegue: {} }]
  }), 'runtime_capacidad_ausente');
  assertCodigo(() => evaluarUnanimidadPreparacionTriggerCorreo({
    preparacionLocal: preparacion,
    capacidadesWeb: CAPACIDADES_WEB_TRIGGER_CORREO,
    instanciasRuntime: [presencia, {
      instanciaId: 'incompleta',
      capacidadesDespliegue: {
        triggerCorreo: { ...declaracion, capacidades: [] }
      }
    }]
  }), 'runtime_capacidad_correo_incompleta');
}

async function verificarResolucionRedis(preparacionLocal) {
  const declaracion = crearDeclaracionCompatibilidadRuntimeTriggerCorreo({
    instanciaId: 'runtime-vivo', preparacionLocal
  });
  const valores = new Map([
    ['rt:instancias:viva:presencia', JSON.stringify({
      instanciaId: 'runtime-vivo',
      entorno: 'prueba',
      capacidadesDespliegue: { triggerCorreo: declaracion }
    })],
    ['rt:instancias:otro:presencia', JSON.stringify({
      instanciaId: 'runtime-otro-entorno',
      entorno: 'otro',
      capacidadesDespliegue: {}
    })]
  ]);
  const clienteRedis = {
    async *scanIterator() { yield [...valores.keys()]; },
    async get(clave) { return valores.get(clave) ?? null; }
  };
  const resultado = await resolverUnanimidadPreparacionTriggerCorreo({
    preparacionLocal,
    capacidadesWeb: CAPACIDADES_WEB_TRIGGER_CORREO,
    clienteRedis,
    prefijoRuntime: 'rt:',
    entorno: 'prueba',
    esperaMaximaMs: 0
  });
  assert.equal(resultado.unanimidad, true);
  assert.equal(resultado.instanciasRuntimeCompatibles, 1);
  assert.equal(resultado.gateAbierto, false);
}

async function verificarComposicion() {
  const [runtime, bootstrap, web, salud] = await Promise.all([
    leer('../apps/sentinelia-runtime/src/RuntimeSentinelia.js'),
    leer('../apps/sentinelia-runtime/src/BootstrapRuntime.js'),
    leer('../apps/sentinelia-web/src/index.js'),
    leer('../apps/sentinelia-web/src/crearAplicacion.js')
  ]);
  assert.match(runtime,
    /publicarCapacidadDespliegue\([\s\S]{0,120}'triggerCorreo'/u);
  assert.match(bootstrap, /evaluarPreparacionLocalTriggerCorreo/u);
  assert.match(web, /resolverUnanimidadPreparacionTriggerCorreo/u);
  assert.match(salud, /despliegueTriggerCorreo/u);
}

function fotografiaPreparada(cambios = {}) {
  return {
    estado: {
      perfil_objetivo: PERFIL_DESPLIEGUE_TRIGGER_CORREO,
      estado: 'preparacion',
      guard_metadatos_activo: 0,
      origen_portal_autoritativo: 0,
      verificacion_smtp_autoritativa: 0,
      guard_verificacion_legacy_activo: 0,
      guard_revision_trigger_activo: 0,
      cola_sql_autoritativa: 0,
      tipo_correo_habilitado: 0,
      ...cambios
    },
    conteos: {
      triggers_correo: 0,
      notificaciones: 0,
      resultados: 0,
      salidas_trigger: 0,
      intentos_smtp: 0
    }
  };
}

function assertCodigo(operacion, codigo) {
  assert.throws(operacion, (error) => error.codigo === codigo);
}

function leer(ruta) {
  return readFile(new URL(ruta, import.meta.url), 'utf8');
}

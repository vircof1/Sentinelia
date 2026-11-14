import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { readFile } from 'node:fs/promises';

import { ClienteSql } from '../paquetes/persistencia-sql/src/ClienteSql.js';
import { EjecutorMigraciones } from '../paquetes/persistencia-sql/src/EjecutorMigraciones.js';
import { RepositorioMigraciones }
  from '../paquetes/persistencia-sql/src/RepositorioMigraciones.js';
import { RepositorioTriggers } from '../paquetes/triggers/src/RepositorioTriggers.js';
import { ServicioTriggers } from '../paquetes/triggers/src/ServicioTriggers.js';
import { ValidadorTrigger } from '../paquetes/triggers/src/ValidadorTrigger.js';
import {
  obtenerConfiguracionAplicacion,
  obtenerRutaMigraciones
} from '../paquetes/utilidades/src/configuracion/obtenerConfiguracionAplicacion.js';

async function main() {
  const configuracion = obtenerConfiguracionAplicacion();
  assert.equal(configuracion.sql.estaCompleta, true, '5.27.3c necesita MariaDB real.');
  const administrador = new ClienteSql(configuracion.sql);
  const nombre = `sentinelia_fixture_5273c_${randomBytes(5).toString('hex')}`;
  let sql;
  try {
    await administrador.ejecutar(
      `CREATE DATABASE ${administrador.escaparIdentificador(nombre)} ` +
        'CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci'
    );
    sql = new ClienteSql({ ...configuracion.sql, baseDatos: nombre });
    const migracion = await new EjecutorMigraciones({
      clienteSql: sql,
      repositorioMigraciones: new RepositorioMigraciones(sql),
      rutaMigraciones: obtenerRutaMigraciones()
    }).ejecutarPendientes();
    assert.equal(migracion.integridad.ok, true);

    await verificarMutacionOptimista(sql);
    await verificarGuardDurable(sql);
    await verificarTransporteWeb();

    console.log(
      '[correo-trigger] OK 5.27.3c: revision=optimista api_dns=adaptados ' +
        'conflicto=409 formularios=transportan_revision guard_sql=preparado_inactivo'
    );
  } finally {
    await sql?.cerrar().catch(() => {});
    await administrador.ejecutar(
      `DROP DATABASE IF EXISTS ${administrador.escaparIdentificador(nombre)}`
    ).catch(() => {});
    await administrador.cerrar();
  }
}

async function verificarMutacionOptimista(sql) {
  const repositorio = new RepositorioTriggers(sql);
  const servicio = new ServicioTriggers({
    repositorioTriggers: repositorio,
    repositorioAsignacionesTriggerMonitor: {},
    validadorTrigger: new ValidadorTrigger()
  });
  const api = await repositorio.crear(definicionApi());
  const dns = await repositorio.crear(definicionDns());
  assert.equal(api.revisionDeclaracion, 1);
  assert.equal(dns.revisionDeclaracion, 1);

  await assert.rejects(
    servicio.actualizarTrigger(api.id, entradaApi({ descripcion: 'sin revisión' })),
    (error) => error?.codigo === 'trigger_revision_requerida' &&
      error?.statusCode === 400
  );

  const apiActualizada = await servicio.actualizarTrigger(
    api.id,
    entradaApi({ descripcion: 'primera mutación', revisionDeclaracion: 1 })
  );
  assert.equal(apiActualizada.revisionDeclaracion, 2);
  assert.equal(apiActualizada.descripcion, 'primera mutación');

  await assert.rejects(
    servicio.actualizarTrigger(
      api.id,
      entradaApi({ descripcion: 'escritura perdida', revisionDeclaracion: 1 })
    ),
    esConflictoRevision(1, 2)
  );
  await assert.rejects(
    servicio.actualizarTrigger(
      api.id,
      entradaApi({ descripcion: 'primera mutación', revisionDeclaracion: 1 })
    ),
    esConflictoRevision(1, 2),
    'Una instantánea obsoleta no puede ocultarse como no-op.'
  );
  assert.equal((await repositorio.buscarPorId(api.id)).descripcion, 'primera mutación');

  const dnsActualizado = await repositorio.actualizar({
    ...definicionDns(),
    idTrigger: dns.id,
    descripcion: 'DNS revisado',
    revisionDeclaracion: 1
  });
  assert.equal(dnsActualizado.revisionDeclaracion, 2);
  await assert.rejects(
    repositorio.eliminar(dns.id, { revisionDeclaracion: 1 }),
    esConflictoRevision(1, 2)
  );
  assert.equal(await repositorio.eliminar(dns.id, { revisionDeclaracion: 2 }), true);
  assert.equal(await repositorio.buscarPorId(dns.id), null);
}

async function verificarGuardDurable(sql) {
  const repositorio = new RepositorioTriggers(sql);
  const trigger = await repositorio.crear({
    ...definicionApi(),
    nombre: 'API guard 5273c'
  });
  const [estadoInicial] = await sql.consultar(`
    SELECT guard_revision_trigger_activo
      FROM estado_despliegue_trigger_correo
     WHERE id = 1
  `);
  assert.equal(Number(estadoInicial.guard_revision_trigger_activo), 0);

  await sql.ejecutar(
    'UPDATE triggers SET descripcion = ? WHERE id = ?',
    ['writer antiguo aún tolerado', trigger.id]
  );
  assert.equal((await repositorio.buscarPorId(trigger.id)).revisionDeclaracion, 1);

  await sql.ejecutar(`
    UPDATE estado_despliegue_trigger_correo
       SET estado = 'corte_origen',
           cortado_en_utc = UTC_TIMESTAMP(3),
           guard_revision_trigger_activo = 1,
           revision = revision + 1
     WHERE id = 1
  `);
  await assert.rejects(
    sql.ejecutar('UPDATE triggers SET descripcion = ? WHERE id = ?', [
      'writer antiguo rechazado', trigger.id
    ]),
    (error) => error?.code === 'ER_SIGNAL_EXCEPTION'
  );

  const actualizado = await repositorio.actualizar({
    ...definicionApi(),
    idTrigger: trigger.id,
    nombre: trigger.nombre,
    descripcion: 'writer revisado admitido',
    revisionDeclaracion: 1
  });
  assert.equal(actualizado.revisionDeclaracion, 2);
  assert.equal(actualizado.descripcion, 'writer revisado admitido');
}

async function verificarTransporteWeb() {
  const [formulario, listado, javascript] = await Promise.all([
    leer('../apps/sentinelia-web/src/views/portal/trigger-formulario.ejs'),
    leer('../apps/sentinelia-web/src/views/portal/triggers.ejs'),
    leer('../apps/sentinelia-web/src/public/js/triggers.js')
  ]);
  assert.match(formulario, /name="revisionDeclaracion"/u);
  assert.match(listado, /data-modal-impacto-trigger-revision/u);
  assert.match(javascript, /trigger\.revisionDeclaracion/u);
}

function definicionApi() {
  return {
    tenantId: null,
    empresaId: null,
    sitioId: null,
    nombre: 'API 5273c',
    tipo: 'api',
    descripcion: 'API original',
    activo: false,
    configuracion: {
      url: 'https://hooks.example.test/incidente',
      metodo: 'POST',
      timeoutMs: 1000,
      reintentos: 1,
      permiteTlsInseguro: false
    }
  };
}

function entradaApi({ descripcion, revisionDeclaracion } = {}) {
  return {
    nombre: 'API 5273c',
    tipo: 'api',
    descripcion,
    activo: false,
    url: 'https://hooks.example.test/incidente',
    metodo: 'POST',
    timeoutMs: 1000,
    reintentos: 1,
    permiteTlsInseguro: false,
    ...(revisionDeclaracion === undefined ? {} : { revisionDeclaracion })
  };
}

function definicionDns() {
  return {
    tenantId: null,
    empresaId: null,
    sitioId: null,
    nombre: 'DNS 5273c',
    tipo: 'dns',
    descripcion: 'DNS original',
    activo: false,
    configuracion: {
      zonaId: 30,
      registroId: 40,
      operacion: 'seguir_estado_monitor',
      valorPrincipal: null,
      rolGobernanza: 'operaciones:dns'
    }
  };
}

function esConflictoRevision(revisionEsperada, revisionActual) {
  return (error) => error?.codigo === 'trigger_revision_obsoleta' &&
    error?.statusCode === 409 &&
    error?.revisionEsperada === revisionEsperada &&
    error?.revisionActual === revisionActual;
}

function leer(ruta) {
  return readFile(new URL(ruta, import.meta.url), 'utf8');
}

await main();

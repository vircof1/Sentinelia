import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import {
  evaluarPreparacionLocalTriggerCorreo,
  PERFIL_DESPLIEGUE_TRIGGER_CORREO,
  RepositorioPreparacionDespliegueTriggerCorreoSql
} from '../paquetes/correo/src/CompatibilidadDespliegueTriggerCorreo.js';
import { ServicioCorteAutoridadOrigenCorreo }
  from '../paquetes/correo/src/ServicioCorteAutoridadOrigenCorreo.js';
import { ServicioCorteRevisionTriggersCorreo }
  from '../paquetes/correo/src/ServicioCorteRevisionTriggersCorreo.js';
import { RepositorioConfiguracion }
  from '../paquetes/configuracion/src/RepositorioConfiguracion.js';
import { ServicioConfiguracionPortal }
  from '../paquetes/configuracion/src/ServicioConfiguracionPortal.js';
import { obtenerDefinicionesConfiguracionPortal }
  from '../paquetes/configuracion/src/obtenerDefinicionesConfiguracionPortal.js';
import { ClienteSql } from '../paquetes/persistencia-sql/src/ClienteSql.js';
import { EjecutorMigraciones }
  from '../paquetes/persistencia-sql/src/EjecutorMigraciones.js';
import { FronteraTransaccionalLocal }
  from '../paquetes/persistencia-sql/src/FronteraTransaccionalLocal.js';
import { RepositorioMigraciones }
  from '../paquetes/persistencia-sql/src/RepositorioMigraciones.js';
import { RepositorioTriggers } from '../paquetes/triggers/src/RepositorioTriggers.js';
import {
  obtenerConfiguracionAplicacion,
  obtenerRutaMigraciones
} from '../paquetes/utilidades/src/configuracion/obtenerConfiguracionAplicacion.js';

await main();

async function main() {
  const configuracion = obtenerConfiguracionAplicacion();
  assert.equal(configuracion.sql.estaCompleta, true,
    '5.27.13c necesita MariaDB real.');
  const administrador = new ClienteSql(configuracion.sql);
  const nombre = `sentinelia_fixture_52713c_${randomBytes(5).toString('hex')}`;
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
    const frontera = new FronteraTransaccionalLocal(sql);
    const repositorioConfiguracion = new RepositorioConfiguracion(sql);
    let versionRedis = null;
    const versionadorConfiguracionRedis = {
      async obtenerVersionActual() { return versionRedis; },
      async publicarVersion(version) {
        versionRedis = Number(version);
        return versionRedis;
      }
    };
    await new ServicioConfiguracionPortal({
      repositorioConfiguracion,
      versionadorConfiguracionRedis,
      definiciones: obtenerDefinicionesConfiguracionPortal(configuracion),
      fronteraTransaccional: frontera,
      servicioAuditoria: { async registrarEnTransaccion() {} }
    }).bootstrapYcargar();
    const repositorioTriggers = new RepositorioTriggers(sql);
    const api = await repositorioTriggers.crear(definicionTrigger('api'));
    const dns = await repositorioTriggers.crear(definicionTrigger('dns'));
    const unanimidad = {
      unanimidad: true,
      gateAbierto: false,
      perfil: PERFIL_DESPLIEGUE_TRIGGER_CORREO
    };
    await new ServicioCorteAutoridadOrigenCorreo({
      repositorioConfiguracion,
      fronteraTransaccional: frontera,
      versionadorConfiguracionRedis
    }).ejecutar({ preparacionUnanime: unanimidad });
    const servicioCorte = new ServicioCorteRevisionTriggersCorreo({
      repositorioConfiguracion,
      fronteraTransaccional: frontera
    });
    const corte = await servicioCorte.ejecutar({ preparacionUnanime: unanimidad });
    assert.deepEqual(corte, {
      cambioEfectivo: true,
      declaracionesInvalidadas: 2,
      estado: 'corte_revision'
    });
    const fotografia = await new RepositorioPreparacionDespliegueTriggerCorreoSql(sql)
      .fotografiar();
    assert.equal(Number(fotografia.estado.guard_revision_trigger_activo), 1);
    assert.equal(Number(fotografia.estado.revision), 3);
    assert.equal(evaluarPreparacionLocalTriggerCorreo({
      migracionesAplicadas: await repositorioMigraciones.listarNombresAplicados(),
      postcondicionesMigracionesVerificadas: migraciones.integridad.ok,
      fotografia
    }).estado, 'corte_origen');
    assert.equal((await repositorioTriggers.buscarPorId(api.id)).revisionDeclaracion, 2);
    assert.equal((await repositorioTriggers.buscarPorId(dns.id)).revisionDeclaracion, 2);
    await assert.rejects(
      sql.ejecutar('UPDATE triggers SET descripcion=? WHERE id=?', [
        'escritor antiguo', api.id
      ]),
      /debe avanzar exactamente una revisión declarativa/u
    );
    await assert.rejects(
      repositorioTriggers.actualizar({
        ...definicionTrigger('api'),
        idTrigger: api.id,
        revisionDeclaracion: 1
      }),
      (error) => error?.codigo === 'trigger_revision_obsoleta' &&
        error?.revisionActual === 2
    );
    const apiNueva = await repositorioTriggers.actualizar({
      ...definicionTrigger('api'),
      idTrigger: api.id,
      descripcion: 'API posterior al corte',
      revisionDeclaracion: 2
    });
    const dnsNuevo = await repositorioTriggers.actualizar({
      ...definicionTrigger('dns'),
      idTrigger: dns.id,
      descripcion: 'DNS posterior al corte',
      revisionDeclaracion: 2
    });
    assert.equal(apiNueva.revisionDeclaracion, 3);
    assert.equal(dnsNuevo.revisionDeclaracion, 3);
    const repetido = await servicioCorte.ejecutar({ preparacionUnanime: unanimidad });
    assert.equal(repetido.cambioEfectivo, false);
    assert.equal((await repositorioTriggers.buscarPorId(api.id)).revisionDeclaracion, 3);
    assert.equal((await repositorioTriggers.buscarPorId(dns.id)).revisionDeclaracion, 3);
    console.log(
      '[correo-trigger] OK 5.27.13c: formularios invalidados una vez, ' +
      'writer antiguo rechazado, API y DNS revisados admitidos, corte idempotente'
    );
  } finally {
    await sql?.cerrar().catch(() => {});
    await administrador.ejecutar(
      `DROP DATABASE IF EXISTS ${administrador.escaparIdentificador(nombre)}`
    ).catch(() => {});
    await administrador.cerrar();
  }
}

function definicionTrigger(tipo) {
  return {
    tenantId: null,
    empresaId: null,
    sitioId: null,
    nombre: `${tipo.toUpperCase()} corte 13c`,
    tipo,
    descripcion: 'Antes del corte',
    activo: false,
    configuracion: tipo === 'api'
      ? { url: 'https://hooks.example.test/evento', metodo: 'POST' }
      : {
          zonaId: 1,
          registroId: 1,
          operacion: 'seguir_estado_monitor',
          rolGobernanza: 'operaciones:dns'
        }
  };
}

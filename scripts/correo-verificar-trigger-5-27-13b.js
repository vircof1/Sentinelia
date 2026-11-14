import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import {
  evaluarPreparacionLocalTriggerCorreo,
  MIGRACIONES_TRIGGER_CORREO,
  PERFIL_DESPLIEGUE_TRIGGER_CORREO,
  RepositorioPreparacionDespliegueTriggerCorreoSql
} from '../paquetes/correo/src/CompatibilidadDespliegueTriggerCorreo.js';
import { ServicioCorteAutoridadOrigenCorreo }
  from '../paquetes/correo/src/ServicioCorteAutoridadOrigenCorreo.js';
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
import {
  obtenerConfiguracionAplicacion,
  obtenerRutaMigraciones
} from '../paquetes/utilidades/src/configuracion/obtenerConfiguracionAplicacion.js';

await main();

async function main() {
  const configuracion = obtenerConfiguracionAplicacion();
  assert.equal(configuracion.sql.estaCompleta, true,
    '5.27.13b necesita MariaDB real.');
  const administrador = new ClienteSql(configuracion.sql);
  const nombre = `sentinelia_fixture_52713b_${randomBytes(5).toString('hex')}`;
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
    const repositorioConfiguracion = new RepositorioConfiguracion(sql);
    const versionesPublicadas = [];
    let versionRedis = null;
    const versionadorConfiguracionRedis = {
      async obtenerVersionActual() { return versionRedis; },
      async publicarVersion(version) {
        versionesPublicadas.push(String(version));
        versionRedis = Number(version);
        return versionRedis;
      }
    };
    await new ServicioConfiguracionPortal({
      repositorioConfiguracion,
      versionadorConfiguracionRedis,
      definiciones: obtenerDefinicionesConfiguracionPortal(configuracion),
      fronteraTransaccional: new FronteraTransaccionalLocal(sql),
      servicioAuditoria: { async registrarEnTransaccion() {} }
    }).bootstrapYcargar();
    await sql.ejecutar(
      `UPDATE configuracion_portal
          SET valor = CASE clave
            WHEN 'federacion.origen_publico' THEN 'https://ultimo.example.test'
            WHEN 'portal.origen_publico' THEN 'https://obsoleto.example.test'
            ELSE valor
          END
        WHERE clave IN ('federacion.origen_publico', 'portal.origen_publico')`
    );
    const servicio = new ServicioCorteAutoridadOrigenCorreo({
      repositorioConfiguracion,
      fronteraTransaccional: new FronteraTransaccionalLocal(sql),
      versionadorConfiguracionRedis
    });
    const unanimidad = {
      unanimidad: true,
      gateAbierto: false,
      perfil: PERFIL_DESPLIEGUE_TRIGGER_CORREO
    };
    const primero = await servicio.ejecutar({ preparacionUnanime: unanimidad });
    assert.equal(primero.cambioEfectivo, true);
    assert.equal(primero.origenCopiado, 'https://ultimo.example.test');
    const fotografia = await new RepositorioPreparacionDespliegueTriggerCorreoSql(sql)
      .fotografiar();
    const postcondicion = evaluarPreparacionLocalTriggerCorreo({
      migracionesAplicadas: await repositorioMigraciones.listarNombresAplicados(),
      postcondicionesMigracionesVerificadas: migraciones.integridad.ok,
      fotografia
    });
    assert.equal(postcondicion.estado, 'corte_origen');
    assert.equal(postcondicion.gateAbierto, false);
    assert.equal(Number(fotografia.estado.origen_portal_autoritativo), 1);
    assert.equal(Number(fotografia.estado.revision), 2);
    const valores = await sql.consultar(
      `SELECT clave, valor FROM configuracion_portal
        WHERE clave IN ('federacion.origen_publico', 'portal.origen_publico')`
    );
    assert.equal(new Map(valores.map(({ clave, valor }) => [clave, valor]))
      .get('portal.origen_publico'), 'https://ultimo.example.test');
    await assert.rejects(
      sql.ejecutar(
        `UPDATE configuracion_portal
            SET valor='https://resurreccion.example.test'
          WHERE clave='federacion.origen_publico'`
      ),
      /origen federado legacy ya no es autoridad/u
    );
    await sql.ejecutar(
      `UPDATE configuracion_portal
          SET valor='https://nuevo.example.test'
        WHERE clave='portal.origen_publico'`
    );
    const segundo = await servicio.ejecutar({ preparacionUnanime: unanimidad });
    assert.equal(segundo.cambioEfectivo, false);
    assert.equal(segundo.versionDurable, primero.versionDurable);
    assert.deepEqual(versionesPublicadas.slice(-2),
      [primero.versionDurable, primero.versionDurable]);
    assert.equal((await sql.consultar(
      `SELECT valor FROM configuracion_portal WHERE clave='portal.origen_publico'`
    ))[0].valor, 'https://nuevo.example.test');
    console.log(
      '[correo-trigger] OK 5.27.13b: último origen copiado, autoridad portal única, ' +
      'guard legacy activo, versión publicada e idempotencia demostrada'
    );
  } finally {
    await sql?.cerrar().catch(() => {});
    await administrador.ejecutar(
      `DROP DATABASE IF EXISTS ${administrador.escaparIdentificador(nombre)}`
    ).catch(() => {});
    await administrador.cerrar();
  }
}

assert.deepEqual(MIGRACIONES_TRIGGER_CORREO, ['0001_esquema_inicial.sql']);

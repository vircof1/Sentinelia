import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { readFile } from 'node:fs/promises';

import { AdaptadorCapturaTransaccionalFederacionSql } from '../paquetes/federacion/adaptadores/AdaptadorCapturaTransaccionalFederacionSql.js';
import {
  AdaptadorEstructuraOrganizativaFederacionSql,
  crearDefinicionAdaptadorEstructuraOrganizativaFederacion
} from '../paquetes/federacion/adaptadores/AdaptadorEstructuraOrganizativaFederacionSql.js';
import { FuenteEntropiaCriptograficaNode } from '../paquetes/federacion/adaptadores/FuenteEntropiaCriptograficaNode.js';
import { RepositorioEstructuraOrganizativaLocalSql } from '../paquetes/federacion/adaptadores/RepositorioEstructuraOrganizativaLocalSql.js';
import { RepositorioEstructuraOrganizativaRemotaSql } from '../paquetes/federacion/adaptadores/RepositorioEstructuraOrganizativaRemotaSql.js';
import { RepositorioFlujosFederacionSql } from '../paquetes/federacion/adaptadores/RepositorioFlujosFederacionSql.js';
import { RepositorioOcurrenciasFederacionSql } from '../paquetes/federacion/adaptadores/RepositorioOcurrenciasFederacionSql.js';
import { RepositorioOutboxFederacionSql } from '../paquetes/federacion/adaptadores/RepositorioOutboxFederacionSql.js';
import { ServicioCorteInicialGeneracionFederacion } from '../paquetes/federacion/aplicacion/ServicioCorteInicialGeneracionFederacion.js';
import {
  GeneradorIdentidadesFederadas,
  RegistroAdaptadoresFamiliasFederacion,
  TIPOS_IDENTIDAD_FEDERADA
} from '../paquetes/federacion/src/index.js';
import {
  crearSolicitudCapturaFederacion,
  OPERACIONES_CAPTURA_FEDERACION
} from '../paquetes/federacion/src/OperacionesCapturaTecnicaFederacion.js';
import {
  DENYLIST_TABLAS_SCOPE_ORGANIZATIVO,
  resolverDisposicionFisicaScopeOrganizativo
} from '../paquetes/jerarquia-organizativa/src/CatalogoScopeOrganizativo.js';
import { RepositorioMovimientosOrganizativos } from '../paquetes/jerarquia-organizativa/src/RepositorioMovimientosOrganizativos.js';
import { ClienteSql } from '../paquetes/persistencia-sql/src/ClienteSql.js';
import { EjecutorMigraciones } from '../paquetes/persistencia-sql/src/EjecutorMigraciones.js';
import { RepositorioMigraciones } from '../paquetes/persistencia-sql/src/RepositorioMigraciones.js';
import {
  obtenerConfiguracionAplicacion,
  obtenerRutaMigraciones
} from '../paquetes/utilidades/src/configuracion/obtenerConfiguracionAplicacion.js';

const USUARIO_FIXTURE = 5_221_503;
const INSTANTE = new Date('2031-02-03T04:05:06.789Z');
const generador = new GeneradorIdentidadesFederadas({
  fuenteEntropia: new FuenteEntropiaCriptograficaNode()
});

await main();

async function main() {
  await verificarRegistro();
  const configuracion = obtenerConfiguracionAplicacion();
  assert.equal(configuracion.sql.estaCompleta, true);
  const baseDatos = `sentinelia_fixture_52215c_${randomBytes(6).toString('hex')}`;
  const administrador = new ClienteSql(configuracion.sql);
  let sql;
  try {
    await administrador.ejecutar(
      `CREATE DATABASE ${administrador.escaparIdentificador(baseDatos)} ` +
      'CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci'
    );
    sql = new ClienteSql({ ...configuracion.sql, baseDatos });
    await migrar(sql);
    await verificarCapturaOrganizativa(sql);
  } finally {
    await sql?.cerrar().catch(() => {});
    await administrador.ejecutar(
      `DROP DATABASE IF EXISTS ${administrador.escaparIdentificador(baseDatos)}`
    ).catch(() => {});
    await administrador.cerrar();
  }
  console.log(
    '[federacion] OK 5.22.15c: identidad=permanente fotografia=coherente ' +
    'captura=misma_transaccion cascada=hojas_antes_raiz rollback=atomico ' +
    'historico=protegido adaptador=productivo_no_compuesto'
  );
}

async function verificarRegistro() {
  const catalogo = await leer(
    '../paquetes/jerarquia-organizativa/src/CatalogoScopeOrganizativo.js'
  );
  assert.match(catalogo, /identidades_estructura_organizativa_federacion/u);
}

async function verificarCapturaOrganizativa(sql) {
  const ids = crearIds();
  const locales = await crearOrganizacionLocal(sql);
  await crearRelacion(sql, ids);
  const repositorioFlujos = new RepositorioFlujosFederacionSql(sql, {
    installationLocalId: ids.installationLocalId
  });
  const repositorioOcurrencias = new RepositorioOcurrenciasFederacionSql(sql, {
    installationLocalId: ids.installationLocalId
  });
  const capturaGenerica = new AdaptadorCapturaTransaccionalFederacionSql({
    repositorioOcurrencias,
    repositorioOutbox: new RepositorioOutboxFederacionSql(sql)
  });
  const repositorioLocal = new RepositorioEstructuraOrganizativaLocalSql(sql, {
    installationLocalId: ids.installationLocalId,
    generadorIdentidades: generador,
    ahora: () => INSTANTE
  });
  assert.throws(
    () => crearDefinicionAdaptadorEstructuraOrganizativaFederacion({
      repositorio: new RepositorioEstructuraOrganizativaRemotaSql(sql),
      repositorioLocal: {}
    }),
    /productor local completo/u
  );
  const adaptador = new AdaptadorEstructuraOrganizativaFederacionSql({
    repositorio: new RepositorioEstructuraOrganizativaRemotaSql(sql),
    repositorioLocal
  });
  const definicion = crearDefinicionAdaptadorEstructuraOrganizativaFederacion({
    repositorio: new RepositorioEstructuraOrganizativaRemotaSql(sql),
    repositorioLocal
  });
  const registro = new RegistroAdaptadoresFamiliasFederacion({
    adaptadores: [definicion]
  });
  assert.equal(registro.obtenerProductivo({
    familia: 'estructuraOrganizativa', versionFamilia: 1
  }).completo, true);

  const corte = new ServicioCorteInicialGeneracionFederacion({
    clienteSql: sql,
    repositorioFlujos,
    repositorioOcurrencias,
    adaptadorCaptura: capturaGenerica,
    fuenteFotografia: adaptador
  });
  await corte.preparar({
    flujo: {
      flujoId: ids.flujoId,
      relacionId: ids.relacionId,
      direccion: 'emision',
      familia: 'estructuraOrganizativa',
      versionFamilia: 1,
      contexto: {
        nivel: 'tenant', tenantId: String(locales.tenantId),
        empresaId: null, sitioId: null
      }
    },
    generacion: {
      generacionId: ids.generacionId,
      clase: 'inicial',
      fronteraInicial: '0',
      propietario: {
        installationId: ids.installationLocalId,
        bootId: ids.bootLocalId,
        version: 1
      }
    }
  });
  const cierre = await corte.cerrar({
    flujoId: ids.flujoId,
    generacionId: ids.generacionId
  });
  assert.equal(cierre.totalFotografia, '3');

  let ocurrencias = await cargarOcurrencias(sql);
  assert.deepEqual(ocurrencias.map((fila) => fila.operacion), [
    'actualizacion', 'actualizacion', 'actualizacion'
  ]);
  const payloads = ocurrencias.map(payloadOcurrencia);
  assert.deepEqual(payloads.map((payload) => payload.tipo), [
    'tenant', 'empresa', 'sitio'
  ]);
  assert.equal(payloads[1].linaje[0].visibilidad, 'seleccionada');
  assert.deepEqual(
    payloads[2].linaje.map((entrada) => entrada.visibilidad),
    ['seleccionada', 'seleccionada']
  );
  assert.equal('cif' in payloads[1], false);

  const [identidadesIniciales] = await sql.consultar(
    `SELECT COUNT(*) AS total,COUNT(DISTINCT elemento_origen_id) AS unicas
       FROM identidades_estructura_organizativa_federacion`
  );
  assert.deepEqual(
    [Number(identidadesIniciales.total), Number(identidadesIniciales.unicas)],
    [3, 3]
  );
  const empresaElemento = await elementoDe(sql, 'empresa', locales.empresaId);

  await ejecutarTransaccion(sql, async (conexion) => {
    await conexion.execute(
      `UPDATE empresas SET nombre='Empresa federada renombrada' WHERE id=?`,
      [locales.empresaId]
    );
    const captura = await adaptador.prepararCapturaEnTransaccion({
      entidad: 'empresa', id: locales.empresaId,
      ancestrosSeleccionados: [{ tipo: 'tenant', id: locales.tenantId }]
    }, { conexion });
    assert.equal(captura.elementoOrigenId, empresaElemento);
    assert.equal(captura.prioridad, 'operativaActual');
    await capturaGenerica.capturarEnTransaccion({
      definicion: captura.definicion,
      destinos: [destino(ids, captura.prioridad)]
    }, { conexion });
  });
  ocurrencias = await cargarOcurrencias(sql);
  assert.equal(ocurrencias.length, 4);
  assert.equal(payloadOcurrencia(ocurrencias[3]).nombre, 'Empresa federada renombrada');

  await assert.rejects(
    ejecutarTransaccion(sql, async (conexion) => {
      await conexion.execute(
        `UPDATE empresas SET alias='rollback-federado' WHERE id=?`,
        [locales.empresaId]
      );
      const captura = await adaptador.prepararCapturaEnTransaccion({
        entidad: 'empresa', id: locales.empresaId
      }, { conexion });
      await capturaGenerica.capturarEnTransaccion({
        definicion: captura.definicion,
        destinos: [destino(ids, captura.prioridad)]
      }, { conexion });
      throw new Error('forzar rollback conjunto');
    }),
    /forzar rollback conjunto/u
  );
  assert.equal((await cargarOcurrencias(sql)).length, 4);
  const [empresaTrasRollback] = await sql.consultar(
    'SELECT alias FROM empresas WHERE id=?', [locales.empresaId]
  );
  assert.equal(empresaTrasRollback.alias, 'empresa-federada');

  await assert.rejects(
    ejecutarTransaccion(sql, async (conexion) => {
      const [tenantDestino] = await conexion.execute(
        `INSERT INTO tenants (nombre,alias,descripcion,estado,configuracion)
          VALUES ('Tenant destino','tenant-destino',NULL,'activo',NULL)`
      );
      await new RepositorioMovimientosOrganizativos().moverEmpresaEnTransaccion({
        idEmpresa: locales.empresaId,
        tenantOrigenId: locales.tenantId,
        tenantDestinoId: String(tenantDestino.insertId),
        nombre: 'Empresa federada renombrada',
        alias: 'empresa-federada',
        cif: 'B12345678',
        descripcion: null,
        estado: 'activo',
        autorizar: () => true
      }, { conexion });
      const capturas = await adaptador.prepararCapturasMovimientoEnTransaccion({
        entidad: 'empresa', id: locales.empresaId
      }, { conexion });
      assert.deepEqual(capturas.map((captura) => captura.tipo), ['empresa', 'sitio']);
      assert.equal(capturas[0].payload.linaje[0].visibilidad, 'opaca');
      assert.deepEqual(
        capturas[1].payload.linaje.map((entrada) => entrada.visibilidad),
        ['opaca', 'seleccionada']
      );
      assert.ok(capturas.every((captura) => captura.prioridad === 'operativaActual'));
      throw new Error('forzar rollback movimiento');
    }),
    /forzar rollback movimiento/u
  );
  const [empresaTrasMovimiento] = await sql.consultar(
    'SELECT tenant_id FROM empresas WHERE id=?', [locales.empresaId]
  );
  assert.equal(String(empresaTrasMovimiento.tenant_id), locales.tenantId);

  await assert.rejects(
    ejecutarTransaccion(sql, async (conexion) => {
      const capturas = await adaptador.prepararCapturaEnTransaccion(
        crearSolicitudCapturaFederacion(
          OPERACIONES_CAPTURA_FEDERACION.ESTRUCTURA_RETIRADA,
          { entidad: 'tenant', id: locales.tenantId }
        ),
        { conexion }
      );
      assert.deepEqual(
        capturas.map((entrada) => entrada.tipo),
        ['sitio', 'empresa', 'tenant']
      );
      assert.ok(capturas.every(
        (entrada) => entrada.definicion?.operacion === 'retirada'
      ));
      throw new Error('forzar rollback retirada tecnica');
    }),
    /forzar rollback retirada tecnica/u
  );

  await ejecutarTransaccion(sql, async (conexion) => {
    const retirada = await adaptador.prepararRetiradaEnTransaccion({
      entidad: 'tenant', id: locales.tenantId
    }, { conexion });
    assert.deepEqual(
      retirada.retiradas.map((entrada) => entrada.tipo),
      ['sitio', 'empresa', 'tenant']
    );
    for (const entrada of retirada.retiradas) {
      await capturaGenerica.capturarEnTransaccion({
        definicion: entrada.definicion,
        destinos: [destino(ids, entrada.prioridad)]
      }, { conexion });
    }
    await conexion.execute('DELETE FROM tenants WHERE id=?', [locales.tenantId]);
  });

  ocurrencias = await cargarOcurrencias(sql);
  assert.equal(ocurrencias.length, 7);
  assert.deepEqual(
    ocurrencias.slice(-3).map((fila) => fila.operacion),
    ['retirada', 'retirada', 'retirada']
  );
  assert.deepEqual(
    ocurrencias.slice(-3).map((fila) => Object.keys(JSON.parse(fila.payload_canonico).campos)),
    [[], [], []]
  );
  const [retiradas] = await sql.consultar(
    `SELECT COUNT(*) AS total FROM identidades_estructura_organizativa_federacion
      WHERE estado='retirado'`
  );
  assert.equal(Number(retiradas.total), 3);
  const [localesRestantes] = await sql.consultar(
    `SELECT (SELECT COUNT(*) FROM tenants) AS tenants,
            (SELECT COUNT(*) FROM empresas) AS empresas,
            (SELECT COUNT(*) FROM sitios) AS sitios`
  );
  assert.deepEqual(
    [Number(localesRestantes.tenants), Number(localesRestantes.empresas),
      Number(localesRestantes.sitios)],
    [0, 0, 0]
  );
  assert.equal(await elementoDe(sql, 'empresa', locales.empresaId), empresaElemento);
  await assert.rejects(
    sql.ejecutar(
      `DELETE FROM identidades_estructura_organizativa_federacion
        WHERE tipo_nodo='empresa' AND id_local=?`,
      [locales.empresaId]
    ),
    (error) => error.sqlState === '45000'
  );
  const [outbox] = await sql.consultar('SELECT COUNT(*) AS total FROM outbox_federacion');
  assert.equal(Number(outbox.total), 7);
  assert.deepEqual(
    resolverDisposicionFisicaScopeOrganizativo(
      'identidades_estructura_organizativa_federacion'
    ),
    {
      tabla: 'identidades_estructura_organizativa_federacion',
      columnasScope: ['scope_tenant_id', 'scope_empresa_id', 'scope_sitio_id'],
      clasificacion: 'persistencia_protegida',
      disposicion: 'fuera_cascada'
    }
  );
  assert.ok(DENYLIST_TABLAS_SCOPE_ORGANIZATIVO.includes(
    'identidades_estructura_organizativa_federacion'
  ));
}

function destino(ids, prioridad) {
  return {
    flujoId: ids.flujoId,
    generacionId: ids.generacionId,
    prioridad,
    clasePosicion: 'cambioPosterior'
  };
}

async function crearOrganizacionLocal(sql) {
  const [tenant] = await sql.ejecutar(
    `INSERT INTO tenants (nombre,alias,descripcion,estado,configuracion)
      VALUES ('Tenant federado','tenant-federado',NULL,'activo',NULL)`
  );
  const [empresa] = await sql.ejecutar(
    `INSERT INTO empresas
      (tenant_id,nombre,alias,cif,descripcion,estado,configuracion)
      VALUES (?,'Empresa federada','empresa-federada','B12345678',NULL,'activo',NULL)`,
    [tenant.insertId]
  );
  const [sitio] = await sql.ejecutar(
    `INSERT INTO sitios
      (tenant_id,empresa_id,nombre,alias,timezone,descripcion,estado,configuracion)
      VALUES (?,?,'Sitio federado','sitio-federado','Europe/Madrid',NULL,'activo',NULL)`,
    [tenant.insertId, empresa.insertId]
  );
  return {
    tenantId: String(tenant.insertId),
    empresaId: String(empresa.insertId),
    sitioId: String(sitio.insertId)
  };
}

async function crearRelacion(sql, ids) {
  const ahora = new Date();
  await sql.ejecutar(
    `INSERT INTO relaciones_federacion (
       relacion_id,direccion,estado_ciclo,estado_autoridad,estado_identidad,
       estado_compatibilidad,installation_remota_candidata_id,
       installation_remota_id,nombre_remoto_declarado,responsable_usuario_id,
       responsable_original_usuario_id,scope_tenant_id,scope_empresa_id,
       scope_sitio_id,version_autoridad,corte_autoridad_utc,
       creada_por_usuario_id,creada_en_utc,actualizada_en_utc,revision
     ) VALUES (
       ?,'emision','vinculada','autorizada','valida','compatible',?,?,?,
       ?,?,NULL,NULL,NULL,1,NULL,?,?,?,1
     )`,
    [
      ids.relacionId, ids.installationRemotaId, ids.installationRemotaId,
      'instancia remota 15c', USUARIO_FIXTURE, USUARIO_FIXTURE,
      USUARIO_FIXTURE, ahora, ahora
    ]
  );
}

async function cargarOcurrencias(sql) {
  return sql.consultar(
    `SELECT operacion,secuencia_elemento,elemento_origen_id,payload_canonico
       FROM ocurrencias_federacion ORDER BY id`
  );
}

function payloadOcurrencia(fila) {
  const campos = JSON.parse(fila.payload_canonico).campos;
  return campos.nodoOrganizativo.valor;
}

async function elementoDe(sql, tipo, idLocal) {
  const [fila] = await sql.consultar(
    `SELECT elemento_origen_id
       FROM identidades_estructura_organizativa_federacion
      WHERE tipo_nodo=? AND id_local=?`,
    [tipo, idLocal]
  );
  return fila?.elemento_origen_id ?? null;
}

async function ejecutarTransaccion(sql, callback) {
  const conexion = await sql.obtenerConexion();
  try {
    await conexion.beginTransaction();
    const resultado = await callback(conexion);
    await conexion.commit();
    return resultado;
  } catch (error) {
    await conexion.rollback().catch(() => {});
    throw error;
  } finally {
    conexion.release();
  }
}

function crearIds() {
  return Object.freeze({
    installationLocalId: id(TIPOS_IDENTIDAD_FEDERADA.INSTALACION),
    installationRemotaId: id(TIPOS_IDENTIDAD_FEDERADA.INSTALACION),
    bootLocalId: id(TIPOS_IDENTIDAD_FEDERADA.ARRANQUE),
    relacionId: id(TIPOS_IDENTIDAD_FEDERADA.RELACION),
    flujoId: id(TIPOS_IDENTIDAD_FEDERADA.FLUJO),
    generacionId: id(TIPOS_IDENTIDAD_FEDERADA.GENERACION)
  });
}

function id(tipo) {
  return String(generador.generar(tipo));
}

async function migrar(sql) {
  await new EjecutorMigraciones({
    clienteSql: sql,
    repositorioMigraciones: new RepositorioMigraciones(sql),
    rutaMigraciones: obtenerRutaMigraciones()
  }).ejecutarPendientes();
}

function leer(ruta) {
  return readFile(new URL(ruta, import.meta.url), 'utf8');
}

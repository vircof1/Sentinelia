import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';

import {
  crearDefinicionAdaptadorContextoOperativoAgentesSesionesFederacion
} from '../paquetes/federacion/adaptadores/AdaptadorContextoOperativoAgentesSesionesFederacionSql.js';
import { FuenteEntropiaCriptograficaNode } from '../paquetes/federacion/adaptadores/FuenteEntropiaCriptograficaNode.js';
import { RepositorioContextoOperativoAgentesSesionesLocalSql } from '../paquetes/federacion/adaptadores/RepositorioContextoOperativoAgentesSesionesLocalSql.js';
import { RepositorioContextoOperativoAgentesSesionesRemotoSql } from '../paquetes/federacion/adaptadores/RepositorioContextoOperativoAgentesSesionesRemotoSql.js';
import {
  GeneradorIdentidadesFederadas,
  TIPOS_IDENTIDAD_FEDERADA,
  validarPayloadContextoOperativoAgentesSesionesFederacion
} from '../paquetes/federacion/src/index.js';
import { resolverDisposicionFisicaScopeOrganizativo } from '../paquetes/jerarquia-organizativa/src/CatalogoScopeOrganizativo.js';
import { ClienteSql } from '../paquetes/persistencia-sql/src/ClienteSql.js';
import { EjecutorMigraciones } from '../paquetes/persistencia-sql/src/EjecutorMigraciones.js';
import { RepositorioMigraciones } from '../paquetes/persistencia-sql/src/RepositorioMigraciones.js';
import {
  obtenerConfiguracionAplicacion,
  obtenerRutaMigraciones
} from '../paquetes/utilidades/src/configuracion/obtenerConfiguracionAplicacion.js';

const generador = new GeneradorIdentidadesFederadas({
  fuenteEntropia: new FuenteEntropiaCriptograficaNode()
});
const INSTANTE = new Date('2031-03-04T05:06:07.890Z');

await main();

async function main() {
  await verificarContratoEstatico();
  const configuracion = obtenerConfiguracionAplicacion();
  assert.equal(configuracion.sql.estaCompleta, true);
  const baseDatos = `sentinelia_fixture_52215d_${randomBytes(6).toString('hex')}`;
  const administrador = new ClienteSql(configuracion.sql);
  let sql;
  try {
    await administrador.ejecutar(
      `CREATE DATABASE ${administrador.escaparIdentificador(baseDatos)} ` +
      'CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci'
    );
    sql = new ClienteSql({ ...configuracion.sql, baseDatos });
    await new EjecutorMigraciones({
      clienteSql: sql,
      repositorioMigraciones: new RepositorioMigraciones(sql),
      rutaMigraciones: obtenerRutaMigraciones()
    }).ejecutarPendientes();
    await verificarVerticalLocal(sql);
  } finally {
    await sql?.cerrar().catch(() => {});
    await administrador.ejecutar(
      `DROP DATABASE IF EXISTS ${administrador.escaparIdentificador(baseDatos)}`
    ).catch(() => {});
    await administrador.cerrar();
  }
  console.log(
    '[federacion] OK 5.22.15d: contexto=allowlist_sql pol=durable ' +
    'sesion=sin_identidad_ni_secreto fotografia=scope retirada=protegida adaptador=productivo_no_compuesto'
  );
}

async function verificarContratoEstatico() {
  assert.deepEqual(
    resolverDisposicionFisicaScopeOrganizativo(
      'identidades_contexto_operativo_agentes_federacion'
    ),
    {
      tabla: 'identidades_contexto_operativo_agentes_federacion',
      columnasScope: ['scope_tenant_id', 'scope_empresa_id', 'scope_sitio_id'],
      clasificacion: 'persistencia_protegida',
      disposicion: 'fuera_cascada'
    }
  );
}

async function verificarVerticalLocal(sql) {
  const ids = await crearDatos(sql);
  const repositorioLocal = new RepositorioContextoOperativoAgentesSesionesLocalSql(sql, {
    installationLocalId: id(TIPOS_IDENTIDAD_FEDERADA.INSTALACION),
    generadorIdentidades: generador,
    ahora: () => INSTANTE
  });
  const definicion = crearDefinicionAdaptadorContextoOperativoAgentesSesionesFederacion({
    repositorio: new RepositorioContextoOperativoAgentesSesionesRemotoSql(sql),
    repositorioLocal
  });
  assert.equal(definicion.productivo, true);
  assert.deepEqual(Object.keys(definicion.interfaces).sort(), [
    'captura', 'fotografiaInicial', 'materializacion', 'payload', 'retirada'
  ]);

  const captura = await transaccion(sql, (conexion) =>
    repositorioLocal.prepararCapturaEnTransaccion({ agenteId: ids.agenteId }, { conexion })
  );
  assert.equal(captura.prioridad, 'operativaActual');
  assert.equal(captura.payload.estadoPol.estado, 'abierto');
  assert.equal(captura.payload.periodos.length, 2);
  assert.equal(captura.payload.periodos[0].motivoCierre, 'refresh');
  assert.equal(captura.payload.periodos[1].finUtc, null);
  const serializado = JSON.stringify(captura.payload);
  for (const prohibido of [
    'secreto', 'sesionAuditoriaId', 'sesionId', 'huella', 'token', 'requestId',
    'fencing', 'lease', 'replay', 'estadoAdministrativo', 'estadoAcceso',
    'contadorLoginFallidos', 'ultimoLogin'
  ]) {
    assert.equal(serializado.toLowerCase().includes(prohibido.toLowerCase()), false, prohibido);
  }
  assert.throws(
    () => validarPayloadContextoOperativoAgentesSesionesFederacion({
      ...captura.payload,
      secretoHash: 'prohibido'
    }),
    (error) => error.codigo === 'forma_contexto_agente_invalida'
  );

  await crearFlujoFotografia(sql, ids);
  const fotografia = await transaccion(sql, (conexion) =>
    repositorioLocal.listarCapturasEnTransaccion({
      flujoId: ids.flujoId,
      generacionId: ids.generacionId
    }, { conexion })
  );
  assert.equal(fotografia.length, 1);
  assert.equal(fotografia[0].prioridad, 'reconstruccion');
  assert.equal(
    fotografia[0].payload.scopeOrganizativo.sitioElementoOrigenId,
    ids.sitioElementoOrigenId
  );

  const elementoOrigenId = captura.elementoOrigenId;
  await transaccion(sql, async (conexion) => {
    const retirada = await repositorioLocal.prepararRetiradaEnTransaccion(
      { agenteId: ids.agenteId }, { conexion }
    );
    assert.deepEqual(Object.keys(retirada.definicion.campos), []);
    assert.equal(retirada.elementoOrigenId, elementoOrigenId);
    await conexion.execute('DELETE FROM tenants WHERE id=?', [ids.tenantId]);
  });
  const [identidad] = await sql.consultar(
    `SELECT elemento_origen_id,estado FROM identidades_contexto_operativo_agentes_federacion
      WHERE agente_id_local=?`,
    [ids.agenteId]
  );
  assert.deepEqual([identidad.elemento_origen_id, identidad.estado], [elementoOrigenId, 'retirado']);
  await assert.rejects(
    sql.ejecutar(
      'DELETE FROM identidades_contexto_operativo_agentes_federacion WHERE agente_id_local=?',
      [ids.agenteId]
    ),
    (error) => error.sqlState === '45000'
  );
}

async function crearDatos(sql) {
  const [tenant] = await sql.ejecutar("INSERT INTO tenants (nombre,alias) VALUES ('Tenant agente','tenant-agente')");
  const [empresa] = await sql.ejecutar(
    "INSERT INTO empresas (tenant_id,nombre,alias) VALUES (?,'Empresa agente','empresa-agente')",
    [tenant.insertId]
  );
  const [sitio] = await sql.ejecutar(
    "INSERT INTO sitios (tenant_id,empresa_id,nombre,alias) VALUES (?,?,'Sitio agente','sitio-agente')",
    [tenant.insertId, empresa.insertId]
  );
  const org = {
    tenant: id(TIPOS_IDENTIDAD_FEDERADA.ELEMENTO_ORIGEN),
    empresa: id(TIPOS_IDENTIDAD_FEDERADA.ELEMENTO_ORIGEN),
    sitio: id(TIPOS_IDENTIDAD_FEDERADA.ELEMENTO_ORIGEN)
  };
  const ahoraSql = '2031-03-04 05:00:00.000';
  for (const [tipo, local, nombre, empresaScope, sitioScope] of [
    ['tenant', tenant.insertId, 'Tenant agente', null, null],
    ['empresa', empresa.insertId, 'Empresa agente', empresa.insertId, null],
    ['sitio', sitio.insertId, 'Sitio agente', empresa.insertId, sitio.insertId]
  ]) {
    await sql.ejecutar(
      `INSERT INTO identidades_estructura_organizativa_federacion (
         tipo_nodo,id_local,elemento_origen_id,estado,nombre_ultimo,
         scope_tenant_id,scope_empresa_id,scope_sitio_id,
         creada_en_utc,actualizada_en_utc,retirada_en_utc,version_registro
       ) VALUES (?,?,?,'vigente',?,?,?,?,?,?,NULL,1)`,
      [tipo, local, org[tipo], nombre, tenant.insertId, empresaScope, sitioScope, ahoraSql, ahoraSql]
    );
  }
  const [agente] = await sql.ejecutar(
    `INSERT INTO agentes_sentinelia (
       guid,tenant_id,empresa_id,sitio_id,nombre,descripcion,secreto_hash,
       ultimo_heartbeat_utc,ultimo_boot_id,ultima_version_agente,ultimo_hostname,ultimo_seq
     ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
    [randomUUID(), tenant.insertId, empresa.insertId, sitio.insertId, 'Agente federable',
      'Contexto operativo', 'hash-que-no-debe-viajar', '2031-03-04 05:05:00',
      'boot-operativo-2', '2.0.0-beta', 'host-no-federado', 22]
  );
  await sql.ejecutar(
    `INSERT INTO periodos_vida_pol_agentes (
       agente_id,boot_id,inicio_utc,fin_utc,ultimo_heartbeat_utc,ultimo_seq,motivo_cierre
     ) VALUES
       (?,'boot-operativo-1','2031-03-04 04:00:00','2031-03-04 04:30:00','2031-03-04 04:29:00',10,'refresh'),
       (?,'boot-operativo-2','2031-03-04 05:00:00',NULL,'2031-03-04 05:05:00',22,NULL)`,
    [agente.insertId, agente.insertId]
  );
  return {
    tenantId: String(tenant.insertId), empresaId: String(empresa.insertId),
    sitioId: String(sitio.insertId), agenteId: String(agente.insertId),
    sitioElementoOrigenId: org.sitio,
    flujoId: id(TIPOS_IDENTIDAD_FEDERADA.FLUJO),
    generacionId: id(TIPOS_IDENTIDAD_FEDERADA.GENERACION),
    relacionId: id(TIPOS_IDENTIDAD_FEDERADA.RELACION),
    installationRemotaId: id(TIPOS_IDENTIDAD_FEDERADA.INSTALACION),
    installationPropietariaId: id(TIPOS_IDENTIDAD_FEDERADA.INSTALACION),
    bootPropietarioId: id(TIPOS_IDENTIDAD_FEDERADA.ARRANQUE)
  };
}

async function crearFlujoFotografia(sql, ids) {
  const ahora = new Date();
  await sql.ejecutar(
    `INSERT INTO relaciones_federacion (
       relacion_id,direccion,estado_ciclo,estado_autoridad,estado_identidad,
       estado_compatibilidad,installation_remota_candidata_id,installation_remota_id,
       nombre_remoto_declarado,responsable_usuario_id,responsable_original_usuario_id,
       scope_tenant_id,scope_empresa_id,scope_sitio_id,version_autoridad,
       creada_por_usuario_id,creada_en_utc,actualizada_en_utc,revision
     ) VALUES (?,'emision','vinculada','autorizada','valida','compatible',?,?,?,1,1,?,?,?,1,1,?,?,1)`,
    [ids.relacionId, ids.installationRemotaId, ids.installationRemotaId, 'remota 15d',
      ids.tenantId, ids.empresaId, ids.sitioId, ahora, ahora]
  );
  await sql.ejecutar(
    `INSERT INTO flujos_federacion (
       flujo_id,relacion_id,direccion,familia,version_familia,estado,
       scope_nivel,scope_tenant_id,scope_empresa_id,scope_sitio_id,
       creada_en_utc,actualizada_en_utc
     ) VALUES (?,?,'emision','contextoOperativoAgentesSesiones',1,'sinSincronizar','sitio',?,?,?,?,?)`,
    [ids.flujoId, ids.relacionId, ids.tenantId, ids.empresaId, ids.sitioId, ahora, ahora]
  );
  await sql.ejecutar(
    `INSERT INTO generaciones_flujos_federacion (
       generacion_id,flujo_id,ordinal,clase,estado,installation_propietaria_id,
       boot_propietario_id,version_propietario,creada_en_utc,actualizada_en_utc
     ) VALUES (?,?,1,'inicial','preparada',?,?,1,?,?)`,
    [ids.generacionId, ids.flujoId, ids.installationPropietariaId,
      ids.bootPropietarioId, ahora, ahora]
  );
}

async function transaccion(sql, callback) {
  const conexion = await sql.obtenerConexion();
  try {
    await conexion.beginTransaction();
    const resultado = await callback(conexion);
    await conexion.commit();
    return resultado;
  } catch (error) {
    await conexion.rollback().catch(() => {});
    throw error;
  } finally { conexion.release(); }
}

function id(tipo) { return String(generador.generar(tipo)); }

import assert from 'node:assert/strict';
import { createHash, randomBytes } from 'node:crypto';

import {
  AdaptadorEstructuraOrganizativaFederacionSql,
  crearDefinicionAdaptadorEstructuraOrganizativaFederacion
} from '../paquetes/federacion/adaptadores/AdaptadorEstructuraOrganizativaFederacionSql.js';
import { FuenteEntropiaCriptograficaNode } from '../paquetes/federacion/adaptadores/FuenteEntropiaCriptograficaNode.js';
import { RepositorioEstructuraOrganizativaRemotaSql } from '../paquetes/federacion/adaptadores/RepositorioEstructuraOrganizativaRemotaSql.js';
import { RepositorioEstadoProyeccionesFederacionSql } from '../paquetes/federacion/adaptadores/RepositorioEstadoProyeccionesFederacionSql.js';
import { RepositorioFlujosFederacionSql } from '../paquetes/federacion/adaptadores/RepositorioFlujosFederacionSql.js';
import { RepositorioInboxFederacionSql } from '../paquetes/federacion/adaptadores/RepositorioInboxFederacionSql.js';
import { RepositorioMaterializacionFederacionSql } from '../paquetes/federacion/adaptadores/RepositorioMaterializacionFederacionSql.js';
import { canonicalizarJsonFederacion } from '../paquetes/federacion/src/CanonicalizadorFederacion.js';
import { crearCampoPresenteFederado } from '../paquetes/federacion/src/EnvolventeFederacion.js';
import {
  GeneradorIdentidadesFederadas,
  TIPOS_IDENTIDAD_FEDERADA
} from '../paquetes/federacion/src/IdentidadFederada.js';
import {
  PERFIL_PAYLOAD_ESTRUCTURA_ORGANIZATIVA_FEDERACION,
  validarPayloadEstructuraOrganizativaFederacion
} from '../paquetes/federacion/src/PayloadEstructuraOrganizativaFederacion.js';
import { ClienteSql } from '../paquetes/persistencia-sql/src/ClienteSql.js';
import { EjecutorMigraciones } from '../paquetes/persistencia-sql/src/EjecutorMigraciones.js';
import { RepositorioMigraciones } from '../paquetes/persistencia-sql/src/RepositorioMigraciones.js';
import {
  obtenerConfiguracionAplicacion,
  obtenerRutaMigraciones
} from '../paquetes/utilidades/src/configuracion/obtenerConfiguracionAplicacion.js';

const USUARIO_FIXTURE = 5_221_502;
const PROPIETARIO = 'worker-organizacion-15b';
const generador = new GeneradorIdentidadesFederadas({
  fuenteEntropia: new FuenteEntropiaCriptograficaNode()
});

await main();

async function main() {
  verificarPayloadTipado();
  const configuracion = obtenerConfiguracionAplicacion();
  assert.equal(configuracion.sql.estaCompleta, true);
  const baseDatos = `sentinelia_fixture_52215b_${randomBytes(6).toString('hex')}`;
  const administrador = new ClienteSql(configuracion.sql);
  let sql;
  try {
    await administrador.ejecutar(
      `CREATE DATABASE ${administrador.escaparIdentificador(baseDatos)} ` +
      'CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci'
    );
    sql = new ClienteSql({ ...configuracion.sql, baseDatos });
    await migrar(sql);
    await verificarProyeccionVersionada(sql);
  } finally {
    await sql?.cerrar().catch(() => {});
    await administrador.ejecutar(
      `DROP DATABASE IF EXISTS ${administrador.escaparIdentificador(baseDatos)}`
    ).catch(() => {});
    await administrador.cerrar();
  }
  console.log(
    '[federacion] OK 5.22.15b: organizacion=remota_separada ' +
    'linaje=interpretable opacos=preservados publicacion=frontera_atomica ' +
    'retirada=no_visible familias_productivas=0'
  );
}

function verificarPayloadTipado() {
  const ids = {
    tenantOrigenId: id(TIPOS_IDENTIDAD_FEDERADA.ELEMENTO_ORIGEN)
  };
  const empresa = payloadEmpresa(ids, 'Empresa Remota');
  const normalizado = validarPayloadEstructuraOrganizativaFederacion(
    empresa,
    { operacion: 'actualizacion' }
  );
  assert.equal(normalizado.tipo, 'empresa');
  assert.equal(normalizado.linaje[0].visibilidad, 'opaca');
  assert.equal(Object.isFrozen(normalizado), true);
  assert.throws(
    () => validarPayloadEstructuraOrganizativaFederacion(
      { ...empresa, cif: 'NO-DEBE-VIAJAR' },
      { operacion: 'actualizacion' }
    ),
    (error) => error.codigo === 'forma_payload_organizativo_invalida'
  );
  assert.throws(
    () => validarPayloadEstructuraOrganizativaFederacion(
      { ...empresa, linaje: [] },
      { operacion: 'actualizacion' }
    ),
    (error) => error.codigo === 'profundidad_linaje_invalida'
  );
  assert.throws(
    () => validarPayloadEstructuraOrganizativaFederacion(
      empresa,
      { operacion: 'retirada' }
    ),
    (error) => error.codigo === 'operacion_organizativa_invalida'
  );
}

async function verificarProyeccionVersionada(sql) {
  const ids = crearIds();
  await crearRelacion(sql, ids);
  await new RepositorioFlujosFederacionSql(sql, {
    installationLocalId: ids.installationLocalId
  }).crearFlujoInicial({
    flujo: {
      flujoId: ids.flujoId,
      relacionId: ids.relacionId,
      direccion: 'recepcion',
      familia: 'estructuraOrganizativa',
      versionFamilia: 1,
      contexto: {
        nivel: 'empresa', tenantId: '10', empresaId: '20', sitioId: null
      }
    },
    generacion: {
      generacionId: ids.generacionId,
      clase: 'inicial',
      fronteraInicial: '0',
      propietario: {
        installationId: ids.installationRemotaId,
        bootId: ids.bootRemotoId,
        version: 1
      }
    }
  });
  const estadoProyecciones = new RepositorioEstadoProyeccionesFederacionSql(sql);
  const registroTrabajos = new RepositorioMaterializacionFederacionSql(sql, {
    generarProyeccionId: () => ids.proyeccionId,
    repositorioEstadoProyecciones: estadoProyecciones
  });
  const cicloTrabajos = new RepositorioMaterializacionFederacionSql(sql);
  const inbox = new RepositorioInboxFederacionSql(sql);
  const repositorioRemoto = new RepositorioEstructuraOrganizativaRemotaSql(sql);
  const adaptador = new AdaptadorEstructuraOrganizativaFederacionSql({
    repositorio: repositorioRemoto
  });
  const definicion = crearDefinicionAdaptadorEstructuraOrganizativaFederacion({
    repositorio: repositorioRemoto
  });
  assert.equal(definicion.productivo, false);
  assert.deepEqual(Object.keys(definicion.interfaces), ['payload', 'materializacion']);

  const inicial = payloadEmpresa(ids, 'Empresa Remota');
  const trabajo1 = await recibirYReclamar({
    sql, inbox, registroTrabajos, cicloTrabajos, ids,
    secuencia: 1,
    operacion: 'actualizacion',
    payload: inicial
  });
  const primera = await materializar({ sql, adaptador, trabajo: trabajo1, payload: inicial });
  assert.equal(primera.estado, 'materializada');
  const replay = await materializar({ sql, adaptador, trabajo: trabajo1, payload: inicial });
  assert.equal(replay.yaMaterializada, true);
  assert.deepEqual(await repositorioRemoto.listarActuales(), []);
  await cicloTrabajos.completar(contextoCierre(trabajo1));
  await publicarHasta(sql, ids.proyeccionId, ids.generacionId, '1');

  let actuales = await repositorioRemoto.listarActuales({
    installationOrigenId: ids.installationRemotaId,
    tipo: 'empresa'
  });
  assert.equal(actuales.length, 1);
  assert.equal(actuales[0].nombre, 'Empresa Remota');
  assert.equal(actuales[0].scopeRecepcion.nivel, 'empresa');
  assert.deepEqual(actuales[0].linaje, [{
    tipo: 'tenant',
    elementoOrigenId: ids.tenantOrigenId,
    nombre: 'Tenant opaco',
    visibilidad: 'opaca'
  }]);

  const renombrada = payloadEmpresa(ids, 'Empresa Remota Renombrada');
  const trabajo2 = await recibirYReclamar({
    sql, inbox, registroTrabajos, cicloTrabajos, ids,
    secuencia: 2,
    operacion: 'actualizacion',
    payload: renombrada
  });
  await materializar({ sql, adaptador, trabajo: trabajo2, payload: renombrada });
  assert.equal((await repositorioRemoto.listarActuales())[0].nombre, 'Empresa Remota');
  await cicloTrabajos.completar(contextoCierre(trabajo2));
  await publicarHasta(sql, ids.proyeccionId, ids.generacionId, '2');
  actuales = await repositorioRemoto.listarActuales();
  assert.equal(actuales[0].nombre, 'Empresa Remota Renombrada');
  assert.equal(actuales[0].secuenciaElemento, '2');

  const trabajo3 = await recibirYReclamar({
    sql, inbox, registroTrabajos, cicloTrabajos, ids,
    secuencia: 3,
    operacion: 'retirada',
    payload: null
  });
  await materializar({
    sql,
    adaptador,
    trabajo: trabajo3,
    operacion: 'retirada',
    payload: null
  });
  assert.equal((await repositorioRemoto.listarActuales())[0].nombre, 'Empresa Remota Renombrada');
  await cicloTrabajos.completar(contextoCierre(trabajo3));
  await publicarHasta(sql, ids.proyeccionId, ids.generacionId, '3');
  assert.deepEqual(await repositorioRemoto.listarActuales(), []);
  const [tombstone] = await sql.consultar(
    `SELECT tipo_nodo,estado_registro
       FROM versiones_nodos_organizativos_remotos
      WHERE proyeccion_id=? AND generacion_id=? AND secuencia_elemento=3`,
    [ids.proyeccionId, ids.generacionId]
  );
  assert.deepEqual(
    [tombstone.tipo_nodo, tombstone.estado_registro],
    ['empresa', 'retirado']
  );
  await despublicar(sql, ids.proyeccionId, ids.generacionId);
  assert.deepEqual(await repositorioRemoto.listarActuales(), []);

  const [conteos] = await sql.consultar(
    `SELECT
       (SELECT COUNT(*) FROM tenants) AS tenants_locales,
       (SELECT COUNT(*) FROM empresas) AS empresas_locales,
       (SELECT COUNT(*) FROM sitios) AS sitios_locales,
       (SELECT COUNT(*) FROM versiones_nodos_organizativos_remotos) AS versiones,
       (SELECT COUNT(*) FROM linaje_versiones_nodos_organizativos_remotos) AS linajes`
  );
  assert.deepEqual([
    Number(conteos.tenants_locales),
    Number(conteos.empresas_locales),
    Number(conteos.sitios_locales),
    Number(conteos.versiones),
    Number(conteos.linajes)
  ], [0, 0, 0, 3, 2]);
  await assert.rejects(
    sql.ejecutar(
      `UPDATE versiones_nodos_organizativos_remotos
          SET nombre='reescritura' WHERE proyeccion_id=? AND secuencia_elemento=1`,
      [ids.proyeccionId]
    ),
    (error) => error.sqlState === '45000'
  );
}

async function recibirYReclamar({
  sql, inbox, registroTrabajos, cicloTrabajos, ids, secuencia, operacion, payload
}) {
  const ocurrencia = crearOcurrencia(ids, secuencia, operacion, payload);
  const conexion = await sql.obtenerConexion();
  try {
    await conexion.beginTransaction();
    const recibida = await inbox.recibirEnTransaccion(ocurrencia, { conexion });
    const entregaId = ids.entregas[secuencia - 1];
    const canonico = canonicalizarJsonFederacion(ocurrencia);
    const ahora = await ahoraSql(conexion);
    await conexion.execute(
      `INSERT INTO entregas_recepcion_federacion (
         entrega_id,relacion_id,flujo_id,generacion_id,posicion_flujo,
         ocurrencia_canonica,ocurrencia_sha256,creada_en_utc
       ) VALUES (?,?,?,?,?,?,?,?)`,
      [
        entregaId, ids.relacionId, ids.flujoId, ids.generacionId,
        String(secuencia), canonico,
        createHash('sha256').update(canonico, 'utf8').digest(), ahora
      ]
    );
    await registroTrabajos.registrarTrabajoEnTransaccion({
      lote: {
        relacionId: ids.relacionId,
        flujoId: ids.flujoId,
        generacionId: ids.generacionId
      },
      entrega: {
        entregaId,
        posicionFlujo: String(secuencia),
        ocurrencia
      },
      inboxId: recibida.inboxId
    }, { conexion });
    await conexion.commit();
  } catch (error) {
    await conexion.rollback().catch(() => {});
    throw error;
  } finally {
    conexion.release();
  }
  const [trabajo] = await cicloTrabajos.reclamarPendientes({
    propietario: PROPIETARIO,
    limite: 1,
    leaseMs: 60_000
  });
  assert.ok(trabajo);
  assert.equal(trabajo.entregaId, ids.entregas[secuencia - 1]);
  return trabajo;
}

async function materializar({
  sql,
  adaptador,
  trabajo,
  payload,
  operacion = 'actualizacion'
}) {
  const conexion = await sql.obtenerConexion();
  try {
    await conexion.beginTransaction();
    const resultado = await adaptador.materializarEnTransaccion({
      operacion,
      payload,
      contexto: {
        entregaId: trabajo.entregaId,
        propietario: trabajo.propietario,
        fencingToken: trabajo.fencingToken
      }
    }, { conexion });
    await conexion.commit();
    return resultado;
  } catch (error) {
    await conexion.rollback().catch(() => {});
    throw error;
  } finally {
    conexion.release();
  }
}

async function publicarHasta(sql, proyeccionId, generacionId, secuencia) {
  const conexion = await sql.obtenerConexion();
  try {
    await conexion.beginTransaction();
    const [versiones] = await conexion.execute(
      `SELECT estado_publicacion FROM versiones_proyecciones_federacion
        WHERE proyeccion_id=? AND generacion_id=? FOR UPDATE`,
      [proyeccionId, generacionId]
    );
    const primera = versiones[0].estado_publicacion === 'preparando';
    await conexion.execute(
      `UPDATE versiones_proyecciones_federacion
          SET estado_publicacion='actual',estado_materializacion='materializada',
              completitud_interpretable='completa',completitud_observable='completa',
              completitud_reconstruible='parcial',estado_vigencia='vigente',
              estado_soporte='sostenida',estado_autorizacion='autorizada',
              estado_coherencia='coherente',cierre_operativo_validado=TRUE,
              recepcion_confirmada=TRUE,ultima_secuencia_evaluada=?,
              version_estado=version_estado+1,actualizada_en_utc=UTC_TIMESTAMP(3),
              publicada_en_utc=COALESCE(publicada_en_utc,UTC_TIMESTAMP(3)),
              finalizada_en_utc=NULL
        WHERE proyeccion_id=? AND generacion_id=?`,
      [secuencia, proyeccionId, generacionId]
    );
    const versionPublicacion = await avanzarContador(conexion, proyeccionId);
    if (primera) {
      await conexion.execute(
        `INSERT INTO estados_actuales_proyecciones_federacion (
           proyeccion_id,generacion_actual_id,version_publicacion,
           publicada_en_utc,actualizada_en_utc
         ) VALUES (?,?,?,UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))`,
        [proyeccionId, generacionId, versionPublicacion]
      );
    } else {
      await conexion.execute(
        `UPDATE estados_actuales_proyecciones_federacion
            SET version_publicacion=?,publicada_en_utc=UTC_TIMESTAMP(3),
                actualizada_en_utc=UTC_TIMESTAMP(3)
          WHERE proyeccion_id=? AND generacion_actual_id=?`,
        [versionPublicacion, proyeccionId, generacionId]
      );
    }
    await conexion.commit();
  } catch (error) {
    await conexion.rollback().catch(() => {});
    throw error;
  } finally {
    conexion.release();
  }
}

async function despublicar(sql, proyeccionId, generacionId) {
  const conexion = await sql.obtenerConexion();
  try {
    await conexion.beginTransaction();
    await conexion.execute(
      `DELETE FROM estados_actuales_proyecciones_federacion
        WHERE proyeccion_id=? AND generacion_actual_id=?`,
      [proyeccionId, generacionId]
    );
    await conexion.execute(
      `UPDATE versiones_proyecciones_federacion
          SET estado_publicacion='preparando',estado_vigencia='retirada',
              publicada_en_utc=NULL,finalizada_en_utc=NULL,
              ultima_secuencia_evaluada=3,version_estado=version_estado+1,
              actualizada_en_utc=UTC_TIMESTAMP(3)
        WHERE proyeccion_id=? AND generacion_id=?`,
      [proyeccionId, generacionId]
    );
    await avanzarContador(conexion, proyeccionId);
    await conexion.commit();
  } catch (error) {
    await conexion.rollback().catch(() => {});
    throw error;
  } finally {
    conexion.release();
  }
}

async function avanzarContador(conexion, proyeccionId) {
  await conexion.execute(
    `INSERT IGNORE INTO contadores_publicacion_proyecciones_federacion (
       proyeccion_id,ultima_version_publicacion,actualizada_en_utc
     ) VALUES (?,0,UTC_TIMESTAMP(3))`,
    [proyeccionId]
  );
  const [filas] = await conexion.execute(
    `SELECT ultima_version_publicacion
       FROM contadores_publicacion_proyecciones_federacion
      WHERE proyeccion_id=? FOR UPDATE`,
    [proyeccionId]
  );
  const anterior = String(filas[0].ultima_version_publicacion);
  const siguiente = (BigInt(anterior) + 1n).toString();
  await conexion.execute(
    `UPDATE contadores_publicacion_proyecciones_federacion
        SET ultima_version_publicacion=?,actualizada_en_utc=UTC_TIMESTAMP(3)
      WHERE proyeccion_id=? AND ultima_version_publicacion=?`,
    [siguiente, proyeccionId, anterior]
  );
  return siguiente;
}

function crearOcurrencia(ids, secuencia, operacion, payload) {
  return {
    familia: 'estructuraOrganizativa',
    familiaVersion: 1,
    installationOrigenId: ids.installationRemotaId,
    elementoOrigenId: ids.empresaOrigenId,
    ocurrenciaOrigenId: ids.ocurrencias[secuencia - 1],
    secuenciaElemento: String(secuencia),
    operacion,
    tiempoOrigenUtc: `2031-01-01T00:00:0${secuencia}.000Z`,
    scopeOrigenDeclarado: {
      nivel: 'empresa', tenantId: 'tenant-remoto',
      empresaId: 'empresa-remota', sitioId: null
    },
    vigenciaRestanteMs: null,
    campos: operacion === 'actualizacion'
      ? { nodoOrganizativo: crearCampoPresenteFederado({ valor: payload }) }
      : {},
    evidenciaIntegridad: []
  };
}

function payloadEmpresa(ids, nombre) {
  return {
    perfil: PERFIL_PAYLOAD_ESTRUCTURA_ORGANIZATIVA_FEDERACION,
    version: 1,
    tipo: 'empresa',
    nombre,
    alias: 'empresa-remota',
    estado: 'activo',
    descripcion: 'Nodo remoto de fixture',
    timezone: null,
    linaje: [{
      tipo: 'tenant',
      elementoOrigenId: ids.tenantOrigenId,
      nombre: 'Tenant opaco',
      visibilidad: 'opaca'
    }]
  };
}

function contextoCierre(trabajo) {
  return {
    entregaId: trabajo.entregaId,
    propietario: trabajo.propietario,
    fencingToken: trabajo.fencingToken
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
       ?,'recepcion','vinculada','autorizada','valida','compatible',?,?,?,
       ?,?,NULL,NULL,NULL,1,NULL,?,?,?,1
     )`,
    [
      ids.relacionId, ids.installationRemotaId, ids.installationRemotaId,
      'instancia remota 15b', USUARIO_FIXTURE, USUARIO_FIXTURE,
      USUARIO_FIXTURE, ahora, ahora
    ]
  );
}

function crearIds() {
  return Object.freeze({
    installationLocalId: id(TIPOS_IDENTIDAD_FEDERADA.INSTALACION),
    installationRemotaId: id(TIPOS_IDENTIDAD_FEDERADA.INSTALACION),
    bootRemotoId: id(TIPOS_IDENTIDAD_FEDERADA.ARRANQUE),
    relacionId: id(TIPOS_IDENTIDAD_FEDERADA.RELACION),
    flujoId: id(TIPOS_IDENTIDAD_FEDERADA.FLUJO),
    generacionId: id(TIPOS_IDENTIDAD_FEDERADA.GENERACION),
    proyeccionId: id(TIPOS_IDENTIDAD_FEDERADA.PROYECCION),
    tenantOrigenId: id(TIPOS_IDENTIDAD_FEDERADA.ELEMENTO_ORIGEN),
    empresaOrigenId: id(TIPOS_IDENTIDAD_FEDERADA.ELEMENTO_ORIGEN),
    ocurrencias: Array.from(
      { length: 3 },
      () => id(TIPOS_IDENTIDAD_FEDERADA.OCURRENCIA_ORIGEN)
    ),
    entregas: Array.from(
      { length: 3 },
      () => id(TIPOS_IDENTIDAD_FEDERADA.ENTREGA)
    )
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

async function ahoraSql(conexion) {
  const [filas] = await conexion.query('SELECT UTC_TIMESTAMP(3) AS ahora');
  return filas[0].ahora;
}

import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';

import { RepositorioCatalogoSenalesTelemetriaAgentes } from '../paquetes/agentes/src/RepositorioCatalogoSenalesTelemetriaAgentes.js';
import { RepositorioEstadoActualTelemetriaAgentes } from '../paquetes/agentes/src/RepositorioEstadoActualTelemetriaAgentes.js';
import { RepositorioObservacionesTelemetriaAgentes } from '../paquetes/agentes/src/RepositorioObservacionesTelemetriaAgentes.js';
import { ServicioIngestaTelemetriaAgentes } from '../paquetes/agentes/src/ServicioIngestaTelemetriaAgentes.js';
import {
  AdaptadorTelemetriaFederacion,
  crearDefinicionAdaptadorTelemetriaFederacion
} from '../paquetes/federacion/adaptadores/AdaptadorTelemetriaFederacion.js';
import { FuenteEntropiaCriptograficaNode } from '../paquetes/federacion/adaptadores/FuenteEntropiaCriptograficaNode.js';
import { RepositorioTelemetriaLocalSql } from '../paquetes/federacion/adaptadores/RepositorioTelemetriaLocalSql.js';
import {
  GeneradorIdentidadesFederadas,
  TIPOS_IDENTIDAD_FEDERADA
} from '../paquetes/federacion/src/index.js';
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
const INSTANTE = new Date('2031-05-06T07:08:09.123Z');

await main();

async function main() {
  await verificarContratoEstatico();
  const configuracion = obtenerConfiguracionAplicacion();
  assert.equal(configuracion.sql.estaCompleta, true);
  const baseDatos = `sentinelia_fixture_52215f_${randomBytes(6).toString('hex')}`;
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
    await verificarCapturaYFotografia(sql);
  } finally {
    await sql?.cerrar().catch(() => {});
    await administrador.ejecutar(
      `DROP DATABASE IF EXISTS ${administrador.escaparIdentificador(baseDatos)}`
    ).catch(() => {});
    await administrador.cerrar();
  }
  console.log(
    '[federacion] OK 5.22.15f: captura=transaccion_compartida ' +
    'fotografia=corte_coherente redis=postcommit familias=7_tipos_locales ' +
    'reglas=revision_vigente_explicita retirada=antes_del_borrado'
  );
}

async function verificarContratoEstatico() {
  const servicio = await leer('../paquetes/agentes/src/ServicioIngestaTelemetriaAgentes.js');
  assert.match(servicio, /capturarIngestaEnTransaccion/u);
  const capturaAntesCommit = servicio.indexOf(
    'await this.capturadorFederacionTelemetria.capturarIngestaEnTransaccion'
  );
  const commitPosterior = servicio.indexOf('await conexion.commit()', capturaAntesCommit);
  assert.ok(
    capturaAntesCommit >= 0 && commitPosterior > capturaAntesCommit,
    'La captura debe suceder antes del commit.'
  );
  assert.ok(
    servicio.indexOf('await conexion.commit()') <
      servicio.indexOf('publicarAvisoEvaluacionSinAfectarIngesta'),
    'Las publicaciones efímeras deben suceder después del commit.'
  );
}

async function verificarCapturaYFotografia(sql) {
  const ids = await crearDatosBase(sql);
  const repositorioLocal = new RepositorioTelemetriaLocalSql(sql, {
    installationLocalId: ids.installationLocalId,
    generadorIdentidades: generador,
    ahora: () => INSTANTE
  });
  const adaptador = new AdaptadorTelemetriaFederacion({ repositorioLocal });
  const definicion = crearDefinicionAdaptadorTelemetriaFederacion({ repositorioLocal });
  assert.equal(definicion.productivo, false);
  assert.deepEqual(Object.keys(definicion.interfaces).sort(), [
    'captura', 'fotografiaInicial', 'payload', 'retirada'
  ]);
  const capturasIngesta = [];
  let publicacionPostcommit = false;
  const capturador = {
    async capturarIngestaEnTransaccion(solicitud, { conexion }) {
      const [estado] = await conexion.query('SELECT @@session.in_transaction AS activa');
      assert.equal(Boolean(estado[0].activa), true);
      capturasIngesta.push(...await adaptador.capturarIngestaEnTransaccion(
        solicitud,
        { conexion }
      ));
    }
  };
  const publicador = {
    async publicarFotografiasActualizadas() {
      const [{ total }] = await sql.consultar(
        'SELECT COUNT(*) AS total FROM observaciones_telemetria_agentes'
      );
      assert.equal(Number(total), 1, 'Redis solo debe observar datos ya confirmados.');
      publicacionPostcommit = true;
    }
  };
  const servicio = new ServicioIngestaTelemetriaAgentes({
    repositorioCatalogoSenales: new RepositorioCatalogoSenalesTelemetriaAgentes(sql),
    repositorioObservaciones: new RepositorioObservacionesTelemetriaAgentes(sql),
    repositorioEstadoActual: new RepositorioEstadoActualTelemetriaAgentes(sql),
    capturadorFederacionTelemetria: capturador,
    publicadorInvalidacionesMonitores: publicador,
    generarRequestId: () => 'req_telemetria_federada',
    reloj: () => INSTANTE
  });
  const resultado = await servicio.ingestarLote({
    agenteId: ids.agenteId,
    periodoVidaPolId: ids.periodoId,
    lote: {
      observaciones: [{
        categoria: 'sistema',
        clave: 'cpu',
        tag: 'total',
        tipoDato: 'numero',
        unidad: '%',
        valorNumero: 95.5,
        calidad: 'valida',
        severidadDeclarada: 'aviso',
        origen: 'directa',
        observadoEnUtc: '2031-05-06T07:08:00.000Z',
        vigenteHastaUtc: '2031-05-06T07:13:00.000Z',
        detalleHumano: 'CPU total',
        metadatos: { nucleo: 'todos' },
        definicionSenal: {
          categoria: 'sistema',
          clave: 'cpu',
          tag: 'total',
          tipoDato: 'numero',
          unidad: '%',
          nombreHumano: 'CPU',
          descripcion: 'Uso total de CPU.',
          metadatos: { escala: 100 }
        }
      }]
    },
    recibidoEnUtc: INSTANTE
  });
  assert.equal(resultado.persistencia.totalInsertadas, 1);
  assert.equal(publicacionPostcommit, true);
  assert.deepEqual(
    capturasIngesta.map(({ tipoRegistro }) => tipoRegistro),
    ['senal', 'observacion', 'fotografiaSenal', 'fotografiaPol']
  );
  assert.equal(capturasIngesta[2].payload.observacion.valor, 95.5);
  assert.equal(capturasIngesta[3].payload.estado, 'abierto');

  let redisTrasRollback = false;
  const servicioFallido = new ServicioIngestaTelemetriaAgentes({
    repositorioCatalogoSenales: new RepositorioCatalogoSenalesTelemetriaAgentes(sql),
    repositorioObservaciones: new RepositorioObservacionesTelemetriaAgentes(sql),
    repositorioEstadoActual: new RepositorioEstadoActualTelemetriaAgentes(sql),
    capturadorFederacionTelemetria: {
      async capturarIngestaEnTransaccion() {
        throw new Error('fallo_deliberado_captura');
      }
    },
    publicadorInvalidacionesMonitores: {
      async publicarFotografiasActualizadas() { redisTrasRollback = true; }
    },
    reloj: () => INSTANTE
  });
  await assert.rejects(
    servicioFallido.ingestarLote({
      agenteId: ids.agenteId,
      periodoVidaPolId: ids.periodoId,
      lote: {
        observaciones: [{
          categoria: 'sistema', clave: 'ram', tipoDato: 'numero', unidad: '%',
          valorNumero: 60, observadoEnUtc: '2031-05-06T07:08:01.000Z'
        }]
      },
      recibidoEnUtc: INSTANTE
    }),
    /fallo_deliberado_captura/u
  );
  const [{ observacionesTrasRollback }] = await sql.consultar(
    'SELECT COUNT(*) AS observacionesTrasRollback FROM observaciones_telemetria_agentes'
  );
  assert.equal(Number(observacionesTrasRollback), 1);
  assert.equal(redisTrasRollback, false);

  const [senal] = await sql.consultar(
    'SELECT id FROM senales_telemetria_agentes WHERE agente_id=? LIMIT 1', [ids.agenteId]
  );
  const [observacion] = await sql.consultar(
    'SELECT id FROM observaciones_telemetria_agentes WHERE agente_id=? LIMIT 1', [ids.agenteId]
  );
  const [fotografiaActual] = await sql.consultar(
    'SELECT id FROM estado_actual_telemetria_agentes WHERE agente_id=? LIMIT 1', [ids.agenteId]
  );
  const regla = await crearReglaYEvento(sql, { ...ids, senalId: senal.id, observacionId: observacion.id });
  await crearFlujoFotografia(sql, ids);
  const fotografia = await transaccion(sql, (conexion) =>
    repositorioLocal.listarCapturasEnTransaccion({
      flujoId: ids.flujoId,
      generacionId: ids.generacionId
    }, { conexion })
  );
  assert.deepEqual(fotografia.map(({ tipoRegistro }) => tipoRegistro), [
    'fuente', 'senal', 'observacion', 'fotografiaSenal',
    'fotografiaPol', 'fotografiaPol', 'reglaDerivacion', 'eventoDerivado'
  ]);
  const fotografiasPol = fotografia.filter(({ tipoRegistro }) => tipoRegistro === 'fotografiaPol');
  assert.deepEqual(
    fotografiasPol.map(({ payload }) => payload.estado),
    ['cerrado', 'abierto']
  );
  assert.notEqual(
    fotografiasPol[0].payload.periodoPolOrigenId,
    fotografiasPol[1].payload.periodoPolOrigenId
  );
  assert.equal(
    fotografiasPol[0].elementoOrigenId,
    fotografiasPol[1].elementoOrigenId,
    'Los períodos retenidos deben versionar una sola fotografía POL federada por agente.'
  );
  const reglaCapturada = fotografia.find(({ tipoRegistro }) => tipoRegistro === 'reglaDerivacion');
  assert.equal(reglaCapturada.payload.revisiones.length, 2);
  assert.equal(reglaCapturada.payload.revisionVigenteOrigenId, reglaCapturada.payload.revisiones[1].revisionOrigenId);
  assert.equal(reglaCapturada.payload.estadoActual.revisionOrigenId, reglaCapturada.payload.revisiones[0].revisionOrigenId);
  assert.equal(reglaCapturada.payload.estadoActual.resultado, 'coincide');
  assert.equal(
    fotografia.find(({ tipoRegistro }) => tipoRegistro === 'eventoDerivado').payload.evento,
    'coincide'
  );

  const capturaRegla = await transaccion(sql, (conexion) =>
    repositorioLocal.prepararCapturaEnTransaccion({
      tipoRegistro: 'reglaDerivacion', idLocal: regla.reglaId
    }, { conexion })
  );
  await transaccion(sql, async (conexion) => {
    const retirada = await repositorioLocal.prepararRetiradaEnTransaccion({
      tipoRegistro: 'reglaDerivacion', idLocal: regla.reglaId
    }, { conexion });
    assert.equal(retirada.elementoOrigenId, capturaRegla.elementoOrigenId);
    assert.deepEqual(Object.keys(retirada.definicion.campos), []);
    await conexion.execute('DELETE FROM reglas_derivacion_telemetria WHERE id=?', [regla.reglaId]);
  });
  const [identidadRetirada] = await sql.consultar(
    `SELECT estado FROM identidades_elementos_telemetria_federacion
      WHERE tipo_elemento='reglaDerivacion' AND clave_local=?`,
    [String(regla.reglaId)]
  );
  assert.equal(identidadRetirada.estado, 'retirado');

  await sql.ejecutar('DELETE FROM observaciones_telemetria_agentes WHERE id=?', [observacion.id]);
  await sql.ejecutar('DELETE FROM senales_telemetria_agentes WHERE id=?', [senal.id]);
  const fotografiaSinHistorico = await transaccion(sql, (conexion) =>
    repositorioLocal.prepararCapturaEnTransaccion({
      tipoRegistro: 'fotografiaSenal', idLocal: fotografiaActual.id
    }, { conexion })
  );
  assert.equal(fotografiaSinHistorico.payload.senalOrigenId, null);
  assert.equal(fotografiaSinHistorico.payload.observacionOrigenId, null);
  assert.equal(fotografiaSinHistorico.payload.secuenciaSenal, null);
  assert.equal(fotografiaSinHistorico.payload.observacion.valor, 95.5);
}

async function crearDatosBase(sql) {
  const [tenant] = await sql.ejecutar("INSERT INTO tenants (nombre,alias) VALUES ('Tenant 15f','tenant-15f')");
  const [empresa] = await sql.ejecutar(
    "INSERT INTO empresas (tenant_id,nombre,alias) VALUES (?,'Empresa 15f','empresa-15f')", [tenant.insertId]
  );
  const [sitio] = await sql.ejecutar(
    "INSERT INTO sitios (tenant_id,empresa_id,nombre,alias) VALUES (?,?,'Sitio 15f','sitio-15f')",
    [tenant.insertId, empresa.insertId]
  );
  const ahora = '2031-05-06 07:00:00.000';
  const org = {
    tenant: id(TIPOS_IDENTIDAD_FEDERADA.ELEMENTO_ORIGEN),
    empresa: id(TIPOS_IDENTIDAD_FEDERADA.ELEMENTO_ORIGEN),
    sitio: id(TIPOS_IDENTIDAD_FEDERADA.ELEMENTO_ORIGEN)
  };
  for (const [tipo, local, nombre, empresaScope, sitioScope] of [
    ['tenant', tenant.insertId, 'Tenant 15f', null, null],
    ['empresa', empresa.insertId, 'Empresa 15f', empresa.insertId, null],
    ['sitio', sitio.insertId, 'Sitio 15f', empresa.insertId, sitio.insertId]
  ]) {
    await sql.ejecutar(
      `INSERT INTO identidades_estructura_organizativa_federacion (
         tipo_nodo,id_local,elemento_origen_id,estado,nombre_ultimo,
         scope_tenant_id,scope_empresa_id,scope_sitio_id,
         creada_en_utc,actualizada_en_utc,retirada_en_utc,version_registro
       ) VALUES (?,?,?,'vigente',?,?,?,?,?,?,NULL,1)`,
      [tipo, local, org[tipo], nombre, tenant.insertId, empresaScope, sitioScope, ahora, ahora]
    );
  }
  const [agente] = await sql.ejecutar(
    `INSERT INTO agentes_sentinelia (
       guid,tenant_id,empresa_id,sitio_id,nombre,descripcion,secreto_hash,
       ultimo_heartbeat_utc,ultimo_boot_id,ultima_version_agente,ultimo_seq
     ) VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
    [randomUUID(), tenant.insertId, empresa.insertId, sitio.insertId, 'Agente 15f',
      'Origen de telemetría', 'secreto-no-federado', '2031-05-06 07:08:00',
      'boot-15f', '2.0.0-beta', 8]
  );
  const contextoId = id(TIPOS_IDENTIDAD_FEDERADA.ELEMENTO_ORIGEN);
  await sql.ejecutar(
    `INSERT INTO identidades_contexto_operativo_agentes_federacion (
       agente_id_local,elemento_origen_id,guid_ultimo,nombre_ultimo,
       scope_tenant_id,scope_empresa_id,scope_sitio_id,estado,
       creada_en_utc,actualizada_en_utc,retirada_en_utc,version_registro
     ) VALUES (?,?,?,?,?,?,?,'vigente',?,?,NULL,1)`,
    [agente.insertId, contextoId, randomUUID(), 'Agente 15f', tenant.insertId,
      empresa.insertId, sitio.insertId, ahora, ahora]
  );
  await sql.ejecutar(
    `INSERT INTO periodos_vida_pol_agentes (
       agente_id,boot_id,inicio_utc,fin_utc,ultimo_heartbeat_utc,ultimo_seq,motivo_cierre
     ) VALUES (?,'boot-15f-anterior','2031-05-06 06:00:00','2031-05-06 06:50:00',
       '2031-05-06 06:49:00',49,'reinicio')`,
    [agente.insertId]
  );
  const [periodo] = await sql.ejecutar(
    `INSERT INTO periodos_vida_pol_agentes (
       agente_id,boot_id,inicio_utc,ultimo_heartbeat_utc,ultimo_seq
     ) VALUES (?,'boot-15f','2031-05-06 07:00:00','2031-05-06 07:08:00',8)`,
    [agente.insertId]
  );
  return {
    tenantId: String(tenant.insertId),
    empresaId: String(empresa.insertId),
    sitioId: String(sitio.insertId),
    agenteId: String(agente.insertId),
    periodoId: String(periodo.insertId),
    installationLocalId: id(TIPOS_IDENTIDAD_FEDERADA.INSTALACION),
    installationRemotaId: id(TIPOS_IDENTIDAD_FEDERADA.INSTALACION),
    flujoId: id(TIPOS_IDENTIDAD_FEDERADA.FLUJO),
    generacionId: id(TIPOS_IDENTIDAD_FEDERADA.GENERACION),
    relacionId: id(TIPOS_IDENTIDAD_FEDERADA.RELACION),
    bootId: id(TIPOS_IDENTIDAD_FEDERADA.ARRANQUE)
  };
}

async function crearReglaYEvento(sql, ids) {
  const [regla] = await sql.ejecutar(
    `INSERT INTO reglas_derivacion_telemetria (
       agente_id,senal_id,tenant_id,empresa_id,sitio_id,estado
     ) VALUES (?,?,?,?,?,'activa')`,
    [ids.agenteId, ids.senalId, ids.tenantId, ids.empresaId, ids.sitioId]
  );
  const condicion = JSON.stringify({ tipo: 'numero', version: 1, configuracion: { operador: '>', umbral: 90 } });
  const [revision] = await sql.ejecutar(
    `INSERT INTO revisiones_reglas_derivacion_telemetria (
       regla_id,numero,condicion_tipo,condicion_version,condicion_canonica,
       severidad_calculada,mensaje_operativo,nombre,descripcion,
       metadatos_descriptivos,vigente_desde_utc
     ) VALUES (?,1,'numero',1,?,'critica','CPU elevada','CPU crítica',NULL,NULL,'2031-05-06 07:08:01')`,
    [regla.insertId, condicion]
  );
  await sql.ejecutar(
    'UPDATE reglas_derivacion_telemetria SET revision_vigente_id=? WHERE id=?',
    [revision.insertId, regla.insertId]
  );
  const evaluacion = [
    regla.insertId, revision.insertId, ids.observacionId, ids.agenteId, ids.senalId,
    ids.tenantId, ids.empresaId, ids.sitioId, 'coincide', 'umbral_superado',
    'El valor supera el umbral.', condicion, JSON.stringify(95.5), 'numero', '%',
    'valida', 'critica', 'CPU elevada', JSON.stringify({ umbral: 90 }),
    '2031-05-06 07:08:00', '2031-05-06 07:08:09', '2031-05-06 07:08:10'
  ];
  const columnas = `regla_id,regla_revision_id,observacion_id,agente_id,senal_id,
    tenant_id,empresa_id,sitio_id,resultado,codigo_motivo,explicacion,
    condicion_canonica,valor_evaluado,tipo_dato,unidad,calidad,severidad_calculada,
    mensaje_operativo,evidencia_contextual,observado_en_utc,recibido_en_utc,evaluado_en_utc`;
  const marcas = Array(22).fill('?').join(',');
  await sql.ejecutar(
    `INSERT INTO estado_actual_evaluacion_reglas_telemetria (${columnas}) VALUES (${marcas})`,
    evaluacion
  );
  await sql.ejecutar(
    `INSERT INTO eventos_derivados_telemetria (${columnas},creado_en_utc)
     VALUES (${marcas},'2031-05-06 07:08:11')`,
    evaluacion
  );
  await sql.ejecutar(
    `UPDATE revisiones_reglas_derivacion_telemetria
        SET vigente_hasta_utc='2031-05-06 07:08:12' WHERE id=?`,
    [revision.insertId]
  );
  const [revisionNueva] = await sql.ejecutar(
    `INSERT INTO revisiones_reglas_derivacion_telemetria (
       regla_id,numero,condicion_tipo,condicion_version,condicion_canonica,
       severidad_calculada,mensaje_operativo,nombre,descripcion,
       metadatos_descriptivos,vigente_desde_utc
     ) VALUES (?,2,'numero',1,?,'critica','CPU muy elevada','CPU muy crítica',NULL,NULL,'2031-05-06 07:08:12')`,
    [regla.insertId, JSON.stringify({
      tipo: 'numero', version: 1, configuracion: { operador: '>', umbral: 97 }
    })]
  );
  await sql.ejecutar(
    'UPDATE reglas_derivacion_telemetria SET revision_vigente_id=? WHERE id=?',
    [revisionNueva.insertId, regla.insertId]
  );
  return { reglaId: String(regla.insertId), revisionId: String(revisionNueva.insertId) };
}

async function crearFlujoFotografia(sql, ids) {
  const ahora = INSTANTE;
  await sql.ejecutar(
    `INSERT INTO relaciones_federacion (
       relacion_id,direccion,estado_ciclo,estado_autoridad,estado_identidad,
       estado_compatibilidad,installation_remota_candidata_id,installation_remota_id,
       nombre_remoto_declarado,responsable_usuario_id,responsable_original_usuario_id,
       scope_tenant_id,scope_empresa_id,scope_sitio_id,version_autoridad,
       creada_por_usuario_id,creada_en_utc,actualizada_en_utc,revision
     ) VALUES (?,'emision','vinculada','autorizada','valida','compatible',?,?,?,1,1,?,?,?,1,1,?,?,1)`,
    [ids.relacionId, ids.installationRemotaId, ids.installationRemotaId, 'remota 15f',
      ids.tenantId, ids.empresaId, ids.sitioId, ahora, ahora]
  );
  await sql.ejecutar(
    `INSERT INTO flujos_federacion (
       flujo_id,relacion_id,direccion,familia,version_familia,estado,
       scope_nivel,scope_tenant_id,scope_empresa_id,scope_sitio_id,
       creada_en_utc,actualizada_en_utc
     ) VALUES (?,?,'emision','telemetria',1,'sinSincronizar','sitio',?,?,?,?,?)`,
    [ids.flujoId, ids.relacionId, ids.tenantId, ids.empresaId, ids.sitioId, ahora, ahora]
  );
  await sql.ejecutar(
    `INSERT INTO generaciones_flujos_federacion (
       generacion_id,flujo_id,ordinal,clase,estado,installation_propietaria_id,
       boot_propietario_id,version_propietario,creada_en_utc,actualizada_en_utc
     ) VALUES (?,?,1,'inicial','preparada',?,?,1,?,?)`,
    [ids.generacionId, ids.flujoId, ids.installationLocalId, ids.bootId, ahora, ahora]
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
  } finally {
    conexion.release();
  }
}

function id(tipo) { return String(generador.generar(tipo)); }
function leer(ruta) { return readFile(new URL(ruta, import.meta.url), 'utf8'); }

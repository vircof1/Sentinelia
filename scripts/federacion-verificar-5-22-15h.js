import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { readFile } from 'node:fs/promises';

import {
  crearDefinicionAdaptadorMonitoresFederacion
} from '../paquetes/federacion/adaptadores/AdaptadorMonitoresFederacion.js';
import { FuenteEntropiaCriptograficaNode } from '../paquetes/federacion/adaptadores/FuenteEntropiaCriptograficaNode.js';
import {
  GeneradorIdentidadesFederadas,
  RegistroAdaptadoresFamiliasFederacion,
  TIPOS_IDENTIDAD_FEDERADA,
  TIPOS_REGISTRO_MONITORES_FEDERACION,
  validarPayloadMonitoresFederacion
} from '../paquetes/federacion/src/index.js';
import { resolverDisposicionFisicaScopeOrganizativo } from '../paquetes/jerarquia-organizativa/src/CatalogoScopeOrganizativo.js';
import { ClienteSql } from '../paquetes/persistencia-sql/src/ClienteSql.js';
import { EjecutorMigraciones } from '../paquetes/persistencia-sql/src/EjecutorMigraciones.js';
import { RepositorioMigraciones } from '../paquetes/persistencia-sql/src/RepositorioMigraciones.js';
import {
  obtenerConfiguracionAplicacion,
  obtenerRutaMigraciones
} from '../paquetes/utilidades/src/configuracion/obtenerConfiguracionAplicacion.js';

const FECHA = '2031-06-07T08:09:10.111Z';
const FECHA_POSTERIOR = '2031-06-07T08:10:10.111Z';
const ALERTA_AUDITORIA_ID = '018f2a3b-4c5d-7e6f-8a9b-0c1d2e3f4a5b';
const generador = new GeneradorIdentidadesFederadas({
  fuenteEntropia: new FuenteEntropiaCriptograficaNode()
});

await main();

async function main() {
  const ejemplos = verificarContratoTipado();
  await verificarRegistroEstatico();
  const configuracion = obtenerConfiguracionAplicacion();
  assert.equal(configuracion.sql.estaCompleta, true);
  const baseDatos = `sentinelia_fixture_52215h_${randomBytes(6).toString('hex')}`;
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
    await verificarEsquema(sql, ejemplos);
  } finally {
    await sql?.cerrar().catch(() => {});
    await administrador.ejecutar(
      `DROP DATABASE IF EXISTS ${administrador.escaparIdentificador(baseDatos)}`
    ).catch(() => {});
    await administrador.cerrar();
  }
  console.log(
    '[federacion] OK 5.22.15h: contrato=7_registros_tipados ' +
    'agregado=definicion_estado_evento_historico_alerta ' +
    'contexto=propiedad_origen triggers=referencias_opacas ' +
    'credencial=seleccion_sensible tablas=remotas_no_productivo'
  );
}

function verificarContratoTipado() {
  const ids = crearIds();
  const contextoHumano = {
    descripcionFallo: 'El servicio no responde.',
    posibleSolucion: 'Comprobar conectividad y proceso remoto.'
  };
  const ejemplos = [
    base('definicion', {
      nombre: 'TCP servicio de planta', tipo: 'tcp', descripcion: 'Comprueba el puerto.',
      activo: true, intervaloEjecucionSegundos: 60, desfaseInicialSegundos: 5,
      interpretacionEstado: 'normal',
      configuracionOperativa: { host: '10.0.0.10', puerto: 443, usarTls: true },
      contextoHumano,
      scopeOrganizativo: {
        tenantElementoOrigenId: ids.tenant,
        empresaElementoOrigenId: ids.empresa,
        sitioElementoOrigenId: null
      },
      credencialPropia: { estado: 'omitida', causa: 'noSeleccionada' },
      referenciasOperativas: [{
        familia: 'telemetria', elementoOrigenId: ids.senal,
        rol: 'entrada_principal', visibilidad: 'opaca',
        metadatos: { variable: 'A' }
      }]
    }),
    base('estadoActual', {
      monitorOrigenId: ids.monitor, versionCatalogo: 'v1', estado: 'indisponible',
      ejecutadoTodavia: true, fechaUltimaEjecucionUtc: FECHA,
      fechaUltimoCambioUtc: FECHA, motivoInicial: 'ejecutado',
      resultadoActual: { codigoResultado: 'conexion_rechazada', exitoTecnico: false },
      contextoHumano, vigenteHastaOrigenUtc: FECHA_POSTERIOR
    }),
    base('evento', {
      monitorOrigenId: ids.monitor, versionCatalogo: 'v1', tipoMonitor: 'tcp',
      estadoDetectado: 'indisponible', codigoResultado: 'conexion_rechazada',
      mensajeResultado: 'La conexión fue rechazada.', exito: false,
      duracionTotalMs: 28, ejecutadoEnUtc: FECHA,
      payloadEvento: { puerto: 443 }, contextoHumano
    }),
    base('tramoHistorico', {
      monitorOrigenId: ids.monitor, versionCatalogo: 'v1', tipoMonitor: 'tcp',
      estadoTramo: 'indisponible', codigoUltimoResultado: 'conexion_rechazada',
      mensajeUltimoResultado: 'La conexión fue rechazada.', validoDesdeUtc: FECHA,
      validoHastaUtc: FECHA_POSTERIOR, contadorRepeticiones: 2,
      ultimoEventoOrigenId: ids.evento, payloadTramo: { nombreMonitor: 'TCP servicio' },
      contextoHumano
    }),
    base('alerta', {
      monitorOrigenId: ids.monitor, alertaAuditoriaId: ALERTA_AUDITORIA_ID,
      versionCatalogo: 'v1', tipoMonitor: 'tcp', estadoAlerta: 'activa',
      estadoDetectado: 'indisponible', codigoUltimoResultado: 'conexion_rechazada',
      mensajeUltimoResultado: 'La conexión fue rechazada.', validoDesdeUtc: FECHA,
      ultimaConfirmacionUtc: FECHA, ultimaEjecucionUtc: FECHA, cerradaEnUtc: null,
      vigenteHastaOrigenUtc: FECHA_POSTERIOR, contadorRepeticiones: 2,
      payloadAlerta: { severidad: 'alta' },
      descarteOrigen: {
        descartada: false, motivo: '', descartadaEnUtc: null,
        descartadaHastaUtc: null, actorReferencia: { estado: 'omitida' }
      },
      contextoHumano
    }),
    base('referenciaTrigger', {
      monitorOrigenId: ids.monitor, triggerOrigenId: ids.trigger,
      visibilidad: 'opaca', activo: true, ordenEjecucion: 1,
      eventosDisparo: ['apertura_alerta', 'repeticion_alerta'],
      configuracionOverride: { destinatario: 'guardia' }
    }),
    base('rangoHistorico', {
      monitorOrigenId: ids.monitor,
      desdeUtc: '2031-05-01T00:00:00.000Z',
      hastaUtc: '2031-05-02T00:00:00.000Z',
      causa: 'retencionOrigen'
    })
  ];
  const normalizados = ejemplos.map((payload) => validarPayloadMonitoresFederacion(payload));
  assert.deepEqual(
    normalizados.map(({ tipoRegistro }) => tipoRegistro),
    TIPOS_REGISTRO_MONITORES_FEDERACION
  );
  assert.equal(normalizados[0].referenciasOperativas[0].visibilidad, 'opaca');
  assert.equal(normalizados[4].alertaAuditoriaId, ALERTA_AUDITORIA_ID);
  assert.throws(
    () => validarPayloadMonitoresFederacion({ ...ejemplos[0], cuentaUsuario: 'nadie' }),
    (error) => error.codigo === 'forma_payload_monitor_invalida'
  );
  assert.throws(
    () => validarPayloadMonitoresFederacion({
      ...ejemplos[0], configuracionOperativa: { host: '10.0.0.10', accessToken: 'secreto' }
    }),
    (error) => error.codigo === 'credencial_monitor_en_configuracion'
  );
  assert.throws(
    () => validarPayloadMonitoresFederacion({
      ...ejemplos[0], configuracionOperativa: { dependencias: [{ monitorId: 42 }] }
    }),
    (error) => error.codigo === 'identidad_local_monitor_en_configuracion'
  );
  const conCredencial = validarPayloadMonitoresFederacion({
    ...ejemplos[0],
    credencialPropia: {
      estado: 'presente', formato: 'basic-v1', contenido: { usuario: 'sonda', clave: 'cifrada' }
    }
  });
  assert.equal(conCredencial.credencialPropia.estado, 'presente');
  assert.throws(
    () => validarPayloadMonitoresFederacion({ ...ejemplos[1], vigenteHastaOrigenUtc: '2031-06-07T08:08:10.111Z' }),
    (error) => error.codigo === 'vigencia_estado_monitor_invalida'
  );
  assert.throws(
    () => validarPayloadMonitoresFederacion({ ...ejemplos[3], validoHastaUtc: '2031-06-07T08:08:10.111Z' }),
    (error) => error.codigo === 'tramo_historico_monitor_invalido'
  );
  assert.throws(
    () => validarPayloadMonitoresFederacion({ ...ejemplos[4], estadoAlerta: 'cerrada' }),
    (error) => error.codigo === 'cierre_alerta_monitor_invalido'
  );
  assert.throws(
    () => validarPayloadMonitoresFederacion(ejemplos[0], { operacion: 'retirada' }),
    (error) => error.codigo === 'operacion_monitor_invalida'
  );
  return normalizados;
}

async function verificarRegistroEstatico() {
  assert.deepEqual(
    resolverDisposicionFisicaScopeOrganizativo('identidades_elementos_monitores_federacion'),
    {
      tabla: 'identidades_elementos_monitores_federacion',
      columnasScope: ['scope_tenant_id', 'scope_empresa_id', 'scope_sitio_id'],
      clasificacion: 'persistencia_protegida',
      disposicion: 'fuera_cascada'
    }
  );
  const definicion = crearDefinicionAdaptadorMonitoresFederacion();
  const registro = new RegistroAdaptadoresFamiliasFederacion({ adaptadores: [definicion] });
  assert.deepEqual(Object.keys(definicion.interfaces), ['payload']);
  assert.equal(registro.obtenerEnConstruccion({ familia: 'monitores', versionFamilia: 1 }).completo, false);
  assert.throws(
    () => registro.obtenerProductivo({ familia: 'monitores', versionFamilia: 1 }),
    (error) => error.codigo === 'adaptador_familia_no_productivo'
  );
}

async function verificarEsquema(sql, ejemplos) {
  const tablas = await sql.consultar(
    `SELECT TABLE_NAME AS nombre FROM information_schema.TABLES
      WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME IN (
        'identidades_elementos_monitores_federacion','registros_monitores_remotos'
      ) ORDER BY TABLE_NAME`
  );
  assert.deepEqual(tablas.map(({ nombre }) => nombre), [
    'identidades_elementos_monitores_federacion', 'registros_monitores_remotos'
  ]);
  const columnas = await sql.consultar(
    `SELECT COLUMN_NAME AS nombre FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='registros_monitores_remotos'`
  );
  for (const requerida of [
    'tipo_registro', 'monitor_origen_id', 'referencia_origen_id',
    'alerta_auditoria_id', 'estado_operativo', 'tiempo_dato_utc',
    'vigente_hasta_origen_utc', 'representacion_canonica'
  ]) assert.ok(columnas.some(({ nombre }) => nombre === requerida), requerida);

  const identidad = id(TIPOS_IDENTIDAD_FEDERADA.ELEMENTO_ORIGEN);
  await sql.ejecutar(
    `INSERT INTO identidades_elementos_monitores_federacion (
       tipo_elemento,clave_local,monitor_id_local,elemento_origen_id,
       scope_tenant_id,scope_empresa_id,scope_sitio_id,estado,
       creada_en_utc,actualizada_en_utc,retirada_en_utc,version_registro
     ) VALUES ('definicion','42',42,?,1,2,NULL,'vigente',
       UTC_TIMESTAMP(3),UTC_TIMESTAMP(3),NULL,1)`,
    [identidad]
  );
  await sql.ejecutar(
    `UPDATE identidades_elementos_monitores_federacion
        SET estado='retirado',retirada_en_utc=UTC_TIMESTAMP(3),
            actualizada_en_utc=UTC_TIMESTAMP(3),version_registro=version_registro+1
      WHERE tipo_elemento='definicion' AND clave_local='42'`
  );
  await assert.rejects(
    sql.ejecutar(
      `UPDATE identidades_elementos_monitores_federacion
          SET estado='vigente',retirada_en_utc=NULL,
              actualizada_en_utc=UTC_TIMESTAMP(3),version_registro=version_registro+1
        WHERE tipo_elemento='definicion' AND clave_local='42'`
    ),
    (error) => error.sqlState === '45000'
  );
  await assert.rejects(
    sql.ejecutar(
      "DELETE FROM identidades_elementos_monitores_federacion WHERE tipo_elemento='definicion' AND clave_local='42'"
    ),
    (error) => error.sqlState === '45000'
  );
  const triggers = await sql.consultar(
    `SELECT TRIGGER_NAME AS nombre FROM information_schema.TRIGGERS
      WHERE TRIGGER_SCHEMA=DATABASE() AND TRIGGER_NAME IN (
        'trg_identidad_monitor_federado_inmutable',
        'trg_identidad_monitor_federado_protegida',
        'trg_registro_monitor_remoto_inmutable'
      ) ORDER BY TRIGGER_NAME`
  );
  assert.equal(triggers.length, 3);
  assert.equal(ejemplos.length, 7);
}

function crearIds() {
  const nombres = ['tenant', 'empresa', 'monitor', 'senal', 'evento', 'trigger'];
  return Object.fromEntries(nombres.map((nombre) => [
    nombre, id(TIPOS_IDENTIDAD_FEDERADA.ELEMENTO_ORIGEN)
  ]));
}

function base(tipoRegistro, contenido) {
  return {
    perfil: 'sentinelia-federacion-monitores-v1',
    version: 1,
    tipoRegistro,
    ...contenido
  };
}

function id(tipo) { return String(generador.generar(tipo)); }
function leer(ruta) { return readFile(new URL(ruta, import.meta.url), 'utf8'); }

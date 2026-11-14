import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';

import { RepositorioTriggersInformativosLocalSql }
  from '../paquetes/federacion/adaptadores/RepositorioTriggersInformativosLocalSql.js';
import {
  PERFIL_PAYLOAD_TRIGGERS_INFORMATIVOS_FEDERACION,
  VERSION_PAYLOAD_TRIGGERS_INFORMATIVOS_FEDERACION,
  validarPayloadTriggersInformativosFederacion
} from '../paquetes/federacion/src/PayloadTriggersInformativosFederacion.js';
import { TIPOS_IDENTIDAD_FEDERADA }
  from '../paquetes/federacion/src/IdentidadFederada.js';
import { ClienteSql } from '../paquetes/persistencia-sql/src/ClienteSql.js';
import { EjecutorMigraciones }
  from '../paquetes/persistencia-sql/src/EjecutorMigraciones.js';
import { RepositorioMigraciones }
  from '../paquetes/persistencia-sql/src/RepositorioMigraciones.js';
import {
  obtenerConfiguracionAplicacion,
  obtenerRutaMigraciones
} from '../paquetes/utilidades/src/configuracion/obtenerConfiguracionAplicacion.js';
import { prepararEntorno } from './correo-verificar-trigger-5-27-6c.js';
import { id } from './federacion-verificar-5-22-15g.js';

await main();

async function main() {
  assert.equal(VERSION_PAYLOAD_TRIGGERS_INFORMATIVOS_FEDERACION, 2);
  assert.throws(() => validarPayloadTriggersInformativosFederacion({
    perfil: 'sentinelia-federacion-triggers-informativos-v1',
    version: 1,
    tipoRegistro: 'definicion'
  }), (error) => error.codigo === 'version_payload_trigger_informativo_incompatible');
  const configuracion = obtenerConfiguracionAplicacion();
  assert.equal(configuracion.sql.estaCompleta, true, '5.27.12a necesita MariaDB real.');
  const administrador = new ClienteSql(configuracion.sql);
  const nombre = `sentinelia_fixture_52712a_${randomBytes(5).toString('hex')}`;
  let sql;
  try {
    await administrador.ejecutar(
      `CREATE DATABASE ${administrador.escaparIdentificador(nombre)} ` +
        'CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci'
    );
    sql = new ClienteSql({ ...configuracion.sql, baseDatos: nombre });
    const migraciones = await new EjecutorMigraciones({
      clienteSql: sql,
      repositorioMigraciones: new RepositorioMigraciones(sql),
      rutaMigraciones: obtenerRutaMigraciones()
    }).ejecutarPendientes();
    assert.equal(migraciones.integridad.ok, true);
    await verificarCapturas(sql);
    console.log(
      '[correo-trigger] OK 5.27.12a: familia=triggersInformativos@2 ' +
        'definicion_publica=solo_forma reusable=solo_sensible ' +
        'audiencia=ausente ejecucion=resultado_agregado ' +
        'payloads_fisicos=no_federables v1=rechazada'
    );
  } finally {
    await sql?.cerrar().catch(() => {});
    await administrador.ejecutar(
      `DROP DATABASE IF EXISTS ${administrador.escaparIdentificador(nombre)}`
    ).catch(() => {});
    await administrador.cerrar();
  }
}

async function verificarCapturas(sql) {
  const { salidaIds } = await prepararEntorno(sql, {
    claveIdempotencia: randomBytes(32).toString('hex'),
    prefijoMessageId: randomBytes(4).toString('hex')
  });
  const [ids] = await sql.consultar(`
    SELECT e.id ejecucion_id,e.trigger_id
      FROM cola_correos_salida c
      INNER JOIN ejecuciones_triggers e ON e.id=c.ejecucion_trigger_id
     WHERE c.id=?
  `, [salidaIds[0]]);
  await sql.ejecutar(`
    UPDATE triggers SET configuracion=JSON_OBJECT(
      'version',1,
      'asuntoPlantilla','Alerta secreta {{monitor}}',
      'textoIntroduccion','Introducción privada',
      'textoCierre','Cierre privado'
    ) WHERE id=?
  `, [ids.trigger_id]);
  await sql.ejecutar(`
    UPDATE ejecuciones_triggers
       SET estado_ejecucion='ok',
           codigo_resultado='correo_notificacion_aceptada_completa',
           mensaje_resultado='Notificación aceptada',
           payload_solicitud=JSON_OBJECT(
             'email','destinatario@example.test','cuerpo','muy privado'),
           payload_respuesta=JSON_OBJECT(
             'detalle_correo_estado','conservado',
             'totalResultadosDestinatarios',3,'totalSalidas',2,
             'email','destinatario@example.test'),
           payload_error=JSON_OBJECT('token','secreto'),
           finalizado_en_utc='2026-09-03 10:00:01.000'
     WHERE id=?
  `, [ids.ejecucion_id]);
  const repositorio = new RepositorioTriggersInformativosLocalSql(sql, {
    installationLocalId: id(TIPOS_IDENTIDAD_FEDERADA.INSTALACION),
    ahora: () => new Date('2026-09-03T10:00:02.000Z')
  });
  const conexion = await sql.obtenerConexion();
  try {
    await conexion.beginTransaction();
    const publica = await repositorio.prepararCapturaEnTransaccion({
      tipoRegistro: 'definicion', idLocal: ids.trigger_id
    }, { conexion });
    assert.equal(publica.definicion.familiaVersion, 2);
    assert.deepEqual(publica.payload.configuracionOperativa, {
      forma: {
        asuntoPlantilla: 'configurable',
        textoCierre: true,
        textoIntroduccion: true
      },
      version: 1
    });
    assert.equal(publica.payload.contenidoSensible.estado, 'omitido');
    assert.equal(publica.definicion.campos.triggersInformativos.sensibilidad,
      'ordinario');
    assertSinPrivados(publica);

    const completa = await repositorio.prepararCapturaEnTransaccion({
      tipoRegistro: 'definicion',
      idLocal: ids.trigger_id,
      incluirContenidoSensible: true,
      puedeFederarContenidoSensible: true
    }, { conexion });
    assert.deepEqual(completa.payload.contenidoSensible.contenido, {
      definicionMensaje: {
        asuntoPlantilla: 'Alerta secreta {{monitor}}',
        textoCierre: 'Cierre privado',
        textoIntroduccion: 'Introducción privada',
        version: 1
      }
    });
    assert.equal(completa.definicion.campos.triggersInformativos.sensibilidad,
      'sensible');
    assert.doesNotMatch(JSON.stringify(completa.payload),
      /destinatarios|audiencia|example\.test|tokenHash|cuerpoBase/u);

    const ejecucion = await repositorio.prepararCapturaEnTransaccion({
      tipoRegistro: 'ejecucionTerminada',
      idLocal: ids.ejecucion_id,
      incluirContenidoSensible: true,
      puedeFederarContenidoSensible: true
    }, { conexion });
    assert.deepEqual(ejecucion.payload.resultadoCorreo, {
      detalleEstado: 'conservado',
      totalResultadosDestinatarios: 3,
      totalSalidas: 2
    });
    for (const campo of ['payloadSolicitud','payloadRespuesta','payloadError']) {
      assert.deepEqual(ejecucion.payload[campo], {
        estado: 'omitido', causa: 'noAutorizado'
      });
    }
    assertSinPrivados(ejecucion);
    await conexion.rollback();
  } catch (error) {
    await conexion.rollback().catch(() => {});
    throw error;
  } finally {
    conexion.release();
  }
}

function assertSinPrivados(captura) {
  const serializada = JSON.stringify(captura);
  assert.doesNotMatch(serializada,
    /Alerta secreta|Introducción privada|Cierre privado|destinatario@example\.test|muy privado|secreto/u);
}

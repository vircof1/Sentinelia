import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { readFile } from 'node:fs/promises';

import { AdaptadorTelemetriaFederacion } from '../paquetes/federacion/adaptadores/AdaptadorTelemetriaFederacion.js';
import { AdaptadorMonitoresFederacion } from '../paquetes/federacion/adaptadores/AdaptadorMonitoresFederacion.js';
import { RepositorioMonitoresRemotoSql } from '../paquetes/federacion/adaptadores/RepositorioMonitoresRemotoSql.js';
import { RepositorioPoliticasRetencionFederacionSql } from '../paquetes/federacion/adaptadores/RepositorioPoliticasRetencionFederacionSql.js';
import { RepositorioPurgaDatosFederadosSql } from '../paquetes/federacion/adaptadores/RepositorioPurgaDatosFederadosSql.js';
import { RepositorioTelemetriaRemotaSql } from '../paquetes/federacion/adaptadores/RepositorioTelemetriaRemotaSql.js';
import { GestorRetencionDatosFederados } from '../paquetes/federacion/aplicacion/GestorRetencionDatosFederados.js';
import { ServicioPoliticasRetencionFederacion } from '../paquetes/federacion/aplicacion/ServicioPoliticasRetencionFederacion.js';
import { TIPOS_IDENTIDAD_FEDERADA } from '../paquetes/federacion/src/IdentidadFederada.js';
import { PERFIL_PAYLOAD_TELEMETRIA_FEDERACION } from '../paquetes/federacion/src/PayloadTelemetriaFederacion.js';
import { ClienteSql } from '../paquetes/persistencia-sql/src/ClienteSql.js';
import { obtenerConfiguracionAplicacion } from '../paquetes/utilidades/src/configuracion/obtenerConfiguracionAplicacion.js';
import { generarUuidV7Auditoria } from '../paquetes/auditoria/src/UuidV7Auditoria.js';
import { crearElemento, id, migrar } from './federacion-verificar-5-22-15g.js';

await main();

async function main() {
  await verificarRegistroDocumental();
  await verificarPlanificacionAcotada();
  const configuracion = obtenerConfiguracionAplicacion();
  assert.equal(configuracion.sql.estaCompleta, true);
  const baseDatos = `sentinelia_fixture_52217b_${randomBytes(6).toString('hex')}`;
  const administrador = new ClienteSql(configuracion.sql);
  let sql;
  try {
    await administrador.ejecutar(
      `CREATE DATABASE ${administrador.escaparIdentificador(baseDatos)} CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`
    );
    sql = new ClienteSql({ ...configuracion.sql, baseDatos });
    await migrar(sql);
    await verificarProteccionesYPurga(sql);
  } finally {
    await sql?.cerrar().catch(() => {});
    await administrador.ejecutar(
      `DROP DATABASE IF EXISTS ${administrador.escaparIdentificador(baseDatos)}`
    ).catch(() => {});
    await administrador.cerrar();
  }
  console.log(
    '[federacion] OK 5.22.17b: purga=historico-por-familia ' +
    'reloj=sql activa=protegida frontera=protegida soporte=protegido minimo=conservado'
  );
}

async function verificarRegistroDocumental() {
  const runtime = await leer('../apps/sentinelia-runtime/src/RuntimeSentinelia.js');
  assert.match(runtime, /gestorRetencionDatosFederados\.ejecutarSiProcede/u);
}

async function verificarPlanificacionAcotada() {
  const llamadas = [];
  const gestor = new GestorRetencionDatosFederados({
    servicioPoliticas: {
      reconciliarLimiteGlobal: async () => ({
        resultados: [{ politica: {
          relacionId: 'relacion', familia: 'telemetria', version: '1'
        } }]
      })
    },
    repositorioPurga: {
      obtenerFechaSqlUtc: async () => '2026-08-08',
      purgarLote: async (entrada) => {
        llamadas.push(entrada);
        return {
          ...entrada,
          versionPolitica: '1',
          fechaCorteUtc: '2026-08-07T00:00:00.000Z',
          eliminados: llamadas.length === 1 ? 1 : 0,
          hayMas: llamadas.length === 1,
          motivo: null
        };
      }
    },
    limitePorFamilia: 1,
    intervaloComprobacionMs: 60_000,
    ahoraMs: () => 1
  });
  const primera = await gestor.ejecutarSiProcede({ forzar: true });
  assert.equal(primera.familiasConBacklog, 1);
  const segunda = await gestor.ejecutarSiProcede({ forzar: true });
  assert.equal(segunda.familiasConBacklog, 0);
  const tercera = await gestor.ejecutarSiProcede({ forzar: true });
  assert.equal(tercera.totalFamilias, 0);
  assert.equal(llamadas.length, 2);
}

async function verificarProteccionesYPurga(sql) {
  const casos = {
    activa: await crearObservacionAntigua(sql),
    frontera: await crearObservacionAntigua(sql),
    soporte: await crearObservacionAntigua(sql),
    alertaActiva: await crearAlertaAntigua(sql, 'activa'),
    alertaCerrada: await crearAlertaAntigua(sql, 'cerrada')
  };
  const repositorioPoliticas = new RepositorioPoliticasRetencionFederacionSql(sql);
  const servicioPoliticas = new ServicioPoliticasRetencionFederacion({
    repositorioPoliticas,
    servicioConfiguracionPortal: configuracionPortalFixture()
  });
  await servicioPoliticas.reconciliarLimiteGlobal();
  const repositorioPurga = new RepositorioPurgaDatosFederadosSql(sql);

  await cerrarGeneracion(sql, casos.activa, { desactivar: false, cerrarFrontera: true });
  await retirarSoporte(sql, casos.activa);
  assert.equal((await purgar(repositorioPurga, casos.activa)).eliminados, 0);

  await cerrarGeneracion(sql, casos.frontera, {
    desactivar: true,
    cerrarFrontera: false
  });
  await retirarSoporte(sql, casos.frontera);
  assert.equal((await purgar(repositorioPurga, casos.frontera)).eliminados, 0);

  await cerrarGeneracion(sql, casos.soporte, {
    desactivar: true,
    cerrarFrontera: true
  });
  assert.equal((await purgar(repositorioPurga, casos.soporte)).eliminados, 0);
  await retirarSoporte(sql, casos.soporte);
  assert.equal((await purgar(repositorioPurga, casos.soporte)).eliminados, 1);

  await cerrarFrontera(sql, casos.frontera);
  assert.equal((await purgar(repositorioPurga, casos.frontera)).eliminados, 1);

  for (const caso of [casos.alertaActiva, casos.alertaCerrada]) {
    await cerrarGeneracion(sql, caso, { desactivar: true, cerrarFrontera: true });
    await retirarSoporte(sql, caso);
  }
  assert.equal((await purgar(repositorioPurga, casos.alertaActiva)).eliminados, 0);
  assert.equal((await purgar(repositorioPurga, casos.alertaCerrada)).eliminados, 1);
  assert.equal(await contarRegistro(sql, casos.activa), 1);
  assert.equal(await contarRegistro(sql, casos.frontera), 0);
  assert.equal(await contarRegistro(sql, casos.soporte), 0);

  const [minimos] = await sql.consultar(
    `SELECT
       (SELECT COUNT(*) FROM politicas_retencion_recepciones_federacion) AS politicas,
       (SELECT COUNT(*) FROM inbox_ocurrencias_federacion) AS inbox,
       (SELECT COUNT(*) FROM trabajos_materializacion_federacion) AS trabajos,
       (SELECT COUNT(*) FROM proyecciones_federacion) AS proyecciones`
  );
  assert.equal(Number(minimos.politicas), 5);
  assert.equal(Number(minimos.inbox), 5);
  assert.equal(Number(minimos.trabajos), 5);
  assert.equal(Number(minimos.proyecciones), 5);
}

async function crearObservacionAntigua(sql) {
  const adaptador = new AdaptadorTelemetriaFederacion({
    repositorioRemoto: new RepositorioTelemetriaRemotaSql(sql)
  });
  const fuenteOrigenId = id(TIPOS_IDENTIDAD_FEDERADA.ELEMENTO_ORIGEN);
  const senalOrigenId = id(TIPOS_IDENTIDAD_FEDERADA.ELEMENTO_ORIGEN);
  const caso = await crearElemento({
    sql,
    adaptador,
    installationRemotaId: id(TIPOS_IDENTIDAD_FEDERADA.INSTALACION),
    elementoOrigenId: id(TIPOS_IDENTIDAD_FEDERADA.ELEMENTO_ORIGEN),
    payload: {
      perfil: PERFIL_PAYLOAD_TELEMETRIA_FEDERACION,
      version: 1,
      tipoRegistro: 'observacion',
      fuenteOrigenId,
      senalOrigenId,
      periodoPolOrigenId: null,
      categoria: 'sistema',
      clave: 'carga',
      tag: '',
      codigoSenal: 'sistema.carga',
      tipoDato: 'numero',
      unidad: '%',
      valor: 42,
      calidad: 'buena',
      severidadDeclarada: 'informativa',
      origen: 'agente',
      vigenteHastaUtc: '2020-01-01T00:05:00.000Z',
      detalleHumano: 'Observación histórica',
      metadatosContextuales: {},
      emitidoEnUtc: '2020-01-01T00:00:00.000Z',
      observadoEnUtc: '2020-01-01T00:00:00.000Z',
      recibidoEnUtc: '2020-01-01T00:00:01.000Z'
    }
  });
  return { ...caso, familia: 'telemetria' };
}

async function crearAlertaAntigua(sql, estadoAlerta) {
  const adaptador = new AdaptadorMonitoresFederacion({
    repositorioRemoto: new RepositorioMonitoresRemotoSql(sql)
  });
  const cerrada = estadoAlerta === 'cerrada';
  const caso = await crearElemento({
    sql,
    adaptador,
    installationRemotaId: id(TIPOS_IDENTIDAD_FEDERADA.INSTALACION),
    elementoOrigenId: id(TIPOS_IDENTIDAD_FEDERADA.ELEMENTO_ORIGEN),
    familia: 'monitores',
    payload: {
      perfil: 'sentinelia-federacion-monitores-v1',
      version: 1,
      tipoRegistro: 'alerta',
      monitorOrigenId: id(TIPOS_IDENTIDAD_FEDERADA.ELEMENTO_ORIGEN),
      alertaAuditoriaId: generarUuidV7Auditoria(new Date('2020-01-01T00:00:00.000Z')),
      versionCatalogo: 'v1',
      tipoMonitor: 'tcp',
      estadoAlerta,
      estadoDetectado: 'indisponible',
      codigoUltimoResultado: 'conexion_rechazada',
      mensajeUltimoResultado: 'La conexión fue rechazada.',
      validoDesdeUtc: '2020-01-01T00:00:00.000Z',
      ultimaConfirmacionUtc: '2020-01-01T00:01:00.000Z',
      ultimaEjecucionUtc: '2020-01-01T00:01:00.000Z',
      cerradaEnUtc: cerrada ? '2020-01-01T00:02:00.000Z' : null,
      vigenteHastaOrigenUtc: '2020-01-01T00:03:00.000Z',
      contadorRepeticiones: 2,
      payloadAlerta: { severidad: 'alta' },
      descarteOrigen: {
        descartada: false,
        motivo: '',
        descartadaEnUtc: null,
        descartadaHastaUtc: null,
        actorReferencia: { estado: 'omitida' }
      },
      contextoHumano: {
        descripcionFallo: 'El servicio no responde.',
        posibleSolucion: 'Comprobar conectividad.'
      }
    }
  });
  return { ...caso, familia: 'monitores' };
}

function configuracionPortalFixture() {
  return {
    asegurarActualizada: async () => {},
    obtenerConfiguracionActual: () => ({
      version: 1,
      obtenerConfiguracionFederacion: () => ({ retencionMaximaDias: 1 })
    })
  };
}

async function cerrarGeneracion(sql, caso, { desactivar, cerrarFrontera: cerrar }) {
  await sql.ejecutar(
    `UPDATE generaciones_flujos_federacion
        SET estado='completa',actualizada_en_utc=UTC_TIMESTAMP(3)
      WHERE generacion_id=?`,
    [caso.ids.generacionId]
  );
  if (cerrar) await cerrarFrontera(sql, caso);
  if (desactivar) {
    await sql.ejecutar(
      `UPDATE flujos_federacion SET generacion_activa_id=NULL,
          actualizada_en_utc=UTC_TIMESTAMP(3) WHERE flujo_id=?`,
      [caso.ids.flujoId]
    );
  }
}

async function cerrarFrontera(sql, caso) {
  await sql.ejecutar(
    `UPDATE fronteras_generaciones_federacion
        SET posicion_operativa_validada=0,posicion_historica_validada=0,
            sincronizando=FALSE,operativamente_completa=TRUE,
            historicamente_completa=TRUE,version_frontera=version_frontera+1,
            actualizada_en_utc=UTC_TIMESTAMP(3)
      WHERE generacion_id=?`,
    [caso.ids.generacionId]
  );
}

async function retirarSoporte(sql, caso) {
  await sql.ejecutar(
    `UPDATE versiones_proyecciones_federacion
        SET estado_soporte='huerfana',version_estado=version_estado+1,
            actualizada_en_utc=UTC_TIMESTAMP(3)
      WHERE proyeccion_id=? AND generacion_id=?`,
    [caso.ids.proyeccionId, caso.ids.generacionId]
  );
}

function purgar(repositorio, caso) {
  return repositorio.purgarLote({
    relacionId: caso.ids.relacionId,
    familia: caso.familia,
    limite: 10
  });
}

async function contarRegistro(sql, caso) {
  const [fila] = await sql.consultar(
    `SELECT COUNT(*) AS total FROM registros_telemetria_remotos
      WHERE proyeccion_id=?`,
    [caso.ids.proyeccionId]
  );
  return Number(fila.total);
}

function leer(ruta) {
  return readFile(new URL(ruta, import.meta.url), 'utf8');
}

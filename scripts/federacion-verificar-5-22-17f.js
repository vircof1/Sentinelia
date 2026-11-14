import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { readFile } from 'node:fs/promises';

import { AdaptadorCapturaTransaccionalFederacionSql } from '../paquetes/federacion/adaptadores/AdaptadorCapturaTransaccionalFederacionSql.js';
import { FuenteEntropiaCriptograficaNode } from '../paquetes/federacion/adaptadores/FuenteEntropiaCriptograficaNode.js';
import { RepositorioFlujosFederacionSql } from '../paquetes/federacion/adaptadores/RepositorioFlujosFederacionSql.js';
import { RepositorioGeneracionesCandidatasFederacionSql } from '../paquetes/federacion/adaptadores/RepositorioGeneracionesCandidatasFederacionSql.js';
import { RepositorioOcurrenciasFederacionSql } from '../paquetes/federacion/adaptadores/RepositorioOcurrenciasFederacionSql.js';
import { RepositorioOutboxFederacionSql } from '../paquetes/federacion/adaptadores/RepositorioOutboxFederacionSql.js';
import { ServicioCorteInicialGeneracionFederacion } from '../paquetes/federacion/aplicacion/ServicioCorteInicialGeneracionFederacion.js';
import { ServicioResincronizacionAutomaticaFederacion } from '../paquetes/federacion/aplicacion/ServicioResincronizacionAutomaticaFederacion.js';
import { crearCampoPresenteFederado } from '../paquetes/federacion/src/EnvolventeFederacion.js';
import { GeneradorIdentidadesFederadas, TIPOS_IDENTIDAD_FEDERADA } from '../paquetes/federacion/src/IdentidadFederada.js';
import { ClienteSql } from '../paquetes/persistencia-sql/src/ClienteSql.js';
import { EjecutorMigraciones } from '../paquetes/persistencia-sql/src/EjecutorMigraciones.js';
import { RepositorioMigraciones } from '../paquetes/persistencia-sql/src/RepositorioMigraciones.js';
import { obtenerConfiguracionAplicacion, obtenerRutaMigraciones } from '../paquetes/utilidades/src/configuracion/obtenerConfiguracionAplicacion.js';

const USUARIO = 5_221_706;
const generador = new GeneradorIdentidadesFederadas({
  fuenteEntropia: new FuenteEntropiaCriptograficaNode()
});

async function main() {
  await verificarRegistro();
  const configuracion = obtenerConfiguracionAplicacion();
  assert.equal(configuracion.sql.estaCompleta, true);
  const baseDatos = `sentinelia_fixture_52217f_${randomBytes(6).toString('hex')}`;
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
    await verificarResincronizacion(sql);
  } finally {
    await sql?.cerrar().catch(() => {});
    await administrador.ejecutar(
      `DROP DATABASE IF EXISTS ${administrador.escaparIdentificador(baseDatos)}`
    ).catch(() => {});
    await administrador.cerrar();
  }
  console.log(
    '[federacion] OK 5.22.17f: automatica=idempotente activa=preservada ' +
    'prioridad=operativa promocion=sin-retroceso fallo=aislado ' +
    'bloqueo_operativo=no_promueve'
  );
}

async function verificarRegistro() {
  const [servicio, estado] = await Promise.all([
    leer('../paquetes/federacion/aplicacion/ServicioResincronizacionAutomaticaFederacion.js'),
    leer('../paquetes/federacion/adaptadores/RepositorioEstadoProyeccionesFederacionSql.js')
  ]);
  assert.match(servicio, /operativaCompleta/u);
  assert.match(servicio, /fronteraOperativaValidada/u);
  assert.match(estado, /retrocesoEvitado/u);
  assert.match(estado, /BigInt\(versionAnterior\.ultima_secuencia_evaluada\) > BigInt\(secuenciaMaxima\)/u);
}

async function verificarResincronizacion(sql) {
  const ids = crearIds();
  await crearRelacion(sql, ids);
  const flujos = new RepositorioFlujosFederacionSql(sql, {
    installationLocalId: ids.installationLocalId
  });
  const ocurrencias = new RepositorioOcurrenciasFederacionSql(sql, {
    installationLocalId: ids.installationLocalId
  });
  const captura = new AdaptadorCapturaTransaccionalFederacionSql({
    repositorioOcurrencias: ocurrencias,
    repositorioOutbox: new RepositorioOutboxFederacionSql(sql)
  });
  const candidatas = new RepositorioGeneracionesCandidatasFederacionSql(sql, {
    installationLocalId: ids.installationLocalId
  });
  const corteVacio = crearCorte({ sql, flujos, ocurrencias, captura, capturas: [] });
  await corteVacio.preparar({
    flujo: definicionFlujo(ids),
    generacion: definicionGeneracion(ids.generacionInicialId, ids, 1)
  });
  await corteVacio.cerrar({
    flujoId: ids.flujoId,
    generacionId: ids.generacionInicialId
  });
  await completarInicial(flujos, ids);

  const corteResincronizacion = crearCorte({
    sql,
    flujos,
    ocurrencias,
    captura,
    capturas: [
      capturaElemento(ids, ids.elementoOperativo, ids.ocurrenciaOperativa, 'operativaActual'),
      capturaElemento(ids, ids.elementoHistorico, ids.ocurrenciaHistorica, 'reconstruccion')
    ]
  });
  const servicio = new ServicioResincronizacionAutomaticaFederacion({
    repositorioFlujos: flujos,
    repositorioCandidatas: candidatas,
    servicioCorteInicial: corteResincronizacion,
    generadorIdentidades: generador
  });
  const solicitudes = await Promise.all([
    servicio.solicitar({
      flujoId: ids.flujoId,
      causa: 'confirmacionPerdida',
      detalle: { fronteraRemotaConocida: '0' }
    }),
    servicio.solicitar({
      flujoId: ids.flujoId,
      causa: 'timeout'
    })
  ]);
  assert.equal(solicitudes.filter(({ resultado }) => resultado === 'solicitada').length, 1);
  assert.equal(solicitudes.filter(({ resultado }) => resultado === 'yaEnCurso').length, 1);
  const solicitud = solicitudes.find(({ resultado }) => resultado === 'solicitada');
  const repetida = await servicio.solicitar({
    flujoId: ids.flujoId,
    causa: 'timeout'
  });
  assert.equal(repetida.resultado, 'yaEnCurso');
  assert.equal(repetida.operacion.generacionId, solicitud.operacion.generacionId);
  assert.equal(repetida.operacion.intentosSolicitud, 3);
  await exigirActiva(sql, ids.flujoId, ids.generacionInicialId);

  const fotografia = await servicio.ejecutarPaso(ids.flujoId);
  assert.equal(fotografia.resultado, 'fotografiaPreparada');
  const posiciones = await sql.consultar(
    `SELECT prioridad,posicion_flujo FROM outbox_federacion
      WHERE generacion_id=?
      ORDER BY FIELD(prioridad,'operativaActual','reconstruccion'),posicion_flujo`,
    [solicitud.operacion.generacionId]
  );
  assert.deepEqual(posiciones.map(({ prioridad }) => prioridad), [
    'operativaActual',
    'reconstruccion'
  ]);
  await confirmarPrioridad(sql, solicitud.operacion.generacionId, 'operativaActual');
  const frontera = await servicio.ejecutarPaso(ids.flujoId);
  assert.equal(frontera.resultado, 'fronteraOperativaValidada');
  assert.equal(frontera.resumen.historicaCompleta, false);
  await exigirActiva(sql, ids.flujoId, ids.generacionInicialId);

  const promocion = await servicio.ejecutarPaso(ids.flujoId);
  assert.equal(promocion.resultado, 'promovida');
  await exigirActiva(sql, ids.flujoId, solicitud.operacion.generacionId);
  const historicaPendiente = await sql.consultar(
    `SELECT estado FROM outbox_federacion
      WHERE generacion_id=? AND prioridad='reconstruccion'`,
    [solicitud.operacion.generacionId]
  );
  assert.equal(historicaPendiente[0].estado, 'pendiente');

  const segunda = await servicio.solicitar({
    flujoId: ids.flujoId,
    causa: 'interrupcionRecuperable'
  });
  assert.equal(segunda.resultado, 'solicitada');
  await servicio.ejecutarPaso(ids.flujoId);
  await bloquearPrioridad(sql, segunda.operacion.generacionId, 'operativaActual');
  const bloqueoOperativo = await servicio.ejecutarPaso(ids.flujoId);
  assert.equal(bloqueoOperativo.resultado, 'fallidaPorBloqueoOperativo');
  assert.equal(bloqueoOperativo.resumen.operativaCompleta, false);
  assert.equal(bloqueoOperativo.resumen.operativasBloqueadas, 1);
  await exigirActiva(sql, ids.flujoId, solicitud.operacion.generacionId);
  const [fallida] = await sql.consultar(
    `SELECT estado FROM resincronizaciones_automaticas_federacion
      WHERE generacion_id=?`,
    [segunda.operacion.generacionId]
  );
  assert.equal(fallida.estado, 'fallida');
}

async function bloquearPrioridad(sql, generacionId, prioridad) {
  await sql.ejecutar(
    `UPDATE outbox_federacion
        SET estado='bloqueada',ultimo_resultado='rechazadaDefinitiva',
            ultimo_error_terminal='ocurrencia_excede_limite_individual',
            intentos=intentos+1,actualizada_en_utc=UTC_TIMESTAMP(3),
            finalizada_en_utc=UTC_TIMESTAMP(3)
      WHERE generacion_id=? AND prioridad=?`,
    [generacionId, prioridad]
  );
}

function crearCorte({ sql, flujos, ocurrencias, captura, capturas }) {
  return new ServicioCorteInicialGeneracionFederacion({
    clienteSql: sql,
    repositorioFlujos: flujos,
    repositorioOcurrencias: ocurrencias,
    adaptadorCaptura: captura,
    fuenteFotografia: { listarCapturasEnTransaccion: async () => capturas }
  });
}

async function completarInicial(flujos, ids) {
  let flujo = await flujos.obtener(ids.flujoId);
  flujo = await flujos.avanzarGeneracion({
    flujoId: ids.flujoId,
    propietario: propietario(ids, 1),
    versionEstadoEsperada: flujo.generacion.versionEstado,
    versionFronteraEsperada: flujo.generacion.frontera.version,
    estadoGeneracion: 'transfiriendo',
    estadoFlujo: 'sincronizando',
    frontera: frontera(false)
  });
  await flujos.avanzarGeneracion({
    flujoId: ids.flujoId,
    propietario: propietario(ids, 1),
    versionEstadoEsperada: flujo.generacion.versionEstado,
    versionFronteraEsperada: flujo.generacion.frontera.version,
    estadoGeneracion: 'completa',
    estadoFlujo: 'operativoCompleto',
    frontera: frontera(true)
  });
}

function frontera(completa) {
  return {
    posicionOperativa: completa ? '0' : null,
    posicionHistorica: completa ? '0' : null,
    sincronizando: !completa,
    operativamenteCompleta: completa,
    historicamenteCompleta: completa,
    parcialPorScope: false,
    degradada: false
  };
}

async function confirmarPrioridad(sql, generacionId, prioridad) {
  await sql.ejecutar(
    `UPDATE outbox_federacion
        SET estado='confirmada',ultimo_resultado='aceptada',intentos=intentos+1,
            actualizada_en_utc=UTC_TIMESTAMP(3),finalizada_en_utc=UTC_TIMESTAMP(3)
      WHERE generacion_id=? AND prioridad=?`,
    [generacionId, prioridad]
  );
}

async function exigirActiva(sql, flujoId, generacionId) {
  const [flujo] = await sql.consultar(
    'SELECT generacion_activa_id FROM flujos_federacion WHERE flujo_id=?',
    [flujoId]
  );
  assert.equal(flujo.generacion_activa_id, generacionId);
}

function capturaElemento(ids, elementoOrigenId, ocurrenciaOrigenId, prioridad) {
  return {
    prioridad,
    definicion: {
      familia: 'monitores',
      familiaVersion: 1,
      installationOrigenId: ids.installationLocal,
      elementoOrigenId,
      ocurrenciaOrigenId,
      operacion: 'actualizacion',
      tiempoOrigenUtc: '2030-01-01T00:00:00.000Z',
      scopeOrigenDeclarado: {
        nivel: 'portal', tenantId: null, empresaId: null, sitioId: null
      },
      vigenciaRestanteMs: prioridad === 'operativaActual' ? '300000' : null,
      campos: {
        estado: crearCampoPresenteFederado({ valor: String(elementoOrigenId) })
      },
      evidenciaIntegridad: []
    }
  };
}

function definicionFlujo(ids) {
  return {
    flujoId: ids.flujoId,
    relacionId: ids.relacionId,
    direccion: 'emision',
    familia: 'monitores',
    versionFamilia: 1,
    contexto: { nivel: 'portal', tenantId: null, empresaId: null, sitioId: null }
  };
}

function definicionGeneracion(generacionId, ids, version) {
  return {
    generacionId,
    clase: 'inicial',
    fronteraInicial: '0',
    propietario: propietario(ids, version)
  };
}

function propietario(ids, version) {
  return {
    installationId: ids.installationLocalId,
    bootId: ids.bootId,
    version
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
      ids.relacionId,ids.installationRemotaId,ids.installationRemotaId,
      'fixture 5.22.17f',USUARIO,USUARIO,USUARIO,ahora,ahora
    ]
  );
}

function crearIds() {
  const id = (tipo) => generador.generar(tipo);
  const installationLocal = id(TIPOS_IDENTIDAD_FEDERADA.INSTALACION);
  return Object.freeze({
    installationLocal,
    installationLocalId: String(installationLocal),
    installationRemotaId: String(id(TIPOS_IDENTIDAD_FEDERADA.INSTALACION)),
    bootId: String(id(TIPOS_IDENTIDAD_FEDERADA.ARRANQUE)),
    relacionId: String(id(TIPOS_IDENTIDAD_FEDERADA.RELACION)),
    flujoId: String(id(TIPOS_IDENTIDAD_FEDERADA.FLUJO)),
    generacionInicialId: String(id(TIPOS_IDENTIDAD_FEDERADA.GENERACION)),
    elementoOperativo: id(TIPOS_IDENTIDAD_FEDERADA.ELEMENTO_ORIGEN),
    elementoHistorico: id(TIPOS_IDENTIDAD_FEDERADA.ELEMENTO_ORIGEN),
    ocurrenciaOperativa: id(TIPOS_IDENTIDAD_FEDERADA.OCURRENCIA_ORIGEN),
    ocurrenciaHistorica: id(TIPOS_IDENTIDAD_FEDERADA.OCURRENCIA_ORIGEN)
  });
}

function leer(ruta) {
  return readFile(new URL(ruta, import.meta.url), 'utf8');
}

await main();

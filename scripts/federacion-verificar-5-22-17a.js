import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { readFile } from 'node:fs/promises';

import { AdaptadorTelemetriaFederacion } from '../paquetes/federacion/adaptadores/AdaptadorTelemetriaFederacion.js';
import { RepositorioFlujosFederacionSql } from '../paquetes/federacion/adaptadores/RepositorioFlujosFederacionSql.js';
import { RepositorioPoliticasRetencionFederacionSql } from '../paquetes/federacion/adaptadores/RepositorioPoliticasRetencionFederacionSql.js';
import { RepositorioTelemetriaRemotaSql } from '../paquetes/federacion/adaptadores/RepositorioTelemetriaRemotaSql.js';
import { ServicioPoliticasRetencionFederacion } from '../paquetes/federacion/aplicacion/ServicioPoliticasRetencionFederacion.js';
import { TIPOS_IDENTIDAD_FEDERADA } from '../paquetes/federacion/src/IdentidadFederada.js';
import { PERFIL_PAYLOAD_TELEMETRIA_FEDERACION } from '../paquetes/federacion/src/PayloadTelemetriaFederacion.js';
import { ClienteSql } from '../paquetes/persistencia-sql/src/ClienteSql.js';
import { obtenerConfiguracionAplicacion } from '../paquetes/utilidades/src/configuracion/obtenerConfiguracionAplicacion.js';
import { crearElemento, id, migrar } from './federacion-verificar-5-22-15g.js';

await main();

async function main() {
  await verificarRegistroDocumental();
  const configuracion = obtenerConfiguracionAplicacion();
  assert.equal(configuracion.sql.estaCompleta, true);
  const baseDatos = `sentinelia_fixture_52217a_${randomBytes(6).toString('hex')}`;
  const administrador = new ClienteSql(configuracion.sql);
  let sql;
  try {
    await administrador.ejecutar(
      `CREATE DATABASE ${administrador.escaparIdentificador(baseDatos)} CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`
    );
    sql = new ClienteSql({ ...configuracion.sql, baseDatos });
    await migrar(sql);
    await verificarPoliticaMaterializada(sql);
  } finally {
    await sql?.cerrar().catch(() => {});
    await administrador.ejecutar(
      `DROP DATABASE IF EXISTS ${administrador.escaparIdentificador(baseDatos)}`
    ).catch(() => {});
    await administrador.cerrar();
  }
  console.log(
    '[federacion] OK 5.22.17a: politica=recepcion_familia ' +
    'efectiva=mas_restrictiva global=dinamico historial=inmutable purga=ninguna'
  );
}

async function verificarRegistroDocumental() {
  const bootstrapRuntime = await leer('../apps/sentinelia-runtime/src/BootstrapRuntime.js');
  assert.match(
    bootstrapRuntime,
    /await this\.servicioPoliticasRetencionFederacion\.reconciliarLimiteGlobal\(\)/u
  );
  assert.match(
    bootstrapRuntime,
    /servicioPoliticasRetencionFederacion:\s*this\.servicioPoliticasRetencionFederacion/u
  );
}

async function verificarPoliticaMaterializada(sql) {
  const repositorioTelemetria = new RepositorioTelemetriaRemotaSql(sql);
  const adaptador = new AdaptadorTelemetriaFederacion({
    repositorioRemoto: repositorioTelemetria
  });
  const installationRemotaId = id(TIPOS_IDENTIDAD_FEDERADA.INSTALACION);
  const elemento = await crearElemento({
    sql,
    adaptador,
    installationRemotaId,
    elementoOrigenId: id(TIPOS_IDENTIDAD_FEDERADA.ELEMENTO_ORIGEN),
    payload: payloadObservacion()
  });
  const flujoMonitoresId = id(TIPOS_IDENTIDAD_FEDERADA.FLUJO);
  const generacionMonitoresId = id(TIPOS_IDENTIDAD_FEDERADA.GENERACION);
  const repositorioFlujos = new RepositorioFlujosFederacionSql(sql, {
    installationLocalId: elemento.ids.installationLocalId
  });
  await repositorioFlujos.crearFlujoInicial({
    flujo: {
      flujoId: flujoMonitoresId,
      relacionId: elemento.ids.relacionId,
      direccion: 'recepcion',
      familia: 'monitores',
      versionFamilia: 1,
      contexto: {
        nivel: 'empresa',
        tenantId: '10',
        empresaId: '20',
        sitioId: null
      }
    },
    generacion: {
      generacionId: generacionMonitoresId,
      clase: 'inicial',
      fronteraInicial: '0',
      propietario: {
        installationId: installationRemotaId,
        bootId: id(TIPOS_IDENTIDAD_FEDERADA.ARRANQUE),
        version: 1
      }
    }
  });

  const repositorio = new RepositorioPoliticasRetencionFederacionSql(sql);
  let configuracionGlobal = { retencionMaximaDias: 90 };
  let versionPortal = 1;
  const servicio = new ServicioPoliticasRetencionFederacion({
    repositorioPoliticas: repositorio,
    servicioConfiguracionPortal: {
      asegurarActualizada: async () => {},
      obtenerConfiguracionActual: () => ({
        version: versionPortal,
        obtenerConfiguracionFederacion: () => configuracionGlobal
      })
    }
  });
  const inicial = await servicio.reconciliarLimiteGlobal();
  assert.equal(inicial.totalPoliticas, 2);
  assert.equal(inicial.totalCambios, 2);
  assert.deepEqual(
    new Set(inicial.resultados.map(({ politica }) => politica.familia)),
    new Set(['monitores', 'telemetria'])
  );
  for (const { politica } of inicial.resultados) {
    assert.equal(politica.retencionRecepcionDias, null);
    assert.equal(politica.retencionEfectivaDias, '90');
  }

  const monitores = await servicio.configurarFamilia({
    relacionId: elemento.ids.relacionId,
    familia: 'monitores',
    retencionRecepcionDias: '120'
  });
  assert.equal(monitores.cambiada, true);
  assert.equal(monitores.politica.retencionRecepcionDias, '120');
  assert.equal(monitores.politica.retencionEfectivaDias, '90');
  const telemetria = await servicio.configurarFamilia({
    relacionId: elemento.ids.relacionId,
    familia: 'telemetria',
    retencionRecepcionDias: '30'
  });
  assert.equal(telemetria.politica.retencionEfectivaDias, '30');

  configuracionGlobal = { retencionMaximaDias: 20 };
  versionPortal = 2;
  const reducida = await servicio.reconciliarLimiteGlobal();
  assert.equal(reducida.totalCambios, 2);
  assert.equal((await repositorio.obtener({
    relacionId: elemento.ids.relacionId,
    familia: 'monitores'
  })).retencionEfectivaDias, '20');
  assert.equal((await repositorio.obtener({
    relacionId: elemento.ids.relacionId,
    familia: 'telemetria'
  })).retencionEfectivaDias, '20');
  const replay = await servicio.reconciliarLimiteGlobal();
  assert.equal(replay.totalCambios, 0);

  configuracionGlobal = { retencionMaximaDias: 60 };
  versionPortal = 3;
  const ampliada = await servicio.reconciliarLimiteGlobal();
  assert.equal(ampliada.totalCambios, 2);
  assert.equal((await repositorio.obtener({
    relacionId: elemento.ids.relacionId,
    familia: 'monitores'
  })).retencionEfectivaDias, '60');
  assert.equal((await repositorio.obtener({
    relacionId: elemento.ids.relacionId,
    familia: 'telemetria'
  })).retencionEfectivaDias, '30');
  versionPortal = 4;
  assert.equal((await servicio.reconciliarLimiteGlobal()).totalCambios, 0);

  await repositorioFlujos.crearFlujoInicial({
    flujo: {
      flujoId: id(TIPOS_IDENTIDAD_FEDERADA.FLUJO),
      relacionId: elemento.ids.relacionId,
      direccion: 'recepcion',
      familia: 'triggersInformativos',
      versionFamilia: 1,
      contexto: {
        nivel: 'empresa',
        tenantId: '10',
        empresaId: '20',
        sitioId: null
      }
    },
    generacion: {
      generacionId: id(TIPOS_IDENTIDAD_FEDERADA.GENERACION),
      clase: 'inicial',
      fronteraInicial: '0',
      propietario: {
        installationId: installationRemotaId,
        bootId: id(TIPOS_IDENTIDAD_FEDERADA.ARRANQUE),
        version: 1
      }
    }
  });
  await Promise.all([
    servicio.reconciliarLimiteGlobal(),
    servicio.configurarFamilia({
      relacionId: elemento.ids.relacionId,
      familia: 'triggersInformativos',
      retencionRecepcionDias: '15'
    })
  ]);
  const politicaConcurrente = await repositorio.obtener({
    relacionId: elemento.ids.relacionId,
    familia: 'triggersInformativos'
  });
  assert.equal(politicaConcurrente.retencionRecepcionDias, '15');
  assert.equal(politicaConcurrente.retencionEfectivaDias, '15');
  const historialConcurrente = await repositorio.listarHistorial({
    relacionId: elemento.ids.relacionId,
    familia: 'triggersInformativos'
  });
  assert.ok([1, 2].includes(historialConcurrente.length));
  assert.deepEqual(
    historialConcurrente.map(({ version }) => version),
    historialConcurrente.map((_, indice) => String(indice + 1))
  );

  const historial = await repositorio.listarHistorial({
    relacionId: elemento.ids.relacionId,
    familia: 'monitores'
  });
  assert.deepEqual(historial.map(({ version }) => version), ['1', '2', '3', '4']);
  assert.deepEqual(historial.map(({ causa }) => causa), [
    'materializacionInicial',
    'configuracionRecepcion',
    'limiteGlobalCambiado',
    'limiteGlobalCambiado'
  ]);
  await assert.rejects(
    servicio.configurarFamilia({
      relacionId: elemento.ids.relacionId,
      familia: 'auditoria',
      retencionRecepcionDias: '10'
    }),
    (error) => error.codigo === 'familia_recepcion_inexistente'
  );
  await assert.rejects(
    sql.ejecutar(
      `UPDATE politicas_retencion_recepciones_federacion
          SET retencion_efectiva_dias=3650,
              version_politica=version_politica+1
        WHERE relacion_id=? AND familia='monitores'`,
      [elemento.ids.relacionId]
    )
  );
  await assert.rejects(
    sql.ejecutar(
      `UPDATE historial_politicas_retencion_recepciones_federacion
          SET causa='limiteGlobalCambiado'
        WHERE relacion_id=? AND familia='monitores' AND version_politica=2`,
      [elemento.ids.relacionId]
    )
  );
  const [conteos] = await sql.consultar(
    `SELECT
       (SELECT COUNT(*) FROM registros_telemetria_remotos) AS registros,
       (SELECT COUNT(*) FROM proyecciones_federacion) AS proyecciones`
  );
  assert.equal(Number(conteos.registros), 1);
  assert.equal(Number(conteos.proyecciones), 1);
}

function payloadObservacion() {
  const fuenteOrigenId = id(TIPOS_IDENTIDAD_FEDERADA.ELEMENTO_ORIGEN);
  const senalOrigenId = id(TIPOS_IDENTIDAD_FEDERADA.ELEMENTO_ORIGEN);
  return {
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
    vigenteHastaUtc: '2031-01-01T00:05:00.000Z',
    detalleHumano: 'Carga remota',
    metadatosContextuales: {},
    emitidoEnUtc: '2031-01-01T00:00:00.000Z',
    observadoEnUtc: '2031-01-01T00:00:00.000Z',
    recibidoEnUtc: '2031-01-01T00:00:01.000Z'
  };
}

function leer(ruta) {
  return readFile(new URL(ruta, import.meta.url), 'utf8');
}

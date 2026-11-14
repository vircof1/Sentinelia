import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';

import { AdaptadorMonitoresFederacion } from '../paquetes/federacion/adaptadores/AdaptadorMonitoresFederacion.js';
import { RepositorioMonitoresRemotoSql } from '../paquetes/federacion/adaptadores/RepositorioMonitoresRemotoSql.js';
import { RepositorioTiempoEstadosRemotosSql } from '../paquetes/federacion/adaptadores/RepositorioTiempoEstadosRemotosSql.js';
import { PERFIL_PAYLOAD_MONITORES_FEDERACION } from '../paquetes/federacion/src/PayloadMonitoresFederacion.js';
import { TIPOS_IDENTIDAD_FEDERADA } from '../paquetes/federacion/src/IdentidadFederada.js';
import { ClienteSql } from '../paquetes/persistencia-sql/src/ClienteSql.js';
import { FronteraTransaccionalLocal } from '../paquetes/persistencia-sql/src/FronteraTransaccionalLocal.js';
import { obtenerConfiguracionAplicacion } from '../paquetes/utilidades/src/configuracion/obtenerConfiguracionAplicacion.js';
import { RepositorioMonitores } from '../paquetes/monitores/src/RepositorioMonitores.js';
import { RepositorioEntradasFederadasMonitoresLogicosSql } from '../paquetes/monitores/src/RepositorioEntradasFederadasMonitoresLogicosSql.js';
import { ServicioMonitores } from '../paquetes/monitores/src/ServicioMonitores.js';
import { ValidadorMonitor } from '../paquetes/monitores/src/ValidadorMonitor.js';
import { EjecutorMonitorBooleano } from '../apps/sentinelia-runtime/src/ejecucion/EjecutorMonitorBooleano.js';
import {
  contextoCierre,
  crearElemento,
  id,
  materializar,
  migrar,
  publicarHasta,
  recibirYReclamar
} from './federacion-verificar-5-22-15g.js';

await main();

async function main() {
  await verificarContratoYEstadosPuros();
  const configuracion = obtenerConfiguracionAplicacion();
  assert.equal(configuracion.sql.estaCompleta, true);
  const baseDatos = `sentinelia_fixture_52216e_${randomBytes(6).toString('hex')}`;
  const administrador = new ClienteSql(configuracion.sql);
  let sql;
  try {
    await administrador.ejecutar(
      `CREATE DATABASE ${administrador.escaparIdentificador(baseDatos)} CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`
    );
    sql = new ClienteSql({ ...configuracion.sql, baseDatos });
    await migrar(sql);
    await verificarRecorridoSqlReal(sql);
  } finally {
    await sql?.cerrar().catch(() => {});
    await administrador.ejecutar(
      `DROP DATABASE IF EXISTS ${administrador.escaparIdentificador(baseDatos)}`
    ).catch(() => {});
    await administrador.cerrar();
  }
  console.log(
    '[federacion] OK 5.22.16e: valor=binario condicion=separada ' +
    'vigente=interpretable perdida=politica no_autorizada_y_retirada=incompletas'
  );
}

async function verificarContratoYEstadosPuros() {
  const proyeccionId = id(TIPOS_IDENTIDAD_FEDERADA.PROYECCION);
  const base = {
    entradaId: 1,
    variable: 'A',
    proyeccionId,
    revisionConfiguracion: 1,
    estadoInicial: 'fallo',
    inversion: false,
    politicaPerdidaEnFallo: 'forzar_correcto',
    politicaPerdidaEnCorrecto: 'forzar_fallo',
    generacionId: id(TIPOS_IDENTIDAD_FEDERADA.GENERACION),
    estadoVigencia: 'vigente',
    estadoSoporte: 'sostenida',
    estadoAutorizacion: 'autorizada',
    estadoCoherencia: 'coherente',
    condicionTemporal: 'vencida',
    secuenciaElemento: '3',
    estadoOperativoRemoto: 'fallo',
    remotoEjecutadoTodavia: true,
    ultimoEstadoRemotoEstable: 'fallo'
  };
  const perdida = await ejecutarConEntrada(base);
  assert.equal(entradaResultado(perdida).valorBinarioEfectivo, true);
  assert.equal(entradaResultado(perdida).condicionFuente, 'perdidaTemporal');
  assert.equal(entradaResultado(perdida).accionAplicada, 'forzar_correcto');

  const noAutorizada = await ejecutarConEntrada({
    ...base,
    condicionTemporal: 'noAutorizada',
    estadoAutorizacion: 'noAutorizada'
  });
  assert.equal(noAutorizada.codigoResultado, 'booleano_inicializando');
  assert.equal(entradaResultado(noAutorizada).condicionFuente, 'noAutorizada');
  assert.equal(entradaResultado(noAutorizada).valorBinarioEfectivo, false);

  const retirada = await ejecutarConEntrada({
    ...base,
    estadoVigencia: 'retirada',
    condicionTemporal: 'vigente'
  });
  assert.equal(retirada.metricaPrincipal.bloqueaEvaluacion, true);
  assert.equal(retirada.codigoResultado, 'fuente_retirada');
  assert.equal(entradaResultado(retirada).condicionFuente, 'fuente_retirada');
  assert.equal(retirada.efectosDerivadosHabilitados, false);

  const inicial = await ejecutarConEntrada({
    ...base,
    generacionId: null,
    condicionTemporal: null,
    estadoInicial: 'correcto',
    estadoOperativoRemoto: null,
    ultimoEstadoRemotoEstable: null
  });
  assert.equal(entradaResultado(inicial).condicionFuente, 'inicial');
  assert.equal(entradaResultado(inicial).valorBinarioEfectivo, true);

  const sinEstado = await ejecutarConEntrada({
    ...base,
    condicionTemporal: 'vigente',
    estadoOperativoRemoto: 'pendiente',
    ultimoEstadoRemotoEstable: 'correcto'
  });
  assert.equal(entradaResultado(sinEstado).condicionFuente, 'sinEstadoOperativo');
  assert.equal(entradaResultado(sinEstado).valorBinarioEfectivo, false);
  assert.equal(entradaResultado(sinEstado).accionAplicada, 'forzar_fallo');

  const noEjecutada = await ejecutarConEntrada({
    ...base,
    condicionTemporal: 'vigente',
    estadoOperativoRemoto: 'vivo',
    remotoEjecutadoTodavia: false,
    ultimoEstadoRemotoEstable: null,
    estadoInicial: 'fallo'
  });
  assert.equal(entradaResultado(noEjecutada).condicionFuente, 'sinEstadoOperativo');
  assert.equal(entradaResultado(noEjecutada).valorBinarioEfectivo, false);
}

async function verificarRecorridoSqlReal(sql) {
  await sql.ejecutar(
    `INSERT INTO tenants (id,nombre,alias) VALUES (1,'Tenant prueba','tenant-prueba')`
  );
  await sql.ejecutar(
    `INSERT INTO empresas (id,tenant_id,nombre,alias) VALUES (10,1,'Empresa A','empresa-a')`
  );
  await sql.ejecutar(
    `INSERT INTO configuracion_portal (
       clave,valor,tipo_dato,descripcion,creado_automaticamente
     ) VALUES ('federacion.ttl_estado_operativo_ms','60000','entero',
       'TTL receptor de prueba',1)
     ON DUPLICATE KEY UPDATE valor=VALUES(valor)`
  );
  const repositorioRemoto = new RepositorioMonitoresRemotoSql(sql);
  const adaptador = new AdaptadorMonitoresFederacion({
    repositorioRemoto
  });
  const monitorOrigenId = id(TIPOS_IDENTIDAD_FEDERADA.ELEMENTO_ORIGEN);
  const remoto = await crearElemento({
    sql,
    adaptador,
    installationRemotaId: id(TIPOS_IDENTIDAD_FEDERADA.INSTALACION),
    elementoOrigenId: id(TIPOS_IDENTIDAD_FEDERADA.ELEMENTO_ORIGEN),
    payload: payloadEstado({ monitorOrigenId, estado: 'fallo' }),
    familia: 'monitores',
    versionFamilia: 1,
    vigenciaRestanteMs: '120000'
  });
  const fotografias = await repositorioRemoto.listarFotografiasOperativas({
    proyeccionId: remoto.ids.proyeccionId
  });
  const repositorioTiempo = new RepositorioTiempoEstadosRemotosSql(sql);
  const bootId = id(TIPOS_IDENTIDAD_FEDERADA.ARRANQUE);
  await repositorioTiempo.iniciarConsolidacion({ bootId, duracionMs: 0 });
  await repositorioTiempo.materializar({ bootId, fotografias });

  const payloadAdelantado = payloadEstado({ monitorOrigenId, estado: 'vivo' });
  const trabajoAdelantado = await recibirYReclamar({
    sql,
    contexto: remoto,
    secuencia: 2,
    operacion: 'actualizacion',
    payload: payloadAdelantado,
    familia: 'monitores',
    versionFamilia: 1,
    vigenciaRestanteMs: '120000'
  });
  await materializar({
    sql,
    adaptador,
    trabajo: trabajoAdelantado,
    payload: payloadAdelantado
  });
  await remoto.cicloTrabajos.completar(contextoCierre(trabajoAdelantado));
  await publicarHasta(
    sql,
    remoto.ids.proyeccionId,
    remoto.ids.generacionId,
    '2'
  );

  const repositorioMonitores = new RepositorioMonitores(sql);
  const repositorioEntradas =
    new RepositorioEntradasFederadasMonitoresLogicosSql(sql);
  const servicio = new ServicioMonitores({
    repositorioMonitores,
    repositorioTenants: { buscarPorId: async (valor) => ({ id: Number(valor) }) },
    repositorioEmpresas: {
      buscarPorId: async (valor) => ({ id: Number(valor), tenantId: 1 })
    },
    repositorioSitios: { buscarPorId: async () => null },
    repositorioEntradasFederadasMonitoresLogicos: repositorioEntradas,
    resolutorScopeUsuario: {
      puedeAlcanzarEmpresa: () => true,
      puedeAlcanzarSitio: () => false
    },
    validadorMonitor: new ValidadorMonitor(),
    fronteraTransaccional: new FronteraTransaccionalLocal(sql)
  });
  const monitor = await servicio.crearMonitor(
    { nivelScope: 'portal' },
    datosMonitor(remoto.ids.proyeccionId)
  );
  const resultado = await new EjecutorMonitorBooleano({
    repositorioEntradasFederadas: repositorioEntradas
  }).ejecutar(monitor);
  const [lecturaGobernante] = await repositorioEntradas
    .resolverEntradasOperativasPorMonitorId(monitor.id);
  assert.equal(lecturaGobernante.secuenciaElemento, '1');
  assert.equal(lecturaGobernante.ultimoEstadoRemotoEstable, 'fallo');
  const entrada = entradaResultado(resultado);
  assert.equal(entrada.condicionFuente, 'vigente');
  assert.equal(entrada.estadoOperativoRemoto, 'fallo');
  assert.equal(entrada.valorBinarioEfectivo, true, 'La inversión local se aplica una sola vez.');
  assert.equal(resultado.codigoResultado, 'booleano_ok');

  await repositorioTiempo.materializar({
    bootId,
    fotografias: await repositorioRemoto.listarFotografiasOperativas({
      proyeccionId: remoto.ids.proyeccionId
    })
  });
  await sql.ejecutar(
    `DELETE FROM estados_actuales_proyecciones_federacion
      WHERE proyeccion_id=? AND generacion_actual_id=?`,
    [remoto.ids.proyeccionId, remoto.ids.generacionId]
  );
  await sql.ejecutar(
    `UPDATE versiones_proyecciones_federacion
        SET estado_publicacion='preparando',estado_vigencia='retirada',
            publicada_en_utc=NULL,version_estado=version_estado+1,
            actualizada_en_utc=UTC_TIMESTAMP(3)
      WHERE proyeccion_id=? AND generacion_id=?`,
    [remoto.ids.proyeccionId, remoto.ids.generacionId]
  );
  const retiradaTemporal = await repositorioTiempo.materializar({
    bootId,
    fotografias: []
  });
  assert.equal(retiradaTemporal.transiciones[0].causa, 'fuente_retirada');
  const [lecturaRetirada] = await repositorioEntradas
    .resolverEntradasOperativasPorMonitorId(monitor.id);
  assert.equal(lecturaRetirada.estadoVigencia, 'retirada');
  assert.equal(lecturaRetirada.condicionTemporal, 'retirada');
  const resultadoRetirado = await new EjecutorMonitorBooleano({
    repositorioEntradasFederadas: repositorioEntradas
  }).ejecutar(monitor);
  assert.equal(
    entradaResultado(resultadoRetirado).condicionFuente,
    'fuente_retirada'
  );
  assert.equal(resultadoRetirado.metricaPrincipal.bloqueaEvaluacion, true);
  assert.equal(resultadoRetirado.codigoResultado, 'fuente_retirada');
  assert.equal(resultadoRetirado.efectosDerivadosHabilitados, false);
}

async function ejecutarConEntrada(entrada) {
  return new EjecutorMonitorBooleano({
    repositorioEntradasFederadas: {
      resolverEntradasOperativasPorMonitorId: async () => [entrada]
    }
  }).ejecutar(monitorFixture(entrada.proyeccionId));
}

function monitorFixture(proyeccionId) {
  return {
    id: 900,
    nombre: 'Monitor lógico fixture',
    tipo: 'booleano',
    configuracion: {
      version: 3,
      expresion: 'A',
      mensajeFallo: 'Entrada remota en fallo',
      estadoInicial: 'disponible',
      retardoSenalSegundos: 0,
      dependencias: [{
        variable: 'A', fuente: 'monitor_federado', proyeccionId,
        estadoInicial: 'fallo', inversion: false,
        politicaPerdidaEnFallo: 'forzar_correcto',
        politicaPerdidaEnCorrecto: 'forzar_fallo'
      }]
    }
  };
}

function entradaResultado(resultado) {
  return resultado.intentos[0].detalle.entradas[0];
}

function payloadEstado({ monitorOrigenId, estado }) {
  const ahora = new Date().toISOString();
  return {
    perfil: PERFIL_PAYLOAD_MONITORES_FEDERACION,
    version: 1,
    tipoRegistro: 'estadoActual',
    monitorOrigenId,
    versionCatalogo: 'beta-1',
    estado,
    ejecutadoTodavia: true,
    fechaUltimaEjecucionUtc: ahora,
    fechaUltimoCambioUtc: ahora,
    motivoInicial: 'ejecutado',
    resultadoActual: { codigo: estado },
    contextoHumano: {
      descripcionFallo: 'Estado remoto de fixture',
      posibleSolucion: 'Revisar el origen'
    },
    vigenteHastaOrigenUtc: new Date(Date.now() + 120_000).toISOString()
  };
}

function datosMonitor(proyeccionId) {
  return {
    tenant_id: '1', empresa_id: '10', sitio_id: '',
    nivel_pertenencia: 'empresa', nombre: 'Lógico federado ejecutable',
    tipo: 'booleano', descripcion: 'Prueba 5.22.16e',
    interpretacion_estado: 'normal', descripcion_fallo: 'Estado remoto en fallo',
    posible_solucion: 'Revisar la fuente remota', activo: '1',
    intervalo_ejecucion_segundos: '60', desfase_inicial_segundos: '0',
    expresion_logica: 'A', mensaje_fallo_logico: 'Fallo lógico remoto',
    estado_inicial_logico: 'disponible', retardo_senal_segundos_logico: '0',
    dependencias_logicas: JSON.stringify([{
      variable: 'A', fuente: 'monitor_federado', proyeccionId,
      estadoInicial: 'fallo', inversion: true,
      politicaPerdidaEnFallo: 'conservar',
      politicaPerdidaEnCorrecto: 'conservar'
    }])
  };
}

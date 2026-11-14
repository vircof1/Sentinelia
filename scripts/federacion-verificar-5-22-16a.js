import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';

import { AdaptadorMonitoresFederacion } from '../paquetes/federacion/adaptadores/AdaptadorMonitoresFederacion.js';
import { RepositorioMonitoresRemotoSql } from '../paquetes/federacion/adaptadores/RepositorioMonitoresRemotoSql.js';
import { TIPOS_IDENTIDAD_FEDERADA } from '../paquetes/federacion/src/IdentidadFederada.js';
import { PERFIL_PAYLOAD_MONITORES_FEDERACION } from '../paquetes/federacion/src/PayloadMonitoresFederacion.js';
import { ClienteSql } from '../paquetes/persistencia-sql/src/ClienteSql.js';
import { obtenerConfiguracionAplicacion } from '../paquetes/utilidades/src/configuracion/obtenerConfiguracionAplicacion.js';
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
  const configuracion = obtenerConfiguracionAplicacion();
  assert.equal(configuracion.sql.estaCompleta, true);
  const baseDatos = `sentinelia_fixture_52216a_${randomBytes(6).toString('hex')}`;
  const administrador = new ClienteSql(configuracion.sql);
  let sql;
  try {
    await administrador.ejecutar(
      `CREATE DATABASE ${administrador.escaparIdentificador(baseDatos)} CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`
    );
    sql = new ClienteSql({ ...configuracion.sql, baseDatos });
    await migrar(sql);
    await verificarFotografiaOperativa(sql);
  } finally {
    await sql?.cerrar().catch(() => {});
    await administrador.ejecutar(
      `DROP DATABASE IF EXISTS ${administrador.escaparIdentificador(baseDatos)}`
    ).catch(() => {});
    await administrador.cerrar();
  }
  console.log(
    '[federacion] OK 5.22.16a: fotografia=durable prioridad=operativaActual ' +
    'vigencia=origen_receptor procedencia=causal publicacion=atomica regresion=impedida'
  );
}

async function verificarFotografiaOperativa(sql) {
  await sql.ejecutar(
    `INSERT INTO configuracion_portal (
       clave,valor,tipo_dato,descripcion,creado_automaticamente
     ) VALUES ('federacion.ttl_estado_operativo_ms','60000','entero',
       'Fixture de vigencia receptora',1)`
  );
  const repositorio = new RepositorioMonitoresRemotoSql(sql);
  const adaptador = new AdaptadorMonitoresFederacion({ repositorioRemoto: repositorio });
  const installationRemotaId = id(TIPOS_IDENTIDAD_FEDERADA.INSTALACION);
  const monitorOrigenId = id(TIPOS_IDENTIDAD_FEDERADA.ELEMENTO_ORIGEN);
  const elementoOrigenId = id(TIPOS_IDENTIDAD_FEDERADA.ELEMENTO_ORIGEN);
  const origenLejano = new Date(Date.now() + 10 * 60_000).toISOString();
  const primero = payloadEstado({ monitorOrigenId, estado: 'fallo', vigenteHastaOrigenUtc: origenLejano });
  const elemento = await crearElemento({
    sql,
    adaptador,
    installationRemotaId,
    elementoOrigenId,
    payload: primero,
    familia: 'monitores',
    versionFamilia: 1,
    vigenciaRestanteMs: '120000',
    finalizar: false,
    publicar: false
  });
  assert.equal(elemento.trabajo.prioridad, 'operativaActual');
  assert.deepEqual(await repositorio.listarFotografiasOperativas({ proyeccionId: elemento.ids.proyeccionId }), []);
  await elemento.cicloTrabajos.completar(contextoCierre(elemento.trabajo));
  await publicarHasta(sql, elemento.ids.proyeccionId, elemento.ids.generacionId, '1');

  let [fotografia] = await repositorio.listarFotografiasOperativas({
    proyeccionId: elemento.ids.proyeccionId
  });
  assert.equal(fotografia.secuenciaElemento, '1');
  assert.equal(fotografia.estadoOperativo, 'fallo');
  assert.equal(fotografia.fotografiaOperativa.vigenciaTemporal, 'vigente');
  assert.equal(fotografia.fotografiaOperativa.utilizableAhora, true);
  assert.equal(fotografia.fotografiaOperativa.procedenciaMaterializacion.relacionId, elemento.ids.relacionId);
  assert.ok(
    Date.parse(fotografia.fotografiaOperativa.vigenteHastaEfectivaUtc) <=
      Date.parse(fotografia.fotografiaOperativa.vigenteHastaReceptorUtc)
  );
  assert.ok(
    Date.parse(fotografia.fotografiaOperativa.vigenteHastaReceptorUtc) -
      Date.parse(fotografia.fotografiaOperativa.materializadaEnUtc) === 60_000
  );

  const origenCercano = new Date(Date.now() + 20_000).toISOString();
  const segundo = payloadEstado({
    monitorOrigenId,
    estado: 'vivo',
    vigenteHastaOrigenUtc: origenCercano
  });
  const trabajoSegundo = await recibirYReclamar({
    sql,
    contexto: elemento,
    secuencia: 2,
    operacion: 'actualizacion',
    payload: segundo,
    familia: 'monitores',
    versionFamilia: 1,
    vigenciaRestanteMs: '120000'
  });
  await materializar({ sql, adaptador, trabajo: trabajoSegundo, payload: segundo });
  [fotografia] = await repositorio.listarFotografiasOperativas({
    proyeccionId: elemento.ids.proyeccionId
  });
  assert.equal(fotografia.secuenciaElemento, '1');
  assert.equal(fotografia.estadoOperativo, 'fallo');

  await elemento.cicloTrabajos.completar(contextoCierre(trabajoSegundo));
  await publicarHasta(sql, elemento.ids.proyeccionId, elemento.ids.generacionId, '2');
  [fotografia] = await repositorio.listarEstadosActualesSeleccionables({
    proyeccionId: elemento.ids.proyeccionId
  });
  assert.equal(fotografia.secuenciaElemento, '2');
  assert.equal(fotografia.estadoOperativo, 'vivo');
  assert.equal(
    fotografia.fotografiaOperativa.vigenteHastaEfectivaUtc,
    new Date(origenCercano).toISOString()
  );

  elemento.ids.ocurrencias.push(
    id(TIPOS_IDENTIDAD_FEDERADA.OCURRENCIA_ORIGEN),
    id(TIPOS_IDENTIDAD_FEDERADA.OCURRENCIA_ORIGEN)
  );
  elemento.ids.entregas.push(
    id(TIPOS_IDENTIDAD_FEDERADA.ENTREGA),
    id(TIPOS_IDENTIDAD_FEDERADA.ENTREGA)
  );
  const eventoPosterior = payloadEvento({ monitorOrigenId });
  const trabajoEvento = await recibirYReclamar({
    sql,
    contexto: elemento,
    secuencia: 3,
    operacion: 'actualizacion',
    payload: eventoPosterior,
    familia: 'monitores',
    versionFamilia: 1,
    vigenciaRestanteMs: '120000'
  });
  await materializar({
    sql,
    adaptador,
    trabajo: trabajoEvento,
    payload: eventoPosterior
  });
  await elemento.cicloTrabajos.completar(contextoCierre(trabajoEvento));
  await publicarHasta(sql, elemento.ids.proyeccionId, elemento.ids.generacionId, '3');
  [fotografia] = await repositorio.listarFotografiasOperativas({
    proyeccionId: elemento.ids.proyeccionId
  });
  assert.equal(
    fotografia.secuenciaElemento,
    '2',
    'Un evento posterior no debe ocultar la última fotografía operativa.'
  );

  const trabajoRetirada = await recibirYReclamar({
    sql,
    contexto: elemento,
    secuencia: 4,
    operacion: 'retirada',
    payload: null,
    familia: 'monitores',
    versionFamilia: 1,
    vigenciaRestanteMs: null
  });
  await materializar({
    sql,
    adaptador,
    trabajo: trabajoRetirada,
    payload: null,
    operacion: 'retirada'
  });
  await elemento.cicloTrabajos.completar(contextoCierre(trabajoRetirada));
  await publicarHasta(sql, elemento.ids.proyeccionId, elemento.ids.generacionId, '4');
  assert.deepEqual(
    await repositorio.listarFotografiasOperativas({
      proyeccionId: elemento.ids.proyeccionId
    }),
    [],
    'Una retirada posterior debe ser la frontera terminal de la fotografía.'
  );

  await assert.rejects(
    sql.ejecutar(
      `UPDATE fotografias_operativas_monitores_remotos
          SET secuencia_estado=1
        WHERE proyeccion_id=? AND generacion_id=? AND secuencia_estado=2`,
      [elemento.ids.proyeccionId, elemento.ids.generacionId]
    ),
    /fotografia operativa remota es inmutable/iu
  );
  const [conteo] = await sql.consultar(
    `SELECT COUNT(*) AS total FROM fotografias_operativas_monitores_remotos
      WHERE proyeccion_id=? AND generacion_id=?`,
    [elemento.ids.proyeccionId, elemento.ids.generacionId]
  );
  assert.equal(Number(conteo.total), 2);

  const monitorVencidoId = id(TIPOS_IDENTIDAD_FEDERADA.ELEMENTO_ORIGEN);
  const vencido = await crearElemento({
    sql,
    adaptador,
    installationRemotaId,
    elementoOrigenId: id(TIPOS_IDENTIDAD_FEDERADA.ELEMENTO_ORIGEN),
    payload: payloadEstado({
      monitorOrigenId: monitorVencidoId,
      estado: 'fallo',
      vigenteHastaOrigenUtc: new Date(Date.now() - 1_000).toISOString()
    }),
    familia: 'monitores',
    versionFamilia: 1,
    vigenciaRestanteMs: '120000'
  });
  const [fotografiaVencida] = await repositorio.listarFotografiasOperativas({
    proyeccionId: vencido.ids.proyeccionId
  });
  assert.equal(fotografiaVencida.fotografiaOperativa.vigenciaTemporal, 'vencida');
  assert.equal(fotografiaVencida.fotografiaOperativa.utilizableAhora, false);
}

function payloadEvento({ monitorOrigenId }) {
  const ahora = new Date().toISOString();
  return {
    perfil: PERFIL_PAYLOAD_MONITORES_FEDERACION,
    version: 1,
    tipoRegistro: 'evento',
    monitorOrigenId,
    versionCatalogo: 'beta-1',
    tipoMonitor: 'booleano',
    estadoDetectado: 'vivo',
    codigoResultado: 'evento_posterior',
    mensajeResultado: 'Evento posterior a la fotografía operativa',
    exito: true,
    duracionTotalMs: 1,
    ejecutadoEnUtc: ahora,
    payloadEvento: null,
    contextoHumano: {
      descripcionFallo: 'Evento de fixture',
      posibleSolucion: 'No aplica'
    }
  };
}

function payloadEstado({ monitorOrigenId, estado, vigenteHastaOrigenUtc }) {
  const ahora = new Date(Math.min(
    Date.now(),
    Date.parse(vigenteHastaOrigenUtc) - 1_000
  )).toISOString();
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
    vigenteHastaOrigenUtc
  };
}

import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';

import { AdaptadorCapturaTransaccionalFederacionSql } from '../paquetes/federacion/adaptadores/AdaptadorCapturaTransaccionalFederacionSql.js';
import { FuenteEntropiaCriptograficaNode } from '../paquetes/federacion/adaptadores/FuenteEntropiaCriptograficaNode.js';
import { RepositorioFlujosFederacionSql } from '../paquetes/federacion/adaptadores/RepositorioFlujosFederacionSql.js';
import { RepositorioOcurrenciasFederacionSql } from '../paquetes/federacion/adaptadores/RepositorioOcurrenciasFederacionSql.js';
import { RepositorioOutboxFederacionSql } from '../paquetes/federacion/adaptadores/RepositorioOutboxFederacionSql.js';
import { ServicioCorteInicialGeneracionFederacion } from '../paquetes/federacion/aplicacion/ServicioCorteInicialGeneracionFederacion.js';
import { crearCampoPresenteFederado } from '../paquetes/federacion/src/EnvolventeFederacion.js';
import {
  GeneradorIdentidadesFederadas,
  TIPOS_IDENTIDAD_FEDERADA
} from '../paquetes/federacion/src/IdentidadFederada.js';
import { ClienteSql } from '../paquetes/persistencia-sql/src/ClienteSql.js';
import { EjecutorMigraciones } from '../paquetes/persistencia-sql/src/EjecutorMigraciones.js';
import { FronteraTransaccionalLocal } from '../paquetes/persistencia-sql/src/FronteraTransaccionalLocal.js';
import { RepositorioMigraciones } from '../paquetes/persistencia-sql/src/RepositorioMigraciones.js';
import {
  obtenerConfiguracionAplicacion,
  obtenerRutaMigraciones
} from '../paquetes/utilidades/src/configuracion/obtenerConfiguracionAplicacion.js';

const USUARIO_FIXTURE = 5221401;
const generador = new GeneradorIdentidadesFederadas({
  fuenteEntropia: new FuenteEntropiaCriptograficaNode()
});

async function main() {
  const configuracion = obtenerConfiguracionAplicacion();
  assert.equal(configuracion.sql.estaCompleta, true);
  const baseDatos = `sentinelia_fixture_52214a_${randomBytes(6).toString('hex')}`;
  const administrador = new ClienteSql(configuracion.sql);
  let sql;
  try {
    await administrador.ejecutar(
      `CREATE DATABASE ${administrador.escaparIdentificador(baseDatos)} ` +
      'CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci'
    );
    sql = new ClienteSql({ ...configuracion.sql, baseDatos });
    await migrar(sql);
    await verificarAbsorcionRollbackEIdempotencia(sql);
    await verificarMutacionConcurrente(sql);
    await verificarFotografiaVacia(sql);
  } finally {
    await sql?.cerrar().catch(() => {});
    await administrador.ejecutar(
      `DROP DATABASE IF EXISTS ${administrador.escaparIdentificador(baseDatos)}`
    ).catch(() => {});
    await administrador.cerrar();
  }
  console.log(
    '[federacion] OK 5.22.14a: corte=1..N cambios=N+1 ' +
    'previos=absorbidos concurrencia=serializada rollback=atomico replay=idempotente'
  );
}

async function verificarAbsorcionRollbackEIdempotencia(sql) {
  const ids = crearIds('monitores');
  await crearRelacion(sql, ids);
  const fuente = new FuenteReintentable([
    captura(ids, ids.ocurrenciaFotografiaId, 'estado-en-fotografia')
  ]);
  const entorno = crearEntorno(sql, ids, fuente);
  await preparar(entorno.servicio, ids);

  const cambioPrevio = await capturar(sql, entorno.adaptadorCaptura, {
    definicion: definicion(ids, ids.ocurrenciaCambioId, 'cambio-previo'),
    destinos: [destino(ids)]
  });
  assert.equal(cambioPrevio.posiciones[0].estado, 'pendienteCorte');
  assert.equal(cambioPrevio.posiciones[0].posicionFlujo, null);
  assert.equal(cambioPrevio.obligaciones.length, 0);
  assert.equal(await contar(sql, 'cambios_pendientes_corte_federacion', ids), 1);

  await assert.rejects(
    entorno.servicio.cerrar(ids),
    /fallo deliberado de la fuente/u
  );
  const trasRollback = await estadoCorte(sql, ids);
  assert.equal(trasRollback.estado, 'pendiente');
  assert.equal(trasRollback.frontera, null);
  assert.equal(await contar(sql, 'cambios_pendientes_corte_federacion', ids), 1);
  assert.equal(await contar(sql, 'posiciones_ocurrencias_flujos_federacion', ids), 0);

  const cierre = await entorno.servicio.cerrar(ids);
  assert.equal(cierre.estadoEjecucion, 'cerrado');
  assert.equal(cierre.fronteraInicial, '1');
  assert.equal(cierre.totalFotografia, '1');
  assert.equal(cierre.totalCambiosAbsorbidos, 1);
  assert.deepEqual(await posiciones(sql, ids), [
    ['1', 'fotografiaInicial', String(ids.ocurrenciaFotografiaId)]
  ]);
  assert.equal(await contarMarcas(sql, ids, 'absorbida'), 1);
  assert.equal(await contar(sql, 'outbox_federacion', ids), 1);
  assert.equal(await ocurrenciasSinPosicion(sql, ids), 1);

  const replay = await entorno.servicio.cerrar(ids);
  assert.equal(replay.estadoEjecucion, 'yaCerrado');
  assert.equal(replay.fronteraInicial, '1');
  assert.equal(replay.totalCambiosAbsorbidos, 1);
  assert.equal(fuente.llamadas, 2);
  assert.equal(await contar(sql, 'outbox_federacion', ids), 1);
  const replayCambio = await capturar(sql, entorno.adaptadorCaptura, {
    definicion: definicion(ids, ids.ocurrenciaCambioId, 'cambio-previo'),
    destinos: [destino(ids)]
  });
  assert.equal(replayCambio.estadoOcurrencia, 'yaConocida');
  assert.equal(replayCambio.posiciones[0].estado, 'absorbidaCorte');
  assert.equal(replayCambio.posiciones[0].posicionFlujo, null);
  assert.equal(replayCambio.obligaciones.length, 0);
  await assert.rejects(
    sql.ejecutar(
      `INSERT INTO cambios_pendientes_corte_federacion (
         flujo_id,generacion_id,installation_origen_id,familia,
         elemento_origen_id,ocurrencia_origen_id,prioridad,registrada_en_utc
       ) VALUES (?,?,?,?,?,?,?,UTC_TIMESTAMP(3))`,
      [
        ids.flujoId, ids.generacionId, ids.installationLocalId, ids.familia,
        String(ids.elementoOrigen), String(ids.ocurrenciaCambioId),
        'operativaActual'
      ]
    ),
    (error) => error.code === 'ER_SIGNAL_EXCEPTION'
  );
}

async function verificarMutacionConcurrente(sql) {
  const ids = crearIds('telemetria');
  await crearRelacion(sql, ids);
  const fuente = new FuentePausable([
    captura(ids, ids.ocurrenciaFotografiaId, 'base-concurrente')
  ]);
  const entorno = crearEntorno(sql, ids, fuente);
  await preparar(entorno.servicio, ids);

  const cierrePromesa = entorno.servicio.cerrar(ids);
  await fuente.esperarInicio();
  let mutacionResuelta = false;
  const mutacionPromesa = capturar(sql, entorno.adaptadorCaptura, {
    definicion: definicion(ids, ids.ocurrenciaCambioId, 'cambio-concurrente'),
    destinos: [destino(ids)]
  }).finally(() => { mutacionResuelta = true; });
  await demora(75);
  assert.equal(mutacionResuelta, false, 'La mutación no debe cruzar el corte abierto.');

  fuente.liberar();
  const [cierre, mutacion] = await Promise.all([cierrePromesa, mutacionPromesa]);
  assert.equal(cierre.fronteraInicial, '1');
  assert.equal(mutacion.posiciones[0].posicionFlujo, '2');
  assert.equal(mutacion.posiciones[0].clasePosicion, 'cambioPosterior');
  assert.equal(mutacion.obligaciones.length, 1);
  assert.deepEqual(await posiciones(sql, ids), [
    ['1', 'fotografiaInicial', String(ids.ocurrenciaFotografiaId)],
    ['2', 'cambioPosterior', String(ids.ocurrenciaCambioId)]
  ]);
  assert.equal(await contar(sql, 'outbox_federacion', ids), 2);
}

async function verificarFotografiaVacia(sql) {
  const ids = crearIds('triggersInformativos');
  await crearRelacion(sql, ids);
  const entorno = crearEntorno(sql, ids, {
    listarCapturasEnTransaccion: async () => []
  });
  await preparar(entorno.servicio, ids);
  await assert.rejects(
    sql.ejecutar(
      `UPDATE cortes_iniciales_generaciones_federacion
          SET estado='cerrado',frontera_inicial=4,version_corte=version_corte+1,
              cerrado_en_utc=UTC_TIMESTAMP(3),actualizado_en_utc=UTC_TIMESTAMP(3)
        WHERE flujo_id=? AND generacion_id=?`,
      [ids.flujoId, ids.generacionId]
    ),
    (error) => error.code === 'ER_SIGNAL_EXCEPTION'
  );
  const cierre = await entorno.servicio.cerrar(ids);
  assert.equal(cierre.fronteraInicial, '0');
  assert.equal(cierre.totalFotografia, '0');
  assert.equal((await estadoCorte(sql, ids)).fronteraGeneracion, '0');
  assert.equal(await contar(sql, 'posiciones_ocurrencias_flujos_federacion', ids), 0);
}

function crearEntorno(sql, ids, fuenteFotografia) {
  const repositorioFlujos = new RepositorioFlujosFederacionSql(sql, {
    installationLocalId: ids.installationLocalId
  });
  const repositorioOcurrencias = new RepositorioOcurrenciasFederacionSql(sql, {
    installationLocalId: ids.installationLocalId
  });
  const repositorioOutbox = new RepositorioOutboxFederacionSql(sql);
  const adaptadorCaptura = new AdaptadorCapturaTransaccionalFederacionSql({
    repositorioOcurrencias,
    repositorioOutbox
  });
  return {
    adaptadorCaptura,
    servicio: new ServicioCorteInicialGeneracionFederacion({
      clienteSql: sql,
      repositorioFlujos,
      repositorioOcurrencias,
      adaptadorCaptura,
      fuenteFotografia
    })
  };
}

async function preparar(servicio, ids) {
  return servicio.preparar({
    flujo: {
      flujoId: ids.flujoId,
      relacionId: ids.relacionId,
      direccion: 'emision',
      familia: ids.familia,
      versionFamilia: 1,
      contexto: { nivel: 'portal', tenantId: null, empresaId: null, sitioId: null }
    },
    generacion: {
      generacionId: ids.generacionId,
      clase: 'inicial',
      fronteraInicial: '0',
      propietario: {
        installationId: ids.installationLocalId,
        bootId: ids.bootId,
        version: 1
      }
    }
  });
}

async function capturar(sql, adaptadorCaptura, entrada) {
  return new FronteraTransaccionalLocal(sql).ejecutar(
    (conexion) => adaptadorCaptura.capturarEnTransaccion(entrada, { conexion })
  );
}

function captura(ids, ocurrenciaOrigenId, valor) {
  return {
    definicion: definicion(ids, ocurrenciaOrigenId, valor),
    prioridad: 'operativaActual'
  };
}

function definicion(ids, ocurrenciaOrigenId, valor) {
  return {
    familia: ids.familia,
    familiaVersion: 1,
    installationOrigenId: ids.installationLocal,
    elementoOrigenId: ids.elementoOrigen,
    ocurrenciaOrigenId,
    operacion: 'actualizacion',
    tiempoOrigenUtc: '2030-01-01T00:00:00.000Z',
    scopeOrigenDeclarado: {
      nivel: 'portal', tenantId: null, empresaId: null, sitioId: null
    },
    vigenciaRestanteMs: '300000',
    campos: {
      estado: crearCampoPresenteFederado({ valor })
    },
    evidenciaIntegridad: []
  };
}

function destino(ids) {
  return {
    flujoId: ids.flujoId,
    generacionId: ids.generacionId,
    prioridad: 'operativaActual'
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
      ids.relacionId,
      ids.installationRemotaId,
      ids.installationRemotaId,
      `fixture ${ids.familia}`,
      USUARIO_FIXTURE,
      USUARIO_FIXTURE,
      USUARIO_FIXTURE,
      ahora,
      ahora
    ]
  );
}

async function estadoCorte(sql, ids) {
  const [fila] = await sql.consultar(
    `SELECT c.estado,c.frontera_inicial,f.posicion_inicial_comprometida
       FROM cortes_iniciales_generaciones_federacion c
       JOIN fronteras_generaciones_federacion f
         ON f.generacion_id=c.generacion_id
      WHERE c.flujo_id=? AND c.generacion_id=?`,
    [ids.flujoId, ids.generacionId]
  );
  return {
    estado: fila.estado,
    frontera: fila.frontera_inicial === null ? null : String(fila.frontera_inicial),
    fronteraGeneracion: String(fila.posicion_inicial_comprometida)
  };
}

async function posiciones(sql, ids) {
  const filas = await sql.consultar(
    `SELECT posicion_flujo,clase_posicion,ocurrencia_origen_id
       FROM posiciones_ocurrencias_flujos_federacion
      WHERE flujo_id=? AND generacion_id=? ORDER BY posicion_flujo`,
    [ids.flujoId, ids.generacionId]
  );
  return filas.map((fila) => [
    String(fila.posicion_flujo), fila.clase_posicion, fila.ocurrencia_origen_id
  ]);
}

async function contar(sql, tabla, ids) {
  const tablas = new Set([
    'cambios_pendientes_corte_federacion',
    'posiciones_ocurrencias_flujos_federacion',
    'outbox_federacion'
  ]);
  assert.equal(tablas.has(tabla), true);
  const [fila] = await sql.consultar(
    `SELECT COUNT(*) AS total FROM ${tabla} WHERE flujo_id=? AND generacion_id=?`,
    [ids.flujoId, ids.generacionId]
  );
  return Number(fila.total);
}

async function ocurrenciasSinPosicion(sql, ids) {
  const [fila] = await sql.consultar(
    `SELECT COUNT(*) AS total
       FROM ocurrencias_federacion o
       LEFT JOIN posiciones_ocurrencias_flujos_federacion p
         ON p.installation_origen_id=o.installation_origen_id
        AND p.familia=o.familia
        AND p.elemento_origen_id=o.elemento_origen_id
        AND p.ocurrencia_origen_id=o.ocurrencia_origen_id
        AND p.flujo_id=? AND p.generacion_id=?
      WHERE o.installation_origen_id=? AND o.familia=? AND p.flujo_id IS NULL`,
    [ids.flujoId, ids.generacionId, ids.installationLocalId, ids.familia]
  );
  return Number(fila.total);
}

async function contarMarcas(sql, ids, estado) {
  const [fila] = await sql.consultar(
    `SELECT COUNT(*) AS total FROM cambios_pendientes_corte_federacion
      WHERE flujo_id=? AND generacion_id=? AND estado=?`,
    [ids.flujoId, ids.generacionId, estado]
  );
  return Number(fila.total);
}

class FuenteReintentable {
  constructor(capturas) {
    this.capturas = capturas;
    this.llamadas = 0;
  }

  async listarCapturasEnTransaccion(_destino, { conexion } = {}) {
    assert.equal(typeof conexion?.execute, 'function');
    this.llamadas += 1;
    if (this.llamadas === 1) throw new Error('fallo deliberado de la fuente');
    return this.capturas;
  }
}

class FuentePausable {
  constructor(capturas) {
    this.capturas = capturas;
    this.inicio = new Promise((resolve) => { this.confirmarInicio = resolve; });
    this.pausa = new Promise((resolve) => { this.liberarPausa = resolve; });
  }

  async listarCapturasEnTransaccion(_destino, { conexion } = {}) {
    assert.equal(typeof conexion?.execute, 'function');
    this.confirmarInicio();
    await this.pausa;
    return this.capturas;
  }

  esperarInicio() { return this.inicio; }
  liberar() { this.liberarPausa(); }
}

function crearIds(familia) {
  const generar = (tipo) => generador.generar(tipo);
  const installationLocal = generar(TIPOS_IDENTIDAD_FEDERADA.INSTALACION);
  return Object.freeze({
    familia,
    installationLocal,
    installationLocalId: String(installationLocal),
    installationRemotaId: String(generar(TIPOS_IDENTIDAD_FEDERADA.INSTALACION)),
    bootId: String(generar(TIPOS_IDENTIDAD_FEDERADA.ARRANQUE)),
    relacionId: String(generar(TIPOS_IDENTIDAD_FEDERADA.RELACION)),
    flujoId: String(generar(TIPOS_IDENTIDAD_FEDERADA.FLUJO)),
    generacionId: String(generar(TIPOS_IDENTIDAD_FEDERADA.GENERACION)),
    elementoOrigen: generar(TIPOS_IDENTIDAD_FEDERADA.ELEMENTO_ORIGEN),
    ocurrenciaFotografiaId: generar(TIPOS_IDENTIDAD_FEDERADA.OCURRENCIA_ORIGEN),
    ocurrenciaCambioId: generar(TIPOS_IDENTIDAD_FEDERADA.OCURRENCIA_ORIGEN)
  });
}

async function migrar(sql) {
  await new EjecutorMigraciones({
    clienteSql: sql,
    repositorioMigraciones: new RepositorioMigraciones(sql),
    rutaMigraciones: obtenerRutaMigraciones()
  }).ejecutarPendientes();
}

function demora(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}


await main();

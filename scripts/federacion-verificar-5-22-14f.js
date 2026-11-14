import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { readFile } from 'node:fs/promises';

import { FuenteEntropiaCriptograficaNode } from '../paquetes/federacion/adaptadores/FuenteEntropiaCriptograficaNode.js';
import { RepositorioContribucionesFederacionSql } from '../paquetes/federacion/adaptadores/RepositorioContribucionesFederacionSql.js';
import { RepositorioCursoresRecepcionFederacionSql } from '../paquetes/federacion/adaptadores/RepositorioCursoresRecepcionFederacionSql.js';
import { RepositorioEntregasFederacionSql } from '../paquetes/federacion/adaptadores/RepositorioEntregasFederacionSql.js';
import { RepositorioEstadoProyeccionesFederacionSql } from '../paquetes/federacion/adaptadores/RepositorioEstadoProyeccionesFederacionSql.js';
import { RepositorioFlujosFederacionSql } from '../paquetes/federacion/adaptadores/RepositorioFlujosFederacionSql.js';
import { RepositorioInboxFederacionSql } from '../paquetes/federacion/adaptadores/RepositorioInboxFederacionSql.js';
import { RepositorioMaterializacionFederacionSql } from '../paquetes/federacion/adaptadores/RepositorioMaterializacionFederacionSql.js';
import { RepositorioSoporteCamposFederacionSql } from '../paquetes/federacion/adaptadores/RepositorioSoporteCamposFederacionSql.js';
import { ServicioRecepcionLotesFederacionLocal } from '../paquetes/federacion/aplicacion/ServicioRecepcionLotesFederacionLocal.js';
import { crearCampoPresenteFederado } from '../paquetes/federacion/src/EnvolventeFederacion.js';
import {
  GeneradorIdentidadesFederadas,
  TIPOS_IDENTIDAD_FEDERADA
} from '../paquetes/federacion/src/IdentidadFederada.js';
import { ClienteSql } from '../paquetes/persistencia-sql/src/ClienteSql.js';
import {
  obtenerConfiguracionAplicacion
} from '../paquetes/utilidades/src/configuracion/obtenerConfiguracionAplicacion.js';
import {
  esErrorTerminalMaterializacion,
  ProcesadorMaterializacionFederacionRuntime
} from '../apps/sentinelia-runtime/src/federacion/ProcesadorMaterializacionFederacionRuntime.js';
import {
  crearIds,
  crearProtector,
  crearRelacion,
  crearRevision,
  migrar,
  ocurrencia
} from './federacion-verificar-5-22-14e.js';

const generador = new GeneradorIdentidadesFederadas({
  fuenteEntropia: new FuenteEntropiaCriptograficaNode()
});

await main();

async function main() {
  await verificarRegistro();
  verificarClasificacionErroresMaterializacion();
  await verificarBloqueoTerminalProcesador();
  const configuracion = obtenerConfiguracionAplicacion();
  assert.equal(configuracion.sql.estaCompleta, true);
  const baseDatos = `sentinelia_fixture_52214f_${randomBytes(6).toString('hex')}`;
  const administrador = new ClienteSql(configuracion.sql);
  let sql;
  try {
    await administrador.ejecutar(
      `CREATE DATABASE ${administrador.escaparIdentificador(baseDatos)} ` +
      'CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci'
    );
    sql = new ClienteSql({ ...configuracion.sql, baseDatos });
    await migrar(sql);
    await verificarDimensionesYSustitucion(sql);
  } finally {
    await sql?.cerrar().catch(() => {});
    await administrador.ejecutar(
      `DROP DATABASE IF EXISTS ${administrador.escaparIdentificador(baseDatos)}`
    ).catch(() => {});
    await administrador.cerrar();
  }
  console.log(
    '[federacion] OK 5.22.14f: dimensiones=ortogonales ack=durable ' +
    'cierre=booleano ' +
    'fallo_y_parcial=conservan_actual sustitucion=atomica fotografia=no_mezclada ' +
    'no_publicable=preserva_actual vista_funcional=atomica frontera=sin_futuro ' +
    'consolidado=solo_vigente ' +
    'reconsolidacion=tardia vigencia=no_renovable relevo=aislado'
  );
}

async function verificarBloqueoTerminalProcesador() {
  let bloqueada = null;
  let fallos = 0;
  const trabajo = {
    entregaId: 'entrega-fixture',
    inboxId: '1',
    familia: 'monitores',
    operacion: 'actualizacion',
    installationOrigenId: 'instalacion-fixture',
    elementoOrigenId: 'elemento-fixture',
    ocurrenciaOrigenId: 'ocurrencia-fixture',
    secuenciaElemento: '1',
    propietario: 'worker-fixture',
    fencingToken: '1',
    intentos: 1
  };
  const procesador = new ProcesadorMaterializacionFederacionRuntime({
    clienteSql: { obtenerConexion() { throw new Error('No debe abrir SQL.'); } },
    repositorioTrabajos: {
      async reclamarPendientes() { return [trabajo]; },
      async completarEnTransaccion() {},
      async fallar() { fallos += 1; },
      async bloquear(entrada) { bloqueada = entrada; }
    },
    repositorioInbox: {
      async obtenerOcurrenciaMaterializable() {
        return {
          familia: trabajo.familia,
          familiaVersion: 1,
          operacion: trabajo.operacion,
          installationOrigenId: trabajo.installationOrigenId,
          elementoOrigenId: trabajo.elementoOrigenId,
          ocurrenciaOrigenId: trabajo.ocurrenciaOrigenId,
          secuenciaElemento: trabajo.secuenciaElemento,
          campos: {
            monitores: { estado: 'presente', valor: { perfil: 'invalido' } }
          }
        };
      }
    },
    registroFamilias: {
      obtenerProductivo() {
        return {
          interfaces: {
            payload: {
              validarPayload() {
                const error = new Error('Payload terminal.');
                error.name = 'ErrorPayloadMonitoresFederacion';
                error.codigo = 'forma_payload_monitor_invalida';
                throw error;
              }
            }
          }
        };
      }
    },
    propietario: 'worker-fixture'
  });
  const resumen = await procesador.procesarPendientes();
  assert.equal(resumen.totalBloqueadas, 1);
  assert.equal(resumen.totalReintentables, 0);
  assert.equal(fallos, 0);
  assert.equal(bloqueada.errorCodigo, 'forma_payload_monitor_invalida');
}

function verificarClasificacionErroresMaterializacion() {
  assert.equal(esErrorTerminalMaterializacion({
    name: 'ErrorPayloadTelemetriaFederacion',
    codigo: 'forma_payload_telemetria_invalida'
  }), true);
  assert.equal(esErrorTerminalMaterializacion({
    name: 'ErrorMaterializacionFederacion',
    codigo: 'registro_trigger_remoto_divergente'
  }), true);
  assert.equal(esErrorTerminalMaterializacion({
    code: 'ER_LOCK_DEADLOCK'
  }), false);
}

async function verificarRegistro() {
  const [repositorio] = await Promise.all([
    leer('../paquetes/federacion/adaptadores/RepositorioEstadoProyeccionesFederacionSql.js')
  ]);
  assert.match(repositorio, /recepcion_no_confirmada/u);
  assert.match(repositorio, /publicarVersion/u);
}

async function verificarDimensionesYSustitucion(sql) {
  const ids = crearIds();
  const protector = crearProtector();
  const flujos = new RepositorioFlujosFederacionSql(sql, {
    installationLocalId: ids.installationLocalId
  });
  for (let indice = 0; indice < 2; indice += 1) {
    await crearRelacion(sql, ids, indice);
    await crearRevision(sql, ids, indice, ['nombre', 'estado']);
    await flujos.crearFlujoInicial({
      flujo: {
        flujoId: ids.flujos[indice],
        relacionId: ids.relaciones[indice],
        direccion: 'recepcion',
        familia: 'monitores',
        versionFamilia: 1,
        contexto: {
          nivel: 'empresa', tenantId: '10', empresaId: '20', sitioId: null
        }
      },
      generacion: {
        generacionId: ids.generaciones[indice],
        clase: 'inicial',
        fronteraInicial: '0',
        propietario: {
          installationId: ids.emisores[indice],
          bootId: ids.boots[indice],
          version: 1
        }
      }
    });
  }
  const estado = new RepositorioEstadoProyeccionesFederacionSql(sql);
  const soporte = new RepositorioSoporteCamposFederacionSql(sql, {
    protectorContenidoSensible: protector
  });
  const contribuciones = [...ids.contribucionesGeneradas];
  const materializacion = new RepositorioMaterializacionFederacionSql(sql, {
    generarProyeccionId: () => ids.proyeccionId,
    repositorioContribuciones: new RepositorioContribucionesFederacionSql(sql, {
      generarContribucionId: () => contribuciones.shift() || String(
        generador.generar(TIPOS_IDENTIDAD_FEDERADA.CONTRIBUCION)
      )
    }),
    repositorioSoporteCampos: soporte,
    repositorioEstadoProyecciones: estado
  });
  const servicio = new ServicioRecepcionLotesFederacionLocal({
    clienteSql: sql,
    repositorioEntregas: new RepositorioEntregasFederacionSql(sql),
    repositorioInbox: new RepositorioInboxFederacionSql(sql, {
      protectorContenidoSensible: protector
    }),
    repositorioCursores: new RepositorioCursoresRecepcionFederacionSql(sql),
    repositorioMaterializacion: materializacion,
    normalizadorVistas: soporte
  });

  const primera = await entregar(servicio, ids, {
    ruta: 0,
    entregaId: ids.entregas[0],
    ocurrenciaId: ids.ocurrencias[0],
    secuencia: '1',
    posicion: '1',
    nombre: 'Monitor generación uno',
    estado: true,
    vigenciaRestanteMs: null
  });
  assert.equal(primera.resultados[0].confirmada, true);
  let [trabajo] = await materializacion.reclamarPendientes({
    propietario: 'worker-14f-a', limite: 1, leaseMs: 30_000
  });
  const publicada1 = await materializacion.completar({
    entregaId: trabajo.entregaId,
    propietario: 'worker-14f-a',
    fencingToken: trabajo.fencingToken,
    requisitosPorCapacidad: requisitosCompletos(),
    cierreOperativoValidado: true
  });
  assert.equal(publicada1.estadoProyeccion.publicada, true);
  assert.equal(publicada1.estadoProyeccion.sustituyoGeneracionId, null);
  assert.equal((await estado.obtenerActual(ids.proyeccionId)).generacionId, ids.generaciones[0]);

  await entregar(servicio, ids, {
    ruta: 1,
    entregaId: ids.entregas[1],
    ocurrenciaId: ids.ocurrencias[1],
    secuencia: '2',
    posicion: '1',
    nombre: 'Monitor generación dos parcial',
    estado: false
  });
  [trabajo] = await materializacion.reclamarPendientes({
    propietario: 'worker-14f-b', limite: 1, leaseMs: 30_000
  });
  const fallida = await materializacion.fallar({
    entregaId: trabajo.entregaId,
    propietario: 'worker-14f-b',
    fencingToken: trabajo.fencingToken,
    errorCodigo: 'dependencia_temporal'
  });
  assert.equal(fallida.estadoProyeccion.publicada, false);
  assert.equal((await estado.obtenerActual(ids.proyeccionId)).generacionId, ids.generaciones[0]);
  [trabajo] = await materializacion.reclamarPendientes({
    propietario: 'worker-14f-c', limite: 1, leaseMs: 30_000
  });
  const parcial = await materializacion.completar({
    entregaId: trabajo.entregaId,
    propietario: 'worker-14f-c',
    fencingToken: trabajo.fencingToken,
    requisitosPorCapacidad: requisitosParciales(),
    cierreOperativoValidado: true
  });
  assert.equal(parcial.estadoProyeccion.publicada, false);
  assert.equal(parcial.estadoProyeccion.dimensiones.completitud.observable.estado, 'parcial');
  assert.equal((await estado.obtenerActual(ids.proyeccionId)).generacionId, ids.generaciones[0]);

  const ocurrenciaFinalId = String(generador.generar(
    TIPOS_IDENTIDAD_FEDERADA.OCURRENCIA_ORIGEN
  ));
  await entregar(servicio, ids, {
    ruta: 1,
    entregaId: ids.entregas[2],
    ocurrenciaId: ocurrenciaFinalId,
    secuencia: '3',
    posicion: '2',
    nombre: 'Monitor generación dos',
    estado: false
  });
  [trabajo] = await materializacion.reclamarPendientes({
    propietario: 'worker-14f-d', limite: 1, leaseMs: 30_000
  });
  const publicada2 = await materializacion.completar({
    entregaId: trabajo.entregaId,
    propietario: 'worker-14f-d',
    fencingToken: trabajo.fencingToken,
    requisitosPorCapacidad: requisitosCompletos(),
    cierreOperativoValidado: true
  });
  assert.equal(publicada2.estadoProyeccion.publicada, true);
  assert.equal(
    publicada2.estadoProyeccion.sustituyoGeneracionId,
    ids.generaciones[0]
  );
  const actual = await estado.obtenerActual(ids.proyeccionId);
  assert.deepEqual({
    generacionId: actual.generacionId,
    materializacion: actual.materializacion,
    vigencia: actual.vigencia,
    soporte: actual.soporte,
    autorizacion: actual.autorizacion,
    interpretable: actual.completitud.interpretable,
    observable: actual.completitud.observable,
    reconstruible: actual.completitud.reconstruible
  }, {
    generacionId: ids.generaciones[1],
    materializacion: 'materializada',
    vigencia: 'vigente',
    soporte: 'sostenida',
    autorizacion: 'autorizada',
    interpretable: 'completa',
    observable: 'completa',
    reconstruible: 'completa'
  });
  await entregar(servicio, ids, {
    ruta: 1,
    entregaId: ids.entregas[3],
    ocurrenciaId: String(generador.generar(
      TIPOS_IDENTIDAD_FEDERADA.OCURRENCIA_ORIGEN
    )),
    secuencia: '4',
    posicion: '3',
    nombre: 'Monitor generación dos actualizado',
    estado: true
  });
  [trabajo] = await materializacion.reclamarPendientes({
    propietario: 'worker-14f-e', limite: 1, leaseMs: 30_000
  });
  const republicada = await materializacion.completar({
    entregaId: trabajo.entregaId,
    propietario: 'worker-14f-e',
    fencingToken: trabajo.fencingToken,
    requisitosPorCapacidad: requisitosCompletos(),
    cierreOperativoValidado: true
  });
  assert.equal(republicada.estadoProyeccion.publicada, true);
  assert.equal(republicada.estadoProyeccion.sustituyoGeneracionId, null);
  assert.equal((await estado.obtenerActual(ids.proyeccionId)).versionPublicacion, '3');
  const entregaTardia = String(generador.generar(TIPOS_IDENTIDAD_FEDERADA.ENTREGA));
  const entregaNueva = String(generador.generar(TIPOS_IDENTIDAD_FEDERADA.ENTREGA));
  const entregaMasNueva = String(generador.generar(TIPOS_IDENTIDAD_FEDERADA.ENTREGA));
  const ocurrenciaTardiaId = String(generador.generar(
    TIPOS_IDENTIDAD_FEDERADA.OCURRENCIA_ORIGEN
  ));
  const recepcionTardia = await entregar(servicio, ids, {
    ruta: 1,
    entregaId: entregaTardia,
    ocurrenciaId: ocurrenciaTardiaId,
    secuencia: '5',
    posicion: '4',
    nombre: 'Monitor cierre tardío',
    estado: false
  });
  const recepcionNueva = await entregar(servicio, ids, {
    ruta: 1,
    entregaId: entregaNueva,
    ocurrenciaId: String(generador.generar(
      TIPOS_IDENTIDAD_FEDERADA.OCURRENCIA_ORIGEN
    )),
    secuencia: '6',
    posicion: '5',
    nombre: 'Monitor secuencia nueva',
    estado: true
  });
  const recepcionMasNueva = await entregar(servicio, ids, {
    ruta: 1,
    entregaId: entregaMasNueva,
    ocurrenciaId: String(generador.generar(
      TIPOS_IDENTIDAD_FEDERADA.OCURRENCIA_ORIGEN
    )),
    secuencia: '7',
    posicion: '6',
    nombre: 'Monitor secuencia más nueva',
    estado: false
  });
  assert.deepEqual(
    [
      recepcionTardia.resultados[0].resultado,
      recepcionNueva.resultados[0].resultado,
      recepcionMasNueva.resultados[0].resultado
    ],
    ['aceptada', 'aceptada', 'aceptada']
  );
  const concurrentes = await materializacion.reclamarPendientes({
    propietario: 'worker-14f-f', limite: 3, leaseMs: 30_000
  });
  const nuevo = concurrentes.find((item) => item.entregaId === entregaNueva);
  const tardio = concurrentes.find((item) => item.entregaId === entregaTardia);
  const masNuevo = concurrentes.find((item) => item.entregaId === entregaMasNueva);
  assert.ok(nuevo && tardio && masNuevo, JSON.stringify(concurrentes));
  await materializacion.completar({
    entregaId: tardio.entregaId,
    propietario: 'worker-14f-f',
    fencingToken: tardio.fencingToken,
    requisitosPorCapacidad: requisitosCompletos(),
    cierreOperativoValidado: true
  });
  assert.deepEqual(
    await leerCamposConsolidados(sql, ids.proyeccionId),
    new Map([['estado', false], ['nombre', 'Monitor cierre tardío']]),
    'Una frontera cerrada no puede incorporar soporte posterior aún pendiente.'
  );
  await materializacion.completar({
    entregaId: masNuevo.entregaId,
    propietario: 'worker-14f-f',
    fencingToken: masNuevo.fencingToken,
    requisitosPorCapacidad: requisitosCompletos(),
    cierreOperativoValidado: true
  });
  const ignorado = await materializacion.completar({
    entregaId: nuevo.entregaId,
    propietario: 'worker-14f-f',
    fencingToken: nuevo.fencingToken,
    requisitosPorCapacidad: requisitosCompletos(),
    cierreOperativoValidado: true
  });
  assert.equal(ignorado.estadoProyeccion.secuenciaObsoleta, true);
  assert.equal((await estado.obtenerActual(ids.proyeccionId)).versionPublicacion, '5');
  const consolidacionAntigua = await entregar(servicio, ids, {
    ruta: 0,
    entregaId: String(generador.generar(TIPOS_IDENTIDAD_FEDERADA.ENTREGA)),
    ocurrenciaId: ocurrenciaTardiaId,
    secuencia: '5',
    posicion: '2',
    nombre: 'Monitor cierre tardío',
    estado: false
  });
  assert.equal(consolidacionAntigua.resultados[0].resultado, 'yaConocida');
  [trabajo] = await materializacion.reclamarPendientes({
    propietario: 'worker-14f-f2', limite: 1, leaseMs: 30_000
  });
  assert.equal(trabajo.claseTrabajo, 'consolidacion');
  await materializacion.completar({
    entregaId: trabajo.entregaId,
    propietario: 'worker-14f-f2',
    fencingToken: trabajo.fencingToken,
    requisitosPorCapacidad: requisitosCompletos(),
    cierreOperativoValidado: true
  });
  const actualTrasConsolidacionAntigua = await estado.obtenerActual(
    ids.proyeccionId
  );
  assert.equal(actualTrasConsolidacionAntigua.ultimaSecuenciaCoherente, '7');
  assert.deepEqual(
    await leerCamposConsolidados(sql, ids.proyeccionId),
    new Map([['estado', false], ['nombre', 'Monitor secuencia más nueva']])
  );
  const versiones = await sql.consultar(
    `SELECT generacion_id,estado_publicacion
       FROM versiones_proyecciones_federacion
      WHERE proyeccion_id=? ORDER BY generacion_id`,
    [ids.proyeccionId]
  );
  assert.deepEqual(new Map(versiones.map((fila) => [
    fila.generacion_id, fila.estado_publicacion
  ])), new Map([
    [ids.generaciones[0], 'actual'],
    [ids.generaciones[1], 'preparando']
  ]));
  await assert.rejects(
    sql.ejecutar(
      `UPDATE campos_versiones_proyecciones_federacion
          SET total_soportes_activos=total_soportes_activos
        WHERE proyeccion_id=? AND generacion_id=?`,
      [ids.proyeccionId, ids.generaciones[0]]
    ),
    (error) => error.sqlState === '45000'
  );
  const camposActuales = await sql.consultar(
    `SELECT c.nombre_campo,d.declaracion_publica_canonica
       FROM estados_actuales_proyecciones_federacion e
       JOIN campos_versiones_proyecciones_federacion c
         ON c.proyeccion_id=e.proyeccion_id
        AND c.generacion_id=e.generacion_actual_id
       JOIN declaraciones_campos_inbox_federacion d
         ON d.id=c.declaracion_campo_id
      WHERE e.proyeccion_id=? ORDER BY c.nombre_campo`,
    [ids.proyeccionId]
  );
  assert.deepEqual(camposActuales.map((fila) => [
    fila.nombre_campo,
    deserializarJson(fila.declaracion_publica_canonica).valor
  ]), [['estado', false], ['nombre', 'Monitor secuencia más nueva']]);
  const [conteos] = await sql.consultar(
    `SELECT
       (SELECT COUNT(*) FROM estados_actuales_proyecciones_federacion
         WHERE proyeccion_id=?) AS actuales,
       (SELECT COUNT(*) FROM evaluaciones_dimensiones_proyecciones_federacion
         WHERE proyeccion_id=?) AS evaluaciones`,
    [ids.proyeccionId, ids.proyeccionId]
  );
  assert.equal(Number(conteos.actuales), 1);
  assert.equal(Number(conteos.evaluaciones), 9);
  await assert.rejects(
    sql.ejecutar(
      `UPDATE evaluaciones_dimensiones_proyecciones_federacion
          SET cierre_operativo_validado=FALSE WHERE proyeccion_id=? LIMIT 1`,
      [ids.proyeccionId]
    ),
    (error) => error.sqlState === '45000'
  );

  const ocurrenciaConsolidadaId = String(generador.generar(
    TIPOS_IDENTIDAD_FEDERADA.OCURRENCIA_ORIGEN
  ));
  const entregaConsolidadaA = String(generador.generar(
    TIPOS_IDENTIDAD_FEDERADA.ENTREGA
  ));
  await entregar(servicio, ids, {
    ruta: 0,
    entregaId: entregaConsolidadaA,
    ocurrenciaId: ocurrenciaConsolidadaId,
    secuencia: '8',
    posicion: '3',
    nombre: 'Monitor consolidado por dos rutas',
    estado: true
  });
  [trabajo] = await materializacion.reclamarPendientes({
    propietario: 'worker-14f-g', limite: 1, leaseMs: 30_000
  });
  await materializacion.completar({
    entregaId: trabajo.entregaId,
    propietario: 'worker-14f-g',
    fencingToken: trabajo.fencingToken,
    requisitosPorCapacidad: requisitosCompletos(),
    cierreOperativoValidado: true
  });
  const entregaConsolidadaB = String(generador.generar(
    TIPOS_IDENTIDAD_FEDERADA.ENTREGA
  ));
  const segundaRutaConsolidada = await entregar(servicio, ids, {
    ruta: 1,
    entregaId: entregaConsolidadaB,
    ocurrenciaId: ocurrenciaConsolidadaId,
    secuencia: '8',
    posicion: '7',
    nombre: 'Monitor consolidado por dos rutas',
    estado: true
  });
  assert.equal(segundaRutaConsolidada.resultados[0].resultado, 'yaConocida');
  [trabajo] = await materializacion.reclamarPendientes({
    propietario: 'worker-14f-h', limite: 1, leaseMs: 30_000
  });
  assert.equal(trabajo.claseTrabajo, 'consolidacion');
  const consolidada = await materializacion.completar({
    entregaId: trabajo.entregaId,
    propietario: 'worker-14f-h',
    fencingToken: trabajo.fencingToken,
    requisitosPorCapacidad: requisitosCompletos(),
    cierreOperativoValidado: true
  });
  assert.equal(consolidada.estadoProyeccion.publicada, true);
  assert.equal(
    (await estado.obtenerActual(ids.proyeccionId)).ultimaSecuenciaCoherente,
    '8'
  );
  const [soporteFotoConsolidada] = await sql.consultar(
    `SELECT total_soportes_activos
       FROM campos_versiones_proyecciones_federacion
      WHERE proyeccion_id=? AND generacion_id=? AND nombre_campo='estado'`,
    [ids.proyeccionId, ids.generaciones[1]]
  );
  assert.equal(Number(soporteFotoConsolidada.total_soportes_activos), 2);
  const [identidadesConsolidadas] = await sql.consultar(
    `SELECT
       (SELECT COUNT(*)
          FROM aplicaciones_ocurrencias_proyecciones_federacion a
          JOIN inbox_ocurrencias_federacion i ON i.id=a.inbox_ocurrencia_id
         WHERE a.proyeccion_id=? AND i.ocurrencia_origen_id=?) AS aplicaciones,
       (SELECT COUNT(*)
          FROM trabajos_materializacion_federacion t
         WHERE t.proyeccion_id=? AND t.ocurrencia_origen_id=?) AS trabajos`,
    [
      ids.proyeccionId,
      ocurrenciaConsolidadaId,
      ids.proyeccionId,
      ocurrenciaConsolidadaId
    ]
  );
  assert.deepEqual({
    aplicaciones: Number(identidadesConsolidadas.aplicaciones),
    trabajos: Number(identidadesConsolidadas.trabajos)
  }, { aplicaciones: 1, trabajos: 2 });

  const ocurrenciaVencidaId = String(generador.generar(
    TIPOS_IDENTIDAD_FEDERADA.OCURRENCIA_ORIGEN
  ));
  const entregaVencidaA = String(generador.generar(TIPOS_IDENTIDAD_FEDERADA.ENTREGA));
  await entregar(servicio, ids, {
    ruta: 0,
    entregaId: entregaVencidaA,
    ocurrenciaId: ocurrenciaVencidaId,
    secuencia: '9',
    posicion: '4',
    nombre: 'Monitor vencido',
    estado: false,
    vigenciaRestanteMs: '0'
  });
  const consolidadosConRutaVencida = await leerCamposConsolidados(
    sql,
    ids.proyeccionId
  );
  assert.notEqual(
    consolidadosConRutaVencida.get('nombre'),
    'Monitor vencido',
    'La vista funcional no puede elegir el soporte de una ocurrencia ya vencida.'
  );
  [trabajo] = await materializacion.reclamarPendientes({
    propietario: 'worker-14f-i', limite: 1, leaseMs: 30_000
  });
  await materializacion.completar({
    entregaId: trabajo.entregaId,
    propietario: 'worker-14f-i',
    fencingToken: trabajo.fencingToken,
    requisitosPorCapacidad: requisitosCompletos(),
    cierreOperativoValidado: true
  });
  const entregaVencidaB = String(generador.generar(TIPOS_IDENTIDAD_FEDERADA.ENTREGA));
  await entregar(servicio, ids, {
    ruta: 1,
    entregaId: entregaVencidaB,
    ocurrenciaId: ocurrenciaVencidaId,
    secuencia: '9',
    posicion: '8',
    nombre: 'Monitor vencido',
    estado: false,
    vigenciaRestanteMs: '0'
  });
  [trabajo] = await materializacion.reclamarPendientes({
    propietario: 'worker-14f-j', limite: 1, leaseMs: 30_000
  });
  const vencida = await materializacion.completar({
    entregaId: trabajo.entregaId,
    propietario: 'worker-14f-j',
    fencingToken: trabajo.fencingToken,
    requisitosPorCapacidad: requisitosCompletos(),
    cierreOperativoValidado: true
  });
  assert.equal(vencida.estadoProyeccion.dimensiones.vigencia, 'vencida');
  assert.equal(vencida.estadoProyeccion.despublicada, true);
  assert.equal(await estado.obtenerActual(ids.proyeccionId), null);
  assert.equal((await leerCamposConsolidados(sql, ids.proyeccionId)).size, 0);
  const [ultimaFronteraVigente] = await sql.consultar(
    `SELECT secuencia_elemento,estado_vigencia
       FROM fronteras_coherentes_proyecciones_federacion
      WHERE proyeccion_id=?
      ORDER BY secuencia_elemento DESC,id DESC LIMIT 1`,
    [ids.proyeccionId]
  );
  assert.deepEqual({
    secuencia: String(ultimaFronteraVigente.secuencia_elemento),
    vigencia: ultimaFronteraVigente.estado_vigencia
  }, { secuencia: '9', vigencia: 'vigente' });
  const [contadorTrasVencer] = await sql.consultar(
    `SELECT ultima_version_publicacion
       FROM contadores_publicacion_proyecciones_federacion
      WHERE proyeccion_id=?`,
    [ids.proyeccionId]
  );

  const [aporteAntesReplay] = await sql.consultar(
    `SELECT a.vigencia_restante_recepcion_ms,a.primera_observacion_utc,
            a.ultima_entrega_id
       FROM aportes_ocurrencias_contribuciones_federacion a
       JOIN inbox_ocurrencias_federacion i ON i.id=a.inbox_ocurrencia_id
      WHERE a.contribucion_id=? AND a.generacion_id=?
        AND i.ocurrencia_origen_id=?`,
    [ids.contribucionesReales[1], ids.generaciones[1], ocurrenciaVencidaId]
  );
  const entregaReplay = String(generador.generar(TIPOS_IDENTIDAD_FEDERADA.ENTREGA));
  await entregar(servicio, ids, {
    ruta: 1,
    entregaId: entregaReplay,
    ocurrenciaId: ocurrenciaVencidaId,
    secuencia: '9',
    posicion: '9',
    nombre: 'Monitor vencido',
    estado: false,
    vigenciaRestanteMs: '0'
  });
  const [aporteTrasReplay] = await sql.consultar(
    `SELECT a.vigencia_restante_recepcion_ms,a.primera_observacion_utc,
            a.ultima_entrega_id
       FROM aportes_ocurrencias_contribuciones_federacion a
       JOIN inbox_ocurrencias_federacion i ON i.id=a.inbox_ocurrencia_id
      WHERE a.contribucion_id=? AND a.generacion_id=?
        AND i.ocurrencia_origen_id=?`,
    [ids.contribucionesReales[1], ids.generaciones[1], ocurrenciaVencidaId]
  );
  assert.equal(String(aporteAntesReplay.vigencia_restante_recepcion_ms), '0');
  assert.equal(
    new Date(aporteTrasReplay.primera_observacion_utc).getTime(),
    new Date(aporteAntesReplay.primera_observacion_utc).getTime()
  );
  assert.equal(aporteTrasReplay.ultima_entrega_id, entregaReplay);
  assert.notEqual(aporteTrasReplay.ultima_entrega_id, aporteAntesReplay.ultima_entrega_id);
  assert.deepEqual(await materializacion.reclamarPendientes({
    propietario: 'worker-14f-k', limite: 1, leaseMs: 30_000
  }), []);

  const entregaRecuperada = String(generador.generar(TIPOS_IDENTIDAD_FEDERADA.ENTREGA));
  await entregar(servicio, ids, {
    ruta: 0,
    entregaId: entregaRecuperada,
    ocurrenciaId: String(generador.generar(
      TIPOS_IDENTIDAD_FEDERADA.OCURRENCIA_ORIGEN
    )),
    secuencia: '10',
    posicion: '5',
    nombre: 'Monitor recuperado',
    estado: true
  });
  [trabajo] = await materializacion.reclamarPendientes({
    propietario: 'worker-14f-l', limite: 1, leaseMs: 30_000
  });
  await materializacion.completar({
    entregaId: trabajo.entregaId,
    propietario: 'worker-14f-l',
    fencingToken: trabajo.fencingToken,
    requisitosPorCapacidad: requisitosCompletos(),
    cierreOperativoValidado: true
  });
  const recuperada = await estado.obtenerActual(ids.proyeccionId);
  assert.equal(recuperada.ultimaSecuenciaCoherente, '10');
  assert.ok(
    BigInt(recuperada.versionPublicacion) >
      BigInt(contadorTrasVencer.ultima_version_publicacion)
  );

  const actualAntesNoPublicable = await estado.obtenerActual(ids.proyeccionId);
  const camposAntesNoPublicable = await leerCamposConsolidados(
    sql,
    ids.proyeccionId
  );
  const entregaNoPublicable = String(generador.generar(
    TIPOS_IDENTIDAD_FEDERADA.ENTREGA
  ));
  await entregar(servicio, ids, {
    ruta: 0,
    entregaId: entregaNoPublicable,
    ocurrenciaId: String(generador.generar(
      TIPOS_IDENTIDAD_FEDERADA.OCURRENCIA_ORIGEN
    )),
    secuencia: '11',
    posicion: '6',
    nombre: 'Monitor no publicable',
    estado: false
  });
  assert.deepEqual(
    await leerCamposConsolidados(sql, ids.proyeccionId),
    camposAntesNoPublicable,
    'La recepción no puede adelantar la vista funcional antes del cierre.'
  );
  [trabajo] = await materializacion.reclamarPendientes({
    propietario: 'worker-14f-m', limite: 1, leaseMs: 30_000
  });
  await assert.rejects(
    materializacion.completar({
      entregaId: trabajo.entregaId,
      propietario: 'worker-14f-m',
      fencingToken: trabajo.fencingToken,
      requisitosPorCapacidad: requisitosCompletos(),
      cierreOperativoValidado: 'false'
    }),
    (error) => error.codigo === 'cierre_operativo_invalido'
  );
  const falloSobreActual = await materializacion.fallar({
    entregaId: trabajo.entregaId,
    propietario: 'worker-14f-m',
    fencingToken: trabajo.fencingToken,
    errorCodigo: 'fallo_sobre_version_actual'
  });
  assert.equal(falloSobreActual.estadoProyeccion.publicada, false);
  assert.deepEqual(await estado.obtenerActual(ids.proyeccionId), actualAntesNoPublicable);
  assert.deepEqual(
    await leerCamposConsolidados(sql, ids.proyeccionId),
    camposAntesNoPublicable
  );
  [trabajo] = await materializacion.reclamarPendientes({
    propietario: 'worker-14f-n', limite: 1, leaseMs: 30_000
  });
  const parcialSobreActual = await materializacion.completar({
    entregaId: trabajo.entregaId,
    propietario: 'worker-14f-n',
    fencingToken: trabajo.fencingToken,
    requisitosPorCapacidad: requisitosParciales(),
    cierreOperativoValidado: true
  });
  assert.equal(parcialSobreActual.estadoProyeccion.publicada, false);
  assert.deepEqual(await estado.obtenerActual(ids.proyeccionId), actualAntesNoPublicable);
  assert.deepEqual(
    await leerCamposConsolidados(sql, ids.proyeccionId),
    camposAntesNoPublicable
  );

  const generacionRelevoId = String(generador.generar(
    TIPOS_IDENTIDAD_FEDERADA.GENERACION
  ));
  const ahoraRelevo = new Date();
  await sql.ejecutar(
    `INSERT INTO generaciones_flujos_federacion (
       generacion_id,flujo_id,ordinal,clase,estado,rol_generacion,
       generacion_predecesora_id,estrategia_candidata,requiere_revalidacion,
       installation_propietaria_id,boot_propietario_id,version_propietario,
       version_estado,version_registro,creada_en_utc,actualizada_en_utc,
       finalizada_en_utc
     ) VALUES (
       ?,?,2,'resincronizacion','completa','candidata',?,'coexistir',FALSE,
       ?,?,1,1,1,?,?,NULL
     )`,
    [
      generacionRelevoId,
      ids.flujos[0],
      ids.generaciones[0],
      ids.emisores[0],
      ids.boots[0],
      ahoraRelevo,
      ahoraRelevo
    ]
  );
  await sql.ejecutar(
    `INSERT INTO fronteras_generaciones_federacion (
       generacion_id,posicion_inicial_comprometida,
       posicion_operativa_validada,posicion_historica_validada,
       sincronizando,operativamente_completa,historicamente_completa,
       parcial_por_scope,degradada,version_frontera,actualizada_en_utc
     ) VALUES (?,1,1,1,FALSE,TRUE,TRUE,FALSE,FALSE,1,?)`,
    [generacionRelevoId, ahoraRelevo]
  );
  const conexionRelevo = await sql.obtenerConexion();
  try {
    await conexionRelevo.beginTransaction();
    await conexionRelevo.execute(
      `UPDATE generaciones_flujos_federacion
          SET estado='sustituida',rol_generacion='historica',
              version_estado=version_estado+1,
              version_registro=version_registro+1,
              actualizada_en_utc=?,finalizada_en_utc=?
        WHERE flujo_id=? AND generacion_id=? AND rol_generacion='activa'`,
      [ahoraRelevo, ahoraRelevo, ids.flujos[0], ids.generaciones[0]]
    );
    await conexionRelevo.execute(
      `UPDATE generaciones_flujos_federacion
          SET rol_generacion='activa',version_estado=version_estado+1,
              version_registro=version_registro+1,actualizada_en_utc=?
        WHERE flujo_id=? AND generacion_id=? AND rol_generacion='candidata'`,
      [ahoraRelevo, ids.flujos[0], generacionRelevoId]
    );
    await conexionRelevo.execute(
      `UPDATE flujos_federacion
          SET generacion_activa_id=?,version_estado=version_estado+1,
              version_registro=version_registro+1,actualizada_en_utc=?
        WHERE flujo_id=? AND generacion_activa_id=?`,
      [
        generacionRelevoId,
        ahoraRelevo,
        ids.flujos[0],
        ids.generaciones[0]
      ]
    );
    await conexionRelevo.commit();
  } catch (error) {
    await conexionRelevo.rollback().catch(() => {});
    throw error;
  } finally {
    conexionRelevo.release();
  }
  const entregaRelevo = String(generador.generar(TIPOS_IDENTIDAD_FEDERADA.ENTREGA));
  await entregar(servicio, ids, {
    ruta: 0,
    generacionId: generacionRelevoId,
    entregaId: entregaRelevo,
    ocurrenciaId: String(generador.generar(
      TIPOS_IDENTIDAD_FEDERADA.OCURRENCIA_ORIGEN
    )),
    secuencia: '12',
    posicion: '1',
    nombre: 'Monitor tras relevo generacional',
    estado: false
  });
  assert.equal(
    (await estado.obtenerActual(ids.proyeccionId)).generacionId,
    ids.generaciones[0],
    'La nueva generación no gobierna antes de cerrar su materialización.'
  );
  [trabajo] = await materializacion.reclamarPendientes({
    propietario: 'worker-14f-o', limite: 1, leaseMs: 30_000
  });
  assert.equal(trabajo.generacionId, generacionRelevoId);
  await materializacion.completar({
    entregaId: trabajo.entregaId,
    propietario: 'worker-14f-o',
    fencingToken: trabajo.fencingToken,
    requisitosPorCapacidad: requisitosCompletos(),
    cierreOperativoValidado: true
  });
  const actualTrasRelevo = await estado.obtenerActual(ids.proyeccionId);
  assert.equal(actualTrasRelevo.generacionId, generacionRelevoId);
  assert.equal(actualTrasRelevo.ultimaSecuenciaCoherente, '12');
  const generacionesSoporte = await sql.consultar(
    `SELECT DISTINCT generacion_id
       FROM soportes_campos_contribuciones_federacion
      WHERE contribucion_id=? ORDER BY generacion_id`,
    [ids.contribucionesReales[0]]
  );
  assert.deepEqual(
    new Set(generacionesSoporte.map((fila) => fila.generacion_id)),
    new Set([ids.generaciones[0], generacionRelevoId])
  );
  const [campoTrasRelevo] = await sql.consultar(
    `SELECT d.declaracion_publica_canonica
       FROM estados_actuales_proyecciones_federacion e
       JOIN campos_versiones_proyecciones_federacion c
         ON c.proyeccion_id=e.proyeccion_id
        AND c.generacion_id=e.generacion_actual_id
       JOIN declaraciones_campos_inbox_federacion d
         ON d.id=c.declaracion_campo_id
      WHERE e.proyeccion_id=? AND c.nombre_campo='nombre'`,
    [ids.proyeccionId]
  );
  assert.equal(
    deserializarJson(campoTrasRelevo.declaracion_publica_canonica).valor,
    'Monitor tras relevo generacional'
  );
}

async function entregar(servicio, ids, {
  ruta,
  entregaId,
  ocurrenciaId,
  secuencia,
  posicion,
  nombre,
  estado,
  vigenciaRestanteMs = '300000',
  generacionId = ids.generaciones[ruta]
}) {
  const loteId = String(generador.generar(TIPOS_IDENTIDAD_FEDERADA.LOTE));
  return servicio.entregarLote({
    loteId,
    relacionId: ids.relaciones[ruta],
    flujoId: ids.flujos[ruta],
    generacionId,
    revisionConcesionEfectiva: ids.revisiones[ruta],
    entregas: [{
      entregaId,
      posicionFlujo: posicion,
      ocurrencia: {
        ...ocurrencia(ids, {
        ocurrenciaOrigenId: ocurrenciaId,
        secuenciaElemento: secuencia
      }, {
        nombre: crearCampoPresenteFederado({ valor: nombre }),
        estado: crearCampoPresenteFederado({ valor: estado })
        }),
        vigenciaRestanteMs
      },
      procedencia: {
        installationEmisoraId: ids.emisores[ruta],
        bootEmisorId: ids.boots[ruta],
        recorridoInstalaciones: ruta === 0
          ? [ids.installationOrigenId]
          : [ids.installationOrigenId, ids.emisores[ruta]],
        tiemposSaltosDisponibles: [{
          installationId: ids.emisores[ruta],
          bootId: ids.boots[ruta],
          recibidoUtc: null,
          emitidoUtc: '2030-01-01T00:00:02.000Z'
        }]
      }
    }]
  });
}

async function leerCamposConsolidados(sql, proyeccionId) {
  const filas = await sql.consultar(
    `SELECT c.nombre_campo,d.declaracion_publica_canonica
       FROM campos_consolidados_proyecciones_federacion c
       JOIN declaraciones_campos_inbox_federacion d
         ON d.id=c.declaracion_campo_id
      WHERE c.proyeccion_id=?`,
    [proyeccionId]
  );
  return new Map(filas.map((fila) => [
    fila.nombre_campo,
    deserializarJson(fila.declaracion_publica_canonica).valor
  ]));
}

function requisitosCompletos() {
  return {
    interpretable: [requisito('definicion', 'cumplido')],
    observable: [requisito('estadoActual', 'cumplido')],
    reconstruible: [requisito('configuracion', 'cumplido')]
  };
}

function requisitosParciales() {
  return {
    interpretable: [requisito('definicion', 'cumplido')],
    observable: [requisito('estadoActual', 'faltante', 'dependenciaPendiente')],
    reconstruible: [requisito('configuracion', 'faltante', 'historicoPendiente')]
  };
}

function requisito(id, estado, causa = null) {
  return { id, estado, causa };
}

async function leer(ruta) {
  return readFile(new URL(ruta, import.meta.url), 'utf8');
}

function deserializarJson(valor) {
  return typeof valor === 'string' ? JSON.parse(valor) : valor;
}

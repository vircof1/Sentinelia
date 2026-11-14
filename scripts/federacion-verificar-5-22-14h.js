import assert from 'node:assert/strict';
import { createHash, randomBytes } from 'node:crypto';

import { FuenteEntropiaCriptograficaNode } from '../paquetes/federacion/adaptadores/FuenteEntropiaCriptograficaNode.js';
import { RepositorioContribucionesFederacionSql } from '../paquetes/federacion/adaptadores/RepositorioContribucionesFederacionSql.js';
import { RepositorioFlujosFederacionSql } from '../paquetes/federacion/adaptadores/RepositorioFlujosFederacionSql.js';
import { RepositorioInboxFederacionSql } from '../paquetes/federacion/adaptadores/RepositorioInboxFederacionSql.js';
import { RepositorioMaterializacionFederacionSql } from '../paquetes/federacion/adaptadores/RepositorioMaterializacionFederacionSql.js';
import { RepositorioSoporteCamposFederacionSql } from '../paquetes/federacion/adaptadores/RepositorioSoporteCamposFederacionSql.js';
import { ServicioConflictosIdentidadFederacion } from '../paquetes/federacion/aplicacion/ServicioConflictosIdentidadFederacion.js';
import { canonicalizarJsonFederacion } from '../paquetes/federacion/src/CanonicalizadorFederacion.js';
import {
  crearCampoPresenteFederado,
  exigirDestinoNoVisitadoFederacion
} from '../paquetes/federacion/src/EnvolventeFederacion.js';
import { crearFixtureEnvolventeFederacion } from '../paquetes/federacion/fixtures/ContratoFederacionFixtures.js';
import {
  GeneradorIdentidadesFederadas,
  TIPOS_IDENTIDAD_FEDERADA,
  crearIdentidadFederada
} from '../paquetes/federacion/src/IdentidadFederada.js';
import { separarContenidoSensibleFederacion } from '../paquetes/federacion/src/SeparacionContenidoSensibleFederacion.js';
import { ClienteSql } from '../paquetes/persistencia-sql/src/ClienteSql.js';
import {
  obtenerConfiguracionAplicacion
} from '../paquetes/utilidades/src/configuracion/obtenerConfiguracionAplicacion.js';
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
  await verificarRegistroYRetorno();
  const configuracion = obtenerConfiguracionAplicacion();
  assert.equal(configuracion.sql.estaCompleta, true);
  const baseDatos = `sentinelia_fixture_52214h_${randomBytes(6).toString('hex')}`;
  const administrador = new ClienteSql(configuracion.sql);
  let sql;
  try {
    await administrador.ejecutar(
      `CREATE DATABASE ${administrador.escaparIdentificador(baseDatos)} ` +
      'CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci'
    );
    sql = new ClienteSql({ ...configuracion.sql, baseDatos });
    await migrar(sql);
    await verificarCuadradoRetiradaYNoResurreccion(sql);
    await verificarRestauracionIncoherente();
  } finally {
    await sql?.cerrar().catch(() => {});
    await administrador.ejecutar(
      `DROP DATABASE IF EXISTS ${administrador.escaparIdentificador(baseDatos)}`
    ).catch(() => {});
    await administrador.cerrar();
  }
  console.log(
    '[federacion] OK 5.22.14h: recorrido=sin_maximo retorno=suprimido ' +
    'cuadrado=consolidado salida=contribucion retirada=origen_global ' +
    'restauracion_incoherente=detenida resurreccion=imposible ' +
    'terminales=prioridad_operativa'
  );
}

async function verificarRegistroYRetorno() {
  const envolvente = crearFixtureEnvolventeFederacion({
    instalacionesEnRecorrido: 64
  });
  const recorrido = envolvente.toJSON().recorridoInstalaciones;
  assert.equal(recorrido.length, 64);
  assert.throws(
    () => exigirDestinoNoVisitadoFederacion({
      envolvente,
      installationDestinoId: crearIdentidadFederada({
        tipo: TIPOS_IDENTIDAD_FEDERADA.INSTALACION,
        valor: recorrido[0]
      })
    }),
    (error) => error.codigo === 'recorrido_ciclico_destino'
  );
}

async function verificarCuadradoRetiradaYNoResurreccion(sql) {
  const ids = crearIds();
  const protector = crearProtector();
  const flujos = new RepositorioFlujosFederacionSql(sql, {
    installationLocalId: ids.installationLocalId
  });
  for (let ruta = 0; ruta < 2; ruta += 1) {
    await crearRelacion(sql, ids, ruta);
    await crearRevision(sql, ids, ruta, ['nombre', 'estado']);
    await flujos.crearFlujoInicial({
      flujo: {
        flujoId: ids.flujos[ruta],
        relacionId: ids.relaciones[ruta],
        direccion: 'recepcion',
        familia: 'monitores',
        versionFamilia: 1,
        contexto: {
          nivel: 'empresa', tenantId: '10', empresaId: '20', sitioId: null
        }
      },
      generacion: {
        generacionId: ids.generaciones[ruta],
        clase: 'inicial',
        fronteraInicial: '0',
        propietario: {
          installationId: ids.emisores[ruta],
          bootId: ids.boots[ruta],
          version: 1
        }
      }
    });
  }
  const proyecciones = [
    ids.proyeccionId,
    String(generador.generar(TIPOS_IDENTIDAD_FEDERADA.PROYECCION))
  ];
  const contribucionesDisponibles = [
    ...ids.contribucionesGeneradas,
    ...Array.from({ length: 8 }, () =>
      String(generador.generar(TIPOS_IDENTIDAD_FEDERADA.CONTRIBUCION)))
  ];
  const soporte = new RepositorioSoporteCamposFederacionSql(sql, {
    protectorContenidoSensible: protector
  });
  const materializacion = new RepositorioMaterializacionFederacionSql(sql, {
    generarProyeccionId: () => proyecciones.shift(),
    repositorioContribuciones: new RepositorioContribucionesFederacionSql(sql, {
      generarContribucionId: () => contribucionesDisponibles.shift()
    }),
    repositorioSoporteCampos: soporte
  });
  const inbox = new RepositorioInboxFederacionSql(sql, {
    protectorContenidoSensible: protector
  });
  const ocurrencias = Array.from({ length: 7 }, () =>
    String(generador.generar(TIPOS_IDENTIDAD_FEDERADA.OCURRENCIA_ORIGEN)));
  const entregas = Array.from({ length: 8 }, () =>
    String(generador.generar(TIPOS_IDENTIDAD_FEDERADA.ENTREGA)));

  const inicial = actualizar(ids, ocurrencias[0], '1', 'cuadrado');
  await recibir({
    sql, inbox, materializacion, soporte, ids, ruta: 0,
    entregaId: entregas[0], posicion: '1', vista: inicial
  });
  const segundaRuta = await recibir({
    sql, inbox, materializacion, soporte, ids, ruta: 1,
    entregaId: entregas[1], posicion: '1', vista: inicial
  });
  assert.equal(segundaRuta.inbox.codigo, 'yaConocida');
  assert.equal(segundaRuta.trabajo.aplicacionNueva, false);
  assert.equal(await soportesCampo(sql, ids.proyeccionId, 'estado'), 2);

  const salida = sinCampos(ids, ocurrencias[1], '2', 'salidaProyeccion');
  const salidaRecibida = await recibir({
    sql, inbox, materializacion, soporte, ids, ruta: 0,
    entregaId: entregas[2], posicion: '2', vista: salida
  });
  assert.equal((await prioridadTrabajo(sql, salidaRecibida.trabajo.entregaId)),
    'operativaActual');
  assert.equal(await soportesCampo(sql, ids.proyeccionId, 'estado'), 1);
  assert.equal(Number((await sql.consultar(
    'SELECT COUNT(*) AS total FROM retiradas_origen_proyecciones_federacion'
  ))[0].total), 0);

  const reaperturaIlegitima = await recibir({
    sql, inbox, materializacion, soporte, ids, ruta: 0,
    entregaId: entregas[3], posicion: '3',
    vista: actualizar(ids, ocurrencias[2], '3', 'no debe reaparecer')
  });
  assert.equal(reaperturaIlegitima.trabajo.estado, 'suprimida');
  assert.equal(reaperturaIlegitima.trabajo.causaSupresion, 'salidaProyeccion');
  assert.equal(await soportesCampo(sql, ids.proyeccionId, 'estado'), 1);

  const retirada = sinCampos(ids, ocurrencias[3], '4', 'retirada');
  const retiradaRecibida = await recibir({
    sql, inbox, materializacion, soporte, ids, ruta: 1,
    entregaId: entregas[4], posicion: '2', vista: retirada
  });
  assert.equal((await prioridadTrabajo(sql, retiradaRecibida.trabajo.entregaId)),
    'operativaActual');
  assert.equal(await totalCampos(sql, ids.proyeccionId), 0);
  const [contribucionesRetiradas] = await sql.consultar(
    `SELECT COUNT(*) AS total
       FROM contribuciones_proyecciones_federacion
      WHERE proyeccion_id=? AND estado_soporte='retirada'`,
    [ids.proyeccionId]
  );
  assert.equal(Number(contribucionesRetiradas.total), 2);

  const tardiaOtraRuta = await recibir({
    sql, inbox, materializacion, soporte, ids, ruta: 0,
    entregaId: entregas[5], posicion: '4',
    vista: actualizar(ids, ocurrencias[4], '5', 'resurreccion prohibida')
  });
  assert.equal(tardiaOtraRuta.trabajo.estado, 'suprimida');
  assert.equal(tardiaOtraRuta.trabajo.causaSupresion, 'retiradaOrigen');
  assert.equal(await totalCampos(sql, ids.proyeccionId), 0);

  const idsRecreado = {
    ...ids,
    elementoOrigenId: String(
      generador.generar(TIPOS_IDENTIDAD_FEDERADA.ELEMENTO_ORIGEN)
    )
  };
  const recreado = await recibir({
    sql, inbox, materializacion, soporte, ids: idsRecreado, ruta: 1,
    entregaId: entregas[6], posicion: '3',
    vista: actualizar(idsRecreado, ocurrencias[5], '1', 'identidad nueva')
  });
  assert.equal(recreado.trabajo.estado, 'pendiente');
  assert.notEqual(recreado.trabajo.proyeccionId, ids.proyeccionId);
  assert.equal(await soportesCampo(sql, recreado.trabajo.proyeccionId, 'estado'), 1);
}

async function verificarRestauracionIncoherente() {
  const installationId = String(
    generador.generar(TIPOS_IDENTIDAD_FEDERADA.INSTALACION)
  );
  const relaciones = Array.from({ length: 2 }, () =>
    String(generador.generar(TIPOS_IDENTIDAD_FEDERADA.RELACION)));
  const boots = Array.from({ length: 2 }, () =>
    String(generador.generar(TIPOS_IDENTIDAD_FEDERADA.ARRANQUE)));
  const revocadas = [];
  let observada;
  const servicio = new ServicioConflictosIdentidadFederacion({
    reloj: () => Date.parse('2030-01-01T00:10:00.000Z'),
    repositorio: {
      observar: async (entrada) => {
        observada = entrada;
        return {
          estado: entrada.confirmar ? 'conflicto_confirmado' : 'sospecha',
          relacionesCuarentena: entrada.confirmar ? relaciones : []
        };
      },
      resolver: async () => ({ relacionesClon: [] })
    },
    repositorioSesionesRedis: {
      revocar: async (relacionId) => revocadas.push(relacionId)
    }
  });
  const resultado = await servicio.observar({
    installationRemotaId: installationId,
    consolidacionReinicioMs: 60_000,
    presencias: relaciones.map((relacionId, indice) => ({
      relacionId,
      bootRemotoId: boots[indice],
      primeroObservadoEnUtc: '2030-01-01T00:00:00.000Z',
      fencingToken: '1'
    }))
  });
  assert.equal(observada.confirmar, true);
  assert.equal(resultado.estado, 'conflicto_confirmado');
  assert.deepEqual(new Set(revocadas), new Set(relaciones));
}

async function recibir({
  sql, inbox, materializacion, soporte, ids, ruta, entregaId, posicion, vista
}) {
  const conexion = await sql.obtenerConexion();
  try {
    await conexion.beginTransaction();
    const lote = await soporte.sanearLoteEnTransaccion({
      relacionId: ids.relaciones[ruta],
      flujoId: ids.flujos[ruta],
      generacionId: ids.generaciones[ruta],
      revisionConcesionEfectiva: ids.revisiones[ruta],
      entregas: [{ entregaId, posicionFlujo: posicion, ocurrencia: vista }]
    }, { conexion });
    const persistible = lote.entregas[0].ocurrencia;
    const resultadoInbox = await inbox.recibirEnTransaccion(persistible, { conexion });
    const canonico = canonicalizarJsonFederacion(
      separarContenidoSensibleFederacion(persistible).publico
    );
    const ahora = await ahoraSql(conexion);
    await conexion.execute(
      `INSERT INTO entregas_recepcion_federacion (
         entrega_id,relacion_id,flujo_id,generacion_id,posicion_flujo,
         ocurrencia_canonica,ocurrencia_sha256,creada_en_utc
       ) VALUES (?,?,?,?,?,?,?,?)`,
      [
        entregaId, ids.relaciones[ruta], ids.flujos[ruta],
        ids.generaciones[ruta], posicion, canonico,
        createHash('sha256').update(canonico).digest(), ahora
      ]
    );
    const trabajo = await materializacion.registrarTrabajoEnTransaccion({
      lote: {
        relacionId: ids.relaciones[ruta],
        flujoId: ids.flujos[ruta],
        generacionId: ids.generaciones[ruta],
        revisionConcesionEfectiva: ids.revisiones[ruta]
      },
      entrega: {
        entregaId,
        posicionFlujo: posicion,
        ocurrencia: persistible,
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
      },
      inboxId: resultadoInbox.inboxId
    }, { conexion });
    await conexion.commit();
    return { inbox: resultadoInbox, trabajo };
  } catch (error) {
    await conexion.rollback().catch(() => {});
    throw error;
  } finally {
    conexion.release();
  }
}

function actualizar(ids, ocurrenciaOrigenId, secuenciaElemento, nombre) {
  return ocurrencia(ids, { ocurrenciaOrigenId, secuenciaElemento }, {
    nombre: crearCampoPresenteFederado({ valor: nombre }),
    estado: crearCampoPresenteFederado({ valor: true })
  });
}

function sinCampos(ids, ocurrenciaOrigenId, secuenciaElemento, operacion) {
  return {
    ...ocurrencia(ids, { ocurrenciaOrigenId, secuenciaElemento }, {}),
    operacion,
    vigenciaRestanteMs: null,
    campos: {}
  };
}

async function soportesCampo(sql, proyeccionId, nombre) {
  const [fila] = await sql.consultar(
    `SELECT total_soportes_activos
       FROM campos_consolidados_proyecciones_federacion
      WHERE proyeccion_id=? AND nombre_campo=?`,
    [proyeccionId, nombre]
  );
  return fila ? Number(fila.total_soportes_activos) : 0;
}

async function totalCampos(sql, proyeccionId) {
  const [fila] = await sql.consultar(
    `SELECT COUNT(*) AS total
       FROM campos_consolidados_proyecciones_federacion
      WHERE proyeccion_id=?`,
    [proyeccionId]
  );
  return Number(fila.total);
}

async function prioridadTrabajo(sql, entregaId) {
  const [fila] = await sql.consultar(
    `SELECT prioridad FROM trabajos_materializacion_federacion
      WHERE entrega_id=?`,
    [entregaId]
  );
  return fila?.prioridad ?? null;
}

async function ahoraSql(conexion) {
  const [filas] = await conexion.query('SELECT UTC_TIMESTAMP(3) AS ahora');
  return filas[0].ahora;
}

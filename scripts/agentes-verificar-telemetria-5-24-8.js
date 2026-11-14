import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { randomBytes, randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';

import { ControladorReglasDerivacionTelemetria } from '../apps/sentinelia-web/src/controladores/ControladorReglasDerivacionTelemetria.js';
import {
  crearLecturaTelemetriaAgenteConTiposInternos
} from '../paquetes/agentes/src/TelemetriaAgente.js';
import {
  CondicionDerivacionTelemetria,
  ReglaDerivacionTelemetria,
  RevisionReglaDerivacionTelemetria
} from '../paquetes/agentes/src/EventosDerivadosTelemetriaAgentes.js';
import {
  EvaluadorCondicionesDerivacionTelemetria,
  crearCondicionTipadaDerivacionTelemetria
} from '../paquetes/agentes/src/EvaluadorCondicionesDerivacionTelemetria.js';
import { ProcesadorTrabajosEvaluacionTelemetria } from '../paquetes/agentes/src/ProcesadorTrabajosEvaluacionTelemetria.js';
import { ProyectorEvaluacionesDerivadasTelemetria } from '../paquetes/agentes/src/ProyectorEvaluacionesDerivadasTelemetria.js';
import {
  RepositorioCatalogoSenalesTelemetriaAgentes
} from '../paquetes/agentes/src/RepositorioCatalogoSenalesTelemetriaAgentes.js';
import {
  RepositorioEstadoActualTelemetriaAgentes
} from '../paquetes/agentes/src/RepositorioEstadoActualTelemetriaAgentes.js';
import {
  RepositorioEstadoActualEvaluacionReglasTelemetria,
  RepositorioEventosDerivadosTelemetria
} from '../paquetes/agentes/src/RepositorioEvaluacionesDerivadasTelemetria.js';
import {
  RepositorioObservacionesTelemetriaAgentes
} from '../paquetes/agentes/src/RepositorioObservacionesTelemetriaAgentes.js';
import {
  RepositorioReglasDerivacionTelemetria
} from '../paquetes/agentes/src/RepositorioReglasDerivacionTelemetria.js';
import {
  RepositorioTrabajosEvaluacionTelemetria
} from '../paquetes/agentes/src/RepositorioTrabajosEvaluacionTelemetria.js';
import {
  FuenteEntropiaCriptograficaNode
} from '../paquetes/federacion/adaptadores/FuenteEntropiaCriptograficaNode.js';
import {
  GeneradorIdentidadesFederadas,
  TIPOS_IDENTIDAD_FEDERADA
} from '../paquetes/federacion/src/IdentidadFederada.js';
import {
  PERFIL_PAYLOAD_TELEMETRIA_FEDERACION,
  VERSION_PAYLOAD_TELEMETRIA_FEDERACION,
  validarPayloadTelemetriaFederacion
} from '../paquetes/federacion/src/PayloadTelemetriaFederacion.js';
import {
  EvaluadorFuenteReglaMonitorTelemetria
} from '../paquetes/monitores/src/EvaluadorFuenteReglaMonitorTelemetria.js';
import { ClienteSql } from '../paquetes/persistencia-sql/src/ClienteSql.js';
import { EjecutorMigraciones } from '../paquetes/persistencia-sql/src/EjecutorMigraciones.js';
import { RepositorioMigraciones } from '../paquetes/persistencia-sql/src/RepositorioMigraciones.js';
import {
  obtenerConfiguracionAplicacion,
  obtenerRutaMigraciones
} from '../paquetes/utilidades/src/configuracion/obtenerConfiguracionAplicacion.js';

const evaluador = new EvaluadorCondicionesDerivacionTelemetria();
const senalMomentoDominio = Object.freeze({
  id: 23,
  agenteId: 7,
  tipoDato: 'momento_utc',
  unidad: null
});

await main();

async function main() {
  verificarContratoYOperadores();
  verificarRechazosYNoEvaluable();
  await verificarAdministracionYUi();
  verificarCambioDeZonaDelEditor();
  verificarFederacionV1();
  verificarComposicionConMonitor();
  await verificarRecorridoSql();
  console.log(
    '[agentes] OK 5.24.8: condicion=momento_utc@1 operadores=6 ' +
    'umbralUtc=canonico comparacion=instante reloj=no_consultado revision=inmutable ' +
    'trabajos=concurrentes estado_evento=tipados editor=local_a_utc ' +
    'federacion=v1 monitor=ternario directos=sin_ampliar'
  );
}

function verificarContratoYOperadores() {
  const umbralUtc = '2026-08-26T10:00:00Z';
  const canonica = crearCondicionMomento('>=', umbralUtc);
  assert.deepEqual(canonica.serializar(), {
    tipo: 'momento_utc',
    version: 1,
    configuracion: { operador: '>=', umbralUtc }
  });
  assert.equal(
    canonica.obtenerCanonica(),
    '{"configuracion":{"operador":">=","umbralUtc":"2026-08-26T10:00:00Z"},"tipo":"momento_utc","version":1}'
  );
  assert.equal(Object.hasOwn(canonica.configuracion, 'unidad'), false);

  for (const [operador, valor, esperado] of [
    ['>', '2026-08-26T10:00:01Z', 'coincide'],
    ['>', umbralUtc, 'no_coincide'],
    ['>=', umbralUtc, 'coincide'],
    ['<', '2026-08-26T09:59:59Z', 'coincide'],
    ['<', umbralUtc, 'no_coincide'],
    ['<=', umbralUtc, 'coincide'],
    ['=', umbralUtc, 'coincide'],
    ['=', '2026-08-26T10:00:01Z', 'no_coincide'],
    ['!=', '2026-08-26T10:00:01Z', 'coincide'],
    ['!=', umbralUtc, 'no_coincide']
  ]) {
    const resultado = evaluarMomento({ operador, umbralUtc, valor });
    assert.equal(resultado.resultado, esperado, `${valor} ${operador} ${umbralUtc}`);
    assert.equal(resultado.valorEvaluado, valor);
    assert.equal(resultado.tipoDato, 'momento_utc');
    assert.equal(resultado.unidad, null);
  }
}

function verificarRechazosYNoEvaluable() {
  for (const umbralUtc of [
    '0999-12-31T23:59:59Z',
    '10000-01-01T00:00:00Z',
    '2026-02-29T00:00:00Z',
    '2026-08-26T10:00:00.000Z',
    '2026-08-26T12:00:00+02:00',
    1787738400000
  ]) {
    assert.throws(
      () => crearCondicionMomento('>=', umbralUtc),
      /momento UTC/iu
    );
  }
  assert.equal(
    crearCondicionMomento('=', '1000-01-01T00:00:00Z').configuracion.umbralUtc,
    '1000-01-01T00:00:00Z'
  );
  assert.equal(
    crearCondicionMomento('=', '9999-12-31T23:59:59Z').configuracion.umbralUtc,
    '9999-12-31T23:59:59Z'
  );
  assert.throws(
    () => new CondicionDerivacionTelemetria({
      tipo: 'momento_utc',
      version: 1,
      configuracion: {
        operador: '=',
        umbralUtc: '2026-08-26T10:00:00Z',
        retrasoSegundos: 60
      }
    }),
    /exactamente/iu
  );
  assert.throws(
    () => crearCondicionTipadaDerivacionTelemetria({
      senal: { ...senalMomentoDominio, tipoDato: 'numero' },
      tipo: 'momento_utc',
      operador: '>=',
      umbralUtc: '2026-08-26T10:00:00Z'
    }),
    /coincidir exactamente/iu
  );

  const noEvaluable = evaluarMomento({
    operador: '>=',
    umbralUtc: '2026-08-26T10:00:00Z',
    valor: '2026-08-26T10:00:00.000Z'
  });
  assert.equal(noEvaluable.resultado, 'no_evaluable');
  assert.equal(noEvaluable.codigoMotivo, 'valor_no_evaluable');

  const unidadNoCanonica = evaluarMomento({
    operador: '>=',
    umbralUtc: '2026-08-26T10:00:00Z',
    valor: '2026-08-26T10:00:01Z',
    senal: { ...senalMomentoDominio, unidad: 's' },
    unidadObservacion: 's'
  });
  assert.equal(unidadNoCanonica.resultado, 'no_evaluable');
  assert.equal(unidadNoCanonica.codigoMotivo, 'unidad_senal_incompatible');

  const antes = evaluarMomento({
    operador: '>',
    umbralUtc: '2027-01-01T00:00:00Z',
    valor: '2026-12-31T23:59:59Z',
    evaluadoEnUtc: '2026-08-26T10:00:03Z'
  });
  const despues = evaluarMomento({
    operador: '>',
    umbralUtc: '2027-01-01T00:00:00Z',
    valor: '2026-12-31T23:59:59Z',
    evaluadoEnUtc: '2099-01-01T00:00:00Z'
  });
  assert.equal(antes.resultado, 'no_coincide');
  assert.equal(despues.resultado, antes.resultado);
}

async function verificarAdministracionYUi() {
  let recibida = null;
  const controlador = new ControladorReglasDerivacionTelemetria({
    servicioAdministracionReglas: {
      async previsualizarCondicion(_contexto, datos) {
        recibida = datos;
        const condicion = crearCondicionTipadaDerivacionTelemetria({
          senal: senalMomentoDominio,
          ...datos.condicion
        });
        return {
          condicion: condicion.serializar(),
          condicionCanonica: condicion.obtenerCanonica()
        };
      }
    }
  });
  const respuesta = respuestaJson();
  await controlador.previsualizarCondicion({
    params: { id: '7' },
    body: {
      senal_id: '23',
      condicion_tipo: 'momento_utc',
      operador: '>=',
      umbral_utc: '2026-08-26T10:00:00Z'
    },
    contextoUsuarioActual: {}
  }, respuesta);
  assert.equal(respuesta.estado, 200);
  assert.equal(respuesta.cuerpo.ok, true);
  assert.equal(recibida.condicion.umbralUtc, '2026-08-26T10:00:00Z');
  assert.equal(
    respuesta.cuerpo.condicion.configuracion.umbralUtc,
    '2026-08-26T10:00:00Z'
  );

  const [formulario, js, servicio, monitorDirecto] = await Promise.all([
    leer('apps/sentinelia-web/src/views/parciales/formulario-revision-regla-telemetria.ejs'),
    leer('apps/sentinelia-web/src/public/js/agente-reglas.js'),
    leer('paquetes/agentes/src/ServicioAdministracionReglasDerivacionTelemetria.js'),
    leer('paquetes/monitores/src/MonitorTelemetriaAgente.js')
  ]);
  assert.match(formulario, /\['momento_utc', 'Fecha fija'\]/u);
  assert.match(formulario, /type="datetime-local" step="1"/u);
  assert.match(formulario, /name="umbral_utc"/u);
  assert.match(js, /convertirMomentoLocalAUtc/u);
  assert.match(js, /fecha\.toISOString\(\)\.replace/u);
  assert.match(js, /Se guardará exactamente:/u);
  assert.match(servicio, /'momento_utc'/u);
  const bloqueDirectos = monitorDirecto.match(
    /const TIPOS_DATO_DIRECTAMENTE_MONITORIZABLES = new Set\(\[[\s\S]*?\]\);/u
  )?.[0] || '';
  assert.doesNotMatch(bloqueDirectos, /MOMENTO_UTC/u);
}

function verificarCambioDeZonaDelEditor() {
  const codigo = `
    const fecha = new Date('2026-10-25T01:30:00');
    process.stdout.write(fecha.toISOString().replace(/\\.000Z$/u, 'Z'));
  `;
  const convertir = (zona) => execFileSync(process.execPath, ['-e', codigo], {
    encoding: 'utf8',
    env: { ...process.env, TZ: zona }
  });
  assert.equal(convertir('UTC'), '2026-10-25T01:30:00Z');
  assert.equal(convertir('Europe/Madrid'), '2026-10-24T23:30:00Z');
  assert.equal(convertir('America/New_York'), '2026-10-25T05:30:00Z');
}

function verificarFederacionV1() {
  const generador = new GeneradorIdentidadesFederadas({
    fuenteEntropia: new FuenteEntropiaCriptograficaNode()
  });
  const id = () => String(generador.generar(
    TIPOS_IDENTIDAD_FEDERADA.ELEMENTO_ORIGEN
  ));
  const fuente = id();
  const senal = id();
  const revision = id();
  const observacion = id();
  const payload = payloadReglaMomento({ fuente, senal, revision, observacion });
  const validado = validarPayloadTelemetriaFederacion(payload);
  assert.equal(validado.version, 1);
  assert.deepEqual(validado.revisiones[0].condicion, {
    tipo: 'momento_utc',
    version: 1,
    configuracion: {
      operador: '>=',
      umbralUtc: '2026-08-26T10:00:00Z'
    }
  });
  assert.equal(
    validado.estadoActual.valorEvaluado,
    '2026-08-26T10:00:01Z'
  );
  assert.throws(
    () => validarPayloadTelemetriaFederacion({
      ...payload,
      revisiones: [{
        ...payload.revisiones[0],
        condicion: {
          tipo: 'momento_utc',
          version: 1,
          configuracion: {
            operador: '>=',
            umbralUtc: '2026-08-26T10:00:00.000Z'
          }
        }
      }]
    }),
    /momento UTC canónico/iu
  );
}

function verificarComposicionConMonitor() {
  const monitor = new EvaluadorFuenteReglaMonitorTelemetria();
  const vinculo = {
    esReglaDerivacion: () => true,
    estadoRegla: 'activa',
    fuente: { reglaId: 31 },
    agenteId: 7,
    senalOrigen: { id: 23, tipoDato: 'momento_utc', unidad: null },
    scope: { tenantId: 1, empresaId: 2, sitioId: 3 }
  };
  const base = evaluarMomento({
    operador: '>=',
    umbralUtc: '2026-08-26T10:00:00Z',
    valor: '2026-08-26T10:00:00Z'
  }).serializar();
  const coincide = monitor.evaluar({ vinculo, estadoActualRegla: base });
  const noCoincide = monitor.evaluar({
    vinculo,
    estadoActualRegla: {
      ...base,
      resultado: 'no_coincide',
      severidadCalculada: null
    }
  });
  const noEvaluable = monitor.evaluar({
    vinculo,
    estadoActualRegla: {
      ...base,
      resultado: 'no_evaluable',
      codigoMotivo: 'valor_no_evaluable',
      severidadCalculada: null
    }
  });
  assert.equal(coincide.esFallo(), true);
  assert.equal(noCoincide.esNormal(), true);
  assert.equal(noEvaluable.esDesconocido(), true);
  assert.equal(
    coincide.evidencia.observacion.valor,
    '2026-08-26T10:00:00Z'
  );
  assert.match(coincide.evidencia.regla.condicionCanonica, /"momento_utc"/u);
}

async function verificarRecorridoSql() {
  const configuracion = obtenerConfiguracionAplicacion();
  assert.equal(
    configuracion.sql.estaCompleta,
    true,
    '5.24.8 necesita SQL real para probar revisión, trabajos y proyección.'
  );
  const baseDatos = `sentinelia_fixture_5248_${randomBytes(6).toString('hex')}`;
  const administrador = new ClienteSql(configuracion.sql);
  await administrador.ejecutar(
    `CREATE DATABASE ${administrador.escaparIdentificador(baseDatos)} ` +
    'CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci'
  );
  const sql = new ClienteSql({ ...configuracion.sql, baseDatos });
  try {
    await new EjecutorMigraciones({
      clienteSql: sql,
      repositorioMigraciones: new RepositorioMigraciones(sql),
      rutaMigraciones: obtenerRutaMigraciones()
    }).ejecutarPendientes();
    await sql.verificarUsoHorarioUtc();
    await verificarEnumCondicion(sql);
    await verificarRevisionTrabajosYResultados(sql, await crearAgente(sql));
  } finally {
    await sql.cerrar();
    await administrador.ejecutar(
      `DROP DATABASE IF EXISTS ${administrador.escaparIdentificador(baseDatos)}`
    ).catch(() => {});
    await administrador.cerrar();
  }
}

async function verificarEnumCondicion(sql) {
  const [columna] = await sql.consultar(
    `SELECT column_type
       FROM information_schema.columns
      WHERE table_schema = DATABASE()
        AND table_name = 'revisiones_reglas_derivacion_telemetria'
        AND column_name = 'condicion_tipo'`
  );
  assert.ok(columna);
  assert.match(columna.column_type, /'momento_utc'/u);
}

async function verificarRevisionTrabajosYResultados(sql, agente) {
  const catalogo = new RepositorioCatalogoSenalesTelemetriaAgentes(sql);
  const observaciones = new RepositorioObservacionesTelemetriaAgentes(sql);
  const fotografia = new RepositorioEstadoActualTelemetriaAgentes(sql);
  const reglas = new RepositorioReglasDerivacionTelemetria(sql);
  const trabajos = new RepositorioTrabajosEvaluacionTelemetria(sql);
  const estados = new RepositorioEstadoActualEvaluacionReglasTelemetria(sql);
  const eventos = new RepositorioEventosDerivadosTelemetria(sql);
  const senal = await catalogo.guardarDeclaracionSenal({
    agenteId: agente.id,
    definicion: {
      categoria: 'copias',
      clave: 'momento_utc',
      tipoDato: 'momento_utc',
      unidad: null,
      nombreHumano: 'Siguiente copia programada'
    }
  });
  assert.equal(senal.unidad, null);
  const inicial = await reglas.crearConRevisionInicial({
    agenteId: agente.id,
    senalId: senal.id,
    tenantId: agente.tenantId,
    empresaId: agente.empresaId,
    sitioId: agente.sitioId,
    revision: revisionMomento(
      senal,
      '>=',
      '2026-08-27T10:00:00Z',
      'Momento UTC inicial'
    )
  });
  const segunda = await reglas.crearNuevaRevision({
    reglaId: inicial.regla.id,
    revision: revisionMomento(
      senal,
      '>',
      '2027-01-01T00:00:00Z',
      'Momento UTC revisado'
    )
  });
  const historico = await reglas.listarRevisionesPorRegla(inicial.regla.id);
  assert.deepEqual(historico.map(({ numero }) => numero), [2, 1]);
  assert.deepEqual(
    historico.map(({ condicion }) => condicion.configuracion.umbralUtc),
    ['2027-01-01T00:00:00Z', '2026-08-27T10:00:00Z']
  );
  assert.equal(historico[0].vigenteHastaUtc, null);
  assert.equal(historico[1].vigenteHastaUtc, segunda.vigenteDesdeUtc);

  const regla = await reglas.buscarPorId(inicial.regla.id);
  const recibidoBase = new Date(Date.parse(segunda.vigenteDesdeUtc) + 5);
  const primera = await insertarMomento({
    observaciones,
    fotografia,
    agente,
    senal,
    valor: '2027-01-01T00:00:01Z',
    observadoEnUtc: new Date(recibidoBase.getTime() - 1000).toISOString(),
    recibidoEnUtc: recibidoBase.toISOString()
  });
  const encolados = await Promise.all([
    trabajos.encolar({ observacion: primera, regla: regla.regla, revision: segunda }),
    trabajos.encolar({ observacion: primera, regla: regla.regla, revision: segunda })
  ]);
  assert.deepEqual(encolados.map(({ creado }) => creado).sort(), [false, true]);
  assert.equal(encolados[0].trabajo.id, encolados[1].trabajo.id);
  await esperarReclamable(recibidoBase);
  const resultadoCoincide = await procesarUnTrabajo({
    trabajos,
    reglas,
    observaciones,
    catalogo,
    estados,
    eventos,
    evaluadoEnUtc: new Date(recibidoBase.getTime() + 1000)
  });
  assert.equal(resultadoCoincide.resultado.resultado, 'coincide');
  assert.equal(
    resultadoCoincide.resultado.valorEvaluado,
    '2027-01-01T00:00:01Z'
  );
  assert.deepEqual(
    JSON.parse(resultadoCoincide.resultado.condicionCanonica).configuracion,
    { operador: '>', umbralUtc: '2027-01-01T00:00:00Z' }
  );
  const eventoCoincide = (await eventos.listarPorRegla(regla.regla.id))[0];
  assert.equal(eventoCoincide.valorEvaluado, '2027-01-01T00:00:01Z');
  assert.equal(eventoCoincide.tipoDato, 'momento_utc');
  assert.deepEqual(
    JSON.parse(eventoCoincide.condicionCanonica).configuracion,
    { operador: '>', umbralUtc: '2027-01-01T00:00:00Z' }
  );

  const recibidoIgual = new Date(recibidoBase.getTime() + 2000);
  const igual = await insertarMomento({
    observaciones,
    fotografia,
    agente,
    senal,
    valor: '2027-01-01T00:00:00Z',
    observadoEnUtc: new Date(recibidoIgual.getTime() - 500).toISOString(),
    recibidoEnUtc: recibidoIgual.toISOString()
  });
  await trabajos.encolar({ observacion: igual, regla: regla.regla, revision: segunda });
  await esperarReclamable(recibidoIgual);
  const resultadoIgual = await procesarUnTrabajo({
    trabajos,
    reglas,
    observaciones,
    catalogo,
    estados,
    eventos,
    evaluadoEnUtc: new Date(recibidoIgual.getTime() + 1000)
  });
  assert.equal(resultadoIgual.resultado.resultado, 'no_coincide');
  const estado = await estados.buscarPorRegla(regla.regla.id);
  assert.equal(estado.resultado, 'no_coincide');
  assert.equal(estado.valorEvaluado, '2027-01-01T00:00:00Z');
  assert.equal((await eventos.listarPorRegla(regla.regla.id)).length, 1);
}

async function insertarMomento({
  observaciones,
  fotografia,
  agente,
  senal,
  valor,
  observadoEnUtc,
  recibidoEnUtc
}) {
  const lote = await observaciones.insertarLoteAceptado({
    agenteId: agente.id,
    senalesCatalogadas: [senal],
    recibidoEnUtc,
    observacionesAceptadas: [crearLecturaTelemetriaAgenteConTiposInternos({
      categoria: 'copias',
      clave: 'momento_utc',
      tipoDato: 'momento_utc',
      unidad: null,
      valorMomentoUtc: valor,
      calidad: 'valida',
      observadoEnUtc
    })]
  });
  await fotografia.aplicarObservacionesHistoricas(lote.insertadas);
  return lote.insertadas[0];
}

async function procesarUnTrabajo({
  trabajos,
  reglas,
  observaciones,
  catalogo,
  estados,
  eventos,
  evaluadoEnUtc
}) {
  const reclamadoPor = `verificador-5.24.8-${randomBytes(3).toString('hex')}`;
  const [trabajo] = await trabajos.reclamarSiguientes({
    reclamadoPor,
    limite: 1,
    ttlSegundos: 30
  });
  assert.ok(trabajo);
  return new ProcesadorTrabajosEvaluacionTelemetria({
    repositorioTrabajos: trabajos,
    repositorioReglas: reglas,
    repositorioObservaciones: observaciones,
    repositorioCatalogoSenales: catalogo,
    proyectorEvaluaciones: new ProyectorEvaluacionesDerivadasTelemetria({
      repositorioEstadoActual: estados,
      repositorioEventosDerivados: eventos
    }),
    evaluador,
    reloj: () => evaluadoEnUtc
  }).procesar({ trabajo, reclamadoPor });
}

function evaluarMomento({
  operador,
  umbralUtc,
  valor,
  senal = senalMomentoDominio,
  unidadObservacion = null,
  evaluadoEnUtc = '2026-08-26T10:00:03Z'
}) {
  const condicion = crearCondicionTipadaDerivacionTelemetria({
    senal,
    tipo: 'momento_utc',
    operador,
    umbralUtc
  });
  const regla = new ReglaDerivacionTelemetria({
    id: 31,
    agente: { id: 7, tenantId: 1, empresaId: 2, sitioId: 3 },
    senal: { id: 23, agenteId: 7 },
    scope: { tenantId: 1, empresaId: 2, sitioId: 3 },
    revisionVigenteId: 101
  });
  const revision = new RevisionReglaDerivacionTelemetria({
    id: 101,
    reglaId: 31,
    numero: 1,
    condicion,
    severidadCalculada: 'advertencia',
    mensajeOperativo: 'El momento informado supera el límite.',
    nombre: 'Momento UTC de copia',
    vigenteDesdeUtc: '2026-08-26T10:00:00Z'
  });
  return evaluador.evaluar({
    regla,
    revision,
    senal,
    observacion: {
      id: 501,
      agenteId: 7,
      senalId: 23,
      valor,
      tipoDato: 'momento_utc',
      unidad: unidadObservacion,
      calidad: 'valida',
      observadoEnUtc: '2026-08-26T10:00:01Z',
      recibidoEnUtc: '2026-08-26T10:00:02Z'
    },
    evaluadoEnUtc
  });
}

function crearCondicionMomento(operador, umbralUtc) {
  return crearCondicionTipadaDerivacionTelemetria({
    senal: senalMomentoDominio,
    tipo: 'momento_utc',
    operador,
    umbralUtc
  });
}

function revisionMomento(senal, operador, umbralUtc, nombre) {
  return {
    condicion: crearCondicionTipadaDerivacionTelemetria({
      senal,
      tipo: 'momento_utc',
      operador,
      umbralUtc
    }),
    severidadCalculada: 'advertencia',
    mensajeOperativo: 'El momento informado supera el límite configurado.',
    nombre,
    descripcion: null,
    metadatos: null
  };
}

function payloadReglaMomento({ fuente, senal, revision, observacion }) {
  const condicion = {
    tipo: 'momento_utc',
    version: 1,
    configuracion: {
      operador: '>=',
      umbralUtc: '2026-08-26T10:00:00Z'
    }
  };
  return {
    perfil: PERFIL_PAYLOAD_TELEMETRIA_FEDERACION,
    version: VERSION_PAYLOAD_TELEMETRIA_FEDERACION,
    tipoRegistro: 'reglaDerivacion',
    fuenteOrigenId: fuente,
    senalOrigenId: senal,
    estado: 'activa',
    revisionVigenteOrigenId: revision,
    revisiones: [{
      revisionOrigenId: revision,
      numero: '1',
      condicionTipo: 'momento_utc',
      condicionVersion: '1',
      condicion,
      severidadCalculada: 'advertencia',
      mensajeOperativo: 'El momento informado supera el límite configurado.',
      nombre: 'Momento UTC de copia',
      descripcion: null,
      metadatosDescriptivos: null,
      vigenteDesdeUtc: '2026-08-26T10:00:00.000Z',
      vigenteHastaUtc: null
    }],
    estadoActual: {
      revisionOrigenId: revision,
      observacionOrigenId: observacion,
      resultado: 'coincide',
      codigoMotivo: 'condicion_cumplida',
      explicacion: 'La observación cumple la condición tipada.',
      valorEvaluado: '2026-08-26T10:00:01Z',
      tipoDato: 'momento_utc',
      unidad: '',
      calidad: 'valida',
      severidadCalculada: 'advertencia',
      mensajeOperativo: 'El momento informado supera el límite configurado.',
      evidenciaContextual: {
        operador: '>=',
        umbralUtc: '2026-08-26T10:00:00Z'
      },
      observadoEnUtc: '2026-08-26T10:00:01.000Z',
      recibidoEnUtc: '2026-08-26T10:00:02.000Z',
      evaluadoEnUtc: '2026-08-26T10:00:03.000Z'
    }
  };
}

async function crearAgente(sql) {
  const alias = `fixture-5248-${randomBytes(4).toString('hex')}`;
  const [tenant] = await sql.ejecutar(
    'INSERT INTO tenants (nombre, alias) VALUES (?, ?)',
    ['Tenant 5.24.8', alias]
  );
  const [empresa] = await sql.ejecutar(
    'INSERT INTO empresas (tenant_id, nombre, alias) VALUES (?, ?, ?)',
    [tenant.insertId, 'Empresa 5.24.8', alias]
  );
  const [sitio] = await sql.ejecutar(
    'INSERT INTO sitios (tenant_id, empresa_id, nombre, alias) VALUES (?, ?, ?, ?)',
    [tenant.insertId, empresa.insertId, 'Sitio 5.24.8', alias]
  );
  const [agente] = await sql.ejecutar(
    `INSERT INTO agentes_sentinelia (
       guid, tenant_id, empresa_id, sitio_id, nombre, secreto_hash
     ) VALUES (?, ?, ?, ?, ?, ?)`,
    [
      randomUUID(),
      tenant.insertId,
      empresa.insertId,
      sitio.insertId,
      'Agente momento UTC 5.24.8',
      'hash-no-utilizable'
    ]
  );
  return {
    id: Number(agente.insertId),
    tenantId: Number(tenant.insertId),
    empresaId: Number(empresa.insertId),
    sitioId: Number(sitio.insertId)
  };
}

async function esperarReclamable(fecha) {
  const demora = Math.max(0, fecha.getTime() - Date.now() + 15);
  if (demora > 0) {
    await new Promise((resolve) => setTimeout(resolve, demora));
  }
}

function respuestaJson() {
  return {
    estado: 200,
    cuerpo: null,
    status(estado) {
      this.estado = estado;
      return this;
    },
    json(cuerpo) {
      this.cuerpo = cuerpo;
      return this;
    }
  };
}

async function leer(ruta) {
  return readFile(new URL(`../${ruta}`, import.meta.url), 'utf8');
}

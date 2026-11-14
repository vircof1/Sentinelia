import assert from 'node:assert/strict';
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
const senalDuracionDominio = Object.freeze({
  id: 23,
  agenteId: 7,
  tipoDato: 'duracion',
  unidad: null
});

await main();

async function main() {
  verificarContratoYOperadores();
  verificarRechazosYNoEvaluable();
  await verificarAdministracionYUi();
  verificarFederacionV1();
  verificarComposicionConMonitor();
  await verificarRecorridoSql();
  console.log(
    '[agentes] OK 5.24.7: condicion=duracion@1 operadores=6 ' +
    'umbral=validador_compartido igualdad=exacta revision=inmutable ' +
    'trabajos=concurrentes estado_evento=tipados editor=segundos_humano ' +
    'federacion=v1 monitor=ternario directos=sin_ampliar'
  );
}

function verificarContratoYOperadores() {
  const canonica = crearCondicionDuracion('>=', 90.5);
  assert.deepEqual(canonica.serializar(), {
    tipo: 'duracion',
    version: 1,
    configuracion: { operador: '>=', umbral: 90.5 }
  });
  assert.equal(
    canonica.obtenerCanonica(),
    '{"configuracion":{"operador":">=","umbral":90.5},"tipo":"duracion","version":1}'
  );
  assert.equal(Object.hasOwn(canonica.configuracion, 'unidad'), false);

  for (const [operador, valor, esperado] of [
    ['>', 90.5001, 'coincide'],
    ['>', 90.5, 'no_coincide'],
    ['>=', 90.5, 'coincide'],
    ['<', 90.4999, 'coincide'],
    ['<', 90.5, 'no_coincide'],
    ['<=', 90.5, 'coincide'],
    ['=', 90.5, 'coincide'],
    ['=', 90.5001, 'no_coincide'],
    ['!=', 90.5001, 'coincide'],
    ['!=', 90.5, 'no_coincide']
  ]) {
    const resultado = evaluarDuracion({ operador, umbral: 90.5, valor });
    assert.equal(resultado.resultado, esperado, `${valor} ${operador} 90.5`);
    assert.equal(resultado.valorEvaluado, valor);
    assert.equal(resultado.tipoDato, 'duracion');
    assert.equal(resultado.unidad, null);
  }
}

function verificarRechazosYNoEvaluable() {
  for (const umbral of [-1, 0.00001, '90.5', Number.NaN, Number.POSITIVE_INFINITY]) {
    assert.throws(
      () => crearCondicionDuracion('>=', umbral),
      /duración|decimales/iu
    );
  }
  assert.equal(crearCondicionDuracion('=', 0.0001).configuracion.umbral, 0.0001);
  assert.equal(
    crearCondicionDuracion('=', Number.MAX_VALUE).configuracion.umbral,
    Number.MAX_VALUE
  );
  assert.throws(
    () => new CondicionDerivacionTelemetria({
      tipo: 'duracion',
      version: 1,
      configuracion: { operador: '=', umbral: 1, unidad: 's' }
    }),
    /exactamente/iu
  );
  assert.throws(
    () => crearCondicionTipadaDerivacionTelemetria({
      senal: { ...senalDuracionDominio, tipoDato: 'numero' },
      tipo: 'duracion',
      operador: '>=',
      umbral: 1
    }),
    /coincidir exactamente/iu
  );

  const noEvaluable = evaluarDuracion({
    operador: '>=',
    umbral: 1,
    valor: 1.00001
  });
  assert.equal(noEvaluable.resultado, 'no_evaluable');
  assert.equal(noEvaluable.codigoMotivo, 'valor_no_evaluable');

  const unidadNoCanonica = evaluarDuracion({
    operador: '>=',
    umbral: 1,
    valor: 2,
    senal: { ...senalDuracionDominio, unidad: 's' },
    unidadObservacion: 's'
  });
  assert.equal(unidadNoCanonica.resultado, 'no_evaluable');
  assert.equal(unidadNoCanonica.codigoMotivo, 'unidad_senal_incompatible');
}

async function verificarAdministracionYUi() {
  let recibida = null;
  const controlador = new ControladorReglasDerivacionTelemetria({
    servicioAdministracionReglas: {
      async previsualizarCondicion(_contexto, datos) {
        recibida = datos;
        const condicion = crearCondicionTipadaDerivacionTelemetria({
          senal: senalDuracionDominio,
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
      condicion_tipo: 'duracion',
      operador: '>=',
      umbral: '90.5000'
    },
    contextoUsuarioActual: {}
  }, respuesta);
  assert.equal(respuesta.estado, 200);
  assert.equal(respuesta.cuerpo.ok, true);
  assert.equal(recibida.condicion.umbral, 90.5);
  assert.equal(respuesta.cuerpo.condicion.configuracion.umbral, 90.5);

  const [formulario, js, servicio, monitorDirecto] = await Promise.all([
    leer('apps/sentinelia-web/src/views/parciales/formulario-revision-regla-telemetria.ejs'),
    leer('apps/sentinelia-web/src/public/js/agente-reglas.js'),
    leer('paquetes/agentes/src/ServicioAdministracionReglasDerivacionTelemetria.js'),
    leer('paquetes/monitores/src/MonitorTelemetriaAgente.js')
  ]);
  assert.match(formulario, /\['duracion', 'Duración'\]/u);
  assert.match(formulario, /data-regla-duracion-ayuda/u);
  assert.match(js, /entradaUmbral\.step = duracion \? '0\.0001' : 'any'/u);
  assert.match(js, /Lectura humana:/u);
  assert.match(js, /Se guardará el valor exacto en segundos/u);
  assert.match(servicio, /'duracion'/u);
  const bloqueDirectos = monitorDirecto.match(
    /const TIPOS_DATO_DIRECTAMENTE_MONITORIZABLES = new Set\(\[[\s\S]*?\]\);/u
  )?.[0] || '';
  assert.doesNotMatch(bloqueDirectos, /DURACION/u);
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
  const payload = payloadReglaDuracion({ fuente, senal, revision, observacion });
  const validado = validarPayloadTelemetriaFederacion(payload);
  assert.equal(validado.version, 1);
  assert.deepEqual(validado.revisiones[0].condicion, {
    tipo: 'duracion',
    version: 1,
    configuracion: { operador: '>=', umbral: 90.5 }
  });
  assert.equal(validado.estadoActual.valorEvaluado, 90.5001);
  assert.throws(
    () => validarPayloadTelemetriaFederacion({
      ...payload,
      revisiones: [{
        ...payload.revisiones[0],
        condicion: {
          tipo: 'duracion',
          version: 1,
          configuracion: { operador: '>=', umbral: 90.50001 }
        }
      }]
    }),
    /duración canónica|decimales/iu
  );
}

function verificarComposicionConMonitor() {
  const monitor = new EvaluadorFuenteReglaMonitorTelemetria();
  const vinculo = {
    esReglaDerivacion: () => true,
    estadoRegla: 'activa',
    fuente: { reglaId: 31 },
    agenteId: 7,
    senalOrigen: { id: 23, tipoDato: 'duracion', unidad: null },
    scope: { tenantId: 1, empresaId: 2, sitioId: 3 }
  };
  const base = evaluarDuracion({ operador: '>=', umbral: 90.5, valor: 90.5 })
    .serializar();
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
  assert.equal(coincide.evidencia.observacion.valor, 90.5);
  assert.match(coincide.evidencia.regla.condicionCanonica, /"duracion"/u);
}

async function verificarRecorridoSql() {
  const configuracion = obtenerConfiguracionAplicacion();
  assert.equal(
    configuracion.sql.estaCompleta,
    true,
    '5.24.7 necesita SQL real para probar revisión, trabajos y proyección.'
  );
  const baseDatos = `sentinelia_fixture_5247_${randomBytes(6).toString('hex')}`;
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
  assert.match(columna.column_type, /'duracion'/u);
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
      clave: 'duracion',
      tipoDato: 'duracion',
      unidad: 's',
      nombreHumano: 'Duración de la copia'
    }
  });
  assert.equal(senal.unidad, null);
  const inicial = await reglas.crearConRevisionInicial({
    agenteId: agente.id,
    senalId: senal.id,
    tenantId: agente.tenantId,
    empresaId: agente.empresaId,
    sitioId: agente.sitioId,
    revision: revisionDuracion(senal, '>=', 90.5, 'Duración inicial')
  });
  const segunda = await reglas.crearNuevaRevision({
    reglaId: inicial.regla.id,
    revision: revisionDuracion(senal, '>', 120.0001, 'Duración revisada')
  });
  const historico = await reglas.listarRevisionesPorRegla(inicial.regla.id);
  assert.deepEqual(historico.map(({ numero }) => numero), [2, 1]);
  assert.deepEqual(
    historico.map(({ condicion }) => condicion.configuracion.umbral),
    [120.0001, 90.5]
  );
  assert.equal(historico[0].vigenteHastaUtc, null);
  assert.equal(historico[1].vigenteHastaUtc, segunda.vigenteDesdeUtc);

  const regla = await reglas.buscarPorId(inicial.regla.id);
  const recibidoBase = new Date(Date.parse(segunda.vigenteDesdeUtc) + 5);
  const observadoEmpatado = new Date(
    recibidoBase.getTime() - 1000
  ).toISOString();
  const primera = await insertarDuracion({
    observaciones,
    fotografia,
    agente,
    senal,
    valor: 120.0002,
    observadoEnUtc: observadoEmpatado,
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
  assert.equal(resultadoCoincide.resultado.valorEvaluado, 120.0002);
  assert.deepEqual(
    JSON.parse(resultadoCoincide.resultado.condicionCanonica).configuracion,
    { operador: '>', umbral: 120.0001 }
  );
  const eventoCoincide = (await eventos.listarPorRegla(regla.regla.id))[0];
  assert.equal(eventoCoincide.valorEvaluado, 120.0002);
  assert.equal(eventoCoincide.tipoDato, 'duracion');
  assert.deepEqual(
    JSON.parse(eventoCoincide.condicionCanonica).configuracion,
    { operador: '>', umbral: 120.0001 }
  );

  const recibidoIgual = new Date(recibidoBase.getTime() + 10);
  const igual = await insertarDuracion({
    observaciones,
    fotografia,
    agente,
    senal,
    valor: 120.0001,
    observadoEnUtc: observadoEmpatado,
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
  assert.equal(
    resultadoIgual.resultado.resultado,
    'no_coincide',
    `La igualdad durable evaluó valor=${resultadoIgual.resultado.valorEvaluado} ` +
      `con condición=${resultadoIgual.resultado.condicionCanonica}.`
  );
  const estado = await estados.buscarPorRegla(regla.regla.id);
  assert.equal(estado.observacionId, igual.id);
  assert.equal(estado.resultado, 'no_coincide');
  assert.equal(estado.valorEvaluado, 120.0001);
  assert.equal((await eventos.listarPorRegla(regla.regla.id)).length, 1);
}

async function insertarDuracion({
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
      clave: 'duracion',
      tipoDato: 'duracion',
      unidad: null,
      valorDuracion: valor,
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
  const reclamadoPor = `verificador-5.24.7-${randomBytes(3).toString('hex')}`;
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

function evaluarDuracion({
  operador,
  umbral,
  valor,
  senal = senalDuracionDominio,
  unidadObservacion = null
}) {
  const condicion = crearCondicionTipadaDerivacionTelemetria({
    senal,
    tipo: 'duracion',
    operador,
    umbral
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
    mensajeOperativo: 'La duración supera el límite.',
    nombre: 'Duración de copia',
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
      tipoDato: 'duracion',
      unidad: unidadObservacion,
      calidad: 'valida',
      observadoEnUtc: '2026-08-26T10:00:01Z',
      recibidoEnUtc: '2026-08-26T10:00:02Z'
    },
    evaluadoEnUtc: '2026-08-26T10:00:03Z'
  });
}

function crearCondicionDuracion(operador, umbral) {
  return crearCondicionTipadaDerivacionTelemetria({
    senal: senalDuracionDominio,
    tipo: 'duracion',
    operador,
    umbral
  });
}

function revisionDuracion(senal, operador, umbral, nombre) {
  return {
    condicion: crearCondicionTipadaDerivacionTelemetria({
      senal,
      tipo: 'duracion',
      operador,
      umbral
    }),
    severidadCalculada: 'advertencia',
    mensajeOperativo: 'La copia supera la duración configurada.',
    nombre,
    descripcion: null,
    metadatos: null
  };
}

function payloadReglaDuracion({ fuente, senal, revision, observacion }) {
  const condicion = {
    tipo: 'duracion',
    version: 1,
    configuracion: { operador: '>=', umbral: 90.5 }
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
      condicionTipo: 'duracion',
      condicionVersion: '1',
      condicion,
      severidadCalculada: 'advertencia',
      mensajeOperativo: 'La copia supera la duración configurada.',
      nombre: 'Duración de copia',
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
      valorEvaluado: 90.5001,
      tipoDato: 'duracion',
      unidad: '',
      calidad: 'valida',
      severidadCalculada: 'advertencia',
      mensajeOperativo: 'La copia supera la duración configurada.',
      evidenciaContextual: { operador: '>=', umbral: 90.5 },
      observadoEnUtc: '2026-08-26T10:00:01.000Z',
      recibidoEnUtc: '2026-08-26T10:00:02.000Z',
      evaluadoEnUtc: '2026-08-26T10:00:03.000Z'
    }
  };
}

async function crearAgente(sql) {
  const alias = `fixture-5247-${randomBytes(4).toString('hex')}`;
  const [tenant] = await sql.ejecutar(
    'INSERT INTO tenants (nombre, alias) VALUES (?, ?)',
    ['Tenant 5.24.7', alias]
  );
  const [empresa] = await sql.ejecutar(
    'INSERT INTO empresas (tenant_id, nombre, alias) VALUES (?, ?, ?)',
    [tenant.insertId, 'Empresa 5.24.7', alias]
  );
  const [sitio] = await sql.ejecutar(
    'INSERT INTO sitios (tenant_id, empresa_id, nombre, alias) VALUES (?, ?, ?, ?)',
    [tenant.insertId, empresa.insertId, 'Sitio 5.24.7', alias]
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
      'Agente duración 5.24.7',
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

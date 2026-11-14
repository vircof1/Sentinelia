import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';

import { ControladorReglasDerivacionTelemetria } from '../apps/sentinelia-web/src/controladores/ControladorReglasDerivacionTelemetria.js';
import {
  ReglaDerivacionTelemetria,
  RevisionReglaDerivacionTelemetria
} from '../paquetes/agentes/src/EventosDerivadosTelemetriaAgentes.js';
import {
  EvaluadorCondicionesDerivacionTelemetria,
  crearCondicionTipadaDerivacionTelemetria,
  evaluarCondicionRegexTelemetria
} from '../paquetes/agentes/src/EvaluadorCondicionesDerivacionTelemetria.js';
import {
  LIMITES_REGEX_TELEMETRIA,
  contarCoincidenciasRegexTelemetria
} from '../paquetes/agentes/src/MotorRegexSeguroTelemetria.js';
import { ProcesadorTrabajosEvaluacionTelemetria } from '../paquetes/agentes/src/ProcesadorTrabajosEvaluacionTelemetria.js';
import {
  RepositorioCatalogoSenalesTelemetriaAgentes
} from '../paquetes/agentes/src/RepositorioCatalogoSenalesTelemetriaAgentes.js';
import {
  RepositorioReglasDerivacionTelemetria
} from '../paquetes/agentes/src/RepositorioReglasDerivacionTelemetria.js';
import {
  ServicioAdministracionReglasDerivacionTelemetria
} from '../paquetes/agentes/src/ServicioAdministracionReglasDerivacionTelemetria.js';
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
const senalTexto = Object.freeze({
  id: 23,
  agenteId: 7,
  tipoDato: 'texto',
  unidad: null
});
const muestra = 'SECRETO-CONTEO-52410 error 401; ERROR 402; correcto';

await main();

async function main() {
  verificarContratoYOperadores();
  verificarIteracionUnicodeYPresupuesto();
  verificarRuntimeYEvidencia();
  await verificarPrevisualizacionYEditor();
  verificarFederacionYReconstruccion();
  verificarComposicionConMonitor();
  await verificarFalloTecnicoReintentable();
  await verificarPersistenciaSql();
  console.log(
    '[agentes] OK 5.24.10: texto_regex@1 modo=conteo operadores=6 ' +
    'iteracion=no_solapada unicode=code_points vacias=avance_1 ' +
    'limite=2048 presupuesto=2049 agotamiento=error_reintentable ' +
    'preview=muestra_redactada runtime=paridad federacion=v1 monitor=ternario sql=sin_migracion_nueva'
  );
}

function verificarContratoYOperadores() {
  const condicion = crearCondicionConteo({
    patron: 'error\\s+\\d+',
    opciones: ['i'],
    operador: '>=',
    umbral: 2
  });
  assert.deepEqual(condicion.serializar(), {
    tipo: 'texto_regex',
    version: 1,
    configuracion: {
      modo: 'conteo',
      patron: 'error\\s+\\d+',
      opciones: ['i'],
      operador: '>=',
      umbral: 2
    }
  });
  assert.equal(
    condicion.obtenerCanonica(),
    '{"configuracion":{"modo":"conteo","opciones":["i"],"operador":">=","patron":"error\\\\s+\\\\d+","umbral":2},"tipo":"texto_regex","version":1}'
  );

  for (const [operador, umbral, esperado] of [
    ['>', 1, 'coincide'],
    ['>', 2, 'no_coincide'],
    ['>=', 2, 'coincide'],
    ['<', 3, 'coincide'],
    ['<', 2, 'no_coincide'],
    ['<=', 2, 'coincide'],
    ['=', 2, 'coincide'],
    ['=', 1, 'no_coincide'],
    ['!=', 1, 'coincide'],
    ['!=', 2, 'no_coincide']
  ]) {
    const resultado = evaluarConteo({
      patron: 'error\\s+\\d+',
      opciones: ['i'],
      operador,
      umbral,
      valor: muestra
    });
    assert.equal(resultado.resultado, esperado, `${operador} ${umbral}`);
    assert.equal(resultado.evidenciaContextual.regex.conteo, 2);
    assert.equal(resultado.evidenciaContextual.regex.operador, operador);
    assert.equal(resultado.evidenciaContextual.regex.umbral, umbral);
  }

  for (const umbral of [-1, 1.5, Number.MAX_SAFE_INTEGER + 1, '2', null]) {
    assert.throws(
      () => crearCondicionConteo({
        patron: 'error', opciones: [], operador: '>=', umbral
      }),
      /entero seguro no negativo/iu
    );
  }
  assert.throws(
    () => crearCondicionConteo({
      patron: 'error', opciones: [], operador: '~=', umbral: 1
    }),
    /operador/iu
  );
}

function verificarIteracionUnicodeYPresupuesto() {
  assert.equal(contar({ patron: 'aa', texto: 'aaaaa' }).conteo, 2);
  assert.equal(contar({ patron: '.', texto: '😀a' }).conteo, 2);
  assert.equal(contar({ patron: '', texto: '😀a' }).conteo, 3);
  assert.equal(contar({ patron: '', texto: '' }).conteo, 1);
  assert.equal(contar({ patron: 'z+', texto: 'abc' }).conteo, 0);
  assert.equal(contar({
    patron: '^a.b$',
    opciones: ['i', 'm', 's'],
    texto: 'inicio\nA\nB\nfin'
  }).conteo, 1);

  const maximo = contar({
    patron: '.',
    texto: 'a'.repeat(LIMITES_REGEX_TELEMETRIA.COINCIDENCIAS)
  });
  assert.equal(maximo.conteo, 2048);
  assert.equal(maximo.evidencia.pasosEjecutados, 2049);
  assert.equal(maximo.evidencia.limiteCoincidencias, 2048);

  assert.throws(
    () => contar({
      patron: '',
      texto: 'S'.repeat(LIMITES_REGEX_TELEMETRIA.TEXTO_CARACTERES)
    }),
    (error) => {
      assert.equal(error.code, 'presupuesto_regex_agotado');
      assert.equal(error.codigo, 'presupuesto_regex_agotado');
      assert.doesNotMatch(error.message, /S{8}/u);
      return true;
    }
  );
}

function verificarRuntimeYEvidencia() {
  const resultado = evaluarConteo({
    patron: 'error\\s+\\d+',
    opciones: ['i'],
    operador: '=',
    umbral: 2,
    valor: muestra
  });
  assert.equal(resultado.resultado, 'coincide');
  assert.match(resultado.valorEvaluado, /^\[texto redactado; \d+ caracteres\]$/u);
  assert.deepEqual(
    {
      modo: resultado.evidenciaContextual.regex.modo,
      conteo: resultado.evidenciaContextual.regex.conteo,
      operador: resultado.evidenciaContextual.regex.operador,
      umbral: resultado.evidenciaContextual.regex.umbral
    },
    { modo: 'conteo', conteo: 2, operador: '=', umbral: 2 }
  );
  assert.equal(resultado.evidenciaContextual.regex.coincidenciaEncontrada, true);
  assert.equal(resultado.evidenciaContextual.regex.patronSha256.length, 64);
  assert.doesNotMatch(JSON.stringify(resultado), /SECRETO-CONTEO-52410/u);
}

async function verificarPrevisualizacionYEditor() {
  const servicio = crearServicioPrevisualizacion();
  const controlador = new ControladorReglasDerivacionTelemetria({
    servicioAdministracionReglas: servicio
  });
  const respuesta = respuestaJson();
  await controlador.previsualizarCondicion({
    params: { id: '7' },
    body: {
      senal_id: '23',
      condicion_tipo: 'texto_regex',
      regex_modo: 'conteo',
      regex_patron: 'error\\s+\\d+',
      regex_opciones: 'i',
      operador: '=',
      regex_umbral: '2',
      regex_muestra: muestra
    },
    contextoUsuarioActual: {}
  }, respuesta);
  assert.equal(respuesta.estado, 200);
  assert.equal(respuesta.cuerpo.ok, true);
  assert.deepEqual(respuesta.cuerpo.resultadoMuestra, {
    resultado: 'coincide',
    modo: 'conteo',
    conteo: 2,
    coincidenciaEncontrada: true,
    operador: '=',
    umbral: 2,
    valorEvidencia: `[texto redactado; ${Array.from(muestra).length} caracteres]`
  });
  assert.doesNotMatch(JSON.stringify(respuesta.cuerpo), /SECRETO-CONTEO-52410/u);

  const runtime = evaluarConteo({
    patron: 'error\\s+\\d+',
    opciones: ['i'],
    operador: '=',
    umbral: 2,
    valor: muestra
  });
  assert.equal(
    respuesta.cuerpo.resultadoMuestra.conteo,
    runtime.evidenciaContextual.regex.conteo
  );
  assert.equal(
    respuesta.cuerpo.resultadoMuestra.resultado,
    runtime.resultado
  );

  const excedida = respuestaJson();
  await controlador.previsualizarCondicion({
    params: { id: '7' },
    body: {
      senal_id: '23',
      condicion_tipo: 'texto_regex',
      regex_modo: 'conteo',
      regex_patron: 'x',
      regex_opciones: [],
      operador: '>=',
      regex_umbral: '1',
      regex_muestra: `SECRETO-PREVIEW-52410${'x'.repeat(2048)}`
    },
    contextoUsuarioActual: {}
  }, excedida);
  assert.equal(excedida.estado, 400);
  assert.doesNotMatch(JSON.stringify(excedida.cuerpo), /SECRETO-PREVIEW-52410/u);

  const [formulario, js, controladorFuente] = await Promise.all([
    leer('apps/sentinelia-web/src/views/parciales/formulario-revision-regla-telemetria.ejs'),
    leer('apps/sentinelia-web/src/public/js/agente-reglas.js'),
    leer('apps/sentinelia-web/src/controladores/ControladorReglasDerivacionTelemetria.js')
  ]);
  assert.match(formulario, /name="regex_modo"/u);
  assert.match(formulario, /\['conteo', 'Contar coincidencias'\]/u);
  assert.match(formulario, /name="regex_umbral"/u);
  assert.match(formulario, /name="regex_muestra"/u);
  assert.match(js, /Number\.isSafeInteger\(umbral\)/u);
  assert.match(js, /muestra\.conteo/u);
  assert.doesNotMatch(js, /new\s+RegExp|RegExp\s*\(/u);
  assert.match(controladorFuente, /construirMuestraTexto/u);
}

function verificarFederacionYReconstruccion() {
  const generador = new GeneradorIdentidadesFederadas({
    fuenteEntropia: new FuenteEntropiaCriptograficaNode()
  });
  const id = () => String(generador.generar(
    TIPOS_IDENTIDAD_FEDERADA.ELEMENTO_ORIGEN
  ));
  const runtime = evaluarConteo({
    patron: 'error\\s+\\d+',
    opciones: ['i'],
    operador: '=',
    umbral: 2,
    valor: muestra
  });
  const payload = payloadReglaConteo({
    fuente: id(),
    senal: id(),
    revision: id(),
    observacion: id(),
    resultado: runtime.serializar()
  });
  const validado = validarPayloadTelemetriaFederacion(payload);
  assert.equal(validado.version, 1);
  assert.deepEqual(validado.revisiones[0].condicion.configuracion, {
    modo: 'conteo',
    patron: 'error\\s+\\d+',
    opciones: ['i'],
    operador: '=',
    umbral: 2
  });
  const reconstruida = evaluarCondicionRegexTelemetria({
    configuracion: validado.revisiones[0].condicion.configuracion,
    texto: muestra
  });
  assert.equal(reconstruida.evidencia.conteo, 2);
  assert.equal(reconstruida.cumple, true);
  assert.doesNotMatch(JSON.stringify(validado), /SECRETO-CONTEO-52410/u);
}

function verificarComposicionConMonitor() {
  const monitor = new EvaluadorFuenteReglaMonitorTelemetria();
  const vinculo = {
    esReglaDerivacion: () => true,
    estadoRegla: 'activa',
    fuente: { reglaId: 31 },
    agenteId: 7,
    senalOrigen: { id: 23, tipoDato: 'texto', unidad: null },
    scope: { tenantId: 1, empresaId: 2, sitioId: 3 }
  };
  const base = evaluarConteo({
    patron: 'error', opciones: ['i'], operador: '>=', umbral: 2, valor: muestra
  }).serializar();
  assert.equal(monitor.evaluar({ vinculo, estadoActualRegla: base }).esFallo(), true);
  assert.equal(monitor.evaluar({
    vinculo,
    estadoActualRegla: { ...base, resultado: 'no_coincide', severidadCalculada: null }
  }).esNormal(), true);
  assert.equal(monitor.evaluar({
    vinculo,
    estadoActualRegla: {
      ...base,
      resultado: 'no_evaluable',
      codigoMotivo: 'valor_no_evaluable',
      severidadCalculada: null
    }
  }).esDesconocido(), true);
}

async function verificarFalloTecnicoReintentable() {
  const condicion = crearCondicionConteo({
    patron: '', opciones: [], operador: '>=', umbral: 1
  });
  const { regla, revision } = crearReglaYRevision(condicion);
  let falloRegistrado = null;
  const trabajo = {
    id: 701,
    estado: 'procesando',
    intentos: 1,
    reglaId: regla.id,
    reglaRevisionId: revision.id,
    observacionId: 501,
    agenteId: 7,
    senalId: 23,
    tenantId: 1,
    empresaId: 2,
    sitioId: 3,
    recibidoEnUtc: '2026-08-26T10:00:02Z'
  };
  const procesador = new ProcesadorTrabajosEvaluacionTelemetria({
    repositorioTrabajos: {
      async registrarErrorTecnico(datos) {
        falloRegistrado = datos;
        return {
          registrado: true,
          siguienteIntentoUtc: '2026-08-26T10:00:08Z'
        };
      }
    },
    repositorioReglas: {
      async buscarPorId() { return { regla }; },
      async buscarRevisionPorId() { return revision; }
    },
    repositorioObservaciones: {
      async buscarPorId() {
        return {
          id: 501,
          agenteId: 7,
          senalId: 23,
          tipoDato: 'texto',
          unidad: null,
          calidad: 'valida',
          valorTexto: 'x'.repeat(2048),
          observadoEnUtc: '2026-08-26T10:00:01Z',
          recibidoEnUtc: '2026-08-26T10:00:02Z'
        };
      }
    },
    repositorioCatalogoSenales: {
      async buscarPorId() { return senalTexto; }
    },
    proyectorEvaluaciones: {},
    evaluador,
    reloj: () => new Date('2026-08-26T10:00:03Z')
  });
  const resultado = await procesador.procesar({
    trabajo,
    reclamadoPor: 'verificador-5.24.10'
  });
  assert.equal(resultado.ok, false);
  assert.equal(resultado.error.codigo, 'presupuesto_regex_agotado');
  assert.equal(falloRegistrado.codigoError, 'presupuesto_regex_agotado');
  assert.equal(resultado.errorRegistrado, true);
  assert.equal(resultado.demoraReintentoSegundos, 5);
}

async function verificarPersistenciaSql() {
  const configuracion = obtenerConfiguracionAplicacion();
  assert.equal(configuracion.sql.estaCompleta, true);
  const baseDatos = `sentinelia_fixture_52410_${randomBytes(6).toString('hex')}`;
  const administrador = new ClienteSql(configuracion.sql);
  await administrador.ejecutar(
    `CREATE DATABASE ${administrador.escaparIdentificador(baseDatos)} ` +
    'CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci'
  );
  const sql = new ClienteSql({ ...configuracion.sql, baseDatos });
  try {
    const migraciones = new RepositorioMigraciones(sql);
    await new EjecutorMigraciones({
      clienteSql: sql,
      repositorioMigraciones: migraciones,
      rutaMigraciones: obtenerRutaMigraciones()
    }).ejecutarPendientes();
    const aplicadas = await migraciones.listarAplicadas();
    assert.equal(
      aplicadas.has('0001_esquema_inicial.sql'),
      true,
      'La regresión regex exige que el esquema inicial consolidado esté aplicado.'
    );
    await verificarRevisionConteo(sql, await crearAgente(sql));
  } finally {
    await sql.cerrar();
    await administrador.ejecutar(
      `DROP DATABASE IF EXISTS ${administrador.escaparIdentificador(baseDatos)}`
    ).catch(() => {});
    await administrador.cerrar();
  }
}

async function verificarRevisionConteo(sql, agente) {
  const catalogo = new RepositorioCatalogoSenalesTelemetriaAgentes(sql);
  const reglas = new RepositorioReglasDerivacionTelemetria(sql);
  const senal = await catalogo.guardarDeclaracionSenal({
    agenteId: agente.id,
    definicion: {
      categoria: 'copias',
      clave: 'resultado',
      tipoDato: 'texto',
      unidad: null,
      nombreHumano: 'Resultado de la copia'
    }
  });
  const creada = await reglas.crearConRevisionInicial({
    agenteId: agente.id,
    senalId: senal.id,
    tenantId: agente.tenantId,
    empresaId: agente.empresaId,
    sitioId: agente.sitioId,
    revision: revisionConteo(senal, 'error', ['i'], '>=', 2, 'Dos errores')
  });
  const rehidratada = await reglas.buscarPorId(creada.regla.id);
  assert.deepEqual(rehidratada.revisionVigente.condicion.configuracion, {
    modo: 'conteo',
    patron: 'error',
    opciones: ['i'],
    operador: '>=',
    umbral: 2
  });
  const segunda = await reglas.crearNuevaRevision({
    reglaId: creada.regla.id,
    revision: revisionConteo(senal, '^fallo$', ['m'], '=', 1, 'Un fallo')
  });
  assert.equal(segunda.numero, 2);
  const revisiones = await reglas.listarRevisionesPorRegla(creada.regla.id);
  assert.equal(revisiones.length, 2);
  assert.deepEqual(
    new Set(revisiones.map((revision) => revision.condicion.configuracion.umbral)),
    new Set([1, 2])
  );
}

function contar({ patron, opciones = [], texto }) {
  return contarCoincidenciasRegexTelemetria({
    patron,
    opciones,
    texto,
    operador: '>=',
    umbral: 0
  });
}

function crearCondicionConteo({ patron, opciones, operador, umbral }) {
  return crearCondicionTipadaDerivacionTelemetria({
    senal: senalTexto,
    tipo: 'texto_regex',
    modo: 'conteo',
    patron,
    opciones,
    operador,
    umbral
  });
}

function evaluarConteo({ patron, opciones, operador, umbral, valor }) {
  const condicion = crearCondicionConteo({ patron, opciones, operador, umbral });
  const { regla, revision } = crearReglaYRevision(condicion);
  return evaluador.evaluar({
    regla,
    revision,
    senal: senalTexto,
    observacion: {
      id: 501,
      agenteId: 7,
      senalId: 23,
      valor,
      tipoDato: 'texto',
      unidad: null,
      calidad: 'valida',
      observadoEnUtc: '2026-08-26T10:00:01Z',
      recibidoEnUtc: '2026-08-26T10:00:02Z'
    },
    evaluadoEnUtc: '2026-08-26T10:00:03Z'
  });
}

function crearReglaYRevision(condicion) {
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
    mensajeOperativo: 'El texto alcanza el conteo configurado.',
    nombre: 'Conteo de errores',
    vigenteDesdeUtc: '2026-08-26T10:00:00Z'
  });
  return { regla, revision };
}

function crearServicioPrevisualizacion() {
  return new ServicioAdministracionReglasDerivacionTelemetria({
    repositorioAgentes: {
      async buscarPorId() {
        return { id: 7, tenantId: 1, empresaId: 2, sitioId: 3, nombre: 'Agente' };
      }
    },
    repositorioCatalogoSenales: {
      async buscarPorId() { return senalTexto; }
    },
    repositorioReglas: {},
    politicaPermisosAgentes: {
      assertPuedeModificar() {},
      puedeAlcanzarAgente() { return true; }
    }
  });
}

function revisionConteo(senal, patron, opciones, operador, umbral, nombre) {
  return {
    condicion: crearCondicionTipadaDerivacionTelemetria({
      senal,
      tipo: 'texto_regex',
      modo: 'conteo',
      patron,
      opciones,
      operador,
      umbral
    }),
    severidadCalculada: 'advertencia',
    mensajeOperativo: 'El texto alcanza el conteo configurado.',
    nombre,
    descripcion: null,
    metadatos: null
  };
}

function payloadReglaConteo({ fuente, senal, revision, observacion, resultado }) {
  const condicion = {
    tipo: 'texto_regex',
    version: 1,
    configuracion: {
      modo: 'conteo',
      patron: 'error\\s+\\d+',
      opciones: ['i'],
      operador: '=',
      umbral: 2
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
      condicionTipo: 'texto_regex',
      condicionVersion: '1',
      condicion,
      severidadCalculada: 'advertencia',
      mensajeOperativo: 'El texto alcanza el conteo configurado.',
      nombre: 'Conteo de errores',
      descripcion: null,
      metadatosDescriptivos: null,
      vigenteDesdeUtc: '2026-08-26T10:00:00.000Z',
      vigenteHastaUtc: null
    }],
    estadoActual: {
      revisionOrigenId: revision,
      observacionOrigenId: observacion,
      resultado: resultado.resultado,
      codigoMotivo: resultado.codigoMotivo,
      explicacion: resultado.explicacion,
      valorEvaluado: resultado.valorEvaluado,
      tipoDato: resultado.tipoDato,
      unidad: '',
      calidad: resultado.calidad,
      severidadCalculada: resultado.severidadCalculada,
      mensajeOperativo: resultado.mensajeOperativo,
      evidenciaContextual: resultado.evidenciaContextual,
      observadoEnUtc: '2026-08-26T10:00:01.000Z',
      recibidoEnUtc: '2026-08-26T10:00:02.000Z',
      evaluadoEnUtc: '2026-08-26T10:00:03.000Z'
    }
  };
}

async function crearAgente(sql) {
  const alias = `fixture-52410-${randomBytes(4).toString('hex')}`;
  const [tenant] = await sql.ejecutar(
    'INSERT INTO tenants (nombre, alias) VALUES (?, ?)',
    ['Tenant 5.24.10', alias]
  );
  const [empresa] = await sql.ejecutar(
    'INSERT INTO empresas (tenant_id, nombre, alias) VALUES (?, ?, ?)',
    [tenant.insertId, 'Empresa 5.24.10', alias]
  );
  const [sitio] = await sql.ejecutar(
    'INSERT INTO sitios (tenant_id, empresa_id, nombre, alias) VALUES (?, ?, ?, ?)',
    [tenant.insertId, empresa.insertId, 'Sitio 5.24.10', alias]
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
      'Agente regex conteo 5.24.10',
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

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
  crearCondicionTipadaDerivacionTelemetria
} from '../paquetes/agentes/src/EvaluadorCondicionesDerivacionTelemetria.js';
import {
  CONTRATO_MOTOR_REGEX_TELEMETRIA,
  LIMITES_REGEX_TELEMETRIA,
  evaluarExistenciaRegexTelemetria,
  normalizarPatronRegexTelemetria
} from '../paquetes/agentes/src/MotorRegexSeguroTelemetria.js';
import {
  RepositorioCatalogoSenalesTelemetriaAgentes
} from '../paquetes/agentes/src/RepositorioCatalogoSenalesTelemetriaAgentes.js';
import {
  RepositorioReglasDerivacionTelemetria
} from '../paquetes/agentes/src/RepositorioReglasDerivacionTelemetria.js';
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
const textoSensible = 'SECRETO-FISCAL-5249 error 417 en cliente reservado';

await main();

async function main() {
  await verificarMotorFijadoEnImagen();
  verificarContratoSeguroYLimites();
  verificarEvaluacionYRedaccion();
  await verificarAdministracionYUi();
  verificarFederacionV1();
  verificarComposicionConMonitor();
  await verificarPersistenciaSql();
  console.log(
    '[agentes] OK 5.24.9: condicion=texto_regex@1 modo=existe motor=re2-wasm@1.0.2 ' +
    'unicode=si opciones=i,m,s limites=256/2048 preview=servidor runtime=mismo_motor ' +
    'evidencia=redactada federacion=v1 monitor=ternario sql=rehidratacion_segura'
  );
}

async function verificarMotorFijadoEnImagen() {
  const [packageJson, lock, paqueteMotor, wasm, fuenteMotor, dockerfile] = await Promise.all([
    leer('package.json').then(JSON.parse),
    leer('package-lock.json').then(JSON.parse),
    leer('node_modules/re2-wasm/package.json').then(JSON.parse),
    leerBinario('node_modules/re2-wasm/build/wasm/re2.wasm'),
    leer('paquetes/agentes/src/MotorRegexSeguroTelemetria.js'),
    leer('despliegue/docker/node-bind/Dockerfile')
  ]);
  assert.match(dockerfile, /^FROM node:24-bookworm-slim$/mu);
  assert.equal(typeof WebAssembly, 'object');
  assert.equal(packageJson.dependencies['re2-wasm'], '1.0.2');
  assert.equal(lock.packages['node_modules/re2-wasm'].version, '1.0.2');
  assert.equal(lock.packages['node_modules/re2-wasm'].license, 'Apache-2.0');
  assert.match(lock.packages['node_modules/re2-wasm'].integrity, /^sha512-/u);
  assert.equal(paqueteMotor.version, '1.0.2');
  assert.equal(paqueteMotor.license, 'Apache-2.0');
  assert.equal(wasm.subarray(0, 4).toString('hex'), '0061736d');
  assert.deepEqual(CONTRATO_MOTOR_REGEX_TELEMETRIA, {
    motor: 're2-wasm',
    version: '1.0.2',
    licencia: 'Apache-2.0',
    unicode: true
  });
  assert.match(fuenteMotor, /from 're2-wasm'/u);
  assert.doesNotMatch(fuenteMotor, /new\s+RegExp|RegExp\s*\(/u);
  assert.doesNotMatch(fuenteMotor, /\.replace\s*\(|callback/iu);
}

function verificarContratoSeguroYLimites() {
  assert.deepEqual(normalizarPatronRegexTelemetria({
    patron: 'error\\s+\\p{N}+',
    opciones: ['i', 'm', 's']
  }), {
    patron: 'error\\s+\\p{N}+',
    opciones: ['i', 'm', 's'],
    longitudPatron: 14
  });
  assert.equal(
    evaluarExistenciaRegexTelemetria({
      patron: '\\p{L}+',
      opciones: [],
      texto: 'áβ'
    }).coincide,
    true
  );
  assert.equal(evaluarExistenciaRegexTelemetria({
    patron: '^error$', opciones: ['i', 'm'], texto: 'inicio\nERROR\nfin'
  }).coincide, true);
  assert.equal(evaluarExistenciaRegexTelemetria({
    patron: 'a.b', opciones: ['s'], texto: 'a\nb'
  }).coincide, true);

  const limitePatron = '😀'.repeat(
    LIMITES_REGEX_TELEMETRIA.PATRON_CARACTERES_UNICODE
  );
  assert.equal(normalizarPatronRegexTelemetria({
    patron: limitePatron,
    opciones: []
  }).longitudPatron, 256);
  assert.throws(
    () => normalizarPatronRegexTelemetria({
      patron: `${limitePatron}😀`,
      opciones: []
    }),
    (error) => error.codigo === 'patron_regex_demasiado_largo'
  );
  assert.equal(evaluarExistenciaRegexTelemetria({
    patron: '😀',
    opciones: [],
    texto: '😀'.repeat(LIMITES_REGEX_TELEMETRIA.TEXTO_CARACTERES)
  }).coincide, true);
  assert.throws(
    () => evaluarExistenciaRegexTelemetria({
      patron: '😀',
      opciones: [],
      texto: '😀'.repeat(LIMITES_REGEX_TELEMETRIA.TEXTO_CARACTERES + 1)
    }),
    (error) => error.codigo === 'texto_regex_no_evaluable'
  );

  for (const patron of ['(SECRETO-5249)\\1', '(?=SECRETO-5249)']) {
    assert.throws(
      () => normalizarPatronRegexTelemetria({ patron, opciones: [] }),
      (error) => {
        assert.equal(error.codigo, 'patron_regex_invalido');
        assert.doesNotMatch(error.message, /SECRETO-5249/u);
        return true;
      }
    );
  }
  for (const opciones of [['m', 'i'], ['i', 'i'], ['g'], 'i']) {
    assert.throws(
      () => normalizarPatronRegexTelemetria({ patron: 'error', opciones }),
      /lista canónica|sin repetir y en ese orden/iu
    );
  }

  const condicion = crearCondicionRegex('error\\s+\\d+', ['i']);
  assert.deepEqual(condicion.serializar(), {
    tipo: 'texto_regex',
    version: 1,
    configuracion: {
      modo: 'existe',
      patron: 'error\\s+\\d+',
      opciones: ['i'],
      operador: null,
      umbral: null
    }
  });
  assert.throws(
    () => crearCondicionTipadaDerivacionTelemetria({
      senal: { ...senalTexto, tipoDato: 'estado' },
      tipo: 'texto_regex',
      modo: 'existe',
      patron: 'error',
      opciones: []
    }),
    /coincidir exactamente/iu
  );
}

function verificarEvaluacionYRedaccion() {
  const coincide = evaluarRegex({
    patron: 'error\\s+\\d+',
    opciones: ['i'],
    valor: textoSensible
  });
  assert.equal(coincide.resultado, 'coincide');
  assert.equal(coincide.codigoMotivo, 'condicion_cumplida');
  assert.match(coincide.valorEvaluado, /^\[texto redactado; \d+ caracteres\]$/u);
  assert.equal(coincide.evidenciaContextual.regex.modo, 'existe');
  assert.equal(coincide.evidenciaContextual.regex.coincidenciaEncontrada, true);
  assert.equal(coincide.evidenciaContextual.regex.conteo, null);
  assert.equal(coincide.evidenciaContextual.regex.operador, null);
  assert.equal(coincide.evidenciaContextual.regex.umbral, null);
  assert.equal(coincide.evidenciaContextual.regex.patronSha256.length, 64);
  assert.doesNotMatch(JSON.stringify(coincide), /SECRETO-FISCAL-5249/u);

  const noCoincide = evaluarRegex({
    patron: '^correcto$',
    opciones: [],
    valor: textoSensible
  });
  assert.equal(noCoincide.resultado, 'no_coincide');
  assert.doesNotMatch(JSON.stringify(noCoincide), /SECRETO-FISCAL-5249/u);

  const demasiadoLargo = evaluarRegex({
    patron: 'error',
    opciones: [],
    valor: 'SECRETO-LARGO-5249' +
      'x'.repeat(LIMITES_REGEX_TELEMETRIA.TEXTO_CARACTERES)
  });
  assert.equal(demasiadoLargo.resultado, 'no_evaluable');
  assert.equal(demasiadoLargo.codigoMotivo, 'valor_no_evaluable');
  assert.match(demasiadoLargo.valorEvaluado, /^\[texto redactado;/u);
  assert.doesNotMatch(JSON.stringify(demasiadoLargo), /SECRETO-LARGO-5249/u);
}

async function verificarAdministracionYUi() {
  let recibida = null;
  const controlador = new ControladorReglasDerivacionTelemetria({
    servicioAdministracionReglas: {
      async previsualizarCondicion(_contexto, datos) {
        recibida = datos;
        const condicion = crearCondicionTipadaDerivacionTelemetria({
          senal: senalTexto,
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
      condicion_tipo: 'texto_regex',
      regex_patron: 'error\\s+\\d+',
      regex_opciones: ['i', 'm']
    },
    contextoUsuarioActual: {}
  }, respuesta);
  assert.equal(respuesta.estado, 200);
  assert.equal(respuesta.cuerpo.ok, true);
  assert.deepEqual(recibida.condicion, {
    tipo: 'texto_regex',
    version: 1,
    operador: null,
    modo: 'existe',
    patron: 'error\\s+\\d+',
    opciones: ['i', 'm'],
    umbral: null
  });
  assert.equal(
    respuesta.cuerpo.condicionCanonica,
    crearCondicionRegex('error\\s+\\d+', ['i', 'm']).obtenerCanonica()
  );

  const invalida = respuestaJson();
  await controlador.previsualizarCondicion({
    params: { id: '7' },
    body: {
      senal_id: '23',
      condicion_tipo: 'texto_regex',
      regex_patron: '(?=SECRETO-PREVIEW-5249)',
      regex_opciones: []
    },
    contextoUsuarioActual: {}
  }, invalida);
  assert.equal(invalida.estado, 400);
  assert.doesNotMatch(JSON.stringify(invalida.cuerpo), /SECRETO-PREVIEW-5249/u);

  const [formulario, js] = await Promise.all([
    leer('apps/sentinelia-web/src/views/parciales/formulario-revision-regla-telemetria.ejs'),
    leer('apps/sentinelia-web/src/public/js/agente-reglas.js')
  ]);
  assert.match(formulario, /\['texto_regex', 'Texto por patrón seguro'\]/u);
  assert.match(formulario, /name="regex_patron"/u);
  assert.match(formulario, /name="regex_opciones" value="<%= opcion\[0\] %>"/u);
  assert.match(js, /senal\.tipo === 'texto' \? \['texto_regex'\]/u);
  assert.match(js, /\[\.\.\.entradaPatronRegex\.value\]\.length/u);
  assert.match(js, /fetch\(formulario\.dataset\.previewUrl/u);
  assert.doesNotMatch(js, /new\s+RegExp|RegExp\s*\(/u);
}

function verificarFederacionV1() {
  const generador = new GeneradorIdentidadesFederadas({
    fuenteEntropia: new FuenteEntropiaCriptograficaNode()
  });
  const id = () => String(generador.generar(
    TIPOS_IDENTIDAD_FEDERADA.ELEMENTO_ORIGEN
  ));
  const payload = payloadReglaRegex({
    fuente: id(),
    senal: id(),
    revision: id(),
    observacion: id()
  });
  const validado = validarPayloadTelemetriaFederacion(payload);
  assert.equal(validado.version, 1);
  assert.equal(validado.revisiones[0].condicion.tipo, 'texto_regex');
  assert.deepEqual(validado.revisiones[0].condicion.configuracion, {
    modo: 'existe',
    patron: 'error\\s+\\d+',
    opciones: ['i'],
    operador: null,
    umbral: null
  });
  assert.match(validado.estadoActual.valorEvaluado, /^\[texto redactado;/u);
  assert.doesNotMatch(JSON.stringify(validado), /SECRETO-FISCAL-5249/u);
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
  const base = evaluarRegex({
    patron: 'error', opciones: ['i'], valor: textoSensible
  }).serializar();
  const coincide = monitor.evaluar({ vinculo, estadoActualRegla: base });
  const noCoincide = monitor.evaluar({
    vinculo,
    estadoActualRegla: { ...base, resultado: 'no_coincide', severidadCalculada: null }
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
  assert.match(coincide.evidencia.observacion.valor, /^\[texto redactado;/u);
  assert.doesNotMatch(JSON.stringify(coincide), /SECRETO-FISCAL-5249/u);
}

async function verificarPersistenciaSql() {
  const configuracion = obtenerConfiguracionAplicacion();
  assert.equal(
    configuracion.sql.estaCompleta,
    true,
    '5.24.9 necesita SQL real para probar migración y rehidratación.'
  );
  const baseDatos = `sentinelia_fixture_5249_${randomBytes(6).toString('hex')}`;
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
    await verificarEnumYRehidratacion(sql, await crearAgente(sql));
  } finally {
    await sql.cerrar();
    await administrador.ejecutar(
      `DROP DATABASE IF EXISTS ${administrador.escaparIdentificador(baseDatos)}`
    ).catch(() => {});
    await administrador.cerrar();
  }
}

async function verificarEnumYRehidratacion(sql, agente) {
  const [columna] = await sql.consultar(
    `SELECT column_type
       FROM information_schema.columns
      WHERE table_schema = DATABASE()
        AND table_name = 'revisiones_reglas_derivacion_telemetria'
        AND column_name = 'condicion_tipo'`
  );
  assert.match(columna.column_type, /'texto_regex'/u);

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
    revision: revisionRegex(senal, 'error\\s+\\d+', ['i'], 'Error de copia')
  });
  const rehidratada = await reglas.buscarPorId(creada.regla.id);
  assert.equal(rehidratada.revisionVigente.condicion.tipo, 'texto_regex');
  assert.deepEqual(
    rehidratada.revisionVigente.condicion.configuracion.opciones,
    ['i']
  );

  const [{ total: antes }] = await sql.consultar(
    'SELECT COUNT(*) AS total FROM revisiones_reglas_derivacion_telemetria WHERE regla_id = ?',
    [creada.regla.id]
  );
  assert.throws(
    () => revisionRegex(senal, '(?=SECRETO-SQL-5249)', [], 'Inválida'),
    (error) => {
      assert.doesNotMatch(error.message, /SECRETO-SQL-5249/u);
      return true;
    }
  );
  const [{ total: despues }] = await sql.consultar(
    'SELECT COUNT(*) AS total FROM revisiones_reglas_derivacion_telemetria WHERE regla_id = ?',
    [creada.regla.id]
  );
  assert.equal(Number(despues), Number(antes));

  const segunda = await reglas.crearNuevaRevision({
    reglaId: creada.regla.id,
    revision: revisionRegex(senal, '^correcto$', ['m'], 'Recuperada')
  });
  assert.equal(segunda.numero, 2);
  const revisiones = await reglas.listarRevisionesPorRegla(creada.regla.id);
  assert.equal(revisiones.length, 2);
  const patronesPorNumero = new Map(
    revisiones.map((revision) => [
      revision.numero,
      revision.condicion.configuracion.patron
    ])
  );
  assert.equal(patronesPorNumero.get(1), 'error\\s+\\d+');
  assert.equal(patronesPorNumero.get(2), '^correcto$');
}

function evaluarRegex({ patron, opciones, valor }) {
  const condicion = crearCondicionRegex(patron, opciones);
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
    mensajeOperativo: 'El texto contiene el patrón configurado.',
    nombre: 'Patrón en resultado de copia',
    vigenteDesdeUtc: '2026-08-26T10:00:00Z'
  });
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

function crearCondicionRegex(patron, opciones) {
  return crearCondicionTipadaDerivacionTelemetria({
    senal: senalTexto,
    tipo: 'texto_regex',
    modo: 'existe',
    patron,
    opciones
  });
}

function revisionRegex(senal, patron, opciones, nombre) {
  return {
    condicion: crearCondicionTipadaDerivacionTelemetria({
      senal,
      tipo: 'texto_regex',
      modo: 'existe',
      patron,
      opciones
    }),
    severidadCalculada: 'advertencia',
    mensajeOperativo: 'El texto contiene el patrón configurado.',
    nombre,
    descripcion: null,
    metadatos: null
  };
}

function payloadReglaRegex({ fuente, senal, revision, observacion }) {
  const condicion = {
    tipo: 'texto_regex',
    version: 1,
    configuracion: {
      modo: 'existe',
      patron: 'error\\s+\\d+',
      opciones: ['i'],
      operador: null,
      umbral: null
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
      mensajeOperativo: 'El texto contiene el patrón configurado.',
      nombre: 'Patrón en resultado de copia',
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
      valorEvaluado: '[texto redactado; 52 caracteres]',
      tipoDato: 'texto',
      unidad: '',
      calidad: 'valida',
      severidadCalculada: 'advertencia',
      mensajeOperativo: 'El texto contiene el patrón configurado.',
      evidenciaContextual: {
        regex: {
          motor: 're2-wasm',
          versionMotor: '1.0.2',
          modo: 'existe',
          opciones: ['i'],
          patronSha256: '1'.repeat(64),
          longitudPatron: 12,
          longitudTexto: 52,
          coincidenciaEncontrada: true,
          conteo: null,
          operador: null,
          umbral: null
        }
      },
      observadoEnUtc: '2026-08-26T10:00:01.000Z',
      recibidoEnUtc: '2026-08-26T10:00:02.000Z',
      evaluadoEnUtc: '2026-08-26T10:00:03.000Z'
    }
  };
}

async function crearAgente(sql) {
  const alias = `fixture-5249-${randomBytes(4).toString('hex')}`;
  const [tenant] = await sql.ejecutar(
    'INSERT INTO tenants (nombre, alias) VALUES (?, ?)',
    ['Tenant 5.24.9', alias]
  );
  const [empresa] = await sql.ejecutar(
    'INSERT INTO empresas (tenant_id, nombre, alias) VALUES (?, ?, ?)',
    [tenant.insertId, 'Empresa 5.24.9', alias]
  );
  const [sitio] = await sql.ejecutar(
    'INSERT INTO sitios (tenant_id, empresa_id, nombre, alias) VALUES (?, ?, ?, ?)',
    [tenant.insertId, empresa.insertId, 'Sitio 5.24.9', alias]
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
      'Agente regex 5.24.9',
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

async function leerBinario(ruta) {
  return readFile(new URL(`../${ruta}`, import.meta.url));
}

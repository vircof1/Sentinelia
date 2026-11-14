import assert from 'node:assert/strict';
import { ServicioMonitores } from '../paquetes/monitores/src/ServicioMonitores.js';
import { ValidadorMonitor } from '../paquetes/monitores/src/ValidadorMonitor.js';
import { crearConfiguracionMonitorLogicoBase } from '../paquetes/monitores/src/ConfiguracionMonitorLogico.js';
import { normalizarDependenciasMonitorLogico } from '../paquetes/monitores/src/DependenciasMonitorLogico.js';
import {
  validarEventoAuditableV1,
  validarParMovimientoAuditoriaV1
} from '../paquetes/auditoria/src/ValidadorContratoAuditoria.js';
import {
  prepararIntencionAuditoriaV1
} from '../paquetes/auditoria/src/HuellaIntencionAuditoria.js';

async function main() {
  await verificarCreacionLogicaAuditable();
  await verificarCambioDependenciaYGrafoAuditable();
  await verificarMovimientoScopeLogicoAuditable();
  await verificarEliminacionLogicaAuditable();

  console.log(
    '[monitores] OK 5.21.10b: logicos=auditable dependencias=diff grafo=sin_resultados scope=movimiento eliminacion=fotografia'
  );
}

async function verificarCreacionLogicaAuditable() {
  const entorno = crearEntorno();

  const monitor = await entorno.servicio.crearMonitor(
    contextoPortal(),
    datosLogico({ monitorId: 200 })
  );

  assert.equal(monitor.id, 300);
  assert.deepEqual(entorno.traza, [
    'begin',
    'sql:crear:booleano',
    'audit:monitor.creado:principal',
    'commit',
    'catalogo:version'
  ]);

  const evento = entorno.auditoria.eventos[0];
  assert.equal(evento.tipo, 'monitor.creado');
  assert.equal(evento.payload.despues.tipo, 'booleano');
  assert.equal(evento.payload.despues.configuracion.expresion, 'A');
  assert.deepEqual(evento.payload.despues.configuracion.variables, ['A']);
  assert.deepEqual(evento.payload.despues.configuracion.variablesUsadas, ['A']);
  assert.deepEqual(evento.payload.despues.configuracion.dependencias, [
    { variable: 'A', fuente: 'monitor', monitorId: 200, etiqueta: 'API' }
  ]);
  assert.equal(
    evento.payload.despues.configuracion.layoutVisual.grafoLogico.expresionCompilada,
    'A'
  );
  assert.equal(
    evento.payload.despues.configuracion.layoutVisual.grafoLogico.valido,
    true
  );
  assert.equal(
    evento.payload.despues.configuracion.layoutVisual.nodos[0].x,
    '10.5'
  );
  assert.equal(
    evento.payload.despues.configuracion.layoutVisual.grafoLogico.nodos[0].x,
    '10.5'
  );
  assertSinResultadosEvaluacion(evento.payload);
}

async function verificarCambioDependenciaYGrafoAuditable() {
  const entorno = crearEntorno();
  entorno.monitores.set(300, monitorLogicoFixture({
    id: 300,
    configuracion: configuracionLogica({ monitorId: 200, etiqueta: 'API' })
  }));

  await entorno.servicio.actualizarMonitor(
    contextoPortal(),
    300,
    datosLogico({ monitorId: 201, etiqueta: 'Base de datos', xEntrada: 25 })
  );

  assert.deepEqual(entorno.traza, [
    'begin',
    'sql:actualizar:booleano',
    'audit:monitor.actualizado:principal',
    'commit',
    'catalogo:version'
  ]);

  const evento = entorno.auditoria.eventos[0];
  assert.equal(evento.tipo, 'monitor.actualizado');
  assert.deepEqual(evento.payload.camposCambiados, ['configuracion']);
  assert.equal(evento.payload.antes.configuracion.dependencias[0].monitorId, 200);
  assert.equal(evento.payload.despues.configuracion.dependencias[0].monitorId, 201);
  assert.equal(evento.payload.antes.configuracion.dependencias[0].etiqueta, 'API');
  assert.equal(
    evento.payload.despues.configuracion.dependencias[0].etiqueta,
    'Base de datos'
  );
  assert.equal(evento.payload.antes.configuracion.layoutVisual.nodos[0].x, '10.5');
  assert.equal(evento.payload.despues.configuracion.layoutVisual.nodos[0].x, 25);
  assertSinResultadosEvaluacion(evento.payload);
}

async function verificarMovimientoScopeLogicoAuditable() {
  const entorno = crearEntorno();
  entorno.monitores.set(300, monitorLogicoFixture({
    id: 300,
    sitioId: null,
    configuracion: configuracionLogica({ monitorId: 200 })
  }));

  await entorno.servicio.actualizarMonitor(
    contextoPortal(),
    300,
    datosLogico({ monitorId: 200, sitioId: '3', nivelPertenencia: 'sitio' })
  );

  assert.deepEqual(entorno.traza, [
    'begin',
    'sql:actualizar:booleano',
    'audit:monitor.actualizado:principal',
    'audit-mov:scope.entidad_salida/scope.entidad_entrada',
    'commit',
    'catalogo:version'
  ]);

  const [actualizacion, salida, entrada] = entorno.auditoria.eventos;
  assert.equal(actualizacion.tipo, 'monitor.actualizado');
  assert.deepEqual(actualizacion.payload.camposCambiados, ['sitioId']);
  assert.equal(salida.tipo, 'scope.entidad_salida');
  assert.equal(entrada.tipo, 'scope.entidad_entrada');
  assert.deepEqual(salida.payload.scopePropio, {
    tenantId: '1',
    empresaId: '2',
    sitioId: null
  });
  assert.deepEqual(entrada.payload.scopePropio, {
    tenantId: '1',
    empresaId: '2',
    sitioId: '3'
  });
}

async function verificarEliminacionLogicaAuditable() {
  const entorno = crearEntorno();
  entorno.monitores.set(300, monitorLogicoFixture({
    id: 300,
    configuracion: configuracionLogica({ monitorId: 200 })
  }));

  const eliminado = await entorno.servicio.eliminarMonitor(contextoPortal(), 300);

  assert.equal(eliminado, true);
  assert.deepEqual(entorno.traza, [
    'begin',
    'sql:eliminar',
    'audit:monitor.eliminado:principal',
    'commit',
    'catalogo:version'
  ]);

  const evento = entorno.auditoria.eventos[0];
  assert.equal(evento.tipo, 'monitor.eliminado');
  assert.equal(evento.payload.antes.tipo, 'booleano');
  assert.equal(evento.payload.antes.configuracion.dependencias[0].monitorId, 200);
  assert.equal(evento.payload.despues, null);
  assert.equal(evento.payload.impactoResumen, null);
  assertSinResultadosEvaluacion(evento.payload);
}

function crearEntorno() {
  const traza = [];
  const auditoria = {
    eventos: [],
    async registrarEnTransaccion({ intencion }) {
      validarEventoAuditableV1(intencion);
      prepararIntencionAuditoriaV1(intencion);
      traza.push(`audit:${intencion.tipo}:${intencion.rolEvento}`);
      this.eventos.push(intencion);
      return { evento: intencion, estado: 'incorporado' };
    },
    async registrarMovimientoEnTransaccion({ salida, entrada }) {
      validarParMovimientoAuditoriaV1(salida, entrada);
      traza.push(`audit-mov:${salida.tipo}/${entrada.tipo}`);
      this.eventos.push(salida, entrada);
      return { eventos: [salida, entrada], estado: 'incorporado' };
    }
  };
  const entorno = {
    traza,
    auditoria,
    monitores: new Map([
      [200, monitorPingFixture({ id: 200, nombre: 'API' })],
      [201, monitorPingFixture({ id: 201, nombre: 'Base de datos' })]
    ])
  };
  const repositorioMonitores = {
    async buscarPorId(id) {
      return entorno.monitores.get(Number(id)) || null;
    },
    async listarPorIds(ids) {
      return ids
        .map((id) => entorno.monitores.get(Number(id)))
        .filter(Boolean);
    },
    async crear(definicion, { conexion } = {}) {
      assert.ok(conexion);
      traza.push(`sql:crear:${definicion.tipo}`);
      const monitor = monitorLogicoFixture({ id: 300, ...definicion });
      entorno.monitores.set(300, monitor);
      return monitor;
    },
    async actualizarCompleto({ idMonitor, ...definicion }, { conexion } = {}) {
      assert.ok(conexion);
      traza.push(`sql:actualizar:${definicion.tipo}`);
      const monitor = monitorLogicoFixture({ id: idMonitor, ...definicion });
      entorno.monitores.set(Number(idMonitor), monitor);
      return monitor;
    },
    async eliminar(idMonitor, { conexion } = {}) {
      assert.ok(conexion);
      assert.ok(entorno.monitores.has(Number(idMonitor)));
      traza.push('sql:eliminar');
      entorno.monitores.delete(Number(idMonitor));
      return true;
    }
  };
  const fronteraTransaccional = {
    async ejecutar(trabajo) {
      traza.push('begin');
      const resultado = await trabajo({ id: 'conexion-fake' });
      traza.push('commit');
      return resultado;
    }
  };
  entorno.servicio = new ServicioMonitores({
    repositorioMonitores,
    repositorioTenants: {
      async buscarPorId(id) {
        return { id: Number(id) };
      }
    },
    repositorioEmpresas: {
      async buscarPorId(id) {
        return { id: Number(id), tenantId: 1 };
      }
    },
    repositorioSitios: {
      async buscarPorId(id) {
        return { id: Number(id), tenantId: 1, empresaId: 2 };
      }
    },
    repositorioVinculosMonitoresTelemetria: {
      async vincularSenalDirecta() {
        throw new Error('No debe vincular telemetría en monitores lógicos.');
      },
      async eliminarPorMonitorId() {
        throw new Error('No debe desvincular telemetría en monitores lógicos.');
      }
    },
    repositorioAgentes: {},
    repositorioCatalogoSenalesTelemetria: {},
    repositorioEstadoActualTelemetria: {},
    repositorioReglasDerivacionTelemetria: {},
    versionadorCatalogoMonitoresRedis: {
      async incrementarVersion() {
        traza.push('catalogo:version');
      }
    },
    resolutorScopeUsuario: {
      puedeAlcanzarEmpresa() {
        return true;
      },
      puedeAlcanzarSitio() {
        return true;
      }
    },
    validadorMonitor: new ValidadorMonitor(),
    fronteraTransaccional,
    servicioAuditoria: auditoria,
    ahora: () => new Date('2026-07-25T10:00:00.000Z')
  });
  return entorno;
}

function configuracionLogicaDesdeEntrada(entrada) {
  const base = crearConfiguracionMonitorLogicoBase(entrada);
  const dependencias = normalizarDependenciasMonitorLogico(base.dependencias);
  const variables = dependencias.map((dependencia) => dependencia.variable);
  return {
    ...base,
    dependencias,
    variables,
    variablesUsadas: variables,
    expresion: String(base.expresion || '').trim().toUpperCase(),
    resumenDependencias: {
      total: base.dependencias.length
    }
  };
}

function datosLogico({
  monitorId = 200,
  etiqueta = 'API',
  sitioId = '',
  nivelPertenencia = 'empresa',
  xEntrada = 10.5
} = {}) {
  return {
    tenant_id: '1',
    empresa_id: '2',
    sitio_id: sitioId,
    nivel_pertenencia: nivelPertenencia,
    nombre: 'Lógico API',
    tipo: 'booleano',
    descripcion: 'Disponibilidad lógica',
    interpretacion_estado: 'normal',
    descripcion_fallo: 'La dependencia lógica no está disponible',
    posible_solucion: 'Revisar dependencias enlazadas',
    activo: '1',
    intervalo_ejecucion_segundos: '60',
    desfase_inicial_segundos: '0',
    expresion_logica: 'A',
    mensaje_fallo_logico: 'Dependencias no disponibles',
    estado_inicial_logico: 'disponible',
    retardo_senal_segundos_logico: '15',
    dependencias_logicas: JSON.stringify([
      { variable: 'A', fuente: 'monitor', monitorId, etiqueta }
    ]),
    layout_visual_logico: JSON.stringify(layoutVisual({ xEntrada }))
  };
}

function configuracionLogica({ monitorId = 200, etiqueta = 'API', xEntrada = 10.5 } = {}) {
  return configuracionLogicaDesdeEntrada({
    expresion: 'A',
    mensajeFallo: 'Dependencias no disponibles',
    estadoInicial: 'disponible',
    retardoSenalSegundos: 15,
    politicaEntradasIncompletas: 'conservar_salida',
    dependencias: [
      { variable: 'A', fuente: 'monitor', monitorId, etiqueta }
    ],
    layoutVisual: layoutVisual({ xEntrada })
  });
}

function layoutVisual({ xEntrada = 10 } = {}) {
  return {
    version: 1,
    nodos: [
      { id: 'entrada-a', tipo: 'entrada', etiqueta: 'A', variable: 'A', x: xEntrada, y: 20 },
      { id: 'salida', tipo: 'salida', etiqueta: 'Salida', x: 200, y: 20 }
    ],
    conexiones: [
      { desde: 'entrada-a', hasta: 'salida' }
    ],
    grafoLogico: {
      version: 1,
      nodos: [
        { id: 'entrada-a', tipo: 'entrada', etiqueta: 'A', variable: 'A', x: xEntrada, y: 20 },
        { id: 'salida', tipo: 'salida', etiqueta: 'Salida', x: 200, y: 20 }
      ],
      conexiones: [
        { desde: 'entrada-a', hasta: 'salida' }
      ],
      salidaId: 'salida',
      expresionCompilada: 'A',
      variablesUsadas: ['A'],
      valido: true,
      errores: [],
      resultadoSimulacion: true,
      valoresPorNodo: { 'entrada-a': true },
      estadoRuntime: 'disponible'
    },
    resultadoEvaluacion: true
  };
}

function monitorLogicoFixture(datos = {}) {
  return {
    id: 300,
    tenantId: 1,
    empresaId: 2,
    sitioId: null,
    nombre: 'Lógico API',
    tipo: 'booleano',
    descripcion: 'Disponibilidad lógica',
    interpretacionEstado: 'normal',
    descripcionFallo: 'La dependencia lógica no está disponible',
    posibleSolucion: 'Revisar dependencias enlazadas',
    activo: true,
    intervaloEjecucionSegundos: 60,
    desfaseInicialSegundos: 0,
    configuracion: configuracionLogica(),
    ...datos
  };
}

function monitorPingFixture(datos = {}) {
  return {
    id: 200,
    tenantId: 1,
    empresaId: 2,
    sitioId: null,
    nombre: 'API',
    tipo: 'ping',
    descripcion: 'Dependencia API',
    interpretacionEstado: 'normal',
    descripcionFallo: 'No responde',
    posibleSolucion: 'Revisar conectividad',
    activo: true,
    intervaloEjecucionSegundos: 60,
    desfaseInicialSegundos: 0,
    configuracion: {
      host: 'api.example.test',
      timeoutMs: 1200,
      reintentos: 1
    },
    ...datos
  };
}

function contextoPortal() {
  return {
    idUsuario: 7,
    idUsuarioReal: 7,
    nivelScope: 'portal',
    tenantId: 1,
    empresaId: 2,
    sitioId: 3
  };
}

function assertSinResultadosEvaluacion(payload) {
  const serializado = JSON.stringify(payload);
  for (const prohibido of [
    'resultadoSimulacion',
    'resultadoEvaluacion',
    'valoresPorNodo',
    'estadoRuntime',
    'valorCalculado',
    'historico'
  ]) {
    assert.equal(
      serializado.includes(prohibido),
      false,
      `El payload auditable no debe contener ${prohibido}.`
    );
  }
}

main().catch((error) => {
  console.error('[monitores] Error verificando monitores lógicos auditables 5.21.10b');
  console.error(error);
  process.exit(1);
});

import assert from 'node:assert/strict';
import { ServicioMonitores } from '../paquetes/monitores/src/ServicioMonitores.js';
import {
  validarEventoAuditableV1,
  validarParMovimientoAuditoriaV1
} from '../paquetes/auditoria/src/ValidadorContratoAuditoria.js';

async function main() {
  await verificarCreacionPingAuditable();
  await verificarActualizacionAuditableYNoop();
  await verificarMovimientoScopeAuditable();
  await verificarEliminacionAuditable();
  await verificarCreacionTelemetriaAuditable();

  console.log(
    '[monitores] OK 5.21.10a: monitores=auditable ping=crud telemetria=alta noop=sin_ruido payload=minimizado'
  );
}

async function verificarCreacionPingAuditable() {
  const entorno = crearEntorno();

  const monitor = await entorno.servicio.crearMonitor(contextoPortal(), datosPing());

  assert.equal(monitor.id, 100);
  assert.deepEqual(entorno.traza, [
    'begin',
    'sql:crear:ping',
    'audit:monitor.creado:principal',
    'commit',
    'catalogo:version'
  ]);
  const evento = entorno.auditoria.eventos[0];
  assert.equal(evento.tipo, 'monitor.creado');
  assert.equal(evento.payload.resultado, 'creado');
  assert.equal(evento.payload.despues.nombre, 'Ping API');
  assert.equal(evento.payload.despues.configuracion.host, 'api.example.test');
  assert.equal(JSON.stringify(evento.payload).includes('estadoRuntime'), false);
  assert.equal(JSON.stringify(evento.payload).includes('historico'), false);
}

async function verificarActualizacionAuditableYNoop() {
  const entorno = crearEntorno();
  entorno.monitor = monitorFixture({ id: 100, nombre: 'Ping API' });

  const actualizado = await entorno.servicio.actualizarMonitor(
    contextoPortal(),
    100,
    datosPing({ nombre: 'Ping API crítico', activo: '0' })
  );

  assert.equal(actualizado.nombre, 'Ping API crítico');
  assert.deepEqual(entorno.traza, [
    'begin',
    'sql:actualizar:ping',
    'audit:monitor.actualizado:principal',
    'commit',
    'catalogo:version'
  ]);
  const evento = entorno.auditoria.eventos[0];
  assert.equal(evento.tipo, 'monitor.actualizado');
  assert.deepEqual(evento.payload.camposCambiados, ['activo', 'nombre']);
  assert.deepEqual(evento.payload.antes, {
    activo: true,
    nombre: 'Ping API'
  });
  assert.deepEqual(evento.payload.despues, {
    activo: false,
    nombre: 'Ping API crítico'
  });

  entorno.traza.length = 0;
  entorno.auditoria.eventos.length = 0;
  await entorno.servicio.actualizarMonitor(
    contextoPortal(),
    100,
    datosPing({ nombre: 'Ping API crítico', activo: '0' })
  );
  assert.deepEqual(entorno.traza, []);
  assert.equal(entorno.auditoria.eventos.length, 0);
}

async function verificarMovimientoScopeAuditable() {
  const entorno = crearEntorno();
  entorno.monitor = monitorFixture({ id: 100, nombre: 'Ping API', sitioId: null });

  const actualizado = await entorno.servicio.actualizarMonitor(
    contextoPortal(),
    100,
    datosPing({ sitioId: '3', nivelPertenencia: 'sitio' })
  );

  assert.equal(actualizado.sitioId, 3);
  assert.deepEqual(entorno.traza, [
    'begin',
    'sql:actualizar:ping',
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

async function verificarEliminacionAuditable() {
  const entorno = crearEntorno();
  entorno.monitor = monitorFixture({ id: 100, nombre: 'Ping API' });

  const eliminado = await entorno.servicio.eliminarMonitor(contextoPortal(), 100);

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
  assert.equal(evento.payload.resultado, 'eliminado');
  assert.equal(evento.payload.antes.nombre, 'Ping API');
  assert.equal(evento.payload.despues, null);
  assert.equal(evento.payload.impactoResumen, null);
}

async function verificarCreacionTelemetriaAuditable() {
  const entorno = crearEntorno();

  await entorno.servicio.crearMonitor(contextoPortal(), datosTelemetria());

  assert.deepEqual(entorno.traza, [
    'begin',
    'sql:crear:telemetria',
    'sql:vincular-senal',
    'audit:monitor.creado:principal',
    'commit',
    'catalogo:version'
  ]);
  const evento = entorno.auditoria.eventos[0];
  assert.equal(evento.tipo, 'monitor.creado');
  assert.equal(evento.payload.despues.tipo, 'telemetria');
  assert.equal(evento.payload.despues.sitioId, '3');
  assert.equal(evento.payload.despues.configuracion.retardoFalloSegundos, 30);
  assert.equal(JSON.stringify(evento.payload).includes('valorNumero'), false);
}

function crearEntorno() {
  const traza = [];
  const auditoria = {
    eventos: [],
    async registrarEnTransaccion({ intencion }) {
      validarEventoAuditableV1(intencion);
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
    monitor: null
  };
  const repositorioMonitores = {
    async buscarPorId(id) {
      return entorno.monitor && Number(entorno.monitor.id) === Number(id)
        ? entorno.monitor
        : null;
    },
    async crear(definicion, { conexion } = {}) {
      assert.ok(conexion);
      traza.push(`sql:crear:${definicion.tipo}`);
      entorno.monitor = monitorFixture({ id: 100, ...definicion });
      return entorno.monitor;
    },
    async actualizarCompleto({ idMonitor, ...definicion }, { conexion } = {}) {
      assert.ok(conexion);
      traza.push(`sql:actualizar:${definicion.tipo}`);
      entorno.monitor = monitorFixture({ id: idMonitor, ...definicion });
      return entorno.monitor;
    },
    async eliminar(idMonitor, { conexion } = {}) {
      assert.ok(conexion);
      assert.equal(Number(idMonitor), Number(entorno.monitor.id));
      traza.push('sql:eliminar');
      entorno.monitor = null;
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
      async vincularSenalDirecta(datos, { conexion } = {}) {
        assert.ok(conexion);
        assert.equal(datos.monitorId, 100);
        traza.push('sql:vincular-senal');
      },
      async eliminarPorMonitorId(_monitorId, { conexion } = {}) {
        assert.ok(conexion);
        traza.push('sql:desvincular-telemetria');
      }
    },
    repositorioAgentes: {
      async buscarPorId(id) {
        assert.equal(Number(id), 50);
        return { id: 50, tenantId: 1, empresaId: 2, sitioId: 3 };
      }
    },
    repositorioCatalogoSenalesTelemetria: {
      async buscarPorId(id) {
        assert.equal(Number(id), 9);
        return { id: 9, agenteId: 50, tipoDato: 'numero', unidad: '%' };
      }
    },
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
    validadorMonitor: new ValidadorMonitorFalso(),
    fronteraTransaccional,
    servicioAuditoria: auditoria,
    ahora: () => new Date('2026-07-25T10:00:00.000Z')
  });
  return entorno;
}

class ValidadorMonitorFalso {
  normalizarDefinicionBase(datos) {
    const tipo = String(datos.tipo || 'ping').trim().toLowerCase();
    return {
      tenantId: Number(datos.tenantId),
      empresaId: Number(datos.empresaId),
      sitioId: datos.sitioId == null || datos.sitioId === ''
        ? null
        : Number(datos.sitioId),
      nombre: String(datos.nombre || '').trim(),
      tipo,
      descripcion: datos.descripcion || null,
      interpretacionEstado: datos.interpretacionEstado || 'normal',
      descripcionFallo: datos.descripcionFallo || '',
      posibleSolucion: datos.posibleSolucion || '',
      activo: normalizarBooleano(datos.activo),
      intervaloEjecucionSegundos: Number(datos.intervaloEjecucionSegundos || 60),
      desfaseInicialSegundos: Number(datos.desfaseInicialSegundos || 0),
      configuracion: tipo === 'telemetria'
        ? datos.configuracionTelemetria
        : {
            host: String(datos.host || '').trim(),
            timeoutMs: Number(datos.timeoutMs || 1200),
            reintentos: Number(datos.reintentos || 1),
            tamanoPaqueteBytes: Number(datos.tamanoPaqueteBytes || 56),
            ttl: Number(datos.ttl || 64)
          }
    };
  }
}

function datosPing({
  nombre = 'Ping API',
  activo = '1',
  sitioId = '',
  nivelPertenencia = 'empresa'
} = {}) {
  return {
    tenant_id: '1',
    empresa_id: '2',
    sitio_id: sitioId,
    nivel_pertenencia: nivelPertenencia,
    nombre,
    tipo: 'ping',
    descripcion: 'Monitor de API',
    interpretacion_estado: 'normal',
    descripcion_fallo: 'No responde',
    posible_solucion: 'Revisar conectividad',
    activo,
    intervalo_ejecucion_segundos: '60',
    desfase_inicial_segundos: '0',
    host: 'api.example.test',
    timeout_ms: '1200',
    reintentos: '1',
    tamano_paquete_bytes: '56',
    ttl: '64'
  };
}

function datosTelemetria() {
  return {
    tenant_id: '1',
    empresa_id: '2',
    sitio_id: '3',
    nivel_pertenencia: 'sitio',
    nombre: 'CPU elevada',
    tipo: 'telemetria',
    descripcion: 'Monitor de CPU',
    interpretacion_estado: 'normal',
    descripcion_fallo: 'CPU fuera de tolerancia',
    posible_solucion: 'Revisar procesos',
    activo: '1',
    intervalo_ejecucion_segundos: '60',
    desfase_inicial_segundos: '0',
    telemetria_agente_id: '50',
    telemetria_tipo_fuente: 'senal_directa',
    telemetria_senal_id: '9',
    telemetria_minimo: '',
    telemetria_maximo: '80',
    telemetria_retardo_fallo_segundos: '30'
  };
}

function monitorFixture(datos = {}) {
  return {
    id: 100,
    tenantId: 1,
    empresaId: 2,
    sitioId: null,
    nombre: 'Ping API',
    tipo: 'ping',
    descripcion: 'Monitor de API',
    interpretacionEstado: 'normal',
    descripcionFallo: 'No responde',
    posibleSolucion: 'Revisar conectividad',
    activo: true,
    intervaloEjecucionSegundos: 60,
    desfaseInicialSegundos: 0,
    configuracion: {
      host: 'api.example.test',
      timeoutMs: 1200,
      reintentos: 1,
      tamanoPaqueteBytes: 56,
      ttl: 64
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

function normalizarBooleano(valor) {
  return ['1', 'true', 'si', 'yes', 'on'].includes(
    String(valor ?? '').trim().toLowerCase()
  );
}

main().catch((error) => {
  console.error('[monitores] Error verificando administración auditable 5.21.10a');
  console.error(error);
  process.exit(1);
});

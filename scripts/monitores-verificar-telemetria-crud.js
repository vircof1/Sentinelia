import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import { obtenerDefinicionTipoMonitor } from '../paquetes/monitores/src/CatalogoTiposMonitor.js';
import { ServicioMonitores } from '../paquetes/monitores/src/ServicioMonitores.js';
import { ValidadorMonitor } from '../paquetes/monitores/src/ValidadorMonitor.js';

async function main() {
  await verificarFuentesDirigidasYContexto();
  await verificarAltaDirectaTransaccional();
  await verificarEdicionConReglaTransaccional();
  await verificarRollbackSinMonitorHuerfano();
  await verificarContratoWeb();

  console.log(
    '[monitores-telemetria] OK CRUD y UX administrativa verificados hasta 5.20b.9'
  );
}

async function verificarFuentesDirigidasYContexto() {
  const entorno = crearEntorno();
  const fuentes = await entorno.servicio.listarFuentesTelemetriaFormulario(
    crearContexto(),
    31
  );

  assert.equal(fuentes.agente.id, 31);
  assert.equal(fuentes.senales.length, 2);
  assert.equal(fuentes.senales.some(({ tipoDato }) => tipoDato === 'json'), false);
  assert.equal(
    fuentes.senales.some(({ tipoDato }) =>
      ['duracion', 'momento_utc'].includes(tipoDato)
    ),
    false
  );
  const temperatura = fuentes.senales.find(({ id }) => id === 71);
  assert.equal(temperatura.tipoDato, 'numero');
  assert.equal(temperatura.unidad, 'ºC');
  assert.equal(temperatura.ultimaObservacion.valor, 24.5);
  assert.equal(fuentes.reglas.length, 3);
  assert.equal(fuentes.reglas[0].senal.id, 71);
  assert.equal(
    fuentes.reglas.find(({ id }) => id === 82).senal.tipoDato,
    'duracion'
  );
  assert.equal(
    fuentes.reglas.find(({ id }) => id === 83).senal.tipoDato,
    'momento_utc'
  );

  await assert.rejects(
    () => entorno.servicio.listarFuentesTelemetriaFormulario(
      crearContexto(),
      99
    ),
    /dentro de tu alcance/
  );
}

async function verificarAltaDirectaTransaccional() {
  const entorno = crearEntorno();
  const monitor = await entorno.servicio.crearMonitor(
    crearContexto(),
    crearEntradaBase({
      telemetria_tipo_fuente: 'senal_directa',
      telemetria_senal_id: '71',
      telemetria_minimo: '20',
      telemetria_maximo: '95',
      telemetria_retardo_fallo_segundos: '30'
    })
  );

  assert.equal(monitor.id, 501);
  assert.deepEqual(entorno.transaccion, ['begin', 'crear', 'vincular_senal', 'commit']);
  assert.equal(entorno.definicionCreada.tipo, 'telemetria');
  assert.equal(entorno.definicionCreada.tenantId, 1);
  assert.equal(entorno.definicionCreada.empresaId, 10);
  assert.equal(entorno.definicionCreada.sitioId, 20);
  assert.deepEqual(entorno.definicionCreada.configuracion, {
    version: 1,
    retardoFalloSegundos: 30,
    condicion: {
      tipo: 'rango_numerico',
      tipoDato: 'numero',
      version: 1,
      minimo: 20,
      maximo: 95
    }
  });
  assert.deepEqual(entorno.fuenteVinculada, {
    monitorId: 501,
    agenteId: 31,
    senalId: 71
  });
  assert.equal(entorno.versiones, 1);
}

async function verificarEdicionConReglaTransaccional() {
  const entorno = crearEntorno({ monitorExistente: crearMonitorExistente() });
  const monitor = await entorno.servicio.actualizarMonitor(
    crearContexto(),
    501,
    crearEntradaBase({
      telemetria_tipo_fuente: 'regla_derivacion',
      telemetria_regla_id: '81',
      telemetria_retardo_fallo_segundos: '5'
    })
  );

  assert.equal(monitor.id, 501);
  assert.deepEqual(entorno.transaccion, [
    'begin',
    'eliminar_vinculo',
    'actualizar',
    'vincular_regla',
    'commit'
  ]);
  assert.deepEqual(entorno.definicionActualizada.configuracion, {
    version: 1,
    retardoFalloSegundos: 5
  });
  assert.deepEqual(entorno.fuenteVinculada, {
    monitorId: 501,
    reglaId: 81
  });
}

async function verificarRollbackSinMonitorHuerfano() {
  const entorno = crearEntorno({ fallarVinculo: true });
  await assert.rejects(
    () => entorno.servicio.crearMonitor(
      crearContexto(),
      crearEntradaBase({
        telemetria_tipo_fuente: 'senal_directa',
        telemetria_senal_id: '71',
        telemetria_minimo: '20'
      })
    ),
    /vínculo rechazado/
  );
  assert.deepEqual(entorno.transaccion, [
    'begin',
    'crear',
    'vincular_senal',
    'rollback'
  ]);
  assert.equal(entorno.versiones, 0);
}

async function verificarContratoWeb() {
  const definicion = obtenerDefinicionTipoMonitor('telemetria');
  assert.equal(definicion.capacidades.creableDesdePortal, true);

  const [vista, cliente, controlador, rutas, servicio, repositorioVinculos] =
    await Promise.all([
      leer('apps/sentinelia-web/src/views/portal/monitor-formulario.ejs'),
      leer('apps/sentinelia-web/src/public/js/monitores.js'),
      leer('apps/sentinelia-web/src/controladores/ControladorMonitores.js'),
      leer('apps/sentinelia-web/src/rutas/crearRutasPortal.js'),
      leer('paquetes/monitores/src/ServicioMonitores.js'),
      leer('paquetes/monitores/src/RepositorioVinculosMonitoresTelemetria.js')
    ]);

  for (const marcador of [
    'data-monitor-telemetria-agente',
    'data-monitor-telemetria-senal',
    'data-monitor-telemetria-regla',
    'data-monitor-telemetria-contexto-tipo',
    'data-monitor-telemetria-contexto-unidad',
    'data-monitor-telemetria-contexto-valor',
    'telemetria_retardo_fallo_segundos',
    'Fuente y criterio de evaluación'
  ]) {
    assert.ok(vista.includes(marcador), `Falta el contrato visual ${marcador}.`);
  }
  assert.ok(cliente.includes('cargarFuentesTelemetria'));
  assert.ok(cliente.includes('actualizarTelemetriaFormulario'));
  assert.ok(controlador.includes('apiFuentesTelemetria'));
  assert.ok(rutas.includes('/monitores/telemetria/api/fuentes'));
  assert.ok(servicio.includes('crearMonitorTelemetriaTransaccional'));
  assert.ok(servicio.includes('actualizarMonitorTelemetriaTransaccional'));
  assert.ok(repositorioVinculos.includes('eliminarPorMonitorId'));
  assert.equal(vista.includes('name="telemetria_agente_id" type="number"'), false);
  assert.equal(vista.includes('name="telemetria_senal_id" type="number"'), false);
  assert.equal(vista.includes('name="telemetria_regla_id" type="number"'), false);
  assert.doesNotMatch(vista, /5\.20[ab]|reglas? derivadas?/i);
}

function crearEntorno({ monitorExistente = null, fallarVinculo = false } = {}) {
  const transaccion = [];
  const entorno = {
    transaccion,
    definicionCreada: null,
    definicionActualizada: null,
    fuenteVinculada: null,
    versiones: 0
  };
  const conexion = {
    async beginTransaction() { transaccion.push('begin'); },
    async commit() { transaccion.push('commit'); },
    async rollback() { transaccion.push('rollback'); },
    release() {}
  };
  const agente = crearAgente(31, 1, 10, 20);
  const agenteAjeno = crearAgente(99, 2, 90, 91);
  const senales = crearSenales();
  const reglas = [
    crearRegla(),
    crearRegla({
      id: 82,
      senalId: 74,
      nombre: 'Duración de copia elevada'
    }),
    crearRegla({
      id: 83,
      senalId: 75,
      nombre: 'Próxima copia vencida'
    })
  ];
  const repositorioMonitores = {
    clienteSql: {
      async obtenerConexion() { return conexion; }
    },
    async buscarPorId(id) {
      return Number(id) === 501 ? monitorExistente : null;
    },
    async crear(definicion, { conexion: conexionRecibida } = {}) {
      assert.equal(conexionRecibida, conexion);
      transaccion.push('crear');
      entorno.definicionCreada = definicion;
      return { id: 501, ...definicion };
    },
    async actualizarCompleto(definicion, { conexion: conexionRecibida } = {}) {
      assert.equal(conexionRecibida, conexion);
      transaccion.push('actualizar');
      entorno.definicionActualizada = definicion;
      return { ...definicion, id: definicion.idMonitor };
    },
    async listarPorIds() { return []; }
  };
  const repositorioVinculos = {
    async vincularSenalDirecta(fuente, { conexion: conexionRecibida } = {}) {
      assert.equal(conexionRecibida, conexion);
      transaccion.push('vincular_senal');
      entorno.fuenteVinculada = fuente;
      if (fallarVinculo) throw new Error('vínculo rechazado');
      return fuente;
    },
    async vincularReglaDerivacion(fuente, { conexion: conexionRecibida } = {}) {
      assert.equal(conexionRecibida, conexion);
      transaccion.push('vincular_regla');
      entorno.fuenteVinculada = fuente;
      if (fallarVinculo) throw new Error('vínculo rechazado');
      return fuente;
    },
    async eliminarPorMonitorId(_id, { conexion: conexionRecibida } = {}) {
      assert.equal(conexionRecibida, conexion);
      transaccion.push('eliminar_vinculo');
      return true;
    },
    async buscarPorMonitorId() { return null; }
  };
  const repositorioAgentes = {
    async buscarPorId(id) {
      if (Number(id) === 31) return agente;
      if (Number(id) === 99) return agenteAjeno;
      return null;
    },
    async listarVisibles() { return [agente]; }
  };
  const repositorioCatalogo = {
    async buscarPorId(id) {
      return senales.find((senal) => Number(senal.id) === Number(id)) || null;
    },
    async listarPorAgente(id) {
      return Number(id) === 31 ? senales : [];
    }
  };
  const repositorioEstado = {
    async listarPorAgente() {
      return [{
        senalId: 71,
        ultimaObservacionId: 901,
        tipoDato: 'numero',
        valorNumero: 24.5,
        observadoEnUtc: '2026-07-20T12:00:00.000Z',
        recibidoEnUtc: '2026-07-20T12:00:01.000Z',
        calidad: 'buena'
      }];
    }
  };
  const repositorioReglas = {
    async buscarPorId(id) {
      return reglas.find(({ regla }) => Number(regla.id) === Number(id)) || null;
    },
    async listarPorAgente(id) { return Number(id) === 31 ? reglas : []; }
  };
  const servicio = new ServicioMonitores({
    repositorioMonitores,
    repositorioTenants: crearRepositorioScope({ id: 1, nombre: 'Tenant' }),
    repositorioEmpresas: crearRepositorioScope({
      id: 10,
      tenantId: 1,
      nombre: 'Empresa'
    }),
    repositorioSitios: crearRepositorioScope({
      id: 20,
      tenantId: 1,
      empresaId: 10,
      nombre: 'Sitio'
    }),
    repositorioVinculosMonitoresTelemetria: repositorioVinculos,
    repositorioAgentes,
    repositorioCatalogoSenalesTelemetria: repositorioCatalogo,
    repositorioEstadoActualTelemetria: repositorioEstado,
    repositorioReglasDerivacionTelemetria: repositorioReglas,
    versionadorCatalogoMonitoresRedis: {
      async incrementarVersion() { entorno.versiones += 1; }
    },
    resolutorScopeUsuario: crearResolutorScope(),
    validadorMonitor: new ValidadorMonitor()
  });

  entorno.servicio = servicio;
  return entorno;
}

function crearEntradaBase(sobrescritura = {}) {
  return {
    nombre: 'Temperatura cámara fría',
    tipo: 'telemetria',
    descripcion: 'Tolerancia de conservación',
    interpretacion_estado: 'normal',
    descripcion_fallo: 'Temperatura fuera de tolerancia',
    posible_solucion: 'Revisar el equipo frigorífico',
    activo: '1',
    intervalo_ejecucion_segundos: '60',
    desfase_inicial_segundos: '0',
    nivel_pertenencia: 'empresa',
    tenant_id: '999',
    empresa_id: '999',
    sitio_id: '999',
    telemetria_agente_id: '31',
    telemetria_tipo_fuente: 'senal_directa',
    telemetria_senal_id: '',
    telemetria_regla_id: '',
    telemetria_minimo: '',
    telemetria_maximo: '',
    telemetria_operador: 'igual',
    telemetria_valor_esperado: '',
    telemetria_retardo_fallo_segundos: '0',
    ...sobrescritura
  };
}

function crearMonitorExistente() {
  return {
    id: 501,
    tenantId: 1,
    empresaId: 10,
    sitioId: 20,
    nombre: 'Temperatura cámara fría',
    tipo: 'telemetria',
    descripcion: null,
    interpretacionEstado: 'normal',
    descripcionFallo: '',
    posibleSolucion: '',
    activo: true,
    intervaloEjecucionSegundos: 60,
    desfaseInicialSegundos: 0,
    configuracion: {
      version: 1,
      retardoFalloSegundos: 0,
      condicion: {
        tipo: 'rango_numerico',
        tipoDato: 'numero',
        version: 1,
        minimo: 20,
        maximo: 95
      }
    }
  };
}

function crearAgente(id, tenantId, empresaId, sitioId) {
  return {
    id,
    nombre: `Agente ${id}`,
    tenantId,
    empresaId,
    sitioId,
    sitioNombre: `Sitio ${sitioId}`,
    estadoAdministrativo: 'activo',
    estadoVidaPol: 'vivo'
  };
}

function crearSenales() {
  return [
    crearEntidadSerializable({
      id: 71,
      agenteId: 31,
      categoria: 'ambiente',
      clave: 'temperatura',
      codigoSenal: 'ambiente.temperatura',
      tipoDato: 'numero',
      unidad: 'ºC',
      nombreHumano: 'Temperatura'
    }),
    crearEntidadSerializable({
      id: 72,
      agenteId: 31,
      categoria: 'acceso',
      clave: 'puerta',
      codigoSenal: 'acceso.puerta',
      tipoDato: 'estado',
      unidad: null,
      nombreHumano: 'Puerta'
    }),
    crearEntidadSerializable({
      id: 73,
      agenteId: 31,
      categoria: 'diagnostico',
      clave: 'payload',
      codigoSenal: 'diagnostico.payload',
      tipoDato: 'json',
      unidad: null,
      nombreHumano: 'Payload'
    }),
    crearEntidadSerializable({
      id: 74,
      agenteId: 31,
      categoria: 'copias',
      clave: 'duracion',
      codigoSenal: 'copias.duracion',
      tipoDato: 'duracion',
      unidad: null,
      nombreHumano: 'Duración de la copia'
    }),
    crearEntidadSerializable({
      id: 75,
      agenteId: 31,
      categoria: 'copias',
      clave: 'siguiente',
      codigoSenal: 'copias.siguiente',
      tipoDato: 'momento_utc',
      unidad: null,
      nombreHumano: 'Siguiente copia'
    })
  ];
}

function crearRegla({
  id = 81,
  senalId = 71,
  nombre = 'Temperatura crítica'
} = {}) {
  const serializada = {
    id,
    agenteId: 31,
    senalId,
    tenantId: 1,
    empresaId: 10,
    sitioId: 20,
    estado: 'activa',
    revisionVigente: {
      nombre,
      mensajeOperativo: 'La temperatura es crítica.',
      condicion: { tipo: 'umbral', operador: 'mayor_que', umbral: 90 }
    }
  };
  return {
    regla: {
      id,
      agenteId: 31,
      senalId,
      tenantId: 1,
      empresaId: 10,
      sitioId: 20
    },
    serializar() { return structuredClone(serializada); }
  };
}

function crearEntidadSerializable(datos) {
  return {
    ...datos,
    serializar() { return { ...datos }; }
  };
}

function crearRepositorioScope(entidad) {
  return {
    async buscarPorId(id) {
      return Number(id) === Number(entidad.id) ? entidad : null;
    },
    async listarVisibles() { return [entidad]; }
  };
}

function crearContexto() {
  return {
    nivelScope: 'tenant',
    tenantId: 1,
    empresaId: null,
    sitioId: null
  };
}

function crearResolutorScope() {
  return {
    describirScope() { return 'Tenant de prueba'; },
    puedeAlcanzarEmpresa(contexto, _empresaId, tenantId) {
      return Number(contexto.tenantId) === Number(tenantId);
    },
    puedeAlcanzarSitio(contexto, _sitioId, _empresaId, tenantId) {
      return Number(contexto.tenantId) === Number(tenantId);
    }
  };
}

async function leer(ruta) {
  return readFile(new URL(`../${ruta}`, import.meta.url), 'utf8');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

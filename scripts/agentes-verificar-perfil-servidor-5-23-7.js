import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import {
  ESTADOS_PERFIL_SERVIDOR_AGENTE
} from '../paquetes/agentes/src/ContratoPerfilServidorAgente.js';
import {
  PerfilServidorAgente
} from '../paquetes/agentes/src/PerfilServidorAgente.js';
import {
  RepositorioEstadoRuntimeServidorAgentes
} from '../paquetes/agentes/src/RepositorioEstadoRuntimeServidorAgentes.js';
import {
  RepositorioPerfilesServidorAgentes
} from '../paquetes/agentes/src/RepositorioPerfilesServidorAgentes.js';
import {
  ServicioProvisionamientoAgentes
} from '../paquetes/agentes/src/ServicioProvisionamientoAgentes.js';
import {
  obtenerDefinicionTipoEventoAuditoria
} from '../paquetes/auditoria/src/CatalogoAuditoria.js';
import {
  MANIFIESTO_PRODUCTORES_INTERNOS_AUDITORIA,
  MANIFIESTO_RUTAS_AUDITORIA
} from '../paquetes/auditoria/src/ManifiestoCoberturaAuditoria.js';
import {
  validarEventoAuditableV1
} from '../paquetes/auditoria/src/ValidadorContratoAuditoria.js';

const RAIZ = new URL('../', import.meta.url);
const AHORA = new Date('2026-08-24T20:00:00.000Z');

await verificarLecturaPendienteNoInventaFotografia();
await verificarLecturaMasivaParaElListado();
await verificarListadoSinComposicionMantienePerfilGenerico();
await verificarConfiguracionProspectivaAuditableYConcurrente();
await verificarRetiradaHumanaTransaccionalYPostcommit();
await verificarRepositorioRechazaVersionObsoleta();
await verificarCatalogoRutasOutboxYSuperficieAdministrativa();

console.log(
  '[agentes] OK 5.23.7: lectura=sin_false_ficticio ' +
  'configuracion=prospectiva_y_concurrente retirada=humana_transaccional ' +
  'desactivacion=outbox_runtime listado=lectura_masiva ux=local_y_diagnostica'
);

async function verificarLecturaPendienteNoInventaFotografia() {
  const base = crearEscenario({
    perfil: crearPerfil({
      estado: ESTADOS_PERFIL_SERVIDOR_AGENTE.PENDIENTE_PRIMERA_EVIDENCIA,
      armada_en_utc: null
    }),
    estadoRuntime: {
      agenteId: 7,
      generacion: 3,
      valorSinPol: null,
      valorReinicioReciente: null,
      ultimoPolUtc: null,
      venceSinPolUtc: null,
      venceReinicioRecienteUtc: null
    }
  });
  const lectura = await base.servicio.consultarPerfilServidorAgente(
    base.contexto,
    7
  );

  assert.equal(lectura.perfilEfectivo, 'servidor');
  assert.equal(lectura.perfil.estado, 'pendiente_primera_evidencia');
  assert.deepEqual(lectura.fotografia, {
    disponible: false,
    motivo: 'pendiente_primera_evidencia',
    sinPol: null,
    reinicioReciente: null
  });
  assert.equal(lectura.puedeEditarConfiguracion, true);
  assert.equal(lectura.puedeRetirar, true);
}

async function verificarLecturaMasivaParaElListado() {
  const base = crearEscenario({
    perfil: crearPerfil(),
    estadoRuntime: {
      agenteId: 7,
      generacion: 3,
      valorSinPol: false,
      valorReinicioReciente: false,
      ultimoPolUtc: '2026-08-24T19:55:00.000Z'
    }
  });
  const resumen = await base.servicio.consultarResumenPerfilesServidorAgentes(
    base.contexto,
    [
      base.agente,
      { ...base.agente, id: 8, nombre: 'Agente genérico' }
    ]
  );

  assert.equal(base.lecturasMasivasPerfiles.length, 1);
  assert.deepEqual(base.lecturasMasivasPerfiles[0], [7, 8]);
  assert.equal(base.lecturasMasivasRuntime.length, 1);
  assert.equal(resumen[0].perfilEfectivo, 'servidor');
  assert.equal(resumen[0].estado, 'activo');
  assert.equal(resumen[0].fotografiaDisponible, true);
  assert.equal(resumen[1].perfilEfectivo, 'generico');
  assert.equal(resumen[1].estado, null);
}

async function verificarListadoSinComposicionMantienePerfilGenerico() {
  const base = crearEscenario({ perfil: null });
  const servicio = new ServicioProvisionamientoAgentes({
    repositorioAgentes: {},
    repositorioSitios: {},
    politicaPermisosAgentes: {
      assertPuedeVer() {},
      puedeAlcanzarAgente() { return true; }
    }
  });
  const resumen = await servicio.consultarResumenPerfilesServidorAgentes(
    base.contexto,
    [base.agente]
  );

  assert.deepEqual(resumen, [{
    perfilEfectivo: 'generico',
    estado: null,
    generacion: null,
    ultimoPolUtc: null,
    fotografiaDisponible: false,
    codigoCierre: null
  }]);
}

async function verificarConfiguracionProspectivaAuditableYConcurrente() {
  const estadoRuntime = {
    agenteId: 7,
    generacion: 3,
    valorSinPol: false,
    valorReinicioReciente: true,
    ultimoPolUtc: '2026-08-24T19:55:00.000Z',
    venceSinPolUtc: '2026-08-24T20:01:00.000Z',
    venceReinicioRecienteUtc: '2026-08-24T20:04:00.000Z',
    histeresisSinPolCapturadaSegundos: 120,
    duracionReinicioCapturadaSegundos: 300
  };
  const base = crearEscenario({
    perfil: crearPerfil(),
    estadoRuntime
  });
  const resultado = await base.servicio
    .actualizarConfiguracionPerfilServidorAgente(base.contexto, 7, {
      generacion: 3,
      versionEsperada: 4,
      histeresisSinPolSegundos: 180,
      duracionReinicioRecienteSegundos: 420
    });

  assert.equal(resultado.perfil.versionEstado, 5);
  assert.equal(resultado.perfil.histeresisSinPolSegundos, 180);
  assert.equal(resultado.perfil.duracionReinicioRecienteSegundos, 420);
  assert.equal(base.actualizaciones.length, 1);
  assert.deepEqual(base.actualizaciones[0], {
    agenteId: 7,
    generacion: 3,
    versionEsperada: 4,
    histeresisSinPolSegundos: 180,
    duracionReinicioRecienteSegundos: 420
  });
  assert.deepEqual(estadoRuntime, {
    agenteId: 7,
    generacion: 3,
    valorSinPol: false,
    valorReinicioReciente: true,
    ultimoPolUtc: '2026-08-24T19:55:00.000Z',
    venceSinPolUtc: '2026-08-24T20:01:00.000Z',
    venceReinicioRecienteUtc: '2026-08-24T20:04:00.000Z',
    histeresisSinPolCapturadaSegundos: 120,
    duracionReinicioCapturadaSegundos: 300
  });

  const evento = base.auditorias[0];
  assert.doesNotThrow(() => validarEventoAuditableV1(evento));
  assert.equal(evento.tipo, 'agente.configuracion_servidor_cambiada');
  assert.deepEqual(evento.payload, {
    resultado: 'actualizado',
    camposCambiados: [
      'duracionReinicioRecienteSegundos',
      'histeresisSinPolSegundos'
    ],
    antes: {
      duracionReinicioRecienteSegundos: 300,
      histeresisSinPolSegundos: 120
    },
    despues: {
      duracionReinicioRecienteSegundos: 420,
      histeresisSinPolSegundos: 180
    }
  });
  assertOrden(base.eventos, 'tx:actualizar_configuracion', 'tx:auditoria');
  assertOrden(base.eventos, 'tx:auditoria', 'tx:commit');

  await assert.rejects(
    base.servicio.actualizarConfiguracionPerfilServidorAgente(
      base.contexto,
      7,
      {
        generacion: 3,
        versionEsperada: 4,
        histeresisSinPolSegundos: 200,
        duracionReinicioRecienteSegundos: 500
      }
    ),
    /cambió mientras se editaba/u
  );
  assert.equal(base.actualizaciones.length, 1);
  assert.equal(base.auditorias.length, 1);
}

async function verificarRetiradaHumanaTransaccionalYPostcommit() {
  const base = crearEscenario({ perfil: crearPerfil() });
  const resultado = await base.servicio.retirarPerfilServidorAgente(
    base.contexto,
    7,
    { generacion: 3, versionEsperada: 4 }
  );

  assert.equal(resultado.retirada.retirada, true);
  assert.equal(resultado.perfil.estado, 'retirado');
  assert.equal(resultado.agente.estadoAdministrativo, 'activo');
  assert.deepEqual(base.retiradas[0], {
    agenteId: 7,
    generacion: 3,
    versionEsperada: 4,
    cerradaEnUtc: AHORA
  });
  const evento = base.auditorias[0];
  assert.doesNotThrow(() => validarEventoAuditableV1(evento));
  assert.equal(evento.tipo, 'agente.perfil_servidor_retirado');
  assert.deepEqual(evento.payload, {
    estadoAntes: 'activo',
    estadoDespues: 'retirado',
    motivo: 'operador'
  });
  assertOrden(base.eventos, 'tx:retirada_tecnica', 'tx:auditoria');
  assertOrden(base.eventos, 'tx:auditoria', 'tx:commit');
  assertOrden(base.eventos, 'tx:commit', 'postcommit:redis');
  assertOrden(base.eventos, 'tx:commit', 'postcommit:fotografias');
  assertOrden(base.eventos, 'tx:commit', 'postcommit:reglas');

  const lectura = await base.servicio.consultarPerfilServidorAgente(
    base.contexto,
    7
  );
  assert.equal(lectura.perfilEfectivo, 'generico');
  assert.equal(lectura.perfil.estado, 'retirado');
  assert.deepEqual(lectura.fotografia, {
    disponible: false,
    motivo: 'perfil_cerrado',
    sinPol: null,
    reinicioReciente: null
  });
}

async function verificarRepositorioRechazaVersionObsoleta() {
  let sqlPerfiles = '';
  let parametrosPerfiles = null;
  const repositorioPerfiles = new RepositorioPerfilesServidorAgentes({
    async consultar(sql, parametros) {
      sqlPerfiles = sql;
      parametrosPerfiles = parametros;
      return [];
    }
  });
  await repositorioPerfiles.listarUltimosPorAgentesIds([8, 7, 8]);
  assert.match(sqlPerfiles, /MAX\(generacion\)/u);
  assert.match(sqlPerfiles, /GROUP BY agente_id/u);
  assert.deepEqual(parametrosPerfiles, [8, 7]);

  let sqlRuntime = '';
  let parametrosRuntime = null;
  const repositorioRuntime = new RepositorioEstadoRuntimeServidorAgentes({
    async consultar(sql, parametros) {
      sqlRuntime = sql;
      parametrosRuntime = parametros;
      return [];
    }
  });
  await repositorioRuntime.listarPorPerfiles([
    { agenteId: 8, generacion: 2 },
    { agenteId: 7, generacion: 3 }
  ]);
  assert.match(sqlRuntime, /e\.agente_id = \? AND e\.generacion = \?/u);
  assert.deepEqual(parametrosRuntime, [8, 2, 7, 3]);

  let sentencia = '';
  let parametros = null;
  const repositorio = new RepositorioPerfilesServidorAgentes({});
  await assert.rejects(
    repositorio.actualizarConfiguracionEnTransaccion({
      agenteId: 7,
      generacion: 3,
      versionEsperada: 4,
      histeresisSinPolSegundos: 180,
      duracionReinicioRecienteSegundos: 420
    }, {
      conexion: {
        async execute(sql, valores) {
          sentencia = sql;
          parametros = valores;
          return [{ affectedRows: 0 }, []];
        }
      }
    }),
    /cambió mientras se editaba/u
  );
  assert.match(sentencia, /version_estado = \?/u);
  assert.match(sentencia, /estado IN \(\?, \?\)/u);
  assert.deepEqual(parametros.slice(0, 5), [180, 420, 7, 3, 4]);
}

async function verificarCatalogoRutasOutboxYSuperficieAdministrativa() {
  for (const [tipo, perfil] of [
    ['agente.configuracion_servidor_cambiada', 'cambio_v1'],
    ['agente.perfil_servidor_retirado', 'estado_v1'],
    ['agente.perfil_servidor_desactivado', 'estado_v1']
  ]) {
    const definicion = obtenerDefinicionTipoEventoAuditoria(tipo);
    assert.equal(definicion.flujo, 'agentes');
    assert.equal(definicion.perfil, perfil);
    assert.deepEqual(definicion.sujetos, ['agente']);
  }
  const desactivacion = obtenerDefinicionTipoEventoAuditoria(
    'agente.perfil_servidor_desactivado'
  );
  assert.deepEqual(desactivacion.productores, ['runtime_agentes']);
  assert.deepEqual(desactivacion.parejasActorOrigen, [{
    actor: 'runtime',
    origen: 'runtime'
  }]);

  for (const [id, tipo] of [
    [
      'POST /agentes/:id/perfil-servidor/configuracion',
      'agente.configuracion_servidor_cambiada'
    ],
    [
      'POST /agentes/:id/perfil-servidor/retirar',
      'agente.perfil_servidor_retirado'
    ]
  ]) {
    const ruta = MANIFIESTO_RUTAS_AUDITORIA.find((item) => item.id === id);
    assert.equal(ruta?.clasificacion, 'auditable');
    assert.deepEqual(ruta?.eventos, [tipo]);
  }
  const productor = MANIFIESTO_PRODUCTORES_INTERNOS_AUDITORIA.find(
    ({ id }) => id === 'runtime.agentes.perfil_servidor'
  );
  assert.equal(productor?.clasificacion, 'auditable');
  assert.deepEqual(productor?.eventos, [
    'agente.perfil_servidor_desactivado'
  ]);

  const [rutas, vista, listado, servicioPortal, coordinador, runtime, paquete] =
    await Promise.all([
      leer('apps/sentinelia-web/src/rutas/crearRutasPortal.js'),
      leer('apps/sentinelia-web/src/views/portal/agente-formulario.ejs'),
      leer('apps/sentinelia-web/src/public/js/agentes.js'),
      leer('apps/sentinelia-web/src/servicios/ServicioAdministracionAgentesPortal.js'),
      leer('paquetes/agentes/src/CoordinadorPerfilServidorRedis.js'),
      leer('apps/sentinelia-runtime/src/agentes/ProcesadorSenalesServidorRuntime.js'),
      leer('package.json')
    ]);

  assert.match(
    rutas,
    /perfil-servidor\/configuracion[\s\S]*requerirModificarAgentes/u
  );
  assert.match(
    rutas,
    /perfil-servidor\/retirar[\s\S]*requerirModificarAgentes/u
  );
  assert.match(vista, /Configuración para ciclos futuros/u);
  assert.match(vista, /pendiente de primera evidencia/u);
  assert.match(vista, /desactivado por incompatibilidad/u);
  assert.match(vista, /no modifican los plazos que ya están en curso/u);
  assert.match(vista, /Todavía no existe fotografía/u);
  assert.match(vista, /no se interpreta\s+como <code>false<\/code>/u);
  assert.match(vista, /Retirar no deshabilita ni elimina el agente/u);
  assert.match(vista, /codigoCierre/u);
  assert.match(vista, /data-fecha-utc/u);
  assert.match(vista, /name="_csrf"/u);
  assert.match(listado, /perfilServidor/u);
  assert.match(listado, /presentarEstadoPerfilServidor/u);
  assert.match(listado, /desactivado por incompatibilidad/u);
  assert.match(listado, /formatearFecha/u);
  assert.match(listado, /portalFechas\?\.formatear/u);
  assert.match(servicioPortal, /consultarResumenPerfilesServidorAgentes/u);
  assert.match(coordinador, /export class CoordinadorPerfilServidorRedis/u);
  assert.match(runtime, /repositorioOutboxAuditoriaRuntime/u);
  assert.match(runtime, /\.encolarEnTransaccion/u);
  assert.match(runtime, /agente\.perfil_servidor_desactivado/u);
  assert.match(paquete, /agentes:verificar-perfil-servidor-5-23-7/u);
}

function crearEscenario({ perfil, estadoRuntime = null }) {
  const agente = {
    id: 7,
    nombre: 'Servidor de pruebas',
    descripcion: '',
    estadoAdministrativo: 'activo',
    estadoAcceso: 'normal',
    tenantId: 1,
    empresaId: 2,
    sitioId: 3
  };
  const contexto = {
    idUsuario: 11,
    permisos: { verAgentes: true, modificarAgentes: true }
  };
  const eventos = [];
  const auditorias = [];
  const actualizaciones = [];
  const retiradas = [];
  const lecturasMasivasPerfiles = [];
  const lecturasMasivasRuntime = [];
  const repositorioPerfilesServidor = {
    async buscarPorAgenteId() { return perfil; },
    async buscarEvidenciaElegibilidad() {
      return {
        loginValidoConBootId: true,
        heartbeatExplicitoAceptado: true,
        login: null,
        heartbeat: null
      };
    },
    async listarUltimosPorAgentesIds(ids) {
      lecturasMasivasPerfiles.push(ids);
      return perfil ? [perfil] : [];
    },
    async promoverEnTransaccion() { throw new Error('Promoción no esperada.'); },
    async actualizarConfiguracionEnTransaccion(datos) {
      eventos.push('tx:actualizar_configuracion');
      actualizaciones.push(datos);
      perfil = crearPerfil({
        estado: perfil.estado,
        histeresis_sin_pol_segundos: datos.histeresisSinPolSegundos,
        duracion_reinicio_reciente_segundos:
          datos.duracionReinicioRecienteSegundos,
        version_estado: perfil.versionEstado + 1
      });
      return perfil;
    }
  };
  const servicio = new ServicioProvisionamientoAgentes({
    repositorioAgentes: {
      async buscarPorId(id) { return Number(id) === agente.id ? agente : null; }
    },
    repositorioSitios: {},
    repositorioPerfilesServidor,
    repositorioEstadoRuntimeServidor: {
      async buscarPorPerfil() { return estadoRuntime; },
      async listarPorPerfiles(perfiles) {
        lecturasMasivasRuntime.push(perfiles);
        return estadoRuntime ? [estadoRuntime] : [];
      }
    },
    politicaPermisosAgentes: {
      assertPuedeVer() {},
      assertPuedeModificar() {},
      puedeModificar() { return true; },
      puedeAlcanzarAgente() { return true; }
    },
    fronteraTransaccional: {
      async ejecutar(operacion) {
        eventos.push('tx:begin');
        const resultado = await operacion({ execute: async () => [[], []] });
        eventos.push('tx:commit');
        return resultado;
      }
    },
    servicioAuditoria: {
      async registrarEnTransaccion({ intencion }) {
        eventos.push('tx:auditoria');
        auditorias.push(intencion);
        return { eventoId: intencion.eventoId };
      },
      async registrarMovimientoEnTransaccion() {}
    },
    servicioRetiradaPerfilServidor: {
      async retirarEnTransaccion(datos) {
        eventos.push('tx:retirada_tecnica');
        retiradas.push(datos);
        perfil = crearPerfil({
          estado: ESTADOS_PERFIL_SERVIDOR_AGENTE.RETIRADO,
          cerrada_en_utc: AHORA,
          codigo_cierre: 'retirada_administrativa',
          detalle_cierre: 'Retirada por un operador.',
          version_estado: perfil.versionEstado + 1
        });
        return {
          retirada: true,
          agenteId: 7,
          generacion: 3,
          perfil: perfil.serializar(),
          fotografiasRetiradas: [{ id: 71 }],
          estadosReglasRetirados: [{ reglaId: 31 }]
        };
      }
    },
    coordinadorPerfilServidorRedis: {
      async retirarProyecciones() { eventos.push('postcommit:redis'); }
    },
    publicadorInvalidacionesMonitores: {
      async publicarFotografiasActualizadas() {
        eventos.push('postcommit:fotografias');
      },
      async publicarEstadosReglasActualizados() {
        eventos.push('postcommit:reglas');
      }
    },
    perfilServidorHabilitado: true,
    ahora: () => AHORA
  });

  return {
    servicio,
    agente,
    contexto,
    eventos,
    auditorias,
    actualizaciones,
    retiradas,
    lecturasMasivasPerfiles,
    lecturasMasivasRuntime
  };
}

function crearPerfil(sobrescritura = {}) {
  return new PerfilServidorAgente({
    agente_id: 7,
    generacion: 3,
    estado: ESTADOS_PERFIL_SERVIDOR_AGENTE.ACTIVO,
    histeresis_sin_pol_segundos: 120,
    duracion_reinicio_reciente_segundos: 300,
    generada_en_utc: '2026-08-24 18:00:00.000',
    armada_en_utc: '2026-08-24 18:01:00.000',
    cerrada_en_utc: null,
    codigo_cierre: null,
    detalle_cierre: null,
    version_estado: 4,
    fecha_creacion: '2026-08-24 18:00:00.000',
    fecha_actualizacion: '2026-08-24 18:01:00.000',
    ...sobrescritura
  });
}

function assertOrden(eventos, primero, despues) {
  const indicePrimero = eventos.indexOf(primero);
  const indiceDespues = eventos.indexOf(despues);
  assert(indicePrimero >= 0, `No se encontró ${primero}: ${eventos.join(', ')}`);
  assert(indiceDespues > indicePrimero, `${despues} debe ocurrir después de ${primero}.`);
}

async function leer(ruta) {
  return readFile(new URL(ruta, RAIZ), 'utf8');
}

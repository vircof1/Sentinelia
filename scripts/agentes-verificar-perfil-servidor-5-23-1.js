import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import {
  ESTADOS_PERFIL_SERVIDOR_AGENTE
} from '../paquetes/agentes/src/ContratoPerfilServidorAgente.js';
import {
  PerfilServidorAgente
} from '../paquetes/agentes/src/PerfilServidorAgente.js';
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
  MANIFIESTO_RUTAS_AUDITORIA
} from '../paquetes/auditoria/src/ManifiestoCoberturaAuditoria.js';
import {
  validarEventoAuditableV1
} from '../paquetes/auditoria/src/ValidadorContratoAuditoria.js';

const RAIZ = new URL('../', import.meta.url);
const FECHA_GENERACION = new Date('2026-08-24T10:00:00.000Z');

await main();

async function main() {
  verificarEntidadGeneracional();
  await verificarRepositorioYSerializacionConcurrente();
  await verificarServicioProtegidoYElegible();
  await verificarAuditoriaDePromocion();
  await verificarSuperficieAdministrativaYDocumental();

  console.log(
    '[agentes] OK 5.23.1: perfil=generacional evidencia=historica ' +
    'promocion=feature_flag_off auditoria=transaccional estado=pendiente'
  );
}

function verificarEntidadGeneracional() {
  const perfil = crearPerfil();

  assert.equal(perfil.estaVigente(), true);
  assert.deepEqual(perfil.serializar(), {
    agenteId: 7,
    generacion: 1,
    estado: 'pendiente_primera_evidencia',
    histeresisSinPolSegundos: 120,
    duracionReinicioRecienteSegundos: 300,
    generadaEnUtc: '2026-08-24T10:00:00.000Z',
    armadaEnUtc: null,
    cerradaEnUtc: null,
    codigoCierre: null,
    detalleCierre: null,
    versionEstado: 1,
    fechaCreacion: '2026-08-24T10:00:00.000Z',
    fechaActualizacion: '2026-08-24T10:00:00.000Z'
  });
  assert.equal(crearPerfil({
    estado: ESTADOS_PERFIL_SERVIDOR_AGENTE.RETIRADO,
    armada_en_utc: '2026-08-24 10:01:00.000',
    cerrada_en_utc: '2026-08-24 11:00:00.000',
    codigo_cierre: 'retirada_administrativa'
  }).estaVigente(), false);
  assert.throws(
    () => crearPerfil({ histeresis_sin_pol_segundos: 0 }),
    /entero positivo/u
  );
  assert.throws(
    () => crearPerfil({ estado: 'inventado' }),
    /no es válido/u
  );
}

async function verificarRepositorioYSerializacionConcurrente() {
  const consultas = [];
  const clienteSql = {
    async consultar(sql, parametros) {
      consultas.push({ sql, parametros });
      if (sql.includes('heartbeats_recibidos > 0')) {
        return [{
          id: 19,
          ultimo_heartbeat_utc: new Date('2025-01-02T03:05:00.000Z')
        }];
      }
      if (sql.includes("TRIM(boot_id) <> ''")) {
        return [{
          id: 18,
          boot_id: 'boot-historico',
          inicio_utc: new Date('2025-01-02T03:04:00.000Z')
        }];
      }
      return [];
    }
  };
  const repositorio = new RepositorioPerfilesServidorAgentes(clienteSql);
  const evidencia = await repositorio.buscarEvidenciaElegibilidad(7);

  assert.deepEqual(evidencia, {
    loginValidoConBootId: true,
    heartbeatExplicitoAceptado: true,
    login: {
      periodoVidaPolId: 18,
      bootId: 'boot-historico',
      observadoEnUtc: '2025-01-02T03:04:00.000Z'
    },
    heartbeat: {
      periodoVidaPolId: 19,
      observadoEnUtc: '2025-01-02T03:05:00.000Z'
    }
  });
  assert.equal(consultas.length, 2);
  assert(consultas.every(({ parametros }) => parametros[0] === 7));

  const estadoSql = { fila: null, inserciones: 0, bloqueos: 0 };
  const conexion = {
    async execute(sql, parametros) {
      if (sql.includes('FROM agentes_sentinelia') && sql.includes('FOR UPDATE')) {
        estadoSql.bloqueos += 1;
        return [[{ id: 7 }], []];
      }
      if (sql.includes('FROM perfiles_servidor_agentes')) {
        return [estadoSql.fila ? [estadoSql.fila] : [], []];
      }
      if (sql.includes('INSERT INTO perfiles_servidor_agentes')) {
        estadoSql.inserciones += 1;
        estadoSql.fila = filaPerfil({
          generacion: parametros[1],
          estado: parametros[2],
          histeresis_sin_pol_segundos: parametros[3],
          duracion_reinicio_reciente_segundos: parametros[4],
          generada_en_utc: parametros[5]
        });
        return [{ affectedRows: 1 }, []];
      }
      throw new Error(`SQL no esperado: ${sql}`);
    }
  };
  const promovido = await repositorio.promoverEnTransaccion({
    agenteId: 7,
    histeresisSinPolSegundos: 120,
    duracionReinicioRecienteSegundos: 300,
    generadaEnUtc: FECHA_GENERACION
  }, { conexion });

  assert.equal(promovido.generacion, 1);
  assert.equal(promovido.estado, 'pendiente_primera_evidencia');
  assert.equal(estadoSql.bloqueos, 1);
  assert.equal(estadoSql.inserciones, 1);
  await assert.rejects(
    repositorio.promoverEnTransaccion({
      agenteId: 7,
      histeresisSinPolSegundos: 120,
      duracionReinicioRecienteSegundos: 300,
      generadaEnUtc: FECHA_GENERACION
    }, { conexion }),
    /generación de perfil servidor vigente/u
  );
  assert.equal(estadoSql.inserciones, 1);
}

async function verificarServicioProtegidoYElegible() {
  const perfil = crearPerfil();
  const base = crearDependenciasServicio({ perfil });
  const servicioCerrado = new ServicioProvisionamientoAgentes({
    ...base.dependencias,
    perfilServidorHabilitado: false
  });
  const lectura = await servicioCerrado.consultarPerfilServidorAgente(
    base.contexto,
    7
  );

  assert.equal(lectura.funcionalidadHabilitada, false);
  assert.equal(lectura.elegibilidad.elegible, true);
  assert.equal(lectura.elegibilidad.caduca, false);
  assert.equal(lectura.puedePromover, false);
  await assert.rejects(
    servicioCerrado.solicitarPerfilServidorAgente(base.contexto, 7, {
      histeresisSinPolSegundos: 120,
      duracionReinicioRecienteSegundos: 300
    }),
    /todavía no está habilitada/u
  );

  const sinEvidencia = crearDependenciasServicio({
    perfil: null,
    evidencia: {
      loginValidoConBootId: true,
      heartbeatExplicitoAceptado: false,
      login: null,
      heartbeat: null
    }
  });
  const servicioSinEvidencia = new ServicioProvisionamientoAgentes({
    ...sinEvidencia.dependencias,
    perfilServidorHabilitado: true
  });
  await assert.rejects(
    servicioSinEvidencia.solicitarPerfilServidorAgente(
      sinEvidencia.contexto,
      7,
      {
        histeresisSinPolSegundos: 120,
        duracionReinicioRecienteSegundos: 300
      }
    ),
    /no ha demostrado/u
  );
  assert.equal(sinEvidencia.promociones.length, 0);
}

async function verificarAuditoriaDePromocion() {
  const base = crearDependenciasServicio({ perfil: null });
  const servicio = new ServicioProvisionamientoAgentes({
    ...base.dependencias,
    perfilServidorHabilitado: true,
    ahora: () => FECHA_GENERACION
  });
  const resultado = await servicio.solicitarPerfilServidorAgente(
    base.contexto,
    7,
    {
      histeresisSinPolSegundos: 120,
      duracionReinicioRecienteSegundos: 300
    }
  );

  assert.equal(resultado.perfil.generacion, 1);
  assert.equal(resultado.perfil.estado, 'pendiente_primera_evidencia');
  assert.equal(base.promociones.length, 1);
  assert.equal(base.catalogosRuntime.length, 1);
  assert.equal(base.catalogosRuntime[0].agenteId, 7);
  assert.equal(base.proyeccionesRuntime.length, 1);
  assert.equal(base.proyeccionesRuntime[0].perfil.generacion, 1);
  assert.equal(base.auditorias.length, 1);
  const intencion = base.auditorias[0].intencion;
  assert.equal(intencion.tipo, 'agente.perfil_servidor_solicitado');
  assert.deepEqual(intencion.payload, {
    resultado: 'creado',
    antes: null,
    despues: {
      perfilOperativo: 'servidor',
      generacionPerfilServidor: 1,
      estadoPerfilServidor: 'pendiente_primera_evidencia',
      histeresisSinPolSegundos: 120,
      duracionReinicioRecienteSegundos: 300
    }
  });

  validarEventoAuditableV1(intencion);
  const definicion = obtenerDefinicionTipoEventoAuditoria(
    'agente.perfil_servidor_solicitado'
  );
  assert.equal(definicion.flujo, 'agentes');
  assert.equal(definicion.perfil, 'alta_v1');
  assert.deepEqual(definicion.sujetos, ['agente']);
  const ruta = MANIFIESTO_RUTAS_AUDITORIA.find(
    ({ id }) => id === 'POST /agentes/:id/perfil-servidor/solicitar'
  );
  assert.equal(ruta?.clasificacion, 'auditable');
  assert.deepEqual(ruta?.eventos, ['agente.perfil_servidor_solicitado']);
}

async function verificarSuperficieAdministrativaYDocumental() {
  const [
    migracion,
    migracionCierre,
    configuracion,
    entorno,
    rutas,
    vista
  ] = await Promise.all([
    leer('migraciones/sql/0001_esquema_inicial.sql').then(normalizarSqlConsolidado),
    leer('migraciones/sql/0001_esquema_inicial.sql').then(normalizarSqlConsolidado),
    leer('paquetes/utilidades/src/configuracion/obtenerConfiguracionAplicacion.js'),
    leer('.env.ejemplo'),
    leer('apps/sentinelia-web/src/rutas/crearRutasPortal.js'),
    leer('apps/sentinelia-web/src/views/portal/agente-formulario.ejs')
  ]);

  assert.match(migracion, /PRIMARY KEY \(agente_id, generacion\)/u);
  assert.match(migracion, /ON DELETE CASCADE/u);
  assert.match(migracion, /pendiente_primera_evidencia/u);
  assert.match(migracionCierre, /desactivado_incompatible/u);
  assert.match(migracionCierre, /estado = 'activo' and armada_en_utc is not null/iu);
  assert.match(configuracion, /AGENTES_PERFIL_SERVIDOR_HABILITADO[\s\S]*true/u);
  assert.match(entorno, /AGENTES_PERFIL_SERVIDOR_HABILITADO=true/u);
  assert.match(rutas, /\/agentes\/:id\/perfil-servidor\/solicitar/u);
  assert.match(vista, /perfilServidor\.elegibilidad/u);
  assert.match(vista, /data-fecha-utc/u);
  assert.match(vista, /Gestión cerrada por despliegue/u);
}

function crearDependenciasServicio({
  perfil = null,
  evidencia = {
    loginValidoConBootId: true,
    heartbeatExplicitoAceptado: true,
    login: null,
    heartbeat: null
  }
} = {}) {
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
  const promociones = [];
  const auditorias = [];
  const catalogosRuntime = [];
  const proyeccionesRuntime = [];
  const repositorioPerfilesServidor = {
    async buscarPorAgenteId() {
      return perfil;
    },
    async buscarEvidenciaElegibilidad() {
      return evidencia;
    },
    async promoverEnTransaccion(datos) {
      promociones.push(datos);
      perfil = crearPerfil({
        generacion: (perfil?.generacion || 0) + 1,
        histeresis_sin_pol_segundos: datos.histeresisSinPolSegundos,
        duracion_reinicio_reciente_segundos:
          datos.duracionReinicioRecienteSegundos,
        generada_en_utc: datos.generadaEnUtc
      });
      return perfil;
    }
  };
  const contexto = {
    idUsuario: 11,
    permisos: { modificarAgentes: true }
  };

  return {
    contexto,
    promociones,
    auditorias,
    catalogosRuntime,
    proyeccionesRuntime,
    dependencias: {
      repositorioAgentes: {
        async buscarPorId(id) {
          return Number(id) === agente.id ? agente : null;
        }
      },
      repositorioSitios: {},
      repositorioPerfilesServidor,
      politicaPermisosAgentes: {
        assertPuedeVer() {},
        assertPuedeModificar() {},
        puedeModificar() { return true; },
        puedeAlcanzarAgente() { return true; }
      },
      fronteraTransaccional: {
        async ejecutar(operacion) {
          return operacion({ execute: async () => [[], []] });
        }
      },
      servicioAuditoria: {
        async registrarEnTransaccion(datos) {
          auditorias.push(datos);
          return { eventoId: datos.intencion.eventoId };
        },
        async registrarMovimientoEnTransaccion() {}
      },
      publicadorTelemetriaRuntimeEnTransaccion: {
        async asegurarCatalogoServidorEnTransaccion(datos) {
          catalogosRuntime.push(datos);
          return { senales: [], creadas: [] };
        }
      },
      repositorioEstadoRuntimeServidor: {
        async crearParaPerfilEnTransaccion(datos) {
          proyeccionesRuntime.push(datos);
          return null;
        }
      }
    }
  };
}

function crearPerfil(sobrescritura = {}) {
  return new PerfilServidorAgente(filaPerfil(sobrescritura));
}

function filaPerfil(sobrescritura = {}) {
  return {
    agente_id: 7,
    generacion: 1,
    estado: ESTADOS_PERFIL_SERVIDOR_AGENTE.PENDIENTE_PRIMERA_EVIDENCIA,
    histeresis_sin_pol_segundos: 120,
    duracion_reinicio_reciente_segundos: 300,
    generada_en_utc: '2026-08-24 10:00:00.000',
    armada_en_utc: null,
    cerrada_en_utc: null,
    codigo_cierre: null,
    detalle_cierre: null,
    version_estado: 1,
    fecha_creacion: '2026-08-24 10:00:00.000',
    fecha_actualizacion: '2026-08-24 10:00:00.000',
    ...sobrescritura
  };
}

async function leer(ruta) {
  return readFile(new URL(ruta, RAIZ), 'utf8');
}

function normalizarSqlConsolidado(contenido) {
  return contenido.replaceAll('`', '').replace(/,(?!\s)/g, ', ');
}

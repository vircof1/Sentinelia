import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import { ProyectorConsultaOperacionEliminacionAgente }
  from '../paquetes/agentes/src/ProyectorConsultaOperacionEliminacionAgente.js';
import { ServicioConsultaOperacionesAdministrativas }
  from '../paquetes/coordinacion-durable/src/ServicioConsultaOperacionesAdministrativas.js';
import { CatalogoProyectoresConsultaOperacionesAdministrativas }
  from '../paquetes/coordinacion-durable/src/CatalogoProyectoresConsultaOperacionesAdministrativas.js';
import { ProyectorConsultaOperacionEliminacionOrganizacion }
  from '../paquetes/jerarquia-organizativa/src/ProyectorConsultaOperacionEliminacionOrganizacion.js';

const OPERACION_ORG = '018f7f40-1111-7111-8111-111111111111';
const OPERACION_AGENTE = '018f7f40-2222-7222-8222-222222222222';

await main();

async function main() {
  verificarCatalogoCerrado();
  await verificarRaizVivaUsaScopeActual();
  await verificarFotografiaFinalYAusenciaIlegitima();
  await verificarRegresionAgente();
  await verificarSuperficieTransversal();
  console.log(
    '[organizacion] OK 5.26.6b: consulta=transversal contratos=cerrados ' +
    'raiz_viva=scope_actual scope_aceptado=no_autoriza fotografia_final=legitima ' +
    'ausencia_sin_foto=404 permisos_actuales=exigidos vista=ruta_generica agente=regresion'
  );
}

function verificarCatalogoCerrado() {
  assert.throws(
    () => new CatalogoProyectoresConsultaOperacionesAdministrativas(),
    /proyectores de operación explícitos/u
  );
  const proyector = {
    tipo: 'eliminar_organizacion',
    version: 1,
    async proyectarSujeto() { return null; }
  };
  assert.throws(
    () => new CatalogoProyectoresConsultaOperacionesAdministrativas({
      proyectores: [proyector, proyector]
    }),
    /más de un proyector/u
  );
}

async function verificarRaizVivaUsaScopeActual() {
  const operacion = crearOperacionOrganizacion({
    estado: 'ejecutando',
    scopeAceptado: scope('empresa', 1, 10, null)
  });
  const servicio = crearServicio({
    operaciones: new Map([[OPERACION_ORG, operacion]]),
    empresas: [{
      id: 30,
      tenantId: 2,
      nombre: 'Empresa <movida>',
      tenantNombre: 'Tenant dos'
    }]
  });
  const visible = await servicio.obtener(contextoEmpresa(2, 30), OPERACION_ORG);
  assert.equal(visible.sujeto.nombre, 'Empresa ‹movida›');
  assert.equal(visible.sujeto.disponible, true);
  assert.equal('comando' in visible, false);
  assert.equal(JSON.stringify(visible).includes('scopeAceptado'), false);

  await rechazaIgual(servicio, contextoEmpresa(1, 10), OPERACION_ORG);
  await rechazaIgual(servicio, { ...contextoEmpresa(2, 30), administrar: false }, OPERACION_ORG);
}

async function verificarFotografiaFinalYAusenciaIlegitima() {
  const completada = crearOperacionOrganizacion({
    estado: 'completada',
    fotografiaFinal: {
      tipo: 'empresa',
      id: '30',
      nombre: 'Empresa final',
      scopeFinal: scope('empresa', 2, 30, null),
      capturadaEnUtc: '2026-08-30T12:02:00.000Z'
    }
  });
  const fallida = crearOperacionOrganizacion({ estado: 'fallida' });
  const servicio = crearServicio({
    operaciones: new Map([
      [OPERACION_ORG, completada],
      [OPERACION_AGENTE, fallida]
    ]),
    empresas: []
  });
  const visible = await servicio.obtener(contextoEmpresa(2, 30), OPERACION_ORG);
  assert.equal(visible.sujeto.fotografiaFinal, true);
  assert.equal(visible.sujeto.nombre, 'Empresa final');
  assert.equal(visible.limpiezaPostcommit.estado, 'no_requerida');
  await rechazaIgual(servicio, contextoEmpresa(1, 10), OPERACION_ORG);

  fallida.operacionId = OPERACION_AGENTE;
  await rechazaIgual(servicio, contextoEmpresa(2, 30), OPERACION_AGENTE);
}

async function verificarRegresionAgente() {
  const operacion = crearOperacionAgente();
  const servicio = crearServicio({
    operaciones: new Map([[OPERACION_AGENTE, operacion]]),
    agentes: [{
      id: 9,
      guid: operacion.sujeto.guid,
      nombre: 'Agente vivo',
      tenantId: 2,
      empresaId: 30,
      sitioId: 90
    }]
  });
  const visible = await servicio.obtener(contextoSitio(2, 30, 90), OPERACION_AGENTE);
  assert.equal(visible.sujeto.nombre, 'Agente vivo');
  await rechazaIgual(servicio, contextoSitio(2, 30, 91), OPERACION_AGENTE);
  operacion.estado = 'fallida';
  operacion.fase = 'eliminacion';
  operacion.terminal = true;
  operacion.ultimoError = { codigo: 'sql_secreto', mensaje: 'credencial secreta' };
  operacion.terminadaEnUtc = '2026-08-30T12:02:00.000Z';
  const fallidaVisible = await servicio.obtener(
    contextoSitio(2, 30, 90),
    OPERACION_AGENTE
  );
  assert.deepEqual(fallidaVisible.ultimoError, {
    codigo: 'operacion_administrativa_fallida',
    mensaje: 'La operación no pudo completarse.'
  });
  assert.equal(JSON.stringify(fallidaVisible).includes('secreto'), false);

  const eliminada = crearOperacionAgente();
  eliminada.estado = 'completada';
  eliminada.fase = 'limpieza';
  eliminada.terminal = true;
  eliminada.terminadaEnUtc = '2026-08-30T12:02:00.000Z';
  eliminada.resultado = {
    resultado: 'eliminado',
    estado: 'completada',
    sujeto: {
      ...eliminada.sujeto,
      scope: scope('sitio', 2, 30, 90)
    },
    obligaciones: []
  };
  const servicioEliminada = crearServicio({
    operaciones: new Map([[OPERACION_AGENTE, eliminada]]),
    agentes: []
  });
  const evidencia = await servicioEliminada.obtener(
    contextoSitio(2, 30, 90),
    OPERACION_AGENTE
  );
  assert.equal(evidencia.sujeto.evidenciaFinal, true);
  assert.equal(evidencia.sujeto.disponible, false);
  await rechazaIgual(
    servicioEliminada,
    contextoSitio(1, 10, 20),
    OPERACION_AGENTE
  );
}

async function verificarSuperficieTransversal() {
  const [rutas, controlador, vista, buzon] = await Promise.all([
    leer('../apps/sentinelia-web/src/rutas/crearRutasPortal.js'),
    leer('../apps/sentinelia-web/src/controladores/ControladorEliminacionAdministrativaAgentes.js'),
    leer('../apps/sentinelia-web/src/views/portal/operacion-administrativa.ejs'),
    leer('../paquetes/agentes/src/ServicioBuzonNotificacionesUsuario.js')
  ]);
  for (const ruta of [
    '/api/operaciones-administrativas/:operacionId',
    '/operaciones-administrativas/:operacionId'
  ]) assert.ok(rutas.includes(ruta));
  assert.match(controlador, /portal\/operacion-administrativa/u);
  assert.match(vista, /data-tipo-sujeto/u);
  assert.match(vista, /api\/operaciones-administrativas/u);
  assert.match(vista, /hero-operativo operacion-seguimiento__hero/u);
  assert.match(vista, /data-operacion-panel-estado/u);
  assert.match(vista, /Recorrido de la operación/u);
  assert.match(vista, /data-operacion-actualizar/u);
  assert.match(vista, /Detalles de la operación/u);
  assert.match(vista, /Confirmación/u);
  assert.doesNotMatch(vista, />Commit</u);
  assert.match(buzon, /operaciones-administrativas/u);
  await assert.rejects(
    readFile(new URL(
      '../apps/sentinelia-web/src/views/portal/operacion-administrativa-agente.ejs',
      import.meta.url
    )),
    (error) => error.code === 'ENOENT'
  );
}

function crearServicio({ operaciones, agentes = [], empresas = [] }) {
  const autorizacion = {
    puedeEliminarAgentes: (contexto) => contexto.eliminar === true,
    puedeAdministrarTenants: (contexto) => contexto.administrar === true,
    puedeAdministrarEmpresas: (contexto) => contexto.administrar === true,
    puedeAdministrarSitios: (contexto) => contexto.administrar === true
  };
  const catalogo = new CatalogoProyectoresConsultaOperacionesAdministrativas({
    proyectores: [
      new ProyectorConsultaOperacionEliminacionAgente({
        repositorioAgentes: repositorio(agentes),
        servicioAutorizacion: autorizacion
      }),
      new ProyectorConsultaOperacionEliminacionOrganizacion({
        repositorioTenants: repositorio([]),
        repositorioEmpresas: repositorio(empresas),
        repositorioSitios: repositorio([]),
        servicioAutorizacion: autorizacion
      })
    ]
  });
  return new ServicioConsultaOperacionesAdministrativas({
    repositorioOperaciones: {
      async buscarPorId(id) { return operaciones.get(id) || null; }
    },
    repositorioObligaciones: {
      async obtenerSituacionPorOperacion() {
        return { total: 0, completadas: 0, pendientes: 0, bloqueadas: 0 };
      }
    },
    catalogoProyectores: catalogo
  });
}

function crearOperacionOrganizacion({
  estado,
  scopeAceptado = scope('empresa', 1, 10, null),
  fotografiaFinal = null
}) {
  return {
    operacionId: OPERACION_ORG,
    tipo: 'eliminar_organizacion',
    version: 1,
    sujeto: { tipo: 'empresa', id: '30', scope: scopeAceptado },
    comando: { fotografiaAutorizacion: { scopeAceptado } },
    estado,
    fase: estado === 'ejecutando' ? 'eliminacion' : 'limpieza',
    terminal: estado !== 'ejecutando',
    intentos: 1,
    maxIntentos: 3,
    resultado: estado === 'completada' ? {
      resultado: 'eliminada',
      estado: 'completada',
      sujeto: { tipo: 'empresa', id: '30', scope: fotografiaFinal.scopeFinal },
      fotografiaFinal,
      obligaciones: []
    } : null,
    ultimoError: estado === 'fallida' ? { codigo: 'interno', mensaje: 'secreto' } : null,
    creadaEnUtc: '2026-08-30T12:00:00.000Z',
    actualizadaEnUtc: '2026-08-30T12:03:00.000Z',
    terminadaEnUtc: estado === 'ejecutando' ? null : '2026-08-30T12:03:00.000Z'
  };
}

function crearOperacionAgente() {
  return {
    operacionId: OPERACION_AGENTE,
    tipo: 'eliminar_agente',
    version: 1,
    sujeto: {
      tipo: 'agente', id: '9', guid: '01234567-89ab-4def-8abc-0123456789ab',
      scope: scope('sitio', 1, 10, 20)
    },
    estado: 'ejecutando',
    fase: 'eliminacion',
    terminal: false,
    intentos: 1,
    maxIntentos: 3,
    resultado: null,
    ultimoError: null,
    creadaEnUtc: '2026-08-30T12:00:00.000Z',
    actualizadaEnUtc: '2026-08-30T12:01:00.000Z',
    terminadaEnUtc: null
  };
}

function repositorio(entidades) {
  return {
    async buscarPorId(id) {
      return entidades.find((entidad) => String(entidad.id) === String(id)) || null;
    }
  };
}

function contextoEmpresa(tenantId, empresaId) {
  return { nivelScope: 'empresa', tenantId, empresaId, eliminar: true, administrar: true };
}

function contextoSitio(tenantId, empresaId, sitioId) {
  return {
    nivelScope: 'sitio', tenantId, empresaId, sitioId, eliminar: true, administrar: true
  };
}

function scope(nivel, tenantId, empresaId, sitioId) {
  return { nivel, tenantId: String(tenantId), empresaId, sitioId };
}

async function rechazaIgual(servicio, contexto, operacionId) {
  await assert.rejects(
    servicio.obtener(contexto, operacionId),
    (error) => error.statusCode === 404 &&
      error.codigo === 'operacion_administrativa_no_encontrada'
  );
}

function leer(ruta) {
  return readFile(new URL(ruta, import.meta.url), 'utf8');
}

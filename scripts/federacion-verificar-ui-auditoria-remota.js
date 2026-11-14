import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import ejs from 'ejs';

import { RepositorioAuditoriaRemotaSql }
  from '../paquetes/federacion/adaptadores/RepositorioAuditoriaRemotaSql.js';
import { ServicioAuditoriaRemotaFederacionPortal }
  from '../paquetes/federacion/aplicacion/ServicioAuditoriaRemotaFederacionPortal.js';
import { crearPayloadAuditoriaFederadaDesdeVista }
  from '../paquetes/federacion/src/PayloadAuditoriaFederada.js';

const INSTALLATION_ID = 'sfid1.instalacion.GQHc7zWJ9TuCYT0ojATWoQ';
const PROYECCION_ID = 'sfid1.proyeccion.sQRWXMZQvpV7G7-j1snUEw';
const ELEMENTO_ID = 'sfid1.elemento_origen.7UB40ag-5Ja5_HpPtFZHfg';

await verificarRepositorioAcotado();
const salida = await verificarServicio();
await verificarPresentacion(salida);
await verificarComposicion();
console.log('UI de auditoría remota verificada: scope, evidencia, cronología y retención.');

async function verificarRepositorioAcotado() {
  const llamadas = [];
  const repositorio = new RepositorioAuditoriaRemotaSql({
    obtenerConexion() {},
    async consultar(sql, parametros) {
      llamadas.push({ sql, parametros });
      return [];
    }
  });
  const scope = { nivel: 'empresa', tenantId: 12, empresaId: 34, sitioId: null };
  await repositorio.listarEventos({ installationOrigenId: INSTALLATION_ID, scope });
  await repositorio.listarAnclajesRetencion({
    installationOrigenId: INSTALLATION_ID,
    scope,
    claveCadenaOrigen: 'monitores:tenant:12'
  });
  assert.equal(llamadas.length, 2);
  assert.match(llamadas[0].sql, /v\.estado_publicacion='actual'/u);
  assert.doesNotMatch(llamadas[0].sql, /v\.estado_autorizacion='autorizada'/u);
  assert.match(llamadas[0].sql, /p\.scope_tenant_id=\?/u);
  assert.match(llamadas[0].sql, /p\.scope_empresa_id=\?/u);
  assert.match(llamadas[1].sql, /f\.scope_tenant_id=\?/u);
  assert.match(llamadas[1].sql, /f\.scope_empresa_id=\?/u);
  for (const llamada of llamadas) {
    assert.ok(llamada.parametros.includes('12'));
    assert.ok(llamada.parametros.includes('34'));
    assert.ok(llamada.parametros.includes(INSTALLATION_ID));
  }
  await assert.rejects(
    repositorio.listarEventos({
      installationOrigenId: INSTALLATION_ID,
      scope: { nivel: 'empresa', tenantId: 12, empresaId: null }
    }),
    (error) => error.codigo === 'scope_consulta_auditoria_remota_invalido'
  );
}

async function verificarServicio() {
  const payloadUno = crearPayload('01991f00-0000-7000-8000-000000000001', {
    registradoEnUtc: '2035-01-01T00:00:01.000Z'
  });
  const payloadDos = crearPayload('01991f00-0000-7000-8000-000000000002', {
    registradoEnUtc: '2035-01-01T00:00:02.000Z'
  });
  const payloadDivergente = crearPayload(
    '01991f00-0000-7000-8000-000000000003',
    { registradoEnUtc: '2035-01-01T00:00:03.000Z' }
  );
  const registros = [
    registro(payloadUno),
    registro(payloadDos),
    registro(payloadDivergente, { resultadoValidacionReceptor: 'verificada' })
  ];
  const llamadas = [];
  const servicio = new ServicioAuditoriaRemotaFederacionPortal({
    repositorio: {
      async listarEventos(filtros) {
        llamadas.push({ metodo: 'eventos', filtros });
        return registros;
      },
      async listarAnclajesRetencion(filtros) {
        llamadas.push({ metodo: 'anclajes', filtros });
        return [{
          relacionId: 'relacion', flujoId: 'flujo', generacionId: 'generacion',
          installationOrigenId: INSTALLATION_ID,
          claveCadenaOrigen: 'monitores:tenant:12',
          scopeRecepcion: { nivel: 'empresa', tenantId: '12', empresaId: '34', sitioId: null },
          ultimaSecuenciaRetirada: '0', ultimoEventoRetiradoId: null,
          hashActualUltimoRetirado: 'a'.repeat(64), hashAnclaLocal: 'b'.repeat(64),
          primeraSecuenciaConservada: '1', primerEventoConservadoId: payloadUno.eventoOrigenId,
          estadoContinuidad: 'verificadaDesdeAncla', causaContinuidad: null,
          eventosRetiradosAcumulados: '3', politicaDias: 90,
          versionPolitica: '2', aplicadoEnUtc: '2035-01-02T00:00:00.000Z'
        }];
      }
    },
    servicioAutorizacion: {
      puedeVerAuditoria(contexto) { return Boolean(contexto?.permisos?.verAuditoria); }
    }
  });
  const contexto = {
    nivelScope: 'empresa', tenantId: 12, empresaId: 34, sitioId: null,
    permisos: { verAuditoria: true }
  };
  const salida = await servicio.obtener(contexto, {
    installationOrigenId: INSTALLATION_ID,
    vista: 'historico',
    resultadoValidacion: 'noVerificable',
    limite: 200
  });
  assert.deepEqual(llamadas[0].filtros.scope, {
    nivel: 'empresa', tenantId: 12, empresaId: 34, sitioId: null
  });
  assert.equal(llamadas[0].filtros.resultadoValidacion, 'noVerificable');
  assert.equal(salida.resumen.eventos, 3);
  assert.equal(salida.resumen.noVerificables, 2);
  assert.equal(salida.resumen.invalidas, 1);
  assert.equal(salida.resumen.eventosSinCadena, 3);
  assert.equal(salida.cadenas.length, 0);
  assert.match(salida.eventos[2].causaValidacion, /validacionPersistidaDivergente/u);
  assert.equal(salida.anclajes.length, 1);
  assert.equal(salida.eventos[0].payload.secretoVisibleAutorizado, 'contenido autorizado');
  assert.deepEqual(salida.eventos[0].scopeOrigen, {
    tenantId: '12', empresaId: '34', sitioId: null
  });
  await assert.rejects(
    servicio.obtener({ ...contexto, permisos: {} }, { installationOrigenId: INSTALLATION_ID }),
    (error) => error.statusCode === 403 && error.codigo === 'auditoria_federada_no_autorizada'
  );
  await assert.rejects(
    servicio.obtener(contexto, { installationOrigenId: INSTALLATION_ID, vista: 'integridadGlobal' }),
    (error) => error.statusCode === 400 && error.codigo === 'vista_auditoria_federada_invalida'
  );
  llamadas.length = 0;
  await servicio.obtener(contexto, {
    installationOrigenId: INSTALLATION_ID,
    vista: 'actividad',
    desdeUtc: '2035-01-01',
    hastaUtc: '2035-01-01'
  });
  assert.deepEqual(llamadas.map((llamada) => llamada.metodo), ['eventos']);
  assert.equal(llamadas[0].filtros.desdeUtc, '2035-01-01T00:00:00.000Z');
  assert.equal(llamadas[0].filtros.hastaUtc, '2035-01-02T00:00:00.000Z');
  return salida;
}

async function verificarPresentacion(auditoriaRemota) {
  const plantilla = await leer(
    '../apps/sentinelia-web/src/views/portal/parciales/federacion-auditoria-remota.ejs'
  );
  const html = ejs.render(plantilla, {
    auditoriaRemota,
    navegacion: {
      installationOrigenId: INSTALLATION_ID,
      subvista: 'historico'
    },
    seccionActual: { icono: 'bi-journal-check' },
    subsecciones: [
      { id: 'resumen', etiqueta: 'Resumen' },
      { id: 'actividad', etiqueta: 'Actividad' },
      { id: 'historico', etiqueta: 'Histórico' }
    ],
    urlSubvista: (vista) => `/federacion/remota/${vista}`
  });
  assert.match(html, /Auditoría federada/u);
  assert.match(html, /sin incorporarse a la cadena\s+de auditoría local/u);
  assert.match(html, /no prometen integridad global/u);
  assert.match(html, /Anclajes de retención del receptor/u);
  assert.match(html, /auditoria-tabla/u);
  assert.match(html, /Ver contexto y evidencia autorizados/u);
  assert.match(html, /contenido autorizado/u);
}

async function verificarComposicion() {
  const [vista, controlador, composicion] = await Promise.all([
    leer('../apps/sentinelia-web/src/views/portal/federacion-datos-remotos.ejs'),
    leer('../apps/sentinelia-web/src/controladores/ControladorFederacion.js'),
    leer('../apps/sentinelia-web/src/index.js')
  ]);
  assert.match(vista, /federacion-auditoria-remota/u);
  assert.match(controlador, /servicioAuditoriaRemota/u);
  assert.match(composicion, /ServicioAuditoriaRemotaFederacionPortal/u);
}

function crearPayload(eventoId, { registradoEnUtc }) {
  return crearPayloadAuditoriaFederadaDesdeVista({
    vistaAutorizada: {
      eventoId,
      tipoEvento: 'monitor.actualizado',
      versionContrato: 1,
      flujo: 'monitores',
      sujeto: { tipo: 'monitor', id: '44' },
      scope: { tenantId: '12', empresaId: '34', sitioId: null },
      efectivoEnUtc: registradoEnUtc,
      registradoEnUtc,
      payload: {
        resultado: 'actualizado',
        secretoVisibleAutorizado: 'contenido autorizado'
      }
    },
    evidenciaOrigen: { estado: 'noVerificable', causa: 'vistaParcialOrigen' }
  });
}

function registro(payload, cambios = {}) {
  return {
    proyeccionId: PROYECCION_ID,
    generacionId: 'sfid1.generacion.LULLs4GL7NEVwfMVSRJWBw',
    elementoOrigenId: ELEMENTO_ID,
    ocurrenciaOrigenId: 'sfid1.ocurrencia_origen.oZ0Z1JhVEg',
    eventoOrigenId: payload.eventoOrigenId,
    claveCadenaOrigen: null,
    secuenciaCadenaOrigen: null,
    estadoVerificabilidadOrigen: 'noVerificable',
    resultadoValidacionReceptor: 'noVerificable',
    causaValidacion: 'vistaParcialOrigen',
    hashesOrigen: { payload: null, anterior: null, actual: null },
    anclaReceptor: { hashRepresentacion: 'c'.repeat(64), hashAncla: 'd'.repeat(64) },
    scopeRecepcion: { nivel: 'empresa', tenantId: '12', empresaId: '34', sitioId: null },
    completitud: { interpretable: 'completa', observable: 'completa', reconstruible: 'completa' },
    estadoProyeccion: { vigencia: 'vigente', soporte: 'soportada', autorizacion: 'autorizada' },
    payload,
    ...cambios
  };
}

function leer(ruta) {
  return readFile(new URL(ruta, import.meta.url), 'utf8');
}

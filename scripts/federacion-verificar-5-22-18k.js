import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import ejs from 'ejs';
import { ServicioAutorizacion } from '../paquetes/autorizacion/src/ServicioAutorizacion.js';
import { RepositorioTelemetriaRemotaPortalSql } from '../paquetes/federacion/adaptadores/RepositorioTelemetriaRemotaPortalSql.js';
import { ServicioTelemetriaRemotaFederacionPortal } from '../paquetes/federacion/aplicacion/ServicioTelemetriaRemotaFederacionPortal.js';
import { ControladorFederacion } from '../apps/sentinelia-web/src/controladores/ControladorFederacion.js';

const raiz = new URL('../', import.meta.url);
const installationId = 'sfid1.instalacion.GQHc7zWJ9TuCYT0ojATWoQ';
const senalOrigenId = 'sfid1.elemento_origen.ypZ1OBf59W9TBiZHupQWwQ';

await verificarServicio();
await verificarConsultaPortal();
await verificarPresentacion();
await verificarNavegacionAgentes();
await verificarComposicion();
console.log('5.22.18k verificada: resumen, actividad e histórico remotos acotados y navegables.');

async function verificarServicio() {
  const llamadas = [];
  const servicio = new ServicioTelemetriaRemotaFederacionPortal({
    servicioAutorizacion: new ServicioAutorizacion(),
    repositorio: {
      async listarResumen(entrada) {
        llamadas.push(entrada);
        return registrosEjemplo();
      },
      async listarActividad(entrada) {
        llamadas.push(entrada);
        return registrosEjemplo().filter((registro) =>
          ['observacion', 'eventoDerivado', 'fotografiaPol'].includes(registro.tipoRegistro));
      },
      async listarHistorico(entrada) {
        llamadas.push(entrada);
        return registrosEjemplo().filter((registro) =>
          ['observacion', 'rangoHistorico'].includes(registro.tipoRegistro));
      }
    }
  });
  const salida = await servicio.obtener({
    nivelScope: 'empresa', tenantId: 2, empresaId: 3, sitioId: null,
    permisos: { verAgentes: true }
  }, { installationOrigenId: installationId });
  assert.deepEqual(llamadas[0].scope, {
    nivel: 'empresa', tenantId: 2, empresaId: 3, sitioId: null
  });
  assert.equal(salida.resumen.fuentes, 1);
  assert.equal(salida.resumen.senales, 1);
  assert.equal(salida.resumen.senalesConEstado, 1);
  assert.equal(salida.resumen.polAbiertos, 1);
  assert.equal(salida.fuentes[0].senales[0].estadoActual.valor, 12.5);
  const actividad = await servicio.obtener({
    nivelScope: 'empresa', tenantId: 2, empresaId: 3, sitioId: null,
    permisos: { verAgentes: true }
  }, { installationOrigenId: installationId, vista: 'actividad' });
  assert.equal(actividad.resumen.observaciones, 1);
  assert.equal(actividad.resumen.eventosDerivados, 1);
  assert.equal(actividad.resumen.estadosPol, 1);
  assert.equal(
    actividad.grafico.pol.periodos[0].finEfectivoUtc,
    '2026-08-17T10:02:00.000Z'
  );
  assert.equal(actividad.grafico.pol.periodos[0].silencioDetectado, true);
  const actividadFiltrada = await servicio.obtener({
    nivelScope: 'empresa', tenantId: 2, empresaId: 3, sitioId: null,
    permisos: { verAgentes: true }
  }, {
    installationOrigenId: installationId,
    vista: 'actividad',
    senalOrigenId,
    desdeUtc: '2026-08-17T08:00:00.000Z',
    hastaUtc: '2026-08-17T10:00:00.000Z',
    limite: 300
  });
  assert.equal(actividadFiltrada.filtros.senalOrigenId, senalOrigenId);
  assert.equal(actividadFiltrada.filtros.limite, 300);
  const llamadaActividadFiltrada = llamadas.find((llamada) =>
    llamada.senalOrigenId === senalOrigenId);
  assert.equal(llamadaActividadFiltrada.desdeUtc, '2026-08-17T08:00:00.000Z');
  await assert.rejects(() => servicio.obtener({
    nivelScope: 'portal', permisos: { verAgentes: true }
  }, {
    installationOrigenId: installationId, vista: 'actividad',
    desdeUtc: '2026-08-17T10:00:00.000Z', hastaUtc: '2026-08-17T08:00:00.000Z'
  }), (error) => error.statusCode === 400 && error.codigo === 'rango_actividad_telemetria_invalido');
  const historico = await servicio.obtener({
    nivelScope: 'empresa', tenantId: 2, empresaId: 3, sitioId: null,
    permisos: { verAgentes: true }
  }, { installationOrigenId: installationId, vista: 'historico' });
  assert.equal(historico.resumen.observaciones, 1);
  assert.equal(historico.resumen.huecos, 1);
  assert.equal(historico.entradas[1].causa, 'retencionOrigen');
  await assert.rejects(
    servicio.obtener({ nivelScope: 'portal', permisos: { verMonitores: true } }, {
      installationOrigenId: installationId
    }),
    (error) => error.statusCode === 403 && error.codigo === 'telemetria_remota_no_autorizada'
  );
  await assert.rejects(
    servicio.obtener({ nivelScope: 'portal', permisos: {} }, {
      installationOrigenId: installationId
    }),
    (error) => error.statusCode === 403 && error.codigo === 'telemetria_remota_no_autorizada'
  );
}

async function verificarNavegacionAgentes() {
  let filtrosExplorador;
  let solicitudTelemetria;
  let renderizado;
  const telemetriaRemota = Object.freeze({
    installationOrigenId: installationId,
    fuentes: Object.freeze([]),
    senalesSinFuente: Object.freeze([]),
    resumen: Object.freeze({ fuentes: 0 })
  });
  const controlador = new ControladorFederacion({
    servicioAdministracionFederacion: { async obtenerPanel() { return {}; } },
    servicioExploradorDatosRemotos: {
      async obtener(_contexto, filtros) {
        filtrosExplorador = filtros;
        return {
          familias: [], filtros: {}, elementos: [],
          paginacion: { pagina: 1, limite: 100, total: 0, paginas: 1 }
        };
      }
    },
    servicioTelemetriaRemota: {
      async obtener(_contexto, solicitud) {
        solicitudTelemetria = solicitud;
        return telemetriaRemota;
      }
    }
  });
  await controlador.mostrarDatosRemotos({
    query: { procedencia: installationId, vista: 'telemetria', subvista: 'resumen' },
    contextoUsuarioActual: { nivelScope: 'portal', permisos: { verAgentes: true } },
    session: { usuarioAutenticado: { id: 1 } }
  }, {
    set() {},
    render(vista, locales) { renderizado = { vista, locales }; }
  }, (error) => { throw error; });
  assert.equal(renderizado.vista, 'portal/federacion-datos-remotos');
  assert.equal(renderizado.locales.navegacionRemota.vista, 'agentes');
  assert.equal(renderizado.locales.telemetriaRemota, telemetriaRemota);
  assert.equal(filtrosExplorador.familia, null);
  assert.equal(solicitudTelemetria.vista, 'resumen');
}

async function verificarConsultaPortal() {
  const consultas = [];
  const repositorio = new RepositorioTelemetriaRemotaPortalSql({
    async consultar(sql, parametros) {
      consultas.push({ sql, parametros });
      if (sql.includes('periodos_pol AS')) return filasSqlPeriodosPol();
      return [];
    }
  });
  await repositorio.listarResumen({
    installationOrigenId: installationId,
    scope: { nivel: 'sitio', tenantId: 2, empresaId: 3, sitioId: 4 }
  });
  const actividad = await repositorio.listarActividad({
    installationOrigenId: installationId,
    scope: { nivel: 'sitio', tenantId: 2, empresaId: 3, sitioId: 4 },
    senalOrigenId,
    desdeUtc: '2026-08-17T08:00:00.000Z',
    hastaUtc: '2026-08-17T10:00:00.000Z',
    limite: 300
  });
  assert.equal(actividad.length, 2);
  assert.deepEqual(actividad.map((registro) => registro.payload.estado), ['abierto', 'cerrado']);
  await repositorio.listarHistorico({
    installationOrigenId: installationId,
    scope: { nivel: 'sitio', tenantId: 2, empresaId: 3, sitioId: 4 }
  });
  assert.match(consultas[0].sql, /p\.familia='telemetria'/u);
  assert.match(consultas[0].sql, /v\.estado_autorizacion='autorizada'/u);
  assert.match(consultas[0].sql, /r0\.estado_registro='retirado'/u);
  assert.match(consultas[0].sql, /p\.scope_sitio_id=\?/u);
  assert.deepEqual(consultas[0].parametros, [installationId, 2, 3, 4, 1000]);
  assert.match(consultas[1].sql, /'eventoDerivado'/u);
  assert.match(consultas[1].sql, /r0\.senal_origen_id=\?/u);
  assert.match(consultas[1].sql, /r0\.tiempo_dato_utc>=\?/u);
  assert.match(consultas[1].sql, /r0\.estado_registro='retirado' OR/u);
  assert.equal(consultas[1].parametros[0], senalOrigenId);
  assert.equal(consultas[1].parametros[1].toISOString(), '2026-08-17T08:00:00.000Z');
  assert.equal(consultas[1].parametros[2].toISOString(), '2026-08-17T10:00:00.000Z');
  assert.equal(consultas[1].parametros[3], installationId);
  assert.equal(consultas[1].parametros[7], 300);
  assert.match(consultas[2].sql, /vh\.estado_publicacion IN \('actual','historica'\)/u);
  assert.match(consultas[2].sql, /GROUP BY x\.proyeccion_id,vh\.generacion_id,r\.referencia_origen_id/u);
  assert.match(consultas[2].sql, /actual\.estado_registro='presente'/u);
  assert.match(consultas[2].sql, /r\.referencia_origen_id IS NOT NULL/u);
  assert.deepEqual(consultas[2].parametros, [installationId, 2, 3, 4]);
  assert.match(consultas[3].sql, /'rangoHistorico'/u);
  assert.deepEqual(consultas[3].parametros, [installationId, 2, 3, 4, 500]);
}

function filasSqlPeriodosPol() {
  const comunes = {
    proyeccion_id: 'sfid1.proyeccion.yTQScDO_8fyNId7iJqvGFA',
    installation_origen_id: installationId,
    elemento_origen_id: 'sfid1.elemento_origen.8gMoHl6fchYmUVPijhgWJA',
    scope_nivel: 'sitio', scope_tenant_id: 2, scope_empresa_id: 3, scope_sitio_id: 4,
    generacion_actual_id: 'sfid1.generacion.ZCaSRQjo1wyWURzNIV2c4A',
    tipo_registro: 'fotografiaPol', fuente_origen_id: 'fuente-1', senal_origen_id: null,
    vigente_hasta_origen_utc: null,
    completitud_interpretable: 'completa', completitud_observable: 'completa',
    completitud_reconstruible: 'completa', estado_vigencia: 'vigente',
    estado_soporte: 'sostenida', estado_autorizacion: 'autorizada'
  };
  return [
    {
      ...comunes,
      generacion_actual_id: 'sfid1.generacion.E7P6w5UBfC0aTfN14u76EA',
      secuencia_elemento: 25,
      tiempo_dato_utc: new Date('2026-08-17T09:30:00.000Z'),
      representacion_canonica: JSON.stringify({
        tipoRegistro: 'fotografiaPol', fuenteOrigenId: 'fuente-1',
        periodoPolOrigenId: 'periodo-actual', estado: 'abierto',
        inicioUtc: '2026-08-17T09:00:00.000Z', ultimoHeartbeatUtc: '2026-08-17T09:30:00.000Z'
      })
    },
    {
      ...comunes, secuencia_elemento: 30,
      tiempo_dato_utc: new Date('2026-08-17T10:00:00.000Z'),
      representacion_canonica: JSON.stringify({
        tipoRegistro: 'fotografiaPol', fuenteOrigenId: 'fuente-1',
        periodoPolOrigenId: 'periodo-actual', estado: 'abierto',
        inicioUtc: '2026-08-17T09:00:00.000Z', ultimoHeartbeatUtc: '2026-08-17T10:00:00.000Z'
      })
    },
    {
      ...comunes,
      generacion_actual_id: 'sfid1.generacion.E7P6w5UBfC0aTfN14u76EA',
      secuencia_elemento: 20,
      tiempo_dato_utc: new Date('2026-08-17T08:30:00.000Z'),
      representacion_canonica: JSON.stringify({
        tipoRegistro: 'fotografiaPol', fuenteOrigenId: 'fuente-1',
        periodoPolOrigenId: 'periodo-previo', estado: 'cerrado',
        inicioUtc: '2026-08-17T07:00:00.000Z', finUtc: '2026-08-17T08:30:00.000Z',
        ultimoHeartbeatUtc: '2026-08-17T08:29:00.000Z'
      })
    },
    {
      ...comunes, secuencia_elemento: 10,
      tiempo_dato_utc: new Date('2026-08-17T07:00:00.000Z'),
      representacion_canonica: JSON.stringify({
        tipoRegistro: 'fotografiaPol', fuenteOrigenId: 'fuente-1',
        periodoPolOrigenId: 'periodo-fuera', estado: 'cerrado',
        inicioUtc: '2026-08-17T06:00:00.000Z', finUtc: '2026-08-17T07:00:00.000Z',
        ultimoHeartbeatUtc: '2026-08-17T06:59:00.000Z'
      })
    }
  ];
}

async function verificarPresentacion() {
  const parcial = await leer('apps/sentinelia-web/src/views/portal/parciales/federacion-telemetria-remota.ejs');
  const servicio = new ServicioTelemetriaRemotaFederacionPortal({
    servicioAutorizacion: new ServicioAutorizacion(),
    repositorio: { async listarResumen() { return registrosEjemplo(); } }
  });
  const telemetriaRemota = await servicio.obtener({
    nivelScope: 'portal', permisos: { verAgentes: true }
  }, { installationOrigenId: installationId });
  const html = ejs.render(parcial, {
    telemetriaRemota,
    navegacion: { subvista: 'resumen' },
    seccionActual: { icono: 'bi-graph-up' },
    subsecciones: [{ id: 'resumen', etiqueta: 'Vista general' }],
    urlSubvista: (subvista) => `/remoto?subvista=${subvista}`
  });
  assert.match(html, /Fuente principal/u);
  assert.match(html, /Carga CPU/u);
  assert.match(html, /12\.5 %/u);
  assert.match(html, /Prueba de vida activa/u);
  assert.match(html, /data-fecha-utc=/u);
  const repositorioVistas = {
    async listarResumen() { return registrosEjemplo(); },
    async listarActividad() {
      return registrosEjemplo().filter((registro) =>
        ['observacion', 'eventoDerivado', 'fotografiaPol'].includes(registro.tipoRegistro));
    },
    async listarHistorico() {
      return registrosEjemplo().filter((registro) =>
        ['observacion', 'rangoHistorico'].includes(registro.tipoRegistro));
    }
  };
  const servicioVistas = new ServicioTelemetriaRemotaFederacionPortal({
    servicioAutorizacion: new ServicioAutorizacion(), repositorio: repositorioVistas
  });
  const contexto = { nivelScope: 'portal', permisos: { verAgentes: true } };
  const comunesVista = {
    seccionActual: { icono: 'bi-graph-up' },
    subsecciones: [
      { id: 'resumen', etiqueta: 'Vista general' },
      { id: 'actividad', etiqueta: 'Cronología operativa' },
      { id: 'historico', etiqueta: 'Muestras y cobertura histórica' }
    ],
    urlSubvista: (subvista) => `/remoto?subvista=${subvista}`
  };
  const htmlActividad = ejs.render(parcial, {
    ...comunesVista,
    navegacion: { subvista: 'actividad' },
    telemetriaRemota: await servicioVistas.obtener(contexto, {
      installationOrigenId: installationId, vista: 'actividad'
    })
  });
  assert.match(htmlActividad, /Evento derivado/u);
  assert.match(htmlActividad, /Umbral de CPU superado/u);
  assert.match(htmlActividad, /Series temporales recibidas/u);
  assert.match(htmlActividad, /Cronología operativa reciente/u);
  assert.match(htmlActividad, /Tipo y unidad/u);
  assert.match(htmlActividad, /data-telemetria-remota-actividad-datos/u);
  assert.match(htmlActividad, /data-telemetria-remota-actividad-filtros/u);
  assert.match(htmlActividad, /data-telemetria-remota-actividad-pol-linea/u);
  const actividad = await servicioVistas.obtener(contexto, {
    installationOrigenId: installationId, vista: 'actividad'
  });
  assert.equal(actividad.grafico.totalPuntos, 1);
  assert.equal(actividad.grafico.unidades[0].unidad, '%');
  assert.equal(actividad.grafico.unidades[0].series[0].puntos[0].valor, 10.5);
  assert.equal(actividad.grafico.pol.periodos[0].abierto, true);
  const htmlHistorico = ejs.render(parcial, {
    ...comunesVista,
    navegacion: { subvista: 'historico' },
    telemetriaRemota: await servicioVistas.obtener(contexto, {
      installationOrigenId: installationId, vista: 'historico'
    })
  });
  assert.match(htmlHistorico, /Muestras y cobertura histórica remota/u);
  assert.match(htmlHistorico, /Intervalo no disponible/u);
  assert.match(htmlHistorico, /retencionOrigen/u);
}

async function verificarComposicion() {
  const [controlador, index, vista, graficoActividad] = await Promise.all([
    leer('apps/sentinelia-web/src/controladores/ControladorFederacion.js'),
    leer('apps/sentinelia-web/src/index.js'),
    leer('apps/sentinelia-web/src/views/portal/federacion-datos-remotos.ejs'),
    leer('apps/sentinelia-web/src/public/js/federacion-telemetria-remota-actividad.js')
  ]);
  assert.match(controlador, /servicioTelemetriaRemota/u);
  assert.match(
    controlador,
    /const telemetriaRemota[\s\S]*?servicioTelemetriaRemota\.obtener\([\s\S]*?vista: navegacionRemota\.subvista/u
  );
  assert.match(index, /RepositorioTelemetriaRemotaPortalSql/u);
  assert.match(index, /ServicioTelemetriaRemotaFederacionPortal/u);
  assert.match(vista, /federacion-telemetria-remota/u);
  assert.match(vista, /vista: 'agentes', familias: \['contextoOperativoAgentesSesiones', 'telemetria'\]/u);
  assert.doesNotMatch(vista, /vista: 'telemetria'/u);
  assert.match(vista, /navegacion\.vista === 'agentes'/u);
  assert.match(vista, /federacion-telemetria-remota-actividad\.js/u);
  assert.match(graficoActividad, /formatearValorGrupo/u);
  assert.match(graficoActividad, /data-telemetria-remota-actividad-unidad/u);
  assert.match(graficoActividad, /fusionarSegmentosPol/u);
  assert.match(graficoActividad, /calcularHuecosPol/u);
  assert.doesNotMatch(index, /adaptadores\/RepositorioTelemetriaRemotaSql\.js/u);
}

function registrosEjemplo() {
  const comunes = {
    installationOrigenId: installationId,
    generacionId: 'generacion-1', secuenciaElemento: '1',
    scopeRecepcion: { nivel: 'portal', tenantId: null, empresaId: null, sitioId: null },
    completitud: { interpretable: 'completa', observable: 'completa', reconstruible: 'completa' },
    estadoPublicacion: { vigencia: 'vigente', soporte: 'sostenida', autorizacion: 'autorizada' }
  };
  return [
    {
      ...comunes, proyeccionId: 'proyeccion-fuente', elementoOrigenId: 'fuente-1',
      tipoRegistro: 'fuente', fuenteOrigenId: 'fuente-1', senalOrigenId: null,
      payload: { nombre: 'Fuente principal', guid: 'guid-1', agenteContextoOrigenId: 'agente-1', scopeOrganizativo: { tenantElementoOrigenId: 'tenant-1', empresaElementoOrigenId: 'empresa-1', sitioElementoOrigenId: 'sitio-1' } }
    },
    {
      ...comunes, proyeccionId: 'proyeccion-senal', elementoOrigenId: 'senal-1',
      tipoRegistro: 'senal', fuenteOrigenId: 'fuente-1', senalOrigenId: 'senal-1',
      payload: { fuenteOrigenId: 'fuente-1', nombreHumano: 'Carga CPU', clave: 'cpu', codigoSenal: 'sistema.cpu', tipoDato: 'numero', unidad: '%', descripcion: 'Carga observada' }
    },
    {
      ...comunes, proyeccionId: 'proyeccion-estado', elementoOrigenId: 'estado-1',
      tipoRegistro: 'fotografiaSenal', fuenteOrigenId: 'fuente-1', senalOrigenId: 'senal-1',
      payload: { observacion: { valor: 12.5, calidad: 'valida', severidadDeclarada: 'info', observadoEnUtc: '2026-08-17T10:00:00.000Z', vigenteHastaUtc: '2099-08-17T10:01:00.000Z' } }
    },
    {
      ...comunes, proyeccionId: 'proyeccion-pol', elementoOrigenId: 'pol-1',
      tipoRegistro: 'fotografiaPol', fuenteOrigenId: 'fuente-1', senalOrigenId: null,
      payload: { estado: 'abierto', bootId: 'boot-1', inicioUtc: '2026-08-17T09:00:00.000Z', ultimoHeartbeatUtc: '2026-08-17T10:00:00.000Z' }
    },
    {
      ...comunes, proyeccionId: 'proyeccion-observacion', elementoOrigenId: 'observacion-1',
      tipoRegistro: 'observacion', fuenteOrigenId: 'fuente-1', senalOrigenId: 'senal-1',
      tiempoDatoUtc: '2026-08-17T09:58:00.000Z',
      payload: { fuenteOrigenId: 'fuente-1', senalOrigenId: 'senal-1', codigoSenal: 'sistema.cpu', categoria: 'sistema', clave: 'cpu', tag: '', tipoDato: 'numero', unidad: '%', valor: 10.5, calidad: 'valida', severidadDeclarada: 'info', origen: 'directa', detalleHumano: 'Muestra recibida', observadoEnUtc: '2026-08-17T09:58:00.000Z', recibidoEnUtc: '2026-08-17T09:58:01.000Z', vigenteHastaUtc: '2099-08-17T09:59:00.000Z' }
    },
    {
      ...comunes, proyeccionId: 'proyeccion-evento', elementoOrigenId: 'evento-1',
      tipoRegistro: 'eventoDerivado', fuenteOrigenId: 'fuente-1', senalOrigenId: 'senal-1',
      tiempoDatoUtc: '2026-08-17T09:59:00.000Z',
      payload: { fuenteOrigenId: 'fuente-1', senalOrigenId: 'senal-1', mensajeOperativo: 'Umbral de CPU superado', explicacion: 'La carga rebasa el umbral', codigoMotivo: 'cpu_alta', severidadCalculada: 'advertencia', calidad: 'valida', valorEvaluado: 90, unidad: '%', observadoEnUtc: '2026-08-17T09:59:00.000Z', evaluadoEnUtc: '2026-08-17T09:59:01.000Z' }
    },
    {
      ...comunes, proyeccionId: 'proyeccion-rango', elementoOrigenId: 'rango-1',
      tipoRegistro: 'rangoHistorico', fuenteOrigenId: 'fuente-1', senalOrigenId: 'senal-1',
      tiempoDatoUtc: '2026-08-17T08:00:00.000Z',
      payload: { fuenteOrigenId: 'fuente-1', senalOrigenId: 'senal-1', causa: 'retencionOrigen', desdeUtc: '2026-08-17T08:00:00.000Z', hastaUtc: '2026-08-17T09:00:00.000Z' }
    }
  ];
}

async function leer(ruta) {
  return readFile(new URL(ruta, raiz), 'utf8');
}

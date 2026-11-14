import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import ejs from 'ejs';
import { ServicioAutorizacion } from '../paquetes/autorizacion/src/ServicioAutorizacion.js';
import { ServicioExploradorDatosRemotosFederacion } from '../paquetes/federacion/aplicacion/ServicioExploradorDatosRemotosFederacion.js';
import { ServicioOrganizacionRemotaFederacionPortal } from '../paquetes/federacion/aplicacion/ServicioOrganizacionRemotaFederacionPortal.js';
import { ServicioMonitoresRemotosFederacionPortal } from '../paquetes/federacion/aplicacion/ServicioMonitoresRemotosFederacionPortal.js';
import { RepositorioExploradorDatosRemotosFederacionSql } from '../paquetes/federacion/adaptadores/RepositorioExploradorDatosRemotosFederacionSql.js';
import { RepositorioOrganizacionRemotaPortalSql } from '../paquetes/federacion/adaptadores/RepositorioOrganizacionRemotaPortalSql.js';
import { RepositorioMonitoresRemotosPortalSql } from '../paquetes/federacion/adaptadores/RepositorioMonitoresRemotosPortalSql.js';

const raiz = new URL('../', import.meta.url);

await verificarAutorizacionPorFamilia();
await verificarLecturaSaneadaYScope();
await verificarOrganizacionRemotaHumana();
await verificarConsultaOrganizativaAcotada();
await verificarInventarioMonitoresRemotos();
await verificarComposicionWeb();
console.log('5.22.18d verificada: exploración remota autorizada, saneada y sin diagnóstico futuro.');

async function verificarAutorizacionPorFamilia() {
  const autorizacion = new ServicioAutorizacion();
  const llamadas = [];
  const servicio = new ServicioExploradorDatosRemotosFederacion({
    servicioAutorizacion: autorizacion,
    repositorio: {
      async listar(entrada) {
        llamadas.push(entrada);
        return { elementos: [], paginacion: { pagina: 1, limite: 25, total: 0, paginas: 1 } };
      }
    }
  });
  const contexto = {
    nivelScope: 'empresa', tenantId: 7, empresaId: 9, sitioId: null,
    permisos: { verMonitores: true }
  };
  const salida = await servicio.obtener(contexto, {});
  assert.deepEqual(salida.familias.map((familia) => familia.nombre), ['monitores']);
  assert.deepEqual(llamadas[0].scope, {
    nivel: 'empresa', tenantId: 7, empresaId: 9, sitioId: null
  });
  await assert.rejects(
    servicio.obtener(contexto, { familia: 'auditoria' }),
    (error) => error.statusCode === 403 && error.codigo === 'familia_remota_no_autorizada'
  );
  assert.equal(
    autorizacion.puedeExplorarDatosRemotosFederacion({ permisos: { verAuditoria: true } }),
    true
  );
  const salidaAgentes = await servicio.obtener({
    ...contexto,
    permisos: { verAgentes: true }
  }, {});
  assert.deepEqual(
    salidaAgentes.familias.map((familia) => familia.nombre),
    ['telemetria', 'contextoOperativoAgentesSesiones']
  );
  assert.equal(
    autorizacion.puedeExplorarDatosRemotosFederacion({ permisos: {} }),
    false
  );
}

async function verificarOrganizacionRemotaHumana() {
  const llamadas = [];
  const servicio = new ServicioOrganizacionRemotaFederacionPortal({
    servicioAutorizacion: new ServicioAutorizacion(),
    repositorio: {
      async listar(entrada) {
        llamadas.push(entrada);
        return [
          {
            proyeccionId: 'proyeccion-1',
            installationOrigenId: entrada.installationOrigenId,
            elementoOrigenId: 'elemento-sitio', generacionId: 'generacion-1',
            secuenciaElemento: '2', estadoRegistro: 'presente', causaRetirada: null,
            tipo: 'sitio', nombre: 'Centro', alias: 'centro', estado: 'activo',
            descripcion: 'Sede remota', timezone: 'Europe/Madrid',
            scopeRecepcion: { nivel: 'empresa', tenantId: '7', empresaId: '9', sitioId: null },
            linaje: [
              { tipo: 'tenant', elementoOrigenId: 'tenant-opaco', nombre: 'No filtrar', visibilidad: 'opaca' },
              { tipo: 'empresa', elementoOrigenId: 'empresa-visible', nombre: 'Aelis', visibilidad: 'seleccionada' }
            ]
          }
        ];
      }
    }
  });
  const salida = await servicio.obtener({
    nivelScope: 'empresa', tenantId: 7, empresaId: 9, sitioId: null,
    permisos: { ver: true }
  }, { installationOrigenId: 'sfid1.instalacion.GQHc7zWJ9TuCYT0ojATWoQ' });
  assert.equal(salida.resumen.sitios, 1);
  assert.equal(salida.actuales[0].ruta[0].nombre, 'Ámbito no visible');
  assert.equal(salida.actuales[0].ruta[1].nombre, 'Aelis');
  assert.deepEqual(llamadas[0].scope, {
    nivel: 'empresa', tenantId: 7, empresaId: 9, sitioId: null
  });
  await assert.rejects(
    servicio.obtener({ nivelScope: 'portal', permisos: { verMonitores: true } }, {
      installationOrigenId: 'sfid1.instalacion.GQHc7zWJ9TuCYT0ojATWoQ'
    }),
    (error) => error.statusCode === 403 && error.codigo === 'organizacion_remota_no_autorizada'
  );
}

async function verificarConsultaOrganizativaAcotada() {
  const consultas = [];
  const repositorio = new RepositorioOrganizacionRemotaPortalSql({
    async consultar(sql, parametros) {
      consultas.push({ sql, parametros });
      return [{
        proyeccion_id: 'proyeccion-1',
        installation_origen_id: 'instalacion-1',
        elemento_origen_id: 'sitio-1', generacion_actual_id: 'generacion-1',
        secuencia_elemento: 3, estado_registro: 'presente', causa_retirada: null,
        tipo_nodo: 'sitio', nombre: 'Centro', alias: 'centro',
        estado_origen: 'activo', descripcion: null, timezone: 'Europe/Madrid',
        scope_nivel: 'empresa', scope_tenant_id: 7, scope_empresa_id: 9,
        scope_sitio_id: null, ordinal: 1, tipo_ancestro: 'tenant',
        ancestro_origen_id: 'tenant-1', ancestro_nombre: 'Tenant remoto',
        visibilidad: 'opaca'
      }];
    }
  });
  const salida = await repositorio.listar({
    installationOrigenId: 'instalacion-1',
    scope: { nivel: 'empresa', tenantId: 7, empresaId: 9, sitioId: null }
  });
  assert.equal(salida[0].linaje[0].visibilidad, 'opaca');
  assert.match(consultas[0].sql, /p\.estado_autorizacion='autorizada'/u);
  assert.match(consultas[0].sql, /p\.scope_tenant_id=\?/u);
  assert.match(consultas[0].sql, /p\.scope_empresa_id=\?/u);
  assert.doesNotMatch(consultas[0].sql, /representacion_canonica|credencial|payload/iu);
  assert.deepEqual(consultas[0].parametros, ['instalacion-1', 7, 9]);
}

async function verificarInventarioMonitoresRemotos() {
  const consultas = [];
  const repositorio = new RepositorioMonitoresRemotosPortalSql({
    async consultar(sql, parametros) {
      consultas.push({ sql, parametros });
      return [{
        proyeccion_id: 'proyeccion-definicion', installation_origen_id: 'instalacion-1',
        elemento_origen_id: 'monitor-1', scope_nivel: 'empresa',
        scope_tenant_id: 7, scope_empresa_id: 9, scope_sitio_id: null,
        secuencia_elemento: 1, nombre: 'HTTP principal', tipo_monitor: 'tcp',
        descripcion: 'Comprueba el servicio', activo: 'true', intervalo_segundos: '60',
        interpretacion_estado: 'normal', descripcion_fallo: 'No responde',
        posible_solucion: 'Revisar el servicio', estado_proyeccion_id: 'proyeccion-estado',
        estado_secuencia: 2, estado_operativo: 'ok',
        tiempo_dato_utc: new Date('2026-08-16T10:00:00.000Z'),
        vigente_hasta_origen_utc: new Date('2026-08-16T10:05:00.000Z'),
        ejecutado_todavia: 'true', ultimo_cambio_utc: '2026-08-16T09:00:00.000Z',
        condicion_temporal: 'vigente',
        vigente_hasta_efectiva_utc: new Date('2026-08-16T10:05:00.000Z'),
        completitud_interpretable: 'completa', completitud_observable: 'completa',
        completitud_reconstruible: 'completa'
      }];
    }
  });
  const monitores = await repositorio.listar({
    installationOrigenId: 'instalacion-1',
    scope: { nivel: 'empresa', tenantId: 7, empresaId: 9, sitioId: null }
  });
  assert.equal(monitores[0].nombre, 'HTTP principal');
  assert.equal(monitores[0].estadoActual.condicion, 'vigente');
  assert.match(consultas[0].sql, /tipo_registro='definicion'/u);
  assert.match(consultas[0].sql, /tipo_registro='estadoActual'/u);
  assert.match(consultas[0].sql, /v\.estado_autorizacion='autorizada'/u);
  assert.match(consultas[0].sql, /estados_temporales_fotografias_remotas/u);
  assert.match(consultas[0].sql, /t\.generacion_id=s\.generacion_actual_id/u);
  assert.doesNotMatch(consultas[0].sql, /t\.generacion_id=s\.generacion_id/u);
  assert.doesNotMatch(consultas[0].sql, /credencialPropia|configuracionOperativa|resultadoActual/iu);
  assert.deepEqual(consultas[0].parametros, ['instalacion-1', 7, 9, 'instalacion-1', 7, 9, 200]);

  const consultasHistorico = [];
  const repositorioHistorico = new RepositorioMonitoresRemotosPortalSql({
    async consultar(sql, parametros) {
      consultasHistorico.push({ sql, parametros });
      return [{
        tipo_registro: 'evento', estado_operativo: 'fallo',
        tiempo_dato_utc: new Date('2026-08-16T10:00:00.000Z'),
        estado_detectado: 'fallo', codigo_resultado: 'tls_no_autorizado',
        mensaje_resultado: 'Certificado no confiable', exito: 'false',
        duracion_total_ms: '31', ejecutado_en_utc: '2026-08-16T10:00:00.000Z',
        estado_tramo: null, codigo_ultimo_resultado: null,
        mensaje_ultimo_resultado: null, valido_desde_utc: null,
        valido_hasta_utc: null, contador_repeticiones: null,
        rango_desde_utc: null, rango_hasta_utc: null, causa_rango: null,
        descripcion_fallo: 'TLS rechazado', posible_solucion: 'Revisar CA'
      }];
    }
  });
  const historico = await repositorioHistorico.listarHistorico({
    installationOrigenId: 'instalacion-1',
    monitorOrigenId: 'monitor-1',
    scope: { nivel: 'empresa', tenantId: 7, empresaId: 9, sitioId: null }
  });
  assert.equal(historico[0].codigo, 'tls_no_autorizado');
  assert.equal(historico[0].duracionTotalMs, 31);
  assert.match(consultasHistorico[0].sql, /tipo_registro IN \('evento','tramoHistorico','rangoHistorico'\)/u);
  assert.match(consultasHistorico[0].sql, /r\.monitor_origen_id=\?/u);
  assert.match(consultasHistorico[0].sql, /v\.estado_autorizacion='autorizada'/u);
  assert.doesNotMatch(consultasHistorico[0].sql,
    /payloadEvento|payloadTramo|resultadoActual|credencialPropia|configuracionOperativa/iu);
  assert.deepEqual(consultasHistorico[0].parametros,
    ['instalacion-1', 7, 9, 'monitor-1', 100]);

  const consultasAlertas = [];
  const repositorioAlertas = new RepositorioMonitoresRemotosPortalSql({
    async consultar(sql, parametros) {
      consultasAlertas.push({ sql, parametros });
      return [{
        proyeccion_id: 'proyeccion-alerta',
        alerta_auditoria_id: '0198b772-7590-7000-8000-000000000001',
        estado_operativo: 'activa', estado_detectado: 'fallo',
        codigo_resultado: 'tls_no_autorizado', mensaje_resultado: 'Certificado no confiable',
        valido_desde_utc: '2027-08-16T09:55:00.000Z',
        ultima_confirmacion_utc: '2027-08-16T10:00:00.000Z',
        ultima_ejecucion_utc: '2027-08-16T10:00:00.000Z', cerrada_en_utc: null,
        tiempo_dato_utc: new Date('2027-08-16T10:00:00.000Z'),
        vigente_hasta_origen_utc: new Date('2099-08-16T10:05:00.000Z'),
        contador_repeticiones: '4', descartada_origen: 'true',
        motivo_descarte_origen: 'Mantenimiento',
        descartada_en_origen_utc: '2027-08-16T10:01:00.000Z',
        descartada_hasta_origen_utc: null,
        descripcion_fallo: 'TLS rechazado', posible_solucion: 'Revisar CA',
        completitud_interpretable: 'completa', completitud_observable: 'completa',
        completitud_reconstruible: 'completa'
      }];
    }
  });
  const alertas = await repositorioAlertas.listarAlertas({
    installationOrigenId: 'instalacion-1',
    monitorOrigenId: 'monitor-1',
    scope: { nivel: 'empresa', tenantId: 7, empresaId: 9, sitioId: null }
  });
  assert.equal(alertas[0].condicion, 'vigente');
  assert.equal(alertas[0].repeticiones, 4);
  assert.equal(alertas[0].descarteOrigen.motivo, 'Mantenimiento');
  assert.match(consultasAlertas[0].sql, /tipo_registro='alerta'/u);
  assert.match(consultasAlertas[0].sql, /r\.monitor_origen_id=\?/u);
  assert.match(consultasAlertas[0].sql, /v\.estado_autorizacion='autorizada'/u);
  assert.doesNotMatch(consultasAlertas[0].sql,
    /payloadAlerta|actorReferencia|credencialPropia|configuracionOperativa/iu);
  assert.deepEqual(consultasAlertas[0].parametros,
    ['instalacion-1', 7, 9, 'monitor-1', 100]);

  const consultasTriggers = [];
  const repositorioTriggers = new RepositorioMonitoresRemotosPortalSql({
    async consultar(sql, parametros) {
      consultasTriggers.push({ sql, parametros });
      return [{
        proyeccion_id: 'proyeccion-referencia', elemento_origen_id: 'referencia-1',
        referencia_origen_id: 'trigger-1', visibilidad: 'visible', activo: 'true',
        orden_ejecucion: '2', eventos_disparo: '["fallo","recuperacion"]',
        completitud_interpretable: 'completa', completitud_observable: 'completa',
        completitud_reconstruible: 'completa'
      }];
    }
  });
  const referenciasTriggers = await repositorioTriggers.listarReferenciasTriggers({
    installationOrigenId: 'instalacion-1',
    monitorOrigenId: 'monitor-1',
    scope: { nivel: 'empresa', tenantId: 7, empresaId: 9, sitioId: null }
  });
  assert.equal(referenciasTriggers[0].triggerOrigenId, 'trigger-1');
  assert.equal(referenciasTriggers[0].activo, true);
  assert.deepEqual(referenciasTriggers[0].eventosDisparo, ['fallo', 'recuperacion']);
  assert.match(consultasTriggers[0].sql, /tipo_registro='referenciaTrigger'/u);
  assert.match(consultasTriggers[0].sql, /r\.monitor_origen_id=\?/u);
  assert.match(consultasTriggers[0].sql, /v\.estado_autorizacion='autorizada'/u);
  assert.doesNotMatch(consultasTriggers[0].sql,
    /configuracionOverride|credencialPropia|configuracionOperativa/iu);
  assert.deepEqual(consultasTriggers[0].parametros,
    ['instalacion-1', 7, 9, 'monitor-1', 100]);

  const servicio = new ServicioMonitoresRemotosFederacionPortal({
    servicioAutorizacion: new ServicioAutorizacion(),
    repositorio: { async listar() { return monitores; } }
  });
  const inventario = await servicio.obtener({
    nivelScope: 'empresa', tenantId: 7, empresaId: 9,
    permisos: { verMonitores: true }
  }, { installationOrigenId: 'sfid1.instalacion.GQHc7zWJ9TuCYT0ojATWoQ' });
  assert.deepEqual(inventario.resumen, {
    total: 1, activos: 1, conEstado: 1, vigentes: 1,
    conIncidencia: 0, limiteAlcanzado: false
  });
  await assert.rejects(
    servicio.obtener({ nivelScope: 'portal', permisos: { ver: true } }, {
      installationOrigenId: 'sfid1.instalacion.GQHc7zWJ9TuCYT0ojATWoQ'
    }),
    (error) => error.statusCode === 403 && error.codigo === 'monitores_remotos_no_autorizados'
  );

  const monitorFederadoId = 'sfid1.elemento_origen.C_y94EJq-D7RTPxU9RtXLA';
  const llamadasDetalle = [];
  const servicioDetalle = new ServicioMonitoresRemotosFederacionPortal({
    servicioAutorizacion: new ServicioAutorizacion(),
    repositorio: {
      async listar() {
        return [{ ...monitores[0], elementoOrigenId: monitorFederadoId }];
      },
      async listarHistorico(entrada) {
        llamadasDetalle.push(entrada);
        return historico;
      },
      async listarAlertas(entrada) {
        llamadasDetalle.push(entrada);
        return alertas;
      },
      async listarReferenciasTriggers(entrada) {
        llamadasDetalle.push(entrada);
        return referenciasTriggers;
      }
    }
  });
  const detalle = await servicioDetalle.obtener({
    nivelScope: 'empresa', tenantId: 7, empresaId: 9,
    permisos: { verMonitores: true }
  }, {
    installationOrigenId: 'sfid1.instalacion.GQHc7zWJ9TuCYT0ojATWoQ',
    monitorOrigenId: monitorFederadoId,
    vista: 'historico'
  });
  assert.equal(detalle.monitorSeleccionado.elementoOrigenId, monitorFederadoId);
  assert.equal(detalle.historico.length, 1);
  assert.equal(llamadasDetalle[0].monitorOrigenId, monitorFederadoId);
  const detalleAlertas = await servicioDetalle.obtener({
    nivelScope: 'empresa', tenantId: 7, empresaId: 9,
    permisos: { verMonitores: true }
  }, {
    installationOrigenId: 'sfid1.instalacion.GQHc7zWJ9TuCYT0ojATWoQ',
    monitorOrigenId: monitorFederadoId,
    vista: 'alertas'
  });
  assert.equal(detalleAlertas.alertas.length, 1);
  assert.deepEqual(detalleAlertas.resumenAlertas, {
    total: 1, activas: 1, vigentes: 1, cerradas: 0,
    descartadasEnOrigen: 1, limiteAlcanzado: false
  });
  assert.equal(llamadasDetalle[1].monitorOrigenId, monitorFederadoId);
  const detalleTriggers = await servicioDetalle.obtener({
    nivelScope: 'empresa', tenantId: 7, empresaId: 9,
    permisos: { verMonitores: true }
  }, {
    installationOrigenId: 'sfid1.instalacion.GQHc7zWJ9TuCYT0ojATWoQ',
    monitorOrigenId: monitorFederadoId,
    vista: 'triggers'
  });
  assert.equal(detalleTriggers.referenciasTriggers.length, 1);
  assert.deepEqual(detalleTriggers.resumenReferenciasTriggers, {
    total: 1, activas: 1, visibles: 1, opacas: 0, limiteAlcanzado: false
  });
  assert.equal(llamadasDetalle[2].monitorOrigenId, monitorFederadoId);
  await assert.rejects(
    servicioDetalle.obtener({
      nivelScope: 'empresa', tenantId: 7, empresaId: 9,
      permisos: { verMonitores: true }
    }, {
      installationOrigenId: 'sfid1.instalacion.GQHc7zWJ9TuCYT0ojATWoQ',
      monitorOrigenId: 'sfid1.elemento_origen.7UB40ag-5Ja5_HpPtFZHfg',
      vista: 'estado'
    }),
    (error) => error.statusCode === 404 && error.codigo === 'monitor_remoto_no_visible'
  );
}

async function verificarLecturaSaneadaYScope() {
  const consultas = [];
  const clienteSql = {
    async consultar(sql, parametros) {
      consultas.push({ sql, parametros });
      if (sql.includes('COUNT(*)')) return [{ total: 1 }];
      if (sql.includes('SELECT p.proyeccion_id')) {
        return [{
          proyeccion_id: 'sfid1.proyeccion.demo',
          installation_origen_id: 'sfid1.instalacion.demo',
          nombre_instalacion_origen: 'Instancia A',
          familia: 'monitores',
          elemento_origen_id: 'sfid1.elemento_origen.demo',
          scope_nivel: 'empresa', scope_tenant_id: 7, scope_empresa_id: 9,
          scope_sitio_id: null, generacion_actual_id: 'sfid1.generacion.demo',
          ultima_secuencia_evaluada: 4, estado_materializacion: 'materializada',
          completitud_interpretable: 'completa', completitud_observable: 'parcial',
          completitud_reconstruible: 'degradada', estado_vigencia: 'vigente',
          estado_soporte: 'sostenida', estado_autorizacion: 'autorizada',
          publicada_en_utc: new Date('2026-01-01T00:00:00.000Z')
        }];
      }
      return [{
        tipo_registro: 'estadoActual', estado_registro: 'presente', nombre: null,
        estado_resumen: 'ok', materializada_en_utc: new Date('2026-01-01T00:00:01.000Z'),
        causa_retirada: null, tiempo_dato_utc: new Date('2026-01-01T00:00:00.000Z'),
        vigente_hasta_utc: new Date('2026-01-01T00:01:00.000Z'),
        referencia_1: 'sfid1.elemento_origen.monitor',
        referencia_2: 'sfid1.elemento_origen.telemetria', referencia_3: null,
        secuencia_elemento: 4
      }];
    }
  };
  const repositorio = new RepositorioExploradorDatosRemotosFederacionSql(clienteSql);
  const salida = await repositorio.listar({
    scope: { nivel: 'empresa', tenantId: 7, empresaId: 9, sitioId: null },
    familias: ['monitores']
  });
  assert.equal(salida.elementos[0].dimensiones.completitudRecepcion.observable, 'parcial');
  assert.equal(salida.elementos[0].nombreInstalacionOrigen, 'Instancia A');
  assert.equal(salida.elementos[0].detalle.referencias[0].modo, 'opaca');
  assert.ok(consultas[0].sql.includes('p.scope_tenant_id=?'));
  assert.ok(consultas[0].sql.includes('p.scope_empresa_id=?'));
  assert.ok(consultas[0].sql.includes("<>'alerta'"));
  const textoSql = consultas.map((consulta) => consulta.sql).join('\n');
  assert.doesNotMatch(textoSql, /representacion_canonica|payload|credencial|actor/u);
  assert.doesNotMatch(textoSql, /cursores|recorridos|rutas_|restaur/u);
}

async function verificarComposicionWeb() {
  const [rutas, controlador, cabecera, vista, parcialOrganizacion, parcialMonitores,
    graficoMonitorRemoto, estilos, index] = await Promise.all([
    leer('apps/sentinelia-web/src/rutas/crearRutasPortal.js'),
    leer('apps/sentinelia-web/src/controladores/ControladorFederacion.js'),
    leer('apps/sentinelia-web/src/views/parciales/cabecera.ejs'),
    leer('apps/sentinelia-web/src/views/portal/federacion-datos-remotos.ejs'),
    leer('apps/sentinelia-web/src/views/portal/parciales/federacion-organizacion-remota.ejs'),
    leer('apps/sentinelia-web/src/views/portal/parciales/federacion-monitores-remotos.ejs'),
    leer('apps/sentinelia-web/src/public/js/federacion-monitor-remoto-historico.js'),
    leer('apps/sentinelia-web/src/public/css/portal.css'),
    leer('apps/sentinelia-web/src/index.js')
  ]);
  assert.match(rutas, /\/federacion\/datos-remotos/u);
  assert.match(rutas, /explorar_datos_remotos_federacion/u);
  assert.match(controlador, /Cache-Control', 'private, no-store/u);
  assert.match(controlador, /error\?\.statusCode === 400/u);
  assert.match(controlador, /FAMILIA_POR_VISTA_REMOTA/u);
  assert.match(controlador, /subvista/u);
  assert.match(cabecera, /Espacios remotos/u);
  assert.match(index, /RepositorioExploradorDatosRemotosFederacionSql/u);
  assert.match(index, /ServicioOrganizacionRemotaFederacionPortal/u);
  assert.match(index, /ServicioMonitoresRemotosFederacionPortal/u);
  assert.match(vista, /Completitud recibida/u);
  assert.match(vista, /Visibilidad actual/u);
  assert.match(vista, /Referencias opacas/u);
  assert.match(vista, /Instalaciones remotas/u);
  assert.match(vista, /Concesión visible/u);
  assert.match(vista, /espacio-remoto__selector/u);
  assert.match(vista, /Elementos federados/u);
  assert.match(vista, /aria-current="page"/u);
  assert.match(vista, /Triggers vinculados/u);
  assert.match(vista, /urlSubvista/u);
  assert.match(vista, /federacion-organizacion-remota/u);
  assert.match(parcialOrganizacion, /Jerarquía publicada/u);
  assert.match(parcialOrganizacion, /Nodos retirados de la publicación/u);
  assert.doesNotMatch(parcialOrganizacion, /representacion_canonica|payload/iu);
  assert.match(estilos, /\.espacio-remoto__menu/u);
  assert.match(estilos, /\.espacio-remoto__desplegable/u);
  assert.match(estilos, /\.arbol-organizacion-remota/u);
  assert.match(parcialMonitores, /Inventario publicado/u);
  assert.match(parcialMonitores, /data-fecha-utc/u);
  assert.match(parcialMonitores, /Estado actual del monitor remoto/u);
  assert.match(parcialMonitores, /histórico publicado/iu);
  assert.match(parcialMonitores, /data-monitor-remoto-grafica-canvas/u);
  assert.match(parcialMonitores, /data-monitor-remoto-estado-consolidado/u);
  assert.match(parcialMonitores, /Ciclos publicados/u);
  assert.match(parcialMonitores, /Resultado que la sostiene/u);
  assert.match(parcialMonitores, /Vinculaciones reconciliadas entre familias federadas/u);
  assert.match(parcialMonitores, /Abrir trigger federado/u);
  assert.match(parcialMonitores, /Identidad de la vinculación/u);
  assert.match(vista, /federacion-monitor-remoto-historico\.js/u);
  assert.match(graficoMonitorRemoto, /new window\.Chart/u);
  assert.match(graficoMonitorRemoto, /spanGaps: false/u);
  assert.match(graficoMonitorRemoto, /rangoHistorico/u);
  assert.match(graficoMonitorRemoto, /pintarBarraEstado/u);
  assert.match(graficoMonitorRemoto, /estado-consolidado-remoto__tramo/u);
  assert.doesNotMatch(graficoMonitorRemoto, /yAxisID: 'estado'/u);
  assert.doesNotMatch(parcialMonitores, /credencial|configuraci.n operativa|resultadoActual/iu);
  assert.match(estilos, /\.inventario-monitores-remotos/u);
  assert.doesNotMatch(vista, /cursor|restauraci.n|recorrido|alertas remotas/iu);
  ejs.compile(vista, { filename: ruta('apps/sentinelia-web/src/views/portal/federacion-datos-remotos.ejs') });
  ejs.compile(parcialOrganizacion, {
    filename: ruta('apps/sentinelia-web/src/views/portal/parciales/federacion-organizacion-remota.ejs')
  });
  const htmlOrganizacion = ejs.render(parcialOrganizacion, {
    organizacionRemota: {
      resumen: { tenants: 0, empresas: 0, sitios: 1, retirados: 0 },
      actuales: [{
        tipo: 'sitio', profundidad: 2, nombre: 'Centro', alias: 'centro',
        estado: 'activo', descripcion: 'Sede remota', timezone: 'Europe/Madrid',
        elementoOrigenId: 'sitio-1',
        ruta: [
          { nombre: 'Ámbito no visible', visibilidad: 'opaca' },
          { nombre: 'Centro', visibilidad: 'seleccionada' }
        ]
      }],
      retirados: []
    },
    navegacion: { subvista: 'jerarquia' },
    seccionActual: { icono: 'bi-diagram-3' },
    subsecciones: [{ id: 'jerarquia', etiqueta: 'Jerarquía' }],
    urlSubvista: (subvista) => `/remoto?subvista=${subvista}`
  });
  assert.match(htmlOrganizacion, /Centro/u);
  assert.match(htmlOrganizacion, /Ámbito no visible/u);
  const htmlMonitores = ejs.render(parcialMonitores, {
    monitoresRemotos: {
      resumen: { total: 1, activos: 1, conEstado: 1, vigentes: 1, limiteAlcanzado: false },
      monitores: [{
        tipo: 'tcp', activo: true, nombre: 'HTTP principal',
        descripcion: 'Comprueba el servicio', intervaloSegundos: 60,
        interpretacionEstado: 'normal', elementoOrigenId: 'monitor-1',
        estadoActual: {
          condicion: 'vigente', estado: 'ok',
          ultimaEjecucionUtc: '2026-08-16T10:00:00.000Z'
        }
      }]
    },
    navegacion: { subvista: 'inventario' },
    seccionActual: { icono: 'bi-broadcast' },
    subsecciones: [{ id: 'inventario', etiqueta: 'Inventario' }],
    urlSubvista: (subvista) => `/remoto?subvista=${subvista}`
  });
  assert.match(htmlMonitores, /HTTP principal/u);
  assert.match(htmlMonitores, /Estado vigente/u);
  const monitorDetalle = {
    tipo: 'tcp', activo: true, nombre: 'HTTP principal',
    descripcion: 'Comprueba el servicio', intervaloSegundos: 60,
    interpretacionEstado: 'normal', elementoOrigenId: 'monitor-1',
    contextoHumano: { descripcionFallo: null, posibleSolucion: null },
    estadoActual: {
      condicion: 'vigente', estado: 'ok', versionCatalogo: 'v1',
      ultimaEjecucionUtc: '2026-08-16T10:00:00.000Z',
      ultimoCambioUtc: '2026-08-16T09:00:00.000Z',
      vigenteHastaOrigenUtc: '2026-08-16T10:05:00.000Z',
      vigenteHastaEfectivaUtc: '2026-08-16T10:05:00.000Z',
      contextoHumano: { descripcionFallo: null, posibleSolucion: null }
    }
  };
  const datosDetalle = {
    resumen: { total: 1, activos: 1, conEstado: 1, vigentes: 1, limiteAlcanzado: false },
    monitores: [monitorDetalle], monitorSeleccionado: monitorDetalle,
    historico: [{
      tipoRegistro: 'evento', estado: 'ok', codigo: '200', mensaje: 'Disponible',
      fechaUtc: '2026-08-16T10:00:00.000Z', duracionTotalMs: 31,
      contextoHumano: { descripcionFallo: null, posibleSolucion: null }
    }],
    alertas: [{
      alertaAuditoriaId: '0198b772-7590-7000-8000-000000000001',
      estado: 'activa', condicion: 'vigente', estadoDetectado: 'fallo',
      codigo: 'tls_no_autorizado', mensaje: 'Certificado no confiable',
      validoDesdeUtc: '2026-08-16T09:55:00.000Z',
      ultimaConfirmacionUtc: '2026-08-16T10:00:00.000Z',
      ultimaEjecucionUtc: '2026-08-16T10:00:00.000Z', cerradaEnUtc: null,
      vigenteHastaOrigenUtc: '2026-08-16T10:05:00.000Z', repeticiones: 4,
      descarteOrigen: { descartada: true, motivo: 'Mantenimiento',
        descartadaEnUtc: '2026-08-16T10:01:00.000Z', descartadaHastaUtc: null },
      contextoHumano: { descripcionFallo: 'TLS rechazado', posibleSolucion: 'Revisar CA' },
      completitud: { interpretable: 'completa', observable: 'completa', reconstruible: 'completa' }
    }],
    resumenAlertas: { total: 1, activas: 1, vigentes: 1, cerradas: 0,
      descartadasEnOrigen: 1, limiteAlcanzado: false },
    referenciasTriggers: [{
      proyeccionId: 'proyeccion-referencia', elementoOrigenId: 'referencia-1',
      triggerOrigenId: 'trigger-1', visibilidad: 'visible', activo: true,
      ordenEjecucion: 2, eventosDisparo: ['fallo', 'recuperacion'],
      completitud: { interpretable: 'completa', observable: 'completa', reconstruible: 'completa' }
    }],
    resumenReferenciasTriggers: {
      total: 1, activas: 1, visibles: 1, opacas: 0, limiteAlcanzado: false
    }
  };
  const comunesDetalle = {
    monitoresRemotos: datosDetalle,
    seccionActual: { icono: 'bi-broadcast' },
    subsecciones: [
      { id: 'inventario', etiqueta: 'Inventario' },
      { id: 'estado', etiqueta: 'Estado actual' },
      { id: 'historico', etiqueta: 'Histórico' },
      { id: 'alertas', etiqueta: 'Alertas' },
      { id: 'triggers', etiqueta: 'Triggers vinculados' }
    ],
    urlSubvista: (subvista, monitor = 'monitor-1') =>
      `/remoto?subvista=${subvista}${monitor ? `&monitor=${monitor}` : ''}`
  };
  const htmlEstado = ejs.render(parcialMonitores, {
    ...comunesDetalle, navegacion: { subvista: 'estado', monitorOrigenId: 'monitor-1' }
  });
  assert.match(htmlEstado, /Vigencia efectiva/u);
  const htmlHistorico = ejs.render(parcialMonitores, {
    ...comunesDetalle, navegacion: { subvista: 'historico', monitorOrigenId: 'monitor-1' }
  });
  assert.match(htmlHistorico, /Disponible/u);
  assert.match(htmlHistorico, /31 ms/u);
  assert.match(htmlHistorico, /Gráfico histórico del monitor remoto/u);
  assert.match(htmlHistorico, /Un hueco significa que no hay continuidad demostrable/u);
  const htmlAlertas = ejs.render(parcialMonitores, {
    ...comunesDetalle, navegacion: { subvista: 'alertas', monitorOrigenId: 'monitor-1' }
  });
  assert.match(htmlAlertas, /Activa y vigente/u);
  assert.match(htmlAlertas, /Certificado no confiable/u);
  assert.match(htmlAlertas, /Mantenimiento/u);
  assert.match(htmlAlertas, /data-fecha-utc/u);
  const htmlTriggers = ejs.render(parcialMonitores, {
    ...comunesDetalle, navegacion: { subvista: 'triggers', monitorOrigenId: 'monitor-1' }
  });
  assert.match(htmlTriggers, /trigger-1/u);
  assert.match(htmlTriggers, /referencia-1/u);
  assert.match(htmlTriggers, /fallo/u);
  assert.doesNotMatch(htmlTriggers, /href=.*trigger-1/u);
}

function ruta(relativa) {
  return new URL(relativa, raiz).pathname;
}

function leer(relativa) {
  return readFile(new URL(relativa, raiz), 'utf8');
}

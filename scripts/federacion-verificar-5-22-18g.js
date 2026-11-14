import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import { ServicioAutorizacion } from '../paquetes/autorizacion/src/ServicioAutorizacion.js';
import { validarPayloadAuditoriaV1 } from '../paquetes/auditoria/src/ValidadorContratoAuditoria.js';
import { ServicioAlertasRemotasPortal } from '../apps/sentinelia-web/src/servicios/ServicioAlertasRemotasPortal.js';
import { ServicioAvisosFederadosRemotosPortal } from '../paquetes/federacion/aplicacion/ServicioAvisosFederadosRemotosPortal.js';
import { RepositorioAvisosFederadosRemotoSql } from '../paquetes/federacion/adaptadores/RepositorioAvisosFederadosRemotoSql.js';
import {
  calcularVigenciaEstadoOperativoFederado
} from '../paquetes/federacion/src/VigenciaEstadoOperativoFederado.js';

const raiz = new URL('../', import.meta.url);
const ALERTA_ID = '018f2a3b-4c5d-7e6f-8a9b-0c1d2e3f4a5b';

await verificarLecturaAutorizadaYPreferencia();
await verificarDescartePersonalAuditable();
await verificarAvisosFederadosSeparados();
await verificarPersistenciaPresentacionYTiempoReal();
verificarVigenciaConfigurada();
console.log('5.22.18g verificada: alertas remotas autorizadas, preferencia personal y descartes auditables.');

async function verificarLecturaAutorizadaYPreferencia() {
  let lecturas = 0;
  const filtrosLectura = [];
  const difusiones = [];
  const repositorio = {
    async listar(filtros) {
      lecturas += 1;
      filtrosLectura.push(filtros);
      return [{
        proyeccionId: 'proyeccion-1', alertaAuditoriaId: ALERTA_ID,
        estadoPresentacion: 'activaEnOrigen', monitorNombre: 'TCP remoto',
        scope: { nivel: 'empresa', tenantId: '2', empresaId: '3', sitioId: null },
        frescura: { vigenteHastaOrigenUtc: '2035-01-02T00:00:00.000Z' },
        descarteLocal: { vigente: false },
        payload: { mensajeUltimoResultado: 'No responde', tokenApi: 'secreto' }
      }, {
        proyeccionId: 'proyeccion-cerrada', alertaAuditoriaId: ALERTA_ID,
        estadoPresentacion: 'cerradaEnOrigen', monitorNombre: 'TCP remoto',
        scope: { nivel: 'empresa', tenantId: '2', empresaId: '3', sitioId: null },
        frescura: { vigenteHastaOrigenUtc: '2035-01-01T12:00:00.000Z' },
        descarteLocal: { vigente: false },
        payload: { estadoAlerta: 'cerrada' }
      }, {
        proyeccionId: 'proyeccion-descartada', alertaAuditoriaId: ALERTA_ID,
        estadoPresentacion: 'activaEnOrigen', monitorNombre: 'HTTPS remoto',
        scope: { nivel: 'empresa', tenantId: '2', empresaId: '3', sitioId: null },
        frescura: { vigenteHastaOrigenUtc: '2035-01-03T00:00:00.000Z' },
        descarteLocal: { vigente: true, motivo: 'Mantenimiento' },
        payload: { estadoAlerta: 'activa' }
      }, {
        proyeccionId: 'proyeccion-sin-vigencia', alertaAuditoriaId: ALERTA_ID,
        estadoPresentacion: 'vigenciaAgotada', monitorNombre: 'ICMP remoto',
        scope: { nivel: 'empresa', tenantId: '2', empresaId: '3', sitioId: null },
        frescura: { vigenteHastaOrigenUtc: '2034-12-31T23:59:00.000Z' },
        descarteLocal: { vigente: false },
        payload: { estadoAlerta: 'activa' }
      }];
    }
  };
  const servicio = crearServicio({ repositorio, difusiones });
  const contexto = contextoPermitido();
  const fueraDashboard = await servicio.consultar(contexto, { exigirPreferencia: true });
  assert.equal(fueraDashboard.permiso, true);
  assert.equal(fueraDashboard.preferencia, false);
  assert.equal(fueraDashboard.totalActuales, 0);
  assert.equal(lecturas, 0, 'la preferencia apagada no debe consultar ni contar alertas para el dashboard');
  const consultaExplicita = await servicio.consultar(contexto);
  assert.equal(consultaExplicita.totalVisibles, 1);
  assert.equal(consultaExplicita.totalActuales, 2);
  assert.equal(consultaExplicita.totalDescartadas, 1);
  assert.equal(consultaExplicita.totalSinVigencia, 1);
  assert.equal(consultaExplicita.alertasSinVigencia.length, 1);
  assert.equal(consultaExplicita.alertasDescartadas.length, 1);
  assert.equal(consultaExplicita.alertasDescartadas[0].descarteLocal.motivo, 'Mantenimiento');
  assert.equal('alertasCerradas' in consultaExplicita, false);
  assert.equal(consultaExplicita.puedeGestionarDescartes, true);
  assert.equal(lecturas, 1);
  assert.equal('tokenApi' in consultaExplicita.alertasVisibles[0].payload, false);
  assert.equal(difusiones.includes('vencimiento'), true,
    'la vigencia operativa debe invalidar la presentacion aunque SQL no cambie');
  const consultaHistorica = await servicio.consultar(contexto, {
    installationOrigenId: 'sfid1.instalacion.GQHc7zWJ9TuCYT0ojATWoQ',
    incluirCerradas: true
  });
  assert.equal(consultaHistorica.totalCerradas, 1);
  assert.equal(consultaHistorica.alertasCerradas.length, 1);
  assert.equal(filtrosLectura[1].incluirCerradas, true);
  assert.equal(filtrosLectura[1].installationOrigenId,
    'sfid1.instalacion.GQHc7zWJ9TuCYT0ojATWoQ');
  const consultaImpersonada = await servicio.consultar({
    ...contexto,
    impersonacionActiva: true
  });
  assert.equal(consultaImpersonada.totalVisibles, 1);
  assert.equal(consultaImpersonada.puedeGestionarDescartes, false);
  const lecturasAntesDenegacion = lecturas;
  await assert.rejects(
    servicio.consultar({ ...contexto, permisos: {} }),
    (error) => error.codigo === 'PERMISO_DENEGADO'
  );
  assert.equal(lecturas, lecturasAntesDenegacion,
    'la denegacion debe ocurrir antes de acceder al repositorio');
}

async function verificarAvisosFederadosSeparados() {
  const installationOrigenId =
    'sfid1.instalacion.GQHc7zWJ9TuCYT0ojATWoQ';
  const filtros = [];
  const comun = {
    proyeccionId: 'sfid1.proyeccion.c-pgRCIp71erKGpUnK_mPQ',
    installationOrigenId,
    elementoOrigenId: 'sfid1.elemento_origen.lz1gRCajAGpIendmeMZekw',
    scopeRecepcion: {
      nivel: 'empresa', tenantId: '2', empresaId: '3', sitioId: null
    },
    completitud: {
      interpretable: 'completa', observable: 'completa', reconstruible: 'completa'
    },
    estadoProyeccion: {
      vigencia: 'vigente', soporte: 'disponible', autorizacion: 'autorizada'
    }
  };
  const estado = {
    ...comun,
    payload: {
      perfil: 'sentinelia-federacion-avisos-v1', version: 1,
      tipoRegistro: 'estadoActual', avisoOrigenId: ALERTA_ID,
      installationAfectadaId: installationOrigenId, versionCatalogo: 1,
      tipoCodigo: 'comunicacion', causaCodigo: 'relacion_silenciosa',
      estadoCiclo: 'pendiente', gravedad: 'advertencia',
      objetoAfectado: { tipo: 'instalacion_federada', id: 'remota-1' },
      relacionOrigenId: null, flujoOrigenId: null, cicloAnteriorOrigenId: null,
      primeraDeteccionUtc: '2035-01-01T00:00:00.000Z',
      ultimaDeteccionUtc: '2035-01-01T00:01:00.000Z',
      resueltoEnUtc: null, obsoletoEnUtc: null, contadorDetecciones: '2',
      contextoHumano: { detalle: 'Sin comunicación', tokenApi: 'secreto' },
      resumen: { comprobaciones: 2 },
      actorUltimaTransicion: { estado: 'visible',
        elementoOrigenId: 'sfid1.elemento_origen.qMdJ91FAH7XZiJ9nHWqsqg',
        tipo: 'usuario', nombreVisible: 'Operador remoto' }
    }
  };
  const transicion = {
    ...comun,
    payload: {
      perfil: 'sentinelia-federacion-avisos-v1', version: 1,
      tipoRegistro: 'transicion', avisoOrigenId: ALERTA_ID, ordinal: 1,
      transicionTipo: 'apertura', estadoAnterior: null, estadoNuevo: 'pendiente',
      gravedadAnterior: null, gravedadNueva: 'advertencia',
      contadorDetecciones: '1', efectivoEnUtc: '2035-01-01T00:00:00.000Z',
      registradoEnUtc: '2035-01-01T00:00:01.000Z',
      eventoAuditoriaOrigenId: '018f2a3b-4c5d-7e6f-8a9b-0c1d2e3f4a5c',
      correlacionOrigenId: '018f2a3b-4c5d-7e6f-8a9b-0c1d2e3f4a5d',
      detalle: { causa: 'timeout' }, contextoHumano: { detalle: 'Sin comunicación' },
      resumen: { comprobaciones: 1 }, actor: { estado: 'omitida' }
    }
  };
  const servicio = new ServicioAvisosFederadosRemotosPortal({
    servicioAutorizacion: new ServicioAutorizacion(),
    repositorio: {
      async listarEstados(entrada) { filtros.push(entrada); return [estado]; },
      async listarTransiciones(entrada) { filtros.push(entrada); return [transicion]; }
    }
  });
  const contexto = {
    nivelScope: 'empresa', tenantId: 2, empresaId: 3, sitioId: null,
    permisos: { verDiagnosticoFederacion: true }
  };
  const actuales = await servicio.obtener(contexto, {
    installationOrigenId, vista: 'actuales'
  });
  assert.equal(actuales.resumen.pendientes, 1);
  assert.equal(actuales.estados[0].actor.estado, 'opaca');
  assert.equal('tokenApi' in actuales.estados[0].contextoHumano, false);
  assert.deepEqual(filtros[0].scope, {
    nivel: 'empresa', tenantId: 2, empresaId: 3, sitioId: null
  });
  const actividad = await servicio.obtener(contexto, {
    installationOrigenId, vista: 'actividad'
  });
  assert.equal(actividad.transiciones[0].tipo, 'apertura');
  const consultasSql = [];
  const repositorioSql = new RepositorioAvisosFederadosRemotoSql({
    async obtenerConexion() {},
    async consultar(sql, parametros) {
      consultasSql.push({ sql, parametros });
      return [];
    }
  });
  await repositorioSql.listarEstados({
    installationOrigenId,
    scope: { nivel: 'empresa', tenantId: 2, empresaId: 3, sitioId: null },
    limite: 10
  });
  assert.match(consultasSql[0].sql, /p\.scope_tenant_id=\?/u);
  assert.match(consultasSql[0].sql, /p\.scope_empresa_id=\?/u);
  assert.match(consultasSql[0].sql, /estado_autorizacion='autorizada'/u);
  assert.deepEqual(consultasSql[0].parametros, [
    installationOrigenId, 2, 3, 'estadoActual'
  ]);
  await assert.rejects(
    servicio.obtener({ ...contexto, permisos: {} }, {
      installationOrigenId, vista: 'actuales'
    }),
    (error) => error.codigo === 'avisos_federados_no_autorizados'
  );
}

async function verificarDescartePersonalAuditable() {
  const cambios = [];
  const auditorias = [];
  const repositorio = {
    async obtenerVisibleParaActualizar() {
      return {
        scope_tenant_id: null, scope_empresa_id: null, scope_sitio_id: null,
        representacion_canonica: JSON.stringify({ estadoAlerta: 'activa' })
      };
    },
    async guardarDescarte(entrada) { cambios.push(['descartar', entrada]); },
    async revertirDescarte(entrada) { cambios.push(['revertir', entrada]); return true; }
  };
  const difusiones = [];
  const servicio = crearServicio({ repositorio, auditorias, difusiones });
  const contexto = contextoPermitido();
  const descarte = await servicio.descartar(contexto, {
    proyeccionId: 'proyeccion-1', alertaAuditoriaId: ALERTA_ID,
    motivo: 'Fuera de mi foco', hastaUtc: '2035-01-02T00:00:00.000Z'
  });
  assert.equal(descarte.estado, 'descartada');
  assert.equal(cambios[0][1].usuarioId, 7);
  assert.equal(auditorias[0].tipo, 'alerta.descarte_aplicado');
  assert.equal(auditorias[0].claveCadena, 'alertas:portal');
  assert.doesNotThrow(() => validarPayloadAuditoriaV1({
    tipo: auditorias[0].tipo, perfil: 'descarte_alerta_v1',
    actor: 'usuario', origen: 'web', payload: auditorias[0].payload
  }));
  assert.equal(difusiones.includes('actualizada'), true);
  assert.equal(difusiones.includes('vencimiento'), true);
  await servicio.revertir(contexto, {
    proyeccionId: 'proyeccion-1', alertaAuditoriaId: ALERTA_ID
  });
  assert.equal(auditorias[1].tipo, 'alerta.descarte_revertido');
  await assert.rejects(
    servicio.descartar({ ...contexto, impersonacionActiva: true }, {
      proyeccionId: 'proyeccion-1', alertaAuditoriaId: ALERTA_ID, motivo: 'No'
    }),
    (error) => error.codigo === 'MUTACION_IMPERSONADA'
  );
  assert.doesNotThrow(() => validarPayloadAuditoriaV1({
    tipo: 'usuario.perfil_cambiado', perfil: 'cambio_v1', actor: 'usuario', origen: 'web',
    payload: {
      resultado: 'actualizado',
      camposCambiados: ['preferenciaMostrarAlertasRemotas'],
      antes: { preferenciaMostrarAlertasRemotas: false },
      despues: { preferenciaMostrarAlertasRemotas: true }
    }
  }));
}

async function verificarPersistenciaPresentacionYTiempoReal() {
  const [repositorio, rutas, perfil, panel, panelJs, portalJs,
    difusor, observador, manifiesto, vistaRemota, controladorFederacion,
    parcialAvisos, repositorioAvisos, servicioAvisos, indice,
    parcialAlertas, alertasJs] = await Promise.all([
    leer('paquetes/federacion/adaptadores/RepositorioAlertasRemotasPortalSql.js'),
    leer('apps/sentinelia-web/src/rutas/crearRutasPortal.js'),
    leer('apps/sentinelia-web/src/views/portal/mi-perfil.ejs'),
    leer('apps/sentinelia-web/src/views/panel.ejs'),
    leer('apps/sentinelia-web/src/public/js/panel-dashboard.js'),
    leer('apps/sentinelia-web/src/public/js/portal.js'),
    leer('apps/sentinelia-web/src/realtime/DifusorWebSocketPortal.js'),
    leer('apps/sentinelia-web/src/realtime/ObservadorAlertasRemotasSql.js'),
    leer('paquetes/auditoria/src/ManifiestoCoberturaAuditoria.js'),
    leer('apps/sentinelia-web/src/views/portal/federacion-datos-remotos.ejs'),
    leer('apps/sentinelia-web/src/controladores/ControladorFederacion.js'),
    leer('apps/sentinelia-web/src/views/portal/parciales/federacion-avisos-remotos.ejs'),
    leer('paquetes/federacion/adaptadores/RepositorioAvisosFederadosRemotoSql.js'),
    leer('paquetes/federacion/aplicacion/ServicioAvisosFederadosRemotosPortal.js'),
    leer('apps/sentinelia-web/src/index.js'),
    leer('apps/sentinelia-web/src/views/portal/parciales/federacion-alertas-remotas.ejs'),
    leer('apps/sentinelia-web/src/public/js/federacion-alertas-remotas.js')
  ]);
  assert.match(repositorio, /scope_tenant_id=\?/u);
  assert.match(repositorio, /scope_empresa_id=\?/u);
  assert.match(repositorio, /scope_sitio_id=\?/u);
  assert.match(repositorio, /validarPayloadMonitoresFederacion/u);
  assert.match(repositorio, /cerradaEnOrigen/u);
  assert.match(repositorio, /vigenciaAgotada/u);
  assert.match(repositorio, /SUM\(a\.version_publicacion\)/u);
  assert.match(repositorio, /SUM\(v\.version_estado\)/u);
  assert.match(repositorio, /CRC32\(HEX\(evento_ultima_transicion_id\)\)/u);
  assert.match(repositorio, /\$\.estadoAlerta/u);
  assert.match(repositorio, /='activa'/u);
  assert.match(repositorio, /GROUP BY p\.proyeccion_id,a\.generacion_actual_id,r0\.alerta_auditoria_id/u);
  assert.match(repositorio, /p\.installation_origen_id=\?/u);
  assert.match(repositorio, /v\.estado_autorizacion='autorizada'/u);
  assert.match(repositorio, /NOT EXISTS/u);
  assert.match(rutas, /ver_alertas_remotas/u);
  assert.match(rutas, /alertas-remotas\/:proyeccionId\/:alertaAuditoriaId\/descartar/u);
  assert.match(perfil, /preferencia_mostrar_alertas_remotas/u);
  assert.match(panel, /data-dashboard-alertas-remotas/u);
  assert.match(panel, /data-dashboard-descarte-tipo/u);
  assert.match(panel, /data-dashboard-descarte-proyeccion-id/u);
  assert.match(panel, /data-dashboard-descarte-alerta-id/u);
  assert.match(panel, /Se evalúan en su instalación de origen/u);
  assert.match(panel, /Alertas remotas con información caducada/u);
  assert.match(panel, /hace demasiado tiempo que no confirma estas alertas/u);
  const seccionRemota = panel.slice(panel.indexOf('<span>Alertas remotas</span>'));
  assert.doesNotMatch(
    seccionRemota.slice(0, seccionRemota.indexOf('<!-- Accesos rápidos')),
    /monitor local de origen federado/iu
  );
  assert.match(panelJs, /alertas_remotas_actualizadas/u);
  assert.match(panel, /alertasRemotasDashboard\.puedeGestionarDescartes/u);
  assert.match(panel, /urlMonitorRemotoDashboard/u);
  assert.match(panel, /subvista=estado&monitor=/u);
  assert.match(panel, /Acciones de la alerta remota/u);
  assert.match(panelJs, /construirUrlMonitorRemotoDashboard/u);
  assert.match(panelJs, /monitorOrigenId/u);
  assert.match(panelJs, /<span>Ver monitor<\/span>/u);
  assert.match(panelJs, /<span>Inhibir…<\/span>/u);
  assert.match(vistaRemota, /vista: 'alertas', familia: 'monitores'/u);
  assert.match(vistaRemota, /vista: 'avisos', familia: 'avisosFederados'/u);
  assert.match(vistaRemota, /Avisos remotos/u);
  assert.match(vistaRemota, /no ejecutan lógica local ni permiten cerrar/u);
  assert.match(vistaRemota, /No son avisos locales/u);
  assert.match(controladorFederacion, /alertas: 'monitores'/u);
  assert.match(controladorFederacion, /avisos: 'avisosFederados'/u);
  assert.match(controladorFederacion, /servicioAvisosFederadosRemotos\.obtener/u);
  assert.match(controladorFederacion, /servicioAlertasRemotasPortal\.consultar/u);
  assert.match(controladorFederacion, /incluirCerradas: true/u);
  assert.match(parcialAvisos, /no pueden reconocerse, ocultarse ni resolverse/u);
  assert.match(vistaRemota, /id: 'actuales', etiqueta: 'Estado actual'/u);
  assert.match(vistaRemota, /id: 'actividad', etiqueta: 'Actividad'/u);
  assert.match(vistaRemota, /id: 'historico', etiqueta: 'Histórico'/u);
  assert.match(repositorioAvisos, /scope_tenant_id=\?/u);
  assert.match(repositorioAvisos, /scope_empresa_id=\?/u);
  assert.match(repositorioAvisos, /scope_sitio_id=\?/u);
  assert.match(repositorioAvisos, /estado_autorizacion='autorizada'/u);
  assert.match(servicioAvisos, /validarPayloadAvisosFederados/u);
  assert.match(servicioAvisos, /puedeVerDiagnosticoFederacion/u);
  assert.match(indice, /new ServicioAvisosFederadosRemotosPortal/u);
  assert.match(indice, /servicioAlertasRemotasPortal,/u);
  assert.match(vistaRemota, /federacion-alertas-remotas/u);
  assert.match(vistaRemota, /federacion-alertas-remotas\.js/u);
  assert.match(parcialAlertas, /preferencia personal que decide si también aparecen en el dashboard/u);
  assert.match(parcialAlertas, /Cerrada en origen/u);
  assert.match(parcialAlertas, /Ver monitor/u);
  assert.match(parcialAlertas, /Descartar para mí/u);
  assert.match(parcialAlertas, /Contexto humano de origen/u);
  assert.match(parcialAlertas, /descarteOrigen/u);
  assert.match(alertasJs, /\/panel\/api\/alertas-remotas/u);
  assert.match(alertasJs, /location\.reload/u);
  assert.match(panelJs, /datos\.puedeGestionarDescartes === true/u);
  assert.match(panelJs, /datos\.alertasSinVigencia/u);
  assert.doesNotMatch(panelJs, /window\.prompt/u);
  assert.match(panelJs, /abrirModalDescarteAlertaRemota/u);
  assert.match(panelJs, /normalizarHastaUtcFormulario/u);
  assert.match(panelJs, /Alerta remota inhibida/u);
  assert.doesNotMatch(panelJs, /alertasCerradas|descartadas o cerradas/u);
  assert.doesNotMatch(panel, /alertasCerradas|descartadas o cerradas/u);
  assert.match(portalJs, /la vigencia de la última observación terminó/u);
  assert.doesNotMatch(portalJs, /estado que había publicado/u);
  assert.match(difusor, /tipo: 'alertas_remotas_actualizadas'/u);
  assert.match(observador, /obtenerFirmaGlobal/u);
  assert.match(manifiesto, /preferencia-alertas-remotas/u);
  assert.match(manifiesto, /alertas-remotas\/:proyeccionId\/:alertaAuditoriaId/u);
}

function verificarVigenciaConfigurada() {
  const fila = { ultima_ejecucion_utc: '2035-01-01T00:00:00.000Z' };
  assert.equal(
    calcularVigenciaEstadoOperativoFederado({
      fila,
      ttlMaximoMs: 15 * 60 * 1000
    }),
    '2035-01-01T00:15:00.000Z',
    'un monitor frecuente conserva íntegramente el TTL elegido por el operador'
  );
  assert.equal(
    calcularVigenciaEstadoOperativoFederado({
      fila,
      ttlMaximoMs: 11 * 60 * 1000
    }),
    '2035-01-01T00:11:00.000Z',
    'la política global fija exactamente la duración declarada'
  );
  assert.equal(
    calcularVigenciaEstadoOperativoFederado({
      fila: { fechaOcurrenciaUtc: '2035-01-01T00:00:00.000Z' },
      ttlMaximoMs: 15 * 60 * 1000
    }),
    '2035-01-01T00:15:00.000Z',
    'los cierres de alerta conservan su tiempo causal sin recurrir al reloj local'
  );
  assert.throws(
    () => calcularVigenciaEstadoOperativoFederado({
      fila: {}, ttlMaximoMs: 15 * 60 * 1000
    }),
    /observacion temporal de origen valida/u,
    'un replay sin tiempo de origen no puede fabricar vigencia nueva'
  );
}

function crearServicio({ repositorio, auditorias = [], difusiones = [] }) {
  return new ServicioAlertasRemotasPortal({
    repositorio,
    servicioAutorizacion: new ServicioAutorizacion(),
    fronteraTransaccional: { ejecutar: (operacion) => operacion({ execute() {} }) },
    servicioAuditoria: {
      async registrarEnTransaccion({ intencion }) { auditorias.push(intencion); }
    },
    difusorWebSocketPortal: {
      emitirAlertasRemotasActualizadas() { difusiones.push('actualizada'); },
      programarVencimientoAlertaRemota() { difusiones.push('vencimiento'); }
    },
    ahora: () => new Date('2035-01-01T00:00:00.000Z')
  });
}

function contextoPermitido() {
  return {
    idUsuario: 7, idUsuarioReal: 7, nivelScope: 'empresa',
    tenantId: 2, empresaId: 3, sitioId: null,
    impersonacionActiva: false, preferenciaMostrarAlertasRemotas: false,
    permisos: { verAlertasRemotas: true }
  };
}

function leer(relativa) {
  return readFile(new URL(relativa, raiz), 'utf8');
}

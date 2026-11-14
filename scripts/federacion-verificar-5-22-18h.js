import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import { FuenteEntropiaCriptograficaNode } from '../paquetes/federacion/adaptadores/FuenteEntropiaCriptograficaNode.js';
import { ServicioExploradorDatosRemotosFederacion } from '../paquetes/federacion/aplicacion/ServicioExploradorDatosRemotosFederacion.js';
import { GeneradorIdentidadesFederadas, TIPOS_IDENTIDAD_FEDERADA } from '../paquetes/federacion/src/IdentidadFederada.js';
import { ServicioCausalidadAlertasLocalesFederadas } from '../apps/sentinelia-web/src/servicios/ServicioCausalidadAlertasLocalesFederadas.js';

const raiz = new URL('../', import.meta.url);
const generador = new GeneradorIdentidadesFederadas({
  fuenteEntropia: new FuenteEntropiaCriptograficaNode()
});

await verificarCausalidadDurableYOpaca();
await verificarNavegacionExactaAutorizada();
await verificarPresentacionEIntegracion();
console.log('5.22.18h verificada: alerta local, causalidad federada durable y navegación sin ampliar scope.');

async function verificarCausalidadDurableYOpaca() {
  const proyeccionCausal = id(TIPOS_IDENTIDAD_FEDERADA.PROYECCION);
  const proyeccionActual = id(TIPOS_IDENTIDAD_FEDERADA.PROYECCION);
  const instalacion = id(TIPOS_IDENTIDAD_FEDERADA.INSTALACION);
  const elemento = id(TIPOS_IDENTIDAD_FEDERADA.ELEMENTO_ORIGEN);
  const repositorio = {
    async listarPorMonitorIds() {
      return [{ monitorId: 8, entradaId: 10, revisionConfiguracion: 3,
        variable: 'B', proyeccionId: proyeccionActual, installationOrigenId: instalacion,
        elementoOrigenId: elemento }];
    },
    async listarHistorialPorReferencias(referencias) {
      assert.deepEqual(referencias.map(({ entradaId, revisionConfiguracion }) =>
        [entradaId, revisionConfiguracion]), [[9, 2]]);
      return [{ monitorId: 8, entradaId: 9, revisionConfiguracion: 2,
        variable: 'A', proyeccionId: proyeccionCausal, installationOrigenId: instalacion,
        elementoOrigenId: elemento }];
    },
    async listarProyeccionesPublicadasVisibles(_contexto, ids) {
      assert.equal(ids.includes(proyeccionCausal), true);
      return [proyeccionCausal];
    }
  };
  const autorizacion = {
    puedeVerMonitores: () => true,
    puedeExplorarDatosRemotosFederacion: () => true
  };
  const servicio = new ServicioCausalidadAlertasLocalesFederadas({
    repositorioEntradasFederadas: repositorio,
    servicioAutorizacion: autorizacion
  });
  const alerta = alertaLocal({ proyeccionCausal });
  const [enriquecida] = await servicio.enriquecer(contextoSinAlertasRemotas(), [alerta]);
  assert.equal(enriquecida.causalidadFederada.naturalezaAlerta, 'local');
  assert.equal(enriquecida.causalidadFederada.fuenteCausal, 'evidenciaTransicion');
  assert.equal(enriquecida.causalidadFederada.entradas[0].variable, 'A');
  assert.equal(enriquecida.causalidadFederada.entradas[0].proyeccionId, proyeccionCausal);
  assert.notEqual(enriquecida.causalidadFederada.entradas[0].proyeccionId, proyeccionActual,
    'un cambio posterior de configuración no debe reescribir la causa de la alerta');
  assert.equal('_evidenciaCausalFederada' in enriquecida, false);

  autorizacion.puedeExplorarDatosRemotosFederacion = () => false;
  const [opaca] = await servicio.enriquecer(contextoSinAlertasRemotas(), [alerta]);
  assert.equal(opaca.causalidadFederada.entradas[0].visibilidad, 'referenciaNoVisible');
  assert.equal('proyeccionId' in opaca.causalidadFederada.entradas[0], false);
  assert.equal(opaca.causalidadFederada.contieneEntradasFederadas, true,
    'la opacidad remota no puede reclasificar ni ocultar la alerta local');
}

async function verificarNavegacionExactaAutorizada() {
  const proyeccionId = id(TIPOS_IDENTIDAD_FEDERADA.PROYECCION);
  let consulta = null;
  const servicio = new ServicioExploradorDatosRemotosFederacion({
    repositorio: {
      async listar(entrada) {
        consulta = entrada;
        return { elementos: [], paginacion: { pagina: 1, limite: 25, total: 0, paginas: 1 } };
      }
    },
    servicioAutorizacion: autorizacionExplorador()
  });
  const resultado = await servicio.obtener(contextoExplorador(), {
    familia: 'monitores', proyeccionId
  });
  assert.equal(consulta.proyeccionId, proyeccionId);
  assert.equal(resultado.filtros.proyeccionId, proyeccionId);
  await assert.rejects(
    servicio.obtener(contextoExplorador(), { familia: 'monitores', proyeccionId: 'invalida' }),
    (error) => error.statusCode === 400
  );
}

async function verificarPresentacionEIntegracion() {
  const [servicio, repositorio, dashboard, panel, panelJs, explorador,
    controlador, index] = await Promise.all([
    leer('apps/sentinelia-web/src/servicios/ServicioCausalidadAlertasLocalesFederadas.js'),
    leer('paquetes/monitores/src/RepositorioEntradasFederadasMonitoresLogicosSql.js'),
    leer('apps/sentinelia-web/src/servicios/ServicioDashboard.js'),
    leer('apps/sentinelia-web/src/views/panel.ejs'),
    leer('apps/sentinelia-web/src/public/js/panel-dashboard.js'),
    leer('paquetes/federacion/adaptadores/RepositorioExploradorDatosRemotosFederacionSql.js'),
    leer('apps/sentinelia-web/src/controladores/ControladorFederacion.js'),
    leer('apps/sentinelia-web/src/index.js')
  ]);
  assert.doesNotMatch(servicio, /verAlertasRemotas|preferenciaMostrarAlertasRemotas/u);
  assert.match(servicio, /naturalezaAlerta: 'local'/u);
  assert.match(servicio, /evidenciaTransicion/u);
  assert.match(servicio, /referenciaNoVisible/u);
  assert.match(repositorio, /historial_configuracion_entradas_federadas_logicas/u);
  assert.match(repositorio, /estado_publicacion='actual'/u);
  assert.match(dashboard, /_evidenciaCausalFederada/u);
  assert.match(panel, /Datos de otra instalación/u);
  assert.match(panel, /origen no disponible con tu alcance actual/u);
  assert.match(panelJs, /renderizarCausalidadFederada/u);
  assert.match(explorador, /p\.proyeccion_id=\?/u);
  assert.match(controlador, /proyeccionId: requisicion\.query\.proyeccion/u);
  assert.match(index, /ServicioCausalidadAlertasLocalesFederadas/u);
}

function alertaLocal({ proyeccionCausal }) {
  return {
    monitorId: 8, monitorNombre: 'Lógico local', tipoMonitor: 'booleano',
    _evidenciaCausalFederada: {
      causalidad: { version: 1, transicionMonitorId: 'monitor-federado:abc',
        causas: [{ entradaId: 9, revisionConfiguracion: 2,
          proyeccionId: proyeccionCausal }] },
      entradas: [{ entradaId: 9, variable: 'A' }]
    }
  };
}

function contextoSinAlertasRemotas() {
  return { nivelScope: 'empresa', tenantId: 1, empresaId: 2, sitioId: null,
    preferenciaMostrarAlertasRemotas: false,
    permisos: { verMonitores: true, explorarDatosRemotosFederacion: true,
      verAlertasRemotas: false } };
}

function contextoExplorador() {
  return { nivelScope: 'portal', permisos: {} };
}

function autorizacionExplorador() {
  return {
    puedeExplorarDatosRemotosFederacion: () => true,
    puedeVer: () => true,
    puedeVerAgentes: () => true,
    puedeVerMonitores: () => true,
    puedeVerTriggers: () => true,
    puedeVerAuditoria: () => true,
    puedeVerDiagnosticoFederacion: () => true
  };
}

function id(tipo) {
  return String(generador.generar(tipo));
}

function leer(relativa) {
  return readFile(new URL(relativa, raiz), 'utf8');
}

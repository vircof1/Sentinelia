import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

import { FuenteEntropiaCriptograficaNode }
  from '../paquetes/federacion/adaptadores/FuenteEntropiaCriptograficaNode.js';
import { RepositorioReconciliacionFlujosFederacionSql }
  from '../paquetes/federacion/adaptadores/RepositorioReconciliacionFlujosFederacionSql.js';
import { ServicioReconciliacionFlujosFederacion }
  from '../paquetes/federacion/aplicacion/ServicioReconciliacionFlujosFederacion.js';
import {
  GeneradorIdentidadesFederadas,
  TIPOS_IDENTIDAD_FEDERADA
} from '../paquetes/federacion/src/IdentidadFederada.js';

const generador = new GeneradorIdentidadesFederadas({
  fuenteEntropia: new FuenteEntropiaCriptograficaNode()
});
const id = (tipo) => String(generador.generar(tipo));

async function verificarReconciliacion() {
  const ids = {
    localA: id(TIPOS_IDENTIDAD_FEDERADA.INSTALACION),
    localB: id(TIPOS_IDENTIDAD_FEDERADA.INSTALACION),
    bootA: id(TIPOS_IDENTIDAD_FEDERADA.ARRANQUE),
    bootB: id(TIPOS_IDENTIDAD_FEDERADA.ARRANQUE),
    relacion: id(TIPOS_IDENTIDAD_FEDERADA.RELACION),
    efectivaA: id(TIPOS_IDENTIDAD_FEDERADA.REVISION_CONCESION),
    oferta: id(TIPOS_IDENTIDAD_FEDERADA.REVISION_CONCESION),
    aceptacion: id(TIPOS_IDENTIDAD_FEDERADA.REVISION_CONCESION)
  };
  ids.efectivaB = ids.efectivaA;
  const base = {
    relacionId: ids.relacion,
    contexto: { nivel: 'empresa', tenantId: '7', empresaId: '9', sitioId: null },
    ofertaId: ids.oferta,
    aceptacionId: ids.aceptacion,
    seleccion: {
      activa: true,
      vacia: false,
      nivelesScope: ['empresa'],
      familias: { monitores: { campos: ['monitores'],
        permiteContenidoSensible: false, permiteRefederacion: true } }
    }
  };
  const repoA = new RepositorioMemoria({ ...base, direccion: 'emision',
    installationRemotaId: ids.localB, revisionEfectivaId: ids.efectivaA });
  const repoB = new RepositorioMemoria({ ...base,
    contexto: { nivel: 'empresa', tenantId: '70', empresaId: '90', sitioId: null },
    direccion: 'recepcion',
    installationRemotaId: ids.localA, revisionEfectivaId: ids.efectivaB });
  const flujosA = new FlujosMemoria();
  const flujosB = new FlujosMemoria();
  const corteA = new CorteMemoria(flujosA, '3');
  const corteB = new CorteMemoria(flujosB, '999');
  const servicioA = servicio({ repositorio: repoA, flujos: flujosA, corte: corteA,
    installationLocalId: ids.localA, bootLocalId: ids.bootA });
  const servicioB = servicio({ repositorio: repoB, flujos: flujosB, corte: corteB,
    installationLocalId: ids.localB, bootLocalId: ids.bootB,
    sesiones: { validarBearer: async () => ({ relacionId: ids.relacion,
      installationLocalId: ids.localB, installationRemotaId: ids.localA,
      bootRemotoId: ids.bootA }) } });

  const emision = await servicioA.reconciliarDesdeConcesionEfectiva({
    relacionId: ids.relacion, revisionEfectivaId: ids.efectivaA
  });
  const recepcion = await servicioB.reconciliarDesdeConcesionEfectiva({
    relacionId: ids.relacion, revisionEfectivaId: ids.efectivaB
  });
  assert.equal(emision.flujos.length, 1);
  assert.equal(recepcion.flujos.length, 1);
  assert.equal(emision.flujos[0].flujoId, recepcion.flujos[0].flujoId);
  assert.equal(emision.flujos[0].generacionId, recepcion.flujos[0].generacionId);
  assert.equal(flujosA.creaciones, 1);
  assert.equal(flujosB.creaciones, 0, 'B no puede fotografiar sus datos locales.');
  assert.equal(corteB.cierres, 0);

  const manifiesto = emision.flujos[0].manifiesto;
  const instalada = await servicioB.recibirManifiesto({ token: 'vivo', manifiesto });
  assert.equal(instalada.estado, 'reconciliada');
  assert.equal(instalada.fronteraInicial, '3');
  assert.equal(flujosB.creaciones, 1);
  assert.equal(flujosB.actual.generacion.fronteraInicial, '3');
  assert.equal(flujosB.actual.generacion.propietario.bootId, ids.bootA);
  await servicioB.recibirManifiesto({ token: 'vivo', manifiesto });
  assert.equal(flujosB.creaciones, 1, 'El replay no duplica el agregado receptor.');
  assert.equal((await flujosA.obtener()).generacion.estado, 'preparada');
  await servicioA.confirmarManifiestoPublicado({ manifiesto });
  assert.equal((await flujosA.obtener()).generacion.estado, 'transfiriendo');
  await servicioA.confirmarManifiestoPublicado({ manifiesto });
  assert.equal(flujosA.avances, 1, 'El replay no debe reabrir la generacion publicada.');
  await assert.rejects(
    servicioB.recibirManifiesto({ token: 'vivo', manifiesto: {
      ...manifiesto, fronteraInicial: '4'
    } }),
    (error) => ['FRONTERA_INICIAL_DIVERGENTE',
      'FLUJO_INICIAL_EXISTENTE_DIVERGENTE'].includes(error.codigo)
  );
}

async function verificarCortesVaciosTodasLasFamilias() {
  const familias = [
    'estructuraOrganizativa',
    'monitores',
    'telemetria',
    'triggersInformativos',
    'auditoria',
    'avisosFederados',
    'contextoOperativoAgentesSesiones'
  ];
  for (const familia of familias) {
    const ids = {
      localA: id(TIPOS_IDENTIDAD_FEDERADA.INSTALACION),
      localB: id(TIPOS_IDENTIDAD_FEDERADA.INSTALACION),
      bootA: id(TIPOS_IDENTIDAD_FEDERADA.ARRANQUE),
      bootB: id(TIPOS_IDENTIDAD_FEDERADA.ARRANQUE),
      relacion: id(TIPOS_IDENTIDAD_FEDERADA.RELACION),
      efectiva: id(TIPOS_IDENTIDAD_FEDERADA.REVISION_CONCESION),
      oferta: id(TIPOS_IDENTIDAD_FEDERADA.REVISION_CONCESION),
      aceptacion: id(TIPOS_IDENTIDAD_FEDERADA.REVISION_CONCESION)
    };
    const base = {
      relacionId: ids.relacion,
      contexto: { nivel: 'portal', tenantId: null, empresaId: null, sitioId: null },
      ofertaId: ids.oferta,
      aceptacionId: ids.aceptacion,
      seleccion: {
        activa: true,
        vacia: false,
        nivelesScope: ['portal'],
        familias: { [familia]: { campos: [familia] } }
      }
    };
    const repoA = new RepositorioMemoria({
      ...base,
      direccion: 'emision',
      installationRemotaId: ids.localB,
      revisionEfectivaId: ids.efectiva
    });
    const repoB = new RepositorioMemoria({
      ...base,
      direccion: 'recepcion',
      installationRemotaId: ids.localA,
      revisionEfectivaId: ids.efectiva
    });
    const flujosA = new FlujosMemoria();
    const flujosB = new FlujosMemoria();
    const servicioA = servicio({
      repositorio: repoA,
      flujos: flujosA,
      corte: new CorteMemoria(flujosA, '0'),
      installationLocalId: ids.localA,
      bootLocalId: ids.bootA
    });
    const servicioB = servicio({
      repositorio: repoB,
      flujos: flujosB,
      corte: new CorteMemoria(flujosB, '999'),
      installationLocalId: ids.localB,
      bootLocalId: ids.bootB,
      sesiones: { validarBearer: async () => ({
        relacionId: ids.relacion,
        installationLocalId: ids.localB,
        installationRemotaId: ids.localA,
        bootRemotoId: ids.bootA
      }) }
    });
    const reconciliada = await servicioA.reconciliarDesdeConcesionEfectiva({
      relacionId: ids.relacion,
      revisionEfectivaId: ids.efectiva
    });
    const manifiesto = reconciliada.flujos[0].manifiesto;
    assert.equal(manifiesto.fronteraInicial, '0');
    await servicioB.recibirManifiesto({ token: 'vivo', manifiesto });
    assert.equal((await flujosB.obtener()).generacion.estado, 'completa', familia);
    await servicioA.confirmarManifiestoPublicado({ manifiesto });
    assert.equal((await flujosA.obtener()).generacion.estado, 'completa', familia);
    await servicioB.recibirManifiesto({ token: 'vivo', manifiesto });
    await servicioA.confirmarManifiestoPublicado({ manifiesto });
    assert.equal(flujosA.avances, 2, `${familia}: el replay no debe reavanzar emisión.`);
    assert.equal(flujosB.avances, 2, `${familia}: el replay no debe reavanzar recepción.`);
  }
}

async function verificarColaOmiteManifiestosYaPublicados() {
  let consulta = null;
  let parametros = null;
  const conexion = {
    async beginTransaction() {},
    async commit() {},
    async rollback() {},
    async release() {},
    async execute(sql, valores) {
      consulta = sql;
      parametros = valores;
      return [[]];
    }
  };
  const repositorio = new RepositorioReconciliacionFlujosFederacionSql({
    async obtenerConexion() { return conexion; }
  });
  const relacionId = id(TIPOS_IDENTIDAD_FEDERADA.RELACION);
  const manifiestos = await repositorio.listarManifiestosListos(relacionId);
  assert.deepEqual(manifiestos, []);
  assert.deepEqual(parametros, [relacionId]);
  assert.match(consulta, /p\.estado='lista'[\s\S]*g\.estado='preparada'/u);
}

async function verificarComposicion() {
  assert.equal(typeof RepositorioReconciliacionFlujosFederacionSql, 'function');
  const raiz = fileURLToPath(new URL('..', import.meta.url));
  const [web, rutas, openapi, migracion, consolidacion, repositorioFlujos,
    repositorioCandidatas] = await Promise.all([
    readFile(`${raiz}/apps/sentinelia-web/src/index.js`, 'utf8'),
    readFile(`${raiz}/apps/sentinelia-web/src/rutas/crearRutasApiFederacion.js`, 'utf8'),
    readFile(`${raiz}/openapi/federacion-control.v1.yaml`, 'utf8'),
    readFile(`${raiz}/migraciones/sql/0001_esquema_inicial.sql`, 'utf8'),
    readFile(`${raiz}/paquetes/federacion/adaptadores/RepositorioConsolidacionConcesionFederacionSql.js`, 'utf8'),
    readFile(`${raiz}/paquetes/federacion/adaptadores/RepositorioFlujosFederacionSql.js`, 'utf8'),
    readFile(`${raiz}/paquetes/federacion/adaptadores/RepositorioGeneracionesCandidatasFederacionSql.js`, 'utf8')
  ]);
  assert.match(web, /servicioReconciliacionFlujos:\s*servicioReconciliacionFlujosFederacion/u);
  assert.match(rutas, /control\/flujos\/manifiestos-iniciales/u);
  assert.match(openapi, /sentinelia-federacion-manifiesto-flujo-inicial-v1/u);
  assert.match(migracion, /reconciliaciones_flujos_concesion_federacion/u);
  assert.match(migracion, /scope_origen_nivel/u);
  assert.match(migracion,
    /`causa_supresion` enum\([^\n]*'generacionSustituida'/u);
  assert.match(repositorioFlujos,
    /causa_supresion='generacionSustituida'/u);
  assert.match(repositorioCandidatas,
    /causa_supresion='generacionSustituida'/u);
  assert.match(consolidacion,
    /perfil:\s*'concesion-efectiva-bilateral-v1'[\s\S]*componentes:\s*\[relacionId, ofertaId, aceptacionId\]/u);
}

function servicio({ repositorio, flujos, corte, installationLocalId,
  bootLocalId, sesiones = null }) {
  return new ServicioReconciliacionFlujosFederacion({
    repositorio, repositorioFlujos: flujos, servicioCorteInicial: corte,
    servicioSesiones: sesiones, installationLocalId, bootLocalId
  });
}

class RepositorioMemoria {
  constructor(concesion) { this.concesion = Object.freeze(concesion); this.planes = new Map(); }
  async cargarConcesionActual(_relacionId, revisionId) {
    if (revisionId != null) assert.equal(revisionId, this.concesion.revisionEfectivaId);
    return this.concesion;
  }
  async registrarPlan(plan) {
    const previo = this.planes.get(plan.flujoId);
    if (previo) return previo;
    const valor = Object.freeze({ ...plan,
      estado: plan.direccion === 'emision' ? 'preparandoFotografia' : 'pendienteManifiesto',
      fronteraInicial: null, version: '1' });
    this.planes.set(plan.flujoId, valor);
    return valor;
  }
  async marcarLista({ flujoId, fronteraInicial }) {
    const previo = this.planes.get(flujoId);
    if (previo.estado === 'lista' && previo.fronteraInicial !== fronteraInicial) {
      const error = new Error('frontera divergente');
      error.codigo = 'FRONTERA_INICIAL_DIVERGENTE';
      throw error;
    }
    const valor = Object.freeze({ ...previo, estado: 'lista', fronteraInicial,
      version: previo.estado === 'lista' ? previo.version : '2' });
    this.planes.set(flujoId, valor);
    return valor;
  }
  async listarManifiestosListos() { return []; }
}

class FlujosMemoria {
  creaciones = 0;
  avances = 0;
  actual = null;
  async crearFlujoInicial(entrada) {
    if (this.actual) { const error = new Error('duplicado'); error.code = 'ER_DUP_ENTRY'; throw error; }
    this.creaciones += 1;
    this.actual = structuredClone(entrada);
    return this.actual;
  }
  async obtener() {
    if (!this.actual) return null;
    return structuredClone({ ...this.actual.flujo,
      estado: this.actual.estadoFlujo ?? 'sinSincronizar',
      generacion: {
      generacionId: this.actual.generacion.generacionId,
      estado: this.actual.estadoGeneracion ?? 'preparada',
      versionEstado: String(this.actual.versionEstado ?? 1),
      propietario: { ...this.actual.generacion.propietario },
      frontera: {
        posicionInicial: this.actual.generacion.fronteraInicial,
        posicionOperativa: this.actual.frontera?.posicionOperativa ?? null,
        posicionHistorica: this.actual.frontera?.posicionHistorica ?? null,
        sincronizando: this.actual.frontera?.sincronizando ?? true,
        operativamenteCompleta: this.actual.frontera?.operativamenteCompleta ?? false,
        historicamenteCompleta: this.actual.frontera?.historicamenteCompleta ?? false,
        parcialPorScope: this.actual.frontera?.parcialPorScope ?? false,
        degradada: this.actual.frontera?.degradada ?? false,
        version: String(this.actual.versionFrontera ?? 1)
      }
    } });
  }
  async avanzarGeneracion(entrada) {
    assert.equal(String(entrada.versionEstadoEsperada), String(this.actual.versionEstado ?? 1));
    assert.equal(String(entrada.versionFronteraEsperada), String(this.actual.versionFrontera ?? 1));
    this.avances += 1;
    this.actual.estadoFlujo = entrada.estadoFlujo;
    this.actual.estadoGeneracion = entrada.estadoGeneracion;
    this.actual.versionEstado = (this.actual.versionEstado ?? 1) + 1;
    this.actual.versionFrontera = (this.actual.versionFrontera ?? 1) + 1;
    this.actual.frontera = structuredClone(entrada.frontera);
    return this.obtener();
  }
}

class CorteMemoria {
  cierres = 0;
  constructor(flujos, frontera) { this.flujos = flujos; this.frontera = frontera; }
  preparar({ flujo, generacion }) {
    return this.flujos.crearFlujoInicial({ flujo, generacion, corteInicialPendiente: true });
  }
  async cerrar() {
    this.cierres += 1;
    this.flujos.actual.generacion.fronteraInicial = this.frontera;
    return { fronteraInicial: this.frontera };
  }
}

await verificarReconciliacion();
await verificarCortesVaciosTodasLasFamilias();
await verificarColaOmiteManifiestosYaPublicados();
await verificarComposicion();
console.log(
  '[federacion] OK 5.22.21e: concesion=flujo-inicial ' +
  'identidades=deterministas fotografia=solo-emisor manifiesto=autenticado ' +
  'receptor=frontera-remota vacias=todas-familias replay=sin-duplicacion ' +
  'cola=solo-generaciones-preparadas'
);

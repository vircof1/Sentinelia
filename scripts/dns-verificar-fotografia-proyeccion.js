import assert from 'node:assert/strict';
import {
  PERFIL_PROYECCION_BIND_DNS_V1,
  ProyeccionBindDeterministaDns
} from '../paquetes/dns/src/ProyeccionBindDeterministaDns.js';
import {
  GeneracionDnsNoFotografiable,
  RepositorioFotografiaCatalogoDns
} from '../paquetes/dns/src/RepositorioFotografiaCatalogoDns.js';
import { RenderizadorCatalogoBindDnsV1 } from '../paquetes/dns/src/RenderizadorCatalogoBindDnsV1.js';
import { ServicioFotografiaProyeccionDns } from '../paquetes/dns/src/ServicioFotografiaProyeccionDns.js';

async function verificarManifiesto() {
  const materializador = materializadorSeguro();
  const renderizadorUno = () => [
    artefacto('a/zona', 'tres'),
    artefacto('Z.conf', 'dos'),
    artefacto('A.conf', 'uno')
  ];
  const renderizadorDos = () => [
    artefacto('A.conf', 'uno'),
    artefacto('a/zona', 'tres'),
    artefacto('Z.conf', 'dos')
  ];
  const primera = await materializador.materializar(renderizadorUno());
  const segunda = await materializador.materializar(renderizadorDos());
  assert.deepEqual(
    primera.manifiesto.archivos.map(({ ruta }) => ruta),
    ['A.conf', 'Z.conf', 'a/zona']
  );
  assert.equal(primera.manifiestoCanonico, segunda.manifiestoCanonico);
  assert.equal(primera.hashProyeccion.toString('hex'), segunda.hashProyeccion.toString('hex'));
  assert.equal(primera.perfilProyeccion, PERFIL_PROYECCION_BIND_DNS_V1);

  const copia = primera.listarArtefactos();
  copia[0].contenido.fill(0);
  assert.equal(primera.listarArtefactos()[0].contenido.toString('utf8'), 'uno');
  const copiaHash = primera.hashProyeccion;
  copiaHash.fill(0);
  assert.equal(primera.hashProyeccion.toString('hex'), segunda.hashProyeccion.toString('hex'));

  for (const ruta of ['/absoluta', '../escape', 'a//b', 'a\\b', 'a b', 'á.conf', 'a/./b']) {
    await assert.rejects(() => materializador.materializar([artefacto(ruta, 'x')]));
  }
  await assert.rejects(() => materializador.materializar([
    artefacto('igual.conf', 'a'), artefacto('igual.conf', 'b')
  ]), /duplicada/);
  await assert.rejects(
    () => new ProyeccionBindDeterministaDns({ validarDestino: () => false })
      .materializar([artefacto('enlace.conf', 'x')]),
    /enlaces simbólicos/
  );

  const baseV1 = new RenderizadorCatalogoBindDnsV1().renderizar({});
  assert.deepEqual(baseV1.map(({ ruta }) => ruta), [
    'sentinelia-named.conf',
    'zonas/sentinelia-zones.conf'
  ]);
  await materializador.materializar(baseV1);
}

async function verificarFotografiaConcurrente() {
  const estado = {
    generacion: '7',
    catalogo: Object.freeze({ revision: 'antes' })
  };
  const conexion = new ConexionFotografiaFixture(estado);
  const clienteSql = { obtenerConexion: async () => conexion };
  let lecturas = 0;
  let contextoDestino = null;
  const lectorCatalogo = {
    async leerEnContexto(conexionSnapshot) {
      lecturas += 1;
      estado.generacion = '8';
      estado.catalogo = Object.freeze({ revision: 'despues' });
      return conexionSnapshot.snapshot.catalogo;
    }
  };
  const repositorio = new RepositorioFotografiaCatalogoDns({
    clienteSql,
    lectorCatalogo,
    renderizador: {
      renderizar: ({ revision }) => [artefacto('catalogo.conf', revision)]
    },
    materializador: materializadorSeguro(({ contexto }) => {
      contextoDestino = contexto;
      return true;
    })
  });
  const fotografia = await repositorio.materializar({ generacionDns: '7' });
  assert.equal(lecturas, 1);
  assert.deepEqual(contextoDestino, { generacionDns: '7' });
  assert.equal(fotografia.catalogo.revision, 'antes');
  assert.equal(fotografia.proyeccion.listarArtefactos()[0].contenido.toString(), 'antes');
  assert.deepEqual(conexion.orden.slice(0, 3), [
    'SET TRANSACTION ISOLATION LEVEL REPEATABLE READ',
    'START TRANSACTION READ ONLY, WITH CONSISTENT SNAPSHOT',
    'SELECT cabecera'
  ]);
  assert.equal(conexion.commitRealizado, true);
  assert.equal(conexion.liberada, true);
}

async function verificarFronteraEfectoYRecuperacion() {
  const hash = Buffer.alloc(32, 0x2a);
  const fotografia = Object.freeze({
    generacionLeida: '9',
    proyeccion: Object.freeze({
      perfilProyeccion: PERFIL_PROYECCION_BIND_DNS_V1,
      hashProyeccion: hash
    })
  });
  const llamadas = [];
  const repositorioCoordinacion = {
    verificarAutoridadConLease: async () => true,
    crearSucesoraPorDivergencia: async (generacion, diagnostico, opciones) => {
      assert.equal(opciones.lease.generacionDns, generacion);
      llamadas.push({ generacion, diagnostico, opciones });
      return Object.freeze({ creada: true, operacion: { generacionDns: '10' } });
    }
  };
  const servicio = new ServicioFotografiaProyeccionDns({
    repositorioFotografia: { materializar: async () => fotografia },
    repositorioCoordinacion,
    coordinador: {
      avanzar: async (_lease, peticion) => {
        llamadas.push(peticion);
        return { operacion: { generacionDns: '9', efectoPosible: true } };
      }
    }
  });
  const lease = { operacionId: '9' };
  const pendiente = await servicio.prepararEfecto({
    lease,
    operacion: { generacionDns: '9', efectoPosible: false }
  });
  assert.equal(pendiente.recuperacion, false);
  assert.equal(llamadas[0].transicion, 'efecto_iniciado');
  assert.equal(llamadas[0].datos.hashProyeccion, hash);

  const congelada = {
    generacionDns: '9',
    efectoPosible: true,
    generacionLeida: '9',
    perfilProyeccion: PERFIL_PROYECCION_BIND_DNS_V1,
    hashProyeccion: hash.toString('hex')
  };
  assert.equal((await servicio.prepararEfecto({ lease, operacion: congelada })).recuperacion, true);
  const divergente = await servicio.prepararEfecto({
    lease,
    operacion: { ...congelada, hashProyeccion: Buffer.alloc(32, 0x01).toString('hex') }
  });
  assert.equal(divergente.divergente, true);
  assert.equal(divergente.fotografia, null);
  assert.equal(llamadas.at(-1).generacion, '9');

  const servicioGeneracionAvanzada = new ServicioFotografiaProyeccionDns({
    repositorioFotografia: {
      materializar: async () => {
        throw new GeneracionDnsNoFotografiable({ esperada: '9', observada: '10' });
      }
    },
    repositorioCoordinacion,
    coordinador: { avanzar: async () => assert.fail('No debe iniciar otro efecto.') }
  });
  const avanzada = await servicioGeneracionAvanzada.prepararEfecto({
    lease,
    operacion: congelada
  });
  assert.equal(avanzada.divergente, true);
  assert.equal(llamadas.at(-1).generacion, '9');

  const confirmada = await servicio.prepararEfecto({
    lease,
    operacion: { ...congelada, recargaConfirmadaEnUtc: new Date() }
  });
  assert.equal(confirmada.consolidarSinRenderizar, true);
}

function artefacto(ruta, contenido) {
  return { ruta, contenido: Buffer.from(contenido, 'utf8') };
}

function materializadorSeguro(validarDestino = () => true) {
  return new ProyeccionBindDeterministaDns({ validarDestino });
}

class ConexionFotografiaFixture {
  constructor(estado) {
    this.estado = estado;
    this.orden = [];
    this.snapshot = null;
    this.commitRealizado = false;
    this.liberada = false;
  }

  async query(sql) {
    this.orden.push(sql);
    if (sql === 'START TRANSACTION READ ONLY, WITH CONSISTENT SNAPSHOT') {
      this.snapshot = { generacion: this.estado.generacion, catalogo: this.estado.catalogo };
    }
    return [[], []];
  }

  async execute(sql) {
    if (sql.startsWith('SET TRANSACTION')) {
      this.orden.push(sql);
      return [[], []];
    }
    if (sql.includes('FROM cabecera_generacion_dns')) {
      this.orden.push('SELECT cabecera');
      return [[{ ultima_generacion_dns: this.snapshot.generacion }], []];
    }
    throw new Error(`SQL inesperado en fixture: ${sql}`);
  }

  async commit() { this.commitRealizado = true; }
  async rollback() {}
  release() { this.liberada = true; }
}

await verificarManifiesto();
await verificarFotografiaConcurrente();
await verificarFronteraEfectoYRecuperacion();

console.log('[dns] OK 5.21.5j: snapshot=unico rutas=ascii orden=binario jcs=estable bytes=aislados efecto=congelado divergencia=sucesora fs=no bind=no');

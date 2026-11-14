import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  ActivadorArtefactosBindDns,
  ColisionDirectorioGeneracionBind,
  DiagnosticoAlmacenamientoBindDns,
  ErrorActivacionArtefactosBind
} from '../paquetes/dns/src/ActivadorArtefactosBindDns.js';
import {
  BloqueoAsesorMariaDbBindDns,
  BloqueoFilesystemFlockBindDns,
  SeccionCriticaPublicacionBindDns,
  TimeoutBloqueoPublicacionBind
} from '../paquetes/dns/src/BloqueosPublicacionBindDns.js';
import { ProyeccionBindDeterministaDns } from '../paquetes/dns/src/ProyeccionBindDeterministaDns.js';
import { SelectorActivoBindDns } from '../paquetes/dns/src/SelectorActivoBindDns.js';
import { ClienteSql } from '../paquetes/persistencia-sql/src/ClienteSql.js';
import { obtenerConfiguracionAplicacion } from '../paquetes/utilidades/src/configuracion/obtenerConfiguracionAplicacion.js';

const base = await fs.mkdtemp(path.join(os.tmpdir(), 'sentinelia-bind-5k-'));
const raiz = path.join(base, 'artefactos');
const rutaSelector = path.join(base, 'selector.conf');
const rutaLock = path.join(base, 'publicacion.lock');

try {
  await fs.mkdir(raiz);
  await verificarSelector();
  await verificarActivacionYRecuperacion();
  await verificarFlock();
  await verificarSeccionCritica();
  await verificarBloqueoAsesorReal();
  console.log('[dns] OK 5.21.5k: locks=dobles plazo=acotado staging=fsync directorio=inmutable selector=rename-unico recuperacion=determinista limpieza=segura shell=no bind=no');
} finally {
  await habilitarLimpieza(base);
  await fs.rm(base, { recursive: true, force: true });
}

async function verificarSelector() {
  const selector = new SelectorActivoBindDns({ raizArtefactos: raiz });
  const hash = 'ab'.repeat(32);
  const bytes = selector.construir({ generacionDns: '42', hashProyeccion: hash });
  assert.equal(bytes.toString('ascii'),
    '# sentinelia-bind-selector-v1\n' +
    '# generacion=42\n' +
    `# hashProyeccion=${hash}\n` +
    `include "${raiz}/generacion-42/sentinelia-named.conf";\n`);
  assert.deepEqual(selector.interpretar(bytes), {
    generacionDns: '42',
    hashProyeccion: hash,
    rutaNamedConf: `${raiz}/generacion-42/sentinelia-named.conf`
  });
  for (const invalido of [
    bytes.toString().replaceAll('\n', '\r\n'),
    bytes.toString() + '# extra\n',
    bytes.toString().replace('generacion=42', 'generacion=042'),
    bytes.toString().replace('# generacion=', '# hash='),
    bytes.toString().replace('generacion-42', 'generacion-43')
  ]) assert.throws(() => selector.interpretar(Buffer.from(invalido)));
}

async function verificarActivacionYRecuperacion() {
  let autoridad = true;
  const crear = (puntoControl = async () => {}) => new ActivadorArtefactosBindDns({
    raizArtefactos: raiz,
    rutaSelectorActivo: rutaSelector,
    rutaLock,
    validarAutoridad: async () => autoridad,
    validarCandidata: async () => {},
    puntoControl
  });
  const proyeccion1 = await proyeccion('uno');
  const activador = crear();
  const diagnostico = new DiagnosticoAlmacenamientoBindDns({
    activador,
    bloqueoFilesystem: new BloqueoFilesystemFlockBindDns({ rutaLock })
  });
  assert.deepEqual(
    Object.keys(await diagnostico.verificar()).sort(),
    ['creacionExclusiva', 'dispositivo', 'flock', 'fsync', 'rename', 'valido'].sort()
  );
  await fs.writeFile(
    rutaSelector,
    '// sentinelia-bind-selector-bootstrap-v1\n' +
      'include "/etc/bind/sentinelia.named.conf";\n'
  );
  const primera = await activador.activar({ generacionDns: '1', proyeccion: proyeccion1 });
  assert.equal(primera.activada, true);
  assert.equal((await activador.leerSelectorActivo()).generacionDns, '1');
  assert.equal(await fs.readFile(`${raiz}/generacion-1/sentinelia-named.conf`, 'utf8'), 'uno');
  assert.equal((await fs.stat(`${raiz}/generacion-1`)).mode & 0o777, 0o550);
  assert.equal((await fs.stat(`${raiz}/generacion-1/sentinelia-named.conf`)).mode & 0o777, 0o440);
  const repetida = await activador.activar({ generacionDns: '1', proyeccion: proyeccion1 });
  assert.equal(repetida.activada, false);
  assert.equal(repetida.adoptada, true);

  await fs.mkdir(`${raiz}/generacion-2`);
  await fs.writeFile(`${raiz}/generacion-2/ajeno`, 'divergente');
  await fs.symlink('/etc/passwd', `${raiz}/generacion-2/sentinelia-named.conf`);
  assert.equal(await activador.validarDestinoFotografia({
    ruta: 'sentinelia-named.conf',
    contexto: { generacionDns: '2' }
  }), false);
  await fs.unlink(`${raiz}/generacion-2/sentinelia-named.conf`);
  const proyeccion2 = await proyeccion('dos');
  await assert.rejects(
    () => activador.activar({ generacionDns: '2', proyeccion: proyeccion2 }),
    ColisionDirectorioGeneracionBind
  );

  const proyeccion3 = await proyeccion('tres');
  const antesSelector = crear(async (punto) => {
    if (punto === 'selector_candidato_sincronizado') throw new Error('caida_antes_selector');
  });
  await assert.rejects(
    () => antesSelector.activar({ generacionDns: '3', proyeccion: proyeccion3 }),
    (error) => error instanceof ErrorActivacionArtefactosBind && !error.selectorReemplazado
  );
  assert.equal((await activador.leerSelectorActivo()).generacionDns, '1');
  assert.equal(await fs.readFile(`${raiz}/generacion-3/sentinelia-named.conf`, 'utf8'), 'tres');
  assert.equal((await activador.activar({ generacionDns: '3', proyeccion: proyeccion3 })).adoptada, true);

  const proyeccion4 = await proyeccion('cuatro');
  const despuesSelector = crear(async (punto) => {
    if (punto === 'selector_renombrado') throw new Error('caida_despues_selector');
  });
  await assert.rejects(
    () => despuesSelector.activar({ generacionDns: '4', proyeccion: proyeccion4 }),
    (error) => error instanceof ErrorActivacionArtefactosBind && error.selectorReemplazado && error.recuperable
  );
  assert.equal((await activador.leerSelectorActivo()).generacionDns, '4');
  assert.equal((await activador.activar({ generacionDns: '4', proyeccion: proyeccion4 })).activada, false);

  autoridad = false;
  await assert.rejects(() => activador.activar({ generacionDns: '5', proyeccion: proyeccion1 }), /perdió lease/);
  assert.equal((await activador.leerSelectorActivo()).generacionDns, '4');
  autoridad = true;

  const artefactosAdulterados = proyeccion1.listarArtefactos();
  artefactosAdulterados[0] = {
    ...artefactosAdulterados[0],
    contenido: Buffer.from('contenido-adulterado')
  };
  const adulterada = {
    perfilProyeccion: proyeccion1.perfilProyeccion,
    manifiesto: proyeccion1.manifiesto,
    manifiestoCanonico: proyeccion1.manifiestoCanonico,
    get hashProyeccion() { return proyeccion1.hashProyeccion; },
    listarArtefactos: () => artefactosAdulterados
  };
  await assert.rejects(
    () => activador.activar({ generacionDns: '6', proyeccion: adulterada }),
    /bytes BIND no coinciden/
  );
  await assert.rejects(() => fs.stat(`${raiz}/generacion-6`), /ENOENT/);

  const antigua = new Date(Date.now() - 120_000);
  await fs.utimes(`${raiz}/generacion-1`, antigua, antigua);
  await fs.utimes(`${raiz}/generacion-3`, antigua, antigua);
  const limpieza = await activador.limpiar({ generacionesProtegidas: ['3'], graciaMs: 60_000 });
  assert.equal(limpieza.eliminadas, 1);
  await assert.rejects(() => fs.stat(`${raiz}/generacion-1`), /ENOENT/);
  assert.equal((await fs.stat(`${raiz}/generacion-3`)).isDirectory(), true);
  assert.equal((await fs.stat(`${raiz}/generacion-4`)).isDirectory(), true);

  const selectorValido = await fs.readFile(rutaSelector);
  await fs.writeFile(rutaSelector, '# sentinelia-bind-selector-v1\n# generacion=4\n');
  await assert.rejects(() => activador.clasificarSelectorActivo(), /cuatro líneas/);
  await fs.writeFile(rutaSelector, 'include "/etc/bind/sentinelia.named.conf";\n');
  assert.equal(await activador.clasificarSelectorActivo(), 'legacy');
  await fs.writeFile(rutaSelector, selectorValido);

  const enlaceBase = path.join(base, 'enlace');
  await fs.symlink(raiz, enlaceBase);
  const inseguro = new ActivadorArtefactosBindDns({
    raizArtefactos: enlaceBase,
    rutaSelectorActivo: path.join(base, 'selector-inseguro.conf'),
    rutaLock: path.join(base, 'lock-inseguro'),
    validarAutoridad: async () => true,
    validarCandidata: async () => {}
  });
  await assert.rejects(() => inseguro.validarDespliegue(), /enlace simbólico/);
}

async function verificarFlock() {
  const bloqueo = new BloqueoFilesystemFlockBindDns({ rutaLock });
  const primero = await bloqueo.adquirir({ timeoutMs: 1_000 });
  await assert.rejects(
    () => bloqueo.adquirir({ timeoutMs: 80 }),
    TimeoutBloqueoPublicacionBind
  );
  await primero.liberar();
  const segundo = await bloqueo.adquirir({ timeoutMs: 1_000 });
  await segundo.liberar();
}

async function verificarSeccionCritica() {
  const orden = [];
  const bloqueo = (nombre) => ({
    async adquirir() {
      orden.push(`adquirir:${nombre}`);
      return { async liberar() { orden.push(`liberar:${nombre}`); } };
    }
  });
  const seccion = new SeccionCriticaPublicacionBindDns({
    bloqueoAsesor: bloqueo('sql'),
    bloqueoFilesystem: bloqueo('fs'),
    margenSeguridadMs: 10
  });
  await seccion.ejecutar({
    venceEnUtcMs: Date.now() + 2_000,
    validarAutoridad: async () => { orden.push('autoridad'); return true; },
    trabajo: async () => { orden.push('trabajo'); }
  });
  assert.deepEqual(orden, [
    'adquirir:sql', 'autoridad', 'adquirir:fs', 'autoridad', 'trabajo',
    'liberar:fs', 'liberar:sql'
  ]);
  await assert.rejects(() => seccion.ejecutar({
    venceEnUtcMs: Date.now(),
    validarAutoridad: async () => true,
    trabajo: async () => assert.fail('No debe entrar.')
  }), TimeoutBloqueoPublicacionBind);

  const liberacionParcial = [];
  const seccionTimeoutFs = new SeccionCriticaPublicacionBindDns({
    bloqueoAsesor: {
      async adquirir() {
        liberacionParcial.push('sql_adquirido');
        return { async liberar() { liberacionParcial.push('sql_liberado'); } };
      }
    },
    bloqueoFilesystem: {
      async adquirir() { throw new TimeoutBloqueoPublicacionBind('fs_fixture'); }
    }
  });
  await assert.rejects(() => seccionTimeoutFs.ejecutar({
    venceEnUtcMs: Date.now() + 2_000,
    validarAutoridad: async () => true,
    trabajo: async () => assert.fail('No debe entrar.')
  }), TimeoutBloqueoPublicacionBind);
  assert.deepEqual(liberacionParcial, ['sql_adquirido', 'sql_liberado']);
}

async function verificarBloqueoAsesorReal() {
  const configuracion = obtenerConfiguracionAplicacion();
  if (!configuracion.sql.estaCompleta) return;
  const clienteSql = new ClienteSql(configuracion.sql);
  try {
    const bloqueo = new BloqueoAsesorMariaDbBindDns({ clienteSql });
    const adquirido = await bloqueo.adquirir({ timeoutMs: 1_000 });
    await adquirido.liberar();
  } finally {
    await clienteSql.cerrar();
  }
}

async function proyeccion(contenido) {
  return new ProyeccionBindDeterministaDns({ validarDestino: () => true }).materializar([
    { ruta: 'sentinelia-named.conf', contenido: Buffer.from(contenido) },
    { ruta: 'zonas/sentinelia-zones.conf', contenido: Buffer.from(`zonas:${contenido}`) }
  ]);
}

async function habilitarLimpieza(ruta) {
  let entradas;
  try { entradas = await fs.readdir(ruta, { withFileTypes: true }); }
  catch (error) { if (error?.code === 'ENOENT') return; throw error; }
  await fs.chmod(ruta, 0o750);
  for (const entrada of entradas) {
    if (entrada.isDirectory() && !entrada.isSymbolicLink()) {
      await habilitarLimpieza(path.join(ruta, entrada.name));
    }
  }
}

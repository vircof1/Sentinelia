import { createHash, randomBytes } from 'node:crypto';
import { constants as fsConstants } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import { canonicalizarRfc8785 } from '../../auditoria/src/PerfilJcsAuditoria.js';
import { validarRutaRelativaBind } from './ProyeccionBindDeterministaDns.js';
import {
  NOMBRE_NAMED_CONF_GENERACION,
  SelectorActivoBindDns,
  validarRutaPosixAbsolutaBind
} from './SelectorActivoBindDns.js';

const NOMBRE_METADATOS = 'sentinelia-proyeccion.json';
const SELECTOR_BOOTSTRAP_DESPLIEGUE = Buffer.from(
  '// sentinelia-bind-selector-bootstrap-v1\n' +
  'include "/etc/bind/sentinelia.named.conf";\n',
  'ascii'
);

export class ActivadorArtefactosBindDns {
  constructor({
    raizArtefactos,
    rutaSelectorActivo,
    rutaLock,
    validarAutoridad,
    validarCandidata,
    puntoControl = async () => {}
  } = {}) {
    this.raizArtefactos = validarRutaPosixAbsolutaBind(raizArtefactos, 'BIND_RAIZ_ARTEFACTOS');
    this.rutaSelectorActivo = validarRutaPosixAbsolutaBind(rutaSelectorActivo, 'BIND_SELECTOR_ACTIVO');
    this.rutaLock = validarRutaPosixAbsolutaBind(rutaLock, 'BIND_LOCK_FILE');
    if (this.rutaSelectorActivo === this.rutaLock || typeof validarAutoridad !== 'function') {
      throw new Error('Selector, lock y validación de autoridad BIND deben ser independientes.');
    }
    this.validarAutoridad = validarAutoridad;
    if (typeof validarCandidata !== 'function') throw new Error('El validador de candidata BIND no es invocable.');
    this.validarCandidata = validarCandidata;
    this.puntoControl = puntoControl;
    this.selector = new SelectorActivoBindDns({ raizArtefactos: this.raizArtefactos });
  }

  async validarDespliegue() {
    await validarCadenaSinEnlaces(this.raizArtefactos, { exigirFinal: 'directorio' });
    await validarCadenaSinEnlaces(path.dirname(this.rutaSelectorActivo), { exigirFinal: 'directorio' });
    await validarCadenaSinEnlaces(path.dirname(this.rutaLock), { exigirFinal: 'directorio' });
    await validarControlExistente(this.rutaSelectorActivo);
    await validarControlExistente(this.rutaLock);
    const [raiz, selectorPadre, lockPadre] = await Promise.all([
      fs.stat(this.raizArtefactos),
      fs.stat(path.dirname(this.rutaSelectorActivo)),
      fs.stat(path.dirname(this.rutaLock))
    ]);
    if (raiz.dev !== selectorPadre.dev || raiz.dev !== lockPadre.dev) {
      throw new Error('Raíz, selector y lock BIND deben residir en el mismo filesystem.');
    }
    if (estaEnDirectorioGeneracion(this.rutaSelectorActivo, this.raizArtefactos) ||
        estaEnDirectorioGeneracion(this.rutaLock, this.raizArtefactos)) {
      throw new Error('Selector y lock no pueden estar dentro de un directorio por generación.');
    }
    const mountpoints = await leerMountpointsLinux();
    if (mountpoints.has(this.rutaSelectorActivo) || mountpoints.has(this.rutaLock)) {
      throw new Error('Selector y lock BIND no pueden ser mountpoints individuales.');
    }
    return Object.freeze({ dispositivo: String(raiz.dev), valido: true });
  }

  async validarDestinoFotografia({ ruta, contexto } = {}) {
    const relativa = validarRutaRelativaBind(ruta);
    const generacionDns = String(contexto?.generacionDns ?? '');
    const directorio = this.selector.rutaDirectorio(generacionDns);
    const destino = path.join(directorio, relativa);
    await this.validarDespliegue();
    try {
      const estadoDirectorio = await fs.lstat(directorio);
      if (estadoDirectorio.isSymbolicLink() || !estadoDirectorio.isDirectory()) return false;
    } catch (error) {
      if (error?.code === 'ENOENT') return true;
      throw error;
    }
    let actual = directorio;
    for (const componente of relativa.split('/')) {
      actual = path.join(actual, componente);
      let estado;
      try { estado = await fs.lstat(actual); }
      catch (error) {
        if (error?.code === 'ENOENT') return true;
        throw error;
      }
      if (estado.isSymbolicLink()) return false;
      if (actual !== destino && !estado.isDirectory()) return false;
      if (actual === destino && !estado.isFile()) return false;
    }
    return true;
  }

  async activar({ generacionDns, proyeccion, validarAutoridad = this.validarAutoridad }) {
    const hashProyeccion = proyeccion?.hashProyeccion;
    const artefactos = proyeccion?.listarArtefactos?.();
    if (!Buffer.isBuffer(hashProyeccion) || hashProyeccion.length !== 32 || !Array.isArray(artefactos)) {
      throw new Error('La activación BIND requiere una fotografía de proyección cerrada.');
    }
    validarFotografiaProyeccion(proyeccion, artefactos);
    if (!artefactos.some(({ ruta }) => ruta === NOMBRE_NAMED_CONF_GENERACION)) {
      throw new Error(`La proyección debe contener ${NOMBRE_NAMED_CONF_GENERACION}.`);
    }
    if (artefactos.some(({ ruta }) => ruta === NOMBRE_METADATOS)) {
      throw new Error(`${NOMBRE_METADATOS} está reservado para control técnico.`);
    }
    await this.validarDespliegue();
    await exigirAutoridad(validarAutoridad);
    const final = this.selector.rutaDirectorio(generacionDns);
    const metadatos = construirMetadatos(proyeccion);
    let directorioCreado = false;
    let candidataFinalValidada = false;
    let selectorReemplazado = false;
    let staging = null;
    let candidato = null;
    try {
      const adopcion = await compararDirectorio(final, artefactos, metadatos);
      if (adopcion === 'divergente') {
        throw new ColisionDirectorioGeneracionBind(generacionDns);
      }
      if (adopcion === 'ausente') {
        staging = path.join(
          this.raizArtefactos,
          `staging-${generacionDns}-${randomBytes(8).toString('hex')}`
        );
        await fs.mkdir(staging, { mode: 0o750 });
        await this.puntoControl('staging_creado');
        for (const artefacto of artefactos) {
          validarRutaRelativaBind(artefacto.ruta);
          await escribirArchivoSeguro(staging, artefacto.ruta, artefacto.contenido);
          await this.puntoControl(`artefacto:${artefacto.ruta}`);
        }
        await escribirArchivoSeguro(staging, NOMBRE_METADATOS, metadatos);
        await sincronizarArbolDirectorios(staging);
        await this.validarCandidata(Object.freeze({
          directorioStaging: staging,
          generacionDns: String(generacionDns),
          proyeccion,
          validarConfiguracion: false
        }));
        await this.puntoControl('candidata_validada');
        await sellarArbolInmutable(staging);
        await exigirAutoridad(validarAutoridad);
        await fs.rename(staging, final);
        staging = null;
        directorioCreado = true;
        await sincronizarDirectorio(this.raizArtefactos);
        await this.puntoControl('directorio_renombrado');
        await this.validarCandidata(Object.freeze({
          directorioStaging: final,
          generacionDns: String(generacionDns),
          proyeccion,
          validarConfiguracion: true
        }));
        candidataFinalValidada = true;
        await this.puntoControl('candidata_final_validada');
      }

      const bytesSelector = this.selector.construir({ generacionDns, hashProyeccion });
      const activo = await leerSelectorActivable(
        this.rutaSelectorActivo,
        this.selector
      );
      if (activo?.generacionDns === String(generacionDns) &&
          activo.hashProyeccion === hashProyeccion.toString('hex')) {
        return Object.freeze({ activada: false, adoptada: !directorioCreado, selector: activo });
      }
      await exigirAutoridad(validarAutoridad);
      candidato = `${this.rutaSelectorActivo}.candidato-${process.pid}-${randomBytes(8).toString('hex')}`;
      await escribirArchivoAbsolutoSeguro(candidato, bytesSelector);
      this.selector.interpretar(await leerArchivoRegularNoFollow(candidato));
      await this.puntoControl('selector_candidato_sincronizado');
      await validarControlExistente(this.rutaSelectorActivo);
      await exigirAutoridad(validarAutoridad);
      await fs.rename(candidato, this.rutaSelectorActivo);
      candidato = null;
      selectorReemplazado = true;
      await this.puntoControl('selector_renombrado');
      await sincronizarDirectorio(path.dirname(this.rutaSelectorActivo));
      await this.puntoControl('selector_directorio_sincronizado');
      return Object.freeze({
        activada: true,
        adoptada: !directorioCreado,
        selector: this.selector.interpretar(await leerArchivoRegularNoFollow(this.rutaSelectorActivo))
      });
    } catch (causa) {
      if (staging) await retirarDirectorioGestionado(staging).catch(() => {});
      if (candidato) await fs.rm(candidato, { force: true }).catch(() => {});
      if (directorioCreado && !candidataFinalValidada && !selectorReemplazado) {
        await retirarDirectorioGestionado(final).catch(() => {});
      }
      if (causa instanceof ColisionDirectorioGeneracionBind) throw causa;
      throw new ErrorActivacionArtefactosBind(causa, { selectorReemplazado });
    }
  }

  async leerSelectorActivo() {
    return leerSelectorSiExiste(this.rutaSelectorActivo, this.selector);
  }

  async clasificarSelectorActivo() {
    try {
      return (await this.leerSelectorActivo()) ? 'v1' : 'ausente';
    } catch (error) {
      const bytes = await leerArchivoRegularNoFollow(this.rutaSelectorActivo);
      if (bytes.toString('ascii').startsWith('# sentinelia-bind-selector-')) throw error;
      return 'legacy';
    }
  }

  rutaDirectorioGeneracion(generacionDns) {
    return this.selector.rutaDirectorio(generacionDns);
  }

  async limpiar({ generacionesProtegidas = [], graciaMs = 86_400_000, limite = 20 } = {}) {
    const protegidas = new Set(generacionesProtegidas.map(String));
    const activo = await this.leerSelectorActivo();
    if (activo) protegidas.add(activo.generacionDns);
    const entradas = await fs.readdir(this.raizArtefactos, { withFileTypes: true });
    let eliminadas = 0;
    for (const entrada of entradas.sort((a, b) => a.name.localeCompare(b.name))) {
      const coincidencia = /^generacion-([1-9][0-9]*)$/.exec(entrada.name);
      if (!coincidencia || protegidas.has(coincidencia[1]) || eliminadas >= limite) continue;
      const ruta = path.join(this.raizArtefactos, entrada.name);
      const estado = await fs.lstat(ruta);
      if (!estado.isDirectory() || estado.isSymbolicLink() || Date.now() - estado.mtimeMs < graciaMs) continue;
      await retirarDirectorioGestionado(ruta);
      eliminadas += 1;
    }
    if (eliminadas > 0) await sincronizarDirectorio(this.raizArtefactos);
    return Object.freeze({ eliminadas });
  }
}

export class DiagnosticoAlmacenamientoBindDns {
  constructor({
    activador,
    bloqueoFilesystem,
    probarDirectorio = probarPrimitivasDirectorio
  } = {}) {
    if (!activador?.validarDespliegue || !bloqueoFilesystem?.adquirir ||
        typeof probarDirectorio !== 'function') {
      throw new Error('El diagnóstico BIND requiere activador y flock configurados.');
    }
    this.activador = activador;
    this.bloqueoFilesystem = bloqueoFilesystem;
    this.probarDirectorio = probarDirectorio;
  }

  async verificar() {
    const despliegue = await this.activador.validarDespliegue();
    const directorios = new Set([
      this.activador.raizArtefactos,
      path.dirname(this.activador.rutaSelectorActivo),
      path.dirname(this.activador.rutaLock)
    ]);
    for (const directorio of directorios) await this.probarDirectorio(directorio);
    const flock = await this.bloqueoFilesystem.adquirir({ timeoutMs: 1_000 });
    await flock.liberar();
    return Object.freeze({ ...despliegue, creacionExclusiva: true, fsync: true, rename: true, flock: true });
  }
}

export class ColisionDirectorioGeneracionBind extends Error {
  constructor(generacionDns) {
    super(`El directorio inmutable de la generación ${generacionDns} ya existe con contenido divergente.`);
    this.name = 'ColisionDirectorioGeneracionBind';
    this.codigo = 'dns_directorio_generacion_divergente';
  }
}

export class ErrorActivacionArtefactosBind extends Error {
  constructor(causa, { selectorReemplazado }) {
    super(causa?.message || 'Falló la activación de artefactos BIND.', { cause: causa });
    this.name = 'ErrorActivacionArtefactosBind';
    this.selectorReemplazado = Boolean(selectorReemplazado);
    this.recuperable = this.selectorReemplazado;
  }
}

function construirMetadatos(proyeccion) {
  return Buffer.from(JSON.stringify({
    perfil: proyeccion.perfilProyeccion,
    hashProyeccion: proyeccion.hashProyeccion.toString('hex'),
    manifiestoCanonico: proyeccion.manifiestoCanonico
  }) + '\n', 'utf8');
}

function validarFotografiaProyeccion(proyeccion, artefactos) {
  const manifiesto = proyeccion.manifiesto;
  const clavesEsperadas = manifiesto?.diagnostico
    ? 'perfil,archivos,diagnostico'
    : 'perfil,archivos';
  if (!manifiesto || Object.keys(manifiesto).join(',') !== clavesEsperadas ||
      manifiesto.perfil !== proyeccion.perfilProyeccion ||
      !Array.isArray(manifiesto.archivos) || manifiesto.archivos.length !== artefactos.length) {
    throw new Error('La fotografía BIND no conserva un manifiesto cerrado coherente.');
  }
  for (let indice = 0; indice < artefactos.length; indice += 1) {
    const artefacto = artefactos[indice];
    const entrada = manifiesto.archivos[indice];
    if (Object.keys(entrada || {}).join(',') !== 'ruta,sha256Contenido' ||
        entrada.ruta !== artefacto.ruta ||
        entrada.sha256Contenido !== sha256(artefacto.contenido)) {
      throw new Error('Los bytes BIND no coinciden con su manifiesto congelado.');
    }
  }
  const canonico = canonicalizarRfc8785(manifiesto);
  if (canonico !== proyeccion.manifiestoCanonico ||
      sha256(Buffer.from(canonico, 'utf8')) !== proyeccion.hashProyeccion.toString('hex')) {
    throw new Error('El manifiesto JCS BIND no coincide con hashProyeccion.');
  }
}

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

async function compararDirectorio(ruta, artefactos, metadatos) {
  let estado;
  try { estado = await fs.lstat(ruta); } catch (error) {
    if (error?.code === 'ENOENT') return 'ausente';
    throw error;
  }
  if (!estado.isDirectory() || estado.isSymbolicLink()) return 'divergente';
  const esperados = new Map([
    ...artefactos.map(({ ruta: relativa, contenido }) => [relativa, contenido]),
    [NOMBRE_METADATOS, metadatos]
  ]);
  const encontrados = await listarArchivosRegulares(ruta);
  if (encontrados.length !== esperados.size) return 'divergente';
  for (const relativa of encontrados) {
    const esperado = esperados.get(relativa);
    if (!esperado || !(await leerArchivoRegularNoFollow(path.join(ruta, relativa))).equals(esperado)) {
      return 'divergente';
    }
  }
  return 'identico';
}

async function listarArchivosRegulares(raiz, relativa = '') {
  const resultado = [];
  for (const entrada of await fs.readdir(path.join(raiz, relativa), { withFileTypes: true })) {
    const siguiente = relativa ? `${relativa}/${entrada.name}` : entrada.name;
    if (entrada.isSymbolicLink()) throw new Error('Un directorio de generación contiene un enlace simbólico.');
    if (entrada.isDirectory()) resultado.push(...await listarArchivosRegulares(raiz, siguiente));
    else if (entrada.isFile()) resultado.push(siguiente);
    else throw new Error('Un directorio de generación contiene un tipo de archivo no permitido.');
  }
  return resultado.sort((a, b) => Buffer.compare(Buffer.from(a), Buffer.from(b)));
}

async function escribirArchivoSeguro(raiz, relativa, contenido) {
  const componentes = relativa.split('/');
  let actual = raiz;
  for (const componente of componentes.slice(0, -1)) {
    actual = path.join(actual, componente);
    try { await fs.mkdir(actual, { mode: 0o750 }); } catch (error) {
      if (error?.code !== 'EEXIST') throw error;
    }
    const estado = await fs.lstat(actual);
    if (!estado.isDirectory() || estado.isSymbolicLink()) throw new Error('La ruta BIND intermedia no es un directorio seguro.');
  }
  await escribirArchivoAbsolutoSeguro(path.join(raiz, relativa), contenido);
}

async function escribirArchivoAbsolutoSeguro(ruta, contenido) {
  const handle = await fs.open(
    ruta,
    fsConstants.O_CREAT | fsConstants.O_EXCL | fsConstants.O_WRONLY | fsConstants.O_NOFOLLOW,
    0o640
  );
  try { await handle.writeFile(contenido); await handle.sync(); } finally { await handle.close(); }
}

async function leerArchivoRegularNoFollow(ruta) {
  const handle = await fs.open(ruta, fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW);
  try {
    if (!(await handle.stat()).isFile()) throw new Error('El artefacto BIND no es un archivo regular.');
    return await handle.readFile();
  } finally { await handle.close(); }
}

async function leerSelectorSiExiste(ruta, selector) {
  try { return selector.interpretar(await leerArchivoRegularNoFollow(ruta)); }
  catch (error) { if (error?.code === 'ENOENT') return null; throw error; }
}

async function leerSelectorActivable(ruta, selector) {
  let bytes;
  try {
    bytes = await leerArchivoRegularNoFollow(ruta);
  } catch (error) {
    if (error?.code === 'ENOENT') return null;
    throw error;
  }
  if (bytes.equals(SELECTOR_BOOTSTRAP_DESPLIEGUE)) return null;
  return selector.interpretar(bytes);
}

async function sincronizarArbolDirectorios(raiz) {
  const directorios = [];
  async function visitar(ruta) {
    for (const entrada of await fs.readdir(ruta, { withFileTypes: true })) {
      if (entrada.isDirectory()) await visitar(path.join(ruta, entrada.name));
    }
    directorios.push(ruta);
  }
  await visitar(raiz);
  for (const directorio of directorios) await sincronizarDirectorio(directorio);
}

async function sellarArbolInmutable(raiz) {
  async function sellar(ruta) {
    for (const entrada of await fs.readdir(ruta, { withFileTypes: true })) {
      const destino = path.join(ruta, entrada.name);
      if (entrada.isSymbolicLink()) throw new Error('No se puede sellar un enlace simbólico BIND.');
      if (entrada.isDirectory()) await sellar(destino);
      else if (entrada.isFile()) await fs.chmod(destino, 0o440);
      else throw new Error('No se puede sellar un tipo de artefacto BIND no regular.');
    }
    await fs.chmod(ruta, 0o550);
  }
  await sellar(raiz);
  await sincronizarArbolDirectorios(raiz);
}

async function retirarDirectorioGestionado(raiz) {
  async function habilitar(ruta) {
    await fs.chmod(ruta, 0o750);
    for (const entrada of await fs.readdir(ruta, { withFileTypes: true })) {
      if (entrada.isDirectory() && !entrada.isSymbolicLink()) await habilitar(path.join(ruta, entrada.name));
    }
  }
  await habilitar(raiz);
  await fs.rm(raiz, { recursive: true });
}

async function sincronizarDirectorio(ruta) {
  const handle = await fs.open(ruta, fsConstants.O_RDONLY | fsConstants.O_DIRECTORY | fsConstants.O_NOFOLLOW);
  try { await handle.sync(); } finally { await handle.close(); }
}

async function validarCadenaSinEnlaces(ruta, { exigirFinal }) {
  let actual = '/';
  for (const componente of ruta.slice(1).split('/')) {
    actual = path.join(actual, componente);
    const estado = await fs.lstat(actual);
    if (estado.isSymbolicLink()) throw new Error(`La ruta BIND ${actual} contiene un enlace simbólico.`);
  }
  const final = await fs.lstat(ruta);
  if (exigirFinal === 'directorio' && !final.isDirectory()) throw new Error(`${ruta} debe ser un directorio.`);
}

async function validarControlExistente(ruta) {
  try {
    const estado = await fs.lstat(ruta);
    if (estado.isSymbolicLink() || !estado.isFile()) throw new Error(`${ruta} debe ser archivo regular no symlink.`);
  } catch (error) { if (error?.code !== 'ENOENT') throw error; }
}

async function probarPrimitivasDirectorio(directorio) {
  const sufijo = `${process.pid}-${randomBytes(8).toString('hex')}`;
  const origen = path.join(directorio, `sentinelia-diagnostico-${sufijo}`);
  const destino = path.join(directorio, `sentinelia-diagnostico-renombrado-${sufijo}`);
  try {
    await escribirArchivoAbsolutoSeguro(origen, Buffer.from('sentinelia-bind-diagnostico-v1\n', 'ascii'));
    await fs.rename(origen, destino);
    await sincronizarDirectorio(directorio);
  } finally {
    await fs.rm(origen, { force: true }).catch(() => {});
    await fs.rm(destino, { force: true }).catch(() => {});
  }
}

async function leerMountpointsLinux() {
  let contenido;
  try { contenido = await fs.readFile('/proc/self/mountinfo', 'utf8'); }
  catch (error) { throw new Error(`No se pudo verificar mountpoints BIND: ${error.message}`); }
  const resultado = new Set();
  for (const linea of contenido.split('\n')) {
    const campos = linea.split(' ');
    if (campos.length >= 5) resultado.add(decodificarMountinfo(campos[4]));
  }
  return resultado;
}

function decodificarMountinfo(valor) {
  return valor.replace(/\\(040|011|012|134)/g, (_total, octal) =>
    String.fromCharCode(Number.parseInt(octal, 8))
  );
}

function estaEnDirectorioGeneracion(ruta, raiz) {
  if (!ruta.startsWith(`${raiz}/`)) return false;
  return /^generacion-[1-9][0-9]*(?:\/|$)/.test(path.relative(raiz, ruta).replaceAll('\\', '/'));
}

async function exigirAutoridad(validar) {
  if (await validar() !== true) throw new Error('El publicador perdió lease o fencing antes de escribir BIND.');
}

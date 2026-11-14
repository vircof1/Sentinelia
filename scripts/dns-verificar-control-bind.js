import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { AdaptadorComandosBindDns, ErrorComandoBindDns, SupervisorNamedBindDns } from '../paquetes/dns/src/AdaptadoresProcesoBindDns.js';
import { ConfiguracionDespliegueBindDns } from '../paquetes/dns/src/ConfiguracionDespliegueBindDns.js';
import { PreparadorArranqueBindDns } from '../paquetes/dns/src/PreparadorArranqueBindDns.js';
import { ProyeccionBindDeterministaDns } from '../paquetes/dns/src/ProyeccionBindDeterministaDns.js';
import { SelectorActivoBindDns } from '../paquetes/dns/src/SelectorActivoBindDns.js';
import { ServicioControlRecargaBindDns, RecargaBindNoObservada } from '../paquetes/dns/src/ServicioControlRecargaBindDns.js';
import { ValidadorCandidataBindDns } from '../paquetes/dns/src/ValidadorCandidataBindDns.js';
import { ValidadorGrafoIncludesBindDns } from '../paquetes/dns/src/ValidadorGrafoIncludesBindDns.js';

const base = await fs.mkdtemp(path.join(os.tmpdir(), 'sentinelia-bind-5l-'));
const rutas = {
  raiz: path.join(base, 'artefactos'),
  selector: path.join(base, 'selector.conf'),
  lock: path.join(base, 'publicacion.lock'),
  namedRaiz: path.join(base, 'named.conf'),
  intermedio: path.join(base, 'named.local.conf')
};

function configuracionValida(extra = {}) {
  return new ConfiguracionDespliegueBindDns({
    DNS_ACTIVO: 'true',
    BIND_RAIZ_ARTEFACTOS: rutas.raiz,
    BIND_SELECTOR_ACTIVO: rutas.selector,
    BIND_LOCK_FILE: rutas.lock,
    BIND_NAMED_CONF_ACTIVO: rutas.namedRaiz,
    BIND_NAMED_EXECUTABLE: '/usr/bin/true',
    BIND_NAMED_ARGUMENTOS_JSON: '["--trace-warnings"]',
    BIND_RNDC_EXECUTABLE: '/usr/bin/true',
    BIND_RNDC_ARGUMENTOS_JSON: '["-s","127.0.0.1","-p","953"]',
    BIND_CHECKCONF_EXECUTABLE: '/usr/bin/true',
    BIND_CHECKZONE_EXECUTABLE: '/usr/bin/true',
    ...extra
  });
}

async function verificarConfiguracion(configuracion) {
  assert.equal((await configuracion.validarSistema()).valida, true);
  assert.deepEqual(configuracion.argumentosNamedFinales(), [
    '--trace-warnings', '-g', '-c', rutas.namedRaiz
  ]);
  assert.deepEqual(configuracion.argumentosRndcReload(), [
    '-s', '127.0.0.1', '-p', '953', 'reload'
  ]);
  assert.throws(() => configuracionValida({ DNS_COMANDO_RECARGA: '' }), /obsoleta/);
  assert.throws(() => configuracionValida({ BIND_NAMED_ARGUMENTOS_JSON: '["-c","otra"]' }), /alterar/);
  assert.throws(() => configuracionValida({ BIND_RNDC_ARGUMENTOS_JSON: '["stop"]' }), /opciones/);
  const conSecreto = configuracionValida({
    BIND_RNDC_ARGUMENTOS_JSON: '["-y","hmac-sha256:clave:secreto-real"]'
  });
  assert.ok(conSecreto.argumentosRndcReload().includes('hmac-sha256:clave:secreto-real'));
  assert.ok(!JSON.stringify(conSecreto).includes('secreto-real'));
  let argumentosEjecutados;
  const resultadoSecreto = await new AdaptadorComandosBindDns({
    configuracion: conSecreto,
    ejecutarArchivo: async (_ejecutable, argumentos) => {
      argumentosEjecutados = argumentos;
      return { stdout: '', stderr: '' };
    }
  }).recargar();
  assert.ok(argumentosEjecutados.includes('hmac-sha256:clave:secreto-real'));
  assert.ok(!JSON.stringify(resultadoSecreto).includes('secreto-real'));
  await assert.rejects(
    () => configuracionValida({ BIND_NAMED_EXECUTABLE: '/usr/bin/sh' }).validarSistema(),
    /enlace simbólico|intérprete/
  );
  assert.equal(new ConfiguracionDespliegueBindDns({ DNS_ACTIVO: 'false' }).activo, false);
}

async function verificarGrafo() {
  const valido = new ValidadorGrafoIncludesBindDns({
    rutaRaiz: rutas.namedRaiz,
    rutaSelector: rutas.selector
  });
  assert.equal((await valido.validar()).referenciasSelector, 1);
  await fs.writeFile(rutas.intermedio, `include "${rutas.selector}";\ninclude "${rutas.selector}";\n`);
  await assert.rejects(() => valido.validar(), /exactamente una vez/);
  await fs.writeFile(rutas.intermedio, 'include "relativo.conf";\n');
  await assert.rejects(() => valido.validar(), /absoluta canónica/);
  await fs.writeFile(rutas.intermedio, `include "${rutas.namedRaiz}";\n`);
  await assert.rejects(() => valido.validar(), /ciclo/);
  const enlace = path.join(base, 'include-enlace.conf');
  await fs.symlink(rutas.selector, enlace);
  await fs.writeFile(rutas.intermedio, `include "${enlace}";\n`);
  await assert.rejects(() => valido.validar(), /enlace simbólico/);
  await fs.unlink(enlace);
  await fs.writeFile(rutas.intermedio, `include "${rutas.selector}";\n`);
}

async function verificarProcesos(configuracion) {
  const llamadas = [];
  const comandos = new AdaptadorComandosBindDns({
    configuracion,
    ejecutarArchivo: async (ejecutable, argumentos, opciones) => {
      llamadas.push({ ejecutable, argumentos, opciones });
      return { stdout: 'ok token=oculto', stderr: '' };
    }
  });
  const saneada = await comandos.validarConfiguracionActiva();
  assert.ok(!saneada.stdout.includes('oculto'));
  await comandos.validarConfiguracionCandidata(rutas.namedRaiz);
  await comandos.validarZona('example.test', rutas.namedRaiz);
  await comandos.recargar();
  assert.deepEqual(llamadas.map(({ argumentos }) => argumentos), [
    [rutas.namedRaiz],
    [rutas.namedRaiz],
    ['example.test', rutas.namedRaiz],
    ['-s', '127.0.0.1', '-p', '953', 'reload']
  ]);
  assert.ok(llamadas.every(({ opciones }) => opciones.shell === false));
  const comandoIncierto = new AdaptadorComandosBindDns({
    configuracion,
    ejecutarArchivo: async () => { const error = new Error('timeout'); error.killed = true; throw error; }
  });
  await assert.rejects(
    () => comandoIncierto.recargar(),
    (error) => error instanceof ErrorComandoBindDns && error.incierto
  );

  let hijoCreado;
  const supervisor = new SupervisorNamedBindDns({
    configuracion,
    crearProceso(ejecutable, argumentos, opciones) {
      hijoCreado = new HijoEspia({ ejecutable, argumentos, opciones });
      return hijoCreado;
    },
    graciaMs: 100
  });
  const iniciado = supervisor.iniciar();
  assert.equal(iniciado.pid, 4242);
  assert.deepEqual(hijoCreado.argumentos, configuracion.argumentosNamedFinales());
  assert.equal(hijoCreado.opciones.shell, false);
  assert.equal(supervisor.estaVivo(), true);
  await supervisor.detener();
  assert.deepEqual(hijoCreado.senales, ['SIGTERM']);
  assert.equal(supervisor.estaVivo(), false);

  let salidaInesperada;
  const supervisorCaida = new SupervisorNamedBindDns({
    configuracion,
    crearProceso: (_ejecutable, argumentos, opciones) => new HijoEspia({
      ejecutable: configuracion.namedExecutable, argumentos, opciones
    })
  });
  supervisorCaida.on('salida', (salida) => { salidaInesperada = salida; });
  supervisorCaida.iniciar();
  supervisorCaida.hijo.exitCode = 1;
  supervisorCaida.hijo.emit('exit', 1, null);
  assert.equal(salidaInesperada.inesperada, true);
}

async function verificarCandidata(configuracion) {
  const staging = path.join(base, 'staging-fixture');
  await fs.mkdir(path.join(staging, 'zonas'), { recursive: true });
  const zonefile = Buffer.from('$TTL 300\n');
  const zonesConf = Buffer.from(
    'zone "example.test" IN {\n  type master;\n  file "zonas/db.example.test.zone";\n};\n'
  );
  await fs.writeFile(path.join(staging, 'sentinelia-named.conf'), 'include "zonas/sentinelia-zones.conf";\n');
  await fs.writeFile(path.join(staging, 'zonas/sentinelia-zones.conf'), zonesConf);
  await fs.writeFile(path.join(staging, 'zonas/db.example.test.zone'), zonefile);
  const proyeccion = await new ProyeccionBindDeterministaDns({ validarDestino: () => true }).materializar([
    { ruta: 'sentinelia-named.conf', contenido: Buffer.from('include "zonas/sentinelia-zones.conf";\n') },
    { ruta: 'zonas/sentinelia-zones.conf', contenido: zonesConf },
    { ruta: 'zonas/db.example.test.zone', contenido: zonefile }
  ]);
  const llamadas = [];
  const validador = new ValidadorCandidataBindDns({
    comandos: {
      async validarZona(...args) { llamadas.push(['zona', ...args]); },
      async validarConfiguracionCandidata(...args) { llamadas.push(['conf', ...args]); }
    }
  });
  assert.equal((await validador.validar({ directorioStaging: staging, proyeccion })).zonasValidadas, 1);
  assert.deepEqual(llamadas, [
    ['zona', 'example.test', path.join(staging, 'zonas/db.example.test.zone')],
    ['conf', path.join(staging, 'sentinelia-named.conf')]
  ]);

  const zonesConfAbsoluto = Buffer.from(
    `zone "example.test" IN {\n  type master;\n  file "${path.join(staging, 'zonas/db.example.test.zone')}";\n};\n`
  );
  const proyeccionAbsoluta = await new ProyeccionBindDeterministaDns({
    validarDestino: () => true
  }).materializar([
    { ruta: 'sentinelia-named.conf', contenido: Buffer.from('include "zonas/sentinelia-zones.conf";\n') },
    { ruta: 'zonas/sentinelia-zones.conf', contenido: zonesConfAbsoluto },
    { ruta: 'zonas/db.example.test.zone', contenido: zonefile }
  ]);
  assert.equal((await validador.validar({
    directorioStaging: staging,
    proyeccion: proyeccionAbsoluta
  })).zonasValidadas, 1);
}

async function verificarRecarga(configuracion) {
  const hash = '22'.repeat(32);
  const lease = { operacionId: '9', instanciaId: 'fixture', leaseToken: Buffer.alloc(32), fencingToken: '3' };
  const operacion = {
    generacionDns: '9', estado: 'efecto_iniciado', efectoPosible: true,
    generacionLeida: '9', perfilProyeccion: 'sentinelia-bind-proyeccion-v1', hashProyeccion: hash
  };
  const fotografia = {
    generacionLeida: '9',
    proyeccion: { perfilProyeccion: operacion.perfilProyeccion, hashProyeccion: Buffer.from(hash, 'hex') }
  };
  const llamadas = [];
  const selector = { generacionDns: '9', hashProyeccion: hash };
  const dependencias = {
    configuracion,
    comandos: {
      async validarConfiguracionActiva() { llamadas.push('checkconf-activo'); },
      async recargar() { llamadas.push('rndc-reload'); return { argumentos: ['reload'] }; }
    },
    supervisor: { estaVivo: () => true, usaConfiguracion: () => true },
    validadorCandidata: { async validar() { llamadas.push('candidata'); } },
    validadorGrafo: { async validar() { llamadas.push('grafo'); } },
    activador: {
      rutaDirectorioGeneracion: (generacion) => `${rutas.raiz}/generacion-${generacion}`,
      async leerSelectorActivo() { llamadas.push('selector'); return selector; }
    },
    repositorioCoordinacion: { async verificarAutoridadConLease() { llamadas.push('fencing'); return true; } },
    coordinador: {
      async avanzar(_lease, peticion) { llamadas.push(peticion.transicion); return { operacion: { estado: peticion.transicion } }; },
      async consolidar(_lease, peticion) { llamadas.push('consolidar'); return peticion; }
    }
  };
  const servicio = new ServicioControlRecargaBindDns(dependencias);
  const observada = await servicio.observarRecarga({ lease, operacion, fotografia });
  assert.equal(observada.observada, true);
  assert.equal(observada.forzada, true);
  assert.deepEqual(llamadas, [
    'candidata', 'grafo', 'selector', 'checkconf-activo', 'rndc-reload', 'selector', 'fencing', 'recarga_observada'
  ]);
  const recuperada = { ...operacion, estado: 'recuperacion_pendiente' };
  await servicio.observarRecarga({ lease, operacion: recuperada, fotografia });
  assert.equal(llamadas.filter((item) => item === 'rndc-reload').length, 2);

  const fallos = [];
  const servicioIncierto = new ServicioControlRecargaBindDns({
    ...dependencias,
    comandos: {
      validarConfiguracionActiva: async () => {},
      recargar: async () => { const error = new Error('timeout secreto=oculto'); error.codigo = 'bind_resultado_incierto'; throw error; }
    },
    coordinador: {
      async avanzar(_lease, peticion) { fallos.push(peticion); return { operacion: {} }; },
      consolidar: async () => {}
    }
  });
  await assert.rejects(
    () => servicioIncierto.observarRecarga({ lease, operacion, fotografia }),
    (error) => error instanceof RecargaBindNoObservada && error.recuperable
  );
  assert.equal(fallos.at(-1).transicion, 'recuperacion_pendiente');

  const selectores = [selector, { generacionDns: '10', hashProyeccion: '33'.repeat(32) }];
  const cruces = [];
  const servicioCruzado = new ServicioControlRecargaBindDns({
    ...dependencias,
    activador: {
      rutaDirectorioGeneracion: dependencias.activador.rutaDirectorioGeneracion,
      async leerSelectorActivo() { return selectores.shift(); }
    },
    coordinador: {
      async avanzar(_lease, peticion) { cruces.push(peticion); return { operacion: {} }; },
      consolidar: async () => {}
    }
  });
  await assert.rejects(() => servicioCruzado.observarRecarga({ lease, operacion, fotografia }), RecargaBindNoObservada);
  assert.equal(cruces.at(-1).transicion, 'recuperacion_pendiente');

  let comprobacionesVida = 0;
  const caidas = [];
  const servicioProcesoCaido = new ServicioControlRecargaBindDns({
    ...dependencias,
    supervisor: {
      estaVivo: () => (++comprobacionesVida === 1),
      usaConfiguracion: () => true
    },
    coordinador: {
      async avanzar(_lease, peticion) { caidas.push(peticion); return { operacion: {} }; },
      consolidar: async () => {}
    }
  });
  await assert.rejects(() => servicioProcesoCaido.observarRecarga({ lease, operacion, fotografia }), RecargaBindNoObservada);
  assert.equal(caidas.at(-1).transicion, 'recuperacion_pendiente');

  const sinFencing = [];
  const servicioSinFencing = new ServicioControlRecargaBindDns({
    ...dependencias,
    repositorioCoordinacion: { verificarAutoridadConLease: async () => false },
    coordinador: {
      async avanzar(_lease, peticion) { sinFencing.push(peticion); return { operacion: {} }; },
      consolidar: async () => {}
    }
  });
  await assert.rejects(() => servicioSinFencing.observarRecarga({ lease, operacion, fotografia }), RecargaBindNoObservada);
  assert.equal(sinFencing.at(-1).transicion, 'recuperacion_pendiente');

  const confirmada = { ...operacion, estado: 'recarga_confirmada', recargaConfirmadaEnUtc: new Date() };
  assert.deepEqual(
    await servicio.consolidarConfirmada({ lease, operacion: confirmada, resultado: { zonas: '1' } }),
    { resultado: { zonas: '1' } }
  );
}

async function verificarPreparadorArranque(configuracion) {
  const orden = [];
  const supervisor = new EventEmitter();
  supervisor.iniciar = () => { orden.push('named'); return { pid: 88 }; };
  let selectorPreparado = false;
  const preparador = new PreparadorArranqueBindDns({
    configuracion: { ...configuracion, validarSistema: async () => orden.push('sistema') },
    diagnosticoAlmacenamiento: { verificar: async () => orden.push('almacenamiento') },
    activador: {
      async clasificarSelectorActivo() { return selectorPreparado ? 'v1' : 'legacy'; },
      async leerSelectorActivo() {
        return { generacionDns: '7', hashProyeccion: '11'.repeat(32) };
      }
    },
    validadorGrafo: { validar: async () => orden.push('grafo') },
    comandos: { validarConfiguracionActiva: async () => orden.push('checkconf') },
    supervisor,
    async prepararSelectorDurable({ estadoAnterior }) {
      orden.push(`preparar:${estadoAnterior}`);
      selectorPreparado = true;
    }
  });
  const inicio = await preparador.prepararEIniciar();
  assert.equal(inicio.estadoAnterior, 'legacy');
  assert.deepEqual(orden, [
    'sistema', 'almacenamiento', 'preparar:legacy', 'grafo', 'checkconf', 'named'
  ]);
  assert.equal(inicio.salud.readinessDns, false);
  preparador.marcarRecargaObservada();
  preparador.marcarPortalDisponible();
  assert.equal(preparador.salud.obtener().readinessDns, true);
  supervisor.emit('salida', { inesperada: true });
  assert.equal(preparador.salud.obtener().livenessDns, false);

  const desactivado = new PreparadorArranqueBindDns({
    configuracion: new ConfiguracionDespliegueBindDns({ DNS_ACTIVO: 'false' }),
    prepararSelectorDurable: async () => assert.fail('DNS desactivado no prepara selector.')
  });
  assert.equal((await desactivado.prepararEIniciar()).dnsActivo, false);
}

class HijoEspia extends EventEmitter {
  constructor({ ejecutable, argumentos, opciones }) {
    super();
    Object.assign(this, { ejecutable, argumentos, opciones, pid: 4242, exitCode: null, signalCode: null });
    this.stdout = new EventEmitter();
    this.stderr = new EventEmitter();
    this.senales = [];
  }

  kill(senal) {
    this.senales.push(senal);
    this.signalCode = senal;
    queueMicrotask(() => this.emit('exit', null, senal));
    return true;
  }
}

try {
  await fs.mkdir(rutas.raiz);
  await fs.writeFile(rutas.namedRaiz, `include "${rutas.intermedio}";\n`);
  await fs.writeFile(rutas.intermedio, `include "${rutas.selector}";\n`);
  await fs.writeFile(rutas.selector, new SelectorActivoBindDns({ raizArtefactos: rutas.raiz }).construir({
    generacionDns: '7', hashProyeccion: '11'.repeat(32)
  }));
  const configuracion = configuracionValida();
  await verificarConfiguracion(configuracion);
  await verificarGrafo();
  await verificarProcesos(configuracion);
  await verificarCandidata(configuracion);
  await verificarRecarga(configuracion);
  await verificarPreparadorArranque(configuracion);
  console.log('[dns] OK 5.21.5l: config=BIND_* legacy=no graph=selector-unico procesos=directos reload=literal supervisor=pid recarga=forzada fencing=si recuperacion=si bind=spy shell=no');
} finally {
  await fs.rm(base, { recursive: true, force: true });
}

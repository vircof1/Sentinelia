import assert from 'node:assert/strict';
import {
  CoordinadorOperacionesDurables,
  LeaseOperacionDurablePerdido
} from '../paquetes/coordinacion-durable/src/CoordinadorOperacionesDurables.js';
import { ErrorActivacionArtefactosBind } from '../paquetes/dns/src/ActivadorArtefactosBindDns.js';
import { PublicadorCoordinadoBindDns } from '../paquetes/dns/src/PublicadorCoordinadoBindDns.js';

async function verificarActivacionCoordinada() {
  const trazas = [];
  const repositorio = new RepositorioDurableFixture({ trazas });
  const coordinador = new CoordinadorOperacionesDurables({
    repositorio,
    instanciaId: 'runtime-dns-test',
    ttlSegundos: 30
  });
  const fotografia = crearFotografia({ generacion: '7' });
  const publicador = new PublicadorCoordinadoBindDns({
    coordinador,
    servicioFotografia: {
      async prepararEfecto({ lease, operacion }) {
        trazas.push('fotografia');
        assert.equal(lease.operacionId, '7');
        assert.equal(operacion.estado, 'pendiente');
        const avance = await coordinador.avanzar(lease, {
          transicion: 'efecto_iniciado',
          datos: {
            generacionLeida: '7',
            perfilProyeccion: fotografia.proyeccion.perfilProyeccion,
            hashProyeccion: fotografia.proyeccion.hashProyeccion
          }
        });
        return { fotografia, operacion: avance.operacion };
      }
    },
    seccionCritica: new SeccionFixture({ trazas }),
    activador: new ActivadorFixture({ trazas }),
    repositorioCoordinacion: repositorio,
    leaseTtlSegundos: 30,
    graciaLimpiezaMs: 60_000,
    limiteLimpieza: 10
  });

  const resultado = await publicador.publicarSiguiente();
  assert.equal(resultado.ok, true);
  assert.equal(resultado.operacion.estado, 'efecto_iniciado');
  assert.equal(resultado.resumen.zonas, '1');
  assert.equal(resultado.resumen.artefactos, '2');
  assert.equal(resultado.resumen.cambios, '1');
  assert.equal(repositorio.operacion.estado, 'efecto_iniciado');
  assert.equal(repositorio.operacion.leaseVigente, true);
  assert.equal(repositorio.operacion.instanciaId, 'runtime-dns-test');
  assert.equal(typeof repositorio.operacion.leaseToken, 'string');
  assert.deepEqual(trazas, [
    'reclamar',
    'fotografia',
    'efecto_iniciado',
    'bloqueo:validar:antes_sql',
    'autoridad',
    'bloqueo:validar:antes_fs',
    'autoridad',
    'bloqueo:trabajo',
    'autoridad',
    'activar:7',
    'limpiar:7'
  ]);
}

async function verificarDivergenciaSinFilesystem() {
  const trazas = [];
  const repositorio = new RepositorioDurableFixture({ trazas });
  const coordinador = new CoordinadorOperacionesDurables({
    repositorio,
    instanciaId: 'runtime-dns-test',
    ttlSegundos: 30
  });
  const publicador = new PublicadorCoordinadoBindDns({
    coordinador,
    servicioFotografia: {
      async prepararEfecto() {
        trazas.push('fotografia');
        return {
          divergente: true,
          sucesora: { creada: true, operacion: { generacionDns: '8' } },
          operacion: repositorio.operacion
        };
      }
    },
    seccionCritica: new SeccionFixture({ trazas }),
    activador: new ActivadorFixture({ trazas }),
    repositorioCoordinacion: repositorio
  });
  const resultado = await publicador.publicarSiguiente();
  assert.equal(resultado.ok, false);
  assert.equal(resultado.recuperable, true);
  assert.equal(resultado.motivo, 'proyeccion_divergente');
  assert.deepEqual(trazas, ['reclamar', 'fotografia']);
}

async function verificarPerdidaAutoridad() {
  const trazas = [];
  const repositorio = new RepositorioDurableFixture({ trazas });
  const coordinador = new CoordinadorOperacionesDurables({
    repositorio,
    instanciaId: 'runtime-dns-test',
    ttlSegundos: 30
  });
  const fotografia = crearFotografia({ generacion: '7' });
  let invalidar = false;
  const publicador = new PublicadorCoordinadoBindDns({
    coordinador,
    servicioFotografia: {
      async prepararEfecto({ lease }) {
        const avance = await coordinador.avanzar(lease, {
          transicion: 'efecto_iniciado',
          datos: {
            generacionLeida: '7',
            perfilProyeccion: fotografia.proyeccion.perfilProyeccion,
            hashProyeccion: fotografia.proyeccion.hashProyeccion
          }
        });
        invalidar = true;
        return { fotografia, operacion: avance.operacion };
      }
    },
    seccionCritica: new SeccionFixture({ trazas }),
    activador: new ActivadorFixture({ trazas }),
    repositorioCoordinacion: {
      async verificarAutoridadConLease(datos) {
        return !invalidar && repositorio.verificarAutoridadConLease(datos);
      }
    }
  });
  const resultado = await publicador.publicarSiguiente();
  assert.equal(resultado.ok, false);
  assert.equal(resultado.recuperable, true);
  assert.equal(resultado.operacion.estado, 'recuperacion_pendiente');
  assert.equal(trazas.includes('activar:7'), false);
}

async function verificarFalloTrasFronteraEfecto() {
  const trazas = [];
  const repositorio = new RepositorioDurableFixture({ trazas });
  const coordinador = new CoordinadorOperacionesDurables({
    repositorio,
    instanciaId: 'runtime-dns-test',
    ttlSegundos: 30
  });
  const fotografia = crearFotografia({ generacion: '7' });
  const publicador = new PublicadorCoordinadoBindDns({
    coordinador,
    servicioFotografia: {
      async prepararEfecto({ lease }) {
        const avance = await coordinador.avanzar(lease, {
          transicion: 'efecto_iniciado',
          datos: {
            generacionLeida: '7',
            perfilProyeccion: fotografia.proyeccion.perfilProyeccion,
            hashProyeccion: fotografia.proyeccion.hashProyeccion
          }
        });
        return { fotografia, operacion: avance.operacion };
      }
    },
    seccionCritica: new SeccionFixture({ trazas }),
    activador: new ActivadorFixture({
      trazas,
      async activar() {
        throw new ErrorActivacionArtefactosBind(
          new Error('caida_despues_selector'),
          { selectorReemplazado: true }
        );
      }
    }),
    repositorioCoordinacion: repositorio
  });
  const resultado = await publicador.publicarSiguiente();
  assert.equal(resultado.ok, false);
  assert.equal(resultado.recuperable, true);
  assert.equal(resultado.operacion.estado, 'recuperacion_pendiente');
  assert.equal(repositorio.operacion.estado, 'recuperacion_pendiente');
  assert.equal(trazas.includes('recuperacion_pendiente'), true);
}

class RepositorioDurableFixture {
  constructor({ trazas }) {
    this.trazas = trazas;
    this.operacion = {
      generacionDns: '7',
      estado: 'pendiente',
      efectoPosible: false,
      generacionLeida: null,
      perfilProyeccion: null,
      hashProyeccion: null,
      fencingToken: '3',
      intentos: 0,
      leaseVigente: false,
      instanciaId: null,
      leaseToken: null
    };
  }

  async reclamarSiguiente({ instanciaId, leaseToken }) {
    this.trazas.push('reclamar');
    if (this.operacion.leaseVigente) return null;
    this.operacion.instanciaId = instanciaId;
    this.operacion.leaseToken = Buffer.from(leaseToken).toString('hex');
    this.operacion.leaseVigente = true;
    this.operacion.intentos += 1;
    return {
      operacionId: this.operacion.generacionDns,
      fencingToken: this.operacion.fencingToken,
      intentos: this.operacion.intentos,
      operacion: { ...this.operacion }
    };
  }

  async renovarLease() {
    return { actualizada: true };
  }

  async avanzarConLease(parametros) {
    this.#exigirLease(parametros);
    if (parametros.transicion === 'efecto_iniciado') {
      this.trazas.push('efecto_iniciado');
      this.operacion.estado = 'efecto_iniciado';
      this.operacion.efectoPosible = true;
      this.operacion.generacionLeida = parametros.datos.generacionLeida;
      this.operacion.perfilProyeccion = parametros.datos.perfilProyeccion;
      this.operacion.hashProyeccion = Buffer.from(parametros.datos.hashProyeccion).toString('hex');
    } else if (parametros.transicion === 'recuperacion_pendiente') {
      this.trazas.push('recuperacion_pendiente');
      this.operacion.estado = 'recuperacion_pendiente';
      this.operacion.leaseVigente = false;
      this.operacion.instanciaId = null;
      this.operacion.leaseToken = null;
    } else {
      throw new Error(`Transición fixture no soportada: ${parametros.transicion}`);
    }
    return { actualizada: true, operacion: { ...this.operacion } };
  }

  async consolidarConLease() {
    return { actualizada: true, operacion: { ...this.operacion } };
  }

  async registrarFalloConLease(parametros) {
    this.#exigirLease(parametros);
    this.operacion.estado = 'pendiente';
    this.operacion.leaseVigente = false;
    return { actualizada: true, operacion: { ...this.operacion } };
  }

  async verificarAutoridadConLease(datos) {
    this.trazas.push('autoridad');
    return this.operacion.leaseVigente &&
      this.operacion.instanciaId === datos.instanciaId &&
      this.operacion.leaseToken === tokenHex(datos.leaseToken) &&
      this.operacion.fencingToken === String(datos.fencingToken);
  }

  #exigirLease(parametros) {
    if (!this.operacion.leaseVigente ||
        this.operacion.instanciaId !== parametros.instanciaId ||
        this.operacion.leaseToken !== tokenHex(parametros.leaseToken) ||
        this.operacion.fencingToken !== String(parametros.fencingToken)) {
      throw new LeaseOperacionDurablePerdido();
    }
  }
}

class SeccionFixture {
  constructor({ trazas }) {
    this.trazas = trazas;
  }

  async ejecutar({ validarAutoridad, trabajo }) {
    this.trazas.push('bloqueo:validar:antes_sql');
    await exigirAutoridadFixture(validarAutoridad);
    this.trazas.push('bloqueo:validar:antes_fs');
    await exigirAutoridadFixture(validarAutoridad);
    this.trazas.push('bloqueo:trabajo');
    return trabajo();
  }
}

class ActivadorFixture {
  constructor({ trazas, activar = null }) {
    this.trazas = trazas;
    this.activarImpl = activar;
  }

  async activar({ generacionDns }) {
    this.trazas.push(`activar:${generacionDns}`);
    if (this.activarImpl) return this.activarImpl({ generacionDns });
    return Object.freeze({
      activada: true,
      adoptada: false,
      selector: { generacionDns }
    });
  }

  async limpiar({ generacionesProtegidas }) {
    this.trazas.push(`limpiar:${generacionesProtegidas.join(',')}`);
    return Object.freeze({ eliminadas: 0 });
  }
}

function crearFotografia({ generacion }) {
  const hash = Buffer.alloc(32, 0x21);
  return Object.freeze({
    generacionLeida: generacion,
    catalogo: Object.freeze({ zonas: Object.freeze([{ id: 1 }]) }),
    proyeccion: Object.freeze({
      perfilProyeccion: 'sentinelia-bind-proyeccion-v1',
      hashProyeccion: hash,
      listarArtefactos: () => [
        Object.freeze({ ruta: 'sentinelia-named.conf', contenido: Buffer.from('named') }),
        Object.freeze({ ruta: 'zonas/sentinelia-zones.conf', contenido: Buffer.from('zones') })
      ]
    })
  });
}

function tokenHex(valor) {
  if (Buffer.isBuffer(valor)) return Buffer.from(valor).toString('hex');
  const texto = String(valor || '');
  if (/^[0-9a-f]{64}$/i.test(texto)) return texto.toLowerCase();
  return Buffer.from(texto).toString('hex');
}

async function exigirAutoridadFixture(validarAutoridad) {
  if (await validarAutoridad() !== true) {
    throw new Error('El publicador perdió lease o fencing bajo los bloqueos externos.');
  }
}

await verificarActivacionCoordinada();
await verificarDivergenciaSinFilesystem();
await verificarPerdidaAutoridad();
await verificarFalloTrasFronteraEfecto();

console.log('[dns] OK 5.21.11e: publicador=lease_global fencing=vivo fotografia=congelada seccion=sql_fs selector=atomico limpieza=protegida recuperacion=sin_mezcla bind=no');

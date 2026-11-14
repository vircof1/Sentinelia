import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  ReglaDerivacionTelemetria,
  RevisionReglaDerivacionTelemetria
} from '../paquetes/agentes/src/EventosDerivadosTelemetriaAgentes.js';
import {
  ServicioAdministracionReglasDerivacionTelemetria
} from '../paquetes/agentes/src/ServicioAdministracionReglasDerivacionTelemetria.js';

const rutaServicio = new URL(
  '../paquetes/agentes/src/ServicioAdministracionReglasDerivacionTelemetria.js',
  import.meta.url
);
const rutaRepositorio = new URL(
  '../paquetes/agentes/src/RepositorioReglasDerivacionTelemetria.js',
  import.meta.url
);

async function main() {
  await verificarLecturasPermisosYScope();
  await verificarCreacionDesdeCatalogo();
  await verificarRevisionSinMutarObjetivo();
  await verificarActivacionSinBorrado();
  await verificarContratoEstructural();

  console.log(
    '[agentes-telemetria] OK administración y autorización verificadas hasta 5.20a.9'
  );
}

async function verificarLecturasPermisosYScope() {
  const entorno = crearEntorno();
  const lectura = await entorno.servicio.listarSenalesCatalogadas(
    contextoSitio({ verAgentes: true }),
    7
  );

  assert.equal(lectura.agente.id, 7);
  assert.equal(lectura.senales.length, 4);
  assert.equal(lectura.senales[0].unidadSoloLectura, true);
  assert.equal(lectura.senales[0].admiteCondicionValor, true);
  assert.equal(lectura.senales[1].tipoDato, 'json');
  assert.equal(lectura.senales[1].admiteCondicionValor, false);
  assert.equal(lectura.senales[1].admiteCondicionCalidad, true);
  assert.equal(lectura.senales[2].tipoDato, 'duracion');
  assert.equal(lectura.senales[2].admiteCondicionValor, true);
  assert.equal(lectura.senales[2].admiteCondicionCalidad, true);
  assert.equal(lectura.senales[3].tipoDato, 'momento_utc');
  assert.equal(lectura.senales[3].admiteCondicionValor, true);
  assert.equal(lectura.senales[3].admiteCondicionCalidad, true);
  assert.ok(Object.isFrozen(lectura));
  assert.ok(Object.isFrozen(lectura.senales));

  const reglas = await entorno.servicio.listarReglasPorAgente(
    contextoSitio({ verAgentes: true }),
    7
  );
  assert.equal(reglas.reglas.length, 1);
  assert.equal(reglas.reglas[0].senal.id, 23);

  await assert.rejects(
    () => entorno.servicio.listarReglasPorAgente(contextoSitio({}), 7),
    /permiso para ver agentes/
  );
  await assert.rejects(
    () => entorno.servicio.listarReglasPorAgente(
      contextoSitio({ verAgentes: true }, { sitioId: 99 }),
      7
    ),
    /dentro de tu alcance/
  );
  const portal = await entorno.servicio.listarReglasPorAgente(
    contextoPortal({ verAgentes: true }),
    7
  );
  assert.equal(portal.reglas.length, 1);
}

async function verificarCreacionDesdeCatalogo() {
  const entorno = crearEntorno();
  const contexto = contextoSitio({ modificarAgentes: true });
  const creada = await entorno.servicio.crearRegla(contexto, {
    agenteId: 7,
    senalId: 23,
    revision: datosRevision()
  });

  assert.equal(entorno.repositorioReglas.creaciones.length, 1);
  const orden = entorno.repositorioReglas.creaciones[0];
  assert.deepEqual(
    {
      agenteId: orden.agenteId,
      senalId: orden.senalId,
      tenantId: orden.tenantId,
      empresaId: orden.empresaId,
      sitioId: orden.sitioId,
      estado: orden.estado
    },
    {
      agenteId: 7,
      senalId: 23,
      tenantId: 1,
      empresaId: 2,
      sitioId: 3,
      estado: 'activa'
    }
  );
  assert.equal(orden.revision.condicion.configuracion.unidad, 'ºC');
  assert.equal(creada.senal.unidad, 'ºC');
  assert.equal(creada.estado, 'activa');

  await assert.rejects(
    () => entorno.servicio.crearRegla(contexto, {
      agenteId: 7,
      senalId: 23,
      tenantId: 999,
      revision: datosRevision()
    }),
    /campos no admitidos.*tenantId/
  );
  await assert.rejects(
    () => entorno.servicio.crearRegla(contexto, {
      agenteId: 7,
      senalId: 24,
      revision: datosRevision()
    }),
    /no pertenece al agente/
  );
  await assert.rejects(
    () => entorno.servicio.crearRegla(
      contextoSitio({ verAgentes: true }),
      { agenteId: 7, senalId: 23, revision: datosRevision() }
    ),
    /permiso para modificar agentes/
  );

  await assert.rejects(
    () => entorno.servicio.previsualizarCondicion(contexto, {
      agenteId: 7,
      senalId: 25,
      condicion: {
        tipo: 'json',
        operador: '=',
        valorEsperado: '{}'
      }
    }),
    /señales JSON/
  );
  const calidadJson = await entorno.servicio.previsualizarCondicion(
    contexto,
    {
      agenteId: 7,
      senalId: 25,
      condicion: {
        tipo: 'calidad',
        operador: '=',
        calidadEsperada: 'valida'
      }
    }
  );
  assert.equal(calidadJson.condicion.tipo, 'calidad');
  assert.equal(calidadJson.senal.admiteCondicionValor, false);
}

async function verificarRevisionSinMutarObjetivo() {
  const entorno = crearEntorno();
  const contexto = contextoSitio({ modificarAgentes: true });

  await assert.rejects(
    () => entorno.servicio.crearNuevaRevision(contexto, {
      reglaId: 31,
      senalId: 999,
      revision: datosRevision({ umbral: 90 })
    }),
    /campos no admitidos.*senalId/
  );
  await assert.rejects(
    () => entorno.servicio.crearNuevaRevision(contexto, {
      reglaId: 31,
      revision: {
        ...datosRevision({ umbral: 90 }),
        scope: { tenantId: 9, empresaId: 9, sitioId: 9 }
      }
    }),
    /revisión contiene campos no admitidos.*scope/
  );
  await assert.rejects(
    () => entorno.servicio.crearNuevaRevision(contexto, {
      reglaId: 31,
      revision: datosRevision({
        condicion: {
          tipo: 'numero',
          operador: '>',
          umbral: 90,
          unidad: 'K'
        }
      })
    }),
    /condición contiene campos no admitidos.*unidad/
  );

  const resultado = await entorno.servicio.crearNuevaRevision(contexto, {
    reglaId: 31,
    revision: datosRevision({ umbral: 90 })
  });
  assert.equal(entorno.repositorioReglas.revisionesCreadas.length, 1);
  const orden = entorno.repositorioReglas.revisionesCreadas[0];
  assert.equal(orden.reglaId, 31);
  assert.equal(orden.revision.condicion.configuracion.umbral, 90);
  assert.equal(orden.revision.condicion.configuracion.unidad, 'ºC');
  assert.equal(resultado.agenteId, 7);
  assert.equal(resultado.senalId, 23);
  assert.equal(resultado.revision.numero, 2);

  const revisiones = await entorno.servicio.listarRevisiones(
    contextoSitio({ verAgentes: true }),
    31
  );
  assert.equal(revisiones.revisiones.length, 2);
  await assert.rejects(
    () => entorno.servicio.listarRevisiones(
      contextoSitio({ verAgentes: true }, { sitioId: 99 }),
      31
    ),
    /regla solicitada dentro de tu alcance/
  );
}

async function verificarActivacionSinBorrado() {
  const entorno = crearEntorno();
  const contexto = contextoSitio({ modificarAgentes: true });

  const desactivada = await entorno.servicio.desactivarRegla(contexto, 31);
  assert.equal(desactivada.estado, 'deshabilitada');
  const activada = await entorno.servicio.activarRegla(contexto, 31);
  assert.equal(activada.estado, 'activa');
  const activadaDeNuevo = await entorno.servicio.activarRegla(contexto, 31);
  assert.equal(activadaDeNuevo.estado, 'activa');
  assert.deepEqual(
    entorno.repositorioReglas.cambiosEstado.map((cambio) => cambio.estado),
    ['deshabilitada', 'activa']
  );
  await assert.rejects(
    () => entorno.servicio.desactivarRegla(
      contextoSitio({ modificarAgentes: true }, { sitioId: 99 }),
      31
    ),
    /regla solicitada dentro de tu alcance/
  );
  assert.equal(typeof entorno.servicio.eliminarRegla, 'undefined');
}

async function verificarContratoEstructural() {
  const [servicio, repositorio] = await Promise.all([
    readFile(rutaServicio, 'utf8'),
    readFile(rutaRepositorio, 'utf8')
  ]);

  assert.ok(servicio.includes('PoliticaPermisosAgentes'));
  assert.ok(servicio.includes('assertPuedeVer'));
  assert.ok(servicio.includes('assertPuedeModificar'));
  assert.ok(servicio.includes('crearCondicionTipadaDerivacionTelemetria'));
  assert.equal(/express|req\.|res\./i.test(servicio), false);
  assert.equal(/eliminarRegla|borrarRegla|deleteRegla/i.test(servicio), false);
  assert.equal(/DELETE\s+FROM\s+reglas_derivacion_telemetria/i.test(repositorio), false);
  assert.ok(repositorio.includes('async listarPorAgente(agenteId)'));
  assert.ok(repositorio.includes('WHERE r.agente_id = ?'));
  assert.ok(repositorio.includes('ORDER BY r.fecha_creacion DESC, r.id DESC'));
}

function crearEntorno() {
  const agentes = new Map([
    [7, crearAgente({ id: 7, tenantId: 1, empresaId: 2, sitioId: 3 })],
    [8, crearAgente({ id: 8, tenantId: 1, empresaId: 2, sitioId: 4 })]
  ]);
  const senales = new Map([
    [23, crearSenal({ id: 23, agenteId: 7, tipoDato: 'numero', unidad: 'ºC' })],
    [24, crearSenal({ id: 24, agenteId: 8, tipoDato: 'numero', unidad: 'bar' })],
    [25, crearSenal({ id: 25, agenteId: 7, tipoDato: 'json', unidad: null })],
    [26, crearSenal({ id: 26, agenteId: 7, tipoDato: 'duracion', unidad: null })],
    [27, crearSenal({ id: 27, agenteId: 7, tipoDato: 'momento_utc', unidad: null })]
  ]);
  const repositorioReglas = new RepositorioReglasFalso({ senales });
  const servicio = new ServicioAdministracionReglasDerivacionTelemetria({
    repositorioAgentes: {
      async buscarPorId(id) {
        return agentes.get(Number(id)) || null;
      }
    },
    repositorioCatalogoSenales: {
      async buscarPorId(id) {
        return senales.get(Number(id)) || null;
      },
      async listarPorAgente(agenteId) {
        return [...senales.values()].filter(
          (senal) => senal.agenteId === Number(agenteId)
        );
      }
    },
    repositorioReglas
  });

  return { servicio, repositorioReglas };
}

class RepositorioReglasFalso {
  constructor({ senales }) {
    this.senales = senales;
    this.creaciones = [];
    this.revisionesCreadas = [];
    this.cambiosEstado = [];
    this.reglas = new Map();
    this.reglas.set(31, crearReglaPersistida({
      id: 31,
      estado: 'activa',
      revisionId: 101,
      numeroRevision: 1,
      revision: datosRevision()
    }));
    this.revisiones = new Map([[31, [this.reglas.get(31).revisionVigente]]]);
  }

  async listarPorAgente(agenteId) {
    return [...this.reglas.values()].filter(
      (regla) => regla.regla.agenteId === Number(agenteId)
    );
  }

  async buscarPorId(id) {
    return this.reglas.get(Number(id)) || null;
  }

  async crearConRevisionInicial(datos) {
    this.creaciones.push(datos);
    const creada = crearReglaPersistida({
      id: 32,
      estado: datos.estado,
      revisionId: 102,
      numeroRevision: 1,
      revision: datos.revision,
      condicionYaConstruida: true
    });
    this.reglas.set(32, creada);
    this.revisiones.set(32, [creada.revisionVigente]);
    return creada;
  }

  async crearNuevaRevision(datos) {
    this.revisionesCreadas.push(datos);
    const revision = crearRevision({
      id: 103,
      numero: 2,
      datos: datos.revision,
      condicionYaConstruida: true
    });
    this.revisiones.get(Number(datos.reglaId)).unshift(revision);
    return revision;
  }

  async listarRevisionesPorRegla(reglaId) {
    return this.revisiones.get(Number(reglaId)) || [];
  }

  async cambiarEstado(reglaId, estado) {
    this.cambiosEstado.push({ reglaId, estado });
    const actual = this.reglas.get(Number(reglaId));
    const reemplazo = crearReglaPersistida({
      id: actual.regla.id,
      estado,
      revisionId: actual.revisionVigente.id,
      numeroRevision: actual.revisionVigente.numero,
      revision: {
        nombre: actual.revisionVigente.nombre,
        descripcion: actual.revisionVigente.descripcion,
        severidadCalculada: actual.revisionVigente.severidadCalculada,
        mensajeOperativo: actual.revisionVigente.mensajeOperativo,
        metadatos: actual.revisionVigente.metadatos,
        condicion: actual.revisionVigente.condicion
      },
      condicionYaConstruida: true
    });
    this.reglas.set(Number(reglaId), reemplazo);
    return reemplazo;
  }
}

function crearReglaPersistida({
  id,
  estado,
  revisionId,
  numeroRevision,
  revision,
  condicionYaConstruida = false
}) {
  const regla = new ReglaDerivacionTelemetria({
    id,
    agente: { id: 7, tenantId: 1, empresaId: 2, sitioId: 3 },
    senal: { id: 23, agenteId: 7 },
    scope: { tenantId: 1, empresaId: 2, sitioId: 3 },
    estado,
    revisionVigenteId: revisionId
  });
  const revisionVigente = crearRevision({
    id: revisionId,
    reglaId: id,
    numero: numeroRevision,
    datos: revision,
    condicionYaConstruida
  });
  return {
    regla,
    revisionVigente,
    serializar() {
      return {
        ...regla.serializar(),
        revisionVigente: revisionVigente.serializar(),
        fechaCreacion: '2026-07-20T10:00:00.000Z',
        fechaActualizacion: '2026-07-20T10:00:00.000Z'
      };
    }
  };
}

function crearRevision({
  id,
  reglaId = 31,
  numero,
  datos,
  condicionYaConstruida
}) {
  return new RevisionReglaDerivacionTelemetria({
    id,
    reglaId,
    numero,
    condicion: condicionYaConstruida
      ? datos.condicion
      : {
          tipo: datos.condicion.tipo,
          version: 1,
          configuracion: {
            operador: datos.condicion.operador,
            umbral: datos.condicion.umbral,
            unidad: 'ºC'
          }
        },
    severidadCalculada: datos.severidadCalculada,
    mensajeOperativo: datos.mensajeOperativo,
    nombre: datos.nombre,
    descripcion: datos.descripcion,
    metadatos: datos.metadatos,
    vigenteDesdeUtc: `2026-07-20T10:00:00.00${numero}Z`
  });
}

function datosRevision({ umbral = 80, condicion = null } = {}) {
  return {
    nombre: 'Temperatura elevada',
    descripcion: 'Detecta una temperatura superior al límite.',
    severidadCalculada: 'advertencia',
    mensajeOperativo: 'Temperatura fuera del rango operativo.',
    metadatos: { origen: 'administracion' },
    condicion: condicion || {
      tipo: 'numero',
      operador: '>',
      umbral
    }
  };
}

function crearAgente(datos) {
  return {
    ...datos,
    serializar() {
      const { serializar: _serializar, ...serializada } = this;
      return serializada;
    }
  };
}

function crearSenal(datos) {
  return {
    ...datos,
    nombreHumano: `Señal ${datos.id}`,
    serializar() {
      const { serializar: _serializar, ...serializada } = this;
      return serializada;
    }
  };
}

function contextoSitio(permisos, scope = {}) {
  return {
    esOperadorSistema: false,
    nivelScope: 'sitio',
    tenantId: scope.tenantId ?? 1,
    empresaId: scope.empresaId ?? 2,
    sitioId: scope.sitioId ?? 3,
    permisos
  };
}

function contextoPortal(permisos) {
  return {
    esOperadorSistema: true,
    nivelScope: 'portal',
    tenantId: null,
    empresaId: null,
    sitioId: null,
    permisos
  };
}

main().catch((error) => {
  console.error('[agentes-telemetria] Error verificando administración 5.20a.9');
  console.error(error);
  process.exit(1);
});

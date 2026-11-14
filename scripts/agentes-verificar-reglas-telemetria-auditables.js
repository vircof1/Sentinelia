import assert from 'node:assert/strict';
import {
  ReglaDerivacionTelemetria,
  RevisionReglaDerivacionTelemetria
} from '../paquetes/agentes/src/EventosDerivadosTelemetriaAgentes.js';
import {
  ServicioAdministracionReglasDerivacionTelemetria
} from '../paquetes/agentes/src/ServicioAdministracionReglasDerivacionTelemetria.js';
import {
  validarEventoAuditableV1
} from '../paquetes/auditoria/src/ValidadorContratoAuditoria.js';

await verificarCreacionAuditable();
await verificarNuevaRevisionAuditable();
await verificarCambioEstadoAuditable();
await verificarEstadoNoopSinRuido();

console.log(
  '[agentes] OK: reglas_telemetria=auditable revision=inmutable estado=efectivo payload=allowlist'
);

async function verificarCreacionAuditable() {
  const entorno = crearEntorno();

  const creada = await entorno.servicio.crearRegla(contextoPortal(), {
    agenteId: 50,
    senalId: 9,
    revision: datosRevision({ umbral: 80, nombre: 'CPU elevada' })
  });

  assert.equal(creada.estado, 'activa');
  assert.deepEqual(entorno.traza, [
    'permiso',
    'begin',
    'sql:crear-regla',
    'audit:regla_telemetria.creada:principal',
    'commit'
  ]);
  const evento = entorno.auditoria.eventos[0];
  assert.equal(evento.tipo, 'regla_telemetria.creada');
  assert.deepEqual(evento.sujeto, { tipo: 'regla_telemetria', id: '70' });
  assert.deepEqual(evento.payload.antes, null);
  assert.equal(evento.payload.resultado, 'creado');
  assert.equal(evento.payload.despues.agenteId, '50');
  assert.equal(evento.payload.despues.senalId, '9');
  assert.equal(evento.payload.despues.estado, 'activa');
  assert.equal(evento.payload.despues.nombre, 'CPU elevada');
  assert.equal(evento.payload.despues.condicion.configuracion.unidad, '%');
  assert.deepEqual(evento.payload.despues.revision.metadatos, {
    origen: 'administracion',
    causaProbable: 'Carga sostenida.'
  });
  assert.equal(JSON.stringify(evento.payload).includes('detalleLibre'), false);
  assert.equal(JSON.stringify(evento.payload).includes('heartbeat'), false);
  assert.equal(JSON.stringify(evento.payload).includes('poll'), false);
  assert.equal(JSON.stringify(evento.payload).includes('trabajo'), false);
}

async function verificarNuevaRevisionAuditable() {
  const entorno = crearEntorno();

  const resultado = await entorno.servicio.crearNuevaRevision(contextoPortal(), {
    reglaId: 70,
    revision: datosRevision({ umbral: 90, nombre: 'CPU crítica' })
  });

  assert.equal(resultado.revision.numero, 2);
  assert.deepEqual(entorno.traza, [
    'permiso',
    'begin',
    'sql:crear-revision',
    'audit:regla_telemetria.revision_creada:principal',
    'commit'
  ]);
  const evento = entorno.auditoria.eventos[0];
  assert.equal(evento.tipo, 'regla_telemetria.revision_creada');
  assert.equal(evento.payload.resultado, 'creado');
  assert.equal(evento.payload.antes, null);
  assert.equal(evento.payload.despues.nombre, 'CPU crítica');
  assert.equal(evento.payload.despues.revision.numero, 2);
  assert.equal(evento.payload.despues.revision.condicion.configuracion.umbral, 90);
}

async function verificarCambioEstadoAuditable() {
  const entorno = crearEntorno();

  const desactivada = await entorno.servicio.desactivarRegla(contextoPortal(), 70);

  assert.equal(desactivada.estado, 'deshabilitada');
  assert.deepEqual(entorno.traza, [
    'permiso',
    'begin',
    'sql:estado:deshabilitada',
    'audit:regla_telemetria.estado_cambiado:principal',
    'commit'
  ]);
  const evento = entorno.auditoria.eventos[0];
  assert.equal(evento.tipo, 'regla_telemetria.estado_cambiado');
  assert.deepEqual(evento.payload, {
    estadoAntes: 'activa',
    estadoDespues: 'deshabilitada',
    motivo: 'operador',
    generacionAutoridadAntes: '1',
    generacionAutoridadDespues: '2',
    revisionVigenteId: '700'
  });
}

async function verificarEstadoNoopSinRuido() {
  const entorno = crearEntorno();

  const activada = await entorno.servicio.activarRegla(contextoPortal(), 70);

  assert.equal(activada.estado, 'activa');
  assert.deepEqual(entorno.traza, ['permiso']);
  assert.equal(entorno.auditoria.eventos.length, 0);
}

function crearEntorno() {
  const traza = [];
  const auditoria = {
    eventos: [],
    async registrarEnTransaccion({ intencion }) {
      validarEventoAuditableV1(intencion);
      traza.push(`audit:${intencion.tipo}:${intencion.rolEvento}`);
      this.eventos.push(intencion);
      return { evento: intencion, estado: 'incorporado' };
    }
  };
  const entorno = {
    traza,
    auditoria,
    regla: crearReglaPersistida({
      id: 70,
      estado: 'activa',
      revisionId: 700,
      numeroRevision: 1,
      revision: datosRevision({ umbral: 80, nombre: 'CPU elevada' })
    })
  };
  const repositorioReglas = {
    async buscarPorId(id) {
      assert.equal(Number(id), Number(entorno.regla.regla.id));
      return entorno.regla;
    },
    async crearConRevisionInicialEnTransaccion(datos, { conexion }) {
      assert.ok(conexion);
      traza.push('sql:crear-regla');
      entorno.regla = crearReglaPersistida({
        id: 70,
        estado: datos.estado,
        revisionId: 700,
        numeroRevision: 1,
        revision: {
          nombre: datos.revision.nombre,
          descripcion: datos.revision.descripcion,
          severidadCalculada: datos.revision.severidadCalculada,
          mensajeOperativo: datos.revision.mensajeOperativo,
          metadatos: datos.revision.metadatos,
          condicion: datos.revision.condicion
        },
        condicionYaConstruida: true
      });
      return entorno.regla;
    },
    async crearNuevaRevisionEnTransaccion(datos, { conexion }) {
      assert.ok(conexion);
      traza.push('sql:crear-revision');
      const revision = crearRevision({
        id: 701,
        reglaId: Number(datos.reglaId),
        numero: 2,
        datos: {
          nombre: datos.revision.nombre,
          descripcion: datos.revision.descripcion,
          severidadCalculada: datos.revision.severidadCalculada,
          mensajeOperativo: datos.revision.mensajeOperativo,
          metadatos: datos.revision.metadatos,
          condicion: datos.revision.condicion
        },
        condicionYaConstruida: true
      });
      entorno.regla = crearReglaPersistida({
        id: 70,
        estado: entorno.regla.regla.estado,
        revisionId: revision.id,
        numeroRevision: revision.numero,
        revision: {
          nombre: revision.nombre,
          descripcion: revision.descripcion,
          severidadCalculada: revision.severidadCalculada,
          mensajeOperativo: revision.mensajeOperativo,
          metadatos: revision.metadatos,
          condicion: revision.condicion
        },
        condicionYaConstruida: true,
        generacionAutoridad: entorno.regla.regla.generacionAutoridad + 1
      });
      return revision;
    },
    async cambiarEstadoEnTransaccion(reglaId, estado, { conexion }) {
      assert.ok(conexion);
      traza.push(`sql:estado:${estado}`);
      entorno.regla = crearReglaPersistida({
        id: Number(reglaId),
        estado,
        revisionId: entorno.regla.revisionVigente.id,
        numeroRevision: entorno.regla.revisionVigente.numero,
        revision: {
          nombre: entorno.regla.revisionVigente.nombre,
          descripcion: entorno.regla.revisionVigente.descripcion,
          severidadCalculada: entorno.regla.revisionVigente.severidadCalculada,
          mensajeOperativo: entorno.regla.revisionVigente.mensajeOperativo,
          metadatos: entorno.regla.revisionVigente.metadatos,
          condicion: entorno.regla.revisionVigente.condicion
        },
        condicionYaConstruida: true,
        generacionAutoridad: entorno.regla.regla.generacionAutoridad + 1
      });
      return entorno.regla;
    }
  };
  const fronteraTransaccional = {
    async ejecutar(trabajo) {
      traza.push('begin');
      const resultado = await trabajo({ id: 'conexion-fake', execute() {} });
      traza.push('commit');
      return resultado;
    }
  };
  entorno.servicio = new ServicioAdministracionReglasDerivacionTelemetria({
    repositorioAgentes: {
      async buscarPorId(id) {
        assert.equal(Number(id), 50);
        return agenteFixture();
      }
    },
    repositorioCatalogoSenales: {
      async buscarPorId(id) {
        assert.equal(Number(id), 9);
        return senalFixture();
      },
      async listarPorAgente() {
        return [senalFixture()];
      }
    },
    repositorioReglas,
    fronteraTransaccional,
    servicioAuditoria: auditoria,
    politicaPermisosAgentes: {
      assertPuedeModificar() {
        traza.push('permiso');
      },
      puedeAlcanzarAgente() {
        return true;
      }
    },
    ahora: () => new Date('2026-07-25T10:00:00.000Z')
  });

  return entorno;
}

function crearReglaPersistida({
  id,
  estado,
  revisionId,
  numeroRevision,
  revision,
  condicionYaConstruida = false,
  generacionAutoridad = 1
}) {
  const regla = new ReglaDerivacionTelemetria({
    id,
    agente: { id: 50, tenantId: 1, empresaId: 2, sitioId: 3 },
    senal: { id: 9, agenteId: 50 },
    scope: { tenantId: 1, empresaId: 2, sitioId: 3 },
    estado,
    revisionVigenteId: revisionId,
    generacionAutoridad
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
        fechaCreacion: '2026-07-25T09:00:00.000Z',
        fechaActualizacion: '2026-07-25T09:00:00.000Z'
      };
    }
  };
}

function crearRevision({
  id,
  reglaId = 70,
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
            unidad: '%'
          }
        },
    severidadCalculada: datos.severidadCalculada,
    mensajeOperativo: datos.mensajeOperativo,
    nombre: datos.nombre,
    descripcion: datos.descripcion,
    metadatos: datos.metadatos,
    vigenteDesdeUtc: `2026-07-25T09:00:00.00${numero}Z`
  });
}

function datosRevision({ umbral = 80, nombre = 'CPU elevada' } = {}) {
  return {
    nombre,
    descripcion: 'Detecta CPU por encima de tolerancia.',
    severidadCalculada: 'advertencia',
    mensajeOperativo: 'Revisar consumo de CPU del host.',
    metadatos: {
      origen: 'administracion',
      causaProbable: 'Carga sostenida.',
      detalleLibre: 'No debe entrar en auditoría.'
    },
    condicion: {
      tipo: 'numero',
      operador: '>',
      umbral
    }
  };
}

function contextoPortal() {
  return {
    idUsuario: 7,
    idUsuarioReal: 7,
    tenantId: 1,
    empresaId: 2,
    sitioId: 3
  };
}

function agenteFixture() {
  return {
    id: 50,
    tenantId: 1,
    empresaId: 2,
    sitioId: 3
  };
}

function senalFixture() {
  return {
    id: 9,
    agenteId: 50,
    codigoSenal: 'sistema.cpu',
    tipoDato: 'numero',
    unidad: '%'
  };
}

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { ServicioEliminacionesOrganizativasAuditable } from '../paquetes/jerarquia-organizativa/src/ServicioEliminacionesOrganizativasAuditable.js';
import { validarEventoAuditableV1 } from '../paquetes/auditoria/src/ValidadorContratoAuditoria.js';
import { RepositorioOperacionesSesionAgentes } from '../paquetes/agentes/src/RepositorioOperacionesSesionAgentes.js';
import { LimpiadorSesionesEliminacionOrganizativa } from '../paquetes/jerarquia-organizativa/src/LimpiadorSesionesEliminacionOrganizativa.js';
import {
  CODIGOS_ERROR_ELIMINACION_ORGANIZATIVA,
  ErrorEliminacionOrganizativaNoDisponible
} from '../paquetes/jerarquia-organizativa/src/ErroresEliminacionOrganizativa.js';

const CONTEXTO = Object.freeze({ idUsuario: 7, idUsuarioReal: 5 });

async function main() {
  await verificarTresRaicesYContratoCerrado();
  await verificarBloqueoTemporalDeCascadaConAgentes();
  await verificarRollbackYPostCommit();
  await verificarAutoridadDeRetiradaHuerfana();
  await verificarLimpiezaDePendientesYActual();
  await verificarGuardasPersistentes();
  console.log(
    '[organizacion] OK 5.21.7c: raices=3 impacto=cerrado cascada=agregada ' +
    'web=invalidada agentes=bloqueados_hasta_5.26 post_commit=proyecciones rollback=atomico'
  );
}

async function verificarLimpiezaDePendientesYActual() {
  const llamadas = [];
  const limpiador = new LimpiadorSesionesEliminacionOrganizativa({
    servicioSesion: {
      async limpiarEstadoUsuario(id) { llamadas.push(`web:${id}`); }
    },
    repositorioSesionesTecnicasRedis: {
      async retirarSiCoincide(retirada) {
        llamadas.push(`pendiente:${retirada.operacionId}`);
      },
      async aplicar(invalidacion) {
        assert.equal(invalidacion.proyeccion, null);
        llamadas.push(`actual:${invalidacion.operacionId}`);
      }
    }
  });
  await limpiador.ejecutar({
    usuarios: ['7'],
    invalidacionesTecnicas: [{
      agente: agente('31', '018f8f70-7b5c-7a55-b32a-111111111111'),
      retiradasPendientes: [{
        agenteId: '31',
        operacionId: '018f8f70-7b5c-7a55-b32a-222222222222',
        fencingToken: '7'
      }],
      operacion: {
        operacionId: '018f8f70-7b5c-7a55-b32a-333333333333',
        fencingToken: '8'
      }
    }]
  });
  assert.deepEqual(llamadas.sort(), [
    'actual:018f8f70-7b5c-7a55-b32a-333333333333',
    'pendiente:018f8f70-7b5c-7a55-b32a-222222222222',
    'web:7'
  ]);
}

async function verificarAutoridadDeRetiradaHuerfana() {
  const repositorio = new RepositorioOperacionesSesionAgentes({
    async obtenerConexion() {}
  });
  const conexion = {
    async execute(sql) {
      if (sql.includes('FROM agentes_sentinelia')) return [[], []];
      if (sql.includes('FROM cabeceras_coordinacion_sesion_agentes')) {
        return [[{ fencing_token: '8' }], []];
      }
      throw new Error(`SQL inesperado: ${sql}`);
    }
  };
  const autoridad = await repositorio.verificarAutoridadOperacionEnTransaccion({
    tipo: 'invalidacion',
    agenteId: '31',
    sesionAuditoriaId: '018f8f70-7b5c-7a55-b32a-111111111111',
    versionScopeObservada: '2',
    versionAutorizacionObservada: '3',
    fencingToken: '8',
    scope: { tenantId: '9', empresaId: '10', sitioId: '11' }
  }, { conexion });
  assert.equal(autoridad.agenteExiste, false);
  assert.equal(autoridad.vigente, true);
}

async function verificarTresRaicesYContratoCerrado() {
  for (const [entidad, recurso, tipo] of [
    ['tenant', tenant(), 'organizacion.tenant_eliminado'],
    ['empresa', empresa(), 'organizacion.empresa_eliminada'],
    ['sitio', sitio(), 'organizacion.sitio_eliminado']
  ]) {
    const fixture = crearFixture({ entidad, recurso });
    assert.equal(await fixture.servicio.eliminar({
      entidad, id: recurso.id, contextoUsuarioActual: CONTEXTO,
      autorizar: () => true
    }), true);
    const evento = fixture.eventos[0];
    assert.equal(evento.tipo, tipo);
    assert.equal(evento.actorReal.id, '5');
    assert.equal(evento.actorEfectivo.id, '7');
    assert.equal(evento.payload.despues, null);
    assert.equal(evento.payload.impactoResumen, null);
    assert.deepEqual(Object.keys(evento.payload).sort(), [
      'antes', 'despues', 'impactoResumen', 'resultado'
    ]);
    validarEventoAuditableV1({
      tipo: evento.tipo,
      actor: evento.actorReal.tipo,
      origen: evento.origen,
      sujeto: evento.sujeto,
      flujo: evento.flujo,
      productor: evento.productor,
      rolEvento: evento.rolEvento,
      payload: evento.payload
    });
  }
}

async function verificarBloqueoTemporalDeCascadaConAgentes() {
  const fixture = crearFixture({
    entidad: 'tenant',
    recurso: tenant(),
    impacto: impacto(18, 4),
    usuarios: ['7', '8'],
    agentes: [agente('31', '018f8f70-7b5c-7a55-b32a-111111111111'), agente('32', null)],
    sesionesWeb: [{ sesionAuditoriaId: '018f8f70-7b5c-7a55-b32a-222222222222' }]
  });
  await assert.rejects(
    () => fixture.servicio.eliminar({
      entidad: 'tenant', id: 9, contextoUsuarioActual: CONTEXTO,
      autorizar: () => true
    }),
    (error) => {
      assert.ok(error instanceof ErrorEliminacionOrganizativaNoDisponible);
      assert.equal(
        error.codigo,
        CODIGOS_ERROR_ELIMINACION_ORGANIZATIVA
          .CONTIENE_AGENTES_REQUIERE_MOTOR_DURABLE
      );
      assert.equal(error.cantidadAgentes, 2);
      return true;
    }
  );
  assert.equal(fixture.eventos.length, 0);
  assert.equal(fixture.eliminaciones.length, 0);
  assert.equal(fixture.neutralizaciones.length, 0);
  assert.equal(fixture.webInvalidados.length, 0);
  assert.equal(fixture.limpiezas.length, 0);
  assert.deepEqual(fixture.traza, [
    'begin',
    'bloquear_raiz',
    'impacto_bloqueado',
    'bloquear_descendientes',
    'rollback'
  ]);
}

async function verificarRollbackYPostCommit() {
  const fixture = crearFixture({
    entidad: 'sitio', recurso: sitio(), falloEliminacion: true
  });
  await assert.rejects(() => fixture.servicio.eliminar({
    entidad: 'sitio', id: 11, contextoUsuarioActual: CONTEXTO,
    autorizar: () => true
  }), /fallo de eliminación inyectado/);
  assert.equal(fixture.eventos.length, 0);
  assert.equal(fixture.eliminaciones.length, 0);
  assert.equal(fixture.limpiezas.length, 0);
  assert.deepEqual(fixture.traza.slice(-1), ['rollback']);

  const noAutorizada = crearFixture({ entidad: 'empresa', recurso: empresa() });
  await assert.rejects(() => noAutorizada.servicio.eliminar({
    entidad: 'empresa', id: 10, contextoUsuarioActual: CONTEXTO,
    autorizar: () => false
  }), /ya no autoriza/);
  assert.equal(noAutorizada.eventos.length, 0);
}

async function verificarGuardasPersistentes() {
  const operaciones = await readFile(new URL(
    '../paquetes/agentes/src/RepositorioOperacionesSesionAgentes.js', import.meta.url
  ), 'utf8');
  const repositorio = await readFile(new URL(
    '../paquetes/jerarquia-organizativa/src/RepositorioEliminacionesOrganizativas.js',
    import.meta.url
  ), 'utf8');
  assert.match(operaciones, /tipo IN \('login', 'refresh'\)/);
  assert.match(operaciones, /version_autorizacion_agente = version_autorizacion_agente \+ 1/);
  assert.match(operaciones, /invalidacionHuerfanaAdmitida/);
  assert.match(repositorio, /ORDER BY id ASC[\s\S]*FOR UPDATE/);
  assert.doesNotMatch(repositorio, /operaciones_sesion_agentes[\s\S]*FOREIGN KEY/);
}

function crearFixture({
  entidad,
  recurso,
  impacto: impactoEntrada = impacto(0, 0),
  usuarios = [],
  agentes = [],
  sesionesWeb = [],
  falloEliminacion = false
}) {
  const traza = [];
  const eventos = [];
  const eliminaciones = [];
  const neutralizaciones = [];
  const webInvalidados = [];
  const limpiezas = [];
  const servicio = new ServicioEliminacionesOrganizativasAuditable({
    fronteraTransaccional: {
      async ejecutar(trabajo) {
        traza.push('begin');
        try {
          const resultado = await trabajo({ execute() {} });
          traza.push('commit');
          return resultado;
        } catch (error) {
          traza.push('rollback');
          throw error;
        }
      }
    },
    repositorioCrud: {
      async buscarBloqueadoEnTransaccion(entidadPedida) {
        assert.equal(entidadPedida, entidad);
        traza.push('bloquear_raiz');
        return recurso;
      }
    },
    repositorioEliminaciones: {
      async listarDescendientesEnTransaccion() {
        traza.push('bloquear_descendientes');
        return { usuarios, agentes };
      },
      async eliminarEnTransaccion(entidadPedida, id) {
        traza.push('eliminar');
        if (falloEliminacion) throw new Error('fallo de eliminación inyectado');
        eliminaciones.push({ entidad: entidadPedida, id });
      }
    },
    servicioImpacto: {
      async evaluarEnTransaccion() {
        traza.push('impacto_bloqueado');
        return impactoEntrada;
      }
    },
    repositorioSesionesWeb: {
      async invalidarVigentesPorUsuariosEnTransaccion(ids) {
        traza.push('invalidar_web');
        webInvalidados.push(ids);
        return sesionesWeb;
      }
    },
    repositorioOperacionesAgentes: {
      async neutralizarPorEliminacionEnTransaccion(datos) {
        traza.push('neutralizar_agente');
        neutralizaciones.push(datos);
        return {
          operacion: datos.sesionAuditoriaId ? {
            operacionId: datos.operacionId,
            fencingToken: '4'
          } : null,
          operacionesReemplazadas: 1,
          retiradasPendientes: [],
          agenteId: datos.agenteId,
          fencingToken: '4'
        };
      }
    },
    servicioAuditoria: {
      async registrarEnTransaccion({ intencion }) {
        traza.push('auditar');
        eventos.push(intencion);
      }
    },
    limpiadorPostCommit: {
      async ejecutar(resultado) {
        traza.push('limpiar');
        limpiezas.push(resultado);
      }
    },
    ahora: () => new Date('2026-07-25T10:00:00.000Z')
  });
  return {
    servicio, traza, eventos, eliminaciones, neutralizaciones,
    webInvalidados, limpiezas
  };
}

function impacto(dependencias, referencias) {
  return {
    resumen: {
      totalEliminacionesEnCascada: dependencias,
      totalReferenciasDesacopladas: referencias,
      totalBloqueosPotenciales: 0
    }
  };
}

function tenant() {
  return { id: 9, nombre: 'Raíz', alias: 'raiz', descripcion: null, estado: 'activo' };
}

function empresa() {
  return { ...tenant(), id: 10, tenantId: 9, cif: 'B12345678' };
}

function sitio() {
  return { ...tenant(), id: 11, tenantId: 9, empresaId: 10, timezone: 'Europe/Madrid' };
}

function agente(agenteId, sesionAuditoriaId) {
  return {
    agenteId,
    sesionAuditoriaId,
    scope: { tenantId: '9', empresaId: '10', sitioId: '11' }
  };
}

main().catch((error) => {
  console.error('[organizacion] Falló la verificación de eliminaciones auditables.');
  console.error(error);
  process.exitCode = 1;
});

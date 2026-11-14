import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import {
  CODIGOS_ERROR_ELIMINACION_ORGANIZATIVA,
  ErrorEliminacionOrganizativaNoDisponible
} from '../paquetes/jerarquia-organizativa/src/ErroresEliminacionOrganizativa.js';
import { ServicioEliminacionesOrganizativasAuditable } from '../paquetes/jerarquia-organizativa/src/ServicioEliminacionesOrganizativasAuditable.js';
import { ServicioJerarquiaOrganizativa } from '../paquetes/jerarquia-organizativa/src/ServicioJerarquiaOrganizativa.js';

const CONTEXTO = Object.freeze({
  idUsuario: 5,
  idUsuarioReal: 5,
  nivelScope: 'portal',
  permisos: Object.freeze({
    administrarTenants: true,
    administrarEmpresas: true,
    administrarSitios: true
  })
});

await verificarBloqueoDeLasTresRaicesConAgentes();
await verificarInventarioNoVerificableFallaCerrado();
await verificarOrganizacionVaciaConservaCaminoAuditable();
await verificarAusenciaDeServicioNoUsaFallbackDirecto();
await verificarControladorRetiraCaminoSincrono();
await verificarComposicionSegura();

console.log(
  '[organizacion] OK 5.26.1a: raices=3 agentes=bloqueados ' +
  'guardia=intratransaccional efectos_previos=0 fallback_directo=0 ' +
  'organizacion_vacia=auditable gate_nuevo=apagado'
);

async function verificarBloqueoDeLasTresRaicesConAgentes() {
  for (const [entidad, raiz] of [
    ['tenant', tenant()],
    ['empresa', empresa()],
    ['sitio', sitio()]
  ]) {
    const fixture = crearFixtureAuditable({
      entidad,
      raiz,
      descendientes: {
        usuarios: ['7'],
        agentes: [agente('31'), agente('32')]
      }
    });
    await assert.rejects(
      () => fixture.servicio.eliminar({
        entidad,
        id: raiz.id,
        contextoUsuarioActual: CONTEXTO,
        autorizar: () => true
      }),
      (error) => {
        assert.ok(error instanceof ErrorEliminacionOrganizativaNoDisponible);
        assert.equal(
          error.codigo,
          CODIGOS_ERROR_ELIMINACION_ORGANIZATIVA
            .CONTIENE_AGENTES_REQUIERE_MOTOR_DURABLE
        );
        assert.equal(error.statusCode, 409);
        assert.equal(error.entidad, entidad);
        assert.equal(error.id, String(raiz.id));
        assert.equal(error.cantidadAgentes, 2);
        assert.doesNotMatch(error.message, /agente:31|agente:32|\b31\b|\b32\b/u);
        return true;
      }
    );
    assert.deepEqual(fixture.traza, [
      'begin',
      'bloquear_raiz',
      'impacto_bloqueado',
      'bloquear_descendientes',
      'rollback'
    ]);
    assert.deepEqual(fixture.efectos, []);
  }
}

async function verificarInventarioNoVerificableFallaCerrado() {
  for (const agentes of [null, undefined, {}, 'desconocido']) {
    const fixture = crearFixtureAuditable({
      entidad: 'sitio',
      raiz: sitio(),
      descendientes: { usuarios: [], agentes }
    });
    await assert.rejects(
      () => fixture.servicio.eliminar({
        entidad: 'sitio',
        id: 15,
        contextoUsuarioActual: CONTEXTO,
        autorizar: () => true
      }),
      (error) => {
        assert.ok(error instanceof ErrorEliminacionOrganizativaNoDisponible);
        assert.equal(
          error.codigo,
          CODIGOS_ERROR_ELIMINACION_ORGANIZATIVA
            .INVENTARIO_AGENTES_NO_VERIFICABLE
        );
        assert.equal(error.statusCode, 503);
        return true;
      }
    );
    assert.deepEqual(fixture.efectos, []);
    assert.equal(fixture.traza.at(-1), 'rollback');
  }
}

async function verificarOrganizacionVaciaConservaCaminoAuditable() {
  const fixture = crearFixtureAuditable({
    entidad: 'sitio',
    raiz: sitio(),
    descendientes: { usuarios: ['7'], agentes: [] }
  });
  assert.equal(await fixture.servicio.eliminar({
    entidad: 'sitio',
    id: 15,
    contextoUsuarioActual: CONTEXTO,
    autorizar: () => true
  }), true);
  assert.deepEqual(fixture.traza, [
    'begin',
    'bloquear_raiz',
    'impacto_bloqueado',
    'bloquear_descendientes',
    'invalidar_web',
    'eliminar',
    'auditar',
    'commit',
    'limpiar'
  ]);
  assert.deepEqual(fixture.efectos, [
    'invalidar_web',
    'eliminar',
    'auditar',
    'limpiar'
  ]);
}

async function verificarAusenciaDeServicioNoUsaFallbackDirecto() {
  const eliminacionesDirectas = [];
  const servicio = new ServicioJerarquiaOrganizativa({
    repositorioTenants: repositorioRaiz(tenant(), 'tenant', eliminacionesDirectas),
    repositorioEmpresas: repositorioRaiz(empresa(), 'empresa', eliminacionesDirectas),
    repositorioSitios: repositorioRaiz(sitio(), 'sitio', eliminacionesDirectas),
    repositorioUsuarios: {},
    servicioEliminacionesOrganizativasAuditable: null
  });
  for (const [entidad, ejecutar] of [
    ['tenant', () => servicio.eliminarTenant(CONTEXTO, 9)],
    ['empresa', () => servicio.eliminarEmpresa(CONTEXTO, 12)],
    ['sitio', () => servicio.eliminarSitio(CONTEXTO, 15)]
  ]) {
    await assert.rejects(ejecutar, (error) => {
      assert.ok(error instanceof ErrorEliminacionOrganizativaNoDisponible);
      assert.equal(
        error.codigo,
        CODIGOS_ERROR_ELIMINACION_ORGANIZATIVA.SERVICIO_TRANSACCIONAL_REQUERIDO
      );
      assert.equal(error.statusCode, 503);
      assert.equal(error.entidad, entidad);
      return true;
    });
  }
  assert.deepEqual(
    eliminacionesDirectas,
    [],
    'Ningún repositorio directo debe sustituir la frontera transaccional.'
  );
}

async function verificarControladorRetiraCaminoSincrono() {
  const controlador = await leer(
    '../apps/sentinelia-web/src/controladores/ControladorOrganizacion.js'
  );
  assert.doesNotMatch(
    controlador,
    /async (?:eliminar|apiImpactoEliminar)(?:Tenant|Empresa|Sitio)\(/u
  );
}

async function verificarComposicionSegura() {
  const [servicio, jerarquia] = await Promise.all([
    leer('../paquetes/jerarquia-organizativa/src/ServicioEliminacionesOrganizativasAuditable.js'),
    leer('../paquetes/jerarquia-organizativa/src/ServicioJerarquiaOrganizativa.js')
  ]);
  assert.match(
    servicio,
    /listarDescendientesEnTransaccion[\s\S]{0,200}asegurarAgentesEliminables[\s\S]{0,300}capturadorFederacion/u
  );
  assert.doesNotMatch(
    jerarquia,
    /return this\.repositorio(?:Tenants|Empresas|Sitios)\.eliminar\(/u
  );
}

function crearFixtureAuditable({ entidad, raiz, descendientes }) {
  const traza = [];
  const efectos = [];
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
        return raiz;
      }
    },
    repositorioEliminaciones: {
      async listarDescendientesEnTransaccion() {
        traza.push('bloquear_descendientes');
        return descendientes;
      },
      async eliminarEnTransaccion() {
        traza.push('eliminar');
        efectos.push('eliminar');
      }
    },
    servicioImpacto: {
      async evaluarEnTransaccion() {
        traza.push('impacto_bloqueado');
        return {
          resumen: {
            totalEliminacionesEnCascada: 0,
            totalReferenciasDesacopladas: 0,
            totalBloqueosPotenciales: 0
          }
        };
      }
    },
    repositorioSesionesWeb: {
      async invalidarVigentesPorUsuariosEnTransaccion() {
        traza.push('invalidar_web');
        efectos.push('invalidar_web');
        return [];
      }
    },
    repositorioOperacionesAgentes: {
      async neutralizarPorEliminacionEnTransaccion() {
        traza.push('neutralizar_agente');
        efectos.push('neutralizar_agente');
        return { operacionesReemplazadas: 0, retiradasPendientes: [] };
      }
    },
    servicioAuditoria: {
      async registrarEnTransaccion() {
        traza.push('auditar');
        efectos.push('auditar');
      }
    },
    limpiadorPostCommit: {
      async ejecutar() {
        traza.push('limpiar');
        efectos.push('limpiar');
      }
    },
    ahora: () => new Date('2026-08-30T12:00:00.000Z')
  });
  return { servicio, traza, efectos };
}

function repositorioRaiz(recurso, entidad, eliminacionesDirectas) {
  return {
    async buscarPorId() {
      return recurso;
    },
    async eliminar(id) {
      eliminacionesDirectas.push({ entidad, id });
      return true;
    }
  };
}

function tenant() {
  return {
    id: 9,
    nombre: 'Tenant raíz',
    alias: 'tenant-raiz',
    descripcion: null,
    estado: 'activo'
  };
}

function empresa() {
  return {
    ...tenant(),
    id: 12,
    nombre: 'Empresa raíz',
    tenantId: 9,
    cif: 'B12345678'
  };
}

function sitio() {
  return {
    ...tenant(),
    id: 15,
    nombre: 'Sitio raíz',
    tenantId: 9,
    empresaId: 12,
    timezone: 'Europe/Madrid'
  };
}

function agente(agenteId) {
  return {
    agenteId,
    sesionAuditoriaId: null,
    scope: { tenantId: '9', empresaId: '12', sitioId: '15' }
  };
}

function leer(ruta) {
  return readFile(new URL(ruta, import.meta.url), 'utf8');
}

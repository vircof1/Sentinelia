import assert from 'node:assert/strict';

import {
  ErrorAutorizacionEliminacionAdministrativaOrganizacion,
  ServicioAutorizacionEliminacionAdministrativaOrganizacion
} from '../paquetes/jerarquia-organizativa/src/ServicioAutorizacionEliminacionAdministrativaOrganizacion.js';

const SCOPES_RAIZ = Object.freeze({
  tenant: Object.freeze({ tenantId: '9', empresaId: null, sitioId: null }),
  empresa: Object.freeze({ tenantId: '9', empresaId: '12', sitioId: null }),
  sitio: Object.freeze({ tenantId: '9', empresaId: '12', sitioId: '15' })
});

await verificarTresRaicesYFotografiaInmutable();
await verificarImpersonacionYOrdenUsuarios();
await verificarPermisosDobles();
await verificarCoberturaDeCadaActor();
await verificarActoresIncluidos();
await verificarReservaEnCurso();
await verificarRaizAusente();
await verificarRelecturaDeRuta();
await verificarRaizAusenteTrasRelectura();

console.log(
  '[organizacion] OK 5.26.5a: actores=real_efectivo ' +
  'permisos=organizacion_eliminar_agentes scope=doble ' +
  'pertenencia=excluida fotografias=inmutables_sin_credenciales'
);

async function verificarTresRaicesYFotografiaInmutable() {
  for (const tipo of ['tenant', 'empresa', 'sitio']) {
    const actor = usuario('5', scopeAutoridad(tipo));
    const entorno = crearEntorno({ tipo, usuarios: [actor] });
    const fotografia = await autorizar(entorno, { tipo });
    assert.equal(fotografia.actorReal.usuarioId, '5');
    assert.equal(fotografia.actorEfectivo.usuarioId, '5');
    assert.equal(fotografia.actorReal.scope.nivel, scopeAutoridad(tipo).nivel);
    assert.equal(fotografia.destinatarioUsuarioId, '5');
    assert.equal(Object.isFrozen(fotografia), true);
    assert.equal(Object.isFrozen(fotografia.actorReal.scope), true);
    assert.equal(JSON.stringify(fotografia).includes('hash_password'), false);
    assert.deepEqual(entorno.traza, ['autoridad', 'usuario:5']);
  }
}

async function verificarImpersonacionYOrdenUsuarios() {
  const entorno = crearEntorno({
    tipo: 'sitio',
    usuarios: [
      usuario('8', scopeAutoridad('sitio')),
      usuario('5', scopeAutoridad('sitio'))
    ]
  });
  const fotografia = await autorizar(entorno, {
    tipo: 'sitio', actorRealId: '8', actorEfectivoId: '5'
  });
  assert.equal(fotografia.actorReal.usuarioId, '8');
  assert.equal(fotografia.actorEfectivo.usuarioId, '5');
  assert.deepEqual(entorno.traza, ['autoridad', 'usuario:5', 'usuario:8']);
}

async function verificarPermisosDobles() {
  for (const permisos of [
    { eliminarAgentes: false, administrarOrganizacion: true },
    { eliminarAgentes: true, administrarOrganizacion: false }
  ]) {
    const entorno = crearEntorno({
      tipo: 'tenant',
      usuarios: [usuario('5', scopeAutoridad('tenant'), { permisos })]
    });
    await assertNoAutorizada(() => autorizar(entorno, { tipo: 'tenant' }));
  }
  const inactivo = crearEntorno({
    tipo: 'tenant',
    usuarios: [usuario('5', scopeAutoridad('tenant'), { activo: false })]
  });
  await assertNoAutorizada(() => autorizar(inactivo, { tipo: 'tenant' }));
}

async function verificarCoberturaDeCadaActor() {
  const entorno = crearEntorno({
    tipo: 'empresa',
    usuarios: [
      usuario('5', scopeAutoridad('empresa')),
      usuario('8', { nivel: 'tenant', tenantId: '10', empresaId: null, sitioId: null })
    ]
  });
  await assertNoAutorizada(() => autorizar(entorno, {
    tipo: 'empresa', actorRealId: '5', actorEfectivoId: '8'
  }));
}

async function verificarActoresIncluidos() {
  for (const tipo of ['tenant', 'empresa', 'sitio']) {
    for (const actores of [['5', '8'], ['8', '5']]) {
      const usuarios = [
        usuario('5', scopeAutoridad(tipo)),
        usuario('8', { nivel: tipo, ...SCOPES_RAIZ[tipo] })
      ];
      const entorno = crearEntorno({ tipo, usuarios });
      await assert.rejects(
        () => autorizar(entorno, {
          tipo, actorRealId: actores[0], actorEfectivoId: actores[1]
        }),
        (error) => error instanceof
          ErrorAutorizacionEliminacionAdministrativaOrganizacion &&
          error.codigo === 'organizacion_eliminacion_actor_incluido' &&
          error.codigoHttp === 409
      );
    }
  }
}

async function verificarReservaEnCurso() {
  const entorno = crearEntorno({ tipo: 'sitio', conflicto: true });
  await assert.rejects(
    () => autorizar(entorno, { tipo: 'sitio' }),
    (error) => error instanceof
      ErrorAutorizacionEliminacionAdministrativaOrganizacion &&
      error.codigo === 'organizacion_eliminacion_operacion_en_curso'
  );
  assert.deepEqual(entorno.traza, ['autoridad']);
}

async function verificarRaizAusente() {
  const entorno = crearEntorno({ tipo: 'sitio', raizAusente: true });
  await assertNoAutorizada(() => autorizar(entorno, { tipo: 'sitio' }));
  assert.deepEqual(entorno.traza, ['autoridad']);
}

async function verificarRelecturaDeRuta() {
  const entorno = crearEntorno({ tipo: 'sitio', fallarPrimeraRuta: true });
  await autorizar(entorno, { tipo: 'sitio' });
  assert.deepEqual(entorno.traza, ['autoridad', 'autoridad', 'usuario:5']);
}

async function verificarRaizAusenteTrasRelectura() {
  const entorno = crearEntorno({
    tipo: 'sitio',
    fallarPrimeraRuta: true,
    raizAusente: true
  });
  await assertNoAutorizada(() => autorizar(entorno, { tipo: 'sitio' }));
  assert.deepEqual(entorno.traza, ['autoridad', 'autoridad']);
}

function crearEntorno({
  tipo = 'sitio',
  usuarios = [usuario('5', scopeAutoridad(tipo))],
  conflicto = false,
  raizAusente = false,
  fallarPrimeraRuta = false
} = {}) {
  const traza = [];
  const porId = new Map(usuarios.map((actual) => [String(actual.id), actual]));
  let llamadasAutoridad = 0;
  const conexion = { execute: async () => [[], []] };
  const servicio = new ServicioAutorizacionEliminacionAdministrativaOrganizacion({
    repositorioUsuarios: {
      async buscarPorIdEnTransaccion(id, { conexion: prestada, forUpdate }) {
        assert.equal(prestada, conexion);
        assert.equal(forUpdate, true);
        traza.push(`usuario:${id}`);
        return porId.get(String(id)) || null;
      }
    },
    autoridadReservasJerarquicas: {
      async exigirDisponibilidadEnTransaccion({ recursos }, { conexion: prestada }) {
        assert.equal(prestada, conexion);
        traza.push('autoridad');
        llamadasAutoridad += 1;
        if (fallarPrimeraRuta && llamadasAutoridad === 1) {
          throw Object.assign(new Error('ruta modificada'), {
            codigo: 'ruta_reserva_jerarquica_modificada'
          });
        }
        if (conflicto) {
          throw Object.assign(new Error('reserva'), { codigo: 'operacion_en_curso' });
        }
        if (raizAusente) {
          throw Object.assign(new Error('raíz ausente'), {
            codigo: 'recurso_reserva_jerarquica_ausente'
          });
        }
        assert.deepEqual(recursos, [{ tipoRecurso: tipo, recursoId: idRaiz(tipo) }]);
        return Object.freeze({
          rutas: Object.freeze([ruta(tipo)]),
          reclamos: Object.freeze([])
        });
      }
    },
    fronteraTransaccional: { ejecutar: (trabajo) => trabajo(conexion) },
    ahora: () => new Date('2026-08-30T10:00:00.000Z')
  });
  return { conexion, servicio, traza };
}

function autorizar(entorno, {
  tipo,
  actorRealId = '5',
  actorEfectivoId = actorRealId
}) {
  return entorno.servicio.autorizar({
    actorRealId,
    actorEfectivoId,
    sujeto: { tipo, id: idRaiz(tipo) }
  });
}

function usuario(id, scope, {
  activo = true,
  permisos = { eliminarAgentes: true, administrarOrganizacion: true }
} = {}) {
  return {
    id,
    activo,
    tenantId: scope.tenantId,
    empresaId: scope.empresaId,
    sitioId: scope.sitioId,
    permisos,
    hash_password: 'no-debe-filtrarse'
  };
}

function ruta(tipo) {
  return Object.freeze({
    recurso: Object.freeze({ tipoRecurso: tipo, recursoId: idRaiz(tipo) }),
    ...SCOPES_RAIZ[tipo],
    agenteId: null
  });
}

function scopeAutoridad(tipo) {
  return {
    tenant: { nivel: 'portal', tenantId: null, empresaId: null, sitioId: null },
    empresa: { nivel: 'tenant', tenantId: '9', empresaId: null, sitioId: null },
    sitio: { nivel: 'empresa', tenantId: '9', empresaId: '12', sitioId: null }
  }[tipo];
}

function idRaiz(tipo) {
  return { tenant: '9', empresa: '12', sitio: '15' }[tipo];
}

async function assertNoAutorizada(operacion) {
  await assert.rejects(
    operacion,
    (error) => error instanceof
      ErrorAutorizacionEliminacionAdministrativaOrganizacion &&
      error.codigo === 'organizacion_eliminacion_no_autorizada' &&
      error.codigoHttp === 404
  );
}

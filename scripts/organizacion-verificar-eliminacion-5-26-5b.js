import assert from 'node:assert/strict';

import { generarUuidV7Auditoria } from '../paquetes/auditoria/src/UuidV7Auditoria.js';
import {
  CodecConfirmacionEliminacionOrganizacion,
  ErrorConfirmacionEliminacionOrganizacion
} from '../paquetes/jerarquia-organizativa/src/CodecConfirmacionEliminacionOrganizacion.js';
import {
  RepositorioImpactoEliminacionOrganizacionSql
} from '../paquetes/jerarquia-organizativa/src/RepositorioImpactoEliminacionOrganizacionSql.js';
import {
  ServicioAutorizacionEliminacionAdministrativaOrganizacion
} from '../paquetes/jerarquia-organizativa/src/ServicioAutorizacionEliminacionAdministrativaOrganizacion.js';
import {
  ServicioImpactoEliminacionOrganizacion
} from '../paquetes/jerarquia-organizativa/src/ServicioImpactoEliminacionOrganizacion.js';

await verificarVistaPreviaNoBloqueante();
await verificarTokenNoSellaNombreNiConteos();
await verificarCaducidadYVinculosDelToken();
await verificarAutorizacionAntesDeConteos();
await verificarRepositorioAcotado();

console.log(
  '[organizacion] OK 5.26.5b: impacto=agregado_acotado ' +
  'historicos=conteo_hasta_10000 locks=ninguno confirmacion=tipo_id ' +
  'token=firmado_sin_nombre_ni_conteos autoridad=previa_a_conteos'
);

async function verificarVistaPreviaNoBloqueante() {
  const fixture = crearServicio();
  const impacto = await fixture.servicio.preparar({
    actorRealId: '5',
    actorEfectivoId: '5',
    sujeto: { tipo: 'sitio', id: '15' },
    csrfToken: 'csrf-5-26-5b'
  });
  assert.equal(impacto.fraseConfirmacion, 'ELIMINAR sitio 15');
  assert.match(impacto.avisoAgregadoDinamico, /todo lo que le pertenezca/u);
  assert.equal(impacto.resumenImpacto.clase, 'previo');
  assert.equal(Object.isFrozen(impacto), true);
  assert.deepEqual(fixture.traza, [
    'sujeto', 'usuario:5', 'conteos', 'token'
  ]);
}

async function verificarTokenNoSellaNombreNiConteos() {
  const fixture = crearServicio();
  const impacto = await fixture.servicio.preparar({
    actorRealId: '5',
    sujeto: { tipo: 'sitio', id: '15' },
    csrfToken: 'csrf-5-26-5b'
  });
  const payload = fixture.codec.verificar(impacto.tokenConfirmacion, {
    csrfToken: 'csrf-5-26-5b',
    actorRealId: '5',
    sujeto: {
      tipo: 'sitio', id: '15',
      scope: { nivel: 'sitio', tenantId: '9', empresaId: '12', sitioId: '15' }
    }
  });
  assert.equal(payload.fraseConfirmacion, 'ELIMINAR sitio 15');
  assert.equal(JSON.stringify(payload).includes('Sitio renombrable'), false);
  assert.equal(JSON.stringify(payload).includes('conteos'), false);
  assert.equal(JSON.stringify(payload).includes('huella'), false);
}

async function verificarCaducidadYVinculosDelToken() {
  let ahora = new Date('2026-08-30T12:00:00.000Z');
  const codec = new CodecConfirmacionEliminacionOrganizacion({
    secreto: 'secreto-organizacion-5-26-5b-con-32-bytes',
    ttlSegundos: 60,
    ahora: () => ahora
  });
  const emitido = codec.emitir({
    actorRealId: '5',
    actorEfectivoId: '8',
    sujeto: sujeto(),
    ...identidades()
  }, { csrfToken: 'csrf' });
  for (const entrada of [
    { csrfToken: 'otro', actorRealId: '5', actorEfectivoId: '8', sujeto: sujeto() },
    { csrfToken: 'csrf', actorRealId: '6', actorEfectivoId: '8', sujeto: sujeto() },
    { csrfToken: 'csrf', actorRealId: '5', actorEfectivoId: '8', sujeto: {
      ...sujeto(), id: '16', scope: { ...sujeto().scope, sitioId: '16' }
    } }
  ]) {
    assert.throws(
      () => codec.verificar(emitido.token, entrada),
      (error) => error instanceof ErrorConfirmacionEliminacionOrganizacion &&
        error.codigo === 'organizacion_eliminacion_confirmacion_invalida'
    );
  }
  ahora = new Date('2026-08-30T12:01:00.000Z');
  assert.throws(
    () => codec.verificar(emitido.token, {
      csrfToken: 'csrf', actorRealId: '5', actorEfectivoId: '8', sujeto: sujeto()
    }),
    (error) => error.codigo === 'organizacion_eliminacion_confirmacion_expirada'
  );
}

async function verificarAutorizacionAntesDeConteos() {
  const fixture = crearServicio({ permisos: { eliminarAgentes: false } });
  await assert.rejects(
    () => fixture.servicio.preparar({
      actorRealId: '5', sujeto: { tipo: 'sitio', id: '15' }, csrfToken: 'csrf'
    }),
    (error) => error.codigo === 'organizacion_eliminacion_no_autorizada'
  );
  assert.deepEqual(fixture.traza, ['sujeto', 'usuario:5']);
}

async function verificarRepositorioAcotado() {
  const consultas = [];
  const clienteSql = {
    async consultar(sql, parametros) {
      consultas.push({ sql, parametros });
      assert.equal(
        (sql.match(/\?/gu) || []).length,
        parametros.length,
        'Cada consulta debe enlazar exactamente todos sus parámetros.'
      );
      if (/^SELECT id, nombre, tenant_id, empresa_id/u.test(sql)) {
        return [{ id: 15, nombre: 'Sitio', tenant_id: 9, empresa_id: 12 }];
      }
      if (/^SELECT\s+\(/u.test(sql)) {
        return [{
          empresas: 0, sitios: 0, usuarios: 3, agentes: 4, reglas: 5,
          monitores: 6, sesiones: 7, identidades_federadas: 8,
          referencias_restrict: 0
        }];
      }
      if (/^SELECT COUNT\(\*\) cantidad\s+FROM \(SELECT 1/u.test(sql)) {
        return [{
          cantidad: /senales_telemetria_agentes/u.test(sql) ? 10001 : 10
        }];
      }
      throw new Error(`SQL inesperado: ${sql}`);
    }
  };
  const repositorio = new RepositorioImpactoEliminacionOrganizacionSql(clienteSql);
  const raiz = await repositorio.cargarSujeto({ tipo: 'sitio', id: '15' });
  const conteos = await repositorio.cargarConteos({ sujeto: raiz });
  await repositorio.cargarConteos({ sujeto: { tipo: 'empresa', id: '12' } });
  await repositorio.cargarConteos({ sujeto: { tipo: 'tenant', id: '9' } });
  assert.equal(conteos.find((item) => item.categoria === 'agentes').cantidad, '4');
  assert.equal(
    conteos.find((item) => item.categoria === 'observaciones').precision,
    'exacta'
  );
  assert.equal(
    conteos.find((item) => item.categoria === 'observaciones').cantidad,
    '10'
  );
  assert.equal(consultas.length, 31, 'La consulta debe tener un número fijo de accesos.');
  const fuenteSql = consultas.map(({ sql }) => sql).join('\n');
  assert.doesNotMatch(fuenteSql, /FOR UPDATE|EXPLAIN|ORDER BY/iu);
  assert.match(fuenteSql, /LIMIT 10001/u);
  assert.equal(
    consultas.filter(({ sql }) => /^SELECT COUNT\(\*\) cantidad/u.test(sql)).length,
    24
  );
  assert.equal(
    conteos.find((item) => item.categoria === 'senales').precision,
    'minima'
  );
  assert.equal(
    conteos.find((item) => item.categoria === 'senales').cantidad,
    '10000'
  );
}

function crearServicio({ permisos = {
  eliminarAgentes: true,
  administrarOrganizacion: true
} } = {}) {
  const traza = [];
  const usuarios = {
    '5': usuario('5', permisos),
    '8': usuario('8', permisos)
  };
  const repositorioUsuarios = {
    async buscarPorId(id) {
      traza.push(`usuario:${id}`);
      return usuarios[id] || null;
    },
    async buscarPorIdEnTransaccion() {
      throw new Error('La vista previa no debe adquirir locks de usuario.');
    }
  };
  const servicioAutorizacion =
    new ServicioAutorizacionEliminacionAdministrativaOrganizacion({
      repositorioUsuarios,
      autoridadReservasJerarquicas: {
        async exigirDisponibilidadEnTransaccion() {
          throw new Error('La vista previa no debe adquirir reservas.');
        }
      }
    });
  const repositorioImpacto = {
    async cargarSujeto() {
      traza.push('sujeto');
      return sujeto();
    },
    async cargarConteos() {
      traza.push('conteos');
      return conteos();
    }
  };
  const codec = new CodecConfirmacionEliminacionOrganizacion({
    secreto: 'secreto-organizacion-5-26-5b-con-32-bytes',
    ahora: () => new Date('2026-08-30T12:00:00.000Z')
  });
  const codecTrazado = {
    emitir(...argumentos) {
      traza.push('token');
      return codec.emitir(...argumentos);
    }
  };
  return {
    traza,
    codec,
    servicio: new ServicioImpactoEliminacionOrganizacion({
      repositorioImpacto,
      servicioAutorizacion,
      codecConfirmacion: codecTrazado,
      generarUuid: generarUuidV7Auditoria
    })
  };
}

function sujeto() {
  return Object.freeze({
    tipo: 'sitio',
    id: '15',
    nombre: 'Sitio renombrable',
    scope: Object.freeze({
      nivel: 'sitio', tenantId: '9', empresaId: '12', sitioId: '15'
    })
  });
}

function usuario(id, permisos) {
  return {
    id,
    activo: true,
    tenantId: '9',
    empresaId: '12',
    sitioId: null,
    permisos
  };
}

function conteos() {
  return [
    { categoria: 'raiz', cantidad: '1', precision: 'exacta' },
    { categoria: 'agentes', cantidad: '4', precision: 'exacta' },
    { categoria: 'observaciones', cantidad: '1200', precision: 'estimada' }
  ];
}

function identidades() {
  return {
    operacionId: generarUuidV7Auditoria(),
    claveOperacion: generarUuidV7Auditoria(),
    correlacionId: generarUuidV7Auditoria(),
    eventoId: generarUuidV7Auditoria()
  };
}

import assert from 'node:assert/strict';

import { ServicioBuzonNotificacionesUsuario }
  from '../paquetes/agentes/src/ServicioBuzonNotificacionesUsuario.js';
import { ResolutorSujetosAgenteNotificaciones }
  from '../paquetes/agentes/src/ResolutorSujetosAgenteNotificaciones.js';
import { RepositorioNotificacionesUsuarioSql }
  from '../paquetes/agentes/src/RepositorioNotificacionesUsuarioSql.js';
import { CatalogoResolutoresSujetosNotificaciones }
  from '../paquetes/coordinacion-durable/src/CatalogoResolutoresSujetosNotificaciones.js';
import { ResolutorSujetosOrganizacionNotificaciones }
  from '../paquetes/jerarquia-organizativa/src/ResolutorSujetosOrganizacionNotificaciones.js';

const OPERACION_ID = '018f7f40-1111-7111-8111-111111111111';
const CONTEXTO = Object.freeze({
  idUsuarioReal: 7,
  nivelScope: 'tenant',
  tenantId: 1,
  empresaId: null,
  sitioId: null,
  permisos: { verAgentes: true }
});

await main();

async function main() {
  verificarCatalogoCerrado();
  verificarRepositorioDesacoplado();
  await verificarProyeccionMixtaYAntifugas();
  console.log(
    '[organizacion] OK 5.26.6a: buzon=transversal resolutores=cerrados ' +
    'raiz_viva=visible fotografia_final=scope_actual ocultacion=sin_fugas ' +
    'agente=regresion_conservada repositorio=contrato_inyectado'
  );
}

function verificarCatalogoCerrado() {
  assert.throws(
    () => new CatalogoResolutoresSujetosNotificaciones({ resolutores: [] }),
    /resolutores de sujeto explícitos/u
  );
  assert.throws(
    () => new CatalogoResolutoresSujetosNotificaciones({
      resolutores: [
        { tiposSujeto: ['tenant'], resolver: async () => new Map() },
        { tiposSujeto: ['tenant'], resolver: async () => new Map() }
      ]
    }),
    /más de un resolutor/u
  );
}

function verificarRepositorioDesacoplado() {
  const sql = { consultar() {}, obtenerConexion() {} };
  assert.throws(
    () => new RepositorioNotificacionesUsuarioSql(sql),
    /catálogo cerrado de notificaciones/u
  );
}

async function verificarProyeccionMixtaYAntifugas() {
  const notificaciones = [
    notificacion('agente', '9', 'eliminacion_agente_encolada', {
      guid: '01234567-89ab-4def-8abc-0123456789ab'
    }),
    notificacion('tenant', '1', 'eliminacion_organizacion_encolada'),
    notificacion('empresa', '30', 'organizacion_eliminada', {
      fotografiaFinal: fotografia('empresa', '30', 'Empresa eliminada', {
        nivel: 'empresa', tenantId: '1', empresaId: '30', sitioId: null
      })
    }),
    notificacion('sitio', '90', 'organizacion_eliminada', {
      fotografiaFinal: fotografia('sitio', '90', 'Sitio secreto', {
        nivel: 'sitio', tenantId: '2', empresaId: '20', sitioId: '90'
      })
    }),
    notificacion('tenant', '404', 'eliminacion_organizacion_encolada')
  ];
  const autorizacion = {
    puedeUsarBuzonPersonal: () => true,
    puedeVerAgentes: (contexto) => Boolean(contexto?.permisos?.verAgentes)
  };
  const catalogo = new CatalogoResolutoresSujetosNotificaciones({
    resolutores: [
      new ResolutorSujetosAgenteNotificaciones({
        repositorioAgentes: {
          async buscarVisiblesPorIds() {
            return [{
              id: 9,
              guid: '01234567-89ab-4def-8abc-0123456789ab',
              nombre: 'Agente visible',
              tenantNombre: 'Tenant uno'
            }];
          }
        },
        servicioAutorizacion: autorizacion
      }),
      new ResolutorSujetosOrganizacionNotificaciones({
        repositorioTenants: repositorioAgrupado([{ id: 1, nombre: 'Tenant uno' }]),
        repositorioEmpresas: repositorioAgrupado([]),
        repositorioSitios: repositorioAgrupado([{
          id: 90,
          tenantId: 2,
          empresaId: 20,
          nombre: 'Sitio secreto'
        }])
      })
    ]
  });
  const servicio = new ServicioBuzonNotificacionesUsuario({
    repositorio: repositorioBuzon(notificaciones),
    catalogoResolutoresSujetos: catalogo,
    servicioAutorizacion: autorizacion,
    secretoCursores: 'secreto-fixture-5-26-6a-con-mas-de-32-bytes'
  });
  const pagina = await servicio.listar(CONTEXTO);
  const [agente, tenant, empresaBorrada, sitioOculto, tenantAusente] =
    pagina.notificaciones.map(({ sujeto }) => sujeto);

  assert.equal(agente.nombre, 'Agente visible');
  assert.equal(tenant.nombre, 'Tenant uno');
  assert.equal(empresaBorrada.fotografiaFinal, true);
  assert.equal(empresaBorrada.nombre, 'Empresa eliminada');
  assert.deepEqual(sitioOculto, { tipo: 'sitio', disponible: false });
  assert.deepEqual(tenantAusente, { tipo: 'tenant', disponible: false });
  assert.equal(JSON.stringify(pagina).includes('Sitio secreto'), false);

  const fueraDeScope = await servicio.listar({ ...CONTEXTO, tenantId: 2 });
  assert.deepEqual(fueraDeScope.notificaciones[2].sujeto, {
    tipo: 'empresa',
    disponible: false
  });
}

function notificacion(tipo, id, clase, extra = {}) {
  const agente = tipo === 'agente';
  const eliminada = clase === 'organizacion_eliminada';
  return {
    notificacionId: `018f7f40-2222-7222-8222-22222222222${id.length % 10}`,
    operacionId: OPERACION_ID,
    tipo: clase,
    emisor: { tipo: 'proceso' },
    estadoOperacion: eliminada ? 'completada' : 'encolada',
    tituloCodigo: agente
      ? 'eliminacion_agente_encolada_titulo'
      : eliminada ? 'organizacion_eliminada_titulo' : 'eliminacion_organizacion_encolada_titulo',
    resumenCodigo: agente
      ? 'eliminacion_agente_encolada_resumen'
      : eliminada ? 'organizacion_eliminada_resumen' : 'eliminacion_organizacion_encolada_resumen',
    emitidaEnUtc: '2026-08-30T12:00:00.000Z',
    leida: false,
    leidaEnUtc: null,
    referenciaSujeto: { tipo, id, ...extra }
  };
}

function fotografia(tipo, id, nombre, scopeFinal) {
  return {
    tipo,
    id,
    nombre,
    scopeFinal,
    capturadaEnUtc: '2026-08-30T11:59:59.000Z'
  };
}

function repositorioAgrupado(entidades) {
  return {
    async buscarPorIds(ids) {
      const solicitadas = new Set(ids.map(String));
      return entidades.filter(({ id }) => solicitadas.has(String(id)));
    }
  };
}

function repositorioBuzon(notificaciones) {
  return {
    async listarPagina() {
      return { notificaciones, hayMas: false, siguientePosicion: null };
    },
    async contarNoLeidas() { return notificaciones.length; },
    async marcarLeida() { return null; },
    async obtenerFirma() {
      return { noLeidas: String(notificaciones.length), firma: 'a'.repeat(64) };
    }
  };
}

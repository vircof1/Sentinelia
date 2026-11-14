import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { ControladorAuditoria } from '../apps/sentinelia-web/src/controladores/ControladorAuditoria.js';
import { SUJETOS_AUDITORIA } from '../paquetes/auditoria/src/CatalogoAuditoria.js';
import { normalizarConsultaAuditoria } from '../paquetes/auditoria/src/NormalizadorConsultaAuditoria.js';
import { RepositorioResolutoresAuditoriaSql } from '../paquetes/auditoria/src/RepositorioResolutoresAuditoriaSql.js';
import {
  ErrorResolutorConsultaAuditoria,
  ServicioResolutoresConsultaAuditoria
} from '../paquetes/auditoria/src/ServicioResolutoresConsultaAuditoria.js';

async function main() {
  await verificarBusquedaSqlPaginadaYScope();
  await verificarPermisosYNoInferencia();
  await verificarTiposActoresEIdentidadesExactas();
  await verificarEnriquecimientoHumanoEventos();
  await verificarEndpointsYContratoPublico();
  console.log('[auditoria] OK 5.21.16j: resolutores=tipados sql=materializado scope=dominio permisos=funcionales exactos=historicos');
}

async function verificarBusquedaSqlPaginadaYScope() {
  const clienteSql = new ClienteSqlResolutoresFixture();
  const servicio = crearServicio(clienteSql);
  const resultado = await servicio.resolverSujetos({
    contextoUsuarioActual: contexto({ nivelScope: 'empresa', empresaId: '20' }),
    consulta: { tipo: 'monitor', texto: 'api', pagina: '2', limite: '2' }
  });
  assert.deepEqual(resultado.paginacion, { pagina: 2, limite: 2, hayMas: true });
  assert.equal(resultado.opciones.length, 2);
  assert.deepEqual(resultado.opciones[0], {
    tipo: 'monitor',
    id: '101',
    etiqueta: 'API principal',
    contexto: { tenantId: '10', empresaId: '20', sitioId: '30' }
  });
  const llamada = clienteSql.llamadas[0];
  assert.match(llamada.sql, /FROM monitores m/);
  assert.match(llamada.sql, /m\.empresa_id = \?/);
  assert.match(llamada.sql, /COALESCE\(m\.nombre, ''\) LIKE \?/);
  assert.doesNotMatch(llamada.sql, /payload|configuracion/);
  assert.deepEqual(llamada.parametros, ['20', '%api%', '%api%', '%api%', 3, 2]);

  const contextoInvalido = new ClienteSqlResolutoresFixture([]);
  const repositorio = new RepositorioResolutoresAuditoriaSql({ clienteSql: contextoInvalido });
  await repositorio.buscarOpciones({
    tipo: 'usuario',
    texto: '',
    pagina: 1,
    limite: 25,
    contextoUsuarioActual: { nivelScope: 'desconocido' }
  });
  assert.match(contextoInvalido.llamadas[0].sql, /WHERE 1 = 0/);

  for (const [tipo, tabla, scope] of [
    ['usuario', 'usuarios u', 'u.tenant_id'],
    ['agente', 'agentes_sentinelia a', 'a.tenant_id'],
    ['monitor', 'monitores m', 'm.tenant_id'],
    ['alerta', 'alertas_activas_monitores aa', 'aa.tenant_id'],
    ['trigger', 'triggers tr', 'tr.tenant_id'],
    ['zona_dns', 'zonas_dns z', 'z.tenant_id'],
    ['registro_dns', 'registros_dns r', 'r.tenant_id'],
    ['tenant', 'tenants t', 't.id'],
    ['empresa', 'empresas e', 'e.tenant_id'],
    ['sitio', 'sitios s', 's.tenant_id']
  ]) {
    const cliente = new ClienteSqlResolutoresFixture([]);
    await new RepositorioResolutoresAuditoriaSql({ clienteSql: cliente }).buscarOpciones({
      tipo,
      texto: '',
      pagina: 1,
      limite: 10,
      contextoUsuarioActual: contexto()
    });
    assert.ok(cliente.llamadas[0].sql.includes(`FROM ${tabla}`), `Falta resolutor SQL ${tipo}.`);
    assert.ok(cliente.llamadas[0].sql.includes(`${scope} = ?`), `Falta scope SQL ${tipo}.`);
    assert.equal(cliente.llamadas[0].parametros[0], '10');
  }
}

async function verificarEnriquecimientoHumanoEventos() {
  const alertaId = '019f9a1d-5054-74d8-bbd2-63763ac7f063';
  const clienteSql = {
    llamadas: [],
    async consultar(sql, parametros) {
      this.llamadas.push({ sql: String(sql), parametros });
      if (String(sql).includes('FROM usuarios u')) {
        return [{ id: '1', etiqueta: 'Héctor', tenant_id: '10', empresa_id: null, sitio_id: null }];
      }
      if (String(sql).includes('FROM alertas_activas_monitores aa')) {
        return [{ id: alertaId, etiqueta: 'Alerta de API principal', tenant_id: '10', empresa_id: '20', sitio_id: null }];
      }
      return [];
    }
  };
  const [evento] = await crearServicio(clienteSql).enriquecerEventos({
    contextoUsuarioActual: contexto(),
    eventos: [{
      eventoId: 'evento-1',
      actorReal: { tipo: 'usuario', id: '1' },
      actorEfectivo: null,
      sujeto: { tipo: 'alerta', id: alertaId }
    }]
  });
  assert.equal(evento.actorReal.nombreVisible, 'Héctor');
  assert.equal(evento.sujeto.nombreVisible, 'Alerta de API principal');
  assert.equal(clienteSql.llamadas.length, 2);
  const consultaAlerta = clienteSql.llamadas.find(({ sql }) =>
    sql.includes('FROM alertas_activas_monitores aa')
  );
  assert.ok(consultaAlerta);
  assert.match(consultaAlerta.sql, /INNER JOIN monitores m ON m\.id = aa\.monitor_id/);
  assert.deepEqual(consultaAlerta.parametros, ['10', alertaId]);
}

async function verificarPermisosYNoInferencia() {
  const clienteSql = new ClienteSqlResolutoresFixture([]);
  const servicio = crearServicio(clienteSql);
  await assert.rejects(
    () => servicio.resolverSujetos({
      contextoUsuarioActual: contexto({ permisos: { verAuditoria: true } }),
      consulta: { tipo: 'zona_dns', texto: 'interna' }
    }),
    (error) => error instanceof ErrorResolutorConsultaAuditoria &&
      error.statusCode === 403 && error.codigo === 'PERMISO_FUNCIONAL_RESOLUTOR_REQUERIDO'
  );
  assert.equal(clienteSql.llamadas.length, 0);

  await assert.rejects(
    () => servicio.resolverSujetos({
      contextoUsuarioActual: contexto({
        nivelScope: 'empresa',
        empresaId: '20',
        permisos: { verAuditoria: true, administrarTenants: true }
      }),
      consulta: { tipo: 'tenant' }
    }),
    (error) => error.statusCode === 403
  );
  await assert.rejects(
    () => servicio.resolverSujetos({
      contextoUsuarioActual: contexto({
        permisos: { verAuditoria: true, administrarOrganizacion: true }
      }),
      consulta: { tipo: 'usuario' }
    }),
    (error) => error.statusCode === 403
  );

  const vacia = await crearServicio(new ClienteSqlResolutoresFixture([])).resolverSujetos({
    contextoUsuarioActual: contexto(),
    consulta: { tipo: 'usuario', texto: 'fuera-de-scope' }
  });
  const ausente = await crearServicio(new ClienteSqlResolutoresFixture([])).resolverSujetos({
    contextoUsuarioActual: contexto(),
    consulta: { tipo: 'usuario', texto: 'no-existe' }
  });
  assert.deepEqual(vacia, ausente);
  assert.deepEqual(vacia.opciones, []);
}

async function verificarTiposActoresEIdentidadesExactas() {
  const clienteSql = new ClienteSqlResolutoresFixture([]);
  const servicio = crearServicio(clienteSql);
  for (const tipo of SUJETOS_AUDITORIA) {
    const resultado = await servicio.resolverSujetos({
      contextoUsuarioActual: contexto({ permisos: { verAuditoria: true } }),
      consulta: { tipo, idExacto: 'historico-42' }
    });
    if (tipo === 'frontera_internet') {
      assert.deepEqual(resultado.opciones, []);
      const frontera = await servicio.resolverSujetos({
        contextoUsuarioActual: contexto({ permisos: { verAuditoria: true } }),
        consulta: { tipo, idExacto: 'portal' }
      });
      assert.deepEqual(frontera.opciones[0], {
        tipo,
        id: 'portal',
        etiqueta: 'Frontera de Internet',
        contexto: { resolucion: 'identidad_tecnica' }
      });
      continue;
    }
    assert.deepEqual(resultado.opciones[0], {
      tipo,
      id: 'historico-42',
      etiqueta: 'historico-42',
      contexto: { resolucion: 'id_exacto' }
    });
  }
  for (const tipo of ['usuario', 'agente']) {
    const resultado = await servicio.resolverActores({
      contextoUsuarioActual: contexto({ permisos: { verAuditoria: true } }),
      consulta: { tipo, idExacto: 'actor-historico' }
    });
    assert.equal(resultado.opciones[0].tipo, tipo);
    assert.equal(resultado.opciones[0].id, 'actor-historico');
  }
  for (const tipo of ['runtime', 'sistema']) {
    const resultado = await servicio.resolverActores({
      contextoUsuarioActual: contexto({ permisos: { verAuditoria: true } }),
      consulta: { tipo, idExacto: 'actor-arbitrario' }
    });
    assert.deepEqual(resultado.opciones, []);
  }
  assert.equal(clienteSql.llamadas.length, 0);

  const runtime = await servicio.resolverActores({
    contextoUsuarioActual: contexto({ permisos: { verAuditoria: true } }),
    consulta: { tipo: 'runtime' }
  });
  const sistema = await servicio.resolverActores({
    contextoUsuarioActual: contexto({ permisos: { verAuditoria: true } }),
    consulta: { tipo: 'sistema' }
  });
  assert.equal(runtime.opciones[0].id, 'sentinelia-runtime');
  assert.equal(sistema.opciones[0].id, 'sentinelia-system');

  for (const opcion of [runtime.opciones[0], sistema.opciones[0]]) {
    const filtro = normalizarConsultaAuditoria({
      actorRol: 'real',
      actorTipo: opcion.tipo,
      actorId: opcion.id
    });
    assert.equal(filtro.filtros.actorId, opcion.id);
  }
  const sujeto = normalizarConsultaAuditoria({
    sujetoTipo: 'sesion_usuario',
    sujetoId: 'historico-42'
  });
  assert.equal(sujeto.filtros.sujetoId, 'historico-42');
}

async function verificarEndpointsYContratoPublico() {
  const servicioResolutoresAuditoria = crearServicio(new ClienteSqlResolutoresFixture([]));
  const controlador = new ControladorAuditoria({
    servicioLecturaAuditoria: {
      async listarEventos() {},
      async listarDiagnosticos() {}
    },
    servicioResolutoresAuditoria
  });
  const respuesta = new RespuestaFixture();
  await controlador.apiResolverActores(
    { contextoUsuarioActual: contexto(), query: { tipo: 'runtime' } },
    respuesta,
    assert.fail
  );
  assert.equal(respuesta.statusCode, 200);
  assert.equal(respuesta.cuerpo.opciones[0].id, 'sentinelia-runtime');

  const error = new RespuestaFixture();
  await controlador.apiResolverSujetos(
    { contextoUsuarioActual: contexto(), query: { tipo: 'no_admitido' } },
    error,
    assert.fail
  );
  assert.equal(error.statusCode, 400);
  assert.equal(error.cuerpo.campo, 'tipo');
  assert.equal(error.cuerpo.codigo, 'RESOLUTOR_AUDITORIA_INVALIDO');

  const rutas = await readFile(
    new URL('../apps/sentinelia-web/src/rutas/crearRutasPortal.js', import.meta.url),
    'utf8'
  );
  for (const [ruta, metodo] of [
    ['/auditoria/api/sujetos', 'apiResolverSujetos'],
    ['/auditoria/api/actores', 'apiResolverActores']
  ]) {
    const inicio = rutas.indexOf(`'${ruta}'`);
    const fin = rutas.indexOf(');', inicio);
    assert.ok(inicio >= 0 && fin > inicio, `Falta la ruta ${ruta}.`);
    const bloque = rutas.slice(inicio, fin);
    assert.match(bloque, /requerirAutenticacion[\s\S]*cargarContextoUsuario[\s\S]*requerirVerAuditoria/);
    assert.ok(bloque.includes(metodo));
  }
  const arranque = await readFile(
    new URL('../apps/sentinelia-web/src/index.js', import.meta.url),
    'utf8'
  );
  assert.match(arranque, /new RepositorioResolutoresAuditoriaSql\(\{ clienteSql \}\)/);
  assert.match(arranque, /new ServicioResolutoresConsultaAuditoria/);
  assert.match(arranque, /servicioLecturaAuditoria,[\s\S]*servicioResolutoresAuditoria/);
}

class ClienteSqlResolutoresFixture {
  constructor(filas = [
    { id: '101', etiqueta: 'API principal', tenant_id: '10', empresa_id: '20', sitio_id: '30' },
    { id: '102', etiqueta: 'API secundaria', tenant_id: '10', empresa_id: '20', sitio_id: null },
    { id: '103', etiqueta: 'API histórica', tenant_id: '10', empresa_id: '20', sitio_id: '31' }
  ]) {
    this.filas = filas;
    this.llamadas = [];
  }

  async consultar(sql, parametros) {
    this.llamadas.push({ sql: String(sql), parametros });
    return this.filas;
  }
}

class RespuestaFixture {
  constructor() {
    this.statusCode = 200;
    this.cuerpo = null;
  }

  status(codigo) {
    this.statusCode = codigo;
    return this;
  }

  json(cuerpo) {
    this.cuerpo = cuerpo;
    return this;
  }
}

function crearServicio(clienteSql) {
  return new ServicioResolutoresConsultaAuditoria({
    repositorioResolutores: new RepositorioResolutoresAuditoriaSql({ clienteSql })
  });
}

function contexto(sobrescribir = {}) {
  const base = {
    nivelScope: 'tenant',
    tenantId: '10',
    empresaId: null,
    sitioId: null,
    permisos: {
      verAuditoria: true,
      administrarUsuarios: true,
      administrarTenants: true,
      administrarEmpresas: true,
      administrarSitios: true,
      verAgentes: true,
      verMonitores: true,
      verTriggers: true,
      verDns: true
    }
  };
  return { ...base, ...sobrescribir };
}

main().catch((error) => {
  console.error('[auditoria] ERROR 5.21.16j:', error);
  process.exitCode = 1;
});

import assert from 'node:assert/strict';
import { ServicioAuditoriaOperativa } from '../paquetes/auditoria/src/ServicioAuditoriaOperativa.js';
import { generarUuidV7Auditoria } from '../paquetes/auditoria/src/UuidV7Auditoria.js';
import { ServicioMovimientosOrganizativosAuditable } from '../paquetes/jerarquia-organizativa/src/ServicioMovimientosOrganizativosAuditable.js';
import { ServicioJerarquiaOrganizativa } from '../paquetes/jerarquia-organizativa/src/ServicioJerarquiaOrganizativa.js';
import { RepositorioMovimientosOrganizativos } from '../paquetes/jerarquia-organizativa/src/RepositorioMovimientosOrganizativos.js';
import {
  CATALOGO_TABLAS_SCOPE_ORGANIZATIVO,
  DENYLIST_TABLAS_SCOPE_ORGANIZATIVO
} from '../paquetes/jerarquia-organizativa/src/CatalogoScopeOrganizativo.js';
import { FronteraTransaccionalLocal } from '../paquetes/persistencia-sql/src/FronteraTransaccionalLocal.js';

async function main() {
  await verificarAutorizacionCambioEmpresaSitio();
  await verificarRepositorioFisico();
  const trazas = [];
  const clienteSql = new ClienteSqlEspia(trazas);
  const repositorioMovimientos = new RepositorioMovimientosFixture(trazas);
  const repositorioSesionesWeb = new RepositorioSesionesWebFixture(trazas);
  const repositorioOperacionesAgentes = new RepositorioAgentesFixture(trazas);
  const repositorioAuditoria = new RepositorioAuditoriaFixture(trazas);
  const servicio = new ServicioMovimientosOrganizativosAuditable({
    fronteraTransaccional: new FronteraTransaccionalLocal(clienteSql),
    servicioAutoridadMovimientos: {
      autorizarEnTransaccion: async (_entrada, { conexion }) => {
        exigirConexion(conexion);
        trazas.push('autoridad:movimiento');
      }
    },
    repositorioMovimientos,
    repositorioSesionesWeb,
    repositorioOperacionesAgentes,
    servicioAuditoria: new ServicioAuditoriaOperativa({ repositorioAuditoria }),
    ahora: () => new Date('2026-07-24T20:00:00.000Z')
  });
  const contextoUsuarioActual = { idUsuarioReal: 31, idUsuario: 32 };

  const empresa = await servicio.moverEmpresa({
    datos: datosEmpresa(),
    contextoUsuarioActual,
    autorizar: () => true
  });
  assert.equal(empresa.tenantId, 2);
  assert.equal(empresa.metaActualizacion.cambioTenant, true);
  verificarLoteEmpresa(repositorioAuditoria.lotes[0]);
  assert.deepEqual(
    repositorioOperacionesAgentes.llamadas.map(({ tipo }) => tipo),
    ['invalidacion', 'solo_version']
  );
  assert.deepEqual(
    repositorioOperacionesAgentes.llamadas[0].scope,
    { tenantId: '2', empresaId: '7', sitioId: '9' }
  );

  repositorioSesionesWeb.sesiones = [];
  const sitio = await servicio.moverSitio({
    datos: datosSitio(),
    contextoUsuarioActual,
    autorizar: () => true
  });
  assert.equal(sitio.empresaId, 8);
  assert.equal(sitio.metaActualizacion.cambioEmpresa, true);
  verificarLoteSitio(repositorioAuditoria.lotes[1]);
  const metadatosSitio = repositorioAuditoria.lotes[1][2];
  assert.equal(metadatosSitio.tipo, 'organizacion.sitio_actualizado');
  assert.deepEqual(metadatosSitio.payload.camposCambiados, ['nombre']);
  assert.deepEqual(metadatosSitio.scope, {
    tenantId: '2', empresaId: '8', sitioId: '9'
  });

  repositorioMovimientos.rechazar = true;
  await assert.rejects(
    servicio.moverEmpresa({
      datos: datosEmpresa(), contextoUsuarioActual, autorizar: () => true
    }),
    /scope bloqueado/
  );
  assert.deepEqual(
    trazas.slice(-4),
    ['autoridad:movimiento', 'movimiento:empresa', 'rollback', 'release']
  );
  assert.equal(trazas.filter((item) => item === 'commit').length, 2);
  assert.equal(trazas.filter((item) => item === 'rollback').length, 1);
  console.log(
    '[organizacion] OK 5.21.7b: movimientos=2 pares=2 ' +
    'consecutividad=misma_cadena invalidaciones_web=1 invalidaciones_agente=1 ' +
    'version_scope=2 metadatos=1 rollback=atomico'
  );
}

async function verificarAutorizacionCambioEmpresaSitio() {
  const sitioOrigen = {
    id: 65, nombre: 'sitio', alias: 'sitio', tenantId: 35,
    empresaId: 38, empresaNombre: 'Empresa origen'
  };
  const empresaDestino = { id: 40, nombre: 'Empresa destino', tenantId: 35 };
  const contexto = {
    nivelScope: 'tenant', tenantId: 35,
    permisos: { administrarSitios: true }
  };
  let movimientoAutorizado = false;
  const servicio = new ServicioJerarquiaOrganizativa({
    repositorioSitios: { buscarPorId: async () => sitioOrigen },
    repositorioEmpresas: { buscarPorId: async () => empresaDestino },
    servicioMovimientosOrganizativosAuditable: {
      moverSitio: async ({ autorizar }) => {
        movimientoAutorizado = autorizar(sitioOrigen);
        return { ...sitioOrigen, empresaId: empresaDestino.id };
      }
    }
  });
  const resultado = await servicio.actualizarSitio(contexto, 65, {
    nombre: 'sitio', alias: 'sitio', timezone: 'Europe/Madrid',
    estado: 'activo', empresa_id: '40', confirmar_cambio_empresa: '1'
  });
  assert.equal(movimientoAutorizado, true);
  assert.equal(resultado.empresaId, 40);
  assert.equal(servicio.puedeCrearSitio(contexto, { id: 41, tenantId: 36 }), false);
}

async function verificarRepositorioFisico() {
  const repositorio = new RepositorioMovimientosOrganizativos();
  const conexionEmpresa = new ConexionMovimientoFisica('empresa');
  const empresa = await repositorio.moverEmpresaEnTransaccion({
    ...datosEmpresa(),
    autorizar: () => true
  }, { conexion: conexionEmpresa });
  assert.equal(empresa.recurso.tenantId, 2);
  assert.equal(
    empresa.impactoResumen.filasVivasActualizadasPorClase.empresas,
    '1'
  );
  verificarCoberturaSql(conexionEmpresa.sentencias, 'empresa_id', 'empresas');

  const conexionSitio = new ConexionMovimientoFisica('sitio');
  const sitio = await repositorio.moverSitioEnTransaccion({
    ...datosSitio(),
    autorizar: () => true
  }, { conexion: conexionSitio });
  assert.equal(sitio.recurso.empresaId, 8);
  assert.equal(sitio.impactoResumen.filasVivasActualizadasPorClase.sitios, '1');
  verificarCoberturaSql(conexionSitio.sentencias, 'sitio_id', 'sitios');
}

function verificarCoberturaSql(sentencias, columna, raiz) {
  const actualizaciones = sentencias.filter((sql) => /^UPDATE /i.test(sql));
  const esperadas = CATALOGO_TABLAS_SCOPE_ORGANIZATIVO
    .filter((entrada) => entrada.tabla === raiz || entrada.columnasScope.includes(columna))
    .map(({ tabla }) => tabla);
  for (const tabla of esperadas) {
    assert.ok(
      actualizaciones.some((sql) => new RegExp(`^UPDATE ${tabla}\\b`, 'i').test(sql)),
      `La cascada no actualizó ${tabla}.`
    );
  }
  for (const tabla of DENYLIST_TABLAS_SCOPE_ORGANIZATIVO) {
    assert.equal(
      actualizaciones.some((sql) => new RegExp(`^UPDATE ${tabla}\\b`, 'i').test(sql)),
      false,
      `${tabla} no puede participar en la cascada.`
    );
  }
  assert.deepEqual(
    sentencias.filter((sql) => /^SET FOREIGN_KEY_CHECKS/i.test(sql)),
    ['SET FOREIGN_KEY_CHECKS = 0', 'SET FOREIGN_KEY_CHECKS = 1']
  );
}

class ConexionMovimientoFisica {
  constructor(tipo) {
    this.tipo = tipo;
    this.movida = false;
    this.sentencias = [];
  }

  async execute(sql, parametros = []) {
    const sentencia = String(sql).replace(/\s+/g, ' ').trim();
    this.sentencias.push(sentencia);
    if (/^SET FOREIGN_KEY_CHECKS/i.test(sentencia)) return [{ affectedRows: 0 }];
    if (/^SELECT id FROM tenants WHERE id IN/i.test(sentencia)) {
      return [parametros.map((id) => ({ id }))];
    }
    if (/^SELECT id FROM empresas WHERE id IN/i.test(sentencia)) {
      return [parametros.map((id) => ({ id }))];
    }
    if (/^SELECT e\.\*, t\.nombre AS tenant_nombre/i.test(sentencia)) {
      const id = Number(parametros[0]);
      const tenantId = id === 8 ? 2 : (this.movida ? 2 : 1);
      return [[filaEmpresa(id, tenantId)]];
    }
    if (/^SELECT s\.\*, t\.nombre AS tenant_nombre/i.test(sentencia)) {
      return [[filaSitio(9, 2, this.movida ? 8 : 7)]];
    }
    if (/^SELECT id FROM (empresas|sitios) WHERE/i.test(sentencia)) return [[]];
    if (/^SELECT CAST\(id AS CHAR\) AS id FROM usuarios/i.test(sentencia)) return [[]];
    if (/^SELECT CAST\(id AS CHAR\) AS id, sesion_auditoria_id/i.test(sentencia)) {
      return [[]];
    }
    if (/^UPDATE /i.test(sentencia)) {
      if (/^UPDATE (empresas|sitios) SET/i.test(sentencia)) this.movida = true;
      return [{ affectedRows: 1 }];
    }
    if (/^SELECT COUNT\(\*\) AS total FROM/i.test(sentencia)) {
      return [[{ total: 0 }]];
    }
    throw new Error(`SQL no contemplado por el fixture: ${sentencia}`);
  }
}

function filaEmpresa(id, tenantId) {
  return {
    id, tenant_id: tenantId, nombre: `Empresa ${id}`, alias: `empresa-${id}`,
    cif: null, descripcion: null, estado: 'activo', configuracion: null,
    tenant_nombre: `Tenant ${tenantId}`
  };
}

function filaSitio(id, tenantId, empresaId) {
  return {
    id, tenant_id: tenantId, empresa_id: empresaId, nombre: `Sitio ${id}`,
    alias: `sitio-${id}`, timezone: 'Europe/Madrid', descripcion: null,
    estado: 'activo', configuracion: null,
    tenant_nombre: `Tenant ${tenantId}`, empresa_nombre: `Empresa ${empresaId}`
  };
}

function verificarLoteEmpresa(lote) {
  assert.equal(lote.length, 4);
  const [salida, entrada, web, agente] = lote;
  assert.equal(salida.tipo, 'scope.entidad_salida');
  assert.equal(entrada.tipo, 'scope.entidad_entrada');
  assert.equal(salida.claveCadena, 'organizacion:tenant:1');
  assert.equal(entrada.claveCadena, 'organizacion:tenant:2');
  assert.equal(salida.payload.eventoContraparteId, entrada.eventoId);
  assert.equal(entrada.payload.eventoContraparteId, salida.eventoId);
  assert.deepEqual(
    salida.payload.impactoResumen,
    entrada.payload.impactoResumen,
    'Ambos lados deben compartir exactamente el mismo resumen.'
  );
  assert.deepEqual(salida.payload.impactoResumen, impactoEmpresa());
  assert.equal(web.tipo, 'usuario.sesion_invalidada');
  assert.equal(agente.tipo, 'agente.sesion_invalidada');
  for (const consecuencia of [web, agente]) {
    assert.equal(consecuencia.rolEvento, 'resultado');
    assert.equal(consecuencia.causalidad.id, salida.eventoId);
    assert.equal(consecuencia.correlacionId, salida.correlacionId);
    assert.equal(consecuencia.payload.causa, 'scope_cambiado');
  }
  assert.deepEqual(web.scope, { tenantId: '1', empresaId: '7', sitioId: null });
  assert.deepEqual(agente.scope, { tenantId: '1', empresaId: '7', sitioId: '9' });
  assert.deepEqual(salida.actorReal, { tipo: 'usuario', id: '31' });
  assert.deepEqual(salida.actorEfectivo, { tipo: 'usuario', id: '32' });
}

function verificarLoteSitio(lote) {
  assert.equal(lote.length, 3);
  const [salida, entrada] = lote;
  assert.equal(salida.claveCadena, 'organizacion:tenant:2');
  assert.equal(entrada.claveCadena, 'organizacion:tenant:2');
  assert.deepEqual(salida.scope, {
    tenantId: '2', empresaId: '7', sitioId: '9'
  });
  assert.deepEqual(entrada.scope, {
    tenantId: '2', empresaId: '8', sitioId: '9'
  });
  assert.equal(salida.rolEvento, 'salida');
  assert.equal(entrada.rolEvento, 'entrada');
  assert.equal(entrada.secuencia, salida.secuencia + 1);
}

class ClienteSqlEspia {
  constructor(trazas) {
    this.trazas = trazas;
  }

  async obtenerConexion() {
    return {
      execute: async () => { throw new Error('El fixture no usa SQL real.'); },
      beginTransaction: async () => this.trazas.push('begin'),
      commit: async () => this.trazas.push('commit'),
      rollback: async () => this.trazas.push('rollback'),
      release: async () => this.trazas.push('release')
    };
  }
}

class RepositorioMovimientosFixture {
  constructor(trazas) {
    this.trazas = trazas;
    this.rechazar = false;
  }

  async moverEmpresaEnTransaccion(datos, { conexion }) {
    exigirConexion(conexion);
    this.trazas.push('movimiento:empresa');
    if (this.rechazar || await datos.autorizar({ id: 7 }) !== true) {
      throw new Error('El scope bloqueado ya no autoriza mover la empresa.');
    }
    const recursoAnterior = {
      id: 7, tenantId: 1, nombre: datos.nombre, alias: datos.alias,
      cif: datos.cif, descripcion: datos.descripcion, estado: datos.estado,
      tenantNombre: 'Tenant origen'
    };
    return {
      recursoAnterior,
      recurso: {
        id: 7, tenantId: 2, nombre: datos.nombre, alias: datos.alias,
        cif: datos.cif, descripcion: datos.descripcion, estado: datos.estado,
        tenantNombre: 'Tenant destino'
      },
      scopeAnterior: { tenantId: '1', empresaId: '7', sitioId: null },
      scopePosterior: { tenantId: '2', empresaId: '7', sitioId: null },
      usuarios: ['10'],
      agentes: [
        {
          agenteId: '20', sesionAuditoriaId: generarUuidV7Auditoria(),
          scopeAnterior: { tenantId: '1', empresaId: '7', sitioId: '9' }
        },
        {
          agenteId: '21', sesionAuditoriaId: null,
          scopeAnterior: { tenantId: '1', empresaId: '7', sitioId: null }
        }
      ],
      impactoResumen: impactoEmpresa()
    };
  }

  async moverSitioEnTransaccion(datos, { conexion }) {
    exigirConexion(conexion);
    this.trazas.push('movimiento:sitio');
    if (await datos.autorizar({ id: 9 }) !== true) throw new Error('Sin autorización.');
    const recursoAnterior = {
      id: 9, tenantId: 2, empresaId: 7, nombre: 'Sitio anterior',
      alias: datos.alias, timezone: datos.timezone,
      descripcion: datos.descripcion, estado: datos.estado,
      tenantNombre: 'Tenant destino', empresaNombre: 'Empresa origen'
    };
    return {
      recursoAnterior,
      recurso: {
        id: 9, tenantId: 2, empresaId: 8, nombre: datos.nombre,
        alias: datos.alias, timezone: datos.timezone,
        descripcion: datos.descripcion, estado: datos.estado,
        tenantNombre: 'Tenant destino', empresaNombre: 'Empresa destino'
      },
      scopeAnterior: { tenantId: '2', empresaId: '7', sitioId: '9' },
      scopePosterior: { tenantId: '2', empresaId: '8', sitioId: '9' },
      usuarios: [],
      agentes: [],
      impactoResumen: {
        filasVivasActualizadasPorClase: { sitios: '1' },
        referenciasHistoricasActualizadasPorClase: {},
        descendientesPorClase: {}
      }
    };
  }
}

class RepositorioSesionesWebFixture {
  constructor(trazas) {
    this.trazas = trazas;
    this.sesiones = [{
      sesionAuditoriaId: generarUuidV7Auditoria(),
      scopeEfectivoActual: { tenantId: '1', empresaId: '7', sitioId: null }
    }];
  }

  async bloquearVigentesPorUsuarios(_usuarios, { conexion }) {
    exigirConexion(conexion);
    this.trazas.push('sesiones:bloquear');
    return this.sesiones;
  }

  async invalidarVigentesPorUsuariosEnTransaccion(_usuarios, { conexion }) {
    exigirConexion(conexion);
    this.trazas.push('sesiones:invalidar');
    return this.sesiones.map((sesion) => ({ ...sesion, estado: 'invalidada' }));
  }
}

class RepositorioAgentesFixture {
  constructor(trazas) {
    this.trazas = trazas;
    this.llamadas = [];
  }

  async crearInvalidacionPorMovimientoEnTransaccion(datos, { conexion }) {
    exigirConexion(conexion);
    this.trazas.push('agente:invalidar');
    this.llamadas.push({ tipo: 'invalidacion', scope: datos.scope });
    return { operacionId: datos.operacionId, estado: 'pendiente' };
  }

  async incrementarScopeYFencingEnTransaccion(agenteId, { conexion }) {
    exigirConexion(conexion);
    this.trazas.push('agente:version');
    this.llamadas.push({ tipo: 'solo_version', agenteId });
    return { agenteId, versionScopeAgente: '2', fencingToken: '2' };
  }
}

class RepositorioAuditoriaFixture {
  constructor(trazas) {
    this.trazas = trazas;
    this.lotes = [];
    this.secuencias = new Map();
  }

  async incorporarEnTransaccion(intenciones, { conexion }) {
    exigirConexion(conexion);
    this.trazas.push('auditoria:lote');
    const lote = intenciones.map((intencion) => ({ ...intencion }));
    const eventos = lote.map((intencion) => {
      const secuencia = (this.secuencias.get(intencion.claveCadena) || 0) + 1;
      this.secuencias.set(intencion.claveCadena, secuencia);
      intencion.secuencia = secuencia;
      return { eventoId: intencion.eventoId, estado: 'incorporado', secuencia };
    });
    this.lotes.push(lote);
    return { eventos, genesis: [], registradoEnUtc: '2026-07-24T20:00:00.000Z' };
  }
}

function impactoEmpresa() {
  return {
    filasVivasActualizadasPorClase: {
      empresas: '1', sitios: '2', usuarios: '1', agentes: '2'
    },
    referenciasHistoricasActualizadasPorClase: {},
    descendientesPorClase: { sitios: '2', usuarios: '1', agentes: '2' }
  };
}

function datosEmpresa() {
  return {
    idEmpresa: 7, tenantOrigenId: 1, tenantDestinoId: 2,
    nombre: 'Empresa', alias: 'empresa', cif: null,
    descripcion: null, estado: 'activo'
  };
}

function datosSitio() {
  return {
    idSitio: 9, tenantOrigenId: 2, empresaOrigenId: 7,
    tenantDestinoId: 2, empresaDestinoId: 8,
    nombre: 'Sitio', alias: 'sitio', timezone: 'Europe/Madrid',
    descripcion: null, estado: 'activo'
  };
}

function exigirConexion(conexion) {
  assert.equal(typeof conexion?.execute, 'function');
}

main().catch((error) => {
  console.error('[organizacion] Error verificando 5.21.7b.');
  console.error(error);
  process.exitCode = 1;
});

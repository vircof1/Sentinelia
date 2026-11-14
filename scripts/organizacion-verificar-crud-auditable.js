import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import {
  CATALOGO_TABLAS_SCOPE_ORGANIZATIVO,
  DENYLIST_TABLAS_SCOPE_ORGANIZATIVO,
  MANIFIESTO_FISICO_SCOPE_ORGANIZATIVO,
  verificarCoberturaFisicaScopeOrganizativo
} from '../paquetes/jerarquia-organizativa/src/CatalogoScopeOrganizativo.js';
import { ServicioCrudOrganizacionAuditable } from '../paquetes/jerarquia-organizativa/src/ServicioCrudOrganizacionAuditable.js';
import { ServicioAuditoriaOperativa } from '../paquetes/auditoria/src/ServicioAuditoriaOperativa.js';
import { FronteraTransaccionalLocal } from '../paquetes/persistencia-sql/src/FronteraTransaccionalLocal.js';

async function main() {
  const cobertura = await verificarCatalogoFisico();
  const crud = await verificarCrudAuditable();
  console.log(
    `[organizacion] OK 5.21.7a: tablas_scope=${cobertura.total} ` +
    `protegidas=${cobertura.protegidas} operaciones=${crud.operaciones} ` +
    `eventos=${crud.eventos} no_ops=${crud.noOps}`
  );
}

async function verificarCatalogoFisico() {
  const tablasFisicas = await descubrirTablasConScope();
  const resultado = verificarCoberturaFisicaScopeOrganizativo(tablasFisicas);
  assert.deepEqual(resultado, {
    total: 31,
    vivas: 11,
    historicas: 5,
    tecnicasMutables: 2,
    protegidas: 13,
    sinDisposicion: []
  });
  const catalogoGenerico = new Set(
    CATALOGO_TABLAS_SCOPE_ORGANIZATIVO.map(({ tabla }) => tabla)
  );
  for (const tabla of DENYLIST_TABLAS_SCOPE_ORGANIZATIVO) {
    assert.equal(catalogoGenerico.has(tabla), false, `${tabla} entró en la cascada genérica.`);
  }
  for (const entrada of MANIFIESTO_FISICO_SCOPE_ORGANIZATIVO) {
    if (entrada.clasificacion === 'persistencia_protegida') {
      assert.equal(entrada.disposicion, 'fuera_cascada');
      assert.ok(DENYLIST_TABLAS_SCOPE_ORGANIZATIVO.includes(entrada.tabla));
    } else {
      assert.equal(entrada.disposicion, 'participa_cascada');
    }
  }
  assert.throws(
    () => verificarCoberturaFisicaScopeOrganizativo([...tablasFisicas, 'scope_huerfano']),
    /scope_huerfano/
  );
  assert.throws(
    () => verificarCoberturaFisicaScopeOrganizativo(tablasFisicas.slice(1)),
    /Ausentes en esquema/
  );
  return resultado;
}

async function descubrirTablasConScope() {
  const directorio = new URL('../migraciones/sql/', import.meta.url);
  const archivos = (await readdir(directorio))
    .filter((archivo) => archivo.endsWith('.sql'))
    .sort();
  const tablas = new Set();
  const protegidasDeclaradas = new Set(
    MANIFIESTO_FISICO_SCOPE_ORGANIZATIVO
      .filter((entrada) => entrada.clasificacion === 'persistencia_protegida')
      .map((entrada) => entrada.tabla)
  );
  for (const archivo of archivos) {
    const sql = (await readFile(new URL(archivo, directorio), 'utf8')).replaceAll('`', '');
    for (const coincidencia of sql.matchAll(
      /CREATE TABLE\s+(?:IF NOT EXISTS\s+)?([a-z0-9_]+)\s*\(([\s\S]*?)\)\s*(?:ENGINE[^;]*)?;/gi
    )) {
      const columnasScopeOrdinarias =
        /\b(tenant_id|empresa_id|sitio_id)\s+(BIGINT|INT|CHAR|BINARY|VARCHAR)\b/i
          .test(coincidencia[2]);
      const scopeProtegido =
        protegidasDeclaradas.has(coincidencia[1]) &&
        /\bscope_tenant_id\s+BIGINT\b/i.test(coincidencia[2]);
      if (columnasScopeOrdinarias || scopeProtegido) {
        tablas.add(coincidencia[1]);
      }
    }
    for (const coincidencia of sql.matchAll(/ALTER TABLE\s+`?([a-z0-9_]+)`?([\s\S]*?);/gi)) {
      if (/ADD COLUMN\s+(tenant_id|empresa_id|sitio_id)\b/i.test(coincidencia[2])) {
        tablas.add(coincidencia[1]);
      }
    }
    for (const coincidencia of sql.matchAll(
      /DROP TABLE IF EXISTS\s+`?([a-z0-9_]+)`?\s*;/gi
    )) {
      tablas.delete(coincidencia[1]);
    }
  }
  return [...tablas].sort();
}

async function verificarCrudAuditable() {
  const trazas = [];
  const conexiones = [];
  const clienteSql = {
    async obtenerConexion() {
      const conexion = crearConexionEspia(trazas);
      conexiones.push(conexion);
      return conexion;
    }
  };
  const repositorioCrud = new RepositorioCrudMemoria(trazas);
  const repositorioAuditoria = new RepositorioAuditoriaMemoria(trazas);
  const servicio = new ServicioCrudOrganizacionAuditable({
    fronteraTransaccional: new FronteraTransaccionalLocal(clienteSql),
    repositorioCrud,
    servicioAuditoria: new ServicioAuditoriaOperativa({ repositorioAuditoria }),
    servicioAutoridadMutacionesEstructurales: {
      async serializarAltaEnTransaccion({ scopePadre }) {
        trazas.push(`autoridad:alta:${scopePadre.empresaId ? 'empresa' : 'tenant'}`);
      }
    },
    ahora: () => new Date('2026-07-24T08:30:00.000Z')
  });
  const contextoUsuarioActual = { idUsuarioReal: 41, idUsuario: 42 };

  const tenant = await servicio.crear({
    entidad: 'tenant',
    datos: datosTenant(),
    contextoUsuarioActual
  });
  const empresa = await servicio.crear({
    entidad: 'empresa',
    datos: datosEmpresa(tenant.id),
    contextoUsuarioActual
  });
  const sitio = await servicio.crear({
    entidad: 'sitio',
    datos: datosSitio(tenant.id, empresa.id),
    contextoUsuarioActual
  });

  const tenantActualizado = await servicio.actualizar({
    entidad: 'tenant', id: tenant.id,
    datos: { ...datosTenant(), alias: 'norte-operativo' },
    contextoUsuarioActual,
    autorizar: () => true
  });
  const empresaActualizada = await servicio.actualizar({
    entidad: 'empresa', id: empresa.id,
    datos: {
      nombre: 'Operaciones Norte', alias: 'ops', cif: 'B76543210',
      descripcion: null, estado: 'activo'
    },
    contextoUsuarioActual,
    autorizar: () => true
  });
  const sitioActualizado = await servicio.actualizar({
    entidad: 'sitio', id: sitio.id,
    datos: {
      nombre: 'Centro Bilbao', alias: 'bilbao', timezone: 'Europe/Paris',
      descripcion: 'Centro principal', estado: 'activo'
    },
    contextoUsuarioActual,
    autorizar: () => true
  });

  const eventosAntesNoOp = repositorioAuditoria.eventos.length;
  const actualizacionesAntesNoOp = repositorioCrud.actualizaciones;
  await servicio.actualizar({
    entidad: 'tenant', id: tenant.id,
    datos: datosActualizacion('tenant', tenantActualizado),
    contextoUsuarioActual,
    autorizar: () => true
  });
  await servicio.actualizar({
    entidad: 'empresa', id: empresa.id,
    datos: datosActualizacion('empresa', empresaActualizada),
    contextoUsuarioActual,
    autorizar: () => true
  });
  await servicio.actualizar({
    entidad: 'sitio', id: sitio.id,
    datos: datosActualizacion('sitio', sitioActualizado),
    contextoUsuarioActual,
    autorizar: () => true
  });
  assert.equal(repositorioAuditoria.eventos.length, eventosAntesNoOp);
  assert.equal(repositorioCrud.actualizaciones, actualizacionesAntesNoOp);

  assert.deepEqual(
    repositorioAuditoria.eventos.map(({ tipo }) => tipo),
    [
      'organizacion.tenant_creado', 'organizacion.empresa_creada',
      'organizacion.sitio_creado', 'organizacion.tenant_actualizado',
      'organizacion.empresa_actualizada', 'organizacion.sitio_actualizado'
    ]
  );
  assert.deepEqual(
    repositorioAuditoria.eventos.slice(3).map(({ payload }) => payload.camposCambiados),
    [['alias'], ['cif', 'nombre'], ['descripcion', 'nombre', 'timezone']]
  );
  for (const evento of repositorioAuditoria.eventos) {
    assert.deepEqual(evento.actorReal, { tipo: 'usuario', id: '41' });
    assert.deepEqual(evento.actorEfectivo, { tipo: 'usuario', id: '42' });
    assert.equal(evento.modoActuacion, 'impersonado');
  }

  await assert.rejects(
    servicio.actualizar({
      entidad: 'tenant', id: tenant.id,
      datos: datosActualizacion('tenant', tenantActualizado),
      contextoUsuarioActual,
      autorizar: () => false
    }),
    /scope actual ya no autoriza/
  );
  assert.deepEqual(
    trazas.slice(-4),
    ['begin', 'bloquear:tenant', 'rollback', 'release']
  );

  await assert.rejects(
    servicio.crear({
      entidad: 'tenant',
      datos: { ...datosTenant(), secretoSmtp: 'prohibido' },
      contextoUsuarioActual
    }),
    /Perfil crear de tenant inválido/
  );
  assert.equal(conexiones.length, 10, 'Un perfil rechazado no debe abrir transacción.');
  assert.equal(trazas.filter((traza) => traza === 'begin').length, 10);
  assert.equal(trazas.filter((traza) => traza === 'commit').length, 9);
  assert.equal(trazas.filter((traza) => traza === 'rollback').length, 1);
  assert.equal(trazas.filter((traza) => traza === 'release').length, 10);
  return { operaciones: 10, eventos: repositorioAuditoria.eventos.length, noOps: 3 };
}

class RepositorioCrudMemoria {
  constructor(trazas) {
    this.trazas = trazas;
    this.ids = { tenant: 0, empresa: 0, sitio: 0 };
    this.datos = {
      tenant: new Map(), empresa: new Map(), sitio: new Map()
    };
    this.actualizaciones = 0;
  }

  async crearEnTransaccion(entidad, datos, { conexion }) {
    exigirConexion(conexion);
    this.trazas.push(`crear:${entidad}`);
    const id = ++this.ids[entidad];
    const recurso = { id, ...datos };
    this.datos[entidad].set(id, recurso);
    return { ...recurso };
  }

  async buscarBloqueadoEnTransaccion(entidad, id, { conexion }) {
    exigirConexion(conexion);
    this.trazas.push(`bloquear:${entidad}`);
    const recurso = this.datos[entidad].get(Number(id));
    return recurso ? { ...recurso } : null;
  }

  async actualizarEnTransaccion(entidad, id, datos, { conexion }) {
    exigirConexion(conexion);
    this.trazas.push(`actualizar:${entidad}`);
    const recurso = { ...this.datos[entidad].get(Number(id)), ...datos };
    this.datos[entidad].set(Number(id), recurso);
    this.actualizaciones += 1;
    return { ...recurso };
  }
}

class RepositorioAuditoriaMemoria {
  constructor(trazas) {
    this.trazas = trazas;
    this.eventos = [];
  }

  async incorporarEnTransaccion(intenciones, { conexion }) {
    exigirConexion(conexion);
    this.trazas.push('auditar');
    this.eventos.push(...intenciones);
    return {
      eventos: intenciones.map((intencion) => ({
        eventoId: intencion.eventoId,
        estado: 'incorporado'
      })),
      genesis: [],
      registradoEnUtc: '2026-07-24T08:30:00.000Z'
    };
  }
}

function crearConexionEspia(trazas) {
  return {
    async beginTransaction() { trazas.push('begin'); },
    async commit() { trazas.push('commit'); },
    async rollback() { trazas.push('rollback'); },
    async release() { trazas.push('release'); },
    async execute() { throw new Error('El fixture no debe ejecutar SQL real.'); }
  };
}

function exigirConexion(conexion) {
  assert.equal(typeof conexion?.execute, 'function', 'Falta la conexión prestada.');
}

function datosTenant() {
  return {
    nombre: 'Norte', alias: 'norte', descripcion: null, estado: 'activo'
  };
}

function datosEmpresa(tenantId) {
  return {
    tenantId, nombre: 'Operaciones', alias: 'ops', cif: null,
    descripcion: null, estado: 'activo'
  };
}

function datosSitio(tenantId, empresaId) {
  return {
    tenantId, empresaId, nombre: 'Bilbao', alias: 'bilbao',
    timezone: 'Europe/Madrid', descripcion: null, estado: 'activo'
  };
}

function datosActualizacion(entidad, recurso) {
  const comunes = {
    nombre: recurso.nombre,
    alias: recurso.alias,
    descripcion: recurso.descripcion,
    estado: recurso.estado
  };
  if (entidad === 'empresa') return { ...comunes, cif: recurso.cif };
  if (entidad === 'sitio') return { ...comunes, timezone: recurso.timezone };
  return comunes;
}

main().catch((error) => {
  console.error('[organizacion] Error verificando 5.21.7a.');
  console.error(error);
  process.exitCode = 1;
});

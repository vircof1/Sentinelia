import { bytesAUuidV7Auditoria } from '../../auditoria/src/UuidV7Auditoria.js';
import {
  CATALOGO_TABLAS_SCOPE_ORGANIZATIVO,
  resolverClaseSemanticaScopeOrganizativo,
  resolverDisposicionFisicaScopeOrganizativo
} from './CatalogoScopeOrganizativo.js';
import { Empresa } from './Empresa.js';
import { Sitio } from './Sitio.js';

const CLASES_DESCENDIENTES = new Set([
  'sitios', 'usuarios', 'agentes', 'reglas_telemetria', 'monitores',
  'alertas_activas', 'triggers', 'zonas_dns', 'registros_dns'
]);

export class RepositorioMovimientosOrganizativos {
  async moverEmpresaEnTransaccion(datos = {}, { conexion } = {}) {
    exigirConexion(conexion);
    const idEmpresa = idPositivo(datos.idEmpresa, 'idEmpresa');
    const tenantOrigenId = idPositivo(datos.tenantOrigenId, 'tenantOrigenId');
    const tenantDestinoId = idPositivo(datos.tenantDestinoId, 'tenantDestinoId');
    await bloquearIds(conexion, 'tenants', [tenantOrigenId, tenantDestinoId]);
    const empresa = await bloquearEmpresa(conexion, idEmpresa);
    if (Number(empresa.tenant_id) !== tenantOrigenId) {
      throw new Error('La empresa cambió de tenant antes de adquirir el bloqueo.');
    }
    if (await datos.autorizar(new Empresa(empresa)) !== true) {
      throw new Error('El scope bloqueado ya no autoriza mover la empresa.');
    }
    await exigirAliasEmpresaLibre(conexion, {
      idEmpresa, tenantDestinoId, alias: datos.alias
    });
    const usuarios = await bloquearUsuarios(conexion, 'empresa_id', idEmpresa);
    const agentes = await bloquearAgentes(conexion, 'empresa_id', idEmpresa);
    const impacto = crearImpacto();
    await conForeignKeysSuspendidas(conexion, async () => {
      const [raiz] = await conexion.execute(
        `UPDATE empresas SET tenant_id = ?, nombre = ?, alias = ?, cif = ?,
          descripcion = ?, estado = ? WHERE id = ?`,
        [
          tenantDestinoId, datos.nombre, datos.alias, datos.cif ?? null,
          datos.descripcion ?? null, datos.estado, idEmpresa
        ]
      );
      exigirUnaFila(raiz, 'empresa');
      sumarImpacto(impacto, 'empresas', 'viva', raiz.affectedRows, false);
      await actualizarCascadaEmpresa(conexion, {
        idEmpresa, tenantDestinoId, impacto
      });
      await verificarCascadaEmpresa(conexion, { idEmpresa, tenantDestinoId });
    });
    return Object.freeze({
      recursoAnterior: new Empresa(empresa),
      recurso: await buscarEmpresaBloqueada(conexion, idEmpresa),
      scopeAnterior: scopeEmpresa(tenantOrigenId, idEmpresa),
      scopePosterior: scopeEmpresa(tenantDestinoId, idEmpresa),
      usuarios: Object.freeze(usuarios),
      agentes: Object.freeze(agentes),
      impactoResumen: congelarImpacto(impacto)
    });
  }

  async moverSitioEnTransaccion(datos = {}, { conexion } = {}) {
    exigirConexion(conexion);
    const idSitio = idPositivo(datos.idSitio, 'idSitio');
    const empresaOrigenId = idPositivo(datos.empresaOrigenId, 'empresaOrigenId');
    const empresaDestinoId = idPositivo(datos.empresaDestinoId, 'empresaDestinoId');
    const tenantOrigenId = idPositivo(datos.tenantOrigenId, 'tenantOrigenId');
    const tenantDestinoId = idPositivo(datos.tenantDestinoId, 'tenantDestinoId');
    await bloquearIds(conexion, 'tenants', [tenantOrigenId, tenantDestinoId]);
    await bloquearIds(conexion, 'empresas', [empresaOrigenId, empresaDestinoId]);
    const sitio = await bloquearSitio(conexion, idSitio);
    if (
      Number(sitio.tenant_id) !== tenantOrigenId ||
      Number(sitio.empresa_id) !== empresaOrigenId
    ) {
      throw new Error('El sitio cambió de scope antes de adquirir el bloqueo.');
    }
    const destino = await buscarEmpresaBloqueada(conexion, empresaDestinoId);
    if (Number(destino.tenantId) !== tenantDestinoId) {
      throw new Error('La empresa de destino ya no pertenece al tenant esperado.');
    }
    if (await datos.autorizar(new Sitio(sitio)) !== true) {
      throw new Error('El scope bloqueado ya no autoriza mover el sitio.');
    }
    await exigirAliasSitioLibre(conexion, {
      idSitio, empresaDestinoId, alias: datos.alias
    });
    const usuarios = await bloquearUsuarios(conexion, 'sitio_id', idSitio);
    const agentes = await bloquearAgentes(conexion, 'sitio_id', idSitio);
    const impacto = crearImpacto();
    await conForeignKeysSuspendidas(conexion, async () => {
      const [raiz] = await conexion.execute(
        `UPDATE sitios SET tenant_id = ?, empresa_id = ?, nombre = ?, alias = ?,
          timezone = ?, descripcion = ?, estado = ? WHERE id = ?`,
        [
          tenantDestinoId, empresaDestinoId, datos.nombre, datos.alias,
          datos.timezone, datos.descripcion ?? null, datos.estado, idSitio
        ]
      );
      exigirUnaFila(raiz, 'sitio');
      sumarImpacto(impacto, 'sitios', 'viva', raiz.affectedRows, false);
      await actualizarCascadaSitio(conexion, {
        idSitio, tenantDestinoId, empresaDestinoId, impacto
      });
      await verificarCascadaSitio(conexion, {
        idSitio, tenantDestinoId, empresaDestinoId
      });
    });
    return Object.freeze({
      recursoAnterior: new Sitio(sitio),
      recurso: await buscarSitioBloqueado(conexion, idSitio),
      scopeAnterior: scopeSitio(tenantOrigenId, empresaOrigenId, idSitio),
      scopePosterior: scopeSitio(tenantDestinoId, empresaDestinoId, idSitio),
      usuarios: Object.freeze(usuarios),
      agentes: Object.freeze(agentes),
      impactoResumen: congelarImpacto(impacto)
    });
  }
}

async function actualizarCascadaEmpresa(conexion, { idEmpresa, tenantDestinoId, impacto }) {
  for (const entrada of CATALOGO_TABLAS_SCOPE_ORGANIZATIVO) {
    if (entrada.tabla === 'empresas' || !entrada.columnasScope.includes('empresa_id')) continue;
    const [resultado] = entrada.tabla === 'ejecuciones_triggers'
      ? await actualizarEjecucionesEmpresa(conexion, idEmpresa, tenantDestinoId)
      : await conexion.execute(
        `UPDATE ${entrada.tabla} SET tenant_id = ? WHERE empresa_id = ?`,
        [tenantDestinoId, idEmpresa]
      );
    registrarResultado(impacto, entrada.tabla, resultado.affectedRows, true);
  }
}

async function actualizarCascadaSitio(
  conexion,
  { idSitio, tenantDestinoId, empresaDestinoId, impacto }
) {
  for (const entrada of CATALOGO_TABLAS_SCOPE_ORGANIZATIVO) {
    if (entrada.tabla === 'sitios' || !entrada.columnasScope.includes('sitio_id')) continue;
    const [resultado] = entrada.tabla === 'ejecuciones_triggers'
      ? await actualizarEjecucionesSitio(
        conexion, idSitio, tenantDestinoId, empresaDestinoId
      )
      : await conexion.execute(
        `UPDATE ${entrada.tabla} SET tenant_id = ?, empresa_id = ? WHERE sitio_id = ?`,
        [tenantDestinoId, empresaDestinoId, idSitio]
      );
    registrarResultado(impacto, entrada.tabla, resultado.affectedRows, true);
  }
}

function registrarResultado(impacto, tabla, total, descendiente) {
  const disposicion = resolverDisposicionFisicaScopeOrganizativo(tabla);
  sumarImpacto(
    impacto,
    resolverClaseSemanticaScopeOrganizativo(tabla),
    disposicion.clasificacion,
    total,
    descendiente
  );
}

function sumarImpacto(impacto, clase, clasificacion, total, descendiente) {
  const cantidad = BigInt(total || 0);
  if (cantidad === 0n) return;
  const dimension = clasificacion === 'historica'
    ? 'referenciasHistoricasActualizadasPorClase'
    : 'filasVivasActualizadasPorClase';
  impacto[dimension][clase] = cantidad.toString();
  if (descendiente && CLASES_DESCENDIENTES.has(clase)) {
    impacto.descendientesPorClase[clase] = cantidad.toString();
  }
}

function crearImpacto() {
  return {
    filasVivasActualizadasPorClase: {},
    referenciasHistoricasActualizadasPorClase: {},
    descendientesPorClase: {}
  };
}

function congelarImpacto(impacto) {
  return Object.freeze(Object.fromEntries(
    Object.entries(impacto).map(([dimension, contadores]) => [
      dimension, Object.freeze({ ...contadores })
    ])
  ));
}

async function bloquearIds(conexion, tabla, ids) {
  const ordenados = [...new Set(ids)].sort((a, b) => a - b);
  const [filas] = await conexion.execute(
    `SELECT id FROM ${tabla} WHERE id IN (${ordenados.map(() => '?').join(', ')})
      ORDER BY id FOR UPDATE`,
    ordenados
  );
  if (filas.length !== ordenados.length) {
    throw new Error(`No existe alguna fila requerida en ${tabla}.`);
  }
}

async function bloquearEmpresa(conexion, idEmpresa) {
  const [filas] = await conexion.execute(
    `SELECT e.*, t.nombre AS tenant_nombre FROM empresas e
      INNER JOIN tenants t ON t.id = e.tenant_id
      WHERE e.id = ? LIMIT 1 FOR UPDATE`,
    [idEmpresa]
  );
  if (filas.length !== 1) throw new Error('La empresa ya no existe.');
  return filas[0];
}

async function bloquearSitio(conexion, idSitio) {
  const [filas] = await conexion.execute(
    `SELECT s.*, t.nombre AS tenant_nombre, e.nombre AS empresa_nombre
      FROM sitios s INNER JOIN tenants t ON t.id = s.tenant_id
      INNER JOIN empresas e ON e.id = s.empresa_id
      WHERE s.id = ? LIMIT 1 FOR UPDATE`,
    [idSitio]
  );
  if (filas.length !== 1) throw new Error('El sitio ya no existe.');
  return filas[0];
}

async function bloquearUsuarios(conexion, columna, id) {
  const [filas] = await conexion.execute(
    `SELECT CAST(id AS CHAR) AS id FROM usuarios WHERE ${columna} = ?
      ORDER BY id FOR UPDATE`,
    [id]
  );
  return filas.map(({ id: valor }) => String(valor));
}

async function bloquearAgentes(conexion, columna, id) {
  const [filas] = await conexion.execute(
    `SELECT CAST(id AS CHAR) AS id, sesion_auditoria_id,
      CAST(tenant_id AS CHAR) AS tenant_id,
      CAST(empresa_id AS CHAR) AS empresa_id,
      CAST(sitio_id AS CHAR) AS sitio_id
      FROM agentes_sentinelia WHERE ${columna} = ? ORDER BY id FOR UPDATE`,
    [id]
  );
  return filas.map((fila) => Object.freeze({
    agenteId: String(fila.id),
    sesionAuditoriaId: fila.sesion_auditoria_id
      ? bytesAUuidV7Auditoria(fila.sesion_auditoria_id) : null,
    scopeAnterior: Object.freeze({
      tenantId: String(fila.tenant_id),
      empresaId: String(fila.empresa_id),
      sitioId: fila.sitio_id == null ? null : String(fila.sitio_id)
    })
  }));
}

async function exigirAliasEmpresaLibre(conexion, { idEmpresa, tenantDestinoId, alias }) {
  const [filas] = await conexion.execute(
    `SELECT id FROM empresas WHERE tenant_id = ? AND alias = ? AND id <> ?
      ORDER BY id LIMIT 1 FOR UPDATE`,
    [tenantDestinoId, alias, idEmpresa]
  );
  if (filas.length) duplicado('empresa');
}

async function exigirAliasSitioLibre(conexion, { idSitio, empresaDestinoId, alias }) {
  const [filas] = await conexion.execute(
    `SELECT id FROM sitios WHERE empresa_id = ? AND alias = ? AND id <> ?
      ORDER BY id LIMIT 1 FOR UPDATE`,
    [empresaDestinoId, alias, idSitio]
  );
  if (filas.length) duplicado('sitio');
}

function duplicado(entidad) {
  const error = new Error(`Ya existe otra ${entidad} con ese alias en destino.`);
  error.code = 'ER_DUP_ENTRY';
  throw error;
}

async function conForeignKeysSuspendidas(conexion, trabajo) {
  await conexion.execute('SET FOREIGN_KEY_CHECKS = 0');
  try {
    return await trabajo();
  } finally {
    await conexion.execute('SET FOREIGN_KEY_CHECKS = 1');
  }
}

async function verificarCascadaEmpresa(conexion, { idEmpresa, tenantDestinoId }) {
  for (const entrada of CATALOGO_TABLAS_SCOPE_ORGANIZATIVO) {
    if (!entrada.columnasScope.includes('empresa_id') ||
        entrada.tabla === 'ejecuciones_triggers') continue;
    const [[fila]] = await conexion.execute(
      `SELECT COUNT(*) AS total FROM ${entrada.tabla}
        WHERE empresa_id = ? AND NOT (tenant_id <=> ?)`,
      [idEmpresa, tenantDestinoId]
    );
    if (Number(fila.total) !== 0) throw new Error(`Cascada incompleta en ${entrada.tabla}.`);
  }
  const [[ejecuciones]] = await conexion.execute(
    `SELECT COUNT(*) AS total FROM ejecuciones_triggers WHERE
      (empresa_id = ? AND NOT (tenant_id <=> ?)) OR
      (monitor_empresa_id = ? AND NOT (monitor_tenant_id <=> ?)) OR
      (trigger_empresa_id = ? AND NOT (trigger_tenant_id <=> ?))`,
    [
      idEmpresa, tenantDestinoId, idEmpresa, tenantDestinoId,
      idEmpresa, tenantDestinoId
    ]
  );
  if (Number(ejecuciones.total) !== 0) {
    throw new Error('Cascada incompleta en ejecuciones_triggers.');
  }
}

async function verificarCascadaSitio(
  conexion,
  { idSitio, tenantDestinoId, empresaDestinoId }
) {
  for (const entrada of CATALOGO_TABLAS_SCOPE_ORGANIZATIVO) {
    if (!entrada.columnasScope.includes('sitio_id') ||
        entrada.tabla === 'ejecuciones_triggers') continue;
    const [[fila]] = await conexion.execute(
      `SELECT COUNT(*) AS total FROM ${entrada.tabla} WHERE sitio_id = ? AND
        (NOT (tenant_id <=> ?) OR NOT (empresa_id <=> ?))`,
      [idSitio, tenantDestinoId, empresaDestinoId]
    );
    if (Number(fila.total) !== 0) throw new Error(`Cascada incompleta en ${entrada.tabla}.`);
  }
  const [[ejecuciones]] = await conexion.execute(
    `SELECT COUNT(*) AS total FROM ejecuciones_triggers WHERE
      (sitio_id = ? AND
        (NOT (tenant_id <=> ?) OR NOT (empresa_id <=> ?))) OR
      (monitor_sitio_id = ? AND
        (NOT (monitor_tenant_id <=> ?) OR NOT (monitor_empresa_id <=> ?))) OR
      (trigger_sitio_id = ? AND
        (NOT (trigger_tenant_id <=> ?) OR NOT (trigger_empresa_id <=> ?)))`,
    [
      idSitio, tenantDestinoId, empresaDestinoId,
      idSitio, tenantDestinoId, empresaDestinoId,
      idSitio, tenantDestinoId, empresaDestinoId
    ]
  );
  if (Number(ejecuciones.total) !== 0) {
    throw new Error('Cascada incompleta en ejecuciones_triggers.');
  }
}

async function actualizarEjecucionesEmpresa(conexion, id, tenantId) {
  return conexion.execute(
    `UPDATE ejecuciones_triggers SET
      tenant_id = IF(empresa_id = ?, ?, tenant_id),
      monitor_tenant_id = IF(monitor_empresa_id = ?, ?, monitor_tenant_id),
      trigger_tenant_id = IF(trigger_empresa_id = ?, ?, trigger_tenant_id)
      WHERE empresa_id = ? OR monitor_empresa_id = ? OR trigger_empresa_id = ?`,
    [id, tenantId, id, tenantId, id, tenantId, id, id, id]
  );
}

async function actualizarEjecucionesSitio(conexion, id, tenantId, empresaId) {
  return conexion.execute(
    `UPDATE ejecuciones_triggers SET
      tenant_id = IF(sitio_id = ?, ?, tenant_id),
      empresa_id = IF(sitio_id = ?, ?, empresa_id),
      monitor_tenant_id = IF(monitor_sitio_id = ?, ?, monitor_tenant_id),
      monitor_empresa_id = IF(monitor_sitio_id = ?, ?, monitor_empresa_id),
      trigger_tenant_id = IF(trigger_sitio_id = ?, ?, trigger_tenant_id),
      trigger_empresa_id = IF(trigger_sitio_id = ?, ?, trigger_empresa_id)
      WHERE sitio_id = ? OR monitor_sitio_id = ? OR trigger_sitio_id = ?`,
    [
      id, tenantId, id, empresaId, id, tenantId, id, empresaId,
      id, tenantId, id, empresaId, id, id, id
    ]
  );
}

async function buscarEmpresaBloqueada(conexion, id) {
  return new Empresa(await bloquearEmpresa(conexion, id));
}

async function buscarSitioBloqueado(conexion, id) {
  return new Sitio(await bloquearSitio(conexion, id));
}

function scopeEmpresa(tenantId, empresaId) {
  return Object.freeze({
    tenantId: String(tenantId), empresaId: String(empresaId), sitioId: null
  });
}

function scopeSitio(tenantId, empresaId, sitioId) {
  return Object.freeze({
    tenantId: String(tenantId), empresaId: String(empresaId), sitioId: String(sitioId)
  });
}

function exigirUnaFila(resultado, entidad) {
  if (Number(resultado.affectedRows) !== 1) {
    throw new Error(`No se pudo mover ${entidad} dentro de la transacción.`);
  }
}

function exigirConexion(conexion) {
  if (typeof conexion?.execute !== 'function') {
    throw new Error('El movimiento organizativo exige una conexión prestada.');
  }
}

function idPositivo(valor, nombre) {
  const numero = Number(valor);
  if (!Number.isSafeInteger(numero) || numero <= 0) {
    throw new Error(`${nombre} debe ser un id positivo.`);
  }
  return numero;
}

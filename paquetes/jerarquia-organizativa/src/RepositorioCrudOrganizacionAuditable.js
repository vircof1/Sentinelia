import { Empresa } from './Empresa.js';
import { Sitio } from './Sitio.js';
import { Tenant } from './Tenant.js';

const ENTIDADES = new Set(['tenant', 'empresa', 'sitio']);

export class RepositorioCrudOrganizacionAuditable {
  async crearEnTransaccion(entidad, datos, { conexion } = {}) {
    validarEntrada(entidad, conexion);
    if (entidad === 'empresa') await bloquearTenant(conexion, datos.tenantId);
    if (entidad === 'sitio') {
      const empresa = await bloquearEmpresa(conexion, datos.empresaId);
      if (String(empresa.tenant_id) !== String(datos.tenantId)) {
        throw new Error('La empresa seleccionada no pertenece al tenant declarado.');
      }
    }
    const definicion = DEFINICIONES[entidad];
    const valores = definicion.camposCrear.map((campo) => valorSql(datos[campo]));
    const [resultado] = await conexion.execute(definicion.insertar, valores);
    return this.buscarBloqueadoEnTransaccion(entidad, resultado.insertId, { conexion });
  }

  async actualizarEnTransaccion(entidad, id, datos, { conexion } = {}) {
    validarEntrada(entidad, conexion);
    const definicion = DEFINICIONES[entidad];
    const valores = definicion.camposActualizar.map((campo) => valorSql(datos[campo]));
    const [resultado] = await conexion.execute(definicion.actualizar, [...valores, id]);
    if (Number(resultado.affectedRows) !== 1) {
      throw new Error(`No se pudo actualizar ${entidad} dentro de la transacción auditable.`);
    }
    return this.buscarBloqueadoEnTransaccion(entidad, id, { conexion });
  }

  async buscarBloqueadoEnTransaccion(entidad, id, { conexion } = {}) {
    validarEntrada(entidad, conexion);
    const definicion = DEFINICIONES[entidad];
    const [filas] = await conexion.execute(definicion.seleccionar, [id]);
    if (filas.length !== 1) return null;
    return new definicion.Clase(filas[0]);
  }
}

const DEFINICIONES = Object.freeze({
  tenant: Object.freeze({
    Clase: Tenant,
    camposCrear: ['nombre', 'alias', 'descripcion', 'estado'],
    camposActualizar: ['nombre', 'alias', 'descripcion', 'estado'],
    insertar: `INSERT INTO tenants (nombre, alias, descripcion, estado, configuracion)
      VALUES (?, ?, ?, ?, NULL)`,
    actualizar: `UPDATE tenants SET nombre = ?, alias = ?, descripcion = ?, estado = ?
      WHERE id = ?`,
    seleccionar: `SELECT t.* FROM tenants t WHERE t.id = ? LIMIT 1 FOR UPDATE`
  }),
  empresa: Object.freeze({
    Clase: Empresa,
    camposCrear: ['tenantId', 'nombre', 'alias', 'cif', 'descripcion', 'estado'],
    camposActualizar: ['nombre', 'alias', 'cif', 'descripcion', 'estado'],
    insertar: `INSERT INTO empresas
      (tenant_id, nombre, alias, cif, descripcion, estado, configuracion)
      VALUES (?, ?, ?, ?, ?, ?, NULL)`,
    actualizar: `UPDATE empresas SET nombre = ?, alias = ?, cif = ?, descripcion = ?, estado = ?
      WHERE id = ?`,
    seleccionar: `SELECT e.*, t.nombre AS tenant_nombre FROM empresas e
      INNER JOIN tenants t ON t.id = e.tenant_id
      WHERE e.id = ? LIMIT 1 FOR UPDATE`
  }),
  sitio: Object.freeze({
    Clase: Sitio,
    camposCrear: ['tenantId', 'empresaId', 'nombre', 'alias', 'timezone', 'descripcion', 'estado'],
    camposActualizar: ['nombre', 'alias', 'timezone', 'descripcion', 'estado'],
    insertar: `INSERT INTO sitios
      (tenant_id, empresa_id, nombre, alias, timezone, descripcion, estado, configuracion)
      VALUES (?, ?, ?, ?, ?, ?, ?, NULL)`,
    actualizar: `UPDATE sitios SET nombre = ?, alias = ?, timezone = ?, descripcion = ?, estado = ?
      WHERE id = ?`,
    seleccionar: `SELECT s.*, t.nombre AS tenant_nombre, e.nombre AS empresa_nombre
      FROM sitios s INNER JOIN tenants t ON t.id = s.tenant_id
      INNER JOIN empresas e ON e.id = s.empresa_id
      WHERE s.id = ? LIMIT 1 FOR UPDATE`
  })
});

async function bloquearTenant(conexion, tenantId) {
  const [filas] = await conexion.execute(
    'SELECT id FROM tenants WHERE id = ? LIMIT 1 FOR UPDATE', [tenantId]
  );
  if (filas.length !== 1) throw new Error('El tenant padre ya no existe.');
}

async function bloquearEmpresa(conexion, empresaId) {
  const [filas] = await conexion.execute(
    'SELECT id, tenant_id FROM empresas WHERE id = ? LIMIT 1 FOR UPDATE', [empresaId]
  );
  if (filas.length !== 1) throw new Error('La empresa padre ya no existe.');
  return filas[0];
}

function validarEntrada(entidad, conexion) {
  if (!ENTIDADES.has(entidad)) throw new Error('Entidad organizativa no soportada.');
  if (typeof conexion?.execute !== 'function') {
    throw new Error('El CRUD organizativo auditable exige una conexión prestada.');
  }
}

function valorSql(valor) {
  return valor === undefined || valor === '' ? null : valor;
}

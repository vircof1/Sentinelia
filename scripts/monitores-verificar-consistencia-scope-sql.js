import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { ClienteSql } from '../paquetes/persistencia-sql/src/ClienteSql.js';
import { EjecutorMigraciones } from '../paquetes/persistencia-sql/src/EjecutorMigraciones.js';
import { RepositorioMigraciones } from '../paquetes/persistencia-sql/src/RepositorioMigraciones.js';
import { obtenerConfiguracionAplicacion, obtenerRutaMigraciones } from '../paquetes/utilidades/src/configuracion/obtenerConfiguracionAplicacion.js';
import { RepositorioMonitores } from '../paquetes/monitores/src/RepositorioMonitores.js';
import { ServicioMonitores } from '../paquetes/monitores/src/ServicioMonitores.js';
import { ResolutorScopeUsuario } from '../paquetes/contexto-usuario/src/ResolutorScopeUsuario.js';
import { ControladorMonitores } from '../apps/sentinelia-web/src/controladores/ControladorMonitores.js';

const configuracion = obtenerConfiguracionAplicacion().sql;
const administrador = new ClienteSql(configuracion);
const base = `sentinelia_fixture_op03_${randomBytes(6).toString('hex')}`;
let sql;
try {
  await administrador.ejecutar(`CREATE DATABASE ${administrador.escaparIdentificador(base)} CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
  sql = new ClienteSql({ ...configuracion, baseDatos: base });
  await new EjecutorMigraciones({ clienteSql: sql, repositorioMigraciones: new RepositorioMigraciones(sql), rutaMigraciones: obtenerRutaMigraciones() }).ejecutarPendientes();
  await sql.ejecutar("INSERT INTO tenants (id,nombre,alias) VALUES (1,'Tenant A','tenant-a'),(2,'Tenant B','tenant-b')");
  await sql.ejecutar("INSERT INTO empresas (id,tenant_id,nombre,alias) VALUES (1,1,'Empresa A','empresa-a'),(2,1,'Empresa B','empresa-b'),(3,2,'Empresa C','empresa-c')");
  await sql.ejecutar("INSERT INTO sitios (id,tenant_id,empresa_id,nombre,alias) VALUES (1,1,1,'Sitio A','sitio-a'),(2,1,1,'Sitio B','sitio-b'),(3,1,2,'Sitio C','sitio-c'),(4,2,3,'Sitio D','sitio-d')");
  const monitores = [
    [10,1,1,null], [11,1,1,1], [12,1,1,2],
    [20,1,2,null], [21,1,2,3], [30,2,3,null], [31,2,3,4]
  ];
  for (const [id,tenant,empresa,sitio] of monitores) {
    await sql.ejecutar("INSERT INTO monitores (id,tenant_id,empresa_id,sitio_id,nombre,tipo,activo,intervalo_ejecucion_segundos,configuracion) VALUES (?,?,?,?,?,'ping',0,60,JSON_OBJECT('host','127.0.0.1'))", [id,tenant,empresa,sitio,`Monitor ${id}`]);
  }
  const repo = new RepositorioMonitores(sql);
  const servicio = new ServicioMonitores({ repositorioMonitores: repo, resolutorScopeUsuario: new ResolutorScopeUsuario() });
  const casos = [
    [{nivelScope:'sitio',tenantId:1,empresaId:1,sitioId:1}, [11]],
    [{nivelScope:'sitio',tenantId:1,empresaId:1,sitioId:2}, [12]],
    [{nivelScope:'empresa',tenantId:1,empresaId:1,sitioId:null}, [10,11,12]],
    [{nivelScope:'empresa',tenantId:1,empresaId:2,sitioId:null}, [20,21]],
    [{nivelScope:'tenant',tenantId:1,empresaId:null,sitioId:null}, [10,11,12,20,21]],
    [{nivelScope:'portal',esOperadorSistema:true}, [10,11,12,20,21,30,31]]
  ];
  const ordenar = valores => valores.map(Number).sort((a,b) => a-b);
  for (const [contexto, esperados] of casos) {
    assert.deepEqual(ordenar((await repo.listarVisibles(contexto)).map(m=>m.id)), esperados);
    const pagina = await repo.listarPaginadoVisible(contexto, {tamanoPagina:100});
    assert.deepEqual(ordenar(pagina.monitores.map(m=>m.id)), esperados);
    assert.equal(pagina.paginacion.totalVisible, esperados.length);
    for (const [id] of monitores) {
      if (esperados.includes(id)) {
        assert.equal((await servicio.construirVistaMonitorOperativo(contexto,id)).monitor.id,id);
      } else {
        await assert.rejects(() => servicio.construirVistaMonitorOperativo(contexto,id),
          e => e.codigo === 'monitor_fuera_de_alcance' && e.statusCode === 403,
          `${contexto.nivelScope}: monitor ${id} oculto en catálogo tampoco debe abrirse`);
      }
    }
  }
  const controlador = new ControladorMonitores({servicioMonitores:servicio});
  let vista;
  await controlador.mostrarDetalleMonitor({params:{id:'10'},query:{},session:{},contextoUsuarioActual:casos[0][0]}, {
    status(codigo){assert.equal(codigo,403);return this;},
    set(nombre,valor){assert.equal(nombre,'Cache-Control');assert.equal(valor,'no-store');return this;},
    render(plantilla,datos){assert.equal(plantilla,'portal/forbidden');vista=datos;}
  }, error=>{throw error;});
  assert.ok(vista.motivoAlcance);
  assert.equal(vista.monitor,undefined);
  console.log('OP03_SCOPE_SQL_OK: catálogo, paginación y ficha coherentes; sitio, empresa, tenant y portal; 403 con plantilla existente');
} finally {
  await sql?.cerrar();
  await administrador.ejecutar(`DROP DATABASE IF EXISTS ${administrador.escaparIdentificador(base)}`);
  await administrador.cerrar();
}

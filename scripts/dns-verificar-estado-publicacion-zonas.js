import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { ClienteSql } from '../paquetes/persistencia-sql/src/ClienteSql.js';
import { EjecutorMigraciones } from '../paquetes/persistencia-sql/src/EjecutorMigraciones.js';
import { RepositorioMigraciones } from '../paquetes/persistencia-sql/src/RepositorioMigraciones.js';
import { obtenerConfiguracionAplicacion, obtenerRutaMigraciones }
  from '../paquetes/utilidades/src/configuracion/obtenerConfiguracionAplicacion.js';
import { RepositorioCoordinacionGeneracionesDns } from '../paquetes/dns/src/RepositorioCoordinacionGeneracionesDns.js';
import { RepositorioZonasDns } from '../paquetes/dns/src/RepositorioZonasDns.js';
import { RepositorioFotografiaCatalogoDns } from '../paquetes/dns/src/RepositorioFotografiaCatalogoDns.js';
import { ProyeccionBindDeterministaDns } from '../paquetes/dns/src/ProyeccionBindDeterministaDns.js';
import { consolidarPublicacionZonasDns, normalizarFotografiaZonasDns }
  from '../paquetes/dns/src/FotografiaPublicacionZonasDns.js';

const configuracion = obtenerConfiguracionAplicacion();
assert.equal(configuracion.sql.estaCompleta, true);
const base = `sentinelia_fixture_estado_dns_${randomBytes(5).toString('hex')}`;
const admin = new ClienteSql(configuracion.sql);
const sql = new ClienteSql({ ...configuracion.sql, baseDatos: base });
try {
  await sql.crearBaseDatosSiNoExiste();
  const migraciones = new EjecutorMigraciones({ clienteSql: sql,
    repositorioMigraciones: new RepositorioMigraciones(sql), rutaMigraciones: obtenerRutaMigraciones() });
  await migraciones.ejecutarPendientes();
  assert.equal((await migraciones.ejecutarPendientes()).pendientesAplicadas, 0);
  await verificar();
  console.log('[dns] OK estado de zonas: snapshot durable, recarga obligatoria, concurrencia, rollback, recuperación, fallos, exclusión, retirada, filtros, alcance y reparación idempotente.');
} finally {
  await sql.cerrar();
  // Únicamente la base aleatoria creada por esta prueba; nunca el catálogo real.
  assert.match(base, /^sentinelia_fixture_estado_dns_[a-f0-9]{10}$/);
  await admin.ejecutar(`DROP DATABASE IF EXISTS ${admin.escaparIdentificador(base)}`);
  await admin.cerrar();
}

async function verificar() {
  const [tenant] = await sql.ejecutar("INSERT INTO tenants(nombre,alias) VALUES ('Fixture DNS','fixture-dns')");
  const zonas = new RepositorioZonasDns(sql);
  const publicada = await zonas.crear({ nombreZona: 'publicada.example', tenantId: tenant.insertId,
    soaMname: 'ns.example.', soaRname: 'hostmaster.example.' });
  const reservada = await zonas.crear({ nombreZona: 'reservada.example', publicarEnBind: false,
    soaMname: 'ns.example.', soaRname: 'hostmaster.example.' });
  const inactiva = await zonas.crear({ nombreZona: 'inactiva.example', activo: false,
    soaMname: 'ns.example.', soaRname: 'hostmaster.example.' });
  let obligacion = 1000;
  let fallarOutbox = false;
  const repo = new RepositorioCoordinacionGeneracionesDns({ clienteSql: sql,
    registradorObligaciones: { registrarEnTransaccion: async () => {
      if (fallarOutbox) throw new Error('outbox fixture');
      return { obligacionId: String(++obligacion) };
    } },
    bloquearCatalogoEnTransaccion: async ({ conexion }) => {
      await conexion.execute('SELECT id FROM zonas_dns ORDER BY id FOR UPDATE');
      await conexion.execute('SELECT id FROM registros_dns ORDER BY zona_id,id FOR UPDATE');
    }
  });
  const fotografo = new RepositorioFotografiaCatalogoDns({ clienteSql: sql,
    materializador: new ProyeccionBindDeterministaDns({ validarDestino: async () => true }) });
  const resumen = { zonas: '1', artefactos: '3', cambios: '1' };
  const estado = async (id) => (await zonas.buscarPorId(id)).serializarResumen();
  const reclamar = async (generacion) => {
    const leaseToken = randomBytes(32);
    const operacion = await repo.reclamarSiguienteConLease({ instanciaId: 'fixture-dns', leaseToken, ttlSegundos: 60 });
    assert.equal(operacion.generacionDns, generacion);
    return { generacionDns: generacion, instanciaId: 'fixture-dns', leaseToken, fencingToken: operacion.fencingToken };
  };
  const preparar = async () => {
    const op = await repo.crearGeneracionPorMutacionAtomica();
    const lease = await reclamar(op.generacionDns);
    const foto = await fotografo.materializar({ generacionDns: op.generacionDns });
    await repo.iniciarEfectoConLease(lease, { generacionLeida: foto.generacionLeida,
      perfilProyeccion: foto.proyeccion.perfilProyeccion, hashProyeccion: foto.proyeccion.hashProyeccion,
      fotografiaZonas: foto.fotografiaZonas });
    return { op, lease, foto };
  };
  assert.equal((await estado(reservada.id)).estadoPublicacion, 'excluida');
  assert.equal((await estado(inactiva.id)).estadoPublicacion, 'excluida');
  const primera = await preparar();
  assert.equal(primera.foto.fotografiaZonas.length, 3, 'Incluye las zonas sin registros y excluidas');
  assert.equal((await repo.obtenerOperacion(primera.op.generacionDns)).fotografiaZonas.length, 3);
  assert.equal(await repo.consolidarResultadoConLease(primera.lease, resumen), null);
  assert.equal((await estado(publicada.id)).fechaUltimaPublicacionExitosa, null);
  await assert.rejects(() => sql.ejecutar('UPDATE operaciones_publicacion_dns SET fotografia_zonas=? WHERE generacion_dns=?',
    ['[]', primera.op.generacionDns]), /inmutable/);
  await repo.confirmarRecargaConLease(primera.lease, resumen);
  fallarOutbox = true;
  await assert.rejects(() => repo.consolidarResultadoConLease(primera.lease, resumen), /outbox fixture/);
  assert.equal((await estado(publicada.id)).generacionAplicadaBind, null, 'Rollback también del modelo de lectura');
  fallarOutbox = false;
  // Reentrada: obtiene la fotografía persistida, sin volver a renderizar.
  const confirmada = await repo.obtenerOperacion(primera.op.generacionDns);
  await repo.consolidarResultadoConLease(primera.lease, confirmada.resultado);
  const anterior = await estado(publicada.id);
  assert.equal(anterior.estadoPublicacion, 'publicado');
  assert.equal(anterior.versionAplicadaBind, '1');
  assert.ok(anterior.hashPublicacionVigente);
  assert.ok(anterior.fechaUltimaPublicacionExitosa);
  assert.equal(await repo.asegurarLecturaPublicacionZonas(), null);
  assert.equal((await zonas.listarVisibles({ nivelScope: 'portal' }, { estadoPublicacion: 'publicado' })).length, 1);
  assert.equal((await zonas.listarVisibles({ nivelScope: 'portal' }, { estadoPublicacion: 'excluida' })).length, 2);
  assert.equal((await zonas.listarVisibles({ nivelScope: 'tenant', tenantId: tenant.insertId })).length, 1);

  await zonas.marcarPendientePublicacion(publicada.id);
  const segunda = await preparar();
  // Edición durante el efecto de la generación anterior.
  const tercera = await repo.crearGeneracionPorMutacionAtomica();
  await zonas.marcarPendientePublicacion(publicada.id);
  await repo.confirmarRecargaConLease(segunda.lease, resumen);
  await repo.consolidarResultadoConLease(segunda.lease, resumen);
  const concurrente = await estado(publicada.id);
  assert.equal(concurrente.versionAplicadaBind, '2');
  assert.equal(concurrente.versionModelo, 3);
  assert.equal(concurrente.estadoPublicacion, 'pendiente');
  assert.ok(concurrente.hashPublicacionVigente, 'Mantiene la versión anterior mientras se aplica la nueva');
  assert.match(concurrente.descripcionPublicacion, /Última versión confirmada: v2/);
  const leaseFallo = await reclamar(tercera.generacionDns);
  await repo.fallarEstableConLease(leaseFallo, { diagnostico: { codigo: 'fixture', mensaje: 'Fallo antes de recargar' } });
  const fallo = await estado(publicada.id);
  assert.equal(fallo.estadoPublicacion, 'error');
  assert.equal(fallo.hashPublicacionVigente, concurrente.hashPublicacionVigente);
  assert.equal(fallo.fechaUltimaPublicacionExitosa, concurrente.fechaUltimaPublicacionExitosa);
  assert.equal((await estado(reservada.id)).estadoPublicacion, 'excluida');
  assert.equal(await repo.asegurarLecturaPublicacionZonas(), null, 'No reintenta un fallo al arrancar');
  const recuperada = await preparar();
  await repo.confirmarRecargaConLease(recuperada.lease, resumen);
  await repo.consolidarResultadoConLease(recuperada.lease, resumen);
  assert.equal((await estado(publicada.id)).estadoPublicacion, 'publicado');
  // La retirada todavía no está aplicada: no mostrar «excluida» hasta confirmar.
  await zonas.actualizar({ ...((await zonas.buscarPorId(publicada.id)).serializarPersistencia()),
    idZona: publicada.id, publicarEnBind: false });
  assert.equal((await estado(publicada.id)).estadoPublicacion, 'pendiente');
  assert.match((await estado(publicada.id)).descripcionPublicacion, /Retirada/);
  const retirada = await preparar();
  await repo.confirmarRecargaConLease(retirada.lease, { ...resumen, zonas: '0' });
  await repo.consolidarResultadoConLease(retirada.lease, { ...resumen, zonas: '0' });
  const excluida = await estado(publicada.id);
  assert.equal(excluida.estadoPublicacion, 'excluida');
  assert.equal(excluida.hashPublicacionVigente, null);
  assert.ok(excluida.fechaUltimaPublicacionExitosa, 'Conserva el histórico de éxito tras retirar');
  // Defensa monotónica incluso ante una consolidación antigua tardía.
  const conexion = await sql.obtenerConexion();
  try {
    await consolidarPublicacionZonasDns({ conexion, operacion: confirmada });
  } finally { conexion.release(); }
  assert.equal((await estado(publicada.id)).generacionAplicadaBind, retirada.op.generacionDns);
  // Una zona antigua sin fotografía se revalida una única vez, nunca por SQL ciego.
  const antigua = await zonas.crear({ nombreZona: 'antigua.example', publicarEnBind: false,
    soaMname: 'ns.example.', soaRname: 'hostmaster.example.' });
  const reparacion = await repo.asegurarLecturaPublicacionZonas();
  assert.ok(reparacion);
  assert.equal(await repo.asegurarLecturaPublicacionZonas(), null, 'No duplica la revalidación pendiente');
  assert.equal((await estado(antigua.id)).generacionAplicadaBind, null);
  const leaseReparacion = await reclamar(reparacion.generacionDns);
  const fotoReparacion = await fotografo.materializar({ generacionDns: reparacion.generacionDns });
  await repo.iniciarEfectoConLease(leaseReparacion, {
    generacionLeida: fotoReparacion.generacionLeida,
    perfilProyeccion: fotoReparacion.proyeccion.perfilProyeccion,
    hashProyeccion: fotoReparacion.proyeccion.hashProyeccion,
    fotografiaZonas: fotoReparacion.fotografiaZonas
  });
  await repo.confirmarRecargaConLease(leaseReparacion, { ...resumen, zonas: '0' });
  await repo.consolidarResultadoConLease(leaseReparacion, { ...resumen, zonas: '0' });
  assert.equal(await repo.asegurarLecturaPublicacionZonas(), null, 'Reparación completa: no se repite al reiniciar');
  // Compatibilidad: el publicador antiguo también registra su versión aplicada.
  const legado = await zonas.crear({ nombreZona: 'legado.example',
    soaMname: 'ns.example.', soaRname: 'hostmaster.example.' });
  await zonas.registrarPublicacionExitosa([{ nombreZona: legado.nombreZona, hashPublicacionVigente: 'f'.repeat(64) }]);
  assert.equal((await estado(legado.id)).estadoPublicacion, 'publicado');
  await zonas.marcarPendientePublicacion(legado.id);
  const legadoPendiente = await estado(legado.id);
  assert.equal(legadoPendiente.estadoPublicacion, 'pendiente');
  assert.ok(legadoPendiente.fechaUltimaPublicacionExitosa);
  assert.ok(legadoPendiente.hashPublicacionVigente);
  assert.throws(() => normalizarFotografiaZonasDns([{ id: '1', versionModelo: '1', hashContenido: null },
    { id: '1', versionModelo: '2', hashContenido: null }]), /no válida/);
}

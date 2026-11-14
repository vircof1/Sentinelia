import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { ClienteSql } from '../paquetes/persistencia-sql/src/ClienteSql.js';
import { FronteraTransaccionalLocal } from '../paquetes/persistencia-sql/src/FronteraTransaccionalLocal.js';
import { EjecutorMigraciones } from '../paquetes/persistencia-sql/src/EjecutorMigraciones.js';
import { RepositorioMigraciones } from '../paquetes/persistencia-sql/src/RepositorioMigraciones.js';
import { obtenerConfiguracionAplicacion, obtenerRutaMigraciones } from '../paquetes/utilidades/src/configuracion/obtenerConfiguracionAplicacion.js';
import { ServicioTriggers } from '../paquetes/triggers/src/ServicioTriggers.js';
import { ValidadorTrigger } from '../paquetes/triggers/src/ValidadorTrigger.js';
import { RepositorioTriggers } from '../paquetes/triggers/src/RepositorioTriggers.js';

const configuracion = obtenerConfiguracionAplicacion().sql;
const administrador = new ClienteSql(configuracion);
const nombre = `sentinelia_fixture_op01_${randomBytes(6).toString('hex')}`;
let sql;
try {
  await administrador.ejecutar(`CREATE DATABASE ${administrador.escaparIdentificador(nombre)} CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
  sql = new ClienteSql({ ...configuracion, baseDatos: nombre });
  await new EjecutorMigraciones({ clienteSql: sql, repositorioMigraciones: new RepositorioMigraciones(sql), rutaMigraciones: obtenerRutaMigraciones() }).ejecutarPendientes();
  const repo = new RepositorioTriggers(sql);
  const validador = new ValidadorTrigger();
  const eventos = [];
  let fallarAuditoria = false;
  const servicio = new ServicioTriggers({
    repositorioTriggers: repo, validadorTrigger: validador,
    fronteraTransaccional: new FronteraTransaccionalLocal(sql),
    servicioAuditoria: { async registrarEnTransaccion({ intencion }) {
      if (fallarAuditoria) throw new Error('auditoria no disponible en la prueba');
      eventos.push(intencion);
    } }
  });
  const contexto = { idUsuario: 1, nivelScope: 'portal' };
  const inicial = {
    nombre: 'Edición API', tipo: 'api', activo: false, descripcion: '',
    url: 'http://127.0.0.1:3000/', metodo: 'POST', timeoutMs: 5000,
    reintentos: 0, permiteTlsInseguro: false,
    cabeceras: { 'X-Fixture': 'inicial' }, plantillaCuerpo: 'cuerpo inicial'
  };
  for (const [caso, cambio] of [
    ['URL', { url: 'http://127.0.0.1:3000/login?ejemplo=OP01-PRIVADO' }],
    ['cabeceras', { cabeceras: { Authorization: 'Bearer OP01-PRIVADO' } }],
    ['cuerpo', { plantillaCuerpo: 'OP01-PRIVADO' }],
    ['combinado', { nombre: 'Nombre cambiado', url: 'http://127.0.0.1:3000/OP01-PRIVADO', cabeceras: { 'X-Test': 'OP01-PRIVADO' }, plantillaCuerpo: 'OP01-PRIVADO' }]
  ]) {
    const base = { ...inicial, nombre: `Edición API ${caso}` };
    const creada = await repo.crear(validador.normalizarDefinicionBase(base));
    const propuesta = { ...base, ...cambio, revisionDeclaracion: creada.revisionDeclaracion };
    const cuenta = eventos.length;
    await servicio.actualizarTrigger(creada.id, propuesta, { contextoUsuarioActual: contexto });
    const reabierta = await repo.buscarPorId(creada.id);
    assert.deepEqual(reabierta.configuracion.serializar(), validador.normalizarDefinicionBase(propuesta).configuracion, `${caso}: persistir la configuración completa`);
    assert.equal(reabierta.revisionDeclaracion, creada.revisionDeclaracion + 1);
    assert.equal(eventos.length, cuenta + 1);
    const evento = eventos.at(-1);
    assert.deepEqual(evento.payload.camposCambiados, caso === 'combinado' ? ['configuracion', 'nombre'] : ['configuracion']);
    const auditado = JSON.stringify(evento.payload);
    assert.ok(!auditado.includes('OP01-PRIVADO'), 'Conservar la redacción de auditoría');
    for (const foto of [evento.payload.antes, evento.payload.despues]) {
      for (const campo of ['url', 'cabeceras', 'plantillaCuerpo']) {
        assert.ok(!Object.hasOwn(foto.configuracion, campo));
      }
    }
    const sinCambios = { ...propuesta, revisionDeclaracion: reabierta.revisionDeclaracion };
    await servicio.actualizarTrigger(creada.id, sinCambios, { contextoUsuarioActual: contexto });
    assert.equal((await repo.buscarPorId(creada.id)).revisionDeclaracion, reabierta.revisionDeclaracion, 'No incrementar revisión en un guardado idéntico');
    assert.equal(eventos.length, cuenta + 1, 'No emitir actualización si no hay cambios');
    await assert.rejects(() => servicio.actualizarTrigger(creada.id, propuesta, { contextoUsuarioActual: contexto }), error => error.codigo === 'trigger_revision_obsoleta');
    fallarAuditoria = true;
    await assert.rejects(() => servicio.actualizarTrigger(creada.id, {
      ...sinCambios, url: 'http://127.0.0.1:3000/rollback'
    }, { contextoUsuarioActual: contexto }), /auditoria no disponible/);
    fallarAuditoria = false;
    const trasRollback = await repo.buscarPorId(creada.id);
    assert.equal(trasRollback.revisionDeclaracion, reabierta.revisionDeclaracion);
    assert.deepEqual(trasRollback.configuracion.serializar(), reabierta.configuracion.serializar());
  }
  console.log('OP01_SQL_OK: URL, cabeceras, cuerpo y cambios combinados; reapertura; revisión; no-op; auditoría redactada; rollback');
} finally {
  await sql?.cerrar();
  await administrador.ejecutar(`DROP DATABASE IF EXISTS ${administrador.escaparIdentificador(nombre)}`);
  await administrador.cerrar();
}

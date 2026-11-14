import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { generarUuidV7Auditoria } from '../paquetes/auditoria/src/UuidV7Auditoria.js';
import { CoordinadorOperacionesDurables } from '../paquetes/coordinacion-durable/src/CoordinadorOperacionesDurables.js';
import { AdaptadorCoordinacionGeneracionesDns } from '../paquetes/dns/src/AdaptadorCoordinacionGeneracionesDns.js';
import {
  RepositorioCoordinacionGeneracionesDns
} from '../paquetes/dns/src/RepositorioCoordinacionGeneracionesDns.js';
import { exigeRecargaForzadaPublicacionDns } from '../paquetes/dns/src/EstadosPublicacionDns.js';
import { ClienteSql } from '../paquetes/persistencia-sql/src/ClienteSql.js';
import { EjecutorMigraciones } from '../paquetes/persistencia-sql/src/EjecutorMigraciones.js';
import { RepositorioMigraciones } from '../paquetes/persistencia-sql/src/RepositorioMigraciones.js';
import {
  obtenerConfiguracionAplicacion,
  obtenerRutaMigraciones
} from '../paquetes/utilidades/src/configuracion/obtenerConfiguracionAplicacion.js';

const configuracion = obtenerConfiguracionAplicacion();
const nombreBase = `sentinelia_dns5i_${Date.now()}_${process.pid}`;

async function main() {
  assert.equal(configuracion.sql.estaCompleta, true, 'La verificación 5.21.5i requiere SQL.');
  let clienteSql;
  let errorPrincipal = null;
  try {
    clienteSql = await prepararBaseTemporal();
    await verificarMaquina(clienteSql);
  } catch (error) {
    errorPrincipal = error;
  } finally {
    try {
      await clienteSql?.cerrar();
      await eliminarBaseTemporal();
    } catch (errorLimpieza) {
      if (!errorPrincipal) throw errorLimpieza;
    }
  }
  if (errorPrincipal) throw errorPrincipal;
  console.log('[dns] OK 5.21.5i: generacion=monotona singleton=trasladable backoff=si bloqueo=cli sucesion=acotada convergencia=recarga outbox=frontera limpieza=segura bind=no');
}

async function verificarMaquina(clienteSql) {
  const obligaciones = new RegistradorObligacionesFixture();
  const repositorio = new RepositorioCoordinacionGeneracionesDns({
    clienteSql,
    registradorObligaciones: obligaciones,
    async bloquearCatalogoEnTransaccion({ conexion }) {
      await conexion.execute('SELECT id FROM zonas_dns ORDER BY id FOR UPDATE');
      await conexion.execute('SELECT id FROM registros_dns ORDER BY zona_id, id FOR UPDATE');
    }
  });
  const adaptador = new AdaptadorCoordinacionGeneracionesDns({ repositorio });
  const coordinador = new CoordinadorOperacionesDurables({
    repositorio: adaptador,
    instanciaId: `dns-5i-${process.pid}`,
    ttlSegundos: 20
  });

  const bootstrap = await repositorio.asegurarReconciliacionInicial({ maxIntentos: 2 });
  assert.equal(bootstrap.creada, true);
  assert.equal(bootstrap.operacion.generacionDns, '1');
  assert.equal((await repositorio.asegurarReconciliacionInicial()).creada, false);
  assert.equal(exigeRecargaForzadaPublicacionDns(
    bootstrap.operacion,
    bootstrap.reconciliacion
  ), true);

  const primera = await coordinador.reclamarSiguiente();
  assert.equal(primera.operacion.generacionDns, '1');
  assert.equal((await coordinador.renovar(primera.lease)).actualizada, true);
  await assert.rejects(
    () => coordinador.avanzar(primera.lease, { transicion: 'sin_cambios' }),
    /exige una recarga/
  );
  const fallo1 = await coordinador.registrarFallo(primera.lease, {
    codigo: 'named_checkconf',
    mensaje: 'La configuración candidata no es válida. secret=oculto',
    permanente: true,
    demoraReintentoSegundos: 30
  });
  assert.equal(fallo1.operacion.estado, 'fallida');
  assert.equal(fallo1.operacion.ultimoMensajeError.includes('oculto'), false);
  await repositorio.incorporarEventoResultado('1', generarUuidV7Auditoria());
  assert.equal(
    (await repositorio.limpiarTerminales({ graciaSegundos: 0 })).eliminadas,
    0,
    'El objetivo de reconciliación no se limpia antes de trasladar el singleton.'
  );
  let reconciliacion = await repositorio.obtenerReconciliacion();
  assert.equal(reconciliacion.estado, 'activa');
  assert.equal(reconciliacion.intentos, 1);
  assert.equal((await repositorio.crearReintentoReconciliacion()).motivo, 'backoff_vigente');
  await clienteSql.ejecutar(
    `UPDATE reconciliacion_inicial_dns
        SET proximo_intento_utc = TIMESTAMPADD(SECOND, -1, UTC_TIMESTAMP(3))
      WHERE id = 1`
  );
  const reintento2 = await repositorio.crearReintentoReconciliacion();
  assert.equal(reintento2.creada, true);
  assert.equal(reintento2.operacion.generacionDns, '2');

  const segunda = await coordinador.reclamarSiguiente();
  assert.equal(segunda.operacion.generacionDns, '2');
  const fallo2 = await coordinador.registrarFallo(segunda.lease, {
    codigo: 'bind_no_disponible',
    mensaje: 'BIND sigue sin estar disponible.',
    permanente: true,
    demoraReintentoSegundos: 1
  });
  assert.equal(fallo2.operacion.estado, 'fallida');
  reconciliacion = await repositorio.obtenerReconciliacion();
  assert.equal(reconciliacion.estado, 'bloqueada');
  assert.equal((await repositorio.crearReintentoReconciliacion()).motivo, 'reconciliacion_no_activa');
  await verificarTrasladoPorMutacionSinReactivar(clienteSql, repositorio);
  assert.equal((await repositorio.reactivarReconciliacion()).reactivada, true);
  const reintento3 = await repositorio.crearReintentoReconciliacion();
  assert.equal(reintento3.creada, true);
  assert.equal(reintento3.operacion.generacionDns, '3');

  const tercera = await coordinador.reclamarSiguiente();
  await coordinador.avanzar(tercera.lease, {
    transicion: 'efecto_iniciado',
    datos: proyeccion('3')
  });
  assert.equal((await repositorio.obtenerOperacion('3')).leaseVigente, true);
  assert.equal(exigeRecargaForzadaPublicacionDns(await repositorio.obtenerOperacion('3')), true);
  const terceraRecuperada = await repositorio.reclamarSiguienteConLease({
    instanciaId: 'dns-test-recuperacion',
    leaseToken: Buffer.alloc(32, 0x33),
    ttlSegundos: 30
  });
  assert.equal(terceraRecuperada, null);
  await assert.rejects(
    () => coordinador.avanzar(tercera.lease, { transicion: 'sin_cambios' }),
    (error) => error?.codigo === 'lease_operacion_durable_perdido'
  );
  const sucesora4 = await repositorio.crearSucesoraPorDivergencia('3', {
    codigo: 'proyeccion_divergente',
    mensaje: 'La proyección recuperada ya no coincide.'
  }, {
    lease: {
      generacionDns: tercera.lease.operacionId,
      instanciaId: tercera.lease.instanciaId,
      leaseToken: Buffer.from(tercera.lease.leaseToken, 'hex'),
      fencingToken: tercera.lease.fencingToken
    }
  });
  assert.equal(sucesora4.creada, true);
  assert.equal(sucesora4.operacion.generacionDns, '4');
  const repetida4 = await repositorio.crearSucesoraPorDivergencia('3', {
    codigo: 'proyeccion_divergente',
    mensaje: 'La misma divergencia vuelve a observarse.'
  });
  assert.equal(repetida4.creada, false);
  assert.equal(repetida4.operacion.generacionDns, '4');
  assert.equal((await repositorio.obtenerReconciliacion()).generacionObjetivo, '4');

  const cuarta = await coordinador.reclamarSiguiente();
  await coordinador.avanzar(cuarta.lease, {
    transicion: 'efecto_iniciado',
    datos: proyeccion('4')
  });
  const bloqueada4 = await repositorio.crearSucesoraPorDivergencia('4', {
    codigo: 'segunda_divergencia',
    mensaje: 'La sucesora automática también diverge.'
  });
  assert.equal(bloqueada4.bloqueada, true);
  assert.equal((await repositorio.obtenerOperacion('4')).estado, 'recuperacion_bloqueada');

  const manual5 = await repositorio.crearSucesoraManual('4');
  assert.equal(manual5.generacionDns, '5');
  assert.equal(manual5.generacionRaizRecuperacion, '5');
  assert.equal((await repositorio.crearSucesoraManual('4')).generacionDns, '5');
  assert.equal((await repositorio.obtenerReconciliacion()).generacionObjetivo, '5');
  const quinta = await coordinador.reclamarSiguiente();
  await coordinador.avanzar(quinta.lease, {
    transicion: 'efecto_iniciado',
    datos: proyeccion('5')
  });
  assert.equal((await repositorio.obtenerOperacion('5')).leaseVigente, true);
  const quintaRecuperada = await repositorio.reclamarSiguienteConLease({
    instanciaId: 'dns-test-recuperacion',
    leaseToken: Buffer.alloc(32, 0x55),
    ttlSegundos: 30
  });
  assert.equal(quintaRecuperada, null);
  const recarga = await coordinador.avanzar(quinta.lease, {
    transicion: 'recarga_observada'
  });
  assert.equal(recarga.operacion.estado, 'recarga_confirmada');
  assert.equal((await repositorio.obtenerOperacion('5')).leaseVigente, true);
  assert.equal((await repositorio.obtenerReconciliacion()).estado, 'satisfecha');
  assert.equal((await repositorio.obtenerOperacion('3')).estado, 'superada_tras_recuperacion');
  assert.equal((await repositorio.obtenerOperacion('4')).estado, 'superada_tras_recuperacion');
  assert.equal((await repositorio.obtenerOperacion('3')).generacionConvergente, '5');

  obligaciones.fallarSiguiente = true;
  await assert.rejects(
    () => coordinador.consolidar(quinta.lease, {
      resultado: { zonas: '2', artefactos: '4', cambios: '3' }
    }),
    /fallo de outbox fixture/
  );
  assert.equal((await repositorio.obtenerOperacion('5')).estado, 'recarga_confirmada');
  const consolidada = await coordinador.consolidar(quinta.lease, {
    resultado: { zonas: '2', artefactos: '4', cambios: '3' }
  });
  assert.equal(consolidada.operacion.estado, 'consolidada');
  assert.equal(obligaciones.registros.length, 3);
  assert.deepEqual(obligaciones.registros.map(({ tipo }) => tipo), [
    'fallida', 'fallida', 'aplicada'
  ]);
  assert.equal(
    obligaciones.registros.some(({ generacionDns }) => ['3', '4'].includes(generacionDns)),
    false,
    'Los cierres técnicos no crean obligaciones vacías.'
  );

  const mutacion6 = await repositorio.crearGeneracionPorMutacionAtomica();
  assert.equal(mutacion6.generacionDns, '6');
  const sexta = await coordinador.reclamarSiguiente();
  const mutacion7 = await repositorio.crearGeneracionPorMutacionAtomica();
  assert.equal(mutacion7.generacionDns, '7');
  assert.equal((await repositorio.obtenerOperacion('6')).estado, 'superada');
  await assert.rejects(
    () => coordinador.avanzar(sexta.lease, { transicion: 'sin_cambios' }),
    (error) => error?.codigo === 'lease_operacion_durable_perdido'
  );
  const septima = await coordinador.reclamarSiguiente();
  const sinCambios = await coordinador.avanzar(septima.lease, {
    transicion: 'sin_cambios'
  });
  assert.equal(sinCambios.operacion.estado, 'sin_cambios');
  assert.equal(obligaciones.registros.length, 3);

  for (const generacion of ['2', '5']) {
    await repositorio.incorporarEventoResultado(generacion, generarUuidV7Auditoria());
  }
  assert.equal((await repositorio.limpiarTerminales({ graciaSegundos: 0 })).eliminadas, 7);
  assert.equal(await repositorio.obtenerOperacion('5'), null);
  assert.equal((await repositorio.obtenerReconciliacion()).estado, 'satisfecha');
}

async function verificarTrasladoPorMutacionSinReactivar(clienteSql, repositorio) {
  const conexion = await clienteSql.obtenerConexion();
  try {
    await conexion.beginTransaction();
    const mutacion = await repositorio.crearGeneracionPorMutacionEnTransaccion({ conexion });
    assert.equal(mutacion.generacionDns, '3');
    const [[singleton]] = await conexion.execute(
      `SELECT estado, CAST(generacion_objetivo AS CHAR) AS generacion_objetivo,
              intentos, max_intentos
         FROM reconciliacion_inicial_dns WHERE id = 1`
    );
    assert.equal(singleton.estado, 'bloqueada');
    assert.equal(String(singleton.generacion_objetivo), '3');
    assert.equal(Number(singleton.intentos), Number(singleton.max_intentos));
    await conexion.rollback();
  } catch (error) {
    try { await conexion.rollback(); } catch {}
    throw error;
  } finally {
    conexion.release();
  }
  assert.equal((await repositorio.obtenerReconciliacion()).generacionObjetivo, '2');
  assert.equal(await repositorio.obtenerOperacion('3'), null);
}

function proyeccion(generacion) {
  return {
    generacionLeida: generacion,
    perfilProyeccion: 'sentinelia-bind-proyeccion-v1',
    hashProyeccion: randomBytes(32)
  };
}

class RegistradorObligacionesFixture {
  constructor() {
    this.siguienteId = 9000n;
    this.registros = [];
    this.fallarSiguiente = false;
  }

  async registrarEnTransaccion(datos, { conexion }) {
    assert.equal(typeof conexion?.execute, 'function');
    if (this.fallarSiguiente) {
      this.fallarSiguiente = false;
      throw new Error('fallo de outbox fixture');
    }
    this.siguienteId += 1n;
    this.registros.push(Object.freeze({
      tipo: datos.tipo,
      generacionDns: datos.operacion.generacionDns
    }));
    return { obligacionId: String(this.siguienteId) };
  }
}

async function prepararBaseTemporal() {
  validarNombreBase(nombreBase);
  const clienteSql = new ClienteSql({ ...configuracion.sql, baseDatos: nombreBase });
  await clienteSql.crearBaseDatosSiNoExiste();
  const ejecutor = new EjecutorMigraciones({
    clienteSql,
    repositorioMigraciones: new RepositorioMigraciones(clienteSql),
    rutaMigraciones: obtenerRutaMigraciones()
  });
  await ejecutor.ejecutarPendientes();
  assert.equal((await ejecutor.ejecutarPendientes()).pendientesAplicadas, 0);
  return clienteSql;
}

async function eliminarBaseTemporal() {
  validarNombreBase(nombreBase);
  const cliente = new ClienteSql(configuracion.sql);
  try {
    await cliente.ejecutar(`DROP DATABASE IF EXISTS \`${nombreBase}\``);
  } finally {
    await cliente.cerrar();
  }
}

function validarNombreBase(nombre) {
  if (!/^sentinelia_dns5i_[0-9_]{1,40}$/.test(nombre)) {
    throw new Error('El nombre de base temporal DNS 5i no es seguro.');
  }
}

main().catch((error) => {
  console.error('[dns] Falló la verificación 5.21.5i');
  console.error(error);
  process.exitCode = 1;
});

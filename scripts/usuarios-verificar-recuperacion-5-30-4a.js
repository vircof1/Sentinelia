import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';

import { generarUuidV7Auditoria }
  from '../paquetes/auditoria/src/UuidV7Auditoria.js';
import {
  ESTADOS_IDENTIDAD_FRONTERA_RECUPERACION_PASSWORD_EMAIL,
  PERFILES_RECUPERACION_PASSWORD_EMAIL,
  RESULTADOS_ALEGACION_RECUPERACION_PASSWORD_EMAIL,
  VERSION_CONTRATO_RECUPERACION_PASSWORD_EMAIL,
  crearFronteraRecuperacionPasswordEmail,
  crearHuellaRecuperacionPasswordEmail,
  DOMINIOS_HUELLA_RECUPERACION_PASSWORD_EMAIL
} from '../paquetes/usuarios/src/ContratoRecuperacionPasswordEmail.js';
import { RepositorioSolicitudesRecuperacionPasswordRedis }
  from '../paquetes/usuarios/src/RepositorioSolicitudesRecuperacionPasswordRedis.js';
import { ServicioConexionRedis }
  from '../paquetes/sesiones/src/ServicioConexionRedis.js';
import { obtenerConfiguracionAplicacion }
  from '../paquetes/utilidades/src/configuracion/obtenerConfiguracionAplicacion.js';

await main();

async function main() {
  const configuracion = obtenerConfiguracionAplicacion();
  const conexion = new ServicioConexionRedis(configuracion.redis);
  const redis = await conexion.conectar();
  const prefijo = `sentinelia:fixture:5304a:${randomBytes(6).toString('hex')}:`;
  const procesoA = new RepositorioSolicitudesRecuperacionPasswordRedis({
    clienteRedis: redis, prefijo
  });
  const procesoB = new RepositorioSolicitudesRecuperacionPasswordRedis({
    clienteRedis: redis, prefijo
  });
  try {
    const caso = crearCaso(procesoA);
    const preparada = await procesoA.preparar(caso.preparacion);
    assert.equal(preparada.estado, 'preparada');
    assert.equal((await procesoB.preparar(caso.preparacion)).estado, 'repetida');
    const conflicto = await procesoB.preparar({
      ...caso.preparacion,
      operacionId: generarUuidV7Auditoria()
    });
    assert.equal(conflicto.estado, 'conflicto_solicitud');

    const activada = await procesoA.activar(caso.activacion);
    assert.equal(activada.estado, 'activada');
    assert.match(activada.emitidaEnUtc, /Z$/u);
    assert.match(activada.expiraEnUtc, /Z$/u);
    assert.equal((await procesoB.activar(caso.activacion)).estado, 'repetida');
    assert.equal((await procesoB.activar({
      ...caso.activacion,
      operacionId: generarUuidV7Auditoria()
    })).estado, 'propietario_rezagado');
    const inspeccion = await procesoB.inspeccionar(caso.token);
    assert.equal(inspeccion.estado, 'activa');
    assert.equal(inspeccion.solicitud.frontera.miembros.length, 2);
    assert.equal(inspeccion.solicitud.presupuestoRestante, 5);
    assert.equal(inspeccion.solicitud.buzonCanonico, 'shared@example.test');

    const claves = procesoA.claves(caso.solicitudId,
      procesoA.calcularHuellaToken(caso.token));
    const ttlsAntes = await Promise.all(claves.map((clave) => redis.pTTL(clave)));
    assert.ok(ttlsAntes.every((ttl) => ttl > 0 && ttl <= 20_000));
    assert.ok(Math.max(...ttlsAntes) - Math.min(...ttlsAntes) < 50);

    const huellaFallida = huellaNombre('nadie');
    const reservaFallida = generarUuidV7Auditoria();
    assert.equal((await procesoA.reservarAlegacion({
      token: caso.token,
      huellaNombreSha256: huellaFallida,
      reservaId: reservaFallida,
      propietario: 'proceso-a',
      leaseSegundos: 10
    })).estado, 'reservada');
    assert.equal((await procesoB.reservarAlegacion({
      token: caso.token,
      huellaNombreSha256: huellaFallida,
      reservaId: generarUuidV7Auditoria(),
      propietario: 'proceso-b',
      leaseSegundos: 10
    })).estado, 'ocupada');
    assert.equal(await procesoB.restaurarAlegacion({
      token: caso.token, huellaNombreSha256: huellaFallida,
      reservaId: reservaFallida, propietario: 'proceso-b'
    }), false);
    const fallida = await procesoA.consolidarAlegacion({
      token: caso.token,
      huellaNombreSha256: huellaFallida,
      reservaId: reservaFallida,
      propietario: 'proceso-a',
      resultado: RESULTADOS_ALEGACION_RECUPERACION_PASSWORD_EMAIL.NO_RESUELTA
    });
    assert.equal(fallida.estado, 'consolidada');
    assert.equal(fallida.agregado.presupuestoRestante, 4);
    const repetida = await procesoB.reservarAlegacion({
      token: caso.token, huellaNombreSha256: huellaFallida,
      reservaId: generarUuidV7Auditoria(), propietario: 'proceso-b',
      leaseSegundos: 10
    });
    assert.equal(repetida.estado, 'repetida');

    const huellaAbandonada = huellaNombre('abandono');
    const reservaAbandonada = generarUuidV7Auditoria();
    await procesoA.reservarAlegacion({
      token: caso.token, huellaNombreSha256: huellaAbandonada,
      reservaId: reservaAbandonada, propietario: 'proceso-a', leaseSegundos: 1
    });
    await new Promise((resolve) => setTimeout(resolve, 1100));
    const reservaRecuperada = generarUuidV7Auditoria();
    assert.equal((await procesoB.reservarAlegacion({
      token: caso.token, huellaNombreSha256: huellaAbandonada,
      reservaId: reservaRecuperada, propietario: 'proceso-b', leaseSegundos: 10
    })).estado, 'reservada');
    assert.equal(await procesoA.restaurarAlegacion({
      token: caso.token, huellaNombreSha256: huellaAbandonada,
      reservaId: reservaAbandonada, propietario: 'proceso-a'
    }), false);
    assert.equal(await procesoB.restaurarAlegacion({
      token: caso.token, huellaNombreSha256: huellaAbandonada,
      reservaId: reservaRecuperada, propietario: 'proceso-b'
    }), true);

    const huellaValida = huellaNombre('usuario');
    const reservaValida = generarUuidV7Auditoria();
    assert.equal((await procesoB.reservarAlegacion({
      token: caso.token, huellaNombreSha256: huellaValida,
      reservaId: reservaValida, propietario: 'proceso-b', leaseSegundos: 10
    })).estado, 'reservada');
    const resuelta = await procesoB.consolidarAlegacion({
      token: caso.token, huellaNombreSha256: huellaValida,
      reservaId: reservaValida, propietario: 'proceso-b',
      resultado: RESULTADOS_ALEGACION_RECUPERACION_PASSWORD_EMAIL.RESUELTA,
      usuarioIdResuelto: '7', generacionRecuperacionObservada: '3'
    });
    assert.equal(resuelta.estado, 'consolidada');
    assert.equal(resuelta.agregado.usuarioIdVinculado, '7');
    assert.equal(resuelta.agregado.presupuestoRestante, 3);
    assert.equal((await procesoA.reservarAlegacion({
      token: caso.token, huellaNombreSha256: huellaNombre('otra'),
      reservaId: generarUuidV7Auditoria(), propietario: 'proceso-a',
      leaseSegundos: 10
    })).estado, 'vinculada');

    const ttlAntesConsumo = await redis.pTTL(claves[0]);
    const reservaConsumoA = generarUuidV7Auditoria();
    const consumoReservado = await procesoA.reservarConsumo({
      token: caso.token, reservaId: reservaConsumoA,
      propietario: 'proceso-a', leaseSegundos: 10
    });
    assert.equal(consumoReservado.estado, 'reservada');
    assert.equal(consumoReservado.usuarioId, '7');
    assert.equal(consumoReservado.generacionRecuperacionObservada, '3');
    assert.equal(consumoReservado.eventoConsumoId,
      caso.preparacion.eventoConsumoId);
    assert.equal((await procesoB.reservarConsumo({
      token: caso.token, reservaId: generarUuidV7Auditoria(),
      propietario: 'proceso-b', leaseSegundos: 10
    })).estado, 'ocupada');
    assert.equal(await procesoB.restaurarConsumo({
      token: caso.token, reservaId: reservaConsumoA, propietario: 'proceso-b'
    }), false);
    assert.equal(await procesoA.restaurarConsumo({
      token: caso.token, reservaId: reservaConsumoA, propietario: 'proceso-a'
    }), true);
    const reservaConsumoFinal = generarUuidV7Auditoria();
    await procesoB.reservarConsumo({
      token: caso.token, reservaId: reservaConsumoFinal,
      propietario: 'proceso-b', leaseSegundos: 10
    });
    assert.equal((await procesoB.consumir({
      token: caso.token, reservaId: reservaConsumoFinal, propietario: 'proceso-b'
    })).estado, 'consumida');
    assert.equal((await procesoB.consumir({
      token: caso.token, reservaId: reservaConsumoFinal, propietario: 'proceso-b'
    })).estado, 'ya_consumida');
    assert.equal((await procesoA.inspeccionar(caso.token)).estado, 'consumida');
    assert.ok(await redis.pTTL(claves[0]) <= ttlAntesConsumo,
      'Reservar y consumir no renuevan el vencimiento absoluto.');

    const retirada = crearCaso(procesoA);
    await procesoA.preparar(retirada.preparacion);
    await procesoA.activar(retirada.activacion);
    assert.equal((await procesoA.retirarIdentidad({
      token: retirada.token,
      usuarioId: '7',
      generacionRecuperacionObservada: '3'
    })).estado, 'retirada');
    assert.equal((await procesoB.retirarIdentidad({
      token: retirada.token,
      usuarioId: '7',
      generacionRecuperacionObservada: '3'
    })).estado, 'ya_retirada');
    assert.equal((await procesoB.retirarIdentidad({
      token: retirada.token,
      usuarioId: '7',
      generacionRecuperacionObservada: '4'
    })).estado, 'ajena');

    const incompleta = crearCaso(procesoA);
    await procesoA.preparar(incompleta.preparacion);
    await procesoA.activar(incompleta.activacion);
    await redis.del(procesoA.claveFrontera(incompleta.solicitudId));
    assert.equal((await procesoA.inspeccionar(incompleta.token)).estado, 'incompleta');

    const desechable = crearCaso(procesoA);
    const preparacionesConcurrentes = await Promise.all([
      procesoA.preparar(desechable.preparacion),
      procesoB.preparar(desechable.preparacion)
    ]);
    assert.deepEqual(preparacionesConcurrentes.map(({ estado }) => estado).sort(),
      ['preparada', 'repetida']);
    assert.equal(await procesoB.descartarPreparacion({
      solicitudId: desechable.solicitudId,
      token: desechable.token,
      operacionId: desechable.preparacion.operacionId,
      propietario: desechable.preparacion.propietario
    }), true);
    assert.equal((await procesoA.inspeccionar(desechable.token)).estado, 'ausente');

    const valores = await leerValores(redis, prefijo);
    assert.doesNotMatch(valores.join('\n'), new RegExp(caso.token, 'u'),
      'El bearer crudo no puede persistirse en Redis.');
    console.log(
      '[usuarios] OK 5.30.4a: redis=namespace_v1 token=256bits+indice_revalidado ' +
      'frontera=completa ttl=absoluto reservas=alegacion+consumo ' +
      'presupuesto=idempotente vinculo=irreversible procesos=2 ' +
      'subordinadas=fallo_cerrado consumo=terminal bearer=no_persistido'
    );
  } finally {
    await limpiar(redis, prefijo);
    await conexion.cerrar();
  }
}

function crearCaso(repositorio) {
  const solicitudId = generarUuidV7Auditoria();
  const token = repositorio.generarToken();
  const operacionId = generarUuidV7Auditoria();
  const propietario = 'coordinador-fixture';
  const frontera = crearFronteraRecuperacionPasswordEmail({
    perfil: PERFILES_RECUPERACION_PASSWORD_EMAIL.FRONTERA,
    version: VERSION_CONTRATO_RECUPERACION_PASSWORD_EMAIL,
    miembros: [
      { usuarioId: '7', generacionRecuperacionObservada: '3',
        estado: ESTADOS_IDENTIDAD_FRONTERA_RECUPERACION_PASSWORD_EMAIL.UTILIZABLE },
      { usuarioId: '11', generacionRecuperacionObservada: '8',
        estado: ESTADOS_IDENTIDAD_FRONTERA_RECUPERACION_PASSWORD_EMAIL.UTILIZABLE }
    ]
  });
  return {
    solicitudId,
    token,
    preparacion: {
      solicitudId, token, buzonCanonico: 'shared@example.test', frontera,
      eventoEmisionId: generarUuidV7Auditoria(),
      eventoConsumoId: generarUuidV7Auditoria(),
      presupuestoMaximo: 5, operacionId, propietario, leaseSegundos: 10
    },
    activacion: {
      solicitudId, token, operacionId, propietario, vigenciaSegundos: 20
    }
  };
}

function huellaNombre(nombre) {
  return crearHuellaRecuperacionPasswordEmail(
    DOMINIOS_HUELLA_RECUPERACION_PASSWORD_EMAIL.NOMBRE_ALEGADO,
    nombre
  );
}

async function leerValores(redis, prefijo) {
  const claves = await buscarClaves(redis, prefijo);
  const valores = [];
  for (const clave of claves) {
    const tipo = await redis.type(clave);
    if (tipo === 'string') valores.push(await redis.get(clave));
  }
  return valores.filter(Boolean);
}

async function limpiar(redis, prefijo) {
  const claves = await buscarClaves(redis, prefijo);
  if (claves.length > 0) await redis.del(claves);
}

async function buscarClaves(redis, prefijo) {
  let cursor = '0';
  const claves = [];
  do {
    const resultado = await redis.scan(cursor, { MATCH: `${prefijo}*`, COUNT: 100 });
    cursor = String(resultado.cursor);
    claves.push(...resultado.keys);
  } while (cursor !== '0');
  return claves;
}

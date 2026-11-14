import assert from 'node:assert/strict';

import {
  ConflictoIdempotenciaAuditoria,
  RepositorioAuditoria
} from '../paquetes/auditoria/src/RepositorioAuditoria.js';
import {
  obtenerHuellaEventoIdAuditoriaV1
} from '../paquetes/auditoria/src/HuellaIntencionAuditoria.js';
import {
  generarUuidV7Auditoria,
  uuidV7AuditoriaABytes
} from '../paquetes/auditoria/src/UuidV7Auditoria.js';
import {
  PERFIL_JCS_AUDITORIA_V1
} from '../paquetes/auditoria/src/PerfilJcsAuditoria.js';
import {
  VERSION_ENCADENADO_AUDITORIA_V1
} from '../paquetes/auditoria/src/SobreCanonicoAuditoria.js';
import { ClienteSql } from '../paquetes/persistencia-sql/src/ClienteSql.js';
import { EjecutorMigraciones } from '../paquetes/persistencia-sql/src/EjecutorMigraciones.js';
import { RepositorioMigraciones } from '../paquetes/persistencia-sql/src/RepositorioMigraciones.js';
import {
  obtenerConfiguracionAplicacion,
  obtenerRutaMigraciones
} from '../paquetes/utilidades/src/configuracion/obtenerConfiguracionAplicacion.js';

const tenantId = String(BigInt(Date.now()) * 1000n + 5302n);
const claveCadena = `monitores:tenant:${tenantId}`;

async function main() {
  const configuracion = obtenerConfiguracionAplicacion();
  assert.equal(configuracion.sql.estaCompleta, true, '5.30.2b requiere SQL local.');
  const clienteSql = new ClienteSql(configuracion.sql);
  const repositorio = new RepositorioAuditoria(clienteSql);
  const eventoConsumoId = generarUuidV7Auditoria();
  const intencion = crearIntencionTestigo(eventoConsumoId);

  let errorPrincipal = null;
  try {
    await asegurarMigraciones(clienteSql);
    await verificarContratoCerrado(repositorio, eventoConsumoId);
    await verificarRollback(repositorio, clienteSql, intencion);
    await verificarCommitRepeticionYColision(repositorio, intencion);
    await verificarRetencion(repositorio, clienteSql, intencion);
  } catch (error) {
    errorPrincipal = error;
  } finally {
    try {
      await limpiar(clienteSql, eventoConsumoId);
    } catch (errorLimpieza) {
      if (!errorPrincipal) throw errorLimpieza;
      console.error('[usuarios] Error adicional limpiando 5.30.2b.');
      console.error(errorLimpieza);
    }
    await clienteSql.cerrar();
  }
  if (errorPrincipal) throw errorPrincipal;
  console.log(
    '[usuarios] OK 5.30.2b: testigo=huella_evento commit=visible rollback=ausente ' +
    'repeticion=idempotente colision=cerrada retencion=irreversible puerto=eventoId'
  );
}

async function verificarContratoCerrado(repositorio, eventoConsumoId) {
  await assert.rejects(
    () => repositorio.existeTestigoEventoEnTransaccion(eventoConsumoId),
    /conexión SQL explícita/u
  );
  const conexionFalsa = { execute: async () => [[]] };
  await assert.rejects(
    () => repositorio.existeTestigoEventoEnTransaccion('token-o-causalidad', {
      conexion: conexionFalsa
    }),
    /UUIDv7/u
  );
  assert.equal(
    Object.hasOwn(RepositorioAuditoria.prototype, 'buscarPorTokenRecuperacionEnTransaccion'),
    false
  );
  assert.equal(
    Object.hasOwn(RepositorioAuditoria.prototype, 'buscarPorBuzonRecuperacionEnTransaccion'),
    false
  );
}

async function verificarRollback(repositorio, clienteSql, intencion) {
  const conexion = await clienteSql.obtenerConexion();
  try {
    await conexion.beginTransaction();
    assert.equal(
      await repositorio.existeTestigoEventoEnTransaccion(intencion.eventoId, { conexion }),
      false
    );
    await repositorio.incorporarEnTransaccion([intencion], { conexion });
    assert.equal(
      await repositorio.existeTestigoEventoEnTransaccion(intencion.eventoId, { conexion }),
      true
    );
    await conexion.rollback();

    await conexion.beginTransaction();
    assert.equal(
      await repositorio.existeTestigoEventoEnTransaccion(intencion.eventoId, { conexion }),
      false
    );
    await conexion.rollback();
  } finally {
    await rollbackSeguro(conexion);
    conexion.release();
  }
}

async function verificarCommitRepeticionYColision(repositorio, intencion) {
  const incorporado = await repositorio.incorporarAtomico([intencion]);
  assert.equal(incorporado.eventos[0].estado, 'incorporado');

  const repetido = await repositorio.incorporarAtomico([intencion]);
  assert.equal(repetido.eventos[0].estado, 'existente');
  assert.equal(repetido.eventos[0].eventoId, intencion.eventoId);

  await assert.rejects(
    () => repositorio.incorporarAtomico([{
      ...intencion,
      claveOperacion: `recuperacion-password:consumo-colision:${intencion.eventoId}`
    }]),
    ConflictoIdempotenciaAuditoria
  );
}

async function verificarRetencion(repositorio, clienteSql, intencion) {
  const conexion = await clienteSql.obtenerConexion();
  try {
    await conexion.beginTransaction();
    assert.equal(
      await repositorio.existeTestigoEventoEnTransaccion(intencion.eventoId, { conexion }),
      true
    );
    await conexion.execute(
      `UPDATE identidades_idempotentes_auditoria
          SET estado='retenido', retenido_en_utc=UTC_TIMESTAMP(3)
        WHERE evento_id=?`,
      [uuidV7AuditoriaABytes(intencion.eventoId)]
    );
    await conexion.execute(
      'DELETE FROM eventos_auditoria WHERE evento_id=?',
      [uuidV7AuditoriaABytes(intencion.eventoId)]
    );
    assert.equal(
      await repositorio.existeTestigoEventoEnTransaccion(intencion.eventoId, { conexion }),
      true
    );
    await conexion.commit();

    await conexion.beginTransaction();
    assert.equal(
      await repositorio.existeTestigoEventoEnTransaccion(intencion.eventoId, { conexion }),
      true
    );
    await conexion.rollback();
  } finally {
    await rollbackSeguro(conexion);
    conexion.release();
  }
}

async function asegurarMigraciones(clienteSql) {
  const ejecutor = new EjecutorMigraciones({
    clienteSql,
    repositorioMigraciones: new RepositorioMigraciones(clienteSql),
    rutaMigraciones: obtenerRutaMigraciones()
  });
  await ejecutor.ejecutarPendientes();
}

function crearIntencionTestigo(eventoConsumoId) {
  return {
    eventoId: eventoConsumoId,
    tipo: 'monitor.creado',
    versionContrato: 1,
    flujo: 'monitores',
    claveCadena,
    actorReal: { tipo: 'usuario', id: '1' },
    actorEfectivo: null,
    modoActuacion: 'directo',
    sujeto: { tipo: 'monitor', id: '5302' },
    origen: 'web',
    scope: { tenantId, empresaId: null, sitioId: null },
    correlacionId: generarUuidV7Auditoria(),
    causalidad: null,
    productor: 'portal_web',
    claveOperacion: `testigo-recuperacion:${eventoConsumoId}`,
    rolEvento: 'principal',
    efectivoEnUtc: new Date().toISOString(),
    versionCanonicalizador: PERFIL_JCS_AUDITORIA_V1,
    versionEncadenado: VERSION_ENCADENADO_AUDITORIA_V1,
    payload: {
      resultado: 'creado',
      antes: null,
      despues: { nombre: 'Testigo 5.30.2b', tipo: 'ping', activo: true }
    }
  };
}

async function limpiar(clienteSql, eventoConsumoId) {
  const conexion = await clienteSql.obtenerConexion();
  try {
    await conexion.beginTransaction();
    const [eventos] = await conexion.execute(
      'SELECT evento_id FROM eventos_auditoria WHERE clave_cadena=?',
      [claveCadena]
    );
    const ids = [...eventos.map(({ evento_id }) => Buffer.from(evento_id))];
    const consumoBinario = uuidV7AuditoriaABytes(eventoConsumoId);
    if (!ids.some((id) => id.equals(consumoBinario))) ids.push(consumoBinario);
    for (const id of ids) {
      await conexion.execute(
        'DELETE FROM identidades_idempotentes_auditoria WHERE evento_id=?',
        [id]
      );
    }
    await conexion.execute('DELETE FROM eventos_auditoria WHERE clave_cadena=?', [claveCadena]);
    for (const id of ids) {
      await conexion.execute(
        'DELETE FROM tombstones_identidad_auditoria WHERE huella_evento_id=?',
        [obtenerHuellaEventoIdAuditoriaV1(id)]
      );
    }
    await conexion.execute('DELETE FROM cadenas_auditoria WHERE clave_cadena=?', [claveCadena]);
    await conexion.commit();
  } catch (error) {
    await rollbackSeguro(conexion);
    throw error;
  } finally {
    conexion.release();
  }
}

async function rollbackSeguro(conexion) {
  try {
    await conexion.rollback();
  } catch {
    // La limpieza conserva el error causal original.
  }
}

main().catch((error) => {
  console.error('[usuarios] Error verificando 5.30.2b.');
  console.error(error);
  process.exitCode = 1;
});

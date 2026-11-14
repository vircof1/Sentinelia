import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';

import { generarUuidV7Auditoria }
  from '../paquetes/auditoria/src/UuidV7Auditoria.js';
import { RepositorioColaCorreo }
  from '../paquetes/correo/src/RepositorioColaCorreo.js';
import {
  ErrorConflictoCorreoVerificacionEmailPerfil,
  RepositorioCoordinacionCorreoVerificacionEmailPerfilSql
} from '../paquetes/correo/src/RepositorioCoordinacionCorreoVerificacionEmailPerfilSql.js';
import { ClienteSql } from '../paquetes/persistencia-sql/src/ClienteSql.js';
import { EjecutorMigraciones } from '../paquetes/persistencia-sql/src/EjecutorMigraciones.js';
import { FronteraTransaccionalLocal }
  from '../paquetes/persistencia-sql/src/FronteraTransaccionalLocal.js';
import { RepositorioMigraciones }
  from '../paquetes/persistencia-sql/src/RepositorioMigraciones.js';
import {
  CLASES_EMISION_VERIFICACION_EMAIL_PERFIL,
  PERFILES_VERIFICACION_EMAIL_PERFIL,
  VERSION_CONTRATO_VERIFICACION_EMAIL_PERFIL
} from '../paquetes/usuarios/src/ContratoVerificacionEmailPerfil.js';
import {
  obtenerConfiguracionAplicacion,
  obtenerRutaMigraciones
} from '../paquetes/utilidades/src/configuracion/obtenerConfiguracionAplicacion.js';


await main();

async function main() {
  const configuracion = obtenerConfiguracionAplicacion();
  assert.equal(configuracion.sql.estaCompleta, true, '5.30b.1b necesita MariaDB real.');

  const administrador = new ClienteSql(configuracion.sql);
  const base = `sentinelia_fixture_530b1b_${randomBytes(5).toString('hex')}`;
  let sql;
  try {
    await administrador.ejecutar(
      `CREATE DATABASE ${administrador.escaparIdentificador(base)} ` +
        'CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci'
    );
    sql = new ClienteSql({ ...configuracion.sql, baseDatos: base });
    const migraciones = await new EjecutorMigraciones({
      clienteSql: sql,
      repositorioMigraciones: new RepositorioMigraciones(sql),
      rutaMigraciones: obtenerRutaMigraciones()
    }).ejecutarPendientes();
    assert.equal(migraciones.integridad.ok, true);
    await sql.ejecutar(
      `INSERT INTO usuarios (id,usuario,email,hash_password,activo,email_validado)
       VALUES (1,'operador-530b1b','origen@example.test','hash',1,1)`
    );

    const frontera = new FronteraTransaccionalLocal(sql);
    const repositorio =
      new RepositorioCoordinacionCorreoVerificacionEmailPerfilSql(sql);
    const operacionId = randomUUID();
    const inicial = crearCaso({ operacionId, clase: 'inicial' });

    await assert.rejects(
      repositorio.crearSalidaPreparadaEnTransaccion(inicial),
      /conexión SQL prestada/iu
    );
    const creada = await frontera.ejecutar((conexion) =>
      repositorio.crearSalidaPreparadaEnTransaccion(inicial, { conexion })
    );
    assert.equal(creada.creada, true);
    assert.equal(creada.salida.estado, 'preparada');
    assert.equal(creada.salida.proximoIntentoEn, null);
    assert.equal(creada.salida.operacionEmailPerfilId, operacionId);
    assert.equal(creada.salida.emisionEmailPerfilId, inicial.emision.emisionEmailPerfilId);
    assert.equal(creada.salida.claseEmisionEmailPerfil, 'inicial');

    const replay = await frontera.ejecutar((conexion) =>
      repositorio.crearSalidaPreparadaEnTransaccion(inicial, { conexion })
    );
    assert.equal(replay.creada, false);
    assert.equal(String(replay.salida.id), String(creada.salida.id));
    await assert.rejects(
      frontera.ejecutar((conexion) =>
        repositorio.crearSalidaPreparadaEnTransaccion({
          ...inicial,
          asunto: 'Otra intención'
        }, { conexion })
      ),
      (error) => error instanceof ErrorConflictoCorreoVerificacionEmailPerfil
    );
    await assert.rejects(
      frontera.ejecutar((conexion) =>
        repositorio.crearSalidaPreparadaEnTransaccion(
          crearCaso({ operacionId, clase: 'inicial' }),
          { conexion }
        )
      ),
      (error) => error instanceof ErrorConflictoCorreoVerificacionEmailPerfil
    );

    const reenvioUno = crearCaso({ operacionId, clase: 'reenvio' });
    const reenvioDos = crearCaso({ operacionId, clase: 'reenvio' });
    const salidasReenvio = [];
    for (const caso of [reenvioUno, reenvioDos]) {
      salidasReenvio.push(await frontera.ejecutar((conexion) =>
        repositorio.crearSalidaPreparadaEnTransaccion(caso, { conexion })
      ));
    }
    assert.ok(salidasReenvio.every((resultado) => resultado.creada));
    assert.notEqual(salidasReenvio[0].salida.id, salidasReenvio[1].salida.id);

    const recuperada = await repositorio.buscarPorEmisionId(
      reenvioUno.emision.emisionEmailPerfilId
    );
    assert.equal(String(recuperada.id), String(salidasReenvio[0].salida.id));
    const referencias = await repositorio.listarReferenciasPorOperacionId(operacionId);
    assert.equal(referencias.length, 3);
    assert.deepEqual(referencias.map((referencia) => referencia.clase), [
      'inicial', 'reenvio', 'reenvio'
    ]);
    const referencia = await repositorio.leerReferenciaParaRevalidacionPorSalidaId(
      creada.salida.id
    );
    assert.deepEqual(Object.keys(referencia).sort(), [
      'clase', 'creadaEnUtc', 'emailCandidato', 'emisionEmailPerfilId',
      'estadoSalida', 'operacionEmailPerfilId', 'salidaId', 'usuarioId'
    ]);
    const lecturaSegura = JSON.stringify({ referencias, referencia });
    assert.doesNotMatch(lecturaSegura, /token-secreto-530b1b/u);
    assert.doesNotMatch(lecturaSegura, /cuerpoTexto|cuerpo_texto|token/iu);

    const resumenHumano = JSON.stringify(creada.salida.serializarResumen());
    assert.doesNotMatch(resumenHumano, new RegExp(operacionId, 'u'));
    assert.doesNotMatch(
      resumenHumano,
      new RegExp(inicial.emision.emisionEmailPerfilId, 'u')
    );
    assert.doesNotMatch(resumenHumano, /token-secreto-530b1b/u);

    const cola = new RepositorioColaCorreo(sql);
    assert.equal(
      await frontera.ejecutar((conexion) => cola.reclamarSiguienteSql({
        propietarioClaim: 'verificador-530b1b',
        leaseMilisegundos: 30_000,
        origenesTipo: ['verificacion_email_perfil']
      }, { conexion })),
      null,
      'La procedencia ya integrada no puede reclamar una salida aún preparada.'
    );

    await assert.rejects(
      frontera.ejecutar((conexion) =>
        repositorio.crearSalidaPreparadaEnTransaccion({
          ...crearCaso({ operacionId: randomUUID(), clase: 'reenvio' }),
          emision: {
            ...crearCaso({ operacionId: randomUUID(), clase: 'reenvio' }).emision,
            clase: 'imposible'
          }
        }, { conexion })
      ),
      /vocabulario cerrado/iu
    );

    console.log(
      '[usuarios] OK 5.30b.1b: repositorio=preparado replay=estable ' +
      'reenvios=multiples inicial=unica lectura=revalidacion_saneada ' +
      'esquema=inicial coordinacion=sql'
    );
  } finally {
    await sql?.cerrar().catch(() => {});
    await administrador.ejecutar(
      `DROP DATABASE IF EXISTS ${administrador.escaparIdentificador(base)}`
    ).catch(() => {});
    await administrador.cerrar();
  }
}

function crearCaso({ operacionId, clase }) {
  const sufijo = randomBytes(6).toString('hex');
  return {
    emision: {
      perfil: PERFILES_VERIFICACION_EMAIL_PERFIL.EMISION,
      version: VERSION_CONTRATO_VERIFICACION_EMAIL_PERFIL,
      operacionEmailPerfilId: operacionId,
      emisionEmailPerfilId: generarUuidV7Auditoria(),
      clase: clase === 'inicial'
        ? CLASES_EMISION_VERIFICACION_EMAIL_PERFIL.INICIAL
        : CLASES_EMISION_VERIFICACION_EMAIL_PERFIL.REENVIO,
      usuarioId: '1',
      emailOrigen: 'origen@example.test',
      emailCandidato: 'candidato@example.test',
      huellaCredencialOrigen: randomBytes(32).toString('hex')
    },
    destinatarioNombre: 'Operador de prueba',
    asunto: 'Confirma tu nuevo email en Sentinelia',
    cuerpoTexto: `Abre /confirmar?token=token-secreto-530b1b-${sufijo}`,
    smtpMessageId: `<530b1b-${sufijo}@correo.test>`,
    creadaEnUtc: new Date().toISOString()
  };
}

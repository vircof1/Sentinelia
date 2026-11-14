import assert from 'node:assert/strict';
import crypto from 'node:crypto';

import { RepositorioCoordinacionCorreoVerificacionEmailPerfilSql }
  from '../paquetes/correo/src/RepositorioCoordinacionCorreoVerificacionEmailPerfilSql.js';
import { ClienteSql } from '../paquetes/persistencia-sql/src/ClienteSql.js';
import { EjecutorMigraciones } from '../paquetes/persistencia-sql/src/EjecutorMigraciones.js';
import { FronteraTransaccionalLocal }
  from '../paquetes/persistencia-sql/src/FronteraTransaccionalLocal.js';
import { RepositorioMigraciones }
  from '../paquetes/persistencia-sql/src/RepositorioMigraciones.js';
import { ServicioConexionRedis }
  from '../paquetes/sesiones/src/ServicioConexionRedis.js';
import { RepositorioOperacionesEmailPerfilRedis }
  from '../paquetes/usuarios/src/RepositorioOperacionesEmailPerfilRedis.js';
import { RepositorioUsuarios }
  from '../paquetes/usuarios/src/RepositorioUsuarios.js';
import { ServicioEmailPerfil }
  from '../paquetes/usuarios/src/ServicioEmailPerfil.js';
import { ServicioEmisionInicialEmailPerfilCoordinada }
  from '../paquetes/usuarios/src/ServicioEmisionInicialEmailPerfilCoordinada.js';
import { ServicioReenvioEmailPerfilCoordinado }
  from '../paquetes/usuarios/src/ServicioReenvioEmailPerfilCoordinado.js';
import {
  obtenerConfiguracionAplicacion,
  obtenerRutaMigraciones
} from '../paquetes/utilidades/src/configuracion/obtenerConfiguracionAplicacion.js';

await main();

async function main() {
  const configuracion = obtenerConfiguracionAplicacion();
  const administrador = new ClienteSql(configuracion.sql);
  const base = `sentinelia_fixture_530b3b_${crypto.randomBytes(5).toString('hex')}`;
  const conexionRedis = new ServicioConexionRedis(configuracion.redis);
  const redis = await conexionRedis.conectar();
  const prefijo = `prueba:530b3b:${crypto.randomUUID()}:`;
  let sql;
  try {
    await administrador.ejecutar(
      `CREATE DATABASE ${administrador.escaparIdentificador(base)} ` +
        'CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci'
    );
    sql = new ClienteSql({ ...configuracion.sql, baseDatos: base });
    await new EjecutorMigraciones({
      clienteSql: sql,
      repositorioMigraciones: new RepositorioMigraciones(sql),
      rutaMigraciones: obtenerRutaMigraciones()
    }).ejecutarPendientes();
    await sql.ejecutar(
      `INSERT INTO usuarios (
         id,usuario,email,hash_password,activo,email_validado,nombre_mostrar
       ) VALUES (61,'operador-61','origen-61@example.test','hash-530b3b',1,1,'Operador')`
    );
    const usuarios = new RepositorioUsuarios(sql);
    const operaciones = new RepositorioOperacionesEmailPerfilRedis({
      clienteRedis: redis,
      prefijoRedis: prefijo,
      secretoProteccionTokens: configuracion.sesion.secreto
    });
    const correo = new RepositorioCoordinacionCorreoVerificacionEmailPerfilSql(sql);
    const frontera = new FronteraTransaccionalLocal(sql);
    const servicioCorreoPortal = {
      async obtenerEstadoConfiguracionAutoritativo() {
        return { puedeDespachar: true, operativo: true };
      }
    };
    const servicioConfiguracionPortal = {
      async asegurarActualizada() {},
      obtenerConfiguracionActual() {
        return {
          obtenerOrigenPublicoPortal: () => 'https://sentinelia.example.test',
          obtenerNombreVisiblePortal: () => 'Sentinelia'
        };
      }
    };
    const baseServicios = {
      repositorioUsuarios: usuarios,
      repositorioOperacionesEmail: operaciones,
      repositorioCoordinacionCorreo: correo,
      servicioCorreoPortal,
      servicioConfiguracionPortal,
      fronteraTransaccional: frontera
    };
    const inicial = new ServicioEmisionInicialEmailPerfilCoordinada({
      ...baseServicios,
      servicioEmailPerfil: new ServicioEmailPerfil({ repositorioUsuarios: usuarios })
    });
    const reenvio = new ServicioReenvioEmailPerfilCoordinado(baseServicios);

    await inicial.encolarInicial({
      idUsuario: '61',
      emailCandidato: 'candidato-61@example.test'
    });
    const pendiente = await operaciones.obtenerOperacionActual(61);
    const activacionInicial = await operaciones.activarOperacionTrasAceptacionSmtp({
      operacionEmailPerfilId: pendiente.operacion.idOperacion,
      emisionEmailPerfilId: pendiente.operacion.emisionInicialId,
      salidaId: pendiente.operacion.salidaInicialId,
      aceptadaEnUtc: new Date().toISOString()
    });
    assert.equal(activacionInicial.estado, 'activada');
    const antes = await operaciones.obtenerOperacionActual(61);
    const token = operaciones.recuperarTokenOperacion(antes.operacion);
    await redis.del(operaciones.claveCadenciaReenvio(61));
    const resultado = await reenvio.encolarReenvio({ idUsuario: '61' });
    assert.deepEqual(resultado, {
      codigo: 'email_verificacion_reenvio_encolado',
      mensaje: 'Verificación encolada de nuevo.'
    });
    const filas = await sql.consultar(
      `SELECT id,clase_emision_email_perfil clase,estado,asunto,cuerpo_texto,
              HEX(operacion_email_perfil_id) operacion,
              HEX(emision_email_perfil_id) emision
         FROM cola_correos_salida
        WHERE origen_tipo='verificacion_email_perfil'
          AND creado_por_usuario_id=61 ORDER BY id`
    );
    assert.equal(filas.length, 2);
    assert.deepEqual(filas.map(({ clase }) => clase), ['inicial', 'reenvio']);
    assert.ok(filas.every(({ estado }) => estado === 'pendiente'));
    assert.equal(filas[0].operacion, filas[1].operacion);
    assert.notEqual(filas[0].emision, filas[1].emision);
    assert.ok(filas.every(({ asunto }) =>
      asunto === 'Confirma el cambio de correo en Sentinelia'));
    assert.ok(filas.every(({ cuerpo_texto }) => cuerpo_texto.includes(token)));
    const despues = await operaciones.obtenerOperacionActual(61);
    assert.equal(despues.estado, 'activa');
    assert.equal(despues.operacion.idOperacion, antes.operacion.idOperacion);
    assert.equal(despues.operacion.huellaToken, antes.operacion.huellaToken);
    assert.equal(operaciones.recuperarTokenOperacion(despues.operacion), token);
    assert.equal(despues.operacion.reenvios.length, 1);
    assert.equal(despues.operacion.expiraEn, antes.operacion.expiraEn);
    await assert.rejects(
      reenvio.encolarReenvio({ idUsuario: '61' }),
      (error) => error.codigo === 'reenvio_limitado'
    );

    await redis.del(operaciones.claveCadenciaReenvio(61));
    const correoConFallo = new Proxy(correo, {
      get(objetivo, propiedad) {
        if (propiedad === 'liberarSalidaPreparadaEnTransaccion') {
          return async () => { throw new Error('liberacion_reenvio_fallida_530b3b'); };
        }
        const valor = objetivo[propiedad];
        return typeof valor === 'function' ? valor.bind(objetivo) : valor;
      }
    });
    const reenvioConFallo = new ServicioReenvioEmailPerfilCoordinado({
      ...baseServicios,
      repositorioCoordinacionCorreo: correoConFallo
    });
    const vencimientoAntesFallo = despues.operacion.expiraEn;
    await assert.rejects(
      reenvioConFallo.encolarReenvio({ idUsuario: '61' }),
      /liberacion_reenvio_fallida_530b3b/u
    );
    assert.equal((await operaciones.obtenerOperacionActual(61)).operacion.expiraEn,
      vencimientoAntesFallo);
    assert.equal((await operaciones.intentarRegistrarReenvio(61)).permitido, false);
    assert.equal((await sql.consultar(
      `SELECT COUNT(*) total FROM cola_correos_salida
        WHERE origen_tipo='verificacion_email_perfil'
          AND creado_por_usuario_id=61`
    ))[0].total, 2);
    const usuario = await usuarios.buscarPorId(61);
    assert.equal(usuario.email, 'origen-61@example.test');
    assert.equal(usuario.emailValidado, true);

    console.log(
      '[usuarios] OK 5.30b.3b: reenvio=coordinado salida=nueva ' +
      'operacion_token_enlace=estables cadencia=respetada ' +
      'fallo_preliberacion=vigencia_anterior smtp_web=no'
    );
  } finally {
    await limpiarPrefijo(redis, prefijo);
    await conexionRedis.cerrar();
    await sql?.cerrar().catch(() => {});
    await administrador.ejecutar(
      `DROP DATABASE IF EXISTS ${administrador.escaparIdentificador(base)}`
    ).catch(() => {});
    await administrador.cerrar();
  }
}

async function limpiarPrefijo(redis, prefijo) {
  const claves = [];
  for await (const clave of redis.scanIterator({ MATCH: `${prefijo}*`, COUNT: 100 })) {
    claves.push(clave);
  }
  if (claves.length > 0) await redis.del(claves);
}

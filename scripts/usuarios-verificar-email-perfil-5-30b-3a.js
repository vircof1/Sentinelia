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
import {
  obtenerConfiguracionAplicacion,
  obtenerRutaMigraciones
} from '../paquetes/utilidades/src/configuracion/obtenerConfiguracionAplicacion.js';

await main();

async function main() {
  const configuracion = obtenerConfiguracionAplicacion();
  const administrador = new ClienteSql(configuracion.sql);
  const base = `sentinelia_fixture_530b3a_${crypto.randomBytes(5).toString('hex')}`;
  const conexionRedis = new ServicioConexionRedis(configuracion.redis);
  const redis = await conexionRedis.conectar();
  const prefijo = `prueba:530b3a:${crypto.randomUUID()}:`;
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
    for (const id of [51, 52, 53]) {
      await sql.ejecutar(
        `INSERT INTO usuarios (
           id,usuario,email,hash_password,activo,email_validado,nombre_mostrar
         ) VALUES (?,? ,?,'hash-530b3a',1,1,'Operador')`,
        [id, `operador-${id}`, `origen-${id}@example.test`]
      );
    }

    const usuarios = new RepositorioUsuarios(sql);
    const operaciones = new RepositorioOperacionesEmailPerfilRedis({
      clienteRedis: redis,
      prefijoRedis: prefijo,
      secretoProteccionTokens: configuracion.sesion.secreto
    });
    const correo = new RepositorioCoordinacionCorreoVerificacionEmailPerfilSql(sql);
    const frontera = new FronteraTransaccionalLocal(sql);
    const estadoCorreo = { operativo: true, async obtenerEstadoConfiguracionAutoritativo() {
      return { puedeDespachar: this.operativo, operativo: this.operativo };
    } };
    const configuracionPortal = {
      async asegurarActualizada() {},
      obtenerConfiguracionActual() {
        return {
          obtenerOrigenPublicoPortal: () => 'https://sentinelia.example.test',
          obtenerNombreVisiblePortal: () => 'Sentinelia'
        };
      }
    };
    const dependencias = {
      repositorioUsuarios: usuarios,
      repositorioOperacionesEmail: operaciones,
      repositorioCoordinacionCorreo: correo,
      servicioCorreoPortal: estadoCorreo,
      servicioConfiguracionPortal: configuracionPortal,
      servicioEmailPerfil: new ServicioEmailPerfil({ repositorioUsuarios: usuarios }),
      fronteraTransaccional: frontera
    };
    const servicio = new ServicioEmisionInicialEmailPerfilCoordinada(dependencias);

    const salidaHumana = await servicio.encolarInicial({
      idUsuario: '51',
      emailCandidato: 'candidato-51@example.test'
    });
    assert.deepEqual(salidaHumana, {
      codigo: 'email_verificacion_encolada',
      mensaje: 'Correo de verificación encolado.'
    });
    const [salida] = await sql.consultar(
      `SELECT id,estado,proximo_intento_en,asunto,cuerpo_texto,
              LOWER(CONCAT(
                SUBSTR(HEX(operacion_email_perfil_id),1,8),'-',
                SUBSTR(HEX(operacion_email_perfil_id),9,4),'-',
                SUBSTR(HEX(operacion_email_perfil_id),13,4),'-',
                SUBSTR(HEX(operacion_email_perfil_id),17,4),'-',
                SUBSTR(HEX(operacion_email_perfil_id),21)
              )) operacion_id
         FROM cola_correos_salida
        WHERE origen_tipo='verificacion_email_perfil'
          AND creado_por_usuario_id=51`
    );
    assert.equal(salida.estado, 'pendiente');
    assert.ok(salida.proximo_intento_en);
    const actual = await operaciones.obtenerOperacionActual(51);
    assert.equal(actual.estado, 'pendiente_aceptacion_smtp');
    assert.equal(actual.operacion.idOperacion, salida.operacion_id);
    assert.equal(String(actual.operacion.salidaInicialId), String(salida.id));
    const token = operaciones.recuperarTokenOperacion(actual.operacion);
    assert.ok(token);
    assert.equal(
      salida.asunto,
      'Confirma el cambio de correo en Sentinelia'
    );
    assert.match(
      salida.cuerpo_texto,
      /iniciar sesión, si es necesario, y confirmar expresamente/u
    );
    assert.match(salida.cuerpo_texto, new RegExp(token, 'u'));
    assert.doesNotMatch(JSON.stringify(salidaHumana), new RegExp(token, 'u'));

    estadoCorreo.operativo = false;
    const degradada = await servicio.encolarInicial({
      idUsuario: '52',
      emailCandidato: 'candidato-52@example.test'
    });
    assert.equal(degradada.codigo, 'email_actualizado_no_validado');
    const usuarioDegradado = await usuarios.buscarPorId(52);
    assert.equal(usuarioDegradado.email, 'candidato-52@example.test');
    assert.equal(usuarioDegradado.emailValidado, false);
    assert.equal(await contarSalidas(sql, 52), 0);

    estadoCorreo.operativo = true;
    const correoConFallo = new Proxy(correo, {
      get(objetivo, propiedad) {
        if (propiedad === 'liberarSalidaPreparadaEnTransaccion') {
          return async () => { throw new Error('liberacion_sql_fallida_530b3a'); };
        }
        const valor = objetivo[propiedad];
        return typeof valor === 'function' ? valor.bind(objetivo) : valor;
      }
    });
    const servicioConFallo = new ServicioEmisionInicialEmailPerfilCoordinada({
      ...dependencias,
      repositorioCoordinacionCorreo: correoConFallo
    });
    await assert.rejects(
      servicioConFallo.encolarInicial({
        idUsuario: '53',
        emailCandidato: 'candidato-53@example.test'
      }),
      /liberacion_sql_fallida_530b3a/u
    );
    assert.equal(await contarSalidas(sql, 53), 0);
    assert.equal((await operaciones.obtenerOperacionActual(53)).estado, 'ausente');

    console.log(
      '[usuarios] OK 5.30b.3a: emision_inicial=coordinada sql=pendiente ' +
      'redis=pendiente_aceptacion puerto=solo_encolado smtp_web=no ' +
      'correo_no_operativo=degradacion_actual corte=estados_saneados'
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

async function contarSalidas(sql, usuarioId) {
  const [fila] = await sql.consultar(
    `SELECT COUNT(*) total FROM cola_correos_salida
      WHERE origen_tipo='verificacion_email_perfil'
        AND creado_por_usuario_id=?`,
    [usuarioId]
  );
  return Number(fila.total);
}

async function limpiarPrefijo(redis, prefijo) {
  const claves = [];
  for await (const clave of redis.scanIterator({ MATCH: `${prefijo}*`, COUNT: 100 })) {
    claves.push(clave);
  }
  if (claves.length > 0) await redis.del(claves);
}

import assert from 'node:assert/strict';
import crypto from 'node:crypto';

import { RepositorioColaCorreo }
  from '../paquetes/correo/src/RepositorioColaCorreo.js';
import { RepositorioCoordinacionCorreoVerificacionEmailPerfilSql }
  from '../paquetes/correo/src/RepositorioCoordinacionCorreoVerificacionEmailPerfilSql.js';
import { ClienteSql } from '../paquetes/persistencia-sql/src/ClienteSql.js';
import { EjecutorMigraciones }
  from '../paquetes/persistencia-sql/src/EjecutorMigraciones.js';
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
import { ServicioInicioDespachoVerificacionEmailPerfil }
  from '../paquetes/usuarios/src/ServicioInicioDespachoVerificacionEmailPerfil.js';
import {
  obtenerConfiguracionAplicacion,
  obtenerRutaMigraciones
} from '../paquetes/utilidades/src/configuracion/obtenerConfiguracionAplicacion.js';

await main();

async function main() {
  const configuracion = obtenerConfiguracionAplicacion();
  const administrador = new ClienteSql(configuracion.sql);
  const base = `sentinelia_fixture_530b4a_${crypto.randomBytes(5).toString('hex')}`;
  const conexionRedis = new ServicioConexionRedis(configuracion.redis);
  const redis = await conexionRedis.conectar();
  const prefijo = `prueba:530b4a:${crypto.randomUUID()}:`;
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
    for (const id of [61, 62, 63, 64]) {
      await sql.ejecutar(
        `INSERT INTO usuarios (
           id,usuario,email,hash_password,activo,email_validado,nombre_mostrar
         ) VALUES (?,? ,?,'hash-530b4a',1,1,'Operador')`,
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
    const cola = new RepositorioColaCorreo(sql);
    const frontera = new FronteraTransaccionalLocal(sql);
    const emisor = new ServicioEmisionInicialEmailPerfilCoordinada({
      repositorioUsuarios: usuarios,
      repositorioOperacionesEmail: operaciones,
      repositorioCoordinacionCorreo: correo,
      servicioCorreoPortal: {
        obtenerEstadoConfiguracionAutoritativo: async () => ({
          puedeDespachar: true,
          operativo: true
        })
      },
      servicioConfiguracionPortal: {
        async asegurarActualizada() {},
        obtenerConfiguracionActual: () => ({
          obtenerOrigenPublicoPortal: () => 'https://sentinelia.example.test',
          obtenerNombreVisiblePortal: () => 'Sentinelia'
        })
      },
      servicioEmailPerfil: new ServicioEmailPerfil({ repositorioUsuarios: usuarios }),
      fronteraTransaccional: frontera
    });
    const iniciador = new ServicioInicioDespachoVerificacionEmailPerfil({
      repositorioUsuarios: usuarios,
      repositorioOperacionesEmail: operaciones,
      repositorioCoordinacionCorreo: correo,
      repositorioColaCorreo: cola
    });

    const vigente = await prepararYReclamar({ emisor, cola, frontera, usuarioId: 61 });
    const inicio = await frontera.ejecutar((conexion) =>
      iniciador.iniciarIntentoEnTransaccion(argumentosInicio(vigente), { conexion })
    );
    assert.equal(inicio.iniciado, true);
    assert.equal(inicio.salida.estado, 'enviando');
    assert.equal(inicio.intento.numero, 1);

    const obsoleta = await prepararYReclamar({ emisor, cola, frontera, usuarioId: 62 });
    await sql.ejecutar('UPDATE usuarios SET hash_password=? WHERE id=62', [
      'hash-cambiado-530b4a'
    ]);
    const descarte = await frontera.ejecutar((conexion) =>
      iniciador.iniciarIntentoEnTransaccion(argumentosInicio(obsoleta), { conexion })
    );
    assert.equal(descarte.iniciado, false);
    assert.equal(descarte.estadoSalida, 'descartada');
    assert.equal(descarte.codigo, 'credencial_email_perfil_cambiada');

    const expirada = await prepararYReclamar({ emisor, cola, frontera, usuarioId: 63 });
    const operacion63 = await operaciones.obtenerOperacionActual(63);
    const clave63 = `${prefijo}operacion:${operacion63.operacion.idOperacion}`;
    await redis.set(clave63, JSON.stringify({
      ...operacion63.operacion,
      expiraEn: new Date(Date.now() - 1_000).toISOString()
    }), { EX: 60 });
    const descarteExpirado = await frontera.ejecutar((conexion) =>
      iniciador.iniciarIntentoEnTransaccion(argumentosInicio(expirada), { conexion })
    );
    assert.equal(descarteExpirado.codigo, 'operacion_email_perfil_expirada');

    const reintentable = await prepararYReclamar({
      emisor, cola, frontera, usuarioId: 64
    });
    const operacionesCaidas = new Proxy(operaciones, {
      get(objetivo, propiedad) {
        if (propiedad === 'adquirirBloqueoUsuario') {
          return async () => { throw new Error('redis_no_disponible_530b4a'); };
        }
        const valor = objetivo[propiedad];
        return typeof valor === 'function' ? valor.bind(objetivo) : valor;
      }
    });
    const iniciadorSinRedis = new ServicioInicioDespachoVerificacionEmailPerfil({
      repositorioUsuarios: usuarios,
      repositorioOperacionesEmail: operacionesCaidas,
      repositorioCoordinacionCorreo: correo,
      repositorioColaCorreo: cola
    });
    const reintento = await frontera.ejecutar((conexion) =>
      iniciadorSinRedis.iniciarIntentoEnTransaccion(
        argumentosInicio(reintentable),
        { conexion }
      )
    );
    assert.equal(reintento.iniciado, false);
    assert.equal(reintento.codigo, 'redis_no_disponible');
    const salidaReintentable = await cola.buscarPorId(reintentable.salida.id);
    assert.equal(salidaReintentable.estado, 'pendiente');
    assert.equal(salidaReintentable.intentos, 0);

    console.log(
      '[usuarios] OK 5.30b.4a: seleccion=comun autoridad=redis+sql+usuario ' +
      'vigente=enviando obsoleta=descartada expiracion=tipada ' +
      'redis_caido=reintentable smtp=no_iniciado'
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

async function prepararYReclamar({ emisor, cola, frontera, usuarioId }) {
  await emisor.encolarInicial({
    idUsuario: String(usuarioId),
    emailCandidato: `candidato-${usuarioId}@example.test`
  });
  return frontera.ejecutar((conexion) => cola.reclamarSiguienteSql({
    propietarioClaim: `fixture-530b4a-${usuarioId}`,
    leaseMilisegundos: 120_000,
    origenesTipo: ['verificacion_email_perfil']
  }, { conexion }));
}

function argumentosInicio(reclamacion) {
  return {
    reclamacionId: reclamacion.reclamacionId,
    salidaId: String(reclamacion.salida.id),
    claimId: reclamacion.claimId,
    leaseToken: reclamacion.leaseToken,
    propietarioClaim: reclamacion.propietarioClaim,
    fencingToken: reclamacion.fencingToken,
    configuracionVersion: '1',
    maxReintentos: 2,
    margenMinimoLeaseMs: 0
  };
}

async function limpiarPrefijo(redis, prefijo) {
  const claves = [];
  for await (const clave of redis.scanIterator({ MATCH: `${prefijo}*`, COUNT: 100 })) {
    claves.push(clave);
  }
  if (claves.length > 0) await redis.del(claves);
}

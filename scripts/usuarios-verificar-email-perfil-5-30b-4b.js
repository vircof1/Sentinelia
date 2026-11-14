import assert from 'node:assert/strict';
import crypto from 'node:crypto';

import { DespachadorCorreoSql }
  from '../paquetes/correo/src/DespachadorCorreoSql.js';
import { RepositorioColaCorreo }
  from '../paquetes/correo/src/RepositorioColaCorreo.js';
import { RepositorioCoordinacionCorreoVerificacionEmailPerfilSql }
  from '../paquetes/correo/src/RepositorioCoordinacionCorreoVerificacionEmailPerfilSql.js';
import {
  CLASIFICACIONES_INTENTO_SMTP_CORREO as C,
  ESTADOS_INTENTO_SMTP_CORREO as E
} from '../paquetes/correo/src/ContratoSalidaCorreo.js';
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
  const base = `sentinelia_fixture_530b4b_${crypto.randomBytes(5).toString('hex')}`;
  const conexionRedis = new ServicioConexionRedis(configuracion.redis);
  const redis = await conexionRedis.conectar();
  const prefijo = `prueba:530b4b:${crypto.randomUUID()}:`;
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
    for (const id of [71, 72, 73, 74, 75, 76]) {
      await sql.ejecutar(
        `INSERT INTO usuarios (
           id,usuario,email,hash_password,activo,email_validado,nombre_mostrar
         ) VALUES (?,? ,?,'hash-530b4b',1,1,'Operador')`,
        [id, `operador-${id}`, `origen-${id}@example.test`]
      );
    }

    const usuarios = new RepositorioUsuarios(sql);
    const operaciones = new RepositorioOperacionesEmailPerfilRedis({
      clienteRedis: redis,
      prefijoRedis: prefijo,
      secretoProteccionTokens: configuracion.sesion.secreto,
      cadenciaReenvioSegundos: 1
    });
    const correo = new RepositorioCoordinacionCorreoVerificacionEmailPerfilSql(sql);
    const cola = new RepositorioColaCorreo(sql);
    const frontera = new FronteraTransaccionalLocal(sql);
    const portal = {
      async asegurarActualizada() {},
      obtenerConfiguracionActual: () => ({
        obtenerOrigenPublicoPortal: () => 'https://sentinelia.example.test',
        obtenerNombreVisiblePortal: () => 'Sentinelia'
      })
    };
    const estadoCorreo = {
      obtenerEstadoConfiguracionAutoritativo: async () => ({
        puedeDespachar: true,
        operativo: true
      })
    };
    const dependenciasEmision = {
      repositorioUsuarios: usuarios,
      repositorioOperacionesEmail: operaciones,
      repositorioCoordinacionCorreo: correo,
      servicioCorreoPortal: estadoCorreo,
      servicioConfiguracionPortal: portal,
      servicioEmailPerfil: new ServicioEmailPerfil({ repositorioUsuarios: usuarios }),
      fronteraTransaccional: frontera
    };
    const emisor = new ServicioEmisionInicialEmailPerfilCoordinada(
      dependenciasEmision
    );
    const reemisor = new ServicioReenvioEmailPerfilCoordinado({
      ...dependenciasEmision
    });

    let fallosPostcommit = 0;
    const operacionesPostcommit = new Proxy(operaciones, {
      get(objetivo, propiedad) {
        if (propiedad === 'invalidarOperacionUsuario') {
          return async (...argumentos) => {
            if (fallosPostcommit++ === 0) throw new Error('corte_postcommit_530b4b');
            return objetivo.invalidarOperacionUsuario(...argumentos);
          };
        }
        const valor = objetivo[propiedad];
        return typeof valor === 'function' ? valor.bind(objetivo) : valor;
      }
    });
    const iniciador = new ServicioInicioDespachoVerificacionEmailPerfil({
      repositorioUsuarios: usuarios,
      repositorioOperacionesEmail: operacionesPostcommit,
      repositorioCoordinacionCorreo: correo,
      repositorioColaCorreo: cola
    });
    const resultados = [
      resultado(E.ACEPTADO, C.ACEPTACION_DEMOSTRADA, 'smtp_aceptado'),
      resultado(E.RECHAZADO, C.RECHAZO_PERMANENTE, 'smtp_rechazo_permanente'),
      resultado(E.FALLIDO_REINTENTABLE, C.FALLO_REINTENTABLE,
        'smtp_fallo_temporal'),
      resultado(E.AMBIGUO, C.RESULTADO_AMBIGUO, 'smtp_resultado_ambiguo'),
      resultado(E.ACEPTADO, C.ACEPTACION_DEMOSTRADA, 'smtp_aceptado'),
      resultado(E.RECHAZADO, C.RECHAZO_PERMANENTE, 'smtp_rechazo_permanente')
    ];
    const despachador = new DespachadorCorreoSql({
      fronteraTransaccional: frontera,
      repositorioColaCorreo: cola,
      iniciadorVerificacionEmailPerfil: iniciador,
      evaluadorAutoridadCorreoSql: {
        evaluarEnTransaccion: async () => ({
          puedeDespachar: true,
          codigo: 'correo_operativo',
          versionConfiguracion: '1',
          remitenteEmailCanonico: 'portal@example.test',
          configuracion: {
            maxReintentos: 2,
            reintentoBaseSegundos: 3_600,
            smtpTimeoutConexionMs: 1,
            smtpTimeoutSaludoMs: 1,
            smtpTimeoutSocketMs: 1,
            remitenteEmail: 'portal@example.test',
            remitenteNombre: 'Sentinelia'
          }
        })
      },
      clienteSmtp: {
        enviarIntentoTrigger: async () => { throw new Error('ruta_incorrecta'); },
        enviarIntentoSql: async () => resultados.shift()
      },
      identificadorInstancia: 'fixture-530b4b',
      leaseMilisegundos: 120_000,
      margenConsolidacionMs: 0
    });

    await encolar(emisor, 71);
    assert.equal((await despachador.despacharSiguiente()).estadoSalida, 'enviado');
    assert.equal((await operaciones.obtenerOperacionActual(71)).estado, 'activa');

    await encolar(emisor, 72);
    const rechazo = await despachador.despacharSiguiente();
    assert.equal(rechazo.estadoSalida, 'error_final');
    assert.equal(rechazo.convergenciaPostcommit.aplicado, true);
    assert.equal(fallosPostcommit, 2);
    const usuario72 = await usuarios.buscarPorId(72);
    assert.equal(usuario72.email, 'candidato-72@example.test');
    assert.equal(usuario72.emailValidado, false);
    assert.equal((await operaciones.obtenerOperacionActual(72)).estado, 'ausente');

    await encolar(emisor, 73);
    assert.equal(
      (await despachador.despacharSiguiente()).estadoSalida,
      'error_reintentable'
    );
    assert.equal((await operaciones.obtenerOperacionActual(73)).estado,
      'pendiente_aceptacion_smtp');

    await encolar(emisor, 74);
    assert.equal(
      (await despachador.despacharSiguiente()).estadoSalida,
      'resultado_ambiguo'
    );
    assert.equal((await operaciones.obtenerOperacionActual(74)).estado,
      'pendiente_aceptacion_smtp');

    await encolar(emisor, 75);
    assert.equal((await despachador.despacharSiguiente()).estadoSalida, 'enviado');
    const operacionAntesReenvio = await operaciones.obtenerOperacionActual(75);
    await redis.del(`${prefijo}usuario:75:cadencia_reenvio`);
    await reemisor.encolarReenvio({ idUsuario: '75' });
    const rechazoReenvio = await despachador.despacharSiguiente();
    assert.equal(rechazoReenvio.estadoSalida, 'error_final');
    const operacionTrasReenvio = await operaciones.obtenerOperacionActual(75);
    assert.equal(operacionTrasReenvio.estado, 'activa');
    assert.equal(
      operacionTrasReenvio.operacion.idOperacion,
      operacionAntesReenvio.operacion.idOperacion
    );
    assert.equal((await usuarios.buscarPorId(75)).email, 'origen-75@example.test');

    await encolar(emisor, 76);
    await sql.ejecutar(
      `UPDATE cola_correos_salida SET intentos=3
        WHERE origen_tipo='verificacion_email_perfil'
          AND creado_por_usuario_id=76`
    );
    const agotada = await despachador.despacharSiguiente();
    assert.equal(agotada.estadoSalida, 'error_final');
    const usuario76 = await usuarios.buscarPorId(76);
    assert.equal(usuario76.email, 'candidato-76@example.test');
    assert.equal(usuario76.emailValidado, false);
    assert.equal((await operaciones.obtenerOperacionActual(76)).estado, 'ausente');

    assert.equal(resultados.length, 0);
    console.log(
      '[usuarios] OK 5.30b.4b: smtp=comun aceptacion=activa_desde_smtp ' +
      'fallo_inicial=degradacion+invalidacion reintento=conserva ' +
      'ambiguo=terminal+vigencia reenvio_fallido=operacion_intacta ' +
      'agotamiento=degradacion postcommit=reintentado_idempotente'
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

async function encolar(emisor, usuarioId) {
  await emisor.encolarInicial({
    idUsuario: String(usuarioId),
    emailCandidato: `candidato-${usuarioId}@example.test`
  });
}

function resultado(estado, clasificacion, codigo) {
  return Object.freeze({
    estado,
    clasificacion,
    codigo,
    respuestaSaneada: `respuesta ${codigo}`
  });
}

async function limpiarPrefijo(redis, prefijo) {
  const claves = [];
  for await (const clave of redis.scanIterator({ MATCH: `${prefijo}*`, COUNT: 100 })) {
    claves.push(clave);
  }
  if (claves.length > 0) await redis.del(claves);
}

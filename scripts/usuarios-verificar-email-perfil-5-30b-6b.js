import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

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
import { ServicioCambioEmailPerfil }
  from '../paquetes/usuarios/src/ServicioCambioEmailPerfil.js';
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
  verificarCapacidadPublicada();
  const configuracion = obtenerConfiguracionAplicacion();
  assert.equal(configuracion.sql.estaCompleta, true, '5.30b.6b necesita MariaDB real.');
  const administrador = new ClienteSql(configuracion.sql);
  const base = `sentinelia_fixture_530b6b_${crypto.randomBytes(5).toString('hex')}`;
  const conexionRedis = new ServicioConexionRedis(configuracion.redis);
  const redis = await conexionRedis.conectar();
  const prefijo = `prueba:530b6b:${crypto.randomUUID()}:`;
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
       ) VALUES
         (81,'operador-81','origen-81@example.test','hash-530b6b',1,1,'Operador'),
         (82,'operador-82','origen-82@example.test','hash-530b6b',1,1,'Operador'),
         (83,'operador-83','origen-83@example.test','hash-530b6b',1,1,'Operador')`
    );

    const usuarios = new RepositorioUsuarios(sql);
    const operaciones = new RepositorioOperacionesEmailPerfilRedis({
      clienteRedis: redis,
      prefijoRedis: prefijo,
      secretoProteccionTokens: configuracion.sesion.secreto
    });
    const correo = new RepositorioCoordinacionCorreoVerificacionEmailPerfilSql(sql);
    const cola = new RepositorioColaCorreo(sql);
    const frontera = new FronteraTransaccionalLocal(sql);
    const comunes = {
      repositorioUsuarios: usuarios,
      repositorioOperacionesEmail: operaciones,
      servicioCorreoPortal: {
        obtenerEstadoConfiguracionAutoritativo: async () => ({
          puedeDespachar: true, operativo: true
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
    };

    const entradaSql = diferido();
    const liberarSql = diferido();
    const correoLento = new Proxy(correo, {
      get(objetivo, propiedad) {
        if (propiedad === 'crearSalidaPreparadaEnTransaccion') {
          return async (...argumentos) => {
            entradaSql.resolver();
            await liberarSql.promesa;
            return objetivo.crearSalidaPreparadaEnTransaccion(...argumentos);
          };
        }
        const valor = objetivo[propiedad];
        return typeof valor === 'function' ? valor.bind(objetivo) : valor;
      }
    });
    const webUno = new ServicioEmisionInicialEmailPerfilCoordinada({
      ...comunes, repositorioCoordinacionCorreo: correoLento
    });
    const webDos = new ServicioEmisionInicialEmailPerfilCoordinada({
      ...comunes, repositorioCoordinacionCorreo: correo
    });
    const primera = webUno.encolarInicial({
      idUsuario: '81', emailCandidato: 'candidato-81@example.test'
    });
    await entradaSql.promesa;
    await assert.rejects(
      webDos.encolarInicial({
        idUsuario: '81', emailCandidato: 'intruso-81@example.test'
      }),
      (error) => error?.codigo === 'operacion_email_en_conflicto'
    );
    liberarSql.resolver();
    assert.equal((await primera).codigo, 'email_verificacion_encolada');
    assert.equal(await contar(sql,
      "origen_tipo='verificacion_email_perfil' AND estado='pendiente'"), 1);

    const iniciador = new ServicioInicioDespachoVerificacionEmailPerfil({
      repositorioUsuarios: usuarios,
      repositorioOperacionesEmail: operaciones,
      repositorioCoordinacionCorreo: correo,
      repositorioColaCorreo: cola
    });
    const puertasSmtp = [crearPuertaSmtp(), crearPuertaSmtp(), crearPuertaSmtp()];
    let enviosSmtp = 0;
    const smtp = {
      enviarIntentoTrigger: async () => { throw new Error('ruta_incorrecta'); },
      async enviarIntentoSql() {
        enviosSmtp += 1;
        const puerta = puertasSmtp.shift();
        puerta.entrada.resolver();
        await puerta.salida.promesa;
        return Object.freeze({
          estado: E.ACEPTADO,
          clasificacion: C.ACEPTACION_DEMOSTRADA,
          codigo: 'smtp_aceptado',
          respuestaSaneada: '250 mensaje aceptado'
        });
      }
    };
    const dependenciasDespacho = {
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
            reintentoBaseSegundos: 60,
            smtpTimeoutConexionMs: 1,
            smtpTimeoutSaludoMs: 1,
            smtpTimeoutSocketMs: 1,
            remitenteEmail: 'portal@example.test',
            remitenteNombre: 'Sentinelia'
          }
        })
      },
      clienteSmtp: smtp,
      leaseMilisegundos: 120_000,
      margenConsolidacionMs: 0
    };
    const runtimeUno = new DespachadorCorreoSql({
      ...dependenciasDespacho, identificadorInstancia: 'runtime-530b6b-uno',
      ahora: () => new Date(aceptadaEnUtc)
    });
    const runtimeDos = new DespachadorCorreoSql({
      ...dependenciasDespacho, identificadorInstancia: 'runtime-530b6b-dos'
    });
    const pendiente = await operaciones.obtenerOperacionActual(81);
    assert.equal(pendiente.estado, 'pendiente_aceptacion_smtp');
    const token = operaciones.recuperarTokenOperacion(pendiente.operacion);
    assert.equal((await operaciones.diagnosticarTokenOhuella(token)).estado,
      'pendiente_aceptacion_smtp');
    const aceptadaEnUtc = new Date().toISOString();
    const puertaInicial = puertasSmtp[0];
    const despachoUno = runtimeUno.despacharSiguiente();
    await puertaInicial.entrada.promesa;
    const despachoDos = await runtimeDos.despacharSiguiente();
    puertaInicial.salida.resolver();
    const resultadoUno = await despachoUno;
    assert.equal(resultadoUno.estadoSalida, 'enviado');
    assert.equal(despachoDos.motivo, 'sin_salidas_reclamables');
    assert.equal(enviosSmtp, 1);
    assert.equal(await contar(sql,
      "origen_tipo='verificacion_email_perfil' AND estado='enviado'"), 1);
    assert.equal(await contarTabla(sql, 'intentos_correos_salida'), 1);
    assert.equal(await contarTabla(sql, 'reclamaciones_correos_salida'), 1);
    const activa = await operaciones.obtenerOperacionActual(81);
    assert.equal(activa.estado, 'activa');
    assert.equal(Date.parse(activa.operacion.expiraEn) - Date.parse(aceptadaEnUtc),
      15 * 60 * 1000);

    const servicioCambio = new ServicioCambioEmailPerfil({
      repositorioUsuarios: usuarios,
      repositorioOperacionesEmail: operaciones,
      servicioEmailPerfil: comunes.servicioEmailPerfil,
      servicioAutorizacionPerfil: { exigirAutorizacion: async () => {} },
      servicioCorreoPortal: comunes.servicioCorreoPortal,
      servicioConfiguracionPortal: comunes.servicioConfiguracionPortal,
      coordinadorEmisionEmailPerfil: {
        encolarInicial: (...args) => webDos.encolarInicial(...args),
        encolarReenvio: async () => { throw new Error('fuera_de_escenario'); }
      }
    });
    const enlace = await servicioCambio.registrarEnlace(token);
    await assert.rejects(servicioCambio.obtenerConfirmacion({
      huellaToken: enlace.huellaToken,
      contextoUsuarioActual: { idUsuario: 82, idUsuarioReal: 82 }
    }), (error) => error?.codigo === 'token_email_otro_propietario');
    const contextoPropio = { idUsuario: 81, idUsuarioReal: 81,
      impersonacionActiva: false };
    assert.equal((await servicioCambio.obtenerConfirmacion({
      huellaToken: enlace.huellaToken,
      contextoUsuarioActual: contextoPropio
    })).emailCandidato, 'candidato-81@example.test');
    assert.equal((await servicioCambio.confirmar({
      huellaToken: enlace.huellaToken,
      contextoUsuarioActual: contextoPropio
    })).codigo, 'email_validado');

    await webDos.encolarInicial({
      idUsuario: '82', emailCandidato: 'candidato-82@example.test'
    });
    const operacion82 = await operaciones.obtenerOperacionActual(82);
    const token82 = operaciones.recuperarTokenOperacion(operacion82.operacion);
    const puertaExpiracion = puertasSmtp[0];
    const despachoExpiradoDurante = runtimeUno.despacharSiguiente();
    await puertaExpiracion.entrada.promesa;
    await redis.del([
      operaciones.claveIndice(82),
      operaciones.claveOperacion(operacion82.operacion.idOperacion),
      operaciones.claveToken(operacion82.operacion.huellaToken)
    ]);
    puertaExpiracion.salida.resolver();
    const cierreExpiradoDurante = await despachoExpiradoDurante;
    assert.equal(cierreExpiradoDurante.estadoSalida, 'enviado');
    assert.equal(cierreExpiradoDurante.convergenciaPostcommit, undefined);
    assert.equal((await operaciones.diagnosticarTokenOhuella(token82)).estado,
      'invalida');

    await webDos.encolarInicial({
      idUsuario: '83', emailCandidato: 'candidato-83@example.test'
    });
    const operacion83 = await operaciones.obtenerOperacionActual(83);
    const token83 = operaciones.recuperarTokenOperacion(operacion83.operacion);
    const puertaSustitucion = puertasSmtp[0];
    const despachoSustituidoDurante = runtimeUno.despacharSiguiente();
    await puertaSustitucion.entrada.promesa;
    await webDos.encolarInicial({
      idUsuario: '83', emailCandidato: 'sustituto-83@example.test'
    });
    puertaSustitucion.salida.resolver();
    assert.equal((await despachoSustituidoDurante).estadoSalida, 'enviado');
    assert.equal((await operaciones.diagnosticarTokenOhuella(token83)).estado,
      'sustituida');
    assert.equal(enviosSmtp, 3);

    console.log(
      '[usuarios] OK 5.30b.6b: migraciones=vacía+actualizada ' +
      'web=dos_instancias_un_productor runtime=dos_instancias_un_smtp ' +
      'token=aceptacion_mas_15m confirmacion=propia_no_ajena ' +
      'expiracion_durante=sin_autoridad sustitucion_durante=enlace_extinto ' +
      'rutas_publicas=capacidad_publicada'
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

function verificarCapacidadPublicada() {
  const raiz = join(dirname(fileURLToPath(import.meta.url)), '..');
  const composicionWeb = readFileSync(join(
    raiz, 'apps/sentinelia-web/src/index.js'
  ), 'utf8');
  assert.match(composicionWeb, /ServicioEmisionInicialEmailPerfilCoordinada/u);
  assert.match(composicionWeb, /coordinadorEmisionEmailPerfil/u);
}

async function contar(sql, condicion) {
  const [fila] = await sql.consultar(
    `SELECT COUNT(*) total FROM cola_correos_salida WHERE ${condicion}`
  );
  return Number(fila.total);
}

async function contarTabla(sql, tabla) {
  const [fila] = await sql.consultar(`SELECT COUNT(*) total FROM ${tabla}`);
  return Number(fila.total);
}

function diferido() {
  let resolver;
  const promesa = new Promise((resuelve) => { resolver = resuelve; });
  return { promesa, resolver };
}

function crearPuertaSmtp() {
  return { entrada: diferido(), salida: diferido() };
}

async function limpiarPrefijo(redis, prefijo) {
  const claves = [];
  for await (const clave of redis.scanIterator({ MATCH: `${prefijo}*`, COUNT: 100 })) {
    claves.push(clave);
  }
  if (claves.length > 0) await redis.del(claves);
}

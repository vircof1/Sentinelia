import assert from 'node:assert/strict';
import { createHash, randomBytes } from 'node:crypto';

import { DespachadorCorreoSql } from '../paquetes/correo/src/DespachadorCorreoSql.js';
import { RepositorioAuditoria } from '../paquetes/auditoria/src/RepositorioAuditoria.js';
import { RepositorioCoordinacionCorreoRecuperacionPasswordSql }
  from '../paquetes/correo/src/RepositorioCoordinacionCorreoRecuperacionPasswordSql.js';
import { RepositorioColaCorreo }
  from '../paquetes/correo/src/RepositorioColaCorreo.js';
import { generarUuidV7Auditoria }
  from '../paquetes/auditoria/src/UuidV7Auditoria.js';
import { construirIntencionAuditoriaEmisionRecuperacionPassword }
  from '../paquetes/usuarios/src/EventosAuditoriaRecuperacionPassword.js';
import { FronteraTransaccionalLocal }
  from '../paquetes/persistencia-sql/src/FronteraTransaccionalLocal.js';
import { ClienteSql } from '../paquetes/persistencia-sql/src/ClienteSql.js';
import { EjecutorMigraciones } from '../paquetes/persistencia-sql/src/EjecutorMigraciones.js';
import { RepositorioMigraciones }
  from '../paquetes/persistencia-sql/src/RepositorioMigraciones.js';
import {
  obtenerConfiguracionAplicacion,
  obtenerRutaMigraciones
} from '../paquetes/utilidades/src/configuracion/obtenerConfiguracionAplicacion.js';

async function main() {
  const configuracion = obtenerConfiguracionAplicacion();
  assert.equal(configuracion.sql.estaCompleta, true, '5.30.3d necesita MariaDB real.');
  const administrador = new ClienteSql(configuracion.sql);
  const nombre = `sentinelia_fixture_5303d_${randomBytes(5).toString('hex')}`;
  let sql;
  try {
    await administrador.ejecutar(
      `CREATE DATABASE ${administrador.escaparIdentificador(nombre)} ` +
      'CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci'
    );
    sql = new ClienteSql({ ...configuracion.sql, baseDatos: nombre });
    await new EjecutorMigraciones({
      clienteSql: sql,
      repositorioMigraciones: new RepositorioMigraciones(sql),
      rutaMigraciones: obtenerRutaMigraciones()
    }).ejecutarPendientes();
    const frontera = new FronteraTransaccionalLocal(sql);
    const cola = new RepositorioColaCorreo(sql);
    const recuperacion =
      new RepositorioCoordinacionCorreoRecuperacionPasswordSql(sql, {
        repositorioAuditoria: new RepositorioAuditoria(sql)
      });
    const smtp = new SmtpFixture();
    const despachador = new DespachadorCorreoSql({
      fronteraTransaccional: frontera,
      repositorioColaCorreo: cola,
      repositorioRecuperacionPassword: recuperacion,
      evaluadorAutoridadCorreoSql: new AutoridadCorreoFixture(),
      clienteSmtp: smtp,
      identificadorInstancia: 'fixture-5.30.3d',
      leaseMilisegundos: 120_000,
      margenConsolidacionMs: 1_000
    });

    const usuarioValido = await crearUsuario(sql, 'valido', 'destino@example.test');
    await crearSalida({ frontera, recuperacion, usuariosIds: [usuarioValido] });
    const enviada = await despachador.despacharSiguiente();
    assert.equal(enviada.despachado, true);
    assert.equal(enviada.estadoSalida, 'enviado');
    assert.equal(smtp.intentos.length, 1);

    const usuarioRetirado = await crearUsuario(sql, 'retirado', 'retirado@example.test');
    await crearSalida({
      frontera,
      recuperacion,
      usuariosIds: [usuarioRetirado],
      buzon: 'retirado@example.test'
    });
    await sql.ejecutar('UPDATE usuarios SET activo=0 WHERE id=?', [usuarioRetirado]);
    const descartada = await despachador.despacharSiguiente();
    assert.equal(descartada.despachado, false);
    assert.equal(descartada.estadoSalida, 'descartada');
    assert.equal(descartada.motivo, 'autoridad_buzon_retirada');
    assert.equal(smtp.intentos.length, 1, 'El descarte no puede abrir SMTP.');

    await verificarUnaIdentidadOriginalSuficiente({ sql, frontera, cola, recuperacion });
    await verificarFronteraYaCruzada({ sql, frontera, cola, recuperacion });
    await verificarMutacionesRetiran({ sql, frontera, cola, recuperacion });
    assert.equal(await frontera.ejecutar((conexion) =>
      cola.reclamarSiguienteTrigger({
        propietarioClaim: 'trigger-aislado-5303d',
        leaseMilisegundos: 30_000
      }, { conexion })
    ), null);
    console.log(
      '[usuarios] OK 5.30.3d: dispatcher=por_procedencia ' +
      'revalidacion=identidades_originales email+validacion+actividad ' +
      'sin_autoridad=descartada_sin_smtp frontera_enviando=irreversible ' +
      'claims=aislados clasificacion=compartida'
    );
  } finally {
    await sql?.cerrar().catch(() => {});
    await administrador.ejecutar(
      `DROP DATABASE IF EXISTS ${administrador.escaparIdentificador(nombre)}`
    ).catch(() => {});
    await administrador.cerrar();
  }
}

async function verificarUnaIdentidadOriginalSuficiente({
  sql, frontera, cola, recuperacion
}) {
  const buzon = 'compartido@example.test';
  const retirada = await crearUsuario(sql, 'compartido-retirado', buzon);
  const valida = await crearUsuario(sql, 'compartido-valido', buzon);
  await sql.ejecutar('UPDATE usuarios SET email_validado=0 WHERE id=?', [retirada]);
  await crearSalida({
    frontera,
    recuperacion,
    usuariosIds: [retirada, valida],
    buzon
  });
  const reclamacion = await reclamarRecuperacion(frontera, cola, 'multi-5303d');
  const inicio = await iniciar(frontera, recuperacion, reclamacion);
  assert.equal(inicio.iniciado, true);
  await finalizarAceptado(frontera, cola, reclamacion, inicio);
}

async function verificarFronteraYaCruzada({ sql, frontera, cola, recuperacion }) {
  const buzon = 'frontera@example.test';
  const usuarioId = await crearUsuario(sql, 'frontera', buzon);
  await crearSalida({ frontera, recuperacion, usuariosIds: [usuarioId], buzon });
  const reclamacion = await reclamarRecuperacion(frontera, cola, 'frontera-5303d');
  const inicio = await iniciar(frontera, recuperacion, reclamacion);
  assert.equal(inicio.iniciado, true);
  await sql.ejecutar(
    `UPDATE usuarios SET email='otro@example.test',email_validado=0 WHERE id=?`,
    [usuarioId]
  );
  const cierre = await finalizarAceptado(frontera, cola, reclamacion, inicio);
  assert.equal(cierre.estadoSalida, 'enviado');
}

async function verificarMutacionesRetiran({ sql, frontera, cola, recuperacion }) {
  for (const [sufijo, mutacion] of [
    ['email', "email='cambiado@example.test'"],
    ['validacion', 'email_validado=0'],
    ['actividad', 'activo=0']
  ]) {
    const buzon = `${sufijo}@example.test`;
    const usuarioId = await crearUsuario(sql, `mutacion-${sufijo}`, buzon);
    await crearSalida({ frontera, recuperacion, usuariosIds: [usuarioId], buzon });
    const reclamacion = await reclamarRecuperacion(
      frontera, cola, `mutacion-${sufijo}-5303d`
    );
    await sql.ejecutar(`UPDATE usuarios SET ${mutacion} WHERE id=?`, [usuarioId]);
    const inicio = await iniciar(frontera, recuperacion, reclamacion);
    assert.equal(inicio.iniciado, false);
    assert.equal(inicio.estadoSalida, 'descartada');
  }
}

async function crearSalida({
  frontera,
  recuperacion,
  usuariosIds,
  buzon = 'destino@example.test'
}) {
  const solicitudId = generarUuidV7Auditoria();
  if (usuariosIds.length > 1) {
    const eventoEmisionId = generarUuidV7Auditoria();
    const creadaEnUtc = new Date().toISOString();
    const preparacion = await frontera.ejecutar((conexion) =>
      recuperacion.crearSalidaPreparadaEnTransaccion({
        solicitudId,
        eventoEmisionId,
        claveOperacionSha256: sha(`operacion:${solicitudId}`),
        direccionIpOrigen: '203.0.113.31',
        materialPreparacion: {
          perfil: 'recuperacion_password@1/preparacion_correo',
          token: randomBytes(32).toString('base64url')
        },
        buzonCanonico: buzon,
        claveBuzonSha256: sha(buzon),
        smtpMessageId: `<${sha(`mensaje:${solicitudId}`)}@correo.sentinelia>`,
        asunto: 'Recuperación de contraseña',
        usuariosJustificantesIds: usuariosIds.map(String),
        creadaEnUtc
      }, { conexion })
    );
    return frontera.ejecutar((conexion) =>
      recuperacion.completarSalidaPreparadaEnTransaccion({
        salidaId: preparacion.salida.id,
        solicitudId,
        eventoEmisionId,
        cuerpoTexto: 'Abre el enlace temporal para recuperar tu contraseña.',
        intencionAuditoria: construirIntencionAuditoriaEmisionRecuperacionPassword({
          solicitudId,
          eventoEmisionId,
          eventoConsumoId: generarUuidV7Auditoria(),
          efectivoEnUtc: creadaEnUtc,
          buzonCanonico: buzon,
          direccionIp: '203.0.113.31'
        })
      }, { conexion })
    );
  }
  return frontera.ejecutar((conexion) =>
    recuperacion.crearNotificacionSeguridadEnTransaccion({
      solicitudId,
      claveOperacionSha256: sha(`operacion:${solicitudId}`),
      buzonCanonico: buzon,
      claveBuzonSha256: sha(buzon),
      smtpMessageId: `<${sha(`mensaje:${solicitudId}`)}@correo.sentinelia>`,
      asunto: 'Notificación de seguridad',
      cuerpoTexto: 'La contraseña asociada a esta cuenta ha cambiado.',
      usuariosJustificantesIds: usuariosIds.map(String),
      creadaEnUtc: new Date().toISOString()
    }, { conexion })
  );
}

async function reclamarRecuperacion(frontera, cola, propietarioClaim) {
  const reclamacion = await frontera.ejecutar((conexion) =>
    cola.reclamarSiguienteSql({
      propietarioClaim,
      leaseMilisegundos: 120_000,
      origenesTipo: ['recuperacion_password']
    }, { conexion })
  );
  assert.ok(reclamacion);
  assert.equal(reclamacion.salida.origenTipo, 'recuperacion_password');
  return reclamacion;
}

function iniciar(frontera, recuperacion, reclamacion) {
  return frontera.ejecutar((conexion) =>
    recuperacion.iniciarIntentoEnTransaccion({
      ...identidad(reclamacion),
      configuracionVersion: '1',
      maxReintentos: 2,
      margenMinimoLeaseMs: 1_000
    }, { conexion })
  );
}

function finalizarAceptado(frontera, cola, reclamacion, inicio) {
  return frontera.ejecutar((conexion) => cola.finalizarIntentoSql({
    ...identidad(reclamacion),
    intentoId: inicio.intento.intentoId,
    resultadoIntento: resultadoAceptado(),
    reintentoBaseSegundos: 1
  }, { conexion }));
}

async function crearUsuario(sql, sufijo, email) {
  const [resultado] = await sql.ejecutar(
    `INSERT INTO usuarios (usuario,email,hash_password,activo,email_validado)
     VALUES (?,?,?,1,1)`,
    [`fixture-5303d-${sufijo}-${randomBytes(3).toString('hex')}`, email, 'hash']
  );
  return String(resultado.insertId);
}

function identidad(reclamacion) {
  return {
    reclamacionId: reclamacion.reclamacionId,
    salidaId: String(reclamacion.salida.id),
    claimId: reclamacion.claimId,
    leaseToken: reclamacion.leaseToken,
    propietarioClaim: reclamacion.propietarioClaim,
    fencingToken: reclamacion.fencingToken
  };
}

function resultadoAceptado() {
  return {
    estado: 'aceptado',
    clasificacion: 'aceptacion_demostrada',
    codigo: 'smtp_aceptado',
    respuestaSaneada: '250 accepted'
  };
}

class AutoridadCorreoFixture {
  async evaluarEnTransaccion() {
    return {
      puedeDespachar: true,
      codigo: 'correo_smtp_verificado',
      versionConfiguracion: '1',
      remitenteEmailCanonico: 'sender@example.test',
      configuracion: {
        activo: true,
        remitenteEmail: 'sender@example.test',
        remitenteNombre: 'Sentinelia',
        smtpTimeoutConexionMs: 1_000,
        smtpTimeoutSaludoMs: 1_000,
        smtpTimeoutSocketMs: 1_000,
        maxReintentos: 2,
        reintentoBaseSegundos: 1
      }
    };
  }
}

class SmtpFixture {
  constructor() { this.intentos = []; }
  async enviarIntentoTrigger() {
    throw new Error('El dispatcher común no debe degradar al contrato trigger.');
  }
  async enviarIntentoSql(_configuracion, salida, { origenEsperado }) {
    assert.equal(origenEsperado, 'recuperacion_password');
    assert.equal(salida.origenTipo, origenEsperado);
    this.intentos.push(String(salida.id));
    return resultadoAceptado();
  }
}

function sha(valor) {
  return createHash('sha256').update(valor, 'utf8').digest('hex');
}

await main();

import assert from 'node:assert/strict';
import { createHash, randomBytes } from 'node:crypto';

import { generarUuidV7Auditoria }
  from '../paquetes/auditoria/src/UuidV7Auditoria.js';
import { ClienteSmtp } from '../paquetes/correo/src/ClienteSmtp.js';
import { crearMensajeReinicioPasswordAdministrativo }
  from '../paquetes/correo/src/CodecMensajeReinicioPasswordAdministrativo.js';
import { DespachadorCorreoSql }
  from '../paquetes/correo/src/DespachadorCorreoSql.js';
import { RepositorioColaCorreo }
  from '../paquetes/correo/src/RepositorioColaCorreo.js';
import { RepositorioCoordinacionCorreoReinicioPasswordAdministrativoSql }
  from '../paquetes/correo/src/RepositorioCoordinacionCorreoReinicioPasswordAdministrativoSql.js';
import { RepositorioCoordinacionCorreoRecuperacionPasswordSql }
  from '../paquetes/correo/src/RepositorioCoordinacionCorreoRecuperacionPasswordSql.js';
import { ClienteSql } from '../paquetes/persistencia-sql/src/ClienteSql.js';
import { EjecutorMigraciones } from '../paquetes/persistencia-sql/src/EjecutorMigraciones.js';
import { FronteraTransaccionalLocal }
  from '../paquetes/persistencia-sql/src/FronteraTransaccionalLocal.js';
import { RepositorioMigraciones }
  from '../paquetes/persistencia-sql/src/RepositorioMigraciones.js';
import { VIAS_REINICIO_PASSWORD_ADMINISTRATIVO }
  from '../paquetes/usuarios/src/ContratoReinicioPasswordAdministrativo.js';
import { RepositorioReiniciosPasswordAdministrativosSql }
  from '../paquetes/usuarios/src/RepositorioReiniciosPasswordAdministrativosSql.js';
import {
  obtenerConfiguracionAplicacion,
  obtenerRutaMigraciones
} from '../paquetes/utilidades/src/configuracion/obtenerConfiguracionAplicacion.js';

async function main() {
  const configuracion = obtenerConfiguracionAplicacion();
  assert.equal(configuracion.sql.estaCompleta, true, '5.30a.3d necesita MariaDB real.');
  const administrador = new ClienteSql(configuracion.sql);
  const base = `sentinelia_fixture_530a3d_${randomBytes(5).toString('hex')}`;
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
         id,usuario,email,hash_password,activo,email_validado
       ) VALUES (1,'operador-530a3d','operador@example.test','hash',1,1)`
    );
    const frontera = new FronteraTransaccionalLocal(sql);
    const cola = new RepositorioColaCorreo(sql);
    const operaciones = new RepositorioReiniciosPasswordAdministrativosSql(sql);
    const administrativo =
      new RepositorioCoordinacionCorreoReinicioPasswordAdministrativoSql(sql);
    const recuperacion =
      new RepositorioCoordinacionCorreoRecuperacionPasswordSql(sql);
    const smtp = new SmtpControlado();
    const despachador = new DespachadorCorreoSql({
      fronteraTransaccional: frontera,
      repositorioColaCorreo: cola,
      repositorioRecuperacionPassword: recuperacion,
      repositorioReinicioPasswordAdministrativo: administrativo,
      evaluadorAutoridadCorreoSql: new AutoridadCorreoFixture(),
      clienteSmtp: new ClienteSmtp({ fabricaTransport: () => smtp }),
      identificadorInstancia: 'fixture-5.30a.3d',
      leaseMilisegundos: 120_000,
      margenConsolidacionMs: 1_000
    });

    const aceptada = await crearSalida({ frontera, operaciones, administrativo });
    smtp.prepararAceptacion(aceptada.passwordProvisional, aceptada.buzonCanonico);
    const resultadoAceptado = await despachador.despacharSiguiente();
    assert.equal(resultadoAceptado.despachado, true);
    assert.equal(resultadoAceptado.estadoSalida, 'enviado');
    assert.equal(smtp.mensajes[0].text, aceptada.mensaje.cuerpoTexto);
    assert.equal(smtp.mensajes[0].to[0].name, 'Persona objetivo');
    await exigirSecretoAusente(sql, aceptada.salidaId, aceptada.passwordProvisional);

    const fallida = await crearSalida({ frontera, operaciones, administrativo });
    smtp.prepararFalloTemporal(fallida.passwordProvisional);
    const resultadoFallido = await despachador.despacharSiguiente();
    assert.equal(resultadoFallido.despachado, false);
    assert.equal(resultadoFallido.estadoSalida, 'error_reintentable');
    assert.equal(resultadoFallido.codigo, 'smtp_fallo_temporal');
    assert.doesNotMatch(JSON.stringify(resultadoFallido),
      new RegExp(fallida.passwordProvisional, 'u'));
    await exigirSecretoAusente(sql, fallida.salidaId, fallida.passwordProvisional);

    console.log(
      '[usuarios] OK 5.30a.3d: dispatcher=registro_explicito origen=administrativo ' +
      'smtp=aceptado_y_reintentable secreto=solo_transporte_saneado ' +
      'evidencia_error_logs=sin_password destinatario=fotografiado runtime=compuesto'
    );
  } finally {
    await sql?.cerrar().catch(() => {});
    await administrador.ejecutar(
      `DROP DATABASE IF EXISTS ${administrador.escaparIdentificador(base)}`
    ).catch(() => {});
    await administrador.cerrar();
  }
}

async function crearSalida({ frontera, operaciones, administrativo }) {
  const reinicioId = generarUuidV7Auditoria();
  const passwordProvisional = randomBytes(24).toString('base64url').slice(0, 24);
  const aplicadaEnUtc = new Date().toISOString();
  const mensaje = crearMensajeReinicioPasswordAdministrativo({
    nombrePortal: 'Sentinelia fixture',
    passwordProvisional,
    aplicadoEnUtc: aplicadaEnUtc
  });
  const buzonCanonico = `destino-${randomBytes(5).toString('hex')}@example.test`;
  const salida = await frontera.ejecutar(async (conexion) => {
    await operaciones.reservarEnTransaccion({
      reinicioId,
      usuarioId: String(100 + randomBytes(1)[0]),
      via: VIAS_REINICIO_PASSWORD_ADMINISTRATIVO.CORREO
    }, { conexion });
    const creada = await administrativo.crearSalidaEnTransaccion({
      reinicioId,
      buzonCanonico,
      destinatarioNombre: 'Persona objetivo',
      claveBuzonSha256: sha(buzonCanonico),
      smtpMessageId: `<${reinicioId}@correo.sentinelia>`,
      asunto: mensaje.asunto,
      cuerpoTexto: mensaje.cuerpoTexto,
      creadoPorUsuarioId: '1',
      creadaEnUtc: aplicadaEnUtc
    }, { conexion });
    await operaciones.confirmarEnTransaccion({
      reinicioId,
      eventoAuditoriaId: generarUuidV7Auditoria(),
      salidaCorreoId: String(creada.salida.id),
      versionSesionResultante: '2',
      generacionRecuperacionResultante: '2'
    }, { conexion });
    return creada.salida;
  });
  return {
    reinicioId,
    salidaId: String(salida.id),
    buzonCanonico,
    passwordProvisional,
    mensaje
  };
}

async function exigirSecretoAusente(sql, salidaId, secreto) {
  const salida = (await sql.consultar(
    `SELECT error_ultimo,respuesta_saneada,codigo_resultado
       FROM cola_correos_salida WHERE id=?`,
    [salidaId]
  ))[0];
  const intentos = await sql.consultar(
    `SELECT respuesta_saneada,codigo FROM intentos_correos_salida
      WHERE salida_correo_id=?`,
    [salidaId]
  );
  const diagnostico = JSON.stringify({ salida, intentos });
  assert.doesNotMatch(diagnostico, new RegExp(secreto, 'u'));
  assert.match(diagnostico, /\[redactado\]/u);
}

class AutoridadCorreoFixture {
  async evaluarEnTransaccion() {
    return {
      puedeDespachar: true,
      codigo: 'correo_operativo',
      versionConfiguracion: '17',
      remitenteEmailCanonico: 'smtp@example.test',
      configuracion: {
        smtpHost: 'smtp.example.test',
        smtpPuerto: 587,
        smtpSecure: false,
        smtpUsuario: 'usuario-smtp',
        smtpPassword: 'secreto-smtp',
        smtpAuthMethod: '',
        smtpTimeoutConexionMs: 1_000,
        smtpTimeoutSaludoMs: 1_000,
        smtpTimeoutSocketMs: 1_000,
        smtpTlsPermitirInseguro: false,
        remitenteEmail: 'smtp@example.test',
        remitenteNombre: 'Sentinelia',
        maxReintentos: 2,
        reintentoBaseSegundos: 1
      }
    };
  }
}

class SmtpControlado {
  constructor() {
    this.comportamientos = [];
    this.mensajes = [];
  }

  prepararAceptacion(secreto, buzon) {
    this.comportamientos.push({ tipo: 'aceptar', secreto, buzon });
  }

  prepararFalloTemporal(secreto) {
    this.comportamientos.push({ tipo: 'fallar', secreto });
  }

  async sendMail(mensaje) {
    const comportamiento = this.comportamientos.shift();
    assert.ok(comportamiento, 'El fixture SMTP recibió un intento no previsto.');
    this.mensajes.push(mensaje);
    if (comportamiento.tipo === 'fallar') {
      const error = new Error(`Fallo que refleja ${comportamiento.secreto}`);
      error.response = `421 temporal ${comportamiento.secreto}`;
      error.responseCode = 421;
      error.command = 'CONNECT';
      throw error;
    }
    return {
      accepted: [comportamiento.buzon],
      rejected: [],
      response: `250 accepted ${comportamiento.secreto}`,
      messageId: mensaje.messageId
    };
  }

  close() {}
}

function sha(valor) {
  return createHash('sha256').update(valor, 'utf8').digest('hex');
}

await main();

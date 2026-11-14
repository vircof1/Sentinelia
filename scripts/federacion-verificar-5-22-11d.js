import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import { RepositorioAuditoria } from '../paquetes/auditoria/src/RepositorioAuditoria.js';
import { generarUuidV7Auditoria } from '../paquetes/auditoria/src/UuidV7Auditoria.js';
import { AdaptadorAuditoriaCanjeFederacion } from '../paquetes/federacion/adaptadores/AdaptadorAuditoriaCanjeFederacion.js';
import { AdaptadorAuditoriaControlFederacion } from '../paquetes/federacion/adaptadores/AdaptadorAuditoriaControlFederacion.js';
import { GeneradorCredencialInvitacionFederacion } from '../paquetes/federacion/adaptadores/GeneradorCredencialInvitacionFederacion.js';
import { GeneradorSecretoPersistenteFederacion } from '../paquetes/federacion/adaptadores/GeneradorSecretoPersistenteFederacion.js';
import { KeyringFederacionDespliegue } from '../paquetes/federacion/adaptadores/KeyringFederacionDespliegue.js';
import {
  ProtectorSecretoPersistenteFederacion,
  SecretoPersistenteFederacionNoRecuperable,
  VerificadorSecretoPersistenteFederacion,
  crearContextoSecretoPersistenteFederacion
} from '../paquetes/federacion/adaptadores/ProtectorSecretoPersistenteFederacion.js';
import {
  PersistidorVerificadorCanjeFederacion,
  RepositorioCredencialesPersistentesFederacionSql
} from '../paquetes/federacion/adaptadores/RepositorioCredencialesPersistentesFederacionSql.js';
import { RepositorioInvitacionesFederacionSql } from '../paquetes/federacion/adaptadores/RepositorioInvitacionesFederacionSql.js';
import { ServicioCanjeInvitacionFederacion } from '../paquetes/federacion/aplicacion/ServicioCanjeInvitacionFederacion.js';
import { ServicioCustodiaSecretoEmisionFederacion } from '../paquetes/federacion/aplicacion/ServicioCustodiaSecretoEmisionFederacion.js';
import { ServicioInvitacionesFederacion } from '../paquetes/federacion/aplicacion/ServicioInvitacionesFederacion.js';
import { ClienteSql } from '../paquetes/persistencia-sql/src/ClienteSql.js';
import { EjecutorMigraciones } from '../paquetes/persistencia-sql/src/EjecutorMigraciones.js';
import { RepositorioMigraciones } from '../paquetes/persistencia-sql/src/RepositorioMigraciones.js';
import {
  obtenerConfiguracionAplicacion,
  obtenerRutaMigraciones
} from '../paquetes/utilidades/src/configuracion/obtenerConfiguracionAplicacion.js';

const RELACION_RECEPCION = `sfid1.relacion.${'V'.repeat(21)}A`;
const RELACION_EMISION = `sfid1.relacion.${'W'.repeat(21)}Q`;
const INSTALACION_RECEPTORA = `sfid1.instalacion.${'X'.repeat(21)}g`;
const INSTALACION_EMISORA = `sfid1.instalacion.${'Y'.repeat(21)}w`;
const BOOT_EMISOR = `sfid1.arranque.${'Z'.repeat(21)}A`;
const USUARIO = 913;
const ORIGEN = 'https://receptor-11d.example';
const REFERENCIA_KEYRING = 'sentinelia/federacion/fixture-11d';
const ACTOR = Object.freeze({
  real: Object.freeze({ tipo: 'usuario', id: String(USUARIO) }),
  efectivo: null,
  modo: 'directo'
});

async function main() {
  await verificarRegistro();
  const configuracion = obtenerConfiguracionAplicacion();
  assert.equal(configuracion.sql.estaCompleta, true, '5.22.11d requiere SQL local.');
  const sql = new ClienteSql(configuracion.sql);
  try {
    await migrar(sql);
    await limpiar(sql);
    await crearFixture(sql);
    await verificarCustodiaEmisora(sql);
    await verificarCanjeConVerificadorReceptor(sql);
  } finally {
    await limpiar(sql);
    await sql.cerrar();
  }
  console.log(
    '[federacion] OK 5.22.11d: emisor=aes-256-gcm receptor=verificador_saltado ' +
    'aad=relacion_e_identidades rotacion_keyring=compatible secretos=ausentes_en_superficies'
  );
}

async function verificarRegistro() {
  const [factory, controlador, openapi] = await Promise.all([
    leer('../paquetes/federacion/aplicacion/crearPlanoControlFederacionLocal.js'),
    leer('../apps/sentinelia-web/src/controladores/ControladorApiFederacion.js'),
    leer('../openapi/federacion-control.v1.yaml')
  ]);
  assert.match(factory, /ProtectorSecretoPersistenteFederacion/u);
  assert.match(factory, /custodiaSecretoEmision/u);
  assert.match(factory, /persistidorVerificadorCanje/u);
  assert.doesNotMatch(controlador, /console\.(?:log|error)[\s\S]*secreto/u);
  assert.doesNotMatch(openapi, /(?:in:\s*(?:query|path|header|cookie)[\s\S]{0,160}secretoPersistente)/u);
  const respuestaCanje = openapi.slice(openapi.indexOf('ExchangeInvitationResponse:'));
  assert.match(respuestaCanje, /x-sentinelia-backend-only: true/u);
  const soloRespuestaCanje = respuestaCanje.slice(
    0,
    respuestaCanje.indexOf('FederationLoginRequest:')
  );
  assert.doesNotMatch(
    soloRespuestaCanje,
    /secretoPersistente:[\s\S]{0,100}writeOnly:/u
  );
}

async function verificarCustodiaEmisora(sql) {
  const repositorio = new RepositorioCredencialesPersistentesFederacionSql(sql);
  const keyringInicial = crearKeyring('antigua');
  const protectorInicial = new ProtectorSecretoPersistenteFederacion({
    keyring: keyringInicial
  });
  const servicio = new ServicioCustodiaSecretoEmisionFederacion({
    repositorioCredenciales: repositorio,
    protectorSecretoPersistente: protectorInicial
  });
  assert.equal(JSON.stringify(servicio), '{}', 'La custodia no debe serializar sus puertos.');
  const secretoInicial = new GeneradorSecretoPersistenteFederacion().generar();
  const entrada = {
    relacionId: RELACION_EMISION,
    installationLocalId: INSTALACION_EMISORA,
    installationRemotaId: INSTALACION_RECEPTORA,
    secreto: secretoInicial
  };
  const metadatos = await servicio.custodiarRespuestaCanje(entrada);
  assert.equal(metadatos.tipoMaterial, 'secretoCifrado');
  assert.equal(metadatos.versionCredencial, 1);
  assert.equal(metadatos.keyId, 'antigua');
  assert.equal(JSON.stringify(metadatos).includes(secretoInicial), false);
  assert.deepEqual(
    Object.keys(await repositorio.buscarMetadatosSaneados(RELACION_EMISION)).sort(),
    [
      'actualizadaEnUtc', 'creadaEnUtc', 'installationLocalId',
      'installationRemotaId', 'keyId', 'perfil', 'relacionId',
      'tipoMaterial', 'versionCredencial'
    ].sort()
  );
  assert.equal(await servicio.obtenerParaLoginTecnico(entrada), secretoInicial);
  const [materialInicial] = await sql.consultar(
    'SELECT * FROM credenciales_persistentes_federacion WHERE relacion_id=?',
    [RELACION_EMISION]
  );
  const sobreInicial = {
    perfil: materialInicial.perfil,
    keyringReferencia: materialInicial.keyring_referencia,
    keyId: materialInicial.key_id,
    nonce: Buffer.from(materialInicial.nonce),
    ciphertext: Buffer.from(materialInicial.ciphertext),
    authTag: Buffer.from(materialInicial.auth_tag)
  };
  assert.throws(
    () => protectorInicial.descifrar({
      sobre: sobreInicial,
      aad: crearContextoSecretoPersistenteFederacion({
        relacionId: RELACION_EMISION,
        installationLocalId: INSTALACION_EMISORA,
        installationRemotaId: INSTALACION_RECEPTORA,
        versionCredencial: 2
      })
    }),
    SecretoPersistenteFederacionNoRecuperable,
    'La versión forma parte del AAD autenticado.'
  );
  const ciphertextAlterado = Buffer.from(sobreInicial.ciphertext);
  ciphertextAlterado[0] ^= 1;
  assert.throws(
    () => protectorInicial.descifrar({
      sobre: { ...sobreInicial, ciphertext: ciphertextAlterado },
      aad: crearContextoSecretoPersistenteFederacion({
        relacionId: RELACION_EMISION,
        installationLocalId: INSTALACION_EMISORA,
        installationRemotaId: INSTALACION_RECEPTORA,
        versionCredencial: 1
      })
    }),
    SecretoPersistenteFederacionNoRecuperable,
    'AES-GCM debe detectar cualquier alteración del ciphertext.'
  );

  const servicioRotado = new ServicioCustodiaSecretoEmisionFederacion({
    repositorioCredenciales: repositorio,
    protectorSecretoPersistente: new ProtectorSecretoPersistenteFederacion({
      keyring: crearKeyring('nueva')
    })
  });
  assert.equal(
    await servicioRotado.obtenerParaLoginTecnico(entrada),
    secretoInicial,
    'Conservar la clave anterior debe permitir leer material previo.'
  );
  await assert.rejects(
    () => servicioRotado.obtenerParaLoginTecnico({
      ...entrada,
      installationRemotaId: INSTALACION_EMISORA
    }),
    SecretoPersistenteFederacionNoRecuperable
  );
  const secretoNuevo = new GeneradorSecretoPersistenteFederacion().generar();
  const reemplazo = await servicioRotado.custodiarRespuestaCanje({
    ...entrada,
    secreto: secretoNuevo
  });
  assert.equal(reemplazo.versionCredencial, 2);
  assert.equal(reemplazo.keyId, 'nueva');
  assert.equal(reemplazo.creadaEnUtc, metadatos.creadaEnUtc);
  assert.equal(
    await servicioRotado.obtenerParaLoginTecnico({ ...entrada, secreto: secretoNuevo }),
    secretoNuevo
  );
  await exigirAusenciaSecretoSql(sql, RELACION_EMISION, [secretoInicial, secretoNuevo]);
}

async function verificarCanjeConVerificadorReceptor(sql) {
  const repositorioAuditoria = new RepositorioAuditoria(sql);
  const repositorioCredenciales =
    new RepositorioCredencialesPersistentesFederacionSql(sql);
  const verificadorSecretos = new VerificadorSecretoPersistenteFederacion();
  const persistidorVerificador = new PersistidorVerificadorCanjeFederacion({
    repositorioCredenciales,
    verificadorSecretos
  });
  const provisionadorCompletoFixture = {
    async registrarEnTransaccion(entrada, { conexion }) {
      const credencial = await persistidorVerificador.registrarEnTransaccion(
        entrada,
        { conexion }
      );
      await conexion.execute(
      `UPDATE relaciones_federacion
            SET estado_ciclo='pendienteConfirmacionIdentidad',
                installation_remota_candidata_id=?, installation_remota_id=NULL,
                nombre_remoto_declarado=?, estado_compatibilidad=NULL,
                revision=revision+1,
                actualizada_en_utc=?
          WHERE relacion_id=?`,
        [
          entrada.installationEmisoraId,
          entrada.nombreEmisorDeclarado,
          entrada.efectivoEnUtc,
          entrada.relacionId
        ]
      );
      return Object.freeze({
        ...credencial,
        identidadCandidataPersistida: true
      });
    }
  };
  const repositorioInvitaciones = new RepositorioInvitacionesFederacionSql(sql, {
    adaptadorAuditoria: new AdaptadorAuditoriaControlFederacion({
      repositorioAuditoria
    }),
    adaptadorAuditoriaCanje: new AdaptadorAuditoriaCanjeFederacion({
      repositorioAuditoria
    })
  });
  const invitaciones = new ServicioInvitacionesFederacion({
    repositorioInvitaciones,
    generadorCredencial: new GeneradorCredencialInvitacionFederacion(),
    resolverOrigenPublico: () => ORIGEN,
    installationReceptoraId: INSTALACION_RECEPTORA
  });
  const invitacion = await invitaciones.emitir({
    relacionId: RELACION_RECEPCION,
    ttlSegundos: 900,
    eventoId: generarUuidV7Auditoria(),
    correlacionId: generarUuidV7Auditoria(),
    actor: ACTOR
  });
  const canje = new ServicioCanjeInvitacionFederacion({
    repositorioInvitaciones,
    provisionadorCanjePendiente: provisionadorCompletoFixture,
    generadorSecretoPersistente: new GeneradorSecretoPersistenteFederacion(),
    installationReceptoraId: INSTALACION_RECEPTORA,
    resolverOrigenPublico: () => ORIGEN
  });
  const respuesta = await canje.canjear({
    invitacion: invitacion.representacionTransportable,
    installationEmisoraId: INSTALACION_EMISORA,
    bootEmisorId: BOOT_EMISOR,
    nombreEmisorDeclarado: 'Emisor protegido 11d',
    compatibilidad: { protocoloVersion: 1, productoVersion: '0.1.0' },
    solicitudCanjeId: generarUuidV7Auditoria()
  });
  const contexto = {
    relacionId: RELACION_RECEPCION,
    installationLocalId: INSTALACION_RECEPTORA,
    installationRemotaId: INSTALACION_EMISORA
  };
  assert.equal(await repositorioCredenciales.verificarSecretoReceptor({
    ...contexto,
    secreto: respuesta.secretoPersistente
  }, { verificadorSecretos }), true);
  assert.equal(await repositorioCredenciales.verificarSecretoReceptor({
    ...contexto,
    secreto: alterarSecreto(respuesta.secretoPersistente)
  }, { verificadorSecretos }), false);
  const metadatos = await repositorioCredenciales.buscarMetadatosSaneados(
    RELACION_RECEPCION
  );
  assert.equal(metadatos.tipoMaterial, 'verificador');
  assert.equal(metadatos.keyId, null);
  await exigirAusenciaSecretoSql(
    sql,
    RELACION_RECEPCION,
    [respuesta.secretoPersistente]
  );
  const auditoria = JSON.stringify(await sql.consultar(
    `SELECT * FROM eventos_auditoria
      WHERE sujeto_tipo='relacion_federada' AND sujeto_id=?`,
    [RELACION_RECEPCION]
  ));
  assert.equal(auditoria.includes(respuesta.secretoPersistente), false);
}

function crearKeyring(activa) {
  return new KeyringFederacionDespliegue({
    referencia: REFERENCIA_KEYRING,
    keyIdActiva: activa,
    keyring: {
      antigua: Buffer.alloc(32, 0x31).toString('base64'),
      nueva: Buffer.alloc(32, 0x32).toString('base64')
    }
  });
}

function alterarSecreto(secreto) {
  return `${secreto.slice(0, -1)}${secreto.endsWith('A') ? 'B' : 'A'}`;
}

async function exigirAusenciaSecretoSql(sql, relacionId, secretos) {
  const filas = await sql.consultar(
    `SELECT CAST(ciphertext AS CHAR BINARY) AS ciphertext,
            HEX(verificador_salt) AS sal, HEX(verificador_digest) AS digest
       FROM credenciales_persistentes_federacion WHERE relacion_id=?`,
    [relacionId]
  );
  const serializado = JSON.stringify(filas);
  for (const secreto of secretos) assert.equal(serializado.includes(secreto), false);
}

async function migrar(sql) {
  const ejecutor = new EjecutorMigraciones({
    clienteSql: sql,
    repositorioMigraciones: new RepositorioMigraciones(sql),
    rutaMigraciones: obtenerRutaMigraciones()
  });
  await ejecutor.ejecutarPendientes();
  assert.equal((await ejecutor.ejecutarPendientes()).pendientesAplicadas, 0);
}

async function crearFixture(sql) {
  await sql.ejecutar(
    `INSERT INTO usuarios (
       id,usuario,email,hash_password,activo,
       permiso_configurar_recepciones_federacion,
       permiso_configurar_emisiones_federacion,
       permiso_gestionar_credenciales_federacion
     ) VALUES (?, ?, ?, 'fixture-no-login', 1, 1, 1, 1)`,
    [USUARIO, `fixture-fed-${USUARIO}`, `fixture-fed-${USUARIO}@invalid.local`]
  );
  await crearRelacion(sql, RELACION_RECEPCION, 'recepcion');
  await crearRelacion(sql, RELACION_EMISION, 'emision');
}

async function crearRelacion(sql, relacionId, direccion) {
  const ahora = '2020-01-01 00:00:00.000';
  await sql.ejecutar(
    `INSERT INTO relaciones_federacion (
       relacion_id,direccion,estado_ciclo,estado_autoridad,estado_identidad,
       estado_compatibilidad,installation_remota_candidata_id,
       installation_remota_id,nombre_remoto_declarado,responsable_usuario_id,
       responsable_original_usuario_id,scope_tenant_id,scope_empresa_id,
       scope_sitio_id,version_autoridad,corte_autoridad_utc,
       creada_por_usuario_id,creada_en_utc,actualizada_en_utc,revision
     ) VALUES (
       ?,?,'pendienteVinculacion','autorizada','valida',NULL,NULL,NULL,
       NULL,?,?,NULL,NULL,NULL,1,NULL,?,?,?,1
     )`,
    [relacionId, direccion, USUARIO, USUARIO, USUARIO, ahora, ahora]
  );
}

async function limpiar(sql) {
  const relaciones = [RELACION_RECEPCION, RELACION_EMISION];
  const tablas = await sql.consultar(
    `SELECT TABLE_NAME AS nombre FROM information_schema.TABLES
      WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME IN (
        'credenciales_persistentes_federacion',
        'invitaciones_establecimiento_federacion'
      )`
  );
  const existentes = new Set(tablas.map(({ nombre }) => nombre));
  if (existentes.has('credenciales_persistentes_federacion')) {
    await sql.ejecutar(
      'DELETE FROM credenciales_persistentes_federacion WHERE relacion_id IN (?,?)',
      relaciones
    );
  }
  if (existentes.has('invitaciones_establecimiento_federacion')) {
    await sql.ejecutar(
      'DELETE FROM invitaciones_establecimiento_federacion WHERE relacion_id IN (?,?)',
      relaciones
    );
  }
  await sql.ejecutar(
    'DELETE FROM historico_estados_relaciones_federacion WHERE relacion_id IN (?,?)',
    relaciones
  );
  await sql.ejecutar(
    'DELETE FROM relaciones_federacion WHERE relacion_id IN (?,?)',
    relaciones
  );
  await sql.ejecutar('DELETE FROM usuarios WHERE id=?', [USUARIO]);
}

function leer(ruta) {
  return readFile(new URL(ruta, import.meta.url), 'utf8');
}

await main();

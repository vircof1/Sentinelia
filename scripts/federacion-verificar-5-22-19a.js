import assert from 'node:assert/strict';
import { inspect } from 'node:util';
import { randomBytes } from 'node:crypto';
import { readFile } from 'node:fs/promises';

import { generarUuidV7Auditoria } from '../paquetes/auditoria/src/UuidV7Auditoria.js';
import { AuditorKeyringFederacionSql } from '../paquetes/federacion/adaptadores/AuditorKeyringFederacionSql.js';
import { ClienteHttpDatosFederacion } from '../paquetes/federacion/adaptadores/ClienteHttpDatosFederacion.js';
import { GeneradorSecretoPersistenteFederacion } from '../paquetes/federacion/adaptadores/GeneradorSecretoPersistenteFederacion.js';
import { KeyringFederacionDespliegue } from '../paquetes/federacion/adaptadores/KeyringFederacionDespliegue.js';
import { ProtectorContenidoSensibleFederacion } from '../paquetes/federacion/adaptadores/ProtectorContenidoSensibleFederacion.js';
import { ProtectorSecretoPersistenteFederacion } from '../paquetes/federacion/adaptadores/ProtectorSecretoPersistenteFederacion.js';
import { RepositorioControlFederacionSql } from '../paquetes/federacion/adaptadores/RepositorioControlFederacionSql.js';
import { RepositorioCredencialesPersistentesFederacionSql } from '../paquetes/federacion/adaptadores/RepositorioCredencialesPersistentesFederacionSql.js';
import { ClienteSql } from '../paquetes/persistencia-sql/src/ClienteSql.js';
import { EjecutorMigraciones } from '../paquetes/persistencia-sql/src/EjecutorMigraciones.js';
import { RepositorioMigraciones } from '../paquetes/persistencia-sql/src/RepositorioMigraciones.js';
import { obtenerConfiguracionAplicacion, obtenerRutaMigraciones } from '../paquetes/utilidades/src/configuracion/obtenerConfiguracionAplicacion.js';

const RELACION = `sfid1.relacion.${'R'.repeat(21)}A`;
const LOCAL = `sfid1.instalacion.${'L'.repeat(21)}A`;
const REMOTA = `sfid1.instalacion.${'M'.repeat(21)}Q`;
const USUARIO = 919;
const REFERENCIA = 'sentinelia/federacion/fixture-19a';
const CLAVE_ANTIGUA = Buffer.alloc(32, 19).toString('base64');
const CLAVE_ACTIVA = Buffer.alloc(32, 20).toString('base64');

await verificarMemoriaCriptografica();
await verificarErroresUrlsYSuperficies();
await verificarInventarioYPurgaSql();
await verificarRegistro();
console.log('[federacion] OK 5.22.19a: keyring=inventariado rotacion=historica memoria=acotada errores=saneados urls=sin_secretos auditoria=sin_material eliminacion=fisica');

async function verificarMemoriaCriptografica() {
  const copias = [];
  const keyringRastreable = {
    referencia: REFERENCIA,
    obtenerClaveActiva() {
      const clave = Buffer.alloc(32, 21); copias.push(clave);
      return { keyId: 'activa', clave };
    },
    obtenerClavePorId() {
      const clave = Buffer.alloc(32, 21); copias.push(clave); return clave;
    }
  };
  const contexto = { relacionId: RELACION, installationLocalId: LOCAL,
    installationRemotaId: REMOTA, versionCredencial: 1 };
  const secreto = new GeneradorSecretoPersistenteFederacion({
    generarBytes: () => Buffer.alloc(48, 22)
  }).generar();
  const protector = new ProtectorSecretoPersistenteFederacion({
    keyring: keyringRastreable,
    generarNonce: () => Buffer.alloc(12, 23)
  });
  const sobre = protector.cifrar({ secreto, aad: contexto });
  assert.equal(sobre.ciphertext.includes(Buffer.from(secreto, 'ascii')), false);
  assert.equal(protector.descifrar({ sobre, aad: contexto }), secreto);
  assert.throws(() => protector.descifrar({
    sobre: { ...sobre, authTag: Buffer.alloc(16, 0xff) },
    aad: contexto
  }), (error) => error.codigo === 'SECRETO_PERSISTENTE_NO_RECUPERABLE');
  const sensible = new ProtectorContenidoSensibleFederacion({
    keyring: keyringRastreable,
    generarNonce: () => Buffer.alloc(12, 24)
  });
  const sobreSensible = sensible.cifrar({
    contenido: { apiKey: 'valor-que-no-debe-quedar-en-buffer' },
    aad: { familia: 'monitores', elemento: 'fixture' }
  });
  assert.deepEqual(sensible.descifrar({
    sobre: sobreSensible,
    aad: { familia: 'monitores', elemento: 'fixture' }
  }), { apiKey: 'valor-que-no-debe-quedar-en-buffer' });
  assert.throws(() => sensible.descifrar({
    sobre: { ...sobreSensible, authTag: Buffer.alloc(16, 0xff) },
    aad: { familia: 'monitores', elemento: 'fixture' }
  }), (error) => error.codigo === 'contenido_sensible_no_recuperable');
  assert.ok(copias.length >= 4);
  assert.ok(copias.every((clave) => clave.every((byte) => byte === 0)),
    'toda copia desechable entregada por el keyring debe borrarse al terminar');
  const [protectorPersistente, protectorContenido] = await Promise.all([
    leer('../paquetes/federacion/adaptadores/ProtectorSecretoPersistenteFederacion.js'),
    leer('../paquetes/federacion/adaptadores/ProtectorContenidoSensibleFederacion.js')
  ]);
  for (const fuente of [protectorPersistente, protectorContenido]) {
    assert.match(fuente, /const clave = materialClave(?:\.clave)?;/u);
    assert.match(fuente, /Buffer\.isBuffer\(clave\).*clave\.fill\(0\)/u);
  }
  const keyringMalformado = {
    referencia: REFERENCIA,
    obtenerClaveActiva: () => ({ keyId: 'invalida', clave: 'no-es-buffer' }),
    obtenerClavePorId: () => 'no-es-buffer'
  };
  assert.throws(
    () => new ProtectorSecretoPersistenteFederacion({ keyring: keyringMalformado })
      .cifrar({ secreto, aad: contexto }),
    /copia desechable de 256 bits/u
  );
  assert.throws(
    () => new ProtectorContenidoSensibleFederacion({ keyring: keyringMalformado })
      .cifrar({ contenido: { dato: true }, aad: { familia: 'monitores' } }),
    /copia desechable de 256 bits/u
  );
}

async function verificarErroresUrlsYSuperficies() {
  const secretoHostil = `sfr1_${'Z'.repeat(64)}`;
  let solicitud;
  const cliente = new ClienteHttpDatosFederacion({
    fetchImpl: async (url, opciones) => {
      solicitud = { url, opciones };
      return new Response(JSON.stringify({
        codigo: `ERROR_${secretoHostil}`,
        mensaje: secretoHostil
      }), { status: 401, headers: { 'content-type': 'application/problem+json' } });
    }
  });
  let error;
  try {
    await cliente.obtenerCapacidad({
      destino: { relacionId: RELACION, installationRemotaId: REMOTA,
        endpoint: 'https://remota.example' },
      token: `sfop1_${'T'.repeat(64)}`
    });
  } catch (causa) { error = causa; }
  assert.equal(error.codigo, 'respuesta_http_federada_rechazada');
  assert.equal(error.codigoRemoto, null);
  assert.equal(inspect(error).includes(secretoHostil), false);
  assert.equal(solicitud.url.includes('sfop1_'), false);
  assert.equal(solicitud.url.includes('sfr1_'), false);
  const clienteCapacidadHostil = new ClienteHttpDatosFederacion({
    fetchImpl: async () => new Response(JSON.stringify({
      codigo: 'CAPACIDAD_SUPERADA',
      capacidad: {
        capacidadTemporalOcurrencias: 1, disponible: true,
        familiasSoportadas: null, maximoBytesPorLote: 1024,
        maximoBytesPorOcurrencia: 512, maximoOcurrenciasPorLote: 1,
        versionConfiguracion: '1', versionesFamilia: null,
        secretoPersistente: secretoHostil
      }
    }), { status: 413, headers: { 'content-type': 'application/problem+json' } })
  });
  await assert.rejects(clienteCapacidadHostil.obtenerCapacidad({
    destino: { relacionId: RELACION, installationRemotaId: REMOTA,
      endpoint: 'https://remota.example' },
    token: `sfop1_${'T'.repeat(64)}`
  }), (causa) => causa.capacidad === null && !inspect(causa).includes(secretoHostil));

  const [controlador, clienteFuente, factory, openapi, auditoria] = await Promise.all([
    leer('../apps/sentinelia-web/src/controladores/ControladorApiFederacion.js'),
    leer('../paquetes/federacion/adaptadores/ClienteHttpDatosFederacion.js'),
    leer('../paquetes/federacion/aplicacion/crearPlanoControlFederacionLocal.js'),
    leer('../openapi/federacion-control.v1.yaml'),
    leer('../paquetes/federacion/adaptadores/AdaptadorAuditoriaSeguridadFederacion.js')
  ]);
  assert.doesNotMatch(controlador, /console\.(?:log|error|warn)/u);
  assert.doesNotMatch(clienteFuente, /json\?\.mensaje/u);
  assert.doesNotMatch(factory, /console\.error\(error\)/u);
  assert.doesNotMatch(openapi, /in:\s*(?:query|path|header|cookie)[\s\S]{0,100}secretoPersistente/iu);
  assert.doesNotMatch(auditoria, /payload:[\s\S]{0,300}(?:secretoPersistente|tokenOperativo|authorization)/iu);
}

async function verificarInventarioYPurgaSql() {
  const configuracion = obtenerConfiguracionAplicacion();
  assert.equal(configuracion.sql.estaCompleta, true, '5.22.19a requiere SQL local.');
  const admin = new ClienteSql(configuracion.sql);
  const baseDatos = `sentinelia_fixture_52219a_${randomBytes(6).toString('hex')}`;
  let sql;
  try {
    await admin.ejecutar(`CREATE DATABASE ${admin.escaparIdentificador(baseDatos)} CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
    sql = new ClienteSql({ ...configuracion.sql, baseDatos });
    const migrador = new EjecutorMigraciones({ clienteSql: sql,
      repositorioMigraciones: new RepositorioMigraciones(sql),
      rutaMigraciones: obtenerRutaMigraciones() });
    await migrador.ejecutarPendientes();
    await crearFixture(sql);
    const keyring = new KeyringFederacionDespliegue({ referencia: REFERENCIA,
      keyring: { antigua: CLAVE_ANTIGUA, activa: CLAVE_ACTIVA }, keyIdActiva: 'activa' });
    assert.equal(JSON.stringify(keyring).includes(CLAVE_ANTIGUA), false);
    assert.equal(inspect(keyring).includes(CLAVE_ANTIGUA), false);
    const repositorioCredenciales = new RepositorioCredencialesPersistentesFederacionSql(sql);
    await repositorioCredenciales.guardarSecretoEmisor({ relacionId: RELACION,
      installationLocalId: LOCAL, installationRemotaId: REMOTA,
      secreto: new GeneradorSecretoPersistenteFederacion().generar()
    }, { protector: new ProtectorSecretoPersistenteFederacion({ keyring: new KeyringFederacionDespliegue({
      referencia: REFERENCIA, keyring: { antigua: CLAVE_ANTIGUA }, keyIdActiva: 'antigua'
    }) }) });
    const auditor = new AuditorKeyringFederacionSql(sql);
    const inventario = await auditor.auditar({ keyring, referencia: REFERENCIA });
    assert.equal(inventario.totalSobres, 1);
    assert.deepEqual(inventario.keyIdsRequeridos, ['antigua']);
    await assert.rejects(auditor.auditar({
      keyring: new KeyringFederacionDespliegue({ referencia: REFERENCIA,
        keyring: { activa: CLAVE_ACTIVA }, keyIdActiva: 'activa' }),
      referencia: REFERENCIA
    }), (causa) => causa.codigo === 'KEYRING_CLAVE_HISTORICA_NO_DISPONIBLE');
    await assert.rejects(new AuditorKeyringFederacionSql({
      consultar: async () => [{ keyring_referencia: 'otra/referencia',
        key_id: 'antigua', total: 1 }]
    }).auditar({ keyring, referencia: REFERENCIA }),
    (causa) => causa.codigo === 'KEYRING_REFERENCIA_HISTORICA_NO_DISPONIBLE');
    const control = new RepositorioControlFederacionSql(sql, {
      adaptadorAuditoria: { async registrarEnTransaccion() { return null; } },
      servicioAvisos: { async detectar() {} }
    });
    await control.eliminarRelacion({ relacionId: RELACION, eliminadaPorUsuarioId: String(USUARIO),
      auditoria: { eventoId: generarUuidV7Auditoria(), correlacionId: generarUuidV7Auditoria(),
        actor: { real: { tipo: 'usuario', id: String(USUARIO) }, efectivo: null, modo: 'directo' } } });
    const restantes = await sql.consultar(
      'SELECT COUNT(*) AS total FROM credenciales_persistentes_federacion WHERE relacion_id=?', [RELACION]);
    assert.equal(Number(restantes[0].total), 0);
    assert.equal((await auditor.auditar({ keyring, referencia: REFERENCIA })).totalSobres, 0);
  } finally {
    await sql?.cerrar().catch(() => {});
    await admin.ejecutar(`DROP DATABASE IF EXISTS ${admin.escaparIdentificador(baseDatos)}`).catch(() => {});
    await admin.cerrar();
  }
}

async function crearFixture(sql) {
  await sql.ejecutar(`INSERT INTO usuarios (
    id,usuario,email,hash_password,activo,permiso_configurar_emisiones_federacion,
    permiso_activar_relaciones_federacion
  ) VALUES (?,? ,?,'fixture-no-login',1,1,1)`,
  [USUARIO, `fixture-19a-${USUARIO}`, `fixture-19a-${USUARIO}@invalid.local`]);
  const ahora = '2020-01-01 00:00:00.000';
  await sql.ejecutar(`INSERT INTO relaciones_federacion (
    relacion_id,direccion,estado_ciclo,estado_autoridad,estado_identidad,
    estado_compatibilidad,installation_remota_candidata_id,installation_remota_id,
    nombre_remoto_declarado,responsable_usuario_id,responsable_original_usuario_id,
    scope_tenant_id,scope_empresa_id,scope_sitio_id,version_autoridad,
    corte_autoridad_utc,creada_por_usuario_id,creada_en_utc,actualizada_en_utc,revision
  ) VALUES (?,'emision','vinculada','autorizada','valida','compatible',NULL,?,
    'Remota 19a',?,?,NULL,NULL,NULL,1,NULL,?,?,?,1)`,
  [RELACION, REMOTA, USUARIO, USUARIO, USUARIO, ahora, ahora]);
}

async function verificarRegistro() {
  const [control, factory] = await Promise.all([
    leer('../paquetes/federacion/adaptadores/RepositorioControlFederacionSql.js'),
    leer('../paquetes/federacion/aplicacion/crearPlanoControlFederacionLocal.js')
  ]);
  assert.match(control, /DELETE FROM credenciales_persistentes_federacion/u);
  assert.match(factory, /AuditorKeyringFederacionSql/u);
}

function leer(ruta) { return readFile(new URL(ruta, import.meta.url), 'utf8'); }

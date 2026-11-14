import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import { RepositorioAuditoria } from '../paquetes/auditoria/src/RepositorioAuditoria.js';
import {
  generarUuidV7Auditoria,
  uuidV7AuditoriaABytes
} from '../paquetes/auditoria/src/UuidV7Auditoria.js';
import { AdaptadorAuditoriaCanjeFederacion } from '../paquetes/federacion/adaptadores/AdaptadorAuditoriaCanjeFederacion.js';
import { AdaptadorAuditoriaControlFederacion } from '../paquetes/federacion/adaptadores/AdaptadorAuditoriaControlFederacion.js';
import { GeneradorCredencialInvitacionFederacion } from '../paquetes/federacion/adaptadores/GeneradorCredencialInvitacionFederacion.js';
import { GeneradorSecretoPersistenteFederacion } from '../paquetes/federacion/adaptadores/GeneradorSecretoPersistenteFederacion.js';
import {
  ProvisionadorCanjePendienteFederacion,
  RepositorioIdentidadesCandidatasFederacionSql
} from '../paquetes/federacion/adaptadores/RepositorioIdentidadesCandidatasFederacionSql.js';
import {
  VerificadorSecretoPersistenteFederacion
} from '../paquetes/federacion/adaptadores/ProtectorSecretoPersistenteFederacion.js';
import {
  PersistidorVerificadorCanjeFederacion,
  RepositorioCredencialesPersistentesFederacionSql
} from '../paquetes/federacion/adaptadores/RepositorioCredencialesPersistentesFederacionSql.js';
import { RepositorioInvitacionesFederacionSql } from '../paquetes/federacion/adaptadores/RepositorioInvitacionesFederacionSql.js';
import { ServicioCanjeInvitacionFederacion } from '../paquetes/federacion/aplicacion/ServicioCanjeInvitacionFederacion.js';
import { ServicioConfirmacionIdentidadFederacion } from '../paquetes/federacion/aplicacion/ServicioConfirmacionIdentidadFederacion.js';
import { ServicioInvitacionesFederacion } from '../paquetes/federacion/aplicacion/ServicioInvitacionesFederacion.js';
import { ClienteSql } from '../paquetes/persistencia-sql/src/ClienteSql.js';
import { EjecutorMigraciones } from '../paquetes/persistencia-sql/src/EjecutorMigraciones.js';
import { RepositorioMigraciones } from '../paquetes/persistencia-sql/src/RepositorioMigraciones.js';
import {
  obtenerConfiguracionAplicacion,
  obtenerRutaMigraciones
} from '../paquetes/utilidades/src/configuracion/obtenerConfiguracionAplicacion.js';

const RELACION = `sfid1.relacion.${'a'.repeat(21)}Q`;
const INSTALACION_RECEPTORA = `sfid1.instalacion.${'b'.repeat(21)}g`;
const INSTALACION_EMISORA_1 = `sfid1.instalacion.${'c'.repeat(21)}w`;
const INSTALACION_EMISORA_2 = `sfid1.instalacion.${'d'.repeat(21)}A`;
const BOOT_1 = `sfid1.arranque.${'e'.repeat(21)}Q`;
const BOOT_2 = `sfid1.arranque.${'f'.repeat(21)}g`;
const USUARIO = 914;
const ORIGEN = 'https://receptor-11e.example';
const ACTOR = Object.freeze({
  real: Object.freeze({ tipo: 'usuario', id: String(USUARIO) }),
  efectivo: null,
  modo: 'directo'
});

await main();

async function main() {
  await verificarRegistro();
  const configuracion = obtenerConfiguracionAplicacion();
  assert.equal(configuracion.sql.estaCompleta, true, '5.22.11e requiere SQL local.');
  const sql = new ClienteSql(configuracion.sql);
  try {
    await migrar(sql);
    await limpiar(sql);
    await crearFixture(sql);
    await verificarCandidaturaReemplazoYConfirmacion(sql);
  } finally {
    await limpiar(sql);
    await sql.cerrar();
  }
  console.log(
    '[federacion] OK 5.22.11e: candidatura=durable reemplazo=explicito ' +
    'confirmacion=humana_actual_auditable datos=bloqueados_hasta_autenticacion'
  );
}

async function verificarRegistro() {
  const [factory, index] = await Promise.all([
    leer('../paquetes/federacion/aplicacion/crearPlanoControlFederacionLocal.js'),
    leer('../apps/sentinelia-web/src/index.js')
  ]);
  assert.match(factory, /ServicioConfirmacionIdentidadFederacion/u);
  assert.match(factory, /adaptadorAuditoriaControl/u);
  assert.match(index, /provisionadorCanjePendiente:\s*\n?\s*planoControlFederacion\.provisionadorCanjePendiente/u);
}

async function verificarCandidaturaReemplazoYConfirmacion(sql) {
  const repositorioAuditoria = new RepositorioAuditoria(sql);
  const auditoriaControl = new AdaptadorAuditoriaControlFederacion({
    repositorioAuditoria
  });
  const repositorioCredenciales =
    new RepositorioCredencialesPersistentesFederacionSql(sql);
  const verificadorSecretos = new VerificadorSecretoPersistenteFederacion();
  const repositorioCandidaturas =
    new RepositorioIdentidadesCandidatasFederacionSql(sql, {
      adaptadorAuditoria: auditoriaControl
    });
  const repositorioInvitaciones = new RepositorioInvitacionesFederacionSql(sql, {
    adaptadorAuditoria: auditoriaControl,
    adaptadorAuditoriaCanje: new AdaptadorAuditoriaCanjeFederacion({
      repositorioAuditoria
    })
  });
  const provisionador = new ProvisionadorCanjePendienteFederacion({
    persistidorVerificador: new PersistidorVerificadorCanjeFederacion({
      repositorioCredenciales,
      verificadorSecretos
    }),
    repositorioCandidaturas
  });
  const invitaciones = new ServicioInvitacionesFederacion({
    repositorioInvitaciones,
    generadorCredencial: new GeneradorCredencialInvitacionFederacion(),
    resolverOrigenPublico: () => ORIGEN,
    installationReceptoraId: INSTALACION_RECEPTORA
  });
  const canje = new ServicioCanjeInvitacionFederacion({
    repositorioInvitaciones,
    provisionadorCanjePendiente: provisionador,
    generadorSecretoPersistente: new GeneradorSecretoPersistenteFederacion(),
    installationReceptoraId: INSTALACION_RECEPTORA,
    resolverOrigenPublico: () => ORIGEN
  });
  const confirmaciones = new ServicioConfirmacionIdentidadFederacion({
    repositorioCandidaturas
  });

  const primera = await emitirYCanjear({
    invitaciones,
    canje,
    installationEmisoraId: INSTALACION_EMISORA_1,
    bootEmisorId: BOOT_1,
    nombre: 'Emisor inicial 11e'
  });
  assert.equal(primera.respuesta.estado, 'pendienteConfirmacionIdentidad');
  assert.deepEqual(
    Object.keys(await confirmaciones.obtenerPendiente(RELACION)).sort(),
    [
      'bootRemotoCandidatoId', 'compatibilidadDeclarada',
      'installationRemotaCandidataId', 'nombreRemotoDeclarado', 'ordinal',
      'registradaEnUtc', 'relacionId'
    ].sort(),
    'La vista humana no expone credencial ni material verificador.'
  );

  const segunda = await emitirYCanjear({
    invitaciones,
    canje,
    installationEmisoraId: INSTALACION_EMISORA_2,
    bootEmisorId: BOOT_2,
    nombre: 'Emisor definitivo 11e'
  });
  assert.notEqual(segunda.respuesta.secretoPersistente, primera.respuesta.secretoPersistente);
  const candidaturas = await sql.consultar(
    `SELECT ordinal,estado,installation_remota_candidata_id
       FROM candidaturas_identidad_federacion
      WHERE relacion_id=? ORDER BY ordinal`,
    [RELACION]
  );
  assert.deepEqual(candidaturas.map(({ ordinal, estado }) => [Number(ordinal), estado]), [
    [1, 'sustituida'], [2, 'pendiente']
  ]);
  const contextoCredencial = {
    relacionId: RELACION,
    installationLocalId: INSTALACION_RECEPTORA,
    installationRemotaId: INSTALACION_EMISORA_2
  };
  assert.equal(await repositorioCredenciales.verificarSecretoReceptor({
    ...contextoCredencial,
    secreto: segunda.respuesta.secretoPersistente
  }, { verificadorSecretos }), true);
  assert.equal(await repositorioCredenciales.verificarSecretoReceptor({
    ...contextoCredencial,
    secreto: primera.respuesta.secretoPersistente
  }, { verificadorSecretos }), false);

  const pendiente = await confirmaciones.obtenerPendiente(RELACION);
  assert.equal(pendiente.installationRemotaCandidataId, INSTALACION_EMISORA_2);
  assert.equal(pendiente.nombreRemotoDeclarado, 'Emisor definitivo 11e');
  const eventoConfirmacion = generarUuidV7Auditoria();
  const correlacionConfirmacion = generarUuidV7Auditoria();
  const entradaConfirmacion = {
    relacionId: RELACION,
    installationRemotaId: INSTALACION_EMISORA_2,
    nombreRemotoDeclarado: 'Emisor definitivo 11e',
    eventoId: eventoConfirmacion,
    correlacionId: correlacionConfirmacion,
    actor: ACTOR
  };
  await assert.rejects(
    () => confirmaciones.confirmar({
      ...entradaConfirmacion,
      nombreRemotoDeclarado: 'Nombre no mostrado'
    }),
    /no coincide|cambió/u
  );
  await assert.rejects(
    () => confirmaciones.confirmar({
      ...entradaConfirmacion,
      eventoId: generarUuidV7Auditoria(),
      actor: { ...ACTOR, modo: 'impersonacion' }
    }),
    /sesión humana directa/u
  );
  await sql.ejecutar(
    'UPDATE usuarios SET permiso_configurar_recepciones_federacion=0 WHERE id=?',
    [USUARIO]
  );
  await assert.rejects(
    () => confirmaciones.confirmar({
      ...entradaConfirmacion,
      eventoId: generarUuidV7Auditoria()
    }),
    /ya no conserva autoridad actual/u
  );
  await sql.ejecutar(
    'UPDATE usuarios SET permiso_configurar_recepciones_federacion=1 WHERE id=?',
    [USUARIO]
  );
  let [relacion] = await sql.consultar(
    'SELECT estado_ciclo,installation_remota_id FROM relaciones_federacion WHERE relacion_id=?',
    [RELACION]
  );
  assert.equal(relacion.estado_ciclo, 'pendienteConfirmacionIdentidad');
  assert.equal(relacion.installation_remota_id, null);

  const confirmada = await confirmaciones.confirmar(entradaConfirmacion);
  assert.equal(confirmada.estado, 'pendienteAutenticacion');
  relacion = (await sql.consultar(
    `SELECT estado_ciclo,installation_remota_candidata_id,
            installation_remota_id,estado_compatibilidad
       FROM relaciones_federacion WHERE relacion_id=?`,
    [RELACION]
  ))[0];
  assert.equal(relacion.estado_ciclo, 'pendienteAutenticacion');
  assert.equal(relacion.installation_remota_candidata_id, INSTALACION_EMISORA_2);
  assert.equal(relacion.installation_remota_id, INSTALACION_EMISORA_2);
  assert.equal(relacion.estado_compatibilidad, null);
  assert.equal(await confirmaciones.obtenerPendiente(RELACION), null);
  const repetida = await confirmaciones.confirmar(entradaConfirmacion);
  assert.deepEqual(repetida, { estado: 'ya_confirmada', cambioEfectivo: false });
  const [conteoEvento] = await sql.consultar(
    'SELECT COUNT(*) AS total FROM eventos_auditoria WHERE evento_id=?',
    [uuidV7AuditoriaABytes(eventoConfirmacion, 'eventoConfirmacion')]
  );
  assert.equal(Number(conteoEvento.total), 1, 'El replay no duplica auditoría.');
  const [historial] = await sql.consultar(
    `SELECT COUNT(*) AS total FROM historico_estados_relaciones_federacion
      WHERE relacion_id=? AND cambio_tipo='identidadConfirmada'`,
    [RELACION]
  );
  assert.equal(Number(historial.total), 1, 'El replay no duplica historia.');
  await assert.rejects(
    () => invitaciones.emitir({
      relacionId: RELACION,
      ttlSegundos: 900,
      eventoId: generarUuidV7Auditoria(),
      correlacionId: generarUuidV7Auditoria(),
      actor: ACTOR
    }),
    /ya no admite invitaciones/u
  );
}

async function emitirYCanjear({
  invitaciones,
  canje,
  installationEmisoraId,
  bootEmisorId,
  nombre
}) {
  const invitacion = await invitaciones.emitir({
    relacionId: RELACION,
    ttlSegundos: 900,
    eventoId: generarUuidV7Auditoria(),
    correlacionId: generarUuidV7Auditoria(),
    actor: ACTOR
  });
  const solicitudCanjeId = generarUuidV7Auditoria();
  const respuesta = await canje.canjear({
    invitacion: invitacion.representacionTransportable,
    installationEmisoraId,
    bootEmisorId,
    nombreEmisorDeclarado: nombre,
    compatibilidad: { protocoloVersion: 1, productoVersion: '0.1.0' },
    solicitudCanjeId
  });
  return { invitacion, solicitudCanjeId, respuesta };
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
       permiso_gestionar_credenciales_federacion
     ) VALUES (?, ?, ?, 'fixture-no-login', 1, 1, 1)`,
    [USUARIO, `fixture-fed-${USUARIO}`, `fixture-fed-${USUARIO}@invalid.local`]
  );
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
       ?,'recepcion','pendienteVinculacion','autorizada','valida',NULL,NULL,NULL,
       NULL,?,?,NULL,NULL,NULL,1,NULL,?,?,?,1
     )`,
    [RELACION, USUARIO, USUARIO, USUARIO, ahora, ahora]
  );
}

async function limpiar(sql) {
  await sql.ejecutar(
    'DELETE FROM credenciales_persistentes_federacion WHERE relacion_id=?',
    [RELACION]
  );
  await sql.ejecutar(
    'DELETE FROM invitaciones_establecimiento_federacion WHERE relacion_id=?',
    [RELACION]
  );
  await sql.ejecutar(
    'DELETE FROM candidaturas_identidad_federacion WHERE relacion_id=?',
    [RELACION]
  );
  await sql.ejecutar(
    'DELETE FROM historico_estados_relaciones_federacion WHERE relacion_id=?',
    [RELACION]
  );
  await sql.ejecutar('DELETE FROM relaciones_federacion WHERE relacion_id=?', [RELACION]);
  await sql.ejecutar('DELETE FROM usuarios WHERE id=?', [USUARIO]);
}

function leer(ruta) {
  return readFile(new URL(ruta, import.meta.url), 'utf8');
}

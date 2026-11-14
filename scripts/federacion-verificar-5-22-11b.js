import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import { RepositorioAuditoria } from '../paquetes/auditoria/src/RepositorioAuditoria.js';
import {
  generarUuidV7Auditoria
} from '../paquetes/auditoria/src/UuidV7Auditoria.js';
import { AdaptadorAuditoriaControlFederacion } from '../paquetes/federacion/adaptadores/AdaptadorAuditoriaControlFederacion.js';
import { GeneradorCredencialInvitacionFederacion } from '../paquetes/federacion/adaptadores/GeneradorCredencialInvitacionFederacion.js';
import {
  RepositorioInvitacionesFederacionSql,
  RespuestaInvitacionNoRecuperable
} from '../paquetes/federacion/adaptadores/RepositorioInvitacionesFederacionSql.js';
import { ServicioInvitacionesFederacion } from '../paquetes/federacion/aplicacion/ServicioInvitacionesFederacion.js';
import {
  crearRepresentacionInvitacionEstablecimientoFederacion
} from '../paquetes/federacion/src/InvitacionEstablecimientoFederacion.js';
import { ClienteSql } from '../paquetes/persistencia-sql/src/ClienteSql.js';
import { EjecutorMigraciones } from '../paquetes/persistencia-sql/src/EjecutorMigraciones.js';
import { RepositorioMigraciones } from '../paquetes/persistencia-sql/src/RepositorioMigraciones.js';
import {
  obtenerConfiguracionAplicacion,
  obtenerRutaMigraciones
} from '../paquetes/utilidades/src/configuracion/obtenerConfiguracionAplicacion.js';

const RELACION = `sfid1.relacion.${'P'.repeat(21)}A`;
const INSTALACION = `sfid1.instalacion.${'Q'.repeat(21)}g`;
const USUARIO = 911;
const ACTOR = Object.freeze({
  real: Object.freeze({ tipo: 'usuario', id: String(USUARIO) }),
  efectivo: null,
  modo: 'directo'
});
await main();

async function main() {
  await verificarContratoYRegistro();
  const configuracion = obtenerConfiguracionAplicacion();
  assert.equal(configuracion.sql.estaCompleta, true, '5.22.11b requiere SQL local.');
  const sql = new ClienteSql(configuracion.sql);
  try {
    await migrar(sql);
    await limpiar(sql);
    await crearFixture(sql);
    await verificarCicloInvitacion(sql);
  } finally {
    await limpiar(sql);
    await sql.cerrar();
  }
  console.log(
    '[federacion] OK 5.22.11b: openapi=control_publicado ' +
    'invitacion=una_vista hash=solo_sql caducidad=estricta ' +
    'revocacion=auditable transicion=unica canje=solo_contrato_11b'
  );
}

async function verificarContratoYRegistro() {
  const [openapi, aplicacion] = await Promise.all([
    leer('../openapi/federacion-control.v1.yaml'),
    leer('../apps/sentinelia-web/src/crearAplicacion.js')
  ]);
  for (const marca of [
    'openapi: 3.1.0',
    '/api/federacion/v1/establecimiento/canje:',
    'PortableFederationInvitation:',
    'TemporaryEstablishmentCredential:',
    'writeOnly: true',
    'InvitationGone:',
    'pendienteConfirmacionIdentidad'
  ]) assert.ok(openapi.includes(marca), `OpenAPI no contiene ${marca}`);
  assert.match(openapi, /FederationUuidV7:/u);
  assert.doesNotMatch(
    openapi,
    /sfid1\\\.(?:instalacion|arranque|relacion)\\\.\[A-Za-z0-9_-\]\{22\}/u,
    'OpenAPI no debe aceptar terminaciones Base64URL imposibles.'
  );
  assert.doesNotMatch(
    openapi,
    /(?:in:\s*(?:query|path)[\s\S]{0,160}credencialTemporal|credencialTemporal[\s\S]{0,160}in:\s*(?:query|path))/u,
    'La credencial temporal no puede declararse en URL.'
  );
  assert.match(
    aplicacion,
    /aplicacion\.get\('\/api\/federacion\/v1\/openapi\.yaml'/,
    'El contrato de control debe publicarse realmente.'
  );
  assert.throws(
    () => crearRepresentacionInvitacionEstablecimientoFederacion({
      invitacionId: `sfinv1_${'A'.repeat(22)}`,
      credencialTemporal: `sft1_${'A'.repeat(43)}`,
      relacionId: `sfid1.relacion.${'A'.repeat(22)}`,
      installationReceptoraId: `sfid1.instalacion.${'A'.repeat(21)}B`,
      origenPublico: 'https://receptor.invalid',
      expiraEnUtc: '2030-01-01T00:00:00.000Z'
    }),
    /installationReceptoraId/u
  );
}

async function verificarCicloInvitacion(sql) {
  const repositorio = new RepositorioInvitacionesFederacionSql(sql, {
    adaptadorAuditoria: new AdaptadorAuditoriaControlFederacion({
      repositorioAuditoria: new RepositorioAuditoria(sql)
    })
  });
  const servicio = new ServicioInvitacionesFederacion({
    repositorioInvitaciones: repositorio,
    generadorCredencial: new GeneradorCredencialInvitacionFederacion(),
    resolverOrigenPublico: () => 'https://receptor.example:8443',
    installationReceptoraId: INSTALACION
  });
  const primera = await servicio.emitir(solicitud());
  assert.equal(primera.estado, 'emitida');
  assert.equal(
    primera.representacionTransportable.destino.origenPublico,
    'https://receptor.example:8443'
  );
  assert.match(primera.representacionTransportable.credencialTemporal, /^sft1_/);
  assert.equal(JSON.stringify(primera).includes('credencialHash'), false);
  const saneada = await repositorio.buscarSaneadaPorId(primera.invitacionId);
  assert.equal(Object.hasOwn(saneada, 'credencialHash'), false);
  const filaPrimera = await fila(sql, primera.invitacionId);
  assert.equal(filaPrimera.estado, 'vigente');
  assert.equal(
    JSON.stringify(filaPrimera).includes(
      primera.representacionTransportable.credencialTemporal
    ),
    false,
    'SQL nunca debe conservar la credencial temporal en claro.'
  );
  assert.equal(String(filaPrimera.huella).length, 64);

  const eventoSegunda = generarUuidV7Auditoria();
  const segunda = await servicio.emitir(solicitud({ eventoId: eventoSegunda }));
  assert.equal((await fila(sql, primera.invitacionId)).estado, 'revocada');
  assert.equal((await fila(sql, segunda.invitacionId)).estado, 'vigente');
  await assert.rejects(
    () => servicio.emitir(solicitud({ eventoId: eventoSegunda })),
    RespuestaInvitacionNoRecuperable
  );
  assert.equal(
    Number((await sql.consultar(
      'SELECT COUNT(*) AS total FROM invitaciones_establecimiento_federacion WHERE relacion_id=?',
      [RELACION]
    ))[0].total),
    2,
    'Un replay no debe crear ni recuperar otra representación.'
  );

  const revocada = await servicio.revocar({
    ...solicitud(),
    invitacionId: segunda.invitacionId
  });
  assert.deepEqual(revocada, { estado: 'revocada', cambioEfectivo: true });
  assert.equal((await fila(sql, segunda.invitacionId)).estado, 'revocada');
  const tipos = await sql.consultar(
    `SELECT tipo_evento FROM eventos_auditoria
      WHERE sujeto_tipo='relacion_federada' AND sujeto_id=?
        AND tipo_evento IN (
          'federacion.vinculacion_solicitada',
          'federacion.invitacion_revocada'
        )`,
    [RELACION]
  );
  assert.ok(tipos.some(({ tipo_evento }) =>
    tipo_evento === 'federacion.vinculacion_solicitada'));
  assert.ok(tipos.some(({ tipo_evento }) =>
    tipo_evento === 'federacion.invitacion_revocada'));

  const tercera = await servicio.emitir(solicitud());
  await sql.ejecutar(
    `UPDATE invitaciones_establecimiento_federacion
        SET estado='expirada', relacion_vigente_id=NULL
      WHERE invitacion_id=?`,
    [tercera.invitacionId]
  );
  await assert.rejects(
    () => sql.ejecutar(
      `UPDATE invitaciones_establecimiento_federacion
          SET estado='vigente', relacion_vigente_id=relacion_id
        WHERE invitacion_id=?`,
      [tercera.invitacionId]
    ),
    /terminal|transicion/i
  );
}

function solicitud({ eventoId = generarUuidV7Auditoria() } = {}) {
  return {
    relacionId: RELACION,
    ttlSegundos: 900,
    eventoId,
    correlacionId: generarUuidV7Auditoria(),
    actor: ACTOR
  };
}

async function migrar(sql) {
  const repositorio = new RepositorioMigraciones(sql);
  const ejecutor = new EjecutorMigraciones({
    clienteSql: sql,
    repositorioMigraciones: repositorio,
    rutaMigraciones: obtenerRutaMigraciones()
  });
  await ejecutor.ejecutarPendientes();
  assert.equal((await ejecutor.ejecutarPendientes()).pendientesAplicadas, 0);
}

async function crearFixture(sql) {
  await sql.ejecutar(
    `INSERT INTO usuarios (
       id, usuario, email, hash_password, activo,
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
  const tablas = await sql.consultar(
    `SELECT COUNT(*) AS total
       FROM information_schema.TABLES
      WHERE TABLE_SCHEMA=DATABASE()
        AND TABLE_NAME='invitaciones_establecimiento_federacion'`
  );
  if (Number(tablas[0].total) > 0) {
    await sql.ejecutar(
      'DELETE FROM invitaciones_establecimiento_federacion WHERE relacion_id=?',
      [RELACION]
    );
  }
  await sql.ejecutar(
    'DELETE FROM historico_estados_relaciones_federacion WHERE relacion_id=?',
    [RELACION]
  );
  await sql.ejecutar('DELETE FROM relaciones_federacion WHERE relacion_id=?', [RELACION]);
  await sql.ejecutar('DELETE FROM usuarios WHERE id=?', [USUARIO]);
}

async function fila(sql, invitacionId) {
  return (await sql.consultar(
    `SELECT invitacion_id, estado, HEX(credencial_hash) AS huella
       FROM invitaciones_establecimiento_federacion
      WHERE invitacion_id=?`,
    [invitacionId]
  ))[0];
}

function leer(ruta) {
  return readFile(new URL(ruta, import.meta.url), 'utf8');
}

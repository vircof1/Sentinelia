import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import { ControladorApiFederacion } from '../apps/sentinelia-web/src/controladores/ControladorApiFederacion.js';

import { RepositorioAuditoria } from '../paquetes/auditoria/src/RepositorioAuditoria.js';
import { generarUuidV7Auditoria } from '../paquetes/auditoria/src/UuidV7Auditoria.js';
import { AdaptadorAuditoriaCanjeFederacion } from '../paquetes/federacion/adaptadores/AdaptadorAuditoriaCanjeFederacion.js';
import { AdaptadorAuditoriaControlFederacion } from '../paquetes/federacion/adaptadores/AdaptadorAuditoriaControlFederacion.js';
import { GeneradorCredencialInvitacionFederacion } from '../paquetes/federacion/adaptadores/GeneradorCredencialInvitacionFederacion.js';
import {
  GeneradorSecretoPersistenteFederacion,
  ProvisionadorCanjePendienteNoDisponible
} from '../paquetes/federacion/adaptadores/GeneradorSecretoPersistenteFederacion.js';
import {
  InvitacionCanjeRechazada,
  InvitacionCanjeNoDisponible,
  RepositorioInvitacionesFederacionSql
} from '../paquetes/federacion/adaptadores/RepositorioInvitacionesFederacionSql.js';
import { ServicioCanjeInvitacionFederacion } from '../paquetes/federacion/aplicacion/ServicioCanjeInvitacionFederacion.js';
import { ServicioInvitacionesFederacion } from '../paquetes/federacion/aplicacion/ServicioInvitacionesFederacion.js';
import { ClienteSql } from '../paquetes/persistencia-sql/src/ClienteSql.js';
import { EjecutorMigraciones } from '../paquetes/persistencia-sql/src/EjecutorMigraciones.js';
import { RepositorioMigraciones } from '../paquetes/persistencia-sql/src/RepositorioMigraciones.js';
import {
  obtenerConfiguracionAplicacion,
  obtenerRutaMigraciones
} from '../paquetes/utilidades/src/configuracion/obtenerConfiguracionAplicacion.js';

const RELACION = `sfid1.relacion.${'R'.repeat(21)}A`;
const INSTALACION_RECEPTORA = `sfid1.instalacion.${'S'.repeat(21)}Q`;
const INSTALACION_EMISORA = `sfid1.instalacion.${'T'.repeat(21)}g`;
const BOOT_EMISOR = `sfid1.arranque.${'U'.repeat(21)}w`;
const USUARIO = 912;
const ORIGEN = 'https://receptor.example:8443';
const ACTOR = Object.freeze({
  real: Object.freeze({ tipo: 'usuario', id: String(USUARIO) }),
  efectivo: null,
  modo: 'directo'
});

async function main() {
  await verificarContratoYComposicion();
  await verificarErroresSaneados();
  const configuracion = obtenerConfiguracionAplicacion();
  assert.equal(configuracion.sql.estaCompleta, true, '5.22.11c requiere SQL local.');
  const sql = new ClienteSql(configuracion.sql);
  try {
    await migrar(sql);
    await limpiar(sql);
    await crearFixture(sql);
    await verificarCanjeIrrepetible(sql);
  } finally {
    await limpiar(sql);
    await sql.cerrar();
  }
  console.log(
    '[federacion] OK 5.22.11c: canje=atomico secreto=una_respuesta ' +
    'fallo=rollback replay=no_recuperable reintento=invitacion_nueva ' +
    'produccion=cerrada_hasta_provision_durable'
  );
}

async function verificarErroresSaneados() {
  const secreto = 'sft1_no_debe_llegar_a_la_respuesta_ni_al_log';
  const controlador = new ControladorApiFederacion({
    servicioCanjeInvitacion: {
      async canjear() {
        throw new Error(`Fallo interno que contenía ${secreto}`);
      }
    }
  });
  const respuesta = crearRespuestaFixture();
  await controlador.canjearInvitacion({ body: {} }, respuesta);
  assert.equal(respuesta.statusCode, 500);
  assert.equal(respuesta.headers['Cache-Control'], 'no-store');
  assert.equal(JSON.stringify(respuesta.body).includes(secreto), false);

  let refreshInvocado = false;
  const controladorBearer = new ControladorApiFederacion({
    servicioCanjeInvitacion: { async canjear() { return {}; } },
    servicioSesionesFederacion: {
      async login() { return { ok: true }; },
      async refresh() {
        refreshInvocado = true;
        return { ok: true };
      }
    }
  });
  const respuestaTokenEnCuerpo = crearRespuestaFixture();
  await controladorBearer.refresh({
    body: { token: `sfop1_${'A'.repeat(64)}` },
    get(nombre) {
      return nombre === 'authorization'
        ? `Bearer sfop1_${'B'.repeat(64)}`
        : null;
    }
  }, respuestaTokenEnCuerpo);
  assert.equal(respuestaTokenEnCuerpo.statusCode, 400);
  assert.equal(respuestaTokenEnCuerpo.body.codigo, 'TOKEN_FEDERADO_EN_CUERPO');
  assert.equal(refreshInvocado, false,
    'El cuerpo nunca debe sustituir la credencial de Authorization.');
}

async function verificarContratoYComposicion() {
  const [openapi, aplicacion, rutas, controlador, index] =
    await Promise.all([
      leer('../openapi/federacion-control.v1.yaml'),
      leer('../apps/sentinelia-web/src/crearAplicacion.js'),
      leer('../apps/sentinelia-web/src/rutas/crearRutasApiFederacion.js'),
      leer('../apps/sentinelia-web/src/controladores/ControladorApiFederacion.js'),
      leer('../apps/sentinelia-web/src/index.js')
    ]);
  assert.match(openapi, /- solicitudCanjeId/u);
  assert.match(openapi, /Identidad UUIDv7 nueva/u);
  assert.match(rutas, /router\.post\([\s\S]*establecimiento\/canje/u);
  assert.match(controlador, /status\(201\)[\s\S]*no-store/u);
  assert.match(aplicacion, /crearRutasApiFederacion/u);
  const fronteraJsonFederada = aplicacion.indexOf(
    "peticion.path?.startsWith('/api/federacion/')"
  );
  assert.ok(fronteraJsonFederada >= 0);
  assert.ok(
    fronteraJsonFederada < aplicacion.indexOf("console.error('[sentinelia-web] Error de peticion')"),
    'El cuerpo federado malformado debe descartarse antes de registrar el error.'
  );
}

async function verificarCanjeIrrepetible(sql) {
  const repositorioAuditoria = new RepositorioAuditoria(sql);
  const repositorio = new RepositorioInvitacionesFederacionSql(sql, {
    adaptadorAuditoria: new AdaptadorAuditoriaControlFederacion({
      repositorioAuditoria
    }),
    adaptadorAuditoriaCanje: new AdaptadorAuditoriaCanjeFederacion({
      repositorioAuditoria
    })
  });
  const servicioInvitaciones = new ServicioInvitacionesFederacion({
    repositorioInvitaciones: repositorio,
    generadorCredencial: new GeneradorCredencialInvitacionFederacion(),
    resolverOrigenPublico: () => ORIGEN,
    installationReceptoraId: INSTALACION_RECEPTORA
  });
  const primera = await servicioInvitaciones.emitir(solicitudEmision());
  const solicitudPrimera = solicitudCanje(primera.representacionTransportable);
  const servicioCerrado = crearServicioCanje(
    repositorio,
    new ProvisionadorCanjePendienteNoDisponible()
  );
  await assert.rejects(
    () => servicioCerrado.canjear(solicitudPrimera),
    (error) => error?.statusCode === 503
  );
  assert.equal(
    (await filaInvitacion(sql, primera.invitacionId)).estado,
    'vigente',
    'Una dependencia incompleta debe revertir el consumo íntegro.'
  );

  const provisionador = new ProvisionadorCanjeFixture();
  const servicio = crearServicioCanje(repositorio, provisionador);
  const invitacionAlterada = structuredClone(primera.representacionTransportable);
  invitacionAlterada.credencialTemporal = alterarUltimoCaracter(
    invitacionAlterada.credencialTemporal
  );
  await assert.rejects(
    () => servicio.canjear(solicitudCanje(invitacionAlterada)),
    InvitacionCanjeRechazada
  );
  assert.equal(provisionador.total, 0, 'Una huella incorrecta no debe provisionar nada.');
  const respuestaPrimera = await servicio.canjear(solicitudPrimera);
  assert.equal(respuestaPrimera.estado, 'pendienteConfirmacionIdentidad');
  assert.match(respuestaPrimera.secretoPersistente, /^sfr1_[A-Za-z0-9_-]{64}$/u);
  assert.equal(provisionador.total, 1);
  const consumida = await filaInvitacion(sql, primera.invitacionId);
  assert.equal(consumida.estado, 'consumida');
  assert.equal(consumida.installation_emisora_id, INSTALACION_EMISORA);
  assert.equal(consumida.boot_emisor_id, BOOT_EMISOR);
  assert.equal(consumida.evento_consumo_id.length, 32);
  assert.equal(consumida.solicitud_canje_id.length, 32);

  await assert.rejects(
    () => servicio.canjear(solicitudPrimera),
    InvitacionCanjeNoDisponible,
    'Una respuesta perdida no permite recuperar el secreto con replay.'
  );
  assert.equal(provisionador.total, 1, 'El replay no debe reprovisionar credenciales.');

  const segunda = await servicioInvitaciones.emitir(solicitudEmision());
  const respuestaSegunda = await servicio.canjear(
    solicitudCanje(segunda.representacionTransportable)
  );
  assert.notEqual(
    respuestaSegunda.secretoPersistente,
    respuestaPrimera.secretoPersistente,
    'El nuevo intento debe usar una invitación y secreto nuevos.'
  );
  assert.equal(provisionador.total, 2);
  const auditoria = await sql.consultar(
    `SELECT COUNT(*) AS total FROM eventos_auditoria
      WHERE tipo_evento='federacion.invitacion_consumida'
        AND sujeto_tipo='relacion_federada' AND sujeto_id=?`,
    [RELACION]
  );
  assert.equal(Number(auditoria[0].total) >= 2, true);
  const serializado = JSON.stringify(await sql.consultar(
    `SELECT * FROM invitaciones_establecimiento_federacion WHERE relacion_id=?`,
    [RELACION]
  ));
  assert.equal(serializado.includes(respuestaPrimera.secretoPersistente), false);
  assert.equal(serializado.includes(respuestaSegunda.secretoPersistente), false);
}

class ProvisionadorCanjeFixture {
  total = 0;

  async registrarEnTransaccion(entrada, { conexion } = {}) {
    assert.equal(typeof conexion?.execute, 'function');
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
    this.total += 1;
    return Object.freeze({
      credencialPersistida: true,
      identidadCandidataPersistida: true
    });
  }
}

function crearServicioCanje(repositorio, provisionadorCanjePendiente) {
  return new ServicioCanjeInvitacionFederacion({
    repositorioInvitaciones: repositorio,
    provisionadorCanjePendiente,
    generadorSecretoPersistente: new GeneradorSecretoPersistenteFederacion(),
    installationReceptoraId: INSTALACION_RECEPTORA,
    resolverOrigenPublico: () => ORIGEN
  });
}

function solicitudEmision() {
  return {
    relacionId: RELACION,
    ttlSegundos: 900,
    eventoId: generarUuidV7Auditoria(),
    correlacionId: generarUuidV7Auditoria(),
    actor: ACTOR
  };
}

function solicitudCanje(invitacion) {
  return {
    invitacion,
    installationEmisoraId: INSTALACION_EMISORA,
    bootEmisorId: BOOT_EMISOR,
    nombreEmisorDeclarado: 'Emisor fixture 11c',
    compatibilidad: { protocoloVersion: 1, productoVersion: '0.1.0' },
    solicitudCanjeId: generarUuidV7Auditoria()
  };
}

function alterarUltimoCaracter(valor) {
  return `${valor.slice(0, -1)}${valor.endsWith('A') ? 'Q' : 'A'}`;
}

function crearRespuestaFixture() {
  return {
    headers: {},
    statusCode: null,
    body: null,
    status(codigo) { this.statusCode = codigo; return this; },
    type(tipo) { this.headers['Content-Type'] = tipo; return this; },
    set(nombre, valor) { this.headers[nombre] = valor; return this; },
    json(body) { this.body = body; return this; }
  };
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
  const existe = await sql.consultar(
    `SELECT COUNT(*) AS total FROM information_schema.TABLES
      WHERE TABLE_SCHEMA=DATABASE()
        AND TABLE_NAME='invitaciones_establecimiento_federacion'`
  );
  if (Number(existe[0].total) > 0) {
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

async function filaInvitacion(sql, invitacionId) {
  return (await sql.consultar(
    `SELECT invitacion_id, estado, installation_emisora_id, boot_emisor_id,
            HEX(evento_consumo_id) AS evento_consumo_id,
            HEX(solicitud_canje_id) AS solicitud_canje_id
       FROM invitaciones_establecimiento_federacion
      WHERE invitacion_id=?`,
    [invitacionId]
  ))[0];
}

function leer(ruta) {
  return readFile(new URL(ruta, import.meta.url), 'utf8');
}

await main();

import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';

import { CatalogoEjecutoresOperacionesAdministrativas } from '../paquetes/agentes/src/CatalogoEjecutoresOperacionesAdministrativas.js';
import { CodecConfirmacionEliminacionAgente } from '../paquetes/agentes/src/CodecConfirmacionEliminacionAgente.js';
import { CONTRATO_OPERACION_ADMINISTRATIVA_ELIMINACION_AGENTE } from '../paquetes/agentes/src/ContratoOperacionAdministrativaEliminacionAgente.js';
import { crearCatalogoNotificacionesEliminacionAgente } from '../paquetes/agentes/src/ContratoPersistenciaNotificacionesEliminacionAgente.js';
import { RepositorioAgentesSentinelia } from '../paquetes/agentes/src/RepositorioAgentesSentinelia.js';
import { RepositorioEliminacionAdministrativaAgentesSql } from '../paquetes/agentes/src/RepositorioEliminacionAdministrativaAgentesSql.js';
import { RepositorioNotificacionesUsuarioSql } from '../paquetes/agentes/src/RepositorioNotificacionesUsuarioSql.js';
import { RepositorioOperacionesAdministrativasSql } from '../paquetes/agentes/src/RepositorioOperacionesAdministrativasSql.js';
import { ServicioAceptacionEliminacionAdministrativaAgente } from '../paquetes/agentes/src/ServicioAceptacionEliminacionAdministrativaAgente.js';
import { ServicioAutorizacionEliminacionAdministrativaAgente } from '../paquetes/agentes/src/ServicioAutorizacionEliminacionAdministrativaAgente.js';
import { ServicioImpactoEliminacionAgente } from '../paquetes/agentes/src/ServicioImpactoEliminacionAgente.js';
import { RepositorioUsuarios } from '../paquetes/usuarios/src/RepositorioUsuarios.js';
import { ClienteSql } from '../paquetes/persistencia-sql/src/ClienteSql.js';
import { EjecutorMigraciones } from '../paquetes/persistencia-sql/src/EjecutorMigraciones.js';
import { FronteraTransaccionalLocal } from '../paquetes/persistencia-sql/src/FronteraTransaccionalLocal.js';
import { RepositorioMigraciones } from '../paquetes/persistencia-sql/src/RepositorioMigraciones.js';
import { AutoridadReservasJerarquicasOperacionesAdministrativasSql } from '../paquetes/jerarquia-organizativa/src/AutoridadReservasJerarquicasOperacionesAdministrativasSql.js';
import {
  obtenerConfiguracionAplicacion,
  obtenerRutaMigraciones
} from '../paquetes/utilidades/src/configuracion/obtenerConfiguracionAplicacion.js';

await main();

async function main() {
  const configuracion = obtenerConfiguracionAplicacion();
  assert.equal(configuracion.sql.estaCompleta, true, '5.25.5 necesita MySQL real.');
  const baseDatos = `sentinelia_fixture_5255_${randomBytes(6).toString('hex')}`;
  const administrador = new ClienteSql(configuracion.sql);
  await administrador.ejecutar(
    `CREATE DATABASE ${administrador.escaparIdentificador(baseDatos)} ` +
      'CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci'
  );
  const sql = new ClienteSql({ ...configuracion.sql, baseDatos });

  try {
    await new EjecutorMigraciones({
      clienteSql: sql,
      repositorioMigraciones: new RepositorioMigraciones(sql),
      rutaMigraciones: obtenerRutaMigraciones()
    }).ejecutarPendientes();
    await sql.verificarUsoHorarioUtc();
    const escenario = await crearEscenario(sql);
    const reloj = { ahora: new Date('2026-08-30T15:00:00.000Z') };
    const servicios = crearServicios(sql, reloj);

    assert.deepEqual(servicios.catalogo.listarContratos(), ['eliminar_agente@1']);
    assert.deepEqual(servicios.catalogo.listarEjecutores(), []);
    assert.throws(
      () => servicios.catalogo.resolver('eliminar_agente', 1),
      (error) => error.codigo === 'contrato_operacion_administrativa_no_registrado'
    );

    await verificarImpactoYActividad(sql, servicios, escenario);
    await verificarToken(servicios, escenario, reloj);
    await verificarCambioEstructural(sql, servicios, escenario);
    await verificarAceptacionReplayYReclamo(servicios, escenario);
    await verificarRollbackOperacionNotificacion(sql, servicios, escenario);
    await verificarSinBorradoYSuperficieCerrada(sql);

    console.log(
      '[agentes] OK 5.25.5: impacto=exacto_o_acotado huella=rfc8785_sha256 ' +
        'token=hmac_csrf_expirable frase=exacta telemetria=no_invalida ' +
        'estructura=invalida replay=idempotente reclamo=unico rollback=atomico ' +
        'superficie=gate_apagado agentes_eliminados=0'
    );
  } finally {
    await sql.cerrar();
    await administrador.ejecutar(
      `DROP DATABASE IF EXISTS ${administrador.escaparIdentificador(baseDatos)}`
    ).catch(() => {});
    await administrador.cerrar();
  }
}

function crearServicios(sql, reloj) {
  const frontera = new FronteraTransaccionalLocal(sql);
  const servicioAutorizacion = new ServicioAutorizacionEliminacionAdministrativaAgente({
    repositorioUsuarios: new RepositorioUsuarios(sql),
    repositorioAgentes: new RepositorioAgentesSentinelia(sql),
    fronteraTransaccional: frontera,
    ahora: () => new Date(reloj.ahora)
  });
  const codec = new CodecConfirmacionEliminacionAgente({
    secreto: 'secreto-confirmacion-eliminacion-5.25.5-con-longitud-suficiente',
    ttlSegundos: 600,
    ahora: () => new Date(reloj.ahora)
  });
  const repositorioEliminacion = new RepositorioEliminacionAdministrativaAgentesSql(sql);
  const servicioImpacto = new ServicioImpactoEliminacionAgente({
    repositorioEliminacion,
    servicioAutorizacion,
    fronteraTransaccional: frontera,
    codecConfirmacion: codec
  });
  const catalogo = new CatalogoEjecutoresOperacionesAdministrativas({
    contratos: [CONTRATO_OPERACION_ADMINISTRATIVA_ELIMINACION_AGENTE]
  });
  const repositorioOperaciones = new RepositorioOperacionesAdministrativasSql({
    clienteSql: sql,
    catalogoEjecutores: catalogo
  });
  const repositorioNotificaciones = new RepositorioNotificacionesUsuarioSql(sql, {
    catalogoContratos: crearCatalogoNotificacionesEliminacionAgente()
  });
  const autoridadReservasJerarquicas =
    new AutoridadReservasJerarquicasOperacionesAdministrativasSql(sql);
  const servicioAceptacion = new ServicioAceptacionEliminacionAdministrativaAgente({
    servicioImpacto,
    servicioAutorizacion,
    fronteraTransaccional: frontera,
    codecConfirmacion: codec,
    autoridadReservasJerarquicas,
    repositorioOperaciones,
    repositorioNotificaciones
  });
  return {
    catalogo,
    codec,
    frontera,
    servicioImpacto,
    servicioAutorizacion,
    servicioAceptacion,
    autoridadReservasJerarquicas,
    repositorioOperaciones,
    repositorioNotificaciones
  };
}

async function verificarImpactoYActividad(sql, servicios, escenario) {
  const vista = await preparar(servicios, escenario, escenario.agentes[0]);
  const conteos = Object.fromEntries(
    vista.resumenImpacto.conteos.map((conteo) => [conteo.categoria, conteo])
  );
  assert.equal(conteos.agente.cantidad, '1');
  assert.equal(conteos.reglas.cantidad, '1');
  assert.equal(conteos.monitores.cantidad, '1');
  assert.equal(conteos.asignaciones_trigger.cantidad, '1');
  assert.equal(conteos.perfil_servidor.cantidad, '1');
  assert.equal(conteos.observaciones.precision, 'exacta');
  assert.equal(conteos.identidades_federadas.precision, 'exacta');
  assert.equal(vista.fraseConfirmacion.endsWith(
    escenario.agentes[0].guid.replaceAll('-', '').slice(-8)
  ), true);

  await insertarObservaciones(sql, escenario.agentes[0], 250);
  const posterior = await preparar(servicios, escenario, escenario.agentes[0]);
  assert.equal(posterior.huellaEstructuralSha256, vista.huellaEstructuralSha256);
  const observaciones = posterior.resumenImpacto.conteos
    .find(({ categoria }) => categoria === 'observaciones');
  assert.equal(Number(observaciones.cantidad) >= 250, true);

  const aceptada = await aceptar(servicios, escenario, escenario.agentes[0], vista);
  assert.equal(aceptada.codigo, 'agente_eliminacion_encolada');
}

async function verificarToken(servicios, escenario, reloj) {
  const agente = escenario.agentes[1];
  const vista = await preparar(servicios, escenario, agente);
  const alterado = `${vista.tokenConfirmacion.slice(0, -1)}${
    vista.tokenConfirmacion.endsWith('a') ? 'b' : 'a'}`;
  await assert.rejects(
    aceptar(servicios, escenario, agente, { ...vista, tokenConfirmacion: alterado }),
    (error) => error.codigo === 'agente_eliminacion_confirmacion_invalida'
  );
  await assert.rejects(
    servicios.servicioAceptacion.aceptar({
      actorRealId: escenario.usuarioId,
      actorEfectivoId: escenario.usuarioId,
      agenteId: agente.id,
      tokenConfirmacion: vista.tokenConfirmacion,
      fraseConfirmacion: vista.fraseConfirmacion,
      csrfToken: 'csrf-cruzado'
    }),
    (error) => error.codigo === 'agente_eliminacion_confirmacion_invalida'
  );
  await assert.rejects(
    aceptar(servicios, escenario, escenario.agentes[2], vista),
    (error) => error.codigo === 'agente_eliminacion_confirmacion_invalida'
  );
  await assert.rejects(
    aceptar(servicios, escenario, agente, {
      ...vista,
      fraseConfirmacion: `${vista.fraseConfirmacion.slice(0, -1)}${
        vista.fraseConfirmacion.endsWith('0') ? '1' : '0'
      }`
    }),
    (error) => error.codigo === 'agente_eliminacion_confirmacion_invalida'
  );
  reloj.ahora = new Date('2026-08-30T15:11:00.000Z');
  await assert.rejects(
    aceptar(servicios, escenario, agente, vista),
    (error) => error.codigo === 'agente_eliminacion_confirmacion_expirada'
  );
  reloj.ahora = new Date('2026-08-30T15:00:30.000Z');
}

async function verificarCambioEstructural(sql, servicios, escenario) {
  const agente = escenario.agentes[1];
  const vista = await preparar(servicios, escenario, agente);
  await sql.ejecutar(
    'UPDATE agentes_sentinelia SET nombre=? WHERE id=?',
    [`${agente.nombre} modificado`, agente.id]
  );
  await assert.rejects(
    aceptar(servicios, escenario, agente, vista),
    (error) => error.codigo === 'agente_eliminacion_estructura_modificada'
  );
  await sql.ejecutar(
    'UPDATE agentes_sentinelia SET nombre=? WHERE id=?',
    [agente.nombre, agente.id]
  );
}

async function verificarAceptacionReplayYReclamo(servicios, escenario) {
  const agente = escenario.agentes[1];
  const primeraVista = await preparar(servicios, escenario, agente);
  const vistaCompetidora = await preparar(servicios, escenario, agente);
  const primera = await aceptar(servicios, escenario, agente, primeraVista);
  const repetida = await aceptar(servicios, escenario, agente, primeraVista);
  assert.equal(primera.codigo, 'agente_eliminacion_encolada');
  assert.equal(repetida.codigo, 'agente_eliminacion_repetida');
  assert.equal(repetida.operacionId, primera.operacionId);
  await assert.rejects(
    aceptar(servicios, escenario, agente, vistaCompetidora),
    (error) => error.codigo === 'agente_eliminacion_operacion_en_curso'
  );
}

async function verificarRollbackOperacionNotificacion(sql, servicios, escenario) {
  const agente = escenario.agentes[2];
  const vista = await preparar(servicios, escenario, agente);
  const servicioConFallo = new ServicioAceptacionEliminacionAdministrativaAgente({
    servicioImpacto: servicios.servicioImpacto,
    servicioAutorizacion: servicios.servicioAutorizacion,
    fronteraTransaccional: servicios.frontera,
    codecConfirmacion: servicios.codec,
    autoridadReservasJerarquicas: servicios.autoridadReservasJerarquicas,
    repositorioOperaciones: servicios.repositorioOperaciones,
    repositorioNotificaciones: {
      async crearORecuperar() {
        throw new Error('fallo inyectado entre operación y notificación');
      },
      buscarPorOperacionYTipo: (...args) =>
        servicios.repositorioNotificaciones.buscarPorOperacionYTipo(...args)
    }
  });
  await assert.rejects(
    servicioConFallo.aceptar(parametrosAceptacion(escenario, agente, vista)),
    /fallo inyectado/u
  );
  const [filas] = await sql.consultar(
    'SELECT COUNT(*) total FROM operaciones_administrativas WHERE sujeto_id=?',
    [agente.id]
  );
  assert.equal(Number(filas.total), 0);
  const recuperada = await aceptar(servicios, escenario, agente, vista);
  assert.equal(recuperada.codigo, 'agente_eliminacion_encolada');
}

async function verificarSinBorradoYSuperficieCerrada(sql) {
  const [agentes] = await sql.consultar('SELECT COUNT(*) total FROM agentes_sentinelia');
  assert.equal(Number(agentes.total), 3);
  const [operaciones] = await sql.consultar(
    "SELECT COUNT(*) total FROM operaciones_administrativas WHERE tipo='eliminar_agente'"
  );
  const [notificaciones] = await sql.consultar(
    "SELECT COUNT(*) total FROM notificaciones_usuarios WHERE tipo='eliminacion_encolada'"
  );
  assert.equal(Number(operaciones.total), 3);
  assert.equal(Number(notificaciones.total), 3);
  const rutas = await readFile(
    new URL('../apps/sentinelia-web/src/rutas/crearRutasPortal.js', import.meta.url),
    'utf8'
  );
  const configuracion = await readFile(
    new URL(
      '../paquetes/utilidades/src/configuracion/obtenerConfiguracionAplicacion.js',
      import.meta.url
    ),
    'utf8'
  );
  assert.match(
    rutas,
    /'\/agentes\/:id\/eliminar',\s+requerirEliminacionAdministrativaAgentesHttp,/u
  );
  assert.match(
    configuracion,
    /AGENTES_ELIMINACION_ADMINISTRATIVA_HTTP_HABILITADA'[\s\S]{0,80}false/u
  );
}

async function preparar(servicios, escenario, agente) {
  return servicios.servicioImpacto.preparar({
    actorRealId: escenario.usuarioId,
    actorEfectivoId: escenario.usuarioId,
    agenteId: agente.id,
    csrfToken: escenario.csrf
  });
}

async function aceptar(servicios, escenario, agente, vista) {
  return servicios.servicioAceptacion.aceptar(
    parametrosAceptacion(escenario, agente, vista)
  );
}

function parametrosAceptacion(escenario, agente, vista) {
  return {
    actorRealId: escenario.usuarioId,
    actorEfectivoId: escenario.usuarioId,
    agenteId: agente.id,
    tokenConfirmacion: vista.tokenConfirmacion,
    fraseConfirmacion: vista.fraseConfirmacion,
    csrfToken: escenario.csrf
  };
}

async function crearEscenario(sql) {
  const sufijo = randomBytes(4).toString('hex');
  const [usuario] = await sql.ejecutar(
    'INSERT INTO usuarios (usuario,email,hash_password,nombre_mostrar) VALUES (?,?,?,?)',
    [`elimina-${sufijo}`, `elimina-${sufijo}@example.invalid`, 'hash-no-utilizable', 'Elimina']
  );
  await sql.ejecutar(
    `UPDATE usuarios SET permiso_ver_agentes=1,permiso_eliminar_agentes=1
      WHERE id=?`,
    [usuario.insertId]
  );
  const [tenant] = await sql.ejecutar(
    'INSERT INTO tenants (nombre,alias) VALUES (?,?)',
    ['Tenant 5.25.5', `t-5255-${sufijo}`]
  );
  const [empresa] = await sql.ejecutar(
    'INSERT INTO empresas (tenant_id,nombre,alias) VALUES (?,?,?)',
    [tenant.insertId, 'Empresa 5.25.5', `e-5255-${sufijo}`]
  );
  const [sitio] = await sql.ejecutar(
    'INSERT INTO sitios (tenant_id,empresa_id,nombre,alias) VALUES (?,?,?,?)',
    [tenant.insertId, empresa.insertId, 'Sitio 5.25.5', `s-5255-${sufijo}`]
  );
  const agentes = [];
  for (let indice = 0; indice < 3; indice += 1) {
    const guid = randomUUID();
    const nombre = `Agente 5.25.5 ${indice + 1}`;
    const [agente] = await sql.ejecutar(
      `INSERT INTO agentes_sentinelia (
         guid,tenant_id,empresa_id,sitio_id,nombre,descripcion,secreto_hash
       ) VALUES (?,?,?,?,?,?,?)`,
      [guid, tenant.insertId, empresa.insertId, sitio.insertId,
        nombre, `Descripción ${indice + 1}`, 'hash-no-utilizable']
    );
    agentes.push(Object.freeze({
      id: String(agente.insertId),
      guid,
      nombre,
      tenantId: String(tenant.insertId),
      empresaId: String(empresa.insertId),
      sitioId: String(sitio.insertId)
    }));
  }
  await enriquecerAgente(sql, agentes[0]);
  return Object.freeze({
    usuarioId: String(usuario.insertId),
    agentes: Object.freeze(agentes),
    csrf: 'csrf-verificacion-5.25.5'
  });
}

async function enriquecerAgente(sql, agente) {
  const [senal] = await sql.ejecutar(
    `INSERT INTO senales_telemetria_agentes (
       agente_id,categoria,clave,tag,codigo_senal,tipo_dato,unidad,nombre_humano
     ) VALUES (?,?,?,?,?,'numero','%','CPU')`,
    [agente.id, 'sistema', 'cpu.uso', '', 'sistema.cpu.uso:global']
  );
  const [regla] = await sql.ejecutar(
    `INSERT INTO reglas_derivacion_telemetria (
       agente_id,senal_id,tenant_id,empresa_id,sitio_id,estado
     ) VALUES (?,?,?,?,?,'activa')`,
    [agente.id, senal.insertId, agente.tenantId, agente.empresaId, agente.sitioId]
  );
  const [revision] = await sql.ejecutar(
    `INSERT INTO revisiones_reglas_derivacion_telemetria (
       regla_id,numero,condicion_tipo,condicion_version,condicion_canonica,
       severidad_calculada,mensaje_operativo,nombre,vigente_desde_utc
     ) VALUES (?,1,'numero',1,?,'advertencia','CPU alta','CPU alta',UTC_TIMESTAMP(6))`,
    [regla.insertId, JSON.stringify({ operador: '>', umbral: 90 })]
  );
  await sql.ejecutar(
    'UPDATE reglas_derivacion_telemetria SET revision_vigente_id=? WHERE id=?',
    [revision.insertId, regla.insertId]
  );
  const [monitor] = await sql.ejecutar(
    `INSERT INTO monitores (
       tenant_id,empresa_id,sitio_id,nombre,tipo,configuracion
     ) VALUES (?,?,?,?, 'telemetria', ?)`,
    [agente.tenantId, agente.empresaId, agente.sitioId,
      'Monitor CPU 5.25.5', JSON.stringify({ esperaSegundos: 30 })]
  );
  await sql.ejecutar(
    `INSERT INTO vinculos_monitores_telemetria (
       monitor_id,tenant_id,empresa_id,sitio_id,tipo_fuente,agente_id,regla_id
     ) VALUES (?,?,?,?,'regla_derivacion',?,?)`,
    [monitor.insertId, agente.tenantId, agente.empresaId, agente.sitioId,
      agente.id, regla.insertId]
  );
  const [trigger] = await sql.ejecutar(
    `INSERT INTO triggers (nombre,tipo,configuracion)
      VALUES (?,'email',?)`,
    ['Trigger 5.25.5', JSON.stringify({ plantilla: 'prueba' })]
  );
  await sql.ejecutar(
    `INSERT INTO asignaciones_triggers_monitores (monitor_id,trigger_id)
      VALUES (?,?)`,
    [monitor.insertId, trigger.insertId]
  );
  await sql.ejecutar(
    `INSERT INTO perfiles_servidor_agentes (
       agente_id,generacion,estado,histeresis_sin_pol_segundos,
       duracion_reinicio_reciente_segundos,generada_en_utc
     ) VALUES (?,1,'pendiente_primera_evidencia',120,300,UTC_TIMESTAMP(3))`,
    [agente.id]
  );
}

async function insertarObservaciones(sql, agente, cantidad) {
  const [senal] = await sql.consultar(
    'SELECT id FROM senales_telemetria_agentes WHERE agente_id=? LIMIT 1',
    [agente.id]
  );
  for (let indice = 0; indice < cantidad; indice += 1) {
    await sql.ejecutar(
      `INSERT INTO observaciones_telemetria_agentes (
         agente_id,senal_id,categoria,clave,tag,codigo_senal,tipo_dato,unidad,
         valor_numero,observado_en_utc,recibido_en_utc
       ) VALUES (?,?,?,?,?,?,'numero','%',?,UTC_TIMESTAMP(6),UTC_TIMESTAMP(6))`,
      [agente.id, senal.id, 'sistema', 'cpu.uso', '',
        'sistema.cpu.uso:global', indice % 100]
    );
  }
}

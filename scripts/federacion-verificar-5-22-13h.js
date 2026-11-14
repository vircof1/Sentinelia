import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { readFile } from 'node:fs/promises';

import { EmisorHeartbeatFederacionRuntime } from '../apps/sentinelia-runtime/src/federacion/EmisorHeartbeatFederacionRuntime.js';
import { SupervisorSaludFederacionRuntime } from '../apps/sentinelia-runtime/src/federacion/SupervisorSaludFederacionRuntime.js';
import { generarUuidV7Auditoria, uuidV7AuditoriaABytes } from '../paquetes/auditoria/src/UuidV7Auditoria.js';
import { RepositorioDestinosEmisionFederacionSql } from '../paquetes/federacion/adaptadores/RepositorioDestinosEmisionFederacionSql.js';
import { FuenteEntropiaCriptograficaNode } from '../paquetes/federacion/adaptadores/FuenteEntropiaCriptograficaNode.js';
import { RepositorioSaludFederacionSql } from '../paquetes/federacion/adaptadores/RepositorioSaludFederacionSql.js';
import { GeneradorIdentidadesFederadas, TIPOS_IDENTIDAD_FEDERADA } from '../paquetes/federacion/src/IdentidadFederada.js';
import { ClienteSql } from '../paquetes/persistencia-sql/src/ClienteSql.js';
import { EjecutorMigraciones } from '../paquetes/persistencia-sql/src/EjecutorMigraciones.js';
import { RepositorioMigraciones } from '../paquetes/persistencia-sql/src/RepositorioMigraciones.js';
import { obtenerConfiguracionAplicacion, obtenerRutaMigraciones } from '../paquetes/utilidades/src/configuracion/obtenerConfiguracionAplicacion.js';

const generador = new GeneradorIdentidadesFederadas({
  fuenteEntropia: new FuenteEntropiaCriptograficaNode()
});
const RELACION_ID = String(generador.generar(TIPOS_IDENTIDAD_FEDERADA.RELACION));
const INSTALACION_ID = String(generador.generar(TIPOS_IDENTIDAD_FEDERADA.INSTALACION));
const BOOT_ID = String(generador.generar(TIPOS_IDENTIDAD_FEDERADA.ARRANQUE));
const TOKEN = `sfop1_${'H'.repeat(64)}`;

await main();

async function main() {
  await verificarRegistroYMigracion();
  await verificarHeartbeatInactivoYSesion();
  await verificarAvisosIdempotentesYDimensiones();
  console.log(
    '[federacion] OK 5.22.13h: relacion=heartbeat_inactivo ' +
    'flujo=independiente estado_remoto=no_inferido avisos=idempotentes'
  );
}

async function verificarRegistroYMigracion() {
  const [repositorio] = await Promise.all([
    leer('../paquetes/federacion/adaptadores/RepositorioSaludFederacionSql.js')
  ]);
  assert.match(repositorio,
    /estadosRemotos:\s*Object\.freeze\(estadosRemotos\.map\(proyectarEstadoRemoto\)\)/u);
  assert.match(repositorio, /materializacionEstadoRemotoDisponible:\s*true/u);
  assert.match(repositorio, /comunicacion:\s*supervisable/u);

  const configuracion = obtenerConfiguracionAplicacion();
  assert.equal(configuracion.sql.estaCompleta, true);
  const baseDatos = `sentinelia_fixture_52213h_${randomBytes(6).toString('hex')}`;
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
    const tablas = await sql.consultar(
      `SELECT table_name FROM information_schema.tables
        WHERE table_schema=DATABASE() AND table_name IN (
          'actividad_emision_relaciones_federacion',
          'estados_diagnostico_relaciones_federacion'
        ) ORDER BY table_name`
    );
    assert.equal(tablas.length, 2);
    const causas = await sql.consultar(
      `SELECT gravedad_inicial FROM catalogo_causas_avisos_plataforma
        WHERE version_catalogo=2 AND tipo_codigo='compatibilidad'
          AND causa_codigo='version_federada_incompatible'`
    );
    assert.deepEqual(causas.map((fila) => fila.gravedad_inicial), ['advertencia']);
    await verificarPersistenciaSaludSql(sql);
  } finally {
    await sql.cerrar();
    await administrador.ejecutar(
      `DROP DATABASE IF EXISTS ${administrador.escaparIdentificador(baseDatos)}`
    ).catch(() => {});
    await administrador.cerrar();
  }
}

async function verificarPersistenciaSaludSql(sql) {
  await sql.ejecutar(
    'DELETE FROM actividad_emision_relaciones_federacion WHERE relacion_id=?',
    [RELACION_ID]
  );
  await sql.ejecutar(
    'DELETE FROM localizaciones_relaciones_federacion WHERE relacion_id=?',
    [RELACION_ID]
  );
  await sql.ejecutar('DELETE FROM relaciones_federacion WHERE relacion_id=?', [RELACION_ID]);
  try {
    await sql.ejecutar(
      `INSERT INTO relaciones_federacion (
         relacion_id,direccion,estado_ciclo,estado_autoridad,estado_identidad,
         estado_compatibilidad,installation_remota_candidata_id,
         installation_remota_id,nombre_remoto_declarado,responsable_usuario_id,
         responsable_original_usuario_id,scope_tenant_id,scope_empresa_id,
         scope_sitio_id,version_autoridad,corte_autoridad_utc,
         creada_por_usuario_id,creada_en_utc,actualizada_en_utc,revision
       ) VALUES (?,'emision','vinculada','autorizada','valida','compatible',?,?,
         'fixture 5.22.13h',5221308,5221308,NULL,NULL,NULL,1,NULL,5221308,
         UTC_TIMESTAMP(3),UTC_TIMESTAMP(3),1)`,
      [RELACION_ID, INSTALACION_ID, INSTALACION_ID]
    );
    await sql.ejecutar(
      `INSERT INTO localizaciones_relaciones_federacion (
         localizacion_id,relacion_id,endpoint_https,estado,
         relacion_localizacion_activa,origen_propuesta,
         propuesta_por_usuario_id,aprobada_por_usuario_id,
         propuesta_en_utc,aprobada_en_utc,finalizada_en_utc,
         evento_auditoria_id,correlacion_id
       ) VALUES (?,?,'https://fixture-13h.example','activa',?,
         'configuracionLocal',5221308,5221308,UTC_TIMESTAMP(3),UTC_TIMESTAMP(3),
         NULL,?,?)`,
      [uuidV7AuditoriaABytes(generarUuidV7Auditoria()), RELACION_ID, RELACION_ID,
        uuidV7AuditoriaABytes(generarUuidV7Auditoria()),
        uuidV7AuditoriaABytes(generarUuidV7Auditoria())]
    );
    const repositorio = new RepositorioSaludFederacionSql(sql);
    const sesionId = generarUuidV7Auditoria();
    await repositorio.registrarHeartbeatEmisor({
      relacionId: RELACION_ID,
      sesionId,
      seq: '1',
      compatibilidad: 'compatible',
      exito: true
    });
    await repositorio.registrarHeartbeatEmisor({
      relacionId: RELACION_ID,
      exito: false,
      codigoError: 'transporte_federado_no_disponible'
    });
    const [actividad] = await sql.consultar(
      `SELECT ultima_actividad_autenticada_utc,fallos_consecutivos,
              ultimo_error_codigo,compatibilidad_remota
         FROM actividad_emision_relaciones_federacion WHERE relacion_id=?`,
      [RELACION_ID]
    );
    assert.ok(actividad.ultima_actividad_autenticada_utc);
    assert.equal(Number(actividad.fallos_consecutivos), 1);
    assert.equal(actividad.ultimo_error_codigo, 'transporte_federado_no_disponible');
    assert.equal(actividad.compatibilidad_remota, 'compatible');
    const activa = (await repositorio.obtenerFotografia({
      silencioRelacionMs: 5000
    })).relaciones.find((relacion) => relacion.relacionId === RELACION_ID);
    assert.equal(activa.comunicacion, 'activa');
    await sql.ejecutar(
      `UPDATE actividad_emision_relaciones_federacion
          SET ultima_actividad_autenticada_utc=TIMESTAMPADD(SECOND,-10,UTC_TIMESTAMP(3))
        WHERE relacion_id=?`,
      [RELACION_ID]
    );
    const fotografia = await repositorio.obtenerFotografia({ silencioRelacionMs: 5000 });
    assert.equal(fotografia.relaciones.find(
      (relacion) => relacion.relacionId === RELACION_ID
    ).comunicacion, 'silenciosa');
    assert.deepEqual(fotografia.estadosRemotos, []);
    const destinos = new RepositorioDestinosEmisionFederacionSql(sql);
    assert.equal((await destinos.obtenerAprobadoOperativo({
      relacionId: RELACION_ID
    })).relacionId, RELACION_ID);
    await repositorio.registrarHeartbeatEmisor({
      relacionId: RELACION_ID,
      sesionId,
      seq: '2',
      compatibilidad: 'incompatible',
      exito: true
    });
    await assert.rejects(
      destinos.obtenerAprobadoOperativo({ relacionId: RELACION_ID }),
      (error) => error.codigo === 'destino_emision_no_operativo'
    );
    assert.equal((await destinos.obtenerVinculadoAutenticable({
      relacionId: RELACION_ID
    })).relacionId, RELACION_ID);
  } finally {
    await sql.ejecutar(
      'DELETE FROM actividad_emision_relaciones_federacion WHERE relacion_id=?',
      [RELACION_ID]
    ).catch(() => {});
    await sql.ejecutar(
      'DELETE FROM localizaciones_relaciones_federacion WHERE relacion_id=?',
      [RELACION_ID]
    ).catch(() => {});
    await sql.ejecutar('DELETE FROM relaciones_federacion WHERE relacion_id=?', [RELACION_ID])
      .catch(() => {});
  }
}

async function verificarHeartbeatInactivoYSesion() {
  let ahora = Date.parse('2026-08-03T08:00:00.000Z');
  let sesion = { sesionId: generarUuidV7Auditoria(), token: TOKEN };
  const solicitudes = [];
  const persistencias = [];
  const invalidaciones = [];
  let fallar = false;
  const emisor = new EmisorHeartbeatFederacionRuntime({
    repositorioDestinos: {
      async listarVinculadosAutenticables() { return [{ relacionId: RELACION_ID }]; }
    },
    gestorSesiones: {
      async obtenerSesion() { return sesion; },
      async invalidar(entrada) { invalidaciones.push(entrada); return true; }
    },
    servicioCliente: {
      async registrarHeartbeat({ solicitud }) {
        solicitudes.push(solicitud);
        if (fallar) {
          const error = new Error('caída simulada');
          error.codigo = 'transporte_federado_no_disponible';
          throw error;
        }
        return {
          ok: true,
          heartbeatRequestId: solicitud.heartbeatRequestId,
          seq: solicitud.seq,
          presenciaTtlSeconds: 90,
          relacion: {
            relacionId: solicitud.relacionId,
            estado: 'vinculada',
            compatibilidad: 'compatible',
            temporal: {
              estado: 'pendiente',
              desfaseEstimadoMs: null,
              rttEstimadoMs: null,
              toleranciaTemporalMs: 5000
            }
          },
          muestraTemporal: {
            muestraId: generarUuidV7Auditoria(),
            clienteEnviaEnUtc: solicitud.clienteEnviaEnUtc,
            servidorRecibeEnUtc: new Date(ahora).toISOString(),
            servidorEnviaEnUtc: new Date(ahora).toISOString()
          }
        };
      }
    },
    repositorioSalud: {
      async registrarHeartbeatEmisor(entrada) { persistencias.push(entrada); }
    },
    bootLocalId: BOOT_ID,
    reloj: () => new Date(ahora)
  });

  const desactivado = await emisor.ejecutar({
    silencioRelacionMs: 120000,
    activacionFederacion: false
  });
  assert.equal(desactivado.omitido, true);
  assert.equal(solicitudes.length, 0, 'El gate global impide incluso autenticar el heartbeat.');

  assert.equal((await emisor.ejecutar({ silencioRelacionMs: 120000 })).totalExitosas, 1);
  assert.equal(solicitudes[0].seq, '1');
  assert.equal(solicitudes[0].muestraTemporalAnterior, null);
  ahora += 40_000;
  await emisor.ejecutar({ silencioRelacionMs: 120000 });
  assert.equal(solicitudes[1].seq, '2');
  assert.equal(solicitudes[1].muestraTemporalAnterior.clienteRecibeEnUtc,
    '2026-08-03T08:00:00.000Z');

  sesion = { sesionId: generarUuidV7Auditoria(), token: TOKEN };
  ahora += 40_000;
  await emisor.ejecutar({ silencioRelacionMs: 120000 });
  assert.equal(solicitudes[2].seq, '1');
  assert.equal(solicitudes[2].muestraTemporalAnterior, null);

  fallar = true;
  ahora += 40_000;
  const fallo = await emisor.ejecutar({ silencioRelacionMs: 120000 });
  assert.equal(fallo.totalFallidas, 1);
  assert.equal(persistencias.at(-1).exito, false);
  assert.equal(persistencias.at(-2).exito, true);
  assert.equal(invalidaciones.length, 0, 'Un fallo de transporte no invalida el bearer.');

  fallar = false;
  ahora += 40_000;
  const rechazo = new Error('Sesión remota perdida.');
  rechazo.statusCode = 403;
  rechazo.codigoRemoto = 'SESION_FEDERADA_NO_VIVA';
  const registrarHeartbeatOriginal = emisor.servicioCliente.registrarHeartbeat;
  emisor.servicioCliente.registrarHeartbeat = async () => { throw rechazo; };
  assert.equal((await emisor.ejecutar({ silencioRelacionMs: 120000 })).totalFallidas, 1);
  assert.deepEqual(invalidaciones, [{
    relacionId: RELACION_ID,
    sesionId: sesion.sesionId,
    token: sesion.token
  }]);
  emisor.servicioCliente.registrarHeartbeat = registrarHeartbeatOriginal;
}

async function verificarAvisosIdempotentesYDimensiones() {
  const relacion = {
    relacionId: RELACION_ID,
    installationRemotaId: INSTALACION_ID,
    nombreRemoto: 'Instancia B',
    scope: { tenantId: null, empresaId: null, sitioId: null },
    comunicacion: 'silenciosa',
    silencioMs: 130000,
    compatibilidad: 'incompatible'
  };
  const estados = new Map();
  const confirmados = new Set();
  const avisos = [];
  let relojSupervisor = 0;
  const repositorioSalud = {
    async obtenerFotografia() {
      return {
        relaciones: [relacion],
        flujos: [{ flujoId: 'flujo-fixture', salud: 'conBacklog' }],
        estadosRemotos: [],
        materializacionEstadoRemotoDisponible: false
      };
    },
    async prepararTransicionDiagnostico(entrada) {
      const clave = `${entrada.versionCatalogo}:${entrada.causaCodigo}`;
      const anterior = estados.get(clave);
      if (anterior?.activa === entrada.activa && confirmados.has(anterior.eventoId)) return null;
      if (!anterior && !entrada.activa) return null;
      if (anterior && !confirmados.has(anterior.eventoId)) return anterior;
      const transicion = {
        activa: entrada.activa,
        eventoId: entrada.generarEventoId(),
        efectivoEnUtc: '2026-08-03T08:05:00.000Z',
        repetida: false
      };
      estados.set(clave, transicion);
      return transicion;
    },
    async confirmarTransicionDiagnostico({ eventoId }) { confirmados.add(eventoId); }
  };
  const supervisor = new SupervisorSaludFederacionRuntime({
    repositorioSalud,
    servicioAvisos: {
      async detectar(entrada) { avisos.push({ operacion: 'detectar', entrada }); },
      async resolver(entrada) { avisos.push({ operacion: 'resolver', entrada }); }
    },
    resolverConfiguracion: async () => ({
      silencioRelacionMs: 120000,
      consolidacionReinicioMs: 60000
    }),
    reloj: () => relojSupervisor
  });

  const primera = await supervisor.evaluar();
  assert.equal(primera.fotografia.flujos[0].salud, 'conBacklog');
  assert.deepEqual(primera.fotografia.estadosRemotos, []);
  assert.equal(primera.consolidandoReinicio, true);
  assert.equal(primera.totalAperturas, 1);
  assert.equal(avisos[0].entrada.claveCausal.causaCodigo,
    'version_federada_incompatible');
  relojSupervisor = 60001;
  const consolidada = await supervisor.evaluar();
  assert.equal(consolidada.consolidandoReinicio, false);
  assert.equal(consolidada.totalAperturas, 1);
  assert.deepEqual(avisos.map((aviso) => aviso.entrada.claveCausal.causaCodigo).sort(), [
    'relacion_silenciosa', 'version_federada_incompatible'
  ]);
  assert.equal((await supervisor.evaluar()).totalTransiciones, 0);
  assert.equal(avisos.length, 2, 'Una condición estable no confirma el aviso repetidamente.');

  supervisor.resolverConfiguracion = async () => ({
    activacionFederacion: false,
    silencioRelacionMs: 120000,
    consolidacionReinicioMs: 60000
  });
  const desactivada = await supervisor.evaluar();
  assert.equal(desactivada.federacionActivada, false);
  assert.equal(desactivada.totalResoluciones, 2);
  assert.equal(avisos.filter((aviso) => aviso.operacion === 'resolver').length, 2);

  relacion.supervisable = false;
  relacion.comunicacion = 'no_aplicable';
  relacion.compatibilidad = 'no_aplicable';
  const recuperada = await supervisor.evaluar();
  assert.equal(recuperada.totalResoluciones, 0);
  assert.equal(avisos.filter((aviso) => aviso.operacion === 'resolver').length, 2);
  assert.ok(avisos.every((aviso) => aviso.entrada.claveCausal.objetoTipo === 'relacion_federada'));
}

function leer(ruta) {
  return readFile(new URL(ruta, import.meta.url), 'utf8');
}

import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { readFile } from 'node:fs/promises';

import { AdaptadorAuditoriaAvisosPlataforma } from '../paquetes/avisos-plataforma/src/AdaptadorAuditoriaAvisosPlataforma.js';
import { RepositorioAvisosPlataformaSql } from '../paquetes/avisos-plataforma/src/RepositorioAvisosPlataformaSql.js';
import { ServicioAvisosPlataforma } from '../paquetes/avisos-plataforma/src/ServicioAvisosPlataforma.js';
import { RepositorioAuditoria } from '../paquetes/auditoria/src/RepositorioAuditoria.js';
import { AdaptadorMonitoresFederacion } from '../paquetes/federacion/adaptadores/AdaptadorMonitoresFederacion.js';
import { RepositorioMonitoresRemotoSql } from '../paquetes/federacion/adaptadores/RepositorioMonitoresRemotoSql.js';
import { RepositorioSaludFederacionSql } from '../paquetes/federacion/adaptadores/RepositorioSaludFederacionSql.js';
import { AdaptadorAuditoriaTiempoEstadosRemotos } from '../paquetes/federacion/adaptadores/AdaptadorAuditoriaTiempoEstadosRemotos.js';
import { RepositorioTiempoEstadosRemotosSql } from '../paquetes/federacion/adaptadores/RepositorioTiempoEstadosRemotosSql.js';
import { ProcesadorTiempoEstadosRemotos } from '../paquetes/federacion/aplicacion/ProcesadorTiempoEstadosRemotos.js';
import { TIPOS_IDENTIDAD_FEDERADA } from '../paquetes/federacion/src/IdentidadFederada.js';
import { PERFIL_PAYLOAD_MONITORES_FEDERACION } from '../paquetes/federacion/src/PayloadMonitoresFederacion.js';
import { ClienteSql } from '../paquetes/persistencia-sql/src/ClienteSql.js';
import { obtenerConfiguracionAplicacion } from '../paquetes/utilidades/src/configuracion/obtenerConfiguracionAplicacion.js';
import { SupervisorSaludFederacionRuntime } from '../apps/sentinelia-runtime/src/federacion/SupervisorSaludFederacionRuntime.js';
import {
  contextoCierre,
  crearElemento,
  id,
  materializar,
  migrar,
  publicarHasta,
  recibirYReclamar
} from './federacion-verificar-5-22-15g.js';

await main();

async function main() {
  await verificarRegistroDocumental();
  const configuracion = obtenerConfiguracionAplicacion();
  assert.equal(configuracion.sql.estaCompleta, true);
  const baseDatos = `sentinelia_fixture_52216b_${randomBytes(6).toString('hex')}`;
  const administrador = new ClienteSql(configuracion.sql);
  let sql;
  try {
    await administrador.ejecutar(
      `CREATE DATABASE ${administrador.escaparIdentificador(baseDatos)} CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`
    );
    sql = new ClienteSql({ ...configuracion.sql, baseDatos });
    await migrar(sql);
    await verificarSchedulerDurable(sql);
  } finally {
    await sql?.cerrar().catch(() => {});
    await administrador.ejecutar(
      `DROP DATABASE IF EXISTS ${administrador.escaparIdentificador(baseDatos)}`
    ).catch(() => {});
    await administrador.cerrar();
  }
  console.log(
    '[federacion] OK 5.22.16b: scheduler=durable consolidacion=post_rehidratacion ' +
    'ttl=causal aviso=idempotente salud=materializada auditoria=canonica ' +
    'recuperacion=sin_replay efectos_locales=ninguno'
  );
}

async function verificarRegistroDocumental() {
  const runtime = await leer('../apps/sentinelia-runtime/src/RuntimeSentinelia.js');
  assert.match(runtime, /marcarRehidratacionCompleta/u);
}

async function verificarSchedulerDurable(sql) {
  await sql.ejecutar(
    `INSERT INTO configuracion_portal (
       clave,valor,tipo_dato,descripcion,creado_automaticamente
     ) VALUES ('federacion.ttl_estado_operativo_ms','60000','entero',
       'Fixture de vigencia receptora',1)`
  );
  const repositorioMonitores = new RepositorioMonitoresRemotoSql(sql);
  const adaptador = new AdaptadorMonitoresFederacion({
    repositorioRemoto: repositorioMonitores
  });
  const repositorioTiempo = new RepositorioTiempoEstadosRemotosSql(sql, {
    adaptadorAuditoria: new AdaptadorAuditoriaTiempoEstadosRemotos({
      repositorioAuditoria: new RepositorioAuditoria(sql),
      installationLocalId: id(TIPOS_IDENTIDAD_FEDERADA.INSTALACION)
    })
  });
  const procesador = new ProcesadorTiempoEstadosRemotos({
    repositorioTiempo,
    repositorioMonitoresRemotos: repositorioMonitores
  });
  await assert.rejects(
    procesador.procesar(),
    /no comienza antes de completar la rehidratación/iu
  );

  const installationRemotaId = id(TIPOS_IDENTIDAD_FEDERADA.INSTALACION);
  const monitorOrigenId = id(TIPOS_IDENTIDAD_FEDERADA.ELEMENTO_ORIGEN);
  const elemento = await crearElemento({
    sql,
    adaptador,
    installationRemotaId,
    elementoOrigenId: id(TIPOS_IDENTIDAD_FEDERADA.ELEMENTO_ORIGEN),
    payload: payloadEstado({
      monitorOrigenId,
      estado: 'fallo',
      vigenteHastaOrigenUtc: new Date(Date.now() - 1_000).toISOString()
    }),
    familia: 'monitores',
    versionFamilia: 1,
    vigenciaRestanteMs: '120000'
  });

  const bootConMargen = id(TIPOS_IDENTIDAD_FEDERADA.ARRANQUE);
  const ciclo = await procesador.iniciarTrasRehidratacion({
    bootId: bootConMargen,
    consolidacionReinicioMs: 60_000
  });
  assert.equal(ciclo.estado, 'abierto');
  const consolidacion = await procesador.procesar();
  assert.equal(consolidacion.totalTransiciones, 1);
  let [estado] = await repositorioTiempo.listarEstados();
  assert.equal(estado.condicion, 'consolidando');
  assert.equal(estado.avisoVencimientoActivo, false);
  assert.equal((await procesador.procesar()).totalTransiciones, 0);

  const bootSinMargen = id(TIPOS_IDENTIDAD_FEDERADA.ARRANQUE);
  const procesadorReiniciado = new ProcesadorTiempoEstadosRemotos({
    repositorioTiempo,
    repositorioMonitoresRemotos: repositorioMonitores
  });
  await procesadorReiniciado.iniciarTrasRehidratacion({
    bootId: bootSinMargen,
    consolidacionReinicioMs: 0
  });
  const vencimiento = await procesadorReiniciado.procesar();
  assert.equal(vencimiento.ciclo.estado, 'cerrado');
  assert.equal(vencimiento.totalTransiciones, 1);
  [estado] = await repositorioTiempo.listarEstados();
  assert.equal(estado.condicion, 'vencida');
  assert.equal(estado.avisoVencimientoActivo, true);
  assert.ok(Date.parse(estado.efectivoEnUtc) < Date.parse(estado.materializadoEnUtc));

  const servicioAvisos = new ServicioAvisosPlataforma({
    repositorioAvisos: new RepositorioAvisosPlataformaSql(sql, {
      adaptadorAuditoria: new AdaptadorAuditoriaAvisosPlataforma({
        repositorioAuditoria: new RepositorioAuditoria(sql)
      })
    })
  });
  const salud = repositorioSaludFixture(elemento.ids);
  const supervisor = new SupervisorSaludFederacionRuntime({
    repositorioSalud: salud.repositorio,
    servicioAvisos,
    procesadorTiempoEstadosRemotos: procesadorReiniciado,
    resolverConfiguracion: async () => ({
      activacionFederacion: true,
      silencioRelacionMs: 120000,
      consolidacionReinicioMs: 60_000
    })
  });
  await supervisor.marcarRehidratacionCompleta({ bootId: bootSinMargen });
  const apertura = await supervisor.evaluar();
  assert.equal(apertura.tiempoEstadosRemotos.ciclo.estado, 'cerrado');
  assert.equal(apertura.consolidandoReinicio, false);
  assert.equal(apertura.avisosEstadosRemotos.length, 1);
  assert.equal(apertura.avisosEstadosRemotos[0].operacion, 'detectar');
  assert.equal(apertura.totalAperturas, 1);
  assert.equal(apertura.resultados[0].causaCodigo, 'relacion_silenciosa');
  salud.relacion.ultimaComunicacionUtc = new Date(Date.now() + 1_000).toISOString();
  const comunicada = await supervisor.evaluar();
  assert.equal(comunicada.avisosEstadosRemotos.length, 0);
  assert.equal(comunicada.totalResoluciones, 1);

  await sql.ejecutar(
    `UPDATE relaciones_federacion
        SET estado_autoridad='sinAutoridad',version_autoridad=version_autoridad+1,
            corte_autoridad_utc=UTC_TIMESTAMP(3),actualizada_en_utc=UTC_TIMESTAMP(3),
            revision=revision+1
      WHERE relacion_id=?`,
    [elemento.ids.relacionId]
  );
  const sustituidaPorPerdidaAutoridad = await supervisor.evaluar();
  assert.equal(sustituidaPorPerdidaAutoridad.avisosEstadosRemotos.length, 1);
  assert.equal(
    sustituidaPorPerdidaAutoridad.avisosEstadosRemotos[0].operacion,
    'resolver',
    'Un vencimiento deja de ser la incidencia vigente cuando lo sustituye la pérdida de autoridad.'
  );
  [estado] = await repositorioTiempo.listarEstados();
  assert.equal(estado.condicion, 'noAutorizada');
  assert.equal(estado.avisoVencimientoActivo, false);
  await sql.ejecutar(
    `UPDATE relaciones_federacion
        SET estado_autoridad='autorizada',version_autoridad=version_autoridad+1,
            corte_autoridad_utc=NULL,actualizada_en_utc=UTC_TIMESTAMP(3),
            revision=revision+1
      WHERE relacion_id=?`,
    [elemento.ids.relacionId]
  );
  assert.equal((await supervisor.evaluar()).tiempoEstadosRemotos.totalTransiciones, 0);

  const segundo = payloadEstado({
    monitorOrigenId,
    estado: 'vivo',
    vigenteHastaOrigenUtc: new Date(Date.now() + 5 * 60_000).toISOString()
  });
  const trabajoSegundo = await recibirYReclamar({
    sql,
    contexto: elemento,
    secuencia: 2,
    operacion: 'actualizacion',
    payload: segundo,
    familia: 'monitores',
    versionFamilia: 1,
    vigenciaRestanteMs: '120000'
  });
  await materializar({ sql, adaptador, trabajo: trabajoSegundo, payload: segundo });
  await elemento.cicloTrabajos.completar(contextoCierre(trabajoSegundo));
  await publicarHasta(sql, elemento.ids.proyeccionId, elemento.ids.generacionId, '2');

  const recuperacion = await supervisor.evaluar();
  assert.equal(recuperacion.tiempoEstadosRemotos.totalTransiciones, 1);
  assert.equal(recuperacion.avisosEstadosRemotos.length, 0);
  [estado] = await repositorioTiempo.listarEstados();
  assert.equal(estado.condicion, 'vigente');
  assert.equal(estado.secuenciaElemento, '2');
  assert.equal(estado.avisoVencimientoActivo, false);
  assert.equal((await supervisor.evaluar()).tiempoEstadosRemotos.totalTransiciones, 0);

  await sql.ejecutar(
    `UPDATE relaciones_federacion
        SET estado_autoridad='sinAutoridad',version_autoridad=version_autoridad+1,
            corte_autoridad_utc=UTC_TIMESTAMP(3),actualizada_en_utc=UTC_TIMESTAMP(3),
            revision=revision+1
      WHERE relacion_id=?`,
    [elemento.ids.relacionId]
  );
  await supervisor.evaluar();
  [estado] = await repositorioTiempo.listarEstados();
  assert.equal(estado.condicion, 'noAutorizada');
  await sql.ejecutar(
    `UPDATE relaciones_federacion
        SET estado_autoridad='autorizada',version_autoridad=version_autoridad+1,
            corte_autoridad_utc=NULL,actualizada_en_utc=UTC_TIMESTAMP(3),
            revision=revision+1
      WHERE relacion_id=?`,
    [elemento.ids.relacionId]
  );
  assert.equal((await supervisor.evaluar()).tiempoEstadosRemotos.totalTransiciones, 0);
  [estado] = await repositorioTiempo.listarEstados();
  assert.equal(
    estado.condicion,
    'noAutorizada',
    'Recuperar autoridad no rehabilita la misma fotografía.'
  );
  const fotografiaSalud = await new RepositorioSaludFederacionSql(sql)
    .obtenerFotografia({ silencioRelacionMs: 120_000 });
  const estadoEnSalud = fotografiaSalud.estadosRemotos.find(
    (candidato) => candidato.proyeccionId === elemento.ids.proyeccionId
  );
  assert.equal(fotografiaSalud.materializacionEstadoRemotoDisponible, true);
  assert.equal(estadoEnSalud.condicion, 'noAutorizada');
  assert.equal(estadoEnSalud.secuenciaElemento, '2');
  assert.equal(estadoEnSalud.installationOrigenId, installationRemotaId);

  elemento.ids.ocurrencias.push(
    id(TIPOS_IDENTIDAD_FEDERADA.OCURRENCIA_ORIGEN),
    id(TIPOS_IDENTIDAD_FEDERADA.OCURRENCIA_ORIGEN)
  );
  elemento.ids.entregas.push(
    id(TIPOS_IDENTIDAD_FEDERADA.ENTREGA),
    id(TIPOS_IDENTIDAD_FEDERADA.ENTREGA)
  );
  const tercero = payloadEstado({
    monitorOrigenId,
    estado: 'vivo',
    vigenteHastaOrigenUtc: new Date(Date.now() + 5 * 60_000).toISOString()
  });
  const trabajoTercero = await recibirYReclamar({
    sql,
    contexto: elemento,
    secuencia: 3,
    operacion: 'actualizacion',
    payload: tercero,
    familia: 'monitores',
    versionFamilia: 1,
    vigenciaRestanteMs: '120000'
  });
  await materializar({ sql, adaptador, trabajo: trabajoTercero, payload: tercero });
  await elemento.cicloTrabajos.completar(contextoCierre(trabajoTercero));
  await publicarHasta(sql, elemento.ids.proyeccionId, elemento.ids.generacionId, '3');
  assert.equal((await supervisor.evaluar()).tiempoEstadosRemotos.totalTransiciones, 1);
  [estado] = await repositorioTiempo.listarEstados();
  assert.equal(estado.condicion, 'vigente');

  const trabajoRetirada = await recibirYReclamar({
    sql,
    contexto: elemento,
    secuencia: 4,
    operacion: 'retirada',
    payload: null,
    familia: 'monitores',
    versionFamilia: 1,
    vigenciaRestanteMs: null
  });
  await materializar({
    sql,
    adaptador,
    trabajo: trabajoRetirada,
    payload: null,
    operacion: 'retirada'
  });
  await elemento.cicloTrabajos.completar(contextoCierre(trabajoRetirada));
  await publicarHasta(sql, elemento.ids.proyeccionId, elemento.ids.generacionId, '4');
  await despublicarRetirada(sql, elemento.ids);
  const retirada = await supervisor.evaluar();
  assert.equal(retirada.tiempoEstadosRemotos.totalTransiciones, 1);
  assert.equal(retirada.tiempoEstadosRemotos.transiciones[0].causa, 'fuente_retirada');
  [estado] = await repositorioTiempo.listarEstados();
  assert.equal(estado.condicion, 'retirada');
  assert.equal((await supervisor.evaluar()).tiempoEstadosRemotos.totalTransiciones, 0);

  const retiradaSinFotografia = await crearElemento({
    sql,
    adaptador,
    installationRemotaId,
    elementoOrigenId: id(TIPOS_IDENTIDAD_FEDERADA.ELEMENTO_ORIGEN),
    payload: payloadDefinicion(),
    familia: 'monitores',
    versionFamilia: 1,
    vigenciaRestanteMs: null
  });
  const trabajoRetiradaTemprana = await recibirYReclamar({
    sql,
    contexto: retiradaSinFotografia,
    secuencia: 2,
    operacion: 'retirada',
    payload: null,
    familia: 'monitores',
    versionFamilia: 1,
    vigenciaRestanteMs: null
  });
  await materializar({
    sql,
    adaptador,
    trabajo: trabajoRetiradaTemprana,
    payload: null,
    operacion: 'retirada'
  });
  await retiradaSinFotografia.cicloTrabajos.completar(
    contextoCierre(trabajoRetiradaTemprana)
  );
  await publicarHasta(
    sql,
    retiradaSinFotografia.ids.proyeccionId,
    retiradaSinFotografia.ids.generacionId,
    '2'
  );
  await despublicarRetirada(sql, retiradaSinFotografia.ids);
  const retiradaTemprana = await supervisor.evaluar();
  const transicionTemprana = retiradaTemprana.tiempoEstadosRemotos.transiciones
    .find((item) => item.proyeccionId === retiradaSinFotografia.ids.proyeccionId);
  assert.equal(transicionTemprana?.causa, 'fuente_retirada');
  const estadoRetiradoSinFotografia = (await repositorioTiempo.listarEstados())
    .find((item) => item.proyeccionId === retiradaSinFotografia.ids.proyeccionId);
  assert.equal(estadoRetiradoSinFotografia?.condicion, 'retirada');
  assert.equal(estadoRetiradoSinFotografia?.secuenciaElemento, null);
  const saludRetiradaTemprana = await new RepositorioSaludFederacionSql(sql)
    .obtenerFotografia({ silencioRelacionMs: 120_000 });
  const retiradaTempranaVisible = saludRetiradaTemprana.estadosRemotos.find(
    (item) => item.proyeccionId === retiradaSinFotografia.ids.proyeccionId
  );
  assert.equal(retiradaTempranaVisible?.condicion, 'retirada');
  assert.equal(retiradaTempranaVisible?.secuenciaElemento, null);
  assert.equal(retiradaTempranaVisible?.monitorOrigenId, null);

  const estadoParaSustitucion = await crearElemento({
    sql,
    adaptador,
    installationRemotaId,
    elementoOrigenId: id(TIPOS_IDENTIDAD_FEDERADA.ELEMENTO_ORIGEN),
    payload: payloadEstado({
      monitorOrigenId: id(TIPOS_IDENTIDAD_FEDERADA.ELEMENTO_ORIGEN),
      estado: 'vivo',
      vigenteHastaOrigenUtc: new Date(Date.now() + 5 * 60_000).toISOString()
    }),
    familia: 'monitores',
    versionFamilia: 1,
    vigenciaRestanteMs: '120000'
  });
  assert.equal((await supervisor.evaluar()).tiempoEstadosRemotos.totalTransiciones, 1);
  const generacionRetiradaSustituta = await sustituirPorGeneracionRetiradaSinFotografia(
    sql,
    estadoParaSustitucion.ids
  );
  const sustitucionRetirada = await supervisor.evaluar();
  const transicionSustituta = sustitucionRetirada.tiempoEstadosRemotos.transiciones
    .find((item) => item.proyeccionId === estadoParaSustitucion.ids.proyeccionId);
  assert.equal(transicionSustituta?.causa, 'fuente_retirada');
  const estadoRetiradoSustituto = (await repositorioTiempo.listarEstados())
    .find((item) => item.proyeccionId === estadoParaSustitucion.ids.proyeccionId);
  assert.equal(estadoRetiradoSustituto?.generacionId, generacionRetiradaSustituta);
  assert.equal(estadoRetiradoSustituto?.condicion, 'retirada');
  assert.equal(estadoRetiradoSustituto?.secuenciaElemento, null);
  assert.equal((await supervisor.evaluar()).tiempoEstadosRemotos.totalTransiciones, 0);

  const auditoriaTemporal = await sql.consultar(
    `SELECT tipo_evento,COUNT(*) AS total FROM eventos_auditoria
      WHERE tipo_evento IN (
        'federacion.consolidacion_estados_remotos_iniciada',
        'federacion.consolidacion_estados_remotos_finalizada',
        'federacion.estado_temporal_remoto_cambiado'
      ) GROUP BY tipo_evento`
  );
  assert.deepEqual(
    new Set(auditoriaTemporal.map((fila) => fila.tipo_evento)),
    new Set([
      'federacion.consolidacion_estados_remotos_iniciada',
      'federacion.consolidacion_estados_remotos_finalizada',
      'federacion.estado_temporal_remoto_cambiado'
    ])
  );

  const [avisos] = await sql.consultar(
    `SELECT estado_ciclo,contador_detecciones
       FROM avisos_plataforma
      WHERE causa_codigo='estado_remoto_vencido'`
  );
  assert.equal(avisos.estado_ciclo, 'resuelto');
  assert.equal(Number(avisos.contador_detecciones), 1);
  const [locales] = await sql.consultar(
    `SELECT
       (SELECT COUNT(*) FROM eventos_monitores) AS eventos,
       (SELECT COUNT(*) FROM alertas_activas_monitores) AS alertas,
       (SELECT COUNT(*) FROM ejecuciones_triggers) AS triggers`
  );
  assert.deepEqual(
    Object.fromEntries(Object.entries(locales).map(([clave, valor]) => [clave, Number(valor)])),
    { eventos: 0, alertas: 0, triggers: 0 }
  );
}

function repositorioSaludFixture(ids) {
  const estados = new Map();
  const relacion = {
    relacionId: ids.relacionId,
    installationRemotaId: ids.installationRemotaId,
    nombreRemoto: 'Instancia remota temporal',
    scope: { tenantId: '10', empresaId: '20', sitioId: null },
    supervisable: true,
    comunicacion: 'activa',
    compatibilidad: 'compatible',
    ultimaComunicacionUtc: null
  };
  return { relacion, repositorio: {
    async obtenerFotografia() {
      return {
        relaciones: [relacion],
        flujos: [],
        estadosRemotos: [],
        materializacionEstadoRemotoDisponible: true
      };
    },
    async prepararTransicionDiagnostico(entrada) {
      const clave = `${entrada.versionCatalogo}:${entrada.causaCodigo}`;
      const anterior = estados.get(clave);
      if (!anterior && !entrada.activa) return null;
      if (anterior?.activa === entrada.activa && anterior.confirmada) return null;
      if (anterior && !anterior.confirmada) return anterior;
      const transicion = {
        activa: entrada.activa,
        eventoId: entrada.generarEventoId(),
        efectivoEnUtc: new Date(Date.now() - 1_000).toISOString(),
        repetida: false,
        confirmada: false
      };
      estados.set(clave, transicion);
      return transicion;
    },
    async confirmarTransicionDiagnostico({ versionCatalogo, causaCodigo }) {
      estados.get(`${versionCatalogo}:${causaCodigo}`).confirmada = true;
    }
  } };
}

function payloadEstado({ monitorOrigenId, estado, vigenteHastaOrigenUtc }) {
  const instante = new Date(Math.min(
    Date.now(),
    Date.parse(vigenteHastaOrigenUtc) - 1_000
  )).toISOString();
  return {
    perfil: PERFIL_PAYLOAD_MONITORES_FEDERACION,
    version: 1,
    tipoRegistro: 'estadoActual',
    monitorOrigenId,
    versionCatalogo: 'beta-1',
    estado,
    ejecutadoTodavia: true,
    fechaUltimaEjecucionUtc: instante,
    fechaUltimoCambioUtc: instante,
    motivoInicial: 'ejecutado',
    resultadoActual: { codigo: estado },
    contextoHumano: {
      descripcionFallo: 'Estado remoto temporal',
      posibleSolucion: 'Revisar comunicación con el origen'
    },
    vigenteHastaOrigenUtc
  };
}

function payloadDefinicion() {
  return {
    perfil: PERFIL_PAYLOAD_MONITORES_FEDERACION,
    version: 1,
    tipoRegistro: 'definicion',
    nombre: 'Monitor retirado antes del primer tick',
    tipo: 'ping',
    descripcion: 'Fixture sin fotografía operativa',
    activo: true,
    intervaloEjecucionSegundos: 60,
    desfaseInicialSegundos: 0,
    interpretacionEstado: 'normal',
    configuracionOperativa: { host: 'fixture.invalid' },
    contextoHumano: {
      descripcionFallo: 'No aplica',
      posibleSolucion: 'No aplica'
    },
    scopeOrganizativo: {
      tenantElementoOrigenId: id(TIPOS_IDENTIDAD_FEDERADA.ELEMENTO_ORIGEN),
      empresaElementoOrigenId: id(TIPOS_IDENTIDAD_FEDERADA.ELEMENTO_ORIGEN),
      sitioElementoOrigenId: null
    },
    credencialPropia: { estado: 'omitida', causa: 'noExiste' },
    referenciasOperativas: []
  };
}

async function despublicarRetirada(sql, ids) {
  await sql.ejecutar(
    `DELETE FROM estados_actuales_proyecciones_federacion
      WHERE proyeccion_id=? AND generacion_actual_id=?`,
    [ids.proyeccionId, ids.generacionId]
  );
  await sql.ejecutar(
    `UPDATE versiones_proyecciones_federacion
        SET estado_publicacion='preparando',estado_vigencia='retirada',
            publicada_en_utc=NULL,version_estado=version_estado+1,
            actualizada_en_utc=UTC_TIMESTAMP(3)
      WHERE proyeccion_id=? AND generacion_id=?`,
    [ids.proyeccionId, ids.generacionId]
  );
}

async function sustituirPorGeneracionRetiradaSinFotografia(sql, ids) {
  const generacionId = id(TIPOS_IDENTIDAD_FEDERADA.GENERACION);
  const ahora = new Date();
  const conexion = await sql.obtenerConexion();
  try {
    await conexion.beginTransaction();
    await conexion.execute(
      `INSERT INTO generaciones_flujos_federacion (
         generacion_id,flujo_id,ordinal,clase,estado,rol_generacion,
         generacion_predecesora_id,estrategia_candidata,requiere_revalidacion,
         installation_propietaria_id,boot_propietario_id,version_propietario,
         version_estado,version_registro,creada_en_utc,actualizada_en_utc,
         finalizada_en_utc
       ) VALUES (?, ?, 2, 'resincronizacion', 'completa', 'candidata', ?,
         'coexistir', FALSE, ?, ?, 1, 1, 1, ?, ?, NULL)`,
      [generacionId, ids.flujoId, ids.generacionId, ids.installationRemotaId,
        ids.bootRemotoId, ahora, ahora]
    );
    await conexion.execute(
      `DELETE FROM estados_actuales_proyecciones_federacion
        WHERE proyeccion_id=? AND generacion_actual_id=?`,
      [ids.proyeccionId, ids.generacionId]
    );
    await conexion.execute(
      `UPDATE generaciones_flujos_federacion
          SET estado='sustituida',rol_generacion='historica',
              finalizada_en_utc=?,actualizada_en_utc=?,
              version_estado=version_estado+1,version_registro=version_registro+1
        WHERE generacion_id=? AND rol_generacion='activa'`,
      [ahora, ahora, ids.generacionId]
    );
    await conexion.execute(
      `UPDATE generaciones_flujos_federacion
          SET rol_generacion='activa',actualizada_en_utc=?,
              version_estado=version_estado+1,version_registro=version_registro+1
        WHERE generacion_id=? AND rol_generacion='candidata'`,
      [ahora, generacionId]
    );
    await conexion.execute(
      `UPDATE flujos_federacion
          SET generacion_activa_id=?,actualizada_en_utc=?,
              version_estado=version_estado+1,version_registro=version_registro+1
        WHERE flujo_id=? AND generacion_activa_id=?`,
      [generacionId, ahora, ids.flujoId, ids.generacionId]
    );
    await conexion.execute(
      `UPDATE versiones_proyecciones_federacion
          SET estado_publicacion='historica',
              finalizada_en_utc=?,actualizada_en_utc=?,
              version_estado=version_estado+1
        WHERE proyeccion_id=? AND generacion_id=?`,
      [ahora, ahora, ids.proyeccionId, ids.generacionId]
    );
    await conexion.execute(
      `INSERT INTO versiones_proyecciones_federacion (
         proyeccion_id,generacion_id,estado_publicacion,estado_materializacion,
         completitud_interpretable,completitud_observable,
         completitud_reconstruible,estado_vigencia,estado_soporte,
         estado_autorizacion,cierre_operativo_validado,recepcion_confirmada,
         ultima_secuencia_evaluada,ultima_evaluacion_id,version_estado,
         creada_en_utc,actualizada_en_utc,publicada_en_utc,finalizada_en_utc
       ) VALUES (?,?,'preparando','materializada','completa','completa',
         'parcial','retirada','sostenida','autorizada',TRUE,TRUE,1,NULL,1,
         ?,DATE_ADD(?,INTERVAL 1 SECOND),NULL,NULL)`,
      [ids.proyeccionId, generacionId, ahora, ahora]
    );
    await conexion.commit();
    return generacionId;
  } catch (error) {
    await conexion.rollback().catch(() => {});
    throw error;
  } finally {
    conexion.release();
  }
}

function leer(ruta) {
  return readFile(new URL(ruta, import.meta.url), 'utf8');
}

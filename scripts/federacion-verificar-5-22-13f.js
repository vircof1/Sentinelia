import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { readFile } from 'node:fs/promises';

import { GestorSesionEmisionFederacionRuntime } from '../apps/sentinelia-runtime/src/federacion/GestorSesionEmisionFederacionRuntime.js';
import { ProcesadorFlujoEmisionFederacionRuntime } from '../apps/sentinelia-runtime/src/federacion/ProcesadorFlujoEmisionFederacionRuntime.js';
import { generarUuidV7Auditoria } from '../paquetes/auditoria/src/UuidV7Auditoria.js';
import { ClienteHttpDatosFederacion } from '../paquetes/federacion/adaptadores/ClienteHttpDatosFederacion.js';
import { AdaptadorCapturaTransaccionalFederacionSql } from '../paquetes/federacion/adaptadores/AdaptadorCapturaTransaccionalFederacionSql.js';
import { FuenteEntropiaCriptograficaNode } from '../paquetes/federacion/adaptadores/FuenteEntropiaCriptograficaNode.js';
import { RepositorioCoordinacionEmisionFederacionSql } from '../paquetes/federacion/adaptadores/RepositorioCoordinacionEmisionFederacionSql.js';
import { RepositorioFlujosFederacionSql } from '../paquetes/federacion/adaptadores/RepositorioFlujosFederacionSql.js';
import { RepositorioOcurrenciasFederacionSql } from '../paquetes/federacion/adaptadores/RepositorioOcurrenciasFederacionSql.js';
import { RepositorioOutboxFederacionSql } from '../paquetes/federacion/adaptadores/RepositorioOutboxFederacionSql.js';
import { crearCampoPresenteFederado } from '../paquetes/federacion/src/EnvolventeFederacion.js';
import { GeneradorIdentidadesFederadas, TIPOS_IDENTIDAD_FEDERADA } from '../paquetes/federacion/src/IdentidadFederada.js';
import { ClienteSql } from '../paquetes/persistencia-sql/src/ClienteSql.js';
import { EjecutorMigraciones } from '../paquetes/persistencia-sql/src/EjecutorMigraciones.js';
import { RepositorioMigraciones } from '../paquetes/persistencia-sql/src/RepositorioMigraciones.js';
import { obtenerConfiguracionAplicacion, obtenerRutaMigraciones } from '../paquetes/utilidades/src/configuracion/obtenerConfiguracionAplicacion.js';

const generador = new GeneradorIdentidadesFederadas({
  fuenteEntropia: new FuenteEntropiaCriptograficaNode()
});
const TOKEN_A = `sfop1_${'A'.repeat(64)}`;
const TOKEN_B = `sfop1_${'B'.repeat(64)}`;
const USUARIO_SQL = '5221306';

await main();

async function main() {
  await verificarRegistroYMigracion();
  await verificarTransporteSesion();
  await verificarSesionCompartida();
  await verificarRechazoInvalidaSesion();
  await verificarPlanificacionYResultadosParciales();
  await verificarDescarteRetencionConfirmado();
  await verificarRespuestaIncoherente();
  console.log(
    '[federacion] OK 5.22.13f: sesion=compartida capacidad=literal ' +
    'lotes=priorizados resultados=parciales entrega=durable fencing=revalidado'
  );
}

async function verificarRegistroYMigracion() {
  const [procesador, repositorio] = await Promise.all([
    leer('../apps/sentinelia-runtime/src/federacion/ProcesadorFlujoEmisionFederacionRuntime.js'),
    leer('../paquetes/federacion/adaptadores/RepositorioCoordinacionEmisionFederacionSql.js')
  ]);
  assert.match(repositorio, /AND lease_token=UNHEX\(\?\) AND fencing_token=\?/u);
  assert.match(procesador, /planificarLotesFederacion/u);
  assert.match(procesador, /invalidarSesionRechazada/u);

  const configuracion = obtenerConfiguracionAplicacion();
  assert.equal(configuracion.sql.estaCompleta, true);
  const baseDatos = `sentinelia_fixture_52213f_${randomBytes(6).toString('hex')}`;
  const administrador = new ClienteSql(configuracion.sql);
  await administrador.ejecutar(`CREATE DATABASE ${administrador.escaparIdentificador(baseDatos)} CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
  const sql = new ClienteSql({ ...configuracion.sql, baseDatos });
  try {
    await new EjecutorMigraciones({
      clienteSql: sql,
      repositorioMigraciones: new RepositorioMigraciones(sql),
      rutaMigraciones: obtenerRutaMigraciones()
    }).ejecutarPendientes();
    const columnas = await sql.consultar(`
      SELECT column_name FROM information_schema.columns
       WHERE table_schema=DATABASE() AND table_name='outbox_federacion'
         AND column_name IN ('entrega_id','ultimo_resultado',
           'ultimo_error_terminal','ultimo_error_temporal','finalizada_en_utc')
    `);
    assert.equal(columnas.length, 5);
    await verificarPersistenciaSql(sql);
  } finally {
    await sql.cerrar();
    await administrador.ejecutar(`DROP DATABASE IF EXISTS ${administrador.escaparIdentificador(baseDatos)}`).catch(() => {});
    await administrador.cerrar();
  }
}

async function verificarPersistenciaSql(sql) {
  const ids = crearIdsSql();
  try {
    await limpiarSql(sql, ids);
    const ahora = new Date();
    await sql.ejecutar(`
      INSERT INTO relaciones_federacion (
        relacion_id,direccion,estado_ciclo,estado_autoridad,estado_identidad,
        estado_compatibilidad,installation_remota_candidata_id,
        installation_remota_id,nombre_remoto_declarado,responsable_usuario_id,
        responsable_original_usuario_id,scope_tenant_id,scope_empresa_id,
        scope_sitio_id,version_autoridad,corte_autoridad_utc,
        creada_por_usuario_id,creada_en_utc,actualizada_en_utc,revision
      ) VALUES (?,'emision','vinculada','autorizada','valida','compatible',?,?,
        'fixture 5.22.13f',?,?,NULL,NULL,NULL,1,NULL,?,?,?,1)
    `, [ids.relacionId, ids.installationRemotaId, ids.installationRemotaId,
      USUARIO_SQL, USUARIO_SQL, USUARIO_SQL, ahora, ahora]);
    const repositorioFlujos = new RepositorioFlujosFederacionSql(sql, {
      installationLocalId: ids.installationLocalId
    });
    const flujoPreparado = await repositorioFlujos.crearFlujoInicial({
      flujo: { flujoId: ids.flujoId, relacionId: ids.relacionId,
        direccion: 'emision', familia: 'monitores', versionFamilia: 1,
        contexto: { nivel: 'portal' } },
      generacion: { generacionId: ids.generacionId, clase: 'inicial',
        fronteraInicial: '0', propietario: { installationId: ids.installationLocalId,
          bootId: ids.bootId, version: 1 } }
    });
    const captura = new AdaptadorCapturaTransaccionalFederacionSql({
      repositorioOcurrencias: new RepositorioOcurrenciasFederacionSql(sql, {
        installationLocalId: ids.installationLocalId
      }),
      repositorioOutbox: new RepositorioOutboxFederacionSql(sql)
    });
    const conexion = await sql.obtenerConexion();
    try {
      await conexion.beginTransaction();
      await captura.capturarEnTransaccion({
        definicion: { familia: 'monitores', familiaVersion: 1,
          installationOrigenId: ids.installationLocal,
          elementoOrigenId: ids.elemento,
          ocurrenciaOrigenId: ids.ocurrencia,
          operacion: 'actualizacion', tiempoOrigenUtc: '2030-01-01T00:00:00.000Z',
          scopeOrigenDeclarado: { nivel: 'portal', tenantId: null,
            empresaId: null, sitioId: null }, vigenciaRestanteMs: '300000',
          campos: { estadoOperativo: crearCampoPresenteFederado({ valor: true }) },
          evidenciaIntegridad: [] },
        destinos: [{ flujoId: ids.flujoId, generacionId: ids.generacionId }]
      }, { conexion });
      await conexion.commit();
    } catch (error) {
      await conexion.rollback();
      throw error;
    } finally {
      conexion.release();
    }
    await repositorioFlujos.avanzarGeneracion({
      flujoId: ids.flujoId,
      propietario: flujoPreparado.generacion.propietario,
      versionEstadoEsperada: flujoPreparado.generacion.versionEstado,
      versionFronteraEsperada: flujoPreparado.generacion.frontera.version,
      estadoGeneracion: 'transfiriendo',
      estadoFlujo: 'sincronizando',
      frontera: {
        posicionOperativa: null, posicionHistorica: null, sincronizando: true,
        operativamenteCompleta: false, historicamenteCompleta: false,
        parcialPorScope: false, degradada: false
      }
    });
    const repositorio = new RepositorioCoordinacionEmisionFederacionSql(sql);
    const trabajo = await repositorio.reclamarSiguiente({
      instanciaId: 'runtime-13f', leaseToken: Buffer.alloc(32, 6), ttlSegundos: 30
    });
    const primera = await repositorio.prepararCandidatos(trabajo.lease, {
      limite: 10,
      generarEntregaId: () => generador.generar(TIPOS_IDENTIDAD_FEDERADA.ENTREGA)
    });
    const segunda = await repositorio.prepararCandidatos(trabajo.lease, {
      limite: 10,
      generarEntregaId: () => { throw new Error('No debe regenerar entregaId.'); }
    });
    assert.equal(primera[0].entregaId, segunda[0].entregaId);
    await repositorio.aplicarResultados(trabajo.lease, { resultados: [{
      entregaId: primera[0].entregaId, clasificacion: 'temporal',
      resultado: 'aplazadaCapacidad', errorTerminal: null,
      errorTemporal: 'capacidadTemporalAgotada'
    }] });
    await repositorio.aplicarResultados(trabajo.lease, { resultados: [{
      entregaId: primera[0].entregaId, clasificacion: 'terminal',
      resultado: 'aceptada', errorTerminal: null, errorTemporal: null
    }] });
    const [fila] = await sql.consultar(`
      SELECT estado,intentos,entrega_id,ultimo_resultado,finalizada_en_utc
        FROM outbox_federacion WHERE flujo_id=?
    `, [ids.flujoId]);
    assert.deepEqual([fila.estado, Number(fila.intentos), fila.entrega_id,
      fila.ultimo_resultado, fila.finalizada_en_utc !== null],
    ['confirmada', 2, primera[0].entregaId, 'aceptada', true]);
    assert.equal(await repositorio.liberarLease(trabajo.lease), true);
  } finally {
    await limpiarSql(sql, ids);
  }
}

async function limpiarSql(sql, ids) {
  await sql.ejecutar('DELETE FROM outbox_federacion WHERE flujo_id=?', [ids.flujoId]).catch(() => {});
  await sql.ejecutar('DELETE FROM posiciones_ocurrencias_flujos_federacion WHERE flujo_id=?', [ids.flujoId]).catch(() => {});
  await sql.ejecutar('DELETE FROM contadores_posiciones_generaciones_federacion WHERE flujo_id=?', [ids.flujoId]).catch(() => {});
  await sql.ejecutar('DELETE FROM propietarios_emision_flujos_federacion WHERE flujo_id=?', [ids.flujoId]).catch(() => {});
  await sql.ejecutar('UPDATE flujos_federacion SET generacion_activa_id=NULL WHERE flujo_id=?', [ids.flujoId]).catch(() => {});
  await sql.ejecutar('DELETE FROM fronteras_generaciones_federacion WHERE generacion_id=?', [ids.generacionId]).catch(() => {});
  await sql.ejecutar('DELETE FROM generaciones_flujos_federacion WHERE flujo_id=?', [ids.flujoId]).catch(() => {});
  await sql.ejecutar('DELETE FROM flujos_federacion WHERE flujo_id=?', [ids.flujoId]).catch(() => {});
  await sql.ejecutar('DELETE FROM relaciones_federacion WHERE relacion_id=?', [ids.relacionId]).catch(() => {});
  await sql.ejecutar('DELETE FROM ocurrencias_federacion WHERE installation_origen_id=?', [ids.installationLocalId]).catch(() => {});
  await sql.ejecutar('DELETE FROM reservas_identidad_ocurrencias_federacion WHERE installation_origen_id=?', [ids.installationLocalId]).catch(() => {});
  await sql.ejecutar('DELETE FROM contadores_secuencia_elementos_federacion WHERE installation_origen_id=?', [ids.installationLocalId]).catch(() => {});
}

function crearIdsSql() {
  const opaca = (tipo) => generador.generar(tipo);
  const installationLocal = opaca(TIPOS_IDENTIDAD_FEDERADA.INSTALACION);
  const elemento = opaca(TIPOS_IDENTIDAD_FEDERADA.ELEMENTO_ORIGEN);
  const ocurrencia = opaca(TIPOS_IDENTIDAD_FEDERADA.OCURRENCIA_ORIGEN);
  return { installationLocal, installationLocalId: String(installationLocal),
    installationRemotaId: String(opaca(TIPOS_IDENTIDAD_FEDERADA.INSTALACION)),
    bootId: String(opaca(TIPOS_IDENTIDAD_FEDERADA.ARRANQUE)),
    relacionId: String(opaca(TIPOS_IDENTIDAD_FEDERADA.RELACION)),
    flujoId: String(opaca(TIPOS_IDENTIDAD_FEDERADA.FLUJO)),
    generacionId: String(opaca(TIPOS_IDENTIDAD_FEDERADA.GENERACION)),
    elemento, ocurrencia };
}

async function verificarTransporteSesion() {
  const ids = crearIds();
  const solicitudes = [];
  const cliente = new ClienteHttpDatosFederacion({
    fetchImpl: async (url, opciones) => {
      solicitudes.push({ url, opciones });
      return respuestaJson(respuestaSesion(TOKEN_A));
      }
    });
  const destino = {
    relacionId: ids.relacionId,
    installationRemotaId: ids.installationRemotaId,
    endpoint: 'https://receptor.example/prefijo'
  };
  await cliente.iniciarSesion({ destino, solicitud: { secretoPersistente: 'sensible' } });
  await cliente.refrescarSesion({ destino, token: TOKEN_A, solicitud: { sesionId: 'x' } });
  assert.deepEqual(solicitudes.map((s) => s.url), [
    'https://receptor.example/prefijo/api/federacion/v1/sesion/login',
    'https://receptor.example/prefijo/api/federacion/v1/sesion/refresh'
  ]);
  assert.equal(solicitudes[0].opciones.headers.authorization, undefined);
  assert.equal(solicitudes[1].opciones.headers.authorization, `Bearer ${TOKEN_A}`);
  assert.doesNotMatch(solicitudes[1].opciones.body, /sfop1_/u);
}

async function verificarSesionCompartida() {
  const ids = crearIds();
  let ahora = 1_000_000;
  let logins = 0;
  let refreshes = 0;
  const gestor = new GestorSesionEmisionFederacionRuntime({
    repositorioDestinos: {
      async obtenerAprobadoOperativo() {
        return { relacionId: ids.relacionId,
          installationRemotaId: ids.installationRemotaId,
          endpoint: 'https://receptor.example' };
      }
    },
    clienteHttp: {
      async iniciarSesion({ solicitud }) {
        logins += 1;
        assert.equal(solicitud.secretoPersistente, `sfr1_${'S'.repeat(64)}`);
        assert.equal(solicitud.nombreEmisorDeclarado, 'Emisora de pruebas');
        return respuestaSesion(TOKEN_A, 10, solicitud.loginRequestId);
      },
      async refrescarSesion({ token, solicitud }) {
        refreshes += 1;
        assert.equal(token, TOKEN_A);
        assert.equal(solicitud.relacionId, ids.relacionId);
        assert.equal(solicitud.nombreEmisorDeclarado, 'Emisora de pruebas');
        return respuestaSesion(TOKEN_B, 10, solicitud.refreshRequestId);
      }
    },
    custodiaSecretoEmision: {
      async obtenerParaLoginTecnico() { return `sfr1_${'S'.repeat(64)}`; }
    },
    installationLocalId: ids.installationLocalId,
    bootLocalId: ids.bootId,
    resolverNombreLocal: async () => 'Emisora de pruebas',
    reloj: () => ahora
  });
  assert.deepEqual(await Promise.all([
    gestor.obtenerToken({ relacionId: ids.relacionId }),
    gestor.obtenerToken({ relacionId: ids.relacionId })
  ]), [TOKEN_A, TOKEN_A]);
  assert.equal(logins, 1);
  ahora += 9_500;
  assert.deepEqual(await Promise.all([
    gestor.obtenerToken({ relacionId: ids.relacionId }),
    gestor.obtenerToken({ relacionId: ids.relacionId })
  ]), [TOKEN_B, TOKEN_B]);
  assert.equal(refreshes, 1);

  gestor.invalidar({ relacionId: ids.relacionId, token: TOKEN_B });
  const clienteIncoherente = gestor.clienteHttp.iniciarSesion;
  gestor.clienteHttp.iniciarSesion = async ({ solicitud }) =>
    respuestaSesion(TOKEN_A, 10, generarUuidV7Auditoria());
  await assert.rejects(
    gestor.obtenerToken({ relacionId: ids.relacionId }),
    (error) => error.codigo === 'respuesta_sesion_federada_invalida'
  );
  gestor.clienteHttp.iniciarSesion = clienteIncoherente;
}

async function verificarRechazoInvalidaSesion() {
  const ids = crearIds();
  const invalidaciones = [];
  const error = new Error('La sesión desapareció en el receptor.');
  error.statusCode = 403;
  error.codigoRemoto = 'SESION_FEDERADA_NO_VIVA';
  const ref = referencia(ids, 1, 'operativaActual');
  const procesador = new ProcesadorFlujoEmisionFederacionRuntime({
    repositorioCoordinacion: {
      async prepararCandidatos(_lease, opciones) {
        return [{ ...ref, entregaId: String(opciones.generarEntregaId()) }];
      },
      async aplicarResultados() { return []; }
    },
    repositorioOcurrencias: {
      async buscarOcurrenciaPorIdentidad() { return ocurrencia(ids, 0, 'pendiente'); }
    },
    servicioCliente: {
      async obtenerCapacidad() { throw error; },
      async entregarLote() { throw new Error('No debe alcanzarse la entrega.'); }
    },
    gestorSesiones: {
      async obtenerToken() { return TOKEN_A; },
      async invalidar(entrada) { invalidaciones.push(entrada); return true; }
    },
    generadorIdentidades: generador
  });
  await assert.rejects(
    procesador.procesar({
      lease: { cualquiera: true },
      flujo: {
        relacionId: ids.relacionId,
        flujoId: ids.flujoId,
        generacionId: ids.generacionId,
        familia: 'monitores',
        versionFamilia: 1
      },
      renovar: async () => true,
      exigirVigente: async () => true
    }),
    (observado) => observado === error
  );
  assert.deepEqual(invalidaciones, [{ relacionId: ids.relacionId, token: TOKEN_A }]);
}

async function verificarPlanificacionYResultadosParciales() {
  const ids = crearIds();
  const referencias = [
    referencia(ids, 1, 'reconstruccion'),
    referencia(ids, 2, 'operativaActual'),
    referencia(ids, 3, 'reconstruccion')
  ];
  const ocurrencias = new Map([
    [ids.ocurrenciaIds[0], ocurrencia(ids, 0, 'histórico')],
    [ids.ocurrenciaIds[1], ocurrencia(ids, 1, 'actual')],
    [ids.ocurrenciaIds[2], ocurrencia(ids, 2, 'x'.repeat(2000))]
  ]);
  const aplicaciones = [];
  const lotes = [];
  const repositorio = {
    async prepararCandidatos(_lease, opciones) {
      assert.equal(opciones.limite, 5000);
      return referencias.map((ref) => ({
        ...ref,
        entregaId: String(opciones.generarEntregaId())
      }));
    },
    async aplicarResultados(_lease, { resultados }) {
      aplicaciones.push(resultados);
      return resultados;
    }
  };
  const procesador = new ProcesadorFlujoEmisionFederacionRuntime({
    repositorioCoordinacion: repositorio,
    repositorioOcurrencias: {
      async buscarOcurrenciaPorIdentidad(identidad) {
        return ocurrencias.get(identidad.ocurrenciaOrigenId);
      }
    },
    servicioCliente: {
      async obtenerCapacidad() {
        return capacidadDeclarada({ maximoOcurrenciasPorLote: 1,
          maximoBytesPorLote: 1024, maximoBytesPorOcurrencia: 900 });
      },
      async entregarLote({ lote }) {
        lotes.push(lote);
        const temporal = lotes.length === 2;
        return respuestaLote(lote, {
          versionCursor: String(lotes.length),
          resultados: lote.entregas.map(() => ({
            clasificacion: temporal ? 'temporal' : 'terminal',
            resultado: temporal ? 'aplazadaCapacidad' : 'aceptada',
            errorTerminal: null,
            errorTemporal: temporal ? 'capacidadTemporalAgotada' : null
          }))
        });
      }
    },
    gestorSesiones: { async obtenerToken() { return TOKEN_A; } },
    generadorIdentidades: generador
  });
  let renovaciones = 0;
  const resumen = await procesador.procesar({
    lease: { cualquiera: true },
    flujo: { relacionId: ids.relacionId, flujoId: ids.flujoId,
      generacionId: ids.generacionId, familia: 'monitores', versionFamilia: 1 },
    renovar: async () => { renovaciones += 1; },
    exigirVigente: async () => true
  });
  assert.equal(resumen.totalLotes, 2);
  assert.equal(resumen.totalExcedidas, 1);
  assert.equal(renovaciones, 3);
  assert.equal(lotes[0].entregas[0].posicionFlujo, '2', 'El presente debe salir primero.');
  assert.equal(lotes[1].entregas[0].posicionFlujo, '1');
  assert.equal(aplicaciones[0][0].bloqueadaLocalmente, true);
  assert.equal(aplicaciones[1][0].clasificacion, 'terminal');
  assert.equal(aplicaciones[2][0].clasificacion, 'temporal');
}

async function verificarRespuestaIncoherente() {
  const ids = crearIds();
  let aplicaciones = 0;
  const ref = referencia(ids, 1, 'operativaActual');
  const procesador = new ProcesadorFlujoEmisionFederacionRuntime({
    repositorioCoordinacion: {
      async prepararCandidatos(_l, o) { return [{ ...ref, entregaId: String(o.generarEntregaId()) }]; },
      async aplicarResultados() { aplicaciones += 1; }
    },
    repositorioOcurrencias: { async buscarOcurrenciaPorIdentidad() { return ocurrencia(ids, 0, 'ok'); } },
    servicioCliente: {
      async obtenerCapacidad() { return capacidadDeclarada({
        maximoOcurrenciasPorLote: 2, maximoBytesPorLote: 4096,
        maximoBytesPorOcurrencia: 2048
      }); },
      async entregarLote() { return { persistidoDurablemente: true, resultados: [] }; }
    },
    gestorSesiones: { async obtenerToken() { return TOKEN_A; } },
    generadorIdentidades: generador
  });
  await assert.rejects(procesador.procesar({
    lease: {}, flujo: { relacionId: ids.relacionId, flujoId: ids.flujoId,
      generacionId: ids.generacionId, familia: 'monitores', versionFamilia: 1 },
    renovar: async () => true, exigirVigente: async () => true
  }), (error) => error.codigo === 'resultados_federados_invalidos');
  assert.equal(aplicaciones, 0);
}

async function verificarDescarteRetencionConfirmado() {
  const ids = crearIds();
  const ref = referencia(ids, 1, 'reconstruccion');
  const aplicaciones = [];
  const procesador = new ProcesadorFlujoEmisionFederacionRuntime({
    repositorioCoordinacion: {
      async prepararCandidatos(_lease, opciones) {
        return [{ ...ref, entregaId: String(opciones.generarEntregaId()) }];
      },
      async aplicarResultados(_lease, { resultados }) {
        aplicaciones.push(...resultados);
        return resultados;
      }
    },
    repositorioOcurrencias: {
      async buscarOcurrenciaPorIdentidad() {
        return ocurrencia(ids, 0, 'historico fuera de retencion');
      }
    },
    servicioCliente: {
      async obtenerCapacidad() { return capacidadDeclarada(); },
      async entregarLote({ lote }) {
        return respuestaLote(lote, {
          resultados: [{
            clasificacion: 'terminal',
            resultado: 'descartadaPorRetencion',
            errorTerminal: null,
            errorTemporal: null
          }]
        });
      }
    },
    gestorSesiones: { async obtenerToken() { return TOKEN_A; } },
    generadorIdentidades: generador
  });
  const resultado = await procesador.procesar({
    lease: {},
    flujo: {
      relacionId: ids.relacionId,
      flujoId: ids.flujoId,
      generacionId: ids.generacionId,
      familia: 'monitores',
      versionFamilia: 1
    },
    renovar: async () => true,
    exigirVigente: async () => true
  });
  assert.equal(resultado.totalTerminales, 1);
  assert.deepEqual(aplicaciones, [{
    entregaId: aplicaciones[0].entregaId,
    clasificacion: 'terminal',
    resultado: 'descartadaPorRetencion',
    errorTerminal: null,
    errorTemporal: null
  }]);
}

function referencia(ids, posicion, prioridad) {
  return { posicionFlujo: String(posicion), prioridad,
    identidadOcurrencia: { installationOrigenId: ids.installationLocalId,
      familia: 'monitores', elementoOrigenId: ids.elementoIds[posicion - 1],
      ocurrenciaOrigenId: ids.ocurrenciaIds[posicion - 1] } };
}

function ocurrencia(ids, indice, contenido) {
  return { familia: 'monitores', familiaVersion: 1,
    installationOrigenId: ids.installationLocalId,
    elementoOrigenId: ids.elementoIds[indice],
    ocurrenciaOrigenId: ids.ocurrenciaIds[indice], secuenciaElemento: '1',
    operacion: 'actualizacion', tiempoOrigenUtc: '2030-01-01T00:00:00.000Z',
    scopeOrigenDeclarado: { nivel: 'portal', tenantId: null, empresaId: null, sitioId: null },
    vigenciaRestanteMs: '300000', campos: { datos: { estado: 'presente',
      sensibilidad: 'ordinario', valor: contenido } }, evidenciaIntegridad: [] };
}

function respuestaSesion(token, expiresInSeconds = 60,
  requestId = '01890f47-7cf5-7b00-8000-000000000001') {
  return { ok: true, requestId,
    serverTimeUtc: '2030-01-01T00:00:00.000Z', sesion: {
      sessionId: '01890f47-7cf5-7b00-8000-000000000002', token,
      expiresInSeconds, fencingToken: '1', versionRevocacion: '1' } };
}

function capacidadDeclarada(sobrescritura = {}) {
  return {
    perfil: 'sentinelia-federacion-capacidad-receptora-v1',
    protocoloVersion: 1,
    disponible: true,
    prioridadOperativaActual: true,
    maximoOcurrenciasPorLote: 10,
    maximoBytesPorLote: 4096,
    maximoBytesPorOcurrencia: 2048,
    capacidadTemporalOcurrencias: 10,
    toleranciaTemporalMs: 5000,
    familiasSoportadas: ['monitores'],
    versionesFamilia: { monitores: 1 },
    ...sobrescritura
  };
}

function respuestaLote(lote, { resultados, versionCursor = '1' } = {}) {
  const individuales = lote.entregas.map((entrega, indice) => ({
    entregaId: entrega.entregaId,
    posicionFlujo: entrega.posicionFlujo,
    ...resultados[indice],
    confirmada: [
      'aceptada', 'yaConocida', 'retiradaAceptada', 'salidaAceptada',
      'descartadaPorRetencion'
    ]
      .includes(resultados[indice].resultado),
    reutilizado: false,
    persistidoDurablemente: true
  }));
  const temporal = individuales.some((resultado) => resultado.clasificacion === 'temporal');
  return {
    loteId: lote.loteId,
    intentoId: '1',
    numeroIntento: '1',
    clase: 'inicial',
    estado: temporal ? 'parcialTemporal' : 'terminal',
    persistidoDurablemente: true,
    capacidad: capacidadAplicada(),
    progreso: {
      flujoId: lote.flujoId,
      generacionId: lote.generacionId,
      posicionTerminalContigua: '0',
      fronteraInicial: '0',
      fronteraInicialRecorrida: true,
      fronteraInicialDegradada: false,
      prefijoDegradado: false,
      version: versionCursor,
      rangosTerminalesDispersos: []
    },
    resultados: individuales
  };
}

function capacidadAplicada() {
  return {
    versionConfiguracion: '1',
    disponible: true,
    familiasSoportadas: ['monitores'],
    versionesFamilia: { monitores: 1 },
    maximoOcurrenciasPorLote: 10,
    maximoBytesPorLote: 4096,
    maximoBytesPorOcurrencia: 2048,
    capacidadTemporalOcurrencias: 10
  };
}

function respuestaJson(datos) {
  const bytes = Buffer.from(JSON.stringify(datos));
  let emitido = false;
  return { ok: true, status: 200,
    headers: { get: (n) => n === 'content-type' ? 'application/json' : null },
    body: { getReader() { return { async read() {
      if (emitido) return { done: true, value: undefined };
      emitido = true; return { done: false, value: bytes };
    }, async cancel() {} }; } } };
}

function crearIds() {
  const id = (tipo) => String(generador.generar(tipo));
  return { installationLocalId: id(TIPOS_IDENTIDAD_FEDERADA.INSTALACION),
    installationRemotaId: id(TIPOS_IDENTIDAD_FEDERADA.INSTALACION),
    bootId: id(TIPOS_IDENTIDAD_FEDERADA.ARRANQUE),
    relacionId: id(TIPOS_IDENTIDAD_FEDERADA.RELACION),
    flujoId: id(TIPOS_IDENTIDAD_FEDERADA.FLUJO),
    generacionId: id(TIPOS_IDENTIDAD_FEDERADA.GENERACION),
    elementoIds: Array.from({ length: 3 }, () => id(TIPOS_IDENTIDAD_FEDERADA.ELEMENTO_ORIGEN)),
    ocurrenciaIds: Array.from({ length: 3 }, () => id(TIPOS_IDENTIDAD_FEDERADA.OCURRENCIA_ORIGEN)) };
}

function leer(ruta) { return readFile(new URL(ruta, import.meta.url), 'utf8'); }

import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';

import { ProcesadorFlujoEmisionFederacionRuntime } from '../apps/sentinelia-runtime/src/federacion/ProcesadorFlujoEmisionFederacionRuntime.js';
import { AdaptadorCapturaTransaccionalFederacionSql } from '../paquetes/federacion/adaptadores/AdaptadorCapturaTransaccionalFederacionSql.js';
import { FuenteEntropiaCriptograficaNode } from '../paquetes/federacion/adaptadores/FuenteEntropiaCriptograficaNode.js';
import { RepositorioCoordinacionEmisionFederacionSql } from '../paquetes/federacion/adaptadores/RepositorioCoordinacionEmisionFederacionSql.js';
import { RepositorioFlujosFederacionSql } from '../paquetes/federacion/adaptadores/RepositorioFlujosFederacionSql.js';
import { RepositorioOcurrenciasFederacionSql } from '../paquetes/federacion/adaptadores/RepositorioOcurrenciasFederacionSql.js';
import { RepositorioOutboxFederacionSql } from '../paquetes/federacion/adaptadores/RepositorioOutboxFederacionSql.js';
import { crearCampoPresenteFederado } from '../paquetes/federacion/src/EnvolventeFederacion.js';
import { GeneradorIdentidadesFederadas, TIPOS_IDENTIDAD_FEDERADA, crearIdentidadFederada } from '../paquetes/federacion/src/IdentidadFederada.js';
import { ClienteSql } from '../paquetes/persistencia-sql/src/ClienteSql.js';
import { EjecutorMigraciones } from '../paquetes/persistencia-sql/src/EjecutorMigraciones.js';
import { RepositorioMigraciones } from '../paquetes/persistencia-sql/src/RepositorioMigraciones.js';
import { obtenerConfiguracionAplicacion, obtenerRutaMigraciones } from '../paquetes/utilidades/src/configuracion/obtenerConfiguracionAplicacion.js';

const generador = new GeneradorIdentidadesFederadas({
  fuenteEntropia: new FuenteEntropiaCriptograficaNode()
});
const TOKEN = `sfop1_${'G'.repeat(64)}`;
const USUARIO_SQL = '5221307';

await main();

async function main() {
  await verificarRegistroYMigracion();
  await verificarReagrupacion413();
  await verificarReagrupacionPorRespuestaInvalida();
  await verificarReagrupacionPorTimeout();
  await verificar413NoAdaptativo();
  await verificarCapacidadNoDisponible();
  await verificarPausaPorTransporte();
  await verificarBackpressureParcial();
  await verificarCursorRespuestaObligatorio();
  await verificarAckInvalidoSeAplaza();
  console.log(
    '[federacion] OK 5.22.13g: pausa=sql backpressure=durable ' +
    'reintento=exponencial cursor=monotono 413=adaptativo reanudacion=sin_replay_global'
  );
}
async function verificarRegistroYMigracion() {
  const configuracion = obtenerConfiguracionAplicacion();
  assert.equal(configuracion.sql.estaCompleta, true);
  const baseDatos = `sentinelia_fixture_52213g_${randomBytes(6).toString('hex')}`;
  const administrador = new ClienteSql(configuracion.sql);
  let sql;
  try {
    await administrador.ejecutar(
      `CREATE DATABASE ${administrador.escaparIdentificador(baseDatos)} ` +
      'CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci'
    );
    sql = new ClienteSql({ ...configuracion.sql, baseDatos });
    await new EjecutorMigraciones({
      clienteSql: sql,
      repositorioMigraciones: new RepositorioMigraciones(sql),
      rutaMigraciones: obtenerRutaMigraciones()
    }).ejecutarPendientes();
    const tablas = await sql.consultar(`
      SELECT table_name FROM information_schema.tables
       WHERE table_schema=DATABASE()
         AND table_name='control_generaciones_emision_federacion'
    `);
    assert.equal(tablas.length, 1);
    await verificarPausaYCursorSql(sql);
    await verificarPromocionAutomaticaSql(sql);
  } finally {
    await sql?.cerrar().catch(() => {});
    await administrador.ejecutar(
      `DROP DATABASE IF EXISTS ${administrador.escaparIdentificador(baseDatos)}`
    ).catch(() => {});
    await administrador.cerrar();
  }
}

async function verificarPromocionAutomaticaSql(sql) {
  const ids = crearIds();
  try {
    await limpiarSql(sql, ids);
    await crearFlujoFixture(sql, ids);
    await capturarFixture(sql, ids);
    await sql.ejecutar(
      `UPDATE fronteras_generaciones_federacion
          SET posicion_inicial_comprometida=2
        WHERE generacion_id=?`,
      [ids.generacionId]
    );
    const repositorio = new RepositorioCoordinacionEmisionFederacionSql(sql);
    const trabajo = await repositorio.reclamarSiguiente({
      instanciaId: 'runtime-13g-promocion',
      leaseToken: Buffer.alloc(32, 9),
      ttlSegundos: 30
    });
    const candidatos = await repositorio.prepararCandidatos(trabajo.lease, {
      limite: 10,
      generarEntregaId: () => generador.generar(TIPOS_IDENTIDAD_FEDERADA.ENTREGA)
    });
    const consolidacion = await repositorio.aplicarResultados(trabajo.lease, {
      resultados: candidatos.map((candidato) => ({
        entregaId: candidato.entregaId,
        clasificacion: 'terminal',
        resultado: 'aceptada',
        errorTerminal: null,
        errorTemporal: null
      })),
      progreso: {
        ...progreso(ids, '2', '1'),
        fronteraInicial: '2'
      }
    });
    assert.equal(consolidacion.promocion.estadoGeneracion, 'completa');
    assert.equal(consolidacion.promocion.estadoFlujo, 'operativoCompleto');
    const [filas] = await sql.consultar(
      `SELECT f.estado,g.estado AS estado_generacion,
              b.posicion_operativa_validada,b.posicion_historica_validada,
              b.sincronizando,b.operativamente_completa,
              b.historicamente_completa,b.degradada
         FROM flujos_federacion f
         JOIN generaciones_flujos_federacion g
           ON g.generacion_id=f.generacion_activa_id
         JOIN fronteras_generaciones_federacion b
           ON b.generacion_id=g.generacion_id
        WHERE f.flujo_id=?`,
      [ids.flujoId]
    );
    assert.deepEqual({
      estado: filas.estado,
      estadoGeneracion: filas.estado_generacion,
      posicionOperativa: String(filas.posicion_operativa_validada),
      posicionHistorica: String(filas.posicion_historica_validada),
      sincronizando: Boolean(filas.sincronizando),
      operativamenteCompleta: Boolean(filas.operativamente_completa),
      historicamenteCompleta: Boolean(filas.historicamente_completa),
      degradada: Boolean(filas.degradada)
    }, {
      estado: 'operativoCompleto',
      estadoGeneracion: 'completa',
      posicionOperativa: '2',
      posicionHistorica: '2',
      sincronizando: false,
      operativamenteCompleta: true,
      historicamenteCompleta: true,
      degradada: false
    });
  } finally {
    await limpiarSql(sql, ids);
  }
}

async function verificarPausaYCursorSql(sql) {
  const ids = crearIds();
  try {
    await limpiarSql(sql, ids);
    await crearFlujoFixture(sql, ids);
    await capturarFixture(sql, ids);
    const repositorio = new RepositorioCoordinacionEmisionFederacionSql(sql);
    const trabajo = await repositorio.reclamarSiguiente({
      instanciaId: 'runtime-13g-a', leaseToken: Buffer.alloc(32, 7), ttlSegundos: 30
    });
    const [candidato] = await repositorio.prepararCandidatos(trabajo.lease, {
      limite: 10,
      generarEntregaId: () => generador.generar(TIPOS_IDENTIDAD_FEDERADA.ENTREGA)
    });
    await repositorio.aplicarResultados(trabajo.lease, {
      resultados: [{ entregaId: candidato.entregaId, clasificacion: 'temporal',
        resultado: 'aplazadaCapacidad', errorTerminal: null,
        errorTemporal: 'capacidadTemporalAgotada' }],
      progreso: progreso(ids, '0', '1'),
      demoraReintentoSegundos: 2
    });
    const pausado = await repositorio.obtenerControl(ids);
    assert.equal(pausado.posicionTerminalContigua, '0');
    assert.equal(pausado.posicionTerminalRemota, '0');
    assert.equal(pausado.causaPausa, 'backpressure_remoto');
    assert.equal(await repositorio.liberarLease(trabajo.lease), true);
    assert.equal(await repositorio.reclamarSiguiente({
      instanciaId: 'runtime-13g-b', leaseToken: Buffer.alloc(32, 8), ttlSegundos: 30
    }), null, 'La pausa durable debe sobrevivir a la liberación del lease.');

    await sql.ejecutar(`
      UPDATE control_generaciones_emision_federacion
         SET pausa_hasta_utc=TIMESTAMPADD(SECOND,-1,UTC_TIMESTAMP(3))
       WHERE generacion_id=?
    `, [ids.generacionId]);
    await sql.ejecutar(`
      UPDATE outbox_federacion
         SET disponible_desde_utc=capturada_en_utc
       WHERE flujo_id=?
    `, [ids.flujoId]);
    const reanudado = await repositorio.reclamarSiguiente({
      instanciaId: 'runtime-13g-b', leaseToken: Buffer.alloc(32, 8), ttlSegundos: 30
    });
    const [mismo] = await repositorio.prepararCandidatos(reanudado.lease, {
      limite: 10,
      generarEntregaId: () => { throw new Error('No debe cambiar entregaId al reanudar.'); }
    });
    assert.equal(mismo.entregaId, candidato.entregaId);
    await repositorio.aplicarResultados(reanudado.lease, {
      resultados: [{ entregaId: mismo.entregaId, clasificacion: 'terminal',
        resultado: 'yaConocida', errorTerminal: null, errorTemporal: null }],
      progreso: progreso(ids, '1', '2')
    });
    const completado = await repositorio.obtenerControl(ids);
    assert.equal(completado.posicionTerminalContigua, '1');
    assert.equal(completado.posicionTerminalRemota, '1');
    assert.equal(completado.versionCursorRemoto, '2');
    const [segundo] = await repositorio.prepararCandidatos(reanudado.lease, {
      limite: 10,
      generarEntregaId: () => generador.generar(TIPOS_IDENTIDAD_FEDERADA.ENTREGA)
    });
    await assert.rejects(repositorio.aplicarResultados(reanudado.lease, {
      resultados: [{ entregaId: segundo.entregaId, clasificacion: 'terminal',
        resultado: 'aceptada', errorTerminal: null, errorTemporal: null }],
      progreso: progreso(ids, '0', '3')
    }), (error) => error.codigo === 'cursor_remoto_regresivo');
    await repositorio.liberarLease(reanudado.lease);
  } finally {
    await limpiarSql(sql, ids);
  }
}

async function verificarReagrupacion413() {
  const ids = crearIds();
  const refs = [1, 2, 3].map((posicion) => referencia(ids, posicion));
  const lotes = [];
  const reagrupaciones = [];
  let primerIntento = true;
  const procesador = crearProcesador(ids, {
    referencias: refs,
    repositorioExtra: {
      async registrarReagrupacionPorCapacidad(_lease, datos) {
        reagrupaciones.push(datos.entregaIds);
      }
    },
    capacidad: capacidad(3),
    async entregar(lote) {
      lotes.push(lote);
      if (primerIntento) {
        primerIntento = false;
        const error = new Error('413');
        error.statusCode = 413;
        error.capacidad = capacidadAplicada({ maximoOcurrenciasPorLote: 1 });
        throw error;
      }
      return respuestaTerminal(lote, ids);
    }
  });
  const resumen = await ejecutar(procesador, ids);
  assert.equal(resumen.totalReagrupaciones, 1);
  assert.equal(resumen.totalLotesEnviados, 3);
  assert.deepEqual(lotes.slice(1).map((lote) => lote.entregas.length), [1, 1, 1]);
  assert.deepEqual(reagrupaciones[0].sort(),
    lotes[0].entregas.map((entrega) => entrega.entregaId).sort());
  assert.notEqual(lotes[0].loteId, lotes[1].loteId);
}

async function verificarReagrupacionPorRespuestaInvalida() {
  const ids = crearIds();
  const refs = [1, 2, 3].map((posicion) => referencia(ids, posicion));
  const lotes = [];
  const reagrupaciones = [];
  const aplazamientos = [];
  const aplicaciones = [];
  const procesador = crearProcesador(ids, {
    referencias: refs,
    aplicaciones,
    repositorioExtra: {
      async registrarReagrupacionPorRespuesta(_lease, datos) {
        reagrupaciones.push(datos);
      },
      async aplazarEntregas(_lease, datos) {
        aplazamientos.push(datos);
      }
    },
    capacidad: capacidad(3),
    async entregar(lote) {
      lotes.push(lote);
      if (lote.entregas.length > 1 ||
          lote.entregas[0].posicionFlujo === '2') {
        const error = new Error('Respuesta no interpretable.');
        error.codigo = 'respuesta_federada_invalida';
        error.reintentable = true;
        throw error;
      }
      return respuestaTerminal(lote, ids);
    }
  });
  const resumen = await ejecutar(procesador, ids);
  assert.equal(resumen.totalReagrupaciones, 2);
  assert.equal(resumen.totalLotesEnviados, 2);
  assert.equal(resumen.totalTerminales, 2);
  assert.equal(resumen.pausado, true);
  assert.deepEqual(lotes.map((lote) => lote.entregas.map(
    (entrega) => entrega.posicionFlujo
  )), [['1', '2', '3'], ['1', '2'], ['1'], ['2'], ['3']]);
  assert.equal(reagrupaciones.length, 2);
  assert.ok(reagrupaciones.every((entrada) =>
    entrada.codigoTransporte === 'respuesta_federada_invalida'));
  assert.equal(aplazamientos.length, 1);
  assert.deepEqual(aplazamientos[0].entregaIds, [lotes[3].entregas[0].entregaId]);
  assert.equal(aplicaciones.length, 2);
  assert.notEqual(lotes[0].loteId, lotes[1].loteId);
}

async function verificarReagrupacionPorTimeout() {
  const ids = crearIds();
  const lotes = [];
  const procesador = crearProcesador(ids, {
    referencias: [1, 2].map((posicion) => referencia(ids, posicion)),
    repositorioExtra: {
      async registrarReagrupacionPorRespuesta(_lease, datos) {
        assert.equal(datos.codigoTransporte, 'timeout_transporte_federado');
      }
    },
    capacidad: capacidad(2),
    async entregar(lote) {
      lotes.push(lote);
      if (lote.entregas.length > 1) {
        const error = new Error('El lote agotó el plazo de transporte.');
        error.codigo = 'timeout_transporte_federado';
        error.reintentable = true;
        throw error;
      }
      return respuestaTerminal(lote, ids);
    }
  });
  const resumen = await ejecutar(procesador, ids);
  assert.equal(resumen.totalReagrupaciones, 1);
  assert.equal(resumen.totalLotesEnviados, 2);
  assert.equal(resumen.totalTerminales, 2);
  assert.equal(resumen.pausado, false);
  assert.deepEqual(lotes.map((lote) => lote.entregas.length), [2, 1, 1]);
}

async function verificarPausaPorTransporte() {
  const ids = crearIds();
  let aplazamiento;
  const procesador = crearProcesador(ids, {
    referencias: [{ ...referencia(ids, 1), intentos: 2 }],
    repositorioExtra: {
      async aplazarEntregas(_lease, datos) { aplazamiento = datos; }
    },
    capacidad: capacidad(1),
    async entregar() {
      const error = new Error('timeout');
      error.codigo = 'timeout_transporte_federado';
      error.reintentable = true;
      throw error;
    }
  });
  const resumen = await ejecutar(procesador, ids);
  assert.equal(resumen.pausado, true);
  assert.equal(aplazamiento.codigoTransporte, 'timeout_transporte_federado');
  assert.equal(aplazamiento.demoraReintentoSegundos, 8);
}

async function verificarCapacidadNoDisponible() {
  const ids = crearIds();
  let pausa;
  const procesador = crearProcesador(ids, {
    referencias: [referencia(ids, 1)],
    capacidad: { ...capacidad(1), disponible: false },
    repositorioExtra: {
      async pausarFlujo(_lease, datos) { pausa = datos; }
    },
    async entregar() { throw new Error('No debe enviarse un lote sin capacidad.'); }
  });
  const resumen = await ejecutar(procesador, ids);
  assert.equal(resumen.pausado, true);
  assert.equal(resumen.totalLotes, 0);
  assert.equal(pausa.causa, 'capacidad_federada_temporalmente_no_disponible');
}

async function verificar413NoAdaptativo() {
  const ids = crearIds();
  const procesador = crearProcesador(ids, {
    referencias: [referencia(ids, 1)],
    capacidad: capacidad(1),
    async entregar() {
      const error = new Error('413 sin reducción');
      error.statusCode = 413;
      error.capacidad = capacidadAplicada({ maximoOcurrenciasPorLote: 1 });
      throw error;
    }
  });
  await assert.rejects(ejecutar(procesador, ids),
    (error) => error.codigo === 'capacidad_413_no_adaptativa');
}

async function verificarBackpressureParcial() {
  const ids = crearIds();
  let envios = 0;
  const aplicaciones = [];
  const procesador = crearProcesador(ids, {
    referencias: [referencia(ids, 1), referencia(ids, 2)],
    capacidad: capacidad(1),
    aplicaciones,
    async entregar(lote) {
      envios += 1;
      return respuestaDurable(lote, ids, lote.entregas.map(() => ({
        clasificacion: 'temporal', resultado: 'aplazadaCapacidad',
        errorTerminal: null, errorTemporal: 'capacidadTemporalAgotada'
      })), { posicion: '0' });
    }
  });
  const resumen = await ejecutar(procesador, ids);
  assert.equal(envios, 1, 'El backpressure debe detener lotes posteriores del ciclo.');
  assert.equal(resumen.totalTemporales, 1);
  assert.equal(resumen.pausado, true);
  assert.equal(aplicaciones[0].demoraReintentoSegundos, 2);
}

async function verificarCursorRespuestaObligatorio() {
  const ids = crearIds();
  let aplicaciones = 0;
  const procesador = crearProcesador(ids, {
    referencias: [referencia(ids, 1)],
    capacidad: capacidad(1),
    repositorioExtra: {
      async aplicarResultados() { aplicaciones += 1; }
    },
    async entregar(lote) {
      const respuesta = respuestaDurable(lote, ids, lote.entregas.map(() => ({
        clasificacion: 'terminal', resultado: 'aceptada', errorTerminal: null,
        errorTemporal: null
      })));
      delete respuesta.progreso;
      return respuesta;
    }
  });
  await assert.rejects(ejecutar(procesador, ids),
    (error) => error.codigo === 'resultados_federados_invalidos');
  assert.equal(aplicaciones, 0);
}

async function verificarAckInvalidoSeAplaza() {
  const ids = crearIds();
  let aplazamiento;
  const procesador = crearProcesador(ids, {
    referencias: [referencia(ids, 1)],
    capacidad: capacidad(1),
    repositorioExtra: {
      async aplazarEntregas(_lease, datos) { aplazamiento = datos; }
    },
    async entregar() { return { ok: true }; }
  });
  const resumen = await ejecutar(procesador, ids);
  assert.equal(resumen.pausado, true);
  assert.equal(
    aplazamiento.codigoTransporte,
    'resultados_federados_invalidos.envolvente_respuesta'
  );
}

function crearProcesador(ids, {
  referencias,
  capacidad: capacidadDeclarada,
  entregar,
  aplicaciones = [],
  repositorioExtra = {}
}) {
  const repositorio = {
    async prepararCandidatos(_lease, opciones) {
      return referencias.map((ref) => ({ ...ref, intentos: ref.intentos ?? 0,
        entregaId: String(opciones.generarEntregaId()) }));
    },
    async aplicarResultados(_lease, datos) { aplicaciones.push(datos); return datos; },
    ...repositorioExtra
  };
  return new ProcesadorFlujoEmisionFederacionRuntime({
    repositorioCoordinacion: repositorio,
    repositorioOcurrencias: {
      async buscarOcurrenciaPorIdentidad(identidad) {
        const indice = ids.ocurrenciaIds.indexOf(identidad.ocurrenciaOrigenId);
        return ocurrencia(ids, indice);
      }
    },
    servicioCliente: {
      async obtenerCapacidad() { return capacidadDeclarada; },
      async entregarLote({ lote }) { return entregar(lote); }
    },
    gestorSesiones: { async obtenerToken() { return TOKEN; } },
    generadorIdentidades: generador,
    aleatorio: () => 0.5
  });
}

function ejecutar(procesador, ids) {
  return procesador.procesar({ lease: {}, intentos: 1,
    flujo: { relacionId: ids.relacionId, flujoId: ids.flujoId,
      generacionId: ids.generacionId, familia: 'monitores', versionFamilia: 1 },
    renovar: async () => true, exigirVigente: async () => true });
}

function capacidad(maximoOcurrenciasPorLote) {
  return { perfil: 'sentinelia-federacion-capacidad-receptora-v1',
    protocoloVersion: 1, disponible: true, prioridadOperativaActual: true,
    familiasSoportadas: ['monitores'], versionesFamilia: { monitores: 1 },
    maximoOcurrenciasPorLote, maximoBytesPorLote: 4096,
    maximoBytesPorOcurrencia: 2048, capacidadTemporalOcurrencias: 10,
    toleranciaTemporalMs: 5000 };
}

function respuestaTerminal(lote, ids) {
  return respuestaDurable(lote, ids, lote.entregas.map(() => ({
    clasificacion: 'terminal', resultado: 'aceptada', errorTerminal: null,
    errorTemporal: null
  })));
}

function respuestaDurable(lote, ids, resultados, {
  posicion = lote.entregas.at(-1).posicionFlujo,
  version = '1'
} = {}) {
  const individuales = lote.entregas.map((entrega, indice) => ({
    entregaId: entrega.entregaId,
    posicionFlujo: entrega.posicionFlujo,
    ...resultados[indice],
    confirmada: ['aceptada', 'yaConocida', 'retiradaAceptada', 'salidaAceptada']
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
    progreso: progreso(ids, posicion, version),
    resultados: individuales
  };
}

function capacidadAplicada(sobrescritura = {}) {
  return {
    versionConfiguracion: '1',
    disponible: true,
    familiasSoportadas: ['monitores'],
    versionesFamilia: { monitores: 1 },
    maximoOcurrenciasPorLote: 10,
    maximoBytesPorLote: 4096,
    maximoBytesPorOcurrencia: 2048,
    capacidadTemporalOcurrencias: 10,
    ...sobrescritura
  };
}

function progreso(ids, posicion, version) {
  return { flujoId: ids.flujoId, generacionId: ids.generacionId,
    posicionTerminalContigua: posicion, fronteraInicial: '0',
    fronteraInicialRecorrida: true, fronteraInicialDegradada: false,
    prefijoDegradado: false, version, rangosTerminalesDispersos: [] };
}

async function crearFlujoFixture(sql, ids) {
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
      'fixture 5.22.13g',?,?,NULL,NULL,NULL,1,NULL,?,?,?,1)
  `, [ids.relacionId, ids.installationRemotaId, ids.installationRemotaId,
    USUARIO_SQL, USUARIO_SQL, USUARIO_SQL, ahora, ahora]);
  const repositorioFlujos = new RepositorioFlujosFederacionSql(sql, {
    installationLocalId: ids.installationLocalId
  });
  const preparado = await repositorioFlujos.crearFlujoInicial({
    flujo: { flujoId: ids.flujoId, relacionId: ids.relacionId,
      direccion: 'emision', familia: 'monitores', versionFamilia: 1,
      contexto: { nivel: 'portal' } },
    generacion: { generacionId: ids.generacionId, clase: 'inicial',
      fronteraInicial: '0', propietario: { installationId: ids.installationLocalId,
        bootId: ids.bootId, version: 1 } }
  });
  await repositorioFlujos.avanzarGeneracion({
    flujoId: ids.flujoId,
    propietario: preparado.generacion.propietario,
    versionEstadoEsperada: preparado.generacion.versionEstado,
    versionFronteraEsperada: preparado.generacion.frontera.version,
    estadoGeneracion: 'transfiriendo',
    estadoFlujo: 'sincronizando',
    frontera: {
      posicionOperativa: null, posicionHistorica: null, sincronizando: true,
      operativamenteCompleta: false, historicamenteCompleta: false,
      parcialPorScope: false, degradada: false
    }
  });
}

async function capturarFixture(sql, ids) {
  const captura = new AdaptadorCapturaTransaccionalFederacionSql({
    repositorioOcurrencias: new RepositorioOcurrenciasFederacionSql(sql, {
      installationLocalId: ids.installationLocalId
    }),
    repositorioOutbox: new RepositorioOutboxFederacionSql(sql)
  });
  const conexion = await sql.obtenerConexion();
  try {
    await conexion.beginTransaction();
    for (let indice = 0; indice < 2; indice += 1) {
      await captura.capturarEnTransaccion({
        definicion: definicion(ids, indice),
        destinos: [{ flujoId: ids.flujoId, generacionId: ids.generacionId }]
      }, { conexion });
    }
    await conexion.commit();
  } catch (error) {
    await conexion.rollback();
    throw error;
  } finally {
    conexion.release();
  }
}

function definicion(ids, indice) {
  return { familia: 'monitores', familiaVersion: 1,
    installationOrigenId: ids.installationLocal,
    elementoOrigenId: identidadOpaca(
      TIPOS_IDENTIDAD_FEDERADA.ELEMENTO_ORIGEN, ids.elementoIds[indice]
    ),
    ocurrenciaOrigenId: identidadOpaca(
      TIPOS_IDENTIDAD_FEDERADA.OCURRENCIA_ORIGEN, ids.ocurrenciaIds[indice]
    ),
    operacion: 'actualizacion', tiempoOrigenUtc: '2030-01-01T00:00:00.000Z',
    scopeOrigenDeclarado: { nivel: 'portal', tenantId: null,
      empresaId: null, sitioId: null }, vigenciaRestanteMs: '300000',
    campos: { estadoOperativo: crearCampoPresenteFederado({ valor: true }) },
    evidenciaIntegridad: [] };
}

function referencia(ids, posicion) {
  return { posicionFlujo: String(posicion), prioridad: 'operativaActual',
    identidadOcurrencia: { installationOrigenId: ids.installationLocalId,
      familia: 'monitores', elementoOrigenId: ids.elementoIds[posicion - 1],
      ocurrenciaOrigenId: ids.ocurrenciaIds[posicion - 1] } };
}

function ocurrencia(ids, indice) {
  return { familia: 'monitores', familiaVersion: 1,
    installationOrigenId: ids.installationLocalId,
    elementoOrigenId: ids.elementoIds[indice],
    ocurrenciaOrigenId: ids.ocurrenciaIds[indice], secuenciaElemento: '1',
    operacion: 'actualizacion', tiempoOrigenUtc: '2030-01-01T00:00:00.000Z',
    scopeOrigenDeclarado: { nivel: 'portal', tenantId: null,
      empresaId: null, sitioId: null }, vigenciaRestanteMs: '300000',
    campos: { datos: { estado: 'presente', sensibilidad: 'ordinario', valor: indice } },
    evidenciaIntegridad: [] };
}

function crearIds() {
  const id = (tipo) => String(generador.generar(tipo));
  const installationLocal = generador.generar(TIPOS_IDENTIDAD_FEDERADA.INSTALACION);
  return { installationLocal, installationLocalId: String(installationLocal),
    installationRemotaId: id(TIPOS_IDENTIDAD_FEDERADA.INSTALACION),
    bootId: id(TIPOS_IDENTIDAD_FEDERADA.ARRANQUE),
    relacionId: id(TIPOS_IDENTIDAD_FEDERADA.RELACION),
    flujoId: id(TIPOS_IDENTIDAD_FEDERADA.FLUJO),
    generacionId: id(TIPOS_IDENTIDAD_FEDERADA.GENERACION),
    elementoIds: Array.from({ length: 3 }, () => id(TIPOS_IDENTIDAD_FEDERADA.ELEMENTO_ORIGEN)),
    ocurrenciaIds: Array.from({ length: 3 }, () => id(TIPOS_IDENTIDAD_FEDERADA.OCURRENCIA_ORIGEN)) };
}

function identidadOpaca(tipo, valor) {
  return crearIdentidadFederada({ tipo, valor });
}

async function limpiarSql(sql, ids) {
  await sql.ejecutar('DELETE FROM control_generaciones_emision_federacion WHERE generacion_id=?', [ids.generacionId]).catch(() => {});
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

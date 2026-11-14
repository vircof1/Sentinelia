import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';

import { RepositorioCursoresRecepcionFederacionSql } from '../paquetes/federacion/adaptadores/RepositorioCursoresRecepcionFederacionSql.js';
import { RepositorioDisponibilidadFederacionSql } from '../paquetes/federacion/adaptadores/RepositorioDisponibilidadFederacionSql.js';
import { RepositorioEntregasFederacionSql } from '../paquetes/federacion/adaptadores/RepositorioEntregasFederacionSql.js';
import { RepositorioFlujosFederacionSql } from '../paquetes/federacion/adaptadores/RepositorioFlujosFederacionSql.js';
import { RepositorioInboxFederacionSql } from '../paquetes/federacion/adaptadores/RepositorioInboxFederacionSql.js';
import { RepositorioPoliticasRetencionFederacionSql } from '../paquetes/federacion/adaptadores/RepositorioPoliticasRetencionFederacionSql.js';
import { FuenteEntropiaCriptograficaNode } from '../paquetes/federacion/adaptadores/FuenteEntropiaCriptograficaNode.js';
import { ServicioDisponibilidadFederacion } from '../paquetes/federacion/aplicacion/ServicioDisponibilidadFederacion.js';
import { ServicioPoliticasRetencionFederacion } from '../paquetes/federacion/aplicacion/ServicioPoliticasRetencionFederacion.js';
import { ServicioRecepcionLotesFederacionLocal } from '../paquetes/federacion/aplicacion/ServicioRecepcionLotesFederacionLocal.js';
import { crearCampoPresenteFederado } from '../paquetes/federacion/src/EnvolventeFederacion.js';
import { GeneradorIdentidadesFederadas, TIPOS_IDENTIDAD_FEDERADA } from '../paquetes/federacion/src/IdentidadFederada.js';
import {
  clasificarDescarteRetencionOcurrenciaFederada
} from '../paquetes/federacion/src/ClasificadorRetencionOcurrenciaFederada.js';
import {
  PERFIL_PAYLOAD_MONITORES_FEDERACION
} from '../paquetes/federacion/src/PayloadMonitoresFederacion.js';
import { PERFIL_PAYLOAD_TELEMETRIA_FEDERACION } from '../paquetes/federacion/src/PayloadTelemetriaFederacion.js';
import { generarUuidV7Auditoria } from '../paquetes/auditoria/src/UuidV7Auditoria.js';
import { RepositorioAvisosPlataformaSql } from '../paquetes/avisos-plataforma/src/RepositorioAvisosPlataformaSql.js';
import { ServicioAvisosPlataforma } from '../paquetes/avisos-plataforma/src/ServicioAvisosPlataforma.js';
import { ClienteSql } from '../paquetes/persistencia-sql/src/ClienteSql.js';
import { ControladorDatosFederacion } from '../apps/sentinelia-web/src/controladores/ControladorDatosFederacion.js';
import { obtenerConfiguracionAplicacion } from '../paquetes/utilidades/src/configuracion/obtenerConfiguracionAplicacion.js';
import { migrar } from './federacion-verificar-5-22-15g.js';

const USUARIO_FIXTURE = 5_221_705;
const generador = new GeneradorIdentidadesFederadas({
  fuenteEntropia: new FuenteEntropiaCriptograficaNode()
});

await main();

async function main() {
  await verificarFronteraPublica();
  verificarRetencionTramoHistoricoPorExtremoReciente();
  const configuracion = obtenerConfiguracionAplicacion();
  assert.equal(configuracion.sql.estaCompleta, true);
  const baseDatos = `sentinelia_fixture_52217e_${randomBytes(6).toString('hex')}`;
  const administrador = new ClienteSql(configuracion.sql);
  let sql;
  try {
    await administrador.ejecutar(
      `CREATE DATABASE ${administrador.escaparIdentificador(baseDatos)} CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`
    );
    sql = new ClienteSql({ ...configuracion.sql, baseDatos });
    await migrar(sql);
    await verificarDeclaracionesYHueco(sql);
    await verificarDescarteDeliberado(sql);
  } finally {
    await sql?.cerrar().catch(() => {});
    await administrador.ejecutar(
      `DROP DATABASE IF EXISTS ${administrador.escaparIdentificador(baseDatos)}`
    ).catch(() => {});
    await administrador.cerrar();
  }
  console.log(
    '[federacion] OK 5.22.17e: disponibilidad=durable ' +
    'hueco=explicito saturacion=hueco_recuperable ' +
    'retencion_transito=hueco_irrecuperable_explicito degradacion=historica ' +
    'descarte=terminal_sin_payload replay=idempotente ' +
    'replay_multientrega=idempotente conflicto_post_descarte=degradante'
  );
}

function verificarRetencionTramoHistoricoPorExtremoReciente() {
  const monitorOrigenId = id(TIPOS_IDENTIDAD_FEDERADA.ELEMENTO_ORIGEN);
  const ocurrencia = {
    familia: 'monitores',
    familiaVersion: 1,
    installationOrigenId: id(TIPOS_IDENTIDAD_FEDERADA.INSTALACION),
    elementoOrigenId: id(TIPOS_IDENTIDAD_FEDERADA.ELEMENTO_ORIGEN),
    ocurrenciaOrigenId: id(TIPOS_IDENTIDAD_FEDERADA.OCURRENCIA_ORIGEN),
    secuenciaElemento: '1',
    operacion: 'actualizacion',
    tiempoOrigenUtc: '2030-01-10T00:00:00.000Z',
    scopeOrigenDeclarado: {
      nivel: 'portal', tenantId: null, empresaId: null, sitioId: null
    },
    vigenciaRestanteMs: null,
    campos: {
      monitores: crearCampoPresenteFederado({
        valor: {
          perfil: PERFIL_PAYLOAD_MONITORES_FEDERACION,
          version: 1,
          tipoRegistro: 'tramoHistorico',
          monitorOrigenId,
          versionCatalogo: '1',
          tipoMonitor: 'tcp',
          estadoTramo: 'indisponible',
          codigoUltimoResultado: 'timeout',
          mensajeUltimoResultado: 'Sin respuesta.',
          validoDesdeUtc: '2030-01-01T00:00:00.000Z',
          validoHastaUtc: '2030-01-10T00:00:00.000Z',
          contadorRepeticiones: 10,
          ultimoEventoOrigenId: null,
          payloadTramo: null,
          contextoHumano: { descripcionFallo: '', posibleSolucion: '' }
        }
      })
    },
    evidenciaIntegridad: []
  };
  assert.deepEqual(
    clasificarDescarteRetencionOcurrenciaFederada(ocurrencia),
    {
      tiempoEfectivoOrigenUtc: '2030-01-10T00:00:00.000Z',
      vigenteHastaOrigenUtc: null
    }
  );
}

async function verificarFronteraPublica() {
  const contexto = {
    relacionId: id(TIPOS_IDENTIDAD_FEDERADA.RELACION),
    flujoId: id(TIPOS_IDENTIDAD_FEDERADA.FLUJO),
    generacionId: id(TIPOS_IDENTIDAD_FEDERADA.GENERACION),
    installationRemotaId: id(TIPOS_IDENTIDAD_FEDERADA.INSTALACION)
  };
  const entrada = declaracion(contexto, {
    tipo: 'huecoIrrecuperable', inicio: '1', fin: '1',
    causa: 'ausenciaConfirmada', agotadas: true
  });
  const interna = {
    ...entrada,
    recibidaEnUtc: new Date().toISOString(),
    aplicadaCursor: true,
    yaConocida: false,
    scopeRecepcion: { tenantId: '10', empresaId: '20', sitioId: null }
  };
  const controlador = new ControladorDatosFederacion({
    servicioRecepcionLotes: {
      entregarLote: async () => {},
      esReplayTerminalExacto: async () => false
    },
    repositorioCursores: { obtenerProgresoParaRelacion: async () => null },
    servicioDisponibilidad: {
      registrar: async () => ({
        declaracion: interna,
        progreso: { posicionTerminalContigua: '1' },
        aviso: { avisoId: generarUuidV7Auditoria(), scope: interna.scopeRecepcion }
      })
    },
    repositorioDisponibilidad: { listarParaRelacion: async () => [] },
    resolutorCapacidad: { resolver: async () => ({}) }
  });
  let cuerpo;
  let error;
  await controlador.registrarDisponibilidad({
    params: { flujoId: contexto.flujoId, generacionId: contexto.generacionId },
    sesionFederacion: { relacionId: contexto.relacionId },
    body: entrada
  }, {
    set() { return this; },
    json(valor) { cuerpo = valor; return valor; }
  }, (observado) => { error = observado; });
  assert.equal(error, undefined);
  assert.equal(cuerpo.avisoPlataformaActualizado, true);
  assert.equal(Object.hasOwn(cuerpo.declaracion, 'scopeRecepcion'), false);
  assert.equal(Object.hasOwn(cuerpo, 'aviso'), false);
}

async function verificarDeclaracionesYHueco(sql) {
  const contexto = await crearDestino(sql);
  const repositorioDisponibilidad = new RepositorioDisponibilidadFederacionSql(sql);
  const repositorioCursores = new RepositorioCursoresRecepcionFederacionSql(sql);
  const avisos = [];
  const servicioAvisosPlataforma = new ServicioAvisosPlataforma({
    repositorioAvisos: new RepositorioAvisosPlataformaSql(sql, {
      adaptadorAuditoria: {
        registrarTransicionEnTransaccion: async (evento) => {
          avisos.push(evento);
          return { eventoId: evento.eventoId };
        }
      }
    })
  });
  const servicio = new ServicioDisponibilidadFederacion({
    clienteSql: sql,
    repositorioDisponibilidad,
    repositorioCursores,
    servicioAvisosPlataforma
  });
  const disponible = declaracion(contexto, {
    tipo: 'rangoDisponible', inicio: '1', fin: '20',
    causa: 'inventarioFuente', agotadas: false
  });
  const resultadoDisponible = await servicio.registrar(disponible);
  assert.equal(resultadoDisponible.progreso, null);
  assert.equal(await repositorioCursores.obtenerProgreso({
    flujoId: contexto.flujoId,
    generacionId: contexto.generacionId
  }), null);

  const recuperable = declaracion(contexto, {
    tipo: 'huecoRecuperable', inicio: '1', fin: '1',
    causa: 'saturacionRetencion', agotadas: false
  });
  assert.equal((await servicio.registrar(recuperable)).progreso, null);
  assert.equal(avisos.length, 0);

  const irrecuperable = declaracion(contexto, {
    tipo: 'huecoIrrecuperable', inicio: '1', fin: '2',
    causa: 'retencionEmisor', agotadas: true
  });
  const aplicado = await servicio.registrar(irrecuperable);
  assert.equal(aplicado.declaracion.aplicadaCursor, true);
  assert.equal(aplicado.progreso.posicionTerminalContigua, '2');
  assert.equal(aplicado.progreso.prefijoDegradado, true);
  assert.equal(avisos.length, 1);
  const [conteoAvisos] = await sql.consultar(
    "SELECT COUNT(*) AS total FROM avisos_plataforma WHERE tipo_codigo='generacion' AND causa_codigo='hueco_irrecuperable'"
  );
  assert.equal(Number(conteoAvisos.total), 1);
  const [frontera] = await sql.consultar(
    `SELECT operativamente_completa,historicamente_completa,degradada
       FROM fronteras_generaciones_federacion WHERE generacion_id=?`,
    [contexto.generacionId]
  );
  assert.equal(Boolean(frontera.operativamente_completa), false);
  assert.equal(Boolean(frontera.historicamente_completa), false);
  assert.equal(Boolean(frontera.degradada), true);
  const versionAntes = aplicado.progreso.version;
  const replay = await servicio.registrar(irrecuperable);
  assert.equal(replay.declaracion.yaConocida, true);
  assert.equal(replay.progreso.version, versionAntes);
  assert.equal(avisos.length, 1);
  const solapadoYaTerminal = declaracion(contexto, {
    tipo: 'huecoIrrecuperable', inicio: '1', fin: '1',
    causa: 'ausenciaConfirmada', agotadas: true
  });
  const reaplicado = await servicio.registrar(solapadoYaTerminal);
  assert.equal(reaplicado.progreso.posicionTerminalContigua, '2');
  assert.deepEqual(reaplicado.progreso.rangosTerminalesDispersos, []);
  assert.equal(avisos.length, 2);
  assert.equal((await repositorioDisponibilidad.listarParaRelacion({
    relacionId: contexto.relacionId,
    flujoId: contexto.flujoId,
    generacionId: contexto.generacionId
  })).length, 4);
}

async function verificarDescarteDeliberado(sql) {
  const contexto = await crearDestino(sql);
  await new ServicioPoliticasRetencionFederacion({
    repositorioPoliticas: new RepositorioPoliticasRetencionFederacionSql(sql),
    servicioConfiguracionPortal: configuracionRetencionFixture()
  }).reconciliarLimiteGlobal();
  const repositorioDisponibilidad = new RepositorioDisponibilidadFederacionSql(sql);
  const servicio = new ServicioRecepcionLotesFederacionLocal({
    clienteSql: sql,
    repositorioEntregas: new RepositorioEntregasFederacionSql(sql),
    repositorioInbox: new RepositorioInboxFederacionSql(sql),
    repositorioCursores: new RepositorioCursoresRecepcionFederacionSql(sql),
    repositorioDisponibilidad
  });
  const lote = loteHistorico(contexto);
  const recibido = await servicio.entregarLote(lote);
  assert.equal(recibido.resultados[0].resultado, 'descartadaPorRetencion');
  assert.equal(recibido.resultados[0].confirmada, true);
  assert.equal(Object.hasOwn(recibido.resultados[0], 'inboxId'), false);
  assert.equal(recibido.progreso.posicionTerminalContigua, '1');
  assert.equal(recibido.progreso.prefijoDegradado, false);
  const [entrega] = await sql.consultar(
    `SELECT causa_descarte,contenido_descartado_en_utc,
            JSON_UNQUOTE(JSON_EXTRACT(ocurrencia_canonica,'$.perfil')) AS perfil
       FROM entregas_recepcion_federacion WHERE entrega_id=?`,
    [lote.entregas[0].entregaId]
  );
  assert.equal(entrega.causa_descarte, 'retencionReceptor');
  assert.equal(entrega.perfil, 'sentinelia-federacion-descarte-retencion-v1');
  assert.ok(entrega.contenido_descartado_en_utc);
  const [descartes] = await sql.consultar(
    'SELECT COUNT(*) AS total FROM descartes_retencion_recepcion_federacion WHERE entrega_id=?',
    [lote.entregas[0].entregaId]
  );
  assert.equal(Number(descartes.total), 1);
  const [inbox] = await sql.consultar('SELECT COUNT(*) AS total FROM inbox_ocurrencias_federacion');
  assert.equal(Number(inbox.total), 0);
  const replay = await servicio.entregarLote(lote);
  assert.equal(replay.clase, 'replayTerminal');
  assert.equal(replay.resultados[0].resultado, 'descartadaPorRetencion');
  assert.equal(replay.resultados[0].reutilizado, true);

  const otraEntrega = structuredClone(lote);
  otraEntrega.loteId = id(TIPOS_IDENTIDAD_FEDERADA.LOTE);
  otraEntrega.entregas[0].entregaId = id(TIPOS_IDENTIDAD_FEDERADA.ENTREGA);
  otraEntrega.entregas[0].posicionFlujo = '2';
  const conocidaPorOtraEntrega = await servicio.entregarLote(otraEntrega);
  assert.equal(conocidaPorOtraEntrega.resultados[0].resultado, 'descartadaPorRetencion');
  assert.equal(conocidaPorOtraEntrega.resultados[0].reutilizado, true);
  assert.equal(conocidaPorOtraEntrega.progreso.posicionTerminalContigua, '2');
  const [descartesTrasOtraEntrega] = await sql.consultar(
    'SELECT COUNT(*) AS total FROM descartes_retencion_recepcion_federacion WHERE relacion_id=?',
    [contexto.relacionId]
  );
  assert.equal(Number(descartesTrasOtraEntrega.total), 1);
  const [segundaEntrega] = await sql.consultar(
    `SELECT causa_descarte,
            JSON_UNQUOTE(JSON_EXTRACT(ocurrencia_canonica,'$.perfil')) AS perfil
       FROM entregas_recepcion_federacion WHERE entrega_id=?`,
    [otraEntrega.entregas[0].entregaId]
  );
  assert.equal(segundaEntrega.causa_descarte, 'retencionReceptor');
  assert.equal(segundaEntrega.perfil, 'sentinelia-federacion-descarte-retencion-v1');

  const divergente = structuredClone(lote);
  divergente.loteId = id(TIPOS_IDENTIDAD_FEDERADA.LOTE);
  divergente.entregas[0].entregaId = id(TIPOS_IDENTIDAD_FEDERADA.ENTREGA);
  divergente.entregas[0].posicionFlujo = '3';
  divergente.entregas[0].ocurrencia.campos.telemetria.valor.valor = 43;
  const conflicto = await servicio.entregarLote(divergente);
  assert.equal(conflicto.resultados[0].resultado, 'rechazadaDefinitiva');
  assert.equal(conflicto.resultados[0].errorTerminal, 'descarteRetencionDivergente');
  assert.equal(conflicto.resultados[0].confirmada, false);
  assert.equal(conflicto.progreso.posicionTerminalContigua, '3');
  assert.equal(conflicto.progreso.prefijoDegradado, true);

  const invalido = structuredClone(lote);
  invalido.loteId = id(TIPOS_IDENTIDAD_FEDERADA.LOTE);
  invalido.entregas[0].entregaId = id(TIPOS_IDENTIDAD_FEDERADA.ENTREGA);
  invalido.entregas[0].posicionFlujo = '4';
  invalido.entregas[0].ocurrencia.ocurrenciaOrigenId =
    id(TIPOS_IDENTIDAD_FEDERADA.OCURRENCIA_ORIGEN);
  invalido.entregas[0].ocurrencia.secuenciaElemento = '0';
  const rechazo = await servicio.entregarLote(invalido);
  assert.equal(rechazo.resultados[0].resultado, 'rechazadaDefinitiva');
  const [descartesFinales] = await sql.consultar(
    'SELECT COUNT(*) AS total FROM descartes_retencion_recepcion_federacion WHERE relacion_id=?',
    [contexto.relacionId]
  );
  assert.equal(Number(descartesFinales.total), 1);

  const servicioDisponibilidad = new ServicioDisponibilidadFederacion({
    clienteSql: sql,
    repositorioDisponibilidad,
    repositorioCursores: new RepositorioCursoresRecepcionFederacionSql(sql)
  });
  await assert.rejects(
    servicioDisponibilidad.registrar(declaracion(contexto, {
      tipo: 'huecoIrrecuperable', inicio: '1', fin: '1',
      causa: 'ausenciaConfirmada', agotadas: true
    })),
    (error) => error.codigo === 'hueco_solapa_entrega_recibida'
  );
}

async function crearDestino(sql) {
  const contexto = {
    installationLocalId: id(TIPOS_IDENTIDAD_FEDERADA.INSTALACION),
    installationRemotaId: id(TIPOS_IDENTIDAD_FEDERADA.INSTALACION),
    bootRemotoId: id(TIPOS_IDENTIDAD_FEDERADA.ARRANQUE),
    relacionId: id(TIPOS_IDENTIDAD_FEDERADA.RELACION),
    flujoId: id(TIPOS_IDENTIDAD_FEDERADA.FLUJO),
    generacionId: id(TIPOS_IDENTIDAD_FEDERADA.GENERACION)
  };
  const ahora = new Date();
  await sql.ejecutar(
    `INSERT INTO relaciones_federacion (
       relacion_id,direccion,estado_ciclo,estado_autoridad,estado_identidad,
       estado_compatibilidad,installation_remota_candidata_id,installation_remota_id,
       nombre_remoto_declarado,responsable_usuario_id,responsable_original_usuario_id,
       scope_tenant_id,scope_empresa_id,scope_sitio_id,version_autoridad,
       corte_autoridad_utc,creada_por_usuario_id,creada_en_utc,actualizada_en_utc,revision
     ) VALUES (?,'recepcion','vinculada','autorizada','valida','compatible',?,?,?,
       ?,?,'10','20',NULL,1,NULL,?,?,?,1)`,
    [contexto.relacionId,contexto.installationRemotaId,contexto.installationRemotaId,
      'instancia remota 17e',USUARIO_FIXTURE,USUARIO_FIXTURE,
      USUARIO_FIXTURE,ahora,ahora]
  );
  await new RepositorioFlujosFederacionSql(sql, {
    installationLocalId: contexto.installationLocalId
  }).crearFlujoInicial({
    flujo: {
      flujoId: contexto.flujoId,
      relacionId: contexto.relacionId,
      direccion: 'recepcion',
      familia: 'telemetria',
      versionFamilia: 1,
      contexto: { nivel: 'empresa', tenantId: '10', empresaId: '20', sitioId: null }
    },
    generacion: {
      generacionId: contexto.generacionId,
      clase: 'inicial',
      fronteraInicial: '0',
      propietario: {
        installationId: contexto.installationRemotaId,
        bootId: contexto.bootRemotoId,
        version: 1
      }
    }
  });
  return Object.freeze(contexto);
}

function declaracion(contexto, { tipo, inicio, fin, causa, agotadas }) {
  return {
    perfil: 'sentinelia-federacion-disponibilidad-v1',
    version: 1,
    declaracionId: generarUuidV7Auditoria(),
    relacionId: contexto.relacionId,
    flujoId: contexto.flujoId,
    generacionId: contexto.generacionId,
    installationDeclaranteId: contexto.installationRemotaId,
    familia: 'telemetria',
    tipo,
    inicioPosicion: inicio,
    finPosicion: fin,
    causa,
    rutasAlternativasAgotadas: agotadas,
    declaradaEnOrigenUtc: new Date(Date.now() - 1_000).toISOString()
  };
}

function loteHistorico(contexto) {
  const fuenteOrigenId = id(TIPOS_IDENTIDAD_FEDERADA.ELEMENTO_ORIGEN);
  const senalOrigenId = id(TIPOS_IDENTIDAD_FEDERADA.ELEMENTO_ORIGEN);
  const ocurrencia = {
    familia: 'telemetria',
    familiaVersion: 1,
    installationOrigenId: contexto.installationRemotaId,
    elementoOrigenId: id(TIPOS_IDENTIDAD_FEDERADA.ELEMENTO_ORIGEN),
    ocurrenciaOrigenId: id(TIPOS_IDENTIDAD_FEDERADA.OCURRENCIA_ORIGEN),
    secuenciaElemento: '1',
    operacion: 'actualizacion',
    tiempoOrigenUtc: '2020-01-01T00:00:00.000Z',
    scopeOrigenDeclarado: {
      nivel: 'empresa',tenantId: 'tenant-remoto',empresaId: 'empresa-remota',sitioId: null
    },
    vigenciaRestanteMs: null,
    campos: {
      telemetria: crearCampoPresenteFederado({
        valor: {
          perfil: PERFIL_PAYLOAD_TELEMETRIA_FEDERACION,
          version: 1,
          tipoRegistro: 'observacion',
          fuenteOrigenId,
          senalOrigenId,
          periodoPolOrigenId: null,
          categoria: 'sistema',
          clave: 'carga',
          tag: '',
          codigoSenal: 'sistema.carga',
          tipoDato: 'numero',
          unidad: '%',
          valor: 42,
          calidad: 'buena',
          severidadDeclarada: 'informativa',
          origen: 'agente',
          vigenteHastaUtc: null,
          detalleHumano: 'Histórico fuera de retención',
          metadatosContextuales: {},
          emitidoEnUtc: '2020-01-01T00:00:00.000Z',
          observadoEnUtc: '2020-01-01T00:00:00.000Z',
          recibidoEnUtc: '2020-01-01T00:00:01.000Z'
        }
      })
    },
    evidenciaIntegridad: []
  };
  return {
    loteId: id(TIPOS_IDENTIDAD_FEDERADA.LOTE),
    relacionId: contexto.relacionId,
    flujoId: contexto.flujoId,
    generacionId: contexto.generacionId,
    entregas: [{
      entregaId: id(TIPOS_IDENTIDAD_FEDERADA.ENTREGA),
      posicionFlujo: '1',
      ocurrencia
    }]
  };
}

function configuracionRetencionFixture() {
  return {
    asegurarActualizada: async () => {},
    obtenerConfiguracionActual: () => ({
      version: 1,
      obtenerConfiguracionFederacion: () => ({ retencionMaximaDias: 30 })
    })
  };
}

function id(tipo) {
  return String(generador.generar(tipo));
}

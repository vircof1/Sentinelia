import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';

import { EjecutorMonitorBooleano }
  from '../apps/sentinelia-runtime/src/ejecucion/EjecutorMonitorBooleano.js';
import { EjecutorMonitorTelemetria }
  from '../apps/sentinelia-runtime/src/ejecucion/EjecutorMonitorTelemetria.js';
import { RepositorioTelemetriaRemotaSql }
  from '../paquetes/federacion/adaptadores/RepositorioTelemetriaRemotaSql.js';
import {
  CONDICION_FUENTE_FEDERADA_RETIRADA,
  MENSAJE_FUENTE_FEDERADA_RETIRADA
} from '../paquetes/monitores/src/CondicionFuenteFederada.js';
import {
  interpretarEntradaFederadaMonitorLogico,
  resolverTransicionEntradaFederadaMonitorLogico
} from '../paquetes/monitores/src/ResolucionEntradaFederadaMonitorLogico.js';

const IDS = Object.freeze({
  proyeccion: id('proyeccion'),
  proyeccionSecundaria: id('proyeccion'),
  instalacion: id('instalacion'),
  elemento: id('elemento_origen'),
  ocurrencia: id('ocurrencia_origen'),
  generacion: id('generacion'),
  flujo: id('flujo')
});

await verificarCondicionComunYCandidatoCancelado();
await verificarMonitorLogicoCompuestoSinEfectos();
await verificarRepositorioConservaRetiradaSinFotografia();
await verificarMonitorTelemetriaNoReutilizaUltimoValor();

console.log(
  '[agentes] OK 5.25.7: condicion=fuente_retirada logico=entrada_y_compuesto ' +
    'candidatos=cancelados telemetria=no_reutiliza_valor historia=conservada ' +
    'configuracion=local_reparable triggers=suprimidos replay=estable'
);

async function verificarCondicionComunYCandidatoCancelado() {
  const entrada = entradaRetirada({
    variable: 'A',
    proyeccionId: IDS.proyeccion
  });
  const objetivo = interpretarEntradaFederadaMonitorLogico({
    variable: 'A',
    fuente: 'monitor_federado',
    proyeccionId: IDS.proyeccion
  }, entrada);
  assert.equal(objetivo.condicionFuente, CONDICION_FUENTE_FEDERADA_RETIRADA);
  assert.equal(objetivo.bloqueaEvaluacion, true);
  assert.equal(objetivo.motivoBloqueo, MENSAJE_FUENTE_FEDERADA_RETIRADA);
  const resuelta = resolverTransicionEntradaFederadaMonitorLogico({
    objetivo,
    observadoEnUtc: '2031-06-07T08:09:10.000Z',
    epocaObservacion: 'epoca-5-25-7',
    estadoPersistido: {
      valorBinarioEfectivo: true,
      condicionFuente: 'vigente',
      ultimoEstadoRemotoEstable: 'correcto',
      revisionConfiguracionAplicada: 1,
      candidatoValor: false,
      candidatoCondicion: 'vigente',
      candidatoIniciadoEnUtc: '2031-06-07T08:08:00.000Z',
      candidatoVenceEnUtc: '2031-06-07T08:10:00.000Z',
      candidatoRevisionConfiguracion: 1,
      evidenciaEfectiva: null,
      evidenciaCandidata: { secuenciaElemento: '7' },
      epocaObservacion: 'epoca-5-25-7',
      requiereObservacionCompleta: false,
      versionEstado: 3
    }
  });
  assert.equal(resuelta.condicionFuente, CONDICION_FUENTE_FEDERADA_RETIRADA);
  assert.equal(resuelta.candidatoPendiente, false);
  assert.equal(resuelta.candidatoValor, null);
  assert.equal(resuelta.transicionAplicada, false);
}

async function verificarMonitorLogicoCompuestoSinEfectos() {
  const entradas = [
    entradaDurableRetirada('A', IDS.proyeccion),
    entradaDurableVigente('B', IDS.proyeccionSecundaria)
  ];
  const ejecutor = new EjecutorMonitorBooleano({
    repositorioEntradasFederadas: {
      observarEntradasOperativasPorMonitorId: async () => entradas
    }
  });
  const monitor = monitorLogicoCompuesto();
  const anterior = {
    ejecutadoTodavia: true,
    estado: 'disponible',
    resultadoActual: {
      causalidadFederada: {
        version: 1,
        transicionMonitorId: 'monitor-federado:anterior',
        causas: [{ condicionFuente: 'vigente' }]
      }
    }
  };
  const primera = await ejecutor.ejecutar(monitor, {
    ejecutadoEnUtc: '2031-06-07T08:09:10.000Z',
    almacenEstadoActual: { buscarPorMonitorId: () => anterior }
  });
  assert.equal(primera.metricaPrincipal.bloqueaEvaluacion, true);
  assert.equal(primera.metricaPrincipal.totalEntradasFederadas, 2);
  assert.equal(primera.codigoResultado, CONDICION_FUENTE_FEDERADA_RETIRADA);
  assert.equal(primera.mensajeResultado, MENSAJE_FUENTE_FEDERADA_RETIRADA);
  assert.equal(primera.detalleError.mensaje, MENSAJE_FUENTE_FEDERADA_RETIRADA);
  assert.equal(primera.efectosDerivadosHabilitados, false);
  assert.equal(
    primera.causalidadFederada.causas[0].condicionFuente,
    CONDICION_FUENTE_FEDERADA_RETIRADA
  );
  const repetida = await ejecutor.ejecutar(monitor, {
    ejecutadoEnUtc: '2031-06-07T08:09:11.000Z',
    almacenEstadoActual: {
      buscarPorMonitorId: () => ({
        ejecutadoTodavia: true,
        estado: primera.estadoDetectado,
        resultadoActual: { causalidadFederada: primera.causalidadFederada }
      })
    }
  });
  assert.equal(repetida.efectosDerivadosHabilitados, false);
  assert.equal(
    repetida.causalidadFederada.transicionMonitorId,
    primera.causalidadFederada.transicionMonitorId
  );
  assert.deepEqual(monitor.configuracion.dependencias.map(
    ({ variable, proyeccionId }) => ({ variable, proyeccionId })
  ), [
    { variable: 'A', proyeccionId: IDS.proyeccion },
    { variable: 'B', proyeccionId: IDS.proyeccionSecundaria }
  ]);
}

async function verificarRepositorioConservaRetiradaSinFotografia() {
  const consultas = [];
  const escrituras = [];
  const clienteSql = {
    obtenerConexion() {
      throw new Error('La resolución de lectura no debe abrir una transacción.');
    },
    async consultar(sql, parametros) {
      consultas.push({ sql, parametros });
      if (sql.includes('retiradas_origen_proyecciones_federacion')) {
        return [filaRetirada()];
      }
      if (sql.includes('WITH registros_actuales AS')) {
        throw new Error('Una retirada definitiva prevalece sobre la fotografía anterior.');
      }
      throw new Error(`Consulta inesperada en 5.25.7: ${sql}`);
    },
    async ejecutar(...argumentos) {
      escrituras.push(argumentos);
      throw new Error('La lectura de retirada no puede escribir ni borrar historia.');
    }
  };
  const repositorio = new RepositorioTelemetriaRemotaSql(clienteSql);
  const resuelta = await repositorio.resolverFuenteMonitorizable({
    proyeccionId: IDS.proyeccion
  });
  assert.equal(resuelta.condicionFuente, CONDICION_FUENTE_FEDERADA_RETIRADA);
  assert.equal(resuelta.registro, null);
  assert.equal(resuelta.retirada.ocurrenciaOrigenId, IDS.ocurrencia);
  assert.equal(resuelta.retirada.secuenciaElemento, '12');
  assert.equal(escrituras.length, 0);
  assert.equal(consultas.length, 1);
  assert.match(consultas[0].sql, /retiradas_origen_proyecciones_federacion/u);
  assert.doesNotMatch(consultas[0].sql, /DELETE\s+FROM/iu);
}

async function verificarMonitorTelemetriaNoReutilizaUltimoValor() {
  const repositorioTelemetriaRemota = new RepositorioTelemetriaRemotaSql({
    obtenerConexion() {
      throw new Error('La lectura runtime no debe abrir una transacción.');
    },
    async consultar(sql) {
      if (sql.includes('retiradas_origen_proyecciones_federacion')) {
        return [filaRetirada()];
      }
      if (sql.includes('WITH registros_actuales AS')) {
        throw new Error('El monitor no debe releer una fotografía ya retirada.');
      }
      throw new Error(`Consulta inesperada en monitor de telemetría: ${sql}`);
    }
  });
  const vinculo = {
    tipoFuente: 'senal_federada',
    fuente: { proyeccionId: IDS.proyeccion },
    esSenalDirecta: () => false,
    esSenalFederada: () => true
  };
  const ejecutor = new EjecutorMonitorTelemetria({
    repositorioVinculos: { buscarPorMonitorId: async () => vinculo },
    repositorioTelemetriaRemota,
    reloj: () => new Date('2031-06-07T08:09:10.000Z')
  });
  const monitor = monitorTelemetria();
  const previa = {
    ejecutadoTodavia: true,
    estado: 'disponible',
    resultadoActual: {
      causalidadFederada: {
        version: 1,
        transicionMonitorId: 'telemetria-federada:anterior',
        causas: [{ condicionFuente: 'publicada' }]
      }
    }
  };
  const primera = await ejecutor.ejecutar(monitor, {
    ejecutadoEnUtc: '2031-06-07T08:09:10.000Z',
    almacenEstadoActual: { buscarPorMonitorId: () => previa }
  });
  assert.equal(primera.estadoDetectado, 'desconocido');
  assert.equal(primera.codigoResultado, CONDICION_FUENTE_FEDERADA_RETIRADA);
  assert.equal(primera.mensajeResultado, MENSAJE_FUENTE_FEDERADA_RETIRADA);
  assert.equal(primera.efectosDerivadosHabilitados, false);
  assert.equal(
    primera.causalidadFederada.causas[0].condicionFuente,
    CONDICION_FUENTE_FEDERADA_RETIRADA
  );
  assert.equal(primera.metricaPrincipal.resultadoEvaluado.estado, 'desconocido');
  const repetida = await ejecutor.ejecutar(monitor, {
    ejecutadoEnUtc: '2031-06-07T08:09:11.000Z',
    almacenEstadoActual: {
      buscarPorMonitorId: () => ({
        ejecutadoTodavia: true,
        estado: primera.estadoDetectado,
        resultadoActual: { causalidadFederada: primera.causalidadFederada }
      })
    }
  });
  assert.equal(repetida.efectosDerivadosHabilitados, false);
  assert.equal(
    repetida.causalidadFederada.transicionMonitorId,
    primera.causalidadFederada.transicionMonitorId
  );
}

function entradaRetirada({ variable, proyeccionId }) {
  return {
    entradaId: variable === 'A' ? 1 : 2,
    variable,
    proyeccionId,
    revisionConfiguracion: 1,
    estadoInicial: 'correcto',
    inversion: false,
    retardoCambioSegundos: 60,
    politicaPerdidaEnFallo: 'conservar',
    politicaPerdidaEnCorrecto: 'conservar',
    estadoVigencia: 'retirada',
    estadoSoporte: 'retirada',
    estadoAutorizacion: 'autorizada',
    estadoCoherencia: 'coherente',
    condicionTemporal: 'retirada',
    generacionId: IDS.generacion,
    secuenciaElemento: '12',
    ocurrenciaOrigenId: IDS.ocurrencia,
    transicionTemporalId: '0195f4cf-e640-7000-8000-000000000001'
  };
}

function entradaDurableRetirada(variable, proyeccionId) {
  return {
    ...entradaRetirada({ variable, proyeccionId }),
    fuente: 'monitor_federado',
    referencia: proyeccionId,
    interpretacionDurable: true,
    valorBinarioEfectivo: true,
    condicionFuente: CONDICION_FUENTE_FEDERADA_RETIRADA,
    bloqueaEvaluacion: true,
    motivoBloqueo: MENSAJE_FUENTE_FEDERADA_RETIRADA,
    candidatoPendiente: false,
    transicionAplicada: false,
    evidenciaEfectiva: {
      generacionId: IDS.generacion,
      secuenciaElemento: '12',
      ocurrenciaOrigenId: IDS.ocurrencia,
      transicionTemporalId: '0195f4cf-e640-7000-8000-000000000001'
    }
  };
}

function entradaDurableVigente(variable, proyeccionId) {
  return {
    entradaId: 2,
    variable,
    fuente: 'monitor_federado',
    referencia: proyeccionId,
    proyeccionId,
    revisionConfiguracion: 1,
    interpretacionDurable: true,
    valorBinarioEfectivo: true,
    condicionFuente: 'vigente',
    bloqueaEvaluacion: false,
    motivoBloqueo: null,
    candidatoPendiente: false,
    transicionAplicada: false,
    evidenciaEfectiva: {
      generacionId: IDS.generacion,
      secuenciaElemento: '4',
      ocurrenciaOrigenId: id('ocurrencia_origen'),
      transicionTemporalId: '0195f4cf-e640-7000-8000-000000000002'
    }
  };
}

function monitorLogicoCompuesto() {
  return {
    id: 57,
    nombre: 'Lógico compuesto local',
    tipo: 'booleano',
    configuracion: {
      version: 3,
      expresion: 'A AND B',
      mensajeFallo: 'Una entrada no está disponible',
      estadoInicial: 'disponible',
      retardoSenalSegundos: 0,
      dependencias: [
        dependencia('A', IDS.proyeccion),
        dependencia('B', IDS.proyeccionSecundaria)
      ]
    }
  };
}

function dependencia(variable, proyeccionId) {
  return {
    variable,
    fuente: 'monitor_federado',
    proyeccionId,
    estadoInicial: 'correcto',
    inversion: false,
    retardoCambioSegundos: 0,
    politicaPerdidaEnFallo: 'conservar',
    politicaPerdidaEnCorrecto: 'conservar'
  };
}

function monitorTelemetria() {
  return {
    id: 58,
    nombre: 'Telemetría federada local',
    tipo: 'telemetria',
    configuracion: {
      version: 1,
      retardoFalloSegundos: 120,
      condicion: {
        tipo: 'rango_numerico',
        tipoDato: 'numero',
        version: 1,
        minimo: 0,
        maximo: 80
      }
    }
  };
}

function filaRetirada() {
  return {
    proyeccion_id: IDS.proyeccion,
    installation_origen_id: IDS.instalacion,
    elemento_origen_id: IDS.elemento,
    ocurrencia_origen_id: IDS.ocurrencia,
    secuencia_retirada: '12',
    relacion_observadora_id: '0195f4cf-e640-7000-8000-000000000003',
    flujo_observador_id: IDS.flujo,
    generacion_observadora_id: IDS.generacion,
    creada_en_utc: new Date('2031-06-07T08:09:00.000Z')
  };
}

function id(tipo) {
  return `sfid1.${tipo}.${randomBytes(16).toString('base64url')}`;
}

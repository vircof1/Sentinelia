import assert from 'node:assert/strict';

import {
  RepositorioCatalogoSenalesTelemetriaAgentes
} from '../../paquetes/agentes/src/RepositorioCatalogoSenalesTelemetriaAgentes.js';
import {
  RepositorioEstadoActualTelemetriaAgentes
} from '../../paquetes/agentes/src/RepositorioEstadoActualTelemetriaAgentes.js';
import {
  RepositorioIdempotenciaLotesTelemetriaAgentes
} from '../../paquetes/agentes/src/RepositorioIdempotenciaLotesTelemetriaAgentes.js';
import {
  RepositorioObservacionesTelemetriaAgentes
} from '../../paquetes/agentes/src/RepositorioObservacionesTelemetriaAgentes.js';
import {
  ServicioIngestaTelemetriaAgentes
} from '../../paquetes/agentes/src/ServicioIngestaTelemetriaAgentes.js';
import { ClienteSql } from '../../paquetes/persistencia-sql/src/ClienteSql.js';
import {
  obtenerConfiguracionAplicacion
} from '../../paquetes/utilidades/src/configuracion/obtenerConfiguracionAplicacion.js';
import { crearLoteConcurrenciaTelemetria52411 } from './FixtureConcurrenciaTelemetria52411.js';

const configuracion = obtenerConfiguracionAplicacion();
const agenteId = Number(process.env.TELEMETRIA_52411_AGENTE_ID);
const telemetriaRequestId = process.env.TELEMETRIA_52411_REQUEST_ID;
const huellaLoteSha256 = Buffer.from(
  process.env.TELEMETRIA_52411_HUELLA_SHA256 || '',
  'hex'
);

assert.equal(configuracion.sql.estaCompleta, true);
assert.ok(Number.isInteger(agenteId) && agenteId > 0);
assert.equal(huellaLoteSha256.byteLength, 32);

const sql = new ClienteSql(configuracion.sql);
try {
  const resultado = await new ServicioIngestaTelemetriaAgentes({
    repositorioCatalogoSenales:
      new RepositorioCatalogoSenalesTelemetriaAgentes(sql),
    repositorioObservaciones:
      new RepositorioObservacionesTelemetriaAgentes(sql),
    repositorioEstadoActual:
      new RepositorioEstadoActualTelemetriaAgentes(sql),
    repositorioIdempotenciaLotes:
      new RepositorioIdempotenciaLotesTelemetriaAgentes(sql),
    reloj: () => new Date('2026-08-26T10:00:00Z')
  }).ingestarLote({
    agenteId,
    lote: crearLoteConcurrenciaTelemetria52411(),
    telemetriaRequestId,
    huellaLoteSha256
  });

  console.log(
    `[worker 5.24.11] replay=${resultado.idempotencia.replay ? 1 : 0} ` +
    `aceptadas=${resultado.resultado.aceptadas} ` +
    `rechazadas=${resultado.resultado.rechazadas}`
  );
} finally {
  await sql.cerrar();
}

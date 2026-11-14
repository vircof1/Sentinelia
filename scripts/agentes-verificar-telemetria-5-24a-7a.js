import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const raiz = new URL('../', import.meta.url);

await main();

async function main() {
  const [web, registroFederado, adaptadorFederado, openapi, monitorDirecto,
    pol, ingesta, procesador, formulario] = await Promise.all([
    leer('apps/sentinelia-web/src/index.js'),
    leer('paquetes/federacion/aplicacion/crearRegistroFamiliasFederacionSql.js'),
    leer('paquetes/federacion/adaptadores/AdaptadorTelemetriaFederacion.js'),
    leer('openapi/agentes.v1.yaml'),
    leer('paquetes/monitores/src/ConfiguracionMonitorTelemetria.js'),
    leer('paquetes/agentes/src/PeriodoVidaPolAgente.js'),
    leer('paquetes/agentes/src/ServicioIngestaTelemetriaAgentes.js'),
    leer('paquetes/agentes/src/ProcesadorObligacionesRelativasTelemetria.js'),
    leer('apps/sentinelia-web/src/views/parciales/formulario-revision-regla-telemetria.ejs')
  ]);

  assert.doesNotMatch(
    web,
    /permitirMomentoUtcRelativo\s*:\s*true/u,
    'El portal no puede crear revisiones relativas antes de 5.24a.7b.'
  );
  assert.match(
    registroFederado,
    /prepararMomentoUtcRelativoLocal\s*=\s*false/u
  );
  assert.doesNotMatch(
    web,
    /prepararMomentoUtcRelativoLocal\s*:\s*true/u,
    'El registro federado productivo debe permanecer cerrado.'
  );
  assert.match(adaptadorFederado, /permitirMomentoUtcRelativo\s*=\s*false/u);
  assert.doesNotMatch(openapi, /momento_utc_relativo/u);
  assert.doesNotMatch(monitorDirecto, /momento_utc_relativo/u);
  assert.doesNotMatch(pol, /momento_utc_relativo|proximaReevaluacion/u);
  assert.doesNotMatch(ingesta, /vigenteHastaUtc[\s\S]{0,120}(?:<=|>=|Date\.parse)/u);
  assert.match(procesador, /vigenteHastaUtc:\s*fechaIsoOpcional/u);
  assert.match(formulario, /typeof mostrarMomentoUtcRelativo !== 'undefined'/u);
  assert.doesNotMatch(
    web,
    /mostrarMomentoUtcRelativo\s*:\s*true/u,
    'El alta ordinaria no debe anunciar aún la opción relativa.'
  );

  console.log(
    '[agentes] OK 5.24a.7a: portal=cerrado federacion=cerrada ' +
    'openapi_agente=sin_cambio pol=sin_responsabilidad ' +
    'vigencia=solo_evidencia monitor_directo=sin_cambio ui=fixture'
  );
}

async function leer(ruta) {
  return readFile(new URL(ruta, raiz), 'utf8');
}

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import ejs from 'ejs';

import {
  ControladorReglasDerivacionTelemetria
} from '../apps/sentinelia-web/src/controladores/ControladorReglasDerivacionTelemetria.js';

const raiz = new URL('../', import.meta.url);

await main();

async function main() {
  await verificarAdaptacionHttpRelativa();
  await verificarFormularioCerradoYDemostrable();
  await verificarPresentacionHumana();
  console.log(
    '[agentes] OK 5.24a.6b: selector=relativo_predeterminado ' +
    'absoluto=fecha_fija magnitudes=unidades_exactas histeresis=por_lado ' +
    'resumen=antes_de_guardar accesibilidad=aria_live movil=bootstrap ' +
    'catalogo_publico=cerrado'
  );
}

async function verificarAdaptacionHttpRelativa() {
  const recibidas = [];
  const controlador = new ControladorReglasDerivacionTelemetria({
    servicioAdministracionReglas: {
      async previsualizarCondicion(_contexto, datos) {
        recibidas.push(datos.condicion);
        return { condicionCanonica: JSON.stringify(datos.condicion) };
      }
    }
  });
  await previsualizar(controlador, {
    relativo_forma: 'limite_superior',
    relativo_limite_direccion: 'futuro',
    relativo_limite_magnitud: '2',
    relativo_limite_unidad: 'horas',
    relativo_histeresis: '5',
    relativo_histeresis_unidad: 'minutos'
  });
  assert.deepEqual(recibidas[0], {
    tipo: 'momento_utc_relativo',
    version: 1,
    configuracion: {
      forma: 'limite_superior',
      limite: { direccion: 'futuro', segundos: '7200' },
      histeresisSegundos: '300'
    }
  });

  await previsualizar(controlador, {
    relativo_forma: 'limite_inferior',
    relativo_limite_direccion: 'pasado',
    relativo_limite_magnitud: '2',
    relativo_limite_unidad: 'semanas',
    relativo_histeresis: '1',
    relativo_histeresis_unidad: 'semanas'
  });
  assert.deepEqual(recibidas[1].configuracion, {
    forma: 'limite_inferior',
    limite: { direccion: 'pasado', segundos: '1209600' },
    histeresisSegundos: '604800'
  });

  await previsualizar(controlador, {
    relativo_forma: 'fuera_intervalo',
    relativo_inferior_direccion: 'pasado',
    relativo_inferior_magnitud: '3',
    relativo_inferior_unidad: 'dias',
    relativo_superior_direccion: 'ahora',
    relativo_superior_magnitud: '999',
    relativo_superior_unidad: 'horas',
    relativo_histeresis_inferior: '1',
    relativo_histeresis_inferior_unidad: 'horas',
    relativo_histeresis_superior: '0',
    relativo_histeresis_superior_unidad: 'segundos'
  });
  assert.deepEqual(recibidas[2].configuracion, {
    forma: 'fuera_intervalo',
    limiteInferior: { direccion: 'pasado', segundos: '259200' },
    limiteSuperior: { direccion: 'ahora', segundos: '0' },
    histeresisInferiorSegundos: '3600',
    histeresisSuperiorSegundos: '0'
  });

  const decimal = await previsualizar(controlador, {
    relativo_forma: 'limite_inferior',
    relativo_limite_direccion: 'pasado',
    relativo_limite_magnitud: '1.5',
    relativo_limite_unidad: 'horas',
    relativo_histeresis: '0',
    relativo_histeresis_unidad: 'segundos'
  });
  assert.equal(decimal.codigo, 400);
  assert.match(decimal.payload.mensaje, /entero no negativo/);

  const enorme = await previsualizar(controlador, {
    relativo_forma: 'limite_inferior',
    relativo_limite_direccion: 'pasado',
    relativo_limite_magnitud: '18446744073709551615',
    relativo_limite_unidad: 'dias',
    relativo_histeresis: '0',
    relativo_histeresis_unidad: 'segundos'
  });
  assert.equal(enorme.codigo, 400);
  assert.match(enorme.payload.mensaje, /máximo representable/);
}

async function previsualizar(controlador, campos) {
  const respuesta = {
    codigo: 200,
    payload: null,
    status(codigo) { this.codigo = codigo; return this; },
    json(payload) { this.payload = payload; }
  };
  await controlador.previsualizarCondicion({
    params: { id: '11' },
    contextoUsuarioActual: {},
    body: {
      senal_id: '22',
      condicion_tipo: 'momento_utc_relativo',
      ...campos
    }
  }, respuesta);
  return respuesta;
}

async function verificarFormularioCerradoYDemostrable() {
  const ruta = new URL(
    'apps/sentinelia-web/src/views/parciales/formulario-revision-regla-telemetria.ejs',
    raiz
  ).pathname;
  const cerrada = await ejs.renderFile(ruta, { revision: null });
  assert.doesNotMatch(cerrada, /value="momento_utc_relativo"/);

  const demostrable = await ejs.renderFile(ruta, {
    revision: null,
    mostrarMomentoUtcRelativo: true
  });
  assert.match(demostrable, /Fecha respecto a ahora/);
  assert.match(demostrable, /Fecha fija/);
  assert.match(demostrable, /fuera de un intervalo/);
  assert.match(demostrable, /Histéresis avanzada/);
  assert.equal(
    [...demostrable.matchAll(/value="semanas">semanas/g)].length,
    6,
    'Todos los límites e histéresis deben ofrecer semanas.'
  );
  assert.match(demostrable, /aria-live="polite"/);
  assert.match(demostrable, /col-12 col-lg-6/);

  const revision = {
    condicion: {
      tipo: 'momento_utc_relativo',
      configuracion: {
        forma: 'limite_superior',
        limite: { direccion: 'futuro', segundos: '3600' },
        histeresisSegundos: '60'
      }
    }
  };
  const existente = await ejs.renderFile(ruta, { revision });
  assert.match(existente, /value="momento_utc_relativo" selected/);
  assert.match(existente, /name="relativo_limite_magnitud"[^>]*value="3600"/);
}

async function verificarPresentacionHumana() {
  const [javascript, listado, detalle, ayuda, estilos, servicio, evaluador] = await Promise.all([
    leer('apps/sentinelia-web/src/public/js/agente-reglas.js'),
    leer('apps/sentinelia-web/src/views/portal/agente-reglas.ejs'),
    leer('apps/sentinelia-web/src/views/portal/agente-regla-detalle.ejs'),
    leer('apps/sentinelia-web/src/views/portal/parciales/ayuda-campo-temporal-relativo.ejs'),
    leer('apps/sentinelia-web/src/public/css/portal.css'),
    leer('paquetes/agentes/src/ServicioAdministracionReglasDerivacionTelemetria.js'),
    leer('paquetes/agentes/src/EvaluadorMomentoUtcRelativoTelemetria.js')
  ]);
  assert.match(javascript, /momento_utc_relativo/);
  assert.match(javascript, /selectorTipo\.value = senal\.tipo === 'momento_utc'/);
  assert.match(javascript, /D=\$\{temporal\.desviacionSegundos\}/);
  assert.doesNotMatch(javascript, /Date\.now\(\)/);
  assert.match(
    listado,
    /data-fecha-utc="<%= regla\.interpretacionTemporalRelativa\.momentoUtc %>"/
  );
  assert.match(
    listado,
    /data-fecha-utc="<%= regla\.interpretacionTemporalRelativa\.ahoraUtc %>"/
  );
  assert.match(
    listado,
    /data-fecha-utc="<%= regla\.interpretacionTemporalRelativa\.proximaFronteraUtc %>"/
  );
  assert.match(listado, /ayuda-campo-temporal-relativo/);
  assert.match(detalle, /ayuda-campo-temporal-relativo/);
  assert.match(ayuda, /Fecha informada \(M\)/);
  assert.match(ayuda, /Presente evaluado \(N\)/);
  assert.match(ayuda, /Próxima frontera/);
  assert.match(ayuda, /D = M − N/);
  assert.match(ayuda, /M no cambie/);
  assert.match(ayuda, /Lado de atención/);
  assert.match(ayuda, /Inferior/);
  assert.match(ayuda, /Ninguno/);
  assert.match(ayuda, /data-bs-html="true"/);
  assert.match(ayuda, /tooltip-html-denso-wrap/);
  assert.match(estilos, /\.tooltip-html-denso-wrap \.tooltip-inner[\s\S]*color: var\(--bs-tooltip-color\)/);
  assert.match(estilos, /\.tooltip-html-denso p[\s\S]*color: currentColor/);
  assert.match(estilos, /\.telemetria-temporal__etiqueta[\s\S]*flex-wrap: nowrap/);
  assert.match(detalle, /campo: 'lado', soloIcono: true/);
  assert.match(servicio, /resumenHumano/);
  assert.match(evaluador, /frontera_fuera_horizonte_representable/);
}

async function leer(ruta) {
  return readFile(new URL(ruta, raiz), 'utf8');
}

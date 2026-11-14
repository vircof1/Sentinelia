import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';

const raizVistas = new URL(
  '../apps/sentinelia-web/src/views/',
  import.meta.url
);

async function main() {
  const vistas = await listarVistas(raizVistas);
  const contenidos = await Promise.all(
    vistas.map(async (ruta) => [ruta, await readFile(ruta, 'utf8')])
  );

  for (const [ruta, contenido] of contenidos) {
    assert.doesNotMatch(
      contenido,
      /new Date\([^;\n]*\)\.toLocale(?:Date|Time)?String\(/u,
      `${ruta.pathname} formatea una fecha en Node en vez de en el navegador.`
    );
  }

  const archivos = await cargarArchivos({
    telemetria: '../apps/sentinelia-web/src/views/portal/agente-telemetria.ejs',
    eventos: '../apps/sentinelia-web/src/public/js/monitores-eventos.js',
    detalleEventos: '../apps/sentinelia-web/src/public/js/monitor-detalle-eventos.js',
    comparacion: '../apps/sentinelia-web/src/public/js/monitores-comparar-eventos.js',
    datosRemotos: '../apps/sentinelia-web/src/views/portal/federacion-datos-remotos.ejs',
    diagnostico: '../apps/sentinelia-web/src/views/portal/federacion-diagnostico.ejs',
    avisos: '../apps/sentinelia-web/src/views/portal/parciales/federacion-avisos-remotos.ejs',
    auditoria: '../apps/sentinelia-web/src/views/portal/parciales/federacion-auditoria-remota.ejs',
    alertas: '../apps/sentinelia-web/src/views/portal/parciales/federacion-alertas-remotas.ejs'
  });

  assert.match(
    archivos.telemetria,
    /data-fecha-utc="<%= resumen\.ultimaObservacionVisibleUtc %>"/u
  );
  for (const cliente of [archivos.eventos, archivos.comparacion]) {
    assert.match(
      cliente,
      /formatearFechaVisible\([\s\S]{0,80}rangoAplicado\?\.desdeUtc/u
    );
    assert.match(
      cliente,
      /formatearFechaVisible\([\s\S]{0,80}rangoAplicado\?\.hastaUtc/u
    );
    assert.match(cliente, /portalFechas\?\.formatear\?\.\(valor\)/u);
    assert.match(cliente, /fecha\.toLocaleString\('es-ES'\)/u);
  }
  assert.match(
    archivos.detalleEventos,
    /formatearFechaVisible\(evento\.ejecutadoEnUtc\)/u
  );
  assert.match(
    archivos.detalleEventos,
    /portalFechas\?\.formatear\?\.\(valor\)/u
  );
  for (const vista of [
    archivos.datosRemotos,
    archivos.diagnostico,
    archivos.avisos,
    archivos.auditoria,
    archivos.alertas
  ]) {
    assert.match(vista, /data-fecha-utc=/u);
  }

  console.log(
    `[ui] OK fechas locales: vistas=${vistas.length} ` +
    'contrato=data-fecha-utc rangos=portalFechas servidor=sin_formateo_local'
  );
}

async function listarVistas(directorio) {
  const entradas = await readdir(directorio, { withFileTypes: true });
  const rutas = [];
  for (const entrada of entradas) {
    const ruta = new URL(entrada.name, asegurarDirectorio(directorio));
    if (entrada.isDirectory()) {
      rutas.push(...await listarVistas(ruta));
    } else if (entrada.isFile() && entrada.name.endsWith('.ejs')) {
      rutas.push(ruta);
    }
  }
  return rutas;
}

async function cargarArchivos(definiciones) {
  const entradas = await Promise.all(
    Object.entries(definiciones).map(async ([nombre, ruta]) => [
      nombre,
      await readFile(new URL(ruta, import.meta.url), 'utf8')
    ])
  );
  return Object.fromEntries(entradas);
}

function asegurarDirectorio(url) {
  return new URL(url.href.endsWith('/') ? url.href : `${url.href}/`);
}

main().catch((error) => {
  console.error('[ui] Error verificando la localización de fechas');
  console.error(error);
  process.exitCode = 1;
});

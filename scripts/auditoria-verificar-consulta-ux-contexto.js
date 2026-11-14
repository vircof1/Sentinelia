import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import ejs from 'ejs';

const BASE_VISTAS = '../apps/sentinelia-web/src/views/portal/';
const PARCIAL = `${BASE_VISTAS}parciales/enlace-actividad-auditada.ejs`;
const CRONOLOGIA = `${BASE_VISTAS}auditoria-cronologia.ejs`;
const RUTAS = '../apps/sentinelia-web/src/rutas/crearRutasPortal.js';
const VISTAS_DOMINIO = Object.freeze({
  'monitor-detalle.ejs': ['monitor', 'verMonitores'],
  'agente-telemetria.ejs': ['agente', 'verAgentes'],
  'usuario-formulario.ejs': ['usuario', 'administrarUsuarios'],
  'trigger-formulario.ejs': ['trigger', 'verTriggers'],
  'dns-detalle.ejs': ['zona_dns', 'verDns', 'registro_dns']
});

async function main() {
  const [parcial, cronologia, rutas] = await Promise.all(
    [PARCIAL, CRONOLOGIA, RUTAS].map(leer)
  );
  await verificarPermisosYUrl(parcial);
  await verificarIntegracionDominios();
  verificarRetornoSeguro(cronologia);
  verificarRevalidacionDestino(rutas);
  console.log('[auditoria] OK 5.21.16n: enlaces=6 permisos=dobles sujeto=exacto retorno=interno destino=scope_revalidado');
}

async function verificarPermisosYUrl(parcial) {
  assert.match(parcial, /permisos\?\.verAuditoria/);
  assert.match(parcial, /permisoFuncional/);
  assert.match(parcial, /new URLSearchParams\(\{/);
  assert.match(parcial, /sujetoTipo: tipoAuditable/);
  assert.match(parcial, /sujetoId: idAuditable/);
  assert.match(parcial, /returnTo: retornoSeguroAuditoria/);
  assert.match(parcial, /!retornoSolicitado\.startsWith\('\/\/'\)/);
  assert.match(parcial, /rutasRetornoAuditables\.some/);

  const visible = await renderizarParcial({
    verAuditoria: true,
    permisoFuncional: true,
    retorno: '/monitores/42?return_to=%2Fmonitores'
  });
  assert.match(visible, /data-enlace-actividad-auditada/);
  assert.match(visible, /sujetoTipo=monitor/);
  assert.match(visible, /sujetoId=42/);
  assert.match(visible, /returnTo=%2Fmonitores%2F42%3Freturn_to%3D%252Fmonitores/);

  const sinAuditoria = await renderizarParcial({ verAuditoria: false, permisoFuncional: true });
  const sinDominio = await renderizarParcial({ verAuditoria: true, permisoFuncional: false });
  assert.doesNotMatch(sinAuditoria, /data-enlace-actividad-auditada/);
  assert.doesNotMatch(sinDominio, /data-enlace-actividad-auditada/);

  const retornoExterno = await renderizarParcial({
    verAuditoria: true,
    permisoFuncional: true,
    retorno: '//evil.example/recurso'
  });
  assert.doesNotMatch(retornoExterno, /returnTo=/);
  assert.doesNotMatch(retornoExterno, /evil\.example/);
}

async function verificarIntegracionDominios() {
  for (const [vista, marcas] of Object.entries(VISTAS_DOMINIO)) {
    const contenido = await leer(`${BASE_VISTAS}${vista}`);
    assert.match(contenido, /include\('parciales\/enlace-actividad-auditada'/);
    for (const marca of marcas) {
      assert.ok(contenido.includes(marca), `${vista} no declara ${marca}.`);
    }
  }
}

function verificarRetornoSeguro(cronologia) {
  assert.match(cronologia, /queryActual\?\.returnTo/);
  assert.match(cronologia, /!retornoSolicitadoAuditoria\.startsWith\('\/\/'\)/);
  assert.match(cronologia, /retornoAuditoriaSeguro/);
  assert.match(cronologia, /data-auditoria-volver-contexto/);
}

function verificarRevalidacionDestino(rutas) {
  const inicioPagina = rutas.indexOf("'/auditoria'");
  const inicioApi = rutas.indexOf("'/auditoria/api/eventos'");
  assert.notEqual(inicioPagina, -1);
  assert.notEqual(inicioApi, -1);
  const pagina = rutas.slice(inicioPagina, inicioPagina + 500);
  const api = rutas.slice(inicioApi, inicioApi + 500);
  for (const tramo of [pagina, api]) {
    assert.match(tramo, /requerirAutenticacion/);
    assert.match(tramo, /cargarContextoUsuario/);
    assert.match(tramo, /requerirVerAuditoria/);
  }
}

async function renderizarParcial({
  verAuditoria,
  permisoFuncional,
  retorno = '/monitores/42'
}) {
  return ejs.renderFile(fileURLToPath(new URL(PARCIAL, import.meta.url)), {
    contextoUsuarioActual: { permisos: { verAuditoria } },
    sujetoTipo: 'monitor',
    sujetoId: '42',
    retorno,
    permisoFuncional
  });
}

function leer(ruta) {
  return readFile(new URL(ruta, import.meta.url), 'utf8');
}

main().catch((error) => {
  console.error('[auditoria] ERROR 5.21.16n:', error);
  process.exitCode = 1;
});

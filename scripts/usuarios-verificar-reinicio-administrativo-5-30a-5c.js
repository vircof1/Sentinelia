import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import ejs from 'ejs';

const rutaParcial = new URL(
  '../apps/sentinelia-web/src/views/portal/parciales/' +
  'usuario-reinicio-password-administrativo.ejs',
  import.meta.url
);
const rutaJavascript = new URL(
  '../apps/sentinelia-web/src/public/js/' +
  'usuario-reinicio-password-administrativo.js',
  import.meta.url
);
const rutaCss = new URL(
  '../apps/sentinelia-web/src/public/css/portal.css',
  import.meta.url
);

const [javascript, css] = await Promise.all([
  readFile(rutaJavascript, 'utf8'),
  readFile(rutaCss, 'utf8')
]);

await verificarViaCorreo();
await verificarViaManual();
await verificarNoEvaluable();
verificarInteraccionAislada();
verificarTemasYMovil();
console.log(
  '[usuarios] OK 5.30a.5c: componente=aislado vias=humanas ' +
  'confirmacion=explicita secreto=limpieza accesibilidad=teclado_lector ' +
  'tema=claro_oscuro movil=adaptado'
);

async function verificarViaCorreo() {
  const html = await renderizar({
    via: 'correo',
    advertencias: ['email_no_validado'],
    ultimoResultado: {
      via: 'correo', estado: 'aceptado_smtp',
      aplicadoEnUtc: '2026-09-08T21:00:00.000Z'
    }
  });
  assert.match(html, /Vía por correo/u);
  assert.match(html, /no la mostrará al operador/u);
  assert.match(html, /email guardado no está validado/u);
  assert.match(html.replace(/\s+/gu, ' '), /reparar el correo o declararlo no operativo/u);
  assert.match(html, /Correo aceptado por SMTP/u);
  assert.match(html, /Reiniciar y solicitar envío/u);
  assert.match(html, /Correo guardado al que se enviará/u);
  assert.match(html, /usuario@example\.test/u);
  assert.doesNotMatch(html, /<script>identidad hostil<\/script>/u);
  assert.doesNotMatch(html, /name="password"/u);
}

async function verificarViaManual() {
  const html = await renderizar({ via: 'manual' });
  assert.match(html, /Vía manual/u);
  assert.match(html, /Tú elegirás y conocerás la contraseña\s+provisional/u);
  assert.equal((html.match(/autocomplete="new-password"/gu) || []).length, 2);
  assert.match(html, /name="password_confirmacion"/u);
  assert.match(html, /cerrará sus sesiones/u);
  assert.match(html, /forzará el cambio/u);
  assert.doesNotMatch(html, /value="[^"]+"/u);
}

async function verificarNoEvaluable() {
  const html = await renderizar({ via: 'no_evaluable', admiteAccion: false });
  assert.match(html, /Vía no evaluable/u);
  assert.match(html, /No se permite[\s\S]*degradar a un reinicio manual/u);
  assert.match(html, /data-reinicio-password-abrir[\s\S]*disabled/u);
}

function verificarInteraccionAislada() {
  assert.doesNotMatch(javascript, /window\.crypto\.randomUUID\(\)/u);
  assert.match(javascript, /generarUuidV7Cliente\(\)/u);
  const contexto = vm.createContext({
    Uint8Array,
    Date,
    window: { crypto: webcrypto },
    document: { querySelectorAll: () => [] }
  });
  vm.runInContext(javascript, contexto);
  const ids = Array.from({ length: 100 }, () =>
    vm.runInContext('generarUuidV7Cliente()', contexto));
  assert.equal(new Set(ids).size, ids.length);
  for (const id of ids) {
    assert.match(
      id,
      /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u
    );
  }
  assert.match(javascript, /hidden\.bs\.modal[^]*extinguirIntencion/u);
  assert.match(javascript, /campo\.value = ''/u);
  assert.match(javascript, /payload\.password = null/u);
  assert.match(javascript, /via_esperada: viaEsperada/u);
  assert.match(javascript, /Content-Type': 'application\/json'/u);
  assert.match(javascript, /window\.location\.reload\(\)/u);
  assert.doesNotMatch(javascript, /console\.(?:log|error)/u);
}

function verificarTemasYMovil() {
  const inicio = css.indexOf('.usuario-reinicio-password {');
  const fin = css.indexOf('/* Tema oscuro:', inicio);
  assert.ok(inicio >= 0 && fin > inicio);
  const componente = css.slice(inicio, fin);
  assert.match(componente, /var\(--bs-body-bg\)/u);
  assert.match(componente, /var\(--bs-body-color\)/u);
  assert.match(componente, /var\(--bs-border-color\)/u);
  assert.doesNotMatch(componente, /#[0-9a-f]{3,8}/iu);
  assert.match(componente, /@media \(max-width: 576px\)/u);
  assert.match(componente, /grid-template-columns: 1fr/u);
  assert.match(componente, /width: 100%/u);
}

async function renderizar({
  via,
  admiteAccion = true,
  advertencias = [],
  ultimoResultado = null
}) {
  return ejs.renderFile(fileURLToPath(rutaParcial), {
    reinicioPasswordAdministrativo: {
      canal: { via, evaluable: via !== 'no_evaluable' },
      admiteAccion,
      objetivo: { activo: true, emailValidado: advertencias.length === 0 },
      advertencias,
      ultimoResultado
    },
    usuarioObjetivo: {
      id: 7,
      usuario: '<script>identidad hostil</script>',
      email: 'usuario@example.test'
    }
  });
}

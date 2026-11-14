import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import ejs from 'ejs';

const raiz = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const parcial = resolve(
  raiz,
  'apps/sentinelia-web/src/views/portal/parciales/ddns-concesiones-administrativas.ejs'
);

await main();

async function main() {
  const concesiones = crearConcesiones();
  await verificarFichaAgente(concesiones);
  await verificarFichaRegistro(concesiones);
  await verificarSinAutoridad(concesiones);
  await verificarAdvertenciaEdicion();
  console.log(
    '[dns-ddns] OK 5.28.11c: estados=operativos+terminales ' +
    'contenido=xss_escapado contraparte=restringida formularios=autoridad_real ' +
    'modo=solo_lectura reactivacion=no_ofrecida edicion=advertida responsive=si'
  );
}

async function verificarFichaAgente(concesiones) {
  const html = await renderizar({
    extremoDdns: 'agente',
    agente: { id: '12' },
    concesionesDdns: concesiones,
    candidatosDdns: [
      { registroDnsId: '81', nombre: 'api.example.', tipoRegistro: 'A', operable: true },
      { registroDnsId: '82', nombre: 'off.example.', tipoRegistro: 'AAAA', operable: false }
    ],
    puedeAdministrarDdns: true,
    tokenCSRFPortal: 'csrf-prueba'
  });
  assert.match(html, /action="\/agentes\/12\/ddns\/concesiones"/u);
  assert.match(html, /name="registro_dns_id"/u);
  assert.match(html, /inactivo, no operable/u);
  assert.match(html, /action="\/agentes\/12\/ddns\/[^/]+\/revocar"/u);
  assert.match(html, /2 consumidos · 1 restantes/u);
  assert.match(html, /contenido_persistido/u);
  assert.match(html, /contenido_publicado/u);
  assert.match(html, /fallo &lt;script&gt;alert\(&#34;x&#34;\)&lt;\/script&gt;/u);
  assert.doesNotMatch(html, /fallo <script>/u);
  assert.doesNotMatch(html, /name="modo"|reactivar|reintentar el mismo valor/iu);
}

async function verificarFichaRegistro(concesiones) {
  const html = await renderizar({
    extremoDdns: 'registro',
    zona: { id: '5' },
    registroObjetivo: { id: '81' },
    concesionesDdns: concesiones,
    puedeAdministrarDnsAvanzado: true,
    tokenCSRFPortal: 'csrf-prueba'
  });
  assert.match(html, /data-ddns-revocar-accion="\/dns\/5\/registros\/81\/ddns\/[^/]+\/revocar"/u);
  assert.match(html, /data-ddns-revocar-formulario/u);
  const cliente = await readFile(resolve(raiz, 'apps/sentinelia-web/src/public/js/dns-registro-formulario.js'), 'utf8');
  assert.match(cliente, /formularioRevocar\.action = origen\.dataset\.ddnsRevocarAccion/u);
  assert.match(html, /Contraparte restringida/u);
  assert.match(html, /sin visibilidad/u);
  assert.doesNotMatch(html, /agente-secreto-transversal/u);
}

async function verificarSinAutoridad(concesiones) {
  const html = await renderizar({
    extremoDdns: 'agente',
    agente: { id: '12' },
    concesionesDdns: concesiones,
    candidatosDdns: [],
    puedeAdministrarDdns: false,
    tokenCSRFPortal: 'csrf-prueba'
  });
  assert.doesNotMatch(html, /Conceder registro/u);
  assert.doesNotMatch(html, /Revocar concesión/u);
  assert.match(html, /Estado deseado/u);
}

async function verificarAdvertenciaEdicion() {
  const [vista, javascript, css] = await Promise.all([
    readFile(resolve(raiz, 'apps/sentinelia-web/src/views/portal/dns-registro-formulario.ejs'), 'utf8'),
    readFile(resolve(raiz, 'apps/sentinelia-web/src/public/js/dns-registro-formulario.js'), 'utf8'),
    readFile(resolve(raiz, 'apps/sentinelia-web/src/public/css/portal.css'), 'utf8')
  ]);
  assert.match(vista, /data-registro-ddns-concedido/u);
  assert.match(vista, /data-ddns-edicion-advertencia/u);
  assert.match(vista, /El agente conserva su autoridad/u);
  assert.match(javascript, /cambiaContenidoDdns/u);
  assert.match(javascript, /edicionDdnsConfirmada/u);
  assert.match(javascript, /formulario\.requestSubmit\(\)/u);
  assert.match(css, /@media \(max-width: 767\.98px\)[\s\S]*ddns-administracion__estados/u);
}

async function renderizar(locales) {
  return ejs.renderFile(parcial, { retornoDetalle: '/dns/2', ...locales });
}

function crearConcesiones() {
  const base = {
    concesionId: '0199-1111-7000-8000-000000000001',
    estado: 'vigente',
    causaCierre: null,
    version: '7',
    decision: 'actualizar',
    modo: 'explicito',
    condicion: 'pendiente_publicacion',
    agente: { restringido: false, id: '12', nombre: 'Agente & principal', activo: true },
    registro: {
      restringido: false,
      id: '81',
      nombre: 'api.example.',
      tipo: 'A',
      activo: true,
      publicarEnBind: true,
      categoriaOrigen: 'ddns',
      estadoDeseado: { estado: 'contenido_persistido', valor: '<img src=x onerror=alert(1)>' },
      estadoPublicado: { estado: 'contenido_publicado', valor: '192.0.2.10' }
    },
    operacion: {
      restringido: false,
      intencionId: '0199-1111-7000-8000-000000000002',
      hito: 'contenido_persistido',
      terminal: null,
      intentos: { consumidos: 2, restantes: 1 },
      ultimoIntento: {
        numero: 2,
        estado: 'rechazo_atribuible',
        atribucion: 'registro',
        generacionDns: '15',
        codigoDiagnostico: 'valor_rechazado',
        mensajeDiagnostico: 'fallo <script>alert("x")</script>',
        actualizadoEnUtc: '2026-09-09T10:05:00.000Z'
      }
    },
    timestamps: {
      creadaEnUtc: '2026-09-09T10:00:00.000Z',
      cerradaEnUtc: null,
      intencionAceptadaEnUtc: '2026-09-09T10:01:00.000Z',
      contenidoPersistidoEnUtc: '2026-09-09T10:02:00.000Z',
      contenidoPublicadoEnUtc: null,
      terminadaEnUtc: null
    }
  };
  return [
    base,
    {
      ...base,
      concesionId: '0199-1111-7000-8000-000000000003',
      estado: 'revocada',
      decision: 'sin_cambio',
      modo: 'automatico_ipv4',
      condicion: 'cerrada',
      agente: { restringido: true, tipo: 'agente', secreto: 'agente-secreto-transversal' },
      operacion: {
        ...base.operacion,
        hito: 'contenido_publicado',
        terminal: 'publicada',
        ultimoIntento: null
      },
      timestamps: {
        ...base.timestamps,
        contenidoPublicadoEnUtc: '2026-09-09T10:03:00.000Z',
        terminadaEnUtc: '2026-09-09T10:03:00.000Z'
      }
    }
  ];
}

import assert from 'node:assert/strict';
import http from 'node:http';

import express from 'express';

import { ControladorAgentes }
  from '../apps/sentinelia-web/src/controladores/ControladorAgentes.js';
import { ControladorDns }
  from '../apps/sentinelia-web/src/controladores/ControladorDns.js';
import { crearRutasPortal }
  from '../apps/sentinelia-web/src/rutas/crearRutasPortal.js';

const CSRF = 'csrf-5-28-11b';
const llamadas = [];
let simularCarrera = false;

const servicioAplicacionDdnsAgentes = {
  async crearConcesion(entrada) {
    llamadas.push(['crear', entrada]);
    if (simularCarrera) {
      throw Object.assign(new Error('ya concedido'), {
        codigo: 'registro_ya_concedido'
      });
    }
    return { concesionId: '01993b96-b33f-7000-8000-000000000001' };
  },
  async revocarDesdeAgente(entrada) {
    llamadas.push(['revocar_agente', entrada]);
    return { efectuada: true };
  },
  async revocarDesdeRegistro(entrada) {
    llamadas.push(['revocar_registro', entrada]);
    return { efectuada: true };
  }
};

const controladorAgentes = new ControladorAgentes({
  servicioAdministracionAgentesPortal: {},
  servicioAutorizacion: {},
  servicioAplicacionDdnsAgentes
});
const controladorDns = new ControladorDns({
  servicioLecturaDnsPortal: {},
  servicioAdministracionDnsPortal: {},
  servicioAplicacionDdnsAgentes
});

const servicioSesion = {
  async validarVersionSesion(req) {
    return req.get('x-session-state') !== 'stale';
  },
  async destruirSesion(req) {
    req.session = {};
  }
};
const servicioContextoUsuario = {
  async cargarDesdeSesion(req) {
    return req.session?.contexto ?? null;
  }
};
const servicioAutorizacion = {
  resolverPermiso(permiso, contexto) {
    return Boolean(contexto?.permisos?.[permiso]);
  }
};

const app = express();
app.use(express.urlencoded({ extended: false }));
app.use((req, _res, next) => {
  const permisos = String(req.get('x-permisos') || '')
    .split(',')
    .filter(Boolean)
    .reduce((resultado, permiso) => ({ ...resultado, [permiso]: true }), {});
  req.session = {
    usuarioAutenticado: { id: '1', tokenCSRF: CSRF },
    contexto: {
      idUsuario: '1',
      nivelScope: 'portal',
      esOperadorSistema: true,
      permisos
    }
  };
  next();
});
app.use(crearRutasPortal({
  ddnsAgentesHabilitado: true,
  controladorLogin: controladorNulo(),
  controladorPortal: controladorNulo(),
  controladorOrganizacion: controladorNulo(),
  controladorUsuarios: controladorNulo(),
  controladorImpersonacion: controladorNulo(),
  controladorMonitores: controladorNulo(),
  controladorTriggers: controladorNulo(),
  controladorDns,
  controladorAgentes,
  controladorEliminacionAdministrativaAgentes: controladorNulo(),
  controladorEliminacionAdministrativaOrganizaciones: controladorNulo(),
  controladorReglasDerivacionTelemetria: controladorNulo(),
  controladorAuditoria: controladorNulo(),
  controladorFederacion: controladorNulo(),
  servicioSesion,
  controladorPow: controladorNulo(),
  controladorDesuscripcionTriggerCorreo: controladorNulo(),
  servicioContextoUsuario,
  servicioAutorizacion
}));
app.use((error, _req, res, _next) => {
  res.status(error?.statusCode || 500).json({ codigo: error?.codigo || 'interno' });
});

const servidor = http.createServer(app);
await new Promise((resolve) => servidor.listen(0, '127.0.0.1', resolve));
const origen = `http://127.0.0.1:${servidor.address().port}`;

try {
  await verificarCsrfYSesion();
  await verificarPermisosGranulares();
  await verificarComandosYRedireccion();
  await verificarDobleSubmit();
  console.log(
    '[dns-ddns] OK 5.28.11b: rutas=3 sesion=vigente csrf=obligatorio ' +
    'permisos=granulares doble_submit=idempotente redireccion=cerrada'
  );
} finally {
  await new Promise((resolve) => servidor.close(resolve));
}

async function verificarCsrfYSesion() {
  const inicial = llamadas.length;
  const sinCsrf = await post('/agentes/7/ddns/concesiones', {
    registro_dns_id: '9'
  }, { csrf: false });
  assert.equal(sinCsrf.status, 403);
  assert.equal(llamadas.length, inicial);

  const obsoleta = await post('/agentes/7/ddns/concesiones', {
    registro_dns_id: '9'
  }, { sessionState: 'stale' });
  assert.equal(obsoleta.status, 302);
  assert.equal(obsoleta.headers.get('location'), '/login');
  assert.equal(llamadas.length, inicial);
}

async function verificarPermisosGranulares() {
  const inicial = llamadas.length;
  const parcial = await post('/agentes/7/ddns/concesiones', {
    registro_dns_id: '9'
  }, { permisos: ['modificar_agentes'], json: true });
  assert.equal(parcial.status, 403);
  assert.equal(llamadas.length, inicial);

  const agente = await post(
    '/agentes/7/ddns/01993b96-b33f-7000-8000-000000000001/revocar',
    {},
    { permisos: ['administrar_dns_avanzado'], json: true }
  );
  assert.equal(agente.status, 403);

  const dns = await post(
    '/dns/2/registros/9/ddns/01993b96-b33f-7000-8000-000000000001/revocar',
    {},
    { permisos: ['modificar_agentes'], json: true }
  );
  assert.equal(dns.status, 403);
  assert.equal(llamadas.length, inicial);
}

async function verificarComandosYRedireccion() {
  const crear = await post('/agentes/7/ddns/concesiones', {
    registro_dns_id: '9',
    return_to: 'https://atacante.example/'
  });
  assert.equal(crear.status, 302);
  assert.equal(crear.headers.get('location'), '/agentes/7/editar');
  assert.equal(llamadas.at(-1)[0], 'crear');

  const revocarAgente = await post(
    '/agentes/7/ddns/01993b96-b33f-7000-8000-000000000001/revocar',
    { return_to: '//atacante.example/' },
    { permisos: ['modificar_agentes'] }
  );
  assert.equal(revocarAgente.status, 302);
  assert.equal(revocarAgente.headers.get('location'), '/agentes/7/editar');
  assert.equal(llamadas.at(-1)[0], 'revocar_agente');

  const revocarDns = await post(
    '/dns/2/registros/9/ddns/01993b96-b33f-7000-8000-000000000001/revocar',
    {},
    { permisos: ['administrar_dns_avanzado'] }
  );
  assert.equal(revocarDns.status, 302);
  assert.equal(
    revocarDns.headers.get('location'),
    '/dns/2/registros/9/editar?return_to=%2Fdns%2F2'
  );
  assert.equal(llamadas.at(-1)[0], 'revocar_registro');
}

async function verificarDobleSubmit() {
  simularCarrera = true;
  const respuesta = await post('/agentes/7/ddns/concesiones', {
    registro_dns_id: '9'
  });
  simularCarrera = false;
  assert.equal(respuesta.status, 302);
  assert.equal(respuesta.headers.get('location'), '/agentes/7/editar');
}

function post(ruta, cuerpo, {
  csrf = true,
  sessionState = 'vigente',
  permisos = ['modificar_agentes', 'administrar_dns_avanzado'],
  json = false
} = {}) {
  const parametros = new URLSearchParams(cuerpo);
  if (csrf) parametros.set('_csrf', CSRF);
  return fetch(`${origen}${ruta}`, {
    method: 'POST',
    redirect: 'manual',
    headers: {
      'content-type': 'application/x-www-form-urlencoded',
      'x-session-state': sessionState,
      'x-permisos': permisos.join(','),
      ...(json ? { accept: 'application/json' } : {})
    },
    body: parametros
  });
}

function controladorNulo() {
  return new Proxy({}, {
    get() {
      return (_req, res) => res.status(501).end();
    }
  });
}

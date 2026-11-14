import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { once } from 'node:events';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

import express from 'express';

import { ControladorUsuarios }
  from '../apps/sentinelia-web/src/controladores/ControladorUsuarios.js';
import { crearRutasPortal }
  from '../apps/sentinelia-web/src/rutas/crearRutasPortal.js';
import { ErrorContratoReinicioPasswordAdministrativo }
  from '../paquetes/usuarios/src/ContratoReinicioPasswordAdministrativo.js';

const directorio = fileURLToPath(new URL('../', import.meta.url));
const tokenCsrf = 'csrf-fixture-5-30a-6b';
let secuencia = 0;

await verificarSuperficiePublicada();
await verificarCadenaHttpYAmbasVias();
verificarEnsayosSqlDeAmbasVias();

console.log(
  '[usuarios] OK 5.30a.6b: superficie=publicada ' +
  'cadena=sesion+csrf+contexto+permiso scope=servicio ' +
  'vias=manual+correo idempotencia=replay pruebas_sql=reales secretos=no_expuestos'
);

async function verificarSuperficiePublicada() {
  const [rutas, vista, cabecera] = await Promise.all([
    leer('../apps/sentinelia-web/src/rutas/crearRutasPortal.js'),
    leer('../apps/sentinelia-web/src/views/portal/usuario-formulario.ejs'),
    leer('../apps/sentinelia-web/src/views/parciales/cabecera.ejs')
  ]);
  assert.match(rutas,
    /\/usuarios\/api\/:id\/reiniciar-password[\s\S]*requerirAutenticacion,[\s\S]*cargarContextoUsuario,[\s\S]*requerirAdministrarUsuarios,[\s\S]*apiReiniciarPasswordAdministrativo/u);
  assert.match(vista,
    /modo === 'editar'[\s\S]*include\('parciales\/usuario-reinicio-password-administrativo'/u);
  assert.match(vista,
    /usuario-reinicio-password-administrativo\.js(?:\?v=[a-z0-9-]+)?/u);
  assert.match(cabecera, /portal\.css\?v=[a-z0-9-]+/u);
}

async function verificarCadenaHttpYAmbasVias() {
  const operaciones = new Map();
  let mutaciones = 0;
  const servicioReinicioPasswordAdministrativo = {
    async reiniciar(entrada) {
      assert.equal(entrada.contextoUsuarioActual.idUsuario, '1');
      assert.equal(entrada.contextoUsuarioActual.nivelScope, 'tenant');
      if (entrada.usuarioId === 99) {
        throw new ErrorContratoReinicioPasswordAdministrativo(
          'El usuario no existe o queda fuera del alcance actual.'
        );
      }
      const anterior = operaciones.get(entrada.reinicioId);
      if (anterior) {
        return ejecucion(entrada, { replay: true, salidaCorreoId: anterior });
      }
      mutaciones += 1;
      const salidaCorreoId = entrada.viaEsperada === 'correo' ? '701' : null;
      operaciones.set(entrada.reinicioId, salidaCorreoId);
      return ejecucion(entrada, { salidaCorreoId });
    }
  };
  const controladorUsuarios = new ControladorUsuarios({
    servicioUsuarios: {}, servicioReinicioPasswordAdministrativo
  });
  const controladorGenerico = new Proxy({}, {
    get() { return function controladorNoEjercitado(_req, res) { res.sendStatus(204); }; }
  });
  const servicioSesion = {
    async validarVersionSesion(req) {
      return req.get('x-fixture-sesion') !== 'obsoleta';
    },
    async destruirSesion() {}
  };
  const servicioContextoUsuario = {
    async cargarDesdeSesion(req) {
      return {
        idUsuario: '1', idUsuarioReal: '1', nivelScope: 'tenant',
        tenantId: '7', empresaId: null, sitioId: null,
        permiteAdministrarUsuarios: req.get('x-fixture-permiso') !== 'no'
      };
    }
  };
  const servicioAutorizacion = {
    resolverPermiso(permiso, contexto) {
      return permiso !== 'administrar_usuarios' ||
        contexto.permiteAdministrarUsuarios;
    }
  };
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    if (req.get('x-fixture-sesion') !== 'ausente') {
      req.session = { usuarioAutenticado: { tokenCSRF: tokenCsrf } };
    }
    next();
  });
  app.use(crearRutasPortal({
    controladorLogin: controladorGenerico,
    controladorPortal: controladorGenerico,
    controladorOrganizacion: controladorGenerico,
    controladorUsuarios,
    controladorImpersonacion: controladorGenerico,
    controladorMonitores: controladorGenerico,
    controladorTriggers: controladorGenerico,
    controladorDns: controladorGenerico,
    controladorAgentes: controladorGenerico,
    controladorEliminacionAdministrativaAgentes: controladorGenerico,
    controladorEliminacionAdministrativaOrganizaciones: controladorGenerico,
    controladorReglasDerivacionTelemetria: controladorGenerico,
    controladorAuditoria: controladorGenerico,
    controladorFederacion: controladorGenerico,
    servicioSesion,
    controladorPow: controladorGenerico,
    controladorDesuscripcionTriggerCorreo: controladorGenerico,
    servicioContextoUsuario,
    servicioAutorizacion
  }));
  app.use((error, _req, res, _next) => {
    res.status(500).json({ ok: false, mensaje: error.message });
  });
  const servidor = app.listen(0, '127.0.0.1');
  await once(servidor, 'listening');
  const origen = `http://127.0.0.1:${servidor.address().port}`;
  try {
    assert.equal((await enviar(origen, 7, cuerpo('correo'), {
      sesion: 'ausente'
    })).status, 401);
    assert.equal((await enviar(origen, 7, cuerpo('correo'), {
      csrf: 'incorrecto'
    })).status, 403);
    assert.equal((await enviar(origen, 7, cuerpo('correo'), {
      permiso: 'no'
    })).status, 403);
    assert.equal((await enviar(origen, 7, cuerpo('correo'), {
      sesion: 'obsoleta'
    })).status, 401);
    const fueraScope = await enviar(origen, 99, cuerpo('correo'));
    assert.equal(fueraScope.status, 400);
    assert.match(fueraScope.datos.mensaje, /fuera del alcance/u);

    const idCorreo = uuid();
    const correo = await enviar(origen, 7, cuerpo('correo', idCorreo));
    assert.equal(correo.status, 200);
    assert.equal(correo.datos.datos.via, 'correo');
    assert.equal(correo.datos.datos.salida_correo_id, '701');
    assert.doesNotMatch(
      JSON.stringify(correo.datos),
      /ProvisionalPrivada|correo@example|hash_password/iu
    );
    const replay = await enviar(origen, 7, cuerpo('correo', idCorreo));
    assert.equal(replay.datos.datos.replay, true);

    const manual = await enviar(origen, 7, cuerpo('manual'));
    assert.equal(manual.status, 200);
    assert.equal(manual.datos.datos.via, 'manual');
    assert.equal(manual.datos.datos.salida_correo_id, undefined);
    assert.doesNotMatch(JSON.stringify(manual.datos), /ProvisionalPrivada/u);
    assert.equal(mutaciones, 2);
  } finally {
    servidor.close();
    await once(servidor, 'close');
  }
}

function verificarEnsayosSqlDeAmbasVias() {
  for (const script of [
    'usuarios-verificar-reinicio-administrativo-5-30a-4a.js',
    'usuarios-verificar-reinicio-administrativo-5-30a-4b.js'
  ]) {
    const resultado = spawnSync(process.execPath, [
      fileURLToPath(new URL(script, import.meta.url))
    ], {
      cwd: directorio,
      env: process.env,
      encoding: 'utf8',
      timeout: 300_000
    });
    if (resultado.stdout) process.stdout.write(resultado.stdout);
    if (resultado.stderr) process.stderr.write(resultado.stderr);
    assert.ifError(resultado.error);
    assert.equal(resultado.status, 0, `${script} debe superar el ensayo SQL real.`);
  }
}

async function enviar(origen, usuarioId, payload, {
  sesion = 'vigente', permiso = 'si', csrf = tokenCsrf
} = {}) {
  const respuesta = await fetch(
    `${origen}/usuarios/api/${usuarioId}/reiniciar-password`,
    {
      method: 'POST',
      headers: {
        'content-type': 'application/json', accept: 'application/json',
        'x-csrf-token': csrf, 'x-fixture-sesion': sesion,
        'x-fixture-permiso': permiso
      },
      body: JSON.stringify(payload)
    }
  );
  return {
    status: respuesta.status,
    datos: await respuesta.json()
  };
}

function cuerpo(via, reinicioId = uuid()) {
  return via === 'manual'
    ? {
        reinicio_id: reinicioId,
        via_esperada: 'manual',
        password: 'ProvisionalPrivada_5-30a-6b',
        password_confirmacion: 'ProvisionalPrivada_5-30a-6b'
      }
    : { reinicio_id: reinicioId, via_esperada: 'correo' };
}

function ejecucion(entrada, { replay = false, salidaCorreoId = null } = {}) {
  return {
    resultado: {
      operacion: {
        reinicioId: entrada.reinicioId,
        via: entrada.viaEsperada
      },
      salidaCorreo: salidaCorreoId ? { id: salidaCorreoId } : null,
      replay
    },
    convergenciaPostcommit: { completa: true }
  };
}

function uuid() {
  secuencia += 1;
  return `018f0000-0000-7000-8000-${String(secuencia).padStart(12, '0')}`;
}

function leer(ruta) {
  return readFile(new URL(ruta, import.meta.url), 'utf8');
}

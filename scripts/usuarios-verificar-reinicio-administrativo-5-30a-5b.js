import assert from 'node:assert/strict';
import { ControladorUsuarios }
  from '../apps/sentinelia-web/src/controladores/ControladorUsuarios.js';
import { ErrorContratoReinicioPasswordAdministrativo }
  from '../paquetes/usuarios/src/ContratoReinicioPasswordAdministrativo.js';
import {
  ErrorViaReinicioPasswordAdministrativo,
  ServicioReinicioPasswordAdministrativo
}
  from '../paquetes/usuarios/src/ServicioReinicioPasswordAdministrativo.js';

let secuencia = 0;

await verificarCorreoYReplay();
await verificarManualYLimpieza();
await verificarCuerposManipulados();
await verificarErroresSeguros();
await verificarDespachoUnicoServicio();
console.log(
  '[usuarios] OK 5.30a.5b: comando=privado json=exacto ' +
  'decision=servicio conflicto=409_recargable secretos=no-store_y_limpiados ' +
  'errores=seguros'
);

async function verificarCorreoYReplay() {
  const llamadas = [];
  const controlador = crearControlador({
    async reiniciar(entrada) {
      llamadas.push(entrada);
      return ejecucion({ via: 'correo', replay: true, salidaCorreoId: '91' });
    },
    async reiniciarManual() { throw new Error('no debe seleccionarlo HTTP'); },
    async reiniciarCorreo() { throw new Error('no debe seleccionarlo HTTP'); }
  });
  const requisicion = request({
    reinicio_id: uuid(), via_esperada: 'correo'
  });
  const respuesta = response();
  await controlador.apiReiniciarPasswordAdministrativo(
    requisicion, respuesta, () => {}
  );
  assert.equal(respuesta.statusCode, 200);
  assert.equal(respuesta.payload.codigo,
    'reinicio_password_administrativo_repetido');
  assert.equal(respuesta.payload.datos.salida_correo_id, '91');
  assert.equal(respuesta.payload.datos.replay, true);
  assert.equal(llamadas.length, 1);
  assert.equal(llamadas[0].viaEsperada, 'correo');
  assert.equal(llamadas[0].password, null);
  assert.equal(llamadas[0].contextoUsuarioActual, requisicion.contextoUsuarioActual);
  assert.equal(respuesta.headers['cache-control'], 'private, no-store, max-age=0');
  assert.doesNotMatch(JSON.stringify(respuesta.payload),
    /hash_password|password_provisional|SECRETO/u);
}

async function verificarManualYLimpieza() {
  const password = 'provisional-muy-privada-123';
  let recibida = null;
  const controlador = crearControlador({
    async reiniciar(entrada) {
      recibida = { ...entrada };
      return ejecucion({ via: 'manual' });
    }
  });
  const requisicion = request({
    reinicio_id: uuid(), via_esperada: 'manual',
    password, password_confirmacion: password
  });
  const respuesta = response();
  await controlador.apiReiniciarPasswordAdministrativo(
    requisicion, respuesta, () => {}
  );
  assert.equal(respuesta.statusCode, 200);
  assert.equal(recibida.password, password);
  assert.equal(recibida.passwordConfirmacion, password);
  assert.equal(requisicion.body.password, '');
  assert.equal(requisicion.body.password_confirmacion, '');
  assert.doesNotMatch(JSON.stringify(respuesta.payload), /provisional-muy/iu);
}

async function verificarCuerposManipulados() {
  let llamadas = 0;
  const controlador = crearControlador({
    async reiniciar({ viaEsperada }) {
      llamadas += 1;
      throw new ErrorContratoReinicioPasswordAdministrativo(
        `Vía no admitida: ${viaEsperada}`
      );
    }
  });
  const casos = [
    { reinicio_id: uuid(), via_esperada: 'correo', password: 'inyectada' },
    { reinicio_id: uuid(), via_esperada: 'manual', password: 'incompleta' },
    { reinicio_id: uuid(), via_esperada: 'otra' },
    { reinicio_id: uuid(), via_esperada: 'correo', usuario_id: '999' }
  ];
  for (const cuerpo of casos) {
    const respuesta = response();
    await controlador.apiReiniciarPasswordAdministrativo(
      request(cuerpo), respuesta, () => {}
    );
    assert.equal(respuesta.statusCode, 400);
    assert.equal(respuesta.payload.ok, false);
  }
  const respuestaTipo = response();
  await controlador.apiReiniciarPasswordAdministrativo({
    ...request({}), is() { return false; }
  }, respuestaTipo, () => {});
  assert.equal(respuestaTipo.statusCode, 400);
  assert.equal(llamadas, 1);
}

async function verificarErroresSeguros() {
  const conflicto = crearControlador({
    async reiniciar() {
      throw new ErrorViaReinicioPasswordAdministrativo(
        'VIA_REINICIO_PASSWORD_CAMBIADA', 'Recarga la operación.'
      );
    }
  });
  const respuestaConflicto = response();
  await conflicto.apiReiniciarPasswordAdministrativo(
    request({ reinicio_id: uuid(), via_esperada: 'correo' }),
    respuestaConflicto,
    () => {}
  );
  assert.equal(respuestaConflicto.statusCode, 409);
  assert.equal(respuestaConflicto.payload.recargar, true);

  const contrato = crearControlador({
    async reiniciar() {
      throw new ErrorContratoReinicioPasswordAdministrativo(
        'El objetivo no puede ser la identidad actual.'
      );
    }
  });
  const respuestaContrato = response();
  await contrato.apiReiniciarPasswordAdministrativo(
    request({ reinicio_id: uuid(), via_esperada: 'correo' }),
    respuestaContrato,
    () => {}
  );
  assert.equal(respuestaContrato.statusCode, 400);

  const infraestructura = crearControlador({
    async reiniciar() { throw new Error('password=FILTRACION SQL privada'); }
  });
  const respuestaInfraestructura = response();
  const errorOriginal = console.error;
  try {
    console.error = () => {};
    await infraestructura.apiReiniciarPasswordAdministrativo(
      request({ reinicio_id: uuid(), via_esperada: 'correo' }),
      respuestaInfraestructura,
      () => {}
    );
  } finally {
    console.error = errorOriginal;
  }
  assert.equal(respuestaInfraestructura.statusCode, 500);
  assert.equal(respuestaInfraestructura.payload.codigo,
    'infraestructura_no_disponible');
  assert.doesNotMatch(JSON.stringify(respuestaInfraestructura.payload),
    /FILTRACION|password=/u);
}

async function verificarDespachoUnicoServicio() {
  const receptor = {
    async reiniciarCorreo(entrada) { return { metodo: 'correo', entrada }; },
    async reiniciarManual(entrada) { return { metodo: 'manual', entrada }; }
  };
  const correo = await ServicioReinicioPasswordAdministrativo.prototype
    .reiniciar.call(receptor, { viaEsperada: 'correo', password: 'ignorada' });
  assert.equal(correo.metodo, 'correo');
  assert.equal(correo.entrada.password, undefined);
  const manual = await ServicioReinicioPasswordAdministrativo.prototype
    .reiniciar.call(receptor, { viaEsperada: 'manual', password: 'privada' });
  assert.equal(manual.metodo, 'manual');
  assert.equal(manual.entrada.password, 'privada');
}

function crearControlador(servicioReinicioPasswordAdministrativo) {
  return new ControladorUsuarios({
    servicioUsuarios: {},
    servicioReinicioPasswordAdministrativo
  });
}

function request(body) {
  return {
    params: { id: '7' },
    body,
    contextoUsuarioActual: {
      idUsuario: '1', idUsuarioReal: '1', impersonacionActiva: false
    },
    is(tipo) { return tipo === 'application/json'; }
  };
}

function response() {
  return {
    statusCode: 200,
    payload: null,
    headers: {},
    set(nombre, valor) { this.headers[nombre.toLowerCase()] = valor; return this; },
    status(codigo) { this.statusCode = codigo; return this; },
    json(payload) { this.payload = payload; return this; }
  };
}

function ejecucion({ via, replay = false, salidaCorreoId = null }) {
  const reinicioId = uuid();
  return {
    resultado: {
      operacion: { reinicioId, via },
      salidaCorreo: salidaCorreoId === null ? null : { id: salidaCorreoId },
      replay
    },
    convergenciaPostcommit: { completa: true }
  };
}

function uuid() {
  secuencia += 1;
  return `018f0000-0000-7000-8000-${String(secuencia).padStart(12, '0')}`;
}

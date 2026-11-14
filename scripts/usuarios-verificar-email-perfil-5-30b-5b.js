import assert from 'node:assert/strict';

import { ControladorUsuarios }
  from '../apps/sentinelia-web/src/controladores/ControladorUsuarios.js';
import { ErrorAutogestionPerfil }
  from '../paquetes/usuarios/src/ErrorAutogestionPerfil.js';

const resultados = {
  cambio: {
    codigo: 'email_verificacion_encolada',
    mensaje: 'Correo de verificación encolado.'
  },
  validacion: {
    codigo: 'email_verificacion_encolada',
    mensaje: 'Correo de verificación encolado.'
  },
  reenvio: {
    codigo: 'email_verificacion_reenvio_encolado',
    mensaje: 'Verificación encolada de nuevo.'
  }
};
let modo = 'correcto';
const controlador = new ControladorUsuarios({
  servicioCambioEmailPerfil: {
    async solicitarCambio() {
      if (modo === 'fallo') throw new Error('sql_no_disponible_fixture');
      return resultados.cambio;
    },
    async validarEmailActual() {
      return resultados.validacion;
    },
    async reenviarValidacion() {
      if (modo === 'cadencia') {
        throw new ErrorAutogestionPerfil({
          codigo: 'reenvio_limitado',
          mensaje: 'Espera antes de volver a enviar la verificación.',
          estadoHttp: 429,
          datos: { reintentar_en_segundos: 37 }
        });
      }
      return resultados.reenvio;
    }
  }
});

const cambio = await ejecutar('apiCambiarEmailPerfil', { email: 'nuevo@example.test' });
assert.deepEqual(cambio.payload, { ok: true, ...resultados.cambio });
assert.deepEqual(Object.keys(cambio.payload).sort(), ['codigo', 'mensaje', 'ok']);

const validacion = await ejecutar('apiValidarEmailPerfil', {});
assert.deepEqual(validacion.payload, { ok: true, ...resultados.validacion });

const reenvio = await ejecutar('apiReenviarValidacionEmailPerfil', {});
assert.deepEqual(reenvio.payload, { ok: true, ...resultados.reenvio });

modo = 'cadencia';
const cadencia = await ejecutar('apiReenviarValidacionEmailPerfil', {});
assert.equal(cadencia.estado, 429);
assert.deepEqual(cadencia.payload, {
  ok: false,
  codigo: 'reenvio_limitado',
  mensaje: 'Espera antes de volver a enviar la verificación.',
  reintentar_en_segundos: 37
});

modo = 'fallo';
const errorOriginal = console.error;
console.error = () => {};
const fallo = await ejecutar('apiCambiarEmailPerfil', {
  email: 'nuevo@example.test'
});
console.error = errorOriginal;
assert.equal(fallo.estado, 500);
assert.deepEqual(fallo.payload, {
  ok: false,
  codigo: 'infraestructura_no_disponible',
  mensaje: 'No se ha podido completar la operación del perfil.'
});

console.log(
  '[usuarios] OK 5.30b.5b: controladores=cuerpos_estables ' +
  'mensajes=encolado cadencia=429 fallo_inmediato=saneado ' +
  'publicacion_productiva=activa'
);

async function ejecutar(metodo, body) {
  const respuesta = crearRespuesta();
  await controlador[metodo]({
    body,
    sessionID: 'sesion-530b5b',
    contextoUsuarioActual: {
      idUsuario: 91,
      idUsuarioReal: 91,
      impersonacionActiva: false
    },
    is: (tipo) => tipo === 'application/json'
  }, respuesta);
  return respuesta;
}

function crearRespuesta() {
  return {
    estado: 200,
    payload: null,
    status(estado) {
      this.estado = estado;
      return this;
    },
    json(payload) {
      this.payload = payload;
      return this;
    }
  };
}

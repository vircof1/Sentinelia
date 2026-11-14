import assert from 'node:assert/strict';

import { ServicioCambioEmailPerfil }
  from '../paquetes/usuarios/src/ServicioCambioEmailPerfil.js';
import { ServicioEmailPerfil }
  from '../paquetes/usuarios/src/ServicioEmailPerfil.js';

const llamadas = [];
const usuario = {
  id: 81,
  activo: true,
  email: 'actual@example.test',
  emailValidado: true,
  hashPassword: 'hash-530b5a',
  obtenerNombreVisible: () => 'Operador'
};
const repositorioUsuarios = {
  buscarPorId: async () => usuario
};
const resultadoInicial = Object.freeze({
  codigo: 'email_verificacion_encolada',
  mensaje: 'Correo de verificación encolado.'
});
const resultadoReenvio = Object.freeze({
  codigo: 'email_verificacion_reenvio_encolado',
  mensaje: 'Verificación encolada de nuevo.'
});
const coordinador = {
  async encolarInicial(entrada) {
    llamadas.push(['inicial', entrada]);
    return resultadoInicial;
  },
  async encolarReenvio(entrada) {
    llamadas.push(['reenvio', entrada]);
    return resultadoReenvio;
  }
};
const operacionesLegacy = new Proxy({}, {
  get() {
    throw new Error('La adaptación privada no debe recorrer el transporte antiguo.');
  }
});
const servicio = new ServicioCambioEmailPerfil({
  repositorioUsuarios,
  repositorioOperacionesEmail: operacionesLegacy,
  servicioEmailPerfil: new ServicioEmailPerfil({ repositorioUsuarios }),
  servicioAutorizacionPerfil: { exigirAutorizacion: async () => {} },
  servicioCorreoPortal: { obtenerEstadoConfiguracion: () => ({ operativo: true }) },
  servicioConfiguracionPortal: {
    obtenerConfiguracionActual: () => ({
      obtenerOrigenPublicoPortal: () => 'https://sentinelia.example.test'
    })
  },
  coordinadorEmisionEmailPerfil: coordinador
});
const contexto = {
  idUsuario: 81,
  idUsuarioReal: 81,
  impersonacionActiva: false
};

assert.deepEqual(await servicio.solicitarCambio({
  contextoUsuarioActual: contexto,
  idSesion: 'sesion-5a',
  email: 'CANDIDATO@example.test'
}), resultadoInicial);
assert.deepEqual(llamadas.shift(), ['inicial', {
  idUsuario: '81',
  emailCandidato: 'CANDIDATO@example.test'
}]);

usuario.emailValidado = false;
assert.deepEqual(await servicio.validarEmailActual({
  contextoUsuarioActual: contexto,
  idSesion: 'sesion-5a'
}), resultadoInicial);
assert.deepEqual(llamadas.shift(), ['inicial', {
  idUsuario: '81',
  emailCandidato: 'actual@example.test'
}]);

assert.deepEqual(await servicio.reenviarValidacion({
  contextoUsuarioActual: contexto,
  idSesion: 'sesion-5a'
}), resultadoReenvio);
assert.deepEqual(llamadas.shift(), ['reenvio', { idUsuario: '81' }]);
assert.equal(llamadas.length, 0);

console.log(
  '[usuarios] OK 5.30b.5a: servicio=coordinador_requerido ' +
  'firmas=conservadas inicial=encolada validacion=encolada reenvio=encolado ' +
  'smtp_legacy=no_recorrido'
);

export const ESCRITORES_SENSIBLES_RECUPERACION_PASSWORD = Object.freeze([
  escritor('crearUsuarioInicialEnTransaccion', ['hash_password', 'email', 'activo']),
  escritor('crearUsuarioAdministrativoEnTransaccion', ['hash_password', 'email', 'activo']),
  escritor('sustituirPasswordPorRecuperacionEnTransaccion', ['hash_password']),
  escritor('actualizarPasswordObligatoria', ['hash_password']),
  escritor('actualizarPasswordPropioEnTransaccion', ['hash_password']),
  escritor('reiniciarPasswordAdministrativaEnTransaccion', ['hash_password']),
  escritor('establecerActivoAdministrativoEnTransaccion', ['activo']),
  escritor('actualizarMetadatosAdministrativos', ['email', 'email_validado']),
  escritor('actualizarUsuarioAdministrativoEnTransaccion', ['email', 'email_validado']),
  escritor('actualizarEmailYEstadoValidacion', ['email', 'email_validado']),
  escritor('actualizarEmailNoValidado', ['email', 'email_validado']),
  escritor('marcarEmailValidadoSiCoincide', ['email_validado']),
  escritor('confirmarEmailValidadoPendienteEnTransaccion', ['email', 'email_validado']),
  Object.freeze({
    archivo: 'scripts/sembrar-datos-ejemplo.js',
    operacion: 'asegurarUsuario',
    campos: Object.freeze(['hash_password', 'email', 'email_validado', 'activo'])
  })
]);

function escritor(operacion, campos) {
  return Object.freeze({
    archivo: 'paquetes/usuarios/src/RepositorioUsuarios.js',
    operacion,
    campos: Object.freeze([...campos])
  });
}

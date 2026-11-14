export function construirContenidoVerificacionEmailPerfil({
  nombrePortal,
  enlace,
  emailOrigen,
  emailCandidato,
  ttlMinutos = 15
}) {
  const portal = String(nombrePortal || 'Sentinelia').trim() || 'Sentinelia';
  const esValidacionEmailActual = emailOrigen === emailCandidato;

  if (esValidacionEmailActual) {
    return Object.freeze({
      esValidacionEmailActual,
      asunto: `Valida tu correo electrónico en ${portal}`,
      cuerpoTexto: [
        `Se ha solicitado validar el correo electrónico de tu cuenta de ${portal}.`,
        '',
        'Abre este enlace para iniciar sesión, si es necesario, y validar el correo electrónico:',
        enlace,
        '',
        `El enlace caduca en ${ttlMinutos} minutos. Abrirlo no valida el correo por sí solo.`,
        '',
        'Si no has solicitado esta validación, ignora este mensaje.'
      ].join('\n')
    });
  }

  return Object.freeze({
    esValidacionEmailActual,
    asunto: `Confirma el cambio de correo en ${portal}`,
    cuerpoTexto: [
      `Se ha solicitado cambiar el correo electrónico de tu cuenta de ${portal}.`,
      '',
      'Abre este enlace para iniciar sesión, si es necesario, y confirmar expresamente el cambio:',
      enlace,
      '',
      `El enlace caduca en ${ttlMinutos} minutos. Abrirlo no aplica el cambio por sí solo.`,
      '',
      'Si no has solicitado este cambio, ignora este mensaje.'
    ].join('\n')
  });
}

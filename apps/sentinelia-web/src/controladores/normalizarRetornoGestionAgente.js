export function normalizarRetornoGestionAgente(valor, agenteId) {
  if (typeof valor !== 'string') return '/agentes';
  const retorno = valor.trim();
  if (!retorno.startsWith('/') || retorno.startsWith('//') ||
      /[\\\r\n]/u.test(retorno)) {
    return '/agentes';
  }
  const url = new URL(retorno, 'http://sentinelia.local');
  const rutaGestion = `/agentes/${encodeURIComponent(String(agenteId))}/editar`;
  return url.origin === 'http://sentinelia.local' && url.pathname === rutaGestion
    ? `${url.pathname}${url.search}${url.hash}`
    : '/agentes';
}

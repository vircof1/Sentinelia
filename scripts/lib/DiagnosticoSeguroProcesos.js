const PATRON_VALOR_SEGURO = /^[A-Za-z0-9_.-]{1,96}$/u;

export function crearDiagnosticoSeguroProceso(error = {}) {
  const codigo = valorSeguro(error?.code);
  const senal = valorSeguro(error?.signal);
  return Object.freeze({
    codigo: Number.isInteger(error?.code) ? error.code : codigo,
    senal,
    terminadoPorTimeout: Boolean(error?.timedOut),
    terminadoForzosamente: Boolean(error?.killed)
  });
}

export function formatearDiagnosticoSeguroProceso(error = {}) {
  const diagnostico = crearDiagnosticoSeguroProceso(error);
  return [
    `codigo=${diagnostico.codigo ?? 'desconocido'}`,
    `senal=${diagnostico.senal ?? 'ninguna'}`,
    `timeout=${diagnostico.terminadoPorTimeout ? 'si' : 'no'}`,
    `forzado=${diagnostico.terminadoForzosamente ? 'si' : 'no'}`
  ].join(' ');
}

export function verificarDiagnosticoSeguroProcesos() {
  const secretos = [
    'QUJDREVGR0hJSktMTU5PUFFSU1RVVldYWVo=',
    'parte uno parte dos',
    `sft1_${'T'.repeat(64)}`
  ];
  const salida = formatearDiagnosticoSeguroProceso({
    code: 'ERR_CHILD_PROCESS',
    signal: 'SIGTERM',
    killed: true,
    stderr: `FEDERACION_KEYRING={"principal":"${secretos[0]}"}`,
    stdout: `password="${secretos[1]}"`,
    message: `authorization=Bearer ${secretos[2]}`
  });
  for (const secreto of secretos) {
    if (salida.includes(secreto)) {
      throw new Error('El diagnóstico seguro publicó material no autorizado.');
    }
  }
  return salida;
}

function valorSeguro(valor) {
  const texto = String(valor ?? '').trim();
  return PATRON_VALOR_SEGURO.test(texto) ? texto : null;
}

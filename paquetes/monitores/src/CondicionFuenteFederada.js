export const CONDICION_FUENTE_FEDERADA_RETIRADA = 'fuente_retirada';

export const MENSAJE_FUENTE_FEDERADA_RETIRADA =
  'La fuente remota fue retirada definitivamente y requiere reparación local explícita.';

export function esFuenteFederadaRetirada(valor) {
  return valor?.condicionFuente === CONDICION_FUENTE_FEDERADA_RETIRADA;
}

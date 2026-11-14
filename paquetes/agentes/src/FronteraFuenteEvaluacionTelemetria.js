export class FuenteEvaluacionTelemetriaEliminada extends Error {
  constructor(mensaje = 'La fuente de la evaluación ya no existe.') {
    super(mensaje);
    this.name = 'FuenteEvaluacionTelemetriaEliminada';
    this.code = 'fuente_eliminada';
    this.codigo = this.code;
    this.terminal = true;
  }
}

export function esFuenteEvaluacionTelemetriaEliminada(error) {
  return error instanceof FuenteEvaluacionTelemetriaEliminada ||
    error?.code === 'fuente_eliminada' ||
    error?.codigo === 'fuente_eliminada';
}

export function normalizarMarcaUtc(valor) {
  if (!valor) {
    return null;
  }

  if (valor instanceof Date) {
    return valor.toISOString();
  }

  const texto = String(valor).trim();

  if (
    /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}(?:\.\d{1,6})?$/.test(texto) ||
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?$/.test(texto)
  ) {
    const isoUtc = texto.replace(' ', 'T').concat('Z');
    const fechaMysqlUtc = new Date(isoUtc);

    return Number.isNaN(fechaMysqlUtc.getTime()) ? texto : fechaMysqlUtc.toISOString();
  }

  const fecha = new Date(texto);
  return Number.isNaN(fecha.getTime()) ? texto : fecha.toISOString();
}

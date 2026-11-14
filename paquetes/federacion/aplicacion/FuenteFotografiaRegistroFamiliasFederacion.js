export class FuenteFotografiaRegistroFamiliasFederacion {
  constructor({ registroFamilias } = {}) {
    if (typeof registroFamilias?.obtenerProductivo !== 'function') {
      throw new Error('La fotografía federada necesita el registro productivo de familias.');
    }
    this.registroFamilias = registroFamilias;
  }

  async listarCapturasEnTransaccion(solicitud = {}, { conexion } = {}) {
    if (typeof conexion?.execute !== 'function') {
      throw new Error('La fotografía federada necesita la transacción del corte.');
    }
    const [filas] = await conexion.execute(
      `SELECT familia,version_familia
         FROM flujos_federacion
        WHERE flujo_id=? FOR UPDATE`,
      [String(solicitud.flujoId || '')]
    );
    if (!filas[0]) {
      throw new Error('El flujo de la fotografía inicial ya no existe.');
    }
    const adaptador = this.registroFamilias.obtenerProductivo({
      familia: filas[0].familia,
      versionFamilia: Number(filas[0].version_familia)
    });
    return adaptador.interfaces.fotografiaInicial.listarCapturasEnTransaccion(
      solicitud,
      { conexion }
    );
  }
}

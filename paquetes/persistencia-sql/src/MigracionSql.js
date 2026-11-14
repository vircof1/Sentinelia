import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

export class MigracionSql {
  constructor({ nombreArchivo, rutaAbsoluta, contenido }) {
    this.nombreArchivo = nombreArchivo;
    this.rutaAbsoluta = rutaAbsoluta;
    this.contenido = contenido;
  }

  static async cargarDesdeArchivo(rutaAbsoluta) {
    const contenido = await fs.readFile(rutaAbsoluta, 'utf8');

    return new MigracionSql({
      nombreArchivo: path.basename(rutaAbsoluta),
      rutaAbsoluta,
      contenido
    });
  }

  obtenerChecksum() {
    return crypto.createHash('sha1').update(this.contenido).digest('hex');
  }
}

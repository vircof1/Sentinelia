export class RepositorioMigraciones {
  constructor(clienteSql) {
    this.clienteSql = clienteSql;
  }

  async asegurarTablaControl(conexion = null) {
    const ejecutor = conexion || (await this.clienteSql.conectar());

    await ejecutor.query(`
      CREATE TABLE IF NOT EXISTS control_migraciones (
        id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
        nombre_archivo VARCHAR(255) NOT NULL,
        checksum_sha1 CHAR(40) NOT NULL,
        fecha_aplicacion DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (id),
        UNIQUE KEY uk_control_migraciones_nombre_archivo (nombre_archivo)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);
  }

  async listarNombresAplicados() {
    await this.asegurarTablaControl();

    const filas = await this.clienteSql.consultar(`
      SELECT nombre_archivo
      FROM control_migraciones
      ORDER BY nombre_archivo ASC
    `);

    return new Set(filas.map((fila) => fila.nombre_archivo));
  }

  async listarAplicadas() {
    await this.asegurarTablaControl();

    const filas = await this.clienteSql.consultar(`
      SELECT nombre_archivo, checksum_sha1, fecha_aplicacion
      FROM control_migraciones
      ORDER BY nombre_archivo ASC
    `);

    return new Map(
      filas.map((fila) => [
        fila.nombre_archivo,
        {
          nombreArchivo: fila.nombre_archivo,
          checksum: fila.checksum_sha1,
          fechaAplicacion: fila.fecha_aplicacion || null
        }
      ])
    );
  }

  async registrarAplicada({ nombreArchivo, checksum }, conexion) {
    await this.asegurarTablaControl(conexion);

    await conexion.execute(
      `
        INSERT INTO control_migraciones (nombre_archivo, checksum_sha1)
        VALUES (?, ?)
      `,
      [nombreArchivo, checksum]
    );
  }
}

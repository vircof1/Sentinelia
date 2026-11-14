import mysql from 'mysql2/promise';

export class ClienteSql {
  constructor(configuracion) {
    this.configuracion = configuracion;
    this.pool = null;
  }

  async conectar() {
    if (this.pool) {
      return this.pool;
    }

    this.pool = mysql.createPool({
      host: this.configuracion.host,
      port: this.configuracion.puerto,
      user: this.configuracion.usuario,
      password: this.configuracion.password,
      database: this.configuracion.baseDatos,
      timezone: 'Z',
      waitForConnections: true,
      connectionLimit: 10,
      queueLimit: 0,
      multipleStatements: true
    });

    return this.pool;
  }

  async crearBaseDatosSiNoExiste() {
    const conexionAdministrativa = await mysql.createConnection({
      host: this.configuracion.host,
      port: this.configuracion.puerto,
      user: this.configuracion.usuario,
      password: this.configuracion.password,
      timezone: 'Z'
    });

    const nombreBaseDatosEscapado = this.escaparIdentificador(
      this.configuracion.baseDatos
    );

    try {
      await this.configurarConexionUtc(conexionAdministrativa);
      const [resultado] = await conexionAdministrativa.query(`
        CREATE DATABASE IF NOT EXISTS ${nombreBaseDatosEscapado}
        CHARACTER SET utf8mb4
        COLLATE utf8mb4_unicode_ci
      `);

      return {
        creada: resultado.warningStatus === 0
      };
    } finally {
      await conexionAdministrativa.end();
    }
  }

  async obtenerConexion() {
    const pool = await this.conectar();
    const conexion = await pool.getConnection();
    await this.configurarConexionUtc(conexion);
    return conexion;
  }

  async ejecutar(sql, parametros = []) {
    const conexion = await this.obtenerConexion();

    try {
      return await conexion.execute(sql, parametros);
    } finally {
      conexion.release();
    }
  }

  async consultar(sql, parametros = []) {
    const [filas] = await this.ejecutar(sql, parametros);
    return filas;
  }

  async cerrar() {
    if (!this.pool) {
      return;
    }

    await this.pool.end();
    this.pool = null;
  }

  async verificarUsoHorarioUtc() {
    const filas = await this.consultar(`
      SELECT
        @@session.time_zone AS session_time_zone,
        @@global.time_zone AS global_time_zone,
        DATE_FORMAT(UTC_TIMESTAMP(), '%Y-%m-%d %H:%i:%s') AS utc_ahora,
        DATE_FORMAT(NOW(), '%Y-%m-%d %H:%i:%s') AS session_ahora,
        TIMESTAMPDIFF(SECOND, UTC_TIMESTAMP(), NOW()) AS diferencia_segundos
    `);

    const estado = filas[0] || {};
    const diferenciaSegundos = Number(estado.diferencia_segundos || 0);

    if (diferenciaSegundos !== 0) {
      throw new Error(
        `La sesión SQL no está operando en UTC. NOW() y UTC_TIMESTAMP() difieren ${diferenciaSegundos} segundos.`
      );
    }

    return {
      sessionTimeZone: estado.session_time_zone || null,
      globalTimeZone: estado.global_time_zone || null,
      utcAhora: estado.utc_ahora || null,
      sessionAhora: estado.session_ahora || null,
      diferenciaSegundos
    };
  }

  async configurarConexionUtc(conexion) {
    if (conexion.__sentineliaUtcConfigurada) {
      return;
    }

    await conexion.query('SET NAMES utf8mb4 COLLATE utf8mb4_unicode_ci');
    await conexion.query("SET time_zone = '+00:00'");
    conexion.__sentineliaUtcConfigurada = true;
  }

  escaparIdentificador(valor) {
    return `\`${String(valor).replaceAll('`', '``')}\``;
  }
}
